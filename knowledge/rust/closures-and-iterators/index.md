---
schema: topic-index/v1
kind: subtopic
topic: rust/closures-and-iterators
last-updated: 2026-11-24
---

# Rust closures and iterators

Closures and the `Fn`/`FnMut`/`FnOnce` traits: how captures are chosen, how the call traits are inferred, `move`, edition-2021 disjoint field capture, returning closures and closure sizes. Iterators: the `Iterator` trait and `next`, laziness, adapters versus consumers, `iter`/`iter_mut`/`into_iter` and `for` loops, arrays across editions, `collect` and `FromIterator`, custom iterators with `size_hint`, `ExactSizeIterator` and `DoubleEndedIterator`, and loop-versus-iterator cost measured in assembly. Covers The Rust Programming Language chapter 13. Not covered: function-pointer types and `dyn Fn` internals (see `rust/traits-and-generics/`), threads (see `rust/concurrency/`), async streams.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [closures-and-fn-traits.md](closures-and-fn-traits.md) | concept | Capture modes, `Fn`/`FnMut`/`FnOnce` inferred from the body, `move` changes capture not traits, disjoint capture in 2021 vs 2018, returning closures, sizes measured, E0525/E0373/E0382/E0596 | verified |
| [iterators.md](iterators.md) | concept | `next` and laziness, pull one item at a time, `into_iter` on `Vec`/`&Vec`/arrays, `for` desugaring, `collect` into `Result` stopping at the first `Err`, a custom iterator, `size_hint`, same assembly as an indexed loop | verified |

## References
- [Functional Language Features: Iterators and Closures](https://doc.rust-lang.org/book/ch13-00-functional-features.html) — The Rust Programming Language (Klabnik, Nichols, Krycho et al.), living. Backs: subtopic scope.
- [Module `std::iter`](https://doc.rust-lang.org/std/iter/index.html) — Rust project, living. Backs: subtopic scope.

## Related
- `rust/index.md` — the Rust topic.
- `rust/errors/` — `Result` and `?`, which iterator chains often produce.
- `javascript/advanced-functions/scope-closures-and-var.md` — closures in JavaScript.
