---
schema: knowledge-doc/v1
type: concept
topic: dotnet/platform
status: verified
applies-to: [".NET 10 (runtime 10.0.12, SDK 10.0.401)", "C# 14", ".NET 11.0.0 (container lab, SDK 11.0.100) for the `.runtimeconfig.dev.json` precedence"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, clr, coreclr, il, jit, bcl, sdk, runtime, shared-framework, tfm, roll-forward, global-json, runtimeconfig, muxer, hostfxr, lts, sts, support-policy]
ranked-sources: true
---

# The .NET stack, SDK and runtime version selection

## Summary
**TL;DR:** The C# compiler turns source into IL (intermediate language, a CPU-neutral instruction set) plus metadata inside an assembly (`.dll`); at run time the `dotnet` host reads the app's `.runtimeconfig.json`, picks an installed shared runtime, and the CLR (common language runtime) JIT-compiles (just-in-time) each method to machine code the first time it is called. The SDK (software development kit: the build tools) and the runtime are versioned and selected separately: `global.json` picks the SDK, `runtimeconfig.json` plus roll-forward rules pick the runtime, and by default an app runs on the newest patch of the major.minor it was built for, never on a lower version and never on a new major. Even-numbered releases are LTS (long-term support, 3 years), odd ones STS (standard-term support, 2 years since .NET 9).
**Use this when:** an app fails with "You must install or update .NET", `dotnet` says "A compatible .NET SDK was not found", you choose a target framework, pin an SDK in CI (continuous integration), or decide between an LTS and an STS release.
**Not this doc:** project files, MSBuild, NuGet and publishing → `dotnet/platform/projects-and-msbuild.md`; every C# and .NET version with dates → `dotnet/platform/csharp-and-dotnet-versions.md`; JIT tiers, ReadyToRun and Native AOT (ahead-of-time compilation) → `dotnet/runtime/jit-tiering-and-aot.md`; the lab itself → `dotnet/lab-setup.md`.

## Problem
Versions in .NET look like one number but are several, and each failure points at a different one:
- An app built on a laptop fails on a server with `Framework: 'Microsoft.NETCore.App', version '9.0.0'` although .NET 10 is installed there.
- `dotnet --version` prints `10.0.401` in one folder and "A compatible .NET SDK was not found" in a sibling folder.
- `<TargetFramework>net11.0</TargetFramework>` fails with `NETSDK1045` on a machine that has a perfectly current .NET 10 SDK.
- `./Hello` says ".NET location: Not found" while `dotnet Hello.dll` runs the same build.
- SDK `10.0.401` and runtime `10.0.12` ship together; it is not obvious which number a support statement talks about.

## Mental model
**Analogy:** an assembly is a recipe written in a universal shorthand (IL). The kitchen (the runtime) has a chef (the JIT) who translates each step into moves for this kitchen's appliances only when that step is first cooked. A label on the recipe (`runtimeconfig.json`) says "needs kitchen model 10.0, any later 10.x is fine"; the front desk (the `dotnet` host) walks the installed kitchens and sends the recipe to the newest 10.x. The studio where recipes are written (the SDK) has its own version number and is picked by a different note (`global.json`).

**Artifact** (built and run in the lab ✅[^lab]): the label the build writes next to `Hello.dll`, and the IL the compiler wrote for `static int Add(int a, int b) => a + b`:
```json
{ "runtimeOptions": { "tfm": "net10.0",
    "framework": { "name": "Microsoft.NETCore.App", "version": "10.0.0" } } }
```
```text
IL bytes of Calc.Add : 02-03-58-2A
as opcodes           : ldarg.0 ; ldarg.1 ; add ; ret
runs on .NET 10.0.12, built for .NETCoreApp,Version=v10.0
```
The label asks for `10.0.0`; the process ran on `10.0.12`, the newest installed patch.

## How it works
**Six actors** take a C# file to running machine code:
- **Roslyn (`csc`)** — its job: compile C# into IL and metadata, via the `CoreCompile` MSBuild target, which passes the source files and `/reference:` paths to reference assemblies.
- **The SDK's MSBuild targets** — its job: write the build outputs, via `dotnet build` (the assembly, `.deps.json`, `.runtimeconfig.json` and a native launcher, the apphost).
- **The entry host (`dotnet`, the "muxer", or the apphost)** — its job: find `hostfxr`, via the `host/fxr/<highest version>` folder next to `dotnet`, or for the apphost the app folder, `DOTNET_ROOT`, then default install locations.
- **`hostfxr`** — its job: choose the framework version, via the app's `.runtimeconfig.json` and the roll-forward rules; for SDK commands it also chooses the SDK, via `global.json`.
- **`hostpolicy`** — its job: list every assembly the app may load, via `.deps.json`, then start the runtime, via `libcoreclr`.
- **CoreCLR and its JIT** — its job: load assemblies on demand and compile each method's IL to native code on its first call, via a stub that hands control to the JIT.

