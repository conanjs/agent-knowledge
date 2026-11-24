---
schema: knowledge-doc/v1
type: concept
topic: dotnet/generics
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, generics, generic-math, static-abstract, INumber, IAdditionOperators, TSelf, checked-operators, CreateChecked, CreateSaturating, CreateTruncating]
ranked-sources: true
---

# Generic math and static abstract interface members

## Summary
**TL;DR:** Since C# 11 and .NET 7, an interface can declare `static abstract` and `static virtual` members, operators included, and `System.Numerics` builds `INumber<T>` and dozens of finer interfaces from them. So one `T Sum<T>(…) where T : INumberBase<T>` works for `int`, `double`, `decimal`, `Half`, `Int128`, `BigInteger` and your own types. Calls through `T` use the type argument, not an object's run-time type; and because each value type gets its own JIT (just-in-time compiler) body, `Sum<int>` over an `int[]` compiled to the same 60-byte loop as a hand-written `int` loop in the lab. Converting between number types goes through `CreateChecked` (throws on overflow), `CreateSaturating` (clamps) or `CreateTruncating` (keeps the low bits).
**Use this when:** you are about to write the same numeric method for `int`, `long` and `double`; a generic sum overflows silently; a conversion such as `byte.CreateTruncating(384)` gives an unexpected value; you design an interface that needs operators or a static factory; or the compiler reports CS8920 or CS8926.
**Not this doc:** generics and constraints in general → `dotnet/generics/generics-and-constraints.md`; operator overloading and user-defined conversions → `dotnet/type-design/extension-members-and-operators.md`; static abstract members as an interface feature next to default interface members → `dotnet/type-design/inheritance-and-interfaces.md`; `checked`, overflow and numeric conversions outside generics → `dotnet/fundamentals/types-values-and-conversions.md`.

## Problem
Numeric code used to be written once per type, and the generic version still has traps:
- Before C# 11 a generic method could not write `left + right` for `T`: operators are static, and an interface could not require a static member, so libraries shipped one overload per numeric type.
- A generic `Sum<int>` over `{ int.MaxValue, 1 }` returns `-2147483648` without any error.
- `byte.CreateTruncating(-384)` returns `128`, and `int.CreateTruncating(1e20)` returns `2147483647`, not the low 32 bits.
- `int.Zero` does not compile (CS0117), although `int` implements `INumberBase<int>.Zero`.
- With a `Shape` variable holding a `Square`, `Kind<Shape>()` still calls `Shape`'s static member.

## Mental model
**Analogy:** a job advert that lists skills: "can add two of itself, knows its own zero, can be built from another number". Any type whose skills sheet (its interface list) shows them is hired, and the skills belong to the type itself (they are static), not to one employee. The recruiter (the compiler) checks the sheet once; at work, each value-type hire gets a desk set up just for it (its own machine code).

**Artifact** (run in the lab ✅[^lab]):
```csharp
static T Sum<T>(IEnumerable<T> xs) where T : INumberBase<T>
{
    T acc = T.Zero;                       // a static abstract property, called through T
    foreach (var x in xs) acc += x;       // IAdditionOperators<T,T,T>.operator +
    return acc;
}
Sum(new[] { 1, 2, 3 });                   // 6
Sum(new[] { 0.1, 0.2 });                  // 0.30000000000000004
Sum(new[] { 0.1m, 0.2m });                // 0.3
Sum(new[] { (Half)0.5, (Half)0.25 });     // 0.75
Sum(new[] { BigInteger.Pow(10, 30), BigInteger.One });   // 1000000000000000000000000000001
Sum(new[] { new Money(1.50m), new Money(2.25m) });       // 3.75 EUR (a user-defined struct)
```

## How it works
**3 actors:**
- **The interface author** — its job: state the static capabilities a type must have, via `static abstract` or `static virtual` members in a generic interface.
- **C# compiler** — its job: check that the type argument implements the interface and bind `T.Zero` or `a + b` to the interface member, via the constraint on `T`.
- **Runtime and JIT** — its job: run the type argument's own implementation, via a separate compiled body per value-type argument.

