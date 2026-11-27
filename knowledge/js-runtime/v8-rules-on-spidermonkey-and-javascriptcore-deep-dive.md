---
schema: deep-dive/v1
topic: js-runtime
status: verified
applies-to: ["V8 13.6.233.17-node.58 (Node.js 24.22.1, macOS arm64)", "V8 15.8.62.31 (Google Chrome 158.0.8127.89, macOS arm64, visible window)", "SpiderMonkey (Firefox 161.0, macOS arm64, headless)", "JavaScriptCore 21622.2.11.11.9 (the jsc shell of macOS 26.1)", "JavaScriptCore of Bun 1.4.5 (WebKit commit d6375c72, linux arm64 container)", "JavaScriptCore of the Playwright WebKit build 2311 (macOS arm64, visible window)", "lab runs of 2026-11-28 on one Apple M2"]
last-updated: 2026-11-28
last-verified: 2026-11-28
synthesized-into: []
tags: [v8, spidermonkey, javascriptcore, firefox, safari, webkit, bun, chrome, nodejs, performance, cross-engine, benchmarks, memory, garbage-collection]
ranked-sources: true
---

# V8's performance rules on SpiderMonkey and JavaScriptCore: 33 checks on six environments

## Summary
**TL;DR:** 33 checks of V8-derived performance rules ran on V8 (Node.js 24 and Chrome 158), SpiderMonkey (Firefox 161) and JavaScriptCore (the macOS 26.1 shell, Bun 1.4.5 and a WebKit page) on one Apple M2 ✅[^lab]. In 20 checks the rule holds on all three engines; in 9 it holds with a weaker or no effect on one or two engines or environments; 2 are engine-specific numbers (bytes per element, the largest spread call); 2 could not be measured on SpiderMonkey (the closure liveness check, the string slice bytes); no rule mattered on V8 alone. Some results differ from the V8-only picture ✅[^lab]. A direct `eval` that never runs made a function about 25 times slower on V8 in Node.js, 18 times in Chrome, 94 to 99 times on SpiderMonkey and 18 to 28 times on JavaScriptCore when it is called as the V8 catalog calls it; only V8 lost that cost, when it inlined the function into its caller. An accessor in an object literal read 9 to 34 times slower than a field on V8 and at most 1.44 times slower on the other two engines. On JavaScriptCore, `delete` did not slow reads, a plain slice of 3 characters kept a 16 MiB parent string alive (13 characters on V8), and a `Map` entry took 68 to 126 bytes in the table's run (the figure varies with the number of entries, §4.10) against 36.8 on V8 in Node.js. `for…of` was 3.8 to 4.0 times slower than an index loop in Firefox and 2.4 times in the JavaScriptCore shell.

**Use this when:**
- a skill or review comment cites a V8-measured rule, and the code runs in Firefox, in a browser built on WebKit or in another JavaScriptCore host (Bun);
- you want to know which of those rules to follow everywhere, which matter only in Chrome and Node.js, and which cost on another engine;
- you want to repeat a timing, a byte count or a liveness check on several engines with one plain script.

**Not this doc:** why V8 behaves as it does (shapes, elements kinds, tiers, deoptimization, the garbage collector): the three V8 deep dives own those mechanisms (Related). This doc does not explain SpiderMonkey or JavaScriptCore internals either; it reports what they did.

**Depth:** the six environments and what each can observe; an engine-neutral method for timing, bytes and liveness; one master table of 33 checks with a verdict per rule; one part per check with its numbers, the output of every environment and the full script; the changes to the advice; the pitfalls met while measuring.

## 1. Mental model

**One idea carries the whole doc.** A performance rule found by measuring V8 says two things at once: what the code does (which the language specification fixes) and what one engine does with it (which it does not). The first part travels to every engine. The second part has to be measured again on each engine, and this doc does that for 33 checks of the rules, on V8, SpiderMonkey and JavaScriptCore.

**Analogy.** A rule from V8 is like a tip for one brand of car ("do not shift to third before 30 km/h"). Some tips are about physics and hold in every car (a heavier load needs more fuel). Others are about that gearbox. You find out which is which by driving the other cars on the same road, with the same load, on the same day.

### Words first

| Term | Plain meaning | Analogy | Concrete example (this lab) |
|---|---|---|---|
| Engine | The program inside a browser or runtime that runs JavaScript | The engine of a car; the body (browser) is separate | V8 in Chrome and Node.js; SpiderMonkey in Firefox; JavaScriptCore in WebKit and Bun |
| V8 | The JavaScript engine of Chrome and Node.js | — | V8 13.6.233.17 in Node.js 24.22.1; V8 15.8.62.31 in Chrome 158 |
| SpiderMonkey | "the JavaScript and WebAssembly implementation library of the Mozilla Firefox web browser" ✅[^sm] | — | the engine inside Firefox 161.0 here |
| JavaScriptCore (JSC) | "the built-in JavaScript engine for WebKit" ✅[^jsc]; Bun is "powered by JavaScriptCore" ✅[^bun] | — | the macOS 26.1 framework (version 21622.2.11.11.9), Bun 1.4.5, and the WebKit build of the Playwright test tool |
| JIT tier | One of the compilers an engine moves a function through as it gets hot: first an interpreter, then faster compilers that need more warm-up. JIT means "just in time": the engine compiles while the program runs | Gears of a car: the engine shifts up as speed builds | JavaScriptCore: the LLInt interpreter, the Baseline JIT, the DFG JIT and the FTL JIT ✅[^jsc]; SpiderMonkey: the Baseline Interpreter, the Baseline Compiler and WarpMonkey ✅[^sm]; the JavaScriptCore shell's options `useLLInt`, `useBaselineJIT`, `useDFGJIT` and `useFTLJIT` are all `true` by default ✅[^lab] |
| Shell | A program that runs a script file with an engine and nothing else: no page, no DOM (the document object model, the page's elements), its own event loop | An engine on a test bench, outside the car | `jsc` (JSC-mac) and Bun (JSC-bun); Node.js is a runtime around V8 |
| Page | The script runs inside a web page of a real browser | The engine in the car, on the road | V8-chrome, SM-firefox and JSC-page |
| Shape | The engines' internal record of an object's layout (V8 calls it a map, JavaScriptCore a structure) | A form with its boxes in a fixed order | not observable here on SpiderMonkey and JavaScriptCore; only its effect on time is |
| Timer step | The smallest time difference `performance.now()` returns | The marks on a ruler | 0.02 ms in Firefox and the JSC shell, 0.1 ms in Chrome, 1 ms in the WebKit page ✅[^lab] |
| Liveness | Whether an object can still be reached and so cannot be freed | A book still listed in the catalogue | read here with a `WeakRef`: `deref()` returns `undefined` once the object was collected |

**What can be seen on each engine.** On SpiderMonkey and JavaScriptCore this lab sees only time, counts, bytes (in the two JavaScriptCore shells) and liveness. It does not see shapes, tiers or deoptimizations there, because the V8 natives (`%HaveSameMap`, `%GetOptimizationStatus`) and V8's trace flags exist only in V8. So this doc never explains a SpiderMonkey or JavaScriptCore timing by an internal mechanism: it reports what happened. The mechanisms behind the V8 numbers are in the three V8 deep dives (Related).

## 2. Concept architecture

### 2.1 The six environments

All six ran on one Apple M2 with macOS 26.1, on 2026-11-28 ✅[^lab].

| Id | Engine and build | How it was run | Heap bytes | Forced GC |
|---|---|---|---|---|
| V8-node | V8 13.6.233.17-node.58, Node.js 24.22.1, macOS arm64 (the same build also ran the environment check in the `node:24.22.1-alpine` container, linux arm64) | `node <script>`; `node --expose-gc <script>` for the memory lines | `process.memoryUsage().heapUsed` (plus `arrayBuffers` for typed arrays) | `gc()` |
| V8-chrome | V8 15.8.62.31, Google Chrome 158.0.8127.89, macOS arm64, a visible window (a foreground tab) | a page; `--js-flags=--expose-gc --enable-precise-memory-info` for the memory lines | `performance.memory.usedJSHeapSize` | `gc()` |
| SM-firefox | SpiderMonkey, Firefox 161.0, macOS arm64, headless, a new empty profile with `privacy.reduceTimerPrecision` set to `false` | a page | none | none |
| JSC-mac | JavaScriptCore 21622.2.11.11.9, the framework that ships with macOS 26.1, through its own `jsc` shell, arm64 | `jsc <script>` | `gcHeapSize()` | `fullGC()` |
| JSC-bun | JavaScriptCore inside Bun 1.4.5 (WebKit commit d6375c72), image `oven/bun:1.4.5`, linux arm64 container, no network | `bun <script>` | `heapStats().heapSize` from `bun:jsc` | `Bun.gc(true)` |
| JSC-page | JavaScriptCore inside the WebKit build that the Playwright test tool installs (build 2311, user agent AppleWebKit/605.1.15), a visible window | a page | none | none |

**Safari itself was not run.** JavaScriptCore ran in a shell (JSC-mac), in Bun (JSC-bun) and in a WebKit page (JSC-page). JSC-mac is the JavaScriptCore framework that ships with macOS 26.1 (version 21622.2.11.11.9), run through its own shell, not a browser; Safari 26.1 is installed on the same macOS 26.1 (the `Info.plist` of Safari.app says 26.1) ✅[^lab], but this doc does not say which JavaScriptCore build Safari uses. JSC-page is a browser page with JavaScriptCore, from the WebKit build that the Playwright test tool installs.

**Shell against page.** JSC-mac and JSC-bun have no DOM and their own event loops; SM-firefox, JSC-page and V8-chrome are pages. The JavaScriptCore shell has no `queueMicrotask`, no `setInterval`, no `clearTimeout` and no `EventTarget` ✅[^lab]; the scripts fall back to `Promise.resolve().then()` for a microtask there, and say so in their output.

**The JavaScriptCore shell's helpers.** The shell hides its helper functions from `Object.getOwnPropertyNames(globalThis)` and from `for…in` (both list only the standard globals), but `typeof` finds them: `gc`, `fullGC`, `edenGC`, `gcHeapSize`, `print`, `preciseTime`, `describe`, `drainMicrotasks`, `setTimeout`, `noInline`, `numberOfDFGCompiles`, `version`, `quit`, `readFile`, `load` and `jscStack` are functions ✅[^lab]. This lab used `print` (through a one-line `console.log` built on it), `fullGC`, `gcHeapSize` and `setTimeout`, and no option on the command line. `gcHeapSize()` returns bytes: 10⁶ doubles in an array read 8.00 bytes each, a `Float64Array` of 10⁶ elements 8.00, so it counts typed-array contents too ✅[^lab]. Bun's `heapStats().heapSize` gave 8.01 and 8.00 ✅[^lab].

The environment check (`env.js`: engine, a 3 × 10⁸-step loop, the timer step, the helpers present), the JavaScriptCore shell's helpers, its timers and the strict-mode check ✅[^lab]:

<details><summary>Lab: <code>env.js</code>, output of run 1 on each environment that ran it, then the script</summary>

V8-node:

```text
engine: node 24.22.1 v8 13.6.233.17-node.58
spin 3e8 ms: 1193.7 result 838144 | timer step ms: 0.0000
has: WeakRef FinalizationRegistry structuredClone queueMicrotask setTimeout iterator-helpers
```

V8-chrome:

```text
engine: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36
spin 3e8 ms: 1138.6 result 838144 | timer step ms: 0.1000
has: WeakRef FinalizationRegistry structuredClone queueMicrotask setTimeout performance.memory iterator-helpers
```

SM-firefox:

```text
engine: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:161.0) Gecko/20100101 Firefox/161.0
spin 3e8 ms: 1276.7 result 838144 | timer step ms: 0.0200
has: WeakRef FinalizationRegistry structuredClone queueMicrotask setTimeout iterator-helpers
```

JSC-mac:

```text
engine: shell undefined
spin 3e8 ms: 1209.8 result 838144 | timer step ms: 0.0200
has: gc fullGC gcHeapSize WeakRef FinalizationRegistry setTimeout iterator-helpers
```

JSC-bun:

```text
engine: bun 1.4.5 webkit d6375c72affe0f70222cdcb45012b10f0bf3a9d5
spin 3e8 ms: 1204.9 result 838144 | timer step ms: 0.0000
has: WeakRef FinalizationRegistry structuredClone queueMicrotask setTimeout iterator-helpers
```

JSC-page:

```text
engine: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)
spin 3e8 ms: 1204.0 result 838144 | timer step ms: 1.0000
has: WeakRef FinalizationRegistry structuredClone queueMicrotask setTimeout iterator-helpers
```

```js
const nowFn = () => performance.now();
// timer step: smallest non-zero difference seen in 20000 readings
let step = Infinity, prev = nowFn();
for (let i = 0; i < 200000; i++) { const t = nowFn(); if (t !== prev) { step = Math.min(step, t - prev); prev = t; } }
function spin(n) { let x = 0; for (let i = 0; i < n; i++) x = (x + i * 7) % 1000003; return x; }
spin(1e6);
const t0 = nowFn(); const r = spin(3e8); const t1 = nowFn();
const g = globalThis;
console.log('engine: ' + (g.Bun ? 'bun ' + Bun.version + ' webkit ' + process.versions.webkit : g.process && process.versions && process.versions.v8 ? 'node ' + process.versions.node + ' v8 ' + process.versions.v8 : g.navigator ? navigator.userAgent : 'shell ' + (typeof version === 'function' ? version() : '?')));
console.log('spin 3e8 ms: ' + (t1 - t0).toFixed(1) + ' result ' + r + ' | timer step ms: ' + step.toFixed(4));
console.log('has: ' + ['gc', 'fullGC', 'gcHeapSize', 'WeakRef', 'FinalizationRegistry', 'structuredClone', 'queueMicrotask', 'setTimeout'].filter((k) => typeof g[k] !== 'undefined').join(' ') + (g.performance && performance.memory ? ' performance.memory' : '') + (g.Iterator && Iterator.prototype && Iterator.prototype.map ? ' iterator-helpers' : ''));
```
</details>

<details><summary>Lab: <code>globals.js</code>, output of run 1 on each environment that ran it, then the script</summary>

JSC-mac:

```text
AggregateError Array ArrayBuffer Atomics BigInt BigInt64Array BigUint64Array Boolean DataView Date Error EvalError FinalizationRegistry Float16Array Float32Array Float64Array Function Infinity Int16Array Int32Array Int8Array Intl Iterator JSON Map Math NaN Number Object Promise Proxy RangeError ReferenceError Reflect RegExp Set SharedArrayBuffer String Symbol SyntaxError TypeError URIError Uint16Array Uint32Array Uint8Array Uint8ClampedArray WeakMap WeakRef WeakSet WebAssembly decodeURI decodeURIComponent encodeURI encodeURIComponent escape eval globalThis isFinite isNaN parseFloat parseInt undefined unescape
```

```js
console.log(Object.getOwnPropertyNames(globalThis).sort().join(" "))
```
</details>

<details><summary>Lab: <code>globals3.js</code>, output of run 1 on each environment that ran it, then the script</summary>

JSC-mac:

```text
for-in: 0 
typeof: gc=function fullGC=function edenGC=function gcHeapSize=function print=function preciseTime=function describe=function drainMicrotasks=function setTimeout=function queueMicrotask=undefined $vm=undefined noInline=function numberOfDFGCompiles=function version=function quit=function readFile=function load=function jscStack=function EventTarget=undefined performance=object
```

```js
const ks = []; for (const k in globalThis) ks.push(k);
console.log('for-in: ' + ks.length + ' ' + ks.sort().join(' '));
console.log('typeof: ' + ['gc','fullGC','edenGC','gcHeapSize','print','preciseTime','describe','drainMicrotasks','setTimeout','queueMicrotask','$vm','noInline','numberOfDFGCompiles','version','quit','readFile','load','jscStack','EventTarget','performance'].map(k => k + '=' + typeof globalThis[k]).join(' '));
```
</details>

<details><summary>Lab: <code>globals2.js</code>, output of run 1 on each environment that ran it, then the script</summary>

JSC-mac:

```text
proto: __defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__ __proto__ constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf
gcHeapSize before 113645 after 1e6 doubles 8118043 diff/elt 8.00 1000000
1e6 {x,y} diff/elt 40.03 1000000
```

```js
const p = Object.getPrototypeOf(globalThis);
console.log('proto: ' + Object.getOwnPropertyNames(p).sort().join(' '));
fullGC(); const h0 = gcHeapSize(); const keep = new Array(1e6).fill(0).map((_, i) => i + 0.5); fullGC(); const h1 = gcHeapSize();
console.log('gcHeapSize before ' + h0 + ' after 1e6 doubles ' + h1 + ' diff/elt ' + ((h1 - h0) / 1e6).toFixed(2) + ' ' + keep.length);
const a2 = new Array(1e6); for (let i = 0; i < 1e6; i++) a2[i] = { x: i, y: i }; fullGC(); const h2 = gcHeapSize();
console.log('1e6 {x,y} diff/elt ' + ((h2 - h1) / 1e6).toFixed(2) + ' ' + a2.length);
```
</details>

<details><summary>Lab: <code>jscheap.js</code>, output of run 1 on each environment that ran it, then the script</summary>

JSC-mac:

```text
f64/elt 8.00 smi/elt 8.0210000001000000
```

```js
fullGC(); const a = gcHeapSize(); const f = new Float64Array(1e6); fullGC(); const b = gcHeapSize(); const x = new Array(1e6); for (let i=0;i<1e6;i++) x[i]=i; fullGC(); const c = gcHeapSize();
console.log('f64/elt ' + ((b-a)/1e6).toFixed(2) + ' smi/elt ' + ((c-b)/1e6).toFixed(2) + f.length + x.length);
```
</details>

<details><summary>Lab: <code>bunheap.js</code>, output of run 1 on each environment that ran it, then the script</summary>

JSC-bun:

```text
doubles/elt heapSize 8.01 heapUsed 8.01 | f64/elt 8.00 8.00 10000001000000
objectTypeCounts protectedObjectTypeCounts heapSize heapCapacity extraMemorySize objectCount protectedObjectCount globalObjectCount protectedGlobalObjectCount mimalloc
```

```js
const { heapStats } = require('bun:jsc');
const m = () => { Bun.gc(true); const h = heapStats(); return [h.heapSize, process.memoryUsage().heapUsed]; };
const a = m(); const keep = new Array(1e6).fill(0).map((_, i) => i + 0.5); const b = m();
const f = new Float64Array(1e6); const c = m();
console.log('doubles/elt heapSize ' + ((b[0]-a[0])/1e6).toFixed(2) + ' heapUsed ' + ((b[1]-a[1])/1e6).toFixed(2) + ' | f64/elt ' + ((c[0]-b[0])/1e6).toFixed(2) + ' ' + ((c[1]-b[1])/1e6).toFixed(2) + ' ' + keep.length + f.length);
console.log(Object.keys(heapStats()).join(' '));
```
</details>

<details><summary>Lab: <code>timers.js</code>, output of run 1 on each environment that ran it, then the script</summary>

JSC-mac:

```text
undefined undefined undefined
```

JSC-bun:

```text
function function function
```

```js
console.log([typeof clearTimeout, typeof setInterval, typeof clearInterval].join(" "))
```
</details>

<details><summary>Lab: <code>strict.js</code>, output of run 1 on each environment that ran it, then the script</summary>

JSC-mac:

```text
strict: false
```

JSC-bun:

```text
strict: true
```

```js
console.log("strict: " + (function () { return this === undefined; })());
```
</details>


`env.js` in the `node:24.22.1-alpine` container (linux arm64) printed:

```text
engine: node 24.22.1 v8 13.6.233.17-node.58
spin 3e8 ms: 1071.4 result 838144 | timer step ms: 0.0000
has: WeakRef FinalizationRegistry structuredClone queueMicrotask setTimeout iterator-helpers
```

`jsc --options`, the lines for the interpreter and the JIT tiers:

```text
   useLLInt=true   ... allows the LLINT to be used if true
   useJIT=true   ... allows the executable pages to be allocated for JIT and thunks if true
   useBaselineJIT=true   ... allows the baseline JIT to be used if true
   useDFGJIT=true   ... allows the DFG JIT to be used if true
   useFTLJIT=true   ... allows the FTL JIT to be used if true
```

### 2.2 Method

- **One file per check, plain JavaScript.** Every script prints with `console.log`, uses only `performance.now()` for time, and times all its variants in the same process. A script that finishes asynchronously sets `globalThis.__manualFinish = true` and calls `__finish()` when a page defines it.
- **Timing.** `B(f)` calls `f` until 200 ms have passed and returns the time per call, so even the 1 ms timer step of the WebKit page is under 1 % of a reading. `R` runs one warm-up pass of `B` per variant (200 ms), then three rounds with the variants interleaved, and prints the range of ms per call and the ratio to the first variant in each round. Each script ran three times on each environment. The tables quote, per environment, the lowest ms per call of each run and the ratio of those lowest values; ranges are over the three runs. `uptime` was logged before every run; another lab ran on the same machine, so the one-minute load average was 2.1 to 13.8 on 8 cores (Verification status).
- **Checksums.** Every variant returns a number that is added to a global sink, and the script prints each variant's result once: equal results show that the variants did the same work.
- **Bytes.** Where the environment has a forced full GC and a heap counter (V8-node, V8-chrome, JSC-mac, JSC-bun): counter after a full GC, build the data inside a function and keep it, counter after a full GC again, divided by the element count.
- **Liveness.** A `WeakRef` to the subject and to a control object that is certainly unreachable; then steps of 16 MB of garbage with a 0 ms timer between them (and a forced full GC where there is one) until the control's `deref()` is `undefined`, then five steps more, then read the subject. Creating a `WeakRef` and calling `deref()` both keep the target alive until the current job ends (the specification's AddToKeptObjects) ✅[^tc39weak], so every check runs in its own timer turn and no byte count is taken while a `WeakRef` to the measured data is new. This shows liveness, not bytes.
- **Verdicts.** The rule as the skill words it is judged per engine by the ratio of the form the rule advises against to the form it advises: **holds** when that ratio is at least 1.5 in every run; **weaker** when it is between 1.1 and 1.5; **no effect** between 0.9 and 1.1; **reversed** below 0.9 (following the rule costs there). For a "no gain" rule (keep writing the form; rewriting it gains nothing), it holds when the rewrite gains less than a factor 1.5. Counts and bytes are compared as numbers. The verdict for JavaScriptCore uses JSC-mac, JSC-bun and JSC-page together and names the one that differs.

### 2.3 Reproducing a page run without the runner

1. Serve a page from 127.0.0.1 that holds the script inline and replaces `console.log` with a function that collects the lines; at the end, `fetch('/result', { method: 'POST', body: lines.join('\n') })` sends them back to the same small HTTP server, which prints them.
2. Firefox: `firefox --headless --no-remote --profile <an empty folder> --new-window http://127.0.0.1:<port>/page`, with a `user.js` file in that folder holding `user_pref("privacy.reduceTimerPrecision", false);` for the finer timer (without it, Firefox rounds `performance.now()` more coarsely).
3. Chrome: `--user-data-dir=<an empty folder> --enable-precise-memory-info --js-flags=--expose-gc`, a visible window.
4. The JavaScriptCore shell sits inside the system framework: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`. Load a one-line file first that defines `console.log` with `print` when `console` is missing.

## 3. How it works

The master table: one row per check. Each engine column gives the headline number of that check (ranges over three runs; ×n is the disfavoured form's time divided by the advised form's, so ×3.0 means three times slower). The verdict is about the rule as the skill words it, with the thresholds of §2.2: **holds** at a ratio of 1.5 or more in every run (for a "no gain" rule: the rewrite gains less than 1.5 times), **weaker** at 1.1 to 1.5 or with no effect on the engine named, **reversed** when following the rule costs there. "—" means the environment cannot report that quantity. All rows ✅[^lab].

| # | Rules | What was measured | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `JE-F1`, `JE-O1` | 8 key orders at one read site against 1 | ×2.98 to 3.11 | ×3.24 to 3.70 | ×2.22 to 2.24 | ×2.22 to 2.33 | ×2.27 to 2.30 | ×2.36 to 2.41 | holds on all three engines |
| 2 | `JE-O2` | reads after `delete` against untouched | ×4.22 to 4.30 | ×1.78 to 1.98 | ×2.02 to 2.21 | ×1.00 | ×1.00 | ×1.00 | holds, weaker on JavaScriptCore (no effect there) |
| 3 | `JE-O3` | 30 computed keys against a literal: building / reading | ×31 to 33 / ×4.3 to 4.5 | ×44 to 46 / ×1.2 to 1.9 | ×45 to 50 / ×0.9 to 1.0 | ×7.5 to 8.5 / ×1.0 | ×8.2 to 10.1 / ×1.0 | ×7.2 to 8.2 / ×1.0 | holds on all three engines |
| 4 | `JE-O5` | creating with `Object.setPrototypeOf` against a class | ×14.5 to 17.4 | ×33 to 36 | ×3.5 to 4.5 | ×6.0 to 6.6 | ×4.7 to 5.2 | ×6.5 to 7.4 | holds on all three engines |
| 5 | `JE-O6` | the worst built-in slowdown after one prototype write | ×243 | ×205 to 217 | ×1.0 (at most ×1.15) | ×11.3 | ×10.3 to 11.0 | ×10.6 to 10.8 | holds, weaker on SM-firefox (no effect there) |
| 6 | `JE-N5` | `new Array(n)` filled by index against packed, sum | ×1.12 to 1.13 | ×0.99 to 1.06 | ×0.94 to 1.01 | ×1.00 to 1.01 | ×1.00 to 1.01 | ×1.00 | holds on all three engines |
| 7 | `JE-N6` | `push` onto `[]` against `new Array(n)`, 10⁶ | ×3.0 to 3.6 | ×2.3 to 2.4 | ×0.94 to 1.02 | ×4.5 | ×6.3 to 6.7 | ×4.8 to 5.0 | holds, weaker on SM-firefox (no effect there) |
| 8 | `JE-N7` | sparse array against `Map`: writes / reads | ×2.8 to 3.0 / ×1.4 to 2.0 | ×2.3 / ×1.1 | ×1.8 to 1.9 / ×1.4 to 1.5 | ×3.1 to 3.3 / ×2.2 | ×2.8 to 3.2 / ×1.8 to 1.9 | ×3.3 to 3.4 / ×2.7 to 2.9 | holds, weaker on V8-chrome and SM-firefox (reads) |
| 9 | `JE-N8` | `for…in` over an array against an index `for` | ×55 to 56 | ×31 | ×25 to 27 | ×79 to 81 | ×82 | ×108 to 112 | holds on all three engines |
| 10 | `JE-N1`, `JE-N9`, `JE-N10`, `JE-S1`, `JE-S2`, `JE-S9` | bytes: small-integer array / `{ x }` near 2³¹ / `Map` entry (on JavaScriptCore it varies with the count) / object table | 8.0 / 40.0 / 36.8 / 62.9 | 4.0 / 32.0 / 18.4 / 31.5 | — | 8.0 / 40.0 / 84 to 126 / 38.1 | 8.0 / 40.0 / 68.2 / 38.1 | — | engine-specific number |
| 11 | `JE-S3`, `JE-S4` | `+=` read after the loop at 1.6 × 10⁶ characters / read inside the loop at 40,000, ns per character | 7.6 to 7.8 / 795 to 855 | 4.5 to 4.6 / 770 to 797 | 8.6 to 9.3 / 21 to 22 | 4.8 to 5.2 / 901 to 950 | 9.2 to 11.8 / 935 to 1,370 | 5.1 to 5.8 / 933 to 1,917 | holds, weaker on SM-firefox (reading inside the loop is linear there) |
| 12 | `JE-S6` | `Proxy` (empty handler) against a plain read, 8 objects | ×8.5 to 9.0 | ×6.6 to 7.0 | ×3.2 to 3.4 | ×2.0 to 2.3 | ×2.0 | ×2.0 to 2.3 | holds on all three engines |
| 13 | `JE-S7`, `JE-S8` | literal getter against a field: one object / 8 objects | ×33.9 / ×11.1 | ×19.7 / ×9.2 | ×0.99 / ×1.23 | ×1.00 / ×1.42 | ×1.02 / ×1.44 | ×0.98 / ×1.42 | holds, weaker on SM-firefox and JavaScriptCore (no effect with one object; the class getter `JE-S8` cost nothing anywhere) |
| 14 | `JE-F3` | sum that once saw a string / hash without `Math.imul`, result used as `& 1023` / as `% 1000` | ×3.0 / ×1.2 / ×5.7 | ×2.6 to 3.2 / ×1.3 / ×4.5 | ×1.0 / ×1.1 / ×5.3 | ×1.0 / ×1.6 / ×9.4 | ×1.0 / ×1.7 / ×2.4 | ×1.0 / ×1.7 / ×10.4 | holds, weaker on SpiderMonkey and JavaScriptCore (the mixed-type half has no effect there; the hash half is 1.1 to 1.7 times unless a `%` follows) |
| 15 | `JE-F9` | `try`/`catch` against plain / `for…in` against `Object.keys` | ×1.00 / ×0.25 | ×1.00 / ×0.27 | ×0.98 to 1.15 / ×0.37 to 0.40 | ×0.98 to 0.99 / ×0.52 to 0.68 | ×0.99 / ×0.46 to 0.50 | ×1.00 / ×0.52 to 0.53 | holds on all three engines |
| 16 | `JE-F10` | a direct `eval` that never runs against plain: the catalog's shape / a loop of its own | ×25.3 / ×0.84 to 0.90 | ×17.8 to 18.3 / ×0.98 to 1.05 | ×94 to 99 / ×95 to 102 | ×27.0 / ×19.5 to 21.2 | ×18.1 to 18.5 / ×10.1 to 15.0 | ×27.6 / ×21.4 to 21.9 | holds on all three engines (on V8 only while the function is not inlined into its caller) |
| 17 | `JE-F11` | `{ x, y }` from a helper against loose variables | ×1.00 | ×1.00 | ×0.98 to 1.00 | ×1.00 | ×0.99 to 1.00 | ×1.00 | holds on all three engines |
| 18 | `JE-F12` | `forEach` against an index `for`, many small calls (in brackets: `for…of`) | ×1.71 to 1.79 (×1.09 to 1.13) | ×2.55 to 2.68 (×0.94 to 0.98) | ×4.48 to 4.87 (×3.78 to 4.00) | ×1.55 to 1.61 (×2.38 to 2.45) | ×1.81 to 1.86 (×1.23 to 1.50) | ×1.70 to 1.74 (×1.22 to 1.50) | holds on all three engines (for the index `for`; `for…of` is not near it on SM-firefox and JSC-mac) |
| 19 | `JE-F6` | ns per statement at 6,000 statements / at 1,000; the cliff lies between 2,000 and 3,000 (V8-node), 3,000 and 4,000 (V8-chrome), 1,000 and 2,000 (SM-firefox), 4,000 and 6,000 (JavaScriptCore) | 26.3 to 28.2 / 1.16 to 1.26 | 18.7 to 19.4 / 1.18 to 1.21 | 33.2 to 34.0 / 6.06 to 6.79 | 23.5 to 37.3 / 1.16 to 1.49 | 22.6 to 36.1 / 1.19 to 1.50 | 23.4 to 24.3 / 1.15 to 1.22 | holds on all three engines |
| 20 | `JE-M1` | round from which `forEach` is steady (1,000 calls per round) | 12 to 15 | 2 | no step in 15 rounds | 10 | 10 | 10 | holds, weaker on V8-chrome and SM-firefox (no warm-up step in 15 rounds) |
| 21 | `JL-L1`, `JL-L2` | chain / iterator helpers against one loop, 10⁶ (time only: the bytes that `JL-L2` is about were not measured) | ×22.9 to 24.7 / ×35.5 to 38.1 | ×25.9 to 27.1 / ×50.0 to 54.0 | ×4.11 to 5.35 / ×15.6 to 16.3 | ×2.65 to 2.74 / ×12.6 to 12.7 | ×2.86 to 3.04 / ×12.6 to 12.8 | ×2.40 to 2.56 / ×12.3 to 13.0 (one run ×44) | holds on all three engines (`JL-L1`; `JL-L2` not measured) |
| 22 | `JL-L3` | predicate calls, `filter(p)[0]` / `find(p)` | 100,000 / 11 | 100,000 / 11 | 100,000 / 11 | 100,000 / 11 | 100,000 / 11 | 100,000 / 11 | holds on all three engines |
| 23 | `JL-L4` | comparator calls, 10,000 rows | 119,955 | 119,784 | 126,592 | 120,378 | 120,691 | 120,691 | holds on all three engines |
| 24 | `JL-L5` | default `Error.stackTraceLimit` / error with `.stack` against a plain object | 10 / ×64 | 10 / ×26 | 128 / ×34 | 100 / ×39 | 10 / ×42 | 100 / ×58 | holds on all three engines |
| 25 | `JL-L6` | largest `Math.max(...arr)` (these builds, top-level call) | 124,539 | 123,681 to 123,683 | 524,287 | 638,728 | 638,454 | 638,722 | engine-specific number |
| 26 | `JL-L7`, `JL-L8` | growth when n doubles: `includes` in a loop / `[...acc, x]` | ×3.92 to 4.12 / ×3.24 to 3.69 | ×3.85 to 3.99 / ×4.30 to 4.74 | ×3.64 to 3.90 / ×3.79 to 3.96 | ×3.94 to 4.04 / ×3.40 to 3.72 | ×3.95 to 4.10 / ×3.48 to 4.20 | ×3.92 to 3.96 / ×3.74 to 3.86 | holds on all three engines |
| 27 | `JL-L10` | `#private` against a public field | ×0.97 to 1.01 | ×0.94 to 1.02 | ×0.97 to 1.02 | ×1.07 to 1.16 | ×1.07 to 1.08 | ×1.00 to 1.16 | holds on all three engines (`#private` costs at most 16 %; avoiding it gains nothing) |
| 28 | `JL-A1`, `JL-A2` | turns: `await` per plain value / `return p` / `return await p` | 1,001 / 3,001 / 2,001 | same | same | same | same | same | holds on all three engines |
| 29 | `JL-A8`, `JN-E3` | 100,000 microtasks against a 0 ms timer: first, and when done | microtasks, 3.7 to 4.5 ms | microtasks, 25 to 27 ms | microtasks, 32 to 48 ms | microtasks, 9 to 14 ms | microtasks, 2.2 to 3.6 ms | microtasks, 2.0 to 3.0 ms | holds on all three engines |
| 30 | `JL-G1` | a sibling closure keeps the array: 10 scopes / liveness | 76.3 MiB / alive | 38.1 MiB / alive | — / not measurable (control object kept) | 76.3 MiB / alive | 76.3 MiB / alive | — / alive | not measurable on SM-firefox |
| 31 | `JL-G2` | cache of a stopped job whose handle is kept | collected | alive | alive | not measurable (no `setInterval`, no `EventTarget`) | collected | alive | holds in the browsers' pages (V8-chrome, SM-firefox, JSC-page); weaker on V8-node and JSC-bun (the handle changed nothing there) |
| 32 | `JL-G3` | shortest plain `slice` that kept the 16 MiB parent (`[...s].join('')` freed it, up to 1,000 characters) | 16.0 MiB at 13 | 16.0 MiB at 13 | — | 16.0 MiB at 3 | 16.0 MiB at 3 | — | not measurable on SM-firefox |
| 33 | `JL-G4`, `JL-G5` | `WeakMap` entry freed / finalizer ran within the script's wait (Node.js and Bun: 40 to 55 ms after the first forced collection) | yes / no (none in 3,000 ms and 215 to 246 forced collections either) | yes / yes | yes / yes | yes / yes | yes / no (ran 12 to 19 ms after the first forced collection in a second script) | yes / yes | holds on all three engines |

