---
schema: knowledge-doc/v1
type: concept
topic: dotnet/performance
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, ref-locals, ref-returns, in-parameters, ref-readonly, defensive-copy, ref-struct, ref-fields, scoped, unscopedref, allows-ref-struct, escape-analysis, cs8352]
ranked-sources: true
---

# ref safety, ref locals and ref structs

## Summary
**TL;DR:** A `ref` is an alias for a storage location: a `ref` local or `ref` return lets code read and write an array element or field in place, and `in` / `ref readonly` pass large structs without copying. The compiler gives every expression two lifetimes, a *safe context* for its value and a *ref-safe context* for references to it, and rejects any code that could let a reference outlive what it points at (CS8168, CS8352 and friends). A `ref struct` such as `Span<T>` may hold references into the stack, so it must itself stay on the stack: no boxing, no class fields, no capture by lambdas, no survival across `await` or `yield`. C# 11 added `ref` fields and `scoped`; C# 13 let `ref struct` types implement interfaces, be generic arguments (`allows ref struct`) and appear in async and iterator methods outside the suspension points.
**Use this when:** you get a CS8352, CS8168, CS8345, CS4007 or CS9244 error; you are writing a type that holds a `Span<T>`; you want to return a reference instead of a copy; or a mutation through an `in` parameter or a `readonly` field silently does nothing.
**Not this doc:** what `Span<T>` and `Memory<T>` are and how to use them → `dotnet/performance/span-and-memory.md`; `ref`, `out` and `in` as everyday parameter modifiers → `dotnet/fundamentals/methods-and-parameters.md`; struct design (`readonly struct`, records) → `dotnet/type-design/classes-structs-and-records.md`; pointers and `unsafe` → `dotnet/metaprogramming/interop-and-unsafe.md`.

## Problem
Without references, struct-heavy code copies data everywhere; with references, it could point at memory that no longer exists. The C# rules that stop the second problem produce errors that look arbitrary until the model is clear:
- Returning a `stackalloc` span is `error CS8352`, but returning a span over an array parameter is fine.
- `static ref int Bad() { int x = 1; return ref x; }` is `error CS8168`.
- A `Span<int>` field in a class is `error CS8345`; passing a span to `object Id<T>(T x)` is `error CS9244`.
- `c.Increment()` on an `in Counter c` parameter compiles, runs, and leaves the counter at 0.

