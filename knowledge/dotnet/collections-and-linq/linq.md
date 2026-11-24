---
schema: knowledge-doc/v1
type: concept
topic: dotnet/collections-and-linq
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", ".NET 11.0.0 (container lab, SDK 11.0.100) for the tuple-returning `LeftJoin`"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, linq, deferred-execution, iqueryable, expression-trees, query-syntax, countby, aggregateby, leftjoin, shuffle, performance]
ranked-sources: true
---

# LINQ: deferred execution, `IEnumerable<T>` versus `IQueryable<T>`

## Summary
**TL;DR:** LINQ (Language-Integrated Query) is a set of extension methods (`Where`, `Select`, `OrderBy`, …) plus a query syntax that the compiler turns into calls to them. Operators that return a sequence only describe the work: it runs each time the result is enumerated, reads the source and any captured variables as they are at that moment, and runs again on every enumeration. On `IEnumerable<T>` the lambdas are compiled delegates run in your process; on `IQueryable<T>` they become expression trees, data that a provider (such as a database driver) translates into its own query language, such as SQL (Structured Query Language). Which of the two you get depends on the static type of the variable, not the object.
**Use this when:** a query returns different results than at the line that defined it, a selector or a database query runs more often than expected, a filter runs on the client instead of the server, a query fails with "Sequence contains no elements", or you want to know which operators .NET 6–10 added.
**Not this doc:** how iterators and `yield` work underneath → `dotnet/collections-and-linq/iterators.md`; the collections LINQ reads → `dotnet/collections-and-linq/collections.md`; lambdas and captured variables in general → `dotnet/delegates-and-events/delegates-lambdas-and-closures.md`; PLINQ (parallel LINQ) → `dotnet/concurrency/threads-and-the-thread-pool.md`; allocation-free hot paths → `dotnet/performance/measuring-and-reducing-allocations.md`.

## Problem
LINQ reads like a statement that computes a result, so its timing surprises people:
- A query defined before `nums.Add(9)` includes the 9 when it is printed afterwards.
- `threshold = 4` after defining `nums.Where(n => n > threshold)` changes what the query returns.
- `projected.Count()` followed by `projected.Sum()` runs the `Select` lambda 8 times for 4 items.
- A query against a database loads the whole table because one variable was typed `IEnumerable<T>`.
- `Select(x => 10 / x)` with a zero in the data throws `DivideByZeroException` only inside the later `foreach`.

## Mental model
**Analogy:** a LINQ query is a recipe, not a meal. Writing `nums.Where(...).OrderBy(...)` writes down the steps; nothing is cooked until someone sits down to eat (`foreach`, `ToList()`, `Count()`). Every time someone eats, the recipe is cooked again from whatever is in the fridge at that moment (the source collection and the variables the lambdas mention). With `IQueryable<T>` you hand the recipe to a restaurant instead: the kitchen (the provider) reads it and cooks in its own way, for example as SQL, so the recipe must use only steps that kitchen understands.

**Artifact** (run in the lab ✅[^lab]):
```csharp
var nums = new List<int> { 5, 1, 4 };
var query = from n in nums where n > 2 orderby n select n * 10;   // nothing runs here
// same as: nums.Where(n => n > 2).OrderBy(n => n).Select(n => n * 10)
Console.WriteLine(string.Join(",", query));   // 40,50
nums.Add(9);
Console.WriteLine(string.Join(",", query));   // 40,50,90  (the query ran again, on the new data)
```

## How it works
Four actors take part:
- **Compiler (Roslyn)** — its job: turn query syntax into method calls, via a purely syntactic translation, and turn each lambda into a delegate or an expression tree, via the target parameter type.
- **`System.Linq.Enumerable` (LINQ to Objects)** — its job: wrap the source in an object that remembers the arguments, via one iterator object per operator.
- **`System.Linq.Queryable` plus a query provider** — its job: record the call as an expression-tree node, via `IQueryable<T>.Expression`, and execute the tree, via the provider's own translation.
- **The consumer** — its job: trigger execution, via `foreach`, `ToList()`, or any operator that returns a single value.

```
query syntax / method calls ── compiler ──▶ Enumerable.Where(src, Func<T,bool>)     → delegate, runs in-process
                                         └▶ Queryable.Where(src, Expression<Func<…>>) → tree node
                                                        │
consumer: foreach / ToList / Count ─────────────────────┘
   IEnumerable<T>: MoveNext runs each operator's code, element by element
   IQueryable<T>:  provider reads the whole tree, translates it (e.g. to SQL), runs it ═══▶ data source
```

