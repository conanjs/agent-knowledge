---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24.22.1 (V8 13.6.233.17, linux arm64, pointer compression off), lab of 2026-11-26", "other builds 2026-11-27 on Node.js 22.23.4, 25.7.0, a Node.js 24.22.3 pointer-compression build, Electron 43.7.7 and 38.8.6, Deno 2.9.8 and Google Chrome 158.0.8127.89 (V8 12.4 to 15.8)", "cross-engine checks 2026-11-28 on Firefox 161 (SpiderMonkey) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, a WebKit page)", "TypeScript 5.9.3 (emit lab) and 6.0.3 (enum emit, 2026-10-28)", "Node.js 24.22 private-field timings of 2026-10-25", "re-run 2026-11-28 after a restart of the lab machine (language catalog and cross-engine checks)", "third run 2026-11-28, evening, quiet machine (cross-engine timing scripts)"]
last-verified: 2026-11-28
last-updated: 2026-11-29
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
The catalog covers twelve practices, `JL-L1` to `JL-L12`. The counts come from Node.js 24.22.1 (V8 13.6.233.17, Linux on arm64, pointer compression off) on 2026-11-26 ✅[^lab], run again on 2026-11-27 on Node.js 22.23.4 (V8 12.4), 25.7.0 (V8 14.1), Electron 43.7.7 (V8 15.0), macOS on arm64, emulated x64, a Node.js 24.22.3 x64 build with pointer compression, and Google Chrome 158.0.8127.89 (V8 15.8.62.31, headless, the scripts in a page) ✅[^lab-matrix]. V8 is the JavaScript engine of Chrome and Node.js; SpiderMonkey is Firefox's engine; JavaScriptCore is the engine of WebKit, Safari and Bun ✅[^jsc].
`JL-L1` to `JL-L8` and `JL-L10` were also checked on 2026-11-28 on SpiderMonkey (Firefox 161, a page) and JavaScriptCore (the `jsc` shell of macOS 26.1, Bun 1.4.5, a WebKit build's page), beside V8 in Node.js 24.22.1 and Chrome 158 ✅[^lab-cross]; those notes have an **Other engines** line. Every other claim holds for V8 only. Safari itself was not run, and `JL-L9`, `JL-L11` and `JL-L12` were not checked on other engines. Symbols: n = elements, i = index of the first match, k = methods in a chain.

**How the timings were taken.** The conclusions are the order of the forms and the ratio between them, which held in every run unless a note says otherwise; the absolute times are quoted as the machine printed them under that load and will differ on another machine or under another load.
- **Machine.** Every lab ran on one Apple M2 laptop with macOS 26.1; the Linux builds ran in containers in a virtual machine on it, and the x64 builds were emulated ✅[^lab] ✅[^lab-matrix].
- **Each lab was run twice; the timing scripts of the cross-engine checks a third time.**
  - The **first run**: the baseline on 2026-11-26 ✅[^lab], the other builds and the Chrome 158 page variants on 2026-11-27 ✅[^lab-matrix], and the cross-engine checks in the night to 2026-11-28, before the lab machine was restarted ✅[^lab-cross]; the runner did not yet check for a locked screen or keep one browser window at a time, so the conditions of that run are not fully known.
  - The **re-run** (2026-11-28, after the restart): every script was taken from the lab docs and run again with the screen unlocked, one browser window at a time and one timing run at a time, while other, untimed jobs ran on the machine; all 58 results of the language catalog matched ✅[^lab] and no verdict of the cross-engine checks changed ✅[^lab-cross].
  - The **third run** (2026-11-28, evening, quiet machine): the timing scripts of the cross-engine checks only, with the re-run's commands, three runs on each environment, one run at a time, each started only when the one-minute load average was below 3.0; the owner's desktop applications stayed open; every run completed ✅[^lab-cross]. It is the only run made under a controlled load, so where the runs differ its values are the ones to quote for a quiet machine, and the earlier values stay as the record of what load and uncontrolled conditions do.
- **Load:**
  - the language catalog's scripts print counts and bytes, not times, so no load applies to them;
  - for the cross-engine checks the one-minute load average was 2.1 to 13.8 at the start of the runs in the first run, and in the re-run 2.7 to 12.5 at the start of the runs of the timed notes and of `JL-L6` (`JL-L1` and `JL-L2` 2.7 to 6.4, `JL-L5` 2.9 to 4.4, `JL-L6` 3.5 to 3.8, `JL-L7` and `JL-L8` 3.3 to 6.0, `JL-L10` 3.8 to 12.5; the lab doc prints no load for `JL-L3` and `JL-L4`, which count calls), against 2.7 to 34.8 (median 5.0) over all checks of the later part of the cross-engine lab; each note gives its own range ✅[^lab-cross];
  - in the third run of the cross-engine checks the one-minute load average was 1.75 to 2.97 at the start of the runs of the later part of the cross-engine lab (median 2.61): `JL-L1` and `JL-L2` 1.88 to 2.97, `JL-L5` 1.96 to 2.94, `JL-L7` and `JL-L8` 1.77 to 2.95, `JL-L10` 1.75 to 2.95 ✅[^lab-cross];
  - the private-field timings of 2026-10-25 were taken once, load not recorded ✅[^lab-private].
- **Counts, bytes and ranges.** Counts and bytes were the same in both runs unless a note gives two values, and a timing range given with no run label held in both runs (the re-run's values fell inside it); the third run's values are always given with their label.

How to read the **Applies** column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it). Correct and clear code comes first: a practice here chooses between two equally clear forms, and justifies a less clear one only where its "Applies" condition holds. Where a Catalog row names an engine, the practice differs there; code that must be fast in every browser follows the row.

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
| `JL-L7` | `find`, `includes` or `indexOf` on array B inside a loop or `map` over array A | Build a `Map` or `Set` from B once before the loop | large data | Each array search compares from index 0 ✅[^ecma-array]; at n = 4,000, `includes` in a loop was 11 to 106 times slower than a `Set` built once (three runs: 11 to 95, 11 to 106, then 11 to 92), on all three engines ✅[^lab-cross] |
| `JL-L8` | `{ ...acc }`, `[...acc, x]` or `concat` in a `reduce` or loop; `Object.keys(o).length`, `slice`, `join` inside a loop | Mutate one local accumulator; use a `Map` and its `size`; compute whole-collection values once | large data | Spreading the accumulator in `reduce` is O(n²) ✅[^biome-spread]; at n = 4,000 it was 605 to 2,013 times slower than `push` (three runs) on all three engines ✅[^lab-cross] |
| `JL-L9` | `tsconfig.json` `target` es5 to es2017 or `downlevelIteration` for Node.js 24 or evergreen browsers | Set `target` to the oldest runtime really used (es2022 or later); `importHelpers` with `tslib` if an old target is required | always | TypeScript 5.9.3, one module: 73 lines and 7 helpers at ES2015, 20 lines and none at ES2022; 2,000 helper calls for 1,000 `#` increments at ES2015, none at ES2022 ✅[^lab] |
| `JL-L10` | Advice to replace `#field` with a public or `private` field because `#` is slow | Keep `#` on an ES2022+ target: same speed on V8 and SpiderMonkey (never more than 5% slower in the ratios of the fastest rounds; on V8 up to 14% faster in a few runs of the re-run), at most 1.16 times on JavaScriptCore; real run-time privacy | no gain | 2×10⁸ reads: 126 ms public and 126 ms `#` on Node.js 24.22 ✅[^lab-private]; 0.86 to 1.16 times across the three engines (three runs) ✅[^lab-cross] |
| `JL-L11` | `enum` replaced or kept "for performance"; a new `enum` in code run by Node.js type stripping | Do not decide on speed; use an `as const` object (owned codes) or a literal union; no new `enum` | no gain | TypeScript 6.0.3 emit: `enum` 387 bytes, `as const` object 228, literal union 77, each object created once at load ✅[^lab-enum]; type stripping rejects `enum` ✅[^node-ts] |
| `JL-L12` | A re-export-only `index.ts` barrel, imported from inside the same application | Import the file that declares the symbol; keep a barrel only as a published package's entry | always | No lab run; one reported case: about 75% fewer CI (continuous integration) build minutes per commit after removing barrels ✅[^barrel-case] |

## Lookup notes
### `JL-L1` Replace a chain of array methods over a large array with one loop
**Seen in code as:** `.filter(...).map(...)`, `.map(...).filter(...).reduce(...)`, `Array.from(iter).map(...)`, `[...map.values()].filter(...)`; or `.map(...)` whose result is unused.
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
**Why:** `map` creates a new array, and calling it without using the result is an anti-pattern ✅[^mdn-map]; `filter` calls its callback once per element and builds a new array ✅[^mdn-filter]. So every step but the last allocates up to n elements that die at once: a chain of k methods that each return an array builds up to k − 1 throwaway arrays of up to n elements, and the lab's chain made 2 at n = 1,000,000 ✅[^lab].
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64), n = 1,000,000 small integers, run with `--expose-gc --max-semi-space-size=256 --min-semi-space-size=256` so that no collection runs inside a measurement: `filter → map → reduce` created 2 arrays and grew the heap by 20 MB per run; one indexed loop created 0 and grew it by 0 MB (bytes, the same in all 5 runs) ✅[^lab]. The same on Node.js 22.23.4 and 25.7.0. With pointer compression on (Electron 43.7.7, V8 15.0, and the Node.js 24.22.3 pointer-compression build) the growth was 10 MB and 0 MB, with the same arrays made, so pointer compression is the cause; Chrome 158 (V8 15.8, page variant read with `performance.memory.usedJSHeapSize`, the same flags through `--js-flags`) also gave 10 MB and 0 MB ✅[^lab-matrix].
**Other engines:** holds on all three engines, with different sizes (time, n = 10⁶ small integers, three runs), in all three runs: one loop was 22.9 to 27.2 times faster than the chain on V8, 4.11 to 5.35 times on SpiderMonkey and 2.40 to 3.04 times on JavaScriptCore ✅[^lab-cross].
- **First run, one loop against the chain.** One loop was 22.9 to 24.7 times faster than the chain on Node.js 24.22.1 and 25.9 to 27.1 times in Chrome 158; 4.11 to 5.35 times in SpiderMonkey (Firefox 161); 2.65 to 2.74, 2.86 to 3.04 and 2.40 to 2.56 times on JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page) ✅[^lab-cross].
- **First run, the loop itself.** The loop itself took 0.58 to 0.67 ms per call on Node.js 24.22.1, 0.46 to 0.49 ms in Chrome 158, 1.04 to 1.14 ms in SpiderMonkey and 0.74 to 0.79 ms on JavaScriptCore ✅[^lab-cross]. These ranges come from the first run (2026-11-28).
- **Re-run** (2026-11-28, after the restart, under a load average of 2.7 to 6.4; ratios of the lowest times; three runs each, five on Bun and the WebKit page): the loop took 0.59 to 0.68 ms on Node.js 24.22.1, 0.46 to 0.49 in Chrome 158, 1.04 to 1.12 in SpiderMonkey and 0.74 ms on each JavaScriptCore environment, and one loop was 23.4 to 24.7 times faster than the chain on Node.js, 26.5 to 27.2 in Chrome, 4.24 to 4.46 in SpiderMonkey, 2.61 to 2.65 in the shell, 2.81 to 2.91 in Bun and 2.42 to 2.60 in the WebKit page ✅[^lab-cross].
- **Third run** (2026-11-28, evening, quiet machine, under a load average of 1.9 to 3.0; ratios of the lowest times; three runs each): the loop took 0.616 to 0.626 ms on Node.js 24.22.1, 0.455 to 0.461 in Chrome 158, 1.07 to 1.21 in SpiderMonkey, 0.746 to 0.825 in the shell, 0.748 to 0.772 in Bun and 0.722 to 0.725 in the WebKit page, and one loop was 24.68 to 25.08 times faster than the chain on Node.js, 26.68 to 27.03 in Chrome, 4.38 to 4.64 in SpiderMonkey, 2.75 to 3.03 in the shell, 2.84 to 2.94 in Bun and 2.44 to 2.53 in the WebKit page ✅[^lab-cross].
- **Over the first two runs.** Most values fell inside the first run's ranges; Bun's and the WebKit page's chain ratios and the top of Chrome's lay 0.04 to 0.06 outside them, so the order and the ratios held in both runs to within about 0.1 ✅[^lab-cross].
- **Over the three runs:** 22.9 to 25.1 times on Node.js, 25.9 to 27.2 in Chrome, 4.11 to 5.35 in SpiderMonkey, 2.61 to 3.03 in the shell, 2.81 to 3.04 in Bun and 2.40 to 2.60 in the WebKit page; the order was the same in every run ✅[^lab-cross].
- Bytes were not measured off V8.
**Exceptions:** n is small or the chain runs once; the intermediate array is needed anyway (returned or reused); readability wins on a cold path.
**Check it:** run `node --expose-gc --max-semi-space-size=256 --min-semi-space-size=256`; call `gc()`, read `process.memoryUsage().heapUsed`, run the code once, read it again with no `gc()` in between; do it at n and 2n. Growth should double before the fix and stay near 0 after. With default flags a scavenge (a young-generation collection) can run inside the measurement and the growth reads lower ✅[^spot].
- **Earlier check.** An earlier check, made when this practice was first written (before the restart of the lab machine; its output was not kept), printed 18, then 9 MB for the chain with default flags.
- **Run again** on 2026-11-28 (Node.js 24.22.1, linux arm64 container, three runs with each set of flags):
  - with the flags above the chain grew the heap by 20 MB in each of its 5 runs, one loop by 0 and iterator helpers by 80;
  - with default flags (only `--expose-gc`, which `gc()` needs) the chain grew it by 18, 9, 9, 9 and 9 MB, one loop by 0 and iterator helpers by 13, the same in all three runs ✅[^spot].
