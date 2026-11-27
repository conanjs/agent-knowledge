---
schema: knowledge-doc/v1
type: reference
topic: performance/code-review
status: verified
applies-to: ["Node.js 24.22.1 with V8 13.6.233.17, linux arm64, pointer compression off (lab, Docker node:24.22.1-alpine on Apple M2); V8 source at tag 13.6.233.17; MDN and Vue 3 docs read 2026-11-26"]
last-verified: 2026-11-26
last-updated: 2026-11-26
tags: [performance, code-review, javascript, v8, turbofan, maglev, inline-caches, deoptimization, proxy, eval, prototypes]
ranked-sources: true
---

# Performance problem classes in JavaScript code shapes that defeat V8's optimizing compilers

## Summary
**TL;DR:** V8 runs hot JavaScript fast only when its optimizing compilers can specialize the code. Eight code shapes, each visible in a diff, stop that on V8 13.6 (Node.js 24): a read site fed many object shapes, a value that changes type at one site, a function too big for TurboFan, a function that holds a direct `eval` or `with`, a `Proxy` read in a loop, `for…in` over an array, a patched built-in prototype, and a prototype set per object. Every V8 behaviour here was shown in a lab run on Node.js 24.22.1; old advice that no longer holds (`try`/`catch`, `arguments`, `const`) is listed under Corrections. All costs are per call or per element, so a cold path is not a finding.
**Use this when:** you review JavaScript or TypeScript that runs per element, per request or per frame on Node.js 24 or a current Chrome, and the code shape is in the signal column below.
**Not this doc:** the first catalog of 39 classes → `problem-classes.md`; unstable object shapes, `delete`, holey and mixed arrays (`object-shape-instability`) → `problem-classes-language-runtimes.md`; JavaScript language and built-in patterns (array chains, `Map` against objects, async layers) → `problem-classes-javascript-language.md`; how shapes and inline caches work → `../../js-runtime/v8-hidden-classes.md`; V8's tiers and deoptimization → `../../js-runtime/v8-compiler-pipeline-deep-dive.md`; Smis, heap numbers and dictionary mode → `../../js-runtime/v8-object-and-value-representation-deep-dive.md`.

## Scope
The domain is code that is correct JavaScript but that V8's optimizing tiers cannot specialize, or can specialize only for a slow general case. Analogy: a fast-food line that is quick because every order is one of five menu items; a customer with a custom order stops the line, and a till that has seen fifty different orders stops remembering any of them. Concrete example: `function getId(o) { return o.id; }` called with objects of eight different shapes took 57.5 to 67.5 ms per 10⁷ calls in six lab runs, against 10.3 to 11.7 ms for the same function called with one shape (measured here on Node.js 24.22.1, one function and one machine, not a general ratio) ✅[^lab].

Covered: eight classes in three groups (one site seeing many shapes or types, features that add work per access or per call, prototype changes). Not covered: how V8 works inside (the deep dives linked above), garbage-collector and heap flags, WebAssembly, and shapes already in other catalogs (see "Belongs to an existing class").

Notation (each symbol is a count read from the code or its workload):

| Symbol | Meaning | Worked example |
|---|---|---|
| n | Calls of the hot function, or elements of the loop | A request handler that reads `user.id` for 5,000 rows: n = 5,000 |
| s | Distinct object shapes one property-read site receives | A `serialize(entity)` helper called with `User`, `Order` and 6 other entity classes: s = 8, which is above 4, so the site is megamorphic on V8 13.6 |
| b | Bytecode bytes of one function, as `--print-bytecode` prints them | A generated validator of 3,000 statements of about 21 bytes each: b = 62,235 in the lab run, above the 61,440-byte (60 KB) TurboFan limit |

Terms:

| Term | Plain meaning | Analogy | Concrete example |
|---|---|---|---|
| Tier | One of V8's ways to run a function: interpreted, baseline, Maglev or TurboFan, as the `%GetOptimizationStatus` bits name them ✅[^v8-runtime] | Gears in a car | A hot function moves from Ignition up to TurboFan after thousands of calls; the count varies with the function ([measured](../../js-runtime/v8-compiler-pipeline-deep-dive.md)) |
| Inline cache (IC) | A per-site record of the object shapes seen there: 0 (none), 1 (monomorphic), P (polymorphic), N (megamorphic) in V8's IC log ✅[^v8-ic] | A cashier who remembers regular customers, up to a point | `o.id` that has seen 8 shapes logs `P -> N` ✅[^lab] |
| Deoptimization (deopt) | Optimized code meets a value it assumed away and falls back to a lower tier | A train leaving the express track for the local one | `h * 31 + c` grows past the small-integer range: `reason: overflow` ✅[^lab] |
| Smi | V8's small-integer representation; other numbers are heap numbers (see the representation deep dive) | Coins in your pocket against a cheque | a 40-character hash computed without `\| 0` is not a Smi, the `Math.imul` version is ✅[^lab] |
| Dictionary mode | Properties kept in a hash table instead of fixed slots | A loose-leaf binder against a printed form | An object literal with a getter has `%HasFastProperties` false on V8 13.6 ✅[^lab] |
| Protector | A global V8 flag that says "nobody changed this built-in"; while it holds, fast paths skip checks | A "no changes since inspection" seal on a machine | Writing `Array.prototype.constructor` flips `%ArraySpeciesProtector()` to false ✅[^lab] |
| Function context | A heap object that holds a function's variables when something may read them by name | Moving your notes from your head to a shared whiteboard | A function holding a direct `eval` allocates one per call ✅[^lab] |