1. **Compiler: query syntax is sugar.** Query expressions are translated into calls to methods named `Where`, `Select`, `SelectMany`, `Join`, `GroupJoin`, `OrderBy`, `OrderByDescending`, `ThenBy`, `ThenByDescending`, `GroupBy` and `Cast`, as a syntactic mapping before any type binding or overload resolution ✅[^spec-expressions]. Any type with suitable methods supports the syntax; `System.Linq` provides them for every `IEnumerable<T>` ✅[^spec-expressions]. The two forms are synonymous, and many operators (`Count`, `Distinct`, `Chunk`, …) have no query keyword ✅[^ref-sqo].
2. **Enumerable: deferred versus immediate.** Operators that return a single value (`Count`, `Max`, `Average`, `First`) execute immediately ✅[^ref-intro]. Almost all operators that return `IEnumerable<T>` or `IOrderedEnumerable<T>` are deferred: they run when the result is enumerated, read the source as it is at that time, and can give a different result each time ✅[^ref-intro]. For `IEnumerable<T>`, the returned object captures the arguments passed to the operator, and the operator's logic runs when that object is enumerated ✅[^ref-sqo]. `ToList()` and `ToArray()` force execution and cache the results ✅[^ref-intro].
3. **Enumerable: streaming versus non-streaming.** A streaming operator (`Where`, `Select`, `Take`) yields each result as soon as it has read enough input; a non-streaming one (`OrderBy`, `GroupBy`, `Reverse`) must read the whole source first ✅[^ref-intro]. The lab showed `Where` interleaving "source yields 3 / Where gives 3 / …", while `OrderBy` printed all three "source yields" lines before its first result ✅[^lab]. `OrderBy` is a stable sort: elements with equal keys keep their order ✅[^api-orderby].
4. **Lambdas read variables at execution time.** A lambda captures the variable, not its value, so `nums.Where(n => n > threshold)` defined with `threshold = 2` and run after `threshold = 4` returned `[5,9]` ✅[^lab]. Each enumeration also reruns every lambda: `Count()` then `Sum()` on `nums.Select(...)` ran the selector 8 times for 4 items, and `ToList()` once then reading the list ran it 4 times ✅[^lab].
5. **`IEnumerable<T>` versus `IQueryable<T>`.** For `IQueryable<T>`, the query is translated into an expression tree that the data source can turn into a native query, as Entity Framework does with SQL ✅[^ref-sqo]. `IQueryable<T>` is meant for query providers; enumerating it makes the provider execute the tree, and what "execute" means is up to the provider ✅[^api-iqueryable]. The compiler picks `Queryable.Where` or `Enumerable.Where` from the static type: in the lab, `Where` on a variable typed `IEnumerable<Person>` returned an in-memory `IEnumerableWhereIterator`, and on the same object typed `IQueryable<Person>` returned an `EnumerableQuery` that is still `IQueryable` ✅[^lab]. So once a query passes through an `IEnumerable<T>`-typed variable, every later operator binds to `Enumerable` and runs in your process.
6. **Expression trees.** Assigning a lambda to `Expression<Func<…>>` makes the compiler emit code that builds a tree of nodes describing it, instead of compiled code ✅[^ref-exprtrees]. The tree can be inspected, translated or compiled: in the lab, `x => x > 5` had a `GreaterThan` body with a `Parameter` on the left and a `Constant` on the right, and `Compile()(7)` returned `True` ✅[^lab]. Trees are immutable and only expression-bodied lambdas convert; many newer constructs are not allowed ✅[^ref-exprtrees]. The lab got CS0834 for a statement body, CS8072 for `?.`, CS8791 for `^1` and CS8110 for a call to a local function ✅[^lab].
7. **A provider translates only what it knows.** The lab's 20-line toy translator turned `p => p.Age > 30 && p.Name != "Cy"` into `WHERE ((Age > 30) AND (Name <> 'Cy'))`, and rejected `p => Rules.IsAdult(p)` at run time with "cannot translate Call" ✅[^lab]. The compiler accepts any expression lambda (How it works 6), and what executing a tree means is specific to each provider ✅[^api-iqueryable], so an unsupported method shows up only when the query runs.
8. **Operators added since .NET 6.** .NET 6 added `Chunk`, `MinBy`/`MaxBy`, `DistinctBy` and `TryGetNonEnumeratedCount` ✅[^whatsnew6]. .NET 9 added `CountBy` and `AggregateBy`, which aggregate by key without building groups, and `Index()`, which pairs each item with its position ✅[^whatsnew9]. .NET 10 added `LeftJoin` and `RightJoin`, outer joins that keep every element of the first or the second sequence ✅[^ref-joins], and `Shuffle`, which randomizes order with a non-cryptographic random generator ✅[^api-shuffle]. All of them ran on runtime 10.0.12 ✅[^lab]. The .NET 11 API (application programming interface) docs list one more `LeftJoin` overload, without a result selector, which returns `(Outer, Inner)` tuples ✅[^api-enumerable]. On runtime 11.0.0, `people.LeftJoin(pets, p => p.Id, x => x.OwnerId)` gave `Ann-Rex Bo-none Cy-none`, each element a `ValueTuple` whose `Inner` is `default` when nothing matches ✅[^lab11]; SDK (software development kit) 10.0.401 rejects the same call with `error CS1501: No overload for method 'LeftJoin' takes 3 arguments` ✅[^lab].

