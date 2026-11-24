---
schema: knowledge-doc/v1
type: concept
topic: rust/concurrency
status: verified
applies-to: ["Rust 1.100.0", "edition 2024", "loom 0.7.3", "aarch64 measurements"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, atomics, memory-ordering, relaxed, acquire, release, seqcst, happens-before, fence, compare-exchange, loom, aarch64, litmus-test]
---

# Atomics and memory ordering in Rust

## Summary
**TL;DR:** An atomic operation is indivisible, and each atomic variable has one history of writes that every thread agrees on. The `Ordering` argument decides what an operation says about *other* memory: `Relaxed` says nothing; a `Release` store read by an `Acquire` load creates a *happens-before* edge, so everything written before the store is visible after the load; `SeqCst` adds one global order of all `SeqCst` operations. Weak orderings fail only on some runs and some processors (CPUs), so test with loom (exhaustive model checking) and on weakly ordered hardware: on the aarch64 lab, `Relaxed` message passing gave about 60,000 stale reads per run, `Release`/`Acquire` gave none.
**Use this when:** writing or reviewing code that uses `std::sync::atomic`, choosing an `Ordering`, writing a `compare_exchange` loop, using `fence`, or setting up a loom test.
**Not this doc:** threads, `Mutex` and channels → `rust/concurrency/threads-channels-and-locks.md`; building a spin lock, a channel and an `Arc` with these orderings → `rust/concurrency/building-a-spinlock-channel-and-arc.md`; data races in general → `concurrency/shared-state-and-data-races.md`; Miri and undefined behaviour (UB) in general → `rust/unsafe/unsafe-rust-and-undefined-behavior.md`.

## Problem
Two things go wrong without a model of memory ordering:
- **Lost updates.** A `load` followed by a `store` is two atomic steps, not one; other threads' writes fall between them.
- **Stale or reordered data.** The compiler and the CPU reorder memory accesses whenever a single thread cannot tell the difference ✅[^9]. A reader can see a "ready" flag set and still read the old payload. On x86, which orders memory strongly, such code often works by luck; on ARM, which orders it weakly, it fails ✅[^7].

## Mental model
**Analogy:** every atomic variable is a notice board with a numbered history of postings. All threads agree on the history (the *modification order*), but a reader may be looking at an older posting than the latest one. A `Release` store pins a sealed envelope to its posting holding "everything I wrote before this". An `Acquire` load that reads that posting opens the envelope. `Relaxed` postings carry no envelope.

**Artifact:** a message-passing (MP) litmus test, run on the lab's aarch64 CPU. The writer stores the payload, then the flag; a reader that sees flag value `r` should see a payload of at least `r` ✅[^1]:
```rust
fn trial(store_ready: Ordering, load_ready: Ordering, rounds: u64) -> (u64, u64) {
    let data = AtomicU64::new(0);
    let ready = AtomicU64::new(0);
    let (mut stale, mut checks) = (0u64, 0u64);
    thread::scope(|s| {
        s.spawn(|| {
            for i in 1..=rounds {
                data.store(i, Ordering::Relaxed);
                ready.store(i, store_ready);
            }
        });
        s.spawn(|| loop {
            let r = ready.load(load_ready);
            let d = data.load(Ordering::Relaxed);
            checks += 1;
            if d < r { stale += 1; }
            if r == rounds { break; }
        });
    });
    (stale, checks)
}
```
```
Relaxed / Relaxed  run 1: stale reads     61030 of    8926570 checks
Relaxed / Relaxed  run 2: stale reads     58921 of   16092023 checks
Relaxed / Relaxed  run 3: stale reads     62482 of   13586849 checks
Release / Acquire  run 1: stale reads         0 of   12651193 checks
Release / Acquire  run 2: stale reads         0 of    9709400 checks
Release / Acquire  run 3: stale reads         0 of   15996347 checks
```
(`rounds = 20_000_000`, `-C opt-level=3`, Apple M2, 8 cores, Linux 7.2 in an OrbStack virtual machine.) A function with the reader's two `Relaxed` loads compiles to two plain `ldr` instructions in source order, so the stale reads come from the CPU, not from the compiler ✅[^1].

