---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24 (docs v24.22.3)", "Node.js 24.22.1 (libuv 1.52.1) in node:24.22.1-alpine containers with docker run --cpus and --memory, 2026-11-03 to 2026-11-09", "piscina 5.3.2, pdfmake 0.3.12 and 0.3.13, bullmq 5.80.9", "lab on Node.js 24.22.1 (V8 13.6.233.17, linux arm64), 2026-11-26, re-run 2026-11-27 on Node.js 22.23.4, 25.7.0, Electron 43.7.7 and Node.js 24.22.3 with pointer compression"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, nodejs, worker-threads, piscina, bullmq, containers]
ranked-sources: true
---

# JavaScript best practices: Node.js worker threads and pools

## Summary
**TL;DR:** A worker thread keeps CPU-heavy work off the event loop, but in a container its count, its heap limit and the data posted to it all need sizing against the container's limits, and the pool library's statistics need careful reading. The practices here move long renders into a worker, size CPU-bound pools from `availableParallelism()`, transfer large buffers, cap each worker's heap, and work around four behaviours of piscina 5.3.2 and one of BullMQ. Two results matter most: on 0.5 CPU, two 1,500-row PDF renders took 15.6 s with 1 worker and 26.8 s with 2 ✅[^lab-pools]; in a 512 MiB container, 2 workers of 250 MB each got the container killed although each was below its own 256 MiB limit ✅[^lab-heap].
**Use this when:** moving rendering, PDF, image or report generation off a Node.js server's main thread; choosing a worker count or heap limit for a container; posting data to workers; reading piscina pool statistics; or writing BullMQ processors.
**Not this doc:** the libuv thread pool behind `fs`, DNS lookups, crypto and `zlib` → [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md); heap flags and `os.availableParallelism()` for the whole process → [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md); the pool's mechanism and the full measurements → [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), [node-worker-default-heap-limit.md](../../js-runtime/node-worker-default-heap-limit.md), [piscina-queue-size.md](../../js-runtime/piscina-queue-size.md).

## Scope
Nine practices for worker threads, worker pools, worker messages, worker heap limits, the piscina pool library and BullMQ processors. Numbers come from Node.js 24.22.1 (libuv 1.52.1) in `node:24.22.1-alpine` containers run with `docker run --cpus` and `--memory` between 2026-11-03 and 2026-11-09, and from the lab runs of the Node.js runtime catalog (Node.js 24.22.1, V8 13.6.233.17, linux arm64, 2026-11-26, re-run on six more builds on 2026-11-27). Several measurements used piscina 5.3.2; a note names it where the measurement is about it, and later piscina versions were not checked. All claims are about Node.js. Not run: other pool libraries, Windows, and CPU limits on hosts other than one 8-CPU Linux VM and one Kubernetes pod.

How to read the "Applies" column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it).

