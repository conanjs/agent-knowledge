---
schema: knowledge-doc/v1
type: concept
topic: dotnet/async
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, async, cancellation, cancellationtoken, timeout, waitasync, valuetask, ivaluetasksource, iasyncenumerable, await-foreach, enumeratorcancellation]
ranked-sources: true
---

# Cancellation, ValueTask and async streams

## Summary
**TL;DR:** Cancellation in .NET is cooperative: a `CancellationTokenSource` raises a flag that every copy of its `CancellationToken` sees, and the running code must check it or pass it on; nothing is stopped by force. A task ends `Canceled` only when the code throws `OperationCanceledException` for the right token. `ValueTask<T>` avoids allocating a task when a result is ready at once, at the price of strict rules: await it once and never read `.Result` early. `IAsyncEnumerable<T>` with `await foreach` pulls items lazily, and the token reaches the producer only through a parameter marked `[EnumeratorCancellation]`.
**Use this when:** you add a timeout or a cancel button, a task ends `Faulted` instead of `Canceled`, you consider returning `ValueTask<T>` from a hot method, or you write or consume an async iterator.
**Not this doc:** what `Task` and `await` compile to → `dotnet/async/tasks-and-async-await.md`; `ConfigureAwait` and contexts in general → `dotnet/async/synchronization-context-and-configureawait.md`; producer/consumer queues and channels → `dotnet/concurrency/concurrent-collections-and-channels.md`.

## Problem
- `cts.Cancel()` is called, yet the work keeps running: nothing in it looks at the token.
- A canceled operation reports `Faulted`, or the caller catches `TaskCanceledException` in one place and `OperationCanceledException` in another.
- A timeout wrapper "cancels" a call, but the underlying operation finishes later anyway.
- A `ValueTask<T>` awaited twice throws `InvalidOperationException`, or `.Result` throws instead of waiting.
- `await foreach (var x in Source().WithCancellation(token))` never stops, because the iterator never received the token.

## Mental model
**Analogy:** a `CancellationTokenSource` is a referee's whistle and each `CancellationToken` is a player's ear. The whistle only makes a sound; each player decides when to stop running (cooperative). A player who stops and raises their hand with "the referee whistled" reports a clean stop (`Canceled`); a player who just collapses reports an injury (`Faulted`). A `ValueTask<T>` is a reusable ticket stub: cheap because the cloakroom reuses stubs, but once you have collected your coat, the stub may already belong to the next guest.

**Artifact** (run in the lab ✅[^lab]):
```csharp
using var cts = new CancellationTokenSource();
var throwing  = Task.Run(() => { while (true) { cts.Token.ThrowIfCancellationRequested(); Thread.Sleep(10); } }, cts.Token);
var returning = Task.Run(() => { while (!cts.Token.IsCancellationRequested) Thread.Sleep(10); }, cts.Token);
cts.CancelAfter(55);
// throwing:  OperationCanceledException after ~6 iterations, Status=Canceled
// returning: Status=RanToCompletion   (it stopped, but reported success)
```

## How it works
### Cancellation
Three actors take part:
- **Requester** — its job: decide when to cancel, via `CancellationTokenSource.Cancel()` or `CancelAfter()`.
- **Token (`CancellationToken`)** — its job: carry the request to every listener, via `IsCancellationRequested`, `Register` callbacks and `WaitHandle`.
- **Listener (the operation)** — its job: stop at a safe point, via polling, a callback, or passing the token to the APIs (application programming interfaces) it calls.

