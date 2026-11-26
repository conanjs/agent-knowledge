---
schema: knowledge-doc/v1
type: reference
topic: performance/code-review
status: verified
applies-to: ["Node.js 24 (API docs v24.22.3, read 2026-11-26; lab on Node.js 24.22.1 with V8 13.6.233.17 and libuv 1.52.1)", "libuv 1.x documentation (living)"]
last-verified: 2026-11-26
last-updated: 2026-11-26
tags: [performance, code-review, nodejs, event-loop, libuv, thread-pool, buffers, worker-threads, async-hooks, source-maps]
ranked-sources: true
---

# Performance problem classes in the Node.js 24 runtime

## Summary
**TL;DR:** Node.js runs JavaScript on one thread and sends file, DNS, crypto and compression work to a small shared libuv thread pool. Six code shapes waste that design: slow pool tasks that make unrelated file reads wait, "yielding" through `process.nextTick` or promises that never lets I/O run, an `async_hooks` hook that fires for every promise, a small `Buffer` view that keeps a large buffer alive, a large buffer copied into a worker instead of moved, and `--enable-source-maps` on a service that reads `Error.stack` often. Each row gives the signal, the fix, the cost as a count, and the check; five rows have a lab run on Node.js 24.22.1.
**Use this when:** you review Node.js 24 service code, its `NODE_OPTIONS`, Dockerfile `CMD` or start script, and the code uses `crypto`, `zlib`, `fs`, `dns`, `process.nextTick`, `async_hooks`, `Buffer` views or `worker_threads`.
**Not this doc:** the first catalog (`*Sync` calls in handlers, ignored `write()` false, CPU work on the event loop, concat on an accumulator) → `problem-classes.md`; how the event loop, pool and streams work, with measurements → `../../javascript/node/node-services-deep-dive.md` and `../../javascript/node/data-wrangling-deep-dive.md`; sizing worker-thread pools in containers → `../../js-runtime/worker-thread-pools.md`; V8 compiler and object shapes → `problem-classes-javascript-engine.md` and `../../js-runtime/v8-hidden-classes.md`; password hashing per request → `problem-classes-network-and-delivery.md` (`slow-hash-per-request`).

## Scope
The domain is the Node.js 24 runtime around the JavaScript engine: the event loop and its queues, the libuv thread pool, `Buffer` memory, streams, worker messages, module loading and runtime flags. Analogy: a restaurant with one waiter (the event loop) and four cooks (the thread pool). The waiter must never cook, and four slow dishes keep every other order waiting. Concrete example: four `crypto.pbkdf2` calls at once hold all four default pool threads, so an unrelated `fs.readFile` waits for one of them (lab run 1).

Covered: six classes in three groups (event loop and thread pool; buffers and worker messages; runtime flags). Not covered: V8 optimization (the JavaScript engine catalog), language-level patterns (the JavaScript language catalog), container CPU and heap limits (the containers catalog), and shapes already in other catalogs (see "Belongs to an existing class").

Notation (each symbol is a count read from the code or its workload):

| Symbol | Meaning | Worked example |
|---|---|---|
| p | Threads in the libuv pool (`UV_THREADPOOL_SIZE`) | Node.js 24 default: p = 4 |
| t | Pool tasks that run long (hashing, compressing a large body) in flight at once | 4 logins hashing at once: t = 4 = p, so every other pool task queues |
| n | Steps, chunks, messages or async resources the code creates | A loop of 100,000 `process.nextTick` steps: n = 100,000 |
| s | Bytes in one buffer or message | A 10 MiB file buffer: s = 10,485,760 |
| k | Steps run between two yields to the event loop | `setImmediate` after every 1,000 items: k = 1,000 |

Terms:

