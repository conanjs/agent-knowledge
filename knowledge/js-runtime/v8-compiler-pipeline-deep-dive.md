---
schema: deep-dive/v1
topic: js-runtime
status: verified
applies-to: ["Node.js 24.22.1 with V8 13.6.233.17-node.58, linux arm64, pointer compression off (image node:24.22.1-alpine in Docker on an Apple M2)", "V8 source at tag 13.6.233.17", "lab runs of 2026-11-26", "matrix re-run of 2026-11-27: macOS 26.1 arm64 with Node.js 24.22.1, 22.23.4 (V8 12.4) and 25.7.0 (V8 14.1), linux x64 emulated with Node.js 24.22.1, Electron 43.7.7 as Node (V8 15.0, pointer compression on), Node.js 24.22.3 linux x64 emulated with pointer compression on (V8 13.6), Deno 2.9.8 (V8 15.0) and Electron 38.8.6 (V8 14.0) for the narrowing runs, Google Chrome 158.0.8127.89 headless (V8 15.8)", "Chrome 158.0.8127.89 runs of 2026-11-28 on macOS 26.1 arm64: a visible window (front tab), a hidden tab, a minimized window and a covered window"]
last-updated: 2026-11-28
last-verified: 2026-11-27
synthesized-into: []
tags: [v8, nodejs, jit, ignition, sparkplug, maglev, turbofan, turboshaft, inline-caches, deoptimization, osr, inlining, escape-analysis, performance]
ranked-sources: true
---

# V8's compiler pipeline in Node.js 24: tiers, feedback, deoptimization and what keeps code fast

## Summary
**TL;DR:** In Node.js 24.22.1 (V8 13.6), every function starts as bytecode in the Ignition interpreter. Hot functions move up to three compilers in turn: Sparkplug, Maglev and TurboFan ✅[^lab]. The defaults differ on other builds: Node.js 22.23.4 (V8 12.4) starts with Maglev off, and the emulated linux x64 build of Node.js 24.22.1 starts with TurboFan off (seen in an emulated x64 container; native x64 was not run) ✅[^lab-matrix]. Maglev and TurboFan guess types from the feedback that the lower tiers collected. When a guess fails, the code deoptimizes: it jumps back to the interpreter at the same bytecode, and V8 records the new case ✅[^lab] ✅[^maglev]. The lab shows that the old advice about `try`/`catch`, `arguments`, generators, `eval` and "600-character functions" no longer holds in this version: for the small functions tried here, TurboFan compiled all of them, both when optimization was forced after warm-up (status bit 6 read after `%OptimizeFunctionOnNextCall`) and in natural tier-up with inlining switched off (§3.8) ✅[^lab]. The same held on V8 12.4, 14.1 and 15.0, where the TurboFan bit is bit 5 on 14.1 and 15.0 ✅[^lab-matrix]. What still costs, and can be seen with a flag, is code that keeps the compilers' guesses wrong: many object shapes at one site, small integers that overflow, reads past the end of an array, and branches that never ran before optimization ✅[^lab].

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
| Smi (small integer) | An integer stored directly in a pointer-sized value, without a heap object | Coins kept in the pocket instead of a wallet | Up to 2**31 − 1 in this build; up to 2**30 − 1 with pointer compression on (Electron 43 with V8 15.0, and a Node.js 24 build with V8 13.6) ✅[^lab-matrix] (§3.2) |
| Speculative optimization | Compiling for the types seen so far, with a check that bails out if a new type shows up | Laying out only the tools you used yesterday, with an alarm for surprises | `inc(a)` compiled for small integers (§3.2) |
| Deoptimization (deopt) | Leaving optimized code and continuing in the interpreter at the same point | Leaving the motorway at the next exit when the road ahead is closed | `reason: overflow` when `inc(2 ** 31 - 1)` overflows (§3.2) |
| Eager / lazy deopt | Eager: a check inside the optimized code fails now. Lazy: something else invalidated the code; the function leaves it when control returns to it | Eager: you see the closed road. Lazy: the radio says the road is closed, and you leave at the next exit | `deopt-eager, reason: wrong map`; `deopt-lazy` after `P.prototype.m` was replaced (§3.2) |
| Deopt loop | Optimize, deopt, optimize again, deopt again, without end | A thermostat that keeps flipping between heat and cool | Ends after the 5th map here, because the site becomes megamorphic (§3.3) |
| OSR (on-stack replacement) | Switching a function that is still running a loop into optimized code, in the middle of the loop | Changing a train's engine while it is moving | `[OSR - entry. function: longLoop, osr offset: 35]` (§3.4) |
| Inlining | Copying a called function's body into the caller's optimized code | Writing a friend's phone number into your own notes instead of looking it up | `Inlining {<SharedFunctionInfo addOne>} into {<SharedFunctionInfo caller>}` (§3.5) |
| Escape analysis | Proving that an object never leaves a function, so it need not be allocated at all | Doing a sum in your head instead of on paper you would then throw away | 10 million `{ x, y }` objects, 0 scavenges (§3.6) |
| Scavenge | A collection of the young generation of the heap (GC = garbage collection) | Emptying the small desk bin, not the building's skip | "more than 20" scavenges once escape analysis is off (§3.6) |
| Built-in | A function that ships inside V8, such as `Array.prototype.forEach` | A tool that came in the box | `forEach`'s callback inlined into the caller (§3.9) |
| Natives syntax | Test-only functions such as `%GetOptimizationStatus(f)`, enabled by `--allow-natives-syntax` | The service panel behind a machine's cover | Status `81` = `IsFunction|Optimized|TurboFanned` on V8 13.6; the same state reads `41` on V8 14.1 and 15.0 ✅[^lab-matrix] (§4.1) |

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

The Maglev post (2023-12-05) puts Maglev's compile speed at "roughly 10x slower than Sparkplug, and 10x faster than TurboFan" ✅[^maglev]. All four tiers, and the Turboshaft phases, are on by default in this build ✅[^lab]. Not on every build: `--v8-options` prints `--no-maglev` on V8 12.4 (Node.js 22.23.4), and `--no-turbofan` on the emulated linux x64 build of Node.js 24.22.1 (the same V8 as the baseline; there even `%OptimizeFunctionOnNextCall` left functions without TurboFan code, and `--turbofan` turned it back on; a Node.js 24.22.3 build with pointer compression, emulated the same way, also starts with `--no-turbofan`; the cause is not isolated: the emulation is one candidate, as native x64 was not run) ✅[^lab-matrix].

**What triggers tier-up in 13.6.** V8 gives each function a budget. The budget is a flag value times the function's bytecode length: `invocation_count_for_maglev * bytecode_length` for Maglev and `invocation_count_for_turbofan * bytecode_length` for TurboFan ✅[^tiering]. The defaults in this build are 400 and 3000, and 8 for allocating the feedback vector; each is the default that `node --v8-options` prints for the flag named above ✅[^lab]. The 400, 3000 and 61440 were the same on all six builds of the matrix ✅[^lab-matrix]. Sparkplug has no number of its own: the tiering code tests whether the function already has a feedback vector and can be compiled to baseline code, and the budget for that first step is the feedback-allocation budget ✅[^tiering]. A function whose bytecode is longer than `--max-optimized-bytecode-size` (61440 bytes here) gets no TurboFan code: the source returns a huge budget for it and rejects it in `ShouldOptimize` ✅[^tiering]. In the lab (`toobig.mjs`, below), a function of 3 250 statements (60 988 bytes of bytecode) was TurboFan code after forced optimization and one of 3 400 statements (63 838 bytes) was not, until the flag was raised to 200 000 ✅[^lab]. Measured in Chrome 158.0.8127.89 (V8 15.8, a page variant of the script, §6.4): forced optimization gave TurboFan code up to 6 000 statements and not at 6 400; the bytecode length and the flag's value cannot be read in a page ✅[^lab-matrix]. When an inline cache changes state, V8 raises the budget to `--minimum-invocations-after-ic-update` (500) times the bytecode length (capped), only if that is larger than the current budget, so optimization waits ✅[^tiering] ✅[^lab].

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

The names say "invocation count", but the lab shows that a function with a loop reaches them in fewer calls. `sum` runs an 8-step loop per call. With `--single-threaded`, it reached Sparkplug at call 28, Maglev at call 70 and TurboFan at call 1957, not at 400 and 3000 calls ✅[^lab]. Those call numbers are for V8 13.6. On V8 14.1 (Node.js 25.7.0) TurboFan came at call 3090; in Electron 43 (V8 15.0) Sparkplug came at call 21 and TurboFan at call 3091. The Sparkplug call is not a property of the version: Deno 2.9.8 (V8 15.0) gave call 2, Electron 38.8.6 (V8 14.0) call 10, and the same script with its `import` line replaced, on the baseline's Node.js, call 29; with `--no-baseline-batch-compilation` all of them, Chrome 158 included, gave call 2. So the call depends on when Sparkplug compiles its batch of waiting functions, which other code in the process changes (an inference from these runs) ✅[^lab-matrix]. In Chrome 158.0.8127.89 (V8 15.8, headless page) `sum` went from Ignition to Maglev at call 70 with no Sparkplug step, and reached no TurboFan code in 20 000 calls unless V8's efficiency mode was switched off (`--no-efficiency-mode`: TurboFan at call 3091) ✅[^lab-matrix]; on V8 12.4 (Node.js 22.23.4), where Maglev is off, the function went from Ignition to TurboFan at call 403 and showed no Sparkplug step ✅[^lab-matrix]. This fits a budget that the running bytecode, loop iterations included, uses up (an inference from the source and the lab, not stated in the source). A function without a loop needs more calls, not fewer: in the check `natural.mjs` (§3.8; `--single-threaded`, inlining switched off, 40 000 calls) a loop-free `function plain(a) { return a < 0 ? 0 : a; }` first had TurboFan code at call 11 321, and a function with a 20-step loop at call 938 ✅[^lab]. The order held on the other builds, with other numbers: 17 866 and 1 485 on V8 14.1 and 15.0, 3 011 and 182 on V8 12.4 ✅[^lab-matrix]. Measured in Chrome 158.0.8127.89 (V8 15.8, headless page, a page variant): 17 866 and 1 485 with `--no-efficiency-mode`; with Chrome's default flags the loop function stayed Maglev code after 40 000 calls in both runs (§6.4) ✅[^lab-matrix]. So "400 and 3000" are budget factors, not call counts. Without Maglev, TurboFan took over at call 403 for `sum`. With the default flags, compilation runs on background threads, and the call at which each tier appears changed from run to run: the last line of the output below differs between runs ✅[^lab].

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
| `smiOverflow` | 12:32, `a + 1` | line 16, `inc(2 ** 31 - 1)`: the sum leaves the small-integer range | `overflow`; with pointer compression on (Electron 43 with V8 15.0, and Node.js 24.22.3 with V8 13.6) `not a Smi`, because 2 ** 31 − 1 is not a small integer there ✅[^lab-matrix] | eager |
| `outOfBounds` | 19:33, `a[i]` | line 24, `at(arr, 3)` on a 3-item array | `out of bounds` | eager |
| `noFeedback` | 27:49, `o.y` | line 31, `pick(…, true)`: a branch that never ran before optimization | `Insufficient type feedback for generic named access` | eager |
| `notASmi` | 34:33, `n >> 1` | line 38, `half(7.5)` where only small integers were seen | `not a Smi` | eager |
| `wrongCallTarget` | 41:31, `fn()` | line 46, `run(b)` after only `a` was seen | `wrong call target` | eager |
| `lazy` | (no location printed) | line 58, `callM(o, change)`: `change` replaces `P.prototype.m` while `callM` runs | `(unknown)`, after `marking dependent code … reason: dependent field type constness changed` (on V8 12.4: `reason: code dependencies` ✅[^lab-matrix]) | lazy |

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

The `smiOverflow` case uses 2 ** 31 − 1 because that is the largest small integer in this build: `%IsSmi(2 ** 31 - 1)` is `true` and `%IsSmi(2 ** 31)` is `false` ✅[^lab]. The same on V8 12.4 and 14.1. With pointer compression on, the largest small integer is 2 ** 30 − 1. This was seen in Electron 43 (V8 15.0) and in a Node.js 24.22.3 build with pointer compression (V8 13.6, sandbox off); Node.js 24.22.1 without it, on the same emulated x64, gave the baseline result, so pointer compression is the cause ✅[^lab-matrix]. On those two builds the case changes: `inc(2 ** 31 - 1)` deopts with `not a Smi`, because its argument is already a heap number, and `inc(2 ** 30 - 1)` does not deopt at all: the result, 2 ** 30, comes back as a heap number (`%IsSmi` false) and `inc` stays TurboFan code ✅[^lab-matrix]. So on that build the `overflow` deopt was not seen at the small-integer limit. Why this build has 32-bit small integers (a sign and 31 value bits, because pointer compression is off) is covered in `js-runtime/v8-object-and-value-representation-deep-dive.md`.

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

**What keeps optimized code valid:** run the hot code during warm-up with the same kinds of values it will see later. Keep numbers in one representation (integers stay integers, or doubles from the start). Keep reads inside the array. Do not change prototypes or methods after start-up. **What defeats it:** counters that grow past 2 ** 31 − 1 in code compiled for small integers (with pointer compression off; in Electron 43 and in a Node.js 24 build with it on, a value already past 2 ** 30 − 1 deopted with `not a Smi` ✅[^lab-matrix]); a rare branch that first runs after optimization; replacing a method on a class prototype while the program runs.

### 3.3 Deoptimization loops, and how V8 limits them

A deopt loop would be optimize, deopt, optimize, deopt, without end. This build has no `--max-deopt-count` flag ✅[^lab], and the tiering code (`tiering-manager.cc`) contains no deoptimization counter such as `deopt_count` or `max_deopt` ✅[^tiering]. The limit comes from the feedback: each deopt adds the new case, and the IC states only move one way, towards megamorphic (§3.1). The lab (`--single-threaded`, so that compile timing does not vary) calls `getX` 20 000 times with 1 shape, then 2, up to 8 shapes. It deopted once (`wrong map`) for each new shape from 2 to 5. Each time it was compiled again by Maglev and then TurboFan. From the 6th shape on there were no more deopts and no more compiles, because the load had become megamorphic and the optimized code uses the generic path ✅[^lab]. The deopts were the same on every build of the matrix, but the recompiles were not: on V8 14.1 and 15.0 each phase from 1 to 5 ended in Maglev code, and TurboFan code came only in phase 6; on V8 12.4 (Maglev off) each recompile went straight to TurboFan ✅[^lab-matrix]. A variation (`deoptloop-var.mjs`, below) ran 24 combinations: four site kinds (a named load, a named store, two loads in one function, a method call), three ways of making the shapes (a different first property, the same five properties added in different orders, eight different classes) and two phase lengths (20 000 and 3 000 calls). All 24 deopted once in each of phases 2 to 5 and never in phases 6 to 8 ✅[^lab]. The same on V8 14.1 and 15.0. On V8 12.4 the twelve runs with 3 000 calls per phase had no deopt in phase 2 (one in each of phases 3 to 5), and none after phase 5 ✅[^lab-matrix]. With the default flags (background compilation; the same script with `'--single-threaded', ` deleted from its `spawnSync` call), two runs of the 24 combinations gave 43 of 48 with that same pattern; the other five had a second deopt in one or two of phases 2 to 5, and none had a deopt in phases 6 to 8 ✅[^lab]. So "one deopt per new shape, none after the fifth" holds for these site kinds with `--single-threaded`, and with the default flags the count in each phase can be one higher.

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

A function called once with a long loop never reaches its call-count budget. V8 handles it with OSR: it raises an "OSR urgency" counter on the feedback vector step by step ✅[^tiering], V8 compiles optimized code for the loop, and the running frame jumps into it ✅[^lab]. With 1 000 iterations, `longLoop` was only marked for Maglev. With 5 000 000 iterations it was compiled by Maglev for OSR at bytecode offset 35 and entered (`[OSR - entry. function: longLoop, osr offset: 35]`) ✅[^lab]. No TurboFan OSR followed in that call, although the urgency was raised 284 more times. This build has `--no-osr-from-maglev` by default ✅[^lab], so a loop that entered Maglev through OSR stays in Maglev for that call (an inference from the flag and the trace). On V8 14.1 and 15.0 the trace was the same with 177 repeats instead of 284. On V8 12.4, which has Maglev off and `--osr-from-maglev` on, the 1 000-iteration run marked nothing, and the 5 000 000-iteration run compiled and entered TurboFan OSR code at the same offset 35, with no repeats after it ✅[^lab-matrix].

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
- **Size, not source length.** The 460 is the default of the V8 flag `--max-inlined-bytecode-size`, printed by `node --v8-options` (script in §2.2) with the help text "maximum size of bytecode for a single inlining" ✅[^lab]; `js-inlining-heuristic.cc` itself only reads the `-small`, `-cumulative` and `-absolute` variants ✅[^inl-heur]. A callee over the limit is rejected, and the trace prints `reason: 5`, which is `kExceedsBytecodeLimit` in the `Inlineability` enum (the sixth entry, counting from 0) ✅[^sfi-h]. The script `inline-var.mjs` below checks the limit on one family of callees (`let t = a;` and *k* statements of `t = (t * 3 + 1) | 0;`, then `return t;`) with the TurboFan trace, after 20 warm-up calls and a forced optimization of the caller: bytecode of 446 and 456 bytes was inlined, 466, 486, 506 and 706 bytes was not (`reason: 5`), and with `--max-inlined-bytecode-size=2000` all of them were inlined ✅[^lab]. The verdicts and the bytecode lengths were the same on V8 12.4, 14.1 and 15.0, but V8 14.1 and 15.0 print the reason as a name, `reason: exceeds bytecode limit`, not `reason: 5` ✅[^lab-matrix]. The same family with a comment of 2 000 characters, one of 20 000 characters, a 5 000-character block comment plus a 5 000-character line comment inside a body, and a 3 000-character variable name all gave callees of 6 to 13 bytes of bytecode that were inlined ✅[^lab]. So the limit is on bytecode, not on source text, for these callees (arithmetic bodies and comments, one call site, TurboFan, this build). Maglev has its own flag, `--max-maglev-inlined-bytecode-size`, also 460 here; no Maglev inlining run was made. Callees up to `--max-inlined-bytecode-size-small` (27 bytes) take the "small function" path ✅[^inl-heur] ✅[^lab]. On V8 12.4, 14.1 and 15.0 the Maglev limit's default is 100, and on V8 15.0 the small-function limit is 30 ✅[^lab-matrix].
- **Budget per caller.** All inlined callees of one optimized function share `--max-inlined-bytecode-size-cumulative` (920 bytes) ✅[^inl-heur] ✅[^lab].
- **Known target.** Two different functions passed to one call site: nothing was inlined. Two closures made by one factory share one function body, and were inlined. A method call `o.m()` on objects of two classes inlined both `m` methods (polymorphic inlining, `--polymorphic-inlining` on by default) ✅[^lab]. V8 14.1 and 15.0 have no `--polymorphic-inlining` flag, and still inlined both methods ✅[^lab-matrix].

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

