---
schema: knowledge-doc/v1
type: concept
topic: rust/async
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "futures 0.3.34", "tokio 1.54"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, async, await, future, poll, waker, executor, reactor, state-machine, join, select, stream]
---

# Futures and `async`/`await`

## Summary
**TL;DR:** A `Future` is a value that stands for work not finished yet; it does nothing until something calls its `poll` method. `async fn` and `async` blocks compile into an anonymous state-machine type that implements `Future`, and every `.await` is a point where that machine can return `Pending` and later resume. An **executor** polls the top-level future (a **task**); a future that returns `Pending` must first hand the **waker** from its `Context` to an event source (the **reactor**), which calls `wake` when progress is possible, and only then is the task polled again. Locals held across an `.await` are stored inside the future, so its size grows with them.
**Use this when:** an `async fn` "does nothing", you write a `Future` by hand, a task hangs forever, a future is unexpectedly large, or you must choose between `join`, `select` and spawning.
**Not this doc:** why `poll` takes `Pin<&mut Self>` → `rust/async/pin-and-unpin.md`; the Tokio runtime, `spawn`, `select!` and cancellation safety → `rust/async/tokio-runtime-tasks-and-cancellation.md`; `Send`/`Sync` → `rust/concurrency/threads-channels-and-locks.md`; `async fn` in traits → `rust/traits-and-generics/advanced-traits-and-type-system.md`; blocking calls inside async code → `concurrency/blocking-in-async-runtimes.md`.

## Problem
Async Rust surprises people who come from languages with a built-in event loop. Calling an `async fn` runs none of its body, so a "fire and forget" call silently does nothing. `async fn main` does not compile without a runtime crate (`error[E0752]: main function is not allowed to be async`) ✅[^2]. A hand-written future that returns `Pending` without arranging a wake-up hangs its task forever. Two `.await`s in a row run one after the other, not at the same time. And a future that keeps a big buffer alive across an `.await` carries that buffer inside itself wherever it is moved.

## Mental model
**Analogy:** a future is a recipe card with a bookmark. Calling an `async fn` only writes the card. The cook (the executor) works through a card until a step says "wait for the oven" (`Pending`), then puts the card aside, bookmark in place, and sleeps or cooks something else. The oven timer (the reactor) rings the bell tied to that card (the waker); the cook picks the card up again and continues from the bookmark.

**Artifact:** an `async fn` called but never polled prints nothing; polled once, its whole body runs ✅[^1]:
```rust
async fn grind(cup: u32) -> u32 { println!("    grind({cup}): running"); cup + 10 }
async fn brew(cup: u32) -> u32 {
    println!("    brew({cup}): before .await");
    let beans = grind(cup).await;
    println!("    brew({cup}): after .await, beans = {beans}");
    beans * 2
}
// main (the numbered println! lines are left out):
let fut = brew(1);  drop(fut);                         // created, never polled
let mut cx = Context::from_waker(Waker::noop());
let mut fut = pin!(brew(2));
let first = fut.as_mut().poll(&mut cx);                // polled once
```
```console
1. calling brew(1)
2. brew(1) returned a future of 20 bytes; dropping it unpolled
3. calling brew(2) and polling it once
    brew(2): before .await
    grind(2): running
    brew(2): after .await, beans = 12
4. first poll returned Ready(24)
    panic: `async fn` resumed after completion
5. polling the finished future again -> is_err = true
```
Nothing between steps 1 and 2: the body of `brew(1)` never ran. `grind` never returned `Pending`, so one poll ran `brew(2)` to the end.

## How it works
**The trait.** `Future` has one associated type, `Output`, and one method, `poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output>`, where `Poll` is `Ready(T)` or `Pending` ✅[^3] ✅[^4]. The docs call futures *inert*: they progress only while actively polled ✅[^4]. `Context` currently only gives access to a `&Waker` ✅[^7].

