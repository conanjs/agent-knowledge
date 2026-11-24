---
schema: topic-index/v1
kind: topic
topic: dotnet
last-updated: 2026-11-24
---

# C# and .NET

The C# language and the .NET platform from the basics to the runtime, written in our own words from Microsoft's own sources: the C# guide and language reference, the C# standard, the .NET fundamentals and API docs, the ASP.NET Core docs, the `dotnet/runtime` design documents and the .NET release notes. Fourteen subtopics go from the platform and toolchain, through types, strings, pattern matching, classes, structs, records, generics, delegates, collections, LINQ and exceptions, to async/await, threads and the memory model, the JIT and the garbage collector, spans and allocation-free code, reflection, source generators and interop, the application model (dependency injection, configuration, logging, JSON, `HttpClient`, the ASP.NET Core pipeline), and testing and analyzers. Behaviours were run on the .NET 10 SDK (C# 14; `lab-setup.md`), as a file-based app or, where an example needs one (test frameworks, analyzer settings), as a small project. Start with `learning-path.md`. .NET 11 and C# 15 behaviours were run in the official .NET 11 SDK container, and test frameworks, BenchmarkDotNet, `dotnet-counters`, the HTTP resilience handler and ReadyToRun with pinned packages kept in a lab folder (`lab-setup.md` Steps 11–13). Not covered: UI frameworks (WPF, WinForms, MAUI, Blazor), Entity Framework Core, the .NET Framework beyond how it differs, third-party libraries, and doc-comment conventions (see `code-documentation/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [learning-path.md](learning-path.md) | reference | Ten stages from the platform to web apps, each with the docs to read, an exercise and a self-check, plus a map from Microsoft's documentation areas to these docs | verified |
| [lab-setup.md](lab-setup.md) | how-to | Run every C# example as a file-based app (`dotnet run probe.cs`) on the .NET 10 SDK with no NuGet download, and read the SDK, runtime and C# versions; keep pinned packages and tools in lab folders, and run .NET 11 examples in the official SDK container | verified |

## Subtopics
| Subtopic | Summary |
|---|---|
| [platform/](platform/index.md) | Roslyn (the C# compiler), IL (intermediate language), the CLR (common language runtime) and the BCL (base class library); SDK versus runtime, target frameworks, roll-forward and the support policy; SDK-style projects, MSBuild and NuGet; a C# and .NET version catalog |
| [fundamentals/](fundamentals/index.md) | Value and reference types, numeric conversions and overflow; strings, UTF-16 and culture-aware comparison; control flow and pattern matching; methods and parameters |
| [type-design/](type-design/index.md) | Classes, structs and records; members, properties and initialization; inheritance and interfaces; extension members and operators; nullable reference types |
| [generics/](generics/index.md) | Generic types and constraints and how the runtime instantiates them; covariance and contravariance; generic math with static abstract interface members |
| [delegates-and-events/](delegates-and-events/index.md) | Delegates, lambdas and closures; events and the subscriber-leak trap |
| [collections-and-linq/](collections-and-linq/index.md) | Arrays, lists, dictionaries, immutable and frozen collections, collection expressions; iterators and `yield`; LINQ, deferred execution and `IQueryable` |
| [errors-and-resources/](errors-and-resources/index.md) | Exceptions, filters and stack traces; `IDisposable`, `using`, finalizers and `SafeHandle` |
| [async/](async/index.md) | Tasks and the async state machine; `SynchronizationContext`, `ConfigureAwait` and deadlocks; cancellation, `ValueTask` and async streams |
| [concurrency/](concurrency/index.md) | Threads and the thread pool; locks and `Interlocked`; the .NET memory model; concurrent collections and channels |
| [runtime/](runtime/index.md) | The JIT (just-in-time compiler), tiered compilation, Dynamic PGO (profile-guided optimization), ReadyToRun and Native AOT (ahead-of-time compilation); the garbage collector; object layout, boxing and dispatch |
| [performance/](performance/index.md) | `Span<T>` and `Memory<T>`; `ref` safety and `ref struct`; measuring and reducing allocations |
| [metaprogramming/](metaprogramming/index.md) | Reflection and attributes; source generators; unsafe code and native interop |
| [app-model/](app-model/index.md) | Dependency injection; the generic host, configuration, options and logging; `System.Text.Json`; `HttpClient` and `IHttpClientFactory`; the ASP.NET Core request pipeline |
| [tooling/](tooling/index.md) | Test frameworks and runners; analyzers, warnings and code style |

## References
- [C# guide](https://learn.microsoft.com/en-us/dotnet/csharp/) — Microsoft, living. Backs: topic scope.
- [.NET fundamentals documentation](https://learn.microsoft.com/en-us/dotnet/fundamentals/) — Microsoft, living. Backs: topic scope.
- [.NET releases index](https://github.com/dotnet/core/blob/main/release-notes/releases-index.json) — .NET team, living. Backs: the .NET versions covered.

## Related
- `code-documentation/` — C# XML doc comments next to other languages' standards.
- `concurrency/` — cross-language structured concurrency, blocking in async runtimes, data races.
- `error-handling/` — cross-language error design.
- `rust/`, `javascript/` — the same basics-to-advanced curriculum for other languages.