```text
 BUILD (local, once)                         RUN (local, every start)
 Program.cs ──csc──▶ Hello.dll (IL+metadata)   dotnet Hello.dll
             SDK ──▶ Hello.runtimeconfig.json     │ host/fxr/10.0.12/libhostfxr
                     Hello.deps.json              ├─ reads runtimeconfig: wants 10.0.0, rollForward=Minor
                     Hello (apphost)              ├─ scans shared/Microsoft.NETCore.App/ → picks 10.0.12
                                                  │ shared/…/10.0.12/libhostpolicy
                                                  ├─ reads deps.json → TPA list (~170 framework dlls + Hello.dll)
                                                  │ shared/…/10.0.12/libcoreclr
                                                  └─ runs Main; JIT compiles Main, then Calc.Add on first call
```

1. **Compile (local).** C# compiles to CIL (common intermediate language) plus metadata describing every type and member, stored in a PE (portable executable) file ✅[^managed]. In the lab, `Calc.Add` became 4 bytes of IL, `ldarg.0; ldarg.1; add; ret`, in both Debug and Release ✅[^lab]. The compiler sees only reference assemblies: the lab build passed `/reference:…/packs/Microsoft.NETCore.App.Ref/10.0.12/ref/net10.0/System.Runtime.dll` and `/langversion:14.0` to `csc` ✅[^lab].
2. **Assemblies are the unit of deployment and versioning; namespaces are only names.** An assembly is the smallest versionable unit, and a type's identity includes its assembly ✅[^assembly]. One namespace can span assemblies: in the lab `List<T>` lives in `System.Private.CoreLib` and `LinkedList<T>` in `System.Collections`, both in `System.Collections.Generic` ✅[^lab]. Assemblies are loaded only when needed ✅[^assembly].
3. **Start the host (local).** The `dotnet` executable locates `hostfxr` in `./host/fxr/<highestversion>`; the apphost searches the app folder, then `DOTNET_ROOT`, then the default shared locations ✅[^host]. The host trace (`COREHOST_TRACE=1`) shows `Resolved fxr [.../host/fxr/10.0.12/libhostfxr.dylib]` and then `Executing in muxer mode` ✅[^lab].
4. **Resolve the framework (local).** `hostfxr` reads the app's `.runtimeconfig.json` and resolves the frameworks it names ✅[^host]. In the lab trace: `Resolving FX directory, name 'Microsoft.NETCore.App' version '10.0.0'`, `Found version [10.0.12]`, `Chose FX version [.../shared/Microsoft.NETCore.App/10.0.12]` ✅[^lab].
5. **Build the assembly list and start the runtime (local).** `hostpolicy` lives in the chosen framework folder, reads the `.deps.json` files of the app and its frameworks, builds the trusted platform assemblies (TPA) list, then loads and initializes `coreclr` ✅[^host]. The trace ends with `Property TRUSTED_PLATFORM_ASSEMBLIES = …` (about 170 paths), `CoreCLR path = '…/10.0.12/libcoreclr.dylib'` and `Execute managed assembly exit code: 0x0` ✅[^lab].
6. **JIT on first call.** The loader attaches a stub to each method; the first call passes control to the JIT, which compiles that method and reuses the native code for later calls in the same process ✅[^managed]. With `DOTNET_JitDisasmSummary=1`, a Release build that calls `Calc.Add` listed only 10 JIT-compiled methods, including `Program:<Main>$` and `Calc:Add(int,int)` at `Tier0`; the never-called `Calc.Unused` was not compiled ✅[^lab]. Tiers are explained in `dotnet/runtime/jit-tiering-and-aot.md`.
7. **The pieces have names.** The runtime executes code, the libraries provide functionality, the compiler translates source, and the SDK holds the build tools ✅[^intro]. The BCL (base class library) is the set of `System.*` libraries that app frameworks such as ASP.NET Core build on ✅[^glossary]. A *shared framework* is a set of libraries installed once per machine for framework-dependent apps: `Microsoft.NETCore.App` holds the BCL, `Microsoft.AspNetCore.App` adds web APIs ✅[^glossary]. The lab machine has both at `10.0.12` and one SDK, `10.0.401` ✅[^lab].
8. **SDK and runtime numbers.** The runtime follows major.minor.patch, and the SDK shares the first two numbers with the runtime it shipped with ✅[^versions]. In the SDK's third number the hundreds are the *feature band* and the last two digits the patch, so `9.0.101` and `9.0.199` share band 1xx while `9.0.201` is band 2xx ✅[^support]; the lab's `10.0.401` is band 4xx, patch 1. An SDK can build for its own runtime version and any lower one ✅[^versions]; a .NET 10 SDK refuses `net11.0` with `NETSDK1045: The current .NET SDK does not support targeting .NET 11.0` ✅[^lab].
9. **The TFM picks the build-time API set.** A TFM (target framework moniker) such as `net10.0` names the APIs (application programming interfaces) a project compiles against ✅[^tfm]. OS-specific (operating-system-specific) TFMs (`net10.0-windows`, `net10.0-ios`, `net10.0-android`) add that OS's APIs on top of the base TFM ✅[^tfm]. `.NET Standard` matters now only for libraries shared with .NET Framework; .NET 5 and later implement every .NET Standard version ✅[^select].
10. **Runtime roll-forward.** A framework-dependent app run by `dotnet run`, `dotnet app.dll` or its apphost uses the newest installed patch of the requested major.minor; if none exists it moves to a higher minor; lower versions are never considered ✅[^select]. The policy is set by `RollForward` in the project (copied into `runtimeconfig.json`), the `DOTNET_ROLL_FORWARD` environment variable, or `--roll-forward`, each overriding the one before ✅[^select]. Values: `Minor` (default), `Major`, `LatestPatch`, `LatestMinor`, `LatestMajor`, `Disable` ✅[^select]. Major-version roll-forward is off by default; recompiling for the new major is the recommended upgrade ✅[^versions].
11. **SDK selection with `global.json`.** Every SDK command uses the newest installed SDK unless a `global.json` is found by walking up from the current directory (not the project directory) ✅[^select]. A pinned `version` must be a full number such as `10.0.100`; without `rollForward` the default is `patch`, which stays inside the pinned feature band ✅[^globaljson]. `latestFeature` accepts any higher feature band of the same major.minor; `latestMajor` accepts anything newer ✅[^globaljson]. Since the .NET 10 SDK, `paths` lists extra SDK folders and `errorMessage` replaces the "not found" text ✅[^globaljson].
12. **Support policy.** A major release ships every November ✅[^policy]. Even-numbered releases are LTS with 3 years of free support and patches; odd-numbered releases are STS with 2 years, a length that starts with .NET 9 ✅[^versions]. The last 6 months of any release are maintenance support, with security fixes only, and patches arrive on Patch Tuesday (the second Tuesday of the month) ✅[^policy]. A supported system must run the latest patch ✅[^policy]. On 2026-11-24, .NET 10 (LTS) and .NET 11 (STS, released 2026-11-10) are both supported until 2028-11-14, while .NET 8 and .NET 9 reached end of support on 2026-11-10 ✅[^relindex].
13. **.NET Framework is a different product.** .NET Framework runs only on Windows and includes the CLR, the BCL and app frameworks such as ASP.NET, Windows Forms and WPF ✅[^glossary]; it is supported but in maintenance, while modern .NET is the cross-platform, evolving implementation ✅[^intro]. Its newest TFM is `net481` (4.8.1), which implements .NET Standard 2.0 ✅[^tfm].

