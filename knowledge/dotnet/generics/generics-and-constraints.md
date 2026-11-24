---
schema: knowledge-doc/v1
type: concept
topic: dotnet/generics
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, generics, constraints, type-inference, reified-generics, canon, shared-generics, static-fields, default, allows-ref-struct]
ranked-sources: true
---

# Generic types, constraints and how the runtime instantiates them

## Summary
**TL;DR:** A generic type or method is a template with type parameters (`T`); the compiler checks every use against the template's constraints, and the runtime builds a real closed type for every list of type arguments, so `typeof(T)` and reflection see the actual type (no erasure). The JIT (just-in-time compiler) compiles one shared machine-code body for all reference-type arguments (logged as `__Canon`) and a separate body for each value type, and each closed type has its own static fields. Constraints (`class`, `struct`, `notnull`, `unmanaged`, `new()`, a base class, an interface, `allows ref struct`, `default`) are what let generic code call members of `T`.
**Use this when:** you write a generic method or class and the compiler rejects an operation on `T`; a constraint error (CS0310, CS0452, CS0453, CS0411) needs decoding; `==` inside generic code gives a surprising answer; a static field "resets" per type argument; or you want to know what generic code costs at run time.
**Not this doc:** `in`/`out` variance → `dotnet/generics/variance.md`; static abstract members and `INumber<T>` → `dotnet/generics/generic-math.md`; reflection over generic types → `dotnet/metaprogramming/reflection-and-attributes.md`; generic collections → `dotnet/collections-and-linq/collections.md`; `ref struct` rules → `dotnet/performance/ref-safety-and-ref-structs.md`.

## Problem
Code written without generics, or with them but without knowing the rules, misbehaves in ways that look random:
- An `ArrayList` of 1,000 `int` values allocates about 40 KB, because every value is boxed (copied into its own heap object), and reading a `string` out of it as an `int` fails only at run time with `InvalidCastException`.
- Inside `Max<T>(T x, T y)` the compiler refuses `x.CompareTo(y)` and `x == y` (error CS0019) until a constraint says what `T` can do.
- With `where T : class`, `x == y` returns `False` for two equal strings.
- A static counter in `Cache<T>` seems to reset when `T` changes.
- `var x = Create<T>();` does not compile (CS0411) because the type argument cannot be guessed from the return type.

Each follows from how C# checks generics at compile time and how the runtime instantiates them.

## Mental model
**Analogy:** a generic definition is a form with a blank "type" box. Filling in the box makes a real form (a closed type), and every filled-in form gets its own filing drawer (its static fields). The print shop (the JIT) prints one shared layout for every form whose box holds a reference type, because a reference is always a same-sized slip that points elsewhere; for each value type it prints a custom layout, because an `int` and a 16-byte struct sit directly on the form and need different space. The shared layout carries a small lookup card (the generic dictionary) that says which exact type the form was filled in with.

