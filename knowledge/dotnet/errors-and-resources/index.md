---
schema: topic-index/v1
kind: subtopic
topic: dotnet/errors-and-resources
last-updated: 2026-11-24
---

# C# exceptions, disposal and finalization

How C# code fails and cleans up: `throw`, `try`/`catch`/`finally` and the two-pass search-then-unwind model, `when` filters, `throw;` versus `throw ex;` and `ExceptionDispatchInfo`, inner exceptions and `AggregateException`, custom exception types and the built-in throw helpers, what an unhandled exception or a stack overflow does to the process, and what throwing costs compared with `Try…` methods; then `IDisposable`, `using` statements and declarations and their `try`/`finally` lowering, `IAsyncDisposable` and `await using`, the `Dispose(bool)` pattern, finalizers (thread, order, resurrection, none at exit), `GC.SuppressFinalize`, `SafeHandle`, and what a forgotten `Dispose` really does. Every behaviour ran on .NET 10 (C# 14). Not covered: exceptions in `async` code and `async void` (see `dotnet/async/`), cancellation (see `dotnet/async/cancellation-valuetask-and-async-streams.md`), the garbage collector itself (see `dotnet/runtime/garbage-collection.md`), and error design across languages (see `error-handling/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [exceptions.md](exceptions.md) | concept | Search and unwind passes (filters run before inner `finally`), `throw;` versus `throw ex;`, `ExceptionDispatchInfo`, `AggregateException`, unhandled exceptions and stack overflow (exit 134 measured), throw helpers, custom exceptions, about 3.8 µs per exception against `TryParse`, the .NET 9 exception-handling switch gone in .NET 10 | verified |
| [disposal-and-finalization.md](disposal-and-finalization.md) | concept | `using` lowering, declarations and `await using`, the dispose pattern and `SuppressFinalize`, finalizer thread, order, two collections and resurrection, no finalizers at exit, throwing finalizers crash the process, `SafeHandle`, a forgotten `FileStream` versus `StreamWriter` | verified |

## References
- [Handling and throwing exceptions in .NET](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/) — Microsoft, living. Backs: subtopic scope.
- [Cleaning up unmanaged resources](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/unmanaged) — Microsoft, living. Backs: subtopic scope.

## Related
- `dotnet/index.md` — the C# and .NET topic.
- `dotnet/async/tasks-and-async-await.md` — exceptions stored in tasks and `async void`.
- `dotnet/runtime/garbage-collection.md` — the collector that runs finalizers.
- `dotnet/collections-and-linq/iterators.md` — `foreach` and iterator cleanup through `Dispose`.
- `error-handling/` — error design across languages.
