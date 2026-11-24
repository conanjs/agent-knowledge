---
schema: knowledge-doc/v1
type: concept
topic: rust/concurrency
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, concurrency, threads, thread-scope, mpsc, channels, mutex, rwlock, poisoning, arc, condvar, oncelock, lazylock, send, sync, deadlock, thread-pool]
---

# Threads, channels and locks in Rust

## Summary
**TL;DR:** `thread::spawn` runs a `Send + 'static` closure on a new operating-system (OS) thread and returns a `JoinHandle`; `thread::scope` lets threads borrow local variables because it joins them before it returns. Data either moves between threads through `mpsc` channels or stays shared behind `Arc<Mutex<T>>` / `Arc<RwLock<T>>`, whose guard unlocks when it is dropped. Two auto traits make the compiler enforce this: `Send` (a value may move to another thread) and `Sync` (`&T` may be shared). What the compiler does not catch: deadlocks, poisoning after a panic, and a guard that lives longer than the line suggests.
**Use this when:** spawning threads, choosing between a channel and a lock, reading an E0277 "cannot be sent/shared between threads safely" or E0373 error, recovering a poisoned `Mutex`, waiting with `Condvar`, or building a worker pool.
**Not this doc:** what a data race is, across languages → `concurrency/shared-state-and-data-races.md`; atomics and memory ordering → `rust/concurrency/atomics-and-memory-ordering.md`; how a lock, a channel and `Arc` are built from atomics → `rust/concurrency/building-a-spinlock-channel-and-arc.md`; single-thread `Rc`/`RefCell` → `rust/smart-pointers/rc-refcell-and-interior-mutability.md`; async tasks → `rust/async/tokio-runtime-tasks-and-cancellation.md`; capture modes of closures → `rust/closures-and-iterators/closures-and-fn-traits.md`.

## Problem
Threads share one address space, so the hard part is deciding who may touch what, and when. The usual surprises:
- A spawned thread is silently stopped when `main` returns.
- A closure that borrows a local fails with E0373; an `Rc` that worked in single-threaded code fails with E0277.
- One panic poisons a `Mutex`, and every later `lock().unwrap()` panics too.
- Two threads that take two locks in opposite order hang forever; one thread can hang itself by locking the same mutex twice in one statement.
- A worker pool that keeps its queue lock while it runs a job runs jobs one at a time.

## Mental model
**Analogy:** a kitchen with several cooks (threads). Handing an ingredient to another cook gives it away (`move`, which needs `Send`). The order window (a channel) passes plates one way. The spice cabinet (data inside a `Mutex`) has one key; holding the key is holding the guard, and the key goes back on the hook the moment your hand lets go of it (the guard is dropped). A recipe card can be read by several cooks at once only if reading cannot change it (`Sync`).

**Artifact:** the compiler refuses a non-atomic reference count and accepts the atomic one ✅[^1]:
```rust
let hits = Rc::new(5);
let h2 = Rc::clone(&hits);
let t = thread::spawn(move || println!("{h2}"));
// error[E0277]: `Rc<i32>` cannot be sent between threads safely
//   = help: within `{closure@t03_rc_bad.rs:6:27: 6:34}`, the trait `Send` is not implemented for `Rc<i32>`
```
```rust
let hits = Arc::new(Mutex::new(0u32));
let handles: Vec<_> = (0..4)
    .map(|_| {
        let hits = Arc::clone(&hits); // one owner handle per thread
        thread::spawn(move || {
            for _ in 0..1000 {
                *hits.lock().unwrap() += 1;
            }
        })
    })
    .collect();
for h in handles {
    h.join().unwrap();
}
println!("hits = {}, owners left = {}", *hits.lock().unwrap(), Arc::strong_count(&hits));
// hits = 4000, owners left = 1
```
`Arc` shares ownership; the `Mutex` inside it is what makes the mutation safe. `Arc` alone adds no thread safety to the data it holds ✅[^4][^17].

