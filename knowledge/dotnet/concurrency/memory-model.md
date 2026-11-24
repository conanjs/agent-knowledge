---
schema: knowledge-doc/v1
type: concept
topic: dotnet/concurrency
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "the .NET runtime memory model (dotnet/runtime Memory-model.md)", "lab results: Apple M2 (arm64)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, memory-model, reordering, volatile, volatile-read, memory-barrier, interlocked, atomicity, torn-reads, double-checked-locking, lazy, publication]
ranked-sources: true
---

# The .NET memory model

## Summary
**TL;DR:** Without synchronization, the JIT (just-in-time compiler) and the CPU (processor) may reorder, merge or drop ordinary reads and writes as long as the current thread cannot tell; another thread can. In the lab, a `while (!flag)` loop on a plain field never ended in a Release build, and two threads that each wrote one variable and read the other both saw `0` in about 98% of 200,000 runs. `volatile` / `Volatile.Read` / `Volatile.Write` give only acquire and release ordering, which fixed the loop but not the second test; `Interlocked` methods and `Interlocked.MemoryBarrier()` are full fences, which fixed both. Aligned values up to pointer size are atomic, bigger structs can tear, and publishing a fully built object through a reference is safe.
**Use this when:** a flag set by one thread is never seen by another, you consider `volatile` or a hand-written double-checked lock, a struct read from another thread holds a mix of two writes, or you need to know what `lock`, `Interlocked` and `Volatile` guarantee beyond mutual exclusion.
**Not this doc:** choosing and using locks → `dotnet/concurrency/locks-and-interlocked.md`; collections that handle this for you → `dotnet/concurrency/concurrent-collections-and-channels.md`.

## Problem
- A worker loop `while (!_stop) { }` keeps spinning after another thread sets `_stop = true`, but only in Release builds.
- Two threads use "I write mine, then check yours" to agree who goes first, and both go first.
- A struct or a `decimal` read on one thread holds half of one value and half of another.
- Hand-written double-checked locking, `volatile` and `MemoryBarrier()` calls are copied from Java or C++ articles without knowing which guarantees .NET actually gives.

## Mental model
**Analogy:** every core keeps a private notepad and a private outbox. Reading may use a value copied onto the notepad earlier instead of looking at the shared board again; writing first drops a note in the outbox, and the post delivers it to the board a little later. Each core's own view stays consistent, so a single thread never notices. Another core does: it may see the board before the note arrives, or never look at the board again because it trusts its notepad. A volatile read means "look at the board now, and nothing after this may be read earlier"; a volatile write means "everything before this is delivered first"; a full fence means "empty the outbox and throw away the notepad before going on".

**Artifact** (lab, Release build ✅[^lab]):
```csharp
static bool Plain;            // ordinary field
static volatile bool Vol;     // volatile field
static long SpinPlain() { long n = 0; while (!Plain) n++; return n; }
static long SpinVolatileRead() { long n = 0; while (!Volatile.Read(ref Plain)) n++; return n; }
// another thread sets the flag after 100 ms, then waits up to 2 s for the loop to end:
// plain field    : loop saw the flag and ended within 2 s: False
// Volatile.Read  : loop saw the flag and ended within 2 s: True (after 341,920,901 spins)
// volatile field : loop saw the flag and ended within 2 s: True (after 352,076,691 spins)
```

## How it works
Three actors can change the order in which another thread observes memory:
- **Compilers (Roslyn, then the JIT)** — its job: generate fast code, via moving, merging or removing memory accesses that the current thread cannot tell apart.
- **CPU** — its job: execute out of order, via store buffers and early loads (weak ordering on Arm, stronger TSO (total store order) on x64).
- **The .NET memory model** — its job: say which reorderings are allowed and which operations forbid them, via the rules in `dotnet/runtime`'s `Memory-model.md`.

```
Thread A                     Thread B                 Without a fence, both loads can run
x = 1   ──▶ store buffer A   y = 1   ──▶ store buffer B   before either store reaches memory:
r1 = y  ◀── memory: y = 0    r2 = x  ◀── memory: x = 0    r1 == 0 and r2 == 0
            (x = 1 not yet visible)  (y = 1 not yet visible)
Full fence between the store and the load: the store drains first → at least one thread sees 1
```

