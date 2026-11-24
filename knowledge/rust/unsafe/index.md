---
schema: topic-index/v1
kind: subtopic
topic: rust/unsafe
last-updated: 2026-11-24
---

# Unsafe Rust

What `unsafe` permits and what it does not, the list of undefined behaviour (UB), soundness and safe abstractions over raw pointers, and checking unsafe code with Miri under Stacked Borrows and Tree Borrows; how types sit in memory (`repr(Rust)`, `repr(C)`, `repr(transparent)`, `repr(packed)`, niches, zero-sized and dynamically sized types, `MaybeUninit`, `ManuallyDrop`, leaking); variance, `PhantomData`, drop check, exception safety and leak amplification; and calling C from Rust and Rust from C (`unsafe extern`, `#[unsafe(no_mangle)]`, `CString`/`CStr`, callbacks, `"C-unwind"`). It follows The Rust Programming Language ch 20.1 and goes on with the Rustonomicon, the Reference and the Unsafe Code Guidelines. Every behaviour ran in Rust 1.100.0 (edition 2024), Miri on nightly 1.102.0, and gcc 14.2.0 on aarch64, in the lab described in `linux/lab-setup.md`. Not covered: atomics and memory orderings (`rust/concurrency/`), `Pin` (`rust/async/`), inline assembly, and `no_std` targets (`rust/ecosystem/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [unsafe-rust-and-undefined-behavior.md](unsafe-rust-and-undefined-behavior.md) | concept | The unsafe operations, what `unsafe` keeps checking, the UB list, validity versus safety invariants, soundness, `SAFETY:` comments, edition-2024 changes, Miri reports for six kinds of UB | verified |
| [memory-layout-and-repr.md](memory-layout-and-repr.md) | concept | Size and alignment, field reordering, `repr(C)`/`transparent`/`packed`/`u8`/`align`, niches and `Option` sizes, ZSTs, wide pointers, `MaybeUninit`, `ManuallyDrop`, `mem::forget` | verified |
| [variance-phantomdata-and-drop-check.md](variance-phantomdata-and-drop-check.md) | concept | Lifetime subtyping, the variance table checked by compiling, `PhantomData` markers and auto traits, drop check and `#[may_dangle]`, exception safety, leak amplification | verified |
| [ffi-and-c-interop.md](ffi-and-c-interop.md) | concept | Linking a C file through `build.rs`, `unsafe extern` and `safe fn`, exporting with `#[unsafe(no_mangle)]`, FFI-safe types, `CString`/`CStr`, callbacks and `qsort`, `"C"` versus `"C-unwind"` panics, bindgen and cbindgen | verified |

## References
- [Unsafe Rust](https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html) — The Rust Programming Language, Steve Klabnik, Carol Nichols, Chris Krycho and the Rust community, living. Backs: subtopic scope.
- [Introduction](https://doc.rust-lang.org/nomicon/) — The Rustonomicon, Rust project, living. Backs: subtopic scope beyond the Book.
- [Glossary](https://rust-lang.github.io/unsafe-code-guidelines/glossary.html) — Unsafe Code Guidelines Reference, Rust project, living. Backs: soundness and invariant terms.

## Related
- `rust/index.md` — the Rust topic.
- `rust/concurrency/atomics-and-memory-ordering.md` — data-race-free shared state with atomics.
- `rust/async/pin-and-unpin.md` — self-referential types and `Pin`.
- `concurrency/shared-state-and-data-races.md` — data races across languages.
