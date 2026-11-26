---
schema: deep-dive/v1
topic: js-runtime
status: verified
applies-to: ["Node.js 24.22.1 with V8 13.6.233.17-node.58, image node:24.22.1-alpine, arm64 Docker VM with 8 CPUs and 8 GiB of memory, no container memory limit", "Node.js documentation for v24.22.3; ECMAScript 2027 draft; V8 source at tag 13.6.233.17", "lab runs of 2026-11-26"]
last-updated: 2026-11-26
last-verified: 2026-11-26
synthesized-into: []
tags: [v8, nodejs, garbage-collection, scavenger, mark-compact, orinoco, heap, memory-leak, closures, weakref, finalizationregistry, weakmap, external-memory, startup, lazy-parsing, code-cache, startup-snapshot, compile-cache]
ranked-sources: true
---

# V8 memory management and startup in Node.js 24: the garbage collector, what keeps memory alive, and getting code ready to run

## Summary
**TL;DR:** V8 splits its heap into a small young generation, cleaned often by a copying collector (the scavenger), and an old generation, cleaned less often by mark-compact, with most marking done off the main thread. An object reaches the old generation after surviving two scavenges ✅[^lab]. Memory stays alive as long as something reachable points to it, and in this build that includes some surprising paths: a closure's shared context, a 13-character-or-longer `slice()` of a big string, timers and listeners, and a `WeakMap` value until a full collection ✅[^lab]. At startup, V8 only pre-parses most functions and compiles them on first call; a parenthesized function is compiled at once (in one test, a file loaded about twice as slowly when 1 % of its functions ran, measured here on Node.js 24.22.1); a `vm.Script` code cache, a startup snapshot or the Node.js module compile cache reuse earlier work ✅[^lab]. Two results correct common beliefs, each measured here on Node.js 24.22.1 under the conditions given in §3.10 and §4.5: `vm.Script` accepted a code cache whose source had the same length, and then ran the old code; and raising `--max-semi-space-size` changed nothing for a loop whose garbage dies at once ✅[^lab].

**Use this when:**
- you read `--trace-gc` output or `process.memoryUsage()` and want to know what each number means;
- you hunt a memory leak in Node.js and want to know which code shapes keep memory alive;
- you decide whether to tune `--max-semi-space-size` or `--max-old-space-size`, or to call `global.gc()`;
- you use `WeakMap`, `WeakRef` or `FinalizationRegistry` and need to know what they promise;
- you want a Node.js program or a tool to start faster: lazy compilation, parenthesized functions, `vm.Script` cached data, `--build-snapshot`, `module.enableCompileCache()`.

**Depth:** the heap's spaces in this build; the scavenger and promotion; mark-compact; parallel, incremental, concurrent and idle-time work (the Orinoco project); every field of a `--trace-gc` line; write barriers; allocation-site pretenuring; heap-limit flags and how they add up; external memory; what keeps memory alive, each with a measured example; what the ECMAScript specification does not promise about weak references; the scanner, the preparser and lazy compilation; eager-compilation hints; the code cache; startup snapshots; the module compile cache; twelve corrections of popular advice. Every claim about this build is checked by a script whose code and output are embedded. Compiler tiers and deoptimization are in `v8-compiler-pipeline-deep-dive.md`; how objects, arrays and strings are laid out is in `v8-object-and-value-representation-deep-dive.md`.

## 1. Mental model

**Two ideas carry the whole doc.**

1. **Memory is freed by reachability, in generations.** The collector keeps what can be reached from the roots (the stack, globals, handles held by Node.js) and frees the rest; [objects-references-and-this.md](../javascript/object-basics/objects-references-and-this.md) explains reachability itself. V8 adds a bet on age: most objects die young ✅[^trash], so new objects go to a small area that is cleaned often and cheaply, and only objects that keep surviving move to the large area that is cleaned rarely.
2. **Startup is work that can be skipped or reused.** V8 does not compile a function until it is called ✅[^lab]. What it did compile can be saved and reused: as a code cache (bytecode for one script), as a startup snapshot (a whole heap after your setup code ran), or as Node.js's on-disk compile cache ✅[^nodevm][^nodev8][^nodemodule].

**Analogy.** The young generation is the in-tray on a desk: new papers land there, and every so often you sweep it, keeping only the few papers still needed by moving them to a second tray. A paper kept twice goes to the filing cabinet (the old generation). The cabinet is tidied rarely, and mostly by an assistant working in the background while you keep working.

### Words first

| Term | Plain meaning | Analogy | Concrete example (this build) |
|---|---|---|---|
| Heap | The memory where V8 stores JavaScript objects | A warehouse | `v8.getHeapSpaceStatistics()` lists 13 spaces (§3.1) |
| GC (garbage collection) | Finding objects nothing can reach any more and reusing their memory | Throwing away mail nobody will read | `--trace-gc` prints one line per collection |
| Mutator | The program itself, which changes ("mutates") the object graph while the GC works | The office staff who keep adding papers while the cleaner works | `current mu = 0.702` means JavaScript ran 70.2 % of the time since the last major GC (§3.3) |
| Young generation (new space) | The small area where new objects are allocated | The in-tray | `new_space` used 546 KB at startup (§3.1) |
| Semi-space | One of the two halves of the young generation; the scavenger copies survivors from one half to the other | Two in-trays: sort from the full one into the empty one | With `--max-semi-space-size=1` the new space stayed at 2 MiB (§4.5) |
| Scavenge (minor GC) | The young-generation collection: copy the live objects out, drop the rest in one go | Moving the few papers you keep, then emptying the tray | `Scavenge 8.4 (13.1) -> 4.8 (13.6) MB` (§3.3) |
| Promotion | Moving an object that survived two scavenges into the old generation | Filing a paper that was kept twice | `young=false` after the second scavenge (§3.2) |
| Old generation (old space) | The large area for long-lived objects | The filing cabinet | `old_space` grew by 627 KB when 20,000 objects were promoted (§3.2) |
| Mark-compact (major GC) | The old-generation collection: mark what is reachable, sweep the rest, sometimes move objects together | A full office clean-up with defragmenting of shelves | `Mark-Compact 53.3 (74.0) -> 46.9 (112.0) MB` (§3.3) |
| Pause | Time the main thread is stopped for GC | The office closed while the cleaner works | `22.67 / 0.00 ms` in a `--trace-gc` line |
| Parallel / incremental / concurrent GC | Helper threads work during a pause / the main thread does small slices between JavaScript / helper threads work while JavaScript runs ✅[^trash] | Several cleaners at once / cleaning one drawer between tasks / a cleaner working beside you | `(+ 0.0 ms in 11 steps since start of marking ...)` (§3.3) |
| Write barrier | A few instructions V8 adds to every pointer store so the GC learns about the new pointer | A note left on the cabinet: "this file now points to a paper in the in-tray" | `holder.key = {}` stores a pointer and runs the barrier (§3.5) |
| Allocation site, memento | The place in code that creates objects, and a small tag V8 attaches to new objects to remember that place ✅[^memento] | A return address on each parcel | `AllocationSite(0x122eae39d9)` in `--trace-pretenuring-statistics` (§3.6) |
| Pretenuring | Allocating straight into the old generation when a site's objects almost always survive | Filing a paper directly when you know you keep that kind | `maybe tenure => tenure` (§3.6) |
| Large object space | A separate space for objects too big to copy cheaply | A pallet stored on the floor, not on a shelf | A 2,000,000-element array went to `new_large_object_space` (+15,625 KB) (§3.1) |
| External memory | Memory outside the V8 heap that a JavaScript object owns | A storage unit across town, rented by a paper in the cabinet | `new ArrayBuffer(64 MiB)`: `external +64`, `heapUsed 0` (§3.8) |
| RSS (resident set size) | The process memory actually held in RAM | The floor space the warehouse really occupies | An untouched 64 MiB `ArrayBuffer` added 0 MiB of RSS (§3.8) |
| Context (closure context) | A heap object holding the variables a closure captures; all closures of one scope share it | One shared locker for a whole team | 10 tiny closures kept 76.3 MiB alive (§4.1) |
| Sliced string | A string that points into a bigger parent string instead of copying ✅[^strh] | A bookmark that keeps the whole book on the shelf | A 20-character slice kept a 16 MiB string alive (§4.3) |
| `WeakMap`, `WeakRef`, `FinalizationRegistry` | A map whose keys do not keep values alive; a reference that does not keep its target alive; a callback request for after a target is collected | A coat-check ticket that becomes void if the coat is thrown away; a note "tell me when it is gone" | `deref()` turned `undefined` only after a GC in a later job (§4.4) |
| Scanner, parser | The scanner turns source text into tokens; the parser builds a syntax tree from them | Reading letters into words, then words into sentences | `function plain() { return 1; }` |
| Preparsing (lazy parsing) | A quick pass that checks a function's syntax and notes which outer variables it uses, without building its tree ✅[^preparse] | Skimming a chapter to see who it mentions, without reading it | `plain  preparse-resolution -> full-parse -> ...` (§3.9) |
| Lazy compilation | Turning a function into bytecode only when it is first called | Cooking a dish only when ordered | `neverCalled  preparse-resolution` and nothing else (§3.9) |
| PIFE (parenthesized function expression) | `(function () { ... })`; V8 guesses it is called at once and compiles it eagerly ✅[^preparse] | A dish ordered with the table booking | `wrapped  full-parse -> interpreter` (§3.9) |
| Bytecode | The compact instructions V8's interpreter runs | A recipe card | What a code cache stores |
| Code cache | Serialized bytecode of one script, reused to skip compiling | A stack of pre-written recipe cards | 2,516,608 bytes for a 3,000-function script (§4.7) |
| Startup snapshot | A serialized heap after setup code ran, loaded instead of running that code again | A photo of the set table, rebuilt instantly | An 8.5 MiB blob; start took 20.1 ms instead of 187.4 ms (§4.8) |
| Module compile cache | Node.js's on-disk code cache for every module it loads ✅[^nodemodule] | A shared recipe-card cabinet in the kitchen | `module.enableCompileCache('/tmp/ncc')` (§4.9) |

## 2. Concept architecture

**The heap, by space.** New objects go to the young generation (`new_space`), or to `new_large_object_space` when they are big; survivors move to `old_space` (or `large_object_space`); compiled machine code lives in `code_space`; `read_only_space` and the `trusted_*` and `shared_*` spaces hold V8's own data ✅[^lab]. Memory outside the heap that objects own (`ArrayBuffer` and `Buffer` contents) is "external" ✅[^nodeproc].

**The collectors.**

| Collector | Cleans | How | Threads in this build |
|---|---|---|---|
| Scavenger (minor GC) | young generation | copies survivors between two semi-spaces; promotes objects that survive twice ✅[^trash][^scav] | parallel: helper threads during the pause ✅[^trash]; `--parallel-scavenge` is on by default ✅[^lab] |
| Mark-compact (major GC) | whole heap | marks reachable objects, sweeps the rest, compacts some pages ✅[^trash] | marking starts incrementally and runs concurrently ✅[^cmark]; `--incremental-marking`, `--concurrent-marking`, `--concurrent-sweeping` and `--parallel-compaction` are on by default ✅[^lab] |

Orinoco is the code name of the V8 project that made these collectors parallel, incremental and concurrent ✅[^trash]. `--minor-ms` (a mark-sweep young-generation collector) exists in this build but is off by default ✅[^lab].

**What keeps memory alive** (§4): anything reachable from a root. The paths a developer creates without seeing them are closure contexts, timers and event listeners, sliced strings, and `WeakMap` values whose key is still waiting for a major GC ✅[^lab].

**Startup pipeline** (§3.9 to §3.12): source text → scanner → parser, which pre-parses most functions → bytecode for the top-level code and for eagerly compiled functions → run; every other function is compiled on its first call ✅[^lab]. Three caches can skip part of this: the `vm.Script` code cache, Node.js's module compile cache, and a startup snapshot that also skips running the setup code ✅[^nodevm][^nodemodule][^nodev8]. What happens after bytecode (the Sparkplug, Maglev and TurboFan tiers) is in [v8-compiler-pipeline-deep-dive.md](v8-compiler-pipeline-deep-dive.md).

## 3. How it works

All lab scripts in this doc ran with this command, from the folder holding the script, with the flags shown in each output block ✅[^lab]:

```sh
docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node [flags] <script>.mjs
```

Each script prints its Node.js and V8 versions first. The machine is a Docker VM on Apple silicon (arm64) with 8 CPUs and 8 GiB of memory and no container memory limit; heap limits and default sizes below depend on that.

### 3.1 The heap's spaces in this build

`v8.getHeapSpaceStatistics()` lists 13 spaces in Node.js 24.22.1. A thousand small objects land in `new_space`; one 2,000,000-element array (about 15 MiB) lands directly in `new_large_object_space` ✅[^lab]. The Node.js docs warn that neither the order nor the presence of a space is guaranteed from one V8 version to the next ✅[^nodev8], so code should look a space up by name and tolerate its absence.

<details><summary>Lab: spaces.mjs</summary>

```js
import v8 from 'node:v8';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const used = () => Object.fromEntries(v8.getHeapSpaceStatistics().map((s) => [s.space_name, s.space_used_size]));
const before = used();
const small = Array.from({ length: 1000 }, (_, i) => ({ i }));   // many small objects
const big = new Array(2_000_000).fill(0);                         // one 15 MiB object
const after = used();
console.log('space name                         used KB   change after allocating');
for (const name of Object.keys(after))
  console.log(`${name.padEnd(34)} ${String(Math.round(after[name] / 1024)).padStart(7)}   ${String(Math.round((after[name] - before[name]) / 1024)).padStart(6)}`);
console.log(`heap_size_limit: ${Math.round(v8.getHeapStatistics().heap_size_limit / 2 ** 20)} MiB (kept ${small.length} + ${big.length})`);
```

```text
$ node spaces.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
space name                         used KB   change after allocating
read_only_space                          0        0
new_space                              546       61
old_space                             2911        3
code_space                              25        0
shared_space                             0        0
trusted_space                          780        1
shared_trusted_space                     0        0
new_large_object_space               15625    15625
large_object_space                     256        0
code_large_object_space                  0        0
shared_large_object_space                0        0
shared_trusted_large_object_space        0        0
trusted_large_object_space               0        0
heap_size_limit: 2240 MiB (kept 1000 + 2000000)
```
</details>

