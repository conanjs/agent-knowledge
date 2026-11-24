---
schema: knowledge-doc/v1
type: concept
topic: rust/errors
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "thiserror 2.0.21", "anyhow 1.0.105"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, error-trait, source-chain, box-dyn-error, thiserror, anyhow, context, backtrace, downcast]
---

# Error types: `std::error::Error`, `thiserror` and `anyhow`

## Summary
**TL;DR:** An error type is any type that implements `Debug` and `Display` and then `std::error::Error`. Its `source()` method points to the lower-level error that caused it, so errors form a chain a reporter can walk. A library usually exposes its own enum, written by hand or derived with `thiserror`, which generates the same `Display`, `Error` and `From` impls you would write yourself. An application usually wants one catch-all type: `Box<dyn Error + Send + Sync>`, or `anyhow::Error`, which adds `.context(…)`, a `Caused by:` report and backtrace capture, and is one pointer wide.
**Use this when:** designing the error type of a crate; choosing between a hand-written enum, `thiserror`, `Box<dyn Error>` and `anyhow`; printing an error with all its causes; adding context to a low-level failure; getting a backtrace for an error that is not a panic; downcasting an error to match on it.
**Not this doc:** `panic!` vs `Result`, the `?` operator and what `main` returns → `rust/errors/panic-result-and-error-propagation.md`; why libraries and applications want different errors, in any language → `error-handling/library-vs-application-errors.md`; logging an error once → `error-handling/handle-errors-once.md`; `dyn Trait`, fat pointers and `Any` → `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md`.

## Problem
A `String` error cannot be matched by callers. A hand-written enum with five variants needs dozens of lines of `Display`, `Error` and `From` boilerplate. Printing an error with `{}` shows only the top message ("cannot import stock.txt") and hides the cause ("invalid digit found in string"); putting the cause into the message *and* returning it from `source()` prints it twice in every reporter. An application that touches files, parsing and its own rules needs one error type that still says which operation failed.

## Mental model
**Analogy:** a stack of incident notes. Each layer writes one line about what *it* was doing ("cannot import stock.txt") and staples underneath the note it received from below. `source()` is the staple; a reporter flips through the stack. `thiserror` is a printed form that fills in the stapling for you; `anyhow` is a folder that accepts any note, lets you add cover sheets (context), and can photocopy the call stack (backtrace).

**Artifact:** one hand-written link of the chain and a loop that walks it, in the lab ✅[^1]:
```rust
use std::{error::Error, fmt, num::ParseIntError};

#[derive(Debug)]
struct LineError { line: usize, source: ParseIntError }
impl fmt::Display for LineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {} is not a valid quantity", self.line) // own message only
    }
}
impl Error for LineError {
    fn source(&self) -> Option<&(dyn Error + 'static)> { Some(&self.source) }
}
// ImportError { file, source: LineError } is built the same way.

fn report(err: &dyn Error) {
    eprintln!("error: {err}");
    let mut cur = err.source();
    while let Some(cause) = cur { eprintln!("  caused by: {cause}"); cur = cause.source(); }
}
```
```console
error: cannot import stock.txt
  caused by: line 3 is not a valid quantity
  caused by: invalid digit found in string
```

## How it works

### 1. The `Error` trait
- `pub trait Error: Debug + Display`; every method has a default, so implementing it only requires `Debug` and `Display` ✅[^2].
- `source()` returns the lower-level cause ✅[^2]; an empty `impl Error for Plain {}` returned `None` in the lab ✅[^1]. `description()` and `cause()` are deprecated; `provide()` (typed access to context such as a backtrace) is nightly-only ✅[^2].
- Messages are short lowercase sentences without trailing punctuation, like `invalid digit found in string` ✅[^2] ✅[^3].
- A wrapping error either returns the inner error from `source()` or renders it in its own `Display`, never both ✅[^2]. The artifact follows this: `LineError`'s message does not repeat the `ParseIntError` text.
- The Rust API Guidelines add: implement `Error`, make the type `Send` and `Sync`, and never use `()` as an error type (a unit struct is the minimum) ✅[^3].

### 2. Walking the chain
A loop over `source()` is the stable way to list causes (the artifact). `Error::sources()`, an iterator over the same chain, is still nightly-only under `error_iter` ✅[^2].

