---
schema: knowledge-doc/v1
type: concept
topic: dotnet/platform
status: verified
applies-to: [".NET SDK 10.0.401 (MSBuild and NuGet as shipped in it)", ".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, msbuild, csproj, sdk-style, properties, items, targets, directory-build-props, implicit-usings, nullable, nuget, packagereference, lock-file, central-package-management, publish, self-contained, single-file, file-based-apps]
ranked-sources: true
---

# SDK-style projects, MSBuild and NuGet

## Summary
**TL;DR:** A `.csproj` is an MSBuild file whose `Sdk="Microsoft.NET.Sdk"` attribute silently imports the SDK's (software development kit's) defaults before and after it, so the 10-line file that `dotnet new console` writes expands to about 17,000 lines and 500 targets. MSBuild first evaluates *properties* (name = value, the last assignment wins) and *items* (named lists, mostly files), then runs *targets* (ordered build steps such as `Restore` and `CoreCompile`). `Directory.Build.props` is imported before the project and `Directory.Build.targets` after it; NuGet restore turns `PackageReference` items into exact versions in `obj/project.assets.json`, and `packages.lock.json` or `Directory.Packages.props` pin or centralize them. `dotnet publish` is framework-dependent unless you ask for self-contained or single-file output.
**Use this when:** a property set in the project "does nothing", a setting must apply to every project in a repository, package versions drift between projects or machines, or you pick between framework-dependent, self-contained and single-file deployment.
**Not this doc:** how the host picks a runtime and SDK at run time → `dotnet/platform/runtime-and-versions.md`; analyzers, `WarningsAsErrors` and `.editorconfig` → `dotnet/tooling/analyzers-and-code-quality.md`; test projects → `dotnet/tooling/testing.md`; Native AOT (ahead-of-time compilation) and ReadyToRun → `dotnet/runtime/jit-tiering-and-aot.md`; one-file probes → `dotnet/lab-setup.md`.

## Problem
- `<LangVersion>` or `<OutDir>` set in the project has no effect, because a file imported earlier already used the old value.
- The same warning breaks the build in one repository and not in another: a `Directory.Build.props` two folders up sets `TreatWarningsAsErrors`.
- `Version="1.0.0"` on a package reference installs 1.0.0 even though 1.1.0 is on the feed, and two projects in one solution end up on different versions of the same package.
- CI (continuous integration) restores a different dependency graph from the developer's machine.
- `dotnet publish -r osx-arm64` produces a folder of about 140 KB (kilobytes; 152 KiB on disk) that still needs .NET installed, while adding `-p:PublishSingleFile=true` produces a 75 MB (megabyte) file that does not.

## Mental model
**Analogy:** the `.csproj` is a short order form stapled between the pages of a thick standard contract (the SDK). MSBuild reads the whole stack top to bottom: house rules for the building (`Directory.Build.props`), the contract's opening clauses (`Sdk.props`), the order form, the closing clauses (`Sdk.targets`), then any late house rules (`Directory.Build.targets`). When a field is filled in twice, the last entry counts. Only after reading everything does it carry out the work steps the contract lists.

