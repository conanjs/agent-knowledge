---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24 (docs v24.22.3)", "lab on Node.js 24.22.1 (V8 13.6.233.17, linux arm64, an 8 GiB VM), 2026-11-06 and 2026-11-26", "re-run 2026-11-27 on Node.js 22.23.4, 24.22.1 and 25.7.0 (macOS arm64), Electron 43.7.7 and Node.js 24.22.3 with pointer compression", "libuv 1.52.1, cgroup v2"]
last-verified: 2026-11-28
last-updated: 2026-11-29
tags: [javascript, best-practices, nodejs, heap, garbage-collection, containers, memory, cgroup]
derived-from: [js-runtime/v8-memory-and-startup-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: Node.js heap limits, memory counters and container limits

## Summary
**TL;DR:** A Node.js service in a container has to fit its heap, its buffers and its thread count inside limits that the defaults do not always respect. The practices here set `--max-old-space-size` below the memory limit, set it explicitly under 512 MiB, read all memory counters, leave `--max-semi-space-size` alone without a measurement, and read the container's CPU and memory limits through the right APIs. The headline results: the heap limit was old generation plus 3 × semi-space in every flag combination run (704 MiB for `--max-old-space-size=512` on Node.js 24.22.1) ✅[^lab-v8]; a 64 MiB `ArrayBuffer` never appeared in `heapUsed` ✅[^lab-v8]; `os.availableParallelism()` gave 1 at a 0.5 CPU limit where `os.cpus().length` gave 8 ✅[^lab-pools].
**Use this when:** setting Node.js heap flags or container memory and CPU limits, building memory dashboards or alerts, sizing pools, forks or caches from the machine, or a Node.js container gets killed with exit code 137.
**Not this doc:** per-worker heap limits → `JN-W5` in [nodejs-worker-threads.md](nodejs-worker-threads.md); retained buffers → [nodejs-streams-buffers-and-io.md](nodejs-streams-buffers-and-io.md); pointer compression and the 4 GB heap cap → `JE-N11` in [numbers-and-arrays.md](numbers-and-arrays.md); how the garbage collector works → [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md).

## Scope
Six practices for heap flags, memory counters and container CPU and memory limits. Numbers come from Node.js 24.22.1 (V8 13.6.233.17, linux arm64, an 8 GiB virtual machine) on 2026-11-06 and 2026-11-26, re-run on 2026-11-27 on Node.js 22.23.4, 24.22.1 and 25.7.0 on macOS, Electron 43.7.7 run as Node and a Node.js 24.22.3 build with pointer compression. `process.config.variables.v8_enable_pointer_compression` was 0 on Node.js 22.23.4, on 24.22.1 (linux arm64, macOS arm64 and linux x64 emulated) and on 25.7.0, so the heap flags below are not capped near 4 GB on those builds; Electron 43.7.7 and the unofficial Node.js 24.22.3 pointer-compression build report 1 ✅[^lab-pc]. All claims are about Node.js on V8. Not run: Windows, cgroup v1, and the CPU-limit practices on Node.js versions other than 24.22.1.

**How the timings were taken.** No practice here rests on a timing: its numbers are sizes and counts, which the memory deep dive's re-run (2026-11-28, after the restart) gave again on every Node.js build of its first run (2026-11-26, the other builds 2026-11-27), all on one Apple M2 laptop, macOS 26.1, with the Linux builds in containers in a virtual machine on it and the x64 builds emulated ✅[^lab-v8-matrix]; the worker and container-limit counts of 2026-11-06 were measured once ✅[^lab-heap]. The deep dive's third run (2026-11-28, evening, quiet machine) covered timing scripts only, none of this doc's: its heap-limit, counter and scavenge-count scripts were not in it ✅[^lab-v8-matrix].

How to read the "Applies" column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it).

