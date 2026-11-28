---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24.22.1 (V8 13.6.233.17, linux arm64, pointer compression off), lab 2026-11-26", "Node.js 22.23.4 (V8 12.4), 25.7.0 (V8 14.1), the Node.js 24.22.3 pointer-compression build (V8 13.6), Electron 38.8.6 (V8 14.0) and 43.7.7 (V8 15.0), Deno 2.9.8 (V8 15.0), Google Chrome 158.0.8127.89 (V8 15.8), lab 2026-11-27", "SpiderMonkey (Firefox 161.0) and JavaScriptCore (macOS 26.1 jsc shell, Bun 1.4.5, Playwright WebKit build 2311), lab 2026-11-28"]
last-verified: 2026-11-28
last-updated: 2026-11-29
tags: [javascript, best-practices, v8, numbers, arrays, elements-kinds, typed-arrays, pointer-compression]
derived-from: [js-runtime/v8-object-and-value-representation-deep-dive.md, js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md, js-runtime/v8-memory-and-startup-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: numbers and arrays

## Summary
**TL;DR:** How V8 stores numbers, number fields and arrays, which array habits pay off and which popular advice makes no measured difference. A double in an object field costs a separate 16-byte box on Node.js 24.22.1, while a double-only array or a `Float64Array` stores 8 bytes per value ✅[^lab]; `for…in` over an array was 25 to 112 times slower than an index `for` on all three engines in the first run, 24 to 127 times in the re-run and 24.9 to 124 times in the third run ✅[^lab-cross]. Chrome and Electron run V8 with pointer compression, which halves pointer-heavy data, makes integers from 2³⁰ up into boxes and caps the heap near 4 GB ✅[^lab-matrix]; JavaScriptCore and SpiderMonkey showed none of these steps ✅[^lab-cross] ✅[^lab-sm].
**Use this when:** writing or reviewing code that holds millions of numbers or records, builds large arrays, loops over arrays on a hot path, or moves a memory figure between Node.js and Chrome or Electron; a review asks for `0.0`, for `push` instead of `new Array(n)`, or to avoid holey arrays.
**Not this doc:** object shapes and `delete` → [objects-and-shapes.md](objects-and-shapes.md); `Map`, `Set`, strings and typed-array counters → [strings-and-collections.md](strings-and-collections.md); one value type per hot site and `Math.imul` → [functions-and-optimization.md](functions-and-optimization.md) (`JE-F3`); heap limits in containers → [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md); the mechanisms in full → [the object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md).

## Scope
Eleven practices, `JE-N1` to `JE-N11`: number representations (`JE-N1` to `JE-N3`), arrays (`JE-N4` to `JE-N8`) and V8 builds with pointer compression (`JE-N9` to `JE-N11`).
- **Baseline build:** The numbers come from Node.js 24.22.1 (V8 13.6.233.17, linux arm64, pointer compression off) on 2026-11-26 unless a line names another build ✅[^lab].
- **Other builds, second day:** The 2026-11-27 re-run covered Node.js 22.23.4 and 25.7.0, Electron 38.8.6 and 43.7.7, Deno 2.9.8, the Node.js 24.22.3 pointer-compression build and Google Chrome 158.0.8127.89 (V8 15.8.62.31, macOS arm64, headless, named "Chrome 158" below), where bytes were read through `performance.memory.usedJSHeapSize` after `gc()` (Chrome flags `--enable-precise-memory-info` and `--js-flags=--expose-gc`) ✅[^lab-matrix].
- **Chrome flag:** Chrome timings used `--disable-renderer-backgrounding`; without it headless Chrome sometimes keeps code in V8's middle compiler, and those runs are given apart as "default headless" ✅[^lab-matrix].
- **Which claims:** A claim holds for V8 unless its note has an **Other engines** line, from one cross-engine lab on 2026-11-28 (one Apple M2, macOS 26.1) on SpiderMonkey (Firefox 161.0, headless) and JavaScriptCore (the macOS 26.1 `jsc` shell, Bun 1.4.5, a Playwright WebKit page), beside V8 in Node.js 24.22.1 and Chrome 158; timing ratios there are of the lowest of three runs, bytes are heap growth after a forced full collection ✅[^lab-cross].
- **Bytes off V8:** Bytes could not be measured in the Firefox page or in the WebKit page, which have no forced collection and no heap figure; SpiderMonkey's bytes come from Mozilla's JavaScript shell for Firefox 161.0 (a Linux arm64 container on the same machine, 2026-11-28), which has both ✅[^lab-sm].
- **Not checked on other engines:** `JE-N2`, `JE-N3`, `JE-N4`, `JE-N11`; `JE-N9` to `JE-N11` are about V8 builds with pointer compression and are V8-specific by nature.

**How the timings were taken.** All labs ran on one Apple M2 laptop with macOS 26.1; Linux builds ran in containers in a virtual machine on it, and x64 builds were emulated ✅[^lab-matrix]. The timings were measured three times:
- **first run (2026-11-26)** for the Node.js 24.22.1 baseline, **first run (2026-11-27)** for the other builds and headless Chrome 158, and **first run (2026-11-28)** for the cross-engine lab, in the night before the lab machine was restarted. For the cross-engine lab's browser windows the runner did not yet check for a locked screen or keep one browser window at a time, so the conditions of that run are not fully known ✅[^lab-cross].
- **re-run (2026-11-28, after the restart)**: every script was taken from the lab docs and run again, screen unlocked, one browser window at a time, one timing run at a time; other, untimed jobs ran on the machine, and the load was high for part of it ✅[^lab-matrix] ✅[^lab-cross]. The SpiderMonkey shell was measured only then (three runs of its script, the same bytes each time), so its figures have no first run ✅[^lab-sm].
- **third run (2026-11-28, evening, quiet machine)**: the timing scripts only, with the re-run's commands, one run at a time, each started only when the one-minute load average was below 3.0; no other lab job ran, and the owner's desktop applications stayed open ✅[^lab-matrix] ✅[^lab-cross]. The one-minute load average at the start of the runs was 1.54 to 2.99 (median 2.63) in the cross-engine lab's §4.1 to §4.17 ✅[^lab-cross], 1.77 to 2.99 (median 2.385) in the object deep dive and 1.56 to 2.98 (median 2.435) in the engine catalog ✅[^lab-matrix]. It is the only run made under a controlled load: where the runs differ, its values are the ones to quote for a quiet machine, and the earlier values stay as the record of what load and uncontrolled conditions do. Byte counts, labels, limits and the SpiderMonkey shell were not part of it.

The conclusions are the order of the alternatives and the ratio between them, which held in all three runs unless a note says otherwise; the milliseconds are quoted as the machine printed them under that load, and will differ on another machine or under another load.
- **Load records:** in the cross-engine lab, the one-minute load average was 2.1 to 13.8 at the start of the runs in the first run ✅[^lab-cross], and 2.1 to 37.2 at the start of the runs in the re-run (each note gives the range of its own check; the runs of `JE-N6` that started above 13.8 were run again at 3.4 to 5.2, and its note tells the first three runs from the repeats; the check of `JE-N7`, whose runs started at 9.8 to 16.9, was not run again) ✅[^lab-cross].
- **Baseline and other builds:** For the baseline and the other builds the load was not recorded in the first run or the re-run; the review catalog's re-run left out two baseline runs that were taken while the machine was loaded ✅[^lab].
- **Bytes, labels and limits:** Byte counts, labels and limits do not depend on the load and came out the same in both runs ✅[^lab-matrix] ✅[^lab-cross].
- **Timings without a run label:** A timing without a run label came out the same in the re-run, to the digits quoted, or the note gives the re-run's own figure or says that the re-run did not time that case again.

How to read the "Applies" column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it). Correct and clear code comes first: a practice chooses between two equally clear forms. Where an "Applies" cell names an engine, the practice differs on that engine: for code that must be fast in every browser, follow what the cell says for it.

