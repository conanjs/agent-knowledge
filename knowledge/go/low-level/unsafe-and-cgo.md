---
schema: knowledge-doc/v1
type: concept
topic: go/low-level
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "unsafe.String, StringData, SliceData: Go ≥ 1.20; unsafe.Slice and unsafe.Add: Go ≥ 1.17", "//go:linkname restriction: Go ≥ 1.23", "linux/arm64 lab with gcc; numbers are from one machine"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, unsafe, unsafe-pointer, uintptr, memory-layout, padding, cgo, c-interop, go-vet, linkname, cross-compiling]
ranked-sources: true
---

# `unsafe` and cgo: stepping outside Go's type and memory safety

## Summary
**TL;DR:** `unsafe.Pointer` can be converted to and from any pointer type and `uintptr`, which lets code reinterpret memory, but only six documented patterns are valid; everything else may break now or in a later release. A `uintptr` is just an integer: it neither keeps an object alive nor follows it, so the conversion back to a pointer must happen in the same expression. `Sizeof`, `Alignof` and `Offsetof` show the memory layout, including padding. Cgo (`import "C"`) calls C code: C strings made with `C.CString` must be freed with `C.free`, Go pointers passed to C must point to pinned memory with no unpinned Go pointers inside, and each call costs about 30–50 ns in the lab against about 2.4 ns for a Go call.
**Use this when:** you read or review code that imports `unsafe` or `"C"`, need zero-copy conversions, wrap a C library, see `possible misuse of unsafe.Pointer` from `go vet`, or a build fails with `build constraints exclude all Go files` when cross-compiling.
**Not this doc:** reflection → `go/low-level/reflection.md`; how goroutine stacks grow by copying, one reason a stored `uintptr` goes stale → `go/runtime/scheduler-and-goroutine-stacks.md`; `CGO_ENABLED` among other build settings → `go/tooling/go-command-and-build-reference.md`.

## Problem
Go's guarantees (memory safety, a moving-stack runtime, a precise garbage collector) are also limits: you cannot view a `float64`'s bits as a `uint64`, turn a `[]byte` into a `string` without copying, or call a C library directly. `unsafe` and cgo remove those limits, and with them the guarantees. Code that "works" can read freed memory after the GC runs, change a string that other code assumes never changes, crash the program from C, or stop cross-compiling.

## Mental model
**Analogy:** `unsafe.Pointer` is a master key that opens any door (type). A `uintptr` is a house number written on paper: it says where something was, but the city (the garbage collector) does not know about your paper, so it may demolish the house or move it to another street, and your paper does not change. The only safe moment to use the paper is the same instant you write it. Cgo is a border crossing to a country (C) with different laws: what you send across must not hold pointers the other side may keep, and what C allocates (malloc) Go's GC never cleans up.

**Artifact:** memory layout reported by `unsafe` in the lab ✅[^1], as shown below:
```go
type Loose struct { A bool; B int64; C bool } // size 24: A, 7 bytes padding, B, C, 7 bytes padding
type Tight struct { B int64; A bool; C bool } // size 16: same fields, less padding
// unsafe.Offsetof(l.B) == 8, unsafe.Offsetof(l.C) == 16, unsafe.Alignof(l) == 8
// unsafe.Sizeof([]int{}) == 24, unsafe.Sizeof(any(nil)) == 16, unsafe.Sizeof("") == 16
```

## How it works
1. **Layout functions.** `Sizeof(x)` is the size of a variable of `x`'s type, including padding for field alignment but not memory the value points to (for a slice, the descriptor only) ✅[^2]. `Alignof(x)` is the required alignment, and `Offsetof(s.f)` is the byte offset of field `f`; all three are compile-time constants unless the type has variable size (a type parameter, for example) ✅[^2].
2. **The four special conversions.** Any pointer converts to `unsafe.Pointer` and back to any pointer type, and `unsafe.Pointer` converts to and from `uintptr`; this defeats the type system and should be used with extreme care ✅[^2].
3. **The valid patterns.** Code outside these is likely invalid now or later ✅[^2]:
   1. `*T1` → `Pointer` → `*T2`, when `T2` is no larger than `T1` and the layouts are equivalent; `math.Float64bits` is written this way ✅[^2].
   2. `Pointer` → `uintptr` (not back), usually to print an address ✅[^2].
   3. `Pointer` → `uintptr` → arithmetic → `Pointer` in **one expression**, staying inside the same allocated object; pointing just past the end is invalid, unlike C ✅[^2]. `unsafe.Add(ptr, len)` (Go 1.17) does the arithmetic directly ✅[^2].
   4. `uintptr(unsafe.Pointer(p))` written directly in the argument list of `syscall.Syscall` and similar assembly functions, which keeps the object alive and in place until the call returns ✅[^2].
   5. The result of `reflect.Value.Pointer` or `UnsafeAddr` converted to `Pointer` immediately, in the same expression ✅[^2].
   6. `reflect.SliceHeader`/`StringHeader` `Data` fields, only through a pointer to a real slice or string ✅[^2]. Both types are deprecated; new code uses `unsafe.Slice`/`SliceData` or `unsafe.String`/`StringData` instead ✅[^8].
