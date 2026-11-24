---
schema: knowledge-doc/v1
type: concept
topic: deno/advanced
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, ffi, dlopen, native-types, nonblocking, unsafe-callback, unsafe-pointer, allow-ffi, webassembly, wasm, wasm-imports, instantiate-streaming, linear-memory]
ranked-sources: true
---

# Native code from Deno 2.9: FFI with Deno.dlopen, and WebAssembly modules

## Summary
**TL;DR:** FFI (foreign function interface) lets a Deno program load a C-compatible shared library with `Deno.dlopen(path, symbols)` and call its functions as JavaScript functions. You describe each function's parameter and result types in a symbol table, and Deno converts the values at the boundary. FFI needs `--allow-ffi`, and once a library is loaded its code has every right the process has, so the permission sandbox no longer holds. WebAssembly (Wasm) is the sandboxed alternative: a `.wasm` file can be imported like any ES (ECMAScript) module (type-checked, no permission flag), or loaded with `WebAssembly.instantiate` or `instantiateStreaming`, and it reaches only the imports you hand it and its own memory.
**Use this when:** you call a system or vendor C library from Deno, pass JavaScript callbacks or buffers to native code, choose between FFI and Wasm, or load a `.wasm` module and share memory with it.
**Not this doc:** how permissions work and what broad grants imply → `deno/security/permission-model.md`; the value syntax of `--allow-ffi` → `deno/security/permission-flags.md`; npm native addons (Node-API) → `deno/node-compat/node-and-npm-compatibility.md`; shipping a library inside a compiled binary → `deno/advanced/compile-and-distribution.md`; how ops cross from JavaScript to Rust → `deno/internals/runtime-architecture.md`.

## Problem
- Some work exists only in native code: a C codec, a vendor SDK (software development kit), a libc (C standard library) function. TypeScript cannot call it directly.
- C and JavaScript types do not line up (`size_t`, pointers, structs versus `number`, `bigint`, typed arrays). A wrong declaration does not raise a clear error: it returns garbage or kills the process with a segmentation fault (exit code 139 in the lab).
- `--allow-ffi` looks like one more narrow permission, but it is not: a script granted only `--allow-ffi` read `HOME` and ran a shell command, both of which the `Deno` APIs (application programming interfaces) refused in the same run.
- For Wasm, readers mix up the two loading styles, hit errors on bare import names inside a `.wasm` file, and get a `TypeError` from `instantiateStreaming` when the server sends the wrong content type.

## Mental model
**Analogy:** FFI is an adapter cable you wire by hand between two machines. You label every pin (the symbol table); if a label is wrong, the current still flows and something burns. Wasm is a sealed appliance with a fixed set of sockets: it can touch only what you plug into it.

| Term | Plain-English analogy | Concrete artifact (lab, Deno 2.9.8) |
|---|---|---|
| Dynamic library (`.so`, `.dylib`, `.dll`) | A toolbox of ready-made functions that programs borrow at run time | `/lib/libc.musl-aarch64.so.1`, or `libc.so.6` |
| Symbol table | The label list taped to the toolbox lid: name, inputs, output | `strlen: { parameters: ["buffer"], result: "usize" }` |
| Native type | The unit written on each label (8, 32 or 64 bits, a pointer) | `"i32"` gives a `number`; `"usize"` gives a `bigint` (`10n`) |
| Pointer | A street address in memory, not the house itself | `Deno.UnsafePointer.value(p)` → `281473962180411n` |
| Callback | A phone number you give the library so it can call you back | `new Deno.UnsafeCallback({ parameters: ["pointer", "pointer"], result: "i32" }, fn)` |
| Wasm module | A sealed, portable program in a compact byte format | `add.wasm`: 41 bytes, starting `00 61 73 6d` (`\0asm`) |
| Linear memory | One flat byte array that Wasm and JavaScript both read and write | `memory.buffer.byteLength` → `65536` |

**Artifact:** a libc call, run with `deno run --allow-ffi` ✅[^run]:
```ts
const libc = Deno.dlopen("libc.so.6", {
  strlen: { parameters: ["buffer"], result: "usize" },
  getpid: { parameters: [], result: "i32" },
} as const);
const cstr = (s: string) => new TextEncoder().encode(s + "\0");
libc.symbols.strlen(cstr("hello deno")); // 10n (a bigint)
libc.symbols.getpid();                  // 15, equal to Deno.pid
libc.close();
```

