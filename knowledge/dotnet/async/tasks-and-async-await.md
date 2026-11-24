---
schema: knowledge-doc/v1
type: concept
topic: dotnet/async
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, async, await, task, state-machine, awaiter, exceptions, aggregateexception, async-void, whenall, wheneach, taskcompletionsource]
ranked-sources: true
---

# Tasks and async/await

## Summary
**TL;DR:** A `Task` is an object that stands for work that finishes later, with a result, an exception or a cancellation. The `async` keyword makes the compiler rewrite a method into a state machine; each `await` asks the awaited object whether it is done, and if not, hands it "the rest of the method" and returns to the caller without blocking a thread. Exceptions are stored in the task: `await` rethrows one of them, `.Wait()` and `.Result` wrap all of them in `AggregateException`, and an exception that escapes an `async void` method ends the process.
**Use this when:** an async method runs synchronously when you expected it not to, an exception "disappears" or arrives as `AggregateException`, a process dies with an unhandled exception from a thread-pool thread, or you need to choose between `Task.Run`, `WhenAll`, `WhenAny`, `WhenEach` and `TaskCompletionSource`.
**Not this doc:** on which thread a continuation runs, `ConfigureAwait` and the sync-over-async deadlock → `dotnet/async/synchronization-context-and-configureawait.md`; cancellation, `ValueTask` and `IAsyncEnumerable<T>` → `dotnet/async/cancellation-valuetask-and-async-streams.md`; the thread pool itself → `dotnet/concurrency/threads-and-the-thread-pool.md`.

## Problem
Async code reads like ordinary sequential code, so its real execution model surprises people:
- An `async` method with no real waiting runs entirely on the caller's thread and returns an already finished task.
- `Task.WhenAll` over two failing calls, then `await`, shows only one of the two exceptions.
- The same failure arrives as `InvalidOperationException` through `await` but as `AggregateException` through `.Result`.
- A `try`/`catch` around a call to an `async void` method catches nothing, and the process exits (with code 134 on macOS).
- Work started with `_ = Task.Run(...)` silently never finishes because `Main` returned first.

## Mental model
**Analogy:** a restaurant pager. Ordering (calling the async method) hands you a pager (the `Task`) at once, and you go back to your table (the method returns to its caller). Nobody stands at the counter waiting for your food: the kitchen buzzes the pager when it is done (the continuation runs). If the kitchen drops the dish, the pager shows an error, and you find out only when you look at it (`await`). An `async void` method is an order with no pager: if the kitchen fails, the only signal left is the fire alarm, and the whole restaurant is evacuated (the process ends).

**Artifact:** the compiler turns `AddAsync` into a hidden type; reflection shows it in the lab, once in a Debug build and once in a Release build (✅[^lab]):
```csharp
public static async Task<int> AddAsync(int a, int b)
{
    int sum = a + b;            // lives across the await, so it becomes a field
    await Task.Delay(10);
    return sum;
}
// state machine: <AddAsync>d__0  IsValueType=False    (dotnet run, Debug)
// state machine: <AddAsync>d__0  IsValueType=True     (dotnet run -c Release)
// interfaces: IAsyncStateMachine
//   field Int32                        <>1__state      where to resume
//   field AsyncTaskMethodBuilder`1     <>t__builder    makes and completes the Task<int>
//   field Int32                        a, b            parameters
//   field Int32                        <sum>5__2       the local that survives the await
//   field TaskAwaiter                  <>u__1          the pending awaiter
```

## How it works
Four actors take part in one `await`:
- **Compiler (Roslyn, the C# compiler)** — its job: rewrite the async method into a state-machine type, via a generated `IAsyncStateMachine` implementation.
- **Builder (`AsyncTaskMethodBuilder<T>`)** — its job: create the returned task and later complete it, via `Task`, `SetResult` and `SetException`, and hook up continuations, via `AwaitUnsafeOnCompleted`.
- **Awaiter (`TaskAwaiter`, or any type a `GetAwaiter()` method returns)** — its job: say whether the operation is done, via `IsCompleted`, store the continuation, via `OnCompleted`/`UnsafeOnCompleted`, and hand over the outcome, via `GetResult`.
- **Scheduler (the thread pool, or a captured context)** — its job: run the continuation later, via a queued work item.

```
caller thread                        awaited operation            thread pool
-------------                        -----------------            -----------
AddAsync(2, 3)
 └ builder.Start → MoveNext()
     sum = 5
     a = Task.Delay(10).GetAwaiter()
     a.IsCompleted? ──no──▶ builder.AwaitUnsafeOnCompleted
                              └ a.UnsafeOnCompleted(MoveNext) ─▶ stores continuation
 ◀── returns builder.Task (WaitingForActivation)
