---
schema: knowledge-doc/v1
type: concept
topic: rust/concurrency
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "Miri (nightly 2026-11-23)", "aarch64 measurements"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, atomics, spin-lock, lock-guard, oneshot-channel, arc, unsafecell, send, sync, maybeuninit, park, fence, miri, unsafe]
---

# Building a spin lock, a one-shot channel and an `Arc`

## Summary
**TL;DR:** Each of the three primitives is an atomic that guards data the compiler cannot check. The data lives in an `UnsafeCell`, an `unsafe impl Sync` promises that sharing is safe, and the orderings make the promise true. Spin lock: `swap(true, Acquire)` to lock and `store(false, Release)` to unlock, behind a guard that unlocks on drop. One-shot channel: write the value, publish it with a `Release` store, take it with an `Acquire` swap. `Arc`: `Relaxed` increments, a `Release` decrement, and an `Acquire` fence before the last owner frees the value. With `Relaxed` in place of these orderings, the lab spin lock lost between 23,601 and 67,479 of 8,000,000 increments on aarch64, and Miri (the Rust undefined-behaviour checker) reported each planted bug as a data race or a leak.
**Use this when:** writing or reviewing a type with `UnsafeCell`, `unsafe impl Send`/`Sync`, or hand-picked orderings; deciding which ordering each step of a lock, channel or reference count needs; or testing such code with Miri.
**Not this doc:** what each ordering means → `rust/concurrency/atomics-and-memory-ordering.md`; using the standard `Mutex`, `mpsc` and `Arc` → `rust/concurrency/threads-channels-and-locks.md`; `unsafe` rules, `// SAFETY:` comments and Miri in general → `rust/unsafe/unsafe-rust-and-undefined-behavior.md`; `MaybeUninit` and layout → `rust/unsafe/memory-layout-and-repr.md`.

## Problem
The standard library's `Mutex`, `mpsc` and `Arc` hide three decisions that every hand-written primitive must make again:
- **Who may touch the data, and how does the compiler learn it?** `UnsafeCell<T>` is `!Sync`, so a type holding one is not shareable until you write `unsafe impl Sync`, and then the compiler trusts you ✅[^2][^5].
- **Which ordering does each atomic step need?** Too weak and the protected data is torn on weakly ordered processors (CPUs); the code still compiles and usually passes tests on x86 ✅[^11].
- **What happens at the edges?** A second send, a value nobody received, the last owner on another thread, a counter that overflows.

## Mental model
**Analogy:** a door (the atomic) in front of a room (the `UnsafeCell`), with a sign that says "only one person inside at a time" (`unsafe impl Sync`). The compiler reads the sign and lets everyone into the corridor. The orderings are the door's hinges: with `Acquire` on entry and `Release` on exit, whoever enters next finds the room exactly as the last person left it. With `Relaxed`, the door still opens one person at a time, but the room's contents can arrive late.

**Artifact:** the spin lock from this doc, 4 threads × 2,000,000 increments of a plain `u64`, release build, 3 runs each ✅[^1]:
```
correct orderings                     bug-relaxed-spin (Relaxed swap, Relaxed store)
run 1: total = 8000000                run 1: total = 7958418
run 2: total = 8000000                run 2: total = 7932521
run 3: total = 8000000                run 3: total = 7976399
```
The two loops compile to the same instructions in the same order, except two: `bl __aarch64_swp1_acq` becomes `bl __aarch64_swp1_relax`, and `stlrb` (store-release) becomes `strb` (plain store). So the lost increments come from the CPU: with `Relaxed`, nothing stops it from letting the counter's load or store cross the lock and unlock operations ✅[^1][^11].

## How it works
Every type here follows the same three rules:
1. **Interior mutability.** Data that is changed through `&self` must sit in `UnsafeCell<T>`, the primitive that `Cell` and `RefCell` are built on. Its `get()` returns `*mut T`, it has the same layout as `T`, and it is `!Sync`. It does nothing against data races ✅[^5].
2. **A promise.** `unsafe impl Sync` (and sometimes `Send`) states the thread-safety argument the compiler cannot check; implementing these traits by hand is `unsafe` for that reason ✅[^13]. Each impl below carries a `// SAFETY:` comment with that argument.
3. **An ordering per step**, chosen so that every access to the data happens-before the next thread's access.

