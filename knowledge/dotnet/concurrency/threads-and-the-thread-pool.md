---
schema: knowledge-doc/v1
type: concept
topic: dotnet/concurrency
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "the portable .NET thread pool (the default on macOS and Linux)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, threads, thread-pool, starvation, setminthreads, longrunning, parallel, parallel-foreachasync, plinq, timer, periodictimer]
ranked-sources: true
---

# Threads and the thread pool

## Summary
**TL;DR:** A `Thread` is an operating-system thread you own; the thread pool is a shared set of background threads that runs queued work items, `Task.Run` work and `await` continuations. The pool creates worker threads on demand up to the number of cores, then adds more slowly; when queued items block their threads (`Thread.Sleep`, `.Result`), new work waits in the queue: thread-pool starvation. In the lab, 48 blocking 4-second items took about 16 s with `Thread.Sleep`, about 6 s when they blocked on a task (which the pool detects), and about 4 s after raising the minimum. `Parallel.For`, `Parallel.ForEachAsync` and PLINQ (Parallel LINQ, the parallel form of Language-Integrated Query) run loop bodies on the pool and cap their concurrency differently.
**Use this when:** a server's latency climbs under load while the CPU (processor) stays mostly idle, you are deciding between `new Thread`, `Task.Run` and `TaskCreationOptions.LongRunning`, you need a parallel loop with a concurrency limit, or a timer callback runs twice at once or stops firing.
**Not this doc:** what `await` does and why `.Result` deadlocks under a UI (user interface) context → `dotnet/async/synchronization-context-and-configureawait.md`; protecting shared data → `dotnet/concurrency/locks-and-interlocked.md`.

## Problem
- An ASP.NET Core app answers in 50 ms at light load and in seconds at moderate load, with idle CPUs.
- `ThreadPool.SetMinThreads` "fixes" the problem above, but nobody knows why or what it costs.
- A worker thread keeps the process alive after `Main` returns, or the opposite: background work is cut off at exit.
- `Parallel.ForEachAsync` over 32 I/O (input/output) calls runs only 8 at a time.
- A `System.Threading.Timer` callback runs three copies at once, or stops firing after a garbage collection.

## Mental model
**Analogy:** the thread pool is a call centre. Calls (work items) wait in one queue; agents (threads) take the next call. The manager starts with one agent per desk (one per core) and hires more only when calls stop being answered for a while. An agent who puts a caller on hold and waits (a blocking call) is paid but answers nobody, so the queue grows while the office looks idle. Raising the minimum headcount hires agents up front; the real fix is not putting callers on hold, which is what `await` does.

**Artifact** (lab, Apple M2 with 8 cores ✅[^lab]):
```csharp
for (int i = 0; i < 48; i++)
    ThreadPool.QueueUserWorkItem(_ => Thread.Sleep(4000));   // 48 items that block their thread for 4 s
// every 1 s: ThreadPool.ThreadCount, ThreadPool.PendingWorkItemCount
//    518 ms   threads 9   pending 41
//   1535 ms   threads 11  pending 43
//   3581 ms   threads 15  pending 47     ← +1 thread about every 500 ms
//  12824 ms   threads 15  pending 0      ← all 48 done at 16140 ms
```

## How it works
Four actors run code concurrently:
- **`Thread`** — its job: run one delegate on a dedicated operating-system thread, via `Start`, `Join` and `IsBackground`.
- **Thread pool** — its job: run queued work on a shared set of threads, via `ThreadPool.QueueUserWorkItem` and the default `TaskScheduler`.
- **Starvation detector and hill climbing (inside the pool)** — its job: decide how many threads the pool should have, via a "gate" thread that checks every 500 ms.
- **Parallel helpers (`Parallel`, PLINQ)** — its job: split a loop or query into pool work items, via partitioning and a degree-of-parallelism cap.

```
QueueUserWorkItem / Task.Run / await continuation
        │
        ▼
 global FIFO queue ◀── items queued from outside the pool
 per-thread local queues ◀── tasks queued from a pool thread (LIFO for the owner, stolen FIFO by others)
        │
        ▼
 worker threads (min = cores) ──── blocked? ───▶ gate thread, every 500 ms:
        ▲                                           nothing dequeued for too long → add 1 thread
        │                                           blocked on a task (.Wait/.Result) → add threads faster
        └──────────────────────── new thread ◀──────┘
```

