---
schema: knowledge-doc/v1
type: concept
topic: dotnet/generics
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, generics, variance, covariance, contravariance, in, out, delegates, arrays, ArrayTypeMismatchException]
ranked-sources: true
---

# Covariance and contravariance

## Summary
**TL;DR:** Variance lets one constructed generic type stand in for another whose type argument is related by inheritance. `out T` (covariance) lets an `IEnumerable<Cat>` be used as an `IEnumerable<Animal>`; `in T` (contravariance) lets an `IComparer<Animal>` be used as an `IComparer<Cat>`. Only interfaces and delegates can declare it, it works only for reference-type arguments (`IEnumerable<int>` is not an `IEnumerable<object>`), and classes such as `List<T>` and `Task<T>` stay invariant. Arrays are covariant too, but unsafely: a wrong store throws `ArrayTypeMismatchException` at run time.
**Use this when:** a `List<Derived>` will not convert to `List<Base>` (CS0029), an `IEnumerable<int>` will not convert to `IEnumerable<object>` (CS0266), the compiler reports CS1960 or CS1961 on your own interface, combining two `Action<string>` delegates throws `ArgumentException`, or an array store throws `ArrayTypeMismatchException`.
**Not this doc:** generics, constraints and how the runtime instantiates them → `dotnet/generics/generics-and-constraints.md`; delegate types and lambdas → `dotnet/delegates-and-events/delegates-lambdas-and-closures.md`; arrays as collections → `dotnet/collections-and-linq/collections.md`.

## Problem
Inheritance between element types does not carry over to generic types the way intuition suggests:
- `List<object> lo = new List<string>();` fails with CS0029, although every `string` is an `object`.
- `IEnumerable<object> o = new List<int>();` fails with CS0266, although `IEnumerable<string>` converts fine.
- A method returning `Task<Cat>` cannot be passed where `Task<Animal>` is expected.
- `Animal[] zoo = new Cat[2];` compiles, and then `zoo[1] = new Dog()` throws at run time.
- `Action<string> both = s1 + s2;` throws `ArgumentException: Delegates must be of the same type.` although both variables have the same static type.

## Mental model
**Analogy:** a vending machine that only hands cats *out* can be used wherever "a machine that hands out animals" is wanted: everything that comes out is an animal (covariance, `out`). A vet who accepts any animal *in* can stand in for "a cat vet": every cat handed in is an animal she can treat (contravariance, `in`). A cage you can both put animals into and take them out of (`List<T>`) cannot be relabelled either way: a "cage of animals" view would let someone put a dog into a cage of cats.

**Artifact** (run in the lab ✅[^lab]):
```csharp
IEnumerable<Cat> cats = new List<Cat> { new("Tom"), new("Kit") };
IEnumerable<Animal> animals = cats;            // out T: same object, ReferenceEquals is True
IComparer<Animal> byName = Comparer<Animal>.Create((x, y) => string.Compare(x.Name, y.Name, StringComparison.Ordinal));
var sorted = new SortedSet<Cat>(byName);       // in T: wants IComparer<Cat>, accepts IComparer<Animal>
Func<Animal, string> describe = a => "animal " + a.Name;
Func<Cat, object> f = describe;                // in on the parameter, out on the result
IEnumerable<int> ints = new[] { 1, 2 };
Console.WriteLine(ints is IEnumerable<object>);  // False: value types never vary
```

