---
schema: knowledge-doc/v1
type: concept
topic: dotnet/type-design
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, inheritance, virtual, override, new, hiding, sealed, abstract, base, interfaces, explicit-implementation, default-interface-members, static-abstract, equals, gethashcode, polymorphism, vtable]
ranked-sources: true
---

# Inheritance and interfaces

## Summary
**TL;DR:** A class has one base class and any number of interfaces. A `virtual` member called through any variable runs the override that the object's run-time type provides; a member hidden with `new` (or without `override`) runs the version of the variable's declared type. A base constructor that calls a virtual method runs the derived override before the derived constructor body has set its fields. Interfaces add contracts, explicit implementations reachable only through the interface, default members (C# 8) and `static abstract` members (C# 11) that generic code resolves per type argument at compile time. Overriding `Equals` without `GetHashCode` breaks every hash-based collection.
**Use this when:** a derived method does not run when called through a base-class variable; a constructor sees `null` in a field it set; an interface member is "missing" on a class that implements it; you need to override `Equals`/`GetHashCode`; choosing between an abstract class and an interface.
**Not this doc:** records' generated equality and `EqualityContract` → `dotnet/type-design/classes-structs-and-records.md`; constructor and initializer order → `dotnet/type-design/members-and-initialization.md`; generic math built on static abstract members → `dotnet/generics/generic-math.md`; variance (`out`/`in`) → `dotnet/generics/variance.md`; how the runtime lays out method tables and boxes values → `dotnet/runtime/object-layout-and-boxing.md`.

## Problem
- `Animal a = new Cat(); a.Speak()` prints the base text although `Cat` defines `Speak`: the method lacked `override` (compiler warning CS0114).
- A base constructor calls a virtual `Validate()`, and the override reports `_id = null` even though the derived constructor sets `_id`.
- `fileLogger.Log("x")` does not compile (CS1061) although `FileLogger` implements `ILogger.Log`.
- A struct implementing `IIncrement` is incremented twice through the interface, and the struct still reads 0.
- A `HashSet` accepts three "equal" keys because the type overrides `Equals` but not `GetHashCode`.

## Mental model
**Analogy:** a base class is a job description with some duties marked "may be done your own way" (`virtual`). An employee hired for the role (a derived class) who writes `override` replaces that duty for every manager who calls on them, whatever title the manager uses. An employee who instead writes `new` keeps a private version of the duty that only managers who address them by their own title see. An interface is a certification: anyone can earn several, some certified skills can be performed only when someone asks "as a certified X" (explicit implementation), and a certification can come with a default procedure the holder never wrote (default interface member).

**Artifact** (run in the lab ✅[^lab]):
```csharp
Animal a = new Dog();
Console.WriteLine(a.Speak());      // Woof: override, chosen by the run-time type
Console.WriteLine(a.Describe());   // an animal: 'new' hides, chosen by the declared type
ILogger log = new FileLogger();
log.Log("hi");                     // ILogger.Log(hi): explicit implementation
Console.WriteLine(log.Prefix);     // [log]: default interface member

class Animal { public virtual string Speak() => "..."; public string Describe() => "an animal"; }
class Dog : Animal { public override string Speak() => "Woof"; public new string Describe() => "a dog"; }
interface ILogger { void Log(string m); string Prefix => "[log]"; }
class FileLogger : ILogger { void ILogger.Log(string m) => Console.WriteLine($"ILogger.Log({m})"); }
```

## How it works
1. **One base class, all its members.** A class has exactly one direct base class, inheritance is transitive, and the derived class gains every base member except constructors and finalizers ✅[^guide-inheritance]. Every class ultimately derives from `System.Object` ✅[^guide-inheritance]. Structs cannot inherit or be inherited from, only implement interfaces ✅[^ref-struct].
2. **`virtual` and `override`: chosen at run time.** When code calls a virtual method, the runtime looks up the run-time type of the object and runs that type's override ✅[^guide-polymorphism]. A member can be overridden only if the base declares it `virtual` or `abstract`, and the derived member must say `override` ✅[^guide-polymorphism]. In the lab, `Speak()` through an `Animal` variable holding a `Dog` printed `Woof` ✅[^lab].
3. **`new`: chosen at compile time.** Declaring a member with the same name and `new` hides the base member; which one runs depends on the variable's declared type ✅[^guide-polymorphism]. Hiding without `new` compiles with warning CS0108, and a method that matches a `virtual` base method without `override` gets CS0114 ✅[^lab] and behaves as if `new` were written ✅[^guide-versioning]. Through an `Animal` variable the lab's `Cat` printed `...`, through a `Cat` variable `Meow` ✅[^lab]. The `new` modifier only suppresses the warning ✅[^ref-new].
4. **`sealed`, `abstract` and `base`.** A sealed class cannot be a base class, and a `sealed override` stops further overriding of one member; `sealed` on a member always goes with `override` ✅[^ref-sealed]. The compiler reports CS0509 and CS0239 for the two violations ✅[^lab]. An `abstract` class cannot be instantiated (CS0144 ✅[^lab]) and its abstract members must be implemented by every non-abstract derived class ✅[^ref-abstract] (CS0534 ✅[^lab]). `base.M()` calls the base class's implementation of an overridden method, and `base(...)` picks the base constructor ✅[^ref-base]; in the lab `base.Speak() + " then " + Speak()` printed `... then Woof` ✅[^lab].
5. **Covariant return types (C# 9).** An override may return a type derived from the base method's return type ✅[^history]. The lab's `Circle.Clone()` overrides `Shape.Clone()` and returns `Circle` ✅[^lab].
6. **Virtual calls from constructors.** A virtual call made while the base constructor runs already dispatches to the derived override, before the derived constructor body has run; rule CA2214 flags such calls, and it is not enabled by default in .NET 10 ✅[^ca2214]. See the Worked example for what the override sees.
7. **Interfaces and explicit implementation.** An interface is a contract that a class, record or struct implements ✅[^ref-interface]. If two interfaces declare the same signature, one public method implements both; to give each its own body, implement them explicitly (`void ILogger.Log(...)`), and such a member can be called only through the interface ✅[^guide-explicit]. In the lab, calling `Log` on a `FileLogger` variable was error CS1061, while `ILogger` and `IAuditLog` variables reached their separate bodies ✅[^lab].
8. **Default interface members.** Since C# 8 ✅[^history], an interface member can have a body that implementing types use unless they provide their own ✅[^ref-interface]. Default members can be reached only through the interface ✅[^ref-interface] (CS1061 on the class variable in the lab ✅[^lab]), and the feature needs runtime support added in .NET Core 3.0 ✅[^history]. The most common use is adding a member to an interface that is already published without breaking its implementers ✅[^tut-dim].
9. **Static abstract and static virtual members.** Added in C# 11 as the basis of generic math ✅[^history], they let an interface require implementing types to provide static members, such as operators or factory methods ✅[^ref-interface]. Calls to them are resolved from the compile-time type, typically a type parameter constrained to the interface, with no run-time dispatch like virtual instance methods ✅[^ref-interface]. In the lab, `Describe<T>() where T : IUnit` printed `m=1m` for `Meters` and `ft=0.3048m` for `Feet` ✅[^lab]. Generic math is built on this → `dotnet/generics/generic-math.md`.
10. **The `Equals`/`GetHashCode` contract.** Every `Equals(object)` override must be reflexive, symmetric and transitive, give the same answer while the objects do not change, return `false` for `null`, and never throw ✅[^api-equals]. A type that overrides `Equals` must override `GetHashCode`, otherwise hash tables may not work ✅[^api-equals]; equal objects must return equal hash codes, while equal hash codes do not imply equality ✅[^api-gethashcode]. The compiler warns with CS0659 ✅[^lab].
11. **How dispatch is implemented.** In CoreCLR (the execution engine of modern .NET), virtual method calls go through a real vtable (an array of method slots per type), and virtual stub dispatch, a scheme of small generated call stubs, is used only for interface calls ✅[^botr-vsd]. Method tables, boxing and devirtualization in detail → `dotnet/runtime/object-layout-and-boxing.md`.

## Worked example
`new Order("A-1")`, where `Entity`'s constructor calls the virtual `Validate()` and `Order` overrides it. The code and its output as run in the lab ✅[^lab] follow.

```csharp
var o = new Order("A-1");
class Entity
{
    protected Entity() { Console.WriteLine($"Entity ctor calls Validate(): {Validate()}"); }
    protected virtual string Validate() => "base";
}
class Order : Entity
{
    private readonly string _id;
    private readonly List<string> _lines = new();
    public Order(string id) : base() { _id = id; Console.WriteLine($"Order ctor body: _id={_id}"); }
    protected override string Validate() => $"override sees _id={(_id ?? "null")}, _lines={(_lines is null ? "null" : "ready")}";
}
// Entity ctor calls Validate(): override sees _id=null, _lines=ready
// Order ctor body: _id=A-1
```

| Step | What runs | State of the `Order` object |
|---|---|---|
| 1 | The new object starts with every field at its default value | `_id = null`, `_lines = null` |
| 2 | `Order`'s field initializer `_lines = new()` runs, before the base call (`dotnet/type-design/members-and-initialization.md`, How it works 5) | `_lines` ready, `_id = null` |
| 3 | `Entity()` runs and calls `Validate()`; the run-time type is `Order`, so the override runs (How it works 2) | prints `_id=null, _lines=ready` |
| 4 | `Order(string id)` body assigns `_id` | `_id = "A-1"` |

A `readonly` field set in the constructor body is still `null` in step 3, so an override that trusts it throws `NullReferenceException` in real code. Fixes: pass the value to the base constructor, initialize it in a field initializer, or move the call out of the constructor (a factory or an `Initialize` method).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A struct implementing `IIncrement`, incremented twice through an `IIncrement` variable | `c.N` stays 0 while the boxed copy holds 2 ✅[^lab] | Converting a struct to an interface boxes a copy ✅[^ref-struct] |
| `Describe<SubMeters>()` where `SubMeters : MetersClass` declares `public static new string Symbol => "sub"` | Prints `m=1m`, not `sub` ✅[^lab] | `SubMeters` does not re-implement `IUnit`, so the interface still maps to `MetersClass`'s static members, chosen at compile time ✅[^ref-interface] |
| `Equals` overridden, `GetHashCode` not: three equal keys added to a `HashSet` | Count is 3; with both overridden, 1 ✅[^lab] | Hash sets compare hash codes first; the default hash is per object ✅[^api-gethashcode] |
| A key's hash-relevant field changes after it is added to a `Dictionary` | `ContainsKey` on the same object returns `False` ✅[^lab] | The entry sits in the bucket of its old hash code |
| Calling a default interface member from the implementing class's own code | Must go through the interface: in the lab `((ILogger)this).Prefix` and a local `ILogger self = this; self.Log(m)` worked, while plain `Prefix` was error CS0103 and `this.Prefix` CS1061 ✅[^lab] | Default members can be reached only through an instance of the interface ✅[^ref-interface] |
| Two interfaces with the same method, implemented by one public method | Both interfaces call that one method ✅[^guide-explicit] | Implicit implementation maps every matching interface member |
| Hash codes stored in a database or sent to another process | Values can differ between processes and platforms ✅[^api-gethashcode] | Hash codes are not permanent identifiers |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Abstract base class | Shared state and constructor logic; protected helpers | One base only; every derived type inherits its fields and constructor order |
| Interface (+ default members) | Many per type; works for structs; can evolve with default members | No instance fields; default members visible only through the interface |
| `virtual` member | Extension point for derived classes | Calls can reach derived code before it is initialized; harder to change safely |
| `sealed` class or `sealed override` | Closes the extension point; lets the JIT (just-in-time compiler) call directly (devirtualize, see `dotnet/runtime/object-layout-and-boxing.md`) | Callers cannot specialize the behaviour |
| `new` (hiding) | A derived class keeps working when a later base version adds a member with the same name ✅[^guide-versioning] | Behaviour depends on the variable's declared type; easy to misread |

## Takeaways
- Do not call virtual (or abstract) members from constructors; enable CA2214 to catch it. [rule-candidate]
- Treat warning CS0114 as an error: decide between `override` and `new` explicitly. [rule-candidate]
- Override `Equals` and `GetHashCode` together, base both on the same immutable fields, and implement `IEquatable<T>`. [rule-candidate]
- Seal classes that are not designed for inheritance.
- Prefer interfaces for capabilities and abstract classes for shared state; use explicit implementation to keep an interface member off the class's public surface.

## Verification status
- Verified: 53 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Object-oriented programming: inheritance](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/object-oriented/inheritance) — Microsoft, living. Rank 1. Backs: one direct base class, transitive inheritance, constructors and finalizers not inherited, `System.Object`. [^guide-inheritance]
- [Polymorphism](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/object-oriented/polymorphism) — Microsoft, living. Rank 1. Backs: run-time dispatch of overrides; `virtual`/`abstract` plus `override`; hidden members chosen by declared type. [^guide-polymorphism]
- [new modifier (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/new-modifier) — Microsoft, living. Rank 1. Backs: `new` hides explicitly and suppresses the warning. [^ref-new]
- [sealed (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/sealed) — Microsoft, living. Rank 1. Backs: sealed classes and `sealed override`. [^ref-sealed]
- [abstract (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/abstract) — Microsoft, living. Rank 1. Backs: abstract classes are base-only; abstract members must be implemented. [^ref-abstract]
- [base (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/base) — Microsoft, living. Rank 1. Backs: calling the base implementation and choosing the base constructor. [^ref-base]
- [Versioning with the override and new keywords](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/versioning-with-the-override-and-new-keywords) — Microsoft, living. Rank 1. Backs: a method without `new` or `override` warns and behaves as `new`; a base class can add a member with a derived member's name. [^guide-versioning]
- [Tutorial: Update interfaces with default interface methods](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interface-implementation/default-interface-methods-versions) — Microsoft, living. Rank 1. Backs: the common scenario is adding members to a released interface. [^tut-dim]
- [CA2214: Do not call overridable methods in constructors](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2214) — Microsoft, living. Rank 1. Backs: virtual calls in constructors run before the derived constructor; not enabled by default in .NET 10. [^ca2214]
- [interface (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/interface) — Microsoft, living. Rank 1. Backs: contracts; default members reachable only through the interface; static abstract and virtual members resolved at compile time. [^ref-interface]
- [Explicit interface implementation](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/interfaces/explicit-interface-implementation) — Microsoft, living. Rank 1. Backs: one method for two interfaces; explicit members callable only through the interface. [^guide-explicit]
- [Structure types (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct) — Microsoft, living. Rank 1. Backs: structs cannot inherit; boxing conversions to implemented interfaces. [^ref-struct]
- [Object.Equals](https://learn.microsoft.com/en-us/dotnet/api/system.object.equals) — Microsoft, living. Rank 1. Backs: the `Equals` contract; override `GetHashCode` with `Equals`. [^api-equals]
- [Object.GetHashCode](https://learn.microsoft.com/en-us/dotnet/api/system.object.gethashcode) — Microsoft, living. Rank 1. Backs: equal objects give equal hash codes; hash codes are not permanent. [^api-gethashcode]
- [C# version history](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) — Microsoft, living. Rank 1. Backs: covariant returns in C# 9; default interface members (C# 8) need .NET Core 3.0 runtime support; static abstract members for generic math in C# 11. [^history]
- [Virtual Stub Dispatch (Book of the Runtime)](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/botr/virtual-stub-dispatch.md) — .NET runtime team, living. Rank 1. Backs: vtables for virtual calls; stub dispatch only for interface calls. [^botr-vsd]

## Related
- `dotnet/type-design/classes-structs-and-records.md` — value equality generated for records.
- `dotnet/type-design/members-and-initialization.md` — the full construction order.
- `dotnet/type-design/extension-members-and-operators.md` — extension members, which never override.
- `dotnet/generics/generic-math.md` — `static abstract` members in practice.
- `dotnet/runtime/object-layout-and-boxing.md` — vtables, interface dispatch, devirtualization and boxing.
- `dotnet/collections-and-linq/collections.md` — how `Dictionary` and `HashSet` use `GetHashCode`.
