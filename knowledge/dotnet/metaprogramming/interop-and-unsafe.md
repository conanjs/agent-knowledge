---
schema: knowledge-doc/v1
type: concept
topic: dotnet/metaprogramming
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "macOS 26.1 arm64 (libSystem) for the native calls", ".NET 11.0.0 / C# 15 (container lab) for the memory-safety preview"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, unsafe, pointers, fixed, stackalloc, function-pointers, pinvoke, dllimport, libraryimport, marshalling, blittable, nativememory, gchandle, unmanagedcallersonly, nint, skiplocalsinit]
ranked-sources: true
---

# Unsafe code and native interop

## Summary
**TL;DR:** `unsafe` code (compiled only with `AllowUnsafeBlocks`) lets C# use raw pointers: take addresses, do pointer arithmetic, pin managed objects with `fixed`, and call through function pointers, all without bounds checks or garbage-collector (GC) tracking. Platform invoke (P/Invoke) calls C functions in native libraries: `[DllImport]` has the runtime build the marshalling code at run time, while `[LibraryImport]` (.NET 7) has a source generator write it at compile time, which is the recommended form. Types with the same memory layout on both sides (blittable: `int`, `double`, pointers, plain structs of those) cross for free; `bool`, `char` and `string` need conversion.
**Use this when:** calling an operating-system or C library function, passing a callback to native code, working with memory the GC does not manage, reading an `errno` after a failed call, or meeting CS0227, SYSLIB1062 or CS8901.
**Not this doc:** `Span<T>`, `stackalloc` into spans and `MemoryMarshal` → `dotnet/performance/span-and-memory.md`; `ref` locals and `ref struct` rules → `dotnet/performance/ref-safety-and-ref-structs.md`; `SafeHandle` and finalizers → `dotnet/errors-and-resources/disposal-and-finalization.md`; how source generators work in general → `dotnet/metaprogramming/source-generators.md`; the object header and field layout → `dotnet/runtime/object-layout-and-boxing.md`.

## Problem
Native interop fails quietly: the code compiles, and the bug appears as a wrong number or a crash elsewhere.
- A C function writes into a managed array after the GC has moved it, because nothing pinned it.
- `errno` read after a failed call came back as `203` in the lab, a code that does not exist, because other code ran first.
- Two `bool` fields make a struct 2 bytes in C# but 8 bytes when marshalled, so the C side reads the wrong offsets.
- A callback delegate handed to C is collected while C still holds its address.
- A string changed through a pointer changes every other use of the same literal in the program.

## Mental model
**Analogy:** managed memory is a warehouse run by a robot (the GC) that moves boxes around at night to keep the aisles tidy; you hold tickets (references), and the robot updates every ticket when it moves a box. A pointer is a pencilled shelf number: the robot does not know about it, so it is right only while the box is pinned in place (`fixed`) or lives outside the warehouse altogether (stack or native memory). Calling C is shipping a box to another company: if their packaging matches ours (blittable), the box goes as is; otherwise a packer (the marshaller) repacks it both ways.

**Artifact** (run in the lab ✅[^lab]):
```csharp
#:property PublishAot=false
#:property AllowUnsafeBlocks=true
using System.Runtime.InteropServices;
int[] data = [5, 3, 9, 1, 7];
unsafe
{
    fixed (int* p = data)                                      // pin: the GC may not move data now
        Native.qsort(p, (nuint)data.Length, sizeof(int), &Native.CompareInts);
}
Console.WriteLine(string.Join(", ", data));                    // 1, 3, 5, 7, 9  (sorted by C's qsort)

static partial class Native
{
    [LibraryImport("libSystem.dylib")]                         // generator writes the call at compile time
    public static unsafe partial void qsort(void* b, nuint n, nuint size, delegate* unmanaged<void*, void*, int> cmp);

    [UnmanagedCallersOnly]                                     // C may call this directly
    public static unsafe int CompareInts(void* a, void* b) => (*(int*)a).CompareTo(*(int*)b);
}
```

