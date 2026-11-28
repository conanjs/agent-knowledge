---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24.22.1 (V8 13.6.233.17, linux arm64, pointer compression off), lab of 2026-11-26", "re-run 2026-11-27 on Node.js 22.23.4, 25.7.0, a Node.js 24.22.3 pointer-compression build, Electron 43.7.7 and 38.8.6, Deno 2.9.8 and Google Chrome 158.0.8127.89 (V8 12.4 to 15.8)", "cross-engine checks 2026-11-28 on Firefox 161 (SpiderMonkey) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, a WebKit page)", "TypeScript 5.9.3 (emit lab) and 6.0.3 (enum emit, 2026-10-28)", "Node.js 24.22 private-field timings of 2026-10-25"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, typescript, array-methods, sort, errors, spread, private-fields, enums, barrel-files]
derived-from: [js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: language-level patterns

## Summary
**TL;DR:** Twelve practices for costs that can be counted from JavaScript or TypeScript source on any engine: array chains and full passes, sort keys, error stacks, spread calls, collections rebuilt in loops, the TypeScript `target`, and three TypeScript choices (`#` fields, enums, barrel files). The counts that matter most: a `filter → map → reduce` chain over 1,000,000 elements built 2 throwaway arrays and grew the heap by 20 MB per run while one loop built none ✅[^lab], and `filter(p)[0]` called its predicate 100,000 times where `find(p)` stopped after 11, on every engine checked ✅[^lab-cross]. Three popular rewrites gain nothing: iterator helpers to save memory ✅[^lab], avoiding `#` fields ✅[^lab-private], and choosing `enum` or not for speed ✅[^lab-enum].
**Use this when:** you write or review JavaScript or TypeScript that runs per element of a large input, per comparison or per request; you review a `tsconfig.json`; someone proposes a rewrite "for performance" that this catalog lists as no gain.
**Not this doc:** `await`, floating promises and cancellation → [async-and-promises.md](async-and-promises.md); what keeps memory alive → [memory-and-garbage-collection.md](memory-and-garbage-collection.md); object shapes, arrays and V8 compiler behaviour → [objects-and-shapes.md](objects-and-shapes.md) and [functions-and-optimization.md](functions-and-optimization.md); the measured mechanisms and scripts → [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md) and [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md).

## Scope
The catalog covers twelve practices, `JL-L1` to `JL-L12`. The counts come from Node.js 24.22.1 (V8 13.6.233.17, Linux on arm64, pointer compression off) on 2026-11-26 ✅[^lab], re-run on 2026-11-27 on Node.js 22.23.4 (V8 12.4), 25.7.0 (V8 14.1), Electron 43.7.7 (V8 15.0), macOS on arm64, emulated x64, a Node.js 24.22.3 x64 build with pointer compression, and Google Chrome 158.0.8127.89 (V8 15.8.62.31, headless, the scripts in a page) ✅[^lab-matrix]. V8 is the JavaScript engine of Chrome and Node.js; SpiderMonkey is Firefox's engine; JavaScriptCore is the engine of WebKit, Safari and Bun ✅[^jsc]. `JL-L1` to `JL-L8` and `JL-L10` were also checked on 2026-11-28 on SpiderMonkey (Firefox 161, a page) and JavaScriptCore (the `jsc` shell of macOS 26.1, Bun 1.4.5, a WebKit build's page), beside V8 in Node.js 24.22.1 and Chrome 158 ✅[^lab-cross]; those notes have an **Other engines** line. Every other claim holds for V8 only. Safari itself was not run, and `JL-L9`, `JL-L11` and `JL-L12` were not checked on other engines. Symbols: n = elements, i = index of the first match, k = methods in a chain.

How to read the **Applies** column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it).