**Artifact** (from the lab ✅[^lab]): the whole project file `dotnet new console` wrote (its two blank lines left out), and what MSBuild computed from it.
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
```
```console
$ dotnet msbuild -getProperty:LangVersion -getProperty:OutputPath -getProperty:UseAppHost -getItem:Compile
"LangVersion": "14.0", "OutputPath": "bin\\Debug/net10.0/", "UseAppHost": "true"   Compile: Program.cs
```
None of these four values is in the file: the SDK supplied them.

## How it works
**Five actors** turn `dotnet build` into an assembly:
- **The `dotnet` CLI** — its job: translate the command into an MSBuild run, via `dotnet build` = `dotnet msbuild -restore`.
- **MSBuild evaluation** — its job: read the project and every import into properties and items, via the import chain `Directory.Build.props` → `Sdk.props` → project → `Sdk.targets` → `Directory.Build.targets`.
- **NuGet restore** — its job: resolve package references to exact versions, via the feeds in `nuget.config`, writing `obj/project.assets.json` and filling the global packages folder.
- **MSBuild execution** — its job: run targets in dependency order, via tasks such as `Csc`, `Copy` and the runtimeconfig generator.
- **Roslyn** — its job: compile the `Compile` items into IL (intermediate language), via the `csc` command line that `CoreCompile` builds.

```text
dotnet build ─▶ MSBuild evaluation (local, in memory)
                 Directory.Build.props (line 94) → Sdk.props → App.csproj (line 1492)
                 → Sdk.targets → Directory.Build.targets (line 10458)   = 17,321 lines, 507 targets
             ─▶ Restore target ─▶ NuGet ══ feed (nuget.org or a local folder) ══▶ ~/.nuget/packages
                                   writes obj/project.assets.json (+ packages.lock.json)
             ─▶ Build targets  ─▶ CoreCompile ─▶ csc /reference:…/ref/net10.0/*.dll ─▶ obj/…/App.dll
                                   copy to bin/Debug/net10.0/ + App.deps.json + App.runtimeconfig.json + apphost
```

1. **The SDK attribute adds imports.** An SDK-style project references a project SDK, a set of MSBuild targets and tasks; MSBuild adds an implicit import of `Sdk.props` at the top and `Sdk.targets` at the bottom ✅[^sdk]. `dotnet msbuild -pp` (preprocess) shows the expanded project: in the lab the 10-line file became 17,321 lines with 507 `<Target>` elements ✅[^lab].
2. **Properties are name-value pairs, evaluated in file order.** Properties live in `PropertyGroup` elements and configure the build ✅[^props]. During evaluation MSBuild defines properties first, then item definitions, then items, each in the order they appear across the imports ✅[^order]. So the last assignment wins: `Greeting` set to `from-props` in `Directory.Build.props` and to `from-csproj` in the project printed `Greeting=from-csproj`, and `-p:TreatWarningsAsErrors=false` on the command line beat both files ✅[^lab].
3. **Items are named lists of inputs.** Items, usually files, are grouped into item types such as `Compile` by element name, and tasks take them as parameters ✅[^items]. The SDK adds default globs: `Compile` includes `**/*.cs`, with `bin/` and `obj/` excluded; adding the same files again causes error `NETSDK1022` ✅[^sdk].
4. **Targets are ordered steps and skip work that is up to date.** A target groups tasks in an order ✅[^targets]. A custom `<Target Name="ShowGreeting" AfterTargets="Build">` in `Directory.Build.targets` ran after every build; a second unchanged build logged `Skipping target "CoreCompile" because all output files are up-to-date with respect to the input files.` ✅[^lab].
5. **Implicit usings are generated code.** From .NET 6, projects with `ImplicitUsings` get `global using` directives in a generated file under `obj/`; for `Microsoft.NET.Sdk` the namespaces are `System`, `System.Collections.Generic`, `System.IO`, `System.Linq`, `System.Net.Http`, `System.Threading` and `System.Threading.Tasks`, and `<Using Include="…" />` items add more ✅[^sdk]. The lab file `obj/Debug/net10.0/Hello.GlobalUsings.g.cs` held exactly those seven lines ✅[^lab].
6. **`Nullable` and `TreatWarningsAsErrors` are compiler switches set as properties.** Without a value the nullable context is `disable`; the .NET 6 and later templates set `enable` ✅[^langopts]. `TreatWarningsAsErrors` reports every compiler warning as an error and stops the build ✅[^warnings]. In the lab, `TreatWarningsAsErrors` in a parent `Directory.Build.props` turned `warning CS8602: Dereference of a possibly null reference` into `error CS8602` and `Build FAILED`; the generated `csc` line also always carried `/warnaserror+:NU1605,SYSLIB0011` ✅[^lab]. Rules and suppressions → `dotnet/tooling/analyzers-and-code-quality.md`.
7. **`Directory.Build.props` and `.targets` apply settings by folder.** `Microsoft.Common.props` imports `Directory.Build.props` early, so its properties are visible to the SDK's own imports; `Microsoft.Common.targets` imports `Directory.Build.targets` late, so it sees the project's values ✅[^dirbuild]. MSBuild searches upward from the project and stops at the first file it finds; an inner file must import the outer one explicitly with `GetPathOfFileAbove` ✅[^dirbuild]. In the lab the props file's `Company` became `[assembly: AssemblyCompanyAttribute("Lab")]` in the generated `AssemblyInfo.cs` ✅[^lab].
8. **Restore resolves `PackageReference` items.** `dotnet build` equals `dotnet msbuild -restore`, and building needs the `project.assets.json` that restore writes ✅[^build]. `Version="1.0.0"` means "1.0.0 or higher" ✅[^nugetver], and NuGet picks the lowest applicable version ✅[^depres]; a floating `1.*` takes the highest match ✅[^depres]. Packages are extracted once into the global packages folder (`~/.nuget/packages`, overridable with `NUGET_PACKAGES`) ✅[^globalpkgs].
9. **Lock files freeze the graph.** `RestorePackagesWithLockFile=true` makes restore write `packages.lock.json` with the full dependency closure; in locked mode restore fails instead of re-resolving when the project's dependencies changed ✅[^pkgref]. In the lab, bumping the reference to `1.1.0` and running `dotnet restore --locked-mode` failed with `NU1004: The package reference Lab.Greeter version has changed from [1.0.0, ) to [1.1.0, )` ✅[^lab].
10. **Central Package Management (CPM) moves versions into one file.** `Directory.Packages.props` with `ManagePackageVersionsCentrally=true` holds `PackageVersion` items, projects keep `PackageReference` without `Version`, the file closest to a project wins, and `VersionOverride` changes one project ✅[^cpm]. In the lab two apps switched from 1.0.0 to 1.1.0 by editing one line; a `Version` left on a `PackageReference` failed with `NU1008: … cannot define a value for Version` ✅[^lab].
11. **Package, assembly and namespace are three names.** In the lab the package `Lab.Greeter` contained `lib/net10.0/Greeter.dll`, whose types live in the namespace `Lab.Greeting` ✅[^lab]. An assembly is the unit the runtime versions and loads (`dotnet/platform/runtime-and-versions.md`, How it works 2); a namespace only groups names.
12. **Build outputs.** `dotnet build` writes the IL `.dll`, an executable, `.pdb` symbols, `.deps.json` (the dependency list) and `.runtimeconfig.json` (the shared runtime and version), by default to `./bin/<configuration>/<framework>/` ✅[^build]. The lab's `bin/Debug/net10.0/` held `Hello` (123,880-byte apphost), `Hello.dll` (4,608 bytes), `Hello.pdb`, `Hello.deps.json` and `Hello.runtimeconfig.json`, while `obj/` held the generated sources, caches and `project.assets.json` ✅[^lab].
13. **File-based apps are projects without a file.** `dotnet project convert file.cs` writes a `.csproj` from the file's `#:` directives plus a copy of the source into a new folder, leaving the original alone; file-based apps also read `Directory.Build.props`, `Directory.Packages.props`, `nuget.config` and `global.json` ✅[^filebased]. The converted lab project listed `ImplicitUsings` and `Nullable` `enable`, `PackAsTool` `true`, a `UserSecretsId` and the `PublishAot=false` from the directive ✅[^lab].
14. **Publishing.** Framework-dependent output needs an installed runtime and is the default; self-contained output bundles the runtime ✅[^deploy]. `dotnet publish` builds `Release` by default ✅[^deploy]. Since .NET 8, a runtime identifier (RID) alone no longer implies self-contained, while `PublishSingleFile`, `PublishAot` and `PublishTrimmed` imply it during `dotnet publish` ✅[^rid8]. A single-file app keeps its managed DLLs inside the executable and loads them in memory, without extracting them to a folder ✅[^singlefile]. The lab's five publish runs are in Worked example 2.

