---
schema: knowledge-doc/v1
type: reference
topic: deno/fundamentals
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, web-apis, globals, fetch, streams, web-crypto, workers, websocket, localstorage, location, timers, temporal, navigator, window, globalthis, deno-namespace]
ranked-sources: true
---

# Web platform APIs and globals in Deno 2.9

## Summary
**TL;DR:** Deno 2.9.8 offers the web platform's non-DOM (Document Object Model) APIs as globals: `fetch`, `URL` and `URLPattern`, streams and compression streams (gzip, deflate, brotli), Web Crypto, `structuredClone`, `BroadcastChannel`, module Workers, `WebSocket`, `EventSource`, Web Storage, timers, `performance`, `Temporal` and `navigator`. They follow the web specs with documented differences: `fetch` has no cookie jar and no CORS (cross-origin resource sharing), events do not bubble, Workers must be modules, and `localStorage` holds 10 MB. There is no DOM and no `window` (use `globalThis` or `self`), and `location` exists only with `--location`. Node's `process`, `Buffer`, `global` and `setImmediate` are globals too. Everything that is not a web standard lives on the `Deno` namespace.
**Use this when:** checking whether a browser API exists in Deno, porting browser code, debugging `window is not defined` or a relative-URL `fetch`, or finding which doc covers a `Deno.*` area.
**Not this doc:** how Deno is built and why it is web-standards first → `deno/fundamentals/what-deno-is.md`; DOM types in `lib` → `deno/fundamentals/running-code-and-typescript.md`; which `--unstable-*` flag unlocks which API → `deno/releases-stability-and-support.md`; Node.js built-in modules → `deno/node-compat/node-and-npm-compatibility.md`.

## Scope
- **Covers:** the globals of a main-thread ES (ECMAScript) module started with `deno run` in Deno 2.9.8 with no flags unless a row says otherwise, measured with `typeof` in the lab ✅[^run]; the differences from browsers that Deno documents ✅[^webapis]; Node.js globals in your own code; the areas of the `Deno` namespace, each pointing to the doc that owns it.
- **Does not cover:** the worker global scope in depth, APIs behind `--unstable-*` flags, `node:` modules, and the permission each API needs (see `deno/security/permission-flags.md`).
- The Deno API reference groups the web APIs as Cache, Canvas, Crypto, Encoding, Events, Fetch, File, GPU, I/O, Intl, Messaging, Performance, Platform, Storage, Streams, URL, Wasm, WebSockets and Workers ✅[^api-web]; the catalog below uses similar groups.

## Catalog

### Web APIs present in Deno 2.9.8
Every global named in the second column was present (`typeof` gave `"function"` or `"object"`) with no flags ✅[^run].