| Term | Plain meaning | Everyday comparison |
|---|---|---|
| Intermediate array | An array built by one step of a chain only to feed the next step | A bowl of chopped onions emptied into the pot at once |
| Iterator helper | A lazy method on iterators (ECMAScript 2025) that yields one value at a time | A conveyor belt rather than a stack of trays |
| Comparator | The function `sort` calls to order two elements | A judge asked to compare two contestants, many times per contestant |
| Stack trace capture | Recording the active call frames when an error object is created | Photographing the queue behind you each time you sign a form |
| Pointer compression | V8 storing heap pointers in 32 bits instead of 64, so many objects take about half the bytes | Writing house numbers with four digits instead of eight |
| Downleveling, emit helper | TypeScript rewriting newer syntax into older JavaScript, with small helper functions added to the output | Translating a modern novel into old English, with a phrasebook stapled to each page |
| Type stripping | Node.js running a `.ts` file by deleting its types, without transforming any syntax | Blacking out the margin notes of a letter, never rewriting a sentence |
| Barrel | A file, usually `index.ts`, that only re-exports other files | A receptionist who phones the whole building for every visitor |

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JL-L1` | `.filter().map()`, `.map().filter().reduce()`, `Array.from(x).map()`, `[...map.values()].filter()` over a large array; `.map()` with the result unused | One loop that filters and transforms in one pass; `for…of` when no array is needed | large data | n = 1,000,000 on Node.js 24.22.1: the chain made 2 arrays and grew the heap by 20 MB per run, one loop 0 and 0 MB ✅[^lab]; 10 MB and 0 MB with pointer compression on ✅[^lab-matrix] |
| `JL-L2` | A rewrite of an array chain into `arr.values().filter().map()` iterator helpers to save memory | Keep the chain (cold path) or one loop (hot path); iterator helpers only for iterators, infinite or early-stopped sources | no gain | Iterator helpers grew the heap by 80 MB per run against 20 MB for the chain on Node.js 24.22.1 ✅[^lab]; 40 against 10 MB with pointer compression on ✅[^lab-matrix] |
| `JL-L3` | `filter(p)[0]`, `filter(p).length > 0` (or `=== 0`), `filter(p).length === arr.length`, `map(f).includes(x)`, `str.match(/re/g)` used as a boolean | `find`, `some`, `every`, `includes`, or `re.test(str)` with no `g` flag | always | First match at index 10 of 100,000: 100,000 predicate calls for `filter`, 11 for `find` and `some`, on Node.js 24.22.1 ✅[^lab] and on all three engines ✅[^lab-cross] |
| `JL-L4` | A `sort` or `toSorted` comparator that derives keys (`toLowerCase`, `localeCompare`, `new Date`, `parseFloat`, `JSON.stringify`, a regex, `map.get`) | Compute keys once (map to `{ k, r }`, sort, map back); one shared `Intl.Collator` | large data | n = 10,000 on Node.js 24.22.1: 119,955 comparator calls and 239,910 key computations, against 10,000 with keys computed once ✅[^lab] |
| `JL-L5` | `new Error()` just to read `.stack`, errors for routine outcomes, `Error.stackTraceLimit = Infinity` | Capture a stack only when it is used; return a value for routine outcomes; keep the limit at its default; never assume `err.stack` is a string | hot path | At call depth 200 on Node.js 24.22.1: 10 frames captured with the default limit, 205 with `Infinity`, 0 with 0 ✅[^lab] |
| `JL-L6` | `Math.max(...arr)`, `Math.min(...arr)`, `push(...items)`, `fn.apply(null, arr)`, `String.fromCharCode(...codes)` where the array size comes from data | A loop or `reduce` for min and max; push in chunks (for example 32,768) | check build | Both spread calls worked at 120,000 elements and threw `RangeError` at 200,000 on Node.js 24.22.1 ✅[^lab]; on Node.js 22.23.4 they threw at 120,000 ✅[^lab-matrix] |
| `JL-L7` | `find`, `includes` or `indexOf` on array B inside a loop or `map` over array A | Build a `Map` or `Set` from B once before the loop | large data | Each array search compares from index 0 ✅[^ecma-array]; at n = 4,000, `includes` in a loop was 11 to 95 times slower than a `Set` built once, on all three engines ✅[^lab-cross] |
| `JL-L8` | `{ ...acc }`, `[...acc, x]` or `concat` in a `reduce` or loop; `Object.keys(o).length`, `slice`, `join` inside a loop | Mutate one local accumulator; use a `Map` and its `size`; compute whole-collection values once | large data | Spreading the accumulator in `reduce` is O(n²) ✅[^biome-spread]; at n = 4,000 it was 620 to 1,960 times slower than `push` on all three engines ✅[^lab-cross] |
| `JL-L9` | `tsconfig.json` `target` es5 to es2017 or `downlevelIteration` for Node.js 24 or evergreen browsers | Set `target` to the oldest runtime really used (es2022 or later); `importHelpers` with `tslib` if an old target is required | always | TypeScript 5.9.3, one module: 73 lines and 7 helpers at ES2015, 20 lines and none at ES2022; 2,000 helper calls for 1,000 `#` increments at ES2015, none at ES2022 ✅[^lab] |
| `JL-L10` | Advice to replace `#field` with a public or `private` field because `#` is slow | Keep `#` on an ES2022+ target: same speed on V8 and SpiderMonkey, at most 1.16 times on JavaScriptCore; real run-time privacy | no gain | 2×10⁸ reads: 126 ms public and 126 ms `#` on Node.js 24.22 ✅[^lab-private]; 0.86 to 1.16 times across the three engines ✅[^lab-cross] |
| `JL-L11` | `enum` replaced or kept "for performance"; a new `enum` in code run by Node.js type stripping | Do not decide on speed; use an `as const` object (owned codes) or a literal union; no new `enum` | no gain | TypeScript 6.0.3 emit: `enum` 387 bytes, `as const` object 228, literal union 77, each object created once at load ✅[^lab-enum]; type stripping rejects `enum` ✅[^node-ts] |
| `JL-L12` | A re-export-only `index.ts` barrel, imported from inside the same application | Import the file that declares the symbol; keep a barrel only as a published package's entry | always | No lab run; one reported case: about 75% fewer CI (continuous integration) build minutes per commit after removing barrels ✅[^barrel-case] |

## Lookup notes
### `JL-L1` Replace a chain of array methods over a large array with one loop
**Prefer:**
```js
let s = 0;
for (let i = 0; i < orders.length; i++) { const o = orders[i]; if (isPaid(o)) s += o.total; }
```
**Avoid:**
```js
const s = orders.filter(isPaid).map((o) => o.total).reduce((a, b) => a + b, 0);
items.map(send);   // result discarded: use for…of or forEach
```
**Why:** `map` creates a new array, and calling it without using the result is an anti-pattern ✅[^mdn-map]; `filter` calls its callback once per element and builds a new array ✅[^mdn-filter]. So every step but the last allocates up to n elements that die at once.
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64), n = 1,000,000 small integers, run with `--expose-gc --max-semi-space-size=256 --min-semi-space-size=256` so that no collection runs inside a measurement: `filter → map → reduce` created 2 arrays and grew the heap by 20 MB per run; one indexed loop created 0 and grew it by 0 MB (bytes, the same in all 5 runs) ✅[^lab]. The same on Node.js 22.23.4 and 25.7.0. With pointer compression on (Electron 43.7.7, V8 15.0, and the Node.js 24.22.3 pointer-compression build) the growth was 10 MB and 0 MB, with the same arrays made, so pointer compression is the cause; Chrome 158 (V8 15.8, page variant read with `performance.memory.usedJSHeapSize`, the same flags through `--js-flags`) also gave 10 MB and 0 MB ✅[^lab-matrix].
**Other engines:** holds on all three engines, with different sizes (time, n = 10⁶ small integers, three runs): one loop was 22.9 to 24.7 times faster than the chain on Node.js 24.22.1 and 25.9 to 27.1 times in Chrome 158; 4.11 to 5.35 times in SpiderMonkey (Firefox 161); 2.65 to 2.74, 2.86 to 3.04 and 2.40 to 2.56 times on JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page) ✅[^lab-cross]. Bytes were not measured off V8.
**Exceptions:** n is small or the chain runs once; the intermediate array is needed anyway (returned or reused); readability wins on a cold path.
**Check it:** run `node --expose-gc --max-semi-space-size=256 --min-semi-space-size=256`; call `gc()`, read `process.memoryUsage().heapUsed`, run the code once, read it again with no `gc()` in between; do it at n and 2n. Growth should double before the fix and stay near 0 after. With default flags a scavenge (a young-generation collection) can run inside the measurement and the growth reads lower. In Chrome: `--enable-precise-memory-info --js-flags="--expose-gc --max-semi-space-size=256 --min-semi-space-size=256"` and `performance.memory.usedJSHeapSize` in place of `heapUsed`.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Catalog class `chained-array-passes`, Lookup notes script `chain.mjs` and "Other builds and versions (2026-11-27)"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.21.

