---
schema: topic-index/v1
kind: subtopic
topic: rust/errors
last-updated: 2026-11-24
---

# Rust errors

How Rust programs fail and report failure: `panic!` and unwinding versus aborting, backtraces, `unwrap`/`expect`, `Result` and the `?` operator with its `From` conversion, what `main` returns and the exit code it produces, then the `std::error::Error` trait, `source()` chains, `Box<dyn Error + Send + Sync>`, `thiserror` and `anyhow`. Covers The Rust Programming Language chapter 9. Not covered: the general case for errors as values and the library-versus-application split in other languages (see `error-handling/`), test attributes such as `#[should_panic]` (see `rust/project-structure/testing.md`), and integer-overflow panics (see `rust/fundamentals/variables-types-and-control-flow.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [panic-result-and-error-propagation.md](panic-result-and-error-propagation.md) | concept | `panic!` vs `Result`; unwind vs abort with exit codes 101 and 134 measured; `RUST_BACKTRACE`; `unwrap`/`expect` messages; `?` returning `Err(From::from(e))` or `None`; `main` returning `Result` or `ExitCode` | verified |
| [error-types-thiserror-and-anyhow.md](error-types-thiserror-and-anyhow.md) | concept | The `Error` trait and `source()` chains; `Box<dyn Error + Send + Sync>`; `thiserror` attributes and their expansion; `anyhow` context, `{}`/`{:#}`/`{:?}` formats and backtraces | verified |

## References
- [Error Handling](https://doc.rust-lang.org/book/ch09-00-error-handling.html) — The Rust Programming Language (Klabnik, Nichols, Krycho et al.), living. Backs: subtopic scope.
- [Module `std::error`](https://doc.rust-lang.org/std/error/index.html) — Rust project, living. Backs: subtopic scope.

## Related
- `rust/index.md` — the Rust topic.
- `error-handling/` — cross-language error design, including `error-handling/result-type.md` and `error-handling/library-vs-application-errors.md`.
- `rust/closures-and-iterators/` — `collect` into `Result<Vec<_>, E>`.