### What may be reordered
1. **Ordinary accesses (both compilers and CPU):** the effects of ordinary reads and writes can be reordered as long as single-thread consistency holds, by the compiler or by weak hardware ordering ✅[^spec-mm]. The C# standard says the same: compiler, runtime or hardware optimizations can reorder unsynchronized field accesses ✅[^spec-volatile].
2. **Merged and removed accesses (compilers):** .NET forbids speculative writes and invented reads, but adjacent non-volatile reads of one location may be merged, and unused reads removed ✅[^spec-mm]. That is the Artifact: the JIT read `Plain` once, before the loop. The spec's own flag example requires a volatile read for exactly this reason ✅[^spec-mm]. The loop stayed stuck in Release with default tiering, with `DOTNET_TieredCompilation=0`, and with `AggressiveOptimization`; in a Debug build, with the optimizer off, it ended ✅[^lab].

### What forbids reordering
3. **Acquire and release (`volatile`, `Volatile`, locks):** a volatile read has acquire semantics: no later read or write may move before it. A volatile write has release semantics: it does not become visible before all earlier reads and writes ✅[^spec-mm]. `Volatile.Read`/`Write`, `volatile.` IL (intermediate language) prefixes, acquiring and releasing a `Monitor` lock all count, and `Volatile.ReadBarrier()` and `Volatile.WriteBarrier()` apply the same rules to all earlier reads or all later writes ✅[^spec-mm]; both are new in .NET 10 ✅[^api-volatile] and ran in the lab on 10.0.12 ✅[^lab]. The classic "write data, then volatile-write a flag; volatile-read the flag, then read data" handoff is guaranteed this way ✅[^api-volatile].
4. **What acquire and release do not forbid:** neither rule stops a release write from moving after a later acquire read, because acquire only holds back later operations and release only holds back earlier ones ✅[^spec-mm]. The store-buffering test shows it: with `Volatile.Write` then `Volatile.Read` on each thread, both threads still read `0` in 199,864 of 200,000 runs ✅[^lab]. Volatile also says nothing about atomicity or about how soon a write becomes visible ✅[^spec-mm]; a volatile read is not guaranteed to see the latest value written by another processor ✅[^kw-volatile].
5. **Full fences (`Interlocked`, `MemoryBarrier`):** `Thread.MemoryBarrier` and every `Interlocked` method have full-fence semantics: no read or write moves across them in either direction ✅[^spec-mm]. `Interlocked.MemoryBarrier` wraps `Thread.MemoryBarrier` ✅[^api-interlocked]. In the lab, a fence between each thread's store and load, or an `Interlocked.Exchange` as the store, brought the both-zero outcome to 0 of 200,000 runs ✅[^lab].
6. **The C# `volatile` keyword:** it changes nothing in the runtime; it tells the C# compiler to emit every access to the field with the `volatile.` prefix ✅[^spec-mm]. It is allowed only on reference types, pointers, `bool`, `char`, `float` and integer types up to 32 bits (and enums on them), `IntPtr` and `UIntPtr` ✅[^kw-volatile]; `volatile long` is error CS0677 in the lab ✅[^lab]. Volatile writes need not appear in one total order to all threads ✅[^spec-volatile], and the docs advise `Interlocked`, `lock` or higher-level primitives in most cases ✅[^kw-volatile].

### Atomicity and publication
7. **Atomic sizes:** aligned reads and writes of primitive types up to the pointer size, and of references, are always atomic in .NET; `Interlocked` and `Volatile` methods are atomic on every platform ✅[^spec-mm]. The C# standard alone guarantees less: `long`, `ulong`, `double`, `decimal` and user-defined structs need not be atomic ✅[^spec-atomic]. `Volatile` reads of 64-bit values are atomic even on 32-bit processors ✅[^api-volatile]. Lab, 20,000,000 reads while another thread alternated two values (✅[^lab]):

| Type | Size | Torn reads seen |
|---|---|---|
| `long` | 8 bytes | 0 |
| `record struct (long A, long B)` | 16 bytes | 0 (two runs) |
| `decimal` | 16 bytes | 9,316 |
| `record struct (long A, long B, long C)` | 24 bytes | 4,786 and 2,283 (two runs) |

   The 16-byte struct never tore on the M2, but nothing in the model promises that; the `decimal` of the same size did tear.