### 1. A spin lock with a guard
```rust
const TAKE: Ordering = Ordering::Acquire; // lock: later accesses stay after
const GIVE: Ordering = Ordering::Release; // unlock: earlier accesses stay before

pub struct SpinLock<T> {
    held: AtomicBool,
    value: UnsafeCell<T>,
}

// SAFETY: `lock` hands the value to one thread at a time, so sharing
// `&SpinLock<T>` is fine whenever `T` itself may move between threads.
unsafe impl<T: Send> Sync for SpinLock<T> {}

/// Proof that the lock is held; unlocks on drop.
pub struct SpinGuard<'a, T> {
    lock: &'a SpinLock<T>,
}

// SAFETY: `&SpinGuard<T>` gives out `&T`, so sharing a guard is sharing `T`.
unsafe impl<T: Sync> Sync for SpinGuard<'_, T> {}

impl<T> SpinLock<T> {
    pub fn lock(&self) -> SpinGuard<'_, T> {
        // swap returns the old value: `true` means someone else holds it
        while self.held.swap(true, TAKE) {
            std::hint::spin_loop();
        }
        SpinGuard { lock: self }
    }
}

impl<T> DerefMut for SpinGuard<'_, T> {
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: the guard exists, so this thread holds the lock,
        // and `&mut self` makes this borrow unique.
        unsafe { &mut *self.lock.value.get() }
    }
}

impl<T> Drop for SpinGuard<'_, T> {
    fn drop(&mut self) {
        self.lock.held.store(false, GIVE);
    }
}
```
`new`, `into_inner` and `Deref` (which returns `&*self.lock.value.get()`) complete the type.

| Step | Ordering | Why |
|---|---|---|
| `swap(true, Acquire)` in `lock` | `Acquire` | Pairs with the previous holder's `Release` store, so its writes to `value` are visible to us ✅[^2][^9] |
| `store(false, Release)` in `Drop` | `Release` | Our writes to `value` stay before the unlock and travel with it ✅[^2][^9] |
| `spin_loop()` while waiting | none | Tells the CPU it is busy-waiting (here an `isb` instruction); it does not call the operating system ✅[^1][^7] |

- **`SpinLock<T>: Sync` needs only `T: Send`**, not `T: Sync`: one thread at a time gets the `&mut T`, which is like moving the `T` to that thread ✅[^2]. Measured: `SpinLock<Rc<i32>>` used from a scoped thread is E0277 "`Rc<i32>` cannot be sent between threads safely" ✅[^1].
- **The guard's lifetime ties it to the lock**, so a guard cannot outlive its lock: E0597 "`lock` does not live long enough" ✅[^1][^2].
- **The guard needs its own `Sync` impl.** The guard's only field is a `&SpinLock<T>`, so the auto impl would make it `Sync` whenever `SpinLock<T>` is `Sync`, which only requires `T: Send`. But a shared `&SpinGuard` hands out `&T`, so the bound must be `T: Sync` ✅[^2]. Measured: two threads calling `Cell::set` through one `&SpinGuard<Cell<u32>>` is E0277 with the impl above; with the feature `bug-auto-guard-sync` (no manual impl) it compiles, and Miri reports "Data race detected between (1) non-atomic write on thread `unnamed-1` and (2) non-atomic read on thread `unnamed-2`" ✅[^1].
- **The guard is `Send`** (moving it moves a `&SpinLock<T>`), so it may be dropped on another thread. Measured: a guard moved into a scoped thread unlocked there, and the main thread relocked and saw `[1, 2]`, under Miri too ✅[^1]. The standard `MutexGuard` is `!Send` because POSIX (Portable Operating System Interface) threads require unlocking on the locking thread ✅[^10].

