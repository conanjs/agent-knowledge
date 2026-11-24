---
schema: knowledge-doc/v1
type: concept
topic: dotnet/type-design
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, nullable, nullable-reference-types, nrt, nullable-value-types, flow-analysis, null-forgiving, notnullwhen, membernotnull, null-conditional, null-coalescing, null-conditional-assignment, throwifnull, cs8602, cs8618]
ranked-sources: true
---

# Nullable value types and nullable reference types

## Summary
**TL;DR:** `int?` and `string?` look alike but are different mechanisms. `int?` is `Nullable<int>`, a real run-time struct with `HasValue` and `Value`; operators on it are "lifted" (any `null` operand gives `null`), and boxing a null one gives a null reference. `string?` is a nullable reference type (NRT) annotation: the same `System.String` at run time, read only by the compiler, which tracks each reference as *not-null* or *maybe-null* and warns (CS8600–CS8625 and related codes) but never inserts a check. Attributes such as `[NotNullWhen]` and `[MemberNotNull]` tell the analysis what a method guarantees, `!` silences it, and `?.`, `??`, `??=` and C# 14's `a?.b = c` handle the null cases at run time.
**Use this when:** a `NullReferenceException` happened in code without warnings; deciding between `int?`, a sentinel value or `string?`; a nullable warning looks wrong; writing a `TryGet`-style method or an initialization helper; turning on `<Nullable>enable</Nullable>` in an older project.
**Not this doc:** `required` members as the fix for CS8618 → `dotnet/type-design/members-and-initialization.md`; nullable warnings as errors, `WarningsAsErrors` and analyzers → `dotnet/tooling/analyzers-and-code-quality.md`; `System.Text.Json` and nullable annotations → `dotnet/app-model/system-text-json.md`; `T?` with generic constraints in depth → `dotnet/generics/generics-and-constraints.md`; boxing costs → `dotnet/runtime/object-layout-and-boxing.md`.

## Problem
- A method declared to return `string` hands back `null` and the caller crashes, with no warning anywhere: the callee was compiled with the nullable context off.
- `typeof(string?)` does not compile, and reflection cannot tell `string` from `string?` by type.
- `five > none` and `five <= none` are both `false` for `int? none = null`.
- `default(Pair).Name` and an element of `new string[2]` are `null` in a non-nullable slot without any warning.
- A generic `T? FirstOrDefault<T>()` returns `0`, not `null`, for `T = int`.
- After `x?.Name = value;` the compiler suddenly warns that `x` may be null on the next line.

## Mental model
**Analogy:** `int?` is a box with a lid and a flag on top saying "empty" or "full": it exists on the shelf at run time, and you can look at the flag. `string?` is a sticky note on a filing-cabinet drawer saying "may be empty": the drawer is identical with or without the note, and only the inspector who reads the notes (the compiler) acts on it, by complaining before you open a drawer marked "may be empty" without looking first. Nobody stops you at run time.

**Artifact** (run in the lab ✅[^lab]):
```csharp
string? name = FindName(42);                 // annotation: may be null
Console.WriteLine(name?.Length ?? -1);       // -1: ?. short-circuits, ?? supplies a default
int? count = null;
Console.WriteLine(count.HasValue);           // False: Nullable<int> is a real run-time type
Console.WriteLine(typeof(int?));             // System.Nullable`1[System.Int32]
var order = new Order();
order.Customer?.Name = Lookup();             // C# 14: Lookup() never runs, Customer is null
Console.WriteLine(order.Customer is null);   // True