- **Both checks agree:** with default flags the chain reads 18, then 9 MB, not 20, so the semi-space flags are what make the growth readable.
- **A reviewer** ran the default-flag command eight more times on 2026-11-28 (same container): seven printed 18, 9, 9, 9, 9 for the chain and one printed 9, 9, 9, 9, 9, so the leading 18 is likely but not guaranteed; the loop (0) and the iterator helpers (13) were the same in the five runs that printed them ✅[^spot].
- **In Chrome:** `--enable-precise-memory-info --js-flags="--expose-gc --max-semi-space-size=256 --min-semi-space-size=256"` and `performance.memory.usedJSHeapSize` in place of `heapUsed`.
<details><summary>Spot check: <code>chain.mjs</code> with the semi-space flags and with default flags</summary>

The script is `chain.mjs` of the catalog, unchanged (Full lab below). Each command was run three times; the three outputs of each were the same:
```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --expose-gc --max-semi-space-size=256 --min-semi-space-size=256 chain.mjs
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --expose-gc chain.mjs
```
```text
# with --max-semi-space-size=256 --min-semi-space-size=256
chain       | arrays made per run: 2 | heap growth MB per run: 20 20 20 20 20 | result: 255435488
one loop    | arrays made per run: 0 | heap growth MB per run: 0 0 0 0 0 | result: 255435488
iter helper | arrays made per run: 0 | heap growth MB per run: 80 80 80 80 80 | result: 255435488
# default flags (only --expose-gc)
chain       | arrays made per run: 2 | heap growth MB per run: 18 9 9 9 9 | result: 255435488
one loop    | arrays made per run: 0 | heap growth MB per run: 0 0 0 0 0 | result: 255435488
iter helper | arrays made per run: 0 | heap growth MB per run: 13 13 13 13 13 | result: 255435488
```
</details>

