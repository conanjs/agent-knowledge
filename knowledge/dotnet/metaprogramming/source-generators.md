---
schema: knowledge-doc/v1
type: concept
topic: dotnet/metaprogramming
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "Roslyn 5.9 (SDK 10.0.401)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, roslyn, source-generators, incremental-generators, generatedregex, loggermessage, jsonserializercontext, libraryimport, partial-members, interceptors, emitcompilergeneratedfiles]
ranked-sources: true
---

# Source generators

## Summary
**TL;DR:** A source generator is a plug-in that runs inside the C# compiler (Roslyn), reads your code, and adds new C# files to the same compilation; at run time only ordinary compiled code is left. The pattern is always the same: you declare a `partial` member and mark it with an attribute (`[GeneratedRegex]`, `[LoggerMessage]`, `[JsonSerializable]`, `[LibraryImport]`), and the generator writes the other half. Generators may only add code, never change yours; interceptors (stable since the .NET 9.0.2xx SDK, software development kit) are the one controlled exception, letting generated code replace specific calls.
**Use this when:** you want to replace run-time reflection or `RegexOptions.Compiled` with compile-time code, read what a generator wrote, get CS9248 or CS0260 around a `partial` member, or write a small generator yourself.
**Not this doc:** reflection itself → `dotnet/metaprogramming/reflection-and-attributes.md`; what `[LibraryImport]` marshals → `dotnet/metaprogramming/interop-and-unsafe.md`; JSON (JavaScript Object Notation) options and converters → `dotnet/app-model/system-text-json.md`; logging levels and templates → `dotnet/app-model/host-configuration-options-and-logging.md`; analyzers, the other kind of compiler plug-in → `dotnet/tooling/analyzers-and-code-quality.md`.

## Problem
Work that depends only on facts known when compiling is often done at run time anyway, and each time it costs:
- `new Regex(pattern, RegexOptions.Compiled)` parses the pattern and emits IL (intermediate language) at run time; in the lab that took about 8–12 ms before the first match.
- Reflection-based JSON serialization discovers its types at run time, out of sight of the trimmer and of Native AOT (ahead-of-time compilation), and the marshalling stubs behind `[DllImport]` are produced at run time as well.
- The logger extension methods such as `logger.LogInformation("Order {Id}", id)` box value types and parse the message template every time a message is written ✅[^hp-logging].

Moving that work into the build removes the run-time cost, but the generated code is invisible by default, so its rules (everything must be `partial`; nothing may be rewritten) show up only as compiler errors.

## Mental model
**Analogy:** a print shop that fills in forms. You hand in a form with blank boxes marked "office use" (a `partial` member with an attribute). Before the form is bound into the book (the compilation), a clerk (the generator) fills in the blanks from what is printed elsewhere on the form. The clerk may add pages, never cross out yours, and the reader of the finished book never meets the clerk.

**Artifact** (run in the lab ✅[^lab]):
```csharp
// what you write
static partial class Patterns
{
    [GeneratedRegex(@"(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})")]
    public static partial Regex Iso();
}
// what the generator wrote, abridged, in obj/debug/generated/System.Text.RegularExpressions.Generator/…/RegexGenerator.g.cs
//   public static partial Regex Iso() => global::System.Text.RegularExpressions.Generated.Iso_0.Instance;
//   file sealed class Iso_0 : Regex { internal static readonly Iso_0 Instance = new(); … }
Console.WriteLine(ReferenceEquals(Patterns.Iso(), Patterns.Iso()));    // True: one cached instance
Console.WriteLine(Patterns.Iso().Match("due 2026-11-24").Value);       // 2026-11-24
```