```
[library: interface]                 [compile time: Roslyn]                [run time: JIT]
interface IAdditionOperators<TSelf,TOther,TResult>
  static abstract TResult operator +(TSelf, TOther)
                │
                └──▶ Sum<T> where T : INumberBase<T>
                       acc += x  → bound to IAdditionOperators<T,T,T>.op_Addition
                       (allowed only through the type parameter T)
                                  │
                                  └──▶ Sum<int>: body for int, calls int's +, inlined
                                       Sum<double>: separate body for double
                                       Sum<Money>: separate body, calls Money's +
```

1. **Interface author — static members in interfaces.** An interface can declare `static abstract` and `static virtual` members for every member kind except fields, so it can require implementing types to define operators or other static members ✅[^interface-kw]. `static abstract` members must be implemented by every type; `static virtual` ones carry a default the type may override ✅[^svim]. Static abstract members in interfaces and `checked` user-defined operators both arrived in C# 11 ✅[^csharplang-history].
2. **Interface author — the `TSelf` pattern.** Most such interfaces require their own type parameter to implement the interface (`INumber<T>` declares that `T` must implement `INumber<T>`) ✅[^interface-kw]. That constraint is what lets the interface declare operators in terms of the type parameter, so implementers can write ordinary `public static Money operator +(Money, Money)` instead of explicit interface implementations ✅[^constraints].
3. **Compiler — binding through `T`.** Calls to static virtual and abstract members are resolved with type information available at compile time, not through a run-time dispatch like virtual instance methods; the type argument decides which type's static member runs ✅[^interface-kw]. If an expression's run-time type differs from the type used at compile time, the static member of the compile-time type is called ✅[^interface-kw]. In the lab, `Kind<Shape>()` returned `shape` for a variable whose object was a `Square`, and `Kind<Square>()` returned `square` ✅[^lab]. Accessing `INumber<int>.Zero` directly gave CS8926 ("can be accessed only on a type parameter") ✅[^lab].
4. **Compiler — interfaces as type arguments.** `G.Zero<INumber<int>>()` failed with CS8920: an interface whose static members have no most specific implementation cannot be a type argument ✅[^lab].
5. **Library — the `System.Numerics` interfaces.** .NET 7 added math interfaces so that a type parameter can be constrained to be number-like, and every built-in numeric type implements `INumber<T>` ✅[^math]. The main levels are listed below ✅[^math].

   | Interface | Meaning | Examples of members |
   |---|---|---|
   | `INumberBase<T>` | any number, including complex ones | `Zero`, `One`, `Radix`, `CreateChecked`, `IsNaN`, `IsInteger` |
   | `INumber<T>` | a comparable "real" number | `Clamp`, `Max`, `Min`, `Sign` |
   | `IBinaryInteger<T>` | binary integers (`byte` … `Int128`, `nint`) | `DivRem`, `PopCount`, `LeadingZeroCount`, `RotateLeft` |
   | `IFloatingPointIeee754<T>` | IEEE 754 (the Institute of Electrical and Electronics Engineers floating-point standard) floating point (`double`, `float`, `Half`) | `Pi`, `NaN`, `Epsilon`, trigonometric and log functions |
   | `IAdditionOperators<TSelf,TOther,TResult>` and the other operator interfaces | one operator each; operand and result types may differ | `x + y` |

   The operator interfaces deliberately do not pair operations such as `*` and `/`, and they let input and result types differ (an integer average as `double`) ✅[^math].
6. **Library — explicit implementations on the built-in types.** In the lab, `int.Zero` and `double.One` failed with CS0117, while `double.Pi`, `int.IsPow2(64)` and `int.PopCount(255)` (`True`, `8`) compiled ✅[^lab]; some members are reachable only through `T`.
7. **Library — `Create*` conversions.** `CreateChecked` throws `OverflowException` when the value does not fit, `CreateSaturating` clamps to `MinValue`/`MaxValue`, and `CreateTruncating` wraps around; `byte.CreateTruncating(384)` is `128` because it keeps the lowest 8 bits of `0x0180` ✅[^math]. For IEEE 754 floating-point types all three behave like `CreateSaturating`, clamping to the infinities ✅[^math]. Lab results are in the table below ✅[^lab].

   | Call | `CreateChecked` | `CreateSaturating` | `CreateTruncating` |
   |---|---|---|---|
   | `byte` from `384` | `OverflowException` | `255` | `128` |
   | `byte` from `-384` | `OverflowException` | `0` | `128` |
   | `int` from `double.NaN` | `OverflowException` | `0` | — |
   | `int` from `1e20` | — | `2147483647` | `2147483647` |
   | `int` from `-3.99` | — | — | `-3` |
   | `float` from `double.MaxValue` | `∞` (no exception) | — | `∞` for `1e300` |

