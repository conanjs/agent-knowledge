---
schema: knowledge-doc/v1
type: concept
topic: dotnet/runtime
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "Microsoft.NETCore.App.Crossgen2.osx-arm64 10.0.12 (ReadyToRun publish)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, jit, ryujit, tiered-compilation, tier0, tier1, osr, dynamic-pgo, readytorun, native-aot, startup, jitdisasm]
ranked-sources: true
---

# JIT compilation, tiering, ReadyToRun and Native AOT

## Summary
**TL;DR:** C# compiles to IL (intermediate language), and at run time the JIT (just-in-time compiler, RyuJIT) turns each method into machine code the first time it runs. With tiered compilation, on by default, that first code is quick and unoptimized (tier 0); a method called 30 times after startup calms down is recompiled with full optimization (tier 1) on a background thread. With Dynamic PGO (profile-guided optimization, on by default since .NET 8), an instrumented version records which types and branches really occur first. Loops switch to optimized code mid-run through OSR (on-stack replacement). ReadyToRun ships precompiled code that tiering can still replace. Native AOT (ahead-of-time) compiles everything at publish time and ships no JIT, so nothing can be generated at run time.
**Use this when:** the first calls of a method are much slower than later ones, a benchmark gives different numbers in Debug and Release, startup time matters, you are choosing between JIT, ReadyToRun and Native AOT, or you want to see which tier and which machine code a method got.
**Not this doc:** the garbage collector → `dotnet/runtime/garbage-collection.md`; object headers, boxing and how virtual calls are devirtualized → `dotnet/runtime/object-layout-and-boxing.md`; measuring with warm-up → `dotnet/performance/measuring-and-reducing-allocations.md`; reflection, trimming and the IL2026/IL3050 warnings → `dotnet/metaprogramming/reflection-and-attributes.md`; the SDK (software development kit), runtime and target frameworks → `dotnet/platform/runtime-and-versions.md`.

## Problem
Code that looks the same runs at very different speeds depending on when and how it was compiled (lab numbers, from the Worked example below):
- The first 4,000 calls of a small loop method took about 8,000 ns each, later calls about 1,000 ns, with no code change.
- A program built in Debug (the default of `dotnet run app.cs`) never speeds up, because the JIT never optimizes it.
- Turning off the precompiled framework code (`DOTNET_ReadyToRun=0`) almost doubled the startup time of a small program.
- The same program published as Native AOT started in about 9 ms instead of about 40 ms, but `Type.GetType("System.Guid")` returned `null` and `System.Reflection.Emit` threw.
- A similar small program published with ReadyToRun JIT-compiled 88 methods at startup instead of 98 and still started in about 31 ms.

## Mental model
**Analogy:** a conference interpreter. The first time a speaker says a sentence, the interpreter gives a quick, rough translation (tier 0). When a phrase keeps coming back, a second interpreter at the back writes a polished version and swaps it in (tier 1), helped by notes on what the speaker actually said (PGO). If the speaker is stuck in one endless sentence, the polished version is swapped in mid-sentence (OSR). ReadyToRun is a pre-printed handout that the interpreters may still improve. Native AOT prints the whole speech before the event: no interpreter in the room, so a sentence nobody prepared cannot be translated.

**Artifact:** the JIT's own log, from `DOTNET_JitDisasmSummary=1` on a Release build in the lab ✅[^lab].
```console
$ DOTNET_JitDisasmSummary=1 DOTNET_JitStdOutFile=jit.txt dotnet bin/release/f-jit-tiers.dll
$ grep Calc: jit.txt
   2: JIT compiled Calc:Add(long,int) [Tier0, IL size=5, code size=40]
   4: JIT compiled Calc:Add(long,int) [Instrumented Tier0, IL size=5, code size=40]
   5: JIT compiled Calc:Add(long,int) [Tier1, IL size=5, code size=20]
```
One method, three compilations: quick code, then quick code that counts what happens, then optimized code half the size.