## How it works

### FFI
**4 actors:**
- **Your code** — its job: declare and call native functions, via `Deno.dlopen` and `lib.symbols.<name>()`.
- **Deno's FFI layer** (`ext:deno_ffi` in stack traces) — its job: check the permission and convert values, via the types in the symbol table.
- **The operating system's dynamic loader** — its job: map the library into the process and find each symbol, via the OS library search rules.
- **The native library** — its job: run the function, via its machine code.

```
[your code]            [Deno FFI layer]               [OS loader]            [native lib]
Deno.dlopen(path, …) ─▶ ffi permission check
                        (NotCapable if missing)
                        ─────────────────────────────▶ open file, find symbols
                                                       (Error if not found)
lib.symbols.f(args) ──▶ convert JS → C by type ──────────────────────────────▶ run f
                       ◀── convert C → JS by type ◀──────────────────────────── return
lib.close()  ─────────▶ drop symbol pointers ────────▶ unload when unused
```

1. **Your code → FFI layer:** `Deno.dlopen(filename, symbols)` returns a `DynamicLibrary` with a `symbols` object and `close()` ✅[^dlopen]. The FFI layer first checks the `ffi` permission; without it the call fails with `NotCapable: Requires ffi access to "libc.so.6", run again with the --allow-ffi flag`, exit code 1 ✅[^run].
2. **FFI layer → OS loader:** a path with a separator resolves against the current working directory, not the module's folder; a bare name such as `libc.so.6` goes through the OS search path ✅[^ffi]. In the lab the bare name resolved to the image's glibc copy, `/usr/local/lib/glibc/libc.so.6` ✅[^run]. A missing file throws at once: `Error: Could not open library: … cannot open shared object file: No such file or directory` ✅[^run].
3. **FFI layer → OS loader, per symbol:** every key in the table is looked up; `name` overrides the key, and `optional: true` makes a missing symbol `null` instead of an error ✅[^foreignfn]. Without it: `Failed to register symbol nope: … undefined symbol: nope` ✅[^run].
4. **Each call:** arguments and the result are converted by their declared type ✅[^nativetype]:

   | Declared type | JavaScript side | Lab value |
   |---|---|---|
   | `i8` `u8` `i16` `u16` `i32` `u32` `f32` `f64` | `number` | `abs(-42)` → `42` ✅[^run] |
   | `i64` `u64` `isize` `usize` | `bigint` | `strlen(…)` → `10n` ✅[^run] |
   | `bool` | `boolean` | — |
   | `pointer` | opaque pointer object, or `null` for a null pointer ✅[^ffi] | `getenv("NOPE_NOT_SET")` → `null` ✅[^run] |
   | `buffer` | a typed array as a parameter; a pointer object or `null` as a result ✅[^ffi] | `strlen(new TextEncoder().encode("…\0"))` |
   | `function` | a callback's `.pointer` | see step 6 |
   | `{ struct: ["i32", "i32"] }` | a typed array in; always a `Uint8Array` out ✅[^ffi] | `div(17, 5)` → 8-byte `Uint8Array`, read as `[3, 2]` ✅[^run] |
   | `void` | result only ✅[^ffi] | — |
5. **Nonblocking calls:** `nonblocking: true` runs the call on a dedicated blocking thread and returns a `Promise` of the result ✅[^foreignfn]. In the lab, libc `sleep(1)` returned a `Promise`, a 100 ms timer ticked 7 to 8 times while it waited, and it resolved to `0` after about 1.0 to 1.06 s (two runs); the same call declared without `nonblocking` returned `0` after about 1 s with 0 timer ticks, because it held the JavaScript thread ✅[^run].
6. **Native → your code (callbacks):** `new Deno.UnsafeCallback(definition, fn)` creates a C function pointer that stays valid until `close()` ✅[^callback]; you pass `callback.pointer` where the C signature expects a function. Callbacks are always safe to call from foreign threads, but they do not wake the event loop unless created with `Deno.UnsafeCallback.threadSafe()` or after `ref()` ✅[^callback].
7. **Pointers:** `Deno.UnsafePointer` has static helpers `create`, `equals`, `of`, `offset` and `value` ✅[^ptr]; `Deno.UnsafePointerView` reads memory at a pointer the way `DataView` reads a buffer (`getInt32`, `getCString`, `getArrayBuffer`, `copyInto`, …) ✅[^ptrview]. `UnsafePointer.of(new Uint8Array([104, 105, 0]))` read back as `"hi"`, and the same pointer offset by 1 as `"i"` ✅[^run].
8. **Closing:** `lib.close()` removes the symbol pointers, and further use "will lead to errors and crashes" ✅[^dylib]. Close callbacks with `callback.close()` too ✅[^ffi].

