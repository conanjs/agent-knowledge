---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24 (docs v24.22.3)", "lab on Node.js 24.22.1 (V8 13.6.233.17, libuv 1.52.1, linux arm64, 8 CPUs), 2026-11-26", "re-run 2026-11-27 on Node.js 22.23.4, 24.22.1 (macOS arm64, linux x64 emulated), 25.7.0, Electron 43.7.7 (Node.js 24.21.0 API) and Node.js 24.22.3 with pointer compression", "microtask trial also on Bun 1.4.5, the macOS 26.1 jsc shell, Chrome 158, Firefox 161 and a WebKit page, 2026-11-28", "microtask trial run a third time 2026-11-28, evening, on a quiet machine"]
last-verified: 2026-11-28
last-updated: 2026-11-29
tags: [javascript, best-practices, nodejs, event-loop, libuv, thread-pool, microtasks, async-hooks]
derived-from: [js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: the Node.js event loop and its thread pool

## Summary
**TL;DR:** Node.js runs JavaScript callbacks on one thread and sends file, DNS (domain name system) lookup, crypto and compression work to a shared pool of 4 threads. The practices here keep both free: cap long pool tasks, set the pool size in the environment, yield with `setImmediate`, carry context with `AsyncLocalStorage`, and keep synchronous calls and slow hashes out of per-request code. Two results matter most: with 4 `crypto.pbkdf2` calls in flight, an unrelated `fs.readFile` and `dns.lookup` waited for a hash, and with 8 threads they did not ✅[^lab]; 100,000 steps scheduled with `process.nextTick` or `queueMicrotask` all ran before a 0 ms timer ✅[^lab].
**Use this when:** writing or reviewing Node.js server, worker or job code that hashes, compresses, reads files, looks up host names, schedules many small steps or tracks request context; or a cheap endpoint gets slow while heavy work runs.
**Not this doc:** streams, buffers and file listing → [nodejs-streams-buffers-and-io.md](nodejs-streams-buffers-and-io.md); worker threads and pools → [nodejs-worker-threads.md](nodejs-worker-threads.md); heap flags and container limits → [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md); starting independent promises together → [async-and-promises.md](async-and-promises.md); the measured classes behind these rules → [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md).

## Scope
Nine practices for the event loop, the libuv thread pool, microtasks, `async_hooks`, synchronous APIs, timers, source maps and password hashing per request. The lab numbers come from Node.js 24.22.1 (V8 13.6.233.17, libuv 1.52.1, linux arm64, 8 CPUs) on 2026-11-26, re-run on 2026-11-27 on six more builds; the other practices rest on the Node.js 24 docs (v24.22.3), the Node.js source, OWASP (Open Worldwide Application Security Project) and NIST (National Institute of Standards and Technology), as each note says. The claims hold for Node.js; only `JN-E3` was also run on other engines. Not run: Windows, native x64 hardware, other CPU counts or pool sizes than 4 and 8 threads on 8 CPUs, and any timing of source maps, `async_hooks` or password hashes.

**How the timings were taken.** The conclusion is the order (the chain of microtasks finished before the 0 ms timer) and how the engines compare, which held in all three runs; the milliseconds are quoted as the machine printed them under that load, and will differ on another machine or under another load.
- **Machine.** All runs were made on one Apple M2 laptop, macOS 26.1; the Linux builds ran in containers in a virtual machine on it, and the x64 builds were emulated ✅[^lab-matrix].
- **Scripts that print an order or a count.** The scripts behind `JN-E1`, `JN-E3` and `JN-E4` print an order or a count, not a time: first run (2026-11-26, the other builds 2026-11-27) and re-run (2026-11-28, after the restart), whose 40 results all matched the first run; load not recorded ✅[^lab].
- **The only times.** The only times in this doc are those of the cross-engine microtask trial in `JN-E3`.
  - **First run.** Its first run (2026-11-28, before the restart) had a one-minute load average 2.1 to 13.8 at the start of the runs over the whole cross-engine lab; for its browser windows the runner did not yet check for a locked screen or keep one browser window at a time, so the conditions of that run are not fully known ✅[^lab-cross].
  - **Re-run.** Its re-run (2026-11-28, after the restart: screen unlocked, one browser window at a time, one timing run at a time) had a one-minute load average 3.0 to 11.7 at the start of the runs ✅[^lab-cross].
  - **Third run.** Its third run (2026-11-28, evening, quiet machine) covered the timing scripts only, with the re-run's commands, three runs per environment, one run at a time; each run started only when the one-minute load average was below 3.0, and no other lab job ran, while the owner's desktop applications, a browser among them, stayed open ✅[^lab-cross]. One-minute load average 1.75 to 2.97 at the start of the runs of that lab's §2 and §4.18 to §4.33 (median 2.61), 1.81 to 2.87 for the microtask trial ✅[^lab-cross].
  - **Which values to quote.** The third run is the only one made under a controlled load: where the runs differ, its values are the ones to quote for a quiet machine, and the earlier values stay as the record of what load and uncontrolled conditions do.

How to read the "Applies" column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it).