## How it works

### Atomic types and operations
1. **Types.** `AtomicBool`, `AtomicI8`…`AtomicI64`, `AtomicU8`…`AtomicU64`, `AtomicIsize`, `AtomicUsize` and `AtomicPtr<T>`. In Rust 1.100 they are aliases of a generic `Atomic<T>` (`std::any::type_name::<AtomicUsize>()` prints `core::sync::atomic::Atomic<usize>`), but the name `Atomic<T>` itself is still nightly-only ✅[^1][^5][^6]. An atomic has the size of its integer, and its alignment always equals its size ✅[^6]; measured: `AtomicU64` is 8 bytes, aligned to 8 ✅[^1].
2. **Sharing.** Atomics are `Sync`; share one through `Arc` or a `static` ✅[^2]. Every atomic type that exists on a target is lock-free, but not necessarily wait-free; `#[cfg(target_has_atomic = "64")]` tests for a width ✅[^2].
3. **Operations** take `&self`, so they work through shared references ✅[^8]: `load`, `store`, `swap`, `fetch_add`/`fetch_sub`/`fetch_and`/`fetch_or`/`fetch_xor`/`fetch_max`/`fetch_min`, `compare_exchange` and `compare_exchange_weak`, `try_update` and `update` ✅[^5]. `fetch_add` and `fetch_sub` wrap on overflow instead of panicking ✅[^8]; measured: `fetch_add(1)` on `u64::MAX` returned `18446744073709551615` and left `0` ✅[^1]. `get_mut(&mut self)` and `into_inner(self)` give plain access, which is safe because exclusive access means no other thread can be touching the value ✅[^5].
4. **Indivisible read-modify-write (RMW).** 8 threads × 100,000 increments ✅[^1]:
   ```rust
   let v = split.load(Relaxed);   // two atomic steps: another thread can
   split.store(v + 1, Relaxed);   // write between them
   rmw.fetch_add(1, Relaxed);     // one atomic step
   // expected 800000 · load + store 463758 · fetch_add 800000
   ```
   `Relaxed` is enough for a counter that nothing else synchronizes through ✅[^7].
5. **The data race rule.** Rust uses the C++20 atomics rules, without the `consume` ordering ✅[^2]. A data race is two conflicting accesses (overlapping memory, at least one a write) where neither happens-before the other and at least one is non-atomic; a data race is undefined behaviour ✅[^2][^12]. Safe Rust cannot create one; only `unsafe` code can ✅[^8].

### Modification order and happens-before

**4 actors** in the message-passing pattern:
- **Writer thread** — its job: write the payload, then publish it, via `data.store(..)` then `ready.store(.., Release)`.
- **`ready`'s modification order** — its job: hold every store to `ready` in one order all threads agree on, via the atomic variable itself.
- **Reader thread** — its job: check the flag, then use the payload, via `ready.load(Acquire)` then `data.load(..)`.
- **Compiler and CPU** — their job: make each thread fast, via reordering any access that no ordering pins.

```
 Writer thread                         Reader thread
 data.store(i, Relaxed)    ──┐
                             │ program order (sequenced-before)
 ready.store(i, Release) ────┼──── reads-from ────▶ ready.load(Acquire) == i
                             │      = synchronizes-with   │ program order
                             └── happens-before ────────▶ data.load(Relaxed) ≥ i
 With Relaxed on both ends: no synchronizes-with edge, so data.load may return an older value
```
1. **Writer (local):** `data.store` comes before `ready.store` in program order, and within one thread, everything happens in program order ✅[^9]. Nothing has reached other cores yet: the CPU may make the two stores visible in either order, unless an ordering forbids it ✅[^7].
2. **Writer → memory:** `Release` on `ready.store` forbids moving any earlier access after it ✅[^7]. The new value joins `ready`'s modification order. Every atomic has one, even when only `Relaxed` is used ✅[^9].
3. **Reader:** `ready.load(Acquire)` reads some value from that order. If it reads the value the `Release` store wrote, the store *synchronizes-with* the load: everything before the store happens-before everything after the load ✅[^3][^9].
4. **Reader (local):** `Acquire` forbids moving later accesses before the load, so `data.load` sees `i` or newer ✅[^7]. If the load returns an older flag value, there is no edge and no promise about `data`.
5. **Other edges:** spawning a thread orders the code before `spawn()` before the new thread's work, and `join()` orders the thread's work before the code after `join()` ✅[^9]. Unlocking a mutex happens-before the next locking of it ✅[^9]. RMW operations that follow a `Release` store keep its synchronization alive for later `Acquire` readers (a *release sequence*); a plain store breaks the chain ✅[^9].

