---
schema: topic-index/v1
kind: subtopic
topic: rust/performance
last-updated: 2026-11-24
---

# Rust performance and the compiler

What "zero-cost abstraction" means and where its costs go: monomorphization and code size, inlining (including automatic cross-crate inlining), bounds-check elimination read from the assembly, allocation reduction measured with a counting allocator, benchmarking with criterion and `std::hint::black_box`, profiling pointers, and PGO (profile-guided optimization) measured on a parser and an interpreter; and how rustc works from source to binary: AST, macro expansion, HIR, THIR, MIR, borrow checking, monomorphization, LLVM and linking, the query system and incremental compilation, `cargo check` versus `cargo build`, and measuring compile time with `-Ztime-passes`, `-Zself-profile` and `cargo build --timings`. Every behaviour ran on Rust 1.100.0 (nightly 1.102.0 for `-Z` flags) on aarch64. Not covered: the general performance method, profilers and flame graphs (the root `performance/` topic), profile settings and their measured effect (`rust/project-structure/cargo-workspaces-features-and-profiles.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [zero-cost-abstractions-and-optimization.md](zero-cost-abstractions-and-optimization.md) | concept | Zero-cost defined; monomorphization copies counted; inlining and cross-crate inlining; where bounds checks survive in seven kernels; allocation counts; criterion and `black_box` with two benchmark runs; profiling pointers; the PGO workflow measured (parser 18–20% faster, interpreter 2–5% slower) | verified |
| [compiler-pipeline-and-compile-times.md](compiler-pipeline-and-compile-times.md) | concept | One function seen as HIR, MIR, mono items and LLVM IR; the stage order with `-Ztime-passes` timings for tokio; queries and red-green incremental reuse; `cargo check` versus `build` measured; `--timings` critical path | verified |

## References
- [The Rust Performance Book](https://nnethercote.github.io/perf-book/) — Nicholas Nethercote and others, living. Backs: subtopic scope (optimization).
- [Rust Compiler Development Guide](https://rustc-dev-guide.rust-lang.org/) — Rust project, living. Backs: subtopic scope (compiler internals).

## Related
- `rust/learning-path.md` — where this subtopic sits in the learning order.
- `performance/` — language-neutral performance method, measurement and optimization.
- `rust/project-structure/` — profiles, features and build scripts.