Terms:
- **Heap:** V8's memory for JavaScript objects, like a filing cabinet.
- **Old generation:** the large part of the heap for long-lived objects; **young generation:** a small part for new objects, made of **semi-spaces** that the minor GC (garbage collection, a **scavenge**) copies survivors between, like sorting papers from one in-tray into another.
- **External memory:** memory outside the heap that JavaScript objects own (`Buffer` and `ArrayBuffer` contents), like a storage unit rented by a paper in the cabinet.
- **RSS** (resident set size): the memory the process really holds in RAM.
- **cgroup:** the kernel interface that holds a container's limits as files, such as `/sys/fs/cgroup/cpu.max`.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JN-H1` | `--max-old-space-size` near or above the container memory limit (4096 with 2Gi) | Set it well below the limit; limit = old + 3 × semi-space, plus buffers | always | The docs suggest 1536 MiB on a 2 GiB machine ✅[^node-cli]; 704 MiB `heap_size_limit` for `=512` (Node.js 24.22.1) ✅[^lab-v8] |
| `JN-H2` | A container memory limit under 512 MiB and no `--max-old-space-size` | Set the heap flag explicitly below the limit | check build | The default old generation was at least 256 MiB in all 11 container sizes tried; a worker was killed at 150 MB in 128 MiB (Node.js 24.22.1) ✅[^lab-heap] |
| `JN-H3` | Memory monitoring that reads only `heapUsed`, or `process.memoryUsage()` at a high rate | Read `heapTotal`, `external`, `arrayBuffers` and `rss` too; `memoryUsage.rss()` for frequent samples | always | A 64 MiB `ArrayBuffer` moved `external` and `arrayBuffers`, never `heapUsed` ✅[^lab-v8] |
| `JN-H4` | `--max-semi-space-size=64` added "to reduce scavenges" | Leave it out without a `--trace-gc` count | no gain | `=16` and `=64` left the scavenge count unchanged for garbage that dies at once (158 or 159 on 24.22.1; other counts, also unchanged, on the other six builds) ✅[^lab-v8-matrix] |
| `JN-H5` | `os.cpus().length` used for a pool size, fork count or concurrency limit | Use `os.availableParallelism()`, which follows the container CPU quota (libuv 1.52+) | always | 8 for `os.cpus().length`, 1 for `availableParallelism()` at `--cpus=0.5` (Node.js 24.22.1) ✅[^lab-pools] |
| `JN-H6` | Sizing from `process.constrainedMemory()` | Treat 0 or a value above `os.totalmem()` as "no limit" | always | It returned 2^64 in a container with no limit on 24.22.1 ✅[^lab-pools], not the documented 0 ✅[^nodeproc] |

## Lookup notes
### `JN-H1` Set `--max-old-space-size` below the container's memory limit, with room for the rest
**Prefer:**
```dockerfile
# container limit 2 GiB: heap below it, leaving room for buffers, code and threads
CMD ["node", "--max-old-space-size=1536", "server.js"]
```
**Avoid:**
```dockerfile
CMD ["node", "--max-old-space-size=4096", "server.js"]   # limits.memory: 2Gi
```
**Why:** The heap limit is the old-generation size plus three times the semi-space size: the Node.js docs say the young generation is three times the semi-space ✅[^node-cli], and V8 computes it from the semi-space size ✅[^heapcc]. The process also holds external memory, code and thread stacks. A heap that can grow past the container gets the container killed by the kernel, losing every request in flight. This applies to any Node.js service in a memory-limited container that sets a heap flag.
**Evidence:** Node.js 24.22.1, `v8.getHeapStatistics().heap_size_limit`: 704 MiB with `--max-old-space-size=512` (a 64 MiB default semi-space on this 8 GiB machine), 608 MiB adding `--max-semi-space-size=32`, 515 MiB with `=1` ✅[^lab-v8]. The 608 and 515 rows were the same on all seven builds. With `=512` alone it differs: 560 MiB on Node.js 22.23.4 (16 MiB default semi-space), 608 MiB with pointer compression on (Electron 43.7.7 and the Node.js 24.22.3 build) ✅[^lab-v8-matrix]. The re-run (2026-11-28, after the restart) gave the same limits on every build ✅[^lab-v8-matrix]. The Node.js 24 command-line docs suggest 1536 MiB on a 2 GiB machine ✅[^node-cli]. The old + 3 × semi-space arithmetic rests on the three lab rows above, not on a container run.
**Exceptions:** `--max-old-space-size-percentage` takes a share of available memory instead ✅[^node-cli]. Not a problem when the process is alone in the container and its total stays below the limit in a load test.
**Check it:** `node --max-old-space-size=1536 -p "v8.getHeapStatistics().heap_size_limit / 2**20"`; in the pod, compare `memory.current` with `memory.max` under load.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.7 "Heap limits and how the flags add up"; the review class is `heap-limit-mismatch` in [problem-classes-containers-and-runtime-config.md](../../performance/code-review/problem-classes-containers-and-runtime-config.md).

