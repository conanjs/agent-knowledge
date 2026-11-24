---
schema: knowledge-doc/v1
type: concept
topic: dotnet/concurrency
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, concurrent-collections, concurrentdictionary, getoradd, concurrentqueue, concurrentbag, blockingcollection, channels, producer-consumer, back-pressure, boundedchannelfullmode]
ranked-sources: true
---

# Concurrent collections and channels

## Summary
**TL;DR:** The `System.Collections.Concurrent` types can be used from many threads without your own lock, but "thread-safe" is not "atomic": `ConcurrentDictionary.GetOrAdd` and `AddOrUpdate` run your delegate outside their internal lock, so in the lab 8 threads ran a `GetOrAdd` factory 8 times for one key (all callers still got the one stored value). Wrap the value in `Lazy<T>` when the factory must run once. For producer/consumer pipelines, `System.Threading.Channels` gives an async FIFO (first in, first out) queue: a bounded channel makes a fast producer wait (back-pressure), or drops items by a chosen rule, and `ReadAllAsync` ends cleanly when the writer completes.
**Use this when:** a cache built on `ConcurrentDictionary` creates expensive objects twice, you need a queue between threads or tasks, you must choose between `BlockingCollection<T>` and `Channel<T>`, or a fast producer exhausts memory ahead of a slow consumer.
**Not this doc:** single-threaded collections (`List<T>`, `Dictionary<TKey,TValue>`) → `dotnet/collections-and-linq/collections.md`; locks and `Interlocked` → `dotnet/concurrency/locks-and-interlocked.md`; `IAsyncEnumerable<T>` and `await foreach` → `dotnet/async/cancellation-valuetask-and-async-streams.md`.

## Problem
- A `ConcurrentDictionary<string, Connection>` cache opens several connections for the same key under load, and leaks all but one.
- A counter kept with `AddOrUpdate` has the right total, but its update delegate logged far more calls than updates.
- A producer that reads a file faster than consumers can process it fills memory with queued items.
- A consumer loop never ends, or ends early, because nobody signals that the producer has finished.
- Code written against `ICollection.SyncRoot` for old collections throws on the concurrent ones.

## Mental model
**Analogy:** `ConcurrentDictionary.GetOrAdd` is a shared coat rack with a rule "if there is no coat on hook 7, go and buy one, then hang it". Eight people who find hook 7 empty at the same moment all go shopping; the first to come back hangs theirs, and the other seven hang nothing and borrow the coat on the hook. Nobody ends up with a different coat, but eight coats were bought. A bounded channel is a conveyor belt with room for two boxes: when it is full, the packer waits (or, by a chosen rule, throws a box away) until a worker takes one off.

**Artifact** (lab, Release build, 8 threads released together by a `Barrier`, factory sleeps 50 ms ✅[^lab]):
```csharp
var r = Race(d => () => d.GetOrAdd("key", _ => Factory.Make()), new ConcurrentDictionary<string, object>());
// round 1: factory ran 8x, callers got 1 distinct value(s), dictionary holds 1 entry
// round 2: factory ran 8x, callers got 1 distinct value(s), dictionary holds 1 entry
var lazyDict = new ConcurrentDictionary<string, Lazy<object>>();
lazyDict.GetOrAdd("key", _ => new Lazy<object>(Factory.Make)).Value;
// factory ran 1x, callers got 1 distinct value(s)
```