## Worked example
**1. A package from a local feed to central versions**, offline (`nuget.config` with `<clear/>` and one folder feed, `NUGET_PACKAGES` set to a lab folder) ✅[^lab].

| Step | Action | Result |
|---|---|---|
| 1 | `dotnet pack -p:Version=1.0.0` and `1.1.0` of a library with `PackageId` `Lab.Greeter` | `Lab.Greeter.1.0.0.nupkg`, `Lab.Greeter.1.1.0.nupkg` (about 3.5 KB each) in the feed |
| 2 | Consumer: `<PackageReference Include="Lab.Greeter" Version="1.0.0" />`, `RestorePackagesWithLockFile=true`, `dotnet run` | `Hello, lab (Greeter 1.0.0.0)`; lock file `"requested": "[1.0.0, )"`, `"resolved": "1.0.0"` although 1.1.0 exists |
| 3 | `bin/` after the build | `Greeter.dll` copied next to `Consumer.dll`; `Consumer.deps.json` lists `lib/net10.0/Greeter.dll` |
| 4 | Edit to `1.1.0`, `dotnet restore --locked-mode` | `error NU1004` |
| 5 | Plain `dotnet run` | `Greeter 1.1.0.0`; lock file now `"resolved": "1.1.0"` |
| 6 | `Version="1.*"` | `"requested": "[1.*, )"`, `"resolved": "1.1.0"` |
| 7 | Two apps under one `Directory.Packages.props` (`PackageVersion … 1.0.0`), no `Version` in either project | both print `Greeter 1.0.0.0`; editing the central line to 1.1.0 moves both |
| 8 | `VersionOverride="1.0.0"` in one app | that app alone prints `Greeter 1.0.0.0` |

