---
schema: deep-dive/v1
topic: js-runtime
status: verified
applies-to: ["Node.js 24.22.1 with V8 13.6.233.17-node.58, linux arm64 (image node:24.22.1-alpine in Docker on an Apple M2)", "V8 source at tag 13.6.233.17", "lab runs of 2026-11-26"]
last-updated: 2026-11-26
last-verified: 2026-11-26
synthesized-into: []
tags: [v8, nodejs, jit, ignition, sparkplug, maglev, turbofan, turboshaft, inline-caches, deoptimization, osr, inlining, escape-analysis, performance]
ranked-sources: true
---

# V8's compiler pipeline in Node.js 24: tiers, feedback, deoptimization and what keeps code fast

## Summary
**TL;DR:** In Node.js 24.22.1 (V8 13.6), every function starts as bytecode in the Ignition interpreter. Hot functions move up to three compilers in turn: Sparkplug, Maglev and TurboFan ✅[^lab]. Maglev and TurboFan guess types from the feedback that the lower tiers collected. When a guess fails, the code deoptimizes: it jumps back to the interpreter at the same bytecode, and V8 records the new case ✅[^lab] ✅[^maglev]. The lab shows that the old advice about `try`/`catch`, `arguments`, generators, `eval` and "600-character functions" no longer holds in this version: for the small functions tried here, TurboFan compiled all of them, both when optimization was forced after warm-up (status bit 6 read after `%OptimizeFunctionOnNextCall`) and in natural tier-up with inlining switched off (§3.8) ✅[^lab]. What still costs, and can be seen with a flag, is code that keeps the compilers' guesses wrong: many object shapes at one site, small integers that overflow, reads past the end of an array, and branches that never ran before optimization ✅[^lab].

**Use this when:**
- you want to know which compiler runs a hot function, and why it moved up or fell back;
- you read `--trace-opt`, `--trace-deopt` or `%GetOptimizationStatus` output and need the meaning of each field and bit in this V8 version;
- you review advice such as "avoid `try`/`catch` in hot code" or "`forEach` is slower than `for`" and want to know what V8 13.6 actually does;
- you write a micro-benchmark and need to know what the tiers do to it.

**Depth:** parsing and lazy compilation in one paragraph (the details are in the startup deep dive); the four tiers and the tier-up triggers of this build, with their flag defaults; feedback vectors; inline caches and their states at loads and stores; speculative optimization; eager and lazy deoptimization with seven real `--trace-deopt` outputs; how V8 stops deoptimization loops; on-stack replacement; inlining and its limits; escape analysis; calls (argument count mismatch, rest parameters, `arguments`, bound functions, closures, `call`, `apply`, spread); `try`/`catch`, generators and `async` functions; built-in array methods; every `%GetOptimizationStatus` bit of V8 13.6, decoded, with 23 of the 24 bits seen in a run; timed comparisons of loop forms (three sizes, two bodies, a warm-up check); a "Corrections" section (§6.1) that checks eleven popular beliefs against the lab.

## 1. Mental model

### 1.1 Words first

| Term | Plain meaning | Analogy | Concrete example (from the lab of this doc) |
|---|---|---|---|
| JIT (just-in-time compiler) | A compiler that turns code into machine code while the program runs | A translator who starts translating a speech only once it turns out to be long | Maglev compiled `sum` after its 70th call (§2.2) |
| Bytecode | A compact list of simple instructions that V8 makes from a function's source | A recipe card written in short commands | `getX` has a property load at bytecode offset 0 (§3.2) |
| Tier | One of V8's four ways to run a function: interpreter or one of three compilers | Gears of a bicycle: low gears start easily, high gears go fast | Ignition, then Sparkplug, Maglev, TurboFan (§2.2) |
| Tier-up | The move of a function to a higher tier once it has run enough | Shifting up a gear once the bike is rolling | `sum` reached TurboFan at call 1957 with `--single-threaded` (§2.2) |
| Feedback vector | A per-function table where V8 records what each operation saw: shapes, types, call targets | A notebook kept next to each machine on a factory floor | After 2 calls `addOne` has none, and TurboFan prints "no feedback vector"; after 20 calls it has one (§2.3) |
| Map (hidden class) | V8's internal description of an object's shape: which properties, in which order | The layout plan of a shelf | `{ x }` and `{ y, x }` have different maps (§3.2) |
| IC (inline cache) | A fast path at one property access or call site, built from the maps seen there | A cashier who remembers the price of the items regular customers buy | State `1` after one map, `P` after two to four, `N` after five (§3.1) |
| Monomorphic, polymorphic, megamorphic | One map seen at a site; a few (2 to 4 here); too many | A shop with one product, a short menu, a whole supermarket | `LoadIC line 5 key x: P -> N` when the 5th map arrives (§3.1) |
| Smi (small integer) | An integer stored directly in a pointer-sized value, without a heap object | Coins kept in the pocket instead of a wallet | Up to 2**31 − 1 in this build (§3.2) |
| Speculative optimization | Compiling for the types seen so far, with a check that bails out if a new type shows up | Laying out only the tools you used yesterday, with an alarm for surprises | `inc(a)` compiled for small integers (§3.2) |
| Deoptimization (deopt) | Leaving optimized code and continuing in the interpreter at the same point | Leaving the motorway at the next exit when the road ahead is closed | `reason: overflow` when `inc(2 ** 31 - 1)` overflows (§3.2) |
| Eager / lazy deopt | Eager: a check inside the optimized code fails now. Lazy: something else invalidated the code; the function leaves it when control returns to it | Eager: you see the closed road. Lazy: the radio says the road is closed, and you leave at the next exit | `deopt-eager, reason: wrong map`; `deopt-lazy` after `P.prototype.m` was replaced (§3.2) |
| Deopt loop | Optimize, deopt, optimize again, deopt again, without end | A thermostat that keeps flipping between heat and cool | Ends after the 5th map here, because the site becomes megamorphic (§3.3) |
| OSR (on-stack replacement) | Switching a function that is still running a loop into optimized code, in the middle of the loop | Changing a train's engine while it is moving | `[OSR - entry. function: longLoop, osr offset: 35]` (§3.4) |
| Inlining | Copying a called function's body into the caller's optimized code | Writing a friend's phone number into your own notes instead of looking it up | `Inlining {<SharedFunctionInfo addOne>} into {<SharedFunctionInfo caller>}` (§3.5) |
| Escape analysis | Proving that an object never leaves a function, so it need not be allocated at all | Doing a sum in your head instead of on paper you would then throw away | 10 million `{ x, y }` objects, 0 scavenges (§3.6) |
| Scavenge | A collection of the young generation of the heap (GC = garbage collection) | Emptying the small desk bin, not the building's skip | "more than 20" scavenges once escape analysis is off (§3.6) |
| Built-in | A function that ships inside V8, such as `Array.prototype.forEach` | A tool that came in the box | `forEach`'s callback inlined into the caller (§3.9) |
| Natives syntax | Test-only functions such as `%GetOptimizationStatus(f)`, enabled by `--allow-natives-syntax` | The service panel behind a machine's cover | Status `81` = `IsFunction|Optimized|TurboFanned` (§4.1) |

### 1.2 The pipeline in one picture

```
source text ──parse (lazily)──▶ bytecode ──▶ Ignition (interpreter, collects feedback)
                                               │  enough calls and loop iterations
                                               ▼
                                            Sparkplug (bytecode → machine code, no guesses)
                                               │
                                               ▼
                                            Maglev (fast optimizing compiler, guesses from feedback)
                                               │
                                               ▼
                                            TurboFan (slow optimizing compiler, best code; Turboshaft backend)
          ▲                                    │
          └──── deoptimization: back to the interpreter at the same bytecode, feedback updated
```

Each arrow is taken only by a function that keeps running (§2.2) ✅[^lab]. A loop that runs long inside a single call can jump to optimized code in the middle of the call (OSR, §3.4) ✅[^lab].

## 2. Concept architecture

### 2.1 Before the first tier: parsing and lazy compilation

V8 does not make a function's bytecode when the file loads, but on the function's first call. The status bit `IsLazy` shows this: a function that was never called has only `IsFunction|IsLazy` set, and after one call it has `IsFunction|Interpreted` ✅[^lab] (script in §4.1). How the scanner, the pre-parser, eager-compilation hints and the code cache work is the subject of `js-runtime/v8-memory-and-startup-deep-dive.md`.

### 2.2 The four tiers, and when each takes over

| Tier | What it is | What its code does | Since |
|---|---|---|---|
| Ignition | A register-based interpreter ✅[^ignition-docs] with an accumulator register that many bytecodes use as an implicit input and output ✅[^ignition-blog] | Runs bytecode one instruction at a time and fills the feedback vector | Blog of 2016-08-23 ✅[^ignition-blog]; since V8 5.9 the older Full-codegen and Crankshaft compilers are no longer used ✅[^launch-tf] |
| Sparkplug | A non-optimizing compiler that "compiles from bytecode rather than from JavaScript source" ✅[^sparkplug], "in a single linear pass over the bytecode" ✅[^sparkplug] | Same work as the interpreter, without the dispatch cost; it keeps the interpreter's frame layout ✅[^sparkplug]; the tiering code calls baseline code "feedback independent" ✅[^tiering] | Blog of 2021-05-27 ✅[^sparkplug] |
| Maglev | A fast optimizing compiler that "generates good enough code, fast enough" ✅[^maglev] | Uses feedback to emit shape checks and cheap field loads; "Maglev code needs to be able to deoptimize" ✅[^maglev] | Blog of 2023-12-05 ✅[^maglev] |
| TurboFan | V8's "optimizing compiler focused on peak performance" ✅[^maglev] | Inlines, removes allocations, specializes on feedback. Since the post of 2025-03-25, "the whole JavaScript backend of Turbofan uses Turboshaft instead" of the older Sea of Nodes graph ✅[^sea-of-nodes] | Default since V8 5.9 (post of 2017-05-15) ✅[^launch-tf] |

The Maglev post (2023-12-05) puts Maglev's compile speed at "roughly 10x slower than Sparkplug, and 10x faster than TurboFan" ✅[^maglev]. All four tiers, and the Turboshaft phases, are on by default in this build ✅[^lab].

**What triggers tier-up in 13.6.** V8 gives each function a budget. The budget is a flag value times the function's bytecode length: `invocation_count_for_maglev * bytecode_length` for Maglev and `invocation_count_for_turbofan * bytecode_length` for TurboFan ✅[^tiering]. The defaults in this build are 400 and 3000, and 8 for allocating the feedback vector; each is the default that `node --v8-options` prints for the flag named above ✅[^lab]. Sparkplug has no number of its own: the tiering code tests whether the function already has a feedback vector and can be compiled to baseline code, and the budget for that first step is the feedback-allocation budget ✅[^tiering]. A function whose bytecode is longer than `--max-optimized-bytecode-size` (61440 bytes here) gets no TurboFan code: the source returns a huge budget for it and rejects it in `ShouldOptimize` ✅[^tiering]. In the lab (`toobig.mjs`, below), a function of 3 250 statements (60 988 bytes of bytecode) was TurboFan code after forced optimization and one of 3 400 statements (63 838 bytes) was not, until the flag was raised to 200 000 ✅[^lab]. When an inline cache changes state, V8 raises the budget to `--minimum-invocations-after-ic-update` (500) times the bytecode length (capped), only if that is larger than the current budget, so optimization waits ✅[^tiering] ✅[^lab].

<details><summary>Script <code>toobig.mjs</code>: a function over <code>--max-optimized-bytecode-size</code></summary>

```js
// Run: node --allow-natives-syntax toobig.mjs   (a function over --max-optimized-bytecode-size: TurboFan, forced)
import { spawnSync } from 'node:child_process';
if (process.argv[2]) {
  const k = Number(process.argv[2]);
  const f = new Function('a', 'let t = a;' + 't = (t * 3 + 1) | 0;'.repeat(k) + 'return t;');
  %PrepareFunctionForOptimization(f); f(1); f(2); %OptimizeFunctionOnNextCall(f); f(3);
  console.log(`TurboFan=${!!(%GetOptimizationStatus(f) & 64)}`);
} else {
  for (const flags of [[], ['--max-optimized-bytecode-size=200000']]) for (const k of [3100, 3200, 3250, 3400]) {
    const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--print-bytecode', ...flags, new URL(import.meta.url).pathname, String(k)], { encoding: 'utf8', maxBuffer: 1 << 29 });
    const lens = [...r.stdout.matchAll(/Bytecode length: (\d+)/g)].map((m) => Number(m[1]));
    console.log(`${(flags[0] ?? '(default)').padEnd(40)} ${k} statements, bytecode ${Math.max(...lens)}: ${r.stdout.match(/TurboFan=(true|false)/)?.[0]}`);
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax toobig.mjs`

```text
(default)                                3100 statements, bytecode 58138: TurboFan=true
(default)                                3200 statements, bytecode 60038: TurboFan=true
(default)                                3250 statements, bytecode 60988: TurboFan=true
(default)                                3400 statements, bytecode 63838: TurboFan=false
--max-optimized-bytecode-size=200000     3100 statements, bytecode 58138: TurboFan=true
--max-optimized-bytecode-size=200000     3200 statements, bytecode 60038: TurboFan=true
--max-optimized-bytecode-size=200000     3250 statements, bytecode 60988: TurboFan=true
--max-optimized-bytecode-size=200000     3400 statements, bytecode 63838: TurboFan=true
```
</details>

<details><summary>Script <code>flags.mjs</code>: the tiering flags and their defaults in this build</summary>

```js
// Run: node flags.mjs   (prints the defaults of the tiering flags in this build, from `node --v8-options`)
import { spawnSync } from 'node:child_process';
const text = spawnSync(process.execPath, ['--v8-options'], { encoding: 'utf8' }).stdout;
const names = ['sparkplug', 'maglev', 'turbofan', 'turboshaft', 'concurrent-recompilation', 'concurrent-sparkplug',
  'baseline-batch-compilation', 'lazy-feedback-allocation', 'invocation-count-for-feedback-allocation',
  'invocation-count-for-maglev', 'invocation-count-for-turbofan', 'minimum-invocations-after-ic-update',
  'max-optimized-bytecode-size', 'use-osr', 'maglev-osr', 'osr-from-maglev', 'invocation-count-for-osr',
  'invocation-count-for-maglev-osr', 'max-valid-polymorphic-map-count', 'turbo-inlining', 'maglev-inlining',
  'polymorphic-inlining', 'max-inlined-bytecode-size', 'max-inlined-bytecode-size-small',
  'max-inlined-bytecode-size-cumulative', 'max-maglev-inlined-bytecode-size', 'turbo-inline-array-builtins',
  'turbo-escape', 'maglev-escape-analysis'];
for (const n of names) {
  const m = text.match(new RegExp(`\\n  --${n} \\(.*\\)\\n\\s+type: \\w+  default: (\\S+)`));
  console.log(m ? m[1] : `--${n}: not found`);
}
for (const n of ['max-deopt-count', 'trace-ic', 'log-ic', 'trace-deopt', 'trace-opt', 'trace-osr', 'trace-turbo-inlining'])
  console.log(`--${n} exists: ${text.includes(`\n  --${n} (`)}`);
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node flags.mjs`

```text
--sparkplug
--maglev
--turbofan
--turboshaft
--concurrent-recompilation
--concurrent-sparkplug
--baseline-batch-compilation
--lazy-feedback-allocation
--invocation-count-for-feedback-allocation=8
--invocation-count-for-maglev=400
--invocation-count-for-turbofan=3000
--minimum-invocations-after-ic-update=500
--max-optimized-bytecode-size=61440
--use-osr
--maglev-osr
--no-osr-from-maglev
--invocation-count-for-osr=500
--invocation-count-for-maglev-osr=100
--max-valid-polymorphic-map-count=4
--turbo-inlining
--maglev-inlining
--polymorphic-inlining
--max-inlined-bytecode-size=460
--max-inlined-bytecode-size-small=27
--max-inlined-bytecode-size-cumulative=920
--max-maglev-inlined-bytecode-size=460
--turbo-inline-array-builtins
--turbo-escape
--maglev-escape-analysis
--max-deopt-count exists: false
--trace-ic exists: false
--log-ic exists: true
--trace-deopt exists: true
--trace-opt exists: true
--trace-osr exists: true
--trace-turbo-inlining exists: true
```
</details>

The names say "invocation count", but the lab shows that a function with a loop reaches them in fewer calls. `sum` runs an 8-step loop per call. With `--single-threaded`, it reached Sparkplug at call 28, Maglev at call 70 and TurboFan at call 1957, not at 400 and 3000 calls ✅[^lab]. This fits a budget that the running bytecode, loop iterations included, uses up (an inference from the source and the lab, not stated in the source). A function without a loop needs more calls, not fewer: in the check `natural.mjs` (§3.8; `--single-threaded`, inlining switched off, 40 000 calls) a loop-free `function plain(a) { return a < 0 ? 0 : a; }` first had TurboFan code at call 11 321, and a function with a 20-step loop at call 938 ✅[^lab]. So "400 and 3000" are budget factors, not call counts. Without Maglev, TurboFan took over at call 403 for `sum`. With the default flags, compilation runs on background threads, and the call at which each tier appears changed from run to run: the last line of the output below differs between runs ✅[^lab].

