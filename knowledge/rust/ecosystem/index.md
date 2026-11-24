---
schema: topic-index/v1
kind: subtopic
topic: rust/ecosystem
last-updated: 2026-11-24
---

# Ecosystem: serde, `no_std` and WebAssembly

Two foundations most Rust projects meet outside the language itself: serde, the serialization framework (its data model, derive attributes, enum representations, zero-copy borrowing and `serde_json::Value`), and building without the operating system (`core`, `alloc` and `std`, `#![no_std]`, panic handlers, global allocators, targets and `rustup target add`, a Cortex-M `thumbv7em-none-eabihf` image and a `wasm32-unknown-unknown` module). Not covered: specific web frameworks, async runtimes (see `rust/async/`), board support crates, `wasm-bindgen` and other crates beyond those each doc names.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [serde-data-model.md](serde-data-model.md) | concept | The 29-type data model between types and formats, what the derive generates, `rename_all`/`default`/`skip`/`flatten`, the four enum representations with real JSON, `deny_unknown_fields`, borrowed `&str` versus `Cow`, `serde_json::Value` | verified |
| [no-std-embedded-and-webassembly.md](no-std-embedded-and-webassembly.md) | concept | `core`/`alloc`/`std` layers, `#![no_std]` and `#![no_main]`, `#[panic_handler]`, a bump `#[global_allocator]`, a 24-byte Cortex-M vector table, target specs and atomics width, `cdylib` WebAssembly sizes per profile | verified |

## References
- [Overview](https://serde.rs/) — Serde, living. Backs: subtopic scope (serde).
- [Introduction](https://docs.rust-embedded.org/book/) — The Embedded Rust Book, Rust Embedded Working Group, living. Backs: subtopic scope (`no_std`).
- [Platform Support](https://doc.rust-lang.org/rustc/platform-support.html) — The rustc book, Rust project, living. Backs: subtopic scope (targets).

## Related
- `rust/index.md` — the Rust topic and its other subtopics.
- `rust/macros/procedural-macros.md` — how derive macros such as serde's work.
- `rust/unsafe/ffi-and-c-interop.md` — exporting functions to other languages.