### 3.2 The young generation, the scavenger and promotion

**What the engine does.** New objects are allocated in the young generation, which uses a semi-space design ✅[^trash]. A scavenge copies the live objects from the full half ("From-Space") into the empty half ("To-Space") ✅[^trash]. An object that survives one scavenge is copied into the intermediate generation, and one that survives another is moved into the old generation ✅[^scav]. Dead objects cost nothing: they are simply not copied. Helper threads share the copying through a global work list ✅[^scav].

**Why it helps.** The cost of a scavenge follows the number of survivors, not the amount allocated, and most objects die young ✅[^trash]. Short-lived temporaries are therefore cheap, as long as they do die.

**See it yourself.** `%InYoungGeneration(obj)` (with `--allow-natives-syntax`) and `gc({ type: 'minor' })` (with `--expose-gc`) show promotion directly. `gc()` with no argument runs a major, synchronous GC; `{ type: 'minor' }` asks for a minor one ✅[^gcext]. Here 20,000 objects held by one array were still young after the first scavenge and in the old generation after the second; `old_space` grew by 627 KB at that moment ✅[^lab].

<details><summary>Lab: promotion.mjs</summary>

```js
import v8 from 'node:v8';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const kb = (name) => Math.round(v8.getHeapSpaceStatistics().find((s) => s.space_name === name).space_used_size / 1024);
const show = (label, o) =>
  console.log(`${label.padEnd(26)} young=${%InYoungGeneration(o)}  new_space=${String(kb('new_space')).padStart(5)} KB  old_space=${String(kb('old_space')).padStart(5)} KB`);

globalThis.gc(); // start from a clean heap: a full GC empties the young generation
// 20,000 small objects held by one array (all allocated in the young generation)
const survivors = Array.from({ length: 20_000 }, (_, i) => ({ i }));
show('just allocated', survivors[0]);
globalThis.gc({ type: 'minor' });
show('after 1st scavenge', survivors[0]);
globalThis.gc({ type: 'minor' });
show('after 2nd scavenge', survivors[0]);
```

```text
$ node --expose-gc --allow-natives-syntax promotion.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
just allocated             young=true  new_space=  687 KB  old_space= 2933 KB
after 1st scavenge         young=true  new_space=  659 KB  old_space= 2934 KB
after 2nd scavenge         young=false  new_space=    1 KB  old_space= 3561 KB
```
</details>

**Since when.** The parallel scavenger was described by the V8 team on 29 November 2017 ✅[^scav]; the two-survival rule is in the 3 January 2019 overview ✅[^trash] and holds in this build ✅[^lab].

### 3.3 The old generation, mark-compact, and reading `--trace-gc`

**What the engine does.** A major GC runs in three phases: marking (finding the reachable objects), sweeping (turning the gaps into free lists) and compacting (moving objects off fragmented pages) ✅[^trash]. It covers the whole heap, so it costs more than a scavenge and runs less often.

**One `--trace-gc` line, field by field.** The format string is in `GCTracer::Print` ✅[^gctracer]. Taking the major GC that this build started on its own while a program kept 2,000,000 objects alive ✅[^lab]:

```text
[1:0xffffa0590000]       78 ms: Mark-Compact 53.3 (74.0) -> 46.9 (112.0) MB, pooled: 0 MB, 22.67 / 0.00 ms  (+ 0.0 ms in 11 steps since start of marking, biggest step 0.0 ms, walltime since start of marking 24 ms) (average mu = 0.702, current mu = 0.702) finalize incremental marking via stack guard; GC in old space requested
```

| Field | Value here | Meaning (from `gc-tracer.cc` ✅[^gctracer]) |
|---|---|---|
| `[1:0xffffa0590000]` | process 1, isolate address | process id and the V8 isolate (one per thread running JavaScript) |
| `78 ms` | | time since the isolate started |
| `Mark-Compact` | | the collector: `Scavenge` for a minor GC, `Mark-Compact` for a major one; the format can add ` (reduce)` when the GC was asked to reduce memory, and ` (interleaved)` when a young GC ran while a full GC was in progress (neither appeared in these runs) |
| `53.3 (74.0) -> 46.9 (112.0) MB` | | size of the objects on the heap when the GC started (`SizeOfObjects()`, which still includes garbage not yet freed) → when it ended; the number in parentheses is the size the memory allocator holds for heap pages, before → after. The source does not call either number "live" or "committed" |
| `pooled: 0 MB` | | memory in pooled pages: the pooled page count × the page size |
| `22.67 / 0.00 ms` | | length of this pause on the main thread / time spent in external callbacks within it (weak handles, GC prologue and epilogue callbacks) |
| `(+ 0.0 ms in 11 steps since start of marking, biggest step 0.0 ms, walltime since start of marking 24 ms)` | | only for a major GC that began with incremental marking: main-thread time in incremental steps, how many, the longest one, and the wall time from the start of marking to the end of this pause |
| `average mu = 0.702, current mu = 0.702` | | mutator utilization ("mu"): the share of the time since the previous mark-compact in which JavaScript ran, not the GC; `current` is for this cycle, `average` is `average_mutator_duration_ / average_total_duration` |
| `finalize incremental marking via stack guard` | | the reason for this GC |
| `GC in old space requested` | | the collector's own reason for picking this collector |

Reading the example: marking began 24 ms before the end of the pause (`end_time - incremental_marking_start_time`), the main thread spent 0.0 ms in its 11 incremental steps, and the 22.67 ms pause finished the work. The step figures vary: in three further runs the same script printed 12 to 19 steps and 0.1 ms, and the pause was 14.6 to 15.0 ms. The rest of the marking ran on other threads, which `--concurrent-marking` (on by default here ✅[^lab]) allows ✅[^cmark].

A forced `gc()` looks different: `Mark-Compact 5.9 (13.6) -> 4.0 (13.1) MB, ... 1.81 / 0.00 ms ... testing; GC in old space requested`, with no incremental part, because it marks the whole heap inside one pause ✅[^lab]. Scavenges in the same run print `allocation failure` as their reason ✅[^lab].

<details><summary>Lab: gc-trace.mjs (scavenges and one forced mark-compact)</summary>

```js
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
let keep = [];
// Short-lived garbage: 200,000 small objects, most dropped at once.
for (let i = 0; i < 200_000; i++) { const o = { i, s: 'item' + i }; if (i % 100 === 0) keep.push(o); }
console.log(`kept ${keep.length} objects; calling gc() for a full collection`);
globalThis.gc();
console.log('done');
```

```text
$ node --trace-gc --expose-gc gc-trace.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
[1:0xffff797a0000]       18 ms: Scavenge 4.8 (5.8) -> 4.1 (6.8) MB, pooled: 0 MB, 0.36 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffff797a0000]       19 ms: Scavenge 4.8 (6.8) -> 4.3 (7.1) MB, pooled: 0 MB, 0.46 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffff797a0000]       20 ms: Scavenge 5.1 (7.1) -> 4.5 (9.1) MB, pooled: 0 MB, 0.48 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffff797a0000]       21 ms: Scavenge 6.3 (9.1) -> 4.7 (9.1) MB, pooled: 0 MB, 0.33 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffff797a0000]       22 ms: Scavenge 6.3 (9.1) -> 4.7 (9.1) MB, pooled: 0 MB, 0.45 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffff797a0000]       23 ms: Scavenge 6.3 (9.1) -> 4.7 (9.1) MB, pooled: 0 MB, 0.32 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffff797a0000]       23 ms: Scavenge 6.3 (9.1) -> 4.8 (9.1) MB, pooled: 0 MB, 0.31 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffff797a0000]       24 ms: Scavenge 6.4 (9.1) -> 4.8 (13.1) MB, pooled: 0 MB, 0.54 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffff797a0000]       26 ms: Scavenge 8.4 (13.1) -> 4.8 (13.1) MB, pooled: 0 MB, 0.37 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffff797a0000]       27 ms: Scavenge 8.4 (13.1) -> 4.8 (13.6) MB, pooled: 0 MB, 0.36 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
kept 2000 objects; calling gc() for a full collection
[1:0xffff797a0000]       29 ms: Mark-Compact 5.9 (13.6) -> 4.0 (13.1) MB, pooled: 0 MB, 1.81 / 0.00 ms  (average mu = 0.931, current mu = 0.931) testing; GC in old space requested
done
```
</details>

<details><summary>Lab: gc-major.mjs (a mark-compact started by V8 itself)</summary>

```js
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
// Keep growing a long-lived structure so the old generation fills and V8 starts a major GC on its own.
const keep = [];
for (let round = 0; round < 40; round++) {
  const chunk = [];
  for (let i = 0; i < 50_000; i++) chunk.push({ round, i });
  keep.push(chunk);
}
console.log(`kept ${keep.length} chunks`);
```

```text
$ node --trace-gc gc-major.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
[1:0xffffa0590000]       17 ms: Scavenge 4.8 (5.8) -> 4.3 (6.8) MB, pooled: 0 MB, 0.43 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffffa0590000]       18 ms: Scavenge 4.8 (6.8) -> 4.6 (9.1) MB, pooled: 0 MB, 0.57 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffffa0590000]       20 ms: Scavenge 7.1 (9.9) -> 6.4 (13.7) MB, pooled: 0 MB, 1.51 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffffa0590000]       23 ms: Scavenge 9.7 (14.5) -> 8.8 (15.6) MB, pooled: 0 MB, 1.90 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffffa0590000]       27 ms: Scavenge 11.6 (16.4) -> 10.8 (26.2) MB, pooled: 0 MB, 2.53 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffffa0590000]       35 ms: Scavenge 19.6 (28.7) -> 17.3 (44.9) MB, pooled: 0 MB, 5.53 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffffa0590000]       48 ms: Scavenge 31.4 (48.4) -> 27.9 (52.1) MB, pooled: 0 MB, 7.22 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[1:0xffffa0590000]       78 ms: Mark-Compact 53.3 (74.0) -> 46.9 (112.0) MB, pooled: 0 MB, 22.67 / 0.00 ms  (+ 0.0 ms in 11 steps since start of marking, biggest step 0.0 ms, walltime since start of marking 24 ms) (average mu = 0.702, current mu = 0.702) finalize incremental marking via stack guard; GC in old space requested
kept 40 chunks
```
</details>

The times in these lines change from run to run; the field layout does not. `--trace-gc-verbose` adds a per-space table after each line, `--trace-gc-nvp` prints one `name=value` line per GC, and `--trace-gc-ignore-scavenger` hides scavenges ✅[^lab].

### 3.4 Parallel, incremental, concurrent and idle-time work (Orinoco)

| Technique | What it means ✅[^trash] | In this build |
|---|---|---|
| Parallel | the main thread and helper threads do about equal work at the same time, during a pause | scavenges, the marking pause (`--parallel-marking`) and compaction (`--parallel-compaction`) are parallel by default ✅[^lab] |
| Incremental | the main thread does small pieces of work between pieces of JavaScript | `--incremental-marking` on ✅[^lab]; the trace shows the steps (§3.3) |
| Concurrent | helper threads work while JavaScript keeps running | `--concurrent-marking` and `--concurrent-sweeping` on ✅[^lab] |
| Idle time | optional GC work done when the embedder reports that it is idle | described for Chrome's scheduler, which tells V8 when an idle period begins ✅[^idle] |

Concurrent marking happens mostly on worker threads while the application runs, and shipped by default in Chrome 64 and Node.js 10; the V8 team's benchmarks (11 June 2018) showed 60–70 % less marking time on the main thread ✅[^cmark]. Incremental marking splits the marking work into small chunks ✅[^cmark]. The idle-time post (7 August 2015) describes idle tasks that run "when the scheduler determines it is in an idle period" ✅[^idle]; the Node.js documentation read for this doc does not say whether Node.js reports idle periods to V8, so this doc makes no claim about idle-time GC in Node.js.

### 3.5 Write barriers, in one paragraph

A scavenge must find every old object that points into the young generation, without walking the whole old generation. V8 therefore runs a write barrier on pointer stores, which records old-to-new references ✅[^trash]; those references, kept in per-page remembered sets, are roots of the scavenge ✅[^scav]. During concurrent or incremental marking the barrier also keeps the invariant that no black (already scanned) object points to a white (not yet found) one, by marking the newly stored value ✅[^cmark]. How values are tagged as pointers or small integers is in [v8-object-and-value-representation-deep-dive.md](v8-object-and-value-representation-deep-dive.md).

### 3.6 Allocation sites and pretenuring

**What the engine does.** V8 tags new objects with an allocation memento that points back to the code that created them, and uses the share of tagged objects found alive in a scavenge to estimate the lifetime of each site's objects; one use is pretenuring, allocating a site's objects directly in the old generation ✅[^memento]. That skips copying objects that would be promoted anyway.

**See it yourself.** `--trace-pretenuring-statistics` prints the decision for each site: created and found mementos, their ratio, the threshold (0.85 here) and the state change, such as `maybe tenure => tenure` ✅[^lab]. In a loop that keeps 3,000,000 objects from one object literal, the last object allocated was already in the old generation in 10 of 10 runs; with `--no-allocation-site-pretenuring` it was young in 10 of 10 ✅[^lab]. The trace lines and their counts vary between runs, and in one of three traced runs the site was still at `maybe tenure` when the loop ended, so that run printed `young=true`; the 10-of-10 counts were the same in every pass ✅[^lab].

<details><summary>Lab: pretenure.mjs and pretenure-count.mjs</summary>

