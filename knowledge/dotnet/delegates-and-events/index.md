---
schema: topic-index/v1
kind: subtopic
topic: dotnet/delegates-and-events
last-updated: 2026-11-24
---

# C# delegates and events

Callbacks in C# and .NET: delegate types and `Func`/`Action`, multicast invocation (last return value, exceptions stop the list, rightmost removal), method-group and lambda conversions with their natural types and allocation costs, closures and the captured-variable rules (`for` versus `foreach`, `static` lambdas), and events built on delegates: field-like events and their thread-safe accessors, raising safely, the subscriber memory leak and weak subscriptions, and when to prefer `IObservable<T>` or a `Channel<T>`. Every behaviour was run on the .NET 10 SDK (software development kit) lab (`dotnet/lab-setup.md`). Not covered here: variance of generic delegates (`dotnet/generics/variance.md`), expression trees and LINQ, language-integrated query (`dotnet/collections-and-linq/`), `async void` handlers in depth (`dotnet/async/`), and user-interface framework event systems such as WPF (Windows Presentation Foundation) routed events.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [delegates-lambdas-and-closures.md](delegates-lambdas-and-closures.md) | concept | Delegate types, multicast invocation and removal, method groups and lambdas with natural types, closures and display classes, loop capture, and what each delegate source allocates | verified |
| [events.md](events.md) | concept | The `event` keyword and its compiler-made accessors, raising with `?.Invoke`, the `EventHandler<TEventArgs>` pattern, subscriber leaks and a weak forwarding handler, events versus callbacks, `IObservable<T>` and channels | verified |

## References
- [Delegates (C# programming guide)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/) — Microsoft, living. Backs: subtopic scope.
- [Handle and raise events](https://learn.microsoft.com/en-us/dotnet/standard/events/) — Microsoft, living. Backs: subtopic scope.

## Related
- `dotnet/generics/` — `Func` and `Action` as generic delegates, and their `in`/`out` variance.
- `dotnet/collections-and-linq/` — lambdas as LINQ predicates and closure capture in queries.
- `dotnet/concurrency/` — channels for decoupled producer-consumer messaging.
