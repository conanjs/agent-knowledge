---
schema: knowledge-doc/v1
type: concept
topic: go/concurrency
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "WithCancelCause/Cause: Go ≥ 1.20", "AfterFunc, WithoutCancel, With*Cause: Go ≥ 1.21", "testing T.Context: Go ≥ 1.24"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, context, cancellation, deadline, timeout, cause, afterfunc, withoutcancel, lostcancel, go-vet, t-context]
ranked-sources: true
---

# `context`: deadlines, cancellation and request-scoped values

## Summary
**TL;DR:** A `context.Context` carries a deadline, a cancellation signal and a few request-scoped values down a call chain. Contexts form a tree: cancelling one cancels every context derived from it, never its parent. Work stops only if it watches `ctx.Done()` and returns `ctx.Err()`. Always call the `cancel` function you get back (`go vet` checks this), pass the context as the first parameter named `ctx`, and keep values for request data, not for optional parameters. `WithCancelCause` (Go 1.20) records why; `AfterFunc` and `WithoutCancel` (Go 1.21) run cleanup on cancellation and detach work from it; `t.Context()` (Go 1.24) gives tests a context cancelled before cleanup.
**Use this when:** adding a timeout to a call, stopping goroutines when a request ends, deciding where a `ctx` parameter goes, reading `context deadline exceeded`, or fixing a vet `lostcancel` report.
**Not this doc:** using `ctx.Done()` inside pipelines and worker pools → `go/concurrency/patterns-and-goroutine-leaks.md`; `select` and timers → `go/concurrency/goroutines-and-channels.md`; giving every task an owner, across languages → `concurrency/structured-concurrency.md`.

## Problem
A request is abandoned by the client, but the database query, the two backend calls and the goroutines started for them keep running and holding resources. Without a shared signal each function needs its own `done` channel and timeout parameter. With `context`, the signal exists, but only helps when every function on the path accepts it, passes it on, checks it, and when every `cancel` is called.

## Mental model
**Analogy:** a context is the job ticket stapled to a work order. Every subcontractor gets a copy of the ticket. It states the deadline, carries a few labels (a request identifier, ID), and has a red "stop" lamp. When a ticket's lamp lights, the lamp on every copy made from that ticket lights too, but never the lamp on the ticket it was copied from. A worker who never looks at the lamp keeps working anyway.

**Artifact:** a context tree, run on Go 1.27.4 ✅[^1]:
```go
root, cancelRoot := context.WithCancel(context.Background())
child, cancelChild := context.WithTimeout(root, time.Hour)
defer cancelChild()
withID := context.WithValue(child, requestIDKey, "req-7")
detached := context.WithoutCancel(withID)
ran := make(chan struct{})
stop := context.AfterFunc(child, func() { close(ran) })

cancelRoot() // cancels root and everything derived from it
<-ran
// child.Err:    context canceled
// withID value: req-7   withID.Err: context canceled
// detached.Err: <nil>   detached.Done is nil: true   detached keeps values: req-7
// AfterFunc stop() after it ran: false
```
```
Background ── root (WithCancel) ── child (WithTimeout 1h) ─┬─ withID (WithValue) ── detached (WithoutCancel)
     ▲ never cancelled      ▲ cancelRoot() lights here       │   cancelled with child      not cancelled, keeps values
                                                             └─ AfterFunc(child, f): f runs in its own goroutine
```

## How it works
**The interface.** `Context` has four methods ✅[^2]:
- `Deadline()` returns the deadline and `ok == false` when there is none.
- `Done()` returns a channel that is closed when work should stop; it may return nil if the context can never be cancelled.
- `Err()` is nil until `Done` is closed, then `DeadlineExceeded` if the deadline passed or `Canceled` otherwise.
- `Value(key)` returns the value stored for `key`, or nil.

In the lab, `context.Background().Done()` returned nil ✅[^1]. A context has no `Cancel` method for the same reason `Done` is receive-only: the function that receives a cancellation signal is usually not the one that sends it, and sub-operations should not be able to cancel their parent ✅[^7].

**Roots.** `Background()` is never cancelled and has no values or deadline; it is for `main`, initialisation, tests, and as the top context of an incoming request ✅[^2]. `TODO()` is the same empty context, used where it is not yet clear which context to pass ✅[^2].

