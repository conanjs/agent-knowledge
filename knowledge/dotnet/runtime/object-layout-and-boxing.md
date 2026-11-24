---
schema: knowledge-doc/v1
type: concept
topic: dotnet/runtime
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "64-bit processes", ".NET 11.0.0 (container lab) for closure allocation"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, object-header, methodtable, object-size, struct-layout, structlayout, boxing, unboxing, virtual-dispatch, vtable, virtual-stub-dispatch, devirtualization, guarded-devirtualization, escape-analysis, stack-allocation]
ranked-sources: true
---

# Object layout, boxing and method dispatch

## Summary
**TL;DR:** On a 64-bit runtime every heap object carries 16 bytes of overhead, an 8-byte object header in front of it and an 8-byte pointer to its type's MethodTable at its start, and no object is smaller than 24 bytes; arrays add a length word. Struct fields are laid out in declaration order with padding unless the runtime may reorder them. Boxing copies a value type into a new 24-byte-or-larger heap object whenever it is converted to `object` or to an interface. A virtual call goes object → MethodTable → slot → code; an interface call goes through a stub. The optimizing JIT (just-in-time compiler) removes much of this: it devirtualizes calls on sealed or exactly known types, guesses the type from profile data (guarded devirtualization), and puts objects that never leave a method on the stack (boxes since .NET 9; small arrays, struct-field referents and delegates since .NET 10), so the same code allocates 24 to 48 bytes per call at tier 0 and nothing at tier 1.
**Use this when:** you need the real size of an object or struct, an allocation profile shows `System.Int32` or other boxed value types, a struct's size surprises you, or you want to know why a virtual or interface call is (or is not) cheap.
**Not this doc:** tiers, PGO (profile-guided optimization) and how to see JIT output → `dotnet/runtime/jit-tiering-and-aot.md`; how the heap reclaims objects → `dotnet/runtime/garbage-collection.md`; class versus struct versus record from the language side → `dotnet/type-design/classes-structs-and-records.md`; `virtual`, `override` and interfaces in C# → `dotnet/type-design/inheritance-and-interfaces.md`; interop layout for native code → `dotnet/metaprogramming/interop-and-unsafe.md`.

## Problem
Allocation numbers rarely match a naive count of fields (lab numbers, from the Artifact and Worked example below):
- `new object()` costs 24 bytes, and so does a class with one `int`.
- A struct of `byte`, `long`, `byte` takes 24 bytes; the same three fields with `LayoutKind.Auto` take 16.
- `((Opt)i).HasFlag(Opt.B)` allocated 48 bytes on its first call and none later.
- Iterating a `List<int>` through `IEnumerable<int>` allocated a 40-byte enumerator until the JIT optimized the method, and kept allocating it with Dynamic PGO turned off.
- A `string.Format("{0}", i)` call costs 24 bytes more than `$"{i}"` for the same text.

## Mental model
**Analogy:** a warehouse where every parcel, however small, gets a shipping label (the object header) and a barcode that points to its catalogue entry (the MethodTable pointer); the catalogue entry lists the parcel's size, which slots hold references, and a table of "how to do X" instructions (the virtual-method slots). A loose item (a value type) costs nothing extra until someone needs to ship it on its own: then it is boxed, labelled and barcoded, and the box is a new parcel. A clever clerk who already knows what is inside (devirtualization) skips the catalogue lookup, and one who sees that a parcel never leaves the room (escape analysis) does not ship it at all.

**Artifact** (sizes from `GC.GetAllocatedBytesForCurrentThread` around one allocation stored in a static field, Release build ✅[^lab]):
```csharp
Cost(() => new object())       // 24
Cost(() => new TwoLongs())     // 32   class TwoLongs { long A, B; }
Cost(() => new byte[0])        // 24
Cost(() => new byte[9])        // 40   24 + 9, rounded up to a multiple of 8
Cost(() => (object)42)         // 24   a boxed int
Unsafe.SizeOf<Seq>()           // 24   struct Seq  { byte B; long L; byte C; }
Unsafe.SizeOf<Auto>()          // 16   same fields, [StructLayout(LayoutKind.Auto)]
```