<details><summary>Script <code>tierup.mjs</code>: natural tier-up, without <code>%Optimize…</code> calls</summary>

```js
// Run: node --allow-natives-syntax tierup.mjs   (re-runs itself; natural tier-up, no %Optimize... calls)
import { spawnSync } from 'node:child_process';
if (process.argv[2] === 'child') {
  const tier = (s) => s & 64 ? 'TurboFan' : s & 32 ? 'Maglev' : s & 32768 ? 'Sparkplug' : s & 128 ? 'Ignition' : 'none';
  function sum(arr) { let t = 0; for (let i = 0; i < arr.length; i++) t += arr[i]; return t; }
  const data = [1, 2, 3, 4, 5, 6, 7, 8];
  let last = '';
  const seen = [];
  for (let call = 1; call <= 20000; call++) {
    sum(data);
    const now = tier(%GetOptimizationStatus(sum));
    if (now !== last) { seen.push(process.argv[3] === 'order' ? now : `call ${call}: ${now}`); last = now; }
  }
  console.log(seen.join(' -> '));
} else {
  const run = (flags, mode) => spawnSync(process.execPath, ['--allow-natives-syntax', ...flags,
    new URL(import.meta.url).pathname, 'child', mode], { encoding: 'utf8' }).stdout.trim();
  console.log('--single-threaded:            ', run(['--single-threaded'], 'calls'));
  console.log('--single-threaded --no-maglev:', run(['--single-threaded', '--no-maglev'], 'calls'));
  console.log('--single-threaded --no-maglev --no-turbofan:', run(['--single-threaded', '--no-maglev', '--no-turbofan'], 'calls'));
  console.log('default flags (order only):   ', run([], 'order'));
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax tierup.mjs`. The first three lines repeated in every run; the last line is one run's (others printed `Ignition -> Maglev -> TurboFan` and `Ignition -> none -> Sparkplug -> Maglev`).

```text
--single-threaded:             call 1: Ignition -> call 28: Sparkplug -> call 70: Maglev -> call 1957: TurboFan
--single-threaded --no-maglev: call 1: Ignition -> call 28: Sparkplug -> call 403: TurboFan
--single-threaded --no-maglev --no-turbofan: call 1: Ignition -> call 28: Sparkplug
default flags (order only):    Ignition -> Sparkplug -> Maglev -> TurboFan
```
</details>

**Sparkplug is batched.** The tiering code queues a function for Sparkplug with `baseline_batch_compiler()->EnqueueFunction(function)` when `--baseline-batch-compilation` is on ✅[^tiering]. A separate comment in the same file, in the code that reacts to inline-cache changes, says that tier-up is not delayed for a function that has not yet reached baseline, because "baseline code is feedback independent" ✅[^tiering]. So Sparkplug code can arrive after Maglev code, or not be seen at all in a short run ✅[^lab] (the default-flags line above).

### 2.3 Feedback vectors and type feedback

A feedback vector holds, for each operation of a function, what it has seen: the maps at a property access, the types at an addition, the target at a call ✅[^v8-lite]. Maglev "will look at runtime feedback metadata collected during unoptimized execution" ✅[^maglev]; TurboFan's inlining step requires the callee's feedback vector (§3.5) ✅[^inl-heur]. V8 allocates it lazily. The post of 2019-09-12 says "we lazily allocate feedback vectors after the function has executed a certain amount of bytecode" and gives "(currently 1KB)" ✅[^v8-lite]. In 13.6 the rule is a budget of `bytecode_length * invocation_count_for_feedback_allocation` ✅[^tiering], with the flag at 8 (the default printed by `node --v8-options`, whose help text reads "invocation count required for allocating feedback vectors") ✅[^lab]. Because each call uses up about the function's bytecode length, the budget works out to about 8 calls whatever the length. The check `fv.mjs` below found the first call count at which `%DebugPrint` no longer says "No feedback vector": 9 calls for a one-line function and for a 60-statement function, and 2 calls for a function with an 8-step loop; with the flag set to 2 the numbers were 3, 3 and 1, and with 40 they were 41, 41 and 6 ✅[^lab]. This holds for these three function bodies on this build, with `--allow-natives-syntax`; the exact "+1" was not explained. The lab sees the effect in two more places:
- the first entry for a store site in the IC log is `X -> X`, where `X` means "no feedback" ✅[^lab] ✅[^ic-cc] (§3.1);
- forcing TurboFan after only 2 warm-up calls leaves the callee without a feedback vector, and TurboFan prints `Cannot consider … for inlining (no feedback vector)`; after 20 warm-up calls the same callee is inlined ✅[^lab] ✅[^inl-heur]. The scripts in §3 therefore warm up with 20 to 50 calls.

<details><summary>Script <code>fv.mjs</code>: calls until a feedback vector exists</summary>

```js
// Run: node --allow-natives-syntax fv.mjs   (after how many calls does a feedback vector exist? binary search over child runs)
import { spawnSync } from 'node:child_process';
const src = { short: 'return a + 1;', long: 'let t = a;' + 't = (t * 3 + 1) | 0;'.repeat(60) + 'return t;',
  loop8: 'let t = 0; for (let i = 0; i < 8; i++) t += i; return t + a;' };
if (process.argv[2]) {
  const [name, n] = process.argv.slice(2);
  const f = new Function('a', src[name]);
  for (let i = 0; i < Number(n); i++) f(1);
  %DebugPrint(f);
} else {
  const has = (flags, name, n) => !/No feedback vector/.test(spawnSync(process.execPath, ['--allow-natives-syntax', ...flags,
    new URL(import.meta.url).pathname, name, String(n)], { encoding: 'utf8' }).stdout.match(/feedback vector: .*/)?.[0] ?? 'No feedback vector');
  for (const flags of [[], ['--invocation-count-for-feedback-allocation=2'], ['--invocation-count-for-feedback-allocation=40']]) {
    const row = [];
    for (const name of Object.keys(src)) {
      let lo = 1, hi = 400;                        // smallest n with a feedback vector
      while (lo < hi) { const mid = (lo + hi) >> 1; if (has(flags, name, mid)) hi = mid; else lo = mid + 1; }
      row.push(`${name}: ${lo}`);
    }
    console.log(`${(flags.join(' ') || '(default, flag = 8)').padEnd(46)} calls until a feedback vector exists -> ${row.join(', ')}`);
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax fv.mjs`. The script runs a binary search over child processes; its output repeated on two runs.

```text
(default, flag = 8)                            calls until a feedback vector exists -> short: 9, long: 9, loop8: 2
--invocation-count-for-feedback-allocation=2   calls until a feedback vector exists -> short: 3, long: 3, loop8: 1
--invocation-count-for-feedback-allocation=40  calls until a feedback vector exists -> short: 41, long: 41, loop8: 6
```
</details>

<details><summary>Script <code>feedback.mjs</code>: inlining needs the callee's feedback vector</summary>

```js
// Run: node --allow-natives-syntax feedback.mjs   (re-runs itself with --trace-turbo-inlining)
import { spawnSync } from 'node:child_process';
const warmups = Number(process.argv[2]);
if (warmups) {
  function addOne(a) { return a + 1; }
  function caller(x) { return addOne(x) * 2; }
  %PrepareFunctionForOptimization(caller);
  for (let i = 0; i < warmups; i++) caller(i);
  %OptimizeFunctionOnNextCall(caller); caller(1);
} else {
  for (const n of ['2', '20']) {
    const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--trace-turbo-inlining',
      new URL(import.meta.url).pathname, n], { encoding: 'utf8' });
    console.log(`--- ${n} warm-up calls before %OptimizeFunctionOnNextCall`);
    console.log(r.stdout.trim().split('\n').map((l) => l.replace(/0x[0-9a-f]+ \{0x[0-9a-f]+ /g, '{').replace(/0x[0-9a-f]+ /g, '')).join('\n'));
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax feedback.mjs`

```text
--- 2 warm-up calls before %OptimizeFunctionOnNextCall
Cannot consider {<FeedbackCell[one closure]>} for inlining (no feedback vector)
--- 20 warm-up calls before %OptimizeFunctionOnNextCall
Considering {<SharedFunctionInfo addOne>} for inlining with {<FeedbackVector[1]>}
Inlining small function(s) at call site #18:JSCall
Inlining {<SharedFunctionInfo addOne>} into {<SharedFunctionInfo caller>}
```
</details>

## 3. How it works

### 3.1 Inline caches and their states

The shapes and maps themselves are explained in `js-runtime/v8-hidden-classes.md`; this section shows the states in this build. Each property load, store and call site has a slot in the feedback vector, and V8 logs its state with `--log-ic`. This build has no `--trace-ic` flag ✅[^lab]. The log writes each state as one character ✅[^ic-cc]:

| Mark | State | Meaning |
|---|---|---|
| `X` | NO_FEEDBACK | No feedback vector yet |
| `0` | UNINITIALIZED | Never executed |
| `1` | MONOMORPHIC | One map seen |
| `^` | RECOMPUTE_HANDLER | Same map, new handler needed |
| `P` | POLYMORPHIC | 2 to 4 maps |
| `N` | MEGAMORPHIC | More maps than the limit: a generic, slower lookup |
| `D` | MEGADOM | A DOM-specific megamorphic state |
| `G` | GENERIC | A generic keyed access |

A site goes megamorphic when the number of valid maps reaches `--max-valid-polymorphic-map-count` ✅[^ic-cc], which is 4 here ✅[^lab]. The lab feeds six objects of different maps to one load (`o.x`) and one store (`o.y = v`). Both sites go `0 -> 1` on the first map, `1 -> P` on the second, stay `P` for the third and fourth, and go `P -> N` on the fifth ✅[^lab]. After `N` the site does not come back.

<details><summary>Script <code>ic.mjs</code>: IC states of one load and one store site</summary>

```js
// Run: node ic.mjs   (re-runs itself with --log-ic and prints the state changes of the sites below)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
if (process.argv[2] === 'child') {
  function getX(o) { return o.x; }        // line 5: a property load
  function setY(o, v) { o.y = v; }        // line 6: a property store (y already exists)
  const shapes = [];
  for (let k = 0; k < 6; k++) { const o = {}; o['p' + k] = 0; o.x = k; o.y = 0; shapes.push(o); }
  for (let i = 0; i < 12; i++) { getX(shapes[0]); setY(shapes[0], i); } // warm-up: one shape
  for (const o of shapes) { console.log(`feeding shape ${shapes.indexOf(o) + 1}`); getX(o); setY(o, 1); }
} else {
  const log = '/tmp/ic-lab.log';
  const r = spawnSync(process.execPath, ['--log-ic', `--logfile=${log}`, '--no-logfile-per-isolate',
    new URL(import.meta.url).pathname, 'child'], { encoding: 'utf8' });
  console.log('child stdout:', r.stdout.trim().split('\n').join(' / '));
  // Columns of an IC line: kind, pc, time, line, column, old state, new state, map, key, ...
  for (const l of readFileSync(log, 'utf8').split('\n')) {
    const f = l.split(',');
    if (/IC$/.test(f[0]) && (f[3] === '5' || f[3] === '6') && (f[8] === 'x' || f[8] === 'y'))
      console.log(`${f[0].padEnd(8)} line ${f[3]} key ${f[8]}: ${f[5]} -> ${f[6]}`);
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node ic.mjs`

```text
child stdout: feeding shape 1 / feeding shape 2 / feeding shape 3 / feeding shape 4 / feeding shape 5 / feeding shape 6
StoreIC  line 6 key y: X -> X
LoadIC   line 5 key x: 0 -> 1
StoreIC  line 6 key y: 0 -> 1
LoadIC   line 5 key x: 1 -> P
StoreIC  line 6 key y: 1 -> P
LoadIC   line 5 key x: P -> P
StoreIC  line 6 key y: P -> P
LoadIC   line 5 key x: P -> P
StoreIC  line 6 key y: P -> P
LoadIC   line 5 key x: P -> N
StoreIC  line 6 key y: P -> N
LoadIC   line 5 key x: N -> N
StoreIC  line 6 key y: N -> N
```
</details>

**What keeps an IC monomorphic:** objects that reach one site are built the same way, with the same properties in the same order (`js-runtime/v8-hidden-classes.md`). **What defeats it:** a function that takes objects from many factories, such as a generic `getId(entity)` used for users, orders and invoices built differently. Five or more maps at that site in this build give `N` ✅[^lab].

### 3.2 Speculative optimization and deoptimization

Maglev and TurboFan compile for what the feedback says, and put a check before each guess. When a check fails, the code deoptimizes: V8 rebuilds an interpreter frame for the same function at the same bytecode offset, and runs on in Ignition ✅[^maglev] ✅[^lab]. The `--trace-deopt-verbose` output shows this step as `translating interpreted frame getX => bytecode_offset=0` ✅[^lab]. Then feedback includes the new case, and the function can be optimized again.

<details><summary>Script <code>deoptframe.mjs</code>: a deopt rebuilds an interpreter frame</summary>

```js
// Run: node --allow-natives-syntax deoptframe.mjs   (re-runs itself with --trace-deopt-verbose)
import { spawnSync } from 'node:child_process';
if (process.argv[2] === 'child') {
  function getX(o) { return o.x; }
  %PrepareFunctionForOptimization(getX);
  getX({ x: 1 }); getX({ x: 2 });
  %OptimizeFunctionOnNextCall(getX); getX({ x: 3 });
  getX({ y: 0, x: 4 });                       // another shape: the TurboFan code deopts here
} else {
  const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--trace-deopt-verbose',
    new URL(import.meta.url).pathname, 'child'], { encoding: 'utf8' });
  for (const l of r.stdout.split('\n'))
    if (/\[bailout \(|reading input frame|translating interpreted frame|bailout end/.test(l))
      console.log(l.trim().replace(/0x[0-9a-f]+ /g, '').replace(/ \(sfi = 0x[0-9a-f]+\)/g, '')
        .replace(/, FP to SP delta.*\]$/, ']').replace(/took [0-9.]+ ms/, 'took … ms').replace(/; inputs:$/, ''));
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax deoptframe.mjs`

```text
[bailout (kind: deopt-eager, reason: wrong map): begin. deoptimizing <JSFunction getX>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 0, deopt exit 1]
reading input frame getX => bytecode_offset=0, args=2, height=0, retval=0(#0)
translating interpreted frame getX => bytecode_offset=0, variable_frame_size=16, frame_size=96
[bailout end. took … ms]
```
</details>

The script below forces TurboFan on six small functions, then calls each with a value the code was not compiled for. Each case printed a different reason ✅[^lab]. The reason strings are V8's own, from `deoptimize-reason.h` ✅[^deopt-reason]. The `deoptimize at <file:line:column>` line points at the operation whose check failed; the comment in the script marks the call that sent the unexpected value.

| Case | Line that fails (`deoptimize at`) | Call that causes it | Reason printed | Kind |
|---|---|---|---|---|
| `wrongMap` | 5:33, `o.x` | line 9, `getX({ y: 0, x: 4 })`: a new shape | `wrong map` | eager |
| `smiOverflow` | 12:32, `a + 1` | line 16, `inc(2 ** 31 - 1)`: the sum leaves the small-integer range | `overflow` | eager |
| `outOfBounds` | 19:33, `a[i]` | line 24, `at(arr, 3)` on a 3-item array | `out of bounds` | eager |
| `noFeedback` | 27:49, `o.y` | line 31, `pick(…, true)`: a branch that never ran before optimization | `Insufficient type feedback for generic named access` | eager |
| `notASmi` | 34:33, `n >> 1` | line 38, `half(7.5)` where only small integers were seen | `not a Smi` | eager |
| `wrongCallTarget` | 41:31, `fn()` | line 46, `run(b)` after only `a` was seen | `wrong call target` | eager |
| `lazy` | (no location printed) | line 58, `callM(o, change)`: `change` replaces `P.prototype.m` while `callM` runs | `(unknown)`, after `marking dependent code … reason: dependent field type constness changed` | lazy |

<details><summary>Script <code>deopt.mjs</code>: seven deoptimizations and their reasons</summary>