## Worked example
One query, followed from definition to three executions, with values from the lab ✅[^lab].

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | `var nums = new List<int> { 5, 1, 4 }; int threshold = 2;` | — | the data and a variable a lambda will capture |
| 2 | `var q = nums.Where(n => n > threshold).Select(n => { calls++; return n * 2; });` | nothing printed, `calls = 0` | deferred (How it works 2) |
| 3 | `nums.Add(9); threshold = 4;` | — | changes made after the definition |
| 4 | `q.Count()` | `2` (from 5 and 9), `calls = 2` | runs now, on the new list and the new threshold (How it works 4); `Count()` still runs the selector for each element |
| 5 | `q.Sum()` | `28` (10 + 18), `calls = 4` | a second enumeration reruns `Where` and `Select` |
| 6 | `var cached = q.ToList();` | `[10, 18]`, `calls = 6` | a third run, then a snapshot |
| 7 | `cached.Count; cached.Sum();` | `2`, `28`, `calls` stays `6` | the list holds results; nothing reruns |

Steps 4 and 5 are the multiple-enumeration bug: with a database behind `q`, they would be two round trips. Step 6 is the fix when the result is used more than once.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `new int[0].First()` / `new[] { 1, 2 }.Single()` | `InvalidOperationException: Sequence contains no elements` / `…contains more than one element` ✅[^lab] | `FirstOrDefault()` returns `0` and `FirstOrDefault(-1)` returns `-1` instead ✅[^lab] |
| `Select(x => 10 / x)` over `[1, 0, 2]` | Prints `10`, then `DivideByZeroException` inside the `foreach` ✅[^lab] | The lambda runs during enumeration (How it works 2) |
| `ToDictionary` with two equal keys | `ArgumentException` ✅[^lab] | Duplicate keys are rejected ✅[^api-todictionary]; `ToLookup` keeps both ✅[^lab] |
| `Count()` on a `List<T>` | Reads `Count`, no enumeration; `TryGetNonEnumeratedCount` is `True` for a list, `False` for a `Where` result ✅[^lab] | `Count()` uses `ICollection<T>` when the source implements it ✅[^api-count] |
| `Count()` on `list.Select(f)` | Still calls `f` for every element ✅[^lab] | Observed on runtime 10.0.12, although the count is known from the list; do not count on `Count()` to skip a selector's side effects |
| `MaxBy(w => w.Length)` with ties | Over `kiwi, plum, date, fig, pear` (four words of length 4) it returned `kiwi`, the first one ✅[^lab] | Observed in the lab; `Max(w => w.Length)` returns only the key, `4` ✅[^lab] |
| `Shuffle()` twice on `1..6` | `6,5,2,3,1,4` then `5,4,1,2,3,6` ✅[^lab] | A new random order per enumeration; not for security use ✅[^api-shuffle] |
| `LeftJoin` with no match | `Bo-none Cy-none`; the result selector gets `default` for the missing inner element ✅[^lab] | Same output as the older `GroupJoin` + `DefaultIfEmpty` form ✅[^lab] |
| Statement lambda as `Expression<Func<int,int>>` | error CS0834 "A lambda expression with a statement body cannot be converted to an expression tree" ✅[^lab] | Only expression lambdas convert ✅[^ref-exprtrees] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| LINQ to Objects | Short, declarative code; filtering, ordering and grouping in one expression ✅[^ref-intro] | In the lab (Apple M2, Release build), `data.Where(x => x % 3 == 0).Select(x => (long)x * x).Sum()` over 1,000 ints allocated 104 bytes per call and took about 11 times as long as the equivalent `foreach` (154 ms against 14 ms for 20,000 calls) ✅[^lab] |
| A hand-written loop | No allocation (0 bytes in the same run) and no delegate calls ✅[^lab] | More code; easy to get grouping or ordering wrong |
| `IQueryable<T>` to a provider | Filtering runs where the data lives | Only translatable constructs; errors at run time; harder to debug |
| `ToList()` early | One execution, a stable snapshot | Holds every result in memory |

