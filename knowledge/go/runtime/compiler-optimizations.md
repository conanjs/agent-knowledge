---
schema: knowledge-doc/v1
type: concept
topic: go/runtime
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "PGO: preview in Go 1.20, default -pgo=auto since Go 1.21", "devirtualization interleaved with inlining: Go ≥ 1.22", "linux/arm64 lab; assembly and timings are from one machine"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, compiler, cmd-compile, inlining, mid-stack-inlining, devirtualization, bounds-check-elimination, ssa, pgo, linker, dead-code-elimination, gcflags, assembly, objdump]
ranked-sources: true
---

# Go compiler optimizations: inlining, devirtualization, bounds checks and dead code

## Summary
**TL;DR:** The Go compiler (`cmd/compile`, called "gc") parses and type-checks each package, rewrites its intermediate representation (IR) with inlining, devirtualization and escape analysis, then lowers it through static single assignment (SSA) form to machine code; the linker then drops every function that `main.main` cannot reach. Inlining works on a budget of 80 nodes, a call to a non-inlinable function costs 57 more, and a call to an inlinable one costs only that function's own size, so small wrappers inline all the way up the stack. `-gcflags=-m`, `-d=ssa/check_bce/debug=1`, `-S` and `go tool objdump` show what happened; a CPU (central processing unit) profile used for profile-guided optimization (PGO) raises the budget for hot calls and turns hot interface calls into direct ones.
**Use this when:** a hot function is slower than it should be, you want to know whether a call was inlined, whether a slice index still has a bounds check, why a binary is large, or what PGO changed.
**Not this doc:** stack versus heap and `moved to heap` lines → `go/runtime/memory-allocation-and-gc.md`; collecting the CPU profile PGO needs → `go/runtime/profiling-and-diagnostics.md`; `-gcflags`/`-ldflags` syntax and other build flags → `go/tooling/go-command-and-build-reference.md`; benchmark loops that the compiler removes → `go/tooling/testing-benchmarks-and-fuzzing.md`.

## Problem
Two functions that look equally cheap can differ several times in speed, and the source does not say why. One was copied into its caller and the other was not; one interface call was turned into a direct call and the other was not; one loop checks every index and the other checks none. Guessing leads to `//go:noinline` and `unsafe` tricks that may make nothing faster. The compiler prints its decisions on request, so they can be read instead of guessed.

## Mental model
**Analogy:** a print shop turning a manuscript into a book. Proofreaders check spelling and grammar (parsing, type checking). An editor pastes short footnotes straight into the sentence that cites them (inlining), replaces "ask the front desk which department" with the department's direct line when only one department is possible (devirtualization), and decides which notes need a permanent appendix (heap) rather than the margin (stack). The typesetter removes "check that page 4 exists" notes once page 4 was already checked (bounds-check elimination) and lays the text out for one particular press (lowering to arm64 or amd64). Finally the binder binds only the chapters the table of contents leads to (the linker's dead-code elimination).

**Artifact:** the editor's notes, from `go build -gcflags=-m=2` on Go 1.27.4 ✅[^1], as shown below.
```
./main.go:5:6: can inline add with cost 4 as: func(int, int) int { return a + b }
./main.go:7:6: can inline sum3 with cost 16 as: func(int, int, int) int { return add(add(a, b), c) }
./main.go:12:6: can inline oneCall with cost 64 as: func(int) int { return mul(a, a) + 1 }
./main.go:14:6: cannot inline twoCalls: function too complex: cost 124 exceeds budget 80
./main.go:16:6: cannot inline withRecover: unhandled op DEFER
```
`mul` is marked `//go:noinline`, so each call to it costs 57 extra nodes: one call fits under 80, two do not.