**Deriving and cancelling** — 3 actors:
- **Caller** — its job: create the child and own its `cancel`, via `context.WithCancel`, `WithTimeout` or `WithDeadline`.
- **Context tree** — its job: close `Done` on the child and all its descendants, via the parent's record of its children.
- **Worker** — its job: stop when told, via `select` on `ctx.Done()` and returning `ctx.Err()`.

1. **Caller:** `WithCancel`, `WithDeadline` and `WithTimeout` take a parent and return a child plus a `CancelFunc` ✅[^2]. `WithTimeout(parent, d)` is `WithDeadline(parent, time.Now().Add(d))`, and a child's deadline is never later than its parent's ✅[^2].
2. **Context tree:** the child's `Done` closes when its `cancel` is called, when its deadline passes, or when the parent's `Done` closes, whichever is first; cancelling a context cancels all contexts derived from it ✅[^2]. Calling `cancel` also removes the parent's reference to the child and stops its timers ✅[^2].
3. **Worker:** nothing stops by itself. The worker must check `ctx.Done()`, for example in a `select`, and return `ctx.Err()` ✅[^2].
4. **Caller again:** a `CancelFunc` does not wait for the work to stop, may be called from several goroutines, and does nothing after its first call ✅[^2]. Not calling it leaks the child until the parent is cancelled; `go vet` checks that cancel functions are used on all paths ✅[^2]. On `ctx, _ := context.WithTimeout(...)` vet reported `the cancel function returned by context.WithTimeout should be called, not discarded, to avoid a context leak` ✅[^1] ✅[^6].

**Causes (Go 1.20 and 1.21).** `WithCancelCause` returns a `CancelCauseFunc` that takes an error; `Err()` still says `Canceled`, while `context.Cause(ctx)` returns that error ✅[^2]. `WithDeadlineCause` and `WithTimeoutCause` (Go 1.21) set the cause used when the time runs out ✅[^2] ✅[^4]. The first cancellation of a context or one of its parents sets the cause; with no cause given, `Cause` returns the same value as `Err()` ✅[^2]. Lab output ✅[^1]:
```go
ctx, cancel := context.WithCancelCause(context.Background())
cancel(errQuota)                               // errQuota = errors.New("quota exceeded")
cancel(errors.New("second cause is ignored"))
fmt.Println(ctx.Err())            // context canceled
fmt.Println(context.Cause(ctx))   // quota exceeded
```

**`AfterFunc` (Go 1.21).** `AfterFunc(ctx, f)` runs `f` in its own goroutine after `ctx` is cancelled, or at once if it already is ✅[^2] ✅[^4]. The returned `stop` reports whether it prevented `f` from running, and does not wait for `f` to finish ✅[^2]; after `f` had run, `stop()` returned false in the lab ✅[^1].

**`WithoutCancel` (Go 1.21).** The derived context points to its parent but is not cancelled with it: it has no deadline and no error, its `Done` channel is nil, and `Cause` returns nil ✅[^2] ✅[^4]. It still reads the parent's values: `detached.Value(requestIDKey)` returned `req-7` after the parent was cancelled ✅[^1]. Use it for work that must finish after the request ends, such as writing an audit record.

**Values.** Use them only for request-scoped data that crosses processes and application programming interfaces (APIs), not to pass optional parameters ✅[^2]. A key can be any comparable type; packages should define an unexported key type to avoid collisions and offer type-safe accessor functions ✅[^2]. Values must be safe for use by several goroutines at once ✅[^7].

**Conventions.** Do not store a context in a struct; pass it explicitly as the first parameter, usually named `ctx` ✅[^2]. Never pass a nil context; pass `context.TODO()` when unsure ✅[^2]. One context may be shared by many goroutines ✅[^2]. Incoming server requests should create a context and outgoing calls should accept one, and the chain between them must pass it along ✅[^2].

**Tests (Go 1.24).** `t.Context()` and `b.Context()` return a context that is cancelled just before the functions registered with `Cleanup` run ✅[^3] ✅[^5]. In the lab, `ctx.Err()` was nil during the test and `context canceled` inside the cleanup function ✅[^1].

## Worked example
A query helper that respects a 50 ms timeout (Go 1.27.4 ✅[^1]):
```go
func slowQuery(ctx context.Context, d time.Duration) (string, error) {
	select {
	case <-time.After(d):
		return "rows", nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
defer cancel()
res, err := slowQuery(ctx, 200*time.Millisecond)
```