| Area | Globals | Behaviour in Deno, with lab values |
|---|---|---|
| Fetch | `fetch`, `Request`, `Response`, `Headers`, `FormData` | No cookie jar; no same-origin policy, so no CORS or CORB (cross-origin read blocking); `redirect: "manual"` returns a `basic` response; `referrer`, `mode`, `credentials`, `cache`, `integrity`, `keepalive` and `window` are not implemented; request bodies can stream ✅[^webapis] |
| Fetch of `file:` URLs | `fetch(new URL("./data.txt", import.meta.url))` | Absolute URLs only, GET only, no headers set, needs `--allow-read` ✅[^webapis]. Lab: status `200`, body `"file-content\n"`, 0 headers; without the flag `NotCapable: Requires read access to "/lab/web/data.txt", run again with the --allow-read flag` ✅[^run] |
| URL | `URL`, `URLSearchParams`, `URLPattern` | `new URLPattern({ pathname: "/users/:id" }).exec("https://x.test/users/7").pathname.groups.id` gave `"7"` ✅[^run]; routing with it → `deno/web/websockets-sse-and-routing.md` |
| Streams | `ReadableStream`, `WritableStream`, `TransformStream`, `ByteLengthQueuingStrategy`, `TextEncoderStream`, `TextDecoderStream` | The three stream types are transferable with `postMessage` ✅[^webapis] |
| Compression | `CompressionStream`, `DecompressionStream` | Formats `gzip`, `deflate`, `deflate-raw` and `brotli` (brotli since 2.7) ✅[^webapis] ✅[^v27]. Lab round trip of `"hello hello hello"`: 28, 16, 10 and 13 bytes, each decompressed back intact ✅[^run] |
| Encoding | `TextEncoder`, `TextDecoder`, `atob`, `btoa` | `new TextEncoder().encode("é").length` gave `2`; `btoa("hi")` gave `"aGk="` ✅[^run] |
| Web Crypto | `crypto`, `crypto.subtle`, `crypto.randomUUID`, `CryptoKey`, `SubtleCrypto` | SHA-3 and HMAC (2.7); SHAKE, cSHAKE, TurboSHAKE, KangarooTwelve, KMAC, Argon2, ChaCha20-Poly1305, ML-DSA, SLH-DSA and ML-KEM (2.9); `SubtleCrypto.supports()` for feature detection ✅[^webapis]. Lab: SHA-256 of `"abc"` starts `ba7816bf`, SHA3-256 of `"abc"` starts `3a985da7`, `typeof SubtleCrypto.supports` is `"function"` ✅[^run] |
| Structured clone | `structuredClone` (and `postMessage` on workers and ports) | Clones primitives, collections, dates, typed arrays, errors, `Blob`, `File` (both since 2.8), `DOMException`, `CryptoKey`; transfers `ArrayBuffer`, `MessagePort` and the stream types, after which the original is unusable ✅[^webapis]. Lab: a `Date`, a `Map` and a `Blob` survived; a function threw `DataCloneError` ✅[^run] |
| Messaging | `BroadcastChannel`, `MessageChannel`, `MessagePort` | Two `BroadcastChannel("ch")` objects in one process: the second received `"hi"` from the first ✅[^run] |
| Workers | `Worker` | Module workers only, each on its own thread; a local worker module needs `--allow-read`, a remote one `--allow-net` ✅[^webapis]. Lab: `type: "classic"` threw `NotSupportedError: Classic workers are not supported.`; without `--allow-read` the worker failed with `Requires read access to "/lab/web/w2.ts"` ✅[^run]. More → `deno/runtime-apis/workers-kv-and-cron.md` |
| WebSocket and server-sent events | `WebSocket`, `CloseEvent`, `EventSource` | `WebSocketStream` was `undefined` without `--unstable-net` and a function with it ✅[^run]. Client and server use → `deno/web/websockets-sse-and-routing.md` |
| Web Storage | `localStorage`, `sessionStorage`, `Storage` | `localStorage` persists across runs, up to 10 MB, keyed by the `--location` origin, else the `--config` path, else the main module's path; `sessionStorage` lasts for one run ✅[^webapis]. Lab: the 11th `setItem` of a 1 MiB string threw `QuotaExceededError: Exceeded maximum storage size`; a `sessionStorage` value was `null` in the next run ✅[^run] |
| Location | `location`, `Location` | Set only by `--location <href>` (http or https), which is also the base for relative `fetch()` and worker URLs ✅[^webapis]. Lab with `--location=https://example.com/app/`: `location.href` was `https://example.com/app/` ✅[^run] |
| Timers | `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `queueMicrotask` | `setTimeout` and `setInterval` return Node-style `Timeout` objects since 2.8 ✅[^node]. Lab: `typeof` the handle was `"object"`, its constructor `Timeout`, with `ref`, `unref` and `hasRef` methods; `+handle` is a number that `clearInterval` accepts ✅[^run] |
| Performance | `performance`, `PerformanceObserver` | `PerformanceObserver` arrived in 2.7 ✅[^v27]; `typeof performance.now()` is `"number"` ✅[^run] |
| Events | `Event`, `EventTarget`, `CustomEvent`, `ErrorEvent`, `MessageEvent`, `ProgressEvent`, `PromiseRejectionEvent`, `addEventListener`, `dispatchEvent` | Events never bubble, because there is no DOM tree; `timeStamp` is always `0` ✅[^webapis]. Lab: a `CustomEvent` arrived with `detail` `42` and `timeStamp` `0` ✅[^run] |
| Cancellation and files | `AbortController`, `AbortSignal`, `Blob`, `File`, `FileReader` | Present ✅[^run] |
| Cache | `caches`, `Cache`, `CacheStorage` | Only `CacheStorage` open, has, delete, keys and `Cache` match, put, delete, keys; no relative paths; no query options on `match()` and `delete()` ✅[^webapis]. Lab: `put("/rel", …)` threw `TypeError: Invalid URL: '/rel'`; an absolute URL round-tripped `"cached"` ✅[^run] |
| Canvas and geometry | `createImageBitmap`, `ImageBitmap`, `ImageData`, `OffscreenCanvas`, `DOMMatrix`, `DOMPoint`, `DOMRect` | `OffscreenCanvas` (2.8+) gives only `"bitmaprenderer"` and `"webgpu"` contexts, `"2d"` and `"webgl"` return `null`; `createImageBitmap` decodes PNG, JPEG, BMP, GIF and WebP ✅[^webapis] |
| WebGPU | `navigator.gpu`, `GPU` | Present with no flag ✅[^run] |
| Temporal | `Temporal` | Stable since 2.7 and global with no flag; before 2.7 it needed `--unstable-temporal` ✅[^webapis] ✅[^v27]. Lab: `Temporal.PlainDate.from("2026-11-24").add({ days: 7 })` gave `2026-12-01` ✅[^run] |
| Navigator | `navigator` | `userAgent` is always `"Deno/<version>"`; also `platform` (2.7), `hardwareConcurrency`, `userAgentData` and `locks` (Web Locks) ✅[^webapis]. Lab: `Deno/2.9.8`, `Linux aarch64`, `8`, `language` `en-US-u-va-posix` ✅[^run] |
| Dialogs | `alert`, `confirm`, `prompt` | With stdin not a terminal, `prompt("name?")` returned `null` ✅[^run] |
| Language and misc | `WebAssembly`, `Intl`, `DOMException`, `reportError`, `Float16Array` | Present ✅[^run] |

### Browser globals that do not exist
`typeof` gave `"undefined"` for each, with no flags ✅[^run].

| Global | What to use in Deno |
|---|---|
| `window` | `globalThis` or `self`: `window` is gone since Deno 2 ✅[^v2rc] ✅[^ts] |
| `document`, `HTMLElement`, `DOMParser` | No DOM. `document.querySelector(…)` fails with `ReferenceError: document is not defined`, then `info: document global is not available in Deno.` and a hint naming DOM libraries ✅[^run] |
| `XMLHttpRequest` | `fetch` |
| `location` (without `--location`) | Pass `--location https://…` |
| `WebSocketStream` (without `--unstable-net`) | `WebSocket`, or the flag; unstable flags are listed in `deno/releases-stability-and-support.md` |
| `WorkerGlobalScope` (main thread) | Exists inside a worker: there `self instanceof WorkerGlobalScope` was `true` ✅[^run] |

