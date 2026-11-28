---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24.22.1 (V8 13.6.233.17, linux arm64, pointer compression off), lab 2026-11-26", "Node.js 22.23.4 (V8 12.4), 25.7.0 (V8 14.1), the Node.js 24.22.3 pointer-compression build (V8 13.6), Electron 43.7.7 (V8 15.0), Google Chrome 158.0.8127.89 (V8 15.8), lab 2026-11-27", "SpiderMonkey (Firefox 161.0) and JavaScriptCore (macOS 26.1 jsc shell, Bun 1.4.5, Playwright WebKit build 2311), lab 2026-11-28"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, v8, strings, map, set, typed-arrays, proxy, getters]
derived-from: [js-runtime/v8-object-and-value-representation-deep-dive.md, js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: strings, collections, typed arrays and proxies

## Summary
**TL;DR:** How V8 stores strings, `Map` and `Set`, typed arrays, getters and `Proxy` objects, and which code forms cost memory or time. A `Map` took 36.7 bytes per string-keyed entry against 62.9 for an object used as a table on Node.js 24.22.1 ✅[^lab], but more than the object on JavaScriptCore ✅[^lab-cross] and in the SpiderMonkey shell ✅[^lab-sm]; `s += part` stayed linear when the string was read only after the loop, and became quadratic on V8 and JavaScriptCore when it was read inside the loop ✅[^lab-cross]. A getter in an object literal read 9 to 34 times slower than a field on V8 and at most 1.44 times elsewhere ✅[^lab-cross].
**Use this when:** writing or reviewing lookup tables with run-time keys, numeric-id tables, string building in loops, text normalization done "for memory", proxies (Vue `reactive()`, wrappers) read in loops, getters in literals or classes, or millions of integers in an array; a memory check reads only `heapUsed`.
**Not this doc:** object shapes and dictionary mode from `delete` or computed keys → [objects-and-shapes.md](objects-and-shapes.md); number fields, elements kinds and pointer compression → [numbers-and-arrays.md](numbers-and-arrays.md); a small slice that keeps a big string alive → [memory-and-garbage-collection.md](memory-and-garbage-collection.md) (`JL-G3`); what each `process.memoryUsage()` field counts → [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md) (`JN-H3`); the mechanisms in full → [the object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md).

## Scope
Nine practices, `JE-S1` to `JE-S9`: lookup tables (`JE-S1`, `JE-S2`), strings (`JE-S3` to `JE-S5`), proxies and accessors (`JE-S6` to `JE-S8`) and typed arrays (`JE-S9`). The numbers come from Node.js 24.22.1 (V8 13.6.233.17, linux arm64, pointer compression off) on 2026-11-26 unless a line names another build ✅[^lab]. The 2026-11-27 re-run covered Node.js 22.23.4 and 25.7.0, Electron 43.7.7, the Node.js 24.22.3 pointer-compression build and Google Chrome 158.0.8127.89 (V8 15.8.62.31, macOS arm64, headless, pointer compression on, named "Chrome 158" below) ✅[^lab-matrix]. Chrome timings used `--disable-renderer-backgrounding`; without it headless Chrome sometimes keeps code in Maglev, and those runs are given apart as "default headless". Chrome's `performance.now()` steps by about 0.1 ms (milliseconds), so its sub-millisecond figures are coarse ✅[^lab-matrix]. A claim holds for V8 unless its note has an **Other engines** line, from one cross-engine lab on 2026-11-28 (one Apple M2, macOS 26.1) on SpiderMonkey (Firefox 161.0, headless) and JavaScriptCore (the macOS 26.1 `jsc` shell, Bun 1.4.5, a Playwright WebKit page), beside V8 in Node.js 24.22.1 and Chrome 158; timing ratios there are of the lowest of three runs, bytes are heap growth after a forced full collection ✅[^lab-cross]. Bytes could not be measured in the Firefox page or the WebKit page, which have no forced collection and no heap figure; SpiderMonkey's bytes come from Mozilla's JavaScript shell for Firefox 161.0 (a Linux arm64 container on the same machine, 2026-11-28), which has both ✅[^lab-sm]. `JE-S5` was not checked on other engines.

How to read the "Applies" column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it). Correct and clear code comes first: a practice chooses between two equally clear forms.

