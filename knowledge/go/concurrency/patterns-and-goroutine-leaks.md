---
schema: knowledge-doc/v1
type: concept
topic: go/concurrency
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "goroutineleak profile: experiment in Go 1.26, general in Go 1.27", "testing/synctest: Go ≥ 1.25", "WaitGroup.Go: Go ≥ 1.25", "golang.org/x/sync v0.25.0 (errgroup, run in the lab through proxy.golang.org)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, pipeline, fan-out, fan-in, worker-pool, semaphore, bounded-parallelism, errgroup, goroutine-leak, goroutineleak, pprof, synctest]
ranked-sources: true
---

# Concurrency patterns and goroutine leaks

## Summary
**TL;DR:** Most Go concurrency is built from four shapes: a **pipeline** (stages joined by channels), **fan-out/fan-in** (several workers read one channel; one channel merges several), **bounded parallelism** (a fixed pool of workers, or a buffered channel used as a semaphore) and **first error cancels the rest** (`errgroup`, or `WaitGroup.Go` plus a context). Every shape must give each goroutine a way to finish: senders close their outbound channels, and every blocking send or receive also watches a cancellation signal. A goroutine that can never be unblocked is leaked — goroutines are not garbage collected. Go 1.27 can list such goroutines with the `goroutineleak` profile, and `testing/synctest` (Go 1.25) tests timeouts and goroutines with a fake clock.
**Use this when:** splitting work across goroutines, limiting how many run at once, stopping all workers on the first error, hunting a goroutine count that only grows, or testing code that sleeps or times out.
**Not this doc:** channel and `select` rules → `go/concurrency/goroutines-and-channels.md`; `context` itself → `go/concurrency/context-and-cancellation.md`; task ownership across languages → `concurrency/structured-concurrency.md`; test commands and flags → `go/tooling/testing-benchmarks-and-fuzzing.md`.

## Problem
The happy path of concurrent code is easy; the early exit is not. A consumer that stops after the first value, or a collector that returns on the first error, leaves the remaining senders blocked forever. The program keeps running, so there is no deadlock error, only a goroutine count and a memory graph that climb. Starting one goroutine per request without a bound has the opposite failure: unlimited resource use under load.

## Mental model
**Analogy:** a pipeline is an assembly line of rooms joined by hatches. Each room takes parts from the hatch before it, works on them, and pushes results to the hatch after it. When the last room closes early, the rooms upstream keep holding parts at hatches nobody will open again: those workers stand there forever (a leak). The fix is a building-wide "stop" siren — a closed `done` channel or a cancelled context — that every worker listens for while holding a part.

**Artifact:** the leak, and what the Go 1.27.4 leak profile printed ✅[^1]:
```go
func processAll(items []int) ([]int, error) {
	ch := make(chan result) // unbuffered: each sender needs a receiver
	for _, n := range items {
		go func() {
			v, err := work(n)
			ch <- result{v, err} // line 31: the leaked goroutines wait here
		}()
	}
	var out []int
	for range len(items) {
		r := <-ch
		if r.err != nil {
			return nil, r.err // early return: nobody receives the rest
		}
		out = append(out, r.n)
	}
	return out, nil
}
```
```
err: item 1 failed
goroutines alive: 4
goroutineleak profile: total 3
3 @ 0x88198 0x21214 0x20e28 0xdbfdc 0x8dfb4
#	0xdbfdb	main.processAll.func1+0x3b	/src/main.go:31
```

## How it works
**Pipelines.** A pipeline is a series of stages connected by channels; each stage is a group of goroutines running the same function, receiving from inbound channels, working, and sending on outbound channels; the first stage is the source or producer and the last the sink or consumer ✅[^9]. The construction guidelines ✅[^9]:
- Stages close their outbound channels when all sends are done.
- Stages keep receiving from inbound channels until those are closed or the senders are unblocked.

**Fan-out, fan-in.** Several functions reading one channel until it is closed is fan-out, which spreads work over workers; one function merging several inputs onto one channel that closes when all inputs are closed is fan-in ✅[^9].

**Stopping early** — 3 actors:
- **Consumer** — its job: decide to stop, via `cancel()` of a shared context (or `close(done)`).
- **Context / done channel** — its job: broadcast "stop" to any number of goroutines, via a channel that closes.
- **Upstream stage goroutines** — their job: stop sending, via a `select` on `out <- v` and `<-ctx.Done()`.

