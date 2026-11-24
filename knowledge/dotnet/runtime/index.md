---
schema: topic-index/v1
kind: subtopic
topic: dotnet/runtime
last-updated: 2026-11-24
---

# The .NET runtime: JIT, garbage collector and object model

How the CoreCLR runtime of .NET 10 turns IL (intermediate language) into machine code and manages memory: the JIT (just-in-time compiler) and tiered compilation (tier 0, tier 1, OSR (on-stack replacement), Dynamic PGO (profile-guided optimization)), precompiled code with ReadyToRun and Native AOT (ahead-of-time compilation), the generational garbage collector (allocation contexts, generations, the LOH and POH (large and pinned object heaps), workstation, server and background GC (garbage collection), DATAS (dynamic adaptation to application sizes), latency modes), and what an object looks like in memory (header, MethodTable pointer, field layout), when value types are boxed, how virtual and interface calls dispatch, and which allocations the JIT removes through devirtualization and escape analysis. Every behaviour was measured in the lab (`dotnet/lab-setup.md`) on Release builds, including JIT logs and disassembly from `DOTNET_JitDisasmSummary` and `DOTNET_JitDisasm`, and a Native AOT publish. Not covered: measuring and reducing allocations in application code and `Span<T>` (see `dotnet/performance/`), finalizers and `IDisposable` (see `dotnet/errors-and-resources/`), the Mono runtime and WebAssembly.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [jit-tiering-and-aot.md](jit-tiering-and-aot.md) | concept | IL to machine code: tier 0, call counting, the instrumented tier and Dynamic PGO, tier 1, OSR for loops, `AggressiveOptimization`, Debug builds, ReadyToRun measured (sizes, JIT-compiled methods, startup), Native AOT and its limits, reading `DOTNET_JitDisasmSummary`; startup and steady-state numbers per setting | verified |
| [garbage-collection.md](garbage-collection.md) | concept | Allocation contexts, generations and promotion, roots, cards and write barriers, the LOH threshold (one byte, 0 versus 540 full GCs) and the POH, workstation, server and background GC, DATAS (no effect on macOS), latency modes, no-GC regions, `GC.Collect`, weak references | verified |
| [object-layout-and-boxing.md](object-layout-and-boxing.md) | concept | Object header and MethodTable pointer, the 24-byte minimum, struct field layout and `StructLayout`, boxing sources, vtable and interface stub dispatch, devirtualization and guarded devirtualization, .NET 10 stack allocation of non-escaping objects | verified |

## References
- [Book of the Runtime](https://github.com/dotnet/runtime/tree/main/docs/design/coreclr/botr) — .NET runtime team, living. Backs: subtopic scope.
- [Garbage collection](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/) — Microsoft, living. Backs: subtopic scope.

## Related
- `dotnet/performance/` — `Span<T>`, `ref` safety and measuring allocations.
- `dotnet/errors-and-resources/` — finalizers, `IDisposable` and `SafeHandle`.
- `dotnet/platform/` — the SDK, the runtime and target frameworks.
- `dotnet/learning-path.md` — the order to read the `dotnet/` docs in.
