---
schema: knowledge-doc/v1
type: concept
topic: dotnet/delegates-and-events
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, delegates, Func, Action, multicast, method-group, lambda, natural-type, closures, display-class, static-lambda, allocation]
ranked-sources: true
---

# Delegates, lambdas and closures

## Summary
**TL;DR:** A delegate is an immutable object that holds a list of (target object, method) pairs; invoking it calls each pair in order, returns the last one's result, and stops at the first unhandled exception. Method groups and lambdas convert to delegates, and since C# 10 a lambda can have a *natural type* (`Func<…>`, `Action<…>`, or a compiler-made delegate type). A lambda that uses a local variable *captures the variable itself*, not its value: the compiler moves it into a hidden heap object shared by every lambda of that scope, so a `for` loop's closures all see one variable while `foreach` (since C# 5) gives each iteration its own. In the lab, a non-capturing lambda and (since C# 11) a static method group were cached after the first use, while an instance method group cost 64 bytes and a capturing lambda 88 bytes per conversion.
**Use this when:** a callback sees a variable's later value instead of the value at creation; a multicast `Func` returns only one result; `-=` does not remove a lambda; a hot path allocates on every `list.Sort(Compare)` or `items.Where(x => x > limit)`; or you need to know what `var f = (int x) => x * 2;` actually is.
**Not this doc:** events built on delegates → `dotnet/delegates-and-events/events.md`; variance of `Func` and `Action` and combining after a variant conversion → `dotnet/generics/variance.md`; expression trees and `IQueryable` → `dotnet/collections-and-linq/linq.md`; function pointers (`delegate*`) → `dotnet/metaprogramming/interop-and-unsafe.md`; method parameters and local functions → `dotnet/fundamentals/methods-and-parameters.md`.

## Problem
- Callbacks made in a `for` loop all print `3, 3, 3` instead of `0, 1, 2`.
- `Func<string, bool> validate = notEmpty + shortEnough;` reports `True` for an empty string, because only the last validator's answer comes back.
- `handler -= (s, e) => Log(e);` leaves the handler subscribed.
- A delegate made from a struct's method keeps returning an old value after the struct changes.
- A loop that passes an instance method to a sort or a LINQ (language-integrated query) call allocates on every iteration.

## Mental model
**Analogy:** a delegate is a speed-dial card that names who to call and which extension (target and method); a multicast delegate is a group call list, dialled top to bottom, where only the last person's answer is kept and a dropped call ends the round. A closure is not a photocopy of a variable: it is a whiteboard moved out of the room (the method) into the corridor (the heap), and every lambda made in that room reads and writes the same whiteboard, even after the room is gone.

**Artifact** (run in the lab ✅[^lab]):
```csharp
int count = 0;
Action inc = () => count++;
Func<int> get = () => count;
inc(); inc(); count += 10;
Console.WriteLine(get());                                  // 12: one shared variable
Console.WriteLine(inc.Target!.GetType().Name);             // <>c__DisplayClass0_0
Console.WriteLine(ReferenceEquals(inc.Target, get.Target)); // True: both lambdas use one object
// that object has one field: Int32 count = 12
```

## How it works
**3 actors:**
- **C# compiler** — its job: turn lambdas into ordinary methods and captured locals into fields of a hidden class, and emit the delegate creation, via code it generates into your assembly.
- **The delegate object** — its job: hold the target and method (or a list of them) and call them in order, via its `Invoke` method inherited from `System.MulticastDelegate`.
- **Runtime and JIT (just-in-time compiler)** — its job: run the call, via an indirect call to the stored method; with Dynamic PGO (profile-guided optimization) it can predict the usual target and inline it.

```
[compile time: Roslyn]                         [run time]
int count = 0;  inc = () => count++;
  │ moves 'count' into a display class
  │   class <>c__DisplayClass0_0 { int count; void <Main>b__0() => count++; }
  │ emits: d = new DisplayClass(); inc = new Action(d, &b__0)
  └────────────────────────────────────────▶ heap: DisplayClass { count } ◀── inc.Target
                                               heap: Action { Target, Method } ──▶ inc()
                                                                                    │ JIT: indirect call,
                                                                                    │ or a guarded inline
                                                                                    ▼ copy of the lambda
```

1. **Compiler — delegate types are classes.** Declaring a delegate type makes the compiler generate a class derived from `System.MulticastDelegate` with that signature ✅[^delegate-class]; delegate types are sealed ✅[^using-delegates] (lab: `sealed=True`, base `System.MulticastDelegate`, `Int32 Invoke(Int32)` ✅[^lab]). In the delegate context the signature includes the return type ✅[^pg-delegates]. `Action` and `Func` give generic definitions for most needs ✅[^ref-types], but two delegate types with the same shape are still different types: `Predicate<int>` and `Func<int, bool>` are not interchangeable ✅[^lab].
2. **Compiler — method group conversion.** A delegate made from an instance method references both the instance and the method; one made from a static method references only the method ✅[^using-delegates] (lab: `Target=null` for a static method ✅[^lab]). If the instance is a value type, it is boxed and the box becomes the target ✅[^spec-conv], so the delegate sees a copy: after `counter.N = 99` the lab's delegate still returned `0` ✅[^lab]. The conversion is permitted, but not required, to reuse an existing delegate instance ✅[^spec-conv]; C# 11 improved method group conversion to delegates ✅[^version-history].
3. **Compiler — lambdas and their natural type.** A lambda converts to a delegate type or an expression tree ✅[^lambdas]. The compiler can infer a *natural type* (since C# 10 ✅[^version-history]): it picks a suitable `Func` or `Action`, or synthesizes a delegate type, for example when a parameter is `ref`; a method group with exactly one overload has one too ✅[^lambdas]. Lambdas with default parameter values (C# 12 ✅[^version-history]) or `params` get no `Func`/`Action` natural type ✅[^lambdas]. Lab results are in the table below ✅[^lab].

   | Declaration | Natural type in the lab |
   |---|---|
   | `var parse = (string s) => int.Parse(s);` | `Func<String,Int32>` |
   | `var read = Console.Read;` | `Func<Int32>` |
   | `var bump = (ref int x) => x++;` | `<>F{00000001}<Int32,Int32>` (synthesized) |
   | `var inc = (int x, int step = 1) => x + step;` | `<>f__AnonymousDelegate0<Int32,Int32,Int32>`; `inc(5)` is `6` |
   | `var choose = object (bool b) => b ? 1 : "two";` | `Func<Boolean,Object>` (explicit return type) |
   | `var noType = s => s.Length;` | error CS8917: the delegate type could not be inferred |

   Parameter lists are all explicit or all implicit (CS0748), two or more `_` parameters are discards, and C# 14 allows modifiers such as `out` without types, as in `(text, out result) => int.TryParse(text, out result)` ✅[^lambdas] (all three checked in the lab ✅[^lab]).
4. **Compiler — capture.** Locals and parameters in scope are *outer variables*; one referenced by a lambda is *captured*, and its lifetime is extended at least until the delegate becomes eligible for garbage collection ✅[^spec-expr]. The lambda captures the variable itself, so it sees changes made after it was created ✅[^fund-lambdas]. The standard leaves the delegate's exact target object unspecified ✅[^spec-conv]; in the lab Roslyn put captured locals into a class named `<>c__DisplayClass0_0` and parked non-capturing lambdas on a singleton class named `<>c` ✅[^lab]. A lambda cannot capture `in`, `ref` or `out` parameters ✅[^lambdas] (CS1628 ✅[^lab]), and a lambda that reads an instance field captures `this` (lab: `Target is Widget` was `True` ✅[^lab]).
5. **Compiler — loops.** In `foreach`, the iteration variable is declared inside the loop body, which decides how lambdas capture it ✅[^spec-statements]; each iteration gets a new variable. That changed in C# 5; earlier compilers closed over one variable ✅[^csharplang-history]. A `for` loop declares its variable once, so closures made in it share it: `3,3,3` in the lab, `0,1,2` after copying into a variable declared in the body, `0,1,2` for `foreach` ✅[^lab].
6. **Compiler — `static` lambdas.** The `static` modifier (C# 9 ✅[^version-history]) forbids capturing locals or instance state; static members and constants stay usable ✅[^lambdas] (CS8820 in the lab ✅[^lab]).
7. **Delegate object — multicast invocation.** `+` concatenates invocation lists, and a `null` operand yields the other operand; `-` removes the last matching contiguous sublist, gives `null` if the lists are equal, and returns the left operand unchanged when nothing matches ✅[^spec-expr]. Invocation calls each entry synchronously in order with the same arguments; `ref` arguments are shared along the list, a return value or `out` value comes from the last entry, and an uncaught exception skips the rest ✅[^spec-delegates]. Invoking a `null` delegate throws `NullReferenceException` ✅[^spec-delegates]; `?.Invoke` skips the call ✅[^delegates-patterns]. A delegate can hold duplicates, and removal takes the rightmost copy ✅[^combine]. In the lab: `three + four` returned `4`, `A`, throw, `C` stopped after `A`, and `(a + b + a) - a` left `ab` ✅[^lab].
8. **Delegate object — immutability and equality.** `+=` builds a new delegate: in the lab an alias taken before `+=` still had 1 entry while the variable had 2; two separate conversions of `greeter.Hello` were `Equals` but not the same instance ✅[^lab]. Two delegates of different compile-time types do not compare at all; typed as `System.Delegate`, the comparison compiles and returns `false` ✅[^using-delegates].
9. **Runtime — cost.** Lab allocations per conversion, after warm-up (C# 14; the column on the right rebuilt with `LangVersion=10`) ✅[^lab].

   | Delegate source | C# 14 | C# 10 |
   |---|---|---|
   | static method group `Use(Holder.StaticDouble)` | 0 bytes (one 64-byte delegate on first use) | 64 bytes every time |
   | instance method group `Use(h.InstanceDouble)` | 64 bytes every time | 64 bytes every time |
   | non-capturing or `static` lambda | 0 bytes (cached) | 0 bytes (cached) |
   | lambda capturing a loop-body local | 88 bytes (display class + delegate) | 88 bytes |
   | a delegate stored in a variable and reused | 0 bytes | 0 bytes |

   Dynamic PGO can do guarded devirtualization (GDV: a check for the expected target followed by an inlined fast path) on delegate calls, as it does on virtual and interface calls ✅[^perf-net8]. In a Release build of the lab, a call through a delegate to a lambda took about 0.3 ns with PGO on and about 1.25 ns with `DOTNET_TieredPGO=0`; delegates to `[NoInlining]` methods stayed at about 1.3 to 1.6 ns, close to an interface call ✅[^lab].

## Worked example
Two validators combined with `+`, then fixed, every value measured in the lab ✅[^lab].

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | `Func<string,bool> validate = notEmpty + shortEnough;` then `validate("")` | `True` | only the last entry's return value survives (How it works 7) |
| 2 | `validate.GetInvocationList().Cast<Func<string,bool>>().Select(f => f(""))` | `[False, True]`, `All` gives `False` | call each entry yourself to see every answer |
| 3 | `Func<string,bool> all = s => notEmpty(s) && shortEnough(s);` | `all("")` `False`, `all("abc")` `True`, `all("abcdef")` `False` | compose in one lambda instead of multicasting |
| 4 | `int max = 5; limit = s => s.Length <= max; max = 2; limit("abc")` | `False` | the lambda reads `max` when it runs (How it works 4) |
| 5 | 1,000 calls of a method that builds a capturing lambda and calls it once | 88,000 bytes; the same logic as a capturing local function called directly: 0 bytes | the lambda needs a display class and a delegate on the heap |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `list - fresh` where `fresh` is a new lambda with the same body | List unchanged (`True` in the lab ✅[^lab]) | Removal compares entries for equality ✅[^spec-expr]; each lambda is its own method, so a new one never matches. Keep the delegate in a variable to remove it later |
| `Func<int> read = counter.Get;` on a struct | Sees the struct as it was when the delegate was made ✅[^lab] | The value was boxed into the target ✅[^spec-conv] |
| Two lambdas of one scope, one long-lived and one short-lived | In the lab both lambdas pointed at the same display-class object ✅[^lab], so the long-lived one can keep alive a variable that only the short-lived one used | A captured variable lives at least until the delegate is collectable ✅[^spec-expr]; how closures are grouped is the compiler's choice |
| `Delegate d = () => 42;` | Runtime type `Func<Int32>` ✅[^lab] | A lambda with a natural type converts to `Delegate` or `object` ✅[^lambdas] |
| `Expression e = (int x) => x + 1;` | Not a delegate but an `Expression<Func<int,int>>` ✅[^lambdas] | The same syntax builds a data structure for providers such as `IQueryable` |
| Attribute on a lambda | No effect when the delegate is invoked; visible through reflection ✅[^lambdas] | `Invoke` does not look at the lambda's attributes |
| `(a + b)` where `b` reached `Action<string>` from `Action<object>` | `ArgumentException` ✅[^lab] | Combination needs identical run-time types; see `dotnet/generics/variance.md` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `static` lambda, or a method group stored in a `static readonly` field | No allocation after the first in the lab ✅[^lab]; no accidental capture ✅[^lambdas] | Context must travel through parameters |
| Capturing lambda | Shortest code; reads current state | 88 bytes per creation in the lab, and lifetime extension of captured variables ✅[^lab] |
| Local function called directly | 0 bytes for a capturing local function in the lab ✅[^lab] | Converting it to a delegate allocates like a lambda |
| Interface with one method | One call path, can carry state and several members | More code; a struct implementation boxes when passed as the interface |
| Multicast delegate | Fan-out to many callbacks in one call ✅[^spec-delegates] | Only the last return value; the first exception skips the rest |

## Takeaways
- Never rely on a multicast delegate's return value; call `GetInvocationList()` entries yourself or compose one lambda. [rule-candidate]
- Copy a loop's `for` variable into a local declared inside the body before capturing it. [rule-candidate]
- Mark lambdas `static` when they need no state, and hoist instance method groups out of hot loops into a stored delegate. [rule-candidate]
- Keep a reference to any delegate you intend to remove; a second identical lambda is a different delegate.

## Verification status
- Verified: 62 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Delegates (C# programming guide)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/) — Microsoft, living. Rank 1. Backs: the signature includes the return type. [^pg-delegates]
- [Using delegates](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/using-delegates) — Microsoft, living. Rank 1. Backs: delegate types are sealed; instance versus static targets; comparison of different delegate types. [^using-delegates]
- [How to combine delegates (multicast delegates)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/how-to-combine-delegates-multicast-delegates) — Microsoft, living. Rank 1. Backs: duplicates allowed; removal takes the rightmost match. [^combine]
- [System.Delegate and the delegate keyword](https://learn.microsoft.com/en-us/dotnet/csharp/delegate-class) — Microsoft, living. Rank 1. Backs: the compiler generates a class derived from `MulticastDelegate`. [^delegate-class]
- [Common patterns for delegates](https://learn.microsoft.com/en-us/dotnet/csharp/delegates-patterns) — Microsoft, living. Rank 1. Backs: `?.Invoke` short-circuits on `null`. [^delegates-patterns]
- [Built-in reference types: the delegate type](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/reference-types) — Microsoft, living. Rank 1. Backs: `Action` and `Func` cover most needs. [^ref-types]
- [Lambda expressions and anonymous functions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/lambda-expressions) — Microsoft, living. Rank 1. Backs: conversion targets; natural type; defaults and `params`; explicit return type; discards; C# 14 modifiers; capture rules; `static` lambdas; attributes. [^lambdas]
- [Lambda expressions (C# fundamentals)](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/building-software/lambdas) — Microsoft, living. Rank 1. Backs: a lambda captures the variable itself, not a copy of its value. [^fund-lambdas]
- [C# language specification: Delegates, §21.6 Delegate invocation](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/delegates) — ECMA / Microsoft, living. Rank 1. Backs: invocation order, shared `ref` arguments, last return value, exceptions stop the list, `null` throws. [^spec-delegates]
- [C# language specification: Expressions, delegate combination and removal; §12.21.6 Outer variables](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions) — ECMA / Microsoft, living. Rank 1. Backs: `+` and `-` semantics; captured variables and their lifetime. [^spec-expr]
- [C# language specification: Conversions, §10.7.2 and §10.8 Method group conversions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/conversions) — ECMA / Microsoft, living. Rank 1. Backs: value-type targets are boxed; an existing delegate instance may be reused; the target of a lambda's delegate is unspecified. [^spec-conv]
- [C# language specification: Statements, §13.9.5 The foreach statement](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/statements) — ECMA / Microsoft, living. Rank 1. Backs: the iteration variable is declared inside the loop, which decides capture. [^spec-statements]
- [The history of C#](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) — Microsoft, living. Rank 1. Backs: `static` anonymous functions in C# 9; lambda natural type in C# 10; improved method group conversion in C# 11; optional lambda parameters in C# 12. [^version-history]
- [C# Language Feature History](https://github.com/dotnet/csharplang/blob/main/Language-Version-History.md) — .NET C# language team, living. Rank 1. Backs: C# 5 `foreach` variable per iteration. [^csharplang-history]
- [Performance Improvements in .NET 8](https://devblogs.microsoft.com/dotnet/performance-improvements-in-net-8/) — Stephen Toub, Microsoft .NET blog, 2023. Rank 4. Backs: guarded devirtualization, including of delegate calls, by Dynamic PGO. [^perf-net8]

## Related
- `dotnet/delegates-and-events/events.md` — `event` on top of multicast delegates, and the subscriber leak.
- `dotnet/generics/variance.md` — `in` and `out` on `Func` and `Action`.
- `dotnet/collections-and-linq/linq.md` — lambdas as LINQ predicates, closure capture in queries, expression trees.
- `dotnet/performance/measuring-and-reducing-allocations.md` — measuring the allocations shown above.
- `dotnet/runtime/jit-tiering-and-aot.md` — Dynamic PGO and guarded devirtualization.
