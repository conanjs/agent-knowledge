---
schema: knowledge-doc/v1
type: concept
topic: bun/internals
status: verified
applies-to: ["Bun 1.4.5", "Node.js 24.22.1", "npm 11.19.1", "pg 8.23.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, performance, benchmark, startup, http, bun-serve, json, file-io, bun-install, npm, nodejs]
---

# Bun performance: why it is often faster, and what we measured against Node 24

## Summary
**TL;DR:** Bun's docs credit its speed to JavaScriptCore's fast start, APIs implemented natively (in Rust since Bun 1.4, in Zig before), the fastest system call per platform, and one binary that also holds the package manager ✅[^1] ✅[^2] ✅[^3] ✅[^4]. On one arm64 machine (Docker on OrbStack, a host loaded by other work, median of 7 interleaved rounds), Bun won in every round, with ranges that did not overlap, on process start (2.7 vs 19.3 ms), a TypeScript hello world (1.8 vs 52.1 ms), a hello-world HTTP server (227k vs 95k requests/s) and `bun install` (0.96 vs 2.5 s cold, 39 vs 540 ms warm) ✅[^lab]. It was 1.25–1.6× faster on two CPU-bound loops and 1.8× on `JSON.stringify`, close on `JSON.parse` (ranges overlap), and Node was faster at reading one 50 MB file in all 7 rounds and at writing it in 5 of 7 ✅[^lab]. Absolute numbers moved with host load: a re-run of the HTTP rows at lower load gave 1.6–2.0× more requests/s for every server, with `Bun.serve` still 2.4–2.5× ahead of `node:http` on Node ✅[^lab]. A handler that renders a 7 KB HTML table cut that lead to 1.7–1.9× ✅[^lab]; one PostgreSQL lookup per request did not (`Bun.sql` 2.5× `pg`) ✅[^lab]. Node on glibc started 11–27% faster than on musl, which narrows Bun's start-up lead to 5–20× without changing any verdict ✅[^lab]. Against Bun 1.3.14, 1.4.5 idled at 2.3× less CPU and started 4.3× faster ✅[^lab].
**Use this when:** deciding whether Bun's speed matters for a given workload, or repeating these measurements on your own machine.
**Not this doc:** how to benchmark in general → `performance/measurement/benchmarking-methodology.md`; JIT (just-in-time compiler) tiers and memory → [javascriptcore-engine.md](javascriptcore-engine.md); `Bun.serve` features → `bun/http-and-networking/bun-serve.md`.

## Problem
Published numbers ("starts 4× faster", "installs up to 25× faster") come from the vendor's machines and workloads ✅[^1] ✅[^4]. Teams then expect every part of an app to get that factor, and are surprised when a file-heavy job is not faster, or when a test harness, not the runtime, decides the result. A useful comparison names the workload, runs both runtimes on the same machine, repeats the runs, and says where Node wins.

## Mental model
**Analogy:** a taxi fare has a flag-drop charge and a per-kilometre rate. Bun's flag-drop (process start, loading TypeScript, installing packages) is far lower than Node's; the per-kilometre rate (a hot loop, parsing JSON, copying a big file) depends on the road and is often close.

**Artifact:** two rows of the results table below, both measured ✅[^lab]:
```
bun -e 0       2.65 ms   |  node -e 0      19.26 ms    ← flag-drop: 7.3× apart
JSON.parse    169 ms     |  JSON.parse     196 ms      ← per-km: ranges overlap
```

## How it works
### Why Bun is often faster, per its own sources
1. **Engine start.** Bun uses JavaScriptCore, which, per Bun's docs, usually starts and runs faster than V8 ✅[^1]. JSC's interpreter (LLInt) is designed to cost nothing beyond lexing and parsing before code runs ✅[^5].
2. **Native implementations.** Bun's transpiler and runtime are written in Rust ✅[^1]; Bun 1.4 rewrote Bun from Zig to Rust ✅[^2] (the history: [what-bun-is.md](../fundamentals/what-bun-is.md)). TypeScript is transpiled inside the same process before it runs ✅[^1], so the lab's TypeScript hello world started as fast as the JavaScript one ✅[^lab]; strace showed a single `execve` for `bun hello.ts` ✅[^lab].
3. **System calls chosen per platform.** `Bun.write` picks `copy_file_range` or `sendfile` on Linux and `clonefile` or `fcopyfile` on macOS, depending on source and destination ✅[^6]; `bun install` links packages from its global cache with hardlinks on Linux and `clonefile` on macOS ✅[^7], and caches registry responses in a binary format ✅[^4]. Linux, under strace 6.13 in `bunlab:2`: `Bun.write(dst, Bun.file(src))` of 50 MB did `fallocate`, then one `copy_file_range(6, NULL, 7, NULL, 52428800, 0)` ✅[^lab]. After `bun install` of zod 3.24.1, `node_modules/zod/package.json` and its cache copy shared one inode (link count 2); installed into a folder on another file system, the link count was 1, a copy ✅[^lab]. The cached manifest file began with `#!/usr/bin/env bun` and `bun-npm-manifest-cache-v0.0.8`, then binary data (29% printable bytes) ✅[^lab]. The macOS calls were not traced, because the lab runs Linux containers only.
4. **Allocator and idle work.** Since 1.4, JSC in Bun allocates with mimalloc, and garbage-collection timers and `futex` calls were cut back, lowering CPU and memory use ✅[^2]. The release notes put the idle CPU of a small "hello world" app 5× lower, and `hello.js` on Linux at 5.1 ms and 14.6 MB peak memory against 10.9 ms and 33.0 MB for 1.3 ✅[^2]. `heapStats()` from `bun:jsc` has a `mimalloc` section ✅[^lab], but 1.3.14's has one too, so it does not mark the change (see [javascriptcore-engine.md](javascriptcore-engine.md)). Measured against `oven/bun:1.3.14` on this VM, at a 1-minute load average of 2.0–2.9 ✅[^lab]:

   | Measure | Bun 1.3.14 | Bun 1.4.5 | Change |
   |---|---|---|---|
   | Idle `Bun.serve` hello world, 3 runs of both side by side: CPU time of all threads per 30 s | 107–112 ms | 44–49 ms | 2.3× less ✅[^lab] |
   | Same: context switches (wake-ups) per 30 s | 3,725–3,787 | 2,095–2,205 | 1.7× fewer ✅[^lab] |
   | Same: resident memory | 38.7 MB | 26.3 MB | 32% less ✅[^lab] |
   | Same, 20 s under strace, 2 runs: `futex` calls | 2,350–2,369 | 1,444–1,484 | 38% fewer ✅[^lab] |
   | Same: `madvise` calls; `SIGPWR` signals between its own threads | 85–96; 46–54 | 16–19; 4 | ✅[^lab] |
   | Start, `-e 0` and `hello.js`, median of 30 per round, 5 rounds | 5.08–5.36 and 5.12–5.26 ms | 1.19–1.24 and 1.09–1.17 ms | 4.3–4.6× faster ✅[^lab] |
   | Peak resident memory of `hello.js`, median of 11 per round, 5 rounds | 39.8 MB | 27.3 MB | 31% less ✅[^lab] |

   Every measure moved the way the notes say; the sizes differ: idle CPU fell 2.3×, not 5×, start-up gained more than the notes' 2×, and peak memory less than their "less than half" ✅[^lab] ✅[^2].
5. **One binary.** The runtime, package manager, test runner and bundler ship as one dependency-free binary ✅[^3]; in the image, `/usr/local/bin` held `bun` (107,405,304 bytes) and `bunx`, a link to it, and `readelf -d` listed only C library files (`libc.so.6`, `libpthread.so.0`, `libdl.so.2`, `libm.so.6` and the loader) ✅[^lab]. Bun's docs put `bun run` script start at 6 ms against roughly 170 ms for `npm run` on Linux ✅[^1]; here a `package.json` script `true` took a median 1.1–1.7 ms with `bun run` and 59–72 ms with npm 11.19.1's `npm run`, per round over 5 rounds of 15 runs ✅[^lab].

### How we measured
Five actors took part in each round:
- **Host** — its job: run every container on the same 8-CPU arm64 VM (virtual machine), via Docker on OrbStack (kernel 7.2.12) on an 8-CPU Mac ✅[^lab].
- **Bun container** — its job: run each Bun benchmark, via `oven/bun:1.4.5` (Debian 13, glibc, the GNU C library) ✅[^lab].
- **Node container** — its job: run each Node benchmark, via `node:24.22.1-alpine` (musl, a smaller C library) with npm 11.19.1 ✅[^lab]; a second session added `node:24.22.1-bookworm-slim` (glibc 2.36) to measure what the C library changes ✅[^lab].
- **Startup harness** — its job: time a child process, via `spawnSync` in the runtime under test, 3 warm-up runs then the median of 30 ✅[^lab].
- **HTTP client** — its job: load each server, via a Bun raw-TCP HTTP/1.1 keep-alive client (64 connections over 4 worker threads) in its own container ✅[^lab].

```
 one round (×7):  startup → cpu → json → file I/O → HTTP ×3 servers → install      (Bun, then Node, per benchmark)

 HTTP benchmark:
 ┌──────────────── server container (CPU 1) ───────────────┐      ┌──── client container (CPUs 4–7) ────┐
 │ Bun.serve  |  node:http on Node  |  node:http on Bun     │◀────▶│ client.ts: 64 keep-alive sockets,   │
 │ 127.0.0.1:3000                                           │ lo   │ 2 s warm-up, then 10 s counted       │
 └──────────────────────────────────────────────────────────┘      └─────────────────────────────────────┘
          shared network namespace (--network container:kb-srv): no traffic leaves the VM
```

1. **Harness bias check:** timing `/bin/true` gave 0.28 ms under Bun's harness and 0.32 ms under Node's, so the harness adds well under 1 ms to the startup rows ✅[^lab].
2. **In-process timers:** CPU, JSON and file rows use `performance.now()` inside the script; JSON and file rows take the median of 5 iterations per process, while the CPU row times one run per process, so each of its round values is a single run ✅[^lab].
3. **HTTP:** each server runs on CPU 1 with no other benchmark container (other work on the host was not pinned away from it); both servers send `content-length: 12` and the 12-byte body `Hello, world`, so the client parses fixed-size responses ✅[^lab]. Each round value is one 10 s run after a 2 s warm-up ✅[^lab]. The client was not the limit: in a re-run at lower host load, 4 threads on 4 CPUs gave 385,590 and 388,251 requests/s against `Bun.serve`, and 6 threads on 6 CPUs gave 374,222 and 373,414 ✅[^lab]. A later check, two rounds per setting with its output saved (1-minute load average 6.2–7.0), gave 319,545 and 310,890 with 4 threads on 4 CPUs, 315,998 and 192,175 with 8 threads on the same 4 CPUs, and 307,584 and 294,619 with 6 threads on 6 CPUs (66 sockets) ✅[^lab]. Neither more threads nor more CPUs raised the rate, so the server set it. An earlier figure from raising only the thread count on 4 CPUs (207k vs 256k requests/s) had no saved output, and this check did not reproduce a rise; more threads on the same CPUs proves nothing either way, because it adds no CPU.
4. **Install:** cold means a fresh container (empty cache, no lockfile, no `node_modules`); warm means the same container after deleting only `node_modules`; each round runs one cold and one warm install per tool ✅[^lab]. npm ran with `--no-audit --no-fund --ignore-scripts`; Bun's time comes from `date` in `bash`, npm's from `performance.now()` around `execSync`, so both include the tool's own start ✅[^lab].
5. **Rounds:** every number below is the median of the 7 round values, with the range (lowest and highest round value) in brackets ✅[^lab]. **Faster** is the ratio of the two medians; **Verdict** says in how many of the 7 rounds the faster runtime won, and whether the two ranges overlap. The 1-minute load average of the Mac (its `uptime`, sampled at each benchmark) was 8.7–37 (median 14.7) on 8 CPUs, because other workloads shared the host ✅[^lab].

### Results (median of 7 rounds)
| Benchmark | Bun 1.4.5 | Node 24.22.1 | Faster | Verdict |
|---|---|---|---|---|
| Process start, `-e 0` | 2.65 ms [1.48–3.94] | 19.26 ms [15.87–24.59] | Bun 7.3× | Clear: 7 of 7 rounds, no overlap ✅[^lab] |
| `hello.js` (one `console.log`) | 2.10 ms [1.35–3.85] | 23.59 ms [18.41–33.12] | Bun 11× | Clear: 7 of 7, no overlap ✅[^lab] |
| `hello.ts` (types, interface; Node via type stripping) | 1.77 ms [1.61–4.73] | 52.13 ms [46.08–77.07] | Bun 29× | Clear: 7 of 7, no overlap ✅[^lab] |
| Recursive `fib(35)`, JIT warm-up included | 51 ms [41–69] | 80 ms [73–135] | Bun 1.6× | Modest: 7 of 7, no overlap ✅[^lab] |
| Sieve of primes below 10,000,000 (`Uint8Array`) | 36 ms [34–88] | 45 ms [43–94] | Bun 1.25× | Modest: 7 of 7, ranges overlap ✅[^lab] |
| `JSON.stringify` of 200,000 records (32.4 MB) | 49 ms [37–64] | 90 ms [77–98] | Bun 1.8× | Clear: 7 of 7, no overlap ✅[^lab] |
| `JSON.parse` of the same 32.4 MB | 169 ms [109–221] | 196 ms [157–301] | Bun 1.16× | Close: 6 of 7, ranges overlap ✅[^lab] |
| `fs.writeFileSync` of 50 MB to `/tmp` | 8.5 ms [5.1–13.4] | 5.6 ms [5.2–9.7] | Node 1.5× | Node in 5 of 7, ranges overlap ✅[^lab] |
| `fs.readFileSync` of that file | 14.6 ms [12.3–20.5] | 10.2 ms [8.2–15.6] | Node 1.4× | Node in 7 of 7, ranges overlap ✅[^lab] |
| HTTP hello world, `Bun.serve` vs `node:http` | 226,820 req/s [196,014–282,762] | 94,910 req/s [67,342–131,702] | Bun 2.4× | Clear: 7 of 7, no overlap ✅[^lab] |
| Same `node:http` server code run by Bun | 121,623 req/s [98,496–205,768] | 94,910 req/s | Bun 1.3× | Modest: 6 of 7, ranges overlap ✅[^lab] |
| `install`: express 4.21.2, zod 3.24.1, lodash 4.17.21, cold | 958 ms [845–1096] | 2516 ms [2167–3056] | Bun 2.6× | Clear: 7 of 7, no overlap ✅[^lab] |
| Same, warm (cache and lockfile kept) | 39 ms [19–55] | 540 ms [437–711] | Bun 14× | Clear: 7 of 7, no overlap ✅[^lab] |

Bun-only file APIs on the same 50 MB buffer: `await Bun.write(path, buf)` 27.6 ms [23.3–41.2], `await Bun.file(path).bytes()` 14.4 ms [10.0–19.1] ✅[^lab].

**Re-run at lower load.** Three more HTTP rounds, run the same way while the Mac's 1-minute load average stayed below 2.6, gave `Bun.serve` 384,423–390,727, `node:http` on Node 154,343–159,166 and `node:http` on Bun 228,781–238,237 requests/s ✅[^lab]. Every server got 1.6–2.0× its loaded-host median, so read the absolute numbers above as numbers for a loaded host; the ratios moved less: `Bun.serve` over `node:http` on Node 2.4–2.5×, `node:http` on Bun over Node 1.45–1.5× ✅[^lab].

### Node on glibc against Node on musl
The table above ran Node on musl. Seven more interleaved rounds (23:58–00:04, 1-minute load average 5.7–15.3) ran each benchmark in Bun, in `node:24.22.1-alpine` (musl) and in `node:24.22.1-bookworm-slim` (glibc 2.36), with the start-up, JSON and file containers pinned to CPUs 2–3 and the HTTP setup unchanged ✅[^lab]. The JSON payload here was 200,000 records with a nested address object, 39.9 MB, so those rows do not compare with the first table. Median of 7 rounds, range in brackets ✅[^lab]:

| Benchmark | Bun 1.4.5 | Node on musl | Node on glibc | glibc against musl |
|---|---|---|---|---|
| Process start, `-e 0` | 2.82 ms [1.41–5.96] | 20.78 ms [14.71–31.09] | 15.08 ms [9.98–25.13] | 27% faster, 7 of 7 rounds ✅[^lab] |
| `hello.js` | 2.47 ms [1.31–7.24] | 23.56 ms [18.34–37.37] | 17.52 ms [12.13–29.04] | 26% faster, 7 of 7 ✅[^lab] |
| `hello.ts` | 2.63 ms [1.26–7.72] | 57.57 ms [45.22–78.31] | 51.34 ms [39.62–65.42] | 11% faster, 6 of 7 ✅[^lab] |
| `JSON.stringify` (39.9 MB) | 42 ms [32–56] | 96 ms [85–132] | 95 ms [87–146] | no change: faster in 3 of 7 ✅[^lab] |
| `JSON.parse` of it | 163 ms [112–241] | 170 ms [159–240] | 207 ms [175–277] | 22% slower, 7 of 7 ✅[^lab] |
| `fs.writeFileSync`, 50 MB | 15.4 ms [11.6–21.8] | 22.1 ms [15.9–25.2] | 17.2 ms [16.0–22.9] | 22% faster, 6 of 7 ✅[^lab] |
| `fs.readFileSync`, 50 MB | 20.7 ms [13.8–27.3] | 16.4 ms [8.4–20.1] | 13.0 ms [7.8–15.3] | 21% faster, 5 of 7 ✅[^lab] |
| HTTP hello world (req/s) | 285,822 [174,174–348,715] | 133,493 [83,506–146,711] | 125,736 [95,033–159,888] | no clear shift: higher in 6 of 7 rounds (per-round ratio 0.80–1.25) but a 6% lower median ✅[^lab] |

So musl cost Node a fifth to a quarter of its start-up and file I/O time, nothing on `JSON.stringify`, and gave it a faster `JSON.parse` ✅[^lab]. Against glibc Node, Bun's start-up lead in these rounds was 5.3× (`-e 0`), 7.1× (`hello.js`) and 19.5× (`hello.ts`), against 7.4×, 9.5× and 22× over musl Node; its `fs.writeFileSync` lead fell from 1.4× to 1.1×, Node's `fs.readFileSync` lead grew from 1.3× to 1.6×, `JSON.parse` moved from a tie (1.04×) to Bun 1.27× faster, and `Bun.serve` stayed 2.1–2.3× ahead ✅[^lab]. Every verdict of the first table keeps its direction.

## Worked example
One HTTP round, end to end. The two servers, each started on CPU 1 with no other benchmark container:
```ts
// server-bun.ts
Bun.serve({ port: 3000, hostname: '127.0.0.1', fetch: () => new Response('Hello, world') });
```
```js
// server-node.mjs
http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain;charset=utf-8', 'content-length': '12' }); res.end('Hello, world'); }).listen(3000, '127.0.0.1');
```
The client keeps one request in flight per socket and sends the next as soon as a full response arrives:
```console
$ docker run -d --name kb-srv --cpuset-cpus=1 -v "$PWD:/w" -w /w oven/bun:1.4.5 bun server-bun.ts
$ docker run --rm --cpuset-cpus=4-7 --network container:kb-srv -v "$PWD:/w" -w /w oven/bun:1.4.5 bun client.ts 64 2 4    # 2 s warm-up, output discarded
$ docker run --rm --cpuset-cpus=4-7 --network container:kb-srv -v "$PWD:/w" -w /w oven/bun:1.4.5 bun client.ts 64 10 4
{"conns":64,"secs":10,"requests":2268195,"rps":226820,"errors":0}
$ docker rm -f kb-srv
$ docker run -d --name kb-srv --cpuset-cpus=1 -v "$PWD:/w" -w /w node:24.22.1-alpine node server-node.mjs
$ docker run --rm --cpuset-cpus=4-7 --network container:kb-srv -v "$PWD:/w" -w /w oven/bun:1.4.5 bun client.ts 64 2 4    # warm-up
$ docker run --rm --cpuset-cpus=4-7 --network container:kb-srv -v "$PWD:/w" -w /w oven/bun:1.4.5 bun client.ts 64 10 4
{"conns":64,"secs":10,"requests":1056771,"rps":105677,"errors":0}
```
Round 1 gave 226,820 against 105,677 requests/s; over 7 rounds the medians were 226,820 and 94,910 ✅[^lab]. Node's responses also carried `Connection: keep-alive` and `Keep-Alive: timeout=5` headers that `Bun.serve` does not send, so Node wrote more bytes per response ✅[^lab]. With a handler that does more, the runtime's share of each request is smaller and the gap narrows: a handler rendering a 100-row HTML table (7,291 bytes) on every request, run in three interleaved rounds with the hello-world servers (1-minute load average 6.4–7.8), gave `Bun.serve` 74,700, 65,024 and 67,106 against `node:http` on Node 39,821, 35,383 and 39,282 requests/s, 1.7–1.9× per round, while hello world in the same rounds was 2.25–2.46× ✅[^lab].

A database-backed handler kept the gap. `Bun.serve` with `Bun.sql` ran against `node:http` with `pg` 8.23.1 (node-postgres, installed into the Node container) on Node 24.22.1 in `node:24.22.1-bookworm-slim`. Each server answered every request with one primary-key lookup, `SELECT id, name, price FROM items WHERE id = $1` with a random id among 10,000 rows, as 42–43 bytes of JSON, through a pool of 10 connections to one `postgres:latest` (18.3) container on CPUs 2–3; same client, 5 interleaved rounds, 1-minute load average 4.6–6.2 ✅[^lab]. `Bun.sql` gave 104,813 requests/s [76,565–110,277], `pg` 42,058 [33,841–43,385], and `pg` with a named prepared statement 40,029 [32,993–40,645]: Bun 2.3–2.5× in every round, with all 10 pool connections open for each server ✅[^lab]. The same PostgreSQL answered over 110,000 queries/s for Bun, so the database was not what held Node near 42,000.

The client check from How we measured, step 3, as the client printed it (server `Bun.serve` on CPU 1; each line one 10 s run after a 2 s warm-up) ✅[^lab]:
```console
cpus=4-7 threads=4 round=1 {"conns":64,"secs":10,"threads":4,"requests":3195447,"rps":319545,"errors":0}
cpus=4-7 threads=8 round=1 {"conns":64,"secs":10,"threads":8,"requests":3159983,"rps":315998,"errors":0}
cpus=2-7 threads=6 round=1 {"conns":66,"secs":10,"threads":6,"requests":3075841,"rps":307584,"errors":0}
cpus=4-7 threads=4 round=2 {"conns":64,"secs":10,"threads":4,"requests":3108900,"rps":310890,"errors":0}
cpus=4-7 threads=8 round=2 {"conns":64,"secs":10,"threads":8,"requests":1921752,"rps":192175,"errors":0}
cpus=2-7 threads=6 round=2 {"conns":66,"secs":10,"threads":6,"requests":2946193,"rps":294619,"errors":0}
```

## Edge cases
| Case | What happens | Why |
|---|---|---|
| The first try of the Node server set headers without `content-length` | The client counted half the responses as errors ✅[^lab] | `writeHead(200, { 'content-type': … })` followed by `res.end(body)` answered with `Transfer-Encoding: chunked`, while a bare `res.end(body)` got `Content-Length: 12` ✅[^lab]; set `content-length` or parse chunked encoding before trusting a custom client |
| `Bun.write` of a 50 MB in-memory buffer | 27.6 ms, slower than Bun's own `fs.writeFileSync` (8.5 ms) here ✅[^lab] | The documented fast paths (`copy_file_range`, `sendfile`, `splice`, `clonefile`) copy from files, pipes and terminals; a buffer goes to a file with plain `write` ✅[^6]. Under strace, `Bun.write(path, uint8array)` first copied the 50 MB into an in-memory file (`memfd_create`, `ftruncate`, one 50 MB `pwrite64`, `mmap`), then a second thread opened the target and wrote the 50 MB with `write`, so the data was copied twice and crossed threads; `writeFileSync` did `fallocate` and one `write` on the JavaScript thread. Re-timed: 41.9–50.7 ms against 11.4 ms, median of 7, two runs ✅[^lab] |
| Same server code on Node and on Bun | `node:http` under Bun reached 54% of `Bun.serve`'s median (per round 36–86%; 60–61% in the lower-load re-run) ✅[^lab] | The compatibility layer cost throughput against the native API in every run |
| TypeScript start in Node | 52 ms against 24 ms for `hello.js` ✅[^lab] | Node's type stripping adds work per process; Bun's transpiler is built in ✅[^1] |
| Large TypeScript files in the `oven/bun` image | The runtime transpiler cache is off in Bun's Docker images ✅[^8] | The cache (files over 4 KB) is meant for persistent disks; set `BUN_RUNTIME_TRANSPILER_CACHE_PATH` to keep it ✅[^8]; the variable is described in `bun/fundamentals/configuration-and-environment.md`. The image sets it to `0`; pointed at `/tmp/tc`, a 12,984-byte `.ts` file left one `.pile` file there and a one-line file left none ✅[^lab] |
| Startup numbers on a busy host | Bun's medians ranged 1.48–3.94 ms between rounds ✅[^lab] | The host's load average ranged 8.7–37 over the rounds; report ranges, not one run |
| Different libc in the two images | Bun ran on glibc, Node on musl in the first table ✅[^lab] | The official images differ. Node on glibc (`node:24.22.1-bookworm-slim`) started 11–27% faster, wrote and read 50 MB 21–22% faster and parsed JSON 22% slower than Node on musl; HTTP showed no clear shift (section "Node on glibc against Node on musl") ✅[^lab] |
| Cold `install` | Depends on the network and the registry, not only the tool ✅[^lab] | All 7 cold runs downloaded from the public registry and left 69 (Bun) and 71 (npm) top-level folders in `node_modules` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Run the app on Bun | Much faster start and install; faster HTTP and `JSON.stringify` here ✅[^lab] | Node-compatibility gaps (see `bun/node-compat/nodejs-compatibility.md`); no gain for large-buffer file writes here |
| Keep Node, use only `bun install` | 2.6× cold and 14× warm installs here ✅[^lab]; `node_modules` works for Node ✅[^9], and Node 24 loaded zod 3.24.1 from a Bun-installed folder ✅[^lab] | A second tool in CI; lockfile migration |
| Rewrite `node:http` handlers to `Bun.serve` | 1.9× over `node:http` on Bun here, 1.6–1.7× in the lower-load re-run ✅[^lab] | Code that only runs on Bun |

## Takeaways
- Expect the biggest gains where a process starts often (command-line tools, tests, serverless) or installs often (CI, continuous integration); measure before expecting gains in long-running CPU or file-heavy jobs. [rule-candidate]
- Benchmark both runtimes on the same machine, interleave the runs, report the median and the range of at least 5 rounds, and state the host load. [rule-candidate]
- Check that your load generator is faster than the server ✅[^10]: give the client more threads and more CPUs, and confirm the number does not move; more threads on the same CPUs proves nothing.
- For maximum HTTP throughput on Bun, use `Bun.serve`; `node:http` under Bun was faster than on Node here but 1.6–1.9× below the native API.
- Read absolute numbers from a shared host as numbers for that load: the same HTTP benchmark gave 1.6–2.0× more requests/s when the host was quieter.
- Compare against Node on the C library you deploy: the Alpine (musl) image cost Node up to a quarter of its start-up and file I/O time here.

## Verification status
- Verified: 115 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; Node ran in `node:24.22.1-alpine` with npm 11.19.1 on the same OrbStack VM (8 CPUs, kernel 7.2.12, Docker 29.8.2), 7 interleaved rounds between 15:52 and 15:59 local time; the HTTP re-run, the client check and the raw-response checks ran between 16:35 and 16:39 at lower load. A third session (22:46–22:52, load average 5.2–8.5) ran the saved client check, the rendering handler and `bun run` against `npm run`, with a rewrite of the same client (raw TCP, keep-alive, one request in flight per socket, sockets split over worker threads); the system-call traces used strace 6.13 in `bunlab:2`, `readelf` ran in `bunlab:1`, and `bun install` fetched from the public npm registry. A fourth session (23:58 on 2026-11-24 to 00:15 on 2026-11-25) ran the glibc-against-musl rounds with `node:24.22.1-bookworm-slim` (glibc 2.36); the database rounds with `pg` 8.23.1 installed by npm into the Node container and a `postgres:latest` (18.3) server on its own Docker network; and the 1.3.14 comparison in `oven/bun:1.3.14` (`1.3.14+0d9b296af`), whose strace counts used the `bun` binaries copied from both images into `bunlab:2`. Idle CPU time is the sum of the first field of `/proc/<pid>/task/*/schedstat`, context switches the sum of each thread's voluntary and involuntary counts, peak memory `VmHWM` read by the child just before it exits. [^lab]
- [Bun Runtime](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/index.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: JavaScriptCore start, Rust transpiler and runtime, in-process transpiling, `bun run` vs `npm run` start, the 4× claim. [^1]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: the Zig-to-Rust rewrite, mimalloc, fewer GC timers and `futex` calls, idle CPU of a small "hello world" app 5× lower, `hello.js` on Linux 5.1 ms and 14.6 MB against 10.9 ms and 33.0 MB for Bun 1.3. [^2]
- [Welcome to Bun](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/index.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: one dependency-free binary with runtime, package manager, test runner and bundler. [^3]
- [bun install](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/install.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: "up to 25x faster", binary manifest cache. [^4]
- [JavaScriptCore](https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html) — WebKit docs, living. Backs: LLInt start-up cost. [^5]
- [File I/O](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/file-io.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: `copy_file_range`, `sendfile`, `splice`, `clonefile`, `fcopyfile` per source and destination, plain `write` for a Blob or string. [^6]
- [Global cache](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/global-cache.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: hardlinks on Linux, `clonefile` on macOS. [^7]
- [Environment variables: runtime transpiler caching](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/environment-variables.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: 4 KB threshold, Docker images disable the cache. [^8]
- [Migrate from npm install to bun install](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/install/from-npm-install-to-bun-install.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: Node-compatible `node_modules` without Bun's runtime. [^9]
- [Benchmarking](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/project/benchmarking.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: a load tool must be at least as fast as `Bun.serve`. [^10]

## Related
- `performance/measurement/benchmarking-methodology.md` — medians, warm-up, noise and fair comparisons
- `bun/internals/javascriptcore-engine.md` — JIT tiers, GC and `--smol`
- `bun/http-and-networking/bun-serve.md` — the `Bun.serve` API
- `bun/package-manager/install-mechanics-and-lockfile.md` — why warm installs are fast
- `bun/system-apis/file-io.md` — `Bun.write` and `Bun.file`
- `bun/node-compat/nodejs-compatibility.md` — what changes when the same code runs on Bun
- `bun/bundler/single-file-executables.md` — `--bytecode` start-up measured on compiled executables
- `bun/fundamentals/what-bun-is.md` — the Zig-to-Rust rewrite
- `js-runtime/node-type-stripping.md` — what Node 24 does to run `hello.ts`