## How it works
Five actors in a native call such as the `qsort` above:
- **The C# compiler** — its job: allow pointer code only when asked, via the `AllowUnsafeBlocks` option and the `unsafe` keyword.
- **The `LibraryImport` generator** — its job: write the marshalling code, via the implementing half of the `partial` method.
- **The runtime's interop layer** — its job: find the library and function, via name variations and the operating-system loader; and switch between managed and native code, via a transition stub it builds for each `[DllImport]`.
- **The garbage collector** — its job: move and free managed objects, via its own references; it ignores pointers, so pinned objects stay put.
- **The native library** — its job: run the C function, via the platform calling convention, and call back through the function pointer it was given.

```
compile time                         run time: managed side                        native side
csc + AllowUnsafeBlocks              fixed(int* p = data) → data pinned            libSystem.dylib
LibraryImport generator:             generated qsort(...) body                       qsort(p, 5, 4, cmp)
  partial qsort(...) { ...             └─ __PInvoke(p, …)  ═══ managed→native ════▶   │ compares
    __PInvoke(...) }                                                                   │ calls cmp(a, b)
  [DllImport] static extern          CompareInts(a, b)  ◀═══ native→managed ══════════┘
    __PInvoke(...)                   [UnmanagedCallersOnly]
                                     GC: may run, but will not move the pinned array
```

