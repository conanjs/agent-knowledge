---
schema: topic-index/v1
kind: subtopic
topic: go/concurrency
last-updated: 2026-11-24
---

# Go concurrency

Goroutines, channels and `select`; the `sync` and `sync/atomic` packages; `context` for deadlines and cancellation; the Go memory model and the race detector; and the patterns built from them — pipelines, fan-out/fan-in, worker pools, semaphores, first-error cancellation — the `golang.org/x/sync` packages `errgroup`, `semaphore` and `singleflight`, with goroutine leaks, the Go 1.27 `goroutineleak` profile and `testing/synctest`. Every behaviour was run on Go 1.27.4 in `go/lab-setup.md`. Covers Effective Go's "Concurrency" section and the concurrency chapter of A Tour of Go. Not covered: the scheduler that runs goroutines (see `go/runtime/`), cross-language comparisons (see `concurrency/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [goroutines-and-channels.md](goroutines-and-channels.md) | concept | `go` statements, program exit, unbuffered and buffered channels, close/nil/closed rules, directions, `select`, timeouts, Go 1.23 timer channels and the Go 1.27 removal of `asynctimerchan`, the deadlock error | verified |
| [sync-and-atomics.md](sync-and-atomics.md) | concept | `Mutex`/`RWMutex` (not reentrant, never copied), `WaitGroup.Go`, `Once` and `OnceValue`, `Cond`, `sync.Map`, `sync.Pool`, typed atomics, vet's `copylocks` and `waitgroup` checks | verified |
| [context-and-cancellation.md](context-and-cancellation.md) | concept | The context tree, `WithCancel`/`WithTimeout`/`WithDeadline`, causes, `AfterFunc`, `WithoutCancel`, values, the `ctx` conventions, vet's `lostcancel`, `t.Context` | verified |
| [memory-model-and-data-races.md](memory-model-and-data-races.md) | concept | Happens-before, every synchronization edge, data races and DRF-SC (data-race-free programs are sequentially consistent), what racy programs and compilers may do, idioms that break, the race detector's use, options and cost | verified |
| [patterns-and-goroutine-leaks.md](patterns-and-goroutine-leaks.md) | concept | Pipelines, fan-out/fan-in, bounded parallelism, semaphores, `errgroup` and a standard-library equivalent, finding leaks with the `goroutineleak` profile, `testing/synctest` | verified |
| [errgroup-semaphore-and-singleflight.md](errgroup-semaphore-and-singleflight.md) | concept | `golang.org/x/sync` v0.25.0: `errgroup` (first error, `WithContext` cancel and cause, `SetLimit`/`TryGo`, panics not recovered), `semaphore.Weighted` (weights, first-in-first-out queue, context-aware `Acquire`), `singleflight` (`Do`/`DoChan`/`Forget`, the slow-call risk), and when the standard library is enough | verified |

## References
- [Effective Go: Concurrency](https://go.dev/doc/effective_go#concurrency) — Go team, living. Backs: subtopic scope.
- [The Go Memory Model](https://go.dev/ref/mem) — Go team, 2022. Backs: subtopic scope.

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `go/runtime/` — how the scheduler runs goroutines.
- `concurrency/` — structured concurrency, blocking and shared state across languages.
