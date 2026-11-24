---
schema: topic-index/v1
kind: subtopic
topic: dotnet/metaprogramming
last-updated: 2026-11-24
---

# Reflection, source generators and interop

Code that works on code, and code that leaves the managed world: reading types and attributes at run time with reflection (and why the trimmer and Native AOT, ahead-of-time compilation, cannot follow it), generating C# at compile time with Roslyn source generators (`[GeneratedRegex]`, `[LoggerMessage]`, `JsonSerializerContext`, `[LibraryImport]`, a hand-written incremental generator, interceptors), and `unsafe` pointers, function pointers and P/Invoke (platform invoke) calls into native libraries. Every behaviour ran on the .NET 10 SDK (software development kit) lab (`dotnet/lab-setup.md`). Not covered: `System.Reflection.Emit` and expression-tree compilation in depth, COM (Component Object Model) interop, writing Roslyn analyzers (see `dotnet/tooling/analyzers-and-code-quality.md` for using them), and `Span<T>`-based low-level code (see `dotnet/performance/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [reflection-and-attributes.md](reflection-and-attributes.md) | concept | `typeof` vs `GetType()`, member lookup and `Invoke` (cost, wrapped exceptions), `Activator`, custom and compiler-read attributes, caller info and `nameof`, `UnsafeAccessor`, trim and AOT warnings | verified |
| [source-generators.md](source-generators.md) | concept | How incremental generators run inside the compiler, the built-in generators and what they write, partial members as the sockets, interceptors, reading generated files, a small generator built offline | verified |
| [interop-and-unsafe.md](interop-and-unsafe.md) | concept | Pointers, `fixed` and pinning, `stackalloc`, function pointers, `DllImport` vs `LibraryImport` into libc, blittable types and marshalling, `errno`, `NativeMemory`, `GCHandle` | verified |

## References
- [Attributes and reflection (C#)](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/) — Microsoft, living. Backs: subtopic scope (reflection and attributes).
- [Incremental generators](https://github.com/dotnet/roslyn/blob/main/docs/features/incremental-generators.md) — .NET Roslyn team, living. Backs: subtopic scope (source generators).
- [Native interoperability](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/) — Microsoft, living. Backs: subtopic scope (interop).

## Related
- `dotnet/tooling/` — analyzers, warnings and the trim/AOT analyzers in a build.
- `dotnet/runtime/` — the JIT (just-in-time compiler), Native AOT and the garbage collector that pointers must respect.
- `dotnet/performance/` — spans, `ref` safety and allocation-free code.