static string? FindName(int id) => null;
static string Lookup() { Console.WriteLine("Lookup ran"); return "x"; }
class Order { public Customer? Customer { get; set; } }
class Customer { public string Name { get; set; } = ""; }
```

## How it works
1. **`Nullable<T>` for value types.** `T?` for a value type is an instance of `System.Nullable<T>`; its default value has `HasValue == false`, and reading `Value` then throws `InvalidOperationException`, as does an explicit cast to `T` ✅[^ref-nvt]. In the lab, `Unsafe.SizeOf<int?>()` was 8 bytes, twice the size of an `int` ✅[^lab]. `??` and `GetValueOrDefault()` supply a replacement value ✅[^ref-nvt].
2. **Lifted operators.** Arithmetic on `T?` returns `null` if either operand is `null`; `<`, `>`, `<=` and `>=` return `false` when either side is `null`; with a `null` operand, `==` is `true` only if both are `null`, and two values compare as usual ✅[^ref-nvt]. The exception is `bool?`, whose `&` and `|` give three-valued logic ✅[^ref-nvt]. In the lab, `five + none` was `null`, `five > none` and `five <= none` were both `False`, `false & null` was `False`, `true | null` was `True` and `true & null` was `null` ✅[^lab].
3. **Boxing `T?`.** Boxing a `T?` without a value gives a null reference; boxing one with a value boxes the plain `T`, not the `Nullable<T>` ✅[^ref-nvt]. So `GetType()` on a `T?` reports the underlying type, and `Nullable.GetUnderlyingType` is the way to recognize a nullable type ✅[^ref-nvt]. In the lab, `five.GetType()` printed `System.Int32`, and the boxed value unboxed to both `int?` and `int` ✅[^lab].
4. **NRT: annotations only.** Nullable reference types are entirely a compile-time feature; the program's run-time behaviour is unchanged ✅[^guide-nrt]. `string` and `string?` are both `System.String` ✅[^guide-nrt]; `typeof(string?)` is error CS8639 ✅[^lab]. The compiler records annotations in metadata, which `NullabilityInfoContext` read back in the lab as `NotNull` and `Nullable` ✅[^lab]. Nothing checks a non-nullable parameter at run time: a value from code compiled with the context disabled reached a `string` local as `null` and threw `NullReferenceException` on use, with no warning ✅[^lab].
5. **The nullable context.** It has two flags, annotations (whether `?` declares a nullable reference) and warnings (whether the analysis reports) ✅[^ref-nrt]. `<Nullable>` takes `enable`, `disable`, `warnings` or `annotations` ✅[^ref-langopt]; without it the default is `disable`, but templates since .NET 6 set `enable` ✅[^ref-langopt]. `#nullable enable`, `#nullable disable` and `#nullable restore` (back to the project setting), each optionally followed by `warnings` or `annotations`, set the context for the rest of a file ✅[^ref-directives], which is how a project migrates file by file ✅[^migration]. A `?` written where annotations are off produces warning CS8632 ✅[^ref-nrt] ✅[^lab].
6. **Flow analysis.** The compiler tracks each expression as *not-null* or *maybe-null*; assignments and null checks change the state, and the analysis follows `if`, patterns such as `is null` and early returns ✅[^guide-nrt]. It does not look inside called methods; their signatures and attributes carry the contract ✅[^guide-nrt]. Warnings fall in two families: a maybe-null value assigned to a non-nullable variable, and a maybe-null variable dereferenced ✅[^guide-nrt]. The Worked example shows each common warning from one lab build.
7. **The null-forgiving operator `!`.** `x!` tells the analysis that `x` is not null; it has no effect at run time, where `x!` is just `x` ✅[^ref-forgiving]. In the lab, `string forced = s!;` with `s = null` compiled without a warning and left `forced` null ✅[^lab].
8. **Attributes for API (application programming interface) contracts.** Preconditions `AllowNull` and `DisallowNull`, postconditions `MaybeNull` and `NotNull`, conditional postconditions `NotNullWhen`, `MaybeNullWhen` and `NotNullIfNotNull`, helper-method attributes `MemberNotNull` and `MemberNotNullWhen`, and `DoesNotReturn`/`DoesNotReturnIf` for methods that always throw ✅[^ref-attrs]. .NET's own libraries are annotated since .NET 5 ✅[^guide-nrt]. `ArgumentNullException.ThrowIfNull(object? argument, string? paramName)` marks `argument` with `[NotNull]` and fills `paramName` with `[CallerArgumentExpression]` ✅[^api-throwifnull]; in the lab `ThrowIfNull(o.Address)` threw with `ParamName = 'o.Address'`, and the line after it dereferenced the value with no warning ✅[^lab].
9. **Null operators at run time.** `?.` and `?[]` evaluate the member only when the receiver is not null and short-circuit the rest of the chain; `??` returns its left operand unless it is null and is right-associative; `??=` assigns, and evaluates its right side, only when the variable is null ✅[^guide-null-ops]. A `?.` that ends in a value type produces `T?`: `none?.Orders.Count` is an `int?` ✅[^lab].
10. **Null-conditional assignment (C# 14).** `?.` and `?[]` can now be assignment targets: `P?.A = B` behaves like `if (P is not null) P.A = B;` with `P` evaluated once, and `B` is evaluated only when `P` is not null ✅[^prop-nca]. All compound assignments are allowed, including `+=` on events; `++`/`--`, `ref` to the result and value-type receivers are not ✅[^prop-nca]. In the lab, `none?.Address = Make(...)` never called `Make`, `some?.Points += 10` gave 10, `some?.Changed += handler` subscribed, `(some?.Points = 42)` produced an `int?` of 42, and `c?.N++` was error CS1059 ✅[^lab].

## Worked example
One file, built with `Nullable=enable`; each one-line method is one case, and the third column is exactly what the C# 14 compiler reported ✅[^lab].

| Case | Code | Diagnostic |
|---|---|---|
| Maybe-null to non-nullable | `string a = m;` with `string? m` | CS8600: Converting null literal or possible null value to non-nullable type |
| Dereference | `m.Length` | CS8602: Dereference of a possibly null reference |
| Null check first | `m is null ? 0 : m.Length` | none |
| Null-forgiving | `m!.Length` | none |
| Argument | `Take(m)` where `Take(string s)` | CS8604: Possible null reference argument for parameter 's' |
| Guard | `ArgumentNullException.ThrowIfNull(m); return m.Length;` | none (`[NotNull]` on the parameter) |
| After a warning | `Take(m); return m.Length;` | only CS8604; the dereference on the next statement was not reported |
| `NotNullWhen(true)` | `TryGet("k", out var v) ? v.Length : 0` | none |
| Same, result ignored | `TryGet("k", out var v); return v.Length;` | CS8602 |
| `NotNullIfNotNull` | `Normalize(null).Length` / `Normalize("x").Length` | CS8602 / none |
| Return | `string Ret() => Back();` where `Back()` returns `string?` | CS8603: Possible null reference return |
| Constructor leaves a field unset | `class Bare { public string Name; public Bare() { } }` | CS8618: Non-nullable field 'Name' must contain a non-null value when exiting constructor |
| `[MemberNotNull(nameof(_id))]` helper called from the constructor | `public Person() { Init(); }` | none |

The "after a warning" row matters when reading a build log: one warning can hide later dereferences of the same variable until the first one is fixed.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `default(Pair)` where `Pair` has a non-nullable `string` field | `Name` is `null`, no warning ✅[^lab] | Default structs are a documented gap of the analysis ✅[^guide-nrt] |
| `new string[2]` | Elements are `null`, no warning ✅[^lab] | Arrays of non-nullable references are another documented gap ✅[^guide-nrt] |
| Unconstrained `T? F<T>()` returning `default` with `T = int` | Returns `0` ✅[^lab] | For a value-type argument, unconstrained `T?` is just `T`; only a `struct` constraint makes it `Nullable<T>` ✅[^ref-nrt] |
| `x?.Prop = v;` on a local the compiler knew was not null | The next `x[0]` or `x.M()` gets CS8602 ✅[^lab] | The compiler treats the `?.` as a test for null on `x`, and after it the lab's analysis no longer assumed `x` was not null |
| `arr?[0]?.ToString()` on `int[]? arr` | Error CS0023: `?` cannot be applied to `int`; `(arr?[0])?.ToString()` works ✅[^lab] | Inside the chain the element is still `int`; the parentheses end the chain and make it `int?` |
| `s?.X = 1` on a non-nullable struct `s` | Error CS0023 ✅[^lab] | Value-type receivers are excluded from null-conditional assignment ✅[^prop-nca] |
| A `#nullable enable warnings` region (warnings on, annotations off) and `s = null; s.Length` on an unannotated `string s` | CS8602 ✅[^lab] | With only the warning flag on, the compiler still runs the full null analysis and warns on a possible `null` dereference ✅[^ref-nrt] |
| A file-based app (`dotnet run file.cs`) with no `Nullable` directive | Nullable warnings appear; `dotnet project convert` writes `<Nullable>enable</Nullable>` into the generated project ✅[^lab] | The SDK's (software development kit's) virtual project for file-based apps enables the context, unlike an old `.csproj` without the property, whose default is `disable` ✅[^ref-langopt] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `int?` (`Nullable<T>`) | Missing value is explicit and checked at run time (`Value` throws) | Lifted comparisons are `false` both ways; boxing rules surprise reflection code |
| Sentinel value (`-1`, `DateTime.MinValue`) | No wrapper | Easy to forget; the compiler cannot help |
| `<Nullable>enable</Nullable>` for the whole project | Every file checked; templates' default since .NET 6 ✅[^ref-langopt] | Large first wave of warnings in old code |
| File-by-file `#nullable enable` | Gradual migration, leaf types first ✅[^migration] | Mixed contexts; oblivious code returns unchecked `null` |
| `!` | Silences a false positive immediately | No run-time effect; a wrong `!` hides a real bug ✅[^ref-forgiving] |
| Nullable attributes | The analysis understands `TryGet`, guards and init helpers | More to write and keep true; the compiler trusts them |

