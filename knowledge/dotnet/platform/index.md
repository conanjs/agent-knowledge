---
schema: topic-index/v1
kind: subtopic
topic: dotnet/platform
last-updated: 2026-11-24
---

# .NET platform and toolchain

What sits under every C# program: the compiler (Roslyn) that writes IL into assemblies, the `dotnet` host that picks an SDK and a runtime, the CLR and its JIT, the base class library and shared frameworks, target framework monikers, roll-forward and `global.json`, the LTS/STS support policy; SDK-style project files, MSBuild properties, items and targets, `Directory.Build.props`, NuGet restore, lock files and Central Package Management, and framework-dependent, self-contained and single-file publishing; plus a catalog of every C# and .NET version. Everything was run on the .NET 10 SDK (10.0.401, runtime 10.0.12) in `dotnet/lab-setup.md`. Not covered: the JIT's tiers, ReadyToRun and Native AOT (see `dotnet/runtime/`), analyzers and warning policy (see `dotnet/tooling/`), the C# language itself (see `dotnet/fundamentals/` onward).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [runtime-and-versions.md](runtime-and-versions.md) | concept | Roslyn → IL → host (`dotnet`, `hostfxr`, `hostpolicy`) → CoreCLR and JIT; BCL and shared frameworks; SDK versus runtime numbers; TFMs; runtime roll-forward and `global.json` SDK selection; LTS/STS support policy; .NET Framework versus modern .NET | verified |
| [projects-and-msbuild.md](projects-and-msbuild.md) | concept | SDK-style `.csproj` and its implicit imports; properties, items and targets; implicit usings, `Nullable`, `TreatWarningsAsErrors`; `Directory.Build.props`/`.targets`; NuGet restore, lock files and Central Package Management; build outputs; file-based apps; publishing modes with measured sizes | verified |
| [csharp-and-dotnet-versions.md](csharp-and-dotnet-versions.md) | reference | Every C# version with date, default target and headline features; six of the seven C# 15 features as compiled and run in the .NET 11 container; every .NET (Core) release with type, release date, end of support and last patch; support rules; `LangVersion` values on the C# 14 and C# 15 compilers | verified |

## References
- [Introduction to .NET](https://learn.microsoft.com/en-us/dotnet/core/introduction) — Microsoft, living. Backs: subtopic scope (runtime, libraries, compiler, SDK).
- [.NET releases index](https://github.com/dotnet/core/blob/main/release-notes/releases-index.json) — .NET team, living. Backs: the release data in the catalog.

## Related
- `dotnet/lab-setup.md` — the lab every doc here ran in.
- `dotnet/runtime/` — the JIT, garbage collector and object layout.
- `dotnet/fundamentals/` — the C# language basics that build on this platform.