How the lab checks work: natives such as `%GetOptimizationStatus` need `--allow-natives-syntax`, and V8 flags such as `--trace-deopt` have no stability guarantee across Node.js versions ✅[^node-cli]. Each script below runs with `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine <command>`; timings are medians of 7 or 9 runs after a warm-up, measured here on Node.js 24.22.1; the doc quotes the first run and the range of three independent re-runs, and every conclusion held in all of them.

## Catalog

**One site seeing many shapes or types**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `megamorphic-access-site` | One generic helper on a hot path called with many unrelated classes or literals: `getId(x)`, `serialize(entity)`, `compare(a, b)`, `deepEqual`, a visitor reading `node.kind` over many AST node classes, a loop over one array that mixes records from several factories; each shape is stable, but one site sees 5 or more | Normalize at the boundary to one class or one factory with all fields; or split the helper per type so each site sees 4 shapes or fewer (a lab limit, see Check); or keep one array per record kind | Per read a cached shape check → a generic lookup. In the lab, the site went `1 -> P` at 4 shapes and `P -> N` at 5 and at 8; the flag `--max-valid-polymorphic-map-count` defaults to 4 in V8 13.6 (printed by `node --v8-options`, defined in `flag-definitions.h`) ✅[^lab] ✅[^v8-flags]; one read with 1, 4 and 8 shapes took medians of 10.3 to 11.7, 45.2 to 54.4 and 57.5 to 67.5 ms per 10⁷ calls in six runs, measured here on Node.js 24.22.1 (the one-shape run reads the same object every step) ✅[^lab] | `node --log-ic --logfile=ic.log --no-logfile-per-isolate app.js`, then `grep ^LoadIC ic.log` for the file's line: `P -> N` before, at most `1 -> P` after ✅[^lab] |
| `type-unstable-site` | Integer math that can leave the 32-bit range with no `\| 0` or `Math.imul` (string hashes `h = h * 31 + c`, checksums); a number variable started as `undefined`, `null` or `''` (`let total;` then `total += x`); one accumulator or parameter used for numbers on most calls and strings on some | One type per site: start numbers at `0`; convert at the input boundary (`Number(x)`); for 32-bit hash math use `Math.imul(h, 31)` and `\| 0`, which gives C-like 32-bit multiplication ✅[^mdn-imul] (a change of result, so only where wrapping is intended); separate functions for the string and number paths | A deopt when the site meets a value outside what it was compiled for, then slower general code. In the lab the unbounded hash deopted with `reason: overflow` while the `Math.imul` version stayed a Smi ✅[^lab]; a sum loop whose `+=` had once seen a string stayed slower on small integers: 0.72 to 0.78 ms against 2.08 to 2.14 ms median per 10⁶ elements in three runs, measured here ✅[^lab] | `node --trace-deopt app.js \| grep -o 'reason: [^)]*'`: no new reasons for the hot function after warm-up ✅[^lab] |
| `oversized-function` | Generated code compiled into one function: `new Function(body)` with a body built from a schema, grammar or template; code-generator output with thousands of statements; a giant `switch` dispatch loop | Split into functions under the limit: one per rule, state or case group; make the generator emit helpers | TurboFan code → never TurboFan for that function. V8 13.6 sets `max_optimized_bytecode_size` to `60 * KB`, which `node --v8-options` prints as `--max-optimized-bytecode-size=61440` ✅[^v8-flags] ✅[^lab]; in the lab a 60,135-byte function was TurboFan-compiled, a 62,235-byte one was refused with "Function is too big to be optimized", and Maglev still compiled both ✅[^lab] | `node --trace-opt app.js \| grep 'too big'`: no line after the split; `--print-bytecode --print-bytecode-filter=<name>` prints `Bytecode length` ✅[^lab] |

<details><summary>Lab: megamorphic-access-site (mega.mjs, mega.sh). One read `o.id` fed objects of 1, 4 or 8 shapes, plus 5 shapes (five.mjs)</summary>

```js
const make = (k) => { const o = { id: 1 }; o['f' + k] = k; return o; };
const objs = Array.from({ length: 8 }, (_, k) => make(k));
function id1(o) { return o.id; }
function id4(o) { return o.id; }
function id8(o) { return o.id; }
function run(f, shapes) {
  let s = 0;
  for (let i = 0; i < 1e7; i++) s += f(objs[i & (shapes - 1)]);
  return s;
}
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
for (const [f, shapes] of [[id1, 1], [id4, 4], [id8, 8]]) {
  run(f, shapes); // warm-up
  const t = [];
  for (let r = 0; r < 7; r++) { const t0 = process.hrtime.bigint(); run(f, shapes); t.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  console.log(`${f.name}: ${shapes} shape(s), median of 7 runs ${median(t).toFixed(1)} ms`);
}
```
```js
const a = [0, 1, 2, 3, 4].map((k) => ({ id: 1, ['f' + k]: k }));
function id5(o) { return o.id; }
for (let i = 0; i < 1e5; i++) id5(a[i % 5]);
```
```sh
cd /tmp
node /work/mega.mjs
node --log-ic --logfile=/tmp/ic.log --no-logfile-per-isolate /work/mega.mjs > /dev/null
echo "IC state changes at the o.id reads of id4 (line 4) and id8 (line 5):"
grep '^LoadIC' /tmp/ic.log | awk -F, '$4==4 || $4==5 {print "line " $4 ": " $6 " -> " $7}' | sort -u
node --v8-options | grep -A1 -- '--max-valid-polymorphic-map-count'
node --log-ic --logfile=/tmp/ic5.log --no-logfile-per-isolate /work/five.mjs
echo "five.mjs, o.id read (line 2):"; grep '^LoadIC' /tmp/ic5.log | awk -F, '$4==2 {print $6 " -> " $7}' | sort -u
```
Output of `sh mega.sh`:
```text
id1: 1 shape(s), median of 7 runs 11.1 ms
id4: 4 shape(s), median of 7 runs 45.3 ms
id8: 8 shape(s), median of 7 runs 57.6 ms
IC state changes at the o.id reads of id4 (line 4) and id8 (line 5):
line 4: 0 -> 1
line 4: 1 -> P
line 4: P -> P
line 5: 0 -> 1
line 5: 1 -> P
line 5: N -> N
line 5: P -> N
line 5: P -> P
  --max-valid-polymorphic-map-count (maximum number of valid maps to track in POLYMORPHIC state)
        type: int  default: --max-valid-polymorphic-map-count=4
  --clone-object-sidestep-transitions (support sidestep transitions for dependency tracking object clone maps)
five.mjs, o.id read (line 2):
0 -> 1
1 -> P
P -> N
P -> P
```
</details>