**The permission is the whole sandbox.** The API reference says loading foreign libraries "can in theory bypass all of the sandbox permissions" ✅[^dlopen]. The lab showed it with only `--allow-ffi` granted: `Deno.env.get("HOME")` and `new Deno.Command("id")` both threw `NotCapable`, while libc `getenv("HOME")` returned `/root` and libc `system("id -un; …")` ran a shell as `root` ✅[^run]. A path scope such as `--allow-ffi=/lib/libc.musl-aarch64.so.1` limits which files `dlopen` may open (opening `libc.so.6` then failed with `NotCapable`), not what the opened library does: musl's `system()` still ran a shell ✅[^run].

**Stability in 2.9.8:** the API reference tags `Deno.dlopen` with `allow-ffi` and with no `unstable` tag ✅[^dlopen], the unstable-flag reference lists no `--unstable-ffi` ✅[^unstable], and every probe here ran with `--allow-ffi` alone ✅[^run].

### WebAssembly
**3 actors:**
- **Deno's module loader** — its job: resolve and load `.wasm` files that are imported, via the module graph.
- **V8's WebAssembly engine** — its job: compile and instantiate modules, via the `WebAssembly` JavaScript API.
- **Your code** — its job: provide imports and use exports, via import specifiers inside the `.wasm` file or an import object.

1. **Static import:** `import { add } from "./add.wasm"` works since Deno 2.1, and its use is type-checked ✅[^wasm]. `add(1, 2)` printed `3`, and `deno check` on `add(1, "")` failed with `TS2345 [ERROR]: Argument of type 'string' is not assignable to parameter of type 'number'.` ✅[^run]. The static import needed no `--allow-read`, while `Deno.readFile` of the same file failed with `NotCapable: Requires read access to "/lab/add.wasm"` ✅[^run].
2. **The module's own imports are module specifiers:** an import entry `"./host.ts" "log"` loads `log` from `host.ts` ✅[^wasm]; the lab module called it with `7` ✅[^run]. A bare name such as `"env"` fails until an import map in `deno.json` maps it ✅[^wasm] ✅[^run].
3. **Exports:** functions, memories and globals become named exports. Since 2.9, an imported module's global export yields its value (`42`) instead of a `WebAssembly.Global` wrapper ✅[^v29]; the lab printed `answer = 42 number` ✅[^run]. Through the JavaScript API the same export is still a `Global` object (`.value` → `42`) ✅[^wasm-js] ✅[^run].
4. **JavaScript API:** `WebAssembly.instantiate(bytes, importObject)` returns `{ module, instance }` ✅[^wasm]. If the module has imports and no import object is given, it throws a `TypeError` ✅[^wasm-js]; V8's text is `WebAssembly.instantiate(): Imports argument must be present and must be an object` ✅[^run].
5. **Streaming:** `WebAssembly.instantiateStreaming(fetch(url))` compiles while bytes arrive; the response must have the `application/wasm` MIME (Multipurpose Internet Mail Extensions) type ✅[^wasm] ✅[^wasm-web]. A local `Deno.serve` sending `application/octet-stream` got `TypeError: Invalid WebAssembly content type` ✅[^run].
6. **Memory sharing:** an exported memory's `buffer` is an `ArrayBuffer` whose size is a multiple of 65536 bytes ✅[^wasm-js]. JavaScript wrote `1234` at byte 16 with a `DataView`, and the module's `load(16)` returned `1234` ✅[^run]. Strings and objects need a binding generator; the docs name wasmbuild for Rust ✅[^wasm].