## How it works
### Concurrent collections
1. **What they promise:** the types in `System.Collections.Concurrent` let many threads add and remove items without extra synchronization in user code, while `List<T>` and `Dictionary<TKey,TValue>` provide none ✅[^cc-overview]. Some use fine-grained locks or brief spinning; the overview says `ConcurrentQueue<T>` and `ConcurrentStack<T>` use `Interlocked` operations and no locks at all ✅[^cc-overview]. In the .NET 10 source the queue's enqueue and dequeue fast paths are lock-free, but it still takes a lock (`_crossSegmentLock`) when it adds or leaves an internal segment, counts across segments, takes a snapshot (`ToArray`, `CopyTo`, enumeration) or is cleared ✅[^src-cq].
2. **`GetOrAdd` / `AddOrUpdate` (where the delegate runs):** writes use fine-grained locking and reads are lock-free, but the value factory is called outside the locks so that unknown code never runs under them; therefore the factory may run several times for one key, and only one result is stored ✅[^api-cd]. The docs walk through the sequence: thread A finds no key and starts its factory, thread B's factory finishes first and B inserts, A then finds the key and returns B's value ✅[^cc-addremove]. The Artifact is that sequence with 8 threads: 8 factory calls, 1 stored value, every caller handed the same object ✅[^lab]. `AddOrUpdate`'s delegates can likewise run more than once ✅[^api-cd]: in the lab, 100,000 parallel `AddOrUpdate` calls left the right value, 100,000, while the update delegate ran 247,491 times ✅[^lab].
3. **The `Lazy<T>` fix:** store `Lazy<T>` values, so a racing `GetOrAdd` may create several cheap `Lazy` wrappers but only the stored one ever runs its factory (by default only one thread runs a `Lazy<T>` factory, see `dotnet/concurrency/memory-model.md`). Lab: 1 factory call for 8 threads ✅[^lab].
4. **Enumeration and counts:** enumerating a `ConcurrentDictionary` is safe during writes but is not a moment-in-time snapshot; it may show changes made after it started ✅[^api-cd]. `Count` is a snapshot taken when it is read ✅[^api-cd]. In the lab, adding a key inside a `foreach` over the dictionary raised no exception and the loop saw the new entry (6 entries), while the same loop over a `Dictionary<int,int>` threw `InvalidOperationException` ✅[^lab].
5. **Queue, stack, bag:** `ConcurrentQueue<T>` is FIFO, `ConcurrentStack<T>` LIFO (last in, first out), and `ConcurrentBag<T>` an unordered collection that allows duplicates ✅[^cc-overview], tuned for threads that both add and take their own items ✅[^api-bag]. In the lab, `TryDequeue` after enqueuing 1, 2, 3 returned 1, and `TryTake` on the same thread after adding 1, 2, 3 to a bag returned 3 ✅[^lab].
6. **`BlockingCollection<T>`:** a thread-based producer/consumer wrapper over any `IProducerConsumerCollection<T>`, with an optional capacity: `Add` blocks when it is full, `Take` blocks when it is empty, `TryAdd`/`TryTake` can time out, and `CompleteAdding` tells consumers no more items will come ✅[^cc-blocking]. After `CompleteAdding`, adding is not allowed and taking no longer waits on an empty collection ✅[^api-blocking]. In the lab, with capacity 2 and a consumer that started at 200 ms, the producer added items 1 and 2 at 1 ms and then blocked on item 3 until the first take at 210 ms; `GetConsumingEnumerable` ended once the collection was completed and empty; `Add` after `CompleteAdding` threw `InvalidOperationException`; `TryAdd(…, 100)` on a full collection returned `False` ✅[^lab].

### Channels
Three actors take part in a channel pipeline:
- **Producer** — its job: push items, via `ChannelWriter<T>.WriteAsync`/`TryWrite`, then say "no more", via `Complete()`.
- **Channel (`Channel<T>`)** — its job: buffer items in FIFO order and apply the bound, via its capacity and `BoundedChannelFullMode`.
- **Consumer** — its job: pull items until the end, via `ChannelReader<T>.ReadAllAsync()` (an `IAsyncEnumerable<T>`) or `ReadAsync`/`TryRead`.

```
producer ──WriteAsync──▶ [ bounded channel, capacity 2 ] ──ReadAllAsync──▶ worker w1 ─┐
   ▲   waits while full       FIFO, FullMode.Wait                       worker w2 ─┼─▶ results channel ─▶ consumer
   └──────────── back-pressure ◀─────────────────────────────────────────────────────┘ (unbounded)
Complete() on the writer ─▶ ReadAllAsync loops end after the buffer drains
```

7. **Producer → channel:** channels pass data from producers to consumers through a FIFO queue, asynchronously; `Channel.CreateUnbounded` has no limit and its writes always complete synchronously, `Channel.CreateBounded` has a capacity greater than zero ✅[^channels]. The channel types ship in the shared framework from .NET Core 3.0, so no package is needed ✅[^channels].
8. **Channel, when full:** `BoundedChannelFullMode.Wait` (the default) makes `WriteAsync` wait for room and `TryWrite` return `false`; `DropNewest` removes the newest queued item, `DropOldest` the oldest, and `DropWrite` drops the item being written; an `itemDropped` callback sees every dropped item ✅[^channels]. Writing 1–5 into capacity 3 in the lab ✅[^lab]:

| Full mode | `TryWrite` results | Channel then holds | `itemDropped` saw |
|---|---|---|---|
| `Wait` | 1–3 `true`, 4–5 `false` | 1, 2, 3 | nothing; a `WriteAsync(6)` stayed pending |
| `DropOldest` | all `true` | 3, 4, 5 | 1, 2 |
| `DropNewest` | all `true` | 1, 2, 5 | 3, 4 |
| `DropWrite` | all `true` | 1, 2, 3 | 4, 5 |