| Term | Plain meaning | Analogy | Concrete example |
|---|---|---|---|
| Event loop | The single thread that runs JavaScript callbacks one after another | One waiter serving all tables | An HTTP handler, a timer callback |
| libuv thread pool | A fixed set of background threads for work the operating system cannot do asynchronously | Four cooks in the kitchen | `fs.readFile`, `dns.lookup`, `crypto.scrypt`, `zlib.gzip` |
| Next tick queue, microtask queue | Queues that run completely after the current callback, before the loop moves on | Orders the waiter takes before leaving the table | `process.nextTick(f)`; `queueMicrotask(f)`; `await` continuations |
| Async resource | An object `async_hooks` tracks because it may call back later | A ticket for each pending order | A promise, a timer, a socket |
| Buffer pool | A pre-allocated block that small `Buffer`s are carved from | One sheet of paper cut into sticky notes | `Buffer.from('abc')` sits in a 64 KiB block |
| View | A `Buffer` or typed array that points into another buffer's memory, without its own copy | A window onto a shared wall | `big.subarray(0, 16)` |
| Transfer | Moving an `ArrayBuffer` to another thread, so the sender loses it and nothing is copied | Handing over the box instead of photocopying its contents | `port.postMessage(ab, [ab])` |
| Source map | A file that maps compiled JavaScript positions to the original source | A translation table | `dist/app.js.map` for TypeScript output |

## Catalog

**Event loop and thread pool**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `threadpool-saturation` | Many concurrent `crypto.pbkdf2`, `crypto.scrypt`, `crypto.randomBytes` or `crypto.generateKeyPair` calls; async `zlib.gzip` / `deflate` / `brotliCompress` of each response; `Promise.all` over many `fs.promises` calls; outgoing HTTP or database connections to host names (they resolve through `dns.lookup`); no `UV_THREADPOOL_SIZE` in the deploy environment, or `process.env.UV_THREADPOOL_SIZE = …` set in code | Set `UV_THREADPOOL_SIZE` in the environment before the process starts; cap concurrent pool-heavy calls (a semaphore of at most p); move CPU-heavy hashing or compression to worker threads (`../../js-runtime/worker-thread-pools.md`); cache compressed output; resolve hosts with `dns.resolve*` or a cached lookup | When t ≥ p long tasks are in flight, every other pool task (a file read, a DNS lookup) waits for one to finish → waits only when t exceeds the larger pool or the capped concurrency. In Node.js 24, the CLI page lists as pool users all `fs` APIs other than the file watchers and the explicitly synchronous ones, asynchronous `crypto` APIs "such as" `pbkdf2`, `scrypt`, `randomBytes`, `randomFill` and `generateKeyPair`, `dns.lookup`, and all `zlib` APIs other than the explicitly synchronous ones ✅[^node-cli]; its default is 4 threads, and one slow API degrades "seemingly unrelated" pool APIs ✅[^node-cli]; libuv's pool is global, its maximum 1024 ✅[^libuv-tp]; each long task shrinks the pool by one until it ends ✅[^node-dontblock]; `dns.lookup` is a synchronous `getaddrinfo` call on the pool, and other networking APIs call it internally ✅[^node-dns]; `dns.resolve*` does not use the pool ✅[^node-dns]; zlib docs strongly recommend caching compression results ✅[^node-zlib] | Lab run 1: a file read issued after 4 `pbkdf2` calls waits for one of them with the default pool, not with p = 8; in production, latency of a cheap file-reading endpoint while hashing load runs |
| `microtask-starvation` | A recursive `process.nextTick(step)` or `queueMicrotask(step)` used to "break up" long work; an `async` loop over a large array whose `await`s only meet already-resolved values (`await cache.get(k)` on an in-memory cache, `await Promise.resolve()`); a promise chain built per item | Yield to the event loop with `setImmediate` every k steps (for example `await new Promise((r) => setImmediate(r))`), or move the work to a worker thread | Timers and I/O wait until all n steps finish → wait for at most one batch of k steps. The next tick queue is "fully drained" before the event loop continues, and each time that queue is drained the microtask queue is drained immediately after ✅[^node-process]; recursive `process.nextTick` calls can "starve" I/O by keeping the loop from its poll phase ✅[^node-loop-guide]; the same guide recommends `setImmediate()` "in all cases" because it is easier to reason about ✅[^node-loop-guide]. The pages state the starvation for `process.nextTick` only; for `queueMicrotask` and promise continuations the evidence here is lab run 2, not a page | Lab run 2: 100,000 recursive `nextTick` or `queueMicrotask` steps all run before a 0 ms timer, `setImmediate` steps do not; in production, `perf_hooks.monitorEventLoopDelay()` samples the event loop delay (resolution default 10 ms in Node.js 24) ✅[^node-perf] |
| `async-hook-per-resource` | `async_hooks.createHook({ init, before, after, destroy }).enable()` in application code or an in-house tracing or context library; a `destroy` hook; `executionAsyncResource()` used to carry request context; `--no-async-context-frame` in `NODE_OPTIONS` | Use `AsyncLocalStorage` for request context; Diagnostics Channel or `process.getActiveResourcesInfo()` for diagnostics; if a hook must stay, `trackPromises: false` and no `destroy` hook | Hook callbacks for every async resource, promises included → none. The Node.js 24 docs do not recommend `createHook`, citing "performance implications" ✅[^node-asynchooks]; promises are not tracked by default because V8's promise introspection is expensive, and `createHook` turns that tracking on (`trackPromises` defaults to `true`) ✅[^node-asynchooks]; the `destroy` hook adds tracking of promises through the garbage collector ✅[^node-asynchooks]; `AsyncLocalStorage` is "a performant and memory safe implementation" ✅[^node-alsctx]; the CLI page says `--no-async-context-frame` (added in v24.0.0) disables `AsyncLocalStorage` backed by `AsyncContextFrame` and uses the prior `async_hooks` implementation, so without the flag Node.js 24 uses the `AsyncContextFrame` one ✅[^node-cli]. The Async hooks page gives no "added in" version for `trackPromises`: check it on your minor version of Node.js 24 (the lab ran 24.22.1) | Lab run 3: an `init` hook counts 2004 calls for 1,000 `await`s, 0 with `trackPromises: false`; grep dependencies and `NODE_OPTIONS` for `createHook` and `--no-async-context-frame` |

