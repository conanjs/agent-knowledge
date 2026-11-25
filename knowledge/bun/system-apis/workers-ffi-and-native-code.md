---
schema: knowledge-doc/v1
type: concept
topic: bun/system-apis
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, worker, web-worker, structured-clone, environment-data, bun-ffi, dlopen, jscallback, tinycc, cc, node-api, napi]
---

# Bun workers, FFI and native code

## Summary
**TL;DR:** `new Worker("./w.ts", { preload, smol, ref })` runs a file on another thread with its own JavaScript heap; `postMessage` sends a **copy** made with the structured clone algorithm (transfer an `ArrayBuffer` to move it instead), and `setEnvironmentData` shares start-up values. `bun:ffi`'s `dlopen(lib, { fn: { args, returns } })` calls C functions in a shared library such as `libc.so.6` directly; `JSCallback` lets C call back into JavaScript; `cc()` compiles C at run time with an embedded TinyCC, but needs the C library's headers and link files: in the slim `oven/bun:1.4.5` image only header-free C with `-nostdlib` compiles, and with `libc6-dev` added ordinary C does. Node-API add-ons (`.node` files) load with `require()` or `process.dlopen`, not with `import`, and the docs call them the most stable native option. FFI is experimental.
**Use this when:** moving CPU-heavy (central processing unit) JavaScript off the main thread, calling a C library from Bun without writing an add-on, or choosing between FFI, `cc` and a Node-API module.
**Not this doc:** sizing a worker pool for a container's CPU limit → `js-runtime/worker-thread-pools.md`; separate processes and IPC → [processes-and-shell.md](processes-and-shell.md); `node:worker_threads` compatibility details → `bun/node-compat/nodejs-compatibility.md`.

## Problem
JavaScript runs one thing at a time per thread, so a 2-second computation freezes a server for 2 seconds. Moving it to a worker raises new questions: is the object I send shared or copied, how do I give every worker the same configuration, and why does the process not exit? Calling native code raises others: how a C `char*` becomes a JavaScript string, how C calls a JavaScript function, whether a C compiler is needed, and which of Bun's three native paths (FFI, `cc`, Node-API) is safe for production.

## Mental model
**Analogy:** a worker is a colleague in another office. You cannot hand over your notebook; you post a photocopy (structured clone), and their scribbles never reach your copy. Handing over a parcel with a transfer slip (`postMessage(buf, [buf])`) moves the parcel itself, and your desk is left empty. FFI is a phone line to a specialist who speaks only C: you must state exactly what types you send and receive, because the line does no translation beyond that.

**Artifact** (Bun 1.4.5, lab) ✅[^lab]:
```ts
// main.ts
const w = new Worker("./w.ts");
const obj = { n: 1, list: ["main"] };
w.postMessage({ kind: "mutate", obj });           // worker sets obj.n = 999, pushes "worker"
// worker replied with  {"n":999,"list":["main","worker"]}
// obj here is still     {"n":1,"list":["main"]}
const buf = new ArrayBuffer(16);
w.postMessage(buf, [buf]);                        // transferred: buf.byteLength is now 0
```

## How it works
### Workers
Three actors take part:
- **The main thread** — its job: create the worker and exchange messages, via `new Worker()` and `worker.postMessage()`.
- **Bun's message channel** — its job: copy or move each message between heaps, via the structured clone algorithm (with fast paths for strings and flat objects) ✅[^1].
- **The worker thread** — its job: run the file and answer, via `self.onmessage` and the global `postMessage()`.

```
main thread                    message channel                    worker thread (own heap)
new Worker("./w.ts") ────────────────────────────────────────▶ preload ./pre.ts, then w.ts
worker.postMessage(obj) ─────▶ structured clone (copy) ──────▶ self.onmessage(e) — e.data is a new object
worker.postMessage(buf,[buf]) ▶ transfer (move; buf detached) ─▶ e.data owns the bytes
onmessage(e) ◀──────────────── structured clone ◀─────────────── postMessage(reply)
"close" event (code) ◀──────────────────────────────────────── process.exit(3) / terminate()
```