Terms:
- **Event loop:** the one thread that runs JavaScript callbacks one after another, like one waiter serving every table.
- **libuv thread pool:** a small fixed set of background threads (4 by default) for file, DNS lookup, crypto and compression work, like four cooks: four slow dishes keep every other order waiting.
- **Microtask:** a callback that runs right after the current one, before the loop moves on (`await` continuations, `queueMicrotask`, `process.nextTick`), like the orders a waiter takes before leaving a table.
- **Async resource:** an object that `async_hooks` tracks because it may call back later (a promise, a timer, a socket), like a ticket for each pending order.
- **Source map:** a file that maps compiled JavaScript positions back to the original source, like a translation table.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JN-E1` | Many concurrent `crypto.pbkdf2`/`scrypt`/`randomBytes`/`generateKeyPair`, async `zlib` per response, or `Promise.all` over many `fs.promises` calls in a server | Cap them at the pool size (a limiter of 4); set `UV_THREADPOOL_SIZE` in the deploy environment | hot path | A read and a lookup issued after 4 `pbkdf2` calls waited for a hash with 4 threads, not with 8, on Node.js 24.22.1 ✅[^lab] and six more builds ✅[^lab-matrix] |
| `JN-E2` | `process.env.UV_THREADPOOL_SIZE = …` in a source file | Set it in the Dockerfile, start script or manifest environment | always | Setting it inside the program "is not guaranteed to work" (Node.js 24 docs) ✅[^node-cli] |
| `JN-E3` | Recursive `process.nextTick`/`queueMicrotask` to "break up" work, or a loop of `await` on already-resolved values | Yield with `await new Promise((r) => setImmediate(r))` every k steps, or use a worker | hot path | 100,000 `nextTick` or `queueMicrotask` steps all ran before a 0 ms timer; with `setImmediate` the timer ran in between (Node.js 24.22.1) ✅[^lab] |
| `JN-E4` | `async_hooks.createHook({ init, destroy }).enable()` in app or tracing code | Use `AsyncLocalStorage`; if a hook stays, `trackPromises: false` and no `destroy` hook | check build | 2004 `init` calls for 1,000 `await`s, 0 with `trackPromises: false` on 24.22.1 ✅[^lab]; 2003 with the option on 22.23.4 ✅[^lab-matrix] |
| `JN-E5` | A plan to drop `AsyncLocalStorage` "because it uses async_hooks and is slow" | Keep it on Node.js 24; only `--no-async-context-frame` brings back the old implementation | no gain | On Node.js 24 it is backed by `AsyncContextFrame` unless that flag is set ✅[^node-cli] |
| `JN-E6` | `readFileSync`, `gzipSync`, `pbkdf2Sync`, `execSync`, `spawnSync` inside a handler or job processor | Use the async API (`fs.promises`, promisified `zlib`), or a worker for CPU work | hot path | Synchronous APIs block the event loop ✅[^node-dontblock]; `spawnSync` drives event-loop utilization to 1 ✅[^node-perf] |
| `JN-E7` | A plan to replace per-item `setTimeout` with a hand-made timer wheel for speed | Keep one timer per item; `clearTimeout` on removal | no gain | Node.js keeps timers in duration lists and a binary heap with worst-case O(log n) operations ✅[^node-timers-src] |
| `JN-E8` | `--enable-source-maps` in start flags plus `new Error().stack` per call, or errors for expected outcomes | Read `stack` only for logged errors; return values for expected outcomes | hot path | Source maps "can introduce latency" when `Error.stack` is accessed (Node.js 24 docs) ✅[^node-cli] |
| `JN-E9` | `bcrypt.compare`/`argon2.verify`/`scrypt` in middleware for every API request | Verify once at login and issue a session; store random API tokens (112+ bits) as SHA-256 | hot path | OWASP's minimum costs (for example Argon2id 19 MiB and 2 iterations, PBKDF2 600,000 iterations) are paid per request ✅[^owasp-pw] |

## Lookup notes
### `JN-E1` Cap concurrent long pool tasks, and size the pool in the deploy environment
**Seen in code as:** `crypto.pbkdf2`, `scrypt`, `randomBytes` or `generateKeyPair`; async `zlib.gzip` or `brotliCompress` per response; `Promise.all` over many `fs.promises` calls in a server.
**Prefer:**
```js
import pLimit from 'p-limit';
const poolHeavy = pLimit(4); // at most the pool size (UV_THREADPOOL_SIZE, default 4)
const hash = (pw, salt) => poolHeavy(() => pbkdf2(pw, salt, 600_000, 64, 'sha512'));
// and in the Dockerfile or manifest, not in code: ENV UV_THREADPOOL_SIZE=8
```
**Avoid:**
```js
app.post('/login', async (req, res) => {
  const key = await pbkdf2(req.body.pw, salt, 600_000, 64, 'sha512'); // unbounded
});
await Promise.all(paths.map((p) => fs.promises.readFile(p)));    // 10,000 paths at once
```
**Why:** The pool serves every `fs` call except the watchers and the `*Sync` calls, the async crypto APIs, `dns.lookup` and the async `zlib` APIs, with 4 threads by default ✅[^node-cli]. Each long task holds one thread until it ends ✅[^node-dontblock], so with 4 in flight an unrelated read or lookup waits. Outgoing HTTP or database connections to host names go through `dns.lookup` too, because other networking APIs call it ✅[^node-dns]. This matters when hashing, compression or many `fs` or `dns.lookup` calls can reach 4 in flight under real load.
**Evidence:** Lab run 1, Node.js 24.22.1, 3 runs: a `fs.readFile` and a `dns.lookup('localhost')` issued after four `crypto.pbkdf2` calls both waited for a hash with the default pool, and neither waited with `UV_THREADPOOL_SIZE=8` ✅[^lab]. Same output on Node.js 24.22.1 on macOS arm64 and emulated x64, 22.23.4, 25.7.0, Electron 43.7.7 run as Node and the Node.js 24.22.3 pointer-compression build ✅[^lab-matrix]. The re-run (2026-11-28, after the restart) gave the same order, unset and with 8 threads, in three runs ✅[^lab].
**Exceptions:** Pool work is rare or short; the process does one job at a time (a command-line tool or a batch script); the only I/O (input/output) is network sockets, which do not use the pool. `dns.resolve*` skips the pool but always queries the network and ignores `/etc/hosts`, so switching changes behaviour ✅[^node-dns]. No page gives a recommended pool size; libuv's maximum is 1024 ✅[^libuv-tp]. Related, not the same practice: `JL-A3` in [async-and-promises.md](async-and-promises.md) starts independent async calls together and caps how many run at once; `JB-F7` in [browser-component-frameworks.md](browser-component-frameworks.md) does the same for fetches in a browser. This one is about the 4 threads that Node.js shares between `fs`, DNS, crypto and `zlib`.
**Check it:** Run the lab's `threadpool.mjs` with and without `UV_THREADPOOL_SIZE=8`; in production, compare the latency of a cheap file-reading endpoint with and without hashing load.
**Full lab:** [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, lab run 1, and "Other builds and versions".

### `JN-E2` Set `UV_THREADPOOL_SIZE` in the process environment, never from code
**Prefer:**
```sh
UV_THREADPOOL_SIZE=16 node server.js   # or ENV in the Dockerfile, env: in the manifest
```
**Avoid:**
```js
process.env.UV_THREADPOOL_SIZE = '16'; // at the top of server.js
```
**Why:** The pool may already exist when the line runs, and a pool that exists keeps its size.
**Evidence:** The Node.js 24 command-line docs say setting it inside the program "is not guaranteed to work", because the pool may already exist ✅[^node-cli]. A documented statement; the lab did not test the in-code form.
**Exceptions:** None found.
**Check it:** `grep -rn "UV_THREADPOOL_SIZE" src/` should find nothing; look for it in the Dockerfile, start script or manifest instead.
**Full lab:** none; the statement is in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, "Corrections found while checking the sources".

### `JN-E3` Yield to the event loop with `setImmediate`, not `nextTick`, `queueMicrotask` or a resolved `await`
**Seen in code as:** a recursive `process.nextTick(step)` or `queueMicrotask(step)` meant to "break up" work; an `async` loop whose `await`s only meet already-resolved values, such as `await cache.get(k)` on an in-memory cache.
**Prefer:**
```js
for (let i = 0; i < items.length; i++) {
  work(items[i]);
  if (i % 1000 === 999) await new Promise((r) => setImmediate(r)); // timers and I/O run here
}
```
**Avoid:**
```js
function step(i) { work(items[i]); if (++i < items.length) process.nextTick(step, i); }
for (const k of keys) total += await memoryCache.get(k); // never reaches the event loop
```
**Why:** The next-tick queue is drained completely before the loop continues, and the microtask queue right after it ✅[^node-process], so timers and I/O wait until every step has run. Recursive `process.nextTick` calls can starve I/O, and the Node.js guide recommends `setImmediate()` ✅[^node-loop-guide]; `setImmediate` puts the next step behind pending I/O ✅[^node-loop-guide]. The loop size that matters is many steps; the lab used 100,000.
**Evidence:** Lab run 2, Node.js 24.22.1: 100,000 steps scheduled recursively with `process.nextTick` or `queueMicrotask` all ran before a 0 ms timer; with `setImmediate` the timer ran in between ✅[^lab]. Same on all six other builds ✅[^lab-matrix], and in the re-run (2026-11-28, after the restart) ✅[^lab]. The docs state the starvation for `process.nextTick` only ✅[^node-loop-guide]. The lab script did not test a resolved `await` ✅[^lab]: that case follows from `await` continuations being microtasks. The resolved `await` case, re-run for this doc on Node.js 24.22.1 in the same image: a loop of 100,000 `await Promise.resolve(i)` finished before the 0 ms timer ✅[^spot].
<details><summary>Spot check: resolved awaits against a 0 ms timer</summary>

`docker run --rm --network none node:24.22.1-alpine node --input-type=module -e '<script>'`:
```js
let timerRan = false; setTimeout(() => { timerRan = true; }, 0);
for (let i = 0; i < 100_000; i++) await Promise.resolve(i);
console.log("100000 resolved awaits finished before the 0 ms timer:", !timerRan);
```
```text
100000 resolved awaits finished before the 0 ms timer: true
```
</details>

**Other engines:** holds on all three engines: a chain of 100,000 `queueMicrotask` steps (on the `jsc` shell, which has no `queueMicrotask`, `Promise.resolve().then` steps) started after a 0 ms timer finished before the timer ran, or in the same millisecond, in every run of the three runs, on Node.js 24.22.1, Bun 1.4.5 (JavaScriptCore), the macOS 26.1 `jsc` shell, Chrome 158, Firefox 161 (SpiderMonkey) and a WebKit page ✅[^lab-cross]. The chain was done, after the start, at:
- first run (2026-11-28, before the restart; six runs per environment, load average 2.1 to 13.8 over the lab): 3.7 to 4.5 ms (Node.js), 2.2 to 3.6 ms (Bun), 9 to 14 ms (`jsc` shell), 25 to 27 ms (Chrome), 32 to 48 ms (Firefox) and 2.0 to 3.0 ms (WebKit page) ✅[^lab-cross];
- re-run (2026-11-28, after the restart; three runs per environment, under a one-minute load average of 3.0 to 11.7 at the start of the runs): 3.5 to 3.7 ms, 2.9 to 4.9 ms, 9.9 to 13.3 ms, 28.1 to 38.5 ms, 28.0 to 34.0 ms and 3.0 to 5.0 ms ✅[^lab-cross];
- over both runs (nine runs per environment): 3.5 to 4.5 ms (Node.js), 2.2 to 4.9 ms (Bun), 9 to 14 ms (`jsc` shell), 25 to 38.5 ms (Chrome), 28 to 48 ms (Firefox) and 2.0 to 5.0 ms (WebKit page), with the timer 0.0 to 22.7 ms after the chain ✅[^lab-cross];
- third run (2026-11-28, evening, quiet machine; three runs per environment, runs 1, 2 and 3): 3.8, 4.6 and 4.1 ms (Node.js, loads 2.28, 2.46 and 2.47 at their start), 3.7, 2.4 and 2.4 ms (Bun, 2.52, 2.53 and 2.86), 12.2, 10.0 and 12.6 ms (`jsc` shell, 2.66, 2.53 and 2.67), 29.8, 28.4 and 27.7 ms (Chrome, 2.39, 2.87 and 1.88), 35.5, 38.0 and 54.7 ms (Firefox, 2.66, 2.58 and 2.47) and 2.0, 2.0 and 3.0 ms (WebKit page, 2.39, 2.72 and 1.81), with the timer 0.0 to 23.9 ms after the chain ✅[^lab-cross];
- over the three runs (twelve runs per environment): 3.5 to 4.6 ms (Node.js), 2.2 to 4.9 ms (Bun), 9 to 14 ms (`jsc` shell), 25 to 38.5 ms (Chrome), 28 to 54.7 ms (Firefox) and 2.0 to 5.0 ms (WebKit page), with the timer 0.0 to 23.9 ms after the chain; Firefox's slowest chain, 54.7 ms, came in a third-run run started at a load of 2.47, so it needed no high load ✅[^lab-cross].
What holds over the three runs: the order, in every engine; Chrome and Firefox took several times as long as Node.js, Bun and the WebKit page for the same chain (6 to 14 times Node.js's time over the ranges of both earlier runs, 6 to 13 times in the third run, which is each Chrome or Firefox time divided by Node.js's time of the same run: 7.8, 6.2 and 6.8 for Chrome and 9.3, 8.3 and 13.3 for Firefox). `process.nextTick` and `setImmediate` were not run off Node.js.
**Exceptions:** Few steps; each step awaits real I/O (each wait returns to the loop); a single `nextTick` to emit an event after the caller attached its handlers ✅[^node-process]. Related, not the same practice: `JL-A1` in [async-and-promises.md](async-and-promises.md) removes the needless `await` of a non-promise value in a loop; this one lets timers and I/O run during a long loop.
**Check it:** `perf_hooks.monitorEventLoopDelay()` (resolution default 10 ms in Node.js 24) ✅[^node-perf] shows the delay; or run the lab's `starve.mjs`.
**Full lab:** [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, lab run 2; [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.29.

### `JN-E4` Carry request context with `AsyncLocalStorage`, not an `async_hooks` hook
**Seen in code as:** `async_hooks.createHook({ init, before, after, destroy }).enable()` in application code or an in-house tracing library; `executionAsyncResource()` used for context.
**Prefer:**
```js
import { AsyncLocalStorage } from 'node:async_hooks';
const requestContext = new AsyncLocalStorage();
app.use((req, res, next) => requestContext.run({ id: req.id }, next));
// if a hook must stay: createHook({ init, trackPromises: false }) and no destroy hook
```
**Avoid:**
```js
const ctx = new Map();
createHook({ init(id, type, trigger) { ctx.set(id, ctx.get(trigger)); },
             destroy(id) { ctx.delete(id); } }).enable();
