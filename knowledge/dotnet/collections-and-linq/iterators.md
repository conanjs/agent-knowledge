---
schema: knowledge-doc/v1
type: concept
topic: dotnet/collections-and-linq
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, foreach, ienumerable, ienumerator, yield, iterator, state-machine, deferred-execution, struct-enumerator, dispose]
ranked-sources: true
---

# Iterators, `foreach` and `yield`

## Summary
**TL;DR:** `foreach` is compiled into calls to `GetEnumerator()`, `MoveNext()` and `Current` inside a `try`/`finally` that disposes the enumerator. The lookup is by pattern, not by interface, so a collection can hand out a struct enumerator and the loop allocates nothing. A method that uses `yield return` is compiled into a hidden state-machine class: calling it runs none of its code, the body runs piece by piece on each `MoveNext`, so argument checks inside it fire late, a `finally` runs only when the loop ends or the enumerator is disposed, and every new enumeration runs the body again.
**Use this when:** an argument check in a sequence-returning method throws far from the call, a `finally` or `using` inside an iterator does not run, a sequence does its work twice, a `foreach` allocates when you expected it not to, or the compiler rejects a `yield` with CS1626, CS1625 or CS4007.
**Not this doc:** which collection to use → `dotnet/collections-and-linq/collections.md`; LINQ (language-integrated query) operators, which are iterators too → `dotnet/collections-and-linq/linq.md`; `IAsyncEnumerable<T>` and `await foreach` → `dotnet/async/cancellation-valuetask-and-async-streams.md`; lambda capture in general → `dotnet/delegates-and-events/delegates-lambdas-and-closures.md`.

## Problem
Iterators look like ordinary methods that return a collection, but they run on a different schedule:
- `TakeEvery(null, 2)` returns without an exception; the `ArgumentNullException` appears later, inside some `foreach` far away.
- A `try`/`finally` inside an iterator never prints its `finally` line when the caller reads two items by hand.
- `seq.Count()` followed by `seq.Sum()` runs the iterator body twice, repeating any side effect (a log line, a database query).
- The same `foreach` allocates 0 bytes over a `List<int>` variable and 40 bytes over the same list typed `IEnumerable<int>`.
- `yield return` inside a `try` block with a `catch` does not compile.

## Mental model
**Analogy:** an iterator method is a recipe card, not a cooked dish. Calling the method hands you the card (an enumerable object); nothing is cooked yet. Each `MoveNext` is "cook until the next plate is ready": the cook works up to the next `yield return`, puts the plate out (`Current`) and freezes in place, remembering every half-done step. Asking for the dish again (a second `foreach`) starts the recipe from the top. Leaving early (`break`) is telling the cook to stop: the cook still cleans the kitchen (the `finally` blocks), but only if someone actually says "stop" (`Dispose`).

**Artifact** (run in the lab ✅[^lab]):
```csharp
static IEnumerable<int> Numbers(int upTo)
{
    Console.WriteLine("  [body] started");
    try
    {
        for (int i = 1; i <= upTo; i++) { Console.WriteLine($"  [body] yield {i}"); yield return i; }
    }
    finally { Console.WriteLine("  [body] finally"); }
}
var seq = Numbers(3);       // prints nothing; seq is a <<<Main>$>g__Numbers|0_0>d object
foreach (var n in seq) { Console.WriteLine($"   got {n}"); break; }
//   [body] started
//   [body] yield 1
//    got 1
//   [body] finally         <- run by the Dispose call that foreach makes on break
```