### The global object

| Expression (main thread) | Deno 2.9.8 result ✅[^run] |
|---|---|
| `typeof globalThis` / `self === globalThis` | `"object"` / `true` |
| `typeof window` / `"window" in globalThis` | `"undefined"` / `false` |
| `typeof Window` | `"function"` |
| `Object.prototype.toString.call(globalThis)` | `"[object Window]"` |
| `global === globalThis` | `true` |

### Node.js globals in your own ES modules
`process` (added in Deno 2.0 ✅[^v2rc]) and `Buffer`, `global`, `setImmediate` and `clearImmediate` (usable in user code since Deno 2.4 ✅[^v24]) are globals in a plain ES module; `require`, `module`, `exports`, `__dirname` and `__filename` are `"undefined"` outside CommonJS files, so use `import.meta.dirname` and `import.meta.filename` ✅[^node] ✅[^run]. The measured table for ES modules and CommonJS files, with `process.version`, is in `deno/node-compat/node-and-npm-compatibility.md`.

### The `Deno` namespace at a glance
`Object.keys(Deno).length` was `115` in 2.9.8 ✅[^run]. The API reference groups the namespace into the areas below ✅[^api-deno].

| Area | Examples | Owning doc |
|---|---|---|
| File System, I/O | `Deno.readTextFile`, `Deno.FsFile`, `Deno.watchFs`, `Deno.stdin`, `Deno.inspect` | `deno/runtime-apis/files-processes-and-environment.md` |
| Runtime, Subprocess, Errors | `Deno.args`, `Deno.env`, `Deno.exit`, `Deno.Command`, `Deno.errors.NotFound` | `deno/runtime-apis/files-processes-and-environment.md` |
| Network | `Deno.connect`, `Deno.listen`, `Deno.connectTls`, `Deno.resolveDns` | `deno/runtime-apis/` |
| Cloud | `Deno.openKv`, `Deno.cron` | `deno/runtime-apis/workers-kv-and-cron.md` |
| Permissions | `Deno.permissions`, `Deno.PermissionStatus` | `deno/security/permission-model.md` |
| HTTP Server, WebSockets | `Deno.serve`, `Deno.upgradeWebSocket` | `deno/web/http-server.md`, `deno/web/websockets-sse-and-routing.md` |
| Fetch | `Deno.createHttpClient`, `Deno.HttpClient`, `Deno.Proxy` | the Fetch row of this catalog; no separate doc |
| Testing | `Deno.test`, `Deno.bench`, `Deno.TestContext` | `deno/testing/testing-and-mocking.md`, `deno/testing/coverage-and-benchmarks.md` |
| FFI | `Deno.dlopen`, `Deno.UnsafeCallback`, `Deno.UnsafePointer` | `deno/advanced/ffi-and-webassembly.md` |
| Telemetry | `Deno.telemetry`, `Deno.telemetry.tracerProvider` | `deno/advanced/debugging-profiling-and-telemetry.md` |
| Linter, Bundler, Jupyter, GPU | `Deno.lint.runPlugin`, `Deno.bundle`, `Deno.jupyter.display`, `Deno.webgpu` | `deno/toolchain/formatting-linting-and-docs.md`, `deno/toolchain/cli-subcommands.md` |