## How it works
**Five actors:**
- **The C# compiler (Roslyn)** — its job: turn source into IL in an assembly, via `dotnet build`.
- **The runtime** — its job: start each method with a stub, count calls and pick the next code version, via the prestub and call-counting stubs.
- **The JIT (RyuJIT)** — its job: compile one method's IL to machine code at a requested tier, via a request from the runtime.
- **The background tiering worker** — its job: compile tier-1 versions off the main thread, via a thread-pool thread.
- **The ahead-of-time compilers** — their job: produce machine code before the app runs, via `dotnet publish` (crossgen for ReadyToRun, ILC, the Native AOT IL compiler, for Native AOT).

```
 build time                 run time (JIT mode)
 ──────────                 ──────────────────────────────────────────────────────────
 C# ──Roslyn──▶ IL ──▶ first call ──▶ prestub ──▶ JIT: Tier0 (or R2R code if present)
                                                     │  call counter: 30 calls, after a
                                                     │  100 ms quiet period
                                                     ▼
                                        JIT: Instrumented tier (records types, branches)
                                                     │  30 more calls
                                                     ▼
                                 background worker ─▶ JIT: Tier1 with profile data ─▶ swapped in
            loop in a Tier0 method ─▶ patchpoint counter hits limit ─▶ JIT: Tier1-OSR ─▶ jump mid-loop
 Native AOT: IL ──ILC + JIT (at publish)──▶ one native executable, no JIT at run time
```

