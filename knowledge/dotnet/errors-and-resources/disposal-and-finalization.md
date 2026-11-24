---
schema: knowledge-doc/v1
type: concept
topic: dotnet/errors-and-resources
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, idisposable, using, await-using, iasyncdisposable, dispose-pattern, finalizer, suppressfinalize, safehandle, resurrection, resource-leak]
ranked-sources: true
---

# Disposal and finalization: `IDisposable`, `using`, finalizers and `SafeHandle`

## Summary
**TL;DR:** The garbage collector frees memory, not files, sockets or native handles, so a type that owns one implements `IDisposable` and its users call `Dispose()`, almost always through `using`, which the compiler turns into `try`/`finally`. A finalizer (`~T()`) is a late safety net: it runs on a separate thread, at an unknown time, in no particular order, needs at least two collections, and does not run at all when a .NET 5+ process exits. Wrap native handles in a `SafeHandle` instead of writing finalizers. Forgetting `Dispose` keeps the resource busy until a finalizer happens to run, and can lose data that only `Dispose` would have flushed.
**Use this when:** you write a class that owns a file, connection, native memory or another `IDisposable`; a file stays locked or comes out empty; you must choose between `using` statements, `using` declarations and `await using`; or you meet `Dispose(bool disposing)`, `GC.SuppressFinalize` or a finalizer in a code review.
**Not this doc:** how the collector finds garbage, generations and the finalization queue's place in it → `dotnet/runtime/garbage-collection.md`; disposal of services by a DI (dependency injection) container → `dotnet/app-model/dependency-injection.md`; exceptions and `finally` in general → `dotnet/errors-and-resources/exceptions.md`; P/Invoke (platform invoke: calling functions in native libraries) and pinning → `dotnet/metaprogramming/interop-and-unsafe.md`.

## Problem
Without deterministic cleanup, resource bugs depend on when the garbage collector happens to run:
- A file opened with `FileShare.None` and not disposed cannot be reopened: `IOException: The process cannot access the file … because it is being used by another process.`
- A `StreamWriter` that writes "hello" and is never disposed leaves a 0-byte file, even after the garbage collector has run.
- A finalizer that touches another object finds it already finalized, because finalizers have no order.
- A finalizer that throws ends the process (exit code 134 on macOS), and no `finally` block runs.
- Cleanup placed in a finalizer never runs at shutdown.

## Mental model
**Analogy:** a hotel room. `Dispose()` is checking out at the desk: the room is free the moment you hand in the key. A `using` block is a booking with an automatic checkout when you leave the building, even if you leave because of a fire (an exception). A finalizer is housekeeping noticing, some days later, that a room looks abandoned: it happens eventually, in no particular order, and not at all if the hotel shuts down first. A `SafeHandle` is the hotel's own key system, which makes sure each room is released exactly once, whoever releases it.

**Artifact** (run in the lab, Release build ✅[^lab]):
```csharp
static void OpenAndForget(string p)
{
    var fs = new FileStream(p, FileMode.Create, FileAccess.Write, FileShare.None);
    fs.WriteByte(65);                       // no Dispose
}
OpenAndForget(path);
new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
// IOException: The process cannot access the file '…/d-disp-lock.txt' because it is being used by another process.
GC.Collect(); GC.WaitForPendingFinalizers();
new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);   // works now, Length = 1
```

## How it works
Four actors decide when a resource is released:
- **Compiler (Roslyn)** — its job: expand `using` and `await using` into `try`/`finally` blocks that call `Dispose`/`DisposeAsync`, via the translation in the C# standard.
- **The disposable object** — its job: release what it owns, via `Dispose()` (or `DisposeAsync()`) and the protected `Dispose(bool disposing)`.
- **Garbage collector (GC)** — its job: notice that an object with a finalizer is unreachable, via the finalization queue, and keep it alive until the finalizer has run.
- **Finalizer thread** — its job: run finalizers, via a dedicated runtime thread, outside your code's control.

```
your code                      compiler output                     GC + finalizer thread
---------                      ---------------                     ---------------------
using var r = new Res();  ──▶  Res r = new Res();
...                            try { ... }
end of scope                   finally { if (r != null) r.Dispose(); }   ──▶ Dispose(true)
                                                                            GC.SuppressFinalize(this)
                                                                            (finalizer will be skipped)
forgot using?  ─────────────────────────────────────────────────────────▶  GC: unreachable, has finalizer
                                                                            → kept alive, queued
                                                                            finalizer thread: ~Res() → Dispose(false)
                                                                            next GC: memory reclaimed
```