## 4. Worked examples

One part per check. Each part gives the result in a few sentences, what it means for code that runs in browsers, then the output of the second of three runs on each environment and the script that printed it. Ranges in the text are over the three runs.

### 4.1 `JE-F1` / `JE-O1`: one read site fed 1, 4 and 8 key orders

Each reader function reads `o.a` 10⁶ times from 8 objects that hold the same four keys `a`, `b`, `c`, `d`, written in 1, 4 or 8 different orders. Lowest ms per 10⁶ reads, ratio to one order, three runs ✅[^lab]:

| Orders | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| 1 | 1.05 to 1.11 | 0.84 to 0.94 | 1.14 to 1.15 | 1.04 to 1.07 | 1.03 to 1.04 | 1.04 to 1.05 |
| 4 | ×1.35 to 1.38 | ×1.36 to 1.50 | ×1.51 to 1.54 | ×1.50 to 1.54 | ×1.47 to 1.50 | ×1.46 to 1.47 |
| 8 | ×2.98 to 3.11 | ×3.24 to 3.70 | ×2.22 to 2.24 | ×2.22 to 2.33 | ×2.27 to 2.30 | ×2.36 to 2.41 |

Every engine slowed as the key orders grew: about 1.5 times at 4 orders and 2.2 to 3.7 times at 8. Per 10⁷ reads that is about 10 ms at one order against 24 to 37 ms at eight. For browser code: build objects that meet at one hot function in one key order (a class or one factory); this pays on all three engines.

<details><summary>Lab: <code>shapes.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
10^6 reads of o.a
  1 order: 1.06-1.07 ms/call, x1.00-1.00, result 3500000
  4 orders: 1.44-1.73 ms/call, x1.36-1.63, result 3500000
  8 orders: 3.27-3.39 ms/call, x3.07-3.18, result 3500000
```

V8-chrome:

```text
10^6 reads of o.a
  1 order: 0.849-1.37 ms/call, x1.00-1.00, result 3500000
  4 orders: 1.27-1.63 ms/call, x0.98-1.49, result 3500000
  8 orders: 3.05-3.17 ms/call, x2.23-3.73, result 3500000
```

SM-firefox:

```text
10^6 reads of o.a
  1 order: 1.15-1.36 ms/call, x1.00-1.00, result 3500000
  4 orders: 1.76-1.89 ms/call, x1.39-1.56, result 3500000
  8 orders: 2.56-2.69 ms/call, x1.98-2.25, result 3500000
```

JSC-mac:

```text
10^6 reads of o.a
  1 order: 1.07-1.92 ms/call, x1.00-1.00, result 3500000
  4 orders: 1.61-3.54 ms/call, x1.50-1.84, result 3500000
  8 orders: 2.38-3.95 ms/call, x2.05-2.34, result 3500000
```

JSC-bun:

```text
10^6 reads of o.a
  1 order: 1.03-1.04 ms/call, x1.00-1.00, result 3500000
  4 orders: 1.55-1.61 ms/call, x1.49-1.56, result 3500000
  8 orders: 2.37-2.49 ms/call, x2.27-2.41, result 3500000
```

JSC-page:

```text
10^6 reads of o.a
  1 order: 1.04-1.05 ms/call, x1.00-1.00, result 3500000
  4 orders: 1.52-1.57 ms/call, x1.45-1.51, result 3500000
  8 orders: 2.45-2.50 ms/call, x2.34-2.40, result 3500000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-F1 / JE-O1: one read site per function, fed objects with the same 4 keys in 1, 4 or 8 key orders. One call = 10^6 reads.
const orders = ['abcd', 'bacd', 'cabd', 'dabc', 'acbd', 'bcad', 'cbad', 'dbac'];
const make = (keys, i) => { const o = {}; for (const k of keys) o[k] = i; return o; };
const objs = (m) => Array.from({ length: 8 }, (_, i) => make(orders[i % m], i));
const o1 = objs(1), o4 = objs(4), o8 = objs(8);
function read1(os) { let s = 0; for (let i = 0; i < 1e6; i++) s += os[i & 7].a; return s; }
function read4(os) { let s = 0; for (let i = 0; i < 1e6; i++) s += os[i & 7].a; return s; }
function read8(os) { let s = 0; for (let i = 0; i < 1e6; i++) s += os[i & 7].a; return s; }
R('10^6 reads of o.a', { '1 order': () => read1(o1), '4 orders': () => read4(o4), '8 orders': () => read8(o8) });
```
</details>

### 4.2 `JE-O2`: reads after `delete`

8 objects `{ a, b, c, d }`, read `o.c` 10⁶ times, a different object at each step (`os[i & 7].c`) with every value summed and printed, so no read can be skipped or hoisted out of the loop (about 1 ns per read in every environment): untouched, after `delete o.b`, and after `o.b = undefined` ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| untouched, ms | 1.05 to 1.08 | 0.85 to 0.93 | 1.15 to 1.28 | 1.04 to 1.06 | 1.03 to 1.08 | 1.04 to 1.08 |
| after `delete` | ×4.22 to 4.30 | ×1.78 to 1.98 | ×2.02 to 2.21 | ×1.00 | ×1.00 | ×1.00 |
| `= undefined` | ×0.99 to 1.00 | ×0.89 to 1.02 | ×0.89 to 1.00 | ×1.00 | ×1.00 | ×1.00 |

`delete` slowed later reads on V8 (4.2 times in Node.js, 1.8 to 2.0 times in Chrome) and on SpiderMonkey (2.0 to 2.2 times); on all three JavaScriptCore environments the reads after `delete` took the same time as untouched ones. Assigning `undefined` cost nothing anywhere. In Chrome the untouched reads varied from 0.85 to 1.42 ms between rounds, so the ratio of one round ranged from 1.2 to 1.95; the ratio of the lowest times was 1.8 to 2.0. In SM-firefox one of nine rounds took 239 ms instead of about 2.6 ms (run 3): a pause from outside the measured code, which the lowest-of-three-rounds figure leaves out. For browser code: `o.prop = undefined` is never slower, and it avoids a 2-times cost in Chrome and Firefox.

<details><summary>Lab: <code>delete.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
10^6 reads of o.c
  untouched: 1.05-1.39 ms/call, x1.00-1.00, result 3500000
  after delete o.b: 4.52-4.83 ms/call, x3.34-4.58, result 3500000
  o.b = undefined: 1.05-1.08 ms/call, x0.77-1.00, result 3500000
```

V8-chrome:

```text
10^6 reads of o.c
  untouched: 0.934-1.38 ms/call, x1.00-1.00, result 3500000
  after delete o.b: 1.66-1.90 ms/call, x1.20-1.83, result 3500000
  o.b = undefined: 0.829-1.36 ms/call, x0.89-1.00, result 3500000
```

SM-firefox:

```text
10^6 reads of o.c
  untouched: 1.15-1.41 ms/call, x1.00-1.00, result 3500000
  after delete o.b: 2.54-2.73 ms/call, x1.94-2.22, result 3500000
  o.b = undefined: 1.15-1.42 ms/call, x0.87-1.24, result 3500000
```

JSC-mac:

```text
10^6 reads of o.c
  untouched: 1.06-1.12 ms/call, x1.00-1.00, result 3500000
  after delete o.b: 1.06-1.11 ms/call, x0.99-1.00, result 3500000
  o.b = undefined: 1.06-1.21 ms/call, x1.00-1.08, result 3500000
```

JSC-bun:

```text
10^6 reads of o.c
  untouched: 1.08-1.10 ms/call, x1.00-1.00, result 3500000
  after delete o.b: 1.08-1.16 ms/call, x0.99-1.05, result 3500000
  o.b = undefined: 1.08-1.23 ms/call, x1.00-1.11, result 3500000
```

JSC-page:

```text
10^6 reads of o.c
  untouched: 1.06-1.08 ms/call, x1.00-1.00, result 3500000
  after delete o.b: 1.06-1.06 ms/call, x0.98-1.00, result 3500000
  o.b = undefined: 1.06-1.06 ms/call, x0.98-1.01, result 3500000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-O2: reads of objects after `delete o.b`, against untouched objects and against `o.b = undefined`. One call = 10^6 reads.
const make = (i) => ({ a: i, b: i, c: i, d: i });
const plain = [], deleted = [], undef = [];
for (let i = 0; i < 8; i++) { plain.push(make(i)); const d = make(i); delete d.b; deleted.push(d); const u = make(i); u.b = undefined; undef.push(u); }
function readP(os) { let s = 0; for (let i = 0; i < 1e6; i++) s += os[i & 7].c; return s; }
function readD(os) { let s = 0; for (let i = 0; i < 1e6; i++) s += os[i & 7].c; return s; }
function readU(os) { let s = 0; for (let i = 0; i < 1e6; i++) s += os[i & 7].c; return s; }
R('10^6 reads of o.c', { untouched: () => readP(plain), 'after delete o.b': () => readD(deleted), 'o.b = undefined': () => readU(undef) });
```
</details>

### 4.3 `JE-O3`: 30 computed keys against named fields

Records of 30 fields `f0` to `f29`, built three ways: a loop `o[k] = i` over the key list, a generated literal, and generated named assignments `o.f0 = i; …`. Reads: 10⁶ reads of `o.f17` from 8 records. Building: 10⁴ records per call, each kept in an array, then one field of each read, so that no engine can skip an unused record; each way has its own generated loop ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| 10⁶ reads of `o.f17`, literal, ms | 1.05 to 1.10 | 0.90 to 1.40 | 1.15 to 1.29 | 1.04 to 1.07 | 1.03 to 1.09 | 1.04 to 1.05 |
| reads, computed keys | ×4.29 to 4.49 | ×1.21 to 1.83 | ×0.89 to 1.00 | ×0.97 to 1.01 | ×0.95 to 1.07 | ×0.99 to 1.01 |
| building 10⁴ records, literal, ms | 0.111 to 0.116 | 0.080 to 0.081 | 0.18 to 0.20 | 0.22 to 0.24 | 0.22 to 0.26 | 0.22 to 0.26 |
| building, named assignments | ×4.3 to 4.6 | ×4.3 to 4.6 | ×2.3 to 2.6 | ×0.96 to 1.03 | ×0.93 to 1.08 | ×0.96 to 1.00 |
| building, computed keys | ×31 to 33 | ×44 to 46 | ×45 to 50 | ×7.5 to 8.5 | ×8.2 to 10.1 | ×7.2 to 8.2 |

