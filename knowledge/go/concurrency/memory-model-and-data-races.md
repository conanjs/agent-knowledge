---
schema: knowledge-doc/v1
type: concept
topic: go/concurrency
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "The Go Memory Model, version of June 6, 2022"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, memory-model, happens-before, data-race, drf-sc, race-detector, threadsanitizer, gorace, synchronization]
ranked-sources: true
---

# The Go memory model and the race detector

## Summary
**TL;DR:** A read in one goroutine is only guaranteed to see a write from another goroutine if a chain of *happens-before* edges connects them: sequencing inside each goroutine plus synchronizing operations between them (channel send/receive/close, unlock→lock, `Once`, atomics, `WaitGroup`, …). A data race is a write unordered by happens-before with another access to the same location, at least one of them non-synchronizing. Race-free programs behave as if all goroutines ran interleaved on one processor (DRF-SC, "data-race-free programs are sequentially consistent"). Racy programs are errors: an implementation may report and stop them, and races on multi-word values such as slices, strings, maps and interfaces can corrupt memory. `go test -race` finds the races that actually execute.
**Use this when:** deciding whether a value written in one goroutine is safely visible in another, reviewing "clever" lock-free code (flags, double-checked locking), reading a `WARNING: DATA RACE` report, or planning where to run the race detector.
**Not this doc:** the cross-language basics of shared state → `concurrency/shared-state-and-data-races.md`; the `sync` types themselves → `go/concurrency/sync-and-atomics.md`; channel semantics → `go/concurrency/goroutines-and-channels.md`.

## Problem
Code that sets `done = true` in one goroutine and spins on `for !done {}` in another may never stop. Code that reads a pointer set by another goroutine may see the pointer but not the fields behind it. Such programs often print the right answer in tests, so the bug ships. The memory model says exactly which orderings are guaranteed; the race detector catches violations at run time.

## Mental model
**Analogy:** every goroutine keeps notes in its own notebook. A note becomes visible to another goroutine only when it is handed over through an official hand-off — a channel message, releasing a lock the other then takes, an atomic flag — and the other goroutine is guaranteed to see everything written before that hand-off. Happens-before is the chain of receipts from the writer to the reader. No receipt chain, no guarantee; sleeping or "waiting long enough" is not a receipt.

**Artifact:** a race-free hand-off, each step numbered (race detector clean on Go 1.27.4 ✅[^1]):
```go
var msg string

func main() {
	done := make(chan struct{})
	go func() {
		msg = "hello, world" // (1) sequenced before (2)
		close(done)          // (2) synchronized before (3)
	}()
	<-done           // (3) returns because done is closed
	fmt.Println(msg) // (4) sequenced after (3): guaranteed to print hello, world
}
```

## How it works
**The advice first.** Programs that modify data while other goroutines access it must serialize that access with channels or the `sync` and `sync/atomic` primitives ✅[^2]. In the model's own words: "If you must read the rest of this document to understand the behavior of your program, you are being too clever." ✅[^2]

**Three relations.**
1. *Sequenced before:* inside one goroutine, the order set by the language's control flow and evaluation order ✅[^2].
2. *Synchronized before:* when a synchronizing read-like operation (atomic read, mutex lock, channel receive) observes a synchronizing write-like operation (atomic write, mutex unlock, channel send or close), the write is synchronized before the read ✅[^2].
3. *Happens before:* the transitive closure of the two. An ordinary read must observe a write that happens before it and is not overwritten by another write that also happens before the read ✅[^2].

**Data race.** A read-write race is a read-like and a write-like operation on the same location, at least one non-synchronizing, unordered by happens-before; a write-write race is the same with two writes ✅[^2]. A program with no racy executions can only produce outcomes explained by some sequentially consistent interleaving of its goroutines — DRF-SC — the same guarantee C, C++, Java, JavaScript, Rust and Swift give race-free programs ✅[^2].

**The synchronization edges** ✅[^2] (and the `sync` docs for the last four rows ✅[^3]):