```js
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}; flags: ${process.execArgv.join(' ')}`);
// One allocation site (the object literal in makeNode) whose objects almost all survive.
const list = [];
function makeNode(i) { return { i, next: null }; }
for (let i = 0; i < 3_000_000; i++) list.push(makeNode(i));
const last = list[list.length - 1];   // allocated last, after the loop got hot and optimized
console.log(`last object pushed in the hot loop: young=${%InYoungGeneration(last)}`);
```

```js
// Runs pretenure.mjs in 10 fresh processes per setting and counts where its last object was allocated.
import { execFileSync } from 'node:child_process';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
for (const flags of [[], ['--no-allocation-site-pretenuring']]) {
  let old = 0;
  for (let i = 0; i < 10; i++) {
    const out = execFileSync(process.execPath, ['--allow-natives-syntax', ...flags, 'pretenure.mjs'], { encoding: 'utf8' });
    if (out.includes('young=false')) old++;
  }
  console.log(`${(flags.join(' ') || 'default (pretenuring on)').padEnd(34)} last object already in the old generation in ${old} of 10 runs`);
}
```

```text
$ node --allow-natives-syntax --trace-pretenuring-statistics pretenure.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64; flags: --allow-natives-syntax --trace-pretenuring-statistics
[1:0xffff8e0f0000] pretenuring: AllocationSite(0x122eae39d9): (created, found, ratio) (6658, 6658, 1.000000) undecided => maybe tenure
[1:0xffff8e0f0000] pretenuring: threshold=0.85 deopt_maybe_tenured=0 visited_sites=1 active_sites=1 mementos=6658 tenured=0 not_tenured=1
[1:0xffff8e0f0000] pretenuring: AllocationSite(0x122eae39d9): (created, found, ratio) (2816, 2816, 1.000000) maybe tenure => maybe tenure
[1:0xffff8e0f0000] pretenuring: threshold=0.85 deopt_maybe_tenured=0 visited_sites=1 active_sites=1 mementos=2816 tenured=0 not_tenured=1
[1:0xffff8e0f0000] pretenuring: AllocationSite(0x122eae39d9): (created, found, ratio) (4047, 4047, 1.000000) maybe tenure => tenure
[1:0xffff8e0f0000] pretenuring: threshold=0.85 deopt_maybe_tenured=0 visited_sites=1 active_sites=1 mementos=4047 tenured=1 not_tenured=0
[1:0xffff8e0f0000] pretenuring: AllocationSite(0x122eae39d9): (created, found, ratio) (2766, 2766, 1.000000) tenure => tenure
[1:0xffff8e0f0000] pretenuring: threshold=0.85 deopt_maybe_tenured=0 visited_sites=1 active_sites=1 mementos=2766 tenured=1 not_tenured=0
last object pushed in the hot loop: young=false

$ node pretenure-count.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
default (pretenuring on)           last object already in the old generation in 10 of 10 runs
--no-allocation-site-pretenuring   last object already in the old generation in 0 of 10 runs
```
</details>

**The code that keeps it working, and that defeats it.** The decision is per allocation site, so one factory function that creates both long-lived and short-lived objects gets one decision for both. `--trace-pretenuring` (decisions in optimized code) printed nothing in this run ✅[^lab]; the 2015 paper is the design reference ✅[^memento].

### 3.7 Heap limits and how the flags add up

`--max-old-space-size` sets the maximum size of the old generation in MiB, and V8 spends more time in GC as the heap approaches it ✅[^nodecli]. `--max-semi-space-size` sets the maximum semi-space size; the Node.js docs say the young generation is three times the semi-space, so 1 MiB more semi-space adds 3 MiB of heap ✅[^nodecli]. The V8 source computes the young-generation size as semi-space size × (number of semi-spaces + the new-large-object ratio), with two semi-spaces unless `--minor-ms` is on ✅[^heapcc].

The lab agrees: `heap_size_limit` was 704 MiB with `--max-old-space-size=512`, 608 MiB with a 32 MiB semi-space, and 515 MiB with a 1 MiB semi-space, that is, old space + 3 × semi-space each time ✅[^lab]. The same arithmetic puts this machine's default maximum semi-space at 64 MiB (704 − 512 = 192 = 3 × 64), and §4.5 shows the new space reaching 128 MiB (two semi-spaces of 64 MiB) with default flags ✅[^lab]. The default depends on the memory limit: per the docs, 1 MiB at a 512 MiB limit on 64-bit systems, and under 16 MiB for limits up to 2 GiB ✅[^nodecli]. The default `heap_size_limit` here was 2240 MiB, worked out from the VM's 8 GiB ✅[^lab][^nodev8].

<details><summary>Lab: heap-limit.mjs</summary>

```js
import v8 from 'node:v8';
const h = v8.getHeapStatistics();
console.log(`flags: ${process.execArgv.join(' ') || '(none)'}  heap_size_limit ${Math.round(h.heap_size_limit / 2 ** 20)} MiB`);
```

```text
$ node heap-limit.mjs
flags: (none)  heap_size_limit 2240 MiB

$ node --max-old-space-size=512 heap-limit.mjs
flags: --max-old-space-size=512  heap_size_limit 704 MiB

$ node --max-old-space-size=512 --max-semi-space-size=32 heap-limit.mjs
flags: --max-old-space-size=512 --max-semi-space-size=32  heap_size_limit 608 MiB

$ node --max-old-space-size=512 --max-semi-space-size=1 heap-limit.mjs
flags: --max-old-space-size=512 --max-semi-space-size=1  heap_size_limit 515 MiB
```
</details>

How a container's memory limit sets the default heap of the main thread and of each worker thread is in [node-worker-default-heap-limit.md](node-worker-default-heap-limit.md).

### 3.8 External memory: `ArrayBuffer`, `Buffer` and `process.memoryUsage()`

**The fields.** `heapTotal` and `heapUsed` are V8's heap; `external` is memory of C++ objects bound to JavaScript objects; `arrayBuffers` is memory for `ArrayBuffer`s and `SharedArrayBuffer`s, including every `Buffer`, and is also counted in `external`; `rss` (resident set size) is the amount of space the process occupies in main memory, including C++ and JavaScript objects and code ✅[^nodeproc]. In the docs' wording `external` is "the memory usage of C++ objects bound to JavaScript objects managed by V8"; `arrayBuffers` may be `0` when Node.js is embedded as a library, and with `Worker` threads `rss` covers the whole process while the other fields cover the current thread ✅[^nodeproc]. `process.memoryUsage()` iterates over memory pages, which the docs say can be slow ✅[^nodeproc]. `process.memoryUsage.rss()` gives the same `rss` value faster ✅[^nodeproc].

**What moves when.** Measured after a full GC each time ✅[^lab]:

- `new ArrayBuffer(64 MiB)`: `external` and `arrayBuffers` +64 MiB at once; `heapUsed` and `rss` unchanged. The memory is reserved but not yet touched.
- writing every byte of it: `rss` +64 MiB, nothing else.
- `Buffer.alloc(64 MiB, 2)`: `external`, `arrayBuffers` and `rss` +64 MiB together, because the fill touches every page.
- `Buffer.allocUnsafe(100)`: a slice of a 65,536-byte shared pool. The Node.js 24 docs list that version 24.18.0 raised the default `Buffer.poolSize` from 8192 to 65536 bytes, and say the pool is used when the size is less than `Buffer.poolSize >>> 1` (the same page says "less than or equal to half" in one other sentence, so the exact boundary is unclear in the docs; this doc did not test it) ✅[^nodebuf]. Holding such a small `Buffer` for a long time keeps the whole pool chunk alive; the docs suggest `Buffer.allocUnsafeSlow()` plus a copy for that case ✅[^nodebuf].
- after dropping both buffers and a full GC, the counters fell in two steps, in the same job and after a later timer turn, and the split between the two steps differed between runs (in three runs: `arrayBuffers` −128 MiB then 0 twice, and −64 MiB then −64 MiB once, with `rss` falling by only 5 MiB in the first step of that run) ✅[^lab]. The backing stores are released after the GC, not inside it, so a measurement taken right after `gc()` can still show them.

<details><summary>Lab: external.mjs</summary>

```js
import { setTimeout as tick } from 'node:timers/promises';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const fields = ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'];
let prev;
const step = (label) => {
  globalThis.gc();
  const m = process.memoryUsage();
  const d = fields.map((f) => `${f} ${String(Math.round((m[f] - (prev?.[f] ?? m[f])) / 2 ** 20) || 0).padStart(4)}`).join('  ');
  console.log(`${label.padEnd(36)} change in MiB: ${d}`);
  prev = m;
};
step('baseline');
let ab = new ArrayBuffer(64 * 2 ** 20);
step('new ArrayBuffer(64 MiB), untouched');
new Uint8Array(ab).fill(1);
step('same buffer, every byte written');
let buf = Buffer.alloc(64 * 2 ** 20, 2);
step('Buffer.alloc(64 MiB, 2)');
const small = Buffer.allocUnsafe(100);
console.log(`Buffer.allocUnsafe(100): length ${small.length}, underlying ArrayBuffer ${small.buffer.byteLength} bytes (Buffer.poolSize ${Buffer.poolSize})`);
ab = null; buf = null;
step('both dropped, full GC, same job');
await tick(100);
step('after a 100 ms timer and a full GC');
```

```text
$ node --expose-gc external.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
baseline                             change in MiB: rss    0  heapTotal    0  heapUsed    0  external    0  arrayBuffers    0
new ArrayBuffer(64 MiB), untouched   change in MiB: rss    0  heapTotal    0  heapUsed    0  external   64  arrayBuffers   64
same buffer, every byte written      change in MiB: rss   64  heapTotal    0  heapUsed    0  external    0  arrayBuffers    0
Buffer.alloc(64 MiB, 2)              change in MiB: rss   64  heapTotal    0  heapUsed    0  external   64  arrayBuffers   64
Buffer.allocUnsafe(100): length 100, underlying ArrayBuffer 65536 bytes (Buffer.poolSize 65536)
both dropped, full GC, same job      change in MiB: rss -128  heapTotal    0  heapUsed    0  external    0  arrayBuffers -128
after a 100 ms timer and a full GC   change in MiB: rss    0  heapTotal    0  heapUsed    0  external -128  arrayBuffers    0
```
</details>

`heapUsed` therefore says nothing about a service that holds large buffers; watch `external`, `arrayBuffers` and `rss` too. The Node.js docs also note that on glibc systems `rss` can keep growing while `heapTotal` is stable, because of `malloc` fragmentation ✅[^nodeproc]. How typed arrays and `ArrayBuffer` are represented is in [v8-object-and-value-representation-deep-dive.md](v8-object-and-value-representation-deep-dive.md).

### 3.9 Startup: the scanner, the preparser and lazy compilation

**What the engine does.** The parser either fully parses a function, building its syntax tree, or preparses it, checking its syntax and recording what its outer functions need ✅[^preparse]. The preparser must track which outer variables a function references, because that decides whether those variables live on the stack or in a heap-allocated context ✅[^preparse]; this is the root of the closure behaviour in §4.1. Since 2019, a function is at most preparsed once and fully parsed once ✅[^preparse]. A preparsed function gets its bytecode only when it is first called ✅[^lab].

**Eager-compilation hints.** A parenthesized function expression, `(function () { ... })`, is assumed to be called at once and compiled eagerly ✅[^preparse]. `--max-lazy` makes V8 ignore such hints, and `--no-lazy` turns lazy compilation off ✅[^lab].

**See it yourself.** `--log-function-events` writes, per function, the parse and compile events to the V8 log ✅[^lab]. On a four-line file:

- `plain` (a declaration, called): preparsed, then fully parsed and compiled on its call;
- `wrapped` (parenthesized, called): fully parsed and compiled at once;
- `neverCalled`: only preparsed;
- with `--max-lazy`, `wrapped` behaves like `plain`; with `--no-lazy`, all three are fully parsed up front ✅[^lab]. The event lists were the same in three runs.

The explicit compile hint `//# allFunctionsCalledOnLoad` as the first line, which the V8 blog (29 April 2025) describes for Chrome 136 ✅[^hints], changed nothing in Node.js 24.22.1 (V8 13.6.233.17): the event list of `plain`, `wrapped` and `neverCalled` was the same with and without the comment as the first line, when the file was run as the main CommonJS file, loaded with `require`, run as an ES module, or compiled with `vm.Script` ✅[^lab]. The V8 post says the comment makes V8 compile the whole file eagerly when placed at the top of a file, that it ships in Chrome 136, that individual functions are a future goal, and that it should be used sparingly; it does not mention Node.js or other embedders ✅[^hints]. This doc does not establish why Node.js 24 ignored it (for example whether Chrome's embedder, not V8 itself, acts on it); it only shows no effect in these four ways of loading, and `node --v8-options` lists no flag for it.

<details><summary>Lab: lazy-events.mjs</summary>

```js
// Runs a tiny script under three flag sets and prints, per function, the parse and compile
// events V8 logs with --log-function-events.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const lines = [
  'function plain() { return 1; }',
  'const wrapped = (function wrapped() { return 2; });',
  'function neverCalled() { return 3; }',
  'plain(); wrapped();',
];
writeFileSync('/tmp/target.js', lines.join('\n'));
// The same file with the explicit compile hint magic comment as its first line.
writeFileSync('/tmp/hinted.js', ['//# allFunctionsCalledOnLoad', ...lines].join('\n'));
for (const [flags, file] of [[[], 'target.js'], [['--max-lazy'], 'target.js'], [['--no-lazy'], 'target.js'], [[], 'hinted.js']]) {
  execFileSync(process.execPath, [...flags, '--log-function-events', '--logfile=/tmp/fe.log', '--no-logfile-per-isolate', `/tmp/${file}`]);
  const events = {};
  for (const line of readFileSync('/tmp/fe.log', 'utf8').split('\n')) {
    const f = line.split(',');
    if (f[0] === 'function' && ['plain', 'wrapped', 'neverCalled'].includes(f[7])) (events[f[7]] ??= []).push(f[1]);
  }
  console.log(`${file}, flags: ${flags.join(' ') || '(default)'}`);
  for (const name of ['plain', 'wrapped', 'neverCalled']) console.log(`  ${name.padEnd(12)} ${events[name].join(' -> ')}`);
  rmSync('/tmp/fe.log');
}
```

```text
$ node lazy-events.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
target.js, flags: (default)
  plain        preparse-resolution -> full-parse -> parse-function -> interpreter
  wrapped      full-parse -> interpreter
  neverCalled  preparse-resolution
target.js, flags: --max-lazy
  plain        preparse-resolution -> full-parse -> parse-function -> interpreter
  wrapped      preparse-resolution -> full-parse -> parse-function -> interpreter
  neverCalled  preparse-resolution
target.js, flags: --no-lazy
  plain        full-parse -> interpreter
  wrapped      full-parse -> interpreter
  neverCalled  full-parse
hinted.js, flags: (default)
  plain        preparse-resolution -> full-parse -> parse-function -> interpreter
  wrapped      full-parse -> interpreter
  neverCalled  preparse-resolution
```
</details>

<details><summary>Lab: hint-variants.mjs (the compile-hint comment, four ways of loading)</summary>