<details><summary>Lab: type-unstable-site (overflow.mjs, deopt-cost.mjs, overflow.sh). A hash that grows past 32 bits, and a sum loop whose `+=` once saw a string</summary>

```js
function hashGrow(s) { let h = 0; for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i); return h; }
function hashInt32(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }
const short = 'abc', long = 'a'.repeat(40);
for (let i = 0; i < 1e5; i++) { hashGrow(short); hashInt32(short); } // trained on short keys only
hashGrow(long); hashInt32(long); // one long key arrives
for (let i = 0; i < 1e5; i++) { hashGrow(short); hashInt32(short); }
console.log('hashGrow(long) is a small integer:', %IsSmi(hashGrow(long)), '| hashInt32(long) is a small integer:', %IsSmi(hashInt32(long)));
```
```js
function clean(arr, start) { let s = start; for (let i = 0; i < arr.length; i++) s += arr[i]; return s; }
function mixed(arr, start) { let s = start; for (let i = 0; i < arr.length; i++) s += arr[i]; return s; }
const ints = Array.from({ length: 1e6 }, (_, i) => i & 1023);
for (let i = 0; i < 20; i++) mixed([1, 2], '');
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
for (const f of [clean, mixed]) {
  for (let i = 0; i < 50; i++) f(ints, 0); // warm-up, numbers only
  const t = [];
  for (let r = 0; r < 9; r++) { const t0 = process.hrtime.bigint(); f(ints, 0); t.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  console.log(`${f.name}: median of 9 runs ${median(t).toFixed(2)} ms`);
}
```
```sh
node --allow-natives-syntax --trace-deopt overflow.mjs | grep -oE 'reason: [^)]*\).*JSFunction [A-Za-z0-9]+|^hashGrow.*' | sed -E 's/\): begin.*JSFunction/) in/'
node deopt-cost.mjs
```
Output of `sh overflow.sh`:
```text
reason: overflow) in hashGrow
hashGrow(long) is a small integer: false | hashInt32(long) is a small integer: true
clean: median of 9 runs 0.78 ms
mixed: median of 9 runs 2.12 ms
```
</details>

<details><summary>Lab: oversized-function (big.mjs, big.sh). Generated functions of k statements `s = (s + i * j) | 0;`, each forced to compile</summary>

```js
const make = (k) => new Function('i', 'let s = 0;\n' + Array.from({ length: k }, (_, j) => `s = (s + i * ${j}) | 0;`).join('\n') + '\nreturn s;');
for (const k of [1000, 2900, 3000, 6000]) {
  const f = make(k), g = make(k);
  %PrepareFunctionForOptimization(f); f(1); f(2); %OptimizeFunctionOnNextCall(f); f(3);
  %PrepareFunctionForOptimization(g); g(1); g(2); %OptimizeMaglevOnNextCall(g); g(3);
  console.log(`${k} statements: TurboFan=${!!(%GetOptimizationStatus(f) & 64)} Maglev=${!!(%GetOptimizationStatus(g) & 32)}`);
}
```
```sh
node --allow-natives-syntax big.mjs
node --allow-natives-syntax --print-bytecode big.mjs | grep -o 'Bytecode length: [0-9]*' | awk '$3 > 10000' | sort -u -t: -k2 -n
node --allow-natives-syntax --trace-opt big.mjs | grep -o 'disabled optimization.*' | sed -E 's/0x[0-9a-f]+ //' | sort | uniq -c
```
Output of `sh big.sh`:
```text
1000 statements: TurboFan=true Maglev=true
2900 statements: TurboFan=true Maglev=true
3000 statements: TurboFan=false Maglev=true
6000 statements: TurboFan=false Maglev=true
Bytecode length: 20235
Bytecode length: 60135
Bytecode length: 62235
Bytecode length: 125235
      2 disabled optimization for <SharedFunctionInfo>, reason: Function is too big to be optimized]
```
</details>

