---
schema: knowledge-doc/v1
type: concept
topic: go/errors
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "panic(nil) → *runtime.PanicNilError since Go 1.21"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, panic, recover, defer, runtime-error, PanicNilError, goroutine, net-http]
ranked-sources: true
---

# Panic, recover and run-time errors

## Summary
**TL;DR:** `panic` stops the current function and unwinds the goroutine's stack, running deferred calls as it goes; if nothing stops it, the whole program exits, even when the panic happened in a background goroutine. `recover` stops a panic only when it is called *directly* by a deferred function on the panicking goroutine; anywhere else it returns `nil`. Run-time faults (index out of range, nil map write, nil dereference) panic with a value that implements `runtime.Error`. Use errors for expected failures and keep panics for impossible states or failed initialization, and never let a panic cross a package's API (application programming interface).
**Use this when:** a program crashed with `panic:` and a goroutine trace, you want a server or worker to survive one bad request or job, `recover()` "does nothing", or you are deciding between returning an error and panicking.
**Not this doc:** ordinary error values and wrapping → `go/errors/errors-and-wrapping.md`; `defer` as a statement in normal control flow → `go/fundamentals/control-flow-and-functions.md`; HTTP (Hypertext Transfer Protocol) servers in general → `go/standard-library/net-http.md`.

## Problem
A worker goroutine dereferences a nil pointer and the whole service exits without running the `defer` cleanups that `main` had registered. A developer moves `recover()` into a helper function to share logging code, and panics are no longer caught. Another writes `panic(nil)` as a "silent abort" and finds, since Go 1.21, that `recover` returns a `*runtime.PanicNilError` instead of `nil`. These follow from a few precise rules.

## Mental model
**Analogy:** a panic is a fire alarm in one building (one goroutine). Everyone leaves floor by floor, and on each floor the deferred tasks (turn off the stove, close the doors) still run. On any floor a fire warden (a deferred function that calls `recover` itself) can declare "false alarm" and normal work resumes from that floor down. If the alarm reaches the ground floor with no warden, the whole city (the process) is shut down, not just that building.

**Artifact:** a division that turns a run-time panic into an error, run in Go 1.27.4 ✅[^1]:
```go
func safeDiv(a, b int) (q int, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("recovered: %v", r) // a deferred call may set named results
		}
	}()
	return a / b, nil
}

fmt.Println(safeDiv(7, 2)) // 3 <nil>
fmt.Println(safeDiv(7, 0)) // 0 recovered: runtime error: integer divide by zero
```

## How it works
1. **Panicking.** An explicit `panic` or a run-time panic ends the current function `F`; `F`'s deferred functions run, then those of `F`'s caller, and so on up to the top-level function of the goroutine; then the program is terminated and the panic value is reported ✅[^2]. Deferred calls run in reverse order of their `defer` statements, also while panicking ✅[^2] ✅[^1].
2. **Recovering.** If a function `G` defers a function `D` that calls `recover`, and a panic occurs on the same goroutine, then `D`'s call to `recover` returns the panic value; if `D` returns normally, the panic stops, the frames between `G` and the panic are discarded, the rest of `G`'s deferred calls run, and `G` returns to its caller ✅[^2]. A deferred closure can still change `G`'s named results at that point, which is how `safeDiv` returns an error ✅[^2].
3. **Where `recover` works.** `recover` returns `nil` when the goroutine is not panicking or when it was not called directly by a deferred function ✅[^2]. Because of that, deferred code can call library routines that use `panic` and `recover` themselves without being affected ✅[^4].
4. **`panic(nil)` since Go 1.21.** When a goroutine is panicking and `recover` is called directly by a deferred function, the result is guaranteed to be non-nil; to make that true, `panic(nil)` causes a run-time panic of type `*runtime.PanicNilError` ✅[^2] ✅[^5]. `GODEBUG=panicnil=1` restores the old behaviour, and it is set automatically for a main package whose module declares `go 1.20` or earlier ✅[^5].
5. **Run-time panics.** Execution errors such as an out-of-range index cause a panic whose value has the implementation-defined interface type `runtime.Error`, which satisfies `error`; the exact values for each condition are unspecified ✅[^2]. A type counts as a run-time error if it has a `RuntimeError()` method ✅[^6].
6. **When to panic.** Report ordinary failures by returning an `error`; real library functions should avoid `panic`, and it is better to keep running than to take the whole program down ✅[^4]. Panicking can be reasonable when something impossible has happened or when a library truly cannot initialize itself ✅[^4]. A package may use `panic` internally, but its external API should still return errors ✅[^7] ✅[^4].
7. **Recovering per unit of work.** A common use of `recover` is to let one failing goroutine of a server exit cleanly without disturbing the others: a deferred function logs the recovered value ✅[^4]. The `net/http` server does this for handlers: if `ServeHTTP` panics, it assumes the panic affected only that request, recovers it, logs a stack trace, and closes the connection (or resets the HTTP/2 stream); panicking with `http.ErrAbortHandler` aborts the response without the log ✅[^8].
8. **Re-panicking.** A deferred function may call `panic` again after `recover`, for example with added context; the crash report then shows both the original and the new failure ✅[^4] ✅[^1].