1. **Roslyn (build) → IL.** The compiler emits CIL (common intermediate language, the same thing as IL), which does not depend on the CPU (processor); before a method runs, the JIT converts it to native code, on demand, the first time it is called, and later calls reuse that code ✅[^managed-exec]. The loader puts a stub on each method so that the first call reaches the JIT ✅[^managed-exec], and the native code it produces belongs to the process that triggered the compilation and is not shared with other processes ✅[^managed-exec].
2. **Runtime → JIT, tier 0.** For a method that has no precompiled code, tier 0 is code the JIT produces with minimal optimization; for a precompiled method, the ReadyToRun code is the tier-0 version ✅[^tiered-design]. Quick JIT saves startup time but its code may use more stack, allocate more and run slower ✅[^rc-compilation]. A Debug build is a different case: with `Optimize` off, the compiler also tells the runtime not to optimize ✅[^cs-optimize], and in the lab every method of a Debug build was compiled `MinOpts` and never promoted, even one marked `AggressiveOptimization` ✅[^lab].
3. **Runtime: call counting.** A tier-0 method is promoted once it has been called 30 times, and counting starts only after a 100 ms timer expires with no new tier-0 compilation, a heuristic for "startup is over" ✅[^tiered-design]. The .NET 10 source keeps these defaults (`TC_CallCountThreshold` 30, `TC_CallCountingDelayMs` 100 in release builds) ✅[^src-clrconfig].
4. **Runtime → JIT, instrumented tier (Dynamic PGO).** A hot tier-0 method is first recompiled as *Tier0 instrumented* (still unoptimized, now counting branches and the classes seen at virtual calls), and only after 30 more calls as *Tier1* with that profile; hot ReadyToRun code goes through *Tier1 instrumented* instead, so methods that never get hot are never instrumented ✅[^pgo-tiers]. In the lab, a loop method published with ReadyToRun ran its precompiled code first, and its only JIT compilations were `Instrumented Tier1`, then `Tier1 with Dynamic PGO`, with no tier-0 or OSR version ✅[^lab]. Dynamic PGO is on by default since .NET 8 and raised performance by about 15% on average in Microsoft's benchmarks ✅[^wn8]. `DOTNET_TieredPGO=0` turns it off ✅[^rc-compilation].
5. **Background worker → JIT, tier 1.** The tier-1 version is compiled on a background thread and then made the active one; it is the code the JIT would produce with tiering off ✅[^tiered-design]. The JIT also sees the exact CPU and the loaded dependencies, which precompiled code cannot ✅[^tiered-design].
6. **JIT: loops and OSR.** Tiering can only swap code at a call, so a method that runs one long loop (all of `Main`, say) would stay at tier 0 ✅[^osr-details]. With quick JIT for loops and OSR on, the JIT puts a *patchpoint* at each loop back-edge with a counter that starts at 1,000; when it runs out, the runtime is called, and a hot patchpoint gets an optimized OSR version that the running frame jumps into ✅[^osr-details]. Methods with loops skip the uninstrumented tier 0 and start instrumented ✅[^pgo-tiers]. In .NET 10 both switches default to on where OSR is compiled in ✅[^src-clrconfig] ✅[^src-jitconfig]; the lab's log showed `Tier1-OSR @0x14` for a loop method ✅[^lab].
7. **Opt-outs.** Methods marked `[MethodImpl(MethodImplOptions.AggressiveOptimization)]`, dynamic methods and methods from collectible assemblies are optimized on their first compilation and skip tiering ✅[^osr-details]; such methods get no profile data ✅[^pgo-tiers]. `DOTNET_TieredCompilation=0` (or `<TieredCompilation>false</TieredCompilation>`) turns tiering off for the whole process ✅[^rc-compilation].
8. **ReadyToRun (publish time).** `PublishReadyToRun=true` compiles the app's assemblies to native code while keeping the IL; files grow to two or three times their size, startup and first-use latency drop, and tiering replaces hot ReadyToRun methods with JIT code because precompiled code is less optimized ✅[^r2r]. In the lab, `dotnet publish -c Release -r osx-arm64 -p:PublishReadyToRun=true` grew eight library assemblies 2.2–3.2 times (`BenchmarkDotNet.dll` from 1,237,504 to 3,120,640 bytes) and a 7 KB app assembly 1.9 times ✅[^lab]. Some methods are never precompiled, such as generic code over types from other assemblies or code that uses hardware intrinsics the compiler cannot prove safe ✅[^r2r]; of the 88 methods a small ReadyToRun app still JIT-compiled at startup, none was the app's own: 75 were generic framework code instantiated for it, 60 of them over `KeyValuePair<string, int>`, and 13 were other framework methods ✅[^lab]. The shared framework itself ships with ReadyToRun code: `DOTNET_ReadyToRun=0` forces the runtime to JIT-compile framework code ✅[^rc-compilation], and in the lab it raised the methods compiled before `Main` from 2 to 242 ✅[^lab].
9. **Native AOT (publish time).** `PublishAot=true` plus `dotnet publish` produces a self-contained native program; it starts faster, uses less memory and runs where a JIT is not allowed, but it has no dynamic assembly loading, no `System.Reflection.Emit`, must be trimmed, compiles to a single file, interprets `System.Linq.Expressions`, and pre-generates every generic instantiation over value types ✅[^aot]. The JIT is still the code generator, but only at build time; it is not part of the shipped app ✅[^perf10]. In the lab the published binary reported `JitInfo.GetCompiledMethodCount() = 0` and `RuntimeFeature.IsDynamicCodeSupported = False` ✅[^lab].
10. **Seeing it.** `DOTNET_JitDisasmSummary=1`, `DOTNET_JitDisasm=<method names>` and `DOTNET_JitStdOutFile=<file>` work in the shipped (release) runtime, not only in debug builds of the runtime ✅[^jit-dumps]; the .NET 10 JIT declares them as release settings ✅[^src-jitconfig]. `System.Runtime.JitInfo` gives the number of compiled methods, the IL bytes and the JIT time, for the current thread or the whole process ✅[^api-jitinfo].

## Worked example
One probe, `Work.Checksum(int[1000])` (a loop of `h = h * 31 + a[i]`), called in 8 batches of 2,000 calls with a 100 ms sleep between batches, run as a Release build on the lab's Apple M2 (8 cores, with other builds running, so treat about ±30% as noise) under five settings; the ranges cover one to three runs per setting ✅[^lab].

| Setting | How `Checksum` was compiled (from `JitDisasmSummary`) | Batches 0–1 | Batch 2 | Batch 4 | Batches 5–7 |
|---|---|---|---|---|---|
| default | Instrumented Tier0 → Tier1-OSR → Instrumented Tier0 → Tier1-OSR → Tier1 with Dynamic PGO | 7,400–9,900 ns | 1,350–1,700 ns | 3,900–4,800 ns | 980–1,230 ns |
| `DOTNET_TieredPGO=0` | Tier0 → Tier1-OSR → Tier1 | 7,100–7,400 ns | 2,000 ns | 3,300 ns | 1,040–1,260 ns |
| `DOTNET_TC_OnStackReplacement=0` | Tier0 → Instrumented Tier0 → Tier1 with Dynamic PGO | 1,480–1,610 ns | 1,410–1,450 ns | 1,120–1,140 ns | 1,050–1,260 ns |
| `DOTNET_TC_QuickJitForLoops=0` | `Tier-0 switched to FullOpts` (optimized at once) | 1,050–1,180 ns | 990 ns | 1,150 ns | not recorded |
| `DOTNET_TieredCompilation=0` | FullOpts | 1,150–1,180 ns | 1,160–1,230 ns | 1,180–1,350 ns | 1,110–1,350 ns |

