---
schema: knowledge-doc/v1
type: reference
topic: performance/code-review
status: verified
applies-to: ["ECMAScript 2025 as described by MDN (pages modified 2025-07 to 2026-11)", "Node.js 24 (docs v24.22.3; lab on Node.js 24.22.1, V8 13.6.233.17)", "TypeScript 5.9.3 (lab) and the TypeScript 6.0 release notes", "all read 2026-11-26", "lab re-run 2026-11-27 on Node.js 22.23.4, 24.22.1 (macOS arm64, linux x64 emulated), 25.7.0 and Electron 43.7.7 (V8 12.4 to 15.0)", "and on Node.js 24.22.3 linux x64 with pointer compression (emulated)", "and in Google Chrome 158.0.8127.89 (V8 15.8, headless page); sort counts also on Deno 2.9.8 (V8 15.0) and Electron 38.8.6 (V8 14.0)"]
last-verified: 2026-11-27
last-updated: 2026-11-28
tags: [performance, code-review, javascript, typescript, array-methods, iterator-helpers, async, microtasks, errors, stack-traces, sort, spread, tsconfig]
ranked-sources: true
---

# Performance problem classes in JavaScript and TypeScript code

## Summary
**TL;DR:** Some JavaScript costs come from how the code is written, whatever the engine: a chain of array methods that builds an array per step, a full pass where the first match would do, a sort comparator that recomputes its keys, an `await` on values that are not promises, an error object that walks the stack on a routine path, and a TypeScript `target` that turns native syntax into helper calls. This catalog gives six such classes with the fix, the cost as a count from the code, and the check. Most are per-element or per-call costs, so the sizes in the workload decide whether a finding matters.
**Use this when:** you review JavaScript or TypeScript (Node.js, browsers or any other runtime) and the code shape looks idiomatic but runs once per element, per comparison or per request over large or unbounded inputs; or you review a `tsconfig.json`.
**Not this doc:** the first catalog of 39 classes (lookups in loops, spread on an accumulator, regexes built per iteration, independent awaits in sequence) → `problem-classes.md`; object shapes, holey arrays and other V8 layout costs → `problem-classes-language-runtimes.md` (`object-shape-instability`) and `problem-classes-javascript-engine.md`; event loop, buffers, streams and module loading → `problem-classes-nodejs-runtime.md`; how microtasks and `await` work → `../../javascript/async/event-loop-and-async-await.md`.

## Scope
The domain is cost that a reviewer can count from JavaScript or TypeScript source: built-in array, string and regular-expression methods, functions and calls, `async` code, error objects, and the TypeScript compiler options that change the emitted JavaScript. Analogy: a recipe that says "chop all the onions, put them in a bowl, then slice all the chopped onions into another bowl" when one pass over the board would do; nothing is wrong with each step, the bowls are the cost. Concrete example: `orders.filter(isPaid).map(toRow).reduce(sum, 0)` over 1,000,000 orders builds two arrays that are thrown away as soon as `reduce` returns.

Covered: six classes in three groups (collections and iteration; calls, async code and errors; TypeScript emit). Engine-independent claims come from MDN, the Node.js and V8 docs and the TypeScript docs; every count marked ✅[^lab] was measured on Node.js 24.22.1 and holds for that version; the re-run on six more builds is in Lookup notes, "Other builds and versions". Not covered: V8 compiler behaviour (inline caches, deoptimization, `arguments`, `for…in`, closures per call), which is in `problem-classes-javascript-engine.md`; the Node.js event loop, buffers, streams and module loading, in `problem-classes-nodejs-runtime.md`; shapes that belong to existing classes, listed under "Belongs to an existing class".

Notation (each symbol is a count read from the code or its workload):

| Symbol | Meaning | Worked example |
|---|---|---|
| n | Elements in the array, string or loop | 1,000,000 orders: n = 1,000,000 |
| k | Array methods chained one after another | `filter().map().reduce()`: k = 3, so 3 passes and k − 1 = 2 intermediate arrays |
| i | Index of the first element that matches | The first admin is at index 10: `find` calls its predicate i + 1 = 11 times |
| m | Matches that a full pass collects | `text.match(/error/g)` on a text with 50,000 occurrences: an array of m = 50,000 strings |
| d | Call depth when an error object is created | A validator 200 calls deep in a recursive walk: d = 200 |
| L | `Error.stackTraceLimit`, frames kept per stack trace | Default 10 in Node.js 24; with d = 200 and L = `Infinity`, about 200 frames are captured, not 10 |
| t | Microtask turns: times the engine runs other queued microtasks before the function resumes | `for (const v of values) s += await v` over 1,000 plain numbers: t ≈ 1,000 |

Terms:

| Term | Plain meaning | Analogy | Concrete example |
|---|---|---|---|
| Intermediate array | An array built by one step of a chain only to feed the next step | A bowl of chopped onions that is emptied into the pot at once | The result of `filter` in `filter(p).map(f)` |
| Iterator helper | A lazy method on iterators (ES2025) that yields one value at a time instead of building an array | A conveyor belt rather than a stack of trays | `arr.values().filter(p).map(f).toArray()` |
| Comparator | The function `sort` calls to order two elements | A judge asked to compare two contestants, many times per contestant | `(a, b) => a.price - b.price` |
| Microtask turn | A point where an `async` function pauses and the engine runs the other queued microtasks before resuming it | A cook who steps away after every onion to serve all waiting side orders | Each `await` of a plain value pauses once |
| Stack trace capture | Recording the active call frames when an error object is created | Photographing the whole queue behind you each time you sign a form | `new Error('x')` records up to L frames |
| Downleveling | TypeScript rewriting newer syntax into older JavaScript | Translating a modern novel into old-fashioned English, which takes more words | `async` functions emitted as `__awaiter` calls for `target: es2015` |
| Emit helper | A small function the TypeScript compiler adds to the output to implement downleveled syntax | A phrasebook stapled to every translated page | `__classPrivateFieldGet`, `__awaiter`, `__spreadArray` |

## Catalog