**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Catalog class `chained-array-passes`, Lookup notes script `chain.mjs` and "Other builds and versions (2026-11-27)"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.21.

### `JL-L2` Switching an in-memory array chain to iterator helpers does not save memory
**Seen in code as:** a proposal to rewrite `arr.filter(p).map(f)` as `arr.values().filter(p).map(f).toArray()` (or `.reduce`) "to avoid intermediate arrays".
**Keep writing:** the plain chain on a cold path, or one loop (`JL-L1`) on a hot one. Iterator helpers fit when the source is an iterator, is infinite, or is cut short by `take` or `find`.
**Why:** iterator helpers are lazy and produce the next value only when requested ✅[^mdn-itermap], so they build no array, but each step still allocates per element. MDN says the iterator's own `reduce` "may be more efficient, especially memory-wise" ✅[^mdn-iter]; that did not hold for total bytes in the lab ✅[^lab].
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64), n = 1,000,000: iterator helpers created 0 arrays but grew the heap by 80 MB per run, against 20 MB for the chain (bytes, the same in all 5 runs) ✅[^lab]. With pointer compression on (Electron 43.7.7; the Node.js 24.22.3 pointer-compression build) and in Chrome 158 (V8 15.8, page variant): 40 MB against 10 MB, still four times ✅[^lab-matrix]. The lab measured total bytes allocated, not the peak of live memory.
**Other engines:** time only; the bytes this practice is about were not measured off V8. Iterator helpers over the array were the slowest form on every engine, in all three runs: 34.7 to 38.1 times one loop on Node.js, 50.0 to 54.0 in Chrome, 15.6 to 16.3 in SpiderMonkey and 11.7 to 13.1 on JavaScriptCore, apart from the slow runs: one of the WebKit page (first run) and two of Bun (the re-run and the third run) ✅[^lab-cross].
- **Against one loop and the chain.** 35.5 to 38.1 times one loop on Node.js 24.22.1, 50.0 to 54.0 in Chrome 158, 15.6 to 16.3 in SpiderMonkey (Firefox 161), 12.3 to 13.0 on JavaScriptCore (macOS 26.1 shell 12.6 to 12.7, Bun 1.4.5 12.6 to 12.8 in the first run and 12.4 to 12.8 over both runs, WebKit page 12.3 to 13.0 in the first run and 12.4 to 14.4 round by round in the re-run), and 1.5 to 5.2 times the chain (n = 10⁶, three runs); the loop they are compared with took 0.46 to 1.14 ms per call (`JL-L1`) ✅[^lab-cross].
- **Slow outliers.** Each run had one slow outlier: in the first run (2026-11-28) one WebKit-page run of six took 33 to 39 ms per call, 44 times the loop; in the re-run (2026-11-28, after the restart, under a load average of 2.7 to 6.4) one Bun run of five took 35 ms per call, 47 times the loop, and the WebKit page had none ✅[^lab-cross].
- **Re-run** ratios of the lowest times: 34.7 to 37.9 on Node.js (the first run gave 35.5 to 38.1), 50.5 to 53.4 in Chrome, 16.0 to 16.2 in SpiderMonkey, 12.6 to 12.7 in the shell, 12.5 to 12.7 in Bun without its slow run and 12.7 to 13.0 in the WebKit page ✅[^lab-cross].
- **Third run** (2026-11-28, evening, quiet machine, under a load average of 1.9 to 3.0; three runs each) ratios of the lowest times: 36.74 to 37.18 on Node.js, 51.19 to 51.87 in Chrome, 15.70 to 16.17 in SpiderMonkey, 11.70 to 12.72 in the shell, 12.53 to 12.71 in Bun without its slow run and 12.96 to 13.13 in the WebKit page; 1.5 to 5.3 times the chain ✅[^lab-cross].
- **Slow outlier of the third run.** Bun's run 2 (load average 2.93 at its start) took 36.3 to 38.4 ms per call, 47.58 times the loop; the WebKit page had none ✅[^lab-cross].
- **Over the first two runs:** one slow run of eleven on each of those two, and iterator helpers were the slowest form in every run ✅[^lab-cross].
- **Over the three runs:** Bun's slow mode came in two of fourteen Bun runs, the second at a load of 2.93 in the quiet third run, so load does not explain it; the WebKit page's in one of fourteen; iterator helpers were the slowest form in every run ✅[^lab-cross].
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
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64), n = 100,000 with the first match at index 10: 100,000 predicate calls for `filter`, 11 for `find` and `some`; `match(/error/g)` on a text with 50,000 occurrences built an array of 50,000 (counts) ✅[^lab]. The same on all seven builds of the 2026-11-27 matrix and in Chrome 158 (V8 15.8) ✅[^lab-matrix].
**Other engines:** holds on all three engines: 100,000 predicate calls for `filter(p)[0]` and 11 for `find(p)` in SpiderMonkey (Firefox 161) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page), as on V8 (counts, every run) ✅[^lab-cross]; the specification fixes these counts: `find` returns at the first true result and `filter` visits every index ✅[^tc39arr].
**Exceptions:** every match is needed later in the same function (keep the `filter` result and test its length once). A regex with `g` reused with `test` is a correctness bug: `test` advances `lastIndex` and the next call resumes from it, even on another string ✅[^mdn-test].
**Check it:** a counter in the predicate on an input whose first match is early: expect i + 1 calls.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Catalog class `full-pass-for-first`, Lookup notes script `first.mjs`; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.22.

