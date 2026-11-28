---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24.22.1 (V8 13.6.233.17), linux arm64, pointer compression off: lab of 2026-11-26", "V8 source at tag 13.6.233.17", "V8 12.4 to 15.0 (Node.js 22.23.4 and 25.7.0, Electron 38.8.6 and 43.7.7, Deno 2.9.8, Node.js 24.22.3 with pointer compression): re-run of 2026-11-27", "Google Chrome 158.0.8127.89 (V8 15.8.62.31), headless page 2026-11-27 and visible window 2026-11-28", "SpiderMonkey (Firefox 161.0) and JavaScriptCore (jsc shell of macOS 26.1, Bun 1.4.5, Playwright WebKit build 2311): cross-engine lab of 2026-11-28"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, v8, turbofan, inlining, deoptimization, inline-caches, call-sites]
derived-from: [js-runtime/v8-compiler-pipeline-deep-dive.md, js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: functions, call sites and V8's optimizing compilers

## Summary
**TL;DR:** Twelve practices for a function or call site that runs hot on V8: keep each read site to 4 object shapes or fewer, keep one value type per site, split huge generated functions, keep direct `eval` and per-call generators out of hot code, and prefer an index `for` in a hot loop. Half of them say what not to rewrite: `try`/`catch`, `arguments`, rest parameters, closures, comments and small temporary objects were all optimized by TurboFan ✅[^lab]. The two results that matter most: one read fed 8 shapes took about 5 times as long as one fed 1 shape ✅[^lab], and new shapes stopped causing deoptimizations after the 5th ✅[^lab].
**Use this when:** you write or review a helper, dispatcher, hash, accumulator or loop that runs per request, per frame or per element; you meet advice such as "deopt loop", "optimization killers", "functions under 600 characters" or "avoid closures"; you read V8's inlining or deopt traces.
**Not this doc:** object shapes and field order → [objects-and-shapes.md](objects-and-shapes.md) (`JE-O`); number fields, arrays and `for…in` over arrays → [numbers-and-arrays.md](numbers-and-arrays.md) (`JE-N`); strings, `Map`, getters and `Proxy` → [strings-and-collections.md](strings-and-collections.md) (`JE-S`); how to benchmark and read tiers → [measuring-performance.md](measuring-performance.md) (`JE-M`); closures that keep memory alive and per-call arrays → [memory-and-garbage-collection.md](memory-and-garbage-collection.md) (`JL-G`); the mechanisms in full → [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md).

## Scope
The catalog covers how V8 compiles a function and a call site: inline caches, inlining, deoptimization, the bytecode size limits, escape analysis, and language features said to block optimization. Evidence: the baseline lab ran Node.js 24.22.1 (V8 13.6.233.17, linux arm64 in a container on one Apple M2, pointer compression off) on 2026-11-26 ✅[^lab]; the same scripts ran again on 2026-11-27 on V8 12.4, 14.0, 14.1 and 15.0 (Node.js 22 and 25, Electron 38 and 43, Deno 2.9) and in Google Chrome 158 (V8 15.8, headless, timed with the Chrome flag `--disable-renderer-backgrounding` unless "default headless" is said, why: `JE-M13` in [measuring-performance.md](measuring-performance.md)) ✅[^lab-matrix]; on 2026-11-28 a cross-engine lab timed engine-neutral versions of the rules on SpiderMonkey (Firefox 161) and JavaScriptCore (a shell, Bun, a WebKit page; Safari itself was not run) beside V8, using the lowest of three runs ✅[^lab-cross]. Claims hold for V8 unless an **Other engines** line says otherwise; on SpiderMonkey and JavaScriptCore only time was observed, not tiers, inlining or deopts ✅[^lab-cross]. `JE-F2`, `JE-F4`, `JE-F5`, `JE-F7` and `JE-F8` rest on V8's own traces and limits and were not run on other engines. Timings "measured in the lab" come from one machine and vary by run; only their order carries over.

**How to read "Applies".** `always`: the better form is as clear as the other, so use it by default. `hot path`: only in code that runs per request, per frame or per element of a large collection, or that a profile points at. `large data`: only above the size the note gives. `startup`: only when start time matters. `check build`: the answer depends on the engine version or build. `no gain`: the lab measured no useful difference, or the advice is outdated; there is no reason to rewrite code for it.

**Terms.** Each is explained with an everyday comparison.
- **Tier**: one of V8's ways to run a function. V8 starts in the Ignition interpreter, then moves a function up to the Sparkplug and Maglev compilers and finally to **TurboFan**, the compiler focused on peak performance ✅[^maglev]. Like a cook who first follows the recipe card line by line, then learns it by heart.
- **Shape** (V8 calls it a map): the engine's record of which properties an object has, in which order. Like a form layout: two forms with the same boxes in the same places share one layout.
- **Inline cache (IC)**: a per-site record of the shapes seen there, with the states 0 (none), 1 (monomorphic), P (polymorphic) and N (megamorphic) in V8's IC log ✅[^v8-ic]. Like a cashier who remembers regular customers, up to a few.
- **Deoptimization (deopt)**: when a guess of optimized code fails, V8 rebuilds an interpreter frame and runs on in the interpreter ✅[^maglev]. Like a train leaving the express track for the local one.
- **Inlining**: copying a small callee's body into its caller, so no call happens. Like pasting a short paragraph instead of writing "see page 40".
- **On-stack replacement (OSR)**: swapping optimized code in while a long loop is still running ✅[^tiering].
- **Escape analysis**: TurboFan's proof that an object never leaves the function, so it need not be allocated ✅[^escape-h].
- **Call site**: one place in the source that calls or reads something; `fn(x)` on line 12 is one site, however many functions pass through it.
- **Bytecode**: the compact instructions V8's interpreter runs, made from the source; comments and names produce none ✅[^lab].

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JE-F1` | One hot helper (`getId`, `serialize`, `compare`, a visitor) called with objects from 5+ classes or factories | Split it per type, or build every record from one factory (`JE-O1`), so each read site sees 4 shapes or fewer | hot path | Node.js 24.22.1: one read with 1, 4 and 8 shapes took medians of 10.3 to 11.7, 45.2 to 54.4 and 57.5 to 67.5 ms per 10⁷ calls ✅[^lab]; Chrome 158: 8 shapes / 1 shape 5.0 to 5.2 times ✅[^lab-matrix]; slower on all three engines ✅[^lab-cross] |
| `JE-F2` | A hot call `fn(x)` that receives several unrelated functions over time | Give the site one function, or closures made by one factory | hot path | Two unrelated targets at one site: not inlined; two closures of one factory: inlined (Node.js 24.22.1) ✅[^lab]; same on V8 12.4 to 15.0 ✅[^lab-matrix] |
| `JE-F3` | `let total;` or `''` later summed; `h = h * 31 + c` without `\| 0`; a value that is a number on some calls, a string on others | Start numbers at `0`, convert with `Number(x)` at the boundary, use `Math.imul(h, 31)` and `\| 0` where 32-bit wrap is intended | hot path (one type: V8; no gain measured on SpiderMonkey, JavaScriptCore) | A sum that once saw a string: 2.08 to 2.14 ms against 0.72 to 0.78 ms per 10⁶ integers; the unwrapped hash deopted with `overflow` (Node.js 24.22.1) ✅[^lab]; 1.00 to 1.09 times on SpiderMonkey, 0.96 to 1.04 on JavaScriptCore ✅[^lab-cross] |
| `JE-F4` | Advice that a polymorphic or megamorphic site "deopts again and again" and must be rewritten | Keep the code; if the site is hot and sees 5+ shapes, fix the read speed with `JE-F1` | no gain | One deopt per new shape for shapes 2 to 5, none for shapes 6 to 8, in 24 of 24 combinations (Node.js 24.22.1, `--single-threaded`) ✅[^lab]; same on V8 14.1 and 15.0 ✅[^lab-matrix]; not tested: other site kinds, Chrome, other engines |
| `JE-F5` | Advice to keep functions under 600 characters, strip comments or shorten names for inlining | Keep comments and names: the inlining limit is 460 bytes of bytecode, not source length | no gain | Callees with a 20,000-character comment had 6 to 13 bytes of bytecode and were inlined; 456 bytes inlined, 466 not (Node.js 24.22.1) ✅[^lab]; same on V8 12.4, 14.1, 15.0 ✅[^lab-matrix]; not tested: Maglev inlining, Chrome, other engines |
| `JE-F6` | `new Function(body)` or generator output with thousands of statements in one hot function | Split it into one function per rule plus a small dispatcher | hot path | 3,250 statements (60,988 bytes) got TurboFan code, 3,400 (63,838 bytes) did not (Node.js 24.22.1) ✅[^lab]; time per statement jumped between 1,000 and 2,000 statements on SpiderMonkey, 2,000 and 3,000 on Node.js 24, 3,000 and 4,000 in Chrome, 4,000 and 6,000 on JavaScriptCore ✅[^lab-cross] |
| `JE-F7` | Advice to pass every parameter, avoid `...rest`, never leak `arguments`, or avoid `bind` and closures | Keep the clearest form | no gain | Fewer or more arguments, rest parameters, `arguments` in five forms, a bound function and a closure: each inlined into TurboFan code with no deopt (Node.js 24.22.1) ✅[^lab]; same on V8 12.4, 14.1, 15.0 ✅[^lab-matrix]; the time of each form not measured, other engines not run |
| `JE-F8` | `f(...arr)` or `f.apply(null, arr)` with `arr` a variable, `apply(…, arguments)`, or `(...xs) => f(...xs)` in a hot path | Call the small function with explicit arguments | hot path | Those four forms blocked inlining of a small callee on Node.js 24.22.1 ✅[^lab] and on V8 12.4 to 14.1; on V8 15.0 spread and `apply` of an array variable were inlined; Chrome not checked ✅[^lab-matrix] |
| `JE-F9` | Advice to move out `try`/`catch`, or avoid generators, `async`, `for…of`, `for…in` or `with` for speed | Keep `try`/`catch`, `arguments`, `for…in`; keep generators out of hot per-call code | no gain | TurboFan code for all ten forms on Node.js 24.22.1 ✅[^lab] and in Chrome 158 ✅[^lab-matrix]; `try`/`catch` 0.98 to 1.15 times the plain function on SpiderMonkey and JavaScriptCore, but one generator value per call 5.5 to 108 times a plain call on every engine ✅[^lab-cross]; not tested: larger functions, `async` and `with` off V8 |
| `JE-F10` | A direct `eval(` inside a function that runs per request or per element (`with`: not timed) | Build `new Function(...)` once with values as parameters, or use indirect eval | hot path | An `eval` that never runs: 1,084 scavenges against 0, 16.6 against 1.2 ms (Node.js 24.22.1) ✅[^lab]; 17.8 to 99 times slower on all three engines when the function is not inlined ✅[^lab-cross] |
| `JE-F11` | Advice to replace a short-lived `{ x, y }` or `{ value, done }` in a hot helper with loose variables | Keep the object if it never leaves the function | no gain | 10 million `{ x, y }` in a TurboFan loop: 0 scavenges (Node.js 24.22.1) ✅[^lab]; 0.99 to 1.00 times loose variables on V8 and JavaScriptCore; on SpiderMonkey 0.98 to 1.04 times in five of nine runs and 0.22 to 0.25 in the other four (cause not found), and hand-inlining never gained ✅[^lab-cross]; `{ value, done }` not run |
| `JE-F12` | `arr.forEach(…)`, `arr.reduce(…)` or `for…of` in a loop a profile shows as hot, over large arrays | Use an index `for` | hot path | `forEach` 1.84 to 1.94 times the index loop with all forms in TurboFan code (Node.js 24.22.1) ✅[^lab]; `forEach` 1.55 to 4.87 times on all three engines, `for…of` 3.78 to 4.00 in Firefox ✅[^lab-cross] |

## Lookup notes
### `JE-F1` Split a hot generic helper that is fed many classes, or build its input to one shape
**Applies in detail:** the helper runs per element, per request or per frame; the code shows one helper such as `getId(x)`, `serialize(entity)`, `compare(a, b)` or a visitor reading `node.kind`, called with objects from 5 or more classes or factories.
**Prefer:**
```js
// Fix 1: one helper per type, so each read site sees one shape
const scoreUser = (u) => u.id * u.weight;
const scoreOrder = (o) => o.id * o.weight;
// Fix 2: every producer builds the same shape, so one helper is fine
const makeRow = (id, weight) => ({ id, weight });  // all records come from this factory
const score = (r) => r.id * r.weight;              // its read sees one shape
```
**Avoid:**
```js
function score(e) { return e.id * e.weight; } // called with User, Order, Invoice, … (8 classes or factories)
```
**Why:** An IC holds up to 4 shapes; at the 5th it becomes megamorphic and does a generic lookup on every read ✅[^v8-ic], and it never comes back ✅[^lab]. The limit is the flag `--max-valid-polymorphic-map-count`, 4 in the V8 13.6 source ✅[^v8-flags]. A converter such as `entities.map(toRow)` only moves the many-shape reads into the converter: it pays where it runs once and the reads after it run many times. How to build objects with one shape: `JE-O1` in [objects-and-shapes.md](objects-and-shapes.md).
**Evidence:** IC log `1 -> P` on the 2nd shape and `P -> N` on the 5th, at a load and at a store; `--max-valid-polymorphic-map-count` was 4 on all seven builds tried; one read `o.id` took medians of 10.3 to 11.7 ms (1 shape, the same object every step), 45.2 to 54.4 ms (4 shapes) and 57.5 to 67.5 ms (8 shapes) per 10⁷ calls in six runs on Node.js 24.22.1 ✅[^lab]. The order 1 < 4 < 8 held in three runs each on Node.js 22.23.4 (V8 12.4), 25.7.0 (V8 14.1) and Electron 43 (V8 15.0); in Chrome 158, 8 shapes / 1 shape took 5.0 to 5.2 times (4.1 to 5.4 in default headless; about 5 on the baseline) and the order held; the IC log is not readable from a page ✅[^lab-matrix]. The fixes themselves were not timed.
**Other engines:** Holds on all three: 10⁶ reads of `o.a` from objects written in 8 key orders took 2.22 to 2.24 times one order on SpiderMonkey, 2.22 to 2.41 times on JavaScriptCore, 2.98 to 3.11 on Node.js 24.22.1 (macOS) and 3.24 to 3.70 in Chrome 158; at 4 orders every engine was about 1.5 times slower ✅[^lab-cross].
**Exceptions:** cold code (start-up, admin pages); a loop body that does far more work than the read (I/O, a regular expression). 4 shapes are not megamorphic but still cost more than one (the 45.2 to 54.4 ms above): "4 or fewer" is the IC limit, not a measured safe level.
**Check it:** `node --log-ic --logfile=ic.log --no-logfile-per-isolate app.js`, then `grep ^LoadIC ic.log` for the file's line: `P -> N` before the fix, at most `1 -> P` after. In a page there is no IC log: time the read before and after the fix.
**Full lab:** [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md), Catalog `megamorphic-access-site` and Lookup notes "Other builds and versions"; [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.1 Inline caches and their states; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4.1.

### `JE-F2` Give a hot callback call site one function, or closures from one factory
**Applies in detail:** a dispatcher such as `run(task)` or `apply(fn, x)` inside a hot loop, whose one call `fn(x)` receives several unrelated functions over time.
**Prefer:**
```js
const apply = (fn, x) => fn(x);
const makeAdder = (n) => (a) => a + n;  // closures of one factory share one function body
const steps = [makeAdder(1), makeAdder(2)];
for (const s of steps) total += apply(s, 1);
```
**Avoid:**
```js
const steps = [(a) => a + 1, (a) => a * 2, parseRow, formatRow]; // unrelated functions
for (const s of steps) total += apply(s, 1);   // apply(fn, x) { return fn(x); }
```
**Why:** TurboFan inlines a callee when the call site's feedback names a target ✅[^inl-heur]. Two different functions at one site: nothing inlined; closures from one factory count as one target; a method call `o.m()` on objects of two classes inlined both methods ✅[^lab].
**Evidence:** `--trace-turbo-inlining` on Node.js 24.22.1: two arrow functions at one site, no `Inlining` line; two closures of one factory, inlined; `o.m()` on two classes, both inlined; a new target arriving after optimization deopted with `reason: wrong call target` ✅[^lab]. Same on V8 12.4; on V8 14.1 and 15.0 only the trace text differs, and both methods were still inlined ✅[^lab-matrix]. Not checked in Chrome: a page does not get the inlining trace. The cost of the lost inlining was not timed.
**Exceptions:** a site that runs a few times; a callee that does a lot of work itself, so the call overhead is small.
**Check it:** `node --allow-natives-syntax --trace-turbo-inlining app.js | grep -E 'Inlining|Cannot consider'` for the caller's name.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.5 Inlining and its limits; §3.2 Speculative optimization and deoptimization.

### `JE-F3` Keep one value type per hot site: start numbers at 0, wrap 32-bit math explicitly
**Applies in detail:** the hash or accumulator runs per element or per request; results from 2³⁰ to 2³¹ − 1 differ on builds with pointer compression (Chrome and Electron included); the one-type half pays on V8 only.
**Prefer:**
```js
let total = 0;
for (const x of xs) total += Number(x);          // convert at the input boundary
let h = 0;
for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
```
**Avoid:**
```js
function sum(xs, start) { let s = start; for (const x of xs) s += x; return s; }
sum([1, 2], '');                                 // the `+=` site once adds numbers to a string
let h = 0;
for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i); // grows past 32 bits
```
**Why:** Optimized code is compiled for the types seen so far, with a check before each guess; a failed check deoptimizes ✅[^maglev]. A new type, or a small integer (Smi, an integer stored inside the reference word with no box) that overflows, makes the code deopt, and the site keeps the wider, slower general code ✅[^lab]. `Math.imul` gives C-like 32-bit multiplication ✅[^mdn-imul].
**Evidence:** Node.js 24.22.1: the unbounded hash (a 40-character key after 10⁵ calls on a 3-character key) deopted with `reason: overflow`, while the `Math.imul` version stayed a small integer; a sum loop whose `+=` had once added numbers to `''` took 2.08 to 2.14 ms against 0.72 to 0.78 ms median per 10⁶ small integers, three runs ✅[^lab]; a start value of `undefined` or `null` was not timed. Chrome 158: mixed / clean sum 3.2 to 3.9 times (2.2 to 3.9 in default headless; 2.7 to 2.9 on the baseline in the catalog's script); the clean sum took 0.8 to 0.9 ms, a few steps of the 0.1 ms timer, so the ratio is loose ✅[^lab-matrix]. With pointer compression on (Electron 43 with V8 15.0, Chrome 158, Node.js 24.22.3 with V8 13.6, emulated x64), small integers end at 2³⁰ − 1, so a 32-bit hash of 1,183,338,240 came back as a heap number from both functions; no deopt on Electron 43, while on the Node.js 24.22.3 build the `Math.imul` function deopted once with `not a Smi` in 7 of 12 runs (0 of 16 on the same V8 without compression, 0 of 3 on Electron 43; a race under emulation, not a fixed result) ✅[^lab-matrix].
**Other engines:** Weaker off V8: a sum that once saw a string ran 1.00 to 1.09 times the clean sum on SpiderMonkey and 0.96 to 1.04 on JavaScriptCore, against 2.98 to 3.01 (Node.js 24.22.1, macOS) and 2.55 to 3.24 (Chrome 158). The hash without `Math.imul` and `| 0` took 1.11 to 1.12 times the wrapped one on SpiderMonkey and 1.59 to 1.70 on JavaScriptCore (V8 1.19 to 1.33) when its result was reduced with `& 1023`, and 2.34 to 10.4 times on every engine through `% 1000`, which the lab reads mostly as the cost of `%` on a number near 10⁵⁹ ✅[^lab-cross].
**Exceptions:** the second type arrives once at start-up and never on the hot path; values that are doubles throughout (ratios, floating-point money) are one type. `Math.imul` and `| 0` change the result: they fit only where 32-bit wrapping is intended. For a number field of an object: `JE-N2` in [numbers-and-arrays.md](numbers-and-arrays.md).
**Check it:** `node --trace-deopt app.js | grep -o 'reason: [^)]*'`: no new reasons for the hot function after warm-up.
**Full lab:** [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md), `type-unstable-site`; [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.2; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4.14.

### `JE-F4` A "deopt loop" is no reason to restructure code
**Keep writing:** the code as it is; if the site is hot and sees 5+ shapes, `JE-F1` fixes the speed of the read, which is a separate question from deopts.
**Why:** Each deopt adds the new shape to the feedback, and IC states move one way only (`0 → 1 → P → N`) ✅[^v8-ic]. Once the site is megamorphic, the optimized code uses the generic path and no longer deopts on new shapes ✅[^lab]. V8 13.6 has no deopt counter (`--max-deopt-count` does not exist) ✅[^tiering]; that the IC states are what bounds the deopts is an inference from the runs and the source.
**Evidence:** Node.js 24.22.1, `--single-threaded`, 20,000 or 3,000 calls per phase: one deopt per new shape for shapes 2 to 5, none for shapes 6 to 8, in all 24 combinations of 4 site kinds (load, store, two loads, method call) and 3 ways of making shapes; with default flags, two runs of the 24 gave 43 of 48 with that pattern, and the other 5 had one extra deopt in one or two of phases 2 to 5, never after the 5th shape ✅[^lab]. Same on V8 14.1 and 15.0; on V8 12.4 the 3,000-call phases had no deopt in phase 2 and none after phase 5 ✅[^lab-matrix]. Not tested: other site kinds, other causes of deopt, the cost of the generic path (`JE-F1` has the read cost). Not checked in Chrome: a page does not get the deopt trace.
**Exceptions:** a deopt caused by something other than shapes (a type change, an overflow) repeats each time the case recurs: `JE-F3`.
**Check it:** `node --single-threaded --trace-deopt app.js | grep -c 'bailout'` per phase of a test that feeds more shapes: the count stops growing after the 5th.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.3 Deoptimization loops, and how V8 limits them; §6.1 Corrections.

### `JE-F5` Comments and long names do not stop a function being inlined
**Keep writing:** readable helpers with their comments. What blocks inlining into TurboFan is the callee's bytecode size: over 460 bytes (about 45 simple arithmetic statements in the lab) it was not inlined ✅[^lab], and all inlined callees of one caller share a budget of 920 bytes ✅[^inl-heur].
**Why:** The 600-character rule was Crankshaft's, written down in 2013 ✅[^conrod]; TurboFan dropped source size from its inlining rule in 2016 ✅[^cr-inline-size]. The limit is the flag `--max-inlined-bytecode-size`, default 460 bytes of bytecode on every build tried; comments and long names produce no bytecode ✅[^lab].
**Evidence:** Node.js 24.22.1, one call site, forced optimization of the caller, TurboFan trace: callees with a 2,000- or 20,000-character comment, or a 3,000-character variable name, had 6 to 13 bytes of bytecode and were inlined; arithmetic callees of 446 and 456 bytes were inlined, 466, 486, 506 and 706 bytes were not, and all were inlined with `--max-inlined-bytecode-size=2000` ✅[^lab]. Same verdicts and lengths on V8 12.4, 14.1 and 15.0, which print `reason: exceeds bytecode limit` (14.1 and 15.0) instead of `reason: 5` ✅[^lab-matrix]; `5` is `kExceedsBytecodeLimit` in V8's `Inlineability` enum ✅[^sfi-h]. Not tested: Maglev inlining (its own flag, `--max-maglev-inlined-bytecode-size`, 460 on V8 13.6 and 100 on V8 12.4, 14.1 and 15.0), other bodies, several call sites. The small-function limit `--max-inlined-bytecode-size-small` is 27 bytes on V8 13.6, 14.0 and 14.1 and 30 on V8 15.0 (Deno 2.9.8, Electron 43.7.7): it comes with the V8 version ✅[^lab-matrix]. Not checked in Chrome: a page reads neither the trace nor `--v8-options`.
**Exceptions:** none found for comments. For a hot helper really over 460 bytes of bytecode, splitting out its rare branches can let the hot part inline; the gain was not timed.
**Check it:** `node --print-bytecode --print-bytecode-filter=<name> app.js | grep 'Bytecode length'`; `node --allow-natives-syntax --trace-turbo-inlining app.js` prints `Cannot consider … (reason: 5)` for a callee over the limit (`exceeds bytecode limit` on V8 14.1 and later).
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.5; §6.1; §6.4 Other builds and versions.

### `JE-F6` Split generated functions of thousands of statements
**Applies in detail:** generated code that runs per request or per element; how many statements fit differs by build (61,440 bytes of bytecode on Node.js 24; see Evidence for Chrome 158) and by engine.
**Prefer:**
```js
// one generated function per rule, plus a small dispatcher
const checks = rules.map((r) => new Function('v', compileRule(r)));
const validate = (v) => checks.every((c) => c(v));
```
**Avoid:**
```js
const validate = new Function('v', rules.map(compileRule).join('\n')); // one body of thousands of statements
```
**Why:** A function whose bytecode is longer than `--max-optimized-bytecode-size` (61,440 bytes, 60 KB) never gets TurboFan code ✅[^tiering] ✅[^v8-flags]; `--trace-opt` prints "Function is too big to be optimized" ✅[^bailout-reason]. Smaller functions are compiled on their own. Maglev still compiled both sizes on V8 13.6 ✅[^lab]. A page cannot print the bytecode length or the flag's value, so the limit in bytes is not known for Chrome 158.
**Evidence:** forced optimization on Node.js 24.22.1, a body of `t = (t * 3 + 1) | 0;` statements: 3,250 statements (60,988 bytes) got TurboFan code, 3,400 (63,838 bytes) did not, until the flag was raised to 200,000; in a second lab, 60,135 bytes was compiled and 62,235 refused ✅[^lab]. The default 61,440 was the same on all seven builds, and the refusal repeated on V8 12.4, 14.1 and 15.0 and on Node.js 24.22.3 (emulated, `--turbofan`); Maglev is off by default on Node.js 22 (V8 12.4), and forced alone it did not compile the 3,000-statement function on Electron 43 (V8 15.0) only. Chrome 158, forced in a page: the `t = (t * 3 + 1) | 0;` body got TurboFan code up to 6,000 statements and not at 6,400 (refused at 3,400 on the baseline); the catalog's 3,000-statement function (62,235 bytes, refused on V8 13.6) was TurboFan code, 4,000 statements compiled and 4,500 were refused, and bisecting the flag stopped that function at 41,747 bytes; Maglev forced alone compiled 1,000, 3,000 and 6,000 statements ✅[^lab-matrix]. The time lost by a refused function was not measured.
**Other engines:** Holds on all three, at different sizes: with a bit-mixing body, time per statement stayed flat and then jumped, between 1,000 and 2,000 statements on SpiderMonkey (6.06 to 6.79 ns per statement at 1,000, 31.5 to 33.1 at 2,000), between 4,000 and 6,000 on JavaScriptCore (1.15 to 1.50 ns at 1,000, 22.6 to 37.3 at 6,000; sizes between not tried), between 2,000 and 3,000 on Node.js 24.22.1 (macOS) and between 3,000 and 4,000 in Chrome 158 ✅[^lab-cross]. The lab does not say why the other engines jump; keeping generated functions to hundreds of statements, and splitting anything above about 1,000, stays below every jump seen.
**Exceptions:** the function runs once (a module body, generated start-up code); it is hot only in small helpers it calls.
**Check it:** `node --trace-opt app.js | grep 'too big'`: no line after the split. `--print-bytecode --print-bytecode-filter=<name>` prints `Bytecode length`. In a Chrome page (`--js-flags=--allow-natives-syntax`), force optimization and read `%GetOptimizationStatus(fn)`: 41 is TurboFan code on V8 15.8 (`JE-M7` in [measuring-performance.md](measuring-performance.md)).
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §2.2 The four tiers; §6.4; [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md), `oversized-function`; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4.19.

### `JE-F7` Argument counts, rest parameters, `arguments`, `bind` and closures need no rewrite
**Keep writing:** the clearest form: optional trailing parameters, `...rest`, a bound function, a closure.
**Why:** V8 8.9 removed the arguments adaptor frame that once made a count mismatch slow ✅[^adaptor]. TurboFan inlines and optimizes the other forms ✅[^lab].
**Evidence:** Node.js 24.22.1, 50 warm-up calls, forced optimization of the caller, 1,000 more calls: fewer arguments, more arguments, rest parameters, `arguments.length` and `arguments[0]`, `arguments` stored in an outside variable, sloppy-mode `arguments` aliasing a reassigned parameter, a bound function and a closure were each inlined, with no deopt; in natural tier-up the `arguments` forms reached TurboFan code too ✅[^lab]. Same on V8 12.4, 14.1 and 15.0; in Chrome 158 the `arguments` forms were TurboFan code after forced optimization, read from the status (inlining and deopts not readable from a page) ✅[^lab-matrix]. Not measured: the time of each form, and what building the rest array or the `arguments` object costs per call.
**Exceptions:** spreading an array held in a variable, `apply` with `arguments`, and forwarding rest parameters block inlining: `JE-F8`. A closure that is kept alive keeps what it captured: `JL-G1` in [memory-and-garbage-collection.md](memory-and-garbage-collection.md).
**Check it:** `node --allow-natives-syntax --trace-turbo-inlining --trace-deopt app.js`: an `Inlining … into …` line for the callee, no `bailout` line.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.7 Calls; §6.1.

### `JE-F8` Call a known small function directly, not by spreading an array variable
**Applies in detail:** the callee is small enough to inline and the call runs per element; on V8 15.0 spread and `apply` of an array variable were inlined; Chrome 158 not checked.
**Prefer:**
```js
const r = sum3(a, b, c);         // or sum3(...[a, b, c]) with a literal array
const g = sum3.bind(null, 1);    // bound and .call(...) forms were inlined too
```
**Avoid:**
```js
const r = sum3(...arr);          // arr is a variable
const fwd = (...xs) => sum3(...xs);
```
**Why:** With a fixed target, direct calls, `call`, a bound function, and spread or `apply` of an array literal were inlined; spread or `apply` of an array in a variable, `apply` with `arguments`, and rest forwarding were not; the caller itself stayed TurboFan code in every form ✅[^lab].
**Evidence:** `--trace-turbo-inlining` on Node.js 24.22.1, a CommonJS file, one small callee `sum3`: not inlined for spread and `apply` of an array variable, `apply` with `arguments`, and rest forwarding ✅[^lab]. Same on Node.js 22.23.4 (V8 12.4), 25.7.0 (V8 14.1), Electron 38.8.6 (V8 14.0) and Node.js 24.22.3 with pointer compression (emulated, `--turbofan`). Differs on V8 15.0, in Electron 43.7.7 and Deno 2.9.8 (no sandbox, no pointer compression): spread and `apply` of an array variable were inlined too, `apply` with `arguments` and rest forwarding still not; so the change comes with the V8 version, seen on V8 15.0 and not on V8 12.4 to 14.1 ✅[^lab-matrix]. Not checked in Chrome 158: a page does not get the inlining trace. The time lost by not inlining was not measured.
**Exceptions:** cold code; a callee too large to inline anyway (`JE-F5`); a variable-length argument list, where spread is the only correct form.
**Check it:** `node --allow-natives-syntax --trace-turbo-inlining app.js | grep 'Inlining .*<callee name>'`.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.7; §6.1; §6.4.

### `JE-F9` `try`/`catch`, generators, `async` and `for…in` do not block optimization (a generator still costs per call)
**Applies in detail:** TurboFan compiled small functions with each of these forms on V8 12.4 to 15.8; `try`/`catch`, `arguments` and `for…in` over an object cost no time on all three engines.
**Keep writing:** the form that is correct and clear. The old "optimization killers" list ✅[^bluebird] described Crankshaft, the compiler V8 stopped using in V8 5.9 (2017) ✅[^launch-tf]. These forms do not block optimization, but they are not all free: turning a plain hot function into a generator is a cost (one value per call cost 5.5 to 108 times a plain call on every engine) ✅[^lab-cross].
**Why:** TurboFan was designed to optimize all language features ✅[^launch-tf], and the list of reasons V8 refuses to optimize a function has no entry for any of these ✅[^bailout-reason].
**Evidence:** Node.js 24.22.1, small functions, forced optimization: TurboFan code for `try`/`catch`, one that throws every call, `try`/`finally`, a generator, an `async` function with `await`, `for…of`, `for…in`, a loop over `arguments`, a function calling `eval`, and one using `with`; natural tier-up (inlining off, `--single-threaded`, up to 40,000 calls): 16 subjects (not `for…of` or `async`) reached TurboFan between call 1,465 and call 15,991, against 938 and 11,321 for two plain controls ✅[^lab]. Same on V8 12.4, 14.1 and 15.0 at other call counts (the emulated x64 builds start with TurboFan off, so only their `--turbofan` runs count). Chrome 158, read from the status: all ten forced subjects were TurboFan code, and so were the catalog's `try`/`catch`, `arguments`, `eval`, `with`, `for…in` and closure functions; in natural tier-up all eighteen reached TurboFan with `--no-efficiency-mode`, while in default headless runs some stayed Maglev code, controls included (efficiency mode: `JE-M13` in [measuring-performance.md](measuring-performance.md)) ✅[^lab-matrix].
**Other engines:** In 10⁵ calls of a small function, `try`/`catch` ran 0.98 to 1.15 times the plain function on SpiderMonkey and 0.98 to 1.00 on JavaScriptCore, `arguments[0]` 0.99 to 1.01, and `for…in` over a 4-key object took 0.37 to 0.40 and 0.46 to 0.68 times `Object.keys` (V8 0.25 to 0.27), so removing it would cost. One generator read with `.next().value` per value took 51 to 60 times the plain function on SpiderMonkey, 5.5 to 13.4 on JavaScriptCore, 101 to 108 on Node.js 24.22.1 (macOS) and 22.8 to 23.0 in Chrome 158 ✅[^lab-cross]. `async` and `with` were not run off V8.
**Exceptions:** larger functions with these features were not tested. `for…in` over an array is a separate cost (`JE-N8` in [numbers-and-arrays.md](numbers-and-arrays.md)); a direct `eval` still costs per call (`JE-F10`). The speed of `await` was not timed.
**Check it:** `node --allow-natives-syntax` (in Chrome, `--js-flags=--allow-natives-syntax`) and `%GetOptimizationStatus(fn)` after warm-up, read as `JE-M7` in [measuring-performance.md](measuring-performance.md) says.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.8; §6.1; [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md), Lookup notes "Corrections found while checking the sources"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4.15 and §5.3.

### `JE-F10` Keep direct `eval` out of hot functions (and `with`, which was not timed)
**Applies in detail:** `eval(` called by name inside a function (not `(0, eval)(…)`), `with (obj) { … }` in sloppy code, or a template engine calling `eval` inside the hot function; the function runs per request or per element, even when the `eval` branch never runs; holds on all three engines in the catalog's call shape (one call site), most strongly on SpiderMonkey; V8 alone loses the cost when it inlines the function into a loop that passes a constant (see Other engines).
**Prefer:**
```js
const evaluate = new Function('a', 'b', code);   // built once, values as parameters
for (const row of rows) out.push(evaluate(row.a, row.b));
```
**Avoid:**
```js
function calc(a, b, code) { let s = a + b; if (code) eval(code); return s; }
```
**Why:** A direct `eval` (called by name, not as `(0, eval)(…)`) runs in the function's own scope, while indirect eval runs in the global scope and does not read local variables ✅[^mdn-eval]. So V8 moves the function's variables from registers into a heap context object and allocates it, and an `arguments` object, on every call; TurboFan still compiles the function, and the cost is the per-call allocation and context access ✅[^lab]. MDN says `with` repeats the property lookup each time an identifier is used ✅[^mdn-with]; the lab did not time it.
**Evidence:** Node.js 24.22.1, the same body with and without a direct `eval` that never runs: 1,084 scavenges (young-generation garbage collections) against 0 over 10⁵ warm-up and 7 × 10⁶ timed calls, `CreateFunctionContext` and `CreateUnmappedArguments` in the bytecode, 15 context-slot loads and stores against 0; 16.6 ms against 1.2 ms median of 7 rounds of 10⁶ calls, one run with no range recorded ✅[^lab]. 1,084 on V8 14.1, 1,102 on V8 12.4, 542 with pointer compression on (Electron 43, Node.js 24.22.3): compression halves the count, the allocations are the same. Chrome 158: `withEval` / plain 8 to 35 times (5 to 31 in default headless; about 14 to 22 on the baseline), the plain function taking 0.3 to 1.4 ms, a few steps of the 0.1 ms timer, so the ratio is not stable ✅[^lab-matrix].
**Other engines:** In one call site with a constant `''`, a direct `eval` that never runs made the function 94 to 99 times slower on SpiderMonkey and 18.1 to 27.6 times on JavaScriptCore, against 25.3 to 25.4 (Node.js 24.22.1, macOS) and 17.8 to 18.3 (Chrome 158). In a loop of its own SpiderMonkey still paid 95 to 102 times and JavaScriptCore 10.1 to 21.9, while V8 showed nothing (0.84 to 1.05) because it inlined the function into that loop; through a shared call site V8 paid 3.6 to 10.4 times, SpiderMonkey 13.3 to 14.6 and JavaScriptCore 2.0 to 3.4. Indirect `eval` and a `new Function` built once cost nothing in a loop of their own on any engine (0.89 to 1.04) ✅[^lab-cross].
**Exceptions:** a function called a handful of times (a REPL, a build script); indirect eval runs in the global scope and does not create the context.
**Check it:** `node --print-bytecode --print-bytecode-filter=<fn> app.js | grep CreateFunctionContext`: no line after the fix. In a page, time both versions instead.
**Full lab:** [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md), `direct-eval-scope`; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4.16 and §5.3.

### `JE-F11` Small temporary objects in optimized code need no hand-inlining
**Keep writing:** the small object, as long as it is not stored outside (array, field, closure, return value) and its helper is small enough to inline.
**Why:** Escape analysis proves the object never leaves the optimized function and removes the allocation ✅[^escape-h]; it is built only if the code deopts.
**Evidence:** Node.js 24.22.1, one `{ x, y }` per call of a small helper, 10 million calls in a TurboFan loop: 0 scavenges; with `--no-turbo-escape`, or with each object also stored in an outside array, more than 20 ✅[^lab]. Same on V8 12.4, 14.1 and 15.0 (TurboFan); Maglev's own escape analysis is off on V8 12.4 ✅[^lab-matrix]. `{ value, done }` and range objects were not run. Not checked in Chrome: a page does not get the trace.
**Other engines:** 10⁶ steps calling a helper that returns `{ x, y }` and reading both fields ran 0.99 to 1.00 times loose variables on JavaScriptCore and 1.00 on V8 (Node.js 24.22.1, macOS; Chrome 158); on SpiderMonkey (Firefox 161) loose variables took 3.9 to 4.3 ms in every run and the helper form the same in five of nine runs (0.98 to 1.04 times) but 0.93 to 1.05 ms in the other four (0.22 to 0.25 times, all four in the re-run), cause not found; hand-inlining the object gained nothing on any of the three engines and cost about 4 times on SpiderMonkey in four of nine runs ✅[^lab-cross]. Only time was observed there; allocations were counted on V8 only.
**Exceptions:** the object is stored anywhere outside, or the callee is not inlined (`JE-F2`, `JE-F5`): then it is allocated. Arrays (from `map`, `slice`, `Array.from`, a literal) and objects that are returned or stored are allocated per call: `JL-G6` in [memory-and-garbage-collection.md](memory-and-garbage-collection.md).
**Check it:** `node --trace-gc app.js | grep -c Scavenge` over a long run of the hot loop: flat as the loop count grows.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §3.6 Escape analysis; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4.17.

### `JE-F12` In a hot loop over a large array, prefer an index `for` to `forEach` (and to `for…of` in code for every browser)
**Applies in detail:** a loop a profile points at, or per-element work over thousands of items; `forEach` was slower than the index `for` on all three engines, by an engine-dependent factor; `for…of` was near it only on V8.
**Prefer:**
```js
let s = 0;
for (let i = 0; i < arr.length; i++) s += arr[i];
```
**Avoid:**
```js
let s = 0;
arr.forEach((v) => { s += v; });   // in a function a profile shows as hot
```
**Why:** The cause of the gap was not isolated. What the lab showed: the tier that runs the function matters most; a function called a few times over a huge array runs its `for` loop in OSR code, while `forEach` loops inside the built-in; even with every form in TurboFan code, `forEach` stayed slower (its callback adds into a variable of the outer function, a suspected cause that was not tested) ✅[^lab]. In Chrome 158, a run left in Maglev code made `reduce` the slowest form ✅[^lab-matrix].
**Evidence:** Node.js 24.22.1, summing small integers, four runs, ratios to the index loop: 1,000 items × 20,000 calls (all TurboFan): `for…of` 1.15 to 1.22, `forEach` 1.84 to 1.94, `reduce` 0.81 to 0.85; 1,000,000 items × 20 calls: `forEach` 6.7 to 7.1; with a second body (`if (v & 1) s += v * v`) and other sizes, all TurboFan: `forEach` 1.30 to 1.90, `reduce` 0.82 to 0.89 (plain sum) and 1.28 to 1.40 (second body) ✅[^lab]. On V8 12.4, for the second body the index loop was the slowest form (`forEach` and `reduce` 0.82 to 0.86); on V8 14.1 `forEach` 2.2 to 3.0 and `reduce` 0.80 to 0.96; on Electron 43 (V8 15.0) `forEach` 2.7 to 3.2 (sum) and 4.6 to 6.3 (second body). Chrome 158, TurboFan code, 1,000 items × 20,000 calls: `for…of` 0.96 to 0.97, `forEach` 2.64 to 2.67, `reduce` 0.99 to 1.00 (the same in a visible window and with `--no-efficiency-mode`); in the other workloads `forEach` 2.61 to 3.13 (sum) and 4.55 to 6.19 (second body), `reduce` 0.99 to 1.03 and 0.76 to 0.86; a default-headless run left in Maglev code gave `for…of` 2.42, `forEach` 2.38 and `reduce` 4.02 ✅[^lab-matrix]. What holds on both Node.js 24.22.1 and Chrome 158: `forEach` costs most once all forms are TurboFan code. The timing scripts were not run on the emulated x64 builds.
**Other engines:** With warmed code (100 calls over 1,000 items), `forEach` took 4.48 to 4.87 times the index loop on SpiderMonkey and 1.55 to 1.86 on JavaScriptCore (V8 1.71 to 1.79 in Node.js 24.22.1 on macOS, 2.55 to 2.68 in Chrome 158); in the first call over 10⁷ items the index `for` was the fastest form on every engine (5.0 to 8.9 ms against up to 69.8). `for…of`: 3.78 to 4.00 times in Firefox, 2.38 to 2.45 in the JavaScriptCore shell, 1.22 to 1.50 in Bun and the WebKit page, against 1.09 to 1.13 (Node.js) and 0.94 to 0.98 (Chrome); `reduce` 4.07 to 4.40 in Firefox and 1.04 to 1.42 on JavaScriptCore ✅[^lab-cross].
**Exceptions:** short arrays or cold code: whichever form is clearest, `for…of` included. For code that runs only on V8 (Node.js, Electron, Chrome-only), one benchmark is no reason to rewrite `reduce` or `for…of` to `for` or back: `reduce` was faster than the index loop for one body and slower for another, the order changed with the V8 version, and in Chrome 158 both were within 0.76 to 1.03 times the index loop with TurboFan code ✅[^lab-matrix]. For a hot loop that must be fast in every browser, the index `for` is the one form that held on all three engines.
**Check it:** time both forms after the warm-up of `JE-M1`, with the production array size and call count (`JE-M2`), both in [measuring-performance.md](measuring-performance.md), on the build and each engine you ship to; in Chrome, in the front tab or in headless Chrome as `JE-M13` says.
**Full lab:** [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §4.2 Four loop forms, timed in two workloads; §6.4; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4.18 and §5.3.

## Takeaways
- A read site that sees 5 or more shapes goes megamorphic and stays so; one factory or one helper per type keeps it at 4 or fewer. [rule-candidate]
- Most of the old "optimization killers" (`try`/`catch`, `arguments`, rest parameters, closures, `bind`, long comments) were optimized by TurboFan on every V8 build tried; there is no reason to rewrite code for them.
- Generators and direct `eval` still cost per call, and spread of an array variable blocked inlining on V8 12.4 to 14.1 (not on 15.0); they are kept out of hot per-call code.
- A generated function past about 60 KB of bytecode gets no TurboFan code on Node.js 24, and every engine slowed past some size: split generated code per rule.
- For a hot loop that must be fast on every engine, the index `for` is the only form that held everywhere; on V8 alone, in warmed loops over small arrays, `reduce` and `for…of` were close to it (not in a first call over 10⁷ items, where `for…of` took 7 to 9 times as long).

## Verification status
- Verified: 108 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab: the baseline runs on Node.js 24.22.1 (V8 13.6.233.17-node.58), linux arm64, pointer compression off, image `node:24.22.1-alpine` in Docker on an Apple M2 with `--network none`, 2026-11-26; scripts and outputs in [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §2 to §4 and §6.1, and in [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md), Catalog and Lookup notes. Rank 1 (primary measurement). Backs: every claim with the `lab` footnote. [^lab]
- Lab matrix: the same scripts re-run on 2026-11-27 on Node.js 24.22.1 on macOS 26.1 arm64 and on linux x64 emulated, Node.js 22.23.4 (V8 12.4.254.21), Node.js 25.7.0 (V8 14.1.146.11), Electron 43.7.7 as Node (V8 15.0.245.31, pointer compression and V8 sandbox on), the Node.js project's unofficial pointer-compression build of Node.js 24.22.3 (V8 13.6, linux x64 emulated), and for narrowing runs Deno 2.9.8 (V8 15.0.245.2) and Electron 38.8.6 (V8 14.0.365.10); Google Chrome 158.0.8127.89 (V8 15.8.62.31) headless on macOS arm64 the same day, and in a visible window on 2026-11-28; differing outputs in [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) §6.4 and [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md), Lookup notes "Other builds and versions". Rank 1 (primary measurement). Backs: every claim with the `lab-matrix` footnote. [^lab-matrix]
- Lab cross-engine: engine-neutral scripts of these rules, each run three times on 2026-11-28 on one Apple M2 with macOS 26.1, on SpiderMonkey (Firefox 161.0, headless), JavaScriptCore (the `jsc` shell of the macOS 26.1 framework 21622.2.11.11.9, Bun 1.4.5, a page of the Playwright WebKit build 2311) and V8 (Node.js 24.22.1 on macOS arm64; Chrome 158 in a visible window); ratios of the lowest times; scripts and outputs in [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) §4. Rank 1 (primary measurement). Backs: every claim with the `lab-cross` footnote. [^lab-cross]
- [src/ic/ic.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/ic/ic.cc) — V8 project, 2025. Rank 1. Backs: Scope (IC states); `JE-F1`, `JE-F4` (megamorphic limit, one-way states). [^v8-ic]
- [V8 src/flags/flag-definitions.h](https://github.com/v8/v8/blob/13.6.233.17/src/flags/flag-definitions.h) — V8 project, tag 13.6.233.17. Rank 1. Backs: `JE-F1` (polymorphic limit 4), `JE-F6` (60 KB). [^v8-flags]
- [src/execution/tiering-manager.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/execution/tiering-manager.cc) — V8 project, 2025. Rank 1. Backs: Scope (OSR); `JE-F4` (no deopt counter), `JE-F6` (too-big functions rejected). [^tiering]
- [src/compiler/js-inlining-heuristic.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/compiler/js-inlining-heuristic.cc) — V8 project, 2025. Rank 1. Backs: `JE-F2` (feedback names the target), `JE-F5` (cumulative budget). [^inl-heur]
- [src/objects/shared-function-info.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/shared-function-info.h) — V8 project, 2025. Rank 1. Backs: `JE-F5` (`reason: 5`). [^sfi-h]
- [src/codegen/bailout-reason.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/codegen/bailout-reason.h) — V8 project, 2025. Rank 1. Backs: `JE-F6`, `JE-F9` (reasons not to optimize). [^bailout-reason]
- [src/compiler/escape-analysis.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/compiler/escape-analysis.h) — V8 project, 2025. Rank 1. Backs: Scope; `JE-F11`. [^escape-h]
- [eval()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval) — MDN, living. Rank 3. Backs: `JE-F10` (direct and indirect eval). [^mdn-eval]
- [with](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/with) — MDN, living. Rank 3. Backs: `JE-F10`. [^mdn-with]
- [Math.imul()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/imul) — MDN, living. Rank 3. Backs: `JE-F3`. [^mdn-imul]
- [Maglev - V8’s Fastest Optimizing JIT](https://v8.dev/blog/maglev) — V8 team, 2023. Rank 4. Backs: Scope (tiers, deoptimization); `JE-F3`. [^maglev]
- [Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) — V8 team, 2017. Rank 4. Backs: `JE-F9` (Crankshaft retired in V8 5.9; TurboFan designed for all language features). [^launch-tf]
- [Faster JavaScript calls](https://v8.dev/blog/adaptor-frame) — V8 team, 2021. Rank 4. Backs: `JE-F7`. [^adaptor]
- [Optimization killers](https://github.com/petkaantonov/bluebird/wiki/Optimization-killers) — bluebird project wiki (community), 2018. Rank 6. Backs: `JE-F9`, the old beliefs only. [^bluebird]
- [A tour of V8: Crankshaft, the optimizing compiler](https://www.jayconrod.com/posts/54/a-tour-of-v8--crankshaft--the-optimizing-compiler) — Jay Conrod (personal blog), 2013. Rank 6. Backs: `JE-F5`, the 600-character rule. [^conrod]
- [[turbofan] Don't take into account source size for inlining heuristics](https://codereview.chromium.org/2361813002) — Chromium code review (Benedikt Meurer), 2016. Rank 6. Backs: `JE-F5`. [^cr-inline-size]

## Related
- [v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) — the tiers, inline caches, deoptimization, inlining and escape analysis in full, with every script.
- [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) — which of these rules hold on SpiderMonkey and JavaScriptCore.
- [problem-classes-javascript-engine.md](../../performance/code-review/problem-classes-javascript-engine.md) — the code-review catalog of V8 engine costs these rules come from.
- [measuring-performance.md](measuring-performance.md) — how to time these rules and read tiers on your own build (`JE-M`).
- [objects-and-shapes.md](objects-and-shapes.md) — building objects with one shape (`JE-O1`).
- [numbers-and-arrays.md](numbers-and-arrays.md) — number fields (`JE-N2`) and `for…in` over arrays (`JE-N8`).
- [memory-and-garbage-collection.md](memory-and-garbage-collection.md) — closures that keep memory alive (`JL-G1`) and per-call arrays (`JL-G6`).