## How it works
1. **Only interfaces and delegates can be variant.** A type parameter marked `out` is covariant, one marked `in` is contravariant, and one with neither is invariant ✅[^spec-interfaces]. Variant type parameters are restricted to generic interfaces and generic delegates, and one type may mix covariant and contravariant parameters ✅[^net-variance]. In the lab, `class Box<out T>` and `struct Pair<in T>` both failed with CS1960 ✅[^lab].
2. **The compiler checks every member for variance safety.** A covariant type parameter may appear only in output positions (return types) and a contravariant one only in input positions (parameter types) ✅[^net-variance]; the standard defines this as output-unsafe and input-unsafe types, checked through nested generic types too ✅[^spec-interfaces]. `ref`, `in` and `out` parameters cannot be variant ✅[^creating-variant]. In the lab each break gave CS1961, as the table shows ✅[^lab].

   | Declaration | Lab result ✅[^lab] |
   |---|---|
   | `interface IProducer<out T> { void Put(T item); }` | CS1961: `T` must be contravariantly valid on `Put(T)` |
   | `interface IConsumer<in T> { T Take(); }` | CS1961: `T` must be covariantly valid on `Take()` |
   | `interface IReadWrite<out T> { T Value { get; set; } }` | CS1961: `T` must be invariantly valid on `Value` |
   | `interface IRef<out T> { void Fill(out T value); }` | CS1961: `T` must be invariantly valid on `Fill(out T)` |
   | `interface IOkay<out T> { void Visit(Action<T> visitor); }` | compiles: a contravariant delegate parameter turns the position around |

   The last row is the documented exception: a covariant `T` may be the type argument of a contravariant delegate parameter ✅[^creating-variant].
3. **Variance is a reference conversion, so value types are excluded.** `T<A>` converts to `T<B>` when, for every covariant parameter, an implicit reference or identity conversion exists from `A` to `B`, for every contravariant parameter one exists from `B` to `A`, and invariant parameters match exactly ✅[^spec-interfaces]. `int` to `object` is a boxing conversion, not a reference conversion, so variance supports reference types only ✅[^variant-interfaces]; for a value-type argument the parameter acts as invariant ✅[^net-variance]. Because nothing is copied, the converted reference is the same object: `ReferenceEquals(cats, animals)` was `True` in the lab ✅[^lab].
4. **Classes and structs stay invariant.** A class that implements a variant interface is still invariant: `List<string>` does not convert to `List<object>` ✅[^variant-interfaces]. In the lab, a `List<string>` boxed as `object` tested `True` for `is IEnumerable<object>` and `False` for `is List<object>`, and a `Task<Cat>` tested `False` for `is Task<Animal>` ✅[^lab].
5. **Derived interfaces declare their own variance.** The compiler does not infer variance from a base interface: `interface IInvariant<T> : ICovariant<T>` is invariant ✅[^creating-variant]. In the lab, an object implementing `IInvariant<Cat>` tested `False` for `IInvariant<Animal>` but `True` for the base `IProducer<Animal>` ✅[^lab].
6. **Which built-in types are variant.** The .NET docs list `IEnumerable<out T>`, `IEnumerator<out T>`, `IQueryable<out T>`, `IGrouping<out TKey, out TElement>`, `IComparer<in T>`, `IEqualityComparer<in T>`, `IComparable<in T>`, `Func<…, out TResult>` with `in` parameters, `Action<in …>`, `Predicate<in T>`, `Comparison<in T>` and `Converter<in, out>` ✅[^net-variance], plus `IReadOnlyList<out T>` and `IReadOnlyCollection<out T>` ✅[^variant-interfaces]. Reading `GenericParameterAttributes` by reflection in the lab ✅[^lab] gave:

   | Type | Variance on .NET 10 |
   |---|---|
   | `IEnumerable<out T>`, `IReadOnlyList<out T>`, `IAsyncEnumerable<out T>`, `IObservable<out T>` | covariant |
   | `IComparer<in T>`, `IEqualityComparer<in T>`, `Action<in T>`, `Predicate<in T>`, `IObserver<in T>` | contravariant |
   | `Func<in T, out TResult>` | both |
   | `EventHandler<in TEventArgs>` | contravariant on .NET 10; the API (application programming interface) reference shows it invariant on .NET 8 and 9 ✅[^api-eventhandler] |
   | `IList<T>`, `Task<TResult>`, `Lazy<T>` | invariant |