**Buffers and worker messages**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `retained-buffer-view` | A small `buf.subarray(a, b)` or deprecated `buf.slice(a, b)` of a large file, socket or body buffer stored in a long-lived `Map`, cache or session; many small `Buffer.from(string)` or `Buffer.allocUnsafe(n)` values kept for the life of the process; `Buffer.from(view)` used to "detach" a view | Copy what is kept into its own memory: `Buffer.allocUnsafeSlow(len)` plus `view.copy(own)`; or keep a string or number instead of bytes | Retained memory per kept entry = the whole parent buffer (s bytes) or a whole pool block → the entry's own length. `subarray` returns a `Buffer` that "references the same memory as the original" ✅[^node-buffer]; in Node.js 24, `Buffer.poolSize` defaults to 65,536 bytes (raised from 8,192 in v24.18.0), and `allocUnsafe` uses the pool for sizes below half of it (`poolSize >>> 1`), while `from(array)`, `from(string)` and `concat` "may" use it like `allocUnsafe` does ✅[^node-buffer]; for memory kept "for an indeterminate amount of time", the docs suggest `Buffer.allocUnsafeSlow()` and copying out ✅[^node-buffer] | Lab run 4: compare `entry.buffer.byteLength` with `entry.length` for stored entries (10,485,760 against 16 for a view); a heap snapshot shows the retained `ArrayBuffer` size |
| `worker-message-copy` | `worker.postMessage(bigBuffer)` or `port.postMessage({ data: arrayBuffer })` with no transfer list, once per task; large arrays or objects posted to a worker for every job; small pooled `Buffer`s (`Buffer.from`, `allocUnsafe`) posted to workers | Pass the `ArrayBuffer` in `transferList` when the sender owns it (`Buffer.alloc`, `allocUnsafeSlow`, `new ArrayBuffer`); a `SharedArrayBuffer` for data many threads read; send a path or an id and let the worker read the data | s bytes copied per message, n messages → 0 bytes copied (ownership moves). An `ArrayBuffer` not in `transferList` is copied, a transferred one is unusable on the sending side ✅[^node-worker]; a `Buffer` from the internal pool cannot be transferred and is cloned, which "sends a copy of the entire `Buffer` pool" ✅[^node-worker]; buffers from `Buffer.alloc()` or `allocUnsafeSlow()` can be transferred, and that makes every other view of them unusable ✅[^node-worker]; a `SharedArrayBuffer` is accessible from both threads ✅[^node-worker] | Lab run 5: after a transfer the sender's `byteLength` is 0, after a clone it is unchanged; count bytes posted per task |