**Collections and iteration**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `chained-array-passes` | `.filter(...).map(...)`, `.map(...).filter(...).reduce(...)`, `Object.entries(o).filter(...).map(...)`, `[...map.values()].filter(...)`, `Array.from(iter).map(...)` over large or unbounded arrays; `.map(...)` whose result is discarded | One `for` loop, or one `reduce`, that filters and transforms in the same pass; `forEach` or `for…of` when no array is needed; iterator helpers (`arr.values().filter(p).map(f)`) when the source is an iterator, is infinite, or is cut short by `take` or `find` | k passes and k − 1 intermediate arrays of up to n elements → 1 pass and no intermediate array. `map` creates a new array, and calling it without using the result is an anti-pattern ✅[^mdn-map]; `filter` calls its callback once per element and constructs a new array ✅[^mdn-filter]; converting to an array and then reducing creates an intermediate array and iterates twice ✅[^mdn-iter]; iterator helpers are lazy and produce the next value only when requested ✅[^mdn-itermap]. Measured on Node.js 24.22.1 over n = 1,000,000: the chain created 2 arrays and grew the heap by 20 MB per run, one indexed loop created none and grew it by 0 MB, iterator helpers created no array but grew the heap by 80 MB per run ✅[^lab], the same on Node.js 22.23.4 and 25.7.0; with pointer compression on the growth was 10 MB, 0 MB and 40 MB, on Electron 43.7.7 (V8 15.0) and on a Node.js 24.22.3 build with V8 13.6, so pointer compression is the cause ✅[^lab-matrix] | Heap growth around a forced collection (`node --expose-gc`) at n and 2n: expect it to double before the fix and stay near 0 after; or an allocation profile showing no arrays allocated by the chain |
| `full-pass-for-first` | `filter(p)[0]`; `filter(p).length > 0`, `!== 0` or `=== 0`; `map(f).includes(x)`; `str.match(/re/g)` used as a boolean or compared to `null`; `arr.filter(p).length === arr.length` to test all | `find`, `findIndex`, `some`, `every`, `includes`; `re.test(str)` with a regex that has no `g` flag; `Iterator.prototype.find` or `some` on iterators | n predicate calls plus an array of m matches → i + 1 calls and no array; with no match, both make n calls. `find` returns the first matching element and stops iterating ✅[^mdn-find]; MDN points to `some` for "does any element satisfy" ✅[^mdn-find]; `filter` calls its callback for every element ✅[^mdn-filter]; `match` with `g` returns all matches ✅[^mdn-match], and MDN points to `test` for "does it match" ✅[^mdn-match]. Measured on Node.js 24.22.1 with n = 100,000 and the first match at index 10: 100,000 predicate calls for `filter`, 11 for `find` and `some` ✅[^lab] | Count predicate calls with a counter on a test input whose first match is early: expect i + 1 after the fix |
| `sort-key-recompute` | A comparator that derives its keys: `sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))`, `new Date(a.ts) - new Date(b.ts)`, `parseFloat`, `JSON.stringify`, a regex or a `map.get(a.id)` inside the comparator; the same in `toSorted` | Decorate, sort, undecorate: `rows.map(r => ({ k: key(r), r })).sort((x, y) => cmp(x.k, y.k)).map(x => x.r)`; or store the key on the record once; for locale order, also one shared `Intl.Collator` (`hot-path-constants`) | 2 key computations per comparator call, and the number of calls grows faster than n (about n·log₂ n for a comparison sort: arithmetic, see "What the sources do not say") → n key computations, plus two arrays of n. The comparator can be called many times per element, which may yield a high overhead ✅[^mdn-sort]; MDN's remedy is to extract the sort values once into a temporary array, sort it, then map back ✅[^mdn-sort]. Measured on Node.js 24.22.1 with n = 10,000 seeded rows: 119,955 comparator calls and 239,910 key computations → 10,000 ✅[^lab], the same on V8 12.4 to 14.1 (Node.js; Electron 38.8.6 with V8 14.0); V8 15.0 in Electron 43.7.7 and in Deno 2.9.8, and V8 15.8 in Chrome 158, made 119,784 calls and 239,568 key computations on the same rows: the count came with the V8 version, not with pointer compression ✅[^lab-matrix] | A counter in the key function on a test of n = 10,000: expect n after the fix, and the same order |