1. **Main thread → worker: creation.** `Worker` is a global; the file may be TypeScript or JSX (JavaScript XML, the HTML-like tag syntax React uses) and use `import` without `{ type: "module" }` ✅[^1]: a `.tsx` worker that imported `./lib.ts` and built a JSX element ran with no options ✅[^lab]. A `blob:` URL also works: a `File` named `x.ts` holding a one-line handler answered `SHOUT` ✅[^1] ✅[^lab]. Options ✅[^1]:
   - `preload: ["./pre.ts"]` runs modules first, like `--preload`; a global set there was visible in the worker ✅[^lab].
   - `smol: true` gives the worker a small JavaScriptCore heap (less memory, slower) ✅[^1]; the worker ran normally with it ✅[^lab]. The difference did not show at a small scale: a worker that built 20 rounds of 100,000 small objects peaked at a median 38.7 MiB of heap with `smol` and 38.5 MiB without, in 339 and 323 ms (5 runs each), and `bun --smol` on the main thread looked the same ✅[^lab].
   - `ref: false` equals calling `worker.unref()` ✅[^1].
   A missing file fires an `error` event (`BuildMessage: ModuleNotFound resolving "./does-not-exist.ts" (entry point)`) ✅[^lab].
2. **Main thread → channel → worker: messages.** Messages are structured clones ✅[^1] ✅[^3]: the worker received a real `Map`, `Date` and `Uint8Array`, its changes did not reach the sender, and the reply was a new object (`r.obj === obj` → `false`) ✅[^lab]. The fast paths showed in timings: 20,000 round trips took a median 10.5 ms for a 1 KB string, 17.8 ms for a flat object of four primitives, 24.7 ms when one of its values was a `Date`, and 27.4 ms for the same primitives nested one level down (5 runs each) ✅[^1] ✅[^lab]. A function cannot be cloned: `DataCloneError: The object can not be cloned.` ✅[^lab]. A second `postMessage` argument lists objects to transfer ✅[^2]; the sender's `ArrayBuffer` dropped from 16 bytes to 0 ✅[^lab]. Messages sent before the worker's script ran are queued, but a message that arrives while no handler is installed is dropped, so install `self.onmessage` before any top-level `await` ✅[^1].
3. **Shared start-up data.** `setEnvironmentData("config", value)` from `node:worker_threads` in the main thread, then `getEnvironmentData("config")` in a worker, returned `{ apiUrl: "https://api.example.test" }` ✅[^1] ✅[^2] ✅[^lab].
4. **Identity and events.** In the worker `Bun.isMainThread` was `false` and `threadId` `1`; `process.on("worker")` fired once per new worker (4 times for 4 workers) ✅[^1] ✅[^lab]. Bun adds an `open` event when the worker is ready ✅[^1] ✅[^lab].
5. **Worker → main: ending.** A worker ends when its event loop is empty; a `message` listener keeps it alive ✅[^1]: a worker whose only code was `self.onmessage = () => {}` kept the process running for 2 s, until the main thread exited ✅[^lab]. `process.exit(3)` inside the worker ended only the worker, and the `close` event carried code `3`; `worker.terminate()` gave code `0` ✅[^1] ✅[^lab]. A worker with a `setInterval` kept the process running (killed by `timeout` after 3 s); with `unref()` or `ref: false` the process exited after its own 300 ms timer ✅[^1] ✅[^lab]. The docs still call `Worker` experimental, especially termination ✅[^1].

### `bun:ffi`
FFI (foreign function interface) means calling a function compiled from another language as if it were a JavaScript function. Three actors take part:
- **Your code** — its job: describe each C function's argument and return types, via `dlopen(path, symbols)`.
- **JavaScriptCore** — its job: convert JavaScript values to C values and back at each call, via natively implemented `dlopen`, `CFunction` and `JSCallback` ✅[^4].
- **The shared library** — its job: run the C code, via the C ABI (application binary interface, the calling rules every C compiler follows).

