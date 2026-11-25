---
schema: knowledge-doc/v1
type: concept
topic: bun/internals
status: verified
applies-to: ["Bun 1.4.5", "Node.js 24.22.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, javascriptcore, jsc, v8, jit, garbage-collection, riptide, stack-trace, tail-calls, bun-jsc, heap-snapshot, smol, memory]
---

# JavaScriptCore in Bun: JIT tiers, garbage collection, stack traces and memory

## Summary
**TL;DR:** Bun runs JavaScript on JavaScriptCore (JSC), the engine of Safari, where Node uses V8 ✅[^1]. JSC moves hot code through four tiers (LLInt, Baseline, DFG, FTL) ✅[^2]; a hot loop ran 44–55× slower with the JIT (just-in-time compiler) turned off, in medians of 5 runs over two sessions ✅[^lab]. JSC implements the proper tail calls of ES2015: a strict tail-recursive `sum(1e6)` returns `500000500000` in Bun and throws `RangeError` in Node 24 ✅[^lab], and the price is stack traces without the frames of functions that ended in a call ✅[^lab] ✅[^4]. V8's `Error.captureStackTrace`, `Error.prepareStackTrace` and `Error.stackTraceLimit` work in Bun ✅[^lab]. `bun:jsc` exposes heap statistics, JIT counters and a sampling profiler; heap snapshots come in JSC and V8 formats; `--smol` lowered peak memory by about 5% in two small workloads in both sessions, while its run-time cost (4–28%) changed with workload and host load ✅[^lab].
**Use this when:** a stack trace, a recursion limit, a memory number or a heap snapshot from Bun does not match what Node shows; or you want to see which JIT tier runs your code.
**Not this doc:** task and timer ordering → [event-loop-and-scheduling.md](event-loop-and-scheduling.md); speed against Node → [performance-measured.md](performance-measured.md); the `node:v8` module's status → [nodejs-compatibility.md](../node-compat/nodejs-compatibility.md).

## Problem
Code tested on V8 meets a different engine on Bun. Deep tail recursion that crashes Node runs fine on Bun, so a suite that passes on Bun can hide a crash on Node. Ordinary recursion overflows at a different depth: 53,209 to 79,729 frames in Bun over 14 runs (the depth changed from run to run), 10,402 to 10,420 in Node over 7, for a one-line function ✅[^lab]. Stack traces skip frames, print plain paths instead of `file://` URLs and point at other columns ✅[^lab]. V8 tools only partly apply: `v8.serialize` bytes differ and heap snapshots have two formats ✅[^lab] ✅[^9].

## Mental model
**Analogy:** a restaurant kitchen. A new dish is cooked by a cook reading the recipe line by line (the interpreter). Once it is ordered a few times, a cook who knows it by heart takes over (Baseline). For a dish ordered all evening, the kitchen preps on assumptions, "every order is medium-rare" (the DFG), and finally builds an assembly line (the FTL). An order that breaks an assumption goes back to the slower cook (an OSR exit, "on-stack replacement" back to a lower tier). A cleaner clears plates while the kitchen keeps cooking (the concurrent garbage collector).

**Artifact:** the sampling profiler in `bun:jsc` reports the tier each sample ran in. For `hot(3e7)`, a loop summing `i % 7`, one run gave the samples `{ "Unknown Executable": 4, Baseline: 10, DFG: 32, FTL: 234 }`; the counts changed between runs, and FTL held most samples in all 4 runs ✅[^lab]:
```ts
import { profile } from 'bun:jsc';
function hot(n: number) { let s = 0; for (let i = 0; i < n; i++) s += i % 7; return s; }
const p = profile(hot, 1, 3e7);   // samples in p.stackTraces.traces[].frames[0].category
```

## How it works
Six actors take part in running and cleaning up a piece of code:
- **Parser** — its job: turn source text into bytecode, via JSC's hand-written recursive-descent parser ✅[^3].
- **LLInt** (low-level interpreter) — its job: run bytecode at once and record profiling data, via an interpreter written in a portable assembly (offlineasm) ✅[^3].
- **Baseline JIT** — its job: compile warm functions to machine code with inline caches, via one machine-code template per bytecode instruction ✅[^2].
- **DFG JIT** (data-flow graph) — its job: compile speculatively from the collected type profiles, via the DFG IR (intermediate representation, the compiler's internal form of the code) ✅[^2].
- **FTL JIT** ("faster than light") — its job: compile the hottest code for peak throughput, via several IRs down to B3 and assembly ✅[^2].
- **Riptide** — its job: reclaim memory while the program runs, via a mostly concurrent mark phase with a retreating-wavefront write barrier ✅[^5].

```
source ─▶ Parser ─▶ bytecode ─▶ LLInt ──(≈6 calls / 100 loop iterations)──▶ Baseline
                                  ▲                                            │
                                  │ OSR exit (a speculation failed)            │ (≈60 calls / 1000 iterations)
                                  │                                            ▼
                               Baseline ◀───────────────────────────────── DFG ──(thousands of calls)──▶ FTL
   Riptide GC: marks concurrently with all tiers; stops the world for short pauses (stack scanning, constraint solving)
```

1. **Parser → LLInt (main thread).** The parser emits bytecode and the LLInt starts running it with no compile step; it is built to cost nothing beyond lexing and parsing ✅[^3].
2. **LLInt → Baseline (main thread).** A function called about 6 times, or looping about 100 times, is compiled by the Baseline JIT; the thresholds are approximate and depend on function size and memory pressure ✅[^3]. Lab, with JSC's `BUN_JSC_reportBaselineCompileTimes`, `…DFGCompileTimes` and `…FTLCompileTimes` reports interleaved with a call counter, and `BUN_JSC_useConcurrentJIT=0` so each compile happens at a fixed point: a one-line `add()` reached Baseline after 33 calls and DFG after 99, in 3 of 3 runs; a loop inside one call reached Baseline after about 490 iterations, DFG after about 1,490 and FTL (entered mid-loop) after about 253,000, in 2 of 2 runs ✅[^lab]. These are about 5 times the documented call and loop counts for Baseline; with the default background compiling the reports came later and varied (Baseline after 74 to 900 calls) ✅[^lab].
3. **Baseline → DFG (background thread).** At about 60 calls or 1000 loop iterations, the DFG compiles the function using the types the lower tiers saw ✅[^3]. The compile runs on a background thread and the optimized code is installed shortly after ✅[^6]. Measured over 6 runs: `add(a, b)` was called between 2,475 and 151,164 times (0.3–3.6 ms; 14,339 in the first run) before `numberOfDFGCompiles(add)` turned 1, far above the documented 60, because calls kept running in the lower tiers while the DFG worked ✅[^lab].
4. **DFG → FTL.** Code invoked thousands of times, or looping tens of thousands of times, is recompiled by the FTL ✅[^3]. The report showed `add()` FTL-compiled after 104,000 and 208,000 calls in two default runs, and not within 300,000 calls in a third ✅[^lab]. With the FTL off (`BUN_JSC_useFTLJIT=0`) the hot loop took 55 ms instead of 45 ms; with every JIT off (`BUN_JSC_useJIT=0`) it took 2485 ms (medians of 5 runs on a host loaded by other work) ✅[^lab]. A re-run at lower host load gave 39, 43 and 1,700 ms ✅[^lab].
5. **OSR exit.** When a speculation fails (a value has an unexpected type), optimized code exits to Baseline or the LLInt and may be compiled again later ✅[^2] ✅[^6]. Lab: `add()` was DFG-compiled after 3,640 and 4,563 integer calls (two runs); string arguments then made `numberOfDFGCompiles(add)` go from 1 to 2 after 3,223 and 3,671 calls, and `BUN_JSC_printEachOSRExit=1` printed `Speculation failure in add#… FTLFunctionCall … (bc#0, BadType)` ✅[^lab].
6. **Riptide (concurrent).** Most marking runs alongside the program; collections that keep "sticky" mark bits from the last cycle are eden (young-generation) collections ✅[^5]. `BUN_JSC_logGC=1` over a script that built and dropped 1.3 million objects logged 5 `EdenCollection` and 2 `FullCollection` entries ✅[^lab]. Since Bun 1.4, JSC in Bun allocates through mimalloc instead of its own libpas allocator ✅[^7]. The binaries agree: the one in `oven/bun:1.3.14` holds 16 distinct libpas function names (`pas_…`), the 1.4.5 binary none ✅[^lab]. `heapStats()` is no marker of the change: it has a `mimalloc` section in 1.3.14 as well (`mimalloc_version` 30301, against 30503 in 1.4.5), because Bun's own code already used mimalloc, and none in `oven/bun:1.1.45` ✅[^lab] ✅[^7]. `Bun.gc(true)` forces a synchronous collection ✅[^8]; after a 300,000-object array was dropped it took `heapSize()` from 26,506,083 to 160,832 bytes ✅[^lab].

V8 has the same idea with other names: Ignition interprets, Sparkplug is the baseline compiler, Maglev and TurboFan optimize ✅[^10]; `node --v8-options` in Node 24.22.1 lists `--sparkplug`, `--maglev` and `--turbofan` ✅[^lab].

### Stack traces
Measured with the same ES module in both runtimes ✅[^lab]:

| What | Bun 1.4.5 | Node 24.22.1 |
|---|---|---|
| Path in a frame | `/w/stack.mjs:22:31` | `file:///w/stack.mjs:22:27` |
| Column of `new Error()` | points at `Error` | points at `new` |
| Class method frame | `at load3 (…)` | `at Repo.load3 (…)` |
| `async` frames | `at lower`, `at async upper` | the same plus `at async file:///w/stack.mjs:20:7` |
| Caller of `function outer() { return inner(); }` | missing | `at outer (…)` |
| `Error.stackTraceLimit` default | `10` | `10` |
| `Error.captureStackTrace(obj, makeErr)` on `{ message: 'custom' }` | `obj.stack` starts at `caller`, `makeErr` hidden; first line `Error` | same frames; first line `Error: custom` |
| `Error.prepareStackTrace = (e, frames) => …` | called with call-site objects (`getFunctionName()`, `getLineNumber()`, `getFileName()`) | same API ✅[^11] |

### Proper tail calls (PTC)
ES2015 requires a call in tail position in strict code to reuse the caller's stack frame ✅[^12]. JSC implements this when the caller is a strict normal or arrow function (not a generator) that returns the callee's result ✅[^4]. In an `.mjs` file a function declaration, a function expression and an arrow function each returned `500000500000` for `1e6` levels, while a generator recursing through `return yield* g(n - 1, …)` threw `RangeError` at `1e5` ✅[^lab]. The caller becomes a "tail deleted frame" and does not show in stack traces ✅[^4]. ES modules are always strict, so in an `.mjs` file `return inner()` drops `outer` from the trace ✅[^lab]. V8 does not implement PTC ✅[^lab].

### `bun:jsc`
| Function | Measured result in Bun 1.4.5 |
|---|---|
| `heapStats()` | `heapSize` 150270, `heapCapacity` 2051934, `objectCount` 1840, `objectTypeCounts` with 70 types, plus `mimalloc` ✅[^lab] |
| `memoryUsage()` | `{ current, peak, currentCommit, peakCommit, pageFaults }`; `current` 27.1 MB at start ✅[^lab] ✅[^6] |
| `process.memoryUsage()` | Node's 5 keys; `heapUsed` 150270 equalled `heapStats().heapSize` ✅[^lab] |
| `setTimeZone('America/New_York')` | returned `'America/New_York'`; an existing `Date` for 12:00 UTC switched from `getHours()` 12 to 7 ✅[^lab] ✅[^6] |
| `serialize(v)` / `deserialize(buf)` | a 63-byte `SharedArrayBuffer`; a `Date`, a `Map` and a `BigInt` came back intact (structured clone) ✅[^lab] ✅[^8] |
| `estimateShallowMemoryUsageOf(x)` | `{}` 64 B; 1 MB `ArrayBuffer` 1048704 B; 1000-char string 1016 B; a 1000-element array 16 B (elements excluded) ✅[^lab] ✅[^8] |
| `numberOfDFGCompiles(f)` | `0` in the lower tiers, `1` once optimized, `1000000` with the JIT off ✅[^lab] ✅[^6] |
| `profile(f, …args)` | `{ functions, bytecodes, stackTraces }`, samples tagged `LLInt`, `Baseline`, `DFG` or `FTL` ✅[^lab] ✅[^6] |
| `fullGC()`, `heapSize()` | full collection, then the live heap size (335343 after the probe; 270150–397180 in three re-runs) ✅[^lab] |

### Heap snapshots
| Call | Format | Measured (5,000 live objects of class `Leaky`) |
|---|---|---|
| `Bun.generateHeapSnapshot()` | JSC object `{ version, type, nodes, nodeClassNames, edges, edgeTypes, edgeNames }`, opened in Safari's Web Inspector ✅[^9] | `version` 3, `type` `Inspector`, `nodeClassNames` contains `Leaky` ✅[^lab] |
| `Bun.generateHeapSnapshot('v8')` | V8 JSON string for Chrome DevTools' Memory tab ✅[^9] | 0.6 MB, `snapshot.node_count` 13706, built in 18 ms (13707 and 11 ms in a re-run) ✅[^lab] |
| `Bun.generateHeapSnapshot('v8', 'arraybuffer')` | the same JSON as UTF-8 bytes ✅[^9] | 0.7 MB `ArrayBuffer` ✅[^lab] |
| `v8.writeHeapSnapshot()` | V8 file in the working directory | `Heap-20261024-084317-7-0.heapsnapshot` ✅[^lab] |
| `bun --heap-prof file` | V8 snapshot written at exit, Node's file-name pattern ✅[^9] | `Heap.20261124.084317.22.0.001.heapprofile` ✅[^lab] |

The V8 snapshot has the layout of the one Node 24's `v8.writeHeapSnapshot()` writes: the same top-level keys (`snapshot`, `nodes`, `edges`, `trace_function_infos`, `trace_tree`, `samples`, `locations`, `strings`), node and edge arrays that divide evenly into `node_count` × fields (6,599 × 7) and `edge_count` × fields (14,112 × 3), and 5,003 nodes named `Leaky`; Bun's `node_fields` add `trace_node_id`, which Node 24's lack ✅[^lab]. Opening either format in Safari's or Chrome's developer tools was not done: that needs a person at the tools' window.

### Memory and `--smol`
`--smol` makes the collector run more often to use less memory; Bun sizes the heap from the available memory (including cgroup limits) with or without it, so the flag mainly makes the heap grow more slowly ✅[^1]. Bun does read the cgroup limit: in a container started with `--memory=256m`, `process.constrainedMemory()` returned 268,435,456, against 8,392,994,816 (the VM's memory) without it ✅[^lab]. Measured as peak RSS (resident set size, the memory the process held in RAM, from `VmHWM` in `/proc/self/status`) and run time, median of 7 runs each, first on a host loaded by other work, then in a re-run at lower load ✅[^lab]:

| Workload | Default: peak RSS, time | `--smol`: peak RSS, time |
|---|---|---|
| 2,000,000 short-lived objects, 20,000 kept in a sliding window | 68.1 MB, 229 ms | 64.2 MB, 292 ms |
| Same, re-run at lower load | 68.9 MB, 183 ms | 65.3 MB, 190 ms |
| 300 batches of 50,000 objects, each batch garbage at once | 77.2 MB, 1692 ms | 73.6 MB, 1971 ms |
| Same, re-run at lower load | 77.4 MB, 591 ms | 74.0 MB, 699 ms |

The memory saving repeated (3.4–3.9 MB, 4–6%). The time cost changed for the first workload (28% on the loaded host, 4% at lower load) and held for the second (16% and 18%) ✅[^lab].

## Worked example
Prove PTC with one file, `tailcall.mjs`, run unchanged in both runtimes ✅[^lab]:
```js
// ES modules are strict, so `return sum(...)` is a proper tail call.
function sum(n, acc = 0) { if (n === 0) return acc; return sum(n - 1, acc + n); }
function sumNoTail(n) { return n === 0 ? 0 : n + sumNoTail(n - 1); }
for (const [name, f] of [['tail sum(1e6)', () => sum(1e6)], ['non-tail sum(1e6)', () => sumNoTail(1e6)]]) {
  try { console.log(name, '=>', f()); } catch (e) { console.log(name, '=>', `${e.name}: ${e.message}`); }
}
let depth = 0; function probe() { depth++; probe(); } try { probe(); } catch { console.log('max non-tail depth ~', depth); }
```
```console
$ docker run --rm -v "$PWD:/w" -w /w oven/bun:1.4.5 bun tailcall.mjs
tail sum(1e6) => 500000500000
non-tail sum(1e6) => RangeError: Maximum call stack size exceeded.
max non-tail depth ~ 53209
$ docker run --rm -v "$PWD:/w" -w /w node:24.22.1-alpine node tailcall.mjs
tail sum(1e6) => RangeError: Maximum call stack size exceeded
non-tail sum(1e6) => RangeError: Maximum call stack size exceeded
max non-tail depth ~ 10402
```
1. `sum` calls itself in tail position, so JSC reuses one frame for all 1,000,000 calls and returns 500000500000.
2. `sumNoTail` must add `n` after the call returns, so it is not a tail call; JSC overflows too.
3. V8 keeps a frame per call and overflows near 10,400 frames; [async-patterns-and-performance-deep-dive.md](../../javascript/async/async-patterns-and-performance-deep-dive.md) records the same `RangeError` for Node 24.
4. The `max non-tail depth` line changes between Bun runs: 53,209 here, and 53,209 to 79,729 in 13 re-runs of the same `probe()` function; Node printed 10,402 to 10,420 in 7 runs ✅[^lab]. Do not rely on an exact recursion limit in Bun.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| The same tail-recursive `sum(1e6)` in a sloppy-mode `.cjs` file | `RangeError` in Bun too ✅[^lab] | PTC applies only to strict code ✅[^4] |
| `function callNamed() { const s = named(); return s; }` in strict code | Bun's trace lacks `callNamed`; sloppy code and Node keep it ✅[^lab] | Observed in Bun 1.4.5 even though the call is not syntactically in tail position; treat any strict function whose last step is a call as one that may vanish from traces |
| `function plain() { const e = new Error('p'); return e; }` read later | Bun's trace starts at the caller of `plain` in strict code ✅[^lab] | Same frame deletion for a constructor call as the last step |
| `BUN_JSC_useJIT=0` | the hot loop ran 44–55× slower (How it works, step 4) ✅[^lab] | Only the LLInt runs |
| Tier-up thresholds | Baseline after 33 calls or about 490 loop iterations with concurrent compiling off ✅[^lab] | The WebKit docs give about 6 calls or 100 iterations ✅[^3]; treat any documented threshold as an order of magnitude, and expect later tier-up with background compiling |
| `v8.writeHeapSnapshot()` default name on 2026-11-24 | `Heap-20261024-…`, month one lower, dashes instead of Node's `Heap.20261124.…` ✅[^lab] | Bun's own naming; pass a file name to avoid relying on it |
| JSC snapshot `version` | `3` ✅[^lab] | The comment in `bun.d.ts` says `2` ✅[^9] |
| `estimateShallowMemoryUsageOf(new Array(1000).fill(0))` | 16 bytes ✅[^lab] | Shallow: referenced storage is excluded ✅[^8] |
| `--smol` on a small workload | 3.4–3.9 MB lower peak RSS, 4–28% slower ✅[^lab] | More frequent collection ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Rely on PTC for deep recursion | Unbounded strict tail recursion in Bun ✅[^lab] | Crashes in Node; frames missing from Bun traces |
| `--smol` | About 5% lower peak RSS here ✅[^lab] | 4–28% longer run time here, depending on workload and host load ✅[^lab] |
| `noFTL(fn)` or `BUN_JSC_useFTLJIT=0` | Shows whether a bug or slowdown is specific to FTL code ✅[^6]; `profile()` of a hot loop gave 920–1,230 FTL samples, and 0 FTL with 932–963 DFG samples after `noFTL()` ✅[^lab] | Peak speed of that code |

## Takeaways
- Write deep recursion as a loop when the code must also run on Node; PTC exists only in JSC. [rule-candidate]
- When a Bun stack trace skips a function, check whether that function ended in a call in strict code before suspecting the bundler or source maps.
- Use `bun:jsc` `heapStats().objectTypeCounts` with `fullGC()` before and after a suspected leak, and `Bun.generateHeapSnapshot('v8')` when you want Chrome DevTools ✅[^6] ✅[^9].
- Treat `--smol` as a memory-for-time trade and measure it on your own workload. [rule-candidate]

## Verification status
- Verified: 103 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; Node comparisons used `node:24.22.1-alpine` on the same host. Two sessions: the first while other work loaded the host, the re-runs later that day at a 1-minute load average below 3. The tier-up reports, OSR exit, GC log, `noFTL`, cgroup and snapshot-layout checks ran later still (load average 6–9), using JSC options passed as `BUN_JSC_*` environment variables. The allocator comparison (strings in the binaries, `heapStats()` keys) ran around midnight, 2026-11-24 to 25, in `oven/bun:1.1.45` (`1.1.45+196621f25`) and `oven/bun:1.3.14` (`1.3.14+0d9b296af`). [^lab]
- [Bun Runtime](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/index.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: JavaScriptCore engine, `--smol` semantics. [^1]
- [Speculation in JavaScriptCore](https://webkit.org/blog/10308/speculation-in-javascriptcore/) — WebKit blog, 2020. Backs: the four tiers, Baseline as a template JIT, DFG IR, FTL IRs, OSR exit. [^2]
- [JavaScriptCore](https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html) — WebKit docs, living. Backs: parser, LLInt in offlineasm, tier thresholds. [^3]
- [ECMAScript 6 Proper Tail Calls in WebKit](https://webkit.org/blog/6240/ecmascript-6-proper-tail-calls-in-webkit/) — WebKit blog, 2016. Backs: PTC conditions, tail deleted frames. [^4]
- [Introducing Riptide](https://webkit.org/blog/7122/introducing-riptide-webkits-retreating-wavefront-concurrent-garbage-collector/) — WebKit blog, 2017. Backs: concurrent marking, eden collections, retreating wavefront. [^5]
- [bun:jsc type definitions (jsc.d.ts)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/jsc.d.ts) — Bun source, tag bun-v1.4.5. Backs: `memoryUsage`, `setTimeZone`, `numberOfDFGCompiles`, background DFG compile, `profile`, `noFTL`. [^6]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: JSC in Bun uses mimalloc; until 1.4, Bun used two allocators, JSC's libpas and mimalloc. [^7]
- [Utils](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/utils.mdx) and [Benchmarking](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/project/benchmarking.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: `serialize`, `estimateShallowMemoryUsageOf`, `Bun.gc`, `heapStats`. [^8]
- [bun.d.ts](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/bun.d.ts) and [Benchmarking: heap profiling](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/project/benchmarking.mdx) — Bun source and docs. Backs: `generateHeapSnapshot` formats, `--heap-prof` naming, the snapshot `version` comment. [^9]
- [Maglev - V8's Fastest Optimizing JIT](https://v8.dev/blog/maglev) — V8 blog, 2023. Backs: V8's tiers. [^10]
- [Stack trace API](https://v8.dev/docs/stack-trace-api) — V8 docs, living. Backs: `captureStackTrace`, `prepareStackTrace`, call-site objects. [^11]
- [ECMAScript: tail position calls](https://tc39.es/ecma262/#sec-tail-position-calls) — TC39, living. Backs: tail calls in strict code. [^12]

## Related
- `bun/internals/event-loop-and-scheduling.md` — how JSC's microtask queue meets Bun's event loop
- `bun/internals/performance-measured.md` — startup and throughput against Node 24
- `bun/node-compat/nodejs-compatibility.md` — `node:v8` and `node:inspector` status
- `bun/fundamentals/configuration-and-environment.md` — `--smol` and other runtime flags
- `javascript/async/async-patterns-and-performance-deep-dive.md` — V8's missing tail calls, measured in Node 24
- `js-runtime/v8-hidden-classes.md` — V8's object shapes and inline caches
- `performance/measurement/profiling-and-flame-graphs.md` — profiling in general