### 2. A one-shot channel
One value, one `Sender`, one `Receiver`. The receiver sleeps with `thread::park` until the sender wakes it ✅[^3].
```rust
struct Slot<T> {
    filled: AtomicBool,
    value: UnsafeCell<MaybeUninit<T>>,
}

// SAFETY: only the Sender writes `value` (once, before the Release store of
// `filled`), only the Receiver reads it (after the Acquire swap saw `true`).
unsafe impl<T: Send> Sync for Slot<T> {}

pub struct Sender<T> { slot: Arc<Slot<T>>, receiver_thread: Thread }
pub struct Receiver<T> {
    slot: Arc<Slot<T>>,
    // *const () is !Send: the Receiver stays on the thread the Sender will unpark
    _stay_on_this_thread: PhantomData<*const ()>,
}
// oneshot() builds both halves around one Arc<Slot<T>> and records thread::current().

impl<T> Sender<T> {
    /// Takes `self`: a second send is a compile error (use of moved value).
    pub fn send(self, value: T) {
        // SAFETY: the only Sender, consumed here, so this is the only write.
        unsafe { (*self.slot.value.get()).write(value) };
        self.slot.filled.store(true, Release); // publish the write above
        self.receiver_thread.unpark();
    }
}

impl<T> Receiver<T> {
    /// A hint only: Relaxed, because `recv` does the synchronizing.
    pub fn is_ready(&self) -> bool { self.slot.filled.load(Relaxed) }

    pub fn recv(self) -> T {
        // swap to false: the slot no longer owns the value after we read it
        while !self.slot.filled.swap(false, Acquire) {
            thread::park(); // may wake spuriously, hence the loop
        }
        // SAFETY: `filled` was true and our Acquire swap synchronized with
        // the Sender's Release store, so the value is initialized and visible.
        unsafe { (*self.slot.value.get()).assume_init_read() }
    }
}

impl<T> Drop for Slot<T> {
    fn drop(&mut self) {
        // &mut self: no other thread can touch the slot, so no atomics needed
        if *self.filled.get_mut() {
            // SAFETY: filled == true means a value was sent and never received.
            unsafe { self.value.get_mut().assume_init_drop() }
        }
    }
}
```
**2 actors**, sharing one `Slot`:
- **Sender** — its job: write the value once and publish it, via `value.write`, then `filled.store(true, Release)`, then `unpark` on the recorded receiver thread.
- **Receiver** — its job: wait for the flag and take the value, via `filled.swap(false, Acquire)` with `park` between tries, then `assume_init_read`.

```
 Sender thread                           Slot                  Receiver thread
                                                               recv(): swap(false, Acquire) == false → park()
 send(v): value.write(v) ───────────▶ value = v
          filled.store(true, Release) ▶ filled = true
          unpark(receiver) ─────────────────────────────────▶ wakes (or finds the token already set)
                                                               swap(false, Acquire) == true → filled = false
                                                               assume_init_read() → v   (sees the write: Release → Acquire)
```

| Step | Ordering | Why |
|---|---|---|
| `filled.store(true, Release)` in `send` | `Release` | The value write stays before the flag and becomes visible with it ✅[^3] |
| `filled.swap(false, Acquire)` in `recv` | `Acquire` | Synchronizes with that store before the value is read; the swap also makes a second read impossible ✅[^3] |
| `filled.load(Relaxed)` in `is_ready` | `Relaxed` | Only a hint; `filled` has one modification order, so `is_ready` returning `true` means `recv` will find the value ✅[^3] |
| `filled.get_mut()` in `Drop` | none | `&mut self` proves exclusive access ✅[^3][^5] |
| `unpark` → `park` | built in | `unpark` acts as a `Release` and `park` as the matching `Acquire`; an `unpark` that comes first is not lost, and `park` may return spuriously ✅[^8] |

- **Safety through types.** `send(self)` and `recv(self)` consume their half, so a second send is E0382 "use of moved value: `tx`" instead of a runtime check ✅[^1][^3]. The `PhantomData<*const ()>` field makes `Receiver` `!Send`, so it cannot leave the thread recorded for `unpark`: moving it into `thread::spawn` is E0277 "`*const ()` cannot be sent between threads safely" ✅[^1][^3].
- **Ownership of the value.** `MaybeUninit<T>` holds memory that is not yet initialized; `assume_init_read` moves the value out, and the swap to `false` records that the slot no longer owns it, so `Drop` neither leaks it nor drops it twice ✅[^1][^3].

