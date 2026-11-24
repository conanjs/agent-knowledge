---
schema: knowledge-doc/v1
type: how-to
topic: dotnet
status: verified
applies-to: [".NET SDK 10.0.401 (runtime 10.0.12, Roslyn 5.9.0, C# 14)", "macOS 26.1 arm64, Homebrew dotnet formula", "any OS with a .NET 10 SDK", ".NET SDK 11.0.100 (runtime 11.0.0, Roslyn 5.12.0, C# 15) in the mcr.microsoft.com/dotnet/sdk:11.0 container, Docker Engine 29.8.2"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, lab, file-based-apps, dotnet-run, offline, nuget, dotnet-tool, docker, dotnet-11, practice]
ranked-sources: true
---

# Run C# and .NET examples as file-based apps

## Summary
**TL;DR:** With a .NET 10 SDK (software development kit), one `.cs` file is a whole program: `dotnet run probe.cs` builds a hidden project for it and runs it, with no `.csproj`. Put `#:property PublishAot=false` on the first line so the run restores no NuGet package at all, and `#:sdk Microsoft.NET.Sdk.Web` when the example uses ASP.NET Core. Examples that need a NuGet package or a .NET tool keep the downloads in a lab folder (`NUGET_PACKAGES`, `--tool-path`), and .NET 11 / C# 15 examples run in the official `mcr.microsoft.com/dotnet/sdk:11.0` container. Every captured output in the `dotnet/` docs comes from this lab.
**Use this when:** you want to reproduce an example from the `dotnet/` docs, try a language rule yourself, or check which SDK, runtime and C# version a machine actually has.
**Not this doc:** what each example shows → the concept doc that quotes it; SDK-style project files and MSBuild → `dotnet/platform/projects-and-msbuild.md`; the order to read the docs in → `dotnet/learning-path.md`.

## Goal & prerequisites
**End state:** `dotnet run probe.cs` prints the probe's output in under 2 seconds on a rerun, the compiler reports `Language version: 14.0`, and the restore step restores no package; a probe with `#:package` restores into the lab's own package folder; the .NET 11 container reports `Language version: 15.0`.

**Needs:**
- A .NET 10 SDK on `PATH`. The reference run used SDK 10.0.401 with runtime 10.0.12 (osx-arm64), installed by the Homebrew `dotnet` formula under `/opt/homebrew/Cellar/dotnet/10.0.401/` ✅[^1].
- One folder per example, with no `.csproj` in it (Troubleshooting explains why).
- Network access only if an example declares a NuGet package (`#:package`) or installs a tool (Steps 11–12), and once to pull the .NET 11 image (Step 13).
- For Step 13: a Docker CLI (command-line interface) with a running engine (the reference run used Docker Engine 29.8.2) ✅[^1].

File-based apps exist from the .NET 10 SDK on ✅[^2]. C# 14 is supported only on .NET 10 and newer, and the compiler picks the newest language version that the target framework supports ✅[^3]. So the host lab speaks C# 14. .NET 11 (released 2026-11-10, with C# 15) is not installed on the host ✅[^4]; Step 13 runs it in a container instead.

## Steps
1. **Check the SDK and runtime.** `--list-sdks` shows which SDKs are installed and `--list-runtimes` which shared runtimes (`Microsoft.NETCore.App`, `Microsoft.AspNetCore.App`) they can run on.
   ```console
   $ dotnet --list-sdks
   10.0.401 [/opt/homebrew/Cellar/dotnet/10.0.401/libexec/sdk]
   $ dotnet --list-runtimes
   Microsoft.AspNetCore.App 10.0.12 [/opt/homebrew/Cellar/dotnet/10.0.401/libexec/shared/Microsoft.AspNetCore.App]
   Microsoft.NETCore.App 10.0.12 [/opt/homebrew/Cellar/dotnet/10.0.401/libexec/shared/Microsoft.NETCore.App]
   ```