1. **`Thread` (dedicated):** a thread created with `new Thread(...)` is a foreground thread by default; thread-pool threads, and threads entering from unmanaged code, are background threads ✅[^fg-bg]. The process ends when its last foreground thread ends, and the runtime then stops background threads without running their code further ✅[^fg-bg]. In the lab, a foreground worker finished its 500 ms sleep and its `finally` block after `Main` returned at 4 ms; marked `IsBackground = true`, it printed nothing and its `finally` never ran ✅[^lab]. An unhandled exception on any thread, foreground or background, ends the process ✅[^fg-bg].
2. **Thread pool (shared):** there is one pool per process; its threads are background threads that are reused after each item ✅[^tp]. It runs `Task` work, async I/O completions, timer callbacks and registered waits ✅[^tp]. Items queued from outside the pool go to a global FIFO (first in, first out) queue; tasks queued from a pool thread go to that thread's local queue, which its owner reads in LIFO (last in, first out) order, and idle threads steal from the other end of other threads' queues ✅[^api-ts]. `ThreadPool.ThreadCount` reports the threads that exist and `PendingWorkItemCount` the items still queued ✅[^api-tp].
3. **Minimum and maximum:** the pool creates threads on demand up to the minimum, then switches to its own algorithm, which adds or retires threads to maximise completed items per unit of time ✅[^api-tp]. The minimum defaults to the processor count ✅[^api-tp]. In the lab the defaults were 8 worker threads minimum (8 cores), 32,767 maximum, and 1 minimum I/O completion-port thread ✅[^lab]. The minimum can be set with `ThreadPool.SetMinThreads`, the `ThreadPoolMinThreads` MSBuild property, or (from .NET 10) the `DOTNET_ThreadPool_ForceMinWorkerThreads` environment variable in hexadecimal ✅[^rc-threading]; the lab saw 24 with `#:property ThreadPoolMinThreads=24` and 64 with `DOTNET_ThreadPool_ForceMinWorkerThreads=0x40` ✅[^lab].
4. **Starvation detector (beyond the minimum):** a hill-climbing algorithm picks the thread-count goal ✅[^rt-hill]. A gate thread runs every 500 ms and adds one thread when work is waiting but nothing has been dequeued for longer than its delay (500 ms when CPU use is low) ✅[^rt-gate]. That matches the Artifact: one more thread about every 500 ms while no item finished, and no further growth once items finished often enough ✅[^lab].
5. **Blocking-aware injection:** for work items that block waiting for another task (sync-over-async `.Wait()` or `.Result`), the pool injects threads faster, with delays tuned by `System.Threading.ThreadPool.Blocking.*` settings (.NET 6 and later) ✅[^rc-threading]. In the lab, 48 items blocked on `Task.Delay(4000).Wait()` grew the pool to 29 threads in 0.5 s and 49 threads in 2.6 s ✅[^lab].
6. **Starvation, defined:** the pool has no free thread for new work, so it keeps adding threads; the classic sign is a thread count that climbs 1–2 per second, and a count that settles high usually means application code is blocking pool threads, sync-over-async code being the case the diagnostics tutorial walks through ✅[^tp-starvation]. Raising the minimum hides it but costs oversubscription, longer work-stealing scans, more context switches and memory ✅[^api-tp]. The fix is not to block pool threads; ASP.NET Core says the same about `Task.Wait` and `.Result` ✅[^aspnet-bp].
7. **`Task.Run` versus `LongRunning`:** `Task.Run` queues to the pool ✅[^api-run]. `TaskCreationOptions.LongRunning` hints that the work needs its own thread so it does not hold back other queued items ✅[^api-tco]; with the default scheduler it bypasses the pool queues entirely ✅[^api-ts]. In the lab, a `LongRunning` task ran on a thread with `IsThreadPoolThread=False` ✅[^lab].
8. **`Parallel.For` / `ForEach`:** iterations may run in parallel on pool threads, and exceptions from all threads come back in one `AggregateException` ✅[^api-parallel] ✅[^lab]. `ParallelOptions.MaxDegreeOfParallelism` caps concurrent operations; by default `For`/`ForEach` use as many threads as the scheduler gives them ✅[^api-po]. In the lab, 64 CPU-bound iterations ran 9 at a time in 1,132 ms, 2 at a time (cap 2) in 2,469 ms, and in a plain loop in 4,860 ms ✅[^lab].
9. **`Parallel.ForEachAsync` (.NET 6 and later):** runs at most `Environment.ProcessorCount` bodies at once by default, and `-1` means the same ✅[^api-po]. In the lab, 32 bodies that each awaited 100 ms took 412 ms at the default 8 and 204 ms with a cap of 16 ✅[^lab]; raise the cap for I/O-bound bodies.
10. **PLINQ:** `AsParallel()` partitions a query across cores, but PLINQ may decide to run a query sequentially when that looks cheaper ✅[^plinq]. Results are unordered unless `AsOrdered()` is used, which buffers and sorts them ✅[^plinq]. In the lab, `ToList()` over a parallel `Where` on a `List<int>` came back in source order, while `foreach` and `ForAll` over the same query did not ✅[^lab]; order without `AsOrdered()` is not promised, even when a test happens to see it.
11. **Timers:** `System.Threading.Timer` runs its callback on a pool thread, `System.Timers.Timer` raises an event on a pool thread, and `PeriodicTimer` lets code `await WaitForNextTickAsync()` in a loop ✅[^timers]. A `Timer` callback must be reentrant, because it can run on two threads at once when it is slower than the period ✅[^api-timer]; in the lab a 250 ms callback on a 100 ms period ran up to 3 copies at once ✅[^lab]. A `Timer` with no reference left can be garbage collected while active ✅[^api-timer]; in the lab it fired 6 times, then 0 times after a `GC.Collect()` ✅[^lab]. `PeriodicTimer` allows one waiter at a time, and `Dispose` makes the pending wait return `false` ✅[^api-periodic]; with a 250 ms body on a 100 ms period it ran at 102, 355, 610 and 863 ms, never overlapping ✅[^lab].