**Features that add work per access or per call**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `direct-eval-scope` | `eval(` called by name inside a function (not `(0, eval)(…)` or `eval?.(…)`), even on a branch that rarely runs; `with (obj) { … }` in sloppy-mode code; expression or template engines that call `eval` inside the hot function | Indirect eval, which runs in the global scope ✅[^mdn-eval], or `Function(...)` built once with the needed values as parameters ✅[^mdn-eval]; `obj[name]` for a dynamic property ✅[^mdn-eval]; for `with`, a temporary variable or destructuring ✅[^mdn-with] | Per call 0 → 2 heap allocations, and variables move from registers to a heap context. MDN says direct eval makes engines disable optimizations related to inlining ✅[^mdn-eval], and that `with` repeats the property lookup each time an identifier is used ✅[^mdn-with]; in the lab a function whose `eval` never ran allocated a function context and an arguments object per call, used 15 context-slot loads and stores, and caused 1,084 scavenges where the plain function caused 0 ✅[^lab] | `--print-bytecode --print-bytecode-filter=<fn>`: no `CreateFunctionContext` after the fix; `--trace-gc` scavenge count flat with n ✅[^lab] |
| `proxy-in-hot-loop` | `new Proxy(` objects read in loops: Vue `reactive()` state iterated in a computed value or render over a large list, validation or logging wrappers, ORM or config objects built on `Proxy`, a tracing proxy left on in production | Read the raw object in the hot loop and keep the proxy at the boundary; in Vue 3, `toRaw()` reads without proxy access and tracking overhead, and `markRaw()` skips proxy conversion, which the page says can help when rendering large lists with immutable data sources ✅[^vue-raw]; copy the needed fields to locals once | Per property read an inline load → a call of the trap function. A proxy can intercept and redefine fundamental operations, its `get` trap intercepts property reads, and array methods also invoke `get` and `set` traps ✅[^mdn-proxy]; in the lab 10⁷ reads took 147.8 to 148.9 ms through a `get` trap against 3.6 to 4.1 ms on a plain object in three runs, measured here ✅[^lab] | CPU profile: trap frames under the hot loop before, none after; count trap calls per request: O(1) after the fix, not O(n) |
| `for-in-over-array` | `for (const k in arr)` or `for (i in list)` over arrays, typed arrays, `arguments` or `NodeList`; `parseInt(k)` or `Number(k)` in the body; `for…in` on a hot path over objects whose prototypes carry enumerable properties | Numeric `for`, `for…of` or `forEach`, which return the index as a number ✅[^mdn-forin]; `Object.keys(obj)` for own keys only ✅[^mdn-forin] | Per element an index read → a property enumeration with a string key. `for…in` also visits inherited enumerable properties ✅[^mdn-forin]; in the lab the key was the string `"0"`, and summing 10⁴ elements 1,000 times took 153.2 to 166.1 ms with `for…in` against 5.0 to 5.3 ms with numeric `for` and 5.9 to 6.8 ms with `for…of` in three runs, measured here ✅[^lab] | Scaling test at n and 2n with both loops; or grep `for (… in` and check the type of the right-hand side |

<details><summary>Lab: direct-eval-scope (evalcost.mjs, evalcost.sh). Same body; `withEval` holds a direct eval that never runs</summary>

```js
function plain(a, b) { let s = a; s += b; return s; }
function withEval(a, b, code) { let s = a; s += b; if (code) eval(code); return s; }
const median = (x) => x.sort((p, q) => p - q)[x.length >> 1];
for (const f of [plain, withEval]) {
  for (let i = 0; i < 1e5; i++) f(i, 1, ''); // warm-up
  const t = [];
  for (let r = 0; r < 7; r++) { const t0 = process.hrtime.bigint(); for (let i = 0; i < 1e6; i++) f(i, 1, ''); t.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  console.log(`${f.name}: 1e6 calls, median of 7 runs ${median(t).toFixed(1)} ms, TurboFan=${!!(%GetOptimizationStatus(f) & 64)}`);
}
```
```sh
node --allow-natives-syntax --trace-gc evalcost.mjs | awk '/Scavenge/ {n++} /calls/ {print $0 ", scavenges so far: " n+0}'
for f in plain withEval; do
  bc=$(node --allow-natives-syntax --print-bytecode --print-bytecode-filter=$f evalcost.mjs)
  echo "$f bytecode: allocations [$(echo "$bc" | grep -oE ' Create[A-Za-z]*(Context|Arguments)' | tr -d ' ' | tr '\n' ' ')], context-slot loads and stores: $(echo "$bc" | grep -cE ' (Lda|Sta)CurrentContextSlot')"
done
```
Output of `sh evalcost.sh`:
```text
plain: 1e6 calls, median of 7 runs 1.2 ms, TurboFan=true, scavenges so far: 0
withEval: 1e6 calls, median of 7 runs 16.6 ms, TurboFan=true, scavenges so far: 1084
plain bytecode: allocations [], context-slot loads and stores: 0
withEval bytecode: allocations [CreateFunctionContext CreateUnmappedArguments ], context-slot loads and stores: 15
```
</details>

<details><summary>Lab: proxy-in-hot-loop and the object-literal getter (access.mjs). One `o.a` read per step, 10,000 steps per call, 1,000 calls per run</summary>

```js
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
function bench(label, f, o) {
  for (let i = 0; i < 5000; i++) f(o); // warm-up
  const t = [];
  for (let r = 0; r < 7; r++) { const t0 = process.hrtime.bigint(); for (let i = 0; i < 1000; i++) f(o); t.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  console.log(`${label}: median of 7 runs ${median(t).toFixed(1)} ms, reader TurboFan=${!!(%GetOptimizationStatus(f) & 64)}`);
}
const reader = (tag) => new Function('o', `/* ${tag} */ let s = 0; for (let i = 0; i < 1e4; i++) s += o.a; return s;`);
class C { constructor() { this._a = 1; } get a() { return this._a; } }
const literal = { _a: 1, get a() { return this._a; } };
console.log('fast properties: class instance', %HasFastProperties(new C()), '| object literal with a getter', %HasFastProperties(literal));
bench('plain data property', reader(1), { a: 1 });
bench('getter on a class', reader(2), new C());
bench('getter in an object literal', reader(3), literal);
bench('Proxy with a get trap', reader(4), new Proxy({ a: 1 }, { get: (t, k) => t[k] }));
```
Output of `node --allow-natives-syntax access.mjs`:
```text
fast properties: class instance true | object literal with a getter false
plain data property: median of 7 runs 3.8 ms, reader TurboFan=true
getter on a class: median of 7 runs 3.7 ms, reader TurboFan=true
getter in an object literal: median of 7 runs 122.2 ms, reader TurboFan=true
Proxy with a get trap: median of 7 runs 148.9 ms, reader TurboFan=true
```
</details>