## Worked example
One program exercising every rule, run in Go 1.27.4 ✅[^1]:
```go
func kind(f func()) (msg string) {
	defer func() {
		r := recover()
		var re runtime.Error
		if e, ok := r.(error); ok && errors.As(e, &re) {
			msg = fmt.Sprintf("runtime.Error %T: %v", r, re)
			return
		}
		msg = fmt.Sprintf("plain value %T: %v", r, r)
	}()
	f()
	return "no panic"
}

var s []int
var m map[string]int
var p *struct{ x int }
kind(func() { _ = s[3] })
kind(func() { m["a"] = 1 })
kind(func() { _ = p.x })
kind(func() { panic("custom") })
kind(func() { panic(nil) })
```
| Panic source | `kind` returns | Rule |
|---|---|---|
| `s[3]` on an empty slice | `runtime.Error runtime.boundsError: runtime error: index out of range [3] with length 0` ✅[^1] | Run-time panic value implements `runtime.Error` ✅[^2] |
| Write to a nil map | `runtime.Error runtime.plainError: assignment to entry in nil map` ✅[^1] | Same; the concrete type is unspecified ✅[^2] |
| `p.x` with `p == nil` | `runtime.Error runtime.errorString: runtime error: invalid memory address or nil pointer dereference` ✅[^1] | Same ✅[^2] |
| `panic("custom")` | `plain value string: custom` ✅[^1] | Any value can be a panic value ✅[^2] |
| `panic(nil)` | `runtime.Error *runtime.PanicNilError: runtime error: panic called with nil argument` ✅[^1] | Go 1.21 rule ✅[^5] |

Three more checks from the same run ✅[^1]:

| Code | Output |
|---|---|
| `defer fmt.Println("deferred 1")`, `defer fmt.Println("deferred 2")`, `defer func(){ fmt.Println("recover:", recover()) }()`, then `panic("boom")` | `recover: boom`, `deferred 2`, `deferred 1`: reverse order, recovery first because it was deferred last |
| A deferred closure calls `helper()`, and `helper` calls `recover()` | `helper`'s `recover()` prints `<nil>` and the panic keeps going to the next frame's deferred `recover` |
| Inner deferred function recovers `"first"` and calls `panic("again: first")` | The outer deferred function recovers `again: first` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A goroutine started with `go` panics and nothing recovers it | The process prints `panic: worker failed` and the goroutine trace and exits with status 2; `main`'s deferred `fmt.Println` never runs ✅[^1] | Panicking runs only the deferred calls of the panicking goroutine, then terminates the program ✅[^2] |
| `recover()` called outside any panic | Returns `nil` ✅[^1] | Not panicking ✅[^2] |
| `recover()` inside a helper called by the deferred function | Returns `nil`; the panic continues ✅[^1] | Not called directly by the deferred function ✅[^2] |
| A handler passed to `httptest.NewServer` panics on `/panic` | The client's `http.Get` gets `EOF`; the server logs `http: panic serving …: handler bug` with a trace; the next request still gets `200 ok` ✅[^1] | `net/http` recovers handler panics per request and closes that connection ✅[^8] |
| A deferred function value is `nil` | Panics when the deferred call is invoked, not at the `defer` statement | Spec rule for `defer` ✅[^2] |
| A failed type assertion `x.(T)` | Panics, like an out-of-bounds index | Both are implicit panics ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Return an `error` | The caller decides; visible in the signature ✅[^4] | One `if err != nil` per call site |
| `panic` for impossible states or failed init | Stops a program that cannot be correct ✅[^4] | Crashes everything unless a caller recovers |
| `recover` at a goroutine or request boundary | One bad job or request does not kill the process ✅[^4] ✅[^8] | Only the panicking goroutine's own deferred calls run ✅[^2], so any cleanup of shared state must already be deferred there |
| Internal `panic` turned into an error at the API | Simple deep error exits inside a parser ✅[^4] | Must never let the panic escape the package ✅[^7] |

## Takeaways
- Return errors for anything a caller can expect; panic only for programmer errors or impossible states, and convert internal panics to errors before they leave the package. [rule-candidate]
- Every goroutine you start must either be unable to panic or recover at its top; an unrecovered panic there ends the whole process, skipping `main`'s deferred cleanup. [rule-candidate]
- Call `recover()` in the deferred function itself, never in a helper it calls.
- Do not use `panic(nil)`; since Go 1.21 it is a `*runtime.PanicNilError`, not a silent value.

## Verification status
- Verified: 50 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §Handling panics, §Run-time panics, §Defer statements (order, named results, nil deferred function). [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Panic (when to panic, init), §Recover (unwinding, per-goroutine recovery, re-panic, internal use only). [^4]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: `panic(nil)` and `GODEBUG=panicnil=1`. [^5]
- [Package runtime](https://pkg.go.dev/runtime) — Go team, living. Rank 1. Backs: `runtime.Error`, `PanicNilError`. [^6]
- [Package net/http](https://pkg.go.dev/net/http) — Go team, living. Rank 1. Backs: the server recovers handler panics; `ErrAbortHandler`. [^8]
- [Defer, Panic, and Recover](https://go.dev/blog/defer-panic-and-recover) — Go team, 2010. Rank 4. Backs: library convention: internal panics, external error returns. [^7]

## Related
- `go/errors/errors-and-wrapping.md` — the normal error path.
- `go/fundamentals/control-flow-and-functions.md` — `defer` and named results.
- `go/concurrency/goroutines-and-channels.md` — starting goroutines and reporting their failures.
- `go/standard-library/net-http.md` — handlers and servers.
- `error-handling/handle-errors-once.md` — handling at one boundary.
- `go/learning-path.md`