**2. Five ways to publish the same `Hello` app** on osx-arm64 ✅[^lab].

| Command (`dotnet publish …`) | Files | Size (file bytes summed; 1 KB = 1,000 bytes) | Size on disk (`du -k`, KiB = 1,024 bytes) | Runs without an installed runtime? |
|---|---|---|---|---|
| (no options) | 5 | about 140 KB (140,145 bytes) | 152 KiB | no: `runtimeconfig.json` names `"framework": "Microsoft.NETCore.App" 10.0.0` |
| `-r osx-arm64` | 5 | about 140 KB (139,706 bytes) | 152 KiB (148 KiB in a re-run) | no: still framework-dependent |
| `-r osx-arm64 --self-contained` | 191 (173 `.dll`) | about 82 MB (81,875,689 bytes) | 80,324 KiB | yes: `"includedFrameworks": … 10.0.12`; ran with `DOTNET_ROOT` unset |
| `-r osx-arm64 -p:PublishSingleFile=true` | 2 (`Hello` 75,306,534 bytes + `.pdb`) | about 75 MB (75,317,490 bytes) | 73,556 KiB | yes: single-file implied self-contained |
| `-r osx-arm64 -p:PublishSingleFile=true --self-contained false` | 2 (`Hello` 129,702 bytes + `.pdb`) | about 140 KB | 140 KiB | no: needed `DOTNET_ROOT` on this Homebrew install |

