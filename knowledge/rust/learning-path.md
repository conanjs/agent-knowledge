---
schema: knowledge-doc/v1
type: reference
topic: rust
status: verified
applies-to: ["the docs under knowledge/rust/ as of 2026-11-24", "The Rust Programming Language, version for Rust 1.98.0 or later and edition 2024", "Rust 1.100.0"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, learning-path, curriculum, rust-book]
---

# Rust learning path

## Summary
**TL;DR:** Nine stages from installing the toolchain to writing `unsafe` code, macros and `no_std` firmware. Stages 1–6 follow the 21 chapters of The Rust Programming Language (the Rust Book); stages 7–9 go past it, into the type system, low-level concurrency and unsafe code, macros, performance and the wider ecosystem. Each stage lists the docs to read in order, an exercise to run in the Rust lab, and a self-check. A second table maps every Book chapter and section to the doc that covers it; a third lists the advanced docs and the sources they are built on.
**Use this when:** you start learning Rust, want to know which doc covers a Book chapter, or want to know what to read after the Book.
**Not this doc:** the lab itself → `linux/lab-setup.md`; cross-language concurrency and error design → `concurrency/` and `error-handling/`.

## Scope
The v1 docs under `knowledge/rust/` (16 subtopics, 43 docs) and the current online Rust Book, which says it assumes Rust 1.98.0 or later with edition 2024 ✅[^2]. Chapter and section numbers are the ones in the Book's table of contents on 2026-11-24 ✅[^3]. Every exercise runs in `rustlab:1` (Rust 1.100.0) as described in `linux/lab-setup.md`.

## Catalog

### Stages

| # | Stage | Read (in order) | Exercise | Self-check: you can explain … |
|---|---|---|---|---|
| 1 | Toolchain and basics | `fundamentals/toolchain-cargo-and-editions.md` → `fundamentals/variables-types-and-control-flow.md` | Create a project with `cargo new`; compute `250u8 + 10` from input in a debug build, a release build, and a release build with `-C overflow-checks=on` | … why the release build wraps instead of panicking, and why `let x = { 1; }` is not an integer |
| 2 | Ownership and borrowing | `ownership/ownership-moves-and-drop.md` → `ownership/borrowing-references-and-slices.md` → `ownership/lifetimes.md`; keep `ownership/borrow-checker-errors.md` open | Print the drop order of three locals and a struct's fields; hold `&v[0]` and call `v.push(1)`, then read the error code in the catalog | … why `v.push(v.len())` compiles but `Vec::push(&mut v, v.len())` does not, and why an owned `String` satisfies `T: 'static` |
| 3 | Data modeling and collections | `data-modeling/structs-and-methods.md` → `data-modeling/enums-and-pattern-matching.md` → `collections/vec-hashmap-and-std-collections.md` → `collections/strings-and-utf-8.md` | Parse text commands into an enum and `match` on it; count words with the `HashMap` entry API; slice `"Tiếng Việt"` by bytes and by `char`s | … why `s[0]` does not compile for a `String`, and what match ergonomics does to a `&Option<String>` |
| 4 | Errors, modules and testing | `errors/panic-result-and-error-propagation.md` → `errors/error-types-thiserror-and-anyhow.md` → `project-structure/packages-crates-and-modules.md` → `project-structure/testing.md` → `project-structure/build-a-command-line-tool.md` → `project-structure/build-a-single-threaded-web-server.md` → `project-structure/cargo-workspaces-features-and-profiles.md` | Follow the command-line tool how-to end to end; give it a `thiserror` error enum and one integration test; then follow the web-server how-to and time two clients against `/slow` | … when to `panic!` rather than return `Err`, and how `?` converts an error type |
| 5 | Traits, closures, iterators, smart pointers | `traits-and-generics/generics-and-traits.md` → `closures-and-iterators/closures-and-fn-traits.md` → `closures-and-iterators/iterators.md` → `traits-and-generics/trait-objects-and-dynamic-dispatch.md` → `smart-pointers/box-deref-and-drop.md` → `smart-pointers/rc-refcell-and-interior-mutability.md`; look traits up in `traits-and-generics/core-traits-reference.md` | Implement `Iterator` for your own struct and chain three adapters; build a tree whose children are `Rc<RefCell<_>>` and whose parent links are `Weak` | … which of `Fn`/`FnMut`/`FnOnce` a closure gets and why, and when `dyn Trait` is the better choice than a generic |
| 6 | Threads and async | `concurrency/threads-channels-and-locks.md` → `async/futures-and-async-await.md` → `async/pin-and-unpin.md` → `async/tokio-runtime-tasks-and-cancellation.md` | Write a thread pool that shuts down cleanly when dropped; write a `block_on` executor with only `std`; print which branch `tokio::select!` drops | … why `Rc` is not `Send`, why a future must be pinned before it is polled, and what dropping a future does |
| 7 | Type system and design | `traits-and-generics/advanced-traits-and-type-system.md` → `design-patterns/idioms-and-api-guidelines.md` → `design-patterns/type-driven-design.md` | Write a typestate builder whose `build()` does not compile before every required field is set | … associated types versus generic parameters, and what a higher-ranked trait bound (`for<'a>`) promises |
| 8 | Atomics and unsafe code | `concurrency/atomics-and-memory-ordering.md` → `concurrency/building-a-spinlock-channel-and-arc.md` → `unsafe/unsafe-rust-and-undefined-behavior.md` → `unsafe/memory-layout-and-repr.md` → `unsafe/variance-phantomdata-and-drop-check.md` → `unsafe/ffi-and-c-interop.md` | Build the spin lock and run its tests under Miri, then weaken one ordering to `Relaxed` and watch Miri report the data race | … what `Acquire`/`Release` order and what they do not, and what the author of an `unsafe` block promises |
| 9 | Macros, performance, ecosystem | `macros/declarative-macros.md` → `macros/procedural-macros.md` → `performance/zero-cost-abstractions-and-optimization.md` → `performance/compiler-pipeline-and-compile-times.md` → `ecosystem/serde-data-model.md` → `ecosystem/no-std-embedded-and-webassembly.md` | Write a `macro_rules!` with a repetition and view its expansion; benchmark an iterator chain against an index loop; build a `#![no_std]` library for `thumbv7em-none-eabihf` | … macro hygiene, why `cargo check` is faster than `cargo build`, and what `core` offers without `alloc` |

