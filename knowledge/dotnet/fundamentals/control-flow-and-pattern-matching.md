---
schema: knowledge-doc/v1
type: concept
topic: dotnet/fundamentals
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "C# 15 labeled break/continue: .NET 11 container lab (SDK 11.0.100, C# 15) and a preview run on SDK 10.0.401"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [csharp, if, switch, switch-expression, pattern-matching, list-patterns, property-patterns, relational-patterns, exhaustiveness, cs8509, switchexpressionexception, foreach, loops, goto-case, break, continue]
ranked-sources: true
---

# Control flow and pattern matching

## Summary
**TL;DR:** C# tests values with *patterns* in three places: `is`, the `switch` statement and the `switch` expression. Patterns compose (type, constant, relational `< 0`, logical `and`/`or`/`not`, property `{ Length: 0 }`, positional `(0, 0)`, list `[1, .., var last]`, `var`, discard `_`), arms are tried top to bottom, and the first match wins. The compiler proves coverage: a switch expression that may miss a value only warns (`CS8509`, `CS8524`) and then throws `SwitchExpressionException` at run time, while an arm that can never match is an error (`CS8510`). `switch` statements never fall through between sections, and `foreach` needs only a `GetEnumerator()` pattern, not `IEnumerable`.
**Use this when:** you replace an `if`/`else` chain with a switch, a switch expression throws `SwitchExpressionException`, the compiler reports `CS8509`, `CS8510` or `CS0163`, or a custom type should work in `foreach`.
**Not this doc:** iterators, `yield` and enumerator disposal in depth → `dotnet/collections-and-linq/iterators.md`; the `for` versus `foreach` closure-capture rule → `dotnet/delegates-and-events/delegates-lambdas-and-closures.md`; exceptions and `when` filters → `dotnet/errors-and-resources/exceptions.md`; records and `Deconstruct`, which positional patterns use → `dotnet/type-design/classes-structs-and-records.md`.

