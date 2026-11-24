---
schema: knowledge-doc/v1
type: concept
topic: go/fundamentals
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "per-iteration loop variables and range over integers: modules declaring go 1.22 or later"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, if, switch, fallthrough, for, range, loopvar, labels, break, continue, goto, functions, multiple-results, named-results, variadic, closures, defer]
ranked-sources: true
---

# Control flow, functions, closures and defer

## Summary
**TL;DR:** Go has one loop keyword, `for`, in three forms plus `range`; `if` and `switch` can start with a short statement; `switch` cases do not fall through unless you write `fallthrough`, and a `switch` with no expression replaces an if-else chain. Functions return several values, may name their results, accept a variadic last parameter, and are values that close over variables. `defer` schedules a call for the moment the surrounding function returns: deferred calls run last-in first-out, their arguments are evaluated when the `defer` statement runs, and they can change named results. Since Go 1.22 (in modules that say `go 1.22` or later) each loop iteration gets its own loop variable, and `for i := range n` counts from 0 to n-1.
**Use this when:** writing loops and branches, deciding between `switch` and `if`, returning errors with results, releasing resources with `defer`, or explaining why closures created in a loop print the same value in an old module.
**Not this doc:** type switches → `go/methods-interfaces/interfaces.md`; range-over-function iterators (`iter.Seq`) → `go/standard-library/iterators.md`; `select` over channels → `go/concurrency/goroutines-and-channels.md`; `panic` and `recover` with `defer` → `go/errors/panic-and-recover.md`.

## Problem
Code moved between Go modules can change behaviour without any edit: closures created in a loop print `6 6 6` in one module and `1 3 5` in another. A `break` inside a `switch` inside a `for` loop does not leave the loop. A `defer f.Close()` inside a loop keeps every file open until the function ends. A `defer fmt.Println(x)` prints the old value of `x`. Each of these follows a short rule in the specification.

## Mental model
**Analogy:** `defer` is a stack of sticky notes on the exit door of a room (the function). Each `defer` statement writes a note *now*, with the values it needs copied onto it, and sticks it on top of the pile. Whenever someone leaves the room — by `return`, by reaching the end, or by a panic — they read the notes from the top down. A loop variable since Go 1.22 is like a fresh notepad handed out for every pass of a loop, so a closure that keeps a reference to "this pass's" notepad keeps its own value.

**Artifact:** the specification's own example, run in two modules of the Go 1.27.4 lab ✅[^1] ✅[^2]:
```go
var prints []func()
for i := 0; i < 5; i++ {
	prints = append(prints, func() { println(i) })
	i++
}
for _, p := range prints {
	p()
}
// go.mod says go 1.22 → prints 1 3 5   (each iteration has its own i)
// go.mod says go 1.21 → prints 6 6 6   (one i shared by all iterations)
```

## How it works

### `if` and `switch`
1. **No parentheses, braces required.** `if`, `for` and `switch` take no parentheses around the condition, and bodies are always in braces ✅[^3].
2. **Init statements.** `if` and `switch` may start with a simple statement, run before the condition; `if n, err := strconv.Atoi(s); err == nil { … }` keeps `n` and `err` local to the statement ✅[^2] ✅[^3].
3. **Expression switch.** Case expressions need not be constants; they are evaluated left to right and top to bottom, the first one equal to the switch value runs, and the rest are skipped ✅[^2]. A case may list several values (`case 1, 2:`) ✅[^1].
4. **No implicit fall-through.** Control leaves the `switch` at the end of a case, unless the case's last statement is `fallthrough`, which jumps to the first statement of the next case without testing it ✅[^2]. `fallthrough` in the last case is a compile error (`cannot fallthrough final case in switch`) ✅[^1].
5. **Tagless switch.** A missing switch expression means `true`, so the first case whose condition is true runs; Effective Go calls this the idiomatic way to write an if-else-if chain ✅[^2] ✅[^3].
6. **`break` in a `switch`** ends the `switch` (or `select`), not an enclosing `for` loop ✅[^2]; in the lab a `break` inside a `switch` inside a five-pass loop still counted 5 passes ✅[^1].

