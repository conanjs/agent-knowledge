---
schema: knowledge-doc/v1
type: concept
topic: rust/errors
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, panic, result, question-mark-operator, unwinding, abort, backtrace, exit-code, unwrap, expect]
---

# Panics, `Result` and error propagation with `?`

## Summary
**TL;DR:** Rust has two error channels and no exceptions. `panic!` is for bugs: it stops the current thread, by default **unwinds** (runs every live value's `Drop`), and a panic of the main thread ends the process with exit code 101. `Result<T, E>` is for failures the caller is expected to handle; `?` unwraps `Ok`, or returns `Err(From::from(e))` from the current function, so a lower error converts into the function's own error type on the way up (`?` on an `Option` returns `None`). `main` may return `Result`; an `Err` prints `Error: <Debug form>` and exits with code 1.
**Use this when:** deciding between `panic!`, `unwrap`/`expect` and returning `Result`; reading a panic message or a `RUST_BACKTRACE` trace; fixing a `?` compile error (E0277); choosing `panic = "abort"`; deciding what `main` returns and which exit code a program gives.
**Not this doc:** designing error types, `source()` chains, `thiserror` and `anyhow` → `rust/errors/error-types-thiserror-and-anyhow.md`; the cross-language idea of failures as values → `error-handling/result-type.md`; `#[should_panic]` and tests returning `Result` → `rust/project-structure/testing.md`; integer-overflow panics → `rust/fundamentals/variables-types-and-control-flow.md`; the `panic` profile key next to the other profile settings → `rust/project-structure/cargo-workspaces-features-and-profiles.md`; `Option` and `match` → `rust/data-modeling/enums-and-pattern-matching.md`.

## Problem
Code written with exception habits goes wrong in four ways. `unwrap()` everywhere turns every bad input into a crash whose message says nothing about why the value was expected. Panicking on user mistakes (a typo in a config file) kills a program that should have printed a message. `?` refuses to compile in a function that returns `()` or that mixes `Option` and `Result`. And `std::panic::catch_unwind` used as `try`/`catch` stops working the day someone sets `panic = "abort"`, which also skips destructors that were supposed to flush files.

## Mental model
**Analogy:** an assembly line. A `Result` is the ticket that travels with each part: "OK, here is the part" or "rejected: reason". The next station must read the ticket before using the part. `?` is a worker who, on a rejected ticket, rewrites the reason in this station's wording (`From`) and sends it straight back up the line. `panic!` is the emergency stop cord: the line halts; with unwinding, each station tidies its bench (`Drop`) on the way out; with abort, the lights go off at once.

**Artifact:** the same bad input through both channels, in the lab ✅[^1]:
```rust
fn main() -> Result<(), std::num::ParseIntError> {
    let port: u16 = "80a".parse()?;   // Err → main returns it
    println!("port {port}");
    Ok(())
}
```
```console
Error: ParseIntError { kind: InvalidDigit }      ← stderr; exit status 1
```
The panic channel for the same kind of failure, `"4x".parse::<u8>().unwrap()`, exits with status 101 instead; its message is in the `unwrap` table below ✅[^1].

## How it works

### A panic, step by step
The Book names two ways to start a panic: an operation that panics (such as indexing past the end) and an explicit `panic!` call ✅[^2]. **4 actors** take part:
- **Your code** — its job: start the panic, via `panic!(…)` or a failing operation such as `slots[5]`.
- **The panic hook** — its job: report the panic, via the default std hook writing the message and location to stderr.
- **The unwinder** — its job: clean up, via calling `drop` on every live value, frame by frame (unwind strategy only).
- **The thread boundary in std** — its job: stop the unwind and turn it into an outcome (an exit code or a `join` result), via the code std runs around each thread's entry function.

```
your code               panic hook (std)                unwinder / abort            thread boundary
panic!("shelf {} is     prints to stderr:
empty", 7) ──────────▶  thread 'main' (24) panicked
                        at p1_panic.rs:11:9:
                        shelf 7 is empty
                               │
            ┌──── strategy = unwind (default) ────┐── strategy = abort ──┐
            ▼                                      ▼                      │
     drop live values,                      process aborts: no drop,      │
     innermost frame first                  "Aborted", shell status 134  ◀┘
     ("drop outer")
            │
            ▼
                                                             main thread  → exit code 101
                                                             other thread → join() == Err(payload)
```

1. **Your code:** `panic!("shelf {} is empty", 7)` builds the payload with format syntax ✅[^5].
2. **Panic hook (std):** runs first. The default hook prints the payload with the file, line and column to stderr; Rust 1.100 also prints the thread id: `thread 'main' (24) panicked at p1_panic.rs:11:9:` then `shelf 7 is empty` and a `note:` suggesting `RUST_BACKTRACE=1` ✅[^1] ✅[^5]. `std::panic::set_hook` replaces it ✅[^5]. A custom hook runs before the panic is caught and before unwinding ✅[^7].
3. **Unwinder (unwind strategy):** walks back up the Rust frames and calls `drop` on the live values in each frame, as if they had gone out of scope ✅[^6]. In the lab, a guard's `drop outer` line printed after the panic message ✅[^1].
4. **Thread boundary (std):** the unwind stops at the thread's entry point. In the lab backtrace, `main` itself runs inside `std::rt::lang_start_internal`, which calls `catch_unwind` ✅[^1]. A panic of the main thread ends the program with code 101 ✅[^5] ✅[^1]; a panic in a spawned thread makes `join()` return `Err` holding the payload, and `main` carries on (the lab printed `join is_err = true` and exited 0) ✅[^1].

**Abort strategy:** chosen with `rustc -C panic=abort` ✅[^6] or `panic = "abort"` in a Cargo profile ✅[^8]. The hook still prints the message ✅[^1], then the program ends without cleaning up ✅[^2] ✅[^6]. In the lab the guard's drop line never appeared, `sh` printed `Aborted`, and the exit status was 134, which `kill -l 134` names `ABRT`, the abort signal ✅[^1]. The Book's reasons for choosing it: a smaller binary, and the operating system frees the memory instead ✅[^2]. Both default profiles use `unwind` ✅[^8].

**Backtraces:** set `RUST_BACKTRACE` to any value other than `0` to print the call stack ✅[^2]. `RUST_BACKTRACE=1` prints a short trace (`stack backtrace:` then numbered frames such as `2: p1_panic::main`) and says `RUST_BACKTRACE=full` gives the verbose one ✅[^1]. File and line numbers need debug information, which `cargo build` without `--release` has ✅[^2] ✅[^9].

### `unwrap`, `expect` and the panic message
| Call on a failure | Panic message (lab, Rust 1.100) |
|---|---|
| `"4x".parse::<u8>().unwrap()` | ``called `Result::unwrap()` on an `Err` value: ParseIntError { kind: InvalidDigit }`` ✅[^1] |
| `….expect("port in config must be a number")` | `port in config must be a number: ParseIntError { kind: InvalidDigit }` ✅[^1] |
| `None::<u8>.unwrap()` | ``called `Option::unwrap()` on a `None` value`` ✅[^1] |

Both print the inner error after the message; `expect` replaces the generic prefix with your text ✅[^12]. The std docs recommend the "expect as precondition" wording, which states why the value **should** be `Ok`, for example `"env variable `IMPORTANT_PATH` should be set by `wrapper_script.sh`"` ✅[^12].

### The `?` operator
1. **On `Result`:** `expr?` evaluates `expr`. `Ok(v)` becomes `v`; `Err(e)` makes the function return `Err(From::from(e))` ✅[^10]. The `From::from` call is what converts a `ParseIntError` into your `ConfigError` ✅[^3].
2. **On `Option`:** `Some(v)` becomes `v`; `None` makes the function return `None` ✅[^10].
3. **Where it is allowed:** only in a function whose return type matches: `Result`, `Option`, or another type implementing `FromResidual` ✅[^3]. It does not convert between `Option` and `Result`; use `ok_or`/`ok_or_else` on an `Option` or `ok()` on a `Result` first ✅[^3]. The `Try` trait behind it is unstable, so your own types cannot implement it today ✅[^10].
4. **Ignoring a `Result`:** `Result` is `#[must_use]`, so a bare `save();` warns ``unused `Result` that must be used`` ✅[^13] ✅[^1].

### What `main` may return
`main` may return any type implementing `std::process::Termination`, whose `report` gives the process an `ExitCode` ✅[^11] ✅[^3]. std implements it for `()`, `!`, `ExitCode` and `Result<T, E>` where `E: Debug` ✅[^11]. For `Err(e)`, Rust 1.100 prints `Error: ` plus `e`'s **Debug** form to stderr and exits with 1 ✅[^1]. For another code, return `ExitCode::from(2)` (the lab's usage error exited 2) ✅[^1]. `std::process::exit` also sets a code, but it runs no destructors on any thread's stack; std recommends returning a `Termination` type from `main` instead ✅[^14].