Ordering does not make a store visible sooner: the model promises what you will see *once* you see a value, not when ✅[^9].

### The five orderings
| Ordering | Allowed on | Effect |
|---|---|---|
| `Relaxed` | any operation | Atomic, nothing more: no happens-before edge ✅[^3][^7] |
| `Release` | stores and RMW | Earlier accesses become visible to whoever `Acquire`-loads this value; on an RMW, the load half is `Relaxed` ✅[^3] |
| `Acquire` | loads and RMW | If the value came from a `Release` store, later accesses see everything before that store; on an RMW, the store half is `Relaxed` ✅[^3] |
| `AcqRel` | RMW only | `Acquire` for the load half, `Release` for the store half ✅[^3] |
| `SeqCst` | any operation | Like `Acquire`/`Release`/`AcqRel`, plus one total order of all `SeqCst` operations that every thread sees ✅[^3] |

A wrong pairing is caught early: `flag.load(Ordering::Release)` with a literal ordering is a compile error, `atomic loads cannot have Release or AcqRel ordering` (lint `invalid_atomic_ordering`, deny by default); with the ordering in a variable it panics at run time with "there is no such thing as a release load" ✅[^1][^5].

### Compare-and-exchange
`compare_exchange(expected, new, success, failure)` stores `new` only if the current value equals `expected`, returning `Ok(previous)` or `Err(actual)` ✅[^8]. The failure ordering can only be `SeqCst`, `Acquire` or `Relaxed` ✅[^5]; measured: `success = Relaxed, failure = SeqCst` is accepted ✅[^1]. `compare_exchange_weak` may fail even when the values match ("spuriously"), which can compile to cheaper code; use it in a retry loop, and use the strong form when one attempt must decide ✅[^5][^8]. An identifier (ID) allocator that never passes its limit ✅[^1]:
```rust
fn next_id(counter: &AtomicU32, limit: u32, retries: &AtomicU64) -> Option<u32> {
    let mut cur = counter.load(Relaxed);
    loop {
        if cur >= limit { return None; }
        match counter.compare_exchange_weak(cur, cur + 1, Relaxed, Relaxed) {
            Ok(_) => return Some(cur),
            Err(actual) => { retries.fetch_add(1, Relaxed); cur = actual; }
        }
    }
}
// 8 threads: ids taken 400000, counter 400000, CAS retries 38858
```
`retries` counts failed compare-and-swap (CAS) attempts: about one per ten IDs under contention. `try_update(.., .., f)` is this loop written for you; it was called `fetch_update` until 1.99, which now warns "renamed to `try_update` for consistency" ✅[^1][^5]. Compare-exchange cannot tell A from A-changed-to-B-and-back (the ABA problem) ✅[^5][^8].

### Fences
`fence(Release)` before a `Relaxed` store, paired with a `Relaxed` load that reads it followed by `fence(Acquire)`, creates the same happens-before edge as a `Release` store and an `Acquire` load ✅[^4]. One fence can cover several variables, or apply only on the path that needs it ✅[^9]. `fence(Relaxed)` is rejected: a literal `Relaxed` is a compile error ("memory fences cannot have `Relaxed` ordering", lint `invalid_atomic_ordering`), and an ordering held in a variable panics with "there is no such thing as a relaxed fence" ✅[^1][^4]. `compiler_fence` stops only compiler reordering, not the CPU; it is for signal handlers and similar same-thread cases ✅[^9].