```js
// Run: node --allow-natives-syntax deopt.mjs   (it re-runs itself once per case with --allow-natives-syntax --trace-deopt-verbose)
import { spawnSync } from 'node:child_process';
const cases = {
  wrongMap() {
    function getX(o) { return o.x; }
    %PrepareFunctionForOptimization(getX);
    getX({ x: 1 }); getX({ x: 2 });
    %OptimizeFunctionOnNextCall(getX); getX({ x: 3 });
    getX({ y: 0, x: 4 });                 // another shape: y then x
  },
  smiOverflow() {
    function inc(a) { return a + 1; }
    %PrepareFunctionForOptimization(inc);
    inc(1); inc(2);
    %OptimizeFunctionOnNextCall(inc); inc(3);
    inc(2 ** 31 - 1);                     // largest small integer in this build; +1 leaves the range
  },
  outOfBounds() {
    function at(a, i) { return a[i]; }
    const arr = [10, 20, 30];
    %PrepareFunctionForOptimization(at);
    at(arr, 0); at(arr, 1);
    %OptimizeFunctionOnNextCall(at); at(arr, 2);
    at(arr, 3);                           // one past the end
  },
  noFeedback() {
    function pick(o, useY) { if (useY) return o.y; return o.x; }
    %PrepareFunctionForOptimization(pick);
    pick({ x: 1, y: 2 }, false); pick({ x: 1, y: 2 }, false);
    %OptimizeFunctionOnNextCall(pick); pick({ x: 1, y: 2 }, false);
    pick({ x: 1, y: 2 }, true);           // the o.y branch never ran before
  },
  notASmi() {
    function half(n) { return n >> 1; }
    %PrepareFunctionForOptimization(half);
    half(8); half(10);
    %OptimizeFunctionOnNextCall(half); half(12);
    half(7.5);                            // a double where only small integers were seen
  },
  wrongCallTarget() {
    function run(fn) { return fn(); }
    const a = () => 1, b = () => 2;
    %PrepareFunctionForOptimization(run);
    run(a); run(a);
    %OptimizeFunctionOnNextCall(run); run(a);
    run(b);                               // a different function at the same call site
  },
  lazy() {
    class P { m() { return 1; } }
    function change() { P.prototype.m = function () { return 2; }; }
    function callM(o, f) { const r = o.m(); f(); return r + o.m(); }
    const o = new P();
    %PrepareFunctionForOptimization(callM);
    callM(o, () => {}); callM(o, () => {});
    %OptimizeFunctionOnNextCall(callM); callM(o, () => {});
    callM(o, change);                     // change() replaces P.prototype.m while callM is running
  },
};
const name = process.argv[2];
if (name) { cases[name](); }
else {
  for (const c of Object.keys(cases)) {
    const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--trace-deopt-verbose',
      new URL(import.meta.url).pathname, c], { encoding: 'utf8' });
    const lines = r.stdout.split('\n').filter((l) => /\[bailout \(|deoptimize at|marking dependent/.test(l))
      .map((l) => l.trim().replace(/0x[0-9a-f]+ /g, '').replace(/ \(sfi = 0x[0-9a-f]+\)/g, '')
        .replace(/, FP to SP delta.*\]$/, ']').replace(/file:\/\/\S*\//, ''));
    console.log(`--- ${c}\n${lines.join('\n')}`);
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax deopt.mjs`. The script removes addresses and stack offsets from the trace, so its output repeats from run to run.

```text
--- wrongMap
[bailout (kind: deopt-eager, reason: wrong map): begin. deoptimizing <JSFunction getX>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 0, deopt exit 1]
;;; deoptimize at <deopt.mjs:5:33>
--- smiOverflow
[bailout (kind: deopt-eager, reason: overflow): begin. deoptimizing <JSFunction inc>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 2, deopt exit 1]
;;; deoptimize at <deopt.mjs:12:32>
--- outOfBounds
[bailout (kind: deopt-eager, reason: out of bounds): begin. deoptimizing <JSFunction at>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 2, deopt exit 2]
;;; deoptimize at <deopt.mjs:19:33>
--- noFeedback
[bailout (kind: deopt-eager, reason: Insufficient type feedback for generic named access): begin. deoptimizing <JSFunction pick>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 4, deopt exit 0]
;;; deoptimize at <deopt.mjs:27:49>
--- notASmi
[bailout (kind: deopt-eager, reason: not a Smi): begin. deoptimizing <JSFunction half>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 2, deopt exit 0]
;;; deoptimize at <deopt.mjs:34:33>
--- wrongCallTarget
[bailout (kind: deopt-eager, reason: wrong call target): begin. deoptimizing <JSFunction run>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 0, deopt exit 0]
;;; deoptimize at <deopt.mjs:41:31>
--- lazy
[marking dependent code <Code TURBOFAN_JS> (<SharedFunctionInfo callM>) (opt id 0) for deoptimization, reason: dependent field type constness changed]
[bailout (kind: deopt-lazy, reason: (unknown)): begin. deoptimizing <JSFunction callM>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 10, deopt exit 7]
```
</details>

The `smiOverflow` case uses 2 ** 31 − 1 because that is the largest small integer in this build: `%IsSmi(2 ** 31 - 1)` is `true` and `%IsSmi(2 ** 31)` is `false` ✅[^lab]. Why this build has 31-bit small integers (no pointer compression) is covered in `js-runtime/v8-object-and-value-representation-deep-dive.md`.

<details><summary>Script <code>smi.mjs</code>: the small-integer range of this build</summary>

```js
console.log('2**30-1 Smi:', %IsSmi(2 ** 30 - 1), '2**30 Smi:', %IsSmi(2 ** 30), '2**31-1 Smi:', %IsSmi(2 ** 31 - 1), '2**31 Smi:', %IsSmi(2 ** 31));
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax smi.mjs`

```text
2**30-1 Smi: true 2**30 Smi: true 2**31-1 Smi: true 2**31 Smi: false
```
</details>

**Eager and lazy.** An eager deopt happens at a failed check inside the optimized code, as in the first six cases. A lazy deopt starts outside it: other code breaks an assumption the optimized code depends on, here that `P.prototype.m` stays the same function. V8 marks the code for deoptimization at once (`marking dependent code`), and `callM` leaves it when control comes back into its frame (`kind: deopt-lazy`) ✅[^lab]. Functions not on the stack are unlinked on their next call: since the post of 2017-10-04, "V8 postpones it for the next invocation of such functions" ✅[^lazy-unlink].

**What keeps optimized code valid:** run the hot code during warm-up with the same kinds of values it will see later. Keep numbers in one representation (integers stay integers, or doubles from the start). Keep reads inside the array. Do not change prototypes or methods after start-up. **What defeats it:** counters that grow past 2 ** 31 − 1 in code compiled for small integers; a rare branch that first runs after optimization; replacing a method on a class prototype while the program runs.

### 3.3 Deoptimization loops, and how V8 limits them

A deopt loop would be optimize, deopt, optimize, deopt, without end. This build has no `--max-deopt-count` flag ✅[^lab], and the tiering code (`tiering-manager.cc`) contains no deoptimization counter such as `deopt_count` or `max_deopt` ✅[^tiering]. The limit comes from the feedback: each deopt adds the new case, and the IC states only move one way, towards megamorphic (§3.1). The lab (`--single-threaded`, so that compile timing does not vary) calls `getX` 20 000 times with 1 shape, then 2, up to 8 shapes. It deopted once (`wrong map`) for each new shape from 2 to 5. Each time it was compiled again by Maglev and then TurboFan. From the 6th shape on there were no more deopts and no more compiles, because the load had become megamorphic and the optimized code uses the generic path ✅[^lab]. A variation (`deoptloop-var.mjs`, below) ran 24 combinations: four site kinds (a named load, a named store, two loads in one function, a method call), three ways of making the shapes (a different first property, the same five properties added in different orders, eight different classes) and two phase lengths (20 000 and 3 000 calls). All 24 deopted once in each of phases 2 to 5 and never in phases 6 to 8 ✅[^lab]. With the default flags (background compilation; the same script with `'--single-threaded', ` deleted from its `spawnSync` call), two runs of the 24 combinations gave 43 of 48 with that same pattern; the other five had a second deopt in one or two of phases 2 to 5, and none had a deopt in phases 6 to 8 ✅[^lab]. So "one deopt per new shape, none after the fifth" holds for these site kinds with `--single-threaded`, and with the default flags the count in each phase can be one higher.

<details><summary>Script <code>deoptloop.mjs</code>: deopts per new shape</summary>

```js
// Run: node deoptloop.mjs   (re-runs itself with --single-threaded --trace-opt --trace-deopt)
import { spawnSync } from 'node:child_process';
if (process.argv[2] === 'child') {
  function getX(o) { return o.x; }
  // Phase k feeds objects of k different shapes, 20 000 calls per phase.
  const shapes = [];
  for (let k = 0; k < 8; k++) { const o = {}; o['p' + k] = 0; o.x = k; shapes.push(o); }
  let s = 0;
  for (let k = 1; k <= 8; k++) {
    console.log(`phase ${k}: ${k} shape(s)`);
    for (let i = 0; i < 20000; i++) s += getX(shapes[i % k]);
  }
} else {
  const r = spawnSync(process.execPath, ['--single-threaded', '--trace-opt', '--trace-deopt',
    new URL(import.meta.url).pathname, 'child'], { encoding: 'utf8' });
  for (const l of r.stdout.split('\n')) {
    if (/^phase/.test(l)) console.log(l);
    else if (/getX/.test(l) && /completed compiling|bailout \(/.test(l))
      console.log('  ' + (l.match(/target (\w+)/)?.[0] ?? l.match(/reason: [^)]*\)/)?.[0].replace(/\)$/, '')));
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node deoptloop.mjs`

```text
phase 1: 1 shape(s)
  target MAGLEV
  target TURBOFAN_JS
phase 2: 2 shape(s)
  reason: wrong map
  target MAGLEV
  target TURBOFAN_JS
phase 3: 3 shape(s)
  reason: wrong map
  target MAGLEV
  target TURBOFAN_JS
phase 4: 4 shape(s)
  reason: wrong map
  target MAGLEV
  target TURBOFAN_JS
phase 5: 5 shape(s)
  reason: wrong map
  target MAGLEV
  target TURBOFAN_JS
phase 6: 6 shape(s)
phase 7: 7 shape(s)
phase 8: 8 shape(s)
```
</details>

<details><summary>Script <code>deoptloop-var.mjs</code>: other site kinds, shape builders and phase lengths</summary>

```js
// Run: node deoptloop-var.mjs   (deopts per phase for other site kinds, shape builders and phase lengths)
import { spawnSync } from 'node:child_process';
const sites = {
  load:      new Function('return function probe(o) { return o.x; }')(),
  store:     new Function('return function probe(o, v) { o.x = v; return v; }')(),
  twoLoads:  new Function('return function probe(o) { return o.x + o.z; }')(),
  methodCall: new Function('return function probe(o) { return o.m(); }')(),
};
if (process.argv[2] === 'child') {
  const [siteName, builder, perPhase] = process.argv.slice(3);
  const probe = sites[siteName];
  const shapes = [];
  for (let k = 0; k < 8; k++) {
    let o;
    if (builder === 'firstKey') { o = {}; o['p' + k] = 0; o.x = k; o.z = 1; o.m = function () { return k; }; }
    else if (builder === 'order') { // same keys, 8 different insertion orders
      const keys = ['x', 'z', 'm', 'a', 'b']; o = {};
      const rot = [...keys.slice(k % 5), ...keys.slice(0, k % 5)]; if (k >= 5) rot.reverse();
      for (const key of rot) o[key] = key === 'm' ? function () { return 1; } : k;
    } else { // classes
      o = new (new Function(`return class C${k} { constructor() { this.x = ${k}; this.z = 1; } m() { return ${k}; } }`)())();
    }
    shapes.push(o);
  }
  let s = 0;
  for (let k = 1; k <= 8; k++) {
    console.log(`phase ${k}`);
    for (let i = 0; i < Number(perPhase); i++) s += probe(shapes[i % k], 1) | 0;
  }
} else {
  for (const site of Object.keys(sites)) for (const builder of ['firstKey', 'order', 'classes']) for (const perPhase of ['20000', '3000']) {
    const r = spawnSync(process.execPath, ['--single-threaded', '--trace-deopt', new URL(import.meta.url).pathname, 'child', site, builder, perPhase], { encoding: 'utf8' });
    const perP = Array(9).fill(0); let ph = 0;
    for (const l of r.stdout.split('\n')) {
      const m = l.match(/^phase (\d)/); if (m) { ph = Number(m[1]); continue; }
      if (/bailout \(/.test(l) && /JSFunction probe/.test(l)) perP[ph]++;
    }
    console.log(`${site.padEnd(10)} ${builder.padEnd(8)} ${perPhase.padStart(5)} calls/phase  deopts in phases 1..8: ${perP.slice(1).join(' ')}`);
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node deoptloop-var.mjs`. The output repeated on two runs with `--single-threaded`.

```text
load       firstKey 20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
load       firstKey  3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
load       order    20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
load       order     3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
load       classes  20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
load       classes   3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
store      firstKey 20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
store      firstKey  3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
store      order    20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
store      order     3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
store      classes  20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
store      classes   3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
twoLoads   firstKey 20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
twoLoads   firstKey  3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
twoLoads   order    20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
twoLoads   order     3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
twoLoads   classes  20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
twoLoads   classes   3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
methodCall firstKey 20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
methodCall firstKey  3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
methodCall order    20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
methodCall order     3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
methodCall classes  20000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
methodCall classes   3000 calls/phase  deopts in phases 1..8: 0 1 1 1 1 0 0 0
```
</details>

So in these experiments a site that has seen five maps stops deopting on new maps; it uses the generic path on every access (the cost of that path was not timed here). The number of such deopts is bounded by the number of IC states, not by a counter (an inference from the runs and from the absence of a counter in the source). The list of reasons why V8 refuses to optimize a function at all is short: "Function is too big to be optimized", "Function contains a call with too many arguments", "Optimization disabled" and a few internal ones ✅[^bailout-reason].

### 3.4 On-stack replacement for hot loops

A function called once with a long loop never reaches its call-count budget. V8 handles it with OSR: it raises an "OSR urgency" counter on the feedback vector step by step ✅[^tiering], V8 compiles optimized code for the loop, and the running frame jumps into it ✅[^lab]. With 1 000 iterations, `longLoop` was only marked for Maglev. With 5 000 000 iterations it was compiled by Maglev for OSR at bytecode offset 35 and entered (`[OSR - entry. function: longLoop, osr offset: 35]`) ✅[^lab]. No TurboFan OSR followed in that call, although the urgency was raised 284 more times. This build has `--no-osr-from-maglev` by default ✅[^lab], so a loop that entered Maglev through OSR stays in Maglev for that call (an inference from the flag and the trace).

<details><summary>Script <code>osr.mjs</code>: OSR of a function called once</summary>

```js
// Run: node osr.mjs   (re-runs itself with --single-threaded --trace-osr --trace-opt --trace-deopt)
import { spawnSync } from 'node:child_process';
if (process.argv[2] === 'child') {
  function longLoop(n) {                       // called once: only OSR can optimize it
    let t = 0;
    for (let i = 0; i < n; i++) t = (t + i * 7) % 1000003;
    return t;
  }
  console.log('result', longLoop(Number(process.argv[3])));
} else {
  for (const n of ['1000', '5000000']) {
    const r = spawnSync(process.execPath, ['--single-threaded', '--trace-osr', '--trace-opt', '--trace-deopt',
      new URL(import.meta.url).pathname, 'child', n], { encoding: 'utf8' });
    console.log(`--- n = ${n}`);
    let prev = '', count = 0;
    const flush = () => { if (prev) console.log(prev + (count > 1 ? `   (x${count})` : '')); };
    for (const l of r.stdout.split('\n')) {
      if (!/longLoop|^result/.test(l)) continue;
      const m = l.replace(/0x[0-9a-f]+ /g, '').replace(/ \(sfi = 0x[0-9a-f]+\)/g, '')
        .replace(/ - took .*$/, '').replace(/, old urgency: \d+, new urgency: \d+/, '');
      if (m === prev) count++; else { flush(); prev = m; count = 1; }
    }
    flush();
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node osr.mjs`. The script folds repeated lines into one line with a count.

```text
--- n = 1000
[marking <JSFunction longLoop> for optimization to MAGLEV, ConcurrencyMode::kConcurrent, reason: hot and stable]
result 496491
--- n = 5000000
[marking <JSFunction longLoop> for optimization to MAGLEV, ConcurrencyMode::kConcurrent, reason: hot and stable]
[OSR - setting osr urgency. function: longLoop]
[OSR - compilation started. function: longLoop, osr offset: 35, mode: ConcurrencyMode::kSynchronous]
[compiling method <JSFunction longLoop> (target MAGLEV) OSR, mode: ConcurrencyMode::kSynchronous]
[completed compiling <JSFunction longLoop> (target MAGLEV) OSR
[OSR - available (compilation completed or cache hit). function: longLoop, osr offset: 35, mode: ConcurrencyMode::kSynchronous]
[OSR - entry. function: longLoop, osr offset: 35]
[OSR - setting osr urgency. function: longLoop]   (x284)
result 840
```
</details>