**Runtime flags**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `source-maps-on-hot-stacks` | `--enable-source-maps` in `NODE_OPTIONS`, a Dockerfile `CMD` or a `start` script of a service that reads `err.stack` often: every handled error logged with its stack, errors used for control flow, `new Error().stack` read per call to find the caller | Read `stack` only for errors that are logged and kept; stop building errors for expected outcomes; or turn source maps off in the hot service and map stack traces when they are read | Possible source-map latency at each of n `Error.stack` reads per request → none, or only for logged errors. The Node.js 24 docs say enabling source maps "can introduce latency to your application when `Error.stack` is accessed", and ask applications that access it frequently to weigh the performance implications; the page also says the flag enables caching of source maps, and gives no per-read cost ✅[^node-cli] | Count `stack` reads per request in a CPU profile or a counter; compare a profile with and without the flag on the same load |

## Lookup notes
- **Sizes decide.** `threadpool-saturation` matters when t can reach p under real load; `microtask-starvation` when n steps take longer than the latency budget of other clients; the buffer and message classes when s or the number of kept entries is large.
- **Not a problem when.**

| Class | Not a problem when |
|---|---|
| `threadpool-saturation` | Pool work is rare or short; the process does one job at a time (a CLI or a batch script); network sockets, which do not use the pool, are the only I/O; `fs.readFile` reads into memory one chunk at a time, letting the event loop turn between chunks, which gives it "less impact" on other pool activity ✅[^node-fs] (it still buffers the whole file in memory) |
| `microtask-starvation` | n is small, or the loop awaits real I/O on each step (each wait returns to the event loop); `nextTick` is used once, for example to emit an event after the caller attached its handlers ✅[^node-process] |
| `async-hook-per-resource` | The hook runs only in a debugging session or a test; context comes from `AsyncLocalStorage` on Node.js 24 without `--no-async-context-frame`, so backed by `AsyncContextFrame` ✅[^node-cli]; the application has few promises per request |
| `retained-buffer-view` | The view lives only for one request; the parent buffer is kept anyway; the kept data is tiny and few, so one 64 KiB pool block is an acceptable cost |
| `worker-message-copy` | Messages are small; the sender must keep its copy; the data is posted once at worker start-up |
| `source-maps-on-hot-stacks` | Stacks are read only for rare, logged failures; the service is a CLI or a development build |

- **Belongs to an existing class.**
  - `Buffer.concat([acc, chunk])` or `body += chunk` per `'data'` event → `allocation-gc` (catalog `problem-classes.md`). `Buffer.concat` returns a new `Buffer` ✅[^node-buffer], so with n chunks of c bytes the per-chunk form copies c·n(n+1)/2 bytes against c·n for one concat at the end (arithmetic: a 1 MiB body in 64 KiB chunks, n = 16, copies 136 × 64 KiB = 8.5 MiB against 1 MiB). String `+=` on `Buffer` chunks can also split multi-byte characters; `readable.setEncoding` decodes them properly ✅[^node-stream].
  - `readdir` then `stat` on each entry only to tell files from folders → `io-batching-n-plus-one` (`problem-classes.md`): with `withFileTypes: true` the result holds `fs.Dirent` objects ✅[^node-fs], so n + 1 calls become 1 when only the type is needed.
  - `require()` inside a handler → `startup-cold-start`: modules are cached after the first load and later calls do not run the module code again ✅[^node-modules], so the cost is the first, synchronous load at request time. `import(\`./m.mjs?${Date.now()}\`)` per request → `caching-recomputation`: modules are loaded again when the specifier's query or fragment differs ✅[^node-esm].
  - `zlib.gzipSync`, `crypto.pbkdf2Sync`, `execSync` or `spawnSync` in a handler → `blocking-in-async`; the docs show `spawnSync` driving event-loop utilization to 1 while the CPU is mostly idle ✅[^node-perf].
  - A large `JSON.stringify` or `res.json(allRows)` → `payload-overfetch` and `concurrency-backpressure` (CPU on the event loop).
  - `fs.watchFile` → `polling-event-rate`: `fs.watch()` is more efficient, and `watchFile` polls with a default interval of 5007 ms ✅[^node-fs].
  - A tiny `highWaterMark` → `unbuffered-io`. Since Node.js v22.0.0 the byte-stream default is 64 KiB on non-Windows platforms and 16 KiB on Windows, and 16 objects in object mode ✅[^node-stream]; it is a threshold, not a memory limit ✅[^node-stream].
  - `new Worker()` per task → `parallelism-overhead`. Per-request bcrypt or `scrypt` → `slow-hash-per-request` (`problem-classes-network-and-delivery.md`), which also fills the pool. Timers never cleared → `resource-leak`.
