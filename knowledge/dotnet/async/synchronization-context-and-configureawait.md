---
schema: knowledge-doc/v1
type: concept
topic: dotnet/async
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "ASP.NET Core 10"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, async, synchronizationcontext, taskscheduler, configureawait, configureawaitoptions, deadlock, sync-over-async, executioncontext, asynclocal]
ranked-sources: true
---

# SynchronizationContext, ConfigureAwait and ExecutionContext

## Summary
**TL;DR:** When an `await` really suspends, the task's awaiter looks at `SynchronizationContext.Current` (and, failing that, a non-default `TaskScheduler.Current`) and later sends "the rest of the method" back there; with no context, the rest runs on a thread-pool thread. `ConfigureAwait(false)` skips that capture. Blocking with `.Wait()` or `.Result` on a thread whose context has only that one thread deadlocks, because the continuation waits in that thread's queue. Separately, `ExecutionContext` (which carries `AsyncLocal<T>` values) always flows across `await`, while `SynchronizationContext` never does.
**Use this when:** an app hangs at `.Result` or `.Wait()`, you are deciding whether a library should write `ConfigureAwait(false)`, code after an `await` runs on an unexpected thread, or an `AsyncLocal<T>` or `ThreadLocal<T>` value is missing after an `await`.
**Not this doc:** what `await` compiles to and how exceptions travel → `dotnet/async/tasks-and-async-await.md`; how blocked pool threads starve the thread pool, with measurements → `dotnet/concurrency/threads-and-the-thread-pool.md`.

## Problem
The same async method behaves differently depending on who calls it:
- `LibraryAsync().Wait()` returns at once in a console app, but hangs on a UI (user interface) thread.
- Code after an `await` runs on the UI thread in a desktop app and on a random pool thread in a console app or in ASP.NET Core.
- `ConfigureAwait(false)` on the first `await` does not move the rest of the method off the UI thread when that first task was already finished.
- A value stored in a `ThreadLocal<T>` is gone after an `await`, while the same value in an `AsyncLocal<T>` is still there.
- A static constructor that waits for a task hangs for no visible reason.

## Mental model
**Analogy:** a `SynchronizationContext` is a single-desk post office for one clerk (the UI thread). Each finished job is posted to the desk's in-tray, and the clerk works through the tray one item at a time. `ConfigureAwait(false)` means "deliver my result to any free clerk in the big office (the thread pool) instead". The deadlock: the clerk stands at the window waiting for a letter (`.Wait()`), while that very letter sits in the clerk's own in-tray, which nobody else may open. `ExecutionContext` is different: it is the name badge each job carries with it, whichever desk ends up doing the work.

**Artifact:** a single-threaded context written for the lab (a `BlockingCollection` queue plus one pump thread, t4), and a library method that awaits a 100 ms delay (✅[^lab]):
```csharp
static async Task<int> LibraryAsync(bool continueOnCapturedContext)
{
    await Task.Delay(100).ConfigureAwait(continueOnCapturedContext);
    return 42;
}
// on the context thread t4:
LibraryAsync(true).Wait(TimeSpan.FromSeconds(2))    // false after 2008 ms: deadlocked until the timeout
LibraryAsync(false).Wait(TimeSpan.FromSeconds(2))   // true after 110 ms: nothing was posted to t4
```

## How it works
Four actors decide where the code after an `await` runs:
- **`SynchronizationContext`** — its job: say where queued work must run, via its `Post` method.
- **`TaskScheduler`** — its job: run tasks, via its queue; `TaskScheduler.Default` is the thread pool.
- **Task awaiter (`TaskAwaiter`, `ConfiguredTaskAwaitable`)** — its job: capture the context or scheduler at suspension, via `SynchronizationContext.Current` and `TaskScheduler.Current`, and later hand the continuation to it, via `Post` or a queued task.
- **Async method builder** — its job: capture and restore the ambient `ExecutionContext`, via its internal `Start` and continuation code.

```
await task (incomplete)
  │
  ├─ awaiter: continueOnCapturedContext?
  │     ├─ false ───────────────────────────────▶ continuation runs where the task completes (pool thread)
  │     └─ true:  SynchronizationContext.Current != null ? ── yes ─▶ ctx.Post(continuation) ─▶ ctx's own thread(s)
  │                                     │ no
  │                                     └─ TaskScheduler.Current != Default ? ── yes ─▶ queued to that scheduler
  │                                                         └ no ──────────────────▶ pool thread
  └─ builder: ExecutionContext captured now, restored around the continuation (always, either branch)
```