```
**Why:** An enabled hook turns on promise tracking (`trackPromises` defaults to `true`), so its callbacks run for every promise; a `destroy` hook adds tracking of promises through the garbage collector; the Node.js 24 docs do not recommend `createHook`, citing "performance implications" ✅[^node-asynchooks].
**Evidence:** Lab run 3, Node.js 24.22.1: an `init`-only hook was called 2004 times for 1,000 `await`s, and 0 times with `trackPromises: false` ✅[^lab]. Same on Electron 43.7.7 (Node.js 24.21.0 API), 25.7.0 and 24.22.3. Differs on Node.js 22.23.4: 2004 calls with the default hook and 2003 with `trackPromises: false`, so the option is not honoured there ✅[^lab-matrix]. The re-run (2026-11-28, after the restart) gave the same counts on the baseline and on these builds ✅[^lab]. The Async hooks page gives no "added in" version for `trackPromises` ✅[^node-asynchooks], so check it on the minor version in use.
**Exceptions:** The hook runs only in a debugging session or a test; the application has few promises per request.
**Check it:** `grep -rn "createHook" src/ node_modules/` and look for `--no-async-context-frame` in `NODE_OPTIONS`; count `init` calls as the lab's `hooks.mjs` does.
**Full lab:** [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, lab run 3, and "What differs".

### `JN-E5` `AsyncLocalStorage` on Node.js 24 does not need replacing to avoid `async_hooks` cost
**Keep writing:**
```js
const store = new AsyncLocalStorage();
store.run({ requestId }, () => handle(req, res));
```
**Why:** On Node.js 24, `AsyncLocalStorage` is backed by `AsyncContextFrame`; only `--no-async-context-frame` (added in v24.0.0) brings back the older `async_hooks` implementation that the "it is slow" advice describes ✅[^node-cli]. The context docs call it "a performant and memory safe implementation" ✅[^node-alsctx]. This holds on Node.js 24 started without that flag.
**Evidence:** Documented statements; no overhead number was measured. Side check: `node --help` on 22.23.4 lists `--experimental-async-context-frame` and no `--no-async-context-frame`; 24.22.1 and 25.7.0 list `--no-async-context-frame` ✅[^lab-matrix].
**Exceptions:** `--no-async-context-frame` in `NODE_OPTIONS`, or Node.js 22. For Node.js 22 this is an inference, not a measurement: `node --help` there lists only the experimental flag (checked again on 22.23.4 on 2026-11-27) ✅[^lab-matrix], so the older implementation is presumably the default there; no source states it.
**Check it:** `node --help | grep async-context-frame`; `echo $NODE_OPTIONS`.
**Full lab:** [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, "Corrections found while checking the sources" and "What differs".

### `JN-E6` Use the async API, not `*Sync`, inside request handlers
**Seen in code as:** `fs.readFileSync`, `zlib.gzipSync`, `crypto.pbkdf2Sync`, `execSync` or `spawnSync` inside a handler, middleware or queue processor.
**Prefer:**
```js
app.get('/report', async (req, res) => {
  const body = await fs.promises.readFile(reportPath);
  res.end(await gzip(body)); // const gzip = promisify(zlib.gzip)
});
```
**Avoid:**
```js
app.get('/report', (req, res) => res.end(zlib.gzipSync(fs.readFileSync(reportPath))));
```
**Why:** A synchronous call runs on the event loop thread, so every other client waits until it returns. This matters in code that runs per request or per job.
**Evidence:** The Node.js guide "Don't Block the Event Loop" says synchronous APIs block the loop ✅[^node-dontblock]; the `perf_hooks` docs (v24.22.3) show `spawnSync` driving event-loop utilization to 1 while the CPU is mostly idle ✅[^node-perf]. Documented statements; no timing in the lab.
**Exceptions:** Code that runs once at start-up, before the server listens, does not pay this per request. Moving CPU-heavy work to the async API puts it on the pool instead (see `JN-E1`); for work of hundreds of milliseconds use a worker thread (`JN-W1` in [nodejs-worker-threads.md](nodejs-worker-threads.md)). Related, not the same practice: `JL-A8` in [async-and-promises.md](async-and-promises.md) (a long synchronous loop inside an `async` function) and `JB-R7` in [browser-rendering-and-interaction.md](browser-rendering-and-interaction.md) (main-thread work over 50 ms in a browser).
**Check it:** `performance.eventLoopUtilization()` sampled around the handler; the latency of a cheap endpoint while the slow one runs.
**Full lab:** none; the class is `blocking-in-async` in [problem-classes.md](../../performance/code-review/problem-classes.md).

### `JN-E7` One `setTimeout` per item needs no hand-made timer wheel
**Keep writing:**
```js
const t = setTimeout(() => expire(id), ttlMs);
entries.set(id, { value, t }); // and clearTimeout(entries.get(id).t) on delete
```
**Why:** Node.js keeps timers in lists keyed by duration plus a binary heap whose operations are worst-case O(log n), logarithmic in the number of timers ✅[^node-timers-src]. The cost of many timers is memory and a missing `clearTimeout`, which is a leak, not a speed problem.
**Evidence:** Node.js source `lib/internal/timers.js` (v24.x branch), read 2026-11-26 ✅[^node-timers-src]. A sourced statement; not timed.
**Exceptions:** Timers that are never cleared keep their callbacks alive: clear them.
**Check it:** `process.getActiveResourcesInfo()` counts live `Timeout` resources; the count should fall when items are removed.
**Full lab:** none; the statement is in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, "Corrections found while checking the sources".

### `JN-E8` Read `err.stack` only for errors that are logged, when the service runs with `--enable-source-maps`
**Seen in code as:** `--enable-source-maps` in `NODE_OPTIONS`, a Dockerfile `CMD` or a `start` script, together with `new Error().stack` read per call to find the caller, or errors used for expected outcomes.
**Prefer:**
```js
if (!user) return { ok: false, reason: 'not-found' };       // expected outcome: no Error
catch (err) { logger.error({ msg: err.message, stack: err.stack }); } // logged and kept
```
**Avoid:**
```js
function log(msg) { const caller = new Error().stack.split('\n')[2]; out.write(`${caller} ${msg}\n`); }
```
**Why:** With source maps on, each read of `Error.stack` maps positions back to the original source. This matters for a service that builds or reads stacks per request.
**Evidence:** The Node.js 24 command-line docs say enabling source maps "can introduce latency to your application when `Error.stack` is accessed" and ask applications that read it often to weigh this ✅[^node-cli]. The docs give no cost per read, and the lab did not time it.
**Exceptions:** Stacks are read only for rare, logged failures; the program is a command-line tool or a development build. Related, not the same practice: `JL-L5` in [language-patterns.md](language-patterns.md) is about the cost of creating error objects and of `Error.stackTraceLimit`, with or without source maps.
**Check it:** Count `stack` reads per request in a CPU profile (`node --cpu-prof`); compare profiles with and without the flag on the same load.
**Full lab:** none; the class is `source-maps-on-hot-stacks` in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md).

### `JN-E9` Verify a password once at login, not a slow hash on every API request
**Seen in code as:** `bcrypt.compare`, `argon2.verify`, `crypto.scrypt` or `pbkdf2` in middleware for every call; API keys stored as bcrypt hashes and checked per request.
**Prefer:**
```js
// API token: at least 112 bits of randomness, stored as SHA-256, looked up by id
const digest = crypto.createHash('sha256').update(token).digest('hex');
const key = await db.apiKeys.findOne({ id: tokenId, digest });
```
**Avoid:**
```js
app.use(async (req, res, next) => {
  if (!(await bcrypt.compare(req.headers['x-api-key'], account.keyHash))) return res.sendStatus(401);
  next();
});
```
**Why:** A password hash is slow on purpose. In middleware that runs on every request it costs that work n times, and `scrypt` and `pbkdf2` also occupy pool threads (`JN-E1`).
**Evidence:** The OWASP Password Storage Cheat Sheet lists Argon2id with 19 MiB of memory and 2 iterations as one of its minimum settings, bcrypt at work factor 10 or more and PBKDF2-HMAC-SHA256 at 600,000 iterations, says a hash should take under one second, and warns that a too-high work factor can be used for denial of service ✅[^owasp-pw]. NIST SP 800-63B-4: look-up secrets are stored hashed with an approved hashing function, and those shorter than 112 bits need a password hashing scheme ✅[^nist-63b]. The step from there to API tokens is an inference: neither page names API tokens. No lab timing.
**Exceptions:** Login, password change and token exchange, where the slow hash is the point ✅[^owasp-pw]; short or user-chosen API keys are passwords and need a password hashing scheme ✅[^nist-63b].
**Check it:** A CPU profile of the authentication middleware; requests per second of a cheap endpoint with and without authentication.
**Full lab:** none; the class is `slow-hash-per-request` in [problem-classes-network-and-delivery.md](../../performance/code-review/problem-classes-network-and-delivery.md).

## Takeaways
- Count the long pool tasks (hashing, compression, DNS lookups) a request can start; when they can reach the pool size of 4, unrelated file reads and lookups queue behind them. [rule-candidate]
- `UV_THREADPOOL_SIZE` belongs to the process environment, not to the source code.
- `process.nextTick`, `queueMicrotask` and `await` on resolved values do not let timers or I/O run; `setImmediate` or real I/O does.
- `AsyncLocalStorage` is the cheap way to carry context on Node.js 24; an `async_hooks` hook runs for every promise.
- A deliberately slow hash belongs to login, not to every API request.

## Verification status
- Verified: 64 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab runs on Node.js 24.22.1 (image `node:24.22.1-alpine`, V8 13.6.233.17, libuv 1.52.1, linux arm64, 8 CPUs, Apple M2 under Docker, `--network none`), 2026-11-26, each run 3 times, and re-run on 2026-11-28 after a restart of the lab machine (the scripts extracted from the catalog, three runs each on the baseline, 40 results, all matching; no script prints a time); scripts and output in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, lab runs 1 to 3, and its Verification status. Rank 1 (primary measurement). Backs: Summary; Catalog; Lookup notes. [^lab]
- Lab matrix: the same scripts re-run on 2026-11-27 on Node.js 24.22.1 (macOS 26.1 arm64, linux x64 emulated), 22.23.4 (V8 12.4, libuv 1.51.0), 25.7.0 (V8 14.1, libuv 1.51.0), Electron 43.7.7 run as Node (Node.js 24.21.0 API, V8 15.0) and Node.js 24.22.3 with pointer compression (linux x64 emulated), plus `node --help` side checks; table and differing output in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), "Other builds and versions (2026-11-27)". Rank 1 (primary measurement). Backs: Catalog, JN-E1 and JN-E4; Lookup notes. [^lab-matrix]
- Cross-engine lab: `microtask.js` run on 2026-11-28 before a restart of the lab machine (six runs per environment, one-minute load average 2.1 to 13.8 over the lab) and three times again after it (screen unlocked, one browser window at a time, one timing run at a time; load average 3.0 to 11.7 at the start of those runs, from the runner's `uptime` lines), and three times more on the evening of 2026-11-28 on a quiet machine (each run started below a load average of 3.0; 1.81 to 2.87 at their start) on Node.js 24.22.1 (macOS arm64), Chrome 158.0.8127.89 (V8 15.8), Firefox 161.0 (SpiderMonkey), the `jsc` shell of macOS 26.1, Bun 1.4.5 and a Playwright WebKit page, on one Apple M2; script and output in [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md), §4.29. Rank 1 (primary measurement). Backs: Lookup notes, JN-E3. [^lab-cross]
- Spot check for this doc: the resolved-`await` script in the `JN-E3` note, run on 2026-11-28 with `docker run --rm --network none node:24.22.1-alpine` (Node.js 24.22.1, linux arm64); command and output in that note. Rank 1 (primary measurement). Backs: Lookup notes, JN-E3. [^spot]
- [Command-line API: UV_THREADPOOL_SIZE, --enable-source-maps, --no-async-context-frame](https://nodejs.org/docs/latest-v24.x/api/cli.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Catalog, JN-E2, JN-E5, JN-E8; Lookup notes. [^node-cli]
- [Thread pool work scheduling](https://docs.libuv.org/en/v1.x/threadpool.html) — libuv project, v1.x, living. Rank 1. Backs: Lookup notes, JN-E1. [^libuv-tp]
- [DNS: Implementation considerations](https://nodejs.org/docs/latest-v24.x/api/dns.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Lookup notes, JN-E1. [^node-dns]
- [Don't Block the Event Loop (or the Worker Pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) — Node.js project, living. Rank 1. Backs: Catalog, JN-E6; Lookup notes, JN-E1 and JN-E6. [^node-dontblock]
- [The Node.js Event Loop, Timers, and process.nextTick()](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) — Node.js project, living. Rank 1. Backs: Lookup notes, JN-E3. [^node-loop-guide]
- [Process: process.nextTick and queueMicrotask](https://nodejs.org/docs/latest-v24.x/api/process.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Lookup notes, JN-E3. [^node-process]
- [Performance measurement APIs](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Catalog, JN-E6; Lookup notes, JN-E3 and JN-E6. [^node-perf]
- [Async hooks](https://nodejs.org/docs/latest-v24.x/api/async_hooks.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Lookup notes, JN-E4. [^node-asynchooks]
- [Asynchronous context tracking](https://nodejs.org/docs/latest-v24.x/api/async_context.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Lookup notes, JN-E5. [^node-alsctx]
- [lib/internal/timers.js](https://github.com/nodejs/node/blob/v24.x/lib/internal/timers.js) — Node.js project source, v24.x branch. Rank 1. Backs: Catalog and Lookup notes, JN-E7. [^node-timers-src]
- [NIST SP 800-63B-4: Authenticators](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/) — NIST, SP 800-63-4 web edition. Rank 1. Backs: Lookup notes, JN-E9. [^nist-63b]
- [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — OWASP Cheat Sheet Series, living. Rank 3. Backs: Catalog and Lookup notes, JN-E9. [^owasp-pw]

## Related
- [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md) — the review catalog with the lab scripts behind `JN-E1` to `JN-E5`.
- [problem-classes-network-and-delivery.md](../../performance/code-review/problem-classes-network-and-delivery.md) — `slow-hash-per-request`.
- [v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md](../../js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md) — the microtask trial on six environments.
- [nodejs-worker-threads.md](nodejs-worker-threads.md) — moving CPU work off the event loop.
- [async-and-promises.md](async-and-promises.md) — language-level async practices.
- [../node/node-services-deep-dive.md](../node/node-services-deep-dive.md) — the Node.js runtime model and a thread-pool measurement.