- **Lab runs (Node.js 24.22.1, image `node:24.22.1-alpine`, V8 13.6.233.17, libuv 1.52.1, 8 CPUs visible, `--network none`, 2026-11-26).** Each run was repeated 3 times with the same output. Commands run from the script's folder: `docker run --rm --network none -v "$PWD:/work" -w /work node:24.22.1-alpine node <script>.mjs`.
  - Run 1. With the default pool, a `fs.readFile` and a `dns.lookup('localhost')` issued after four `crypto.pbkdf2` calls each waited until at least one hash finished; with `UV_THREADPOOL_SIZE=8` neither waited ✅[^lab]. The first version of the script printed how many hashes finished first (2 and 1 of 4); those counts vary, so the script prints only whether it waited.
<details><summary>threadpool.mjs and output</summary>

```js
import crypto from 'node:crypto';
import fs from 'node:fs';
import dns from 'node:dns';
let hashed = 0;
const seen = {};
for (let i = 0; i < 4; i++) {
  crypto.pbkdf2('pw', 'salt', 1_000_000, 64, 'sha512', () => { hashed++; });
}
fs.readFile(new URL(import.meta.url), () => { seen.readFile = hashed; });
dns.lookup('localhost', () => { seen.lookup = hashed; });
process.on('exit', () => {
  const size = process.env.UV_THREADPOOL_SIZE ?? 'unset (4)';
  console.log(`UV_THREADPOOL_SIZE=${size}: fs.readFile waited for a pbkdf2: ${seen.readFile > 0}; dns.lookup waited for a pbkdf2: ${seen.lookup > 0}`);
});
```

Run as `node threadpool.mjs`, then as `sh -c 'UV_THREADPOOL_SIZE=8 node threadpool.mjs'`:

```text
UV_THREADPOOL_SIZE=unset (4): fs.readFile waited for a pbkdf2: true; dns.lookup waited for a pbkdf2: true
UV_THREADPOOL_SIZE=8: fs.readFile waited for a pbkdf2: false; dns.lookup waited for a pbkdf2: false
```
</details>

  - Run 2. 100,000 steps scheduled recursively with `process.nextTick` or `queueMicrotask` all ran before a 0 ms timer; the same steps scheduled with `setImmediate` let the timer run in between ✅[^lab].
<details><summary>starve.mjs and output</summary>

```js
const N = 100_000;
function trial(name, schedule) {
  return new Promise((resolve) => {
    let n = 0;
    let timerSawN = -1;
    setTimeout(() => { timerSawN = n; }, 0);
    const step = () => {
      if (++n < N) schedule(step);
      else setTimeout(() => resolve(`${name}: all ${N} steps ran before the 0 ms timer: ${timerSawN === N}`), 20);
    };
    schedule(step);
  });
}
console.log(await trial('process.nextTick', (f) => process.nextTick(f)));
console.log(await trial('queueMicrotask  ', (f) => queueMicrotask(f)));
console.log(await trial('setImmediate    ', (f) => setImmediate(f)));
```

```text
process.nextTick: all 100000 steps ran before the 0 ms timer: true
queueMicrotask  : all 100000 steps ran before the 0 ms timer: true
setImmediate    : all 100000 steps ran before the 0 ms timer: false
```
</details>

  - Run 3. A hook with only an `init` callback was called 2004 times for an `async` loop of 1,000 `await Promise.resolve(i)`, and 0 times with `trackPromises: false` ✅[^lab].
