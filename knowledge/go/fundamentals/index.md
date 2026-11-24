---
schema: topic-index/v1
kind: subtopic
topic: go/fundamentals
last-updated: 2026-11-24
---

# Go fundamentals

How source text becomes tokens (comments, identifiers, keywords, literals and escapes) and where semicolons are inserted automatically; variables (`var`, `:=`), zero values, the basic types and explicit conversions, constants (untyped constants, default types, `iota`), compile-time versus run-time overflow, scope and shadowing, the blank identifier, `min` and `max`; then `if`, `switch` (no implicit fall-through, tagless form), the `for` forms and `range`, per-iteration loop variables (Go 1.22), labels and `goto`, functions with multiple and named results, variadic parameters, closures and `defer`. Not covered: composite types such as slices, maps and structs (see `go/data-types/`), type switches (see `go/methods-interfaces/`), iterators (see `go/standard-library/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [declarations-types-and-constants.md](declarations-types-and-constants.md) | concept | `var` and `:=`, zero values, sized and platform-sized integers, explicit conversions, untyped constants and default types, `iota`, compile-time overflow errors versus run-time wrap-around, shadowing, `min`/`max` | verified |
| [lexical-elements-and-semicolons.md](lexical-elements-and-semicolons.md) | concept | Source text and tokens, comments, the two semicolon-insertion rules and their layout consequences, `gofmt`'s rewrites, integer, floating-point, hexadecimal-float and imaginary literals (Go 1.13 prefixes and `_`), rune and string literals with every legal and illegal escape, raw strings dropping `\r` | verified |
| [control-flow-and-functions.md](control-flow-and-functions.md) | concept | `if`/`switch` with init statements, `fallthrough`, tagless switch, the `for` forms and `range`, Go 1.22 per-iteration loop variables, labels and `goto`, multiple and named results, variadic parameters, closures, `defer` order and argument evaluation | verified |

## References
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Backs: subtopic scope.
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Backs: subtopic scope.

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `go/introduction/` — the toolchain and the `go` line that switches language features on.
- `go/data-types/` — arrays, slices, maps, strings and structs.