1. **Requester → token:** `CancellationTokenSource` creates the token and issues the request to all copies of it; `CancellationToken` is a lightweight value type passed to listeners ✅[^cancel-managed]. Once set, `IsCancellationRequested` never goes back to `false`, so a token cannot be reused ✅[^cancel-managed].
2. **Token → callbacks:** `Cancel()` runs the registered callbacks synchronously, in LIFO (last in, first out) order, before it returns ✅[^api-cts-cancel]. In the lab, `Cancel()` called on thread 4 ran callback B, then A, both on thread 4, and only then returned ✅[^lab]. Registering on an already canceled token runs the delegate at once, on the registering thread ✅[^api-ct] ✅[^lab].
3. **Listener → task state:** a delegate given to `Task.Run(..., token)` can simply return, which leaves the task `RanToCompletion`, or throw `OperationCanceledException` for that token, usually with `ThrowIfCancellationRequested()`, which makes it `Canceled` ✅[^task-cancel] ✅[^lab]. If the exception carries a different token, or the token was not canceled, the task becomes `Faulted` ✅[^task-cancel] ✅[^lab]. An `async` method is looser: any uncaught `OperationCanceledException` puts its task in the canceled state ✅[^spec-async]; in the lab one that threw for an unrelated token still ended `Canceled` ✅[^lab].
4. **Exception types:** `TaskCanceledException` represents task cancellation ✅[^api-tce] and derives from `OperationCanceledException`: a canceled `Task.Delay` threw `TaskCanceledException`, which `catch (OperationCanceledException)` caught, while `ThrowIfCancellationRequested()` threw the base type ✅[^lab]. Catch `OperationCanceledException` to handle both.
5. **Combining and timing:** `CreateLinkedTokenSource` makes a source that is canceled when any of its inputs is ✅[^api-cts]; canceling it, or one input, does not cancel the other inputs (lab: `linked=True, parent=False`) ✅[^lab]. `CancelAfter` starts a countdown, and a second call resets it ✅[^api-cts-cancelafter] ✅[^lab].
6. **Lifetime:** `CancellationTokenSource` implements `IDisposable` and should be disposed ✅[^cancel-managed]; `Dispose` does not cancel ✅[^api-cts-dispose]. In the lab, a token's `IsCancellationRequested` stayed `False` after `Dispose`, and `Cancel()` then threw `ObjectDisposedException` ✅[^lab]. `TryReset()` lets the sole owner reuse a source that was not canceled ✅[^api-cts-tryreset]; it returned `False` after `Cancel()` in the lab ✅[^lab].

### Timeouts
7. **Cancel the work versus cancel the wait:** a timeout can stop the operation, stop only your wait, or both ✅[^non-cancelable]. Link a caller's token with a timeout source when the callee accepts a token; use `Task.WaitAsync` to time out only the wait ✅[^coalesce]. `WaitAsync(TimeSpan)` faults its returned task with `TimeoutException` ✅[^api-waitasync]. In the lab, `WaitAsync(100 ms)` threw at about 102 ms while the underlying 500 ms operation kept running and completed at about 502 ms with its normal result ✅[^lab]; `WaitAsync(token)` threw `TaskCanceledException` ✅[^lab]. Keep a reference to an abandoned operation so its later failure is still observed ✅[^non-cancelable].

### `ValueTask<T>`
8. **What it is:** a struct that wraps either a result, a `Task<T>`, or an `IValueTaskSource<T>`; meant for methods that often finish synchronously and are called so often that allocating a `Task<T>` each time is too costly ✅[^api-vt]; the `IValueTaskSource<T>` case lets performance-focused libraries reuse one object across operations ✅[^blog-vt]. The runtime caches `Task<int>` only for a few small results ✅[^blog-vt]. In a Release build in the lab, a synchronously completing `async Task<int>` allocated 0 bytes for result 4 and 72 bytes for result 42, and the same method returning `ValueTask<int>` allocated 0 bytes for 42; a Debug build allocated 40, 112 and 48 bytes because its state machine is a class ✅[^lab].
9. **The consumption rules:** never await a `ValueTask<T>` more than once, never call `AsTask()` more than once, never read `.Result` or `.GetAwaiter().GetResult()` before it completes or more than once, and never mix these; the results are undefined ✅[^api-vt]. The reason is that a backing `IValueTaskSource<T>` may be recycled for the next operation ✅[^blog-vt]. With a pooled source built on `ManualResetValueTaskSourceCore<T>`, the lab showed both failure modes: awaiting an old `ValueTask` after the source was reused threw `InvalidOperationException`, and `.Result` on an incomplete one threw `InvalidOperationException` instead of blocking ✅[^lab]. Call `.AsTask()` once when you need to await twice or combine it; the lab awaited that `Task<int>` twice and got `2, 2` ✅[^lab].
10. **Default choice:** return `Task`/`Task<T>` unless measurements show the allocation matters; the non-generic `ValueTask` is not recommended for most uses ✅[^api-vt]. `default(ValueTask<T>)` is a completed operation with result `default(T)` ✅[^api-vt] ✅[^lab].