8. **Compiler — `checked` operators.** A user-defined operator can have a `checked` version; a checked context calls it, an unchecked context calls the plain one, and defining the checked version requires the plain one too ✅[^arith]. Some operator interfaces declare both versions, so `checked(a + b)` inside generic code calls the type argument's checked operator ✅[^math]. By default arithmetic runs unchecked, where integer overflow drops the high-order bits; `float` and `double` never throw, and `decimal` overflow always throws ✅[^arith]. In the lab, `checked(acc + x)` inside `SumChecked<T>` threw `OverflowException` for `int`, returned `∞` for `double`, and called `Money`'s `operator checked +` ✅[^lab].
9. **JIT — one body per value type.** The runtime creates a specialized version of generic code for each value-type argument and shares code only among reference types ✅[^shared-generics]. In a Release build of the lab, `Sum[int]`, `Sum[double]` and `SumInt` (a hand-written `int` loop) each reached tier 1 as their own body; `Sum[int]` over an `int[]` was 60 bytes, the same as `SumInt` over the same array, and both ran 10,000 additions in about 9.8 µs (`dynamic`: about 49 µs) on the macOS arm64 lab machine ✅[^lab]. The Artifact's `IEnumerable<T>` version reached tier 1 at 304 bytes, again the same size as a hand-written `IEnumerable<int>` loop ✅[^lab].

## Worked example
Summing and averaging `int` readings that approach `int.MaxValue`, every value measured in the lab ✅[^lab].

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | `Sum(new[] { int.MaxValue, 1 })` | `-2147483648` | unchecked by default (How it works 8) |
| 2 | `SumChecked(new[] { int.MaxValue, 1 })` with `acc = checked(acc + x)` | `OverflowException` | the checked operator runs |
| 3 | `SumAs<int, long>(…)` with `acc += TResult.CreateChecked(x)` | `2147483648` | accumulate in a wider type (How it works 7) |
| 4 | `Average<int, double>(new[] { 1, 2 })` = `SumAs<int,double>(xs) / TResult.CreateChecked(xs.Length)` | `1.5` | input and result types differ |
| 5 | same `Sum<T>` over `decimal` `{0.1m, 0.2m}` and `double` `{0.1, 0.2}` | `0.3` and `0.30000000000000004` | one algorithm, each type's own arithmetic |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Your own type implements `INumberBase<TSelf>` | It must supply dozens of members, including `Parse`, `TryParse`, `TryFormat` and six `TryConvert*` methods, before it compiles ✅[^lab] | Implement a narrower interface such as `IAdditionOperators<T,T,T>` plus `IAdditiveIdentity<T,T>` when that is all the algorithm needs ✅[^svim] |
| That type's `TryFormat` always returns `false` | `$"{money}"` never finished: the interpolation handler grew its buffer to about 1,073,741,812 chars and kept retrying, at full processor load ✅[^lab] | `false` means "destination too small", so the caller grows and calls again; return `true` when the text fits |
| `float.CreateChecked(double.MaxValue)` | `∞`, no exception ✅[^lab] | Floating-point targets saturate to infinity ✅[^math] |
| `int.CreateTruncating(1e20)` | `2147483647`, not wrapped bits ✅[^lab] | The .NET 10 source converts a `double` with a plain `(int)` cast ✅[^src-int32], and floating point-to-integer casts saturate (`NaN` gives 0) since .NET 9 on x86 and x64 too ✅[^fp-to-int]. .NET 8 already clamped values outside the `int` range in its own library code, so `1e20` gave `2147483647` there as well; a `NaN` input fell through to the plain cast ✅[^src-int32-8], whose x86 and x64 result before .NET 9 the breaking-change page calls non-deterministic, with `NaN` giving 0 only from .NET 9 ✅[^fp-to-int] |
| `Kind<Shape>()` on a `Square` object | `shape` ✅[^lab] | Static dispatch follows the type argument ✅[^interface-kw] |
| `G.Sum(new object[] { 1, 2 })` | CS0311: `object` is not `INumber<object>` ✅[^lab] | Boxed numbers have no static arithmetic; constraint checking happens at compile time ✅[^constraints] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| One method with `where T : INumber<T>` | One source for every numeric type; per-type machine code as fast as hand-written in the lab ✅[^lab] | More JIT work (one body per value type ✅[^shared-generics]); harder signatures |
| One overload per type | Plain code, no constraints | Duplicate logic: the "redundant" overloads generic math lets library authors remove ✅[^math] |
| Narrow operator interfaces (`IAdditionOperators<T,T,T>`) | Accepts types that only add, such as a `Point<T>` ✅[^svim] | You list each operation yourself |
| `dynamic` | No constraints at all | About 5 times slower than the generic loop in the lab ✅[^lab]; errors only at run time |