Terms:
- **Worker thread:** a second JavaScript thread with its own event loop and heap, like a second cook with their own stove.
- **CPU limit:** the CPU (central processing unit) time budget a container gets, like one stove shared by every cook: more cooks do not cook more.
- **Transfer:** handing an `ArrayBuffer` to another thread instead of copying it, like handing over a box instead of photocopying its contents.
- **Old generation:** the part of V8's heap for long-lived objects; `maxOldGenerationSizeMb` caps it per worker, like a spending limit per card.
- **Sandboxed processor:** a BullMQ job processor given as a file path, which BullMQ runs in another process or worker thread.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JN-W1` | A handler or job rendering a PDF, image or report synchronously on the main thread | Run it in a worker thread (a pool); the main thread keeps answering requests and probes | hot path | Renders of 2 to 10 s on the main thread failed a liveness probe 3 times within 15 to 25 s; in a worker the longest block was 0.02 to 0.5 s ✅[^lab-pools] |
| `JN-W2` | A CPU-bound pool sized from `os.cpus().length` or a fixed number, in a container | Size from `availableParallelism()`; one worker at a limit of 1 CPU or less | always | 0.5 CPU, two 1,500-row documents: 15.6 s with 1 worker, 26.8 s with 2 (piscina 5.3.2) ✅[^lab-pools] |
| `JN-W3` | `postMessage(arrayBuffer)` of large data with no transfer list, per task | Pass it in the transfer list `postMessage(msg, [ab])`, use a `SharedArrayBuffer`, or send a path or id | large data | After posting 1 MiB without a transfer list the sender kept 1,048,576 bytes (a clone); with one, 0 ✅[^lab] |
| `JN-W4` | `postMessage(Buffer.from(…))` or an `allocUnsafe` Buffer per task | Post the string, or a `Buffer.alloc` buffer transferred | check build | A 5-byte pooled `Buffer` arrived with a 65,536-byte backing on 24.22.1 ✅[^lab], 8,192 on 22.23.4 and 25.7.0 ✅[^lab-matrix] |
| `JN-W5` | 2+ workers (or any worker under 512 MiB) with no `resourceLimits` in a memory-limited container | Set `maxOldGenerationSizeMb` = (container limit − main reserve) ÷ workers | always | 512 MiB container, 2 workers of 250 MB: killed (exit 137); with a 128 MB cap, the tasks failed and the container stayed up ✅[^lab-heap] |
| `JN-W6` | piscina `maxQueue` together with `pool.run(task, { signal })` | Check `pool.queueSize` against the limit before `run()` | always | piscina 5.3.2, `maxQueue: 2`, 6 signalled tasks: all 6 accepted ✅[^lab-piscina] |
| `JN-W7` | piscina `utilization` logged or alerted on; `needsDrain` read as "queue exists" | Use `queueSize` and per-task duration; `needsDrain` means all workers busy | always | A fully busy pool reported `utilization` 0.00083 instead of about 0.83 (piscina 5.3.2) ✅[^lab-pools] |
| `JN-W8` | piscina pool with `minThreads < maxThreads` and no `idleTimeout` | Set `idleTimeout` (for example 10,000 ms) | hot path | With the default 0 the extra worker stopped at once; with 10,000 it was still there after 1 s (piscina 5.3.2) ✅[^lab-pools] |
| `JN-W9` | BullMQ `new Worker(queue, async (job) => cpuWork())` or a NestJS `WorkerHost` doing CPU work | Pass a processor file path with `useWorkerThreads: true` | hot path | A function processor ran with `isMainThread=true`, and 2 s of CPU work froze the event loop for 2.0 s ✅[^lab-pools] |

## Lookup notes
### `JN-W1` Run CPU-bound work in a worker thread, not on the main thread of a server
**Prefer:**
```js
import { Piscina } from 'piscina';
const pool = new Piscina({ filename: require.resolve('./render.task.js') });
app.post('/pdf', async (req, res) => res.end(await pool.run(req.body)));
```
**Avoid:**
```js
app.post('/pdf', (req, res) => res.end(renderPdf(req.body))); // blocks the loop for seconds
```
**Why:** Node.js runs JavaScript on one main thread; while it renders, no other callback runs, health probes included. A worker thread has its own event loop ✅[^lab-pools]. This matters for work of more than a few hundred milliseconds in a service that also answers requests or probes.
**Evidence:** Node.js 24.22.1, pdfmake 0.3.13, 10 to 1,500-row tables, 0.5 CPU, 2026-11-05: with back-to-back 2 to 10 s renders on the main thread, a liveness probe (every 5 s, 1 s timeout, 3 failures) reached 3 consecutive failures within 15 to 25 s; with the same renders in one worker thread the longest block was 0.02 to 0.5 s and no probe failed ✅[^lab-pools]. The mechanism holds for any worker thread, not only a piscina pool.
**Exceptions:** Short work; a command-line tool that does one job at a time. Related, not the same practice: `JN-E6` in [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md) (a `*Sync` call in a handler), `JL-A8` in [async-and-promises.md](async-and-promises.md) (a long synchronous loop inside an `async` function) and `JB-R7` in [browser-rendering-and-interaction.md](browser-rendering-and-interaction.md) (main-thread work over 50 ms in a browser). This practice is the Node.js fix for the first two when the work is CPU-bound and long.
**Check it:** `perf_hooks.monitorEventLoopDelay()` or the probe's failure count during a render.
**Full lab:** [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), Edge cases, "A CPU-bound render on the main thread of an HTTP service".

### `JN-W2` Size a CPU-bound pool from the container's CPU limit; use one worker at 1 CPU or less
**Prefer:**
```js
import { availableParallelism } from 'node:os';
const threads = process.env.WORKER_THREADS
  ? Number(process.env.WORKER_THREADS)
  : Math.max(1, Math.min(2, availableParallelism() - 1)); // 1 on a limit of 2 CPUs or less