`du -k` counts whole disk blocks, so its numbers differ from the byte sums; the two size columns measure the same folders. The self-contained runtime is frozen at the patch it was published with (10.0.12 here), while the framework-dependent rows pick up the newest installed patch at every start.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| The single-file page says `RuntimeIdentifier` "Also sets `<SelfContained>true</SelfContained>` by default" ✅[^singlefile] | In the lab, `-r osx-arm64` alone published framework-dependent output (row 2 above) ✅[^lab] | The .NET 8 breaking change: for `net8.0` and later a RID no longer implies self-contained; only `PublishSingleFile`, `PublishAot` and `PublishTrimmed` do, and only during publish ✅[^rid8]. The single-file page's sentence is outdated |
| The publishing overview lists "Slower startup: Files must be extracted at runtime" for single-file ✅[^deploy] | Running the single-file `Hello` with `DOTNET_BUNDLE_EXTRACT_BASE_DIR` pointed at an empty lab folder left that folder empty ✅[^lab] | Managed DLLs load from the bundle in memory; extraction happens only with `IncludeNativeLibrariesForSelfExtract` or `IncludeAllContentForSelfExtract` ✅[^singlefile] |
| The single-file page says the core runtime's native binaries stay separate files ✅[^singlefile] | The lab's self-contained single-file output on osx-arm64 had only `Hello` and `Hello.pdb` ✅[^lab] | Observed on this platform and SDK; check the output folder rather than assume either way |
| Self-contained or single-file publish, offline | restore added `Microsoft.NET.ILLink.Tasks` 10.0.12 (`autoReferenced`) and took it from the SDK's own `library-packs` folder, not a network feed ✅[^lab] | The SDK lists `library-packs` as an extra local source in `project.assets.json` ✅[^lab] |
| `Directory.Build.props` with different casing on Linux | Not imported ✅[^dirbuild] | Linux file systems are case-sensitive ✅[^dirbuild] |
| Nested `Directory.Build.props` files | Only the nearest one applies ✅[^dirbuild] | The search stops at the first file found; chain them with `GetPathOfFileAbove` ✅[^dirbuild] |
| `TreatWarningsAsErrors` in the project versus `-warnaserror` on the command line | The property affects only the C# compiler; the MSBuild switch also covers other tasks' warnings ✅[^warnings] | Two different mechanisms with similar names |
| A library project's `packages.lock.json` | Not used when another project references the library ✅[^pkgref] | The consuming app's restore resolves its own closure; commit lock files for apps, not for shared libraries ✅[^pkgref] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Framework-dependent | Small output; picks up runtime security patches automatically ✅[^deploy] | Target machine needs the runtime; a newer patch can change behaviour ✅[^deploy] |
| Self-contained | Chosen runtime version; no install needed ✅[^deploy] | About 82 MB here (80,324 KiB on disk); runtime updates only by republishing ✅[^deploy] |
| Single-file | One file to copy ✅[^deploy] | OS- and architecture-specific; `Assembly.Location` returns an empty string ✅[^singlefile] |
| Lock file plus `--locked-mode` in CI | Repeatable restores ✅[^pkgref] | A deliberate update needs a re-resolve and a lock-file commit |
| Central Package Management | One version per package across the repository ✅[^cpm] | Every `PackageReference` loses its `Version`; mixed old and new syntax fails with `NU1008` ✅[^lab] |

## Takeaways
- Put repository-wide settings (`Nullable`, `TreatWarningsAsErrors`, `LangVersion`) in one `Directory.Build.props` at the root, and check `dotnet msbuild -getProperty:<Name>` before assuming a value. [rule-candidate]
- Commit `packages.lock.json` for applications and restore with `--locked-mode` in CI. [rule-candidate]
- Use Central Package Management when more than one project shares packages.
- Say `--self-contained` explicitly when that is what you want; a RID alone gives framework-dependent output since .NET 8. [rule-candidate]
- Read package IDs, assembly names and namespaces as three separate things.