### `JN-H2` In a container under 512 MiB, set the heap limit explicitly
**Seen in code as:** a Dockerfile or manifest with a memory limit below 512 MiB and no `--max-old-space-size`, or no `resourceLimits` on its workers.
**Prefer:**
```dockerfile
# limits.memory: 256Mi
CMD ["node", "--max-old-space-size=160", "server.js"]
```
**Avoid:**
```dockerfile
CMD ["node", "server.js"]   # default old generation 256 MiB: as large as the container
```
**Why:** Without a flag, Node.js sizes the heap from the smaller of the machine's memory and the container limit (✅[^node-env-src]): old generation = clamp(limit ÷ 2, 256 MiB, 2 GiB), with the 2 GiB cap becoming 4 GiB when that memory is 15 GiB or more ✅[^v8-heap-src]. Worker runs covered container sizes from 128 MiB to 6 GiB; the 4 GiB cap was seen only on a 16 GiB host with no container limit, not in a container of 15 GiB or more. The main thread and each worker use the same sizing function ✅[^node-env-src]. Below 512 MiB the 256 MiB minimum is half the container or more, so the kernel kills the container before V8 reaches its limit. Measured on Node.js 24.22.1 (V8 13.6); the default follows the memory the process sees.
**Evidence:** Node.js 24.22.1 (V8 13.6.233) in `node:24.22.1-alpine` on an 8 GiB Linux VM, 2026-11-06 (✅[^lab-heap]):
- on workers (piscina 5.3.2, no `resourceLimits`), the default old generation matched `clamp(limit ÷ 2, 256, 2048)` in all 11 container sizes tried (128m to 6144m and no limit);
- on the main thread, only a `heap_size_limit` of 259 MB in a 512 MiB container (256 old + 3 young); the main-thread formula at other container sizes rests on the shared sizing function in the Node.js source, not on a measurement;
- a worker with the default 256 MiB, given one task, was killed with the container (exit 137) when it allocated 150 MB in 128 MiB (100 MB survived), 200 MB in 192 MiB (150 MB survived) and 240 MB in 256 MiB (200 MB survived).
With no limit, the main thread got 2240 MiB on the 8 GiB VM ✅[^lab-v8], and on a 16 GiB macOS host (the 4 GiB cap) 4288 MiB on Node.js 24.22.1 and 25.7.0, 4144 MiB on 22.23.4 and 4192 MiB on Electron 43 ✅[^lab-v8-matrix]; the re-run (2026-11-28, after the restart) gave the same 2240, 4288, 4144 and 4192 MiB ✅[^lab-v8-matrix].
**Exceptions:** Containers from 512 MiB to 4 GiB get half the limit, which fits one process with headroom; several workers do not (`JN-W5` in [nodejs-worker-threads.md](nodejs-worker-threads.md)).
**Check it:** `node -p "v8.getHeapStatistics().heap_size_limit / 2**20"` inside the container.
**Full lab:** [node-worker-default-heap-limit.md](../../js-runtime/node-worker-default-heap-limit.md), Worked example and Edge cases; [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.7.

### `JN-H3` Read `heapUsed`, `heapTotal`, `external`, `arrayBuffers` and `rss` together, not `heapUsed` alone
**Seen in code as:** memory monitoring that reads only `process.memoryUsage().heapUsed`, or calls `process.memoryUsage()` at a high rate just for `rss`.
**Prefer:**
```js
const { heapUsed, heapTotal, external, arrayBuffers, rss } = process.memoryUsage(); // every minute
metrics.gauge('rss', process.memoryUsage.rss());                                    // cheap, for frequent samples
```
**Avoid:**
```js
setInterval(() => metrics.gauge('mem', process.memoryUsage().heapUsed), 100);
```
**Why:** Each field counts a different thing (✅[^nodeproc]):
- `heapTotal` and `heapUsed`: V8's heap, reserved and in use. `Buffer` and `ArrayBuffer` contents are never in them.
- `external`: memory of C++ objects bound to JavaScript objects. `arrayBuffers`: memory of every `ArrayBuffer`, `SharedArrayBuffer` and `Buffer`, also counted in `external`.
- `rss`: everything the process holds in RAM, JavaScript and C++ objects and code; a buffer counts in it only once its pages are touched ✅[^lab-v8]. With `Worker` threads `rss` covers the whole process and the other fields only the current thread.
`process.memoryUsage()` walks memory pages, which the docs call possibly slow; `process.memoryUsage.rss()` returns the same `rss` faster ✅[^nodeproc]. This applies to memory dashboards, leak checks and alerts of services that hold buffers.
**Evidence:** Node.js 24.22.1, after a full GC at each step, change in MiB; `heapUsed` and `heapTotal` stayed at 0 throughout ✅[^lab-v8].
- `new ArrayBuffer(64 MiB)`: `external` +64, `arrayBuffers` +64, `rss` 0 (memory reserved, not touched).
- writing every byte: `rss` +64, nothing else.
- `Buffer.alloc(64 MiB, 2)`: `external`, `arrayBuffers` and `rss` +64 together, because the fill touches every page.
- both dropped, then a full GC: the counters fell in two steps (same job, then after a timer turn), and the split varied between runs: in the printed run `rss` and `arrayBuffers` fell 128 MiB in the first step and `external` 128 MiB in the second; over three runs `arrayBuffers` fell 128 MiB then 0 twice, and 64 then 64 MiB once ✅[^lab-v8]. In the re-run (2026-11-28, after the restart; one run per build), on the arm64 baseline `rss` and `arrayBuffers` fell 128 MiB in the first step and `external` 128 MiB in the second, as in the printed run, while on the emulated x64 build `rss`, `external` and `arrayBuffers` all fell 128 MiB in the second step ✅[^lab-v8-matrix]. Over both runs the buffers were always gone after the timer turn; the share freed at the first full GC is not fixed (the emulated x64 build freed nothing at the first full GC and everything after the timer) ✅[^lab-v8-matrix].
Other builds, three runs each: on macOS (Node.js 22.23.4, 24.22.1, 25.7.0) `rss` did not fall in either step; in Electron 43.7.7, `rss` fell 127 MiB only after the timer turn and `arrayBuffers` stayed 0 in every row, which the docs allow when Node.js is embedded as a library; the Node.js 24.22.3 pointer-compression build behaved like the baseline ✅[^lab-v8-matrix]. The re-run (2026-11-28, after the restart) matched these outputs on every Node.js build ✅[^lab-v8-matrix].
**Exceptions:** Buffers are released after the GC, not inside it: wait a timer turn before reading ✅[^lab-v8]. On glibc systems `rss` can keep growing while `heapTotal` is stable, because of `malloc` fragmentation ✅[^nodeproc].
**Check it:** Run the deep dive's `external.mjs` with `node --expose-gc` on the platform in use.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.8 "External memory: `ArrayBuffer`, `Buffer` and `process.memoryUsage()`".

### `JN-H4` Raising `--max-semi-space-size` does not cut minor GCs of garbage that dies at once
**Keep writing:** the start command without the flag, unless a `--trace-gc` count on the target machine shows it helps.
**Why:** The flag raises a ceiling, and the young generation matters only when it actually grows ✅[^lab-v8]. Each 1 MiB of semi-space adds 3 MiB to the heap limit ✅[^node-cli]. The Node.js memory guide says a larger new space can reduce minor GCs ✅[^nodelearn]; that holds only where the new space grows. This is `no gain` for garbage that dies at once; it is `check build` where the default semi-space is smaller (V8 12.4, Electron 43) or the machine has little memory.
**Evidence:** Node.js 24.22.1, 20,000 calls of `input.map(...)` on a 1,000-element array: with `--max-semi-space-size` 1, 16 and 64 the new space stayed at 2 MiB and the count at 158 or 159 scavenges, as with no flag, in three runs ✅[^lab-v8].
- **Other builds, garbage that dies at once.** `=16` and `=64` changed nothing for that loop on any of the seven builds, whose default counts differ: 157 (V8 14.1), 161 (V8 12.4), 79 on the Node.js 24.22.3 pointer-compression build, 193 to 195 on Electron 43 (228 or 229 with `=1`) ✅[^lab-v8-matrix].
- **Many survivors.** With many survivors (each array kept for 2,000 calls) the default on the 8 GiB machine already allowed 64 MiB, so `=64` changed nothing (13 scavenges) ✅[^lab-v8].
- **Smaller default semi-space.** Where the default semi-space is smaller, `=64` cut scavenges from 27 to 14 on Node.js 22.23.4 and from 18 or 19 to 15 on Electron 43; not on the pointer-compression build (11 and 11) ✅[^lab-v8-matrix].
- **Re-run.** The re-run (2026-11-28, after the restart, one run per command and build) gave these counts again on every build, except for the sliding window with `--max-semi-space-size=1`: 318 scavenges on Node.js 22.23.4 (first run 317), 364 on Electron 43 (first run 381) and 314 on emulated x64 (first run 316), with the same number of major GCs ✅[^lab-v8-matrix].
**Exceptions:** At a 512 MiB memory limit the documented default is 1 MiB ✅[^node-cli], and raising it can matter there. `--min-semi-space-size=16` did change the count (10 scavenges, new space 32 MiB) ✅[^lab-v8]. Lowering the ceiling to 1 MiB raised scavenges from 13 to about 310 for surviving objects (measured 314, with 2 major GCs; 308 to 314 over five runs of the first run, and 314 again in the re-run) ✅[^lab-v8].
**Check it:** `node --trace-gc app.js | grep -c Scavenge` with and without the flag, on the target machine.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §4.5 "Allocation rate and the young generation's size", §3.7 and §6.1 "Corrections".

### `JN-H5` Size thread and process counts with `os.availableParallelism()`, not `os.cpus().length`
**Prefer:**
```js
import { availableParallelism } from 'node:os';
const workers = availableParallelism(); // reads the container's CPU quota (libuv 1.52 or later)
```
**Avoid:**
```js
const workers = os.cpus().length; // the machine's CPUs: 8 inside a 0.5 CPU container
```
**Why:** `os.cpus()` lists every CPU of the machine, and the Node.js docs say not to use its length for parallelism ✅[^node-os]. `availableParallelism()` wraps libuv's `uv_available_parallelism()` ✅[^node-os], which takes the CPUs the process may run on and, under a cgroup CPU quota, min(that, max(1, floor(quota ÷ period))) ✅[^libuv-src].
**Evidence:** Node.js 24.22.1 (libuv 1.52.1, the only Node.js and libuv versions run) in `node:24.22.1-alpine` on an 8-CPU Linux VM, 2026-11-06: `os.cpus().length` was 8 in every row; `availableParallelism()` gave 8 with no limit, 1 at `--cpus=0.5`, `1` and `1.99`, 2 at `2` and `2.9`, 4 at `4`, and 2 with `--cpuset-cpus=0,1`. A Kubernetes pod with `limits.cpu: 500m` on a 4-CPU node gave 1 (`os.cpus().length` was 4) ✅[^lab-pools]. Not run on macOS or on older Node.js.
**Exceptions:** The fraction is dropped, so 1.99 CPU gives 1 ✅[^lab-pools]. libuv added the cgroup reading in 1.49.0 and fixed limits below one period (every fractional limit such as 500m) in 1.52.0 ✅[^libuv-log], so Node.js builds with an older libuv may return the machine's count (inferred from the change log, not run). A dedicated node with no CPU limit gives the machine's count anyway; an I/O-bound pool is sized from concurrency instead (review class `host-sized-pools`).
**Check it:** `node -p "os.availableParallelism() + ' libuv ' + process.versions.uv"` inside the container; `cat /sys/fs/cgroup/cpu.max`.
**Full lab:** [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), How it works (step 4) and Worked example; [problem-classes-containers-and-runtime-config.md](../../performance/code-review/problem-classes-containers-and-runtime-config.md), `host-sized-pools`.

### `JN-H6` Treat `process.constrainedMemory()` of 0 or above `os.totalmem()` as "no limit"
**Prefer:**
```js
const c = process.constrainedMemory();
const limit = c > 0 && c <= os.totalmem() ? c : os.totalmem();
```
**Avoid:**
```js
const limit = process.constrainedMemory() || os.totalmem(); // 2^64 passes as a "limit"
```
**Why:** With no container memory limit the cgroup reports "max", which arrived as 2⁶⁴ ✅[^lab-pools], while the docs say 0 is returned when there is no constraint or it is unknown ✅[^nodeproc].
**Evidence:** Node.js 24.22.1 (linux arm64) in `node:24.22.1-alpine`: with no memory limit `process.constrainedMemory()` returned 18446744073709552000 (2⁶⁴); with a 512 MiB limit it returned 512 MB; on a macOS host it returned 0 (the Node.js version there is not stated) ✅[^lab-pools]. Not run on Node.js 22 or 25.
**Exceptions:** None found in the lab.
**Check it:** `node -p "process.constrainedMemory()"` with and without `docker run --memory`.
**Full lab:** [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), Edge cases (`process.constrainedMemory()`); [node-worker-default-heap-limit.md](../../js-runtime/node-worker-default-heap-limit.md), Worked example.

## Takeaways
- A heap flag is only right relative to the container limit: `heap_size_limit` = old generation + 3 × semi-space, and buffers, code and stacks come on top. [rule-candidate]
- Under 512 MiB the default old generation (256 MiB) is as large as the container or larger: set the flag.
- `heapUsed` says nothing about buffers; watch `external`, `arrayBuffers` and `rss` as well.
- `--max-semi-space-size` is a ceiling; without a `--trace-gc` count on the target machine it is not a tuning step.
- Read container limits through `availableParallelism()` and a guarded `constrainedMemory()`, never `os.cpus().length`.

## Verification status
- Verified: 60 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- V8 memory lab: the scripts of the deep dive, run on 2026-11-26 with Node.js 24.22.1 (V8 13.6.233.17-node.58) in `node:24.22.1-alpine`, arm64, 8 CPUs, 8 GiB, `--network none`, three full passes, and re-run on 2026-11-28 after a restart of the lab machine (every baseline output matched); scripts and outputs in [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.7, §3.8 and §4.5, and its Verification status. Rank 1 (primary measurement). Backs: Summary; Scope; Catalog, JN-H1 and JN-H3; Lookup notes. [^lab-v8]
- Pointer-compression probe: `process.config.variables.v8_enable_pointer_compression` and the 4 GB heap cap, read on 2026-11-27 on Node.js 22.23.4, 24.22.1 (linux arm64, macOS arm64, linux x64 emulated), 25.7.0, Electron 43.7.7 and the unofficial Node.js 24.22.3 pointer-compression build; outputs in [v8-object-and-value-representation-deep-dive.md](../../js-runtime/v8-object-and-value-representation-deep-dive.md), §3.1 and §6.3. Rank 1 (primary measurement). Backs: Scope. [^lab-pc]
- V8 memory lab matrix: the same scripts re-run on 2026-11-27 on macOS 26.1 arm64 with Node.js 24.22.1, 22.23.4 (V8 12.4) and 25.7.0 (V8 14.1), linux x64 emulated with Node.js 24.22.1, Electron 43.7.7 as Node (V8 15.0, pointer compression on) and Node.js 24.22.3 with pointer compression (V8 13.6, emulated linux x64), and re-run on 2026-11-28 after a restart of the lab machine (362 runs on the Node.js builds; all 168 cells of the matrix matched, and the defaults that follow the machine's memory came out the same); outputs in [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §6.4, and its Verification status. Rank 1 (primary measurement). Backs: Catalog, JN-H4; Lookup notes. [^lab-v8-matrix]
- Worker heap-limit measurements, 2026-11-06: Node.js 24.22.1 (V8 13.6.233) in `node:24.22.1-alpine` on an 8 GiB Linux VM, piscina 5.3.2, `docker run --memory --memory-swap --cpus`; outputs in [node-worker-default-heap-limit.md](../../js-runtime/node-worker-default-heap-limit.md), Worked example and Edge cases. Rank 1 (primary measurement). Backs: Catalog and Lookup notes, JN-H2. [^lab-heap]
- CPU and memory limit measurements, 2026-11-06: Node.js 24.22.1 (libuv 1.52.1) in `node:24.22.1-alpine` on an 8-CPU Linux VM with `docker run --cpus`, `--cpuset-cpus` and `--memory`, and read-only checks in one Kubernetes pod; script and outputs in [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), Worked example and Edge cases. Rank 1 (primary measurement). Backs: Summary; Catalog and Lookup notes, JN-H5 and JN-H6. [^lab-pools]
- [Command-line API](https://nodejs.org/docs/latest-v24.x/api/cli.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Catalog, JN-H1; Lookup notes, JN-H1 and JN-H4 (`--max-old-space-size`, `--max-old-space-size-percentage`, `--max-semi-space-size`, 1536 MiB on 2 GiB). [^node-cli]
- [Process, process.memoryUsage() and process.constrainedMemory()](https://nodejs.org/docs/latest-v24.x/api/process.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Catalog, JN-H6; Lookup notes, JN-H3 and JN-H6. [^nodeproc]
- [OS: os.availableParallelism()](https://nodejs.org/api/os.html) — Node.js project, v26.13.1 docs (the API dates from v18.14.0 and v19.4.0). Rank 1. Backs: Lookup notes, JN-H5. [^node-os]
- [Understanding and Tuning Memory](https://nodejs.org/en/learn/diagnostics/memory/understanding-and-tuning-memory) — Node.js learn guide, living. Rank 1. Backs: Lookup notes, JN-H4. [^nodelearn]
- [src/heap/heap.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/heap/heap.cc) — V8 project, 2025. Rank 1. Backs: Lookup notes, JN-H1 (young-generation size from the semi-space size). [^heapcc]
- [V8 13.6.233 src/heap/heap.cc and heap.h](https://github.com/v8/v8/blob/13.6.233/src/heap/heap.cc) — V8 project, 2026. Rank 1. Backs: Lookup notes, JN-H2 (old generation from physical memory, the 2 GiB and 4 GiB caps). [^v8-heap-src]
- [Node.js v24.22.1 src/api/environment.cc](https://github.com/nodejs/node/blob/v24.22.1/src/api/environment.cc) — Node.js project, 2026. Rank 1. Backs: Lookup notes, JN-H2 (`SetIsolateCreateParamsForNode`, shared by the main thread and workers). [^node-env-src]
- [libuv v1.52.1 src/unix/core.c](https://github.com/libuv/libuv/blob/v1.52.1/src/unix/core.c) and [src/unix/linux.c](https://github.com/libuv/libuv/blob/v1.52.1/src/unix/linux.c) — libuv project, 2026. Rank 1. Backs: Lookup notes, JN-H5 (affinity count, `cpu.max`, integer division, minimum 1). [^libuv-src]
- [libuv ChangeLog](https://github.com/libuv/libuv/blob/v1.x/ChangeLog) — libuv project, living. Rank 1. Backs: Lookup notes, JN-H5 (1.49.0 and 1.52.0 entries). [^libuv-log]

## Related
- [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) — the garbage collector, heap limits and external memory, with every script behind `JN-H1`, `JN-H3` and `JN-H4`.
- [node-worker-default-heap-limit.md](../../js-runtime/node-worker-default-heap-limit.md) — the default heap limit per container size.
- [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md) — `availableParallelism()` under CPU limits.
- [problem-classes-containers-and-runtime-config.md](../../performance/code-review/problem-classes-containers-and-runtime-config.md) — `heap-limit-mismatch` and `host-sized-pools` across runtimes.
- [../../kubernetes/memory-limits-and-oom-kill.md](../../kubernetes/memory-limits-and-oom-kill.md) — how a memory limit ends in an OOM kill.