### Rust Book chapter-to-doc map

| Ch | Book chapter (sections) | Doc(s) under `rust/` |
|---|---|---|
| 1 | Getting Started (1.1 Installation, 1.2 Hello, World!, 1.3 Hello, Cargo!) | `fundamentals/toolchain-cargo-and-editions.md` |
| 2 | Programming a Guessing Game | `fundamentals/toolchain-cargo-and-editions.md` (first-program anatomy) |
| 3 | Common Programming Concepts (3.1 Variables and Mutability, 3.2 Data Types, 3.3 Functions, 3.4 Comments, 3.5 Control Flow) | `fundamentals/variables-types-and-control-flow.md`; doc comments (`///`, `//!`) in `code-documentation/doc-comments.md` |
| 4 | Understanding Ownership (4.1 What is Ownership?) | `ownership/ownership-moves-and-drop.md` |
| 4 | 4.2 References and Borrowing, 4.3 The Slice Type | `ownership/borrowing-references-and-slices.md` |
| 5 | Using Structs to Structure Related Data (5.1–5.3) | `data-modeling/structs-and-methods.md` |
| 6 | Enums and Pattern Matching (6.1 Defining an Enum, 6.2 The match Control Flow Construct, 6.3 Concise Control Flow with if let and let...else) | `data-modeling/enums-and-pattern-matching.md` |
| 7 | Packages, Crates, and Modules (7.1–7.5) | `project-structure/packages-crates-and-modules.md` |
| 8 | Common Collections (8.1 Vectors, 8.3 Hash Maps) | `collections/vec-hashmap-and-std-collections.md` |
| 8 | 8.2 Storing UTF-8 Encoded Text with Strings | `collections/strings-and-utf-8.md` |
| 9 | Error Handling (9.1 panic!, 9.2 Result, 9.3 To panic! or Not to panic!) | `errors/panic-result-and-error-propagation.md`; `Box<dyn Error>` in `errors/error-types-thiserror-and-anyhow.md`; 9.3's idea of a type that checks its value once, at construction, in `design-patterns/type-driven-design.md` |
| 10 | Generic Types, Traits, and Lifetimes (10.1 Generic Data Types, 10.2 Traits) | `traits-and-generics/generics-and-traits.md` |
| 10 | 10.3 Validating References with Lifetimes | `ownership/lifetimes.md` |
| 11 | Writing Automated Tests (11.1–11.3) | `project-structure/testing.md` |
| 12 | An I/O Project: Building a Command Line Program (12.1–12.6) | `project-structure/build-a-command-line-tool.md` |
| 13 | Functional Language Features (13.1 Closures) | `closures-and-iterators/closures-and-fn-traits.md` |
| 13 | 13.2 Iterators, 13.3 Improving Our I/O Project, 13.4 Performance in Loops vs. Iterators | `closures-and-iterators/iterators.md` |
| 14 | More about Cargo and Crates.io (14.1–14.5: release profiles, publishing, workspaces, `cargo install`, custom subcommands) | `project-structure/cargo-workspaces-features-and-profiles.md` |
| 15 | Smart Pointers (15.1 Box, 15.2 Deref, 15.3 Drop) | `smart-pointers/box-deref-and-drop.md` |
| 15 | 15.4 Rc, 15.5 RefCell and Interior Mutability, 15.6 Reference Cycles | `smart-pointers/rc-refcell-and-interior-mutability.md` |
| 16 | Fearless Concurrency (16.1 Threads, 16.2 Message Passing, 16.3 Shared State, 16.4 Send and Sync) | `concurrency/threads-channels-and-locks.md` |
| 17 | Fundamentals of Asynchronous Programming (17.1–17.5, including 17.4 Streams) | `async/futures-and-async-await.md`; 17.5's `Pin` in `async/pin-and-unpin.md` |
| 17 | 17.6 Futures, Tasks, and Threads | `async/tokio-runtime-tasks-and-cancellation.md` |
| 18 | Object Oriented Programming Features (18.1 Characteristics of Object-Oriented Languages, 18.2 Trait Objects) | `traits-and-generics/trait-objects-and-dynamic-dispatch.md`; 18.1's encapsulation through private fields in `project-structure/packages-crates-and-modules.md` |
| 18 | 18.3 Implementing an Object-Oriented Design Pattern | `design-patterns/type-driven-design.md` (trait-object states against typestate) |
| 19 | Patterns and Matching (19.1–19.3) | `data-modeling/enums-and-pattern-matching.md` |
| 20 | Advanced Features (20.1 Unsafe Rust) | `unsafe/unsafe-rust-and-undefined-behavior.md`; its `extern` sections in `unsafe/ffi-and-c-interop.md` |
| 20 | 20.2 Advanced Traits, 20.3 Advanced Types, 20.4 Advanced Functions and Closures | `traits-and-generics/advanced-traits-and-type-system.md`; 20.3's newtype in `design-patterns/type-driven-design.md`; 20.4's returning closures in `closures-and-iterators/closures-and-fn-traits.md` |
| 20 | 20.5 Macros | `macros/declarative-macros.md`, `macros/procedural-macros.md` |
| 21 | Final Project: a Multithreaded Web Server (21.1 Single-Threaded) | `project-structure/build-a-single-threaded-web-server.md` |
| 21 | 21.2 From Single-Threaded to Multithreaded Server, 21.3 Graceful Shutdown and Cleanup | `concurrency/threads-channels-and-locks.md` (thread pool worked example) |
| App. | C Derivable Traits | `traits-and-generics/core-traits-reference.md` |
| App. | D Useful Development Tools, E Editions, G How Rust is Made and "Nightly Rust" | `fundamentals/toolchain-cargo-and-editions.md` |