| A | is synchronized before (so happens before) | B |
|---|---|---|
| Completion of package `q`'s `init` functions, when `p` imports `q` | → | start of `p`'s `init` functions |
| Completion of all `init` functions | → | start of `main.main` |
| The `go` statement | → | start of the new goroutine |
| A goroutine's exit | **no guarantee** | anything |
| A send on a channel | → | completion of the matching receive |
| Closing a channel | → | a receive that returns a zero value because the channel is closed |
| A receive from an **unbuffered** channel | → | completion of the matching send |
| The *k*-th receive on a channel with capacity *C* | → | completion of the (*k*+*C*)-th send |
| The *n*-th `Unlock` of a `Mutex`/`RWMutex` | → | the *m*-th `Lock` returning, *n* < *m* |
| The single `f()` run by `once.Do(f)` | → | return of every `once.Do(f)` |
| An atomic operation whose effect another atomic observes | → | that other atomic; all atomics form one sequentially consistent order |
| `runtime.SetFinalizer(x, f)` | → | the call `f(x)` |
| `WaitGroup.Done`, or the return of a `WaitGroup.Go` function | → | the `Wait` it unblocks |
| `Cond.Broadcast` / `Signal` | → | the `Wait` it unblocks |
| A `sync.Map` write | → | a read that observes it |
| `Pool.Put(x)` | → | the `Get` that returns `x` |

The *k*+*C* rule is what makes a buffered channel a counting semaphore: capacity is the maximum number of holders, a send acquires and a receive releases ✅[^2].

**What a racy program may do.**
1. Any implementation may report a race and stop the program; the ThreadSanitizer-based detector (`go build -race`) does exactly this ✅[^2].
2. Otherwise, a read of a location no larger than a machine word must see a value actually written by a preceding or concurrent write, and "out of thin air" values are not allowed ✅[^2]. Reads of arrays, structs and complex numbers may be done field by field in any order ✅[^2].
3. Larger locations may be read or written as several word-sized operations in unspecified order, so a race can produce a value no single write produced; for interfaces, maps, slices and strings, whose (pointer, length) or (pointer, type) pairs must agree, that can lead to arbitrary memory corruption ✅[^2].
4. This makes Go more like Java or JavaScript, where most races have a limited set of outcomes, and less like C and C++, where a racy program's meaning is entirely undefined ✅[^2].

**What the compiler may not do.** It must not add writes the program does not contain, let one read observe several values, or let one write store several values ✅[^2]. Examples from the model: it must not turn `*p = 1; if cond { *p = 2 }` into `*p = 2; if !cond { *p = 1 }`; it must not drop a local copy `i := *p` and reload `*p` later; it must not use `*p` as scratch space while computing `*p = i + *p/2` ✅[^2].

**Idioms the model rules out** ✅[^2]:
- With `go f()` writing `a = 1; b = 2` and `g()` printing `b` then `a`, `g` may print 2 and then 0.
- Double-checked locking with a plain `done bool`: seeing `done == true` does not imply seeing the data written before it.
- Busy waiting `for !done {}`: the loop is not even guaranteed to finish.
- Publishing a pointer `g = t` without synchronization: a reader that sees `g != nil` may still see a zero `g.msg`.

**The race detector.**
1. Add `-race` to `go test`, `go run`, `go build` or `go install` ✅[^4]. It needs cgo, and on systems other than macOS a C compiler ✅[^4].
2. A report shows the stack of each conflicting access and where the goroutines involved were created ✅[^4].
3. It only finds races that happen at run time, so it misses code paths that do not run; with incomplete test coverage, run a `-race` binary under a realistic workload ✅[^4].
4. Cost: for a typical program, memory use may grow 5–10× and execution time 2–20×; it also allocates an extra 8 bytes per `defer` and `recover` that are only reclaimed when the goroutine exits ✅[^4].
5. The `GORACE` environment variable sets options: `exitcode` (default 66), `halt_on_error` (default 0), `log_path` (default stderr), `strip_path_prefix`, `history_size`, `atexit_sleep_ms` ✅[^4].
6. A send and a `close` on the same channel with no ordering between them is also a race; receive first, then close ✅[^4].

## Worked example
The busy-flag idiom with a sleep instead of a loop, which "works" (Go 1.27.4 ✅[^1]):
```go
var (
	msg  string
	done bool
)

func setup() {
	msg = "hello, world" // line 14
	done = true          // line 15
}

func main() {
	go setup()                        // line 19
	time.Sleep(10 * time.Millisecond) // sleeping is not synchronization
	if done {                         // line 21
		fmt.Println(msg)              // line 22
	}
}
```

