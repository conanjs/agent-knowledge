---
schema: topic-index/v1
kind: subtopic
topic: rust/concurrency
last-updated: 2026-11-24
---

# Rust concurrency: threads, locks and atomics

Threads in Rust from the Book's chapters 16 and 21 to the internals covered by Rust Atomics and Locks (chapters 1–6): spawning and scoped threads, `mpsc` channels, `Mutex`, `RwLock`, `Condvar`, `OnceLock`/`LazyLock`, `Arc`, the `Send` and `Sync` rules, deadlocks and a worker pool with graceful shutdown; then atomic operations, the five memory orderings, happens-before, fences, `compare_exchange` and model checking with loom; then a spin lock, a one-shot channel and an `Arc` built from atomics and checked with Miri. Every behaviour ran in the Rust 1.100.0 lab on aarch64, where weak orderings fail visibly. Not covered: async tasks and the Tokio runtime (`rust/async/`), data races as a cross-language idea (`concurrency/shared-state-and-data-races.md`), `unsafe` and Miri in general (`rust/unsafe/`), and crates such as crossbeam or rayon.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [threads-channels-and-locks.md](threads-channels-and-locks.md) | concept | `spawn`/`join`, `move`, `thread::scope`, `mpsc`, `Mutex`/`RwLock` and poisoning, `Condvar`, `OnceLock`/`LazyLock`, `Send`/`Sync`, deadlocks, guard lifetimes, a thread pool with graceful shutdown | verified |
| [atomics-and-memory-ordering.md](atomics-and-memory-ordering.md) | concept | Atomic types and operations, `Relaxed`/`Acquire`/`Release`/`AcqRel`/`SeqCst`, happens-before, fences, `compare_exchange` versus `_weak`, aarch64 litmus tests, loom | verified |
| [building-a-spinlock-channel-and-arc.md](building-a-spinlock-channel-and-arc.md) | concept | A spin lock with a guard, a blocking one-shot channel and an `Arc` from atomics: `UnsafeCell`, `unsafe impl Sync`, why each ordering, Miri catching planted bugs | verified |

## References
- [Fearless Concurrency](https://doc.rust-lang.org/book/ch16-00-concurrency.html) — The Rust Programming Language (Rust project), living. Backs: subtopic scope (Book chapter 16).
- [Final Project: Building a Multithreaded Web Server](https://doc.rust-lang.org/book/ch21-00-final-project-a-web-server.html) — The Rust Programming Language (Rust project), living. Backs: subtopic scope (Book chapter 21).
- [Rust Atomics and Locks](https://mara.nl/atomics/) — Mara Bos, 2023. Backs: subtopic scope (chapters 1–6).

## Related
- `rust/index.md` — the Rust topic and its other subtopics.
- `concurrency/shared-state-and-data-races.md` — data races and synchronization across languages.
- `concurrency/structured-concurrency.md` — owned task scopes across languages.
- `rust/async/` — futures, `Pin` and the Tokio runtime.
