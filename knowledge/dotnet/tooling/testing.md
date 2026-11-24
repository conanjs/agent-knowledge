---
schema: knowledge-doc/v1
type: concept
topic: dotnet/tooling
status: verified
applies-to: [".NET SDK 10.0.401 (runtime 10.0.12): its test templates and dotnet test", "C# 14", "xunit 2.9.3 with xunit.runner.visualstudio 4.0.1 and Microsoft.NET.Test.Sdk 18.12.0", "xunit.v3.mtp-v2 4.0.3 (templates from xunit.v3.templates 4.0.3)", "MSTest and MSTest.Sdk 4.5.3", "NUnit 5.0.0 with NUnit3TestAdapter 6.3.1", "TUnit 1.87.12", "Microsoft.Testing.Platform 2.4.1-2.5.3, Microsoft.Testing.Extensions.CodeCoverage 18.12.0, Microsoft.Testing.Extensions.TrxReport 2.5.3", "coverlet.collector 10.1.1, ReportGenerator 5.6.1", ".NET 11.0.0 / C# 15 (container lab)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, testing, dotnet-test, vstest, microsoft-testing-platform, mtp, xunit, xunit-v3, mstest, nunit, tunit, fixtures, theory, data-driven, mocking, code-coverage, coverlet]
ranked-sources: true
---

# Testing: frameworks, runners and `dotnet test`

## Summary
**TL;DR:** A .NET test run has two parts: a **test framework** (xUnit.net, MSTest, NUnit, TUnit) that gives you attributes such as `[Fact]` or `[TestMethod]`, and a **test platform** that finds and runs the tests: the older VSTest (driven by `vstest.console`, the default of `dotnet test`) or Microsoft.Testing.Platform (MTP), which is built into the test project so the project itself is an executable. The .NET 10 SDK (software development kit) can run `dotnet test` in a native MTP mode chosen in `global.json`. Frameworks differ in how often they create the test class (xUnit and MSTest: once per test; NUnit: once per class by default), which decides whether state leaks between tests. The lab ran xUnit.net v2 and v3, MSTest 4.5.3, NUnit 5.0.0 and TUnit 1.87.12 with VSTest and MTP on the .NET 10 SDK, and the .NET 11 runner switch in a .NET 11 container; what it could not run (Microsoft Fakes, Native AOT (ahead-of-time compilation) test runs, `dotnet watch`) is marked where it appears, and one documented detail, where MSTest runs its global per-test hooks, came out differently (Edge cases).
**Use this when:** starting a test project, choosing between VSTest and MTP, a run reports "zero tests" or exit code 8, state leaks between tests, or setting up data-driven tests, fakes and coverage.
**Not this doc:** how attributes and reflection work, which runners rely on → `dotnet/metaprogramming/reflection-and-attributes.md`; analyzers and a CI (continuous integration) quality gate → `dotnet/tooling/analyzers-and-code-quality.md`; dependency injection used in tests → `dotnet/app-model/dependency-injection.md`.

## Problem
- `dotnet new xunit` creates an xUnit.net v2 project, while the xUnit.net v3 getting-started page describes an executable project made from a separate template package.
- `dotnet test --coverage` is rejected with `MSBUILD : error MSB1001: Unknown switch.` ✅[^lab], because `dotnet test` runs in VSTest mode unless told otherwise.
- A CI job that used to pass now fails with exit code 8 after a move to MTP, because one project contains no tests.
- A test passes alone and fails in the full run, because a field set by an earlier test is still there (NUnit shares one instance per class).
- A solution mixes VSTest and MTP projects, which is not supported.

## Mental model
**Analogy:** an exam. The test framework is the paper format: how a question is written (`[Fact]`, `[TestCase]`) and how a mark is given (`Assert`). The test platform is the exam hall: it collects the papers, seats them, times them and posts the results. VSTest is a central hall that every school sends papers to; MTP is a hall each school builds into its own building, so a test project can be started like any program. `dotnet test` is the receptionist who sends you to one hall or the other.

**Artifact** — a sketch of the mechanism, not a framework: a plain console program that does what a runner does (find methods by attribute through reflection, create the class, call the method, catch the failure, report), run in the lab ✅[^lab]. The core loop, unchanged from the 50-line program:
```csharp
foreach (var method in type.GetMethods().Where(m => m.IsDefined(typeof(TestAttribute)) || m.IsDefined(typeof(CaseAttribute))))
{
    var cases = method.GetCustomAttributes<CaseAttribute>().Select(c => c.Args).DefaultIfEmpty([]);
    foreach (object?[] arguments in cases)
    {
        object instance = shared ?? Activator.CreateInstance(type)!;   // xUnit/MSTest style: new instance per test
        string name = $"{type.Name}.{method.Name}({string.Join(", ", arguments)})";
        try
        {
            method.Invoke(instance, BindingFlags.DoNotWrapExceptions, null, arguments, null);
            passed++; Console.WriteLine($"  passed {name}");
        }
        catch (Exception e) { failed++; Console.WriteLine($"  failed {name}: {e.GetType().Name}: {e.Message}"); }
        finally { (instance as IDisposable)?.Dispose(); }
    }
}
```
The tests it ran: `CartTests` with a per-instance field `List<int> _items`, `[Test] AddOne` (adds 1 item, expects a count of 1), `[Test] AddTwo` (adds 2, expects 2) and `Sum(a, b, expected)` with `[Case(2, 3, 5)] [Case(-1, 1, 0)] [Case(2, 2, 5)]`.
```console
$ dotnet run g-runner-sketch.cs                 # new instance per test (passed lines omitted)
  failed CartTests.Sum(2, 2, 5): Exception: expected 5, got 4
Total: 5, Passed: 4, Failed: 1 in 15 ms         # exit code 2
$ dotnet run g-runner-sketch.cs -- --shared     # one instance for the whole class
  failed CartTests.AddTwo(): Exception: expected 2, got 3
  failed CartTests.Sum(2, 2, 5): Exception: expected 5, got 4
Total: 5, Passed: 3, Failed: 2 in 12 ms         # exit code 2
```

## How it works
Four actors in a test run:
- **The test framework** — its job: define how tests are written and decide pass or fail, via attributes and `Assert` APIs in the test project.
- **The adapter or runner** — its job: connect the framework to a platform, via a package such as `xunit.runner.visualstudio` (VSTest) or the framework's MTP runner.
- **The test platform** — its job: discover and run tests and report results, via `vstest.console` (VSTest) or `Microsoft.Testing.Platform.dll` inside the test executable (MTP).
- **`dotnet test` or the IDE (integrated development environment)** — its job: build the projects and start the platform, via the VSTest MSBuild target or, in MTP mode, by running each test application.

```
VSTest mode (default)                                MTP mode (global.json "test": {"runner": "Microsoft.Testing.Platform"})
dotnet test ─▶ build ─▶ VSTest target ─▶ vstest.console   dotnet test ─▶ build ─▶ run MyTests (an exe) for each project
                                          │ loads adapter                               │ MTP inside the exe
                                          ▼                                             ▼
                                 framework discovers + runs                   framework discovers + runs
                                          │                                             │
                                   results ─▶ console / TRX                     results, exit code (8 = zero tests)
```

1. **Framework and platform are separate.** The platform runs tests and talks to IDEs and the command line; the framework, built on top, defines the attributes and APIs and usually reaches the platform through an adapter ✅[^testing-index]. The common frameworks are MSTest, NUnit, TUnit and xUnit.net; all but TUnit support both VSTest and MTP, and TUnit, MTP-only, discovers tests at compile time with source generation, which makes it Native AOT compatible ✅[^testing-index]. In the lab xUnit.net v3, MSTest and NUnit each ran in both modes, while TUnit failed in VSTest mode (the MTP v2 error under Edge cases) and ran in MTP mode; TUnit's source generator wrote a `TU_CalcTests__TestSource.g.cs` that calls `instance.Adds()` directly ✅[^lab]. TUnit under Native AOT was not tried: an AOT publish needs the platform's ILCompiler package, which this run did not download.
2. **VSTest mode.** It is the default of `dotnet test` and the only mode before the .NET 10 SDK: `dotnet test` invokes the `VSTest` MSBuild target, which ends up running `vstest.console`, and every command-line option is translated for it ✅[^dotnet-test-modes]. In the lab the MSBuild command line that `dotnet test` printed (in the `--coverage` error) carried `--target:VSTest`, and runs began with `Test run for …/XV2.dll (.NETCoreApp,Version=v10.0)` and `A total of 1 test files matched the specified pattern.` ✅[^lab]. The SDK 10.0.401 templates are VSTest projects: `dotnet new xunit` references `Microsoft.NET.Test.Sdk` 17.14.1, `xunit` 2.9.3, `xunit.runner.visualstudio` 3.1.4 and `coverlet.collector` 6.0.4; `dotnet new nunit` references NUnit 4.3.2 with `NUnit3TestAdapter` 5.0.0; `dotnet new mstest` references the `MSTest` 4.0.2 package and adds `[assembly: Parallelize(Scope = ExecutionScope.MethodLevel)]` ✅[^lab]. With their package versions raised to those in `applies-to`, all three ran under a plain `dotnet test` ✅[^lab].
3. **MTP.** It is embedded in the test project, so no `vstest.console` or `dotnet test` is needed to run tests ✅[^mtp-intro]; `dotnet run` on an MSTest.Sdk project printed `Test run summary: Passed!` ✅[^lab]. Its design avoids reflection and isolation contexts (`AppDomain`, `AssemblyLoadContext`) to coordinate a run, registers extensions at compile time, and supports .NET 8 and later, .NET Framework 4.6.2 and later, and Native AOT ✅[^mtp-intro]. Migrating means `<OutputType>Exe</OutputType>` in every test project ✅[^mtp-migrate]; without it an xUnit.net v3 build failed with `xUnit.net v3 test projects must be executable (set project property '<OutputType>Exe</OutputType>')`, while `EnableMSTestRunner` set `OutputType` to `Exe` by itself ✅[^lab]. With the .NET 10 SDK, `global.json` `"test": { "runner": "Microsoft.Testing.Platform" }` switches `dotnet test` to MTP mode; without a setting it uses VSTest ✅[^dotnet-test] ✅[^lab]. From .NET 11 the `DOTNET_TEST_RUNNER` environment variable can choose the runner and overrides `global.json`; it ignores case, and an empty or unknown value falls back to `global.json` ✅[^dotnet-test]. In the .NET 11 container an MSTest.Sdk project ran in MTP mode with `Microsoft.Testing.Platform` or `microsoft.testing.platform` and no `global.json`, `VSTest` forced VSTest mode over a `global.json` MTP setting, and `bogus` or an empty value kept MTP ✅[^lab11]; the .NET 10 SDK ignored the variable ✅[^lab].
4. **xUnit.net v3.** Its test projects are stand-alone executables (`OutputType` `Exe`) that `dotnet run` can start, and its templates come from a separate package, `xunit.v3.templates` ✅[^xunit-v3]. In the lab `xunit.v3.templates` 4.0.3 was installed into a lab-local template folder (`dotnet new install xunit.v3.templates@4.0.3 --debug:custom-hive <folder>`); `dotnet new xunit3 -f net10.0` (the default is `net8.0`) wrote `OutputType` `Exe`, a reference to `xunit.v3.mtp-v2` 4.0.3 and a `global.json` that selects MTP, and `--test-runner vstest` swapped in `xunit.v3.mtp-off`, `xunit.runner.visualstudio` and `Microsoft.NET.Test.Sdk` ✅[^lab]. `dotnet run` started `xUnit.net v3 In-Process Runner v4.0.3` and ended with `Total: 17, Errors: 0, Failed: 1, Skipped: 0, Not Run: 0` and exit code 1 ✅[^lab]. The SDK's built-in `xunit` template still produced an xUnit.net v2 project (package `xunit` 2.9.3) ✅[^lab].
5. **Test class lifetime.** xUnit.net creates a new instance of the test class for every test, so the constructor is per-test setup and `Dispose` per-test cleanup; to share one object, use `IClassFixture<T>` (one class), a collection fixture with `[CollectionDefinition]` and `ICollectionFixture<T>` (several classes), or, new in v3, `[assembly: AssemblyFixture(typeof(T))]` ✅[^xunit-shared]. In the lab (v2 and v3) every test, each `[InlineData]` row included, got a new instance; the class fixture was created once and disposed after its class, one collection fixture served both classes of its collection, and the v3 assembly fixture was created first and disposed last ✅[^lab]. MSTest runs, per test: constructor, `TestContext`, global and class-hierarchy `TestInitialize`, the test, `TestCleanup` (derived to base), global cleanup, then `DisposeAsync` and `Dispose`; `AssemblyInitialize` and `ClassInitialize` run once ✅[^mstest-lifecycle]. MSTest 4.5.3 created a new instance per test and kept that order, except that it ran the two global hooks outside the constructor and `Dispose` (Edge cases) ✅[^lab]. NUnit by default creates a single instance shared by every test in a fixture; `[FixtureLifeCycle(LifeCycle.InstancePerTestCase)]` (NUnit 3.13) gives one per test ✅[^nunit-lifecycle]. With NUnit 5.0.0, `AddTwo` saw the item `AddOne` left behind and failed, and `InstancePerTestCase` gave each test its own instance ✅[^lab]; the `--shared` run of the sketch shows the same leak ✅[^lab].
6. **Data-driven tests.** xUnit.net uses `[Theory]` with `[InlineData(…)]` ✅[^xunit-tutorial]; MSTest uses `[DataRow(…)]` for inline values and `[DynamicData]` for values from a method, property or field ✅[^mstest-data]; NUnit uses `[TestCase(…)]`, one invocation per attribute ✅[^nunit-testcase]. In the lab each row ran and was reported as a test of its own: `XV2.CartTests.Sum(a: 2, b: 2, expected: 5) [FAIL]` (xUnit.net), 5 results from three `[DataRow]`s and a two-row `[DynamicData]` property (MSTest), `Sum(2,2,5)` (NUnit) ✅[^lab].
7. **Parallel defaults.** MSTest runs tests one after another inside an assembly unless `[assembly: Parallelize]` or the matching settings turn parallelization on ✅[^mstest-execution]. The template's `MethodLevel` attribute ran four 500 ms tests at once (549 ms in total), and without it they ran on one thread in 2 s ✅[^lab]. xUnit.net runs test collections (one per class by default) in parallel and the tests of one collection one after another, on up to one thread per CPU ✅[^xunit-parallel]; NUnit runs nothing in parallel unless `[Parallelizable]` allows it ✅[^nunit-parallel]. Two classes of two 500 ms tests took about 1 s under xUnit.net v2 and v3, the classes overlapping, and 2 s on one thread under NUnit 5.0.0 ✅[^lab].
8. **Test doubles.** In common .NET usage a *fake* is any stand-in, a *stub* replaces a dependency so the code can run, and a *mock* is a fake that the test asserts against; the docs note that classic literature uses the words more narrowly ✅[^best-practices]. MTP has a Microsoft Fakes extension for stubs and shims (replacing even static methods such as `File.Open`) ✅[^mtp-fakes]; it needs a Visual Studio Enterprise installation (17.11 or later) ✅[^mtp-fakes], so the macOS lab did not run it.
9. **Coverage.** Under VSTest, `dotnet test --collect:"XPlat Code Coverage"` uses the Coverlet collector, and ReportGenerator turns the result into a report ✅[^coverage]. In the lab coverlet.collector 10.1.1 wrote `TestResults/<guid>/coverage.cobertura.xml` (line rate 1, branch rate 0.5 for a `Divide` whose zero check never fired), and ReportGenerator 5.6.1 (`reportgenerator -reports:<file> -targetdir:<dir> -reporttypes:"Html;TextSummary"`) made `index.html` and a `Summary.txt` with `Line coverage: 100%` and `Branch coverage: 50% (1 of 2)` ✅[^lab]. Under MTP, the `Microsoft.Testing.Extensions.CodeCoverage` extension adds `--coverage`, writing a `.coverage` file, or `xml` or `cobertura` with `--coverage-output-format`; `--coverage` needs `dotnet test` in MTP mode ✅[^coverage] ✅[^mtp-coverage]. Extension 18.12.0 wrote `TestResults/<guid>.coverage`, `<guid>.xml` and `<guid>.cobertura.xml` for the three choices, a project without it answered `Unknown option '--coverage'` with exit code 5, and the MSTest.Sdk default profile and the `MSTest` 4.5.3 package both bring it, with the TRX (Visual Studio test results file) report ✅[^lab].
10. **Selecting tests.** `dotnet test --filter <expression>` filters on properties such as `FullyQualifiedName`, `Name` and `TestCategory` (MSTest, NUnit), or `DisplayName` and trait keys (xUnit); a bare value means "`FullyQualifiedName` contains" ✅[^filter]. In VSTest mode the lab ran `--filter AddO` → 1 test (`AddOne`), xUnit.net `Category=Math` (a trait key) → 3, MSTest `TestCategory=Math` → 3, `Name=One` → 1 and `ClassName=MS.SlowA` → 2, and NUnit `TestCategory=Math` or `Category=Math` → 3 ✅[^lab]. In MTP mode each framework parses its own options: xUnit.net has `--filter-trait` where MSTest has `--filter` ✅[^dotnet-test-modes]; MSTest and NUnit took `--filter TestCategory=Math`, and xUnit.net v3 took `--filter-class` ✅[^lab].

## Worked example
The runner sketch from the Mental model, run end to end in the lab (`g-runner-sketch.cs`, a plain console program) ✅[^lab].

| Step | What the sketch does | Real value |
|---|---|---|
| 1 | Discover: reflect over the assembly for methods marked `[Test]` or `[Case]` | `CartTests`: `AddOne`, `AddTwo`, `Sum` |
| 2 | Expand data: one invocation per `[Case(…)]` attribute | `Sum(2, 3, 5)`, `Sum(-1, 1, 0)`, `Sum(2, 2, 5)`: 5 tests in total |
| 3 | Create: `Activator.CreateInstance(typeof(CartTests))` before each test | 5 instances |
| 4 | Run: `MethodInfo.Invoke` with `DoNotWrapExceptions`, catch the assertion | `Sum(2, 2, 5)` fails: `expected 5, got 4` |
| 5 | Report and exit | `Total: 5, Passed: 4, Failed: 1`, exit code 2 |
| 6 | Same run with one shared instance | `AddTwo` also fails (`expected 2, got 3`): 3 passed, 2 failed |

Real frameworks add what the sketch lacks: parallel scheduling, timeouts, fixtures, filters, result files and an IDE protocol.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A test project with zero tests under MTP | Exit code 8; VSTest treats the same run as success ✅[^mtp-migrate]. In the lab MTP printed `Test run summary: Zero tests ran` and exit code 8, `--ignore-exit-code 8` turned it into 0, and VSTest printed `No test is available in …/ZVS.dll` and exit code 0 ✅[^lab] | MTP fails a run where nothing ran |
| `--minimum-expected-tests` not reached | Exit code 9 ✅[^dotnet-test-mtp]; the lab printed `Minimum expected tests policy violation, tests ran 2, minimum expected 5` ✅[^lab] | Distinct from 8 so the two policies can be told apart |
| A failing test | Exit code 2 in MTP mode and 1 in VSTest mode; a run that also missed `--minimum-expected-tests` still ended with 2 ✅[^lab] | MTP has its own exit-code table, which its summary line links (`aka.ms/testingplatform/exitcodes`) |
| VSTest and MTP projects in one solution or run | Not supported ✅[^platforms]. MTP mode refused before running anything: `global.json defines test runner to be Microsoft.Testing.Platform. All projects must use that test runner.`, followed by the VSTest project's name; VSTest mode ran the VSTest project and failed the MTP one ✅[^lab] | Choose one platform per repository |
| `--report-trx` under MTP without the TRX extension | The test application rejects it, exit code 5 ✅[^dotnet-test-modes]; the lab printed `Unknown option '--report-trx'` and `Option '--report-trx' is provided by the 'Microsoft.Testing.Extensions.TrxReport' extension. Add a package reference to use it.` ✅[^lab] | TRX reporting is an extension (`Microsoft.Testing.Extensions.TrxReport`), not built in; with it the lab got `TestResults/<project>_net10.0_arm64.trx` ✅[^lab] |
| MTP projects run through VSTest mode on the .NET 10 SDK | Legacy; support is removed in MTP v2 when run with the .NET 10 SDK ✅[^dotnet-test-modes]. With MTP 2.5 (xUnit.net v3, MSTest.Sdk, TUnit) the build failed with `Testing with VSTest target is no longer supported by Microsoft.Testing.Platform on .NET 10 SDK and later. If you use dotnet test, you should opt-in to the new dotnet test experience.`, with or without `TestingPlatformDotnetTestSupport=true` ✅[^lab] | Use the MTP mode of `dotnet test` |
| Global test hooks in MSTest 4.5.3 | The docs order is constructor, `TestContext`, `GlobalTestInitialize`, `TestInitialize` … `TestCleanup`, `GlobalTestCleanup`, `DisposeAsync`, `Dispose` ✅[^mstest-lifecycle]; the lab, in VSTest and MTP mode, parallel or not, ran `GlobalTestInitialize` before the constructor and `GlobalTestCleanup` after `Dispose` ✅[^lab] | The Rank 1 docs govern How it works (KB-17); the lab shows what 4.5.3 does. Keep global hooks independent of the test instance and its disposal |
| A field written in one NUnit test, read in another | The value carries over ✅[^nunit-lifecycle]; reproduced with NUnit 5.0.0 and by the sketch's `--shared` run ✅[^lab] | One fixture instance by default |
| `--filter Traits=Math` or `--filter Name=AddTwo` on xUnit.net | Both matched nothing (`No test matches the given testcase filter`), while `Category=Math` ran the 3 tests marked `[Trait("Category", "Math")]` ✅[^lab] | The filter table lists `FullyQualifiedName`, `DisplayName` and `Traits` for xUnit, and its examples filter on the trait key ✅[^filter] |
| `dotnet new xunit` without `--no-restore` | Restores the packages from nuget.org | The template references them (Step 2); the lab used `--no-restore --no-update-check` to stay offline ✅[^lab] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| VSTest | Longest compatibility record across tools and pipelines; can mix .NET and non-.NET adapters ✅[^platforms] | No Native AOT or trimming test runs ✅[^platforms] |
| MTP | Test projects run like ordinary executables (`dotnet run`, `dotnet watch`); strict defaults such as failing when no tests run; Native AOT ✅[^platforms]. `dotnet run` and the zero-test failure ran in the lab; `dotnet watch` and Native AOT did not ✅[^lab] | Some third-party integrations may lag behind ✅[^platforms] |
| xUnit.net | A fresh instance per test isolates state ✅[^xunit-shared] ✅[^lab] | Shared expensive setup needs fixtures |
| NUnit (default lifecycle) | One instance per fixture, cheap setup | State can leak between tests unless `InstancePerTestCase` ✅[^nunit-lifecycle] ✅[^lab] |
| TUnit | Compile-time discovery, Native AOT ✅[^testing-index] | MTP only ✅[^testing-index] ✅[^lab] |

## Takeaways
- Pick one platform (VSTest or MTP) for the whole repository and configure it once (`global.json`, `Directory.Build.props`). [rule-candidate]
- Keep tests independent of order: no static or shared instance state unless a fixture owns it. [rule-candidate]
- On MTP, expect exit code 8 for an empty test project and decide deliberately how CI treats it.
- Before CI passes `--report-trx` or `--coverage` to MTP projects, reference `Microsoft.Testing.Extensions.TrxReport` and `Microsoft.Testing.Extensions.CodeCoverage` in each of them (MSTest.Sdk's default profile already does); otherwise the run ends with exit code 5.
- Prefer hand-written fakes for your own interfaces, and name them for what they do in the test (stub or mock).
- Generate test templates with `--no-restore` when you only want to see the project shape.

## Verification status
- Verified: 83 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24, with test projects whose packages were restored into the lab's own package folder (Step 11): xunit 2.9.3, xunit.runner.visualstudio 4.0.1, Microsoft.NET.Test.Sdk 18.12.0, coverlet.collector 10.1.1, xunit.v3.mtp-v2 and xunit.v3.mtp-off 4.0.3, MSTest and MSTest.Sdk 4.5.3, NUnit 5.0.0, NUnit3TestAdapter 6.3.1, TUnit 1.87.12, Microsoft.Testing.Extensions.CodeCoverage 18.12.0 and Microsoft.Testing.Extensions.TrxReport 2.5.3; the xunit.v3.templates 4.0.3 template package in a lab-local template folder, and ReportGenerator 5.6.1 installed with `--tool-path` (Step 12). [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [Testing in .NET](https://learn.microsoft.com/en-us/dotnet/core/testing/) — Microsoft, living. Rank 1. Backs: platform versus framework and adapters; the four frameworks; TUnit MTP-only with compile-time discovery. [^testing-index]
- [Test platforms overview](https://learn.microsoft.com/en-us/dotnet/core/testing/test-platforms-overview) — Microsoft, living. Rank 1. Backs: VSTest versus MTP, do not mix, when to choose each. [^platforms]
- [Microsoft.Testing.Platform overview](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-intro) — Microsoft, living. Rank 1. Backs: embedded in the test project, design pillars, supported targets. [^mtp-intro]
- [Testing with dotnet test](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-with-dotnet-test) — Microsoft, living. Rank 1. Backs: VSTest mode and the VSTest target, MTP mode from the .NET 10 SDK, legacy MTP-under-VSTest, `--report-trx` exit code 5, framework-specific MTP options (`--filter-trait` versus `--filter`). [^dotnet-test-modes]
- [dotnet test](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-test) — Microsoft, living. Rank 1. Backs: `global.json` runner selection, VSTest by default, `DOTNET_TEST_RUNNER` in .NET 11 (case-insensitive, overrides `global.json`, empty or unknown values fall back). [^dotnet-test]
- [dotnet test with MTP](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-test-mtp) — Microsoft, living. Rank 1. Backs: exit code 9 for `--minimum-expected-tests`. [^dotnet-test-mtp]
- [Migrate from VSTest to MTP](https://learn.microsoft.com/en-us/dotnet/core/testing/migrating-vstest-microsoft-testing-platform) — Microsoft, living. Rank 1. Backs: `OutputType` `Exe`; zero tests is exit code 8. [^mtp-migrate]
- [Unit testing C# with xUnit](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-csharp-with-xunit) — Microsoft, living. Rank 1. Backs: `[Fact]`, `[Theory]` and `[InlineData]`. [^xunit-tutorial]
- [MSTest lifecycle](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) — Microsoft, living. Rank 1. Backs: assembly, class and test-level order. [^mstest-lifecycle]
- [Data-driven testing in MSTest](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-data-driven) — Microsoft, living. Rank 1. Backs: `DataRow`, `DynamicData`. [^mstest-data]
- [Control MSTest execution](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) — Microsoft, living. Rank 1. Backs: sequential by default, `[assembly: Parallelize]` scopes. [^mstest-execution]
- [Unit testing best practices](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices) — Microsoft, living. Rank 1. Backs: fake, stub and mock. [^best-practices]
- [Microsoft Fakes (MTP)](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-fakes) — Microsoft, living. Rank 1. Backs: stubs and shims extension; needs Visual Studio Enterprise 17.11 or later. [^mtp-fakes]
- [Use code coverage for unit testing](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-code-coverage) — Microsoft, living. Rank 1. Backs: Coverlet `XPlat Code Coverage`, ReportGenerator, `--coverage` needs MTP mode, output formats. [^coverage]
- [Code coverage (MTP)](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-code-coverage) — Microsoft, living. Rank 1. Backs: `Microsoft.Testing.Extensions.CodeCoverage`, `--coverage`. [^mtp-coverage]
- [Run selected unit tests](https://learn.microsoft.com/en-us/dotnet/core/testing/selective-unit-tests) — Microsoft, living. Rank 1. Backs: `--filter` syntax and properties; xUnit traits filtered by their key in the examples. [^filter]
- [Shared context between tests](https://xunit.net/docs/shared-context) — xUnit.net, living. Rank 1. Backs: new instance per test, class, collection and assembly fixtures. [^xunit-shared]
- [Getting started with xUnit.net v3](https://xunit.net/docs/getting-started/v3/getting-started) — xUnit.net, living. Rank 1. Backs: stand-alone executables, `xunit.v3.templates`. [^xunit-v3]
- [Running tests in parallel](https://xunit.net/docs/running-tests-in-parallel) — xUnit.net, living. Rank 1. Backs: one test collection per class, collections in parallel, tests inside one collection one after another, threads default to the CPU count. [^xunit-parallel]
- [FixtureLifeCycle](https://docs.nunit.org/articles/nunit/writing-tests/attributes/fixturelifecycle.html) — NUnit, living. Rank 1. Backs: single instance by default, `InstancePerTestCase` from 3.13. [^nunit-lifecycle]
- [TestCase](https://docs.nunit.org/articles/nunit/writing-tests/attributes/testcase.html) — NUnit, living. Rank 1. Backs: one invocation per `[TestCase]`. [^nunit-testcase]
- [Parallelizable](https://docs.nunit.org/articles/nunit/writing-tests/attributes/parallelizable.html) — NUnit, living. Rank 1. Backs: tests are not parallel by default. [^nunit-parallel]

## Related
- `dotnet/tooling/analyzers-and-code-quality.md` — the other half of a CI gate.
- `dotnet/metaprogramming/reflection-and-attributes.md` — the attribute and `Invoke` machinery the sketch uses.
- `dotnet/metaprogramming/source-generators.md` — compile-time discovery, as TUnit does it.
- `dotnet/app-model/dependency-injection.md` — building services for integration tests.
- `testing/characterization-tests.md` — pinning current behaviour before a refactor.