4. **Why `uintptr` is fragile.** A `uintptr` is an integer with no pointer meaning: the GC does not update it when the object moves and does not keep the object from being reclaimed ✅[^2]. Storing it in a variable before converting back is listed as invalid ✅[^2]. Go 1.25's extra stack allocation of slices can amplify the effects of incorrect `unsafe.Pointer` use ✅[^7].
5. **Zero-copy strings and slices.** `unsafe.String(ptr, len)` builds a string over existing bytes, and `unsafe.StringData(s)` returns a pointer to a string's bytes (both Go 1.20); because strings are immutable, those bytes must not be modified while the string exists ✅[^2]. `unsafe.Slice(ptr, len)` builds a slice over an array, and `unsafe.SliceData(s)` returns its backing array pointer ✅[^2].
6. **Checking.** `go vet` includes an `unsafeptr` check for invalid `uintptr` to `unsafe.Pointer` conversions ✅[^4]; silence from `go vet` does not prove the code is valid ✅[^2].
7. **Cgo: the preamble.** A comment directly above `import "C"` is the preamble, compiled as a C header; its functions, types and variables are used as `C.name`, even lower-case ones, except `static` variables ✅[^3].
8. **Cgo: copying data across.** `C.CString(s)` copies a Go string into C memory allocated with `malloc`; the caller must free it, for example with `C.free` (include `stdlib.h`) ✅[^3]. `C.GoString` copies a C string back into a Go string ✅[^3].
9. **Cgo: pointer rules.** Go pointers passed to C must point to pinned memory; arguments are pinned implicitly for the duration of the call, and `runtime.Pinner` can pin longer ✅[^3]. The memory must not contain Go pointers to unpinned memory, and C must not keep a Go pointer after the call returns unless it is pinned ✅[^3]. The runtime checks this with `GODEBUG=cgocheck=1` (the default); `GOEXPERIMENT=cgocheck2` checks completely at a run-time cost ✅[^3].
10. **Cgo: when it is on.** Cgo is enabled by default for native builds where a C compiler is found and disabled by default when cross-compiling; `CGO_ENABLED=1` or `0` overrides that ✅[^3]. Files that `import "C"` carry an implicit `//go:build cgo` constraint, so with cgo off they are not built at all ✅[^3].
11. **Cgo: cost.** Go 1.26 cut the baseline runtime overhead of a cgo call by about 30% ✅[^6].
12. **`//go:linkname` (Go ≥ 1.23).** The linker refuses `//go:linkname` references to standard-library internal symbols that are not themselves marked with `//go:linkname`; existing uses found in a large open-source corpus stay allowed, and `-checklinkname=0` turns the check off for debugging ✅[^5].

## Worked example
One program that uses three valid patterns and then breaks a rule on purpose ✅[^1], as shown below:
```go
func Float64bits(f float64) uint64 { return *(*uint64)(unsafe.Pointer(&f)) } // pattern 1

arr := [4]int32{10, 20, 30, 40}
third := *(*int32)(unsafe.Pointer(uintptr(unsafe.Pointer(&arr[0])) + 2*unsafe.Sizeof(arr[0]))) // pattern 3
fourth := *(*int32)(unsafe.Add(unsafe.Pointer(&arr[0]), 3*unsafe.Sizeof(arr[0])))              // unsafe.Add

b := []byte("hello")
str := unsafe.String(unsafe.SliceData(b), len(b)) // zero-copy view
b[0] = 'J'                                       // breaks the "never modify" rule
```
```console
Float64bits(1.0) = 0x3ff0000000000000
third element: 30
via unsafe.Add: 40
string view: hello same memory: true
after writing b[0]: Jello
```
The "immutable" string changed because it shares memory with `b` ✅[^1]; the documentation forbids exactly this ✅[^2].

