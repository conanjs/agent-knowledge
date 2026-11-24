---
schema: knowledge-doc/v1
type: concept
topic: go/low-level
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "js/wasm: Go ≥ 1.11", "wasip1/wasm and //go:wasmimport: Go ≥ 1.21", "//go:wasmexport and c-shared reactors: Go ≥ 1.24", "wazero v1.12.0 as the lab's WASI runtime"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, webassembly, wasm, wasi, wasip1, js-wasm, syscall-js, wasm-exec-js, wasmimport, wasmexport, reactor, gowasm, wazero]
ranked-sources: true
---

# Go and WebAssembly: the js/wasm and wasip1 ports

## Summary
**TL;DR:** Go compiles to WebAssembly (Wasm) through two ports that share `GOARCH=wasm`: `GOOS=js` (Go 1.11) runs in a JavaScript engine with the `wasm_exec.js` glue file and the experimental `syscall/js` package, and `GOOS=wasip1` (Go 1.21) runs on any runtime that implements WASI preview 1 (WASI = WebAssembly System Interface), such as wazero or Wasmtime. `//go:wasmimport` (Go 1.21) calls a function the host provides, and `//go:wasmexport` (Go 1.24) with `-buildmode=c-shared` builds a "reactor" whose functions a host can call again and again. Wasm gives Go one thread: goroutines still run concurrently, but a host call blocks all of them, and wasip1 cannot open network sockets. A minimal module is about 1.9 MB (megabytes).
**Use this when:** you run Go code in a browser, ship Go as a plugin that another application loads, run Go in a sandboxed Wasm runtime, or choose between the two ports.
**Not this doc:** calling C from Go → `go/low-level/unsafe-and-cgo.md`; cross-compiling with `GOOS`/`GOARCH` and other build flags → `go/tooling/go-command-and-build-reference.md`; Rust's Wasm targets → `rust/ecosystem/no-std-embedded-and-webassembly.md`; loading Wasm from Deno → `deno/advanced/ffi-and-webassembly.md`.

## Problem
"Compile Go to Wasm" hides two different targets. A `GOOS=js` module needs a JavaScript host and fails anywhere else, a `GOOS=wasip1` module needs a WASI runtime, and the files that make `go run` and `go test` work live in different places across versions. Code that is fine natively surprises on Wasm: there is no parallelism, a blocking callback can freeze a web page, `net.Listen` returns a listener nobody outside can reach, and a reactor's background goroutines stop as soon as the exported call returns.

## Mental model
**Analogy:** a shipping container (the `.wasm` module) with a fixed panel of plugs on its outside. Some plugs are inputs the ship must supply (imports), others are sockets the ship may use (exports). A `js/wasm` container only fits the browser dock, where `wasm_exec.js` supplies its plugs; a `wasip1` container fits any ship that offers the standard WASI dock. Inside, the container carries its own engine room: the Go runtime with its scheduler and garbage collector.

**Artifact:** the plug panels of three lab modules, listed with `CompileModule` from wazero's API (application programming interface); each `imports` entry is module name: number of imported functions ✅[^1], as shown below.
```
hello.wasm     GOOS=wasip1                        imports map[wasi_snapshot_preview1:22]        exports [_start]
hello-js.wasm  GOOS=js                            imports map[gojs:21]                          exports [getsp resume run]
reactor.wasm   GOOS=wasip1 -buildmode=c-shared    imports map[env:1 wasi_snapshot_preview1:16]  exports [_initialize add start ticks]
```