## Problem
- A switch on an enum handles every named member and the build still warns `CS8524`.
- A switch expression compiled with a warning and then threw `SwitchExpressionException: Unmatched value was 5.` in production.
- Moving a broad arm (`> 0`) above a narrow one (`> 10`) fails the build with `CS8510`.
- C or Java habits produce `CS0163: Control cannot fall through from one case label ('case 0:') to another`.
- `break` inside a nested loop leaves only the inner loop; leaving both needs a flag, a `goto` or (C# 15) a label.
- Adding to a `List<T>` inside `foreach` throws `InvalidOperationException`.

## Mental model
**Analogy:** a switch expression is a sorting desk with labelled slots checked from top to bottom. Each label describes a shape ("a string of length 0", "a point at the origin", "a list that ends in 'express'"); the first slot whose label fits takes the parcel. Before the desk opens, an inspector (the compiler) checks two things: whether some parcel could reach the end without a slot (a warning, and at run time an exception) and whether a slot is hidden behind an earlier, wider one (an error).

**Artifact** (lab output ✅[^lab]):
```csharp
static string Describe(object? o) => o switch
{
    null                          => "null",
    0                             => "zero",
    int n and > 0                 => $"positive int {n}",
    string { Length: 0 }          => "empty string",
    Point(0, 0)                   => "origin",
    int[] and [1, .., var last]   => $"array starting 1, ending {last}",
    DayOfWeek.Saturday or DayOfWeek.Sunday => "weekend",
    not null                      => $"something else: {o.GetType().Name}",
};
// 42 -> positive int 42   "" -> empty string   new Point(0, 0) -> origin
// new[] { 1, 2, 3 } -> array starting 1, ending 3   DayOfWeek.Saturday -> weekend
```

## How it works
1. **Where patterns appear.** Patterns are matched by the `is` expression, the `switch` statement and the `switch` expression ✅[^patterns]. Logical, property, positional and list patterns are *recursive*: they contain nested patterns ✅[^patterns].
2. **The pattern kinds.** Declaration and type patterns test the run-time type (a declaration pattern also binds a variable); a constant pattern is `==` against a constant; relational patterns compare with a constant (`< 0`); `not`, `and`, `or` combine patterns; a property pattern matches members (`{ Length: 0 }`); a positional pattern deconstructs (`(0, 0)`); `var` matches anything, including `null`, and binds it; the discard `_` matches anything ✅[^patterns]. All of them ran in one switch expression in the lab ✅[^lab].
3. **Combinator precedence.** `not` binds first, then `and`, then `or`; parentheses change the grouping ✅[^patterns].
4. **List patterns (C# 11).** `[p1, p2]` matches when each element matches its nested pattern; a single slice `..` matches zero or more elements and may appear once per list pattern ✅[^patterns]. In the lab a list pattern after a type needed `and`: `int[] [1, .., var last]` is `error CS1003: Syntax error, ',' expected`, while `int[] and [1, .., var last]` matched `new[] { 1, 2, 3 }`, and `IList<int> and [var only]` matched a one-element `List<int>` ✅[^lab].
5. **First match wins, in text order.** A switch expression's value is the expression of the first arm whose pattern matches and whose `when` guard, if any, is `true`; arms are evaluated in text order ✅[^switchexpr]. A `switch` statement likewise evaluates case patterns top to bottom, and `default` runs only when nothing else matches, wherever it is written ✅[^selection].
6. **Coverage is checked at compile time, enforced at run time.** `CS8509` warns that a switch expression misses some input values; `CS8524` warns about unnamed enum values (such as `(Color)2`); `CS8510` is an error for an arm already handled by earlier arms ✅[^warnings]. If no arm matches at run time, .NET Core 3.0 and later throw `SwitchExpressionException` ✅[^switchexpr]. Lab: `n switch { < 0 => "neg", 0 => "zero" }` warned `For example, the pattern '1' is not covered.` and `Sign(5)` threw `Non-exhaustive switch expression failed to match its input. Unmatched value was 5.`; an enum switch over both named members of `Color` warned `CS8524` and threw for `(Color)7` ✅[^lab].
7. **`switch` statements do not fall through.** Every section must end with `break`, `goto`, `return` or `throw`; several labels may share one section ✅[^selection]. `goto case <constant>` and `goto default` jump to another section ✅[^jump]. Lab: `case 3: … goto case 1;` printed `3:three->3:low`, and a section without `break` failed with `CS0163` ✅[^lab].
8. **Pattern variables can be read only where they are definitely assigned.** A variable declared in an `if` condition stays in scope after the `if`, but reading it there needs definite assignment. In the lab `if (o is int n) { }` followed by `Console.WriteLine(n)` failed with `CS0165: Use of unassigned local variable 'n'` (not `CS0103`, so `n` was in scope, and `n = 5;` before the read compiled), while `if (o is not string str) return;` left `str` usable after the `if` ✅[^lab].
9. **`break` and `continue` target the innermost construct.** `break` ends the closest enclosing loop or `switch`; in nested loops only the inner loop ends, and `break` inside a `switch` inside a loop leaves only the `switch` ✅[^jump]. `continue` starts the next iteration of the closest loop ✅[^jump]. C# 15 adds labels: `break outer;` and `continue outer;` name the enclosing construct, and a labeled `continue` must name a loop, not a `switch` ✅[^jump]. In the .NET 11 container, `continue outer;` in an inner loop printed `(0,0)(1,0)(2,0)`, `break grid;` left both loops after `[0,0][0,1][0,2][1,0]`, and `continue sw;` aimed at a labeled `switch` failed with `error CS9394: No enclosing loop with the label 'sw' out of which to continue` ✅[^lab11].
10. **`foreach` is pattern-based.** It works on any type with a public parameterless `GetEnumerator()` (which may be an extension method) returning a type with a public `Current` property and a `bool MoveNext()` ✅[^iteration]. The specification defines it as: call `GetEnumerator()` once, loop `while (e.MoveNext())` reading `e.Current` into the iteration variable, and dispose the enumerator in a `finally` block; an implementation may compile it differently (arrays, for example) as long as the behaviour matches ✅[^spec-stmts]. Lab: a `struct Countdown` with only `GetEnumerator()` printed `3 2 1`, `foreach (var y in 42)` failed with `CS1579`, and assigning the iteration variable failed with `CS1656` ✅[^lab].
11. **Do not change a collection while enumerating it.** In the lab `list.Add(99)` inside `foreach (var n in list)` threw `InvalidOperationException: Collection was modified; enumeration operation may not execute.`; `List<int>.GetEnumerator()` returns a struct ✅[^lab]. Details → `dotnet/collections-and-linq/collections.md`.

## Worked example
A shipping-fee rule as one switch expression over `record Order(string Country, decimal Weight, string[] Tags)`, run in the lab ✅[^lab].

```csharp
static decimal Fee(Order o) => o switch
{
    { Weight: <= 0 }               => throw new ArgumentOutOfRangeException(nameof(o.Weight)),
    { Country: "VN", Weight: < 1 } => 2m,
    { Country: "VN" }              => 5m,
    { Tags: [.., "express"] }      => 20m,
    { Weight: > 30 }               => 50m + (o.Weight - 30) * 1.5m,
    _                              => 15m,
};
```

| Order | First arm that matches | Result |
|---|---|---|
| `VN`, 0.5 kg, no tags | 2: country and weight both match | `2` |
| `VN`, 3 kg, `fragile` | 3: arm 2 fails on `Weight` | `5` |
| `JP`, 2 kg, `gift, express` | 4: list pattern, last element `"express"` | `20` |
| `US`, 40 kg | 5: relational pattern | `65.0` (50 + 10 × 1.5), printed under the invariant culture and `en-US`; the lab machine's `en-VN` prints `65,0` |
| `US`, 2 kg | 6: discard | `15` |
| `VN`, 0 kg | 1: a throw expression as the arm's result | `ArgumentOutOfRangeException` for `Weight` |

Order matters twice: arm 1 must come first so a zero-weight Vietnamese order is rejected rather than charged 2, and the discard must be last, or every later arm becomes `CS8510`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Enum switch that names every member | `CS8524` warning; `(Color)7` throws `SwitchExpressionException` ✅[^lab] | the compiler warns separately about unnamed enum values, which a cast such as `(Color)7` produces; a final `_` arm covers them ✅[^warnings] |
| `n switch { > 0 => …, > 10 => …, _ => … }` | `error CS8510: The pattern is unreachable.` ✅[^lab] | `> 10` is contained in `> 0` ✅[^warnings] |
| A switch expression on .NET Framework | throws `InvalidOperationException` instead ✅[^switchexpr] | `SwitchExpressionException` exists from .NET Core 3.0 |
| `outer:` label with `continue outer;` on the .NET 10 SDK (software development kit) | at C# 14, `error CS8652: The feature 'labeled break and continue' is currently in Preview and *unsupported*.`; with `LangVersion=preview` it compiled and printed `(0,0)(1,0)(2,0)` ✅[^lab] | the feature belongs to C# 15 ✅[^csharp15]; a language version newer than the target framework's is unsupported ✅[^langver] |
| `continue outer;` on the .NET 11 SDK (11.0.100) | the same nested loop compiled at the default C# 15 and printed `(0,0)(1,0)(2,0)`; with `LangVersion=14`, `error CS9327: Feature 'labeled break and continue' is not available in C# 14.0. Please use language version 15.0 or greater.` ✅[^lab11] | C# 15 is the default for `net11.0` ✅[^csharp15] |
| `var` pattern | matches `null` too ✅[^patterns] | unlike a type pattern, `var` performs no type or null test |
| `goto case 1` | the target section runs, and the value is still `3` (`3:three->3:low`) ✅[^lab] | `goto case` only transfers control to the section with that label ✅[^jump] |
| `do { … } while (k < 5)` with `k = 10` | the body ran once ✅[^lab] | the condition is tested after each iteration ✅[^iteration] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Switch expression | one expression with a value; coverage warnings ✅[^switchexpr] | a missed case is only a warning unless warnings are errors |
| `switch` statement | several statements per case, `goto case` ✅[^selection] | no value; easy to forget a `break` (caught as `CS0163`) |
| `if`/`else if` chain | any condition, side effects in between | no coverage or reachability checks |
| Trailing `_ =>` arm | silences `CS8509` | hides a case added later, such as a new enum member |

## Takeaways
- Treat `CS8509` and `CS8524` as errors (`WarningsAsErrors`), so an unhandled value fails the build instead of throwing `SwitchExpressionException`. [rule-candidate]
- Prefer an explicit arm per enum member plus `_ => throw new ArgumentOutOfRangeException(...)` over a silent default value. [rule-candidate]
- Put narrow arms before wide ones; let `CS8510` tell you when the order is wrong.
- Never add to or remove from a collection inside `foreach` over it; collect changes and apply them after the loop. [rule-candidate]
- Give custom sequences a `GetEnumerator()` returning a struct when `foreach` speed matters; `IEnumerable<T>` is not required.

## Verification status
- Verified: 43 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [Pattern matching: the is and switch expressions, and and, or, not](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/patterns) — Microsoft, living. Rank 1. Backs: where patterns apply; every pattern kind; recursive patterns; combinator precedence; list and slice patterns; `var` matches null. [^patterns]
- [switch expression](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/switch-expression) — Microsoft, living. Rank 1. Backs: first matching arm in text order; case guards; `SwitchExpressionException` and the .NET Framework exception. [^switchexpr]
- [Selection statements: if and switch](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/selection-statements) — Microsoft, living. Rank 1. Backs: text-order evaluation; `default` position; no fall-through; shared labels. [^selection]
- [Resolve errors and warnings in pattern matching expressions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/pattern-matching-warnings) — Microsoft, living. Rank 1. Backs: `CS8509`, `CS8524`, `CS8510`. [^warnings]
- [Jump statements](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/jump-statements) — Microsoft, living. Rank 1. Backs: `break` and `continue` targets; `break` in a `switch` inside a loop; `goto case`, `goto default`; C# 15 labeled `break`/`continue`, and a labeled `continue` targets only a loop. [^jump]
- [Iteration statements](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements) — Microsoft, living. Rank 1. Backs: the `foreach` pattern (`GetEnumerator`, `Current`, `MoveNext`, extension `GetEnumerator`); `do` tests after the body. [^iteration]
- [C# standard: Statements](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/statements) — ECMA C# standard (published by Microsoft), living. Rank 1. Backs: the `foreach` expansion with `try`/`finally` disposal; implementations may differ if behaviour matches. [^spec-stmts]
- [What's new in C# 15](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) — Microsoft, 2026. Rank 1. Backs: labeled `break` and `continue` are C# 15; C# 15 is the default for `net11.0`. [^csharp15]
- [C# language versioning](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-versioning) — Microsoft, living. Rank 1. Backs: a C# version newer than the target framework's is unsupported. [^langver]

## Related
- `dotnet/collections-and-linq/iterators.md` — enumerators, `yield` and disposal.
- `dotnet/type-design/classes-structs-and-records.md` — records and `Deconstruct` for positional patterns.
- `dotnet/errors-and-resources/exceptions.md` — `when` filters on `catch`.
- `dotnet/fundamentals/methods-and-parameters.md` — tuples and deconstruction used by positional patterns.