<details><summary>Lab: for-in-over-array (loops.mjs). Sum a 10,000-element array, 1,000 calls per run, one function per loop</summary>

```js
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const arr = Array.from({ length: 1e4 }, (_, i) => i & 1023);
const loops = {
  'for (let i = 0; ...)': (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; },
  'for...of': (a) => { let s = 0; for (const v of a) s += v; return s; },
  'forEach': (a) => { let s = 0; a.forEach((v) => { s += v; }); return s; },
  'for...in': (a) => { let s = 0; for (const k in a) s += a[k]; return s; },
};
for (const [label, f] of Object.entries(loops)) {
  for (let i = 0; i < 5000; i++) f(arr); // warm-up
  const t = [];
  for (let r = 0; r < 7; r++) { const t0 = process.hrtime.bigint(); for (let i = 0; i < 1000; i++) f(arr); t.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  console.log(`${label}: median of 7 runs ${median(t).toFixed(1)} ms, TurboFan=${!!(%GetOptimizationStatus(f) & 64)}`);
}
for (const k in [7]) console.log('for...in key:', JSON.stringify(k), typeof k);
```
Output of `node --allow-natives-syntax loops.mjs`:
```text
for (let i = 0; ...): median of 7 runs 5.0 ms, TurboFan=true
for...of: median of 7 runs 5.9 ms, TurboFan=true
forEach: median of 7 runs 25.7 ms, TurboFan=true
for...in: median of 7 runs 153.7 ms, TurboFan=true
for...in key: "0" string
```
</details>

**Prototype changes**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `builtin-prototype-patching` | Writes to built-in prototypes anywhere in the process: `Array.prototype.x = …`, `Object.prototype[k] = …`, `Array.prototype[Symbol.iterator] = …`, `Object.defineProperty(Array.prototype, …)`, `Array.prototype.constructor = …`, a `Symbol.species` override; polyfills applied without a feature check; test, monitoring or legacy libraries that patch built-ins | Do not patch: use helper functions or a subclass; polyfill only what the engine lacks, which MDN gives as the only good reason to extend a built-in prototype (to backport features of newer engines) ✅[^mdn-protochain] | One line, process-wide: a protector flips to false and every later call of the affected built-ins takes a slower path. In the lab, writing `Array.prototype.constructor` (even the same value) flipped the species protector and `a.slice()` went from 3.7 to 6.0 ms up to 236.5 to 259.8 ms; patching the array iterator flipped the iterator protector and `[...a]` went from 4.0 to 4.7 ms up to 159.0 to 166.6 ms; `Object.prototype[0] = …` flipped the no-elements protector and `a.map(f)` went from 59.4 to 70.8 ms up to 590 to 959 ms (10,000 elements, 1,000 calls), all ranges over four runs, measured here ✅[^lab] | In a test that loads the whole app: `%ArraySpeciesProtector()`, `%ArrayIteratorProtector()` and `%NoElementsProtector()` with `--allow-natives-syntax` all print `true` ✅[^lab] |
| `prototype-set-per-object` | `Object.setPrototypeOf(obj, proto)`, `obj.__proto__ = proto` or a `{ __proto__: proto, … }` literal in a factory, a `map` callback or a deserializer that revives class instances from `JSON.parse` | `class` plus `new`, or `Object.create(proto)` then assign the fields; MDN advises `Object.create()` over setting `[[Prototype]]` ✅[^mdn-setproto] | Per object a prototype change → a plain allocation. MDN calls changing `[[Prototype]]` a very slow operation in every engine ✅[^mdn-setproto]; in the lab, building 10⁶ objects took 74.0 to 79.3 ms with `setPrototypeOf` and 66.6 to 75.6 ms with a `__proto__` literal, against 2.7 to 2.9 ms with a class and 3.4 to 4.1 ms with `Object.create`, and in all four ways two objects shared one map (later reads were not timed) ✅[^lab] | Allocation-path CPU profile: no prototype-setting runtime frames after the fix; the creation loop scales like the class version |

<details><summary>Lab: builtin-prototype-patching (protect.mjs). Run once per patch: `<none|species|iterator|elements>`</summary>