```js
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
const lines = ['function plain() { return 1; }','function neverCalled() { return 3; }','plain();'];
writeFileSync('/tmp/h.js', ['//# allFunctionsCalledOnLoad', ...lines].join('\n'));
writeFileSync('/tmp/h.mjs', ['//# allFunctionsCalledOnLoad', ...lines].join('\n'));
writeFileSync('/tmp/n.js', lines.join('\n'));
writeFileSync('/tmp/viavm.js', `const vm=require('vm');const fs=require('fs');new vm.Script(fs.readFileSync(process.argv[2],'utf8'),{filename:'/tmp/inner.js'}).runInThisContext();`);
writeFileSync('/tmp/viareq.js', `require(process.argv[2]);`);
function ev(args, label) {
  execFileSync(process.execPath, ['--log-function-events','--logfile=/tmp/fe.log','--no-logfile-per-isolate',...args]);
  const e={}; for (const l of readFileSync('/tmp/fe.log','utf8').split('\n')) { const f=l.split(','); if (f[0]==='function' && ['plain','neverCalled'].includes(f[7])) (e[f[7]]??=[]).push(f[1]); }
  console.log(label.padEnd(34), 'plain:', e.plain?.join('>'), '| neverCalled:', e.neverCalled?.join('>')); rmSync('/tmp/fe.log');
}
ev(['/tmp/n.js'], 'CJS main, no hint');
ev(['/tmp/h.js'], 'CJS main, hint');
ev(['/tmp/viareq.js','/tmp/h.js'], 'require(hinted)');
ev(['/tmp/h.mjs'], 'ESM main, hint');
ev(['/tmp/viavm.js','/tmp/h.js'], 'vm.Script, hint');
ev(['/tmp/viavm.js','/tmp/n.js'], 'vm.Script, no hint');
```

```text
$ node hint-variants.mjs
CJS main, no hint                  plain: preparse-resolution>full-parse>parse-function>interpreter | neverCalled: preparse-resolution
CJS main, hint                     plain: preparse-resolution>full-parse>parse-function>interpreter | neverCalled: preparse-resolution
require(hinted)                    plain: preparse-resolution>full-parse>parse-function>interpreter | neverCalled: preparse-resolution
ESM main, hint                     plain: preparse-resolution>full-parse>parse-function>interpreter | neverCalled: preparse-resolution
vm.Script, hint                    plain: preparse-no-resolution>full-parse>parse-function>interpreter | neverCalled: preparse-no-resolution
vm.Script, no hint                 plain: preparse-no-resolution>full-parse>parse-function>interpreter | neverCalled: preparse-no-resolution
```
</details>

**What it costs, measured here on Node.js 24.22.1** (§4.6 has the script). For generated files of 3,000 functions, lazy compilation was faster when 1 % of them ran and eager compilation was faster when all of them ran; the V8 post explains that a lazily compiled function is scanned twice ✅[^lab][^preparse]. The V8 team wrote in 2019 that V8 without lazy compilation "significantly regresses load time" ✅[^preparse]; that holds for code that is mostly not called.

### 3.10 The code cache and `v8.Script` cached data

**What the engine does.** A code cache is V8's serialized bytecode for one script. `script.createCachedData()` returns it as a `Buffer`; `new vm.Script(source, { cachedData })` tries to use it, and `script.cachedDataRejected` tells whether V8 accepted it ✅[^nodevm]. `produceCachedData` is deprecated in favour of `createCachedData()` ✅[^nodevm]. The cache holds what V8 knows when it is created: a function that was still lazy is not in it, and one compiled by then is ✅[^nodevm]. The V8 team's guidance (8 April 2019) is to make the cache after execution, to catch lazily compiled functions ✅[^ccdev].

**How V8 checks a cache.** Before using a cache, V8 compares its magic number, V8 version, flag hash, read-only snapshot checksum, payload length and checksum, and then a source hash ✅[^codeser]. The source hash is the source's length plus two bits: whether the code has wrapped arguments and whether it is a module ✅[^codeser]. The source text itself is not compared.

**See it yourself.** For a 3,000-function script ✅[^lab]:

- same source and flags: accepted;
- one character changed, same length: accepted, and a separate two-line test shows that V8 then runs the cached, old code (`r=111` for a source that sets `r = 222`);
- the same-length result held in three runs, for a cache made before and one made after running a function, and for a 100 KB script with the edit at its end (the variation script below);
- one character added: rejected;
- run with `--no-lazy`: rejected, because the flag hash differs;
- a cache made before running was 396,608 bytes, one made after running 2,516,608 bytes.

<details><summary>Lab: cache-same-length.mjs</summary>

```js
import vm from 'node:vm';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const a = 'globalThis.r = 111;';
const b = 'globalThis.r = 222;';            // same length, different code
const cache = new vm.Script(a, { filename: 'a.js' }).createCachedData();
const s = new vm.Script(b, { filename: 'b.js', cachedData: cache });
s.runInThisContext();
console.log(`source b with the cache of source a: cachedDataRejected=${s.cachedDataRejected}, r=${globalThis.r}`);
```

```text
$ node cache-same-length.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
source b with the cache of source a: cachedDataRejected=false, r=111
```
</details>

<details><summary>Lab: cache-variants.mjs (same-length edit, cache made before or after running, 100 KB script)</summary>

```js
import vm from 'node:vm';
const mk = (v) => `function f(){ return ${v}; } globalThis.r = f();`;
const a = mk(111), b = mk(222);
// cache made after running (function f compiled) vs before
const s1 = new vm.Script(a); s1.runInThisContext();
const after = s1.createCachedData();
const before = new vm.Script(a).createCachedData();
for (const [label, c] of [['after-run cache', after], ['before-run cache', before]]) {
  globalThis.r = 0;
  const s = new vm.Script(b, { cachedData: c }); s.runInThisContext();
  console.log(label, 'rejected=', s.cachedDataRejected, 'r=', globalThis.r);
}
// same length, different filename; different position
const long = 'x'.repeat(100000);
const a2 = `var pad="${long}"; globalThis.r=1;`, b2 = `var pad="${long}"; globalThis.r=2;`;
const c2 = new vm.Script(a2).createCachedData();
globalThis.r=0; const s2 = new vm.Script(b2, {cachedData:c2}); s2.runInThisContext(); console.log('100KB script, same length edit: rejected=', s2.cachedDataRejected, 'r=', globalThis.r);
// different length by 1
const b3 = b2 + ' ';
const s3 = new vm.Script(b3, {cachedData:c2}); console.log('+1 char: rejected=', s3.cachedDataRejected);
// compileFunction? 
```

```text
$ node cache-variants.mjs
after-run cache rejected= false r= 111
before-run cache rejected= false r= 111
100KB script, same length edit: rejected= false r= 1
+1 char: rejected= true
```
</details>

**Scope of this finding.** The Node.js `vm` docs describe `cachedData` only as V8's code cache "for the supplied source", say `cachedDataRejected` is set to `true` or `false` "depending on acceptance of the data by V8", and do not say how V8 validates the source ✅[^nodevm]. The source-length rule comes from the V8 source at tag 13.6.233.17 ✅[^codeser] and was observed with `new vm.Script` on Node.js 24.22.1 for scripts of 19 characters, of 100 KB, and the 3,000-function script of §4.7. For `vm.compileFunction()` and `vm.SourceTextModule` the docs say the same `code` is required ✅[^nodevm]; this doc did not test those two. It is a behaviour of this V8 version, not a promise: a later V8 may compare more.

The code that keeps a cache safe: key it by a hash of the source content (and the Node.js version and flags), not by file name or length alone. The timing script and its output are in §4.7.

### 3.11 Startup snapshots: `--build-snapshot` and `--snapshot-blob`

**What the engine does.** A startup snapshot is a heap that was set up once and serialized; at start, V8 deserializes it directly into the heap instead of running the setup code ✅[^snap15]. In the 2015 post that turned context creation from 40 ms into under 2 ms on a desktop machine ✅[^snap15]. In Node.js, `node --snapshot-blob snap.blob --build-snapshot entry.js` runs `entry.js` and writes the heap to the blob when the process exits; `node --snapshot-blob snap.blob` starts from it ✅[^nodecli]. `v8.startupSnapshot.setDeserializeMainFunction(fn)` sets the code to run after deserialization ✅[^nodev8].

**Limits.** The building script is a single entry point that can load built-in modules but not other user-land modules ✅[^nodecli]. When loading, Node.js checks that the version, architecture and platform match exactly and that V8 flags and CPU features are compatible, and otherwise exits with status 1 ✅[^nodecli]. The 2015 post adds that the snapshot cannot capture interaction with the outside world, and that values like `Math.random()` are frozen at build time ✅[^snap15]. The snapshot build process is no longer experimental since Node.js 24.13.1, and the Startup Snapshot API is stable since 24.0.0 ✅[^nodecli][^nodev8].

Measured here on Node.js 24.22.1, a program that spends its start building a table of 300,000 primes took a median of 187.4 ms from source and 20.1 ms from an 8.5 MiB snapshot, against 13.0 ms for `node -e 0` (§4.8) ✅[^lab].

### 3.12 Module loading and the module compile cache

**What Node.js does.** With the compile cache on, Node.js keeps an on-disk V8 code cache for the modules it loads ✅[^nodemodule]. The code cache is generated from the compiled code at once, when the module is compiled, and written to disk only when the process is about to exit, or when `module.flushCompileCache()` is called ✅[^nodemodule]. Caches are invalidated when a module's absolute path changes (the `portable` option relaxes this), and are typically reusable only by the same Node.js version ✅[^nodemodule]. It is enabled by `module.enableCompileCache()` or the `NODE_COMPILE_CACHE=dir` environment variable, disabled by `NODE_DISABLE_COMPILE_CACHE=1`, and stable since Node.js 24.15.0 ✅[^nodemodule][^nodecli].

**Measured here on Node.js 24.22.1** (§4.9): importing a 3,000-function ES module took a median of 51.9 ms without the cache, 53.2 ms when the cache directory was empty (the run that fills it), and 42.8 ms with a filled cache ✅[^lab]. The gain is far smaller than that of a `vm.Script` cache made after running (§4.7). That fits the docs' statement that the cache is generated at compile time, before the module's lazy functions have run, though this doc did not inspect the cache contents.

What a re-export file (a "barrel") costs at load time is in [barrel-files.md](barrel-files.md).

## 4. Worked examples

Each example below shows the code shape, the measured result, and the fix. Memory figures are `heapUsed` after a full GC (`--expose-gc`), so they show retained memory, not garbage waiting to be collected.

### 4.1 A closure keeps a variable it never uses

**What the engine does.** Variables that some closure captures are stored in one context object for the scope, and every closure created in that scope points to that context ✅[^lab]. A closure that uses nothing therefore keeps alive everything its sibling closures captured.

