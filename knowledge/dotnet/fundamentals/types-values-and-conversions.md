---
schema: knowledge-doc/v1
type: concept
topic: dotnet/fundamentals
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "osx-arm64 for the float-to-integer results", ".NET 11.0.0 (container lab, linux-arm64) for the .NET 11 conversion results"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [csharp, value-types, reference-types, built-in-types, default, var, const, readonly, definite-assignment, overflow, checked, unchecked, integer-division, remainder, conversions, parse, tryparse, convert, float, double, decimal, half, int128, nint]
ranked-sources: true
---

# Types, values and numeric conversions

## Summary
**TL;DR:** Every C# type is a value type (the variable holds the data, assignment copies it: numbers, `bool`, `char`, structs, enums) or a reference type (the variable holds a reference, assignment shares the object: classes, arrays, `string`, delegates). Integer arithmetic silently wraps on overflow unless the code runs in a `checked` context, `/` on integers rounds toward zero and `%` takes the sign of the left operand; `float` and `double` are binary IEEE 754 numbers (the floating-point standard of the Institute of Electrical and Electronics Engineers; `0.1 + 0.2 != 0.3`) while `decimal` is base-10 and exact for money. Casts truncate toward zero, `Convert.ToInt32` and `Math.Round` round half to even, and `Parse`/`TryParse` read the current culture.
**Use this when:** a change made through one variable shows (or does not show) through another, an integer total turns negative, a division or remainder is off by one, `double` comparisons fail, or a parsed number comes out 10 times too big.
**Not this doc:** strings, formatting and culture-aware comparison → `dotnet/fundamentals/strings-and-text.md`; designing your own structs, classes and records → `dotnet/type-design/classes-structs-and-records.md`; boxing and object layout → `dotnet/runtime/object-layout-and-boxing.md`; `Nullable<T>` and nullable reference types → `dotnet/type-design/nullable-reference-types.md`; one `Sum<T>` over all number types → `dotnet/generics/generic-math.md`.

## Problem
Code that looks arithmetic-obvious misbehaves quietly:
- An `int` running total of order amounts becomes `1702032704` instead of `5997000000`, with no exception.
- `-7 / 2` is `-3` and `-7 % 3` is `-1`, so a "floor" split loses a cent on refunds.
- `0.1 + 0.2 == 0.3` is `false`, but `0.1m + 0.2m == 0.3m` is `true`.
- `(int)3.5` is `3`, `Convert.ToInt32(3.5)` is `4`, and `Convert.ToInt32(2.5)` is `2`.
- On a machine whose culture uses a decimal comma, `double.Parse("3.5")` returns `35`.
- Changing a struct copy leaves the original alone; changing a class "copy" changes both.

## Mental model
**Analogy:** a value-type variable is a box with the thing inside; copying the variable builds a second box with its own copy. A reference-type variable is a box holding a house address; copying the variable copies the address, so both boxes lead to the same house. Integer types are car odometers with a fixed number of wheels: past the last digit they roll over to the start, unless a `checked` alarm is fitted. `double` is a ruler marked in powers of two: most decimal fractions such as 0.1 fall between two marks.

**Artifact** (lab output ✅[^lab]):
```csharp
var p1 = new PointS { X = 1 }; var p2 = p1; p2.X = 99;   // struct PointS { public int X; }
var c1 = new PointC { X = 1 }; var c2 = c1; c2.X = 99;   // class  PointC { public int X; }
// struct copy: p1.X=1 p2.X=99
// class copy : c1.X=99 c2.X=99 same=True
int max = int.MaxValue;
Console.WriteLine(max + 1);            // -2147483648   (unchecked by default)
Console.WriteLine(checked(max + 1));   // OverflowException: Arithmetic operation resulted in an overflow.
Console.WriteLine(0.1 + 0.2 == 0.3);   // False  (sum is 0.30000000000000004)
```