When TurboFan has inlined enough to see an object's whole life, and the object never leaves the function, it does not allocate it. The V8 source describes the tracked object as one that "represents an allocation site and tracks the Variables associated with its fields" ✅[^escape-h]. If the code later deopts, the object is built at that moment for the interpreter frame. The lab creates 10 million `{ x, y }` objects in an optimized loop. With escape analysis on (the default), the run had 0 scavenges. With `--no-turbo-escape`, or when each object is also stored in an outside array, it had more than 20 ✅[^lab]. Maglev has its own `--maglev-escape-analysis`, also on by default ✅[^lab] (off on V8 12.4 ✅[^lab-matrix]).

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

Calling with fewer arguments assigns `undefined` to the missing parameters; extra arguments are ignored ✅[^adaptor]. Before V8 8.9, V8 handled the mismatch with an extra "arguments adaptor frame"; the post of 2021-02-15 shows the new layout in v8.9 and says removing the frame helps "get rid of almost the entire overhead" ✅[^adaptor]. In the lab (`calls.mjs`: 50 warm-up calls, forced optimization of the calling function, 1 000 further calls, status bit 6 of the caller, which is bit 5 on V8 14.1 and 15.0 ✅[^lab-matrix]), each of these targets was inlined into a TurboFan caller and none deoptimized: fewer arguments, more arguments, rest parameters, `arguments.length` and `arguments[0]`, `arguments` stored in an outside variable, sloppy-mode `arguments` aliasing a reassigned parameter, a bound function, and a closure ✅[^lab].

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

In `calls.mjs` the target arrives as a parameter. With `f.apply(null, [1, 2, 3])`, `f(...[1, 2, 3])` and `f.call(null, 1, 2, 3)` the target was not inlined, though the caller was optimized ✅[^lab]. The likely reason is that the call site's feedback records `apply` or `call`, not `f` (an inference). The second script uses a fixed target, `sum3`, in a CommonJS file. There `sum3.call(…)`, a bound `sum3`, and spread or `apply` of an array literal were inlined. Spread or `apply` of an array held in a variable, `apply` with `arguments`, and forwarding rest parameters with `sum3(...xs)` were not inlined; the caller was still TurboFan code ✅[^lab]. The same on V8 12.4 and 14.1. In Electron 43 (V8 15.0, pointer compression on) spread and `apply` of an array held in a variable were inlined too; `apply` with `arguments` and rest forwarding were still not ✅[^lab-matrix]. Pointer compression is not the cause: the Node.js 24.22.3 build with it (V8 13.6, x64, emulated, `--turbofan`) did not inline them, as in the baseline. Deno 2.9.8 (V8 15.0, sandbox and pointer compression off) inlined them too, and Electron 38.8.6 (V8 14.0) did not: seen on V8 15.0 in two embedders, not on V8 14.0 or 14.1 ✅[^lab-matrix]. Not checked in Chrome: the script reads a V8 trace, which does not reach a page.

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

The 2017 launch post says Crankshaft, TurboFan's predecessor, "was not designed to optimize JavaScript code using structured exception handling", and that TurboFan was designed "to optimize all of the language features" ✅[^launch-tf]. The lab checks it for V8 13.6 in two ways. **Forced** (`self.mjs`, and the `caller` functions of `calls.mjs`): after 20 to 50 warm-up calls, `%OptimizeFunctionOnNextCall` and one more call, then the status bit `TurboFanned` (bit 6, value 64, on V8 13.6 and 12.4; bit 5, value 32, on V8 14.1 and 15.0 ✅[^lab-matrix]) of the function itself, read after 100 further calls. Each of these functions had the bit set: `try`/`catch`, a `try`/`catch` that throws on every call, `try`/`finally`, a generator, an `async` function with `await`, a loop over `arguments`, `for…of`, `for…in`, a function that calls `eval`, and a sloppy-mode function with a `with` statement ✅[^lab]. **Natural tier-up** (`natural.mjs`, below; no `%Optimize…` call, `--single-threaded`, `--no-turbo-inlining --no-maglev-inlining`): the status bit was read after every call of up to 40 000 calls. Sixteen subjects reached TurboFan code, between call 1 465 and call 15 991, and two controls without any of the features did the same (a loop-free function at call 11 321, one with a loop at call 938). The subjects were `try`/`catch` (three forms: plain, around a loop, throwing on every call), `try`/`finally`, `arguments` read in a loop, `arguments` stored in an outer variable, sloppy-mode `arguments` aliasing a reassigned parameter, `arguments` passed to `Math.max.apply` in strict mode, two generators (one resumed with a value), `for…in` over 2 and over 8 properties, `eval` of an expression using a parameter and of one using a local variable, and `with` over an object with and without a local variable read ✅[^lab]. On V8 12.4, 14.1 and 15.0 every subject also reached TurboFan code, forced and natural, at other calls: between call 290 and call 4 458 on V8 12.4 (Maglev off), and between call 2 320 and call 25 222 on V8 14.1 and 15.0 ✅[^lab-matrix]. Measured in Chrome 158.0.8127.89 (V8 15.8, headless page; `self.mjs` with the 14.1 masks, `natural.mjs` as a page variant, §6.4): forced, all ten were TurboFan code; natural, all eighteen reached TurboFan code with `--no-efficiency-mode`, at about the E7 calls, and with Chrome's default flags 5 to 12 of the 18 stayed Maglev code for all 40 000 calls (8 and 8 in the first two runs, the loop control among them in both; 12, 10 and 5 in the three later runs of §6.2; a different set each time): there, staying in Maglev says nothing about the feature ✅[^lab-matrix]. Natural tier-up needs the inlining flags: with the two inlining flags deleted from the script, 12 of the 16 subjects stayed at Sparkplug or Maglev for all 40 000 calls, because TurboFan inlined them into the small `use` arrow function and they no longer ran on their own (a first run of the script, without the controls). So both claims are about the function's own code, for small functions, on this build. The list of bailout reasons in this version has no entry for any of these features ✅[^bailout-reason].

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

Array methods are built-ins, but TurboFan can inline the method and its callback into the caller. The flag `--turbo-inline-array-builtins` is on by default ✅[^lab]. The release post of 2017-12-19 says "calls to Array.prototype.map and Array.prototype.filter are now inlined for many cases" ✅[^release64]. In the lab, the callbacks of `forEach`, `map`, `reduce`, `filter` and `find` were inlined into a TurboFan caller; the comparator of `sort` was not ✅[^lab]. The same on V8 12.4 and 14.1; in Electron 43 (V8 15.0, pointer compression on) the `sort` comparator was inlined too. Not because of pointer compression: the Node.js 24.22.3 build with it (V8 13.6, x64, emulated, `--turbofan`) did not inline it, as in the baseline. Deno 2.9.8 (V8 15.0) inlined it, and Electron 38.8.6 (V8 14.0) did not: seen on V8 15.0 in two embedders, not on V8 14.0 or 14.1; not checked in Chrome (the script reads a V8 trace) ✅[^lab-matrix]. The `map` case deoptimized once, with `wrong map` at the `.length` read of the array that `map` returned, and stayed TurboFan code after the second optimization ✅[^lab]. Calls through `call`, `apply` and spread are in §3.7.

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

**Other versions.** The bit numbers above are for V8 13.6. On V8 12.4 (Node.js 22.23.4) `tiers.mjs` printed the same numbers, except the two Maglev lines: Maglev is off there, so the function stayed Sparkplug code. On V8 14.1 (Node.js 25.7.0) and V8 15.0 (Electron 43) the layout is different. Found by experiment, not read from those versions' `runtime.h`: `--always-turbofan` is a bad option there and `AlwaysOptimize` is gone; `--deopt-every-n-times` sets bit 2, and every bit from `MaybeDeopted` up sits one place lower than in 13.6. With that layout (the 13.6 names with `AlwaysOptimize` removed) both scripts decode to the same states as in 13.6: TurboFan code is `41` (`IsFunction|Optimized|TurboFanned`, bits 0, 3 and 5), Ignition `65`, Sparkplug `16385`, never called `131073` ✅[^lab-matrix]. A script that tests `& 64` for TurboFan reads `Interpreted` on those versions. Chrome 158.0.8127.89 (V8 15.8), Deno 2.9.8 (V8 15.0) and Electron 38.8.6 (V8 14.0) printed the same numbers as V8 14.1 for every line of `tiers.mjs`, and Chrome for every line of a page variant of `bits-extra.mjs` (there `--always-turbofan` set no bit: Chrome does not show V8's "bad option" message) ✅[^lab-matrix].

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

**The bits `tiers.mjs` did not reach.** A second script (`bits-extra.mjs`, below) makes the other bits appear, by a concurrent optimization request, by reading the status from inside a running function, and by flags. In the runs, `%OptimizeFunctionOnNextCall(f, 'concurrent')` gave `MarkedForConcurrentOptimization` (bit 9), the next call gave `OptimizingConcurrently` (bit 10), and the finished compile gave `81`. A function that read its own status while running showed `TopmostFrameIsTurboFanned` (bit 12) in TurboFan code, `TopmostFrameIsMaglev` (bit 19) in Maglev code and `TopmostFrameIsBaseline` (bit 17) in Sparkplug code. `--always-turbofan` added `AlwaysOptimize` (bit 2), `--deopt-every-n-times=100` added `MaybeDeopted` (bit 3), and both `--lite-mode` and `--jitless` gave `NeverOptimize|LiteMode` (bits 1 and 13), which matches `!isolate->use_optimizer()` being true when the optimizer is off. The two flags `--optimize-on-next-call-optimizes-to-maglev` and `--optimize-maglev-optimizes-to-turbofan` set bits 20 and 21; with the first, a concurrent request set `MarkedForConcurrentMaglevOptimization` (bit 23). Bit 14, `MarkedForDeoptimization`, was not seen: after `%DeoptimizeFunction` the status showed no optimized code at all (`129`) ✅[^lab] ✅[^runtime-test]. These runs are for one tiny function on this build. On V8 12.4 `--optimize-maglev-optimizes-to-turbofan` does not exist, and bits 19, 20, 22 and 23 did not appear (Maglev is off). On V8 14.1 and 15.0, decoded with the layout above, every bit appeared as here except `AlwaysOptimize`, which is gone ✅[^lab-matrix].

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

Measured here, for this one function body (`s += v` over small integers): in A, `for…of` took 9.5 to 10.0 times as long as the index loop, `forEach` 6.7 to 7.1 times and `reduce` 6.6 to 7.0 times. In B, `for…of` took 1.15 to 1.22 times as long, `forEach` 1.84 to 1.94 times, and `reduce` 0.81 to 0.85 times (faster than the index loop) ✅[^lab]. The order of the four forms was the same in all four runs. On macOS with Node.js 24.22.1 and with V8 12.4 the order and the ratios were about the same (three runs each). Not on the newer versions (four runs each): on V8 14.1, in B, `for…of` was faster than the index loop (0.93 to 0.95) and `forEach` took 2.8 to 2.9 times as long; in Electron 43 (V8 15.0), in A, the index loop and `for…of` were TurboFan code at entry and `for…of` took 0.83 times as long as the index loop, and in B `forEach` took 2.7 to 2.8 times as long and `reduce` 1.01 to 1.02 times ✅[^lab-matrix]. The A result of Electron 43 also came on Deno 2.9.8 (V8 15.0) and not on Electron 38.8.6 (V8 14.0); the `reduce` of about 1.0 came on Electron 38.8.6 and not on Deno 2.9.8 (0.81 to 0.91) ✅[^lab-matrix].

Measured in Chrome 158.0.8127.89 (V8 15.8, a page variant that times with `performance.now()`, §6.4), beside the baseline (times the index loop). V8's efficiency mode can delay TurboFan in a headless page (§6.2), so the main figures are three headless runs with the Chrome flag `--disable-renderer-backgrounding`, the nearest this set-up gets to a foreground tab; three runs in a visible window gave the same B ratios ✅[^lab-matrix]:

| Form | A: baseline | A: Chrome 158 | B: baseline | B: Chrome 158 |
|---|---|---|---|---|
| `for…of` | 9.5 to 10.0 | 0.88, 3.43, 8.47 (one per run; it was TurboFan code at entry in the first two) | 1.15 to 1.22 | 0.96 to 0.97 |
| `forEach` | 6.7 to 7.1 | 6.46 to 7.17 | 1.84 to 1.94 | 2.64 to 2.67 |
| `reduce` | 6.6 to 7.0 | 6.12 to 6.73 | 0.81 to 0.85 | 0.99 to 1.00 |

The index loop was TurboFan code at entry in A in all three runs. In the visible window (three runs): in A `for…of` took 8.66 to 9.65, `forEach` 6.72 to 7.76 and `reduce` 6.35 to 7.05 times as long as the index loop; in B 0.96 to 0.97, 2.67 to 2.70 and 1.00 to 1.01. With `--no-efficiency-mode` (three runs): B 0.96 to 0.97, 2.67 to 2.70 and 0.99 to 1.01. With the default headless flags, a backgrounded renderer, two of three runs gave the same B ratios (0.96 to 0.97, 2.67 to 2.68, 1.00); in the third every function, in A and in B, stayed Maglev code: the index loop took 25 ms in B instead of 13.6 to 14.2, and `for…of`, `forEach` and `reduce` took 2.42, 2.38 and 4.02 times as long (the first agent saw the same once in three runs: 26.0 ms, 2.35, 2.37, 3.98). So in Chrome, when B ended in TurboFan code, `forEach` was the slowest form and `reduce` was not faster than the index loop; when it ended in Maglev code, `reduce` was the slowest. These are ratios of one function body on one machine, measured here, not general ratios. In a hidden tab of a visible window (three runs, 2026-11-28, §6.2) every function stayed Maglev code, except `forEach` and `reduce` in A (Sparkplug): in A `for…of` took 2.44 to 2.45, `forEach` 4.28 to 4.39 and `reduce` 4.02 to 4.16 times as long as the index loop, in B 2.49 to 2.56, 2.38 to 2.45 and 4.04 to 4.15, and the index loop took 25.2 to 25.9 ms per round in B. Three runs in the front tab on the same day: B 0.96, 2.67 and 1.00 to 1.01 with the index loop at 13.8 to 13.9 ms, A 8.90 to 9.72, 6.89 to 7.52 and 6.45 to 7.04. A review repeated it (two runs each, machine under load): hidden tab, every function again Maglev code except `forEach` and `reduce` in A (Sparkplug), in B 2.43 to 2.54, 2.38 and 3.99 to 4.01 with the index loop at 24.7 to 26.0 ms; front tab, B 0.97 to 0.98, 2.65 to 2.66 and 0.99 to 1.01 with the index loop at 13.6 to 14.1 ms, but in A `for…of` took 9.2 times as long as the index loop in one run (Sparkplug code) and 0.92 in the other (TurboFan code), so the A figure for `for…of` in the front tab is not stable ✅[^lab-matrix].

Which code ran in A in the baseline: `--trace-osr` on a copy of the script with workload B removed printed 201 `OSR - entry` lines each for the `for` loop and the `for…of` loop and none for `forEach` and `reduce`, so only the first two ran their loop in on-stack-replacement code ✅[^lab]. `forEach` and `reduce` loop inside the built-in, which calls the callback once per item; the enclosing function was not TurboFan code, so the callback cannot have been inlined into it (an inference; the inlining of those callbacks into TurboFan callers is §3.9). The point is that the answer to "is `forEach` slower than `for`" depends on which tier runs the code. In B, the `forEach` callback adds into `s`, a variable of the outer function, which may explain part of its gap (an inference; the lab did not isolate it).

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

