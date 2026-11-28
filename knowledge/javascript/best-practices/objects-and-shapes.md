---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24.22.1 (V8 13.6.233.17, linux arm64, pointer compression off), lab 2026-11-26", "Node.js 22.23.4 (V8 12.4), 25.7.0 (V8 14.1), Electron 38.8.6 (V8 14.0) and 43.7.7 (V8 15.0), Deno 2.9.8 (V8 15.0), Google Chrome 158.0.8127.89 (V8 15.8), lab 2026-11-27", "SpiderMonkey (Firefox 161.0) and JavaScriptCore (macOS 26.1 jsc shell, Bun 1.4.5, Playwright WebKit build 2311), lab 2026-11-28"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, v8, objects, hidden-classes, dictionary-mode, prototypes, performance]
derived-from: [js-runtime/v8-object-and-value-representation-deep-dive.md, js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: objects and shapes

## Summary
**TL;DR:** How to build, copy and change JavaScript objects so the V8 engine keeps them in its fast layout: every field created in one place and one order, no `delete` on objects that are read again, fields written by name, copies made with spread, prototypes set at creation, built-in prototypes left alone. A `delete` made 1,000,000 reads about 7 times slower on Node.js 24.22.1 ✅[^lab], and one write to `Array.prototype.constructor` made `a.slice()` roughly 40 to 70 times slower for the whole process ✅[^lab]; the "128 properties" limit holds only for some ways of building an object, and depends on the V8 version ✅[^lab-matrix].
**Use this when:** writing or reviewing code that creates many objects per request, per frame or per element of a large collection; a review comment cites "hidden classes", "dictionary mode", `delete` or a 128-property limit; code patches a built-in prototype.
**Not this doc:** one helper fed objects of many shapes, and the compiler side of field types → [functions-and-optimization.md](functions-and-optimization.md) (`JE-F1`, `JE-F3`); number fields and arrays → [numbers-and-arrays.md](numbers-and-arrays.md); `Map`, `Set`, strings, getters and `Proxy` → [strings-and-collections.md](strings-and-collections.md); how V8 lays out objects in full → [the object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md).

## Scope
Seven practices, `JE-O1` to `JE-O7`, about how objects are created, copied and changed. The numbers come from Node.js 24.22.1 (V8 13.6.233.17, linux arm64, pointer compression off) on 2026-11-26 unless a line names another build ✅[^lab]; the same scripts ran again on 2026-11-27 on Node.js 22.23.4 and 25.7.0, Electron 38.8.6 and 43.7.7, Deno 2.9.8 and Google Chrome 158.0.8127.89 (V8 15.8.62.31, macOS arm64, headless, named "Chrome 158" below) ✅[^lab-matrix]. Chrome timings used the flag `--disable-renderer-backgrounding`; without it headless Chrome sometimes runs the page in V8's efficiency mode, where code never reaches the top compiler, and those runs are given apart as "default headless" ✅[^lab-matrix]. A claim holds for V8 unless its note has an **Other engines** line: that line comes from one cross-engine lab on 2026-11-28 (one Apple M2, macOS 26.1) that timed engine-neutral versions of the rules on SpiderMonkey (Firefox 161.0, headless) and on JavaScriptCore in three hosts (the `jsc` shell of macOS 26.1, Bun 1.4.5, a Playwright WebKit page), beside V8 in Node.js 24.22.1 and Chrome 158; its ratios are of the lowest of three runs ✅[^lab-cross]. Safari itself was not run, only its engine; on SpiderMonkey and JavaScriptCore only time was observed. `JE-O4` and `JE-O7` were not checked on other engines.

How to read the "Applies" column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it). Correct and clear code comes first: a practice here chooses between two equally clear forms, and justifies a less clear one only where its "Applies" condition holds.

