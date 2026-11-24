---
schema: knowledge-doc/v1
type: concept
topic: rust/async
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "tokio 1.54"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, async, tokio, runtime, spawn, joinset, spawn-blocking, select, cancellation, cancel-safety, timeout, channels]
---

# The Tokio runtime: tasks and cancellation

## Summary
**TL;DR:** A Tokio runtime bundles a scheduler, an I/O driver and a timer; `#[tokio::main]` only wraps your `main` body in `Builder::new_multi_thread().enable_all().build()…block_on(body)`. `tokio::spawn` turns a future into a **task** that starts at once and may move between worker threads at every `.await`, so it must be `Send + 'static`; its `JoinHandle` can be awaited or aborted, but dropping the handle only detaches the task. **Cancelling is dropping:** `select!`, `timeout`, `abort`, dropping a `JoinSet` and runtime shutdown all drop a future at the `.await` where it is suspended, so whatever it held in local variables is lost, and code used inside `select!` loops must be cancel safe. Channels: `mpsc` (queue with backpressure), `oneshot` (one reply), `broadcast` (every receiver sees every value, slow ones lag), `watch` (latest value only).
**Use this when:** you set up a Tokio runtime, `tokio::spawn` fails to compile, tasks vanish or never finish, messages go missing in a `select!` loop, or you pick a channel type or between tasks and threads.
**Not this doc:** `Future`, `poll` and wakers → `rust/async/futures-and-async-await.md`; `Pin` and `tokio::pin!` background → `rust/async/pin-and-unpin.md`; `Send`/`Sync` themselves → `rust/concurrency/threads-channels-and-locks.md`; why blocking stalls any async runtime → `concurrency/blocking-in-async-runtimes.md`; owning and joining child tasks as a principle → `concurrency/structured-concurrency.md`.

## Problem
Rust has no built-in runtime, so the behaviour of tasks is the runtime's. Common surprises with Tokio: `tokio::spawn` rejects a future because an `Rc` or a `std::sync::MutexGuard` lives across an `.await`; a spawned task's work silently never happens because `main` returned first; a `select!` loop drops half-read data every time a timer branch wins; one `std::thread::sleep` freezes every task on a `current_thread` runtime; and calling `block_on` from async code panics.

## Mental model
**Analogy:** the runtime is a restaurant kitchen. A few cooks (worker threads) share the order tickets (tasks). A cook works on a ticket until it says "waiting for the oven" (`.await` returns `Pending`), sets it aside and takes another; when the oven bell rings (the driver calls a waker), the ticket goes back in the queue and **any** cook may continue it, which is why everything clipped to a ticket must be safe to hand to another cook (`Send`). Tearing up a ticket (dropping the future) is cancelling: the dish stops at whatever step it had reached.

**Artifact:** where tasks run under each flavor, and what `#[tokio::main]` expands to ✅[^1]:
```rust
// each of 16 spawned tasks yields once, then reports std::thread::current()
let rt = Builder::new_current_thread().enable_all().build().unwrap();
rt.block_on(where_tasks_run());
let rt = Builder::new_multi_thread().enable_all().build().unwrap();
rt.block_on(where_tasks_run());
```
```console
main thread: ThreadId(1)
  block_on future runs on ThreadId(1) main
current_thread: workers=1, distinct threads=1 ["ThreadId(1) main"]
  block_on future runs on ThreadId(1) main
multi_thread:   workers=8, distinct threads=2
    ThreadId(3) tokio-rt-worker
    ThreadId(8) tokio-rt-worker
```
`#[tokio::main] async fn main() { println!("hi"); }` expanded with `-Zunpretty=expanded` (a type check on `body` elided):
```rust
fn main() {
    let body = async { { ::std::io::_print(format_args!("hi\n")); }; };
    return Builder::new_multi_thread().enable_all().build()
        .expect("Failed building the Runtime").block_on(body);
}
```

## How it works
**5 actors:**
- **Your `main`** — its job: build the runtime and drive the root future, via `Runtime::block_on` (what `#[tokio::main]` generates).
- **Scheduler** — its job: poll ready tasks, via worker threads that steal work from each other (`multi_thread`) or via the `block_on` thread alone (`current_thread`).
- **Task** — its job: own one spawned future until it finishes or is dropped, via `tokio::spawn` and the `JoinHandle` it returns.
- **Driver and timer** — its job: turn OS I/O readiness and expired timers into `wake` calls, via the runtime's I/O event loop and timer.
- **Blocking pool** — its job: run closures that block, via the extra threads behind `spawn_blocking`.