Four readings. The first batches ran about 8 times slower than the last ones by default, and tier-1 code arrived only in batch 2, more than 200 ms after the first call. The slow start came with the patchpoints: the run with OSR off, whose tier-0 code has none, was within about 1.5 times of optimized code from batch 0. The batch-4 slowdown repeated in all three default runs and lines up with the second `Instrumented Tier0` compilation in the log; from batch 5 the `Tier1 with Dynamic PGO` code ran. Published with ReadyToRun and run in a later, busier session next to a JIT-only publish of the same probe, batches 0–1 took 1,235–2,656 ns per call against 8,756–19,733 ns, 5 to 13 times faster in each run pair (three runs each), because the precompiled code is optimized and has no patchpoints ✅[^lab] ✅[^pgo-tiers].

Then a small startup program (dictionary, LINQ (Language-Integrated Query), string formatting) timed 20 times per setting ✅[^lab].

| Setting | Wall time | Methods JIT-compiled | JIT time |
|---|---|---|---|
| default | about 39 ms | 53 | 7.0 ms |
| `DOTNET_TieredCompilation=0` | about 42 ms | 28 | 12.3 ms |
| `DOTNET_ReadyToRun=0` | about 72 ms | 746 | 42.3 ms |
| `DOTNET_ReadyToRun=0` + `DOTNET_TieredCompilation=0` | about 120 ms | 298 | 95.9 ms |
| Native AOT build of the same program | about 9 ms | 0 | 0 |

Read the rows together: tiering off compiles fewer methods (no recompilations) but spends more time per method; without ReadyToRun the framework itself must be compiled; Native AOT removes the JIT from startup entirely. The Native AOT file was a 1.4 MB executable that needs no installed runtime, against a 152 KB folder for the JIT build, which needs the shared runtime ✅[^lab].

Last, a similar startup program (a dictionary, LINQ with a sort, string formatting and one small class), published three ways with `-c Release -r osx-arm64` and started 20 times per build through its own executable, in two rounds ✅[^lab].

| Build | App assembly | Wall time (median) | Methods JIT-compiled | JIT time |
|---|---|---|---|---|
| JIT only | 7,168 bytes | 31.2–31.6 ms | 98 | 8.9–9.1 ms |
| `-p:PublishReadyToRun=true` | 13,312 bytes | 30.9–31.4 ms | 88 | 7.6–7.7 ms |
| the ReadyToRun build with `DOTNET_ReadyToRun=0` | 13,312 bytes | 60.8–60.9 ms | 828 | 40.9–45.1 ms |
| `-p:PublishAot=true` | 1,519,016-byte executable | 5.5 ms | 0 | 0 |

