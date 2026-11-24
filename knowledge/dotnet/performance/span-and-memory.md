---
schema: knowledge-doc/v1
type: concept
topic: dotnet/performance
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", ".NET 11.0.0 / C# 15 (container lab) for the memory-safety preview"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, span, readonlyspan, memory, slicing, stackalloc, nativememory, memorymarshal, first-class-span, searchvalues, parsing, zero-allocation]
ranked-sources: true
---

# Span<T> and Memory<T>

## Summary
**TL;DR:** `Span<T>` is a 16-byte view, a reference to the first element plus a length, over memory that already exists: an array, a string (read-only), a `stackalloc` buffer or native memory. Slicing a span makes a new view, never a copy, so parsing with spans allocates nothing where `Substring` and `Split` allocate a string per piece (0 versus 488 bytes per line in the lab). Because a span may point into the stack, it is a `ref struct` that can live only on the stack: no fields in classes, no boxing, no surviving an `await`. `Memory<T>` is the heap-storable counterpart for async code and fields, and you take `.Span` from it when you do the work. C# 14 adds implicit conversions from arrays and strings to spans, including for extension-method receivers.
**Use this when:** a profile shows many short strings or array copies from `Substring`, `Split`, `ToArray` or `Skip`/`Take`; you write a parser or formatter; you need a temporary buffer without a heap allocation; or you must decide between `Span<T>` and `Memory<T>` in an API (application programming interface).
**Not this doc:** the compiler rules that keep spans safe (`ref struct`, `scoped`, escape errors) → `dotnet/performance/ref-safety-and-ref-structs.md`; pooling, `string.Create` and measuring bytes → `dotnet/performance/measuring-and-reducing-allocations.md`; pointers, `fixed` and P/Invoke → `dotnet/metaprogramming/interop-and-unsafe.md`; strings and UTF-16 → `dotnet/fundamentals/strings-and-text.md`.