### `JL-L2` Switching an in-memory array chain to iterator helpers does not save memory
**Keep writing:** the plain chain on a cold path, or one loop (`JL-L1`) on a hot one. Iterator helpers fit when the source is an iterator, is infinite, or is cut short by `take` or `find`.
**Why:** iterator helpers are lazy and produce the next value only when requested ✅[^mdn-itermap], so they build no array, but each step still allocates per element. MDN says the iterator's own `reduce` "may be more efficient, especially memory-wise" ✅[^mdn-iter]; that did not hold for total bytes in the lab ✅[^lab].
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64), n = 1,000,000: iterator helpers created 0 arrays but grew the heap by 80 MB per run, against 20 MB for the chain (bytes, the same in all 5 runs) ✅[^lab]. With pointer compression on (Electron 43.7.7; the Node.js 24.22.3 pointer-compression build) and in Chrome 158 (V8 15.8, page variant): 40 MB against 10 MB, still four times ✅[^lab-matrix]. The lab measured total bytes allocated, not the peak of live memory.
**Other engines:** time only; the bytes this practice is about were not measured off V8. Iterator helpers over the array were the slowest form on every engine: 35.5 to 38.1 times one loop on Node.js 24.22.1, 50.0 to 54.0 in Chrome 158, 15.6 to 16.3 in SpiderMonkey (Firefox 161), 12.3 to 13.0 on JavaScriptCore (macOS 26.1 shell 12.6 to 12.7, Bun 1.4.5 12.4 to 12.8, WebKit page 12.3 to 13.0; one slow run of eleven on Bun took 47 times and one on the WebKit page 44 times), and 1.5 to 5.2 times the chain (n = 10⁶, three runs) ✅[^lab-cross].
**Exceptions:** an infinite or lazily produced source; a chain stopped early by `take`, `find` or `some`.
**Check it:** the heap-growth measurement of `JL-L1` (same flags) on both forms.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes "Not a problem when", "Corrections found while checking the sources (2026-11-26)" and "Other builds and versions (2026-11-27)"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.21.

### `JL-L3` Stop at the first match: `find`, `some`, `every`, `includes`, `re.test`
**Prefer:**
```js
const admin = users.find(isAdmin);
const any = users.some(isAdmin);
const hasError = /error/.test(text);       // no g flag
```
**Avoid:**
```js
const admin = users.filter(isAdmin)[0];
const any = users.filter(isAdmin).length > 0;
const hasError = text.match(/error/g) !== null;
```
**Why:** `filter` calls its callback for every element and builds an array ✅[^mdn-filter]; `find` returns the first matching element and stops ✅[^mdn-find]. `match` with `g` returns all matches in an array, and MDN points to `test` for "does it match" ✅[^mdn-match].
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64), n = 100,000 with the first match at index 10: 100,000 predicate calls for `filter`, 11 for `find` and `some`; `match(/error/g)` on a text with 50,000 occurrences built an array of 50,000 (counts) ✅[^lab]. The same on all builds of the re-run and in Chrome 158 (V8 15.8) ✅[^lab-matrix].
**Other engines:** holds on all three engines: 100,000 predicate calls for `filter(p)[0]` and 11 for `find(p)` in SpiderMonkey (Firefox 161) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page), as on V8 (counts, every run) ✅[^lab-cross]; the specification fixes these counts: `find` returns at the first true result and `filter` visits every index ✅[^tc39arr].
**Exceptions:** every match is needed later in the same function (keep the `filter` result and test its length once). A regex with `g` reused with `test` is a correctness bug: `test` advances `lastIndex` and the next call resumes from it, even on another string ✅[^mdn-test].
**Check it:** a counter in the predicate on an input whose first match is early: expect i + 1 calls.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Catalog class `full-pass-for-first`, Lookup notes script `first.mjs`; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.22.