### 3. `Box<dyn Error + Send + Sync>`: any error, no new type
std implements `From<E> for Box<dyn Error + Send + Sync>` for every `E: Error + Send + Sync`, plus `From<&str>` and `From<String>` ✅[^2]. So `?` boxes any error, and `Err("empty input".into())` makes one from text ✅[^1]. The Book uses `Box<dyn Error>` to mean "any kind of error" in `main` ✅[^8]. To get the concrete type back, `downcast_ref::<T>()` returns `Option<&T>` ✅[^2]; in the lab, a boxed `LineError` downcast succeeded ✅[^1]. On aarch64 the box is 16 bytes ✅[^1], a fat pointer (`rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md` explains the layout).

### 4. `thiserror`: the impls you would write, generated
```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("item {sku} not found")]           NotFound { sku: String },
    #[error("quantity {0} exceeds limit {1}")] TooMany(u32, u32),
    #[error("bad quantity")]                   Parse(#[from] std::num::ParseIntError),
    #[error("cannot read stock file")]         Io { #[source] cause: std::io::Error },
    #[error(transparent)]                      Other(#[from] std::fmt::Error),
}
```
| Value | `{e}` | `e.source()` (lab) |
|---|---|---|
| `NotFound { sku: "A-17".into() }` | `item A-17 not found` | `None` |
| `qty("500")` → `TooMany(500, 100)` | `quantity 500 exceeds limit 100` | `None` |
| `qty("5O")` → `?` on `ParseIntError` | `bad quantity` | `Some("invalid digit found in string")` |
| `Io { cause: … "stock.csv missing" }` | `cannot read stock file` | `Some("stock.csv missing")` |
| `StoreError::from(std::fmt::Error)` | `an error occurred when formatting an argument` | `None` (forwarded) |

All five rows ran in the lab ✅[^1]. What each attribute does:
- **`#[error("…")]`** generates `Display`, with `{field}`, `{0}` and `{field:?}` shorthands ✅[^4].
- **`#[from]`** generates `impl From<Inner> for StoreError`, so `?` converts; it implies `#[source]` ✅[^4].
- **`#[source]`**, or a field named `source`, becomes what `source()` returns ✅[^4]. A struct with a plain `source: std::io::Error` field returned it without any attribute in the lab ✅[^1].
- **`#[error(transparent)]`** forwards both `Display` and `source()` to the inner error ✅[^4].
- A `Backtrace` field is offered through `provide()`, which needs a nightly compiler ✅[^4].

The nightly macro expansion (`-Zunpretty=expanded`) shows ordinary code: `impl ::core::convert::From<std::num::ParseIntError> for StoreError { fn from(source: …) -> Self { StoreError::Parse { 0: source } } }` and a `source()` that matches each variant ✅[^1]. thiserror deliberately stays out of your public API (application programming interface): switching between it and hand-written impls is not a breaking change ✅[^4].

### 5. `anyhow`: one error type for applications
- **The type:** `anyhow::Error` holds any error that is `Send + Sync + 'static`; `anyhow::Result<T>` is `Result<T, anyhow::Error>`, and `?` converts any `std::error::Error` into it ✅[^5] ✅[^6].
- **Context:** the `Context` trait adds `.context("…")` and `.with_context(|| format!(…))` to `Result`, wrapping the error in a new outer message ✅[^5].
- **Macros:** `anyhow!` builds an error from a format string, `bail!` returns it early, `ensure!` returns early when a condition is false ✅[^5].
- **Inspecting:** `chain()` iterates from the outermost message down, `root_cause()` is its last element, and `downcast_ref::<T>()` finds a concrete type ✅[^6].
- **Size:** a narrow pointer, one word ✅[^6]; 8 bytes on aarch64, and `Result<(), anyhow::Error>` is 8 bytes too ✅[^1].
- **Backtraces:** on Rust ≥ 1.65 it captures a `std::backtrace::Backtrace` when the inner error does not provide one ✅[^5]. Capture follows `RUST_LIB_BACKTRACE`, or `RUST_BACKTRACE` when that is unset ✅[^7]; `{:?}` then adds a `Stack backtrace:` section ✅[^6] ✅[^1].

