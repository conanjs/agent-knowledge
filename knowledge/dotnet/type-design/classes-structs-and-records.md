---
schema: knowledge-doc/v1
type: concept
topic: dotnet/type-design
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", ".NET 11.0.0 / C# 15 (container lab)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, class, struct, record, record-struct, readonly-struct, value-semantics, value-equality, with-expression, valuetype-equals, gethashcode]
ranked-sources: true
---

# Classes, structs and records

## Summary
**TL;DR:** A class variable holds a reference to one shared object; a struct variable holds the whole value, so assignment, arguments and return values copy it, and a change made to a copy never reaches the original. `record` is a modifier on either kind: the compiler writes value equality (`Equals`, `GetHashCode`, `==`), a readable `ToString`, `with` copies and, for positional records, properties and `Deconstruct`. A plain struct gets its equality from `ValueType.Equals`, which boxes both values and may fall back to reflection, so a struct used as a key should be a `record struct` or implement `IEquatable<T>`.
**Use this when:** choosing between `class`, `struct`, `record class`, `record struct` and `readonly struct` for a new type; a change to a struct "does not stick"; two objects with equal fields are (or are not) equal; a struct key makes a dictionary slow.
**Not this doc:** value versus reference types, default values and conversions in general → `dotnet/fundamentals/types-values-and-conversions.md`; properties, constructors and initializers → `dotnet/type-design/members-and-initialization.md`; overriding `Equals` in class hierarchies → `dotnet/type-design/inheritance-and-interfaces.md`; boxing and object headers → `dotnet/runtime/object-layout-and-boxing.md`; `ref struct`, `in` parameters and defensive copies in depth → `dotnet/performance/ref-safety-and-ref-structs.md`.

## Problem
Code that treats every type like a class misbehaves in ways that look random:
- `list[0].X = 5` does not compile, while `var p = list[0]; p.X = 5;` compiles and leaves the list unchanged.
- Calling a method that increments a counter on a `readonly` struct field leaves the counter at 0.
- Two class instances with the same field values are not equal; two records with the same values are.
- A `with` copy of a record shares its `List<T>` with the original.
- A struct with a `string` field used as a `Dictionary` key makes lookups more than 100 times slower than a `record struct` and allocates on every lookup (Worked example).

Each follows from a documented rule about value semantics or about the members the compiler generates.

## Mental model
**Analogy:** a class instance is a house, and a class variable is a slip of paper with its address: copying the slip gives a second way to reach the same house. A struct is a filled-in paper form: copying it means photocopying it, and writing on the photocopy leaves the original unchanged. The `record` modifier adds a clerk who compares two forms (or two houses) field by field, prints them as `Name { Field = value }`, and produces "a copy with these fields changed" in one step.

**Artifact** (run in the lab ✅[^lab]):
```csharp
var a = new PointClass { X = 1 }; var b = a; b.X = 2;
Console.WriteLine(a.X);                        // 2: one object, two references
var s = new PointStruct { X = 1 }; var t = s; t.X = 2;
Console.WriteLine(s.X);                        // 1: t is a copy
var m1 = new Money(10m, "EUR"); var m2 = new Money(10m, "EUR");
Console.WriteLine(m1 == m2);                   // True: the compiler wrote value equality
Console.WriteLine(m1 with { Amount = 12m });   // Money { Amount = 12, Currency = EUR }

class PointClass { public int X; }
struct PointStruct { public int X; }
record Money(decimal Amount, string Currency);
```

## How it works
1. **Value versus reference semantics.** A struct is a value type: its variable contains the instance, and the instance is copied on assignment, when passed as an argument and when returned ✅[^ref-struct]. A class variable contains a reference, so only the reference is copied ✅[^ref-struct]. A struct that holds a reference-type field copies only that reference, so both copies reach the same object ✅[^ref-valuetypes]. In the lab, writing `w2.Items[0] = 100` through a copied struct also changed `w1.Items[0]` ✅[^lab].
2. **Where hidden copies come from.** These rules produce copies the code never asked for (all measured in the lab ✅[^lab]):
   - A `List<T>` indexer returns a copy of the element, so `list[0].X = 5` fails with compiler error CS1612 ("Cannot modify the return value of 'List<P>.this[int]' because it is not a variable"), and `var tmp = list[0]; tmp.X = 5;` changes only `tmp` until `list[0] = tmp` writes it back. An array element is a variable, so `arr[0].X = 7` changes the array.
   - The fields of a struct `foreach` iteration variable cannot be modified (CS1654, "Cannot modify members of '…' because it is a 'foreach iteration variable'").
   - Two `Increment()` calls on a `readonly Counter` field left `Value` at 0; on a non-readonly field it became 2; through an auto-property getter it stayed 0.

   The `readonly` case is a language rule: reading a `readonly` field outside a constructor gives a value, not a variable ✅[^spec-member-access], and calling a member that is not `readonly` on such a value (or on an `in` parameter) runs it on a temporary copy ✅[^spec-invoke].