Reads of a computed-key record were slower only on V8 (4.3 to 4.5 times in Node.js, 1.2 to 1.9 in Chrome, where the literal's own time ranged from 0.9 to 1.4 ms). Building records with computed keys was the slowest form on every engine: 31 to 46 times the literal on V8, 45 to 50 on SpiderMonkey (one SM-firefox round hit a pause and read 10), 7 to 10 on JavaScriptCore. In the first version of this check the records were not kept and one JSC-mac run timed the literal at 0.003 ms per 10⁴ records, which this lab cannot explain from outside; with the records kept, no run showed it again and the ratios no longer swung. For browser code: write record fields by name; the build cost alone justifies it on every engine, and the read cost on V8.

<details><summary>Lab: <code>computed.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
10^6 reads of o.f17
  literal: 1.05-1.05 ms/call, x1.00-1.00, result 3500000
  named assignments: 1.06-1.13 ms/call, x1.01-1.07, result 3500000
  computed keys: 4.52-4.60 ms/call, x4.30-4.37, result 3500000
building 10^4 records
  literal: 0.111-0.114 ms/call, x1.00-1.00, result 49995000
  named assignments: 0.498-0.507 ms/call, x4.44-4.50, result 49995000
  computed keys: 3.62-3.67 ms/call, x31.66-33.12, result 49995000
```

V8-chrome:

```text
10^6 reads of o.f17
  literal: 0.931-1.40 ms/call, x1.00-1.00, result 3500000
  named assignments: 0.910-1.36 ms/call, x0.97-1.00, result 3500000
  computed keys: 1.64-1.96 ms/call, x1.21-1.81, result 3500000
building 10^4 records
  literal: 0.0805-0.0808 ms/call, x1.00-1.00, result 49995000
  named assignments: 0.348-0.361 ms/call, x4.32-4.47, result 49995000
  computed keys: 3.55-3.58 ms/call, x43.89-44.24, result 49995000
```

SM-firefox:

```text
10^6 reads of o.f17
  literal: 1.15-1.28 ms/call, x1.00-1.00, result 3500000
  named assignments: 1.14-1.20 ms/call, x0.94-1.00, result 3500000
  computed keys: 1.15-1.15 ms/call, x0.90-1.00, result 3500000
building 10^4 records
  literal: 0.181-0.863 ms/call, x1.00-1.00, result 49995000
  named assignments: 0.447-1.96 ms/call, x2.27-2.47, result 49995000
  computed keys: 8.94-8.99 ms/call, x10.41-49.32, result 49995000
```

JSC-mac:

```text
10^6 reads of o.f17
  literal: 1.04-1.07 ms/call, x1.00-1.00, result 3500000
  named assignments: 1.04-1.08 ms/call, x1.00-1.01, result 3500000
  computed keys: 1.04-1.05 ms/call, x0.97-1.01, result 3500000
building 10^4 records
  literal: 0.217-0.241 ms/call, x1.00-1.00, result 49995000
  named assignments: 0.219-0.235 ms/call, x0.96-1.02, result 49995000
  computed keys: 1.81-1.81 ms/call, x7.52-8.34, result 49995000
```

JSC-bun:

```text
10^6 reads of o.f17
  literal: 1.03-1.05 ms/call, x1.00-1.00, result 3500000
  named assignments: 1.03-1.05 ms/call, x0.99-1.01, result 3500000
  computed keys: 1.03-1.11 ms/call, x0.98-1.07, result 3500000
building 10^4 records
  literal: 0.219-0.258 ms/call, x1.00-1.00, result 49995000
  named assignments: 0.221-0.239 ms/call, x0.93-1.05, result 49995000
  computed keys: 2.00-2.27 ms/call, x8.17-10.14, result 49995000
```

JSC-page:

```text
10^6 reads of o.f17
  literal: 1.04-1.04 ms/call, x1.00-1.00, result 3500000
  named assignments: 1.04-1.06 ms/call, x1.00-1.02, result 3500000
  computed keys: 1.04-1.04 ms/call, x0.99-1.00, result 3500000
building 10^4 records
  literal: 0.228-0.243 ms/call, x1.00-1.00, result 49995000
  named assignments: 0.222-0.242 ms/call, x0.98-1.00, result 49995000
  computed keys: 1.81-1.85 ms/call, x7.63-7.96, result 49995000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-O3: records of 30 fields built with computed keys in a loop, against a generated literal and generated named assignments.
const K = Array.from({ length: 30 }, (_, i) => 'f' + i);
const computed = (i) => { const o = {}; for (const k of K) o[k] = i; return o; };
const literal = new Function('i', 'return {' + K.map((k) => k + ': i').join(', ') + '};');
const named = new Function('i', 'const o = {};' + K.map((k) => 'o.' + k + ' = i;').join(' ') + ' return o;');
const recs = (mk) => Array.from({ length: 8 }, (_, i) => mk(i));
const rc = recs(computed), rl = recs(literal), rn = recs(named);
function readC(os) { let s = 0; for (let i = 0; i < 1e6; i++) s += os[i & 7].f17; return s; }
function readL(os) { let s = 0; for (let i = 0; i < 1e6; i++) s += os[i & 7].f17; return s; }
function readN(os) { let s = 0; for (let i = 0; i < 1e6; i++) s += os[i & 7].f17; return s; }
R('10^6 reads of o.f17', { literal: () => readL(rl), 'named assignments': () => readN(rn), 'computed keys': () => readC(rc) });
// Building: each variant has its own generated loop (its own comment, so its own call site and feedback). The records are kept in an array and one field of each is read afterwards,
// so that no engine can drop the allocation of a record that is never used.
const build = (mk, tag) => new Function('mk', `/* ${tag} */ return () => { const a = new Array(1e4); for (let i = 0; i < 1e4; i++) a[i] = mk(i); let s = 0; for (let i = 0; i < 1e4; i++) s += a[i].f29; return s; };`)(mk);
R('building 10^4 records', { literal: build(literal, 1), 'named assignments': build(named, 2), 'computed keys': build(computed, 3) });
```
</details>

### 4.4 `JE-O5`: a prototype set per object

10⁵ objects with one field `x` and a method `getX` on the prototype, created four ways, each way in its own generated creation loop (its own comment, so its own call site and feedback), then read through `o.getX()` by one reader function per way ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| create, class, ms | 0.38 to 0.46 | 0.17 to 0.19 | 0.79 to 0.94 | 0.33 to 0.36 | 0.49 to 0.54 | 0.33 to 0.36 |
| create, `Object.create` | ×1.15 to 1.43 | ×1.5 to 2.2 | ×0.58 to 0.70 | ×1.08 to 1.21 | ×1.42 to 1.63 | ×1.12 to 1.35 |
| create, `__proto__` literal | ×13.8 to 16.5 | ×31 to 33 | ×2.0 to 2.4 | ×4.4 to 4.7 | ×3.4 to 3.9 | ×4.9 to 5.4 |
| create, `Object.setPrototypeOf` | ×14.5 to 17.4 | ×33 to 36 | ×3.5 to 4.5 | ×6.0 to 6.6 | ×4.7 to 5.2 | ×6.5 to 7.4 |
| 10⁵ reads, class, ms | 0.090 | 0.089 to 0.092 | 0.12 | 0.093 to 0.097 | 0.095 to 0.096 | 0.093 to 0.094 |
| reads, the other three ways | ×1.00 to 1.04 | ×0.97 to 1.02 | ×0.96 to 1.04 | ×0.96 to 1.03 | ×0.99 to 1.04 | ×0.99 to 1.03 |

Setting the prototype per object made creation 14 to 36 times slower on V8 (14 to 17 in Node.js, 33 to 36 in Chrome), 3.5 to 4.5 times on SpiderMonkey and 4.7 to 7.4 times on JavaScriptCore; reading the objects afterwards cost the same on every engine. The first version of this check used one creation loop for all four ways; the four ways then shared one call site and its type feedback, the class was slower than it is here, and the ratios were smaller (10 to 12 on V8). For browser code: use a class or `Object.create`; the gain is largest in Chrome, and at least 2 times on every engine.

<details><summary>Lab: <code>proto.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
creating 10^5 objects
  class: 0.382-0.397 ms/call, x1.00-1.00, result 100000
  Object.create: 0.505-0.545 ms/call, x1.29-1.43, result 100000
  __proto__ literal: 6.13-6.35 ms/call, x15.95-16.49, result 100000
  Object.setPrototypeOf: 6.58-6.66 ms/call, x16.58-17.44, result 100000
10^5 reads of o.getX()
  class: 0.0897-0.0902 ms/call, x1.00-1.00, result 4999950000
  Object.create: 0.0920-0.0937 ms/call, x1.02-1.04, result 4999950000
  __proto__ literal: 0.0898-0.0899 ms/call, x1.00-1.00, result 4999950000
  Object.setPrototypeOf: 0.0899-0.0901 ms/call, x1.00-1.00, result 4999950000
```

V8-chrome:

```text
creating 10^5 objects
  class: 0.174-0.183 ms/call, x1.00-1.00, result 100000
  Object.create: 0.271-0.289 ms/call, x1.54-1.58, result 100000
  __proto__ literal: 5.76-5.86 ms/call, x32.12-33.12, result 100000
  Object.setPrototypeOf: 6.14-6.30 ms/call, x34.51-35.42, result 100000
10^5 reads of o.getX()
  class: 0.0894-0.0910 ms/call, x1.00-1.00, result 4999950000
  Object.create: 0.0896-0.0909 ms/call, x0.99-1.02, result 4999950000
  __proto__ literal: 0.0897-0.0898 ms/call, x0.99-1.00, result 4999950000
  Object.setPrototypeOf: 0.0897-0.0908 ms/call, x0.99-1.01, result 4999950000
```

SM-firefox:

```text
creating 10^5 objects
  class: 0.824-0.881 ms/call, x1.00-1.00, result 100000
  Object.create: 0.526-0.556 ms/call, x0.63-0.64, result 100000
  __proto__ literal: 1.80-1.94 ms/call, x2.07-2.35, result 100000
  Object.setPrototypeOf: 3.64-3.69 ms/call, x4.19-4.47, result 100000
10^5 reads of o.getX()
  class: 0.120-0.123 ms/call, x1.00-1.00, result 4999950000
  Object.create: 0.120-0.120 ms/call, x0.97-1.00, result 4999950000
  __proto__ literal: 0.119-0.122 ms/call, x0.97-1.02, result 4999950000
  Object.setPrototypeOf: 0.119-0.120 ms/call, x0.97-1.00, result 4999950000
```

JSC-mac:

```text
creating 10^5 objects
  class: 0.335-0.357 ms/call, x1.00-1.00, result 100000
  Object.create: 0.378-0.386 ms/call, x1.08-1.13, result 100000
  __proto__ literal: 1.57-1.60 ms/call, x4.41-4.69, result 100000
  Object.setPrototypeOf: 2.12-2.21 ms/call, x5.99-6.61, result 100000
10^5 reads of o.getX()
  class: 0.0932-0.0945 ms/call, x1.00-1.00, result 4999950000
  Object.create: 0.0945-0.0947 ms/call, x1.00-1.01, result 4999950000
  __proto__ literal: 0.0934-0.0935 ms/call, x0.99-1.00, result 4999950000
  Object.setPrototypeOf: 0.0932-0.0934 ms/call, x0.99-1.00, result 4999950000
```

JSC-bun:

```text
creating 10^5 objects
  class: 0.498-0.517 ms/call, x1.00-1.00, result 100000
  Object.create: 0.739-0.844 ms/call, x1.43-1.63, result 100000
  __proto__ literal: 1.84-1.94 ms/call, x3.56-3.76, result 100000
  Object.setPrototypeOf: 2.45-2.67 ms/call, x4.75-5.16, result 100000
10^5 reads of o.getX()
  class: 0.0953-0.0957 ms/call, x1.00-1.00, result 4999950000
  Object.create: 0.0971-0.0994 ms/call, x1.02-1.04, result 4999950000
  __proto__ literal: 0.0952-0.0952 ms/call, x0.99-1.00, result 4999950000
  Object.setPrototypeOf: 0.0952-0.0965 ms/call, x1.00-1.01, result 4999950000
```

JSC-page:

```text
creating 10^5 objects
  class: 0.332-0.344 ms/call, x1.00-1.00, result 100000
  Object.create: 0.389-0.464 ms/call, x1.17-1.35, result 100000
  __proto__ literal: 1.79-1.80 ms/call, x5.21-5.42, result 100000
  Object.setPrototypeOf: 2.38-2.45 ms/call, x6.92-7.38, result 100000
10^5 reads of o.getX()
  class: 0.0937-0.0937 ms/call, x1.00-1.00, result 4999950000
  Object.create: 0.0944-0.0952 ms/call, x1.01-1.02, result 4999950000
  __proto__ literal: 0.0937-0.0953 ms/call, x1.00-1.02, result 4999950000
  Object.setPrototypeOf: 0.0934-0.0942 ms/call, x1.00-1.01, result 4999950000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-O5: 10^5 objects per call created with a class, Object.create, a __proto__ literal or Object.setPrototypeOf; then reading them.
class Point { constructor(x) { this.x = x; } getX() { return this.x; } }
const proto = { getX() { return this.x; } };
const ways = {
  class: (i) => new Point(i),
  'Object.create': (i) => { const o = Object.create(proto); o.x = i; return o; },
  '__proto__ literal': (i) => ({ __proto__: proto, x: i }),
  'Object.setPrototypeOf': (i) => Object.setPrototypeOf({ x: i }, proto),
};
const make = (f) => { const a = new Array(1e5); for (let i = 0; i < 1e5; i++) a[i] = f(i); return a; };
// Each way gets its own generated creation loop (its own comment, so its own call site and feedback).
const creator = (f, tag) => new Function('f', '/* ' + tag + ' */ const a = new Array(1e5); for (let i = 0; i < 1e5; i++) a[i] = f(i); return a;').bind(null, f);
const C = {}, Rd = {}, arrs = {};
for (const k in ways) { C[k] = ((c) => () => c().length)(creator(ways[k], k)); arrs[k] = make(ways[k]); }
// Each generated reader gets its own comment: in this lab, readers with identical source text shared their feedback on V8.
const readers = Object.keys(ways).map((k) => new Function('a', '/* ' + k + ' */ let s = 0; for (let i = 0; i < a.length; i++) s += a[i].getX(); return s;'));
Object.keys(ways).forEach((k, j) => { Rd[k] = () => readers[j](arrs[k]); });
R('creating 10^5 objects', C);
R('10^5 reads of o.getX()', Rd);
```
</details>

### 4.5 `JE-O6`: writes to built-in prototypes

`a.slice()`, `a.map(f)` and `[...a]` on a 10⁴-element array, timed (best of three 200 ms passes, after four 200 ms warm-up passes of each operation) before and after one write: `Array.prototype.constructor = Array` (the same value), a wrapper on `Array.prototype[Symbol.iterator]`, or `Object.prototype[0] = 'x'`. Each write has its own process, and a fourth process makes no write (the control). The "before" figures are still less warmed than the "after" ones on V8 and SpiderMonkey (in the control, `a.map(f)` got 6 times faster on V8-node and 3 times on V8-chrome, and `a.slice()` 4 times on SM-firefox, with no write at all), so the table divides each write's "after" by the control's "after" of the same run number; three runs ✅[^lab]:

| Write → operation | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| `constructor` → `a.slice()` | ×108 to 110 | ×205 to 217 | ×1.01 to 1.02 | ×11.3 | ×10.3 to 10.9 | ×10.6 to 10.8 |
| `constructor` → `a.map(f)` | ×24.1 to 24.8 | ×12.3 to 12.5 | ×0.98 to 1.00 | ×1.12 to 1.13 | ×0.95 to 1.10 | ×1.27 |
| `Symbol.iterator` → `[...a]` | ×69.5 to 69.8 | ×148 to 150 | ×0.97 to 1.02 | ×4.5 to 4.6 | ×3.6 to 3.9 | ×4.2 to 4.4 |
| `Object.prototype[0]` → `a.slice()` | ×242 to 244 | ×0.99 to 1.05 | ×1.00 to 1.01 | ×11.3 | ×10.3 to 11.0 | ×10.6 |
| `Object.prototype[0]` → `a.map(f)` | ×51.1 to 51.6 | ×26.2 | ×0.98 to 1.15 | ×0.64 | ×0.72 to 0.74 | ×0.77 |
| `Object.prototype[0]` → `[...a]` | ×69.3 to 69.9 | ×148 to 150 | ×0.97 to 1.02 | ×4.3 to 4.9 | ×3.7 to 3.8 | ×4.2 to 4.3 |

The control's "after" times, ms per call: `a.slice()` 0.0023 (V8-node), 0.0010 to 0.0011 (V8-chrome), 0.0013 (SM-firefox), 0.0044 (JSC-mac), 0.0051 to 0.0055 (JSC-bun), 0.0041 (JSC-page). The largest slowdown on V8-node was `Object.prototype[0] = 'x'` → `a.slice()`: 0.55 ms against 0.0023 ms per call, 242 to 244 times. The same write left `a.slice()` unchanged in Chrome and slowed `a.map(f)` there 26 times; in Chrome the largest was the `constructor` write on `a.slice()` (205 to 217 times). On V8 each write slowed some built-ins by 12 to 243 times for the rest of the process; on JavaScriptCore by 3.6 to 11 times (and `a.map(f)` became 1.3 to 1.6 times faster after `Object.prototype[0]`, the one gain). On SpiderMonkey none of the three writes changed any of the three operations: 17 of the 18 ratios were 0.97 to 1.02, and the 18th (1.15) was one run of `a.map(f)` after the `Object.prototype[0]` write (0.0457 ms against 0.0397 to 0.0407 ms in the control). For browser code: never write to a built-in prototype; it costs in Chrome and in Safari's engine, and gains nothing in Firefox.

<details><summary>Lab: <code>patch-none.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
patch none: a.slice() 0.00332 -> 0.00225 ms/call (best of 3), x0.68
patch none: a.map(f) 0.0668 -> 0.0112 ms/call (best of 3), x0.17
patch none: [...a] 0.00227 -> 0.00225 ms/call (best of 3), x0.99
```

V8-chrome:

```text
patch none: a.slice() 0.00139 -> 0.00103 ms/call (best of 3), x0.74
patch none: a.map(f) 0.0627 -> 0.0188 ms/call (best of 3), x0.30
patch none: [...a] 0.00108 -> 0.00107 ms/call (best of 3), x0.99
```

SM-firefox:

```text
patch none: a.slice() 0.00493 -> 0.00128 ms/call (best of 3), x0.26
patch none: a.map(f) 0.0399 -> 0.0397 ms/call (best of 3), x1.00
patch none: [...a] 0.0353 -> 0.0353 ms/call (best of 3), x1.00
```

JSC-mac:

```text
patch none: a.slice() 0.00437 -> 0.00439 ms/call (best of 3), x1.00
patch none: a.map(f) 0.0139 -> 0.0139 ms/call (best of 3), x1.00
patch none: [...a] 0.00713 -> 0.00716 ms/call (best of 3), x1.00
```

JSC-bun:

```text
patch none: a.slice() 0.00482 -> 0.00508 ms/call (best of 3), x1.05
patch none: a.map(f) 0.0153 -> 0.0155 ms/call (best of 3), x1.01
patch none: [...a] 0.00834 -> 0.00882 ms/call (best of 3), x1.06
```

JSC-page:

```text
patch none: a.slice() 0.00404 -> 0.00411 ms/call (best of 3), x1.02
patch none: a.map(f) 0.0130 -> 0.0143 ms/call (best of 3), x1.11
patch none: [...a] 0.00718 -> 0.00721 ms/call (best of 3), x1.00
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-O6: a.slice(), a.map(f) and [...a] on a 10^4-element array, timed before and after one write to a built-in prototype.
const patch = 'none';
const a = Array.from({ length: 1e4 }, (_, i) => i);
const ops = { 'a.slice()': () => a.slice().length, 'a.map(f)': () => a.map((x) => x + 1).length, '[...a]': () => [...a].length };
const warm = (f) => { for (let i = 0; i < 4; i++) B(f); };  // 4 x 200 ms, so every operation is in its steady state before it is timed
const before = {}; for (const k of Object.keys(ops)) { warm(ops[k]); before[k] = Math.min(B(ops[k]), B(ops[k]), B(ops[k])); }
if (patch === 'species') Array.prototype.constructor = Array; // the same value, still a write
if (patch === 'iterator') { const it = Array.prototype[Symbol.iterator]; Array.prototype[Symbol.iterator] = function () { return it.call(this); }; }
if (patch === 'elements') Object.prototype[0] = 'x';
for (const k of Object.keys(ops)) { warm(ops[k]); const after = Math.min(B(ops[k]), B(ops[k]), B(ops[k])); console.log(`patch ${patch}: ${k} ${before[k].toPrecision(3)} -> ${after.toPrecision(3)} ms/call (best of 3), x${(after / before[k]).toFixed(2)}`); }
```
</details>

<details><summary>Lab: <code>patch-species.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
patch species: a.slice() 0.00322 -> 0.247 ms/call (best of 3), x76.69
patch species: a.map(f) 0.0658 -> 0.270 ms/call (best of 3), x4.10
patch species: [...a] 0.00227 -> 0.00226 ms/call (best of 3), x1.00
```

V8-chrome:

```text
patch species: a.slice() 0.00139 -> 0.224 ms/call (best of 3), x160.86
patch species: a.map(f) 0.0624 -> 0.234 ms/call (best of 3), x3.75
patch species: [...a] 0.00109 -> 0.00107 ms/call (best of 3), x0.99
```

SM-firefox:

```text
patch species: a.slice() 0.00557 -> 0.00130 ms/call (best of 3), x0.23
patch species: a.map(f) 0.0400 -> 0.0395 ms/call (best of 3), x0.99
patch species: [...a] 0.0356 -> 0.0353 ms/call (best of 3), x0.99
```

JSC-mac:

```text
patch species: a.slice() 0.00438 -> 0.0496 ms/call (best of 3), x11.32
patch species: a.map(f) 0.0139 -> 0.0156 ms/call (best of 3), x1.12
patch species: [...a] 0.00714 -> 0.00719 ms/call (best of 3), x1.01
```

JSC-bun:

```text
patch species: a.slice() 0.00513 -> 0.0555 ms/call (best of 3), x10.82
patch species: a.map(f) 0.0154 -> 0.0147 ms/call (best of 3), x0.96
patch species: [...a] 0.00900 -> 0.00879 ms/call (best of 3), x0.98
```

JSC-page:

```text
patch species: a.slice() 0.00404 -> 0.0435 ms/call (best of 3), x10.76
patch species: a.map(f) 0.0130 -> 0.0181 ms/call (best of 3), x1.39
patch species: [...a] 0.00719 -> 0.00721 ms/call (best of 3), x1.00
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-O6: a.slice(), a.map(f) and [...a] on a 10^4-element array, timed before and after one write to a built-in prototype.
const patch = 'species';
const a = Array.from({ length: 1e4 }, (_, i) => i);
const ops = { 'a.slice()': () => a.slice().length, 'a.map(f)': () => a.map((x) => x + 1).length, '[...a]': () => [...a].length };
const warm = (f) => { for (let i = 0; i < 4; i++) B(f); };  // 4 x 200 ms, so every operation is in its steady state before it is timed
const before = {}; for (const k of Object.keys(ops)) { warm(ops[k]); before[k] = Math.min(B(ops[k]), B(ops[k]), B(ops[k])); }
if (patch === 'species') Array.prototype.constructor = Array; // the same value, still a write
if (patch === 'iterator') { const it = Array.prototype[Symbol.iterator]; Array.prototype[Symbol.iterator] = function () { return it.call(this); }; }
if (patch === 'elements') Object.prototype[0] = 'x';
for (const k of Object.keys(ops)) { warm(ops[k]); const after = Math.min(B(ops[k]), B(ops[k]), B(ops[k])); console.log(`patch ${patch}: ${k} ${before[k].toPrecision(3)} -> ${after.toPrecision(3)} ms/call (best of 3), x${(after / before[k]).toFixed(2)}`); }
```
</details>

<details><summary>Lab: <code>patch-iterator.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
patch iterator: a.slice() 0.00323 -> 0.00225 ms/call (best of 3), x0.70
patch iterator: a.map(f) 0.0663 -> 0.0111 ms/call (best of 3), x0.17
patch iterator: [...a] 0.00225 -> 0.157 ms/call (best of 3), x69.73
```

V8-chrome:

```text
patch iterator: a.slice() 0.00138 -> 0.00107 ms/call (best of 3), x0.78
patch iterator: a.map(f) 0.0626 -> 0.0188 ms/call (best of 3), x0.30
patch iterator: [...a] 0.00108 -> 0.160 ms/call (best of 3), x147.99
```

SM-firefox:

```text
patch iterator: a.slice() 0.00581 -> 0.00128 ms/call (best of 3), x0.22
patch iterator: a.map(f) 0.0459 -> 0.0457 ms/call (best of 3), x1.00
patch iterator: [...a] 0.0358 -> 0.0359 ms/call (best of 3), x1.00
```

JSC-mac:

```text
patch iterator: a.slice() 0.00440 -> 0.00439 ms/call (best of 3), x1.00
patch iterator: a.map(f) 0.0146 -> 0.0137 ms/call (best of 3), x0.94
patch iterator: [...a] 0.00717 -> 0.0331 ms/call (best of 3), x4.61
```

JSC-bun:

```text
patch iterator: a.slice() 0.00506 -> 0.00534 ms/call (best of 3), x1.06
patch iterator: a.map(f) 0.0153 -> 0.0154 ms/call (best of 3), x1.00
patch iterator: [...a] 0.00867 -> 0.0340 ms/call (best of 3), x3.92
```

JSC-page:

```text
patch iterator: a.slice() 0.00403 -> 0.00404 ms/call (best of 3), x1.00
patch iterator: a.map(f) 0.0133 -> 0.0146 ms/call (best of 3), x1.10
patch iterator: [...a] 0.00721 -> 0.0299 ms/call (best of 3), x4.15
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-O6: a.slice(), a.map(f) and [...a] on a 10^4-element array, timed before and after one write to a built-in prototype.
const patch = 'iterator';
const a = Array.from({ length: 1e4 }, (_, i) => i);
const ops = { 'a.slice()': () => a.slice().length, 'a.map(f)': () => a.map((x) => x + 1).length, '[...a]': () => [...a].length };
const warm = (f) => { for (let i = 0; i < 4; i++) B(f); };  // 4 x 200 ms, so every operation is in its steady state before it is timed
const before = {}; for (const k of Object.keys(ops)) { warm(ops[k]); before[k] = Math.min(B(ops[k]), B(ops[k]), B(ops[k])); }
if (patch === 'species') Array.prototype.constructor = Array; // the same value, still a write
if (patch === 'iterator') { const it = Array.prototype[Symbol.iterator]; Array.prototype[Symbol.iterator] = function () { return it.call(this); }; }
if (patch === 'elements') Object.prototype[0] = 'x';
for (const k of Object.keys(ops)) { warm(ops[k]); const after = Math.min(B(ops[k]), B(ops[k]), B(ops[k])); console.log(`patch ${patch}: ${k} ${before[k].toPrecision(3)} -> ${after.toPrecision(3)} ms/call (best of 3), x${(after / before[k]).toFixed(2)}`); }
```
</details>

<details><summary>Lab: <code>patch-elements.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
patch elements: a.slice() 0.00325 -> 0.550 ms/call (best of 3), x169.24
patch elements: a.map(f) 0.0662 -> 0.574 ms/call (best of 3), x8.68
patch elements: [...a] 0.00226 -> 0.156 ms/call (best of 3), x69.35
```

V8-chrome:

```text
patch elements: a.slice() 0.00138 -> 0.00108 ms/call (best of 3), x0.78
patch elements: a.map(f) 0.0628 -> 0.493 ms/call (best of 3), x7.86
patch elements: [...a] 0.00109 -> 0.159 ms/call (best of 3), x146.50
```

SM-firefox:

```text
patch elements: a.slice() 0.00492 -> 0.00129 ms/call (best of 3), x0.26
patch elements: a.map(f) 0.0459 -> 0.0457 ms/call (best of 3), x0.99
patch elements: [...a] 0.0358 -> 0.0359 ms/call (best of 3), x1.00
```

JSC-mac:

```text
patch elements: a.slice() 0.00441 -> 0.0496 ms/call (best of 3), x11.25
patch elements: a.map(f) 0.0139 -> 0.00884 ms/call (best of 3), x0.63
patch elements: [...a] 0.00718 -> 0.0333 ms/call (best of 3), x4.65
```

JSC-bun:

```text
patch elements: a.slice() 0.00481 -> 0.0559 ms/call (best of 3), x11.62
patch elements: a.map(f) 0.0155 -> 0.0114 ms/call (best of 3), x0.74
patch elements: [...a] 0.00895 -> 0.0335 ms/call (best of 3), x3.75
```

JSC-page:

```text
patch elements: a.slice() 0.00405 -> 0.0434 ms/call (best of 3), x10.72
patch elements: a.map(f) 0.0130 -> 0.0110 ms/call (best of 3), x0.85
patch elements: [...a] 0.00718 -> 0.0310 ms/call (best of 3), x4.32
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-O6: a.slice(), a.map(f) and [...a] on a 10^4-element array, timed before and after one write to a built-in prototype.
const patch = 'elements';
const a = Array.from({ length: 1e4 }, (_, i) => i);
const ops = { 'a.slice()': () => a.slice().length, 'a.map(f)': () => a.map((x) => x + 1).length, '[...a]': () => [...a].length };
const warm = (f) => { for (let i = 0; i < 4; i++) B(f); };  // 4 x 200 ms, so every operation is in its steady state before it is timed
const before = {}; for (const k of Object.keys(ops)) { warm(ops[k]); before[k] = Math.min(B(ops[k]), B(ops[k]), B(ops[k])); }
if (patch === 'species') Array.prototype.constructor = Array; // the same value, still a write
if (patch === 'iterator') { const it = Array.prototype[Symbol.iterator]; Array.prototype[Symbol.iterator] = function () { return it.call(this); }; }
if (patch === 'elements') Object.prototype[0] = 'x';
for (const k of Object.keys(ops)) { warm(ops[k]); const after = Math.min(B(ops[k]), B(ops[k]), B(ops[k])); console.log(`patch ${patch}: ${k} ${before[k].toPrecision(3)} -> ${after.toPrecision(3)} ms/call (best of 3), x${(after / before[k]).toFixed(2)}`); }
```
</details>

### 4.6 `JE-N5`: a holey label with no real holes

Sum of 10⁶ small integers from an array built with `push` (packed) and from `new Array(n)` filled by index (V8 labels it holey; no hole is left) ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| packed, ms | 0.73 to 0.74 | 0.82 to 0.86 | 0.68 to 0.72 | 0.49 | 0.48 to 0.49 | 0.49 |
| `new Array(n)` by index | ×1.12 to 1.13 | ×0.99 to 1.06 | ×0.94 to 1.01 | ×1.00 to 1.01 | ×1.00 to 1.01 | ×1.00 |

At most 13 % slower on the lowest times (V8-node; up to 21 % in a single round, and 4 to 15 % in single Chrome rounds), and the same time on the other four. For browser code: keep `new Array(n)` filled by index; there is nothing to gain by rewriting it.

<details><summary>Lab: <code>holey.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
sum of 10^6 elements
  packed: 0.737-0.750 ms/call, x1.00-1.00, result 511370976
  new Array(n) by index: 0.827-0.911 ms/call, x1.12-1.22, result 511370976
```

V8-chrome:

```text
sum of 10^6 elements
  packed: 0.864-1.07 ms/call, x1.00-1.00, result 511370976
  new Array(n) by index: 0.859-1.21 ms/call, x0.99-1.13, result 511370976
```

SM-firefox:

```text
sum of 10^6 elements
  packed: 0.683-0.741 ms/call, x1.00-1.00, result 511370976
  new Array(n) by index: 0.691-0.864 ms/call, x0.99-1.17, result 511370976
```

JSC-mac:

```text
sum of 10^6 elements
  packed: 0.485-0.486 ms/call, x1.00-1.00, result 511370976
  new Array(n) by index: 0.485-0.976 ms/call, x1.00-2.01, result 511370976
```

JSC-bun:

```text
sum of 10^6 elements
  packed: 0.485-0.518 ms/call, x1.00-1.00, result 511370976
  new Array(n) by index: 0.484-0.516 ms/call, x0.97-1.00, result 511370976
```

JSC-page:

```text
sum of 10^6 elements
  packed: 0.485-0.495 ms/call, x1.00-1.00, result 511370976
  new Array(n) by index: 0.485-0.487 ms/call, x0.98-1.00, result 511370976
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-N5: summing 10^6 small integers: an array built by push (packed) against new Array(n) filled by index (holey label, no holes).
const N = 1e6, packed = [], holey = new Array(N);
for (let i = 0; i < N; i++) { packed.push(i & 1023); holey[i] = i & 1023; }
function sumP(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function sumH(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
R('sum of 10^6 elements', { packed: () => sumP(packed), 'new Array(n) by index': () => sumH(holey) });
```
</details>

### 4.7 `JE-N6`: `push` against `new Array(n)`

Building an array of 10⁶ numbers (`i * 0.5`) with `push` onto `[]`, against `new Array(n)` written by index; the ratio is preallocated to `push` ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| `push` onto `[]`, ms | 4.77 to 5.00 | 1.90 to 1.92 | 2.70 to 3.12 | 2.92 to 2.94 | 3.30 to 3.53 | 3.08 to 3.23 |
| `new Array(n)` by index | ×0.28 to 0.33 | ×0.42 to 0.44 | ×0.98 to 1.06 | ×0.22 | ×0.15 to 0.16 | ×0.20 to 0.21 |

Preallocating was 2.3 to 3.6 times faster on V8 and 4.5 to 6.7 times on JavaScriptCore, and made no difference on SpiderMonkey. For browser code: when the length is known, `new Array(n)` helps in Chrome and JavaScriptCore and costs nothing in Firefox.

<details><summary>Lab: <code>prealloc.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
build 10^6 elements
  push onto []: 4.89-5.55 ms/call, x1.00-1.00, result 1000000
  new Array(n) by index: 1.50-2.32 ms/call, x0.31-0.42, result 1000000
```

V8-chrome:

```text
build 10^6 elements
  push onto []: 1.92-2.04 ms/call, x1.00-1.00, result 1000000
  new Array(n) by index: 0.803-0.826 ms/call, x0.39-0.42, result 1000000
```

SM-firefox:

```text
build 10^6 elements
  push onto []: 3.12-3.79 ms/call, x1.00-1.00, result 1000000
  new Array(n) by index: 3.16-5.04 ms/call, x1.01-1.60, result 1000000
```

JSC-mac:

```text
build 10^6 elements
  push onto []: 2.93-3.00 ms/call, x1.00-1.00, result 1000000
  new Array(n) by index: 0.654-0.728 ms/call, x0.22-0.25, result 1000000
```

JSC-bun:

```text
build 10^6 elements
  push onto []: 3.53-4.70 ms/call, x1.00-1.00, result 1000000
  new Array(n) by index: 0.534-0.599 ms/call, x0.12-0.15, result 1000000
```

JSC-page:

```text
build 10^6 elements
  push onto []: 3.08-3.24 ms/call, x1.00-1.00, result 1000000
  new Array(n) by index: 0.660-0.671 ms/call, x0.21-0.21, result 1000000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-N6: building an array of 10^6 numbers with push onto [] against new Array(n) written by index.
const N = 1e6;
function viaPush() { const a = []; for (let i = 0; i < N; i++) a.push(i * 0.5); return a.length; }
function viaPrealloc() { const a = new Array(N); for (let i = 0; i < N; i++) a[i] = i * 0.5; return a.length; }
R('build 10^6 elements', { 'push onto []': viaPush, 'new Array(n) by index': viaPrealloc });
```
</details>

### 4.8 `JE-N7`: a sparse array against a `Map`

10⁴ ids with gaps of 1,024 (the largest about 10⁷), written into `[]` by `a[id] = v` or into a `Map`, then all read back; the ratio is array to `Map` ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| write, `Map`, ms | 0.39 to 0.40 | 0.25 to 0.26 | 0.25 to 0.29 | 0.15 to 0.16 | 0.13 to 0.16 | 0.13 to 0.14 |
| write, sparse array | ×2.81 to 3.04 | ×2.28 to 2.33 | ×1.79 to 1.92 | ×3.10 to 3.33 | ×2.76 to 3.20 | ×3.25 to 3.41 |
| read, `Map`, ms | 0.12 to 0.18 | 0.098 to 0.106 | 0.115 to 0.116 | 0.052 | 0.036 to 0.037 | 0.039 to 0.041 |
| read, sparse array | ×1.35 to 2.00 | ×1.09 to 1.13 | ×1.41 to 1.48 | ×2.23 to 2.24 | ×1.84 to 1.91 | ×2.67 to 2.85 |

The `Map` was faster to fill on every engine (1.8 to 3.4 times) and faster to read on every engine, by 1.1 times in Chrome, 1.4 to 1.5 in Firefox and 1.8 to 2.9 on JavaScriptCore. For browser code: keep sparse ids in a `Map`.

<details><summary>Lab: <code>sparse.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
write 10^4 sparse ids
  Map: 0.390-0.402 ms/call, x1.00-1.00, result 10000
  array: 1.14-1.34 ms/call, x2.88-3.33, result 10238984
read 10^4 sparse ids
  Map: 0.176-0.406 ms/call, x1.00-1.00, result 35000
  array: 0.237-0.583 ms/call, x0.58-3.31, result 35000
```

V8-chrome:

```text
write 10^4 sparse ids
  Map: 0.245-0.266 ms/call, x1.00-1.00, result 10000
  array: 0.570-0.846 ms/call, x2.17-3.45, result 10238984
read 10^4 sparse ids
  Map: 0.0983-0.0996 ms/call, x1.00-1.00, result 35000
  array: 0.111-0.112 ms/call, x1.11-1.14, result 35000
```

SM-firefox:

```text
write 10^4 sparse ids
  Map: 0.268-0.285 ms/call, x1.00-1.00, result 10000
  array: 0.492-0.929 ms/call, x1.76-3.46, result 10238984
read 10^4 sparse ids
  Map: 0.115-0.519 ms/call, x1.00-1.00, result 35000
  array: 0.170-0.218 ms/call, x0.42-1.47, result 35000
```

JSC-mac:

```text
write 10^4 sparse ids
  Map: 0.146-0.156 ms/call, x1.00-1.00, result 10000
  array: 0.463-0.498 ms/call, x3.18-3.18, result 10238984
read 10^4 sparse ids
  Map: 0.0517-0.0525 ms/call, x1.00-1.00, result 35000
  array: 0.116-0.162 ms/call, x2.22-3.15, result 35000
```

JSC-bun:

```text
write 10^4 sparse ids
  Map: 0.159-0.480 ms/call, x1.00-1.00, result 10000
  array: 0.439-2.96 ms/call, x2.76-6.18, result 10238984
read 10^4 sparse ids
  Map: 0.0372-0.0381 ms/call, x1.00-1.00, result 35000
  array: 0.0683-0.0726 ms/call, x1.79-1.94, result 35000
```

JSC-page:

```text
write 10^4 sparse ids
  Map: 0.130-0.132 ms/call, x1.00-1.00, result 10000
  array: 0.423-0.450 ms/call, x3.26-3.41, result 10238984
read 10^4 sparse ids
  Map: 0.0405-0.0410 ms/call, x1.00-1.00, result 35000
  array: 0.108-0.125 ms/call, x2.66-3.06, result 35000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-N7: 10^4 ids with gaps of 1,024 (largest id about 10^7) kept in an array (a[id] = v) against a Map.
const ids = Array.from({ length: 1e4 }, (_, i) => i * 1024 + (i & 7));
function writeA() { const a = []; for (const id of ids) a[id] = id & 255; return a.length; }
function writeM() { const m = new Map(); for (const id of ids) m.set(id, id & 255); return m.size; }
const A = []; for (const id of ids) A[id] = id & 255;
const M = new Map(); for (const id of ids) M.set(id, id & 255);
function readA() { let s = 0; for (const id of ids) s += A[id]; return s; }
function readM() { let s = 0; for (const id of ids) s += M.get(id); return s; }
R('write 10^4 sparse ids', { Map: writeM, array: writeA });
R('read 10^4 sparse ids', { Map: readM, array: readA });
```
</details>

### 4.9 `JE-N8`: `for…in` over an array

Sum of a 10⁵-element array with an index `for`, `for…of` and `for…in` ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| index `for`, ms | 0.049 | 0.068 to 0.069 | 0.068 to 0.069 | 0.049 to 0.050 | 0.048 to 0.049 | 0.048 to 0.050 |
| `for…of` | ×1.21 to 1.47 | ×0.96 | ×3.92 to 3.97 | ×2.43 to 2.45 | ×1.23 to 1.26 | ×1.20 to 1.23 |
| `for…in` | ×55 to 56 | ×31 | ×25 to 27 | ×79 to 81 | ×82 | ×108 to 112 |

`for…in` was 25 to 112 times slower than an index loop on every engine (ratio of lowest times; single rounds ranged from 23 to 133). `for…of` was as fast as the index loop in Chrome, 1.2 to 1.5 times slower in Node.js, Bun and the WebKit page, 2.4 times in the JavaScriptCore shell and 3.9 to 4.0 times in Firefox. For browser code: never `for…in` over an array; in a hot loop over a large array, the index `for` is the one form that is fastest on all three engines.

<details><summary>Lab: <code>forin.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
sum of 10^5 elements
  index for: 0.0493-0.0508 ms/call, x1.00-1.00, result 51031728
  for...of: 0.0613-0.0655 ms/call, x1.22-1.33, result 51031728
  for...in: 2.75-2.92 ms/call, x55.87-59.01, result 51031728
```

V8-chrome:

```text
sum of 10^5 elements
  index for: 0.0681-0.0691 ms/call, x1.00-1.00, result 51031728
  for...of: 0.0656-0.0658 ms/call, x0.95-0.97, result 51031728
  for...in: 2.12-2.43 ms/call, x31.11-35.22, result 51031728
```

SM-firefox:

```text
sum of 10^5 elements
  index for: 0.0692-0.105 ms/call, x1.00-1.00, result 51031728
  for...of: 0.275-0.295 ms/call, x2.61-4.27, result 51031728
  for...in: 1.74-4.26 ms/call, x16.97-56.78, result 51031728
```

JSC-mac:

```text
sum of 10^5 elements
  index for: 0.0503-0.0860 ms/call, x1.00-1.00, result 51031728
  for...of: 0.122-0.162 ms/call, x1.44-3.22, result 51031728
  for...in: 3.96-13.2 ms/call, x47.81-261.80, result 51031728
```

JSC-bun:

```text
sum of 10^5 elements
  index for: 0.0483-0.0493 ms/call, x1.00-1.00, result 51031728
  for...of: 0.0609-0.0631 ms/call, x1.24-1.31, result 51031728
  for...in: 3.96-4.18 ms/call, x80.25-85.49, result 51031728
```

JSC-page:

```text
sum of 10^5 elements
  index for: 0.0484-0.0500 ms/call, x1.00-1.00, result 51031728
  for...of: 0.0596-0.0600 ms/call, x1.20-1.23, result 51031728
  for...in: 5.29-5.51 ms/call, x107.81-113.52, result 51031728
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-N8: summing a 10^5-element array with for...in, an index for and for...of.
const a = Array.from({ length: 1e5 }, (_, i) => i & 1023);
function viaFor() { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function viaOf() { let s = 0; for (const v of a) s += v; return s; }
function viaIn() { let s = 0; for (const k in a) s += a[k]; return s; }
R('sum of 10^5 elements', { 'index for': viaFor, 'for...of': viaOf, 'for...in': viaIn });
```
</details>

### 4.10 `JE-N1`, `JE-N9`, `JE-N10`, `JE-S1`, `JE-S2`, `JE-S9`: bytes per element

Heap growth per element after a forced full collection, with every result kept alive to the end; arrays of 10⁶ elements, `Map`, `Set` and object tables of 10⁵ entries. The same in all three runs, except one JSC-mac run (below) ✅[^lab]. SpiderMonkey and the WebKit page have no heap figure, so this line is not measurable there.

| Bytes per element | V8-node | V8-chrome | JSC-mac | JSC-bun |
|---|---|---|---|---|
| array, small integers | 8.0 | 4.0 | 8.0 | 8.0 |
| array, integers just below 2³⁰ | 8.0 | 4.0 | 8.0 | 8.0 |
| array, integers just below 2³¹ | 8.0 | 8.0 | 8.0 | 8.0 |
| array, doubles | 8.0 | 8.0 | 8.0 | 8.0 |
| `{ x, y }` small integers, with its array slot | 48.0 | 24.0 | 40.0 | 40.0 |
| `{ x }` small integer, with its slot | 40.0 | 20.0 | 40.0 | 40.0 |
| `{ x }` integer just below 2³¹, with its slot | 40.0 | 32.0 | 40.0 | 40.0 |
| `{ x }` double, with its slot | 56.0 | 32.0 | 40.0 | 40.0 |
| `Map` entry, integer key and value | 36.8 to 36.9 | 18.4 | 84.0 (125.9 in one run) | 68.2 |
| `Set` entry, integer | 26.3 to 26.5 | 13.1 | 63.0 | 52.5 |
| `Map` entry, string key | 36.7 | 18.4 | 69.7 to 69.8 | 53.6 to 54.0 |
| object as a table, string key | 62.9 | 31.5 | 38.1 | 38.1 |
| `Int32Array` | 4.0 | 4.0 | 4.0 | 4.1 |
| `Float64Array` | 8.0 | 8.0 | 8.0 | 8.0 |

JavaScriptCore showed none of V8's steps: an array element took 8 bytes whatever the number, and a one-field object took 40 bytes whether the field held a small integer, an integer near 2³¹ or a double. V8 in Chrome (4-byte slots) had both steps: 4 against 8 bytes in arrays at 2³⁰, and 20 against 32 bytes for a `{ x }` object at 2³⁰ and for a double. Collections went the other way: on JavaScriptCore a `Map` entry took 53 to 210 bytes and a `Set` entry 53 to 63, against V8-node's 37 and 26, while an object used as a table took 38 bytes, less than its `Map` (V8-node: 63 against 37). The `Map` figures on JavaScriptCore are not stable (see the size check below), so treat them as "more than V8's, and varying with the count". For browser code: typed arrays and dense arrays are the compact choice on every engine; the 2³⁰ step and the boxed double field are V8's; and on JavaScriptCore a `Map` or `Set` costs more memory than an object table, so pick it for its behaviour, not to save bytes.

<details><summary>Lab: <code>bytes.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
array, small integers: 8.0 bytes per element (n = 1000000, kept 1000000)
array, integers 2^30-1024..2^30-1: 8.0 bytes per element (n = 1000000, kept 1000000)
array, integers 2^31-1024..2^31-1: 8.0 bytes per element (n = 1000000, kept 1000000)
array, doubles: 8.0 bytes per element (n = 1000000, kept 1000000)
{ x, y } small integers, with its array slot: 48.0 bytes per element (n = 1000000, kept 1000000)
{ x } small integer, with its slot: 40.0 bytes per element (n = 1000000, kept 1000000)
{ x } integer 2^30..2^31-1, with its slot: 40.0 bytes per element (n = 1000000, kept 1000000)
{ x } double, with its slot: 56.0 bytes per element (n = 1000000, kept 1000000)
Map entry, integer key and value: 36.9 bytes per element (n = 100000, kept 100000)
Set entry, integer: 26.4 bytes per element (n = 100000, kept 100000)
Map entry, string key (keys made before): 36.7 bytes per element (n = 100000, kept 100000)
object as table, string key (keys made before): 62.9 bytes per element (n = 100000, kept 100000)
Int32Array: 4.0 bytes per element (n = 1000000, kept 1000000)
Float64Array: 8.0 bytes per element (n = 1000000, kept 1000000)
```

V8-chrome:

```text
array, small integers: 4.0 bytes per element (n = 1000000, kept 1000000)
array, integers 2^30-1024..2^30-1: 4.0 bytes per element (n = 1000000, kept 1000000)
array, integers 2^31-1024..2^31-1: 8.0 bytes per element (n = 1000000, kept 1000000)
array, doubles: 8.0 bytes per element (n = 1000000, kept 1000000)
{ x, y } small integers, with its array slot: 24.0 bytes per element (n = 1000000, kept 1000000)
{ x } small integer, with its slot: 20.0 bytes per element (n = 1000000, kept 1000000)
{ x } integer 2^30..2^31-1, with its slot: 32.0 bytes per element (n = 1000000, kept 1000000)
{ x } double, with its slot: 32.0 bytes per element (n = 1000000, kept 1000000)
Map entry, integer key and value: 18.4 bytes per element (n = 100000, kept 100000)
Set entry, integer: 13.1 bytes per element (n = 100000, kept 100000)
Map entry, string key (keys made before): 18.4 bytes per element (n = 100000, kept 100000)
object as table, string key (keys made before): 31.5 bytes per element (n = 100000, kept 100000)
Int32Array: 4.0 bytes per element (n = 1000000, kept 1000000)
Float64Array: 8.0 bytes per element (n = 1000000, kept 1000000)
```

SM-firefox, JSC-page (identical output):

```text
no forced GC or heap figure in this environment
```

JSC-mac:

```text
array, small integers: 8.0 bytes per element (n = 1000000, kept 1000000)
array, integers 2^30-1024..2^30-1: 8.0 bytes per element (n = 1000000, kept 1000000)
array, integers 2^31-1024..2^31-1: 8.0 bytes per element (n = 1000000, kept 1000000)
array, doubles: 8.0 bytes per element (n = 1000000, kept 1000000)
{ x, y } small integers, with its array slot: 40.0 bytes per element (n = 1000000, kept 1000000)
{ x } small integer, with its slot: 40.0 bytes per element (n = 1000000, kept 1000000)
{ x } integer 2^30..2^31-1, with its slot: 40.0 bytes per element (n = 1000000, kept 1000000)
{ x } double, with its slot: 40.0 bytes per element (n = 1000000, kept 1000000)
Map entry, integer key and value: 125.9 bytes per element (n = 100000, kept 100000)
Set entry, integer: 63.0 bytes per element (n = 100000, kept 100000)
Map entry, string key (keys made before): 69.7 bytes per element (n = 100000, kept 100000)
object as table, string key (keys made before): 38.1 bytes per element (n = 100000, kept 100000)
Int32Array: 4.0 bytes per element (n = 1000000, kept 1000000)
Float64Array: 8.0 bytes per element (n = 1000000, kept 1000000)
```

JSC-bun:

```text
array, small integers: 8.0 bytes per element (n = 1000000, kept 1000000)
array, integers 2^30-1024..2^30-1: 8.0 bytes per element (n = 1000000, kept 1000000)
array, integers 2^31-1024..2^31-1: 8.0 bytes per element (n = 1000000, kept 1000000)
array, doubles: 8.0 bytes per element (n = 1000000, kept 1000000)
{ x, y } small integers, with its array slot: 40.0 bytes per element (n = 1000000, kept 1000000)
{ x } small integer, with its slot: 40.0 bytes per element (n = 1000000, kept 1000000)
{ x } integer 2^30..2^31-1, with its slot: 40.0 bytes per element (n = 1000000, kept 1000000)
{ x } double, with its slot: 40.0 bytes per element (n = 1000000, kept 1000000)
Map entry, integer key and value: 68.2 bytes per element (n = 100000, kept 100000)
Set entry, integer: 52.5 bytes per element (n = 100000, kept 100000)
Map entry, string key (keys made before): 53.8 bytes per element (n = 100000, kept 100000)
object as table, string key (keys made before): 38.1 bytes per element (n = 100000, kept 100000)
Int32Array: 4.1 bytes per element (n = 1000000, kept 1000000)
Float64Array: 8.0 bytes per element (n = 1000000, kept 1000000)
```

```js
// JE-N1, JE-N9, JE-N10, JE-S1, JE-S2, JE-S9: bytes per element, from the engine's heap counter after a forced full collection.
const g = globalThis;
const heap = g.gcHeapSize ? () => { fullGC(); return gcHeapSize(); }                                   // JavaScriptCore shell
  : g.Bun ? () => { Bun.gc(true); return require('bun:jsc').heapStats().heapSize; }                     // Bun
  : g.process && g.gc ? () => { gc(); const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; } // Node.js
  : g.gc && g.performance && performance.memory ? () => { gc(); return performance.memory.usedJSHeapSize; } // Chrome with --expose-gc
  : null;
if (!heap) console.log('no forced GC or heap figure in this environment');
else {
  const M = 1e6, K = 1e5, keys = Array.from({ length: K }, (_, i) => 'k' + i);
  const arr = (f) => () => { const a = new Array(M).fill(0); for (let i = 0; i < M; i++) a[i] = f(i); return a; };
  const cases = [
    ['array, small integers', M, arr((i) => i & 1023)],
    ['array, integers 2^30-1024..2^30-1', M, arr((i) => 1073741823 - (i & 1023))],
    ['array, integers 2^31-1024..2^31-1', M, arr((i) => 2147483647 - (i & 1023))],
    ['array, doubles', M, arr((i) => i + 0.5)],
    ['{ x, y } small integers, with its array slot', M, arr((i) => ({ x: i & 1023, y: i & 1023 }))],
    ['{ x } small integer, with its slot', M, arr((i) => ({ x: i & 1023 }))],
    ['{ x } integer 2^30..2^31-1, with its slot', M, arr((i) => ({ x: 2147483647 - (i & 1023) }))],
    ['{ x } double, with its slot', M, arr((i) => ({ x: i + 0.5 }))],
    ['Map entry, integer key and value', K, () => { const m = new Map(); for (let i = 0; i < K; i++) m.set(i, i); return m; }],
    ['Set entry, integer', K, () => { const s = new Set(); for (let i = 0; i < K; i++) s.add(i); return s; }],
    ['Map entry, string key (keys made before)', K, () => { const m = new Map(); for (let i = 0; i < K; i++) m.set(keys[i], i); return m; }],
    ['object as table, string key (keys made before)', K, () => { const o = {}; for (let i = 0; i < K; i++) o[keys[i]] = i; return o; }],
    ['Int32Array', M, () => new Int32Array(M).fill(7)],
    ['Float64Array', M, () => new Float64Array(M).fill(0.5)],
  ];
  const all = [];  // every result stays alive to the end, so no earlier case can be freed inside a later measurement
  for (const [label, n, build] of cases) {
    const before = heap(); const kept = build(); const after = heap(); all.push(kept);
    console.log(`${label}: ${((after - before) / n).toFixed(1)} bytes per element (n = ${n}, kept ${kept.length ?? kept.size ?? Object.keys(kept).length})`);
  }
}
```
</details>

**Do the heap counters count what they should?** The JavaScriptCore shell's `gcHeapSize()` after `fullGC()`, Bun's `heapStats().heapSize` after `Bun.gc(true)`, Node.js's `heapUsed + arrayBuffers` after `gc()` and Chrome's `performance.memory.usedJSHeapSize` after `gc()` were each checked on four allocations of known size, one at a time and kept ✅[^lab]. A `Uint8Array` of 8 MiB (8,388,608 bytes) grew the counter by 8,400,810 (JSC-mac), 8,412,331 (JSC-bun), 8,386,296 (V8-node) and 8,389,284 bytes (V8-chrome); a `Float64Array` of 10⁶ elements (8,000,000) by 8,003,729, 8,003,227, 8,195,488 and 8,001,212; a string of 16 MiB (16,777,216) by 16,791,588, 16,781,248, 16,782,736 and 16,845,748. So each counter includes typed-array contents and string characters, to within 0.4 % (2.4 % for the Node.js `Float64Array`). An array of 10⁶ doubles grown by `push` counted 11.0, 9.4, 10.4 and 10.4 million bytes for 8 million bytes of values (an array grown by `push` is not sized exactly; this lab did not look further).

<details><summary>Lab: <code>known.js</code>, output on each environment that has a heap figure, then the script</summary>

JSC-mac:

```text
Uint8Array 8 MiB: delta 8400810 bytes (expected about 8388608)
Float64Array 1e6 (8 MB): delta 8003729 bytes (expected about 8000000)
string of 16 MiB (one-byte characters): delta 16791588 bytes (expected about 16777216)
array 1e6 doubles: delta 10998118 bytes (expected about 8000000)
```

JSC-bun:

```text
Uint8Array 8 MiB: delta 8412331 bytes (expected about 8388608)
Float64Array 1e6 (8 MB): delta 8003227 bytes (expected about 8000000)
string of 16 MiB (one-byte characters): delta 16781248 bytes (expected about 16777216)
array 1e6 doubles: delta 9421012 bytes (expected about 8000000)
```

V8-node:

```text
Uint8Array 8 MiB: delta 8386296 bytes (expected about 8388608)
Float64Array 1e6 (8 MB): delta 8195488 bytes (expected about 8000000)
string of 16 MiB (one-byte characters): delta 16782736 bytes (expected about 16777216)
array 1e6 doubles: delta 10436080 bytes (expected about 8000000)
```

V8-chrome:

```text
Uint8Array 8 MiB: delta 8389284 bytes (expected about 8388608)
Float64Array 1e6 (8 MB): delta 8001212 bytes (expected about 8000000)
string of 16 MiB (one-byte characters): delta 16845748 bytes (expected about 16777216)
array 1e6 doubles: delta 10432516 bytes (expected about 8000000)
```

```js
// Check of the heap counters on allocations of a known size: the counter after a forced full collection, before and after one kept allocation.
const g = globalThis;
const heap = g.gcHeapSize ? () => { fullGC(); return gcHeapSize(); }
  : g.Bun ? () => { Bun.gc(true); return require('bun:jsc').heapStats().heapSize; }
  : g.process && g.gc ? () => { gc(); const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; }
  : g.gc && g.performance && performance.memory ? () => { gc(); return performance.memory.usedJSHeapSize; } : null;
const out = (l, v) => console.log(l + ': ' + v);
const keep = [];
let h0 = heap();
for (const [label, mk, bytes] of [
  ['Uint8Array 8 MiB', () => new Uint8Array(8 * 1048576), 8 * 1048576],
  ['Float64Array 1e6 (8 MB)', () => new Float64Array(1e6), 8e6],
  ['string of 16 MiB (one-byte characters)', () => { const a = []; for (let i = 0; i < 1024; i++) a.push((i + 'abcdefgh'.repeat(2048)).slice(0, 16384)); return a.join(''); }, 16 * 1048576],
  ['array 1e6 doubles', () => { const a = []; for (let i = 0; i < 1e6; i++) a.push(i + 0.5); return a; }, 8e6],
]) {
  const x = mk(); keep.push(x); if (typeof x === 'string') x.charCodeAt(5);
  const h1 = heap(); out(label, 'delta ' + (h1 - h0) + ' bytes (expected about ' + bytes + ')'); h0 = h1;
}
```
</details>

**Are bytes per element stable across sizes?** `scale.js` repeated six cases at three sizes (arrays and objects 250,000, 1,000,000 and 4,000,000 elements; `Map` and object tables 25,000, 100,000 and 400,000 entries), three runs each ✅[^lab]. Arrays and objects were the same at every size on all three: 8.0 bytes per small-integer array element, 40.0 per one-field object (V8-node: 48.0 for `{ x, y }`, 56.0 for `{ x }` with a double), and 37.6 to 38.6 per entry of an object table on JavaScriptCore (V8-node: 62.9). `Map` entries on V8-node were also the same at every size (36.7 to 36.9). On JavaScriptCore they were not: JSC-mac took 168 to 210 bytes per integer-key `Map` entry at 25,000 entries, 84 or 126 at 100,000 (84 in some runs and 126 in others at the same size) and 84 at 400,000; JSC-bun took 136.5, 68.2 and 68.2, and for string keys 123 to 124, 53 to 54 and 53. Because the figure moves by a factor of 2 with the count (and in the JSC shell from run to run), no single bytes-per-entry number for a `Map` or `Set` on JavaScriptCore is given in this doc; the counter itself is accurate (see above), but the bytes per entry move with the count; this lab did not look further.

<details><summary>Lab: <code>scale.js</code>, output of run 2 on each environment that has a heap figure, then the script</summary>

JSC-mac:

```text
scale x1: smallint array 8.0 | {x,y} 40.0 | {x} double 40.0 | Map int 210.0 | Map str 155.8 | obj table 38.6
scale x4: smallint array 8.0 | {x,y} 40.0 | {x} double 40.0 | Map int 125.8 | Map str 69.2 | obj table 37.8
scale x16: smallint array 8.0 | {x,y} 40.0 | {x} double 40.0 | Map int 83.9 | Map str 68.9 | obj table 37.6
```

JSC-bun:

```text
scale x1: smallint array 8.1 | {x,y} 40.0 | {x} double 40.0 | Map int 136.5 | Map str 124.2 | obj table 38.6
scale x4: smallint array 8.0 | {x,y} 40.0 | {x} double 40.0 | Map int 68.2 | Map str 53.2 | obj table 37.8
scale x16: smallint array 8.0 | {x,y} 40.0 | {x} double 40.0 | Map int 68.2 | Map str 53.2 | obj table 37.6
```

V8-node:

```text
scale x1: smallint array 8.0 | {x,y} 48.0 | {x} double 56.0 | Map int 36.8 | Map str 36.9 | obj table 62.9
scale x4: smallint array 8.0 | {x,y} 48.0 | {x} double 56.0 | Map int 36.7 | Map str 36.7 | obj table 62.9
scale x16: smallint array 8.0 | {x,y} 48.0 | {x} double 56.0 | Map int 36.7 | Map str 36.7 | obj table 62.9
```

```js
const g = globalThis;
const heap = g.gcHeapSize ? () => { fullGC(); return gcHeapSize(); }
  : g.Bun ? () => { Bun.gc(true); return require('bun:jsc').heapStats().heapSize; }
  : g.process && g.gc ? () => { gc(); const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; } : null;
const all = [];
for (const s of [1, 4, 16]) {
  const M = 250000 * s, K = 25000 * s, keys = Array.from({ length: K }, (_, i) => 'k' + i);
  const arr = (f) => () => { const a = new Array(M).fill(0); for (let i = 0; i < M; i++) a[i] = f(i); return a; };
  const row = [];
  for (const [label, n, build] of [
    ['smallint array', M, arr((i) => i & 1023)],
    ['{x,y}', M, arr((i) => ({ x: i & 1023, y: i & 1023 }))],
    ['{x} double', M, arr((i) => ({ x: i + 0.5 }))],
    ['Map int', K, () => { const m = new Map(); for (let i = 0; i < K; i++) m.set(i, i); return m; }],
    ['Map str', K, () => { const m = new Map(); for (let i = 0; i < K; i++) m.set(keys[i], i); return m; }],
    ['obj table', K, () => { const o = {}; for (let i = 0; i < K; i++) o[keys[i]] = i; return o; }],
  ]) { const b = heap(); const k = build(); const a = heap(); all.push(k); row.push(label + ' ' + ((a - b) / n).toFixed(1)); }
  console.log('scale x' + s + ': ' + row.join(' | '));
}
```
</details>

### 4.11 `JE-S3` / `JE-S4`: `s += part`, read after the loop or inside it

`s += 'x'` n times, then one `charCodeAt` after the loop, against a `charCodeAt` in the middle of `s` after every append. Time per character, the range of the three rounds of each run, over three runs ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| after the loop, 100,000 characters, ns | 4.5 to 4.9 | 4.4 to 4.7 | 7.2 to 8.2 | 4.6 to 4.8 | 10.2 to 11.1 | 4.8 to 5.0 |
| after the loop, 1,600,000 characters | 7.6 to 7.8 | 4.5 to 4.6 | 8.6 to 9.3 | 4.8 to 5.2 | 9.2 to 11.8 | 5.1 to 5.8 |
| inside the loop, 10,000 characters | 216 to 233 | 212 to 214 | 20 to 22 | 247 to 377 | 330 to 447 | 275 to 309 |
| inside the loop, 20,000 | 441 to 453 | 423 to 447 | 21 to 22 | 539 to 560 | 641 to 752 | 532 to 558 |
| inside the loop, 40,000 | 795 to 855 | 770 to 797 | 21 to 22 | 901 to 950 | 935 to 1,370 | 933 to 1,917 |

Read once after the loop, the cost per character stayed nearly flat from 100,000 to 1,600,000 characters on every engine (at most 1.7 times higher at the top, V8-node). Read after each append, the cost per character doubled with every doubling of n on V8 and JavaScriptCore (a quadratic total), but stayed at 20 to 22 ns on SpiderMonkey, about 2.5 times the cost of reading once. For browser code: keep `+=` building; do not read the growing string inside the loop, which is quadratic in Chrome and in JavaScriptCore.

<details><summary>Lab: <code>concat.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
read after the loop, ns per character: 100000: 4.5-4.9 | 200000: 5.0-5.2 | 400000: 5.0-5.1 | 800000: 7.6-7.9 | 1600000: 7.7-7.8
read after each append, ns per character: 10000: 215.9-232.7 | 20000: 440.5-453.0 | 40000: 794.5-855.2
```

V8-chrome:

```text
read after the loop, ns per character: 100000: 4.4-4.5 | 200000: 4.4-4.4 | 400000: 4.5-4.5 | 800000: 4.5-4.5 | 1600000: 4.5-4.5
read after each append, ns per character: 10000: 212.1-213.9 | 20000: 423.7-426.7 | 40000: 769.6-787.5
```

SM-firefox:

```text
read after the loop, ns per character: 100000: 7.4-7.7 | 200000: 7.1-7.3 | 400000: 8.0-8.1 | 800000: 9.6-9.8 | 1600000: 8.7-9.0
read after each append, ns per character: 10000: 20.5-21.3 | 20000: 21.5-21.5 | 40000: 21.3-21.3
```

JSC-mac:

```text
read after the loop, ns per character: 100000: 4.6-4.8 | 200000: 4.7-4.7 | 400000: 4.7-4.8 | 800000: 4.8-4.8 | 1600000: 4.9-5.2
read after each append, ns per character: 10000: 253.6-377.4 | 20000: 541.3-554.6 | 40000: 912.5-934.5
```

JSC-bun:

```text
read after the loop, ns per character: 100000: 10.8-11.1 | 200000: 9.9-10.1 | 400000: 9.1-9.8 | 800000: 8.5-10.5 | 1600000: 9.2-9.9
read after each append, ns per character: 10000: 352.9-407.5 | 20000: 640.9-645.8 | 40000: 1126.4-1369.6
```

JSC-page:

```text
read after the loop, ns per character: 100000: 4.8-5.0 | 200000: 4.8-5.3 | 400000: 4.9-5.1 | 800000: 5.1-5.4 | 1600000: 5.2-5.6
read after each append, ns per character: 10000: 275.3-289.9 | 20000: 531.6-531.6 | 40000: 933.3-1100.0
```

```js
// JE-S3 / JE-S4: s += 'x' at doubling sizes, read once after the loop, against reading s after each append. ns per character.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function after(n) { let s = ''; for (let i = 0; i < n; i++) s += 'x'; return s.charCodeAt(n >> 1); }
function inside(n) { let s = '', c = 0; for (let i = 0; i < n; i++) { s += 'x'; c += s.charCodeAt(i >> 1); } return c; }
for (const [label, f, sizes] of [['read after the loop', after, [1e5, 2e5, 4e5, 8e5, 1.6e6]], ['read after each append', inside, [1e4, 2e4, 4e4]]]) {
  const row = [];
  for (const n of sizes) { B(() => f(n)); const t = [0, 1, 2].map(() => B(() => f(n)) * 1e6 / n); row.push(`${n}: ${Math.min(...t).toFixed(1)}-${Math.max(...t).toFixed(1)}`); }
  console.log(`${label}, ns per character: ${row.join(' | ')}`);
}
```
</details>

### 4.12 `JE-S6`: reads through a `Proxy`

10⁵ reads of `os[i & 7].v` on 8 plain objects, on 8 `Proxy` objects with an empty handler, and on 8 `Proxy` objects whose `get` trap returns `t[k]`; one reader function each ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| plain, ms | 0.105 to 0.107 | 0.135 to 0.139 | 0.116 to 0.126 | 0.104 to 0.105 | 0.103 to 0.109 | 0.104 to 0.108 |
| `Proxy`, empty handler | ×8.5 to 9.0 | ×6.6 to 7.0 | ×3.2 to 3.4 | ×2.0 to 2.3 | ×2.0 | ×2.0 to 2.3 |
| `Proxy`, `get` trap | ×14.4 to 14.7 | ×10.5 to 11.3 | ×5.3 to 5.8 | ×2.8 to 2.9 | ×2.8 to 2.9 | ×2.8 to 2.9 |

Every proxy read was slower than a plain read on every engine, by 2.0 to 14.7 times; the slowdown was largest on V8 and smallest on JavaScriptCore. The first version of this check read one object 10⁵ times; its plain read took 0.03 ms on JavaScriptCore (0.3 ns per read, a third of the time per read here), and the ratios came out as 4.3 to 6.0 on JavaScriptCore and, in Chrome, split in every run between 1.8 and 11 for the `get` trap. Reading 8 different objects removed both effects. For browser code: read the raw object in hot loops; this pays in every engine, by a factor of 2 to 3 in Safari's engine and 3 to 6 in Firefox, more in Chrome.

<details><summary>Lab: <code>proxy.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
10^5 reads of os[i & 7].v
  plain: 0.106-0.106 ms/call, x1.00-1.00, result 350000
  Proxy, empty handler: 0.893-0.954 ms/call, x8.45-9.04, result 350000
  Proxy, get trap: 1.52-1.55 ms/call, x14.36-14.65, result 350000
```

V8-chrome:

```text
10^5 reads of os[i & 7].v
  plain: 0.135-0.136 ms/call, x1.00-1.00, result 350000
  Proxy, empty handler: 0.915-0.952 ms/call, x6.77-7.04, result 350000
  Proxy, get trap: 1.46-1.53 ms/call, x10.79-11.27, result 350000
```

SM-firefox:

```text
10^5 reads of os[i & 7].v
  plain: 0.120-0.125 ms/call, x1.00-1.00, result 350000
  Proxy, empty handler: 0.390-0.410 ms/call, x3.23-3.28, result 350000
  Proxy, get trap: 0.667-0.684 ms/call, x5.47-5.60, result 350000
```

JSC-mac:

```text
10^5 reads of os[i & 7].v
  plain: 0.104-0.105 ms/call, x1.00-1.00, result 350000
  Proxy, empty handler: 0.209-0.238 ms/call, x1.99-2.28, result 350000
  Proxy, get trap: 0.297-0.298 ms/call, x2.82-2.86, result 350000
```

JSC-bun:

```text
10^5 reads of os[i & 7].v
  plain: 0.104-0.104 ms/call, x1.00-1.00, result 350000
  Proxy, empty handler: 0.209-0.212 ms/call, x2.01-2.04, result 350000
  Proxy, get trap: 0.297-0.297 ms/call, x2.85-2.86, result 350000
```

JSC-page:

```text
10^5 reads of os[i & 7].v
  plain: 0.104-0.105 ms/call, x1.00-1.00, result 350000
  Proxy, empty handler: 0.212-0.237 ms/call, x2.04-2.26, result 350000
  Proxy, get trap: 0.297-0.300 ms/call, x2.86-2.86, result 350000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-S6: 10^5 reads of os[i & 7].v on 8 plain objects, 8 Proxies with an empty handler and 8 Proxies with a get trap (8 objects, so that no read is the same load twice in a row).
const eight = (mk) => Array.from({ length: 8 }, (_, i) => mk(i));
const plain = eight((i) => ({ v: i })), empty = eight((i) => new Proxy({ v: i }, {})), trap = eight((i) => new Proxy({ v: i }, { get: (t, k) => t[k] }));
const reader = (tag) => new Function('os', '/* ' + tag + ' */ let s = 0; for (let i = 0; i < 1e5; i++) s += os[i & 7].v; return s;');
// Each generated reader gets its own comment: in this lab, readers with identical source text shared their feedback on V8.
const r1 = reader(1), r2 = reader(2), r3 = reader(3);
R('10^5 reads of os[i & 7].v', { plain: () => r1(plain), 'Proxy, empty handler': () => r2(empty), 'Proxy, get trap': () => r3(trap) });
```
</details>

### 4.13 `JE-S7` / `JE-S8`: getters in a literal, on a class, and a plain field

Reads of `o.a` where `a` is a plain field, a class getter, or a getter in an object literal, in two shapes. The catalog's shape (`getters-b.js`): 100 calls of a reader of 10⁴ reads per timing, all on the same one object, so the load is the same at every step. The second shape (`getters-c.js`): a reader of 10⁶ reads that walks 8 different objects (`os[i & 7].a`), so no read repeats the previous load; the 8 literals each carry their own getter function. Ratios are the lowest time of the three runs against the lowest plain-field time ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| one object, plain field, ms | 0.36 to 0.38 | 0.36 to 0.38 | 0.61 to 0.68 (one round 3.8) | 0.31 to 0.52 | 0.30 to 0.35 | 0.32 to 0.34 |
| one object, class getter | ×1.00 | ×1.00 | ×1.00 | ×1.00 | ×1.01 | ×0.96 |
| one object, literal getter | ×33.9 | ×19.7 | ×0.99 | ×1.00 | ×1.02 | ×0.98 |
| 8 objects, plain field, ms | 1.05 to 1.07 | 0.85 to 1.41 | 1.15 to 1.26 | 1.04 to 1.05 | 1.03 to 1.08 | 1.04 to 1.08 |
| 8 objects, class getter | ×1.00 | ×0.92 | ×0.99 | ×1.00 | ×1.00 | ×0.99 |
| 8 objects, literal getter | ×11.1 | ×9.2 | ×1.23 | ×1.42 | ×1.44 | ×1.42 |

A getter in an object literal was 9 to 34 times slower than a field on V8. On SpiderMonkey and JavaScriptCore it cost nothing when one object was read over and over, but with 8 objects it cost 1.14 to 1.28 times on SpiderMonkey and 1.37 to 1.48 times on all three JavaScriptCore environments (per-round ratios over three runs); this lab did not separate the getter from the 8 separate getter functions. A class getter cost the same as a field on every engine in both shapes (in Chrome the 8-object field read ranged from 0.85 to 1.41 ms, so the class getter looked up to 1.8 times faster in single rounds). The first version of this check ran the second shape on one object only, which read as no cost on SpiderMonkey and JavaScriptCore. For browser code: accessors on a class cost nothing anywhere; accessors in an object literal cost a large factor in Chrome and Node.js and a small one (1.2 to 1.5 times) in Firefox and Safari's engine when many such objects are read in turn.

<details><summary>Lab: <code>getters-b.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
100 calls of 10^4 reads of o.a
  plain field: 0.376-0.380 ms/call, x1.00-1.00, result 1000000
  class getter: 0.375-0.377 ms/call, x0.99-1.00, result 1000000
  object-literal getter: 12.7-12.7 ms/call, x33.36-33.73, result 1000000
```

V8-chrome:

```text
100 calls of 10^4 reads of o.a
  plain field: 0.372-0.377 ms/call, x1.00-1.00, result 1000000
  class getter: 0.365-0.375 ms/call, x0.98-1.01, result 1000000
  object-literal getter: 7.11-7.17 ms/call, x18.88-19.28, result 1000000
```

SM-firefox:

```text
100 calls of 10^4 reads of o.a
  plain field: 0.641-0.675 ms/call, x1.00-1.00, result 1000000
  class getter: 0.619-0.744 ms/call, x0.93-1.16, result 1000000
  object-literal getter: 0.615-0.656 ms/call, x0.92-0.97, result 1000000
```

JSC-mac:

```text
100 calls of 10^4 reads of o.a
  plain field: 0.317-0.323 ms/call, x1.00-1.00, result 1000000
  class getter: 0.322-0.324 ms/call, x1.00-1.02, result 1000000
  object-literal getter: 0.311-0.323 ms/call, x0.97-1.02, result 1000000
```

JSC-bun:

```text
100 calls of 10^4 reads of o.a
  plain field: 0.314-0.325 ms/call, x1.00-1.00, result 1000000
  class getter: 0.312-0.325 ms/call, x0.99-1.02, result 1000000
  object-literal getter: 0.324-0.334 ms/call, x1.03-1.05, result 1000000
```

JSC-page:

```text
100 calls of 10^4 reads of o.a
  plain field: 0.322-0.330 ms/call, x1.00-1.00, result 1000000
  class getter: 0.316-0.318 ms/call, x0.96-0.99, result 1000000
  object-literal getter: 0.319-0.322 ms/call, x0.97-1.00, result 1000000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-S7 / JE-S8, the catalog's shape: many calls of a reader of 10^4 reads (100 calls per timing), plain field, class getter, literal getter.
class C { constructor() { this._a = 1; } get a() { return this._a; } }
const field = { a: 1 }, cls = new C(), literal = { _a: 1, get a() { return this._a; } };
const reader = (tag) => new Function('o', '/* ' + tag + ' */ let s = 0; for (let i = 0; i < 1e4; i++) s += o.a; return s;');
// Each generated reader gets its own comment: in this lab, readers with identical source text shared their feedback on V8.
const r1 = reader(1), r2 = reader(2), r3 = reader(3);
const x100 = (r, o) => () => { let s = 0; for (let i = 0; i < 100; i++) s += r(o); return s; };
R('100 calls of 10^4 reads of o.a', { 'plain field': x100(r1, field), 'class getter': x100(r2, cls), 'object-literal getter': x100(r3, literal) });
```
</details>

<details><summary>Lab: <code>getters-c.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
10^6 reads of os[i & 7].a
  plain field: 1.05-1.06 ms/call, x1.00-1.00, result 3500000
  class getter: 1.06-3.61 ms/call, x1.00-3.42, result 3500000
  object-literal getter: 11.6-11.7 ms/call, x10.94-11.08, result 3500000
```

V8-chrome:

```text
10^6 reads of os[i & 7].a
  plain field: 0.917-1.41 ms/call, x1.00-1.00, result 3500000
  class getter: 0.781-0.792 ms/call, x0.56-0.85, result 3500000
  object-literal getter: 7.82-8.00 ms/call, x5.55-8.72, result 3500000
```

SM-firefox:

```text
10^6 reads of os[i & 7].a
  plain field: 1.15-1.25 ms/call, x1.00-1.00, result 3500000
  class getter: 1.15-1.21 ms/call, x0.97-1.00, result 3500000
  object-literal getter: 1.41-1.49 ms/call, x1.19-1.27, result 3500000
```

JSC-mac:

```text
10^6 reads of os[i & 7].a
  plain field: 1.04-1.04 ms/call, x1.00-1.00, result 3500000
  class getter: 1.04-1.06 ms/call, x1.00-1.01, result 3500000
  object-literal getter: 1.48-1.48 ms/call, x1.42-1.43, result 3500000
```

JSC-bun:

```text
10^6 reads of os[i & 7].a
  plain field: 1.03-1.04 ms/call, x1.00-1.00, result 3500000
  class getter: 1.03-1.04 ms/call, x1.00-1.00, result 3500000
  object-literal getter: 1.48-1.50 ms/call, x1.42-1.45, result 3500000
```

JSC-page:

```text
10^6 reads of os[i & 7].a
  plain field: 1.04-1.04 ms/call, x1.00-1.00, result 3500000
  class getter: 1.03-1.04 ms/call, x0.99-1.00, result 3500000
  object-literal getter: 1.48-1.49 ms/call, x1.42-1.44, result 3500000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-S7 / JE-S8: 10^6 reads of a plain field, a class getter and a getter in an object literal; each reader walks 8 different objects, so no read is the same load twice in a row.
class C { constructor(i) { this._a = i; } get a() { return this._a; } }
const eight = (mk) => Array.from({ length: 8 }, (_, i) => mk(i));
const field = eight((i) => ({ a: i })), cls = eight((i) => new C(i)), literal = eight((i) => ({ _a: i, get a() { return this._a; } }));
const reader = (tag) => new Function('os', '/* ' + tag + ' */ let s = 0; for (let i = 0; i < 1e6; i++) s += os[i & 7].a; return s;');
// Each generated reader gets its own comment: in this lab, readers with identical source text shared their feedback on V8.
const r1 = reader(1), r2 = reader(2), r3 = reader(3);
R('10^6 reads of os[i & 7].a', { 'plain field': () => r1(field), 'class getter': () => r2(cls), 'object-literal getter': () => r3(literal) });
```
</details>

### 4.14 `JE-F3`: one value type per site

Two sum functions with the same source over 10⁶ small integers; one of them was first called 20 times with arrays of strings. Then a hash of 1,000 strings of about 40 characters, `h = h * 31 + c` with no wrap against `Math.imul` and `| 0`. Each hash variant has its own generated loop, and the result is used two ways: as `h & 1023` (a bit operation, so the time is the hash loop) and as `h % 1000` (as a table index would use it). Three runs ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| sum, clean, ms | 0.74 | 0.83 to 1.05 | 1.04 to 1.10 | 0.48 to 0.51 | 0.48 to 0.50 | 0.48 to 0.49 |
| sum, once saw a string | ×2.98 to 3.01 | ×2.55 to 3.24 | ×1.00 to 1.09 | ×0.96 to 1.00 | ×0.98 to 1.04 | ×0.98 to 1.04 |
| hash `& 1023`, `Math.imul` and `\| 0`, ms | 0.053 | 0.046 | 0.061 to 0.062 | 0.031 | 0.027 to 0.029 | 0.028 |
| hash `& 1023`, no wrap | ×1.19 to 1.20 | ×1.32 to 1.33 | ×1.11 to 1.12 | ×1.59 to 1.61 | ×1.63 to 1.70 | ×1.67 to 1.69 |
| hash `% 1000`, `Math.imul` and `\| 0`, ms | 0.056 | 0.071 to 0.072 | 0.062 | 0.034 | 0.030 to 0.031 | 0.031 |
| hash `% 1000`, no wrap | ×5.66 to 5.70 | ×4.47 to 4.54 | ×5.30 to 5.31 | ×9.3 to 9.6 | ×2.34 to 2.39 | ×10.3 to 10.4 |

A sum that once saw a string stayed three times slower on V8 only (×3.0 in Node.js, ×2.6 to 3.2 in Chrome); SpiderMonkey and JavaScriptCore ran both copies at the same speed. The unwrapped hash was slower on every engine, but by how much depended on what is done with the result: 1.1 to 1.7 times when it is only reduced with `& 1023` (1.2 to 1.3 on V8, 1.1 on SpiderMonkey, 1.6 to 1.7 on JavaScriptCore), and 2.3 to 10 times when it goes through `% 1000`. In the `% 1000` timing the unwrapped hash took 0.32 to 0.33 ms on all five macOS environments (V8, SpiderMonkey and JavaScriptCore alike) and 0.07 ms in the Bun container, which says most of that cost is the `%` on a number near 10⁵⁹ and not the hash loop; this lab did not look further. The first version of this check shared one closure between the two hash variants, so they shared type feedback, and used only `% 1000`; its ratios (1.6 to 5.5) were replaced by the table above. The two hashes compute different results (wrap only where 32-bit math is intended). For browser code: keeping a site to one type matters on V8 and costs nothing elsewhere; wrapping 32-bit math with `Math.imul` and `| 0` is at least 1.1 times faster on every engine, and several times faster where the hash is then reduced with `%`.

<details><summary>Lab: <code>types.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
sum of 10^6 small integers
  clean: 0.737-0.748 ms/call, x1.00-1.00, result 511370976
  once saw a string: 2.20-2.25 ms/call, x2.99-3.01, result 511370976
hash of 1,000 strings of about 40 characters, result used as h & 1023
  Math.imul and | 0: 0.0531-0.0536 ms/call, x1.00-1.00, result 294404
  no wrap: 0.0634-0.0635 ms/call, x1.18-1.20, result 0
hash of 1,000 strings of about 40 characters, result used as h % 1000
  Math.imul and | 0: 0.0561-0.0576 ms/call, x1.00-1.00, result -7692
  no wrap: 0.317-0.329 ms/call, x5.53-5.71, result 490784
```

V8-chrome:

```text
sum of 10^6 small integers
  clean: 0.842-1.05 ms/call, x1.00-1.00, result 511370976
  once saw a string: 2.68-2.68 ms/call, x2.55-3.19, result 511370976
hash of 1,000 strings of about 40 characters, result used as h & 1023
  Math.imul and | 0: 0.0459-0.0463 ms/call, x1.00-1.00, result 294404
  no wrap: 0.0610-0.0611 ms/call, x1.32-1.33, result 0
hash of 1,000 strings of about 40 characters, result used as h % 1000
  Math.imul and | 0: 0.0708-0.0718 ms/call, x1.00-1.00, result -7692
  no wrap: 0.322-0.324 ms/call, x4.49-4.57, result 490784
```

SM-firefox:

```text
sum of 10^6 small integers
  clean: 1.03-1.30 ms/call, x1.00-1.00, result 511370976
  once saw a string: 1.06-1.26 ms/call, x0.87-1.05, result 511370976
hash of 1,000 strings of about 40 characters, result used as h & 1023
  Math.imul and | 0: 0.0614-0.0620 ms/call, x1.00-1.00, result 294404
  no wrap: 0.0680-0.0688 ms/call, x1.10-1.12, result 0
hash of 1,000 strings of about 40 characters, result used as h % 1000
  Math.imul and | 0: 0.0616-0.0618 ms/call, x1.00-1.00, result -7692
  no wrap: 0.326-0.327 ms/call, x5.29-5.30, result 490784
```

JSC-mac:

```text
sum of 10^6 small integers
  clean: 0.482-0.483 ms/call, x1.00-1.00, result 511370976
  once saw a string: 0.482-0.485 ms/call, x1.00-1.00, result 511370976
hash of 1,000 strings of about 40 characters, result used as h & 1023
  Math.imul and | 0: 0.0310-0.0322 ms/call, x1.00-1.00, result 294404
  no wrap: 0.0498-0.0518 ms/call, x1.59-1.61, result 0
hash of 1,000 strings of about 40 characters, result used as h % 1000
  Math.imul and | 0: 0.0340-0.0341 ms/call, x1.00-1.00, result -7692
  no wrap: 0.321-0.325 ms/call, x9.40-9.55, result 490784
```

JSC-bun:

```text
sum of 10^6 small integers
  clean: 0.483-0.497 ms/call, x1.00-1.00, result 511370976
  once saw a string: 0.485-0.485 ms/call, x0.98-1.00, result 511370976
hash of 1,000 strings of about 40 characters, result used as h & 1023
  Math.imul and | 0: 0.0274-0.0281 ms/call, x1.00-1.00, result 294404
  no wrap: 0.0460-0.0462 ms/call, x1.64-1.69, result 0
hash of 1,000 strings of about 40 characters, result used as h % 1000
  Math.imul and | 0: 0.0304-0.0312 ms/call, x1.00-1.00, result -7692
  no wrap: 0.0726-0.0728 ms/call, x2.34-2.39, result 490784
```

JSC-page:

```text
sum of 10^6 small integers
  clean: 0.484-0.493 ms/call, x1.00-1.00, result 511370976
  once saw a string: 0.483-0.487 ms/call, x0.98-1.00, result 511370976
hash of 1,000 strings of about 40 characters, result used as h & 1023
  Math.imul and | 0: 0.0281-0.0281 ms/call, x1.00-1.00, result 294404
  no wrap: 0.0468-0.0469 ms/call, x1.67-1.67, result 0
hash of 1,000 strings of about 40 characters, result used as h % 1000
  Math.imul and | 0: 0.0312-0.0313 ms/call, x1.00-1.00, result -7692
  no wrap: 0.323-0.324 ms/call, x10.30-10.38, result 490784
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-F3: a sum loop whose += once saw a string against a clean copy; a string hash without and with Math.imul and | 0.
function sumClean(a, s) { for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function sumMixed(a, s) { for (let i = 0; i < a.length; i++) s += a[i]; return s; }
for (let i = 0; i < 20; i++) sumMixed(['a', 'b'], '');   // the only calls with strings
const ints = Array.from({ length: 1e6 }, (_, i) => i & 1023);
R('sum of 10^6 small integers', { clean: () => sumClean(ints, 0), 'once saw a string': () => sumMixed(ints, 0) });
function hashGrow(s) { let h = 0; for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i); return h; }
function hashInt32(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }
const words = Array.from({ length: 1000 }, (_, i) => 'key-' + i + '-abcdefghijklmnopqrstuvwxyz0123');
// One generated loop per variant (its own comment, so its own call site and feedback); the hash result is used as h & 1023 (a bit operation) or as h % 1000 (what a hash table index does).
const use = (h, tag, op) => new Function('h', 'words', `/* ${tag} */ return () => { let s = 0; for (const w of words) s += ${op}; return s; };`)(h, words);
R('hash of 1,000 strings of about 40 characters, result used as h & 1023', { 'Math.imul and | 0': use(hashInt32, 1, 'h(w) & 1023'), 'no wrap': use(hashGrow, 2, 'h(w) & 1023') });
R('hash of 1,000 strings of about 40 characters, result used as h % 1000', { 'Math.imul and | 0': use(hashInt32, 3, 'h(w) % 1000'), 'no wrap': use(hashGrow, 4, 'h(w) % 1000') });
```
</details>

### 4.15 `JE-F9`: `try`/`catch`, `arguments`, a generator and `for…in`

10⁵ calls of a small function `x * 2 + 1`: plain, inside `try`/`catch`, reading `arguments[0]`, and as a generator read with `.next().value`; then 10⁵ calls summing a 4-key object with `for…in` against `Object.keys`. Each variant has its own generated call loop. Five runs ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| plain, ms | 0.049 | 0.049 to 0.050 | 0.066 to 0.077 | 0.065 | 0.065 | 0.064 |
| `try`/`catch` | ×1.00 | ×1.00 | ×0.98 to 1.15 | ×0.98 to 0.99 | ×0.99 | ×1.00 |
| `arguments[0]` | ×0.98 | ×0.98 | ×0.99 to 1.01 | ×0.99 to 1.00 | ×1.01 | ×1.00 |
| generator, one value per call | ×101 to 108 | ×22.8 to 23.0 | ×51 to 60 | ×13.1 to 13.4 | ×5.5 to 6.4 | ×7.1 |
| `Object.keys` sum, ms | 2.82 to 2.87 | 2.56 to 2.59 | 3.95 to 4.00 | 1.23 to 1.25 | 1.18 to 1.28 | 1.16 to 1.18 |
| `for…in` sum | ×0.25 | ×0.27 | ×0.37 to 0.40 | ×0.52 to 0.68 | ×0.46 to 0.50 | ×0.52 to 0.53 |

`try`/`catch` and `arguments` cost nothing on any engine. `for…in` over a small object was 1.5 to 4 times faster than `Object.keys` on every engine, so removing it would cost. A generator that yields one value per call was 5.5 to 108 times slower than the plain function on every engine; the rule's V8 evidence is that generators get compiled by the optimizing tier, which says nothing about this per-call cost. For browser code: keep `try`/`catch`, `arguments` and `for…in` over objects where they are clearest; do not turn a plain hot function into a generator.

<details><summary>Lab: <code>features.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
10^5 calls
  plain: 0.0494-0.0495 ms/call, x1.00-1.00, result 102163456
  try/catch: 0.0493-0.0494 ms/call, x1.00-1.00, result 102163456
  arguments: 0.0483-0.0483 ms/call, x0.98-0.98, result 102163456
  generator: 5.31-5.37 ms/call, x107.30-108.69, result 102163456
10^5 calls summing a 4-key object
  Object.keys: 2.87-2.95 ms/call, x1.00-1.00, result 1000000
  for...in: 0.716-0.920 ms/call, x0.25-0.32, result 1000000
```

V8-chrome:

```text
10^5 calls
  plain: 0.0496-0.0507 ms/call, x1.00-1.00, result 102163456
  try/catch: 0.0496-0.0497 ms/call, x0.98-1.00, result 102163456
  arguments: 0.0486-0.0487 ms/call, x0.96-0.98, result 102163456
  generator: 1.14-1.16 ms/call, x22.40-23.38, result 102163456
10^5 calls summing a 4-key object
  Object.keys: 2.57-2.58 ms/call, x1.00-1.00, result 1000000
  for...in: 0.686-0.690 ms/call, x0.27-0.27, result 1000000
```

SM-firefox:

```text
10^5 calls
  plain: 0.0773-0.0792 ms/call, x1.00-1.00, result 102163456
  try/catch: 0.0754-0.0760 ms/call, x0.96-0.98, result 102163456
  arguments: 0.0768-0.0775 ms/call, x0.98-0.99, result 102163456
  generator: 3.96-4.06 ms/call, x50.49-51.32, result 102163456
10^5 calls summing a 4-key object
  Object.keys: 4.00-4.05 ms/call, x1.00-1.00, result 1000000
  for...in: 1.58-1.66 ms/call, x0.39-0.42, result 1000000
```

JSC-mac:

```text
10^5 calls
  plain: 0.0646-0.0654 ms/call, x1.00-1.00, result 102163456
  try/catch: 0.0640-0.0664 ms/call, x0.99-1.02, result 102163456
  arguments: 0.0645-0.0656 ms/call, x1.00-1.00, result 102163456
  generator: 0.866-0.891 ms/call, x13.40-13.62, result 102163456
10^5 calls summing a 4-key object
  Object.keys: 1.23-1.30 ms/call, x1.00-1.00, result 1000000
  for...in: 0.653-0.663 ms/call, x0.51-0.53, result 1000000
```

JSC-bun:

```text
10^5 calls
  plain: 0.0648-0.0652 ms/call, x1.00-1.00, result 102163456
  try/catch: 0.0641-0.0647 ms/call, x0.98-1.00, result 102163456
  arguments: 0.0652-0.0652 ms/call, x1.00-1.01, result 102163456
  generator: 0.382-0.424 ms/call, x5.89-6.50, result 102163456
10^5 calls summing a 4-key object
  Object.keys: 1.21-1.23 ms/call, x1.00-1.00, result 1000000
  for...in: 0.591-0.593 ms/call, x0.48-0.49, result 1000000
```

JSC-page:

```text
10^5 calls
  plain: 0.0639-0.0643 ms/call, x1.00-1.00, result 102163456
  try/catch: 0.0639-0.0647 ms/call, x0.99-1.01, result 102163456
  arguments: 0.0639-0.0643 ms/call, x1.00-1.00, result 102163456
  generator: 0.454-0.465 ms/call, x7.07-7.27, result 102163456
10^5 calls summing a 4-key object
  Object.keys: 1.18-1.28 ms/call, x1.00-1.00, result 1000000
  for...in: 0.612-0.613 ms/call, x0.48-0.52, result 1000000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-F9: 10^5 calls of a small function, plain against the same work with try/catch, with arguments, as a generator; for...in over a 4-key object against Object.keys.
const plain = function (x) { return x * 2 + 1; };
const tryCatch = function (x) { try { return x * 2 + 1; } catch (e) { return 0; } };
const args = function () { return arguments[0] * 2 + 1; };
const gen = function* (x) { yield x * 2 + 1; };
const o = { a: 1, b: 2, c: 3, d: 4 };
const keysSum = function (o) { let s = 0; for (const k of Object.keys(o)) s += o[k]; return s; };
const forIn = function (o) { let s = 0; for (const k in o) s += o[k]; return s; };
// One generated loop per variant (its own comment, so its own call site and feedback): a shared loop would see every variant at one call.
const loop = (f, tag) => new Function('f', `/* ${tag} */ return () => { let s = 0; for (let i = 0; i < 1e5; i++) s += f(i & 1023, 1, ''); return s; };`)(f);
R('10^5 calls', { plain: loop(plain, 1), 'try/catch': loop(tryCatch, 2), arguments: loop(args, 3), generator: loop((x) => gen(x).next().value, 4) });
R('10^5 calls summing a 4-key object', { 'Object.keys': loop(() => keysSum(o), 5), 'for...in': loop(() => forIn(o), 6) });
```
</details>

### 4.16 `JE-F10`: a direct `eval` that never runs

Five functions of `a + b` in three call shapes ✅[^lab]. The variants: `plain`; `direct`, which holds `if (code) eval(code)` where `code` is always `''`, so the `eval` never runs; the same with an indirect `(0, eval)(code)`; and a `new Function` built once. The shapes differ in whether the engine can see, at the call site, which function it is calling and what string it gets.

- **A, the V8 catalog's shape.** One call site `f(i & 1023, 1, '')` inside a function that makes 10⁶ calls; `plain` is warmed and timed first, then `direct` (the catalog's script `evalcost.mjs`, class `direct-eval-scope`, does the same with 10⁶ calls and a median of 7 rounds).
- **B, a shared call site.** The same loop, 10⁵ calls, run through one call site that five different functions have used (so it is not monomorphic), with the code string read from an array instead of written as `''`; the variants are interleaved.
- **C, one loop per variant.** A generated loop for each variant (its own comment, so its own call site and feedback), 10⁵ calls, constant `''`. This is the shape the first version of this check used.

Time per call of `direct`, as a multiple of `plain` in the same shape; three runs ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| A: `plain`, ms per 10⁶ calls | 0.59 | 0.64 to 0.65 | 0.63 to 0.66 | 0.455 to 0.457 | 0.455 to 0.456 | 0.457 |
| A: `direct` | ×25.3 to 25.4 | ×17.8 to 18.3 | ×94 to 99 | ×26.9 to 27.0 | ×18.1 to 18.5 | ×27.6 |
| B: `plain`, ms per 10⁵ calls | 0.42 to 0.43 | 0.12 | 0.47 to 0.50 | 0.39 to 0.42 | 0.41 to 0.44 | 0.39 to 0.42 |
| B: `direct` | ×3.6 to 3.7 | ×8.2 to 10.4 | ×13.3 to 14.6 | ×3.0 to 3.3 | ×2.0 to 2.2 | ×3.2 to 3.4 |
| C: `plain`, ms per 10⁵ calls | 0.049 to 0.056 | 0.050 to 0.051 | 0.064 to 0.068 | 0.049 to 0.053 | 0.049 | 0.049 to 0.050 |
| C: `direct` | ×0.84 to 0.90 | ×0.98 to 1.05 | ×95 to 102 | ×19.5 to 21.2 | ×10.1 to 15.0 | ×21.4 to 21.9 |

Indirect `eval` and `new Function` built once cost nothing in C on any engine (×0.89 to 1.04). In B they were also within 0.84 to 1.27 times `plain`, except `new Function` on V8-node (0.21 times: faster than `plain` at that shared site).

**Why the V8 catalog and the first version of this check disagreed.** The catalog's script, run here on Node.js 24.22.1 (V8 13.6) with `--trace-gc`, gave 0.3 ms for `plain` and 15.4 to 15.5 ms for the function with `eval` per 10⁶ calls, and 1,084 scavenges (young-generation garbage collections), three runs ✅[^lab]. Shape A reproduces it on V8 (×25 in Node.js, ×18 in Chrome; 7,026 scavenges for A alone in Node.js). The first version used shape C, where V8 showed ×0.9 to 1.0. Run on Node.js with V8's trace and two switches ✅[^lab]: `--trace-turbo-inlining` printed that V8 inlined `direct` (85 bytes of bytecode) into its loop in C; with `--no-turbo-escape` (escape analysis off) C gave ×22.4 to 24.1; with `--no-turbo-inlining` the original C script gave ×4.1 to 5.3 (with `plain` also left uninlined at 0.40 to 0.45 ms). So V8's cost of a direct `eval` is real, and it disappears only when V8 inlines the function into a loop that passes a constant, which a function reached through a shared call site does not get (B). The two numbers also differ because `plain` is nearly free when inlined (0.6 ns per call in A): the added cost of `direct` was about the same 11 to 14 ns per call in both shapes on Node.js (15.0 ms against 0.59 ms in A; 1.5 against 0.42 ms per 10⁵ calls in B). SpiderMonkey and JavaScriptCore paid in all three shapes, including C, and for them the shape changed the size of the cost (×2 to ×100) but not its sign.

For browser code: keep direct `eval` out of any function that runs often. It cost at least 2 times on every engine as soon as the callee could not be inlined (shapes A and B), and 10 to 100 times in Firefox and in Safari's engine even in a loop of its own; only Chrome and Node.js showed nothing, and only in C.

<details><summary>Lab: <code>eval.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
A: the catalog shape, one callee after the other, ms per 10^6 calls (best of 3)
  plain: 0.594 ms, x1.0, result 512370976
  direct eval, never run: 15.0 ms, x25.3, result 512370976
B: shared site, five callees, 10^5 calls
  plain: 0.424-0.426 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 1.53-1.56 ms/call, x3.62-3.67, result 51131728
  indirect eval, never run: 0.472-0.473 ms/call, x1.11-1.11, result 51131728
  new Function: 0.0893-0.0902 ms/call, x0.21-0.21, result 51131728
C: own loop per variant, 10^5 calls
  plain: 0.0494-0.0495 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 0.0446-0.0447 ms/call, x0.90-0.90, result 51131728
  indirect eval, never run: 0.0494-0.0494 ms/call, x1.00-1.00, result 51131728
  new Function: 0.0495-0.0502 ms/call, x1.00-1.02, result 51131728
```

V8-chrome:

```text
A: the catalog shape, one callee after the other, ms per 10^6 calls (best of 3)
  plain: 0.650 ms, x1.0, result 512370976
  direct eval, never run: 11.6 ms, x17.8, result 512370976
B: shared site, five callees, 10^5 calls
  plain: 0.120-0.120 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 0.975-1.23 ms/call, x8.15-10.29, result 51131728
  indirect eval, never run: 0.149-0.152 ms/call, x1.25-1.27, result 51131728
  new Function: 0.119-0.120 ms/call, x1.00-1.00, result 51131728
C: own loop per variant, 10^5 calls
  plain: 0.0497-0.0503 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 0.0496-0.0498 ms/call, x0.99-1.00, result 51131728
  indirect eval, never run: 0.0497-0.0501 ms/call, x0.99-1.01, result 51131728
  new Function: 0.0497-0.0499 ms/call, x0.99-1.00, result 51131728
```

SM-firefox:

```text
A: the catalog shape, one callee after the other, ms per 10^6 calls (best of 3)
  plain: 0.632 ms, x1.0, result 512370976
  direct eval, never run: 61.5 ms, x97.4, result 512370976
B: shared site, five callees, 10^5 calls
  plain: 0.469-0.499 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 6.35-6.66 ms/call, x13.34-13.58, result 51131728
  indirect eval, never run: 0.492-0.509 ms/call, x1.02-1.05, result 51131728
  new Function: 0.469-0.487 ms/call, x0.98-1.00, result 51131728
C: own loop per variant, 10^5 calls
  plain: 0.0638-0.0650 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 6.12-6.63 ms/call, x95.02-101.93, result 51131728
  indirect eval, never run: 0.0638-0.0646 ms/call, x0.99-1.00, result 51131728
  new Function: 0.0637-0.0667 ms/call, x0.99-1.03, result 51131728
```

JSC-mac:

```text
A: the catalog shape, one callee after the other, ms per 10^6 calls (best of 3)
  plain: 0.456 ms, x1.0, result 512370976
  direct eval, never run: 12.3 ms, x27.0, result 512370976
B: shared site, five callees, 10^5 calls
  plain: 0.416-0.424 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 1.26-1.30 ms/call, x2.98-3.13, result 51131728
  indirect eval, never run: 0.370-0.374 ms/call, x0.88-0.89, result 51131728
  new Function: 0.386-0.386 ms/call, x0.91-0.93, result 51131728
C: own loop per variant, 10^5 calls
  plain: 0.0492-0.0493 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 1.04-1.04 ms/call, x21.04-21.19, result 51131728
  indirect eval, never run: 0.0491-0.0491 ms/call, x1.00-1.00, result 51131728
  new Function: 0.0493-0.0501 ms/call, x1.00-1.02, result 51131728
```

JSC-bun:

```text
A: the catalog shape, one callee after the other, ms per 10^6 calls (best of 3)
  plain: 0.455 ms, x1.0, result 512370976
  direct eval, never run: 8.42 ms, x18.5, result 512370976
B: shared site, five callees, 10^5 calls
  plain: 0.431-0.437 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 0.871-0.882 ms/call, x2.00-2.04, result 51131728
  indirect eval, never run: 0.371-0.381 ms/call, x0.85-0.88, result 51131728
  new Function: 0.395-0.398 ms/call, x0.91-0.92, result 51131728
C: own loop per variant, 10^5 calls
  plain: 0.0488-0.0490 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 0.492-0.542 ms/call, x10.06-11.08, result 51131728
  indirect eval, never run: 0.0491-0.0500 ms/call, x1.00-1.02, result 51131728
  new Function: 0.0489-0.0491 ms/call, x1.00-1.01, result 51131728
```

JSC-page:

```text
A: the catalog shape, one callee after the other, ms per 10^6 calls (best of 3)
  plain: 0.457 ms, x1.0, result 512370976
  direct eval, never run: 12.6 ms, x27.6, result 512370976
B: shared site, five callees, 10^5 calls
  plain: 0.418-0.419 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 1.32-1.36 ms/call, x3.16-3.25, result 51131728
  indirect eval, never run: 0.364-0.366 ms/call, x0.87-0.87, result 51131728
  new Function: 0.387-0.390 ms/call, x0.93-0.93, result 51131728
C: own loop per variant, 10^5 calls
  plain: 0.0492-0.0494 ms/call, x1.00-1.00, result 51131728
  direct eval, never run: 1.06-1.07 ms/call, x21.57-21.63, result 51131728
  indirect eval, never run: 0.0493-0.0501 ms/call, x1.00-1.02, result 51131728
  new Function: 0.0492-0.0498 ms/call, x1.00-1.01, result 51131728
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-F10: calls of a + b: plain, inside a function with a direct eval that never runs, with an indirect eval that never runs, and new Function built once.
function plain(a, b, code) { const s = a + b; return s; }
function direct(a, b, code) { const s = a + b; if (code) eval(code); return s; }
function indirect(a, b, code) { const s = a + b; if (code) (0, eval)(code); return s; }
const built = new Function('a', 'b', 'code', 'const s = a + b; return s;');
function other(a, b, code) { return a - b; }
const codes = ['', ''];
// Part A: the shape of the V8 catalog's script. One call site, constant '' argument, each callee timed on its own after its own warm-up (plain first, so the site has only seen plain
// when plain is timed): 1e5 warm-up calls, then the best of 3 timings of at least 200 ms each, in ms per 10^6 calls.
function pair(f, n) { let s = 0; for (let i = 0; i < n; i++) s += f(i & 1023, 1, ''); return s; }
console.log('A: the catalog shape, one callee after the other, ms per 10^6 calls (best of 3)');
const tA = {};
for (const [name, f] of [['plain', plain], ['direct eval, never run', direct]]) {
  pair(f, 1e5); B(() => pair(f, 1e6));
  tA[name] = Math.min(B(() => pair(f, 1e6)), B(() => pair(f, 1e6)), B(() => pair(f, 1e6)));
  console.log(`  ${name}: ${tA[name].toPrecision(3)} ms, x${(tA[name] / tA.plain).toFixed(1)}, result ${pair(f, 1e6)}`);
}
// Part B: one call site shared by five different callees (so it is not monomorphic); the code string comes from an array, not a constant. 10^5 calls.
function shared(f) { let s = 0; for (let i = 0; i < 1e5; i++) s += f(i & 1023, 1, codes[i & 1]); return s; }
for (let i = 0; i < 2e4; i++) shared(other);
R('B: shared site, five callees, 10^5 calls', { plain: () => shared(plain), 'direct eval, never run': () => shared(direct), 'indirect eval, never run': () => shared(indirect), 'new Function': () => shared(built) });
// Part C: one generated loop per variant (its own comment, so its own call site and feedback), constant '' (the callee can be inlined). 10^5 calls.
const loop = (f, tag) => new Function('f', `/* ${tag} */ return () => { let s = 0; for (let i = 0; i < 1e5; i++) s += f(i & 1023, 1, ''); return s; };`)(f);
R('C: own loop per variant, 10^5 calls', { plain: loop(plain, 1), 'direct eval, never run': loop(direct, 2), 'indirect eval, never run': loop(indirect, 3), 'new Function': loop(built, 4) });
```
</details>

### 4.17 `JE-F11`: a short-lived `{ x, y }` from a helper

10⁶ steps, each either calling a helper that returns `{ x, y }` and reading both fields at once, or computing `x` and `y` as loose variables ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| loose variables, ms | 0.89 | 0.89 to 0.90 | 3.90 to 4.08 | 0.75 | 0.71 | 0.75 to 0.76 |
| `{ x, y }` from a helper | ×1.00 | ×1.00 | ×0.98 to 1.00 | ×1.00 | ×0.99 to 1.00 | ×1.00 |

The temporary object cost nothing measurable on any engine. For browser code: keep the small object; inlining it by hand gains nothing in any of the three engines.

<details><summary>Lab: <code>temp.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
10^6 steps
  loose variables: 0.890-0.902 ms/call, x1.00-1.00, result 348364963648
  { x, y } from a helper: 0.889-0.938 ms/call, x0.99-1.05, result 348364963648
```

V8-chrome:

```text
10^6 steps
  loose variables: 0.893-0.897 ms/call, x1.00-1.00, result 348364963648
  { x, y } from a helper: 0.894-0.907 ms/call, x1.00-1.02, result 348364963648
```

SM-firefox:

```text
10^6 steps
  loose variables: 4.08-4.29 ms/call, x1.00-1.00, result 348364963648
  { x, y } from a helper: 4.00-4.50 ms/call, x0.94-1.05, result 348364963648
```

JSC-mac:

```text
10^6 steps
  loose variables: 0.753-0.753 ms/call, x1.00-1.00, result 348364963648
  { x, y } from a helper: 0.751-0.761 ms/call, x1.00-1.01, result 348364963648
```

JSC-bun:

```text
10^6 steps
  loose variables: 0.712-0.730 ms/call, x1.00-1.00, result 348364963648
  { x, y } from a helper: 0.707-0.714 ms/call, x0.97-1.00, result 348364963648
```

JSC-page:

```text
10^6 steps
  loose variables: 0.755-0.766 ms/call, x1.00-1.00, result 348364963648
  { x, y } from a helper: 0.755-0.755 ms/call, x0.98-1.00, result 348364963648
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-F11: 10^6 calls of a helper that returns a short-lived { x, y } used at once, against two loose variables.
const pt = (i) => ({ x: i & 1023, y: (i + 1) & 1023 });
function withObject() { let s = 0; for (let i = 0; i < 1e6; i++) { const p = pt(i); s += p.x * p.y; } return s; }
function loose() { let s = 0; for (let i = 0; i < 1e6; i++) { const x = i & 1023, y = (i + 1) & 1023; s += x * y; } return s; }
R('10^6 steps', { 'loose variables': loose, '{ x, y } from a helper': withObject });
```
</details>

### 4.18 `JE-F12`: four loop forms, one huge call and many small calls

Sum of small integers with an index `for`, `for…of`, `forEach` and `reduce`. Workload A: the first call of a new copy of each function over 10⁷ items, three copies each (each copy has its own source text, so nothing is reused). Workload B: warmed code, 100 calls over 1,000 items per timing ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| A, index `for`, ms | 7.8 to 8.2 | 8.2 to 8.9 | 7.3 to 7.4 | 5.4 to 5.5 | 5.4 to 6.0 | 5.0 to 6.0 |
| A, `for…of`, ms | 58.8 to 69.2 | 65.4 to 69.8 | 27.7 to 28.6 | 25.1 to 26.6 | 10.6 to 11.7 | 13.0 to 14.0 |
| A, `forEach`, ms | 57.6 to 58.9 | 53.0 to 56.6 | 24.9 to 26.3 | 8.8 to 9.8 | 10.2 to 11.7 | 9.0 to 10.0 |
| A, `reduce`, ms | 50.7 to 52.1 | 50.3 to 53.5 | 9.1 to 9.4 | 8.0 to 8.1 | 8.8 to 9.8 | 8.0 |
| B, index `for`, ms per 100 calls | 0.053 to 0.057 | 0.067 to 0.069 | 0.068 to 0.069 | 0.049 to 0.053 | 0.049 to 0.051 | 0.049 to 0.050 |
| B, `for…of` | ×1.09 to 1.13 | ×0.94 to 0.98 | ×3.78 to 4.00 | ×2.38 to 2.45 | ×1.23 to 1.50 | ×1.22 to 1.50 |
| B, `forEach` | ×1.71 to 1.79 | ×2.55 to 2.68 | ×4.48 to 4.87 | ×1.55 to 1.61 | ×1.81 to 1.86 | ×1.70 to 1.74 |
| B, `reduce` | ×0.79 to 0.82 | ×0.97 to 1.01 | ×4.07 to 4.40 | ×1.35 to 1.42 | ×1.33 to 1.36 | ×1.04 to 1.06 |

On every engine the index `for` was the fastest form in A (5 to 9 ms against up to 69 ms). In B, `forEach` was 1.55 to 4.87 times the index loop on every engine, so the rule's "prefer an index loop to `forEach`" holds on all of them. The other forms, against the index loop, engine by engine (ratios of B, then of A):

- **V8-node:** `for…of` ×1.09 to 1.13 in B but 7 to 9 times in A; `reduce` ×0.79 to 0.82 in B (faster than the loop), 6 to 6.7 times in A.
- **V8-chrome:** `for…of` ×0.94 to 0.98 in B but 7 to 8.5 times in A; `reduce` ×0.97 to 1.01 in B, 5.7 to 6.5 times in A.
- **SM-firefox:** `for…of` ×3.8 to 4.0 in B and 3.7 to 3.9 in A; `reduce` ×4.1 to 4.4 in B but 1.2 to 1.3 in A; `forEach` the slowest in B.
- **JSC-mac:** `for…of` ×2.4 in B and 4.6 to 4.9 in A, slower than `forEach` in both workloads (×1.55 to 1.61 in B, 1.6 to 1.8 in A); `reduce` ×1.35 to 1.42 in B.
- **JSC-bun and JSC-page:** `for…of` ×1.2 to 1.5 in B and 1.8 to 2.8 in A; `reduce` ×1.04 to 1.36 in B (JSC-page 1.04 to 1.06, JSC-bun 1.33 to 1.36).

So the index `for` is the only form that was close to the index loop (within ×1.5) on every engine in both workloads. `for…of` was close only in B, on V8 and, at ×1.2 to 1.5, on JSC-bun and JSC-page; it was 2.4 to 4 times the index loop on SM-firefox and JSC-mac, where the rule's "or `for…of`" does not hold. For browser code: in a hot loop over a large array, use the index `for`; `for…of` is fine in Chrome's warmed loops, not in Firefox or the JavaScriptCore shell.

<details><summary>Lab: <code>loops.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
A, first call over 10^7 items, ms: index for 7.8-8.3 | for...of 68.6-73.7 | forEach 58.6-58.8 | reduce 51.5-51.6 | check 5940000000
B, warmed, 100 calls over 1,000 items, ms: index for 0.055-0.056 (x1.00-1.00) | for...of 0.061-0.061 (x1.09-1.12) | forEach 0.096-0.096 (x1.71-1.76) | reduce 0.044-0.045 (x0.81-0.81) | result 4950000
```

V8-chrome:

```text
A, first call over 10^7 items, ms: index for 8.2-8.8 | for...of 65.7-69.5 | forEach 53.0-53.6 | reduce 50.3-50.6 | check 5940000000
B, warmed, 100 calls over 1,000 items, ms: index for 0.068-0.071 (x1.00-1.00) | for...of 0.066-0.069 (x0.94-0.97) | forEach 0.180-0.192 (x2.55-2.70) | reduce 0.068-0.072 (x0.97-1.01) | result 4950000
```

SM-firefox:

```text
A, first call over 10^7 items, ms: index for 7.3-13.1 | for...of 27.8-46.3 | forEach 24.9-36.6 | reduce 9.4-36.0 | check 5940000000
B, warmed, 100 calls over 1,000 items, ms: index for 0.069-0.071 (x1.00-1.00) | for...of 0.268-0.277 (x3.81-4.01) | forEach 0.330-0.331 (x4.67-4.77) | reduce 0.301-0.302 (x4.25-4.36) | result 4950000
```

JSC-mac:

```text
A, first call over 10^7 items, ms: index for 5.4-6.7 | for...of 26.4-26.8 | forEach 8.9-14.0 | reduce 8.0-12.2 | check 5940000000
B, warmed, 100 calls over 1,000 items, ms: index for 0.049-0.050 (x1.00-1.00) | for...of 0.120-0.125 (x2.40-2.54) | forEach 0.079-0.085 (x1.58-1.73) | reduce 0.068-0.068 (x1.36-1.39) | result 4950000
```

JSC-bun:

```text
A, first call over 10^7 items, ms: index for 5.5-5.6 | for...of 10.6-10.8 | forEach 10.2-15.2 | reduce 8.9-13.6 | check 5940000000
B, warmed, 100 calls over 1,000 items, ms: index for 0.049-0.049 (x1.00-1.00) | for...of 0.061-0.061 (x1.25-1.25) | forEach 0.090-0.091 (x1.84-1.88) | reduce 0.066-0.067 (x1.35-1.37) | result 4950000
```

JSC-page:

```text
A, first call over 10^7 items, ms: index for 5.0-5.0 | for...of 13.0-13.0 | forEach 9.0-14.0 | reduce 8.0-13.0 | check 5940000000
B, warmed, 100 calls over 1,000 items, ms: index for 0.049-0.049 (x1.00-1.00) | for...of 0.061-0.062 (x1.25-1.26) | forEach 0.085-0.086 (x1.74-1.75) | reduce 0.052-0.052 (x1.06-1.07) | result 4950000
```

```js
// JE-F12: four loop forms summing small integers. A: the first call of a fresh copy over 10^7 items (3 fresh copies per form).
// B: warmed code, 100 calls over 1,000 items per timing (timing as in the other scripts: 200 ms per pass, 1 warm-up pass, 3 rounds).
const src = {
  'index for': 'let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s;',
  'for...of': 'let s = 0; for (const v of a) s += v; return s;',
  forEach: 'let s = 0; a.forEach((v) => { s += v; }); return s;',
  reduce: 'return a.reduce((s, v) => s + v, 0);',
};
let copies = 0;  // a unique comment per copy: identical source text shared feedback on V8 in this lab
const fresh = (k) => new Function('a', `/* ${copies++} */ ` + src[k]);
const big = Array.from({ length: 1e7 }, (_, i) => i % 100), small = Array.from({ length: 1000 }, (_, i) => i % 100);
const A = {}; let check = 0;
for (let r = 0; r < 3; r++) for (const k in src) { const f = fresh(k), t0 = performance.now(); check += f(big); (A[k] ??= []).push(performance.now() - t0); }
console.log('A, first call over 10^7 items, ms: ' + Object.keys(src).map((k) => `${k} ${Math.min(...A[k]).toFixed(1)}-${Math.max(...A[k]).toFixed(1)}`).join(' | ') + ' | check ' + check);
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
const fs = {}; for (const k in src) { const f = fresh(k); fs[k] = () => { let s = 0; for (let i = 0; i < 100; i++) s += f(small); return s; }; }
const T = {}; for (const k in fs) B(fs[k]);
for (let r = 0; r < 3; r++) for (const k in fs) (T[k] ??= []).push(B(fs[k]));
console.log('B, warmed, 100 calls over 1,000 items, ms: ' + Object.keys(fs).map((k) => `${k} ${Math.min(...T[k]).toFixed(3)}-${Math.max(...T[k]).toFixed(3)} (x${Math.min(...T[k].map((t, r) => t / T['index for'][r])).toFixed(2)}-${Math.max(...T[k].map((t, r) => t / T['index for'][r])).toFixed(2)})`).join(' | ') + ' | result ' + fs.reduce());
```
</details>

### 4.19 `JE-F6`: generated functions of 1,000 to 6,000 statements

A function made by `new Function` from k statements `s = ((s * 31) ^ (i + j)) | 0;` (j is the statement's number), called 100 times per timing after two 200 ms warm-up passes; time per statement, the lowest and highest of the three rounds over three runs ✅[^lab]. The statement mixes bits, so no compiler can fold the chain into a closed form. A first version of this script used `s = (s + i * j) | 0;`: the JavaScriptCore shell and page then ran 1,000 and 3,000 statements at 0.002 to 0.004 ns per statement, far below one machine instruction per statement, so the work had been removed and the jump to 4 ns at 6,000 statements measured nothing (§6.1).

| Statements | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| 1,000, ns per statement | 1.16 to 1.26 | 1.18 to 1.21 | 6.06 to 6.79 | 1.16 to 1.49 | 1.19 to 1.50 | 1.15 to 1.22 |
| 2,000 | 1.17 to 1.23 | 1.22 to 1.24 | 31.5 to 33.1 | 1.18 to 1.53 | 1.28 to 1.64 | 1.19 to 1.22 |
| 3,000 | 25.5 to 27.3 | 1.22 to 1.24 | 32.2 to 34.2 | 1.19 to 1.86 | 1.17 to 1.27 | 1.18 to 1.23 |
| 4,000 | 26.4 to 27.0 | 18.8 to 19.4 | 33.0 to 33.9 | 1.20 to 1.36 | 1.23 to 1.51 | 1.20 to 1.23 |
| 6,000 | 26.3 to 28.2 | 18.7 to 19.4 | 33.2 to 34.0 | 23.5 to 37.3 | 22.6 to 36.1 | 23.4 to 24.3 |

Every engine had a cliff: the time per statement stayed flat up to a size, then jumped by a factor of 5 or more and stayed high. The jump sat between 2,000 and 3,000 statements on V8-node (×21.6 to 22.1 per statement), between 3,000 and 4,000 on V8-chrome (×15.3 to 15.8), between 1,000 and 2,000 on SM-firefox (×5.0 to 5.2; its 1,000-statement function already cost 5 times what the other engines paid), and between 4,000 and 6,000 on the three JavaScriptCore environments (×15.9 to 26.6; the probe did not try sizes between 4,000 and 6,000). The result printed with each line is the same on every engine at each size. This lab does not say why. For browser code: keep generated functions to hundreds of statements, and split anything above about 1,000; Firefox's cliff came first and JavaScriptCore's last.

<details><summary>Lab: <code>bigfn.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
1000 statements: 1.212-1.255 ns per statement, result -888409912
2000 statements: 1.187-1.188 ns per statement, result 926616496
3000 statements: 25.628-26.545 ns per statement, result -1630339208
4000 statements: 26.393-26.516 ns per statement, result -1235650912
6000 statements: 26.810-27.954 ns per statement, result 374918352
```

V8-chrome:

```text
1000 statements: 1.191-1.194 ns per statement, result -888409912
2000 statements: 1.221-1.233 ns per statement, result 926616496
3000 statements: 1.222-1.238 ns per statement, result -1630339208
4000 statements: 19.148-19.250 ns per statement, result -1235650912
6000 statements: 18.991-19.380 ns per statement, result 374918352
```

SM-firefox:

```text
1000 statements: 6.148-6.793 ns per statement, result -888409912
2000 statements: 32.103-33.058 ns per statement, result 926616496
3000 statements: 32.216-34.190 ns per statement, result -1630339208
4000 statements: 33.028-33.857 ns per statement, result -1235650912
6000 statements: 33.853-33.950 ns per statement, result 374918352
```

JSC-mac:

```text
1000 statements: 1.163-1.164 ns per statement, result -888409912
2000 statements: 1.186-1.188 ns per statement, result 926616496
3000 statements: 1.524-1.864 ns per statement, result -1630339208
4000 statements: 1.216-1.249 ns per statement, result -1235650912
6000 statements: 31.300-31.582 ns per statement, result 374918352
```

JSC-bun:

```text
1000 statements: 1.185-1.398 ns per statement, result -888409912
2000 statements: 1.397-1.639 ns per statement, result 926616496
3000 statements: 1.171-1.195 ns per statement, result -1630339208
4000 statements: 1.250-1.273 ns per statement, result -1235650912
6000 statements: 26.261-36.095 ns per statement, result 374918352
```

JSC-page:

```text
1000 statements: 1.206-1.209 ns per statement, result -888409912
2000 statements: 1.202-1.212 ns per statement, result 926616496
3000 statements: 1.178-1.223 ns per statement, result -1630339208
4000 statements: 1.199-1.202 ns per statement, result -1235650912
6000 statements: 23.444-23.556 ns per statement, result 374918352
```

```js
// JE-F6: a generated function of k statements s = ((s * 31) ^ (i + j)) | 0, called 100 times per timing after two 200 ms warm-up passes: ns per statement.
// The statement mixes bits so that no compiler can fold the chain into a closed form.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
for (const k of [1000, 2000, 3000, 4000, 6000]) {
  const g = new Function('i', 'let s = 0;\n' + Array.from({ length: k }, (_, j) => `s = ((s * 31) ^ (i + ${j})) | 0;`).join('\n') + '\nreturn s;');
  const call = () => { let s = 0; for (let i = 0; i < 100; i++) s = (s + g(i)) | 0; return s; };
  B(call); B(call); const t = [0, 1, 2].map(() => B(call) * 1e6 / (100 * k));
  console.log(`${k} statements: ${Math.min(...t).toFixed(3)}-${Math.max(...t).toFixed(3)} ns per statement, result ${call()}`);
}
```
</details>

### 4.20 `JE-M1`: the warm-up curve

The same work for 15 rounds, 1,000 calls over 10,000 items per round, for three loop forms; the script prints ms per round and the first round from which all later rounds stay within 1.25 times the median of the last five ✅[^lab]:

| Form | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| index `for` | round 1 to 2 | round 2 | round 1 to 13 | round 1 to 5 | round 1 to 9 | round 1 |
| `forEach` | round 12 to 15 (26 → 10 ms) | round 2 | round 1 to 10 (38 to 52 ms, no step) | round 10 (22 → 7.7 ms) | round 10 (23 → 9 ms) | round 10 (23 → 8 ms) |
| `reduce` | round 13 (51 → 4.2 ms) | round 1 | round 1 to 14 (no step) | round 6 to 9 (9 → 6.7 ms) | round 2 to 7 | round 2 to 5 |

V8-node and the three JavaScriptCore environments sped up in a step: `forEach` after 11,000 calls on V8-node (between rounds 11 and 12 in every run; a later round 15 in one run only marks a noisy round) and after 9,000 calls on JavaScriptCore, `reduce` after 11,000 calls on V8-node and 5,000 on JSC-mac. In Chrome neither form stepped within 15,000 calls, and in Firefox `forEach` and `reduce` did not step down either: the "steady" round there only marks the end of noise (one round of 101 ms in run 3). For browser code: warm up for at least 20,000 calls before timing, on every engine; 2,000 calls would have timed the slow phase on V8 and JavaScriptCore.

<details><summary>Lab: <code>warmup.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
for     steady from round 2: 7.5 4.8 5.0 5.0 5.0 5.0 5.1 5.1 5.1 5.0 5.0 5.2 4.8 5.2 5.1
forEach steady from round 12: 44.4 25.8 25.8 25.8 25.9 26.0 27.9 26.2 25.9 25.8 24.3 10.2 10.5 10.2 10.2
reduce  steady from round 13: 51.9 51.1 50.9 51.1 51.2 51.1 69.4 51.7 51.3 51.1 51.1 7.9 4.2 4.4 4.4
check 22275000000
```

V8-chrome:

```text
for     steady from round 2: 9.3 7.2 6.9 6.8 6.9 6.7 6.7 6.8 6.9 6.8 6.8 6.8 6.8 6.7 6.8
forEach steady from round 2: 47.0 29.7 30.1 29.4 30.7 30.8 30.5 30.4 30.7 30.7 30.7 30.9 30.5 31.9 30.7
reduce  steady from round 1: 57.4 50.7 50.6 50.1 50.3 50.4 50.5 50.6 50.3 50.7 50.3 50.3 52.2 51.2 50.6
check 22275000000
```

SM-firefox:

```text
for     steady from round 1: 7.6 7.1 7.2 7.1 6.9 7.1 8.1 7.1 7.3 7.8 7.0 7.1 7.3 6.7 6.7
forEach steady from round 1: 41.5 39.7 42.0 40.2 39.2 42.8 43.8 41.3 45.9 42.4 40.8 39.5 38.9 38.3 38.1
reduce  steady from round 10: 35.0 31.4 32.0 31.7 31.1 32.2 33.4 31.3 38.0 31.0 31.3 32.1 29.8 29.4 30.3
check 22275000000
```

JSC-mac:

```text
for     steady from round 2: 7.4 4.9 4.8 4.9 4.9 4.8 4.8 4.8 4.8 4.8 4.8 4.8 4.8 4.9 4.9
forEach steady from round 10: 27.6 22.6 22.4 22.4 22.3 22.8 22.8 22.8 20.1 7.6 7.7 7.7 7.6 7.6 7.7
reduce  steady from round 6: 11.1 8.9 8.9 8.9 9.0 6.8 6.7 6.8 6.8 6.8 6.6 6.7 6.7 6.7 6.7
check 22275000000
```

JSC-bun:

```text
for     steady from round 2: 7.4 5.0 4.9 4.8 4.9 4.8 4.8 4.8 4.8 4.9 4.8 4.8 4.8 4.8 4.8
forEach steady from round 10: 25.4 23.1 23.0 23.0 23.0 23.0 22.9 23.5 20.6 9.0 8.9 8.9 8.9 8.9 8.9
reduce  steady from round 2: 9.6 7.5 7.5 7.6 7.5 6.4 6.5 6.5 6.5 6.5 6.5 6.5 6.5 6.5 6.4
check 22275000000
```

JSC-page:

```text
for     steady from round 1: 6.0 5.0 5.0 5.0 4.0 5.0 4.0 5.0 4.0 5.0 5.0 4.0 5.0 5.0 5.0
forEach steady from round 10: 23.0 23.0 23.0 22.0 23.0 22.0 23.0 22.0 21.0 8.0 8.0 9.0 8.0 9.0 8.0
reduce  steady from round 5: 9.0 6.0 6.0 7.0 6.0 6.0 5.0 6.0 5.0 5.0 6.0 5.0 5.0 5.0 5.0
check 22275000000
```

```js
// JE-M1: the same work for 15 rounds (1,000 calls over 10,000 items per round, per form): ms per round, and the first round
// from which every later round is within 1.25 times the median of the last 5.
const forms = {
  for: (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; },
  forEach: (a) => { let s = 0; a.forEach((v) => { s += v; }); return s; },
  reduce: (a) => a.reduce((s, v) => s + v, 0),
};
const arr = Array.from({ length: 10000 }, (_, i) => i % 100), rounds = {}; let check = 0;
for (let r = 0; r < 15; r++) for (const k in forms) { const t0 = performance.now(); for (let c = 0; c < 1000; c++) check += forms[k](arr); (rounds[k] ??= []).push(performance.now() - t0); }
for (const k in rounds) {
  const t = rounds[k], m = t.slice(-5).sort((x, y) => x - y)[2]; let steady = t.length;
  while (steady > 0 && t[steady - 1] <= 1.25 * m) steady--;
  console.log(`${k.padEnd(7)} steady from round ${steady + 1}: ${t.map((x) => x.toFixed(1)).join(' ')}`);
}
console.log('check ' + check);
```
</details>

### 4.21 `JL-L1` / `JL-L2`: an array chain, one loop and iterator helpers

`filter` → `map` → `reduce` over 10⁶ small integers, the same work in one index loop, and the same chain with iterator helpers (`values().filter().map().reduce()`); time only ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| one loop, ms | 0.58 to 0.67 | 0.46 to 0.49 | 1.04 to 1.14 | 0.74 to 0.79 | 0.74 to 0.79 | 0.74 to 0.78 |
| chain | ×22.9 to 24.7 | ×25.9 to 27.1 | ×4.11 to 5.35 | ×2.65 to 2.74 | ×2.86 to 3.04 | ×2.40 to 2.56 |
| iterator helpers | ×35.5 to 38.1 | ×50.0 to 54.0 | ×15.6 to 16.3 | ×12.6 to 12.7 | ×12.6 to 12.8 | ×12.3 to 13.0 (one run of six ×44) |

One loop was the fastest everywhere: 23 to 27 times faster than the chain on V8, 4.1 to 5.4 times on SpiderMonkey, 2.4 to 3.0 on JavaScriptCore. Iterator helpers were slower than the chain on every engine (1.5 to 5.2 times the chain; in one WebKit-page run of six the helpers took 33 to 39 ms per call, 44 times the loop, and the five others 12.3 to 13.0). This lab timed the forms; the bytes that `JL-L2` is about were not measured here. For browser code: on a large array in a hot path, one loop pays on all three engines; iterator helpers over an in-memory array are the slowest form everywhere.

<details><summary>Lab: <code>chain.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
over 10^6 elements
  one loop: 0.585-1.13 ms/call, x1.00-1.00, result 255435488
  chain: 14.2-14.3 ms/call, x12.61-24.34, result 255435488
  iterator helpers: 22.0-22.7 ms/call, x19.71-37.69, result 255435488
```

V8-chrome:

```text
over 10^6 elements
  one loop: 0.459-0.487 ms/call, x1.00-1.00, result 255435488
  chain: 12.4-12.8 ms/call, x25.50-26.99, result 255435488
  iterator helpers: 24.8-25.9 ms/call, x50.96-54.16, result 255435488
```

SM-firefox:

```text
over 10^6 elements
  one loop: 1.04-1.14 ms/call, x1.00-1.00, result 255435488
  chain: 4.43-4.92 ms/call, x4.19-4.36, result 255435488
  iterator helpers: 16.8-17.2 ms/call, x15.10-16.05, result 255435488
```

JSC-mac:

```text
over 10^6 elements
  one loop: 0.742-0.789 ms/call, x1.00-1.00, result 255435488
  chain: 1.97-7.94 ms/call, x2.66-10.06, result 255435488
  iterator helpers: 9.37-10.3 ms/call, x12.61-13.12, result 255435488
```

JSC-bun:

```text
over 10^6 elements
  one loop: 0.739-0.784 ms/call, x1.00-1.00, result 255435488
  chain: 2.12-2.88 ms/call, x2.72-3.67, result 255435488
  iterator helpers: 9.30-9.81 ms/call, x11.88-12.62, result 255435488
```

JSC-page:

```text
over 10^6 elements
  one loop: 0.746-0.760 ms/call, x1.00-1.00, result 255435488
  chain: 1.79-1.86 ms/call, x2.36-2.47, result 255435488
  iterator helpers: 9.52-9.67 ms/call, x12.52-12.81, result 255435488
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JL-L1 / JL-L2: filter -> map -> reduce, one index loop, and iterator helpers over 10^6 small integers.
const src = Array.from({ length: 1e6 }, (_, i) => i);
const isEven = (x) => (x & 1) === 0, low = (x) => x & 1023, add = (a, b) => (a + b) | 0;
R('over 10^6 elements', {
  'one loop': () => { let s = 0; for (let i = 0; i < src.length; i++) { const x = src[i]; if (isEven(x)) s = add(s, low(x)); } return s; },
  chain: () => src.filter(isEven).map(low).reduce(add, 0),
  'iterator helpers': () => src.values().filter(isEven).map(low).reduce(add, 0),
});
```
</details>

### 4.22 `JL-L3`: `filter(p)[0]` against `find(p)`

Predicate calls on 100,000 elements whose first match is at index 10 ✅[^lab]: `filter(p)[0]` made 100,000 calls and `find(p)` 11, on all six environments, in all three runs. The specification fixes this: `find` returns as soon as the predicate returns a truthy value, and `filter` visits every index ✅[^tc39arr]. For browser code: `find`, `some` and `every` stop early in every engine.

<details><summary>Lab: <code>find.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node, V8-chrome, SM-firefox, JSC-mac, JSC-bun, JSC-page (identical output):

```text
filter(p)[0]: 100000 predicate calls, result 10 | find(p): 11 predicate calls, result 10
```

```js
// JL-L3: predicate calls of filter(p)[0] against find(p), 100,000 elements, first match at index 10.
const a = Array.from({ length: 1e5 }, (_, i) => i);
let calls = 0; const p = (x) => { calls++; return x >= 10; };
const r1 = a.filter(p)[0], c1 = calls; calls = 0; const r2 = a.find(p), c2 = calls;
console.log(`filter(p)[0]: ${c1} predicate calls, result ${r1} | find(p): ${c2} predicate calls, result ${r2}`);
```
</details>

### 4.23 `JL-L4`: comparator calls of `sort`

Comparator calls when sorting the catalog's 10,000 seeded rows by a string key, and 10,000 integers, the same in all three runs of each environment ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| rows | 119,955 | 119,784 | 126,592 | 120,378 | 120,691 | 120,691 |
| integers | 119,983 | 119,803 | 128,762 | 120,594 | 120,727 | 120,727 |

Every engine called the comparator about n · log₂ n times (132,877 for n = 10,000): 0.90 to 0.97 of it. The exact count is each engine's own, because the specification leaves the sequence of comparator calls to the implementation ✅[^tc39arr]. The counts were the same in six runs of each environment. A comparator that derives a key from each of its two arguments computes 24 to 26 keys per element on every engine (2 × the calls ÷ 10,000); computing the keys once first computes 10,000 in all, one per element: that second figure follows from the code and was not timed here. For browser code: a key computed inside the comparator is computed about 24 times per element on every engine; compute it once per element.

<details><summary>Lab: <code>sort.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
rows: 119955 comparator calls (first User100217819) | integers: 119983 comparator calls | n log2 n = 132877
```

V8-chrome:

```text
rows: 119784 comparator calls (first User100217819) | integers: 119803 comparator calls | n log2 n = 132877
```

SM-firefox:

```text
rows: 126592 comparator calls (first User100217819) | integers: 128762 comparator calls | n log2 n = 132877
```

JSC-mac:

```text
rows: 120378 comparator calls (first User100217819) | integers: 120594 comparator calls | n log2 n = 132877
```

JSC-bun, JSC-page (identical output):

```text
rows: 120691 comparator calls (first User100217819) | integers: 120727 comparator calls | n log2 n = 132877
```

```js
// JL-L4: comparator calls of sort on 10,000 seeded rows (string keys) and on 10,000 integers.
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const rows = Array.from({ length: 10000 }, () => ({ name: 'User' + Math.floor(rnd() * 1e9) }));
let c = 0; const sorted = rows.slice().sort((a, b) => { c++; return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
let c2 = 0; Array.from({ length: 10000 }, (_, i) => (i * 7919) % 10007).sort((a, b) => { c2++; return a - b; });
console.log(`rows: ${c} comparator calls (first ${sorted[0].name}) | integers: ${c2} comparator calls | n log2 n = ${Math.round(10000 * Math.log2(10000))}`);
```
</details>

### 4.24 `JL-L5`: `Error.stackTraceLimit` and the cost of `new Error().stack`

Frames in `new Error().stack` read 50 calls deep, with the default limit, after `Error.stackTraceLimit = Infinity` and after `= 0`; then the time of 1,000 errors made 20 calls deep and their `.stack` read, against 1,000 plain objects at the same depth (lowest and highest of three rounds, µs per 1,000) ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| default `Error.stackTraceLimit` | 10 | 10 | 128 | 100 | 10 | 100 |
| frames, default | 10 | 10 | 52 | 52 | 2 | 52 |
| frames, `Infinity` | 59 | 52 | 52 | 52 | 2 | 52 |
| frames, `0` | 0 | 0 | 0 | 0, `stack` is `undefined` | 0, `stack` is `undefined` | 0, `stack` is `undefined` |
| 1,000 errors with `.stack`, µs | 6,645 to 6,798 | 2,441 to 2,513 | 3,519 to 3,951 | 2,091 to 2,210 | 1,693 to 1,834 | 3,125 to 3,274 |
| 1,000 plain objects, µs | 105 to 107 | 95 to 98 | 104 to 113 | 54 to 56 | 41 to 42 | 54 to 60 |

With the limit at 0, every engine gave no frames. The table's default frame counts are capped by the 50 calls of the script, so they do not show whether a default of 128 or 100 is honoured: a second script (below) made a 300-call recursion that is not in tail position and set the limit to 5, 60, 1,000, `Infinity` and 0 in turn. V8-node, V8-chrome, JSC-bun and JSC-page followed each limit (5 and 60 frames, then every frame, 309 or 302; then 0). SM-firefox followed 5 and 60 and returned 128 frames for 1,000 and for `Infinity`, the same as its default of 128. The JSC-mac shell gave 100 frames by default and 5 for the limit 5, then kept giving 5 for 60, 1,000, `Infinity` and 0 (in a third script it kept the first limit it was given): in that shell a changed limit is not always followed, and this lab does not know why. Defaults differ: 10 on V8 and in Bun, 100 in the JavaScriptCore shell and page, 128 in Firefox. `Error.stackTraceLimit` is not in the specification: MDN calls it non-standard, part of V8's stack trace API, also implemented by JavaScriptCore ✅[^mdnstack]. With a limit of 0, JavaScriptCore set `stack` to `undefined`, so code that calls `err.stack.split(…)` throws there. Bun showed 2 frames whatever the limit in the first script: Bun ran the file in strict mode (`this` is `undefined` in a plain function call there, not in the JavaScriptCore shell ✅[^lab]), and in strict mode JavaScriptCore drops the frames of calls made from tail position, as the recursion here is ✅[^ptc]. Both checks agree: the same 50-call tail recursion in a file that starts with `'use strict'` gave 2 frames in the JSC-mac shell and in Bun (third script), and the second script's non-tail recursion gave 5, 60 and 302 frames in Bun ✅[^lab]. An error with its stack cost 26 to 64 times a plain object on every engine (2 to 7 µs per error). For browser code: keep errors off routine paths everywhere; leave `Error.stackTraceLimit` alone, and never set it to 0 where JavaScriptCore runs.

<details><summary>Lab: <code>stack.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
Error.stackTraceLimit is 10 (number) | default: 10 frames
after = Infinity: 59 frames
after = 0: 0 frames
new Error().stack, 20 deep: 6702.01-6734.15 us per call
plain object, 20 deep: 104.94-106.18 us per call
```

V8-chrome:

```text
Error.stackTraceLimit is 10 (number) | default: 10 frames
after = Infinity: 52 frames
after = 0: 0 frames
new Error().stack, 20 deep: 2502.50-2512.50 us per call
plain object, 20 deep: 94.92-95.83 us per call
```

SM-firefox:

```text
Error.stackTraceLimit is 128 (number) | default: 52 frames
after = Infinity: 52 frames
after = 0: 0 frames
new Error().stack, 20 deep: 3566.32-3950.59 us per call
plain object, 20 deep: 103.59-113.42 us per call
```

JSC-mac:

```text
Error.stackTraceLimit is 100 (number) | default: 52 frames
after = Infinity: 52 frames
after = 0: stack undefined, 0 frames
new Error().stack, 20 deep: 2102.29-2107.16 us per call
plain object, 20 deep: 53.60-55.97 us per call
```

JSC-bun:

```text
Error.stackTraceLimit is 10 (number) | default: 2 frames
after = Infinity: 2 frames
after = 0: stack undefined, 0 frames
new Error().stack, 20 deep: 1706.65-1833.93 us per call
plain object, 20 deep: 40.99-42.08 us per call
```

JSC-page:

```text
Error.stackTraceLimit is 100 (number) | default: 52 frames
after = Infinity: 52 frames
after = 0: stack undefined, 0 frames
new Error().stack, 20 deep: 3140.63-3258.06 us per call
plain object, 20 deep: 55.43-59.88 us per call
```

```js
// JL-L5: frames in new Error().stack thrown 50 calls deep, with the default Error.stackTraceLimit, Infinity and 0; cost per error.
const frames = (st) => st === undefined ? 'stack undefined, 0' : st.split('\n').filter((l) => /^\s+at |@/.test(l)).length;
const deep = (n) => (n === 0 ? new Error('x').stack : deep(n - 1));
const dflt = Error.stackTraceLimit;
console.log(`Error.stackTraceLimit is ${dflt} (${typeof dflt}) | default: ${frames(deep(50))} frames`);
Error.stackTraceLimit = Infinity; console.log(`after = Infinity: ${frames(deep(50))} frames`);
Error.stackTraceLimit = 0; console.log(`after = 0: ${frames(deep(50))} frames`);
Error.stackTraceLimit = dflt;
let sink = 0; const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
const v = { 'new Error().stack, 20 deep': () => { let s = 0; for (let i = 0; i < 1000; i++) s += ((d) => { const g = (k) => (k ? g(k - 1) : new Error('x').stack.length); return g(d); })(20); return s; },
  'plain object, 20 deep': () => { let s = 0; for (let i = 0; i < 1000; i++) s += ((d) => { const g = (k) => (k ? g(k - 1) : { reason: 'x' }.reason.length); return g(d); })(20); return s; } };
for (const k in v) { B(v[k]); const t = [0, 1, 2].map(() => B(v[k]) * 1000); console.log(`${k}: ${Math.min(...t).toFixed(2)}-${Math.max(...t).toFixed(2)} us per call`); }
```
</details>

<details><summary>Lab: <code>stack-limit.js</code> and <code>stack-strict.js</code>, output of run 1 on each environment that ran them, then the scripts</summary>

V8-node:

```text
default value 10 frames 10
limit 5 frames 5
limit 60 frames 60
limit 1000 frames 309
limit Infinity frames 309
limit 0 frames 0
strict: false
```

V8-chrome:

```text
default value 10 frames 10
limit 5 frames 5
limit 60 frames 60
limit 1000 frames 302
limit Infinity frames 302
limit 0 frames 0
strict: false
```

SM-firefox:

```text
default value 128 frames 128
limit 5 frames 5
limit 60 frames 60
limit 1000 frames 128
limit Infinity frames 128
limit 0 frames 0
strict: false
```

JSC-mac:

```text
default value 100 frames 100
limit 5 frames 5
limit 60 frames 5
limit 1000 frames 5
limit Infinity frames 5
limit 0 frames 5
strict: false
```

JSC-bun:

```text
default value 10 frames 10
limit 5 frames 5
limit 60 frames 60
limit 1000 frames 302
limit Infinity frames 302
limit 0 frames 0
strict: true
```

JSC-page:

```text
default value 100 frames 100
limit 5 frames 5
limit 60 frames 60
limit 1000 frames 302
limit Infinity frames 302
limit 0 frames 0
strict: false
```

```js
// JL-L5, second script: a recursion 300 calls deep, not in tail position, with Error.stackTraceLimit at its default, then 5, 60, 1000, Infinity and 0.
const frames = (st) => st === undefined ? 'undefined' : st.split('\n').filter((l) => /^\s+at |@/.test(l)).length;
const deep = (n) => (n === 0 ? new Error('x').stack : deep(n - 1) + '');
const dflt = Error.stackTraceLimit;
console.log('default value ' + dflt + ' frames ' + frames(deep(300)));
for (const lim of [5, 60, 1000, Infinity, 0]) { Error.stackTraceLimit = lim; console.log('limit ' + lim + ' frames ' + frames(deep(300))); }
Error.stackTraceLimit = dflt;
console.log('strict: ' + (function () { return this === undefined; })());
```

The third script, in the JSC-mac shell and in Bun:

JSC-mac:

```text
strict file, tail recursion 50 deep, default: 2 frames
```

JSC-bun:

```text
strict file, tail recursion 50 deep, default: 2 frames
```

```js
'use strict';
// JL-L5, third script: the first script's recursion, 50 calls deep and in tail position, in a file that starts with 'use strict'.
const frames = (st) => st === undefined ? 'undefined' : st.split('\n').filter((l) => /^\s+at |@/.test(l)).length;
const deep = (n) => (n === 0 ? new Error('x').stack : deep(n - 1));
console.log('strict file, tail recursion 50 deep, default: ' + frames(deep(50)) + ' frames');
```
</details>

### 4.25 `JL-L6`: the largest array a spread call accepts

The largest array that `Math.max(...arr)` and `fn.apply(null, arr)` accepted from a top-level call, by doubling from 1,024 until a throw and then bisecting; the doubling step that failed threw a `RangeError` in every run ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| `Math.max(...arr)` | 124,539 | 123,681 to 123,683 | 524,287 | 638,728 | 638,454 | 638,722 |
| `fn.apply(null, arr)` | 124,541 | 123,683 to 123,685 | 500,000 | 638,720 | 638,452 | 638,714 |

Every engine has a limit, and V8's was the lowest, about 124,000. These are the limits of these builds, for a call made from the top level of the script; the lab did not vary the call depth or the stack size, so a deeper call, or a build or setting with another stack size, can accept fewer (or more) elements. The counts were the same in each run of an environment, except Chrome's (123,681 to 123,685). Firefox's `apply` limit was exactly 500,000 and its spread limit 2¹⁹ − 1. For browser code: an array whose size comes from data can throw in every engine; Chrome throws first.

<details><summary>Lab: <code>spread.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
Math.max(...arr): largest accepted 124539, then RangeError
fn.apply(null, arr): largest accepted 124541, then RangeError
```

V8-chrome:

```text
Math.max(...arr): largest accepted 123681, then RangeError
fn.apply(null, arr): largest accepted 123683, then RangeError
```

SM-firefox:

```text
Math.max(...arr): largest accepted 524287, then RangeError
fn.apply(null, arr): largest accepted 500000, then RangeError
```

JSC-mac:

```text
Math.max(...arr): largest accepted 638728, then RangeError
fn.apply(null, arr): largest accepted 638720, then RangeError
```

JSC-bun:

```text
Math.max(...arr): largest accepted 638454, then RangeError
fn.apply(null, arr): largest accepted 638452, then RangeError
```

JSC-page:

```text
Math.max(...arr): largest accepted 638722, then RangeError
fn.apply(null, arr): largest accepted 638714, then RangeError
```

```js
// JL-L6: the largest array that Math.max(...arr) and fn.apply(null, arr) accept: double from 1,024 until it throws, then bisect.
const ok = (f, n) => { try { f(new Array(n).fill(1)); return true; } catch (e) { return e.constructor.name; } };
function largest(f) {
  let lo = 1024, hi = 2048, err;
  while ((err = ok(f, hi)) === true) { lo = hi; hi *= 2; if (hi > 2 ** 27) return [`>= ${lo}`, 'none']; }
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ok(f, mid) === true) lo = mid; else hi = mid; }
  return [lo, err];
}
const fn = function () { return arguments.length; };
for (const [label, f] of [['Math.max(...arr)', (a) => Math.max(...a)], ['fn.apply(null, arr)', (a) => fn.apply(null, a)]]) {
  const [n, err] = largest(f); console.log(`${label}: largest accepted ${n}, then ${err}`);
}
```
</details>

### 4.26 `JL-L7` / `JL-L8`: work that grows fourfold when n doubles

`includes` on an n-element array inside a loop over n queries, against a `Set` built once; a `reduce` that returns `[...acc, x]`, against one that pushes. Lowest ms per call of three rounds at n = 2,000 and 4,000; ranges over six runs (the lab's three and three re-runs) ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| `includes` in a loop, n = 4,000, ms | 3.15 to 3.24 | 1.55 to 1.62 | 6.77 to 6.97 | 4.81 to 4.96 | 2.15 to 2.36 | 4.83 to 4.95 |
| growth from n = 2,000 | ×3.92 to 4.12 | ×3.85 to 3.99 | ×3.64 to 3.90 | ×3.94 to 4.04 | ×3.95 to 4.10 | ×3.92 to 3.96 |
| `Set` built once, n = 4,000, ms | 0.150 to 0.172 | 0.136 to 0.142 | 0.073 to 0.090 | 0.061 to 0.083 | 0.055 to 0.058 | 0.061 to 0.063 |
| `[...acc, x]`, n = 4,000, ms | 7.41 to 7.65 | 5.60 to 6.34 | 29.0 to 29.8 | 12.4 to 13.4 | 12.5 to 13.2 | 12.4 to 13.1 |
| growth from n = 2,000 | ×3.24 to 3.69 | ×4.30 to 4.74 | ×3.79 to 3.96 | ×3.40 to 3.72 | ×3.48 to 4.20 | ×3.74 to 3.86 |
| `push`, n = 4,000, ms | 0.0100 to 0.0110 | 0.0088 to 0.0090 | 0.0152 to 0.0154 | 0.0108 to 0.0116 | 0.0110 to 0.0135 | 0.0126 to 0.0130 |

Both quadratic forms grew 3.2 to 4.7 times when n doubled on every engine (a linear cost grows 2 times), and at n = 4,000 they were 11 to 95 times (`includes`) and 620 to 1,960 times (`[...acc, x]`) slower than the fix. For browser code: these two rules are about the algorithm, and they hold on every engine.

<details><summary>Lab: <code>quadratic.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
includes in a loop: n=2000 0.797 ms, n=4000 3.16 ms, growth x3.97
Set built once: n=2000 0.0587 ms, n=4000 0.150 ms, growth x2.55
reduce with [...acc, x]: n=2000 2.02 ms, n=4000 7.44 ms, growth x3.69
reduce with push: n=2000 0.00600 ms, n=4000 0.0100 ms, growth x1.67
```

V8-chrome:

```text
includes in a loop: n=2000 0.399 ms, n=4000 1.57 ms, growth x3.94
Set built once: n=2000 0.0565 ms, n=4000 0.138 ms, growth x2.44
reduce with [...acc, x]: n=2000 1.25 ms, n=4000 5.60 ms, growth x4.49
reduce with push: n=2000 0.00509 ms, n=4000 0.00876 ms, growth x1.72
```

SM-firefox:

```text
includes in a loop: n=2000 1.82 ms, n=4000 6.79 ms, growth x3.74
Set built once: n=2000 0.0267 ms, n=4000 0.0774 ms, growth x2.90
reduce with [...acc, x]: n=2000 7.45 ms, n=4000 29.1 ms, growth x3.90
reduce with push: n=2000 0.00778 ms, n=4000 0.0152 ms, growth x1.95
```

JSC-mac:

```text
includes in a loop: n=2000 1.22 ms, n=4000 4.82 ms, growth x3.95
Set built once: n=2000 0.0349 ms, n=4000 0.0652 ms, growth x1.87
reduce with [...acc, x]: n=2000 3.39 ms, n=4000 12.4 ms, growth x3.67
reduce with push: n=2000 0.00650 ms, n=4000 0.0108 ms, growth x1.66
```

JSC-bun:

```text
includes in a loop: n=2000 0.544 ms, n=4000 2.15 ms, growth x3.95
Set built once: n=2000 0.0311 ms, n=4000 0.0546 ms, growth x1.76
reduce with [...acc, x]: n=2000 3.52 ms, n=4000 13.2 ms, growth x3.76
reduce with push: n=2000 0.00613 ms, n=4000 0.0110 ms, growth x1.79
```

JSC-page:

```text
includes in a loop: n=2000 1.23 ms, n=4000 4.86 ms, growth x3.96
Set built once: n=2000 0.0335 ms, n=4000 0.0609 ms, growth x1.82
reduce with [...acc, x]: n=2000 3.31 ms, n=4000 12.4 ms, growth x3.75
reduce with push: n=2000 0.00650 ms, n=4000 0.0129 ms, growth x1.99
```

```js
// JL-L7 / JL-L8: includes on an array inside a loop against a Set; [...acc, x] in a reduce against push. ms per call at n and 2n.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
const ids = (n) => Array.from({ length: n }, (_, i) => i * 3);
const cases = {
  'includes in a loop': (n) => { const a = ids(n), q = ids(n); return () => { let c = 0; for (const x of q) if (a.includes(x + 1)) c++; return c + q.length; }; },
  'Set built once': (n) => { const a = ids(n), q = ids(n); return () => { const s = new Set(a); let c = 0; for (const x of q) if (s.has(x + 1)) c++; return c + q.length; }; },
  'reduce with [...acc, x]': (n) => { const a = ids(n); return () => a.reduce((acc, x) => [...acc, x], []).length; },
  'reduce with push': (n) => { const a = ids(n); return () => a.reduce((acc, x) => (acc.push(x), acc), []).length; },
};
for (const k in cases) {
  const t = [2000, 4000].map((n) => { const f = cases[k](n); B(f); return Math.min(B(f), B(f), B(f)); });
  console.log(`${k}: n=2000 ${t[0].toPrecision(3)} ms, n=4000 ${t[1].toPrecision(3)} ms, growth x${(t[1] / t[0]).toFixed(2)}`);
}
```
</details>

### 4.27 `JL-L10`: `#private` against public fields

10⁶ reads of `this.v` against `this.#v` inside a method of two otherwise equal classes, in one process with the rounds interleaved (the skill advises separate processes on V8; interleaving the rounds and giving each class its own method served the same purpose here) ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| public, ms | 0.53 to 0.55 | 0.85 to 0.91 | 0.64 to 0.67 | 0.30 | 0.30 | 0.30 |
| `#private` | ×0.97 to 1.01 | ×0.94 to 1.02 | ×0.97 to 1.02 | ×1.07 to 1.16 | ×1.07 to 1.08 | ×1.00 to 1.16 |

The same speed on V8 and SpiderMonkey (within 6 % either way); up to 16 % slower on JavaScriptCore (7 to 16 % in the shell, 7 to 8 % in Bun, 0 to 16 % in the page), about 0.05 ms per 10⁶ reads. For browser code: choose `#` fields for privacy; the cost is nil or a few nanoseconds per thousand reads.

<details><summary>Lab: <code>private.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
10^6 reads in a method
  public: 0.525-0.593 ms/call, x1.00-1.00, result 1000000
  #private: 0.524-0.594 ms/call, x1.00-1.00, result 1000000
```

V8-chrome:

```text
10^6 reads in a method
  public: 0.850-0.894 ms/call, x1.00-1.00, result 1000000
  #private: 0.864-0.895 ms/call, x1.00-1.02, result 1000000
```

SM-firefox:

```text
10^6 reads in a method
  public: 0.642-0.704 ms/call, x1.00-1.00, result 1000000
  #private: 0.634-0.670 ms/call, x0.94-0.99, result 1000000
```

JSC-mac:

```text
10^6 reads in a method
  public: 0.297-0.298 ms/call, x1.00-1.00, result 1000000
  #private: 0.345-0.353 ms/call, x1.16-1.19, result 1000000
```

JSC-bun:

```text
10^6 reads in a method
  public: 0.295-0.296 ms/call, x1.00-1.00, result 1000000
  #private: 0.319-0.324 ms/call, x1.08-1.10, result 1000000
```

JSC-page:

```text
10^6 reads in a method
  public: 0.297-0.297 ms/call, x1.00-1.00, result 1000000
  #private: 0.319-0.355 ms/call, x1.08-1.20, result 1000000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JL-L10: 10^6 reads of a #private field against a public field, each through a method of its own class.
class Pub { constructor() { this.v = 1; } sum() { let s = 0; for (let i = 0; i < 1e6; i++) s += this.v; return s; } }
class Priv { #v; constructor() { this.#v = 1; } sum() { let s = 0; for (let i = 0; i < 1e6; i++) s += this.#v; return s; } }
const a = new Pub(), b = new Priv();
R('10^6 reads in a method', { public: () => a.sum(), '#private': () => b.sum() });
```
</details>

### 4.28 `JL-A1` / `JL-A2`: microtask turns of `await`

Turns of a competing microtask chain while 1,000 steps of each form run ✅[^lab]: a synchronous loop 1; `await` on a plain value 1,001; `await` on an `async` adder 1,001; `await` on a native promise 1,001; `await f()` where `f` does `return p` 3,001; where it does `return await p` 2,001. The six counts were the same on all six environments in all three runs (JSC-mac with `Promise.resolve().then` in place of `queueMicrotask`). For browser code: each `await` costs one turn on every engine, and `return await p` takes one turn fewer than `return p` everywhere.

<details><summary>Lab: <code>await.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node, V8-chrome, SM-firefox, JSC-bun, JSC-page (identical output):

```text
queueMicrotask: native
sync loop, no await            1
await on each plain value      1001
await asyncAdd() per element   1001
await on a native promise      1001
await f(), f does return p     3001
await f(), f does return await 2001
```

JSC-mac:

```text
queueMicrotask: Promise.resolve().then
sync loop, no await            1
await on each plain value      1001
await asyncAdd() per element   1001
await on a native promise      1001
await f(), f does return p     3001
await f(), f does return await 2001
```

```js
// JL-A1 / JL-A2: turns of a competing microtask chain while each variant runs (1,000 steps each).
globalThis.__manualFinish = true;
const q = globalThis.queueMicrotask || ((f) => Promise.resolve().then(f));
async function countTicks(work) {
  let ticks = 0, done = false; const spin = () => { if (!done) { ticks++; q(spin); } };
  q(spin); await work(); done = true; return ticks;
}
(async () => {
  const n = 1000, values = Array.from({ length: n }, (_, i) => i), syncAdd = (a, b) => a + b, asyncAdd = async (a, b) => a + b;
  const p = () => Promise.resolve(1), viaReturn = async () => p(), viaReturnAwait = async () => await p();
  console.log('queueMicrotask: ' + (globalThis.queueMicrotask ? 'native' : 'Promise.resolve().then'));
  console.log('sync loop, no await            ' + await countTicks(async () => { let s = 0; for (const v of values) s = syncAdd(s, v); return s; }));
  console.log('await on each plain value      ' + await countTicks(async () => { let s = 0; for (const v of values) s += await v; return s; }));
  console.log('await asyncAdd() per element   ' + await countTicks(async () => { let s = 0; for (const v of values) s = await asyncAdd(s, v); return s; }));
  console.log('await on a native promise      ' + await countTicks(async () => { for (let i = 0; i < n; i++) await p(); }));
  console.log('await f(), f does return p     ' + await countTicks(async () => { for (let i = 0; i < n; i++) await viaReturn(); }));
  console.log('await f(), f does return await ' + await countTicks(async () => { for (let i = 0; i < n; i++) await viaReturnAwait(); }));
})().then(() => globalThis.__finish && __finish());
```
</details>

### 4.29 `JL-A8` / `JN-E3`: 100,000 microtasks against a 0 ms timer

A 0 ms timer is set, then a chain of 100,000 microtasks is started ✅[^lab]. On all six environments, in all three runs, the chain finished before the timer ran, or in the same millisecond on a coarse timer: 3.7 to 4.5 ms (Node.js), 2.2 to 3.6 ms (Bun), 9 to 14 ms (JSC-mac), 2.0 to 3.0 ms (JSC-page), 25 to 27 ms (Chrome) and 32 to 48 ms (Firefox) after the start, with the timer 0.0 to 22.7 ms after that (six runs of each environment). For browser code: a long microtask chain, like a long synchronous loop in an `async` function, holds back timers, input and rendering in every engine; yield with a timer.

<details><summary>Lab: <code>microtask.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
queueMicrotask: native | order: 100,000 microtasks done at 4.3 ms, timer at 4.4 ms
```

V8-chrome:

```text
queueMicrotask: native | order: 100,000 microtasks done at 24.8 ms, timer at 26.0 ms
```

SM-firefox:

```text
queueMicrotask: native | order: 100,000 microtasks done at 39.7 ms, timer at 51.2 ms
```

JSC-mac:

```text
queueMicrotask: Promise.resolve().then | order: 100,000 microtasks done at 11.4 ms, timer at 11.6 ms
```

JSC-bun:

```text
queueMicrotask: native | order: 100,000 microtasks done at 3.1 ms, timer at 4.2 ms
```

JSC-page:

```text
queueMicrotask: native | order: 100,000 microtasks done at 2.0 ms, timer at 3.0 ms
```

```js
// JL-A8 / JN-E3: a chain of 100,000 microtask steps queued before a 0 ms timer: which finishes first.
globalThis.__manualFinish = true;
const q = globalThis.queueMicrotask || ((f) => Promise.resolve().then(f));
const t0 = performance.now(), log = [];
setTimeout(() => {
  log.push(`timer at ${(performance.now() - t0).toFixed(1)} ms`);
  console.log(`queueMicrotask: ${globalThis.queueMicrotask ? 'native' : 'Promise.resolve().then'} | order: ${log.join(', ')}`);
  globalThis.__finish && __finish();
}, 0);
let steps = 0; const step = () => { if (++steps < 100000) q(step); else log.push(`100,000 microtasks done at ${(performance.now() - t0).toFixed(1)} ms`); };
q(step);
```
</details>

### 4.30 `JL-G1`: closures that share a scope with a big array

Each scope holds a 10⁶-element array (about 7.6 MiB on 8-byte slots) and returns only a small closure `tiny` that never uses it; four kinds of scope, one function each. Bytes: heap growth for 10 kept closures per kind. Liveness: 3 more scopes per kind with a `WeakRef` to each array ✅[^lab]:

| Kind | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| no sibling (control), bytes | 0.0 MiB | 0.0 MiB | — | 0.0 MiB | 0.0 MiB | — |
| a sibling closure uses the array, bytes | 76.3 MiB | 38.1 MiB | — | 76.3 MiB | 76.3 MiB | — |
| a closure on a never-run `if` uses it, bytes | 76.3 MiB | 38.1 MiB | — | 76.3 MiB | 76.3 MiB | — |
| sibling, then `big = null`, bytes | 0.0 MiB | 0.0 MiB | — | 7.6 MiB | 0.0 MiB | — |
| liveness: control / sibling / never-run `if` / `= null` | 0 / 3 / 3 / 0 of 3 | 0 / 3 / 3 / 0 | 1 / 3 / 3 / 0 (control kept: no verdict) | 0 / 3 / 3 / 0 | 0 / 3 / 3 / 0 | 0 / 3 / 3 / 0 |

On V8 and JavaScriptCore, a closure that never touches the array kept it alive as soon as another closure of the same scope used it, even one on a branch that never ran, and `big = null` released it (bytes and liveness agree, with the exception below for JSC-mac). In SM-firefox the liveness result cannot be used: the control object, which nothing references, was still alive after 500 garbage steps in all six runs (three of the lab, three re-runs), so the engine may not have collected anything, and an "alive" array proves nothing there. Chrome's figure is half the others', as in the Chrome rows of the V8 representation deep dive, which explains pointer compression. One more mark on this table: in JSC-mac the byte pass of the `= null` kind kept one array's worth (7.6 MiB) while the liveness pass found all three collected. For browser code: the rule holds on V8 and JavaScriptCore, including the WebKit page, and could not be measured in Firefox; move the big value's use into a separate function, or set it to `null` when done.

<details><summary>Lab: <code>closures.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
no sibling (control): heap +-0.0 MiB for 10 kept closures
sibling uses big: heap +76.3 MiB for 10 kept closures
never-run if uses big: heap +76.3 MiB for 10 kept closures
sibling, then big = null: heap +0.0 MiB for 10 kept closures
controls collected after 1 steps | no sibling (control): 0 of 3 alive | sibling uses big: 3 of 3 alive | never-run if uses big: 3 of 3 alive | sibling, then big = null: 0 of 3 alive | kept 52
```

V8-chrome:

```text
no sibling (control): heap +0.0 MiB for 10 kept closures
sibling uses big: heap +38.1 MiB for 10 kept closures
never-run if uses big: heap +38.1 MiB for 10 kept closures
sibling, then big = null: heap +0.0 MiB for 10 kept closures
controls collected after 1 steps | no sibling (control): 0 of 3 alive | sibling uses big: 3 of 3 alive | never-run if uses big: 3 of 3 alive | sibling, then big = null: 0 of 3 alive | kept 52
```

SM-firefox:

```text
no sibling (control): heap +no heap figure for 10 kept closures
sibling uses big: heap +no heap figure for 10 kept closures
never-run if uses big: heap +no heap figure for 10 kept closures
sibling, then big = null: heap +no heap figure for 10 kept closures
controls NOT collected in 500 steps | no sibling (control): 1 of 3 alive | sibling uses big: 3 of 3 alive | never-run if uses big: 3 of 3 alive | sibling, then big = null: 0 of 3 alive | kept 52
```

JSC-mac:

```text
no sibling (control): heap +0.0 MiB for 10 kept closures
sibling uses big: heap +76.3 MiB for 10 kept closures
never-run if uses big: heap +76.3 MiB for 10 kept closures
sibling, then big = null: heap +7.6 MiB for 10 kept closures
controls collected after 1 steps | no sibling (control): 0 of 3 alive | sibling uses big: 3 of 3 alive | never-run if uses big: 3 of 3 alive | sibling, then big = null: 0 of 3 alive | kept 52
```

JSC-bun:

```text
no sibling (control): heap +0.0 MiB for 10 kept closures
sibling uses big: heap +76.3 MiB for 10 kept closures
never-run if uses big: heap +76.3 MiB for 10 kept closures
sibling, then big = null: heap +-0.0 MiB for 10 kept closures
controls collected after 1 steps | no sibling (control): 0 of 3 alive | sibling uses big: 3 of 3 alive | never-run if uses big: 3 of 3 alive | sibling, then big = null: 0 of 3 alive | kept 52
```

JSC-page:

```text
no sibling (control): heap +no heap figure for 10 kept closures
sibling uses big: heap +no heap figure for 10 kept closures
never-run if uses big: heap +no heap figure for 10 kept closures
sibling, then big = null: heap +no heap figure for 10 kept closures
controls collected after 2 steps | no sibling (control): 0 of 3 alive | sibling uses big: 3 of 3 alive | never-run if uses big: 3 of 3 alive | sibling, then big = null: 0 of 3 alive | kept 52
```

```js
globalThis.__manualFinish = true;
const g = globalThis;
// heap(): bytes after a forced full collection, where the environment has both (null in Firefox and WebKit pages).
const heap = g.gcHeapSize ? () => { fullGC(); return gcHeapSize(); }
  : g.Bun ? () => { Bun.gc(true); return require('bun:jsc').heapStats().heapSize; }
  : g.process && g.gc ? () => { gc(); return process.memoryUsage().heapUsed; }
  : g.gc && g.performance && performance.memory ? () => { gc(); return performance.memory.usedJSHeapSize; } : null;
const mib = (b, a) => (heap ? ((a - b) / 2 ** 20).toFixed(1) + ' MiB' : 'no heap figure');
// Liveness: allocate 16 MB of garbage per step (plus a forced full GC where heap() exists), one timer turn between steps,
// until every control is collected, then 5 steps more.
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const junk = () => { let a; for (let i = 0; i < 20; i++) a = new Array(1e5).fill(i); return a.length; };
// deref() itself keeps its target alive until the job ends, so each check runs in its own job before the next step.
async function settle(controls) { let s = 0; while (s < 500 && controls.some((r) => r.deref() !== undefined)) { await tick(); junk(); if (heap) heap(); s++; } for (let i = 0; i < 5; i++) { await tick(); junk(); if (heap) heap(); } await tick(); return s < 500 ? `controls collected after ${s} steps` : 'controls NOT collected in 500 steps'; }
const alive = (refs) => refs.filter((r) => r.deref() !== undefined).length + ' of ' + refs.length + ' alive';
const done = () => g.__finish && g.__finish();
// JL-G1: scopes that each hold a 10^6-element array (about 7.6 MiB); only a small closure 'tiny' is kept from each.
// One function per kind: whether a variable is captured is decided per function, from its source.
const mks = {
  'no sibling (control)': (refs) => { const big = new Array(1e6).fill(0); if (refs) refs.push(new WeakRef(big)); return () => 'tiny'; },
  'sibling uses big': (refs) => { const big = new Array(1e6).fill(0); if (refs) refs.push(new WeakRef(big)); const useBig = () => big.length; useBig(); return () => 'tiny'; },
  'never-run if uses big': (refs) => { const big = new Array(1e6).fill(0); if (refs) refs.push(new WeakRef(big)); if (big.length < 0) g.f = () => big.length; return () => 'tiny'; },
  'sibling, then big = null': (refs) => { let big = new Array(1e6).fill(0); if (refs) refs.push(new WeakRef(big)); const useBig = () => big.length; useBig(); big = null; return () => 'tiny'; },
};
const kept = [], refs = {};
for (const k in mks) {   // pass 1, bytes: 10 scopes per kind, no WeakRef (a new WeakRef keeps its target alive until the job ends)
  const b = heap && heap(); for (let i = 0; i < 10; i++) kept.push(mks[k]()); const a = heap && heap();
  console.log(`${k}: heap +${mib(b, a)} for 10 kept closures`);
}
for (const k in mks) { refs[k] = []; for (let i = 0; i < 3; i++) kept.push(mks[k](refs[k])); }  // pass 2, liveness: 3 per kind
settle(refs['no sibling (control)']).then((s) => {
  console.log(s + ' | ' + Object.keys(mks).map((k) => `${k}: ${alive(refs[k])}`).join(' | ') + ` | kept ${kept.length}`);
  done();
});
```
</details>

### 4.31 `JL-G2`: a timer and a listener keep a cache alive

A job holds a 10⁶-element cache in a `setInterval` callback, or in an `EventTarget` listener; three jobs of each: never stopped (handle dropped), stopped with the handle kept, and stopped with the handle dropped; a `WeakRef` to each cache ✅[^lab]:

| Job | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| timer, never stopped | alive | alive | alive | not measurable | alive | alive |
| timer, stopped, handle kept | collected | alive | alive | not measurable | collected | alive |
| timer, stopped, handle dropped | collected | collected | collected | not measurable | collected | collected |
| listener, never removed | alive | alive | alive | not measurable | alive | alive |
| listener, removed, handle kept | collected | alive | alive | not measurable | collected | alive |
| listener, removed, handle dropped | collected | collected | collected | not measurable | collected | collected |

The same in all three runs of each environment, and in three re-runs. In every page (Chrome, Firefox, the WebKit page), a stopped job whose handle was kept still kept its cache; in Node.js and Bun it did not, so on those two the advice to drop the handle changed nothing and the engines of one family disagree (V8-chrome against V8-node, JSC-page against JSC-bun). Firefox's control object was collected after 4 steps in the lab's run 2 and after 55 to 61 in the re-runs; either way the control was collected, so the Firefox result counts. The JavaScriptCore shell has no `setInterval`, no `clearTimeout` and no `EventTarget`, so neither half can be measured there. For browser code: stop the timer, remove the listener, and drop the handle too: in all three browsers' engines the handle alone kept the cache.

<details><summary>Lab: <code>timers.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node, JSC-bun (identical output):

```text
setInterval: function, clearInterval: function, EventTarget: function
controls collected after 1 steps | timer: running 1 of 1 alive, stopped and handle kept 0 of 1 alive, stopped and dropped 0 of 1 alive | listener: running 1 of 1 alive, stopped and handle kept 0 of 1 alive, stopped and dropped 0 of 1 alive
```

V8-chrome:

```text
setInterval: function, clearInterval: function, EventTarget: function
controls collected after 1 steps | timer: running 1 of 1 alive, stopped and handle kept 1 of 1 alive, stopped and dropped 0 of 1 alive | listener: running 1 of 1 alive, stopped and handle kept 1 of 1 alive, stopped and dropped 0 of 1 alive
```

SM-firefox:

```text
setInterval: function, clearInterval: function, EventTarget: function
controls collected after 4 steps | timer: running 1 of 1 alive, stopped and handle kept 1 of 1 alive, stopped and dropped 0 of 1 alive | listener: running 1 of 1 alive, stopped and handle kept 1 of 1 alive, stopped and dropped 0 of 1 alive
```

JSC-mac:

```text
setInterval: undefined, clearInterval: undefined, EventTarget: undefined
timer: not measurable here
listener: not measurable here
controls collected after 1 steps
```

JSC-page:

```text
setInterval: function, clearInterval: function, EventTarget: function
controls collected after 2 steps | timer: running 1 of 1 alive, stopped and handle kept 1 of 1 alive, stopped and dropped 0 of 1 alive | listener: running 1 of 1 alive, stopped and handle kept 1 of 1 alive, stopped and dropped 0 of 1 alive
```

```js
globalThis.__manualFinish = true;
const g = globalThis;
// heap(): bytes after a forced full collection, where the environment has both (null in Firefox and WebKit pages).
const heap = g.gcHeapSize ? () => { fullGC(); return gcHeapSize(); }
  : g.Bun ? () => { Bun.gc(true); return require('bun:jsc').heapStats().heapSize; }
  : g.process && g.gc ? () => { gc(); return process.memoryUsage().heapUsed; }
  : g.gc && g.performance && performance.memory ? () => { gc(); return performance.memory.usedJSHeapSize; } : null;
const mib = (b, a) => (heap ? ((a - b) / 2 ** 20).toFixed(1) + ' MiB' : 'no heap figure');
// Liveness: allocate 16 MB of garbage per step (plus a forced full GC where heap() exists), one timer turn between steps,
// until every control is collected, then 5 steps more.
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const junk = () => { let a; for (let i = 0; i < 20; i++) a = new Array(1e5).fill(i); return a.length; };
// deref() itself keeps its target alive until the job ends, so each check runs in its own job before the next step.
async function settle(controls) { let s = 0; while (s < 500 && controls.some((r) => r.deref() !== undefined)) { await tick(); junk(); if (heap) heap(); s++; } for (let i = 0; i < 5; i++) { await tick(); junk(); if (heap) heap(); } await tick(); return s < 500 ? `controls collected after ${s} steps` : 'controls NOT collected in 500 steps'; }
const alive = (refs) => refs.filter((r) => r.deref() !== undefined).length + ' of ' + refs.length + ' alive';
const done = () => g.__finish && g.__finish();
// JL-G2: a job keeps a 10^6-element cache in a repeating timer, or in an EventTarget listener; a WeakRef to each job's cache.
const bus = g.EventTarget ? new EventTarget() : null;
// unref (Node.js, Bun): the process may exit while the never-stopped timer still runs.
const jobs = {
  timer(refs) { const cache = new Array(1e6).fill(0); refs.push(new WeakRef(cache)); const t = setInterval(() => cache.length, 1000); if (t.unref) t.unref(); return { stop() { clearInterval(t); } }; },
  listener(refs) { const cache = new Array(1e6).fill(0); refs.push(new WeakRef(cache)); const on = () => cache.length; bus.addEventListener('tick', on); return { stop() { bus.removeEventListener('tick', on); } }; },
};
console.log(`setInterval: ${typeof g.setInterval}, clearInterval: ${typeof g.clearInterval}, EventTarget: ${typeof g.EventTarget}`);
const control = [], r = {}, keep = [];
(() => { const c = new Array(1e6).fill(0); control.push(new WeakRef(c)); })();
for (const k in jobs) {
  if (k === 'timer' ? !g.setInterval || !g.clearInterval : !bus) { console.log(`${k}: not measurable here`); continue; }
  r[k] = { running: [], stoppedKept: [], stoppedDropped: [] };
  jobs[k](r[k].running);                                      // handle thrown away, never stopped
  const h = jobs[k](r[k].stoppedKept); h.stop(); keep.push(h);  // stopped, handle kept
  jobs[k](r[k].stoppedDropped).stop();                         // stopped, handle dropped
}
settle(control).then((s) => {
  console.log(s + Object.keys(r).map((k) => ` | ${k}: running ${alive(r[k].running)}, stopped and handle kept ${alive(r[k].stoppedKept)}, stopped and dropped ${alive(r[k].stoppedDropped)}`).join(''));
  done();
});
```
</details>

### 4.32 `JL-G3`: a short slice of a 16 MiB string

A 13- or a 12-character `slice()` of a 16 MiB one-byte string is kept while the parent is dropped, with no copy and with three copy idioms; heap growth after a full collection. Firefox and the WebKit page cannot report it: they have no heap figure, and a string cannot be the target of a `WeakRef` (the constructor throws a `TypeError` for a target that `CanBeHeldWeakly` rejects) ✅[^tc39weak]. Results, the same in all three runs ✅[^lab]:

| Kept | V8-node | V8-chrome | JSC-mac | JSC-bun |
|---|---|---|---|---|
| 13 characters, plain slice | 16.0 MiB | 16.0 MiB | 16.0 MiB | 16.0 MiB |
| 12 characters, plain slice | 0.0 MiB | 0.0 MiB | 16.0 MiB | 16.0 MiB |
| `[...s].join('')` (13 or 12) | 0.0 MiB | 0.0 MiB | 0.0 MiB | 0.0 MiB |
| `(' ' + s).slice(1)` (13 or 12) | 0.0 MiB | 0.0 MiB | 16.0 MiB | 16.0 MiB |
| `JSON.parse(JSON.stringify(s))` (13 or 12) | 0.0 MiB | 0.0 MiB | 0.0 MiB | 0.0 MiB |

On JavaScriptCore a 12-character slice also kept the whole parent, so V8's 13-character threshold does not carry over, and the copy `(' ' + s).slice(1)` kept it too. `[...s].join('')` and the `JSON` round trip freed the parent on both engines. A second script (below) cut slices of 1 to 100,000 characters, one process for each length and idiom, on V8-node, the JSC-mac shell and Bun ✅[^lab]. A plain slice kept the parent from 13 characters on V8-node (1 to 12 characters freed it, the same as the first script), and from 3 characters in the JSC-mac shell and in Bun (1 and 2 characters freed it; 4 characters freed it in the shell and kept it in Bun; 5 characters and more kept it in both). On every one of the three engines `[...s].join('')`, `s.split('').join('')` and the `JSON` round trip freed the parent at every length from 1 to 100,000 characters (0.1 MiB left at 100,000). The copy `(' ' + s).slice(1)` freed it on V8-node and kept it on both JavaScriptCore hosts from the same lengths as the plain slice. An earlier version that measured all lengths and idioms in one process gave Bun results that changed with the order of the cases, so the final script uses one process per case. Firefox and the WebKit page could not be measured. For browser code: copy a slice you keep for long with `[...s].join('')`, whatever its length, and do not rely on the `' ' +` trick, which did not free the parent in JavaScriptCore.

<details><summary>Lab: <code>slices.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
13 characters, slice, no copy: heap +16.0 MiB (part.length 13)
13 characters, [...s].join(""): heap +-0.0 MiB (part.length 13)
13 characters, (" " + s).slice(1): heap +0.0 MiB (part.length 13)
13 characters, JSON.parse(JSON.stringify(s)): heap +0.0 MiB (part.length 13)
12 characters, slice, no copy: heap +0.0 MiB (part.length 12)
12 characters, [...s].join(""): heap +0.0 MiB (part.length 12)
12 characters, (" " + s).slice(1): heap +-0.0 MiB (part.length 12)
12 characters, JSON.parse(JSON.stringify(s)): heap +-0.0 MiB (part.length 12)
```

V8-chrome:

```text
13 characters, slice, no copy: heap +16.0 MiB (part.length 13)
13 characters, [...s].join(""): heap +0.0 MiB (part.length 13)
13 characters, (" " + s).slice(1): heap +0.0 MiB (part.length 13)
13 characters, JSON.parse(JSON.stringify(s)): heap +0.0 MiB (part.length 13)
12 characters, slice, no copy: heap +0.0 MiB (part.length 12)
12 characters, [...s].join(""): heap +0.0 MiB (part.length 12)
12 characters, (" " + s).slice(1): heap +0.0 MiB (part.length 12)
12 characters, JSON.parse(JSON.stringify(s)): heap +0.0 MiB (part.length 12)
```

SM-firefox, JSC-page (identical output):

```text
no forced GC or heap figure here: bytes not measurable (a string cannot be the target of a WeakRef)
```

JSC-mac:

```text
13 characters, slice, no copy: heap +16.0 MiB (part.length 13)
13 characters, [...s].join(""): heap +0.0 MiB (part.length 13)
13 characters, (" " + s).slice(1): heap +16.0 MiB (part.length 13)
13 characters, JSON.parse(JSON.stringify(s)): heap +0.0 MiB (part.length 13)
12 characters, slice, no copy: heap +16.0 MiB (part.length 12)
12 characters, [...s].join(""): heap +-0.0 MiB (part.length 12)
12 characters, (" " + s).slice(1): heap +16.0 MiB (part.length 12)
12 characters, JSON.parse(JSON.stringify(s)): heap +-0.0 MiB (part.length 12)
```

JSC-bun:

```text
13 characters, slice, no copy: heap +16.0 MiB (part.length 13)
13 characters, [...s].join(""): heap +0.0 MiB (part.length 13)
13 characters, (" " + s).slice(1): heap +16.0 MiB (part.length 13)
13 characters, JSON.parse(JSON.stringify(s)): heap +0.0 MiB (part.length 13)
12 characters, slice, no copy: heap +16.0 MiB (part.length 12)
12 characters, [...s].join(""): heap +0.0 MiB (part.length 12)
12 characters, (" " + s).slice(1): heap +16.0 MiB (part.length 12)
12 characters, JSON.parse(JSON.stringify(s)): heap +0.0 MiB (part.length 12)
```

```js
globalThis.__manualFinish = true;
const g = globalThis;
// heap(): bytes after a forced full collection, where the environment has both (null in Firefox and WebKit pages).
const heap = g.gcHeapSize ? () => { fullGC(); return gcHeapSize(); }
  : g.Bun ? () => { Bun.gc(true); return require('bun:jsc').heapStats().heapSize; }
  : g.process && g.gc ? () => { gc(); return process.memoryUsage().heapUsed; }
  : g.gc && g.performance && performance.memory ? () => { gc(); return performance.memory.usedJSHeapSize; } : null;
const mib = (b, a) => (heap ? ((a - b) / 2 ** 20).toFixed(1) + ' MiB' : 'no heap figure');
// Liveness: allocate 16 MB of garbage per step (plus a forced full GC where heap() exists), one timer turn between steps,
// until every control is collected, then 5 steps more.
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const junk = () => { let a; for (let i = 0; i < 20; i++) a = new Array(1e5).fill(i); return a.length; };
// deref() itself keeps its target alive until the job ends, so each check runs in its own job before the next step.
async function settle(controls) { let s = 0; while (s < 500 && controls.some((r) => r.deref() !== undefined)) { await tick(); junk(); if (heap) heap(); s++; } for (let i = 0; i < 5; i++) { await tick(); junk(); if (heap) heap(); } await tick(); return s < 500 ? `controls collected after ${s} steps` : 'controls NOT collected in 500 steps'; }
const alive = (refs) => refs.filter((r) => r.deref() !== undefined).length + ' of ' + refs.length + ' alive';
const done = () => g.__finish && g.__finish();
// JL-G3: keep a 13- or 12-character slice of a 16 MiB one-byte string, drop the parent, and read the heap; then three copy idioms.
function keepPart(len, copy) { const parent = 'ab'.repeat(8 * 2 ** 20); return copy(parent.slice(1000, 1000 + len)); }
const idioms = { 'slice, no copy': (s) => s, '[...s].join("")': (s) => [...s].join(''), '(" " + s).slice(1)': (s) => (' ' + s).slice(1), 'JSON.parse(JSON.stringify(s))': (s) => JSON.parse(JSON.stringify(s)) };
if (!heap) console.log('no forced GC or heap figure here: bytes not measurable (a string cannot be the target of a WeakRef)');
else for (const len of [13, 12]) for (const k in idioms) {
  const b = heap(); let part = keepPart(len, idioms[k]); const a = heap();
  console.log(`${len} characters, ${k}: heap +${mib(b, a)} (part.length ${part.length})`); part = null;
}
done();
```
</details>

<details><summary>Lab: <code>slices-by-length.js</code>, output of one run per length and copy idiom (one process each) on three environments, then the script</summary>

V8-node:

```text
len 1 plain: -0.0 MiB (part.length 1)
len 1 join: -0.0 MiB (part.length 1)
len 1 space: -0.0 MiB (part.length 1)
len 1 split: -0.0 MiB (part.length 1)
len 1 json: -0.0 MiB (part.length 1)
len 2 plain: -0.0 MiB (part.length 2)
len 2 join: -0.0 MiB (part.length 2)
len 2 space: -0.0 MiB (part.length 2)
len 2 split: -0.0 MiB (part.length 2)
len 2 json: -0.0 MiB (part.length 2)
len 3 plain: -0.0 MiB (part.length 3)
len 3 join: -0.0 MiB (part.length 3)
len 3 space: -0.0 MiB (part.length 3)
len 3 split: -0.0 MiB (part.length 3)
len 3 json: -0.0 MiB (part.length 3)
len 4 plain: -0.0 MiB (part.length 4)
len 4 join: -0.0 MiB (part.length 4)
len 4 space: -0.0 MiB (part.length 4)
len 4 split: -0.0 MiB (part.length 4)
len 4 json: -0.0 MiB (part.length 4)
len 5 plain: -0.0 MiB (part.length 5)
len 5 join: -0.0 MiB (part.length 5)
len 5 space: -0.0 MiB (part.length 5)
len 5 split: -0.0 MiB (part.length 5)
len 5 json: -0.0 MiB (part.length 5)
len 12 plain: -0.0 MiB (part.length 12)
len 12 join: -0.0 MiB (part.length 12)
len 12 space: -0.0 MiB (part.length 12)
len 12 split: -0.0 MiB (part.length 12)
len 12 json: -0.0 MiB (part.length 12)
len 13 plain: 16.0 MiB (part.length 13)
len 13 join: -0.0 MiB (part.length 13)
len 13 space: -0.0 MiB (part.length 13)
len 13 split: -0.0 MiB (part.length 13)
len 13 json: -0.0 MiB (part.length 13)
len 100 plain: 16.0 MiB (part.length 100)
len 100 join: -0.0 MiB (part.length 100)
len 100 space: -0.0 MiB (part.length 100)
len 100 split: -0.0 MiB (part.length 100)
len 100 json: -0.0 MiB (part.length 100)
len 1000 plain: 16.0 MiB (part.length 1000)
len 1000 join: -0.0 MiB (part.length 1000)
len 1000 space: -0.0 MiB (part.length 1000)
len 1000 split: -0.0 MiB (part.length 1000)
len 1000 json: -0.0 MiB (part.length 1000)
len 100000 plain: 16.0 MiB (part.length 100000)
len 100000 join: 0.1 MiB (part.length 100000)
len 100000 space: 0.1 MiB (part.length 100000)
len 100000 split: 0.1 MiB (part.length 100000)
len 100000 json: 0.1 MiB (part.length 100000)
```

JSC-mac:

```text
len 1 plain: 0.0 MiB (part.length 1)
len 1 join: 0.0 MiB (part.length 1)
len 1 space: 0.0 MiB (part.length 1)
len 1 split: 0.0 MiB (part.length 1)
len 1 json: 0.0 MiB (part.length 1)
len 2 plain: 0.0 MiB (part.length 2)
len 2 join: 0.0 MiB (part.length 2)
len 2 space: 0.0 MiB (part.length 2)
len 2 split: 0.0 MiB (part.length 2)
len 2 json: 0.0 MiB (part.length 2)
len 3 plain: 16.0 MiB (part.length 3)
len 3 join: 0.0 MiB (part.length 3)
len 3 space: 16.0 MiB (part.length 3)
len 3 split: 0.0 MiB (part.length 3)
len 3 json: 0.0 MiB (part.length 3)
len 4 plain: 0.0 MiB (part.length 4)
len 4 join: 0.0 MiB (part.length 4)
len 4 space: 0.0 MiB (part.length 4)
len 4 split: 0.0 MiB (part.length 4)
len 4 json: 0.0 MiB (part.length 4)
len 5 plain: 16.0 MiB (part.length 5)
len 5 join: 0.0 MiB (part.length 5)
len 5 space: 16.0 MiB (part.length 5)
len 5 split: 0.0 MiB (part.length 5)
len 5 json: 0.0 MiB (part.length 5)
len 12 plain: 16.0 MiB (part.length 12)
len 12 join: 0.0 MiB (part.length 12)
len 12 space: 16.0 MiB (part.length 12)
len 12 split: 0.0 MiB (part.length 12)
len 12 json: 0.0 MiB (part.length 12)
len 13 plain: 16.0 MiB (part.length 13)
len 13 join: 0.0 MiB (part.length 13)
len 13 space: 16.0 MiB (part.length 13)
len 13 split: 0.0 MiB (part.length 13)
len 13 json: 0.0 MiB (part.length 13)
len 100 plain: 16.0 MiB (part.length 100)
len 100 join: 0.0 MiB (part.length 100)
len 100 space: 16.0 MiB (part.length 100)
len 100 split: 0.0 MiB (part.length 100)
len 100 json: 0.0 MiB (part.length 100)
len 1000 plain: 16.0 MiB (part.length 1000)
len 1000 join: 0.0 MiB (part.length 1000)
len 1000 space: 16.0 MiB (part.length 1000)
len 1000 split: 0.0 MiB (part.length 1000)
len 1000 json: 0.0 MiB (part.length 1000)
len 100000 plain: 16.0 MiB (part.length 100000)
len 100000 join: 0.1 MiB (part.length 100000)
len 100000 space: 16.0 MiB (part.length 100000)
len 100000 split: 0.1 MiB (part.length 100000)
len 100000 json: 0.1 MiB (part.length 100000)
```

JSC-bun:

```text
len 1 plain: 0.0 MiB (part.length 1)
len 1 join: 0.0 MiB (part.length 1)
len 1 space: 0.0 MiB (part.length 1)
len 1 split: 0.0 MiB (part.length 1)
len 1 json: 0.0 MiB (part.length 1)
len 2 plain: 0.0 MiB (part.length 2)
len 2 join: 0.0 MiB (part.length 2)
len 2 space: 0.0 MiB (part.length 2)
len 2 split: 0.0 MiB (part.length 2)
len 2 json: 0.0 MiB (part.length 2)
len 3 plain: 16.0 MiB (part.length 3)
len 3 join: 0.0 MiB (part.length 3)
len 3 space: 16.0 MiB (part.length 3)
len 3 split: 0.0 MiB (part.length 3)
len 3 json: 0.0 MiB (part.length 3)
len 4 plain: 16.0 MiB (part.length 4)
len 4 join: 0.0 MiB (part.length 4)
len 4 space: 16.0 MiB (part.length 4)
len 4 split: 0.0 MiB (part.length 4)
len 4 json: 0.0 MiB (part.length 4)
len 5 plain: 16.0 MiB (part.length 5)
len 5 join: 0.0 MiB (part.length 5)
len 5 space: 16.0 MiB (part.length 5)
len 5 split: 0.0 MiB (part.length 5)
len 5 json: 0.0 MiB (part.length 5)
len 12 plain: 16.0 MiB (part.length 12)
len 12 join: 0.0 MiB (part.length 12)
len 12 space: 16.0 MiB (part.length 12)
len 12 split: 0.0 MiB (part.length 12)
len 12 json: 0.0 MiB (part.length 12)
len 13 plain: 16.0 MiB (part.length 13)
len 13 join: 0.0 MiB (part.length 13)
len 13 space: 16.0 MiB (part.length 13)
len 13 split: 0.0 MiB (part.length 13)
len 13 json: 0.0 MiB (part.length 13)
len 100 plain: 16.0 MiB (part.length 100)
len 100 join: 0.0 MiB (part.length 100)
len 100 space: 16.0 MiB (part.length 100)
len 100 split: 0.0 MiB (part.length 100)
len 100 json: 0.0 MiB (part.length 100)
len 1000 plain: 16.0 MiB (part.length 1000)
len 1000 join: 0.0 MiB (part.length 1000)
len 1000 space: 16.0 MiB (part.length 1000)
len 1000 split: 0.0 MiB (part.length 1000)
len 1000 json: 0.0 MiB (part.length 1000)
len 100000 plain: 16.0 MiB (part.length 100000)
len 100000 join: 0.1 MiB (part.length 100000)
len 100000 space: 16.0 MiB (part.length 100000)
len 100000 split: 0.1 MiB (part.length 100000)
len 100000 json: 0.1 MiB (part.length 100000)
```

```js
// JL-G3, second script: one slice length and one copy idiom per process (set len and idiom on the two first lines);
// a 16 MiB one-byte parent is built, a slice of len characters is cut and copied by the idiom, the parent is dropped, heap growth in MiB after a full collection.
const len = LEN, idiom = 'IDIOM';
const g = globalThis;
const heap = g.gcHeapSize ? () => { fullGC(); return gcHeapSize(); }
  : g.Bun ? () => { Bun.gc(true); return require('bun:jsc').heapStats().heapSize; }
  : g.process && g.gc ? () => { gc(); return process.memoryUsage().heapUsed; } : null;
const idioms = { plain: (s) => s, join: (s) => [...s].join(''), space: (s) => (' ' + s).slice(1), split: (s) => s.split('').join(''), json: (s) => JSON.parse(JSON.stringify(s)) };
function keepPart() { const parent = 'ab'.repeat(8 * 2 ** 20); return idioms[idiom](parent.slice(1000, 1000 + len)); }
const b = heap(); const part = keepPart(); const a = heap();
console.log(`len ${len} ${idiom}: ${((a - b) / 2 ** 20).toFixed(1)} MiB (part.length ${part.length})`);
```
</details>

### 4.33 `JL-G4` / `JL-G5`: a `WeakMap` value that holds its key; when a finalizer runs

A `WeakMap` entry whose value references its own key, with the key dropped; and a `FinalizationRegistry` target dropped before one forced full collection (where there is one), then two timer turns ✅[^lab]:

| | V8-node | V8-chrome | SM-firefox | JSC-mac | JSC-bun | JSC-page |
|---|---|---|---|---|---|---|
| key and value of the `WeakMap` entry | collected | collected | collected | collected | collected | collected |
| finalizer callbacks right after the forced GC (same turn) | 0 | 0 | no forced GC | 0 | 0 | no forced GC |
| after the next timer turn | 0 | 1 | — | 1 | 0 | — |
| at the end of the script (5 to 26 timer turns later) | 0 | 1 | 1 | 1 | 0 | 1 |

A value that points back to its key did not keep the entry alive on any engine. No finalizer ran in the same turn as the collection anywhere; Chrome and the JavaScriptCore shell ran it one timer turn later; Node.js and Bun had not run it when the script ended, although `deref()` already returned `undefined`. That wait was short: from the first forced collection to the end of the script it took 41 to 56 ms on Node.js and Bun (one forced collection, a timer turn, a 10 ms timer, then six more forced collections with a timer turn each). A second script (below) forced a collection every 10 ms for up to 3,000 ms: Node.js still had run no callback after 215 to 246 collections and 3,000 ms, and its exit event saw none (two runs); Bun ran the callback after the first or second collection, 12 to 19 ms after the start (four runs). So "the finalizer did not run" is a statement about the first script's wait on Node.js and Bun, and about 3,000 ms and 215 collections on Node.js; it is not true of Bun in general. For browser code: `WeakMap` side data is safe everywhere; a `FinalizationRegistry` callback runs late or not at all, so it can never carry program logic.

<details><summary>Lab: <code>weak.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node, JSC-bun (identical output):

```text
after one forced full GC, same turn: target deref undefined, callbacks 0
next timer turn: callbacks 0
after a 10 ms timer: callbacks 0
controls collected after 0 steps | WeakMap key: 0 of 1 alive, value: 0 of 1 alive | target deref undefined, callbacks 0
```

V8-chrome, JSC-mac (identical output):

```text
after one forced full GC, same turn: target deref undefined, callbacks 0
next timer turn: callbacks 1
after a 10 ms timer: callbacks 1
controls collected after 0 steps | WeakMap key: 0 of 1 alive, value: 0 of 1 alive | target deref undefined, callbacks 1
```

SM-firefox:

```text
no forced GC here
controls collected after 21 steps | WeakMap key: 0 of 1 alive, value: 0 of 1 alive | target deref undefined, callbacks 1
```

JSC-page:

```text
no forced GC here
controls collected after 1 steps | WeakMap key: 0 of 1 alive, value: 0 of 1 alive | target deref undefined, callbacks 1
```

```js
globalThis.__manualFinish = true;
const g = globalThis;
// heap(): bytes after a forced full collection, where the environment has both (null in Firefox and WebKit pages).
const heap = g.gcHeapSize ? () => { fullGC(); return gcHeapSize(); }
  : g.Bun ? () => { Bun.gc(true); return require('bun:jsc').heapStats().heapSize; }
  : g.process && g.gc ? () => { gc(); return process.memoryUsage().heapUsed; }
  : g.gc && g.performance && performance.memory ? () => { gc(); return performance.memory.usedJSHeapSize; } : null;
const mib = (b, a) => (heap ? ((a - b) / 2 ** 20).toFixed(1) + ' MiB' : 'no heap figure');
// Liveness: allocate 16 MB of garbage per step (plus a forced full GC where heap() exists), one timer turn between steps,
// until every control is collected, then 5 steps more.
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const junk = () => { let a; for (let i = 0; i < 20; i++) a = new Array(1e5).fill(i); return a.length; };
// deref() itself keeps its target alive until the job ends, so each check runs in its own job before the next step.
async function settle(controls) { let s = 0; while (s < 500 && controls.some((r) => r.deref() !== undefined)) { await tick(); junk(); if (heap) heap(); s++; } for (let i = 0; i < 5; i++) { await tick(); junk(); if (heap) heap(); } await tick(); return s < 500 ? `controls collected after ${s} steps` : 'controls NOT collected in 500 steps'; }
const alive = (refs) => refs.filter((r) => r.deref() !== undefined).length + ' of ' + refs.length + ' alive';
const done = () => g.__finish && g.__finish();
// JL-G4: a WeakMap value that references its own key; the key is dropped. JL-G5: when a FinalizationRegistry callback runs.
const wm = new WeakMap(), refs = { key: [], value: [] }, control = [], log = [];
(() => { const key = {}; const value = { key, big: new Array(1e6).fill(0) }; wm.set(key, value); refs.key.push(new WeakRef(key)); refs.value.push(new WeakRef(value)); control.push(new WeakRef({ big: new Array(1e6).fill(0) })); })();
const fr = new FinalizationRegistry((h) => log.push(h));
let target = { big: new Array(1e5).fill(0) }; const tref = new WeakRef(target); fr.register(target, 't'); target = null;
(async () => {
  await tick();
  if (g.gc || g.fullGC || g.Bun) {
    const full = g.fullGC || (g.Bun ? () => Bun.gc(true) : g.gc); full();
    console.log(`after one forced full GC, same turn: target deref ${tref.deref() === undefined ? 'undefined' : 'alive'}, callbacks ${log.length}`);
    await tick(); console.log(`next timer turn: callbacks ${log.length}`); await tick(10); console.log(`after a 10 ms timer: callbacks ${log.length}`);
  } else console.log('no forced GC here');
  console.log((await settle(control)) + ` | WeakMap key: ${alive(refs.key)}, value: ${alive(refs.value)} | target deref ${tref.deref() === undefined ? 'undefined' : 'alive'}, callbacks ${log.length}`);
  done();
})();
```
</details>

<details><summary>Lab: <code>finalizer-wait.js</code>, output of run 1 on each environment that ran it, then the script</summary>

V8-node:

```text
waited 3003 ms, 215 steps (gc forced + 10 ms timer each), deref undefined, callbacks 0
exit event, callbacks 0
```

JSC-mac:

```text
waited 25 ms, 2 steps (gc forced + 10 ms timer each), deref undefined, callbacks 1
```

JSC-bun:

```text
waited 19 ms, 1 steps (gc forced + 10 ms timer each), deref undefined, callbacks 1
exit event, callbacks 1
```

```js
// JL-G5, second script: force a full collection every 10 ms for up to 3,000 ms (or until the FinalizationRegistry callback runs); print how long it waited.
const log = []; const fr = new FinalizationRegistry((h) => log.push(h));
let target = { big: new Array(1e5).fill(0) }; const tref = new WeakRef(target); fr.register(target, 't'); target = null;
const full = globalThis.fullGC || (globalThis.Bun ? () => Bun.gc(true) : globalThis.gc);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
if (typeof process !== 'undefined') process.on('exit', () => console.log('exit event, callbacks ' + log.length));
(async () => {
  const t0 = performance.now(); let steps = 0;
  while (performance.now() - t0 < 3000 && log.length === 0) { full(); await tick(10); steps++; }
  console.log(`waited ${(performance.now() - t0).toFixed(0)} ms, ${steps} steps (gc forced + 10 ms timer each), deref ${tref.deref() === undefined ? 'undefined' : 'alive'}, callbacks ${log.length}`);
})();
```
</details>

## 5. Reference & invariants

What changes in the advice, rule by rule.

### 5.1 Safe to follow on every engine

These rules helped, or (for "no gain" rules) stayed right, on V8, SpiderMonkey and JavaScriptCore alike ✅[^lab]:

- **Objects:** one key order per hot site (`JE-F1`, `JE-O1`); fields by name, never 30 computed keys (`JE-O3`, building cost 7 to 50 times everywhere); a class or `Object.create` instead of a prototype set per object (`JE-O5`); no `Proxy` in hot loops (`JE-S6`); keep class getters (`JE-S8`).
- **Arrays:** no `for…in` over arrays (`JE-N8`); a `Map` for sparse ids (`JE-N7`); keep `new Array(n)` filled by index (`JE-N5`); an index `for` over `forEach` in hot loops (`JE-F12`).
- **Functions:** keep small temporary objects (`JE-F11`); keep `try`/`catch`, `arguments` and `for…in` over objects (`JE-F9`); split generated functions of thousands of statements (`JE-F6`: a cliff on every engine, between 1,000 and 2,000 statements in Firefox, 2,000 and 3,000 on V8-node, 3,000 and 4,000 in Chrome, 4,000 and 6,000 on JavaScriptCore); warm up for 20,000 calls before timing (`JE-M1`).
- **Language:** one loop over a chain of array methods (`JL-L1`), no iterator helpers over in-memory arrays for speed (`JL-L2`, timed only), `find` over `filter(p)[0]` (`JL-L3`), sort keys computed once (`JL-L4`), no errors on routine paths (`JL-L5`), a `Set` or `Map` built once and `push` over rebuilding (`JL-L7`, `JL-L8`), `#private` fields (`JL-L10`).
- **Async:** no `await` on plain values in loops, keep `return await` (`JL-A1`, `JL-A2`), and no long synchronous or microtask work that is expected to let timers in (`JL-A8`, `JN-E3`).
- **Memory:** keep big values out of a scope with long-lived closures or set them to `null` (`JL-G1`, measured on V8 and JavaScriptCore; not measurable in Firefox); stop timers and remove listeners (`JL-G2`; dropping the handle too matters in the pages of Chrome, Firefox and WebKit, not in Node.js or Bun); `WeakMap` for side data, no logic in finalizers (`JL-G4`, `JL-G5`).

### 5.2 Rules that matter only on V8, or mostly there

Following them never cost on another engine, but the gain was V8's ✅[^lab]:

- **`JE-S7`:** an accessor in an object literal: 9 to 34 times a field on V8; on SpiderMonkey and JavaScriptCore no difference for one object read over and over, and 1.2 to 1.5 times for 8 objects read in turn.
- **`JE-F3`, the type half:** a sum that once saw a string stayed three times slower on V8 only. The other half (wrap 32-bit math with `Math.imul` and `| 0`) paid 1.1 to 1.7 times on every engine when only the loop was timed, and 2.3 to 10 times when the result then went through `% 1000`.
- **`JE-O2` and the read half of `JE-O3`:** `delete` and computed keys slowed later reads on V8 (and `delete` on SpiderMonkey), not on JavaScriptCore.
- **`JE-N9`, `JE-N10`:** the 2³⁰ step and the boxed double field are V8 representation steps (in Chrome, 20 against 32 bytes per `{ x }`); JavaScriptCore used 8 bytes per array element and 40 bytes per one-field object for every number tried.
- **`JE-O6`, `JE-N6`:** prototype writes and `push` against `new Array(n)` made no difference on SpiderMonkey; both still paid on JavaScriptCore.
- **`JE-N7`, `JE-S3`, `JE-S4`:** the rule held with a smaller effect on one or two engines (reads of a sparse array against a `Map` on V8-chrome and SM-firefox; reading a growing string inside the loop on SM-firefox, where it was linear); rows 8 and 11.
- **`JE-M1`:** a warm-up step (a faster phase after about 5,000 to 11,000 calls) appeared on V8-node and JavaScriptCore; in Chrome and in Firefox the rounds did not step within 15,000 calls. Warming up longer never hurts.
- **`JL-G2`, dropping the handle:** a stopped job whose handle was kept still held its cache in the pages of Chrome, Firefox and WebKit; in Node.js and Bun it did not.
- **`JL-L6` is a number of each build, not a rule that moves:** the largest array a spread call accepted was 123,683 to 124,541 on V8, 500,000 to 524,287 on SpiderMonkey and 638,452 to 638,728 on JavaScriptCore, for the builds of this lab and a top-level call.

### 5.3 Where a V8-only reading would mislead on another engine

- **`JE-F10` holds on every engine, and is far stronger off V8 when the function is inlined.** A direct `eval` that never runs cost 18 to 25 times on V8 in the V8 catalog's shape (one call site, constant argument), 4 to 10 times through a shared call site, and nothing when V8 inlined the function into a loop of its own; SpiderMonkey paid 13 to 102 times and JavaScriptCore 2 to 28 times in every shape that was tried ✅[^lab]. Treat any direct `eval` in a function that runs often as a bug in browser code.
- **`for…of` is not as cheap as an index loop everywhere.** `JE-N8` and `JE-F12` offer `for…of` beside the index `for`; it was 3.8 to 4.0 times slower than the index loop in Firefox and 2.4 times in the JavaScriptCore shell (and 7.2 to 8.9 times in a first call over 10⁷ items on V8) ✅[^lab]. In code that must be fast in every browser, prefer the index loop.
- **`JE-S1` on memory.** On JavaScriptCore a `Map` entry took 53 to 210 bytes (it varied with the count and, in the shell, between runs) and an object used as a table 38 bytes, so a `Map` costs more memory there, not less ✅[^lab]; choose it for its behaviour (any key type, no prototype keys, `size`), not to save bytes in JavaScriptCore.
- **`JL-G3`'s 13-character threshold is V8's.** On JavaScriptCore (the shell and Bun) a plain slice of 3 characters or more, except 4 in the shell, kept the 16 MiB parent, and the copy `(' ' + s).slice(1)` did not free it ✅[^lab]. Copy with `[...s].join('')` whatever the length.
- **`JL-G1` in Firefox and `JL-G3` in Firefox and the WebKit page could not be measured:** Firefox kept one of three unreferenced control objects through 500 garbage steps, so its liveness verdict is withheld, and a page has no heap figure for a string slice. The V8 and JavaScriptCore results stand.
- **`JL-L5`:** `Error.stackTraceLimit = 0` makes `stack` `undefined` on JavaScriptCore ✅[^lab]; code that reads `err.stack.split(…)` throws there.
- **Generators (`JE-F9`):** the rule says generators do not stop optimization; a generator that yields one value per call was still 5.5 to 108 times slower than a plain function on every engine ✅[^lab]. Do not turn a plain hot function into one.

## 6. Trade-offs, pitfalls & misconceptions

### 6.1 Pitfalls met while measuring

- **Identical source text shares feedback on V8.** Readers made by `new Function` from the same text, one per variant, showed a class getter 23 times slower than a field on V8-node; with a different comment in each reader's text, the same script showed no difference ✅[^lab]. Every generated function in these scripts therefore carries a comment of its own, and each variant's call loop is its own generated function (`features.js`, `eval.js`). The probe and its output:

<details><summary>Lab: <code>getters-untagged.js</code>, output of run 2 on each environment that ran it, then the script</summary>

V8-node:

```text
100 calls of 10^4 reads of o.a
  plain field: 0.356-0.368 ms/call, x1.00-1.00, result 1000000
  class getter: 8.39-8.59 ms/call, x22.83-24.11, result 1000000
  object-literal getter: 13.5-13.6 ms/call, x36.97-37.83, result 1000000
```

```js
// B: call f until 200 ms have passed, return ms per call. R: one warm-up pass, then 3 rounds with the variants interleaved;
// prints the range of ms per call and the per-round ratio to the first variant. sink keeps every result in use.
let sink = 0;
const B = (f) => { let n = 0, t; const t0 = performance.now(); do { sink += f(); n++; } while ((t = performance.now() - t0) < 200); return t / n; };
function R(title, vs) {
  const ks = Object.keys(vs), ts = {}; for (const k of ks) { B(vs[k]); ts[k] = []; }
  for (let r = 0; r < 3; r++) for (const k of ks) ts[k].push(B(vs[k]));
  const f = (x) => x.toPrecision(3), q = (k, m) => m(...ts[k].map((t, r) => t / ts[ks[0]][r])).toFixed(2);
  console.log(title);
  for (const k of ks) console.log(`  ${k}: ${f(Math.min(...ts[k]))}-${f(Math.max(...ts[k]))} ms/call, x${q(k, Math.min)}-${q(k, Math.max)}, result ${vs[k]()}`);
}
// JE-S7 / JE-S8, the catalog's shape: many calls of a reader of 10^4 reads (100 calls per timing), plain field, class getter, literal getter.
class C { constructor() { this._a = 1; } get a() { return this._a; } }
const field = { a: 1 }, cls = new C(), literal = { _a: 1, get a() { return this._a; } };
const reader = (tag) => new Function('o', 'let s = 0; for (let i = 0; i < 1e4; i++) s += o.a; return s;');
// Probe: the same script with the readers' comments removed, so all three readers have identical source text.
const r1 = reader(1), r2 = reader(2), r3 = reader(3);
const x100 = (r, o) => () => { let s = 0; for (let i = 0; i < 100; i++) s += r(o); return s; };
R('100 calls of 10^4 reads of o.a', { 'plain field': x100(r1, field), 'class getter': x100(r2, cls), 'object-literal getter': x100(r3, literal) });
```
</details>


- **A new `WeakRef` and every `deref()` keep the target alive until the job ends** ✅[^tc39weak]. A first version of the closure script took its byte counts in the same job as it created `WeakRef`s and so counted every array as kept, and a first liveness loop called `deref()` and the forced GC in the same job and never saw its control collected. The scripts now count bytes without `WeakRef`s and check `deref()` in a timer turn of its own.
- **One function per kind.** In a first closure script, one function with four `if` branches made the control keep its array too: whether a variable is shared with closures depends on all the closures in the function's source. The final script uses one function per kind.
- **Keep earlier results alive in byte counts.** With each case released before the next one, a JavaScriptCore `Map` entry read 6.9 bytes and a Bun `Int32Array` 1.5 bytes; with every result kept to the end, 69.7 and 4.1 ✅[^lab]. Something from the previous case was freed inside the next measurement (this lab cannot see what).
- **Before-and-after in one process measures warm-up too.** In the prototype-write control with no write, `a.map(f)` got 5 times faster on V8-node and `a.slice()` 4.5 times faster on SM-firefox between "before" and "after" ✅[^lab]; §4.5 compares each write with that control.
- **Timers differ.** 0.02 ms in Firefox (with `privacy.reduceTimerPrecision` off) and in the JavaScriptCore shell, 0.1 ms in Chrome, 1 ms in the WebKit page ✅[^lab]: time a pass of 200 ms or more, not single calls.
- **Algebra can remove work.** In the first version of the §4.19 script (`s = (s + i * j) | 0;`) the generated 1,000-statement function ran at 0.004 ns per statement on JSC-mac and JSC-page, far below one instruction per statement; the final script mixes bits so that nothing can be folded. And one JSC-mac run built 10⁴ records in 0.003 ms (§4.3) ✅[^lab]: a printed result proves the result is used, not that every statement ran.
- **Liveness without `gc()` is slow and not always conclusive.** In Firefox the controls were collected after 3 to 60 garbage steps in the timer and weak-reference scripts, while in the closure script one of three controls was still alive after 500 steps in every run, so §4.30 gives no Firefox verdict ✅[^lab].
- **Bun runs a `.js` file in strict mode,** the JavaScriptCore shell does not ✅[^lab]; with strict-mode tail calls, JavaScriptCore drops the caller's frame ✅[^ptc], which changed the frame count in §4.24.

### 6.2 Not done, and what could not be measured

- **Safari itself:** not run (§2.1). JavaScriptCore ran in JSC-mac, JSC-bun and JSC-page.
- **Bytes on SpiderMonkey and in the WebKit page:** no forced GC and no heap figure in a page, so §4.10 and §4.32 have no Firefox or WebKit page column. Firefox's own memory tools (`about:memory`) were not used.
- **`JL-L2`'s bytes:** only time was measured (§4.21).
- **`JL-G2` in the JavaScriptCore shell:** no `setInterval`, `clearTimeout` or `EventTarget` there (§4.31).
- **Internals on SpiderMonkey and JavaScriptCore:** shapes, tiers and deoptimizations were not observed; no timing in this doc is explained by them.
- **Other machines:** one Apple M2 only; no x64, no Windows, no Linux browser.

## Verification status

- **Measured on 2026-11-28** on the six environments of §2.1: 50 scripts (41 for the 33 checks, one probe, and 8 for the environment check), each check script run three times on each environment (`features.js` five times), the probe three times on V8-node only, the environment scripts once where they apply; 697 runs in all by the author, not counting the re-runs below. A second reviewer re-ran the scripts of §4.18 to §4.33 three times on each environment (the ranges in those parts and in their rows of §3 cover both sets of runs), ran the environment scripts once more, and added four scripts: a probe of `Error.stackTraceLimit` (with a strict-mode variant), the slice lengths of §4.32, and the finalizer wait of §4.33; the bit-mixing script of §4.19 replaced the author's. `uptime` one-minute load averages were 2.1 to 13.8 at the start of a run (the highest during the first runs of §4.2 to §4.5 and §4.12 to §4.13, with another lab and this lab's own script checks on the same machine; §4.4, §4.12 and §4.13 were re-run later at loads of 2.6 to 4). Byte counts, call counts, turn counts and liveness results were the same in every run except one JSC-mac `Map` count (84.0 or 125.9 bytes). Timing ratios are quoted as ranges over the runs.
- **Read on 2026-11-28:** the WebKit documentation page on JavaScriptCore, the Firefox source docs page on SpiderMonkey, the Bun documentation's first page, the WebKit blog post on proper tail calls, MDN's `Error.stackTraceLimit` page, and the ECMAScript specification's sections on WeakRef (§26.1, AddToKeptObjects) and on `Array.prototype.find`, `filter` and `sort` (§23.1.3).
- **Not checked:** why any SpiderMonkey or JavaScriptCore timing came out as it did; whether Safari 26.1 uses the same JavaScriptCore build as the macOS 26.1 framework; behaviour on other hardware or operating systems.

## References

- [ECMAScript Language Specification, §9.9 to §9.11 (the processing model of WeakRef and FinalizationRegistry targets, ClearKeptObjects, AddToKeptObjects) and §26.1 WeakRef objects](https://tc39.es/ecma262/multipage/managing-memory.html) — Ecma TC39, living draft. Rank 1. Backs: §2.2 (a new `WeakRef` and `deref()` keep the target until the job ends), §4.32 (a string cannot be a `WeakRef` target), §4.33. [^tc39weak]
- [ECMAScript Language Specification, §23.1.3 Properties of the Array Prototype Object](https://tc39.es/ecma262/multipage/indexed-collections.html) — Ecma TC39, living draft. Rank 1. Backs: §4.22 (`find` returns at the first true result, `filter` visits every index), §4.23 (sort uses an implementation-defined sequence of comparator calls). [^tc39arr]
- [JavaScriptCore](https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html) — WebKit project documentation, living. Rank 1. Backs: §1 (JavaScriptCore is WebKit's engine; its tiers LLInt, Baseline JIT, DFG JIT, FTL JIT). [^jsc]
- [SpiderMonkey](https://firefox-source-docs.mozilla.org/js/index.html) — Firefox source docs, Mozilla, living. Rank 1. Backs: §1 (SpiderMonkey is Firefox's engine; its tiers). [^sm]
- [Welcome to Bun](https://bun.com/docs) — Bun documentation, living. Rank 1. Backs: §1 (Bun runs on JavaScriptCore). [^bun]
- [Error.stackTraceLimit](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/stackTraceLimit) — MDN Web Docs, living. Rank 3. Backs: §4.24 (non-standard, part of V8's stack trace API, also implemented by JavaScriptCore). [^mdnstack]
- [ECMAScript 6 Proper Tail Calls in WebKit](https://webkit.org/blog/6240/ecmascript-6-proper-tail-calls-in-webkit/) — WebKit blog (Michael Saboff), 2016-05-23. Rank 4. Backs: §4.24, §6.1 (proper tail calls only in strict mode, frames of tail calls missing from `Error.stack`). [^ptc]
- Lab: the 50 scripts embedded in §2.1, §4 and §6.1 (41 for the 33 checks, one probe, 8 for the environment check), each check script run three times on 2026-11-28 on V8-node (Node.js 24.22.1, V8 13.6.233.17-node.58, macOS arm64; the environment check also in `node:24.22.1-alpine`, linux arm64), V8-chrome (Google Chrome 158.0.8127.89, V8 15.8.62.31, a visible window), SM-firefox (Firefox 161.0, headless, empty profile, `privacy.reduceTimerPrecision` false), JSC-mac (the `jsc` shell of the JavaScriptCore framework 21622.2.11.11.9 of macOS 26.1), JSC-bun (Bun 1.4.5, WebKit commit d6375c72, `oven/bun:1.4.5`, linux arm64, no network) and JSC-page (the Playwright WebKit build 2311, a visible window), all on one Apple M2 with macOS 26.1; outputs in §4. Rank 1, primary measurement. Backs: every ✅[^lab]. [^lab]

## Related

- [v8-object-and-value-representation-deep-dive.md](v8-object-and-value-representation-deep-dive.md) — how V8 lays out objects, arrays, numbers and strings: the mechanisms behind §4.1 to §4.13.
- [v8-compiler-pipeline-deep-dive.md](v8-compiler-pipeline-deep-dive.md) — V8's tiers, feedback and deoptimization: the mechanisms behind §4.14 to §4.20.
- [v8-memory-and-startup-deep-dive.md](v8-memory-and-startup-deep-dive.md) — V8's garbage collector and what keeps memory alive: the mechanisms behind §4.30 to §4.33.
- [problem-classes-javascript-engine.md](../performance/code-review/problem-classes-javascript-engine.md) — the engine catalog the `JE-` rules come from.
- [problem-classes-javascript-language.md](../performance/code-review/problem-classes-javascript-language.md) — the language catalog the `JL-` rules come from.
- [problem-classes-nodejs-runtime.md](../performance/code-review/problem-classes-nodejs-runtime.md) — the Node.js catalog, source of the microtask trial in §4.29.