7. **Delegates vary in two separate ways.** Binding a *method group* to a delegate allows a less derived parameter type and a more derived return type for every delegate type, generic or not ✅[^variance-delegates]; converting one *generic delegate* to another needs `in`/`out` and the same generic definition ✅[^net-variance]. Delegate combination ignores variance: delegates combine only when their run-time types match exactly ✅[^net-variance], and a mismatch fails with a run-time exception ✅[^ref-types]. The fix is to wrap the converted delegate in a new delegate of the exact type, `new Action<string>(s2)` ✅[^ref-types]; in the lab it then combined and ran ✅[^lab].
8. **Arrays are covariant, with a run-time check.** If a reference conversion exists from `A` to `B`, it also exists from `A[]` to `B[]`; so every store into a reference-type array is checked at run time, and a wrong one throws `System.ArrayTypeMismatchException` ✅[^spec-arrays]. Array covariance does not extend to value-type elements: `int[]` cannot be treated as `object[]` ✅[^spec-arrays]. In the lab, `((object)new int[1]) is object[]` was `False` ✅[^lab].
9. **Covariant return types are a different feature.** Since C# 9 an override may declare a more derived return type than the method it overrides ✅[^net-variance]; in the lab `Cat.Clone()` overriding `Animal Clone()` returned `Cat` without a cast ✅[^lab].

## Worked example
A shelter keeps cats sorted by name and prints them through code written for any animal, with every value measured in the lab ✅[^lab].

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | `IComparer<Animal> byName = Comparer<Animal>.Create(...)` | a comparer for any animal | — |
| 2 | `var shelter = new SortedSet<Cat>(byName)` | compiles: the constructor wants `IComparer<Cat>` | `in T` (How it works 3) |
| 3 | `shelter.Add(new("Zed")); shelter.Add(new("Amy"))` | iteration order `Amy,Zed` | the animal comparer runs on cats |
| 4 | `IEnumerable<Animal> view = shelter` | same object, no copy | `out T` (How it works 3) |
| 5 | `Func<Cat, object> f = (Func<Animal, string>)describe` | `f(new Cat("Tom"))` prints `animal Tom` | both directions at once (How it works 7) |
| 6 | `Animal[] zoo = new Cat[2]; zoo[0] = new Cat("ok"); zoo[1] = new Dog("Rex")` | first store works; second throws `ArrayTypeMismatchException: Attempted to access an element as a type incompatible with the array.` | array covariance is checked per store (How it works 8) |
| 7 | `IEnumerable<object> boxed = ints.Cast<object>()` | 2 items | boxing has to be explicit: `Cast` builds a new sequence |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `(IEnumerable<object>)(object)new List<int>()` | compiles, then `InvalidCastException` ✅[^lab] | CS0266 only says an explicit conversion exists; at run time `int` has no reference conversion to `object` ✅[^spec-interfaces] |
| `Action<object> a = (string s) => { };` | CS1678 and CS1661 ✅[^lab] | A lambda's parameter types must match the delegate; variance applies to method groups and delegate conversions, not lambda parameters |
| `Func<int> fi = ...; Func<object> fo = fi;` | CS0029 ✅[^lab], while `Func<object> fo = () => 1;` compiles | The lambda boxes inside its body; the delegate conversion would need `int` → `object` to be a reference conversion ✅[^variance-delegates] |
| `class Pets : IEnumerable<Cat>, IEnumerable<Dog>` used as `IEnumerable<Animal>` | no compiler warning; the lab picked the `Cat` implementation ✅[^lab] | Which implementation the runtime chooses is unspecified ✅[^creating-variant]; avoid implementing one variant interface twice |
| `Action<string> s2 = (Action<object>)log; s1 + s2` | `ArgumentException: Delegates must be of the same type.` ✅[^lab] | `s2`'s run-time type is still `Action<Object>` ✅[^lab]; combination needs identical run-time types ✅[^net-variance] |
| `EventHandler<CancelEventArgs> h = generalHandler;` | compiles and runs on .NET 10 ✅[^lab] | The .NET 10 signature is `EventHandler<in TEventArgs>`; on .NET 8 and 9 it was invariant ✅[^api-eventhandler] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Accept `IEnumerable<T>` or `IReadOnlyList<T>` parameters | Callers can pass a `List<Cat>` where `Animal`s are expected, through covariance ✅[^variant-interfaces] | Read-only view: no `Add` |
| Accept `List<T>`, `IList<T>` or an array | Mutation; arrays even vary | `List<T>` and `IList<T>` are invariant ✅[^lab]; array variance moves the type check to every store ✅[^spec-arrays] |
| Mark your own interface `out` or `in` | Callers get free conversions | Every future member must stay variance-safe, or the change breaks the interface (CS1961) |
| Leave it invariant | Free to add any member | Callers need `Cast<T>()`, `Select` or adapters |