caller continues                     ... 10 ms later: timer fires
                                       └ queues continuation ───▶ MoveNext()
                                                                   a.GetResult()
                                                                   builder.SetResult(5)
                                                                   task → RanToCompletion
```

1. **Compiler (build time):** the method body becomes a `MoveNext` method on a generated type that implements `IAsyncStateMachine`, an interface meant for compiler use only ✅[^api-iasm]. Parameters and locals that live across an `await` become fields ✅[^lab]. The type is a struct in Release builds and a class in Debug builds, which helps debugging ✅[^blog-async] ✅[^lab]. A struct state machine that completes without suspending never leaves the stack, so it costs no allocation ✅[^blog-async].
2. **Builder (call time, caller's thread):** the call creates the builder, and `Start` runs `MoveNext` on the caller's thread until the body suspends or ends; then the caller receives the builder's task ✅[^spec-async]. An async method therefore runs synchronously until it reaches an `await` on an incomplete awaitable ✅[^async-bugs]. In the lab, `Work(false)` (awaiting `Task.CompletedTask`) ran both halves on thread 1 and returned a task with `IsCompleted=True`; `Work(true)` (awaiting `Task.Yield()`) returned `IsCompleted=False` and finished on thread 4 ✅[^lab].
3. **Awaiter (each `await`):** `await t` evaluates `t.GetAwaiter()`, then `IsCompleted`. If it is `true`, `GetResult()` runs at once with no suspension ✅[^spec-await]. If it is `false`, the state machine registers itself through `UnsafeOnCompleted` when the awaiter implements `ICriticalNotifyCompletion`, otherwise through `OnCompleted`, and returns to its caller ✅[^spec-await]. The choice is made at compile time from the awaiter's static type ✅[^spec-await]. A hand-written awaiter in the lab logged exactly `GetAwaiter()`, `IsCompleted -> False`, `UnsafeOnCompleted(continuation)`, and only after the source completed, `GetResult() -> 42` ✅[^lab]. Any type with a suitable `GetAwaiter` can be awaited, not only `Task` ✅[^await-op].
4. **Scheduler (resumption):** when the operation completes, it invokes the stored continuation, which calls `MoveNext` again; that calls `GetResult()`, which returns the value or throws the stored exception ✅[^spec-await]. In a console app the continuation of `Task.Delay` ran on a thread-pool thread (thread 1 before, thread 4 or 5 after) ✅[^lab]. Which thread or context is chosen is the subject of `dotnet/async/synchronization-context-and-configureawait.md`.
5. **Builder (completion):** reaching `return` puts the task in the succeeded state; an uncaught `OperationCanceledException` puts it in the canceled state; any other uncaught exception puts it in the faulted state ✅[^spec-async].

The rules around that core:

6. **Tasks are "hot".** Tasks returned by TAP (Task-based Asynchronous Pattern) methods are already running, and calling `Start()` on one throws `InvalidOperationException`; only `new Task(...)` creates a "cold" task in the `Created` state ✅[^tap] ✅[^lab].
7. **Waiting does not hold a thread.** `async` and `await` create no threads, and a waiting method uses no thread time ✅[^tap-model]. In the lab, 10,000 concurrent `Task.Delay(500)` calls finished in about 527 ms while the thread pool never grew beyond 4 threads ✅[^lab]. `Task.Run` queues work to the thread pool ✅[^api-run]; use it for CPU-bound (CPU: central processing unit; processor-heavy) work and plain `await` for I/O-bound (input/output: network, disk, timers) work ✅[^async-scenarios]. A `Task.Run` wrapper around blocking code only moves the blocking to another thread, so it does not help scalability ✅[^async-wrappers].
8. **Exceptions.** `await t` rethrows the task's exception ✅[^await-op]. `.Wait()` and `.Result` wrap it in `AggregateException`, while `GetAwaiter().GetResult()` throws the original type; a task with several failures stores all of them in `Task.Exception`, but `await` and `GetResult()` surface one ✅[^task-exc] ✅[^lab].
9. **Combinators.** `Task.WhenAll` faults with the exceptions of every faulted input, and is canceled if none faulted but one was canceled ✅[^api-whenall]; its `Task<T[]>` result keeps the argument order ✅[^lab]. `Task.WhenAny` returns the first task to finish, and its own task always succeeds, even when that first task faulted ✅[^api-whenany] ✅[^lab]. `Task.WhenEach` (.NET 9) yields tasks in the order they complete, for use with `await foreach` ✅[^when-each] ✅[^lab].
10. **`async void`.** A `void`-returning async method has no task, so it reports completion and exceptions to the current `SynchronizationContext` ✅[^spec-async], and its caller cannot catch its exceptions ✅[^async-kw]. A console app has no such context: in the lab the exception was rethrown on a thread-pool thread, `AppDomain.UnhandledException` reported `IsTerminating=True`, and the process exited with code 134, both when the throw came after an `await` and before the first one ✅[^lab]. Keep `async void` for event handlers ✅[^async-bugs].
11. **Unobserved exceptions.** When a faulted task is finalized before anyone observed its exception, the runtime raises `TaskScheduler.UnobservedTaskException` and, in modern .NET, keeps running ✅[^task-exc]. In the lab the event fired only after `GC.Collect()` and `WaitForPendingFinalizers()`, and the process exited with code 0 ✅[^lab].
12. **`TaskCompletionSource<T>`** is the producer side of a task that no delegate backs: code completes it explicitly ✅[^api-tcs]. By default the awaiting continuation ran inside `SetResult`, on the producer's thread, before `SetResult` returned; with `TaskCreationOptions.RunContinuationsAsynchronously`, which forces continuations to run asynchronously ✅[^api-tco], `SetResult` returned first ✅[^lab]. `SetResult` on a completed source throws, so racing paths use `TrySetResult` ✅[^complete-tasks]; in the lab `TrySetResult` returned `False` and `SetResult` threw `InvalidOperationException` ✅[^lab].

## Worked example
Three price lookups started together, one of which fails; every value is from one lab run (✅[^lab]):

```csharp
var tasks = new[] { PriceAsync("apple", 120, false), PriceAsync("kiwi", 50, true), PriceAsync("banana", 80, false) };
var all = Task.WhenAll(tasks);
try { decimal[] prices = await all; }
catch (HttpRequestException e) { /* e is the first failure; all.Exception holds every failure */ }
```

| Time | Thread | Event | Rule |
|---|---|---|---|
| 14 ms | 1 | The three calls return; each task is `WaitingForActivation` | Each method ran to its first `await Task.Delay` and returned a hot task (How it works 2, 6) |
| 14 ms | 1 | `await all` finds `IsCompleted=false`, registers a continuation, `Main` suspends | No thread waits for the timers (How it works 3, 7) |
| 56 ms | 5 | `kiwi` throws `HttpRequestException("kiwi: 503")`; its task becomes Faulted | The builder stores the exception (How it works 5) |
| 87 ms | 5 | `banana` completes | `WhenAll` keeps waiting for the rest |
| 124 ms | 5 | `apple` completes; `all` becomes Faulted | It faults because one input faulted (How it works 9) |
| 128 ms | 5 | `await all` throws `HttpRequestException: kiwi: 503`; `all.Exception` has 1 inner exception | `await` rethrows the stored exception (How it works 8) |
| 130 ms | 5 | Sum over `tasks.Where(t => t.IsCompletedSuccessfully)` = 110 | The successful results are still readable |

Starting first and awaiting later is what makes the calls overlap: in the lab, three 200 ms awaits written one after another took about 603 ms, and the same three started first, then joined with `WhenAll`, took about 201 ms ✅[^lab].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Two inputs of `WhenAll` fail | `await` rethrows one; `all.Exception.InnerExceptions` has both. In the lab their order depended on the overload: the order in which they failed for the non-generic `WhenAll(Task[])` and `WhenAll(IEnumerable<Task>)`, the argument order for the generic `WhenAll(Task<T>[])` and `WhenAll(IEnumerable<Task<T>>)`, and `await` rethrew the first one in that list ✅[^lab] | The docs promise the aggregation, not an order ✅[^api-whenall]; inspect `Task.Exception` when every failure matters |
| An `async` method throws before its first `await` | The call returns normally and the task is already `Faulted` ✅[^lab] | The builder catches everything thrown by `MoveNext` (How it works 5); a non-async `Task`-returning method that throws does so at the call site ✅[^lab] |
| `async` method with no `await` | Runs synchronously ✅[^async-kw]. The docs list warning CS1998 for it ✅[^cs-msgs], but Roslyn 5.9.0, the C# compiler in the .NET SDK (software development kit) 10.0.401, reported no warning ✅[^lab] | The Roslyn team decided to remove CS1998 ✅[^roslyn-1998] |
| Task-returning call without `await` inside an async method | Warning CS4014 ✅[^cs-msgs] ✅[^lab]; `_ = Call()` silences it but still does not wait ✅[^async-bugs] | The call starts the work and moves on |
| `Task.Factory.StartNew(async () => ...)` | Returns `Task<Task>`; awaiting it finished after about 9 ms while the inner 300 ms work was still running ✅[^lab] | The outer task ends at the lambda's first yielding `await`; `Task.Run` unwraps, and so does `.Unwrap()` ✅[^async-bugs] ✅[^lab] |
| Fire-and-forget work when `Main` returns | In the lab, work started with `_ = Task.Run(...)` never printed its last line: `Main` returned at about 50 ms, before its 300 ms delay ended ✅[^lab] | Thread-pool threads are background threads (`IsBackground=True` in the lab ✅[^lab]); dropped tasks lose completion, failures and shutdown coordination ✅[^keep-alive] |
| Awaiting a canceled task | `await` throws `TaskCanceledException`; `.Wait()` throws `AggregateException` wrapping it ✅[^lab] | Awaiting code receives an `OperationCanceledException` or a derived type ✅[^tap] |
| A blocking call (`.Result`, `.Wait()`) on a UI (user interface) thread | Can deadlock | See `dotnet/async/synchronization-context-and-configureawait.md` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `await` | No blocked thread; original exception type ✅[^task-exc] | The caller must be async too |
| `.GetAwaiter().GetResult()` | Original exception type when you must block ✅[^task-exc] | Blocks a thread; can deadlock under a single-threaded context ✅[^task-exc] |
| `.Result` / `.Wait()` | Fits code that expects `AggregateException` ✅[^task-exc] | Blocks; exceptions arrive wrapped |
| `Task.Run(cpuWork)` | Moves CPU-bound work off a UI thread ✅[^async-scenarios] | No scalability gain for blocking I/O ✅[^async-wrappers] |
| `TaskCompletionSource` default | Continuations run immediately, with no extra queueing ✅[^lab] | The producer runs the consumer's code inside `SetResult` ✅[^lab] |
| `RunContinuationsAsynchronously` | The producer is never hijacked by continuations ✅[^api-tco] | One more trip through the thread pool |

## Takeaways
- Return `Task` or `Task<T>` from async methods; use `async void` only for event handlers. [rule-candidate]
- Await every task you start, or hand it to an owner that observes its failures and waits for it at shutdown. [rule-candidate]
- Start independent operations first and then `await Task.WhenAll(...)`; read `Task.Exception` when every failure matters, because `await` shows only one.
- Create a `TaskCompletionSource` with `TaskCreationOptions.RunContinuationsAsynchronously` unless you have measured a reason not to, and complete it with `TrySet*` on every path. [rule-candidate]
- Use `Task.Run` for CPU-bound work, never as a wrapper that makes blocking I/O "async".

## Verification status
- Verified: 74 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Await expressions (C# standard, §12.9.9)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions#1299-await-expressions) — ECMA / Microsoft, living. Rank 1. Backs: `GetAwaiter`, `IsCompleted`, `OnCompleted` versus `UnsafeOnCompleted` chosen at binding time, `GetResult` after resumption. [^spec-await]
- [Async functions (C# standard, §15.14)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes#1514-async-functions) — ECMA / Microsoft, living. Rank 1. Backs: builder `Create`/`Start`/`Task`/`SetResult`/`SetException`; succeeded, canceled and faulted states; `void` async functions report to the synchronization context. [^spec-async]
- [await operator](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/await) — Microsoft, living. Rank 1. Backs: any awaitable can be awaited; `await` rethrows the task's exception. [^await-op]
- [async (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/async) — Microsoft, living. Rank 1. Backs: a method without `await` runs synchronously; callers of `async void` cannot catch its exceptions. [^async-kw]
- [Task asynchronous programming model](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/task-asynchronous-programming-model) — Microsoft, living. Rank 1. Backs: `async`/`await` create no threads; waiting uses no thread time. [^tap-model]
- [Asynchronous programming scenarios](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/async-scenarios) — Microsoft, living. Rank 1. Backs: `Task.Run` for CPU-bound work, plain `await` for I/O-bound work. [^async-scenarios]
- [Process asynchronous tasks as they complete](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/start-multiple-async-tasks-and-process-them-as-they-complete) — Microsoft, living. Rank 1. Backs: `Task.WhenEach` (.NET 9) iterates tasks in completion order. [^when-each]
- [Task-based asynchronous pattern (TAP)](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/task-based-asynchronous-pattern-tap) — Microsoft, living. Rank 1. Backs: hot and cold tasks; `Start` on an active task throws; awaiting a canceled task raises `OperationCanceledException` or a derived type. [^tap]
- [Task exception handling](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/task-exception-handling) — Microsoft, living. Rank 1. Backs: `Result`/`Wait` wrap in `AggregateException`; `GetAwaiter().GetResult()` keeps the type; one exception surfaced from several; `UnobservedTaskException` no longer crashes the process. [^task-exc]
- [Common async/await bugs](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/common-async-bugs) — Microsoft, living. Rank 1. Backs: runs synchronously until the first incomplete await; `async void` for event handlers only; `Task<Task>` from `StartNew` and the fixes; storing the task silences CS4014 without fixing it. [^async-bugs]
- [Complete your tasks](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/complete-your-tasks) — Microsoft, living. Rank 1. Backs: `Set*` throws on a completed task; prefer `TrySet*` in races. [^complete-tasks]
- [Keep async methods alive](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/keep-async-methods-alive) — Microsoft, living. Rank 1. Backs: the risks of dropped fire-and-forget tasks. [^keep-alive]
- [Asynchronous wrappers for synchronous methods](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/async-wrappers-for-synchronous-methods) — Microsoft, living. Rank 1. Backs: `Task.Run` wrappers offload but do not scale. [^async-wrappers]
- [Resolve errors and warnings in async methods](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/async-await-errors) — Microsoft, living. Rank 1. Backs: CS1998 and CS4014 texts. [^cs-msgs]
- [IAsyncStateMachine](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.iasyncstatemachine) — Microsoft, living. Rank 1. Backs: the state-machine interface is for compiler use only. [^api-iasm]
- [Task.Run](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.run) — Microsoft, living. Rank 1. Backs: queues work to the thread pool. [^api-run]
- [Task.WhenAll](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.whenall) — Microsoft, living. Rank 1. Backs: faulted with the aggregation of all exceptions; canceled when none faulted and one was canceled. [^api-whenall]
- [Task.WhenAny](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.whenany) — Microsoft, living. Rank 1. Backs: the returned task always succeeds, with the first finished task as its result. [^api-whenany]
- [TaskCompletionSource\<TResult\>](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskcompletionsource-1) — Microsoft, living. Rank 1. Backs: the producer side of a task with no delegate. [^api-tcs]
- [TaskCreationOptions](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskcreationoptions) — Microsoft, living. Rank 1. Backs: `RunContinuationsAsynchronously` forces continuations to run asynchronously. [^api-tco]
- [How async/await really works in C#](https://devblogs.microsoft.com/dotnet/how-async-await-really-works/) — Stephen Toub, .NET Blog, 2023. Rank 4. Backs: the state machine is a struct in Release and a class in Debug; no allocation when the method completes synchronously. [^blog-async]
- [Consider not emitting CS1998 for interface implementations / method overrides](https://github.com/dotnet/roslyn/issues/77001) — dotnet/roslyn issue, 2025. Rank 6. Backs: the decision to remove CS1998, linked from the Roslyn issue that tracks dropping its suppressions with .NET 10. [^roslyn-1998]

## Related
- `dotnet/async/synchronization-context-and-configureawait.md` — where continuations run and how blocking deadlocks.
- `dotnet/async/cancellation-valuetask-and-async-streams.md` — cancellation tokens, `ValueTask` and `await foreach`.
- `dotnet/concurrency/threads-and-the-thread-pool.md` — the threads that run continuations and `Task.Run` work.
- `dotnet/errors-and-resources/exceptions.md` — `AggregateException`, filters and stack traces.
- `concurrency/structured-concurrency.md` — owning and joining concurrent work across languages.