### `JL-L4` Compute a sort key once per element, not inside the comparator
**Seen in code as:** a `sort` or `toSorted` comparator that derives its keys: `toLowerCase()`, `localeCompare` per call, `new Date(a.ts)`, `parseFloat`, `JSON.stringify`, a regex, `map.get(a.id)`.
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
**Seen in code as:** in code run per call or per request (loggers, tracers, validators, deprecation helpers): `new Error()` built only to read `.stack` for a file and line; `Error.captureStackTrace(this)` in objects created per request; an error object returned or thrown for an ordinary outcome (one `ValidationError` per bad row); `Error.stackTraceLimit = Infinity` at start-up.
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
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64) at call depth 200: 10 frames captured with the default, 205 with `Infinity`, 0 with 0 (counts) ✅[^lab]. The same on all seven builds of the 2026-11-27 matrix; Chrome 158 (V8 15.8) gave 10, 202 and 0, because the page has one frame below the 201 recursion frames and Node.js four (its module loader) ✅[^lab-matrix]. No source gives a cost per frame, so no timing on V8 alone is claimed.
**Other engines:** holds on all three engines: 1,000 errors made 20 calls deep with `.stack` read cost 26 to 64 times as much as 1,000 plain objects (2 to 7 µs, microseconds, per error), in all three runs ✅[^lab-cross].
- **First run.** 64 times on Node.js 24.22.1, 26 in Chrome 158, 34 in SpiderMonkey (Firefox 161), 39, 42 and 58 times on JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page) in the first run ✅[^lab-cross].
- **Ratios of the lowest times of the re-run,** runs 1, 2 and 3: 64.3, 63.5, 63.5 on Node.js; 25.9, 25.8, 26.5 in Chrome; 32.5, 33.6, 37.0 in SpiderMonkey; 39.0, 39.0, 39.7 in the shell; 41.9, 42.5, 42.3 in Bun; 56.9, 58.9, 57.8 in the WebKit page ✅[^lab-cross].
- **Measured times per 1,000, first run (2026-11-28):** errors 6,645 to 6,798 µs against 105 to 107 µs for plain objects on Node.js 24.22.1, 2,441 to 2,513 against 95 to 98 in Chrome 158, 3,519 to 3,951 against 104 to 113 in SpiderMonkey, and 2,091 to 2,210 against 54 to 56, 1,693 to 1,834 against 41 to 42 and 3,125 to 3,274 against 54 to 60 on JavaScriptCore (shell, Bun, WebKit page) ✅[^lab-cross].
- **Re-run** (2026-11-28, after the restart, under a load average of 2.9 to 4.4): 6,670 to 6,988 against 105 to 109 µs, 2,446 to 2,603 against 95 to 97, 3,423 to 5,995 against 105 to 139 (34 to 40 times in SpiderMonkey), and 2,107 to 2,293 against 54 to 60, 1,707 to 1,928 against 41 to 43 and 3,141 to 3,333 against 55 to 60 ✅[^lab-cross].
- **Third run** (2026-11-28, evening, quiet machine, under a load average of 1.96 to 2.94), ratios of the lowest times, runs 1, 2 and 3: 62.1, 63.8, 63.1 on Node.js; 25.6, 25.9, 25.9 in Chrome; 35.9, 35.2, 34.8 in SpiderMonkey; 39.5, 38.9, 39.2 in the shell; 42.4, 42.3, 42.7 in Bun; 56.4, 57.6, 57.2 in the WebKit page ✅[^lab-cross].
- **Measured times per 1,000, third run** (lowest to highest round over its three runs): 6,572 to 7,757 against 104 to 116 µs, 2,430 to 2,585 against 94 to 97, 3,577 to 4,260 against 103 to 146, and 2,084 to 2,918 against 53 to 64, 1,693 to 2,411 against 40 to 48 and 3,108 to 3,333 against 55 to 59 ✅[^lab-cross].
- **Over the first two runs** the ratios were 26 to 64 times, the same to within 2 on every environment but SpiderMonkey (34, then 32 to 37; one re-run run read 4,141 to 5,995 µs for the errors); the frame counts were the same in both runs ✅[^lab-cross].
- **Over the three runs:** the third run's ratios lay within 2 of the re-run's on every environment, SpiderMonkey's inside the re-run's 32 to 37; its single slow rounds for the errors (up to 7,757 µs on Node.js, 2,918 in the shell, 2,411 in Bun) came at loads under 3 too; the default limit and the frame counts of the first script were the same in its three runs ✅[^lab-cross].
- **Stack limit.** The default limit differs (10 on V8 and in Bun, 128 in Firefox, 100 in the JavaScriptCore shell and the WebKit page) and is honoured differently: Firefox gave at most 128 frames for any higher limit, the macOS 26.1 shell kept the first limit it was given, and with the limit at 0 JavaScriptCore set `stack` to `undefined`, so `err.stack.split(…)` throws there ✅[^lab-cross].
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
**Evidence:** with each build's default stack, on Node.js 24.22.1 (V8 13.6, arm64) both `Math.max(...arr)` and `[].push(...arr)` worked at 120,000 elements and threw `RangeError: Maximum call stack size exceeded` at 200,000 ✅[^lab]; the same on Node.js 25.7.0, Electron 43.7.7, Chrome 158 (V8 15.8, in a page), macOS, emulated x64 and the Node.js 24.22.3 pointer-compression build, while on Node.js 22.23.4 (V8 12.4) both threw at 120,000 and worked at 100,000 ✅[^lab-matrix]: 120,000 worked on V8 13.6, 14.1, 15.0 and 15.8 and threw on V8 12.4 ✅[^lab-matrix]. No page gives the limit as a number, and a bisection did not give one stable value ✅[^lab]. The often-quoted 65,536 is JavaScriptCore's, and MDN's chunk example uses 32,768 ✅[^mdn-apply]; the JavaScriptCore builds of **Other engines** accepted 638,454 to 638,728 (about 638,500 to 638,700) ✅[^lab-cross].
**Other engines:** an engine-specific number; the practice holds on all three engines. The largest array `Math.max(...arr)` accepted from a top-level call on Node.js 24.22.1 was 124,539 in the first run (2026-11-28; 124,541 for `fn.apply(null, arr)`) and 124,545 in every run of the re-run (2026-11-28, after the restart; 124,547 for `fn.apply(null, arr)`), 123,681 to 124,547 over the V8 builds and both runs ✅[^lab-cross]. In both runs: 123,681 to 123,683 in Chrome 158, 524,287 in SpiderMonkey (Firefox 161; 500,000 for `fn.apply(null, arr)`) and 638,454 to 638,728 on JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page); past it every engine threw a `RangeError`, and V8's limit was the lowest, near 124,000 (counts; call depth and stack size not varied; re-run load average 3.5 to 3.8 at the start of the runs) ✅[^lab-cross].
**Exceptions:** the size is fixed and small by construction (a tuple, a few config values).
**Check it:** call the code with the largest input the data allows on the runtime in use; the limit also depends on how deep the call already is.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes "Belongs to an existing class" (`unbounded-input`), script `spreadargs.mjs`, "Corrections" and "Other builds and versions (2026-11-27)"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.25.