### `for` and `range`
1. **Three forms.** `for init; cond; post { }` (C style), `for cond { }` (a while loop) and `for { }` (forever); Go has no `while` or `do` keyword ✅[^2] ✅[^3].
2. **Per-iteration variables (Go 1.22).** Each iteration of a three-clause loop has its own copy of the declared variable: the next copy is created before the post statement runs and starts with the previous copy's value ✅[^2] ✅[^4]. Before Go 1.22 all iterations shared one variable ✅[^2]. The new meaning applies only to packages in modules whose `go.mod` declares `go 1.22` or later, and a file can opt in with a `//go:build go1.22` line ✅[^5]. Variables declared by `range` with `:=` follow the same rule ✅[^2].
3. **`range` over values.**

   | Range over | First value | Second value |
   |---|---|---|
   | array, pointer to array, slice | index `int` | element ✅[^2] |
   | string | byte index of each code point | the code point, a `rune` ✅[^2] |
   | map | key | value, in an unspecified order ✅[^2] |
   | channel | each received element, until the channel is closed ✅[^2] | — |
   | integer `n` (Go 1.22) | 0 to n-1 ✅[^2] ✅[^4] | — |
   | function `func(yield func(…) bool)` (Go 1.23) | see `go/standard-library/iterators.md` ✅[^2] | |

   Ranging over `"héllo"` gave the indexes `0 1 3 4 5`, because `é` takes two bytes in UTF-8 (Unicode Transformation Format, 8-bit) ✅[^1]. A `for i := range n` with `n <= 0` runs no iterations ✅[^2], and `for range 2 { }` simply repeats twice ✅[^1].
4. **Labels.** `break Label` and `continue Label` name an enclosing `for` (or, for `break`, a `switch` or `select`) ✅[^2]. A label must be used: `label unused defined and not used` ✅[^1] ✅[^2].
5. **`goto`** jumps to a label in the same function, but may not jump over a variable declaration or into a block ✅[^2]; Go 1.27.4 reports `goto L jumps over declaration of v` ✅[^1].

### Functions
1. **Signatures.** A function type lists parameters and results; the zero value of a function variable is `nil` ✅[^2].
2. **Multiple results.** A function may return several values, which Go uses to return a result together with an `error` ✅[^3].
3. **Named results** are ordinary local variables, set to their zero values on entry; a bare `return` returns their current values ✅[^2] ✅[^3].
4. **Variadic parameters.** A final parameter `p ...T` is a `[]T` inside the function. With no arguments it is `nil`; with arguments it is a new slice; with `s...` the caller's slice is passed unchanged, so the callee writes into the caller's array ✅[^2]. In the lab, `sum()` saw `nums == nil`, and `zeroFirst(s...)` turned `[9 9]` into `[0 9]` ✅[^1].
5. **Function literals and closures.** A function literal (an anonymous `func`) can be stored or called directly. It is a closure: it shares the variables of the surrounding function, and they live as long as the closure can reach them ✅[^2]. A `counter()` that returns `func() int { n++; return n }` produced `1 2 3` from one `n` ✅[^1].

### `defer`
Three actors take part:
- **The `defer` statement** — its job: evaluate the function value and its arguments now, via normal expression evaluation, and save the call.
- **The surrounding function** — its job: finish, via a `return` statement, the end of its body, or a panic.
- **The deferred calls** — their job: run in reverse order, via the runtime, after result values are set and before the caller resumes.

```
func triple() (result int) {
    defer func() { result *= 7 }()   ① saved now, runs later
    return 6                          ② result = 6
}                                     ③ deferred call: result = 42
                                      ④ caller receives 42
```

1. **`defer` statement (when it runs):** the function value and its parameters are evaluated and saved, but the call does not run yet ✅[^2]. Effective Go adds that the receiver of a method call is evaluated then too ✅[^3].
2. **Surrounding function returns:** a `return` with values first sets the result parameters ✅[^2].
3. **Deferred calls:** they run immediately before the function returns, in the reverse order of their `defer` statements; a deferred function literal can read and change named results ✅[^2]. `triple()` above returned `42` in the lab ✅[^1].
4. **Panics:** deferred calls also run when the goroutine is panicking, which is how `recover` works (see `go/errors/panic-and-recover.md`) ✅[^2].
5. **Nil function:** a deferred `nil` function value panics when it is called at return time, not at the `defer` statement ✅[^2]; the lab printed the next line first, then `invalid memory address or nil pointer dereference` ✅[^1].

## Worked example
One `main` from the lab that exercises the rules above, with its real output ✅[^1]:
```go
func divmod(a, b int) (q, r int, err error) {
	if b == 0 {
		err = errors.New("division by zero")
		return // q and r keep their zero values
	}
	q, r = a/b, a%b
	return
}

func deferArgs() {
	x := 1
	defer fmt.Println("  deferred sees x =", x)
	x = 2
	fmt.Println("  body sets x =", x)
}

func main() {
	fmt.Println(divmod(17, 5))
	fmt.Println(divmod(1, 0))
	for i := 0; i <= 3; i++ {
		defer fmt.Print(i, " ")
	}
	deferArgs()
	fmt.Print("main returns, deferred loop prints: ")
}
```