Terms:
- **Shape** (V8 calls it a map or hidden class): the engine's record of which properties an object has and in which order, like a printed form with each field at a fixed place. The first pointer of an object points to its map ✅[^v8-hidden].
- **Dictionary mode**: the object keeps its properties in its own self-contained dictionary (a hash table) instead of fixed slots ✅[^v8-fastprops], like a drawer of loose cards that must be searched rather than a printed form.
- **In-object slot**: a property stored inside the object itself, like a pocket sewn into a coat; further properties go to a side array ✅[^v8-fastprops].
- **Prototype**: the object another object inherits methods from, like the master copy a photocopy points back to.
- **Protector**: a process-wide flag in V8 that says "nobody changed this built-in yet", like a seal on a jar; once broken it stays broken ✅[^lab].
- **Maglev** and **TurboFan**: V8's middle and top optimizing compilers, like a quick sketch and a finished drawing of the same plan.
- **Natives check**: a V8 test function such as `%HasFastProperties(o)`, which works only under `node --allow-natives-syntax` or in a Chrome page started with `--js-flags=--allow-natives-syntax`; for experiments, never for application code, like a mechanic's diagnostic plug.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JE-O1` | Fields added after construction (`if (x) o.x = x`), or factories writing the same keys in different orders | Create every field in the constructor or one literal, in one fixed order; `undefined` for "absent" | hot path | `{x, y}` and `{y, x}` got different maps on V8 12.4 to 15.8 ✅[^lab-matrix]; 8 key orders at one read site cost 2.2 to 3.7 times one order on all three engines ✅[^lab-cross] |
| `JE-O2` | `delete obj.prop` on a record or cache entry that is read again | Assign `undefined` instead; to repair a slow object, copy it once with `{ ...obj }`; key-value data goes in a `Map` | hot path (V8, SpiderMonkey; no gain measured on JavaScriptCore) | Every `delete` of an existing property made the object slow; reads about 7 times slower (Node.js 24.22.1) ✅[^lab], 2.2 to 4.7 times in Chrome 158 ✅[^lab-matrix] |
| `JE-O3` | `for (const k of FIELDS) this[k] = src[k]` or `rec['f' + i] = …` building a record type | Write the fields by name (`this.id = s.id; …`) | hot path | `{}` became a dictionary at the 20th computed key, named stores stayed fast to 1020 (V8 12.4 to 15.8) ✅[^lab-matrix]; 30 computed keys built 7 to 50 times slower on all three engines ✅[^lab-cross] |
| `JE-O4` | `Object.assign({}, src)` or `structuredClone(src)` copies read beside the originals in one hot function | Shallow-copy with `{ ...src }`, which keeps the source's shape | hot path | Spread kept the map, `Object.assign` and `structuredClone` did not (V8 12.4 to 15.8); shapes compared, reads not timed ✅[^lab-matrix] |
| `JE-O5` | `Object.setPrototypeOf(o, p)`, `o.__proto__ = p` or `{ __proto__: p, … }` per object in a factory or deserializer | Use a `class` with `new`, or `Object.create(proto)` then assign fields | hot path | 10⁶ objects: 74.0 to 79.3 ms with `setPrototypeOf` against 2.7 to 2.9 ms with a class (Node.js 24.22.1) ✅[^lab]; slower on all three engines ✅[^lab-cross] |
| `JE-O6` | A write to `Array.prototype.constructor`, `Array.prototype[Symbol.iterator]`, `Object.prototype[0]`, or a polyfill with no feature check | Do not patch built-ins: use a helper or a subclass; polyfill only a missing feature, behind a check | always (costs on V8 and JavaScriptCore; at most 1.18 times on SpiderMonkey) | `a.slice()` 3.7 to 6.0 ms → 236.5 to 259.8 ms after the `constructor` write (Node.js 24.22.1) ✅[^lab]; MDN names backporting missing features as the one good reason to extend a built-in prototype ✅[^mdn-protochain] |
| `JE-O7` | A refactor splitting an object "because it has over 128 properties", or a hot literal of 128+ keys in browser code or on Node.js 25 | Keep named-store objects (fast to 1020 keys); `JSON.parse` output, and literals in Chrome 158 and on V8 14.1 and later, switch at 128: use a `Map` there | check build | Literals fast to 1020 keys on V8 12.4 and 13.6, dictionaries from 128 on V8 14.1, 15.0 and 15.8 ✅[^lab-matrix] |