## How it works
1. **Spawn and join.** `thread::spawn(f)` starts an OS thread running `f` and returns a `JoinHandle<T>`; `join()` blocks until the thread ends and returns `Ok(value)`, or `Err(payload)` if it panicked ✅[^2][^8]. Measured: a thread computing `(1..=10).sum()` joined to `55`; a thread built with `Builder::new().name("parser-7")` that panicked gave `Err` with the payload `"bad token"`, and the panic message named `parser-7` ✅[^1].
2. **`main` ending ends everything.** When the main thread returns, the whole process exits; other threads stop and their destructors may not run. Dropping a `JoinHandle` detaches its thread ✅[^8]. Measured: a detached thread that slept 200 ms never printed ✅[^1].
3. **Why `move` and `'static`.** The new thread may outlive the caller, so `spawn` accepts only `F: Send + 'static`. A closure that borrows a local fails with E0373 "closure may outlive the current function, but it borrows `names`", and the compiler suggests `move` ✅[^1][^2].
4. **Scoped threads borrow.** `thread::scope` joins every thread spawned on its `Scope` before returning, so those threads may borrow non-`'static` data, even mutably ✅[^9]. Measured ✅[^1]:
   ```rust
   let words = vec!["alpha", "beta", "gamma", "delta"];
   let mut total_len = 0;
   thread::scope(|s| {
       let (left, right) = words.split_at(2);
       let a = s.spawn(|| left.iter().map(|w| w.len()).sum::<usize>());
       let b = s.spawn(|| right.iter().map(|w| w.len()).sum::<usize>());
       total_len = a.join().unwrap() + b.join().unwrap();
   });
   println!("words = {words:?}, total_len = {total_len}");
   // words = ["alpha", "beta", "gamma", "delta"], total_len = 19
   ```
   A panic in a scoped thread that you did not join yourself makes `scope` panic when it joins it ✅[^1][^9].
5. **`Send` and `Sync`.** `T: Send` means ownership of a `T` may move to another thread; `T: Sync` means `&T` may, so `T` is `Sync` exactly when `&T` is `Send` ✅[^5]. Both are auto traits: a type built only from `Send` (or `Sync`) parts gets the trait automatically, and implementing either by hand is `unsafe` ✅[^5]. The common types:

   | Type | `Send` | `Sync` | Why |
   |---|---|---|---|
   | `Rc<T>` | no | no | its count is updated without atomics ✅[^5] |
   | `Cell<T>`, `RefCell<T>` | yes, if `T: Send` | no | unsynchronized interior mutability; `&Cell` across threads is E0277 ✅[^1][^5][^18] |
   | `Arc<T>` | if `T: Send + Sync` | if `T: Send + Sync` | every clone hands out `&T`; `Arc<Cell<_>>` into a thread is E0277 ✅[^1][^17] |
   | `Mutex<T>` | if `T: Send` | if `T: Send` | only one thread at a time reaches the `T`; `&Mutex<Cell<_>>` is accepted ✅[^1][^10] |
   | `RwLock<T>` | if `T: Send` | if `T: Send + Sync` | several readers hold `&T` at once ✅[^11] |
   | `MutexGuard<'_, T>` | no | if `T: Sync` | POSIX (Portable Operating System Interface) threads must unlock on the thread that locked; sending a guard is E0277 ✅[^1][^16] |
   | `*const T`, `*mut T` | no | no | a type built on them must opt in with `unsafe impl` (see `rust/concurrency/building-a-spinlock-channel-and-arc.md`) ✅[^18] |