## Worked example
The same 48 items, each blocking its thread for 4 s, in three separate processes on the lab machine (8 cores, minimum 8 worker threads); a tiny probe item was queued every 250 ms to measure queue latency (✅[^lab]):

| Mode | Threads at ~0.5 s | Threads at ~2.5 s | Peak threads | Probe item | All 48 done |
|---|---|---|---|---|---|
| `Thread.Sleep(4000)` | 9 | 13 | 15 | Not run within 250 ms until 12.8 s | 16,140 ms |
| `Task.Delay(4000).Wait()` (sync-over-async) | 29 | 49 | 53 | Ran in 0 ms from 2.6 s on | 6,169 ms |
| `SetMinThreads(56, 8)`, then `Thread.Sleep(4000)` | 50 | 50 | 50 | Ran in 0–1 ms throughout | 4,108 ms |

Reading the rows:
1. **Sleep:** 8 threads take 8 items; the other 40 wait. The gate thread adds about one thread per 500 ms (How it works 4), so the count reaches 15 at 3.6 s. From then on items finish in a steady trickle, nothing triggers more growth, and 48 items × 4 s ÷ 15 threads ≈ 12.8 s of work plus the slow start gives about 16 s. Any request queued meanwhile, like the probe item, waits behind them.
2. **Task wait:** the pool recognises that its threads are blocked on tasks and adds threads without the 500 ms pacing (How it works 5): 49 threads by 2.6 s, finishing in one wave of 4 s plus the ramp.
3. **Raised minimum:** all 48 start at once and finish together after 4 s, which is the best case, but it took 50 threads to do 48 sleeps; with `await Task.Delay(4000)` instead, no thread would have been held at all.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Unhandled exception in a pool work item | The process terminates ✅[^tp] | The page lists three exemptions: thread abort (.NET Framework only; from .NET 5 `Thread.Abort` throws `PlatformNotSupportedException`), app-domain unload and host termination ✅[^tp] |
| `SetMinThreads` with a value above the maximum | Returns `false` and changes nothing ✅[^api-tp] | Documented guard |
| Minimum I/O completion-port threads on macOS | `GetMinThreads` reported 1 completion-port thread on the 8-core lab machine ✅[^lab], while the API (application programming interface) docs say the minimum defaults to the processor count ✅[^api-tp] | The 8-thread default held for worker threads; the completion-port value differs on this platform |
| Windows thread pool switch | `SetMinThreads`/`SetMaxThreads` are not supported and the min/max settings have no effect ✅[^rc-threading] | Another pool implementation runs the work |
| Blocking work in `Parallel.For` | The pool may inject many threads, because it cannot tell a slow loop from a stuck one ✅[^api-po] | Set `MaxDegreeOfParallelism` to bound it ✅[^api-po] |
| Threads that need a fixed identity, priority, STA (single-threaded apartment) or long blocking | Use a dedicated thread, not the pool ✅[^tp] | Pool threads are shared, MTA (multithreaded apartment) and limited in number ✅[^tp] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `await` real async I/O | No thread held while waiting (see `dotnet/async/tasks-and-async-await.md`) | Async all the way up |
| `new Thread` / `LongRunning` | A thread of its own that never steals a pool slot ✅[^api-ts] | Thread creation cost; you manage its lifetime |
| `Task.Run` | Cheap, reuses pool threads ✅[^tp] | Blocking inside it starves the pool (Worked example) |
| `SetMinThreads` | Instant capacity for a known burst of blocking (Worked example, row 3) | Oversubscription, CPU and memory costs ✅[^api-tp] |
| `Parallel.ForEachAsync` with a cap | Bounded concurrency for async bodies ✅[^api-po] | Default cap of `ProcessorCount` is low for I/O |