```
 main thread                   worker threads (tokio-rt-worker × cores)     driver + timer
 ───────────                   ────────────────────────────────────────     ──────────────
 Runtime::block_on(body)
   │ tokio::spawn(fut) ──────▶ task queued on a worker
   │ returns JoinHandle         │
   │                            worker polls task ─▶ .await → Pending ────▶ waker stored with
   │                            worker runs other tasks;                     a socket or timer
   │                            idle workers steal queued tasks                 │ ready
   │                            ◀──────────── wake: task queued again ──────────┘
   │                            any worker polls it ─▶ Ready(v)
   │ handle.await ◀─────────── Ok(v) or Err(JoinError)
   ▼
 body ends → Runtime dropped → unfinished tasks dropped at their next yield
                   spawn_blocking(f) ──▶ blocking-pool thread runs f to its end
```

1. **Your `main`:**
   - `#[tokio::main]` builds a multi-thread runtime with every driver enabled and calls `block_on(body)` ✅[^4] ✅[^1]; `flavor = "current_thread"` makes it `Builder::new_current_thread()` instead ✅[^1].
   - `enable_all` is shorthand for `enable_io` plus `enable_time` ✅[^3].
2. **Scheduler (setup):**
   - A runtime provides three services: an I/O event loop (the driver), a scheduler and a timer ✅[^2].
   - `multi_thread` starts one worker per CPU core, using `available_parallelism`, and balances tasks by work stealing ✅[^2] ✅[^3]. In the lab: 8 workers on 8 CPUs, named `tokio-rt-worker`, the documented default thread name ✅[^1] ✅[^3].
   - `current_thread` creates and runs every task on the current thread, and only while `block_on` is driving it ✅[^2]; the lab shows one worker, `ThreadId(1)` ✅[^1].
   - The future given to `block_on` runs on the calling thread, not as a worker ✅[^5]: spawned tasks in the lab ran on threads 3 and 8, never on `main` ✅[^1].
3. **Task (spawn):**
   - `tokio::spawn` starts the future in the background immediately, even if the handle is never awaited; it panics outside a runtime; the task may be sent to another thread ✅[^6].
   - Its bounds are `F: Future + Send + 'static` and `F::Output: Send + 'static` ✅[^6].
   - A task costs a single allocation and 64 bytes of memory ✅[^18]. In the lab, 100,000 tasks that each slept 100 ms finished in 217 ms of wall time (release build, 8 CPUs, aarch64 Docker; 471 ms in a debug build) ✅[^1].
4. **Task (`.await`), then driver:**
   - At an `.await` that returns `Pending`, the worker moves on; the driver wakes the task later (mechanism: `rust/async/futures-and-async-await.md`).
   - The runtime may resume the task on a different worker after any `.await`, so everything the task holds across an `.await` must be `Send` ✅[^18] ✅[^20].
5. **Task (completion):**
   - Awaiting the `JoinHandle` gives `Result<T, JoinError>`. A panic inside the task is caught and returned as a `JoinError` ✅[^7]: in the lab, `is_panic()` was `true` and the runtime kept running ✅[^1].
6. **Your `main` (shutdown):**
   - Dropping the `Runtime` shuts it down: spawned tasks run until they next yield and are then dropped, with no guarantee they finish; `spawn_blocking` work runs until it returns, and `Drop` waits for it ✅[^5].
   - Lab: a task that slept 50 ms before printing never printed once the runtime was dropped ✅[^1].

### `Send + 'static`: the errors and their fixes
Measured with tokio 1.54.1:

| Code inside `tokio::spawn(async { … })` | Result |
|---|---|
| `let shared = Rc::new(5); yield_now().await; use(shared)` | `error: future cannot be sent between threads safely`, note "has type `Rc<i32>` which is not `Send`", "await occurs here, with `shared` maybe used later" ✅[^1] |
| `let mut g = hits.lock().unwrap(); yield_now().await; *g += 1` (std `Mutex`) | Same error, "has type `std::sync::MutexGuard<'_, i32>` which is not `Send`" ✅[^1] |
| Same guard, ended with `drop(g);` just before the `.await` | Still the same error ✅[^1]: the check follows the variable's scope, as the Tokio tutorial warns ✅[^20] |
| `{ *hits.lock().unwrap() += 1; }` in an inner block, then the `.await` | Compiles ✅[^1] |
| `tokio::sync::Mutex` guard held across the `.await` | Compiles (`std = 1, tokio = 10`) ✅[^1] |
| `async { name.len() }` borrowing a local `String` | `error[E0373]: async block may outlive the current function, but it borrows name` ✅[^1]; `async move` fixes it ✅[^18] |
| `Rc` inside `tokio::task::spawn_local` on a `LocalSet` | Compiles and prints `spawn_local result = 10` ✅[^1] |

A `LocalSet` runs `!Send` tasks, all on one thread ✅[^17]. A std `Mutex` is fine in async code while contention is low and the guard never crosses an `.await`; Tokio's mutex can cross one but costs more ✅[^20].

### Blocking work: `spawn_blocking`
`spawn_blocking` runs a closure on a thread where blocking is acceptable; the pool grows on demand up to `max_blocking_threads` (512 by default) ✅[^9] ✅[^3]. Lab on a `current_thread` runtime, with a ticker task that records the time of each 100 ms tick ✅[^1]:
```console
runtime thread: ThreadId(1)
inline blocking: ticks at [300, 400, 500] ms (rounded down to 100)
spawn_blocking:  ticks at [100, 200, 300] ms; job ran on ThreadId(2) tokio-rt-worker
```
Inline `std::thread::sleep(350 ms)` held the only runtime thread, so every tick was late; the same sleep in `spawn_blocking` ran on another thread. A started blocking task cannot be aborted, and the docs suggest rayon for CPU-heavy work ✅[^9]. The general rule is owned by `concurrency/blocking-in-async-runtimes.md`.

### Handles: `JoinHandle`, `abort`, `JoinSet`
Lab output ✅[^1]:
```console
1. join_next order: ["fast", "mid", "slow"]
    drop aborted task's local
2. after abort: is_cancelled=true (task 12 was cancelled)
3. detached task still ran
4. dropping the JoinSet:
    drop a
    drop b
5. panicking task: is_panic=true; runtime still alive
```
1. A `JoinSet` returns results in completion order (spawned slow, fast, mid) ✅[^8].
2. `abort` drops the task's future, so its locals' destructors run, and awaiting the handle gives a cancelled `JoinError` ✅[^7].
3. Dropping a `JoinHandle` does not cancel: the task keeps running and its output is lost ✅[^7].
4. Dropping a `JoinSet` aborts every task in it at once ✅[^8], which makes it the tool for owning a group of child tasks (`concurrency/structured-concurrency.md`).

### Cancellation is dropping
A future can only be cancelled where it is suspended, at an `.await`; dropping it there runs the destructors of everything it holds ✅[^22] ✅[^19] ✅[^1]. `select!` polls all its branches concurrently on the current task, starts with a random branch unless the first line is `biased;`, and drops every branch that did not win ✅[^10]. Lab ✅[^1]:
```rust
struct Loud(&'static str);
impl Drop for Loud { fn drop(&mut self) { println!("  drop {}", self.0); } }
async fn job(name: &'static str, ms: u64) -> &'static str {
    let _g = Loud(name); sleep(Duration::from_millis(ms)).await; println!("  {name} finished"); name
}
let winner = tokio::select! { w = job("fast", 10) => w, w = job("slow", 1000) => w };
```
```console
  fast finished
  drop fast
  drop slow
winner = fast
```
`slow` never printed "finished": its future was dropped at its `sleep`. With `biased;` and two always-ready branches, three runs picked `["first", "first", "first"]` ✅[^1]. `tokio::time::timeout` works the same way: on expiry it returns `Err(Elapsed)` and the wrapped future is cancelled ✅[^12]; in the lab, `inner future dropped` printed before `timeout: Err(deadline has elapsed)`, and a future that finished in time gave `Ok(7)` ✅[^1].

