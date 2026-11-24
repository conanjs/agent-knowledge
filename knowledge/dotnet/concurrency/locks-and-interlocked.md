---
schema: knowledge-doc/v1
type: concept
topic: dotnet/concurrency
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, data-race, lock, monitor, system-threading-lock, interlocked, compareexchange, semaphoreslim, readerwriterlockslim, mutex, barrier, countdownevent, deadlock]
ranked-sources: true
---

# Locks, Interlocked and the other synchronization primitives

## Summary
**TL;DR:** `count++` on a shared field is three steps (read, add, write), so two threads can both read the same old value and one update is lost: in the lab 4 threads × 1,000,000 increments ended anywhere from about 1.0 to 1.9 million, a different total each run. Fix it with `Interlocked` for a single variable, or a `lock` for anything bigger. C# lowers `lock` on a `System.Threading.Lock` (.NET 9 and later) to `EnterScope()`/`Dispose()`, and on any other object to `Monitor.Enter`/`Monitor.Exit` in a `try`/`finally`. `SemaphoreSlim` limits how many run at once (and works with `await`), `ReaderWriterLockSlim` lets readers share, `Mutex` works across processes, and lock ordering prevents deadlocks.
**Use this when:** a counter or a collection is "sometimes wrong" under load, you must pick between `lock`, `Interlocked`, `SemaphoreSlim`, `ReaderWriterLockSlim` and `Mutex`, two threads hang waiting for each other, or you need to throttle concurrent async calls.
**Not this doc:** why a plain flag read in a loop may never see an update, `volatile` and memory barriers → `dotnet/concurrency/memory-model.md`; thread-safe collections and channels → `dotnet/concurrency/concurrent-collections-and-channels.md`.

## Problem
- A shared `int` counter updated from several threads ends lower than the number of updates, by a different amount each run.
- Code locks on `this`, a `Type` or a string literal, and unrelated code that locks the same object makes it stall.
- `await` inside a `lock` does not compile, and the obvious workaround (a `Monitor` around an `await`) is worse.
- Two methods that each take two locks, in opposite orders, hang forever under load.
- A `Lock` object stored in an `object` variable silently uses a different, slower locking mechanism.

## Mental model
**Analogy:** a shared whiteboard total. Each person reads the number, adds one in their head, and writes the new number. Two people who read "41" at the same moment both write "42": one addition is lost. A `lock` is a single marker pen: only the person holding it may read and write. `Interlocked.Increment` is a machine bolted to the board that does read-add-write as one indivisible press of a button.

**Artifact** (lab, Release build, Apple M2, 8 cores ✅[^lab]):
```csharp
// 4 threads, each running the body 1,000,000 times
Run(() => plain++);                                  // count++      ends at 1,934,394 / 1,605,273 / 1,518,139 in three rounds
Run(() => Interlocked.Increment(ref interlocked));   // Interlocked  4,000,000 every round
Run(() => { lock (gate) monitorCount++; });          // lock(object) 4,000,000
Run(() => { lock (typedLock) lockCount++; });        // lock(Lock)   4,000,000
```

## How it works
### The race
1. **Why `++` loses updates:** incrementing a field means loading it into a register, adding, and storing it back, and another thread can run between those steps ✅[^best-practices]. A race condition is a bug whose outcome depends on which thread gets there first, so each run gives a different result ✅[^best-practices]; the three rounds in the Artifact gave three different totals, and a later re-run on the same machine three more, from 1,023,156 to 1,083,338 ✅[^lab].

### `lock`, `Monitor` and `System.Threading.Lock`
Three actors take part in a `lock` statement:
- **Compiler** — its job: lower `lock (x) { … }`, via a pattern chosen from the static type of `x`.
- **`Monitor` (for any reference type)** — its job: give one thread at a time ownership of an object, via `Monitor.Enter(object, ref bool)` and `Monitor.Exit(object)`.
- **`Lock` (for `System.Threading.Lock`)** — its job: the same, via `EnterScope()`, which returns a `Lock.Scope` whose `Dispose()` exits.