9. **Channel → consumer:** a producer faster than its consumer feels back-pressure ✅[^channels]. `ReadAllAsync` returns an `IAsyncEnumerable<T>` over all data ✅[^channels], and with several producers `Complete()` must come only after all of them finish ✅[^channels]. In the lab, `ReadAllAsync` returned the two queued items and then ended after `Complete()`; afterwards `TryWrite` returned `False` and `WriteAsync` threw `ChannelClosedException` ✅[^lab], matching the rule that a closed channel throws `ChannelClosedException` ✅[^channels]. `Complete(exception)` passed the producer's error on: `ReadAllAsync` rethrew the `InvalidOperationException` itself, while `ReadAsync` threw `ChannelClosedException` with it as the inner exception ✅[^lab].
10. **Options:** `SingleReader` and `SingleWriter` (default `false`) are promises that let the channel optimize ✅[^api-chopts]; `AllowSynchronousContinuations` (default `false`) lets a writer run a waiting reader's continuation inline, which can raise throughput but lets a producer end up doing consumer work ✅[^api-chopts]. The asynchronous methods return `ValueTask`/`ValueTask<bool>` ✅[^channels], so their one-shot rules apply (Edge cases).

## Worked example
A two-stage pipeline: one producer writes 8 orders into a bounded channel of capacity 2 (`FullMode.Wait`), two workers read it with `ReadAllAsync`, spend 100 ms per order, and write into an unbounded results channel read by one consumer. Timeline from one lab run ✅[^lab]:

| Time | Event | Why |
|---|---|---|
| 6–11 ms | Producer writes orders 1–4 without waiting | w1 and w2 each took one order (1, 2) and are busy; 3 and 4 fill the 2 slots |
| 11–108 ms | Producer waits 97 ms on order 5 | The channel is full (How it works 8): back-pressure |
| 108 ms | Consumer gets order 1 (w1); producer writes order 5 | w1 finished, took order 3 from the channel, freeing a slot |
| 112 ms | Consumer gets order 2 (w2); producer writes order 6 | w2 took order 4: another slot |
| 210 ms | Producer writes order 7 after waiting 98 ms | Full again until w1 takes order 5 |
| 221 ms | Producer calls `Complete()` on the work channel | All 8 written |
| 312–413 ms | Orders 5–8 reach the consumer two at a time | Two workers, 100 ms each |
| 413 ms | Both workers' `ReadAllAsync` loops end; the results channel is completed; the consumer's loop ends with 8 results | Completion flows from stage to stage (How it works 9) |

At no time were more than 4 orders "in flight" (2 being processed, 2 queued), whatever the producer's speed; with an unbounded first channel, every write would have completed at once ✅[^channels] and all 8 would have been queued.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Expensive or disposable value from `GetOrAdd`'s factory | Extra instances are created and silently dropped (8 factory calls in the lab) ✅[^lab] | The delegate runs outside the lock ✅[^api-cd]; use `Lazy<T>` values or dispose the losers |
| `ICollection.SyncRoot` on a concurrent collection | The docs say `SyncRoot` is always `null` ✅[^cc-overview]; on .NET 10.0.12 it threw `NotSupportedException` for `ConcurrentQueue`, `ConcurrentBag`, `ConcurrentStack`, `ConcurrentDictionary` and `BlockingCollection` ✅[^lab] | `IsSynchronized` was `False` as documented ✅[^lab]; do not lock on `SyncRoot` |
| Touching a channel's `ValueTask` after calling `AsTask()` on it | Reading `IsCompleted` was fine while pending, but after the `Task` completed it threw `InvalidOperationException: The result of the operation was already consumed` ✅[^lab] | The channel reuses its operation object; a `ValueTask` must be consumed once (see `dotnet/async/cancellation-valuetask-and-async-streams.md`) |
| A pending `WriteAsync` when the writer is completed | The pending write's task became `Faulted` ✅[^lab] | A closed channel rejects writes ✅[^channels] |
| `Complete()` called by the first of several producers | Later producers' writes fail, and readers may end early ✅[^channels] | Complete once, after `Task.WhenAll` over all producers |
| Mostly mixed producer-consumer work with tiny items | A plain `Queue<T>` with a lock can scale better than `ConcurrentQueue<T>` ✅[^cc-when] | Synchronization overhead dominates very short work items ✅[^cc-when] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `ConcurrentDictionary` + plain factory | Simple, lock-free reads ✅[^api-cd] | Factory may run many times (Artifact) |
| `ConcurrentDictionary<TKey, Lazy<TValue>>` | Factory runs once (How it works 3) | One extra object per entry; exceptions are cached by `Lazy<T>` |
| `BlockingCollection<T>` | Bounding and blocking built in, faster than a custom version ✅[^cc-when] | Blocks threads; no async API (application programming interface) |
| `Channel<T>` bounded, `Wait` | Async back-pressure without blocking threads ✅[^channels] | The producer can stall behind a slow consumer |
| `Channel<T>` bounded, drop modes | Producer never waits; memory capped ✅[^channels] | Data is lost by design; observe it with `itemDropped` |
| `Channel<T>` unbounded | Writes always succeed at once ✅[^channels] | No memory limit if consumers fall behind |