| Step | Command | Result |
|---|---|---|
| 1 | `go run main.go` | prints `hello, world`: looks correct |
| 2 | `go run -race main.go` | prints `hello, world`, then two `WARNING: DATA RACE` reports: read of `done` at line 21 against the write at line 15, and read of `msg` at line 22 against the write at line 14, both by the goroutine created at line 19 |
| 3 | exit status | `Found 2 data race(s)`, `exit status 66` |
| 4 | Replace the flag by `close(done)` / `<-done` (the artifact above) and run with `-race` | prints `hello, world`, no report, exit 0 |

Lost updates show up without the detector once the race is hot enough: 8 goroutines each doing `n++` 100,000 times printed `got 800000` in some runs and `got 546459`, `582116`, `501103` and `389794` in others, out of 8 runs ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Waiting with `time.Sleep` | No ordering | Only synchronizing operations create happens-before edges ✅[^2] ✅[^1] |
| A goroutine's last write, read after it "must have finished" | Not guaranteed visible | Goroutine exit is not synchronized before anything; a compiler may even delete such a `go` statement ✅[^2] |
| Swap send and receive on a **buffered** channel of capacity 1 | The unbuffered guarantee is lost; the program may print the empty string or crash | Only an unbuffered receive is synchronized before its send completes ✅[^2] |
| Failed `TryLock` | No synchronization at all | As far as the model goes, `TryLock` may return false even on an unlocked mutex ✅[^2] |
| Race on a "harmless" `int64` or `bool` | Still a bug: non-atomic access, compiler optimizations, reordering | Use a channel, a mutex or `sync/atomic` ✅[^4] |
| Race on a slice, string, map or interface value | May corrupt memory | Multi-word values can be torn ✅[^2] |
| `-race` clean test suite | Only proves the executed paths are race-free | The detector sees only races that happen ✅[^4] |
| Long-running goroutine calling `defer`/`recover` under `-race` | Memory grows without bound, invisible to `runtime.ReadMemStats` and `pprof` | 8 extra bytes per call, freed at goroutine exit ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Run tests with `-race` in continuous integration (CI) | Catches races in executed paths with exact stacks ✅[^4] | 2–20× slower, 5–10× more memory ✅[^4] |
| Canary or staging binary built with `-race` | Finds races tests do not exercise ✅[^4] | Same overhead in that environment |
| Reason from the memory model instead of synchronizing | — | The model's own advice: don't be clever ✅[^2] |

## Takeaways
- Every value shared between goroutines needs a named synchronization edge (channel, lock, atomic, `Once`, `WaitGroup`); "it was written long ago" is not one. [rule-candidate]
- Run `go test -race ./...` in CI, and run a `-race` build under realistic load before releases of concurrent code. [rule-candidate]
- Never use a plain `bool` or pointer as a "ready" flag between goroutines; use a channel close, `sync.Once` or an atomic. [rule-candidate]
- Treat any race report as a real bug even when the output looked right.

## Verification status
- Verified: 41 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Memory Model](https://go.dev/ref/mem) — Go team, 2022. Rank 1. Backs: Advice; Informal Overview; Memory Model (relations, data races, DRF-SC); Implementation Restrictions for Programs Containing Data Races; Synchronization (initialization, goroutine creation and destruction, channels, locks, once, atomics, finalizers); Incorrect synchronization; Incorrect compilation. [^2]
- [Package sync](https://pkg.go.dev/sync) — Go team, living. Rank 1. Backs: the synchronization statements for `WaitGroup`, `Cond`, `Map` and `Pool`. [^3]
- [Data Race Detector](https://go.dev/doc/articles/race_detector) — Go team, living. Rank 1. Backs: usage, report format, `GORACE` options, runtime-only detection, overhead, send/close race, primitive-variable races, requirements. [^4]

## Related
- `concurrency/shared-state-and-data-races.md` — the cross-language view of shared state.
- `go/concurrency/sync-and-atomics.md`
- `go/concurrency/goroutines-and-channels.md`
- `go/tooling/testing-benchmarks-and-fuzzing.md` — running tests with `-race`.
- `go/learning-path.md`