**Calls, async code and errors**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `await-per-sync-value` | `await` inside a loop on a value that is not a promise (`await cache.get(k)` with a synchronous `get`, `await` on a plain function's result); `async` functions with no I/O, such as `async (a, b) => a + b`, awaited per element; `for await (const x of array)` over an in-memory array | Keep synchronous code synchronous and call it without `await`; `for…of` for in-memory arrays; `await` once at the boundary where I/O happens; when a source is sometimes a promise, check first and await only then | t ≈ n microtask turns per loop (≈ 2n for `for await` over an array), and one promise per `async` call → none. `await` converts a non-promise to a resolved promise and waits for it ✅[^mdn-await]; execution does not return to the function until all already-scheduled microtasks are processed, even for a non-promise ✅[^mdn-await]; an `async` function always returns a promise ✅[^mdn-async]; `for await` awaits every iteration even over a sync iterable, which MDN says makes it slower ✅[^mdn-forawait]. Measured on Node.js 24.22.1 with n = 1,000: a competing microtask chain ran 1 turn during the synchronous loop, 1,001 with `await` per plain value, 2,003 with `for await` over the array ✅[^lab] | Count turns of a competing `queueMicrotask` chain while the loop runs (script in Lookup notes): expect about 1 after the fix, not n |
| `stack-capture-per-call` | `new Error()` built only to read `.stack` for the caller's file and line in a logger, tracer or deprecation helper, per call; `Error.captureStackTrace(this)` in constructors of objects created per request; `Error.stackTraceLimit = Infinity` or a large number set at start-up in production | Capture a stack only when it will be used (the log level is on, the error leaves the process); keep `Error.stackTraceLimit` at its default or lower in production, and raise it only in a debugging session | min(d, L) frames walked per error object created → 0 when no error object is created. errors thrown by V8 itself capture a stack trace when they are created ✅[^v8-stack], in Node.js 24 `error.stack` represents the point where `new Error()` was called ✅[^node-errors], and V8 formats a trace only when `stack` is first read ✅[^v8-stack]; the default of 10 frames is chosen so as not to have a noticeable performance impact, and 0 disables collection ✅[^v8-stack]; in Node.js 24, `Error.stackTraceLimit` defaults to 10, may be set to any valid JavaScript number (a non-number or negative value captures no frames), and affects traces captured after the change ✅[^node-errors], and a trace stops at the start of synchronous execution or at the limit, whichever is smaller ✅[^node-errors]. Measured on Node.js 24.22.1 at d = 200: 10 frames with the default, 205 with `Infinity`, 0 with 0 ✅[^lab] | `grep -rn "stackTraceLimit\|captureStackTrace\|new Error()" src/`; in a CPU profile, time under error construction on the hot path before the fix, none after |

**TypeScript emit**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `ts-downlevel-emit` | `"target": "es5"`, `"es2015"`, `"es2016"` or `"es2017"` in a `tsconfig.json` for code that runs on Node.js 24 or evergreen browsers; `"downlevelIteration": true`; many output files with no `"importHelpers": true`; built output that contains `__awaiter`, `__generator`, `__asyncGenerator`, `__values`, `__read`, `__spreadArray` or `__classPrivateFieldGet` | Set `target` to the oldest runtime the code really runs on (TypeScript points to community-organized `tsconfig` bases for common platforms and their versions ✅[^ts-target]); when an old target is required, `importHelpers` with `tslib` so each helper exists once ✅[^ts-helpers] | Helper calls per downleveled operation and a copy of each helper per output file → native syntax and no helpers. `target` changes which features are downleveled ✅[^ts-target]; by default helpers are inserted into every file that uses them, which can duplicate code across modules ✅[^ts-helpers]; with `downlevelIteration` in ES5 output, `for…of` goes through a `__values` helper that checks for `Symbol.iterator`, and a manual iterator loop with `try`/`finally` ✅[^ts-downlevel]. Measured with TypeScript 5.9.3 on one module: 73 output lines and 7 helpers at ES2015, 20 lines and none at ES2022; 1,000 increments of a `#` field made 2,000 helper calls at ES2015 and none at ES2022 ✅[^lab] (why `#` becomes a `WeakMap`: `../../js-runtime/private-fields.md`) | `grep -c "__awaiter\|__generator\|__classPrivateField" dist/**/*.js`: expect 0 at a native target |

## Lookup notes
- **Sizes decide.** Every class here costs per element, per comparison or per call. Ten elements, start-up code or a path that runs once per request with small inputs is not a finding. Report these classes on hot code, or on code that runs per element of a large or unbounded input.
- **Not a problem when.**

| Class | Not a problem when |
|---|---|
| `chained-array-passes` | n is small, or the chain runs once; the intermediate array is needed anyway (it is returned or reused); readability wins on a cold path. In the lab on Node.js 24.22.1, iterator helpers over an in-memory array allocated more total bytes than the chain (80 MB against 20 MB per run), so they were not a fix for allocation volume there ✅[^lab]; with pointer compression on (Electron 43.7.7; Node.js 24.22.3 with V8 13.6; Chrome 158) it was 40 MB against 10 MB ✅[^lab-matrix] |
| `full-pass-for-first` | All matches are needed later in the same function (then keep the `filter` result and test its length once); the array is small |
| `sort-key-recompute` | The key is a plain property read (`a.price - b.price`); n is small; the extra two arrays of n are too much memory for the input |
| `await-per-sync-value` | The value is sometimes a real promise and the code must accept both (then await only when needed); the pause is wanted, to let other work run between items in a long loop |
| `stack-capture-per-call` | The error is truly exceptional and rare; the stack is used (it is logged or reported); a debugging session needs a higher `Error.stackTraceLimit` |
| `ts-downlevel-emit` | The code really runs on an old engine; a bundler or another compiler sets the final syntax level after TypeScript; the code with helpers is cold |

- **Belongs to an existing class.**
  - A plain object used as a dictionary with frequent adds and `delete` → `object-shape-instability` (`problem-classes-language-runtimes.md`), whose fix is a `Map`; MDN says a `Map` performs better with frequent additions and removals ✅[^mdn-mapobj].
  - `Object.keys(o).length` for a size, or `Object.keys` / `entries` / `values` rebuilt inside a loop → `linear-call-in-loop` (`problem-classes.md`); MDN calls counting an object's items through `Object.keys` less efficient than a `Map`'s `size` ✅[^mdn-mapobj].
  - `{ ...item, x }` or `structuredClone(item)` per element when no copy is needed → `copy-per-iteration` (`problem-classes-language-runtimes.md`); `JSON.parse(JSON.stringify(x))` → `payload-overfetch`; spread or `concat` on an accumulator → `allocation-gc` (both `problem-classes.md`).
  - `Math.max(...arr)`, `target.push(...items)`, `fn.apply(null, arr)` or `String.fromCharCode(...codes)` where the array size comes from data → `unbounded-input` (`problem-classes.md`): it is a failure at a size, not a cost per element, and the fix is the same (a cap, or fixed-size chunks; MDN's example uses 32,768; a loop or `reduce` for min and max). Long argument lists risk exceeding the engine's argument length limit, whose consequences are unspecified and vary across engines ✅[^mdn-apply]; spread and `apply` either fail or return the wrong result for too many elements, and `reduce` does not have this problem ✅[^mdn-max]. Measured on Node.js 24.22.1 with the default stack: both `Math.max(...arr)` and `[].push(...arr)` worked at 120,000 elements and threw `RangeError: Maximum call stack size exceeded` at 200,000 ✅[^lab], and the same on Node.js 25.7.0 and Electron 43.7.7; on Node.js 22.23.4 (V8 12.4) both already threw at 120,000 and worked at 100,000 ✅[^lab-matrix]. The limit changes with the build: test the sizes on the runtime in use.
  - Reads past `arr.length` and arrays that mix small integers, doubles and objects → `object-shape-instability`. `new Array(n)` then filled by index is not a finding on V8 13.6: building it was faster than `push` and the holey kind cost little on reads ([measured](../../js-runtime/v8-object-and-value-representation-deep-dive.md)).
  - `new RegExp(source)` or a literal regex built per iteration, and exceptions thrown for routine outcomes → `hot-path-constants`, and so are error objects created as routine return values (one `ValidationError` per bad row). A regex with the `g` flag reused with `test` is a correctness bug, not a cost: `test` advances `lastIndex` and the next call resumes from it, even on a different string ✅[^mdn-test].
  - Independent `await`s in sequence → `concurrency-backpressure`; barrel imports → `startup-cold-start` (both `problem-classes.md`, and `../../js-runtime/barrel-files.md`).
  - TypeScript `enum`: one small object per module, created once at load (`../../js-runtime/enums-and-literal-unions.md`), so it fails the admission test as a performance class. Decorator metadata emit was not checked for this catalog.
  - `arguments`, `for…in`, closures created per iteration, getters and `Proxy` on hot paths → `problem-classes-javascript-engine.md`.
- **Corrections found while checking the sources (2026-11-26).**
  - MDN says `return await promise` is at least as fast as `return promise`, because of how the specification and engines handle native promises ✅[^mdn-await]. Measured on Node.js 24.22.1 only (native promises), 1,000 calls of an `async` function that does `return p` took 3,001 turns of a competing microtask chain, and `return await p` took 2,001 ✅[^lab]. The V8 post of 12 November 2018 describes the change: an `await` on a native promise went from a minimum of three microticks to one, enabled by default in V8 7.2 ✅[^v8-fastasync].
  - Iterator helpers avoid intermediate arrays, and MDN says the iterator's own `reduce` "may be more efficient, especially memory-wise" ✅[^mdn-iter]. On Node.js 24.22.1 the helper chain still allocated about four times the heap of the eager chain (80 MB against 20 MB per run, same on all 5 runs) ✅[^lab]; with pointer compression on (Electron 43.7.7, V8 15.0; Node.js 24.22.3, V8 13.6) also four times, at 40 MB against 10 MB ✅[^lab-matrix]. The lab measures total bytes allocated between collections, not the peak of live memory; that intermediate arrays raise the live peak while helpers keep it flat is an inference, not measured.
  - Code downleveled to ES2015 by TypeScript 5.9.3 (`__awaiter` over a generator) took the same 1,001 microtask turns for 1,000 awaits as native `async` code ✅[^lab]: for that shape the cost is helper calls and code size, not extra turns.
  - The TSConfig reference page, which carries no TypeScript version label, gives the `target` default as `es2023` with `module: node20`, `esnext` with `module: nodenext` and `ES5` otherwise ✅[^ts-tsconfig], while the TypeScript 6.0 release notes say the new default is the latest ECMAScript version, `es2025` there ✅[^ts-60]. The two pages disagree, so which default applies to which TypeScript version is unconfirmed here: check the version in use. The 6.0 notes say `target: es5` is deprecated, setting `--downlevelIteration` at all gives a deprecation error, and options deprecated in 6.0 are removed in TypeScript 7.0; `"ignoreDeprecations": "6.0"` keeps them working in 6.0 only ✅[^ts-60]. So `downlevelIteration` in a `tsconfig.json` is an upgrade blocker for 7.0.
  - The often-quoted argument limit of 65,536 is JavaScriptCore's ✅[^mdn-apply]; on Node.js 24.22.1 spread calls worked at 120,000 elements and failed at 200,000 (on Node.js 22.23.4 they failed at 120,000 ✅[^lab-matrix]), the error is a stack-size `RangeError`, and no page gives the limit as a number ✅[^lab].
- **What the sources do not say.**
  - No page read gives the number of comparator calls: MDN says the complexity of `sort` cannot be guaranteed because it depends on the implementation ✅[^mdn-sort]. "About n·log₂ n" is arithmetic for a comparison sort: 10,000 · log₂ 10,000 ≈ 132,877, near the 119,955 measured (119,784 in Electron 43.7.7, Deno 2.9.8 and Chrome 158).
  - No V8 or Node.js page gives V8's argument limit as a number. It depends on the stack size (`--stack-size`) and on how deep the call already is, so a bisection in the lab did not give one stable value; only fixed sizes are reported.
  - MDN says `for await` over a sync iterable is slower ✅[^mdn-forawait] but gives no factor; V8's stack-trace page gives no cost per frame.
- **Weaker sources, rank 5 or 6.** None used.

**Lab runs.** Each script below ran in `node:24.22.1-alpine` (Node.js v24.22.1, V8 13.6.233.17-node.58, Apple M2 under Docker) on 2026-11-26 with `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node <flags> <script>.mjs`; flags are given per script. The TypeScript script also mounts a TypeScript 5.9.3 package read-only with `-v <path-to-typescript-package>:/ts:ro`.

Chained methods allocate an array per step; iterator helpers allocated more bytes in this run ✅[^lab] (flags `--expose-gc --max-semi-space-size=256 --min-semi-space-size=256`, so no collection runs inside one measurement):
<details><summary><code>chain.mjs</code> (run as <code>node --expose-gc --max-semi-space-size=256 --min-semi-space-size=256 chain.mjs</code>) and its output</summary>

```js
// filter -> map -> reduce, one indexed loop, and iterator helpers over 1,000,000 small integers:
// arrays created (counted through Symbol.species) and heap growth in MB over 5 runs with no collection in between.
let made = 0; class Counted extends Array { constructor(...a) { super(...a); made++; } }
const src = Counted.from({ length: 1_000_000 }, (_, i) => i);
const isEven = (x) => (x & 1) === 0, low = (x) => x & 1023, add = (a, b) => (a + b) | 0;
const variants = {
  'chain': () => src.filter(isEven).map(low).reduce(add, 0),
  'one loop': () => { let s = 0; for (let i = 0; i < src.length; i++) { const x = src[i]; if (isEven(x)) s = add(s, low(x)); } return s; },
  'iter helper': () => src.values().filter(isEven).map(low).reduce(add, 0),
};
for (const [label, fn] of Object.entries(variants)) {
  const mbs = []; let result; made = 0;
  for (let run = 0; run < 5; run++) { globalThis.gc(); const before = process.memoryUsage().heapUsed; result = fn(); mbs.push(Math.round((process.memoryUsage().heapUsed - before) / 1e6)); }
  console.log(label.padEnd(11), '| arrays made per run:', made / 5, '| heap growth MB per run:', mbs.join(' '), '| result:', result);
}
```

```text
chain       | arrays made per run: 2 | heap growth MB per run: 20 20 20 20 20 | result: 255435488
one loop    | arrays made per run: 0 | heap growth MB per run: 0 0 0 0 0 | result: 255435488
iter helper | arrays made per run: 0 | heap growth MB per run: 80 80 80 80 80 | result: 255435488
```
</details>

A full pass makes n predicate calls where the first match needs i + 1 ✅[^lab]:
<details><summary><code>first.mjs</code> (run as <code>node first.mjs</code>) and its output</summary>

```js
// Predicate calls and elements allocated: answering "is there one?" or "which is first?" with a full pass.
const n = 100_000;
const items = Array.from({ length: n }, (_, i) => ({ id: i, admin: i === 10 || i % 1000 === 999 }));
let calls = 0;
const isAdmin = (u) => { calls++; return u.admin; };
const show = (label, f) => { calls = 0; const r = f(); console.log(label.padEnd(26), 'predicate calls:', String(calls).padStart(6), '| result:', r); };
show('filter(p)[0]', () => items.filter(isAdmin)[0].id);
show('find(p)', () => items.find(isAdmin).id);
show('filter(p).length > 0', () => items.filter(isAdmin).length > 0);
show('some(p)', () => items.some(isAdmin));
const text = 'error '.repeat(50_000);
console.log('match(/error/g) array length:', text.match(/error/g).length, '| test(/error/):', /error/.test(text));
```

```text
filter(p)[0]               predicate calls: 100000 | result: 10
find(p)                    predicate calls:     11 | result: 10
filter(p).length > 0       predicate calls: 100000 | result: true
some(p)                    predicate calls:     11 | result: true
match(/error/g) array length: 50000 | test(/error/): true
```
</details>

A comparator that derives keys computes 2 keys per call ✅[^lab]:
<details><summary><code>sortkey.mjs</code> (run as <code>node sortkey.mjs</code>) and its output</summary>

```js
// How often a key is computed when the comparator derives it, against computing it once per element.
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const n = 10_000;
const rows = Array.from({ length: n }, () => ({ name: 'User' + Math.floor(rnd() * 1e9) }));
let keys = 0; const key = (r) => { keys++; return r.name.toLowerCase(); }, cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
keys = 0; const s1 = rows.slice().sort((a, b) => cmp(key(a), key(b)));
console.log('key in comparator: key computations', keys, '| comparator calls', keys / 2);
keys = 0; const s2 = rows.map((r) => ({ k: key(r), r })).sort((a, b) => cmp(a.k, b.k)).map((x) => x.r);
console.log('key computed once:  key computations', keys);
console.log('same order:', s1.every((r, i) => r === s2[i]));
```

```text
key in comparator: key computations 239910 | comparator calls 119955
key computed once:  key computations 10000
same order: true
```
</details>

Spread calls (class `unbounded-input`, see "Belongs to an existing class") worked at 120,000 elements and failed at 200,000 on Node.js 24.22.1 ✅[^lab] (on Node.js 22.23.4 they failed at 120,000: "Other builds and versions"):
<details><summary><code>spreadargs.mjs</code> (run as <code>node spreadargs.mjs</code>) and its output</summary>

```js
// Does Math.max(...arr) / arr.push(...other) work at these sizes, with the default stack size?
const tryIt = (n, f) => { try { f(new Array(n).fill(1)); return 'ok'; } catch (e) { return e.constructor.name + ': ' + e.message; } };
for (const n of [10_000, 100_000, 120_000, 200_000, 1_000_000]) {
  console.log(String(n).padStart(9), '| Math.max(...arr):', tryIt(n, (a) => Math.max(...a)), '| [].push(...arr):', tryIt(n, (a) => [].push(...a)));
}
console.log('reduce over 10,000,000:', new Array(10_000_000).fill(1).reduce((m, x) => Math.max(m, x), -Infinity));
```

```text
    10000 | Math.max(...arr): ok | [].push(...arr): ok
   100000 | Math.max(...arr): ok | [].push(...arr): ok
   120000 | Math.max(...arr): ok | [].push(...arr): ok
   200000 | Math.max(...arr): RangeError: Maximum call stack size exceeded | [].push(...arr): RangeError: Maximum call stack size exceeded
  1000000 | Math.max(...arr): RangeError: Maximum call stack size exceeded | [].push(...arr): RangeError: Maximum call stack size exceeded
reduce over 10,000,000: 1
```
</details>

Microtask turns per loop and per `return` form ✅[^lab]:
<details><summary><code>hops.mjs</code> (run as <code>node hops.mjs</code>) and its output</summary>

```js
// Microtask hops: how many turns a competing microtask chain gets while each variant finishes.
async function countTicks(work) {
  let ticks = 0, done = false; const spin = () => { if (!done) { ticks++; queueMicrotask(spin); } };
  queueMicrotask(spin); await work(); done = true; return ticks;
}
const n = 1000, values = Array.from({ length: n }, (_, i) => i);
const syncAdd = (a, b) => a + b, asyncAdd = async (a, b) => a + b;
console.log('sync loop, no await           ', await countTicks(async () => { let s = 0; for (const v of values) s = syncAdd(s, v); return s; }));
console.log('await on each plain value     ', await countTicks(async () => { let s = 0; for (const v of values) s += await v; return s; }));
console.log('await asyncAdd() per element  ', await countTicks(async () => { let s = 0; for (const v of values) s = await asyncAdd(s, v); return s; }));
console.log('for await over a plain array  ', await countTicks(async () => { let s = 0; for await (const v of values) s += v; return s; }));
const p = () => Promise.resolve(1), viaReturn = async () => p(), viaReturnAwait = async () => await p();
console.log('await f(), f returns p        ', await countTicks(async () => { for (let i = 0; i < n; i++) await viaReturn(); }));
console.log('await f(), f does return await', await countTicks(async () => { for (let i = 0; i < n; i++) await viaReturnAwait(); }));
```

```text
sync loop, no await            1
await on each plain value      1001
await asyncAdd() per element   1001
for await over a plain array   2003
await f(), f returns p         3001
await f(), f does return await 2001
```
</details>

Frames captured per error object ✅[^lab]:
<details><summary><code>stack.mjs</code> (run as <code>node stack.mjs</code>) and its output</summary>

```js
// Frames captured by new Error() at call depth 200, under three Error.stackTraceLimit values.
const frames = (e) => e.stack.split('\n').filter((l) => l.trimStart().startsWith('at ')).length;
function deep(d) { return d === 0 ? new Error('x') : deep(d - 1); }
console.log('default limit:', Error.stackTraceLimit, '| frames captured:', frames(deep(200)));
Error.stackTraceLimit = Infinity; console.log('limit Infinity | frames captured:', frames(deep(200)));
Error.stackTraceLimit = 0; console.log('limit 0        | frames captured:', frames(deep(200)), '| stack:', JSON.stringify(deep(200).stack));
```

```text
default limit: 10 | frames captured: 10
limit Infinity | frames captured: 205
limit 0        | frames captured: 0 | stack: "Error: x"
```
</details>

Helpers emitted per target by TypeScript 5.9.3, and the ES2015 and ES2022 output run: microtask turns and private-field helper calls ✅[^lab]:
<details><summary><code>ts.mjs</code> (run as <code>node ts.mjs</code>) and its output</summary>

```js
// TypeScript (package mounted at /ts): helpers emitted per target for one module, then the ES2015 and ES2022
// output run: microtask turns for 1,000 awaits and private-field helper calls for 1,000 increments.
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('/ts');
const src = `
export async function total(ids: number[], load: (id: number) => Promise<number>) {
  let sum = 0; for (const id of ids) sum += await load(id); return sum;
}
export async function* pages(fetchPage: (n: number) => Promise<string[]>) {
  for (let n = 0; ; n++) { const p = await fetchPage(n); if (!p.length) return; yield* p; }
}
export const withFlag = (o: object) => ({ ...o, flag: true });
export class Counter { #n = 0; inc() { return ++this.#n; } }
`;
const emit = (target) => ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget[target], module: ts.ModuleKind.ESNext } }).outputText;
console.log('TypeScript', ts.version);
for (const target of ['ES2015', 'ES2017', 'ES2018', 'ES2022']) {
  const out = emit(target), helpers = [...new Set(out.match(/__[a-zA-Z]+(?=\s*=\s*\(this)/g) ?? [])];
  console.log(target.padEnd(7), '| emitted lines:', String(out.split('\n').length).padStart(3), '| helpers:', helpers.join(', ') || 'none');
}
async function countTicks(work) {
  let ticks = 0, done = false; const spin = () => { if (!done) { ticks++; queueMicrotask(spin); } };
  queueMicrotask(spin); await work(); done = true; return ticks;
}
for (const target of ['ES2015', 'ES2022']) {
  const calls = {};
  globalThis.__count = (name, f) => function (...a) { calls[name] = (calls[name] ?? 0) + 1; return f.apply(this, a); };
  // Wrap each private-field helper where it is defined, so every call is counted.
  const out = emit(target).replace(/var (__classPrivateField(?:Get|Set)) = ([\s\S]*?\n\};)/g, (_, name, body) => `var ${name} = globalThis.__count("${name}", ${body.slice(0, -1)});`);
  const mod = await import('data:text/javascript,' + encodeURIComponent(out));
  const ticks = await countTicks(() => mod.total(Array.from({ length: 1000 }, (_, i) => i), (id) => Promise.resolve(id)));
  const c = new mod.Counter(); for (let i = 0; i < 1000; i++) c.inc();
  console.log(target, '| microtask turns for 1000 awaits:', ticks, '| private-field helper calls for 1000 inc():', JSON.stringify(calls));
}
```

```text
TypeScript 5.9.3
ES2015  | emitted lines:  73 | helpers: __awaiter, __classPrivateFieldGet, __classPrivateFieldSet, __await, __asyncValues, __asyncDelegator, __asyncGenerator
ES2017  | emitted lines:  62 | helpers: __classPrivateFieldGet, __classPrivateFieldSet, __await, __asyncValues, __asyncDelegator, __asyncGenerator
ES2018  | emitted lines:  35 | helpers: __classPrivateFieldGet, __classPrivateFieldSet
ES2022  | emitted lines:  20 | helpers: none
ES2015 | microtask turns for 1000 awaits: 1001 | private-field helper calls for 1000 inc(): {"__classPrivateFieldGet":1000,"__classPrivateFieldSet":1000}
ES2022 | microtask turns for 1000 awaits: 1001 | private-field helper calls for 1000 inc(): {}
```
</details>

**Other builds and versions (2026-11-27).** The seven scripts above ran again, unchanged except for layout, on six more builds and in Chrome 158 (E10), once per script and build (the TypeScript script loaded a local TypeScript 5.9.3 package on macOS; E9 and E2 mounted it read-only). No script prints a time, so all ran on the emulated x64 build too.

| Id | Build | Differs from E0 |
|---|---|---|
| E0 | Node.js 24.22.1, V8 13.6.233.17, linux arm64 container, pointer compression off | baseline (the runs above) |
| E1 | Node.js 24.22.1 on macOS 26.1 arm64 | operating system |
| E2 | Node.js 24.22.1, linux x64 container emulated on arm64 | CPU architecture, emulated |
| E3 | Node.js 22.23.4, V8 12.4.254.21, macOS arm64 | older Node.js and V8 |
| E4 | Node.js 25.7.0, V8 14.1.146.11, macOS arm64 | newer Node.js and V8 |
| E7 | Electron 43.7.7 run as Node (Node.js 24.21.0 API, V8 15.0.245.31), macOS arm64 | pointer compression on, V8 sandbox on, V8 15.0 |
| E9 | Node.js 24.22.3, V8 13.6.233.17-node.63, linux x64 container emulated on arm64: the Node.js project's unofficial pointer-compression build | against E2: pointer compression on only (sandbox off) |
| E6 | Deno 2.9.8, V8 15.0.245.2, linux arm64 container, pointer compression and V8 sandbox off | narrowing run only (`sortkey.mjs`): V8 15.0 outside Electron |
| E8 | Electron 38.8.6 run as Node (Node.js 22.22.0 API, V8 14.0.365.10), macOS arm64, pointer compression and V8 sandbox on | narrowing run only (`sortkey.mjs`): another Electron build, older V8 |
| E10 | Google Chrome 158.0.8127.89, V8 15.8.62.31, macOS 26.1 arm64, headless, the script inlined in a `file://` page as a module script | Chrome itself: V8 15.8, pointer compression on, no Node.js API |

| Script (claim) | E1 | E2 | E3 | E4 | E7 | E9 | E10 |
|---|---|---|---|---|---|---|---|
| `chain.mjs` (arrays made and heap growth per variant) | same | same | same | same | differs | differs | differs (page variant) |
| `first.mjs` (predicate calls, n against i + 1) | same | same | same | same | same | same | same |
| `sortkey.mjs` (comparator calls, key computations) | same | same | same | same | differs | same | differs |
| `spreadargs.mjs` (spread works at 120,000, fails at 200,000) | same | same | differs | same | same | same | same |
| `hops.mjs` (microtask turns per loop and `return` form) | same | same | same | same | same | same | same |
| `stack.mjs` (frames per `Error.stackTraceLimit`) | same | same | same | same | same | same | differs |
| `ts.mjs` (helpers per target, turns, helper calls) | same | same | same | same | same | same | same (page variant) |

What differs:
- `chain.mjs`, E7 and E9: heap growth per run of 20 MB (chain) and 80 MB (iterator helpers) on E0 became 10 MB and 40 MB; the arrays made (2, 0, 0), the result and the order are unchanged. E9 gave 10 and 40 MB and E2 20 and 80 MB, same V8 13.6, so pointer compression is the cause ✅[^lab-matrix].
- `sortkey.mjs`, E7: 119,955 comparator calls and 239,910 key computations on E0 became 119,784 and 239,568, on the same rows (same SHA-1 of the names) and in the same order. A probe that sorted plain integers also made fewer comparator calls on E7 than on E1, E3 and E4: the sort compares differently in that build. E9 and E2 both made 119,955 calls (and 119,983 on the integer probe), so pointer compression is not the cause; E6 (Deno 2.9.8, V8 15.0, no sandbox) made 119,784 (119,803 on the probe) and E8 (Electron 38.8.6, V8 14.0) 119,955 (119,983): the count comes with the V8 version, seen on V8 15.0 in two embedders and on V8 15.8 in Chrome 158, not on V8 12.4 to 14.1 ✅[^lab-matrix].
- `spreadargs.mjs`, E3: both spread calls worked at 120,000 elements on E0; on Node.js 22.23.4 both threw `RangeError: Maximum call stack size exceeded` at 120,000 and worked at 100,000. All builds used their default stack size.

Chrome 158 (E10): `chrome --headless=new --user-data-dir=<an empty folder> --enable-precise-memory-info --js-flags="<V8 flags>" --virtual-time-budget=120000 --dump-dom file://<page>`; the page inlines the script as a module script after a small script that collects its `console.log` lines into the page, read from the dumped page. Two page variants (lines below), which gave the baseline result on E1 (`chain.mjs` keeps its Node.js call there). What Chrome 158 does differently from the baseline ✅[^lab-matrix]:
  - `chain.mjs`: heap growth 10, 0 and 40 MB per run against 20, 0 and 80, as with pointer compression on E7 and E9; arrays made and result unchanged.
  - `sortkey.mjs`: 119,784 comparator calls against 119,955, as on the V8 15.0 builds; same order.
  - `stack.mjs`: 202 frames with `Infinity` against 205: one frame sits below the 201 recursion frames in the page, four (the module loader) in Node.js; 10 and 0 unchanged.

Efficiency mode: in default headless Chrome the renderer is sometimes treated as a background process and V8 then stays in Maglev; none of these seven scripts reads a time or a tier (counts, heap growth and frames only), and `chain.mjs`, `sortkey.mjs`, `stack.mjs` gave the same output in 3 of 3 runs also with the Chrome flag `--disable-renderer-backgrounding` (10, 0 and 40 MB; 119,784 calls; 202 frames), so the figures above do not depend on it.

Could not be checked in Chrome: none.

<details><summary>Differing output (E7, E9, E3, then E6, E8 and E10)</summary>

`ELECTRON_RUN_AS_NODE=1 <Electron 43.7.7> --expose-gc --max-semi-space-size=256 --min-semi-space-size=256 chain.mjs`, the two lines that differ:
```text
chain       | arrays made per run: 2 | heap growth MB per run: 10 10 10 10 10 | result: 255435488
iter helper | arrays made per run: 0 | heap growth MB per run: 40 40 40 40 40 | result: 255435488
```
The same command on E9 (`docker run … --platform linux/amd64` with the pointer-compression build) printed these two lines unchanged; on E2 it printed E0's `20 20 20 20 20` and `80 80 80 80 80`. `sortkey.mjs` on E9 and on E2 printed E0's line `key in comparator: key computations 239910 | comparator calls 119955`.
`ELECTRON_RUN_AS_NODE=1 <Electron 43.7.7> sortkey.mjs`, the line that differs:
```text
key in comparator: key computations 239568 | comparator calls 119784
```
`<Node.js 22.23.4>/bin/node spreadargs.mjs`, lines 2 and 3:
```text
   100000 | Math.max(...arr): ok | [].push(...arr): ok
   120000 | Math.max(...arr): RangeError: Maximum call stack size exceeded | [].push(...arr): RangeError: Maximum call stack size exceeded
```
E6 is `deno run -A sortkey.mjs` in `denoland/deno:alpine-2.9.8`; E8 is `ELECTRON_RUN_AS_NODE=1 <Electron 38.8.6> sortkey.mjs`:
```text
E6:  key in comparator: key computations 239568 | comparator calls 119784
E8:  key in comparator: key computations 239910 | comparator calls 119955
E10: key in comparator: key computations 239568 | comparator calls 119784
E10, chain.mjs page variant: chain 10 10 10 10 10 | one loop 0 0 0 0 0 | iter helper 40 40 40 40 40 (MB per run)
E10, stack.mjs: limit Infinity | frames captured: 202
```
Page variants: `chain.mjs` line 13, `process.memoryUsage().heapUsed` (twice) → `performance.memory.usedJSHeapSize`, run with `--js-flags="--expose-gc --max-semi-space-size=256 --min-semi-space-size=256"`; `ts.mjs` lines 3 and 4 (`import { createRequire } …` and `const ts = …('/ts')`) → `const ts = { version: '5.9.3' }, EMITTED = { … }`, the `transpileModule` output of TypeScript 5.9.3 for the four targets, produced beforehand with the local package, and line 15 → `const emit = (target) => EMITTED[target];`.
</details>

**Calibration state (2026-11-26).** Each class of this catalog has one known-bad sample in round 3 of the review-agent calibration, and some of its "Not a problem when" rows have a trap sample. In that round (one run per arm) the agent with the skill filed all 96 planted problems of the thirteen domain catalogs under the right class id, and without the skill 86 of them. Results per catalog, and the limits of the round: [perf-reviewer-calibration.md](perf-reviewer-calibration.md) §6.5.

## Takeaways
- In a chain of array methods over a large input, count the arrays: each `map`, `filter` or `Array.from` before the last step is an array of up to n elements built to be thrown away; one loop builds none. [rule-candidate]
- When code asks "is there one?" or "which is first?", it should stop at the first match: `find`, `some`, `test`, not `filter(...)[0]` or `match(/…/g)`. [rule-candidate]
- An `await` costs a microtask turn even on a plain value: keep synchronous loops synchronous. [rule-candidate]
- A `tsconfig.json` `target` older than the runtime turns native syntax into helper calls in every file; set it to the oldest runtime the code really runs on.

## Verification status
- Verified: 69 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-27
- Matrix re-run on 2026-11-27: 7 scripts on 6 more builds, 44 runs (35, then 7 on E9 and 2 on E2 to compare): of 42 script-and-build cells 38 same, 4 differ, 0 could not run. Then 7 runs in Chrome 158 (E10; two page variants, checked on E1): 4 same, 3 differ, 0 could not run; and `sortkey.mjs` once each on E6 and E8. Totals: 49 cells, 42 same, 7 differ. Not run: Windows; native x64 hardware (E2 and E9 are emulated, and both default to `--no-turbofan` there); a pointer-compression build on arm64 other than Chrome and Electron; Firefox and Safari themselves, and this doc's own scripts on their engines (an engine-neutral cross-check of the rules on SpiderMonkey and JavaScriptCore, run on 2026-11-28, is in `../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md`); V8 versions outside 12.4 to 15.8.

## References
- Lab: `node:24.22.1-alpine` image (Node.js v24.22.1, V8 13.6.233.17-node.58, linux arm64, pointer compression off, Apple M2 under Docker), TypeScript 5.9.3 for the TypeScript script, run 2026-11-26; scripts and output in Lookup notes. Rank 1 (primary measurement). Backs: Catalog, all classes; Lookup notes. [^lab]
- Lab matrix: the seven scripts re-run on 2026-11-27 in six environments (E0 above; Node.js 24.22.1 on macOS 26.1 arm64 and on linux x64 emulated; Node.js 22.23.4 with V8 12.4.254.21; Node.js 25.7.0 with V8 14.1.146.11; Electron 43.7.7 as Node with V8 15.0.245.31 and pointer compression on), then E9 (Node.js 24.22.3, V8 13.6.233.17-node.63, linux x64 emulated, pointer compression on, sandbox off) beside E2, then E10 (Google Chrome 158.0.8127.89, V8 15.8.62.31, headless page, macOS arm64) and, for `sortkey.mjs`, E6 (Deno 2.9.8, V8 15.0.245.2) and E8 (Electron 38.8.6 as Node, V8 14.0.365.10), with a local TypeScript 5.9.3 package; table and differing output in Lookup notes. Rank 1 (primary measurement). Backs: Catalog, chained-array-passes and sort-key-recompute; Lookup notes. [^lab-matrix]
- [Stack trace API](https://v8.dev/docs/stack-trace-api) — V8, living. Rank 1. Backs: Catalog, stack-capture-per-call. [^v8-stack]
- [Errors: Error.stackTraceLimit and new Error()](https://nodejs.org/docs/latest-v24.x/api/errors.html) — Node.js, v24.22.3 docs. Rank 1. Backs: Catalog, stack-capture-per-call. [^node-errors]
- [TSConfig Reference: target](https://www.typescriptlang.org/tsconfig/target.html) — TypeScript, living. Rank 1. Backs: Catalog, ts-downlevel-emit. [^ts-target]
- [TSConfig Reference: importHelpers](https://www.typescriptlang.org/tsconfig/importHelpers.html) — TypeScript, living. Rank 1. Backs: Catalog, ts-downlevel-emit. [^ts-helpers]
- [TSConfig Reference: downlevelIteration](https://www.typescriptlang.org/tsconfig/downlevelIteration.html) — TypeScript, living. Rank 1. Backs: Catalog, ts-downlevel-emit. [^ts-downlevel]
- [TSConfig Reference](https://www.typescriptlang.org/tsconfig/) — TypeScript, living (the `target` entry). Rank 1. Backs: Lookup notes, corrections. [^ts-tsconfig]
- [TypeScript 6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) — TypeScript, 6.0. Rank 1. Backs: Lookup notes, corrections. [^ts-60]
- [Array.prototype.map()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map) — MDN, modified 2026-10-26. Rank 3. Backs: Catalog, chained-array-passes. [^mdn-map]
- [Array.prototype.filter()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter) — MDN, modified 2026-10-26. Rank 3. Backs: Catalog, chained-array-passes and full-pass-for-first. [^mdn-filter]
- [Iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator) — MDN, modified 2026-11-18. Rank 3. Backs: Catalog, chained-array-passes; Lookup notes, corrections. [^mdn-iter]
- [Iterator.prototype.map()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator/map) — MDN, modified 2026-10-26 (Baseline 2025). Rank 3. Backs: Catalog, chained-array-passes. [^mdn-itermap]
- [Array.prototype.find()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find) — MDN, modified 2026-10-26. Rank 3. Backs: Catalog, full-pass-for-first. [^mdn-find]
- [String.prototype.match()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match) — MDN, modified 2026-10-26. Rank 3. Backs: Catalog, full-pass-for-first. [^mdn-match]
- [RegExp.prototype.test()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/test) — MDN, modified 2026-10-26. Rank 3. Backs: Lookup notes, existing class. [^mdn-test]
- [Array.prototype.sort()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort) — MDN, modified 2026-10-26. Rank 3. Backs: Catalog, sort-key-recompute; Lookup notes. [^mdn-sort]
- [Function.prototype.apply()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/apply) — MDN, modified 2025-07-10. Rank 3. Backs: Lookup notes, existing classes and corrections. [^mdn-apply]
- [Math.max()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/max) — MDN, modified 2025-07-20. Rank 3. Backs: Lookup notes, existing classes. [^mdn-max]
- [await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await) — MDN, modified 2026-11-23. Rank 3. Backs: Catalog, await-per-sync-value; Lookup notes, corrections. [^mdn-await]
- [async function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function) — MDN, modified 2026-11-17. Rank 3. Backs: Catalog, await-per-sync-value. [^mdn-async]
- [for await...of](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) — MDN, modified 2026-11-17. Rank 3. Backs: Catalog, await-per-sync-value; Lookup notes. [^mdn-forawait]
- [Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) — MDN, modified 2026-10-26. Rank 3. Backs: Lookup notes, existing classes. [^mdn-mapobj]
- [Faster async functions and promises](https://v8.dev/blog/fast-async) — V8 team, 2018-11-12. Rank 4. Backs: Lookup notes, corrections. [^v8-fastasync]

## Related
- [../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) — which of the rules measured on V8 also hold on SpiderMonkey (Firefox 161) and JavaScriptCore (the macOS framework's shell, Bun, a WebKit page): 33 engine-neutral checks.
- [problem-classes.md](problem-classes.md) — the first catalog of 39 classes; several shapes found here belong to its classes.
- [perf-reviewer-calibration.md](perf-reviewer-calibration.md) — the review agent built on these catalogs, and how it scored.
- [problem-classes-language-runtimes.md](problem-classes-language-runtimes.md) — `object-shape-instability` and `copy-per-iteration`.
- [problem-classes-javascript-engine.md](problem-classes-javascript-engine.md) — code shapes that defeat V8's optimizing compilers.
- [problem-classes-nodejs-runtime.md](problem-classes-nodejs-runtime.md) — event loop, thread pool, buffers, streams and module loading.
- [../../javascript/data-types/arrays-and-iterables.md](../../javascript/data-types/arrays-and-iterables.md) — array methods, copying versus mutating, the iteration protocol.
- [../../javascript/introduction/modern-javascript-by-edition-deep-dive.md](../../javascript/introduction/modern-javascript-by-edition-deep-dive.md) — iterator helpers and other ES2025 features on Node.js 24.
- [../../javascript/async/event-loop-and-async-await.md](../../javascript/async/event-loop-and-async-await.md) — microtasks, `await` and the event loop.
- [../../javascript/error-handling/errors-and-custom-errors.md](../../javascript/error-handling/errors-and-custom-errors.md) — error objects and custom error classes.
- [../../javascript/data-types/maps-sets-and-weak-collections.md](../../javascript/data-types/maps-sets-and-weak-collections.md) — `Map` against plain objects as dictionaries.
- [../../js-runtime/private-fields.md](../../js-runtime/private-fields.md) — `#` fields downleveled to `WeakMap`s below ES2022.
- [../../js-runtime/enums-and-literal-unions.md](../../js-runtime/enums-and-literal-unions.md) — the load-time cost of a TypeScript `enum`.
- [../../js-runtime/v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) — how V8 represents objects, arrays and numbers.