ReadyToRun took the app's own 10 methods away from the JIT, but startup moved by less than the noise: an app with little code of its own gains little, because the framework it calls is precompiled already ✅[^r2r] ✅[^lab].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| The compilation settings page says that an omitted `TC_QuickJitForLoops` means "not used for methods that contain loops" ✅[^rc-compilation] | In the lab, loop methods started at tier 0 and reached `Tier1-OSR`, and `DOTNET_TC_QuickJitForLoops=0` changed them to `Tier-0 switched to FullOpts` ✅[^lab] | The .NET 10 source defaults the setting to 1 when OSR is compiled in ✅[^src-clrconfig], and the OSR design doc describes the switch of the default to on ✅[^osr-details]; the settings page describes the older .NET Core 3.0–6 behaviour |
| `dotnet run app.cs` with `DOTNET_JitDisasmSummary=1` | The output file holds two numbered lists: the SDK's own methods, then the app's | The SDK command is itself a .NET program and inherits the `DOTNET_` variables; run the built `.dll` with `dotnet app.dll` to see only the app ✅[^lab] |
| `dotnet run app.cs` without `-c Release` | Every method `MinOpts`, no tiers, no OSR ✅[^lab] | File-based apps build Debug by default; Debug turns off runtime optimization ✅[^cs-optimize] |
| `AggressiveOptimization` on a hot method | `FullOpts` at once in Release, `MinOpts` in Debug ✅[^lab] | It bypasses tiering ✅[^osr-details], so it also gets no PGO data ✅[^pgo-tiers] |
| A project with `PublishAot=true`, run on the JIT with `dotnet app.dll` | `Reflection.Emit` throws `PlatformNotSupportedException` there too ✅[^lab] | The SDK writes `System.Runtime.CompilerServices.RuntimeFeature.IsDynamicCodeSupported: false` into `runtimeconfig.json` (seen in the lab ✅[^lab]), the switch the docs offer for testing AOT fallbacks without publishing ✅[^rc-compilation] |
| `Type.GetType(name)` with a name only known at run time, under Native AOT | Returned `null` for `"System.Guid"`, while the JIT build found it; the build warned IL2057 ✅[^lab] | AOT apps must be trimmed, and trimming keeps only what static analysis sees ✅[^aot] |
| Native AOT publish with the Homebrew source-built SDK on macOS | The ILCompiler runtime pack ships inside the SDK (`packs/runtime.osx-arm64.Microsoft.DotNet.ILCompiler`), so nothing was downloaded, but linking failed with `ld: library 'ssl' not found` until `LIBRARY_PATH` pointed at Homebrew's OpenSSL and Brotli ✅[^lab] | The linker command listed `-lssl -lcrypto -lbrotlienc` ✅[^lab], libraries that the official macOS prerequisites (the Xcode command line tools ✅[^aot]) do not cover |
| ReadyToRun publish with the Homebrew SDK on macOS | Restore downloaded one package from nuget.org, `Microsoft.NETCore.App.Crossgen2.osx-arm64` 10.0.12 (11 MB, 36 MB unpacked); the runtime pack came from the SDK's `packs/` folder, and the result was a framework-dependent app ✅[^lab] | ReadyToRun needs a publish for a specific RID (runtime identifier) ✅[^r2r], and this SDK ships the runtime packs for its own RID but not the compiler pack (its `packs/` folder has no Crossgen2 entry) ✅[^lab] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Default tiering + Dynamic PGO | Fast startup and the best steady state, tuned to the types the app really uses | First calls run slow code; numbers drift for the first few hundred milliseconds |
| `TieredCompilation=false` | Optimized from the first call; stable timings | More JIT time at startup (12.3 versus 7.0 ms in the lab), no PGO |
| `PublishReadyToRun=true` | Less JIT work at startup and first use ✅[^r2r]; in the lab a hot loop's first calls ran 5 to 13 times faster than in the JIT-only build, though a small app's startup stayed at about 31 ms ✅[^lab] | Assemblies two to three times larger; per-RID publish ✅[^r2r]; 2.2–3.2 times for eight libraries in the lab, plus an 11 MB Crossgen2 package download ✅[^lab] |
| `PublishAot=true` | No JIT, fastest startup, no runtime install needed ✅[^aot] | No runtime code generation, trimming warnings to fix, per-RID binaries, all generic value-type instantiations compiled in ✅[^aot] |

## Takeaways
- Measure performance only on a Release build and only after warm-up; the first calls run tier-0 code. [rule-candidate]
- Use `DOTNET_JitDisasmSummary=1` with `DOTNET_JitStdOutFile` on `dotnet app.dll` to see which tier each method reached.
- Leave tiering and Dynamic PGO on unless a measurement shows otherwise; `AggressiveOptimization` costs the method its profile data.
- Expect ReadyToRun to pay off in proportion to the app's own code: the framework is precompiled already, so a small app gains little.
- Choose Native AOT only after the build shows no IL2xxx/IL3xxx warnings; reflection over names known only at run time breaks. [rule-candidate]

