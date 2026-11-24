---
schema: knowledge-doc/v1
type: concept
topic: dotnet/performance
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "BenchmarkDotNet 0.15.8", "dotnet-counters 10.0.750501"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, performance, allocations, stopwatch, warm-up, getallocatedbytesforcurrentthread, eventcounters, eventlistener, meterlistener, dotnet-counters, dnx, benchmarkdotnet, memorydiagnoser, arraypool, string-create, stringbuilder, linq, skiplocalsinit]
ranked-sources: true
---

# Measuring and reducing allocations

## Summary
**TL;DR:** Measure on a Release build after warm-up, because the first calls run unoptimized tier-0 code (20 times slower than tier 1 in the lab) and a Debug build never gets optimized. Count bytes with `GC.GetAllocatedBytesForCurrentThread()` around the code under test (it sees only the current thread; `GC.GetTotalAllocatedBytes()` sees the whole process) and collections with `GC.CollectionCount(n)`; read the same numbers in-process from the `System.Runtime` EventCounters or Meter when `dotnet-counters` is not available. BenchmarkDotNet automates warm-up, repetition and the byte count, and its warm-up is long enough where a hand-written one may not be; run it from a project, not a file-based app. Then remove allocations in order of size: drop LINQ (Language-Integrated Query) and per-call builders from hot loops, reuse a `StringBuilder`, build strings once with `string.Create`, rent buffers from `ArrayPool<T>.Shared` (and return each exactly once), use structs for small values, and skip zeroing big `stackalloc` buffers with `[SkipLocalsInit]`.
**Use this when:** a service spends time in GC (garbage collection), a hot method shows up in an allocation profile, you want a quick in-process benchmark without extra packages, or you are deciding which allocation-reduction technique is worth its complexity.
**Not this doc:** why allocations cost what they do (generations, the LOH, or large object heap) → `dotnet/runtime/garbage-collection.md`; object and box sizes, and which allocations the JIT (just-in-time compiler) removes by itself → `dotnet/runtime/object-layout-and-boxing.md`; tiers and warm-up mechanics → `dotnet/runtime/jit-tiering-and-aot.md`; spans for parsing → `dotnet/performance/span-and-memory.md`.

## Problem
Allocation work goes wrong in two ways, measuring the wrong thing and fixing the wrong thing (lab numbers, from How it works and the Worked example below):
- A micro-benchmark timed with `Stopwatch` on the first 2,000 calls reports 10,000 ns per call for code that runs in 500 ns once warm.
- The same benchmark run through `dotnet run app.cs` (a Debug build) stays at 2,700 ns forever.
- `GC.GetAllocatedBytesForCurrentThread()` reports nothing for work done in `Task.Run`.
- An `ArrayPool<byte>` buffer returned twice is handed to two callers at once, and nothing throws.
- Joining 50 IDs with LINQ and `string.Join` allocated 2,224 bytes per call where 520 bytes (the result string) was the minimum.
- A `Stopwatch` loop with 40,000 warm-up calls made a new-`StringBuilder`-per-call version look slower than LINQ (about 1,000 ns against 610–680 ns); BenchmarkDotNet measured it at 0.60 of LINQ's time.

## Mental model
**Analogy:** a household budget. The current-thread counter is one family member's receipts: exact, but blind to what others spend. The process counter is the bank statement: complete, but you cannot tell who spent what. Warm-up is the first week in a new city, when every trip costs more because you do not know the shops yet (tier 0); budget the normal weeks, not the first one. Reducing allocations is cutting the big recurring items first (a new builder per call, LINQ in a loop) before haggling over pennies.