2. **Compiler, lowering:** when `x` is known to be a `System.Threading.Lock`, `lock (x)` is exactly `using (x.EnterScope()) { … }`; otherwise it is `Monitor.Enter(x, ref lockTaken)` in a `try` with `Monitor.Exit` in the `finally`, so the lock is released even when the body throws ✅[^stmt-lock]. Reading the IL (intermediate language) of three lab methods confirmed it: `lock (gate)` called `Monitor.Enter(Object, Boolean&)` and `Monitor.Exit(Object)`; `lock (typed)` called `Lock.EnterScope()` and `Scope.Dispose()`; the same `Lock` stored in an `object` local fell back to `Monitor.Enter`/`Exit` ✅[^lab].
3. **Compiler, guard rails:** the compiler warns when a `Lock` is converted to another type and locked ✅[^stmt-lock]; the lab got warning CS9216, "converted to a different type will use likely unintended monitor-based locking" ✅[^lab]. The type must be exactly `Lock` for the new path; `object` or a generic `T` uses a different, non-interchangeable implementation ✅[^api-lock]. `await` is not allowed inside a `lock` body ✅[^stmt-lock], error CS1996 ✅[^lab], because a lock belongs to a thread and code after an `await` may run on another one ✅[^api-lock].
4. **Runtime, ownership:** at most one thread holds the lock; the holder may enter it again and must exit as many times as it entered ✅[^api-lock] ✅[^stmt-lock]. In the lab, nested `lock (l)` on a `Lock` and nested `lock (o)` on an `object` both succeeded on one thread ✅[^lab]. From .NET 9 with C# 13, a dedicated `Lock` instance is the recommended lock object ✅[^stmt-lock].
5. **What to lock on:** a private, dedicated object used for nothing else; not `this` (callers can lock it too), not a `Type` (anyone can get it through `typeof`), and not a string, because literals are interned (shared) ✅[^stmt-lock] ✅[^best-practices]. In the lab, two unrelated classes that locked their own `"config"` literal got the same object (`ReferenceEquals` was `True`), and the second could not enter within 200 ms while the first held it ✅[^lab].

### `Interlocked`
6. **Atomic single-variable updates:** `Interlocked` offers atomic operations on variables shared between threads ✅[^api-interlocked], and is the usual fix for a counter race ✅[^best-practices]. `CompareExchange(ref x, value, comparand)` stores `value` only if `x` still equals `comparand`, atomically, and returns the original value either way ✅[^api-interlocked], which makes retry loops possible for updates no single method covers. In the lab, 4 threads ran 1,200,000 capped additions through such a loop: the balance stopped exactly at the 1,000,000 cap, 200,000 additions were refused, and 999,808 attempts had to retry because another thread got in first ✅[^lab].

### The other primitives
7. **`SemaphoreSlim`:** limits how many callers are inside at once; `Wait` and `WaitAsync` enter, `Release` leaves; it supports no named, cross-process form and is the recommended semaphore inside one app ✅[^api-semslim]. It does not track which thread or task entered, so `Wait` and `Release` pairing is your job ✅[^api-semslim]; waiters are released in no guaranteed order ✅[^api-semslim]. In the lab `SemaphoreSlim(2)` kept 6 async 100 ms jobs to 2 at a time (309 ms in total); a second `Wait` on the same thread did not re-enter (`Wait(200)` returned `false`), and another thread could `Release` it ✅[^lab].
8. **`ReaderWriterLockSlim`:** any number of threads in read mode, or one in write mode with nobody else; recursion is off by default (`LockRecursionPolicy.NoRecursion`) ✅[^api-rwls]. In the lab 4 readers held it at once, the writer saw 0 active readers, and entering the read lock twice threw `LockRecursionException` ✅[^lab].
9. **`Mutex`:** usable across processes when named; it enforces thread identity, so only the owning thread can release it, and a mutex whose owner thread exits is "abandoned": the next thread to acquire it gets `AbandonedMutexException` ✅[^api-mutex]. On Unix-like systems a named mutex is limited to the user who created it by default ✅[^api-mutex]. In the lab, a child process could not acquire a named mutex within 300 ms while the parent held it, and could after the parent released it; a release from a non-owner thread threw `ApplicationException`; waiting after the owner thread exited threw `AbandonedMutexException` ✅[^lab].
10. **Signals and rendezvous:** `ManualResetEventSlim` is a lightweight event that stays signaled until reset, spins briefly before blocking, and is for use within one process ✅[^api-mres]; `CountdownEvent` becomes set when its count reaches zero ✅[^api-countdown]; `Barrier` lets a group of tasks move through phases together, each waiting for all the others at the end of a phase ✅[^api-barrier]. Lab: one `Set()` released all 3 waiters; `CountdownEvent(3)` was set after three `Signal()` calls; a 3-party `Barrier` printed all phase-0 lines before `[phase 0 done]` and only then any phase-1 line ✅[^lab]. The "Slim" types use no operating-system handle, which typically makes them faster but unusable across processes ✅[^sync-overview].

