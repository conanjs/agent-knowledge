---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24 (docs v24.22.3; net, http and stream cork pages v26.13.1)", "lab on Node.js 24.22.1 (V8 13.6.233.17, libuv 1.52.1, linux arm64), 2026-11-26", "re-run 2026-11-27 on Node.js 22.23.4, 24.22.1 (macOS arm64, linux x64 emulated), 25.7.0, Electron 43.7.7 (Node.js 24.21.0 API) and Node.js 24.22.3 with pointer compression", "RFC 896, RFC 1122"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, nodejs, buffer, streams, backpressure, sockets, fs]
ranked-sources: true
---

# JavaScript best practices: Node.js streams, buffers and input/output

## Summary
**TL;DR:** A Node.js `Buffer` is only as small as the memory it points into, a stream only protects memory when the writer waits for it, and some I/O APIs do far more calls than the job needs. The practices here copy kept slices out, keep many small long-lived values as strings, join chunks once, respect `write()` returning `false`, and use the cheaper `fs` and socket forms. The headline results: a 16-byte `subarray` of a 10 MiB buffer kept all 10,485,760 bytes reachable ✅[^lab], and a 14-character `Buffer.from(string)` sat in a 65,536-byte pool block on Node.js 24.22.1 but an 8,192-byte one on 22.23.4 and 25.7.0 ✅[^lab-matrix].
**Use this when:** writing or reviewing Node.js code that keeps, joins or writes `Buffer`s, writes to streams or raw sockets, lists folders, watches files, or logs inside loops; or a process holds far more memory than the data it keeps.
**Not this doc:** the event loop and its thread pool → [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md); posting buffers to workers → [nodejs-worker-threads.md](nodejs-worker-threads.md) (`JN-W3`, `JN-W4`); memory counters such as `external` and `arrayBuffers` → [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md); the measured classes → [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md).

## Scope
Nine practices for `Buffer` views and the buffer pool, joining chunks, backpressure, `highWaterMark`, raw TCP (Transmission Control Protocol) sockets, `readdir`, file watching and logging in loops. Byte counts come from the lab on Node.js 24.22.1 (V8 13.6.233.17, libuv 1.52.1, linux arm64) on 2026-11-26, re-run on six more builds on 2026-11-27; the other practices rest on the Node.js docs and RFCs (requests for comments, the Internet standards), as each note says. All claims are about Node.js. Not run: Windows, and any timing of these practices.

How to read the "Applies" column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it).

Terms:
- **Backing `ArrayBuffer`:** the block of memory a `Buffer` really points into (`buf.buffer`), like the warehouse behind a shop counter.
- **View:** a `Buffer` that points into another buffer's memory without a copy, like a window onto a shared wall: `big.subarray(0, 16)`.
- **Buffer pool:** a pre-allocated block that small `Buffer`s are cut from, like sticky notes cut from one sheet: keeping one note keeps the whole sheet.
- **Backpressure:** a stream telling the writer to wait because its buffer is full, like a full sink telling you to turn the tap down.
- **Nagle's algorithm:** TCP holding small new data while earlier data is unacknowledged, like a courier who waits to fill the van.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JN-S1` | `buf.subarray()`/`slice()` of a large buffer stored in a long-lived cache, map or session | Copy it out: `Buffer.allocUnsafeSlow(len)` + `view.copy(own)` (not `Buffer.from(view)`), or keep a string | large data | 16-byte view of 10 MiB: backing 10,485,760 bytes; `Buffer.from(view)`: 65,536; own copy: 16 (Node.js 24.22.1) ✅[^lab] |
| `JN-S2` | Thousands of small `Buffer.from(str)`/`allocUnsafe(n)` values kept for the process lifetime | Keep strings, or copy into `allocUnsafeSlow` memory | check build | A pooled one pins a block: 65,536 bytes on 24.22.1 ✅[^lab], 8,192 on 22.23.4 and 25.7.0 ✅[^lab-matrix] |
| `JN-S3` | `acc = Buffer.concat([acc, chunk])` or `body += chunk` per `'data'` event | Push chunks to an array and `Buffer.concat(chunks)` once; for text, `setEncoding('utf8')` first | large data | `Buffer.concat` returns a new `Buffer` ✅[^node-buffer], so a 1 MiB body in 64 KiB chunks copies 8.5 MiB (arithmetic) |
| `JN-S4` | A loop of `stream.write()`/`res.write()` ignoring the return value | Use `stream/promises` `pipeline`, or `await once(out, 'drain')` when `write()` returns `false` | always | Do not `write()` after `false`; wait for `'drain'` (Node.js guide) ✅[^node-bp] |
| `JN-S5` | A tiny `highWaterMark` (16, 1024) on a byte stream | Leave the default; it is a threshold, not a memory limit | always | Default 64 KiB (16 KiB on Windows) since v22.0.0 ✅[^node-stream]; read as 65,536 on 24.22.1 ✅[^spot] |
| `JN-S6` | Raw `net.Socket` writing header and body separately, then waiting for a reply | Write the whole message once (or `cork`/`uncork`) and `setNoDelay(true)` | hot path | A new Node.js TCP connection starts with Nagle on ✅[^node-net]; delayed acknowledgements may wait up to 0.5 s ✅[^rfc1122] |
| `JN-S7` | `readdir` then `stat` per entry only to tell files from folders | `readdir(dir, { withFileTypes: true })` and `entry.isFile()` | always | The result holds `fs.Dirent` objects ✅[^node-fs], so n + 1 calls become 1 |
| `JN-S8` | `fs.watchFile(path, …)` | Use `fs.watch(path, …)` | always | `watchFile` polls with a default interval of 5007 ms; `fs.watch` is more efficient ✅[^node-fs] |
| `JN-S9` | `console.log`/`logger.debug` with a built string inside a per-item loop | Log one summary line; build debug arguments only when the level is on | hot path | Synchronous writes to standard output can block the event loop ✅[^node-process-io] |