3. **`readonly struct` and `readonly` members.** A `readonly struct` requires every field to be `readonly` and every property to be read-only or `init`-only; its other instance members are implicitly `readonly` ✅[^ref-struct]. The compiler enforces it: a writable field in a `readonly struct` is error CS8340 ✅[^lab]. A reference-type field of a `readonly struct` can still change the object it points to ✅[^ref-struct].
4. **Constructing a struct.** `default(T)` and `new T[n]` ignore any parameterless constructor and produce the all-zero value ✅[^ref-struct]. Since C# 10 a struct can declare a parameterless constructor (it must be `public`) and field initializers ✅[^history], but a struct with field initializers and no explicit constructor is an error ✅[^ref-struct], reported as CS8983 in the lab ✅[^lab]. Since C# 11 ("auto-default structs"), fields that a constructor leaves unassigned are set to their default value instead of being a compile error ✅[^ref-struct] ✅[^history]. In the lab, a struct with `Celsius = 20` and a constructor setting `Unit = "C"` printed `20C` for `new Temp()`, `Activator.CreateInstance<Temp>()` and a generic `new T()`, but `0<null>` for `default(Temp)` and for an element of `new Temp[2]` ✅[^lab].
5. **What `record` generates.** `record` (or `record class`) declares a reference type and `record struct` a value type ✅[^ref-record]. For a positional record the compiler creates a public auto-property per parameter (`init`-only in a `record class` and a `readonly record struct`, read-write in a `record struct`), a primary constructor, and a `Deconstruct` method ✅[^ref-record]. For equality it synthesizes an `Equals(object)` override, a typed `Equals(R?)` implementing `IEquatable<R>`, a `GetHashCode` override and the `==`/`!=` operators ✅[^ref-record]. Reflection over `record Money(decimal Amount, string Currency)` in the lab listed `<Clone>$`, `Deconstruct`, `Equals`, `get_EqualityContract`, `GetHashCode`, `op_Equality`, `op_Inequality`, `PrintMembers`, `ToString` and the property accessors ✅[^lab].
6. **Equality follows the runtime type.** A record class also gets an `EqualityContract` property that returns its run-time `Type`, so two records are equal only when their run-time types match, whatever the declared variable type ✅[^ref-record]. In the lab, two `Person` variables holding a `Student("Ann", 1)` and a `Teacher("Ann", 1)` compared `False`, two `Student("Ann", 1)` values compared `True`, and `EqualityContract` returned `Student` and `Teacher` ✅[^lab]. A plain struct has no `==` at all unless it declares one ✅[^guide-equality], so `p1 == p2` is CS0019 in the lab ✅[^lab].
7. **`with` is a shallow copy.** For a record class the compiler calls a generated clone method (backed by a copy constructor) and then sets the listed properties; the copy keeps the operand's run-time type ✅[^ref-record]. Reference-type properties are copied as references ✅[^ref-record], so in the lab `t2.Members.Add("y")` on a `with` copy also changed `t1.Members` ✅[^lab]. A property computed in an initializer is copied, not recomputed: `new Segment(3, 4) with { Y = 0 }` kept `CachedLength = 5` while the computed-on-read `Length` was 3 ✅[^lab]; the reference warns about exactly this ✅[^ref-record].
8. **`ToString` and display.** The generated `ToString` prints `TypeName { Prop = value, ... }` for public properties and fields, calling each value's own `ToString` ✅[^ref-record], so an array property prints as `System.String[]`. A plain class falls back to its type name: `MoneyClass` in the lab ✅[^lab].
9. **How a plain struct compares itself.** `ValueType.Equals` returns true when both values have the same type and all fields are equal ✅[^api-valuetype-equals]. In the .NET 10 source it first checks the type, then compares raw bytes when the struct has no references, no padding and no floating-point fields, and otherwise reads each field through reflection (`FieldInfo.GetValue`) ✅[^src-valuetype]. Its `GetHashCode` hashes the bytes in the fast case; otherwise the managed source's comment says it hashes the first instance field ✅[^src-valuetype], and the native helper it calls skips instance fields that hold a `null` reference and hashes the first field that is not one ✅[^src-hashstrategy]. In the lab, for `struct S { string? A; string? B; }`, `S("x", "1")` and `S("x", "2")` had equal hash codes, `S(null, "1")` and `S(null, "2")` did not, and `S(null, "x")` hashed like `S("x", "zzz")` ✅[^lab]. The API (application programming interface) docs advise overriding `Equals` "particularly if your value type contains fields that are reference types" ✅[^api-valuetype-equals], and warn that the default hash code may not suit a hash table ✅[^api-valuetype-hash]. A record struct's synthesized equality uses the declared members instead of reflection ✅[^ref-record].

