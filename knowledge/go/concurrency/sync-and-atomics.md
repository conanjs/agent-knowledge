---
schema: knowledge-doc/v1
type: concept
topic: go/concurrency
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "WaitGroup.Go and vet's waitgroup check: Go ≥ 1.25", "OnceFunc/OnceValue/OnceValues: Go ≥ 1.21", "typed atomics: Go ≥ 1.19"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, sync, mutex, rwmutex, waitgroup, once, oncevalue, cond, sync-map, sync-pool, atomic, copylocks, go-vet]
ranked-sources: true
---

# `sync` and `sync/atomic`: locks, wait groups, once and atomics

## Summary
**TL;DR:** A `sync.Mutex` lets one goroutine at a time into a critical section; it is not reentrant, must not be copied after first use, and may be unlocked by a different goroutine than the one that locked it. `WaitGroup.Go` (Go 1.25) starts a goroutine and counts it in one call, which removes the classic "`Add` inside the goroutine" bug. `sync.OnceValue` (Go 1.21) runs an initializer once and caches its result, panics included. Typed atomics such as `atomic.Int64` (Go 1.19) are sequentially consistent and fit single counters and flags. `sync.Map` and `sync.Pool` are specialised tools, not defaults. `go vet` catches copied locks and misplaced `Add` calls.
**Use this when:** protecting shared state that a channel would make awkward, waiting for a group of goroutines, initialising something lazily, choosing between a mutex and an atomic, or reading a `go vet` report about locks.
**Not this doc:** channels and `select` → `go/concurrency/goroutines-and-channels.md`; the happens-before rules behind these types → `go/concurrency/memory-model-and-data-races.md`; why shared mutable state needs synchronization at all, across languages → `concurrency/shared-state-and-data-races.md`.

## Problem
Shared counters, caches and "initialise once" values are simpler with a lock than with a channel, but the `sync` types have rules the compiler does not check. A method with a value receiver silently copies the mutex. A second `Lock` in the same goroutine hangs forever. `wg.Add(1)` written inside the new goroutine lets `Wait` return before any work starts. An unsynchronized `n++` prints the right total in every normal run and is still a bug.

## Mental model
**Analogy:** a `Mutex` is the single key to a room hanging on a hook. Whoever holds the key is inside; anyone else waits at the hook. The key does not know who you are, so asking for it again while you already hold it means waiting for yourself, forever. A `WaitGroup` is a tally on the door: each task adds a mark when it starts and removes it when it finishes, and whoever waits at the door leaves when the tally is zero. `Once` is a "done" stamp. An atomic counter is a turnstile that clicks one person through at a time without a key.

**Artifact:** 1,000 goroutines increment three counters (Go 1.27.4 ✅[^1]):
```go
var (
	wg      sync.WaitGroup
	mu      sync.Mutex
	plain   int
	guarded int
	atomic_ atomic.Int64
)
for range 1000 {
	wg.Go(func() {
		plain++ // data race: unsynchronized read-modify-write
		mu.Lock()
		guarded++
		mu.Unlock()
		atomic_.Add(1)
	})
}
wg.Wait()
fmt.Println("plain:", plain, "guarded:", guarded, "atomic:", atomic_.Load())
```

## How it works
**What the package is for.** Apart from `Once` and `WaitGroup`, most `sync` types are meant for low-level library code, and higher-level synchronization is better done with channels; values of `sync` types should not be copied ✅[^2]. Effective Go agrees that channels can be taken too far: a reference count may be best done with a mutex around an integer ✅[^8].

**`Mutex`.**
1. The zero value is an unlocked mutex; `Lock` blocks until the mutex is free ✅[^2].
2. `Unlock` on an unlocked mutex is a run-time error ✅[^2]; the lab printed `fatal error: sync: unlock of unlocked mutex` ✅[^1].
3. A locked mutex is not tied to a goroutine: one goroutine may lock it and another unlock it ✅[^2]. It is therefore not reentrant: in the lab, a function that called `mu.Lock()` while its caller in the same goroutine held `mu` blocked forever, and the runtime reported `fatal error: all goroutines are asleep - deadlock!` with the goroutine in state `[sync.Mutex.Lock]` ✅[^1].
4. `TryLock` (Go 1.18) exists, but correct uses are rare and it is often a sign of a deeper problem ✅[^2].
5. For the memory model, the *n*-th `Unlock` is synchronized before the *m*-th `Lock` returns, for any *n* < *m* ✅[^4].

**`RWMutex`.** It is held by any number of readers or by one writer ✅[^2]. Once a writer is waiting in `Lock`, new `RLock` calls block until the writer has had its turn; this rules out recursive read-locking, and a read lock cannot be upgraded to a write lock or a write lock downgraded ✅[^2].