**5 actors:**
- **Future** — its job: hold the state of one computation and advance it to the next `.await`, via `Future::poll`.
- **Task** — its job: be the top-level future an executor owns and re-polls, via the executor's queue (in the lab, the single future given to `block_on`).
- **Executor** — its job: poll tasks that are ready, via calling `poll` with a `Context`, and sleep when none are, via `thread::park` in the lab.
- **Waker** — its job: tell the executor that a task can progress, via `Waker::wake` / `wake_by_ref` (in the lab, `Thread::unpark`).
- **Reactor** — its job: watch event sources and call the wakers stored with them, via OS readiness APIs in real runtimes (a sleeping helper thread in the lab).

```
 executor thread                                   reactor thread
 ───────────────                                   (lab: helper thread; real: epoll/kqueue/IOCP)
 block_on(fut)
   │ pin!(fut); waker = Waker::from(Arc<Unparker>); cx = Context::from_waker(&waker)
   ▼
 fut.poll(&mut cx) ──▶ state machine runs to its next .await
                         │ inner.poll(cx)   (the same cx is passed down)
                         ▼
                       leaf future (Alarm): not ready
                         │ stores cx.waker().clone() ───────────▶ shared slot
   ◀───── Pending ───────┘                                          │ event fires
   │ thread::park()  (sleeps; no spinning)                          │ waker.wake()
   │                ◀═══════════ thread boundary ═══════════════════┘ = Thread::unpark()
   ▼
 fut.poll(&mut cx) ──▶ resumes at the saved .await ──▶ Ready(v)
   ▼
 return v
```

1. **Caller (your code):** `brew(2)`
   - Builds the state-machine value, via the compiler-generated function: it captures the arguments and runs none of the body ✅[^11] ✅[^1].
2. **Executor:**
   - Pins the future so it will not move, via `pin!` (why: `rust/async/pin-and-unpin.md`).
   - Builds a waker from an `Arc` of its own type, via the `Wake` trait and `Waker::from`; `Wake` is the safe alternative to building a `RawWaker` by hand ✅[^5] ✅[^6].
   - Wraps it, via `Context::from_waker`, and calls `poll` ✅[^7].
3. **Future (the state machine):**
   - Runs its body up to an `.await`.
   - Polls the awaited future with the same `Context`. The Reference sketches `.await` as a loop: call `poll`; on `Ready(r)` the loop yields `r` as the value; on `Pending` the enclosing async body itself returns `Pending` and, when polled again, resumes inside that loop ✅[^9].
4. **Leaf future (one that does real waiting):**
   - Stores a clone of `cx.waker()` with whatever will signal readiness, then returns `Pending` ✅[^4].
   - Only the waker from the most recent `poll` should be woken, so it replaces the stored one on every poll ✅[^4] ✅[^12].
   - Nothing has happened outside the executor thread yet.
5. **Executor:**
   - Gets `Pending`; parks its thread instead of polling in a loop, via `thread::park`. The std docs say not to call `poll` in a tight loop, only after a wake ✅[^4].
   - Re-polls in a loop anyway, because `park` may return spuriously ✅[^8].
6. **Reactor (another thread):**
   - Sees the event and calls `wake()` on the stored waker. `Waker` is `Send` and `Sync`, so any thread may call it ✅[^5].
   - In the lab, `wake` runs `Thread::unpark`, which crosses the thread boundary back to the executor. Real runtimes use one thread blocked on many I/O events at once (epoll on Linux, kqueue on macOS, IOCP on Windows, exposed through the `mio` crate) and dispatch each event to its waker ✅[^13].
7. **Executor:**
   - Wakes and polls again; the state machine continues from the saved `.await` and returns `Ready(v)`.
   - The executor must not poll it again: the trait allows a finished future to panic or block, only not to cause UB (undefined behaviour) ✅[^4]. Compiler-generated futures panic with `` `async fn` resumed after completion `` ✅[^1].