6. **Channels.** `mpsc::channel()` returns `(Sender<T>, Receiver<T>)`: many producers (clone the `Sender`), one consumer ✅[^3]. `send` moves the value into the channel, so using it afterwards is E0382 ✅[^3]. `recv` blocks; `try_recv` never blocks ✅[^3]. When every `Sender` is gone, `recv` returns `Err` and `for x in rx` ends; when the `Receiver` is gone, operations on the other half return `Err` ✅[^15]. `sync_channel(n)` has a buffer of `n` and `send` blocks while it is full; `n = 0` makes each send a hand-off ✅[^15]. Measured: two producers × 3 messages gave 6 messages after `drop(tx)`; `send` to a dropped receiver gave `Err(SendError { .. })`; `try_recv` gave `Err(Empty)`, then `Err(Disconnected)` once the senders were gone; with `sync_channel(1)`, the second `send` waited at least 250 ms until the receiver took a value ✅[^1].
7. **`Mutex<T>` and its guard.** The data lives inside the mutex, so the only way to it is `lock()`, which returns `LockResult<MutexGuard<T>>`. The guard derefs to `T` and unlocks in its `Drop`; there is no public `unlock` ✅[^4][^6]. A guard created inside an expression is a temporary: it lives to the end of the statement, and in the scrutinee of `if let`, `while let` or `match` it lives through the whole body ✅[^6][^18][^19]. Temporary lifetimes in general → `rust/ownership/ownership-moves-and-drop.md`.
8. **Poisoning.** A mutex whose holder panicked is poisoned: later `lock()` calls return `Err(PoisonError)`, but the error still carries the guard (`into_inner`), because poisoning is only advisory; `clear_poison` resets the flag ✅[^10]. Measured: a "transfer" that panicked after `g[0] -= 30` left `[70, 50]`; after the repair `g[1] += 30` and `clear_poison()`, the data was `[70, 80]` and the mutex was no longer poisoned ✅[^1]:
   ```rust
   match ledger.lock() {
       Ok(_) => println!("lock ok"),
       Err(poisoned) => {
           let g = poisoned.into_inner(); // recover the guard anyway
           println!("lock Err(PoisonError); data seen through into_inner = {:?}", *g);
       }
   }
   // lock Err(PoisonError); data seen through into_inner = [70, 50]
   ```
9. **`RwLock<T>`.** Many readers or one writer. Which side goes first under contention depends on the operating system, and a second `read()` on a thread that already holds one may deadlock if a writer is waiting ✅[^11]. Measured: two read guards at once while `try_write` failed ✅[^1].
10. **`Condvar`.** Lets a thread sleep until a condition may have changed. `wait(guard)` unlocks the mutex and sleeps in one atomic step, and relocks before it returns. Wakeups can be spurious, so re-check the condition in a loop or use `wait_while`. A `notify_one` with no waiting thread is lost. Use one mutex per condvar ✅[^12]. Measured: a consumer using `wait_while(queue.lock().unwrap(), |q| q.is_empty())` received `resize`, `upload`, then stopped at `STOP` ✅[^1].
11. **One-time initialization.** `OnceLock<T>` is written once, and the caller chooses the initializer at `get_or_init`; `LazyLock<T>` fixes its initializer at construction and runs it on first use. Both work in a `static` ✅[^13][^14]. If several threads race, only one initializer runs, provided it does not panic ✅[^13]; measured: 8 racing threads, 1 initializer call ✅[^1].

## Worked example
A three-thread pool with graceful shutdown, in the spirit of the thread pool in the Book's final project (chapter 21 builds a web server, then a pool, then its shutdown ✅[^6][^7][^20]); the code is our own.

**4 actors:**
- **Submitter (main thread)** — its job: queue tasks, via `Pool::submit`, which calls `Sender::send`.
- **Channel** — its job: keep tasks in order and report when every sender is gone, via `std::sync::mpsc`.
- **Crew threads (3)** — their job: take one task at a time and run it, via `lock()` then `recv()` on a shared `Arc<Mutex<Receiver<Task>>>`.
- **`Drop for Pool`** — its job: shut the pool down, via dropping the `Sender`, then `join` on each handle.

