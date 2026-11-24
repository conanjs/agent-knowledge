---
schema: knowledge-doc/v1
type: concept
topic: go/runtime
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "Green Tea GC: default since Go 1.26", "GOMEMLIMIT: Go ≥ 1.19", "runtime.AddCleanup and weak: Go ≥ 1.24", "linux/arm64 lab; numbers are from one machine"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, runtime, memory, allocator, escape-analysis, garbage-collector, gc, gogc, gomemlimit, green-tea, finalizer, cleanup, weak-pointer, unique]
ranked-sources: true
---

# Go memory allocation, escape analysis and the garbage collector

## Summary
**TL;DR:** The compiler keeps a value on the goroutine's stack when it can prove the value does not outlive the function (escape analysis); everything else goes to the heap, where a size-class allocator hands out memory from per-processor (P) caches without locks. A concurrent, non-moving mark-and-sweep garbage collector (GC) frees heap memory; it starts a new cycle when the heap grows by `GOGC` percent (default 100) of the live data, and `GOMEMLIMIT` adds a soft ceiling. Since Go 1.26 the "Green Tea" collector scans memory page by page. For releasing outside resources, use `runtime.AddCleanup` (Go 1.24) rather than finalizers, and `weak.Pointer` for caches.
**Use this when:** you tune `GOGC` or `GOMEMLIMIT` for a service, read `-gcflags=-m` or `GODEBUG=gctrace=1` output, chase allocations that slow a hot path, or attach cleanup to an object that wraps a file or a C resource.
**Not this doc:** goroutine stacks and the scheduler → `go/runtime/scheduler-and-goroutine-stacks.md`; finding allocation hot spots with profiles → `go/runtime/profiling-and-diagnostics.md`; the cross-language GC and heap trade-offs → `performance/runtime-and-client-performance.md`; container memory limits and the OOM (out-of-memory) killer → `kubernetes/memory-limits-and-oom-kill.md`.

## Problem
Go has no `free`, so it is easy to believe memory is not your concern. In practice the allocation rate decides how often the GC runs, a pointer returned from a function quietly moves a value to the heap, a container memory limit that the runtime does not know about ends in an out-of-memory kill, and a memory limit set below the live heap makes the program spend most of its time collecting. Finalizers that look like destructors may never run.