```js
const patch = process.argv[2];
if (patch === 'species') Array.prototype.constructor = Array; // same value, still a write
if (patch === 'iterator') { const it = Array.prototype[Symbol.iterator]; Array.prototype[Symbol.iterator] = function () { return it.call(this); }; }
if (patch === 'elements') Object.prototype[0] = 'x';
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const arr = Array.from({ length: 1e4 }, (_, i) => i);
const ops = { 'spread [...a]': (a) => [...a].length, 'a.map(f)': (a) => a.map((x) => x + 1).length, 'a.slice()': (a) => a.slice().length };
const out = [];
for (const [label, f] of Object.entries(ops)) {
  for (let i = 0; i < 3000; i++) f(arr);
  const t = [];
  for (let r = 0; r < 7; r++) { const t0 = process.hrtime.bigint(); for (let i = 0; i < 1000; i++) f(arr); t.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  out.push(`${label} ${median(t).toFixed(1)} ms`);
}
console.log(`patch=${patch}: protectors species=${%ArraySpeciesProtector()} iterator=${%ArrayIteratorProtector()} noElements=${%NoElementsProtector()} | medians of 7 runs: ${out.join(', ')}`);
```
Output of `sh -c 'for p in none species iterator elements; do node --allow-natives-syntax protect.mjs $p; done'`:
```text
patch=none: protectors species=true iterator=true noElements=true | medians of 7 runs: spread [...a] 4.7 ms, a.map(f) 63.4 ms, a.slice() 4.1 ms
patch=species: protectors species=false iterator=true noElements=true | medians of 7 runs: spread [...a] 3.9 ms, a.map(f) 258.1 ms, a.slice() 236.5 ms
patch=iterator: protectors species=true iterator=false noElements=true | medians of 7 runs: spread [...a] 166.6 ms, a.map(f) 58.1 ms, a.slice() 1.8 ms
patch=elements: protectors species=true iterator=true noElements=false | medians of 7 runs: spread [...a] 159.7 ms, a.map(f) 589.9 ms, a.slice() 627.4 ms
```
</details>

<details><summary>Lab: prototype-set-per-object (setproto.mjs). Build 10⁶ objects that inherit `getX()` four ways, then compare maps</summary>

```js
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
class Point { constructor(x) { this.x = x; } getX() { return this.x; } }
const proto = { getX() { return this.x; } };
function viaClass(n) { let o; for (let i = 0; i < n; i++) o = new Point(i); return o; }
function viaLiteral(n) { let o; for (let i = 0; i < n; i++) o = { __proto__: proto, x: i }; return o; }
function viaCreate(n) { let o; for (let i = 0; i < n; i++) { o = Object.create(proto); o.x = i; } return o; }
function viaSetPrototypeOf(n) { let o; for (let i = 0; i < n; i++) o = Object.setPrototypeOf({ x: i }, proto); return o; }
for (const f of [viaClass, viaLiteral, viaCreate, viaSetPrototypeOf]) {
  for (let i = 0; i < 200; i++) f(1e4); // warm-up
  const t = [];
  for (let r = 0; r < 7; r++) { const t0 = process.hrtime.bigint(); f(1e6); t.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  console.log(`${f.name}: 1e6 objects, median of 7 runs ${median(t).toFixed(1)} ms, two objects share a map: ${%HaveSameMap(f(1), f(1))}`);
}
```
Output of `node --allow-natives-syntax setproto.mjs`:
```text
viaClass: 1e6 objects, median of 7 runs 2.7 ms, two objects share a map: true
viaLiteral: 1e6 objects, median of 7 runs 68.4 ms, two objects share a map: true
viaCreate: 1e6 objects, median of 7 runs 3.7 ms, two objects share a map: true
viaSetPrototypeOf: 1e6 objects, median of 7 runs 76.1 ms, two objects share a map: true
```
</details>

## Lookup notes
- **Sizes decide.** On V8 13.6 the flag defaults `--invocation-count-for-maglev=400` and `--invocation-count-for-turbofan=3000` (the source sets Maglev to 1000 on Android) ✅[^v8-flags] ✅[^lab]; tier-up also depends on feedback and budgets that no run here measured. Code that runs a few times per process (start-up, configuration, a CLI command) never reaches those tiers, so none of these classes is a finding there.
- **Not a problem when.**

| Class | Not a problem when |
|---|---|
| `megamorphic-access-site` | The helper is not hot (an admin page, start-up); the loop body does far more work than the read (I/O, a regex). 2 to 4 shapes stay polymorphic, not megamorphic, but 4 shapes still cost more than one in the lab (45.2 to 54.4 against 10.3 to 11.7 ms) ✅[^lab] |
| `type-unstable-site` | The second type arrives once at start-up and never again on the hot path; the value is legitimately a double (money in floating point, ratios): doubles throughout are one type |
| `oversized-function` | The function runs once (a module body, generated start-up code); it is hot only in small helpers it calls, which are compiled on their own |
| `direct-eval-scope` | The function is called a handful of times (a REPL, a build script); the eval is indirect, which runs in the global scope and does not read local variables ✅[^mdn-eval] |
| `proxy-in-hot-loop` | The proxy is read a few times per request (a config object, a handler at the boundary); the loop is over a short list; the framework needs the tracking for correctness, as in a Vue template that must re-render on change |
| `for-in-over-array` | The target is a plain object used as a record with own data properties, where `for…in` lists its keys; the array has a handful of elements |
| `builtin-prototype-patching` | Rarely, because the effect is process-wide and lasts: the accepted case is a polyfill for a feature the engine lacks ✅[^mdn-protochain], loaded only on such engines; a short-lived script that does little array work |
| `prototype-set-per-object` | A few objects are built (one prototype set at start-up); objects are revived once per process, not per request |

