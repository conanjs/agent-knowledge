---
schema: knowledge-doc/v1
type: concept
topic: dotnet/type-design
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, properties, field-keyword, init, required, primary-constructors, constructors, static-constructor, beforefieldinit, object-initializer, indexers, const, static-readonly, access-modifiers, file-local, private-protected]
ranked-sources: true
---

# Members and initialization

## Summary
**TL;DR:** Fields hold data; properties and indexers are accessor methods that look like fields. C# 14's `field` keyword lets one accessor have a body while the compiler keeps the backing field; `init` allows setting only while the object is created, and `required` makes callers set it. A primary constructor parameter is a parameter that the compiler stores in a hidden, writable field when a member uses it, not a `readonly` field. Creating an object runs a fixed order: derived field initializers, then base field initializers and the base constructor, then the derived constructor body; each type's static initialization runs once, just before the type is first needed. A `const` is copied into every caller at compile time, a `static readonly` is read at run time.
**Use this when:** adding validation to an auto-property; choosing between constructor parameters, `init`, `required` and a primary constructor; a static constructor or field initializer runs at a surprising time or throws `TypeInitializationException`; a changed library constant does not reach its callers; choosing an access modifier.
**Not this doc:** struct constructors and `default` values → `dotnet/type-design/classes-structs-and-records.md`; virtual calls from constructors → `dotnet/type-design/inheritance-and-interfaces.md`; the CS8618 "non-nullable member is not initialized" warning → `dotnet/type-design/nullable-reference-types.md`; parameters and overloads → `dotnet/fundamentals/methods-and-parameters.md`; partial properties and constructors → `dotnet/metaprogramming/source-generators.md`; collection expressions → `dotnet/collections-and-linq/collections.md`.

## Problem
- Adding a range check to `public int Hours { get; set; }` used to mean writing a private field and both accessors by hand.
- After moving to C# 14, a class that already had a member named `field` stops using it inside property accessors, with only a compiler warning (CS9258) to show it.
- A primary constructor parameter changed by one method is seen changed by every other method, and a derived class can end up holding a second, stale copy of a value the base class also stores (warning CS9107).
- A derived class's field initializer runs before the base class constructor, and the derived static constructor runs before the base one.
- A library changes `const int Version = 1` to `2`, and an application that loads the new library still prints `1`.
- `new T()` refuses a type with `required` members (error CS9040).

## Mental model
**Analogy:** building an object is a hotel check-in. Opening the hotel happens once (static initialization). Housekeeping prepares the room before the guest arrives (field initializers). The front desk does the paperwork (constructor). The guest's own requests come right after the key is handed over (object initializer). A `required` field is a line on the form that the desk refuses to skip; an `init` property is a request accepted only during check-in. A `const` is a phone number printed in every brochure: changing it means reprinting them all. A `static readonly` value is the number on the hotel's notice board, read each time.

**Artifact** (run in the lab ✅[^lab]):
```csharp
var t = new Timesheet { Employee = "ann", Hours = 8 };   // required + init + field
Console.WriteLine($"{t.Employee} {t.Hours}");              // ANN 8
try { t.Hours = -1; } catch (ArgumentOutOfRangeException) { Console.WriteLine("rejected -1"); }
var c = new Counter(10); c.Bump();
Console.WriteLine($"{c.Start} {c.Current}");               // 10 11

class Timesheet
{
    public required string Employee { get; init => field = value.ToUpperInvariant(); }
    public int Hours { get; set => field = value >= 0 ? value : throw new ArgumentOutOfRangeException(nameof(value)); }
}
class Counter(int start)        // warning CS9124: 'start' is captured and also used to initialize a property
{
    public int Start { get; } = start;   // copied once, at construction
    public int Current => start;         // captured: a hidden, writable field
    public void Bump() => start++;
}
```