## Worked example
A config reader where two different failures reach one error type. `?` converts `ParseIntError` through a `From` impl, and an `Option` becomes a `Result` with `ok_or` ✅[^1]:
```rust
use std::{fmt, num::ParseIntError};

#[derive(Debug)]
enum ConfigError { Missing(&'static str), BadNumber(ParseIntError) }

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ConfigError::Missing(k) => write!(f, "key {k} is missing"),
            ConfigError::BadNumber(e) => write!(f, "value is not a number ({e})"),
        }
    }
}
impl From<ParseIntError> for ConfigError {            // what `?` calls
    fn from(e: ParseIntError) -> Self { ConfigError::BadNumber(e) }
}

fn lookup<'a>(pairs: &'a [(&str, &str)], key: &str) -> Option<&'a str> {
    pairs.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}
fn workers(pairs: &[(&str, &str)]) -> Result<u16, ConfigError> {
    let raw = lookup(pairs, "workers").ok_or(ConfigError::Missing("workers"))?;
    let n: u16 = raw.trim().parse()?;                 // ParseIntError → ConfigError
    Ok(n * 2)
}
fn first_word_len(line: &str) -> Option<usize> {
    let w = line.split_whitespace().next()?;          // None → return None
    Some(w.len())
}
```
| Call | Path taken | Output |
|---|---|---|
| `workers(&[("workers", " 8 ")])` | both `?` pass | `Ok(16)` |
| `workers(&[("threads", "8")])` | `ok_or` gives `Err`, first `?` returns it | `Err(Missing("workers"))` |
| `workers(&[("workers", "eight")])` | `parse` fails, `?` calls `From::from` | `Err(BadNumber(ParseIntError { kind: InvalidDigit }))`; Display `value is not a number (invalid digit found in string)` |
| `first_word_len("hello world")` / `("   ")` | `?` on `Option` | `Some(5)` / `None` |