What holds across these cases: when all three functions end as TurboFan code, `forEach` was 1.3 to 1.9 times slower than the index loop. What does not: `reduce` was faster than the index loop only for the plain sum (0.82 to 0.89) and slower for the second body (1.28 to 1.40), so "`reduce` faster than `for`" is true of that one body; and between the two workload kinds there is a middle one (100 000 items x 200 calls) where `for` reached TurboFan while `forEach` and `reduce` stayed in Maglev, and they were 3 to 45 times slower. The tier column is the status after the run (the same in all three runs), so a function that reached TurboFan late shows TurboFan. On the other macOS builds (V8 12.4, 14.1 and 15.0; the ranges are over the first agent's four runs and a review's three more, §6.4) these conclusions changed ✅[^lab-matrix]. On V8 12.4 (Maglev off) the middle workload ended all TurboFan, with `forEach` at 1.8 to 1.9 and `reduce` at 0.8 to 0.9, and for the second body the index loop was the slowest form (`forEach` and `reduce` 0.82 to 0.86). On V8 14.1, with all three as TurboFan code, `forEach` took 2.2 to 3.0 times as long, and `reduce` was faster than the index loop for both bodies (0.80 to 0.96). In Electron 43 (V8 15.0), `forEach` took 2.7 to 3.2 times as long for the sum and 4.6 to 6.3 times for the second body, and `reduce` 1.0 for the sum and 1.2 to 1.5 for the second body. On macOS with Node.js 24.22.1 (three runs) the table above held, with `forEach` at 1.4 to 2.1 when all three were TurboFan code. Measured in Chrome 158.0.8127.89 (V8 15.8, headless page, a page variant, three runs with `--disable-renderer-backgrounding`): with all three as TurboFan code, `forEach` took 2.61 to 3.13 times as long for the sum and 4.55 to 6.19 times for odd squares, and `reduce` 0.99 to 1.03 and 0.76 to 0.86; the middle workload left `forEach` and `reduce` in Maglev, as in the baseline. With `--no-efficiency-mode` (three runs) the ranges were 2.30 to 3.15 and 4.71 to 6.24 for `forEach` and 0.87 to 1.03 and 0.79 to 0.90 for `reduce`. With the default headless flags, one of three runs ended every function in Maglev code (`forEach` 2.4 to 2.6 and `reduce` 3.1 to 4.1 times the index loop in the four middle and large workloads) ✅[^lab-matrix].

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

How long a function needs before the numbers settle is a separate result. The script `warmup.mjs` times 25 rounds of 2 000 calls over 10 000 items. In all three runs the first five rounds (10 000 calls) took 51 to 76 ms for `forEach` and 95 to 111 ms for `reduce`, against 9 to 12 ms for `for` (its first round: 14 to 20 ms). The sixth round was in between, and from the seventh round (after 12 000 calls) `forEach` mostly took 19 to 21 ms and `reduce` 8 to 10 ms, with an occasional 12 or 13 ms or 25 ms round. So a benchmark that stops before about 10 000 calls of this function measures the code before TurboFan optimized the callbacks ✅[^lab]. This holds for this one body and size on this build. The point at which the numbers settle moved with the version: from the third round (after 4 000 calls) on V8 12.4, and from the tenth round (after 18 000 calls) on V8 14.1 and 15.0, where `forEach` then took 30 to 39 ms per round ✅[^lab-matrix]. Measured in Chrome 158.0.8127.89 (V8 15.8, headless page, a page variant): from round 10 too, in the three runs with `--disable-renderer-backgrounding` (`forEach` 36 to 42 ms and `reduce` 13 to 16 ms from round 10 on, mostly 36 to 38 and 14), in the three with `--no-efficiency-mode`, and in two of three with the default flags; in the third default run neither settled (60 to 65 ms and 97 to 106 ms in every round). In a visible window (three runs, 2026-11-28) it settled from round 10 in all three, with `forEach` at 36 to 41 ms and `reduce` at 14 to 16 ms from then on ✅[^lab-matrix].

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

Names, bit numbers and order from `enum class OptimizationStatus` in `src/runtime/runtime.h` at tag 13.6.233.17 ✅[^runtime-h]; "Set when" from `Runtime_GetOptimizationStatus` in `src/runtime/runtime-test.cc` at the same tag ✅[^runtime-test]; "Seen" says which script showed the bit: `tiers.mjs` or `bits-extra.mjs` (§4.1) ✅[^lab]. The last column was found by experiment on V8 14.1 (Node.js 25.7.0) and V8 15.0 (Electron 43): the same two scripts, decoded with this layout, gave the same states as on 13.6, and `--always-turbofan` is a bad option there ✅[^lab-matrix]. Chrome 158 (V8 15.8) printed the same values as V8 14.1 in both scripts, so the last column holds there too ✅[^lab-matrix]. V8 12.4 (Node.js 22.23.4) printed the 13.6 values for every bit it showed (bits 19 to 23 were not seen there) ✅[^lab-matrix].

| Bit | Value | Name | Set when | Seen | V8 14.1 and 15.0: bit (value) |
|---|---|---|---|---|---|
| 0 | 1 | IsFunction | the argument is a function | yes (`tiers.mjs`) | 0 (1) |
| 1 | 2 | NeverOptimize | the isolate does not use the optimizer | yes, with `--lite-mode` and `--jitless` (`bits-extra.mjs`) | 1 (2) |
| 2 | 4 | AlwaysOptimize | `--always-turbofan` or `--prepare-always-turbofan` | yes, with `--always-turbofan` (`bits-extra.mjs`) | gone |
| 3 | 8 | MaybeDeopted | `--deopt-every-n-times` | yes (`bits-extra.mjs`) | 2 (4) |
| 4 | 16 | Optimized | optimized code is attached and not marked for deopt | yes (`tiers.mjs`) | 3 (8) |
| 5 | 32 | Maglevved | that code is Maglev code | yes (`tiers.mjs`) | 4 (16) |
| 6 | 64 | TurboFanned | that code is TurboFan code | yes (`tiers.mjs`) | 5 (32) |
| 7 | 128 | Interpreted | the active tier is Ignition | yes (`tiers.mjs`) | 6 (64) |
| 8 | 256 | MarkedForOptimization | a synchronous TurboFan request is pending | yes (`tiers.mjs`) | 7 (128) |
| 9 | 512 | MarkedForConcurrentOptimization | a concurrent TurboFan request is pending | yes (`bits-extra.mjs`) | 8 (256) |
| 10 | 1024 | OptimizingConcurrently | a background compile is running (`tiering_in_progress()`) | yes (`bits-extra.mjs`) | 9 (512) |
| 11 | 2048 | IsExecuting | a frame of the function is on the stack | yes (`tiers.mjs`) | 10 (1024) |
| 12 | 4096 | TopmostFrameIsTurboFanned | that frame is TurboFan code | yes (`bits-extra.mjs`) | 11 (2048) |
| 13 | 8192 | LiteMode | `--lite-mode`, `--jitless`, or no TurboFan in the build | yes, with both flags (`bits-extra.mjs`) | 12 (4096) |
| 14 | 16384 | MarkedForDeoptimization | the attached optimized code is marked for deopt | no (not reached by the runs) | 13 (8192), by position only: not seen |
| 15 | 32768 | Baseline | Sparkplug code is attached | yes (`tiers.mjs`) | 14 (16384) |
| 16 | 65536 | TopmostFrameIsInterpreted | the frame is interpreted | yes (`tiers.mjs`) | 15 (32768) |
| 17 | 131072 | TopmostFrameIsBaseline | the frame is Sparkplug code | yes (`bits-extra.mjs`) | 16 (65536) |
| 18 | 262144 | IsLazy | the function is not compiled yet | yes (`tiers.mjs`) | 17 (131072) |
| 19 | 524288 | TopmostFrameIsMaglev | the frame is Maglev code | yes (`bits-extra.mjs`) | 18 (262144) |
| 20 | 1048576 | OptimizeOnNextCallOptimizesToMaglev | the flag `--optimize-on-next-call-optimizes-to-maglev` is on | yes (`bits-extra.mjs`) | 19 (524288) |
| 21 | 2097152 | OptimizeMaglevOptimizesToTurbofan | the flag `--optimize-maglev-optimizes-to-turbofan` is on | yes (`bits-extra.mjs`) | 20 (1048576) |
| 22 | 4194304 | MarkedForMaglevOptimization | a Maglev request is pending | yes (`tiers.mjs`) | 21 (2097152) |
| 23 | 8388608 | MarkedForConcurrentMaglevOptimization | a concurrent Maglev request is pending | yes, with the flag of bit 20 (`bits-extra.mjs`) | 22 (4194304) |

These bits are an interface for V8's own tests: the source comment says they "must be in sync with bits defined in test/mjsunit/mjsunit.js" ✅[^runtime-h]. The names and the "Set when" column are for tag 13.6.233.17; no other version's `runtime.h` was read. The 14.1 and 15.0 column comes from runs only, so decode with the table of the version you run, and check it with `tiers.mjs` first.

### 5.2 Tiering flags in this build

All defaults below were read from `node --v8-options` (script in §2.2) ✅[^lab]. The defaults on the other builds of the matrix are in §6.4 ("Other builds and versions"); nine of the flags of `flags.mjs` differ on at least one build ✅[^lab-matrix].

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
| "A `try`/`catch` prevents optimization" | The bluebird "Optimization killers" wiki listed "Functions that contain a try-catch statement" as not optimizable ✅[^bluebird]; it was true of Crankshaft ✅[^launch-tf] | For small functions on this build, TurboFan code existed for `try`/`catch`, `try`/`catch` that throws on every call, a `try`/`catch` around a loop and `try`/`finally`, both after forced optimization (status bit) and in natural tier-up (`natural.mjs`, inlining off); a `try`/`catch` function was also inlined into its caller ✅[^lab]. Measured in Chrome 158.0.8127.89 (V8 15.8, headless page): all ten forced subjects of `self.mjs` were TurboFan code; in natural tier-up all eighteen of `natural.mjs` were, with `--no-efficiency-mode`, while with Chrome's default flags 8 of them, controls without `try` included, stayed Maglev code after 40 000 calls (§6.4) ✅[^lab-matrix]. The wiki itself now opens with "All this is wrong in TurboFan. (Node 8+)" ✅[^bluebird] |
| "`arguments` prevents optimization; never leak it" | The same wiki: "The `arguments` object must not be passed or leaked anywhere." ✅[^bluebird] | `arguments` read, looped over, stored in an outside variable, aliased in sloppy mode, and passed to `Math.max.apply` in strict mode: TurboFan code after forced optimization and in natural tier-up (the forced runs also inlined them with no deopt) ✅[^lab]. In Chrome 158: the same as for `try`/`catch` (row above) ✅[^lab-matrix] |
| "Functions over 600 characters are not inlined" | Crankshaft's rule, as written in 2013: "Large functions (>600 source characters including whitespace or 196 AST nodes) will not be inlined." ✅[^conrod] | TurboFan dropped source size in 2016: "The source size is not a real indicator for whether or not to inline a certain function." ✅[^cr-2361813002]. Callees with comments of 2 000 and 20 000 characters were inlined; the limit is the flag `--max-inlined-bytecode-size`, 460 bytes of bytecode by default: 456 bytes inlined, 466 not (§3.5) ✅[^lab] |
| "`forEach` is slower than `for`" | Common micro-benchmarks | Depends on the tier and the size (§4.2, measured here on Node.js 24.22.1, sum of small integers): 6.7 to 7.1 times slower with 1 000 000 items and 20 calls (only the `for` loop in OSR code), 1.84 to 1.94 times with 1 000 items and 20 000 calls (all TurboFan), over four runs. With another body and other sizes the ratio ranged from 1.3 to 8 (and up to 45 for `reduce` in one middle case). `reduce` was faster than the index loop (0.81 to 0.89) for the plain sum in the TurboFan workloads, and slower (1.28 to 1.40) for a body with a condition ✅[^lab]. On V8 14.1 and 15.0 the TurboFan `forEach` ratio was 2.2 to 6.3, and on V8 12.4 `forEach` and `reduce` beat the index loop for the body with a condition (§4.2) ✅[^lab-matrix]. Measured in Chrome 158 (V8 15.8, headless, renderer not backgrounded): 2.64 to 2.67 with 1 000 items and 20 000 calls, 2.6 to 6.2 in the other TurboFan workloads (§4.2) ✅[^lab-matrix] |
| "Generators, `for…of` and `for…in` are not optimized" | The same wiki, with notes that they were optimized in later versions ✅[^bluebird] | TurboFan code, forced and natural, for the small generators and `for…in` loops tried; `for…of` forced only ✅[^lab]. In Chrome 158: the same as for `try`/`catch` (first row) ✅[^lab-matrix] |
| "`eval` and `with` are never optimizable" | The same wiki listed both under "likely never optimizable" ✅[^bluebird] | Simple functions with either (an `eval` of an expression using a parameter or a local variable; a `with` over an object, with and without a local variable read) were TurboFan code, forced and natural ✅[^lab]; in Chrome 158, the same as for `try`/`catch` (first row) ✅[^lab-matrix]. What `eval` does to the variables around it was not measured |
| "Calling with the wrong number of arguments is slow" | The arguments adaptor frame, removed in V8 8.9 ✅[^adaptor] | Fewer and more arguments: inlined, no deopt ✅[^lab] |
| "Feedback vectors are allocated after 1 KB of bytecode" | The V8 Lite post of 2019-09-12 ✅[^v8-lite] | In 13.6 the budget is `bytecode_length * invocation_count_for_feedback_allocation` ✅[^tiering], with the flag at 8 ✅[^lab]; the vector existed after 9 calls for a one-line and for a 60-statement function (`fv.mjs`, §2.3) ✅[^lab] |
| "A megamorphic site deopts again and again" | A reading of "deopt loops" | With `--single-threaded`, deopts stopped after the 5th shape in all 24 combinations of site kind, shape builder and phase length of §3.3; the site became `N` and stayed so. With the default flags one or two extra deopts appeared in 5 of 48 runs, never after the 5th shape ✅[^lab] |
| "Spread and `apply` are as cheap as a direct call" | — | Only literal arrays let the target be inlined; arrays in variables, `arguments` and rest forwarding did not ✅[^lab]. On the V8 15.0 builds run (Deno 2.9.8, Electron 43.7.7) arrays in variables were inlined too (§3.7); not checked in Chrome ✅[^lab-matrix] |
| "Up to four shapes stay fast (polymorphic)" | `js-runtime/v8-hidden-classes.md`, from a post of 2015 | The state limit is confirmed for loads and stores in 13.6: `P` for 2 to 4 maps, `N` at the 5th ✅[^lab] ✅[^ic-cc]. Whether `P` is as fast as a monomorphic site was not timed here; `performance/code-review/problem-classes-javascript-engine.md` times a polymorphic site of 4 shapes and finds it slower than one shape |

### 6.2 Pitfalls when measuring

- **Forcing optimization too early.** `%OptimizeFunctionOnNextCall` after 2 calls optimizes a function whose callees have no feedback vector yet, so nothing is inlined (§2.3) ✅[^lab]. Warm up with tens of calls first.
- **Integers that overflow in the benchmark itself.** An integer that grows past 2 ** 31 − 1 in code compiled for small integers deopts with `overflow` (§3.2) ✅[^lab]. With pointer compression on (Electron 43 with V8 15.0, and a Node.js 24 build with V8 13.6), an argument past 2 ** 30 − 1 deopted with `not a Smi` instead ✅[^lab-matrix]. Feed the values the measurement will use during warm-up.
- **Call counts vary between runs.** With the default flags, background compilation moves the call at which each tier appears; `--single-threaded` makes it repeat (§2.2) ✅[^lab]. In a headless Chrome 158 page (V8 15.8), V8's efficiency mode was on in some runs and delayed or stopped TurboFan, a different set of functions each time: with the default flags, 12, 10 and 5 of the 18 `natural.mjs` subjects stayed Maglev code after 40 000 calls in three runs, and the loop-timing page variant left every function in Maglev code in one of three runs (`tierup.mjs`: no TurboFan within 20 000 calls in two of three). With the Chrome flag `--disable-renderer-backgrounding` (a Chrome flag, not a V8 flag) or the V8 flag `--no-efficiency-mode`, TurboFan came in every run (three runs each of `natural.mjs`, `tierup.mjs` and the three timing scripts; the 18 subjects reached TurboFan at the same calls in all six runs). The page's `document.visibilityState` was `visible` in every headless run, so the page cannot see the cause; that the headless renderer is treated as a background process is an inference from the flag's effect. In a visible (not headless) Chrome window, on 2026-11-28, five runs per mode of the probe below: in the front tab it reached TurboFan code in 5 of 5 runs, and when its tab was not in front it did in 0 of 15. In a tab behind another tab, in a minimized window and in a window covered by another window, the status was `25` (Maglev code) at all twelve readings, `document.visibilityState` was `hidden`, and the 200 000 timed calls took 38.4 to 48.3 ms against 23.5 to 25.7 ms in the front tab. Starting the script as soon as the tab was hidden, or 3 or 15 seconds later, changed nothing (three runs each, Maglev code in all nine). A hidden tab that went on calling the function on a timer for 20 seconds, 5 460 000 calls in all, stayed Maglev code to the end in 3 of 3 runs. In a hidden tab, `--disable-renderer-backgrounding` and `--no-efficiency-mode` each gave TurboFan code in 3 of 3 runs, as in the headless page, so the two look like one mechanism (the sources, §6.4). An earlier probe by the same method: TurboFan in 11 of 11 flagged headless runs, in 6 of 11 default headless runs, and in 6 of 6 visible runs; the five default headless runs of 2026-11-28 all reached TurboFan. In a visible window `loops-bench.mjs`, `natural.mjs`, `tierup.mjs` and `warmup.mjs` gave the results of the flagged headless runs, and in a hidden tab `loops-bench.mjs` stayed Maglev code (§4.2, §6.4). So: headless Chrome without the flag, and a tab of a visible Chrome that is not in front, can time Maglev code where the front tab times TurboFan code. Not run: a tab that becomes visible again after being hidden; other operating systems; Chrome's Energy Saver setting; phones ✅[^lab-matrix].

