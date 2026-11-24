---
schema: topic-index/v1
kind: subtopic
topic: dotnet/fundamentals
last-updated: 2026-11-24
---

# C# fundamentals

The core of the C# language as it runs on .NET 10 (C# 14): value and reference types, built-in numeric types, defaults, `var`, `const` and `readonly`, overflow and `checked`, integer division, numeric conversions, `Parse`/`TryParse`/`Convert`; strings as immutable UTF-16, runes and grapheme clusters, interpolation and literal forms, interning, `StringBuilder`, ordinal versus culture-aware comparison and invariant globalization; `if`, `switch` statements and expressions, every pattern kind, exhaustiveness and loops; parameters by value, `ref`, `out`, `in`, `ref readonly`, `params` collections, optional and named arguments, overload resolution, local functions, tuples, deconstruction and recursion. Every behaviour ran in `dotnet/lab-setup.md`. Not covered: designing classes, structs and records (see `dotnet/type-design/`), generics (see `dotnet/generics/`), lambdas and delegates (see `dotnet/delegates-and-events/`), the platform underneath (see `dotnet/platform/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [types-values-and-conversions.md](types-values-and-conversions.md) | concept | Value versus reference types; built-in types and their .NET names; defaults and definite assignment; `var`, `const`, `readonly`; unchecked overflow and `checked`; `/` and `%` signs; `float`/`double`/`decimal`; implicit and explicit conversions, saturating float-to-int; `Parse`, `TryParse`, `Convert`; `Half`, `Int128`, `nint` | verified |
| [strings-and-text.md](strings-and-text.md) | concept | Immutable UTF-16 strings; `char` versus `Rune` versus grapheme; `==` and `Equals` ordinal versus culture-sensitive defaults; Turkish i, ICU zero-weight characters, invariant globalization; interpolation, raw, verbatim and `u8` literals; interning; `StringBuilder` | verified |
| [control-flow-and-pattern-matching.md](control-flow-and-pattern-matching.md) | concept | Patterns in `is`, `switch` statements and switch expressions; type, constant, relational, logical, property, positional, list, `var` and discard patterns; `CS8509`/`CS8524`/`CS8510` and `SwitchExpressionException`; no fall-through, `goto case`; `break`/`continue`; pattern-based `foreach` | verified |
| [methods-and-parameters.md](methods-and-parameters.md) | concept | By value versus `ref`/`out`/`in`/`ref readonly`; `params` arrays and C# 13 collections; optional defaults compiled into callers; overload resolution rules; local functions; expression bodies; tuples, deconstruction, discards; no tail-call guarantee and stack overflow | verified |

## References
- [A tour of the C# language](https://learn.microsoft.com/en-us/dotnet/csharp/tour-of-csharp/) — Microsoft, living. Backs: subtopic scope.
- [C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/) — Microsoft, living. Backs: the language rules the docs cite.

## Related
- `dotnet/platform/` — the compiler, runtime and project system these docs run on.
- `dotnet/type-design/` — classes, structs, records and nullable reference types.
- `dotnet/lab-setup.md` — how to rerun every probe.
