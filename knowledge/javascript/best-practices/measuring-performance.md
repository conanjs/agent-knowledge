---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24.22.1 (V8 13.6.233.17), linux arm64, pointer compression off: lab of 2026-11-26", "V8 source at tag 13.6.233.17; V8 15.8.62.31 and Chromium main read 2026-11-28 for JE-M13", "V8 12.4 to 15.0 (Node.js 22.23.4 and 25.7.0, Electron 38.8.6 and 43.7.7, Deno 2.9.8, Node.js 24.22.3 with pointer compression): re-run of 2026-11-27", "Google Chrome 158.0.8127.89 (V8 15.8.62.31), headless page 2026-11-27; visible window, hidden, minimized and covered tabs 2026-11-28", "SpiderMonkey (Firefox 161.0) and JavaScriptCore (jsc shell of macOS 26.1, Bun 1.4.5, Playwright WebKit build 2311), JE-M1 only: 2026-11-28"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, benchmarking, v8, tiers, deoptimization, memory-measurement, headless-chrome]
derived-from: [js-runtime/v8-compiler-pipeline-deep-dive.md, js-runtime/v8-memory-and-startup-deep-dive.md, js-runtime/v8-object-and-value-representation-deep-dive.md, js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: measuring performance and reading what V8 did

## Summary
**TL;DR:** Thirteen practices for measuring JavaScript speed and memory and for checking what V8 did, each backed by a pitfall the labs hit: warm up past the point where times settle, time with production sizes, keep every result live, count deopts and collections before timing, read tier bits on the build itself, read `heapUsed` only after a forced collection, and never time in a background tab. The two pitfalls that cost most: on Node.js 24.22.1 a `forEach` loop took 51 to 76 ms per round in its first 10,000 calls and 19 to 21 ms after 12,000 ✅[^lab], and in Chrome 158 a probe in a tab that was not in front stayed Maglev code in 15 of 15 runs ✅[^lab-matrix].
**Use this when:** you write or judge a micro-benchmark, a tier check, a memory or leak test, or a claim that a change is faster or smaller; you move a number between Node.js, Electron and Chrome; you benchmark in headless Chrome, Puppeteer or Playwright.
**Not this doc:** which code forms are fast → [functions-and-optimization.md](functions-and-optimization.md) (`JE-F`), [objects-and-shapes.md](objects-and-shapes.md) (`JE-O`), [numbers-and-arrays.md](numbers-and-arrays.md) (`JE-N`), [strings-and-collections.md](strings-and-collections.md) (`JE-S`); what each `process.memoryUsage()` field counts → [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md) (`JN-H3`); start-up timing → [nodejs-startup.md](nodejs-startup.md) (`JN-U`); benchmarking method in any language → [benchmarking-methodology.md](../../performance/measurement/benchmarking-methodology.md); the mechanisms → [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) and [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md).

## Scope
The catalog covers how to time JavaScript, how to measure its memory, and how to read V8's own tools (trace flags, test-only natives, status bits) on a given build. Evidence: the baseline lab ran Node.js 24.22.1 (V8 13.6.233.17, linux arm64 in a container on one Apple M2, pointer compression off) on 2026-11-26 ✅[^lab]; the scripts ran again on 2026-11-27 on V8 12.4 to 15.0 (Node.js 22 and 25, Electron 38 and 43, Deno 2.9, a Node.js 24.22.3 build with pointer compression) and in Google Chrome 158 (V8 15.8, headless, the script inlined in a `file://` page, V8 flags passed with `--js-flags`, timed with the Chrome flag `--disable-renderer-backgrounding` unless "default headless" is said), and on 2026-11-28 in a visible Chrome window ✅[^lab-matrix]. The **Other engines** line of `JE-M1` comes from a cross-engine lab of 2026-11-28 on SpiderMonkey (Firefox 161) and JavaScriptCore (a shell, Bun, a WebKit page; Safari itself was not run) ✅[^lab-cross]. Not run on other engines: `JE-M2`, `JE-M3`, `JE-M5`, `JE-M10`, `JE-M11`; `JE-M4`, `JE-M6` to `JE-M9`, `JE-M12` and `JE-M13` are about V8's own tools and builds and are V8-specific by nature. Every official Node.js build run reports pointer compression off; Electron 43 and Chrome 158 were measured with it on ✅[^lab-matrix].

**How to read "Applies".** `always`: the better form is as clear as the other, so use it by default. `hot path`: only in code that runs per request, per frame or per element of a large collection, or that a profile points at. `large data`: only above the size the note gives. `startup`: only when start time matters. `check build`: the answer depends on the engine version or build. `no gain`: the lab measured no useful difference, or the advice is outdated; there is no reason to rewrite code for it.

**Terms.** Each is explained with an everyday comparison.
- **Tier**: one of V8's ways to run a function: the Ignition interpreter, then the Sparkplug, Maglev and **TurboFan** compilers, TurboFan making the fastest code ✅[^maglev]. A function moves up only after it has used up a budget set by its bytecode length ✅[^tiering]. Like a new employee who gets faster tools only after a probation period.
- **Feedback vector**: a function's per-operation record of what each operation saw (shapes, types, call targets) ✅[^v8-lite]. Like a cashier's notebook of what each customer usually buys.
- **On-stack replacement (OSR)**: switching a function that is still inside a long loop into optimized code in the middle of the loop ✅[^tiering]. Like changing a car's tyres while it keeps driving.
- **Natives**: test-only functions such as `%GetOptimizationStatus(f)`, enabled by `--allow-natives-syntax` ✅[^runtime-h].
- **Scavenge**: a collection of the young generation of the heap; GC = garbage collection ✅[^lab].
- **Pointer compression**: a build option that stores heap references in 4 bytes instead of 8, inside a 4 GB region ✅[^v8-ptrcomp]. Like writing street numbers instead of full addresses when everyone lives in one town.
- **Efficiency mode**: a V8 state in which TurboFan is delayed and the lower tiers compile synchronously ✅[^v8-tiering-158].

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JE-M1` | A benchmark that times the first few thousand calls, or warms up with other values than it measures | Warm up 20,000+ calls with production-like values, then time | always | Node.js 24.22.1: rounds settled after 12,000 calls ✅[^lab]; 18,000 on V8 14.1 to 15.8 ✅[^lab-matrix]; JavaScriptCore 9,000 ✅[^lab-cross] |
| `JE-M2` | A benchmark of a few calls over a huge array used to decide code that runs many times on small ones | Time with the production array size and call count | always | `forEach` / index loop 6.7 to 7.1 times with 1,000,000 items × 20 calls (OSR code), 1.84 to 1.94 with 1,000 items × 20,000 calls (Node.js 24.22.1) ✅[^lab] |
| `JE-M3` | A timing loop that discards the result, or an allocation benchmark whose objects never leave the loop | Sum every result into a checksum and print it; 0 scavenges or flat time means the work was removed | always | 10 million temporary `{ x, y }`: 0 scavenges; stored in an outside array: more than 20 (Node.js 24.22.1) ✅[^lab] |
| `JE-M4` | `%OptimizeFunctionOnNextCall` after 1 or 2 calls used to prove something is or is not optimized or inlined | Warm up 20 to 50 calls first; prefer natural tier-up, with inlining flags off to read a small callee's own tier | always | After 2 calls: `no feedback vector`, not inlined; after 20: inlined (Node.js 24.22.1) ✅[^lab] |
| `JE-M5` | A performance claim backed by one timing, or timings compared across machines or builds | Count deopts, scavenges, IC changes first (`--trace-deopt`, `--trace-gc`); time 3+ runs and report the range | always | With `--single-threaded`, TurboFan came at call 1,957 in every run; medians of one row moved up to about 30 % between passes (Node.js 24.22.1) ✅[^lab] |
| `JE-M6` | A hot function suspected of being "not optimized" or "deopting", with no trace | Run `--trace-opt --trace-deopt` (and `--trace-deopt-verbose` for the line) and fix the reason it names | always | Seven cases, seven distinct reasons printed (Node.js 24.22.1) ✅[^lab] |
| `JE-M7` | `%GetOptimizationStatus(f) & 64` (or `& 32`) hard-coded as the TurboFan or Maglev test | Force TurboFan on a probe and print the raw value first | check build | TurboFan code read 81 (bit 64) on Node.js 22 and 24 ✅[^lab], 41 (bit 32) on V8 14.0 (Electron 38), Node.js 25 and Chrome 158 ✅[^lab-matrix] |
| `JE-M8` | Tier or timing results from Node.js 22, Chrome, or an x64 container emulated on an arm64 Mac | Check `node --v8-options` for `--no-maglev` / `--no-turbofan` (in Chrome: the `JE-M7` probe, and `JE-M13`); never time under emulation | check build | Node.js 22.23.4 has Maglev off; emulated x64 Node.js 24 has TurboFan off ✅[^lab-matrix] |
| `JE-M9` | A check that relies on a V8 trace flag or native printing something, on Electron, Node.js 22 or 25, or in a Chrome page | Confirm the flag exists and the native answers a known case | check build | Node.js 24.22.1 has no `--trace-ic` ✅[^lab]; a Chrome page reads no trace or `%DebugPrint` and ignores `--always-turbofan` ✅[^lab-matrix] |
| `JE-M10` | `heapUsed` read without `gc()`, or a leak test written at module top level | Run with `--expose-gc`, call `gc()` before each reading (`usedJSHeapSize` in a page), create the measured objects inside a function | always | After dropping a 15 MiB array: 19.1 MiB without `gc()`, 3.8 MiB after; a top-level `WeakMap` test kept its value (Node.js 24.22.1) ✅[^lab] |
| `JE-M11` | A memory claim for `Buffer` or `ArrayBuffer` code backed by `heapUsed`, or read right after `gc()` | Read `external`, `arrayBuffers`, `rss` after a timer turn and a second `gc()` | check build | 64 MiB `ArrayBuffer`: `external` +64 MiB, `heapUsed` 0 (Node.js 24.22.1) ✅[^lab]; `arrayBuffers` 0 in Electron and Deno; Chrome's `usedJSHeapSize` held buffers ✅[^lab-matrix] |
| `JE-M12` | Byte counts, heap limits or small-integer limits from Node.js applied to Electron or a browser | Compare only builds with the same pointer compression | check build | Small-integer array of 2,000,000: 15,625 KB without compression, 7,813 KB with; heap cap 4,096 MiB with it ✅[^lab-matrix] |
| `JE-M13` | A benchmark or long computation in headless Chrome, in a Chrome tab not in front (or its workers), or with Energy Saver on | Time in the front tab, Energy Saver off, 8 s after showing it; headless: `--disable-renderer-backgrounding`; check TurboFan (41) | check build | Chrome 158: probe TurboFan in 10 of 10 front-tab runs, 0 of 24 in tabs not in front; 39.2 to 41.6 ms (up to 58.5 ms under load) against 23.0 to 27.5 ms ✅[^lab-matrix] |

## Lookup notes
### `JE-M1` Warm up past the point where the numbers settle (20,000 calls or more), with production values
**Prefer:**
```js
for (let i = 0; i < 30_000; i++) check += f(sample);  // warm-up, same kind of input
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) check += f(sample);
```
**Avoid:**
```js
const t0 = process.hrtime.bigint();
for (let i = 0; i < 2_000; i++) f(sample);             // times the lower tiers
```
**Why:** A function reaches TurboFan only after it has used up a budget set by its bytecode length ✅[^tiering], often thousands of calls ✅[^lab]. Values that the warm-up never showed (a larger integer, a new shape) make the optimized code deoptimize in the middle of the measurement ✅[^lab].
**Evidence:** Node.js 24.22.1, 2,000 calls per round over 10,000 items, three runs: the first five rounds (10,000 calls) took 51 to 76 ms for `forEach` and 95 to 111 ms for `reduce`; from the seventh round (after 12,000 calls) mostly 19 to 21 ms and 8 to 10 ms ✅[^lab]. For this one body and size: settled from the third round (after 4,000 calls) on V8 12.4 (Node.js 22.23.4), and from the tenth round (after 18,000 calls) on V8 14.1 (Node.js 25.7.0) and 15.0 (Electron 43), where `forEach` then took 30 to 39 ms per round. Chrome 158 with TurboFan available (`--disable-renderer-backgrounding` or `--no-efficiency-mode`, three runs each, and two of three default-headless runs): settled from the tenth round too, `forEach` 36 to 42 ms and `reduce` 13 to 16 ms per round; in the third default-headless run neither settled (60 to 65 ms and 97 to 106 ms in every round), see `JE-M13` ✅[^lab-matrix]. Another function reaches each tier at other call counts; the lab used up to 30,000 warm-up calls.
**Other engines:** Holds, weaker in Chrome and Firefox: in 15 rounds of 1,000 calls over 10,000 items, `forEach` stepped down on JavaScriptCore (after 9,000 calls in the shell and Bun, after 5,000 to 10,000 in the WebKit page, run to run: 22 to 23 ms to 7.7 to 9 ms per round) and `reduce` after 5,000 in the shell, as V8 did in Node.js 24.22.1 on macOS (`forEach` after 11,000 calls, 26 to 10 ms); in Chrome 158 (a visible window) and on SpiderMonkey (Firefox 161: `forEach` 38 to 52 ms in every round) neither stepped down within 15,000 calls. Warming up longer never hurt; 2,000 calls would have timed the slow phase on V8 in Node.js and on JavaScriptCore ✅[^lab-cross].
**Exceptions:** when the question is start-up or first-call cost, fresh processes are timed instead ([nodejs-startup.md](nodejs-startup.md)).
**Check it:** print the time of every round (`performance.now()` in a page), and start the timed part only after the numbers stop falling.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §4.2 Four loop forms, timed in two workloads; §6.2 Pitfalls when measuring; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4.20.

### `JE-M2` Benchmark with the production array size and call count, not one big call
**Prefer:**
```js
// production: handler called per request over ~1,000 rows
for (let r = 0; r < 20_000; r++) check += sumRows(rows1k);
```
**Avoid:**
```js
for (let r = 0; r < 20; r++) check += sumRows(rows1e6);   // measures OSR code
```
**Why:** A function called a few times never reaches its call-count budget; its loop runs in OSR code instead ✅[^tiering], while `forEach` and `reduce` loop inside the built-in. The ranking of loop forms changes with the tier that ran ✅[^lab].
**Evidence:** Node.js 24.22.1, four runs: with 1,000,000 items × 20 calls, `forEach` took 6.7 to 7.1 times as long as an index loop (`--trace-osr` printed 201 `OSR - entry` lines for the `for` loop, none for `forEach`); with 1,000 items × 20,000 calls (all TurboFan), 1.84 to 1.94 times; at 100,000 items × 200 calls, `for` reached TurboFan while `forEach` and `reduce` stayed in Maglev, 3 to 45 times slower ✅[^lab]. On V8 15.0 (Electron 43, Deno 2.9.8) the index loop and `for…of` were TurboFan code at entry after the same 200 calls. Chrome 158, 1,000,000 items × 20 calls, three runs: the index loop was TurboFan code at entry in every run; `for…of` took 0.88, 3.43 and 8.47 times as long (TurboFan code at entry in the first two), `forEach` 6.46 to 7.17 and `reduce` 6.12 to 6.73 times; in a visible window `for…of` 8.66 to 9.65, `forEach` 6.72 to 7.76 and `reduce` 6.35 to 7.05 times, against 0.96 to 2.70 in the many-calls workload (`JE-F12` in [functions-and-optimization.md](functions-and-optimization.md)) ✅[^lab-matrix].
**Exceptions:** none found in the lab.
**Check it:** `node --trace-osr bench.js | grep -c 'OSR - entry'`: many entries mean the loop ran in OSR code, not in code compiled for the whole function. A Chrome page cannot read this trace.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §4.2; §3.4 On-stack replacement for hot loops; §6.2.

### `JE-M3` Use every result of the benchmarked code, and print it
**Prefer:**
```js
let check = 0;
for (let i = 0; i < N; i++) check += f(data[i & 1023]);
console.log('checksum', check);
```
**Avoid:**
```js
for (let i = 0; i < N; i++) f(data[i & 1023]);   // result unused
```
**Why:** An optimizing compiler may remove work whose result nobody reads. In V8, escape analysis removes the allocation of a temporary object that never leaves the function ✅[^escape-h], so a benchmark of "allocating points" measured no allocation at all ✅[^lab].
**Evidence:** Node.js 24.22.1: 10 million `{ x, y }` objects in a TurboFan loop caused 0 scavenges; with each object also stored in an outside array, more than 20; every timing script of the compiler lab sums into a checksum and prints it ✅[^lab]. Same on V8 12.4, 14.1 and 15.0 ✅[^lab-matrix]. The general method (keep results live, repeat, report a spread) is in [benchmarking-methodology.md](../../performance/measurement/benchmarking-methodology.md), whose dead-code timing example is in C, not JavaScript.
**Exceptions:** none found in the lab.
**Check it:** a time that does not grow with N, or 0 scavenges for code that "allocates", means the work was removed: `node --trace-gc bench.js | grep -c Scavenge`.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.6 Escape analysis: objects that are never allocated.

### `JE-M4` Do not force optimization after two calls; prefer natural tier-up
**Applies in detail:** a test that uses `%OptimizeFunctionOnNextCall` or reads a small function's own tier, such as `%PrepareFunctionForOptimization(f); f(); f(); %OptimizeFunctionOnNextCall(f);` used to prove that something is or is not optimized or inlined.
**Prefer:**
```js
%PrepareFunctionForOptimization(caller);
for (let i = 0; i < 20; i++) caller(i);    // tens of calls: callees get feedback vectors
%OptimizeFunctionOnNextCall(caller); caller(1);
```
**Avoid:**
```js
caller(1); caller(2); %OptimizeFunctionOnNextCall(caller); caller(3); // callees not inlinable yet
```
**Why:** TurboFan inlines a callee only once it has a feedback vector ✅[^inl-heur], and V8 13.6 allocates it after a budget of `bytecode_length * invocation_count_for_feedback_allocation` ✅[^tiering], the flag being 8 ✅[^lab]. Forcing also takes a path real code may not take. In natural tier-up, a small callee inlined into its caller never changes its own status ✅[^lab].
**Evidence:** Node.js 24.22.1: after 2 warm-up calls, `Cannot consider … for inlining (no feedback vector)`; after 20, the callee was inlined; a feedback vector existed after 9 calls for a one-line and a 60-statement function, after 2 for one with an 8-step loop; in natural tier-up with inlining on, 12 of 16 small subjects stayed in Sparkplug or Maglev for 40,000 calls because TurboFan had inlined them into their caller, and with `--no-turbo-inlining --no-maglev-inlining` all 16 reached TurboFan ✅[^lab].
**Exceptions:** none found in the lab.
**Check it:** `node --allow-natives-syntax --trace-turbo-inlining test.js | grep 'no feedback vector'`: no line.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §2.3 Feedback vectors and type feedback; §3.8; §6.2.

### `JE-M5` Count what the engine did before you time it, and compare timings only within one run
**Prefer:**
```sh
node --trace-deopt app.js | grep -c bailout             # deopts: a count
node --trace-gc app.js | grep -c Scavenge               # collections: a count
node --single-threaded --allow-natives-syntax tierup.js # repeatable tier-up calls
```
**Avoid:** "it took 12.3 ms before and 10.1 ms after" from one run each, on a shared machine.
**Why:** Counts of deopts, IC (inline cache) state changes, scavenges and bytecode bytes repeat exactly from run to run; timings move with the machine, other jobs and background compilation ✅[^lab].
**Evidence:** Node.js 24.22.1: with `--single-threaded`, `sum` reached Sparkplug at call 28, Maglev at call 70 and TurboFan at call 1,957 in every run; with the default flags the call numbers changed from run to run. On a shared machine, medians of the same row differed by up to about 30 % between the first pass and later ones (memory lab). The object lab's timings come from one machine: only the order of magnitude between cases carries over ✅[^lab].
**Exceptions:** a claimed speed-up is timed too, with several runs, after the counts show the engine did what was expected.
**Check it:** run the timing at least three times and report the range, as every lab here does.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §2.2 The four tiers, and when each takes over; §6.2; [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) §6.2 Pitfalls when measuring; [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §1.2 How the lab ran.

### `JE-M6` Read deopt reasons from `--trace-deopt` instead of guessing why code is slow
**Prefer:**
```sh
node --trace-opt --trace-deopt app.js | grep -E 'completed compiling|bailout'
node --trace-deopt-verbose app.js | grep 'deoptimize at'   # file:line:column of the failed check
```
**Avoid:** rewriting the function from a list of "optimization killers" (`JE-F9` in [functions-and-optimization.md](functions-and-optimization.md)).
**Why:** Each deopt prints V8's reason and the failed operation; the reason strings are defined in V8's source ✅[^deopt-reason], and the reason names the fix ✅[^lab].
**Evidence:** Node.js 24.22.1, seven cases, seven reasons: `wrong map` (a new shape), `overflow` (a small integer left its range), `out of bounds` (a read past the end), `Insufficient type feedback for generic named access` (a branch first run after optimization), `not a Smi` (a double where integers were seen), `wrong call target`, and a lazy deopt after `P.prototype.m` was replaced (printed as `(unknown)`, after a `marking dependent code … reason: dependent field type constness changed` line) ✅[^lab]. V8 12.4 prints `reason: code dependencies` for the last; with pointer compression on (Electron 43, Node.js 24.22.3), `inc(2 ** 31 - 1)` deopts with `not a Smi` instead of `overflow` ✅[^lab-matrix].
**Exceptions:** V8 flags have no stability guarantee across Node.js versions ✅[^node-cli]; check the spelling with `node --v8-options`.
**Check it:** the commands above; `--trace-opt` also prints `Function is too big to be optimized`.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.2 Speculative optimization and deoptimization; §5.3 How to watch it; [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md), Scope.

### `JE-M7` Never hard-code a `%GetOptimizationStatus` mask: read it on the build first
**Applies in detail:** the bit layout moved between V8 13.6 and V8 14.0 (Electron 38; Node.js 25 and Chrome 158 have it too; builds in between were not run); a test with `%GetOptimizationStatus(f) & 64` (or `& 32`, `& 16`) decides "TurboFan" or "Maglev".
**Prefer:**
```js
// node --allow-natives-syntax probe.js, or a Chrome page with --js-flags=--allow-natives-syntax
function probe(x) { return x + 1; }
%PrepareFunctionForOptimization(probe); probe(1); probe(2);
%OptimizeFunctionOnNextCall(probe); probe(3);
console.log(%GetOptimizationStatus(probe)); // 81 (Node.js 22, 24): TurboFan is bit 64
                                            // 41 (V8 14.0 and later, Node.js 25, Chrome 158): TurboFan is bit 32
