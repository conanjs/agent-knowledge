---
schema: topic-index/v1
kind: subtopic
topic: dotnet/tooling
last-updated: 2026-11-24
---

# Testing, analyzers and code quality

The tools around the code that keep it correct: test frameworks (xUnit.net, MSTest, NUnit, TUnit), the two test platforms (VSTest and Microsoft.Testing.Platform) and how `dotnet test` chooses between them, test lifetimes, data-driven tests, test doubles and coverage; and the SDK's built-in analyzers, compiler warning waves, rule severities in `.editorconfig`, warnings as errors, suppressions and `dotnet format`. The analyzer behaviour ran in the .NET 10 SDK lab (`dotnet/lab-setup.md`); the test frameworks ran there too, with pinned packages kept in the lab's own package folder (Step 11), and the .NET 11 runner switch in the .NET 11 container (Step 13). Not covered: benchmarking (see `dotnet/performance/measuring-and-reducing-allocations.md`), writing analyzers, third-party analyzer and mocking packages, and IDE-specific features.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [testing.md](testing.md) | concept | Framework versus platform, VSTest and MTP modes of `dotnet test`, the SDK templates, test-class lifetimes and fixtures, data-driven tests, fakes, coverage and filters; run in the lab with xUnit.net v2 and v3, MSTest 4.5.3, NUnit 5.0.0 and TUnit 1.87.12, plus a runner sketch; `DOTNET_TEST_RUNNER` in the .NET 11 container | verified |
| [analyzers-and-code-quality.md](analyzers-and-code-quality.md) | concept | CS, CA and IDE diagnostics; `AnalysisLevel`, `AnalysisMode` and `WarningLevel`; `.editorconfig` severities; `TreatWarningsAsErrors` versus `-warnaserror`; suppressions; trim/AOT analyzers; `dotnet format` | verified |

## References
- [Testing in .NET](https://learn.microsoft.com/en-us/dotnet/core/testing/) — Microsoft, living. Backs: subtopic scope (testing).
- [Overview of .NET source code analysis](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview) — Microsoft, living. Backs: subtopic scope (analyzers).

## Related
- `dotnet/metaprogramming/` — reflection, source generators and interop, which the analyzers and test runners build on.
- `dotnet/platform/` — projects, MSBuild properties and `global.json`, where these settings live.
- `testing/` — language-neutral testing techniques.