### `JL-L4` Compute a sort key once per element, not inside the comparator
**Prefer:**
```js
const coll = new Intl.Collator('en');   // one collator for all comparisons
const sorted = rows.map((r) => ({ k: r.name.toLowerCase(), r }))
  .sort((x, y) => coll.compare(x.k, y.k)).map((x) => x.r);
```
**Avoid:**
```js
rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
```
**Why:** each comparator call computes 2 keys, and the comparator can be called many times per element ✅[^mdn-sort]; for a comparison sort that is about n · log₂ n calls (arithmetic: 10,000 · log₂ 10,000 ≈ 132,877, near the measured 119,955). MDN's remedy is to extract the values once into a temporary array, sort it, then map back ✅[^mdn-sort]; MDN also advises one `Intl.Collator` for many comparisons ✅[^mdn-localecompare].
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64), n = 10,000 seeded rows: 119,955 comparator calls and 239,910 key computations, against 10,000 key computations with keys computed once, same order (counts) ✅[^lab]. The same on V8 12.4 to 14.1 and on the Node.js 24.22.3 pointer-compression build; V8 15.0 (Electron 43.7.7, Deno 2.9.8) and Chrome 158 (V8 15.8) made 119,784 calls and 239,568 computations on the same rows, same order: the count comes with the V8 version, not with pointer compression ✅[^lab-matrix]. Keys computed once gave 10,000 everywhere, so the practice holds on every build.
**Other engines:** holds on all three engines: on the same 10,000 rows the comparator ran 126,592 times in SpiderMonkey (Firefox 161) and 120,378, 120,691 and 120,691 times on JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page) (counts, the same in every run), 119,784 to 126,592 across all engines ✅[^lab-cross]; the specification leaves the sequence of comparator calls to each engine ✅[^tc39arr]. So a key derived in the comparator is computed 24 to 26 times per element on every engine, against 1 when computed once (that count follows from the code).
**Exceptions:** the key is a plain property read (`a.price - b.price`); n is small; two extra arrays of n are too much memory for the input.
**Check it:** a counter in the key function on n = 10,000: expect n after the fix, and the same order.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Catalog class `sort-key-recompute`, Lookup notes script `sortkey.mjs` and "Other builds and versions (2026-11-27)"; [problem-classes.md](../../performance/code-review/problem-classes.md), class `hot-path-constants`; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.23.

### `JL-L5` Error objects stay off routine paths, and `Error.stackTraceLimit` stays at its default
**Prefer:**
```js
if (log.isDebugEnabled()) log.debug('slow call', { where: new Error().stack });
return { ok: false, reason: 'invalid-email' };   // routine outcome: a value
```
**Avoid:**
```js
Error.stackTraceLimit = Infinity;
function caller() { return new Error().stack.split('\n')[2]; }   // per call
```
**Why:** in Node.js 24, `error.stack` represents the point where `new Error()` was called, and `Error.stackTraceLimit` defaults to 10 frames ✅[^node-errors]; V8 chose 10 so as not to have a noticeable performance impact, and formats a trace only when `stack` is first read ✅[^v8-stack]. Routine conditions are better handled without exceptions ✅[^dotnet-exceptions].
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64) at call depth 200: 10 frames captured with the default, 205 with `Infinity`, 0 with 0 (counts) ✅[^lab]. The same on all builds of the re-run; Chrome 158 (V8 15.8) gave 10, 202 and 0, because the page has one frame below the 201 recursion frames and Node.js four (its module loader) ✅[^lab-matrix]. No source gives a cost per frame, so no timing on V8 alone is claimed.
**Other engines:** holds on all three engines: 1,000 errors made 20 calls deep with `.stack` read cost 26 to 64 times as much as 1,000 plain objects (2 to 7 µs, microseconds, per error): 64 times on Node.js 24.22.1, 26 in Chrome 158, 34 in SpiderMonkey (Firefox 161), 39, 42 and 58 times on JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page) ✅[^lab-cross]. The default limit differs (10 on V8 and in Bun, 128 in Firefox, 100 in the JavaScriptCore shell and the WebKit page) and is honoured differently: Firefox gave at most 128 frames for any higher limit, the macOS 26.1 shell kept the first limit it was given, and with the limit at 0 JavaScriptCore set `stack` to `undefined`, so `err.stack.split(…)` throws there ✅[^lab-cross].
**Exceptions:** the error is rare and its stack is used (logged, reported); a debugging session that needs more frames. Reading `err.stack` in a service started with `--enable-source-maps` is `JN-E8` in [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md).
**Check it:** `grep -rn "stackTraceLimit\|captureStackTrace\|new Error()" src/`; in a CPU profile, time under error construction on the hot path.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Catalog class `stack-capture-per-call`, Lookup notes script `stack.mjs`; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.24.

### `JL-L6` An array of data-dependent size is not spread into a call
**Prefer:**
```js
let max = -Infinity;
for (const x of arr) if (x > max) max = x;
for (let i = 0; i < items.length; i += 32_768) target.push(...items.slice(i, i + 32_768));
```
**Avoid:**
```js
const max = Math.max(...arr);   // arr from a query or a file
target.push(...items);
```
**Why:** each element becomes one argument; long argument lists risk exceeding the engine's argument length limit, whose consequences are unspecified and vary across engines ✅[^mdn-apply]; spread and `apply` either fail or return the wrong result for too many elements, and `reduce` does not have this problem ✅[^mdn-max].
**Evidence:** with each build's default stack, on Node.js 24.22.1 (V8 13.6, arm64) both `Math.max(...arr)` and `[].push(...arr)` worked at 120,000 elements and threw `RangeError: Maximum call stack size exceeded` at 200,000 ✅[^lab]; the same on Node.js 25.7.0, Electron 43.7.7, Chrome 158 (V8 15.8, in a page), macOS, emulated x64 and the Node.js 24.22.3 pointer-compression build, while on Node.js 22.23.4 (V8 12.4) both threw at 120,000 and worked at 100,000 ✅[^lab-matrix]. No page gives the limit as a number, and a bisection did not give one stable value ✅[^lab]. The often-quoted 65,536 is JavaScriptCore's, and MDN's chunk example uses 32,768 ✅[^mdn-apply].
**Other engines:** an engine-specific number; the practice holds on all three engines. The largest array `Math.max(...arr)` accepted from a top-level call was 124,545 on Node.js 24.22.1 (124,547 for `fn.apply(null, arr)`; 123,681 to 124,547 over the V8 builds), 123,681 to 123,683 in Chrome 158, 524,287 in SpiderMonkey (Firefox 161; 500,000 for `fn.apply(null, arr)`) and 638,454 to 638,728 on JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page); past it every engine threw a `RangeError`, and V8's limit was the lowest (counts; call depth and stack size not varied) ✅[^lab-cross].
**Exceptions:** the size is fixed and small by construction (a tuple, a few config values).
**Check it:** call the code with the largest input the data allows on the runtime in use; the limit also depends on how deep the call already is.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes "Belongs to an existing class" (`unbounded-input`), script `spreadargs.mjs`, "Corrections" and "Other builds and versions (2026-11-27)"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.25.