<details><summary>hooks.mjs and output</summary>

```js
import { createHook } from 'node:async_hooks';
async function work(n) { for (let i = 0; i < n; i++) await Promise.resolve(i); }
async function count(opts) {
  let inits = 0;
  const h = createHook({ init() { inits++; }, ...opts });
  h.enable();
  await work(1000);
  h.disable();
  return inits;
}
console.log('init calls for 1000 awaits, default hook:', await count({}));
console.log('init calls for 1000 awaits, trackPromises: false:', await count({ trackPromises: false }));
```

```text
init calls for 1000 awaits, default hook: 2004
init calls for 1000 awaits, trackPromises: false: 0
```
</details>

  - Run 4. A 14-character `Buffer.from(string)` sits in a 65,536-byte pool block; a 16-byte `subarray` of a 10 MiB buffer keeps all 10,485,760 bytes reachable; `Buffer.from(view)` lands in a pool block again; only `Buffer.allocUnsafeSlow(16)` plus `copy` owns exactly 16 bytes ✅[^lab].
<details><summary>buffers.mjs and output</summary>

```js
import { Buffer } from 'node:buffer';
console.log('Buffer.poolSize:', Buffer.poolSize);
const small = Buffer.from('session-id-123');
console.log('Buffer.from(14-char string): length', small.length, 'backing ArrayBuffer', small.buffer.byteLength);
const big = Buffer.alloc(10 * 1024 * 1024);
const view = big.subarray(0, 16);
console.log('big.subarray(0, 16) of 10 MiB: length', view.length, 'backing ArrayBuffer', view.buffer.byteLength);
const pooledCopy = Buffer.from(view);
console.log('Buffer.from(view): backing ArrayBuffer', pooledCopy.buffer.byteLength);
const own = Buffer.allocUnsafeSlow(16);
view.copy(own);
console.log('Buffer.allocUnsafeSlow(16) + copy: backing ArrayBuffer', own.buffer.byteLength);
```

```text
Buffer.poolSize: 65536
Buffer.from(14-char string): length 14 backing ArrayBuffer 65536
big.subarray(0, 16) of 10 MiB: length 16 backing ArrayBuffer 10485760
Buffer.from(view): backing ArrayBuffer 65536
Buffer.allocUnsafeSlow(16) + copy: backing ArrayBuffer 16
```
</details>

  - Run 5. Posting a 1 MiB `ArrayBuffer` without a transfer list left the sender's copy intact (a clone); with a transfer list the sender's `byteLength` became 0; a 5-byte pooled `Buffer` arrived with a 65,536-byte backing `ArrayBuffer` ✅[^lab].
<details><summary>transfer.mjs and output</summary>

```js
import { MessageChannel } from 'node:worker_threads';
import { Buffer } from 'node:buffer';
const { port1, port2 } = new MessageChannel();
const got = [];
port2.on('message', (m) => {
  got.push(m);
  if (got.length === 3) {
    console.log('received clone:', got[0].byteLength, '| received transfer:', got[1].byteLength,
      '| received 5-byte pooled Buffer: length', got[2].length, 'backing ArrayBuffer', got[2].buffer.byteLength);
    port1.close();
  }
});
const a = new ArrayBuffer(1 << 20);
port1.postMessage(a);
console.log('cloned 1 MiB ArrayBuffer, sender byteLength after post:', a.byteLength);
const b = new ArrayBuffer(1 << 20);
port1.postMessage(b, [b]);
console.log('transferred 1 MiB ArrayBuffer, sender byteLength after post:', b.byteLength);
const pooled = Buffer.from('hello');
port1.postMessage(pooled);
```

```text
cloned 1 MiB ArrayBuffer, sender byteLength after post: 1048576
transferred 1 MiB ArrayBuffer, sender byteLength after post: 0
received clone: 1048576 | received transfer: 1048576 | received 5-byte pooled Buffer: length 5 backing ArrayBuffer 65536
```
</details>