## Mental model
**Analogy:** a hotel. Short stays (a function's locals) use a cot in the guest's own room (the stack): it disappears at check-out, no cleaning needed. Guests who stay on after their host leaves get a real room (the heap). Rooms come in fixed sizes (size classes), and each floor desk (P) keeps a rack of free keys so it can hand one out without calling the front office. Now and then housekeeping (the GC) starts at the guest register (roots: globals and stacks), follows every "my friend is in room 512" note, marks those rooms as occupied, and cleans every unmarked room, while guests keep checking in. `GOGC` says how many new guests may arrive before the next round, `GOMEMLIMIT` says how many rooms the building has.

**Artifact:** one line of `GODEBUG=gctrace=1` output from the lab, with the fields the runtime documents ✅[^1] ✅[^9], as shown below:
```
gc 22 @0.431s 1%: 0.25+4.1+0.004 ms clock, 2.0+0/0/0.93+0.037 ms cpu, 63->85->42 MB, 74 MB goal, 0 MB stacks, 0 MB globals, 8 P
│   │       │     └ wall time of the 3 phases: STW sweep termination + concurrent mark + STW mark termination
│   │       └ share of time spent in GC since start
│   └ seconds since program start            heap at GC start -> at GC end -> live heap; next goal; P count
└ GC number
```

## How it works

**5 actors:**
- **Compiler** — its job: decide whether each variable lives on the stack or the heap, via escape analysis at build time ✅[^2].
- **Allocator** — its job: hand out heap memory, via the P's own `mcache`, the shared `mcentral` and the page heap `mheap` ✅[^7].
- **Pacer** — its job: decide when the next GC cycle starts, via the `GOGC` target and the `GOMEMLIMIT` limit ✅[^3].
- **Mark workers and assists** — its job: find every reachable object, via background workers, the write barrier and allocating goroutines that help ✅[^8].
- **Sweeper** — its job: reclaim unmarked memory, via lazy sweeping when a goroutine needs a span and a background sweeper goroutine ✅[^8].

```
 program allocates (mcache → mcentral → mheap → OS)
        │  heap reaches the pacer's goal
        ▼
 STW: sweep termination ──► concurrent mark (workers + write barrier + assists) ──► STW: mark termination
        ▲                                                                                │
        └──────────── next goal reached ◄── concurrent sweep (lazy + background) ◄────────┘
```

1. **Stack or heap (the compiler).** Where a variable lives does not change what the program means; it only changes efficiency ✅[^2]. When possible the compiler puts a function's locals in its stack frame; if it cannot prove a variable is unused after the function returns, the variable goes to the GC-managed heap, and very large locals may go there too ✅[^2]. Taking a variable's address makes it a heap candidate, but escape analysis keeps it on the stack when it can show the address does not outlive the call ✅[^2]. `go build -gcflags=-m` prints these decisions ✅[^3]. Go 1.25 and Go 1.26 both let the compiler place slice backing arrays on the stack in more situations ✅[^4] ✅[^5].
2. **The allocator (the allocating goroutine, its P, then shared structures).** Small sizes, up to and including 32 kB, round up to one of about 70 size classes ✅[^7]. An allocation looks in a free slot of the right class in the P's own cache (`mcache`) without a lock; when that span is full it gets one from the shared list for that class (`mcentral`), then from the page heap (`mheap`, managed in 8192-byte pages), and finally asks the operating system for at least 1 MB at a time ✅[^7]. Go 1.27's compiler calls size-specialized allocation routines, which cut the cost of some allocations under 80 bytes by up to 30% (about 1% in real allocation-heavy programs), at about 60 KB of extra binary size ✅[^6].
   - *The size-class table (Go 1.27.4).* It is generated into `src/internal/runtime/gc/sizeclasses.go`: `NumSizeClasses = 68`, where class 0 is a dummy entry, so 67 real classes run from 8 bytes to `MaxSmallSize = 32768` bytes ✅[^14] ✅[^15]. Think of shoe sizes: a request is fitted to the next size up, never cut to measure. A few rows ✅[^14], as shown below:

     | Class | Bytes per object | Bytes per span | Objects per span | Tail waste (bytes) |
     |---|---|---|---|---|
     | 1 | 8 | 8192 | 1024 | 0 |
     | 5 | 48 | 8192 | 170 | 32 |
     | 32 | 1024 | 8192 | 8 | 0 |
     | 35 | 1408 | 16384 | 11 | 896 |
     | 67 | 32768 | 32768 | 1 | 0 |

     The classes are chosen so that rounding a request up wastes at most 12.5%, and each class's span length so that cutting it into objects wastes at most 12.5%; the two can combine to at most 26.6% ✅[^15]. A larger request is a large object, rounded up to whole 8192-byte pages ✅[^16]. Capacities of `append([]byte(nil), make([]byte, n)...)` in the lab: 1 → 8, 9 → 16, 17 → 24, 33 → 48, 100 → 112, 1025 → 1152, 32768 → 32768, and both 32769 and 40000 → 40960 (five pages) ✅[^1].
   - *The tiny allocator.* Pointer-free requests smaller than 16 bytes (`TinySize = 16`, `TinySizeClass = 2`, the 16-byte class) are packed together into one 16-byte block, which is freed only when every object in it is unreachable ✅[^7] ✅[^14]. The source explains the 16-byte choice by its 2× worst-case waste, and names small strings and standalone escaping variables as the main targets ✅[^7]. In three lab runs, 1,000 `new(int64)` values raised `/gc/heap/tiny/allocs:objects` by 500 and `/gc/heap/allocs:objects` by 548–555, consistent with two 8-byte values per 16-byte block ✅[^1]. The tiny allocations themselves are counted only in the first metric; the second counts their blocks ✅[^17]. This sharing is also why a cleanup on a tiny object may never run (see Edge cases).
3. **A GC cycle (the GC workers, the write barrier, and allocating goroutines).** The collector runs concurrently with the program, is precise (knows exactly which words are pointers), and is a mark-and-sweep collector with a write barrier; it neither moves objects nor separates them by age ✅[^8]. One cycle ✅[^8], as shown below:
   - *Sweep termination:* a short stop-the-world (STW) pause.
   - *Mark:* the write barrier is turned on, roots are scanned (every goroutine stack, globals), and grey objects (found, not yet scanned) are scanned until none are left. Goroutines that allocate during marking must help ("assists"), and objects allocated during marking count as already marked.
   - *Mark termination:* a second short STW pause.
   - *Sweep:* unmarked memory is reclaimed concurrently, lazily when a goroutine needs a span and by a background sweeper.
4. **Green Tea (default since Go 1.26).** Instead of following objects one by one across the heap, the collector puts whole 8 KiB pages on its work list and scans the marked objects of one page together, for better memory locality and CPU scaling ✅[^12]. The Go team expects a 10–40% cut in GC overhead for GC-heavy programs; `GOEXPERIMENT=nogreenteagc` turns it off at build time ✅[^5], and the Go 1.27.4 toolchain still accepted that setting ✅[^1].
5. **When the next cycle starts (the pacer).** The target is `live heap + (live heap + GC roots) × GOGC / 100`: with 8 MiB live, 1 MiB of stacks and 1 MiB of global pointers, `GOGC=100` allows 10 MiB of new allocation before the next cycle (18 MiB in total) ✅[^3]. Doubling `GOGC` roughly doubles the memory overhead and halves the GC CPU cost ✅[^3]. Set it with the `GOGC` environment variable or `runtime/debug.SetGCPercent`; `GOGC=off` disables the collector unless a memory limit applies ✅[^3] ✅[^9].
6. **The memory limit (Go ≥ 1.19).** `GOMEMLIMIT` (or `runtime/debug.SetMemoryLimit`) sets a soft limit on all memory the runtime manages, measured as `Sys - HeapReleased` in `runtime.MemStats` ✅[^3]; it accepts suffixes `B`, `KiB`, `MiB`, `GiB`, `TiB`, and it excludes memory owned by C code or by the operating system for the process ✅[^9]. Near the limit the GC runs more often. To avoid stalling, the GC limits itself to roughly 50% of CPU time over a window of `2 × GOMAXPROCS` CPU-seconds, so memory may exceed the limit; a misconfigured limit can therefore slow a program by at most about 2× ✅[^3].
7. **Finalizers, cleanups, weak pointers and interning.**
   - `runtime.SetFinalizer` passes the dying object to the finalizer, which revives it: reclaiming it takes at least two GC cycles, and an object in a reference cycle is never reclaimed ✅[^13].
   - `runtime.AddCleanup(ptr, cleanup, arg)` (Go 1.24) calls `cleanup(arg)` in a separate goroutine some time after `ptr` is unreachable. Several cleanups may be attached, they run in no specified order and possibly concurrently, and they are not guaranteed to run before the program exits ✅[^9]. If `ptr` is reachable from `cleanup` or `arg`, it is never collected; `AddCleanup` panics when `arg == ptr` ✅[^9].
   - A `weak.Pointer[T]` (Go 1.24) does not keep its object alive; after the object becomes unreachable, `Value()` may return `nil`. Its uses are caches, canonicalization maps and linking the lifetimes of separate values ✅[^10].
   - `unique.Make` interns comparable values: two handles are equal exactly when the values used to make them are equal ✅[^11].

## Worked example
**Escape analysis.** Four small functions, built with `go build -gcflags="-m -l"` (`-l` turns off inlining so each decision is visible) ✅[^1], as shown below:
```go
func sum() int       { p := point{1, 2}; return p.x + p.y }     // no message: stays on the stack
func newPoint() *point { p := point{3, 4}; return &p }           // ./main.go:16:2: moved to heap: p
func buffer(n int) int { b := make([]byte, n); return len(b) }   // make([]byte, n) does not escape
func fixed() int     { b := make([]byte, 64); return len(b) }    // make([]byte, 64) does not escape
// testing.AllocsPerRun per call: sum 0, newPoint 1, buffer(10) 0, fixed 0
```
Only `newPoint` allocates, because its result outlives the call ✅[^1]. A `//go:noinline` `buffer(n)` allocated 0 times for `n` of 8 and 32 and once for 33 and 1024 bytes; with `-gcflags=all=-d=variablemakehash=n`, the switch the release notes give for turning off the new stack placement ✅[^5], every size allocated once ✅[^1].

**GC frequency.** A program that keeps 20 MiB live and allocates 1000 MiB of short-lived 4 KiB buffers, one run per setting ✅[^1], as shown below:

| Setting | GC cycles | Loop time | What it shows |
|---|---|---|---|
| `GOGC=50` | 32 | 487 ms | smaller target, more cycles |
| `GOGC=100` (default) | 22 | 423 ms | last line: `74 MB goal` |
| `GOGC=400` | 6 | 174 ms | larger target, last goal 528 MB |
| `GOGC=off` | 0 | 690 ms | no GC at all; the heap only grows |
| `GOGC=off GOMEMLIMIT=64MiB` | 35 | 363 ms | the limit alone decides; goal stays under 64 MB |
| `GOGC=100 GOMEMLIMIT=21MiB` | 329 | 1543 ms | limit barely above the live heap: the GC runs almost constantly |

Counts and times depend on machine load: three later runs of the same binary gave 44–63, 30–34 and 10–11 cycles for `GOGC=50`, `100` and `400`, and 448–552 cycles with the 21 MiB limit, with loop times 2–4× shorter; the order between the settings did not change ✅[^1].

The last row is the thrashing the GC guide warns about: the program makes little progress because the collector keeps running to hold an almost impossible limit ✅[^3].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `AddCleanup` on an 8-byte struct with no pointers | The cleanup never ran and the weak pointer still returned the object after `runtime.GC()`; with a 72-byte struct both worked ✅[^1] | Tiny (about 16 bytes or less) pointer-free objects may share one allocation slot, so one live neighbour keeps the slot alive ✅[^9] |
| `runtime.AddCleanup(g, f, g)` | Panic: `ptr is equal to arg, cleanup will never run` ✅[^1] | A cleanup argument that reaches `ptr` keeps it alive forever ✅[^9] |
| A finalizer on objects that form a cycle | The objects are never reclaimed and the finalizer never runs ✅[^13] | The finalizer needs the object itself, so the GC cannot free the cycle ✅[^13] |
| Code still uses the wrapped resource after its last use of the wrapper object | The cleanup may close the resource while it is still in use ✅[^9] | A cleanup may run as soon as the object is unreachable, and an argument can become unreachable at its last mention; call `runtime.KeepAlive(x)` after the last point it must stay alive ✅[^9] |
| `GODEBUG=gctrace=1 go run main.go` | Extra trace lines appear before the program's own ones ✅[^1] | The toolchain's own processes inherit `GODEBUG` too; with the variable set only for the built binary, only the program's lines appeared ✅[^1] |
| Memory limit below the live heap | Many cycles, slow progress, memory may still pass the limit ✅[^1] ✅[^3] | The limit is soft: the GC caps itself at about 50% CPU rather than stall ✅[^3] |
| Large virtual memory size (VSZ) in `top` | Not a leak ✅[^2] | The allocator reserves a large virtual arena; look at resident memory (RES) instead ✅[^2] |
| 64-bit heap base address | Randomized at start-up since Go 1.26; `GOEXPERIMENT=norandomizedheapbase64` turns it off ✅[^5] | A security hardening for programs that use cgo ✅[^5] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Higher `GOGC` | Less GC CPU (about half per doubling) ✅[^3] | More heap memory (about double per doubling) ✅[^3] |
| `GOMEMLIMIT` with a container memory limit | Uses the memory you have before collecting; fewer cycles; the guide suggests 5–10% headroom for memory the runtime cannot see ✅[^3] | Risk of thrashing when the live heap nears the limit ✅[^3] |
| `GOGC=off` plus `GOMEMLIMIT` | The fewest cycles that still keep the limit ✅[^3] | Every cycle happens near the limit; a live-heap spike thrashes ✅[^3] |
| `AddCleanup` instead of `SetFinalizer` | Works with cycles; memory can be freed at once ✅[^13] | Still no guarantee it runs; easy to keep `ptr` alive by mistake ✅[^9] |

## Takeaways
- Measure allocations (`-benchmem`, `testing.AllocsPerRun`, a heap profile) before tuning `GOGC`; fewer allocations lower GC cost at any setting.
- In a container with a memory limit, set `GOMEMLIMIT` to the limit minus 5–10% headroom, and keep the live heap well below it. [rule-candidate]
- Use `runtime.AddCleanup`, not `runtime.SetFinalizer`, to release outside resources, and never make `ptr` reachable from the cleanup function or its argument. [rule-candidate]
- Do not rely on a cleanup or finalizer to run; close files and connections explicitly, and keep cleanups as a safety net. [rule-candidate]
- Run `GODEBUG` traces against the built binary, not through `go run`, so the toolchain's own GC lines do not mix in.

## Verification status
- Verified: 76 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24 (OrbStack, 8 logical CPUs, arm64), including the size-class capacities and the tiny-allocator metric counts. [^1]
- [Frequently Asked Questions (FAQ)](https://go.dev/doc/faq) — Go team, living. Rank 1. Backs: "How do I know whether a variable is allocated on the heap or the stack?"; "Why does my Go process use so much virtual memory?". [^2]
- [A Guide to the Go Garbage Collector](https://go.dev/doc/gc-guide) — Go team, living. Rank 1. Backs: the GOGC target formula and its example, `GOGC=off`, the memory limit and `Sys - HeapReleased`, the 50% GC CPU limit, thrashing, 5–10% headroom, `-gcflags=-m`, `GODEBUG=gctrace=1`. [^3]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: more slice backing stores on the stack; Green Tea as an experiment. [^4]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: Green Tea on by default, 10–40% expected, `nogreenteagc`; more stack-allocated slices and `variablemakehash=n`; heap base randomization. [^5]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: size-specialized allocation (< 80 bytes, up to 30%, about 1%, about 60 KB). [^6]
- [runtime/malloc.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/malloc.go) — Go team, 2026. Rank 1. Backs: about 70 size classes up to 32 kB; mcache, mcentral, mheap, 8192-byte pages, at least 1 MB from the OS; the tiny allocator (16-byte blocks, pointer-free objects, freed together, 2× worst-case waste, targets). [^7]
- [runtime/mgc.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/mgc.go) — Go team, 2026. Rank 1. Backs: concurrent, precise, non-generational, non-compacting mark-sweep with a write barrier; the four phases; assists; new objects marked black; concurrent sweep. [^8]
- [Package runtime](https://pkg.go.dev/runtime) — Go team, living. Rank 1. Backs: `GOGC`, `GOMEMLIMIT` and its suffixes and exclusions, the gctrace line format, `AddCleanup` (rules, tiny-object batching, early run, `KeepAlive`). [^9]
- [Package weak](https://pkg.go.dev/weak) — Go team, living. Rank 1. Backs: `Pointer.Value` may return nil once the object is unreachable; use cases. [^10]
- [Package unique](https://pkg.go.dev/unique) — Go team, living. Rank 1. Backs: `Make` returns handles that are equal exactly when the values are equal. [^11]
- [internal/runtime/gc/sizeclasses.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/internal/runtime/gc/sizeclasses.go) — Go team, 2026. Rank 1. Backs: the generated size-class table and its rows, `NumSizeClasses = 68`, `MaxSmallSize = 32768`, `TinySize = 16`, `TinySizeClass = 2`. [^14]
- [runtime/_mkmalloc/mksizeclasses.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/_mkmalloc/mksizeclasses.go) — Go team, 2026. Rank 1. Backs: class 0 is a dummy entry; at most 12.5% waste from rounding and from span cutting, 26.6% combined. [^15]
- [runtime/msize.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/msize.go) — Go team, 2026. Rank 1. Backs: large objects are rounded up to whole pages. [^16]
- [Package runtime/metrics (go1.27.4)](https://pkg.go.dev/runtime/metrics@go1.27.4) — Go team, 2026. Rank 1. Backs: `/gc/heap/tiny/allocs:objects` counts packed tiny allocations, `/gc/heap/allocs:objects` counts only their blocks. [^17]
- [The Green Tea Garbage Collector](https://go.dev/blog/greenteagc) — Go team (Michael Knyszek, Austin Clements), 2025. Rank 4. Backs: page-based scanning, 8 KiB pages, the work list of pages. [^12]
- [From unique to cleanups and weak: new low-level tools for efficiency](https://go.dev/blog/cleanups-and-weak) — Go team (Michael Knyszek), 2025. Rank 4. Backs: why finalizers resurrect objects, two cycles, reference cycles; how cleanups avoid both. [^13]

## Related
- `go/learning-path.md` — where this doc sits in the learning order.
- `go/runtime/scheduler-and-goroutine-stacks.md` — goroutine stacks, the other place values live.
- `go/runtime/profiling-and-diagnostics.md` — heap profiles to find what to fix.
- `go/data-types/arrays-and-slices.md` — how `append` grows backing arrays.
- `performance/runtime-and-client-performance.md` — GC tuning next to other runtimes.
- `kubernetes/memory-limits-and-oom-kill.md` — what happens when a container passes its memory limit.