This matters for benchmarks. A function with a `for` or `for…of` loop over one big array, called a few times, runs that loop in OSR code, not in code compiled for the whole function (§4.2; `forEach` and `reduce` have no such loop in the function).

### 3.5 Inlining and its limits

TurboFan inlines a callee when the call site's feedback names a target, the callee has a feedback vector, and its bytecode fits the size limits ✅[^inl-heur] ✅[^lab]:
- **Size, not source length.** The 460 is the default of the V8 flag `--max-inlined-bytecode-size`, printed by `node --v8-options` (script in §2.2) with the help text "maximum size of bytecode for a single inlining" ✅[^lab]; `js-inlining-heuristic.cc` itself only reads the `-small`, `-cumulative` and `-absolute` variants ✅[^inl-heur]. A callee over the limit is rejected, and the trace prints `reason: 5`, which is `kExceedsBytecodeLimit` in the `Inlineability` enum (the sixth entry, counting from 0) ✅[^sfi-h]. The script `inline-var.mjs` below checks the limit on one family of callees (`let t = a;` and *k* statements of `t = (t * 3 + 1) | 0;`, then `return t;`) with the TurboFan trace, after 20 warm-up calls and a forced optimization of the caller: bytecode of 446 and 456 bytes was inlined, 466, 486, 506 and 706 bytes was not (`reason: 5`), and with `--max-inlined-bytecode-size=2000` all of them were inlined ✅[^lab]. The same family with a comment of 2 000 characters, one of 20 000 characters, a 5 000-character block comment plus a 5 000-character line comment inside a body, and a 3 000-character variable name all gave callees of 6 to 13 bytes of bytecode that were inlined ✅[^lab]. So the limit is on bytecode, not on source text, for these callees (arithmetic bodies and comments, one call site, TurboFan, this build). Maglev has its own flag, `--max-maglev-inlined-bytecode-size`, also 460 here; no Maglev inlining run was made. Callees up to `--max-inlined-bytecode-size-small` (27 bytes) take the "small function" path ✅[^inl-heur] ✅[^lab].
- **Budget per caller.** All inlined callees of one optimized function share `--max-inlined-bytecode-size-cumulative` (920 bytes) ✅[^inl-heur] ✅[^lab].
- **Known target.** Two different functions passed to one call site: nothing was inlined. Two closures made by one factory share one function body, and were inlined. A method call `o.m()` on objects of two classes inlined both `m` methods (polymorphic inlining, `--polymorphic-inlining` on by default) ✅[^lab].

<details><summary>Script <code>inline.mjs</code>: what TurboFan inlines</summary>

```js
// Run: node --allow-natives-syntax inline.mjs   (re-runs each case with --trace-turbo-inlining)
import { spawnSync } from 'node:child_process';
const warm = (caller, arg) => {
  %PrepareFunctionForOptimization(caller);
  for (let i = 0; i < 20; i++) caller(arg);
  %OptimizeFunctionOnNextCall(caller); caller(arg);
};
const cases = {
  smallCallee() {
    function addOne(a) { return a + 1; }
    function caller(x) { return addOne(x) * 2; }
    warm(caller, 1);
  },
  longCommentShortBody() {
    // The body is one addition; the comment makes the source text about 2 000 characters long.
    const commented = new Function('a', '/*' + 'x'.repeat(2000) + '*/ return a + 1;');
    function caller(x) { return commented(x) * 2; }
    warm(caller, 1);
  },
  bigBody() {
    // 120 statements of arithmetic: well over 460 bytes of bytecode.
    const big = new Function('a', 'let t = a;' + 't = (t * 3 + 1) | 0;'.repeat(120) + 'return t;');
    function caller(x) { return big(x) * 2; }
    warm(caller, 1);
  },
  twoTargets() {
    const f = (a) => a + 1, g = (a) => a + 2;
    function caller(fn) { return fn(1); }
    %PrepareFunctionForOptimization(caller);
    for (let i = 0; i < 20; i++) { caller(f); caller(g); }
    %OptimizeFunctionOnNextCall(caller); caller(f);
  },
  closuresOfOneFunction() {
    const makeAdder = (n) => (a) => a + n; // every closure shares one function body
    const add1 = makeAdder(1), add2 = makeAdder(2);
    function caller(fn) { return fn(1); }
    %PrepareFunctionForOptimization(caller);
    for (let i = 0; i < 20; i++) { caller(add1); caller(add2); }
    %OptimizeFunctionOnNextCall(caller); caller(add1);
  },
  twoClassesOneMethodName() {
    class A { m() { return 1; } }
    class B { m() { return 2; } }
    function caller(o) { return o.m(); }
    const a = new A(), b = new B();
    %PrepareFunctionForOptimization(caller);
    for (let i = 0; i < 20; i++) { caller(a); caller(b); }
    %OptimizeFunctionOnNextCall(caller); caller(a);
  },
};
const name = process.argv[2];
if (name) cases[name]();
else for (const c of Object.keys(cases)) {
  const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--trace-turbo-inlining',
    new URL(import.meta.url).pathname, c], { encoding: 'utf8' });
  const out = r.stdout.split('\n').filter((l) => l && !/SharedFunctionInfo warm>/.test(l))
    .map((l) => l.replace(/0x[0-9a-f]+ \{0x[0-9a-f]+ /g, '{').replace(/0x[0-9a-f]+ /g, ''));
  console.log(`--- ${c}\n${out.join('\n')}`);
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax inline.mjs`. An empty case printed nothing: TurboFan did not consider any target.

```text
--- smallCallee
Considering {<SharedFunctionInfo addOne>} for inlining with {<FeedbackVector[1]>}
Inlining small function(s) at call site #18:JSCall
Inlining {<SharedFunctionInfo addOne>} into {<SharedFunctionInfo caller>}
--- longCommentShortBody
Considering {<SharedFunctionInfo>} for inlining with {<FeedbackVector[1]>}
Inlining small function(s) at call site #27:JSCall
Inlining {<SharedFunctionInfo>} into {<SharedFunctionInfo caller>}
--- bigBody
Cannot consider {<SharedFunctionInfo>} for inlining (reason: 5)
--- twoTargets

--- closuresOfOneFunction
Considering {<SharedFunctionInfo>} for inlining with {<FeedbackVector[1]>}
Inlining small function(s) at call site #18:JSCall
Inlining {<SharedFunctionInfo>} into {<SharedFunctionInfo caller>}
--- twoClassesOneMethodName
Considering {<SharedFunctionInfo m>} for inlining with {<FeedbackVector[0]>}
Considering {<SharedFunctionInfo m>} for inlining with {<FeedbackVector[0]>}
Inlining small function(s) at call site #21:JSCall
Inlining {<SharedFunctionInfo m>} into {<SharedFunctionInfo caller>}
Inlining {<SharedFunctionInfo m>} into {<SharedFunctionInfo caller>}
```
</details>

<details><summary>Script <code>inline-var.mjs</code>: where the 460 comes from, and what a comment does</summary>

```js
// Run: node --allow-natives-syntax inline-var.mjs   (inlining limit: where the 460 comes from, and what a comment does)
import { spawnSync } from 'node:child_process';
const arg = process.argv[2];
const mk = (k) => new Function('a', 'let t = a;' + 't = (t * 3 + 1) | 0;'.repeat(k) + 'return t;');
const bodies = {
  comment2000: () => new Function('a', '/*' + 'x'.repeat(2000) + '*/ return a + 1;'),
  comment20000: () => new Function('a', '/*' + 'x'.repeat(20000) + '*/ return a + 1;'),
  commentInsideBody: () => new Function('a', 'let t = a; /*' + 'x'.repeat(5000) + '*/ t = t + 1; // ' + 'y'.repeat(5000) + '\nreturn t * 2;'),
  longNames: () => new Function('a', 'let ' + 'v'.repeat(3000) + ' = a; return ' + 'v'.repeat(3000) + ' + 1;'),
};
for (const k of [30, 40, 44, 45, 46, 48, 50, 70]) bodies['arith' + k] = () => mk(k);
const run = (callee) => {
  function caller(x) { return callee(x) * 2; }
  %PrepareFunctionForOptimization(caller);
  for (let i = 0; i < 20; i++) caller(1);
  %OptimizeFunctionOnNextCall(caller); caller(1);
};
if (arg) run(bodies[arg]());
else for (const flags of [[], ['--max-inlined-bytecode-size=2000']]) {
  console.log(`--- flags: ${flags.join(' ') || '(default)'}`);
  for (const n of Object.keys(bodies)) {
    const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--trace-turbo-inlining', '--print-bytecode', ...flags,
      new URL(import.meta.url).pathname, n], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const out = r.stdout.split('\n');
    // bytecode length of the callee: the anonymous function made by new Function
    // the callee (made by new Function) is compiled before `run` starts, so its block is the one right before the block of `run`
    const heads = out.map((l, i) => (/\[generated bytecode for function:/.test(l) ? i : -1)).filter((i) => i >= 0);
    const ci = heads.findIndex((i) => /function: run /.test(out[i]));
    const lens = [Number(out[heads[ci - 1] + 1].match(/\d+/)[0])];
    const verdict = out.some((l) => /^Inlining .*into/.test(l)) ? 'inlined' : out.find((l) => /Cannot consider/.test(l))?.match(/reason: \d+/)?.[0] ?? 'not considered';
    console.log(`${n.padEnd(18)} callee bytecode length: ${String(Math.max(0, ...lens)).padStart(5)}  ->  ${verdict}`);
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax inline-var.mjs`. The bytecode length is the one `--print-bytecode` prints for the callee; the output repeated on two runs.

```text
--- flags: (default)
comment2000        callee bytecode length:     6  ->  inlined
comment20000       callee bytecode length:     6  ->  inlined
commentInsideBody  callee bytecode length:    13  ->  inlined
longNames          callee bytecode length:     9  ->  inlined
arith30            callee bytecode length:   306  ->  inlined
arith40            callee bytecode length:   406  ->  inlined
arith44            callee bytecode length:   446  ->  inlined
arith45            callee bytecode length:   456  ->  inlined
arith46            callee bytecode length:   466  ->  reason: 5
arith48            callee bytecode length:   486  ->  reason: 5
arith50            callee bytecode length:   506  ->  reason: 5
arith70            callee bytecode length:   706  ->  reason: 5
--- flags: --max-inlined-bytecode-size=2000
comment2000        callee bytecode length:     6  ->  inlined
comment20000       callee bytecode length:     6  ->  inlined
commentInsideBody  callee bytecode length:    13  ->  inlined
longNames          callee bytecode length:     9  ->  inlined
arith30            callee bytecode length:   306  ->  inlined
arith40            callee bytecode length:   406  ->  inlined
arith44            callee bytecode length:   446  ->  inlined
arith45            callee bytecode length:   456  ->  inlined
arith46            callee bytecode length:   466  ->  inlined
arith48            callee bytecode length:   486  ->  inlined
arith50            callee bytecode length:   506  ->  inlined
arith70            callee bytecode length:   706  ->  inlined
```
</details>

**What keeps inlining working:** small helpers called with one target per site, or with closures from one factory. **What defeats it:** a helper whose bytecode is over 460 bytes; a call site that receives many different functions, such as a generic `run(task)` called with unrelated callbacks.

### 3.6 Escape analysis: objects that are never allocated

When TurboFan has inlined enough to see an object's whole life, and the object never leaves the function, it does not allocate it. The V8 source describes the tracked object as one that "represents an allocation site and tracks the Variables associated with its fields" ✅[^escape-h]. If the code later deopts, the object is built at that moment for the interpreter frame. The lab creates 10 million `{ x, y }` objects in an optimized loop. With escape analysis on (the default), the run had 0 scavenges. With `--no-turbo-escape`, or when each object is also stored in an outside array, it had more than 20 ✅[^lab]. Maglev has its own `--maglev-escape-analysis`, also on by default ✅[^lab].

<details><summary>Script <code>escape.mjs</code>: allocations removed, or not</summary>

```js
// Run: node --allow-natives-syntax escape.mjs   (re-runs itself with --trace-gc, with and without escape analysis)
import { spawnSync } from 'node:child_process';
if (process.argv[2] === 'child') {
  function dist(x, y) { const p = { x, y }; return Math.sqrt(p.x * p.x + p.y * p.y); } // p never leaves
  function total(n) { let t = 0; for (let i = 0; i < n; i++) t += dist(i * 0.5, 1.5); return t; }
  const keep = [];
  function leaky(x, y) { const p = { x, y }; keep[0] = p; return p.x + p.y; }             // p is stored outside
  function totalLeaky(n) { let t = 0; for (let i = 0; i < n; i++) t += leaky(i * 0.5, 1.5); return t; }
  const fn = process.argv[3] === 'leaky' ? totalLeaky : total;
  %PrepareFunctionForOptimization(fn); %PrepareFunctionForOptimization(dist); %PrepareFunctionForOptimization(leaky);
  fn(100); fn(100);
  %OptimizeFunctionOnNextCall(fn); fn(100);
  fn(10_000_000);                                     // 10 million objects if nothing removes them
  console.log(`status ${%GetOptimizationStatus(fn) & 64 ? 'TurboFan' : 'not TurboFan'}`);
} else {
  for (const [label, flags, which] of [['escape analysis on (default)', [], 'clean'],
    ['--no-turbo-escape', ['--no-turbo-escape'], 'clean'], ['object stored outside', [], 'leaky']]) {
    const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--trace-gc', ...flags,
      new URL(import.meta.url).pathname, 'child', which], { encoding: 'utf8' });
    const scavenges = r.stdout.split('\n').filter((l) => /Scavenge/.test(l)).length;
    const status = r.stdout.split('\n').find((l) => l.startsWith('status'));
    console.log(`${label.padEnd(30)} ${status}, scavenges: ${scavenges > 20 ? 'more than 20' : scavenges}`);
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax escape.mjs`

```text
escape analysis on (default)   status TurboFan, scavenges: 0
--no-turbo-escape              status TurboFan, scavenges: more than 20
object stored outside          status TurboFan, scavenges: more than 20
```
</details>

The inputs are doubles from the first call, so that `p.x * p.x` cannot leave the small-integer range and deopt with `overflow` (§3.2) in the middle of the measurement.

**What keeps it working:** short-lived helper objects (points, ranges, `{ value, done }` pairs) that stay inside one optimized function after inlining. **What defeats it:** storing the object anywhere outside (an array, a field, a closure), or a callee that is not inlined.

### 3.7 Calls: argument counts, rest parameters, `arguments`, bound functions, closures

Calling with fewer arguments assigns `undefined` to the missing parameters; extra arguments are ignored ✅[^adaptor]. Before V8 8.9, V8 handled the mismatch with an extra "arguments adaptor frame"; the post of 2021-02-15 shows the new layout in v8.9 and says removing the frame helps "get rid of almost the entire overhead" ✅[^adaptor]. In the lab (`calls.mjs`: 50 warm-up calls, forced optimization of the calling function, 1 000 further calls, status bit 6 of the caller), each of these targets was inlined into a TurboFan caller and none deoptimized: fewer arguments, more arguments, rest parameters, `arguments.length` and `arguments[0]`, `arguments` stored in an outside variable, sloppy-mode `arguments` aliasing a reassigned parameter, a bound function, and a closure ✅[^lab].

<details><summary>Script <code>calls.mjs</code>: call shapes and language features at one call site</summary>

