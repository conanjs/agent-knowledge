---
schema: topic-index/v1
kind: subtopic
topic: dotnet/collections-and-linq
last-updated: 2026-11-24
---

# C# collections, iterators and LINQ

How .NET stores groups of values and how C# walks and queries them: arrays, `List<T>` growth, `Dictionary` hashing and the `GetHashCode`/`Equals` contract, sets, queues and priority queues, read-only views versus immutable and frozen collections, collection expressions (`[1, 2, ..xs]`) and the type they build, `CollectionsMarshal`, changing a collection during `foreach`; then how `foreach` is compiled, how `yield return` becomes a state machine and why its argument checks and `finally` blocks run late; then LINQ (language-integrated query) query and method syntax, deferred and immediate execution, multiple enumeration, `IEnumerable<T>` versus `IQueryable<T>` and expression trees, and the operators .NET 6 to .NET 10 added. Every behaviour ran on .NET 10 (C# 14). Not covered: thread-safe collections and channels (see `dotnet/concurrency/`), `IAsyncEnumerable<T>` (see `dotnet/async/`), spans (see `dotnet/performance/`), PLINQ (parallel LINQ) in depth, and Entity Framework Core.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [collections.md](collections.md) | concept | Arrays, `List<T>` doubling (0, 4, 8, 16 … measured), `Dictionary` hashing, mutable-key bug and undefined order, sets, `PriorityQueue` ties, read-only versus immutable versus frozen, what collection expressions build, `CollectionsMarshal`, "Collection was modified" | verified |
| [iterators.md](iterators.md) | concept | `foreach` lowering and pattern-based enumerators, struct enumerators (0 versus 40 bytes), `yield` compiled to a four-state machine, late argument checks and the split-method fix, `finally` only on end or `Dispose`, `yield` restrictions (CS1626, CS4007), multiple enumeration | verified |
| [linq.md](linq.md) | concept | Query syntax as method calls, deferred versus immediate and streaming versus non-streaming, captured variables read at run time, multiple enumeration, `IEnumerable<T>` versus `IQueryable<T>` and expression trees, operators from `Chunk` to `LeftJoin` and `Shuffle`, measured cost | verified |

## References
- [Collections and data structures](https://learn.microsoft.com/en-us/dotnet/standard/collections/) — Microsoft, living. Backs: subtopic scope.
- [Language Integrated Query (LINQ)](https://learn.microsoft.com/en-us/dotnet/csharp/linq/) — Microsoft, living. Backs: subtopic scope.

## Related
- `dotnet/index.md` — the C# and .NET topic.
- `dotnet/generics/variance.md` — array covariance and `IEnumerable<out T>`.
- `dotnet/concurrency/concurrent-collections-and-channels.md` — collections for several threads.
- `dotnet/async/cancellation-valuetask-and-async-streams.md` — async iterators and `await foreach`.
- `dotnet/errors-and-resources/disposal-and-finalization.md` — `using`, which `foreach` and iterators rely on for cleanup.