2. **Turn telemetry off for the lab shell.** The SDK sends usage data by default in Microsoft builds; `DOTNET_CLI_TELEMETRY_OPTOUT=1` stops it, and `DOTNET_NOLOGO=true` only hides the welcome banner ✅[^5].
   ```console
   $ export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=true
   ```
3. **Write the probe as top-level statements.** The file needs no `Main` method and no `using System;`: the generated project turns on implicit usings, so `Console` resolves ✅[^1]. Directives that start with `#:` go at the top of the file ✅[^2].
   ```csharp
   #:property PublishAot=false
   using System.Runtime.InteropServices;
   Console.WriteLine($"{RuntimeInformation.FrameworkDescription} {RuntimeInformation.OSArchitecture}");
   ```
4. **Keep the run free of packages with `PublishAot=false`.** File-based apps turn on native ahead-of-time publishing by default, and the property switches it off ✅[^2]. In the lab, a probe without the property restored two packages on its first run, `Microsoft.DotNet.ILCompiler` and `Microsoft.NET.ILLink.Tasks` 10.0.12 (about 3 MB). They came from the SDK's own `library-packs` folder, not from nuget.org: each package's `.nupkg.metadata` names `/opt/homebrew/Cellar/dotnet/10.0.401/libexec/library-packs` as its source, and the SDK's `Microsoft.NET.NuGetOfflineCache.targets` adds that folder as a restore source ✅[^1]. The same probe with the property restored nothing: its `project.assets.json` lists zero libraries ✅[^1].
5. **Run it.** `dotnet run <file>.cs` builds a virtual project and runs it; arguments for the program go after `--` ✅[^2].
   ```console
   $ dotnet run info.cs
   .NET 10.0.12 Arm64
   $ dotnet run args.cs -- a b
   args=[a,b] runtime=10.0.12
   ```
6. **Use the web SDK for ASP.NET Core examples.** `#:sdk Microsoft.NET.Sdk.Web` swaps the SDK, the same way `<Project Sdk="…">` does in a project file ✅[^2]. It needs no download either, because `Microsoft.AspNetCore.App` is a shared runtime already installed with the SDK (Step 1) ✅[^1].
   ```csharp
   #:sdk Microsoft.NET.Sdk.Web
   #:property PublishAot=false
   var app = WebApplication.CreateBuilder(args).Build();
   app.MapGet("/", () => "ok");
   Console.WriteLine("built web app: " + app.GetType().Name);   // built web app: WebApplication
   ```
7. **Ask the compiler which C# it speaks.** The preprocessor line `#error version` makes the build fail with error CS8304, whose text names the compiler and language versions ✅[^1].
   ```console
   $ printf '#:property PublishAot=false\n#error version\n' > ver.cs && dotnet build ver.cs
   error CS8304: Compiler version: '5.9.0-1.26423.113 (e34a38d2…)'. Language version: 14.0. …
   ```
8. **Build Release for anything you time.** The default build configuration is `Debug` ✅[^8], and in a Debug build the JIT (just-in-time compiler) compiles every method with minimal optimizations, so tiering, Dynamic PGO (profile-guided optimization) and object stack allocation never happen ✅[^1]. Add `-c Release` to performance probes.
   ```console
   $ dotnet run -c Release bench.cs
   ```
9. **Pin the culture when a probe prints numbers.** The lab machine's culture is `en-VN` (from the macOS region setting), which writes `3,5` for 3.5 and parses `"3.5"` as `35` ✅[^1]. Set `CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;` at the top of such probes, unless culture is what the example shows.
10. **Grow into a project when one file is not enough.** `dotnet project convert probe.cs` turns the file into a regular project, for examples that need several files or a test framework ✅[^2].
11. **Pin packages and keep them in the lab folder.** A `#:package Name@Version` directive adds a package reference to a file-based app ✅[^2]; always give the version, so every reader restores the same code. Point `NUGET_PACKAGES` at a lab folder first: it overrides the default `~/.nuget/packages` and takes precedence over the configuration setting ✅[^10]. In the lab, a probe with `#:package BenchmarkDotNet@0.15.8` restored 26 package versions in 24 package folders (236 MB) into that folder on a 9-second first run, and `~/.nuget/packages` gained nothing ✅[^1].
    ```console
    $ export NUGET_PACKAGES="$PWD/nuget-packages"
    $ printf '#:package BenchmarkDotNet@0.15.8\n#:property PublishAot=false\nConsole.WriteLine(typeof(BenchmarkDotNet.Running.BenchmarkRunner).Assembly.GetName().Version);\n' > bdn-smoke.cs
    $ dotnet run bdn-smoke.cs
    0.15.8.0
    ```