```js
// Run: node --allow-natives-syntax calls.mjs   (re-runs each case with --trace-turbo-inlining --trace-deopt)
import { spawnSync } from 'node:child_process';
const sloppyArgs = new Function('a', 'a = 2; return arguments[0];');   // sloppy mode: arguments aliases a
let kept;
const T = {
  fewerArgs:   { target: function fewer(a, b, c) { return a + (b ?? 0) + (c ?? 0); }, call: (f) => f(1) },
  moreArgs:    { target: function more(a) { return a; },                    call: (f) => f(1, 2, 3) },
  rest:        { target: function rest(...xs) { return xs.length; },        call: (f) => f(1, 2, 3) },
  arguments:   { target: function args() { return arguments.length + arguments[0]; }, call: (f) => f(1, 2) },
  argumentsEscapes: { target: function esc() { kept = arguments; return arguments[0]; }, call: (f) => f(1, 2) },
  sloppyArguments:  { target: sloppyArgs,                                   call: (f) => f(1) },
  bound:       { target: function add(a, b) { return a + b; }.bind(null, 1), call: (f) => f(2) },
  closure:     { target: ((n) => function closure(a) { return a + n; })(5), call: (f) => f(1) },
  applyArray:  { target: function sum3(a, b, c) { return a + b + c; },      call: (f) => f.apply(null, [1, 2, 3]) },
  spreadCall:  { target: function sum3(a, b, c) { return a + b + c; },      call: (f) => f(...[1, 2, 3]) },
  callMethod:  { target: function sum3(a, b, c) { return a + b + c; },      call: (f) => f.call(null, 1, 2, 3) },
  tryCatch:    { target: function tc(a) { try { if (a < 0) throw new Error('neg'); return a; } catch (e) { return 0; } }, call: (f) => f(1) },
  generator:   { target: function* gen() { yield 1; yield 2; },              call: (f) => { let s = 0; for (const v of f()) s += v; return s; } },
  asyncFn:     { target: async function af(a) { return a + 1; },          call: (f) => f(1) },
};
const name = process.argv[2];
if (name) {
  const { target, call } = T[name];
  const direct = (x) => call(x);                                          // `call` is the arrow in the table
  %PrepareFunctionForOptimization(direct);
  for (let i = 0; i < 50; i++) direct(target);
  %OptimizeFunctionOnNextCall(direct); direct(target);
  for (let i = 0; i < 1000; i++) direct(target);
  console.log(`STATUS ${%GetOptimizationStatus(direct) & 64 ? 'TurboFan' : 'not TurboFan'}`);
} else {
  for (const c of Object.keys(T)) {
    const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--trace-turbo-inlining', '--trace-deopt',
      new URL(import.meta.url).pathname, c], { encoding: 'utf8' });
    const lines = r.stdout.split('\n');
    const status = lines.find((l) => l.startsWith('STATUS')).slice(7);
    const inlined = lines.filter((l) => /^Inlining 0x/.test(l)).map((l) => l.match(/<SharedFunctionInfo ?(\w*)>/)[1] || '(anonymous)').filter((n) => n !== 'call');
    const deopts = lines.filter((l) => /\[bailout/.test(l)).map((l) => l.match(/reason: ([^)]*)\)/)[1]);
    console.log(`${c.padEnd(17)} caller ${status}; target inlined: ${inlined.join(', ') || 'none'}; deopts: ${deopts.join(', ') || 'none'}`);
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax calls.mjs`

```text
fewerArgs         caller TurboFan; target inlined: fewer; deopts: none
moreArgs          caller TurboFan; target inlined: more; deopts: none
rest              caller TurboFan; target inlined: rest; deopts: none
arguments         caller TurboFan; target inlined: args; deopts: none
argumentsEscapes  caller TurboFan; target inlined: esc; deopts: none
sloppyArguments   caller TurboFan; target inlined: (anonymous); deopts: none
bound             caller TurboFan; target inlined: add; deopts: none
closure           caller TurboFan; target inlined: closure; deopts: none
applyArray        caller TurboFan; target inlined: none; deopts: none
spreadCall        caller TurboFan; target inlined: none; deopts: none
callMethod        caller TurboFan; target inlined: none; deopts: none
tryCatch          caller TurboFan; target inlined: tc; deopts: none
generator         caller TurboFan; target inlined: gen; deopts: none
asyncFn           caller TurboFan; target inlined: af; deopts: none
```
</details>

In `calls.mjs` the target arrives as a parameter. With `f.apply(null, [1, 2, 3])`, `f(...[1, 2, 3])` and `f.call(null, 1, 2, 3)` the target was not inlined, though the caller was optimized ✅[^lab]. The likely reason is that the call site's feedback records `apply` or `call`, not `f` (an inference). The second script uses a fixed target, `sum3`, in a CommonJS file. There `sum3.call(…)`, a bound `sum3`, and spread or `apply` of an array literal were inlined. Spread or `apply` of an array held in a variable, `apply` with `arguments`, and forwarding rest parameters with `sum3(...xs)` were not inlined; the caller was still TurboFan code ✅[^lab].

<details><summary>Script <code>callforms.js</code>: <code>call</code>, <code>apply</code>, spread and bound calls to one known function</summary>

```js
// Run: node --allow-natives-syntax callforms.js   (a CommonJS script; re-runs itself with --trace-turbo-inlining)
const { spawnSync } = require('node:child_process');
if (process.argv[2] !== 'child') {
  const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--trace-turbo-inlining', __filename, 'child'], { encoding: 'utf8' });
  let inlined = false;
  for (const l of r.stdout.split('\n')) {
    if (/^Inlining 0x.*sum3/.test(l)) inlined = true;
    const m = l.match(/^(\w+) +(TurboFan|not TurboFan)$/);
    if (m) { console.log(`${m[1].padEnd(15)} ${m[2]}, sum3 inlined: ${inlined ? 'yes' : 'no'}`); inlined = false; }
  }
  process.exit(0);
}
function sum3(a, b, c) { return a + b + c; }
var arr = [1, 2, 3];
const bound = sum3.bind(null, 1);
const forms = {
  direct() { return sum3(1, 2, 3); },
  callMethod() { return sum3.call(null, 1, 2, 3); },
  boundFn() { return bound(2, 3); },
  spreadLiteral() { return sum3(...[1, 2, 3]); },
  applyLiteral() { return sum3.apply(null, [1, 2, 3]); },
  spreadVariable() { return sum3(...arr); },
  applyVariable() { return sum3.apply(null, arr); },
  applyArguments() { return sum3.apply(null, arguments); },
  spreadRest(...xs) { return sum3(...xs); },
};
for (const [name, f] of Object.entries(forms)) {
  %PrepareFunctionForOptimization(f);
  for (let i = 0; i < 50; i++) f(1, 2, 3);
  %OptimizeFunctionOnNextCall(f); f(1, 2, 3);
  const s = %GetOptimizationStatus(f);
  console.log(`${name.padEnd(15)} ${s & 64 ? 'TurboFan' : 'not TurboFan'}`);
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax callforms.js`. There is no `package.json`, so Node.js loads the `.js` file as CommonJS.

```text
direct          TurboFan, sum3 inlined: yes
callMethod      TurboFan, sum3 inlined: yes
boundFn         TurboFan, sum3 inlined: yes
spreadLiteral   TurboFan, sum3 inlined: yes
applyLiteral    TurboFan, sum3 inlined: yes
spreadVariable  TurboFan, sum3 inlined: no
applyVariable   TurboFan, sum3 inlined: no
applyArguments  TurboFan, sum3 inlined: no
spreadRest      TurboFan, sum3 inlined: no
```
</details>

### 3.8 `try`/`catch`, generators and `async` functions in the optimizing tiers

The 2017 launch post says Crankshaft, TurboFan's predecessor, "was not designed to optimize JavaScript code using structured exception handling", and that TurboFan was designed "to optimize all of the language features" ✅[^launch-tf]. The lab checks it for V8 13.6 in two ways. **Forced** (`self.mjs`, and the `caller` functions of `calls.mjs`): after 20 to 50 warm-up calls, `%OptimizeFunctionOnNextCall` and one more call, then the status bit `TurboFanned` (bit 6, value 64) of the function itself, read after 100 further calls. Each of these functions had the bit set: `try`/`catch`, a `try`/`catch` that throws on every call, `try`/`finally`, a generator, an `async` function with `await`, a loop over `arguments`, `for…of`, `for…in`, a function that calls `eval`, and a sloppy-mode function with a `with` statement ✅[^lab]. **Natural tier-up** (`natural.mjs`, below; no `%Optimize…` call, `--single-threaded`, `--no-turbo-inlining --no-maglev-inlining`): the status bit was read after every call of up to 40 000 calls. Sixteen subjects reached TurboFan code, between call 1 465 and call 15 991, and two controls without any of the features did the same (a loop-free function at call 11 321, one with a loop at call 938). The subjects were `try`/`catch` (three forms: plain, around a loop, throwing on every call), `try`/`finally`, `arguments` read in a loop, `arguments` stored in an outer variable, sloppy-mode `arguments` aliasing a reassigned parameter, `arguments` passed to `Math.max.apply` in strict mode, two generators (one resumed with a value), `for…in` over 2 and over 8 properties, `eval` of an expression using a parameter and of one using a local variable, and `with` over an object with and without a local variable read ✅[^lab]. Natural tier-up needs the inlining flags: with the two inlining flags deleted from the script, 12 of the 16 subjects stayed at Sparkplug or Maglev for all 40 000 calls, because TurboFan inlined them into the small `use` arrow function and they no longer ran on their own (a first run of the script, without the controls). So both claims are about the function's own code, for small functions, on this build. The list of bailout reasons in this version has no entry for any of these features ✅[^bailout-reason].

<details><summary>Script <code>self.mjs</code>: does TurboFan compile the function itself?</summary>

```js
// Run: node --allow-natives-syntax self.mjs   (does TurboFan compile the function itself?)
const tier = (f) => { const s = %GetOptimizationStatus(f); return s & 64 ? 'TurboFan' : s & 32 ? 'Maglev' : 'not optimized'; };
const subjects = {
  tryCatch: [function tc(a) { try { if (a < 0) throw new Error('neg'); return a; } catch (e) { return 0; } }, (f) => f(1)],
  tryCatchThrows: [function tct(a) { try { throw new Error('x'); } catch (e) { return a; } }, (f) => f(1)],
  tryFinally: [function tf(a) { let r = 0; try { r = a * 2; } finally { r += 1; } return r; }, (f) => f(1)],
  generator: [function* gen(n) { for (let i = 0; i < n; i++) yield i; }, (f) => { let s = 0; for (const v of f(3)) s += v; return s; }],
  asyncFn: [async function af(a) { const b = await a; return b + 1; }, (f) => f(1)],
  argumentsObj: [function ao() { let s = 0; for (let i = 0; i < arguments.length; i++) s += arguments[i]; return s; }, (f) => f(1, 2, 3)],
  forOf: [function fo(arr) { let s = 0; for (const v of arr) s += v; return s; }, (f) => f([1, 2, 3])],
  forIn: [function fi(o) { let s = 0; for (const k in o) s += o[k]; return s; }, (f) => f({ a: 1, b: 2 })],
  withEval: [new Function('a', 'return eval("a + 1");'), (f) => f(1)],
  withStatement: [new Function('o', 'with (o) { return x + 1; }'), (f) => f({ x: 1 })],
};
for (const [name, [f, use]] of Object.entries(subjects)) {
  %PrepareFunctionForOptimization(f);
  for (let i = 0; i < 20; i++) use(f);
  %OptimizeFunctionOnNextCall(f); use(f);
  for (let i = 0; i < 100; i++) use(f);
  console.log(`${name.padEnd(15)} ${tier(f)}`);
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax self.mjs`

```text
tryCatch        TurboFan
tryCatchThrows  TurboFan
tryFinally      TurboFan
generator       TurboFan
asyncFn         TurboFan
argumentsObj    TurboFan
forOf           TurboFan
forIn           TurboFan
withEval        TurboFan
withStatement   TurboFan
```
</details>

<details><summary>Script <code>natural.mjs</code>: the same features, natural tier-up</summary>

```js
// Run: node --allow-natives-syntax natural.mjs   (natural tier-up: no %Optimize... call; status read after every call)
import { spawnSync } from 'node:child_process';
const S = {
  controlPlain: [function plain(a) { return a < 0 ? 0 : a; }, (f) => f(1)],
  controlLoop: [function plainLoop(n) { let s = 0; for (let i = 0; i < n; i++) s += i; return s; }, (f) => f(20)],
  tryCatch: [function tc(a) { try { if (a < 0) throw new Error('neg'); return a; } catch (e) { return 0; } }, (f) => f(1)],
  tryCatchLoop: [function tcl(n) { let s = 0; try { for (let i = 0; i < n; i++) s += i; } catch (e) { s = -1; } return s; }, (f) => f(20)],
  tryCatchThrows: [function tct(a) { try { throw new Error('x'); } catch (e) { return a; } }, (f) => f(1)],
  tryFinally: [function tf(a) { let r = 0; try { r = a * 2; } finally { r += 1; } return r; }, (f) => f(1)],
  argumentsRead: [function ar() { let s = 0; for (let i = 0; i < arguments.length; i++) s += arguments[i]; return s; }, (f) => f(1, 2, 3)],
  argumentsEscapes: [(() => { let kept; return function ae() { kept = arguments; return arguments[0] + kept.length; }; })(), (f) => f(1, 2)],
  argumentsSloppyAlias: [new Function('a', 'a = 2; return arguments[0] + a;'), (f) => f(1)],
  argumentsStrictSpreadApply: [function sa() { 'use strict'; return Math.max.apply(null, arguments); }, (f) => f(1, 2, 3)],
  generator: [function* gen(n) { for (let i = 0; i < n; i++) yield i; }, (f) => { let s = 0; for (const v of f(3)) s += v; return s; }],
  generatorLoop: [function* gen2(n) { let a = 0; while (a < n) { const x = yield a; a += (x ?? 1); } }, (f) => { const g = f(10); let r, s = 0; while (!(r = g.next(2)).done) s += r.value; return s; }],
  forIn: [function fi(o) { let s = 0; for (const k in o) s += o[k]; return s; }, (f) => f({ a: 1, b: 2 })],
  forInMany: [function fim(o) { let s = 0; for (const k in o) s += o[k]; return s; }, (f) => f({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 })],
  evalSimple: [new Function('a', 'return eval("a + 1");'), (f) => f(1)],
  evalLocalVar: [new Function('a', 'var b = a * 2; return eval("b + a");'), (f) => f(1)],
  withSimple: [new Function('o', 'with (o) { return x + 1; }'), (f) => f({ x: 1 })],
  withLocal: [new Function('o', 'var k = 3; with (o) { return x + k; }'), (f) => f({ x: 1 })],
};
const name = process.argv[2];
if (name) {
  const [fn, use] = S[name];
  let first = 0, last = '', best = 0;
  for (let call = 1; call <= 40000; call++) {
    use(fn);
    const s = %GetOptimizationStatus(fn);
    if (s & 64 && !first) first = call;
    best |= s & 64;
    last = s & 64 ? 'TurboFan' : s & 32 ? 'Maglev' : s & 32768 ? 'Sparkplug' : 'Ignition';
  }
  console.log(`first TurboFan at call ${first || 'never'}; status after 40000 calls: ${last}`);
} else for (const n of Object.keys(S)) {
  const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--single-threaded', '--no-turbo-inlining', '--no-maglev-inlining', new URL(import.meta.url).pathname, n], { encoding: 'utf8' });
  console.log(`${n.padEnd(27)} ${r.stdout.trim() || r.stderr.split('\n')[0]}`);
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax natural.mjs`. The script runs each subject in a child process with `--single-threaded`, `--no-turbo-inlining` and `--no-maglev-inlining` (the inlining flags are needed: with them on, the small callee is inlined into the optimized `use` arrow and its own status never changes). The output repeated on two runs.

```text
controlPlain                first TurboFan at call 11321; status after 40000 calls: TurboFan
controlLoop                 first TurboFan at call 938; status after 40000 calls: TurboFan
tryCatch                    first TurboFan at call 15991; status after 40000 calls: TurboFan
tryCatchLoop                first TurboFan at call 1465; status after 40000 calls: TurboFan
tryCatchThrows              first TurboFan at call 10734; status after 40000 calls: TurboFan
tryFinally                  first TurboFan at call 10639; status after 40000 calls: TurboFan
argumentsRead               first TurboFan at call 4135; status after 40000 calls: TurboFan
argumentsEscapes            first TurboFan at call 10912; status after 40000 calls: TurboFan
argumentsSloppyAlias        first TurboFan at call 10912; status after 40000 calls: TurboFan
argumentsStrictSpreadApply  first TurboFan at call 10928; status after 40000 calls: TurboFan
generator                   first TurboFan at call 4781; status after 40000 calls: TurboFan
generatorLoop               first TurboFan at call 3248; status after 40000 calls: TurboFan
forIn                       first TurboFan at call 5492; status after 40000 calls: TurboFan
forInMany                   first TurboFan at call 2247; status after 40000 calls: TurboFan
evalSimple                  first TurboFan at call 10593; status after 40000 calls: TurboFan
evalLocalVar                first TurboFan at call 10573; status after 40000 calls: TurboFan
withSimple                  first TurboFan at call 11126; status after 40000 calls: TurboFan
withLocal                   first TurboFan at call 10796; status after 40000 calls: TurboFan
```
</details>


For `async` functions, the post of 2018-11-12 reports that "async/await outperforms hand-written promise code now", and that, when the value passed to `await` is already a promise, the cost went "from a minimum of three microticks to just one microtick" ✅[^fast-async]. The lab only checked that the `async` function itself is TurboFan code (forced, and in natural tier-up above); it did not time `await`.

### 3.9 Built-in functions and their fast paths

Array methods are built-ins, but TurboFan can inline the method and its callback into the caller. The flag `--turbo-inline-array-builtins` is on by default ✅[^lab]. The release post of 2017-12-19 says "calls to Array.prototype.map and Array.prototype.filter are now inlined for many cases" ✅[^release64]. In the lab, the callbacks of `forEach`, `map`, `reduce`, `filter` and `find` were inlined into a TurboFan caller; the comparator of `sort` was not ✅[^lab]. The `map` case deoptimized once, with `wrong map` at the `.length` read of the array that `map` returned, and stayed TurboFan code after the second optimization ✅[^lab]. Calls through `call`, `apply` and spread are in §3.7.