## Takeaways
- Never block a thread-pool thread on I/O or on a task; await instead. [rule-candidate]
- Treat a slowly climbing `ThreadPool.ThreadCount` with a growing `PendingWorkItemCount` and idle CPUs as starvation, and look for `.Result`, `.Wait()` and `Thread.Sleep` on pool threads. [rule-candidate]
- Use `SetMinThreads` only as a measured, temporary workaround, never as the fix.
- Set `MaxDegreeOfParallelism` explicitly for `Parallel.ForEachAsync` over I/O-bound work. [rule-candidate]
- Keep a reference to every `System.Threading.Timer` you need, and prefer `PeriodicTimer` when ticks must not overlap.

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Foreground and background threads](https://learn.microsoft.com/en-us/dotnet/standard/threading/foreground-and-background-threads) — Microsoft, living. Rank 1. Backs: defaults for new and pool threads; the process ends with its last foreground thread; unhandled exceptions end the process. [^fg-bg]
- [The managed thread pool](https://learn.microsoft.com/en-us/dotnet/standard/threading/the-managed-thread-pool) — Microsoft, living. Rank 1. Backs: one pool per process; background, reused threads; what uses the pool; unhandled exceptions; when not to use pool threads. [^tp]
- [ThreadPool class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.threadpool) — Microsoft, living. Rank 1. Backs: `ThreadCount`, `PendingWorkItemCount`; `SetMinThreads` semantics, default minimum, costs, `false` above the maximum. [^api-tp]
- [Runtime configuration options for threading](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/threading) — Microsoft, living. Rank 1. Backs: `ThreadPoolMinThreads`, `DOTNET_ThreadPool_ForceMinWorkerThreads` (.NET 10); blocking-aware injection settings; the Windows thread pool switch. [^rc-threading]
- [Debug thread pool starvation](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/debug-threadpool-starvation) — Microsoft, living. Rank 1. Backs: definition and signs of starvation; sync-over-async as the commonest cause. [^tp-starvation]
- [TaskScheduler class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskscheduler) — Microsoft, living. Rank 1. Backs: global and local queues, work stealing; `LongRunning` avoids the pool. [^api-ts]
- [Task.Run](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.run) — Microsoft, living. Rank 1. Backs: queues work to the thread pool. [^api-run]
- [TaskCreationOptions](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskcreationoptions) — Microsoft, living. Rank 1. Backs: `LongRunning` hints that oversubscription and an extra thread are warranted. [^api-tco]
- [Parallel.For](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.parallel.for) — Microsoft, living. Rank 1. Backs: iterations may run in parallel; `AggregateException` with all exceptions. [^api-parallel]
- [ParallelOptions.MaxDegreeOfParallelism](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.paralleloptions.maxdegreeofparallelism) — Microsoft, living. Rank 1. Backs: the cap; `-1` means unlimited except for `ForEachAsync` (processor count); thread injection with blocking bodies. [^api-po]
- [Introduction to PLINQ](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/introduction-to-plinq) — Microsoft, living. Rank 1. Backs: PLINQ may run sequentially; `AsOrdered` buffers and sorts. [^plinq]
- [Timers](https://learn.microsoft.com/en-us/dotnet/standard/threading/timers) — Microsoft, living. Rank 1. Backs: the three timer types and where their code runs. [^timers]
- [System.Threading.Timer class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.timer) — Microsoft, living. Rank 1. Backs: callbacks must be reentrant and can overlap; keep a reference or it can be collected. [^api-timer]
- [PeriodicTimer class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.periodictimer) — Microsoft, living. Rank 1. Backs: one consumer at a time; `Dispose` makes the wait return `false`. [^api-periodic]
- [ASP.NET Core best practices](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices) — Microsoft, living. Rank 1. Backs: do not block with `Task.Wait` or `.Result`; blocking causes starvation. [^aspnet-bp]
- [PortableThreadPool.HillClimbing.cs](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Threading/PortableThreadPool.HillClimbing.cs) — .NET runtime source, living. Rank 1. Backs: hill climbing sets the thread-count goal. [^rt-hill]
- [PortableThreadPool.GateThread.cs](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Threading/PortableThreadPool.GateThread.cs) — .NET runtime source, living. Rank 1. Backs: the 500 ms gate period; one thread added when nothing was dequeued for longer than the delay. [^rt-gate]

## Related
- `dotnet/async/tasks-and-async-await.md` — `Task.Run` versus async I/O, and why waiting holds no thread.
- `dotnet/async/synchronization-context-and-configureawait.md` — sync-over-async deadlocks.
- `dotnet/concurrency/locks-and-interlocked.md` — sharing data between the threads described here.
- `dotnet/concurrency/concurrent-collections-and-channels.md` — queues between producer and consumer threads.
- `concurrency/blocking-in-async-runtimes.md` — the same starvation in other runtimes.
