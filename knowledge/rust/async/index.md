---
schema: topic-index/v1
kind: subtopic
topic: rust/async
last-updated: 2026-11-24
---

# Async Rust

How `async`/`await` works underneath: the `Future` trait, `poll`, `Context` and `Waker`, `async fn` as a compiler-built state machine, a minimal executor written with `std` only, future sizes, `join`/`select` and streams; why futures need `Pin` and what `Unpin`, `pin!`, `Box::pin` and pin projection mean; and the Tokio runtime: flavors, `spawn` and its `Send + 'static` bounds, `JoinHandle`/`JoinSet`/`abort`, `spawn_blocking`, `select!`, cancellation and cancellation safety, timeouts and the four Tokio channel types. Consolidates The Rust Programming Language, chapter 17. Not covered: `Send`/`Sync` themselves (`rust/concurrency/threads-channels-and-locks.md`), `async fn` in traits (`rust/traits-and-generics/advanced-traits-and-type-system.md`), async I/O and networking APIs, and runtimes other than Tokio.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [futures-and-async-await.md](futures-and-async-await.md) | concept | The `Future` trait, laziness, executor/task/waker/reactor, `.await` desugaring, a `std`-only `block_on`, future sizes, `join` vs `select`, streams | verified |
| [pin-and-unpin.md](pin-and-unpin.md) | concept | Why self-referential futures need `Pin`, `Unpin` and `PhantomPinned`, `pin!` vs `Box::pin`, the Drop guarantee, pin projection and its rules | verified |
| [tokio-runtime-tasks-and-cancellation.md](tokio-runtime-tasks-and-cancellation.md) | concept | Runtime flavors, `#[tokio::main]`, `spawn` bounds, `JoinSet`/`abort`, `spawn_blocking`, `select!` and cancel safety, `timeout`, `mpsc`/`oneshot`/`broadcast`/`watch`, tasks vs threads | verified |

## References
- [Fundamentals of Asynchronous Programming: Async, Await, Futures, and Streams](https://doc.rust-lang.org/book/ch17-00-async-await.html) — The Rust Programming Language (Rust project), living. Backs: subtopic scope (chapter 17).
- [Introduction](https://rust-lang.github.io/async-book/) — Asynchronous Programming in Rust (Rust Async Working Group), living. Backs: subtopic scope.
- [Tutorial](https://tokio.rs/tokio/tutorial) — Tokio project, living. Backs: Tokio scope.

## Related
- `rust/concurrency/` — threads, locks, `Send`/`Sync`, atomics.
- `concurrency/blocking-in-async-runtimes.md` — blocking inside async runtimes, across languages.
- `concurrency/structured-concurrency.md` — owning and cancelling child tasks.