## Takeaways
- Write numeric algorithms once with the narrowest `System.Numerics` interface that has the operations you use. [rule-candidate]
- Use `checked(...)` or a wider accumulator (`TResult.CreateChecked`) in generic sums of integers; the default wraps silently. [rule-candidate]
- Pick `CreateChecked`, `CreateSaturating` or `CreateTruncating` on purpose; for a floating-point input, `CreateTruncating` saturates like `CreateSaturating` while `CreateChecked` throws, and before .NET 9 on x86 and x64 a `NaN` input to either of the first two was not guaranteed to give 0.
- Remember that static interface members follow the type argument, never the object's run-time type.

## Verification status
- Verified: 45 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Generic math](https://learn.microsoft.com/en-us/dotnet/standard/generics/math) — Microsoft, living. Rank 1. Backs: the `System.Numerics` interfaces and their members; built-in types implement `INumber<T>`; `Create*` semantics and the floating-point case; operator interfaces; checked operators in the interfaces. [^math]
- [Explore static virtual members in interfaces](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interface-implementation/static-virtual-interface-members) — Microsoft, living. Rank 1. Backs: `static abstract` versus `static virtual`; a `Point<T>` that needs only the addition interfaces. [^svim]
- [interface (C# reference): static abstract and virtual members](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/interface) — Microsoft, living. Rank 1. Backs: all member kinds except fields; compile-time resolution; the self-referencing constraint on `INumber<T>`; the compile-time type decides. [^interface-kw]
- [Constraints on type parameters: type arguments implement declared interface](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/generics/constraints-on-type-parameters) — Microsoft, living. Rank 1. Backs: why the `TSelf` constraint lets operators use the type parameter; constraint checking. [^constraints]
- [Arithmetic operators: user-defined checked operators, overflow](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/arithmetic-operators) — Microsoft, living. Rank 1. Backs: checked versus plain operators; unchecked default; `float`/`double`/`decimal` overflow behaviour. [^arith]
- [C# Language Feature History](https://github.com/dotnet/csharplang/blob/main/Language-Version-History.md) — .NET C# language team, living. Rank 1. Backs: static abstract members and checked user-defined operators in C# 11. [^csharplang-history]
- [Floating point-to-integer conversions are saturating](https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/9.0/fp-to-integer) — Microsoft, living. Rank 1. Backs: since .NET 9, floating point-to-integer casts saturate on x86 and x64, with `NaN` giving 0; the previous behaviour was non-deterministic. [^fp-to-int]
- [Int32.cs, release/10.0](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Private.CoreLib/src/System/Int32.cs) — .NET team (dotnet/runtime), 2025. Rank 1. Backs: `CreateTruncating` and `CreateSaturating` from `double` use a plain `(int)` cast outside Mono. [^src-int32]
- [Int32.cs, release/8.0](https://github.com/dotnet/runtime/blob/release/8.0/src/libraries/System.Private.CoreLib/src/System/Int32.cs) — .NET team (dotnet/runtime), 2023. Rank 1. Backs: .NET 8 clamps a `double` outside the `int` range in library code and casts everything else, `NaN` included. [^src-int32-8]
- [Shared Generics Design](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/botr/shared-generics.md) — .NET runtime team (Fadi Hanna), 2019. Rank 1. Backs: separate code bodies for value-type instantiations. [^shared-generics]

## Related
- `dotnet/generics/generics-and-constraints.md` — closed types and the `__Canon` shared body.
- `dotnet/type-design/extension-members-and-operators.md` — writing the operators a generic math interface asks for.
- `dotnet/fundamentals/types-values-and-conversions.md` — `checked`, overflow and float-to-int conversion outside generics.
- `dotnet/runtime/jit-tiering-and-aot.md` — reading the tier names in a JIT log.