## How it works
**6 actors:**
- **Front end** — its job: turn source files into typed IR, via the `syntax`, `types2` and `noder` packages of `cmd/compile` ✅[^2].
- **Middle end** — its job: rewrite the IR, via the `inline`, `devirtualize` and `escape` packages ✅[^2].
- **Walk** — its job: fix evaluation order and lower high-level constructs, via the `walk` package ✅[^2].
- **SSA back end** — its job: optimize and turn each function into machine instructions, via the `ssagen` and `ssa` packages ✅[^2].
- **Assembler** — its job: encode instructions into an object file with export data, via `cmd/internal/obj` ✅[^2].
- **Linker** — its job: combine the packages and drop unreachable code, via `cmd/link` ✅[^9].

```
 go build -gcflags=…            ── one compile per package (all local to the machine) ──
   │
   ▼
 parse (syntax) → type-check (types2) → noding: IR (Unified IR)
   → middle end: dead code · devirtualize · inline · escape analysis     shows in: -m, -m=2
   → walk: order of evaluation, desugaring (switch → jump table, map ops → runtime calls)
   → generic SSA: intrinsics · dead code · nil checks · prove (bounds checks)   shows in: -d=ssa/check_bce/debug=1
   → lower · register allocation · stack frame layout → obj: machine code    shows in: -S
   ▼
 package archives + export data (inline bodies, escape summaries)
   │                            ── one link per binary ──
   ▼
 cmd/link: flood fill from main.main, drop unreached functions → executable   shows in: go tool nm, go tool objdump
```

1. **Front end (compiler, per package).** The source is tokenized and parsed into one syntax tree per file, with positions kept for errors and debug information ✅[^2]. `types2`, a port of `go/types`, type-checks it, and "noding" converts the result into the compiler's own IR through a serialized form called Unified IR, which is also used for inlining and for export data, the summary a compiled package hands to the packages that import it ✅[^2].
2. **Middle end: inlining (compiler).** Inlining replaces a call with a copy of the callee's body, like pasting a footnote's text into the sentence that cites it. It runs in two passes: `CanInline` decides which functions are suitable and saves their bodies, then `InlineCalls` expands the calls ✅[^4].
   - *Budget:* a function is inlinable when its body costs at most 80 nodes; most nodes cost 1, a call to a function that will not be inlined costs 57 more, and a `panic` adds only 1 more so that panics are not penalized ✅[^4].
   - *Mid-stack inlining:* a call to an inlinable function is charged that function's own cost instead of the 57-node call cost, so a function that only calls small functions can be inlined too ✅[^4]. In the lab `sum3` (cost 16) was inlined into `main` and both `add` calls inside it went along ✅[^1].
   - *Never inlined:* functions marked `//go:noinline`, functions that call `recover`, and functions containing `go` or `defer` statements ("unhandled op") ✅[^4]; the lab printed `marked go:noinline`, `call to recover` and `unhandled op DEFER` ✅[^1]. `//go:noinline` exists mainly for special runtime functions and for debugging the compiler ✅[^3].
   - *Size rules:* a caller with 5,000 or more nodes only takes callees of cost 20 or less, and a closure that is called once gets a budget of 800 ✅[^4].
   - *Across packages:* export data carries the IR of inlinable function bodies ✅[^2], which is why the lab printed `inlining call to fmt.Println` ✅[^1]. `-gcflags=-l` turns inlining off ✅[^3]; with it the lab printed no inlining lines at all ✅[^1].