### Async streams
11. **`await foreach` lowering:** the loop calls `GetAsyncEnumerator()`, then `await MoveNextAsync()` before each item, reads `Current`, and disposes the enumerator with `await using` ✅[^spec-foreach]. So an async iterator runs lazily: in the lab no producer code ran until the loop asked for the first item, and each item was produced only when the consumer asked for it ✅[^lab]. A `break` disposes the enumerator, which ran the iterator's `finally` block ✅[^lab].
12. **Cancellation into the iterator:** `[EnumeratorCancellation]` marks the parameter that receives the token passed to `GetAsyncEnumerator`, which `WithCancellation(token)` supplies ✅[^api-ec-attr] ✅[^async-streams]. Without the attribute, the compiler warns CS8425 and the token is not forwarded ✅[^foreach-diag]; in the lab the iterator saw `ct.CanBeCanceled=False` ✅[^lab]. With it, canceling after item 2 ended the loop with `TaskCanceledException` from the producer's `Task.Delay` and ran the producer's `finally` ✅[^lab].
13. **`ConfigureAwait` on a stream:** `await foreach` processes items in the captured context unless you call `.ConfigureAwait(false)` on the stream ✅[^iteration-stmts]. That setting covers only the consumer's awaits on `MoveNextAsync`: in the lab, under a single-threaded context, the loop body still ran on the context thread when the producer's own `await` returned there, and moved off it only when the producer also used `ConfigureAwait(false)` ✅[^lab].

## Worked example
A cancelable async stream read with a token that is canceled after the second item, as one lab run printed it (✅[^lab]):

```csharp
async IAsyncEnumerable<int> Numbers(int count, [EnumeratorCancellation] CancellationToken ct = default)
{
    try { for (int i = 1; i <= count; i++) { await Task.Delay(50, ct); yield return i; } }
    finally { Log("producer finally block runs"); }
}
using var cts = new CancellationTokenSource();
try { await foreach (var n in Numbers(10).WithCancellation(cts.Token)) { Log($"got {n}"); if (n == 2) cts.Cancel(); } }
catch (OperationCanceledException e) { Log($"loop ended with {e.GetType().Name}"); }
```

| Time | Who | What happens | Rule |
|---|---|---|---|
| 0 ms | consumer | `GetAsyncEnumerator(cts.Token)` hands the token to `ct` | How it works 12 |
| 52 ms | producer | `Task.Delay(50, ct)` completes, yields 1 (`ct.CanBeCanceled=True`) | Lazy production (11) |
| 52 ms | consumer | Body runs for item 1 | — |
| 103 ms | producer → consumer | Item 2 produced and consumed; the body calls `cts.Cancel()` | `Cancel()` sets the flag for every copy (1) |
| ~113 ms | producer | The next `Task.Delay(50, ct)` is canceled and throws `TaskCanceledException`; the `finally` runs | Listener stops at its safe point (3) |
| ~114 ms | consumer | `await MoveNextAsync()` rethrows it; the loop ends in the `catch` | `TaskCanceledException` is an `OperationCanceledException` (4) |