## Worked example
Sort an `Int32Array` with libc `qsort`, passing a JavaScript comparator as the C callback. File `qsort.ts`:
```ts
const lib = Deno.dlopen(Deno.args[0] ?? "libc.so.6", {
  qsort: { parameters: ["buffer", "usize", "usize", "function"], result: "void" },
} as const);
let calls = 0;
const compare = new Deno.UnsafeCallback(
  { parameters: ["pointer", "pointer"], result: "i32" } as const,
  (a, b) => {
    calls++;
    return new Deno.UnsafePointerView(a!).getInt32() - new Deno.UnsafePointerView(b!).getInt32();
  },
);
const data = new Int32Array([42, -7, 19, 3, 0, 100, -50]);
lib.symbols.qsort(data, BigInt(data.length), 4n, compare.pointer);
console.log("sorted:", Array.from(data), "comparator calls:", calls);
compare.close();
lib.close();
```

| Step | Command or event | Result in the lab ✅[^run] |
|---|---|---|
| 1 | `deno check qsort.ts` | `Check qsort.ts`, exit 0: the `as const` table types `lib.symbols.qsort` |
| 2 | `deno run qsort.ts` (no flag) | `NotCapable: Requires ffi access to "libc.so.6"`, exit 1 |
| 3 | `deno run --allow-ffi qsort.ts` | `sorted: [-50, -7, 0, 3, 19, 42, 100] comparator calls: 14` |
| 4 | `deno run --allow-ffi qsort.ts /lib/libc.musl-aarch64.so.1` | the same order, `comparator calls: 15`: musl's `qsort` made one more comparison |
| 5 | inside the run | `data` was sorted in place: the `buffer` argument passed the typed array's memory, not a copy |

The `usize` parameters take `bigint` values (`BigInt(data.length)`, `4n`), and the comparator reads each element through `UnsafePointerView.getInt32()`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Calling a symbol after `lib.close()` | With musl: `Segmentation fault`, exit 139. With `libc.so.6`: it still returned `5` ✅[^run] | `close()` drops the pointers ✅[^dylib]; whether the code is still mapped afterwards depends on the library (the `deno` binary itself links glibc ✅[^run]), so the result is undefined either way |
| Two C libraries in one process | The `alpine-2.9.8` image runs a glibc build of Deno (`aarch64-unknown-linux-gnu`), yet musl's `strlen`, `getpid`, `qsort` and `system` worked when loaded beside it ✅[^run] | Only these stateless calls were tried; calls that share state between the two libcs (memory from `malloc`, `FILE*` handles) were not |
| `--allow-ffi=<path>` | Limits which files can be opened, not what they do: musl `system()` ran a shell ✅[^run] | Native code has the process's rights ✅[^dlopen]; treat any FFI grant as all permissions |
| `--unstable-ffi` passed in 2.9.8 | Accepted without a warning, and changes nothing ✅[^run] | FFI no longer needs a flag; drop it from old scripts |
| `i32` overflow in Wasm | `add(2147483647, 1)` → `-2147483648` ✅[^run] | The 32-bit sum wrapped around instead of growing |
| 64-bit and size types | Return `bigint`; `deno check` rejects a `number` for a `usize` parameter: `Argument of type 'number' is not assignable to parameter of type 'bigint'` ✅[^run] | Declared as `NativeBigIntType` ✅[^nativetype]; `deno run` went ahead with the same file without a type error ✅[^run], so run `deno check` first |
| Bare import name inside a `.wasm` file | 2.9.8 prints `error: Import "env" not a dependency`; the docs show `Relative import path "env" not prefixed with / or ./ or ../` ✅[^run] ✅[^wasm] | Same cause, different message: map the name in `deno.json` `imports` |
| WASI (WebAssembly System Interface) modules | Preview 1 runs through `node:wasi`, which prints an experimental warning; Preview 2 components cannot load through the `WebAssembly` API ✅[^wasm] | Run or transpile Preview 2 with `jco` ✅[^wasm] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| FFI (`Deno.dlopen`) | Calls any C-compatible library the OS can load; `nonblocking` moves a slow call off the JavaScript thread | Voids the sandbox; a wrong declaration or a call after `close()` crashes the process; one library build per OS (the API example picks `.so`, `.dylib` or `.dll` from `Deno.build.os` ✅[^dlopen]) |
| Wasm (import or `instantiate`) | A static import needs no permission; the module reaches only the imports you give it | The library must be compiled to Wasm; strings and objects need bindings ✅[^wasm] |
| A subprocess (`Deno.Command`) | The tool runs in its own process, so its crash is not Deno's | Needs `--allow-run`; data passes as bytes over pipes |