const pool = new Piscina({ filename, minThreads: threads, maxThreads: threads });
```
**Avoid:**
```js
const pool = new Piscina({ filename, maxThreads: os.cpus().length }); // 8 threads on 0.5 CPU
```
**Why:** A CPU limit caps all threads of the container together. Extra workers add memory and contention, not compute. This holds for any pool of CPU-bound worker threads in a container.
**Evidence:** pdfmake 0.3.12 in a piscina 5.3.2 pool, Node.js 24.22.1, 2026-11-03 (✅[^lab-pools]):
- 0.5 CPU / 512 MiB, two 1,500-row documents: 15.6 s with 1 worker, 26.8 s with 2.
- Two 300-row documents plus 10 small ones: the slowest large one took 3.5 s, 5.4 s and 8.7 s with 1, 2 and 3 workers.
- 1 CPU / 2 GiB, 20 × 130 rows: 3.1 s against 4.9 s. Each extra worker added 35 to 45 MiB of idle memory.
The cause, the CPU quota, applies to worker threads in general; only piscina was measured.
**Exceptions:** The limits measured were 0.5 CPU and 1 CPU; the one-worker result at 2 CPUs (the comment in the code) follows from the formula, not from a run. A large task delays small ones queued behind it with one worker. I/O-bound pools are sized from concurrency, not CPUs. `availableParallelism()` rounds a fractional limit down: 1.99 CPU gives 1 ✅[^lab-pools].
**Check it:** `node -p "os.availableParallelism()"` inside the container; throughput at 1 and 2 workers under the real limit.
**Full lab:** [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), Worked example and Trade-offs.

### `JN-W3` Transfer large `ArrayBuffer`s to a worker instead of copying them
**Prefer:**
```js
const ab = new ArrayBuffer(size);                // or Buffer.alloc / allocUnsafeSlow: owned memory
fill(ab);
worker.postMessage({ data: ab }, [ab]);          // moved; ab.byteLength is 0 afterwards
// many readers: a SharedArrayBuffer; or send a path or id and let the worker read the data
```
**Avoid:**
```js
worker.postMessage({ data: ab });                // structured clone: s bytes copied per message
```
**Why:** An `ArrayBuffer` not in the transfer list is copied; a transferred one moves and becomes unusable on the sending side; a `SharedArrayBuffer` is accessible from both threads ✅[^node-worker]. This matters for messages of a megabyte or more, or many messages per second; the lab posted 1 MiB.
**Evidence:** Lab run 5, Node.js 24.22.1, byte counts: after posting a 1 MiB `ArrayBuffer` without a transfer list the sender still had 1,048,576 bytes; with one it had 0 ✅[^lab]. Same on all six other builds ✅[^lab-matrix].
**Exceptions:** Small messages; the sender must keep its copy; data posted once at worker start.
**Check it:** `ab.byteLength` after `postMessage` is 0 when transferred; count bytes posted per task.
**Full lab:** [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, lab run 5.

### `JN-W4` Do not post small pooled `Buffer`s to workers
**Prefer:**
```js
const msg = Buffer.alloc(len);  // own memory: can be transferred
msg.write(str);
worker.postMessage(msg, [msg.buffer]);
// or post the string itself: worker.postMessage(str)
```
**Avoid:**
```js
worker.postMessage(Buffer.from('hello')); // clones the whole pool block it lives in
```
**Why:** A `Buffer` from the internal pool cannot be transferred and is cloned, which "sends a copy of the entire `Buffer` pool"; transferring a `Buffer.alloc` or `allocUnsafeSlow` buffer makes every other view of it unusable ✅[^node-worker].
**Evidence:** Lab run 5, Node.js 24.22.1, byte counts: a 5-byte pooled `Buffer` arrived with a 65,536-byte backing `ArrayBuffer` ✅[^lab]. Same 65,536 on 24.22.3 and on 24.21.0 (Electron 43.7.7); 8,192 bytes on Node.js 22.23.4 and 25.7.0 ✅[^lab-matrix]. Re-run for this doc on Node.js 24.22.1: a pooled `Buffer.from('hello')` arrived with a 65,536-byte backing `ArrayBuffer`; a transferred `Buffer.alloc(5)` arrived with 5 and left the sender with length 0 ✅[^spot].
<details><summary>Spot check: a pooled and a transferred <code>Buffer</code></summary>

`docker run --rm --network none node:24.22.1-alpine node -e '<script>'`:
```js
const { MessageChannel } = require("worker_threads");
const { port1, port2 } = new MessageChannel(); const got = [];
port2.on("message", (m) => { got.push(m); if (got.length === 2) { console.log("pooled Buffer.from(\"hello\") arrives with backing", got[0].buffer.byteLength, "| transferred Buffer.alloc(5) arrives with backing", got[1].buffer.byteLength); port1.close(); } });
port1.postMessage(Buffer.from("hello"));
const own = Buffer.alloc(5); own.write("hello"); port1.postMessage(own, [own.buffer]);
console.log("sender length after transfer:", own.length);
```
```text
sender length after transfer: 0
pooled Buffer.from("hello") arrives with backing 65536 | transferred Buffer.alloc(5) arrives with backing 5
```
</details>

**Exceptions:** Rare messages, where one block per message does not matter.
**Check it:** In the worker, compare `msg.buffer.byteLength` with `msg.length`.
**Full lab:** [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, lab run 5 and "What differs".

### `JN-W5` With more than one worker, set each worker's heap limit so all limits fit the container
**Prefer:**
```js
const containerMb = 512, mainReserveMb = 200, workers = 2;
const pool = new Piscina({ filename, minThreads: workers, maxThreads: workers,
  resourceLimits: { maxOldGenerationSizeMb: Math.floor((containerMb - mainReserveMb) / workers) } });
