---
schema: knowledge-doc/v1
type: concept
topic: go/concurrency
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "golang.org/x/sync v0.25.0 (the latest version on proxy.golang.org on 2026-11-24; its go.mod needs Go ≥ 1.26.0)", "sync.WaitGroup.Go: Go ≥ 1.25"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, x-sync, errgroup, setlimit, trygo, semaphore, weighted-semaphore, singleflight, duplicate-suppression, cache-stampede, bounded-parallelism]
ranked-sources: true
---

# errgroup, weighted semaphores and singleflight (golang.org/x/sync)

## Summary
**TL;DR:** The module `golang.org/x/sync` adds concurrency tools that the standard library lacks. `errgroup.Group` runs tasks that return errors: `Wait` waits for all of them and returns the first error, `WithContext` also cancels a shared context at that first error, and `SetLimit`/`TryGo` cap how many run at once. `semaphore.Weighted` shares a budget (say 10 units of memory) among callers that each take a different weight, in first-in, first-out order, and gives up when the caller's context ends. `singleflight.Group` merges concurrent calls that use the same key into one call whose result all callers share — so with `Do` they all wait as long as that one call takes. A panic inside an `errgroup` task is not caught: it crashes the program.
**Use this when:** you fan out tasks that can fail and want the first error to stop the rest, you bound work by size rather than by count, you stop a cache miss on a hot key from sending a burst of identical queries, or you weigh these tools against the standard library.
**Not this doc:** pipelines, worker pools, a buffered channel as a semaphore and goroutine leaks → `go/concurrency/patterns-and-goroutine-leaks.md`; `sync.WaitGroup.Go`, `Once` and `OnceValue` → `go/concurrency/sync-and-atomics.md`; `context` itself → `go/concurrency/context-and-cancellation.md`; adding a module with `go get` → `go/packages-modules/modules-and-dependencies.md`.

## Problem
Three needs come up in almost every service, and the standard library answers each one only with code you write yourself:
- **Run several tasks, stop at the first failure, report that failure.** With `sync.WaitGroup` you add a `sync.Once`, a variable for the error and a cancel function by hand (`go/concurrency/patterns-and-goroutine-leaks.md` shows that version).
- **Limit work by size, not by count.** A pool of 4 workers lets in 4 tiny jobs or 4 huge ones alike; it cannot say "at most 10 MB (megabytes) of buffers at once".
- **A cache stampede.** A cache stampede is many requests missing the cache for the same key at the same moment, so each one sends the same slow query to the database — like a whole crowd phoning the same help line about the same outage. One expired key then turns into hundreds of identical queries.