| Step | What runs | Output |
|---|---|---|
| 1 | `divmod(17, 5)` sets `q, r` and returns bare | `3 2 <nil>` ✅[^1] |
| 2 | `divmod(1, 0)` sets only `err` | `0 0 division by zero` ✅[^1] |
| 3 | The loop saves four deferred `fmt.Print` calls with `i` = 0, 1, 2, 3 copied at each `defer` | nothing yet |
| 4 | `deferArgs` saves `x = 1`, then sets `x = 2` | `  body sets x = 2` then, at its return, `  deferred sees x = 1` ✅[^1] |
| 5 | `main` prints its last line, then returns; the four saved calls run last-in first-out | `main returns, deferred loop prints: 3 2 1 0` ✅[^1] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Closures created in a loop, module declares `go 1.21` | All see the final value (`6 6 6` in the spec example) ✅[^1] | One variable for the whole loop before Go 1.22 ✅[^2] |
| `for i := range 3` in a module declaring `go 1.21` | Compile error: `cannot range over 3 (untyped int constant): requires go1.22 or later` ✅[^1] | Range over integers is a Go 1.22 language feature ✅[^4] |
| `defer f.Close()` inside a loop over many files | Every file stays open until the function returns | Deferred calls run when the surrounding *function* returns, not at the end of the loop body ✅[^2] |
| Bare `return` while a named result is shadowed by an inner `:=` | Compile error (`result parameter err not in scope at return`) | Implementations may reject it ✅[^2]; see `go/fundamentals/declarations-types-and-constants.md` |
| Deferred function returns values | The values are discarded ✅[^2] | Nothing receives them |
| Map range order | Not specified and may differ between runs ✅[^2] | Sort the keys when order matters |
| Range over a string with invalid UTF-8 | The rune is `0xFFFD` and iteration advances one byte ✅[^2] | Each bad byte becomes the replacement character |
| Range over a `nil` channel | Blocks forever ✅[^2] | A nil channel never delivers a value |
| `go vet` on the `go 1.21` closure example | Passed with no report ✅[^1] | vet's loop-variable check does not catch every shared-variable case ✅[^5] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Tagless `switch` instead of `if`/`else if` | Flat, readable chain of conditions | One more construct for newcomers to learn |
| `fallthrough` | Reuses the next case's body | Easy to misread; the next case's condition is not tested |
| Named results with bare `return` | Documents what each result is; lets `defer` change them | Long functions with bare returns are harder to follow |
| `defer` for clean-up | Runs on every return path and on panic | Runs at function end only; a small call overhead per `defer` |
| Labels and `goto` | Exit nested loops directly | Harder to follow than a helper function with `return` |

## Takeaways
- Put `defer x.Close()` right after a successful open, and move per-item work in long loops into a helper function so each `defer` runs per item. [rule-candidate]
- Upgrade the module's `go` line to 1.22 or later to get per-iteration loop variables; do not keep `i := i` copies in new code. [rule-candidate]
- Prefer a tagless `switch` over long if-else chains; use `fallthrough` only with a comment explaining why.
- Remember that a `defer` copies its arguments immediately: wrap the call in a closure when it must see the final value.

## Verification status
- Verified: 68 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §If statements, §Switch statements, §Expression switches, §For statements (with for clause, with range clause), §Label scopes, §Break, §Continue, §Goto, §Fallthrough, §Return and §Defer statements, §Function types, §Function literals, §Passing arguments to ... parameters. [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Control structures (If, For, Switch), §Functions (multiple return values, named result parameters, defer). [^3]
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22) — Go team, 2024. Rank 1. Backs: per-iteration loop variables and range over integers. [^4]
- [Fixing For Loops in Go 1.22](https://go.dev/blog/loopvar-preview) — David Chase and Russ Cox, Go blog, 2023. Rank 4. Backs: the new loop semantics apply per module (`go 1.22` in `go.mod`) or per file (`//go:build`); the loopclosure analyzer misses cases. [^5]

## Related
- `go/learning-path.md` — where this doc sits in the learning order.
- `go/fundamentals/declarations-types-and-constants.md` — declarations, `:=` and shadowing.
- `go/methods-interfaces/interfaces.md` — type switches.
- `go/standard-library/iterators.md` — range over functions.
- `go/errors/panic-and-recover.md` — `defer` with `panic` and `recover`.
- `go/introduction/toolchain-and-compatibility.md` — how the `go` line switches language features per module.