## Lookup notes
- **`location` without `--location`:** the docs say any access to the `location` global throws ✅[^webapis]. In 2.9.8 `typeof location` was `"undefined"` and `console.log(location)` printed `undefined`; only reading a field threw, with `TypeError: Cannot read properties of undefined (reading 'href')` ✅[^run]. Guard with `typeof location !== "undefined"`, not `try`.
- **Writing to `location`:** throws, because there is no page to navigate ✅[^webapis]; the lab got `NotSupportedError: Cannot set "location.hash"` ✅[^run].
- **Relative URLs:** without `--location`, `fetch("./data.txt")` threw `TypeError: Invalid URL: './data.txt'`; with `--location http://127.0.0.1:4509/app/`, `fetch("/api/items")` reached the local server's `/api/items` and got `200` ✅[^run].
- **`Buffer` in your own code:** the Node compatibility page still says `Buffer` is "Not global in your own code" ✅[^node], but `typeof Buffer` was `"function"` in 2.9.8 with no import and no flag ✅[^run]; the conflict and its sources are in `deno/node-compat/node-and-npm-compatibility.md`. Importing from `node:buffer` works either way and is explicit.
- **`localStorage` keys:** the same origin shares storage even across paths: `--location=https://example.com/app/` and `https://example.com/other/` counted runs 1 and 2, while `https://example.org/` started again at 1 ✅[^run]. Without `--location` the key is the main module's path ✅[^webapis], so moving the script starts empty storage. The data sat under `DENO_DIR` in `location_data/<hash>/local_storage` ✅[^run]; the lab's `--rm` container threw it away after each run.
- **Timer handles are not numbers:** `const id: number = setTimeout(() => {}, 0)` failed `deno check` with `TS2322 [ERROR]: Type 'Timeout' is not assignable to type 'number'.`; `ReturnType<typeof setTimeout>` passed ✅[^run].
- **`navigator.language`** came out as `en-US-u-va-posix` in the lab's Alpine container ✅[^run]; do not treat it as the user's real locale on a server.
- **Not on the docs' web-API page but present:** `BroadcastChannel` and `EventSource` have no section on the Web Platform APIs page ✅[^webapis], yet both are globals in 2.9.8 ✅[^run].
- **Types are separate from the runtime:** `lib` settings change which globals the type checker knows, never which exist at run time; see `deno/fundamentals/running-code-and-typescript.md`.