**Measured here on Node.js 24.22.1** ✅[^lab]: ten tiny closures kept 76.3 MiB alive (7.6 MiB each, the 1,000,000-element array) when a sibling closure in the same scope used the array; 0.0 MiB when no closure captured it; 0.0 MiB when the captured variable was set to `null` before returning. Variations, three runs each with the same figures: 20 closures over a 250,000-element array kept 38.1 MiB, and 2 closures over a 4,000,000-element array kept 61.0 MiB (each array's size times the number of closures), whether the sibling that uses the array is created before or after the tiny one; and a sibling that uses the array only inside an `if` that never runs still kept all ten arrays (76.3 MiB). All cases use `const` or `let` array variables and arrow functions in a plain function scope; classes, `eval` and generators were not tried.

<details><summary>Lab: closure-context.mjs</summary>

```js
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const usedMiB = () => { globalThis.gc(); return process.memoryUsage().heapUsed / 2 ** 20; };

// Case A: one closure uses `big`; a second closure in the same scope uses nothing.
function sharedContext() {
  const big = new Array(1_000_000).fill(0);      // about 8 MB on the heap
  const useBig = () => big.length;               // makes `big` a context variable
  useBig();
  return () => 'tiny';                          // long-lived, never touches `big`
}
// Case B: no closure in the scope uses `big`.
function noCapture() {
  const big = new Array(1_000_000).fill(0);
  big.length;                                    // used only on the stack
  return () => 'tiny';
}
// Case C: like A, but `big` is set to null before returning.
function nulledOut() {
  let big = new Array(1_000_000).fill(0);
  const useBig = () => big.length;
  useBig();
  big = null;
  return () => 'tiny';
}

for (const [name, make] of [['A shared context', sharedContext], ['B no capture', noCapture], ['C captured, then null', nulledOut]]) {
  const before = usedMiB();
  const kept = [];
  for (let i = 0; i < 10; i++) kept.push(make());   // keep 10 of the tiny closures
  const after = usedMiB();
  console.log(`${name.padEnd(22)} retained by 10 tiny closures: ${(after - before).toFixed(1)} MiB`);
  kept.length = 0;
}
```

```text
$ node --expose-gc closure-context.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
A shared context       retained by 10 tiny closures: 76.3 MiB
B no capture           retained by 10 tiny closures: 0.0 MiB
C captured, then null  retained by 10 tiny closures: 0.0 MiB
```
</details>

**The code that keeps memory low:** keep a large value out of a scope that creates long-lived closures; or set the captured variable to `null` once it is no longer needed; or compute what the long-lived closure needs (here `big.length`) into its own variable in a separate function.

### 4.2 Timers, listeners and handles

A `setInterval` callback and an event listener are reachable from Node.js's timer list and from the emitter, so whatever they capture stays alive until `clearInterval` and `off` ✅[^lab]. In the lab, a job whose handle the caller threw away still kept its 7.6 MiB cache, because the timer and the listener held it. A stopped job also kept its cache while the caller held its handle, because the `stop()` closure shares the context that holds the cache (§4.1); dropping the handle freed it ✅[^lab].

<details><summary>Lab: closure-variants.mjs (other sizes, other order, a branch that never runs)</summary>

```js
const usedMiB = () => { globalThis.gc(); return process.memoryUsage().heapUsed / 2 ** 20; };
function mk(n, order) {
  const big = new Array(n).fill(0);
  let tiny, useBig;
  if (order === 'tiny-first') { tiny = () => 'tiny'; useBig = () => big.length; }
  else { useBig = () => big.length; tiny = () => 'tiny'; }
  useBig();
  return tiny;
}
// variant: the sibling that uses big is created inside a nested block / only on a branch never taken
function mkBranch(n) {
  const big = new Array(n).fill(0);
  const tiny = () => 'tiny';
  if (n < 0) { globalThis.f = () => big.length; }   // never runs, but big is still a context variable
  return tiny;
}
// variant: eval in scope
function mkEval(n) {
  const big = new Array(n).fill(0);
  const tiny = () => 'tiny';
  return tiny;
}
for (const [label, f, n, c] of [
  ['A 250k x20 tiny-first', (n)=>mk(n,'tiny-first'), 250_000, 20],
  ['A 250k x20 used-first', (n)=>mk(n,'used-first'), 250_000, 20],
  ['A 4M x2 used-first', (n)=>mk(n,'used-first'), 4_000_000, 2],
  ['branch never taken 1M x10', mkBranch, 1_000_000, 10],
  ['no sibling at all 1M x10', mkEval, 1_000_000, 10]]) {
  const b = usedMiB(); const kept = [];
  for (let i = 0; i < c; i++) kept.push(f(n));
  const a = usedMiB();
  console.log(label.padEnd(30), (a - b).toFixed(1), 'MiB', 'array size MiB each ~', (n*8/2**20).toFixed(1));
  kept.length = 0;
}
```

```text
$ node --expose-gc closure-variants.mjs
A 250k x20 tiny-first          38.1 MiB array size MiB each ~ 1.9
A 250k x20 used-first          38.1 MiB array size MiB each ~ 1.9
A 4M x2 used-first             61.0 MiB array size MiB each ~ 30.5
branch never taken 1M x10      76.3 MiB array size MiB each ~ 7.6
no sibling at all 1M x10       0.0 MiB array size MiB each ~ 7.6
```
</details>

<details><summary>Lab: timers-listeners.mjs</summary>

```js
import { EventEmitter } from 'node:events';
import { setTimeout as tick } from 'node:timers/promises';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const mib = () => { globalThis.gc(); return process.memoryUsage().heapUsed / 2 ** 20; };
const bus = new EventEmitter();

function startJob() {
  const cache = new Array(1_000_000).fill(0);          // about 8 MB
  const timer = setInterval(() => cache.length, 1000);  // the timer callback captures cache
  timer.unref();                                        // lets the process exit at the end
  const onEvent = () => cache.length;                   // so does the listener
  bus.on('tick', onEvent);
  return { stop() { clearInterval(timer); bus.off('tick', onEvent); } };
}
const base = mib();
const report = (label) => console.log(`${label.padEnd(44)} +${(mib() - base).toFixed(1)} MiB, listeners on bus: ${bus.listenerCount('tick')}`);

startJob();                                            // handle thrown away at once
await tick(0);
report('job 1 started, its handle discarded:');
let job2 = startJob();
await tick(0);
report('job 2 started, handle kept:');
job2.stop();
await tick(0);
report('job 2 stopped, handle still kept:');
job2 = null;
await tick(0);
report('job 2 handle dropped:');
```

```text
$ node --expose-gc timers-listeners.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
job 1 started, its handle discarded:         +7.6 MiB, listeners on bus: 1
job 2 started, handle kept:                  +15.3 MiB, listeners on bus: 2
job 2 stopped, handle still kept:            +15.3 MiB, listeners on bus: 1
job 2 handle dropped:                        +7.6 MiB, listeners on bus: 1
```
</details>

The same reachability rule (§1) covers detached structures in general: a removed DOM node in a browser, or an object dropped from your main data structure, stays alive while any cache, listener, timer or closure still points to it.

### 4.3 A short slice of a big string

A sliced string is a pointer to a parent sequential string plus an offset and a length, and the minimum length of a sliced string is 13 ✅[^strh]. Measured here: a 20-character `slice()` of a 16 MiB string kept all 16 MiB alive; a 12-character slice kept nothing, because it is copied; a copy rebuilt character by character kept nothing ✅[^lab].

<details><summary>Lab: sliced-string.mjs</summary>

```js
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const mib = () => { globalThis.gc(); return process.memoryUsage().heapUsed / 2 ** 20; };

function keepPart(len, copy) {
  // A one-byte string of 16 MiB on the V8 heap; slice() flattens it first.
  const parent = 'ab'.repeat(8 * 2 ** 20);
  let part = parent.slice(1000, 1000 + len);
  if (copy) part = [...part].join('');  // builds a new string from single characters
  return part;
}
for (const [label, len, copy] of [['slice of 20 chars', 20, false], ['slice of 12 chars', 12, false], ['20 chars, rebuilt', 20, true]]) {
  const before = mib();
  let kept = keepPart(len, copy);
  const after = mib();
  console.log(`${label.padEnd(18)} -> heap retained after GC: ${(after - before).toFixed(1)} MiB (kept.length=${kept.length})`);
  kept = null;
}
```

```text
$ node --expose-gc sliced-string.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
slice of 20 chars  -> heap retained after GC: 16.0 MiB (kept.length=20)
slice of 12 chars  -> heap retained after GC: 0.0 MiB (kept.length=12)
20 chars, rebuilt  -> heap retained after GC: 0.0 MiB (kept.length=20)
```
</details>

When you keep a small part of a big input (a header line of a large file, an ID from a large JSON text) for a long time, build an independent copy. How V8 represents strings (one-byte and two-byte, cons-strings, flattening) is in [v8-object-and-value-representation-deep-dive.md](v8-object-and-value-representation-deep-dive.md).

### 4.4 `WeakMap`, `WeakRef` and `FinalizationRegistry`

**`WeakMap`.** A `WeakMap` does not keep its keys alive, and once a key is not live its value is not necessarily live either ✅[^tc39]. In V8 the entry is freed by a GC that covers the key. Measured here on Node.js 24.22.1, with key and value in the old generation: dropping the key changed nothing, a scavenge changed nothing, and the full GC freed the 15 MiB value ✅[^lab]. The same held in three runs for a 4 MiB and a 31 MiB value, for a key that had only seen one full GC, for a key that had never been promoted, and for 2,000 small keys with 8 KB values: a scavenge freed none of them and a full GC freed all ✅[^lab]. This is what this V8 build did for these shapes; the specification only says an unreachable key's value is not necessarily live.

<details><summary>Lab: weakmap.mjs</summary>

```js
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const mib = () => (process.memoryUsage().heapUsed / 2 ** 20).toFixed(1);
const wm = new WeakMap();
const holder = { key: null };

// The key is created inside a function, so no stale temporary of this frame can point at it.
function addEntry() {
  holder.key = {};
  wm.set(holder.key, new Array(2_000_000).fill(0)); // value: about 15 MiB
}
globalThis.gc();
console.log(`before the entry:               heapUsed ${mib()} MiB`);
addEntry();
globalThis.gc(); globalThis.gc();                    // key and value now live in the old generation
console.log(`WeakMap entry alive:            heapUsed ${mib()} MiB`);
holder.key = null;
console.log(`after key dropped, no GC yet:   heapUsed ${mib()} MiB`);
globalThis.gc({ type: 'minor' });
console.log(`after a scavenge (minor GC):    heapUsed ${mib()} MiB`);
globalThis.gc();
console.log(`after a full GC:                heapUsed ${mib()} MiB`);
```

```text
$ node --expose-gc weakmap.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
before the entry:               heapUsed 3.8 MiB
WeakMap entry alive:            heapUsed 19.1 MiB
after key dropped, no GC yet:   heapUsed 19.1 MiB
after a scavenge (minor GC):    heapUsed 19.1 MiB
after a full GC:                heapUsed 3.8 MiB
```
</details>

**`WeakRef` and `FinalizationRegistry`.** Creating a `WeakRef` or calling `deref()` adds the target to a kept-alive list until ClearKeptObjects runs ✅[^tc39], and implementations are expected to run it when a synchronous sequence of ECMAScript executions completes ✅[^tc39]. Cleanup callbacks may be made only after synchronous execution completes, and the host schedules them "at some future time, if possible" ✅[^tc39]. Measured here on Node.js 24.22.1, identical in three runs ✅[^lab]:

- in the job that created the `WeakRef`, a full GC did not clear it;
- in a later job, a full GC cleared it, and `deref()` returned `undefined`;
- the cleanup callback had not run at that point; it ran after a further timer turn.

<details><summary>Lab: weakmap-variants.mjs and weakmap-small.mjs</summary>

```js
const mib = () => (process.memoryUsage().heapUsed / 2 ** 20).toFixed(1);
function run(label, n, oldKey) {
  const wm = new WeakMap(); const h = { key: null };
  (function add() { h.key = {}; wm.set(h.key, new Array(n).fill(0)); })();
  globalThis.gc();
  if (oldKey) globalThis.gc();      // oldKey: promote twice
  const alive = mib();
  h.key = null;
  globalThis.gc({ type: 'minor' }); const afterMinor = mib();
  globalThis.gc(); const afterFull = mib();
  console.log(label.padEnd(36), 'alive', alive, 'minor', afterMinor, 'full', afterFull);
}
run('old key (2 GCs), 500k value', 500_000, true);
run('old key, 4M value', 4_000_000, true);
run('young-ish key (1 full gc only)', 2_000_000, false);
// fully young: no gc before drop
(function(){
 const wm = new WeakMap(); const h={key:null};
 (function add(){ h.key={}; wm.set(h.key,new Array(2_000_000).fill(0)); })();
 const alive = mib(); h.key=null; globalThis.gc({type:'minor'}); console.log('never-collected young key: alive', alive, 'after minor', mib()); globalThis.gc(); console.log(' after full', mib());
})();
```

```js
const mib = () => (process.memoryUsage().heapUsed / 2 ** 20).toFixed(1);
const wm = new WeakMap(); const keys = [];
(function add(){ for (let i=0;i<2000;i++){ const k={}; keys.push(k); wm.set(k,new Array(1000).fill(0)); } })();
globalThis.gc(); globalThis.gc();
console.log('old keys alive', mib()); keys.length=0;
globalThis.gc({type:'minor'}); console.log('after minor', mib()); globalThis.gc(); console.log('after full', mib());
// young keys, small values
const wm2 = new WeakMap(); let k2=[];
(function add(){ for (let i=0;i<2000;i++){ const k={}; k2.push(k); wm2.set(k,new Array(1000).fill(0)); } })();
console.log('young keys alive', mib()); k2.length=0;
globalThis.gc({type:'minor'}); console.log('after minor', mib()); globalThis.gc(); console.log('after full', mib());
```

```text
$ node --expose-gc weakmap-variants.mjs
old key (2 GCs), 500k value          alive 7.3 minor 7.3 full 3.5
old key, 4M value                    alive 34.4 minor 34.4 full 3.8
young-ish key (1 full gc only)       alive 19.1 minor 19.1 full 3.8
never-collected young key: alive 19.1 after minor 19.1
 after full 3.8

$ node --expose-gc weakmap-small.mjs
old keys alive 19.0
after minor 19.5
after full 3.9
young keys alive 19.8
after minor 19.7
after full 4.0
```
</details>

<details><summary>Lab: weakref.mjs</summary>

```js
import { setTimeout as tick } from 'node:timers/promises';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const log = [];
const registry = new FinalizationRegistry((held) => log.push(`cleanup callback ran for "${held}"`));
let ref;
function make() {
  const target = { payload: new Array(100_000).fill(0) };
  ref = new WeakRef(target);
  registry.register(target, 'target-1');
}
make();
globalThis.gc();
console.log(`same job, after full GC:     deref() is ${ref.deref() === undefined ? 'undefined' : 'the object'}`);
await tick(0);                                 // end of the job: the kept-alive list is cleared
console.log(`next job, before any GC:     deref() is ${ref.deref() === undefined ? 'undefined' : 'the object'}; callbacks so far: ${log.length}`);
await tick(0);
globalThis.gc();
console.log(`next job, after full GC:     deref() is ${ref.deref() === undefined ? 'undefined' : 'the object'}; callbacks so far: ${log.length}`);
await tick(10);
console.log(`after a timer turn:          callbacks so far: ${log.length} ${log.join('; ')}`);
```

```text
$ node --expose-gc weakref.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
same job, after full GC:     deref() is the object
next job, before any GC:     deref() is the object; callbacks so far: 0
next job, after full GC:     deref() is undefined; callbacks so far: 0
after a timer turn:          callbacks so far: 1 cleanup callback ran for "target-1"
```
</details>

**What the specification does not promise** (ECMAScript 2027 draft, §9.9 to §9.11 ✅[^tc39]):

- that any object will ever be collected;
- that every `WeakRef` to a dead object is emptied (implementations "are not obligated to empty WeakRefs for maximal sets" of dead objects);
- that a cleanup callback ever runs.

The V8 team's own guide (9 July 2019) says a finalizer "might not happen at all", and that weak references and finalizers work best when used sparingly ✅[^weakfeat]. Use `FinalizationRegistry` only to release resources that are also released some other way, never for program logic.

### 4.5 Allocation rate and the young generation's size

The number of scavenges follows how much a program allocates. Measured here on Node.js 24.22.1 (1,000-element arrays, 20,000 calls), 20,000 calls of `input.map(...)` on a 1,000-element array caused 158 or 159 scavenges; writing into one preallocated array instead caused none ✅[^lab].

The young generation's size matters only when it actually grows ✅[^lab]:

- With garbage that dies at once, the new space stayed at 2 MiB with default flags, and the count stayed at 158 or 159. `--min-semi-space-size=16` made it start at 32 MiB, and the count fell to 10. `--max-semi-space-size=1`, `=16` and `=64` each gave 158 or 159 scavenges and a 2 MiB new space in three runs (command lines in the block below).
- With a sliding window (each array kept for the next 2,000 calls), the default new space grew to 128 MiB, and the run had 13 scavenges. `--max-semi-space-size=64` gave the same 13. `--max-semi-space-size=1` capped it at 2 MiB, raising the count to about 310 and adding 2 major GCs.

<details><summary>Lab: alloc-rate.mjs</summary>

```js
import { PerformanceObserver, constants } from 'node:perf_hooks';
import v8 from 'node:v8';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}; flags: ${process.execArgv.join(' ') || '(none)'}`);
const counts = { minor: 0, major: 0 };
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.detail.kind === constants.NODE_PERFORMANCE_GC_MINOR) counts.minor++;
    if (e.detail.kind === constants.NODE_PERFORMANCE_GC_MAJOR) counts.major++;
  }
}).observe({ entryTypes: ['gc'] });

