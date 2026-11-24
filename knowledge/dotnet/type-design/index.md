---
schema: topic-index/v1
kind: subtopic
topic: dotnet/type-design
last-updated: 2026-11-24
---

# C# type design

How C# types are declared and what the compiler and runtime do with them: classes versus structs versus records (copy semantics, generated value equality, `with`, `ValueType.Equals`); members and initialization (fields, properties and the C# 14 `field` keyword, `init` and `required`, primary constructors, constructor and static-initialization order, object and collection initializers, indexers, `const` versus `static readonly`, access modifiers including `file` and `private protected`); inheritance and interfaces (`virtual`/`override`/`new`, `sealed`, `abstract`, virtual calls from constructors, explicit and default interface members, static abstract members, the `Equals`/`GetHashCode` contract); extension members and operators (extension methods and C# 14 `extension` blocks, operator overloading, C# 14 compound assignment operators, conversions, `true`/`false`, `Index` and `Range`); and nullable value types versus nullable reference types (flow analysis, attributes, `?.`, `??`, C# 14 null-conditional assignment). Every behaviour ran on .NET 10 with C# 14 (`dotnet/lab-setup.md`). Not covered: value-type basics and numeric conversions (`dotnet/fundamentals/`), generics and variance (`dotnet/generics/`), delegates and events (`dotnet/delegates-and-events/`), object layout and boxing in the runtime (`dotnet/runtime/`), `ref struct` and span safety (`dotnet/performance/`), and source-generated partial members (`dotnet/metaprogramming/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [classes-structs-and-records.md](classes-structs-and-records.md) | concept | Reference versus value semantics and hidden struct copies; `readonly struct`; struct constructors and `default`; what `record` generates (`Equals`, `==`, `EqualityContract`, `with`, `ToString`, `Deconstruct`); why a plain struct key is slow (`ValueType.Equals`/`GetHashCode`) | verified |
| [members-and-initialization.md](members-and-initialization.md) | concept | Auto-properties and the C# 14 `field` keyword; `init` and `required`; primary constructor capture; instance and static construction order and `beforefieldinit`; object, collection and indexer initializers; `const` baked into callers; access modifiers, `file`, `private protected` | verified |
| [inheritance-and-interfaces.md](inheritance-and-interfaces.md) | concept | `virtual`/`override` versus `new` hiding; `sealed`, `abstract`, `base`, covariant returns; virtual calls from constructors; explicit and default interface members; static abstract members; the `Equals`/`GetHashCode` contract; vtable and interface dispatch | verified |
| [extension-members-and-operators.md](extension-members-and-operators.md) | concept | Extension methods and C# 14 extension blocks (properties, static members, operators); instance members win; operator overloading rules; C# 14 instance `+=` and `++`; implicit and explicit conversions; `true`/`false`; `Index`, `Range` and countable types | verified |
| [nullable-reference-types.md](nullable-reference-types.md) | concept | `Nullable<T>` (lifting, boxing) versus compile-time nullable reference annotations; the nullable context; flow analysis and its warnings; `!`; nullable attributes and `ThrowIfNull`; `?.`, `??`, `??=` and C# 14 null-conditional assignment; documented gaps | verified |

## References
- [The C# type system](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/) — Microsoft, living. Backs: subtopic scope (classes, structs, records, interfaces).
- [Classes, structs, and records (C# fundamentals)](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/object-oriented/) — Microsoft, living. Backs: subtopic scope (classes, structs, records, objects).
- [What's new in C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) — Microsoft, living. Backs: the C# 14 features covered (`field`, extension members, compound assignment operators, null-conditional assignment).
- `dotnet/lab-setup.md` — the lab every behaviour in this subtopic ran in.

## Related
- `dotnet/fundamentals/` — value and reference types, conversions, methods and parameters.
- `dotnet/generics/` — constraints, variance and generic math on static abstract members.
- `dotnet/runtime/object-layout-and-boxing.md` — method tables, dispatch and boxing.
- `dotnet/performance/ref-safety-and-ref-structs.md` — `in`, `ref readonly` and defensive copies.
