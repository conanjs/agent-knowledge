---
schema: knowledge-doc/v1
type: concept
topic: dotnet/fundamentals
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "osx-arm64 for the stack-depth results"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [csharp, methods, parameters, ref, out, in, ref-readonly, params, params-collections, optional-arguments, named-arguments, overload-resolution, local-functions, expression-bodied, tuples, deconstruction, discards, recursion, tail-calls, stack-overflow]
ranked-sources: true
---

# Methods, parameters, tuples and recursion

## Summary
**TL;DR:** C# passes every argument by value unless the parameter says otherwise: a struct is copied, a class reference is copied (so the method can change the object but not which object the caller holds). `ref` passes the variable itself, `out` makes the method assign it, `in` and `ref readonly` pass a read-only reference. Optional-parameter defaults are compiled into each *call site*, so changing a default in a library does nothing until callers are recompiled. Overload resolution prefers exact and narrower conversions, normal form over `params` expansion, and candidates that need no defaults. Tuples are mutable `ValueTuple` structs whose element names exist only at compile time, and C# never guarantees tail calls: deep recursion ends in an uncatchable stack overflow.
**Use this when:** a method's change to an argument is or is not seen by the caller, a library's new default value is ignored, the compiler picks an unexpected overload, you return several values, or a recursive algorithm crashes with "Stack overflow."
**Not this doc:** lambdas, closures and delegates → `dotnet/delegates-and-events/delegates-lambdas-and-closures.md`; `ref` locals, `ref struct` and `scoped` → `dotnet/performance/ref-safety-and-ref-structs.md`; `const` fields baked into callers → `dotnet/type-design/members-and-initialization.md`; extension methods → `dotnet/type-design/extension-members-and-operators.md`; exceptions → `dotnet/errors-and-resources/exceptions.md`.

## Problem
- A method sets `list = new List<int>()` and the caller still sees the old list, yet `list.Add(2)` inside the method is visible.
- A library changes `Run(int attempts = 3)` to `= 5`, ships the new DLL (dynamic-link library, the compiled assembly), and every existing caller still passes 3.
- `F(1)` calls `F(int)`, `L(5)` calls `L(long)` rather than `L(double)`, and `G(null)` picks `G(string)` over `G(object)`.
- Two `static` helpers with the same name in a top-level program fail with `CS0128`.
- A tail-recursive count to 100 million crashes with `Stack overflow.` in a Release build, but not when tiered compilation is turned off.

## Mental model
**Analogy:** calling a method is handing over papers. By value, you hand a photocopy: for a struct the copy holds the data; for a class it holds the address of a shared file cabinet, so the method can rearrange the cabinet but cannot change which cabinet your copy of the address points to. `ref` hands over your original sheet; `in` hands it over in a sealed sleeve. An optional argument is a blank the *caller's* clerk fills in from the form printed when the caller was built, not from the library's current form.

**Artifact** (lab output ✅[^lab]):
```csharp
static void Bump(int x) => x++;                         // n stays 1
static void BumpRef(ref int x) => x++;                  // n becomes 2
static void AddTo(List<int> l) => l.Add(2);             // caller sees Count = 2
static void Replace(List<int> l) => l = new List<int>(); // caller still sees the old list
static void ReplaceRef(ref List<int> l) => l = new List<int>(); // caller now sees Count = 0
// by value: n=1   ref: n=2   reference type by value: count=2   reference type by ref: count=0
```