## Takeaways
- Never put side effects or costly work in a `GetOrAdd`/`AddOrUpdate` delegate; store `Lazy<T>` values when the factory must run once. [rule-candidate]
- Use a bounded `Channel<T>` between a fast producer and a slower consumer, and choose its `FullMode` on purpose. [rule-candidate]
- Call `Writer.Complete()` exactly once, after every producer has finished, and read with `ReadAllAsync` so consumers end cleanly. [rule-candidate]
- Prefer `Channel<T>` over `BlockingCollection<T>` in async code; keep `BlockingCollection<T>` for thread-based producers and consumers.
- Treat concurrent collections as thread-safe per call, not per sequence of calls: a check followed by an act is still a race.

## Verification status
- Verified: 50 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Thread-safe collections](https://learn.microsoft.com/en-us/dotnet/standard/collections/thread-safe/) — Microsoft, living. Rank 1. Backs: the concurrent types and what they promise; lock-free queue and stack; `IsSynchronized` and `SyncRoot`. [^cc-overview]
- [How to add and remove items from a ConcurrentDictionary](https://learn.microsoft.com/en-us/dotnet/standard/collections/thread-safe/how-to-add-and-remove-items) — Microsoft, living. Rank 1. Backs: `GetOrAdd` and `AddOrUpdate` are not atomic; the A/B race sequence. [^cc-addremove]
- [BlockingCollection overview](https://learn.microsoft.com/en-us/dotnet/standard/collections/thread-safe/blockingcollection-overview) — Microsoft, living. Rank 1. Backs: bounding, blocking, timed `TryAdd`/`TryTake`, `CompleteAdding`. [^cc-blocking]
- [When to use a thread-safe collection](https://learn.microsoft.com/en-us/dotnet/standard/collections/thread-safe/when-to-use-a-thread-safe-collection) — Microsoft, living. Rank 1. Backs: locked `Queue<T>` can scale better for tiny mixed work; `BlockingCollection<T>` versus custom code. [^cc-when]
- [ConcurrentDictionary\<TKey,TValue\> class](https://learn.microsoft.com/en-us/dotnet/api/system.collections.concurrent.concurrentdictionary-2) — Microsoft, living. Rank 1. Backs: delegates run outside the locks and may run several times; lock-free reads; enumeration is not a snapshot; `Count` is a snapshot. [^api-cd]
- [ConcurrentBag\<T\> class](https://learn.microsoft.com/en-us/dotnet/api/system.collections.concurrent.concurrentbag-1) — Microsoft, living. Rank 1. Backs: optimized for threads that produce and consume their own items. [^api-bag]
- [BlockingCollection\<T\>.CompleteAdding](https://learn.microsoft.com/en-us/dotnet/api/system.collections.concurrent.blockingcollection-1.completeadding) — Microsoft, living. Rank 1. Backs: no adding afterwards; removal no longer waits on an empty collection. [^api-blocking]
- [System.Threading.Channels library](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) — Microsoft, living. Rank 1. Backs: FIFO producer/consumer model; bounded and unbounded; full modes and `itemDropped`; back-pressure; producer and consumer APIs; `ChannelClosedException`; `ValueTask` returns; completing after all producers; shared framework since .NET Core 3.0. [^channels]
- [ChannelOptions class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.channels.channeloptions) — Microsoft, living. Rank 1. Backs: `SingleReader`, `SingleWriter`, `AllowSynchronousContinuations` and their defaults. [^api-chopts]
- [ConcurrentQueue.cs (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Private.CoreLib/src/System/Collections/Concurrent/ConcurrentQueue.cs) — .NET runtime team, 2025. Rank 1. Backs: `_crossSegmentLock` taken in `EnqueueSlow`, `TryDequeueSlow`, `Count`, `SnapForObservation` (`ToArray`, `CopyTo`, `GetEnumerator`) and `Clear`. [^src-cq]

## Related
- `dotnet/concurrency/locks-and-interlocked.md` — the locks these collections use internally.
- `dotnet/concurrency/memory-model.md` — `Lazy<T>` modes and safe publication.
- `dotnet/async/cancellation-valuetask-and-async-streams.md` — `await foreach`, `ValueTask` rules.
- `dotnet/delegates-and-events/events.md` — events versus `IObservable<T>` versus `Channel<T>`.
- `dotnet/collections-and-linq/collections.md` — the single-threaded collections.