```rust
type Task = Box<dyn FnOnce() + Send + 'static>;

struct Pool {
    inbox: Option<mpsc::Sender<Task>>,            // Option: Drop must take it out
    crew: Vec<(usize, thread::JoinHandle<usize>)>, // each thread returns its task count
}

impl Pool {
    fn with_threads(n: usize) -> Pool {
        assert!(n > 0, "a pool needs at least one thread");
        let (tx, rx) = mpsc::channel::<Task>();
        let rx = Arc::new(Mutex::new(rx)); // one Receiver, shared by n threads
        let crew = (0..n)
            .map(|id| {
                let rx = Arc::clone(&rx);
                let h = thread::spawn(move || {
                    let mut done = 0;
                    loop {
                        let next = rx.lock().unwrap().recv(); // guard dropped at the `;`
                        match next {
                            Ok(task) => { task(); done += 1; }
                            Err(_) => return done, // every Sender is gone: stop
                        }
                    }
                });
                (id, h)
            })
            .collect();
        Pool { inbox: Some(tx), crew }
    }

    fn submit(&self, f: impl FnOnce() + Send + 'static) {
        self.inbox.as_ref().unwrap().send(Box::new(f)).unwrap();
    }
}

impl Drop for Pool {
    fn drop(&mut self) {
        drop(self.inbox.take()); // 1. close the channel: recv() returns Err once empty
        for (id, h) in self.crew.drain(..) {
            let done = h.join().unwrap(); // 2. then wait for each thread
            println!("crew-{id} exited after {done} task(s)");
        }
    }
}
```
`main` submits six tasks that each sleep 100 ms and send `(n, n * n)` back on a results channel, inside a block, so the pool is dropped at the block's end.

```
main (submitter)                 channel                     crew-0 / crew-1 / crew-2
submit(t1..t6) ── send ──▶ [t1 t2 t3 t4 t5 t6]
                                   │ ◀── lock(); recv() ──  let next = ...;   (guard dropped)
                                   │ ─── task ──────────▶   task() runs, lock is free
block ends → Drop for Pool:
  inbox.take() dropped ──────▶ no Sender left
                                   │ ─── Err ───────────▶   return done  (thread ends)
  join(crew-0..2) ◀────────────────────────────────────────  task counts 2, 2, 2
```

1. **Main:** `with_threads(3)` creates one channel and wraps its single `Receiver` in `Arc<Mutex<…>>`, because an `mpsc` channel has exactly one consumer ✅[^6].
2. **Main → channel:** six `submit` calls box each closure as a `Task` and `send` it. An unbounded channel never blocks a sender ✅[^15].
3. **Crew:** each thread runs `let next = rx.lock().unwrap().recv();`. The guard is a temporary of that `let`, dropped at the `;`, so the lock is free while `task()` runs ✅[^6].
4. **Main, at the block's end:** `Drop for Pool` drops the `Sender`. Tasks still queued are delivered; after that, `recv()` returns `Err` ✅[^7][^15].
5. **Crew → main:** on `Err`, each thread returns its task count and `Drop` joins them one by one. Joining before dropping the `Sender` would hang, because each crew thread would still be blocked in `recv()` ✅[^7].