### 3. An `Arc`
```rust
struct Shared<T> { owners: AtomicUsize, value: T }
pub struct MyArc<T> { ptr: NonNull<Shared<T>> }

// SAFETY: a MyArc<T> lets several threads read T (needs T: Sync) and the
// last owner, on any thread, drops T (needs T: Send).
unsafe impl<T: Send + Sync> Send for MyArc<T> {}
unsafe impl<T: Send + Sync> Sync for MyArc<T> {}

impl<T> Clone for MyArc<T> {
    fn clone(&self) -> Self {
        // Relaxed: we already own a reference, so nothing needs ordering.
        if self.shared().owners.fetch_add(1, Ordering::Relaxed) > usize::MAX / 2 {
            std::process::abort(); // leaked clones in a loop: never wrap to 0
        }
        MyArc { ptr: self.ptr }
    }
}

impl<T> Drop for MyArc<T> {
    fn drop(&mut self) {
        // Release: my uses of `value` happen-before my decrement.
        if self.shared().owners.fetch_sub(1, Ordering::Release) == 1 {
            // Acquire: ...and every other owner's decrement happens-before this.
            fence(Ordering::Acquire);
            // SAFETY: we were the last owner.
            unsafe { drop(Box::from_raw(self.ptr.as_ptr())) }
        }
    }
}
```
`new` leaks a `Box<Shared<T>>` into the `NonNull`; `Deref` returns `&self.shared().value`; `get_mut` returns `Some(&mut T)` only when `owners.load(Acquire) == 1`.

**3 actors** in the last drop:
- **Owner thread B** — its job: read the value, then give up its handle, via `Deref`, then `fetch_sub(1, Release)`.
- **The `owners` counter** — its job: put every increment and decrement in one order, via the `AtomicUsize` modification order.
- **Owner thread C** — its job: free the value if it was the last owner, via `fetch_sub` returning 1, then `fence(Acquire)`, then `Box::from_raw`.

```
 thread B                               owners            thread C
 reads b.0.len()                          2
 fetch_sub(1, Release) ── 2 → 1 ─────────▶ 1
                                            ◀── fetch_sub(1, Release) returns 1 ── (C was last)
                                                fence(Acquire)  ◀── synchronizes with B's Release
                                                Box::from_raw → drop(value)  (after B's read)
```
1. **Thread B (local):** reads `value` through `Deref`. Program order puts the read before B's decrement ✅[^9].
2. **Thread B → counter:** `fetch_sub(1, Release)` keeps the read before the decrement ✅[^4].
3. **Thread C → counter:** its own `fetch_sub` reads the `1` that B's decrement wrote: C held the last handle. Earlier decrements (here the main thread's 3 → 2) are covered too, because every later decrement is a read-modify-write (RMW) operation, which continues their release sequence ✅[^9].
4. **Thread C (local):** `fence(Acquire)` makes every earlier `Release` decrement happen-before the code after the fence; only then is the value dropped and freed ✅[^4]. `AcqRel` on every `fetch_sub` would also be correct, but only the decrement to zero needs `Acquire`, so for efficiency the `Acquire` sits in a fence on that path alone ✅[^4].

Why `Relaxed` is enough in `clone`: the caller already owns a handle, so the value cannot disappear, and no other memory depends on the increment ✅[^4]. The `usize::MAX / 2` check aborts before a program that leaks clones in a loop could wrap the count to zero and free the value while it is in use ✅[^4]. `MyArc<T>` is `Send` and `Sync` only if `T` is both, exactly like the standard `Arc` ✅[^4][^14]. Measured: sending a `MyArc<Cell<i32>>` clone into `thread::spawn` is E0277 "`Cell<i32>` cannot be shared between threads safely" ✅[^1].

## Worked example
Run the three primitives' tests under Miri, then plant one bug at a time and read what Miri reports. The lab crate `diylocks` holds the code above; each bug is a Cargo feature that changes one item: `bug-relaxed-spin` sets `TAKE` and `GIVE` to `Relaxed`; `bug-leaky-oneshot` removes `Drop for Slot`; `bug-relaxed-arc` uses `fetch_sub(1, Relaxed)` without the fence. Miri runs the program in an interpreter that detects data races and memory leaks and emulates some weak-memory effects; it checks only the executions it actually runs ✅[^6].

1. **Correct code**, `cargo +nightly miri test --lib` ✅[^1]:
   ```
   test myarc::tests::get_mut_only_when_unique ... ok
   test myarc::tests::last_owner_drops_once_on_another_thread ... ok
   test oneshot::tests::unreceived_value_is_dropped_once ... ok
   test oneshot::tests::value_crosses_threads ... ok
   test spin::tests::four_threads_push ... ok
   test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.95s
   ```
   It also passed with `MIRIFLAGS=-Zmiri-many-seeds=0..8`, which reruns the tests with 8 seeds for Miri's random scheduling choices ✅[^1][^6]. The tests use 20 pushes per thread under Miri (`cfg!(miri)`) and 10,000 natively, because Miri is far slower.