### `JL-L7` A `Map` or `Set` built once replaces an array search inside a loop
**Seen in code as:** `find`, `includes`, `indexOf` or `some` on array B inside a loop or `map` over array A; nested loops matching by key.
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
**Other engines:** holds on all three engines, V8 included, in all three runs: at n = 4,000 `includes` in a loop was 11 to 106 times slower than a `Set` built once, and it grew 3.5 to 4.3 times when n doubled (one Node.js value 6.69), against about 2 for a linear cost ✅[^lab-cross].
- **First run.** `includes` on an n-element array inside a loop over n queries grew 3.64 to 4.12 times when n doubled from 2,000 to 4,000, against about 2 for a linear cost, and at n = 4,000 was 11 to 95 times slower than a `Set` built once, on Node.js 24.22.1, Chrome 158, SpiderMonkey (Firefox 161) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page) (time, six runs) ✅[^lab-cross].
- **Measured at n = 4,000:** 1.55 to 6.97 ms for `includes` in the loop against 0.055 to 0.172 ms for the `Set` ✅[^lab-cross]. These are the six runs of the first run (2026-11-28).
- **Re-run** (2026-11-28, after the restart, under a load average of 3.3 to 6.0, three runs per environment): 1.55 to 7.07 ms for `includes` in the loop against 0.055 to 0.253 ms for the `Set` (11 to 106 times slower), and growth of 3.54 to 4.33 times when n doubled ✅[^lab-cross].
- **Slow run.** One Node.js run was slow on every row (4.70 ms against 0.253 ms); the others stayed within 0.157 ms for the `Set` ✅[^lab-cross].
- **Third run** (2026-11-28, evening, quiet machine, under a load average of 1.77 to 2.95, three runs per environment): 1.55 to 7.03 ms for `includes` in the loop against 0.0548 to 0.162 ms for the `Set` (11 to 92 times slower), and growth of 3.61 to 4.10 times when n doubled, apart from the one slow value below (6.69) ✅[^lab-cross].
- **One slow value.** In one Node.js run of the third run `includes` alone was slow at n = 4,000 (5.45 ms against 3.18 and 3.19 ms, a growth of 6.69, at a load average of 2.87), while the other forms of that run were as fast as in the other two; no third run was slow in every form ✅[^lab-cross].
- **Over the first two runs:** 11 to 106 times slower, growth 3.5 to 4.3 against about 2 for a linear cost, so the order and the cause held in both runs ✅[^lab-cross]. The growth is the algorithm's.
- **Over the three runs:** 11 to 106 times slower, growth 3.54 to 4.33, and 6.69 for that one value ✅[^lab-cross].
**Exceptions:** the inner collection is small and fixed (weekdays, a few config entries); duplicate keys where the first match must win (build the `Map` so the first entry is kept).
**Check it:** time the code at n and 2n: after the fix the time should roughly double, not quadruple; the output should be identical.
**Full lab:** [problem-classes.md](../../performance/code-review/problem-classes.md), class `lookup-in-loop` and Lookup notes "Sizes decide"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.26.