## How it works
**4 actors:**
- **Go toolchain** — its job: compile and link one `.wasm` module, via `GOOS`/`GOARCH` and, for a reactor, `-buildmode=c-shared` ✅[^7].
- **The module** — its job: carry the Go runtime and the program, via its import and export lists ✅[^5] ✅[^1].
- **Host runtime** — its job: load the module and supply its imports, via `wasm_exec.js` in a JavaScript engine or a WASI runtime ✅[^10] ✅[^17].
- **Host application** (optional) — its job: call the module's exported functions, via the runtime's embedding API (wazero's Go API in the lab) ✅[^18].

```
 go build (local)                         host process (local; nothing crosses a network)
 ─────────────────                        ─────────────────────────────────────────────────
 GOOS=js GOARCH=wasm ──► main.wasm ──► JS engine + wasm_exec.js  (imports "gojs")  ──► go.run(instance)
 GOOS=wasip1 GOARCH=wasm ─► main.wasm ─► WASI runtime            (imports "wasi_snapshot_preview1") ─► _start → main
 … -buildmode=c-shared ──► lib.wasm ──► host app embeds a runtime ─► _initialize, then add(), add(), …
                                        ▲ //go:wasmimport calls go out to the host; //go:wasmexport calls come in
```

1. **Toolchain: the build (local).** `GOOS=js GOARCH=wasm` arrived as an experimental port in Go 1.11; the program compiles to one module that includes the runtime for goroutine scheduling, garbage collection and maps ✅[^5]. `GOOS=wasip1 GOARCH=wasm` is the experimental WASI preview 1 port of Go 1.21 ✅[^6]. Files named `*_js.go`, `*_wasm.go` and `*_wasip1.go` are compiled only for those targets ✅[^5] ✅[^6]. A program that only calls `println` was 1,892,583 bytes for js, 1,907,028 for wasip1 and 1,867,646 as a native linux/arm64 binary; `-ldflags="-s -w"` saved about 35 KB on Wasm but 622 KB natively ✅[^1]. Go 1.11 described the minimum as about 2 MB, or 500 KB compressed ✅[^5].
2. **Browser host: `wasm_exec.js` (JavaScript engine).**
   - The glue file ships with Go, in `lib/wasm` since Go 1.24 (`misc/wasm` before) ✅[^7] ✅[^17].
   - It defines a global `Go` class whose `importObject` holds the `gojs` imports and whose `run(instance)` starts the program ✅[^10].
   - The page creates `new Go()`, instantiates the module with `go.importObject`, then awaits `go.run(inst)` ✅[^11], as in this sketch:
     ```js
     const go = new Go();
     WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
       .then((result) => go.run(result.instance));
     ```
   - Outside a browser, Node.js can host the same module through `wasm_exec_node.js` from the same folder. In the lab, a `GOOS=js GOARCH=wasm` build (2,505,097 bytes) that prints `runtime.GOOS`, reads `Date` through `syscall/js` and registers `goAdd` with `js.FuncOf` ran in the official `node:24.22.1-alpine` image with no network and printed ✅[^1]:
     ```console
     $ node wasm_exec_node.js main.wasm
     hello from js/wasm
     JavaScript Date year > 2000: true
     goAdd(2, 3) = 5
     ```
3. **Browser host: `syscall/js` (Go side).** The package reaches the JavaScript world: `js.Global()` returns the global object, and `Value.Get`, `Set`, `Call` and `js.ValueOf` read, write, call and convert ✅[^3]. It is marked EXPERIMENTAL, meant for now only to let tests run, and exempt from the Go compatibility promise ✅[^3].
   - *Callbacks:* `js.FuncOf(fn)` wraps a Go function for JavaScript. Each call from JavaScript pauses the event loop and runs `fn` on a new goroutine, so a callback that blocks, for example on `fetch` through `http.Client`, deadlocks at once; start a goroutine for blocking work, and call `Func.Release` when JavaScript will not call the function again ✅[^3].
   - *HTTP:* on js/wasm `http.Transport.RoundTrip` uses the browser's Fetch API ✅[^14].
4. **WASI host (WASI runtime).** WASI is a system-call interface for Wasm programs (files, clock, random data); the WASI release the port targets, `wasi_snapshot_preview1`, gives it the name `wasip1`, and a newer WASI would likely mean a new `GOOS` ✅[^17]. Wasmtime, wazero, WasmEdge, Wasmer and Node.js are examples of WASI hosts ✅[^17]. wazero is written in Go and needs no cgo; besides Go its only dependency is `golang.org/x/sys` ✅[^15], which `go get` added in the lab ✅[^1]. Its CLI (command-line interface) runs a module with `wazero run x.wasm args…` ✅[^16]. In the lab, `go run github.com/tetratelabs/wazero/cmd/wazero@v1.12.0 run -mount /src/data:/data hello.wasm one two` printed `hello from wasip1/wasm`, the file mounted at `/data`, and `args: [one two]` ✅[^1].
5. **`go run` and `go test` for wasip1 (go command, then a shell script).** With `$(go env GOROOT)/lib/wasm` on `PATH`, the go command runs wasip1 binaries through `go_wasip1_wasm_exec`, and `GOWASIRUNTIME` picks `wazero`, `wasmedge`, `wasmtime` or `wasmer`; the script may change between Go versions ✅[^17]. The script passes the whole filesystem (`-mount /:/` for wazero, `--dir=/` for the others) and falls back to `wasmtime` when the variable is empty ✅[^12]. `GOWASIRUNTIME=wazero GOOS=wasip1 GOARCH=wasm go test -v ./...` passed a test that checked `runtime.GOOS == "wasip1"` ✅[^1].
6. **`//go:wasmimport` (Go ≥ 1.21): calling out to the host.** The directive sits on a function declaration with no body and names a host module and function: `//go:wasmimport a_module f` makes Go's `g` call `f` from `a_module` ✅[^2] ✅[^6]. Allowed types ✅[^2], as shown below.

   | Go type | Wasm type |
   |---|---|
   | `bool`, `int32`, `uint32`, `unsafe.Pointer`, a pointer | `i32` |
   | `int64`, `uint64` | `i64` |
   | `float32` / `float64` | `f32` / `f64` |
   | `string` | two `i32` values, as a parameter only |

   A pointer must point to a `bool` or fixed-size number type, an array of them, or a struct that embeds `structs.HostLayout` and holds only such fields ✅[^2]. Go 1.24 added `bool`, `string`, `uintptr` and pointers to the allowed set ✅[^7]; a `uintptr` parameter built on Go 1.27.4 although the compiler's table does not list it ✅[^1]. The Go runtime itself reaches WASI this way, for example `random_get` from `wasi_snapshot_preview1` ✅[^17].
7. **`//go:wasmexport` (Go ≥ 1.24): letting the host call in.** The directive on a function definition exports it under the given name, with the same type rules ✅[^2]. Built with `-buildmode=c-shared`, a wasip1 module becomes a *reactor*: the linker emits `_initialize` instead of `_start`, `_initialize` runs the runtime and package initialization and must be called before any export, and `main` is not called ✅[^18]. Unlike a "command" module that ends when `main` returns, a reactor stays alive so its exports can be called many times ✅[^18]. Analogy: a command is a taxi ride that ends at the destination; a reactor is a taxi that waits outside for the next fare.
8. **`GOWASM` (go command).** It is a comma-separated list of experimental Wasm features; the valid values are `satconv` and `signext`, which set the build tags `wasm.satconv` and `wasm.signext` ✅[^4]. Since Go 1.26 the compiler always emits those sign-extension and saturating-conversion instructions, standard since at least Wasm 2.0, and ignores both settings ✅[^8]. On Go 1.27.4 `GOWASM=satconv,signext` still built, and `GOWASM=bogus` failed with `go: invalid GOWASM: no such feature "bogus"` ✅[^1]. Separately, Go 1.27's experimental `simd/archsimd` package (`GOEXPERIMENT=simd`) supports WebAssembly 128-bit SIMD (single instruction, multiple data) ✅[^9].
9. **Limits the docs state.**
   - *One thread:* Wasm has no parallelism. The scheduler still interleaves goroutines and standard input and output do not block, but any host function call blocks every goroutine until it returns ✅[^17]. The lab module reported `NumCPU: 1 GOMAXPROCS: 1`, and four sleeping goroutines still finished ✅[^1].
   - *No socket creation on wasip1:* WASI preview 1 only acts on sockets that are already open, so an HTTP server is impossible without host extensions ✅[^17]. Go's `net` package on js and wasip1 is a fake network meant to let other packages' tests pass ✅[^13]. In the lab `net.Listen("tcp", "127.0.0.1:8080")` returned no error and a `Dial` from the same module got `"echo ping"` back ✅[^1].
   - *Reactor goroutines:* a goroutine started by an exported function does not run after that function returns until the host calls into the module again ✅[^18].
   - *No pointers inside shared memory:* the 64-bit Go side and the 32-bit Wasm host cannot exchange pointers stored in memory, so a struct with a pointer field cannot cross ✅[^18].
   - *Memory:* Go 1.24 cut the initial memory size, notably for small modules ✅[^7], and Go 1.26 grows the heap in smaller steps, which lowers memory use for heaps under about 16 MiB ✅[^8].

## Worked example
A Go plugin built as a wasip1 reactor and driven by a Go host that embeds wazero v1.12.0 (pulled through the module proxy with `go get github.com/tetratelabs/wazero@v1.12.0`, which also added `golang.org/x/sys v0.44.0`) ✅[^1].

```go
// mod/main.go, built with: GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o reactor.wasm .
//go:wasmimport env host_log
func hostLog(v int32)

var ticks int32

func init() { fmt.Println("module: init ran") }
func main() { fmt.Println("module: main ran") } // never runs in a reactor

//go:wasmexport add
func add(a, b int32) int32 { hostLog(a + b); return a + b }

//go:wasmexport start
func start() { go func() { for { ticks++; time.Sleep(time.Millisecond) } }() }

//go:wasmexport ticks
func getTicks() int32 { return ticks }
```
```go
// host/main.go (excerpt): a native Go program
r := wazero.NewRuntime(ctx)
wasi_snapshot_preview1.MustInstantiate(ctx, r)
r.NewHostModuleBuilder("env").NewFunctionBuilder().
	WithFunc(func(v int32) { fmt.Println("host: host_log got", v) }).Export("host_log").Instantiate(ctx)
cfg := wazero.NewModuleConfig().WithStdout(os.Stdout).WithStartFunctions("_initialize")
mod, _ := r.InstantiateWithConfig(ctx, wasmBytes, cfg)
res, _ := mod.ExportedFunction("add").Call(ctx, api.EncodeI32(1), api.EncodeI32(2))
```
The host printed these lines, in order (the notes after `←` are added for reading) ✅[^1].
```
module: init ran                                   ← _initialize ran package init; main never ran
host: host_log got 3                               ← add called back into the host through //go:wasmimport
host: add(1, 2) = 3
host: host_log got 5
host: add(2, 3) = 5                                ← the same instance answered a second call
host: ticks after 200 ms outside the module = 0    ← start's goroutine did not run while the host slept
```
The module was 2,483,630 bytes ✅[^1]. Run without the `WithStartFunctions("_initialize")` call, the first `add` call printed `runtime: wasmexport function called before runtime initialization` and `call _initialize first`, then failed with `wasm error: unreachable` ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `GOOS=wasip1 GOARCH=wasm go run .` with no `GOWASIRUNTIME` and no Wasmtime installed | `go_wasip1_wasm_exec: line 17: exec: wasmtime: not found`, exit status 127 ✅[^1] | The script defaults to `wasmtime` ✅[^12] |
| The program reads a file the runtime did not expose | Through the script, `/data/input.txt` was `No such file or directory`, because the lab file sat under `/src/data`; with `-mount /src/data:/data` it was read ✅[^1] | A WASI program sees only the directories the runtime mounts; the script mounts `/` ✅[^12] |
| A `//go:wasmimport` function compiled for linux | `missing function body` ✅[^1] | The directive is wasm-only and the function has no body ✅[^2]; keep it in a `_wasm.go` or `_wasip1.go` file |
| A `//go:wasmimport` with a struct value, a pointer to a struct holding a pointer, or a `string` result | `unsupported parameter type pair`, `unsupported parameter type *withPtr`, `unsupported result type string` ✅[^1] | Only the table's types are allowed, and `string` only as a parameter ✅[^2] |
| A `js.FuncOf` callback blocks, for example on `http.Client` (which uses `fetch`) | The event loop stays blocked until the callback returns; with `fetch` that is an immediate deadlock ✅[^3] | The callback runs while the event loop is paused, and `fetch` needs the event loop ✅[^3]; do the waiting in a new goroutine |
| A `js.Func` that is never released | Its resources stay allocated ✅[^3] | `Release` frees them; call it once JavaScript is done with the function ✅[^3] |
| `GOWASM=satconv` on Go 1.27 | Builds, changes nothing ✅[^1] | Ignored since Go 1.26 ✅[^8] |
| An old `misc/wasm/wasm_exec.js` path in a build script | Missing: the Go 1.27.4 image had only `wasm_exec.html` in `misc/wasm`, and `wasm_exec.js`, `wasm_exec_node.js` and both exec scripts in `lib/wasm` ✅[^1] | The support files moved to `lib/wasm` in Go 1.24 ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `GOOS=js` | Runs in browsers; DOM (document object model) and Fetch through `syscall/js` ✅[^3] ✅[^14] | Needs the matching `wasm_exec.js`; `syscall/js` has no compatibility promise ✅[^3] |
| `GOOS=wasip1` command | Runs on any WASI runtime with files, clock and random data ✅[^17] | No sockets of its own; experimental port ✅[^6] ✅[^17] |
| wasip1 reactor (`c-shared` + `//go:wasmexport`) | A host calls Go functions many times without re-initializing ✅[^18] | Restricted parameter types; background goroutines pause between calls ✅[^18] |

## Takeaways
- Pick the port by host: `GOOS=js` for JavaScript engines, `GOOS=wasip1` for WASI runtimes and plugin hosts. [rule-candidate]
- Copy `wasm_exec.js` from the same Go version that built the module (`$(go env GOROOT)/lib/wasm` on Go ≥ 1.24). [rule-candidate]
- Never block inside a `js.FuncOf` callback; start a goroutine, and `Release` the function when done. [rule-candidate]
- In a reactor, have the host call `_initialize` first, and do not rely on goroutines running between exported calls. [rule-candidate]
- Run wasip1 tests in continuous integration (CI) with `GOWASIRUNTIME=wazero` and `lib/wasm` on `PATH`; a pure-Go runtime needs nothing but the module proxy.

## Verification status
- Verified: 82 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`, linux/arm64) where every behaviour marked with this note ran on 2026-11-24, with wazero v1.12.0 (and its dependency `golang.org/x/sys` v0.44.0) fetched through `proxy.golang.org`: module sizes, import and export lists, the wasip1 command and `go test`, the reactor and its host, `GOWASM`, the `//go:wasmimport` type errors, and a `js/wasm` build run under Node.js 24.22.1 (`node:24.22.1-alpine`). [^1]
- [Command compile (go1.27.4)](https://pkg.go.dev/cmd/compile@go1.27.4) — Go team, 2026. Rank 1. Backs: `//go:wasmimport` and `//go:wasmexport` syntax, the Go-to-Wasm type table, pointer and `string` rules. [^2]
- [Package syscall/js (go1.27.4)](https://pkg.go.dev/syscall/js@go1.27.4) — Go team, 2026. Rank 1. Backs: experimental status and compatibility exemption, `Global`, `Get`/`Set`/`Call`/`ValueOf`, `FuncOf` callbacks and deadlocks, `Release`. [^3]
- [Command go](https://pkg.go.dev/cmd/go) — Go team, living. Rank 1. Backs: `GOWASM` values and the `wasm.satconv`/`wasm.signext` build tags. [^4]
- [Go 1.11 Release Notes](https://go.dev/doc/go1.11) — Go team, 2018. Rank 1. Backs: the experimental js/wasm port, one module with the runtime, about 2 MB minimum, the `_js.go`/`_wasm.go` file rule. [^5]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: `//go:wasmimport`, the experimental wasip1 port, the `_wasip1.go` file rule. [^6]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: `//go:wasmexport`, `-buildmode=c-shared` reactors, more `wasmimport` types, `lib/wasm`, lower initial memory. [^7]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: sign-extension and saturating conversions always used, `GOWASM` settings ignored; smaller heap increments. [^8]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: `simd/archsimd` with WebAssembly 128-bit SIMD under `GOEXPERIMENT=simd`. [^9]
- [lib/wasm/wasm_exec.js at go1.27.4](https://github.com/golang/go/blob/go1.27.4/lib/wasm/wasm_exec.js) — Go team, 2026. Rank 1. Backs: the global `Go` class, `importObject` with `gojs`, `run(instance)`. [^10]
- [misc/wasm/wasm_exec.html at go1.27.4](https://github.com/golang/go/blob/go1.27.4/misc/wasm/wasm_exec.html) — Go team, 2026. Rank 1. Backs: the loader page: `new Go()`, `instantiateStreaming` with `go.importObject`, `go.run`. [^11]
- [lib/wasm/go_wasip1_wasm_exec at go1.27.4](https://github.com/golang/go/blob/go1.27.4/lib/wasm/go_wasip1_wasm_exec) — Go team, 2026. Rank 1. Backs: the `GOWASIRUNTIME` cases, the `wasmtime` default, the mount flags each runtime gets. [^12]
- [src/net/net_fake.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/net/net_fake.go) — Go team, 2026. Rank 1. Backs: fake networking for js/wasm and wasip1/wasm, meant to let tests pass. [^13]
- [src/net/http/roundtrip_js.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/net/http/roundtrip_js.go) — Go team, 2026. Rank 1. Backs: `RoundTrip` on js/wasm uses the Fetch API. [^14]
- [wazero README at v1.12.0](https://github.com/tetratelabs/wazero/blob/v1.12.0/README.md) — wazero project, 2026. Rank 1. Backs (about wazero only): written in Go, zero dependencies, no cgo. [^15]
- [wazero CLI README at v1.12.0](https://github.com/tetratelabs/wazero/blob/v1.12.0/cmd/wazero/README.md) — wazero project, 2026. Rank 1. Backs (about wazero only): `wazero run <module> <args>`. [^16]
- [WASI support in Go](https://go.dev/blog/wasi) — Go blog, 2023. Rank 4. Backs: what WASI is and the `wasip1` name, example hosts, `lib/wasm` and `misc/wasm`, `GOWASIRUNTIME`, `go:wasmimport` in the runtime, single-threaded limits, no socket creation. [^17]
- [Extensible Wasm Applications with Go](https://go.dev/blog/wasmexport) — Go blog, 2025. Rank 4. Backs: `go:wasmexport`, reactors and `_initialize`, the wazero host pattern, background goroutines, the pointer limitation. [^18]

## Related
- `go/learning-path.md` — where this doc sits in the learning order.
- `go/low-level/unsafe-and-cgo.md` — the other way Go talks to foreign code, and `unsafe.Pointer`.
- `go/tooling/go-command-and-build-reference.md` — `GOOS`/`GOARCH`, build constraints and file-name suffixes.
- `go/runtime/scheduler-and-goroutine-stacks.md` — the scheduler that runs goroutines on Wasm's single thread.
- `go/standard-library/net-http.md` — the HTTP client and server that behave differently on Wasm.
- `rust/ecosystem/no-std-embedded-and-webassembly.md` — Rust's Wasm targets, for comparison.
- `deno/advanced/ffi-and-webassembly.md` — loading Wasm modules from a JavaScript runtime.