<details><summary>Script <code>builtins-inline.mjs</code>: callbacks of array built-ins</summary>

```js
// Run: node --allow-natives-syntax builtins-inline.mjs   (re-runs itself with --trace-turbo-inlining)
import { spawnSync } from 'node:child_process';
const forms = {
  forEach: (a) => { let s = 0; a.forEach(function cbForEach(v) { s += v; }); return s; },
  map: (a) => a.map(function cbMap(v) { return v * 2; }).length,
  reduce: (a) => a.reduce(function cbReduce(s, v) { return s + v; }, 0),
  filter: (a) => a.filter(function cbFilter(v) { return v > 1; }).length,
  find: (a) => a.find(function cbFind(v) { return v === 3; }),
  sort: (a) => [...a].sort(function cbSort(x, y) { return x - y; })[0],
};
const name = process.argv[2];
if (name) {
  const f = forms[name], arr = [3, 1, 2];
  %PrepareFunctionForOptimization(f);
  for (let i = 0; i < 50; i++) f(arr);
  %OptimizeFunctionOnNextCall(f); f(arr);
  const first = %GetOptimizationStatus(f) & 64 ? 'TurboFan' : 'not TurboFan';
  %OptimizeFunctionOnNextCall(f); f(arr);                                 // a second optimization
  console.log(`STATUS ${first}, after a second optimization ${%GetOptimizationStatus(f) & 64 ? 'TurboFan' : 'not TurboFan'}`);
} else {
  for (const n of Object.keys(forms)) {
    const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--trace-turbo-inlining', '--trace-deopt',
      new URL(import.meta.url).pathname, n], { encoding: 'utf8' });
    const inl = r.stdout.split('\n').filter((l) => /^Inlining 0x/.test(l)).map((l) => l.match(/<SharedFunctionInfo (\w+)>/)?.[1]);
    const st = r.stdout.split('\n').find((l) => l.startsWith('STATUS')).slice(7);
    const deopts = r.stdout.split('\n').filter((l) => /\[bailout/.test(l)).map((l) => l.match(/reason: ([^)]*)\)/)[1]);
    console.log(`${n.padEnd(8)} caller ${st}; callback inlined: ${inl.some((x) => x?.startsWith('cb')) ? 'yes' : 'no'}; deopts: ${deopts.join(', ') || 'none'}`);
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax builtins-inline.mjs`

```text
forEach  caller TurboFan, after a second optimization TurboFan; callback inlined: yes; deopts: none
map      caller not TurboFan, after a second optimization TurboFan; callback inlined: yes; deopts: wrong map
reduce   caller TurboFan, after a second optimization TurboFan; callback inlined: yes; deopts: none
filter   caller TurboFan, after a second optimization TurboFan; callback inlined: yes; deopts: none
find     caller TurboFan, after a second optimization TurboFan; callback inlined: yes; deopts: none
sort     caller TurboFan, after a second optimization TurboFan; callback inlined: no; deopts: none
```
</details>

## 4. Worked examples

### 4.1 Reading `%GetOptimizationStatus`, bit by bit

`%GetOptimizationStatus(f)` returns a number whose bits are the entries `kIsFunction = 1 << 0` to `kMarkedForConcurrentMaglevOptimization = 1 << 23` of `enum class OptimizationStatus` in `src/runtime/runtime.h` at tag 13.6.233.17, under the comment "A set of bits returned by Runtime_GetOptimizationStatus." ✅[^runtime-h]. The condition that sets each bit is in `Runtime_GetOptimizationStatus` in `src/runtime/runtime-test.cc` at the same tag ✅[^runtime-test]. The first script below decodes the bits with that order and walks one function through every tier ✅[^lab]:

- never called: `262145` = `IsFunction|IsLazy` (bits 0 and 18);
- called once: `129` = `IsFunction|Interpreted` (bit 7);
- after `%CompileBaseline`: `32769` = `IsFunction|Baseline` (bit 15);
- marked for Maglev: bit 22, `MarkedForMaglevOptimization`, is added;
- after Maglev: `49` = `IsFunction|Optimized|Maglevved` (bits 4 and 5);
- marked for TurboFan: bit 8, `MarkedForOptimization`, is added;
- after TurboFan: `81` = `IsFunction|Optimized|TurboFanned` (bits 4 and 6);
- right after a deopt (a string passed to code compiled for numbers): `1`, no tier bit at all. On the next call the function ran in Sparkplug code: `32769`;
- called from inside itself: `IsExecuting|TopmostFrameIsInterpreted` (bits 11 and 16) are added;
- after `%NeverOptimizeFunction`: still `129`. Bit 1, `NeverOptimize`, did not appear ✅[^lab].

The last line matches the source: bit 1 is set when `!isolate->use_optimizer()`, a check for the whole isolate, while `%NeverOptimizeFunction` disables optimization of the one function ✅[^runtime-test]. In the same way, `MaybeDeopted` (bit 3) is set only under `--deopt-every-n-times`, and `LiteMode` (bit 13) only in lite or jitless mode ✅[^runtime-test].

<details><summary>Script <code>tiers.mjs</code>: every tier's status bits</summary>

```js
// Run: node --allow-natives-syntax tiers.mjs
// Bit names of %GetOptimizationStatus, in bit order 0..23 (V8 13.6, src/runtime/runtime.h).
const BITS = ['IsFunction','NeverOptimize','AlwaysOptimize','MaybeDeopted','Optimized','Maglevved',
  'TurboFanned','Interpreted','MarkedForOptimization','MarkedForConcurrentOptimization',
  'OptimizingConcurrently','IsExecuting','TopmostFrameIsTurboFanned','LiteMode',
  'MarkedForDeoptimization','Baseline','TopmostFrameIsInterpreted','TopmostFrameIsBaseline',
  'IsLazy','TopmostFrameIsMaglev','OptimizeOnNextCallOptimizesToMaglev',
  'OptimizeMaglevOptimizesToTurbofan','MarkedForMaglevOptimization','MarkedForConcurrentMaglevOptimization'];
const decode = (s) => BITS.filter((_, i) => s & (1 << i)).join('|');
const show = (label, f) => { const s = %GetOptimizationStatus(f); console.log(`${label.padEnd(34)} ${String(s).padStart(6)} ${decode(s)}`); };

function add(a, b) { return a + b; }
show('never called', add);
add(1, 2);
show('called once (Ignition)', add);
%CompileBaseline(add);
show('after %CompileBaseline', add);
%PrepareFunctionForOptimization(add);
add(1, 2); add(3, 4);
%OptimizeMaglevOnNextCall(add);
show('marked for Maglev, not yet called', add);
add(5, 6);
show('after Maglev', add);
%OptimizeFunctionOnNextCall(add);
show('marked for TurboFan, not yet called', add);
add(7, 8);
show('after TurboFan', add);
add('x', 'y');                       // a string: this TurboFan code only handles numbers
show('after add("x", "y")', add);
add(9, 10);
show('one more call', add);

function selfCheck() { show('inside selfCheck (on the stack)', selfCheck); }
selfCheck();
function never(a) { return a; }
%NeverOptimizeFunction(never);
never(1);
show('after %NeverOptimizeFunction', never);
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax tiers.mjs`

```text
never called                       262145 IsFunction|IsLazy
called once (Ignition)                129 IsFunction|Interpreted
after %CompileBaseline              32769 IsFunction|Baseline
marked for Maglev, not yet called  4227073 IsFunction|Baseline|MarkedForMaglevOptimization
after Maglev                           49 IsFunction|Optimized|Maglevved
marked for TurboFan, not yet called    305 IsFunction|Optimized|Maglevved|MarkedForOptimization
after TurboFan                         81 IsFunction|Optimized|TurboFanned
after add("x", "y")                     1 IsFunction
one more call                       32769 IsFunction|Baseline
inside selfCheck (on the stack)     67713 IsFunction|Interpreted|IsExecuting|TopmostFrameIsInterpreted
after %NeverOptimizeFunction          129 IsFunction|Interpreted
```
</details>

**The bits `tiers.mjs` did not reach.** A second script (`bits-extra.mjs`, below) makes the other bits appear, by a concurrent optimization request, by reading the status from inside a running function, and by flags. In the runs, `%OptimizeFunctionOnNextCall(f, 'concurrent')` gave `MarkedForConcurrentOptimization` (bit 9), the next call gave `OptimizingConcurrently` (bit 10), and the finished compile gave `81`. A function that read its own status while running showed `TopmostFrameIsTurboFanned` (bit 12) in TurboFan code, `TopmostFrameIsMaglev` (bit 19) in Maglev code and `TopmostFrameIsBaseline` (bit 17) in Sparkplug code. `--always-turbofan` added `AlwaysOptimize` (bit 2), `--deopt-every-n-times=100` added `MaybeDeopted` (bit 3), and both `--lite-mode` and `--jitless` gave `NeverOptimize|LiteMode` (bits 1 and 13), which matches `!isolate->use_optimizer()` being true when the optimizer is off. The two flags `--optimize-on-next-call-optimizes-to-maglev` and `--optimize-maglev-optimizes-to-turbofan` set bits 20 and 21; with the first, a concurrent request set `MarkedForConcurrentMaglevOptimization` (bit 23). Bit 14, `MarkedForDeoptimization`, was not seen: after `%DeoptimizeFunction` the status showed no optimized code at all (`129`) ✅[^lab] ✅[^runtime-test]. These runs are for one tiny function on this build.

<details><summary>Script <code>bits-extra.mjs</code>: the status bits that <code>tiers.mjs</code> did not reach</summary>

```js
// Run: node --allow-natives-syntax bits-extra.mjs   (re-runs itself; shows the status bits that tiers.mjs did not reach)
import { spawnSync } from 'node:child_process';
const BITS = ['IsFunction','NeverOptimize','AlwaysOptimize','MaybeDeopted','Optimized','Maglevved',
  'TurboFanned','Interpreted','MarkedForOptimization','MarkedForConcurrentOptimization',
  'OptimizingConcurrently','IsExecuting','TopmostFrameIsTurboFanned','LiteMode',
  'MarkedForDeoptimization','Baseline','TopmostFrameIsInterpreted','TopmostFrameIsBaseline',
  'IsLazy','TopmostFrameIsMaglev','OptimizeOnNextCallOptimizesToMaglev',
  'OptimizeMaglevOptimizesToTurbofan','MarkedForMaglevOptimization','MarkedForConcurrentMaglevOptimization'];
const decode = (s) => BITS.filter((_, i) => s & (1 << i)).join('|');
const line = (label, s) => `${label.padEnd(46)} ${String(s).padStart(8)} ${decode(s)}`;
if (process.argv[2] === 'child') {
  const out = [];
  const st = (f) => %GetOptimizationStatus(f);
  function f(a) { return a + 1; }
  out.push(line('fresh function, not called', st(f)));
  if (process.argv[3] !== 'default') {
    %PrepareFunctionForOptimization(f); f(1); f(2);
    %OptimizeFunctionOnNextCall(f, 'concurrent');
    out.push(line('after a concurrent optimization request', st(f)));
  } else {
    %PrepareFunctionForOptimization(f); f(1); f(2);
    %OptimizeFunctionOnNextCall(f, 'concurrent');
    out.push(line('concurrent TurboFan request, not yet called', st(f)));
    f(3);
    out.push(line('first call: background compile running', st(f)));
    while (!(st(f) & 64)) ;
    out.push(line('background compile finished', st(f)));
    // the frame bits: a function reads its own status while it runs
    let seen;
    const probe = (name, prep) => {
      const g = function (a) { seen = st(g); return a + 1; };
      prep(g); g(3);
      out.push(line(`running inside ${name} code`, seen));
    };
    probe('TurboFan', (g) => { %PrepareFunctionForOptimization(g); g(1); g(2); %OptimizeFunctionOnNextCall(g); });
    probe('Maglev', (g) => { %PrepareFunctionForOptimization(g); g(1); g(2); %OptimizeMaglevOnNextCall(g); });
    probe('Sparkplug', (g) => { g(1); %CompileBaseline(g); });
    function h(a) { return a + 1; }
    %PrepareFunctionForOptimization(h); h(1); h(2); %OptimizeFunctionOnNextCall(h); h(3);
    %DeoptimizeFunction(h);
    out.push(line('after %DeoptimizeFunction, not yet called', st(h)));
  }
  console.log(out.join('\n'));
} else {
  for (const flags of [[], ['--always-turbofan'], ['--deopt-every-n-times=100'], ['--lite-mode'], ['--jitless'],
    ['--optimize-on-next-call-optimizes-to-maglev'], ['--optimize-maglev-optimizes-to-turbofan']]) {
    console.log(`--- flags: ${flags.join(' ') || '(none)'}`);
    const r = spawnSync(process.execPath, ['--allow-natives-syntax', ...flags, new URL(import.meta.url).pathname, 'child', flags.length ? 'flag' : 'default'], { encoding: 'utf8' });
    console.log(r.stdout.trimEnd() || r.stderr.split('\n')[0]);
  }
}
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax bits-extra.mjs`. The output repeated on three runs.

```text
--- flags: (none)
fresh function, not called                       262145 IsFunction|IsLazy
concurrent TurboFan request, not yet called         641 IsFunction|Interpreted|MarkedForConcurrentOptimization
first call: background compile running             1153 IsFunction|Interpreted|OptimizingConcurrently
background compile finished                          81 IsFunction|Optimized|TurboFanned
running inside TurboFan code                       6225 IsFunction|Optimized|TurboFanned|IsExecuting|TopmostFrameIsTurboFanned
running inside Maglev code                       526385 IsFunction|Optimized|Maglevved|IsExecuting|TopmostFrameIsMaglev
running inside Sparkplug code                    165889 IsFunction|IsExecuting|Baseline|TopmostFrameIsBaseline
after %DeoptimizeFunction, not yet called           129 IsFunction|Interpreted
--- flags: --always-turbofan
fresh function, not called                       262149 IsFunction|AlwaysOptimize|IsLazy
after a concurrent optimization request             645 IsFunction|AlwaysOptimize|Interpreted|MarkedForConcurrentOptimization
--- flags: --deopt-every-n-times=100
fresh function, not called                       262153 IsFunction|MaybeDeopted|IsLazy
after a concurrent optimization request             649 IsFunction|MaybeDeopted|Interpreted|MarkedForConcurrentOptimization
--- flags: --lite-mode
fresh function, not called                       270339 IsFunction|NeverOptimize|LiteMode|IsLazy
after a concurrent optimization request            8323 IsFunction|NeverOptimize|Interpreted|LiteMode
--- flags: --jitless
fresh function, not called                       270339 IsFunction|NeverOptimize|LiteMode|IsLazy
after a concurrent optimization request            8323 IsFunction|NeverOptimize|Interpreted|LiteMode
--- flags: --optimize-on-next-call-optimizes-to-maglev
fresh function, not called                      1310721 IsFunction|IsLazy|OptimizeOnNextCallOptimizesToMaglev
after a concurrent optimization request         9437313 IsFunction|Interpreted|OptimizeOnNextCallOptimizesToMaglev|MarkedForConcurrentMaglevOptimization
--- flags: --optimize-maglev-optimizes-to-turbofan
fresh function, not called                      2359297 IsFunction|IsLazy|OptimizeMaglevOptimizesToTurbofan
after a concurrent optimization request         2097793 IsFunction|Interpreted|MarkedForConcurrentOptimization|OptimizeMaglevOptimizesToTurbofan
```
</details>

### 4.2 Four loop forms, timed in two workloads

The script `loops-bench.mjs` (below) sums an array of small integers with `for (let i …)`, `for…of`, `forEach` and `reduce`. Workload A makes 20 calls over 1 000 000 items, so each function is called too few times to be optimized as a whole. Workload B makes 20 000 calls over 1 000 items, so each function reaches TurboFan. Each workload had 1 warm-up round and 9 timed rounds. Measured here: one Docker container on an Apple M2, Node.js 24.22.1, 2026-11-26, four runs (the one quoted below and three reruns). The ranges are the lowest and highest median over the four runs; they are not general ratios.

| Form | A: median ms per round (tier of the function afterwards) | B: median ms per round (tier afterwards) |
|---|---|---|
| `for (let i …)` | 14.5 to 15.4 (Sparkplug) | 10.4 to 11.1 (TurboFan) |
| `for…of` | 137.1 to 153.6 (Sparkplug) | 12.1 to 13.5 (TurboFan) |
| `forEach` | 101.1 to 103.8 (Sparkplug) | 19.3 to 21.5 (TurboFan) |
| `reduce` | 99.4 to 102.5 (Sparkplug) | 8.5 to 9.4 (TurboFan) |