| Step | Actor | What happens | Value |
|---|---|---|---|
| 1 | Caller | `WithTimeout` derives a child of `Background` | `ctx.Deadline()` → `ok == true`, about 50 ms ahead |
| 2 | Worker | `slowQuery` waits on a 200 ms timer and on `ctx.Done()` | — |
| 3 | Context tree | The deadline passes and `Done` closes | at about 50 ms |
| 4 | Worker | The `ctx.Done()` case wins and returns `ctx.Err()` | `res=""`, `err=context deadline exceeded` |
| 5 | Caller | Checks the error | `err == context.DeadlineExceeded` → `true` |
| 6 | Caller | Deferred `cancel()` runs on return | releases the timer even though the deadline already fired |

Two runs both returned after 50 ms (rounded to 10 ms); three later runs returned after 50, 50 and 60 ms, so read the figure as "about 50 ms".

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Function never looks at `ctx` | It runs to completion after cancellation | Cancellation is a signal, not a kill ✅[^2] |
| `cancel` never called on a timeout that fired | Still worth calling | The package example calls it "good practice" so the context and its parent are not kept alive longer than needed ✅[^2] |
| `WithDeadline` later than the parent's deadline | Same as the parent | A child's deadline is never later ✅[^2] |
| `Err()` read right after `cancel()` returns | `Done` may still be closing | The close of `Done` may happen asynchronously, after `cancel` returns ✅[^2] |
| Cause set twice | The first one wins | `CancelCauseFunc` does not overwrite an existing cause ✅[^2] ✅[^1] |
| `Cause` on a context cancelled with plain `cancel()` | Returns `context canceled` | `Cause` falls back to `Err()` ✅[^2] ✅[^1] |
| Background job started from a request handler with the request's `ctx` | Killed when the handler returns | The request's context is cancelled when it ends; detach with `WithoutCancel` ✅[^7] ✅[^2] |
| Optional settings passed through `WithValue` | Hidden, untyped dependencies | Values are for request-scoped data only ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `ctx` parameter on every call path | One standard signal for timeouts and cancellation across packages ✅[^7] | Every signature grows a parameter |
| Own `done` channel | Fine inside one package | Does not compose with library calls that take a `ctx` |
| `WithCancelCause` | The reason survives (`Cause`) | Callers must call `context.Cause`, not only `Err` |
| `WithoutCancel` | Work outlives the request | That work needs its own timeout, or it can run forever |

## Takeaways
- Write `ctx, cancel := context.WithTimeout(...)` followed by `defer cancel()` on the next line, every time. [rule-candidate]
- Take `ctx context.Context` as the first parameter of any function that blocks, calls the network or starts goroutines; never store it in a struct. [rule-candidate]
- Every blocking wait in a goroutine should also wait on `<-ctx.Done()` and return `ctx.Err()`. [rule-candidate]
- Keep `WithValue` for request-scoped data with an unexported key type; never for configuration or optional parameters. [rule-candidate]
- Use `t.Context()` in tests (Go 1.24+) instead of `context.Background()`, so goroutines a test starts are cancelled before its cleanup.

## Verification status
- Verified: 50 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Package context](https://pkg.go.dev/context) — Go team, living. Rank 1. Backs: the interface; `Background`, `TODO`; `WithCancel`, `WithDeadline`, `WithTimeout`; `CancelFunc`; causes; `AfterFunc`; `WithoutCancel`; values and keys; the usage rules; vet's check. [^2]
- [Package testing](https://pkg.go.dev/testing) — Go team, living. Rank 1. Backs: `T.Context` and `B.Context`. [^3]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: `WithoutCancel`, `WithDeadlineCause`, `WithTimeoutCause`, `AfterFunc` are new in 1.21. [^4]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: `T.Context` and `B.Context` are new in 1.24. [^5]
- [Command vet](https://pkg.go.dev/cmd/vet) — Go team, living. Rank 1. Backs: the `lostcancel` check. [^6]
- [Go Concurrency Patterns: Context](https://go.dev/blog/context) — Go team, 2014. Rank 4. Backs: why a context has no `Cancel` method; values must be safe for concurrent use; a request's context is cancelled when the handler returns; one signal across many teams' code. [^7]

## Related
- `go/concurrency/goroutines-and-channels.md`
- `go/concurrency/patterns-and-goroutine-leaks.md`
- `go/standard-library/net-http.md` — request contexts in HTTP servers and clients.
- `go/tooling/testing-benchmarks-and-fuzzing.md` — `t.Context` and `t.Cleanup` in tests.
- `concurrency/structured-concurrency.md`
- `go/learning-path.md`