Measured, 3 runs, each the same ✅[^1]:
```
crew-0 exited after 2 task(s)
crew-1 exited after 2 task(s)
crew-2 exited after 2 task(s)
6 tasks x 100 ms on 3 threads took ~200 ms
results = [(1, 1), (2, 4), (3, 9), (4, 16), (5, 25), (6, 36)]
```
Replacing the loop with `while let Ok(task) = rx.lock().unwrap().recv() { task(); done += 1; }` still compiles and still returns all six results, but the guard now lives through `task()`: the three runs took about 620, 610 and 610 ms, with task counts 3/3/0, 5/1/0 and 4/2/0 ✅[^1][^6].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `println!("{} {}", *m.lock().unwrap(), *m.lock().unwrap())` | Hung until `timeout 3` killed it (exit code 124) | The first guard is a temporary still alive when the second `lock()` runs on the same thread; relocking "will not return" and may deadlock or panic ✅[^1][^10] |
| Thread 1 locks A then B, thread 2 locks B then A | Each one's `try_lock` on its second lock returned `Err(WouldBlock)`; with `lock()` both would wait forever | A cycle of waits; Rust's types do not prevent deadlock ✅[^1][^4] |
| The same accounts, always locked A then B, by 8 threads × 10,000 transfers | Finished; A = 100, B = 100, sum 200 | A single global lock order cannot form a cycle ✅[^1] |
| `if let Some(j) = m.lock().unwrap().pop() { … }` | `m.try_lock()` inside the body fails, in edition 2021 and 2024 | Scrutinee temporaries live through the then-block ✅[^1][^19] |
| The `else` block of that `if let` | Edition 2021: lock still held (`try_lock` fails); edition 2024: already released | Edition 2024 drops scrutinee temporaries before entering `else` ✅[^1][^19] |
| A reader panics while holding `read()` | Not poisoned | Only a panicking writer poisons an `RwLock` ✅[^1][^11] |
| A writer panics after a partial update | Poisoned; `into_inner` shows the half-written `v1-half` | The invariant may be broken, so the lock reports it ✅[^1][^11] |
| `Condvar::wait` called without a loop | Can return while the condition is still false | Spurious wakeups ✅[^12] |
| `LazyLock` initializer panics | Every later access panics with "LazyLock instance has previously been poisoned" | Its poisoning cannot be cleared ✅[^1][^14] |
| `OnceLock::get_or_init` initializer panics | The cell stays empty; the next `get_or_init` runs again | `OnceLock` is never poisoned ✅[^1][^13] |
| `for x in rx` while the original `Sender` is still in scope | The loop never ends | `recv` returns `Err` only when every `Sender` is dropped ✅[^15] |
| Deep recursion in a spawned thread | Overflows sooner than you might expect | Default stack is 2 MiB (mebibytes) on Tier-1 platforms; change it with `Builder::stack_size` or `RUST_MIN_STACK` ✅[^8] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `thread::spawn` + `JoinHandle` | The thread may outlive the caller and return a value | Data must be `'static`: `move` it, share it with `Arc`, or leak it |
| `thread::scope` | Borrows locals; every thread is joined automatically | The caller waits until all of them finish |
| `mpsc::channel` | One owner at a time; no locks in user code | Unbounded: a fast producer grows the queue without limit |
| `mpsc::sync_channel(n)` | Backpressure | `send` can block |
| `Arc<Mutex<T>>` | Simplest shared state | Contention, deadlock risk, poisoning |
| `Arc<RwLock<T>>` | Readers run in parallel | Fairness depends on the OS; needs `T: Sync` |
| Atomics | No blocking | Harder to get right → `rust/concurrency/atomics-and-memory-ordering.md` |

## Takeaways
- Use `thread::scope` when the threads' work ends inside the function; use `spawn` plus `Arc` only when the threads must outlive it.
- Take a guard in its own `let` statement before an `if let`, `while let` or `match` that does work, so the lock is not held through the body. [rule-candidate]
- Never lock the same mutex twice in one statement. [rule-candidate]
- Take several locks in one global order everywhere in the program. [rule-candidate]
- Decide what poisoning means for your data: propagate it with `unwrap()`, or call `into_inner()` only after you repair the invariant, then `clear_poison()`.
- Call `Condvar::wait` in a loop, or use `wait_while`. [rule-candidate]
- In a `Drop` that shuts workers down, close the channel before joining the threads. [rule-candidate]

