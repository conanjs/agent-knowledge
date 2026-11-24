---
schema: knowledge-doc/v1
type: reference
topic: dotnet/platform
status: verified
applies-to: ["C# 1.0 to C# 15", ".NET Core 1.0 to .NET 11", "release data as of 2026-11-24", "lab compiler Roslyn 5.9.0 (C# 14)", ".NET 11.0.0 / C# 15 (container lab, SDK 11.0.100, Roslyn 5.12.0)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, versions, langversion, lts, sts, end-of-support, release-history, catalog]
ranked-sources: true
---

# C# and .NET version catalog

## Summary
**TL;DR:** Five lookup tables: every C# version with its release date, the .NET version that uses it by default and its headline features; the C# 15 features as they ran in the .NET 11 container; every .NET (Core) release with its support type (LTS, long-term support, or STS, standard-term support), original release date, end of support and last patch; the support rules in force; and the `LangVersion` values with what the lab's C# 14 and C# 15 compilers do with them. C# and .NET now ship together every November: C# 12 ↔ .NET 8, 13 ↔ 9, 14 ↔ 10, 15 ↔ 11.
**Use this when:** you need the C# version a target framework gets by default, the year a feature arrived, whether a .NET version is still supported, what a `LangVersion` value means, or what a C# 15 feature looks like when it compiles.
**Not this doc:** why SDK (software development kit) and runtime versions differ and how roll-forward works → `dotnet/platform/runtime-and-versions.md`; where `LangVersion` is set → `dotnet/platform/projects-and-msbuild.md`.

## Scope
C# 1.0 (2002) to C# 15 (November 2026) from the C# language history page; .NET Core 1.0 (2016) to .NET 11 from the .NET release metadata (`releases-index.json` and each version's `releases.json`) and the support policy page, read on 2026-11-24 ✅[^history] ✅[^relindex] ✅[^policy]. .NET Framework appears only as a target with a default C# version. The lab compilers are Roslyn 5.9.0 in SDK 10.0.401, which reports `Language version: 14.0` ✅[^lab], and Roslyn 5.12.0 in SDK 11.0.100, the .NET 11 container, which reports `15.0` ✅[^lab11]; six of the seven C# 15 features were compiled and run there once.

## Catalog

### C# versions
| C# | Released | Default for (target framework) | Headline features |
|---|---|---|---|
| 1.0 | January 2002, with Visual Studio .NET 2002 ✅[^history] | — | classes, structs, interfaces, events, properties, delegates, attributes ✅[^history] |
| 1.2 | April 2003, with Visual Studio .NET 2003 ✅[^history] | — | `foreach` calls `Dispose` on an enumerator that is `IDisposable` ✅[^history] |
| 2.0 | November 2005, with Visual Studio 2005 ✅[^history] | — | generics, partial types, anonymous methods, nullable value types, iterators ✅[^history] |
| 3.0 | November 2007 ✅[^history] | — | LINQ (Language-Integrated Query) query expressions, lambdas, expression trees, extension methods, `var`, anonymous types, auto-properties, object and collection initializers ✅[^history] |
| 4.0 | April 2010, with Visual Studio 2010 ✅[^history] | — | `dynamic`, named and optional arguments, generic covariance and contravariance, embedded interop types ✅[^history] |
| 5.0 | August 2012, with Visual Studio 2012 ✅[^history] | — | `async`/`await`, caller info attributes ✅[^history] |
| 6.0 | July 2015, with Visual Studio 2015 ✅[^history] | — | string interpolation, `?.`, `nameof`, exception filters, expression-bodied members, auto-property initializers, `using static` ✅[^history] |
| 7.0 | March 2017, with Visual Studio 2017 ✅[^history] | — | tuples and deconstruction, pattern matching, `out` variables, local functions, `ref` locals and returns, discards, throw expressions ✅[^history] |
| 7.1 | August 2017 ✅[^history] | — | `async Main`, `default` literal, inferred tuple names ✅[^history] |
| 7.2 | November 2017 ✅[^history] | — | `in` parameters, `readonly struct`, `ref struct`, `ref readonly` returns, `private protected`, non-trailing named arguments ✅[^history] |
| 7.3 | May 2018 ✅[^history] | .NET Framework (all), .NET Core 2.x, .NET Standard 1.x and 2.0 ✅[^defaults] | `==` on tuples, more generic constraints, reassignable `ref` locals ✅[^history] |
| 8.0 | September 2019; the first release aimed at .NET Core ✅[^history] | .NET Core 3.x, .NET Standard 2.1 ✅[^defaults] | nullable reference types, switch expressions and property/tuple/positional patterns, async streams, indices and ranges, `??=`, default interface members, `using` declarations ✅[^history] |
| 9 | November 2020, with .NET 5 ✅[^history] | .NET 5 ✅[^defaults] | records, `init` setters, top-level statements, relational and logical patterns, `nint`/`nuint`, function pointers, target-typed `new` ✅[^history] |
| 10 | November 2021 ✅[^history] | .NET 6 ✅[^defaults] | record structs, `global using`, file-scoped namespaces, interpolated string handlers, extended property patterns, lambda natural types ✅[^history] |
| 11 | November 2022 ✅[^history] | .NET 7 ✅[^defaults] | raw string literals, generic math, list patterns, `required` members, UTF-8 literals, file-local types, `ref` fields ✅[^history] |
| 12 | November 2023, with the .NET 8 SDK ✅[^history] | .NET 8 ✅[^defaults] | primary constructors, collection expressions, inline arrays, `ref readonly` parameters, alias any type, optional lambda parameters ✅[^history] |
| 13 | November 2024 ✅[^history] | .NET 9 ✅[^defaults] | `params` collections, `System.Threading.Lock` in `lock`, `\e` escape, `ref`/`unsafe` in iterators and async, `allows ref struct`, partial properties ✅[^history] |
| 14 | November 2025 ✅[^history] | .NET 10 ✅[^defaults] | extension members, `field` keyword, null-conditional assignment, implicit span conversions, user-defined compound assignment, partial events and constructors ✅[^history] |
| 15 | November 2026 ✅[^history] | .NET 11 ✅[^defaults] ✅[^lab11] | union types, closed hierarchies, collection expression arguments `with(...)`, extension indexers, labeled `break`/`continue`, memory safety (preview) ✅[^csharp15]; all six ran in the container (next table) ✅[^lab11]. The seventh, non-virtual static interface members on runtimes without default interface implementations ✅[^csharp15], was not run |

### C# 15 features in the container lab
| Feature | What ran (SDK 11.0.100, runtime 11.0.0, default `LangVersion` 15.0 unless the row says otherwise) | Result |
|---|---|---|
| Collection expression arguments | `List<string> names = [with(capacity: values.Length * 2), .. values];` over 3 strings; `HashSet<string> set = [with(StringComparer.OrdinalIgnoreCase), "Hello", "HELLO", "hello"];` | `Capacity=6` (3 without `with`); `Count=1` ✅[^lab11] |
| Union types | `public union Pet(Cat, Dog, Bird);`, `Pet pet = new Dog("Rex");`, a switch expression with one arm per case type and no `_` | `Rex`, no warning; `Pet` is a value type; without the `Bird` arm: `warning CS8509 … the pattern 'Bird' is not covered.` and `SwitchExpressionException` for a `Bird` ✅[^lab11] |
| Closed hierarchies | `public closed record class GateState;` with `Closed` and `Open(float Percent)` deriving from it, a switch expression with no `_` | `closed`, `40% open`, no warning; `typeof(GateState).IsAbstract` is `True`; without the `Open` arm: `CS8509` ✅[^lab11] |
| Extension indexers | `extension(IEnumerable<int> sequence) { public int this[int index] => sequence.ElementAt(index); }` | `Enumerable.Range(1, 10)[2]` is `3` ✅[^lab11] |
| Labeled `break` and `continue` | `continue outer;` and `break grid;` inside nested `for` loops | `(0,0)(1,0)(2,0)` and `[0,0][0,1][0,2][1,0]`; `continue sw;` on a labeled `switch`: `error CS9394: No enclosing loop with the label 'sw' out of which to continue` ✅[^lab11] |
| Memory safety (preview) | `LangVersion=preview`, which only this C# 15 feature needs ✅[^csharp15], and `AllowUnsafeBlocks=true`: `int* pointer = &number;` and `fixed` outside any `unsafe` context; `static readonly int Signature = unsafe(ReadSignature());` | compiled and printed `0x1234`; the same pointer line at C# 15 is `CS0214`, `*pointer` outside `unsafe` is `CS9360`; with `Features=$(Features);updated-memory-safety-rules`, calling an `unsafe` method from safe code is `CS9362: … must be used in an unsafe context because it is marked as 'unsafe'` ✅[^lab11] |

### .NET (Core) releases
| Release | Type | Original release | End of support | Latest patch | Support length |
|---|---|---|---|---|---|
| .NET 11 | STS | 2026-11-10 ✅[^relindex] | 2028-11-14 ✅[^relindex] | 11.0.0 (2026-11-10) ✅[^relindex] | 24 months |
| .NET 10 | LTS | 2025-11-11 ✅[^relindex] | 2028-11-14 ✅[^relindex] | 10.0.15 (2026-11-10) ✅[^relindex] | 36 months |
| .NET 9 | STS | 2024-11-12 ✅[^policy] | 2026-11-10 ✅[^relindex] | 9.0.23 (2026-11-10) ✅[^relindex] | 24 months |
| .NET 8 | LTS | 2023-11-14 ✅[^relindex] | 2026-11-10 ✅[^relindex] | 8.0.34 (2026-11-10) ✅[^relindex] | 36 months |
| .NET 7 | STS | 2022-11-08 ✅[^relindex] | 2024-05-14 ✅[^relindex] | 7.0.20 (2024-05-28) ✅[^relindex] | 18 months |
| .NET 6 | LTS | 2021-11-08 ✅[^relindex] | 2024-11-12 ✅[^relindex] | 6.0.36 (2024-11-12) ✅[^relindex] | 36 months |
| .NET 5 | STS | 2020-11-10 ✅[^relindex] | 2022-05-10 ✅[^relindex] | 5.0.17 (2022-05-10) ✅[^relindex] | 18 months |
| .NET Core 3.1 | LTS | 2019-12-03 ✅[^relindex] | 2022-12-13 ✅[^relindex] | 3.1.32 (2022-12-13) ✅[^relindex] | 36 months |
| .NET Core 3.0 | STS | 2019-09-23 ✅[^relindex] | 2020-03-03 ✅[^relindex] | 3.0.3 (2020-02-18) ✅[^relindex] | 5 months |
| .NET Core 2.2 | STS | 2018-12-04 ✅[^relindex] | 2019-12-23 ✅[^relindex] | 2.2.8 (2019-11-19) ✅[^relindex] | 13 months |
| .NET Core 2.1 | LTS | 2018-05-30 ✅[^relindex] | 2021-08-21 ✅[^relindex] | 2.1.30 (2021-08-19) ✅[^relindex] | 39 months |
| .NET Core 2.0 | STS | 2017-08-14 ✅[^relindex] | 2018-10-01 ✅[^relindex] | 2.0.9 (2018-07-10) ✅[^relindex] | 14 months |
| .NET Core 1.1 | LTS | 2016-11-16 ✅[^relindex] | 2019-06-27 ✅[^relindex] | 1.1.13 (2019-05-14) ✅[^relindex] | 31 months |
| .NET Core 1.0 | LTS | 2016-06-27 ✅[^relindex] | 2019-06-27 ✅[^relindex] | 1.0.16 (2019-05-14) ✅[^relindex] | 36 months |

### Support rules in force
| Rule | Value |
|---|---|
| Release cadence | one major release every November ✅[^policy] |
| LTS | even-numbered releases, 3 years of free support and patches ✅[^policy] |
| STS | odd-numbered releases, 2 years, starting with .NET 9 ✅[^versions]; called "Current" before ✅[^policy] |
| Maintenance phase | the final 6 months of any release: security fixes only ✅[^policy] |
| Patch day | Patch Tuesday, the second Tuesday of the month ✅[^policy] |
| End-of-support day | aligned to a Patch Tuesday since .NET Core 3.1 (for example .NET 6: released 2021-11-08, ended 2024-11-12) ✅[^policy] |
| Supported means | the latest patch of a supported release is installed ✅[^policy] |

### `LangVersion` values
| Value | Meaning | In the lab (Roslyn 5.9.0, SDK 10.0.401) | In the container lab (Roslyn 5.12.0, SDK 11.0.100) |
|---|---|---|---|
| (not set) | the default for the target framework (table above) ✅[^defaults] | `net10.0` → `14.0` (`dotnet msbuild -getProperty:LangVersion`) ✅[^lab] | `net11.0` → `15.0` (`dotnet build file.cs -getProperty:LangVersion`) ✅[^lab11] |
| `preview` | newest preview syntax the compiler knows ✅[^langver] | `#error version` → `Language version: preview` ✅[^lab] | `Language version: preview` ✅[^lab11] |
| `latest` | newest released version of the installed compiler, minor versions included ✅[^langver] | `Language version: latest (14.0)` ✅[^lab] | `latest (15.0)` ✅[^lab11] |
| `latestMajor` or `default` | newest released major version; ignores the target framework ✅[^langver] | `latestmajor (14.0)`, `default (14.0)` ✅[^lab] | `latestmajor (15.0)`, `default (15.0)` ✅[^lab11] |
| `14.0` … `1`, `ISO-2`, `ISO-1` | only syntax of that version or lower ✅[^langver] | `13` plus `public int P { get; set => field = value; }` (one automatic accessor) → `error CS9260: Feature 'field keyword' is not available in C# 13.0. Please use language version 14.0 or greater.` ✅[^lab]; with both accessors written out, `{ get => field; set => field = value; }`, C# 13 reads `field` as an ordinary name: `error CS0103: The name 'field' does not exist in the current context` ✅[^lab] | `14` plus a labeled `continue` → `error CS9327: Feature 'labeled break and continue' is not available in C# 14.0. Please use language version 15.0 or greater.` ✅[^lab11] |
| `15.0` | C# 15 ✅[^langver] | `error CS1617: Invalid option '15' for /langversion` (this compiler predates C# 15) ✅[^lab] | `15` and `15.0` → `Language version: 15.0` ✅[^lab11] |

## Lookup notes
- Using a C# version newer than the one tied to the target framework is unsupported; the docs warn against `latest` because its meaning changes with the installed compiler ✅[^langver].
- Setting `LangVersion` to `default` is not the same as leaving it out: `default` ignores the target framework ✅[^defaults].
- `#error version` is the quickest check: the build fails with `CS8304` and prints the compiler and language versions ✅[^langver].
- A C# 15 feature fails differently on each compiler: SDK 10.0.401 knows `with(...)` only as a preview feature (`error CS8652: The feature 'collection expression arguments' is currently in Preview and *unsupported*.`) ✅[^lab], while SDK 11.0.100 at `LangVersion=14` reports `error CS9327: Feature 'collection expression arguments' is not available in C# 14.0. Please use language version 15.0 or greater.` ✅[^lab11].
- The two official .NET sources disagree on .NET 9's original release: `9.0/releases.json` dates `9.0.0` to `2024-12-03` ✅[^rel9], the support policy page says November 12, 2024 ✅[^policy]. The table uses the policy page.
- "Support length" is computed from the two date columns (days ÷ 30.44, rounded to whole months); for example .NET 7 ran 2022-11-08 to 2024-05-14, 553 days ≈ 18 months. Releases before .NET 5 do not follow today's 24/36-month rule.
- Support state changes on Patch Tuesdays: re-read `releases-index.json` (the `support-phase` field) rather than trusting a copy of this table after 2026-11-24 ✅[^relindex].

## Takeaways
- Leave `LangVersion` unset and change the target framework to get a newer C#; do not set `latest`. [rule-candidate]
- On 2026-11-24 only .NET 10 (LTS) and .NET 11 (STS) are supported, both until 2028-11-14; anything on .NET 8 or 9 is out of support. [rule-candidate]
- To date a feature, look it up in the C# table, then read the default-target column to know the minimum .NET version.

## Verification status
- Verified: 139 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [The history of C#](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) — Microsoft, living. Rank 1. Backs: release month and companion product of each C# version; headline features. [^history]
- [What's new in C# 15](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) — Microsoft, 2026. Rank 1. Backs: C# 15 features. [^csharp15]
- [C# language versioning](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-versioning) — Microsoft, living. Rank 1. Backs: default C# version per target framework; `default` versus unset. [^defaults]
- [Configure C# language version](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version) — Microsoft, living. Rank 1. Backs: `LangVersion` values; do not use `latest`; newer than the TFM is unsupported; `#error version` and CS8304. [^langver]
- [How .NET is versioned](https://learn.microsoft.com/en-us/dotnet/core/versions/) — Microsoft, living. Rank 1. Backs: STS two years starting with .NET 9. [^versions]
- [.NET and .NET Core Support Policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) — Microsoft, 2026. Rank 1. Backs: cadence, LTS and STS, maintenance phase, Patch Tuesday, end-of-support alignment, "Current" as the old STS name, latest patch required; .NET 9 original release date. [^policy]
- [.NET releases index](https://github.com/dotnet/core/blob/main/release-notes/releases-index.json) — .NET team, living. Rank 1. Backs: release type, end of support, latest patch and its date per release; original release dates from each version's `releases.json`. [^relindex]
- [.NET 9 releases.json](https://github.com/dotnet/core/blob/main/release-notes/9.0/releases.json) — .NET team, living. Rank 1. Backs: `9.0.0` dated 2024-12-03. [^rel9]

## Related
- `dotnet/platform/runtime-and-versions.md` — SDK versus runtime, roll-forward and `global.json`.
- `dotnet/platform/projects-and-msbuild.md` — setting `LangVersion` per project or per folder.
- `dotnet/lab-setup.md` — how the lab reads its own SDK, runtime and C# version.