8. **Publishing an object:** storing a reference to a new object in shared memory is a release for that object's fields, and reads through a reference are data-dependent and therefore ordered, so another thread that sees the reference sees a fully constructed object without any fence ✅[^spec-mm]. Do not rely on this for ordering anything else: independent reference stores can still be reordered ✅[^spec-mm]. Instance constructors themselves carry no ordering guarantee, while everything a static constructor did is visible before any member of the type is used ✅[^spec-mm].
9. **Double-checked locking:** the spec's own lock-based singleton is correct on .NET because taking the lock is an acquire and releasing it a release ✅[^spec-mm]; its `Interlocked.CompareExchange` variant may build several instances but only one wins ✅[^spec-mm]. `Lazy<T>` does the same job without hand-written code: by default only one thread runs the factory, with `PublicationOnly` threads race and one result wins ✅[^lazy-init]. `LazyInitializer.EnsureInitialized(ref target, factory)` may create several instances and keep one ✅[^api-lazyinit]. Lab, 8 threads released together at a `Barrier`, factory sleeping 50 ms (✅[^lab]):

| Pattern | Factory calls | Distinct objects seen |
|---|---|---|
| `new Lazy<T>(f)` (`ExecutionAndPublication`) | 1 | 1 |
| `new Lazy<T>(f, PublicationOnly)` | 8 | 1 |
| `LazyInitializer.EnsureInitialized(ref t, f)` | 8 | 1 |
| `EnsureInitialized(ref t, ref init, ref lock, f)` | 1 | 1 |
| Double-checked `lock`, as in the spec | 1 | 1 |

## Worked example
The store-buffering test, run 200,000 times per row in a Release build on the lab's Apple M2. Each run: both fields reset to 0, two dedicated threads released at the same moment, thread A does `x = 1; r1 = y;` and thread B does `y = 1; r2 = x;`. Interleaving the two threads in any order gives at least one `1`; both reading `0` is only possible if a store was delayed past the following load (✅[^lab]):

| Variant | A's code | Both read 0 | Explanation |
|---|---|---|---|
| Plain | `x = 1; r1 = y;` | 197,060 (98.5%) | Ordinary accesses may be reordered (How it works 1); the store waits in the store buffer while the load runs |
| Volatile | `Volatile.Write(ref x, 1); r1 = Volatile.Read(ref y);` | 199,864 | Release then acquire does not order a store before a later load (How it works 4) |
| Full fence | `x = 1; Interlocked.MemoryBarrier(); r1 = y;` | 0 | The fence drains the store first (How it works 5) |
| `Interlocked.Exchange` store | `Interlocked.Exchange(ref x, 1); r1 = y;` | 0 | Every `Interlocked` call is a full fence (How it works 5) |
| Control: B spins 2,000 iterations first | `x = 1; r1 = y;` | 0 | No overlap, so no reordering can show: the harness itself is sound |

The both-zero rate depends on how tightly the harness lines up the two threads: a later re-run with a looser hand-off (both threads spinning on a shared round counter) saw it in 1 (plain) and 20 (`Volatile`) of 200,000 runs, and still in 0 with a fence or `Interlocked.Exchange` ✅[^lab].

The message-passing pattern (`x = 1; y = 1;` on one thread, `r1 = y; r2 = x;` on the other, looking for `r1 == 1, r2 == 0`) showed 0 of 200,000 both plain and with `Volatile` on the flag ✅[^lab]. The model still allows it for plain accesses (How it works 1): a test that never fails on one machine proves nothing for another.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Spin loop on a plain field in Debug | Ends normally ✅[^lab] | The optimizer is off; the same code hangs in Release, so a Debug test hides the bug |
| x64 instead of Arm | Some reorderings the model allows never show up there ✅[^spec-mm] | x64 is TSO, stronger than the release consistency .NET requires ✅[^spec-mm]; code must follow the model, and the lab ran only on arm64 |
| Reading your own write early | A thread may see its own write before other cores do ✅[^spec-mm] | Store-buffer forwarding, allowed as long as single-thread consistency holds |
| `volatile` on array elements | Not possible with the keyword; use `Volatile.Read`/`Write` on the element ✅[^api-volatile] | The modifier applies to fields only ✅[^kw-volatile] |
| Field offsets set with `FieldOffsetAttribute` | Alignment, and so atomicity, is no longer guaranteed ✅[^spec-mm] | Atomicity depends on proper alignment |
| Exception in a `Lazy<T>(factory)` | Cached: in the lab the second `.Value` threw again without calling the factory; with `PublicationOnly` it retried and returned 42 ✅[^lab] | Exception caching applies to factory constructors except `PublicationOnly` ✅[^lazy-init] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `lock` | Mutual exclusion plus acquire/release ordering ✅[^spec-mm] | Blocking |
| `Interlocked` | Atomic and a full fence ✅[^spec-mm] | One variable; a fence on every call |
| `Volatile.Read`/`Write` | Cheap ordering for one-way handoffs ✅[^api-volatile] | No store-load ordering, no atomic read-modify-write (How it works 4) |
| `Lazy<T>` | Correct lazy initialization with exception caching ✅[^lazy-init] | One extra object per value |
| `LazyInitializer` | No wrapper object ✅[^lazy-init] | The simple overload may run the factory several times ✅[^api-lazyinit] |

