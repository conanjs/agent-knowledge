---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24.22.1 (V8 13.6.233.17, linux arm64, pointer compression off), lab of 2026-11-26", "other builds 2026-11-27 on Node.js 22.23.4, 25.7.0, a Node.js 24.22.3 pointer-compression build, Electron 43.7.7 and Google Chrome 158.0.8127.89 (V8 12.4 to 15.8, page variants in Chrome)", "SpiderMonkey shell of Firefox 161.0 (linux arm64 container), 2026-11-28", "cross-engine checks 2026-11-28 on Firefox 161 (SpiderMonkey) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, a WebKit page)", "re-run 2026-11-28 after a restart of the lab machine (memory deep dive and cross-engine checks)", "third run 2026-11-28, evening, quiet machine (timing scripts of both labs)", "V8 source at tag 13.6.233.17; ECMAScript 2027 draft"]
last-verified: 2026-11-28
last-updated: 2026-11-29
tags: [javascript, best-practices, memory, garbage-collection, closures, weakmap, finalizationregistry, memory-leak]
derived-from: [js-runtime/v8-memory-and-startup-deep-dive.md, js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: memory and garbage collection

## Summary
**TL;DR:** Eight practices about what keeps memory alive in JavaScript and what makes garbage collection expensive. Memory stays alive through paths that are easy to miss: ten tiny closures kept 76.3 MiB because a sibling closure used a big array, and a 20-character `slice()` kept its 16 MiB parent string, on Node.js 24.22.1 ✅[^lab]. Three popular habits gain nothing: `x = null` on a local that leaves scope anyway, `global.gc()` in production, which paused the thread for 44.5 to 64 ms at 152 MiB of live objects over three runs ✅[^lab], and relying on a finalizer, which the specification does not promise to run ✅[^tc39].
**Use this when:** you hunt a memory leak; you write code that keeps closures, timers, listeners, caches or slices of big strings for long; you write a hot loop that allocates per call; someone proposes `null` assignments or forced collections to "free memory".
**Not this doc:** array, sort and error patterns → [language-patterns.md](language-patterns.md); `await` and abort listeners → [async-and-promises.md](async-and-promises.md); heap-size flags (`--max-old-space-size`, `--max-semi-space-size`), the `Buffer` pool and what each field of `process.memoryUsage()` counts → [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md) (`JN-H3`); the measuring procedure → [measuring-performance.md](measuring-performance.md) (`JE-M11`); the collector's mechanisms and the lab scripts → [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md).

## Scope
The catalog covers eight practices, `JL-G1` to `JL-G8`.
- **Numbers** come from Node.js 24.22.1 (V8 13.6.233.17, Linux on arm64, pointer compression off) on 2026-11-26 ✅[^lab], run again on 2026-11-27 on Node.js 22.23.4 (V8 12.4), 25.7.0 (V8 14.1), Electron 43.7.7 (V8 15.0), macOS on arm64, emulated x64, a Node.js 24.22.3 x64 build with pointer compression, and Google Chrome 158.0.8127.89 (V8 15.8.62.31, headless, pointer compression on), where the scripts ran as page variants ✅[^lab-matrix].
- **Engines.** V8 is the engine of Chrome and Node.js; SpiderMonkey is Firefox's; JavaScriptCore is WebKit's and Bun's ✅[^jsc] ✅[^bun].
- **Other engines.** `JL-G1` to `JL-G5` were also checked on 2026-11-28 on SpiderMonkey (Firefox 161, a page) and JavaScriptCore (the `jsc` shell of macOS 26.1, Bun 1.4.5, a WebKit build's page), beside V8 in Node.js 24.22.1 and Chrome 158, by bytes where the environment reports them and by liveness elsewhere ✅[^lab-cross].
- **SpiderMonkey shell.** A Firefox page has no heap figure and no forced collection, so `JL-G1` and `JL-G3` were also run in the SpiderMonkey shell of Firefox 161.0, a shell on Linux and not a Firefox page ✅[^lab-sm]; those notes have an **Other engines** line.
- **Not run.** Safari itself was not run, and `JL-G6` to `JL-G8` were not checked on other engines.

Memory figures are `heapUsed` after a full collection (in Chrome, `performance.memory.usedJSHeapSize` after `gc()`), so they show what stays alive ✅[^lab].
- **Blind spot.** A memory metric or leak test that reads only `heapUsed` is blind to `ArrayBuffer` and `Buffer` contents (`JN-H3` in [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md)); the procedure of a timer turn and a second `gc()` before reading is `JE-M11` in [measuring-performance.md](measuring-performance.md).
- **Pages.** A page has no `process.memoryUsage()`: Chrome needs `--enable-precise-memory-info` for an exact `usedJSHeapSize` and `--js-flags=--expose-gc` for `gc()`.
- **Chrome page runs.** In the Chrome 158 runs `usedJSHeapSize` included `ArrayBuffer` contents (+64.0 MiB for one 64 MiB buffer), and `performance.measureUserAgentSpecificMemory()` was undefined on a page without cross-origin isolation ✅[^lab-matrix].
- **When the counter fell back** differed between the runs:
  - in the first run (2026-11-27, three runs) only after a timer turn and another `gc()`, every time;
  - in the re-run (2026-11-28, after the restart, 13 runs) after a timer turn in 10 of 13 runs, and in 3 already at the `gc()` right after the buffer was dropped ✅[^lab-matrix].
- **Both runs** support the same reading: the counter includes the buffer, and a check that reads it right after dropping a buffer needs a timer turn and a second `gc()` ✅[^lab-matrix].
- **In everyday work**  the developer tools' Memory panel (heap snapshots) is the practical route (general guidance, not measured here).

**How the timings were taken.** The conclusions are what stays alive and, for timings, the order and the ratio between the cases, which held in every run; the absolute times are quoted as the machine printed them under that load and will differ on another machine or under another load.
- **Machine.** Every lab ran on one Apple M2 laptop with macOS 26.1; the Linux builds ran in containers in a virtual machine on it, and the x64 builds were emulated ✅[^lab] ✅[^lab-matrix].
- **Each lab was run twice; the timing scripts a third time.**
  - The **first run**: the baseline on 2026-11-26 ✅[^lab], the other builds and the Chrome 158 page variants on 2026-11-27 ✅[^lab-matrix], and the cross-engine checks in the night to 2026-11-28, before the lab machine was restarted ✅[^lab-cross]; the runner did not yet check for a locked screen or keep one browser window at a time, so the conditions of that run are not fully known.
  - The **re-run** (2026-11-28, after the restart): every script was taken from the lab docs and run again with the screen unlocked, one browser window at a time and one timing run at a time, while other, untimed jobs ran on the machine; every baseline output and every cell of the memory deep dive's build matrix matched, so the bytes, counts and liveness results quoted here came out the same ✅[^lab] ✅[^lab-matrix] and no verdict of the cross-engine checks changed ✅[^lab-cross].
  - The **third run** (2026-11-28, evening, quiet machine): the timing scripts of the memory deep dive and of the cross-engine checks only, with the re-run's commands, three runs on each environment, one run at a time, each started only when the one-minute load average was below 3.0; the owner's desktop applications stayed open; every run completed ✅[^lab-matrix] ✅[^lab-cross]. It is the only run made under a controlled load, so where the runs differ its values are the ones to quote for a quiet machine, and the earlier values stay as the record of what load and uncontrolled conditions do.
- **SpiderMonkey shell.** The SpiderMonkey shell checks (`JL-G1`, `JL-G3`, `JL-G5`) were made only on 2026-11-28 after the restart, three runs each, so there is no first run to compare them with; they print bytes and liveness, not times; load not recorded ✅[^lab-sm].
- **Load.**
  - in the memory deep dive's first run the load was recorded only for the Chrome `gc()` timing page (one-minute load average 8 to 12), in its re-run a load average of 20 or more from other jobs was observed during the timing runs, not recorded per run (20 to 37 for the Chrome `gc()` page) ✅[^lab-matrix];
  - for the cross-engine checks it was 2.1 to 13.8 at the start of the runs in the first run, and in the re-run 3.5 to 6.4 for `JL-G1`, 4.1 to 10.2 for `JL-G2`, 10.5 to 15.6 for the first script of `JL-G3` (load not recorded for its slice-length script), and 4.4 to 12.5 for `JL-G5` ✅[^lab-cross];
  - in the third run the one-minute load average was 1.64 to 2.98 (median 2.44) at the start of the memory deep dive's runs ✅[^lab-matrix], and 2.37 to 2.87 at the start of the runs of `JL-G5`'s timing script in the cross-engine checks ✅[^lab-cross].
- **Bytes, counts and timings.** Bytes, counts and liveness results were the same in both runs unless a note gives two values; the timings, all in `JL-G5` and `JL-G8`, are given for both runs and the third run.

How to read the **Applies** column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it). Correct and clear code comes first: a practice here chooses between two equally clear forms, and justifies a less clear one only where its "Applies" condition holds. Where a Catalog row names an engine, the practice differs there; code that must run well in every browser follows the row.

| Term | Plain meaning | Everyday comparison |
|---|---|---|
| GC (garbage collection) | Finding objects nothing can reach any more and reusing their memory | A cleaner who throws out only what nobody can still point to |
| Reachable | Some chain of references leads to the object from a root (the stack, globals, timers, listeners) | A balloon still tied by a string to someone's hand |
| Young generation, scavenge | The small area where new objects start, cleaned often by a cheap copying pass ✅[^trash] | An in-tray swept every few minutes |
| Promoted, old generation, full GC | An object that survives two scavenges moves to the old generation ✅[^trash], cleaned rarely by mark-compact, the full GC | Papers moved from the in-tray to the filing cabinet, cleared out once a quarter |
| Closure context | The one object that holds every variable the closures of a scope capture | One shared backpack carried by every child of a family, even those who use nothing in it |
| Sliced string | V8's representation of a substring as a pointer into the parent plus an offset and a length ✅[^strh] | A bookmark that keeps the whole book on the shelf |
| Liveness check | Asking a `WeakRef` to an object whether it still returns the object after collections | Calling an old phone number to see if anyone still answers |
| Pointer compression | V8 storing heap pointers in 32 bits instead of 64, so arrays of small integers take half the bytes | Writing house numbers with four digits instead of eight |

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JL-G1` | A function holding a large array or buffer that creates closures and returns or stores one that lives on | Compute what the long-lived closure needs in a separate function, or set the big variable to `null` once no closure needs it | large data | Ten tiny closures kept 76.3 MiB when a sibling used a 7.6 MiB array, 0.0 MiB with no capture or after `null`, on Node.js 24.22.1 ✅[^lab] |
| `JL-G2` | `setInterval`, `on` or `addEventListener` per job or request with no matching removal, or a handle kept after `stop()` | Return a `stop()` that clears every timer and listener; call it, then drop the handle | always | A job whose handle was thrown away kept its 7.6 MiB cache; dropping the handle after `stop()` freed it, on Node.js 24.22.1 ✅[^lab] |
| `JL-G3` | A `slice` or `substring` cut from a big string (file, body, JSON text) and stored long-term: 13+ characters on V8, 3+ on JavaScriptCore, none up to 100,000 in the SpiderMonkey shell | Store `[...part].join('')`, not the slice; at any length if the code also runs on JavaScriptCore (Bun, Safari), where `(' ' + s).slice(1)` is no copy, and as the one idiom that freed the parent on all three engines | large data | A 20-character slice of a 16 MiB string kept 16.0 MiB, a 12-character one 0.0 MiB, on Node.js 24.22.1 ✅[^lab]; on JavaScriptCore 3 characters kept the parent ✅[^lab-cross]; in the SpiderMonkey shell no slice up to 100,000 characters did, the shortest keeping slice of a flat parent was 1,048,577 characters ✅[^lab-sm] |
| `JL-G4` | A `Map` or object keyed by objects someone else owns, with no `delete` when they go away | Use a `WeakMap` keyed by the object; expect entries to be freed only at a full GC | always | After the key was dropped, `heapUsed` stayed at 19.1 MiB through a scavenge and fell to 3.8 MiB at the next full GC, on Node.js 24.22.1 ✅[^lab] |
| `JL-G5` | A `FinalizationRegistry` callback that closes handles or updates state, or logic relying on `deref()` turning `undefined` | Release resources explicitly; use a finalizer only as a safety net or diagnostic | always | The specification promises no collection and no cleanup callback ✅[^tc39]; the callback ran only after a further timer turn on Node.js 24.22.1 ✅[^lab] |
| `JL-G6` | `map`, `slice` or `Array.from` per call in a function run thousands of times, result dropped at once; or an object returned or stored per call | Write into a buffer allocated once and reused, private to that code; a temporary object that never leaves an optimized function is free (`JE-F11`) | hot path | 20,000 calls of `input.map(...)` on 1,000 elements caused 158 or 159 scavenges, the reused array 0, on Node.js 24.22.1 ✅[^lab] |
| `JL-G7` | `x = null` added at the end of a function for a plain local that no closure captures | Leave it out; use `null` only for values that outlive their use (captured, fields, module-level) | no gain | `heapUsed` stayed at 19.1 MiB after `big = null` and fell to 3.8 MiB only at the next full GC, on Node.js 24.22.1 ✅[^lab] |
| `JL-G8` | `global.gc()` or `--expose-gc` in production code, schedulers or handlers | Remove it; fix what keeps memory reachable; use `gc()` only in tests | no gain | One `gc()` paused the thread for 44.5 to 63.7 ms (medians, three runs) at 152 MiB of live small objects on Node.js 24.22.1 ✅[^lab] |

## Lookup notes
### `JL-G1` Large values stay out of a scope that creates long-lived closures, or are set to `null` after use
**Prefer:**
```js
function makeReporter(rows) {
  const count = summarize(rows);   // compute what the long-lived closure needs in a separate function
  return () => `rows: ${count}`;
}
// or, inside the same scope: big = null; once no closure needs it any more
```
**Avoid:**
```js
function makeReporter() {
  const big = loadRows();               // large
  const useBig = () => big.length;      // any sibling closure that uses big ...
  useBig();
  return () => 'tiny';                  // ... makes this tiny closure keep big alive
}
```
**Why:** variables that some closure captures are stored in one context object for the scope, and every closure created in that scope points to that context ✅[^lab], so a closure that uses nothing keeps alive what its siblings captured. A sibling that uses the value only in an `if` that never runs still makes it a captured variable ✅[^lab]. It matters for a captured value of megabytes (the lab used a 1,000,000-element array, 7.6 MiB) and a closure that outlives the call.
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64): ten tiny closures kept 76.3 MiB (ten 7.6 MiB arrays) when a sibling used the array; 0.0 MiB with no capture; 0.0 MiB when the variable was set to `null` before returning; the never-run `if` also kept 76.3 MiB (bytes, the same in every run) ✅[^lab]. The same on every build without pointer compression; with it on (Electron 43.7.7, V8 15.0, and the Node.js 24.22.3 pointer-compression build) 38.1 MiB: the same objects were kept, at half the bytes. Chrome 158 (V8 15.8), page variant read with `usedJSHeapSize` after `gc()`: 38.1 MiB, 0.0 MiB with no capture, 0.0 MiB with `null`; the size variants gave the same halved sizes ✅[^lab-matrix]. Classes, `eval` and generators were not tried.
**Other engines:** holds on all three engines. JavaScriptCore (macOS 26.1 shell, Bun 1.4.5): ten tiny closures kept 76.3 MiB when a sibling used the array, also on a never-run `if`, and 0.0 MiB with no sibling (bytes); in the WebKit page, which has no heap figure, the liveness check found the arrays kept in the same cases and freed after `big = null` (the shell's byte pass kept 7.6 MiB after `big = null` while its liveness pass found all freed) ✅[^lab-cross]. SpiderMonkey, Firefox 161 page: no verdict, because a page has no heap figure and the liveness check's control object, which nothing referenced, was still alive after 500 garbage steps, in all six runs of the first run and the three of the re-run ✅[^lab-cross]. SpiderMonkey shell of Firefox 161.0 (Linux, `gcBytes + mallocBytes` after `gc()`; a shell, not a page; one session after the restart, three runs): a sibling closure kept the array (80.0 MiB for ten scopes, 8.4 bytes per element), also on a never-run `if`, and the memory was freed by `big = null` ✅[^lab-sm].
**Exceptions:** small captured values; closures that die with the call.
**Check it:** `node --expose-gc`: call `gc()`, read `process.memoryUsage().heapUsed`, create and keep the closures, `gc()` again, compare; allocate the measured values inside functions, not at module top level. In a page, the same with `performance.memory.usedJSHeapSize` (see Scope), or a heap snapshot.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §4.1 "A closure keeps a variable it never uses" and §6.4; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.30.

### `JL-G2` Every `setInterval`, listener and subscription is paired with its removal, and the handle is dropped after stopping
**Seen in code as:** `setInterval(...)` with no `clearInterval`; `emitter.on(...)` or `addEventListener(...)` with no `off` or `removeEventListener`; a stop function returned but the caller keeps its handle after calling it.
**Prefer:**
```js
function startJob(bus) {
  const cache = buildCache();
  const timer = setInterval(() => refresh(cache), 1000);
  const onTick = () => use(cache);
  bus.on('tick', onTick);
  return { stop() { clearInterval(timer); bus.off('tick', onTick); } };
}
// EventTarget in a page: pair addEventListener with removeEventListener the same way (measured in Chrome 158)
let job = startJob(bus);
job.stop(); job = null;   // stop, then let go of the handle
```
**Avoid:**
```js
startJob(bus);   // handle discarded: nothing can ever stop the timer or remove the listener
```
**Why:** a `setInterval` callback is reachable from Node.js's timer list and a listener from its emitter, so whatever they capture stays alive until `clearInterval` and `off` ✅[^lab]. The `stop()` closure shares the context that holds `cache` (`JL-G1`), so a kept handle keeps the cache even after stopping ✅[^lab]. It applies to any timer or listener registered per job, request, component or connection.
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64): a job whose handle was thrown away kept its 7.6 MiB cache; a stopped job kept it while the caller held the handle; dropping the handle freed it (bytes) ✅[^lab]. The same on every build without pointer compression; 3.8 MiB with it on (Electron 43.7.7 and the Node.js 24.22.3 pointer-compression build). Chrome 158 (V8 15.8), page variant with `EventTarget`, `addEventListener` and `removeEventListener` in place of `EventEmitter`: the discarded job kept 3.9 MiB through its interval and listener, the stopped job kept its cache while the handle was held, and dropping the handle freed it ✅[^lab-matrix]. By default Node.js warns above 10 listeners per event on one emitter ✅[^node-events]. A removed DOM (Document Object Model) node still referenced by a listener or cache was not measured.
**Other engines:** holds on all three engines: a never-stopped timer or listener kept its cache everywhere, and the cache of a stopped `setInterval` or `EventTarget` job stayed alive while its handle was kept and was collected once the handle was dropped, on V8 (Node.js 24.22.1, Chrome 158), SpiderMonkey (Firefox 161) and JavaScriptCore (Bun 1.4.5, a WebKit page) (liveness, 3 of 3 runs in each of the two runs) ✅[^lab-cross]. Not measurable in the macOS 26.1 `jsc` shell: it has no `setInterval`, `clearTimeout` or `EventTarget` ✅[^lab-cross].
**Exceptions:** process-lifetime timers and listeners registered once at start-up.
**Check it:** repeat the action many times and compare `emitter.listenerCount(name)` and two heap snapshots; the count and the retained size should stay flat. An `EventTarget` has no listener count: in a page compare two heap snapshots, or `usedJSHeapSize` after `gc()` (see Scope).
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §4.2 "Timers, listeners and handles" and §6.4; [problem-classes.md](../../performance/code-review/problem-classes.md), class `resource-leak`; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.31.

### `JL-G3` A short slice of a big string is copied before it is kept for long
**Seen in code as:** a header line, an ID or a token cut with `slice`, `substring` or a regex from a large file, response body or JSON text, then stored in a cache, a map or a long-lived object.
**Prefer:**
```js
const id = [...body.slice(start, start + 20)].join('');   // an independent copy on every engine measured
cache.set(key, id);
```
**Avoid:**
```js
cache.set(key, body.slice(start, start + 20));   // keeps all of body alive
```
**Why:** V8 represents a slice of 13 or more characters as a pointer into the parent string plus an offset and a length, a sliced string; the minimum length 13 is `kMinLength` in V8 13.6's `string.h` ✅[^strh]. A shorter slice is copied ✅[^lab]. It matters when the parent is large (the lab used 16 MiB) and the slice is 13 characters or longer on V8, 3 or longer on JavaScriptCore (Bun, Safari's engine), and, in the SpiderMonkey shell, only above 1,048,576 characters for a flat 16 MiB parent ✅[^lab-sm]; code that also runs on JavaScriptCore copies at any length.
**Evidence:** Both checks agree: the five idioms that build a new string release the parent, and the four that return the same string (an empty concatenation or a conversion of a string) keep it, so they are not copies; the half-MiB differences are noise of the heap figure, not a partial release.
- **The lab, Node.js 24.22.1 (V8 13.6, arm64):** a 20-character `slice()` of a 16 MiB string kept 16.0 MiB alive; a 12-character slice kept 0.0 MiB; the 20 characters rebuilt with `[...part].join('')` kept 0.0 MiB (bytes) ✅[^lab].
- **Other builds.** The same on all seven builds of the 2026-11-27 matrix and in Chrome 158 (V8 15.8, page variant: 16.0, 0.0 and 0.0 MiB); pointer compression did not shrink the 16 MiB parent ✅[^lab-matrix].
- **What the lab measured.** The lab measured only the `[...part].join('')` copy ✅[^lab].
- **Earlier check.** An earlier check, made when this practice was first written (before the restart of the lab machine; its output was not kept), printed on the same build, with one-byte and two-byte parents and slices of 12, 13 and 20 characters: the plain slice kept 0.0, 16.0 and 16.0 MiB; `[...part].join('')`, `part.split('').join('')`, `Array.from(part).join('')`, `JSON.parse(JSON.stringify(part))` and `Buffer.from(part).toString()` kept 0.0 MiB at every length; `part + ''`, `String(part)`, a template literal and `part.concat('')` kept 16.0 MiB at 13 and 20 characters.
- **Run again.** Run again on 2026-11-28 (Node.js 24.22.1, linux arm64 container, `--expose-gc`, one process per case, 60 cases), it printed this ✅[^spot]:
  - The plain slice kept −0.0, 16.0 and 16.0 MiB of the one-byte parent and −0.0, 15.5 and 16.0 MiB of the two-byte one at 12, 13 and 20 characters; the five copy idioms kept −0.5 to 0.0 MiB in every case;
  - `part + ''`, `String(part)`, the template literal and `part.concat('')` kept 15.5 to 16.0 MiB at 13 and 20 characters and 0.0 at 12, for both parents.
- **A second run.** A reviewer ran the 60 cases once more on 2026-11-28 and got the same sorting: the five copy idioms kept 0.0 or −0.0 MiB in every case, the four non-copies kept 16.0 MiB at 13 and 20 characters and 0.0 at 12, and the plain slice kept 0.0 MiB at 12 characters and 16.0 at 13 and 20 (one-byte parent, 20 characters: 15.5), so the half-MiB values moved to other cells ✅[^spot].
<details><summary>Spot check: which copy idiom releases the parent, by parent width and slice length</summary>

`slice-copy.mjs`:
```js
// node --expose-gc slice-copy.mjs <one-byte|two-byte> <length> <idiom>: MiB a kept slice (or its copy) holds after gc().
// Extends sliced-string.mjs of the V8 memory deep dive, section 4.3: one process per case.
const [kind, lenArg, idiom] = process.argv.slice(2), len = Number(lenArg);
const copies = {
  'plain slice': (p) => p,
  "[...part].join('')": (p) => [...p].join(''),
  "part.split('').join('')": (p) => p.split('').join(''),
  "Array.from(part).join('')": (p) => Array.from(p).join(''),
  'JSON.parse(JSON.stringify(part))': (p) => JSON.parse(JSON.stringify(p)),
  'Buffer.from(part).toString()': (p) => Buffer.from(p).toString(),
  "part.concat('')": (p) => p.concat(''),
  'String(part)': (p) => String(p),
  "part + ''": (p) => p + '',
  'template literal': (p) => `${p}`,
};
const mib = () => { globalThis.gc(); return process.memoryUsage().heapUsed / 2 ** 20; };
function keepPart() {
  // 16 MiB parent: one-byte 'ab' x 8 Mi, or two-byte 'a中' x 4 Mi (8 Mi characters of 2 bytes).
  const parent = kind === 'one-byte' ? 'ab'.repeat(8 * 2 ** 20) : 'a中'.repeat(4 * 2 ** 20);
  return copies[idiom](parent.slice(1000, 1000 + len));
}
const before = mib();
let kept = keepPart();
const after = mib();
console.log(`${kind} ${String(len).padStart(2)} ${idiom.padEnd(32)} ${(after - before).toFixed(1)} MiB (kept.length=${kept.length})`);
```
```sh
idioms=("plain slice" "[...part].join('')" "part.split('').join('')" "Array.from(part).join('')" "JSON.parse(JSON.stringify(part))" "Buffer.from(part).toString()" "part.concat('')" "String(part)" "part + ''" "template literal")
for k in one-byte two-byte; do for n in 12 13 20; do for i in "${idioms[@]}"; do
  docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node --expose-gc slice-copy.mjs $k $n "$i"
done; done; done
```
```text
one-byte 12 plain slice                      -0.0 MiB (kept.length=12)
one-byte 12 [...part].join('')               0.0 MiB (kept.length=12)
one-byte 12 part.split('').join('')          -0.0 MiB (kept.length=12)
one-byte 12 Array.from(part).join('')        -0.0 MiB (kept.length=12)
one-byte 12 JSON.parse(JSON.stringify(part)) 0.0 MiB (kept.length=12)
one-byte 12 Buffer.from(part).toString()     0.0 MiB (kept.length=12)
one-byte 12 part.concat('')                  -0.0 MiB (kept.length=12)
one-byte 12 String(part)                     0.0 MiB (kept.length=12)
one-byte 12 part + ''                        -0.0 MiB (kept.length=12)
one-byte 12 template literal                 0.0 MiB (kept.length=12)
one-byte 13 plain slice                      16.0 MiB (kept.length=13)
one-byte 13 [...part].join('')               -0.0 MiB (kept.length=13)
one-byte 13 part.split('').join('')          -0.5 MiB (kept.length=13)
one-byte 13 Array.from(part).join('')        0.0 MiB (kept.length=13)
one-byte 13 JSON.parse(JSON.stringify(part)) 0.0 MiB (kept.length=13)
one-byte 13 Buffer.from(part).toString()     -0.0 MiB (kept.length=13)
one-byte 13 part.concat('')                  16.0 MiB (kept.length=13)
one-byte 13 String(part)                     16.0 MiB (kept.length=13)
one-byte 13 part + ''                        16.0 MiB (kept.length=13)
one-byte 13 template literal                 16.0 MiB (kept.length=13)
one-byte 20 plain slice                      16.0 MiB (kept.length=20)
one-byte 20 [...part].join('')               -0.0 MiB (kept.length=20)
one-byte 20 part.split('').join('')          0.0 MiB (kept.length=20)
one-byte 20 Array.from(part).join('')        -0.0 MiB (kept.length=20)
one-byte 20 JSON.parse(JSON.stringify(part)) -0.0 MiB (kept.length=20)
one-byte 20 Buffer.from(part).toString()     -0.5 MiB (kept.length=20)
one-byte 20 part.concat('')                  16.0 MiB (kept.length=20)
one-byte 20 String(part)                     16.0 MiB (kept.length=20)
one-byte 20 part + ''                        16.0 MiB (kept.length=20)
one-byte 20 template literal                 16.0 MiB (kept.length=20)
two-byte 12 plain slice                      -0.0 MiB (kept.length=12)
two-byte 12 [...part].join('')               -0.0 MiB (kept.length=12)
two-byte 12 part.split('').join('')          0.0 MiB (kept.length=12)
two-byte 12 Array.from(part).join('')        -0.0 MiB (kept.length=12)
two-byte 12 JSON.parse(JSON.stringify(part)) -0.0 MiB (kept.length=12)
two-byte 12 Buffer.from(part).toString()     0.0 MiB (kept.length=12)
two-byte 12 part.concat('')                  -0.0 MiB (kept.length=12)
two-byte 12 String(part)                     -0.0 MiB (kept.length=12)
two-byte 12 part + ''                        0.0 MiB (kept.length=12)
two-byte 12 template literal                 -0.0 MiB (kept.length=12)
two-byte 13 plain slice                      15.5 MiB (kept.length=13)
two-byte 13 [...part].join('')               -0.0 MiB (kept.length=13)
two-byte 13 part.split('').join('')          -0.0 MiB (kept.length=13)
two-byte 13 Array.from(part).join('')        -0.0 MiB (kept.length=13)
two-byte 13 JSON.parse(JSON.stringify(part)) -0.0 MiB (kept.length=13)
two-byte 13 Buffer.from(part).toString()     -0.0 MiB (kept.length=13)
two-byte 13 part.concat('')                  16.0 MiB (kept.length=13)
two-byte 13 String(part)                     16.0 MiB (kept.length=13)
two-byte 13 part + ''                        16.0 MiB (kept.length=13)
two-byte 13 template literal                 16.0 MiB (kept.length=13)
two-byte 20 plain slice                      16.0 MiB (kept.length=20)
two-byte 20 [...part].join('')               -0.0 MiB (kept.length=20)
two-byte 20 part.split('').join('')          -0.0 MiB (kept.length=20)
two-byte 20 Array.from(part).join('')        -0.0 MiB (kept.length=20)
two-byte 20 JSON.parse(JSON.stringify(part)) -0.0 MiB (kept.length=20)
two-byte 20 Buffer.from(part).toString()     0.0 MiB (kept.length=20)
two-byte 20 part.concat('')                  15.5 MiB (kept.length=20)
two-byte 20 String(part)                     16.0 MiB (kept.length=20)
two-byte 20 part + ''                        15.5 MiB (kept.length=20)
two-byte 20 template literal                 16.0 MiB (kept.length=20)
```
</details>

**Other engines:** V8's 13-character threshold does not carry over. So the three engines differ by orders of magnitude (13, 3 and above 100,000 characters), and the copy idiom is the one that works on all.
- **JavaScriptCore.** On JavaScriptCore (macOS 26.1 shell, Bun 1.4.5) a plain slice of 3 characters or more kept the 16.0 MiB parent (1 and 2 characters freed it; 4 freed it in the shell only), and `(' ' + s).slice(1)` kept it too; `[...s].join('')`, `s.split('').join('')` and `JSON.parse(JSON.stringify(s))` freed it on V8 and JavaScriptCore at every length from 1 to 100,000 characters (bytes, one process per case; in the re-run, 2026-11-28, after the restart, each of the 150 cases ran three times and gave the first run's figures, except V8-node's plain slice of 100 characters: 15.8 MiB in one run of three, 16.0 MiB in the other two; load not recorded) ✅[^lab-cross].
- **SpiderMonkey,** shell of Firefox 161.0 on Linux (bytes, one process per case): no plain slice of 1 to 100,000 characters kept the 16 MiB parent, with any idiom; searching upward, the shortest keeping slice of a flat parent (joined from 1,024 pieces) was 1,048,577 characters, which kept all 16.0 MiB, and `(' ' + s).slice(1)` kept it too at that length, while `[...s].join('')`, `s.split('').join('')` and the `JSON` round trip freed it ✅[^lab-sm].
- **Not run.** Not measured in a Firefox page or the WebKit page: a page has no heap figure, and a string cannot be a `WeakRef` target ✅[^tc39weak].
**Exceptions:** the parent stays alive anyway; the slice is short-lived; it is under 13 characters and the code runs only on V8 (V8 copies it itself below that length; JavaScriptCore kept the parent from 3 characters; the SpiderMonkey shell did not up to 100,000).
**Check it:** `heapUsed` after `gc()` with `node --expose-gc`, before and after keeping the slice; or a heap snapshot showing a sliced string retaining the parent.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §4.3 "A short slice of a big string"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.32 and §5.3.

### `JL-G4` Per-object side data lives in a `WeakMap` keyed by the object, and is freed only by a full GC
**Seen in code as:** a `Map` or a plain object keyed by objects (`meta.set(node, info)`) with no matching `delete` when the object goes away.
**Prefer:**
```js
const meta = new WeakMap();
meta.set(node, computeInfo(node));   // the entry goes when node becomes unreachable
```
**Avoid:**
```js
const meta = new Map();
meta.set(node, computeInfo(node));   // keeps node and info alive forever
```
**Why:** a `WeakMap` does not keep its keys alive, and once a key is not live its value is not necessarily live either ✅[^tc39]. In V8 the entry is freed by a GC that covers the key: in the lab only a full GC, never a scavenge ✅[^lab]. It applies to caches or metadata attached to objects owned by someone else (DOM nodes, request objects, library instances).
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64): after the key was dropped, `heapUsed` stayed at 19.1 MiB through a scavenge and fell to 3.8 MiB at the next full GC, freeing the 15 MiB value; the same for 4 MiB and 31 MiB values, a young key, and 2,000 small keys with 8 KB values ✅[^lab]. The same on all seven builds of the 2026-11-27 matrix; with pointer compression on the value was 7.6 MiB (Electron 43.7.7 and the Node.js 24.22.3 pointer-compression build); Chrome 158 (V8 15.8), page variants: the same for every case, with a 7.7 MiB value (8.1 MiB through the scavenge, 0.4 MiB after the full GC) ✅[^lab-matrix]. The specification promises no collection at all ✅[^tc39].
**Other engines:** holds on all three engines: a `WeakMap` entry whose value references its own key was freed, key and value, in SpiderMonkey (Firefox 161) and JavaScriptCore (macOS 26.1 shell, Bun 1.4.5, WebKit page), as on Node.js 24.22.1 and Chrome 158 (liveness) ✅[^lab-cross]. Whether a scavenge alone frees it was not checked off V8.
**Exceptions:** the owner can delete the entry itself at a known point (then a `Map` with `delete` is fine); a test that expects memory to drop right after the key goes needs a full GC. The same `WeakMap` test written at module top level kept the value through a full GC in the lab, while the key created inside a function was freed ✅[^lab]: measured objects belong inside functions.
**Check it:** `node --expose-gc`: drop the key inside a function, call `gc()`, compare `heapUsed`; in a page, `usedJSHeapSize` after `gc()` (see Scope).
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §4.4 "`WeakMap`, `WeakRef` and `FinalizationRegistry`", §6.1 "Corrections" and §6.2; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.33.

### `JL-G5` Program logic never depends on a `FinalizationRegistry` callback or on `WeakRef.deref()` turning `undefined`
**Seen in code as:** `new FinalizationRegistry(...)` whose callback closes files or sockets, decrements a counter or updates state; code that relies on `ref.deref()` being `undefined` after the target is dropped.
**Prefer:**
```js
handle.close();                         // explicit release, always called
registry.register(handle, id);          // optional: log handles that were never closed
```
**Avoid:**
```js
const registry = new FinalizationRegistry((fd) => fs.closeSync(fd));   // the only release path
```
**Why:** the specification does not promise that any object is collected, that every `WeakRef` to a dead object is emptied, or that a cleanup callback ever runs; the host schedules callbacks "at some future time, if possible" ✅[^tc39]. Creating a `WeakRef` or calling `deref()` keeps the target alive until the current synchronous job ends ✅[^tc39]. The V8 team's guide (9 July 2019) says a finalizer "might not happen at all" and that weak references and finalizers work best when used sparingly ✅[^weakfeat]. It applies to any code that releases resources, updates counts or closes handles from a finalizer.
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64), three identical runs: a full GC in the job that created the `WeakRef` did not clear it; a full GC in a later job did, and `deref()` returned `undefined`; the cleanup callback ran only after a further timer turn ✅[^lab]. The same on all seven builds of the 2026-11-27 matrix and in Chrome 158 (V8 15.8, page variant) ✅[^lab-matrix].
**Other engines:** holds on all three engines: the callback ran on every engine, at a time the language does not fix ✅[^lab-cross].
- **After one forced full collection**  it ran in the same turn on Bun 1.4.5, and one timer turn later on Node.js 24.22.1, Chrome 158 and the macOS 26.1 `jsc` shell; SpiderMonkey (Firefox 161) and the WebKit page, which have no forced collection, ran it within the script's wait.
- **With a collection forced every 10 ms** the first callback came 24 to 27 ms after the start on Node.js, 24 to 30 ms in the `jsc` shell and 11 to 16 ms on Bun over the three runs (nine runs each) ✅[^lab-cross]:
  - in the first run (2026-11-28, three runs each) 24 to 27 ms, 28 to 30 ms and 12 to 16 ms;
  - in the re-run (2026-11-28, after the restart, three runs each, under a load average of 7.1) 24 ms, 24 ms and 11 to 13 ms ✅[^lab-cross];
  - in the third run (2026-11-28, evening, quiet machine, three runs each, under a load average of 2.37 to 2.87) 24, 25 and 24 ms, 27, 25 and 27 ms and 13, 14 and 12 ms: inside the ranges of the first two runs ✅[^lab-cross].
- **Both runs.** In both runs the callback came after two forced collections on Node.js and in the shell and after one on Bun ✅[^lab-cross]. The same, with one callback each time, in the third run ✅[^lab-cross].
- **SpiderMonkey shell.** In the SpiderMonkey shell of Firefox 161.0 the callback came one turn after `gc()`, as on Node.js; its `setTimeout` does not wait, so a time in milliseconds is not comparable ✅[^lab-sm].
- **Unreachable registry.** A registry that is itself unreachable never calls back ✅[^lab-cross]: the registry has to stay reachable for as long as its callbacks matter.
**Exceptions:** a finalizer as a safety net or diagnostic for resources that are also released explicitly.
**Check it:** code review: every resource the callback touches has another release path; in a test, the program is correct with the callback removed.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §4.4 "`WeakMap`, `WeakRef` and `FinalizationRegistry`"; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.33.

### `JL-G6` A hot loop writes into a buffer allocated once instead of building a new array per call
**Seen in code as:** `input.map(...)`, `slice()` or `Array.from(...)` inside a function called per frame, per message or per element, whose result is used and dropped; the same for an object the function returns or stores.
**Prefer:**
```js
const scratch = new Array(input.length).fill(0);   // allocated once
function step() { for (let i = 0; i < input.length; i++) scratch[i] = input[i] * 2; use(scratch); }
```
**Avoid:**
```js
function step() { const doubled = input.map((x) => x * 2); use(doubled); }   // a new array per call
```
**Why:** the number of scavenges follows how much a program allocates ✅[^lab]; each scavenge pauses the thread to copy survivors ✅[^trash]. Garbage that dies at once is cheap per byte but not free. It applies to code that runs thousands of times and allocates an array (or an object that is returned or stored) per run that dies soon after.
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64), 20,000 calls on a 1,000-element array: `input.map(...)` per call caused 158 or 159 scavenges, the reused array 0 (counts, five runs) ✅[^lab]; the counts come from `PerformanceObserver` entries of type `gc` ✅[^nodeperf]. The reused array also gave 0 on Node.js 22.23.4 and Electron 43.7.7. The `map` form gave 161 on Node.js 22.23.4, 157 on 25.7.0, 193 to 195 on Electron 43.7.7 (seen only there; cause not isolated), and 79 on the Node.js 24.22.3 pointer-compression build against 158 on the official build of the same V8 in the same virtual machine ✅[^lab-matrix]. Not checked in Chrome: the script reads Node.js GC performance entries and `node:v8`, and a page cannot read scavenge counts (V8's `--trace-gc` output does not reach it) ✅[^lab-matrix]. No time per scavenge is claimed here.
**Exceptions:** a small object literal (`{ x, y }`) that never leaves one optimized function is not allocated at all and is better not hoisted into shared state: `JE-F11` in [functions-and-optimization.md](functions-and-optimization.md), which says what it does not cover. The lab here measured arrays from `map` only. The buffer becomes shared mutable state: data can leak between uses, and callers must not keep a reference to it. Not worth it outside hot code.
**Check it:** count GCs with a `PerformanceObserver` on `entryTypes: ['gc']` (Node.js) or run with `node --trace-gc`; expect the scavenge count to drop. A page has neither; the developer tools' Performance panel shows GC events there (general guidance, not measured here).
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §4.5 "Allocation rate and the young generation's size", §6.3 "Trade-offs" and §6.4 "Other builds and versions".

### `JL-G7` `x = null` on locals that go out of scope anyway frees nothing
**Seen in code as:** `big = null` or `delete`-style clean-up lines at the end of a function, for a variable no closure captures, added "to free memory".
**Keep writing:** plain locals that go out of scope. A variable is set to `null` only when it outlives its use: a variable captured by a long-lived closure (`JL-G1`), a field of a long-lived object, a module-level variable.
**Why:** `null` only makes a value unreachable; the collector frees what is unreachable when it next runs, and a local that leaves scope is unreachable already ✅[^lab].
**Evidence:** Node.js 24.22.1 (V8 13.6, arm64), a 15 MiB array, three runs: `heapUsed` stayed at 19.1 MiB after `big = null` and fell to 3.8 MiB only at the next full GC (bytes) ✅[^lab]. The same on every build without pointer compression; with it on, 9.7 MiB falling to 2.1 MiB on Electron 43.7.7 and 10.0 MiB falling to 2.4 MiB on the Node.js 24.22.3 pointer-compression build; in Chrome 158 (V8 15.8, page variant, `usedJSHeapSize` after `gc()`) 8.1 MiB after `big = null`, falling to 0.4 MiB at the next full GC ✅[^lab-matrix].
**Exceptions:** the cases named under **Keep writing**.
**Check it:** `heapUsed` after `gc()` with and without the `null` line: no difference for a plain local.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §6.1 "Corrections", row "Setting a variable to `null` frees memory", and §6.4 (Chrome page variants).

### `JL-G8` `global.gc()` in production code does not keep memory low
**Seen in code as:** `global.gc()`, `globalThis.gc()` or a `--expose-gc` flag in production code, a scheduler or a request handler.
**Keep writing:** no forced GC; fix what keeps memory reachable (`JL-G1` to `JL-G4`). `gc()` belongs in tests and measurements.
**Why:** `gc()` needs `--expose-gc` ✅[^nodecli] and runs a synchronous full GC ✅[^gcext] that marks the whole heap inside one pause ✅[^lab], while V8's own full GCs mark mostly on other threads while JavaScript keeps running ✅[^cmark]. It cannot free anything still reachable.
**Evidence:** In all three runs the pause grew with the live heap and Chrome's was the shorter or equal at each size; the higher re-run times on the macOS host came in runs at a load average of 20 to 37, and on the quiet machine of the third run (load average 1.69 to 2.96) the macOS host's pauses were below both earlier runs: the highs went with the load, and no run tested load alone ✅[^lab-matrix]. The pause grew with the live heap on every build that ran it (the macOS runs of Node.js 22.23.4, 24.22.1 and 25.7.0 gave the same order and ratio); the emulated builds were not run, because their timings mean nothing.
- **Node.js 24.22.1 (V8 13.6, arm64), median pause of one `gc()` call:**
  - first run (2026-11-26, three runs, load not recorded) 2.7 to 4.1 ms at 9 MiB, 17.2 to 17.9 ms at 52 MiB and 51.2 to 63.7 ms at 152 MiB of live small objects, after an earlier run that day had given 2.6, 16.0 and 46.2 ms ✅[^lab];
  - re-run (2026-11-28, after the restart, three runs, under a load average of 20 or more from other jobs, load not recorded per run) 2.8 to 3.3, 16.6 to 17.6 and 44.7 to 46.5 ms ✅[^lab];
  - third run (2026-11-28, evening, quiet machine, three runs, under a load average of 1.69 to 2.90) 2.6 to 3.4, 16.1 to 16.9 and 44.5 to 45.3 ms ✅[^lab].
  - The quiet run (44.5 to 45.3 ms at a load average of 1.69 to 2.90) agrees with the re-run (44.7 to 46.5 ms at a load average of 20 or more), so the lower pause at 152 MiB came back at a low load and load does not explain it; the first run's 51.2 to 63.7 ms was not reproduced by either later run ✅[^lab].
- **Trace of one small script.** In the trace of one small script (Node.js 24.22.1), a full collection that V8 started itself paused 14.6 to 22.67 ms in the first run (2026-11-26; the 22.67 ms pause began at a heap of 53.3 MB) and 49.23 ms in the re-run (one run, under the same load, not recorded per run), and a forced `gc()` on a heap of 5.9 MB paused 1.81 ms in the first run and 3.64 ms in the re-run; the heaps differ, so the two kinds are not compared with each other ✅[^lab-matrix].
- **Trace, third run** (2026-11-28, evening, quiet machine, three runs each): the full collection that V8 started itself paused 14.10, 25.54 and 14.25 ms (load average 2.76, 2.15 and 2.07 at the start), and the forced `gc()` on the heap of 5.9 MB 2.04, 1.48 and 1.69 ms (2.74, 2.17 and 1.91) ✅[^lab-matrix]. Over the three runs the V8-started collection paused 14.10 to 49.23 ms and the forced one 1.48 to 3.64 ms; on a quiet machine the V8-started one stayed at about 14 to 26 ms, so the re-run's 49.23 ms went with its load average of 20 or more: it did not come back in the third run's runs, started at 2.07 to 2.76 ✅[^lab-matrix].
- **On Electron 43.7.7 (V8 15.0, pointer compression on):**
  - 2.2, 11.2 and 34.0 ms at 5, 26 and 76 MiB in the first run (2026-11-27) ✅[^lab-matrix];
  - 1.3 to 1.4, 8.2 to 8.6 and 22.6 to 22.9 ms in the re-run (2026-11-28, after the restart, three runs) ✅[^lab-matrix];
  - 1.4 to 1.6, 8.3 to 8.4 and 22.6 to 28.7 ms in the third run (2026-11-28, evening, quiet machine, three runs, under a load average of 1.91 to 2.74) ✅[^lab-matrix].
- **Chrome 158 (V8 15.8, headless page)** at 3, 24 to 25 and 74 MiB, against the same variant on Node.js 24.22.1, macOS arm64, at 9, 52 and 152 MiB:
  - first run (2026-11-27, three runs, with other jobs running, load average 8 to 12) 1.1 to 1.3, 6.4 to 7.1 and 18.0 to 18.5 ms against 1.6 to 1.7, 8.0 to 9.0 and 21.7 to 25.3 ms ✅[^lab-matrix];
  - re-run (2026-11-28, after the restart, six runs each, load average 20 to 37) 1.1 to 1.7, 6.8 to 8.5 and 18.3 to 21.6 ms against 2.4 to 9.0, 11.3 to 23.0 and 32.4 to 55.4 ms ✅[^lab-matrix];
  - third run (2026-11-28, evening, quiet machine, three runs each, no visible window; Chrome under a load average of 2.23 to 2.41, the macOS host 1.69 to 2.96, which printed 8 MiB at the smallest size) 1.2 to 1.3, 6.1 to 6.9 and 17.2 to 17.4 ms against 1.3 to 1.4, 6.6 to 7.2 and 18.0 to 20.1 ms; run by run Chrome's pause was shorter at the two larger sizes in every run and at the smallest size in two of three, and equal (1.3 ms) in the other ✅[^lab-matrix].
  - Over the three runs: 1.1 to 1.7, 6.1 to 8.5 and 17.2 to 21.6 ms in Chrome against 1.3 to 9.0, 6.6 to 23.0 and 18.0 to 55.4 ms on the macOS host ✅[^lab-matrix].
**Exceptions:** none found in the lab.
**Check it:** `grep -rn "\bgc()" src/` and look for `--expose-gc` in start scripts and Dockerfiles.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §6.1 "Corrections", row "`global.gc()` should be called in production", and §6.4 (Chrome page variants).

## Takeaways
- A closure keeps alive everything its sibling closures in the same scope captured; ten tiny closures kept 76.3 MiB ✅[^lab]. [rule-candidate]
- A timer or listener keeps its captures until it is removed, and a kept `stop()` handle keeps them after stopping ✅[^lab].
- A slice kept for long is copied with `[...part].join('')`: V8 keeps the parent from 13 characters, JavaScriptCore from 3, the SpiderMonkey shell only above 1,048,576 ✅[^lab-cross] ✅[^lab-sm].
- A `WeakMap` entry is freed at the next full GC in V8, not at a scavenge, and the specification promises no collection at all ✅[^tc39].
- `null` on a plain local and `global.gc()` in production free nothing that was not going to be freed; the forced GC adds a pause that grows with the live heap ✅[^lab].

## Verification status
- Verified: 121 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab: the scripts of the V8 memory deep dive run on 2026-11-26 with Node.js 24.22.1 (V8 13.6.233.17-node.58) in the `node:24.22.1-alpine` image, arm64, 8 CPUs, 8 GiB, `--network none`, pointer compression off, and re-run on 2026-11-28 after a restart of the lab machine (every baseline output matched; timings in `JL-G8`), with its timing scripts run three times more in the evening of 2026-11-28 on a quiet machine (third run); scripts and outputs in [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §4 and §6. Rank 1 (primary measurement). Backs: Summary, Scope, Catalog, Lookup notes, Takeaways. [^lab]
- Lab matrix: the same scripts run again on 2026-11-27 on macOS 26.1 arm64 with Node.js 24.22.1, 22.23.4 (V8 12.4) and 25.7.0 (V8 14.1); linux x64 emulated with Node.js 24.22.1; Electron 43.7.7 run as Node (V8 15.0, pointer compression on); the Node.js 24.22.3 pointer-compression build (V8 13.6, emulated linux x64); and Google Chrome 158.0.8127.89 (V8 15.8.62.31, macOS arm64, headless, page variants), and re-run on 2026-11-28 after a restart of the lab machine (every cell matched; the timing changes are in Verification status there), with the timing scripts run three times more in the evening of 2026-11-28 on a quiet machine (third run, each run started below a load average of 3.0); outputs in [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §6.4 "Other builds and versions (2026-11-27)". Rank 1 (primary measurement). Backs: Scope, Lookup notes. [^lab-matrix]
- Lab SpiderMonkey shell: the SpiderMonkey JavaScript shell of Firefox 161.0 (`jsshell-linux-aarch64.zip` from Mozilla's release archive, `js --version` prints `JavaScript-C161.0`), run in an `ubuntu:24.04` linux arm64 container with no network on the same Apple M2 on 2026-11-28; heap figure `gcBytes + mallocBytes` of `performance.mozMemory.gc` after `gc()`; each check script run three times; it is SpiderMonkey on Linux, not a Firefox page; scripts and outputs in [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §2.1 and §4.34. Rank 1 (primary measurement). Backs: Scope, Catalog `JL-G3`, Lookup notes `JL-G1`, `JL-G3`, `JL-G5`, Takeaways. [^lab-sm]
- Lab cross-engine: the engine-neutral checks of 2026-11-28 on one Apple M2: V8 in Node.js 24.22.1 (macOS arm64) and Google Chrome 158.0.8127.89, SpiderMonkey in Firefox 161.0 (headless), JavaScriptCore in the `jsc` shell of macOS 26.1 (framework 21622.2.11.11.9), Bun 1.4.5 (linux arm64 container) and the Playwright WebKit build 2311; each check script run three times per environment (first run, load average 2.1 to 13.8), and every script run again three times per environment on 2026-11-28 after a restart of the lab machine (re-run, `uptime` logged before every run), and the timing scripts run three times more per environment in the evening of 2026-11-28 on a quiet machine (third run, each run started below a load average of 3.0);
  scripts and outputs in [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.30 to §4.33 and Verification status. Rank 1 (primary measurement). Backs: Scope, Catalog `JL-G3`, Lookup notes, Takeaways. [^lab-cross]
- Spot check for this doc: the script in the `JL-G3` note, an extension of `sliced-string.mjs` of the V8 memory deep dive, run on 2026-11-28 with `docker run --rm --network none node:24.22.1-alpine node --expose-gc` (Node.js 24.22.1, V8 13.6.233.17, linux arm64), one process per case, 60 cases; command and output in that note; run once more by a reviewer the same day. Rank 1 (primary measurement). Backs: Lookup notes, JL-G3. [^spot]
- [ECMAScript 2027 Language Specification, §9.9 Processing Model of WeakRef and FinalizationRegistry Targets, §9.10 ClearKeptObjects, §9.11 AddToKeptObjects](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html) — Ecma TC39, living draft. Rank 1. Backs: Summary, Catalog `JL-G5`, Lookup notes `JL-G4`, `JL-G5`, Takeaways. [^tc39]
- [ECMAScript Language Specification, §9.9 to §9.11 and §26.1 WeakRef objects](https://tc39.es/ecma262/multipage/managing-memory.html) — Ecma TC39, living draft. Rank 1. Backs: Lookup notes `JL-G3` (a string cannot be a `WeakRef` target). [^tc39weak]
- [src/objects/string.h at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/objects/string.h) — V8 project, 2025. Rank 1. Backs: Scope, Lookup notes `JL-G3` (sliced strings, `kMinLength = 13`). [^strh]
- [src/extensions/gc-extension.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/extensions/gc-extension.cc) — V8 project, 2025. Rank 1. Backs: Lookup notes `JL-G8` (`gc()` runs a synchronous major GC). [^gcext]
- [Command-line API](https://nodejs.org/docs/latest-v24.x/api/cli.html) — Node.js, v24.22.3 docs. Rank 1. Backs: Lookup notes `JL-G8` (`--expose-gc`). [^nodecli]
- [Performance measurement APIs](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html) — Node.js, v24.22.3 docs. Rank 1. Backs: Lookup notes `JL-G6` (`gc` entry kinds). [^nodeperf]
- [Events](https://nodejs.org/api/events.html) — Node.js project, living. Rank 1. Backs: Lookup notes `JL-G2` (the 10-listener warning). [^node-events]
- [JavaScriptCore](https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html) — WebKit project documentation, living. Rank 1. Backs: Scope (JavaScriptCore is WebKit's engine). [^jsc]
- [Welcome to Bun](https://bun.com/docs) — Bun documentation, living. Rank 1. Backs: Scope (Bun runs on JavaScriptCore). [^bun]
- [Trash talk: the Orinoco garbage collector](https://v8.dev/blog/trash-talk) — V8 team (Peter Marshall), 2019-01-03. Rank 4. Backs: Scope (generations, scavenges, promotion), Lookup notes `JL-G6`. [^trash]
- [Concurrent marking in V8](https://v8.dev/blog/concurrent-marking) — V8 team (Degenbaev, Lippautz, Payer), 2018-06-11. Rank 4. Backs: Lookup notes `JL-G8` (V8's own full GCs mark concurrently). [^cmark]
- [Weak references and finalizers](https://v8.dev/features/weak-references) — V8 team (Gunasekaran, Bynens, Guo, Swirski), 2019-07-09, updated 2020-06-19. Rank 4. Backs: Lookup notes `JL-G5`. [^weakfeat]

## Related
- [language-patterns.md](language-patterns.md) — array, sort, error and TypeScript patterns (`JL-L`).
- [async-and-promises.md](async-and-promises.md) — `await`, promise ownership and abort listeners (`JL-A`, including `JL-A7`).
- [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) — V8's garbage collector, what keeps memory alive, and the lab behind every `JL-G` number.
- [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) — the cross-engine checks of `JL-G1` to `JL-G5`.
- [problem-classes.md](../../performance/code-review/problem-classes.md) — the `resource-leak` and `allocation-gc` classes.
- [objects-references-and-this.md](../object-basics/objects-references-and-this.md) — reachability and garbage-collection basics.