### Beyond the Book

| Doc under `rust/` | Main sources besides the Book |
|---|---|
| `ownership/borrow-checker-errors.md` | The rustc error index |
| `traits-and-generics/core-traits-reference.md` | The standard library docs |
| `concurrency/atomics-and-memory-ordering.md`, `concurrency/building-a-spinlock-channel-and-arc.md` | Rust Atomics and Locks (Mara Bos), the `std::sync::atomic` docs, loom |
| `async/pin-and-unpin.md`, `async/tokio-runtime-tasks-and-cancellation.md` | The `std::pin` docs, the Async Book, the Tokio tutorial and API docs |
| `unsafe/memory-layout-and-repr.md`, `unsafe/variance-phantomdata-and-drop-check.md` | The Rustonomicon, The Rust Reference, the Unsafe Code Guidelines |
| `design-patterns/idioms-and-api-guidelines.md`, `design-patterns/type-driven-design.md` | Rust API Guidelines, Rust Design Patterns |
| `performance/zero-cost-abstractions-and-optimization.md` | The Rust Performance Book, criterion, The rustc book (profile-guided optimization) |
| `performance/compiler-pipeline-and-compile-times.md` | The rustc dev guide, The Cargo Book |
| `ecosystem/serde-data-model.md` | serde.rs |
| `ecosystem/no-std-embedded-and-webassembly.md` | The Embedded Rust Book, the Embedonomicon, The rustc book (platform support) |

### Free, authoritative resources