```
**Avoid:**
```js
const pool = new Piscina({ filename, minThreads: 2, maxThreads: 2 }); // each worker may grow to 256 MiB
```
**Why:** A worker without `resourceLimits` is sized by the same function as the main thread, from the smaller of the machine's memory and the container limit ✅[^node-env-src]; the old generation is = clamp(limit ÷ 2, 256 MiB, 2 GiB), with a 4 GiB cap when that memory is at least 15 GiB ✅[^v8-heap-src]; the measured sizes were 128 MiB to 6 GiB containers (the 2 GiB cap at 4 and 6 GiB), and the 4 GiB cap only on a 16 GiB host with no container limit, not in a container of 15 GiB or more ✅[^lab-heap]. Below a 512 MiB container the 256 MiB minimum is more than half ✅[^lab-heap]. Each worker is sized as if it were alone ✅[^node-worker-src], so several defaults add up past the container, and the kernel kills the container before any worker reaches its own limit. This applies to any pool of 2 or more workers in a memory-limited container, and to any worker in a container under 512 MiB.
**Evidence:** Node.js 24.22.1 (V8 13.6.233), piscina 5.3.2, 2026-11-06 (✅[^lab-heap]):
- defaults of 256, 512, 1,024 and 2,048 MiB at 512 MiB, 1 GiB, 2 GiB and 4 GiB containers; every container size measured, 128 MiB to 6 GiB, matched the formula;
- in 512 MiB, 2 workers of 250 MB each: container killed (exit 137, `OOMKilled: true`); with `maxOldGenerationSizeMb: 128`, 2 × 200 MB were rejected with `ERR_WORKER_OUT_OF_MEMORY` and the container stayed up;
- in 128 MiB, one worker with the default 256 MiB was killed by the kernel at 150 MB.
Re-run for this doc on Node.js 24.22.1: `resourceLimits.maxOldGenerationSizeMb` inside a worker read 256, 256 and 512 at 128, 512 and 1,024 MiB ✅[^spot].
<details><summary>Spot check: a worker's default heap limit per container size</summary>

```sh
for m in 128m 512m 1024m; do docker run --rm --network none --memory=$m --memory-swap=$m -e M=$m node:24.22.1-alpine node -e '
const { Worker } = require("worker_threads");
new Worker("console.log(process.env.M, \"maxOldGenerationSizeMb in worker:\", require(\"worker_threads\").resourceLimits.maxOldGenerationSizeMb)", { eval: true });'; done
```
```text
128m maxOldGenerationSizeMb in worker: 256
512m maxOldGenerationSizeMb in worker: 256
1024m maxOldGenerationSizeMb in worker: 512
```
</details>

**Exceptions:** One worker in a container of 512 MiB or more: the default already fails cleanly at about half the container, and a derived cap leaves less headroom (2 GiB, 12,000 rows: the default failed cleanly; a 1,792 MB cap rendered with the container at 1,875 of 2,048 MiB) ✅[^lab-pools]. The limit covers only the JavaScript heap, not `Buffer`s or `ArrayBuffer`s, and `--max-old-space-size` on the command line overrides `maxOldGenerationSizeMb` ✅[^node-worker-limits].
**Check it:** Log `require('node:worker_threads').resourceLimits` inside the worker; it shows the numbers it really got.
**Full lab:** [node-worker-default-heap-limit.md](../../js-runtime/node-worker-default-heap-limit.md), Worked example and Edge cases; [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), Edge cases, "No `resourceLimits` on the worker".

### `JN-W6` Enforce a piscina queue limit in the caller when tasks carry an `AbortSignal`
**Prefer:**
```js
if (pool.queueSize >= MAX_WAITING) throw new ServiceUnavailable('render queue full');
return pool.run(task, { signal: AbortSignal.timeout(30_000) });
```
**Avoid:**
```js
const pool = new Piscina({ filename, maxQueue: 2 });
pool.run(task, { signal }); // the limit is never applied to this task
```
**Why:** piscina 5.3.2 keeps signalled tasks in a second list, and the `maxQueue` check reads only the first ✅[^piscina-src]. This applies to piscina 5.3.2 with `maxQueue` and signalled tasks; later versions were not checked.
**Evidence:** piscina 5.3.2, Node.js 24.22.1, 2026-11-06: `maxQueue: 2`, one ready worker, 6 tasks: without a signal 3 fulfilled and 3 rejected with "Task queue is at limit"; with a signal all 6 accepted ✅[^lab-piscina]. Before piscina 5.2.0, `queueSize` also stayed 0 for signalled tasks; 5.2.0 included them ✅[^piscina-changelog].
**Exceptions:** Tasks without a signal: `maxQueue` works. Two callers submitting in the same tick can both pass the caller check.
**Check it:** Submit more tasks than the limit with signals and count rejections.
**Full lab:** [piscina-queue-size.md](../../js-runtime/piscina-queue-size.md), Worked example and Edge cases.

### `JN-W7` piscina's `utilization` is not a load signal; read `queueSize`, `needsDrain` and task time for what they are
**Prefer:**
```js
log.info({ waiting: pool.queueSize, allBusy: pool.needsDrain, ms: Date.now() - started });
```
**Avoid:**
```js
if (pool.utilization > 0.8) scaleUp(); // a fully busy pool reported 0.00083
```
**Why:** In piscina 5.3.2 (✅[^piscina-src]):
- `utilization` is divided by 1000 once too often and is an average since the pool started;
- `queueSize` counts tasks waiting for a worker, minus starting workers, not running ones;
- `needsDrain` is true as soon as every worker is busy, even with an empty queue;
- `completed` counts failed and aborted tasks too.
This applies to piscina 5.3.2 statistics in logs, dashboards or autoscaling.
**Evidence:** piscina 5.3.2, Node.js 24.22.1: a pool busy for the whole run reported `utilization` 0.00083 instead of about 0.83 ✅[^lab-pools]; 1 worker and 1 running task gave `queueSize` 0 and `needsDrain` true; a cold pool with 2 starting workers gave `queueSize` 0, 0, 1, 2, 3 for 5 tasks ✅[^lab-piscina].
**Exceptions:** None found in the lab.
**Check it:** Log the three values during a burst and compare with the number of tasks submitted.
**Full lab:** [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), Edge cases; [piscina-queue-size.md](../../js-runtime/piscina-queue-size.md), Worked example.

### `JN-W8` Set `idleTimeout` when a piscina pool may grow above `minThreads`
**Prefer:**
```js
const pool = new Piscina({ filename, minThreads: 1, maxThreads: 2, idleTimeout: 10_000 });
```
**Avoid:**
```js
const pool = new Piscina({ filename, minThreads: 1, maxThreads: 2 }); // extra worker stops at once
```
**Why:** piscina shuts down an idle worker only while it has more than `minThreads`, after `idleTimeout` ms; the default is immediate, and its docs warn that stopping and starting threads can cost performance ✅[^piscina-readme]. This matters under bursty load on a pool with `minThreads < maxThreads`.
**Evidence:** piscina 5.3.2, Node.js 24.22.1, 2026-11-06, 3 tasks of 100 ms, as min/max/`idleTimeout` (✅[^lab-pools]):
- `1/2/0` never kept 2 threads;
- `1/2/300` had 2 threads after the burst and 1 a second later;
- `1/2/10000` still had 2 after 1 s;
- `2/2/300` kept 2, so `idleTimeout` had no effect there.
**Exceptions:** `minThreads` equal to `maxThreads` (the right choice under a CPU limit, `JN-W2`): `idleTimeout` does nothing.
**Check it:** The pool's thread count right after a burst and 1 s later, as the measurement did.
**Full lab:** [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), Edge cases (`idleTimeout`).

### `JN-W9` Give BullMQ a processor file, not a function, for CPU-heavy jobs
**Prefer:**
```js
const worker = new Worker('render', path.join(__dirname, 'render.processor.js'),
  { connection, useWorkerThreads: true }); // sandboxed processor in a worker thread