## How it works
Four actors take part in one `foreach` over an iterator:
- **Compiler (Roslyn, the C# compiler)** — its job: rewrite each `foreach` into enumerator calls, via the expansion the C# standard defines, and rewrite each iterator method into a hidden class, via a generated state machine.
- **The loop (the caller's compiled code)** — its job: pull one element at a time, via `MoveNext()` and `Current`, and clean up, via `Dispose()` in a `finally`.
- **Enumerator object (the state machine)** — its job: run the iterator body up to the next `yield`, via a state number and fields that hold the saved locals.
- **Data source (whatever the body reads)** — its job: provide values, via its own API (application programming interface), only when the body asks.

```
caller (compiled foreach)            enumerator object (state machine)           iterator body
-------------------------            ---------------------------------           -------------
var seq = Numbers(3) ─────────────▶  new <Numbers>d, state = before              (not run)
e = seq.GetEnumerator() ──────────▶  returns itself the first time
e.MoveNext() ─────────────────────▶  state = running ───────────────────────▶  runs to yield return 1
                       ◀─ true ────  Current = 1, state = suspended ◀────────  frozen, locals saved
loop body, then break
finally: e.Dispose() ─────────────▶  state = running ───────────────────────▶  runs finally blocks
                                     state = after
```

1. **Compiler: `foreach` is pattern-based.** For `foreach (V v in x)`, the compiler first looks for a public instance `GetEnumerator()` on `x`'s type whose return type has a readable `Current` and a `bool MoveNext()`; only if that fails does it use `IEnumerable<T>`, then `IEnumerable` ✅[^spec-statements]. The `GetEnumerator` method may also be an extension method ✅[^ref-iteration], which is tried after the interfaces: a type that implemented `IEnumerable<int>` explicitly and also had an extension `GetEnumerator` was enumerated through the interface in the lab ✅[^lab]. A type with no interfaces at all works, and an extension method makes `foreach (var i in 1..4)` compile once a `GetEnumerator(this Range r)` exists ✅[^lab].
2. **Compiler: the expansion.** The loop becomes `E e = x.GetEnumerator(); try { while (e.MoveNext()) { V v = (V)(T)e.Current; … } } finally { dispose e }` ✅[^spec-statements]. The `finally` calls `Dispose()` when the enumerator type converts to `IDisposable`; a ref struct enumerator is disposed through a pattern-based `Dispose()` method ✅[^spec-statements]. In the lab, a class enumerator with a `Dispose()` method but no `IDisposable` was not disposed, while a ref struct enumerator with the same method was ✅[^lab].
3. **The loop: struct enumerators avoid allocation.** Because the lookup is by pattern, `List<int>.GetEnumerator()` returns `List<int>.Enumerator`, a value type ✅[^lab]. An implementation may also compile a `foreach` differently, for example for performance, as long as the behaviour matches the expansion ✅[^spec-statements]. In the lab, `foreach` over a `List<int>` variable and over an `int[]` allocated 0 bytes; over the same list typed `IEnumerable<int>`, the loop has to call `IEnumerable<int>.GetEnumerator()`, which returns an `IEnumerator<int>` object, and it allocated 40 bytes ✅[^lab].
4. **The loop: one iteration variable per iteration.** The standard places `V v` inside the `while`, so a lambda that captures `v` keeps that iteration's value; earlier versions of C# declared it outside the loop ✅[^spec-statements]. `v` is read-only unless declared `ref`; `foreach (ref var p in span)` writes through to the elements ✅[^spec-statements] (the lab set `points[0].X` to 99 that way ✅[^lab]). If the explicit type `V` does not match an element at run time, the conversion throws `InvalidCastException` ✅[^ref-iteration], and `foreach` over `null` throws `NullReferenceException` ✅[^ref-iteration].
5. **Compiler: an iterator method becomes a state machine.** A method, operator or accessor whose body contains `yield` and whose return type is `IEnumerable`, `IEnumerable<T>`, `IEnumerator` or `IEnumerator<T>` is an iterator ✅[^spec-classes]. Calling it does not run its body: it creates an object that saves the arguments and starts in the **before** state ✅[^spec-classes]. The generated class is nested in the containing type, private, and has a name reserved for the compiler ✅[^spec-classes]; the lab saw `<<<Main>$>g__Numbers|0_0>d`, which implements `IEnumerator<int>` and `IDisposable` as well as `IEnumerable<int>` ✅[^lab].
6. **Enumerator object: four states.** `MoveNext` in **before** runs the body from the start; at a `yield return` it stores the value in `Current`, saves every local and the position, moves to **suspended** and returns `true`, without running enclosing `finally` blocks ✅[^spec-classes]. The next `MoveNext` resumes right after that `yield return`. A `yield break`, the end of the body or an escaping exception moves it to **after** (running `finally` blocks on the way), and `MoveNext` then returns `false` ✅[^spec-classes]. `Reset()` is not supported and throws `NotSupportedException` ✅[^spec-classes].
7. **Enumerator object: `Dispose` runs the pending `finally` blocks.** Disposing a **suspended** enumerator executes its `finally` blocks as if the last `yield return` were a `yield break` ✅[^spec-classes]. `using` inside an iterator works for the same reason: it compiles to `try`/`finally` without `catch` ✅[^ref-yield]. If nobody calls `Dispose`, those blocks never run: in the lab, two manual `MoveNext` calls without `Dispose` printed no `finally` line until `Dispose` was called ✅[^lab].
8. **Compiler: where `yield` may not appear.** Neither form may appear in a `finally` block or in a lambda or anonymous method, and `yield return` may not appear anywhere in a `try` statement that has a `catch` clause, its `catch` blocks included ✅[^spec-statements]; neither may appear in a method with `ref`, `in` or `out` parameters ✅[^ref-yield]. A `yield break` in a `try` or `catch` block is allowed (Edge cases). Since C# 13, an iterator may declare `ref` locals and `ref struct` locals such as `ReadOnlySpan<char>`, as long as they are not used across a `yield return` ✅[^csharp13]; the lab compiled such an iterator and got CS4007 when a span was used after a `yield` ✅[^lab].
9. **Enumerable object: each enumeration starts over.** `GetEnumerator` returns an enumerator initialized from the saved arguments; the first call may hand back the enumerable object itself to save an allocation, and later calls create new ones ✅[^spec-classes]. The lab saw exactly that: the first `GetEnumerator()` returned the same object, the second a new one ✅[^lab]. So each `foreach`, `Count()` or `Sum()` runs the body again ✅[^ref-iterators]; analyzer rule CA1851 reports possible multiple enumerations of an `IEnumerable`, but it is not enabled by default in .NET 10 ✅[^ca1851].

## Worked example
Moving a guard clause out of an iterator, with values from the lab ✅[^lab]. Both versions read every third element; the first validates inside the iterator body, the second uses the split-method pattern: a normal method validates and returns a local iterator function.

```csharp
static IEnumerable<T> TakeEvery<T>(IEnumerable<T> source, int step)
{
    ArgumentNullException.ThrowIfNull(source);             // runs at the call
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(step);
    return Core(source, step);
    static IEnumerable<T> Core(IEnumerable<T> source, int step)
    {
        int i = 0;
        foreach (var x in source) if (i++ % step == 0) yield return x;
    }
}
```

| Step | Call | Checks inside the iterator (`TakeEveryLazy`) | Split method (`TakeEvery`) |
|---|---|---|---|
| 1 | `TakeEvery…<int>(null!, 2)` | returns an enumerable object, no exception | throws `ArgumentNullException` at once |
| 2 | `foreach` over the step 1 result | first `MoveNext` throws `ArgumentNullException` (param `source`) | (never reached) |
| 3 | `TakeEvery…(new[] { 1 }, 0)` | no exception at the call; `ArgumentOutOfRangeException` at the first `MoveNext` | `ArgumentOutOfRangeException: step ('0') must be a non-negative and non-zero value.` |
| 4 | `TakeEvery(Enumerable.Range(1, 7), 3)` | `1,4,7` | `1,4,7` |
| 5 | `Enumerable.Select<int,int>(null!, x => x)` | — | the BCL (base class library) operator throws `ArgumentNullException` at the call: LINQ validates eagerly the same way |

Step 2 is the bug pattern: the stack trace points into the consumer's loop, far from the caller that passed `null`. The split method gives the iterator body nothing to validate.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `yield return` in `try` with `catch` | error CS1626 "Cannot yield a value in the body of a try block with a catch clause" ✅[^lab] | The language forbids it ✅[^ref-yield]; move the risky call into a helper method with its own `try`/`catch` |
| `yield` in `finally`, in a lambda, or with a `ref` parameter | CS1625, CS1621, CS1623 ✅[^lab] | Same list of restrictions ✅[^ref-yield] |
| `yield break` in a `catch` block, or in a `try` block that has a `catch` | Compiles, and the iteration ends there ✅[^lab] | The standard forbids only `yield return` in such a `try` statement ✅[^spec-statements]. The `yield` reference page (Rank 1) lists both forms as forbidden there ✅[^ref-yield]; SDK 10.0.401 follows the standard |
| `ReadOnlySpan<char>` local used after a `yield return` | CS4007 "Instance of type 'System.ReadOnlySpan<char>' cannot be preserved across 'await' or 'yield' boundary." ✅[^lab] | Ref struct locals may not be used across a `yield return` ✅[^csharp13]; locals that cross one are saved in the enumerator object (How it works 6) |
| Reading an iterator by hand and never calling `Dispose` | Its `finally` and `using` cleanup never run ✅[^lab] | Only `Dispose` or reaching the end runs them (How it works 7); `foreach` does it for you |
| `((IEnumerator)e).Reset()` on an iterator | `NotSupportedException` ✅[^lab] | Iterators do not support `Reset` ✅[^spec-classes]; call the method again instead |
| `foreach (string s in new object[] { "a", 1 })` | Prints `a`, then `InvalidCastException` ✅[^lab] | The explicit iteration type is a cast per element ✅[^ref-iteration] |
| `Count()` then `Sum()` on an iterator | The body ran twice ✅[^lab] | Each call enumerates from the start (How it works 9); call `ToList()` once if the work must not repeat |
| CA1851 with `AnalysisMode=All` | Reported for a method in a class, not for the same code in a static local function in top-level statements ✅[^lab] | Observed in SDK (software development kit) 10.0.401; the docs do not say which methods the rule analyzes |
| Exception thrown in the iterator body | Surfaces from the `MoveNext` call that ran that code, not from the method call ✅[^ref-exceptions] | The body runs only during `MoveNext` (How it works 6) |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Iterator (`yield return`) | No buffer; the caller can stop early ✅[^ref-iterators] | Deferred checks and side effects; re-runs on each enumeration; one state-machine allocation per call |
| Return a filled `List<T>` or array | A stable snapshot, indexing, safe repeated enumeration ✅[^ref-iterators] | All the work and memory up front, even if the caller reads one item |
| Split method (validate, then return a local iterator) | Errors surface at the call | A second method per iterator |
| Struct enumerator through a concrete type | `foreach` allocates nothing ✅[^lab] | Lost as soon as the value is typed as an interface |

## Takeaways
- Validate the arguments of a sequence-returning method in a non-iterator wrapper and put the `yield` loop in a local function. [rule-candidate]
- Consume iterators with `foreach` or LINQ, which dispose the enumerator; if you call `GetEnumerator()` yourself, wrap it in `using`. [rule-candidate]
- Materialize with `ToList()` or `ToArray()` before enumerating a sequence more than once when producing it costs work or has side effects. [rule-candidate]
- Keep hot loops on concrete collection types (`List<T>`, arrays) so `foreach` uses the struct enumerator.

## Verification status
- Verified: 55 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [C# standard: Statements (§13.9.5 The foreach statement, §13.15 The yield statement)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/statements) — ECMA TC49-TG2 / Microsoft, living. Rank 1. Backs: pattern-based lookup order, the expansion, disposal rules, per-iteration variable, `ref` iteration variables, implementations may differ; where `yield return` and `yield break` may appear. [^spec-statements]
- [C# standard: Classes (§15.15 Synchronous and asynchronous iterators)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes) — ECMA TC49-TG2 / Microsoft, living. Rank 1. Backs: iterator return types, enumerator states, `yield return`/`yield break` semantics, `Dispose`, no `Reset`, compiler-generated class, `GetEnumerator` reuse. [^spec-classes]
- [Iteration statements (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements) — Microsoft, living. Rank 1. Backs: `GetEnumerator` may be an extension method; `InvalidCastException` for an explicit iteration type, `NullReferenceException` for `null`. [^ref-iteration]
- [yield statement (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/yield) — Microsoft, living. Rank 1. Backs: where `yield` is not allowed; `using` inside iterators. [^ref-yield]
- [Iterators](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/building-software/iterators) — Microsoft, living. Rank 1. Backs: deferred execution, each enumeration runs the iterator again, iterator versus collection. [^ref-iterators]
- [Exception-handling statements (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/exception-handling-statements) — Microsoft, living. Rank 1. Backs: an exception in an iterator reaches the caller only when the iterator advances. [^ref-exceptions]
- [What's new in C# 13](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) — Microsoft, living. Rank 1. Backs: `ref` and `ref struct` locals in iterators, not across `yield return`. [^csharp13]
- [CA1851: Possible multiple enumerations of IEnumerable collection](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1851) — Microsoft, living. Rank 1. Backs: the rule exists since .NET 7 and is not enabled by default in .NET 10. [^ca1851]

## Related
- `dotnet/collections-and-linq/collections.md` — the collections `foreach` walks, and what changing them mid-loop does.
- `dotnet/collections-and-linq/linq.md` — LINQ operators are iterators: deferred execution and multiple enumeration at scale.
- `dotnet/async/cancellation-valuetask-and-async-streams.md` — `IAsyncEnumerable<T>`, async iterators and `await foreach`.
- `dotnet/async/tasks-and-async-await.md` — the other compiler-generated state machine.
- `dotnet/performance/ref-safety-and-ref-structs.md` — why ref struct locals cannot cross a `yield`.
