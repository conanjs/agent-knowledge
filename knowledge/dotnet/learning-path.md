---
schema: knowledge-doc/v1
type: reference
topic: dotnet
status: verified
applies-to: ["the docs under knowledge/dotnet/ as of 2026-11-24", ".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, learning-path, curriculum]
ranked-sources: true
---

# C# and .NET learning path

## Summary
**TL;DR:** Ten stages from the platform and the first program to the runtime and web apps. Each stage lists the docs to read in order, one exercise to run in the file-based-app lab, and a self-check. Stage 1 is the platform, 2–5 the language, 6–7 asynchrony and threads, 8–9 how the runtime executes code and how to write fast or generated code, and 10 the application model used by real services.
**Use this when:** you start learning C# and .NET, come from another language and want an order to read the `dotnet/` docs in, or want to know which doc covers a part of Microsoft's C# and .NET documentation.
**Not this doc:** how to run the exercises → `dotnet/lab-setup.md`; exact versions and support dates → `dotnet/platform/csharp-and-dotnet-versions.md`.

## Scope
The 45 `knowledge-doc/v1` docs in the 14 subtopics under `knowledge/dotnet/`, plus `lab-setup.md`, all written and checked on 2026-11-24 against .NET 10 (runtime 10.0.12, SDK (software development kit) 10.0.401) and C# 14. Every exercise runs as `dotnet run <file>.cs` with `#:property PublishAot=false` as described in `dotnet/lab-setup.md`; none needs a NuGet package. Paths below are relative to `knowledge/dotnet/`.

## Catalog

### Stages

| # | Stage | Read (in order) | Exercise | Self-check: you can explain … |
|---|---|---|---|---|
| 1 | Platform and first program | `lab-setup.md` → `platform/runtime-and-versions.md` → `platform/projects-and-msbuild.md`; look things up in `platform/csharp-and-dotnet-versions.md` | Print `RuntimeInformation.FrameworkDescription` and the compiler's `#error version` line; then `dotnet project convert` the probe and read every line of the generated `.csproj` | … which file the `dotnet` host reads to pick a runtime and which one it reads to pick an SDK, and why a C# version is tied to a target framework |
| 2 | Language basics | `fundamentals/types-values-and-conversions.md` → `fundamentals/strings-and-text.md` → `fundamentals/control-flow-and-pattern-matching.md` → `fundamentals/methods-and-parameters.md` | Predict, then run, `max + 1` for `int max = int.MaxValue` with and without `checked`, `-7 % 3`, `(int)d` for `double d = 1e20`, `"👍".Length`, and `double.Parse("3.5")` under the current and the invariant culture (keep `max` and `d` in variables: the compiler checks constant expressions such as `int.MaxValue + 1` at compile time and rejects them) | … value versus reference copies, why `==` on strings is ordinal while `CompareTo` is culture-aware, and what makes a switch expression throw at run time |
| 3 | Designing types | `type-design/classes-structs-and-records.md` → `type-design/members-and-initialization.md` → `type-design/inheritance-and-interfaces.md` → `type-design/extension-members-and-operators.md` → `type-design/nullable-reference-types.md` | Use a plain `struct (string Region, int Id)` and a `record struct` with the same fields as `Dictionary` keys for 3,000 entries; count distinct hash codes and time the lookups | … what the compiler generates for a record, why `const` values are baked into callers, `override` versus `new`, and why `string?` has no run-time check while `int?` does |
| 4 | Generics and functions | `generics/generics-and-constraints.md` → `generics/variance.md` → `generics/generic-math.md` → `delegates-and-events/delegates-lambdas-and-closures.md` → `delegates-and-events/events.md` | Write one `Sum<T>` over `INumberBase<T>` and call it with `int`, `double` and `decimal`; then build lambdas in a `for` and in a `foreach` loop over the loop variable and print what each one captured | … why `IEnumerable<Cat>` converts to `IEnumerable<Animal>` but `List<Cat>` does not, and why subscribing to a long-lived event can keep a large subscriber object alive |
| 5 | Data and errors | `collections-and-linq/collections.md` → `collections-and-linq/iterators.md` → `collections-and-linq/linq.md` → `errors-and-resources/exceptions.md` → `errors-and-resources/disposal-and-finalization.md` | Print `List<int>.Capacity` after each `Add` up to 70; write an iterator that validates its argument and see when the exception appears; write a file with a `StreamWriter` with and without `using` | … deferred execution and multiple enumeration, `throw;` versus `throw ex;`, and what a finalizer can and cannot guarantee |
| 6 | Async | `async/tasks-and-async-await.md` → `async/synchronization-context-and-configureawait.md` → `async/cancellation-valuetask-and-async-streams.md` | Reproduce a sync-over-async deadlock under a single-threaded `SynchronizationContext` you write yourself, with a `Wait` timeout so the probe ends; then fix it with `ConfigureAwait(false)` | … what `await` does when the task is not finished, where the continuation runs, when a task ends `Canceled` instead of `Faulted`, and the two rules of `ValueTask` |
| 7 | Threads and shared memory | `concurrency/threads-and-the-thread-pool.md` → `concurrency/locks-and-interlocked.md` → `concurrency/memory-model.md` → `concurrency/concurrent-collections-and-channels.md` | Run 4 threads × 1,000,000 `count++` on one field, then fix it with `Interlocked.Increment` and with a `lock`; build a bounded `Channel<T>` producer–consumer | … thread-pool starvation, why a plain `bool` flag loop can spin forever in a Release build, and why `GetOrAdd` can run its factory more than once |
| 8 | The runtime | `runtime/jit-tiering-and-aot.md` → `runtime/garbage-collection.md` → `runtime/object-layout-and-boxing.md` | Allocate `byte[84_975]` and `byte[84_976]` and print `GC.GetGeneration` of each; time a hot loop's first and later batches in a `-c Release` build, with and without `DOTNET_TieredCompilation=0` | … tier 0, tier 1 and on-stack replacement, the generations and the large object heap, the minimum object size, and when a value type is boxed |
| 9 | Fast and generated code | `performance/span-and-memory.md` → `performance/ref-safety-and-ref-structs.md` → `performance/measuring-and-reducing-allocations.md` → `metaprogramming/reflection-and-attributes.md` → `metaprogramming/source-generators.md` → `metaprogramming/interop-and-unsafe.md` | Parse a comma-separated line with `Split` and with spans, measuring bytes with `GC.GetAllocatedBytesForCurrentThread`; add a `[GeneratedRegex]`, set `EmitCompilerGeneratedFiles=true` and read the generated file | … why a `Span<T>` cannot be stored in a class field, why measurements need warm-up and Release, and what reflection costs under trimming and Native AOT (ahead-of-time compilation) |
| 10 | Building applications | `app-model/dependency-injection.md` → `app-model/host-configuration-options-and-logging.md` → `app-model/system-text-json.md` → `app-model/httpclient-and-ihttpclientfactory.md` → `app-model/aspnet-core-pipeline.md` → `tooling/analyzers-and-code-quality.md` → `tooling/testing.md` | With `#:sdk Microsoft.NET.Sdk.Web`, start a minimal API on `127.0.0.1:0`, add one middleware that times each request and one scoped service, call it with `HttpClient`, print the status codes, and stop the app | … singleton, scoped and transient lifetimes and the captive-dependency bug, configuration precedence, why middleware order matters, and why one `HttpClient` per request exhausts sockets |

### Microsoft documentation areas and the docs that cover them

| Microsoft Learn area | Doc(s) here |
|---|---|
| .NET fundamentals: introduction, SDK and CLI (command-line interface), versions and support, project files | `platform/runtime-and-versions.md`, `platform/projects-and-msbuild.md`, `platform/csharp-and-dotnet-versions.md`, `lab-setup.md` |
| C# guide: tour of C#, program structure, type system, built-in types | `fundamentals/types-values-and-conversions.md`, `type-design/classes-structs-and-records.md` |
| C# guide: strings; .NET globalization and string comparison | `fundamentals/strings-and-text.md` |
| C# reference: statements, patterns, switch expression | `fundamentals/control-flow-and-pattern-matching.md` |
| C# reference: methods, parameters, tuples | `fundamentals/methods-and-parameters.md` |
| C# guide: object-oriented programming, classes, records, interfaces, properties | `type-design/members-and-initialization.md`, `type-design/inheritance-and-interfaces.md` |
| C# reference: extension members, operator overloading, nullable value and reference types | `type-design/extension-members-and-operators.md`, `type-design/nullable-reference-types.md` |
| .NET fundamentals: generics, covariance and contravariance, generic math | `generics/` (3 docs) |
| C# guide: delegates and events, lambda expressions | `delegates-and-events/` (2 docs) |
| .NET fundamentals: collections; C# guide: iterators and LINQ (Language-Integrated Query) | `collections-and-linq/` (3 docs) |
| C# guide: exceptions; .NET fundamentals: `Dispose` and garbage collection | `errors-and-resources/` (2 docs), `runtime/garbage-collection.md` |
| C# guide: asynchronous programming; .NET: task-based asynchronous pattern | `async/` (3 docs) |
| .NET: managed threading, thread-safe collections, channels | `concurrency/` (4 docs) |
| .NET runtime: compilation config, garbage collector config, native AOT deployment | `runtime/` (3 docs) |
| .NET: memory and span usage guidelines; C# reference: `ref` safety | `performance/` (3 docs) |
| .NET: reflection, attributes, source generators, native interop; C# reference: unsafe code | `metaprogramming/` (3 docs) |
| .NET extensions: DI (dependency injection), generic host, configuration, options, logging; `System.Text.Json`; `HttpClient` | `app-model/` (first 4 docs) |
| ASP.NET Core fundamentals: middleware, routing, minimal APIs, error handling | `app-model/aspnet-core-pipeline.md` |
| .NET testing; code analysis and `dotnet format` | `tooling/` (2 docs) |

### Free, authoritative resources

| Resource | Why |
|---|---|
| [C# guide](https://learn.microsoft.com/en-us/dotnet/csharp/) | Microsoft's own path through the language, with a tour and tutorials |
| [C# language specification](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/readme) | The normative rules behind every language claim |
| [.NET fundamentals](https://learn.microsoft.com/en-us/dotnet/fundamentals/) | Runtime, libraries, deployment and tools |
| [dotnet/runtime design docs](https://github.com/dotnet/runtime/tree/main/docs/design) | The Book of the Runtime and specs such as the memory model |

### Not yet covered in this knowledge base

| Topic | Fits under | Start with |
|---|---|---|
| Windows-only pieces: the `WeakEventManager` of WPF (Windows Presentation Foundation), Microsoft Fakes (Visual Studio Enterprise) | `dotnet/delegates-and-events/`, `dotnet/tooling/` | a Windows lab |
| Native AOT test runs (TUnit, Microsoft.Testing.Platform) and the C# 15 static interface members for older runtimes | `dotnet/tooling/`, `dotnet/generics/` | `tooling/testing.md`; "What's new in C# 15" |
| `HttpClient` behaviour behind a slow DNS server | `dotnet/app-model/` | `app-model/httpclient-and-ihttpclientfactory.md` |
| Entity Framework Core, Blazor, .NET MAUI (Multi-platform App UI) and other app frameworks | a new topic each | their official docs |

## Lookup notes
- Every behaviour in the stage docs ran on macOS 26.1 arm64. That machine's culture is `en-VN`, so probes that print numbers set the invariant culture; a probe that leaves it out prints `3,5` for 3.5.
- Timings in the docs come from one Apple M2 machine that was also running other work; compare the ratios, not the absolute numbers.
- Where the lab and a Microsoft page disagreed, the doc's Edge cases table keeps both, with the version that was run.

## Takeaways
- Follow stages 1–5 in order; stages 6–10 can be read in any order once the language is familiar, but stage 7 assumes stage 6.
- Run each exercise before reading the matching doc's Worked example, then compare.

## Verification status
- Verified: 0 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET 10 lab every exercise runs in.
- [C# guide](https://learn.microsoft.com/en-us/dotnet/csharp/) — Microsoft, living. Rank 1. Backs: the documentation-area map and the resources table.
- [.NET fundamentals documentation](https://learn.microsoft.com/en-us/dotnet/fundamentals/) — Microsoft, living. Rank 1. Backs: the documentation-area map.
- [ASP.NET Core fundamentals overview](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/) — Microsoft, living. Rank 1. Backs: the documentation-area map.
- [C# language specification](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/readme) — Ecma International and Microsoft, living. Rank 1. Backs: the resources table.
- [dotnet/runtime design documents](https://github.com/dotnet/runtime/tree/main/docs/design) — .NET team, living. Rank 1. Backs: the resources table.

## Related
- `dotnet/index.md` — the subtopic list.
- `concurrency/` — cross-language concurrency, next to stage 7.
- `error-handling/` — cross-language error design, next to stage 5.
