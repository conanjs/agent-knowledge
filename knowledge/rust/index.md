---
schema: topic-index/v1
kind: topic
topic: rust
last-updated: 2026-11-24
---

# Rust, the language

The Rust language from the basics to advanced use, written in our own words. The backbone is the 21 chapters of The Rust Programming Language (the Rust Book), one subtopic per group of chapters: toolchain and syntax, ownership and borrowing, structs and enums, collections and strings, errors, traits and generics, closures and iterators, project structure and testing, smart pointers, threads, async. Advanced subtopics go past the Book: atomics and memory ordering, `Pin` and the Tokio runtime, unsafe code and the Rustonomicon, macros, performance and the compiler pipeline, API design and type-driven design, serde, `no_std` and WebAssembly. Every behaviour was run in Rust 1.100.0 (edition 2024) in the lab described in `linux/lab-setup.md`. Not covered: specific web frameworks, GUI toolkits, or crates beyond the ones each doc names.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [learning-path.md](learning-path.md) | reference | Nine stages with an exercise and self-check each, a map of every Rust Book chapter and section to its doc, the advanced docs and their sources, and where the online Book lags Rust 1.100 | verified |

## Subtopics
| Subtopic | Summary |
|---|---|
| [fundamentals/](fundamentals/index.md) | rustup, Cargo and editions; variables, scalar and compound types, integer overflow, expressions, control flow |
| [ownership/](ownership/index.md) | Moves, `Copy`/`Clone`, drop order; borrowing, slices; lifetimes and elision; borrow-checker error codes |
| [data-modeling/](data-modeling/index.md) | Structs and methods; enums, `Option`, `match`, patterns and binding modes |
| [collections/](collections/index.md) | `Vec`, `HashMap` and the other std collections; `String`, `&str` and UTF-8 |
| [errors/](errors/index.md) | `panic!` versus `Result`, the `?` operator; error types, `Error::source`, `thiserror` and `anyhow` |
| [traits-and-generics/](traits-and-generics/index.md) | Generics and monomorphization, traits, trait objects and vtables, advanced traits, the core traits catalog |
| [closures-and-iterators/](closures-and-iterators/index.md) | Closure captures and the `Fn` traits; the `Iterator` trait, adapters and laziness |
| [project-structure/](project-structure/index.md) | Packages, crates and modules; Cargo workspaces, features and profiles; testing; building a command-line tool and a single-threaded HTTP server |
| [smart-pointers/](smart-pointers/index.md) | `Box`, `Deref` and `Drop`; `Rc`, `RefCell`, `Cell`, `Weak` and interior mutability |
| [concurrency/](concurrency/index.md) | Threads, channels, locks, `Send`/`Sync`; atomics and memory ordering; building a spin lock, channel and `Arc` |
| [async/](async/index.md) | Futures and `async`/`await`; `Pin` and `Unpin`; the Tokio runtime, tasks and cancellation |
| [unsafe/](unsafe/index.md) | Unsafe Rust and undefined behaviour, Miri; memory layout and `repr`; variance, `PhantomData` and drop check; FFI |
| [macros/](macros/index.md) | `macro_rules!` declarative macros; procedural macros with `syn` and `quote` |
| [performance/](performance/index.md) | Zero-cost abstractions, measuring and optimizing, profile-guided optimization measured; the compiler pipeline and compile times |
| [design-patterns/](design-patterns/index.md) | Idioms and the Rust API Guidelines; type-driven design (newtype, typestate, builder) |
| [ecosystem/](ecosystem/index.md) | The serde data model; `no_std`, embedded targets and WebAssembly |

## References
- [The Rust Programming Language](https://doc.rust-lang.org/book/) — Steve Klabnik, Carol Nichols, Chris Krycho and the Rust community, living. Backs: topic scope and structure.
- [The Rust Reference](https://doc.rust-lang.org/reference/) — Rust project, living. Backs: topic scope.
- [The Rustonomicon](https://doc.rust-lang.org/nomicon/) — Rust project, living. Backs: advanced unsafe scope.

## Related
- `concurrency/` — cross-language concurrency, including Rust `Send`/`Sync`.
- `error-handling/` — cross-language error design, including the `Result` type.
- `code-documentation/doc-comments.md` — Rust doc comments next to other languages.
- `linux/lab-setup.md` — the lab every example ran in.