## How it works
Four actors, three of them at build time:
- **You** — your job: declare the shape, via a `partial` member and the generator's marker attribute.
- **The compiler (Roslyn)** — its job: parse and bind your code, run every generator it was given, then compile your files plus theirs into one assembly, via `csc` inside `dotnet build`.
- **The generator** — its job: inspect the compilation and add source text, via the `IIncrementalGenerator` pipeline in an analyzer assembly.
- **The runtime** — its job: run the result, via ordinary IL; it never sees the generator.

```
dotnet build ──────────────────────────────────────────────────────────────▶  dotnet run
your .cs files ─┐                                                             runtime loads
                ▼                                                             one assembly:
         Roslyn parses + binds ──▶ generator pipeline (in the compiler):      your code +
                                     post-init: add marker attribute          generated code,
                                     FAWMN: find [GeneratedRegex] members     both plain IL
                                     transform → equatable model (strings)
                                     output: AddSource("X.g.cs")
                ◀───────────────── new syntax trees join the compilation
         Roslyn binds again, reports errors (CS0260, CS9248), emits IL ────▶
```

1. **Compiler: generators are analyzer assemblies.** They are passed to the compiler with the `-analyzer:` option and carry `[Generator]`; one assembly may mix analyzers and generators ✅[^incr-gen]. The SDK's built-in generators ship in the targeting packs: `packs/Microsoft.NETCore.App.Ref/10.0.12/analyzers/dotnet/cs/` holds the regex, JSON, `LibraryImport`, COM (Component Object Model) and JavaScript-import generators, and the ASP.NET Core pack adds the logging, options, configuration-binding and request-delegate generators ✅[^lab].
2. **Generator: one pipeline, built once.** `IIncrementalGenerator.Initialize` is called once per host (the integrated development environment or the command-line compiler), and instead of running code directly it defines a graph of transformations (`Select`, `Where`, `Collect`, `Combine`) over input providers such as the compilation, additional files and analyzer config options ✅[^incr-gen]. The steps run later, when their inputs change, and each step's output is cached and compared, by default with `EqualityComparer<T>` ✅[^incr-gen]. Models passed between steps should therefore be value-equatable (records, strings), never symbols, which are not equatable and keep old compilations in memory ✅[^cookbook]. The older `ISourceGenerator` interface is deprecated in favour of this one ✅[^srcgen-v1].
3. **Generator: finding the targets.** `SyntaxProvider.ForAttributeWithMetadataName` (FAWMN) filters by attribute name through an index before any user callback runs, and is at least 99 times more efficient than `CreateSyntaxProvider` ✅[^cookbook]. `RegisterPostInitializationOutput` adds fixed source (typically the marker attribute itself) before anything else runs; `RegisterSourceOutput` adds a file per model ✅[^incr-gen].
4. **Generator: additive only.** A generator adds source to the compilation and may not modify existing user code; generators run unordered, each seeing the same input and none seeing another's output ✅[^srcgen-v1]. That is why every target must be `partial`: in the lab, removing `partial` from a class the generator extends gave error CS0260 "Missing partial modifier" ✅[^lab].
5. **Language: partial members are the sockets.** A partial member has a declaring part without a body and an implementing part with one; C# 13 added partial properties and indexers, and C# 14 partial instance constructors and events ✅[^partial-member] ✅[^cs14]. A partial method needs no implementation only if it is `void`, has no access modifier, no `out` parameters and no `virtual`/`override`/`sealed`/`new`/`extern`; any other partial member must be implemented ✅[^partial-member]. A missing part is error CS9248 for a property and CS8795 for a method with an access modifier ✅[^lab]. Only the implementing part of a partial constructor may have a `this()` or `base()` initializer ✅[^cs14]. In the lab a partial constructor and a partial event compiled and ran under C# 14; a missing implementing part was CS9275 for both, `: base()` on the declaring part was CS9280, and `LangVersion=13` reported CS9260 "Feature 'partial events and constructors' is not available in C# 13.0" ✅[^lab].
6. **Built-in: `[GeneratedRegex]`** (.NET 7; on partial properties from .NET 9) makes the generator emit a `Regex`-derived class with matching logic like `RegexOptions.Compiled`, plus a cached singleton, so no caching is needed by callers; the generator ignores `RegexOptions.Compiled` and, for `RegexOptions.NonBacktracking`, falls back to caching an ordinary `Regex` ✅[^regex-gen]. The generated class is a `file` type, so its run-time name is mangled (`<RegexGenerator_g>FC5F…__Iso_0`) ✅[^lab].
7. **Built-in: `[LoggerMessage]`** on a `partial void` method makes the generator implement it on top of `LoggerMessage.Define` ✅[^logging-gen]. In the lab the generated body checks `logger.IsEnabled(level)` first and then calls a cached delegate, so a Debug call with the level off did nothing ✅[^lab]. In the lab, without NuGet packages, it needed the ASP.NET Core shared framework, for example `#:sdk Microsoft.NET.Sdk.Web` ✅[^lab].
8. **Built-in: `JsonSerializerContext`.** A `partial` class deriving from it, marked `[JsonSerializable(typeof(T))]`, gets generated metadata and fast-path serializers, both modes by default ✅[^stj-gen]; fast-path code does not deserialize ✅[^stj-modes]. In the lab the generator wrote one file per type (`AppJson.Order.g.cs`, `AppJson.Line.g.cs`, `AppJson.ListLine.g.cs`, …) and `OrderSerializeHandler` calls `writer.WriteNumber` and `writer.WriteString` directly ✅[^lab].
9. **Built-in: `[LibraryImport]`** (.NET 7) on a `static partial` method generates the native-call marshalling at compile time, replacing the IL stub that the runtime otherwise generates at run time for `[DllImport]`, and that the JIT (just-in-time compiler) then compiles ✅[^pinvoke-gen]. Details in `dotnet/metaprogramming/interop-and-unsafe.md`.
10. **Seeing the output.** By default generated files exist only in memory; `EmitCompilerGeneratedFiles=true` writes them under the intermediate folder, `obj/<configuration>/<tfm>/generated` unless `CompilerGeneratedFilesOutputPath` says otherwise ✅[^msbuild-props]. Each file sits in `<generator assembly>/<generator type>/` ✅[^lab].
11. **Interceptors: the controlled exception.** An interceptor is a method that, at compile time, replaces a call to another method at a source location it names with `[InterceptsLocation(version, data)]`, where `data` is an opaque string ✅[^interceptors]. The feature was experimental in .NET 8 (C# 12) and is stable from the .NET 9.0.2xx SDK; a project must list the allowed namespaces in `<InterceptorsNamespaces>` ✅[^interceptors] ✅[^history]. In the lab, `EnableConfigurationBindingGenerator=true` made the SDK add the binder's namespace to `InterceptorsPreviewNamespaces`, and the generated `BindingExtensions.g.cs` intercepted `config.GetSection("Shop").Get<ShopOptions>()` with `[InterceptsLocation(1, "kYSM…")] // g-srcgen-logging-binder.cs(20,38)` ✅[^lab].

## Worked example
A hand-written generator, `AutoToString`, built and used in the lab with no NuGet package: the generator project targets `net10.0` and references the SDK's own `Roslyn/bincore/Microsoft.CodeAnalysis.dll` and `Microsoft.CodeAnalysis.CSharp.dll`; the app references it with `OutputItemType="Analyzer" ReferenceOutputAssembly="false"` ✅[^lab]. (The cookbook lists framework targets for generators as an open question ✅[^cookbook]; the command-line compiler loaded a `net10.0` generator.)

| Step | Who | What happens | Real value ✅[^lab] |
|---|---|---|---|
| 1 | You | Mark a class | `[AutoToString] partial class Person { public string Name …; public int Age … }` |
| 2 | Generator, post-init | Adds the marker attribute before user code is read | `AutoToStringAttribute.g.cs` |
| 3 | Generator, FAWMN + transform | Finds `Person`, extracts strings only | model `("Person", "Name,Age")` |
| 4 | Generator, source output | Adds one file per model | `Person.AutoToString.g.cs`: `partial class Person { public override string ToString() => $"Person {{ Name = {Name}, Age = {Age} }}"; }` |
| 5 | Compiler | Compiles both halves into `App.dll` | files under `obj/Debug/net10.0/generated/Generator/AutoToStringGenerator/` |
| 6 | Runtime | `Console.WriteLine(new Person { Name = "Lan", Age = 30 })` | `Person { Name = Lan, Age = 30 }`; a class without the attribute prints `Plain` |
| 7 | Compiler | `partial` removed from `Person` | `error CS0260: Missing partial modifier on declaration of type 'Person'` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| The generated regex in a short benchmark | After one warm-up scan of 1.3 MB, generated code took about 9–14 ms against 4–6 ms for `RegexOptions.Compiled`; after 50 warm-up scans, about 3.1 ms against 3.5 ms; with `DOTNET_TieredCompilation=0`, 3.7 ms after one ✅[^lab] | Generated C# is JIT-compiled like any method, starting at tier 0, while the doc promises the throughput of `Compiled` ✅[^regex-gen]; it holds once the code is fully optimized |
| Generated files of a file-based app | Written to `obj/debug/generated/…`, without the target-framework folder ✅[^lab] | The documented default is `obj/<configuration>/<tfm>/generated` ✅[^msbuild-props]; a regular project in the lab used `obj/Debug/net10.0/generated` ✅[^lab] |
| `GeneratedCodeAttribute` version | Generated files are stamped `10.0.14.42308` while the targeting pack folder is `10.0.12` ✅[^lab] | The stamp copies the generator assembly's file version (`10.0.14.42308`); its product version is `10.0.12+95017c71…` ✅[^lab] |
| A partial property without its implementing part | error CS9248 ✅[^lab] | Partial properties always need one ✅[^partial-member] |
| `partial void OnHook();` with no body, called | Compiles; the call is removed ✅[^lab] | Optional partial methods ✅[^partial-member] |
| A generator model holding `ISymbol` | The cache never hits and memory grows | Symbols are not equatable ✅[^cookbook] |
| `[LoggerMessage]` in a plain console file-based app | errors CS0234 and CS0246: `Microsoft.Extensions` and `ILogger` not found ✅[^lab] | `Microsoft.Extensions.Logging` is part of the ASP.NET Core shared framework; `#:sdk Microsoft.NET.Sdk.Web` brings it offline ✅[^lab] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `new Regex(p)` (interpreter) | Pattern can come from data | In the lab about 2.3–7 ms to build and first match, and about 10–13 ms per 1.3 MB scan ✅[^lab] |
| `RegexOptions.Compiled` | Fast scans from the first run (about 3.5–5.7 ms) ✅[^lab] | About 8–12 ms to build in the lab ✅[^lab]; uses `Reflection.Emit`, so no Native AOT ✅[^regex-gen] |
| `[GeneratedRegex]` | About 0.8–1.6 ms to first match and about 3.1 ms per scan once tiered up ✅[^lab]; trimmable, AOT-friendly, debuggable source ✅[^regex-gen] | Pattern fixed at compile time; more code in the assembly ✅[^regex-gen] |
| Writing your own generator | Removes reflection from your own hot paths | A pipeline to keep equatable and cached; test it and ship it as an analyzer |

## Takeaways
- Use `[GeneratedRegex]`, `[LoggerMessage]`, a `JsonSerializerContext` and `[LibraryImport]` whenever the pattern, template, type or signature is known when compiling. [rule-candidate]
- When a generated member misbehaves, set `EmitCompilerGeneratedFiles=true` and read the file; it is plain C#.
- In your own generators, use `ForAttributeWithMetadataName` and pass only value-equatable models (strings, records) between steps. [rule-candidate]
- Mark every type and member a generator completes as `partial`; a generator cannot add the keyword for you.

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Regular expression source generators](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-source-generators) — Microsoft, living. Rank 1. Backs: `[GeneratedRegex]` since .NET 7, partial properties since .NET 9, generated `Regex` subclass and cached instance, `Compiled` ignored, `NonBacktracking` fallback, benefits and the size cost. [^regex-gen]
- [High-performance logging](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/high-performance-logging) — Microsoft, living. Rank 1. Backs: logger extension methods box value types and parse the template on every call. [^hp-logging]
- [Compile-time logging source generation](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/source-generation) — Microsoft, living. Rank 1. Backs: `[LoggerMessage]` on partial methods, built on `LoggerMessage.Define`. [^logging-gen]
- [How to use source generation in System.Text.Json](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation) — Microsoft, living. Rank 1. Backs: `JsonSerializerContext` and `[JsonSerializable]`; both modes by default. [^stj-gen]
- [Source-generation modes in System.Text.Json](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation-modes) — Microsoft, living. Rank 1. Backs: fast-path serialization does not deserialize. [^stj-modes]
- [Source generation for platform invokes](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation) — Microsoft, living. Rank 1. Backs: `[LibraryImport]` since .NET 7; the run-time IL stub of `[DllImport]`. [^pinvoke-gen]
- [Partial member](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/partial-member) — Microsoft, living. Rank 1. Backs: declaring and implementing parts; when an implementation is optional; C# 13 and C# 14 additions. [^partial-member]
- [What's new in C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) — Microsoft, living. Rank 1. Backs: partial constructors and events; only the implementing constructor has an initializer. [^cs14]
- [The history of C#](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) — Microsoft, living. Rank 1. Backs: interceptors as a C# 12 experimental preview. [^history]
- [MSBuild properties for Microsoft.NET.Sdk](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props) — Microsoft, living. Rank 1. Backs: `EmitCompilerGeneratedFiles`, `CompilerGeneratedFilesOutputPath` and the default folder. [^msbuild-props]
- [Incremental generators](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.md) — .NET Roslyn team, living. Rank 1. Backs: `IIncrementalGenerator`, `-analyzer:`, `Initialize` once per host, the deferred and cached pipeline, `EqualityComparer<T>`, the output kinds. [^incr-gen]
- [Incremental generators cookbook](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.cookbook.md) — .NET Roslyn team, living. Rank 1. Backs: value-equatable models, symbols not equatable, FAWMN at least 99 times faster, framework targets as an open question. [^cookbook]
- [Source generators (v1 design)](https://github.com/dotnet/roslyn/blob/main/docs/features/source-generators.md) — .NET Roslyn team, living. Rank 1. Backs: `ISourceGenerator` deprecated; additive only; unordered. [^srcgen-v1]
- [Interceptors](https://github.com/dotnet/roslyn/blob/main/docs/features/interceptors.md) — .NET Roslyn team, living. Rank 1. Backs: `[InterceptsLocation(version, data)]`; experimental in .NET 8, stable from the .NET 9.0.2xx SDK; `InterceptorsNamespaces` opt-in. [^interceptors]

## Related
- `dotnet/metaprogramming/reflection-and-attributes.md` — the run-time approach generators replace, and why the trimmer cannot follow it.
- `dotnet/metaprogramming/interop-and-unsafe.md` — `[LibraryImport]` and what its generated code marshals.
- `dotnet/app-model/system-text-json.md` — options, converters and source generation for AOT.
- `dotnet/app-model/host-configuration-options-and-logging.md` — logging and configuration binding, where two of the generators above are used.
- `dotnet/tooling/analyzers-and-code-quality.md` — analyzers, the other compiler plug-in.
- `dotnet/type-design/members-and-initialization.md` — properties, constructors and the `field` keyword that partial members build on.