## Worked example
One `net10.0` console app (`Hello.dll`) run under different version labels and SDK pins on the lab machine (runtime 10.0.12 and SDK 10.0.401 only) ✅[^lab].

| Step | Change | Result | Rule |
|---|---|---|---|
| 1 | `dotnet Hello.dll` as built (`"version": "10.0.0"`) | `runs on .NET 10.0.12` | newest patch of 10.0 (How it works 10) |
| 2 | label edited to `10.0.13` | `You must install or update .NET to run this application.` | never rolls down to 10.0.12 |
| 3 | label `9.0.0` | fails; the message lists `The following frameworks were found: 10.0.12` | default `Minor` does not cross a major |
| 4 | label `9.0.0`, `DOTNET_ROLL_FORWARD=Major` | `runs on .NET 10.0.12` | `Major` moves up to the next major |
| 5 | label `9.0.0` with `"rollForward": "Major"` in the json, then `DOTNET_ROLL_FORWARD=Disable` | json alone runs; with the variable it fails | the environment variable overrides the file |
| 6 | label `10.0.0`, `DOTNET_ROLL_FORWARD=Disable` | fails | `Disable` wants exactly 10.0.0 |
| 7 | `global.json` `{"sdk":{"version":"10.0.100"}}`, `dotnet --version` | `A compatible .NET SDK was not found.` | default `patch` stays in feature band 1xx; 401 is band 4 |
| 8 | same with `"rollForward": "latestFeature"` | `10.0.401` | higher feature band allowed |
| 9 | `10.0.100` plus `"errorMessage": "Run ./install.sh first"` | the not-found text becomes `Run ./install.sh first`, exit code 155 | .NET 10 SDK field |