## How it works
1. **By value is the default.** A method gets a copy of the argument: for a struct a copy of the value, for a class a copy of the reference; the method can change the referenced object but cannot reassign the caller's variable ✅[^params]. Lab: `MovePt(pt)` left a struct's `X` at `1`, `MovePtRef(ref pt)` set it to `99` ✅[^lab].
2. **`ref` and `out`.** A `ref` argument must be an assignable variable (`Inc(ref 5)` is `error CS1510`) ✅[^lab]. An `out` argument needs no initialization, but the method must assign it before returning ✅[^params], or the build fails with `CS0177: The out parameter 'x' must be assigned to before control leaves the current method` ✅[^lab]. `out _` discards the value ✅[^discards].
3. **`in` and `ref readonly`.** `in` passes a read-only reference, and the compiler may create a temporary copy, for example when the argument is a constant or needs a conversion ✅[^params]; the call site may omit `in` ✅[^params]. `ref readonly` says the method expects a variable: passing an expression only warns ✅[^params], `CS9193: Argument 1 should be a variable because it is passed to a 'ref readonly' parameter` ✅[^lab]. Lab: `SumIn(5)` with `in int` returned `6` ✅[^lab]. Defensive copies of non-readonly structs → `dotnet/performance/ref-safety-and-ref-structs.md`.
4. **`params`.** The `params` parameter must be last and appear once ✅[^params] (`CS0231` otherwise ✅[^lab]). Before C# 13 it had to be a single-dimensional array; from C# 13 it can be `Span<T>`, `ReadOnlySpan<T>`, a type with a collection builder, or an `IEnumerable<T>` implementation with a parameterless constructor and `Add` ✅[^params]. Lab: `Total()` = `0`, `Total(1, 2, 3)` = `6`, `Total([4, 5])` = `9` for `params int[]`; `params ReadOnlySpan<int>` and `params IEnumerable<string>` worked the same way ✅[^lab].
5. **Optional and named arguments.** A default must be a constant expression, `new ValType()` or `default(ValType)`; optional parameters come after required ones; named arguments may reorder arguments, and arguments are evaluated in the order written ✅[^named]. Lab errors: `CS1736` for `int x = DateTime.Now.Second`, `CS1737` for an optional before a required parameter ✅[^lab].
6. **Defaults are substituted at the call site.** When an argument is omitted, the default value of the declaration is implicitly passed ✅[^spec-expr], so the value ends up in the caller's compiled code ✅[^lab] (Worked example).
7. **Overload resolution in brief.** Among applicable candidates, the better function member has better conversions for the arguments ✅[^spec-expr]. A type is the better conversion target when it converts implicitly to the other but not back ✅[^spec-expr], so `int` beats `long`, `long` beats `double`, `string` beats `object`. A candidate applicable in its normal form beats one that needs `params` expansion ✅[^spec-expr]. When still tied, a candidate whose parameters all have arguments beats one that needs defaults ✅[^spec-expr]. Lab picks: `F(1)` → `F(int)`, `F((short)1)` → `F(int)`, `L(5)` → `L(long)`, `G(null)` → `G(string)`, `H(1, 2)` → `H(int,int)`, `K(5)` → `K(int)` over `K(int, int y = 0)`, `M(new List<int>())` → `M(IEnumerable<int>)`, and the collection expression `Q([1, 2])` → `Q(ReadOnlySpan<int>)` over `Q(int[])` ✅[^lab].
8. **Local functions.** A local function is a named function declared inside another member and visible only there; a non-static one may capture the member's locals and parameters, a `static` one may not ✅[^localfn]. Lab: capturing in a `static` local function failed with `CS8421: A static local function cannot contain a reference to 'count'.` ✅[^lab]. A local function's name must be unique in its block, so local functions cannot be overloaded ✅[^spec-stmts]; in a top-level program two `static` helpers named `Amb` failed with `CS0128` ✅[^lab].
9. **Expression bodies.** `member => expression;` replaces a block for methods, properties, constructors and accessors; for a value-returning member the expression must convert to the return type ✅[^lambdaop].
10. **Tuples.** C# tuples are `System.ValueTuple` types: value types with public, mutable fields, comparable with `==` and `!=` ✅[^tuples]. Element names are replaced by `Item1`, `Item2`, … at compile time and are not available at run time ✅[^tuples]. Lab: a method returning `(int Min, int Max)` printed `(1, 9)` with type `ValueTuple`2`, `(int, int)` and `(int A, int B)` were the same run-time type and compared equal, and `(x, y) = (y, x)` swapped two variables ✅[^lab].
11. **Deconstruction and discards.** Every tuple can be deconstructed into separate variables, and `_` discards elements you do not need ✅[^deconstruct]. The same `_` is a discard pattern in a switch arm, a discarded `out` argument, a discard assignment `_ = expr`, or unused lambda parameters ✅[^discards]. Lab: `var (_, max) = MinMax([5, 6])` gave `max=6`; a positional `record Pt(int X, int Y)` deconstructed with `var (px, py) = p` ✅[^lab].
12. **Recursion has no tail-call guarantee in C#.** The runtime performs a guaranteed tail call only when the IL (intermediate language) carries the `tail.` prefix, which languages that need it emit per call ✅[^tailcalls]. The C# compiler did not: the lab's tail-recursive `Count(n - 1, acc + 1)` compiled to a plain `call` (no `FE-14` bytes) ✅[^lab]. A stack overflow cannot be caught and terminates the process ✅[^soe].