### What the CPU runs
Rust's orderings are abstract; what a given processor does depends on the instruction the compiler picks. Measured on the lab's aarch64 with `--emit asm` (assembly output) ✅[^1]. `lse` and `rcpc` are aarch64 target features: `rustc --print target-features` describes `lse` as "Enable Armv8.1-A Large System Extension (LSE) atomic instructions" and `rcpc` only as "Enable support for RCPC extension"; turning `rcpc` on is what switches `Acquire` loads to the `ldapr` instruction, and the lab CPU reports it as `lrcpc` in `/proc/cpuinfo` ✅[^1]:

| Operation | Default target features | With `-C target-feature=+rcpc` |
|---|---|---|
| `store(Relaxed)` / `load(Relaxed)` | `str` / `ldr` | `str` / `ldr` |
| `store(Release)` / `load(Acquire)` | `stlr` / `ldar` | `stlr` / `ldapr` |
| `store(SeqCst)` / `load(SeqCst)` | `stlr` / `ldar` | `stlr` / `ldar` |
| `fetch_add(1, Relaxed)` | call to `__aarch64_ldadd4_relax` | same |
| `compare_exchange_weak(.., Acquire, Relaxed)` | call to `__aarch64_cas4_acq` | same; with `-outline-atomics,-lse` an `ldaxr`/`stxr` pair |

A store-buffering (SB) litmus test shows why this matters. Each round, after a spin barrier, thread A runs `X = i; ra = Y` and thread B runs `Y = i; rb = X`. With `SeqCst` on all four operations, at least one load must see the other thread's store ✅[^9]. `Release`/`Acquire` gives no such promise: loom's model of the C11 rules (the atomics model of C11 and C++11, which Rust inherits through C++20 ✅[^7]) finds the "both old" execution (Worked example, step 4), and so does this CPU. Counts of "both old", per 2,000,000 rounds, 3 runs ✅[^1]:

| Ordering | Default build | `+rcpc` build |
|---|---|---|
| `Relaxed` | 1,772,918 · 1,408,446 · 1,708,525 | 1,842,501 · 1,931,772 · 1,949,408 |
| `Release`/`Acquire` | 0 · 0 · 0 | 347,797 · 415,172 · 452,826 |
| `SeqCst` | 0 · 0 · 0 | 0 · 0 · 0 |

`Release`/`Acquire` code that "needs" `SeqCst` passed every test in the default build and failed in about 20 % of rounds once `Acquire` loads became `ldapr`. Testing on one machine with one build shows only what that instruction choice allows.

## Worked example
Catch a wrong ordering with loom 0.7.3, a model checker that runs a test closure under every interleaving the C11 memory model allows, within limits ✅[^10].

1. **Set it up.** loom replaces `std` types only where you use its own (`loom::thread`, `loom::sync::atomic`, `loom::cell::UnsafeCell`), behind a `cfg(loom)` flag ✅[^10]:
   ```toml
   [target.'cfg(loom)'.dev-dependencies]
   loom = "0.7"

   [lints.rust]
   unexpected_cfgs = { level = "warn", check-cfg = ['cfg(loom)'] }
   ```
2. **Write the model** (`tests/message_passing.rs`, starting with `#![cfg(loom)]`):
   ```rust
   fn atomic_payload(publish: Ordering, check: Ordering) {
       loom::model(move || {
           let ready = Arc::new(AtomicBool::new(false));
           let payload = Arc::new(AtomicU32::new(0));
           let (r, p) = (Arc::clone(&ready), Arc::clone(&payload));
           let t = thread::spawn(move || {
               p.store(42, Ordering::Relaxed);
               r.store(true, publish);
           });
           if ready.load(check) {
               assert_eq!(payload.load(Ordering::Relaxed), 42, "flag seen, payload stale");
           }
           t.join().unwrap();
       });
   }
   #[test] fn payload_release_acquire() { atomic_payload(Ordering::Release, Ordering::Acquire); }
   #[test] fn payload_relaxed()         { atomic_payload(Ordering::Relaxed, Ordering::Relaxed); }
   ```
   A second model, `mailbox`, keeps the payload in a `loom::cell::UnsafeCell<u32>` and writes it with `with_mut`, reads it with `with`.
