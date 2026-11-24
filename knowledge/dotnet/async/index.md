---
schema: topic-index/v1
kind: subtopic
topic: dotnet/async
last-updated: 2026-11-24
---

# Async programming in .NET

How `async`/`await` works in C# on .NET 10: what the compiler generates, how tasks carry results, exceptions and cancellation, where continuations run (`SynchronizationContext`, `TaskScheduler`, `ConfigureAwait`) and why blocking on a task deadlocks, how `ExecutionContext` and `AsyncLocal<T>` flow, how cooperative cancellation and timeouts work, when `ValueTask<T>` pays off, and how async streams (`IAsyncEnumerable<T>`, `await foreach`) are consumed. Every behaviour was run in the lab (`dotnet/lab-setup.md`), including a real sync-over-async deadlock under a single-threaded context. Not covered: threads, the thread pool, locks and the memory model (see `dotnet/concurrency/`), and UI (user interface) framework specifics (WPF, Windows Presentation Foundation; WinForms; MAUI, .NET Multi-platform App UI).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [tasks-and-async-await.md](tasks-and-async-await.md) | concept | `Task`, the compiler's state machine and builder, the awaiter pattern and the synchronous fast path, exception propagation (`await` versus `.Result`), `async void` crashes, `WhenAll`/`WhenAny`/`WhenEach`, fire-and-forget, `TaskCompletionSource` | verified |
| [synchronization-context-and-configureawait.md](synchronization-context-and-configureawait.md) | concept | Where continuations run, `ConfigureAwait(false)` and `ConfigureAwaitOptions`, the sync-over-async deadlock reproduced, ASP.NET Core's missing context, `ExecutionContext` and `AsyncLocal<T>` flow | verified |
| [cancellation-valuetask-and-async-streams.md](cancellation-valuetask-and-async-streams.md) | concept | Cooperative cancellation and task states, linked tokens, `CancelAfter` and `WaitAsync` timeouts, `ValueTask<T>` allocation and consumption rules, `IAsyncEnumerable<T>`, `[EnumeratorCancellation]`, `ConfigureAwait` on streams | verified |

## References
- [Asynchronous programming with async and await](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/) — Microsoft, living. Backs: subtopic scope.
- [Task-based asynchronous pattern (TAP)](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/task-based-asynchronous-pattern-tap) — Microsoft, living. Backs: subtopic scope.

## Related
- `dotnet/concurrency/` — threads, the thread pool, locks, the memory model, concurrent collections and channels.
- `dotnet/learning-path.md` — the order to read the `dotnet/` docs in.
- `concurrency/` — cross-language structured concurrency and blocking in async runtimes.
