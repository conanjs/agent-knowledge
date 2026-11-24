---
schema: knowledge-doc/v1
type: concept
topic: dotnet/tooling
status: verified
applies-to: [".NET SDK 10.0.401 (Roslyn 5.9, dotnet format 10.0.401)", ".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, analyzers, code-analysis, ca-rules, ide-rules, analysislevel, analysismode, warninglevel, warning-waves, editorconfig, treatwarningsaserrors, warningsaserrors, nowarn, suppressmessage, pragma, dotnet-format, isaotcompatible]
ranked-sources: true
---

# Analyzers, warnings and code quality

## Summary
**TL;DR:** A .NET build reports three families of diagnostics: compiler warnings (`CS…`), code-quality analyzers (`CA…`) and code-style analyzers (`IDE…`), all shipped inside the SDK (software development kit) and run inside the compiler. Which ones appear is set in layers: `AnalysisLevel` and `AnalysisMode` pick the CA rule set, `WarningLevel` picks the compiler's warning waves, `.editorconfig` sets any single rule's severity, and `#pragma` or `[SuppressMessage]` silence one place. `TreatWarningsAsErrors` (and `WarningsAsErrors=nullable`) turns warnings into a failed build; `dotnet format` rewrites the code to satisfy the style rules and can check that nothing is left (`--verify-no-changes`).
**Use this when:** setting up a project's warning policy, a rule you expect never fires (or fires only in CI, the continuous-integration pipeline), a build passes locally and fails with `-warnaserror`, or you want formatting checked in a pipeline.
**Not this doc:** what the nullable warnings mean → `dotnet/type-design/nullable-reference-types.md`; why reflection triggers the trim and AOT (ahead-of-time compilation) warnings (IL2026, IL3050) → `dotnet/metaprogramming/reflection-and-attributes.md`; MSBuild properties, `Directory.Build.props` and project files in general → `dotnet/platform/projects-and-msbuild.md`; writing your own compiler plug-in → `dotnet/metaprogramming/source-generators.md`.

## Problem
Warning settings interact, and the result is often a surprise:
- `throw ex;` gives warning CA2200, but `double.Parse(s)` without a culture gives nothing, although rule CA1305 exists.
- Style rules set in `.editorconfig` show in the editor and never in `dotnet build`.
- `<AnalysisLevel>6</AnalysisLevel>` is expected to hide newer compiler warnings, and CS8981 still appears.
- A build that warns locally fails in CI, because CI passes `-warnaserror` and `CodeAnalysisTreatWarningsAsErrors=false` did not help.
- A second `dotnet build` prints no warnings at all, so they look fixed.

## Mental model
**Analogy:** the compiler is a proof-reader with a stack of rule books. The SDK hands it a big book (all CA and IDE rules) with most pages taped shut; `AnalysisLevel` says which edition of the book to use and `AnalysisMode` how many pages to untape. `.editorconfig` is a sticky note on a single page: "this one is an error", "ignore this one". `#pragma` is a pencil mark in the margin of one paragraph. `TreatWarningsAsErrors` tells the publisher to refuse any manuscript with a remark in it.

**Artifact** (one file, built in the lab with the default settings and then with `.editorconfig` next to it ✅[^lab]):
```csharp
#:property PublishAot=false
#:property Nullable=enable
using System.Globalization;
Console.WriteLine(Shop.Parse("3.5"));
Console.WriteLine(Shop.Label(null));
try { Shop.Fail(); } catch (Exception e) { Console.WriteLine(e.StackTrace?.Split('\n').Length); }

static class Shop
{
    public static double Parse(string s) => double.Parse(s);              // CA1305 (off by default)
    public static string Label(string? name) => name.ToUpper();           // CS8602 possible null dereference
    public static void Fail()
    {
        try { throw new InvalidOperationException("x"); }
        catch (Exception ex) { throw ex; }                                 // CA2200 rethrow loses the stack
    }
}
class lowercase { }                                                       // CS8981 (warning wave 7)
class Calc { public int Twice(int x) => x * 2; }                          // CA1822 (off by default)
```
```ini
# .editorconfig in the same folder
[*.cs]
dotnet_diagnostic.CA1822.severity = warning
dotnet_diagnostic.CA2200.severity = error
dotnet_diagnostic.CS8981.severity = none
```
```console
default build:        warning CA2200  warning CS8602  warning CS8981
with .editorconfig:   error CA2200    warning CA1822  warning CS8602
```

## How it works
Four actors decide what a build prints:
- **The C# compiler** — its job: report `CS` diagnostics and run every analyzer it is given, via `csc` inside `dotnet build`.
- **The analyzers** — their job: inspect the compiled code and report `CA`, `IDE` and `IL` diagnostics, via analyzer DLLs that the SDK adds to the compilation.
- **The configuration** — its job: set which rules run and at what severity, via MSBuild properties, the SDK's `.globalconfig` files, `.editorconfig` and in-source suppressions.
- **MSBuild** — its job: decide whether warnings fail the build, via `TreatWarningsAsErrors` or the `-warnaserror` switch.

```
project properties                    SDK                                  compiler run
AnalysisLevel=latest ─┐               analyzers/build/config/              csc
AnalysisMode=Default ─┼─▶ picks ──▶  analysislevel_10_default.globalconfig ──▶ CA rule severities
WarningLevel (from TFM: 10) ─────────────────────────────────────────────▶ warning waves 5…10
.editorconfig: dotnet_diagnostic.X.severity ─────────────────────────────▶ overrides per rule
#pragma / [SuppressMessage] ─────────────────────────────────────────────▶ silences one place
                                                                           │
TreatWarningsAsErrors / WarningsAsErrors / -warnaserror ◀──── diagnostics ─┘ → build fails or not
```

1. **Three families.** Compiler warnings carry `CS` codes; analyzer diagnostics carry `CA` (code quality) or `IDE` (code style), and the .NET analyzers come with the SDK and are on by default for projects targeting .NET 5 or later ✅[^ca-overview]. In the lab they live in `sdk/10.0.401/Sdks/Microsoft.NET.Sdk/analyzers/` and `…/codestyle/cs/`, with 770 rule-set files in `analyzers/build/config/` (one per level, mode and warnings-as-errors variant) ✅[^lab]. `EnableNETAnalyzers=false` removed CA2200 from the build ✅[^lab].
2. **Which CA rules run.** `AnalysisLevel` chooses the rule set of a .NET release; by default it matches the target framework, or is `latest` when the target is the newest release the SDK supports ✅[^msbuild-props]. `AnalysisMode` chooses how many rules are build warnings: `None`, `Default` (a small set), `Minimum`, `Recommended` or `All` ✅[^msbuild-props]; the two can be combined as `<AnalysisLevel>latest-recommended</AnalysisLevel>` ✅[^ca-overview]. On the artifact, `Default` reported only CA2200; `latest-recommended` added CA1304, CA1305, CA1311, CA1822 and CA1852; `All` also added CA1031 and CA1812 ✅[^lab].
3. **Compiler warning waves.** New compiler warnings that existing code could trigger arrive in opt-in "warning waves"; since the .NET 7 SDK, `WarningLevel` tracks the target framework when not set ✅[^warning-waves]. In the lab `WarningLevel` was `10` for `net10.0`, and CS8981 (wave 7) appeared; `<WarningLevel>6</WarningLevel>` removed it ✅[^lab]. The SDK sets `WarningLevel` from the target framework's major version, and to 9999 only for `AnalysisLevel=preview` ✅[^sdk-analyzers-targets].
4. **Severity per rule.** `.editorconfig` entries `dotnet_diagnostic.<id>.severity = error | warning | suggestion | silent | none | default` configure any analyzer rule; `dotnet_analyzer_diagnostic.category-<name>.severity` configures a category ✅[^ca-options]. Bulk settings in the file are ignored when an MSBuild property such as `AnalysisMode` configures analysis ✅[^ca-options]. In the lab the same syntax also silenced the compiler warning CS8981 (artifact) ✅[^lab]. Generated files (`*.designer.cs`, `*.generated.cs`, auto-generated headers) are skipped by code analysis but not by the compiler ✅[^ca-options].
5. **Code style on build.** `IDE` rules are off in command-line builds by default; `EnforceCodeStyleInBuild=true` plus a severity per rule turns them on, and since .NET 9 the option format `option = value:warning` also sets the build severity ✅[^ca-overview]. In the lab `-p:EnforceCodeStyleInBuild=true` turned IDE0007, IDE0040 and IDE0161 into build warnings ✅[^lab].
6. **Warnings as errors.** `TreatWarningsAsErrors` makes every compiler warning an error and stops the compiler from writing output; `WarningsAsErrors` and `WarningsNotAsErrors` list exceptions, and `nullable` stands for all nullable warnings ✅[^compiler-warnings]. The `-warnaserror` command-line switch applies to all MSBuild tasks and the compiler still writes output ✅[^compiler-warnings]. In the lab a failed `-warnaserror` build left `bin/Debug/net10.0/projwae.dll` on disk, a failed `TreatWarningsAsErrors` build did not ✅[^lab]. The overview says `CodeAnalysisTreatWarningsAsErrors=false` keeps CA rules as warnings under `-warnaserror` ✅[^ca-overview]; in the lab that held with the `TreatWarningsAsErrors` property and not with the switch (Edge cases) ✅[^lab].
7. **Suppressing.** `NoWarn` disables warnings project-wide (numbers, or `nullable`) ✅[^compiler-warnings]; `#pragma warning disable CA2200` … `restore` covers lines; `[SuppressMessage("Usage", "CA2200:…", Justification = "…")]` covers a member, or a whole scope from `GlobalSuppressions.cs` ✅[^ca-suppress]. In the lab both the pragma and the attribute removed their CA2200 warnings (2 warnings without them, 0 with) ✅[^lab].
8. **Trim and AOT analyzers.** `IsAotCompatible=true` turns on the trim, single-file and AOT analyzers ✅[^aot]. They come in the `Microsoft.NET.ILLink.Tasks` package, which SDK 10.0.401 carries in its own `library-packs/` folder, so a build with them needed no download (restore sources pinned to that folder) ✅[^lab]. What they report is covered in `dotnet/metaprogramming/reflection-and-attributes.md`.
9. **`dotnet format`** applies `.editorconfig` style preferences and analyzer fixes to a project or solution; `whitespace`, `style` and `analyzers` run one part each; `--verify-no-changes` exits non-zero if anything would change; `--severity` defaults to `warn`; it may restore, build and run the project's analyzers, so use it only on trusted code ✅[^dotnet-format].

## Worked example
A two-file project with an `.editorconfig` that asks for file-scoped namespaces, explicit accessibility and `var`, run through the whole loop in the lab ✅[^lab].

| Step | Command | Result |
|---|---|---|
| 1 | `dotnet build` | no style warnings: `IDE` rules do not run on the command line |
| 2 | `dotnet build -p:EnforceCodeStyleInBuild=true` | `warning IDE0007` (use `var`), `IDE0040` (accessibility modifiers), `IDE0161` (file-scoped namespace) |
| 3 | `dotnet format --verify-no-changes` | exit code 2; lists the IDE warnings plus `error WHITESPACE: Fix whitespace formatting. Insert '\s\s'.` for 5 lines that need two more spaces of indentation |
| 4 | `dotnet format` | exit code 0; `Shop.cs` becomes `namespace Lab.Shop;` with `internal class Cart`, `private int count;`, `var total = …`, 4-space indent; `Program.cs` gets `internal static class Helper` |
| 5 | `dotnet format --verify-no-changes` | exit code 0: ready for a CI gate |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `<AnalysisLevel>6</AnalysisLevel>` | CA rules follow level 6, but `WarningLevel` stays `10` and CS8981 still appears ✅[^lab] | The compiler-options page says the default `WarningLevel` matches `AnalysisLevel` ✅[^compiler-warnings]; the warning-waves page ✅[^warning-waves] and the SDK's targets file ✅[^sdk-analyzers-targets] tie it to the target framework, which is what SDK 10.0.401 did. Set `WarningLevel` itself |
| `dotnet build -warnaserror -p:CodeAnalysisTreatWarningsAsErrors=false` | CA2200 is still an error ✅[^lab] | The overview names `-warnaserror` as the case this property handles ✅[^ca-overview]; in the lab only `-p:TreatWarningsAsErrors=true` with the property kept CA2200 a warning ✅[^lab] |
| `dotnet build probe.cs -warnaserror` on a file-based app | `error MSB4025: The project file could not be loaded` ✅[^lab] | SDK 10.0.401 passed the `.cs` file to MSBuild as a project; use `#:property TreatWarningsAsErrors=true` instead ✅[^lab] |
| Running `dotnet build` twice | The second, up-to-date build printed no warnings ✅[^lab] | Nothing was recompiled; use `--no-incremental` to see them again |
| `dotnet format probe.cs` on a file-based app | `FileNotFoundException: … does not appear to be a valid project or solution file` ✅[^lab] | `dotnet format` 10.0.401 needs a project or solution; `dotnet format whitespace --folder .` works on plain files ✅[^lab] ✅[^dotnet-format] |
| `<WarningsAsErrors>nullable</WarningsAsErrors>` | CS8602 fails the build while CA2200 and CS8981 stay warnings ✅[^lab] | `nullable` is shorthand for every nullable warning ✅[^compiler-warnings] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `TreatWarningsAsErrors=true` everywhere | No warning debt can build up | A new SDK with new rules can break the build; pin `AnalysisLevel` and `WarningLevel` to upgrade on your own schedule |
| `WarningsAsErrors=nullable` only | Null-safety enforced, style left as advice | Other warnings may pile up |
| `AnalysisLevel=latest-recommended` | Catches culture, performance and design issues | More warnings to triage on day one |
| `.editorconfig` severities | One reviewed file; also read by editors and `dotnet format` | Bulk entries are ignored once `AnalysisMode` is set ✅[^ca-options] |
| `#pragma` / `[SuppressMessage]` | Narrow and visible next to the code | Easy to forget; always give a `Justification` |

## Takeaways
- In CI, run `dotnet build -warnaserror` (or set `TreatWarningsAsErrors`) and `dotnet format --verify-no-changes`. [rule-candidate]
- Pin `AnalysisLevel` and `WarningLevel` explicitly when a new SDK must not add warnings; one does not imply the other on SDK 10.0.401. [rule-candidate]
- Configure rule severities in `.editorconfig`, and keep in-source suppressions for single, justified cases.
- Set `EnforceCodeStyleInBuild=true` if style rules must hold outside the editor.
- When checking whether warnings are gone, build with `--no-incremental`.

## Verification status
- Verified: 45 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Overview of .NET source code analysis](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview) — Microsoft, living. Rank 1. Backs: CA and IDE prefixes, analyzers in the SDK and on by default, `latest-recommended`, code style off on the command line and `EnforceCodeStyleInBuild`, `CodeAnalysisTreatWarningsAsErrors` with `-warnaserror`. [^ca-overview]
- [Code analysis configuration options](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/configuration-options) — Microsoft, living. Rank 1. Backs: severity values and scopes, bulk settings ignored with `AnalysisMode`, generated code excluded. [^ca-options]
- [How to suppress code analysis warnings](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/suppress-warnings) — Microsoft, living. Rank 1. Backs: `#pragma`, `SuppressMessage`, global suppressions. [^ca-suppress]
- [MSBuild properties for Microsoft.NET.Sdk](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props) — Microsoft, living. Rank 1. Backs: `AnalysisLevel` values and default; the `AnalysisMode` values. [^msbuild-props]
- [C# compiler options for errors and warnings](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/errors-warnings) — Microsoft, living. Rank 1. Backs: `WarningLevel`, `TreatWarningsAsErrors` and no output, `-warnaserror` affects all tasks, `WarningsAsErrors`/`WarningsNotAsErrors`, `nullable`, `NoWarn`; the statement that `WarningLevel` matches `AnalysisLevel`. [^compiler-warnings]
- [C# warning waves](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/warning-waves) — Microsoft, living. Rank 1. Backs: opt-in warning waves; `WarningLevel` tracks the target framework; CS8981 is wave 7. [^warning-waves]
- [dotnet format](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format) — Microsoft, living. Rank 1. Backs: what it fixes, subcommands, `--folder`, `--verify-no-changes`, `--severity`, the trusted-code caution. [^dotnet-format]
- [Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/) — Microsoft, living. Rank 1. Backs: `IsAotCompatible` turns on the trim, single-file and AOT analyzers. [^aot]
- [Microsoft.NET.Sdk.Analyzers.targets](https://github.com/dotnet/sdk/blob/main/src/Tasks/Microsoft.NET.Build.Tasks/targets/Microsoft.NET.Sdk.Analyzers.targets) — .NET SDK team, living. Rank 1. Backs: `WarningLevel` from the target framework's major version, 9999 for `preview`. [^sdk-analyzers-targets]

## Related
- `dotnet/tooling/testing.md` — the other half of a CI quality gate.
- `dotnet/type-design/nullable-reference-types.md` — the CS86xx warnings that `WarningsAsErrors=nullable` enforces.
- `dotnet/metaprogramming/reflection-and-attributes.md` — the trim and AOT warnings in practice.
- `dotnet/platform/projects-and-msbuild.md` — where to put these properties (`Directory.Build.props`).
- `dotnet/errors-and-resources/exceptions.md` — why `throw ex;` (CA2200) loses the stack trace.