## Worked example
Two transfers that each lock two accounts, run on dedicated threads, with a 100 ms pause after the first lock and `Monitor.TryEnter(second, 1000)` instead of a blocking `lock` so the probe ends (✅[^lab]):

| Step | T1: `Transfer(a, b)` | T2: `Transfer(b, a)` | State |
|---|---|---|---|
| 1 | `lock (a)` succeeds | `lock (b)` succeeds | Each holds one lock |
| 2 | sleeps 100 ms | sleeps 100 ms | — |
| 3 | `TryEnter(b, 1000)` waits: T2 holds `b` | `TryEnter(a, 1000)` waits: T1 holds `a` | A cycle: each waits for the other (deadlock) |
| 4 | after 1 s returns `false` | after 1 s returns `false` | Lab output: "gave up after 1 s waiting for its second lock (deadlock)" for both |
| 5 | rerun as `Transfer(a, b)` | rerun as `Transfer(a, b)` | Same order for both: "got both locks" twice |

With a plain `lock` in step 3, both threads would wait forever. The rule the docs give is the fix used in step 5: every code path that takes two locks takes them in the same order ✅[^api-lock]; timeouts such as `Monitor.TryEnter(obj, 300)` help detect a deadlock but do not prevent one ✅[^best-practices].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `Interlocked` versus `lock` speed under heavy contention | Over six lab rounds of 4 threads hammering one counter, `Interlocked.Increment` took 101–210 ms per round and a `lock` 72–194 ms, so `Interlocked` was not consistently faster ✅[^lab]; a later re-run of four rounds (4 threads × 1,000,000 increments) had `Interlocked` faster every time, 65–72 ms against 89–147 ms ✅[^lab] | The docs say `Interlocked` gives better performance for atomic updates ✅[^best-practices]; measure under your own contention before choosing for speed |
| `lock (x)` where `x` is a `T` that happens to be a `Lock` | Uses `Monitor`, not `Lock` ✅[^api-lock] | The lowering depends on the static type (How it works 2–3) |
| `SemaphoreSlim(int)` released more often than entered | `CurrentCount` can rise above the initial count ✅[^api-semslim] | Use the `(initial, max)` constructor to cap it ✅[^api-semslim] |
| A thread exits while holding a `Lock` | The lock's behaviour becomes undefined ✅[^api-lock] | Always exit in `finally`, or use `lock`/`using` |
| A static constructor starts a thread that calls a static member of the same type | The new thread blocks until the constructor finishes ✅[^best-practices]. In the lab the thread's read of a static field waited while the constructor sat in `Join(1 s)`; the join returned `false` after 1,000 ms, and only then did the thread read the field, with the value the constructor set after the wait; without the timeout both threads waited until the process was killed ✅[^lab] | The runtime blocks other threads from using a type until it is initialized ✅[^best-practices] |
| `lock` around `await` rewritten with `Monitor.Enter`/`Exit` | The `Exit` may run on another thread, which does not own the monitor | Locks are held by threads ✅[^api-lock]; use `SemaphoreSlim.WaitAsync` for async mutual exclusion (How it works 7) |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Interlocked` | No lock to take or wait for: a single locked CPU instruction when there is no contention ✅[^best-practices] | One variable at a time; compare-and-swap (CAS) loops retry under contention (How it works 6) |
| `lock` on a `Lock` | Simple, reentrant, exception-safe ✅[^stmt-lock] | Blocks threads; no `await` inside |
| `SemaphoreSlim.WaitAsync` | Mutual exclusion or throttling across `await` ✅[^api-semslim] | Not reentrant; no owner, so mismatched `Release` goes unnoticed ✅[^api-semslim] |
| `ReaderWriterLockSlim` | Readers do not block each other ✅[^api-rwls] | More bookkeeping; recursion off by default |
| Named `Mutex` | Works across processes ✅[^api-mutex] | Operating-system object, thread-affine, can be abandoned |

## Takeaways
- Protect every read-modify-write of shared state with `Interlocked` or a lock; never rely on `x++` being atomic. [rule-candidate]
- Lock on a private `readonly Lock` field (on .NET 9 and later), never on `this`, a `Type` or a string. [rule-candidate]
- Take multiple locks in one global order everywhere. [rule-candidate]
- Use `SemaphoreSlim.WaitAsync` when the protected region contains `await`.
- Keep lock bodies short and never call unknown code (callbacks, events) while holding a lock.

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [The lock statement](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock) — Microsoft, living. Rank 1. Backs: both lowerings; release on exceptions; no `await` in the body; reentrancy; the `Lock` recommendation and conversion warning; what not to lock on. [^stmt-lock]
- [Managed threading best practices](https://learn.microsoft.com/en-us/dotnet/standard/threading/managed-threading-best-practices) — Microsoft, living. Rank 1. Backs: deadlocks and `TryEnter` timeouts; race conditions and the three steps of `++`; `Interlocked` for simple updates; static constructors block other threads; avoid locking types and `this`. [^best-practices]
- [System.Threading.Lock class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.lock) — Microsoft, living. Rank 1. Backs: ownership and reentrancy; no `await` between enter and exit; the exact-type rule; lock ordering; undefined behaviour if the owner exits. [^api-lock]
- [Interlocked class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.interlocked) — Microsoft, living. Rank 1. Backs: atomic operations; `CompareExchange` semantics and return value. [^api-interlocked]
- [SemaphoreSlim class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.semaphoreslim) — Microsoft, living. Rank 1. Backs: local only; `Wait`/`WaitAsync`/`Release`; no identity tracking; no ordering; `CurrentCount` can exceed the initial count. [^api-semslim]
- [ReaderWriterLockSlim class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.readerwriterlockslim) — Microsoft, living. Rank 1. Backs: read, write and upgradeable modes; `NoRecursion` by default. [^api-rwls]
- [Mutex class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.mutex) — Microsoft, living. Rank 1. Backs: named system mutexes; thread identity; abandoned mutexes; Unix per-user scope. [^api-mutex]
- [ManualResetEventSlim class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.manualreseteventslim) — Microsoft, living. Rank 1. Backs: manual reset; brief spinning; within one process. [^api-mres]
- [CountdownEvent class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.countdownevent) — Microsoft, living. Rank 1. Backs: signaled when the count reaches zero. [^api-countdown]
- [Barrier class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.barrier) — Microsoft, living. Rank 1. Backs: phases, each participant waits for all others. [^api-barrier]
- [Overview of synchronization primitives](https://learn.microsoft.com/en-us/dotnet/standard/threading/overview-of-synchronization-primitives) — Microsoft, living. Rank 1. Backs: lightweight types use no OS handles and cannot synchronize processes. [^sync-overview]

## Related
- `dotnet/concurrency/memory-model.md` — what a lock or `Interlocked` guarantees about visibility and ordering.
- `dotnet/concurrency/threads-and-the-thread-pool.md` — the threads that contend for these locks.
- `dotnet/concurrency/concurrent-collections-and-channels.md` — collections that do the locking for you.
- `dotnet/async/synchronization-context-and-configureawait.md` — deadlocks between `await` and blocking.
- `concurrency/shared-state-and-data-races.md` — data races across languages.