1. **Consumer:** takes only the values it needs. Without a signal, any stage still trying to send blocks forever — a resource leak, because goroutines are not garbage collected and must exit on their own ✅[^9].
2. **Done channel:** closing a channel is a broadcast, because a receive on a closed channel proceeds at once; this tells an unknown number of goroutines to stop ✅[^9]. The `context` package's `Done` channel is used the same way and its docs point to the pipelines article for examples ✅[^3].
3. **Upstream stages:** every send is wrapped in `select { case out <- v: case <-ctx.Done(): return }`, and `defer close(out)` closes the outbound channel on every return path ✅[^9].
4. A buffer large enough for the unread values also unblocks senders, but choosing its size depends on knowing how many values will be sent and read, which is fragile; the article prefers an explicit signal ✅[^9].

```
gen ──in──▶ sq ─┐
     └─in─▶ sq ─┴─▶ merge ──out──▶ main: <-out once, then cancel()
   every send:  select { case out <- v:   case <-ctx.Done(): return }
```

**Bounded parallelism.**
1. Effective Go's semaphore: a buffered channel of capacity `MaxOutstanding`; each handler sends before working and receives after, so at most that many run at once ✅[^2]. The memory model backs this: the *k*-th receive on a channel of capacity *C* is synchronized before the (*k*+*C*)-th send completes ✅[^10].
2. Starting a goroutine per request and *then* waiting on the semaphore still lets the program consume unlimited resources when requests arrive too fast; acquire the slot before the `go` statement, or start a fixed number of worker goroutines that all read one request channel ✅[^2].
3. The pipelines article bounds a directory digest the same way: a fixed number of goroutines read and digest files instead of one per file ✅[^9].
4. For work limited by the central processing unit (CPU-bound work), size the pool with `runtime.GOMAXPROCS(0)`, which reports the number of cores the program may use at once and honours the user's setting ✅[^2]. Concurrency (structure) is not parallelism (simultaneous execution) ✅[^2].

**Requests that carry their own reply channel ("channels of channels").** A channel is a value like any other, so it can travel inside a message: each request holds a `resultChan`, and the server goroutines that take requests from one shared queue answer on the channel the client brought ✅[^2]. Effective Go presents this as the skeleton of a rate-limited, parallel request–reply system that needs no mutex ✅[^2]. In the lab, three clients sent `{i, 10i, 100i}` to two server goroutines sharing one queue; each client got its own sum (`111`, `222`, `333`), the order of the printed lines changed between runs, and `-race` reported nothing ✅[^1]:
```go
type Request struct {
	args       []int
	f          func([]int) int
	resultChan chan int // the client's private reply channel
}

func handle(queue chan *Request) {
	for req := range queue {
		req.resultChan <- req.f(req.args)
	}
}
// client: req := &Request{args, sum, make(chan int)}; queue <- req; answer := <-req.resultChan
```

**First error cancels the rest.** `golang.org/x/sync/errgroup` (v0.25.0, outside the standard library) ✅[^4]:
- A `Group` is like a `WaitGroup` for tasks that return errors; it should not be reused for different tasks, and a zero `Group` has no limit and does not cancel on error.
- `WithContext(ctx)` returns a group and a derived context that is cancelled the first time a task returns a non-nil error or the first time `Wait` returns.
- `Go(f)` runs `f` in a goroutine and blocks while the group is at its limit; `SetLimit(n)` sets that limit; `TryGo` starts `f` only if under the limit.
- `Wait` waits for all tasks and returns the first non-nil error.

In the lab, with `golang.org/x/sync v0.25.0` downloaded through the module proxy, the `errgroup` version returned the first error at once, with the race detector clean, in 5 of 5 runs ✅[^1]:
```go
func fetchAll(parent context.Context, ids []int) error {
	g, ctx := errgroup.WithContext(parent)
	for _, id := range ids {
		g.Go(func() error { return fetch(ctx, id) })
	}
	return g.Wait()
}
// fetch(2) fails at once; the others would take 1 s but stop on ctx.Done():
// errgroup: err=fetch 2: not found after 0s   (go run -race, golang.org/x/sync v0.25.0)
```
Without the dependency, the same cancel-on-first-error behaviour takes this standard-library code; run in the same program, it printed the same line in the same 5 runs ✅[^1]:
```go
func fetchAll(parent context.Context, ids []int) error {
	ctx, cancel := context.WithCancelCause(parent)
	defer cancel(nil)
	var (
		wg       sync.WaitGroup
		once     sync.Once
		firstErr error
	)
	for _, id := range ids {
		wg.Go(func() {
			if err := fetch(ctx, id); err != nil {
				once.Do(func() { firstErr = err; cancel(err) })
			}
		})
	}
	wg.Wait()
	return firstErr
}
// fetch(2) fails at once; the others would take 1 s but stop on ctx.Done():
// err=fetch 2: not found after 0s   (race detector clean)
```
`SetLimit` and `TryGo` in action, what a panicking task does, `semaphore.Weighted` and `singleflight` are in `go/concurrency/errgroup-semaphore-and-singleflight.md`.