## How it works
**Four actors:**
- **The C# compiler** — its job: emit boxing, `callvirt` and `constrained.` calls and the default `StructLayout`, via IL (intermediate language) in the assembly.
- **The type loader** — its job: build each type's MethodTable (size, field offsets, reference map, virtual slots), via the runtime's class loader.
- **The JIT** — its job: turn calls into direct, guarded or indirect calls and decide where objects live, via devirtualization and escape analysis.
- **The GC (garbage collector)** — its job: read each object's MethodTable to learn its size and references, via the pointer at the object's start.

```
           object reference ──┐
                              ▼
 [ object header 8 B ][ MethodTable* 8 B ][ fields ... ]      (array: + length 8 B, then elements)
                              │
                              ▼
                     MethodTable: base size, GC reference map, ...
                              │  + 0x40 ─▶ vtable chunk ─ + 0x20 ─▶ code of the virtual method (arm64 lab disasm)
 interface call ─▶ call site cell ─▶ lookup stub ─▶ dispatch stub (one type) / resolve stub (many types)
```

1. **Type loader: the object's two words.** The first field of every object on the GC heap points to a runtime structure for its type ✅[^botr-intro], the MethodTable, which also tells the GC how the instance's fields are laid out ✅[^botr-typesys]. In front of the object, at a negative offset, sits a machine-word object header used for the hash code, the lock state and the index of a sync block when more room is needed ✅[^botr-threading] ✅[^src-object]. The runtime defines the minimum object size as two pointers plus the header, 24 bytes on 64-bit ✅[^src-object], which is what `new object()`, an empty class and a class with one `int` cost in the lab ✅[^lab]. Arrays also store their length ✅[^botr-intro] ✅[^src-object]; `byte[0]` cost 24 bytes, `byte[1]` 32, `int[10]` 64, `object[10]` 104 ✅[^lab].
2. **Compiler and loader: field layout.** The runtime's default is `LayoutKind.Auto`, but C# applies `Sequential` to structs; classes get `Sequential` only when you ask ✅[^api-layoutkind] ✅[^api-structlayout]. `Sequential` fixes the managed layout only for blittable types (those whose managed and native layouts are the same, such as primitives); for others it controls only the marshalled layout ✅[^api-structlayout]. Fields align to their own size unless `Pack` says otherwise ✅[^api-structlayout]. In the lab, `{ byte, long, byte }` was 24 bytes as a struct (offsets 0, 8, 16), 16 with `Auto`, 10 with `Pack = 1`, and a struct `{ byte, string, byte }` was 16 bytes because the reference made it non-blittable and the runtime reordered it ✅[^lab].
3. **Measuring.** `Unsafe.SizeOf<T>()` returns the size of the managed view of a value; for a reference type it returns the size of the reference ✅[^api-sizeof]. `GC.GetAllocatedBytesForCurrentThread()` counts the bytes the current thread has allocated over its lifetime ✅[^api-allocated], so the difference around one allocation is that object's heap size ✅[^lab]. Store the object somewhere that outlives the method: since .NET 10 an object that never escapes may not be allocated on the heap at all (step 7).
4. **Compiler: boxing.** Converting a value type to `object` or to an interface it implements boxes it: a new heap object is allocated and the value is copied into it; unboxing checks the type and copies the value back ✅[^boxing]. The common sources are `object` parameters (`string.Format`, non-generic collections), interface-typed variables (`IComparable<int> c = i`) and calls through an interface on a struct. A generic method constrained to the interface (`where T : IComparable<T>`) calls the struct's method without boxing: 0 bytes in the lab at every tier ✅[^lab]. An interpolated string assigned to `string` is built by `DefaultInterpolatedStringHandler` ✅[^interp]; in the lab `$"{i}"` cost 32 bytes (the result string) and `string.Format("{0}", i)` 56 (the string plus a 24-byte box) ✅[^lab].
5. **JIT: virtual dispatch.** In the lab's arm64 disassembly, the fallback path of a virtual call loads the MethodTable pointer from the object, then a pointer at MethodTable + 0x40, then the slot at + 0x20, and calls it: three dependent loads and an indirect call ✅[^lab]. Interface calls use virtual stub dispatch (VSD): a call site starts with a lookup stub, moves to a dispatch stub that checks for the one type it has seen, and back-patches to a resolve stub with a global cache when the site turns out polymorphic ✅[^botr-vsd]. VSD is used only for interface calls, not for ordinary virtual calls ✅[^botr-vsd].
6. **JIT: devirtualization.** The JIT turns a virtual call into a direct one when it knows the object's exact type (for example right after `new`) or when the declared type or method is `sealed` ✅[^gdv]. With Dynamic PGO it adds *guarded devirtualization*: a class test in front of the call, with a direct, inlinable call when the test passes ✅[^pgo-doc]. In the lab the tier-1 code of `double ViaBase(Shape s) => s.Area()` compared the object's MethodTable with `Circle`'s and returned the inlined `3.0` on a match, keeping the three-load virtual call only for other types; `ViaSealed(SealedCircle s)` became a null check and `3.0` ✅[^lab]. .NET 10 can also devirtualize and inline the interface methods of arrays ✅[^wn10].
7. **JIT: escape analysis and stack allocation.** An object *escapes* when it is stored in a non-local location or passed to a method that is not inlined; if it cannot escape, the JIT may put it on the stack ✅[^wn10]. .NET 9 did this for boxes ✅[^wn9]; .NET 10 adds small arrays of value types and of references, objects referenced from local struct fields, and delegates (but not yet their closure objects) ✅[^wn10]. With Dynamic PGO, a guarded fast path can also prove that an enumerator obtained through `IEnumerable<T>` does not escape and stack-allocate it ✅[^perf10]. The JIT setting `JitObjectStackAllocation` (default 1) is honoured by release runtimes ✅[^src-jitconfig], so `DOTNET_JitObjectStackAllocation=0` shows what the optimization saves ✅[^lab].