A cgo call, with the C string freed by the caller ✅[^1], as shown below:
```go
/*
#include <stdlib.h>
#include <string.h>
static size_t c_len(const char *s) { return strlen(s); }
*/
import "C"

cs := C.CString("hello, C")      // malloc'd copy in C memory
defer C.free(unsafe.Pointer(cs)) // Go's GC never frees it
fmt.Println(C.c_len(cs))         // 8
```
A benchmark of `C.add(1, 2)` against a non-inlined Go `add(1, 2)`, three runs each: 31–50 ns per cgo call against 2.4–2.5 ns per Go call ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `u := uintptr(unsafe.Pointer(&arr[0]))` then `unsafe.Pointer(u + 8)` | `go vet` reports `possible misuse of unsafe.Pointer` and exits 1; the program still ran and printed `2` ✅[^1] | Storing the `uintptr` first is an invalid pattern; it can fail when the GC moves or frees the array ✅[^2] |
| Pointer arithmetic to one past the end of an array | Invalid, unlike in C ✅[^2] | The result must stay inside the original allocation ✅[^2] |
| Passing a struct that holds a Go pointer to a C function | `panic: runtime error: argument of cgo function has Go pointer to unpinned Go pointer` ✅[^1] | The default `cgocheck=1` rule ✅[^3] |
| `CGO_ENABLED=0 go build` on a package whose files import `"C"` | `build constraints exclude all Go files` ✅[^1] | Those files have an implicit `cgo` build constraint ✅[^3] |
| `GOARCH=amd64 go build` on the arm64 lab | `go env CGO_ENABLED` printed `0`, and the cgo package failed the same way ✅[^1] | Cgo is off by default when cross-compiling; a C cross-compiler is needed to turn it on ✅[^3] |
| A `static` variable in the preamble | Cannot be used from Go; `static` functions can ✅[^3] | A documented exception ✅[^3] |
| `unsafe.String(nil, 3)` or a negative length | Run-time panic ✅[^2] | Documented checks on `ptr` and `len` ✅[^2] |
| `unsafe.Sizeof` on a slice or interface | 24 and 16 bytes on 64-bit, never the data they reference ✅[^1] ✅[^2] | Only the descriptor is measured ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `unsafe` zero-copy conversions | No copy: the string shared the slice's memory in the lab ✅[^1] | The bytes must never change ✅[^2]; a write changes the string silently ✅[^1] |
| Field order chosen for size (`Tight` vs `Loose`) | 16 instead of 24 bytes per value in the lab ✅[^1] | Fields are grouped by size rather than by meaning |
| Cgo | Reuse a C library as is | About 30–50 ns per call in the lab ✅[^1], a C toolchain for every target, harder cross-compiling ✅[^3] |
| Pure Go (`CGO_ENABLED=0`) | Cross-compiling needs no C cross-compiler ✅[^3] | No C libraries |

## Takeaways
- Keep every `uintptr` → `unsafe.Pointer` conversion in the same expression as the arithmetic or call that needs it, and run `go vet` on code that imports `unsafe`. [rule-candidate]
- Never modify bytes that back a string made with `unsafe.String` or read through `unsafe.StringData`. [rule-candidate]
- Free every `C.CString` and `C.CBytes` result with `C.free`, usually with `defer` right after the call. [rule-candidate]
- Batch work per cgo call instead of calling C in a tight loop, and do not pass Go memory that contains Go pointers to C.
- Build with `CGO_ENABLED=0` when you need easy cross-compiling and no C library is involved.

## Verification status
- Verified: 59 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`, gcc 14.2.0 in Debian 13) where every behaviour marked with this note ran on 2026-11-24 (OrbStack, 8 logical CPUs, arm64). [^1]
- [Package unsafe](https://pkg.go.dev/unsafe) — Go team, living. Rank 1. Backs: `Sizeof`, `Alignof`, `Offsetof`; the four conversions; the six valid patterns and the invalid examples; `uintptr` is not a reference; `Add`, `String`, `StringData`, `Slice`, `SliceData`; vet silence is no guarantee. [^2]
- [Command cgo](https://pkg.go.dev/cmd/cgo) — Go team, living. Rank 1. Backs: the preamble and `static` exception; `C.CString`, `C.free`, `C.GoString`; pointer-passing and pinning rules; `cgocheck`; `CGO_ENABLED` defaults, cross-compiling and the implicit `cgo` constraint. [^3]
- [Command vet](https://pkg.go.dev/cmd/vet) — Go team, living. Rank 1. Backs: the `unsafeptr` check. [^4]
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23) — Go team, 2024. Rank 1. Backs: the `//go:linkname` restriction and `-checklinkname=0`. [^5]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: cgo call overhead reduced by about 30%. [^6]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: more stack-allocated slices can amplify incorrect `unsafe.Pointer` use. [^7]
- [Package reflect](https://pkg.go.dev/reflect) — Go team, living. Rank 1. Backs: `SliceHeader` and `StringHeader` are deprecated in favour of `unsafe.Slice`/`SliceData` and `unsafe.String`/`StringData`. [^8]

## Related
- `go/learning-path.md` — where this doc sits in the learning order.
- `go/low-level/reflection.md` — `reflect.Value.Pointer` and `UnsafeAddr`, patterns 5 and 6.
- `go/runtime/memory-allocation-and-gc.md` — the GC that a stored `uintptr` hides from.
- `go/data-types/strings-bytes-and-runes.md` — why strings are immutable.
- `go/data-types/structs-and-pointers.md` — ordinary pointers and struct layout.
- `go/tooling/go-command-and-build-reference.md` — `CGO_ENABLED`, `GOOS` and `GOARCH`.