## Takeaways
- Enable the nullable context in every project, and treat the warnings as errors once they are fixed. [rule-candidate]
- Never rely on an NRT annotation for safety at a public boundary; validate with `ArgumentNullException.ThrowIfNull` at entry points. [rule-candidate]
- Prefer a null check, a better signature or an attribute over `!`; each `!` is an unchecked claim. [rule-candidate]
- Use `int?` and the other nullable value types for "no value", not sentinel numbers, and remember that `<`/`>` against `null` are both `false`.
- Watch the documented gaps: `default` structs, new arrays and unconstrained `T?` can hold `null` or `default` without a warning.

## Verification status
- Verified: 54 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Nullable value types (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/nullable-value-types) — Microsoft, living. Rank 1. Backs: `Nullable<T>`, `HasValue`, `Value` and casts throwing; lifted operators and comparisons; `bool?` logic; boxing and `GetType`; `Nullable.GetUnderlyingType`. [^ref-nvt]
- [Nullable reference types (C# fundamentals)](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/null-safety/nullable-reference-types) — Microsoft, living. Rank 1. Backs: compile-time only; same run-time type; null-state and flow analysis; no analysis inside called methods; annotated libraries since .NET 5; default-struct and array gaps. [^guide-nrt]
- [Nullable reference types (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/nullable-reference-types) — Microsoft, living. Rank 1. Backs: the two context flags and four combinations; `?` warning outside an annotations context; meaning of unconstrained `T?`. [^ref-nrt]
- [C# compiler options for language features: Nullable](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language) — Microsoft, living. Rank 1. Backs: `<Nullable>` values; default `disable`; templates set `enable` since .NET 6. [^ref-langopt]
- [#nullable directive (C# preprocessor directives)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/preprocessor-directives) — Microsoft, living. Rank 1. Backs: `#nullable enable`/`disable`/`restore` and the `annotations`/`warnings` forms. [^ref-directives]
- [Nullable migration strategies](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/update-applications/nullable-migration-strategies) — Microsoft, living. Rank 1. Backs: file-by-file migration with `#nullable` directives, leaf types first. [^migration]
- [! (null-forgiving) operator](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/null-forgiving) — Microsoft, living. Rank 1. Backs: `!` changes only the static null state; no run-time effect. [^ref-forgiving]
- [Attributes for null-state static analysis](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis) — Microsoft, living. Rank 1. Backs: the attribute list and their roles. [^ref-attrs]
- [ArgumentNullException.ThrowIfNull](https://learn.microsoft.com/en-us/dotnet/api/system.argumentnullexception.throwifnull) — Microsoft, living. Rank 1. Backs: signature with `[NotNull]` and `[CallerArgumentExpression]`. [^api-throwifnull]
- [Null operators (C# fundamentals)](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/null-safety/null-operators) — Microsoft, living. Rank 1. Backs: `?.`/`?[]` short-circuiting; `??` right-associativity; `??=` evaluates its right side only when null. [^guide-null-ops]
- [Null-conditional assignment (feature specification)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/null-conditional-assignment) — Microsoft / C# language design team, 2024. Rank 1. Backs: semantics of `P?.A = B`; compound forms; no `++`/`--`, no `ref`, no value-type receivers. [^prop-nca]

## Related
- `dotnet/type-design/members-and-initialization.md` — `required` and `init` as the usual fix for CS8618.
- `dotnet/type-design/classes-structs-and-records.md` — why `default` structs exist and what they contain.
- `dotnet/generics/generics-and-constraints.md` — `class?`, `notnull` and `struct` constraints and `T?`.
- `dotnet/tooling/analyzers-and-code-quality.md` — nullable warnings as errors.
- `dotnet/errors-and-resources/exceptions.md` — throw helpers and `NullReferenceException`.
- `dotnet/app-model/system-text-json.md` — `RespectNullableAnnotations` when deserializing.