## Lookup notes
### `JN-S1` Copy a small slice that is kept into its own memory
**Prefer:**
```js
const view = body.subarray(0, 16);
const own = Buffer.allocUnsafeSlow(view.length); // not from the pool
view.copy(own);
sessions.set(id, own);            // or keep view.toString('hex') instead of bytes
```
**Avoid:**
```js
sessions.set(id, body.subarray(0, 16));  // keeps all of body alive
sessions.set(id, Buffer.from(view));     // copy lands in a shared pool block
```
**Why:** `subarray` returns a `Buffer` that references the same memory as the original ✅[^node-buffer], so the whole parent stays reachable. `Buffer.from(view)` copies, but the lab shows the copy inside a pool block ✅[^lab] (the Buffer docs list `allocUnsafe`, `from(array)`, `from(string)` and `concat` as pool users, and do not list `from(buffer)`), so it keeps a pool block alive instead. The size that matters is a parent of megabytes; the lab kept 16 bytes of 10 MiB.
**Evidence:** Lab run 4, Node.js 24.22.1, byte counts: a 16-byte `subarray` of a 10 MiB buffer had a backing `ArrayBuffer` of 10,485,760 bytes; `Buffer.from(view)` had 65,536; `Buffer.allocUnsafeSlow(16)` plus `copy` had 16 ✅[^lab]. The view and the own copy gave the same counts on every build of the matrix; the `Buffer.from(view)` block was 8,192 bytes on Node.js 22.23.4 and 25.7.0 ✅[^lab-matrix].
**Exceptions:** The view lives only for one request; the parent is kept anyway.
**Check it:** For stored entries compare `entry.buffer.byteLength` with `entry.length`; a heap snapshot shows the retained `ArrayBuffer`.
**Full lab:** [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, lab run 4.

### `JN-S2` Keep many long-lived small values as strings, not pooled `Buffer`s
**Prefer:**
```js
cache.set(key, token);                                 // a string
cache.set(key, ownCopy(Buffer.from(token)));           // or bytes in their own memory
function ownCopy(b) { const o = Buffer.allocUnsafeSlow(b.length); b.copy(o); return o; }
```
**Avoid:**
```js
cache.set(key, Buffer.from(token)); // 14 bytes that pin a 64 KiB pool block
```
**Why:** `allocUnsafe` takes sizes below half of `Buffer.poolSize` from the pool, and `Buffer.from(string)`, `from(array)` and `concat` may do the same ✅[^node-buffer]. A kept small `Buffer` keeps its whole block alive.
**Evidence:** Lab run 4, Node.js 24.22.1: `Buffer.poolSize` 65,536, and a 14-character `Buffer.from(string)` had a 65,536-byte backing `ArrayBuffer` ✅[^lab]. Same 65,536 on Node.js 24.22.3 and on 24.21.0 (Electron 43.7.7). Differs on Node.js 22.23.4 and 25.7.0: 8,192 bytes, so a newer major version does not imply the larger pool ✅[^lab-matrix]. The docs list the raise from 8,192 in v24.18.0 and suggest `Buffer.allocUnsafeSlow()` plus a copy for memory kept "for an indeterminate amount of time" ✅[^node-buffer].
**Exceptions:** The kept values are few, so one pool block is an acceptable cost.
**Check it:** `node -p "Buffer.poolSize"` on the version in use; `buf.buffer.byteLength` of a stored value.
**Full lab:** [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, lab run 4 and "What differs".

### `JN-S3` Collect chunks in an array and join them once
**Prefer:**
```js
const chunks = [];
for await (const chunk of req) chunks.push(chunk);
const body = Buffer.concat(chunks);                 // one copy
// text: req.setEncoding('utf8') first, then join the strings
```
**Avoid:**
```js
let acc = Buffer.alloc(0);
req.on('data', (chunk) => { acc = Buffer.concat([acc, chunk]); }); // copies acc every time
req.on('data', (chunk) => { text += chunk; });                     // can split a UTF-8 character
```
**Why:** `Buffer.concat` returns a new `Buffer` ✅[^node-buffer], so joining per chunk copies everything received so far each time: c·n(n+1)/2 bytes for n chunks of c bytes, against c·n once. String `+=` on `Buffer` chunks can split multi-byte characters; `readable.setEncoding` decodes them properly ✅[^node-stream]. The size that matters is a body of many chunks: 1 MiB in 64 KiB chunks already copies 8.5 times the body.
**Evidence:** Arithmetic from the documented behaviour: a 1 MiB body in 64 KiB chunks (n = 16) copies 136 × 64 KiB = 8.5 MiB against 1 MiB. No lab timing.
**Exceptions:** A handful of chunks, or a body streamed onward without joining.
**Check it:** Count bytes copied per request, or watch `external` in `process.memoryUsage()` during a large upload.
**Full lab:** none; the shape is listed under `allocation-gc` in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, "Belongs to an existing class".

### `JN-S4` Stop writing when `write()` returns `false`; use `pipeline`
**Prefer:**
```js
import { pipeline } from 'node:stream/promises';
await pipeline(source, transform, res);           // handles backpressure and errors
// by hand: if (!out.write(chunk)) await once(out, 'drain');
```
**Avoid:**
```js
for (const row of rows) res.write(JSON.stringify(row) + '\n'); // buffers everything in memory
```
**Why:** `false` means the stream's buffer is full; writes after it pile up in memory until the consumer catches up.
**Evidence:** The Node.js guide "Backpressuring in Streams" says not to `write()` after `false` and to wait for `'drain'` ✅[^node-bp]. A documented statement; no lab number.
**Exceptions:** A known small, fixed number of writes.
**Check it:** `out.writableLength` stays below `out.writableHighWaterMark` under load.
**Full lab:** none; the class is `concurrency-backpressure` in [problem-classes.md](../../performance/code-review/problem-classes.md).

### `JN-S5` Leave `highWaterMark` at its default unless a measurement says otherwise
**Prefer:**
```js
const rs = fs.createReadStream(path); // 64 KiB per read on non-Windows platforms
```
**Avoid:**
```js
const rs = fs.createReadStream(path, { highWaterMark: 16 }); // 4,096 reads per 64 KiB
```
**Why:** `highWaterMark` sets how much a stream buffers before it signals backpressure, so a tiny value means many small reads and callbacks. It is a threshold, not a memory limit ✅[^node-stream].
**Evidence:** Node.js 24 stream docs: since v22.0.0 the byte-stream default is 64 KiB on non-Windows platforms and 16 KiB on Windows, and 16 objects in object mode ✅[^node-stream]. Re-run for this doc on Node.js 24.22.1 (linux arm64): `readableHighWaterMark` was 65,536 for `fs.createReadStream` and for a plain `Readable`, and 16 in object mode ✅[^spot]. Windows was not run; no lab timing.
<details><summary>Spot check: default <code>highWaterMark</code> values</summary>

`docker run --rm --network none node:24.22.1-alpine node -e '<script>'`:
```js
const fs = require("fs"); const { Readable } = require("stream");
console.log("fs.createReadStream:", fs.createReadStream(process.execPath).readableHighWaterMark,
 "| new Readable():", new Readable({ read() {} }).readableHighWaterMark,
 "| objectMode:", new Readable({ objectMode: true, read() {} }).readableHighWaterMark);
```
```text
fs.createReadStream: 65536 | new Readable(): 65536 | objectMode: 16
```
</details>

**Exceptions:** Object-mode streams, where the unit is objects, not bytes.
**Check it:** `readable.readableHighWaterMark` on the stream in use.
**Full lab:** none beyond the spot check above; the shape is listed under `unbuffered-io` in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, "Belongs to an existing class".

### `JN-S6` Send one write per message on a raw socket, and turn Nagle off for request and response
**Prefer:**
```js
socket.setNoDelay(true);
socket.write(Buffer.concat([header, body]));          // or cork(); write; write; uncork()
```
**Avoid:**
```js
socket.write(header);
socket.write(body); // may wait for the peer's delayed acknowledgement
```
**Why:** Nagle's algorithm holds new data while earlier data is unacknowledged ✅[^rfc896], and the receiver may delay its acknowledgement ✅[^rfc1122], so a write-write-read exchange can stall. A new TCP connection in Node.js starts with Nagle on ✅[^node-net]. This matters for raw `net.Socket` protocols that write, write, then wait for a reply.
**Evidence:** RFC 896 (Nagle) ✅[^rfc896] and RFC 1122 (delayed acknowledgements, under 0.5 seconds) ✅[^rfc1122]; the Node.js `net` docs (v26.13.1 page) ✅[^node-net] and stream docs (`cork()` for several small chunks written in rapid succession) ✅[^node-stream-cork]. Documented statements; no lab number.
**Exceptions:** An `http.createServer` server: `noDelay` is `true` by default since v18.0.0 ✅[^node-http]. Bulk streaming, where Nagle trades latency for fewer packets on purpose ✅[^node-net].
**Check it:** `tcpdump`: segments per message and the gap between the first and second; p50 latency of a small request and response before and after.
**Full lab:** none; the class is `small-socket-writes` in [problem-classes-network-and-delivery.md](../../performance/code-review/problem-classes-network-and-delivery.md).

### `JN-S7` List a folder with `withFileTypes: true` instead of `stat` per entry
**Prefer:**
```js
const entries = await fs.promises.readdir(dir, { withFileTypes: true });
const files = entries.filter((e) => e.isFile()).map((e) => e.name);
```
**Avoid:**
```js
const names = await fs.promises.readdir(dir);
const files = (await Promise.all(names.map((n) => fs.promises.stat(path.join(dir, n)))))
  .filter((s) => s.isFile());
```
**Why:** The result already holds `fs.Dirent` objects with the type ✅[^node-fs], so n + 1 calls become 1, and n fewer tasks go to the thread pool (`JN-E1` in [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md)).
**Evidence:** Node.js 24 `fs` docs (v24.22.3) ✅[^node-fs]. A call count from the documented behaviour; no lab timing.
**Exceptions:** The size or times are needed, which only `stat` returns.
**Check it:** Count `stat` calls per listing.
**Full lab:** none; the shape is listed under `io-batching-n-plus-one` in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes.

### `JN-S8` Watch files with `fs.watch`, not `fs.watchFile`
**Prefer:**
```js
const watcher = fs.watch(configPath, () => reload());
```
**Avoid:**
```js
fs.watchFile(configPath, () => reload()); // polls with stat
```
**Why:** `watchFile` polls the file, with a default interval of 5007 ms ✅[^node-fs]; `fs.watch` uses the operating system's change events.
**Evidence:** Node.js 24 `fs` docs (v24.22.3): `fs.watch()` is more efficient than `watchFile` ✅[^node-fs]. A documented statement.
**Exceptions:** None found in the sources.
**Check it:** Count `stat` calls over time with and without the watcher.
**Full lab:** none; the shape is listed under `polling-event-rate` in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes.

### `JN-S9` Log a summary, not one line per item, in hot code
**Prefer:**
```js
let failed = 0;
for (const item of items) if (!process(item)) failed++;
logger.info({ items: items.length, failed });            // one structured line
if (debugEnabled) logger.debug({ sample: items.slice(0, 5) }); // build only when on
```
**Avoid:**
```js
for (const item of items) console.log(`processed ${JSON.stringify(item)}`);
```
**Why:** Building the message costs work even when nobody reads it, and synchronous writes to standard output can block the event loop ✅[^node-process-io]. This matters for a log call inside a per-request or per-element loop.
**Evidence:** The Node.js `process` docs ("A note on process I/O") ✅[^node-process-io]. A documented statement; no lab number.
**Exceptions:** Rare events (errors, start-up), and command-line tools whose output is the product.
**Check it:** A CPU profile of the hot path; log volume per request.
**Full lab:** none; the class is `logging-overhead` in [problem-classes.md](../../performance/code-review/problem-classes.md).

## Takeaways
- A kept `Buffer` costs its backing `ArrayBuffer`, not its length: compare `buf.buffer.byteLength` with `buf.length` for anything stored long-term. [rule-candidate]
- The buffer pool size changed between releases (65,536 bytes on 24.22.1, 8,192 on 22.23.4 and 25.7.0): read `Buffer.poolSize` on the version in use.
- Joining a body chunk by chunk copies it about n/2 times; collect and join once.
- `write()` returning `false` is a request to wait, and `pipeline` handles it.
- Raw sockets need one write per message and `setNoDelay(true)`; Node.js HTTP servers already set it.

## Verification status
- Verified: 43 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- Lab runs on Node.js 24.22.1 (image `node:24.22.1-alpine`, V8 13.6.233.17, libuv 1.52.1, linux arm64, 8 CPUs, Apple M2 under Docker, `--network none`), 2026-11-26, each run 3 times; script `buffers.mjs` and its output in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes, lab run 4. Rank 1 (primary measurement). Backs: Summary; Catalog, JN-S1 and JN-S2; Lookup notes. [^lab]
- Lab matrix: the same script re-run on 2026-11-27 on Node.js 24.22.1 (macOS 26.1 arm64, linux x64 emulated), 22.23.4, 25.7.0, Electron 43.7.7 run as Node (Node.js 24.21.0 API) and Node.js 24.22.3 with pointer compression (linux x64 emulated); differing output in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), "Other builds and versions (2026-11-27)". Rank 1 (primary measurement). Backs: Summary; Catalog, JN-S2; Lookup notes. [^lab-matrix]
- Spot check for this doc: the `highWaterMark` script in the `JN-S5` note, run on 2026-11-28 with `docker run --rm --network none node:24.22.1-alpine` (Node.js 24.22.1, linux arm64); command and output in that note. Rank 1 (primary measurement). Backs: Catalog and Lookup notes, JN-S5. [^spot]
- [Buffer](https://nodejs.org/docs/latest-v24.x/api/buffer.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Catalog, JN-S3; Lookup notes, JN-S1 to JN-S3. [^node-buffer]
- [Stream](https://nodejs.org/docs/latest-v24.x/api/stream.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Catalog, JN-S5; Lookup notes, JN-S3 and JN-S5. [^node-stream]
- [File system](https://nodejs.org/docs/latest-v24.x/api/fs.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Catalog and Lookup notes, JN-S7 and JN-S8. [^node-fs]
- [Backpressuring in Streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams) — Node.js project, living. Rank 1. Backs: Catalog and Lookup notes, JN-S4. [^node-bp]
- [Net](https://nodejs.org/api/net.html) — Node.js project, v26.13.1 docs. Rank 1. Backs: Catalog and Lookup notes, JN-S6. [^node-net]
- [HTTP](https://nodejs.org/api/http.html) — Node.js project, v26.13.1 docs. Rank 1. Backs: Lookup notes, JN-S6. [^node-http]
- [Stream, writable.cork()](https://nodejs.org/api/stream.html#writablecork) — Node.js project, v26.13.1 docs. Rank 1. Backs: Lookup notes, JN-S6. [^node-stream-cork]
- [process: A note on process I/O](https://nodejs.org/api/process.html#a-note-on-process-io) — Node.js project, living. Rank 1. Backs: Catalog and Lookup notes, JN-S9. [^node-process-io]
- [RFC 896: Congestion Control in IP/TCP Internetworks](https://www.rfc-editor.org/rfc/rfc896.html) — J. Nagle, IETF, 1984. Rank 1. Backs: Lookup notes, JN-S6. [^rfc896]
- [RFC 1122: Requirements for Internet Hosts](https://www.rfc-editor.org/rfc/rfc1122.html) — IETF, 1989. Rank 1. Backs: Catalog and Lookup notes, JN-S6. [^rfc1122]

## Related
- [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md) — the review catalog with the buffer lab scripts.
- [problem-classes-network-and-delivery.md](../../performance/code-review/problem-classes-network-and-delivery.md) — `small-socket-writes`.
- [problem-classes.md](../../performance/code-review/problem-classes.md) — `concurrency-backpressure` and `logging-overhead`.
- [nodejs-worker-threads.md](nodejs-worker-threads.md) — pooled buffers posted to workers.
- [../node/data-wrangling-deep-dive.md](../node/data-wrangling-deep-dive.md) — streams, backpressure and `pipeline`.