3. **Run it** with `RUSTFLAGS="--cfg loom" cargo test --release` ✅[^10]. Result ✅[^1]:
   ```
   test mailbox_relaxed ... FAILED
   test mailbox_release_acquire ... ok
   test payload_relaxed ... FAILED
   test payload_release_acquire ... ok
   thread 'mailbox_relaxed' panicked at .../loom-0.7.3/src/rt/location.rs:115:9:
   Causality violation: Concurrent read and write accesses.
   thread 'payload_relaxed' panicked at tests/message_passing.rs:36:13:
   assertion `left == right` failed: flag seen, payload stale
     left: 0
    right: 42
   ```
   loom found the stale value by itself: it models `Relaxed` loads that return an older store, which a run on real hardware hits only sometimes. The whole file finished in 0.01 s.
4. **Know its limits.** loom treats `SeqCst` loads and stores as `AcqRel`, so it can report bugs that cannot happen; `fence(SeqCst)` is modelled. It also skips some load-buffering executions, so a pass is not a proof ✅[^11]. Measured, on the store-buffering pattern (two threads, `x.store(1); y.load()` and `y.store(1); x.load()`, asserting that not both loads return 0): with `Release`/`Acquire`, loom reported "both loads saw 0", an execution the C11 rules allow; with `SeqCst` loads and stores it reported the same, which is a false alarm; with `Relaxed` accesses and `fence(SeqCst)` between each store and load it passed; a `fence(Release)`/`fence(Acquire)` version of message passing also passed ✅[^1]. Spin loops need `loom::thread::yield_now`, and `LOOM_MAX_PREEMPTIONS=2` or `3` bounds the search for bigger tests ✅[^10].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| "I need `SeqCst` so others see my write sooner" | No ordering speeds up visibility; a stronger one can only add cost | The model says what you see, not when ✅[^9] |
| `SeqCst` everywhere "to be safe" | Can still be wrong: the algorithm, not the ordering, may be the bug | Treat `SeqCst` as a sign that the reasoning needs a second look ✅[^9] |
| A "release load" or "acquire store" | Does not exist: compile error with a literal, panic with a variable | `Release` is for stores, `Acquire` for loads ✅[^1][^3][^9] |
| `Relaxed` counter read after `join()` | Exact total (800000) | `join` creates the happens-before edge, not the counter ✅[^1][^9] |
| Atomic store racing with a non-atomic write to the same bytes | UB | A data race needs only one non-atomic access; concurrent atomic and non-atomic *reads* are allowed ✅[^2] |
| `AtomicU16` and an `AtomicU8` view of half of it, used concurrently | UB | Non-synchronized atomic accesses must not partially overlap ✅[^2] |
| `compare_exchange_weak` with nobody else touching the value | 0 spurious failures in 50,000,000 with the LSE `cas` instruction; 1,862 with `-C target-feature=-outline-atomics,-lse` (an `ldaxr`/`stxr` pair) | The weak form may fail spuriously; whether it does depends on the instruction ✅[^1][^5] |
| `fetch_add` used to hand out IDs | Wraps to 0 after the maximum | Use a `compare_exchange` loop with a limit (above) ✅[^8] |
| Code tested only on x86 | Weak orderings "happen to work" | x86 orders memory strongly; test on weakly ordered hardware ✅[^7] |
| `Ordering::Consume` | Not in Rust | Compilers implement it as `Acquire` anyway ✅[^9] |
| Rust's memory model | Not finished: the Reference calls it incomplete | Atomics follow C++20 meanwhile ✅[^2][^13] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Relaxed` | Cheapest; plain `ldr`/`str` here | Orders nothing but the variable itself |
| `Release`/`Acquire` pairs | Exactly the publish/consume edges most code needs | You must name the pair that synchronizes |
| `SeqCst` | One global order; fixes store-buffering patterns | Hides which edge the code relies on; may cost more |
| Fences | One fence for many variables, or only on one path | Easier to misplace than an ordering on the operation |
| A `Mutex` instead | No ordering reasoning at all | Blocking, contention |