1. **Opening a library.** `dlopen("libc.so.6", { getpid: { args: [], returns: FFIType.i32 }, … })` returned `symbols`; `getpid()` equalled `process.pid` (7) ✅[^4] ✅[^lab]. `suffix` is `so` on Linux and `dylib` on macOS (`dll` on Windows, not run: the lab has no Windows machine) ✅[^4] ✅[^lab]. On macOS 26.1, `dlopen("libc.dylib")`, `"libSystem.B.dylib"` and `"/usr/lib/libSystem.B.dylib"` each gave a `getpid()` equal to `process.pid`, although neither file exists in `/usr/lib` (macOS keeps its system libraries in a shared cache that `dlopen` reads), and `libc.so.6` failed ✅[^lab]. A symbol the library lacks throws `TypeError: Symbol "no_such_fn" not found in "libc.so.6"`; a missing library throws `Failed to open library "libnope.so": … cannot open shared object file` ✅[^lab].
2. **Types.** `FFIType` names C types: `i32`/`int`, `u64`/`usize`, `f64`/`double`, `ptr`, `cstring`, `function`, `bool` and more ✅[^4]. A 64-bit return comes back as a `bigint`: `strlen("héllo")` → `6n` (6 UTF-8 bytes) ✅[^lab]. A `cstring` argument accepts a JavaScript string directly; a `cstring` return becomes a JavaScript string (`getenv("HOME")` → `"/root"`) ✅[^4] ✅[^lab].
3. **Pointers.** A pointer is a plain `number` ✅[^4]. `ptr(Buffer.from("pointer text\0"))` gave a number; `new CString(p)` → `"pointer text"` (a normal string, copied out of C memory), `new CString(p, 0, 7)` → `"pointer"`, `read.u8(p, 0)` → `112` (`p`), `toArrayBuffer(p, 0, 4)` → bytes `112,111,105,110` ✅[^4] ✅[^lab]. Bun does not manage native memory: freeing it is your job ✅[^4].
4. **Callbacks.** `new JSCallback(fn, { args, returns })` makes a C function pointer that runs `fn` ✅[^4]. Passed as libc `qsort`'s comparator, `(a, b) => read.i32(a, 0) - read.i32(b, 0)` sorted `Int32Array [5,3,9,1,7]` into `1,3,5,7,9`; call `close()` when done ✅[^4] ✅[^lab]. `threadsafe: true` allows calls from other threads ✅[^4]. In `bunlab:1`, a `cc()` function that called such a callback from a new `pthread` got `0` back, and the JavaScript function ran afterwards on the JavaScript thread; a call from the same thread behaved the same way (2 runs), matching the docs' note that the C side gets an unspecified value and should treat the callback as `void` ✅[^4] ✅[^lab]. Without `threadsafe`, the cross-thread call hung the process until `timeout` killed it after 10 s ✅[^lab].
5. **`cc()`: compile C at run time.** `cc({ source: "./hello.c", symbols })` compiles a C file with TinyCC (a small C compiler embedded in Bun) and links it into the process ✅[^5]. The `oven/bun:1.4.5` image has no `gcc`, `cc` or `clang`, and `/usr/include` is empty ✅[^lab]. There ✅[^lab]:
   - default flags → `tcc: error: library 'c' not found` (no `libc.so` link file);
   - `#include <string.h>` → `include file 'string.h' not found`;
   - `flags: ["-nostdlib"]` with header-free C → `add(40, 2)` = `42`, `scale(4)` = `10`;
   - the docs' `napi_value` example → `include file 'stdint.h' not found`.
   In `bunlab:1`, the same image with `gcc` and `libc6-dev` added (`linux/lab-setup.md`), default flags worked: `#include <string.h>` with `strlen` gave `6` for `héllo`, `snprintf` worked, and the docs' `napi_value` example returned `"Hello, Napi!"` ✅[^5] ✅[^lab]. A JavaScript string passed to a `cstring` argument of a `cc()` symbol threw `TypeError: bun:ffi: a JavaScript string is not valid here; return it from a 'cstring'-returning callback, or pass a pointer/TypedArray`, while the same string passed to a `dlopen` symbol worked (`6n`); `Buffer.from("héllo\0")` works for both ✅[^lab].
   On macOS 26.1, with Apple's Command Line Tools installed (SDKs under `/Library/Developer/CommandLineTools/SDKs`, no `/usr/include`), default flags and `#include <string.h>` both worked (`add(40, 2)` = `42`, `strlen` of `héllo` = `6`), and Bun wrote TinyCC's own headers (`stddef.h`, `node/node_api.h` and others) into `$TMPDIR/bun-cc-<user id>/` ✅[^lab].
   `--no-ffi-cc` disables it: `ERR_FFI_CC_DISABLED Cannot compile C code because the bun:ffi C compiler is disabled.` ✅[^5] ✅[^lab].

