---
schema: topic-index/v1
kind: subtopic
topic: go/low-level
last-updated: 2026-11-24
---

# Low-level Go: reflection, `unsafe`, cgo and WebAssembly

The parts of Go that step past static typing and memory safety: run-time reflection with `reflect` (the three laws, `Type` versus `Kind`, settability, struct tags, the Go 1.26 iterator methods, calls by name and their measured cost), and `unsafe` and cgo (memory layout and padding, the six valid `unsafe.Pointer` patterns, why `uintptr` is not a reference, zero-copy strings, `go vet`'s `unsafeptr` check, the cgo preamble, `C.CString` and `C.free`, pointer-pinning rules, `CGO_ENABLED` and cross-compiling, `//go:linkname`), and WebAssembly (the `js/wasm` and `wasip1` ports, `//go:wasmimport` and `//go:wasmexport`). Every behaviour was run in Go 1.27.4 with gcc. Not covered: interface values and type switches (see `go/methods-interfaces/`), generics (see `go/generics/`), assembly.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [reflection.md](reflection.md) | concept | The laws of reflection, `Type` and `Kind`, settability through pointers, struct tags with `Get`/`Lookup`, `Value.Fields` (Go 1.26), `Call` and `MethodByName`; reflected field writes about 18× and calls about 75× slower than direct ones in the lab | verified |
| [webassembly.md](webassembly.md) | concept | The `js/wasm` and `wasip1` ports, `wasm_exec.js` and `syscall/js`, `//go:wasmimport` and `//go:wasmexport` reactors, `GOWASM`, and WebAssembly's limits, run on the wazero runtime | verified |
| [unsafe-and-cgo.md](unsafe-and-cgo.md) | concept | `Sizeof`/`Alignof`/`Offsetof` and padding, the valid `unsafe.Pointer` patterns, `unsafe.String`/`SliceData`, `go vet` `unsafeptr`; cgo preamble, `C.CString`/`C.free`, pinning rules and `cgocheck`, `CGO_ENABLED` and cross-compiling, about 30–50 ns per cgo call in the lab | verified |

## References
- [Package reflect](https://pkg.go.dev/reflect) — Go team, living. Backs: subtopic scope (reflection).
- [Package unsafe](https://pkg.go.dev/unsafe) — Go team, living. Backs: subtopic scope (`unsafe`).
- [Command cgo](https://pkg.go.dev/cmd/cgo) — Go team, living. Backs: subtopic scope (cgo).

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `go/runtime/` — the scheduler, allocator and garbage collector these tools interact with.
- `go/methods-interfaces/` — interface values, which reflection reads.