- **Belongs to an existing class.**
  - An object literal with a getter or setter (`{ _a: 1, get a() { … } }`) is in dictionary mode on V8 13.6 (`%HasFastProperties` false), and reading its getter 10⁷ times took 122.2 to 122.8 ms against 3.5 to 4.1 ms for a getter on a class, in three runs measured here ✅[^lab] → `object-shape-instability` (language-runtimes catalog): a new signal for "dictionary properties"; fix with a class or one shared prototype.
  - Two to four shapes at a site from construction order, conditional fields or `delete` → `object-shape-instability`; `megamorphic-access-site` is for many shapes that are each stable. Reads past `arr.length` and arrays mixing small integers, doubles and objects → `object-shape-instability`.
  - Closures or `bind` created per iteration and kept → `allocation-gc` (`problem-classes.md`); a regex, formatter or `new Function(sameSource)` built per call → `hot-path-constants` or `caching-recomputation` (`problem-classes.md`).
  - Arrays of `{x, y}` objects for numeric work, where typed arrays per field fit → `data-layout-locality` (`problem-classes.md`).
  - `arguments` passed on or written in sloppy mode: no class. The lab shows TurboFan still compiles such functions ✅[^lab]; spreading a large `arguments` or array into a call → `spread-args-unbounded` (`problem-classes-javascript-language.md`).
- **Corrections found while checking the sources (2026-11-26).**
  - Older advice says that `try`/`catch`, `arguments`, `eval`, `with`, `for…in` and closures stop a function from being optimized. On V8 13.6 TurboFan compiled every one of them ✅[^lab]. The cost of `eval` and `with` today is per-call allocation and context access (`direct-eval-scope`), not a refusal to optimize; MDN still says `with` "makes optimization impossible" ✅[^mdn-with], which the lab contradicts for V8 13.6 (TurboFan compiled the `with` function in the one-function run).
  - `const` against `let`: identical bytecode for the same function on V8 13.6 ✅[^lab]. Not a performance choice.
  - `forEach` against `for`: on this shape (a closure that adds to a captured `s`), `forEach` took 25.7 ms in all three runs against 5.0 to 5.3 ms for numeric `for`, while `for…of` took 5.9 to 6.8 ms, measured here ✅[^lab]. The old advice is partly true; it is not a class because the cost is a constant factor per element and the fix is a style choice. The gap seen here includes warm-up: a longer run of the same comparison found `forEach` about 1.8 to 1.9 times slower than `for` once the whole function was TurboFan code ([v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md)).
  - MDN says a `__proto__` key in an object literal is "optimized, and can even be more performant than `Object.create`" ✅[^mdn-protochain]. In the lab function, with the prototype held in a variable, the literal took 66.6 to 75.6 ms per 10⁶ objects, about the cost of `setPrototypeOf` and 16 to 22 times `Object.create` ✅[^lab]; this is one shape on V8 13.6, and the MDN sentence is not tested for other forms.
  - A getter is cheap on a class (about the cost of a data property in the lab) but not in an object literal (dictionary mode) ✅[^lab]: "getters are slow" and "getters are free" are both wrong as general rules.
  - Per the V8 blog post of 5 October 2017, the proxy path made at least 4 jumps between the C++ and JavaScript runtimes before a port to CodeStubAssembler ✅[^v8-proxies]; that post is old, and the lab cost above is what V8 13.6 shows.
- **What the sources do not say.**
  - The polymorphic limit is the macro `DEFAULT_MAX_POLYMORPHIC_MAP_COUNT 4` in the V8 13.6.233.17 source ✅[^v8-flags], and the Node.js 24.22.1 binary prints the same default ✅[^lab]. No V8 docs page states it, and no run here tried a build with another value.
  - No official page gives a cost per `Proxy` trap, per deopt or per protector; every number here is a lab median on one machine.
  - V8 flags and natives used in the checks may change in any Node.js release ✅[^node-cli].
  - The lab timing of a 2,900-statement against a 3,000-statement function under normal tier-up was not stable from run to run (the tier reached varied), so the doc states only the forced-compile result for `oversized-function`.

<details><summary>Lab: corrections (status.js, constlet.js, constlet.sh). Sloppy-mode script; each function is warmed up, then compiled with TurboFan on its next call</summary>

```js
function check(name, f, ...args) {
  %PrepareFunctionForOptimization(f); f(...args); f(...args);
  %OptimizeFunctionOnNextCall(f); f(...args);
  console.log(`${name}: TurboFan=${!!(%GetOptimizationStatus(f) & 64)}`);
}
check('try/catch', function (o) { try { return o.a + 1; } catch (e) { return 0; } }, { a: 1 });
check('arguments passed to slice', function () { return Array.prototype.slice.call(arguments); }, 1, 2);
check('arguments[0] written (sloppy)', function (a) { arguments[0] = 2; return a; }, 1);
check('direct eval', function (x) { return eval('x + 1'); }, 1);
check('with', function (o) { with (o) { return a + 1; } }, { a: 1 });
check('for...in over an array', function (a) { let s = 0; for (const k in a) s += a[k]; return s; }, [1, 2, 3]);
check('forEach with a closure', function (a) { let s = 0; a.forEach((v) => { s += v; }); return s; }, [1, 2, 3]);
check('Proxy get', function (p) { return p.a; }, new Proxy({ a: 1 }, { get: (t, k) => t[k] }));
```
```js
function withLet(a) { let k = 3; let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * k; return s; }
function withConst(a) { const k = 3; let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * k; return s; }
withLet([1, 2]); withConst([1, 2]);
```
```sh
for f in withLet withConst; do
  node --print-bytecode --print-bytecode-filter=$f constlet.js | grep -E '@ +[0-9]+ :' | sed -E 's/.*@ +[0-9]+ : [0-9a-f ]+//; s/\(0x[0-9a-f]+ @ [0-9]+\)//' > /tmp/$f.txt
  echo "$f: $(wc -l < /tmp/$f.txt) bytecodes"
done
cmp -s /tmp/withLet.txt /tmp/withConst.txt && echo "bytecode identical" || echo "bytecode differs"
```
Output of `node --allow-natives-syntax status.js; sh constlet.sh`:
```text
try/catch: TurboFan=true
arguments passed to slice: TurboFan=true
arguments[0] written (sloppy): TurboFan=true
direct eval: TurboFan=true
with: TurboFan=true
for...in over an array: TurboFan=true
forEach with a closure: TurboFan=true
Proxy get: TurboFan=true
withLet: 23 bytecodes
withConst: 23 bytecodes
bytecode identical
```
</details>