## How it works
1. **Auto-properties have a hidden field.** For an automatically implemented property the compiler creates a private, anonymous backing field reachable only through the accessors ✅[^guide-autoprops]; in the lab its name was `<Hours>k__BackingField` ✅[^lab].
2. **The `field` keyword (C# 14).** Inside a property accessor, `field` names that synthesized backing field, so one accessor can have a body while the other stays automatic ✅[^ref-field]. Typical uses are a validating setter, a lazily computed getter `=> field ??= Compute()` and a trimming or lower-casing setter ✅[^cs14]. In the lab, the lazy getter computed its value once across two reads, and each `field`-backed property still got a `<Name>k__BackingField` ✅[^lab]. Because `field` is now a keyword inside accessors, an existing member called `field` is no longer what an accessor reads; `@field` or `this.field` reaches the old member ✅[^prop-field]. The compiler warns with CS9258, and in the lab `Value = 5` wrote the new backing field while the old `field` member stayed 0 ✅[^lab].
3. **`init` and `required`.** An `init` accessor can be called only while the object is being built: from an object initializer, a constructor, or another `init` accessor ✅[^ref-init]; afterwards the assignment is error CS8852 ✅[^lab]. `init` does not force callers to set anything; `required` (C# 11) does: every object creation must set every required member in its object initializer ✅[^ref-required], or the build fails with CS9035 ✅[^lab]. A required member may still be set to `null` (a nullable warning, not an error), a constructor marked `[SetsRequiredMembers]` switches the check off without verifying anything, and a type with required members cannot satisfy a `new()` constraint ✅[^ref-required]; that last case is error CS9040 in the lab ✅[^lab].
4. **Primary constructors.** Since C# 12 any `class` or `struct` can declare them ✅[^history]. Parameters declared on a `class` or `struct` header are in scope in the whole body, but they stay parameters: they are not members (`this.start` does not exist), they can be assigned, and only records turn them into properties ✅[^tut-primary]. The compiler stores a parameter only when a member body uses it; a parameter used only in an initializer is not stored ✅[^tut-primary]. Every other constructor must chain to the primary one through `this(...)` ✅[^tut-primary]. Three lab runs ✅[^lab] show what this means:
   - `Counter(int start)` got a field `<start>P` that is not `readonly`, so `Bump()` changed what `Current` returns (10 → 12 after two calls) while the property initialized from `start` kept 10.
   - `OnlyInit(int seed)`, which uses `seed` only in an initializer, had no field for it.
   - `Savings(string id, decimal rate) : Account(id)`, which also reads `id` in a method, stored its own `<id>P`; after `Rename("B-2")` changed the base property, `Describe()` still printed `A-1`. The compiler warned CS9107; the tutorial describes this double storage and recommends using the base class's property instead ✅[^tut-primary].
5. **Instance construction order.** A constructor that has no initializer or a `base(...)` initializer first runs its class's instance field initializers, in source order, and only then calls the base constructor ✅[^spec-instance-init]. So the order for `new Derived()` is: derived field initializers, base field initializers, base constructor body, derived constructor body (Worked example).
6. **Static construction.** A static constructor runs at most once, triggered by the first of two events: an instance is created, or a static member of the class is referenced ✅[^spec-static-ctor]. Static field initializers run in source order immediately before it; without a static constructor they run "at an implementation-dependent time prior to the first use of a static field of that class" ✅[^spec-static-field]. Declaring a static constructor removes the `BeforeFieldInit` flag from the type, which limits runtime optimization ✅[^guide-static-ctor]. In the lab, `Lazy1` (no static constructor) had `BeforeFieldInit` set and calling its static method that reads no field did not run its initializer, while `Eager1` (empty static constructor) ran its initializer on that call ✅[^lab].
7. **Object, collection and indexer initializers.** An object initializer runs the constructor, then assigns the listed members ✅[^guide-init]; in the lab the constructor ran first and the values were evaluated in source order ✅[^lab]. `Address = { City = "Hanoi" }` without `new` sets members of the object the constructor already created ✅[^guide-init]. A collection initializer calls `Add` once per element, and `{ 3, 4 }` calls a two-argument `Add` ✅[^lab]. An indexer initializer (`["a"] = 1`) uses the indexer setter ✅[^guide-init], so a repeated key keeps the last value, while the `Add` form `{ "a", 1 }` throws `ArgumentException` on the duplicate ✅[^lab].
8. **Indexers.** An indexer is a property whose accessors take parameters; it is declared with `this[...]`, need not take an integer, and can be overloaded ✅[^guide-indexers]. In the lab a `Grid` with `this[int row, int col]` and `this[string key]` returned 7 through both ✅[^lab].
9. **`const` versus `static readonly`.** A `const` must be a compile-time constant: a number, `bool`, string or `null` ✅[^ref-const]. The compiler substitutes the literal into the IL (intermediate language) of every use, so a program keeps the old value until it is recompiled against the new library ✅[^guide-constants]. A `readonly` field can be set in its declaration or a constructor, so it can hold a value computed at run time ✅[^ref-const].
10. **Accessibility.** The six levels are `public`, `protected`, `internal`, `protected internal`, `private` and `private protected` (derived types in the same assembly only) ✅[^ref-access]. `private protected` dates from C# 7.2 and `file` (C# 11) limits a top-level type to its source file ✅[^history]. A file-local type cannot appear in the signature of a member of a non-file-local type ✅[^ref-file], reported as CS9051 in the lab ✅[^lab]. Derived classes in the same assembly can use a `private protected` member only through their own type ✅[^ref-private-protected].

## Worked example
`new Derived()` twice, where `Base` and `Derived` each have a static field initializer, a static constructor, an instance field initializer and a constructor body, each logging a line. The lab printed these lines ✅[^lab].

| Step | Line printed | Rule |
|---|---|---|
| 1 | `Main starts; new Derived()` | — |
| 2 | `Derived static field initializer` | `new Derived()` triggers `Derived`'s static constructor; its initializers run just before it (How it works 6) |
| 3 | `Derived static constructor` | |
| 4 | `Derived instance field initializer` | Field initializers run before the base constructor call (How it works 5) |
| 5 | `Base static field initializer` | The `base()` call is the first use of `Base`, so its type initialization runs now |
| 6 | `Base static constructor` | |
| 7 | `Base instance field initializer` | Same rule as step 4, one level up |
| 8 | `Base instance constructor body` | |
| 9 | `Derived instance constructor body` | |
| 10–14 | `second new Derived()`, then the lines of steps 4, 7, 8, 9 | Static constructors run at most once (How it works 6) |

Steps 4 and 5 are why a derived field initializer cannot rely on anything a base static constructor sets up, and why a virtual method called from the base constructor already sees the derived class's initialized fields but not its constructor-body assignments.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A static field initializer throws (`int.Parse("x")`) | Every access, the first and the second, throws `TypeInitializationException` with the `FormatException` inside ✅[^lab] | The runtime does not run a failed static constructor again; the type stays uninitialized ✅[^guide-static-ctor] |
| Static constructor waits on a task, lock or thread | Risk of deadlock. In the lab, a thread started by the static constructor blocked on reading the type's static field until the constructor's `Join(1 s)` returned `false` after 1,000 ms; `Task.Run(...).Wait(1 s)` on the type's own static method and a PLINQ (Parallel LINQ, Language-Integrated Query) query over one also timed out, and `Join()` without a timeout hung until the process was killed after 10 s ✅[^lab] | The runtime runs it inside a per-type lock; the guide says not to block there ✅[^guide-static-ctor] |
| Order of static constructors in a hierarchy | The programming guide lists: derived static field initializers, base static field initializers, then static constructors from the base type down to the derived type, all before any instance is created, and it adds that the order of static constructor execution isn't specified ✅[^guide-static-ctor]. On .NET 10 the lab ran `Derived`'s static constructor (step 3) and its instance field initializer (step 4) before `Base`'s static field initializer and static constructor (steps 5–6) ✅[^lab] | The spec ties each class's static constructor only to that class's first instance creation or static member reference ✅[^spec-static-ctor]; `Base` is first touched by the `base()` call. Do not depend on a cross-type order |
| Library v2 changes `const Const = 1` and `static readonly Readonly = 1` to 2; the app is not rebuilt | The app printed `const=1  static readonly=2`; after a rebuild, `const=2` ✅[^lab] | The constant was baked into the app's IL ✅[^guide-constants] |
| Reading a `private protected` member from a derived class in another assembly | Error CS0103: the member does not exist in that context ✅[^lab] | Access is limited to derived types in the declaring assembly ✅[^ref-private-protected] |
| A second file in the same project uses a `file class Hidden` | Error CS0103 ✅[^lab] | A file-local type is visible only in its own file ✅[^ref-file] |
| A local variable named `field` inside a property accessor | Reported as an error in C# 14 ✅[^prop-field]: CS9273 "In language version 14.0, 'field' is a keyword within a property accessor. Rename the variable or use the identifier '@field' instead.", also for a lambda parameter named `field`; `int @field = 5;` and the same code under `LangVersion=13` compiled and returned 5 ✅[^lab] | `field` is a keyword there |
| `[SetsRequiredMembers]` constructor that forgets a required member | No CS9035; only the nullable warning CS8618 appeared in the lab ✅[^lab] | The attribute disables the check rather than verifying it ✅[^ref-required] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Constructor parameters | Callers cannot forget a value; clear at every call site | Long parameter lists; positional arguments are easy to swap |
| `init` + `required` properties | Named, readable creation; the compiler enforces completeness | Not usable with a `new()` constraint; `[SetsRequiredMembers]` can hide gaps |
| Primary constructor | Very short dependency-injection style classes | Captured parameters are writable and can be duplicated in derived classes; no place for validation unless you assign to a member |
| `field`-backed property | Validation or lazy loading without a named field | A member already called `field` changes meaning |
| `const` | Usable in attributes, `switch` cases and other constant expressions | Every caller must be rebuilt when it changes; only built-in types |
| `static readonly` | Any type; value can be computed at run time; callers see a new library's value | Not a constant expression |

## Takeaways
- Use `field` in an accessor to add validation or lazy initialization to an auto-property; rename or escape (`@field`) any member already called `field` when moving to C# 14. [rule-candidate]
- Do not expose a value that can change between releases as a public `const`; use `static readonly` (or a property). [rule-candidate]
- Treat primary constructor parameters as mutable captured variables: assign them to a `readonly` field or a get-only property when they must not change, and do not capture one that is also passed to the base class. [rule-candidate]
- Keep static constructors free of blocking calls and of work that can throw; a failure poisons the type for the life of the process. [rule-candidate]
- Mark members `required` when an object is invalid without them, instead of relying on callers to remember an `init` property.

## Verification status
- Verified: 59 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Automatically implemented properties](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/auto-implemented-properties) — Microsoft, living. Rank 1. Backs: the private anonymous backing field. [^guide-autoprops]
- [The `field` contextual keyword](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/field) — Microsoft, living. Rank 1. Backs: `field` names the synthesized backing field; one accessor can keep an automatic body. [^ref-field]
- [What's new in C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) — Microsoft, living. Rank 1. Backs: validation, lazy initialization and normalization with `field`. [^cs14]
- [`field` keyword in properties (feature specification)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/field-keyword) — Microsoft / C# language design team, 2024. Rank 1. Backs: the breaking change for members named `field`, `@field`, the error for a local named `field`. [^prop-field]
- [The `init` keyword](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/init) — Microsoft, living. Rank 1. Backs: when an `init` accessor may be called; `init` does not force callers. [^ref-init]
- [required modifier](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/required) — Microsoft, living. Rank 1. Backs: required members must be set in object initializers; `null` allowed with a warning; `SetsRequiredMembers`; no `new()` constraint. [^ref-required]
- [Declare primary constructors for classes and structs](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/tutorials/primary-constructors) — Microsoft, living. Rank 1. Backs: primary constructor parameters are parameters, not members; storage only when used in a member; `this(...)` chaining; double storage in derived classes. [^tut-primary]
- [C# language specification: Instance variable initializers](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes#15113-instance-variable-initializers) — ECMA / Microsoft, living. Rank 1. Backs: field initializers run before the base constructor call. [^spec-instance-init]
- [C# language specification: Static constructors](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes#1512-static-constructors) — ECMA / Microsoft, living. Rank 1. Backs: at most once; triggered by the first instance creation or static member reference. [^spec-static-ctor]
- [C# language specification: Static field initialization](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes#15562-static-field-initialization) — ECMA / Microsoft, living. Rank 1. Backs: initializers run before the static constructor, or at an implementation-dependent time without one. [^spec-static-field]
- [Static constructors (C# programming guide)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/static-constructors) — Microsoft, living. Rank 1. Backs: `BeforeFieldInit`; no second run after an exception; per-type lock and deadlock advice; the documented initialization order. [^guide-static-ctor]
- [Object and collection initializers](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/object-and-collection-initializers) — Microsoft, living. Rank 1. Backs: constructor first, then assignments; nested initializers without `new`; indexer initializers. [^guide-init]
- [Indexers](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/indexers/) — Microsoft, living. Rank 1. Backs: indexers are properties with parameters, declared with `this`, any index type, overloadable. [^guide-indexers]
- [The const keyword](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/const) — Microsoft, living. Rank 1. Backs: allowed constant values; `readonly` can be set at run time. [^ref-const]
- [Constants (C# programming guide)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/constants) — Microsoft, living. Rank 1. Backs: the literal is substituted into IL; callers keep the old value until recompiled. [^guide-constants]
- [Access modifiers (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/access-modifiers) — Microsoft, living. Rank 1. Backs: the six accessibility levels. [^ref-access]
- [The file modifier](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/file) — Microsoft, living. Rank 1. Backs: file-local visibility; not allowed in non-file-local signatures. [^ref-file]
- [private protected (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/private-protected) — Microsoft, living. Rank 1. Backs: derived types in the same assembly, through their own type. [^ref-private-protected]
- [C# version history](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) — Microsoft, living. Rank 1. Backs: `private protected` in C# 7.2, file-local types in C# 11, primary constructors for any class or struct in C# 12. [^history]

## Related
- `dotnet/type-design/classes-structs-and-records.md` — struct constructors, `default` and record primary constructors.
- `dotnet/type-design/inheritance-and-interfaces.md` — what a virtual call from a base constructor sees.
- `dotnet/type-design/nullable-reference-types.md` — CS8618 and `[MemberNotNull]` for members a constructor must set.
- `dotnet/fundamentals/methods-and-parameters.md` — parameters, `ref`/`out`/`in` and overloads.
- `dotnet/metaprogramming/source-generators.md` — partial properties and constructors.
- `dotnet/app-model/dependency-injection.md` — primary constructors as the usual shape of injected classes.