2. **`--features bug-relaxed-spin`** ✅[^1]:
   ```
   error: Undefined Behavior: Data race detected between (1) retag write on thread `unnamed-9` and (2) retag write of type `std::vec::Vec<usize>` on thread `unnamed-10` at alloc63236
     --> src/spin.rs:62:18
      |
   62 |         unsafe { &mut *self.lock.value.get() }
      |                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^ (2) just happened here
   ```
   A *retag* is Miri's record of a reference being created or moved. Miri counts it as a read or write for data-race purposes, so two `&mut Vec` borrows with no happens-before edge between them are a race, even before either is used ✅[^1].
3. **`--features bug-leaky-oneshot`** ✅[^1]:
   ```
   thread 'oneshot::tests::unreceived_value_is_dropped_once' (1005) panicked at src/oneshot.rs:105:9:
   assertion `left == right` failed
     left: 0
    right: 1
   error: memory leaked: alloc51317 (Rust heap, size: 4, align: 4), allocated here:
      --> src/oneshot.rs:102:23
   ```
   The 4-byte allocation is the `Box<u32>` inside the value that was sent and never received ✅[^1].
4. **`--features bug-relaxed-arc`** ✅[^1]:
   ```
   error: Undefined Behavior: Data race detected between (1) retag read on thread `unnamed-3` and (2) retag write of type `myarc::Shared<myarc::tests::Tracked>` on thread `unnamed-4` at alloc44699
   help: and (1) occurred earlier here
     --> src/myarc.rs:78:12
      |
   78 |         if self.shared().owners.fetch_sub(1, Ordering::Relaxed) == 1 {
   ```
   Thread `unnamed-3` created a reference into the allocation (`self.shared()`, in its own `drop`) and thread `unnamed-4`, the last owner, rebuilt the `Box` to free it, with nothing ordering the two. `Release` plus `fence(Acquire)` is that missing edge ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `Sender` dropped without `send` | `recv` sleeps forever: killed by `timeout 3` (exit code 124) | This design has no "disconnected" state; the standard `mpsc` returns `Err` instead ✅[^1][^12] |
| Message sent, never received, and no `Drop for Slot` | The value is never dropped; Miri reports the leak | `MaybeUninit<T>` never drops its contents by itself ✅[^1][^3] |
| A lock holder is descheduled while others spin | The waiters burn CPU until it runs again | `spin_loop` does not yield to the operating system; the std docs advise bounding spins and then blocking ✅[^7] |
| Spin lock as a general `Mutex` | Wastes cycles under contention | Spinning can cut latency for very short waits, but wastes cycles otherwise ✅[^2] |
| `MyArc` clones leaked in a loop | The process aborts past `usize::MAX / 2` | Wrapping to 0 would free a value still in use ✅[^4] |
| Tests pass natively on x86 | Proves little about the orderings | x86 orders memory strongly; test on weakly ordered CPUs and with Miri ✅[^11] |
| Miri passes | Not a proof either | Miri explores one execution per seed and does not produce every weak-memory behaviour ✅[^6] |
| `MyArc::get_mut` with `count == 1` checked by `Relaxed` | Could hand out `&mut T` while another thread's last reads are not yet ordered before it | The check must synchronize with earlier `Release` decrements: `Acquire` load, or `Relaxed` plus `fence(Acquire)` ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Hand-written spin lock | No system calls; tiny | Burns CPU while waiting; no fairness, no poisoning |
| `std::sync::Mutex` | Sleeps while waiting; poisoning | Slower for very short critical sections |
| One-shot channel shared through `Arc` | `Sender`/`Receiver` move freely; misuse is a compile error | One heap allocation per channel; borrowing a `Channel` avoids it at the cost of lifetimes ✅[^3] |
| `MyArc<T>` | Shows every ordering decision in 60 lines | No `Weak`, no `?Sized` values, no `make_mut`; the standard `Arc` has all of them ✅[^4][^14] |