1. **Compiler: unsafe code is opt-in.** The `AllowUnsafeBlocks` option is off by default ✅[^compiler-lang]; without it, an `unsafe` block is error CS0227 ✅[^lab]. Inside `unsafe`, pointer types (`int*`, `void*`), `&`, `*`, `->`, `[]` on pointers and pointer arithmetic are allowed; pointers do not derive from `object` and cannot be boxed ✅[^unsafe-code]. In the lab, `int x = 0x01020304; byte* b = (byte*)&x;` read the bytes back as `04 03 02 01` (little-endian), and `first + 2` on an `int*` moved 8 bytes ✅[^lab].
2. **GC: pointers are invisible to it, so pin.** The GC does not track pointers, so a pointer to a managed object is valid only while the object is pinned ✅[^unsafe-code]. `fixed` pins an array, a string, a field or anything with `GetPinnableReference` for the duration of its block, and the declared pointer is read-only and usable only inside it ✅[^fixed]. Letting the pointer escape the block creates a dangling pointer ✅[^unsafe-best]. `GCHandle.Alloc(obj, GCHandleType.Pinned)` pins for longer and must be freed ✅[^api-gchandle]; in the lab the address from `AddrOfPinnedObject` was unchanged after `GC.Collect()`, and pinning an `object[]` threw `ArgumentException: Object contains references` ✅[^lab].
3. **Memory outside the GC heap.** `stackalloc` into a pointer needs `unsafe` and has no bounds check, while `stackalloc` into a `Span<T>` is safe ✅[^stackalloc]; in the lab `raw[4]` on a 4-element pointer buffer read without error and `span[4]` threw `IndexOutOfRangeException` ✅[^lab]. The C# compiler marks methods so locals are zero-initialized; `[SkipLocalsInit]` (which needs `AllowUnsafeBlocks`) removes that ✅[^attr-general]. In the lab a 256-byte `stackalloc` buffer had 0 non-zero bytes by default and 243 with the attribute, left over from an earlier call ✅[^lab]. `NativeMemory.Alloc`, `AllocZeroed` and `Free` manage native memory directly ✅[^api-nativememory]; nothing frees it for you.
4. **Function pointers.** `delegate*<int, int, int>` holds a method address and is called with the IL (intermediate language) `calli` instruction instead of a delegate's virtual `Invoke`; `&` works only on static methods, and `delegate* unmanaged` selects the native calling convention ✅[^unsafe-code]. A method marked `[UnmanagedCallersOnly]` can be called directly from native code, and C# takes its address with `&` ✅[^api-uco]; calling it from C# is error CS8901 ✅[^lab]. In the lab, in a Release build, 100 million calls cost about 1.27 ns each through a function pointer and 1.50 ns through a `Func<int,int,int>` delegate (Apple M2) ✅[^lab].
5. **P/Invoke: finding the function.** On Linux and macOS the runtime tries the library name with the platform extension and a `lib` prefix ✅[^lib-loading], so `[DllImport("c")]`, `[DllImport("libc")]` and `"libSystem.dylib"` all reached `getpid` in the lab; a missing library throws `DllNotFoundException` at the first call ✅[^lab].
6. **P/Invoke: `DllImport` against `LibraryImport`.** Without source generation, the runtime generates an IL stub at run time to marshal arguments, and the just-in-time compiler compiles it ✅[^pinvoke-gen]. `[LibraryImport]` on a `static partial` method generates that code at compile time and is the recommended choice from .NET 7 ✅[^pinvoke-gen] ✅[^interop-best]. The generated code needs `AllowUnsafeBlocks`, or the build fails with SYSLIB1062 ✅[^lab]. In the lab, for an all-blittable signature (`getpid`, `qsort`) the generator only put `[DllImport("libSystem.dylib", EntryPoint = "qsort", ExactSpelling = true)]` on an `extern partial` implementing part. For `chdir(string)` it wrote a body marked `[SkipLocalsInit]`: convert the string with `Utf8StringMarshaller` into a `stackalloc` buffer, clear the error with `Marshal.SetLastSystemError(0)`, call a local `[DllImport] static extern int __PInvoke(byte*)`, read `GetLastSystemError()`, free, and store it with `SetLastPInvokeError` ✅[^lab].
7. **Marshalling and blittable types.** Blittable types have the same bit layout in managed and native code and need no conversion: the integer and floating-point types, `nint`/`nuint`, pointers, and structs of fixed layout holding only those (structs are `Sequential` by default); `bool` is not blittable and `char` only sometimes ✅[^interop-best]. A .NET `bool` marshals by default as a 4-byte Windows `BOOL`, while C's `bool` is 1 byte ✅[^interop-best]. In the lab a struct of two `bool` fields was 2 bytes by `Unsafe.SizeOf` and 8 by `Marshal.SizeOf` ✅[^lab]. Strings are converted: `strlen("héllo")` with UTF-8 marshalling returned 6 bytes for a 5-character string ✅[^lab].
8. **Errors and lifetimes.** With `SetLastError = true`, `Marshal.GetLastPInvokeError()` returns the error captured right after the call ✅[^api-getlasterror]; read it before making other calls, which can overwrite it ✅[^interop-best]. In the lab, `chdir("/no/such/dir")` gave `-1` and error 2 ("No such file or directory") when read at once, but 203 when a string interpolation ran first ✅[^lab]. A function pointer from `Marshal.GetFunctionPointerForDelegate` does not keep its delegate alive, so keep the delegate referenced (`GC.KeepAlive`, or a static field for a stored callback) ✅[^interop-best].
9. **Native-sized integers and `Unsafe`.** `nint` and `nuint` are 32 or 64 bits depending on the process and are aliases for `IntPtr` and `UIntPtr` ✅[^integral]; in the 64-bit lab, `IntPtr.Size` was 8 ✅[^lab]. `System.Runtime.CompilerServices.Unsafe` offers pointer-like operations on `ref`s without the `unsafe` keyword, and most of its methods do no argument checking, so misuse can corrupt memory ✅[^api-unsafe].
10. **.NET 11 / C# 15: the memory-safety preview.** An updated memory-safety model is in preview: declaring pointers, `&`, `fixed` and `stackalloc` to a pointer become allowed in safe code, while dereferencing still needs `unsafe`, and calling an `unsafe` member then requires an `unsafe` context in the caller ✅[^unsafe-code]. `LangVersion=preview` turns on the relaxations; the `updated-memory-safety-rules` compiler feature (`#:property Features=$(Features);updated-memory-safety-rules`) turns on the caller rule and records it in the assembly with `MemorySafetyRulesAttribute` ✅[^compiler-lang]. In the container lab, with `LangVersion=preview` and no `AllowUnsafeBlocks`, `int* p = &number`, `fixed`, `stackalloc` into an `int*` and `sizeof(Guid)` compiled outside `unsafe`, while `*p` was error CS9360 "This operation may only be used in an unsafe context"; plain C# 15 still rejected the pointer with CS0214 ✅[^lab11]. With the feature on, calling an `unsafe` method from safe code was CS9362 "'Native.ReadInt32(byte*)' must be used in an unsafe context because it is marked as 'unsafe'", the same call inside an `unsafe` block ran, a method with a safe signature that dereferenced inside its own `unsafe` block stayed callable from safe code, the module carried `[MemorySafetyRules(2)]`, and `unsafe` on a static constructor was CS9377 ✅[^lab11]; such a safe-signature method is an "unsafe boundary", and `unsafe` on a static constructor is an error in this model ✅[^unsafe-code].

