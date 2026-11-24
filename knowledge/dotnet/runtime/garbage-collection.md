---
schema: knowledge-doc/v1
type: concept
topic: dotnet/runtime
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, gc, garbage-collector, generations, large-object-heap, pinned-object-heap, server-gc, background-gc, datas, latency-mode, no-gc-region, weak-reference, write-barrier]
ranked-sources: true
---

# The .NET garbage collector

## Summary
**TL;DR:** The GC (garbage collector) hands out memory by bumping a pointer inside a per-thread chunk, and reclaims it by finding everything still reachable from roots (statics, stack variables, registers, handles) and compacting the survivors. Objects start in generation 0; survivors move to 1 and then 2, and collecting a generation also collects the younger ones, so short-lived objects are cheap and long-lived ones are scanned rarely. Objects of 85,000 bytes or more go to the large object heap, which is collected only with generation 2: one extra byte per buffer turned 0 full collections into 540 in the lab. Workstation GC (the default) uses one heap; Server GC uses one heap per core and a much larger allocation budget; DATAS (dynamic adaptation to application sizes), on by default for Server GC since .NET 9, shrinks that heap to fit the app, but not on macOS.
**Use this when:** a process collects too often or uses more memory than expected, you see generation-2 collections in counters, you choose between workstation and server GC or tune `runtimeconfig` knobs, or you consider `GC.Collect`, latency modes, no-GC regions or weak references.
**Not this doc:** finalizers, `IDisposable` and `SafeHandle` → `dotnet/errors-and-resources/disposal-and-finalization.md`; what one object costs in bytes and when boxing allocates → `dotnet/runtime/object-layout-and-boxing.md`; finding and removing allocations → `dotnet/performance/measuring-and-reducing-allocations.md`; the JIT (just-in-time compiler) → `dotnet/runtime/jit-tiering-and-aot.md`.

## Problem
Memory in .NET is automatic, but its cost is not uniform, and the knobs are easy to misread (lab numbers, from the Worked example and Edge cases below):
- Two buffer sizes that differ by one byte cause 0 and 540 full (generation 2) collections for the same work.
- The same allocation-heavy code peaked at 36 MB of committed memory under the default GC and at about 830 MB under Server GC, which hosts such as ASP.NET can turn on.
- `GC.Collect()` looks free in a test with an empty heap and takes about 15 ms once two million objects are alive.
- An object that should be unreachable stays alive in a test, so a weak reference never clears.
- Turning on DATAS on a Mac changes nothing.

## Mental model
**Analogy:** a restaurant kitchen with three shelves. New dishes go on the front shelf (generation 0), which is cleared very often; anything still in use when it is cleared moves to the middle shelf (generation 1), then to the back shelf (generation 2), which is cleared rarely because clearing it means checking every shelf. Huge trays never go on the front shelf: they go straight to a separate rack (the large object heap) that is cleared only when the back shelf is, so piling up huge trays forces back-shelf clean-ups.

**Artifact** (Release build, workstation GC, run in the lab ✅[^lab]):
```csharp
var survivor = new object();
Console.Write(GC.GetGeneration(survivor));               // 0
GC.Collect(0); Console.Write(GC.GetGeneration(survivor)); // 1
GC.Collect(1); Console.Write(GC.GetGeneration(survivor)); // 2
Console.WriteLine($" {GC.GetGeneration(new byte[84_975])} {GC.GetGeneration(new byte[84_976])}"); // 0 2
// prints 012 0 2: an array of 84,976 bytes is an 85,000-byte object and starts in the large object heap
```

## How it works
**Four actors:**
- **The allocator** — its job: give each new object zeroed memory, via a per-thread allocation context on the managed heap.
- **The JIT-compiled code** — its job: record writes of references into older objects, via write-barrier helpers that set cards.
- **The collector** — its job: find live objects from the roots and reclaim the rest, via mark, plan, relocate and compact (or sweep) phases.
- **The configuration** — its job: choose the flavour and limits, via `runtimeconfig.json`, MSBuild properties or `DOTNET_` environment variables.

```
 thread A ─ new ─▶ [alloc context A: bump pointer] ┐
 thread B ─ new ─▶ [alloc context B: bump pointer] ┼─▶ gen0 ──survive──▶ gen1 ──survive──▶ gen2
 obj ≥ 85,000 B ──────────────────────────────────▶ LOH (collected only with gen2)
 GC.AllocateArray(pinned: true) ──────────────────▶ POH (pinned object heap)
 budget exceeded ─▶ suspend managed threads ─▶ mark from roots (+ cards for old→young refs)
                 ─▶ plan ─▶ compact or sweep ─▶ resume
```