### `JL-L7` A `Map` or `Set` built once replaces an array search inside a loop
**Prefer:**
```js
const byId = new Map(customers.map((c) => [c.id, c]));
const rows = orders.map((o) => ({ ...o, customer: byId.get(o.customerId) }));
```
**Avoid:**
```js
const rows = orders.map((o) => ({ ...o, customer: customers.find((c) => c.id === o.customerId) }));
```
**Why:** each array search compares elements in ascending order from index 0 ✅[^ecma-array], so every outer element pays up to m comparisons (O(n · m)); maps and sets give sublinear average access ✅[^ecma-map], so the work becomes O(n + m).
**Evidence:** sourced from the ECMAScript specification; the V8 baseline lab has no build-specific number for it. The first timing is the cross-engine check below.
**Other engines:** holds on all three engines, V8 included: `includes` on an n-element array inside a loop over n queries grew 3.64 to 4.12 times when n doubled from 2,000 to 4,000, against about 2 for a linear cost, and at n = 4,000 was 11 to 95 times slower than a `Set` built once, on Node.js 24.22.1, Chrome 158, SpiderMonkey (Firefox 161) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page) (time, six runs) ✅[^lab-cross]. The growth is the algorithm's.
**Exceptions:** the inner collection is small and fixed (weekdays, a few config entries); duplicate keys where the first match must win (build the `Map` so the first entry is kept).
**Check it:** time the code at n and 2n: after the fix the time should roughly double, not quadruple; the output should be identical.
**Full lab:** [problem-classes.md](../../performance/code-review/problem-classes.md), class `lookup-in-loop` and Lookup notes "Sizes decide"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.26.