**Finding leaks (Go 1.26 experiment, Go 1.27 general).**
1. A leaked goroutine is one blocked on a concurrency primitive (channel, `sync.Mutex`, `sync.Cond`, …) that can never be unblocked ✅[^7] ✅[^8].
2. The runtime finds them with the garbage collector: if goroutine G waits on primitive P, and P cannot be reached from any runnable goroutine or any goroutine those could unblock, G can never wake ✅[^7] ✅[^8].
3. It can miss leaks on primitives reachable from global variables or from local variables of runnable goroutines ✅[^8].
4. In Go 1.27 the `goroutineleak` profile is in `runtime/pprof` and at the `/debug/pprof/goroutineleak` endpoint of `net/http/pprof`, with no `GOEXPERIMENT` needed ✅[^8] ✅[^5]. In Go 1.26 it needed `GOEXPERIMENT=goroutineleakprofile` ✅[^7].

**Testing with a fake clock (Go 1.25).** `synctest.Test` runs a function in an isolated "bubble" whose `time` package uses a fake clock starting at midnight Coordinated Universal Time (UTC) on 2000-01-01; time moves only when every goroutine in the bubble is durably blocked, and `synctest.Wait` waits until all other goroutines in the bubble are durably blocked ✅[^6]. Channel operations on channels created in the bubble, `time.Sleep`, `sync.Cond.Wait`, and `WaitGroup.Wait` when that group's `Add` was called inside the bubble count as durable blocking; locking a mutex, input/output (I/O) and system calls do not ✅[^6]. The package became generally available in Go 1.25 after an experiment in Go 1.24 ✅[^11]. In the lab, a test of a function with a 10-minute timeout passed in 0.00 s and logged `fake time passed: 10m0s start: 2000-01-01 00:00:00 +0000 UTC` ✅[^1].

## Worked example
The leak in the artifact, found and fixed (Go 1.27.4 ✅[^1]):

| Step | Action | Observed |
|---|---|---|
| 1 | `processAll([]int{1, 20, 30, 40})`: item 1 fails after 1 ms | `err: item 1 failed` |
| 2 | Wait 100 ms so the other three finish `work` and try to send | — |
| 3 | `runtime.NumGoroutine()` | `4`: `main` plus three stuck senders; no deadlock error, because `main` can still run |
| 4 | `pprof.Lookup("goroutineleak").WriteTo(os.Stdout, 1)` | `goroutineleak profile: total 3`, all at `main.go:31`, the send |
| 5 | Fix: `ch := make(chan result, len(items))`, room for every result | `goroutines alive: 1`, `goroutineleak profile: total 0` |

The buffer works here because the number of sends is known when the channel is made; when it is not, pass a context and `select` on `ctx.Done()` around the send, as in the pipeline above. The pipeline version of this lab took one value from two fanned-out `sq` stages and cancelled: the goroutine count was 1 before and 1 after cancel, and it printed `first value: 4` in all 5 runs (the article notes that 4 or 9 can come first) ✅[^1] ✅[^9].