1. **Allocator: a pointer bump.** The managed heap keeps a pointer to where the next object goes, and allocating adds the object's size to it, which is almost as fast as stack allocation and keeps objects allocated together close together ✅[^gc-fund]. Each thread gets its own *allocation context*, a chunk of usually 8 KB, so allocating needs no lock until the chunk is used up; the GC zeroes that memory in advance ✅[^botr-gc]. All threads of a process allocate on the same managed heap ✅[^gc-fund].
2. **Allocator → collector: when a GC starts.** A collection runs when the allocation budget (a threshold the collector sets and keeps adjusting) is exceeded, when the operating system reports low memory, or when code calls `GC.Collect` ✅[^gc-fund] ✅[^botr-gc]. Before it starts, all managed threads except the triggering one are suspended ✅[^gc-fund].
3. **Collector: generations.** New small objects go to generation 0; objects that survive a collection are promoted, 0 to 1 and 1 to 2, and stay in 2; collecting generation N also collects every younger one, so a generation-2 collection is a full collection ✅[^gc-fund]. When many objects survive a generation, its budget grows ✅[^gc-fund]. The lab's artifact shows the promotions ✅[^lab].
4. **Collector: roots and marking.** Roots are static fields, local variables on thread stacks, CPU (processor) registers, GC handles and the finalization queue; whatever the roots do not reach is garbage ✅[^gc-fund]. The JIT decides how long a stack variable stays reported, so optimization can shorten or lengthen a local's life ✅[^gc-fund]; in the lab, a discarded `out _` value in an unoptimized `Main` kept an object alive until the check moved into a separate method ✅[^lab].
5. **JIT code → collector: cards and write barriers.** To collect generation 0 without scanning generation 2, the JIT inserts a write barrier on every store of a reference into a heap object; the helper marks a *card* (a byte that covers a small range of the heap) when the stored reference points into the young generations, and an ephemeral collection scans only objects under marked cards ✅[^botr-gc] ✅[^wn10]. .NET 10 brought the x64 ability to switch write-barrier implementations to Arm64, with a new default that handles GC regions more precisely and cut GC pauses by 8% to over 20% in Microsoft's benchmarks ✅[^wn10]; regions themselves are off on macOS (item 8).
6. **Collector: plan, relocate, compact.** The plan phase simulates compaction and compacts only if that is productive, otherwise it sweeps ✅[^botr-gc]; compaction moves survivors together and fixes every reference to them ✅[^gc-fund].
7. **Large and pinned objects.** An object of 85,000 bytes or more goes to the large object heap (LOH), which is logically part of generation 2 and is swept rather than compacted unless you set `GCSettings.LargeObjectHeapCompactionMode` or run under a hard memory limit ✅[^gc-fund]. Allocating there consumes the LOH's own budget, and exceeding either the LOH or the generation-2 budget triggers a generation-2 collection ✅[^gc-loh]. The threshold is `System.GC.LOHThreshold` (only values above 85,000 are allowed) ✅[^rc-gc]. `GC.AllocateArray<T>(length, pinned: true)` allocates an array that the GC will not move ✅[^api-gc]; it lives in the pinned object heap (POH), the third heap next to the small object heap and the LOH ✅[^rc-gc], and the lab reported generation 2 for it ✅[^lab].
8. **Physical layout: regions, except on macOS.** Since .NET 7 the 64-bit GC on Windows and Linux manages memory in regions (4 MB each for small objects) instead of segments ✅[^rc-gc]; the .NET 10 GC source turns regions off for macOS builds ✅[^src-gcpriv].
9. **Flavours.** Workstation GC is the default for standalone apps and collects on the thread that triggered it; Server GC gives each logical CPU its own heap and dedicated GC thread, collects in parallel, and can be resource-heavy when many processes use it on one machine; for hosted apps, such as those hosted by ASP.NET, the host chooses the default ✅[^gc-ws]. Background GC is on by default: generation-2 collections run on a dedicated thread while generation-0 and -1 (foreground) collections can still happen ✅[^gc-bg]. The switches are `System.GC.Server` / `ServerGarbageCollection` / `DOTNET_gcServer` and `System.GC.Concurrent` / `ConcurrentGarbageCollection` / `DOTNET_gcConcurrent` ✅[^rc-gc].
10. **DATAS.** Dynamic adaptation to application sizes keeps the heap roughly proportional to the long-lived data: it starts Server GC with one heap and adds or removes heaps as needed; it was opt-in in .NET 8 and is on by default since .NET 9 ✅[^gc-datas]. Without a `ConserveMemory` setting it uses 5 ✅[^rc-gc]. In the .NET 10 source, changing the heap count exists only with regions and multiple heaps ✅[^src-gcpriv], so on macOS the setting has no effect (Edge cases).
11. **Latency modes.** `GCSettings.LatencyMode` is `Interactive` by default, `Batch` when background GC is off; `LowLatency` (workstation only) and `SustainedLowLatency` (needs background GC) suppress blocking generation-2 collections for a while ✅[^gc-latency]. `GC.TryStartNoGCRegion(size)` asks for a stretch with no collection at all: it may first run a full blocking collection to make room, calls cannot nest, and `GC.EndNoGCRegion` ends it ✅[^api-nogc].
12. **Induced collections and weak references.** `GC.Collect` is meant for rare cases such as just after a large amount of memory stopped being used; `GCCollectionMode.Optimized` lets the GC skip an unproductive collection ✅[^gc-induced]. A `WeakReference<T>` lets the GC collect its target while code can still try to get it back; short weak references clear at collection, long ones survive finalization, and they are not worth it for small objects ✅[^gc-weak]. Finalizable objects are kept alive through the finalization queue ✅[^gc-fund]; their lifecycle is in `dotnet/errors-and-resources/disposal-and-finalization.md`.