1. **`SynchronizationContext` (the target):** it represents an environment where work must run; Windows Forms and WPF (Windows Presentation Foundation) override `Post` to marshal onto their UI thread ✅[^ec-sc]. The base class itself is free-threaded, with no synchronization ✅[^api-sc]. Console apps install none, so continuations run on the thread pool, and async `Main` or top-level `await` does not add one ✅[^console-ctx]. ASP.NET Core has none either, unlike classic ASP.NET on .NET Framework ✅[^blog-faq]; inside a lab endpoint, `SynchronizationContext.Current` was `null` and `TaskScheduler.Current` was `Default` ✅[^lab].
2. **`TaskScheduler` (the fallback target):** `TaskScheduler.Current` is the scheduler of the task now running, and `Default` outside any task ✅[^api-ts]; the default scheduler runs work on the thread pool ✅[^api-ts].
3. **Awaiter, at suspension:** awaiting a `Task` checks `SynchronizationContext.Current`; when there is one, the continuation is posted back to it instead of running on the completing thread ✅[^ec-sc]. When there is none, a non-default `TaskScheduler.Current` is captured instead ✅[^blog-faq]; in the lab, code started on a `ConcurrentExclusiveSchedulerPair.ExclusiveScheduler` was still on that scheduler after a plain `await` ✅[^lab]. Only the `Task` and `Task<T>` awaiters do this; a custom awaiter decides for itself ✅[^ec-sc].
4. **Awaiter, at resumption:** in the lab context, code after a plain `await Task.Delay(50)` came back to thread 4 with `Current=SingleThreadContext` ✅[^lab].
5. **`ConfigureAwait(false)`:** the awaiter then ignores the context, and the continuation runs wherever the task completes, typically on a pool thread ✅[^ec-sc]. In the lab it resumed on thread 8 with `Current=null`, and it also left the custom `TaskScheduler` (`Current==Default` was `True`) ✅[^lab]. It only acts when the method really suspends: awaiting an already completed task continues synchronously in the same context ✅[^blog-faq], and in the lab the code after `await Task.CompletedTask.ConfigureAwait(false)` was still on thread 4 under the custom context ✅[^lab].
6. **`ConfigureAwaitOptions` (.NET 8 and later):** `None`, `ContinueOnCapturedContext` (the default behaviour of a plain `await`), `SuppressThrowing` (do not throw when the task is faulted or canceled) and `ForceYielding` (yield even when the task is already complete) ✅[^api-cao]. In the lab, `SuppressThrowing` let a faulted `Task` be awaited with no exception, and `ForceYielding` on `Task.CompletedTask` returned an incomplete task to the caller ✅[^lab].
7. **The sync-over-async deadlock:** a thread with a single-threaded context calls an async method and blocks on its task; the method awaits an incomplete task without `ConfigureAwait(false)`; at completion the continuation is posted to the context; that context's only thread is blocked waiting for the task ✅[^sync-wrappers]. `.Wait()`, `.Result` and `GetAwaiter().GetResult()` all block, so all can deadlock there ✅[^async-bugs]. The fixes, in order of preference: do not block (await instead), use `ConfigureAwait(false)` in the library, or offload the call with `Task.Run(...)` so it starts on a pool thread with no context ✅[^sync-wrappers]. All three ran in the lab: the blocked call timed out after 2 s, the `ConfigureAwait(false)` call finished in about 110 ms, the `Task.Run` call in about 107 ms ✅[^lab].
8. **Blocking without a context:** with no context there is no deadlock, but each blocked call holds a pool thread, and many blocked callers can starve the pool ✅[^sync-wrappers]. ASP.NET Core's guidance is not to call `Task.Wait` or `Task<T>.Result` at all, for this reason ✅[^aspnet-bp]. In the lab endpoint, `.Result` on a 100 ms task returned `7` without deadlocking ✅[^lab].
9. **Library versus application code:** library authors should use `ConfigureAwait(false)` on every `await` unless the code must resume on the captured context ✅[^ec-sc]; application code that touches UI state wants the default ✅[^blog-faq]. Analyzer rule CA2007 ("Do not directly await a Task") flags awaits without `ConfigureAwait`, and it is not enabled by default in .NET 10 ✅[^ca2007].
10. **Builder and `ExecutionContext`:** `ExecutionContext` holds ambient state that follows the logical flow of the program; `Task.Run`, `ThreadPool.QueueUserWorkItem` and the async method builders capture it and restore it around the callback ✅[^ec-sc]. `AsyncLocal<T>` stores its value there ✅[^api-asynclocal]. `SynchronizationContext.Current` is deliberately kept out of that flow, so `Task.Run` code never inherits a UI context ✅[^ec-sc]. Methods whose names start with `Unsafe` do the same work without capturing `ExecutionContext` ✅[^blog-async]. The builder's `Start` restores the caller's context when the method first returns, so changes made inside an async method do not leak out to its caller ✅[^blog-async]. Lab results (✅[^lab]):