## Worked example
Calling `qsort` from C# with a C# comparer, step by step, as it ran in the lab ✅[^lab].

| Step | Who | What happens | Real value |
|---|---|---|---|
| 1 | Compiler | Accepts `unsafe`, `delegate* unmanaged<…>` and `&Native.CompareInts` because of `#:property AllowUnsafeBlocks=true` | without it: CS0227 and SYSLIB1062 |
| 2 | Generator | Every argument is already blittable (`void*`, `nuint`, a function pointer), so it emits only `[DllImport(…, ExactSpelling = true)] … extern partial void qsort(…)` | `LibraryImports.g.cs` under `obj/debug/generated/Microsoft.Interop.LibraryImportGenerator/` |
| 3 | Your code | `fixed (int* p = data)` pins the 5-element array | `p` points at `data[0]` |
| 4 | Runtime | Loads `libSystem.dylib`, resolves `qsort`, switches to native code | |
| 5 | Native | `qsort` calls `CompareInts(a, b)` for pairs, through the raw address | `CompareInts` reads `*(int*)a` and `*(int*)b` |
| 6 | Runtime | `[UnmanagedCallersOnly]` lets each callback enter managed code without a delegate | |
| 7 | Your code | The `fixed` block ends; the array may move again | `data` is `[1, 3, 5, 7, 9]` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `fixed (char* c = s) c[0] = '_';` on `string s = "Hello"` | `Console.WriteLine("Hello")` later printed `_ello` ✅[^lab] | Literals are shared, strings are immutable by contract, and mutating one is undefined behaviour ✅[^unsafe-best] |
| `errno` read after another call | 203 instead of 2 in the lab ✅[^lab] | The last-error slot holds the latest call that set it; read it first ✅[^interop-best] |
| `[DllImport("c")]` on macOS | Works ✅[^lab] | Name variations add `lib` and `.dylib` ✅[^lib-loading] |
| `stackalloc` with a size from input | Too large a size throws `StackOverflowException` | Stack space is limited; cap the size and fall back to an array ✅[^stackalloc] |
| A pinned `GCHandle` that is never freed | The object stays pinned and is never collected | `Free` releases it; otherwise memory leaks ✅[^api-gchandle] |
| A pointer kept in a field after `fixed` ends | Dangling; it may point into a moved or reused object | No ownership checks for pointers ✅[^unsafe-best] |
| Calling an `[UnmanagedCallersOnly]` method from C# | error CS8901 ✅[^lab] | Only native callers, through a function pointer ✅[^api-uco] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `[LibraryImport]` | Marshalling visible as C#, friendly to trimming and Native AOT (ahead-of-time compilation), recommended from .NET 7 ✅[^interop-best] | Needs `AllowUnsafeBlocks` and explicit string marshalling ✅[^lab] |
| `[DllImport]` | Works everywhere, including old targets | Run-time stub generation ✅[^pinvoke-gen] |
| Pointers in `unsafe` blocks | No bounds checks, direct addresses | Every mistake is memory corruption; no GC tracking |
| `Span<T>` and `Unsafe` without `unsafe` | Bounds checks (`Span`) and no pointer syntax | Still unsafe in places (`Unsafe` does no checks ✅[^api-unsafe]); see `dotnet/performance/span-and-memory.md` |

## Takeaways
- Use `[LibraryImport]` for new P/Invokes, with `StringMarshalling` stated explicitly. [rule-candidate]
- Read `Marshal.GetLastPInvokeError()` on the very next line after the call that failed. [rule-candidate]
- Keep pointers inside the `fixed` block that produced them; never store them in fields.
- Never write through a pointer into a `string`.
- Prefer blittable signatures (integers, pointers, plain structs); marshal `bool` explicitly when the C side uses a 1-byte `bool`.
- Keep a delegate passed to native code alive for as long as native code may call it. [rule-candidate]