**Copying.** `Mutex`, `RWMutex`, `WaitGroup`, `Once`, `Cond`, `Map`, `Pool` and the typed atomics must not be copied after first use ✅[^2] ✅[^3]. `go vet` has a `copylocks` check for locks passed by value ✅[^5]; on a method `func (c Counter) Value() int` whose struct holds a `sync.Mutex`, it reported `Value passes lock by value: command-line-arguments.Counter contains sync.Mutex` and exited with 1, while the program itself compiled and ran ✅[^1].

**`WaitGroup`.**
1. It is a counting semaphore for waiting on a group of tasks: call `Go` for each task, then `Wait` ✅[^2].
2. `Go(f)` (new in Go 1.25) calls `f` in a new goroutine and adds it to the group; when `f` returns, the task is removed ✅[^2] ✅[^6]. `f` must not panic ✅[^2].
3. When the group is empty, `Go` (or a positive `Add`) must happen before `Wait`; when the group is not empty, a running task may start more tasks ✅[^2].
4. The older form is `Add(1)` before the `go` statement and `defer wg.Done()` inside; the docs now say callers should prefer `Go` ✅[^2]. If the counter goes negative, `Add` panics ✅[^2]; one `Done` on a fresh group panicked with `sync: negative WaitGroup counter` in the lab ✅[^1].
5. Go 1.25 added vet's `waitgroup` analyzer, which reports misplaced `Add` calls ✅[^6]. On a loop that called `wg.Add(1)` inside each new goroutine it reported `WaitGroup.Add called from inside new goroutine`; the program then printed none of its three lines, because `Wait` returned before any goroutine had run `Add` ✅[^1].

**`Once` and the `Once*` helpers.**
1. `once.Do(f)` calls `f` only on the first call for that `Once`, even if later calls pass a different `f`; no call returns before that one `f` returns, so `f` calling `Do` on the same `Once` deadlocks; if `f` panics, `Do` treats it as returned and never calls `f` again ✅[^2].
2. `OnceFunc`, `OnceValue` and `OnceValues` (Go 1.21) wrap a function so that it runs once and its result is cached; the returned function may be called concurrently, and if `f` panics, every call panics with the same value ✅[^2] ✅[^7].
3. In the lab, 10 goroutines calling one `OnceValue` ran the initializer once; a `OnceFunc` whose function panicked with `"init failed"` raised that same panic on both of two calls, while the function body ran only once ✅[^1].

**`Cond`.** A condition variable: goroutines wait for or announce an event while holding its `Locker` ✅[^2]. For many simple cases a channel is better: `Broadcast` corresponds to closing a channel and `Signal` to sending on one ✅[^2].

**`sync.Map`.** Most code should use a plain map with separate locking, for type safety and to keep other invariants with the map ✅[^2]. `sync.Map` is optimised for two cases: keys written once and read many times (caches that only grow), and goroutines working on disjoint sets of keys; there it can cut lock contention ✅[^2]. Its keys and values are `any`, so reads need a type assertion; `Load` returned a value of dynamic type `string` in the lab ✅[^2] ✅[^1].

**`sync.Pool`.** A set of temporary objects to reuse, which relieves pressure on the garbage collector ✅[^2]. Any stored item may be removed at any time without notice ✅[^2]. Good use: many independent clients sharing temporary buffers, as `fmt` does; poor use: a free list inside one short-lived object ✅[^2]. Its documented example notes that `New` should generally return pointer types, which fit into the `any` result without an allocation ✅[^2].

**`sync/atomic`.**
1. Atomic functions are low-level and need great care; except for special low-level applications, use channels or the `sync` package ✅[^3].
2. Typed values `atomic.Bool`, `Int32`, `Int64`, `Uint32`, `Uint64`, `Uintptr`, `Pointer[T]` and `Value` have methods such as `Load`, `Store`, `Add`, `Swap` and `CompareAndSwap`; `atomic.Int64` was added in Go 1.19, its zero value is zero, and it must not be copied ✅[^3]. `And` and `Or` methods were added in Go 1.23 ✅[^3].
3. If an atomic operation observes the effect of another, the first is synchronized before the second, and all atomic operations behave as if run in one sequentially consistent order — the semantics of C++ sequentially consistent atomics and Java `volatile` ✅[^3] ✅[^4].
4. On ARM, 386 and 32-bit MIPS, 64-bit alignment for the plain functions (`AddInt64` and friends) is the caller's job; the `Int64` and `Uint64` types are aligned automatically ✅[^3].

## Worked example
The counters artifact above, run on Go 1.27.4 ✅[^1]:

| Run | Command | Output |
|---|---|---|
| 1 | `go run main.go` (3 runs, then 20 more of the built binary) | `plain: 1000 guarded: 1000 atomic: 1000` in the first 3 runs; in the 20 later runs, 13 printed that and 7 printed a lower `plain` (818 to 992), with `guarded` and `atomic` at 1000 every time |
| 2 | `go run -race main.go` | two `WARNING: DATA RACE` reports, a `plain` total below 1000 (998 in one run, 980 in another), `Found 2 data race(s)`, `exit status 66` |
| 3 | `go vet main.go` | nothing, exit 0 |

What it shows:
- The unsynchronized `plain++` printed the right answer in most normal runs and lost updates in the others, so a correct total proves nothing.
- The race detector found the race in both `-race` runs; `go vet` did not report it.
- The mutex-guarded and atomic counters were exact in every run. A bigger version of `plain++` (8 goroutines × 100,000 increments), which lost updates in about half of its normal runs, is the worked example of `go/concurrency/memory-model-and-data-races.md`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Locking a mutex you already hold | Blocks forever | A mutex has no owner, so it cannot tell a re-entry from a second goroutine ✅[^2] ✅[^1] |
| Struct with a mutex used through a value receiver | Each call locks its own copy, so nothing is protected | Copying a mutex after first use is forbidden; `vet` `copylocks` reports it ✅[^2] ✅[^1] |
| `wg.Add(1)` inside the goroutine | `Wait` may return before the work starts | The positive `Add` must happen before `Wait`; vet `waitgroup` (Go 1.25) reports it ✅[^2] ✅[^6] |
| Recursive `RLock` while a writer waits | Deadlock | A waiting `Lock` blocks new readers ✅[^2] |
| `once.Do(f)` where `f` panicked | Later calls do nothing; the value was never set | `Do` treats a panic as a return ✅[^2] |
| `OnceValue` whose `f` panicked | Every call re-panics with the same value | Documented `Once*` behaviour ✅[^2] |
| Value taken from a `Pool` "disappears" | Expected | Items may be removed at any time ✅[^2] |
| `TryLock` returned false | No synchronization happened | A failed `TryLock` establishes no ordering ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Channel owning the state | No shared memory to guard | More moving parts for a plain counter |
| `Mutex` / `RWMutex` | Guards several fields and an invariant together | Lock ordering, contention, the copying rule |
| Typed atomic | No lock for one counter or flag | Cannot keep two values consistent with each other |
| `sync.Map` | Less contention for grow-only caches or disjoint keys ✅[^2] | `any` keys and values; worse fit for general maps |
| `sync.Pool` | Fewer allocations for shared temporary buffers ✅[^2] | Items vanish; no help for short-lived objects |

## Takeaways
- Use pointer receivers on any type that contains a `sync` value, and run `go vet` in continuous integration (CI) to catch copied locks. [rule-candidate]
- Start counted goroutines with `wg.Go(f)` (Go 1.25+); with older Go, call `Add` before the `go` statement, never inside it. [rule-candidate]
- Do not call a function that takes a lock from code that already holds the same lock; split it into a locked wrapper and an unlocked helper. [rule-candidate]
- Reach for `sync.Map` or `sync.Pool` only for the cases their docs name; default to a map plus a mutex.

## Verification status
- Verified: 60 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Package sync](https://pkg.go.dev/sync) — Go team, living. Rank 1. Backs: package purpose; `Mutex`, `RWMutex`, `WaitGroup` (including `Go`), `Once`, `OnceFunc`/`OnceValue`/`OnceValues`, `Cond`, `Map`, `Pool`; copying rules; synchronization statements. [^2]
- [Package sync/atomic](https://pkg.go.dev/sync/atomic) — Go team, living. Rank 1. Backs: atomics need care; typed values and their versions; sequential consistency; 64-bit alignment note. [^3]
- [The Go Memory Model](https://go.dev/ref/mem) — Go team, 2022. Rank 1. Backs: Locks; Atomic Values. [^4]
- [Command vet](https://pkg.go.dev/cmd/vet) — Go team, living. Rank 1. Backs: the `copylocks` check. [^5]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: `WaitGroup.Go`; vet's `waitgroup` analyzer. [^6]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: `OnceFunc`, `OnceValue`, `OnceValues`. [^7]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: Share by communicating — a mutex around an integer for a reference count. [^8]

## Related
- `go/concurrency/goroutines-and-channels.md`
- `go/concurrency/memory-model-and-data-races.md`
- `go/concurrency/patterns-and-goroutine-leaks.md`
- `go/methods-interfaces/methods-and-embedding.md` — value versus pointer receivers.
- `concurrency/shared-state-and-data-races.md` — the cross-language view.
- `go/learning-path.md`