3. **Middle end: devirtualization (compiler).** Static devirtualization replaces an interface method call with a direct call to the concrete type's method when the compiler can see that type ✅[^7]. Analogy: dialing a department's direct line instead of asking the front desk, when only one department can answer. `var s Shape = &Square{2}; s.Area()` printed `devirtualizing s.Area to *Square` with `-m` ✅[^1]. Since Go 1.22 the compiler interleaves devirtualization and inlining, which optimizes interface method calls better ✅[^12].
4. **Middle end: escape analysis (compiler).** It decides whether each value can live in the function's stack frame or must move to the garbage-collected heap, and `-m` reports it as `does not escape`, `escapes to heap` or `moved to heap` ✅[^1]; export data keeps a summary of its findings on function parameters for the packages that import this one ✅[^2]. The rules, the allocation cost and worked examples are in `go/runtime/memory-allocation-and-gc.md`.
5. **Walk (compiler).** Walk splits complex statements into simple ones with temporaries, respecting evaluation order, and desugars constructs: `switch` statements become binary searches or jump tables, and map and channel operations become runtime calls ✅[^2].
6. **Generic SSA and bounds checks (compiler).** SSA is a lower-level IR whose properties make optimizations easier to write ✅[^2]. Each value is defined exactly once and may be used any number of times, like labeling each intermediate result of a calculation with a new name ✅[^15]. Intrinsics (functions the compiler replaces with special code) are applied here, then machine-independent passes remove dead code, redundant nil checks and unused branches ✅[^2].
   - *Bounds checks:* the language requires a run-time panic when an index is out of range ✅[^14], so the compiler emits a comparison before each index. Analogy: an usher who checks that seat 4 exists before seating someone there.
   - *Elimination:* the `prove` pass removes a check that earlier comparisons already imply, for example the second `i >= len(a)` test after `a[i]` was checked once ✅[^5].
   - *Seeing what is left:* `-gcflags=-d=ssa/check_bce/debug=1` prints every bounds check still present; it is off by default ✅[^6] ✅[^2]. The lab results, per function:

   | Function | Body | Checks reported ✅[^1] |
   |---|---|---|
   | `Sum4` | `return s[0] + s[1] + s[2] + s[3]` | 4 (`Found IsInBounds` at each index) |
   | `Sum4Hoisted` | `_ = s[3]` first, then the same sum | 1, on the `_ = s[3]` line |
   | `SumRange` | `for i := range s { t += s[i] }` | 0 |
   | `SumN` | `for i := 0; i < n; i++ { t += s[i] }` | 1 inside the loop, run every iteration |
   | `SumNHoisted` | `s = s[:n]` first, then the same loop | 1 `IsSliceInBounds` on the reslice, none in the loop |

   The hoisted check is one compare-and-branch: on arm64 `Sum4Hoisted` compiled to `CMP $3, R1` / `BLS` and one `CALL runtime.panicBounds` (112 bytes), against four compares and four `panicBounds` calls in `Sum4` (144 bytes) ✅[^1].