1. **Compiler: `using` is `try`/`finally`.** `using (R r = e) S` becomes `R r = e; try { S } finally { if (r != null) ((IDisposable)r).Dispose(); }`; for a value type there is no null check and no boxing, for a `ref struct` a pattern-based `Dispose()` is called, and a `null` resource is simply not disposed ✅[^spec-statements]. Several resources in one statement are nested `using` statements ✅[^spec-statements], so they are disposed in reverse order ✅[^ref-using]; the lab printed `Dispose c`, `Dispose b`, `Dispose a` ✅[^lab]. A `return` or an exception inside the block still disposes ✅[^ref-using] (lab: "Dispose early" before the method returned 42, "Dispose throwing" before the `catch` ran ✅[^lab]).
2. **Compiler: declarations and restrictions.** A `using` declaration (`using var r = …;`, C# 8) disposes at the end of the enclosing scope ✅[^ref-using]. A `using` variable is read-only: assigning it is error CS1656 ✅[^ref-using] ✅[^lab]. A type without `IDisposable` gets CS1674, and a type with only `IAsyncDisposable` gets CS8418 "Did you mean 'await using' rather than 'using'?" ✅[^lab]. The `using (expression)` form leaves the disposed object in scope, where using it again throws `ObjectDisposedException` ✅[^ref-using] ✅[^lab].
3. **Compiler: `await using`.** It calls `DisposeAsync()` on an `IAsyncDisposable`, or on any type with an accessible `DisposeAsync()` method that returns an awaitable ✅[^spec-statements]; the lab used a class with such a method and no interface ✅[^lab]. A class that implements both interfaces gets only `DisposeAsync()` from `await using` and only `Dispose()` from `using` ✅[^lab]. Implementing `IAsyncDisposable` without `IDisposable` risks a leak when a caller only calls `Dispose` ✅[^impl-disposeasync].
4. **Disposable object: the dispose pattern.** `Dispose()` should be idempotent: callable many times, doing nothing after the first ✅[^impl-dispose]. The pattern has a public non-virtual `Dispose()` that calls `Dispose(true)` and then `GC.SuppressFinalize(this)`, and a `protected virtual Dispose(bool disposing)` that frees managed resources only when `disposing` is `true` and unmanaged ones in both cases ✅[^impl-dispose]. `disposing` is `false` when a finalizer calls it, and that path must not touch other managed objects, which may already be finalized ✅[^impl-dispose]. A class that owns an `IDisposable` field should itself be `IDisposable` and dispose it ✅[^impl-dispose]; a derived class overrides `Dispose(bool)` and calls `base.Dispose(disposing)` ✅[^impl-dispose]. The async version adds `protected virtual ValueTask DisposeAsyncCore()` ✅[^impl-disposeasync].
5. **`GC.SuppressFinalize`.** It sets a bit in the object header that the runtime checks before calling a finalizer; on an object without a finalizer it has no effect ✅[^api-suppress]. In the lab, the disposed `Resource` never reached its finalizer, while the forgotten one ran `Dispose(disposing: False)` ✅[^lab].
6. **GC and finalizer thread: what a finalizer guarantees.** A C# finalizer compiles to a `Finalize()` override whose `finally` calls the base class's `Finalize()` ✅[^ref-finalizers]. A type with a finalizer gets an entry in the finalization queue per instance; when the GC finds the object unreachable, it calls the finalizer unless finalization was suppressed ✅[^api-finalize]. The time is undefined, two objects' finalizers run in no guaranteed order even when one refers to the other, and the thread is unspecified ✅[^api-finalize]. In the lab, finalizers ran on managed thread 2 (the program ran on thread 1), and the six finalizers of three parent → child pairs ran in the order `child parent child parent child parent`, so at least one child was finalized before the parent that still referenced it ✅[^lab]. Reclaiming a finalizable object takes at least two collections ✅[^api-finalize]; after the first `GC.Collect()`, a short weak reference reported the object dead while a long one (`trackResurrection: true`) still saw it; after the finalizer and a second collection both did ✅[^lab].
7. **Finalizer thread: the dangerous corners.** A finalizer runs once, unless the object calls `GC.ReRegisterForFinalize`; a finalizer can resurrect its object by storing `this` somewhere reachable ✅[^api-finalize] (the lab's `Phoenix` did, and its finalizer did not run again after it was dropped a second time ✅[^lab]). If a finalizer throws, the runtime terminates the process and runs no active `try`/`finally` blocks or other finalizers ✅[^api-finalize]; in the lab, the exit code was 134 and the `finally` in `Main` never printed ✅[^lab]. .NET 5 and later do not run finalizers when the application exits; use `AppDomain.ProcessExit` for cleanup that must happen at exit ✅[^ref-finalizers]. Empty finalizers cost performance for nothing ✅[^ref-finalizers].
8. **`SafeHandle` instead of a finalizer.** A finalizer is needed only when a class directly holds an unmanaged resource, and even then the docs recommend wrapping the raw handle in a `SafeHandle` ✅[^impl-dispose]. `SafeHandle` releases the handle exactly once, whether it is disposed or finalized ✅[^impl-dispose]. It is a critical finalizer object: all normal finalizers run before the critical ones collected in the same pass, which lets a `FileStream` flush buffered data before its handle closes ✅[^api-safehandle]. P/Invoke calls increment its reference count while they use the handle ✅[^api-safehandle]. The lab's `NativeBuffer : SafeHandle` over `NativeMemory.Alloc` released once after two `Dispose()` calls, and its own finalizer released a forgotten instance ✅[^lab].
9. **What a forgotten `Dispose` really costs.** `FileStream` keeps a finalizer that calls `Dispose(false)` ✅[^src-filestream], and its buffered strategy flushes the write buffer even then, ignoring I/O errors during finalization ✅[^src-buffered]; hence the lab's file was locked until a collection and then held its one byte ✅[^lab]. `StreamWriter` buffers characters itself and expects `Close` or at least `Flush` when you are done ✅[^api-streamwriter]; the lab's undisposed `StreamWriter("hello")` left a 0-byte file after collections and finalizers ✅[^lab].

## Worked example
Two classes from the lab, one used correctly and one forgotten, in a Release build ✅[^lab]. `Resource` implements the dispose pattern from How it works 4 and prints its thread.

| Step | Code | Printed | Rule |
|---|---|---|---|
| 1 | `Proper()`: `using var r = new Resource("disposed");` | `Dispose(disposing: True) for 'disposed' on thread 1` | the `finally` the compiler added calls `Dispose()` at the end of the method |
| 2 | (inside `Dispose()`) `GC.SuppressFinalize(this)` | — | the finalizer of `'disposed'` will be skipped (How it works 5) |
| 3 | `Forget()`: `_ = new Resource("forgotten");` | nothing | the object is unreachable when `Forget` returns, but still holds its resource |
| 4 | `GC.Collect(); GC.WaitForPendingFinalizers();` | `Dispose(disposing: False) for 'forgotten' on thread 2` | the GC queued the finalizer; the finalizer thread ran it (How it works 6) |
| 5 | `Resource.FinalizerRuns` | `1` | only the forgotten object was finalized |
| 6 | `_ = new Resource("left at exit");` and `Main` returns | nothing | no finalizers at process exit on .NET 5+ (How it works 7) |

Step 4 only happens because the probe forces a collection; in a real process it happens whenever the GC decides, which may be minutes later or never (step 6).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `using (Res? none = null) { … }` | The body runs; no `NullReferenceException` ✅[^lab] | A `null` resource is not disposed ✅[^spec-statements] |
| Calling `Dispose()` twice | No exception with an idempotent implementation ✅[^lab] | Required by the pattern ✅[^impl-dispose]; `ObjectDisposedException.ThrowIf(disposed, this)` guards the other members |
| Finalizer in a struct | error CS0575 "Only class types can contain destructors" ✅[^lab] | Finalizers exist only for classes ✅[^ref-finalizers] |
| Finalizer that reads another finalizable field | May see it already finalized ✅[^api-finalize] | No order between finalizers (How it works 6) |
| Resurrected object | Reachable again; its finalizer does not run a second time unless re-registered ✅[^lab] | How it works 7 |
| `StreamWriter` not disposed | Data lost: 0-byte file ✅[^lab] | Its buffer is flushed only by `Flush`/`Close`/`Dispose` ✅[^api-streamwriter] |
| `FileStream` not disposed | File locked until finalization, then flushed and closed ✅[^lab] | `FileStream` keeps a finalizer for compatibility ✅[^src-filestream] |
| `IAsyncDisposable`-only type in a plain `using` | CS8418 ✅[^lab] | The compiler requires `IDisposable` for a plain `using`, and its message suggests `await using` ✅[^lab] |
| `ref struct` with a `Dispose()` method and no interface | Works in `using` and is disposed ✅[^lab] | Pattern-based disposal for ref structs ✅[^ref-using] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `using` declaration (`using var x = …;`) | No extra nesting ✅[^ref-using] | The resource lives to the end of the scope, often longer than needed |
| `using` statement (`using (…) { }`) | Releases exactly when the block ends | One nesting level per resource |
| Plain `Dispose()` (managed resources only) | No finalizer, no GC cost ✅[^impl-dispose] | A forgotten call leaks until the owned objects' own finalizers (if any) run |
| `SafeHandle` | Released once, by dispose or finalization; safe with P/Invoke ✅[^api-safehandle] | One more small object per handle |
| Hand-written finalizer | Works without `SafeHandle` | Needs two GCs, no ordering, crashes the process if it throws ✅[^api-finalize] |

## Takeaways
- Create every `IDisposable` you own in a `using` statement or declaration, or store it in a field of a class that is itself `IDisposable`. [rule-candidate]
- Do not write finalizers; wrap native handles in a `SafeHandle` subclass, and write `Dispose(bool)` only for the managed side. [rule-candidate]
- Make `Dispose()` idempotent and call `GC.SuppressFinalize(this)` in it whenever the class or a subclass may have a finalizer.
- Implement `IDisposable` next to `IAsyncDisposable`, so callers that only know `Dispose()` do not leak.
- Never rely on a finalizer for data integrity or for work at shutdown: flush and close explicitly, and use `AppDomain.ProcessExit` for exit-time cleanup.

## Verification status
- Verified: 68 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [C# standard: Statements (§13.14 The using statement)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/statements) — ECMA TC49-TG2 / Microsoft, living. Rank 1. Backs: the `try`/`finally` translation, value types without boxing, ref struct pattern `Dispose`, `null` resources, nested multiple resources, pattern-based `DisposeAsync`. [^spec-statements]
- [using statement (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/using) — Microsoft, living. Rank 1. Backs: disposal on exit and on exception, reverse order, `using` declarations, read-only variables, ref struct resources, the expression form. [^ref-using]
- [Implement a Dispose method](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-dispose) — Microsoft, living. Rank 1. Backs: idempotent `Dispose`, `Dispose(bool)`, `SuppressFinalize`, cascading, derived classes, finalizers only for direct unmanaged resources, `SafeHandle` releases once. [^impl-dispose]
- [Implement a DisposeAsync method](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-disposeasync) — Microsoft, living. Rank 1. Backs: `DisposeAsyncCore`, the leak risk of `IAsyncDisposable` without `IDisposable`. [^impl-disposeasync]
- [Finalizers (C# programming guide)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/finalizers) — Microsoft, living. Rank 1. Backs: classes only, translation to `Finalize` with a base call, empty finalizers, no finalizers at exit on .NET 5+, `ProcessExit`. [^ref-finalizers]
- [Object.Finalize Method](https://learn.microsoft.com/en-us/dotnet/api/system.object.finalize) — Microsoft, living. Rank 1. Backs: the finalization queue, undefined time, no order, unspecified thread, two collections, run once, resurrection, a throwing finalizer terminates the process. [^api-finalize]
- [GC.SuppressFinalize Method](https://learn.microsoft.com/en-us/dotnet/api/system.gc.suppressfinalize) — Microsoft, living. Rank 1. Backs: the object-header bit; no effect without a finalizer. [^api-suppress]
- [SafeHandle Class](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.safehandle) — Microsoft, living. Rank 1. Backs: critical finalization, normal finalizers before critical ones, the `FileStream` flush example, reference counting during P/Invoke. [^api-safehandle]
- [StreamWriter.AutoFlush Property](https://learn.microsoft.com/en-us/dotnet/api/system.io.streamwriter.autoflush) — Microsoft, living. Rank 1. Backs: `StreamWriter` buffers and expects `Close` or `Flush`. [^api-streamwriter]
- [FileStream.cs, release/10.0](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Private.CoreLib/src/System/IO/FileStream.cs) — .NET team (dotnet/runtime), 2025. Rank 1. Backs: the finalizer kept for compatibility calls `Dispose(false)`. [^src-filestream]
- [BufferedFileStreamStrategy.cs, release/10.0](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Private.CoreLib/src/System/IO/Strategies/BufferedFileStreamStrategy.cs) — .NET team (dotnet/runtime), 2025. Rank 1. Backs: `Dispose(bool)` flushes the write buffer, ignoring I/O errors during finalization. [^src-buffered]

## Related
- `dotnet/errors-and-resources/exceptions.md` — `finally`, which `using` compiles to, and why a throwing finalizer is fatal.
- `dotnet/runtime/garbage-collection.md` — generations, the finalization queue and why finalizable objects survive a collection.
- `dotnet/app-model/dependency-injection.md` — which services the container disposes, and when.
- `dotnet/metaprogramming/interop-and-unsafe.md` — native handles, P/Invoke and `NativeMemory`.
- `dotnet/collections-and-linq/iterators.md` — `foreach` disposes its enumerator, which runs an iterator's `finally` blocks.
- `dotnet/performance/ref-safety-and-ref-structs.md` — ref structs and their pattern-based `Dispose`.
