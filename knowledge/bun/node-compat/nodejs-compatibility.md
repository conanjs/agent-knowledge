---
schema: knowledge-doc/v1
type: reference
topic: bun/node-compat
status: verified
applies-to: ["Bun 1.4.5", "Node.js 24.22.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, nodejs, compatibility, node-modules, globals, worker-threads, crypto, async-hooks, inspector, v8, migration]
---

# Bun's Node.js compatibility: module status and measured differences

## Summary
**TL;DR:** Bun 1.4.5 presents itself as Node.js v26.3.0 ✅[^lab] and its compatibility page tracks Node.js v26 ✅[^1]. In the docs shipped with 1.4.5, most `node:*` modules are marked fully implemented, 17 are partial, and only `node:sea` is missing ✅[^1]. A probe run in both runtimes found most everyday behaviour identical (HTTP server plus `fetch`, `vm`, `fs.watch`, `fork` with inter-process messages (IPC), `AsyncLocalStorage`, `node:sqlite`), and found most differences where the page lists gaps: Worker `resourceLimits`, BoringSSL ciphers and curves, `module.register` hooks, `inspector` sessions, async ids, `v8.serialize` bytes, and `process.binding` ✅[^lab] ✅[^1].
**Use this when:** checking whether a Node API works in Bun before a migration, or explaining why a package that works on Node fails on Bun.
**Not this doc:** the migration steps → [migrating-from-node.md](migrating-from-node.md); event-loop ordering differences → [event-loop-and-scheduling.md](../internals/event-loop-and-scheduling.md); stack-trace format and tail calls → [javascriptcore-engine.md](../internals/javascriptcore-engine.md).

## Scope
Two catalogs. The status tables condense Bun's compatibility page as it stands at the release tag `bun-v1.4.5` (`docs/runtime/nodejs-compat.mdx`; Bun 1.4.5 was published 2026-11-19 ✅[^5]). The live page on bun.com already describes a newer Bun; where it differs, Lookup notes say so with lab evidence ✅[^6]. The measured table comes from one probe script, `compat.mjs`, plus five small companion files for rows it does not cover (`ari.mjs`: active resources and `WebSocket`; `rl.mjs`: Worker `resourceLimits`; `dc.mjs`: `diagnostics_channel`; `dh.mjs`: `dh` keys; `nt.test.mjs`: `node:test`), each run unchanged with `bun <file>` in `oven/bun:1.4.5` (Debian 13, glibc, arm64) and `node <file>` in `node:24.22.1-alpine` (musl, arm64) on the same host ✅[^lab]. All were run twice; where a number changed between runs (heap limit, timings), the row gives both. The "Lab check" column of the two status tables comes from a second set of probes aimed at each gap the page lists (`probe2.mjs` to `probe6.mjs`, `tlsprobe.mjs` with a throwaway certificate made by `openssl` in `bunlab:1`, `cluster.mjs`, and IPC and REPL checks), run the same way, twice ✅[^lab]. Rows that need Bun and Node in one process tree (IPC between the two runtimes, the REPL comparison) ran inside `oven/bun:1.4.5`, with the Node 24.22.1 binary and its musl libraries copied out of the Node image and started through the musl loader ✅[^lab]. The heap rows also ran under `docker run --memory=<limit>`.

A compatibility layer is like a travel plug adapter: the device (an npm package written for Node) plugs in unchanged, but a few pins are not wired. Example of an unwired pin: `process.binding('tcp_wrap')` returns an object in Node 24 and throws `process.binding("tcp_wrap") is not implemented in Bun` in Bun 1.4.5 ✅[^lab].

Legend: 🟢 fully implemented · 🟡 partially implemented · 🔴 not implemented (the page's own marks).

## Catalog

### Built-in modules (per the docs page)

| Module | Status | Gaps and differences the page lists | Lab check (Bun 1.4.5 vs Node 24.22.1) |
|---|---|---|---|
| `node:assert` | 🟢 | Legacy `deepEqual` uses `Bun.deepEquals` semantics; function or `printf`-style `message` not formatted ✅[^1] | `assert.deepEqual(1, '1')` threw `ERR_ASSERTION` (Node: passed); a `printf`-style and a function `message` were printed raw in Node 24 too ✅[^lab] |
| `node:buffer` | 🟢 | One `Buffer` is capped at 4 GiB (`constants.MAX_LENGTH` = `2**32`) ✅[^1] | `MAX_LENGTH` `4294967296` (measured table) ✅[^lab] |
| `node:console` | 🟢 | Writes straight to the stdout/stderr descriptors, so replacing `process.stdout.write` does not capture it; layout differs from `util.inspect` ✅[^1] | With `process.stdout.write` replaced, `console.log` still reached the terminal and was not captured (Node: captured) ✅[^lab] |
| `node:dgram` | 🟢 | `addMembership()` does not bind an unbound socket ✅[^1] | `addMembership()` on an unbound socket threw `ERR_SOCKET_DGRAM_NOT_RUNNING` (Node: bound the socket) ✅[^lab] |
| `node:dns` | 🟢 | No `resolveTlsa`; `Resolver` ignores `maxTimeout` ✅[^1] | `resolveTlsa` `undefined`; with `timeout: 200, tries: 3`, a query to a silent server failed after about 3 s with or without `maxTimeout: 200` (Node: 1.5–2.0 s, and 0.8 s with it) ✅[^lab] |
| `node:events` | 🟢 | `EventEmitterAsyncResource` `asyncId` is always `0` ✅[^1] | `asyncId` `0` (Node: `6`) ✅[^lab] |
| `node:fs` | 🟢 | `Stats` lacks the `Temporal.Instant` getters ✅[^1] | `'atimeInstant' in stats` `false`, as in Node 24, which has no such getter either ✅[^lab] |
| `node:http` | 🟢 | `http.Server` does not extend `net.Server`; `listen(handle)` and the `fd`, `ipv6Only`, `signal` options are ignored ✅[^1] | `ipv6Only: true` on `::` still accepted an IPv4 connection (Node: refused); **`signal` was not ignored**: after `abort()` new connections were refused, as in Node (Lookup notes) ✅[^lab] |
| `node:http2` | 🟢 | Three tuning options accepted but ignored ✅[^1] | A server with the three options was created without an error; whether they take effect was not observable without an HTTP/2 client that inspects the frames ✅[^lab] |
| `node:net` | 🟢 | `new net.Socket({ fd })` cannot read an existing descriptor; no `blockList.toJSON()` ✅[^1] | `toJSON` `undefined`; `new net.Socket({ fd })` on a FIFO read nothing (Node: read the line) ✅[^lab] |
| `node:os` | 🟢 | `userInfo()` reads `USER`/`SHELL`/`HOME`; `machine()` says `arm64` on Linux arm64 ✅[^1] | With `USER=labuser`, `userInfo().username` was `labuser` (Node: `root`, from the passwd file); `machine()` in the measured table ✅[^lab] |
| `node:path` | 🟢 | `matchesGlob()` uses `Bun.Glob` rules ✅[^1] | `matchesGlob('/x/.hidden', '/x/*')` `true` (Node: `false`); **extglobs matched as in Node** (`+(a\|b).js`, `!(b).js`, `@(a\|b).js`; Lookup notes) ✅[^lab] |
| `node:punycode`, `node:querystring`, `node:readline`, `node:url`, `node:zlib` | 🟢 | None listed ✅[^1] | — |
| `node:stream` | 🟢 | `isReadable`/`isWritable`/`isErrored` understand only Node streams ✅[^1] | `isWritable(new WritableStream())` `null` (Node: `true`); **`isReadable`, `isErrored` and `Readable.isDisturbed` gave Node's answers for web streams** (Lookup notes) ✅[^lab] |
| `node:string_decoder` | 🟢 | `end()` takes no string ✅[^1] | `end('abc')` threw `Expected Uint8Array` (Node: returned `abc`) ✅[^lab] |
| `node:timers` | 🟢 | Exports are the global functions; `timers/promises` included ✅[^1] | `timers.setTimeout === globalThis.setTimeout` `true`, as in Node ✅[^lab] |
| `node:tty` | 🟢 | Streams extend `fs` streams, not `net.Socket` ✅[^1] | Under `docker run -t`, `process.stdout` was an `fs.WriteStream`, not a `net.Socket` (Node: the reverse); `new tty.WriteStream(fd)` on a regular file returned `isTTY: false` (Node: `ERR_TTY_INIT_FAILED`) ✅[^lab] |
| `node:util` (and `node:sys`) | 🟢 | No `diff`, `transferableAbortSignal`/`Controller`; `debuglog()` ignores its callback ✅[^1] | `diff`, `transferableAbortSignal` `undefined` (Node 24: functions); `debuglog().enabled` `undefined` (Node: `false`) ✅[^lab] |
| `node:vm` | 🟢 | Includes `vm.Module` classes without a flag; `measureMemory()` reports the whole heap ✅[^1] | `vm.SourceTextModule` is a function without a flag (Node: `undefined`) ✅[^lab] |
| `node:sqlite` | 🟢 | `backup()` blocks the event loop; database path must be valid UTF-8 ✅[^1] | `backup()` of a 41 MB database let a 1 ms interval tick 0 times (Node: 393 and 785 ticks); a non-UTF-8 `Buffer` path threw `ERR_INVALID_ARG_VALUE` (Node: opened) ✅[^lab] |
| `node:trace_events` | 🟢 | Some categories record less; the `v8` category is a placeholder ✅[^1] | With `--trace-event-categories v8,node.async_hooks`, Bun wrote 1 `v8` event and only `Timeout` async events (Node: 15 `v8` events plus ticks and pipes) ✅[^lab] |
| `node:quic` | 🟢 | Experimental in Node; importing it warns in Bun too ✅[^1] | `import('node:quic')` loaded and printed an `ExperimentalWarning`; Node 24 has no `node:quic` (`ERR_UNKNOWN_BUILTIN_MODULE`) ✅[^lab] |
| `node:diagnostics_channel` | 🟡 | `channel()`, `subscribe()`, `tracingChannel()` and the `http` client, `http2` and `dgram` channels work; no `boundedChannel()`, no `http.server.*`, `net`, `module`, `console`, `child_process` or `worker_threads` channels; subscribers do not keep a `Channel` alive ✅[^1] | Channels in the measured table; a subscriber added with `channel('x').subscribe()` was gone after the channel object was dropped and `Bun.gc(true)` ran (Node with `--expose-gc`: kept) ✅[^lab] |
| `node:https` | 🟡 | Server request sockets are not `tls.TLSSocket` (no `getPeerCertificate()`); no `SNICallback`, `setSecureContext()` ✅[^1] | `req.socket` not a `tls.TLSSocket`, `getPeerCertificate`/`getCipher` `undefined`, `SNICallback` never called, `setSecureContext`/`addContext` `undefined` (Node: all present) ✅[^lab] |
| `node:async_hooks` | 🟡 | `AsyncLocalStorage`, `AsyncResource` work; `createHook` and async ids are stubs (ids are `0`) ✅[^1] | A `createHook` `init` ran only for `TickObject` (Node: `TickObject`, `Timeout`, `PROMISE`); ids in the measured table ✅[^lab] |
| `node:child_process` | 🟡 | `serialization: "advanced"` only between Bun processes; no `channel.ref()`/`unref()` ✅[^1] | `channel.ref`/`unref` `undefined`; `serialization: "advanced"` carried a `Map` between Bun processes, but Bun to Node and Node to Bun got no reply in 3 s; JSON IPC and passing a `net.Server` worked both ways ✅[^lab] |
| `node:cluster` | 🟡 | HTTP load balancing across workers only on Linux (`SO_REUSEPORT`) ✅[^1] | Two workers on one port answered 60 fresh connections 29/31 and 22/38 (Node: 30/30) ✅[^lab] |
| `node:crypto` | 🟡 | BoringSSL: no `ed448`, `x448`, `rsa-pss`, `dsa`, `secp256k1`; no CCM, OCB, XTS, `chacha20-poly1305`; no `encapsulate` ✅[^1] | `ed448`, `x448`, `dsa` and `rsa-pss` key pairs threw `ERR_OSSL_EVP_UNSUPPORTED_ALGORITHM`, `aes-128-ccm`/`-ocb`/`-xts` threw `ERR_CRYPTO_UNKNOWN_CIPHER`, `encapsulate` `undefined` (Node 24: all available) ✅[^lab] |
| `node:domain` | 🟡 | Catches only synchronous errors inside `run()`/`bind()` ✅[^1] | An error thrown in a `setTimeout` inside `run()` went to `uncaughtException` (Node: the domain's `error` handler) ✅[^lab] |
| `node:module` | 🟡 | No `registerHooks`, `findPackageJSON`, `stripTypeScriptTypes`; `module.register` is a no-op (use `Bun.plugin`) ✅[^1] | `findPackageJSON`, `stripTypeScriptTypes` `undefined` (Node: functions); `register` in the measured table ✅[^lab] |
| `node:perf_hooks` | 🟡 | No `gc`/`dns`/`resource` entries; `eventLoopUtilization()` returns zeros ✅[^1] | `PerformanceObserver.supportedEntryTypes` lacks `gc` (Node lists it); `eventLoopUtilization()` in the measured table ✅[^lab] |
| `node:process` | 🟡 | See `process` in the globals table ✅[^1] | See `process` in the globals table |
| `node:tls` | 🟡 | No `pskCallback`, OCSP stapling or session ticket keys; `renegotiate()` fails ✅[^1] | `getTicketKeys()` threw `Not implented in Bun yet` (sic); `renegotiate()` returned `false` and its callback got `ERR_TLS_RENEGOTIATION_UNSUPPORTED` (Node: succeeded) ✅[^lab] |
| `node:v8` | 🟡 | Heap statistics describe JavaScriptCore's single heap; `serialize` uses JavaScriptCore's wire format; no `startCpuProfile`, `Serializer` ✅[^1] | `new v8.Serializer()` threw `ERR_NOT_IMPLEMENTED`; `startCpuProfile`, `queryObjects` `undefined` (Node: functions); `serialize` in the measured table ✅[^lab] |
| `node:wasi` | 🟡 | No `getImportObject()`, `initialize()`; `proc_exit` exits Bun ✅[^1] | `getImportObject`/`initialize` `undefined`; a hand-assembled module calling `proc_exit(3)` with `returnOnExit: true` ended the Bun process with exit code 3 (Node: `start()` returned 3) ✅[^lab] |
| `node:worker_threads` | 🟡 | `Worker` ignores `resourceLimits` and `trackUnmanagedFds`; no `moveMessagePortToContext`, `locks` ✅[^1] | `resourceLimits` in the measured table; `moveMessagePortToContext` exists but threw `ERR_NOT_IMPLEMENTED`; `locks` `undefined` ✅[^lab] |
| `node:inspector` | 🟡 | `Session` supports `Profiler`, `Runtime.enable`, `NodeTracing`; not `Runtime.evaluate` or `HeapProfiler`; no `Network` ✅[^1] | `Profiler.enable` worked; `HeapProfiler.enable` failed with `-32601` (Node: worked) ✅[^lab] |
| `node:repl` | 🟡 | `bun --interactive`; no result previews ✅[^1] | Typing `6*7` in `bun --interactive` under a pseudo-terminal (`script`) showed no preview; Node 24 showed `// 42` before Enter ✅[^lab] |
| `node:test` | 🟡 | Works only inside `bun test`; no snapshots, coverage, `mock.module()` or `--test` runner ✅[^1] | In the measured table |
| `node:sea` | 🔴 | Use `bun build --compile` instead ✅[^1] | `import('node:sea')` threw `ERR_UNKNOWN_BUILTIN_MODULE` (Node: loaded) ✅[^lab] |

### Node globals (per the docs page)

| Global | Status | Gaps and differences | Lab check (Bun 1.4.5 vs Node 24.22.1) |
|---|---|---|---|
| `AbortController`, `AbortSignal`, `atob`, `btoa`, `Atomics`, `BroadcastChannel`, `ByteLengthQueuingStrategy`, `CountQueuingStrategy`, `clearImmediate`, `clearInterval`, `clearTimeout`, `setImmediate`, `setInterval`, `setTimeout`, `CloseEvent`, `CompressionStream`, `DecompressionStream`, `Crypto`, `CryptoKey`, `CustomEvent`, `ErrorEvent`, `Event`, `EventTarget`, `exports`, `FormData`, `Headers`, `MessageChannel`, `MessageEvent`, `PerformanceEntry`, `PerformanceMark`, `PerformanceMeasure`, `PerformanceObserverEntryList`, `queueMicrotask`, `TextDecoder`, `TextDecoderStream`, `TextEncoder`, `TextEncoderStream`, `URL`, `URLPattern`, `URLSearchParams`, `__dirname`, `__filename` | 🟢 | None listed ✅[^1] | All 39 names other than `exports`, `__dirname` and `__filename` are defined (Node 24 lacks `ErrorEvent`); those three were set in a `.cjs` file in both ✅[^lab] |
| `global`, `globalThis` | 🟢 | `globalThis` aliases `global` ✅[^1] | `global === globalThis` `true` in both ✅[^lab] |
| `require()` | 🟢 | Includes `require.main`, `require.cache`, `require.resolve` ✅[^1] | In a `.cjs` file, `require.main === module`, `require.cache` and `require.resolve` worked in both ✅[^lab] |
| `module` | 🟢 | No `module.isPreloading` ✅[^1] | In a `-r` preload, `module.isPreloading` was `undefined` (Node: `true`) ✅[^lab] |
| `Blob` | 🟢 | `endings` ignored; `stream()` has no BYOB reader ✅[^1] | `endings: 'native'` kept `a\r\nb` at 4 bytes (Node: 3); a BYOB reader threw (Node: worked) ✅[^lab] |
| `Buffer` | 🟢 | 4 GiB cap ✅[^1] | In the measured table |
| `console` | 🟢 | Output written as for `node:console` ✅[^1] | See `node:console` |
| `fetch` | 🟢 | `integrity` ignored ✅[^1] | A wrong `integrity` was ignored and the body returned (Node: rejected, `integrity mismatch`) ✅[^lab] |
| `File` | 🟢 | Reports `Blob` as `constructor` and `Symbol.toStringTag` ✅[^1] | `constructor.name` `Blob`, `[object Blob]` (Node: `File`) ✅[^lab] |
| `MessagePort` | 🟢 | `on()`/`once()`/`off()` only after `node:worker_threads` loads ✅[^1] | `port.on` `undefined` until `node:worker_threads` loaded, then a function (Node: always a function) ✅[^lab] |
| `ReadableStream`, `WritableStream`, `TransformStream` (and their controllers, readers, writers) | 🟢 | Not transferable with `postMessage()` or `structuredClone()` ✅[^1] | `structuredClone(stream, { transfer: [stream] })` threw `The object can not be cloned.` (Node: worked) ✅[^lab] |
| `Response` | 🟢 | A string body's default `content-type` is not visible in `headers` ✅[^1] | `new Response('x').headers.get('content-type')` `null` (Node: `text/plain;charset=UTF-8`) ✅[^lab] |
| `structuredClone()` | 🟢 | Transfers only `ArrayBuffer` and `MessagePort`; cloned errors lose `cause` ✅[^1] | `cause` in the measured table ✅[^lab] |
| `SubtleCrypto` | 🟢 | No `Ed448`, `X448`, `AES-OCB`, `ML-KEM-512` and other Node-experimental algorithms ✅[^1] | `Ed448`, `X448`, `AES-OCB`, `ML-KEM-512` keys: `Unrecognized algorithm name`; `ML-KEM-768` worked; Node 24 generated all five ✅[^lab] |
| `DOMException` | 🟢 | `Error.isError()` returns `false` for it ✅[^1] | `Error.isError()` `false` (Node 24: `true`) ✅[^lab] |
| `WebAssembly` | 🟢 | Memory64 off unless `BUN_JSC_useWasmMemory64=1` ✅[^1] | A memory with `address: 'i64'` threw `requires Memory64 to be enabled`, and worked with `BUN_JSC_useWasmMemory64=1` (Node 24: worked without a flag) ✅[^lab] |
| `WebSocket` | 🟢 | `binaryType` defaults to `"nodebuffer"` (Node: `"blob"`) ✅[^1] | In the measured table |
| `navigator` | 🟡 | `userAgent`, `platform`, `hardwareConcurrency` only; no `language`, `locks` ✅[^1] | `hardwareConcurrency` 8; `locks` and the `Navigator` class `undefined`; `language` in the measured table; **`platform` was `Linux x86_64` on this arm64 host** (Node: `Linux arm64`) ✅[^lab] |
| `performance` | 🟡 | Node additions appear only after `node:perf_hooks` loads; `eventLoopUtilization()` returns zeros ✅[^1] | `eventLoopUtilization`, `timerify`, `nodeTiming` `undefined` until `node:perf_hooks` loaded (Node: present from the start) ✅[^lab] |
| `PerformanceObserver` | 🟡 | Node-only entry types reach only the `node:perf_hooks` observer ✅[^1] | A global observer got 0 `function` entries from `timerify()`, the `node:perf_hooks` one 2 (Node: 2 and 2) ✅[^lab] |
| `PerformanceResourceTiming` | 🟡 | Class exists; no entries are created ✅[^1] | After a `fetch()`, 0 `resource` entries (Node: 1) ✅[^lab] |
| `process` | 🟡 | `process.binding` covers 10 bindings (`buffer`, `config`, `constants`, `crypto/x509`, `fs`, `http_parser`, `natives`, `tty_wrap`, `util`, `uv`); `getActiveResourcesInfo()` returns `[]`; no `addUncaughtExceptionCaptureCallback` ✅[^1] | All 10 bindings loaded and `process.binding('os')` threw (Node 24 loads 8 of the 10, and `os`); `addUncaughtExceptionCaptureCallback` `undefined` in Node 24 too ✅[^lab] |
| `Request` | 🟡 | No `keepalive`, `duplex`; `credentials`, `referrer` accepted but ignored ✅[^1] | `keepalive` and `duplex` `undefined` (Node: `true`, `"half"`); `credentials: 'omit'` read back as `include` (Node: `omit`) ✅[^lab] |
| `QuotaExceededError` | 🔴 | Not implemented ✅[^1] | `undefined`, as in Node 24 ✅[^lab] |
| `Storage` (`localStorage`, `sessionStorage`) | 🔴 | Not implemented ✅[^1] | `undefined` in Bun, also with Node's `--experimental-webstorage --localstorage-file` flags; Node 24 with those flags stored and read a value ✅[^lab] |

### Measured differences: the same probe in Bun 1.4.5 and Node 24.22.1

| Behaviour probed | Bun 1.4.5 | Node 24.22.1 | Same? |
|---|---|---|---|
| `process.version`, `process.versions.modules` | `v26.3.0`, `147` | `v24.22.1`, `137` | No ✅[^lab] ✅[^2] |
| `require('v8').getHeapStatistics()` | 15 keys, `heap_size_limit` 311 MB, then 313 MB | 14 keys, 2240 MB both times | No: JavaScriptCore heap figures ✅[^lab] ✅[^1] |
| `heap_size_limit` at start under `docker run --memory=` 256m / 512m / 1g / 2g / 4g / no limit (host: 8 GiB) | 286–287 MB at every limit | 259 / 259 / 560 / 1120 / 2240 / 2240 MB | No: Bun's figure ignores the container limit (2 runs each) ✅[^lab] |
| `heap_size_limit` while keeping 100 … 600 MB of arrays alive, no limit | Grew with the heap: 1298 MB at 100 MB, 6413 MB at 600 MB; under `--memory=1g` it stopped at 8004 MB (the host's memory) | 2240 MB throughout | No: in Bun it is not a ceiling ✅[^lab] |
| Keep allocating under `--memory=512m` | Killed by the kernel after about 400 MB: exit 137, `OOMKilled=true` | Stopped itself at about 204 MB used: `FATAL ERROR: Reached heap limit … JavaScript heap out of memory`, `OOMKilled=false` | No (2 runs; at 1g the same, Bun at about 1000 MB and Node at about 500 MB; at 256m both were killed, 137) ✅[^lab] |
| `process.constrainedMemory()` with `--memory=512m` / no limit | `536870912` / `8392994816` (the host's memory) | `536870912` / `18446744073709552000` | Same with a limit ✅[^lab] |
| `v8.serialize({ a: 1 })` first bytes | `[14, 0, 0, 0]` | `[255, 15, 111, 34]` | No: different wire formats ✅[^lab] ✅[^1] |
| `vm.createContext({a:1,b:2})` + `runInContext('a + b')`; `typeof process` inside | `3`; `undefined` | `3`; `undefined` | Yes ✅[^lab] |
| `vm.runInNewContext('while(true){}', {}, { timeout: 50 })` | `ERR_SCRIPT_EXECUTION_TIMEOUT` | `ERR_SCRIPT_EXECUTION_TIMEOUT` | Yes ✅[^lab] |
| `Worker` + `postMessage` round trip (`fib(20)`) | `{ fib: 6765, threadId: 1 }` | same | Yes ✅[^lab] |
| `Worker` with `resourceLimits: { maxOldGenerationSizeMb: 16 }` allocating about 200 MB | Limit ignored: the worker finished all 200 allocations and exited with code 0 (after 4.6 s, then 0.4 s) | `ERR_WORKER_OUT_OF_MEMORY`, exit code 1 | No ✅[^lab] ✅[^1] ✅[^3] |
| `http.createServer` on port 0 + `fetch` | 200, `hi GET`, headers `connection,content-length,date,keep-alive,x-probe` (`x-probe` set by the handler) | same | Yes ✅[^lab] |
| `server instanceof net.Server` | `false` | `true` | No ✅[^lab] ✅[^1] |
| `createHash('sha256').update('bun')` | `08d1082cc8d85a08…` | same | Yes ✅[^lab] |
| `crypto.getHashes().length` | 14 | 81 | No ✅[^lab] |
| `generateKeyPairSync('ec', { namedCurve: 'secp256k1' })` | `ERR_OSSL_EC_UNKNOWN_GROUP` | works | No ✅[^lab] ✅[^1] |
| `createCipheriv('chacha20-poly1305', …)` | `ERR_CRYPTO_UNKNOWN_CIPHER` | works | No ✅[^lab] ✅[^1] |
| `generateKeyPairSync('dh', { group: 'modp14' })` | `ERR_OSSL_EVP_UNSUPPORTED_ALGORITHM` | `dh` key | No ✅[^lab] ✅[^1] |
| `diagnostics_channel.subscribe` to `undici:request:create`, `http.client.request.start`, `http.server.request.start`, then one `fetch` and one `http.get` to a local `http` server | only `http.client.request.start` published | all three published | No ✅[^lab] ✅[^1] |
| `fs.watch(dir)` then one `writeFileSync` | `rename:a.txt`, `change:a.txt` | same | Yes ✅[^lab] |
| `child_process.fork` + `send({ n: 41 })`, child replies `n + 1` | `{ reply: 42 }` | same | Yes ✅[^lab] |
| `process.binding('fs')`, `('natives')` | objects | objects | Yes ✅[^lab] |
| `process.binding('tcp_wrap')` | throws "not implemented in Bun" | object | No ✅[^lab] ✅[^1] |
| `typeof module.registerHooks` | `undefined` | `function` | No ✅[^lab] ✅[^1] |
| `module.register(<data: resolve hook>)`, then `import('virtual:x')` | `ERR_MODULE_NOT_FOUND` (hook never ran) | `42` (hook resolved it) | No ✅[^lab] ✅[^1] ✅[^4] |
| `new DatabaseSync(':memory:')` from `node:sqlite`, `sum(x)` of 1 and 2 | `{ s: 3 }` | `{ s: 3 }`, no warning printed | Yes ✅[^lab] |
| `AsyncLocalStorage.run({ id: 7 })` across `await`, `setTimeout`, `setImmediate` | `7`, `7` | `7`, `7` | Yes ✅[^lab] |
| `async_hooks.executionAsyncId()` inside a timer | `0` | `119` | No ✅[^lab] ✅[^1] |
| `inspector.Session` + `post('Runtime.evaluate', { expression: '6*7' })` | `Inspector error -32601: 'Runtime.evaluate' wasn't found` | `42` | No ✅[^lab] ✅[^1] |
| A `node:test` file run as a plain script | `error: Cannot use test outside of the test runner`, exit 1 | runs, exit 1 for its failing test | No ✅[^lab] |
| The same `node:test` file under `bun test` / `node --test` | `1 pass`, `1 fail` | `pass 1`, `fail 1` | Yes ✅[^lab] |
| `Object.keys(process.memoryUsage())` | `rss,heapTotal,heapUsed,external,arrayBuffers` | same | Yes ✅[^lab] |
| `process.getActiveResourcesInfo()` with a pending timer | `[]` | `["Timeout"]` | No ✅[^lab] ✅[^1] |
| `os.machine()` | `arm64` | `aarch64` | No ✅[^lab] ✅[^1] |
| `navigator.language` | `undefined` | `en-US` | No ✅[^lab] ✅[^1] |
| `typeof localStorage` (no flags) | `undefined` | `undefined` | Yes ✅[^lab] |
| `buffer.constants.MAX_LENGTH` | `4294967296` | `9007199254740991` | No ✅[^lab] ✅[^1] |
| `structuredClone(new Error('e', { cause: 'c' })).cause` | lost (`undefined`) | `'c'` | No ✅[^lab] ✅[^1] |
| `performance.eventLoopUtilization()` after the probe | `{ idle: 0, active: 0 }` | non-zero (`idle` 649 and `active` 222 ms, then 487 and 82 ms) | No ✅[^lab] ✅[^1] |
| `new WebSocket(url).binaryType` | `nodebuffer` | `blob` | No ✅[^lab] ✅[^1] |
| `new Error().stack` in an ES module | `at inner (/w/compat.mjs:116:78)`, caller of a tail call missing | `at inner (file:///w/compat.mjs:116:74)`, every caller listed | No: see [javascriptcore-engine.md](../internals/javascriptcore-engine.md) ✅[^lab] |

## Lookup notes
- **Documented on bun.com, not in 1.4.5: `diagnostics_channel` as 🟢 with `undici:*` channels.** The live page marks the module fully implemented and says `fetch()` publishes `undici:*` channels ✅[^6]; the 1.4.5 docs mark it 🟡 without those channels ✅[^1], and in the lab `fetch` published no `undici:request:create` message ✅[^lab]. Present in `1.4.6-canary.1` (the `oven/bun:canary` preview of the next release), not in 1.4.5: the same `fetch` plus `http.get` probe saw `undici:request:create`, `undici:request:headers`, `net.client.socket`, `http.server.request.start` and `http.client.request.start` published, the same five as Node 24.22.1, and `boundedChannel` was a function (Node 24: `undefined`) ✅[^lab].
- **Documented on bun.com, not in 1.4.5: `dh` key pairs.** The live page says `dh` keys can be generated from a `group` or a `prime` and used with `diffieHellman()`, but not exported ✅[^6]; the 1.4.5 docs list `dh` among the key types BoringSSL lacks ✅[^1], and `generateKeyPairSync('dh', { group: 'modp14' })` threw in the lab ✅[^lab]. Present in `1.4.6-canary.1`, not in 1.4.5: pairs from `group: 'modp14'` and from a 512-bit `prime` gave equal 256- and 64-byte secrets on both sides through `diffieHellman()`, and `export()` still threw `ERR_OSSL_EVP_UNSUPPORTED_ALGORITHM` (Node 24: exported) ✅[^lab].
- **Docs page vs release notes on Worker `resourceLimits`.** The Bun 1.4 release notes list `resourceLimits` among new `worker_threads` options ✅[^2], while the compatibility page says `Worker` ignores it ✅[^1]. The lab agrees with the compatibility page: a 16 MB limit did not stop a worker that allocated about 200 MB ✅[^lab], and it did not in Bun 1.3.14 or `1.4.6-canary.1` either (exit code 0 after all 200 allocations) ✅[^lab]. Do not rely on it to contain a runaway worker.
- **The heap does not follow a container's memory limit in Bun.** Node 24 sizes its heap limit from the cgroup (control group, the kernel's per-container resource accounting) memory limit, so a runaway allocation ends in its own `JavaScript heap out of memory` error; JavaScriptCore reports a `heap_size_limit` that starts near 286 MB whatever the limit, grows with the heap up to the host's memory, and stops nothing, so Bun keeps allocating until the kernel's out-of-memory killer ends the container with exit 137 ✅[^lab]. `process.constrainedMemory()` does return the container limit in Bun ✅[^lab]. Node's `--max-old-space-size` has no Bun equivalent here: `v8.setFlagsFromString()` ignores it ✅[^1].
- **Lab results that differ from the 1.4.5 page** (each ran twice) ✅[^lab]:
  - `http` `listen({ signal })`: the page says Bun ignores `signal` ✅[^1], but after `abort()` new connections were refused, as in Node, while a control run without `abort()` accepted them.
  - `path.matchesGlob()`: the page says there are no extglobs ✅[^1], but `+(a|b).js`, `!(b).js`, `@(a|b).js`, `?(a).js` and `*(a).js` matched as in Node, and `Bun.Glob` gave the same answers; only the dotfile difference held.
  - `stream` helpers: the page says they understand only Node streams ✅[^1]; `isReadable` (on closed and errored web streams), `isErrored` and `Readable.isDisturbed` answered as Node does, and only `isWritable(new WritableStream())` returned `null` instead of `true`.
  - `tls`: the page says `getEphemeralKeyInfo()` returns no information ✅[^1], but on the client side of a TLS 1.2 connection it returned `{ type: "ECDH", name: "X25519", size: 253 }`, as in Node; the server side was not probed.
- **`navigator.platform` reads `Linux x86_64` on arm64** in Bun 1.4.5 (and in 1.3.14 and `1.4.6-canary.1`), while `process.arch`, `os.arch()` and `uname -m` say arm64 / `aarch64`; Node reports `Linux arm64`. Observed only: the page lists `platform` as implemented ✅[^lab] ✅[^1].
- **Node 26, not 24.** Bun reports Node 26.3.0 and `NODE_MODULE_VERSION` 147 ✅[^lab] ✅[^2]; Bun 1.3.14 reported `v24.3.0` and 137, and `1.4.6-canary.1` `v26.12.1` and 147 ✅[^lab]. That number matters only for add-ons compiled against Node's internal ABI (application binary interface), which are built once per `NODE_MODULE_VERSION`; Node-API add-ons are ABI-stable across versions ✅[^7], and `bufferutil` 4.2.0's single Node-API prebuild loaded in Bun unchanged ✅[^lab] (`bun/system-apis/workers-ffi-and-native-code.md`).
- **Status is per API surface, not per package.** "🟢 Fully implemented" still comes with listed differences (for example `http.Server` is not a `net.Server`); a package that checks `instanceof net.Server` behaves differently even on a 🟢 module ✅[^lab] ✅[^1].
- **The two images differ in libc**, the C library (glibc for Bun, musl for Node), so OS-level results such as `os.machine()` were also checked against the docs page, which names the same `arm64` vs `aarch64` difference ✅[^lab] ✅[^1].
- **`node:test` needs `bun test`.** A file that imports `node:test` fails as a plain `bun file.mjs`; run it with `bun test ./file.mjs` ✅[^lab] ✅[^1].
- **`localStorage` measured `undefined` in both runtimes** without extra flags ✅[^lab]. With Node's `--experimental-webstorage --localstorage-file=<file>`, Node 24 stored and read a value, while Bun given the same flags still had no `localStorage`, `sessionStorage` or `Storage` ✅[^lab].
- Reproduce a row: the probe is a list of `run(name, fn)` calls, for example `await run('os.machine()', () => os.machine())`; run it as `docker run --rm -v "$PWD:/w" -w /w oven/bun:1.4.5 bun compat.mjs` and the same with `node:24.22.1-alpine node compat.mjs`.

## Takeaways
- Before moving a service to Bun, search its code and dependencies for the 🟡 APIs above (`async_hooks` ids, `inspector` sessions, `module.register`, `v8.serialize`, `process.binding`, Worker `resourceLimits`) and test those paths first. [rule-candidate]
- Exchange data between Bun and Node processes as JSON, never as `v8.serialize` output. [rule-candidate]
- Replace Node loader hooks (`module.register`, `registerHooks`) with a `Bun.plugin` preload when the code must run on Bun.
- Do not depend on Worker `resourceLimits` in Bun; cap memory at the process or container level instead, and expect a Bun process that reaches a container limit to be killed with exit code 137 rather than to report a JavaScript heap error. [rule-candidate]

## Verification status
- Verified: 234 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the Node column ran in `node:24.22.1-alpine` on the same host (and, for the Bun-and-Node rows, as a copied binary inside `oven/bun:1.4.5`); `bunlab:1` (the image plus openssl) made the test certificate; `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`) and `oven/bun:1.3.14` (`1.3.14+0d9b296af`) ran the cross-version notes. [^lab]
- [Node.js Compatibility, docs at tag bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/nodejs-compat.mdx) — Bun docs pinned to the 1.4.5 release, 2026. Backs: every status row and listed gap. [^1]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: Node 26 baseline, `NODE_MODULE_VERSION` 147, the `resourceLimits` release-note claim. [^2]
- [Worker threads: new Worker() options](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#new-workerfilename-options) — Node.js docs, v24. Backs: `resourceLimits` behaviour in Node. [^3]
- [Modules: customization hooks](https://nodejs.org/docs/latest-v24.x/api/module.html#customization-hooks) — Node.js docs, v24. Backs: `module.register` and `registerHooks` in Node. [^4]
- [Bun v1.4.5](https://bun.com/blog/bun-v1.4.5) — Bun blog, 2026. Backs: 1.4.5 release date. [^5]
- [Node-API](https://nodejs.org/docs/latest-v24.x/api/n-api.html) — Node.js docs, v24. Backs: Node-API is ABI-stable, so modules run on later major versions without recompiling. [^7]
- [Node.js Compatibility, live page](https://bun.com/docs/runtime/nodejs-compat) — Bun docs, living (read 2026-11-24, describes a Bun newer than 1.4.5). Backs: only the "documented on bun.com, not in 1.4.5" notes. [^6]

## Related
- `bun/node-compat/migrating-from-node.md` — moving a Node project to Bun step by step
- `bun/internals/javascriptcore-engine.md` — stack traces, tail calls, heap statistics
- `bun/internals/event-loop-and-scheduling.md` — timer, immediate and rejection behaviour compared with Node 24
- `bun/system-apis/workers-ffi-and-native-code.md` — Workers and Node-API add-ons in Bun
- `bun/bundler/plugins-and-macros.md` — `Bun.plugin`, the replacement for loader hooks
- `bun/testing/bun-test-runner.md` — `bun test`, which hosts `node:test` files
- `js-runtime/worker-thread-pools.md` — worker pools in Node