### The state machine and its size
The compiler turns each `async` body into a unique anonymous type; rustc's layout is roughly an enum with one variant per `.await` point, and the exact format is unspecified ✅[^10] ✅[^2]. A local that is alive across an `.await` must live in that type; one that dies before the `.await` does not. Measured on aarch64 with `size_of_val` ✅[^1]:

| Future of | Body | Size |
|---|---|---|
| `tick()` | `async fn tick() {}` | 1 byte |
| `no_locals()` | `tick().await;` | 2 bytes |
| `holds_buffer()` | `let buf = [7u8; 1024]; tick().await; use(buf)` | 1026 bytes |
| `drops_buffer_first()` | buffer used and dropped in a block, then `tick().await` | 2 bytes |
| `two_buffers_in_sequence()` | buffer `a` in its own block across one `.await`, then buffer `b` in another block across another (without the blocks, `a` stays in scope and the size is 2050) | 1026 bytes |
| `awaits_holds_buffer()` | `holds_buffer().await;` | 1027 bytes |
| `Box::pin(holds_buffer())` | the same future moved to the heap | 8 bytes |

Two buffers alive at different `.await`s share storage (1026, not 2050). An awaited child future is stored inline in its parent (1027). `Box::pin` turns any future into one pointer. Clippy's `large_futures` lint flags big futures, but it is off by default: it stayed silent under plain `cargo clippy`, and with `-W clippy::large_futures` (or `-W clippy::pedantic`, which implies it) it reported "large future with a size of 20002 bytes" and suggested `Box::pin(big())` ✅[^1].

### Combining futures: sequential, `join`, `select`
All three run inside one task on one thread; none of them spawns ✅[^14]. Lab with futures 0.3.34, where each step prints and then yields once ✅[^1]:
```console
sequential: A0 A1 A2 B0 B1 B2
join:       A0 B0 A1 B1 A2 B2 -> A finished, B finished
select:     F0 S0 -> F finished; resuming loser:
            S1 S2 -> S finished
```
- **Sequential `.await`:** the second future is not even created until the first finishes.
- **`join!`:** polls every future concurrently and returns a tuple when all are done ✅[^19]. The Book describes its `join` as fair: it alternates between the futures ✅[^15].
- **`futures::future::select`:** needs both futures to be `Unpin` (hence `pin_mut!`), and returns the winner's output together with the unfinished loser, which you may resume (as above) or drop ✅[^18]. Tokio's `select!` macro drops the losers instead; see `rust/async/tokio-runtime-tasks-and-cancellation.md`.
- The Book builds a timeout out of a select between the work and a sleep ✅[^16].

### Streams
A stream is the async version of an iterator: `Stream::poll_next` returns `Poll<Option<Item>>`, where `Poll` says "ready yet?" and `Option` says "any more items?" ✅[^3] ✅[^20]. `Stream` is not in `std`; the common definition comes from the `futures` crate ✅[^3] ✅[^17]. `StreamExt` adds combinators such as `map` and `next`, which returns a future of the next item ✅[^21]. A `futures::channel::mpsc::Receiver` implements `Stream` ✅[^22]. Lab: a producer sends 1 to 4, the consumer maps each to its square and loops on `next().await`, and the stream ends when the sender is dropped ✅[^1]:
```rust
let (mut tx, rx) = futures::channel::mpsc::channel::<u32>(4);
let producer = async move { for n in 1..=4 { tx.send(n).await.unwrap(); } };
let consumer = async {
    let mut squares = rx.map(|n| n * n);
    let mut got = Vec::new();
    while let Some(v) = squares.next().await { got.push(v); }
    got
};
let ((), got) = join!(producer, consumer);   // got == [1, 4, 9, 16]
```
Iterator adapters and laziness are owned by `rust/closures-and-iterators/iterators.md`.