## Problem
Text and buffer code in .NET used to allocate on every step (the byte count is from the lab's Worked example below):
- `line.Split(';')` then `pair.Split('=')` then `int.Parse(parts[1])` allocated 488 bytes to read three numbers from one 26-character line.
- `s.Substring(3, 5)` allocates a new string only to parse it and throw it away.
- A temporary 256-byte scratch buffer means a new array per call, or a field that is not thread-safe.
- An API that takes `byte[]` cannot accept a slice of a larger buffer, stack memory or native memory without a copy.

## Mental model
**Analogy:** a span is a window frame laid over a wall of bricks. You can slide it or make it narrower (slice), and painting the bricks inside the frame paints the wall itself, but the frame owns no bricks. A frame laid over a temporary scaffold (the stack) must be taken down before the scaffold is, which is why the compiler never lets a span leave the method that owns the scaffold. `Memory<T>` is a written note saying "wall 3, bricks 10 to 20": it can be stored and carried around, and you build a frame from it when you need to work.

**Artifact** (run in the lab ✅[^lab]):
```csharp
int[] data = [1, 2, 3, 4, 5, 6];
Span<int> middle = data.AsSpan(2, 3);   // view over elements 2..4, no copy
middle[0] = 30;
middle.Fill(9);
Console.WriteLine(string.Join(",", data));                      // 1,2,9,9,9,6
Console.WriteLine(Unsafe.SizeOf<Span<int>>());                  // 16: a reference + an int length (+ padding)
try { data.AsSpan(1, 2)[2] = 0; } catch (IndexOutOfRangeException) { Console.WriteLine("checked"); } // checked
```

## How it works
1. **What the types are.** The memory-related types represent a contiguous, strongly typed region of memory, and creating them through `Slice`, `AsSpan()`, a collection expression or a constructor copies nothing: only the reference and the bounds of the view change ✅[^mem-index]. `Span<T>` can wrap an array, a `stackalloc` buffer or a pointer to unmanaged memory; `ReadOnlySpan<T>` can also wrap a `string` ✅[^mem-index].
2. **What a span holds.** `Span<T>` is declared as a `readonly ref struct` with two fields, `ref T _reference` and `int _length` ✅[^src-span]; the `ref` field is what lets it point into the middle of an array or a string without copying ✅[^ref-struct]. `Memory<T>` is an ordinary `readonly struct` holding an `object`, an index and a length ✅[^src-memory], so it can live on the heap ✅[^mem-index]. Both were 16 bytes in the lab ✅[^lab]. Indexing a span is bounds-checked against the span's own length, so a slice cannot read past its window ✅[^lab].
3. **Why a span cannot leave the stack.** Because it may point at stack memory, `Span<T>` is a `ref struct` that is "allocated on the stack rather than on the managed heap"; it cannot be boxed, cannot be a field of a class, and cannot be used across asynchronous calls ✅[^api-span] ✅[^mem-index]. The compiler enforces this; the rules and their error codes are in `dotnet/performance/ref-safety-and-ref-structs.md`.
4. **`Memory<T>` for storage and async.** `Memory<T>` wraps an array or a `MemoryManager<T>` and has none of the span restrictions ✅[^mem-index]. Its `.Span` property gives a span for the synchronous work; there is no conversion back from `Span<T>` to `Memory<T>` ✅[^mem-guide]. The usage rules: take `Span<T>` in a synchronous API (rule 1), take the read-only type when you only read (rule 2), and do not touch a `Memory<T>` argument after your `void` method returns or after your returned `Task` completes (rules 3 and 4); whoever holds an `IMemoryOwner<T>` must dispose it or hand it on, not both (rule 7) ✅[^mem-guide]. In the lab a `Memory<int>` over an array crossed an `await` and its `.Span` then wrote into the array ✅[^lab].
5. **`stackalloc`.** `Span<byte> buf = stackalloc byte[n];` needs no `unsafe` context; the memory is freed when the method returns ✅[^stackalloc]. The stack is small, and running out throws `StackOverflowException`, so cap the size and fall back to an array above a threshold, and do not `stackalloc` inside a loop ✅[^stackalloc]. The language says the content is undefined until initialized ✅[^stackalloc]; in the lab the C# compiler's default left it zeroed, and `[SkipLocalsInit]` exposed old stack bytes ✅[^lab] (measured in `dotnet/performance/measuring-and-reducing-allocations.md`). A collection expression assigned to a span may also use stack storage when that is ref-safe ✅[^stackalloc].
6. **Native memory.** `new Span<byte>(pointer, length)` wraps memory from `NativeMemory.Alloc` (in an `unsafe` block); the span is checked and sliced like any other, and freeing the memory remains your job ✅[^lab].
7. **Reinterpreting with `MemoryMarshal`.** `MemoryMarshal` offers low-level operations on spans and memory, such as `Cast` between primitive element types and `AsBytes`, which throws `ArgumentException` if `T` contains object references ✅[^api-memorymarshal]. In the lab `MemoryMarshal.AsBytes` over `[1, 256]` gave 8 bytes `1 0 0 0 0 1 0 0` on little-endian arm64, with no copy ✅[^lab].
8. **APIs that take spans.** Most parsing and searching APIs have span overloads: `int.Parse(ReadOnlySpan<char>, NumberStyles, IFormatProvider?)` ✅[^api-int32], `MemoryExtensions.Split` on a `ReadOnlySpan<char>` writes `Range` values for the pieces into a destination span instead of creating strings ✅[^api-memext], and its enumerating form `line.AsSpan().Split(';')` yields the same ranges with no allocation ✅[^lab]. `SearchValues<T>` precomputes a set of values for `IndexOfAny`/`ContainsAny`; creating one is relatively expensive because it chooses a vectorized algorithm, so create it once and keep it in a `static readonly` field ✅[^api-searchvalues].
9. **C# 14 first-class spans.** The language now has implicit span conversions from a one-dimensional array to `Span<T>` and `ReadOnlySpan<T>` (with covariance for the read-only one), from `Span<T>` to `ReadOnlySpan<T>`, and from `string` to `ReadOnlySpan<char>`, and these apply to the receiver of extension methods ✅[^builtin-types] ✅[^cs14]. In the lab, an extension method on `ReadOnlySpan<int>` called on an `int[]`, and one on `ReadOnlySpan<char>` called on a `string`, compiled with C# 14 and failed with `error CS1929` under `LangVersion=13` ✅[^lab]. C# 13 already allowed `params ReadOnlySpan<T>` parameters ✅[^cs13].

## Worked example
Sum the values in `"id=12345;qty=42;price=1999"` with spans only, as traced by the lab probe (Release build, numbers measured after warm-up) ✅[^lab].

| Step | Operation | Result | Allocation |
|---|---|---|---|
| 1 | `rest.IndexOf(';')` | `semi = 8` | none |
| 2 | `pair = rest[..8]`, `rest = rest[9..]` | `pair = "id=12345"`, `rest = "qty=42;price=1999"` (views) | none |
| 3 | `pair.IndexOf('=')`, `value = pair[3..]` | `eq = 2`, `value = "12345"` | none |
| 4 | `int.Parse(value)` (`ReadOnlySpan<char>` overload) | `12345` | none |
| 5 | Repeat on `rest` | `semi = 6`, `"qty=42"` → `42` | none |
| 6 | Repeat; `IndexOf` returns `-1`, so `pair = rest`, `rest = default` | `"price=1999"` → `1999`, loop ends on an empty span | none |
| 7 | Sum | `14386` | **0 bytes per line** |
| — | Same parse with `Split(';')`, `Split('=')`, `int.Parse(string)` | `14386` | **488 bytes per line** (4 arrays, 9 strings) |

The same probe family measured the smaller pieces: `int.Parse(line.Substring(3, 5)) + int.Parse(line.Substring(13))` cost 64 bytes, the `AsSpan` version 0; `line.Split(';')` 120 bytes, `line.AsSpan().Split(';')` 0 ✅[^lab].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `Span<int>` local alive across an `await` | `error CS4007: Instance of type 'System.Span<int>' cannot be preserved across 'await' or 'yield' boundary` ✅[^lab] | A span cannot live in the heap-allocated async state; use `Memory<T>` and take `.Span` after the `await` ✅[^mem-index] |
| `stackalloc byte[4_000_000]` on a thread with a 1 MB stack | `Stack overflow.` and exit code 134; a 500,000-byte buffer on the same thread worked ✅[^lab] | Stack space is limited ✅[^stackalloc], and a `StackOverflowException` cannot be caught: the process ends ✅[^api-soe] |
| `arr.Reverse()` on an `int[]` in C# 14 | Returned the reversed sequence `7,0,5,0` ✅[^lab] | The new array-to-span conversion would bind to the in-place `MemoryExtensions.Reverse(Span<T>)`, which returns `void`; .NET 10 adds an array overload of `Enumerable.Reverse` to keep old code working ✅[^spec-span] |
| Overloads for both `T[]` and `ReadOnlySpan<T>` | Calls that compiled before C# 14 can become ambiguous ✅[^spec-span] | Type inference from array to span now succeeds; call `.AsSpan()` or give one overload `OverloadResolutionPriority` ✅[^spec-span] |
| `SearchValues.Create(...)` inside the hot method | Correct results, but the analysis cost is paid on every call | Create it once and cache it ✅[^api-searchvalues] |
| `MemoryMarshal.AsBytes` on a span of a type with references | `ArgumentException` at run time ✅[^api-memorymarshal] | Viewing references as bytes would defeat the GC (garbage collector) |
| `MemoryMarshal` under the C# 15 memory-safety preview (.NET 11) | Several `MemoryMarshal` members carry `[RequiresUnsafe]`: in the .NET 11.0.0 reference assembly, 23 of its 25 public methods, all but `ToEnumerable` and `TryGetString` ✅[^lab11]. With the `updated-memory-safety-rules` feature on, `MemoryMarshal.AsBytes(ints)` in safe code was error CS9362 "'MemoryMarshal.AsBytes<int>(Span<int>)' must be used in an unsafe context because it is marked as 'unsafe'" and compiled inside an `unsafe` block; without the feature, plain C# 15 accepted it in safe code ✅[^lab11] | The .NET 11 reference source declares those methods `unsafe` ✅[^src-ref11]; the same preview lets `stackalloc` convert to a pointer outside `unsafe` ✅[^stackalloc]. Rules and switches: `dotnet/metaprogramming/interop-and-unsafe.md` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `ReadOnlySpan<char>` slices instead of `Substring` | No allocation per piece | The pieces cannot be stored or awaited; call `.ToString()` for the few you keep |
| `Memory<T>` parameter | Storable, works across `await` | Slower to index than a span (take `.Span` once); ownership rules to follow ✅[^mem-guide] |
| `stackalloc` buffer | No heap allocation, freed automatically | Small and fatal when exceeded; needs a size cap and an array fallback ✅[^stackalloc] |
| `ArrayPool<T>.Shared` buffer | Any size, reused across calls | Must be returned exactly once (see `dotnet/performance/measuring-and-reducing-allocations.md`) |

## Takeaways
- Take `ReadOnlySpan<T>` (or `Span<T>`) parameters in synchronous APIs and `ReadOnlyMemory<T>` (or `Memory<T>`) only when the data must outlive the call or cross an `await`. [rule-candidate]
- Parse with `AsSpan`, slicing and span overloads instead of `Substring` and `Split` in hot paths.
- Guard every `stackalloc` with a size threshold and an array fallback; never put it in a loop. [rule-candidate]
- Keep `SearchValues<T>` instances in `static readonly` fields.

## Verification status
- Verified: 50 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [Memory-related and span types](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/) — Microsoft, living. Rank 1. Backs: the type family; no copying on creation; what backs each type; span restrictions; `Memory<T>` has none. [^mem-index]
- [Memory\<T> and Span\<T> usage guidelines](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines) — Microsoft, living. Rank 1. Backs: rules 1–4 and 7; `.Span`; no conversion from span to memory. [^mem-guide]
- [Span\<T> struct](https://learn.microsoft.com/en-us/dotnet/api/system.span-1) — Microsoft, living. Rank 1. Backs: a ref struct allocated on the stack; cannot be boxed; unsuitable for async storage. [^api-span]
- [ref struct types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/ref-struct) — Microsoft, living. Rank 1. Backs: `Span<T>` uses a `ref` field to avoid copying. [^ref-struct]
- [stackalloc expression](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/stackalloc) — Microsoft, living. Rank 1. Backs: assignment to spans without `unsafe`; limits, threshold and loops; undefined content; collection expressions; the C# 15 pointer preview. [^stackalloc]
- [MemoryMarshal class](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.memorymarshal) — Microsoft, living. Rank 1. Backs: `Cast`, `AsBytes` and its reference check. [^api-memorymarshal]
- [StackOverflowException class](https://learn.microsoft.com/en-us/dotnet/api/system.stackoverflowexception) — Microsoft, living. Rank 1. Backs: the exception cannot be caught and the process ends. [^api-soe]
- [Int32.Parse](https://learn.microsoft.com/en-us/dotnet/api/system.int32.parse) — Microsoft, living. Rank 1. Backs: the `ReadOnlySpan<char>` overload. [^api-int32]
- [MemoryExtensions.Split](https://learn.microsoft.com/en-us/dotnet/api/system.memoryextensions.split) — Microsoft, living. Rank 1. Backs: span split produces `Range` values for the pieces. [^api-memext]
- [SearchValues class](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.searchvalues) — Microsoft, living. Rank 1. Backs: precomputed search sets; creating is expensive; cache in a `static readonly` field. [^api-searchvalues]
- [Built-in types: implicit span conversions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/built-in-types) — Microsoft, living. Rank 1. Backs: the list of implicit span conversions; extension receivers. [^builtin-types]
- [What's new in C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) — Microsoft, 2025. Rank 1. Backs: first-class span support in C# 14. [^cs14]
- [What's new in C# 13](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) — Microsoft, 2024. Rank 1. Backs: `params` spans. [^cs13]
- [First-class Span Types (feature specification)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/first-class-span-types) — C# language design team, 2025. Rank 1. Backs: the `Reverse` breaking change and its .NET 10 mitigation; new ambiguities and workarounds. [^spec-span]
- [Span.cs (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Private.CoreLib/src/System/Span.cs) — .NET runtime team, 2025. Rank 1. Backs: the two fields of `Span<T>`. [^src-span]
- [Memory.cs (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Private.CoreLib/src/System/Memory.cs) — .NET runtime team, 2025. Rank 1. Backs: the three fields of `Memory<T>`. [^src-memory]
- [System.Runtime.cs reference source (release/11.0)](https://github.com/dotnet/runtime/blob/release/11.0/src/libraries/System.Runtime/ref/System.Runtime.cs) — .NET runtime team, 2026. Rank 1. Backs: the `MemoryMarshal` methods declared `unsafe` (requires-unsafe) in .NET 11. [^src-ref11]

## Related
- `dotnet/performance/ref-safety-and-ref-structs.md` — why a span cannot escape, `scoped`, `ref` fields.
- `dotnet/performance/measuring-and-reducing-allocations.md` — measuring the savings, `ArrayPool<T>`, `string.Create`, `[SkipLocalsInit]`.
- `dotnet/fundamentals/strings-and-text.md` — UTF-16, culture and comparison rules that still apply to `ReadOnlySpan<char>`.
- `dotnet/metaprogramming/interop-and-unsafe.md` — pointers, `fixed` and native memory.
- `dotnet/runtime/object-layout-and-boxing.md` — what an array or string costs on the heap.