## Takeaways
- Take `IEnumerable<T>` or `IReadOnlyList<T>` parameters, not `List<T>`, when the method only reads, so callers with derived element types can pass their lists. [rule-candidate]
- Never rely on array covariance for writes; store into a `T[]` only through a variable of its real element type. [rule-candidate]
- Expect no variance for value-type arguments; convert with `Cast<object>()` or `Select` when a boxed view is needed.
- Do not combine delegates that reached their variable through a variant conversion; wrap them in `new D(original)` first.

## Verification status
- Verified: 49 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Covariance and contravariance in generics](https://learn.microsoft.com/en-us/dotnet/standard/generics/covariance-and-contravariance) — Microsoft, living. Rank 1. Backs: definitions; only interfaces and delegates; reference types only; combination needs exact types; covariant return types; the list of variant types; method-group versus generic-delegate variance. [^net-variance]
- [Variance in generic interfaces (C#)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/concepts/covariance-contravariance/variance-in-generic-interfaces) — Microsoft, living. Rank 1. Backs: value types do not vary; classes stay invariant; `IReadOnlyList<out T>`, `IReadOnlyCollection<out T>`. [^variant-interfaces]
- [Creating variant generic interfaces (C#)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/concepts/covariance-contravariance/creating-variant-generic-interfaces) — Microsoft, living. Rank 1. Backs: `ref`/`in`/`out` parameters cannot be variant; the contravariant-delegate exception; derived interfaces redeclare variance; ambiguity is unspecified. [^creating-variant]
- [Variance in delegates (C#)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/concepts/covariance-contravariance/variance-in-delegates) — Microsoft, living. Rank 1. Backs: method-group variance for all delegates; value types not supported in generic delegate variance. [^variance-delegates]
- [C# language specification: Interfaces, §19.2.3 Variant type parameter lists](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/interfaces) — ECMA / Microsoft, living. Rank 1. Backs: `in`/`out`/invariant; variance safety; variance conversion needs reference or identity conversions. [^spec-interfaces]
- [C# language specification: Arrays, §17.6 Array covariance](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/arrays) — ECMA / Microsoft, living. Rank 1. Backs: array covariance, the run-time store check, `ArrayTypeMismatchException`, no covariance for value-type arrays. [^spec-arrays]
- [Built-in reference types: the delegate type](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/reference-types) — Microsoft, living. Rank 1. Backs: combination fails at run time after a variant conversion; the `new` delegate workaround. [^ref-types]
- [EventHandler<TEventArgs> Delegate](https://learn.microsoft.com/en-us/dotnet/api/system.eventhandler-1) — Microsoft, living. Rank 1. Backs: `in TEventArgs` on .NET 10 and 11, invariant on .NET 8 and 9. [^api-eventhandler]

## Related
- `dotnet/generics/generics-and-constraints.md` — generic types, constraints and closed types.
- `dotnet/delegates-and-events/delegates-lambdas-and-closures.md` — delegate combination and method-group conversions.
- `dotnet/collections-and-linq/collections.md` — arrays and the read-only collection interfaces.
- `dotnet/type-design/inheritance-and-interfaces.md` — interfaces and overriding, where covariant return types live.