Measured here, for this one function body (`s += v` over small integers): in A, `for…of` took 9.5 to 10.0 times as long as the index loop, `forEach` 6.7 to 7.1 times and `reduce` 6.6 to 7.0 times. In B, `for…of` took 1.15 to 1.22 times as long, `forEach` 1.84 to 1.94 times, and `reduce` 0.81 to 0.85 times (faster than the index loop) ✅[^lab]. The order of the four forms was the same in all four runs. Which code ran in A: `--trace-osr` on a copy of the script with workload B removed printed 201 `OSR - entry` lines each for the `for` loop and the `for…of` loop and none for `forEach` and `reduce`, so only the first two ran their loop in on-stack-replacement code ✅[^lab]. `forEach` and `reduce` loop inside the built-in, which calls the callback once per item; the enclosing function was not TurboFan code, so the callback cannot have been inlined into it (an inference; the inlining of those callbacks into TurboFan callers is §3.9). The point is that the answer to "is `forEach` slower than `for`" depends on which tier runs the code. In B, the `forEach` callback adds into `s`, a variable of the outer function, which may explain part of its gap (an inference; the lab did not isolate it).

<details><summary>Script <code>loops-bench.mjs</code>: timing, measured here</summary>

```js
// Run: node --allow-natives-syntax loops-bench.mjs
// Timing, measured on one machine: per workload, 1 warm-up round, then 9 rounds; the median per loop form.
const forms = {
  'for (let i ...)': (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; },
  'for...of': (a) => { let s = 0; for (const v of a) s += v; return s; },
  'forEach': (a) => { let s = 0; a.forEach((v) => { s += v; }); return s; },
  'reduce': (a) => a.reduce((s, v) => s + v, 0),
};
const tier = (f) => { const s = %GetOptimizationStatus(f); return s & 64 ? 'TurboFan' : s & 32 ? 'Maglev' : s & 32768 ? 'Sparkplug' : 'Ignition'; };
const median = (xs) => [...xs].sort((x, y) => x - y)[xs.length >> 1];
let check = 0;
// A: 20 calls per round over 1 000 000 items (few calls: the loop is optimized by OSR)
// B: 20 000 calls per round over 1 000 items (many calls: the whole function is optimized)
for (const [label, n, calls] of [['A: 1e6 items x 20 calls', 1_000_000, 20], ['B: 1e3 items x 20000 calls', 1_000, 20_000]]) {
  const arr = Array.from({ length: n }, (_, i) => i % 100);       // packed small integers
  const times = Object.fromEntries(Object.keys(forms).map((k) => [k, []]));
  for (let round = 0; round < 10; round++) {
    for (const [name, f] of Object.entries(forms)) {
      const t0 = process.hrtime.bigint();
      for (let r = 0; r < calls; r++) check += f(arr);
      if (round > 0) times[name].push(Number(process.hrtime.bigint() - t0) / 1e6);  // round 0 = warm-up
    }
  }
  console.log(label);
  for (const [name, ts] of Object.entries(times))
    console.log(`  ${name.padEnd(16)} median ${median(ts).toFixed(1).padStart(6)} ms per round   entry tier after: ${tier(forms[name])}`);
}
console.log('checksum', check);
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax loops-bench.mjs`. The times change from run to run; the quoted output is the first of four runs, and the order of the forms stayed the same in all four.

```text
A: 1e6 items x 20 calls
  for (let i ...)  median   14.5 ms per round   entry tier after: Sparkplug
  for...of         median  137.1 ms per round   entry tier after: Sparkplug
  forEach          median  103.0 ms per round   entry tier after: Sparkplug
  reduce           median  101.7 ms per round   entry tier after: Sparkplug
B: 1e3 items x 20000 calls
  for (let i ...)  median   10.5 ms per round   entry tier after: TurboFan
  for...of         median   12.1 ms per round   entry tier after: TurboFan
  forEach          median   19.3 ms per round   entry tier after: TurboFan
  reduce           median    8.5 ms per round   entry tier after: TurboFan
checksum 79200000000
```
</details>

**Another body, other sizes, a warm-up.** The script `loops-var.mjs` repeats the timing with four workloads (1 000 000 items x 5 calls, 100 000 x 200, 10 000 x 2 000, 100 x 200 000), two loop bodies (the plain sum, and `if (v & 1) s += v * v`), a warm-up of up to 30 000 calls and 7 timed rounds. Three runs, ratios to the index loop, lowest to highest:

| Body and workload | `forEach` | `reduce` | Tier of `for` / `forEach` / `reduce` afterwards |
|---|---|---|---|
| sum, 1e6 items x 5 calls | 6.6 to 8.0 | 6.5 to 8.7 | Sparkplug / Sparkplug / Sparkplug |
| sum, 1e5 x 200 | 5.3 | 10.0 to 44.8 | TurboFan / Maglev / Maglev |
| sum, 1e4 x 2 000 | 1.87 to 1.90 | 0.82 to 0.87 | all TurboFan |
| sum, 100 x 200 000 | 1.71 to 1.73 | 0.87 to 0.89 | all TurboFan |
| odd squares, 1e6 x 5 | 4.8 to 4.9 | 4.8 to 4.9 | Sparkplug / Ignition / Ignition |
| odd squares, 1e5 x 200 | 3.0 | 8.9 to 41.5 | TurboFan / Maglev / Maglev |
| odd squares, 1e4 x 2 000 | 1.30 to 1.41 | 1.28 to 1.40 | all TurboFan |
| odd squares, 100 x 200 000 | 1.41 to 1.45 | 1.28 to 1.35 | all TurboFan |

What holds across these cases: when all three functions end as TurboFan code, `forEach` was 1.3 to 1.9 times slower than the index loop. What does not: `reduce` was faster than the index loop only for the plain sum (0.82 to 0.89) and slower for the second body (1.28 to 1.40), so "`reduce` faster than `for`" is true of that one body; and between the two workload kinds there is a middle one (100 000 items x 200 calls) where `for` reached TurboFan while `forEach` and `reduce` stayed in Maglev, and they were 3 to 45 times slower. The tier column is the status after the run (the same in all three runs), so a function that reached TurboFan late shows TurboFan.

<details><summary>Script <code>loops-var.mjs</code>: other bodies and sizes, measured here</summary>

```js
// Run: node --allow-natives-syntax loops-var.mjs   (loops-bench.mjs with other loop counts and another loop body; more warm-up, 7 timed rounds)
const bodies = {
  'sum': {
    'for': (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; },
    'forEach': (a) => { let s = 0; a.forEach((v) => { s += v; }); return s; },
    'reduce': (a) => a.reduce((s, v) => s + v, 0),
  },
  'odd squares': {
    'for': (a) => { let s = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v & 1) s += v * v; } return s; },
    'forEach': (a) => { let s = 0; a.forEach((v) => { if (v & 1) s += v * v; }); return s; },
    'reduce': (a) => a.reduce((s, v) => (v & 1 ? s + v * v : s), 0),
  },
};
const tier = (f) => { const s = %GetOptimizationStatus(f); return s & 64 ? 'TurboFan' : s & 32 ? 'Maglev' : s & 32768 ? 'Sparkplug' : 'Ignition'; };
const median = (xs) => [...xs].sort((x, y) => x - y)[xs.length >> 1];
let check = 0;
for (const [bname, forms] of Object.entries(bodies))
  for (const [n, calls] of [[1_000_000, 5], [100_000, 200], [10_000, 2000], [100, 200_000]]) {
    const arr = Array.from({ length: n }, (_, i) => i % 100);
    const times = Object.fromEntries(Object.keys(forms).map((k) => [k, []]));
    const warm = Math.min(15, Math.ceil(30000 / calls));   // warm-up rounds: up to 30 000 calls, at most 15 rounds
    for (let round = 0; round < warm + 7; round++)
      for (const [name, f] of Object.entries(forms)) {
        const t0 = process.hrtime.bigint();
        for (let r = 0; r < calls; r++) check += f(arr);
        if (round >= warm) times[name].push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
    const m = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, median(v)]));
    console.log(`${bname.padEnd(12)} ${String(n).padStart(7)} items x ${String(calls).padStart(6)} calls: for ${m.for.toFixed(1).padStart(6)} ms, forEach ${m.forEach.toFixed(1).padStart(6)} ms (x${(m.forEach / m.for).toFixed(2)}), reduce ${m.reduce.toFixed(1).padStart(6)} ms (x${(m.reduce / m.for).toFixed(2)}); tiers after: ${Object.keys(forms).map((k) => tier(forms[k])).join('/')}`);
  }
console.log('checksum', check);
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax loops-var.mjs`. One of the three runs:

```text
sum          1000000 items x      5 calls: for    3.8 ms, forEach   24.9 ms (x6.59), reduce   24.6 ms (x6.53); tiers after: Sparkplug/Sparkplug/Sparkplug
sum           100000 items x    200 calls: for    9.9 ms, forEach   52.0 ms (x5.27), reduce   99.0 ms (x10.04); tiers after: TurboFan/Maglev/Maglev
sum            10000 items x   2000 calls: for   10.3 ms, forEach   19.3 ms (x1.87), reduce    8.4 ms (x0.82); tiers after: TurboFan/TurboFan/TurboFan
sum              100 items x 200000 calls: for   10.8 ms, forEach   18.4 ms (x1.71), reduce    9.4 ms (x0.87); tiers after: TurboFan/TurboFan/TurboFan
odd squares  1000000 items x      5 calls: for    5.1 ms, forEach   24.4 ms (x4.76), reduce   24.9 ms (x4.86); tiers after: Sparkplug/Ignition/Ignition
odd squares   100000 items x    200 calls: for   10.9 ms, forEach   32.7 ms (x3.02), reduce  103.0 ms (x9.48); tiers after: TurboFan/Maglev/Maglev
odd squares    10000 items x   2000 calls: for   11.6 ms, forEach   15.1 ms (x1.30), reduce   14.8 ms (x1.28); tiers after: TurboFan/TurboFan/TurboFan
odd squares      100 items x 200000 calls: for   13.5 ms, forEach   19.6 ms (x1.45), reduce   17.3 ms (x1.28); tiers after: TurboFan/TurboFan/TurboFan
checksum 5920200000000
```
</details>

How long a function needs before the numbers settle is a separate result. The script `warmup.mjs` times 25 rounds of 2 000 calls over 10 000 items. In all three runs the first five rounds (10 000 calls) took 51 to 76 ms for `forEach` and 95 to 111 ms for `reduce`, against 9 to 12 ms for `for` (its first round: 14 to 20 ms). The sixth round was in between, and from the seventh round (after 12 000 calls) `forEach` mostly took 19 to 21 ms and `reduce` 8 to 10 ms, with an occasional 12 or 13 ms or 25 ms round. So a benchmark that stops before about 10 000 calls of this function measures the code before TurboFan optimized the callbacks ✅[^lab]. This holds for this one body and size on this build.

<details><summary>Script <code>warmup.mjs</code>: when do <code>forEach</code> and <code>reduce</code> settle?</summary>

```js
// Run: node --allow-natives-syntax warmup.mjs   (ms per round, 25 rounds of 2 000 calls over 10 000 items: when does each form settle?)
const forms = {
  'for': (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; },
  'forEach': (a) => { let s = 0; a.forEach((v) => { s += v; }); return s; },
  'reduce': (a) => a.reduce((s, v) => s + v, 0),
};
const arr = Array.from({ length: 10_000 }, (_, i) => i % 100);
let check = 0;
const rounds = {};
for (let round = 0; round < 25; round++) for (const [name, f] of Object.entries(forms)) {
  const t0 = process.hrtime.bigint();
  for (let r = 0; r < 2000; r++) check += f(arr);
  (rounds[name] ??= []).push(Math.round(Number(process.hrtime.bigint() - t0) / 1e6));
}
for (const k in rounds) console.log(k.padEnd(8), rounds[k].join(' '));
```