const input = Array.from({ length: 1000 }, (_, i) => i);
let sink = 0;
function withTemporaries() {             // a new 1000-element array on every call
  for (let r = 0; r < 20_000; r++) { const doubled = input.map((x) => x * 2); sink += doubled[r % 1000]; }
}
const scratch = new Array(1000).fill(0);
function reusingBuffer() {               // writes into one array allocated once
  for (let r = 0; r < 20_000; r++) { for (let i = 0; i < 1000; i++) scratch[i] = input[i] * 2; sink += scratch[r % 1000]; }
}
const recent = [];
function slidingWindow() {               // each new array stays alive for the next 2,000 calls
  for (let r = 0; r < 20_000; r++) { recent.push(input.map((x) => x * 2)); if (recent.length > 2000) recent.shift(); }
}
const mode = process.argv[2];
({ temporaries: withTemporaries, reuse: reusingBuffer, window: slidingWindow })[mode]();
const newSpace = v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space').space_size / 2 ** 20;
setTimeout(() => console.log(`${mode.padEnd(11)} minor GCs: ${counts.minor}, major GCs: ${counts.major}, new_space size at the end: ${newSpace.toFixed(0)} MiB`), 200);
```

```text
$ node alloc-rate.mjs temporaries
node v24.22.1, V8 13.6.233.17-node.58, arm64; flags: (none)
temporaries minor GCs: 159, major GCs: 0, new_space size at the end: 2 MiB

$ node alloc-rate.mjs reuse
node v24.22.1, V8 13.6.233.17-node.58, arm64; flags: (none)
reuse       minor GCs: 0, major GCs: 0, new_space size at the end: 1 MiB

$ node --min-semi-space-size=16 alloc-rate.mjs temporaries
node v24.22.1, V8 13.6.233.17-node.58, arm64; flags: --min-semi-space-size=16
temporaries minor GCs: 10, major GCs: 0, new_space size at the end: 32 MiB

$ node alloc-rate.mjs window
node v24.22.1, V8 13.6.233.17-node.58, arm64; flags: (none)
window      minor GCs: 13, major GCs: 0, new_space size at the end: 128 MiB

$ node --max-semi-space-size=1 alloc-rate.mjs window
node v24.22.1, V8 13.6.233.17-node.58, arm64; flags: --max-semi-space-size=1
window      minor GCs: 314, major GCs: 2, new_space size at the end: 2 MiB

$ node --max-semi-space-size=64 alloc-rate.mjs window
node v24.22.1, V8 13.6.233.17-node.58, arm64; flags: --max-semi-space-size=64
window      minor GCs: 13, major GCs: 0, new_space size at the end: 128 MiB

$ node --max-semi-space-size=1 alloc-rate.mjs temporaries     (also =16 and =64)
temporaries minor GCs: 159, major GCs: 0, new_space size at the end: 2 MiB
```
</details>

The counts come from `PerformanceObserver` entries of type `gc`, whose `detail.kind` is one of the `NODE_PERFORMANCE_GC_*` constants ✅[^nodeperf]. Across five full runs the counts moved by a few (158 to 159; 308 to 314) and the major-GC count of the sliding-window rows by at most one (0 or 1 at the default; 2 with `--max-semi-space-size=1`) ✅[^lab]. Whether optimized code can avoid such an allocation altogether (escape analysis) is covered in [v8-compiler-pipeline-deep-dive.md](v8-compiler-pipeline-deep-dive.md).

### 4.6 Lazy against eager compilation, timed

A generated CommonJS file of 3,000 functions, each with 20 statements, was loaded with `require` in fresh processes, with either 1 % or all of the functions called ✅[^lab]. Medians of 9 runs after one warm-up, measured here on Node.js 24.22.1:

| Functions called | Declarations, default | Declarations, `--no-lazy` | Parenthesized, default | Parenthesized, `--max-lazy` |
|---|---|---|---|---|
| 1 % | 15.4 ms | 19.2 ms | 32.3 ms | 16.6 ms |
| all | 45.2 ms | 31.4 ms | 31.8 ms | 51.8 ms |

Reading it: in this generated file of 3,000 functions, wrapping every function in parentheses made the load about twice as slow when 1 % of them ran (medians 29.8 to 34.3 ms against 15.0 to 16.3 ms in three runs) and 11 to 30 % faster when all of them ran (parenthesized 31.8 to 40.4 ms against 45.2 to 45.9 ms for declarations over four runs; the 11 % was the run with 40.4 ms); `--max-lazy` undid the effect both ways ✅[^lab]. Two other sizes in three runs each: 1,000 functions with 10 % called took 6.8 to 7.1 ms with declarations and 10.4 to 10.6 ms parenthesized; 10,000 functions with 1 % called took 51.2 to 54.2 ms against 107.2 to 118.2 ms, so the doubling held at all three sizes, with 20 statements per function. Smaller or larger function bodies were not tried. The best choice depends on how much of the file runs at startup, so measure both.

<details><summary>Lab: lazy-timing.mjs</summary>

```js
// Times loading (parse + compile + run) of a generated 3,000-function file in fresh processes.
// One warm-up run, then 9 measured runs per row; the median is printed.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const N = 3000;
const body = (i) => Array.from({ length: 20 }, (_, k) => `  x = (x * ${k + 3} + ${i}) % 1000003;`).join('\n');
function source(wrap, calledShare) {
  const defs = Array.from({ length: N }, (_, i) =>
    wrap ? `const f${i} = (function (x) {\n${body(i)}\n  return x;\n});` : `function f${i}(x) {\n${body(i)}\n  return x;\n}`);
  const called = Math.round(N * calledShare);
  const calls = Array.from({ length: called }, (_, i) => `s += f${i}(${i});`);
  return `${defs.join('\n')}\nlet s = 0;\n${calls.join('\n')}\nmodule.exports = s;\n`;
}
writeFileSync('/tmp/child.js', `const t0 = performance.now(); require(process.argv[2]); console.log((performance.now() - t0).toFixed(2));`);
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const rows = [
  ['1% called, declarations', false, 0.01, []],
  ['1% called, declarations', false, 0.01, ['--no-lazy']],
  ['1% called, parenthesized', true, 0.01, []],
  ['1% called, parenthesized', true, 0.01, ['--max-lazy']],
  ['all called, declarations', false, 1, []],
  ['all called, declarations', false, 1, ['--no-lazy']],
  ['all called, parenthesized', true, 1, []],
  ['all called, parenthesized', true, 1, ['--max-lazy']],
];
for (const [label, wrap, share, flags] of rows) {
  const file = `/tmp/gen-${wrap}-${share}.js`;
  writeFileSync(file, source(wrap, share));
  const run = () => +execFileSync(process.execPath, [...flags, '/tmp/child.js', file], { encoding: 'utf8' });
  run(); // warm-up (file cache)
  const times = Array.from({ length: 9 }, run);
  console.log(`${label.padEnd(27)} ${(flags.join(' ') || '(default)').padEnd(11)} median ${median(times).toFixed(1).padStart(6)} ms  sorted runs [${times.map((t) => t.toFixed(1)).join(', ')}]`);
}
```

```text
$ node lazy-timing.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
1% called, declarations     (default)   median   15.4 ms  sorted runs [15.1, 15.1, 15.2, 15.4, 15.4, 15.6, 15.8, 16.1, 16.7]
1% called, declarations     --no-lazy   median   19.2 ms  sorted runs [19.0, 19.1, 19.1, 19.1, 19.2, 19.2, 19.3, 19.3, 21.4]
1% called, parenthesized    (default)   median   32.3 ms  sorted runs [31.7, 31.9, 32.1, 32.1, 32.3, 32.5, 32.9, 33.5, 49.6]
1% called, parenthesized    --max-lazy  median   16.6 ms  sorted runs [16.2, 16.2, 16.3, 16.5, 16.6, 16.6, 17.1, 17.3, 17.5]
all called, declarations    (default)   median   45.2 ms  sorted runs [45.0, 45.0, 45.1, 45.2, 45.2, 45.2, 45.5, 45.6, 52.2]
all called, declarations    --no-lazy   median   31.4 ms  sorted runs [30.3, 30.5, 30.7, 31.2, 31.4, 31.5, 32.4, 34.4, 35.6]
all called, parenthesized   (default)   median   31.8 ms  sorted runs [31.3, 31.5, 31.6, 31.6, 31.8, 31.9, 32.0, 35.7, 36.5]
all called, parenthesized   --max-lazy  median   51.8 ms  sorted runs [49.4, 50.4, 51.0, 51.0, 51.8, 53.4, 53.9, 54.1, 85.5]
```
</details>

### 4.7 `vm.Script` cached data, timed

The 3,000-function script with every function called, compiled and run in fresh processes; medians of 9 runs after one warm-up, measured here on Node.js 24.22.1: 53.0 ms without a cache, 39.9 ms with a cache made before running, 3.1 ms with a cache made after running ✅[^lab]. Three more runs gave 52.7 to 55.9 ms, 38.4 to 39.6 ms and 2.9 to 3.3 ms; with a 1,000-function script the three rows were 15.6 to 16.8 ms, 11.6 to 14.1 ms and 1.1 to 1.2 ms, so the order held but the gap from "before" to "none" is small (about 25 % here, 10 to 25 % for 1,000 functions) and the "after" gain is large in both ✅[^lab]. All of these are for scripts whose every function is called.

<details><summary>Lab: code-cache.mjs</summary>

```js
// vm.Script code cache: produce it, accept it, and get it rejected; then time compile + run with and without it.
// Each timed row: one warm-up, then 9 fresh processes; median printed.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const N = 3000;
const body = (i) => Array.from({ length: 20 }, (_, k) => `  x = (x * ${k + 3} + ${i}) % 1000003;`).join('\n');
const defs = Array.from({ length: N }, (_, i) => `function f${i}(x) {\n${body(i)}\n  return x;\n}`).join('\n');
const calls = Array.from({ length: N }, (_, i) => `s += f${i}(${i});`).join('\n');
writeFileSync('/tmp/app.js', `${defs}\nvar s = 0;\n${calls}\n`);
writeFileSync('/tmp/cc-child.mjs', `
import vm from 'node:vm';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [mode, cacheFile, srcFile] = process.argv.slice(2);
const src = readFileSync(srcFile, 'utf8');
const cachedData = mode === 'use' && existsSync(cacheFile) ? readFileSync(cacheFile) : undefined;
const t0 = performance.now();
const script = new vm.Script(src, { filename: 'app.js', cachedData });
script.runInThisContext();
const ms = performance.now() - t0;
if (mode === 'make-before-run') writeFileSync(cacheFile, new vm.Script(src, { filename: 'app2.js' }).createCachedData());
if (mode === 'make-after-run') writeFileSync(cacheFile, script.createCachedData());
console.log(JSON.stringify({ ms, rejected: script.cachedDataRejected, bytes: cachedData?.length }));
`);
const child = (flags, ...args) => JSON.parse(execFileSync(process.execPath, [...flags, '/tmp/cc-child.mjs', ...args], { encoding: 'utf8' }));
child([], 'make-before-run', '/tmp/before.cache', '/tmp/app.js');
child([], 'make-after-run', '/tmp/after.cache', '/tmp/app.js');
const r1 = child([], 'use', '/tmp/after.cache', '/tmp/app.js');
console.log(`same source, same flags:   cachedDataRejected=${r1.rejected} (cache ${r1.bytes} bytes)`);
writeFileSync('/tmp/app-edited.js', `${defs}\nvar s = 1;\n${calls}\n`);
const r2 = child([], 'use', '/tmp/after.cache', '/tmp/app-edited.js');
console.log(`one character changed:     cachedDataRejected=${r2.rejected} (same length)`);
writeFileSync('/tmp/app-longer.js', `${defs}\nvar s = 10;\n${calls}\n`);
const r2b = child([], 'use', '/tmp/after.cache', '/tmp/app-longer.js');
console.log(`one character added:       cachedDataRejected=${r2b.rejected}`);
const r3 = child(['--no-lazy'], 'use', '/tmp/after.cache', '/tmp/app.js');
console.log(`run with --no-lazy:        cachedDataRejected=${r3.rejected}`);
const r4 = child([], 'use', '/tmp/before.cache', '/tmp/app.js');
console.log(`cache made before running: cachedDataRejected=${r4.rejected} (cache ${r4.bytes} bytes)`);
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
for (const [label, mode, file] of [['no cache', 'none', ''], ['cache made before running', 'use', '/tmp/before.cache'], ['cache made after running', 'use', '/tmp/after.cache']]) {
  child([], mode, file, '/tmp/app.js');
  const t = Array.from({ length: 9 }, () => child([], mode, file, '/tmp/app.js').ms);
  console.log(`${label.padEnd(26)} compile + run median ${median(t).toFixed(1).padStart(5)} ms  sorted runs [${t.map((x) => x.toFixed(1)).join(', ')}]`);
}
```

```text
$ node code-cache.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
same source, same flags:   cachedDataRejected=false (cache 2516608 bytes)
one character changed:     cachedDataRejected=false (same length)
one character added:       cachedDataRejected=true
run with --no-lazy:        cachedDataRejected=true
cache made before running: cachedDataRejected=false (cache 396608 bytes)
no cache                   compile + run median  53.0 ms  sorted runs [51.9, 52.3, 52.3, 52.4, 53.0, 53.1, 53.1, 53.3, 56.2]
cache made before running  compile + run median  39.9 ms  sorted runs [37.0, 39.4, 39.7, 39.8, 39.9, 42.1, 42.1, 43.7, 44.3]
cache made after running   compile + run median   3.1 ms  sorted runs [3.1, 3.1, 3.1, 3.1, 3.1, 3.2, 3.4, 3.4, 3.6]
```
</details>

### 4.8 A startup snapshot, timed

<details><summary>Lab: snapshot.mjs</summary>

```js
// Startup snapshot: the same app started from source and from a snapshot blob built with --build-snapshot.
// Each row: one warm-up, then 9 fresh processes, wall time from spawn to exit; median printed.
import { execFileSync } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
// The app's start-up work: build a table of the first 300,000 primes.
const init = `
function buildTable() {
  const primes = [];
  for (let n = 2; primes.length < 300000; n++) {
    let isPrime = true;
    for (const p of primes) { if (p * p > n) break; if (n % p === 0) { isPrime = false; break; } }
    if (isPrime) primes.push(n);
  }
  return primes;
}
function main(table) { process.stdout.write(String(table[table.length - 1])); }
`;
writeFileSync('/tmp/plain.js', `${init}\nmain(buildTable());\n`);
writeFileSync('/tmp/snap-entry.js', `${init}
const v8 = require('node:v8');
const table = buildTable();                         // runs once, while the snapshot is built
v8.startupSnapshot.setDeserializeMainFunction(() => main(table));
`);
execFileSync(process.execPath, ['--snapshot-blob', '/tmp/snap.blob', '--build-snapshot', '/tmp/snap-entry.js']);
console.log(`snapshot blob: ${(statSync('/tmp/snap.blob').size / 2 ** 20).toFixed(1)} MiB`);
const wall = (args) => { const t0 = performance.now(); const out = execFileSync(process.execPath, args, { encoding: 'utf8' }); return [performance.now() - t0, out]; };
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
for (const [label, args] of [['empty script (node -e 0)', ['-e', '0']], ['from source', ['/tmp/plain.js']], ['from snapshot', ['--snapshot-blob', '/tmp/snap.blob']]]) {
  const [, out] = wall(args);
  const t = Array.from({ length: 9 }, () => wall(args)[0]);
  console.log(`${label.padEnd(25)} prints ${(out || '-').padEnd(8)} median ${median(t).toFixed(1).padStart(6)} ms  sorted runs [${t.map((x) => x.toFixed(1)).join(', ')}]`);
}
```

```text
$ node snapshot.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
snapshot blob: 8.5 MiB
empty script (node -e 0)  prints -        median   13.0 ms  sorted runs [12.0, 12.4, 12.7, 12.9, 13.0, 13.3, 13.6, 13.6, 14.6]
from source               prints 4256233  median  187.4 ms  sorted runs [179.1, 179.6, 185.9, 186.5, 187.4, 194.2, 201.9, 203.2, 204.1]
from snapshot             prints 4256233  median   20.1 ms  sorted runs [18.8, 19.9, 19.9, 19.9, 20.1, 21.1, 21.5, 21.9, 22.4]
```
</details>

Wall time from spawn to exit, medians of 9 runs after one warm-up, measured here on Node.js 24.22.1: 187.4 ms from source and 20.1 ms from the snapshot; an empty `node -e 0` took 13.0 ms ✅[^lab]. Three more runs gave 179.8 to 186.1 ms from source, 18.4 to 18.9 ms from the snapshot and 12.8 to 15.4 ms for `node -e 0`. These are for this one program (a 300,000-prime table) on this machine; the ratio depends on how much work the setup code does. Both paths printed the same last prime, 4256233.

### 4.9 The module compile cache, timed

<details><summary>Lab: compile-cache.mjs</summary>

```js
// Node.js module compile cache (module.enableCompileCache): import time of a generated 3,000-function
// ES module with no cache, with an empty cache directory, and with a filled one.
// Each timed row: 9 fresh processes; median printed (the "filled" row has one warm-up that fills the cache).
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, readdirSync } from 'node:fs';
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const N = 3000;
const body = (i) => Array.from({ length: 20 }, (_, k) => `  x = (x * ${k + 3} + ${i}) % 1000003;`).join('\n');
const defs = Array.from({ length: N }, (_, i) => `function f${i}(x) {\n${body(i)}\n  return x;\n}`).join('\n');
const calls = Array.from({ length: N }, (_, i) => `s += f${i}(${i});`).join('\n');
writeFileSync('/tmp/big.mjs', `${defs}\nlet s = 0;\n${calls}\nexport default s;\n`);
writeFileSync('/tmp/entry.mjs', `
import module from 'node:module';
const dir = process.argv[2];
const status = dir === 'off' ? null : module.enableCompileCache(dir);
const t0 = performance.now();
await import('/tmp/big.mjs');
const ms = performance.now() - t0;
console.log(JSON.stringify({ ms, status: status && Object.keys(module.constants.compileCacheStatus).find((k) => module.constants.compileCacheStatus[k] === status.status) }));
`);
const run = (dir) => JSON.parse(execFileSync(process.execPath, ['/tmp/entry.mjs', dir], { encoding: 'utf8' }));
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const row = (label, fn) => { const r = Array.from({ length: 9 }, fn); const t = r.map((x) => x.ms);
  console.log(`${label.padEnd(24)} status ${String(r[0].status).padEnd(8)} median ${median(t).toFixed(1).padStart(5)} ms  sorted runs [${t.map((x) => x.toFixed(1)).join(', ')}]`); };
