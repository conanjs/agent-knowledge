---
schema: topic-index/v1
kind: subtopic
topic: rust/data-modeling
last-updated: 2026-11-24
---

# Rust data modeling: structs and enums

How Rust defines its own data types, matching chapters 5, 6 and 19 of The Rust Programming Language: named, tuple and unit-like structs, struct update syntax and the move it causes, `impl` blocks, method receivers from `&self` to `self: Box<Self>`, associated functions and constants, `#[derive(Debug)]` and `dbg!`; then enums with data, `Option`, exhaustive `match`, `if let`, `let … else`, `while let` and let chains, every pattern form, refutability, binding modes (match ergonomics) and the edition-2024 reservations, `matches!` and `#[non_exhaustive]` across crates. Every behaviour ran in Rust 1.100.0 in the lab. Not covered: traits and generics (see `rust/traits-and-generics/`), memory layout of structs and enums (see `rust/unsafe/memory-layout-and-repr.md`), `Result` and `?` (see `rust/errors/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [structs-and-methods.md](structs-and-methods.md) | concept | Three struct shapes, whole-binding mutability, `..base` moving non-`Copy` fields (E0382 partially moved), receivers and their errors (E0596, E0599), auto-referencing, associated items, `Debug` and `dbg!` | verified |
| [enums-and-pattern-matching.md](enums-and-pattern-matching.md) | concept | Variants with data, `Option`, exhaustive `match` (E0004), `if let`/`let … else`/`while let`/let chains, pattern forms, refutability (E0005), match ergonomics and the 2024 errors, `#[non_exhaustive]` across crates | verified |

## References
- [The Rust Programming Language](https://doc.rust-lang.org/book/) — Klabnik, Nichols, Krycho and the Rust community, living. Backs: subtopic scope (chapters 5, 6, 19).
- [Patterns](https://doc.rust-lang.org/reference/patterns.html) — The Rust Reference, living. Backs: pattern scope.

## Related
- `rust/index.md` — the Rust topic and its subtopics.
- `rust/ownership/` — moves and borrows that patterns and receivers rely on.
- `software-design/functional-modeling/types-as-rules.md` — modeling with tagged unions, across languages.
