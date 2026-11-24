---
schema: knowledge-doc/v1
type: concept
topic: dotnet/type-design
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", ".NET 11.0.0 / C# 15 (container lab)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, extension-methods, extension-members, extension-properties, operator-overloading, compound-assignment, conversion-operators, implicit, explicit, true-false-operators, index, range, hat-operator]
ranked-sources: true
---

# Extension members and operators

## Summary
**TL;DR:** Extension members add methods (since C# 3) and, with C# 14 `extension` blocks, properties, static members and operators to a type you do not own; they are static methods underneath, they are found only when their namespace is imported, and an instance member with the same signature always wins. Operator overloading gives a type `+`, `==`, conversions and `true`/`false`; C# 14 lets a type declare an instance `+=` or `++` that changes the object in place instead of allocating a new one, but only when the left side is a variable. `^n` counts from the end and `a..b` takes a slice; any type with `Length` or `Count` plus an `int` indexer (and `Slice` for ranges) supports them.
**Use this when:** extending a library type; an extension method "is not called"; designing a numeric or money type with operators; a `+=` on a big object allocates in a loop; making a custom collection work with `^1` and `..`.
**Not this doc:** LINQ (Language-Integrated Query), the biggest user of extension methods → `dotnet/collections-and-linq/linq.md`; operators in generic code (`INumber<T>`, `IAdditionOperators`) → `dotnet/generics/generic-math.md`; built-in numeric conversions → `dotnet/fundamentals/types-values-and-conversions.md`; `Span<T>` slicing → `dotnet/performance/span-and-memory.md`; `==` versus `Equals` contracts → `dotnet/type-design/inheritance-and-interfaces.md`.

## Problem
- An extension method `Describe(this Widget w)` is never called, although it compiles.
- `data.IsEmpty` works in one file and fails with compiler error CS1061 in another.
- `total += item` on a large accumulator class allocates a new object on every iteration: 24 MB (megabytes) for a million additions in the lab.
- `h.Tally += 5` fails with CS0019 although `InstanceTally` declares `operator +=`.
- `boxed is double` is `false` for a type with an implicit conversion to `double`.
- Indexing an array with `^0` throws, and the range `1..3` returns two elements, not three.

## Mental model
**Analogy:** an extension member is a sticker that a third party prints and you put on someone else's appliance: it adds a button, but it cannot rewire the appliance, it only shows on appliances in rooms where you put up the sticker sheet (the `using` directive), and if the appliance already has a button with the same label, people press the built-in one. Operators are the appliance's own front-panel symbols: `+` gives you a new appliance, while C# 14's `+=` adjusts the dial on the one you hold.

**Artifact** (run in the lab ✅[^lab]):
```csharp
using Shop;
int[] prices = [30, 10, 20];
Console.WriteLine(prices.Total());              // 60: classic extension method (C# 3)
Console.WriteLine(prices.IsEmpty);              // False: extension property (C# 14)
Console.WriteLine(prices[^1]);                  // 20: index from the end
var sum = new Money(10m, "EUR") + new Money(5m, "EUR");
Console.WriteLine(sum);                         // Money { Amount = 15, Currency = EUR }

namespace Shop
{
    public static class SequenceExtensions
    {
        public static int Total(this IEnumerable<int> xs) => xs.Sum();
        extension(IEnumerable<int> source)
        {
            public bool IsEmpty => !source.Any();
        }
    }
    public readonly record struct Money(decimal Amount, string Currency)
    {
        public static Money operator +(Money l, Money r) => new(l.Amount + r.Amount, l.Currency);
    }
}
```

## How it works
1. **Classic extension methods.** A static method in a top-level, non-generic `static class` whose first parameter carries `this` is called with instance syntax ✅[^ref-extension]. It is a static method compiled to the same IL (intermediate language) either way ✅[^guide-ext]; in the lab `Extensions.SumOld(data)` and `data.SumOld()` both returned 6 ✅[^lab]. Extension methods are in scope only after a `using` directive for their namespace ✅[^guide-ext]; without it the lab got CS1061 ✅[^lab]. They appeared in C# 3 alongside LINQ ✅[^history].
2. **Instance members win.** The compiler looks for a matching member on the type first and searches extensions only when none is found, so an extension with the same name and signature as an instance member is never called ✅[^guide-ext]. In the lab, `new Widget().Describe()` printed `instance method` ✅[^lab]. Because an extension method is a static call, it also runs with a `null` receiver: with `string? nothing = null`, `nothing.OrDefault("fallback")` returned `fallback` without a `NullReferenceException` ✅[^lab].
3. **C# 14 `extension` blocks.** Inside a top-level, non-generic static class, `extension(Receiver r) { ... }` declares members for `Receiver`: methods, properties and operators, as instance-like members (using the named receiver `r`) or static ones (the receiver name can then be omitted) ✅[^ref-extension]. Static extension members are called on the type: in the lab, `IEnumerable<int>.Range3` and `string.Banner` worked ✅[^lab]. Methods written either way compile to the same IL, so existing extension methods can be converted without breaking callers ✅[^ref-extension]. An extension block is not a scope: all members of one static class, across its blocks, need distinct signatures ✅[^ref-extension].
4. **How blocks are compiled.** The compiler emits a nested, content-named grouping type for the blocks plus a top-level static implementation method per member, and those implementation methods can be called directly as static methods ✅[^prop-ext]. In the lab, `extension(string s) { public int Words => ...; }` produced a static method `get_Words(String s)` without `[Extension]`, the block's method `Shout` produced `Shout(String s)` with `[Extension]`, and the class gained a nested type `<G>$34505F56…` ✅[^lab]; `Extensions.get_IsEmpty(data)` compiled and returned `False` ✅[^lab].
5. **Extension operators.** C# 14 extension members can include user-defined operators ✅[^cs14]. In the lab an `operator +` for `IEnumerable<int>` declared in an extension block made `data + new[] { 9 }` print `3,1,2,9` ✅[^lab].
6. **Operator overloading rules.** An operator is a `public static` method (compound assignment and the C# 14 instance `++`/`--` are the exceptions), and at least one parameter must be the containing type ✅[^ref-operators]. `==`/`!=`, `<`/`>` and `<=`/`>=` must be declared in pairs, `true` and `false` together; `&&`, `||`, `=`, `.`, `?:`, `??`, `is`, `as` and indexing `[]` cannot be overloaded ✅[^ref-operators]. A `Money` record struct with `+`, `<` and `>` added `EUR` amounts and threw for `EUR` plus `USD` in the lab ✅[^lab].
7. **User-defined compound assignment (C# 14).** Before C# 14, `a += b` always expanded to `a = a + b`, creating a new instance for reference types ✅[^tut-compound]. Now a type can declare `public void operator +=(T y)`: not static, returning `void`, one parameter ✅[^ref-operators]. When the left side is a variable, the instance operator takes precedence; otherwise the static operator is used ✅[^ref-operators]. For `x++`, the instance `operator ++()` is used only when the expression's value is not used, because the old value must survive ✅[^ref-operators]. In the lab, `acc += 5` ran the instance operator on the same object, `acc++;` ran the instance `++`, and `var before = acc++;` fell back to the static `++`, which returned a new object ✅[^lab].
8. **User-defined conversions.** `implicit operator` conversions run without a cast and should never throw or lose information; a conversion that can fail belongs in an `explicit operator` ✅[^ref-conversions]. The type defining the conversion must be its source or target type, and `is` and `as` ignore user-defined conversions ✅[^ref-conversions]. In the lab, `Celsius c = 25.0` and `double raw = c` converted implicitly, `(Fahrenheit)c` gave 77, and `(object)c is double` was `False` ✅[^lab].
9. **`true` and `false` operators.** A type with `operator true` can control an `if`, a loop or `?:`; `true` and `false` need not be complements ✅[^ref-truefalse]. With both plus `operator &`, the type supports `&&` with short-circuiting ✅[^ref-truefalse]. In the lab, `Tri(-1) && Tri(1)` evaluated only the left operand and returned `False` ✅[^lab].
10. **`Index` and `Range`.** Indices and ranges arrived in C# 8 ✅[^history]. `^n` means `Length - n`, so `^0` is one past the end and throws like `[Length]` does; a range `start..end` includes the start and excludes the end ✅[^tut-ranges]. A range over an array or string copies the section, while over a `Span<T>` it is a view of the same memory ✅[^tut-ranges]. In the lab, writing to `xs[1..3]` left `xs` unchanged, writing to `span[1..3]` changed it ✅[^lab]. A type with an `int`-returning `Length` or `Count` is "countable" and gets implicit `^` support from an `int` indexer and range support from `Slice(int, int)` ✅[^tut-ranges]. The lab's `Week` class with only those three members returned `Fri` for index `^1` and `[Tue,Wed]` for range `1..3` ✅[^lab].

## Worked example
Two accumulator designs and four ways to write `+=` against them, measured in the lab (Apple M2, Release build, 1,000,000 additions after a warm-up) ✅[^lab].

| Step | Code | Operator chosen | Result |
|---|---|---|---|
| 1 | `class StaticTally { ... static StaticTally operator +(StaticTally t, long n) => new() { Count = t.Count + n }; }`, then `s += 1` a million times | static `+`: `s = s + 1` (How it works 7) | 24.0 MB allocated, 24 bytes per addition (one new object each) |
| 2 | `class InstanceTally { ... public void operator +=(long n) => Count += n; }`, then `i += 1` a million times | instance `+=` on the same object | 0 bytes allocated |
| 3 | `h.TallyField += 5` (a field) and `h.Arr[0] += 7` (an array element) | instance `+=`: both are variables | `5` and `7` |
| 4 | `h.Tally += 5` where `Tally` is a property | the static `+` is required because a property access is not a variable ✅[^prop-compound] | error CS0019: Operator '+=' cannot be applied to operands of type 'InstanceTally' and 'int' |

Step 4 is the trap: a type that offers only the in-place operator cannot be used with `+=` through a property. Declare the static `+` as well, so every left-hand form compiles and variables still get the in-place version.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Extension indexer `public int this[string key]` in an `extension` block | Error CS8652 in the C# 14 lab: "extension indexers" is a preview feature ✅[^lab]. In the C# 15 container lab such blocks compiled and ran: `numbers[2]` on an `IEnumerable<int>` returned `3`, a two-parameter `this[TKey key, TValue fallback]` and an indexer with a setter worked, and each accessor became a static `get_Item`/`set_Item` method taking the receiver first ✅[^lab11] | Extension indexers are a C# 15 feature, and because an indexer is an instance member its block needs a named receiver ✅[^cs15]; `extension(string)` with an indexer was error CS9303 ✅[^lab11] |
| Extension method called on `null` | Runs; the method sees `null` ✅[^lab] | It is a static method call (How it works 1) |
| Extension property in an expression tree (`Expression<Func<...>>`) | Error CS9296 "An expression tree may not contain an extension property or indexer access"; an extension method from the same block was accepted ✅[^lab] | The reference lists this restriction ✅[^ref-extension] |
| `var before = acc++;` on a type with only an instance `operator ++()` | The instance operator is not considered ✅[^ref-operators] | The old value must be returned, which an in-place change cannot produce |
| A struct type with only `static +` and `v += x` | `v` gets a new value; a copy taken earlier keeps the old one (`vOld = (1, 2)`, `v = (11, 12)`) ✅[^lab] | `v += x` expands to `v = v + x` ✅[^tut-compound] |
| `Index bad = -1;` | `ArgumentOutOfRangeException` ✅[^lab] | The `int` to `Index` conversion throws for negative values ✅[^tut-ranges] |
| `^2` and `1..^1` on length 5 | `GetOffset(5)` is 3; `GetOffsetAndLength(5)` is `(1, 3)` ✅[^lab] | `^n` is `Length - n` ✅[^tut-ranges] |
| Declaring `==` without `!=` | Error CS0216, plus warnings CS0660 and CS0661 for the missing `Equals` and `GetHashCode` overrides ✅[^lab] | The comparison operators must be overloaded in pairs ✅[^ref-operators] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Extension member | Adds methods and properties to types you do not own, including interfaces and sealed types | Cannot access private state; silently loses to a future instance member with the same signature; needs the right `using` |
| Instance member | Always wins resolution; can use private state | Requires owning the type |
| Static `operator +` only | Works for every left-hand form; natural for immutable values | A new instance per `+=` for reference types |
| Instance `operator +=` (C# 14) | In-place update, no allocation | Only for variables; mutates shared objects; pair it with a static `+` |
| `implicit` conversion | Smooth syntax | Surprising when it loses data or throws; `is`/`as` do not see it |
| `explicit` conversion | The cast shows the risk at the call site | More verbose |

## Takeaways
- Put extension members in their own namespace named for the extended concept, and never give one the same signature as a member the type has or may add. [rule-candidate]
- When you add an instance `operator +=` (C# 14), also keep a static `operator +`, so property targets and expressions that use the result still compile. [rule-candidate]
- Make a conversion `implicit` only if it always succeeds and loses nothing; otherwise make it `explicit`. [rule-candidate]
- Overload `==` together with `!=`, `Equals` and `GetHashCode`, all with the same meaning.
- To support `^` and `..` on your own collection, expose `Length` or `Count`, an `int` indexer and `Slice(int, int)`; there is no need to accept `Index` or `Range` yourself.

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [Extension declaration (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/extension) — Microsoft, living. Rank 1. Backs: `this` methods in a top-level non-generic static class; `extension` blocks with instance and static members and operators; same IL for both forms; no scope per block; no extension properties in expression trees. [^ref-extension]
- [Extension members (C# programming guide)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/extension-methods) — Microsoft, living. Rank 1. Backs: same IL as instance syntax; `using` brings extensions into scope; instance members always take priority. [^guide-ext]
- [Extension members (feature specification)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/extensions) — Microsoft / C# language design team, 2025. Rank 1. Backs: grouping and marker types; top-level implementation methods callable as static methods. [^prop-ext]
- [What's new in C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) — Microsoft, living. Rank 1. Backs: extension members can include user-defined operators. [^cs14]
- [What's new in C# 15](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) — Microsoft, living. Rank 1. Backs: extension indexers arrive in C# 15; they need a named receiver. [^cs15]
- [Operator overloading](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/operator-overloading) — Microsoft, living. Rank 1. Backs: `public static` operators; pairs; non-overloadable operators; compound assignment and instance `++` rules and precedence. [^ref-operators]
- [User-defined compound assignment (feature specification)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/user-defined-compound-assignment) — Microsoft / C# language design team, 2025. Rank 1. Backs: a property target uses the static operator and the setter. [^prop-compound]
- [Tutorial: Create compound assignment operators](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/tutorials/compound-assignment-operators) — Microsoft, living. Rank 1. Backs: `a += b` expanded to `a = a + b` before C# 14. [^tut-compound]
- [User-defined explicit and implicit conversion operators](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/user-defined-conversion-operators) — Microsoft, living. Rank 1. Backs: implicit conversions should not throw; source or target type rule; `is`/`as` ignore them. [^ref-conversions]
- [True and false operators](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/true-false-operators) — Microsoft, living. Rank 1. Backs: `true`/`false` semantics; `&&`/`||` through `&`/`|`. [^ref-truefalse]
- [Indices and ranges](https://learn.microsoft.com/en-us/dotnet/csharp/tutorials/ranges-indexes) — Microsoft, living. Rank 1. Backs: `^n` and `^0`; exclusive end; copies versus views; countable types and implicit support; negative `Index` throws. [^tut-ranges]
- [C# version history](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) — Microsoft, living. Rank 1. Backs: extension methods in C# 3; indices and ranges in C# 8. [^history]

## Related
- `dotnet/collections-and-linq/linq.md` — LINQ as a library of extension methods.
- `dotnet/generics/generic-math.md` — operators through `static abstract` interface members.
- `dotnet/type-design/classes-structs-and-records.md` — record equality and the `==` it generates.
- `dotnet/type-design/inheritance-and-interfaces.md` — instance members, overriding, and the `Equals` contract.
- `dotnet/performance/span-and-memory.md` — slicing spans without copying.
- `dotnet/fundamentals/types-values-and-conversions.md` — built-in implicit and explicit conversions.
