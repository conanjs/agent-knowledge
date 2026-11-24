---
schema: topic-index/v1
kind: subtopic
topic: dotnet/concurrency
last-updated: 2026-11-24
---

# Threads and concurrency in .NET

How .NET 10 runs code on several threads and keeps shared data correct: dedicated threads versus the thread pool and how the pool grows (with thread-pool starvation measured over time), `Parallel`, PLINQ (Parallel Language-Integrated Query) and timers; data races and the locks, `Interlocked` operations and other primitives that fix them; the .NET memory model (reordering, `volatile`, fences, atomicity, safe publication, lazy initialization); and the concurrent collections and channels used between producers and consumers. Every behaviour was run in the lab (`dotnet/lab-setup.md`) on an 8-core Apple M2, including a lost-update race, a lock-ordering deadlock, a hoisted flag read and store-buffering reorders. Not covered: `async`/`await`, `SynchronizationContext` and cancellation (see `dotnet/async/`), TPL (Task Parallel Library) Dataflow, and distributed coordination.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [threads-and-the-thread-pool.md](threads-and-the-thread-pool.md) | concept | Foreground and background threads, the thread pool's queues, minimum threads and injection, starvation measured with `ThreadCount`/`PendingWorkItemCount`, `LongRunning`, `Parallel.For`/`ForEachAsync`, PLINQ ordering, timer types | verified |
| [locks-and-interlocked.md](locks-and-interlocked.md) | concept | The lost-update race, `lock` lowering to `Monitor` or `System.Threading.Lock`, `Interlocked` and `CompareExchange` loops, `SemaphoreSlim`, `ReaderWriterLockSlim`, named `Mutex`, events, `Barrier`, deadlocks and what not to lock on | verified |
| [memory-model.md](memory-model.md) | concept | Allowed reorderings, acquire/release (`volatile`, `Volatile`) versus full fences (`Interlocked`, `MemoryBarrier`), atomic sizes and torn structs, object publication, double-checked locking, `Lazy<T>` and `LazyInitializer` | verified |
| [concurrent-collections-and-channels.md](concurrent-collections-and-channels.md) | concept | `ConcurrentDictionary` (`GetOrAdd` factories run more than once), queue, bag, `BlockingCollection`, `Channel<T>` bounded and unbounded, full modes, completion, a back-pressured pipeline | verified |

## References
- [Managed threading](https://learn.microsoft.com/en-us/dotnet/standard/threading/) — Microsoft, living. Backs: subtopic scope.
- [.NET memory model](https://github.com/dotnet/runtime/blob/main/docs/design/specs/Memory-model.md) — .NET runtime team, living. Backs: subtopic scope.

## Related
- `dotnet/async/` — tasks, `await`, contexts, cancellation and async streams.
- `dotnet/learning-path.md` — the order to read the `dotnet/` docs in.
- `concurrency/` — cross-language data races, structured concurrency and blocking.