### `JL-L8` A whole collection is not rebuilt inside a loop or `reduce`
**Prefer:**
```js
const byId = {};
for (const r of rows) byId[r.id] = r;        // or a Map
const size = map.size;                       // a Map keeps its size
```
**Avoid:**
```js
const byId = rows.reduce((acc, r) => ({ ...acc, [r.id]: r }), {});
for (const k of keys) if (Object.keys(cache).length > max) evict();
```
**Why:** spreading the accumulator in `reduce` copies it on every step, which is O(n²) ✅[^biome-spread]; `slice`, `concat` and `join` loop over all elements each time they are called ✅[^ecma-array]; MDN calls counting an object's items through `Object.keys` less efficient than a `Map`'s `size` ✅[^mdn-mapobj].
**Evidence:** sourced (the Biome rule `noAccumulatingSpread`, the ECMAScript specification, MDN's `Map` page); the V8 baseline lab has no number for it. The first timing is the cross-engine check below.
**Other engines:** holds on all three engines, V8 included: a `reduce` returning `[...acc, x]` grew 3.24 to 4.74 times when n doubled from 2,000 to 4,000 and at n = 4,000 was 620 to 1,960 times slower than `push`, on Node.js 24.22.1, Chrome 158, SpiderMonkey (Firefox 161) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page) (time, six runs) ✅[^lab-cross]. The growth is the algorithm's.
**Exceptions:** small, bounded collections; a copy that is really needed (the old version is kept).
**Check it:** heap used and time at n and 2n: after the fix both should roughly double, not quadruple.
**Full lab:** [problem-classes.md](../../performance/code-review/problem-classes.md), classes `allocation-gc` and `linear-call-in-loop`; [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes "Belongs to an existing class"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.26.

### `JL-L9` The TypeScript `target` matches the oldest runtime the code really runs on
**Prefer:**
```json
{ "compilerOptions": { "target": "es2022" } }
```
**Avoid:**
```json
{ "compilerOptions": { "target": "es2015", "downlevelIteration": true } }
```
**Why:** `target` changes which features are downleveled ✅[^ts-target], and by default helpers are inserted into every file that uses them ✅[^ts-helpers]. When compiling to ES2021 or lower, TypeScript replaces `#` fields with `WeakMap`s ✅[^ts-classes], so each read or write becomes a helper call. With `downlevelIteration` in ES5 output, `for…of` goes through a `__values` helper ✅[^ts-downlevel].
**Evidence:** TypeScript 5.9.3, output run on Node.js 24.22.1 (V8 13.6, arm64): one module emitted 73 lines and 7 helpers at ES2015, 20 lines and none at ES2022; 1,000 increments of a `#` field made 2,000 helper calls at ES2015 and none at ES2022 (counts) ✅[^lab]; the same on all builds of the re-run and in Chrome 158 (V8 15.8), where a page ran the emitted output prepared beforehand ✅[^lab-matrix]. Not a cost: the ES2015 `__awaiter` output took the same 1,001 microtask turns for 1,000 awaits as native `async` ✅[^lab]. TypeScript 6.0 deprecates `target: es5` and `downlevelIteration`, and options deprecated in 6.0 are removed in 7.0 ✅[^ts-60].
**Exceptions:** the code really runs on an old engine (then add `importHelpers` with `tslib`, so each helper exists once ✅[^ts-helpers]); a bundler or another compiler sets the final syntax level.
**Check it:** `grep -c "__awaiter\|__generator\|__classPrivateField" dist/**/*.js`: expect 0 at a native target.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Catalog class `ts-downlevel-emit`, Lookup notes script `ts.mjs` and "Corrections found while checking the sources (2026-11-26)".

### `JL-L10` `#` private fields on an ES2022+ target cost nothing extra; avoiding them gains nothing
**Keep writing:**
```ts
class User { readonly #passwordHash: string; constructor(h: string) { this.#passwordHash = h; } }
```
**Why:** TypeScript `private` is enforced only during type checking, so at run time the field is an ordinary property; `#` fields stay private after compilation ✅[^ts-classes]. Private elements cannot be enumerated or reached through `Object` methods ✅[^mdn-private], so `JSON.stringify` and spread do not see them. V8 9.7 moved class-field initialization, private fields included, onto its inline-cache fast path ✅[^v8-classfeat].
**Evidence:** timings of 2026-10-25 on Node.js 24.22 (V8 13.6), target ES2023 (native `#`), each case in its own process after a warm-up run, three runs each; no CPU, operating system or exact patch version is recorded, so read them as a ratio: 2×10⁸ reads through a method 126 ms public, 126 ms `#`; 3×10⁷ constructions (two fields) 166 to 172 ms public, 168 to 180 ms `#`, within run-to-run noise ✅[^lab-private]. A first attempt with both cases in one process showed `#` 3 times slower: an ordering effect of warm-up, not the field type ✅[^lab-private]. These timings are not from the baseline lab builds.
**Other engines:** no gain on all three engines: 10⁶ reads of `this.#v` against `this.v` in a method took 0.88 to 1.02 times as long on Node.js 24.22.1 and 0.86 to 1.03 in Chrome 158 (`#` up to 14% faster in a few runs), 0.97 to 1.02 in SpiderMonkey (Firefox 161) and 1.00 to 1.16 times on JavaScriptCore (macOS 26.1 shell 1.04 to 1.16, Bun 1.4.5 1.04 to 1.08, WebKit page 1.00 to 1.16; about 0.05 ms per 10⁶ reads), in one process with the rounds interleaved and each class with its own method (time, three runs) ✅[^lab-cross].
**Exceptions:** target ES2021 or lower (then `#` becomes `WeakMap` lookups, `JL-L9`); a constructor parameter property for an injected collaborator, which cannot be a `#` field (TypeScript reports error TS18009; recorded in the concept doc linked below, not re-run here); objects reached through a `Proxy`, which `#` access does not pass through ✅[^mdn-private].
**Check it:** time each variant in its own process (`node bench-public.mjs`, then `node bench-private.mjs`), never both in one process.
**Full lab:** [private-fields.md](../../js-runtime/private-fields.md), sections How it works and Worked example; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.27.

### `JL-L11` `enum`, `as const` and literal unions are not a speed choice; `enum` is avoided because it is not erasable
**Keep writing:**
```ts
export const DocumentError = { NotFound: 'not-found', Conflict: 'version-conflict' } as const;
export type DocumentError = (typeof DocumentError)[keyof typeof DocumentError];
export type Order = 'asc' | 'desc';   // fixed vocabulary: a literal union
```
**Why:** the reason to drop `enum` is not speed. TypeScript 5.8's `--erasableSyntaxOnly` reports enums, because Node.js type stripping can only delete types, not transform syntax ✅[^ts58]; Node.js strips types by default since 22.18.0 and 23.6.0 and lists `enum` as syntax that needs transformation and therefore errors ✅[^node-ts]. The TypeScript handbook offers an `as const` object as the alternative ✅[^ts-enums]; it keeps one place to change a value the project owns ✅[^lab-enum].
**Evidence:** TypeScript 6.0.3 to CommonJS for a three-member set, 2026-10-28: `enum` 387 bytes, `as const` object 228 bytes, literal union 77 bytes (only the module header); each object is created once at load, so the per-request cost is the same ✅[^lab-enum].
**Exceptions:** an `enum` shipped by a dependency is already compiled JavaScript and works ✅[^lab-enum].
**Check it:** `node file.ts` with type stripping fails at start-up on an `enum` ✅[^node-ts]; a lint selector `no-restricted-syntax` with `TSEnumDeclaration` reports new ones ✅[^lab-enum]. Writing TypeScript that Node.js runs directly (erasable syntax only) is `JN-U9` in [nodejs-startup.md](nodejs-startup.md).
**Full lab:** [enums-and-literal-unions.md](../../js-runtime/enums-and-literal-unions.md), How it works items 4 to 6 and Trade-offs.

### `JL-L12` In application code, imports name the file that declares a symbol, not a barrel `index.ts`
**Prefer:**
```ts
import { GetDocument } from '@/modules/documents/application/GetDocument.js';
```
**Avoid:**
```ts
import { GetDocument } from '@/modules/documents/index.js';   // loads every file the barrel lists
```
**Why:** a tool that follows imports must load every module a barrel re-exports before the importer can use one name, and a 2023 analysis names barrels a main reason JavaScript tooling slows down in large projects ✅[^barrel-debacle]. A barrel also invites import cycles when a listed file imports it back (an inference from the import graph, not a sourced or measured claim).
**Evidence:** no lab run. One software company's engineering team reported about 75% fewer CI (continuous integration) build minutes per commit, local unit tests about 50% faster on average and TypeScript highlighting more than 30% faster after removing barrels from a large frontend codebase, and names large dependency graphs that made the compiler, the test runner and test selection process modules they did not need ✅[^barrel-case]. Structural count: a barrel listing three files makes a test that needs one class load all three files and everything they import; the direct import loads one file and its own imports. Tree shaking (dropping unused exports from a production bundle) runs after loading, so dev servers, tests and type checks still pay the load cost (how bundlers work, not stated on the cited analysis, so unmarked); the bundle side is in [browser-loading-and-delivery.md](browser-loading-and-delivery.md).
**Exceptions:** the one public entry of a published package, which Node.js's `exports` field in `package.json` names ✅[^node-exports]; that is an API for outside consumers. `export type { X } from` only: a lower load cost, but still a second hand-kept list of what is public. The costs of the direct import are longer import paths, and a moved public file changes its importers (an unmeasured trade-off that follows from how paths work, listed in the concept doc linked below; no source).
**Check it:** a lint rule that fails on `ExportAllDeclaration` and `ExportNamedDeclaration` with a `source` in `src/`; compare test start time before and after.
**Full lab:** none; the argument and the reported case are in [barrel-files.md](../../js-runtime/barrel-files.md), How it works and Edge cases.

## Takeaways
- In a chain of array methods over a large input, each step before the last is an array of up to n elements built to be thrown away; one loop builds none ✅[^lab]. [rule-candidate]
- A question of "is there one?" or "which is first?" stops at the first match with `find`, `some` or `test`; the counts are the same on every engine ✅[^lab-cross].
- A key derived inside a comparator is computed about 24 times per element at n = 10,000; computing it once is the fix ✅[^lab].
- Spread calls fail at a size that differs by engine and V8 version, from 120,000 elements on V8 12.4 ✅[^lab-matrix] to about 638,000 on JavaScriptCore ✅[^lab-cross]; an array whose size comes from data is never spread.
- Iterator helpers over an array ✅[^lab], avoiding `#` fields ✅[^lab-private] and choosing `enum` for speed ✅[^lab-enum] are rewrites with no measured gain.

## Verification status
- Verified: 111 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab: the scripts of the JavaScript language catalog run in `node:24.22.1-alpine` (Node.js v24.22.1, V8 13.6.233.17-node.58, linux arm64, pointer compression off, Apple M2 under Docker), TypeScript 5.9.3 for the TypeScript script, on 2026-11-26; scripts and output in [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes. Rank 1 (primary measurement). Backs: Summary, Catalog, Lookup notes, Takeaways. [^lab]
- Lab matrix: the same scripts re-run on 2026-11-27 on Node.js 24.22.1 (macOS 26.1 arm64; linux x64 emulated), Node.js 22.23.4 (V8 12.4.254.21), Node.js 25.7.0 (V8 14.1.146.11), Electron 43.7.7 run as Node (V8 15.0.245.31, pointer compression on), the Node.js 24.22.3 pointer-compression build (V8 13.6, linux x64 emulated), Google Chrome 158.0.8127.89 (V8 15.8.62.31, headless page, macOS arm64), and for the sort counts Deno 2.9.8 (V8 15.0.245.2) and Electron 38.8.6 (V8 14.0.365.10); table and differing output in [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes, "Other builds and versions (2026-11-27)". Rank 1 (primary measurement). Backs: Scope, Catalog, Lookup notes. [^lab-matrix]
- Lab cross-engine: the engine-neutral checks of 2026-11-28 on one Apple M2: V8 in Node.js 24.22.1 (macOS arm64) and Google Chrome 158.0.8127.89, SpiderMonkey in Firefox 161.0 (headless), JavaScriptCore in the `jsc` shell of macOS 26.1 (framework 21622.2.11.11.9), Bun 1.4.5 (linux arm64 container) and the Playwright WebKit build 2311; each check script run three times per environment; scripts and outputs in [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.21 to §4.27. Rank 1 (primary measurement). Backs: Summary, Scope, Catalog, Lookup notes, Takeaways. [^lab-cross]
- Lab private fields: timings measured on 2026-10-25 on Node.js 24.22 (V8 13.6), target ES2023, each case in its own process after a warm-up, three runs; no CPU or operating system recorded; table in [private-fields.md](../../js-runtime/private-fields.md), Worked example. Rank 1 (primary measurement). Backs: Catalog `JL-L10`; Lookup notes `JL-L10`. [^lab-private]
- Lab enums: TypeScript 6.0.3 emit to CommonJS for a three-member set, the lint selector and a dependency's compiled `enum`, tested on 2026-10-28 on a sample TypeScript service; in [enums-and-literal-unions.md](../../js-runtime/enums-and-literal-unions.md), How it works items 6 and 10 and Edge cases. Rank 1 (primary measurement). Backs: Catalog `JL-L11`; Lookup notes `JL-L11`. [^lab-enum]
- [ECMAScript Language Specification, §23.1.3 Properties of the Array Prototype Object](https://tc39.es/ecma262/multipage/indexed-collections.html) — Ecma TC39, living draft. Rank 1. Backs: Lookup notes `JL-L3`, `JL-L4`. [^tc39arr]
- [ECMA-262, Array.prototype methods (includes, indexOf, find, slice, concat, join)](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.includes) — Ecma TC39, living. Rank 1. Backs: Catalog `JL-L7`; Lookup notes `JL-L7`, `JL-L8`. [^ecma-array]
- [ECMA-262, Map objects](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-map-objects) — Ecma TC39, living. Rank 1. Backs: Lookup notes `JL-L7`. [^ecma-map]
- [JavaScriptCore](https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html) — WebKit project documentation, living. Rank 1. Backs: Scope (JavaScriptCore is WebKit's engine). [^jsc]
- [Stack trace API](https://v8.dev/docs/stack-trace-api) — V8, living. Rank 1. Backs: Lookup notes `JL-L5`. [^v8-stack]
- [Errors: Error.stackTraceLimit and new Error()](https://nodejs.org/docs/latest-v24.x/api/errors.html) — Node.js, v24.22.3 docs. Rank 1. Backs: Lookup notes `JL-L5`. [^node-errors]
- [Best practices for exceptions](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) — Microsoft, .NET, living. Rank 1. Backs: Lookup notes `JL-L5`. [^dotnet-exceptions]
- [noAccumulatingSpread](https://biomejs.dev/linter/rules/no-accumulating-spread/) — Biome, living. Rank 1. Backs: Catalog `JL-L8`; Lookup notes `JL-L8`. [^biome-spread]
- [TSConfig Reference: target](https://www.typescriptlang.org/tsconfig/target.html) — TypeScript, living. Rank 1. Backs: Lookup notes `JL-L9`. [^ts-target]
- [TSConfig Reference: importHelpers](https://www.typescriptlang.org/tsconfig/importHelpers.html) — TypeScript, living. Rank 1. Backs: Lookup notes `JL-L9`. [^ts-helpers]
- [TSConfig Reference: downlevelIteration](https://www.typescriptlang.org/tsconfig/downlevelIteration.html) — TypeScript, living. Rank 1. Backs: Lookup notes `JL-L9`. [^ts-downlevel]
- [TypeScript 6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) — TypeScript, 6.0. Rank 1. Backs: Lookup notes `JL-L9`. [^ts-60]
- [TypeScript Handbook: Classes, member visibility caveats](https://www.typescriptlang.org/docs/handbook/2/classes.html) — TypeScript team, living. Rank 1. Backs: Lookup notes `JL-L9`, `JL-L10`. [^ts-classes]
- [TypeScript Handbook: Enums](https://www.typescriptlang.org/docs/handbook/enums.html) — TypeScript team, living. Rank 1. Backs: Lookup notes `JL-L11`. [^ts-enums]
- [Announcing TypeScript 5.8: `--erasableSyntaxOnly`](https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/) — Microsoft (the TypeScript team's release post), 2025. Rank 1. Backs: Lookup notes `JL-L11`. [^ts58]
- [Modules: TypeScript](https://nodejs.org/api/typescript.html) — Node.js project, living. Rank 1. Backs: Catalog `JL-L11`; Lookup notes `JL-L11`. [^node-ts]
- [Node.js Packages: `exports`](https://nodejs.org/api/packages.html#exports) — Node.js project, living. Rank 1. Backs: Lookup notes `JL-L12`. [^node-exports]
- [Array.prototype.map()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map) — MDN Web Docs (Mozilla Developer Network), modified 2026-10-26. Rank 3. Backs: Lookup notes `JL-L1`. [^mdn-map]
- [Array.prototype.filter()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter) — MDN, modified 2026-10-26. Rank 3. Backs: Lookup notes `JL-L1`, `JL-L3`. [^mdn-filter]
- [Iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator) — MDN, modified 2026-11-18. Rank 3. Backs: Lookup notes `JL-L2`. [^mdn-iter]
- [Iterator.prototype.map()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator/map) — MDN, modified 2026-10-26. Rank 3. Backs: Lookup notes `JL-L2`. [^mdn-itermap]
- [Array.prototype.find()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find) — MDN, modified 2026-10-26. Rank 3. Backs: Lookup notes `JL-L3`. [^mdn-find]
- [String.prototype.match()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match) — MDN, modified 2026-10-26. Rank 3. Backs: Lookup notes `JL-L3`. [^mdn-match]
- [RegExp.prototype.test()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/test) — MDN, modified 2026-10-26. Rank 3. Backs: Lookup notes `JL-L3`. [^mdn-test]
- [Array.prototype.sort()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort) — MDN, modified 2026-10-26. Rank 3. Backs: Lookup notes `JL-L4`. [^mdn-sort]
- [String.prototype.localeCompare](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare) — MDN Web Docs, living. Rank 3. Backs: Lookup notes `JL-L4`. [^mdn-localecompare]
- [Function.prototype.apply()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/apply) — MDN, modified 2025-07-10. Rank 3. Backs: Lookup notes `JL-L6`. [^mdn-apply]
- [Math.max()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/max) — MDN, modified 2025-07-20. Rank 3. Backs: Lookup notes `JL-L6`. [^mdn-max]
- [Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) — MDN, modified 2026-10-26. Rank 3. Backs: Lookup notes `JL-L8`. [^mdn-mapobj]
- [Private elements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_elements) — MDN, living. Rank 3. Backs: Lookup notes `JL-L10`. [^mdn-private]
- [Faster initialization of instances with new class features](https://v8.dev/blog/faster-class-features) — V8 team, 2022. Rank 4. Backs: Lookup notes `JL-L10`. [^v8-classfeat]
- [How We Achieved 75% Faster Builds by Removing Barrel Files](https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files) — a software company's engineering blog, 2025-06-26. Rank 4. Backs: Catalog `JL-L12`; Lookup notes `JL-L12`. [^barrel-case]
- [Speeding up the JavaScript ecosystem – The barrel file debacle](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/) — Marvin Hagemeister, personal blog, 2023. Rank 6. Backs: Lookup notes `JL-L12`. [^barrel-debacle]

## Related
- [async-and-promises.md](async-and-promises.md) — `await`, floating promises, cancellation (`JL-A`).
- [memory-and-garbage-collection.md](memory-and-garbage-collection.md) — what keeps memory alive (`JL-G`).
- [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md) — the review catalog with the scripts and outputs behind `JL-L1` to `JL-L6` and `JL-L9`.
- [problem-classes.md](../../performance/code-review/problem-classes.md) — the first catalog: `lookup-in-loop`, `allocation-gc`, `linear-call-in-loop`, `hot-path-constants`.
- [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) — the cross-engine checks.
- [private-fields.md](../../js-runtime/private-fields.md), [enums-and-literal-unions.md](../../js-runtime/enums-and-literal-unions.md), [barrel-files.md](../../js-runtime/barrel-files.md) — the concept docs behind `JL-L10` to `JL-L12`.