- **Corrections found while checking the sources (2026-11-26).**
  - The `Buffer` pool default is 64 KiB (65,536 bytes) from Node.js 24.18.0; before that it was 8,192 ✅[^node-buffer]; lab run 4 shows 65,536 on 24.22.1 ✅[^lab].
  - Setting `process.env.UV_THREADPOOL_SIZE` inside the program "is not guaranteed to work", because the pool may already exist ✅[^node-cli]. Set it in the environment of the process.
  - `dns.lookup` reads `/etc/hosts` and runs on the pool; `dns.resolve*` always queries the network and ignores `/etc/hosts` ✅[^node-dns], so switching changes behaviour, not only cost.
  - `AsyncLocalStorage` on Node.js 24 uses the `async_hooks`-based implementation only with `--no-async-context-frame` ✅[^node-cli]; advice that it is slow because of `async_hooks` describes that older implementation.
  - One `setTimeout` per item is not a cost class in Node.js: the timer code keeps lists keyed by duration and a binary heap whose operations are worst-case O(log n) ✅[^node-timers-src]. The cost of many timers is memory and missing `clearTimeout`, which is `resource-leak`.
  - For code running at the top level of a CommonJS module, `process.nextTick` callbacks run before `queueMicrotask` ones; in ES modules the reverse, because ESM code already runs inside the microtask drain ✅[^node-process]; either way both queues drain before I/O.
- **What the sources do not say.**
  - No recommended `UV_THREADPOOL_SIZE` value. The libuv page gives only the default 4 and the maximum 1024 ✅[^libuv-tp]; the KB's measurement shows a larger pool barely helping once cores are busy → `../../javascript/node/node-services-deep-dive.md`.
  - No number for the latency of source maps, the overhead of `async_hooks`, or the length at which a next tick queue becomes harmful.
  - The Node.js "Don't block the event loop" guide names the pool size k and gives no default; the default 4 comes from the CLI page ✅[^node-cli] and libuv ✅[^libuv-tp].
  - `--inspect` in production is a security issue, not a performance class: binding the inspector to a public address allows remote code execution ✅[^node-cli].

**Calibration state (2026-11-26).** None of these classes has a sample in the review-agent calibration yet: see [perf-reviewer-calibration.md](perf-reviewer-calibration.md).

## Takeaways
- Count the long pool tasks (hashing, compression, DNS lookups) a request can start; if they can reach the pool size, unrelated file and DNS work queues behind them. [rule-candidate]
- A loop that "yields" with `process.nextTick`, `queueMicrotask` or `await` on resolved values does not yield to I/O; only `setImmediate` or real I/O does. [rule-candidate]
- A `Buffer` you keep or post is only as small as its backing `ArrayBuffer`: copy kept slices out, and transfer large buffers to workers. [rule-candidate]

## Verification status
- Verified: 52 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-26