## Takeaways
- Write `globalThis` (or `self`), never `window`, in code that must run in Deno 2. [rule-candidate]
- Pass `--location` whenever code uses `location`, relative `fetch` URLs, or `localStorage` that must survive moving the script. [rule-candidate]
- Type timer handles as `ReturnType<typeof setTimeout>`, not `number`. [rule-candidate]
- Prefer the web API (`fetch`, `URL`, `crypto.subtle`, streams) over a `Deno.*` call when both do the job, so the code also runs in browsers.
- Keep `localStorage` under 10 MB, and do not rely on it in containers that are thrown away.

## Verification status
- Verified: 69 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`, with `--network none` (a `Deno.serve` server inside the same container answered the relative `fetch`); outputs as quoted in Scope, Catalog and Lookup notes. [^run]
- [Web Platform APIs](https://docs.deno.com/runtime/reference/web_platform_apis/) — Deno project, living. Rank 1. Backs: every documented deviation from browsers (fetch, `file:` URLs, structured clone, events, location, Web Storage, Workers, OffscreenCanvas, navigator, Temporal, compression, Web Crypto, Cache). [^webapis]
- [Web APIs reference](https://docs.deno.com/api/web/) — Deno project, living. Rank 1. Backs: the web API categories. [^api-web]
- [Deno APIs reference](https://docs.deno.com/api/deno/) — Deno project, living. Rank 1. Backs: the `Deno` namespace categories and their example symbols. [^api-deno]
- [Node and npm Compatibility](https://docs.deno.com/runtime/fundamentals/node/) — Deno project, living. Rank 1. Backs: Node-style timers since 2.8, `process` everywhere, `import.meta.dirname`/`filename`, `require()` in CommonJS, and the `Buffer` table row quoted in Lookup notes. [^node]
- [TypeScript support](https://docs.deno.com/runtime/fundamentals/typescript/) — Deno project, living. Rank 1. Backs: Deno 2 has no `window`; globals live on `globalThis`. [^ts]
- [Deno 2.0 Release Candidate](https://deno.com/blog/v2.0-release-candidate) — Deno project, 2024. Rank 1. Backs: `window` is gone, `process` added. [^v2rc]
- [Deno 2.4: deno bundle is back](https://deno.com/blog/v2.4) — Deno project, 2025. Rank 1. Backs: `Buffer`, `global`, `setImmediate`, `clearImmediate` available to user code. [^v24]
- [Deno 2.7: Temporal API, Windows ARM, and npm overrides](https://deno.com/blog/v2.7) — Deno project, 2026. Rank 1. Backs: Temporal stable, brotli compression, `PerformanceObserver`. [^v27]

## Related
- `deno/fundamentals/what-deno-is.md` — why Deno is web-standards first.
- `deno/fundamentals/running-code-and-typescript.md` — `lib`, DOM types and type checking.
- `deno/web/websockets-sse-and-routing.md` — `WebSocket`, `EventSource` and `URLPattern` on the server.
- `deno/runtime-apis/files-processes-and-environment.md` — the most used `Deno.*` APIs.
- `deno/node-compat/node-and-npm-compatibility.md` — Node globals and `node:` modules in depth.
- `deno/releases-stability-and-support.md` — the `--unstable-*` flags that unlock further APIs.