(The times above are relative to the start of this loop: in the run's own clock they were 265, 316, 326 and 327 ms.)

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Delegate returns early when canceled | Task is `RanToCompletion`, not `Canceled` ✅[^lab] | Only an `OperationCanceledException` for the task's token acknowledges cancellation ✅[^task-cancel] |
| `Task.Run(() => otherToken.ThrowIfCancellationRequested(), myToken)` | `Faulted` ✅[^lab] | Token mismatch: treated as a normal exception ✅[^task-cancel] |
| Canceling a token after the operation already produced a result | The task should still be `RanToCompletion` (or `Faulted`) ✅[^tap] | Cancellation is a request; the operation may ignore a late one ✅[^tap] |
| A slow or blocking `Register` callback | `Cancel()` does not return until it finishes ✅[^cancel-managed] | Callbacks run synchronously inside `Cancel()` (How it works 2) |
| Timeout measured on the first call of a process | The first `WaitAsync(100 ms)` in a cold process reported its timeout at about 243 ms in the lab; after a warm-up call, at about 102 ms ✅[^lab] | Startup and JIT (just-in-time compilation) cost lands on the first call |
| `ConfigureAwaitOptions.SuppressThrowing` on `Task<T>` | Not supported | See `dotnet/async/synchronization-context-and-configureawait.md` |
| Two `[EnumeratorCancellation]` parameters, or the attribute on a non-iterator | Errors CS8426 and CS8424 ✅[^foreach-diag] | Only one token is forwarded; combine others with a linked source ✅[^foreach-diag] |
| Several tokens reach one `await foreach` (a parameter and `WithCancellation`) | Combined as if by `CreateLinkedTokenSource` ✅[^spec-foreach] | The standard requires one combined token |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Task<T>` | Await any number of times, store, combine ✅[^blog-vt] | One allocation per call unless a cached task fits (How it works 8) |
| `ValueTask<T>` | No allocation on synchronous completion; pooled sources can avoid it on asynchronous completion too ✅[^blog-vt] | Strict one-shot rules (How it works 9); a bigger struct to copy and a larger caller state machine ✅[^api-vt] |
| Linked token plus timeout | One cancellation path that stops the work ✅[^coalesce] | Two sources to dispose ✅[^coalesce] |
| `WaitAsync(timeout)` | Works with APIs that take no token ✅[^coalesce] | The work keeps running and must still be observed ✅[^non-cancelable] |

## Takeaways
- Accept a `CancellationToken` in every public async API and pass it to every call that takes one. [rule-candidate]
- Signal cancellation with `ThrowIfCancellationRequested()` (or by letting the callee throw), not by returning early, so the task ends `Canceled`.
- Catch `OperationCanceledException`, never only `TaskCanceledException`. [rule-candidate]
- Await a `ValueTask<T>` exactly once, directly; call `.AsTask()` if you need anything else. [rule-candidate]
- Mark the token parameter of every async iterator with `[EnumeratorCancellation]`, and treat warning CS8425 as an error.
- Dispose the `CancellationTokenSource` you create; never dispose one a caller gave you.

## Verification status
- Verified: 70 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Cancellation in managed threads](https://learn.microsoft.com/en-us/dotnet/standard/threading/cancellation-in-managed-threads) — Microsoft, living. Rank 1. Backs: the cooperative model, source and token roles, no reuse after cancellation, synchronous callbacks, disposal. [^cancel-managed]
- [Task cancellation](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/task-cancellation) — Microsoft, living. Rank 1. Backs: returning early gives `RanToCompletion`; a matching `OperationCanceledException` gives `Canceled`; a mismatched token gives `Faulted`. [^task-cancel]
- [Async functions (C# standard, §15.14)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes#1514-async-functions) — ECMA / Microsoft, living. Rank 1. Backs: an uncaught `OperationCanceledException` puts an async method's task in the canceled state. [^spec-async]
- [Asynchronous foreach (C# standard, §13.9.5.3)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/statements#13953-asynchronous-foreach) — ECMA / Microsoft, living. Rank 1. Backs: the `GetAsyncEnumerator`/`MoveNextAsync`/`await using` expansion; the `[EnumeratorCancellation]` token and combined tokens. [^spec-foreach]
- [Iteration statements: await foreach](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements) — Microsoft, living. Rank 1. Backs: items are processed in the captured context unless `ConfigureAwait(false)` is used. [^iteration-stmts]
- [Generate and consume async streams](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/generate-consume-asynchronous-stream) — Microsoft, living. Rank 1. Backs: `[EnumeratorCancellation]` and `WithCancellation`. [^async-streams]
- [Errors and warnings for foreach statements](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/foreach-diagnostics) — Microsoft, living. Rank 1. Backs: CS8424, CS8425, CS8426. [^foreach-diag]
- [Task-based asynchronous pattern (TAP)](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/task-based-asynchronous-pattern-tap) — Microsoft, living. Rank 1. Backs: an operation may ignore a late cancellation request and still succeed or fault. [^tap]
- [Coalesce cancellation tokens from timeouts](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/coalesce-cancellation-tokens-from-timeouts) — Microsoft, living. Rank 1. Backs: linked tokens versus `CancelAfter` versus `WaitAsync`; dispose what you create. [^coalesce]
- [Cancel non-cancelable async operations](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/cancel-non-cancelable-async-operations) — Microsoft, living. Rank 1. Backs: cancel the operation, the wait, or both; observe abandoned operations. [^non-cancelable]
- [CancellationTokenSource class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.cancellationtokensource) — Microsoft, living. Rank 1. Backs: linked sources. [^api-cts]
- [CancellationTokenSource.Cancel Method](https://learn.microsoft.com/en-us/dotnet/api/system.threading.cancellationtokensource.cancel) — Microsoft, living. Rank 1. Backs: callbacks run synchronously in LIFO order. [^api-cts-cancel]
- [CancellationTokenSource.CancelAfter Method](https://learn.microsoft.com/en-us/dotnet/api/system.threading.cancellationtokensource.cancelafter) — Microsoft, living. Rank 1. Backs: a later call resets the delay. [^api-cts-cancelafter]
- [CancellationTokenSource.Dispose Method](https://learn.microsoft.com/en-us/dotnet/api/system.threading.cancellationtokensource.dispose) — Microsoft, living. Rank 1. Backs: `Dispose` does not request cancellation. [^api-cts-dispose]
- [CancellationTokenSource.TryReset Method](https://learn.microsoft.com/en-us/dotnet/api/system.threading.cancellationtokensource.tryreset) — Microsoft, living. Rank 1. Backs: for the sole owner; succeeds only if cancellation was not requested. [^api-cts-tryreset]
- [CancellationToken.Register](https://learn.microsoft.com/en-us/dotnet/api/system.threading.cancellationtoken.register) — Microsoft, living. Rank 1. Backs: a delegate registered on a canceled token runs immediately and synchronously. [^api-ct]
- [TaskCanceledException class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskcanceledexception) — Microsoft, living. Rank 1. Backs: the exception that communicates task cancellation. [^api-tce]
- [Task.WaitAsync](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.waitasync) — Microsoft, living. Rank 1. Backs: the returned task faults with `TimeoutException` when the timeout expires. [^api-waitasync]
- [ValueTask\<TResult\> struct](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.valuetask-1) — Microsoft, living. Rank 1. Backs: what it wraps and when to use it; the operations that must never be performed; default to `Task`; `default(ValueTask<T>)`. [^api-vt]
- [EnumeratorCancellationAttribute class](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.enumeratorcancellationattribute) — Microsoft, living. Rank 1. Backs: marks the parameter that receives the `GetAsyncEnumerator` token. [^api-ec-attr]
- [Understanding the Whys, Whats, and Whens of ValueTask](https://devblogs.microsoft.com/dotnet/understanding-the-whys-whats-and-whens-of-valuetask/) — Stephen Toub, .NET Blog, 2018. Rank 4. Backs: the small `Task<int>` cache; pooled `IValueTaskSource` objects; why reuse forbids a second await; when `ValueTask` pays off. [^blog-vt]

## Related
- `dotnet/async/tasks-and-async-await.md` — task states and exception propagation.
- `dotnet/async/synchronization-context-and-configureawait.md` — contexts and `ConfigureAwait`.
- `dotnet/concurrency/concurrent-collections-and-channels.md` — `ChannelReader<T>.ReadAllAsync` as an async stream.
- `dotnet/collections-and-linq/iterators.md` — the synchronous `yield` state machine.
- `dotnet/performance/measuring-and-reducing-allocations.md` — measuring allocations like the `ValueTask` numbers above.