A fixed pool of 3 workers over 10 jobs reached a peak of 3 workers running at once, and a 2-slot semaphore around 6 goroutines a peak of 2 ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Consumer returns early without cancelling | Upstream senders block forever | Goroutines must exit on their own ✅[^9] |
| One goroutine per request, semaphore inside it | Goroutine count still unbounded | Gate creation, not only work ✅[^2] |
| Buffer sized "big enough" to avoid a hang | Breaks when one more value is sent or one fewer is read | Fragile coupling to counts ✅[^9] |
| `errgroup.Group` reused for a second batch | Not supported | A group should not be reused for different tasks ✅[^4] |
| `errgroup` zero value | No cancellation on error | Only `WithContext` cancels ✅[^4] |
| Leak on a channel held in a global variable | May not appear in `goroutineleak` | Reachability-based detection ✅[^8] |
| `synctest` test that waits on a mutex or a socket | Not durably blocked; the fake clock does not advance for it | Those can be unblocked from outside the bubble ✅[^6] |
| Function passed to `WaitGroup.Go` panics | Not allowed | `f` must not panic (see `go/concurrency/sync-and-atomics.md`) ✅[^12] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Fixed worker pool | Bounded goroutines and memory | Pool size to tune; workers idle when work is light |
| Semaphore channel, acquire before `go` | Simple bound on concurrency ✅[^2] | One goroutine per item still created, though bounded |
| `errgroup.WithContext` | First error cancels the rest; limit built in ✅[^4] | A dependency outside the standard library |
| `WaitGroup.Go` + `WithCancelCause` | Standard library only | You write the "first error" bookkeeping |
| Buffered channel sized to the work | No cancellation code | Only correct when the count is known up front ✅[^9] |

## Takeaways
- Every goroutine you start must have a guaranteed exit: its input closes, or it selects on `ctx.Done()` around each blocking send and receive. [rule-candidate]
- Stages close only their own outbound channels, with `defer close(out)`. [rule-candidate]
- Bound concurrency before creating goroutines (fixed pool, or acquire a semaphore slot before `go`). [rule-candidate]
- Watch `runtime.NumGoroutine()` or the `goroutineleak` profile (Go 1.27) in long-running services; a count that only grows is a leak. [rule-candidate]
- Test timeouts and retries with `testing/synctest` instead of real sleeps.

## Verification status
- Verified: 48 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24; the `errgroup` run used `golang.org/x/sync v0.25.0`, downloaded through `proxy.golang.org`. [^1]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: Channels (semaphore, gating goroutine creation, fixed handler pool); Channels of channels (requests with a reply channel); Parallelization (`GOMAXPROCS(0)`, concurrency versus parallelism). [^2]
- [Package context](https://pkg.go.dev/context) — Go team, living. Rank 1. Backs: `Done` used for cancellation, with a pointer to the pipelines article. [^3]
- [Package errgroup](https://pkg.go.dev/golang.org/x/sync/errgroup) — Go team, v0.25.0, 2026. Rank 1. Backs: `Group`, `WithContext`, `Go`, `SetLimit`, `TryGo`, `Wait`. [^4]
- [Package runtime/pprof](https://pkg.go.dev/runtime/pprof) — Go team, living. Rank 1. Backs: the predefined `goroutineleak` profile. [^5]
- [Package testing/synctest](https://pkg.go.dev/testing/synctest) — Go team, living. Rank 1. Backs: bubbles, fake clock, durable blocking, `Wait`, isolation. [^6]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: experimental goroutine leak profile; detection by reachability. [^7]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: goroutine leak profile generally available; its limits; the HTTP endpoint. [^8]
- [The Go Memory Model](https://go.dev/ref/mem) — Go team, 2022. Rank 1. Backs: buffered channel as a counting semaphore. [^10]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: `testing/synctest` generally available after the Go 1.24 experiment. [^11]
- [Package sync](https://pkg.go.dev/sync) — Go team, living. Rank 1. Backs: the function passed to `WaitGroup.Go` must not panic. [^12]
- [Go Concurrency Patterns: Pipelines and cancellation](https://go.dev/blog/pipelines) — Go team, 2014. Rank 4. Backs: pipeline definition and guidelines; fan-out and fan-in; stopping short; goroutines are not garbage collected; closing a channel as a broadcast; fragile buffers; bounded parallelism. [^9]

## Related
- `go/concurrency/goroutines-and-channels.md`
- `go/concurrency/context-and-cancellation.md`
- `go/concurrency/sync-and-atomics.md`
- `go/concurrency/errgroup-semaphore-and-singleflight.md` — `errgroup` limits and panics, weighted semaphores, `singleflight`.
- `go/runtime/profiling-and-diagnostics.md` — collecting and reading profiles.
- `go/tooling/testing-benchmarks-and-fuzzing.md`
- `concurrency/structured-concurrency.md` — scopes that own their tasks, across languages.
- `go/learning-path.md`