Delete the `From` impl and change the parse to `raw.trim().parse::<u16>()?`: compilation fails with ``error[E0277]: `?` couldn't convert the error to `ConfigError` ``, and a note that `?` converts the error value using the `From` trait ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `?` on an `Option` in a function returning `Result` | ``error[E0277]: the `?` operator can only be used on `Result`s, not `Option`s, in a function that returns `Result` ``; the help suggests `.ok_or(...)?` ✅[^1] | `?` never converts between the two ✅[^3] |
| `?` in `fn main()` returning `()` | ``error[E0277]: the `?` operator can only be used in a function that returns `Result` or `Option` …``; the help proposes `-> Result<(), Box<dyn std::error::Error>>` ✅[^1] | `()` does not implement `FromResidual` ✅[^3] |
| `let n: u16 = raw.trim().parse()?` with no `From` impl | ``error[E0271]: type mismatch resolving `<u16 as FromStr>::Err == ConfigError` `` instead of E0277 ✅[^1] | Inference pushes the error type from the `?` site into `parse`; the turbofish form above gives the clearer E0277 ✅[^1] |
| Panic in a spawned thread | The message prints with `thread '<unnamed>'`; `join()` returns `Err(payload)`; in the lab the payload downcast to `String` ✅[^1] | The unwind stops at that thread's boundary ✅[^6]; whether a payload is `&str` or `String` is unspecified ✅[^5] |
| `catch_unwind(\|\| panic!("boom {}", 1))` | Returns `Err`; the hook still printed the message ✅[^1] | It catches only unwinding panics, and std advises against using it as general `try`/`catch` ✅[^7] |
| `panic = "abort"` | No `Drop` runs and nothing can catch the panic; exit status 134 ✅[^1] | The process is aborted ✅[^6]; `catch_unwind` catches only unwinding panics ✅[^7] |
| `cargo test` with `panic = "abort"` in the profile | Tests still unwind | Tests, benchmarks, build scripts and proc macros ignore the setting ✅[^8] |
| A `Drop` impl panics while unwinding | `panic in a destructor during cleanup`, `thread caused non-unwinding panic. aborting.`, exit status 134 ✅[^1] | A second panic during unwinding cannot unwind ✅[^1] |
| A Rust `extern "C" fn` panics, even inside `catch_unwind` | `panic in a function that cannot unwind`, `thread caused non-unwinding panic. aborting.`, exit status 134 ✅[^1] | The `"C"` ABI (application binary interface) does not unwind; foreign code unwinding into Rust through a `"C"` declaration is UB (undefined behaviour) ✅[^6]; `"C-unwind"` is covered in `rust/unsafe/ffi-and-c-interop.md` |
| `main` returns `Err` of a derived-`Debug` enum | Prints the variant's Debug form, e.g. `Error: Count(ParseIntError { kind: PosOverflow })`, not its Display text ✅[^1] | The `Termination` impl uses `Debug` ✅[^11] |
| `#![no_std]` binary | Must define its own `#[panic_handler]` (see `rust/ecosystem/no-std-embedded-and-webassembly.md`) | Linking a `no_std` binary requires exactly one `panic_handler` in the dependency graph ✅[^6] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Return `Result` | The failure is in the signature; the caller chooses to recover, convert or panic; the Book calls it the good default for a function that might fail ✅[^4] | An error type to design; `?` and `From` impls |
| `expect("… should …")` | One line; documents the assumption; fine when you know more than the compiler (a hard-coded literal) ✅[^4] | Crashes the thread if the assumption is wrong |
| `unwrap()` | Shortest; acceptable in tests, examples and prototypes ✅[^4] | Generic message with no reason |
| `panic!` on a broken invariant | Stops before corrupt state spreads; the Book's rule for bad states and contract violations ✅[^4] | Callers cannot recover in-process |
| `panic = "abort"` | Smaller binary ✅[^2]; the optimizer may assume no unwinding ✅[^6] | No destructors on panic; no per-thread isolation |