run('off');
row('no compile cache', () => run('off'));
row('empty cache each time', () => { rmSync('/tmp/ncc', { recursive: true, force: true }); return run('/tmp/ncc'); });
rmSync('/tmp/ncc', { recursive: true, force: true });
run('/tmp/ncc');                                  // fills the cache
row('cache already filled', () => run('/tmp/ncc'));
console.log(`cache directory holds ${readdirSync('/tmp/ncc', { recursive: true }).length} entries`);
```

```text
$ node compile-cache.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
no compile cache         status null     median  51.9 ms  sorted runs [48.4, 49.5, 50.4, 50.6, 51.9, 51.9, 53.4, 54.3, 58.5]
empty cache each time    status ENABLED  median  53.2 ms  sorted runs [49.5, 49.9, 50.3, 51.4, 53.2, 54.3, 55.7, 58.0, 62.4]
cache already filled     status ENABLED  median  42.8 ms  sorted runs [35.2, 36.8, 41.0, 42.6, 42.8, 43.0, 43.9, 44.1, 48.1]
cache directory holds 2 entries
```
</details>

Import time of the generated ES module, medians of 9 runs, measured here on Node.js 24.22.1: 51.9 ms without the cache, 53.2 ms for a run that fills an empty cache, 42.8 ms with a filled cache ✅[^lab]. Three more runs gave 46.9 to 48.6 ms, 48.1 to 55.2 ms and 38.8 to 42.1 ms; the filled cache was faster than no cache by about 10 to 20 % each time, for this one 3,000-function module.

## 5. Reference & invariants

### 5.1 Flags checked in this build

Every flag below is listed by `node --v8-options` in Node.js 24.22.1, with the default shown there ✅[^lab].

| Flag | Default here | What it does |
|---|---|---|
| `--trace-gc` | off | one line per GC (§3.3) |
| `--trace-gc-verbose`, `--trace-gc-nvp`, `--trace-gc-ignore-scavenger` | off | more detail; `name=value` form; hide scavenges |
| `--expose-gc` | off | adds `global.gc()`; `gc({ type: 'minor' })` asks for a scavenge ✅[^gcext] |
| `--max-old-space-size` | 0 (worked out from memory) | old-generation limit in MiB ✅[^nodecli] |
| `--max-semi-space-size`, `--min-semi-space-size` | 0 (worked out from memory) | semi-space limits in MiB ✅[^nodecli] |
| `--semi-space-growth-factor` | 2 | how fast the new space grows |
| `--max-heap-size` | 0 | whole-heap limit; the semi-space and old-space flags take precedence |
| `--minor-ms` | off | mark-sweep young-generation collector instead of the scavenger |
| `--parallel-scavenge`, `--incremental-marking`, `--concurrent-marking`, `--parallel-marking`, `--concurrent-sweeping`, `--parallel-compaction` | on | the Orinoco techniques (§3.4) |
| `--single-threaded-gc` | off | no background GC threads |
| `--allocation-site-pretenuring` | on | §3.6 |
| `--trace-pretenuring`, `--trace-pretenuring-statistics` | off | §3.6 |
| `--lazy` | on | lazy compilation; `--no-lazy` compiles every function up front |
| `--max-lazy` | off | ignore eager-compilation hints such as parentheses |
| `--log-function-events` | off | parse and compile events per function, to the V8 log |
| `--compilation-cache` | on | the in-memory cache of compiled scripts within one isolate |

### 5.2 How to measure memory and startup in Node.js 24

| Question | Tool | Note |
|---|---|---|
| Is GC running, and how long are the pauses? | `--trace-gc` (§3.3); `PerformanceObserver` with `entryTypes: ['gc']` ✅[^nodeperf] | the observer delivers entries later, not inside the allocating code ✅[^lab] |
| How big is each space? | `v8.getHeapSpaceStatistics()` ✅[^nodev8] | look spaces up by name |
| What is the heap limit? | `v8.getHeapStatistics().heap_size_limit` ✅[^nodev8] | |
| Is memory outside the heap growing? | `process.memoryUsage()` `external`, `arrayBuffers`, `rss` ✅[^nodeproc] | §3.8 |
| Is an object still retained? | `heapUsed` after `gc()` in a test build with `--expose-gc` ✅[^lab] | allocate inside functions (§6.2) |
| Which functions compile at startup? | `--log-function-events --logfile=<file> --no-logfile-per-isolate` ✅[^lab] | §3.9 |
| How long does start take? | wall time of fresh processes, warm-up plus several runs, median | §4.6 to §4.9 |

### 5.3 Invariants of this build

- An object leaves the young generation after its second scavenge, unless its allocation site is pretenured ✅[^lab][^scav].
- A forced `gc()` is a synchronous major GC ✅[^gcext]; a major GC started by V8 can be mostly concurrent ✅[^lab].
- Young-generation size = 3 × semi-space size while the scavenger is used ✅[^nodecli][^heapcc].
- A `slice()` or `substring()` result of 13 or more characters can keep its parent alive ✅[^strh][^lab].
- A V8 code cache is checked against the source's length, not its text ✅[^codeser].
- A code cache contains only the functions compiled when it was created ✅[^nodevm][^lab].

## 6. Trade-offs, pitfalls & misconceptions

### 6.1 Corrections

<details><summary>Lab: null.mjs and forced-gc.mjs (the two rows below that cite them)</summary>

```js
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const mib = () => (process.memoryUsage().heapUsed / 2 ** 20).toFixed(1);
globalThis.gc();
let big = new Array(2_000_000).fill(0);            // about 15 MiB
console.log(`array alive:                    heapUsed ${mib()} MiB`);
big = null;
console.log(`after big = null, no GC yet:    heapUsed ${mib()} MiB`);
globalThis.gc();
console.log(`after a full GC:                heapUsed ${mib()} MiB`);
```

```js
// What one global.gc() call costs on the main thread with a live heap of a given size.
// One warm-up call, then 9 timed calls; median printed.
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const live = [];
for (const target of [1e5, 1e6, 3e6]) {
  while (live.length < target) live.push({ id: live.length, tag: 'n' });
  globalThis.gc();
  const t = Array.from({ length: 9 }, () => { const t0 = performance.now(); globalThis.gc(); return performance.now() - t0; });
  const heap = process.memoryUsage().heapUsed / 2 ** 20;
  console.log(`${String(target).padStart(7)} live objects, heapUsed ${heap.toFixed(0).padStart(4)} MiB: gc() blocks for median ${median(t).toFixed(1).padStart(6)} ms`);
}
```

```text
$ node --expose-gc null.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
array alive:                    heapUsed 19.1 MiB
after big = null, no GC yet:    heapUsed 19.1 MiB
after a full GC:                heapUsed 3.8 MiB

$ node --expose-gc forced-gc.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
 100000 live objects, heapUsed    9 MiB: gc() blocks for median    2.8 ms
1000000 live objects, heapUsed   52 MiB: gc() blocks for median   15.8 ms
3000000 live objects, heapUsed  152 MiB: gc() blocks for median   50.9 ms
```
</details>

| Belief | What the lab or the current source shows |
|---|---|
| "Setting a variable to `null` frees memory." | It only makes the value unreachable; in this lab (`null.mjs` below, a 15 MiB array, three runs) `heapUsed` stayed at 19.1 MiB after `big = null` and fell to 3.8 MiB only at the next GC ✅[^lab]. It matters only when the variable outlives its use, as in a closure's context (§4.1, case C). A local that goes out of scope anyway needs no `null`. |
| "A closure only keeps the variables it uses." | All closures of a scope share one context; a closure that used nothing kept a 7.6 MiB array alive (§4.1) ✅[^lab]. A 2012 blog by a then V8 engineer described the same sharing ✅[^mraleph]; it still holds in V8 13.6. |
| "Wrapping a function in parentheses makes it compile eagerly, so it is faster." | It does compile eagerly in V8 13.6 ✅[^lab][^preparse]. It is faster only when the function runs at startup: with 1 % of 3,000 functions called, load time went from 15.4 ms to 32.3 ms (§4.6) ✅[^lab]. The V8 team itself called forcing functions into the code cache this way "somewhat of an abuse of heuristics" (2019) ✅[^ccdev]. |
| "`//# allFunctionsCalledOnLoad` compiles a file eagerly." | The V8 post of 29 April 2025 describes it for whole files in Chrome 136 ✅[^hints]; in Node.js 24.22.1 it changed nothing when loaded as the main file, with `require`, as an ES module or through `vm.Script` (§3.9) ✅[^lab]. |
| "`global.gc()` should be called in production to keep memory low." | It needs `--expose-gc`, for which the Node.js 24 CLI docs have only a heading and no description ✅[^nodecli]. It runs a synchronous major GC ✅[^gcext] that marks the whole heap inside one pause: the median pause of `gc()` was 2.7 to 4.1 ms at 9 MiB, 17.2 to 17.9 ms at 52 MiB and 51.2 to 63.7 ms at 152 MiB of live small objects, in three runs measured here on Node.js 24.22.1 (an earlier run of the same script gave 2.6, 16.0 and 46.2 ms; the script is below) ✅[^lab]. V8's own major GCs mark mostly concurrently (§3.3). And it cannot free anything still reachable. |
| "`WeakMap` entries are collected as soon as the key is unreachable." | Only by a GC that covers the key: an old key's 15 MiB value survived a scavenge and was freed by the next full GC (§4.4) ✅[^lab]. The specification does not promise collection at all ✅[^tc39]. |
| "A `FinalizationRegistry` callback runs when the object is collected." | It ran on a later turn of the event loop, after the GC (§4.4) ✅[^lab]; the specification does not promise that it runs ✅[^tc39], and V8's guide says it might not happen at all ✅[^weakfeat]. |
| "Raising `--max-semi-space-size` reduces the number of scavenges." The Node.js memory guide says a larger new space "can reduce the frequency of minor garbage collection cycles" ✅[^nodelearn]. | It raises a ceiling. For the loop of §4.5 whose garbage dies at once, `--max-semi-space-size` set to 1, 16 and 64 left the new space at 2 MiB and the count at 158 or 159 in three runs; `--min-semi-space-size` did change it (§4.5) ✅[^lab]. With many survivors, the default on this 8 GiB machine already allowed 64 MiB semi-spaces, so 64 changed nothing; lowering it to 1 MiB multiplied scavenges by about 24 ✅[^lab]. On a machine with a 512 MiB limit the default is 1 MiB ✅[^nodecli], and raising it can matter there. |
| "V8 rejects a code cache when the source has changed." | In V8 13.6.233.17 the source check is the source's length plus two flags (wrapped arguments, module) ✅[^codeser]. In `vm.Script` on Node.js 24.22.1 a same-length edit was accepted and the old code ran, in all variations tried (§3.10) ✅[^lab]. Treat it as this version's behaviour and key your cache by a hash of the content. |
| "A code cache makes startup fast." | Only for functions compiled when the cache was made: for a 3,000-function script whose functions all run, 39.9 ms with a cache made before running, 3.1 ms with one made after, 53.0 ms with none, measured here on Node.js 24.22.1 (§4.7) ✅[^lab][^ccdev]. |
| "`heapUsed` is the memory my process uses." | `ArrayBuffer` and `Buffer` contents appear only in `external`, `arrayBuffers` and, once touched, `rss` (§3.8) ✅[^lab][^nodeproc]. |
| "`Buffer.allocUnsafe` slices an 8 KiB pool." | Since Node.js 24.18.0 the pool is 64 KiB ✅[^nodebuf]; the lab shows 65,536 bytes ✅[^lab]. A small long-lived pooled `Buffer` keeps that whole chunk alive. |