```
**Avoid:**
```js
const turbo = !!(%GetOptimizationStatus(f) & 64);  // reads "Interpreted" on V8 14.0 and later
```
**Why:** The bits belong to V8's test-only natives ✅[^runtime-test]. By V8 14.0, `AlwaysOptimize` was gone and every bit from `MaybeDeopted` up sat one place lower ✅[^lab-matrix].
**Evidence:** TurboFan code read `81` (bits 0, 4, 6: `IsFunction|Optimized|TurboFanned`) on Node.js 22.23.4 (V8 12.4) and 24.22.1 (V8 13.6) ✅[^lab], and `41` (bits 0, 3, 5) on Electron 38.8.6 (V8 14.0), Node.js 25.7.0 (V8 14.1) and Electron 43 (V8 15.0); Maglev `49` against `25`; Chrome 158 in a page: the V8 14.1 layout, TurboFan code 41, Maglev code 25, Sparkplug 16385, interpreted 65, never called 131073; twelve scripts of the lab printed wrong tiers on 14.1 and 15.0 as written ✅[^lab-matrix]. The names and when each bit is set were read from the V8 13.6.233.17 source only ✅[^runtime-h] ✅[^runtime-test]; the 14.1 layout was found by experiment, not read from that version's source.
**Exceptions:** a probe that shows no TurboFan value after the forced optimization means TurboFan is off or refused on that build: `JE-M8`.
**Check it:** the probe above, on every build tested (Node.js or a Chrome page); decode the other bits with the table of §5.1 of the compiler deep dive, one bit lower from V8 14.0 on.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §4.1 Reading `%GetOptimizationStatus`, bit by bit; §5.1; §6.4 Other builds and versions.

### `JE-M8` Check which tiers the build turns on before you read tier results or time anything
**Applies in detail:** results compared across Node.js 22 and 24 or with Chrome, or a benchmark run in an x64 container on an arm64 Mac (Docker `--platform linux/amd64`, Rosetta).
**Prefer:**
```sh
node --v8-options | grep -A1 -E '^  --(maglev|turbofan) \('   # "default: --no-…" means off
```
**Avoid:** timing in an emulated x64 container, or concluding "never optimized" there.
**Why:** The tier defaults are build facts. With Maglev off, functions go from Sparkplug straight to TurboFan; with TurboFan off, nothing reaches the top tier, even when forced ✅[^lab-matrix].
**Evidence:** Node.js 22.23.4 (V8 12.4) prints `--no-maglev`: with `--single-threaded`, `sum` went from Ignition straight to TurboFan at call 403. Node.js 24.22.1 in an emulated linux x64 container prints `--no-turbofan`: `%OptimizeFunctionOnNextCall` left functions without TurboFan code until `--turbofan` was passed; Node.js 24.22.3 with pointer compression, emulated the same way, also starts with `--no-turbofan`; the cause was not isolated, native x64 hardware was not run, and no timing ran on the emulated builds. Chrome 158 (`--single-threaded`): `sum` went from Ignition to Maglev at call 70 with no Sparkplug step (Sparkplug at call 2 only with `--no-baseline-batch-compilation`), and TurboFan came at call 3091 only with V8's efficiency mode off (`JE-M13`); a page cannot read `--v8-options` ✅[^lab-matrix].
**Exceptions:** none found in the lab.
**Check it:** the command above; then the `JE-M7` probe must print a TurboFan value. In a Chrome page only the probe works.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §2.2; §6.4.

### `JE-M9` Check that a flag or native exists and prints on your build before trusting silence
**Prefer:**
```sh
node --v8-options | grep -c -- '--trace-ic '            # 0 on Node.js 24: use --log-ic
node --log-ic --logfile=ic.log --no-logfile-per-isolate app.js
```
**Avoid:** reading "no output" from `--trace-normalization` or `--trace-elements-transitions` as "nothing happened"; passing `--always-turbofan` to Chrome and assuming it took effect.
**Why:** Some flags do not exist, are rejected, or print nothing for user code in a release build; natives can be missing or print less ✅[^lab] ✅[^lab-matrix].
**Evidence:** Node.js 24.22.1 (V8 13.6): no `--trace-ic` and no `--trace-maps`; `--trace-normalization` printed nothing for a `delete`, and `--trace-elements-transitions` nothing for the script's own `push(4.5)` ✅[^lab]. `--always-turbofan` is a bad option on V8 14.1 and 15.0, `--polymorphic-inlining` does not exist there, and `--optimize-maglev-optimizes-to-turbofan` does not exist on V8 12.4; `%StringIsFlat` is not defined on V8 12.4 (`SyntaxError`). Electron 43 (`v8_enable_object_print: 0`): `%DebugPrint` prints one short line, so checks that read its fields (feedback vector, elements kind) cannot run there; not because of pointer compression, since Node.js 24.22.3 with it printed every field. Chrome 158, headless page: the natives answer with `--js-flags=--allow-natives-syntax`, but V8's trace flags, `--v8-options` and `%DebugPrint` print nothing the page can read, and `--always-turbofan` is silently ignored (no "bad option" message; it set no status bit) ✅[^lab-matrix].
**Exceptions:** none found in the lab.
**Check it:** the `grep` above for each flag; for a native, run it once on a value whose answer is known (`%IsSmi(1)`, `%HasFastProperties({})`), in a page too; a trace flag cannot be checked from a page.
**Full lab:** [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §1.2 How the lab ran; §6.3 Other builds and versions; [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §6.4.

### `JE-M10` Read `heapUsed` after a forced full GC, with the measured objects allocated inside a function
**Prefer:**
```js
// node --expose-gc leak-test.js
function setup() { const key = {}; wm.set(key, bigValue()); }  // key lives only in this frame
setup(); globalThis.gc();
console.log(process.memoryUsage().heapUsed);
// Chrome page, started with --js-flags=--expose-gc --enable-precise-memory-info:
gc(); console.log(performance.memory.usedJSHeapSize);
```
**Avoid:**
```js
let key = {}; wm.set(key, bigValue()); key = null;   // top level: key stayed alive through gc()
console.log(process.memoryUsage().heapUsed);         // no gc(): counts garbage too
```
**Why:** `heapUsed` includes garbage not yet collected, and a forced `gc()` is a synchronous major collection ✅[^gcext]. A reference that looks dropped at top level can still be held by the top-level frame: a likely cause that the lab did not confirm.
**Evidence:** Node.js 24.22.1: after `big = null` on a 15 MiB (mebibyte) array, `heapUsed` stayed 19.1 MiB, and fell to 3.8 MiB only after `gc()`; a `WeakMap` test written at top level kept its 15 MiB value through a full GC, and the same test with the key created inside a function freed it ✅[^lab]. What stayed alive was the same on Node.js 22.23.4, 24.22.1 and 25.7.0 and on Electron 43 (the top-level value also survived there); with pointer compression on (Electron 43, Node.js 24.22.3) the sizes were about half. Chrome 158: page variants read `performance.memory.usedJSHeapSize` right after `gc()`, in Chrome started with `--enable-precise-memory-info`; what was kept alive and freed was the same, at half the size (ten closures 38.1 MiB against 76.3 MiB) ✅[^lab-matrix].
**Exceptions:** `gc()` does not belong in production code: `JL-G8` in [memory-and-garbage-collection.md](memory-and-garbage-collection.md).
**Check it:** `node --expose-gc` and `globalThis.gc()` before every reading; in a Chrome page, `gc()` before every `usedJSHeapSize` reading.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) §6.2 Pitfalls when measuring; §6.1 Corrections; §5.2 How to measure memory and startup in Node.js 24; §6.4 Other builds and versions.

### `JE-M11` Measure buffers in `external` and `arrayBuffers`, a timer turn after the GC
**Applies in detail:** `rss` and `arrayBuffers` behave differently on macOS and in embedders such as Electron; a Chrome page counted buffers in `usedJSHeapSize`.
**Prefer:**
```js
globalThis.gc();
await new Promise((r) => setTimeout(r, 100));   // backing stores are freed after the GC
globalThis.gc();
const { external, arrayBuffers, rss } = process.memoryUsage();
```
**Avoid:** `heapUsed` as the measure for buffer-heavy code; one reading in the same job as `gc()`.
**Why:** In Node.js, `ArrayBuffer` and `Buffer` contents live outside the V8 heap and are counted as `external` ✅[^nodeproc]. Their memory is returned after the GC, not inside it, partly after a later timer turn ✅[^lab]. What each field counts: `JN-H3` in [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md).
**Evidence:** Node.js 24.22.1 (Linux arm64): `new ArrayBuffer(64 MiB)` moved `external` and `arrayBuffers` by +64 MiB and `heapUsed` by 0; after dropping two 64 MiB buffers the counters fell in two steps, the split differing between runs ✅[^lab]. On macOS (Node.js 22.23.4, 24.22.1, 25.7.0) `rss` did not fall; `arrayBuffers` stayed 0 in every row in Electron 43, Electron 38.8.6 and Deno 2.9.8, and never in a Node.js build run; Node.js 24.22.3 with pointer compression reported it like the baseline ✅[^lab-matrix]. The Node.js docs allow `arrayBuffers` to be 0 when Node.js is embedded as a library ✅[^nodeproc]. Chrome 158, read after `gc()`: `performance.memory.usedJSHeapSize` rose by 64.0 MiB for one untouched 64 MiB `ArrayBuffer` (three runs) and by 64 MiB for a `Float64Array`, and fell (by 128 MiB for the two) only after a timer turn: in these runs it included buffer contents, which `heapUsed` does not (cause not examined) ✅[^lab-matrix].
**Exceptions:** a page has no `process.memoryUsage()` and no `arrayBuffers` counter: in Chrome, `usedJSHeapSize` is read after `gc()` and a timer turn, knowing that it held buffer contents in these runs.
**Check it:** the snippet above, before and after the change, on the platform you ship.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) §3.8 External memory: `ArrayBuffer`, `Buffer` and `process.memoryUsage()`; §6.2.

### `JE-M12` Compare memory and small-integer results only between builds with the same pointer compression
**Applies in detail:** Electron 43 and Chrome 158 have pointer compression on (measured); every official Node.js build run here has it off; a byte count, heap limit or small-integer boundary measured on one side is applied to the other.
**Prefer:**
```js
console.log(process.versions.v8, process.config.variables.v8_enable_pointer_compression); // 1 = on
```
**Avoid:** "this array takes 15.6 MB" or "2 ** 31 - 1 is a small integer" stated for every build.
**Why:** With pointer compression a heap reference takes 4 bytes instead of 8, a small integer has 31 bits instead of 32, so small integers end at 2³⁰ − 1 instead of 2³¹ − 1, and the heap fits in a 4 GB region ✅[^v8-ptrcomp] (the cap: `JE-N11` in [numbers-and-arrays.md](numbers-and-arrays.md)). Chrome has had it on since Chrome 80 ✅[^v8-dev-80], and Chrome 158 was measured with it on ✅[^lab-matrix].
**Evidence:** a 2,000,000-element array of small integers: 15,625 KB on Node.js 24.22.1 (arm64, and x64 emulated), 7,813 KB on Electron 43 (V8 15.0) and on Node.js 24.22.3 with pointer compression (V8 13.6, x64 emulated); the two emulated builds differ only in compression, so it is the cause. `--max-old-space-size=8192` gave `heap_size_limit` 8,384 MiB without compression and 4,096 MiB with it; `%IsSmi(2 ** 30)` is false with compression. Chrome 158, in a page: `%IsSmi(2 ** 30 - 1)` true and `%IsSmi(2 ** 30)` false; `performance.memory.jsHeapSizeLimit` 4,192 MiB by default and with `--max-old-space-size=8192`; bytes per element, read with `usedJSHeapSize` after `gc()`, equal the Node.js pointer-compression build in every row of the object deep dive's table (a small-integer array 4.0 bytes per element, 8.0 on official Node.js). Counts of bytes do not vary between runs ✅[^lab-matrix].
**Exceptions:** what was kept alive, and double arrays and strings, did not change with compression ✅[^lab-matrix].
**Check it:** the line above in Node.js or Electron; a second check that does not rely on the build record is `node --allow-natives-syntax -p "%IsSmi(2 ** 30)"` (true: compression off, false: on). In a Chrome page, `%IsSmi(2 ** 30)` with `--js-flags=--allow-natives-syntax`, or `performance.memory.jsHeapSizeLimit` (4,192 MiB in Chrome 158); browser memory is measured in the browser rather than taken from Node.js numbers.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) §3.7 Heap limits and how the flags add up; §6.4; [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §3.1 Tagged values: small integers and heap numbers; [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.2.

### `JE-M13` Time in the front tab, or keep a headless renderer out of the background, and check the tier before you trust a time
**Applies in detail:** Chrome 158 kept hot code in Maglev in every tab that was not in front, in the workers of such a tab, in a front tab with Energy Saver on, and in some default headless runs; the code is a benchmark, a tier check or a long computation run in headless Chrome (a test runner, Puppeteer or Playwright headless, `--headless`), or in a Chrome tab that is not in front (behind another tab, in a minimized window, under another window).
**Prefer:**
```sh
# visible Chrome: Energy Saver off; keep the benchmark's tab in front until it ends;
# after bringing a tab to the front, wait about 8 seconds (TurboFan code comes after about 8 s)
# headless Chrome:
chrome --headless=new --disable-renderer-backgrounding \
  --js-flags=--allow-natives-syntax --dump-dom file://bench.html
