---
schema: topic-index/v1
kind: subtopic
topic: dotnet/performance
last-updated: 2026-11-24
---

# High-performance C#: spans, ref safety and allocations

How to write C# on .NET 10 that copies and allocates less, and how to prove it: `Span<T>`, `ReadOnlySpan<T>` and `Memory<T>` as views over arrays, strings, `stackalloc` and native memory, allocation-free parsing, `MemoryMarshal`, `SearchValues<T>` and the C# 14 implicit span conversions; the compiler's ref-safety rules behind them (`ref` locals and returns, `in` and `ref readonly`, defensive copies, `ref struct` restrictions and their C# 13 relaxations, `ref` fields, `scoped`, `[UnscopedRef]`, the CS8352 family of errors); and measuring with `Stopwatch` after warm-up, `GC.GetAllocatedBytesForCurrentThread`, in-process EventCounters and metrics, then reducing allocations with `StringBuilder` reuse, `string.Create`, `ArrayPool<T>`, structs and `[SkipLocalsInit]`. Every behaviour and number was run in the lab (`dotnet/lab-setup.md`) on Release builds, including BenchmarkDotNet 0.15.8 and `dotnet-counters` 10.0.750501, restored into the lab's own folders (`dotnet/lab-setup.md` Steps 11–12). Not covered: the JIT (just-in-time compiler), the garbage collector and object layout themselves (see `dotnet/runtime/`), pointers and P/Invoke (platform invoke; see `dotnet/metaprogramming/interop-and-unsafe.md`), and profilers.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [span-and-memory.md](span-and-memory.md) | concept | `Span<T>` as a 16-byte (reference, length) view, slicing without copies, spans over strings, `stackalloc` and native memory, `Memory<T>` for heap and async, `MemoryMarshal`, span parsing (0 versus 488 bytes per line), `SearchValues<T>`, C# 14 first-class spans | verified |
| [ref-safety-and-ref-structs.md](ref-safety-and-ref-structs.md) | concept | `ref` locals and returns, safe-context and ref-safe-context, `in`/`ref readonly` and defensive copies, `ref struct` rules and the C# 13 changes, `ref` fields, `scoped`, `[UnscopedRef]`, the compiler errors each rule produces | verified |
| [measuring-and-reducing-allocations.md](measuring-and-reducing-allocations.md) | concept | Warm-up and Release builds, per-thread versus process byte counters, `System.Runtime` EventCounters and Meter in-process, `dotnet-counters` 10.0.750501 and BenchmarkDotNet 0.15.8 run in the lab (BenchmarkDotNet needs a project, not a file-based app), `ArrayPool<T>` rules, `string.Create`, `StringBuilder` reuse, structs, LINQ (Language-Integrated Query) in hot loops, `[SkipLocalsInit]` | verified |

## References
- [Memory-related and span types](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/) — Microsoft, living. Backs: subtopic scope.
- [Avoid memory allocations and data copies](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/performance/) — Microsoft, living. Backs: subtopic scope.

## Related
- `dotnet/runtime/` — the JIT, tiering, the garbage collector and object layout.
- `dotnet/metaprogramming/interop-and-unsafe.md` — pointers, `fixed`, native memory and P/Invoke.
- `dotnet/learning-path.md` — the order to read the `dotnet/` docs in.