## Worked example
A lookup table keyed by `(string Region, int Id)`, with 3,000 keys spread over 3 region names, written four ways and then probed with 3,000 lookups that each build a new key with equal values. Measured in the lab on an Apple M2, Release build, after a warm-up ✅[^lab].

| Key type | New equal key found? | Distinct hash codes among 3,000 keys | 3,000 lookups | Allocated during lookups |
|---|---|---|---|---|
| `class KeyClass` (no overrides) | No | 3,000 | about 0.2 ms | 93 KB (kilobytes; the new key objects) |
| `struct KeyStruct` (default members) | Yes | **3** | about 75–85 ms | about 223,000 KB |
| `record struct KeyRecStruct` | Yes | 3,000 | about 0.5 ms | 0 KB |
| `record KeyRecClass` | Yes | 3,000 | about 0.3–0.4 ms | 93 KB (the new key objects) |

Reading the rows:
1. **Class:** reference equality, so a new instance with the same values is a different key (How it works 6).
2. **Plain struct:** the struct holds a `string`, so `ValueType.GetHashCode` hashed only the first field, `Region` (How it works 9): 3,000 keys fell into 3 hash codes, each lookup compared its key against up to 1,000 entries sharing its hash code, and each comparison boxed both values and read the fields through reflection. In a separate measurement of 1,000,000 direct `Equals` calls, this path cost about 152 bytes per call against 0 for a record struct, while a struct of two `int` fields took the byte-comparison path and still allocated 48 bytes per call (the two boxes) ✅[^lab].
3. **Record struct and record class:** generated `GetHashCode` combines both members, so every key has its own hash code; the only allocations are the new `record class` key objects themselves.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `record Team(string Name, List<string> Members)` compared with another `Team` holding an equal but different list | `False` ✅[^lab] | Generated equality compares each member with its own `Equals`; `List<T>` uses reference equality ✅[^ref-record] |
| `new D(0.0).Equals(new D(-0.0))` on `struct D { double V; }` | `True` ✅[^lab] | Floating-point fields rule out the byte comparison, so each field's `double.Equals` decides ✅[^src-valuetype] |
| A record inheriting from a class, or a class from a record | CS8864 "Records may only inherit from object or another record" for the first, CS8865 "Only records may inherit from records" for the second ✅[^lab] | A record can inherit only from a record ✅[^ref-record] |
| Assigning a positional property of a `record class` after creation | CS8852 (init-only) ✅[^lab] | Positional properties are `init`-only in a `record class` ✅[^ref-record] |
| `ValueType.Equals` on an `[InlineArray]` struct | Throws `NotSupportedException` on .NET 9 and later ✅[^api-valuetype-equals] | The default equality does not support inline arrays |
| `closed record class` (C# 15, .NET 11) | Only the declaring assembly can derive from it, so a `switch` over its direct descendants needs no default arm ✅[^cs15]. In the container lab, a `switch` expression over a `GateState` with only the arms `Closed` and `Open(var percent)` compiled with no warning and printed `closed` and `40% open`; dropping the `Open` arm gave warning CS8509 naming `Open`, where an `abstract` base gave CS8509 naming `_`; `record class Ajar : GateState` in another assembly was error CS9382 "cannot use a closed type 'GateState' from another assembly as a base type", while deriving there from the non-closed `Closed` compiled ✅[^lab11] | New `closed` modifier; a closed class is implicitly abstract and derivation is not transitive ✅[^cs15] (`new GateState()` was CS0144, `IsAbstract` was `True` ✅[^lab11]); it does not apply to `record struct` ✅[^ref-record] (CS0106 ✅[^lab11]) |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `class` | Identity, inheritance, cheap to pass around (one reference) | Heap allocation per instance; reference equality unless you override it |
| `struct` | No separate heap object; arrays store the values inline; the design guidelines suggest it for small, short-lived values ✅[^dg-class-struct] | Every assignment copies; mutable structs surprise callers; default equality boxes and may use reflection |
| `readonly struct` / `readonly record struct` | Immutable by construction; the compiler needs no defensive copies for `in` and `readonly` access ✅[^guide-structs] | Changing a value means building a new one |
| `record class` | Value equality, `ToString`, `with`, inheritance between records | Still a heap object; `with` and equality are shallow; not suitable when identity matters ✅[^ref-record] |
| `record struct` | Value equality without reflection, `with`, `==` generated | Mutable positional properties by default; copied on every assignment |

The guidelines' rule of thumb: avoid a struct unless the type logically represents a single value, its instance is under 16 bytes, it is immutable, and it will not be boxed often ✅[^dg-class-struct].

## Takeaways
- Make structs immutable (`readonly struct` or `readonly record struct`); a mutable struct invites changes to copies. [rule-candidate]
- Never use a plain struct with reference-type fields as a dictionary or set key; use a `record struct` or implement `IEquatable<T>` with `GetHashCode`. [rule-candidate]
- Treat `with` and record equality as shallow: prefer immutable members (strings, other records) so a shared reference is harmless, and write your own `Equals`/`GetHashCode` when a collection member must compare by content.
- Compute derived record properties on read (`=>`), not in an initializer, or `with` copies a stale value. [rule-candidate]
- Pick `class` when identity or inheritance matters, `record class` for data compared by value, `record struct` for small values compared by value.

## Verification status
- Verified: 62 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [Structure types (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct) — Microsoft, living. Rank 1. Backs: value semantics and copying; `readonly struct` rules; `default` and arrays ignore the parameterless constructor; field initializers need a constructor; auto-default fields. [^ref-struct]
- [Value types (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-types) — Microsoft, living. Rank 1. Backs: copying a struct copies only the references it holds. [^ref-valuetypes]
- [Records (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) — Microsoft, living. Rank 1. Backs: record class versus record struct; positional properties and `Deconstruct`; synthesized equality members; `EqualityContract`; `with` and its shallow copy; computed-property warning; `ToString` format; inheritance only between records; struct equality relies on `ValueType.Equals`. [^ref-record]
- [Equality in C#](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/expressions/equality) — Microsoft, living. Rank 1. Backs: plain structs get no predefined `==`. [^guide-equality]
- [Structs (C# fundamentals)](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/structs) — Microsoft, living. Rank 1. Backs: `readonly` members let the compiler skip defensive copies. [^guide-structs]
- [C# language specification: Member access](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions#1287-member-access) — ECMA / Microsoft, living. Rank 1. Backs: a `readonly` field read outside a constructor is a value. [^spec-member-access]
- [C# language specification: Function member invocation](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions#12661-general) — ECMA / Microsoft, living. Rank 1. Backs: a non-readonly member called on a value, `readonly` field or `in` parameter runs on a temporary copy. [^spec-invoke]
- [ValueType.Equals(Object)](https://learn.microsoft.com/en-us/dotnet/api/system.valuetype.equals) — Microsoft, living. Rank 1. Backs: default value equality; override advice for reference-type fields; `NotSupportedException` for inline arrays. [^api-valuetype-equals]
- [ValueType.GetHashCode()](https://learn.microsoft.com/en-us/dotnet/api/system.valuetype.gethashcode) — Microsoft, living. Rank 1. Backs: the default hash code may not suit a hash table. [^api-valuetype-hash]
- [Choosing between class and struct](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/choosing-between-class-and-struct) — Microsoft (Framework Design Guidelines), living. Rank 1. Backs: when to consider a struct; the four conditions. [^dg-class-struct]
- [C# version history](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) — Microsoft, living. Rank 1. Backs: auto-default structs in C# 11. [^history]
- [What's new in C# 15](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) — Microsoft, living. Rank 1. Backs: `closed` classes and exhaustive switches; closed classes are implicitly abstract; derivation is not transitive. [^cs15]
- [ValueType.cs (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/coreclr/System.Private.CoreLib/src/System/ValueType.cs) — .NET runtime team, 2025. Rank 1. Backs: byte comparison versus reflection in `Equals`; first-field hashing in `GetHashCode`. [^src-valuetype]
- [comutilnative.cpp (release/10.0), `GetHashCodeStrategy`](https://github.com/dotnet/runtime/blob/release/10.0/src/coreclr/vm/comutilnative.cpp) — .NET runtime team, 2025. Rank 1. Backs: the hash uses the first instance field that is not a `null` reference. [^src-hashstrategy]

## Related
- `dotnet/fundamentals/types-values-and-conversions.md` — value and reference types, defaults and conversions.
- `dotnet/type-design/members-and-initialization.md` — properties, `init`, `required`, constructors and primary constructors.
- `dotnet/type-design/inheritance-and-interfaces.md` — overriding `Equals`/`GetHashCode` and interfaces on structs.
- `dotnet/runtime/object-layout-and-boxing.md` — what a box costs and when it happens.
- `dotnet/collections-and-linq/collections.md` — `Dictionary` hashing and the key contract.
- `dotnet/performance/ref-safety-and-ref-structs.md` — `in`, defensive copies and `ref struct`.