## How it works
1. **Two kinds of type.** A value-type variable contains an instance of the type; a reference-type variable contains a reference to an instance ✅[^valuetypes]. Assigning a value type copies the data; assigning a reference type makes both variables point to one object on the managed heap, and classes, arrays, delegates and strings are reference types ✅[^types]. In the lab an array assigned to a second variable showed the write `b[0] = 42` through `a` ✅[^lab]. `string` is a reference type whose instances never change, so `s2 += "!"` leaves `s1` as `hi` ✅[^lab].
2. **Keywords are aliases of .NET types.** Most C# type keywords are aliases of a .NET type and interchangeable with it: `int` is `System.Int32`, `nint` is `System.IntPtr` ✅[^builtin]. The lab printed `System.Int32 System.Int64 System.Double System.Decimal System.Char System.Boolean System.String System.Object System.IntPtr System.UIntPtr` and sizes `byte=1 short=2 int=4 long=8 float=4 double=8 decimal=16 char=2 bool=1 nint=8` ✅[^lab].
3. **Default values.** Reference types default to `null`, numbers to `0`, `bool` to `false`, `char` to `'\0'` (U+0000), and a struct to all its fields at their defaults ✅[^defaults]. Fields, array elements and static variables start initially assigned; a local variable has no default and must be definitely assigned before it is read ✅[^spec-vars]. Reading an unassigned local fails with `error CS0165: Use of unassigned local variable 'x'` ✅[^lab].
4. **`var` is static typing.** `var` asks the compiler to infer the type from the initializer, and the variable stays strongly typed ✅[^decl]. In the lab `var` gave `Int32` for `5`, `Double` for `5.0`, `Decimal` for `5m`, `Single` for `5f`, `Int64` for `5L` and `UInt32` for `5u`; `var x = null;` is `error CS0815` ✅[^lab].
5. **`const` versus `readonly`.** A `const` initializer must be a constant expression the compiler can evaluate, so reference-type constants can only be strings or `null` ✅[^const]. A `readonly` field can be assigned only in its declaration or a constructor of the same class ✅[^readonly]. In the lab, `const int Max = Limits.Count` (a `static readonly`) failed with `CS0133`, assigning a `readonly` field in a method failed with `CS0191`, and reflection showed the const as `IsLiteral=True` (a value stored in metadata, not a field read at run time) ✅[^lab]. Why consts are baked into calling assemblies → `dotnet/type-design/members-and-initialization.md`.
6. **Overflow context.** Integer arithmetic and integer conversions run unchecked by default: high-order bits that do not fit are discarded, so addition wraps from the maximum to the minimum ✅[^checked]. In a `checked` context they throw `OverflowException` ✅[^checked]. The `CheckForOverflowUnderflow` compiler option sets the default for non-constant expressions ✅[^checked]; with `#:property CheckForOverflowUnderflow=true` the lab's `max + 1` threw, and `unchecked(max + 1)` still wrapped ✅[^lab]. Constant expressions are always checked at compile time ✅[^checked], so `int y = int.MaxValue + 1;` is `error CS0220` ✅[^lab].
7. **Integer division and remainder.** Integer `/` rounds the quotient toward zero; the sign of a non-zero `%` result matches the left operand ✅[^arith]. Integer and `decimal` division by zero throw `DivideByZeroException` ✅[^arith]; `int.MinValue / -1` throws even unchecked ✅[^arith] (the lab saw `OverflowException`, a subclass of `ArithmeticException` ✅[^lab]). The lab printed `7/2=3 -7/2=-3 7%3=1 -7%3=-1 7%-3=1` and `Math.DivRem(-7,3)=(-2, -1)` ✅[^lab].
8. **Binary and decimal floating point.** `float` holds about 6–9 significant digits, `double` 15–17, `decimal` 28–29 ✅[^float]. `float` and `double` follow IEEE 754 binary32 and binary64; `decimal` is not IEEE 754, has no NaN (not a number) or infinity, and stores a 96-bit integer scaled by a power of 10, which suits money ✅[^float]. `float`/`double` arithmetic never throws: it yields infinity or NaN, while `decimal` overflow throws `OverflowException` ✅[^arith]. Lab, under the invariant culture: `1/0.0=Infinity` (`en-VN` and `en-US` print `∞`), `0/0.0=NaN`, `double.NaN == double.NaN` is `False` but `double.NaN.Equals(double.NaN)` is `True`, and `16777216f + 1` stays `16777216` ✅[^lab].
9. **Implicit conversions widen.** Every integral type converts implicitly to every floating-point type; `int`/`long` to `float` and `long` to `double` can lose precision but never magnitude; nothing converts implicitly to `byte` or `sbyte`, or from `double` or `decimal` ✅[^numconv]. An `int` constant converts implicitly to a smaller type only if it fits, else `CS0031` ✅[^numconv]. Lab, under the invariant culture: `long 123456789012345678` became `float 1.2345679E+17` (`1,2345679E+17` under `en-VN`), which casts back to `123456790519087104` ✅[^lab].
10. **Explicit conversions (casts) can lose data.** Between integral types an unchecked cast drops the extra high bits (or sign-extends); checked, it throws when the value does not fit ✅[^numconv]. `double`/`float` and `decimal` to integer round toward zero ✅[^numconv]. Lab: `(int)3_000_000_000L = -1294967296`, `(byte)300 = 44`, `(int)-2.9 = -2` ✅[^lab].
11. **Out-of-range float-to-integer casts.** The language leaves an unchecked out-of-range result unspecified ✅[^numconv]. Since .NET 9 conversions to `int`, `long`, `uint` and `ulong` saturate (clamp to the minimum or maximum, NaN gives 0), and .NET 11 extends that to `byte`, `sbyte`, `short`, `ushort` and `char` on CoreCLR (the main .NET runtime) and Native AOT (ahead-of-time compilation), but not on the Mono runtime ✅[^fp9]. The lab (.NET 10, arm64) gave `(int)1e20 = 2147483647`, `(int)NaN = 0`, `(long)1e30 = 9223372036854775807`, but `(byte)300.0 = 44` and `(short)1e6 = 16960` ✅[^lab]: a saturating conversion to `int`, then only the low 8 or 16 bits kept ✅[^fp11]. On .NET 11.0.0 (linux-arm64, Debug and Release) the same casts gave `255` and `32767`, `(sbyte)-298.0 = -128`, `(ushort)-42.0 = 0` (65494 on .NET 10) and `0` for NaN, while `checked((byte)300.0)` still threw `OverflowException` ✅[^lab11].
12. **`Parse`, `TryParse`, `Convert` and casts are different operations.** `Parse` returns the number or throws; `TryParse` returns `false` instead, and `Convert.ToInt32(string)` calls `Int32.Parse` internally ✅[^parse]. `Convert` throws `InvalidCastException` for unsupported conversions and `OverflowException` when the value does not fit ✅[^typeconv]. `Convert.ToInt32(double)` rounds half to even (4.5 → 4, 5.5 → 6) ✅[^convertapi], and so does `Math.Round` by default (`MidpointRounding.ToEven`) ✅[^roundapi]. Lab: `int.Parse(" 42 ")=42`, `int.Parse("1,000")` → `FormatException`, `Convert.ToInt32((string)null)=0` but `int.Parse(null)` → `ArgumentNullException`, unboxing `(long)(object)42` → `InvalidCastException`, `Convert.ToByte(300)` → `OverflowException` ✅[^lab].
13. **Parsing uses the current culture.** Without a format provider, `Parse` and `TryParse` use the current culture's separators ✅[^parsenum]. Integer strings allow only digits, surrounding white space and a leading sign (`NumberStyles.Integer`), and only ASCII (American Standard Code for Information Interchange) digits 0–9 are accepted ✅[^parsenum]. The lab machine runs in culture `en-VN` (decimal separator `,`), where `double.Parse("3.5")` returned `35` ✅[^lab]. Culture details → `dotnet/fundamentals/strings-and-text.md`.
14. **Newer numeric types.** `Half` is a 2-byte binary floating-point type with range ±65504, added in .NET 5; `Int128` and `UInt128` are 16-byte integers; `BigInteger` has no fixed bounds ✅[^numerics]. `nint`/`nuint` are 32-bit in a 32-bit process and 64-bit in a 64-bit one, and their `MinValue`/`MaxValue` are computed at run time ✅[^integral]. Lab: `Int128.MaxValue = 170141183460469231731687303715884105727`, `(Half)70000f = ∞` (printed under the lab's `en-VN`, as under `en-US`; the invariant culture prints `Infinity`), `nint.MaxValue = 9223372036854775807` ✅[^lab].

## Worked example
A bill of 3 × 19.99 split between 4 people and summed over a million orders, every value from the lab run under the invariant culture ✅[^lab].

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | `decimal.Parse("19.99", CultureInfo.InvariantCulture)` | `19.99` | pass a culture, or `en-VN` would read a different number (How it works 13) |
| 2 | `int.Parse(" 3 ")` | `3` | surrounding white space is allowed |
| 3 | `price * qty` | `59.97` (`decimal`) | base-10, exact |
| 4 | `(int)(total * 100)` | `5997` cents | `decimal` to `int` rounds toward zero |
| 5 | `5997 / 4`, `5997 % 4` | `1499`, `1` | quotient toward zero; one cent left over |
| 6 | `-5997 / 4`, `-5997 % 4` | `-1499`, `-1` | the remainder follows the left operand's sign |
| 7 | `Math.Round(59.965m, 2)` vs `MidpointRounding.AwayFromZero` | `59.96` vs `59.97` | default rounding is half-to-even |
| 8 | `int sum += 5997` one million times | `1702032704` | unchecked wrap: 5,997,000,000 mod 2³² read as a signed `int` |
| 9 | the same with `checked(s2 + cents)` | `OverflowException` | checked context |
| 10 | `long lsum += 5997` | `5997000000` | pick a type that holds the largest total |

Steps 8 to 10 are the usual production bug: totals are summed in `int` because each item fits, and no exception tells anyone.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `Math.Abs(int.MinValue)` | `OverflowException` ✅[^lab] | `+2147483648` does not fit in `int`; `unchecked(-int.MinValue)` stays `-2147483648` ✅[^lab] |
| `byte by = 250; by += 10;` | `4`, no error ✅[^lab] | `x op= y` on a small type means `x = (T)(x op y)` ✅[^arith], and the unchecked cast drops high bits ✅[^numconv] |
| `Half.MaxValue.ToString()` | `65500`, while `(float)Half.MaxValue` is `65504`; `Half.Parse("65500") == Half.MaxValue` is `True` ✅[^lab] | the printed text is the short form that reads back as the same `Half`; the value is 65504 ✅[^numerics] |
| `(decimal)double.NaN` | `OverflowException` ✅[^lab] | NaN, infinity and too-large values cannot become `decimal` ✅[^numconv] |
| `decimal.Parse("1e3")` | `FormatException`, while `double.Parse("1e3")` is `1000` ✅[^lab] | `decimal.Parse` uses `NumberStyles.Number` (white space, sign, separators, no exponent) ✅[^decimalapi]; floating-point strings use `NumberStyles.Float` ✅[^parsenum] |
| `int.Parse("٤٢")` (Arabic-Indic digits) | `FormatException` ✅[^lab] | only U+0030 to U+0039 are accepted ✅[^parsenum] |
| `Convert.ToBoolean("1")` | `FormatException` ✅[^lab] | the string must equal `Boolean.TrueString` or `FalseString` ✅[^convertapi] |
| `decimal` ↔ `double`/`float` on .NET 11 | `(decimal)0.1` was `0.1` on .NET 10.0.12 and `0.1000000000000000055511151231` on 11.0.0, `(decimal)14.1f` was `14.1` and `14.1000003814697265625`, and `(double)10000000000000.099609375m` was `10000000000000.09765625` and `10000000000000.099609375`; so `0.1m + 0.2m == (decimal)(0.1 + 0.2)` turned from `True` to `False`. Of 100,000 random decimals (96-bit mantissa, scale 0 to 28), 27,038 became a different `double` than `double.Parse` of their own text on .NET 10, none on .NET 11 ✅[^lab] ✅[^lab11] | From .NET 11 these conversions are correctly rounded ✅[^numconv]: before, `double` and `float` kept only 15 and 7 significant digits on the way to `decimal`, and `decimal` to `double` could round twice; there is no switch back ✅[^dec11] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `decimal` for money | exact base-10 fractions ✅[^float] | 16 bytes; slower than `double`; throws on overflow |
| `double` for measurements | hardware speed, huge range, never throws ✅[^arith] | `0.1 + 0.2 != 0.3`; compare with a tolerance |
| `long` integer cents | exact, fast, sums cleanly | formatting needed for display |
| `checked` everywhere (`CheckForOverflowUnderflow`) | overflow becomes an exception ✅[^checked] | a small run-time cost; hashing code that relies on wrapping must say `unchecked` |
| `TryParse` | no exception on bad input ✅[^parse] | the caller must check the `bool` |

## Takeaways
- Sum and multiply money and counts in `long` or `decimal`, and turn on `CheckForOverflowUnderflow` (or `checked`) where a wrap would be a bug. [rule-candidate]
- Never compare `double` results with `==`; use `decimal` for money and a tolerance for measurements. [rule-candidate]
- Parse and format machine-readable numbers with `CultureInfo.InvariantCulture`; the current culture can turn `3.5` into `35`. [rule-candidate]
- Say which rounding you want: casts truncate, `Convert` and `Math.Round` round half to even, `MidpointRounding.AwayFromZero` is the school rule.
- Remember that struct assignment copies and class assignment shares.
- Create `decimal` values from decimal literals or strings, not by casting a `double`: `(decimal)0.1` changed value in .NET 11. [rule-candidate]

## Verification status
- Verified: 77 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [The C# type system](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/) — Microsoft, living. Rank 1. Backs: value types copy, reference types share; which types are reference types. [^types]
- [Value types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-types) — Microsoft, living. Rank 1. Backs: a value-type variable contains the instance. [^valuetypes]
- [Built-in types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/built-in-types) — Microsoft, living. Rank 1. Backs: keywords alias .NET types. [^builtin]
- [Integral numeric types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/integral-numeric-types) — Microsoft, living. Rank 1. Backs: `nint`/`nuint` size and run-time limits. [^integral]
- [Floating-point numeric types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/floating-point-numeric-types) — Microsoft, living. Rank 1. Backs: precision of `float`, `double`, `decimal`; IEEE 754; `decimal` representation and use. [^float]
- [Default values of C# types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/default-values) — Microsoft, living. Rank 1. Backs: the default of each type. [^defaults]
- [Declaration statements](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/declarations) — Microsoft, living. Rank 1. Backs: `var` infers the type and stays strongly typed. [^decl]
- [The const keyword](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/const) — Microsoft, living. Rank 1. Backs: constant expressions; strings and null only for reference types. [^const]
- [readonly](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/readonly) — Microsoft, living. Rank 1. Backs: where a readonly field can be assigned. [^readonly]
- [checked and unchecked statements](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/checked-and-unchecked) — Microsoft, living. Rank 1. Backs: default unchecked; truncation; `OverflowException`; `CheckForOverflowUnderflow`; constants checked at compile time. [^checked]
- [Arithmetic operators](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/arithmetic-operators) — Microsoft, living. Rank 1. Backs: integer division toward zero; remainder sign; division by zero; `MinValue / -1`; float and decimal overflow behaviour. [^arith]
- [Built-in numeric conversions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/numeric-conversions) — Microsoft, living. Rank 1. Backs: implicit and explicit conversion rules; `CS0031`; unspecified out-of-range float casts; .NET 11 decimal rounding note. [^numconv]
- [Floating point-to-integer conversions are saturating](https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/9.0/fp-to-integer) — Microsoft, 2024. Rank 1. Backs: .NET 9 saturating conversions; .NET 11 extension to small types. [^fp9]
- [Floating-point conversions to small integral types are saturating](https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/11/fp-to-small-integer) — Microsoft, 2026. Rank 1. Backs: the .NET 9 and 10 sequence for small types (saturate to `int`, keep the low bits). [^fp11]
- [Decimal and BigInteger floating-point conversions are correctly rounded](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/11/decimal-biginteger-floating-point-conversions) — Microsoft, 2026. Rank 1. Backs: the previous 15- and 7-digit and double-rounding behaviour; no compatibility switch. [^dec11]
- [How to convert a string to a number](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/types/how-to-convert-a-string-to-a-number) — Microsoft, living. Rank 1. Backs: `Parse`, `TryParse`, `Convert.ToInt32` calls `Int32.Parse`. [^parse]
- [Parsing numeric strings in .NET](https://learn.microsoft.com/en-us/dotnet/standard/base-types/parsing-numeric) — Microsoft, living. Rank 1. Backs: current-culture default; `NumberStyles.Integer` and `Float`; only ASCII digits. [^parsenum]
- [Type conversion in .NET](https://learn.microsoft.com/en-us/dotnet/standard/base-types/type-conversion) — Microsoft, living. Rank 1. Backs: `Convert` throws `InvalidCastException` and `OverflowException`. [^typeconv]
- [Convert.ToInt32](https://learn.microsoft.com/en-us/dotnet/api/system.convert.toint32) — Microsoft, living. Rank 1. Backs: half-to-even rounding of `ToInt32(Double)`; `ToBoolean(String)` accepts only `TrueString`/`FalseString`. [^convertapi]
- [Decimal.Parse](https://learn.microsoft.com/en-us/dotnet/api/system.decimal.parse) — Microsoft, living. Rank 1. Backs: `NumberStyles.Number` default. [^decimalapi]
- [Math.Round](https://learn.microsoft.com/en-us/dotnet/api/system.math.round) — Microsoft, living. Rank 1. Backs: `MidpointRounding.ToEven` default. [^roundapi]
- [Numerics in .NET](https://learn.microsoft.com/en-us/dotnet/standard/numerics) — Microsoft, living. Rank 1. Backs: `Half`, `Int128`/`UInt128`, `BigInteger`. [^numerics]
- [C# standard: Variables](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/variables) — ECMA C# standard (published by Microsoft), living. Rank 1. Backs: initially assigned and unassigned variables; definite assignment. [^spec-vars]

## Related
- `dotnet/fundamentals/strings-and-text.md` — culture, formatting and string comparison.
- `dotnet/type-design/classes-structs-and-records.md` — choosing between struct, class and record.
- `dotnet/runtime/object-layout-and-boxing.md` — what boxing a value type costs.
- `dotnet/generics/generic-math.md` — `checked` operators and `CreateChecked`/`CreateSaturating` for all number types.