### Channels
| Channel | Shape | Lab result |
|---|---|---|
| `mpsc` | Many producers, one consumer; capacity gives backpressure ✅[^13] | `channel(1)` full: `try_send` → `"no available capacity"`; `recv` → `Some(1)`, then `None` once every sender was dropped ✅[^1] ✅[^11] |
| `oneshot` | One value from one producer to one consumer; `send` is not async ✅[^13] ✅[^16] | Sender dropped unsent → `Err(RecvError(()))` ✅[^1] ✅[^16]; receiver dropped → `send(9)` returns `Err(9)`, handing the value back ✅[^1] |
| `broadcast` | Many to many; each receiver gets each value ✅[^13] | Capacity 2, five sends: the first receiver got `[Lagged(3), 4, 5]`; one subscribed after the first send got `[Lagged(2), 4, 5]` ✅[^1] ✅[^14] |
| `watch` | Only the most recent value is stored ✅[^13] | After sends `v1`, `v2`, `v3`, `changed()` then `borrow_and_update()` saw `v3`, and `has_changed()` was `false` ✅[^1] ✅[^15] |

### Tasks or threads
Threads are managed by the OS and each costs a fair amount of memory; they fit CPU-bound, parallel work. Tasks are managed by the runtime and are lighter; they fit I/O-bound work with many concurrent operations. The two combine: a thread that does blocking work can send results into an async channel ✅[^21]. The Async Book adds that spawning is usually less error-prone than combining futures in one task with `select!` ✅[^23].

## Worked example
Three ways to read a channel inside a `select!` loop, one of which loses data. A producer sends 1 to 9, one every 7 ms; the consumer loops on `select!` against a 10 ms `interval` ✅[^1]:
```rust
async fn read_frame(rx: &mut mpsc::Receiver<u32>) -> Option<Vec<u32>> {
    let mut frame = Vec::new();                    // partial progress lives inside the future
    while frame.len() < 3 { frame.push(rx.recv().await?); }
    Some(frame)
}
// A: recv() directly
loop { tokio::select! {
    m = rx.recv() => match m { Some(n) => got.push(n), None => break },
    _ = tick.tick() => {}
} }
// B: the hand-rolled reader, created again on every iteration
loop { tokio::select! {
    f = read_frame(&mut rx) => match f { Some(f) => got.extend(f), None => break },
    _ = tick.tick() => {}
} }
// C: create the reader once per frame, pin it, poll it by &mut until it finishes
loop {
    let frame = read_frame(&mut rx);
    tokio::pin!(frame);
    let done = loop { tokio::select! {
        f = &mut frame => break f,
        _ = tick.tick() => ticks += 1,
    } };
    match done { Some(f) => got.extend(f), None => break }
}
```
```console
recv in select:       [1, 2, 3, 4, 5, 6, 7, 8, 9]
read_frame in select: []
pinned once:          [1, 2, 3, 4, 5, 6, 7, 8, 9] (ticks while waiting: >0 = true)
```
| Variant | What happened | Why |
|---|---|---|
| A | Nothing lost | `recv` is cancel safe: if another branch wins, no message was taken from the channel ✅[^11] |
| B | All nine values lost | Each tick won before a frame reached 3 items; dropping `read_frame` dropped the `Vec` holding the items already received. Cancel safety means dropping an unfinished future and creating it again changes nothing ✅[^10]; this reader fails that test |
| C | Nothing lost, ticks still handled | The same future is resumed across iterations; awaiting it by `&mut` needs it pinned ✅[^19]. Keeping the buffer outside the future is the other fix |

