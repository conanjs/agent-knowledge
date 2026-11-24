---
schema: topic-index/v1
kind: subtopic
topic: rust/project-structure
last-updated: 2026-11-24
---

# Project structure, Cargo and testing

How a Rust project is organised and built: packages, library and binary crates, the module tree, paths, visibility (`pub`, `pub(crate)`, `pub(super)`), `use` and re-exports; Cargo dependency requirements and resolution, `Cargo.lock`, workspaces, feature unification, build scripts, profiles (`opt-level`, `lto`, `codegen-units`) with measured size and speed, `cargo install` and publishing; unit, integration, doc and property tests (proptest); and two how-tos: a grep-like command-line tool with exit codes and end-to-end tests, and a single-threaded HTTP/1.1 server on `std::net`. Consolidates the Rust Book chapters 7, 11, 12, 14 and 21.1. Every behaviour ran on Rust 1.100.0 (edition 2024). Not covered: `cargo new` and editions (`rust/fundamentals/`), the compiler's internal stages and compile-time measurement (`rust/performance/`), loom and Miri (`rust/concurrency/`, `rust/unsafe/`), argument-parsing crates.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [packages-crates-and-modules.md](packages-crates-and-modules.md) | concept | Packages and crates, the declared module tree and its files, paths, the two privacy rules, `pub(crate)`/`pub(super)`/`pub(in path)`, `use` scope, `pub use` re-exports, `#[path]`; E0603, E0616, E0451, E0364, E0583, E0761 reproduced | verified |
| [cargo-workspaces-features-and-profiles.md](cargo-workspaces-features-and-profiles.md) | concept | Caret requirements and resolution, workspaces sharing one lock file and `target/`, feature unification shown failing with `-p`, `build.rs`, profile defaults and a nine-profile size/speed table, `cargo install`, publishing | verified |
| [testing.md](testing.md) | concept | Unit, integration and doc tests, `should_panic`, `Result` tests, `#[ignore]`, filters, parallel threads and output capture flags, proptest shrinking an overflow to its boundary | verified |
| [build-a-command-line-tool.md](build-a-command-line-tool.md) | how-to | A grep-like `seek` tool: `Config`, `search`, `run`, stderr errors, an env var switch, exit codes 0/1/2, broken-pipe handling, unit and end-to-end tests, install and uninstall | verified |
| [build-a-single-threaded-web-server.md](build-a-single-threaded-web-server.md) | how-to | A `TcpListener` server answering HTTP/1.1 with 200/404/405/400/505, request heads read to the empty line with a timeout and a 16 KiB cap, checked with `curl` from the host; why a slow page blocks the next client | verified |

## References
- [The Rust Programming Language](https://doc.rust-lang.org/book/) — Steve Klabnik, Carol Nichols, Chris Krycho and the Rust community, living. Backs: subtopic scope (chapters 7, 11, 12, 14, 21.1).
- [The Cargo Book](https://doc.rust-lang.org/cargo/) — Rust project, living. Backs: Cargo scope.

## Related
- `rust/learning-path.md` — where this subtopic sits in the learning order.
- `rust/fundamentals/` — toolchain, `cargo new` and editions.
- `rust/performance/` — the compiler pipeline and optimization.
- `testing/` — testing practice beyond one language.