## Worked example
Twenty thousand temporary byte buffers, about 1.7 GB in total, allocated in a loop and dropped at once, measured with `GC.CollectionCount` per generation on the lab's Apple M2 (Release build, workstation GC, two runs gave the same counts) ✅[^lab].

| Step | Buffer | Object size | `GC.GetGeneration` | gen0 GCs | gen1 GCs | gen2 GCs | Time |
|---|---|---|---|---|---|---|---|
| 1 | `new byte[84_975]` | 84,999 bytes (24-byte array header + data) | 0 | 202 | 20 | 0 | about 55 ms |
| 2 | `new byte[84_976]` | 85,000 bytes | 2 (LOH) | 540 | 540 | 540 | 70–96 ms |
| 3 | `ArrayPool<byte>.Shared.Rent(84_976)` and `Return` | the pool hands out a 131,072-byte array, reused | — | 0 | 0 | 0 | under 1 ms |

Step 2 crossed the LOH threshold by one byte: every allocation now consumed the LOH budget, each exhausted budget triggered a generation-2 collection, and `CollectionCount(0)` and `(1)` rose with it because a full collection also collects the younger generations (How it works 3, 7). Step 3 allocated once and reused the array. The same probe's other numbers: 200 MB of 32-byte objects caused 23 generation-0 collections under workstation GC and 2 under `DOTNET_gcServer=1`, whose generation-0 budget (`GCGen0MaxBudget` in `GC.GetConfigurationVariables()`) was 209,715,200 bytes (200 MiB) instead of 8 MiB ✅[^lab].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Server GC with DATAS on or off, on macOS | Identical results in the lab: 20 generation-0 collections and about 830 MB peak committed memory either way, against 36 MB under workstation GC; `GetConfigurationVariables()` still reported `GCDynamicAdaptationMode=1` ✅[^lab] | DATAS needs a dynamic heap count, which the GC builds only with regions, and regions are off for macOS ✅[^src-gcpriv]; the DATAS page does not mention the platform limit ✅[^gc-datas] |
| `GC.Collect()` with a big live heap | 0.1 ms with an empty heap, about 7 ms with 1 million live arrays, about 15 ms with 2 million ✅[^lab] | A full blocking collection marks every live object ✅[^gc-fund] |
| `TryStartNoGCRegion(16 MB)` | Returned `true`, ran 1 collection itself, then 12 MB of allocations caused 0 collections; a second `EndNoGCRegion()` threw `InvalidOperationException`; `TryStartNoGCRegion(long.MaxValue)` threw `ArgumentOutOfRangeException` ✅[^lab] | It may collect first to commit the memory, and the size must fit the ephemeral space ✅[^api-nogc] |
| `SustainedLowLatency` with `DOTNET_gcConcurrent=0` | The mode stayed `Batch` ✅[^lab] | The mode needs background GC ✅[^gc-latency] |
| A weak reference checked with `TryGetTarget(out _)` directly in `Main` | Still alive after the last strong reference was cleared and `GC.Collect()` ran ✅[^lab] | The hidden local for the discarded value lives in the unoptimized `Main` frame; stack reporting depends on the JIT ✅[^gc-fund] |
| Server GC on a one-CPU machine | Workstation GC is used whatever the setting ✅[^gc-ws] | Server GC needs several cores to make sense |
| The LOH documentation page | Describes Windows only ✅[^gc-loh] | The threshold and the generation-2 coupling behaved the same on macOS arm64 in the lab ✅[^lab] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Workstation GC (default) | Small heap, one GC thread; 36 MB peak in the DATAS probe ✅[^lab] | Collections run on the allocating thread and more often |
| Server GC | Parallel collections, fewer of them, high throughput ✅[^gc-ws] | Heaps and threads per core; 830 MB peak in the same probe ✅[^lab]; heavy when many processes share a machine ✅[^gc-ws] |
| Server GC + DATAS (Windows, Linux) | Heap follows the live data size ✅[^gc-datas] | More generation-0 and -1 collections, slightly lower peak throughput ✅[^gc-datas] |
| `System.GC.ConserveMemory` 1–9 | Smaller heap; the LOH is compacted when fragmented ✅[^rc-gc] | More frequent collections, possibly longer pauses ✅[^rc-gc] |
| `GC.Collect()` by hand | Memory back right after a known peak ✅[^gc-induced] | A full blocking pause that grows with the live heap |