## Takeaways
- Put every piece of shared mutable state in an `UnsafeCell`, and write the thread-safety argument as a `// SAFETY:` comment above each `unsafe impl Send`/`Sync`. [rule-candidate]
- Bound a lock's `Sync` impl by `T: Send`, and a guard's `Sync` impl by `T: Sync`; check every auto impl a guard would get. [rule-candidate]
- Pair every "publish" (`Release` store or `fetch_sub`) with exactly one "take" (`Acquire` load, swap or fence), and name the pair in comments.
- Make misuse a compile error where you can: consume `self` on one-time operations, use `PhantomData<*const ()>` to pin a value to its thread.
- Run `cargo +nightly miri test` (with `-Zmiri-many-seeds`) on every crate with `unsafe` concurrency code, and stress-test release builds on aarch64. [rule-candidate]

## Verification status
- Verified: 53 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Chapter 4. Building Our Own Spin Lock](https://mara.nl/atomics/building-spinlock.html) — Mara Bos, Rust Atomics and Locks, 2023. Backs: acquire/release in lock and unlock, `Sync` bound `T: Send`, the guard, its lifetime and its `Sync` bound, when spinning pays off. [^2]
- [Chapter 5. Building Our Own Channels](https://mara.nl/atomics/building-channels.html) — Mara Bos, Rust Atomics and Locks, 2023. Backs: one-shot channel design, its orderings, `Drop` with `get_mut`, safety through types, `PhantomData<*const ()>`, blocking with park, the allocation trade-off. [^3]
- [Chapter 6. Building Our Own "Arc"](https://mara.nl/atomics/building-arc.html) — Mara Bos, Rust Atomics and Locks, 2023. Backs: `Send`/`Sync` bounds, `Relaxed` clone, overflow abort, `Release` decrement plus `Acquire` fence, `get_mut` synchronization. [^4]
- [UnsafeCell in std::cell](https://doc.rust-lang.org/std/cell/struct.UnsafeCell.html) — Rust standard library, living. Backs: core primitive for interior mutability, `get` returns `*mut T`, same layout, `!Sync`, no protection against data races. [^5]
- [rust-lang/miri: An interpreter for Rust's mid-level intermediate representation](https://github.com/rust-lang/miri) — Rust project, living. Backs: data-race and leak detection, partial weak-memory emulation, `-Zmiri-many-seeds`, one execution per run. [^6]
- [spin_loop in std::hint](https://doc.rust-lang.org/std/hint/fn.spin_loop.html) — Rust standard library, living. Backs: busy-wait hint, no OS interaction, advice to bound spinning. [^7]
- [park in std::thread](https://doc.rust-lang.org/std/thread/fn.park.html) — Rust standard library, living. Backs: token model, spurious wakeups, `unpark` as `Release` and `park` as `Acquire`. [^8]
- [Chapter 3. Memory Ordering](https://mara.nl/atomics/memory-ordering.html) — Mara Bos, Rust Atomics and Locks, 2023. Backs: happens-before through mutex-style lock/unlock, release sequences through RMW operations, program order. [^9]
- [MutexGuard in std::sync](https://doc.rust-lang.org/std/sync/struct.MutexGuard.html) — Rust standard library, living. Backs: the standard guard is `!Send` because of POSIX threads. [^10]
- [Atomics](https://doc.rust-lang.org/nomicon/atomics.html) — The Rustonomicon (Rust project), living. Backs: hardware reordering, acquire/release establish causality between threads, test on weakly ordered hardware. [^11]
- [std::sync::mpsc](https://doc.rust-lang.org/std/sync/mpsc/index.html) — Rust standard library, living. Backs: the standard channel reports a hung-up peer with `Err`. [^12]
- [Extensible Concurrency with `Send` and `Sync`](https://doc.rust-lang.org/book/ch16-04-extensible-concurrency-sync-and-send.html) — The Rust Programming Language (Rust project), living. Backs: implementing `Send` and `Sync` by hand is unsafe. [^13]
- [Arc in std::sync](https://doc.rust-lang.org/std/sync/struct.Arc.html) — Rust standard library, living. Backs: the standard `Arc` offers `Weak`, `make_mut`, `get_mut`. [^14]

## Related
- `rust/concurrency/atomics-and-memory-ordering.md` — the orderings and fences used here.
- `rust/concurrency/threads-channels-and-locks.md` — the standard primitives these imitate.
- `rust/unsafe/unsafe-rust-and-undefined-behavior.md` — `unsafe`, soundness and Miri.
- `rust/unsafe/memory-layout-and-repr.md` — `MaybeUninit` and `NonNull`.
- `concurrency/shared-state-and-data-races.md` — data races across languages.