Steps 2 and 7 are the two classic CI breakages: a runtime label newer than what is installed, and an SDK pin narrower than what is installed.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `./Hello` (apphost) on a Homebrew install | `.NET location: Not found`, searched `DOTNET_ROOT = <not set>` and `/usr/local/share/dotnet`; `DOTNET_ROOT=…/libexec ./Hello` works ✅[^lab] | Homebrew's `bin/dotnet` is a shell script that sets `DOTNET_ROOT` only for its own child process ✅[^lab]; the apphost looks in the app folder, `DOTNET_ROOT`, then default locations ✅[^host] |
| `global.json` with `"version": "10.0"` | `dotnet --version` silently uses `10.0.401`; `dotnet --info` reports `Version '10.0' is not valid … Invalid global.json is ignored for SDK resolution.` ✅[^lab] | The field needs a full version and has no wildcards ✅[^globaljson] |
| `net9.0` project on the .NET 10 SDK, offline | `error NU1101: Unable to find package Microsoft.NETCore.App.Ref` (also `Microsoft.NETCore.App.Host.osx-arm64` and `Microsoft.AspNetCore.App.Ref`, each pinned to `[9.0.20, 9.0.20]` in `project.assets.json`) ✅[^lab] | The SDK's `packs/` folder holds only the 10.0.12 targeting packs, so an older TFM must restore them from a NuGet feed, and the lab feed was local only ✅[^lab] |
| Release date of .NET 9 | `9.0/releases.json` gives `9.0.0` the date `2024-12-03` ✅[^rel9]; the support policy page says "November 12, 2024" ✅[^policy] | The two official sources disagree; both are the project's own data. This doc takes the policy page for the original release date |
| `.runtimeconfig.dev.json` next to the app | The host reads it before `runtimeconfig.json` (trace: `Attempting to read dev runtime config`) ✅[^lab]. A `configProperties` key found only in the dev file reached `AppContext.GetData` on both versions; for a key in both files, runtime 10.0.12 kept the main file's value and 11.0.0 took the dev file's: `Lab.Key` `main` versus `dev`, and `System.GC.Concurrent` `true` versus `false`, so `GCSettings.LatencyMode` was `Interactive` versus `Batch` ✅[^lab] ✅[^lab11] | Development-time overrides; from .NET 11 the dev file's `configProperties` win over the main file ✅[^runtimeconfig] |
| Minor roll-forward side effect | An app on 5.0 runs on 5.1.0 while 5.0.x is missing, then switches to 5.0.3 once that is installed ✅[^select] | Roll-forward re-runs at every start, so behaviour can change between runs |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| LTS release (.NET 10) | 3 years of patches; fewer forced upgrades ✅[^policy] | Newer runtime and library features wait up to a year |
| STS release (.NET 11) | Newest features a year earlier; now 2 years of support ✅[^versions] | Same end date as the previous LTS here (2028-11-14 ✅[^relindex]), so no longer support in exchange |
| `global.json` exact pin (`rollForward: disable`) | Reproducible builds; keeps lock files and SDK in step ✅[^globaljson] | Every developer and agent must install that exact SDK |
| `global.json` with `latestFeature` | Any newer patch or feature band of the same major works ✅[^globaljson] | Build behaviour can shift with an SDK feature band |
| `DOTNET_ROLL_FORWARD=Major` on an old app | Runs without recompiling ✅[^select] | Untested combination; retesting is still required ✅[^versions] |