## Takeaways
- Keep temporary buffers under 85,000 bytes, or rent them from `ArrayPool<T>.Shared`; temporary large objects drive full collections. [rule-candidate]
- Do not call `GC.Collect()` in request paths; measure `GC.CollectionCount(2)` before tuning anything. [rule-candidate]
- Pick the GC flavour deliberately (`ServerGarbageCollection`, `ConcurrentGarbageCollection`) and check it at startup with `GCSettings.IsServerGC`, because hosts change the default.
- Test weak-reference and "object is collected" logic in a separate non-inlined method on a Release build.

## Verification status
- Verified: 62 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Fundamentals of garbage collection](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/fundamentals) — Microsoft, living. Rank 1. Backs: pointer-bump allocation; triggers; generations and promotion; roots; JIT-dependent stack reporting; phases; thread suspension; LOH threshold and compaction. [^gc-fund]
- [Workstation and server garbage collection](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/workstation-server-gc) — Microsoft, living. Rank 1. Backs: the two flavours, threads and heaps per CPU, the single-CPU rule, many-process contention. [^gc-ws]
- [Background garbage collection](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/background-gc) — Microsoft, living. Rank 1. Backs: generation-2 collections in the background with foreground ephemeral collections. [^gc-bg]
- [The large object heap on Windows systems](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/large-object-heap) — Microsoft, living. Rank 1. Backs: LOH and generation-2 budgets trigger generation-2 collections; the page covers Windows only. [^gc-loh]
- [Dynamic adaptation to application sizes (DATAS)](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/datas) — Microsoft, living. Rank 1. Backs: what DATAS does; default since .NET 9; its costs. [^gc-datas]
- [Latency modes](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/latency) — Microsoft, living. Rank 1. Backs: the four modes, defaults and limits. [^gc-latency]
- [Induced collections](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/induced) — Microsoft, living. Rank 1. Backs: when `GC.Collect` makes sense; `GCCollectionMode`. [^gc-induced]
- [Weak references](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/weak-references) — Microsoft, living. Rank 1. Backs: short and long weak references and when to avoid them. [^gc-weak]
- [Runtime configuration options for garbage collection](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector) — Microsoft, living. Rank 1. Backs: flavour switches; LOH threshold; POH; regions since .NET 7; conserve memory; DATAS settings and its default conserve level. [^rc-gc]
- [GC.AllocateArray](https://learn.microsoft.com/en-us/dotnet/api/system.gc.allocatearray) — Microsoft, living. Rank 1. Backs: `pinned: true` allocates a pinned array. [^api-gc]
- [GC.TryStartNoGCRegion](https://learn.microsoft.com/en-us/dotnet/api/system.gc.trystartnogcregion) — Microsoft, living. Rank 1. Backs: a full blocking GC may run first; no nesting; `EndNoGCRegion`. [^api-nogc]
- [What's new in the .NET 10 runtime](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/runtime) — Microsoft, 2025. Rank 1. Backs: write barriers; the new Arm64 write-barrier default and its pause gains. [^wn10]
- [Garbage Collection Design (Book of the Runtime)](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/botr/garbage-collection.md) — Maoni Stephens, .NET runtime team, 2015. Rank 1. Backs: allocation contexts and quantum; zeroing; budgets; cards; plan phase. [^botr-gc]
- [gcpriv.h (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/coreclr/gc/gcpriv.h) — .NET runtime team, 2025. Rank 1. Backs: regions disabled for macOS builds; dynamic heap count only with regions and multiple heaps. [^src-gcpriv]

## Related
- `dotnet/errors-and-resources/disposal-and-finalization.md` — finalizers, the finalization queue and `SafeHandle`.
- `dotnet/runtime/object-layout-and-boxing.md` — how many bytes each object costs and which allocations the JIT removes.
- `dotnet/performance/measuring-and-reducing-allocations.md` — counting allocations and collections, `ArrayPool<T>`.
- `dotnet/runtime/jit-tiering-and-aot.md` — the JIT that inserts write barriers and reports stack roots.
