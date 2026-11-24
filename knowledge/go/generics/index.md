---
schema: topic-index/v1
kind: subtopic
topic: go/generics
last-updated: 2026-11-24
---

# Go generics

Type parameters (Go 1.18) from the basics to Go 1.27: constraints as interfaces, type sets with `~T` and unions, `comparable` and its Go 1.20 rule, `cmp.Ordered`, the zero value of `T`, the removal of core types from the spec (Go 1.25) and when to use generics at all; then generic types and their methods, Go 1.27 generic methods and their limits, generic type aliases (Go 1.24), self-referential constraints (Go 1.26) and how type inference solves type equations, with the Go 1.21 and Go 1.27 improvements. Covers the Generics chapter of A Tour of Go. Not covered: the generic iterator types of the standard library (see `go/standard-library/iterators.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [type-parameters-and-constraints.md](type-parameters-and-constraints.md) | concept | Type parameter lists, constraints and type sets, `~T`, unions, `comparable`, `cmp.Ordered`, permitted operations, core types removed, when to use generics | verified |
| [generic-types-methods-and-inference.md](generic-types-methods-and-inference.md) | concept | Generic types and receivers, Go 1.27 generic methods, generic aliases, self-referential constraints, instantiation and type inference | verified |

## References
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Backs: subtopic scope (§Type parameter declarations, §Type constraints, §Type inference).
- [An Introduction To Generics](https://go.dev/blog/intro-generics) — Go team, 2022. Backs: subtopic scope.

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `go/methods-interfaces/interfaces.md` — interfaces as values.
- `go/standard-library/iterators.md` — `iter.Seq` and range-over-func.