The FFI guide lists WebAssembly, `Deno.Command` and Deno's own APIs as alternatives to FFI ✅[^ffi].

## Takeaways
- Treat `--allow-ffi` as `--allow-all` in code review, even with a path list: the loaded library can do anything the process can. [rule-candidate]
- Never call a library symbol or a callback pointer after `close()`; close callbacks only after the last native call that may use them. [rule-candidate]
- Write symbol tables `as const` and run `deno check`, so a wrong argument type fails before it reaches native code.
- Prefer Wasm when the code can be compiled to it; reach for FFI only for libraries that exist only as native code.
- Serve `.wasm` files as `application/wasm`, or `instantiateStreaming` rejects them. [rule-candidate]

## Verification status
- Verified: 71 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example and Edge cases. The two `.wasm` files (41 and 112 bytes) were written byte by byte with `printf`. [^run]
- [Foreign Function Interface](https://docs.deno.com/runtime/fundamentals/ffi/) — Deno project, living. Rank 1. Backs: path resolution, type list and JavaScript values, structs, closing, alternatives. [^ffi]
- [FFI - Deno documentation: Deno.dlopen](https://docs.deno.com/api/deno/ffi/#Deno.dlopen) — Deno project, living. Rank 1. Backs: signature, `allow-ffi` tag, sandbox bypass warning, no `unstable` tag. [^dlopen]
- [FFI - Deno documentation: Deno.ForeignFunction](https://docs.deno.com/api/deno/ffi/#Deno.ForeignFunction) — Deno project, living. Rank 1. Backs: `name`, `optional`, `nonblocking`. [^foreignfn]
- [FFI - Deno documentation: Deno.NativeType](https://docs.deno.com/api/deno/ffi/#Deno.NativeType) — Deno project, living. Rank 1. Backs: number, bigint, boolean, pointer, buffer, function and struct type groups. [^nativetype]
- [FFI - Deno documentation: Deno.UnsafeCallback](https://docs.deno.com/api/deno/ffi/#Deno.UnsafeCallback) — Deno project, living. Rank 1. Backs: lifetime until `close()`, thread safety, `threadSafe()` and `ref()`. [^callback]
- [FFI - Deno documentation: Deno.UnsafePointer](https://docs.deno.com/api/deno/ffi/#Deno.UnsafePointer) — Deno project, living. Rank 1. Backs: static pointer helpers. [^ptr]
- [FFI - Deno documentation: Deno.UnsafePointerView](https://docs.deno.com/api/deno/ffi/#Deno.UnsafePointerView) — Deno project, living. Rank 1. Backs: `DataView`-like reads. [^ptrview]
- [FFI - Deno documentation: Deno.DynamicLibrary](https://docs.deno.com/api/deno/ffi/#Deno.DynamicLibrary) — Deno project, living. Rank 1. Backs: `close()` and use after close. [^dylib]
- [Unstable feature flags](https://docs.deno.com/runtime/reference/cli/unstable_flags/) — Deno project, living. Rank 1. Backs: no `--unstable-ffi` in the list. [^unstable]
- [WebAssembly](https://docs.deno.com/runtime/reference/wasm/) — Deno project, living. Rank 1. Backs: `.wasm` imports since 2.1 and type checking, imports as specifiers, import maps, `instantiate` and streaming, MIME type, bindings, WASI. [^wasm]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: global exports yield their value. [^v29]
- [WebAssembly JavaScript Interface](https://www.w3.org/TR/wasm-js-api-2/) — W3C, 2026. Rank 1. Backs: `TypeError` without an import object, exported globals as `Global`, memory buffer size. [^wasm-js]
- [WebAssembly Web API](https://www.w3.org/TR/wasm-web-api-2/) — W3C, 2026. Rank 1. Backs: `application/wasm` check in streaming compilation. [^wasm-web]

## Related
- `deno/security/permission-model.md` — what a grant allows and why broad grants matter.
- `deno/security/permission-flags.md` — `--allow-ffi` and `--deny-ffi` value syntax.
- `deno/advanced/compile-and-distribution.md` — embedding a native library with `--include` in a compiled binary.
- `deno/node-compat/node-and-npm-compatibility.md` — Node-API addons from npm.
- `deno/internals/runtime-architecture.md` — ops and resources behind the FFI layer.