| Step | `AsyncLocal<string>` | `ThreadLocal<string>` |
|---|---|---|
| Set to `req-1` on thread 1 | `req-1` | `req-1` |
| After `await Task.Delay(20)`, now on thread 5 | `req-1` | `null` |
| Inside `Task.Run` | `req-1` | — |
| Caller, after a child method set it to `changed-in-child` and awaited | `req-1` | — |
| `ThreadPool.UnsafeQueueUserWorkItem`, `Thread.UnsafeStart` | `null` | — |
| `new Thread(...).Start()` | `req-1` | — |
| `Task.Run` created under `ExecutionContext.SuppressFlow()` | `null` | — |

## Worked example
The deadlock from the Artifact, step by step on the lab's single-threaded context (pump thread t4), with the times one run printed (✅[^lab]):

| Time | Thread | Who | What happens |
|---|---|---|---|
| 0 ms | t4 | caller | Calls `LibraryAsync(true)` |
| 0 ms | t4 | awaiter | `Task.Delay(100)` is incomplete; `SynchronizationContext.Current` is `SingleThreadContext`, so it is captured (How it works 3) |
| 0 ms | t4 | caller | Receives a task in `WaitingForActivation`, calls `.Wait(TimeSpan.FromSeconds(2))`: t4 now blocks |
| ~100 ms | timer thread | awaiter | The delay completes; the continuation goes to `ctx.Post`, which puts it in t4's queue (posts counter = 1) |
| 100–2008 ms | t4 | — | Nothing moves: the only thread allowed to run the continuation is the one waiting for it (How it works 7) |
| 2008 ms | t4 | caller | `.Wait` gives up and returns `false`; the task is still `WaitingForActivation` |
| ~2010 ms | t4 | context pump | t4 is free, takes the queued continuation, `return 42` runs; 50 ms later the task is `RanToCompletion` with result 42 |
| next run | t4 | caller | `LibraryAsync(false).Wait(2 s)` returns `true` after 110 ms with the posts counter at 0: the continuation ran on a pool thread |

Without the 2-second timeout, the first call would never return. A real UI thread behaves the same way, because its context also has exactly one thread.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `ConfigureAwait(false)` only on the first `await` | The rest of the method still runs in the context when that first task was already complete ✅[^blog-faq] ✅[^lab] | No suspension, so nothing is rescheduled (How it works 5) |
| `ConfigureAwaitOptions.SuppressThrowing` on a `Task<int>` | Warning CA2261 at build time; `ArgumentOutOfRangeException` at run time in the lab ✅[^lab] | The option is supported only on the non-generic `Task`, since a suppressed failure would leave no valid result ✅[^ca2261] |
| Code runs on a custom `TaskScheduler` with no `SynchronizationContext` | A plain `await` still returns to that scheduler ✅[^lab] | The awaiter falls back to `TaskScheduler.Current` ✅[^blog-faq]; setting the context to `null` does not change that ✅[^blog-faq] |
| A static constructor waits for a task that uses the same type | In the lab, `Wait(1 s)` inside the constructor returned `false`; without the timeout it would hang ✅[^lab] | The runtime holds a lock while a static constructor runs, so the task's call into the type blocks ✅[^async-bugs] |
| `Task.Run` under `SuppressFlow`, then `.Wait()` at once | The task still saw `req-1` in the lab: `Wait` ran it inline on the waiting thread, which had the value ✅[^lab] | A waited task may run synchronously on the waiting thread when it is in that thread's local queue ✅[^api-ts] |
| `async void` method under a custom context | The context is told when it starts and completes, through `OperationStarted`/`OperationCompleted` ✅[^console-ctx] | `void` async methods report to the context, not to a task ✅[^spec-async] |
| Blocking in ASP.NET Core | Works (no deadlock), but holds a pool thread for the whole wait ✅[^lab] | No context to post to; many such calls lead to thread-pool starvation ✅[^aspnet-bp] |
| ASP.NET Core code called by something that installs its own context | The `await` sees that context again ✅[^blog-faq] | "No context" is the host's default, not a guarantee for library code |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `await` all the way up | No blocking, no deadlock, no starvation ✅[^sync-wrappers] | Every caller becomes async |
| `ConfigureAwait(false)` on every library `await` | Safe for callers that block; fewer thread hops ✅[^sync-wrappers] | Noise on every line; wrong for code that touches UI state ✅[^blog-faq] |
| `Task.Run(() => FooAsync()).GetAwaiter().GetResult()` | Unblocks a caller that must stay synchronous and cannot change `FooAsync` ✅[^sync-wrappers] | Holds two threads for the duration; still blocks |
| A custom single-threaded context | All continuations on one thread, so no locks for shared state ✅[^console-ctx] | Any blocking call on that thread deadlocks (Worked example) |