### Node-API add-ons
Node-API (N-API) is Node's stable C interface for native add-ons, compiled into `.node` files ✅[^7]. Bun implements it itself, so most existing add-ons work, loaded with `require("./x.node")` or `process.dlopen(module, path)` ✅[^6]. In the lab Bun reported `process.versions.napi` `10`; `process.dlopen` on a missing file threw `ERR_DLOPEN_FAILED`, and under `--no-addons` it threw `ERR_DLOPEN_DISABLED: Cannot load native addon because loading addons is disabled.` ✅[^lab]. Real add-ons, in `bunlab:1` ✅[^lab]:
- **A hand-built add-on.** A 20-line C file using `node_api.h`, compiled with `gcc -shared -fPIC -I node_modules/node-api-headers/include hello.c -o hello.node` (headers from the `node-api-headers` 1.9.0 package ✅[^9]), loaded: `require("./hello.node").add(40, 2)` → `42`, and `process.dlopen(m, path)` then `m.exports.add(1.5, 2)` → `3.5`.
- **A published add-on.** `bufferutil` is the helper that masks and unmasks WebSocket frames for `ws` ✅[^10]. Version 4.2.0 ships prebuilt binaries for six platforms, built with `prebuildify --napi` (its `package.json`). Installed with `--ignore-scripts`, it loaded `prebuilds/linux-arm64/bufferutil.node` (its `mask` is native code, not the JavaScript fallback), and `mask` then `unmask` turned `hello` back into `hello`. Node-API is ABI-stable across Node.js versions, so a module compiled for one major version runs on later ones without recompiling ✅[^7]; that is why one prebuild also serves Bun, which reports `NODE_MODULE_VERSION` 147.
- **Not with `import`.** `import addon from "./hello.node"`, `await import("./hello.node")` and `with { type: "napi" }` all threw `TypeError: To load Node-API modules, use require() or process.dlopen instead of import.`, from `.mjs` and `.ts` files alike, although the 1.4.5 File Types page says native add-ons can be imported directly ✅[^11]. `createRequire(import.meta.url)("./hello.node")` works inside an ES module.

## Worked example
Sort numbers in C with a JavaScript comparator, then compile a C helper, in one script (Bun 1.4.5, lab) ✅[^lab]:

| Step | Code | Observed |
|---|---|---|
| 1 | `const libc = dlopen("libc.so.6", { qsort: { args: ["ptr", "usize", "usize", "function"], returns: "void" } })` | `libc.symbols.qsort` is a function |
| 2 | `const arr = new Int32Array([5, 3, 9, 1, 7])` | 5 × 4-byte integers |
| 3 | `const cmp = new JSCallback((a, b) => read.i32(a, 0) - read.i32(b, 0), { args: ["ptr", "ptr"], returns: "i32" })` | `typeof cmp.ptr` → `number` |
| 4 | `libc.symbols.qsort(arr, arr.length, 4, cmp)` | `arr` → `1,3,5,7,9`; the comparator ran 7 times |
| 5 | `cmp.close(); libc.close()` | freed |
| 6 | `cc({ source: "./hello.c", flags: ["-nostdlib"], symbols: { add: { args: ["int", "int"], returns: "int" } } }).symbols.add(40, 2)` | `42` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Handler installed after a top-level `await` in the worker | Early messages are lost ✅[^1]: a worker that awaited 100 ms first never saw `"early"`, only the later message ✅[^lab] | Delivery starts when the synchronous part of the script ends; `node:worker_threads`' `parentPort` queues instead ✅[^1]: a `node:worker_threads` worker that awaited 100 ms before `parentPort.on("message")` still got `"early"` ✅[^lab] |
| Sending a class instance or function | Function → `DataCloneError` ✅[^lab]; instances lose their prototype in a structured clone ✅[^3]: a `Point` arrived as a plain `Object` with its own `x` and `y` and no `norm` method ✅[^lab] | Send plain data and rebuild objects in the worker |
| Large `ArrayBuffer` sent without a transfer list | Copied (the sender kept 16 bytes) ✅[^lab] | Add it to the transfer list to avoid the copy |
| Main process does not exit | A worker with pending work keeps it alive ✅[^1] ✅[^lab] | `worker.unref()`, `ref: false`, or `terminate()` |
| `node:worker_threads` `Worker` options `resourceLimits` | Ignored by Bun ✅[^8] | `smol` is the only memory option the Workers page documents ✅[^1]; the measured run and the rest of the `node:worker_threads` status are in `bun/node-compat/nodejs-compatibility.md` |
| Wrong `FFIType` in a signature | Wrong values or a crash; an invalid pointer crashes the process ✅[^4]: `read.u8(8, 0)` ended the process with `panic(main thread): Segmentation fault at address 0x8`, exit code 139 ✅[^lab] | No type checking crosses the C boundary |
| `cc()` in a slim container | Fails to link libc; headers missing ✅[^lab] | Install the C library's development files (with `libc6-dev` the same source compiled ✅[^lab]), or keep the C free of headers and use `-nostdlib` |
| JavaScript string to a `cstring` argument of a `cc()` symbol | `TypeError: bun:ffi: a JavaScript string is not valid here` ✅[^lab] | `cc()` symbols take a pointer or `TypedArray` there; `dlopen` symbols accept the string |
| `import` of a `.node` file | `TypeError: To load Node-API modules, use require() or process.dlopen instead of import.` ✅[^lab] | Bun 1.4.5 loads Node-API modules only through `require()` and `process.dlopen`, contrary to the File Types page ✅[^11]; use `createRequire` in ES modules |
| FFI in production | Docs: experimental, known bugs ✅[^4] | Prefer a Node-API module for production native code ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Worker` | Real parallel JavaScript; Web API shape; TypeScript entry files | Copies per message; separate heaps; experimental termination |
| `bun:ffi` `dlopen` | Call any C ABI library without a build step | Experimental; manual types and memory; Bun-only |
| `cc()` | Ship C source, compile at start-up | Needs libc headers and link files for real C; TinyCC code is less optimised than gcc/clang |
| Node-API add-on | Stable ABI, works in Node.js too, most packages already exist | Needs a compiler or prebuilt binaries per platform |

## Takeaways
- Install the worker's `message` handler before any top-level `await`, and send plain data, transferring large `ArrayBuffer`s. [rule-candidate]
- `unref()` (or `terminate()`) every long-lived worker that must not keep the process alive. [rule-candidate]
- Use `bun:ffi` for scripts and experiments; ship production native code as a Node-API module. [rule-candidate]
- Declare 64-bit FFI returns knowing they arrive as `bigint`, and `close()` every `JSCallback` you create. [rule-candidate]
- Give a `JSCallback` that C may call from another thread `threadsafe: true`, and ignore its return value on the C side. [rule-candidate]
- Run `cc()` only where the C library's development files are installed, or keep the C free of headers and pass `-nostdlib`.

## Verification status
- Verified: 97 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image and `bunlab:1`, the same image with `gcc` and `libc6-dev`, used for `cc()` with headers, `pthread` callbacks and Node-API builds; arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the macOS `suffix`, `dlopen` and `cc()` checks ran a Bun 1.4.5 binary cross-compiled with `bun build --compile --target=bun-darwin-arm64` and run as the full CLI (`BUN_BE_BUN=1`) with an isolated environment on macOS 26.1 (Apple M2), deleted afterwards. [^lab]
- [Workers (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/workers.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: `Worker` options, `blob:` workers, message delivery and queuing, fast paths, `open`/`close` events, `process.exit` in workers, `ref`/`unref`, `smol`, environment data, `process.on("worker")`, `Bun.isMainThread`, experimental status. [^1]
- [Worker threads](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html) — Node.js documentation, v24. Backs: `setEnvironmentData`/`getEnvironmentData`, transfer lists. [^2]
- [The structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) — MDN Web Docs, living. Backs: what is copied, what fails, prototypes not kept. [^3]
- [FFI (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/ffi.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: `dlopen`, `FFIType`, `suffix`, `cstring`, `CString`, pointers as numbers, `read`, `toArrayBuffer`, `JSCallback` and `threadsafe`, memory management, experimental status, Node-API as the stable path. [^4]
- [C Compiler (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/c-compiler.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: `cc()` with TinyCC, `flags`, `napi_env`/`napi_value`, `--no-ffi-cc`. [^5]
- [Node-API (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/node-api.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: Bun's own Node-API implementation, `require()` and `process.dlopen` of `.node` files. [^6]
- [Node-API](https://nodejs.org/docs/latest-v24.x/api/n-api.html) — Node.js documentation, v24. Backs: what Node-API is. [^7]
- [Node.js compatibility (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/nodejs-compat.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: `resourceLimits` ignored by Bun's `node:worker_threads`. [^8]
- [nodejs/node-api-headers](https://github.com/nodejs/node-api-headers) — Node.js project, living. Backs: the Node-API C headers published as an npm package. [^9]
- [websockets/bufferutil](https://github.com/websockets/bufferutil) — the `ws` project, living. Backs: what `bufferutil` does and its prebuilt binaries. [^10]
- [File Types (docs at bun-v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/file-types.mdx) — Bun documentation in the Bun repository (Oven), 2026. Backs: the `napi` loader and "native addons can be directly imported" in the runtime. [^11]

## Related
- `js-runtime/worker-thread-pools.md` — how many worker threads a CPU-limited container can use.
- `js-runtime/node-worker-default-heap-limit.md` — worker heap limits in Node.js, the comparison point for `smol`.
- `bun/system-apis/processes-and-shell.md` — processes and IPC instead of threads.
- `bun/node-compat/nodejs-compatibility.md` — `node:worker_threads` status.