## Takeaways
- Read a cross-thread flag with `Volatile.Read` (or a `volatile` field), never a plain field, and test such code in Release builds. [rule-candidate]
- Use `lock` or `Interlocked` when two threads must agree on an order; `volatile` is not enough for "write mine, then read yours". [rule-candidate]
- Never share a struct larger than a pointer, or a `decimal`, between threads without a lock. [rule-candidate]
- Prefer `Lazy<T>` over hand-written double-checked locking.
- Treat "the stress test never failed" as no evidence: the lab machine never showed a message-passing reorder that the model allows.

## Verification status
- Verified: 53 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [.NET memory model](https://github.com/dotnet/runtime/blob/main/docs/design/specs/Memory-model.md) — .NET runtime team, living. Rank 1. Backs: alignment and atomicity; allowed optimizations (no speculative writes, merged reads); acquire, release and full-fence operations; `Volatile.ReadBarrier`/`WriteBarrier`; the C# `volatile` keyword; data-dependent reads; object assignment as release; constructors; hardware assumptions; the singleton and flag examples. [^spec-mm]
- [Volatile fields (C# standard, §15.5.4)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes#1554-volatile-fields) — ECMA / Microsoft, living. Rank 1. Backs: unsynchronized accesses can be reordered; acquire/release; no single total order of volatile writes. [^spec-volatile]
- [Atomicity of variable references (C# standard, §9.6)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/variables#96-atomicity-of-variable-references) — ECMA / Microsoft, living. Rank 1. Backs: which types the language guarantees atomic. [^spec-atomic]
- [volatile (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/volatile) — Microsoft, living. Rank 1. Backs: allowed field types; no guarantee of the latest value; prefer `Interlocked` and `lock`. [^kw-volatile]
- [Volatile class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.volatile) — Microsoft, living. Rank 1. Backs: the data-and-flag guarantee; 64-bit atomicity on 32-bit processors; use on array elements; `ReadBarrier` and `WriteBarrier` from .NET 10. [^api-volatile]
- [Interlocked.MemoryBarrier](https://learn.microsoft.com/en-us/dotnet/api/system.threading.interlocked.memorybarrier) — Microsoft, living. Rank 1. Backs: wraps `Thread.MemoryBarrier`. [^api-interlocked]
- [Lazy initialization](https://learn.microsoft.com/en-us/dotnet/framework/performance/lazy-initialization) — Microsoft, living. Rank 1. Backs: thread-safety modes; `PublicationOnly` races; exception caching; `LazyInitializer`. [^lazy-init]
- [LazyInitializer.EnsureInitialized](https://learn.microsoft.com/en-us/dotnet/api/system.threading.lazyinitializer.ensureinitialized) — Microsoft, living. Rank 1. Backs: several instances may be created, one is stored. [^api-lazyinit]

## Related
- `dotnet/concurrency/locks-and-interlocked.md` — the primitives whose ordering guarantees are listed here.
- `dotnet/concurrency/threads-and-the-thread-pool.md` — the threads that observe each other's memory.
- `dotnet/runtime/jit-tiering-and-aot.md` — tiered compilation and why Release and Debug code differ.
- `concurrency/shared-state-and-data-races.md` — data races in other languages.