## Verification status
- Verified: 72 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64), with the Crossgen2 pack `Microsoft.NETCore.App.Crossgen2.osx-arm64` 10.0.12 restored into the lab's package folder (Step 11) for ReadyToRun publishing, where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Managed execution process](https://learn.microsoft.com/en-us/dotnet/standard/managed-execution-process) — Microsoft, living. Rank 1. Backs: CIL is CPU-independent; the JIT compiles on demand at first call; method stubs. [^managed-exec]
- [Runtime configuration options for compilation](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/compilation) — Microsoft, living. Rank 1. Backs: tiering and quick JIT settings; quick JIT code costs; `DOTNET_ReadyToRun`; `DOTNET_TieredPGO`; the dynamic-code switch; the loop setting's documented default. [^rc-compilation]
- [Code generation compiler options: Optimize](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/code-generation) — Microsoft, living. Rank 1. Backs: `Optimize` is off for Debug and also tells the runtime to optimize. [^cs-optimize]
- [ReadyToRun deployment overview](https://learn.microsoft.com/en-us/dotnet/core/deploying/ready-to-run) — Microsoft, living. Rank 1. Backs: R2R contents and size; RID-specific publish; small apps gain little because the framework is precompiled; tiering replaces hot R2R code; methods not precompiled. [^r2r]
- [Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/) — Microsoft, living. Rank 1. Backs: what Native AOT produces, its limitations and prerequisites. [^aot]
- [What's new in .NET 8 runtime](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-8/runtime) — Microsoft, 2023. Rank 1. Backs: Dynamic PGO on by default; about 15% average gain. [^wn8]
- [JitInfo class](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.jitinfo) — Microsoft, living. Rank 1. Backs: compiled method count and JIT time in process. [^api-jitinfo]
- [Tiered Compilation](https://github.com/dotnet/runtime/blob/main/docs/design/features/tiered-compilation.md) — .NET runtime team (Noah Falk), 2018. Rank 1. Backs: tier 0 and tier 1 definitions; 30 calls; the 100 ms delay; background compilation. [^tiered-design]
- [OSR Details and Debugging](https://github.com/dotnet/runtime/blob/main/docs/design/features/OsrDetailsAndDebugging.md) — .NET runtime team, living. Rank 1. Backs: why OSR exists; patchpoints and the 1,000 counter; methods that bypass tiering; the change of the loop default. [^osr-details]
- [Dynamic PGO: Instrumented Tiers](https://github.com/dotnet/runtime/blob/main/docs/design/features/DynamicPgo-InstrumentedTiers.md) — .NET runtime team, living. Rank 1. Backs: the tier flow for JIT and R2R code; loop methods start instrumented; AggressiveOptimization gets no profile. [^pgo-tiers]
- [Viewing JIT disassembly and dumps](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/jit/viewing-jit-dumps.md) — .NET runtime team, living. Rank 1. Backs: `JitDisasmSummary`, `JitDisasm` and `JitStdOutFile` in the shipped product. [^jit-dumps]
- [clrconfigvalues.h (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/coreclr/inc/clrconfigvalues.h) — .NET runtime team, 2025. Rank 1. Backs: `TC_CallCountThreshold` 30, `TC_CallCountingDelayMs` 100, `TC_QuickJitForLoops` default 1 with OSR. [^src-clrconfig]
- [jitconfigvalues.h (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/coreclr/jit/jitconfigvalues.h) — .NET runtime team, 2025. Rank 1. Backs: `TC_OnStackReplacement` default; the disassembly settings are release settings. [^src-jitconfig]
- [Performance Improvements in .NET 10](https://devblogs.microsoft.com/dotnet/performance-improvements-in-net-10/) — Stephen Toub, .NET Blog, 2025. Rank 4. Backs: Native AOT uses the JIT only at build time. [^perf10]

## Related
- `dotnet/runtime/object-layout-and-boxing.md` — what tier-1 code does with virtual calls (guarded devirtualization) and with objects that never escape.
- `dotnet/runtime/garbage-collection.md` — the other half of the runtime.
- `dotnet/performance/measuring-and-reducing-allocations.md` — warm-up and Release builds in practice.
- `dotnet/metaprogramming/reflection-and-attributes.md` — trimming and AOT analysis warnings.
- `dotnet/platform/runtime-and-versions.md` — the SDK, the runtime and how a runtime is chosen.