**Artifact** (run in the lab ✅[^lab]): one generic method called with six type arguments, and the JIT's own log of what it compiled (`dotnet build -c Release g.cs`, then `DOTNET_JitDisasmSummary=1 DOTNET_JitStdOutFile=jit.txt dotnet run -c Release --no-build g.cs`):
```csharp
static class G
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static string Name<T>() => typeof(T).Name;
}
// called as Name<string>, Name<object>, Name<Customer>, Name<int>, Name<long>, Name<Point>
// prints String, Object, Customer, Int32, Int64, Point: each call sees its exact T
```
```console
3: JIT compiled G:Name[System.__Canon]() [Tier0, IL size=16, code size=88]
4: JIT compiled G:Name[int]() [Tier0, IL size=16, code size=60]
15: JIT compiled G:Name[long]() [Tier0, IL size=16, code size=60]
16: JIT compiled G:Name[Point]() [Tier0, IL size=16, code size=60]
```
Three reference types, one body; three value types, three bodies (`IL size` is the method's size in IL, intermediate language, the compiled form the JIT reads). The shared body is larger (88 bytes against 60) because it fetches the type from the dictionary instead of having it built in.

## How it works
**3 actors:**
- **C# compiler (Roslyn)** — its job: check each use of a generic against its constraints and infer missing type arguments, via the source and the referenced assemblies' metadata.
- **Runtime type loader** — its job: build one closed type (with its own static fields) per distinct list of type arguments, via the IL (intermediate language) metadata, on first use.
- **JIT** — its job: turn each generic method into machine code, via one shared body per reference-type instantiation family and one body per value type.

```
[compile time: Roslyn]            [run time: type loader]              [run time: JIT]
Max<T>(...) where T : IComparable<T>
  │ checks constraints, infers T
  │ emits IL with T as metadata
  └──── assembly (.dll) ─────────▶ first use of Max<int>, Max<string>
                                    builds closed types/methods
                                    (each with own statics)
                                          │
                                          ├── value type (int, Point) ──▶ specialized body per type
                                          └── reference type (string,  ──▶ one body for T = __Canon,
                                              object, Customer)              exact T read from the
                                                                             generic dictionary
```

1. **Roslyn (compile time) — checks and infers.**
   - Terms: a *generic type definition* is the template (`Dictionary<TKey,TValue>`), *type parameters* are its placeholders, a *constructed type* is the result of supplying *type arguments*, and *constraints* limit which arguments are allowed ✅[^net-generics].
   - A method is generic only if it declares its own type parameter list ✅[^net-generics]. The compiler infers type arguments from the method's arguments, never from a constraint or the return value, so a method with no parameters needs explicit type arguments; inference happens before overload resolution, and only methods whose inference succeeded take part ✅[^generic-methods]. In the lab, `NoArgs<T>()` called as `NoArgs()` gave error CS0411 ✅[^lab].
   - Without constraints, generic code can use only the members of `object`; a constraint lets it call the members of the constraining type ✅[^constraints]. `==` and `!=` are not allowed on an unconstrained `T` (CS0019 in the lab ✅[^lab]), and comparing it with `null` is allowed but always false when `T` is a value type ✅[^constraints].
   - A type argument that breaks a constraint is a compile-time error ✅[^constraints]; the lab printed CS0310 (`string` has no parameterless constructor for `new()`), CS0453 (`string` for `struct`) and CS0452 (`int` for `class`) ✅[^lab].
2. **Roslyn — the constraint menu.** At most one of `struct`, `class`, `class?`, `notnull`, `unmanaged` may appear, and it comes first; `new()` comes last, except for a following `allows ref struct` ✅[^constraints].

   | Constraint | The type argument must be | Lets the code |
   |---|---|---|
   | `struct` | a non-nullable value type; implies `new()` ✅[^constraints] | use `T?`, which is `Nullable<T>` for a struct ✅[^where] (lab: ``System.Nullable`1[System.Int32]`` ✅[^lab]) |
   | `class` / `class?` | a reference type; `class` warns on a nullable argument in a nullable context ✅[^constraints] (CS8634 ✅[^lab]) | compare with `null`; `==` means reference equality |
   | `notnull` | a non-nullable value or reference type; a violation is only a warning ✅[^constraints] (CS8714 ✅[^lab]) | express "no nulls" to the nullable analysis |
   | `unmanaged` | a non-nullable, non-pointer unmanaged type: a built-in number, `char`, `bool`, an enum, or a struct or tuple whose fields are all unmanaged, pointer fields included ✅[^unmanaged]; implies `struct` ✅[^constraints]; `int*` itself gave CS0306 in the lab ✅[^lab] | use `sizeof(T)` in unsafe code (lab: 4 for `int`, 16 for `(byte, long)` ✅[^lab]) |
   | `new()` | a type with a public parameterless constructor ✅[^constraints] | write `new T()`, which the lab IL showed is a call to `Activator.CreateInstance<T>()` ✅[^lab] |
   | base class, interface, `U` | the type, derived from it, or implementing it; `System.Enum` and `System.Delegate` are allowed as base constraints ✅[^constraints] | call those members (`x.CompareTo(y)`) |
   | `allows ref struct` (C# 13) | may be a `ref struct` such as `Span<T>`; instances then cannot be boxed and follow ref safety rules ✅[^constraints] | accept `Span<int>` as `T` (lab ✅[^lab]) |
   | `default` | used only on an override or explicit interface implementation, to mean "the base method without `class` or `struct`" ✅[^constraints] | pick the right overload to override (Edge cases) |

3. **Type loader (run time) — closed types and their statics.** All code runs in the context of a closed constructed type; open types exist only at compile time ✅[^spec-types]. Each closed constructed type has its own set of static fields, except that closed types which are identity-convertible (such as `C<object>` and `C<dynamic>`) share one set ✅[^spec-types]. The standard allows an unbound generic type such as `List<>` only inside `typeof` ✅[^spec-types], written with one comma fewer than its type parameters (`typeof(Dictionary<,>)`) ✅[^typeof]; C# 14 also accepts one as the operand of `nameof`, so `nameof(List<>)` is `"List"` ✅[^cs14] (lab ✅[^lab]).
4. **Type loader — reified generics.** Reflection can query a constructed generic at run time and get both its actual type and its type argument ✅[^runtime-generics]; C# generics keep full runtime type information and have no type erasure ✅[^cs-generics]. In the lab, `typeof(List<>).MakeGenericType(typeof(string))` produced ``System.Collections.Generic.List`1[System.String]`` ✅[^lab].
5. **JIT — specialized code for value types.** The first construction with a value-type argument makes the runtime create a version with that type substituted; it is created once per distinct value type and reused ✅[^runtime-generics].
6. **JIT — shared code for reference types.** For reference-type arguments the runtime generates one canonical body, `Method<__Canon>`, because all references have the same size and layout ✅[^shared-generics]. The canonical body loads instantiation-specific handles (such as the exact `List<T>` type) from a *generic dictionary*: an array of slots attached to each instantiation, filled lazily on first use ✅[^shared-generics]. Each instantiation keeps its own dictionary, while all compatible instantiations share one dictionary layout ✅[^shared-generics]. Sharing is only done for reference types; value types get separate bodies ✅[^shared-generics].
7. **Default values.** `default(T)` produces the default value of `T` ✅[^default]; in the lab `Def<int>()` returned `0`, `Def<string>()` returned `null` and `Def<DateTime>()` returned `0001-01-01T00:00:00.0000000` ✅[^lab].

## Worked example
One probe (`c-generics-sharing.cs`) walked from source to machine code, with every value measured in the lab ✅[^lab].

| Step | Code | Output | What it shows |
|---|---|---|---|
| 1 | `G.Name<string>()`, `G.Name<object>()`, `G.Name<int>()` | `String`, `Object`, `Int32` | `typeof(T)` sees the exact argument even in shared code (How it works 4, 6) |
| 2 | `Counter<string>.Count++` twice, `Counter<object>.Count++`, `Counter<int>.Count += 10` | `2`, `1`, `10` | one static field per closed type (How it works 3) |
| 3 | `Counter<(int a, int b)>.Count = 5`, read `Counter<ValueTuple<int,int>>.Count` | `5` | tuple names are compile-time only: one type, one field |
| 4 | `Counter<dynamic>.Count = 7`, read `Counter<object>.Count`; `ReferenceEquals(typeof(Counter<dynamic>), typeof(Counter<object>))` | `7`, `True` | `dynamic` is `object` at run time |
| 5 | JIT log (Mental model) for `Name<>` over `string`, `object`, `Customer`, `int`, `long`, `Point` | 4 bodies: `Name[System.__Canon]`, `Name[int]`, `Name[long]`, `Name[Point]` | one shared body, three specialized ones (How it works 5, 6) |
| 6 | `mi.MethodHandle.GetFunctionPointer()` for the same six `MethodInfo`s | six different addresses, for example `0x10D633558` (`string`) and `0x10D633570` (`object`) | the pointer is a per-instantiation entry point, not the shared body: it cannot show sharing (Edge cases) |
| 7 | `typeof(Dictionary<,>).Name`; `Type.GetType("System.__Canon") is not null` | ``Dictionary`2``, `True` | the arity suffix in metadata names; `__Canon` is a real runtime type |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `where T : class` then `x == y` on two equal but separate strings | `False` ✅[^lab], while `string ==` gives `True` | The compiler knows only "reference type" and uses reference equality, even if the argument overloads `==` ✅[^constraints]; constrain to `IEquatable<T>` and call `Equals` instead (`True` in the lab ✅[^lab]) |
| Unconstrained `value == null` with `T = int` | `False`; with `T = int?` and `null`, `True` ✅[^lab] | The comparison is always false for a value-type argument ✅[^constraints] |
| Override of `M<T>(T? x)` when the base has both an unconstrained and a `where T : struct` overload | With no constraint the override replaced the `struct` one; with `where T : default` it replaced the unconstrained one ✅[^lab] | `default` says "the overload without `class` or `struct`" ✅[^constraints] |
| `object Box<T>(T v) where T : allows ref struct => v;` | error CS0029, cannot convert `T` to `object` ✅[^lab] | A type argument that may be a `ref struct` cannot be boxed ✅[^constraints] |
| `class Outer<T> { void M<T>() {} }` | warning CS0693 ✅[^lab] | The inner `T` hides the outer one ✅[^generic-methods] |
| `GetFunctionPointer()` to prove sharing | Different value for `M<string>` and `M<object>` ✅[^lab] | Each instantiation has its own descriptor and dictionary ✅[^shared-generics]; ask the JIT log instead |
| JIT log of a default `dotnet run` | Methods show `MinOpts`, not `Tier0` ✅[^lab] | `dotnet run file.cs` builds the Debug configuration; add `-c Release` to see the tiers real code gets |
| Passing an `int` to an `IComparable` parameter instead of a constrained `T` | 1,000 calls allocated 48,000 bytes (two boxes per call) against 0 for `Max<T>(T, T) where T : IComparable<T>` ✅[^lab] | Generic code over value types needs no boxing ✅[^net-generics] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Generic method with a constraint (`Max<T> where T : IComparable<T>`) | Type safety at compile time; no boxing for value types ✅[^net-generics] | One machine-code body per value type used ✅[^runtime-generics]; only reference types share code, which is what saves memory and JIT time ✅[^shared-generics] |
| `object` or `ArrayList`-style parameter | One body, simple signature | Boxing of every value and casts that fail only at run time ✅[^lab] |
| Interface parameter (`IComparable x`) | One body, no generics in the signature | Boxes value types at each call: 48 bytes per call for two `int` arguments in the lab ✅[^lab] |
| Narrow constraint (`where T : Employee`) | The body can use the base type's members ✅[^constraints] | Fewer types accepted; adding a constraint later breaks callers |

## Takeaways
- Put the capability you need into a constraint (`IEquatable<T>`, `IComparable<T>`, `INumber<T>`) instead of casting to `object` inside generic code. [rule-candidate]
- Never use `==` on a `class`-constrained `T` to compare values; call `EqualityComparer<T>.Default.Equals` or constrain to `IEquatable<T>`. [rule-candidate]
- Expect one static field per closed generic type; put a cache that must be shared in a non-generic holder.
- To see what the JIT shares, read `DOTNET_JitDisasmSummary` output from a Release build, not function pointers.

## Verification status
- Verified: 67 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Generics in .NET](https://learn.microsoft.com/en-us/dotnet/standard/generics/) — Microsoft, living. Rank 1. Backs: terminology; a method is generic only with its own type parameters; no boxing for value types. [^net-generics]
- [Generic types and methods](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/generics) — Microsoft, living. Rank 1. Backs: full runtime type information, no type erasure. [^cs-generics]
- [Constraints on type parameters](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/generics/constraints-on-type-parameters) — Microsoft, living. Rank 1. Backs: the constraint list, order and combination rules; `==` with `class`; unbounded `T` and `null`; `default`, `notnull`, `unmanaged`, `allows ref struct`; `Enum` and `Delegate` constraints. [^constraints]
- [where (generic type constraint)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/where-generic-type-constraint) — Microsoft, living. Rank 1. Backs: `T?` is `Nullable<T>` when `T` is a struct. [^where]
- [Unmanaged types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/unmanaged-types) — Microsoft, living. Rank 1. Backs: which types are unmanaged; the `unmanaged` constraint excludes pointer types. [^unmanaged]
- [Generic methods](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/generics/generic-methods) — Microsoft, living. Rank 1. Backs: inference from arguments only, before overload resolution; CS0693. [^generic-methods]
- [Generics in the runtime](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/generics/generics-in-the-run-time) — Microsoft, living. Rank 1. Backs: one specialized version per value type; reflection sees the type argument. [^runtime-generics]
- [C# language specification: Types, §8.4.3 Open and closed types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/types) — ECMA / Microsoft, living. Rank 1. Backs: code runs in closed types; static fields per closed type; identity-convertible types share them; unbound types only in `typeof`. [^spec-types]
- [Type-testing operators and cast expressions: `typeof`](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/type-testing-and-cast) — Microsoft, living. Rank 1. Backs: `typeof` with unbound generic types and the comma count. [^typeof]
- [What's new in C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) — Microsoft, living. Rank 1. Backs: `nameof` accepts an unbound generic type from C# 14. [^cs14]
- [Default value expressions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/default) — Microsoft, living. Rank 1. Backs: `default(T)` produces the type's default value. [^default]
- [Shared Generics Design](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/botr/shared-generics.md) — .NET runtime team (Fadi Hanna), 2019. Rank 1. Backs: canonical code `Method<__Canon>`, generic dictionaries and layouts, lazy slots, sharing for reference types only. [^shared-generics]

## Related
- `dotnet/generics/variance.md` — when `IEnumerable<Cat>` may stand in for `IEnumerable<Animal>`.
- `dotnet/generics/generic-math.md` — static abstract interface members and one `Sum<T>` for every number type.
- `dotnet/runtime/jit-tiering-and-aot.md` — tier 0, tier 1 and what `DOTNET_JitDisasmSummary` prints.
- `dotnet/runtime/object-layout-and-boxing.md` — what a box costs and when it happens.
- `dotnet/type-design/nullable-reference-types.md` — `T?`, `notnull` and nullable warnings in depth.