## Verification status
- Verified: 56 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Using Threads to Run Code Simultaneously](https://doc.rust-lang.org/book/ch16-01-threads.html) — The Rust Programming Language (Rust project), living. Backs: `spawn`/`join`, E0373 and `move`. [^2]
- [Transfer Data Between Threads with Message Passing](https://doc.rust-lang.org/book/ch16-02-message-passing.html) — The Rust Programming Language (Rust project), living. Backs: `mpsc`, `send` moves its value, `recv`/`try_recv`, cloning the `Sender`. [^3]
- [Shared-State Concurrency](https://doc.rust-lang.org/book/ch16-03-shared-state.html) — The Rust Programming Language (Rust project), living. Backs: `Mutex` methods and guard, `Arc`, deadlocks are not prevented. [^4]
- [Extensible Concurrency with `Send` and `Sync`](https://doc.rust-lang.org/book/ch16-04-extensible-concurrency-sync-and-send.html) — The Rust Programming Language (Rust project), living. Backs: definitions of `Send`/`Sync`, auto traits, manual impls are unsafe, `Rc`/`RefCell` rows. [^5]
- [From Single-Threaded to Multithreaded Server](https://doc.rust-lang.org/book/ch21-02-multithreaded.html) — The Rust Programming Language (Rust project), living. Backs: the pool shape, `Arc<Mutex<Receiver>>`, `let` versus `while let` guard lifetime, no `unlock` method. [^6]
- [Graceful Shutdown and Cleanup](https://doc.rust-lang.org/book/ch21-03-graceful-shutdown-and-cleanup.html) — The Rust Programming Language (Rust project), living. Backs: drop the sender before joining, the hang otherwise. [^7]
- [std::thread](https://doc.rust-lang.org/std/thread/index.html) — Rust standard library, living. Backs: main-thread exit, `join` result, detaching, `Builder`, 2 MiB default stack, `RUST_MIN_STACK`. [^8]
- [scope in std::thread](https://doc.rust-lang.org/std/thread/fn.scope.html) — Rust standard library, living. Backs: automatic join, borrowing non-`'static` data, panic propagation. [^9]
- [Mutex in std::sync](https://doc.rust-lang.org/std/sync/struct.Mutex.html) — Rust standard library, living. Backs: poisoning, `into_inner`, `clear_poison`, relocking on the same thread, `Send`/`Sync` bounds. [^10]
- [RwLock in std::sync](https://doc.rust-lang.org/std/sync/struct.RwLock.html) — Rust standard library, living. Backs: OS-dependent priority, recursive-read deadlock, writer-only poisoning, `Sync` bound. [^11]
- [Condvar in std::sync](https://doc.rust-lang.org/std/sync/struct.Condvar.html) — Rust standard library, living. Backs: `wait`, spurious wakeups, `wait_while`, unbuffered notify, one mutex per condvar. [^12]
- [OnceLock in std::sync](https://doc.rust-lang.org/std/sync/struct.OnceLock.html) — Rust standard library, living. Backs: one initializer runs, never poisoned, comparison with `LazyLock`. [^13]
- [LazyLock in std::sync](https://doc.rust-lang.org/std/sync/struct.LazyLock.html) — Rust standard library, living. Backs: initialization on first access, use in statics, unrecoverable poisoning. [^14]
- [std::sync::mpsc](https://doc.rust-lang.org/std/sync/mpsc/index.html) — Rust standard library, living. Backs: `channel` versus `sync_channel`, rendezvous with bound 0, disconnection. [^15]
- [MutexGuard in std::sync](https://doc.rust-lang.org/std/sync/struct.MutexGuard.html) — Rust standard library, living. Backs: guard is `!Send` because of POSIX threads, `Sync` if `T: Sync`. [^16]
- [Arc in std::sync](https://doc.rust-lang.org/std/sync/struct.Arc.html) — Rust standard library, living. Backs: `Arc<T>` is `Send`/`Sync` only if `T` is both, and adds no thread safety to `T`. [^17]
- [Chapter 1. Basics of Rust Concurrency](https://mara.nl/atomics/basics.html) — Mara Bos, Rust Atomics and Locks, 2023. Backs: `Cell` is `Send` but not `Sync`, raw pointers, guard temporaries in `if let`/`match`. [^18]
- [`if let` temporary scope](https://doc.rust-lang.org/edition-guide/rust-2024/temporary-if-let-scope.html) — The Rust Edition Guide (Rust project), living. Backs: edition 2024 drops scrutinee temporaries before `else`, then-block unchanged. [^19]
- [Building a Single-Threaded Web Server](https://doc.rust-lang.org/book/ch21-01-single-threaded.html) — The Rust Programming Language (Rust project), living. Backs: the chapter 21 starting point the pool is added to. [^20]

## Related
- `concurrency/shared-state-and-data-races.md` — data races and synchronization across Go, Rust, Python and TypeScript.
- `concurrency/structured-concurrency.md` — scoped lifetimes for concurrent work in general.
- `rust/concurrency/atomics-and-memory-ordering.md` — what a `Mutex` is built on.
- `rust/concurrency/building-a-spinlock-channel-and-arc.md` — a lock, a channel and an `Arc` from scratch.
- `rust/smart-pointers/rc-refcell-and-interior-mutability.md` — the single-thread counterparts.
- `rust/async/tokio-runtime-tasks-and-cancellation.md` — tasks instead of threads.
- `rust/project-structure/build-a-single-threaded-web-server.md` — the single-threaded HTTP server (Rust Book 21.1) that a pool like this one parallelizes.