12. **Install .NET tools into a lab folder.** `--tool-path` installs a tool into the given folder instead of the global tools folder ✅[^11]. Under the Homebrew SDK, the tool's own executable also needs `DOTNET_ROOT` (see Troubleshooting) ✅[^1].
    ```console
    $ dotnet tool install dotnet-counters --version 10.0.750501 --tool-path ./tools
    Tool 'dotnet-counters' (version '10.0.750501') was successfully installed.
    $ DOTNET_ROOT=/opt/homebrew/Cellar/dotnet/10.0.401/libexec ./tools/dotnet-counters --version
    10.0.750501+ad724c4b85e7ae775e42f393c6e95a7557a57954
    ```
13. **Run .NET 11 and C# 15 examples in the official SDK container.** Microsoft publishes the SDK image as `mcr.microsoft.com/dotnet/sdk` ✅[^12]. The `11.0` tag pulled digest `sha256:2794448a07118a6eaf00f29ab5d2bf44928517ce5ff86505a63a69230374f599` (linux/arm64, 910 MB, Ubuntu 26.04.1 LTS) ✅[^1]. Mount the probe folder, keep NuGet packages in a named volume, and add `--network none` whenever the probe declares no package; file-based apps then run fully offline in the container too ✅[^1].
    ```console
    $ docker pull mcr.microsoft.com/dotnet/sdk:11.0
    $ docker volume create nuget11
    $ docker run --rm --network none -e DOTNET_CLI_TELEMETRY_OPTOUT=1 -e DOTNET_NOLOGO=true \
        -v nuget11:/root/.nuget/packages -v "$PWD":/src -w /src \
        mcr.microsoft.com/dotnet/sdk:11.0 sh -c 'dotnet --version; dotnet run info.cs'
    11.0.100
    .NET 11.0.0 Arm64
    ```