<details><summary>The probe: one small function, in a visible window, a hidden tab and headless Chrome 158</summary>

```js
function hot(a, b) { let s = 0; for (let i = 0; i < 100; i++) s += (a * i + b) % 7; return s; }
let acc = 0; const seen = [];
for (let n = 1; n <= 60000; n++) {
  acc += hot(n, 3);
  if (n % 5000 === 0) seen.push(eval('%GetOptimizationStatus(hot)'));
}
const t0 = performance.now(); for (let n = 0; n < 200000; n++) acc += hot(n, 3); const t1 = performance.now();
console.log('status every 5000 calls:', seen.join(' '), '| final', eval('%GetOptimizationStatus(hot)'), '| 200k calls ms', (t1 - t0).toFixed(1), '| visibility', document.visibilityState, 'hasFocus', document.hasFocus(), acc);
```

Each run printed one line; the status after every 5 000 calls (`41` = TurboFan code, `537` = Maglev code plus bit 512, V8 15.8 layout, §4.1), the final status, the milliseconds for 200 000 timed calls, and whether the page had focus. Three runs per mode, `--js-flags=--allow-natives-syntax`:

```text
window 1: status 537 537 537 41 41 41 41 41 41 41 41 41 | final 41 | ms 25.7 | visible hasFocus true
window 2: status 537 41 41 41 41 41 41 41 41 41 41 41 | final 41 | ms 24.3 | visible hasFocus true
window 3: status 537 537 41 41 41 41 41 41 41 41 41 41 | final 41 | ms 24.8 | visible hasFocus true
headless default 1: status 41 41 41 41 41 41 41 41 41 41 41 41 | final 41 | ms 24.5 | visible hasFocus true
headless default 2: status 537 41 41 41 41 41 41 41 41 41 41 41 | final 41 | ms 23.7 | visible hasFocus false
headless default 3: status 537 41 41 41 41 41 41 41 41 41 41 41 | final 41 | ms 24.3 | visible hasFocus false
headless nobg 1: status 537 41 41 41 41 41 41 41 41 41 41 41 | final 41 | ms 23.9 | visible hasFocus false
headless nobg 2: status 537 41 41 41 41 41 41 41 41 41 41 41 | final 41 | ms 23.7 | visible hasFocus false
headless nobg 3: status 537 41 41 41 41 41 41 41 41 41 41 41 | final 41 | ms 24.8 | visible hasFocus false
```

The default headless runs all reached TurboFan here, although 5 of 11 earlier ones did not: it is a race, so a count of three says little about the share. The visible window: Chrome started without `--headless`, with `--user-data-dir=<an empty folder>`, `--remote-debugging-port=<port>` and `--js-flags=--allow-natives-syntax`, opening a `file://` page that holds the script; the page's `console.log` lines are written into `document.title`, and the title is read from `http://127.0.0.1:<port>/json/list` once it starts with a marker word. A window opens for a few seconds and the browser is then closed.

The runs of 2026-11-28 (five per mode, the same script and flags) printed the probe's own line. The page was served from a small HTTP server on 127.0.0.1 and posted its `console.log` lines back to it with `fetch`. For a hidden tab, Chrome started with `--remote-debugging-port=<port>` on a blank page of that server; a waiting page was opened as a new tab with the DevTools protocol's `Target.createTarget`, and a second `Target.createTarget` with `about:blank` put another tab in front of it. The waiting page polls `document.visibilityState` every 200 ms; when it reads `hidden`, it waits a settle time (3 000 ms unless stated) and only then replaces itself (`location.replace`) with the page that holds the script, in the same hidden tab. For a minimized window the second step is `Browser.setWindowBounds` with `windowState: 'minimized'` instead; for a covered window, a new window (`Target.createTarget` with `newWindow: true`) is placed over the test window with `Browser.setWindowBounds` and brought to the front with `Target.activateTarget`. Summary, five runs each: front tab of a visible window 5 of 5 TurboFan, 23.5 to 25.7 ms; hidden tab 0 of 5, 38.4 to 48.2 ms; minimized window 0 of 5, 46.8 to 47.5 ms; covered window 0 of 5, 40.1 to 48.3 ms; default headless 5 of 5, 23.0 to 23.7 ms. Hidden tab with a settle time of 0 ms and of 15 000 ms: 0 of 3 each, 46.3 to 47.4 and 41.3 to 47.3 ms; with `--disable-renderer-backgrounding` or with `--js-flags=--allow-natives-syntax,--no-efficiency-mode`: 3 of 3 each, 22.3 to 28.1 ms. The first run of each:

```text
status every 5000 calls: 537 41 41 41 41 41 41 41 41 41 41 41 | final 41 | 200k calls ms 25.7 | visibility visible hasFocus true 78000009
status every 5000 calls: 25 25 25 25 25 25 25 25 25 25 25 25 | final 25 | 200k calls ms 46.5 | visibility hidden hasFocus false 78000009
status every 5000 calls: 25 25 25 25 25 25 25 25 25 25 25 25 | final 25 | 200k calls ms 47.5 | visibility hidden hasFocus false 78000009
status every 5000 calls: 25 25 25 25 25 25 25 25 25 25 25 25 | final 25 | 200k calls ms 40.1 | visibility hidden hasFocus false 78000009
status every 5000 calls: 25 25 25 25 25 25 25 25 25 25 25 25 | final 25 | 200k calls ms 47.4 | visibility hidden hasFocus false 78000009
status every 5000 calls: 25 25 25 25 25 25 25 25 25 25 25 25 | final 25 | 200k calls ms 46.5 | visibility hidden hasFocus false 78000009
status every 5000 calls: 537 41 41 41 41 41 41 41 41 41 41 41 | final 41 | 200k calls ms 28.1 | visibility hidden hasFocus false 78000009
status every 5000 calls: 41 41 41 41 41 41 41 41 41 41 41 41 | final 41 | 200k calls ms 23.4 | visibility hidden hasFocus false 78000009
```

In order: front tab; hidden tab; minimized window; covered window; hidden tab with settle 0 ms; with settle 15 000 ms; hidden tab with `--disable-renderer-backgrounding`; hidden tab with `--no-efficiency-mode`. `25` is Maglev code (1 + 8 + 16), `41` TurboFan code (1 + 8 + 32), V8 15.8 layout (§4.1).
</details>

<details><summary>Does Maglev code last in a hidden tab? The probe, then 20 seconds of batches on a timer</summary>

```js
// The probe, then more batches of calls on a timer for up to 20 s: does the status change while the tab stays hidden?
globalThis.__manualFinish = true;
function hot(a, b) { let s = 0; for (let i = 0; i < 100; i++) s += (a * i + b) % 7; return s; }
let acc = 0; const seen = [];
for (let n = 1; n <= 60000; n++) {
  acc += hot(n, 3);
  if (n % 5000 === 0) seen.push(eval('%GetOptimizationStatus(hot)'));
}
const t0 = performance.now(); for (let n = 0; n < 200000; n++) acc += hot(n, 3); const t1 = performance.now();
console.log('probe: status every 5000 calls:', seen.join(' '), '| final', eval('%GetOptimizationStatus(hot)'), '| 200k calls ms', (t1 - t0).toFixed(1), '| visibility', document.visibilityState);
const start = performance.now(); let batch = 0;
function more() {
  batch++;
  const b0 = performance.now(); for (let n = 0; n < 200000; n++) acc += hot(n, 3); const b1 = performance.now();
  console.log(`batch ${batch} at ${((b0 - start) / 1000).toFixed(1)} s: 200k calls ms ${(b1 - b0).toFixed(1)}, status ${eval('%GetOptimizationStatus(hot)')}, visibility ${document.visibilityState}`);
  if (performance.now() - start < 20000) setTimeout(more, 0); else { console.log('checksum', acc); __finish(); }
}
setTimeout(more, 0);
```

The page starts hidden (hidden-tab method above) and stays hidden; `__manualFinish` and `__finish()` tell the page that posts the output back to wait for the last batch. Timers in a hidden tab fired about once per second after the first few. Three runs: status `25` at every reading, 26 batches over 19.9 s, 5 460 000 calls of `hot` in all. Batches 1 to 3 (the first 0.1 s) took 43.2 to 50.8 ms, batches 4 to 26 took 49.0 to 441.0 ms (medians 185 to 197 ms). With `--no-efficiency-mode` (two runs) every reading was `41`, and the later batches still slowed (32.7 to 187.3 ms, against 24.7 to 28.4 ms in batches 1 to 3); with `--disable-renderer-backgrounding` (one run) every reading was `41` and every batch took 21.4 to 57.6 ms. So the later slowdown is not the tier; that Chrome lowers the hidden renderer's priority with the operating system fits the description of `--disable-renderer-backgrounding` (§6.4) but was not isolated. A tab that becomes visible again was not run. The first run:

```text
probe: status every 5000 calls: 25 25 25 25 25 25 25 25 25 25 25 25 | final 25 | 200k calls ms 42.0 | visibility hidden
batch 1 at 0.0 s: 200k calls ms 50.8, status 25, visibility hidden
batch 2 at 0.1 s: 200k calls ms 45.6, status 25, visibility hidden
batch 3 at 0.1 s: 200k calls ms 44.4, status 25, visibility hidden
batch 4 at 0.1 s: 200k calls ms 185.5, status 25, visibility hidden
batch 5 at 0.3 s: 200k calls ms 184.7, status 25, visibility hidden
batch 6 at 0.5 s: 200k calls ms 177.3, status 25, visibility hidden
batch 7 at 0.9 s: 200k calls ms 92.3, status 25, visibility hidden
batch 8 at 1.9 s: 200k calls ms 188.8, status 25, visibility hidden
batch 9 at 2.9 s: 200k calls ms 191.5, status 25, visibility hidden
batch 10 at 3.9 s: 200k calls ms 49.0, status 25, visibility hidden
batch 11 at 4.9 s: 200k calls ms 202.8, status 25, visibility hidden
batch 12 at 5.9 s: 200k calls ms 189.7, status 25, visibility hidden
batch 13 at 6.9 s: 200k calls ms 244.9, status 25, visibility hidden
batch 14 at 7.9 s: 200k calls ms 168.6, status 25, visibility hidden
batch 15 at 8.9 s: 200k calls ms 187.7, status 25, visibility hidden
batch 16 at 9.9 s: 200k calls ms 168.7, status 25, visibility hidden
batch 17 at 10.9 s: 200k calls ms 239.6, status 25, visibility hidden
batch 18 at 11.9 s: 200k calls ms 188.9, status 25, visibility hidden
batch 19 at 12.9 s: 200k calls ms 197.0, status 25, visibility hidden
batch 20 at 13.9 s: 200k calls ms 192.1, status 25, visibility hidden
batch 21 at 14.9 s: 200k calls ms 218.8, status 25, visibility hidden
batch 22 at 15.9 s: 200k calls ms 211.3, status 25, visibility hidden
batch 23 at 16.9 s: 200k calls ms 200.0, status 25, visibility hidden
batch 24 at 17.9 s: 200k calls ms 196.8, status 25, visibility hidden
batch 25 at 18.9 s: 200k calls ms 216.4, status 25, visibility hidden
batch 26 at 19.9 s: 200k calls ms 187.5, status 25, visibility hidden
checksum 1638000087
```
</details>

- **Background tabs run slower code.** In these runs, JavaScript that kept computing in a tab that was not in front (behind another tab, in a minimized window or under another window) ran as Maglev code: the probe's 200 000 timed calls took 38.4 to 48.3 ms there against 23.5 to 25.7 ms in the front tab, and the index loop of `loops-bench.mjs` 25.2 to 25.9 ms per round in workload B against 13.8 to 13.9 (§4.2). So judge a benchmark or a long computation only in the tab in front, and do not compare it with a figure taken in a background tab. This was measured for one probe and one timing script, in Chrome 158 on macOS arm64, and the longest wait was 19.9 seconds (5 460 000 calls) ✅[^lab-matrix].
- **One-call benchmarks measure OSR code.** In workload A of §4.2 every function stayed Sparkplug code at entry and its loop ran in OSR code ✅[^lab]. In Electron 43 and Deno 2.9.8 (both V8 15.0) the index loop and `for…of` were TurboFan code at entry after the same 200 calls, and in Chrome 158 (V8 15.8, flagged headless runs and a visible window) the index loop in every run and `for…of` in some ✅[^lab-matrix].
- **The status bits are a test interface.** The table of §5.1 was checked for V8 13.6.233.17 only; use it on another version only after comparing its `runtime.h` ✅[^runtime-h]. The matrix shows why: on V8 14.1 and 15.0 every bit from `MaybeDeopted` up moved down one, so `& 64` there reads `Interpreted`, not `TurboFanned`, and twelve of this doc's scripts print wrong tiers or bit names there as written ✅[^lab-matrix].
- **Natives change what they measure.** `%PrepareFunctionForOptimization` and `%OptimizeFunctionOnNextCall` force a path that real code may not take; §2.2 and §3.3 use natural tier-up for that reason.

### 6.3 Trade-offs of the tiers

Higher tiers compile slower: Maglev about 10 times slower than Sparkplug and 10 times faster than TurboFan, per the post of 2023-12-05 ✅[^maglev]. V8 therefore spends TurboFan time only on code that has used up a large budget (§2.2) ✅[^tiering]. Deoptimization is the price of guessing: each one throws away compiled code, and the function has to earn its budget again (§3.3) ✅[^lab].

### 6.4 Other builds and versions (2026-11-27)

Every embedded script ran again on five more builds, on 2026-11-27, with the flags of its `Run:` line; only the `node` command changed. Later the same day, every script that prints no timing ran on one more build, E9, and again on E2 with the same flags, to settle the differences seen only in E7. Then the scripts of the differences still seen only in E7 ran on E6 and E8, and every script that can run in a web page ran in Google Chrome itself (E10). The baseline (E0) is the build of the rest of this doc.

| Id | Build | What differs from the baseline | Run `<flags> <script>` with |
|---|---|---|---|
| E0 | Node.js 24.22.1, V8 13.6.233.17-node.58, linux arm64 in Docker (`node:24.22.1-alpine`), pointer compression off | (baseline) | `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node` |
| E1 | Node.js 24.22.1, same V8, macOS 26.1 arm64 (the Apple M2 host) | the operating system | `~/.nvm/versions/node/v24.22.1/bin/node` |
| E2 | Node.js 24.22.1, same V8, linux x64 in Docker, emulated on the arm64 machine | the CPU architecture, emulated; TurboFan is off by default there | `docker run --rm --network none --platform linux/amd64 -v "$PWD:/work" -w /work node:24.22.1-alpine-amd64 node` |
| E3 | Node.js 22.23.4, V8 12.4.254.21-node.57, macOS arm64 | an older V8; Maglev is off by default | `~/.nvm/versions/node/v22.23.4/bin/node` |
| E4 | Node.js 25.7.0, V8 14.1.146.11-node.20, macOS arm64 | a newer V8 | `~/.nvm/versions/node/v25.7.0/bin/node` |
| E7 | Electron 43.7.7 run as Node (Node.js 24.21.0 API, V8 15.0.245.31-electron.0), macOS arm64 | a newer V8, pointer compression on (small integers up to 2 ** 30 − 1), the V8 sandbox on; not a Node.js release | `ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code"` |
| E9 | Node.js 24.22.3, V8 13.6.233.17-node.63, linux x64 (emulated), the Node.js project's unofficial build `node-v24.22.3-linux-x64-pointer-compression` | differs from E2 in one way: pointer compression on (small integers up to 2 ** 30 − 1), sandbox off; TurboFan off by default, as on E2 | `docker run --rm --network none --platform linux/amd64 -v <unpacked build>:/opt/node:ro -v "$PWD:/work" -w /work <debian:trixie-slim amd64 image> /opt/node/bin/node` |
| E6 | Deno 2.9.8, V8 15.0.245.2, linux arm64 in Docker (native, not emulated), pointer compression off, V8 sandbox off | V8 15.0 in another embedder; run only for the narrowing table below | `docker run --rm --network none -v "$PWD:/work" -w /work denoland/deno:alpine-2.9.8 deno run -A --no-remote --v8-flags=<flags, comma-separated> <script>`; Deno turns a child's `node` flags into its own, so the scripts that re-run themselves ran unchanged |
| E8 | Electron 38.8.6 run as Node (Node.js 22.22.0 API, V8 14.0.365.10-electron.0), macOS arm64 | V8 14.0, pointer compression on, the V8 sandbox on; run only for the narrowing table below | `ELECTRON_RUN_AS_NODE=1 "/Applications/Postman.app/Contents/MacOS/Postman"` |
| E10 | Google Chrome 158.0.8127.89 (V8 15.8.62.31), macOS 26.1 arm64, headless, a throwaway profile, no extensions | the browser itself: V8 15.8, pointer compression on (`%IsSmi(2 ** 30)` is `false`); no Node.js API, and V8's own output (traces, `%DebugPrint`, `--v8-options`) does not reach the page | the script inlined in a `file://` page whose `console.log` lines are collected into a `<pre>` element; `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=<an empty folder> --enable-precise-memory-info --js-flags="<V8 flags>" --virtual-time-budget=120000 --dump-dom file://<page>`, then read the lines from the dumped page; `.mjs` scripts as a module script. Add the Chrome flag `--disable-renderer-backgrounding` to keep the renderer from running in V8's efficiency mode (§6.2). Modes run besides headless: a visible window with the page in the front tab, the same command without `--headless=new` and `--dump-dom`, with `--remote-debugging-port=<port>`; and, on 2026-11-28, the page in a hidden tab, in a minimized window and in a window covered by another one, set up through the DevTools protocol (§6.2) |