## Takeaways
- Name the `Release` store and the `Acquire` load that pair up, in a comment next to each. [rule-candidate]
- Use `Relaxed` only when no other memory depends on the value (counters, statistics). [rule-candidate]
- Replace `load` + `store` read-modify-write sequences with `fetch_*`, `compare_exchange` or `try_update`. [rule-candidate]
- Use `compare_exchange_weak` inside retry loops and the strong form for one-shot decisions.
- Model-check new lock-free code with loom, and run stress tests on aarch64; a pass on x86 proves little. [rule-candidate]
- Read a loom failure on `SeqCst` loads or stores as "maybe": loom treats them as `AcqRel`.

## Verification status
- Verified: 69 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [std::sync::atomic](https://doc.rust-lang.org/std/sync/atomic/index.html) — Rust standard library, living. Backs: C++20 model without consume, data-race definition, mixed atomic/non-atomic and mixed-size rules, `Sync`, lock-free, `target_has_atomic`. [^2]
- [Ordering in std::sync::atomic](https://doc.rust-lang.org/std/sync/atomic/enum.Ordering.html) — Rust standard library, living. Backs: the five orderings and where each applies. [^3]
- [fence in std::sync::atomic](https://doc.rust-lang.org/std/sync/atomic/fn.fence.html) — Rust standard library, living. Backs: fence–fence and fence–atomic synchronization, `fence(Relaxed)` panics. [^4]
- [Atomic in std::sync::atomic](https://doc.rust-lang.org/std/sync/atomic/struct.Atomic.html) — Rust standard library, living. Backs: generic `Atomic<T>` is nightly-only, failure orderings, spurious failure of `compare_exchange_weak`, ABA, `try_update`/`update`, `fetch_update` renamed in 1.99, `get_mut`/`into_inner`, load/store panics. [^5]
- [AtomicUsize in std::sync::atomic](https://doc.rust-lang.org/std/sync/atomic/type.AtomicUsize.html) — Rust standard library, living. Backs: `AtomicUsize = Atomic<usize>`, size and alignment. [^6]
- [Atomics](https://doc.rust-lang.org/nomicon/atomics.html) — The Rustonomicon (Rust project), living. Backs: compiler and hardware reordering, x86 strong versus ARM weak, acquire/release as barriers, relaxed counters. [^7]
- [Chapter 2. Atomics](https://mara.nl/atomics/atomics.html) — Mara Bos, Rust Atomics and Locks, 2023. Backs: operations take `&self`, `fetch_add` wraps, ID allocation, compare-exchange and its weak form, ABA. [^8]
- [Chapter 3. Memory Ordering](https://mara.nl/atomics/memory-ordering.html) — Mara Bos, Rust Atomics and Locks, 2023. Backs: reordering, happens-before rules, modification order, release sequences, SeqCst example, fences, compiler fences, consume, misconceptions. [^9]
- [loom - Rust](https://docs.rs/loom/0.7.3/loom/) — loom project (Tokio), 2026. Backs: permutation testing under the C11 model, `loom::model`, `cfg(loom)` setup, `yield_now`, `LOOM_MAX_PREEMPTIONS`. [^10]
- [loom 0.7.3 - Docs.rs](https://docs.rs/crate/loom/0.7.3) — loom project (Tokio), 2026 (the crate's README). Backs: unsupported features: `SeqCst` accesses treated as `AcqRel`, `fence(SeqCst)` supported, load buffering not explored. [^11]
- [Behavior considered undefined](https://doc.rust-lang.org/reference/behavior-considered-undefined.html) — The Rust Reference (Rust project), living. Backs: data races are UB. [^12]
- [Memory model](https://doc.rust-lang.org/reference/memory-model.html) — The Rust Reference (Rust project), living. Backs: the memory model is incomplete. [^13]

## Related
- `rust/concurrency/threads-channels-and-locks.md` — the blocking primitives built on these operations.
- `rust/concurrency/building-a-spinlock-channel-and-arc.md` — these orderings applied, with Miri.
- `concurrency/shared-state-and-data-races.md` — the cross-language view.
- `rust/unsafe/unsafe-rust-and-undefined-behavior.md` — UB and Miri in general.
- `rust/project-structure/testing.md` — test layout that the loom tests plug into.