### 6.2 Pitfalls when measuring

- **Stale references in the measuring code itself.** The same `WeakMap` test written at module top level (`let key = {}; wm.set(key, value); key = null; gc()`) kept the 15 MiB value alive through a full GC; written with the key created inside a function, it was freed ✅[^lab]. The cause was not established here; a likely one is a temporary register of the top-level frame still holding the key, which is unconfirmed. Allocate the objects you measure inside functions.

<details><summary>Lab: weakmap-toplevel.mjs</summary>

```js
console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
const mib = () => (process.memoryUsage().heapUsed / 2 ** 20).toFixed(1);
const wm = new WeakMap();
let key = {};
wm.set(key, new Array(2_000_000).fill(0));          // value: about 15 MiB
globalThis.gc();
console.log(`WeakMap entry alive:            heapUsed ${mib()} MiB`);
key = null;
globalThis.gc();
console.log(`after key = null and a full GC: heapUsed ${mib()} MiB`);
```

```text
$ node --expose-gc weakmap-toplevel.mjs
node v24.22.1, V8 13.6.233.17-node.58, arm64
WeakMap entry alive:            heapUsed 19.1 MiB
after key = null and a full GC: heapUsed 19.1 MiB
```
</details>

- **Garbage counted as retained.** Read `heapUsed` after `gc()`, or the number includes garbage not yet collected (§6.1, first row).
- **External memory released late.** Backing stores were returned partly after a later timer turn (§3.8); wait a turn before reading `external`.
- **The in-isolate compilation cache.** Within one process, V8 caches compiled scripts by their source ✅[^ccdev], so compiling the same source twice in one process times the cache, not the compiler. Every startup timing here uses fresh processes.
- **Timer noise.** The lab ran on a shared machine; the medians of the same row differed by up to about 30 % between the first pass and the later ones, and by up to about 15 % between the last two. Compare rows of one run, not numbers across machines.

### 6.3 Trade-offs

| Choice | Gains | Costs |
|---|---|---|
| Larger young generation | fewer scavenges when objects live a little while (§4.5) | 3 MiB of heap per 1 MiB of semi-space ✅[^nodecli]; nothing for pure garbage |
| Reusing buffers instead of allocating | no scavenges at all in the lab (§4.5) | shared mutable state; easy to leak data between uses |
| Eager compilation (parentheses, `--no-lazy`) | faster when the code runs at startup (§4.6) | slower and more memory when it does not ✅[^preparse] |
| `vm.Script` code cache | 53.0 → 3.1 ms here when made after running (§4.7) | must match V8 version and flags; check by content yourself (§3.10) |
| Startup snapshot | 187.4 → 20.1 ms here (§4.8) | one entry point; no user-land modules while building; same binary required ✅[^nodecli] |
| Module compile cache | 51.9 → 42.8 ms here, no code changes (§4.9) | cache written at exit; tied to Node.js version and module paths ✅[^nodemodule] |
| `WeakRef` / `FinalizationRegistry` | caches that do not keep their values alive | no timing guarantee, no guarantee at all for callbacks ✅[^tc39] |

## Verification status

- **Measured on 2026-11-26**, Node.js 24.22.1 (V8 13.6.233.17-node.58) in `node:24.22.1-alpine` on an arm64 Docker VM with 8 CPUs and 8 GiB, `--network none`: every ✅[^lab] claim. Every script ran in three full passes (timings with 7 repetitions in the first pass, 9 in the other two); the embedded outputs are from the second, and the third was compared with it line by line. GC times, `--trace-gc` addresses and timings change between runs; the structural results (promotion after two scavenges, retained sizes, `cachedDataRejected` values, `r=111`, the 10-of-10 counts) were the same in every pass. The pretenuring trace, the steps in which external memory is released, and the major-GC count of the sliding-window run (0 or 1) varied. Timing medians of the second and third passes differed by at most about 15 %.
- **Independent re-run on 2026-11-26** (second reviewer): all 20 embedded scripts were re-run three more times with the doc's command; every structural result matched, and the timings are quoted with their range where they differ. Added: the variation scripts in §3.9, §3.10, §4.1, §4.4, §4.5 and §6.1, and the `null.mjs` and `forced-gc.mjs` scripts that earlier cited the lab without embedding it. The 46.2 ms `gc()` pause did not reproduce (51.2 to 63.7 ms in three runs).
- **Read on 2026-11-26** with WebFetch: the V8 blog posts (with their dates in the text), the V8 feature page on weak references, the Node.js v24.22.3 docs, the ECMAScript 2027 draft §9.9 to §9.11, the V8 source at tag 13.6.233.17 (`gc-tracer.cc`, `string.h`, `code-serializer.cc`, `gc-extension.cc`, `heap.cc`), and the abstract of the 2015 pretenuring paper.
- **Not checked:** whether Node.js reports idle periods to V8 (§3.4); why `//# allFunctionsCalledOnLoad` had no effect in Node.js 24.22.1 (§3.9); whether `Buffer.allocUnsafe` pools a size of exactly half the pool size (§3.8); why the top-level `WeakMap` test kept its value (§6.2); the contents of the module compile cache (§3.12); the exact default maximum semi-space size as a function of memory (only inferred for this machine from `heap_size_limit`, §3.7); behaviour on x64, on Linux hosts outside Docker, or under a container memory limit.

## References

- [ECMAScript 2027 Language Specification, §9.9 Processing Model of WeakRef and FinalizationRegistry Targets, §9.10 ClearKeptObjects, §9.11 AddToKeptObjects](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html) — Ecma TC39, living draft. Rank 1. Backs: §4.4, §6.1, §6.3 (no collection guarantee, kept-alive list, cleanup timing, `WeakMap` keys and liveness). [^tc39]
- [Command-line API](https://nodejs.org/docs/latest-v24.x/api/cli.html) — Node.js, v24.22.3 docs. Rank 1. Backs: §3.7, §3.11, §3.12, §5, §6 (`--max-old-space-size`, `--max-semi-space-size`, `--build-snapshot`, `--snapshot-blob`, `NODE_COMPILE_CACHE`, `--expose-gc`). [^nodecli]
- [Modules: `node:module` API, Module compile cache](https://nodejs.org/docs/latest-v24.x/api/module.html) — Node.js, v24.22.3 docs. Rank 1. Backs: §1, §2, §3.12, §6.3. [^nodemodule]
- [VM (executing JavaScript)](https://nodejs.org/docs/latest-v24.x/api/vm.html) — Node.js, v24.22.3 docs. Rank 1. Backs: §1, §2, §3.10, §5.3 (`cachedData`, `cachedDataRejected`, `createCachedData`, lazy functions). [^nodevm]
- [Process, `process.memoryUsage()`](https://nodejs.org/docs/latest-v24.x/api/process.html) — Node.js, v24.22.3 docs. Rank 1. Backs: §2, §3.8, §5.2, §6.1. [^nodeproc]
- [V8 module](https://nodejs.org/docs/latest-v24.x/api/v8.html) — Node.js, v24.22.3 docs. Rank 1. Backs: §1, §2, §3.1, §3.7, §3.11, §5.2 (heap statistics, Startup Snapshot API). [^nodev8]
- [Buffer](https://nodejs.org/docs/latest-v24.x/api/buffer.html) — Node.js, v24.22.3 docs. Rank 1. Backs: §3.8, §6.1 (`Buffer.poolSize`, the pool, `allocUnsafeSlow`). [^nodebuf]
- [Performance measurement APIs](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html) — Node.js, v24.22.3 docs. Rank 1. Backs: §4.5, §5.2 (`gc` entry kinds). [^nodeperf]
- [Understanding and Tuning Memory](https://nodejs.org/en/learn/diagnostics/memory/understanding-and-tuning-memory) — Node.js learn guide, living. Rank 1. Backs: §6.1, the semi-space advice. [^nodelearn]
- [src/heap/gc-tracer.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/heap/gc-tracer.cc) — V8 project, 2025. Rank 1. Backs: §3.3, the `--trace-gc` fields. [^gctracer]
- [src/objects/string.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/string.h) — V8 project, 2025. Rank 1. Backs: §4.3, §5.3, sliced strings and `kMinLength = 13`. [^strh]
- [src/snapshot/code-serializer.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/snapshot/code-serializer.cc) — V8 project, 2025. Rank 1. Backs: §3.10, §5.3, §6.1, the cache checks and the source hash. [^codeser]
- [src/extensions/gc-extension.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/extensions/gc-extension.cc) — V8 project, 2025. Rank 1. Backs: §3.2, §5, §6.1, the options of `gc()`. [^gcext]
- [src/heap/heap.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/heap/heap.cc) — V8 project, 2025. Rank 1. Backs: §3.7, §5.3, young-generation size from the semi-space size. [^heapcc]
- [Memento Mori: Dynamic Allocation-site-based Optimizations](https://research.google/pubs/memento-mori-dynamic-allocation-site-based-optimizations/) — Clifford, Payer, Stanton and Titzer, ISMM 2015. Rank 2. Backs: §1 table, §3.6, allocation mementos and pretenuring. [^memento]
- [Trash talk: the Orinoco garbage collector](https://v8.dev/blog/trash-talk) — V8 team (Peter Marshall), 2019-01-03. Rank 4. Backs: §1, §2, §3.2 to §3.5, generations, semi-spaces, promotion, phases, parallel, incremental, concurrent, idle tasks, write barriers, the Orinoco name. [^trash]
- [Orinoco: young generation garbage collection](https://v8.dev/blog/orinoco-parallel-scavenger) — V8 team (Degenbaev, Lippautz, Payer), 2017-11-29. Rank 4. Backs: §2, §3.2, §3.5, §5.3, intermediate generation, work stealing, remembered sets. [^scav]
- [Concurrent marking in V8](https://v8.dev/blog/concurrent-marking) — V8 team (Degenbaev, Lippautz, Payer), 2018-06-11. Rank 4. Backs: §2, §3.3 to §3.5, concurrent and incremental marking, the marking write barrier. [^cmark]
- [Getting garbage collection for free](https://v8.dev/blog/free-garbage-collection) — V8 team (Payer, McIlroy), 2015-08-07. Rank 4. Backs: §3.4, idle tasks. [^idle]
- [Blazingly fast parsing, part 2: lazy parsing](https://v8.dev/blog/preparser) — V8 team (Verwaest, Hölttä), 2019-04-15. Rank 4. Backs: §1 table, §3.9, §6, preparsing, the PIFE heuristic, cost of eager compilation. [^preparse]
- [Code caching for JavaScript developers](https://v8.dev/blog/code-caching-for-devs) — V8 team (Leszek Swirski), 2019-04-08, updated 2020-06-16. Rank 4. Backs: §3.10, §6, cache after execution, parentheses and the cache, the in-isolate cache. [^ccdev]
- [Custom startup snapshots](https://v8.dev/blog/custom-startup-snapshots) — V8 team (Yang Guo), 2015-09-25. Rank 4. Backs: §3.11. [^snap15]
- [Giving V8 a heads-up: faster JavaScript startup with explicit compile hints](https://v8.dev/blog/explicit-compile-hints) — V8 team (Marja Hölttä), 2025-04-29. Rank 4. Backs: §3.9, §6.1. [^hints]
- [Weak references and finalizers](https://v8.dev/features/weak-references) — V8 team (Gunasekaran, Bynens, Guo, Swirski), 2019-07-09, updated 2020-06-19. Rank 4. Backs: §4.4, §6.1. [^weakfeat]
- [Grokking V8 closures for fun (and profit?)](https://mrale.ph/blog/2012/09/23/grokking-v8-closures-for-fun.html) — personal blog, 2012-09-23 (updated 2013, 2014). Rank 6. Backs: §6.1, the 2012 description of shared contexts. [^mraleph]
- Lab: the scripts and outputs embedded in this doc, run on 2026-11-26 with Node.js 24.22.1 (V8 13.6.233.17-node.58) in the `node:24.22.1-alpine` image, arm64, 8 CPUs, 8 GiB, `--network none`; flag defaults from `node --v8-options` in the same image. Backs: every ✅[^lab]. [^lab]

## Related

- [v8-compiler-pipeline-deep-dive.md](v8-compiler-pipeline-deep-dive.md) — Ignition, Sparkplug, Maglev and TurboFan; feedback, inline caches, deoptimization, escape analysis.
- [v8-object-and-value-representation-deep-dive.md](v8-object-and-value-representation-deep-dive.md) — tagged values, object layout, elements kinds, string representations, typed arrays.
- [v8-hidden-classes.md](v8-hidden-classes.md) — object shapes, V8 maps, inline caches, dictionary mode.
- [node-worker-default-heap-limit.md](node-worker-default-heap-limit.md) — the default heap limit of the main thread and of worker threads in a memory-limited container.
- [barrel-files.md](barrel-files.md) — module load cost of re-export files.
- [objects-references-and-this.md](../javascript/object-basics/objects-references-and-this.md) — reachability and garbage-collection basics.
