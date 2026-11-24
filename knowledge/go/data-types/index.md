---
schema: topic-index/v1
kind: subtopic
topic: go/data-types
last-updated: 2026-11-24
---

# Go data types: slices, maps, strings and structs

Go's composite data types and how they behave in memory: arrays as values and slices as headers over arrays (`append`, capacity, aliasing, `copy`, `clear`, the `slices` package), maps as references to a Swiss table (nil maps, comma ok, iteration order, concurrent writes, the `maps` package), strings as immutable bytes with UTF-8 runes (`range`, conversions, `strings`, `bytes`, `unicode/utf8`, `strconv`), and structs and pointers (literals, copying, `new`, comparison, padding). Mostly Effective Go's "Data" section and the matching spec sections, every behaviour run in Go 1.27.4. Not covered: methods and embedding (see `go/methods-interfaces/`), channels (see `go/concurrency/`), JSON encoding of structs (see `go/standard-library/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [arrays-and-slices.md](arrays-and-slices.md) | concept | Arrays are values, slices are (pointer, len, cap) headers; `append` growth from `runtime/slice.go`, aliasing between slices of one array, full slice expressions, `copy`, nil vs empty, `clear` and the `slices` package | verified |
| [maps.md](maps.md) | concept | Nil maps read but panic on write, comma ok, unspecified iteration order, non-addressable elements, comparable keys and NaN, `fatal error: concurrent map writes`, the `maps` package, and the Go 1.24 Swiss-table implementation | verified |
| [strings-bytes-and-runes.md](strings-bytes-and-runes.md) | concept | Strings are immutable bytes; `len`, indexing and slicing work on bytes while `range` decodes UTF-8 runes (U+FFFD for bad bytes); conversions, `strings.Builder`, and key functions of `strings`, `bytes`, `unicode/utf8`, `strconv` | verified |
| [structs-and-pointers.md](structs-and-pointers.md) | concept | Keyed literals (promoted-field keys in Go 1.27), copying semantics, pointers without arithmetic, `new(T)` and `new(expr)` (Go 1.26), safe `&local`, comparability and map keys, tags, padding and alignment measured with `unsafe` | verified |

## References
- [Effective Go: Data](https://go.dev/doc/effective_go#data) — Go team, living. Backs: subtopic scope.
- [The Go Programming Language Specification: Types](https://go.dev/ref/spec#Types) — Go team, living. Backs: subtopic scope.

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `go/fundamentals/` — basic types, constants and control flow that these docs build on.
- `algorithms/data-structures/` — data structures in general, including hash tables.
