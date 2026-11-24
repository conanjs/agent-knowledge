---
schema: topic-index/v1
kind: subtopic
topic: rust/fundamentals
last-updated: 2026-11-24
---

# Rust fundamentals

The first steps of Rust, matching chapters 1–3 and appendices D, E and G of The Rust Programming Language: rustup toolchains, channels and components; Cargo's `new`/`check`/`build`/`run` and the two manifest files; editions 2015 to 2024 and `cargo fix --edition`; the prelude and the anatomy of a first program; rustfmt, Clippy and nightly feature flags; then variables, mutability, shadowing, `const` and `static`, the scalar and compound types, integer overflow in debug and release builds, `as` casts, `char`, functions, statements versus expressions and every loop form. Every behaviour ran in Rust 1.100.0 in the lab. Not covered: ownership and borrowing (see `rust/ownership/`), strings (see `rust/collections/strings-and-utf-8.md`), dependency versions and build profiles (see `rust/project-structure/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [toolchain-cargo-and-editions.md](toolchain-cargo-and-editions.md) | concept | rustup proxies and toolchain precedence, Cargo calling rustc, `Cargo.toml` vs `Cargo.lock`, editions measured, the prelude, a first program, rustfmt/Clippy/`cargo fix`, nightly feature flags and E0554 | verified |
| [variables-types-and-control-flow.md](variables-types-and-control-flow.md) | concept | `let`/`mut`/shadowing, `const` vs `static`, scalar sizes, overflow panic in debug vs wrap in release, `as` cast rules measured, `char`, tuples and arrays, expressions, `loop` with `break` value, labels and labelled blocks | verified |

## References
- [The Rust Programming Language](https://doc.rust-lang.org/book/) — Klabnik, Nichols, Krycho and the Rust community, living. Backs: subtopic scope (chapters 1–3, appendices D, E, G).
- [The Rust Edition Guide](https://doc.rust-lang.org/edition-guide/) — Rust project, living. Backs: editions scope.

## Related
- `rust/index.md` — the Rust topic and its subtopics.
- `rust/ownership/` — the next subtopic in the learning order.
- `linux/lab-setup.md` — the lab every example ran in.
