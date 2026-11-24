---
schema: topic-index/v1
kind: subtopic
topic: rust/smart-pointers
last-updated: 2026-11-24
---

# Smart pointers

Types that act like references but own their data: `Box<T>` for single ownership on the heap and recursive types, the `Deref`/`DerefMut` traits and deref coercion, `Drop` and `std::mem::drop`, `Rc<T>` and `Weak<T>` for shared ownership and cycles, and interior mutability with `Cell`, `RefCell`, `OnceCell` and `LazyCell`. Consolidates The Rust Programming Language chapter 15. Not covered: the thread-safe versions `Arc`, `Mutex`, `RwLock`, `OnceLock`, `LazyLock` (see `rust/concurrency/`), `Pin<Box<T>>` (`rust/async/`), trait objects behind `Box<dyn Trait>` (`rust/traits-and-generics/`), and `ManuallyDrop` or leaking (`rust/unsafe/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [box-deref-and-drop.md](box-deref-and-drop.md) | concept | `Box<T>` sizes and uses, recursive types and `E0072`, moving out of a box, `Deref`/`DerefMut`, deref coercion chains, when to implement `Deref`, `Drop` order within a type, `E0040`, `std::mem::drop` | verified |
| [rc-refcell-and-interior-mutability.md](rc-refcell-and-interior-mutability.md) | concept | `Rc` strong and weak counts, `get_mut`/`make_mut`/`try_unwrap`, `Cell`, `RefCell` run-time borrow checks and their panics, `OnceCell`/`LazyCell`, cycles, `Weak` and a tree with parent links | verified |

## References
- [Smart Pointers](https://doc.rust-lang.org/book/ch15-00-smart-pointers.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: subtopic scope (chapter 15).
- [std::cell](https://doc.rust-lang.org/std/cell/index.html) — Rust standard library, living. Backs: the cell types covered.

## Related
- `rust/learning-path.md` — where this subtopic sits in the learning order.
- `rust/ownership/` — the compile-time rules these types extend.
- `rust/concurrency/` — the thread-safe counterparts.