## Lookup notes

### `JE-O1` Create every field in the constructor or in one literal, always in the same order
**Prefer:**
```js
class Row {
  constructor(id, name, email) {
    this.id = id;
    this.name = name;
    this.email = email ?? undefined; // present on every row
  }
}
```
**Avoid:**
```js
const row = { id, name };
if (email) row.email = email; // rows with and without email get two shapes
const other = { name, id };   // same keys, other order: another shape
```
**Why:** Adding a property moves the object to a new shape ✅[^v8-fastprops], so a different key order or a late key gives a different shape ✅[^lab]. Keys beyond the in-object slots (4 for an empty `{}`, the source's count for the initial `Object` map ✅[^v8-jsobjects]) go to a side array outside the object ✅[^lab]. One read site that meets several shapes is slower; the cost for a helper fed many shapes and its fix are `JE-F1` in [functions-and-optimization.md](functions-and-optimization.md).
**Evidence:** `{x, y}` and `{y, x}` got different maps; two `{x, y}` literals at different places in the code shared one map; adding a 5th and 6th key to `{}` put them in a separate `PropertyArray[3]` (Node.js 24.22.1, V8 13.6, arm64, 2026-11-26) ✅[^lab]. The map comparisons were the same on Node.js 22.23.4 (V8 12.4), 25.7.0 (V8 14.1), Electron 43 (V8 15.0) and Chrome 158 (V8 15.8) ✅[^lab-matrix].
**Other engines:** Holds on all three engines: 10⁶ reads of `o.a` from objects written in 8 key orders took 2.22 to 2.24 times one order on SpiderMonkey (Firefox 161), 2.22 to 2.41 times on JavaScriptCore (shell, Bun, WebKit page), and on V8 in the same lab 2.98 to 3.11 (Node.js 24.22.1, macOS) and 3.24 to 3.70 (Chrome 158). At 4 orders every engine was about 1.5 times slower. Shapes cannot be read on SpiderMonkey and JavaScriptCore, only the time ✅[^lab-cross].
**Exceptions:** A class with field declarations (`x = 1`) and a class that assigns the same fields in its constructor gave different maps ✅[^lab], so objects that meet at one site are best built with one form. Cold code gains nothing.
**Check it:** `node --allow-natives-syntax -e 'console.log(%HaveSameMap(makeA(), makeB()))'` with the two factories pasted in: `true` means one shape.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.3 Where properties live and §3.12 Literals, spread, `Object.assign`, classes and prototypes; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.1 `JE-F1` / `JE-O1`.

### `JE-O2` Assign `undefined` instead of using `delete` on objects that are read again
**Prefer:**
```js
session.token = undefined;           // stays fast
const clean = { ...objWithDeletes }; // repair: a spread copy is fast again
```
**Avoid:**
```js
delete session.token; // the whole object switches to dictionary mode
```
**Why:** In V8 13.6, deleting any existing property switches the object to dictionary mode, and reads then search a hash table; reading it again or adding properties does not bring it back ✅[^lab].
**Evidence:** Every `delete` of an existing property made `%HasFastProperties` false: the last-added or the first property, objects of 1 to 1000 properties, class instances, and inside a TurboFan-optimized function; `o.b = undefined` stayed fast. 1,000,000 reads of `o.a` took 0.52 ms on a fast object and 3.94 ms after a `delete`, one timed run, about 7 times (Node.js 24.22.1, V8 13.6, arm64) ✅[^lab]. About 7 times also on macOS arm64 and on Node.js 22.23.4 (Node.js 22.23.4 and 25.7.0 together gave 0.5 to 0.8 ms against 4.2 to 5.3 ms), about 9 on Node.js 25.7.0 (V8 14.1) and Electron 38.8.6 (V8 14.0), about 2.5 and 2.3 to 3.2 times on Electron 43 and Deno 2.9.8 (V8 15.0), so the smaller gap comes with V8 15.0. Chrome 158 (V8 15.8): 1.3 to 1.4 ms against 0.3 to 0.6 ms, about 2.2 to 4.7 times over six runs; default headless runs that stayed in Maglev took 2.4 to 2.7 ms both ways; every `delete` case gave the baseline answers ✅[^lab-matrix]. The gap is smaller in Chrome but still there. V8 up to 11.9 had a fast path for deleting the last-added property ✅[^v8-delete-old]; it is absent from 12.0 on ✅[^v8-delete-new].
**Other engines:** Holds on V8 and SpiderMonkey, no effect on JavaScriptCore: reads after `delete o.b` took 2.02 to 2.21 times untouched reads on SpiderMonkey (Firefox 161), 1.00 times on JavaScriptCore (shell, Bun, WebKit page), and on V8 in the same lab 4.22 to 4.30 (Node.js 24.22.1, macOS) and 1.78 to 1.98 (Chrome 158). `o.b = undefined` cost nothing on any engine (0.89 to 1.00 times) ✅[^lab-cross], so the practice never costs and pays in Chrome, Node.js and Firefox.
**Exceptions:** `delete o.missing` (a property the object does not have) left it fast; `{ ...slow }`, `Object.assign({}, slow)` or using the object as a prototype made it fast again ✅[^lab]. A true key-value store belongs in a `Map` (`JE-S1` in [strings-and-collections.md](strings-and-collections.md)).
**Check it:** `node --allow-natives-syntax -e 'const o = build(); delete o.x; console.log(%HasFastProperties(o))'` prints `false` for a slow object; the same native answers in a Chrome page started with `--js-flags=--allow-natives-syntax`.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.4 Fast and dictionary mode and §6.1 Corrections; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.2 `JE-O2`.

### `JE-O3` Write record fields by name, not with computed keys in a loop
Applies to records of 20 or more computed-key fields, built per request or per element.
**Prefer:**
```js
class Order {
  constructor(s) { this.id = s.id; this.total = s.total; this.status = s.status; /* … */ }
}
```
**Avoid:**
```js
class Order {
  constructor(s) { for (const k of FIELDS) this[k] = s[k]; } // 30 fields: dictionary mode
}
```
**Why:** Stores with computed keys switch an object to dictionary mode after a small number of keys; stores written by name stay fast far longer ✅[^lab].
**Evidence:** A constructor writing 30 fields with `this['f' + i]` gave instances in dictionary mode with 0 in-object slots. Computed keys made `{}` slow at the 20th key, an empty-class instance at the 26th, and a literal of 1 to 10 keys after 16 more keys; named stores stayed fast up to 1020 properties (Node.js 24.22.1, V8 13.6, arm64) ✅[^lab]. The thresholds were the same on V8 12.4, 14.1, 15.0 and Chrome 158 (V8 15.8) ✅[^lab-matrix].
**Other engines:** Holds on all three engines for building: 10⁴ records of 30 computed keys took 45 to 50 times a literal to build on SpiderMonkey (Firefox 161), 7.2 to 10.1 times on JavaScriptCore (shell, Bun, WebKit page), and on V8 in the same lab 31 to 33 (Node.js 24.22.1, macOS) and 44 to 46 (Chrome 158). Named assignments built them in 2.3 to 2.6 times the literal on SpiderMonkey, 0.93 to 1.08 on JavaScriptCore and 4.3 to 4.6 on V8. Reading a finished computed-key record was slower only on V8 (4.29 to 4.49 times in Node.js, 1.83 to 2.08 in Chrome; 0.89 to 1.07 on the other two) ✅[^lab-cross].
**Exceptions:** `Reflect.set` behaved like computed keys (slow at 20); `Object.defineProperty` data properties stayed fast to 1020 ✅[^lab]. When the keys are data rather than a fixed field list, a `Map` fits (`JE-S1` in [strings-and-collections.md](strings-and-collections.md)).
**Check it:** `node --allow-natives-syntax -e 'console.log(%HasFastProperties(new Order(sample)))'`
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.3 Where properties live and §3.4 Fast and dictionary mode; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.3 `JE-O3`.

### `JE-O4` Copy an object with spread when the copy meets the original at one site
**Prefer:**
```js
const copy = { ...src }; // same shape as src
```
**Avoid:**
```js
const copy = Object.assign({}, src); // a different shape from src
```
**Why:** A spread copy took the source's shape; `Object.assign` and `structuredClone` copies did not, so a site reading both sees two shapes ✅[^lab] (the cost of many shapes at one site: `JE-F1` in [functions-and-optimization.md](functions-and-optimization.md)).
**Evidence:** `%HaveSameMap({ ...src }, src)` was `true`; for `Object.assign({}, src)` and `structuredClone(src)` it was `false`; `JSON.parse(JSON.stringify(src))` (JSON: JavaScript Object Notation) was `true`; `{ ...src, z: 3 }` did not share the map of a `{ x, y, z }` literal (Node.js 24.22.1, V8 13.6, arm64) ✅[^lab]. Same on V8 12.4, 14.1, 15.0 and Chrome 158 ✅[^lab-matrix]. Only map identity was compared: no read of a copy was timed, so the speed benefit is inferred from the shape-count cost in `JE-F1`, which timed 1, 4 and 8 shapes, not 2.
**Exceptions:** Copies that never meet the originals at one site; deep copies, where spread is not a substitute for `structuredClone`.
**Check it:** `node --allow-natives-syntax -e 'const s = sample(); console.log(%HaveSameMap(copy(s), s))'`
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.12 Literals, spread, `Object.assign`, classes and prototypes.

### `JE-O5` Use a class or `Object.create(proto)`, not a prototype set on each object
Applies to objects built per element, per request or per row revived from `JSON.parse`.
**Prefer:**
```js
class Point { constructor(x) { this.x = x; } getX() { return this.x; } }
const pts = rows.map((r) => new Point(r.x));   // or: Object.assign(Object.create(proto), r)
```
**Avoid:**
```js
const pts = rows.map((r) => Object.setPrototypeOf({ x: r.x }, proto));
```
**Why:** MDN calls changing an object's `[[Prototype]]` a very slow operation in every engine and advises `Object.create()` instead ✅[^mdn-setproto]; a class or `Object.create` allocates with the prototype already in place.
**Evidence:** Building 10⁶ objects took 74.0 to 79.3 ms with `setPrototypeOf`, 66.6 to 75.6 ms with a `__proto__` literal, 2.7 to 2.9 ms with a class and 3.4 to 4.1 ms with `Object.create` (Node.js 24.22.1, V8 13.6, arm64): the `__proto__` literal 16 to 22 times `Object.create` ✅[^lab]. Chrome 158: 40 to 42 times (three runs; 8 to 41 in default headless, tier not read), but `Object.create` took only 1.4 to 1.5 ms, a few steps of the page's 0.1 ms timer, so the Chrome ratio is loose; the order held in every run. On V8 12.4 the literal took 24.8 to 27.4 ms, 3.3 to 3.8 times `Object.create` ✅[^lab-matrix]. MDN says the `__proto__` literal is optimized and can even beat `Object.create` ✅[^mdn-protochain]; that did not hold in this test, which covers one shape only ✅[^lab]. Later reads were not timed there.
**Other engines:** Holds on all three engines: creating 10⁵ objects with `Object.setPrototypeOf` took 3.5 to 4.5 times a class on SpiderMonkey (Firefox 161) and the `__proto__` literal 2.0 to 2.4; on JavaScriptCore (shell, Bun, WebKit page) 4.7 to 7.4 and 3.4 to 5.4 times; on V8 in the same lab 14.5 to 17.4 (Node.js 24.22.1, macOS) and 33 to 36 (Chrome 158) for `setPrototypeOf`. `Object.create` took 0.58 to 0.70 times the class on SpiderMonkey and 1.08 to 1.63 on JavaScriptCore. Reading the finished objects through a method cost the same for every way on every engine, V8 included (0.96 to 1.04 times) ✅[^lab-cross].
**Exceptions:** A prototype set a few times at start-up, or objects revived once per process.
**Check it:** A CPU profile of the creation loop shows no prototype-setting runtime frames after the fix.
**Full lab:** [engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md), Catalog, class `prototype-set-per-object`, and Lookup notes, corrections; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.4 `JE-O5`.

### `JE-O6` Never write to a built-in prototype
A helper or subclass is as clear, and the writes measured slowed array built-ins for the whole process on V8 and JavaScriptCore.
**Prefer:**
```js
const last = (a) => a[a.length - 1];                  // a helper
if (!Array.prototype.findLast) { /* polyfill only what is missing */ }
```
**Avoid:**
```js
Array.prototype.constructor = Array;      // even the same value: a.slice() slows down
Array.prototype[Symbol.iterator] = function () { /* wrapper */ };
Object.prototype[0] = 'x';                // a.map(f) slows down (a.slice() too on V8 13.6)
```
**Why:** V8 keeps protectors for built-ins. A write of one of the measured kinds flipped one for good, and every later call of the affected built-ins took a slower path ✅[^lab].
**Evidence:** Writing `Array.prototype.constructor` (even the same value) made `a.slice()` go from 3.7 to 6.0 ms up to 236.5 to 259.8 ms, roughly 40 to 70 times; patching the array iterator made `[...a]` go from 4.0 to 4.7 ms up to 159.0 to 166.6 ms; `Object.prototype[0] = …` made `a.map(f)` go from 59.4 to 70.8 ms up to 590 to 959 ms (10,000 elements, 1,000 calls, four runs, Node.js 24.22.1, V8 13.6, arm64) ✅[^lab]. `a.map(f)` slowed on every build; the `Object.prototype[0]` effect on `a.slice()` was seen on V8 13.6 only. Chrome 158, three runs: `Object.prototype[0] = 'x'` left `a.slice()` at 0.6 to 0.7 ms (0.9 to 1.0 ms unpatched) but took `a.map(f)` from 62.6 to 65.6 ms to 493.8 to 518.8 ms, about 8 times; the species patch took `a.slice()` from 0.9 to 1.0 ms to 221.3 to 237.3 ms (0.9 to 1.3 ms to 227 to 250 ms in runs with the renderer not backgrounded); the iterator patch took `[...a]` to 159.0 to 167.5 ms (1.2 ms unpatched, default headless) ✅[^lab-matrix].
**Other engines:** Holds on V8 and JavaScriptCore, weak on SpiderMonkey: with 10⁴ elements, each write in its own process against a control process, no write changed `a.slice()`, `a.map(f)` or `[...a]` by more than 1.18 times on SpiderMonkey (Firefox 161: 45 ratios over five runs, 17 of them 0.97 to 1.02, range 0.70 to 1.18; the `Object.prototype[0]` write left `a.slice()` at 1.04 to 1.12 times its control in all five runs). On JavaScriptCore (shell, Bun, WebKit page) `a.slice()` became 6.9 to 11.3 times slower after the `constructor` or the `Object.prototype[0]` write (Bun 6.9 to 10.9, whose ratios swung), and `[...a]` 1.6 to 6.2 times after the iterator or the `Object.prototype[0]` write (4.2 to 4.9 in the shell and the page), while `a.map(f)` became 1.3 to 2.0 times faster after `Object.prototype[0]` in the shell, the page and four of five Bun runs (once 1.3 times slower). V8 in the same lab: worst case 242 to 244 times (Node.js 24.22.1, macOS) and 205 to 217 (Chrome 158) ✅[^lab-cross].
**Exceptions:** A polyfill for a feature the engine lacks, loaded only on such engines, is the case MDN accepts ✅[^mdn-protochain]. Adding a new, non-numeric method name to a built-in prototype was not measured.
**Check it:** In a test that loads the whole app, `%ArraySpeciesProtector()`, `%ArrayIteratorProtector()` and `%NoElementsProtector()` under `node --allow-natives-syntax` all print `true` ✅[^lab]; in a Chrome page with `--js-flags=--allow-natives-syntax` too: Chrome 158 printed `false` for `%NoElementsProtector()` after the `Object.prototype[0]` patch ✅[^lab-matrix].
**Full lab:** [engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md), Catalog, class `builtin-prototype-patching`; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.5 `JE-O6`.

### `JE-O7` Objects need no split for a "128 properties" limit; it holds for `JSON.parse` output, and for object literals in Chrome and on V8 14.1 and later
Object literals switch at 128 keys in Chrome 158 and on V8 14.1 and 15.0, at 1,021 keys on V8 12.4 and 13.6 (Node.js 22 and 24).
**Keep writing:** objects built by named stores or `Object.fromEntries`, whatever their size up to 1020 keys, on every build run. For a literal of 128+ keys read on a hot path in browser code (Chrome 158 measured) or on Node.js 25, a `Map` built once (`JE-S1` in [strings-and-collections.md](strings-and-collections.md)) or an object built with `Object.fromEntries` stays fast.
**Why:** The point where an object becomes a dictionary depends on how it was built and on the V8 version, not on one fixed count ✅[^lab-matrix].
**Evidence:** `JSON.parse` output was a dictionary from 128 keys; named stores and `Object.fromEntries` stayed fast up to 1020 keys, on V8 12.4, 13.6, 14.1 and 15.0. Object literals stayed fast up to 1020 keys on V8 12.4 and 13.6 (Node.js 22.23.4, 24.22.1) but were dictionaries from 128 keys on V8 14.1 (Node.js 25.7.0) and V8 15.0 (Electron 43); Node.js 25 has pointer compression off, so the change came with V8, not compression. Chrome 158 (V8 15.8): object literals were dictionaries from 128 keys; `JSON.parse`, named stores, `Object.fromEntries` and computed keys gave the baseline counts ✅[^lab-matrix]. So for a browser developer the 128-key literal is the normal case today. A dictionary read in Chrome 158 cost about 2.2 to 4.7 times a fast read (`JE-O2`).
**Exceptions:** Computed-key stores switch much earlier (`JE-O3`). A large literal read a few times, or only at start-up, gains nothing from a change.
**Check it:** `node -p process.versions.v8`, then `node --allow-natives-syntax -e 'console.log(%HasFastProperties(require("./table.js")))'` on the build that ships; in Chrome, `%HasFastProperties(table)` in a page started with `--js-flags=--allow-natives-syntax`.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.4 Fast and dictionary mode, §6.1 Corrections and §6.3 Other builds and versions.

## Takeaways
- Build each kind of record in one place with every field present, in one order; a late or reordered key is a new shape ✅[^lab]. [rule-candidate]
- `obj.x = undefined` costs nothing on any engine measured, while `delete` turned objects slow on V8 and SpiderMonkey ✅[^lab-cross].
- A spread copy keeps the source's shape; `Object.assign({}, x)` and `structuredClone` do not ✅[^lab].
- Setting a prototype per object was the slowest way to build objects on all three engines; a class or `Object.create` was fast ✅[^lab-cross].
- One write to a built-in prototype can slow array built-ins for the whole process on V8 and JavaScriptCore ✅[^lab-cross].
- There is no single "128 properties" limit: it depends on how the object was built and on the V8 version ✅[^lab-matrix].

## Verification status
- Verified: 67 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab: Node.js 24.22.1 (V8 13.6.233.17-node.58), image `node:24.22.1-alpine`, linux arm64, pointer compression off, Apple M2 under Docker, `--network none`, 2026-11-26; scripts, commands and outputs in [the object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §3 and §6, and in [the engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md), Catalog. Rank 1 (primary measurement). Backs: Summary, Scope, Catalog, Lookup notes, Takeaways. [^lab]
- Lab matrix: the same scripts re-run on 2026-11-27 on Node.js 24.22.1 (macOS arm64; linux x64 emulated), Node.js 22.23.4 (V8 12.4.254.21), Node.js 25.7.0 (V8 14.1.146.11), Electron 43.7.7 as Node (V8 15.0.245.31, pointer compression on), the Node.js 24.22.3 pointer-compression build (V8 13.6, linux x64 emulated), Deno 2.9.8 (V8 15.0.245.2), Electron 38.8.6 as Node (V8 14.0.365.10) and Google Chrome 158.0.8127.89 (V8 15.8.62.31, macOS arm64, headless page); outputs in §6.3 of [the object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md) and in the Lookup notes of [the engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md). Rank 1 (primary measurement). Backs: Summary, Scope, Catalog, Lookup notes, Takeaways. [^lab-matrix]
- Lab cross-engine: engine-neutral scripts run three times each on 2026-11-28 on one Apple M2 with macOS 26.1: V8 in Node.js 24.22.1 (macOS arm64) and Google Chrome 158.0.8127.89 (a visible window), SpiderMonkey in Firefox 161.0 (headless), JavaScriptCore in the `jsc` shell of the macOS 26.1 framework (21622.2.11.11.9), Bun 1.4.5 and a Playwright WebKit build 2311 page; scripts and outputs in §4.1 to §4.5 of [the cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md). Rank 1 (primary measurement). Backs: Scope, Catalog, Lookup notes (Other engines), Takeaways. [^lab-cross]
- [Maps (Hidden Classes) in V8](https://v8.dev/docs/hidden-classes) — V8 team, living. Rank 1. Backs: Scope, terms (an object's first pointer is its map). [^v8-hidden]
- [V8 source: src/objects/js-objects.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/js-objects.h) — V8 project, 2025. Rank 1. Backs: Lookup notes, `JE-O1` (4 unused fields of the initial Object map). [^v8-jsobjects]
- [V8 source: src/runtime/runtime-object.cc at 11.3.244.8](https://github.com/v8/v8/blob/11.3.244.8/src/runtime/runtime-object.cc) — V8 project, 2023. Rank 1. Backs: Lookup notes, `JE-O2` (the old delete-last-property fast path). [^v8-delete-old]
- [V8 source: src/runtime/runtime-object.cc at 12.2.281.27](https://github.com/v8/v8/blob/12.2.281.27/src/runtime/runtime-object.cc) and [at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/runtime/runtime-object.cc) — V8 project, 2023 to 2025. Rank 1. Backs: Lookup notes, `JE-O2` (no `DeleteObjectPropertyFast` from 12.0 on). [^v8-delete-new]
- [Object.setPrototypeOf()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/setPrototypeOf) — MDN, living. Rank 3. Backs: Lookup notes, `JE-O5`. [^mdn-setproto]
- [Inheritance and the prototype chain](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Inheritance_and_the_prototype_chain) — MDN, living. Rank 3. Backs: Catalog, `JE-O6`; Lookup notes, `JE-O5` and `JE-O6`. [^mdn-protochain]
- [Fast properties in V8](https://v8.dev/blog/fast-properties) — V8 team (Camillo Bruni), 2017-08-30. Rank 4. Backs: Scope, terms; Lookup notes, `JE-O1`. [^v8-fastprops]

## Related
- [numbers-and-arrays.md](numbers-and-arrays.md) — number fields, elements kinds and pointer compression (`JE-N1` to `JE-N11`).
- [strings-and-collections.md](strings-and-collections.md) — `Map`, `Set`, strings, getters and `Proxy` (`JE-S1` to `JE-S9`).
- [functions-and-optimization.md](functions-and-optimization.md) — call sites fed many shapes (`JE-F1`) and the compiler side (`JE-F` rules).
- [measuring-performance.md](measuring-performance.md) — how to benchmark before claiming a speed-up (`JE-M` rules).
- [../../js-runtime/v8-hidden-classes.md](../../js-runtime/v8-hidden-classes.md) — shapes, transitions and inline caches, explained as a concept.
- [../../js-runtime/v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) — how V8 stores objects, with every script and output.
- [../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) — the same rules timed on SpiderMonkey and JavaScriptCore.
- [../../performance/code-review/problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md) — the review catalog with `prototype-set-per-object` and `builtin-prototype-patching`.
- [../../performance/code-review/problem-classes-language-runtimes.md](../../performance/code-review/problem-classes-language-runtimes.md) — the `object-shape-instability` class.