## Worked example
A complete executor built only from `std`, running two hand-written futures: one that wakes itself, one woken by a reactor thread ✅[^1]. The `Wake` trait docs sketch the same park/unpark idea and warn that real executors must also handle spurious unparks and nested calls ✅[^6].
```rust
struct Unparker { thread: Thread, wakes: AtomicUsize }
impl Wake for Unparker {
    fn wake(self: Arc<Self>) { self.wake_by_ref() }
    fn wake_by_ref(self: &Arc<Self>) { self.wakes.fetch_add(1, Relaxed); self.thread.unpark(); }
}
fn block_on<F: Future>(fut: F) -> F::Output {
    let mut fut = pin!(fut);
    let unparker = Arc::new(Unparker { thread: thread::current(), wakes: AtomicUsize::new(0) });
    let waker = Waker::from(unparker.clone());
    let mut cx = Context::from_waker(&waker);
    let mut polls = 0;
    loop {
        polls += 1;
        match fut.as_mut().poll(&mut cx) {
            Poll::Ready(out) => { println!("[executor] Ready after {polls} polls and {} wakes",
                                           unparker.wakes.load(Relaxed)); return out; }
            Poll::Pending => thread::park(),
        }
    }
}
struct YieldTimes { left: u32 }                      // Pending `left` times, waking itself
impl Future for YieldTimes {
    type Output = ();
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if self.left == 0 { return Poll::Ready(()); }
        self.left -= 1;
        println!("  [YieldTimes] Pending, {} left; waking myself", self.left);
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
// Alarm::poll: if `rung`, Ready("ring"); else store cx.waker().clone() in an
// Arc<Mutex<AlarmState>>; on the first poll spawn a thread that sleeps 50 ms,
// sets `rung = true` and calls the stored waker's wake(); return Pending.
fn main() {
    let out = block_on(async {
        YieldTimes { left: 3 }.await;
        Alarm::after(Duration::from_millis(50)).await
    });
}
```
```console
  [YieldTimes] Pending, 2 left; waking myself
  [YieldTimes] Pending, 1 left; waking myself
  [YieldTimes] Pending, 0 left; waking myself
  [Alarm] Pending, waker stored
  [reactor] event fired, calling wake()
[executor] Ready after 5 polls and 4 wakes
result = "ring", elapsed >= 50 ms: true
```
| Poll | What happens |
|---|---|
| 1–3 | `YieldTimes` counts down, calls `wake_by_ref` (unpark), returns `Pending`. The following `park` returns at once, because an `unpark` before `park` leaves a token ✅[^8] |
| 4 | `YieldTimes` is `Ready`; the async block moves on to `Alarm`, which stores the waker, starts the reactor thread and returns `Pending`; `park` now really sleeps |
| — | 50 ms later the reactor thread calls `wake()`: wake number 4, which unparks the executor |
| 5 | `Alarm` sees `rung` and returns `Ready("ring")`; `block_on` returns it |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `save();` where `save` is an `async fn`, no `.await` | Warning "unused implementer of `Future` that must be used", note "futures do nothing unless you `.await` or poll them"; the program prints nothing. With `-D unused_must_use` the warning becomes an error ✅[^1] | The call only builds the future ✅[^11] |
| A future returns `Pending` without storing the waker | The task is never polled again. Under Tokio, `tokio::spawn(poll_fn(\|_\| Poll::<()>::Pending))` was polled once in 100 ms and never finished ✅[^1] | Re-polling happens only after a wake; a future returning `Pending` must make sure its waker is signalled later ✅[^23] |
| Long synchronous code between two `.await`s | Other futures in the same task or thread wait for it | A future can only pause at an `.await`; the Book's fix is to add `yield_now().await` points ✅[^16]. Blocking is owned by `concurrency/blocking-in-async-runtimes.md` |
| A future moves to another task between polls | An old stored waker wakes the wrong task | Store the waker on every poll ✅[^12]; `Waker::will_wake` can skip a needless clone ✅[^5] |
| Polling with `Waker::noop()` (stable since 1.85) | Works for tests; wake notifications are lost ✅[^5] | The no-op waker discards them |
| `return x` or `x?` inside an `async` block | Completes the block's future with that value; it does not return from the enclosing function ✅[^10] | An async block acts like a function boundary, as closures do |
| `break` or `continue` out of an `async` block | `error[E0267]` ✅[^10] | Same function-boundary rule |
| `async { … }` versus `async move { … }` | The first infers how each variable is captured; the second moves every variable it uses ✅[^10] | Same capture modes as closures (`rust/closures-and-iterators/closures-and-fn-traits.md`) |
| `async fn f(x: &str)` | The returned future borrows `x`, and parameters are dropped when the future completes, not when `f` returns ✅[^11] | The desugared `impl Future` captures every lifetime and parameter |
| `thread::park` in a hand-written executor | May return with no `unpark` ✅[^8] | The `loop` around `poll` absorbs spurious wake-ups |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `join!` / `select` inside one task | No allocation, no `Send` or `'static` bound, borrows locals freely | No parallelism; one blocking future stalls all of them ✅[^14] |
| Spawning a task per future | Runs in parallel on a multi-threaded runtime, scheduled independently | `Send + 'static` bounds and an allocation per task (see `rust/async/tokio-runtime-tasks-and-cancellation.md`) |
| `Box::pin` a large child future | Parent stays small (8 bytes for the child) ✅[^1] | One heap allocation per call |