## Mental model
**Analogy:** a library card that points at a shelf. A `ref` is the card: whoever holds it can read and rearrange that shelf. The rule is that a card may never be handed to someone who will still hold it after the shelf is torn down. Shelves in the main building (the heap, static fields, the caller's variables) outlive the current method; a folding shelf set up for this method (a local, a `stackalloc` buffer) is torn down when it returns. A `ref struct` is a bag of cards, so the bag obeys the same rule: it may not be put in a long-term locker (a class field or a box) or kept over a break (`await`, `yield`).

**Artifact** (run in the lab ✅[^lab]):
```csharp
int[] scores = [10, 20, 30];
ref int slot = ref Find(scores, 20);   // an alias of scores[1]
slot = 99;
Console.WriteLine(string.Join(", ", scores));   // 10, 99, 30
int copy = Find(scores, 30); copy = -1;         // a plain local copies: scores unchanged
static ref int Find(int[] a, int v) { for (int i = 0; i < a.Length; i++) if (a[i] == v) return ref a[i]; throw new InvalidOperationException(); }
// static ref int Bad() { int x = 1; return ref x; }   // error CS8168: Cannot return local 'x' by reference because it is not a ref local
```

## How it works
1. **References and their two lifetimes.** A `ref` local (`ref int alias = ref variable;`) is a reference variable that refers to another variable's storage ✅[^declarations], and a `ref` return hands the caller a reference to a storage location instead of a value ✅[^perf-index]. For every expression the compiler tracks a *safe-context* (where the value may be used) and a *ref-safe-context* (where a reference to it may be used); assignment is checked against the first, ref assignment (`= ref`) against the second ✅[^method-params]. A local's ref-safe-context is its method, so returning it by reference is CS8168; returning an element of an array parameter is fine because the array lives on the heap ✅[^err-ref-safety] ✅[^lab].
2. **Read-only references: `in` and `ref readonly`.** Both pass by reference and forbid reassignment; `ref readonly` (C# 12) says the method uses the argument as a variable (it may keep or return the reference), `in` is the more flexible choice otherwise ✅[^perf-index]. For an `in` parameter the compiler may create a temporary copy of the argument, for example when it must be converted or is not a variable ✅[^method-params]. In the lab, passing a plain value to `ref readonly` gave warning CS9193, passing a variable without `in` or `ref` gave CS9192, and assigning to an `in` parameter was error CS8331 ✅[^lab].
3. **Defensive copies.** When a `readonly` member of a struct calls a non-`readonly` member, the compiler runs the call on a copy, so the original is not modified ✅[^struct-doc]. The same happens to a mutable struct reached through an `in` parameter or a `readonly` field: in the lab, `c.Increment()` inside `BumpIn(in Counter c)` printed 0 afterwards, a `readonly Counter` field stayed 0 after `_c.Increment()`, and `ref Counter` worked ✅[^lab]. No warning is emitted for either ✅[^lab]. A `readonly struct`, or `readonly` members, make the copy unnecessary.
4. **What makes a `ref struct`.** A `ref struct` lives only on the stack, so the compiler forbids using it as an array element, as a field of a class or of a non-`ref` struct, boxing it to `object` or `ValueType`, and capturing it in a lambda or local function ✅[^ref-struct]. In the lab these gave CS8345 (field in a class), CS0029 (conversion to `object`), CS8175 (captured by a lambda) and CS9244 (type argument without `allows ref struct`) ✅[^lab].
5. **Async and iterators, C# 13.** Before C# 13 a `ref struct` local could not appear in an `async` method or an iterator; since C# 13 it can, as long as it is not used across an `await` or in a segment with `yield return` ✅[^ref-struct] ✅[^cs13]. The async state machine keeps locals on the heap, so a span that must survive an `await` is CS4007, and a span parameter on an async method is CS4012 ✅[^err-async] ✅[^lab]. The lab compiled a span inside its own block after an `await`, and a `stackalloc` span inside an iterator block before `yield return` ✅[^lab].
6. **Interfaces and generics, C# 13.** A `ref struct` may implement interfaces, but it can never be converted to the interface type, because that would box it ✅[^ref-struct]; `IDisposable d = new R();` was CS0029 in the lab ✅[^lab]. The interface members are reachable through a generic method whose type parameter `allows ref struct` ✅[^ref-struct] ✅[^cs13]; the lab's `Measure<T>(T item) where T : IHasLength, allows ref struct` returned 4 for a `ref struct` wrapping a four-element span ✅[^lab].
7. **`ref` fields, C# 11.** A `ref struct` can declare a `ref` field, which can also be `readonly ref`, `ref readonly` or `readonly ref readonly`; the compiler ensures the stored reference does not outlive its referent, and this is how `Span<T>` is implemented ✅[^ref-struct]. A `ref` field outside a `ref struct` is CS9059 ✅[^err-ref-struct]. The lab's `ref struct Cursor { ref int _target; … }` incremented a local through the field: 5 became 7 after two calls ✅[^lab].
8. **`scoped`.** The `scoped` modifier restricts the safe-context or ref-safe-context of a parameter or local to the current method; it applies to `ref struct` values and to reference variables, and is implied for `this` in struct methods, for `out` parameters, and for `ref` parameters of `ref struct` type ✅[^declarations]. Marking a span parameter `scoped` asserts that the method does not extend its lifetime ✅[^declarations], so callers may pass a `stackalloc` span; returning it then breaks that promise, and this compiler reported CS8352 ✅[^lab].
9. **`[UnscopedRef]`.** `System.Diagnostics.CodeAnalysis.UnscopedRefAttribute` lets one of those implicitly scoped references escape, typically `this` in a struct instance method ✅[^api-unscopedref]. Without it, `public ref int X() => ref _x;` in a struct was CS8170; with it, `box.First() = 42` wrote the field ✅[^lab]. Applying it where the reference is already unscoped is CS9063 ✅[^err-ref-mod].

## Worked example
Why `return s;` is legal or not, for the same method shape `Span<int> M(...)`, as the lab's C# 14 compiler (Roslyn 5.9.0) reported ✅[^lab].

| Step | Code | Safe-context of the returned value | Result |
|---|---|---|---|
| 1 | `Span<int> M(int[] a) => a;` (C# 14 implicit array-to-span conversion) | the array lives on the heap: caller's context | compiles |
| 2 | `Span<int> M() { Span<int> s = stackalloc int[4]; return s; }` | the `stackalloc` buffer dies with `M` | `error CS8352: Cannot use variable 's' in this context because it may expose referenced variables outside of their declaration scope` |
| 3 | `Span<int> M(scoped Span<int> s) => s;` | `scoped` limits `s` to `M` | `error CS8352: Cannot use variable 'scoped Span<int> s' …` |
| 4 | `void Fill(ref Span<int> target) { Span<int> local = stackalloc int[8]; target = local; }` | `target` outlives `Fill`, `local` does not | `error CS8352: Cannot use variable 'local' …` |
| 5 | `async Task Run() { Span<int> s = new int[3]; await Task.Yield(); Use(s); }` | `s` must survive the `await` in the heap state machine | `error CS4007: Instance of type 'System.Span<int>' cannot be preserved across 'await' or 'yield' boundary.` |
| 6 | Same method with the span declared in a block after the `await` | `s` never crosses the suspension | compiles and prints `7` |

The rule behind every row is step 1 of How it works: a value may flow only to places whose lifetime is no longer than its own safe-context.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| CS8352 is the error this compiler gives for most escapes ✅[^lab] | The ref-safety errors page lists CS8166–CS8169, CS8345, CS8348–CS8351, CS8374 and CS9075–CS9097 but not CS8352 (checked 2026-11-24) ✅[^err-ref-safety] | Search the error text, not the code, when the page does not have it |
| A `ref struct` local used before an `await` in the same block, and not after it | Compiled and ran in Debug and Release builds ✅[^lab]; using it after the `await` was CS4007 ✅[^lab] | What's new in C# 13 forbids only access across an `await` ✅[^cs13]; the `ref struct` page words it more strictly, "can't be used in the same block as the `await`" ✅[^ref-struct] |
| Defensive copy through an `in` parameter or a `readonly` field | Mutation lost, no warning ✅[^lab] | The call runs on a copy ✅[^struct-doc] |
| A `ref struct` implementing `IDisposable` | Works in `using`; the pattern `Dispose` is preferred over the interface method ✅[^ref-struct] | Conversion to `IDisposable` is still impossible ✅[^ref-struct] |
| Adding a default interface member to an interface that a `ref struct` implements | Source break on recompile, and a runtime exception if old binaries call the new member ✅[^ref-struct] | A `ref struct` must implement every instance member, even ones with default bodies ✅[^ref-struct] |
| `scoped` on a non-ref, non-`ref struct` value | Error CS9048 ✅[^err-ref-struct] | `scoped` only means something for references and `ref struct` values |
| Lambda capturing a `Span<T>` local | `error CS8175: Cannot use ref local 's' inside an anonymous method, lambda expression, or query expression` ✅[^lab] | A closure object lives on the heap ✅[^err-lambda] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `ref` return / `ref` local | Update in place, no copy of large structs | The caller can modify your storage; lifetime rules apply |
| `in` parameter | No copy of a large struct; call sites unchanged | Defensive copies for mutable structs; the compiler may still copy ✅[^method-params] |
| `ref readonly` parameter | States that the method keeps or returns the reference ✅[^perf-index] | Callers get CS9192/CS9193 warnings for values ✅[^lab] |
| `ref struct` type | Can hold spans and `ref` fields; never allocates | No fields in classes, no boxing, limited in async and iterators |
| `[UnscopedRef]` | Return references to struct fields | Changes the API's (application programming interface's) lifetime contract for every caller ✅[^api-unscopedref] |

## Takeaways
- Make structs that are passed by `in` or stored in `readonly` fields `readonly struct`, or their mutating calls run on hidden copies. [rule-candidate]
- Mark span parameters `scoped` when the method does not keep them, so callers may pass `stackalloc` memory.
- Read CS8352 as "this reference could outlive its storage" and look for the shortest-lived input on that line. [rule-candidate]
- Use `allows ref struct` generic methods, not interface parameters, to reach the interfaces a `ref struct` implements.

## Verification status
- Verified: 53 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Declaration statements: reference variables and scoped ref](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/declarations) — Microsoft, living. Rank 1. Backs: `ref` locals; what `scoped` restricts and promises, where it applies and where it is implied. [^declarations]
- [Method parameters and modifiers](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/method-parameters) — Microsoft, living. Rank 1. Backs: safe-context and ref-safe-context; `in` may create a temporary. [^method-params]
- [Avoid memory allocations and data copies](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/performance/) — Microsoft, living. Rank 1. Backs: `ref` returns; `in` versus `ref readonly`. [^perf-index]
- [Structure types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct) — Microsoft, living. Rank 1. Backs: a `readonly` member calling a non-`readonly` one works on a copy. [^struct-doc]
- [ref struct types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/ref-struct) — Microsoft, living. Rank 1. Backs: the restrictions; C# 13 async, iterator, interface and generic changes; `ref` fields; disposal; the default-member break. [^ref-struct]
- [What's new in C# 13](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) — Microsoft, 2024. Rank 1. Backs: `ref` locals and `ref struct` in async and iterators; `allows ref struct`. [^cs13]
- [Errors and warnings related to ref safety](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/ref-safety-errors) — Microsoft, living. Rank 1. Backs: CS8168; the codes the page lists. [^err-ref-safety]
- [Errors and warnings associated with ref struct types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/ref-struct-errors) — Microsoft, living. Rank 1. Backs: CS9059; CS9048. [^err-ref-struct]
- [Errors and warnings associated with reference parameters](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/ref-modifiers-errors) — Microsoft, living. Rank 1. Backs: CS9063. [^err-ref-mod]
- [Errors and warnings for async and await](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/async-await-errors) — Microsoft, living. Rank 1. Backs: CS4007 and CS4012; the async state machine keeps locals on the heap. [^err-async]
- [Errors and warnings for lambda expressions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/lambda-expression-errors) — Microsoft, living. Rank 1. Backs: CS8175. [^err-lambda]
- [UnscopedRefAttribute class](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.codeanalysis.unscopedrefattribute) — Microsoft, living. Rank 1. Backs: lets an implicitly scoped reference escape; affects every consumer. [^api-unscopedref]

## Related
- `dotnet/performance/span-and-memory.md` — the types these rules protect.
- `dotnet/fundamentals/methods-and-parameters.md` — `ref`, `out`, `in` and `ref readonly` as parameter modifiers.
- `dotnet/type-design/classes-structs-and-records.md` — `readonly struct` and struct copy semantics.
- `dotnet/generics/generics-and-constraints.md` — the `allows ref struct` anti-constraint among the other constraints.
- `dotnet/errors-and-resources/disposal-and-finalization.md` — pattern-based `using` for `ref struct` types.