```
**Avoid:**
```js
const worker = new Worker('render', async (job) => heavyRender(job.data), { connection });
```
**Why:** A BullMQ `Worker` is not a thread. A function processor runs on the main thread of the same process; only a processor given as a file path runs sandboxed, in another process or, with `useWorkerThreads`, a worker thread ✅[^bullmq-sandbox]. This matters for CPU-heavy jobs in a BullMQ or NestJS `@Processor` worker.
**Evidence:** Measured on Node.js 24.22.1: a function processor ran with `isMainThread=true`, `threadId=0` and the same process id, and 2 s of CPU work froze the event loop for 2.0 s; `@nestjs/bullmq` passes the provider's bound `process` method, a function ✅[^lab-pools]. The measurements of that doc list bullmq 5.80.9 among their versions; this row gives no version of its own. The sandboxed half is a sourced statement from the BullMQ documentation ✅[^bullmq-sandbox], not a run.
**Exceptions:** I/O-bound jobs that await most of the time.
**Check it:** Log `require('node:worker_threads').isMainThread` inside the job.
**Full lab:** [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), Edge cases, "Treating a BullMQ `Worker` … as a thread".

## Takeaways
- Under a CPU limit of 1 CPU or less, one CPU-bound worker beat two or three; size pools from `availableParallelism()`, not `os.cpus().length`. [rule-candidate]
- Each worker's default heap limit assumes it is alone in the container: with 2 or more workers, set `maxOldGenerationSizeMb` so all limits fit.
- Large buffers go to workers in the transfer list; small pooled `Buffer`s drag their whole pool block along.
- piscina 5.3.2's `maxQueue` ignores signalled tasks and its `utilization` is 1000 times too small: check `queueSize` in the caller and log task time.
- A BullMQ function processor runs on the main thread; CPU work needs a processor file.

## Verification status
- Verified: 43 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Worker-pool measurements, 2026-11-03 to 2026-11-09: Node.js 24.22.1 (libuv 1.52.1), piscina 5.3.2, pdfmake 0.3.12 (2026-11-03) and 0.3.13 (from 2026-11-05), bullmq 5.80.9, in `node:24.22.1-alpine` with `docker run --cpus` and `--memory`, plus read-only checks in one 0.5 CPU / 512 MiB Kubernetes pod; method and numbers in [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), Worked example and Edge cases. Rank 1 (primary measurement). Backs: Summary; Catalog, JN-W1, JN-W2, JN-W7 to JN-W9; Lookup notes. [^lab-pools]
- Worker heap-limit measurements, 2026-11-06: Node.js 24.22.1 (V8 13.6.233) in `node:24.22.1-alpine` on an 8 GiB Linux VM, piscina 5.3.2, `docker run --memory --memory-swap --cpus`; scripts and outputs in [node-worker-default-heap-limit.md](../../js-runtime/node-worker-default-heap-limit.md), Worked example. Rank 1 (primary measurement). Backs: Summary; Catalog and Lookup notes, JN-W5. [^lab-heap]
- piscina queue measurements, 2026-11-06: piscina 5.3.2, Node.js 24.22.1; scripts in [piscina-queue-size.md](../../js-runtime/piscina-queue-size.md), Worked example. Rank 1 (primary measurement). Backs: Catalog, JN-W6; Lookup notes, JN-W6 and JN-W7. [^lab-piscina]
- Lab runs on Node.js 24.22.1 (image `node:24.22.1-alpine`, V8 13.6.233.17, libuv 1.52.1, linux arm64, 8 CPUs, `--network none`), 2026-11-26, each run 3 times; script `transfer.mjs` and its output in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, lab run 5. Rank 1 (primary measurement). Backs: Catalog and Lookup notes, JN-W3 and JN-W4. [^lab]
- Lab matrix: the same script re-run on 2026-11-27 on Node.js 24.22.1 (macOS 26.1 arm64, linux x64 emulated), 22.23.4, 25.7.0, Electron 43.7.7 run as Node (Node.js 24.21.0 API) and Node.js 24.22.3 with pointer compression; differing output in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), "Other builds and versions (2026-11-27)". Rank 1 (primary measurement). Backs: Catalog, JN-W4; Lookup notes, JN-W3 and JN-W4. [^lab-matrix]
- Spot checks for this doc: the scripts in the `JN-W4` and `JN-W5` notes, run on 2026-11-28 with `docker run --rm --network none node:24.22.1-alpine` (Node.js 24.22.1, linux arm64; `--memory` and `--memory-swap` per row for `JN-W5`); commands and output in those notes. Rank 1 (primary measurement). Backs: Lookup notes, JN-W4 and JN-W5. [^spot]
- [Worker threads: port.postMessage and transferring Buffers](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Lookup notes, JN-W3 and JN-W4. [^node-worker]
- [Worker threads: new Worker() options, resourceLimits](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#new-workerfilename-options) — Node.js project, living. Rank 1. Backs: Lookup notes, JN-W5 (limits cover the JavaScript heap only; `--max-old-space-size` overrides). [^node-worker-limits]
- [Node.js v24.22.1 src/api/environment.cc](https://github.com/nodejs/node/blob/v24.22.1/src/api/environment.cc) — Node.js project, 2026. Rank 1. Backs: Lookup notes, JN-W5 (`SetIsolateCreateParamsForNode`, the smaller of total and constrained memory). [^node-env-src]
- [Node.js v24.22.1 src/node_worker.cc](https://github.com/nodejs/node/blob/v24.22.1/src/node_worker.cc) — Node.js project, 2026. Rank 1. Backs: Lookup notes, JN-W5 (`Worker::UpdateResourceConstraints`). [^node-worker-src]
- [V8 13.6.233 src/heap/heap.cc](https://github.com/v8/v8/blob/13.6.233/src/heap/heap.cc) — V8 project, 2026. Rank 1. Backs: Lookup notes, JN-W5 (old generation from physical memory, the 2 GiB and 4 GiB caps). [^v8-heap-src]
- [piscina README: Options, idleTimeout](https://github.com/piscinajs/piscina/blob/current/README.md) — piscina project, living. Rank 1. Backs: Lookup notes, JN-W8. [^piscina-readme]
- [piscina CHANGELOG, 5.2.0](https://github.com/piscinajs/piscina/blob/v5.2.0/CHANGELOG.md) — piscina project, 2026-06-12. Rank 1. Backs: Lookup notes, JN-W6. [^piscina-changelog]
- `node_modules/piscina/dist/index.js` (piscina 5.3.2) — the piscina project's published source: the `queueSize`, `completed`, `utilization` and `needsDrain` getters, `pendingCapacity()` and the `maxQueue` check in `runTask`. Rank 1. Backs: Lookup notes, JN-W6 and JN-W7. [^piscina-src]
- [BullMQ: Sandboxed processors](https://docs.bullmq.io/guide/workers/sandboxed-processors) — BullMQ project, living. Rank 1. Backs: Lookup notes, JN-W9. [^bullmq-sandbox]

## Related
- [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md) — pool sizing under CPU limits, with every measurement behind `JN-W1`, `JN-W2` and `JN-W7` to `JN-W9`.
- [node-worker-default-heap-limit.md](../../js-runtime/node-worker-default-heap-limit.md) — how a worker's default heap limit is derived and what happens without `resourceLimits`.
- [piscina-queue-size.md](../../js-runtime/piscina-queue-size.md) — what `queueSize`, `maxQueue`, `needsDrain` and `'drain'` mean.
- [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md) — `worker-message-copy`, with the transfer lab.
- [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md) — heap flags and `availableParallelism()` for the whole process.
