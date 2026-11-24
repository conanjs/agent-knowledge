---
schema: topic-index/v1
kind: subtopic
topic: rust/ownership
last-updated: 2026-11-24
---

# Ownership, borrowing and lifetimes

How Rust manages memory without a garbage collector: one owner per value, moves and `Copy`, the exact order in which values and temporaries are dropped (including the edition 2024 changes), shared and mutable borrows with NLL (non-lexical lifetimes), two-phase borrows and reborrowing, slices, lifetime annotations and elision, `'static` and `T: 'static`, edition 2024 `impl Trait` capture rules, and a lookup table of the borrow-checker error codes. Consolidates The Rust Programming Language chapter 4 and section 10.3. Not covered: run-time checked borrowing with `RefCell` (see `rust/smart-pointers/`), variance and drop check (`rust/unsafe/`), closures' captures (`rust/closures-and-iterators/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [ownership-moves-and-drop.md](ownership-moves-and-drop.md) | concept | Stack and heap, the three ownership rules, moves versus `Copy` and `Clone`, partial moves, drop order of locals, fields, parameters and temporaries, edition 2024 temporary scopes | verified |
| [borrowing-references-and-slices.md](borrowing-references-and-slices.md) | concept | `&` and `&mut`, aliasing XOR mutation, NLL and what it still rejects, two-phase borrows, reborrowing, disjoint borrows, dangling prevention, `&[T]` and `&str` | verified |
| [lifetimes.md](lifetimes.md) | concept | Lifetime annotations, the three elision rules, structs that borrow, lifetime bounds, `'static` and `T: 'static`, trait-object lifetimes, edition 2024 `impl Trait` capture and `use<..>` | verified |
| [borrow-checker-errors.md](borrow-checker-errors.md) | reference | E0106, E0184, E0204, E0310, E0373, E0381, E0382, E0384, E0499, E0502, E0503, E0505, E0506, E0507, E0508, E0509, E0515, E0521, E0594, E0596, E0597, E0621, E0700, E0716: first line, minimal trigger, fix | verified |

## References
- [Understanding Ownership](https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: subtopic scope (chapter 4).
- [Validating References with Lifetimes](https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html) — The Rust Programming Language, living. Backs: subtopic scope (section 10.3).
- [Rust error codes index](https://doc.rust-lang.org/error_codes/error-index.html) — Rust project, living. Backs: the error catalog.

## Related
- `rust/learning-path.md` — where this subtopic sits in the learning order.
- `rust/smart-pointers/` — `Box`, `Rc`, `RefCell`: ownership and borrowing beyond the compile-time rules.
- `rust/unsafe/` — variance, drop check and memory layout.