| Resource | Why |
|---|---|
| [The Rust Programming Language](https://doc.rust-lang.org/book/) | The official introduction; the backbone of stages 1–6 |
| [Rust by Example](https://doc.rust-lang.org/rust-by-example/) | Short runnable examples for each language feature |
| [The Rust Reference](https://doc.rust-lang.org/reference/) | Exact language rules: patterns, destructors, temporaries, layout, undefined behaviour |
| [The Rust Standard Library](https://doc.rust-lang.org/std/) | Every type and trait, with the invariants unsafe code relies on |
| [The Edition Guide](https://doc.rust-lang.org/edition-guide/) | What each edition (2015, 2018, 2021, 2024) changes, and how to migrate |
| [The Cargo Book](https://doc.rust-lang.org/cargo/) | Manifests, dependency resolution, features, workspaces, profiles |
| [The Rustonomicon](https://doc.rust-lang.org/nomicon/) | Unsafe Rust: layout, variance, drop check, FFI |
| [Asynchronous Programming in Rust](https://rust-lang.github.io/async-book/) | Futures, pinning and executors from the async working group (some chapters are drafts) |
| [Tokio tutorial](https://tokio.rs/tokio/tutorial) | The most used async runtime, from its own project |
| [Rust Atomics and Locks](https://mara.nl/atomics/) | Memory ordering and building synchronization primitives, free online |
| [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/) | Naming, conversions and interoperability for public APIs |
| [The rustc dev guide](https://rustc-dev-guide.rust-lang.org/) | How the compiler works, from parsing to code generation |
| [The Rust Performance Book](https://nnethercote.github.io/perf-book/) | Profiling, build configuration and common optimizations |
| [The Little Book of Rust Macros](https://lukaswirth.dev/tlborm/) | `macro_rules!` in depth |

## Lookup notes
- **The online Book is older than the lab's compiler in three places.**
  - Book 19.1 says `if let Ok(age) = age && age > 30` cannot be written ✅[^4]. Edition 2024 accepts it as a let chain, stable since Rust 1.88 ✅[^5]. In the lab it printed `chain ok: 34`; under edition 2021 it fails with "let chains are only allowed in Rust 2024 or later" ✅[^1].
  - Book 15.5's prose names the double-borrow panic `already borrowed: BorrowMutError`, although its own output block shows the new text ✅[^7]; Rust 1.100.0 prints `RefCell already borrowed` ✅[^1].
  - Book 20.3 predates Rust 1.100.0, which lets the never type `!` be written in any type position and makes `std::convert::Infallible` an alias for it ✅[^6].
- **Two book sites moved.** `marabos.nl/atomics/` answers with HTTP 301 to `mara.nl/atomics/`, and `veykril.github.io/tlborm/` with 301 to `lukaswirth.dev/tlborm/`; the docs cite the new addresses ✅[^1].
- **Section numbers are not printed on the Book's pages.** They come from its table of contents and its file names (for example `ch04-02-references-and-borrowing.html` is 4.2) ✅[^3].
- **Sizes and timings in the docs are aarch64 measurements** from one machine; addresses, timings and `HashMap` iteration order change between runs and machines.

## Takeaways
- Read stages 1–3 in order: ownership and borrowing (stage 2) explain most compile errors met later.
- Keep `ownership/borrow-checker-errors.md` and `traits-and-generics/core-traits-reference.md` open while reading stages 3–6.
- Run every unsafe or atomics exercise under Miri, not only natively.
- Check the edition of a project before trusting an example: several behaviours in these docs differ between editions 2021 and 2024.

## Verification status
- Verified: 10 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24, including the HTTP redirect checks. [^1]
- [The Rust Programming Language](https://doc.rust-lang.org/book/) — Steve Klabnik, Carol Nichols, Chris Krycho and the Rust community, living. Backs: Scope, the Rust and edition versions the Book assumes. [^2]
- [Table of contents](https://doc.rust-lang.org/book/toc.html) — The Rust Programming Language, living. Backs: chapter and section numbers and titles. [^3]
- [All the Places Patterns Can Be Used](https://doc.rust-lang.org/book/ch19-01-all-the-places-for-patterns.html) — The Rust Programming Language, living. Backs: the Book's statement about combining `if let` with a condition. [^4]
- [Announcing Rust 1.88.0](https://blog.rust-lang.org/2025/06/26/Rust-1.88.0/) — The Rust Release Team, 2025. Backs: let chains in edition 2024. [^5]
- [Announcing Rust 1.100.0](https://blog.rust-lang.org/2026/11/12/Rust-1.100.0/) — The Rust Release Team, 2026. Backs: the never type stabilized, `Infallible` made an alias. [^6]
- [RefCell<T> and the Interior Mutability Pattern](https://doc.rust-lang.org/book/ch15-05-interior-mutability.html) — The Rust Programming Language, living. Backs: the Book's prose and output for a double mutable borrow. [^7]

## Related
- `rust/index.md` — the subtopics this path walks through.
- `linux/lab-setup.md` — the lab for every exercise.
- `javascript/learning-path.md` — the same kind of path for JavaScript.