## Takeaways
- Keep "SDK version" (build tools, `global.json`) and "runtime version" (`runtimeconfig.json`) apart in every error message and support question. [rule-candidate]
- Pin the SDK in CI with a full version plus `rollForward: latestFeature` (or `disable` with lock files), never a partial version such as `10.0`, which is silently ignored. [rule-candidate]
- Upgrade a major version by retargeting and recompiling, not with `RollForward=Major`. [rule-candidate]
- Install patches: a framework-dependent app picks the newest patch at every start, and support requires the latest one.
- Choose LTS for systems that upgrade slowly; with STS at 24 months both tracks currently end on the same date.

## Verification status
- Verified: 64 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [Introduction to .NET](https://learn.microsoft.com/en-us/dotnet/core/introduction) — Microsoft, living. Rank 1. Backs: the components (runtime, libraries, compiler, SDK); .NET Framework in maintenance, modern .NET cross-platform. [^intro]
- [Managed execution process](https://learn.microsoft.com/en-us/dotnet/standard/managed-execution-process) — Microsoft, living. Rank 1. Backs: CIL plus metadata in a PE file; the JIT stub and compile on first call; native code reused within the process. [^managed]
- [.NET glossary](https://learn.microsoft.com/en-us/dotnet/standard/glossary) — Microsoft, living. Rank 1. Backs: BCL, shared framework, .NET Framework. [^glossary]
- [Assemblies in .NET](https://learn.microsoft.com/en-us/dotnet/standard/assembly/) — Microsoft, living. Rank 1. Backs: assembly as the versioning unit and part of type identity; loaded only when required. [^assembly]
- [Target frameworks in SDK-style projects](https://learn.microsoft.com/en-us/dotnet/standard/frameworks) — Microsoft, living. Rank 1. Backs: TFMs, OS-specific TFMs, `net481` and .NET Standard 2.0. [^tfm]
- [Select the .NET version to use](https://learn.microsoft.com/en-us/dotnet/core/versions/selection) — Microsoft, living. Rank 1. Backs: latest SDK by default and the `global.json` search; patch and minor roll-forward; the four ways to set roll-forward and their precedence; the roll-forward values; .NET Standard's remaining role; the minor roll-forward side effect. [^select]
- [How .NET is versioned](https://learn.microsoft.com/en-us/dotnet/core/versions/) — Microsoft, living. Rank 1. Backs: runtime and SDK numbering and feature bands; SDK builds for lower runtimes; LTS 3 years and STS 2 years starting with .NET 9; recompile for a new major. [^versions]
- [global.json overview](https://learn.microsoft.com/en-us/dotnet/core/tools/global-json) — Microsoft, living. Rank 1. Backs: full version required; `patch` default; `latestFeature`, `latestMajor`, `disable`; `paths` and `errorMessage` in the .NET 10 SDK. [^globaljson]
- [Releases and support for .NET](https://learn.microsoft.com/en-us/dotnet/core/releases-and-support) — Microsoft, living. Rank 1. Backs: SDK feature bands. [^support]
- [.NET runtime configuration settings](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/) — Microsoft, living. Rank 1. Backs: `.runtimeconfig.dev.json` precedence in .NET 11. [^runtimeconfig]
- [Components of the hosting](https://github.com/dotnet/runtime/blob/main/docs/design/features/host-components.md) — .NET runtime team, living. Rank 1. Backs: `dotnet`/apphost → `hostfxr` → `hostpolicy` → `coreclr`; where each finds the next; TPA list from `.deps.json`. [^host]
- [.NET and .NET Core Support Policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) — Microsoft, 2026. Rank 1. Backs: yearly November releases; LTS and STS lengths; maintenance period; Patch Tuesday; latest patch required; .NET 9 original release date. [^policy]
- [.NET releases index](https://github.com/dotnet/core/blob/main/release-notes/releases-index.json) — .NET team, living. Rank 1. Backs: .NET 10 and 11 end of support 2028-11-14; .NET 8 and 9 end of support 2026-11-10. [^relindex]
- [.NET 9 releases.json](https://github.com/dotnet/core/blob/main/release-notes/9.0/releases.json) — .NET team, living. Rank 1. Backs: `9.0.0` dated 2024-12-03. [^rel9]

## Related
- `dotnet/platform/projects-and-msbuild.md` — the project file that produces `runtimeconfig.json`, and framework-dependent versus self-contained publishing.
- `dotnet/platform/csharp-and-dotnet-versions.md` — every release with its type, dates and C# version.
- `dotnet/runtime/jit-tiering-and-aot.md` — what the JIT does after step 6.
- `dotnet/lab-setup.md` — the lab that produced every output above.
