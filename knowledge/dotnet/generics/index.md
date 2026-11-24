---
schema: topic-index/v1
kind: subtopic
topic: dotnet/generics
last-updated: 2026-11-24
---

# C# generics

Generic types and methods in C# and .NET: what the compiler checks (type inference, the constraint list from `class` to `allows ref struct` and `default`), how the runtime instantiates closed types (one static-field set per closed type, one shared JIT (just-in-time compiler) body for reference types logged as `__Canon`, one body per value type), covariance and contravariance on interfaces, delegates and arrays, and generic math with static abstract interface members and `INumber<T>`. Every behaviour was run on the .NET 10 SDK (software development kit) lab (`dotnet/lab-setup.md`). Not covered here: generic collections themselves (`dotnet/collections-and-linq/`), reflection over generic types (`dotnet/metaprogramming/`), and `ref struct` safety rules beyond `allows ref struct` (`dotnet/performance/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [generics-and-constraints.md](generics-and-constraints.md) | concept | Type parameters, inference and every constraint; reified generics, static fields per closed type, and the JIT's shared `__Canon` body versus per-value-type bodies | verified |
| [variance.md](variance.md) | concept | `out` and `in` on interfaces and delegates, variance safety errors, why value types and classes stay invariant, array covariance and `ArrayTypeMismatchException`, delegate combination after a variant conversion | verified |
| [generic-math.md](generic-math.md) | concept | Static abstract and virtual interface members, the `TSelf` pattern, `INumber<T>` and the operator interfaces, `checked` operators, `CreateChecked`/`CreateSaturating`/`CreateTruncating`, and per-type machine code | verified |

## References
- [Generics in .NET](https://learn.microsoft.com/en-us/dotnet/standard/generics/) — Microsoft, living. Backs: subtopic scope.
- [Shared Generics Design](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/botr/shared-generics.md) — .NET runtime team, 2019. Backs: how the runtime shares generic code.

## Related
- `dotnet/delegates-and-events/` — generic delegates (`Func`, `Action`) and their variance in use.
- `dotnet/collections-and-linq/` — the generic collections built on these rules.
- `dotnet/type-design/` — interfaces, operators and nullable annotations that generic code relies on.