## Takeaways
- Never block on a task (`.Wait()`, `.Result`, `.GetAwaiter().GetResult()`) on a UI thread or any thread that owns a single-threaded context. [rule-candidate]
- In general-purpose library code, write `ConfigureAwait(false)` on every `await`, not only the first. [rule-candidate]
- Store per-operation ambient data in `AsyncLocal<T>`, never in `ThreadLocal<T>` or `[ThreadStatic]`, when the code awaits. [rule-candidate]
- Use `ConfigureAwaitOptions.SuppressThrowing` only on non-generic `Task`.
- Do not wait for tasks inside a static constructor.

## Verification status
- Verified: 57 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [ExecutionContext and SynchronizationContext](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/executioncontext-synchronizationcontext) — Microsoft, living. Rank 1. Backs: what each context is for; task awaiters capture and post to the context; `ConfigureAwait(false)` skips it; builders always flow `ExecutionContext`; `SynchronizationContext.Current` does not flow; library guidance. [^ec-sc]
- [SynchronizationContext and console apps](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/synchronizationcontext-console-apps) — Microsoft, living. Rank 1. Backs: console apps and async `Main` install no context; a single-threaded pump; `async void` and `OperationStarted`/`OperationCompleted`. [^console-ctx]
- [Synchronous wrappers for asynchronous methods](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/synchronous-wrappers-for-asynchronous-methods) — Microsoft, living. Rank 1. Backs: the deadlock sequence; pool starvation from blocked wrappers; `ConfigureAwait(false)` and `Task.Run` mitigations. [^sync-wrappers]
- [Common async/await bugs](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/common-async-bugs) — Microsoft, living. Rank 1. Backs: all three blocking APIs deadlock under a single-threaded context; static constructor deadlocks. [^async-bugs]
- [Async functions (C# standard, §15.14)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes#1514-async-functions) — ECMA / Microsoft, living. Rank 1. Backs: `void` async functions report to the synchronization context. [^spec-async]
- [SynchronizationContext class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.synchronizationcontext) — Microsoft, living. Rank 1. Backs: the base class is a free-threaded context with no synchronization. [^api-sc]
- [TaskScheduler class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskscheduler) — Microsoft, living. Rank 1. Backs: `Current` returns `Default` outside a task; the default scheduler uses the thread pool; task inlining on the waiting thread. [^api-ts]
- [ConfigureAwaitOptions enum](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.configureawaitoptions) — Microsoft, living. Rank 1. Backs: the four options and their meaning; available from .NET 8. [^api-cao]
- [AsyncLocal\<T\> class](https://learn.microsoft.com/en-us/dotnet/api/system.threading.asynclocal-1) — Microsoft, living. Rank 1. Backs: ambient data local to an asynchronous control flow. [^api-asynclocal]
- [CA2261: Do not use ConfigureAwaitOptions.SuppressThrowing with Task\<TResult\>](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2261) — Microsoft, living. Rank 1. Backs: `SuppressThrowing` is unsupported on `Task<TResult>`. [^ca2261]
- [CA2007: Do not directly await a Task](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2007) — Microsoft, living. Rank 1. Backs: the rule and that it is off by default in .NET 10. [^ca2007]
- [ASP.NET Core best practices](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices) — Microsoft, living. Rank 1. Backs: do not block with `Task.Wait` or `Task<T>.Result`; blocking leads to thread-pool starvation. [^aspnet-bp]
- [ConfigureAwait FAQ](https://devblogs.microsoft.com/dotnet/configureawait-faq/) — Stephen Toub, .NET Blog, 2019. Rank 4. Backs: `TaskScheduler.Current` fallback; library versus app guidance; no guarantee when the task is already complete; ASP.NET Core has no context but one can still appear. [^blog-faq]
- [How async/await really works in C#](https://devblogs.microsoft.com/dotnet/how-async-await-really-works/) — Stephen Toub, .NET Blog, 2023. Rank 4. Backs: `Unsafe*` methods skip `ExecutionContext` capture; `Start` restores the caller's context so changes do not leak out. [^blog-async]

## Related
- `dotnet/async/tasks-and-async-await.md` — the state machine, awaiters and exceptions.
- `dotnet/async/cancellation-valuetask-and-async-streams.md` — `ConfigureAwait` on async streams.
- `dotnet/concurrency/threads-and-the-thread-pool.md` — thread-pool starvation measured over time.
- `dotnet/app-model/aspnet-core-pipeline.md` — the request pipeline that runs without a context.
- `concurrency/blocking-in-async-runtimes.md` — the same blocking problem in other runtimes.