7. **Machine code (compiler, then assembler).** The `lower` pass rewrites generic operations into machine-specific ones and applies many architecture rules; later passes remove dead code again, move values closer to their uses, drop locals that are never read, allocate registers, lay out the stack frame and compute which stack pointers are live at each garbage-collection safe point ✅[^2] (safe points and preemption: `go/runtime/scheduler-and-goroutine-stacks.md`). The assembler writes the object file, which also holds reflection data, export data and debug information ✅[^2].
8. **Linker: dead-code elimination (linker, per binary).** Dead-code elimination drops code nothing can run; think of the binder who binds only chapters the table of contents leads to. The linker starts at the entry symbol and follows relocations (the references from one symbol's code or data to another), like paint spreading to every connected cell, then removes every function the paint did not reach ✅[^9]. A method of a reachable type is kept when it is called directly, when its signature matches a method of a reachable interface type, or when reflection could call it: a function that calls `reflect.Value.Method`, `reflect.Type.Method`, or `MethodByName` with a non-constant name makes the linker keep every exported method of every reachable type ✅[^9]. In the lab `go tool nm` showed `main.T.Hello` (called through an interface) but no `main.T.Goodbye` (exported, never called) and no `main.neverCalled`; adding `reflect.ValueOf(g).MethodByName(os.Args[1])` brought `main.T.Goodbye` back, and the binary grew from 1,999,132 to 3,331,482 bytes, most of that the `reflect` code itself ✅[^1].
9. **What PGO adds (compiler, with a profile).** PGO feeds a CPU profile from representative runs into the next build ✅[^10]. Analogy: a road crew that widens the roads where its traffic counters saw the most cars.
   - *Hot inlining:* the hottest call edges that together carry 99% of the profile's edge weight count as hot, and a callee on a hot edge is judged against a budget of 2,000 instead of 80 ✅[^4].
   - *Hot devirtualization:* an indirect call (interface method or function value) becomes `if the value is the hottest concrete callee { direct call } else { original indirect call }`, mainly so the direct call can be inlined ✅[^8]; Go 1.21 added it for interface calls ✅[^11], and Go 1.22 made it cover a higher share of calls ✅[^12].
   - *Measured gain:* as of Go 1.22 the Go team measured about 2–14% on a representative set of programs ✅[^10]. How to collect and store the profile (`default.pgo`, `-pgo=auto`) is in `go/runtime/profiling-and-diagnostics.md`.
10. **Reading the output.** The README's own list of switches ✅[^2], with the flags the compiler documents ✅[^3] and `go tool objdump`, which the lab ran on the inlining and PGO binaries ✅[^1], as shown below.

    | Command | Shows |
    |---|---|
    | `go build -gcflags=-m` (`-m=2` for reasons and costs) | inlining, devirtualization and escape decisions |
    | `go build -gcflags=-d=ssa/check_bce/debug=1` | bounds checks that remain |
    | `go build -gcflags=-S` | the assembly listing, per function |
    | `go tool objdump -s '<regexp>' <binary>` | the final machine code of a linked binary |
    | `GOSSAFUNC=Foo go build` | an `ssa.html` file showing every SSA pass for `Foo` |
    | `go build -gcflags='-N -l'` | no optimizations (`-N`) and no inlining (`-l`), for debuggers |
    | `go tool compile -d help`, `go tool compile -d ssa/help` | the other debug switches |

    `-gcflags` applies only to the packages named on the command line unless a pattern such as `all=` is given ✅[^2]. `go tool objdump` on the lab's `main` showed `CALL main.mul` at the line of `oneCall` (inlined, its call kept), `CALL main.twoCalls` (not inlined), and no call to `sum3` or `add` ✅[^1].

## Worked example
PGO turning a hot interface call into a direct, inlined call. `Total` sums `s.Area()` over 1,000 shapes, 900 `*Square` and 100 `*Circle`, and is marked `//go:noinline` so it stays a separate function. All runs on Go 1.27.4, arm64 ✅[^1].

```go
type Shape interface{ Area() float64 }
func (q *Square) Area() float64 { return q.S * q.S } // line 7
func (c *Circle) Area() float64 { return 3 * c.R * c.R }

//go:noinline
func Total(shapes []Shape) float64 {
	t := 0.0
	for _, s := range shapes {
		t += s.Area() // line 24: an indirect call through the interface
	}
	return t
}
```

| Step | Command | Observed ✅[^1] |
|---|---|---|
| 1. Profile the benchmark | `go test -bench Total -cpuprofile cpu.prof` | 3,809–4,353 ns/op; `go tool pprof -peek` shows `Total` calling `(*Square).Area` for 410 ms and `(*Circle).Area` for 80 ms of 3,690 ms |
| 2. Rebuild with the profile | `go test -c -pgo=cpu.prof -gcflags=-m` | `./shapes.go:24:14: PGO devirtualizing interface call s.Area to (*Square).Area` |
| 3. Read the machine code | `go tool objdump -s 'shapes.Total$'` | `CMP R4, R2` / `BNE` compares the value's type with `*Square`, then `FMULD F0, F0, F0` from line 7 runs inline; the `CALL (R1)` indirect call remains as the fallback for circles |
| 4. Compare | both binaries, alternated, five runs each, `-test.cpu 1` | without PGO 3,676–4,647 ns/op, with PGO 1,194–1,853 ns/op |

The profile told the compiler which concrete type was common; the guard costs one comparison, and the common case then has no call at all. The lab's 3× gain is far above the 2–14% the Go team reports for whole programs, because this benchmark spends all its profiled time in `Total` and the two `Area` methods.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| The same `Total` without `//go:noinline`, inlined into the benchmark | `-m` still printed the PGO devirtualization line, but the benchmark's loop kept only the indirect `CALL (R1)`, the same bytes as the build without PGO, and timings overlapped ✅[^1] | Observed on Go 1.27.4; read the machine code, not only `-m`, before crediting PGO |
| Value-receiver methods (`func (q Square) Area()`) called through the interface | The profile showed no `Area` frames, and `-d=pgodebug=2` picked `runtime.asyncPreempt` as the "hottest callee", so nothing was devirtualized ✅[^1] | Observed on Go 1.27.4; pointer receivers appeared in the profile and were devirtualized ✅[^1] |
| A second identical `go build -gcflags=-m` | The same diagnostics print again ✅[^1] | Observed on Go 1.27.4, so re-running a build to read its decisions is safe |
| `-gcflags=-m` with dependencies | Only the named packages report ✅[^2] | Use `-gcflags=all=-m` for every package ✅[^2] |
| A source comment says inlining level 1 covers "leaf functions" | Non-leaf `sum3` and `oneCall` were inlined by default ✅[^1] | The cost model charges a call by its callee's cost or 57 nodes, not a ban on calls ✅[^4] |
| An optimization moves a nil check | It must not: a nil dereference before an error check panics on Go 1.27.4 ✅[^1] | Go 1.21–1.24 wrongly delayed some nil checks; Go 1.25 fixed it, so code that used a result before checking `err` now panics ✅[^13] |
| `range` loop versus `i < n` loop over the same slice | `range` had no checks; `i < n` had one per iteration ✅[^1] | `prove` can only drop checks that earlier comparisons imply ✅[^5] |
| Timing a bounds-check change | Benchmarks of `Sum4` and `Sum4Hoisted` overlapped on the busy lab machine (5.1–8.3 against 3.3–7.0 ns/op) ✅[^1] | Count the checks with `check_bce`; trust timings only when runs are stable |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Write small functions and let the compiler inline them | Readable code at no call cost when under the budget ✅[^4] | A function just over 80 nodes silently stays a call; check `-m=2` on hot paths |
| `//go:noinline` | Keeps a real call in the machine code (`CALL main.mul` in the lab) ✅[^1] | Loses inlining; documented as rarely needed outside the runtime and compiler debugging ✅[^3] |
| Hint bounds with `_ = s[n-1]` or `s = s[:n]` | One check instead of many ✅[^1] | An extra line that looks like dead code unless a comment explains it |
| PGO | Hot calls inlined and devirtualized; 2–14% typical ✅[^10] | Measurably longer builds and slightly larger binaries ✅[^10] |
| Reflection with `MethodByName(variable)` | Calls methods chosen at run time | The linker keeps every exported method of every reachable type ✅[^9] |

## Takeaways
- Before rewriting a hot function for speed, run `go build -gcflags=-m=2` and read whether it and its callees were inlined, and why not. [rule-candidate]
- Keep hot leaf functions free of `defer`, `recover` and `go` statements if they must inline. [rule-candidate]
- In a hot loop, index with `range` or reslice once (`s = s[:n]`) so `prove` can drop the per-iteration bounds check; confirm with `-d=ssa/check_bce/debug=1`. [rule-candidate]
- After enabling PGO, confirm a change in the machine code (`go tool objdump`) or a stable benchmark, not only in `-m` output.
- Avoid `MethodByName` with a run-time name in binaries whose size matters. [rule-candidate]

## Verification status
- Verified: 74 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`, linux/arm64, 8 logical CPUs) where every behaviour marked with this note ran on 2026-11-24: `-m`/`-m=2`/`-l` output, `check_bce` output, `-S` and `go tool objdump` listings, `go tool nm` on the dead-code example, the static and PGO devirtualization runs and benchmarks, the nil-check program. [^1]
- [Introduction to the Go compiler (cmd/compile/README.md) at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/cmd/compile/README.md) — Go team, 2026. Rank 1. Backs: the phases and their packages, Unified IR, the middle-end passes, walk, SSA passes, lowering and later passes, export data contents, the debugging switches, `-gcflags` scope. [^2]
- [cmd/compile/internal/ssa/README.md at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/cmd/compile/internal/ssa/README.md) — Go team, 2026. Rank 1. Backs: an SSA value is defined exactly once and may be used many times. [^15]
- [Command compile (go1.27.4)](https://pkg.go.dev/cmd/compile@go1.27.4) — Go team, 2026. Rank 1. Backs: `-l`, `-N`, `-S`, `-m`, `-d`; `//go:noinline`. [^3]
- [cmd/compile/internal/inline/inl.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/cmd/compile/internal/inline/inl.go) — Go team, 2026. Rank 1. Backs: the two passes, budget 80, call cost 57, panic cost, callee-cost charging (mid-stack inlining), reasons a function is never inlined, big-function and closure rules, PGO hot threshold 99% and budget 2,000. [^4]
- [cmd/compile/internal/ssa/prove.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/cmd/compile/internal/ssa/prove.go) — Go team, 2026. Rank 1. Backs: `prove` removes bounds checks implied by dominating comparisons. [^5]
- [cmd/compile/internal/ssa/checkbce.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/cmd/compile/internal/ssa/checkbce.go) — Go team, 2026. Rank 1. Backs: `check_bce` prints every remaining bounds check and is off by default. [^6]
- [cmd/compile/internal/devirtualize/devirtualize.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/cmd/compile/internal/devirtualize/devirtualize.go) — Go team, 2026. Rank 1. Backs: static devirtualization of interface calls with a statically known concrete type. [^7]
- [cmd/compile/internal/devirtualize/pgo.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/cmd/compile/internal/devirtualize/pgo.go) — Go team, 2026. Rank 1. Backs: the conditional direct call to the hottest callee with an indirect fallback, for interface and function-value calls; the purpose (enable inlining). [^8]
- [cmd/link/internal/ld/deadcode.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/cmd/link/internal/ld/deadcode.go) — Go team, 2026. Rank 1. Backs: the flood fill from the entry symbol, the three ways a method stays reachable, `REFLECTMETHOD` keeping all exported methods, unreached text removed. [^9]
- [Profile-guided optimization](https://go.dev/doc/pgo) — Go team, living. Rank 1. Backs: what PGO is, more aggressive inlining of hot functions, 2–14% as of Go 1.22, build time and binary size costs. [^10]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: PGO devirtualizes some interface method calls. [^11]
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22) — Go team, 2024. Rank 1. Backs: PGO devirtualizes a higher proportion of calls; devirtualization and inlining interleaved. [^12]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: the delayed nil check bug in Go 1.21–1.24 and its fix. [^13]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: an out-of-range index causes a run-time panic. [^14]

## Related
- `go/learning-path.md` — where this doc sits in the learning order.
- `go/runtime/memory-allocation-and-gc.md` — escape analysis, the middle-end pass this doc only names.
- `go/runtime/profiling-and-diagnostics.md` — collecting the CPU profile that PGO uses, and `default.pgo`.
- `go/tooling/go-command-and-build-reference.md` — `-gcflags`, `-ldflags` and the compiler directives.
- `go/tooling/testing-benchmarks-and-fuzzing.md` — benchmarks the compiler can optimize away, and `b.Loop`.
- `go/tooling/debugging-with-delve.md` — why debuggers want `-gcflags=all="-N -l"`.
- `go/methods-interfaces/interfaces.md` — interface values, which devirtualization looks through.
- `js-runtime/v8-hidden-classes.md` — a JIT (just-in-time) compiler's inline caches, the run-time counterpart of devirtualization.