The docs list `AsyncReadExt::read_exact`, `read_to_end`, `read_to_string` and `AsyncWriteExt::write_all` as not cancel safe (they can lose data), and `Mutex::lock`, `Semaphore::acquire` and `Notify::notified` as losing their place in a fair queue when cancelled ✅[^10]. The Async Book traces the root cause to state split between the future and its caller ✅[^22].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `tokio::spawn` outside a runtime | Panic: "there is no reactor running, must be called from the context of a Tokio 1.x runtime" ✅[^1] | `spawn` needs a current runtime ✅[^6] |
| `Runtime::block_on` inside async code | Panic: "Cannot start a runtime from within a runtime. This happens because a function (like `block_on`) attempted to block the current thread…" ✅[^1] | Documented panic ✅[^5]; use `.await` instead |
| `main` returns while spawned tasks still run | They are dropped; their later prints never appear ✅[^1] | Shutdown drops tasks at their next yield ✅[^5] |
| `abort()` on a `spawn_blocking` task that has started | No effect; shutdown waits for it ✅[^7] ✅[^9] | A started blocking closure always runs to its end |
| `is_finished()` right after `abort()` | May still be `false` ✅[^7] | Cancellation is not instant |
| Every `select!` branch disabled and no `else` | Panic ✅[^10] | Nothing left to wait for |
| `timeout` around a non-cancel-safe future | Its partial progress is lost on expiry | `timeout` cancels the inner future ✅[^12], exactly like a losing `select!` branch |
| A `broadcast` receiver slower than the senders | Gets `Lagged(n)`, then continues from the oldest value still kept ✅[^14] | The buffer overwrites its oldest value when full |
| `watch` with fast senders | Intermediate values are skipped ✅[^15] ✅[^1] | Only the last value is stored |
| A panic inside a task | That task ends with `JoinError::is_panic()`; other tasks keep running ✅[^7] ✅[^1] | The runtime catches the panic |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `current_thread` runtime | One thread, no work stealing; with a `LocalSet`, `!Send` tasks are allowed ✅[^17] | One blocking call stalls every task (lab above); no parallelism |
| `multi_thread` runtime (the `#[tokio::main]` default) | Tasks run in parallel, balanced by work stealing ✅[^2] | `Send + 'static` bounds on spawned futures |
| `tokio::spawn` per job | Independent scheduling; usually less error-prone than `select!` ✅[^23] | Detached unless the handle is kept; use a `JoinSet` to own them |
| `select!` / `join!` in one task | No `'static` or `Send` bound; borrows locals | Cancellation and cancel safety become your problem |
| std `Mutex` in async code | Cheap ✅[^20] | Guard must never cross an `.await` |
| `tokio::sync::Mutex` | Guard may cross an `.await` ✅[^20] | More expensive than a std mutex ✅[^20] |

## Takeaways
- Every future used as a `select!` branch inside a loop must be cancel safe; otherwise keep its partial state outside it, or pin it once and poll it by `&mut`. [rule-candidate]
- Never hold an `Rc` or a `std::sync::MutexGuard` across an `.await`; end the guard's scope in an inner block (an explicit `drop` does not satisfy the `Send` check). [rule-candidate]
- Keep every `JoinHandle` or spawn into a `JoinSet`; a dropped handle detaches its task, and tasks still running at shutdown are dropped. [rule-candidate]
- Put blocking calls in `spawn_blocking` and CPU-heavy loops on a dedicated pool. [rule-candidate]
- Pick the channel by shape: `oneshot` for one reply, `mpsc` for a work queue, `broadcast` for fan-out, `watch` for "latest state".