## Verification status
- Verified: 64 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [.NET project SDKs](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/overview) — Microsoft, living. Rank 1. Backs: project SDKs; implicit `Sdk.props`/`Sdk.targets` imports; default globs and `NETSDK1022`; implicit `global using` directives and `Using` items. [^sdk]
- [MSBuild properties](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-properties) — Microsoft, living. Rank 1. Backs: properties as name-value pairs in `PropertyGroup`. [^props]
- [Comparing properties and items](https://learn.microsoft.com/en-us/visualstudio/msbuild/comparing-properties-and-items) — Microsoft, living. Rank 1. Backs: evaluation order (properties, item definitions, items, in order of appearance). [^order]
- [MSBuild items](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-items) — Microsoft, living. Rank 1. Backs: items as typed lists of build inputs. [^items]
- [MSBuild targets](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-targets) — Microsoft, living. Rank 1. Backs: targets group tasks in order. [^targets]
- [Customize the build by folder](https://learn.microsoft.com/en-us/visualstudio/msbuild/customize-by-directory) — Microsoft, living. Rank 1. Backs: early and late import of `Directory.Build.props`/`.targets`; upward search that stops at the first file; `GetPathOfFileAbove`; case sensitivity on Linux. [^dirbuild]
- [C# compiler options for language features](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language) — Microsoft, living. Rank 1. Backs: `Nullable` default `disable`, templates set `enable`. [^langopts]
- [C# compiler options to report errors and warnings](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/errors-warnings) — Microsoft, living. Rank 1. Backs: `TreatWarningsAsErrors`; difference from the `-warnaserror` MSBuild switch. [^warnings]
- [dotnet build](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-build) — Microsoft, living. Rank 1. Backs: build outputs; implicit restore and `project.assets.json`; equivalence with `dotnet msbuild -restore`; default output path. [^build]
- [File-based apps](https://learn.microsoft.com/en-us/dotnet/core/sdk/file-based-apps) — Microsoft, living. Rank 1. Backs: `dotnet project convert`; implicit build files read by file-based apps. [^filebased]
- [.NET application publishing overview](https://learn.microsoft.com/en-us/dotnet/core/deploying/) — Microsoft, living. Rank 1. Backs: framework-dependent versus self-contained, their advantages and disadvantages; `Release` default for publish; the single-file "files must be extracted" line. [^deploy]
- [Runtime-specific apps no longer self-contained](https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/8.0/runtimespecific-app-default) — Microsoft, 2023. Rank 1. Backs: RID no longer implies `SelfContained` for `net8.0`+; which publish properties still imply it. [^rid8]
- [Single-file deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview) — Microsoft, living. Rank 1. Backs: in-memory loading of bundled managed DLLs; extraction options; native binaries note; `Assembly.Location` empty; the outdated RID sentence. [^singlefile]
- [Package versioning](https://learn.microsoft.com/en-us/nuget/concepts/package-versioning) — Microsoft, living. Rank 1. Backs: `1.0` means minimum version, inclusive. [^nugetver]
- [Dependency resolution](https://learn.microsoft.com/en-us/nuget/concepts/dependency-resolution) — Microsoft, living. Rank 1. Backs: lowest applicable version; floating versions resolve to the highest match. [^depres]
- [Managing the global packages and cache folders](https://learn.microsoft.com/en-us/nuget/consume-packages/managing-the-global-packages-and-cache-folders) — Microsoft, living. Rank 1. Backs: `~/.nuget/packages` and `NUGET_PACKAGES`. [^globalpkgs]
- [PackageReference in project files](https://learn.microsoft.com/en-us/nuget/consume-packages/package-references-in-project-files) — Microsoft, living. Rank 1. Backs: lock files, locked mode, which projects should commit them. [^pkgref]
- [Central Package Management](https://learn.microsoft.com/en-us/nuget/consume-packages/central-package-management) — Microsoft, living. Rank 1. Backs: `Directory.Packages.props`, `PackageVersion`, nearest file wins, `VersionOverride`. [^cpm]

## Related
- `dotnet/platform/runtime-and-versions.md` — what happens to `runtimeconfig.json` and `deps.json` at start-up.
- `dotnet/tooling/analyzers-and-code-quality.md` — warning levels, analyzers and `.editorconfig`.
- `dotnet/runtime/jit-tiering-and-aot.md` — ReadyToRun and Native AOT publishing.
- `dotnet/lab-setup.md` — file-based apps, the lab's default way to run code.