## Takeaways
- Return `Result` for failures caused by input, files, network or users; panic only for bugs and broken invariants. [rule-candidate]
- Outside tests and prototypes, prefer `expect("<value> should <reason>")` over `unwrap()`. [rule-candidate]
- Write `impl From<LowerError> for MyError` once instead of `map_err` at every `?`.
- Turn an `Option` into a `Result` with `ok_or`/`ok_or_else` before `?` in a `Result` function.
- Never use `catch_unwind` as `try`/`catch`; it stops catching under `panic = "abort"`. [rule-candidate]
- Return `ExitCode` or `Result` from `main` instead of calling `std::process::exit` deep in the code. [rule-candidate]
- Run with `RUST_BACKTRACE=1` on a debug build when a panic location alone is not enough.

## Verification status
- Verified: 75 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Unrecoverable Errors with `panic!`](https://doc.rust-lang.org/book/ch09-01-unrecoverable-errors-with-panic.html) — The Rust Programming Language (Klabnik, Nichols, Krycho et al.), living. Backs: two ways to panic, unwind vs abort and the profile setting, `RUST_BACKTRACE`, debug symbols. [^2]
- [Recoverable Errors with `Result`](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html) — The Rust Programming Language, living. Backs: `?` calls `From::from`, where `?` is allowed, no `Option`/`Result` mixing, `main` returning `Result` and `Termination`. [^3]
- [To `panic!` or Not to `panic!`](https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html) — The Rust Programming Language, living. Backs: Trade-offs (Result as default, tests and prototypes, more information than the compiler, bad states). [^4]
- [Macro `std::panic`](https://doc.rust-lang.org/std/macro.panic.html) — Rust project, living. Backs: payload, default hook output, `set_hook`, main-thread panic exits with code 101. [^5]
- [Panic](https://doc.rust-lang.org/reference/panic.html) — The Rust Reference, living. Backs: unwinding runs `Drop`, recovery at a thread boundary, panic strategies and `-C panic`, abort optimizations, unwinding across foreign-function boundaries, `panic_handler`. [^6]
- [Function `std::panic::catch_unwind`](https://doc.rust-lang.org/std/panic/fn.catch_unwind.html) — Rust project, living. Backs: only unwinding panics are caught, not a try/catch, hook runs before unwinding. [^7]
- [Profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) — The Cargo Book, living. Backs: `panic` setting values, defaults, tests ignore it. [^8]
- [Module `std::backtrace`](https://doc.rust-lang.org/std/backtrace/index.html) — Rust project, living. Backs: file and line numbers need debug information. [^9]
- [Operator expressions: the try propagation expression](https://doc.rust-lang.org/reference/expressions/operator-expr.html) — The Rust Reference, living. Backs: `?` on `Result` and `Option`, `From::from(e)`, `Try` is unstable. [^10]
- [Trait `std::process::Termination`](https://doc.rust-lang.org/std/process/trait.Termination.html) — Rust project, living. Backs: `report` returns `ExitCode`, the four std impls, `E: Debug`. [^11]
- [Module `std::error`](https://doc.rust-lang.org/std/error/index.html) — Rust project, living. Backs: `unwrap` vs `expect` output, "expect as precondition" wording. [^12]
- [Module `std::result`](https://doc.rust-lang.org/std/result/index.html) — Rust project, living. Backs: `Result` is `#[must_use]`. [^13]
- [Function `std::process::exit`](https://doc.rust-lang.org/std/process/fn.exit.html) — Rust project, living. Backs: no destructors run; prefer returning a `Termination` type. [^14]
- [Error Handling](https://doc.rust-lang.org/book/ch09-00-error-handling.html) — The Rust Programming Language, living. Background: recoverable vs unrecoverable errors, no exceptions.

## Related
- `rust/errors/error-types-thiserror-and-anyhow.md` — the `E` in `Result<T, E>`: error traits, chains, `thiserror`, `anyhow`.
- `error-handling/result-type.md` — failures as values across languages.
- `error-handling/handle-errors-once.md` — add context while propagating, report once.
- `rust/project-structure/build-a-command-line-tool.md` — exit codes and stderr in a real command-line tool.
- `linux/processes/signals.md` — the shell's 128 + signal exit-status convention.
- `rust/closures-and-iterators/iterators.md` — `collect` into `Result<Vec<_>, E>`.