**Calibration state (2026-11-26).** Each class of this catalog has one known-bad sample in round 3 of the review-agent calibration, and some of its "Not a problem when" rows have a trap sample. In that round (one run per arm) the agent with the skill filed all 96 planted problems of the thirteen domain catalogs under the right class id, and without the skill 86 of them. Results per catalog, and the limits of the round: [perf-reviewer-calibration.md](perf-reviewer-calibration.md) §6.5.

## Takeaways
- A read site on a hot path should see one object shape, and never more than 4, and each value site one type; check with `--log-ic` and `--trace-deopt`, not by reading code. [rule-candidate]
- Flag any write to a built-in prototype and any per-object `setPrototypeOf` or `__proto__`: one line can slow every array operation in the process. [rule-candidate]
- Folklore about `try`/`catch`, `arguments`, `const` and closures blocking optimization is out of date for V8 13.6; ask for a lab run or a profile before accepting such a change.

## Verification status
- Verified: 61 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-26

## References
- Lab run — Docker image `node:24.22.1-alpine` (Node.js v24.22.1, V8 13.6.233.17-node.58, linux arm64, pointer compression off, Maglev on) on Apple M2, `--network none`, 2026-11-26; scripts and outputs are in the `<details>` blocks of this doc. No other V8 version, architecture or build was run. Rank 1 (primary measurement). Backs: Catalog, all classes; Lookup notes. [^lab]
- [V8 src/runtime/runtime.h, OptimizationStatus](https://github.com/v8/v8/blob/13.6.233.17/src/runtime/runtime.h) — V8 project, tag 13.6.233.17. Rank 1. Backs: Scope, terms. [^v8-runtime]
- [V8 src/ic/ic.cc, TransitionMarkFromState](https://github.com/v8/v8/blob/13.6.233.17/src/ic/ic.cc) — V8 project, tag 13.6.233.17. Rank 1. Backs: Scope, terms. [^v8-ic]
- [V8 src/flags/flag-definitions.h](https://github.com/v8/v8/blob/13.6.233.17/src/flags/flag-definitions.h) — V8 project, tag 13.6.233.17. Rank 1. Backs: Catalog, megamorphic-access-site, oversized-function; Lookup notes. [^v8-flags]
- [Command-line API: V8 options](https://nodejs.org/docs/latest-v24.x/api/cli.html) — Node.js, v24.x. Rank 1. Backs: Scope; Lookup notes. [^node-cli]
- [Reactivity API: Advanced (toRaw, markRaw)](https://vuejs.org/api/reactivity-advanced.html) — Vue, Vue 3, living. Rank 1. Backs: Catalog, proxy-in-hot-loop. [^vue-raw]
- [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) — MDN, living. Rank 3. Backs: Catalog, proxy-in-hot-loop. [^mdn-proxy]
- [for...in](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...in) — MDN, living. Rank 3. Backs: Catalog, for-in-over-array. [^mdn-forin]
- [eval()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval) — MDN, living. Rank 3. Backs: Catalog, direct-eval-scope; Lookup notes. [^mdn-eval]
- [with](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/with) — MDN, living. Rank 3. Backs: Catalog, direct-eval-scope; Lookup notes, corrections. [^mdn-with]
- [Object.setPrototypeOf()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/setPrototypeOf) — MDN, living. Rank 3. Backs: Catalog, prototype-set-per-object. [^mdn-setproto]
- [Inheritance and the prototype chain](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Inheritance_and_the_prototype_chain) — MDN, living. Rank 3. Backs: Catalog, builtin-prototype-patching; Lookup notes, corrections. [^mdn-protochain]
- [Math.imul()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/imul) — MDN, living. Rank 3. Backs: Catalog, type-unstable-site. [^mdn-imul]
- [Optimizing ES2015 proxies in V8](https://v8.dev/blog/optimizing-proxies) — V8 team, 2017. Rank 4. Backs: Lookup notes, corrections. [^v8-proxies]

## Related
- [problem-classes.md](problem-classes.md) — the first catalog of 39 classes; several shapes found here belong to its classes.
- [perf-reviewer-calibration.md](perf-reviewer-calibration.md) — the review agent built on these catalogs, and how it scored.
- [problem-classes-language-runtimes.md](problem-classes-language-runtimes.md) — `object-shape-instability` and the other runtime-hidden costs.
- [problem-classes-javascript-language.md](problem-classes-javascript-language.md) — JavaScript and TypeScript language and built-in patterns.
- [../../js-runtime/v8-hidden-classes.md](../../js-runtime/v8-hidden-classes.md) — how V8 shapes and inline caches work.
- [../../js-runtime/v8-compiler-pipeline-deep-dive.md](../../js-runtime/v8-compiler-pipeline-deep-dive.md) — Ignition, Sparkplug, Maglev, TurboFan and deoptimization.
- [../../js-runtime/v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md) — Smis, heap numbers, elements kinds and dictionary mode.
- [../../javascript/prototypes/prototypal-inheritance.md](../../javascript/prototypes/prototypal-inheritance.md) — the prototype chain, `Object.create` and `setPrototypeOf`.