**Artifact** (the pattern the doc's hand-timed numbers come from, run in the lab ✅[^lab]; BenchmarkDotNet numbers are marked as such):
```csharp
for (int i = 0; i < 20_000; i++) Run();          // warm-up: let tiering finish
Thread.Sleep(200);
for (int i = 0; i < 20_000; i++) Run();
int gen0 = GC.CollectionCount(0);
long bytes = GC.GetAllocatedBytesForCurrentThread();
var sw = Stopwatch.StartNew();
for (int i = 0; i < 200_000; i++) Run();
sw.Stop();
Console.WriteLine($"{(GC.GetAllocatedBytesForCurrentThread() - bytes) / 200_000} B/call, " +
                  $"{sw.Elapsed.TotalNanoseconds / 200_000:F0} ns/call, gen0 GCs={GC.CollectionCount(0) - gen0}");
// e.g. "520 B/call, 247 ns/call, gen0 GCs=13" for version 5 of the worked example
```

## How it works
1. **Time with `Stopwatch`, after warm-up.** `Stopwatch` counts ticks of a high-resolution performance counter when the hardware and operating system have one ✅[^api-stopwatch]; on the lab Mac `IsHighResolution` was `True` and `Frequency` 1,000,000,000 ticks per second ✅[^lab]. A method's first calls run tier-0 code until tiering promotes it (`dotnet/runtime/jit-tiering-and-aot.md`): in the lab, a small loop method took 7,200–10,400 ns per call in the first two batches of 2,000 calls and 340–610 ns from the third batch on, while the same probe in a Debug build stayed at about 2,300–2,700 ns ✅[^lab].
2. **Count bytes per thread or per process.** `GC.GetAllocatedBytesForCurrentThread()` returns the bytes the current thread has allocated over its lifetime ✅[^api-allocated]; `GC.GetTotalAllocatedBytes(precise)` returns the bytes allocated by the whole process, excluding native allocations, and `precise: true` costs noticeably more ✅[^api-total]. In the lab a pool thread allocated 1,000,000 × `byte[100]`: the process total exceeded the main thread's count by exactly 128 MB (128 bytes each), which the main thread's counter never saw ✅[^lab]. `GC.CollectionCount(generation)` counts collections of that generation since the process started ✅[^api-collectioncount].
3. **Read runtime counters in-process.** The `System.Runtime` EventSource publishes EventCounters such as `alloc-rate`, `gen-0-gc-count`, `gc-heap-size` and `time-in-gc` ✅[^available-counters]. An `EventListener` can consume them inside the process, but only if `EnableEvents` passes `EventCounterIntervalSec` in its arguments ✅[^event-counters]. Since .NET 9 the `System.Runtime` Meter reports the same data as metrics, for example `dotnet.gc.collections` with a `gc.heap.generation` attribute and `dotnet.gc.heap.total_allocated`, which equals `GC.GetTotalAllocatedBytes` ✅[^metrics-runtime]; a `MeterListener` reads them ✅[^lab]. In the lab, one-second intervals of a tight allocation loop showed `alloc-rate` of about 16–17 GB, `gen-0-gc-count` of about 2,000 and `time-in-gc` of 11–32% ✅[^lab].
4. **`dotnet-counters`, from outside the process.** The tool runs without installation through `dnx dotnet-counters` from .NET SDK (software development kit) 10.0.100, or installs with `dotnet tool install --global dotnet-counters`; `dotnet-counters monitor --process-id <pid> --counters System.Runtime[dotnet.gc.collections,dotnet.gc.heap.total_allocated]` shows chosen metrics live ✅[^dotnet-counters]. In the lab, version 10.0.750501 (installed with `--tool-path`, `dotnet/lab-setup.md` Step 12) ran that command against a Release probe allocating about 0.8 GB per second: its table listed `dotnet.gc.collections ({collection})` per `gc.heap.generation` (gen0 1,561, gen1 1, gen2 0) and `dotnet.gc.heap.total_allocated (By)` as `1.3995e+10`, in step with the probe's own `GC.CollectionCount` and `GC.GetTotalAllocatedBytes` ✅[^lab]. `monitor` draws that table only on a terminal: with its output redirected it printed nothing but `Status: Running` lines, while `dotnet-counters collect --format csv -o file.csv` wrote one row per second, as rates (`dotnet.gc.heap.total_allocated (By / 1 sec)` 781,162,000–840,209,328; gen0 93–100 collections per second) ✅[^lab]. `dnx` downloads the tool package into the NuGet cache and runs it, with the tool's arguments after `--` ✅[^tool-exec]. The Homebrew SDK ships the `dnx` script in `libexec/` but not on `PATH`; `dotnet dnx dotnet-counters@10.0.750501 -- --version` restored the tool into `NUGET_PACKAGES` and printed its version, and without the `--`, `dnx` read `--version` as its own option and printed its help ✅[^lab].
5. **BenchmarkDotNet.** It generates and builds a separate Release project per runtime, runs each benchmark in its own process, and per benchmark runs a pilot stage (choosing the operation count), overhead and warm-up stages, then the measured stage, subtracting the measured overhead ✅[^bdn-how]. `[MemoryDiagnoser]` reports allocated bytes per operation using `GC.GetAllocatedBytesForCurrentThread` and is described as 99.5% accurate with default settings ✅[^bdn-diag]. Its guidance: never benchmark a Debug build, and return results so the JIT cannot delete the work as dead code ✅[^bdn-good]. In the lab, version 0.15.8 built the generated project with `dotnet build -c Release … /p:Optimize=true`, started one `dotnet p-bdn-join-DefaultJob-1.dll … --benchmarkName <name>` process per benchmark, each with its own process ID, and logged the stages `OverheadJitting`, `WorkloadJitting`, `WorkloadPilot`, `OverheadWarmup`, `OverheadActual`, `WorkloadWarmup`, `WorkloadActual` and `WorkloadResult`; its `Allocated` column equalled the `Stopwatch` probe's bytes per call for all five versions of the worked example ✅[^lab]. It needs a project file: from a file-based app it ran nothing (Edge cases) ✅[^lab].
6. **Reduce: reuse builders, size strings once.** A `StringBuilder` starts with a capacity of 16 characters and grows by allocating more ✅[^api-sb]; keeping one per thread and calling `Clear()` reuses its buffer. `string.Create(length, state, action)` allocates the final string once and lets the callback write its characters into a `Span<char>` ✅[^api-string-create]. Both left only the 520-byte result string per call in the worked example ✅[^lab].
7. **Reduce: pool buffers, correctly.** `ArrayPool<T>.Shared.Rent(n)` returns an array of at least `n` elements that may not be zeroed; `Return` gives up ownership, an array must be returned only once, and returning twice or using it after return is a high-severity bug (double free, use after free) ✅[^api-arraypool]. The shared pool is thread-safe and may hand back a larger array, never a smaller one ✅[^api-arraypool]. In the lab: `Rent(1000)` gave 1,024 elements; a returned array came back to the next renter with its old data unless returned with `clearArray: true`; after a double `Return`, two `Rent` calls received the same array; returning a foreign 1,024-element array was accepted and a 1,001-element one threw `ArgumentException` ✅[^lab].
8. **Reduce: structs for small values, loops instead of LINQ in hot paths.** One million two-`int` records cost 32,000,072 bytes as a `List<record class>` and 8,000,056 bytes as a `List<record struct>`, because each class instance pays a 24-byte object (`dotnet/runtime/object-layout-and-boxing.md`) ✅[^lab]. `a.Where(x => x > 0).Sum()` over 1,000 ints allocated 48 bytes and took about 1,400 ns per call; the `foreach` equivalent allocated nothing and took about 350 ns ✅[^lab].
9. **Reduce: skip zeroing with `[SkipLocalsInit]`.** By default the compiler sets the `.locals init` flag, so the runtime zeroes every local, including `stackalloc` memory; `[SkipLocalsInit]` removes the flag and requires `AllowUnsafeBlocks`, because code can then read uninitialized memory ✅[^attr-general]. In the lab a 256-byte `stackalloc` buffer read 0 non-zero bytes by default and 163 with the attribute, and a 4 KB `stackalloc` that writes one byte took about 87 ns per call zeroed and about 1.7 ns without zeroing ✅[^lab].

## Worked example
Join the IDs of the 50 active users out of 100 (a `User[]` array; `1000,1002,…,1098`, 249 characters) five ways, Release build, on the lab's Apple M2 while other builds ran: first with the Artifact's `Stopwatch` loop (200,000 calls after warm-up, all five versions in one process, two runs), then with BenchmarkDotNet 0.15.8 and `[MemoryDiagnoser]` on the same methods (default job; "error" is half the 99.9% confidence interval) ✅[^lab]. A `List<User>` instead of the array cost 48 bytes more in version 1 (2,272) and nothing more in the others ✅[^lab].

| Version | Code shape | Bytes per call (both tools) | `Stopwatch` time per call | BenchmarkDotNet mean ± error (ratio) | gen0 GCs (`Stopwatch` run) |
|---|---|---|---|---|---|
| 1 | `string.Join(",", users.Where(u => u.Active).Select(u => u.Id.ToString()))` | 2,224 | 650–677 ns | 613 ± 12 ns (1.00) | 53 |
| 2 | `new StringBuilder()` per call, `Append(','); Append(id)` | 1,488 | 983–1,069 ns, caught mid-tiering (below) | 369 ± 10 ns (0.60) | 36 |
| 3 | `[ThreadStatic] StringBuilder`, `Clear()` each call | 520 | 263–280 ns | 256 ± 5 ns (0.42) | 12 |
| 4 | `string.Create(len, users, …)` with `int.TryFormat` into the span | 520 | 314–316 ns | 263 ± 5 ns (0.43) | 13 |
| 5 | `ArrayPool<char>.Shared.Rent(1024)` + `TryFormat`, then `new string(buf, 0, pos)` | 520 | 244–247 ns | 236 ± 4 ns (0.38) | 13 |

The 520 bytes left in versions 3–5 are the result itself: 249 UTF-16 characters plus the string header. Version 2 allocates more than versions 3–5 because a builder that starts at 16 characters grows several times per call. The two tools agree on every byte count, and their times rank the versions the same way except for version 2: the `Stopwatch` loop made it slower than version 1, but its first measured round still ran code that was being recompiled (Edge cases), and once warm it ran at 0.60 of version 1's time. Versions 3–5 cut allocations by 77% and time by more than half; among them BenchmarkDotNet's means differ by about 11%, small next to that gain, so the simplest (the reused builder) is usually the right choice.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Timing with `dotnet run app.cs` | Debug build: no tiering, numbers about 5 times worse than warm Release code and never improving ✅[^lab] | File-based apps build Debug unless `-c Release` is given; BenchmarkDotNet refuses Debug for the same reason ✅[^bdn-good]: from a Debug build, 0.15.8 ran no benchmark and printed `Assembly p-bdn-join which defines benchmarks is non-optimized` ✅[^lab] |
| A `Stopwatch` warm-up that ends too early | Version 2 of the worked example, alone in a process after 20,000 calls, 200 ms and 20,000 more calls: its first measured round of 200,000 calls took 993–1,046 ns in three runs while `JitInfo.GetCompiledMethodCount()` rose by 20, and the next five rounds took 334–385 ns ✅[^lab] | The code was still moving through the tiers: the JIT log showed the method compiled `Instrumented Tier0` twice before `Tier1`, and `StringBuilder:Append(int)` at `Instrumented Tier1`, then `Tier1` ✅[^lab] (`dotnet/runtime/jit-tiering-and-aot.md`). Check that the JIT count stays the same across the measured loop, or repeat rounds until two agree |
| Measuring an allocation whose result is unused | A non-escaping `new Point(i, i)` reported 0 bytes at tier 1 in the lab; under BenchmarkDotNet, a `void` benchmark that dropped its new `Point` measured 0.03 ± 0.02 ns, no allocation and a `ZeroMeasurement` warning, against 2.69 ns and 24 B when the method returned it ✅[^lab] | See `dotnet/runtime/object-layout-and-boxing.md`; return or store the result ✅[^bdn-good] |
| BenchmarkDotNet started from a file-based app (`dotnet run -c Release bench.cs`) | 0.15.8 built nothing and ran no benchmark: `Generate Exception: System.NotSupportedException: Unable to find p-bdn-join in <folder> and its subfolders. Most probably the name of output exe is different than the name of the .(c/f)sproj` ✅[^lab] | Its default toolchain looks for the benchmark's `.csproj` (`CsProjGenerator.GetProjectFilePath` in the stack trace), and a file-based app has none; after `dotnet project convert bench.cs` the same code ran ✅[^lab] |
| `GC.GetAllocatedBytesForCurrentThread()` around `await` | In the lab the code resumed on thread 5 after starting on thread 1, and the difference came out as −44,944 bytes although a 10,024-byte array had been allocated ✅[^lab] | The counter is per thread ✅[^api-allocated]; use `GC.GetTotalAllocatedBytes` for async code |
| First `Rent` of a new size | Allocates: 1,000 `Rent`/`Return` pairs of 4,096 bytes cost 4,120 bytes, all from the first call ✅[^lab] | The pool creates a buffer when it has none to lend ✅[^api-arraypool] |
| `EventListener` without `EventCounterIntervalSec` | No counter events arrive | The interval tells the source when to publish ✅[^event-counters] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Stopwatch` + `GC.GetAllocatedBytesForCurrentThread` loop | No packages, runs anywhere, seconds to write | You handle warm-up, noise, dead-code elimination yourself |
| BenchmarkDotNet | Process isolation, warm-up, statistics, `[MemoryDiagnoser]` ✅[^bdn-how] ✅[^bdn-diag] | A NuGet package (24 packages, 236 MB, in `dotnet/lab-setup.md` Step 11); about 40 seconds per benchmark with the default job (5 benchmarks in 3 min 25 s in the lab); needs a project file ✅[^lab] |
| `ArrayPool<T>.Shared` | No allocation per call for large buffers | Must return exactly once; contents leak between renters unless cleared ✅[^api-arraypool] |
| `string.Create` | Exactly one allocation, no intermediate buffer ✅[^api-string-create] | Needs the final length up front (two passes) |
| `[SkipLocalsInit]` | Removes zeroing of big `stackalloc` buffers (87 versus 1.7 ns for 4 KB in the lab) | Reading before writing returns old stack data; needs `AllowUnsafeBlocks` ✅[^attr-general] |

## Takeaways
- Benchmark only Release builds, after a warm-up long enough for tier 1 (hundreds of milliseconds), and use the result of the measured code. [rule-candidate]
- Before trusting a hand-written timing loop, check that `JitInfo.GetCompiledMethodCount()` does not change during the measured loop, or let BenchmarkDotNet run the warm-up.
- Report bytes per operation next to time per operation; reduce the largest recurring allocation first.
- Return every rented `ArrayPool<T>` array exactly once, in a `finally`, and never touch it afterwards. [rule-candidate]
- Prefer a reused `StringBuilder` or `string.Create` over LINQ plus `string.Join` in hot paths.

## Verification status
- Verified: 55 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64), with BenchmarkDotNet 0.15.8 restored into the lab's package folder (Step 11) and dotnet-counters 10.0.750501 installed with `--tool-path` (Step 12), where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Stopwatch class](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.stopwatch) — Microsoft, living. Rank 1. Backs: high-resolution counter; `Frequency`. [^api-stopwatch]
- [GC.GetAllocatedBytesForCurrentThread](https://learn.microsoft.com/en-us/dotnet/api/system.gc.getallocatedbytesforcurrentthread) — Microsoft, living. Rank 1. Backs: bytes allocated by the current thread over its lifetime. [^api-allocated]
- [GC.GetTotalAllocatedBytes](https://learn.microsoft.com/en-us/dotnet/api/system.gc.gettotalallocatedbytes) — Microsoft, living. Rank 1. Backs: process-wide bytes; native allocations excluded; the cost of `precise`. [^api-total]
- [GC.CollectionCount](https://learn.microsoft.com/en-us/dotnet/api/system.gc.collectioncount) — Microsoft, living. Rank 1. Backs: collections per generation since process start. [^api-collectioncount]
- [EventCounters in .NET](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/event-counters) — Microsoft, living. Rank 1. Backs: in-process consumption with `EventListener`; the required `EventCounterIntervalSec`. [^event-counters]
- [Well-known EventCounters in .NET](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/available-counters) — Microsoft, living. Rank 1. Backs: the `System.Runtime` counter names. [^available-counters]
- [.NET runtime metrics](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/built-in-metrics-runtime) — Microsoft, living. Rank 1. Backs: the `System.Runtime` Meter since .NET 9; `dotnet.gc.collections`; `dotnet.gc.heap.total_allocated`. [^metrics-runtime]
- [dotnet-counters](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters) — Microsoft, living. Rank 1. Backs: `dnx` and `dotnet tool install`; `monitor` with selected counters. [^dotnet-counters]
- [dotnet tool exec](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-tool-exec) — Microsoft, living. Rank 1. Backs: `dnx` downloads a tool package into the NuGet cache and runs it; tool arguments after `--`. [^tool-exec]
- [ArrayPool\<T> class](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.arraypool-1) — Microsoft, living. Rank 1. Backs: `Rent` at least the length, not zeroed; return once; double return and use after return; thread safety; larger arrays. [^api-arraypool]
- [String.Create](https://learn.microsoft.com/en-us/dotnet/api/system.string.create) — Microsoft, living. Rank 1. Backs: creates a string of a given length and fills it through a callback. [^api-string-create]
- [StringBuilder class](https://learn.microsoft.com/en-us/dotnet/api/system.text.stringbuilder) — Microsoft, living. Rank 1. Backs: default capacity 16; growth by allocation. [^api-sb]
- [Attributes interpreted by the compiler: SkipLocalsInit](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/general) — Microsoft, living. Rank 1. Backs: the `.locals init` flag; zeroing cost with `stackalloc`; `AllowUnsafeBlocks`. [^attr-general]
- [BenchmarkDotNet: How it works](https://benchmarkdotnet.org/articles/guides/how-it-works.html) — .NET Foundation and contributors, living. Rank 1. Backs: separate Release project and process; pilot, overhead, warm-up and actual stages. [^bdn-how]
- [BenchmarkDotNet: Diagnosers](https://benchmarkdotnet.org/articles/configs/diagnosers.html) — .NET Foundation and contributors, living. Rank 1. Backs: `MemoryDiagnoser` uses `GC.GetAllocatedBytesForCurrentThread`; 99.5% accuracy. [^bdn-diag]
- [BenchmarkDotNet: Good practices](https://benchmarkdotnet.org/articles/guides/good-practices.html) — .NET Foundation and contributors, living. Rank 1. Backs: never benchmark Debug; avoid dead-code elimination. [^bdn-good]

## Related
- `dotnet/runtime/jit-tiering-and-aot.md` — why warm-up and Release builds matter.
- `dotnet/runtime/garbage-collection.md` — what the counters measure and what drives collections.
- `dotnet/runtime/object-layout-and-boxing.md` — sizes of objects and boxes; allocations the JIT removes.
- `dotnet/performance/span-and-memory.md` — allocation-free parsing and slicing.
- `dotnet/collections-and-linq/linq.md` — LINQ's deferred execution and its costs.