```
anyhow::Error (one pointer)
  ├─ context  "cannot start the importer"      ← chain() item 0, what {} prints
  ├─ context  "limit is not a number"          ← chain() item 1
  └─ ParseIntError "invalid digit found in string" ← chain() item 2 = root_cause()
```

## Worked example
An importer reads a limit from a file, with context at each layer (anyhow 1.0.105) ✅[^1]:
```rust
use anyhow::{bail, ensure, Context, Result};

fn read_limit(path: &str) -> Result<u32> {
    let text = std::fs::read_to_string(path).with_context(|| format!("failed to read {path}"))?;
    let n: u32 = text.trim().parse().context("limit is not a number")?;
    ensure!(n > 0, "limit must be positive, got {n}");
    Ok(n)
}
fn start(path: &str) -> Result<u32> {
    let n = read_limit(path).context("cannot start the importer")?;
    if n > 1000 { bail!("limit {n} too high"); }
    Ok(n)
}
```
| Step | Input | Output |
|---|---|---|
| 1 | file contains `ten`; print `{e}` | `cannot start the importer` |
| 2 | same error, `{e:#}` | `cannot start the importer: limit is not a number: invalid digit found in string` |
| 3 | same error, `{e:?}` | `cannot start the importer` / blank line / `Caused by:` / `    0: limit is not a number` / `    1: invalid digit found in string` |
| 4 | `e.downcast_ref::<ParseIntError>()` through two context layers | `Some(…)` (printed `true`) |
| 5 | file contains `0` | `ensure!` gives root cause `limit must be positive, got 0` |
| 6 | `main` returns `start("/tmp/does-not-exist")?` | stderr `Error: cannot start the importer`, `Caused by:` `0: failed to read /tmp/does-not-exist`, `1: No such file or directory (os error 2)`; exit status 1 |
| 7 | step 6 with `RUST_BACKTRACE=1` | the same, then `Stack backtrace:` whose frame 2 is `read_limit` at line 4, column 46 of the source file, the `with_context` call |
| 8 | file contains `5000`, `{e:#}` | `limit 5000 too high` (from `bail!`, no context added above it) |

All eight steps are lab output ✅[^1]. The three formats match anyhow's documented representations: `{}` outermost only, `{:#}` causes joined by `: `, `{:?}` the multi-line report that `main` prints ✅[^6].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `Display` includes the inner message **and** `source()` returns it | `#[error("cannot load profile: {source}")]` printed with anyhow's `{:#}`: `cannot load profile: invalid digit found in string: invalid digit found in string` ✅[^1] | std's rule is one or the other ✅[^2] |
| Two variants with `#[from] std::io::Error` | ``error[E0119]: conflicting implementations of trait `From<std::io::Error>` `` ✅[^1] | Each `#[from]` generates a `From` impl ✅[^4]; tell the cases apart with `#[source]` and `map_err` |
| `Box<dyn Error>` (no `Send`) returned from `thread::spawn` | ``error[E0277]: `dyn std::error::Error` cannot be sent between threads safely`` ✅[^1] | The guidelines ask for `Send + Sync` errors for this reason ✅[^3] |
| `anyhow::Error` passed to `fn f<E: std::error::Error>(e: E)` | ``error[E0277]: the trait bound `anyhow::Error: std::error::Error` is not satisfied`` ✅[^1] | It derefs to `dyn Error + Send + Sync` instead ✅[^6]; `&*e` works as a `&dyn Error`, and `e.into()` gives a `Box<dyn Error + Send + Sync>` ✅[^1] |
| `RUST_BACKTRACE=1 RUST_LIB_BACKTRACE=0` | anyhow errors print no `Stack backtrace:` ✅[^1]; panics keep theirs ✅[^5] | `RUST_LIB_BACKTRACE=0` disables `Backtrace::capture` ✅[^7] |
| Backtrace capture cost | Capturing can be expensive, which is why it is off unless an environment variable enables it ✅[^7] | Leave it off in hot error paths; `Backtrace::force_capture` ignores the variables ✅[^7] |
| `Err("empty input".into())` as `Box<dyn Error + Send + Sync>` | `{e}` prints `empty input`, `{e:?}` prints `"empty input"` with quotes ✅[^1] | The `From<&str>` impl boxes the text ✅[^2]; its `Debug` form is the quoted string ✅[^1] |
| `#[error(transparent)]` variant | `source()` returns the inner error's own source, not the inner error ✅[^1] | Both methods are forwarded ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Hand-written enum + `Display` + `Error` + `From` | No dependency; full control | Boilerplate for every variant |
| `thiserror` enum | Same impls in a few attributes; not part of your public API ✅[^4] | A proc-macro dependency (`thiserror-impl`) at build time ✅[^1]; still one variant per failure to design |
| `Box<dyn Error + Send + Sync>` | No new type; any error converts with `?` ✅[^2] | Callers must downcast to match; 16 bytes ✅[^1]; no context helper |
| `anyhow::Error` | `.context`, `bail!`/`ensure!`, cause report, backtraces, 8 bytes ✅[^5] ✅[^1] | Callers can only downcast, not match; does not implement `std::error::Error` itself ✅[^1] |

