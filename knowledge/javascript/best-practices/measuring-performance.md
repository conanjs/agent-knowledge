---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24.22.1 (V8 13.6.233.17), linux arm64, pointer compression off: lab of 2026-11-26", "V8 source at tag 13.6.233.17; V8 15.8.62.31 and Chromium main read 2026-11-28 for JE-M13", "V8 12.4 to 15.0 (Node.js 22.23.4 and 25.7.0, Electron 38.8.6 and 43.7.7, Deno 2.9.8, Node.js 24.22.3 with pointer compression): re-run of 2026-11-27", "Google Chrome 158.0.8127.89 (V8 15.8.62.31), headless page 2026-11-27; visible window, hidden, minimized and covered tabs 2026-11-28", "SpiderMonkey (Firefox 161.0) and JavaScriptCore (jsc shell of macOS 26.1, Bun 1.4.5, Playwright WebKit build 2311), JE-M1 only: 2026-11-28", "re-run of every lab script on 2026-11-28 after a restart of the lab machine (screen unlocked, one browser window at a time, one timing run at a time)", "third run of the timing scripts on 2026-11-28, evening, quiet machine (each run started below a one-minute load average of 3.0)", "JE-M13 only: single sets of runs of 2026-11-28, evening and night (Chrome 158 on macOS: a front tab hidden later, a window without the focus, spaced timer tasks; headless Chromium 155 on linux arm64 in a container)"]
last-verified: 2026-11-28
last-updated: 2026-11-29
tags: [javascript, best-practices, benchmarking, v8, tiers, deoptimization, memory-measurement, headless-chrome]
derived-from: [js-runtime/v8-compiler-pipeline-deep-dive.md, js-runtime/v8-memory-and-startup-deep-dive.md, js-runtime/v8-object-and-value-representation-deep-dive.md, js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: measuring performance and reading what V8 did

## Summary
**TL;DR:** Thirteen practices for measuring JavaScript speed and memory and for checking what V8 did, each backed by a pitfall the labs hit: warm up past the point where times settle, time with production sizes, keep every result live, count deopts and collections before timing, read tier bits on the build itself, read `heapUsed` only after a forced collection, and never time in a background tab. The two pitfalls that cost most: on Node.js 24.22.1 a `forEach` loop took 51 to 76 ms per round in its first 10,000 calls and 19 to 21 ms after 12,000 ✅[^lab], and in Chrome 158 a probe in a tab that was not in front stayed Maglev code in 15 of 15 runs of the first run, in 24 of 24 of the re-run and in 9 of 9 of the third run, on a quiet machine ✅[^lab-matrix].
**Use this when:** you write or judge a micro-benchmark, a tier check, a memory or leak test, or a claim that a change is faster or smaller; you move a number between Node.js, Electron and Chrome; you benchmark in headless Chrome, Puppeteer or Playwright.
**Not this doc:** which code forms are fast → [functions-and-optimization.md](functions-and-optimization.md) (`JE-F`), [objects-and-shapes.md](objects-and-shapes.md) (`JE-O`), [numbers-and-arrays.md](numbers-and-arrays.md) (`JE-N`), [strings-and-collections.md](strings-and-collections.md) (`JE-S`); what each `process.memoryUsage()` field counts → [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md) (`JN-H3`); start-up timing → [nodejs-startup.md](nodejs-startup.md) (`JN-U`); benchmarking method in any language → [benchmarking-methodology.md](../../performance/measurement/benchmarking-methodology.md); the mechanisms → [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) and [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md).

## Scope
The catalog covers how to time JavaScript, how to measure its memory, and how to read V8's own tools (trace flags, test-only natives, status bits) on a given build. Evidence:
- The baseline lab ran Node.js 24.22.1 (V8 13.6.233.17, linux arm64 in a container on one Apple M2, pointer compression off) on 2026-11-26 ✅[^lab].
- The scripts ran again on 2026-11-27 on V8 12.4 to 15.0 (Node.js 22 and 25, Electron 38 and 43, Deno 2.9, a Node.js 24.22.3 build with pointer compression) and in Google Chrome 158 (V8 15.8, headless, the script inlined in a `file://` page, V8 flags passed with `--js-flags`, timed with the Chrome flag `--disable-renderer-backgrounding` unless "default headless" is said), and on 2026-11-28 in a visible Chrome window ✅[^lab-matrix].
- The **Other engines** line of `JE-M1` comes from a cross-engine lab of 2026-11-28 on SpiderMonkey (Firefox 161) and JavaScriptCore (a shell, Bun, a WebKit page; Safari itself was not run) ✅[^lab-cross].
- Not run on other engines: `JE-M2`, `JE-M3`, `JE-M5`, `JE-M10`, `JE-M11`; `JE-M4`, `JE-M6` to `JE-M9`, `JE-M12` and `JE-M13` are about V8's own tools and builds and are V8-specific by nature.
- Every official Node.js build run reports pointer compression off; Electron 43 and Chrome 158 were measured with it on ✅[^lab-matrix].

**What counts as measured.** A claim that a change is faster or smaller stands only when it was measured as these practices describe; a claim that was not measured is stated as not measured. The evidence is from V8 (Node.js, Chrome) unless a note has an **Other engines** line, which says what the same check did on SpiderMonkey and JavaScriptCore (here only `JE-M1`).

**How the timings were taken.** The machine: one Apple M2 laptop, macOS 26.1; the Linux builds ran in containers in a virtual machine on it, and the x64 builds were emulated. Every lab was run twice, and its timing scripts a third time:
- **First run (2026-11-26 to 2026-11-28):** the baseline labs on 2026-11-26 (Node.js 24.22.1 in a container), the other builds and headless Chrome 158 on 2026-11-27, and the Chrome windows, hidden tabs and the cross-engine check in the night to 2026-11-28, before the lab machine was restarted.
  - For the runs that open a browser window, the runner did not yet check for a locked screen or keep one browser window at a time, so the conditions of that run are not fully known.
  - Load: one-minute load average 2.1 to 13.8 at the start of the runs of the cross-engine lab ✅[^lab-cross]; that range covers the whole cross-engine lab, and its highest values came in other checks than the warm-up script ✅[^lab-cross]; load not recorded for the other labs, except the memory lab's Chrome runs of its forced-`gc()` page, 8 to 12 from other jobs (the memory lab notes only that the rest ran on a shared machine) ✅[^lab-matrix].
- **Re-run (2026-11-28, after the restart):** every script was extracted from the lab docs and run again, screen unlocked, one browser window at a time, one timing run at a time; other, untimed jobs ran on the machine, and the load was high for part of the time ✅[^lab-matrix].
  - Load records:
    - the baseline loop timings of the compiler lab have no load log of their own; logs of other runs on the machine read a one-minute load average of 27.09 to 29.32 in the minute of the first three runs and 3.74 to 4.68 in the minutes of the two after ✅[^lab-matrix];
    - the compiler lab's headless Chrome timing batch (the probe, the loop-timing and the warm-up pages), one-minute load average 9.81 at its start and 28.13 at its end ✅[^lab-matrix];
    - the Chrome probe in a tab not in front: nine runs at 2.90 to 3.51, and for the first five runs of each mode the only figures are the logs of the headless batch and of the runs after it (9.81 to 28.13, then 27.09 to 19.87), the fifth run of each mode having come after those logs (load not recorded) ✅[^lab-matrix];
    - the memory lab's timing runs, a load average of 20 or more from other jobs, as observed while the re-run went on, not recorded per run (20 to 37 for its Chrome forced-`gc()` page) ✅[^lab-matrix];
    - the cross-engine warm-up script, from the run logs, in `JE-M1`.
  - Load not recorded for the other headless Chrome runs, for the visible-window loop and warm-up runs, and for the author's runs of the cases that were first run that day (a hidden tab shown again, workers, Energy Saver, the hidden-tab slowdown); an independent review of those cases logged 2.13 to 6.82 at the end of each of its runs ✅[^lab-matrix].
- **Third run (2026-11-28, evening, quiet machine):** the timing scripts only, with the re-run's commands, three runs on each environment, one run at a time, each started only when the one-minute load average was below 3.0; no other lab job ran, while the owner's desktop applications (a browser among them) stayed open ✅[^lab-matrix].
  - Load at the start of the runs: compiler lab 1.49 to 2.98 (median 1.99), memory lab 1.64 to 2.98 (median 2.44), object lab 1.77 to 2.99, engine catalog 1.56 to 2.98 ✅[^lab-matrix]; cross-engine lab 1.54 to 2.99 (median 2.62), its warm-up script 2.04 to 2.88 ✅[^lab-cross].
  - Not in it: counts, bytes, liveness, heap limits, and the Chrome cases measured only after the restart (a tab shown again, workers, Energy Saver, the 20-second hidden-tab script) ✅[^lab-matrix].
  - It is the only run made under a controlled load: where the runs differ, its values are the ones to quote for a quiet machine; the earlier values stay as the record of what load and uncontrolled conditions do.

What the three runs taught:
- Counts, bytes and liveness came out the same (168 of 169 cells of the compiler lab outside Chrome, all 168 cells of the memory lab's Node.js builds) ✅[^lab-matrix].
- Timings moved with the load in the re-run: the baseline loop timings gave other ratios in the minute when logs of other runs read 27.09 to 29.32 and the quoted ratios when they read 3.74 to 4.68 (`JE-M2`), the hidden-tab probe took 39.2 to 41.6 ms at 2.90 to 3.51 and up to 58.5 ms in the first five runs of each mode, beside the headless batch (9.81 to 28.13) and the runs after it (27.09 to 19.87), and in that part two front-tab runs kept a TurboFan compile pending to the end ✅[^lab-matrix].
- The tier did not move: a tab not in front ran Maglev code in every run of the three runs (0 of 15 reached TurboFan, then 0 of 24, then 0 of 9), the front tab TurboFan code (5 of 5, then 10 of 10, then 3 of 3) ✅[^lab-matrix].
- **Earlier outliers that went with the load** (each came in runs started at the high loads given, and did not come back in the third run, started at loads under 3; no run tested load alone, so this records what was seen together, not a proven cause):
  - the re-run's first three baseline loop runs (27.09 to 29.32 in the logs then): the third run gave the first run's ratios, `forEach` 6.70 to 6.83 and 1.85 to 1.89 times the index loop (`JE-M2`) ✅[^lab-matrix];
  - the re-run's long collection pauses: a V8-started major GC of 49.23 ms at a load of 20 or more, 14.10 to 25.54 ms in the third run (loads 2.76, 2.15 and 2.07); and the re-run's higher `gc()` pauses in Chrome and on macOS Node.js 24.22.1, which the third run did not reach ✅[^lab-matrix];
  - the macOS host's `lazy-timing.mjs` pass whose medians were 1.8 to 8.7 times too high: the third run's were 0.94 to 1.01 times those of the re-run's lone pass (`JE-M5`) ✅[^lab-matrix];
  - the front-tab probe runs that kept a TurboFan compile pending to the end: 2 of 18 front-tab runs, both in the re-run under load, 0 of 3 in the third run (`JE-M13`) ✅[^lab-matrix].
- **Effects that came back on a quiet machine (loads under 3), so load does not explain them:**
  - default headless Chrome leaving code in Maglev: `loops-bench.mjs` 1 of 3, `loops-var.mjs` 2 of 3 and `warmup.mjs` 1 of 3 third-run runs (loads 1.67 to 2.55 at the starts of the nine default runs), so 2 of 9, 4 of 9 and 2 of 9 over the three runs; the share was not smaller than in the loaded re-run ✅[^lab-matrix];
  - the slow string-building shape of `concat-var.mjs` in 1 of 3 default-headless runs (loads 2.01 to 2.69 at their starts; 1 of 5, then 5 of 6 before; never with `--disable-renderer-backgrounding`) ✅[^lab-matrix];
  - Bun's slow iterator helpers in 1 of 3 third-run runs (×47.58 at a load of 2.93; two of fourteen Bun runs), and SpiderMonkey's about 4 times faster helper-object form (`JE-F11`) in 2 of 3 (×0.22, loads 2.7 to 2.8; six of twelve runs) ✅[^lab-cross].
- **Values a quiet machine gave that neither earlier run gave:** the probe in a tab behind another tab took 46.7 to 47.9 ms (40.4 to 47.9 ms over the three modes not in front), so the re-run's 39.2 to 41.6 ms "at about 3" was not what a quiet machine gives; `withEval` against a plain function in flagged headless Chrome 5.7, 8.2 and 6.3 times, against 20 to 31 and 8 to 35 before; the ratio is not stable, since the plain function took 1.3 to 1.8 ms, a few steps of the 0.1 ms timer ✅[^lab-matrix].
- Some effects turned out to be races, seen in another share of runs each time: V8's efficiency mode in default headless Chrome (12, 10 and 5 of 18 functions left in Maglev code, then 4, 6, 7, 3 and 8) and a `not a Smi` deopt on an emulated pointer-compression build ([problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md): "5 of 5" runs, then "7 of 12") ✅[^lab-matrix]; and Chrome's `usedJSHeapSize` stayed up until a timer turn in 3 of 3 runs, then in 10 of 13 (`JE-M11`) ✅[^lab-matrix].
- **What follows for your own measurements:** write down the load at the start of each run; repeat the run (three or more); quote the order and the ratio, with the measured times beside them; a run under load can move a ratio and even an order (`reduce` 0.70 to 1.16 times the index loop in the re-run's loaded runs, `JE-M2`) ✅[^lab-matrix]; and a quiet machine does not remove a race (the effects above).

So the conclusions here are the order of the alternatives and the ratio between them, which held in all three runs unless a note says otherwise; each absolute time is quoted as the machine printed it under that run's load, and will differ on another machine or under another load.

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
| `JE-M1` | A benchmark that times the first few thousand calls, or warms up with other values than it measures | Warm up 20,000+ calls with production-like values, then time | always | Node.js 24.22.1: rounds settled after 12,000 calls ✅[^lab]; 18,000 on V8 14.1 to 15.8 ✅[^lab-matrix]; JavaScriptCore 9,000 (a WebKit page 5,000 to 10,000, three runs) ✅[^lab-cross] |
| `JE-M2` | A benchmark of a few calls over a huge array used to decide code that runs many times on small ones | Time with the production array size and call count | always | `forEach` / index loop 6.67 to 7.1 times with 1,000,000 items × 20 calls (OSR code), 1.84 to 1.94 with 1,000 items × 20,000 calls (Node.js 24.22.1; three runs, loaded runs aside) ✅[^lab] |
| `JE-M3` | A timing loop that discards the result, or an allocation benchmark whose objects never leave the loop | Sum every result into a checksum and print it; 0 scavenges or flat time means the work was removed | always | 10 million temporary `{ x, y }`: 0 scavenges; stored in an outside array: more than 20 (Node.js 24.22.1) ✅[^lab] |
| `JE-M4` | `%OptimizeFunctionOnNextCall` after 1 or 2 calls used to prove something is or is not optimized or inlined | Warm up 20 to 50 calls first; prefer natural tier-up, with inlining flags off to read a small callee's own tier | always | After 2 calls: `no feedback vector`, not inlined; after 20: inlined (Node.js 24.22.1) ✅[^lab] |
| `JE-M5` | A performance claim backed by one timing, or timings compared across machines, runs or builds | Count deopts, scavenges, IC changes first (`--trace-deopt`, `--trace-gc`); time 3+ runs and report the range | always | With `--single-threaded`, TurboFan came at call 1,957 in every run; medians of one row moved up to about 30 % between passes (Node.js 24.22.1) ✅[^lab] |
| `JE-M6` | A hot function suspected of being "not optimized" or "deopting", with no trace | Run `--trace-opt --trace-deopt` (and `--trace-deopt-verbose` for the line) and fix the reason it names | always | Seven cases, seven distinct reasons printed (Node.js 24.22.1) ✅[^lab] |
| `JE-M7` | `%GetOptimizationStatus(f) & 64` (or `& 32`) hard-coded as the TurboFan or Maglev test | Force TurboFan on a probe and print the raw value first | check build | TurboFan code read 81 (bit 64) on Node.js 22 and 24 ✅[^lab], 41 (bit 32) on V8 14.0 (Electron 38), Node.js 25 and Chrome 158 ✅[^lab-matrix] |
| `JE-M8` | Tier or timing results from Node.js 22, Chrome, or an x64 container emulated on an arm64 Mac | Check `node --v8-options` for `--no-maglev` / `--no-turbofan` (in Chrome: the `JE-M7` probe, and `JE-M13`); never time under emulation | check build | Node.js 22.23.4 has Maglev off; emulated x64 Node.js 24 has TurboFan off ✅[^lab-matrix] |
| `JE-M9` | A check that relies on a V8 trace flag or native printing something, on Electron, Node.js 22 or 25, or in a Chrome page | Confirm the flag exists and the native answers a known case | check build | Node.js 24.22.1 has no `--trace-ic` ✅[^lab]; a Chrome page reads no trace or `%DebugPrint` and ignores `--always-turbofan` ✅[^lab-matrix] |
| `JE-M10` | `heapUsed` read without `gc()`, or a leak test written at module top level | Run with `--expose-gc`, call `gc()` before each reading (`usedJSHeapSize` in a page), create the measured objects inside a function | always | After dropping a 15 MiB array: 19.1 MiB without `gc()`, 3.8 MiB after; a top-level `WeakMap` test kept its value (Node.js 24.22.1) ✅[^lab] |
| `JE-M11` | A memory claim for `Buffer` or `ArrayBuffer` code backed by `heapUsed`, or read right after `gc()` | Read `external`, `arrayBuffers`, `rss` after a timer turn and a second `gc()` | check build | 64 MiB `ArrayBuffer`: `external` +64 MiB, `heapUsed` 0 (Node.js 24.22.1) ✅[^lab]; `arrayBuffers` 0 in Electron and Deno; Chrome's `usedJSHeapSize` held buffers ✅[^lab-matrix] |
| `JE-M12` | Byte counts, heap limits or small-integer limits from Node.js applied to Electron or a browser | Compare only builds with the same pointer compression | check build | Small-integer array of 2,000,000: 15,625 KB without compression, 7,813 KB with; heap cap 4,096 MiB with it ✅[^lab-matrix] |
| `JE-M13` | A benchmark or long computation in headless Chrome, in a Chrome tab not in front (or its workers), or with Energy Saver on | Time in the front tab, Energy Saver off, 8 s after showing it; headless: `--disable-renderer-backgrounding`; check TurboFan (41) | check build | Chrome 158: probe TurboFan in every front-tab run (5 of 5, 10 of 10, 3 of 3), in none of 48 in tabs not in front; 38.4 to 58.5 ms against 23.0 to 27.5 ms (three runs) ✅[^lab-matrix] |

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
**Evidence:** Over the three runs: the rounds settled from the tenth round whenever TurboFan came; the two default-headless runs that never settled (one in the first run, one in the quiet third run) are the efficiency-mode race of `JE-M13`, which load does not explain ✅[^lab-matrix].
- **Node.js 24.22.1.** First run: 2,000 calls per round over 10,000 items, three runs: the first five rounds (10,000 calls) took 51 to 76 ms for `forEach` and 95 to 111 ms for `reduce`; from the seventh round (after 12,000 calls) mostly 19 to 21 ms and 8 to 10 ms ✅[^lab]. Re-run (2026-11-28, after the restart): the three Node.js 24.22.1 runs took 51 to 64 ms for `forEach` and 95 to 105 ms for `reduce` in the first five rounds, and the numbers settled after 12,000 to 16,000 calls over both runs ✅[^lab-matrix].
- **Node.js 24.22.1, third run (2026-11-28, evening, quiet machine; loads 1.81, 1.89 and 1.60).** 51 to 65 ms for `forEach` and 95 to 111 ms for `reduce` in the first five rounds, and from the seventh round (after 12,000 calls) 19 to 20 ms and 8 to 9 ms in all three runs; over the three runs the numbers settled after 12,000 to 16,000 calls, after 12,000 in every run on the quiet machine ✅[^lab-matrix].
- **Other V8 builds.** First run, for this one body and size: settled from the third round (after 4,000 calls) on V8 12.4 (Node.js 22.23.4), and from the tenth round (after 18,000 calls) on V8 14.1 (Node.js 25.7.0) and 15.0 (Electron 43), where `forEach` then took 30 to 39 ms per round ✅[^lab-matrix]. Third run (loads 1.53 to 1.90): the same rounds in all nine runs, `forEach` from then on 19 to 20 ms on V8 12.4, 29 to 31 ms on V8 14.1 and 36 to 37 ms on V8 15.0 ✅[^lab-matrix].
- **Chrome 158, first run (2026-11-27, load not recorded).** With TurboFan available (`--disable-renderer-backgrounding` or `--no-efficiency-mode`, three runs each, and two of three default-headless runs): settled from the tenth round too, `forEach` 36 to 42 ms and `reduce` 13 to 16 ms per round; in the third default-headless run neither settled (60 to 65 ms and 97 to 106 ms in every round), see `JE-M13` ✅[^lab-matrix].
- **Chrome, re-run.** In the headless batch, one-minute load average 9.81 at its start and 28.13 at its end, all nine headless runs settled from the tenth round, the three with the default flags included (`forEach` 38 ms in most rounds from then on, single rounds up to 55 ms; `reduce` 14 to 17 ms), and a visible window (load not recorded) settled from the tenth round in three runs and three re-runs (`forEach` 36 to 41 ms, one round at 48; `reduce` 14 to 16 ms); the Node.js builds' warm-up timings kept their order ✅[^lab-matrix].
- **Chrome, third run (2026-11-28, evening, quiet machine).** Headless, loads 1.69 to 2.26: settled from the tenth round in the three runs with `--disable-renderer-backgrounding`, the three with `--no-efficiency-mode` and two of three default runs (`forEach` 35 to 38 ms, `reduce` 13 to 15 ms from then on); in the first default run neither settled (`forEach` 73 ms, then 60 to 62 ms; `reduce` 97 to 103 ms in every round). Over the three runs: flagged runs 18 of 18 settled, default runs 7 of 9. A visible window (loads 2.41, 2.68, 2.45) settled from the tenth round in 3 of 3 (`forEach` 35 to 38 ms, `reduce` 13 to 16 ms), nine of nine visible-window runs over the three runs ✅[^lab-matrix].
- Another function reaches each tier at other call counts; the lab used up to 30,000 warm-up calls.
**Other engines:** Holds, weaker in Chrome and Firefox. Over the three runs: the same engines stepped down at about the same call counts, and the same two did not ✅[^lab-cross].
- **JavaScriptCore and V8 in Node.js.** In 15 rounds of 1,000 calls over 10,000 items, `forEach` stepped down on JavaScriptCore (22 to 23 ms to 7.7 to 9 ms per round): after 9,000 calls in the shell and Bun in both runs; in the WebKit page after 9,000 calls in the first run (2026-11-28, before the restart) and after 5,000 to 10,000, run to run, in the re-run (2026-11-28, after the restart). `reduce` stepped down after 5,000 in the shell, as V8 did in Node.js 24.22.1 on macOS (`forEach` after 11,000 calls, 26 to 10 ms, both runs) ✅[^lab-cross].
- **Chrome and SpiderMonkey.** In Chrome 158 (a visible window) neither `forEach` nor `reduce` stepped down within 15,000 calls in either run, and on SpiderMonkey (Firefox 161) neither did: `forEach` took 38 to 52 ms in every round in the first run, 33 to 52 ms over both runs ✅[^lab-cross].
- **Third run (2026-11-28, evening, quiet machine), three runs each.** `forEach` stepped down after 9,000 calls in the shell (22 to 7.8 ms per round) and in the WebKit page (22 to 8 to 9 ms) in all three runs, after 9,000 to 10,000 in Bun (23 to 9 to 10 ms) and after 11,000 on V8 in Node.js (26 to 10.4 ms); in Chrome and Firefox neither form stepped down (Firefox `forEach` 38 to 65 ms per round). The late "steady" rounds of the index loop in some runs came from a single slow round, not from a step ✅[^lab-cross].
- **Load:** one-minute load average 2.1 to 13.8 at the start of the runs of the whole cross-engine lab in the first run (the highest in other checks than the warm-up; the warm-up's own figure was not kept), 2.95 to 9.55 at the start of the re-run's warm-up runs, 2.04 to 2.88 at the start of the third run's ✅[^lab-cross].
- Warming up longer never hurt; 2,000 calls would have timed the slow phase on V8 in Node.js and on JavaScriptCore ✅[^lab-cross].
**Exceptions:** when the question is start-up or first-call cost, fresh processes are timed instead ([nodejs-startup.md](nodejs-startup.md)).
**Check it:** print the time of every round (`performance.now()` in a page), and start the timed part only after the numbers stop falling.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §4.2 Four loop forms, timed in two workloads; §6.2 Pitfalls when measuring; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4.20.

### `JE-M2` Benchmark with the production array size and call count, not one big call
**Prefer:**
```js
// production: handler called per request over ~1,000 rows
for (let r = 0; r < 20_000; r++) check += sumRows(rows1k);
```
**Applies in detail:** also the reverse: a benchmark of many calls over small arrays used to decide code that makes a few calls over a huge array.
**Avoid:**
```js
for (let r = 0; r < 20; r++) check += sumRows(rows1e6);   // measures OSR code
```
**Why:** A function called a few times never reaches its call-count budget; its loop runs in OSR code instead ✅[^tiering], while `forEach` and `reduce` loop inside the built-in. The ranking of loop forms changes with the tier that ran ✅[^lab].
**Evidence:** Over the three runs: `forEach` and `reduce` about 6 to 8 times the index loop in the few-calls workload; `for…of` there depends on whether it was TurboFan code at entry, and is not stable. The quiet third run agrees with the first run (loads 2.06 to 2.75); the re-run's other ratios came in the minute when logs of other runs read 27.09 to 29.32, so they went with that load, which no run tested alone ✅[^lab-matrix].
- **Node.js 24.22.1.**
  - First run (2026-11-26, load not recorded), four runs: with 1,000,000 items × 20 calls, `forEach` took 6.7 to 7.1 times as long as an index loop (medians 101.1 to 103.8 ms against 14.5 to 15.4 ms per round; `--trace-osr` printed 201 `OSR - entry` lines for the `for` loop, none for `forEach`); with 1,000 items × 20,000 calls (all TurboFan), 1.84 to 1.94 times (19.3 to 21.5 ms against 10.4 to 11.1 ms); at 100,000 items × 200 calls, `for` reached TurboFan while `forEach` and `reduce` stayed in Maglev, 3 to 45 times slower ✅[^lab].
  - Re-run (2026-11-28, after the restart): the first three baseline runs, made in the minute when logs of other runs on the machine read a load average of 27.09 to 29.32 (the baseline loop run keeps no log of its own), gave other ratios (`forEach` 7.4 to 8.5 times in the few-calls workload and 2.0 to 2.7 in the many-calls one, with the index loop at 28.2 to 29.3 ms and 18.3 to 21.1 ms, about twice as long); two more, made while those logs read 3.74 to 4.68, gave the first run's ratios again (index loop 14.5 to 14.7 ms and 10.2 to 10.4 ms, `forEach` 98.1 to 99.2 ms and 19.3 to 19.4 ms: 6.7 to 6.8 and 1.87 to 1.89 times) ✅[^lab-matrix].
  - Third run (2026-11-28, evening, quiet machine; loads 2.75, 2.06 and 2.16): index loop 14.4 to 14.6 ms and 10.3 to 10.5 ms, `forEach` 97.8 to 98.4 ms and 19.4 to 19.5 ms: 6.70, 6.83 and 6.73 times in the few-calls workload and 1.85, 1.89 and 1.87 in the many-calls one; `reduce` 0.81 to 0.83 in the many-calls one; the same tiers ✅[^lab-matrix].
  - Over the three runs, on a quiet machine: the same order of the forms, with the ratios inside or next to the first run's ranges (`reduce` in the few-calls workload down to 6.53); the re-run's first three ratios went with the load (27.09 to 29.32 then; they did not come back at 2.06 to 2.75); under that load, not even the order of `reduce` and the index loop held (`reduce` 0.70 to 1.16 times the index loop in the many-calls workload) ✅[^lab-matrix].
- **Other builds.** On V8 15.0 (Electron 43, Deno 2.9.8) the index loop and `for…of` were TurboFan code at entry after the same 200 calls ✅[^lab-matrix].
- **Chrome 158, 1,000,000 items × 20 calls, three runs:** the index loop was TurboFan code at entry in every run; in the first run (2026-11-27) `for…of` took 0.88, 3.43 and 8.47 times as long (TurboFan code at entry in the first two), and in the re-run (2026-11-28, after the restart) 9.10 to 9.33 times; `forEach` 6.46 to 7.17 times in the first run and 6.46 to 7.21 over both runs, `reduce` 6.12 to 6.73 and 6.12 to 6.76 ✅[^lab-matrix].
- **Chrome 158, third run** (headless with `--disable-renderer-backgrounding`, loads 2.42, 1.76, 1.61): `for…of` 0.93 and 0.96 (TurboFan code at entry) and 9.34 (Sparkplug code); `forEach` 6.79, 7.50 and 7.22; `reduce` 6.35, 6.96 and 6.89 times the index loop; over the three runs `forEach` 6.46 to 7.50 and `reduce` 6.12 to 6.96 ✅[^lab-matrix].
- **Chrome, in a visible window,** first run, `for…of` 8.66 to 9.65, `forEach` 6.72 to 7.76 and `reduce` 6.35 to 7.05 times, and in the re-run's front tab `forEach` 7.18 to 7.47, `reduce` 6.71 to 7.07 and `for…of` 0.93 in one run (TurboFan code) and 9.26 and 9.52 in the two others; against 0.96 to 2.70 in the many-calls workload (`JE-F12` in [functions-and-optimization.md](functions-and-optimization.md)) ✅[^lab-matrix]. Third run's front tab (loads 1.88 to 2.15): `forEach` 6.70 to 7.30, `reduce` 6.25 to 6.94, `for…of` 0.90, 7.87 and 9.33, against 0.95 to 2.66 in the many-calls workload; the `for…of` figure was not stable in any of the three runs ✅[^lab-matrix].
- **Load:** load not recorded for the first run's Chrome runs and the re-run's visible-window runs; the re-run's headless runs were in the batch at a load average of 9.81 at its start and 28.13 at its end; the third run's runs started at 1.61 to 2.75 ✅[^lab-matrix].
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
**Evidence:** The tier and count outputs were the same in the re-run (2026-11-28, after the restart), while the loop timings moved with the load (`JE-M2`) ✅[^lab-matrix]. In the quiet third run the macOS pass did not come back (its medians were 0.94 to 1.01 times the lone pass's, at loads of 1.64 to 2.98), so the 1.8 to 8.7 times went with the heavy load of that first pass; and even quiet runs of one row differ ✅[^lab-matrix].
- **Call numbers.** Node.js 24.22.1: with `--single-threaded`, `sum` reached Sparkplug at call 28, Maglev at call 70 and TurboFan at call 1,957 in every run; with the default flags the call numbers changed from run to run ✅[^lab].
- **Shared machine.** On a shared machine, medians of the same row differed by up to about 30 % between the first pass and later ones (memory lab, first run 2026-11-26); in the re-run, under a load average of 20 or more from other jobs (load not recorded per run), three runs of each timing script on the baseline differed by up to about 18 % in one row and by at most 11 % in every other, and on macOS a first pass under heavy load gave medians 1.8 to 8.7 times those of a pass run alone later, with the same order ✅[^lab-matrix].
- **Third run (2026-11-28, evening, quiet machine; loads 1.64 to 2.98, memory lab).** The three runs on the baseline differed by up to about 13 % (the 1 % called, `--no-lazy` row of `lazy-timing.mjs`), 8 % in the `node -e 0` row and at most 6 % in every other row of the four startup scripts; on macOS, Node.js 24.22.1's `lazy-timing.mjs` medians were 0.94 to 1.01 times those of the re-run's lone pass and within 0.9 ms of Node.js 22.23.4's, run by run, so the loaded pass's 1.8 to 8.7 times went with its heavy load and did not come back at these loads; a V8-started major GC took 14.10, 25.54 and 14.25 ms, a factor of 1.8 between quiet runs (49.23 ms in the re-run, at a load of 20 or more) ✅[^lab-matrix].
- **Object lab.** The object lab's timings come from one machine: only the order of magnitude between cases carries over ✅[^lab].
**Exceptions:** a claimed speed-up is timed too, with several runs, after the counts show the engine did what was expected.
**Check it:** run the timing at least three times and report the range, as every lab here does.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §2.2 The four tiers, and when each takes over; §6.2; [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) §6.2 Pitfalls when measuring; §3.3; [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §1.2 How the lab ran.

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
**Applies in detail:** the bit layout moved between V8 13.6 and V8 14.0 (Electron 38; Node.js 25 with V8 14.1, where it was first seen, and Chrome 158 have it too; builds in between were not run) ✅[^lab-matrix]; a test with `%GetOptimizationStatus(f) & 64` (or `& 32`, `& 16`) decides "TurboFan" or "Maglev".
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
const turbo = !!(%GetOptimizationStatus(f) & 64);  // reads "Interpreted" on V8 14.0 and later (run on 14.0, 14.1, 15.0, 15.8)
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
**Evidence:**
- **Node.js 24.22.1 (V8 13.6):** no `--trace-ic` and no `--trace-maps`; `--trace-normalization` printed nothing for a `delete`, and `--trace-elements-transitions` nothing for the script's own `push(4.5)` ✅[^lab].
- **Other V8 builds:** `--always-turbofan` is a bad option on V8 14.1 and 15.0, `--polymorphic-inlining` does not exist there, and `--optimize-maglev-optimizes-to-turbofan` does not exist on V8 12.4; `%StringIsFlat` is not defined on V8 12.4 (`SyntaxError`) ✅[^lab-matrix].
- **Electron 43 (`v8_enable_object_print: 0`):** `%DebugPrint` prints one short line, so checks that read its fields (feedback vector, elements kind) cannot run there; not because of pointer compression, since Node.js 24.22.3 with it printed every field ✅[^lab-matrix].
- **Chrome 158, headless page:** the natives answer with `--js-flags=--allow-natives-syntax`, but V8's trace flags, `--v8-options` and `%DebugPrint` print nothing the page can read, and `--always-turbofan` is silently ignored (no "bad option" message; it set no status bit) ✅[^lab-matrix].
**Exceptions:** none found in the lab.
**Check it:** the `grep` above for each flag; for a native, run it once on a value whose answer is known (`%IsSmi(1)`, `%HasFastProperties({})`), in a page too; a trace flag cannot be checked from a page.
**Full lab:** [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §1.2 How the lab ran; §6.3 Other builds and versions; [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §6.4.

### `JE-M10` Read `heapUsed` after a forced full GC, with the measured objects allocated inside a function
**Seen in code as:** `process.memoryUsage().heapUsed` read right after dropping a reference (`big = null`, `key = null`), with no `gc()` between.
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
**Seen in code as:** a memory claim about `Buffer`, `ArrayBuffer` or typed-array code backed only by `heapUsed`.
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
**Evidence:** Over both runs the buffers were always gone after the timer turn, and how much of the drop shows at the first full GC is not fixed ✅[^lab-matrix].
- **Node.js 24.22.1 (Linux arm64):**
  - `new ArrayBuffer(64 MiB)` moved `external` and `arrayBuffers` by +64 MiB and `heapUsed` by 0; after dropping two 64 MiB buffers the counters fell in two steps, the split differing between runs (three runs, first run, 2026-11-26) ✅[^lab].
  - In the re-run (2026-11-28, after the restart, one run per build) the baseline gave the first pattern again (`rss` and `arrayBuffers` −128 MiB at the full GC in the same job, `external` −128 MiB after the timer turn), while emulated x64 moved nothing at the first step and everything after the timer turn ✅[^lab-matrix].
- **On macOS** (Node.js 22.23.4, 24.22.1, 25.7.0) `rss` did not fall; `arrayBuffers` stayed 0 in every row in Electron 43, Electron 38.8.6 and Deno 2.9.8, and never in a Node.js build run; Node.js 24.22.3 with pointer compression reported it like the baseline ✅[^lab-matrix].
- **The Node.js docs** allow `arrayBuffers` to be 0 when Node.js is embedded as a library ✅[^nodeproc].
- **Chrome 158, read after `gc()`:**
  - `performance.memory.usedJSHeapSize` rose by 64.0 MiB for one untouched 64 MiB `ArrayBuffer` (3 of 3 runs in the first run, 2026-11-27; 13 of 13 in the re-run, 2026-11-28, after the restart) and by 64 MiB for a `Float64Array` ✅[^lab-matrix].
  - After the buffers were dropped and `gc()` ran in the same task, it stayed up and fell (by 128 MiB for the two) only after a timer turn and another `gc()` in 3 of 3 runs of the first run and in 10 of 13 of the re-run; in the other 3 re-run runs it fell already at that first `gc()`, as the baseline's counters do in some runs ✅[^lab-matrix];
  - load not recorded for the first run, a load average of 20 or more from other jobs observed during the re-run, not recorded per run ✅[^lab-matrix].
  - Over both runs: it included buffer contents, which `heapUsed` does not (cause not examined), a reading in the same task as `gc()` sometimes still counted dropped buffers and sometimes not, and a reading after a timer turn and a second `gc()` was back down in every run ✅[^lab-matrix].
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
# visible Chrome: keep the benchmark's tab in front until it ends
# and turn Energy Saver off; after bringing a tab to the front, wait about 8 seconds (TurboFan code comes after about 8 s)
# headless Chrome:
chrome --headless=new --disable-renderer-backgrounding \
  --js-flags=--allow-natives-syntax --dump-dom file://bench.html
# or the V8 flag instead: --js-flags="--allow-natives-syntax --no-efficiency-mode"
```
**Avoid:** timing in default headless Chrome or in a background tab and reading the result as the speed of TurboFan code; comparing a figure from a background tab with one from the front tab.
**Why:** In V8's efficiency mode functions stay in Maglev and do not tier up to TurboFan.
- **In default headless Chrome** it was on in some runs and not in others (a race), and the page saw `document.visibilityState` `visible`; in a tab not in front it was `hidden` and the code stayed in Maglev in every run ✅[^lab-matrix].
- **From the sources (read on the Chromium `main` branch, not Chrome 158):**
  - Chromium sets a hidden renderer's V8 priority to best-effort while one feature flag is off, its state in Chrome 158 not examined ✅[^cr-render-thread];
  - V8 15.8 turns efficiency mode on for any priority other than user-blocking ✅[^v8-isolate-158] and then delays TurboFan ✅[^v8-tiering-158] ✅[^v8-flags-158];
  - and `--disable-renderer-backgrounding` stops renderers being told they are hidden ✅[^cr-switches].
- **That this path is what the runs measured is an inference:** it fits both flags' effect, no run read the priority, and the delay the source describes (3 times the TurboFan invocation count) does not explain 5,460,000 calls.
- **Energy Saver is a second input to the same code:** Chrome passes the mode to each renderer and the renderer to all its V8 isolates ✅[^cr-bsm-manager] ✅[^cr-render-thread], and V8 15.8's `ShouldOptimize` returns "do not optimize" for TurboFan whenever battery saver mode is on, with no call-count delay ✅[^v8-tiering-158].
- **Why a hidden tab slows from its fourth task is a separate effect;** the sources describe, on macOS, a lowest process priority (`kBestEffort`) that sets a low CPU priority and throttles timers ✅[^cr-process-mac], and `--disable-renderer-backgrounding` keeps the renderer "visible" ✅[^cr-rphi]; that this priority is the cause is an inference, because the priority a hidden renderer gets was not read.
**Evidence:** Over the three runs: the tier did not move with the load (Maglev code in 48 of 48 runs not in front, TurboFan code at the end in 18 of 18 front-tab runs), a tab not in front took about 1.4 to 2.1 times as long as the front tab in the probe (first run 38.4 to 48.3 against 23.5 to 25.7 ms; re-run on the quiet machine 39.2 to 41.6 against 23.0 to 27.5 ms; third run 40.4 to 47.9 against 23.4 to 24.5 ms), 1.7 to 2.0 times in the index loop on a machine that was not loaded, and up to 2.5 times in the re-run's loaded runs (58.5 against 23.0 ms), the two front-tab runs under load aside; the absolute times moved with the load ✅[^lab-matrix].
- **Chrome 158, headless, counts of runs** (load not recorded, except the re-run's timing batch: the probe, loop-timing and warm-up pages at a load average of 9.81 at its start and 28.13 at its end, and the third run, whose loads are in its item):
  - with default flags, 3 to 12 of 18 natural tier-up subjects stayed Maglev code after 40,000 calls over ten runs (first run, 2026-11-27: 12, 10 and 5; re-run, 2026-11-28, after the restart: 4, 6, 7, 3 and 8) ✅[^lab-matrix];
  - a tier-up script reached no TurboFan in 20,000 calls in two of three runs, then in 1 of 5 ✅[^lab-matrix];
  - the loop-timing page (`loops-bench.mjs`) left every function in Maglev code in one of three runs, then in 0 of 3, while its variant `loops-var.mjs` did in 1 of 3 in the first run and in 1 of 3 in the re-run (`loops-bench.mjs` and `warmup.mjs` TurboFan code in 3 of 3 each in the re-run) ✅[^lab-matrix];
  - and a small probe reached TurboFan in 6 of 11 early runs (5 of 5 on 2026-11-28 before the restart, and five more default and three flagged runs in the re-run, 22.8 to 23.5 ms) ✅[^lab-matrix].
  - Third run (2026-11-28, evening, quiet machine; the timing scripts only, so not `natural.mjs` or `tierup.mjs`; loads 1.67 to 2.55 at the starts of the nine default runs): `loops-bench.mjs` ended every function of the many-calls workload in Maglev code in 1 of 3 runs, `loops-var.mjs` every function of its three smaller workloads in 2 of 3, and `warmup.mjs` never settled in 1 of 3, so 2 of 9, 4 of 9 and 2 of 9 over the three runs; with either flag TurboFan code in all eighteen runs; the probe reached TurboFan in 3 of 3 default runs (22.8 to 23.2 ms) and 3 of 3 flagged (23.3 to 27.3 ms) ✅[^lab-matrix].
  - Over the three runs: efficiency mode in default headless Chrome is a race, never a fixed outcome; it came less often in the loaded re-run, and not less often on the quiet machine, so a quiet machine does not prevent it ✅[^lab-matrix]; with `--disable-renderer-backgrounding` or `--no-efficiency-mode`, all 18 subjects reached TurboFan in every run (three each), at the same calls, and the probe in 11 of 11 earlier flagged runs, then in 3 of 3 (re-run) and 3 of 3 (third run).
- **Visible window, macOS arm64, the probe when its tab was not in front** (behind another tab, in a minimized window, under another window):
  - in the first run (2026-11-28, before the restart; load not recorded) it reached TurboFan in the front tab in 5 of 5 runs and in 0 of 15 when its tab was not in front, status `25` (Maglev code) at all twelve readings, and its 200,000 timed calls took 38.4 to 48.3 ms against 23.5 to 25.7 ms in the front tab ✅[^lab-matrix];
  - in the re-run (2026-11-28, after the restart) it reached TurboFan in the front tab in 10 of 10 runs and in 0 of 24 when its tab was not in front, status `25` at all twelve readings, and the 200,000 timed calls took 39.2 to 41.6 ms in the nine runs made with the machine quiet (load average 2.90 to 3.51) and 40.8 to 58.5 ms in the first five runs of each mode (the first four ran beside the headless batch, whose log read 9.81 at its start and 28.13 at its end, and the runs after it, 27.09 to 19.87; the fifth came after those logs, load not recorded), against 23.0 to 27.5 ms in the front tab ✅[^lab-matrix];
  - two front-tab runs of that part (the fourth, beside the headless batch, and the fifth, after its logs) kept a TurboFan compile pending to the end (status `537` at all twelve readings, `41` only at the end; 52.4 and 59.0 ms), so a busy machine delays that compile in the front tab too ✅[^lab-matrix];
  - in the third run (2026-11-28, evening, quiet machine; three runs per mode; loads 1.94 to 2.71 at the starts of the front-tab runs and 1.94 to 2.76 of the others) it reached TurboFan in the front tab in 3 of 3 runs (`537` at the first one or two readings, `41` from then on, 23.4 to 24.5 ms) and in 0 of 9 when its tab was not in front, `25` at all twelve readings, `hidden`: 46.7 to 47.9 ms behind another tab, 47.3 to 47.5 ms in a minimized window, 40.4 to 46.9 ms in a covered window ✅[^lab-matrix];
  - so over the three runs: TurboFan code in 18 of 18 front-tab runs, in 0 of 48 not in front; a compile pending to the end only in the re-run's two front-tab runs under load (0 of 5 in the first run, 0 of 3 on the quiet machine); and the re-run's 39.2 to 41.6 ms was not a property of a quiet machine, which gave 40.4 to 47.9 ms, the first run's spread (38.4 to 48.3) ✅[^lab-matrix].
- **First run only** (the re-run did not repeat it, because it needs a locked screen): with the macOS screen locked, a tab behind another tab and a minimized window still gave Maglev code (status `25`, 45.8 to 47.3 ms for the 200,000 calls, three runs each) while `document.visibilityState` stayed `visible`; the visible window's front tab gave TurboFan code in 3 of 3 runs (22.8 to 24.0 ms) ✅[^lab-matrix].
- **Starting it at once, 3 or 15 seconds after the tab was hidden** changed nothing (first run: 9 of 9 Maglev; re-run: three runs each at 0 and 15 s and eight at 3 s, Maglev code in all; third run: three runs each, Maglev code in all nine) ✅[^lab-matrix].
- **A hidden tab calling it on a timer for 19.9 s,** 5,460,000 calls, stayed Maglev code to the end (3 of 3) ✅[^lab-matrix].
- **In a hidden tab** either flag gave TurboFan code (3 of 3 each, in each run; third run 22.4 to 31.0 ms) ✅[^lab-matrix].
- **The loop-timing script's index loop** took 25.2 to 25.9 ms per round in a hidden tab against 13.8 to 13.9 ms in the front tab in the first run (three runs each; a review of it, under load: 24.7 to 26.0 against 13.6 to 14.1), and 24.6 to 24.7 against 13.5 to 14.3 in the re-run (three runs each): about 1.7 to 1.9 times in both ✅[^lab-matrix]; in the third run (three runs each; loads 2.29 to 2.71 hidden, 1.88 to 2.15 in front) 24.5 to 26.0 against 13.1 to 13.2 ms, 1.9 to 2.0 times, so 1.7 to 2.0 times over the three runs ✅[^lab-matrix].
- **Other times, Maglev only against TurboFan:** `forEach` warm-up rounds 60 to 65 ms against 36 to 42 ms, `reduce` the slowest loop form (4.02 times the index loop, in the one first-run default-headless run that ended in Maglev code; none of the three default runs of the re-run did), a `Proxy` read 1.6 to 1.8 times a plain read against 10 to 22 times in the other 12 default runs of the first run (re-run, default flags: 1.9 in the one run that stayed Maglev code, 11.0 and 10.9 in the two that reached TurboFan; third run, default flags: 1.8, all three runs Maglev code, loads 1.84 to 2.75) ✅[^lab-matrix].
- **Node.js 24.22.1 with `--efficiency-mode`** behaved like the default headless page ✅[^lab-matrix].
- **The `forEach` and `reduce` figures** there come from default-headless runs of the first run (in the re-run every default-headless run of `warmup.mjs` and `loops-bench.mjs` reached TurboFan; in the third run one of three of each did not: `forEach` 60 to 62 ms per round, `reduce` 3.98 times the index loop); in hidden tabs `reduce` took 3.99 to 4.15 times the index loop over both runs and 3.95 to 3.97 in the third ✅[^lab-matrix].
- **The next four cases** were run only on 2026-11-28, after the restart, under the re-run's conditions (not part of the third run); load not recorded for the author's runs, logged at the end of each run of an independent review where it is given below ✅[^lab-matrix].
  - **Hidden tab shown again** (5 of 5 runs, a probe called in batches of 100,000 for about 16 s, the tab hidden for about 6 s, then brought to the front):
    - status `25` (Maglev code) at every reading while hidden, then `41` (TurboFan code) 7.8 to 7.9 s after the tab was shown (7.9, 7.8 and 8.1 s in three more runs of an independent reviewer, one-minute load average 3.31 to 4.42 logged at the end of each), after 3,500,000 calls in all ✅[^lab-matrix];
    - the batch time dropped when the tab was shown, not when TurboFan came: medians 107 to 140 ms per batch while hidden, 26 to 35 ms visible in Maglev code, 31 to 39 ms visible in TurboFan code (the reviewer's three runs: 102 to 140, 28 to 36 and 27 to 39 ms; a median here is the higher of the two middle values for an even count) ✅[^lab-matrix].
  - **Workers of a hidden page:**
    - a dedicated worker stayed in Maglev code in 5 of 5 runs, 156.6 to 212.8 ms for 200,000 timed calls, against TurboFan code in 5 of 5 in the front tab (25.3 to 30.0 ms) ✅[^lab-matrix];
    - a shared worker (created from a `blob:` URL) stayed in Maglev code in 3 of 3 runs, 165.1 to 542.7 ms, against TurboFan code in 3 of 3 in the front tab (30.0 to 36.3 ms) ✅[^lab-matrix];
    - the two largest figures (542.7 and 36.3 ms) came in the loaded part of the re-run, the front-tab one beside the runs whose log read 27.09 to 19.87, the hidden-tab one about a minute after the last line of that log (load not recorded) ✅[^lab-matrix];
    - the reviewer's three runs each gave 146.1 to 195.3 ms hidden and 24.0 to 31.9 ms in front (one-minute load average 4.94 to 5.51 at the end of each) ✅[^lab-matrix].
  - **Energy Saver, front tab of a visible window, machine on mains power:**
    - with V8's `--battery-saver-mode` flag Maglev code in 3 of 3 runs (39.7 to 40.5 ms) ✅[^lab-matrix];
    - with Chrome's Energy Saver switched on through the profile (the file `Local State` of an empty profile written before Chrome started, `performance_tuning.battery_saver_mode.state` = 3; no command-line switch turns it on) Maglev code in 3 of 3 (39.4 to 41.5 ms) ✅[^lab-matrix];
    - with the value 0, TurboFan code in 2 of 2 (23.5 and 27.2 ms) ✅[^lab-matrix] ✅[^cr-bsm-manager] ✅[^cr-tuning-prefs] ✅[^cr-tuning-prefs-cc].
  - **A hidden tab also runs slower for a reason that is not the tier:**
    - with `--no-efficiency-mode` (TurboFan code at every reading, three runs), batches 1 to 3 took 25.1 to 27.6 ms, and from the script's fourth task on each batch took 30.5 to 243.9 ms, medians 122.3, 130.5 and 130.2 ms, 4.83, 4.98 and 4.88 times the median of the first three (per run, the median of batches 4 to 26 divided by the median of batches 1 to 3 of the same run), starting at batch 4 in 3 of 3 runs, also when the script started 15 s after the tab was hidden ✅[^lab-matrix];
      - three more runs of a reviewer, one-minute load average 2.90 to 4.55 logged at the end of each: medians 129.0, 130.0 and 136.4 ms, 5.00, 5.35 and 5.15 times ✅[^lab-matrix];
      - with the default flags, Maglev code, three runs of the re-run, load not recorded: medians 181.6, 222.2 and 241.9 ms against 43.0 to 44.8, 4.22, 4.96 and 5.60 times ✅[^lab-matrix];
    - with `--disable-renderer-backgrounding` the fourth task was not slow, but a milder slowdown of about 2 times came later (from the seventh batch in 3 of 3 runs of a reviewer, medians 46.5 to 50.6 ms against 23.5 to 28.1 ms in batches 1 to 6); its cause, the 1-second spacing of the hidden tab's timer tasks, is in the item "Spaced timer tasks" below ✅[^lab-matrix].
- **Four later cases, single sets of runs** (run of 2026-11-28, evening, and for the Linux case also run of 2026-11-28, night; not part of the three-run comparison; the three macOS cases are one set of runs each, not yet re-run by a second agent, who found the macOS screen locked on 2026-11-28, night, and ran nothing; the Linux case was re-run by a second agent) ✅[^lab-matrix]:
  - **A front tab that is then hidden** (Chrome 158, macOS 26.1 arm64, AC power, 5 valid runs, loads 2.58 to 3.06; a second tab opened in front 5 s after the script started): `f1`, warmed up in front, read `41` (TurboFan code) at every batch after hiding in 5 of 5, but its batches took 52.7 to 63.0 ms (medians) hidden against 17.1 to 27.7 ms visible, 2.0 to 3.4 times, from the first batch that saw the tab hidden; `f2`, first called after hiding, read `25` (Maglev code) at every reading in 5 of 5, medians 104.5 to 115.2 ms ✅[^lab-matrix].
  - **A visible window without the focus** (a small second window beside it had the focus; loads 4.00 to 6.74, five valid runs per mode): TurboFan code at the end in 5 of 5 (29.5 to 34.0 ms), as with the focus (5 of 5, 22.5 to 35.5 ms); the probe was inserted after a wait, so these times compare only with each other ✅[^lab-matrix].
  - **Spaced timer tasks** (three runs per case, the 20-second probe variant, loads 1.63 to 2.60): a hidden tab with `--disable-renderer-backgrounding` ran batches 1 to 6 back to back, then about 1 s apart, medians 43.5 to 45.5 ms, 1.75 to 1.90 times; adding `--disable-background-timer-throttling` kept them back to back, medians 20.3 to 20.4 ms, no slowdown; a visible front tab with a 1,000 ms wait before every batch from the seventh slowed 1.80 to 2.01 times (medians 46.2 to 50.5 against 24.9 to 25.7 ms), and without the wait not at all (medians 20.3 ms). So the spacing is the cause; why spaced tasks run slower (a lower clock or an efficiency core after an idle second) is an inference, no core or clock was read ✅[^lab-matrix].
  - **Headless Chromium 155.0.8059.39 (V8 15.5) on linux arm64 in a container** (`--no-sandbox`, the probe only): run of 2026-11-28, evening (loads 2.23 to 2.65), Maglev code at all readings in 1 of 5 default runs (41.8 ms), TurboFan code in 4 of 5 (23.8 to 25.4 ms), 5 of 5 with `--disable-renderer-backgrounding`, 3 of 3 with `--no-efficiency-mode`; run of 2026-11-28, night (loads 2.22 to 2.44), Maglev code in 2 of 5 default runs (40.5 and 40.7 ms), TurboFan code in 3 of 3 with `--disable-renderer-backgrounding`; `visible` in every run; headless only, the probe only: no visible window, hidden tab, minimized or covered window and not `natural.mjs` was run on Linux ✅[^lab-matrix].
- **What follows for a benchmark in a browser** (Chrome 158 on macOS arm64 and, for the last item, headless Chromium 155 on linux arm64; each item rests on the one set of runs above, 3 to 5 runs per case):
  - keep the benchmark's tab in front for the whole run: in 5 runs a tab hidden mid-run kept its TurboFan code but ran it 2.0 to 3.4 times slower from its first hidden batch, and code first called after hiding stayed Maglev code (the front-tab-then-hidden case);
  - a window that only loses the focus got TurboFan code in 5 of 5 runs, as the focused window did (the unfocused-window case; one machine, loads 4.00 to 6.74), so losing the focus alone did not change the tier in these runs;
  - a benchmark that waits about a second between batches measures something else than one that runs them back to back: in 3 runs the wait alone slowed a visible front tab 1.80 to 2.01 times (spaced timer tasks);
  - on Linux, headless Chromium 155 left the probe in Maglev code in 1 of 5 and 2 of 5 default runs and in none of 8 runs with `--disable-renderer-backgrounding` (3 more with `--no-efficiency-mode`, none Maglev), so use the flag there too and check the tier; nothing is known of a Linux desktop with real tabs (the Linux case).
- Not run: battery power (so no Energy Saver on battery power); a Linux desktop with real tabs; Windows; phones ✅[^lab-matrix]; nor Energy Saver set through Chrome's settings page. A front tab that is then hidden, first listed here as not run, was run on the evening of 2026-11-28 (above).
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
- Verified: 201 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab: the baseline runs on Node.js 24.22.1 (V8 13.6.233.17-node.58), linux arm64, pointer compression off, image `node:24.22.1-alpine` in Docker on an Apple M2 with `--network none`, 2026-11-26 (the first run); scripts and outputs in [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §2 to §4 and §6.2, [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) §3.8 and §6.2, and [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §1.2. Rank 1 (primary measurement). Backs: every claim with the `lab` footnote. [^lab]
- Lab matrix: the same scripts re-run on 2026-11-27 on Node.js 24.22.1 on macOS 26.1 arm64 and on linux x64 emulated, Node.js 22.23.4 (V8 12.4.254.21), Node.js 25.7.0 (V8 14.1.146.11), Electron 43.7.7 as Node (V8 15.0.245.31, pointer compression and V8 sandbox on), the Node.js project's unofficial pointer-compression build of Node.js 24.22.3 (V8 13.6, linux x64 emulated), and for narrowing runs Deno 2.9.8 (V8 15.0.245.2) and Electron 38.8.6 (V8 14.0.365.10); Google Chrome 158.0.8127.89 (V8 15.8.62.31) headless on macOS arm64 the same day;
  on 2026-11-28 the same Chrome in a visible window (the front tab, a hidden tab, a minimized window and a covered window, a hidden tab shown again, a dedicated and a shared worker, V8's battery saver flag and Chrome's Energy Saver preference);
  on 2026-11-28, after a restart of the lab machine, every script of these labs run again, the baseline build included (the re-run: screen unlocked, one browser window at a time, one timing run at a time; its results, its load records and what changed in each lab doc's Verification status);
  on 2026-11-28, evening, the timing scripts a third time on a quiet machine (the third run: one run at a time, each started below a one-minute load average of 3.0), and single sets of runs of the cases a front tab hidden later, a window without the focus, spaced timer tasks, and headless Chromium 155 on linux arm64 in a container (also a second set that night);
  differing outputs in [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §6.2 and §6.4, [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) §6.4, [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §6.3, and the code-review catalog [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md) (Lookup notes "Other builds and versions"). Rank 1 (primary measurement). Backs: every claim with the `lab-matrix` footnote. [^lab-matrix]
- Lab cross-engine: the warm-up script run on 2026-11-28, three times per environment in the first run (before a restart of the lab machine), three to five times in the re-run after it (with `uptime` logged before every run) and three times in the third run (2026-11-28, evening, quiet machine), whose §4.17 and §4.21 results Scope also quotes, on one Apple M2 with macOS 26.1, on SpiderMonkey (Firefox 161.0, headless), JavaScriptCore (the `jsc` shell of the macOS 26.1 framework 21622.2.11.11.9, Bun 1.4.5, a page of the Playwright WebKit build 2311) and V8 (Node.js 24.22.1 on macOS arm64; Chrome 158 in a visible window); script and output in [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4.20. Rank 1 (primary measurement). Backs: every claim with the `lab-cross` footnote. [^lab-cross]
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