## References
- Lab runs on Node.js 24.22.1 (image `node:24.22.1-alpine`, V8 13.6.233.17, libuv 1.52.1, Apple M2 under Docker, `--network none`), 2026-11-26; scripts and exact output in Lookup notes. Rank 1. Backs: Lookup notes, lab runs 1–5 and corrections. [^lab]
- [Command-line API: UV_THREADPOOL_SIZE, --enable-source-maps, --no-async-context-frame, --inspect](https://nodejs.org/docs/latest-v24.x/api/cli.html) — Node.js project, v24.22.3. Rank 1. Backs: Catalog, threadpool-saturation, async-hook-per-resource, source-maps-on-hot-stacks; Lookup notes. [^node-cli]
- [Thread pool work scheduling](https://docs.libuv.org/en/v1.x/threadpool.html) — libuv project, v1.x, living. Rank 1. Backs: Catalog, threadpool-saturation; Lookup notes. [^libuv-tp]
- [DNS: Implementation considerations](https://nodejs.org/docs/latest-v24.x/api/dns.html) — Node.js project, v24.22.3. Rank 1. Backs: Catalog, threadpool-saturation; Lookup notes, corrections. [^node-dns]
- [Zlib: Threadpool usage and performance considerations](https://nodejs.org/docs/latest-v24.x/api/zlib.html) — Node.js project, v24.22.3. Rank 1. Backs: Catalog, threadpool-saturation. [^node-zlib]
- [Don't Block the Event Loop (or the Worker Pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) — Node.js project, living. Rank 1. Backs: Catalog, threadpool-saturation. [^node-dontblock]
- [The Node.js Event Loop, Timers, and process.nextTick()](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) — Node.js project, living. Rank 1. Backs: Catalog, microtask-starvation. [^node-loop-guide]
- [Process: process.nextTick and queueMicrotask](https://nodejs.org/docs/latest-v24.x/api/process.html) — Node.js project, v24.22.3. Rank 1. Backs: Catalog, microtask-starvation; Lookup notes. [^node-process]
- [Performance measurement APIs](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html) — Node.js project, v24.22.3. Rank 1. Backs: Catalog, microtask-starvation check; Lookup notes. [^node-perf]
- [Async hooks](https://nodejs.org/docs/latest-v24.x/api/async_hooks.html) — Node.js project, v24.22.3. Rank 1. Backs: Catalog, async-hook-per-resource. [^node-asynchooks]
- [Asynchronous context tracking](https://nodejs.org/docs/latest-v24.x/api/async_context.html) — Node.js project, v24.22.3. Rank 1. Backs: Catalog, async-hook-per-resource. [^node-alsctx]
- [Buffer](https://nodejs.org/docs/latest-v24.x/api/buffer.html) — Node.js project, v24.22.3. Rank 1. Backs: Catalog, retained-buffer-view; Lookup notes. [^node-buffer]
- [Worker threads: port.postMessage and transferring Buffers](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html) — Node.js project, v24.22.3. Rank 1. Backs: Catalog, worker-message-copy. [^node-worker]
- [Stream](https://nodejs.org/docs/latest-v24.x/api/stream.html) — Node.js project, v24.22.3. Rank 1. Backs: Lookup notes, existing classes. [^node-stream]
- [File system](https://nodejs.org/docs/latest-v24.x/api/fs.html) — Node.js project, v24.22.3. Rank 1. Backs: Lookup notes. [^node-fs]
- [Modules: CommonJS modules, Caching](https://nodejs.org/docs/latest-v24.x/api/modules.html) — Node.js project, v24.22.3. Rank 1. Backs: Lookup notes, existing classes. [^node-modules]
- [Modules: ECMAScript modules, URLs](https://nodejs.org/docs/latest-v24.x/api/esm.html) — Node.js project, v24.22.3. Rank 1. Backs: Lookup notes, existing classes. [^node-esm]
- [lib/internal/timers.js](https://github.com/nodejs/node/blob/v24.x/lib/internal/timers.js) — Node.js project source, v24.x branch. Rank 1. Backs: Lookup notes, corrections. [^node-timers-src]

## Related
- [problem-classes.md](problem-classes.md) — the first catalog; `blocking-in-async`, `concurrency-backpressure` and `allocation-gc` cover the neighbouring Node.js shapes.
- [perf-reviewer-calibration.md](perf-reviewer-calibration.md) — the review agent built on these catalogs, and how it scored.
- [problem-classes-network-and-delivery.md](problem-classes-network-and-delivery.md) — `slow-hash-per-request` and `small-socket-writes`.
- [problem-classes-javascript-engine.md](problem-classes-javascript-engine.md) — V8 compiler and object-shape classes.
- [../../javascript/node/node-services-deep-dive.md](../../javascript/node/node-services-deep-dive.md) — the runtime model and a thread-pool measurement.
- [../../javascript/node/data-wrangling-deep-dive.md](../../javascript/node/data-wrangling-deep-dive.md) — streams, backpressure and `pipeline`.
- [../../js-runtime/worker-thread-pools.md](../../js-runtime/worker-thread-pools.md) — sizing worker-thread pools in CPU-limited containers.
- [../../js-runtime/node-worker-default-heap-limit.md](../../js-runtime/node-worker-default-heap-limit.md) — the default heap limit of worker threads.
- [../../concurrency/blocking-in-async-runtimes.md](../../concurrency/blocking-in-async-runtimes.md) — why blocking work stalls an event loop.
- [../../js-runtime/v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) — V8 heap and start-up internals.