## Verification status
- Verified: 96 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [tokio::runtime](https://docs.rs/tokio/1.54.1/tokio/runtime/index.html) — Tokio 1.54.1 docs, 2026. Backs: driver, scheduler and timer; work stealing; one worker per core; `current_thread` runs tasks only inside `block_on`. [^2]
- [Builder in tokio::runtime](https://docs.rs/tokio/1.54.1/tokio/runtime/struct.Builder.html) — Tokio 1.54.1 docs, 2026. Backs: default thread name `tokio-rt-worker`, worker count from `available_parallelism`, `max_blocking_threads` 512, `enable_all`. [^3]
- [main in tokio](https://docs.rs/tokio/1.54.1/tokio/attr.main.html) — Tokio 1.54.1 docs, 2026. Backs: what `#[tokio::main]` is equivalent to, `flavor = "current_thread"`. [^4]
- [Runtime in tokio::runtime](https://docs.rs/tokio/1.54.1/tokio/runtime/struct.Runtime.html) — Tokio 1.54.1 docs, 2026. Backs: `block_on` panics inside async context and does not run as a worker; shutdown on drop. [^5]
- [spawn in tokio::task](https://docs.rs/tokio/1.54.1/tokio/task/fn.spawn.html) — Tokio 1.54.1 docs, 2026. Backs: bounds, starts immediately, may move threads, panics outside a runtime. [^6]
- [JoinHandle in tokio::task](https://docs.rs/tokio/1.54.1/tokio/task/struct.JoinHandle.html) — Tokio 1.54.1 docs, 2026. Backs: drop detaches, `abort`, `is_finished`, panics as `JoinError`. [^7]
- [JoinSet in tokio::task](https://docs.rs/tokio/1.54.1/tokio/task/struct.JoinSet.html) — Tokio 1.54.1 docs, 2026. Backs: completion order, drop aborts all tasks. [^8]
- [spawn_blocking in tokio::task](https://docs.rs/tokio/1.54.1/tokio/task/fn.spawn_blocking.html) — Tokio 1.54.1 docs, 2026. Backs: blocking pool, cannot abort once started, shutdown waits, rayon for CPU work. [^9]
- [select in tokio](https://docs.rs/tokio/1.54.1/tokio/macro.select.html) — Tokio 1.54.1 docs, 2026. Backs: same-task concurrency, random order and `biased;`, losers dropped, panic without `else`, cancel-safety definition and lists. [^10]
- [Receiver in tokio::sync::mpsc](https://docs.rs/tokio/1.54.1/tokio/sync/mpsc/struct.Receiver.html) — Tokio 1.54.1 docs, 2026. Backs: `recv` returns `None` when closed and empty; `recv` is cancel safe. [^11]
- [timeout in tokio::time](https://docs.rs/tokio/1.54.1/tokio/time/fn.timeout.html) — Tokio 1.54.1 docs, 2026. Backs: `Err(Elapsed)` and cancelling the wrapped future. [^12]
- [tokio::sync](https://docs.rs/tokio/1.54.1/tokio/sync/index.html) — Tokio 1.54.1 docs, 2026. Backs: the shape of `oneshot`, `mpsc`, `broadcast` and `watch`. [^13]
- [tokio::sync::broadcast](https://docs.rs/tokio/1.54.1/tokio/sync/broadcast/index.html) — Tokio 1.54.1 docs, 2026. Backs: lagging receivers, subscribe sees later values only. [^14]
- [tokio::sync::watch](https://docs.rs/tokio/1.54.1/tokio/sync/watch/index.html) — Tokio 1.54.1 docs, 2026. Backs: last value only, `changed`, `borrow_and_update`, `has_changed`. [^15]
- [tokio::sync::oneshot](https://docs.rs/tokio/1.54.1/tokio/sync/oneshot/index.html) — Tokio 1.54.1 docs, 2026. Backs: single value, `RecvError` when the sender is dropped, `send` is not async. [^16]
- [LocalSet in tokio::task](https://docs.rs/tokio/1.54.1/tokio/task/struct.LocalSet.html) — Tokio 1.54.1 docs, 2026. Backs: `!Send` tasks on one thread, `spawn_local`, `run_until`. [^17]
- [Spawning](https://tokio.rs/tokio/tutorial/spawning) — Tokio project, living. Backs: tasks are 64 bytes and one allocation, the `'static` and `Send` bounds and their errors. [^18]
- [Select](https://tokio.rs/tokio/tutorial/select) — Tokio project, living. Backs: cancellation by dropping, resuming a pinned future by reference. [^19]
- [Shared state](https://tokio.rs/tokio/tutorial/shared-state) — Tokio project, living. Backs: std versus Tokio mutex, the `MutexGuard` error, scoping instead of `drop`. [^20]
- [Futures, Tasks, and Threads](https://doc.rust-lang.org/book/ch17-06-futures-tasks-threads.html) — The Rust Programming Language (Rust project), living. Backs: choosing between threads and tasks, combining them. [^21]
- [Cancellation and cancellation safety](https://rust-lang.github.io/async-book/part-reference/cancellation.html) — Asynchronous Programming in Rust (Rust Async Working Group), living (draft chapter). Backs: drop is cancel only at await points; split state as the root cause. [^22]
- [Composing futures concurrently](https://rust-lang.github.io/async-book/part-guide/concurrency-primitives.html) — Asynchronous Programming in Rust (Rust Async Working Group), living. Backs: spawning is usually less error-prone than in-task combinators. [^23]

## Related
- `rust/async/futures-and-async-await.md` — the poll and waker mechanism the runtime drives.
- `rust/async/pin-and-unpin.md` — why `&mut fut` in `select!` needs `tokio::pin!`.
- `rust/concurrency/threads-channels-and-locks.md` — `Send`, `Sync`, std threads, channels and `Mutex`.
- `concurrency/blocking-in-async-runtimes.md` — blocking in async runtimes across languages.
- `concurrency/structured-concurrency.md` — parent scopes that own, join and cancel children.