## Worked example
A library changes the default of an optional parameter; the application's DLL is not rebuilt. Two projects, `Lib` and `App` (with a `ProjectReference`), built and run in the lab ✅[^lab]:

| Step | Action | `dotnet App.dll` prints | Why |
|---|---|---|---|
| 1 | `Lib`: `public static string Run(int attempts = 3)`; `App`: `Console.WriteLine(Retry.Run());`; build both | `Run(attempts=3)` | the compiler wrote the constant 3 into `App`'s call |
| 2 | Change the library to `attempts = 5`, rebuild only `Lib`, copy the new `Lib.dll` next to `App.dll` | `Run(attempts=3)` | `App`'s IL still passes 3; the library's default is never read at run time |
| 3 | Rebuild `App` | `Run(attempts=5)` | the call site is recompiled with the new default |

The same versioning rule applies to `const` fields. For a public API (application programming interface) whose default may change, declare an overload without the parameter (`Run() => Run(5)`) instead: then the value lives in the library.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Tail-recursive `Count(100_000_000, 0)`, Debug | `Stack overflow.`, exit code 134, after about 174,000 repeated frames ✅[^lab] | no `tail.` prefix and no optimization ✅[^tailcalls] |
| The same in Release, default settings | still `Stack overflow.`, exit code 134 (about 261,000 frames) ✅[^lab] | the method starts in unoptimized tier-0 code; tiers → `dotnet/runtime/jit-tiering-and-aot.md` |
| The same in Release with `DOTNET_TieredCompilation=0` | prints `100000000`, exit code 0 ✅[^lab] | the optimizing JIT (just-in-time compiler) turned the call into a jump on its own (a fast tail call ✅[^tailcalls]); an optimization, not a guarantee |
| `try`/`catch` around a stack overflow | the process still terminates ✅[^soe] | `StackOverflowException` cannot be caught |
| `ref readonly` parameter given a literal | compiles with warning `CS9193` ✅[^lab] | the modifier asks for a variable but accepts expressions with a warning ✅[^params] |
| `G(null)` with `G(string)` and `G(object)` | `G(string)`, plus nullable warning `CS8625` ✅[^lab] | `string` is the better conversion target ✅[^spec-expr] |
| Tuple element names after a cast or in reflection | gone: only `Item1`, `Item2` exist at run time ✅[^tuples] | names are compile-time metadata |
| Named arguments out of position | `Greet(punctuation: ".", name: "Bo", greeting: "Hi")` printed `Hi, Bo.` ✅[^lab] | names match parameters; evaluation follows the order written ✅[^named] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Optional parameters | one method, short call sites ✅[^named] | defaults frozen into callers (Worked example) |
| Overloads instead of defaults | the value stays inside the library | more methods to document |
| `out` parameters (`TryParse` style) | no allocation; works with `if` ✅[^params] | awkward to compose; one result per `out` |
| Returning a tuple | several values in one expression; deconstructs ✅[^tuples] | names vanish at run time; a record is clearer for public APIs |
| `in` for large structs | passed by reference, not copied ✅[^params] | the compiler may still create a temporary copy, for example for a constant or a converted argument ✅[^params] |
| Recursion | direct expression of tree-shaped algorithms | depth is limited by the stack; convert deep recursion to a loop or an explicit stack ✅[^soe] |