A difference seen only in E7 can come from V8 15.0, from pointer compression or from the sandbox. E9 and E2 settle the pointer-compression part: if E9 shows what E7 showed and E2 shows the baseline, pointer compression is the cause; if E9 shows the baseline, it is not, and the difference belongs to Electron 43 (V8 15.0, the sandbox or the Electron build). A difference seen in both E4 and E7 is not caused by pointer compression, since E4 has it off. Both E2 and E9 start with `--no-turbofan`, so on both, every script that reads tiers or deoptimizations ran as the `--turbofan` copy below, with `--turbofan` also on the command line; `flags.mjs`, `ic.mjs`, `smi.mjs` and `fv.mjs` ran as written. Below, `<E9 node>` stands for the E9 command of the table. The timing scripts did not run on E2, because the emulation changes the times.

**Three kinds of variant runs**, made because build facts hide every other result (they are not scripts of this doc):
- *14.1 masks.* On V8 14.1 and 15.0 the `%GetOptimizationStatus` bits moved (§4.1, §5.1), so the twelve scripts that test `& 64` print wrong tiers there. Each was run again on E4 and E7 as a copy with `& 64` changed to `& 32`, `& 32` to `& 16`, `& 32768` to `& 16384`, `& 128` to `& 64`, and `'AlwaysOptimize',` deleted from `BITS`. On E4 and E7 the timing scripts ran only as these copies; that changes only their tier column.
- *`--turbofan` on E2.* TurboFan is off by default on E2, so every TurboFan script was run again there as a copy with `'--turbofan', ` added at the start of every `spawnSync` argument list, and with `--turbofan` on the command line.
- *Page variants for Chrome (E10).* A page has no `process` and no child processes. A script that re-runs itself with other flags ran once per child instead: its `import { spawnSync } …` line (line 2) became `const process = { argv: [, , <the child's arguments>] };`, and Chrome got the child's flags. In the timing scripts, `const t0 = process.hrtime.bigint();` became `const t0 = performance.now();` and `Number(process.hrtime.bigint() - t0) / 1e6` became `(performance.now() - t0)`. Nothing else changed, except the 14.1 masks, because V8 15.8 has the 14.1 layout (below). Each variant also ran on E1 (Node.js 24.22.1, 13.6 masks) and gave the baseline output, except `tierup.mjs`: Sparkplug at call 29 instead of 28 there (see "Tier-up call numbers").

**Tier-up and inlining defaults, from `--v8-options`**, printed on each build ✅[^lab-matrix]. The first eight rows are the same on all seven builds; the rest are the flags of `flags.mjs` whose default is not. E9 printed exactly what E2 printed:

| Flag | E0, E1 | E2, E9 | E3 (V8 12.4) | E4 (V8 14.1) | E7 (V8 15.0) |
|---|---|---|---|---|---|
| `--invocation-count-for-maglev` | 400 | 400 | 400 | 400 | 400 |
| `--invocation-count-for-turbofan` | 3000 | 3000 | 3000 | 3000 | 3000 |
| `--invocation-count-for-feedback-allocation` | 8 | 8 | 8 | 8 | 8 |
| `--minimum-invocations-after-ic-update` | 500 | 500 | 500 | 500 | 500 |
| `--max-inlined-bytecode-size` | 460 | 460 | 460 | 460 | 460 |
| `--max-inlined-bytecode-size-cumulative` | 920 | 920 | 920 | 920 | 920 |
| `--max-optimized-bytecode-size` | 61440 | 61440 | 61440 | 61440 | 61440 |
| `--max-valid-polymorphic-map-count` | 4 | 4 | 4 | 4 | 4 |
| `--maglev` | on | on | off | on | on |
| `--turbofan` | on | off | on | on | on |
| `--concurrent-sparkplug` | on | on | off | on | on |
| `--osr-from-maglev` | off | off | on | off | off |
| `--invocation-count-for-osr` | 500 | 500 | 800 | 500 | 500 |
| `--polymorphic-inlining` | on | on | on | no such flag | no such flag |
| `--max-inlined-bytecode-size-small` | 27 | 27 | 27 | 27 | 30 |
| `--max-maglev-inlined-bytecode-size` | 460 | 460 | 100 | 100 | 100 |
| `--maglev-escape-analysis` | on | on | off | on | on |

E9 printed 27 for `--max-inlined-bytecode-size-small`, as the baseline, so the 30 of E7 is not caused by pointer compression ✅[^lab-matrix]. Deno 2.9.8 (V8 15.0, E6) also printed 30, and Electron 38.8.6 (V8 14.0, E8) printed 27: the 30 comes with the V8 version, seen on V8 15.0 in two embedders (Deno 2.9.8 and Electron 43.7.7) and not on V8 14.0 or 14.1 ✅[^lab-matrix]. E6 and E8 printed the E7 values of the other rows (`--polymorphic-inlining` absent, Maglev inlining limit 100), and Chrome cannot print its flags into a page.

Also, `--always-turbofan` does not exist on E4 and E7, and `--optimize-maglev-optimizes-to-turbofan` does not exist on E3 ✅[^lab-matrix].

**Matrix.** `same`: every line that does not depend on time or addresses matched the doc (for traces: the same reasons, kinds and offsets; the `opt id` and the code-kind spelling were ignored). `differs`: see the list below. For timing scripts, `same` means the order and roughly the ratios held, over three runs per build, plus a fourth run alone where the result differed.

| Script | Claim it backs | E1 | E2 | E3 | E4 | E7 | E9 | E10 (Chrome 158) |
|---|---|---|---|---|---|---|---|---|
| `flags.mjs` | flag defaults (§2.2, §5.2) | same | differs | differs | differs | differs | differs | cannot run: reads `--v8-options` output |
| `toobig.mjs` | no TurboFan over 61 440 bytes (§2.2) | same | differs | same | differs | differs | same | differs (page variant) |
| `tierup.mjs` | calls at each tier-up (§2.2) | same | differs | differs | differs | differs | differs | differs (page variant) |
| `fv.mjs` | calls until a feedback vector (§2.3) | same | same | same | same | cannot run | same | cannot run: reads `%DebugPrint` output |
| `feedback.mjs` | inlining needs a feedback vector (§2.3) | same | differs | same | same | same | same | cannot run: reads a V8 trace |
| `ic.mjs` | IC states `0 1 P N` (§3.1) | same | same | same | same | same | same | cannot run: reads a `--log-ic` file |
| `deoptframe.mjs` | a deopt rebuilds an interpreter frame (§3.2) | same | differs | same | same | same | differs | cannot run: reads a V8 trace |
| `deopt.mjs` | seven deopt reasons (§3.2) | same | differs | differs | same | differs | differs | cannot run: reads a V8 trace |
| `smi.mjs` | small-integer range (§3.2) | same | same | same | same | differs | differs | differs |
| `deoptloop.mjs` | one deopt per new shape, up to 5 (§3.3) | same | differs | differs | differs | differs | same | cannot run: reads a V8 trace |
| `deoptloop-var.mjs` | the same for 24 combinations (§3.3) | same | same | differs | same | same | same | cannot run: reads a V8 trace |
| `osr.mjs` | Maglev OSR of a loop (§3.4) | same | differs | differs | differs | differs | same | cannot run: reads a V8 trace |
| `inline.mjs` | what TurboFan inlines (§3.5) | same | differs | same | differs | differs | same | cannot run: reads a V8 trace |
| `inline-var.mjs` | limit of 460 bytes of bytecode (§3.5) | same | differs | differs | differs | differs | same | cannot run: reads a V8 trace |
| `escape.mjs` | allocations removed (§3.6) | same | differs | same | differs | differs | same | cannot run: reads a V8 trace |
| `calls.mjs` | call shapes inlined (§3.7) | same | differs | same | differs | differs | same | cannot run: reads a V8 trace |
| `callforms.js` | `call`, `apply`, spread (§3.7) | same | differs | same | differs | differs | same | cannot run: reads a V8 trace |
| `self.mjs` | old "killers" get TurboFan code, forced (§3.8) | same | differs | same | differs | differs | same | differs (with the 14.1 masks: same) |
| `natural.mjs` | the same, natural tier-up (§3.8) | same | differs | differs | differs | differs | same | differs (page variant) |
| `builtins-inline.mjs` | array built-in callbacks (§3.9) | same | differs | same | differs | differs | same | cannot run: reads a V8 trace |
| `tiers.mjs` | status bits per tier (§4.1) | same | differs | differs | differs | differs | same | differs (with the 14.1 names: same states) |
| `bits-extra.mjs` | the other status bits (§4.1) | same | differs | differs | differs | differs | differs | differs (page variant) |
| `loops-bench.mjs` | loop forms timed (§4.2) | same | not run | same | differs | differs | not run | differs (page variant) |
| `loops-var.mjs` | other bodies and sizes timed (§4.2) | same | not run | differs | differs | differs | not run | differs (page variant) |
| `warmup.mjs` | when the callbacks settle (§4.2) | same | not run | differs | differs | differs | not run | differs (page variant) |

Most `differs` on E2, E4 and E7 come from the two build facts above. With TurboFan on (the `--turbofan` copies), every E2 script gave the baseline output except `deoptframe.mjs` (frame sizes) and one line of `bits-extra.mjs`. With the 14.1 masks, `toobig.mjs`, `escape.mjs`, `calls.mjs` and `self.mjs` gave the baseline output on E4 and E7, and `callforms.js` and `builtins-inline.mjs` on E4 ✅[^lab-matrix]. The E9 column is with `--turbofan`: E9 differs from the baseline in the same lines as E2 with `--turbofan` (`flags.mjs` prints `--no-turbofan`, the last line of `tierup.mjs`, the frame sizes of `deoptframe.mjs`, one line of `bits-extra.mjs`), plus the small-integer lines of `smi.mjs` and `deopt.mjs`. The re-run of E2 gave the same output as E9 for every other script ✅[^lab-matrix].

**Narrowing runs: E6 and E8.** The differences still seen only in E7 after E9, run on Deno 2.9.8 (E6: V8 15.0, no sandbox, no pointer compression, not Electron) and Electron 38.8.6 (E8: V8 14.0, sandbox and pointer compression on), with the 14.1 masks on both, three runs per timing script (E6 and E8 `loops-bench.mjs`: six each, three of them with the load lower) ✅[^lab-matrix]:

| Difference in E7 (Electron 43.7.7) | E6 (Deno 2.9.8) | E8 (Electron 38.8.6) | What it shows |
|---|---|---|---|
| `fv.mjs` finds no feedback vector (`%DebugPrint` prints one line) | as E7 | as E7 | seen on three builds, V8 14.0 and 15.0 (Electron 38.8.6, Deno 2.9.8, Electron 43.7.7), not on Node.js 25.7.0 (V8 14.1); no cause named |
| `callforms.js`: spread and `apply` of an array in a variable inlined | as E7 | baseline | comes with the V8 version: seen on V8 15.0 in two embedders, not on V8 14.0 or 14.1 |
| `builtins-inline.mjs`: the `sort` comparator inlined | as E7 | baseline | the same |
| `--max-inlined-bytecode-size-small` is 30 | 30 | 27 | the same |
| `tierup.mjs`: Sparkplug at call 21 | call 2 | call 10 | none of these: every build its own number; with `--no-baseline-batch-compilation` all gave call 2 (see "Tier-up call numbers") |
| `inline.mjs`: the two `Considering` lines of `twoClassesOneMethodName` printed twice | baseline | baseline | specific to Electron 43.7.7 among the builds run; cause not isolated |
| `loops-bench.mjs` A: index loop and `for…of` TurboFan at entry, `for…of` about as fast as the index loop | as E7 (TurboFan at entry): `for…of` 0.74 to 1.69 (0.74 to 0.77 in the three quieter runs) | baseline: Sparkplug, `for…of` 6.63 to 8.73 | comes with the V8 version: seen on V8 15.0 in two embedders |
| `loops-bench.mjs` B: `reduce` about 1.0 times the index loop | baseline: 0.75 to 1.04 (0.83 to 0.85 in the three quieter runs) | as E7: 0.91 to 1.02 (0.98 to 1.01 in the quieter runs) | not V8 15.0 alone: common to the two Electron builds (sandbox on, pointer compression on, Electron's build flags); E9 ruled out pointer compression only for non-timing results, so the cause is not isolated |

**What Chrome 158 does differently from the baseline** (E10, Chrome 158.0.8127.89, V8 15.8.62.31, headless) ✅[^lab-matrix]:
- the status bits have the V8 14.1 layout (TurboFan code `41`), the same values as E4 and E7 in `tiers.mjs` and `bits-extra.mjs` (`--always-turbofan` is ignored without a message there);
- pointer compression: `%IsSmi(2 ** 30)` is `false`, as on E7 and E9;
- V8's efficiency mode was on in some default headless runs: in natural tier-up, TurboFan often did not come at all (12, 10 and 5 of the 18 `natural.mjs` subjects stayed Maglev code after 40 000 calls in three runs, a different set each time; `tierup.mjs` reached no TurboFan in 20 000 calls in two of three runs). With the Chrome flag `--disable-renderer-backgrounding`, or with `--no-efficiency-mode`, TurboFan came in all three runs of each: the call numbers were those of E7 or within 43 calls of them (`tierup.mjs` TurboFan at 3091, subjects at 1 485 to 25 179, the same in all six runs). `document.visibilityState` was `visible` in every run. In a visible window the probe of §6.2 reached TurboFan in the front tab (3 of 3 runs, then 5 of 5) and never in a hidden tab, a minimized window or a covered window (0 of 15 runs), where `--disable-renderer-backgrounding` or `--no-efficiency-mode` brought it back (§6.2);
- with `--single-threaded`, `tierup.mjs` showed no Sparkplug step before Maglev (with `--no-baseline-batch-compilation`, Sparkplug at call 2);
- forced TurboFan worked up to 6 000 statements in `toobig.mjs` (baseline: not at 3 400);
- loop timings (`loops-bench.mjs`, measured here, Chrome 158, headless with `--disable-renderer-backgrounding`, three runs; a visible window and `--no-efficiency-mode` gave the same B ratios, §4.2): in B, `for…of` 0.96 to 0.97, `forEach` 2.64 to 2.67 and `reduce` 0.99 to 1.00 times the index loop (baseline 1.15 to 1.22, 1.84 to 1.94, 0.81 to 0.85); in A the index loop was TurboFan code at entry. With the default headless flags, one of three runs left every function in Maglev code (B: `reduce` 4.02 times the index loop); `warmup.mjs` settled from round 10, as on E4 and E7 (with the default flags, one of three runs never settled) (§4.2).

Could not be checked in Chrome: 15 of the 25 scripts, because they read what V8 prints itself, which a page does not get: 12 read a V8 trace (`--trace-…`), `flags.mjs` reads `--v8-options`, `fv.mjs` reads `%DebugPrint`, and `ic.mjs` reads a `--log-ic` file. A status probe (not a doc script: the seven cases of `deopt.mjs`, with `%GetOptimizationStatus` read before and after the triggering call instead of the trace) showed each case leaving TurboFan code in Chrome, as on Node.js 24.22.1 and Electron 43; the reasons cannot be read there.

**What differs**
- **TurboFan is off by default on the emulated x64 build (E2).** Baseline: TurboFan on, and every forced or natural optimization above ends in TurboFan code. E2: `--v8-options` prints `--no-turbofan`, `%OptimizeFunctionOnNextCall` leaves the function interpreted (`tiers.mjs` stops at Maglev, `self.mjs` prints `not optimized`), no TurboFan deopt or inlining is traced, and `bits-extra.mjs` loops forever in its wait for bit 6 (stopped after two minutes). The emulated CPU reports itself as `VirtualApple`; why V8 turns TurboFan off there was not isolated; E9, emulated the same way with pointer compression on, also starts with `--no-turbofan`. This was seen on an emulated x64 container only; native x64 hardware was not run, so it is unknown whether a native x64 build also starts with TurboFan off. With `--turbofan`, the results match the baseline, except below ✅[^lab-matrix].

<details><summary><code>self.mjs</code> and <code>tiers.mjs</code> on E2, as written</summary>

`docker run --rm --network none --platform linux/amd64 -v "$PWD:/work" -w /work node:24.22.1-alpine-amd64 node --allow-natives-syntax self.mjs`

```text
tryCatch        not optimized
tryCatchThrows  not optimized
tryFinally      not optimized
generator       not optimized
asyncFn         not optimized
argumentsObj    not optimized
forOf           not optimized
forIn           not optimized
withEval        not optimized
withStatement   not optimized
```

`docker run --rm --network none --platform linux/amd64 -v "$PWD:/work" -w /work node:24.22.1-alpine-amd64 node --allow-natives-syntax tiers.mjs`

```text
never called                       262145 IsFunction|IsLazy
called once (Ignition)                129 IsFunction|Interpreted
after %CompileBaseline              32769 IsFunction|Baseline
marked for Maglev, not yet called  4227073 IsFunction|Baseline|MarkedForMaglevOptimization
after Maglev                           49 IsFunction|Optimized|Maglevved
marked for TurboFan, not yet called     49 IsFunction|Optimized|Maglevved
after TurboFan                         49 IsFunction|Optimized|Maglevved
after add("x", "y")                     1 IsFunction
one more call                       32769 IsFunction|Baseline
inside selfCheck (on the stack)     67713 IsFunction|Interpreted|IsExecuting|TopmostFrameIsInterpreted
after %NeverOptimizeFunction          129 IsFunction|Interpreted
```
</details>

- **x64 frame sizes (E2 with `--turbofan`).** Baseline (arm64, all of E0, E1, E3, E4, E7): `translating interpreted frame getX => bytecode_offset=0, variable_frame_size=16, frame_size=96`. E2: the same frame at the same offset, with `variable_frame_size=8, frame_size=88`. In the same run, the `bits-extra.mjs` line for a function running in Maglev code showed `TurboFanned` with `TopmostFrameIsMaglev` ✅[^lab-matrix].

<details><summary><code>deoptframe.mjs</code> on E2 with <code>--turbofan</code></summary>

`docker run --rm --network none --platform linux/amd64 -v "$PWD:/work" -w /work node:24.22.1-alpine-amd64 node --allow-natives-syntax --turbofan deoptframe.tf.mjs`

```text
[bailout (kind: deopt-eager, reason: wrong map): begin. deoptimizing <JSFunction getX>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 0, deopt exit 1]
reading input frame getX => bytecode_offset=0, args=2, height=0, retval=0(#0)
translating interpreted frame getX => bytecode_offset=0, variable_frame_size=8, frame_size=88
[bailout end. took … ms]
```
</details>

- **Maglev is off on V8 12.4 (E3).** Baseline: Ignition, Sparkplug, Maglev, TurboFan. E3: `tiers.mjs` prints `Maglev is not enabled.`; with `--single-threaded`, `sum` went from Ignition straight to TurboFan at call 403 (Sparkplug at call 1 605 only when TurboFan was off too); OSR compiled TurboFan code, not Maglev code; `deoptloop.mjs` recompiled straight to TurboFan after each deopt (the deopts were the same); natural tier-up came earlier (subjects between call 290 and call 4 458) ✅[^lab-matrix].

<details><summary><code>tierup.mjs</code> and <code>osr.mjs</code> on E3</summary>

`~/.nvm/versions/node/v22.23.4/bin/node --allow-natives-syntax tierup.mjs`

```text
--single-threaded:             call 1: Ignition -> call 403: TurboFan
--single-threaded --no-maglev: call 1: Ignition -> call 403: TurboFan
--single-threaded --no-maglev --no-turbofan: call 1: Ignition -> call 1605: Sparkplug
default flags (order only):    Ignition -> Sparkplug -> TurboFan
```

`~/.nvm/versions/node/v22.23.4/bin/node osr.mjs`

```text
--- n = 1000
result 496491
--- n = 5000000
[marking <JSFunction longLoop> for optimization to TURBOFAN, ConcurrencyMode::kConcurrent, reason: hot and stable]
[OSR - setting osr urgency. function: longLoop]
[OSR - compilation started. function: longLoop, osr offset: 35, mode: ConcurrencyMode::kSynchronous]
[compiling method <JSFunction longLoop> (target TURBOFAN) OSR, mode: ConcurrencyMode::kSynchronous]
[completed compiling <JSFunction longLoop> (target TURBOFAN) OSR
[OSR - available (compilation completed or cache hit). function: longLoop, osr offset: 35, mode: ConcurrencyMode::kSynchronous]
[OSR - entry. function: longLoop, osr offset: 35]
result 840
```
</details>

- **`deoptloop-var.mjs` on V8 12.4 (E3).** Baseline: `0 1 1 1 1 0 0 0` for all 24 combinations. E3: the twelve runs with 20 000 calls per phase are the same; the twelve with 3 000 calls per phase print `0 0 1 1 1 0 0 0`: no deopt in phase 2, and still none after phase 5 ✅[^lab-matrix].

<details><summary><code>deoptloop-var.mjs</code> on E3 (the 3 000-call lines)</summary>

`~/.nvm/versions/node/v22.23.4/bin/node deoptloop-var.mjs`

```text
load       firstKey  3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
load       order     3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
load       classes   3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
store      firstKey  3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
store      order     3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
store      classes   3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
twoLoads   firstKey  3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
twoLoads   order     3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
twoLoads   classes   3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
methodCall firstKey  3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
methodCall order     3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
methodCall classes   3000 calls/phase  deopts in phases 1..8: 0 0 1 1 1 0 0 0
```
</details>

- **Deopt reasons on V8 12.4 (E3).** Baseline: the `lazy` case is marked with `reason: dependent field type constness changed`, and `noFeedback` deopts at `27:49`. E3: `reason: code dependencies`, and `27:30` (the start of the `if`); the other five reasons, kinds and bytecode offsets are the same. V8 12.4 also names the code `TURBOFAN`, not `TURBOFAN_JS` ✅[^lab-matrix].

<details><summary><code>deopt.mjs</code> on E3 (the two cases that differ)</summary>

`~/.nvm/versions/node/v22.23.4/bin/node --allow-natives-syntax deopt.mjs`

```text
--- noFeedback
[bailout (kind: deopt-eager, reason: Insufficient type feedback for generic named access): begin. deoptimizing <JSFunction pick>, <Code TURBOFAN>, opt id 0, bytecode offset 4, deopt exit 0]
;;; deoptimize at <deopt.mjs:27:30>
--- lazy
[marking dependent code <Code TURBOFAN> (<SharedFunctionInfo callM>) (opt id 0) for deoptimization, reason: code dependencies]
[bailout (kind: deopt-lazy, reason: (unknown)): begin. deoptimizing <JSFunction callM>, <Code TURBOFAN>, opt id 0, bytecode offset 10, deopt exit 7]
```
</details>

- **The status bits moved on V8 14.1 and 15.0 (E4, E7).** Baseline: TurboFan code is `81` = bits 0, 4, 6. E4 and E7: `41`. Found by experiment: `--always-turbofan` is a bad option, `--deopt-every-n-times` sets bit 2, and decoding with the 13.6 names minus `AlwaysOptimize` gives the same states as on 13.6 for every line of `tiers.mjs` and `bits-extra.mjs` (§4.1, §5.1). As written, the twelve scripts that test `& 64` print wrong tiers there ✅[^lab-matrix]. Chrome 158 (V8 15.8), E6 (V8 15.0) and E8 (V8 14.0) printed exactly the E4 lines of `tiers.mjs` below, and Chrome the E7 lines of `bits-extra.mjs` with the 14.1 names (page variant), except that `--always-turbofan` printed the plain status instead of "bad option" ✅[^lab-matrix].

<details><summary><code>tiers.mjs</code> on E4, as written and with the 14.1 names (E7 printed the same)</summary>

`~/.nvm/versions/node/v25.7.0/bin/node --allow-natives-syntax tiers.mjs`

```text
never called                       131073 IsFunction|TopmostFrameIsBaseline
called once (Ignition)                 65 IsFunction|TurboFanned
after %CompileBaseline              16385 IsFunction|MarkedForDeoptimization
marked for Maglev, not yet called  2113537 IsFunction|MarkedForDeoptimization|OptimizeMaglevOptimizesToTurbofan
after Maglev                           25 IsFunction|MaybeDeopted|Optimized
marked for TurboFan, not yet called    153 IsFunction|MaybeDeopted|Optimized|Interpreted
after TurboFan                         41 IsFunction|MaybeDeopted|Maglevved
after add("x", "y")                     1 IsFunction
one more call                       16385 IsFunction|MarkedForDeoptimization
inside selfCheck (on the stack)     33857 IsFunction|TurboFanned|OptimizingConcurrently|Baseline
after %NeverOptimizeFunction           65 IsFunction|TurboFanned
```

`~/.nvm/versions/node/v25.7.0/bin/node --allow-natives-syntax tiers.b14.mjs`

```text
never called                       131073 IsFunction|IsLazy
called once (Ignition)                 65 IsFunction|Interpreted
after %CompileBaseline              16385 IsFunction|Baseline
marked for Maglev, not yet called  2113537 IsFunction|Baseline|MarkedForMaglevOptimization
after Maglev                           25 IsFunction|Optimized|Maglevved
marked for TurboFan, not yet called    153 IsFunction|Optimized|Maglevved|MarkedForOptimization
after TurboFan                         41 IsFunction|Optimized|TurboFanned
after add("x", "y")                     1 IsFunction
one more call                       16385 IsFunction|Baseline
inside selfCheck (on the stack)     33857 IsFunction|Interpreted|IsExecuting|TopmostFrameIsInterpreted
after %NeverOptimizeFunction           65 IsFunction|Interpreted
```
</details>

- **Tier-up call numbers (E4, E7, with the 14.1 masks).** These are for the function `sum` of `tierup.mjs` (an 8-step loop per call); another function reaches each tier at other call counts (§2.2). Baseline: `--single-threaded` gives Sparkplug at call 28, Maglev at 70, TurboFan at 1957. E4: TurboFan at 3090. E7: Sparkplug at 21, TurboFan at 3091. In `natural.mjs` every subject still reached TurboFan code, between call 2 320 and call 25 222 (baseline: 1 465 to 15 991) ✅[^lab-matrix]. E9 and E2, with `--turbofan`: Sparkplug at call 28, Maglev at 70, TurboFan at 1957, as in the baseline, so the call 21 of E7 is not caused by pointer compression ✅[^lab-matrix]. E6 (Deno 2.9.8, V8 15.0) gave Sparkplug at call 2, E8 (Electron 38.8.6, V8 14.0) at call 10, and the page variant on E1 at call 29. With `--no-baseline-batch-compilation`, E1, E6, E7, E8 and E10 all gave call 2, so the Sparkplug call depends on when the batch of functions waiting for Sparkplug is compiled, and code elsewhere in the process moves it (an inference from these runs) ✅[^lab-matrix]. Chrome 158 (E10, page variant, three runs per mode): no Sparkplug step before Maglev at call 70; with the default headless flags, no TurboFan within 20 000 calls in two of three runs (TurboFan at call 3091 in the third); with `--disable-renderer-backgrounding` or `--no-efficiency-mode`, TurboFan at call 3091 in every run, as on E7 ✅[^lab-matrix].

<details><summary><code>tierup.mjs</code> with the 14.1 masks on E4 and E7, and as written on E9</summary>

`~/.nvm/versions/node/v25.7.0/bin/node --allow-natives-syntax tierup.b14.mjs`

```text
--single-threaded:             call 1: Ignition -> call 28: Sparkplug -> call 70: Maglev -> call 3090: TurboFan
--single-threaded --no-maglev: call 1: Ignition -> call 28: Sparkplug -> call 403: TurboFan
--single-threaded --no-maglev --no-turbofan: call 1: Ignition -> call 28: Sparkplug
default flags (order only):    Ignition -> Sparkplug -> Maglev -> TurboFan
```

`ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax tierup.b14.mjs`

```text
--single-threaded:             call 1: Ignition -> call 21: Sparkplug -> call 70: Maglev -> call 3091: TurboFan
--single-threaded --no-maglev: call 1: Ignition -> call 21: Sparkplug -> call 403: TurboFan
--single-threaded --no-maglev --no-turbofan: call 1: Ignition -> call 21: Sparkplug
default flags (order only):    Ignition -> Sparkplug -> Maglev -> TurboFan
```

E9, the `--turbofan` copy (E2 printed the same): `<E9 node> --allow-natives-syntax --turbofan tierup.tf.mjs`, first line:

```text
--single-threaded:             call 1: Ignition -> call 28: Sparkplug -> call 70: Maglev -> call 1957: TurboFan
```

E6 and E8, `tierup.b14.mjs`, first line: `call 1: Ignition -> call 2: Sparkplug -> call 69: Maglev -> call 3090: TurboFan` (E6) and `call 1: Ignition -> call 10: Sparkplug -> call 70: Maglev -> call 3090: TurboFan` (E8).

E10: the page variant runs the child part once per flag set. Changed line: line 2, `import { spawnSync } from 'node:child_process';` → `const process = { argv: [, , "child", "calls"] };` (`"order"` for the last line), with the 14.1 masks; Chrome got the child's flags in `--js-flags`. With the default flags, then with `--no-efficiency-mode` added:

```text
--single-threaded:             call 1: Ignition -> call 70: Maglev
--single-threaded --no-maglev: call 1: Ignition -> call 403: TurboFan
--single-threaded --no-maglev --no-turbofan: call 1: Ignition -> call 1605: Sparkplug
default flags (order only):    Ignition -> Maglev -> TurboFan

--single-threaded:             call 1: Ignition -> call 70: Maglev -> call 3091: TurboFan
```
</details>

- **Efficiency mode in headless Chrome (E10).** Baseline: every `natural.mjs` subject reached TurboFan code within 40 000 calls. Chrome 158 with its default headless flags: 12, 10 and 5 of the 18 stayed Maglev code after 40 000 calls in three runs, a different set each time; with `--disable-renderer-backgrounding` (three runs) or `--no-efficiency-mode` (three runs), all 18 reached TurboFan in every run, at the same calls each time, within 43 calls of the E7 calls (1 485 to 25 179). With `--efficiency-mode`, Node.js 24.22.1 (E1) behaved like the default headless page: the four subjects tried stayed Maglev code and `tierup.mjs` reached no TurboFan. V8's help text describes the flag as one that "Forces efficiency mode on or off, disregarding any dynamic signals". That the flag `--disable-renderer-backgrounding` removes the effect shows that headless Chrome treats the renderer as a background process at some point (an inference). In a visible window (2026-11-28, three runs each): all 18 `natural.mjs` subjects reached TurboFan at the same calls as in the `--no-efficiency-mode` headless run (1 485 to 25 179); `tierup.mjs` reached TurboFan at call 3091 with `--single-threaded`, and with the default flags it showed no TurboFan within 20 000 calls, as in the `--no-efficiency-mode` headless run; `warmup.mjs` settled from round 10 (§4.2). The probe of §6.2 reached TurboFan in the front tab and never in a hidden tab, a minimized window or a covered window, and `loops-bench.mjs` stayed Maglev code in a hidden tab (§4.2) ✅[^lab-matrix].

  What the sources say (read 2026-11-28). In V8 15.8.62.31, `EfficiencyModeEnabled()` returns the value of `--efficiency-mode` when the flag is set, and otherwise `priority_ != v8::Isolate::Priority::kUserBlocking` ✅[^v8-isolate-158]. In efficiency mode, the tiering manager does not optimize with TurboFan while a function's invocation count is below `--invocation-count-for-turbofan` times `--efficiency-mode-delay-turbofan-multiply`, and it compiles the other tiers synchronously ✅[^v8-tiering-158]; the defaults are 3 for the multiplier and `false` for `--efficiency-mode-disable-turbofan`, the flag that would defer TurboFan for the whole time ✅[^v8-flags-158]. In Chromium's renderer, `OnRendererHidden` sets the isolates' priority to `kBestEffort` and `OnRendererVisible` to `kUserBlocking`, both only while the feature `kIsolatesPriorityUsePROCESSPriority` is not enabled (when it is, the priority follows the process priority; whether it is enabled in Chrome 158 was not examined) ✅[^cr-render-thread], and with `--disable-renderer-backgrounding` "renderers are never told that they are backgrounded or hidden" ✅[^cr-switches]. The Chromium files were read on the `main` branch, not on the Chrome 158 branch. That a hidden tab's isolate gets this priority, so that this code path is what the probe measured, is an inference: it fits the effect of both flags in a hidden tab, but no run read the priority. It does not explain the length: the probe stayed Maglev code for 5 460 000 calls in 20 seconds, while the source describes a delay to 3 times the TurboFan invocation count (3 000 by default, §2.2, where V8's "invocation count" is shown not to be a plain call count); why was not examined.

<details><summary><code>natural.mjs</code> in Chrome 158 (page variant)</summary>

Changed line: line 2, `import { spawnSync } from 'node:child_process';` → `const process = { argv: [, , "<subject>"] };`, one page per subject, with the 14.1 masks; flags `--js-flags="--allow-natives-syntax --single-threaded --no-turbo-inlining --no-maglev-inlining"`. On E1 the variant printed the baseline output exactly. First of three runs with the default headless flags (12 of 18 stayed Maglev; the other two runs: 10 and 5):

```text
controlPlain                first TurboFan at call 17866; status after 40000 calls: TurboFan
controlLoop                 first TurboFan at call 1485; status after 40000 calls: TurboFan
tryCatch                    first TurboFan at call never; status after 40000 calls: Maglev
tryCatchLoop                first TurboFan at call never; status after 40000 calls: Maglev
tryCatchThrows              first TurboFan at call never; status after 40000 calls: Maglev
tryFinally                  first TurboFan at call 16775; status after 40000 calls: TurboFan
argumentsRead               first TurboFan at call never; status after 40000 calls: Maglev
argumentsEscapes            first TurboFan at call never; status after 40000 calls: Maglev
argumentsSloppyAlias        first TurboFan at call never; status after 40000 calls: Maglev
argumentsStrictSpreadApply  first TurboFan at call never; status after 40000 calls: Maglev
generator                   first TurboFan at call never; status after 40000 calls: Maglev
generatorLoop               first TurboFan at call 5030; status after 40000 calls: TurboFan
forIn                       first TurboFan at call never; status after 40000 calls: Maglev
forInMany                   first TurboFan at call never; status after 40000 calls: Maglev
evalSimple                  first TurboFan at call 16702; status after 40000 calls: TurboFan
evalLocalVar                first TurboFan at call never; status after 40000 calls: Maglev
withSimple                  first TurboFan at call 17554; status after 40000 calls: TurboFan
withLocal                   first TurboFan at call never; status after 40000 calls: Maglev
```

With `--disable-renderer-backgrounding` (Chrome flag), and also with `--no-efficiency-mode` added, every line was `TurboFan` in all three runs of each, at 17 866, 1 485, 25 179, 2 321, 16 928, 16 775, 6 523, 17 355, 17 153, 17 179, 7 503, 5 030, 8 681, 3 556, 16 702, 16 670, 17 554 and 17 027 (in the order above).
</details>

- **Large functions in Chrome (E10).** Baseline: forced optimization gave no TurboFan code for 3 400 statements (63 838 bytes of bytecode). Chrome 158 (page variant of `toobig.mjs`, line 2 → `const process = { argv: [, , "<statements>"] };`, the 14.1 masks): `TurboFan=true` for 3 100 to 3 400 statements and up to 6 000, `TurboFan=false` from 6 400. The page cannot print the bytecode length or the flag value. On E1 the variant printed the baseline `TurboFan=` values ✅[^lab-matrix].

- **Recompiles after a deopt (E4, E7).** Baseline: after each of the deopts in phases 2 to 5, Maglev and then TurboFan compiled `getX` again. E4 and E7: the same deopts, but each phase from 1 to 5 ended with Maglev code; TurboFan code came only in phase 6 ✅[^lab-matrix].

<details><summary><code>deoptloop.mjs</code> on E4 (E7 printed the same)</summary>

`~/.nvm/versions/node/v25.7.0/bin/node deoptloop.mjs`

```text
phase 1: 1 shape(s)
  target MAGLEV
phase 2: 2 shape(s)
  reason: wrong map
  target MAGLEV
phase 3: 3 shape(s)
  reason: wrong map
  target MAGLEV
phase 4: 4 shape(s)
  reason: wrong map
  target MAGLEV
phase 5: 5 shape(s)
  reason: wrong map
  target MAGLEV
phase 6: 6 shape(s)
  target TURBOFAN_JS
phase 7: 7 shape(s)
phase 8: 8 shape(s)
```
</details>

- **OSR urgency (E4, E7).** Baseline: `[OSR - setting osr urgency. function: longLoop]   (x284)` after the Maglev OSR entry. E4 and E7: the same trace, with `(x177)` ✅[^lab-matrix].
- **Inlining trace text (E4, E7).** Baseline: `Cannot consider … for inlining (reason: 5)`. E4 and E7: `(reason: exceeds bytecode limit)`, so `inline-var.mjs`, which looks for `reason: <number>`, prints `not considered`; the verdicts are the same. The bytecode lengths are the same on E3 and E4 too, read directly from `--print-bytecode` (6, 13, 9, 306, 446, 456, 466, 706); the script's length column printed `10` there because the block before `run` was another function ✅[^lab-matrix]. In E7, `twoClassesOneMethodName` printed its two `Considering` lines twice, in all three runs. E9, E6 (Deno 2.9.8, V8 15.0) and E8 (Electron 38.8.6) printed them once, as the baseline: among the builds run, this is specific to Electron 43.7.7; cause not isolated (what remains: that Electron build of V8 15.0 with its sandbox and flags) ✅[^lab-matrix].

<details><summary><code>inline-var.mjs</code> on E7</summary>

`ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax inline-var.mjs`

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
arith46            callee bytecode length:   466  ->  not considered
arith48            callee bytecode length:   486  ->  not considered
arith50            callee bytecode length:   506  ->  not considered
arith70            callee bytecode length:   706  ->  not considered
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

- **`fv.mjs` cannot run in E7.** Its `%DebugPrint` prints only one line (`<JSFunction f (sfi = …)>`), with no feedback-vector field, so the script finds none at any call count ✅[^lab-matrix]. On E9 and on E2 the script ran and printed the baseline output, so pointer compression is not the cause ✅[^lab-matrix]. On E6 (Deno 2.9.8, V8 15.0) and E8 (Electron 38.8.6, V8 14.0) `%DebugPrint` also printed one line, so the script found no vector at any call count: seen on three builds, V8 14.0 and 15.0 (Electron 38.8.6, Deno 2.9.8 and Electron 43.7.7), and not on Node.js 25.7.0 (V8 14.1); no cause is named ✅[^lab-matrix]. In Chrome it cannot run: `%DebugPrint` output does not reach the page.

<details><summary><code>fv.mjs</code> on E9 (E2 printed the same)</summary>

`<E9 node> --allow-natives-syntax fv.mjs`

```text
(default, flag = 8)                            calls until a feedback vector exists -> short: 9, long: 9, loop8: 2
--invocation-count-for-feedback-allocation=2   calls until a feedback vector exists -> short: 3, long: 3, loop8: 1
--invocation-count-for-feedback-allocation=40  calls until a feedback vector exists -> short: 41, long: 41, loop8: 6
```
</details>

- **Small integers and the `smiOverflow` case (E7, E9): pointer compression.** Baseline: `%IsSmi(2 ** 31 - 1)` is `true`, and `inc(2 ** 31 - 1)` deopts with `overflow`. E7: `%IsSmi(2 ** 30)` is `false`; `inc(2 ** 31 - 1)` deopts with `not a Smi` (deopt exit 0), because the argument is a heap number. Re-checked with the largest small integer of E7: `inc(2 ** 30 - 1)` did not deopt; the result, 2 ** 30, is a heap number and `inc` stayed TurboFan code. On E4, `inc(2 ** 31 - 1)` gave `overflow` as in the baseline ✅[^lab-matrix]. E9 printed what E7 printed in all three checks (small-integer range, `not a Smi`, no deopt and a heap-number result for 2 ** 30 − 1), and E2 printed the baseline in all three: pointer compression is the cause, isolated on V8 13.6, the same Node.js line, sandbox off ✅[^lab-matrix]. Chrome 158 (E10) printed the E7 line of `smi.mjs`: `2**30-1 Smi: true 2**30 Smi: false 2**31-1 Smi: false 2**31 Smi: false` ✅[^lab-matrix].

<details><summary><code>smi.mjs</code> and <code>deopt.mjs</code> on E7, E9 and E2, and the 2 ** 30 − 1 check</summary>

`ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax smi.mjs`

```text
2**30-1 Smi: true 2**30 Smi: false 2**31-1 Smi: false 2**31 Smi: false
```

`ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax deopt.mjs`

```text
--- smiOverflow
[bailout (kind: deopt-eager, reason: not a Smi): begin. deoptimizing <JSFunction inc>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 2, deopt exit 0]
;;; deoptimize at <deopt.mjs:12:32>
```

The 2 ** 30 − 1 check, `smi30.js` (`deopt.mjs`'s `inc`, called once more with 2 ** 30 − 1):

```js
function inc(a) { return a + 1; }
%PrepareFunctionForOptimization(inc);
inc(1); inc(2);
%OptimizeFunctionOnNextCall(inc); inc(3);
const r = inc(2 ** 30 - 1);
console.log('result', r, 'IsSmi(result)', %IsSmi(r), 'status', %GetOptimizationStatus(inc));
```

`ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax --trace-deopt smi30.js` (no deopt line is printed):

```text
result 1073741824 IsSmi(result) false status 41
```

E9 (the `deopt.mjs` and `smi30.js` runs add `--turbofan`, on E2 too):

`<E9 node> --allow-natives-syntax smi.mjs`

```text
2**30-1 Smi: true 2**30 Smi: false 2**31-1 Smi: false 2**31 Smi: false
```

`<E9 node> --allow-natives-syntax --turbofan deopt.tf.mjs`

```text
--- smiOverflow
[bailout (kind: deopt-eager, reason: not a Smi): begin. deoptimizing <JSFunction inc>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 2, deopt exit 0]
;;; deoptimize at <deopt.tf.mjs:12:32>
```

`<E9 node> --allow-natives-syntax --turbofan smi30.js` (no deopt line; 81 is TurboFan code on V8 13.6):

```text
result 1073741824 IsSmi(result) false status 81
```

E2, the same three commands with the E2 command:

```text
2**30-1 Smi: true 2**30 Smi: true 2**31-1 Smi: true 2**31 Smi: false
--- smiOverflow
[bailout (kind: deopt-eager, reason: overflow): begin. deoptimizing <JSFunction inc>, <Code TURBOFAN_JS>, opt id 0, bytecode offset 2, deopt exit 1]
;;; deoptimize at <deopt.tf.mjs:12:32>
result 1073741824 IsSmi(result) true status 81
```
</details>

- **More inlining in E7 (not pointer compression).** Baseline, and E3 and E4: spread and `apply` of an array in a variable were not inlined, nor was the `sort` comparator. E7 (with the 14.1 masks): `spreadVariable` and `applyVariable` inlined `sum3`, and the `sort` comparator was inlined ✅[^lab-matrix]. E9 and E2 (with `--turbofan`, V8 13.6 masks) inlined none of the three, as in the baseline, so pointer compression is not the cause ✅[^lab-matrix]. Deno 2.9.8 (E6, V8 15.0) inlined all three, and Electron 38.8.6 (E8, V8 14.0) none: these come with the V8 version, seen on V8 15.0 in two embedders and not on V8 14.0 or 14.1 ✅[^lab-matrix]. In Deno the script's own column is wrong, because Deno prints V8's trace lines out of order with the script's lines; the E6 result was read from the `into <function>` part of each `Inlining` line.

<details><summary><code>callforms.js</code> and <code>builtins-inline.mjs</code> with the 14.1 masks on E7, and on E9</summary>

`ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax callforms.b14.js`

```text
direct          TurboFan, sum3 inlined: yes
callMethod      TurboFan, sum3 inlined: yes
boundFn         TurboFan, sum3 inlined: yes
spreadLiteral   TurboFan, sum3 inlined: yes
applyLiteral    TurboFan, sum3 inlined: yes
spreadVariable  TurboFan, sum3 inlined: yes
applyVariable   TurboFan, sum3 inlined: yes
applyArguments  TurboFan, sum3 inlined: no
spreadRest      TurboFan, sum3 inlined: no
```

`ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax builtins-inline.b14.mjs`

```text
forEach  caller TurboFan, after a second optimization TurboFan; callback inlined: yes; deopts: none
map      caller not TurboFan, after a second optimization TurboFan; callback inlined: yes; deopts: wrong map
reduce   caller TurboFan, after a second optimization TurboFan; callback inlined: yes; deopts: none
filter   caller TurboFan, after a second optimization TurboFan; callback inlined: yes; deopts: none
find     caller TurboFan, after a second optimization TurboFan; callback inlined: yes; deopts: none
sort     caller TurboFan, after a second optimization TurboFan; callback inlined: yes; deopts: none
```

E9, the `--turbofan` copies (E2 printed the same): `<E9 node> --allow-natives-syntax --turbofan callforms.tf.js` and `… builtins-inline.tf.mjs`, the lines that differ from E7:

```text
spreadVariable  TurboFan, sum3 inlined: no
applyVariable   TurboFan, sum3 inlined: no
sort     caller TurboFan, after a second optimization TurboFan; callback inlined: no; deopts: none
```

E8 (`ELECTRON_RUN_AS_NODE=1 "/Applications/Postman.app/Contents/MacOS/Postman" --allow-natives-syntax callforms.b14.js` and `… builtins-inline.b14.mjs`) printed these same three lines. E6 (`deno run -A --no-remote --v8-flags=--allow-natives-syntax builtins-inline.b14.mjs`) printed the E7 `sort` line. For `callforms.js`, Deno needs the `.cjs` extension (same content), and its child prints V8's lines out of order with the script's own, so the script's column is shifted; the `into` names of the child's `Inlining` lines (`deno run -A --v8-flags=--allow-natives-syntax,--trace-turbo-inlining callforms.b14.cjs child`), in order:

```text
direct callMethod boundFn spreadLiteral applyLiteral spreadVariable applyVariable
```
</details>

- **Loop timings (E4, E7; four runs each).** Baseline B: `for…of` 1.15 to 1.22, `forEach` 1.84 to 1.94, `reduce` 0.81 to 0.85 times the index loop. E4: `for…of` 0.92 to 0.95, `forEach` 2.82 to 2.94, `reduce` 0.81 to 0.83; workload A as in the baseline. E7: in A, the index loop and `for…of` were TurboFan code at entry and `for…of` took 0.83 to 0.93 times as long; in B, `for…of` 0.95 to 0.99, `forEach` 2.70 to 2.82, `reduce` 1.00 to 1.02. Measured here, ranges over the first agent's four runs and a review's three more ✅[^lab-matrix]. E9 and E2 are emulated, so the timing scripts did not run there; E6 and E8 are native and did (the narrowing table above): the A result comes with V8 15.0 (Deno 2.9.8 too), the `reduce` of about 1.0 with the two Electron builds ✅[^lab-matrix]. Chrome 158 (flagged headless runs and a visible window) gave the E7 B ratios (§4.2) ✅[^lab-matrix].

<details><summary><code>loops-bench.mjs</code> with the 14.1 masks, one run each on E4 and E7</summary>

`~/.nvm/versions/node/v25.7.0/bin/node --allow-natives-syntax loops-bench.b14.mjs`

```text
A: 1e6 items x 20 calls
  for (let i ...)  median   15.5 ms per round   entry tier after: Sparkplug
  for...of         median  143.4 ms per round   entry tier after: Sparkplug
  forEach          median  108.0 ms per round   entry tier after: Sparkplug
  reduce           median  104.1 ms per round   entry tier after: Sparkplug
B: 1e3 items x 20000 calls
  for (let i ...)  median   11.3 ms per round   entry tier after: TurboFan
  for...of         median   10.5 ms per round   entry tier after: TurboFan
  forEach          median   32.0 ms per round   entry tier after: TurboFan
  reduce           median    9.1 ms per round   entry tier after: TurboFan
checksum 79200000000
```

`ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax loops-bench.b14.mjs`

```text
A: 1e6 items x 20 calls
  for (let i ...)  median   16.1 ms per round   entry tier after: TurboFan
  for...of         median   13.3 ms per round   entry tier after: TurboFan
  forEach          median  103.1 ms per round   entry tier after: Sparkplug
  reduce           median   97.7 ms per round   entry tier after: Sparkplug
B: 1e3 items x 20000 calls
  for (let i ...)  median   13.7 ms per round   entry tier after: TurboFan
  for...of         median   13.2 ms per round   entry tier after: TurboFan
  forEach          median   37.8 ms per round   entry tier after: TurboFan
  reduce           median   13.8 ms per round   entry tier after: TurboFan
checksum 79200000000
```
</details>

<details><summary><code>loops-bench.mjs</code> in Chrome 158 (page variant), and on E6 and E8</summary>

The page variant, changed lines only (the copy with the 14.1 masks; `loops-var.mjs` lines 24 and 26 and `warmup.mjs` lines 11 and 13 changed the same way):

- line 19: `const t0 = process.hrtime.bigint();` → `const t0 = performance.now();`
- line 21: `Number(process.hrtime.bigint() - t0) / 1e6` → `(performance.now() - t0)`

On E1 (Node.js 24.22.1, 13.6 masks, three runs) the variant gave the baseline order: A `for…of` 8.71 to 9.12, `forEach` 7.72 to 7.92, `reduce` 6.46 to 6.79; B 1.10 to 1.15, 1.73 to 1.83, 0.80 to 0.83.

E10, one of three runs with the Chrome flag `--disable-renderer-backgrounding` and `--js-flags="--allow-natives-syntax"` (module script); the runs with `--no-efficiency-mode` and in a visible window printed the same tiers and ratios:

```text
A: 1e6 items x 20 calls
  for (let i ...)  median   15.7 ms per round   entry tier after: TurboFan
  for...of         median   13.8 ms per round   entry tier after: TurboFan
  forEach          median  110.0 ms per round   entry tier after: Sparkplug
  reduce           median  105.4 ms per round   entry tier after: Sparkplug
B: 1e3 items x 20000 calls
  for (let i ...)  median   14.3 ms per round   entry tier after: TurboFan
  for...of         median   13.7 ms per round   entry tier after: TurboFan
  forEach          median   38.2 ms per round   entry tier after: TurboFan
  reduce           median   14.3 ms per round   entry tier after: TurboFan
checksum 79200000000
```

E10, `--js-flags="--allow-natives-syntax"` only (default headless flags), the run that stayed in Maglev code (workload B; workload A stayed in Maglev code too):

```text
B: 1e3 items x 20000 calls
  for (let i ...)  median   25.0 ms per round   entry tier after: Maglev
  for...of         median   60.4 ms per round   entry tier after: Maglev
  forEach          median   59.6 ms per round   entry tier after: Maglev
  reduce           median  100.5 ms per round   entry tier after: Maglev
```

E6 (`deno run -A --no-remote --v8-flags=--allow-natives-syntax loops-bench.b14.mjs`), one of six runs:

```text
A: 1e6 items x 20 calls
  for (let i ...)  median   14.8 ms per round   entry tier after: TurboFan
  for...of         median   10.5 ms per round   entry tier after: TurboFan
  forEach          median  102.5 ms per round   entry tier after: Sparkplug
  reduce           median  104.2 ms per round   entry tier after: Sparkplug
B: 1e3 items x 20000 calls
  for (let i ...)  median   11.2 ms per round   entry tier after: TurboFan
  for...of         median   10.6 ms per round   entry tier after: TurboFan
  forEach          median   26.7 ms per round   entry tier after: TurboFan
  reduce           median    9.7 ms per round   entry tier after: TurboFan
```

E8 (`ELECTRON_RUN_AS_NODE=1 "/Applications/Postman.app/Contents/MacOS/Postman" --allow-natives-syntax loops-bench.b14.mjs`), one of three runs, workload B (in A every function was Sparkplug code at entry):

```text
B: 1e3 items x 20000 calls
  for (let i ...)  median   14.2 ms per round   entry tier after: TurboFan
  for...of         median   13.9 ms per round   entry tier after: TurboFan
  forEach          median   47.1 ms per round   entry tier after: TurboFan
  reduce           median   15.0 ms per round   entry tier after: TurboFan
```
</details>

- **`loops-var.mjs` (E3, E4, E7; four runs each).** Baseline: with all three as TurboFan code, `forEach` 1.30 to 1.90, `reduce` 0.82 to 0.89 for the sum and 1.28 to 1.40 for odd squares; the middle workload left `forEach` and `reduce` in Maglev. E3: the middle workload ended all TurboFan; for odd squares the index loop was slowest (`forEach` and `reduce` 0.82 to 0.86). E4: `forEach` 2.16 to 3.02, `reduce` 0.80 to 0.96 for both bodies. E7: `forEach` 2.70 to 3.19 (sum) and 4.60 to 6.29 (odd squares), `reduce` 0.99 to 1.03 and 1.22 to 1.46. Measured here: ranges over the first agent's four runs and a review's three more ✅[^lab-matrix].

<details><summary><code>loops-var.mjs</code>, one run each on E3 and E7</summary>

`~/.nvm/versions/node/v22.23.4/bin/node --allow-natives-syntax loops-var.mjs`

```text
sum          1000000 items x      5 calls: for    3.8 ms, forEach   25.4 ms (x6.66), reduce   24.6 ms (x6.46); tiers after: Sparkplug/Sparkplug/Sparkplug
sum           100000 items x    200 calls: for   10.9 ms, forEach   19.7 ms (x1.82), reduce    9.1 ms (x0.84); tiers after: TurboFan/TurboFan/TurboFan
sum            10000 items x   2000 calls: for   10.8 ms, forEach   19.7 ms (x1.83), reduce    9.1 ms (x0.85); tiers after: TurboFan/TurboFan/TurboFan
sum              100 items x 200000 calls: for   12.5 ms, forEach   19.7 ms (x1.58), reduce   11.1 ms (x0.89); tiers after: TurboFan/TurboFan/TurboFan
odd squares  1000000 items x      5 calls: for    4.9 ms, forEach   24.7 ms (x5.01), reduce   26.6 ms (x5.39); tiers after: Sparkplug/Ignition/Ignition
odd squares   100000 items x    200 calls: for   18.4 ms, forEach   15.2 ms (x0.83), reduce   15.1 ms (x0.82); tiers after: TurboFan/TurboFan/TurboFan
odd squares    10000 items x   2000 calls: for   18.9 ms, forEach   15.8 ms (x0.84), reduce   15.7 ms (x0.83); tiers after: TurboFan/TurboFan/TurboFan
odd squares      100 items x 200000 calls: for   20.4 ms, forEach   17.2 ms (x0.84), reduce   16.8 ms (x0.82); tiers after: TurboFan/TurboFan/TurboFan
checksum 5920200000000
```

`ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --allow-natives-syntax loops-var.b14.mjs`

```text
sum          1000000 items x      5 calls: for    4.0 ms, forEach   25.8 ms (x6.40), reduce   24.4 ms (x6.05); tiers after: TurboFan/Sparkplug/Sparkplug
sum           100000 items x    200 calls: for   13.8 ms, forEach   58.0 ms (x4.21), reduce   97.9 ms (x7.09); tiers after: TurboFan/Maglev/Maglev
sum            10000 items x   2000 calls: for   13.9 ms, forEach   38.3 ms (x2.76), reduce   13.9 ms (x1.00); tiers after: TurboFan/TurboFan/TurboFan
sum              100 items x 200000 calls: for   12.3 ms, forEach   38.9 ms (x3.17), reduce   12.4 ms (x1.01); tiers after: TurboFan/TurboFan/TurboFan
odd squares  1000000 items x      5 calls: for   14.1 ms, forEach   27.7 ms (x1.96), reduce   27.6 ms (x1.96); tiers after: TurboFan/Ignition/Ignition
odd squares   100000 items x    200 calls: for   10.9 ms, forEach   85.5 ms (x7.84), reduce  105.8 ms (x9.70); tiers after: TurboFan/Maglev/Maglev
odd squares    10000 items x   2000 calls: for   10.6 ms, forEach   66.7 ms (x6.29), reduce   15.1 ms (x1.43); tiers after: TurboFan/TurboFan/TurboFan
odd squares      100 items x 200000 calls: for   13.2 ms, forEach   64.3 ms (x4.87), reduce   17.0 ms (x1.29); tiers after: TurboFan/TurboFan/TurboFan
checksum 5920200000000
```
</details>

- **Warm-up length (E3, E4, E7).** Baseline: the callbacks settle from round 7 (after 12 000 calls). E3: from round 3 (after 4 000 calls). E4 and E7: from round 10 (after 18 000 calls), at 30 to 31 ms (E4) and 36 to 39 ms (E7) per round for `forEach` ✅[^lab-matrix].

<details><summary><code>warmup.mjs</code>, one run each on E3 and E4</summary>

`~/.nvm/versions/node/v22.23.4/bin/node --allow-natives-syntax warmup.mjs`

```text
for      12 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 12 11 11 11 11
forEach  105 64 21 20 20 20 21 20 20 20 20 20 20 20 21 21 21 21 21 21 21 21 20 21 21
reduce   102 57 9 9 9 9 10 9 9 9 9 9 9 9 10 9 10 10 10 11 9 9 10 10 9
```

`~/.nvm/versions/node/v25.7.0/bin/node --allow-natives-syntax warmup.mjs`

```text
for      12 10 11 10 10 10 11 10 11 11 11 11 10 10 10 10 10 10 10 10 10 10 12 10 10
forEach  71 57 57 59 53 53 53 54 44 32 39 34 31 31 31 31 30 31 31 30 30 36 40 31 31
reduce   100 96 99 97 96 96 97 97 76 9 12 9 9 9 9 9 19 9 9 9 9 10 9 9 9
```
</details>

- **Flag defaults (E2, E3, E4, E7).** See the defaults table above ✅[^lab-matrix].

## Verification status

- **Measured** on 2026-11-26 with Node.js 24.22.1 (V8 13.6.233.17-node.58) in the image `node:24.22.1-alpine`, linux arm64 under Docker on an Apple M2, with `--network none`. Twenty-five scripts, all embedded above with their output. Build facts read from the same image on 2026-11-27: `process.arch` is `arm64`, `process.platform` is `linux`, and `process.config.variables` gives `v8_enable_pointer_compression: 0`, `v8_enable_sandbox: 0`, `v8_enable_maglev: 1` and `v8_enable_lite_mode: 0`. A result that depends on the word size or on the tiers (the small-integer range, bytes per value, tier-up) may differ on a build with other values, on x64, or on another V8 version: the matrix re-run of 2026-11-27 (next bullet) checked six such builds. A second reader re-ran the first seventeen on the same day: the sixteen that print no timing gave the quoted output exactly; `loops-bench.mjs` was run three more times (§4.2). The eight added in that review (`toobig.mjs`, `fv.mjs`, `inline-var.mjs`, `deoptloop-var.mjs`, `natural.mjs`, `bits-extra.mjs`, `loops-var.mjs`, `warmup.mjs`) are variations that test whether a conclusion holds for another function body or size; all but the two timing scripts (`loops-var.mjs`, `warmup.mjs`) repeated their output on a second run (`deoptloop-var.mjs` also on a default-flags variant, §3.3).
- **Matrix re-run on 2026-11-27** (§6.4, "Other builds and versions"): 25 scripts on five more builds, 125 script-and-build cells: 53 same, 68 differ, 1 could not run (`fv.mjs` in Electron 43), 3 not run (the timing scripts on emulated x64). 152 script runs in all: 110 non-timing runs (22 scripts once on each build) and 42 timing runs (3 scripts three times on each macOS build, plus 6 reruns alone); 16 of the timing runs, on V8 14.1 and 15.0, used the 14.1 status-bit masks. Plus 41 variant runs: the 14.1 masks on V8 14.1 and 15.0, `--turbofan` on emulated x64, the 2 ** 30 − 1 overflow check. Most differences come from three build facts: TurboFan off by default on emulated x64, Maglev off by default on V8 12.4, and the status bits moved on V8 14.1 and 15.0. Then E9 (Node.js 24.22.3 with pointer compression, emulated linux x64) and E2 again: the 22 scripts that print no timing once on each, with `--turbofan` for the 18 that read tiers or deoptimizations, plus the 2 ** 30 − 1 checks: 48 runs. E9 column: 16 same, 6 differ, 0 could not run, 3 not run (timing). All seven builds: 150 cells, 69 same, 74 differ, 1 could not run, 6 not run. Of the E7-only differences, one is settled as pointer compression (the small-integer range and the `smiOverflow` case), six as not pointer compression (`fv.mjs`, spread and `apply` of a variable, the `sort` comparator, Sparkplug at call 21, the doubled `Considering` lines, and the `--max-inlined-bytecode-size-small` default of 30), and the E7 timings are not settled by E9. Then E6 (Deno 2.9.8, V8 15.0) and E8 (Electron 38.8.6, V8 14.0) ran the scripts of those eight E7-only differences (narrowing table, §6.4): 7 non-timing runs on each, 8 timing runs on E6 and 6 on E8, plus `--no-baseline-batch-compilation` checks on five builds. Of the eight, four come with V8 15.0 (spread and `apply` of a variable, the `sort` comparator, the default of 30, the A timing), one was seen on three builds with V8 14.0 and 15.0 (`fv.mjs`), one is common to the two Electron builds (`reduce` about 1.0), one is specific to Electron 43.7.7 (the doubled `Considering` lines), and the Sparkplug call depends on batch compilation. Then E10 (Chrome 158.0.8127.89, V8 15.8, headless): 25 cells, 0 same, 10 differ (7 of them as page variants), 15 could not run (12 read a V8 trace, 1 `--v8-options`, 1 `%DebugPrint`, 1 a `--log-ic` file); 3 ran unchanged (`smi.mjs`, and `tiers.mjs` and `self.mjs` also with the 14.1 masks); the 7 page variants ran on E1 too and gave the baseline result; 158 E10 runs (with the efficiency-mode, batch-compilation and size checks and a seven-case status probe), 9 of them timing runs with the default flags and 9 with `--no-efficiency-mode`; a review added 27 timing runs (3 scripts, three runs each with the default flags, with `--no-efficiency-mode` and with `--disable-renderer-backgrounding`), 27 `natural.mjs` page runs of 18 subjects, 9 `tierup.mjs` runs, 3 visible-window runs of `loops-bench.mjs`, and a small probe (9 headless and 3 visible runs, §6.2). All builds: 175 cells, 69 same, 84 differ, 16 could not run, 6 not run. Still not run: Windows; native x64 hardware (E2 and E9 are emulated, and both default to `--no-turbofan` there); a pointer-compression build on arm64 other than Chrome and Electron; Firefox and Safari (other engines: out of scope of this doc); V8 versions outside 12.4 to 15.8; in a visible (not headless) Chrome window, every script except the small probe, `loops-bench.mjs`, `natural.mjs`, `tierup.mjs` and `warmup.mjs`; a tab that becomes visible again after being hidden; Chrome's Energy Saver setting; phones. On 2026-11-28, Chrome 158 in a visible window: 121 runs, the probe five times in each of five modes (headless, front tab, hidden tab, minimized window, covered window), 9 hidden-tab runs with settle times of 0, 3 000 and 15 000 ms, 6 hidden-tab runs with `--disable-renderer-backgrounding` or `--no-efficiency-mode`, 6 runs of the 20-second hidden-tab variant (3 with the default flags, 3 with one of the two flags), `loops-bench.mjs` three times in a hidden tab and three in the front tab, and in the front tab `natural.mjs` (54 pages), `tierup.mjs` (12 pages) and `warmup.mjs` three times each (§6.2, §6.4).
- **Read only:** the V8 source at tag 13.6.233.17 (`runtime.h`, `runtime-test.cc`, `deoptimize-reason.h`, `bailout-reason.h`, `tiering-manager.cc`, `ic.cc`, `shared-function-info.h`, `js-inlining-heuristic.cc`, `escape-analysis.h`), v8.dev posts and docs, the Node.js 24.0.0 release notes, and three Rank 6 sources that record the old beliefs (§6.1). The V8 source files were re-read at tag 13.6.233.17 in the review.
- **Not checked:** call-site IC states (`--log-ic` logs no call sites here); whether a polymorphic (`P`) site is slower than a monomorphic one (not timed here); Maglev inlining; the bit `MarkedForDeoptimization`; functions larger than a few hundred bytes of bytecode with the features of §3.8; TurboFan OSR from a loop that did not first enter Maglev; Turboshaft's own phases (there is no trace of them in the scripts above); the speed of `await`; the effect of `eval` on surrounding variables; Windows, native x64 hardware, and a pointer-compression build on arm64 other than Chrome and Electron (see the matrix bullet); in Chrome, everything the 15 scripts that read V8's own output show; in a visible Chrome window, every script except the small probe of §6.2, `loops-bench.mjs`, `natural.mjs`, `tierup.mjs` and `warmup.mjs`; a Chrome tab that becomes visible again after being hidden, Chrome on other operating systems, Chrome's Energy Saver setting, and phones; why a hidden tab kept Maglev code past the delay that V8's source describes (§6.4).
- Verified: 264 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-27

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
- [src/execution/isolate.h at 15.8.62.31](https://github.com/v8/v8/blob/15.8.62.31/src/execution/isolate.h) — V8 project, 2026. Rank 1. Backs: §6.4 (`EfficiencyModeEnabled()`). [^v8-isolate-158]
- [src/execution/tiering-manager.cc at 15.8.62.31](https://github.com/v8/v8/blob/15.8.62.31/src/execution/tiering-manager.cc) — V8 project, 2026. Rank 1. Backs: §6.4 (the TurboFan delay and synchronous compiles in efficiency mode). [^v8-tiering-158]
- [src/flags/flag-definitions.h at 15.8.62.31](https://github.com/v8/v8/blob/15.8.62.31/src/flags/flag-definitions.h) — V8 project, 2026. Rank 1. Backs: §6.4 (efficiency-mode flag defaults). [^v8-flags-158]
- [content/renderer/render_thread_impl.cc on main](https://chromium.googlesource.com/chromium/src/+/main/content/renderer/render_thread_impl.cc) — Chromium project, read 2026-11-28 (the `main` branch, not Chrome 158). Rank 1. Backs: §6.4 (isolate priority when the renderer is hidden or visible). [^cr-render-thread]
- [content/public/common/content_switches.cc on main](https://chromium.googlesource.com/chromium/src/+/main/content/public/common/content_switches.cc) — Chromium project, read 2026-11-28 (the `main` branch, not Chrome 158). Rank 1. Backs: §6.4 (`--disable-renderer-backgrounding`). [^cr-switches]
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
- Lab matrix: the same twenty-five scripts re-run on 2026-11-27 on ten builds: E0 the baseline above; E1 macOS 26.1 arm64 with Node.js 24.22.1; E2 linux x64 emulated in Docker (`node:24.22.1-alpine-amd64`, Node.js 24.22.1); E3 macOS arm64 with Node.js 22.23.4 (V8 12.4.254.21-node.57); E4 macOS arm64 with Node.js 25.7.0 (V8 14.1.146.11-node.20); E7 Electron 43.7.7 run as Node on macOS arm64 (V8 15.0.245.31-electron.0, pointer compression and the V8 sandbox on); E9 linux x64 emulated in Docker with the Node.js project's unofficial build `node-v24.22.3-linux-x64-pointer-compression` (V8 13.6.233.17-node.63, pointer compression on, sandbox off), the 22 scripts without timing; E6 Deno 2.9.8 in Docker on linux arm64 (V8 15.0.245.2) and E8 Electron 38.8.6 run as Node on macOS arm64 (V8 14.0.365.10-electron.0), the scripts of the E7-only differences; E10 Google Chrome 158.0.8127.89 (V8 15.8.62.31) headless on macOS arm64, the 10 scripts that run in a page, 7 of them as page variants; on 2026-11-28 the same Chrome in a visible window: the probe of §6.2 in the front tab, a hidden tab, a minimized window and a covered window, a 20-second hidden-tab variant, `loops-bench.mjs` in a hidden tab and the front tab, and `natural.mjs`, `tierup.mjs` and `warmup.mjs` in the front tab. Rank 1, primary measurement; outputs of the differences quoted in §6.4. [^lab-matrix]

## Related
- `js-runtime/v8-hidden-classes.md` — object shapes (maps), transitions, inline caches and dictionary mode, which §3.1 builds on.
- `js-runtime/v8-object-and-value-representation-deep-dive.md` — small integers, heap numbers, pointer compression, elements kinds and strings.
- `js-runtime/v8-memory-and-startup-deep-dive.md` — parsing, lazy compilation, code caching and garbage collection.
- `js-runtime/private-fields.md` — private class fields in V8.
- `js-runtime/node-worker-default-heap-limit.md` — heap limits of worker threads.
- `javascript/object-basics/index.md` — objects, references and garbage collection basics.
- `performance/code-review/problem-classes-language-runtimes.md` — the `object-shape-instability` problem class.