## Verify
| Check | Command | Expected |
|---|---|---|
| SDK | `dotnet --version` | `10.0.401` ✅[^1] |
| Runtime the probe ran on | Step 3 probe | `.NET 10.0.12 Arm64` (or `X64` on an Intel machine) ✅[^1] |
| C# version | Step 7 | `Language version: 14.0` ✅[^1] |
| Build cache works | run the same probe twice | first run about 8 s, rerun about 1.7 s in the reference run; with warm build servers, 1.4–2.5 s and 0.2 s ✅[^1]; the SDK caches outputs per file and rebuilds only when inputs change ✅[^2] |
| No package restored | `obj/project.assets.json` in the probe's output folder | `"libraries": {}` ✅[^1] |
| Package folder | `ls "$NUGET_PACKAGES"` after Step 11 | 24 package folders, `benchmarkdotnet` and what its restore pulled in (the probe's `project.assets.json` lists 23 packages); `~/.nuget/packages` unchanged ✅[^1] |
| Tool | Step 12 | `10.0.750501+ad724c4b…` ✅[^1] |
| .NET 11 container | Step 13, plus Step 7's `#error version` probe inside it | `11.0.100`, `.NET 11.0.0 Arm64`, `Language version: 15.0` from Roslyn `5.12.0-1.26529.118` ✅[^1] |
| Where the build went | print `AppContext.BaseDirectory` | `~/Library/Application Support/dotnet/runfile/<name>-<sha256>/bin/debug/` on macOS ✅[^1] |

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `warning NU1903: Package 'Microsoft.DotNet.ILCompiler' 10.0.12 has a known high severity vulnerability` | NuGet audit warns when a restored package has a known vulnerability, with the code set by severity (NU1903 is "high") ✅[^6]. Restore downloads the vulnerability data from the audit sources, which default to the package sources such as nuget.org, even when the package itself came from a local folder ✅[^7]; runtime 10.0.12 (2026-09-08) has had three security releases after it, the latest 10.0.15 with SDK 10.0.404 on 2026-11-10 ✅[^4] | For the lab, add `#:property PublishAot=false` (Step 4), which drops the package. For the machine, install the latest .NET 10 patch. Note that `brew info dotnet` now shows `stable 11.0.100`: the Homebrew formula follows the newest major version ✅[^1] |
| `Warning: 'info.cs' appears to be a file-based app but was passed as an argument to the project '…other.csproj'` | A project file in the current folder wins: `dotnet run file.cs` runs that project and passes the file name as an argument ✅[^2] ✅[^1] | Run `dotnet run --file info.cs`, or keep probes in a folder without a `.csproj` |
| `warning CS7022: The entry point of the program is global code; ignoring 'Main()' entry point` | The file has top-level statements and also a `static void Main` ✅[^1] | Keep one entry point: delete `Main`, or delete the top-level statements |
| The output folder is not under `$TMPDIR` | The docs give `<temp>/dotnet/runfile/<appname>-<appfilesha>/bin/<configuration>/` ✅[^2], but SDK 10.0.401 on macOS used `~/Library/Application Support/dotnet/runfile/` ✅[^1] | Print `AppContext.BaseDirectory` to find it; `dotnet clean file-based-apps` deletes cached outputs unused for 30 days (`--days` changes that) ✅[^2] |
| Two runs of the same file at once fail on locked files | Concurrent invocations contend for the same build outputs ✅[^2] | `dotnet build file.cs` once, then start each copy with `dotnet run file.cs --no-build` ✅[^2] |
| JIT diagnostics such as `DOTNET_JitStdOutFile` also contain methods the probe never calls | `dotnet run` passes the `DOTNET_*` variables to the SDK process too, which is itself a .NET program, so both write to the same output ✅[^1] | Build first, then run the built assembly directly: `dotnet "<output folder>/<name>.dll"` |
| A published app's own executable (`./Hello`) fails with `.NET location: Not found`, or a tool from Step 12 prints `You must install .NET to run this application.` ✅[^1] | Homebrew's `/opt/homebrew/bin/dotnet` is a Bash wrapper that sets `DOTNET_ROOT` only for the `dotnet` process it starts ✅[^1]; apps look for that variable to find the installed runtime ✅[^9] | Export `DOTNET_ROOT=/opt/homebrew/Cellar/dotnet/10.0.401/libexec` in the shell, or start the app with `dotnet Hello.dll` |

## Rollback
Delete the probe folders and run `dotnet clean file-based-apps` to remove cached build outputs. The packages restored by Step 4's comparison were copied into `~/.nuget/packages/`; delete `microsoft.dotnet.ilcompiler` and `microsoft.net.illink.tasks` there to undo that copy. A probe that sets another target framework (for example `#:property TargetFramework=net9.0`) makes restore download that framework's reference packs from nuget.org into the same folder, as a `net9.0` probe did here (9.0.20 packs, about 87 MB) ✅[^1]; delete those package folders the same way. For Steps 11–13, delete the lab's `nuget-packages` and `tools` folders, then `docker volume rm nuget11` and `docker image rm mcr.microsoft.com/dotnet/sdk:11.0`. Nothing else changes on the machine.

## Takeaways
- Start every probe with `#:property PublishAot=false`, so restore needs no package and never hits an audit warning for a package the example does not use. [rule-candidate]
- Keep probes on the SDK's own target framework (`net10.0` here): any other target framework or runtime identifier makes restore download reference or runtime packs from nuget.org. [rule-candidate]
- Record the SDK, runtime and language versions next to every captured output (Step 7 prints the last two in one line), because C# features are tied to the target framework.
- Keep probe folders free of `.csproj` files, or always pass `--file`.

## Verification status
- Verified: 54 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Lab run, 2026-11-24: macOS 26.1 (arm64), .NET SDK 10.0.401 from the Homebrew `dotnet` formula, runtime 10.0.12, Roslyn 5.9.0; BenchmarkDotNet 0.15.8 and dotnet-counters 10.0.750501 restored into lab folders; Docker Engine 29.8.2 with `mcr.microsoft.com/dotnet/sdk:11.0` (SDK 11.0.100, runtime 11.0.0, Roslyn 5.12.0); the commands and outputs above. [^1]
- [File-based apps](https://learn.microsoft.com/en-us/dotnet/core/sdk/file-based-apps) — Microsoft, living. Rank 1. Backs: available from the .NET 10 SDK; `#:` directives; `dotnet run file.cs -- args`; a project in the folder wins; native AOT on by default and `PublishAot=false`; output and cache folders; `dotnet clean file-based-apps`; concurrent runs; `dotnet project convert`. [^2]
- [C# language versioning](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-versioning) — Microsoft, living. Rank 1. Backs: C# 14 needs .NET 10, C# 15 needs .NET 11; the default follows the target framework. [^3]
- [.NET releases index](https://github.com/dotnet/core/blob/main/release-notes/releases-index.json) — .NET team, living. Rank 1. Backs: .NET 11.0.0 released 2026-11-10; .NET 10 latest patch 10.0.15 with SDK 10.0.404; 10.0.12 released 2026-09-08 as a security release, followed by 10.0.13, 10.0.14 and 10.0.15. [^4]
- [.NET SDK telemetry](https://learn.microsoft.com/en-us/dotnet/core/tools/telemetry) — Microsoft, living. Rank 1. Backs: telemetry on by default; `DOTNET_CLI_TELEMETRY_OPTOUT`; `DOTNET_NOLOGO` hides only the banner. [^5]
- [NuGet warning NU1903](https://learn.microsoft.com/en-us/nuget/reference/errors-and-warnings/nu1903) — Microsoft, living. Rank 1. Backs: the warning means a restored package has a known vulnerability, and the code depends on severity. [^6]
- [dotnet run](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-run) — Microsoft, living. Rank 1. Backs: `-c|--configuration`, whose default for most projects is `Debug`. [^8]
- [Install .NET on macOS](https://learn.microsoft.com/en-us/dotnet/core/install/macos) — Microsoft, living. Rank 1. Backs: some apps look for `DOTNET_ROOT` to find where .NET is installed. [^9]
- [Managing the global packages, cache, and temp folders](https://learn.microsoft.com/en-us/nuget/consume-packages/managing-the-global-packages-and-cache-folders) — Microsoft, living. Rank 1. Backs: `NUGET_PACKAGES` overrides the global-packages folder and takes precedence over the configuration setting. [^10]
- [dotnet tool install](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-tool-install) — Microsoft, living. Rank 1. Backs: `--tool-path` installs a tool into the given folder. [^11]
- [.NET SDK container images](https://github.com/dotnet/dotnet-docker/blob/main/README.sdk.md) — .NET team, living. Rank 1. Backs: the SDK image is published as `mcr.microsoft.com/dotnet/sdk`. [^12]
- [Auditing package dependencies for security vulnerabilities](https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages) — Microsoft, living. Rank 1. Backs: restore downloads the `VulnerabilityInfo` resource from the audit sources, which default to the package sources. [^7]

## Related
- `dotnet/learning-path.md` — the order to read the `dotnet/` docs in.
- `dotnet/platform/runtime-and-versions.md` — SDK versus runtime, target frameworks and the support policy.
- `linux/lab-setup.md` — a disposable lab of the same kind, for the Linux topic and the other languages' examples.