## Verification status
- Verified: 58 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- `dotnet/lab-setup.md` (Step 13) — the .NET 11 container lab (SDK 11.0.100, runtime 11.0.0, C# 15, Ubuntu 26.04.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab11]
- [Unsafe code, pointer types, and function pointers](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/unsafe-code) — Microsoft, living. Rank 1. Backs: pointer types and operators, GC does not track pointers, function pointers and `calli`, `&` only on static methods, `unmanaged` calling convention, the C# 15 preview model, unsafe boundaries, no `unsafe` static constructors in that model. [^unsafe-code]
- [fixed statement](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/fixed) — Microsoft, living. Rank 1. Backs: pinning, what can be pinned, the pointer's scope. [^fixed]
- [stackalloc expression](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/stackalloc) — Microsoft, living. Rank 1. Backs: span versus pointer targets, stack limits and size caps. [^stackalloc]
- [C# compiler options: language](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language) — Microsoft, living. Rank 1. Backs: `AllowUnsafeBlocks` default false; `LangVersion=preview` and the `updated-memory-safety-rules` feature for the C# 15 memory-safety preview; `MemorySafetyRulesAttribute`. [^compiler-lang]
- [Miscellaneous attributes interpreted by the C# compiler](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/general) — Microsoft, living. Rank 1. Backs: `SkipLocalsInit` and `.locals init`; needs `AllowUnsafeBlocks`. [^attr-general]
- [Integral numeric types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/integral-numeric-types) — Microsoft, living. Rank 1. Backs: `nint` and `nuint`. [^integral]
- [Native library loading](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/native-library-loading) — Microsoft, living. Rank 1. Backs: name variations with extension and `lib` prefix. [^lib-loading]
- [Source generation for platform invokes](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation) — Microsoft, living. Rank 1. Backs: run-time IL stub for `DllImport`; `LibraryImport` on `static partial` methods since .NET 7. [^pinvoke-gen]
- [Native interoperability best practices](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/best-practices) — Microsoft, living. Rank 1. Backs: prefer `LibraryImport`; blittable types; `bool` as 4-byte `BOOL`; read the error before other calls; keep delegates alive. [^interop-best]
- [Unsafe code best practices](https://learn.microsoft.com/en-us/dotnet/standard/unsafe-code/best-practices) — Microsoft, living. Rank 1. Backs: pointers escaping `fixed`; string mutation is undefined behaviour. [^unsafe-best]
- [NativeMemory](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.nativememory) — Microsoft, living. Rank 1. Backs: `Alloc`, `AllocZeroed`, `Free`. [^api-nativememory]
- [GCHandle](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.gchandle) — Microsoft, living. Rank 1. Backs: pinned handles, `AddrOfPinnedObject`, `Free` or leak. [^api-gchandle]
- [UnmanagedCallersOnlyAttribute](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.unmanagedcallersonlyattribute) — Microsoft, living. Rank 1. Backs: callable from native code; address taken with `&`. [^api-uco]
- [Marshal.GetLastPInvokeError](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.marshal.getlastpinvokeerror) — Microsoft, living. Rank 1. Backs: the last P/Invoke error on the current thread with `SetLastError`. [^api-getlasterror]
- [Unsafe class](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.unsafe) — Microsoft, living. Rank 1. Backs: low-level `ref` and pointer helpers without argument checks. [^api-unsafe]

## Related
- `dotnet/performance/span-and-memory.md` — safe views over arrays, stack and native memory.
- `dotnet/performance/ref-safety-and-ref-structs.md` — the compiler's escape rules that pointers lack.
- `dotnet/errors-and-resources/disposal-and-finalization.md` — `SafeHandle` for native resources.
- `dotnet/metaprogramming/source-generators.md` — how the `LibraryImport` generator runs.
- `dotnet/runtime/object-layout-and-boxing.md` — `StructLayout` and managed field layout.
- `dotnet/runtime/garbage-collection.md` — why the GC moves objects, and the pinned object heap.