## Worked example
Eleven small methods, each called once cold (tier-0 code) and then 1,000 times after 800 warm-up calls with sleeps (tier-1 code, confirmed with `DOTNET_JitDisasmSummary=1`), measured with `GC.GetAllocatedBytesForCurrentThread` in a Release build ✅[^lab].

| Method body | First call (tier 0) | After warm-up (tier 1) | Tier 1 with `DOTNET_JitObjectStackAllocation=0` | Tier 1 with `DOTNET_TieredPGO=0` |
|---|---|---|---|---|
| `sink = i;` (box stored in a static field) | 96 B (includes the class's static constructor) | 24 B | 24 B | — |
| `object o = i; return (int)o + 1;` | 0 B | 0 B | 0 B | — |
| `IComparable<int> c = i; return c.CompareTo(0);` | 24 B | 0 B | 0 B | 0 B |
| `Cmp(i, 0)` with `where T : IComparable<T>` | 0 B | 0 B | 0 B | — |
| `string.Format("{0}", i)` | 56 B | 56 B | 56 B | — |
| `$"{i}"` | 32 B | 32 B | 32 B | — |
| `((Opt)i).HasFlag(Opt.B)` | 48 B | 0 B | 0 B | — |
| `foreach` over a `List<int>` typed `IEnumerable<int>` | 40 B | 0 B | 40 B | 40 B |
| `foreach` over the `List<int>` itself | 0 B | 0 B | 0 B | — |
| `var p = new Point(i, i); return p.X + p.Y;` (class) | 24 B | 0 B | 24 B | — |
| `int[] a = [i, i, i]; return a[0] + a[1] + a[2];` | 40 B | 0 B | 40 B | — |

How to read it. The box that escapes to a field always costs 24 bytes. The box, `HasFlag` and the interface variable lose their allocation at tier 1 even without stack allocation, because the optimizing JIT removes the box entirely (the box/unbox pair even at tier 0). The class instance, the small array and the enumerator vanish only with stack allocation on, and the enumerator needs Dynamic PGO as well, because only the profile tells the JIT that the `IEnumerable<int>` is a `List<int>`. `foreach` over `List<int>` directly uses its struct enumerator and never allocates. A dash (—) means not measured.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Measuring an object's size with a local that is never used again | A `.NET 10` tier-1 method can report 0 bytes ✅[^lab] | The object did not escape and was stack-allocated ✅[^wn10]; store it in a static field to measure heap size |
| `Marshal.SizeOf<Seq>()` versus `Unsafe.SizeOf<Seq>()` | Both 24 for a blittable struct ✅[^lab] | `Unsafe.SizeOf` is the managed size; the marshalled size can differ for non-blittable types ✅[^api-sizeof] |
| A class with `byte, long, byte` fields | 32 bytes, not the 40 that 16 bytes of overhead plus the 24-byte struct layout would give ✅[^lab] | Classes default to auto layout ✅[^api-layoutkind], so the runtime packs the two bytes together after the `long` |
| Boxed `Guid` | 32 bytes ✅[^lab] | 16 bytes of overhead plus the 16-byte value |
| The same probe as a Debug build | `foreach` over `IEnumerable<int>` kept allocating 40 B, `HasFlag` 48 B, the local class 24 B and the small array 40 B per call after warm-up ✅[^lab] | A Debug build is never optimized (see `dotnet/runtime/jit-tiering-and-aot.md`), so no devirtualization or stack allocation |
| Delegates and closures | .NET 10 stack-allocates a non-escaping delegate, but its closure object is still a heap allocation ✅[^wn10]. In the lab, at tier 1 in a Release build, a lambda capturing one `int` and invoked inside its own method cost 24 B per call, the closure, while its delegate stayed off the heap: 88 B with `DOTNET_JitObjectStackAllocation=0`; a non-capturing lambda and a capturing local function cost 0 B ✅[^lab]. .NET 11.0.0 in the container gave the same 24 B (80 B with stack allocation off) ✅[^lab11] | Closure stack allocation is planned for a later release ✅[^wn10]; .NET 11.0.0 does not do it yet ✅[^lab11] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Struct instead of a small class | No 16-byte header, no heap allocation when used as a local or array element | Copied on every assignment; boxed when used as `object` or an interface |
| `[StructLayout(LayoutKind.Auto)]` on a struct | Smaller (16 versus 24 bytes in the lab) | Field order no longer fixed; the type cannot be marshalled to native code ✅[^api-layoutkind] |
| `sealed` classes | Calls devirtualize and inline without a profile ✅[^gdv] | No subclassing |
| Generic constraints instead of interface parameters for structs | No box per call ✅[^lab] | One native copy of the generic method per value type |

## Takeaways
- Budget 16 bytes of overhead per heap object and a 24-byte minimum on 64-bit; budget 24 bytes for every box. [rule-candidate]
- Pass structs to generic methods constrained to an interface instead of to interface-typed parameters, to avoid boxing. [rule-candidate]
- Seal classes that are not designed for inheritance; it lets the JIT devirtualize without profile data.
- When measuring allocations, store the object in a field and run a Release build after warm-up, or the JIT's stack allocation hides the cost.

## Verification status
- Verified: 52 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [Boxing and unboxing](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/types/boxing-and-unboxing) — Microsoft, living. Rank 1. Backs: what boxing and unboxing do, when they happen, their cost. [^boxing]
- [StructLayoutAttribute class](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.structlayoutattribute) — Microsoft, living. Rank 1. Backs: C# applies Sequential to structs; Sequential and managed layout for blittable types only; `Pack`. [^api-structlayout]
- [LayoutKind enum](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.layoutkind) — Microsoft, living. Rank 1. Backs: Auto is the runtime default; Auto types cannot be exposed to unmanaged code. [^api-layoutkind]
- [Unsafe.SizeOf](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.unsafe.sizeof) — Microsoft, living. Rank 1. Backs: managed size; reference types return the reference size. [^api-sizeof]
- [GC.GetAllocatedBytesForCurrentThread](https://learn.microsoft.com/en-us/dotnet/api/system.gc.getallocatedbytesforcurrentthread) — Microsoft, living. Rank 1. Backs: bytes allocated by the current thread over its lifetime. [^api-allocated]
- [String interpolation](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/interpolated) — Microsoft, living. Rank 1. Backs: an interpolated `string` is processed by `DefaultInterpolatedStringHandler`. [^interp]
- [What's new in the .NET 10 runtime](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/runtime) — Microsoft, 2025. Rank 1. Backs: array interface devirtualization; escape analysis; stack allocation of small arrays, struct-field referents and delegates; closures not yet. [^wn10]
- [What's new in the .NET 9 runtime](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-9/runtime) — Microsoft, 2024. Rank 1. Backs: object stack allocation for boxes. [^wn9]
- [Introduction to the Common Language Runtime (Book of the Runtime)](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/botr/intro-to-clr.md) — .NET runtime team, living. Rank 1. Backs: every heap object starts with a pointer to its type; arrays carry their size. [^botr-intro]
- [Type System Overview (Book of the Runtime)](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/botr/type-system.md) — .NET runtime team, living. Rank 1. Backs: the MethodTable at the head of every object describes its GC layout. [^botr-typesys]
- [Threading (Book of the Runtime)](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/botr/threading.md) — .NET runtime team, living. Rank 1. Backs: the machine-word object header before every object; hash code, lock state, sync blocks. [^botr-threading]
- [object.h (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/coreclr/vm/object.h) — .NET runtime team, 2025. Rank 1. Backs: header at a negative offset; `MIN_OBJECT_SIZE`; the array base layout. [^src-object]
- [Virtual Stub Dispatch (Book of the Runtime)](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/botr/virtual-stub-dispatch.md) — Simon Hall, .NET runtime team, 2006. Rank 1. Backs: lookup, dispatch and resolve stubs; VSD only for interface calls. [^botr-vsd]
- [Guarded Devirtualization](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/jit/GuardedDevirtualization.md) — .NET runtime team, 2019. Rank 1. Backs: devirtualization needs an exact or sealed type. [^gdv]
- [Dynamic PGO](https://github.com/dotnet/runtime/blob/main/docs/design/features/DynamicPgo.md) — .NET runtime team, living. Rank 1. Backs: guarded devirtualization inserts a class test and inlines on success. [^pgo-doc]
- [jitconfigvalues.h (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/coreclr/jit/jitconfigvalues.h) — .NET runtime team, 2025. Rank 1. Backs: `JitObjectStackAllocation` is a release setting, default 1. [^src-jitconfig]
- [Performance Improvements in .NET 10](https://devblogs.microsoft.com/dotnet/performance-improvements-in-net-10/) — Stephen Toub, .NET Blog, 2025. Rank 4. Backs: PGO plus conditional escape analysis stack-allocates enumerators. [^perf10]

## Related
- `dotnet/runtime/jit-tiering-and-aot.md` — tiers, Dynamic PGO and `DOTNET_JitDisasm`.
- `dotnet/runtime/garbage-collection.md` — what happens to the objects counted here.
- `dotnet/type-design/classes-structs-and-records.md` — choosing class, struct or record.
- `dotnet/type-design/inheritance-and-interfaces.md` — `virtual`, `sealed` and interfaces in the language.
- `dotnet/generics/generics-and-constraints.md` — why a constrained generic call does not box.
- `dotnet/performance/measuring-and-reducing-allocations.md` — finding these allocations in real code.