The library-versus-application reasoning behind the first two rows against the last one is in `error-handling/library-vs-application-errors.md`.

## Takeaways
- Libraries expose an error enum (hand-written or `thiserror`); binaries use `anyhow` and add `.context(…)` at each layer. [rule-candidate]
- Write error messages as short lowercase phrases without trailing punctuation. [rule-candidate]
- Return the inner error from `source()` or print it in `Display`, never both. [rule-candidate]
- Make error types `Send + Sync + 'static`; never use `()` as an error type. [rule-candidate]
- Print application errors with `{:#}` (one line) or `{:?}` (full report), not `{}`, so causes are not lost.
- Do not put two `#[from]` attributes for the same source type in one enum; split the cases with `#[source]`.

## Verification status
- Verified: 65 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Trait `std::error::Error`](https://doc.rust-lang.org/std/error/trait.Error.html) — Rust project, living. Backs: supertraits and provided methods, deprecations, message style, source-or-Display rule, `sources()` unstable, `Box<dyn Error>` `From` impls, downcasting. [^2]
- [Interoperability: error types are meaningful and well-behaved (C-GOOD-ERR)](https://rust-lang.github.io/api-guidelines/interoperability.html) — Rust API Guidelines, living. Backs: implement `Error`, `Send + Sync`, never `()`, message style. [^3]
- [Crate thiserror 2.0.21](https://docs.rs/thiserror/2.0.21/thiserror/) — David Tolnay, docs.rs, living. Backs: `#[error]`, `#[from]`, `#[source]`, `source` field, `transparent`, backtrace on nightly, not in public API. [^4]
- [Crate anyhow 1.0.105](https://docs.rs/anyhow/1.0.105/anyhow/) — David Tolnay, docs.rs, living. Backs: `anyhow::Result`, `Context`, macros, backtrace capture and environment variables. [^5]
- [Struct `anyhow::Error`](https://docs.rs/anyhow/1.0.105/anyhow/struct.Error.html) — David Tolnay, docs.rs, living. Backs: display representations, one-word size, `Send + Sync + 'static`, `chain`, `root_cause`, `downcast_ref`, `Deref` to `dyn Error`. [^6]
- [Module `std::backtrace`](https://doc.rust-lang.org/std/backtrace/index.html) — Rust project, living. Backs: `RUST_LIB_BACKTRACE` and `RUST_BACKTRACE`, capture cost, `force_capture`. [^7]
- [Recoverable Errors with `Result`](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html) — The Rust Programming Language, living. Backs: `Box<dyn Error>` as "any kind of error". [^8]
- [Module `std::error`](https://doc.rust-lang.org/std/error/index.html) — Rust project, living. Background: the `Error` trait as the expectations for `E` in `Result<T, E>`.

## Related
- `rust/errors/panic-result-and-error-propagation.md` — `?`, `From` and `main` returning `Result`.
- `error-handling/library-vs-application-errors.md` — typed library errors versus application context, across languages.
- `error-handling/handle-errors-once.md` — add context while propagating, report once.
- `rust/traits-and-generics/trait-objects-and-dynamic-dispatch.md` — `dyn Trait`, vtables and `Any`.
- `rust/macros/procedural-macros.md` — how a derive such as `thiserror` is built.