## Takeaways
- Materialize (`ToList()`, `ToArray()`) a query whose result is used more than once or whose source can change before use. [rule-candidate]
- Keep database queries typed `IQueryable<T>` until the last operator that should run on the server; an `IEnumerable<T>` variable in between moves the rest to the client. [rule-candidate]
- Do not capture variables that change after the query is defined; copy the value into a local first if the query runs later.
- Prefer `Any()` over `Count() > 0`, and `CountBy`/`AggregateBy` over `GroupBy` when only per-key totals are needed.
- Leave LINQ out of measured hot loops; elsewhere its readability is usually worth the cost.

## Verification status
- Verified: 51 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [C# standard: Expressions (§12.23 Query expressions)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions) — ECMA TC49-TG2 / Microsoft, living. Rank 1. Backs: query syntax translated syntactically into named method calls; `System.Linq` implements the pattern. [^spec-expressions]
- [Introduction to LINQ queries in C#](https://learn.microsoft.com/en-us/dotnet/csharp/linq/get-started/introduction-to-linq-queries) — Microsoft, living. Rank 1. Backs: immediate versus deferred, streaming versus non-streaming, `ToList`/`ToArray` cache results, LINQ's advantages. [^ref-intro]
- [Standard query operators overview](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/) — Microsoft, living. Rank 1. Backs: query and method syntax are synonymous; `IEnumerable<T>` captures arguments; `IQueryable<T>` becomes an expression tree that providers translate. [^ref-sqo]
- [IQueryable&lt;T&gt; Interface](https://learn.microsoft.com/en-us/dotnet/api/system.linq.iqueryable-1) — Microsoft, living. Rank 1. Backs: meant for providers; enumeration executes the tree; execution is provider-specific. [^api-iqueryable]
- [Expression trees](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/) — Microsoft, living. Rank 1. Backs: `Expression<Func<…>>` builds a tree; immutability; only expression lambdas; constructs that cannot appear. [^ref-exprtrees]
- [Enumerable Class](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable) — Microsoft, living. Rank 1. Backs: the .NET 11 tuple-returning `LeftJoin` overload. [^api-enumerable]
- [Enumerable.OrderBy Method](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.orderby) — Microsoft, living. Rank 1. Backs: `OrderBy` performs a stable sort. [^api-orderby]
- [Enumerable.ToDictionary Method](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.todictionary) — Microsoft, living. Rank 1. Backs: duplicate keys throw `ArgumentException`. [^api-todictionary]
- [Enumerable.Count Method](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.count) — Microsoft, living. Rank 1. Backs: `Count()` uses the source's `ICollection<T>` implementation when there is one. [^api-count]
- [Enumerable.Shuffle Method](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.shuffle) — Microsoft, living. Rank 1. Backs: randomization uses a non-cryptographically-secure random number generator. [^api-shuffle]
- [Join operations in LINQ](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/join-operations) — Microsoft, living. Rank 1. Backs: `LeftJoin` and `RightJoin` in .NET 10. [^ref-joins]
- [What's new in .NET 6](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-6) — Microsoft, living. Rank 1. Backs: `Chunk`, `MinBy`/`MaxBy`, `DistinctBy`, `TryGetNonEnumeratedCount`. [^whatsnew6]
- [What's new in .NET 9 libraries](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-9/libraries) — Microsoft, living. Rank 1. Backs: `CountBy`, `AggregateBy`, `Index`. [^whatsnew9]

## Related
- `dotnet/collections-and-linq/iterators.md` — the state machines LINQ operators are built from, and the split-method pattern LINQ uses for argument checks.
- `dotnet/collections-and-linq/collections.md` — the collections queried here and what `ToList`, `ToDictionary` and `ToLookup` build.
- `dotnet/delegates-and-events/delegates-lambdas-and-closures.md` — captured variables and the delegate cost behind each lambda.
- `dotnet/performance/measuring-and-reducing-allocations.md` — measuring the cost of a LINQ chain in a hot path.
- `dotnet/concurrency/threads-and-the-thread-pool.md` — PLINQ.