Terms:
- **Small integer** (V8: Smi): an integer stored inside the value slot itself, like a price written on the tag. Any other number is a **heap number**, a separate box the slot points to, like a price on a card in a drawer.
- **Field representation**: what kind of value a property slot has held so far (small integer, double, anything); it only widens ✅[^v8-fields], like a shelf marked "coins only" that is relabelled "coins or notes" and never back.
- **Elements kind**: V8's label for what an array holds (small integers, doubles or anything) and whether it may have gaps (**holey**) or not (**packed**); the label only moves toward "anything" and "holey" ✅[^v8-elements], like an egg carton marked "may have empty cups" once one cup was empty.
- **Dictionary elements**: numbered elements kept in a hash table keyed by index ✅[^v8-jsarray], like a ledger that lists only its filled pages.
- **Pointer compression**: a V8 build option that keeps the whole heap in one 4 GB (gigabyte) block of addresses, the cage, and stores each pointer as a 4-byte offset instead of an 8-byte address ✅[^v8-ptrcomp] ✅[^v8-ptrcomp-design], like writing only room numbers when everyone lives in one building. Off in the official Node.js builds, on in Chrome and Electron ✅[^lab-matrix].
- **Natives check**: a V8 test function such as `%HasHoleyElements(a)`, usable only under `node --allow-natives-syntax` or in a Chrome page started with `--js-flags=--allow-natives-syntax`, for experiments only, like a mechanic's diagnostic plug. V8's trace output (`--trace-…` flags) cannot be read from a headless page.
- **MiB** (mebibyte): 1,048,576 bytes; **ms** and **ns**: milliseconds and nanoseconds.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JE-N1` | Millions of `{ x: 0.5, y: … }` records for numeric work, or a double array that also holds a string or `undefined` | Store the values in a numbers-only array or a `Float64Array` (8 bytes each) | large data | `{ x }` 32 bytes with an integer, 48 with a double; doubles 8.0 bytes in a double-only array, 24.0 beside one string (Node.js 24.22.1) ✅[^lab]; no boxing on JavaScriptCore ✅[^lab-cross] or in the SpiderMonkey shell ✅[^lab-sm] |
| `JE-N2` | A number field started as `null`, `''` or a string, or holding strings in some objects | Start number fields at `0`, or `NaN` for "not computed yet"; keep each field one type | hot path | `--trace-generalization` showed a field widen small integer → double → anything for every object of the shape (V8 12.4 to 15.0) ✅[^lab-matrix]; the V8 team names `null` as an initial value that disables this tracking ✅[^v8-react] |
| `JE-N3` | `x = 0.0`, or a review asking for `1.0` "so V8 treats it as a float" | Keep writing `0`: `0.0` is the same small integer | no gain | `%IsSmi(3.0)` was `true` on every build tried, Chrome 158 included ✅[^lab-matrix] |
| `JE-N4` | `undefined`, `''` or a string placeholder pushed into a numeric array; `arr.length = 0` to reset an array | Use `-1` or `NaN` as "missing"; to drop a wider kind, build a new array with `filter`, `map` or `slice` | large data | `length = 0` and `push(1)` left an array `PACKED_ELEMENTS`; one string made each double 24.0 bytes against 8.0 (Node.js 24.22.1) ✅[^lab] |
| `JE-N5` | A review asking to replace `new Array(n)` filled by index with `push`, or to avoid holey arrays for speed | Keep the code | no gain | With no real holes, holey summed 8 to 23 % slower than packed on Node.js 24.22.1 (three runs) ✅[^lab] (0 to 28 % on four V8 builds in the re-run and the third run), 0 to 12 % in Chrome 158 (three runs) ✅[^lab-matrix], 0.94 to 1.12 times in Firefox and JavaScriptCore (three runs) ✅[^lab-cross] |
| `JE-N6` | `const out = []` then `out.push(…)` in a loop over a source of known length (100,000+ elements) | Preallocate with `new Array(n)` and write by index; keep `push` when the length is unknown | large data (V8, JavaScriptCore; no gain measured on SpiderMonkey) | 10⁶ elements: `push` 2.7 to 4.3 times slower (Node.js 24.22.1, three runs) ✅[^lab], 2.0 to 3.0 in Chrome 158 (three runs) ✅[^lab-matrix] |
| `JE-N7` | `arr[id] = v` with large or scattered ids, `new Array(n)` above 33,554,432, or a getter on an element | Fill arrays from index 0 upward; put sparse ids in a `Map` | large data | A gap of 1024+ slots or a length above 33,554,432 made hash-table elements (V8 12.4 to 15.8) ✅[^lab-matrix] |
| `JE-N8` | `for (const k in arr)` over an array, typed array, `arguments` or `NodeList`; `parseInt(k)` in the body | Use an index `for`; in hot loops not `for…of` either | always | `for…in` 24 to 127 times an index `for` on all three engines (three runs), 15.5 to 33 times in Node.js 24.22.1 and Chrome 158 (all modes, three runs); `for…of` 2.4 to 4.3 times in Firefox and the JavaScriptCore shell (three runs) ✅[^lab-cross] |
| `JE-N9` | Chrome or Electron code with millions of objects whose integer field reaches 2³⁰ (Unix seconds, 32-bit hashes) | Expect a 12-byte box per field there; a typed-array column is an option, gain not measured | check build | `%IsSmi(2 ** 30)` `false` in Chrome 158, Electron 38 and 43 and the pointer-compression build, `true` on official Node.js ✅[^lab-matrix]; JavaScriptCore and SpiderMonkey showed no step at 2³⁰ ✅[^lab-cross] ✅[^lab-sm] |
| `JE-N10` | A memory budget or bytes-per-entry figure moved between Node.js and Chrome or Electron | Measure on the shipping engine and build | check build | With pointer compression, objects, `Map`s and small-integer arrays took half the bytes, doubles and typed arrays the same (Chrome 158, Electron 43, pointer-compression build) ✅[^lab-matrix]; JavaScriptCore and the SpiderMonkey shell differ ✅[^lab-cross] ✅[^lab-sm] |
| `JE-N11` | Browser or Electron code needing heaps over 4 GB, or `--max-old-space-size` above 4096 on Electron or a pointer-compression Node.js build | Plan for at most about 4 GB of V8 heap per process; read `jsHeapSizeLimit` or `heap_size_limit` | check build | Chrome 158: 4,192 MiB even with `--max-old-space-size=8192`; pointer-compression build 4,095.75 MiB against 8,384 MiB official ✅[^lab-matrix] |

## Lookup notes

### `JE-N1` Keep millions of fractional values in a double-only array or a `Float64Array`, not in object fields or mixed arrays
Measured at 1,000,000 elements and 100,000 objects.
**Seen in code as:** millions of `{ x: 0.5, y: 1.25 }` records for numeric work, or an array of doubles that also holds a string or `undefined`.
**Prefer:**
```js
const xs = new Float64Array(n), ys = new Float64Array(n); // 8 bytes per value
// or a plain array that only ever holds numbers: 8 bytes per value
```
**Avoid:**
```js
const pts = [];
for (let i = 0; i < n; i++) pts.push({ x: i + 0.5, y: i + 0.5 }); // a 16-byte box per field
```
**Why:** In V8, a double field, or a double in a mixed array, points to its own heap-number box ✅[^v8-fields]; a double-only array or a `Float64Array` stores the raw 8 bytes ✅[^lab].
**Evidence:** Bytes per element, Node.js 24.22.1 (V8 13.6, arm64): double-only array 8.0, `Float64Array` 8.0, doubles in an array holding one string 24.0. Per object: `{ x }` 32 bytes with an integer, 48 with a double; 10 fields 104 against 264 ✅[^lab]. The same within 0.1 byte on Node.js 22.23.4 and 25.7.0. With pointer compression (Electron 43; the Node.js 24.22.3 pointer-compression build) the box is 12 bytes: `{ x }` 16 against 28, mixed array 16.0, double-only array still 8.0. Chrome 158: `{ x }` 16 against 28, 10 fields 52 against 172.1, mixed array 16.0, double-only array and `Float64Array` 8.0 ✅[^lab-matrix].
**Other engines:** The boxed double field is V8's. The bytes of the cross-engine lab were the same in its first run and its re-run ✅[^lab-cross].
- **JavaScriptCore, V8 in Node.js and Chrome:** on JavaScriptCore (shell, Bun) an array element took 8.0 bytes and a `{ x }` object with its array slot 40.0 bytes whether `x` held a small integer, an integer just below 2³¹ or a double, against 40.0 and 56.0 on V8 in Node.js 24.22.1 (macOS) and 20.0 and 32.0 in Chrome 158 for a small integer and a double.
- **Double arrays and `Float64Array`** took 8.0 bytes per element on every engine measured, so they stay the compact choice there too ✅[^lab-cross].
- **In the SpiderMonkey shell** an array element took 8.4 bytes and a `{ x }` object with its array slot 48.9 bytes for a small integer, an integer just below 2³¹ and a double alike, and a `Float64Array` 8.0, measured once, in the re-run (2026-11-28, after the restart) ✅[^lab-sm].
- **Not measured in the Firefox page or in the WebKit page**: a page has no heap figure ✅[^lab-cross]; arrays with a string mixed in were not run off V8.
**Exceptions:** Thousands of records gain nothing worth a change. Columns of typed arrays change how code reads; that cost is worth taking only where memory or a profile shows the need.
**Check it:** `node --expose-gc` with `gc()` and `process.memoryUsage().heapUsed` before and after building n records (`arrayBuffers` for typed arrays); divide by n. In Chrome, the same with `performance.memory.usedJSHeapSize` (flags in Scope); in Chrome 158 it also counted typed-array contents ✅[^lab-matrix].
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.2 Number fields and §4.1 Bytes per element; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.10 bytes per element.

### `JE-N2` Start a number field with a number, never `null`, `''` or a string
**Seen in code as:** `this.total = null`, `count: ''`, or a field that holds numbers in some objects and strings in others.
**Prefer:**
```js
class Stat { constructor() { this.total = 0; this.avg = NaN; } } // NaN = "not computed yet"
```
**Avoid:**
```js
class Stat { constructor() { this.total = null; this.avg = ''; } }
```
**Why:** V8 tracks what kind of value each field has held and only widens it, and the widening applies to the whole transition tree, so one object with a string makes the field "anything" for every object of that shape ✅[^v8-fields].
**Evidence:** `--trace-generalization` showed `x` going small integer → double → tagged (`s` → `d` → `t`), and an object created after the widening already started at `d` (Node.js 24.22.1, V8 13.6, arm64) ✅[^lab]; the same on V8 12.4, 14.1, 15.0 and the Node.js 24.22.3 pointer-compression build ✅[^lab-matrix]. The V8 post of 28 August 2019 names `null` as an initial value that disables this tracking, and React's mitigation, described there, started time fields at `Number.NaN` ✅[^v8-react].
**Exceptions:** Objects that are not hot. The compiler side (one value type per hot site, `Math.imul` for hash math) is `JE-F3` in [functions-and-optimization.md](functions-and-optimization.md).
**Check it:** `node --trace-generalization app.js 2>&1 | grep 'generalizing.*app.js'` (Node.js's own start-up prints many lines too): `total:d{…}->t{…}` for a numeric field means it became "anything". Not checked in Chrome: the check reads V8's trace output, which a headless page does not return.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.2 Number fields: representations, boxing and generalization.

### `JE-N3` Writing `0.0` does not make a field "a double"
**Keep writing:** `this.x = 0;`
**Why:** An integer-valued literal is a small integer whatever its spelling; the field widens once, when the first fraction arrives ✅[^lab].
**Evidence:** `%IsSmi(3.0)` was `true` (Node.js 24.22.1, V8 13.6, arm64) ✅[^lab]; the same on every build tried, Chrome 158 included ✅[^lab-matrix].
**Exceptions:** When a field must start as a double, the mitigation for React described in the 2019 V8 post used `Number.NaN` ✅[^v8-react] (`JE-N2`).
**Check it:** `node --allow-natives-syntax -p '%IsSmi(0.0)'` prints `true`.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.1 Tagged values and §3.2 Number fields.

### `JE-N4` Keep a number array to numbers only; build a new array to change its kind back
Applies to arrays of about 1,000,000 elements, or hot arrays.
**Seen in code as:** `arr.push(undefined)`, `''` or a string placeholder in a numeric array; `arr.length = 0` used to "reset" an array that once held other values.
**Prefer:**
```js
const ids = [];            ids.push(-1);   // integer "missing" marker
const prices = [];         prices.push(NaN); // double "missing" marker, still unboxed
const fresh = mixed.filter((v) => typeof v === 'number'); // new array, specific kind again
```
**Avoid:**
```js
prices.push(undefined); // leaves the numbers-only kind
arr.length = 0;         // keeps the old kind
```
**Why:** One value of a wider kind moves the whole array to that kind for good ✅[^v8-elements]. `map`, `filter` and `slice` start a new array at the most specific kind ✅[^lab].
**Evidence:** `push(4.5)` made `[1, 2, 3]` `PACKED_DOUBLE`, `push('x')` `PACKED_ELEMENTS`; `pop`, `length = 0` and `push(1)` left it `PACKED_ELEMENTS`; `-0`, `NaN`, `Infinity` and `2 ** 31` made a small-integer literal `PACKED_DOUBLE`; `[1.5, 2.5].map(Math.round)` was `PACKED_SMI`; with one string in it, each double cost 24.0 bytes against 8.0 (Node.js 24.22.1, V8 13.6, arm64) ✅[^lab].
- **V8 post:** The V8 post on elements kinds names `-0`, `NaN` and `Infinity` too ✅[^v8-elements].
- **Across V8 versions:** `[1, undefined, 3]`, `Array.from({ length: 3 })` and `new Array(5).fill(undefined)` were `PACKED_ELEMENTS` on V8 12.4 to 14.1 and the pointer-compression build, but `HOLEY_DOUBLE_ELEMENTS` on V8 15.0 (Deno 2.9.8, Electron 43) and in Chrome 158 (V8 15.8): the change comes with the V8 version. Only the label was read there; the memory and speed of such arrays on V8 15 were not measured. `[...new Array(3)]` stayed packed everywhere ✅[^lab-matrix].
**Exceptions:** Small or short-lived arrays. The speed of mixed arrays was not timed; the measured cost is memory.
**Check it:** `node --allow-natives-syntax -e 'console.log(%HasSmiElements(a), %HasDoubleElements(a), %HasObjectElements(a))'` on the array; the same natives answer in a Chrome page.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.6 Elements kinds, §4.1 Bytes per element and §6.2 Pitfalls.

### `JE-N5` `new Array(n)` and holey arrays need no rewrite to avoid "slow holey arrays"
An array with no real holes summed typically 8 to 11 % slower than a packed one, under 1.2 ms per million elements.
**Keep writing:**
```js
const a = new Array(n);
for (let i = 0; i < n; i++) a[i] = f(i); // holey label, no real holes
```
**Why:** The holey label costs a few extra checks per read, not a different storage ✅[^lab].
**Evidence:** Over the three runs the holey label cost under 0.5 ms per million elements on every V8 build, mostly under 0.2 ms ✅[^lab] ✅[^lab-matrix]. The three runs agree: with no hole left, the holey sum was a few per cent to about a quarter slower, now and then a little more ✅[^lab-matrix].
- **Summing, baseline build, first run:** Summing 1,000,000 small integers: holey 8 to 11 % above packed in 8 of 9 rounds, 55 % (1.15 against 0.74 ms) in one; 0.08 ms both at 100,000; 9.1 to 10.5 ms packed against 9.4 to 10.1 ms holey at 10,000,000 (Node.js 24.22.1, V8 13.6, arm64) ✅[^lab].
- **Other builds, first run:** The same picture on V8 12.4, 14.1 and 15.0. Chrome 158: holey 0 to 12 % above packed (0 to 25 % in default headless; 0.9 to 1.0 ms against 0.8 to 0.9 ms, with a timer of about 0.1 ms). `new Array(n).fill(0)` makes the array packed on V8 13.6, 14.1, 15.0 and Chrome 158 but stays holey on V8 12.4 (Node.js 22); filling by index stays holey on every build ✅[^lab-matrix]. Those timings are the first run (2026-11-26 and 2026-11-27).
- **Re-run, Node.js and Electron:** The re-run (2026-11-28, after the restart; load not recorded) did not time the baseline container again; on Node.js 24.22.1 on macOS, Node.js 22.23.4 and 25.7.0 and Electron 43, holey summed 0 to 28 % above packed (packed 0.69 to 0.83 ms, holey 0.78 to 0.96 ms, three runs of three rounds each) ✅[^lab-matrix].
- **Re-run, Chrome:** In Chrome 158 the re-run gave packed 0.80 ms in all nine rounds and holey 0.80 to 0.90 ms with the renderer not backgrounded (0 to 12 %), and in default headless (0 to 17 %) 0.80 against 0.80 to 0.90 ms in two runs and 1.20 to 1.30 against 1.30 to 1.40 ms in one ✅[^lab-matrix].
- **Re-run, older V8:** One re-run round on V8 12.4 gave 28 %, so "within about 25 %" is the typical case, not a bound ✅[^lab-matrix].
- **Third run, Node.js and Electron:** The third run (2026-11-28, evening, quiet machine, under a load average of 1.93 to 2.82 at the start of the runs) gave holey 8 to 23 % above packed on the baseline build (0.77 to 0.86 ms against 0.70 to 0.74 ms; 23 % in one round, 8 to 11 % in the other eight) ✅[^lab], 5 to 10 % on Node.js 24.22.1 on macOS (0.76 to 0.78 against 0.69 to 0.74 ms), 19 to 22 % on Node.js 22.23.4 (0.86 to 0.90 against 0.72 to 0.75 ms), 6 to 15 % on Node.js 25.7.0 (0.76 to 0.79 against 0.67 to 0.73 ms) and 0 to 3 % on Electron 43 (0.76 to 0.79 against 0.75 to 0.78 ms) ✅[^lab-matrix].
- **Third run, Chrome:** In Chrome 158 0 to 12 % with the renderer not backgrounded (0.8 to 0.9 ms against 0.8 to 0.9 ms) and 0 to 29 % in default headless (0.8 to 0.9 ms against 0.7 to 0.8 ms; the 29 % is 0.9 against 0.7 ms, two steps of the timer) ✅[^lab-matrix].
- **V8 post:** The V8 post that said a holey array stays holey forever added the `fill` exception in an update of 28 February 2025 ✅[^v8-elements].
**Other engines:** Nothing to gain by rewriting on any of the three engines. Over the three runs the holey label cost nothing measurable outside V8, but for 12 % in one JavaScriptCore shell run of nine, in the third run only, and about 10 to 13 % on Node.js (1 to 7 % in Chrome) ✅[^lab-cross].
- **Ratio to the packed array, first run:** summing 10⁶ small integers from `new Array(n)` filled by index took 0.94 to 1.01 times the packed array on SpiderMonkey (Firefox 161), 1.00 to 1.01 times on JavaScriptCore (shell, Bun, WebKit page), and on V8 in the same lab 1.12 to 1.13 (Node.js 24.22.1, macOS) and 0.99 to 1.06 (Chrome 158) ✅[^lab-cross].
- **Packed sum, first run:** In the first run (2026-11-28) the packed sum took 0.73 to 0.74 ms on Node.js, 0.82 to 0.86 ms in Chrome, 0.68 to 0.72 ms on SpiderMonkey and 0.48 to 0.49 ms on JavaScriptCore ✅[^lab-cross].
- **Re-run:** The re-run (2026-11-28, after the restart, three runs, none repeated, under a load average of 3.1 to 9.6 at the start of the runs) gave 0.73 to 0.74 ms, 0.80 to 0.85 ms, 0.68 ms and 0.48 to 0.53 ms (0.53 in one shell run), and the filled array took 1.10 to 1.13 times the packed one on Node.js, 1.01 to 1.06 in Chrome, 0.99 to 1.01 on SpiderMonkey and 0.99 to 1.01 on JavaScriptCore ✅[^lab-cross].
- **Third run:** The third run (2026-11-28, evening, quiet machine, under a load average of 1.8 to 3.0 at the start of the runs) gave the packed sum at 0.724 to 0.729 ms on Node.js, 0.803 to 0.826 ms in Chrome, 0.675 to 0.782 ms on SpiderMonkey and 0.467 to 0.498 ms on JavaScriptCore, and the filled array at 1.12 times the packed one on Node.js, 1.03 to 1.07 in Chrome, 0.96 to 1.03 on SpiderMonkey and 1.00 to 1.01 on JavaScriptCore, except one shell run at 1.12 (0.559 against 0.498 ms, load 2.9) ✅[^lab-cross].
**Exceptions:** Arrays with real holes left in them were not timed. A dictionary-mode object is a different case (about seven times slower reads: `JE-O2` in [objects-and-shapes.md](objects-and-shapes.md)).
**Check it:** `node --allow-natives-syntax -p '%HasHoleyElements(new Array(3).fill(0))'`: `false` on Node.js 24 and in Chrome 158, `true` on Node.js 22.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.7 Holes, `new Array(n)` and `fill`, and §6.1 Corrections; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.6 `JE-N5`.

### `JE-N6` Preallocate with `new Array(n)` when the length is known; use `push` when it is not
From about 100,000 elements; at 1,000 the difference was below the timer.
**Prefer:**
```js
const out = new Array(src.length);
for (let i = 0; i < src.length; i++) out[i] = f(src[i]);
```
**Avoid:**
```js
const out = [];
for (let i = 0; i < src.length; i++) out.push(f(src[i])); // grows in steps
```
**Why:** `push` grows the backing store in steps and keeps spare room; a known length allocates once ✅[^lab].
**Evidence:** Over the three runs: 2.0 to 3.0 times in Chrome (nine runs), 1.4 to 5.2 in default headless (twelve runs), and `push` was slower in every run on every build ✅[^lab-matrix]. On Node.js 22.23.4 and 25.7.0 the quiet third run's 4.3 to 4.6 and 4.5 to 4.7 times lie above both earlier runs, and on Electron 43 at the low end of both ✅[^lab-matrix].
- **Baseline build, first run:** Building 1,000,000 small integers: `push` 4.1 to 5.7 ms, `new Array(n)` by index 1.2 to 1.3 ms, `new Array(n).fill(0)` first 1.8 to 2.0 ms, four runs: `push` 3.3 to 4.3 times slower (Node.js 24.22.1, V8 13.6, arm64). At 100,000: 0.45 to 0.50 against 0.13 ms. `push` also used 10.4 bytes per element against 8.0 ✅[^lab].
- **Other builds and Chrome, first run:** 2.9 to 4.3 times on Node.js 22.23.4 and 25.7.0; 2.2 to 2.9 times on Electron 43 (2.0 to 2.6 ms against 0.78 to 1.19 ms, five runs). Chrome 158, first run (2026-11-27): 2.0 to 3.0 times (1.8 to 2.4 ms against 0.8 to 0.9 ms, three runs; 1.4 to 4.8 times in default headless, 1.8 to 5.8 ms against 0.8 to 1.4 ms, six runs) ✅[^lab-matrix].
- **Re-run, Node.js and Electron:** Re-run (2026-11-28, after the restart; load not recorded): the baseline container was not timed again; `push` took 3.3 to 4.4 times the preallocated build on Node.js 24.22.1 on macOS, 22.23.4 and 25.7.0 (4.94 to 6.09 ms against 1.13 to 1.56 ms) and 2.9, 2.6 and 2.4 times on Electron 43 (2.31 against 0.80 ms, 2.07 against 0.80 ms and 2.05 against 0.85 ms), three runs each ✅[^lab-matrix].
- **Re-run, Chrome:** Chrome 158 gave 2.4 to 2.7 times (1.8 to 2.2 ms against 0.7 to 0.9 ms, three runs) and 2.3 to 5.2 times in default headless (1.6 to 5.7 ms against 0.7 to 1.1 ms, three runs) ✅[^lab-matrix].
- **Third run, baseline build:** The third run (2026-11-28, evening, quiet machine, under a load average of 1.93 to 2.99 at the start of the runs) gave `push` at 2.7 to 4.0 times the preallocated build on Node.js 24.22.1 in the container (4.26 to 4.75 ms against 1.17 to 1.66 ms, three runs), and 0.44 to 0.48 against 0.12 to 0.13 ms at 100,000 ✅[^lab].
- **Third run, other builds:** 3.3 to 4.3 times on Node.js 24.22.1 on macOS (5.24 to 5.39 against 1.24 to 1.59 ms), 4.3 to 4.6 on Node.js 22.23.4 (5.80 to 6.17 against 1.33 to 1.36 ms), 4.5 to 4.7 on Node.js 25.7.0 (5.10 to 5.35 against 1.11 to 1.17 ms) and 2.43, 2.51 and 2.49 times on Electron 43 (1.80, 1.83 and 1.79 ms against 0.74, 0.73 and 0.72 ms), three runs each ✅[^lab-matrix].
- **Third run, Chrome:** Chrome 158 gave 2.4 to 2.8 times (1.7 to 2.5 ms against 0.7 to 0.9 ms, three runs) and 3.1 to 5.1 times in default headless (2.2 to 5.6 ms against 0.7 to 1.1 ms, three runs) ✅[^lab-matrix].
- **V8 post:** The 2017 V8 post's advice to avoid holes (start empty and `push` when the values are not known) does not carry over to timing here; its own text says the access difference between holey and packed arrays is usually too small to matter ✅[^v8-elements].
**Other engines:** Holds on V8 and JavaScriptCore, no effect on SpiderMonkey. Over the three runs the order held on V8 and JavaScriptCore in every run, and on SpiderMonkey neither form was faster in the repeats and the third run; the ratios held in the repeats, and the loaded runs moved them (JavaScriptCore up to 10.6 times faster preallocated) as well as the milliseconds. The quiet third run agrees with the first run and the repeats, so the re-run's high `push` times and its 1.20 on SpiderMonkey went with the load of its runs 1 to 3 (8.5 to 21.8) ✅[^lab-cross].
- **Building numbers, first run:** building 10⁶ numbers (`i * 0.5`) with `new Array(n)` by index took 0.98 to 1.06 times `push` on SpiderMonkey (Firefox 161); on JavaScriptCore (shell, Bun, WebKit page) 0.15 to 0.22 times, so `push` was 4.5 to 6.7 times slower; on V8 in the same lab 0.28 to 0.33 (Node.js 24.22.1, macOS) and 0.42 to 0.44 (Chrome 158). Preallocating cost nothing on any engine ✅[^lab-cross].
- **Measured times, first run:** In the first run (2026-11-28) `push` took 4.77 to 5.00 ms on Node.js, 1.90 to 1.92 ms in Chrome, 2.70 to 3.12 ms on SpiderMonkey and 2.92 to 3.53 ms on JavaScriptCore ✅[^lab-cross].
- **Re-run, first three runs and repeats:** The re-run (2026-11-28, after the restart) took its first three runs at a load average of 8.5 to 21.8: `push` then took 8.5 to 11.4 ms on Node.js, 2.5 to 2.8 ms in Chrome, 2.9 to 3.7 ms on SpiderMonkey and 3.0 to 3.2 ms on JavaScriptCore (5.8 ms in the first Bun run); its four repeats, at 3.4 to 5.2, took 4.6 to 5.5 ms on Node.js, 1.8 to 2.1 ms in Chrome, 2.6 to 3.2 ms on SpiderMonkey and 2.9 to 3.7 ms on JavaScriptCore, with the preallocated build at 0.28 to 0.31 times `push` on Node.js, 0.41 to 0.44 in Chrome, 0.99 to 1.07 on SpiderMonkey and 0.14 to 0.23 on JavaScriptCore ✅[^lab-cross].
- **Loaded runs of the re-run:** In the loaded runs 1 to 3 the preallocated build took 0.24 to 0.34 times `push` on Node.js, 0.35 to 0.40 in Chrome, 0.09 to 0.25 on JavaScriptCore and 0.93 to 1.20 on SpiderMonkey (the 1.20 in a run that started at a load average of 19.8) ✅[^lab-cross].
- **Third run:** The third run (2026-11-28, evening, quiet machine, under a load average of 1.7 to 3.0 at the start of the runs) gave `push` at 4.31 to 5.17 ms on Node.js, 1.80 to 1.90 ms in Chrome, 2.75 to 2.89 ms on SpiderMonkey and 2.87 to 5.43 ms on JavaScriptCore; preallocating was 3.1 to 3.5 times faster on Node.js, 2.4 to 2.8 times in Chrome and 4.3 to 9.2 times on JavaScriptCore, and on SpiderMonkey `new Array(n)` took 0.98 to 1.06 times the `push` time ✅[^lab-cross].
**Exceptions:** Unknown length (filters, streams): `push` fits, and counting first just to preallocate is not worth it.
**Check it:** Time both forms at n and 10 × n on the build that ships.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §6.1 Corrections and §4.1 Bytes per element; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.7 `JE-N6`.

### `JE-N7` Fill arrays from index 0 upward; use a `Map` for sparse indexes
Applies to indexes with gaps of 1024 or more, or lengths above 33,554,432.
**Seen in code as:** `arr[id] = v` with large or scattered `id` values on an empty or short array, `new Array(hugeN)`, or `Object.defineProperty(arr, i, { get … })`.
**Prefer:**
```js
const byId = new Map(); byId.set(50000, v);        // sparse ids
const dense = []; for (let i = 0; i < n; i++) dense[i] = v; // dense, from 0
```
**Avoid:**
```js
const a = []; a[50000] = v; // elements become a hash table
```
**Why:** A write that leaves 1024 or more empty slots past the end, which fits the V8 source's maximum gap of 1024 ✅[^v8-jsobjects], or a length above the source's maximum fast array length ✅[^v8-jsarray], switches the array's elements to a hash table keyed by index ✅[^lab].
**Evidence:** On `[1, 2, 3]`, `a[1027] = 1` switched to dictionary elements and `a[1026] = 1` did not; `new Array(33554433)` was dictionary, `new Array(33554432)` was not; a getter on an element switched it; filling indexes 0 to 49,999 after `a[50000] = 1` made it fast again; `length = 100000` made it holey, not dictionary (Node.js 24.22.1, V8 13.6, arm64) ✅[^lab]; the same on V8 12.4, 14.1, 15.0 and Chrome 158 ✅[^lab-matrix]. The 2026-11-26 lab did not time reads of dictionary elements; the cross-engine lab did (below).
**Other engines:** Holds on all three engines, weaker for reads in Chrome and Firefox. Over the three runs the `Map` was faster to fill and to read on every engine, by the margins given. The quiet third run gave what the loaded re-run gave: this check gave the same values at a load of 9.8 to 16.9 and at 1.7 to 2.9 ✅[^lab-cross].
- **Writing and reading back ids with gaps, array against map, first run:** 10⁴ ids with gaps of 1,024 written into `[]` took 1.79 to 1.92 times a `Map` on SpiderMonkey (Firefox 161) and read back 1.41 to 1.48 times; on JavaScriptCore (shell, Bun, WebKit page) 2.76 to 3.41 and 1.84 to 2.85 times; on V8 in the same lab 2.81 to 3.04 and 1.35 to 2.00 (Node.js 24.22.1, macOS), 2.28 to 2.33 and 1.09 to 1.13 (Chrome 158) ✅[^lab-cross].
- **Measured times, first run:** Those ratios are the first run (2026-11-28): filling the `Map` took 0.39 to 0.40 ms on Node.js, 0.25 to 0.26 ms in Chrome, 0.25 to 0.29 ms on SpiderMonkey and 0.13 to 0.16 ms on JavaScriptCore, and reading it back 0.12 to 0.18, 0.098 to 0.106, 0.115 to 0.116 and 0.036 to 0.052 ms ✅[^lab-cross].
- **Re-run:** The re-run (2026-11-28, after the restart, three runs, none repeated, under a load average of 9.8 to 16.9 at the start of the runs) gave the array at 2.89 to 3.03 times the `Map` to write and 1.92 to 1.97 to read on Node.js, 2.24 to 2.28 and 1.11 to 1.13 in Chrome, 1.73 to 1.93 and 1.38 to 1.39 on SpiderMonkey, and 3.16 to 3.45 and 1.74 to 2.89 on JavaScriptCore; filling the `Map` took 0.37 to 0.39 ms, 0.25 ms, 0.24 to 0.27 ms and 0.12 to 0.14 ms, and reading it back 0.117, 0.098, 0.114 to 0.117 and 0.037 to 0.052 ms ✅[^lab-cross].
- **Third run:** The third run (2026-11-28, evening, quiet machine, under a load average of 1.7 to 2.9 at the start of the runs) gave the array at 2.79 to 3.05 times the `Map` to write and 1.89 to 1.99 to read on Node.js, 2.27 to 2.31 and 1.11 to 1.13 in Chrome, 1.70 to 1.96 and 1.36 to 1.41 on SpiderMonkey, and 3.19 to 3.51 and 1.82 to 2.93 on JavaScriptCore; filling the `Map` took 0.384 to 0.420 ms, 0.243 to 0.248 ms, 0.246 to 0.277 ms and 0.124 to 0.134 ms, and reading it back 0.114 to 0.120, 0.0972 to 0.0998, 0.114 to 0.121 and 0.0365 to 0.0512 ms ✅[^lab-cross].
**Exceptions:** Arrays that come back to fast elements once the gap is filled.
**Check it:** `node --allow-natives-syntax -p '%HasDictionaryElements(arr)'` after the writes.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.8 Dictionary (sparse) elements; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.8 `JE-N7`.

### `JE-N8` Loop over arrays with a numeric `for` (or `for…of` where the loop is not hot), never `for…in`
The better form is as clear, and `for…in` also visits inherited enumerable keys. `for…in` was 15.5 to 33 times slower than the numeric `for` on Node.js 24.22.1 and in Chrome 158 over the three runs: 21 to 33 times with the renderer not backgrounded and in default headless runs that reached the top compiler, 19.6 to 20.3 times in a visible window (third run, three runs), and 15.5 and 15.9 times in one default headless run each of the re-run and the third run that stayed below the top compiler; and 25 to 112 times (first run), 24 to 127 times (re-run) then 24.9 to 124 times (third run) on all three engines in the cross-engine lab ✅[^lab] ✅[^lab-matrix] ✅[^lab-cross].
**Seen in code as:** `for (const k in arr)` or `for (i in list)` over an array, typed array, `arguments` or `NodeList`; `parseInt(k)` or `Number(k)` in the body.
**Prefer:**
```js
for (let i = 0; i < arr.length; i++) s += arr[i]; // fastest on all three engines
for (const v of arr) s += v;   // fine on V8 and where the loop is not hot
```
**Avoid:**
```js
for (const k in arr) s += arr[k]; // k is the string "0", "1", …
```
**Why:** `for…in` enumerates property keys as strings instead of reading indexes ✅[^lab], and it also visits inherited enumerable properties ✅[^mdn-forin].
**Evidence:** The order held on V8 12.4, 14.1 and 15.0 in all three runs.
- **Baseline build, first run:** Summing 10,000 elements 1,000 times took 153.2 to 166.1 ms with `for…in`, 5.0 to 5.3 ms with numeric `for` and 5.9 to 6.8 ms with `for…of`, three runs: `for…in` about 30 times slower than the numeric `for` and 23 to 28 times slower than `for…of`; the key was the string `"0"` (Node.js 24.22.1, V8 13.6, arm64; first run, 2026-11-26; 29 to 33 times per run) ✅[^lab].
- **Baseline build, re-run:** The re-run (2026-11-28, after the restart; load not recorded, two runs taken while the machine was loaded left out) gave 155.1 to 157.0 ms with `for…in`, 4.8 to 5.8 ms with numeric `for` and 5.9 to 6.4 ms with `for…of` on the same build, three runs: 27 to 33 times the numeric `for` ✅[^lab].
- **Chrome 158:** `for…in` 21 to 22 times the numeric `for` (21 to 22 in default headless) in the first run (2026-11-27), 21 to 23 times in the re-run, where the numeric `for` took 7.1 to 7.2 ms and `for…in` 149.9 to 165.2 ms with the renderer not backgrounded; in default headless the re-run gave 22 and 23 times (7.1 ms against 157.4 and 162.8 ms) and 15.5 times in a third run (11.1 ms against 171.8 ms, with TurboFan off for the loops) ✅[^lab-matrix].
- **Baseline build, third run:** The third run (2026-11-28, evening, quiet machine, under a load average of 1.84 to 2.78 at the start of the runs) gave 153.5 to 155.6 ms with `for…in`, 5.1 to 5.2 ms with numeric `for` and 5.9 to 6.0 ms with `for…of`, three runs: 30 times the numeric `for` ✅[^lab].
- **Other builds and Chrome, third run:** `for…in` took 30 to 31 times the numeric `for` on Node.js 24.22.1 on macOS, 29 to 30 on V8 12.4, 35 on V8 14.1 and 22 to 23 on V8 15.0 (Electron 43); in Chrome 158 145.0 to 146.5 ms against 6.7 to 6.8 ms with the renderer not backgrounded (21.3 to 21.9 times), 21.4 and 21.0 times in two default headless runs and 15.9 times (166.9 against 10.5 ms) in one where no loop was TurboFan code; in a visible window 19.6 to 20.3 times in three runs ✅[^lab-matrix].
**Other engines:** Holds on all three engines for `for…in`: 24 to 127 times an index `for` over the three runs, the order of the three forms the same in all three ✅[^lab-cross]. So in a hot loop over a large array, in code that must be fast in every browser, the index `for` is the safe form.
- **Summing with for…in, SpiderMonkey and V8:** summing a 10⁵-element array with `for…in` took 25 to 27 times an index `for` on SpiderMonkey (Firefox 161), and on V8 in the same lab 55 to 56 (Node.js 24.22.1, macOS) and 31 (Chrome 158), in the first run (2026-11-28); the re-run (2026-11-28, after the restart) gave 24.4 to 24.7 on SpiderMonkey, 54.5 to 55.3 on Node.js and 30.8 to 30.9 in Chrome, and the third run (2026-11-28, evening, quiet machine, under a load average of 2.0 to 3.0 at the start of the runs) 24.9 to 25.3, 55.3 to 57.6 and 31.1 to 31.7 ✅[^lab-cross].
- **JavaScriptCore:** On JavaScriptCore (shell, Bun, WebKit page) it took 79 to 112 times in the first run (2026-11-28) and 80 to 127 times in the re-run (2026-11-28, after the restart): the WebKit page went from 108 to 112 times (for example 5.29 to 5.51 ms against 0.0484 to 0.0500 ms in one run) to 108 to 127 times (125 to 127 in its first three runs, for example 6.09 to 6.28 ms against 0.0486 to 0.0509 ms; 108 to 110 in the two repeats, at a load average of 3.9 to 4.1) ✅[^lab-cross].
- **JavaScriptCore, third run:** 78.5 to 124 times: the shell 78.5 to 84.2, Bun 81.7 to 83.0 and the WebKit page 109, 118 and 124 times (5.21 to 5.80 ms against 0.0466 to 0.0482 ms). The page's third-run ratios span the first run's and the re-run's at loads of 2.7 to 3.0, so a spread that wide came at a load below 3 too ✅[^lab-cross].
- **Measured times of the index loop:** The index `for` took 0.049 ms per sum on Node.js, 0.068 to 0.069 ms in Chrome and on SpiderMonkey, and 0.048 to 0.050 ms on JavaScriptCore ✅[^lab-cross]; in the third run 0.0483 to 0.0486 ms on Node.js, 0.0660 to 0.0679 ms in Chrome, 0.0672 to 0.0695 ms on SpiderMonkey and 0.0466 to 0.0498 ms on JavaScriptCore ✅[^lab-cross].
- **`for…of` was not as fast as the index `for` everywhere:** 3.92 to 3.97 times in Firefox, 2.43 to 2.45 in the JavaScriptCore shell, 1.20 to 1.26 in Bun and the WebKit page, 1.21 to 1.47 in Node.js and 0.96 in Chrome in the first run, and within 0.02 of those in the re-run, which started under a load average of 3.7 to 9.3 ✅[^lab-cross]; in the third run 3.94 to 4.28 times in Firefox, 2.37 to 2.47 in the JavaScriptCore shell, 1.21 to 1.24 in Node.js, Bun and the WebKit page and 0.96 in Chrome ✅[^lab-cross].
**Exceptions:** A plain object used as a record, where `for…in` lists its keys (or `Object.keys` ✅[^mdn-forin]).
**Check it:** `grep -n 'for (.* in ' src` and check the type of the right-hand side.
**Full lab:** [engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md), Catalog, class `for-in-over-array`; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.9 `JE-N8` and §5.3.

### `JE-N9` In Chrome and Electron code (V8 with pointer compression), integer fields from 2³⁰ up cost a heap-number box
Applies to V8 builds with pointer compression on: measured in Chrome 158, Electron 43 and 38, and a Node.js pointer-compression build. The values concerned reach 1,073,741,824 (2³⁰) or go below −1,073,741,824: Unix time in seconds, 32-bit hashes, large counters.
**Prefer:**
```js
// Arithmetic, not a measured fix: a typed array holds raw 32-bit values.
const stamps = new Uint32Array(n);   // Unix seconds fit until the year 2106
const hashes = new Int32Array(n);
```
**Avoid:**
```js
const rows = events.map((e) => ({ t: e.unixSeconds })); // measured in Chrome 158: 12 more bytes per object than a small integer
```
**Why:** With pointer compression a small integer has 31 bits instead of 32 ✅[^v8-internal] ✅[^v8-ptrcomp], so 2³⁰ to 2³¹ − 1 (and −2³¹ to −2³⁰ − 1) need a heap-number box there, while official Node.js builds keep them as small integers ✅[^lab-matrix].
**Evidence:** `%IsSmi(2 ** 30)` was `true` on Node.js 22.23.4, 24.22.1 and 25.7.0 and on Deno 2.9.8, `false` in Chrome 158 (in a page: `%IsSmi(2 ** 30 - 1)` `true`, −2³⁰ a small integer, −2³⁰ − 1 not), on Electron 43.7.7 (V8 15.0), Electron 38.8.6 (V8 14.0) and the Node.js 24.22.3 pointer-compression build (V8 13.6, sandbox off), which differs from the official build only in compression.
- **Bytes:** `{ x: 2 ** 31 }` took 12 bytes more than `{ x: i }` on that build and in Chrome 158 (byte counts, not timings). A 32-bit hash between 2³⁰ and 2³¹ − 1 came back as a heap number even with `| 0` or `Math.imul` in Chrome 158, on Electron 43 and on that build ✅[^lab-matrix].
- **Arithmetic, not measured:** Unix time passed 2³⁰ on 10 January 2004 and reaches 2³¹ − 1 on 19 January 2038, so today's values (about 1.8 billion) are in the range.
- **Not measured:** any array of such values on a pointer-compression build, and the speed or memory gain of `Int32Array` or `Uint32Array` for them (`Int32Array` measured 4.0 bytes per element on Node.js, the pointer-compression build and Chrome 158 ✅[^lab-matrix]; no `Uint32Array` run).
**Other engines:** The step belongs to V8 builds with pointer compression; JavaScriptCore and SpiderMonkey showed none. JavaScriptCore (shell, Bun) showed no step at 2³⁰: an array element took 8.0 bytes and a `{ x }` object with its array slot 40.0 bytes for a small integer, an integer just below 2³¹ and a double alike, while Chrome 158 in the same lab had the step (array elements 4.0 bytes below 2³⁰ against 8.0 just below 2³¹; `{ x }` 20.0 against 32.0) ✅[^lab-cross]. The SpiderMonkey shell showed none either: 8.4 bytes per array element and 48.9 per `{ x }` object with its slot, whether the value was a small integer, just below 2³⁰ or 2³¹, or a double, measured once, in the re-run (2026-11-28, after the restart) ✅[^lab-sm]. Not measured in the Firefox page or in the WebKit page: a page has no heap figure ✅[^lab-cross].
**Exceptions:** Values that stay below 2³⁰; a few thousand values. What the compiler does with such values is in [functions-and-optimization.md](functions-and-optimization.md).
**Check it:** In Chrome, a page started with `--js-flags=--allow-natives-syntax` and `%IsSmi(2 ** 30)` (`false` means 31-bit). In Node.js, `node -p process.config.variables.v8_enable_pointer_compression` (`1` on), or `--allow-natives-syntax` with `%IsSmi(2 ** 30)`; for Electron, `ELECTRON_RUN_AS_NODE=1 <electron binary> --allow-natives-syntax -p '%IsSmi(2 ** 30)'`.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.1 Tagged values and §6.3 Other builds and versions; [engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md), Lookup notes, `type-unstable-site`; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.10 bytes per element.

### `JE-N10` Memory is measured on the build that ships: on V8, pointer compression halves pointer-heavy data but not doubles
**Seen in code as:** a cache size, a memory budget or a "bytes per entry" figure measured on Node.js and applied to browser or Electron code (or the reverse), or a small-integer array swapped for `Int32Array` "to save memory" in browser code.
**Prefer:** measuring on the target build; in Chrome and Electron, objects, small-integer arrays, `Map` and `Set` take about half the Node.js figure, and double arrays, typed arrays and strings the same ✅[^lab-matrix].
**Avoid:** halving a Node.js estimate for `Float64Array` or double data, or converting small-integer arrays to `Int32Array` in Chrome or Electron for memory: both are 4.0 bytes per element there ✅[^lab-matrix].
**Why:** With pointer compression every tagged slot is 4 bytes instead of 8 ✅[^v8-ptrcomp], and a heap number 12 bytes instead of 16; raw data is not tagged ✅[^lab-matrix].
**Evidence:** Bytes per element (byte counts, not timings), official Node.js 24.22.1 against the Node.js 24.22.3 pointer-compression build (same V8 13.6, same emulated x64 machine): small-integer array 8.0 → 4.0, `push` onto `[]` 10.4 → 5.2, `{ x, y }` with its slot 48.0 → 24.0, dictionary object 63.0 → 31.5, `Map` entry 36.7 → 18.4, `Set` entry 26.2 → 13.1, double-only array 8.0 → 8.0, `Float64Array` / `Int32Array` 8.0 / 4.0 unchanged, string characters 1.0 / 2.0 unchanged. Chrome 158 gave the pointer-compression build's figure in every row; Electron 43 matched it within 0.1 byte ✅[^lab-matrix]. The V8 team reported the V8 heap up to 43 % smaller in Chrome browsing tests (2020) ✅[^v8-ptrcomp]; no whole Node.js application was measured in the lab.
**Other engines:** V8's halving does not carry over. A byte figure from one engine does not size memory on another: measure on each.
- **JavaScriptCore, V8 in Node.js and Chrome:** on JavaScriptCore (shell, Bun) a small-integer array took 8.0 bytes per element, `{ x }` with its slot 40.0, an object used as a table 38.1 per entry, and a `Map` entry 68.2 (Bun) or 84.0 bytes (shell; 125.9 in one run) at 10⁵ entries, a figure that varied with the count (in the re-run's size check the shell read 125.8 bytes in two of three runs at 10⁵ entries and 83.9 in one), against 8.0, 40.0, 62.9 and 36.8 on V8 in Node.js 24.22.1 (macOS) and 4.0, 20.0, 31.5 and 18.4 in Chrome 158 ✅[^lab-cross].
- **In the SpiderMonkey shell** an array element took 8.4 bytes, `{ x }` with its slot 48.9, an object used as a table 27.3 per entry, a `Map` entry with integer key and value 52.7 and with a string key 84.7 to 84.8, and `Int32Array` 4.0, measured once, in the re-run (2026-11-28, after the restart) ✅[^lab-sm]: no halving there either.
- **Not measured in the Firefox page or in the WebKit page**: a page has no heap figure ✅[^lab-cross].
- **Re-run size check:** In the re-run one of five size-check runs on Node.js read 57.0 bytes per `Map` entry at 25,000 entries, against 36.7 to 36.9 at every size otherwise ✅[^lab-cross].
**Exceptions:** None found for the byte counts. The speed effect of compression itself was not isolated: the pointer-compression Node.js build ran only under emulation, and Chrome differs from Node.js in V8 version too.
**Check it:** In Chrome, `performance.memory.usedJSHeapSize` after `gc()` (Chrome started with `--enable-precise-memory-info --js-flags=--expose-gc`) before and after building n entries; in Chrome 158 that counter also included typed-array contents ✅[^lab-matrix]. In Node.js, `node -p process.config.variables.v8_enable_pointer_compression`, then the bytes check of `JE-N1`.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.1 Tagged values ("What pointer compression gives") and §4.1 Bytes per element; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.10 bytes per element.

### `JE-N11` With pointer compression, plan for at most about 4 GB of V8 heap per process
Applies to V8 builds with pointer compression (Chrome, Electron, Node.js builds with it); official Node.js builds are not capped this way. The heap limits of JavaScriptCore and SpiderMonkey were not measured.
**Prefer:**
```js
// Browser: read the real cap (Chrome only; not a standard API)
console.log(Math.round(performance.memory.jsHeapSizeLimit / 2 ** 20), 'MiB');
// Node.js or Electron: require('node:v8').getHeapStatistics().heap_size_limit
```
**Avoid:** relying on `--max-old-space-size=8192` or higher in Chrome, in Electron or on a pointer-compression Node.js build.
**Why:** Pointer compression keeps the whole V8 heap in one reserved 4 GB block of addresses, so the heap cannot pass 4 GB whatever the flag says ✅[^v8-ptrcomp] ✅[^electron-cage]; `--max-old-space-size` sets only the maximum size of the old generation ✅[^node-cli]. Node.js's own build option says pointer compression "limits max heap to 4GB" ✅[^node-configure].
**Evidence:** Chrome 158, in a page: `performance.memory.jsHeapSizeLimit` was 4,192 MiB by default and still 4,192 MiB with `--js-flags=--max-old-space-size=8192`. With `--max-old-space-size=8192` and `16384` on a 16 GiB macOS host, `heap_size_limit` followed the flag on the official Node.js 24.22.1 and 25.7.0 builds (8,384 and 16,576 MiB) and stayed at 4,192 MiB on Electron 43.7.7 (V8 15.0) and 4,096 MiB on Electron 38.8.6 (V8 14.0); both Electron builds also have the V8 sandbox on, so those runs alone do not name the cause. The separating run, on the same emulated linux x64 machine with `--max-old-space-size=8192`: the Node.js 24.22.3 pointer-compression build (V8 13.6, sandbox off) gave 4,095.75 MiB against 8,384 MiB for the official Node.js 24.22.1 build, so compression is the cause ✅[^lab-matrix].
**Exceptions:** Node.js 25.1.0 lists initial enablement of isolate groups ✅[^node-v2510] (an isolate is one V8 heap, as in a worker thread), and V8's design document gives each isolate group its own 4 GB cage ✅[^v8-ptrcomp-design], so a pointer-compression build may give each worker thread its own 4 GB. That is an inference from those two pages: no run in the lab tested it. Official Node.js builds have compression off ✅[^lab-matrix].
**Check it:** In Chrome, `performance.memory.jsHeapSizeLimit` (about 4,192 MiB means capped). In Node.js, `node -p process.config.variables.v8_enable_pointer_compression` (`0` official, `1` compression on); then `node --max-old-space-size=8192 -p "require('node:v8').getHeapStatistics().heap_size_limit / 2 ** 20"` on the target binary (for Electron with `ELECTRON_RUN_AS_NODE=1`): about 4,096 means capped.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.1 Tagged values ("What pointer compression costs" and "How it works: Heap limit"); [memory and startup deep dive](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.7 Heap limits and how the flags add up, and §6.4.

## Takeaways
- Fractional values in bulk belong in double-only arrays or `Float64Array`s: 8 bytes each, against a boxed field on V8 ✅[^lab]. [rule-candidate]
- Number fields start as numbers (`0`, or `NaN` for "not yet"); `null` or `''` widens the field for every object of the shape ✅[^v8-react].
- `0.0` is already a small integer ✅[^lab], and a holey label with no real holes made no useful difference on any engine ✅[^lab-cross]: neither is a reason to rewrite code.
- `for…in` over an array was the slowest loop on every engine; the index `for` was the fastest everywhere ✅[^lab-cross]. [rule-candidate]
- Chrome and Electron are V8 with pointer compression: half the bytes for pointer-heavy data, boxes for integers from 2³⁰, a heap cap near 4 GB ✅[^lab-matrix]; JavaScriptCore and SpiderMonkey showed none of these steps ✅[^lab-cross] ✅[^lab-sm].

## Verification status
- Verified: 172 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab: Node.js 24.22.1 (V8 13.6.233.17-node.58), image `node:24.22.1-alpine`, linux arm64, pointer compression off, Apple M2 under Docker, `--network none`, 2026-11-26; scripts, commands and outputs in [the object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §3, §4 and §6, and in [the engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md), Catalog; re-run on 2026-11-28 after a restart of the lab machine, from the scripts in those docs (their Verification status), and the timing scripts run a third time that evening on a quiet machine. Rank 1 (primary measurement). Backs: Summary, Scope, Catalog, Lookup notes, Takeaways. [^lab]
- Lab matrix: the same scripts re-run on 2026-11-27 on Node.js 24.22.1 (macOS arm64; linux x64 emulated), Node.js 22.23.4 (V8 12.4.254.21), Node.js 25.7.0 (V8 14.1.146.11), Electron 43.7.7 as Node (V8 15.0.245.31, pointer compression and sandbox on), the Node.js 24.22.3 pointer-compression build (V8 13.6.233.17-node.63, sandbox off, linux x64 emulated), Deno 2.9.8 (V8 15.0.245.2), Electron 38.8.6 as Node (V8 14.0.365.10) and Google Chrome 158.0.8127.89 (V8 15.8.62.31, macOS arm64, headless page); outputs in §3.1 and §6.3 of [the object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md) and §3.7 and §6.4 of [the memory and startup deep dive](../../js-runtime/v8-memory-and-startup-deep-dive.md); re-run on 2026-11-28 after a restart of the lab machine, and the timing scripts run a third time that evening on a quiet machine (Verification status of those docs and of [the engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md)). Rank 1 (primary measurement). Backs: Summary, Scope, Catalog, Lookup notes, Takeaways. [^lab-matrix]
- Lab cross-engine: engine-neutral scripts run three times each on 2026-11-28 on one Apple M2 with macOS 26.1: V8 in Node.js 24.22.1 (macOS arm64) and Google Chrome 158.0.8127.89 (a visible window), SpiderMonkey in Firefox 161.0 (headless), JavaScriptCore in the `jsc` shell of the macOS 26.1 framework (21622.2.11.11.9), Bun 1.4.5 and a Playwright WebKit build 2311 page, first in the night before a restart of the lab machine and again after it, then the timing scripts a third time that evening on a quiet machine; scripts and outputs in §4.6 to §4.10 of [the cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md). Rank 1 (primary measurement). Backs: Summary, Scope, Catalog, Lookup notes (Other engines), Takeaways. [^lab-cross]
- Lab SpiderMonkey shell: `jsshell-linux-aarch64.zip` of Firefox 161.0 from Mozilla's archive (`js --version` `JavaScript-C161.0`), run in `ubuntu:24.04` (linux arm64 container, no network) on the same Apple M2, 2026-11-28, after the restart (no first run); the bytes-per-element script ran three times; script and output in §4.34 of [the cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md). Rank 1 (primary measurement). Backs: Scope, Catalog, Lookup notes (Other engines). [^lab-sm]
- [Field Representations and Elements Kinds](https://github.com/v8/v8/blob/main/docs/objects/fields-and-elements.md) — V8 project docs, living, read 2026-11-26. Rank 1. Backs: Scope, terms; Lookup notes, `JE-N1`, `JE-N2` (representation lattice, generalization of the tree, boxed double fields). [^v8-fields]
- [V8 source: src/objects/js-objects.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/js-objects.h) — V8 project, 2025. Rank 1. Backs: Lookup notes, `JE-N7` (maximum gap 1024). [^v8-jsobjects]
- [V8 source: src/objects/js-array.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/js-array.h) — V8 project, 2025. Rank 1. Backs: Scope, terms; Lookup notes, `JE-N7` (slow elements are a hash table, maximum fast array length). [^v8-jsarray]
- [V8 source: include/v8-internal.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/include/v8-internal.h) — V8 project, 2025. Rank 1. Backs: Lookup notes, `JE-N9` (31-bit and 32-bit small integers). [^v8-internal]
- [V8 design document: Pointer compression](https://chromium.googlesource.com/v8/v8.git/+/main/docs/heap/pointer-compression.md) — V8 project, main, read 2026-11-27. Rank 1. Backs: Scope, terms; Lookup notes, `JE-N11` (one cage per isolate group). [^v8-ptrcomp-design]
- [Node.js source: configure.py](https://github.com/nodejs/node/blob/main/configure.py) — Node.js project, main and v24.x, read 2026-11-27. Rank 1. Backs: Lookup notes, `JE-N11` (the build option's help text). [^node-configure]
- [Node.js v25.1.0 release notes](https://nodejs.org/en/blog/release/v25.1.0) — Node.js project, 2025-10-28, read 2026-11-27. Rank 1. Backs: Lookup notes, `JE-N11` (initial enablement of IsolateGroups). [^node-v2510]
- [Command-line API](https://nodejs.org/docs/latest-v24.x/api/cli.html) — Node.js, v24.22.3 docs. Rank 1. Backs: Lookup notes, `JE-N11` (`--max-old-space-size`). [^node-cli]
- [for...in](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...in) — MDN, living. Rank 3. Backs: Lookup notes, `JE-N8`. [^mdn-forin]
- [Pointer compression in V8](https://v8.dev/blog/pointer-compression) — V8 team (Igor Sheludko, Santiago Aboy Solanes), 2020-03-30. Rank 4. Backs: Scope, terms; Lookup notes, `JE-N9` to `JE-N11` (small-integer width, 4 GB range, 43 %). [^v8-ptrcomp]
- [The story of a V8 performance cliff in React](https://v8.dev/blog/react-cliff) — V8 team (Benedikt Meurer, Mathias Bynens), 2019-08-28. Rank 4. Backs: Catalog, `JE-N2`; Lookup notes, `JE-N2`, `JE-N3`; Takeaways. [^v8-react]
- [Elements kinds in V8](https://v8.dev/blog/elements-kinds) — V8 team (Mathias Bynens), 2017-09-12, updated 2025-02-28. Rank 4. Backs: Scope, terms; Lookup notes, `JE-N4` to `JE-N6`. [^v8-elements]
- [Electron and the V8 Memory Cage](https://www.electronjs.org/blog/v8-memory-cage) — Electron project (nornagon), 2022-06-30. Rank 4. Backs: Lookup notes, `JE-N11` (4 GB heap cap). [^electron-cage]

## Related
- [objects-and-shapes.md](objects-and-shapes.md) — shapes, `delete` and dictionary mode (`JE-O1` to `JE-O7`).
- [strings-and-collections.md](strings-and-collections.md) — `Map`, `Set`, typed arrays and their memory counters (`JE-S1` to `JE-S9`).
- [functions-and-optimization.md](functions-and-optimization.md) — one value type per site and the compiler side (`JE-F` rules).
- [measuring-performance.md](measuring-performance.md) — comparing builds with the same pointer compression (`JE-M12`).
- [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md) — heap limits and `process.memoryUsage()` fields (`JN-H` rules).
- [../../js-runtime/v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) — small integers, heap numbers, elements kinds and pointer compression, with every script.
- [../../js-runtime/v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) — heap limits and how the flags add up.
- [../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) — the same rules on SpiderMonkey and JavaScriptCore.
- [../../performance/code-review/problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md) — the review catalog with `for-in-over-array` and `type-unstable-site`.