# or the V8 flag instead: --js-flags="--allow-natives-syntax --no-efficiency-mode"
```
**Avoid:** timing in default headless Chrome or in a background tab and reading the result as the speed of TurboFan code; comparing a figure from a background tab with one from the front tab.
**Why:** In V8's efficiency mode functions stay in Maglev and do not tier up to TurboFan. In default headless Chrome it was on in some runs and not in others (a race), and the page saw `document.visibilityState` `visible`; in a tab not in front it was `hidden` and the code stayed in Maglev in every run ✅[^lab-matrix]. From the sources (read on the Chromium `main` branch, not Chrome 158): Chromium sets a hidden renderer's V8 priority to best-effort while one feature flag is off, its state in Chrome 158 not examined ✅[^cr-render-thread]; V8 15.8 turns efficiency mode on for any priority other than user-blocking ✅[^v8-isolate-158] and then delays TurboFan ✅[^v8-tiering-158] ✅[^v8-flags-158]; and `--disable-renderer-backgrounding` stops renderers being told they are hidden ✅[^cr-switches]. That this path is what the runs measured is an inference: it fits both flags' effect, no run read the priority, and the delay the source describes (3 times the TurboFan invocation count) does not explain 5,460,000 calls. Energy Saver is a second input to the same code: Chrome passes the mode to each renderer and the renderer to all its V8 isolates ✅[^cr-bsm-manager] ✅[^cr-render-thread], and V8 15.8's `ShouldOptimize` returns "do not optimize" for TurboFan whenever battery saver mode is on, with no call-count delay ✅[^v8-tiering-158]. Why a hidden tab slows from its fourth task is a separate effect; the sources describe, on macOS, a lowest process priority (`kBestEffort`) that sets a low CPU priority and throttles timers ✅[^cr-process-mac], and `--disable-renderer-backgrounding` keeps the renderer "visible" ✅[^cr-rphi]; that this priority is the cause is an inference, because the priority a hidden renderer gets was not read.
**Evidence:** Chrome 158, headless, counts of runs: with default flags, 3 to 12 of 18 natural tier-up subjects stayed Maglev code after 40,000 calls over ten runs (12, 10 and 5 on 2026-11-27; 4, 6, 7, 3 and 8 on 2026-11-28), a tier-up script reached no TurboFan in 20,000 calls in two of three runs, then in 1 of 5, the loop-timing page left every function in Maglev code in one of three runs, then in 1 of 3 (the other two timing scripts were TurboFan code in 3 of 3), and a small probe reached TurboFan in 6 of 11 early runs (5 of 5 on 2026-11-28); with `--disable-renderer-backgrounding` or `--no-efficiency-mode`, all 18 subjects reached TurboFan in every run (three each), at the same calls, and the probe in 11 of 11 flagged runs. Visible window, 2026-11-28, macOS arm64: the probe reached TurboFan in the front tab in 10 of 10 runs and in 0 of 24 when its tab was not in front (behind another tab, in a minimized window, under another window): status `25` (Maglev code) at all twelve readings, and its 200,000 timed calls took 39.2 to 41.6 ms on a quiet machine and up to 58.5 ms under load, against 23.0 to 27.5 ms in the front tab; two front-tab runs under heavy load kept a TurboFan compile pending to the end (52.4 and 59.0 ms), so a busy machine delays that compile in the front tab too. With the macOS screen locked, a tab behind another tab and a minimized window still gave Maglev code (status `25`, 45.8 to 47.3 ms for the 200,000 calls, three runs each) while `document.visibilityState` stayed `visible`; the visible window's front tab gave TurboFan code in 3 of 3 runs (22.8 to 24.0 ms) ✅[^lab-matrix]. Starting it at once, 3 or 15 seconds after the tab was hidden changed nothing (9 of 9 Maglev); a hidden tab calling it on a timer for 19.9 s, 5,460,000 calls, stayed Maglev code to the end (3 of 3); in a hidden tab either flag gave TurboFan code (3 of 3 each); the loop-timing script's index loop took 24.6 to 25.9 ms per round in a hidden tab against 13.5 to 14.3. Other times, Maglev only against TurboFan: `forEach` warm-up rounds 60 to 65 ms against 36 to 42 ms, `reduce` the slowest loop form (4.02 times the index loop), a `Proxy` read 1.6 to 1.8 times a plain read against 10 to 22 times. Node.js 24.22.1 with `--efficiency-mode` behaved like the default headless page ✅[^lab-matrix]. Hidden tab shown again (5 of 5 runs, a probe called in batches of 100,000 for about 16 s, the tab hidden for about 6 s, then brought to the front): status `25` (Maglev code) at every reading while hidden, then `41` (TurboFan code) 7.8 to 7.9 s after the tab was shown (7.8, 7.8 and 8.1 s in three more runs), after 3,500,000 calls in all; the batch time dropped when the tab was shown, not when TurboFan came: medians 107 to 140 ms per batch while hidden, 26 to 35 ms visible in Maglev code, 31 to 39 ms visible in TurboFan code ✅[^lab-matrix]. Workers of a hidden page: a dedicated worker stayed in Maglev code in 5 of 5 runs, 156.6 to 212.8 ms for 200,000 timed calls, against TurboFan code in 5 of 5 in the front tab (25.3 to 30.0 ms); a shared worker (created from a `blob:` URL) stayed in Maglev code in 3 of 3 runs, 165.1 to 542.7 ms, against TurboFan code in 3 of 3 in the front tab (30.0 to 36.3 ms) ✅[^lab-matrix]. Energy Saver, front tab of a visible window, machine on mains power: with V8's `--battery-saver-mode` flag Maglev code in 3 of 3 runs (39.7 to 40.5 ms); with Chrome's Energy Saver switched on through the profile (the file `Local State` of an empty profile written before Chrome started, `performance_tuning.battery_saver_mode.state` = 3; no command-line switch turns it on) Maglev code in 3 of 3 (39.4 to 41.5 ms); with the value 0, TurboFan code in 2 of 2 (23.5 and 27.2 ms) ✅[^lab-matrix] ✅[^cr-bsm-manager] ✅[^cr-tuning-prefs] ✅[^cr-tuning-prefs-cc]. A hidden tab also runs slower for a reason that is not the tier: with `--no-efficiency-mode` (TurboFan code at every reading, three runs), batches 1 to 3 took 25.1 to 27.6 ms, and from the script's fourth task on each batch took 30.5 to 243.9 ms, medians 122 to 131 ms, 4.7 to 4.9 times the first three (three more runs of a reviewer: 5.0 to 5.4 times), starting at batch 4 in 3 of 3 runs, also when the script started 15 s after the tab was hidden; with `--disable-renderer-backgrounding` the fourth task was not slow, but a milder slowdown of about 2 times came later (from the seventh batch in 3 of 3 runs of a reviewer, medians 46.5 to 50.6 ms against 23.8 to 28.1), not examined further ✅[^lab-matrix]. Not run: a front tab that is then hidden (a tab hidden after its code reached TurboFan), Chrome on other operating systems, phones, Energy Saver on battery power or set through Chrome's settings page.
**Exceptions:** the front tab of a visible window behaved like the flagged headless runs for every script run there ✅[^lab-matrix].
**Check it:** after the timed loop, read `%GetOptimizationStatus(fn)` of the timed function (page started with `--js-flags=--allow-natives-syntax`): bit 32 set (41) is TurboFan code on V8 15.8, bit 16 without bit 32 (25, or 537 in the probe) is Maglev code (`JE-M7`); measure in the front tab with Energy Saver off (it is a Chrome setting, off by default on mains power) and, after bringing a tab to the front, wait about 8 seconds before timing; read `document.visibilityState` beside it (`hidden` means a background tab, but `visible` does not prove the tab is in front: with a locked screen a covered tab reported `visible` and ran Maglev code).
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §6.2 Pitfalls when measuring; §4.2; §6.4 Other builds and versions; [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md), Lookup notes "Other builds and versions".

## Takeaways
- A time is evidence only after warm-up past the point where rounds stop falling (20,000+ calls with production values), and with the production array size and call count. [rule-candidate]
- Counts (deopts, scavenges, IC changes, bytes) repeat exactly; timings do not: count first, then time three or more runs and report the range.
- Tier bits, trace flags, natives and tier defaults differ between V8 versions and embedders: a probe with a known answer comes before any reading on a new build.
- Memory is read after a forced collection, with buffers in `external` and `arrayBuffers` after a timer turn, and compared only between builds with the same pointer compression.
- In Chrome, a tab that is not in front kept code in Maglev in every run: benchmarks run in the front tab, or headless with `--disable-renderer-backgrounding`.

## Verification status
- Verified: 105 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab: the baseline runs on Node.js 24.22.1 (V8 13.6.233.17-node.58), linux arm64, pointer compression off, image `node:24.22.1-alpine` in Docker on an Apple M2 with `--network none`, 2026-11-26; scripts and outputs in [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §2 to §4 and §6.2, [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) §3.8 and §6.2, and [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §1.2. Rank 1 (primary measurement). Backs: every claim with the `lab` footnote. [^lab]
- Lab matrix: the same scripts re-run on 2026-11-27 on Node.js 24.22.1 on macOS 26.1 arm64 and on linux x64 emulated, Node.js 22.23.4 (V8 12.4.254.21), Node.js 25.7.0 (V8 14.1.146.11), Electron 43.7.7 as Node (V8 15.0.245.31, pointer compression and V8 sandbox on), the Node.js project's unofficial pointer-compression build of Node.js 24.22.3 (V8 13.6, linux x64 emulated), and for narrowing runs Deno 2.9.8 (V8 15.0.245.2) and Electron 38.8.6 (V8 14.0.365.10); Google Chrome 158.0.8127.89 (V8 15.8.62.31) headless on macOS arm64 the same day; on 2026-11-28 the same Chrome in a visible window (the front tab, a hidden tab, a minimized window and a covered window, a hidden tab shown again, a dedicated and a shared worker, V8's battery saver flag and Chrome's Energy Saver preference); differing outputs in [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §6.2 and §6.4, [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) §6.4 and [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §6.3. Rank 1 (primary measurement). Backs: every claim with the `lab-matrix` footnote. [^lab-matrix]
- Lab cross-engine: the warm-up script run three times on 2026-11-28 on one Apple M2 with macOS 26.1, on SpiderMonkey (Firefox 161.0, headless), JavaScriptCore (the `jsc` shell of the macOS 26.1 framework 21622.2.11.11.9, Bun 1.4.5, a page of the Playwright WebKit build 2311) and V8 (Node.js 24.22.1 on macOS arm64; Chrome 158 in a visible window); script and output in [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4.20. Rank 1 (primary measurement). Backs: every claim with the `lab-cross` footnote. [^lab-cross]
- [src/execution/tiering-manager.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/execution/tiering-manager.cc) — V8 project, 2025. Rank 1. Backs: Scope (budgets, OSR); `JE-M1`, `JE-M2`, `JE-M4`. [^tiering]
- [src/compiler/js-inlining-heuristic.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/compiler/js-inlining-heuristic.cc) — V8 project, 2025. Rank 1. Backs: `JE-M4` (inlining needs the callee's feedback vector). [^inl-heur]
- [src/compiler/escape-analysis.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/compiler/escape-analysis.h) — V8 project, 2025. Rank 1. Backs: `JE-M3`. [^escape-h]
- [src/runtime/runtime.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/runtime/runtime.h) — V8 project, 2025. Rank 1. Backs: Scope (natives); `JE-M7` (the status bits). [^runtime-h]
- [src/runtime/runtime-test.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/runtime/runtime-test.cc) — V8 project, 2025. Rank 1. Backs: `JE-M7` (when each bit is set). [^runtime-test]
- [src/deoptimizer/deoptimize-reason.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/deoptimizer/deoptimize-reason.h) — V8 project, 2025. Rank 1. Backs: `JE-M6` (reason strings). [^deopt-reason]
- [src/extensions/gc-extension.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/extensions/gc-extension.cc) — V8 project, 2025. Rank 1. Backs: `JE-M10` (what `gc()` does). [^gcext]
- [src/execution/isolate.h at 15.8.62.31](https://github.com/v8/v8/blob/15.8.62.31/src/execution/isolate.h) — V8 project, 2026. Rank 1. Backs: `JE-M13` (`EfficiencyModeEnabled()`). [^v8-isolate-158]
- [src/execution/tiering-manager.cc at 15.8.62.31](https://github.com/v8/v8/blob/15.8.62.31/src/execution/tiering-manager.cc) — V8 project, 2026. Rank 1. Backs: Scope; `JE-M13` (the TurboFan delay and synchronous compiles in efficiency mode, no TurboFan in battery saver mode). [^v8-tiering-158]
- [src/flags/flag-definitions.h at 15.8.62.31](https://github.com/v8/v8/blob/15.8.62.31/src/flags/flag-definitions.h) — V8 project, 2026. Rank 1. Backs: `JE-M13` (efficiency-mode flag defaults). [^v8-flags-158]
- [content/renderer/render_thread_impl.cc on main](https://chromium.googlesource.com/chromium/src/+/main/content/renderer/render_thread_impl.cc) — Chromium project, read 2026-11-28 (the `main` branch, not Chrome 158). Rank 1. Backs: `JE-M13` (isolate priority when the renderer is hidden or visible, battery saver passed to every isolate). [^cr-render-thread]
- [content/public/common/content_switches.cc on main](https://chromium.googlesource.com/chromium/src/+/main/content/public/common/content_switches.cc) — Chromium project, read 2026-11-28 (the `main` branch, not Chrome 158). Rank 1. Backs: `JE-M13` (`--disable-renderer-backgrounding`). [^cr-switches]
- [chrome/browser/performance_manager/user_tuning/battery_saver_mode_manager.cc on main](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/performance_manager/user_tuning/battery_saver_mode_manager.cc) — Chromium project, read 2026-11-28 (the `main` branch, not Chrome 158). Rank 1. Backs: `JE-M13` (Energy Saver states, `--force-device-has-battery`, `SetBatterySaverMode` for renderers). [^cr-bsm-manager]
- [components/performance_manager/public/user_tuning/prefs.h on main](https://chromium.googlesource.com/chromium/src/+/main/components/performance_manager/public/user_tuning/prefs.h) — Chromium project, read 2026-11-28 (the `main` branch, not Chrome 158). Rank 1. Backs: `JE-M13` (the preference key and `BatterySaverModeState` values). [^cr-tuning-prefs]
- [components/performance_manager/user_tuning/prefs.cc on main](https://chromium.googlesource.com/chromium/src/+/main/components/performance_manager/user_tuning/prefs.cc) — Chromium project, read 2026-11-28 (the `main` branch, not Chrome 158). Rank 1. Backs: `JE-M13` (a Local State preference, default `kEnabledBelowThreshold`). [^cr-tuning-prefs-cc]
- [base/process/process_mac.cc on main](https://chromium.googlesource.com/chromium/src/+/main/base/process/process_mac.cc) — Chromium project, read 2026-11-28 (the `main` branch, not Chrome 158). Rank 1. Backs: `JE-M13` (what each process priority means on macOS). [^cr-process-mac]
- [content/browser/renderer_host/render_process_host_impl.cc on main](https://chromium.googlesource.com/chromium/src/+/main/content/browser/renderer_host/render_process_host_impl.cc) — Chromium project, read 2026-11-28 (the `main` branch, not Chrome 158). Rank 1. Backs: `JE-M13` (`--disable-renderer-backgrounding` keeps the process visible). [^cr-rphi]
- [Command-line API: V8 options](https://nodejs.org/docs/latest-v24.x/api/cli.html) — Node.js, v24.x. Rank 1. Backs: `JE-M6` (flag stability). [^node-cli]
- [Process, `process.memoryUsage()`](https://nodejs.org/docs/latest-v24.x/api/process.html) — Node.js, v24.22.3 docs. Rank 1. Backs: `JE-M11` (`external`, `arrayBuffers` when embedded). [^nodeproc]
- [Maglev - V8’s Fastest Optimizing JIT](https://v8.dev/blog/maglev) — V8 team, 2023. Rank 4. Backs: Scope (tiers). [^maglev]
- [A lighter V8](https://v8.dev/blog/v8-lite) — V8 team, 2019. Rank 4. Backs: Scope (feedback vectors). [^v8-lite]
- [Pointer compression in V8](https://v8.dev/blog/pointer-compression) — V8 team (Igor Sheludko, Santiago Aboy Solanes), 2020-03-30. Rank 4. Backs: Scope; `JE-M12` (4-byte references, 31-bit small integers, 4 GB region). [^v8-ptrcomp]
- [v8-dev list: 31-bit Smis and pointer compression](https://groups.google.com/g/v8-dev/c/AI0RcAj-Z4g/m/Juj4UbcdAwAJ) — Santiago Aboy Solanes (V8 team), 2020-02-20. Rank 4. Backs: `JE-M12` (on by default since Chrome 80). [^v8-dev-80]

## Related
- [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) — tiers, status bits, trace flags and the efficiency-mode runs in full.
- [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) — heap spaces, external memory and how to measure memory in Node.js 24.
- [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) — bytes per element and pointer compression.
- [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) — the warm-up curve on SpiderMonkey and JavaScriptCore.
- [benchmarking-methodology.md](../../performance/measurement/benchmarking-methodology.md) — benchmarking method in any language: keep results live, repeat, report a spread.
- [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md) — the code-review catalog whose Chrome runs met efficiency mode.
- [functions-and-optimization.md](functions-and-optimization.md) — the code forms these measurements judge (`JE-F`).
- [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md) — what each `process.memoryUsage()` field counts (`JN-H3`).
