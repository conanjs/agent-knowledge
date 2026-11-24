---
schema: topic-index/v1
kind: subtopic
topic: go/methods-interfaces
last-updated: 2026-11-24
---

# Go methods and interfaces

Methods and their receivers (value or pointer), method sets, the automatic `&` and `*` on calls, method values and method expressions, struct embedding and promotion by depth; then interfaces: implicit satisfaction, interface values as a (type, value) pair, the nil-interface trap, type assertions and type switches, `any`, comparison panics, compile-time implementation checks and the runtime's `iface`/`eface` layout. Covers Effective Go's Methods, Interfaces and other types, and Embedding sections, and the Methods and interfaces chapter of A Tour of Go. Not covered: interfaces as constraints for type parameters (see `go/generics/`), reflection on interface values (see `go/low-level/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [methods-and-embedding.md](methods-and-embedding.md) | concept | Receivers and method sets, `(&x).m()` shorthand, method values and expressions, embedding, promotion and the depth rule, embedded interfaces | verified |
| [interfaces.md](interfaces.md) | concept | Implicit satisfaction, the (type, value) pair and typed nil, type assertions and switches, `any`, comparison and map-key panics, `var _ I = (*T)(nil)`, itabs | verified |

## References
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Backs: subtopic scope (§Method declarations, §Method sets, §Interface types).
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Backs: subtopic scope.

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `go/generics/` — interfaces as constraints.
- `software-design/oop/composition-over-inheritance.md`, `software-design/oop/polymorphism.md` — the design view across languages.