### `JL-L8` A whole collection is not rebuilt inside a loop or `reduce`
**Seen in code as:** `{ ...acc, [k]: v }`, `[...acc, x]` or `acc.concat(x)` returned from a `reduce` callback or assigned in a loop; `Object.keys(o).length`, `slice`, `concat` or `join` of a whole collection inside a loop.
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
**Other engines:** holds on all three engines, V8 included, in all three runs: at n = 4,000 a `reduce` returning `[...acc, x]` was 605 to 2,013 times slower than `push`, and it grew 3.0 to 4.7 times when n doubled, against about 2 for a linear cost ✅[^lab-cross].
- **First run.** a `reduce` returning `[...acc, x]` grew 3.24 to 4.74 times when n doubled from 2,000 to 4,000 and at n = 4,000 was 620 to 1,960 times slower than `push`, on Node.js 24.22.1, Chrome 158, SpiderMonkey (Firefox 161) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page) (time, six runs) ✅[^lab-cross].
- **Measured at n = 4,000** (first run): 5.60 to 29.8 ms for `[...acc, x]` against 0.0088 to 0.0154 ms for `push` ✅[^lab-cross]. These are the six runs of the first run (2026-11-28).
- **Re-run** (2026-11-28, after the restart, under a load average of 3.3 to 6.0, three runs per environment): 5.49 to 30.4 ms for `[...acc, x]` against 0.0087 to 0.0162 ms for `push` (629 to 1,946 times slower), and growth of 2.96 to 4.62 times when n doubled ✅[^lab-cross].
- **Slow run.** The slow Node.js run of `JL-L7` also gave the lowest growth (2.96, with 11.8 ms); without it the growth was 3.55 to 4.62 ✅[^lab-cross].
- **Third run** (2026-11-28, evening, quiet machine, under a load average of 1.77 to 2.95, three runs per environment): 5.24 to 31.6 ms for `[...acc, x]` against 0.00862 to 0.0157 ms for `push` (605 to 2,013 times slower), and growth of 3.48 to 4.35 times when n doubled; no third run was slow in every form ✅[^lab-cross].
- **Over the first two runs:** 620 to 1,960 times slower, growth 3.0 to 4.7 against about 2 for a linear cost ✅[^lab-cross]. The growth is the algorithm's.
- **Over the three runs:** 605 to 2,013 times slower, growth 2.96 to 4.74 ✅[^lab-cross].
**Exceptions:** small, bounded collections; a copy that is really needed (the old version is kept).
**Check it:** heap used and time at n and 2n: after the fix both should roughly double, not quadruple.
**Full lab:** [problem-classes.md](../../performance/code-review/problem-classes.md), classes `allocation-gc` and `linear-call-in-loop`; [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes "Belongs to an existing class"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.26.

### `JL-L9` The TypeScript `target` matches the oldest runtime the code really runs on
**Seen in code as:** `"target": "es5"`, `"es2015"`, `"es2016"` or `"es2017"` in a `tsconfig.json` for a modern runtime; `"downlevelIteration": true`; built output with `__awaiter`, `__generator`, `__spreadArray` or `__classPrivateFieldGet`.
**Prefer:**
```json
{ "compilerOptions": { "target": "es2022" } }
```
**Avoid:**
```json
{ "compilerOptions": { "target": "es2015", "downlevelIteration": true } }
```
**Why:** `target` changes which features are downleveled ✅[^ts-target], and by default helpers are inserted into every file that uses them ✅[^ts-helpers]. When compiling to ES2021 or lower, TypeScript replaces `#` fields with `WeakMap`s ✅[^ts-classes], so each read or write becomes a helper call. With `downlevelIteration` in ES5 output, `for…of` goes through a `__values` helper ✅[^ts-downlevel].
**Evidence:** TypeScript 5.9.3, output run on Node.js 24.22.1 (V8 13.6, arm64): one module emitted 73 lines and 7 helpers at ES2015, 20 lines and none at ES2022; 1,000 increments of a `#` field made 2,000 helper calls at ES2015 and none at ES2022 (counts) ✅[^lab]; the same on all seven builds of the 2026-11-27 matrix and in Chrome 158 (V8 15.8), where a page ran the emitted output prepared beforehand ✅[^lab-matrix]. Not a cost: the ES2015 `__awaiter` output took the same 1,001 microtask turns for 1,000 awaits as native `async` ✅[^lab]. TypeScript 6.0 deprecates `target: es5` and `downlevelIteration`, and options deprecated in 6.0 are removed in 7.0 ✅[^ts-60].
**Exceptions:** the code really runs on an old engine (then add `importHelpers` with `tslib`, so each helper exists once ✅[^ts-helpers]); a bundler or another compiler sets the final syntax level.
**Check it:** `grep -c "__awaiter\|__generator\|__classPrivateField" dist/**/*.js`: expect 0 at a native target.
**Full lab:** [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Catalog class `ts-downlevel-emit`, Lookup notes script `ts.mjs` and "Corrections found while checking the sources (2026-11-26)".

### `JL-L10` `#` private fields on an ES2022+ target cost nothing extra; avoiding them gains nothing
**Keep writing:**
```ts
class User { readonly #passwordHash: string; constructor(h: string) { this.#passwordHash = h; } }
```
**Why:** TypeScript `private` is enforced only during type checking, so at run time the field is an ordinary property that `JSON.stringify`, spread and loggers see; `#` fields stay private after compilation ✅[^ts-classes]. Private elements cannot be enumerated or reached through `Object` methods ✅[^mdn-private], so `JSON.stringify` and spread do not see them. V8 9.7 moved class-field initialization, private fields included, onto its inline-cache fast path ✅[^v8-classfeat].
**Evidence:** Both checks agree with the source doc: no difference beyond run-to-run noise. The absolute times are lower than the source doc's because the script and the machine differ; only the ratio carries over.
- **First measurement.** timings of 2026-10-25 on Node.js 24.22 (V8 13.6), target ES2023 (native `#`), each case in its own process after a warm-up run, three runs each; no CPU, operating system or exact patch version is recorded, so read them as a ratio: 2×10⁸ reads through a method 126 ms public, 126 ms `#`; 3×10⁷ constructions (two fields) 166 to 172 ms public, 168 to 180 ms `#`, within run-to-run noise ✅[^lab-private].
- **First attempt.** A first attempt with both cases in one process showed `#` 3 times slower: an ordering effect of warm-up, not the field type ✅[^lab-private].
- **Where these come from.** These timings are not from the baseline lab builds; they were taken once, are not part of the re-run, and their load was not recorded ✅[^lab-private].
- **Earlier check.** An earlier check, made when this practice was first written (before the restart of the lab machine; its output was not kept), re-ran the comparison on Node.js 24.22.1 in a linux arm64 container, five runs, each case in its own process, and printed no difference between the two.
- **Run again** on 2026-11-28 the same way (Node.js 24.22.1, linux arm64 container, five runs, each case in its own process after a warm-up run, one timing run at a time, under a load average of 2.52 to 2.56; the source doc holds no script, so the script below is written from its description): 2×10⁸ reads through a method took 87 to 91 ms public and 86 to 91 ms `#`; 3×10⁷ constructions of two fields took 70 to 76 ms public and 73 to 77 ms `#` (`#` 0.96 to 1.07 times the public time in the same run) ✅[^spot].
- **A reviewer** repeated the script once on 2026-11-28 (same container, load average 2.10 to 2.25): 85 to 89 ms public and 86 to 109 ms `#` for the reads, 71 to 76 and 70 to 83 ms for the constructions; two `#` runs were slow (109 and 83 ms) and the rest matched, so the order and the ratio stand ✅[^spot].
<details><summary>Spot check: public against <code>#</code> fields, each case in its own process</summary>

`private-bench.mjs`:
```js
// node private-bench.mjs <public|private> <read|construct>: one case per process, a warm-up run, then the timed run.
// read: 2e8 reads through a method; construct: 3e7 constructions of an object with two fields.
const [kind, op] = process.argv.slice(2);
class Pub { constructor(a, b) { this.a = a; this.b = b; } get() { return this.a; } }
class Priv { #a; #b; constructor(a, b) { this.#a = a; this.#b = b; } get() { return this.#a; } }
const C = kind === 'private' ? Priv : Pub;
function read(n) { const o = new C(1, 2); let s = 0; for (let i = 0; i < n; i++) s = (s + o.get()) | 0; return s; }
function construct(n) { let last; for (let i = 0; i < n; i++) last = new C(i, i + 1); return last.get(); }
const fn = op === 'read' ? () => read(2e8) : () => construct(3e7);
fn(); // warm-up run
const t0 = process.hrtime.bigint(); const r = fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`${kind.padEnd(7)} ${op.padEnd(9)} ${ms.toFixed(0)} ms (result ${r})`);
```
```sh
for run in 1 2 3 4 5; do for op in read construct; do for k in public private; do
  uptime; docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node private-bench.mjs $k $op
done; done; done
```
```text
# one-minute load average 2.52 to 2.56 before every run
# the 20 lines printed (such as "public  read      87 ms (result 200000000)"), grouped per case: ms in runs 1 to 5
public  read       87 89 87 87 91
private read       88 89 86 87 91
public  construct  72 73 70 72 76
private construct  73 75 74 77 73
```
</details>

**Other engines:** no gain on all three engines. The first two runs differ on V8 (the same speed, then sometimes faster), and the third run agrees with the first; all three support the practice: `#` was never slower on V8 by more than 5% (3% over the first two runs) or on SpiderMonkey by more than 3%, at most 16% slower on JavaScriptCore, and avoiding it gains nothing on any engine ✅[^lab-cross]; these are ratios of the fastest rounds of each run, and the script's own per-round ratios were wider (0.86 to 1.15 on Node.js in the third run, 0.71 to 1.78 in one loaded re-run run) ✅[^lab-cross].
- **Ratios over both runs.** 10⁶ reads of `this.#v` against `this.v` in a method took 0.88 to 1.02 times as long on Node.js 24.22.1 and 0.86 to 1.03 in Chrome 158 (`#` up to 14% faster in a few runs), 0.97 to 1.02 in SpiderMonkey (Firefox 161) and 1.00 to 1.16 times on JavaScriptCore (macOS 26.1 shell 1.04 to 1.16, Bun 1.4.5 1.04 to 1.08, WebKit page 1.00 to 1.16; about 0.05 ms per 10⁶ reads), in one process with the rounds interleaved and each class with its own method (time, three runs) ✅[^lab-cross]. Those ranges cover both runs.
- **First run** (2026-11-28): 0.97 to 1.01 on Node.js (a public read loop of 10⁶ took 0.53 to 0.55 ms), 0.94 to 1.02 in Chrome (0.85 to 0.91 ms), 0.97 to 1.02 in SpiderMonkey (0.64 to 0.67 ms), and 1.07 to 1.16 in the shell, 1.07 to 1.08 in Bun and 1.00 to 1.16 in the WebKit page (0.30 ms each): the same speed within 6% either way on V8 and SpiderMonkey ✅[^lab-cross].
- **Re-run** (2026-11-28, after the restart, under a load average of 3.8 to 12.5; five runs on Node.js, Chrome and the WebKit page, three on the others; each ratio is the fastest `#` round over the fastest public round of one run, and the public times are the fastest rounds of each run): 0.88 to 1.02 on Node.js (0.53 to 0.65 ms), 0.86 to 1.03 in Chrome (0.82 to 0.93 ms), 0.98 to 0.99 in SpiderMonkey (0.67 ms), and 1.04 to 1.09 in the shell, 1.04 to 1.05 in Bun and 1.05 to 1.10 in the WebKit page (0.30 to 0.31 ms); `#` was up to 14% faster on V8 in three of five Chrome runs and one of five Node.js runs ✅[^lab-cross].
- **Per-round ratios.** The script's own per-round ratios were wider: on Node.js 0.83 to 1.02 in four runs and 0.71 to 1.78 in the fifth (load average 11.4, public round times up to 1.13 ms) ✅[^lab-cross].
- **Third run** (2026-11-28, evening, quiet machine, under a load average of 1.75 to 2.95; three runs each; ratios and public times as in the re-run): 0.99 to 1.04 on Node.js (0.527 to 0.540 ms), 0.96 to 1.05 in Chrome (0.778 to 0.879 ms), 0.98 to 1.01 in SpiderMonkey (0.651 to 0.693 ms), and 1.10 to 1.15 in the shell (0.291 to 0.302 ms), 1.06 to 1.07 in Bun (0.296 to 0.302 ms) and 1.11 to 1.16 in the WebKit page (0.287 to 0.288 ms); the script's own per-round ratios were 0.86 to 1.15 on Node.js and 0.96 to 1.05 in Chrome ✅[^lab-cross].
- **Over the three runs:** 0.88 to 1.04 on Node.js, 0.86 to 1.05 in Chrome, 0.97 to 1.02 in SpiderMonkey, 1.04 to 1.16 in the shell, 1.04 to 1.08 in Bun and 1.00 to 1.16 in the WebKit page. The quiet run agrees with the first run on V8 (the same speed within 5% either way); the re-run's `#` up to 14% faster did not come again ✅[^lab-cross].
**Exceptions:** target ES2021 or lower (then `#` becomes `WeakMap` lookups, `JL-L9`); a constructor parameter property for an injected collaborator, which cannot be a `#` field (TypeScript reports error TS18009; recorded in the concept doc linked below, not re-run here); objects reached through a `Proxy`, which `#` access does not pass through ✅[^mdn-private].
**Check it:** time each variant in its own process (`node bench-public.mjs`, then `node bench-private.mjs`), never both in one process.
**Full lab:** [private-fields.md](../../js-runtime/private-fields.md), sections How it works and Worked example; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.27.

### `JL-L11` `enum`, `as const` and literal unions are not a speed choice; `enum` is avoided because it is not erasable
**Seen in code as:** an `enum` replaced, or kept, "for performance"; a new TypeScript `enum` in code run by Node.js type stripping or checked with `erasableSyntaxOnly`.
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
**Seen in code as:** an `index.ts` (or `index.js`) that only re-exports (`export * from './x.js'`), and imports such as `from '@/modules/documents/index.js'` inside the same application.
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
- Verified: 175 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab: the scripts of the JavaScript language catalog run in `node:24.22.1-alpine` (Node.js v24.22.1, V8 13.6.233.17-node.58, linux arm64, pointer compression off, Apple M2 under Docker), TypeScript 5.9.3 for the TypeScript script, on 2026-11-26, and re-run with every build on 2026-11-28 after a restart of the lab machine (58 results, all matching); scripts and output in [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes. Rank 1 (primary measurement). Backs: Summary, Catalog, Lookup notes, Takeaways. [^lab]
- Lab matrix: the same scripts run again on 2026-11-27 on Node.js 24.22.1 (macOS 26.1 arm64; linux x64 emulated), Node.js 22.23.4 (V8 12.4.254.21), Node.js 25.7.0 (V8 14.1.146.11), Electron 43.7.7 run as Node (V8 15.0.245.31, pointer compression on), the Node.js 24.22.3 pointer-compression build (V8 13.6, linux x64 emulated), Google Chrome 158.0.8127.89 (V8 15.8.62.31, headless page, macOS arm64), and for the sort counts Deno 2.9.8 (V8 15.0.245.2) and Electron 38.8.6 (V8 14.0.365.10); table and differing output in [problem-classes-javascript-language.md](../../performance/code-review/problem-classes-javascript-language.md), Lookup notes, "Other builds and versions (2026-11-27)". Rank 1 (primary measurement). Backs: Scope, Catalog, Lookup notes. [^lab-matrix]
- Lab cross-engine: the engine-neutral checks of 2026-11-28 on one Apple M2: V8 in Node.js 24.22.1 (macOS arm64) and Google Chrome 158.0.8127.89, SpiderMonkey in Firefox 161.0 (headless), JavaScriptCore in the `jsc` shell of macOS 26.1 (framework 21622.2.11.11.9), Bun 1.4.5 (linux arm64 container) and the Playwright WebKit build 2311; each check script run three times per environment (first run, load average 2.1 to 13.8), and every script run again three to five times per environment on 2026-11-28 after a restart of the lab machine (re-run, `uptime` logged before every run), and the timing scripts run three times more per environment in the evening of 2026-11-28 on a quiet machine (third run, each run started below a load average of 3.0);
  scripts and outputs in [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.21 to §4.27 and Verification status. Rank 1 (primary measurement). Backs: Summary, Scope, Catalog, Lookup notes, Takeaways. [^lab-cross]
- Lab private fields: timings measured on 2026-10-25 on Node.js 24.22 (V8 13.6), target ES2023, each case in its own process after a warm-up, three runs; no CPU or operating system recorded; table in [private-fields.md](../../js-runtime/private-fields.md), Worked example. Rank 1 (primary measurement). Backs: Catalog `JL-L10`; Lookup notes `JL-L10`. [^lab-private]
- Lab enums: TypeScript 6.0.3 emit to CommonJS for a three-member set, the lint selector and a dependency's compiled `enum`, tested on 2026-10-28 on a sample TypeScript service; in [enums-and-literal-unions.md](../../js-runtime/enums-and-literal-unions.md), How it works items 6 and 10 and Edge cases. Rank 1 (primary measurement). Backs: Catalog `JL-L11`; Lookup notes `JL-L11`. [^lab-enum]
- Spot checks for this doc: the scripts in the `JL-L1` and `JL-L10` notes, run on 2026-11-28 with `docker run --rm --network none node:24.22.1-alpine` (Node.js 24.22.1, V8 13.6.233.17, linux arm64): `chain.mjs` three times with the semi-space flags and three times with default flags; `private-bench.mjs` five runs per case, each case in its own process, one timing run at a time, `uptime` before every run; commands and output in those notes; both were run again by a reviewer the same day. Rank 1 (primary measurement). Backs: Lookup notes, JL-L1 and JL-L10. [^spot]
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