Run: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --allow-natives-syntax warmup.mjs`. The numbers are milliseconds per round; the first of three runs:

```text
for      20 15 10 10 10 10 10 10 10 10 10 10 10 10 10 11 10 10 11 11 10 11 10 10 10
forEach  76 56 54 54 55 44 20 19 20 19 19 21 19 19 20 21 20 19 20 20 25 19 19 19 19
reduce   104 97 98 99 97 58 9 9 8 8 8 8 8 9 8 12 9 9 9 8 13 8 9 8 8
```
</details>

## 5. Reference & invariants

### 5.1 `%GetOptimizationStatus` bits in V8 13.6

Names, bit numbers and order from `enum class OptimizationStatus` in `src/runtime/runtime.h` at tag 13.6.233.17 ✅[^runtime-h]; "Set when" from `Runtime_GetOptimizationStatus` in `src/runtime/runtime-test.cc` at the same tag ✅[^runtime-test]; "Seen" says which script showed the bit: `tiers.mjs` or `bits-extra.mjs` (§4.1) ✅[^lab].

| Bit | Value | Name | Set when | Seen |
|---|---|---|---|---|
| 0 | 1 | IsFunction | the argument is a function | yes (`tiers.mjs`) |
| 1 | 2 | NeverOptimize | the isolate does not use the optimizer | yes, with `--lite-mode` and `--jitless` (`bits-extra.mjs`) |
| 2 | 4 | AlwaysOptimize | `--always-turbofan` or `--prepare-always-turbofan` | yes, with `--always-turbofan` (`bits-extra.mjs`) |
| 3 | 8 | MaybeDeopted | `--deopt-every-n-times` | yes (`bits-extra.mjs`) |
| 4 | 16 | Optimized | optimized code is attached and not marked for deopt | yes (`tiers.mjs`) |
| 5 | 32 | Maglevved | that code is Maglev code | yes (`tiers.mjs`) |
| 6 | 64 | TurboFanned | that code is TurboFan code | yes (`tiers.mjs`) |
| 7 | 128 | Interpreted | the active tier is Ignition | yes (`tiers.mjs`) |
| 8 | 256 | MarkedForOptimization | a synchronous TurboFan request is pending | yes (`tiers.mjs`) |
| 9 | 512 | MarkedForConcurrentOptimization | a concurrent TurboFan request is pending | yes (`bits-extra.mjs`) |
| 10 | 1024 | OptimizingConcurrently | a background compile is running (`tiering_in_progress()`) | yes (`bits-extra.mjs`) |
| 11 | 2048 | IsExecuting | a frame of the function is on the stack | yes (`tiers.mjs`) |
| 12 | 4096 | TopmostFrameIsTurboFanned | that frame is TurboFan code | yes (`bits-extra.mjs`) |
| 13 | 8192 | LiteMode | `--lite-mode`, `--jitless`, or no TurboFan in the build | yes, with both flags (`bits-extra.mjs`) |
| 14 | 16384 | MarkedForDeoptimization | the attached optimized code is marked for deopt | no (not reached by the runs) |
| 15 | 32768 | Baseline | Sparkplug code is attached | yes (`tiers.mjs`) |
| 16 | 65536 | TopmostFrameIsInterpreted | the frame is interpreted | yes (`tiers.mjs`) |
| 17 | 131072 | TopmostFrameIsBaseline | the frame is Sparkplug code | yes (`bits-extra.mjs`) |
| 18 | 262144 | IsLazy | the function is not compiled yet | yes (`tiers.mjs`) |
| 19 | 524288 | TopmostFrameIsMaglev | the frame is Maglev code | yes (`bits-extra.mjs`) |
| 20 | 1048576 | OptimizeOnNextCallOptimizesToMaglev | the flag `--optimize-on-next-call-optimizes-to-maglev` is on | yes (`bits-extra.mjs`) |
| 21 | 2097152 | OptimizeMaglevOptimizesToTurbofan | the flag `--optimize-maglev-optimizes-to-turbofan` is on | yes (`bits-extra.mjs`) |
| 22 | 4194304 | MarkedForMaglevOptimization | a Maglev request is pending | yes (`tiers.mjs`) |
| 23 | 8388608 | MarkedForConcurrentMaglevOptimization | a concurrent Maglev request is pending | yes, with the flag of bit 20 (`bits-extra.mjs`) |

These bits are an interface for V8's own tests: the source comment says they "must be in sync with bits defined in test/mjsunit/mjsunit.js" ✅[^runtime-h]. This table is for tag 13.6.233.17 only; no other version's table was compared, so decode with the table of the version you run.

### 5.2 Tiering flags in this build

All defaults below were read from `node --v8-options` (script in §2.2) ✅[^lab].

| Flag | Default | Effect |
|---|---|---|
| `--invocation-count-for-feedback-allocation` | 8 | Budget factor before a feedback vector exists |
| `--invocation-count-for-maglev` | 400 | Budget factor for Maglev |
| `--invocation-count-for-turbofan` | 3000 | Budget factor for TurboFan |
| `--minimum-invocations-after-ic-update` | 500 | Wait after an IC changes |
| `--max-optimized-bytecode-size` | 61440 | Bigger functions are never optimized |
| `--invocation-count-for-osr`, `--invocation-count-for-maglev-osr` | 500, 100 | Budgets once OSR code exists |
| `--osr-from-maglev` | off | No TurboFan OSR from Maglev OSR code |
| `--max-valid-polymorphic-map-count` | 4 | Maps per IC before megamorphic |
| `--max-inlined-bytecode-size`, `-small`, `-cumulative` | 460, 27, 920 | TurboFan inlining limits |
| `--max-maglev-inlined-bytecode-size` | 460 | Maglev inlining limit |
| `--turbo-escape`, `--maglev-escape-analysis` | on, on | Allocation removal |
| `--turbo-inline-array-builtins` | on | Inline array built-ins and their callbacks |
| `--sparkplug`, `--maglev`, `--turbofan`, `--turboshaft` | all on | The tiers |
| `--concurrent-recompilation`, `--concurrent-sparkplug`, `--baseline-batch-compilation` | all on | Background and batched compiles (the reason call counts vary) |

### 5.3 How to watch it

| Goal | Flag or native | Output to look for |
|---|---|---|
| Which tier runs `f` | `--allow-natives-syntax`, `%GetOptimizationStatus(f)` | the bits of §5.1 |
| When `f` is compiled | `--trace-opt` | `[marking … for optimization to MAGLEV …, reason: hot and stable]`, `[completed compiling … (target TURBOFAN_JS)]` |
| Why `f` left optimized code | `--trace-deopt`; `--trace-deopt-verbose` adds `deoptimize at <file:line:col>` | `[bailout (kind: deopt-eager, reason: wrong map) …]` |
| IC states | `--log-ic --logfile=<path> --no-logfile-per-isolate` (no `--trace-ic` in this build) | lines `LoadIC,…,<line>,<column>,<old>,<new>,<map>,<key>` |
| OSR | `--trace-osr` | `[OSR - entry. function: …, osr offset: …]` |
| Inlining | `--trace-turbo-inlining`, `--trace-maglev-inlining` | `Inlining … into …`, `Cannot consider … (reason: 5)` |
| Deterministic tier-up for a test | `--single-threaded` | same call numbers on every run (§2.2) |

All of these flags exist in this build ✅[^lab]. Node.js 24 ships V8 13.6: the release notes of 2025-05-06 say "The V8 engine is updated to version 13.6" ✅[^node24].

### 5.4 Invariants seen in this build

- A function leaves Ignition only after it has used up a budget set by its bytecode length ✅[^tiering] ✅[^lab].
- Sparkplug code does not depend on feedback, so it has nothing to deoptimize for ✅[^tiering] ✅[^sparkplug].
- Every deopt lands in the interpreter at a bytecode offset of the same function ✅[^lab].
- An IC state only moves towards megamorphic: `0 → 1 → P → N` ✅[^lab] ✅[^ic-cc].
- Inlining needs a callee with a feedback vector and bytecode within the limits ✅[^inl-heur] ✅[^lab].

## 6. Trade-offs, pitfalls & misconceptions

### 6.1 Corrections: popular beliefs checked against V8 13.6

| Belief | Where it comes from | What the lab or the current source shows |
|---|---|---|
| "A `try`/`catch` prevents optimization" | The bluebird "Optimization killers" wiki listed "Functions that contain a try-catch statement" as not optimizable ✅[^bluebird]; it was true of Crankshaft ✅[^launch-tf] | For small functions on this build, TurboFan code existed for `try`/`catch`, `try`/`catch` that throws on every call, a `try`/`catch` around a loop and `try`/`finally`, both after forced optimization (status bit) and in natural tier-up (`natural.mjs`, inlining off); a `try`/`catch` function was also inlined into its caller ✅[^lab]. The wiki itself now opens with "All this is wrong in TurboFan. (Node 8+)" ✅[^bluebird] |
| "`arguments` prevents optimization; never leak it" | The same wiki: "The `arguments` object must not be passed or leaked anywhere." ✅[^bluebird] | `arguments` read, looped over, stored in an outside variable, aliased in sloppy mode, and passed to `Math.max.apply` in strict mode: TurboFan code after forced optimization and in natural tier-up (the forced runs also inlined them with no deopt) ✅[^lab] |
| "Functions over 600 characters are not inlined" | Crankshaft's rule, as written in 2013: "Large functions (>600 source characters including whitespace or 196 AST nodes) will not be inlined." ✅[^conrod] | TurboFan dropped source size in 2016: "The source size is not a real indicator for whether or not to inline a certain function." ✅[^cr-2361813002]. Callees with comments of 2 000 and 20 000 characters were inlined; the limit is the flag `--max-inlined-bytecode-size`, 460 bytes of bytecode by default: 456 bytes inlined, 466 not (§3.5) ✅[^lab] |
| "`forEach` is slower than `for`" | Common micro-benchmarks | Depends on the tier and the size (§4.2, measured here on Node.js 24.22.1, sum of small integers): 6.7 to 7.1 times slower with 1 000 000 items and 20 calls (only the `for` loop in OSR code), 1.84 to 1.94 times with 1 000 items and 20 000 calls (all TurboFan), over four runs. With another body and other sizes the ratio ranged from 1.3 to 8 (and up to 45 for `reduce` in one middle case). `reduce` was faster than the index loop (0.81 to 0.89) for the plain sum in the TurboFan workloads, and slower (1.28 to 1.40) for a body with a condition ✅[^lab] |
| "Generators, `for…of` and `for…in` are not optimized" | The same wiki, with notes that they were optimized in later versions ✅[^bluebird] | TurboFan code, forced and natural, for the small generators and `for…in` loops tried; `for…of` forced only ✅[^lab] |
| "`eval` and `with` are never optimizable" | The same wiki listed both under "likely never optimizable" ✅[^bluebird] | Simple functions with either (an `eval` of an expression using a parameter or a local variable; a `with` over an object, with and without a local variable read) were TurboFan code, forced and natural ✅[^lab]. What `eval` does to the variables around it was not measured |
| "Calling with the wrong number of arguments is slow" | The arguments adaptor frame, removed in V8 8.9 ✅[^adaptor] | Fewer and more arguments: inlined, no deopt ✅[^lab] |
| "Feedback vectors are allocated after 1 KB of bytecode" | The V8 Lite post of 2019-09-12 ✅[^v8-lite] | In 13.6 the budget is `bytecode_length * invocation_count_for_feedback_allocation` ✅[^tiering], with the flag at 8 ✅[^lab]; the vector existed after 9 calls for a one-line and for a 60-statement function (`fv.mjs`, §2.3) ✅[^lab] |
| "A megamorphic site deopts again and again" | A reading of "deopt loops" | With `--single-threaded`, deopts stopped after the 5th shape in all 24 combinations of site kind, shape builder and phase length of §3.3; the site became `N` and stayed so. With the default flags one or two extra deopts appeared in 5 of 48 runs, never after the 5th shape ✅[^lab] |
| "Spread and `apply` are as cheap as a direct call" | — | Only literal arrays let the target be inlined; arrays in variables, `arguments` and rest forwarding did not ✅[^lab] |
| "Up to four shapes stay fast (polymorphic)" | `js-runtime/v8-hidden-classes.md`, from a post of 2015 | The state limit is confirmed for loads and stores in 13.6: `P` for 2 to 4 maps, `N` at the 5th ✅[^lab] ✅[^ic-cc]. Whether `P` is as fast as a monomorphic site was not timed here; `performance/code-review/problem-classes-javascript-engine.md` times a polymorphic site of 4 shapes and finds it slower than one shape |

### 6.2 Pitfalls when measuring

- **Forcing optimization too early.** `%OptimizeFunctionOnNextCall` after 2 calls optimizes a function whose callees have no feedback vector yet, so nothing is inlined (§2.3) ✅[^lab]. Warm up with tens of calls first.
- **Integers that overflow in the benchmark itself.** An integer that grows past 2 ** 31 − 1 in code compiled for small integers deopts with `overflow` (§3.2) ✅[^lab]. Feed the values the measurement will use during warm-up.
- **Call counts vary between runs.** With the default flags, background compilation moves the call at which each tier appears; `--single-threaded` makes it repeat (§2.2) ✅[^lab].
- **One-call benchmarks measure OSR code.** In workload A of §4.2 every function stayed Sparkplug code at entry and its loop ran in OSR code ✅[^lab].
- **The status bits are a test interface.** The table of §5.1 was checked for V8 13.6.233.17 only; use it on another version only after comparing its `runtime.h` ✅[^runtime-h].
- **Natives change what they measure.** `%PrepareFunctionForOptimization` and `%OptimizeFunctionOnNextCall` force a path that real code may not take; §2.2 and §3.3 use natural tier-up for that reason.

### 6.3 Trade-offs of the tiers

Higher tiers compile slower: Maglev about 10 times slower than Sparkplug and 10 times faster than TurboFan, per the post of 2023-12-05 ✅[^maglev]. V8 therefore spends TurboFan time only on code that has used up a large budget (§2.2) ✅[^tiering]. Deoptimization is the price of guessing: each one throws away compiled code, and the function has to earn its budget again (§3.3) ✅[^lab].

## Verification status

- **Measured** on 2026-11-26 with Node.js 24.22.1 (V8 13.6.233.17-node.58) in the image `node:24.22.1-alpine`, linux arm64 under Docker on an Apple M2, with `--network none`. Twenty-five scripts, all embedded above with their output. A second reader re-ran the first seventeen on the same day: the sixteen that print no timing gave the quoted output exactly; `loops-bench.mjs` was run three more times (§4.2). The eight added in that review (`toobig.mjs`, `fv.mjs`, `inline-var.mjs`, `deoptloop-var.mjs`, `natural.mjs`, `bits-extra.mjs`, `loops-var.mjs`, `warmup.mjs`) are variations that test whether a conclusion holds for another function body or size; all but the two timing scripts (`loops-var.mjs`, `warmup.mjs`) repeated their output on a second run (`deoptloop-var.mjs` also on a default-flags variant, §3.3).
- **Read only:** the V8 source at tag 13.6.233.17 (`runtime.h`, `runtime-test.cc`, `deoptimize-reason.h`, `bailout-reason.h`, `tiering-manager.cc`, `ic.cc`, `shared-function-info.h`, `js-inlining-heuristic.cc`, `escape-analysis.h`), v8.dev posts and docs, the Node.js 24.0.0 release notes, and three Rank 6 sources that record the old beliefs (§6.1). The V8 source files were re-read at tag 13.6.233.17 in the review.
- **Not checked:** call-site IC states (`--log-ic` logs no call sites here); whether a polymorphic (`P`) site is slower than a monomorphic one (not timed here); Maglev inlining; the bit `MarkedForDeoptimization`; functions larger than a few hundred bytes of bytecode with the features of §3.8; TurboFan OSR from a loop that did not first enter Maglev; Turboshaft's own phases (there is no trace of them in the scripts above); the speed of `await`; the effect of `eval` on surrounding variables; any platform other than linux arm64.
- Verified: 161 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-26

## References
- [src/runtime/runtime.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/runtime/runtime.h) — V8 project, 2025. Rank 1. Backs: §4.1, §5.1 (the status bits). [^runtime-h]
- [src/runtime/runtime-test.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/runtime/runtime-test.cc) — V8 project, 2025. Rank 1. Backs: §4.1, §5.1 (when each bit is set, `%NeverOptimizeFunction`). [^runtime-test]
- [src/deoptimizer/deoptimize-reason.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/deoptimizer/deoptimize-reason.h) — V8 project, 2025. Rank 1. Backs: §3.2 (reason strings). [^deopt-reason]
- [src/codegen/bailout-reason.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/codegen/bailout-reason.h) — V8 project, 2025. Rank 1. Backs: §3.3, §3.8 (reasons not to optimize). [^bailout-reason]
- [src/execution/tiering-manager.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/execution/tiering-manager.cc) — V8 project, 2025. Rank 1. Backs: §2.2, §2.3, §3.3, §3.4, §5.4 (budgets, Sparkplug batching, OSR urgency, no deopt counter). [^tiering]
- [src/ic/ic.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/ic/ic.cc) — V8 project, 2025. Rank 1. Backs: §3.1 (state marks, megamorphic limit). [^ic-cc]
- [src/objects/shared-function-info.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/shared-function-info.h) — V8 project, 2025. Rank 1. Backs: §3.5 (`Inlineability`, reason 5). [^sfi-h]
- [src/compiler/js-inlining-heuristic.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/compiler/js-inlining-heuristic.cc) — V8 project, 2025. Rank 1. Backs: §2.3, §3.5 (small functions, cumulative budget, trace strings). [^inl-heur]
- [src/compiler/escape-analysis.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/compiler/escape-analysis.h) — V8 project, 2025. Rank 1. Backs: §3.6. [^escape-h]
- [Ignition](https://v8.dev/docs/ignition) — V8 team, living. Rank 1. Backs: §2.2. [^ignition-docs]
- [Node.js 24.0.0 release notes](https://nodejs.org/en/blog/release/v24.0.0) — Node.js project, 2025. Rank 1. Backs: §5.3 (V8 13.6). [^node24]
- [Maglev - V8’s Fastest Optimizing JIT](https://v8.dev/blog/maglev) — V8 team, 2023. Rank 4. Backs: Summary, §2.2, §2.3, §3.2, §6.3. [^maglev]
- [Sparkplug — a non-optimizing JavaScript compiler](https://v8.dev/blog/sparkplug) — V8 team, 2021. Rank 4. Backs: §2.2, §5.4. [^sparkplug]
- [Firing up the Ignition interpreter](https://v8.dev/blog/ignition-interpreter) — V8 team, 2016. Rank 4. Backs: §2.2. [^ignition-blog]
- [Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) — V8 team, 2017. Rank 4. Backs: §2.2, §3.8, §6.1. [^launch-tf]
- [Land ahoy: leaving the Sea of Nodes](https://v8.dev/blog/leaving-the-sea-of-nodes) — V8 team, 2025. Rank 4. Backs: §2.2 (Turboshaft). [^sea-of-nodes]
- [Faster JavaScript calls](https://v8.dev/blog/adaptor-frame) — V8 team, 2021. Rank 4. Backs: §3.7, §6.1. [^adaptor]
- [Faster async functions and promises](https://v8.dev/blog/fast-async) — V8 team, 2018. Rank 4. Backs: §3.8. [^fast-async]
- [A lighter V8](https://v8.dev/blog/v8-lite) — V8 team, 2019. Rank 4. Backs: §2.3, §6.1. [^v8-lite]
- [An internship on laziness: lazy unlinking of deoptimized functions](https://v8.dev/blog/lazy-unlinking) — V8 team, 2017. Rank 4. Backs: §3.2. [^lazy-unlink]
- [V8 release v6.4](https://v8.dev/blog/v8-release-64) — V8 team, 2017. Rank 4. Backs: §3.9. [^release64]
- [Optimization killers](https://github.com/petkaantonov/bluebird/wiki/Optimization-killers) — bluebird project wiki (community), 2018. Rank 6. Backs: §6.1, the old beliefs only. [^bluebird]
- [A tour of V8: Crankshaft, the optimizing compiler](https://www.jayconrod.com/posts/54/a-tour-of-v8--crankshaft--the-optimizing-compiler) — Jay Conrod (personal blog), 2013. Rank 6. Backs: §6.1, the 600-character rule. [^conrod]
- [[turbofan] Don't take into account source size for inlining heuristics](https://codereview.chromium.org/2361813002) — Chromium code review (Benedikt Meurer), 2016. Rank 6. Backs: §6.1. [^cr-2361813002]
- Lab: the twenty-five scripts embedded in this doc (`flags.mjs`, `toobig.mjs`, `tierup.mjs`, `fv.mjs`, `feedback.mjs`, `ic.mjs`, `deoptframe.mjs`, `deopt.mjs`, `smi.mjs`, `deoptloop.mjs`, `deoptloop-var.mjs`, `osr.mjs`, `inline.mjs`, `inline-var.mjs`, `escape.mjs`, `calls.mjs`, `callforms.js`, `self.mjs`, `natural.mjs`, `builtins-inline.mjs`, `tiers.mjs`, `bits-extra.mjs`, and the timings `loops-bench.mjs`, `loops-var.mjs`, `warmup.mjs`), run on 2026-11-26 in `node:24.22.1-alpine` (Node.js 24.22.1, V8 13.6.233.17-node.58, linux arm64, Docker on an Apple M2) with `--network none`; outputs quoted in each `<details>` block. [^lab]

## Related
- `js-runtime/v8-hidden-classes.md` — object shapes (maps), transitions, inline caches and dictionary mode, which §3.1 builds on.
- `js-runtime/v8-object-and-value-representation-deep-dive.md` — small integers, heap numbers, pointer compression, elements kinds and strings.
- `js-runtime/v8-memory-and-startup-deep-dive.md` — parsing, lazy compilation, code caching and garbage collection.
- `js-runtime/private-fields.md` — private class fields in V8.
- `js-runtime/node-worker-default-heap-limit.md` — heap limits of worker threads.
- `javascript/object-basics/index.md` — objects, references and garbage collection basics.
- `performance/code-review/problem-classes-language-runtimes.md` — the `object-shape-instability` problem class.