## Takeaways
- Do not change the default value of a public optional parameter in a library others compile against; add an overload instead. [rule-candidate]
- Never rely on tail-call elimination in C#: rewrite deep or unbounded recursion as a loop or with an explicit `Stack<T>`. [rule-candidate]
- Use `ref`/`out` only when the caller's variable must change; return a tuple or record for several results otherwise.
- Prefer `params ReadOnlySpan<T>` (C# 13) for new variadic APIs on .NET 10.
- When an overload choice surprises you, check which conversion is "better" instead of adding casts at call sites.

## Verification status
- Verified: 59 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Method parameters and modifiers](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/method-parameters) — Microsoft, living. Rank 1. Backs: pass by value; `out` assignment rule; `in` temporaries and optional call-site modifier; `ref readonly` warning; `params` rules and C# 13 collection types. [^params]
- [Named and optional arguments](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/named-and-optional-arguments) — Microsoft, living. Rank 1. Backs: allowed default expressions; optional after required; evaluation order; overload preference for fewer omitted arguments. [^named]
- [C# standard: Expressions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions) — ECMA C# standard (published by Microsoft), living. Rank 1. Backs: default arguments implicitly passed (§12.6.2); better function member, normal versus expanded form, defaults tie-break (§12.6.4.3); better conversion target (§12.6.4.7). [^spec-expr]
- [C# standard: Statements](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/statements) — ECMA C# standard (published by Microsoft), living. Rank 1. Backs: local function names unique, so no overloading. [^spec-stmts]
- [Local functions](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/building-software/local-functions) — Microsoft, living. Rank 1. Backs: scope; capture; `static` local functions cannot capture. [^localfn]
- [The => operator: expression body definition](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/lambda-operator) — Microsoft, living. Rank 1. Backs: expression-bodied member syntax and conversion rule. [^lambdaop]
- [Tuple types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-tuples) — Microsoft, living. Rank 1. Backs: `ValueTuple`, mutable value types with fields, `==`/`!=`, names replaced at compile time. [^tuples]
- [Deconstruction expression](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/deconstruction) — Microsoft, living. Rank 1. Backs: tuple deconstruction with discards. [^deconstruct]
- [Discards and the discard pattern](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/patterns/discards) — Microsoft, living. Rank 1. Backs: the places `_` acts as a discard. [^discards]
- [Tailcalls via helpers](https://github.com/dotnet/runtime/blob/main/docs/design/features/tailcalls-with-helpers.md) — .NET runtime team, living. Rank 1. Backs: languages request tail calls with the `tail.` prefix; fast tail calls. [^tailcalls]
- [StackOverflowException](https://learn.microsoft.com/en-us/dotnet/api/system.stackoverflowexception) — Microsoft, living. Rank 1. Backs: cannot be caught; the process terminates; prevent deep recursion. [^soe]

## Related
- `dotnet/fundamentals/types-values-and-conversions.md` — value versus reference types, the basis of item 1.
- `dotnet/fundamentals/control-flow-and-pattern-matching.md` — positional patterns over tuples and records.
- `dotnet/delegates-and-events/delegates-lambdas-and-closures.md` — lambdas, which share capture rules with local functions.
- `dotnet/performance/ref-safety-and-ref-structs.md` — `ref` returns, `scoped`, defensive copies.
- `dotnet/runtime/jit-tiering-and-aot.md` — why Release code starts unoptimized.