Terms:
- **Dictionary mode**: a plain object keeps its properties in its own self-contained dictionary (a hash table) instead of fixed slots ✅[^v8-fastprops], like a drawer of loose cards instead of a printed form.
- **Elements**: the numbered properties of an object or array, kept apart from the named ones ✅[^v8-fastprops], like a numbered rack beside a labelled shelf.
- **Rope** (V8: cons string): a string made by `+` that only points at its two halves ✅[^v8-string], like two notes taped together; **flattening** copies it into one piece.
- **Sliced string**: a substring that points into its parent ✅[^v8-string], like a bookmark rather than a photocopy.
- **One-byte / two-byte string**: a string stored in 1 byte per character when every character code is 255 or less, in 2 bytes otherwise ✅[^v8-string], like writing in plain letters or in a script that needs wider cells.
- **Proxy**: an object that sends operations such as property reads to handler functions called traps ✅[^mdn-proxy], like a receptionist who takes every request before passing it on.
- **Typed array**: a fixed-length view of raw numbers of one type over an `ArrayBuffer`, like a tray of identical egg cups.
- **Maglev** and **TurboFan**: V8's middle and top optimizing compilers, like a quick sketch and a finished drawing of the same plan.
- **Natives check**: a V8 test function such as `%HasFastProperties(o)`, usable only under `node --allow-natives-syntax` or in a Chrome page started with `--js-flags=--allow-natives-syntax`, for experiments only; `%DebugPrint` output cannot be read from a headless page.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JE-S1` | `const t = {}` then `t[key] = …` with run-time keys, `Object.create(null)` tables, or a 128+-key `JSON.parse` table | Use a `Map` (or a `Set` when there is no value); keep objects for records with fixed fields | large data (the memory saving is V8's; more bytes on JavaScriptCore and in the SpiderMonkey shell) | 100,000 string keys: dictionary object 62.9, `Map` 36.7, `Set` 26.2 bytes per entry (Node.js 24.22.1) ✅[^lab]; `Map` 53.6 to 69.8 against object 38.1 on JavaScriptCore ✅[^lab-cross]; `Map` 84.7 to 84.8 against object 27.3 in the SpiderMonkey shell ✅[^lab-sm] |
| `JE-S2` | A `Map` keyed by dense numeric ids `0 … n-1` | Use an array indexed by id; keep the `Map` for sparse ids | large data | 9.3 bytes per entry as elements against 36.7 in a `Map` (Node.js 24.22.1) ✅[^lab]; 4.6 against 18.4 in Chrome 158 ✅[^lab-matrix] |
| `JE-S3` | A refactor replacing `s += part` in a loop "because concatenation is quadratic" | Keep `+=` when the string is read only after the loop | no gain | Cost per character stayed flat from 100,000 to 1,600,000 characters on all three engines ✅[^lab-cross] |
| `JE-S4` | `s += x` followed in the same loop by `s.charCodeAt(…)`, `s[i]`, `s.length`-based slicing, `s.includes(…)` or a comparison of `s` | Read the new piece (`x`), not the growing string, inside the loop; read `s` after the loop | hot path (quadratic on V8 and JavaScriptCore; linear on SpiderMonkey) | 154 to 935 ns per character from 5,000 to 40,000 characters, doubling with the length (Node.js 24.22.1) ✅[^lab] |
| `JE-S5` | Code or advice stripping accents (`é`, `ü`) "because they make strings two-byte" | Keep the text: characters up to U+00FF stay 1 byte | no gain | `"café"` and `ÿ` (U+00FF) one-byte, `Ā` (U+0100) two-byte; 1.0 and 2.0 bytes per character (Node.js 24.22.1) ✅[^lab], the same in Chrome 158 ✅[^lab-matrix] |
| `JE-S6` | A `Proxy` (Vue `reactive()`, a validation or logging wrapper) read inside a loop over many elements | Unwrap once (`toRaw()` in Vue, or keep the target) and read the raw object in the loop | hot path | 10⁶ reads: 0.54 ms plain, 9.55 ms through a proxy with no traps, 15.45 ms with a `get` trap (Node.js 24.22.1) ✅[^lab]; 2.0 to 14.7 times on all three engines ✅[^lab-cross] |
| `JE-S7` | `{ get v() { … } }` in an object literal or factory, or `defineProperty` turning a data field into a getter | Put getters and setters on a class (or add one with `Object.defineProperty`) | hot path (mostly V8) | Literal getters read 9 to 34 times a field on V8, at most 1.44 times on SpiderMonkey and JavaScriptCore ✅[^lab-cross] |
| `JE-S8` | A refactor turning a class `get total()` into a stored field "because getters are slow" | Keep the class getter | check build | Field-like on V8 12.4 and 13.6 ✅[^lab-matrix], Firefox 161 and JavaScriptCore (1.00 in Chrome 158's cross-engine run) ✅[^lab-cross]; 1.7 times on V8 14.1 ✅[^lab-matrix] |
| `JE-S9` | Millions of 32-bit integers in a plain array, or a memory check reading only `heapUsed` | Use `Int32Array` (4 bytes each); count it in `arrayBuffers` (Node.js), `external` (Electron) or `usedJSHeapSize` (Chrome 158) | large data | `Int32Array` 4.0 bytes per element in `arrayBuffers`, a small-integer array 8.0 in `heapUsed` (Node.js 24.22.1) ✅[^lab] |

## Lookup notes

### `JE-S1` Use a `Map` or `Set` for a lookup table with run-time string keys
Measured at 100,000 keys.
**Prefer:**
```js
const byId = new Map();
for (const u of users) byId.set(u.id, u);
const seen = new Set(ids); // when there is no value to keep
```
**Avoid:**
```js
const byId = {};
for (const u of users) byId['id' + u.id] = u; // dictionary mode after about 20 keys
```
**Why:** In V8, an object filled with computed keys becomes a hash table anyway, and that table costs more per entry than a `Map`'s ✅[^lab]. `Map` and `Set` are built on an ordered hash table that keeps insertion order and compares keys with SameValueZero ✅[^v8-ordered]; a `Map` never changes mode, an object used as a dictionary does ✅[^lab].
**Evidence:** Bytes per entry with 100,000 string keys, as heap growth across forced collections: object in dictionary mode 62.9, `Map` 36.7, `Set` 26.2 (Node.js 24.22.1, V8 13.6, linux arm64; on emulated linux x64 the object was 63.0 and the others the same). `{}` was in dictionary mode from the 20th computed key, `JSON.parse` output from 128 keys, `Object.create(null)` from the start ✅[^lab]. Node.js 22.23.4 and 25.7.0 gave the same values within 0.1 byte. With pointer compression on (Electron 43; the Node.js 24.22.3 pointer-compression build) and in Chrome 158: 31.5, 18.4 and 13.1, about half, in the same order ✅[^lab-matrix]. Lookup speed of a `Map` against a dictionary-mode object was not timed.
**Other engines:** The memory saving does not hold on JavaScriptCore or in the SpiderMonkey shell: there (shell, Bun) a `Map` entry with a string key took 69.7 to 69.8 bytes (shell) and 53.6 to 54.0 (Bun) at 100,000 entries, and an object used as a table 38.1, so the `Map` cost more memory, not less (its figure moved by a factor of 2 with the entry count); V8 in the same lab: `Map` 36.7 against object 62.9 (Node.js 24.22.1, macOS), 18.4 against 31.5 (Chrome 158) ✅[^lab-cross]. In the SpiderMonkey shell (Firefox 161's engine, Linux) a `Map` entry with a string key took 84.7 to 84.8 bytes and an object used as a table 27.3, so the `Map` cost more there too ✅[^lab-sm]. Not measured in the Firefox page or in the WebKit page. A `Map` is the choice for its behaviour on every engine; a memory saving holds only on V8.
**Exceptions:** Records with a fixed set of fields stay objects (`JE-O1` in [objects-and-shapes.md](objects-and-shapes.md)). Dense integer keys from 0: `JE-S2`.
**Check it:** `node --expose-gc -e 'gc(); const b = process.memoryUsage().heapUsed; const t = build(); gc(); console.log((process.memoryUsage().heapUsed - b) / N)'` for both forms; in Chrome, `performance.memory.usedJSHeapSize` after `gc()` (Chrome flags `--enable-precise-memory-info --js-flags=--expose-gc`).
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.11 `Map` and `Set` against plain objects and §4.1 Bytes per element; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.10 bytes per element and §5.3.

### `JE-S2` Keep dense integer keys from 0 in an array, not in a `Map`
Measured at 100,000 keys.
**Prefer:**
```js
const scoreById = new Array(n).fill(0); // ids 0 … n-1
scoreById[id] = score;
```
**Avoid:**
```js
const scoreById = new Map(); scoreById.set(id, score); // 36.7 bytes per entry against 8.0 (array); 18.4 against 4.0 in Chrome
```
**Why:** Named properties and elements are stored separately ✅[^v8-fastprops], and integer keys from `"0"` to `"4294967294"` go to the elements, a plain row of slots, not to hash-table entries ✅[^lab].
**Evidence:** Integer keys 0 to 99,999: object (elements) 9.3 bytes per entry, `Map` 36.7 to 36.8; a filled small-integer array 8.0 bytes per element (Node.js 24.22.1, V8 13.6, arm64). `"01"`, `"-1"`, `"1.5"` and `"4294967295"` are ordinary named keys; `o["4294967294"]` switched the elements to a hash table ✅[^lab]. Electron 43 and Chrome 158: 4.6 against 18.4, and a small-integer array 4.0 ✅[^lab-matrix].
**Other engines:** Same direction: on JavaScriptCore (shell, Bun) a small-integer array took 8.0 bytes per element and a `Map` entry with an integer key and value 84.0 (shell; 125.9 in one run) and 68.2 (Bun) at 10⁵ entries, a wider gap than V8's 8.0 against 36.8 (Node.js 24.22.1, macOS) and 4.0 against 18.4 (Chrome 158) ✅[^lab-cross]. In the SpiderMonkey shell a small-integer array took 8.4 bytes per element and a `Map` entry with integer key and value 52.7 ✅[^lab-sm]. Not measured in the Firefox page or in the WebKit page.
**Exceptions:** Sparse ids: a write 1024 or more slots past the end switches an array to hash-table elements (`JE-N7` in [numbers-and-arrays.md](numbers-and-arrays.md)); a `Map` fits then.
**Check it:** `node --allow-natives-syntax -e 'console.log(%HasDictionaryElements(table))'` should print `false` (the same native answers in a Chrome page).
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.5 Integer-like keys and §4.1 Bytes per element; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.10 bytes per element.

### `JE-S3` `+=` string building stays fast when the string is read only after the loop
Rewriting it was not shown to help up to 1,600,000 characters, on all three engines.
**Keep writing:**
```js
let out = '';
for (const row of rows) out += row.name + '\n';
send(out); // read once, after the loop
```
**Why:** `+=` adds a rope node instead of copying ✅[^v8-string], and the rope is flattened once, when it is first read ✅[^lab].
**Evidence:** One character per step cost 7 to 15 ns (nanoseconds) per character from 100,000 to 1,600,000 characters, flattening included, in four runs (Node.js 24.22.1, V8 13.6, arm64); a quadratic cost would have grown sixteenfold. It rose to 29 to 41 ns at 3,200,000 and 44 to 54 ns at 12,800,000 characters, about 3 to 5 times, not quadratic ✅[^lab]. Node.js 22.23.4 (V8 12.4): flat only up to 400,000 characters (9 to 22 ns), then 31 to 56 ns. Electron 43: 2 to 5 ns, rising 7 to 10 times by 6,400,000. Chrome 158: flat at 2.8 to 6 ns per character from 100,000 to 1,600,000 characters with `--disable-renderer-backgrounding` (up to 10 ns in default headless, three runs each); about 4 to 9 times higher by 12,800,000 characters with the flag (3 to 7 ns, then 20 to 26 ns, five runs), while in five of six default headless runs the cost was already 36 to 43 ns at 1,600,000 characters and 110 to 123 ns at 12,800,000, cause not isolated ✅[^lab-matrix]. An `Array.prototype.join` version was not timed.
**Other engines:** Holds on all three engines: read once after the loop, `s += 'x'` cost 7.2 to 8.2 ns per character at 100,000 characters and 8.6 to 9.3 at 1,600,000 on SpiderMonkey (Firefox 161); 4.6 to 11.1 and 4.8 to 11.8 ns on JavaScriptCore (shell, Bun, WebKit page); on V8 in the same lab 4.5 to 4.9 and 7.6 to 10.1 (Node.js 24.22.1, macOS), 4.4 to 4.7 and 4.5 to 4.6 (Chrome 158): nearly flat everywhere ✅[^lab-cross].
**Exceptions:** Reading the string inside the loop makes it quadratic (`JE-S4`).
**Check it:** Time the loop at n and 2n: the time per character should stay about the same.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.10 Strings and §6.1 Corrections; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.11 `JE-S3` / `JE-S4`.

### `JE-S4` Do not read a string inside the loop that appends to it
Applies to strings growing past a few thousand characters.
**Prefer:**
```js
let s = '', c = 0;
for (const x of parts) { c += x.charCodeAt(0); s += x; } // read the new piece
use(s);
```
**Avoid:**
```js
let s = '', c = 0;
for (const x of parts) { s += x; c += s.charCodeAt(0); } // flattens every step
```
**Why:** Reading a character of a rope flattens it ✅[^lab], which copies the whole string; doing that after every append copies it n times.
**Evidence:** `s += 'x'; s.charCodeAt(0)` per step cost 154, 281, 540 and 935 ns per character at 5,000, 10,000, 20,000 and 40,000 characters, doubling with the length (Node.js 24.22.1, V8 13.6, arm64) ✅[^lab]; quadratic on every build tried (Node.js 22.23.4: 170.7 to 1,246.6 ns; Electron 43: 127.0 to 966.4 ns over the same sizes, three runs each). Chrome 158: 120 to 140, 220 to 250, 440 to 445 and 775 to 795 ns per character over the same sizes, two runs: quadratic too ✅[^lab-matrix].
**Other engines:** Holds on V8 and JavaScriptCore, weaker on SpiderMonkey: reading `s` after every append cost 20 to 22, 21 to 22 and 21 to 22 ns per character at 10,000, 20,000 and 40,000 characters on SpiderMonkey (Firefox 161), flat (a linear total) and about 2.5 times reading once; on JavaScriptCore (shell, Bun, WebKit page) 247 to 447, 532 to 752 and 901 to 1,917 ns, doubling with the length; on V8 in the same lab 216 to 233, 441 to 453 and 795 to 855 (Node.js 24.22.1, macOS), 212 to 214, 423 to 447 and 770 to 797 (Chrome 158) ✅[^lab-cross].
**Exceptions:** Short strings (under a few thousand characters), or a loop that runs a few times.
**Check it:** Time the loop at n and 2n: time per character doubling with n means quadratic.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.10 Strings and §6.3 Other builds and versions; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.11 `JE-S3` / `JE-S4`.

### `JE-S5` Stripping accents or changing encodings saves no string memory
Latin-1 letters such as `é` are already 1 byte per character.
**Keep writing:** the text as it is.
**Why:** V8 stores a string in 1 byte per character when every character code is 255 or less (U+00FF), and in 2 bytes when one character is above that ✅[^v8-string].
**Evidence:** `"café"` and `ÿ` (U+00FF) gave one-byte strings, `Ā` (U+0100), `€`, an em dash and emoji gave two-byte; flattened strings cost 1.0 and 2.0 bytes per character (Node.js 24.22.1, V8 13.6, arm64) ✅[^lab]; the same byte counts on Electron 43 and Chrome 158 ✅[^lab-matrix].
**Exceptions:** A slice of a two-byte parent stays two-byte even when its own characters are all ASCII; a copy (`split('').join('')`) was one-byte. `'ÿ'.toUpperCase()` gives `Ÿ` (U+0178), which is two-byte ✅[^lab].
**Check it:** `node --allow-natives-syntax -e '%DebugPrint("café" + process.pid)' | grep ' - type:'` prints `ONE_BYTE` or `TWO_BYTE` (Electron's `%DebugPrint` prints too little for this). Not checked in Chrome: the check reads `%DebugPrint` output, which a headless page does not return; the 1.0 and 2.0 bytes per character were measured in Chrome 158 too.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.10 Strings and §6.1 Corrections.

### `JE-S6` Read the raw object, not a `Proxy`, inside hot loops
Applies to a proxy read per element of a large list, per frame or per request.
**Prefer:**
```js
const raw = toRaw(state.items);        // Vue 3; or keep the target object
for (const it of raw) sum += it.price;
```
**Avoid:**
```js
for (const it of state.items) sum += it.price; // every read goes through the proxy
```
**Why:** A proxy's `get` trap intercepts property reads ✅[^mdn-proxy], so a read calls the trap instead of loading a slot; even with no traps, a read through a proxy cost about 18 times a plain read in the lab ✅[^lab]. In Vue 3, `toRaw()` reads without proxy access and tracking overhead ✅[^vue-raw].
**Evidence:** 1,000,000 reads of `o.a` took 0.54 ms on a plain object, 9.55 ms through a proxy with no traps and 15.45 ms with a `get` trap (Node.js 24.22.1, V8 13.6, arm64); in another lab, 10⁷ reads took 147.8 to 148.9 ms through a `get` trap against 3.6 to 4.1 ms on a plain object, 36 to 41 times ✅[^lab]. About the same on Node.js 25.7.0 and Electron 43 (10.25 to 10.58 and 15.77 to 17.99 ms). Chrome 158: the second lab gave 11 to 12 times (96.3 to 102.3 ms against 8.0 to 9.4 ms with `--disable-renderer-backgrounding`; 10 to 22 in the default-headless runs that reached TurboFan, 1.6 to 1.8 in three Maglev-only runs), and the first lab 9.3 to 10.1 ms without traps and 14.6 to 15.4 ms with a `get` trap per million reads ✅[^lab-matrix]. Smaller than on Node.js, still large.
**Other engines:** Holds on all three engines: 10⁵ reads from 8 `Proxy` objects with an empty handler took 3.2 to 3.4 times plain reads on SpiderMonkey (Firefox 161), with a `get` trap 5.3 to 5.8 times; on JavaScriptCore (shell, Bun, WebKit page) 2.0 to 2.3 and 2.8 to 2.9 times; on V8 in the same lab 8.5 to 9.0 and 14.4 to 14.7 (Node.js 24.22.1, macOS), 6.6 to 7.0 and 10.5 to 11.3 (Chrome 158) ✅[^lab-cross].
**Exceptions:** A few reads per request; code that needs the proxy's tracking for correctness, such as a Vue template that must re-render.
**Check it:** A CPU profile shows no trap frames under the hot loop after the change.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.13 Getters, setters and `Proxy`; [engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md), Catalog, class `proxy-in-hot-loop`; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.12 `JE-S6`.

### `JE-S7` Define getters and setters on a class, never in an object literal
Applies to objects with accessors read per element or per request; mostly a V8 cost.
**Prefer:**
```js
class Temp { constructor(c) { this._c = c; } get f() { return this._c * 1.8 + 32; } }
```
**Avoid:**
```js
const temp = { _c: c, get f() { return this._c * 1.8 + 32; } }; // dictionary mode
```
**Why:** A literal with an accessor is created in dictionary mode; class accessors live on the shared prototype and leave the instance fast ✅[^lab].
**Evidence:** `{ get v() {} }` had `%HasFastProperties` false; a class prototype with getters, setters and methods, and a new accessor added by `Object.defineProperty`, stayed fast; turning an existing data property into an accessor made the object slow (Node.js 24.22.1, V8 13.6, arm64). 10⁷ reads of a literal getter took 122.2 to 122.8 ms against 3.5 to 4.1 ms for a class getter, three runs, about 33 times ✅[^lab]. The same on V8 12.4, 14.1 and 15.0; Chrome 158: 17 to 19 times (18 to 20 in default headless; 8 in Maglev-only runs), and the literal with a getter also had `%HasFastProperties` false ✅[^lab-matrix].
**Other engines:** Mostly a V8 cost: a literal getter read 0.99 times a field on SpiderMonkey (Firefox 161) and 0.98 to 1.02 times on JavaScriptCore (shell, Bun, WebKit page) when one object was read over and over, and 1.23 and 1.42 to 1.44 times when 8 such objects were read in turn (1.14 to 1.48 in single rounds); on V8 in the same lab 33.9 and 11.1 times (Node.js 24.22.1, macOS), 19.7 and 9.2 (Chrome 158). The lab did not separate the getter from the 8 separate getter functions; the class form cost nothing on any engine (`JE-S8`) ✅[^lab-cross].
**Exceptions:** One-off objects that are not read in a loop.
**Check it:** `node --allow-natives-syntax -e 'console.log(%HasFastProperties(makeTemp(1)))'`
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.4 Fast and dictionary mode (accessors); [engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md), Lookup notes; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.13 `JE-S7` / `JE-S8`.

### `JE-S8` Class getters can stay; replacing them with plain fields is a guess until timed
A class getter read like a field on V8 12.4 and 13.6, 1.7 times a field on V8 14.1, about 1.25 times on V8 15.0, 0.70 against 0.30 to 0.60 ms in Chrome 158.
**Keep writing:** the class getter, when it reads the clearest. A rewrite for speed is worth it only after timing it on the build that ships.
**Why:** A class getter sits on the shared prototype, so the instance keeps its fast shape ✅[^lab]; its read costs at most a small constant more than a field, and on some V8 versions nothing ✅[^lab-matrix].
**Evidence:** 1,000,000 reads: getter 0.55 ms, plain property 0.54 ms (Node.js 24.22.1, V8 13.6, arm64) ✅[^lab], also equal on Node.js 22.23.4 (V8 12.4). On Node.js 25.7.0 (V8 14.1): 0.94 to 1.00 ms against 0.56 to 0.57 ms, about 1.7 times, 0.4 ms more per million reads; Electron 43 (V8 15.0): 0.70 to 0.74 ms against 0.56 to 0.63 ms, about 1.25 times, five runs each. Chrome 158: 0.70 ms against 0.30 to 0.60 ms for the plain read, in the runs where the plain read ran at TurboFan speed; those values are a few steps of the page's 0.1 ms timer ✅[^lab-matrix]. The gap is 0.1 to 0.4 ms per million reads, so it matters only in a loop that reads it far more often than that.
**Other engines:** Holds on all three engines: a class getter read like a field on SpiderMonkey (Firefox 161: 0.99 to 1.00 times) and on JavaScriptCore (shell, Bun, WebKit page: 0.96 to 1.01), with one object read over and over and with 8 objects read in turn; on V8 in the same lab 1.00 (Node.js 24.22.1, macOS) and 0.92 to 1.00 (Chrome 158, a visible window) ✅[^lab-cross].
**Exceptions:** Getters in object literals (`JE-S7`); getters that do real work per call.
**Check it:** Time a million reads both ways on the build that ships (warm up first, median of 9).
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.13 Getters, setters and `Proxy` and §6.3 Other builds and versions; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.13 `JE-S7` / `JE-S8`.

### `JE-S9` Store large integer columns in a typed array, and count them outside `heapUsed`
Measured at 1,000,000 elements.
**Prefer:**
```js
const offsets = new Int32Array(n);               // 4 bytes per element
const { heapUsed, arrayBuffers, external } = process.memoryUsage();
```
**Avoid:**
```js
const offsets = new Array(n).fill(0);            // 8 bytes per element on Node.js
```
**Why:** A typed array holds raw values in an `ArrayBuffer`; above 64 bytes, the V8 source's default for data kept on the heap, that buffer lives outside the V8 heap ✅[^v8-jsab], in memory Node.js reports as `arrayBuffers`, which is also counted in `external` ✅[^node-process], so `heapUsed` does not show it. What each `process.memoryUsage()` field counts is `JN-H3` in [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md).
**Evidence:** `Int32Array` 4.0 bytes per element and `Float64Array` 8.0, counted in `arrayBuffers`; a small-integer array 8.0 bytes in `heapUsed` (Node.js 24.22.1, V8 13.6, arm64). A `Uint8Array(64)` stayed on the heap, `Uint8Array(65)` added 65 off-heap bytes. Writes convert: `300` became `44` in an `Int8Array` and `255` in a `Uint8ClampedArray`, `'abc'` became `NaN` in a `Float64Array`, a write past the end was ignored ✅[^lab]. In Electron 43 `arrayBuffers` stayed 0 and the bytes showed in `external`, with the same 64-byte boundary. Chrome 158: `Int32Array` 4.0 and `Float64Array` 8.0 bytes per element, read in `performance.memory.usedJSHeapSize`, which in these runs included `ArrayBuffer` contents (cause not examined); a page has no `arrayBuffers` counter, so the 64-byte boundary was not checked in Chrome ✅[^lab-matrix].
**Other engines:** Same direction as on Node.js: on JavaScriptCore (shell, Bun) an `Int32Array` took 4.0 (shell) and 4.1 (Bun) bytes per element against 8.0 for a small-integer array, and the shell's `gcHeapSize()` and Bun's `heapStats().heapSize` counted typed-array contents (within 0.4 % on allocations of known size) ✅[^lab-cross]. In the SpiderMonkey shell an `Int32Array` took 4.0 bytes per element and `Float64Array` 8.0, against 8.4 for a small-integer array, and its heap figure counted typed-array contents to within 0.3 % ✅[^lab-sm]. Not measured in the Firefox page or in the WebKit page.
**Exceptions:** With pointer compression (Electron, Chrome 158 measured) a small-integer array is already 4.0 bytes per element (`JE-N10` in [numbers-and-arrays.md](numbers-and-arrays.md)). Values that exceed the element type wrap silently.
**Check it:** `process.memoryUsage()` before and after building it: `arrayBuffers` (Node.js) or `external` (Electron) grows by n × element size; the other fields are in `JN-H3`. In Chrome, `performance.memory.usedJSHeapSize` after `gc()`: it showed the buffer's bytes in Chrome 158, unlike Node.js's `heapUsed`, so typed arrays need care when compared across the two.
**Full lab:** [object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.9 Typed arrays and `ArrayBuffer` and §4.1 Bytes per element; [cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.10 bytes per element.

## Takeaways
- A lookup table with run-time keys is a `Map` or `Set`; on V8 it also took about 40 % fewer bytes per entry than an object table, but not on JavaScriptCore ✅[^lab-cross] or in the SpiderMonkey shell ✅[^lab-sm]. [rule-candidate]
- `s += part` is fine when the string is read after the loop; reading the growing string inside the loop made it quadratic on V8 and JavaScriptCore ✅[^lab-cross].
- Accents up to U+00FF cost nothing extra: V8 keeps such strings at 1 byte per character ✅[^lab].
- A proxy read in a hot loop cost 2 to 15 times a plain read on all three engines; reading the raw target avoids it ✅[^lab-cross]. [rule-candidate]
- Getters belong on classes: in an object literal they made the object a dictionary on V8 ✅[^lab].
- Typed-array memory sits outside `heapUsed` on Node.js; a memory check needs `arrayBuffers` or `external` too ✅[^lab].

## Verification status
- Verified: 86 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab: Node.js 24.22.1 (V8 13.6.233.17-node.58), image `node:24.22.1-alpine`, linux arm64, pointer compression off, Apple M2 under Docker, `--network none`, 2026-11-26; scripts, commands and outputs in [the object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md) §3, §4 and §6, and in [the engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md), Catalog. Rank 1 (primary measurement). Backs: Summary, Scope, Catalog, Lookup notes, Takeaways. [^lab]
- Lab matrix: the same scripts re-run on 2026-11-27 on Node.js 24.22.1 (macOS arm64; linux x64 emulated), Node.js 22.23.4 (V8 12.4.254.21), Node.js 25.7.0 (V8 14.1.146.11), Electron 43.7.7 as Node (V8 15.0.245.31, pointer compression on), the Node.js 24.22.3 pointer-compression build (V8 13.6, linux x64 emulated) and Google Chrome 158.0.8127.89 (V8 15.8.62.31, macOS arm64, headless page); outputs in §6.3 of [the object and value representation deep dive](../../js-runtime/v8-object-and-value-representation-deep-dive.md) and in the Lookup notes of [the engine problem classes](../../performance/code-review/problem-classes-javascript-engine.md). Rank 1 (primary measurement). Backs: Scope, Catalog, Lookup notes. [^lab-matrix]
- Lab cross-engine: engine-neutral scripts run three times each on 2026-11-28 on one Apple M2 with macOS 26.1: V8 in Node.js 24.22.1 (macOS arm64) and Google Chrome 158.0.8127.89 (a visible window), SpiderMonkey in Firefox 161.0 (headless), JavaScriptCore in the `jsc` shell of the macOS 26.1 framework (21622.2.11.11.9), Bun 1.4.5 and a Playwright WebKit build 2311 page; scripts and outputs in §4.10 to §4.13 of [the cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md). Rank 1 (primary measurement). Backs: Summary, Scope, Catalog, Lookup notes (Other engines), Takeaways. [^lab-cross]
- Lab SpiderMonkey shell: `jsshell-linux-aarch64.zip` of Firefox 161.0 from Mozilla's archive (`js --version` `JavaScript-C161.0`), run in `ubuntu:24.04` (linux arm64 container, no network) on the same Apple M2, 2026-11-28; the bytes-per-element script ran three times; script and output in §4.34 of [the cross-engine deep dive](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md). Rank 1 (primary measurement). Backs: Scope, Catalog, Lookup notes (Other engines), Takeaways. [^lab-sm]
- [V8 source: src/objects/string.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/string.h) — V8 project, 2025. Rank 1. Backs: Scope, terms; Lookup notes, `JE-S3`, `JE-S5` (string kinds, cons and sliced strings). [^v8-string]
- [V8 source: src/objects/ordered-hash-table.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/ordered-hash-table.h) — V8 project, 2025. Rank 1. Backs: Lookup notes, `JE-S1` (Map and Set as ordered hash tables). [^v8-ordered]
- [V8 source: src/objects/js-array-buffer.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/js-array-buffer.h) — V8 project, 2025. Rank 1. Backs: Lookup notes, `JE-S9` (typed arrays on the heap up to 64 bytes). [^v8-jsab]
- [Node.js v24 process documentation: process.memoryUsage()](https://nodejs.org/docs/latest-v24.x/api/process.html) — Node.js project, v24.x, read 2026-11-26. Rank 1. Backs: Lookup notes, `JE-S9` (`arrayBuffers`, `external`, `heapUsed`). [^node-process]
- [Reactivity API: Advanced (toRaw, markRaw)](https://vuejs.org/api/reactivity-advanced.html) — Vue, Vue 3, living. Rank 1. Backs: Lookup notes, `JE-S6`. [^vue-raw]
- [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) — MDN, living. Rank 3. Backs: Scope, terms; Lookup notes, `JE-S6`. [^mdn-proxy]
- [Fast properties in V8](https://v8.dev/blog/fast-properties) — V8 team (Camillo Bruni), 2017-08-30. Rank 4. Backs: Scope, terms; Lookup notes, `JE-S2` (dictionary properties, elements kept apart). [^v8-fastprops]

## Related
- [objects-and-shapes.md](objects-and-shapes.md) — shapes, `delete` and computed keys (`JE-O1` to `JE-O7`).
- [numbers-and-arrays.md](numbers-and-arrays.md) — number fields, elements kinds and pointer compression (`JE-N1` to `JE-N11`).
- [memory-and-garbage-collection.md](memory-and-garbage-collection.md) — a slice that keeps a big string alive (`JL-G3`).
- [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md) — what each `process.memoryUsage()` field counts (`JN-H3`).
- [browser-component-frameworks.md](browser-component-frameworks.md) — framework reactivity costs (`JB-F` rules).
- [../../js-runtime/v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) — string representations, `Map`, `Set`, typed arrays and proxies, with every script.
- [../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) — the same rules on SpiderMonkey and JavaScriptCore.
- [../../js-runtime/v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) — external memory and `process.memoryUsage()`.
- [../../performance/code-review/problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md) — the review catalog with `proxy-in-hot-loop`.