## Mental model
**Analogy:**
- `errgroup` is a team lead with a task board. The lead hands out tasks, at most N at a time (`SetLimit`). The first worker who reports a failure rings the stop bell (the context is cancelled), and that report is the one the lead passes up (`Wait`'s error). The bell is only a signal: each worker must listen for it.
- `semaphore.Weighted` is a car park measured in parking spaces: a car takes 1 space, a coach takes 5. The queue at the gate is strict first come, first served, so a coach waiting at the front keeps the cars behind it waiting even when one car would fit.
- `singleflight` is a library rule of "one copy on order": when ten readers ask for the same missing book, the librarian orders one copy and all ten wait for that delivery. Nothing is kept on the shelf afterwards, and if the delivery van is stuck, all ten wait.

**Artifact:** the three tools in their usual shape; the signatures are those of v0.25.0 ✅[^2] ✅[^4] ✅[^6]:
```go
g, ctx := errgroup.WithContext(parent)    // ctx is cancelled at the first error, or when Wait returns
g.SetLimit(8)                             // at most 8 tasks at once (0: none may start; -1: no limit)
for _, id := range ids {
	g.Go(func() error { return fetch(ctx, id) }) // blocks while 8 tasks are active
}
err := g.Wait()                           // waits for all tasks; returns the first non-nil error

sem := semaphore.NewWeighted(10)          // a budget of 10 units
if err := sem.Acquire(parent, 8); err != nil { return err } // waits in line, or fails with parent.Err()
defer sem.Release(8)

var sf singleflight.Group
v, err, shared := sf.Do("user:42", load)  // concurrent calls with this key share one run of load
```

## How it works
**The module.** `golang.org/x/sync` holds Go concurrency primitives beyond those of the language and of the `sync` and `sync/atomic` packages; its packages are `errgroup`, `semaphore`, `singleflight` and `syncmap` ✅[^8]. In the lab, `go list -m -versions golang.org/x/sync` listed v0.1.0 to v0.25.0, the latest being v0.25.0 from 2026-10-15, whose `go.mod` declares `go 1.26.0` ✅[^1]. Its major version is 0, and a version with major version 0 is unstable, with no compatibility promise ✅[^10], so pin it (`go/packages-modules/modules-and-dependencies.md`).

**errgroup** — 4 actors:
- **Caller** — its job: start tasks and collect the outcome, via `g.Go(f)` and `g.Wait()`.
- **Group** — its job: count the tasks and keep the first error, via a `sync.WaitGroup`, a `sync.Once` and, after `SetLimit`, a buffered channel of tokens ✅[^3].
- **Task goroutines** — their job: do the work and report failure, via `f`'s `error` result.
- **Derived context** — its job: tell every task to stop, via `context.WithCancelCause`, cancelled with the first error as its cause ✅[^3].

```text
caller               Group                                 tasks                      ctx
g.Go(f1..f4) ──▶ token into sem chan (only with SetLimit) ──▶ go f1 … go f4
                                                          f2 returns err
                 errOnce: keep err ◀──────────────────────┘
                 cancel(err) ─────────────────────────────────────────────────────▶ Done() closes
                                                          f1, f3, f4 see Done(), return ctx.Err()
                                                          (not kept: not the first error)
g.Wait() ◀────── wg.Wait() returns; cancel(first err); return first err
```

1. **Caller → Group, `Go`:**
   - With a limit set, `Go` first sends a token into a buffered channel of capacity n, so it blocks while n tasks are active ✅[^3]; the docs state the same rule without the channel ✅[^2].
   - It then adds 1 to its `WaitGroup` and runs `f` in a new goroutine ✅[^3]. The first call to `Go` must happen before a `Wait` ✅[^2].
2. **Task → Group, first error:** when `f` returns a non-nil error, a `sync.Once` stores it, so only the first one is kept ✅[^3]. In the lab, with a zero `Group`, task 1 failed after 10 ms and task 2 after 50 ms, and `Wait` returned `task 1 failed first` ✅[^1].
3. **Group → context, cancel:** a group from `WithContext` cancels its context the first time a task returns an error, or the first time `Wait` returns, whichever comes first ✅[^2]. The first error becomes the context's cause ✅[^3]: in the lab `ctx.Err()` printed `context canceled` and `context.Cause(ctx)` printed `fetch 2: not found` ✅[^1].
4. **Tasks, stopping:** cancelling is only a signal. The lab tasks stopped at once because `fetch` selects on `ctx.Done()`, so four tasks of up to 1 s each finished at once (`0s` after rounding to 100 ms), in each of 5 runs ✅[^1] (how to watch `Done` is in `go/concurrency/context-and-cancellation.md`).
5. **Group → caller, `Wait`:** it blocks until every function passed to `Go` has returned, then returns the first non-nil error, if any ✅[^2]. It cancels the derived context even when no task failed ✅[^3]: a context that printed `<nil>` before `Wait` printed `context canceled` after it, with cause `context canceled` ✅[^1].
6. **The zero `Group`:** valid, with no limit and no cancellation on error ✅[^2]; a `Group` should not be reused for different tasks ✅[^2].
7. **`SetLimit(n)` and `TryGo`:**
   - A negative n means no limit, 0 stops any new goroutine from being added, and the limit must not change while tasks are active ✅[^2]. In v0.25.0 changing it then panics: `errgroup: modify limit while 2 goroutines in the group are still active` ✅[^1] ✅[^3].
   - `TryGo(f)` starts `f` only if the group is below its limit and reports whether it did ✅[^2]. The lab printed `false` with 2 of 2 slots busy, `true` after `Wait`, and `false` after `SetLimit(0)` ✅[^1].
   - With `SetLimit(2)`, six 50 ms tasks never had more than 2 running and took 160–190 ms over 5 runs ✅[^1].
8. **Panics:** the package docs do not mention panics ✅[^2]. In v0.25.0, `Go` does not recover them; a comment in the source explains why it does not pass a panic on to `Wait`: that would delay the crash, turn the stack into a plain value that crash monitors miss, and risk a deadlock that hides the panic ✅[^3]. In the lab a task that panicked killed the program with exit status 2; a deferred `recover` in `main` never ran, and the trace named `golang.org/x/sync/errgroup.(*Group).Go.func1` ✅[^1]. Wrapping each task in a function whose deferred `recover` sets its named `err` result made `Wait` return `task panicked: boom in task` instead, and the other task stopped on `ctx.Done()` ✅[^1].

**semaphore.Weighted.**
1. `NewWeighted(n)` makes a semaphore with a maximum combined weight of n and panics if n is negative ✅[^4]; the lab printed `semaphore: size < 0` ✅[^1].
2. `Acquire(ctx, n)` blocks until n units are free or `ctx` is done; on failure it returns `ctx.Err()` and leaves the semaphore unchanged ✅[^4]. In the lab, `Acquire(1)` with a 50 ms timeout, queued behind a waiter for 5 units (step 4), returned `context deadline exceeded` after 50–60 ms, in each of 11 runs ✅[^1].
3. A context that is already done wins: `Acquire` then fails even when the units are free ✅[^5]. The lab got `context canceled` with 3 of 3 units free ✅[^1].
4. **First in, first out.** Waiters queue in order. `Release` wakes waiters from the front only while the front one fits, and leaves everyone behind it waiting; the source explains that letting small requests jump ahead would starve large ones, such as a writer that needs every unit while readers keep taking one each ✅[^5]. `TryAcquire(n)` takes n units without blocking and reports whether it did ✅[^4]; it also fails while anyone is queued ✅[^5]. In the lab, with 2 units free and a waiter for 5 in the queue, `TryAcquire(1)` returned `false`; `Release(8)` then woke that waiter in under 1 ms ✅[^1].
5. **A weight above the size** can never succeed. `Acquire` does not join the queue, so it blocks nobody else, and returns when `ctx` is done ✅[^5]. `Acquire(11)` on a size-10 semaphore returned `context deadline exceeded`, and `TryAcquire(10)` succeeded right after ✅[^1].
6. `Release(n)` gives back n units ✅[^4]. Releasing more than is held panics with `semaphore: released more than held`, and a negative weight passed to `Acquire`, `TryAcquire` or `Release` panics with `semaphore: n < 0` ✅[^5]; the lab saw both messages, the second from `Acquire(-1)` and `TryAcquire(-1)` ✅[^1].
7. The package's worker-pool example acquires 1 unit before each `go` statement, releases it in the goroutine, and finally acquires all `GOMAXPROCS(0)` units to wait for the last workers; with an `errgroup` doing the waiting, that last `Acquire` can go ✅[^4].

**singleflight.Group** — 3 actors:
- **First caller** — its job: run `fn` for a key, via `Do` (in its own goroutine) or `DoChan` (in a new goroutine) ✅[^7].
- **Duplicate callers** — their job: get the same result without running `fn`, via `Do` or `DoChan` with a key that is in flight ✅[^6].
- **Group** — its job: map each key to its in-flight call and hand its result to everyone, via a mutex-guarded map from key to call, each call with its own `sync.WaitGroup` ✅[^7].

```text
t = 0 ms    A: Do("user:42", load) ── key not in map ──▶ add call; A runs load()
t = 1 ms    B … J: Do("user:42")   ── key in map ──────▶ dups++; wait on the call's WaitGroup
t = 100 ms  load() returns ──▶ key deleted from map ──▶ A and B … J return (v, err, shared = true)
t = 110 ms  K: Do("user:42")       ── key not in map ──▶ K runs load() again: nothing was cached
```

1. **Group (in process), `Do`:** only one execution per key is in flight at a time; a duplicate caller waits for the original and receives the same results, and `shared` reports whether `v` went to more than one caller ✅[^6]. In the lab 10 concurrent callers caused 1 query, and all 10 saw `shared=true`, the first caller included ✅[^1] — the first caller's `shared` is true whenever duplicates joined ✅[^7].
2. **Group, after the call:** the key is deleted when `fn` returns ✅[^7], so the next lone call ran the query again and got `shared=false` ✅[^1]. Two different keys ran their two 100 ms queries side by side, in 100–105 ms ✅[^1].
3. **`DoChan`:** like `Do`, but it returns a channel that receives a `Result{Val, Err, Shared}` when ready; the channel is never closed ✅[^6]. It runs `fn` in a new goroutine ✅[^7], so the caller can `select` on the channel and on its own context.
4. **`Forget(key)`:** later calls for that key run `fn` instead of waiting for the earlier call ✅[^6]. Forgetting a key during an in-flight call made the next `DoChan` start a second query; the two results came from query 1 and query 2, both with `shared=false` ✅[^1].
5. **Panics in `fn`:** the group recovers the panic, wraps the value and the stack in an error, and panics again in every caller of `Do` ✅[^7]. In the lab all three callers recovered a value that is an `error`, whose message starts with the original `db driver bug`, carries the stack, and unwraps to the original error ✅[^1]. When `DoChan` callers wait, the group re-panics in a new goroutine, so that no `recover` can swallow the panic and leave those channels blocked forever ✅[^7]; the lab program crashed with exit status 2 ✅[^1].

## Worked example
A hot key whose query hangs for 2 s, called by 5 requests that each have a 100 ms deadline (Go 1.27.4, x/sync v0.25.0, `-race` clean ✅[^1]):

```go
// slowQuery hangs for 2 s, like a database under lock contention.
// start is reset before each round of 5 callers.
func slowQuery() (any, error) {
	time.Sleep(2 * time.Second)
	fmt.Printf("  slowQuery finished at %v\n", time.Since(start).Round(100*time.Millisecond))
	return "row", nil
}

// getDo: Do has no context parameter, so the caller cannot stop waiting.
func getDo(ctx context.Context) (any, error) {
	v, err, _ := g.Do("hot-key", slowQuery)
	return v, err
}

// getChan: DoChan plus select lets each caller leave at its own deadline.
func getChan(ctx context.Context) (any, error) {
	select {
	case r := <-g.DoChan("hot-key", slowQuery):
		return r.Val, r.Err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
```

| Step | What runs | Observed ✅[^1] |
|---|---|---|
| 1 | 5 goroutines call `getDo`, 1 ms apart, each with a 100 ms timeout | `slowQuery` runs once |
| 2 | The 100 ms deadlines pass | Nothing happens: all 5 callers are still blocked inside `Do` |
| 3 | `slowQuery` returns at 2 s | `slowQuery finished at 2s`; all 5 print `v=row err=<nil> after 2s` |
| 4 | 5 goroutines call `getChan` the same way | `slowQuery` runs once more, for all 5 |
| 5 | The deadlines pass | All 5 print `v=<nil> err=context deadline exceeded after 100ms` |
| 6 | Wait 2 s more | `slowQuery finished at 2s`: the query ran to the end with nobody waiting |

The ten caller lines were the same in 5 runs out of 5. Merging calls saved 4 of 5 queries, but with `Do` every caller inherited the full 2 s of the slow dependency. `DoChan` with `select` gives each caller its own deadline back, yet the shared call keeps running. To bound the call itself, give `slowQuery` its own timeout; `Forget` lets later callers start a fresh call instead of joining the stuck one ✅[^6].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Zero `errgroup.Group`, one task fails | The other tasks run to the end; `Wait` returned after 200–210 ms, not 10 ms ✅[^1] | A zero `Group` does not cancel on error ✅[^2] |
| Several tasks fail | `Wait` returns the error that came first in time ✅[^1] | A `sync.Once` keeps the first error ✅[^3] |
| A task panics | The program crashes; `Wait` never returns ✅[^1] | v0.25.0 does not recover panics, on purpose ✅[^3]; recover inside the task if you must (`go/errors/panic-and-recover.md`) |
| `SetLimit` while tasks run | Panic ✅[^1] | The limit must not change while goroutines are active ✅[^2] |
| `TryGo` at the limit | Returns `false`; `f` never runs ✅[^1] | It starts `f` only below the limit ✅[^2] |
| `Acquire` weight above the size | Waits until `ctx` is done; other callers are not held up ✅[^1] | It skips the queue for a request that can never succeed ✅[^5] |
| Small request behind a big waiter | Waits, and `TryAcquire` fails, although units are free ✅[^1] | Strict first-in, first-out order, against starvation ✅[^5] |
| `Release` more than acquired | Panic `semaphore: released more than held` ✅[^1] | Checked in `Release` ✅[^5] |
| `singleflight.Do` on a slow `fn` | Every caller waits the full time, whatever its context ✅[^1] | `Do` takes no context ✅[^6] |
| `fn` fails | Every duplicate gets the same error | Duplicates receive the same results ✅[^6] |
| `fn` panics while `DoChan` callers wait | Crash that no `recover` can stop ✅[^1] | Re-panicked in a new goroutine, so the waiting channels are never left blocked ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `sync.WaitGroup.Go` (Go 1.25) plus your own first-error code | Standard library only; `Go` starts and counts each task ✅[^9] | You write the `Once`, the error and the cancel (see `go/concurrency/patterns-and-goroutine-leaks.md`); `f` must not panic ✅[^9] |
| `errgroup.WithContext` | First error, cancellation and a limit in one type ✅[^2] | A version-0 dependency; panics not handled ✅[^3] |
| Buffered channel as a semaphore | Standard library; enough when every job counts as 1 (see `go/concurrency/patterns-and-goroutine-leaks.md`) | No weights; waiting with a deadline needs your own `select` |
| `errgroup.SetLimit` | Bounds the goroutines of one group ✅[^2] | Counts tasks, not their size |
| `semaphore.Weighted` | Weights, context-aware `Acquire`, fair order ✅[^4] ✅[^5] | A big waiter holds back small ones ✅[^5] |
| `singleflight.Group` | One call per key in flight ✅[^6] | No caching, no context in `Do`, one slow call holds every waiter ✅[^1] |
| `sync.OnceValue` | One value computed once and then reused, standard library ✅[^9] | One value, no keys, no refresh |

## Takeaways
- Create the group with `errgroup.WithContext`, pass its context to every task, and make each task return on `ctx.Done()`. [rule-candidate]
- An `errgroup` task that may panic needs its own `defer`/`recover` that turns the panic into a returned error; `errgroup` will not catch it. [rule-candidate]
- Use `semaphore.Weighted` only when requests differ in size; for a plain count, `SetLimit` or a buffered channel is enough. [rule-candidate]
- Around a `singleflight` call that can hang, use `DoChan` with a `select` on the caller's context, and give `fn` its own timeout. [rule-candidate]
- Pin `golang.org/x/sync` to an exact version (v0.25.0 here) and read its source when the docs are silent, as they are on panics.

## Verification status
- Verified: 101 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24, with `golang.org/x/sync v0.25.0` downloaded through `proxy.golang.org`: `WithContext` cancel and cause, the zero `Group`, `SetLimit`/`TryGo`, a panicking task and one recovered inside the task, the weighted semaphore's queue, deadlines and panics, `singleflight` `Do`/`DoChan`/`Forget`, its panics and the slow hot key. [^1]
- [errgroup package](https://pkg.go.dev/golang.org/x/sync/errgroup) — Go team, v0.25.0, 2026. Rank 1. Backs: `Group`, the zero value, no reuse, `WithContext`, `Go`, `SetLimit`, `TryGo`, `Wait`; no word on panics. [^2]
- [errgroup.go at v0.25.0](https://github.com/golang/sync/blob/v0.25.0/errgroup/errgroup.go) — Go team, 2026. Rank 1. Backs: the token channel behind `SetLimit`, `sync.Once` for the first error, `WithCancelCause`, cancel in `Wait`, the comment on not propagating panics, the `SetLimit` panic. [^3]
- [semaphore package](https://pkg.go.dev/golang.org/x/sync/semaphore) — Go team, v0.25.0, 2026. Rank 1. Backs: `NewWeighted`, `Acquire`, `TryAcquire`, `Release`, the worker-pool example. [^4]
- [semaphore.go at v0.25.0](https://github.com/golang/sync/blob/v0.25.0/semaphore/semaphore.go) — Go team, 2026. Rank 1. Backs: done context wins, the first-in, first-out queue and the starvation comment, `TryAcquire` failing while waiters queue, weights above the size, the panics. [^5]
- [singleflight package](https://pkg.go.dev/golang.org/x/sync/singleflight) — Go team, v0.25.0, 2026. Rank 1. Backs: `Do` and `shared`, `DoChan` and `Result`, the channel never closed, `Forget`. [^6]
- [singleflight.go at v0.25.0](https://github.com/golang/sync/blob/v0.25.0/singleflight/singleflight.go) — Go team, 2026. Rank 1. Backs: the key-to-call map, `shared` for the first caller, deleting the key, `DoChan` in a new goroutine, panic wrapping and re-panicking. [^7]
- [golang.org/x/sync module](https://pkg.go.dev/golang.org/x/sync) — Go team, v0.25.0, 2026. Rank 1. Backs: the module's purpose and its four packages. [^8]
- [sync package](https://pkg.go.dev/sync) — Go team, living. Rank 1. Backs: `WaitGroup.Go` and its no-panic rule, `OnceValue`. [^9]
- [Go Modules Reference](https://go.dev/ref/mod) — Go team, living. Rank 1. Backs: versions with major version 0 are unstable. [^10]

## Related
- `go/concurrency/patterns-and-goroutine-leaks.md` — pipelines, worker pools, the buffered-channel semaphore and a standard-library `errgroup` stand-in.
- `go/concurrency/sync-and-atomics.md` — `WaitGroup.Go`, `Once`, `OnceValue`.
- `go/concurrency/context-and-cancellation.md` — deadlines, `Done`, `Cause`.
- `go/errors/panic-and-recover.md` — turning a panic into an error inside a task.
- `go/packages-modules/modules-and-dependencies.md` — adding and pinning `golang.org/x/sync`.
- `concurrency/structured-concurrency.md` — task groups that own their tasks, across languages.
- `go/learning-path.md`