## Takeaways
- Every future must be `.await`ed, spawned or explicitly dropped; deny `unused_must_use` so a forgotten `.await` fails the build. [rule-candidate]
- A hand-written `poll` that returns `Pending` must first store `cx.waker()` with something that will call it, replacing the stored waker on every poll. [rule-candidate]
- End the scope of big locals before an `.await`, or `Box::pin` the child future; enable `clippy::large_futures` in CI. [rule-candidate]
- Never poll a future again after it returned `Ready`.
- Use `join!` for a fixed set of concurrent futures in one task; spawn tasks when you need parallelism.

## Verification status
- Verified: 56 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Futures and the Async Syntax](https://doc.rust-lang.org/book/ch17-01-futures-and-syntax.html) — The Rust Programming Language (Rust project), living. Backs: laziness, `async fn` as an anonymous future type, await points as state-machine states, E0752 for `async fn main`. [^2]
- [A Closer Look at the Traits for Async](https://doc.rust-lang.org/book/ch17-05-traits-for-async.html) — The Rust Programming Language (Rust project), living. Backs: the `Future` and `Poll` definitions, the `Stream` trait and `poll_next`. [^3]
- [Future in std::future](https://doc.rust-lang.org/std/future/trait.Future.html) — Rust standard library, living. Backs: inert futures, storing the waker, latest waker only, no tight polling loop, behaviour after `Ready`. [^4]
- [Waker in std::task](https://doc.rust-lang.org/std/task/struct.Waker.html) — Rust standard library, living. Backs: `wake`/`wake_by_ref`, `will_wake`, `Waker::noop` since 1.85, `Send + Sync`, `From<Arc<W>>`. [^5]
- [Wake in std::task](https://doc.rust-lang.org/std/task/trait.Wake.html) — Rust standard library, living. Backs: `Wake` as the safe way to build a waker, its park/unpark executor sketch and caveats. [^6]
- [Context in std::task](https://doc.rust-lang.org/std/task/struct.Context.html) — Rust standard library, living. Backs: `Context` only carries a `&Waker`, `from_waker`. [^7]
- [park in std::thread](https://doc.rust-lang.org/std/thread/fn.park.html) — Rust standard library, living. Backs: park/unpark token, spurious wake-ups. [^8]
- [Await expressions](https://doc.rust-lang.org/reference/expressions/await-expr.html) — The Rust Reference (Rust project), living. Backs: the `.await` desugaring into a poll loop that yields `Pending`. [^9]
- [Block expressions](https://doc.rust-lang.org/reference/expressions/block-expr.html#async-blocks) — The Rust Reference (Rust project), living. Backs (section "Async blocks"): anonymous future type and its unspecified layout, capture modes, `return`/`?` in async blocks, E0267. [^10]
- [Functions](https://doc.rust-lang.org/reference/items/functions.html#async-functions) — The Rust Reference (Rust project), living. Backs (section "Async functions"): calling an `async fn` does no work, desugaring, captured lifetimes and parameters. [^11]
- [Task Wakeups with Waker](https://rust-lang.github.io/async-book/02_execution/03_wakeups.html) — Asynchronous Programming in Rust (Rust Async Working Group), living. Backs: tasks are re-polled only after a wake; update the waker on every poll. [^12]
- [Executors and System IO](https://rust-lang.github.io/async-book/02_execution/05_io.html) — Asynchronous Programming in Rust (Rust Async Working Group), living. Backs: epoll/kqueue/IOCP through `mio`, one thread dispatching I/O events to wakers. [^13]
- [Composing futures concurrently](https://rust-lang.github.io/async-book/part-guide/concurrency-primitives.html) — Asynchronous Programming in Rust (Rust Async Working Group), living. Backs: join and select run in one task without parallelism; a blocking future stalls the others. [^14]
- [Applying Concurrency with Async](https://doc.rust-lang.org/book/ch17-02-concurrency-with-async.html) — The Rust Programming Language (Rust project), living. Backs: `join` is fair and alternates. [^15]
- [Working With Any Number of Futures](https://doc.rust-lang.org/book/ch17-03-more-futures.html) — The Rust Programming Language (Rust project), living. Backs: `yield_now`, starvation between awaits, a timeout built from select. [^16]
- [Streams: Futures in Sequence](https://doc.rust-lang.org/book/ch17-04-streams.html) — The Rust Programming Language (Rust project), living. Backs: streams as async iteration, `Stream` not yet in `std`. [^17]
- [select in futures::future](https://docs.rs/futures/0.3.34/futures/future/fn.select.html) — futures crate 0.3.34 docs, 2026. Backs: `Unpin` bounds, `Either` with the unfinished future. [^18]
- [join in futures](https://docs.rs/futures/0.3.34/futures/macro.join.html) — futures crate 0.3.34 docs, 2026. Backs: concurrent polling, tuple result. [^19]
- [Stream in futures::stream](https://docs.rs/futures/0.3.34/futures/stream/trait.Stream.html) — futures crate 0.3.34 docs, 2026. Backs: `poll_next` returning `Poll<Option<Item>>`. [^20]
- [StreamExt in futures::stream](https://docs.rs/futures/0.3.34/futures/stream/trait.StreamExt.html) — futures crate 0.3.34 docs, 2026. Backs: `next` and `map`. [^21]
- [Receiver in futures::channel::mpsc](https://docs.rs/futures/0.3.34/futures/channel/mpsc/struct.Receiver.html) — futures crate 0.3.34 docs, 2026. Backs: the receiver implements `Stream`. [^22]
- [Async in depth](https://tokio.rs/tokio/tutorial/async) — Tokio project, living. Backs: a future returning `Pending` must ensure its waker is signalled. [^23]
- [Fundamentals of Asynchronous Programming: Async, Await, Futures, and Streams](https://doc.rust-lang.org/book/ch17-00-async-await.html) — The Rust Programming Language (Rust project), living. Background: concurrency versus parallelism.

## Related
- `rust/async/pin-and-unpin.md` — why `poll` takes `Pin<&mut Self>`.
- `rust/async/tokio-runtime-tasks-and-cancellation.md` — a production executor, spawning and cancellation.
- `rust/concurrency/threads-channels-and-locks.md` — `Send`/`Sync`, threads, `Mutex` and `Condvar`.
- `rust/closures-and-iterators/iterators.md` — the synchronous counterpart of streams.
- `concurrency/blocking-in-async-runtimes.md` — what happens when code between `.await`s blocks.
