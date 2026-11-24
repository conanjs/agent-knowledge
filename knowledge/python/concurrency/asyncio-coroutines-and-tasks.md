---
schema: knowledge-doc/v1
type: concept
topic: python/concurrency
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, asyncio, async, await, coroutine, task, taskgroup, gather, cancellation, timeout, to-thread, queue, semaphore, async-generator, event-loop, eager-task-factory]
ranked-sources: true
---

# asyncio coroutines and tasks

## Summary
**TL;DR:** Calling an `async def` function only creates a coroutine object; nothing runs until it is awaited or wrapped in a task, and an event loop started by `asyncio.run()` drives it. All tasks share one thread and take turns only where a task suspends at an `await`, so many waits overlap (three 0.2 s sleeps finish in 0.2 s), while a blocking call freezes everything. Run related tasks in an `asyncio.TaskGroup`, which cancels the siblings when one fails; let `CancelledError` propagate; bound waits with `asyncio.timeout()`; push blocking calls to `asyncio.to_thread()`.
**Use this when:** writing or reviewing `async`/`await` code, choosing between `gather` and `TaskGroup`, a task vanishes or never runs, a timeout does not fire, or an event loop stalls.
**Not this doc:** threads, processes and the GIL (global interpreter lock) → `python/concurrency/threads-processes-and-the-gil.md`; scopes that own their children in any language → `concurrency/structured-concurrency.md`; why blocking stalls any async runtime → `concurrency/blocking-in-async-runtimes.md`; plain generators → `python/iteration-and-functional/iterators-generators-and-itertools.md`; exception groups and `except*` → `python/errors-and-resources/exceptions-and-exception-groups.md`.

## Problem
- `fetch()` written without `await` does nothing and only prints `RuntimeWarning: coroutine 'fetch' was never awaited` ✅[^asyncio-dev].
- A background task started with `create_task()` and not stored anywhere can be garbage-collected before it finishes, because the event loop keeps only weak references to tasks ✅[^asyncio-task].
- One failed request inside `gather()` raises, but the other requests keep running ✅[^asyncio-task].
- A `try: ... except Exception:` around an `await` does not catch a cancellation, and code that catches `CancelledError` and carries on can make `TaskGroup` and `asyncio.timeout()` misbehave ✅[^asyncio-task].
- One `time.sleep()` or CPU-heavy (processor-heavy) call inside a coroutine delays every other task ✅[^asyncio-dev].

## Mental model
**Analogy:** one cook (the thread) and a ticket rail (the event loop). Each dish is a task. The cook works on one dish until it reaches a step like "simmer 10 minutes" (`await asyncio.sleep(...)`, a network read), then pins it back on the rail and picks up the next ready dish. Three dishes that each simmer 10 minutes are all done after about 10 minutes. But if the cook stands and stirs one pot for 10 minutes (`time.sleep`, a long loop), no other dish moves, because the cook only switches at the "pin it back" moments.

**Artifact** (measured in the lab ✅[^lab]):
```python
import asyncio, time

async def fetch(name, delay):
    await asyncio.sleep(delay)
    return f"{name} done"

async def main():
    c = fetch("a", 0)                    # a coroutine object; the body has not run
    print(type(c).__name__, await c)     # coroutine a done
    t = time.perf_counter()
    [await fetch(n, 0.2) for n in "abc"]                        # one after another
    print(f"{time.perf_counter() - t:.3f}")                     # 0.604
    t = time.perf_counter()
    await asyncio.gather(*(fetch(n, 0.2) for n in "abc"))       # all three waiting at once
    print(f"{time.perf_counter() - t:.3f}")                     # 0.203

asyncio.run(main())
```

## How it works
1. **Coroutine function and coroutine object.** A function defined with `async def` is a coroutine function, even without any `await` inside; calling it returns a coroutine object ✅[^datamodel] ✅[^compound]. Calling a coroutine does not schedule it ✅[^asyncio-task]. A coroutine that is created but neither awaited nor scheduled with `create_task()` makes asyncio emit a `RuntimeWarning` ✅[^asyncio-dev]. `await`, `async for` and `async with` are only allowed inside a coroutine function ✅[^compound]. The syntax comes from PEP 492 (PEP = Python Enhancement Proposal) ✅[^pep492].
2. **The event loop and `asyncio.run()`.** `asyncio.run(coro)` creates an event loop, runs the awaitable, finalises asynchronous generators, shuts down the default executor and closes the loop; it cannot be called while another loop runs in the same thread, and it should ideally be called once, as the program's entry point ✅[^asyncio-runner]. Since 3.14 it accepts any awaitable ✅[^asyncio-runner].
3. **One thread, cooperative switching.** The loop runs all tasks and callbacks in its thread; while one task runs, no other task in that thread can, and when a task executes an `await` it is suspended and the loop runs the next task ✅[^asyncio-dev]. `asyncio.sleep()` always suspends the current task, and `sleep(0)` is the optimised way to let others run ✅[^asyncio-task]. In the lab, two tasks appending to a log interleaved (`A0, B0, A1, ...`) only when each step awaited `asyncio.sleep(0)`; awaiting a coroutine that returned without suspending did not switch tasks, so the switch happens only where something really suspends ✅[^lab]. Almost no asyncio object is thread-safe ✅[^asyncio-dev].
4. **Tasks.** `asyncio.create_task(coro)` wraps the coroutine in a `Task`, schedules it on the running loop and returns the task; without a running loop it raises `RuntimeError` ✅[^asyncio-task]. Keep a reference to every task: the loop holds only weak references, so an unreferenced task may be garbage-collected mid-execution; the docs' pattern for fire-and-forget tasks is a set plus `add_done_callback(set.discard)` ✅[^asyncio-task]. Coroutines, tasks and futures are the three kinds of awaitables ✅[^asyncio-task].
5. **`gather` versus `TaskGroup`.**
   - `gather(*aws)` runs awaitables concurrently and returns their results in order. With `return_exceptions=False` the first exception propagates at once and the others keep running; with `True` exceptions are returned in the result list ✅[^asyncio-task].
   - `TaskGroup` (3.11) is an asynchronous context manager: tasks added with `tg.create_task()` are all awaited when the block exits ✅[^asyncio-task]. When one task fails with anything but `CancelledError`, the rest are cancelled and the failures are raised together as an `ExceptionGroup` ✅[^asyncio-task]. 3.15 adds `tg.cancel()` for an early, non-error exit ✅[^whatsnew315].
   - The 3.11 notes recommend `TaskGroup` for new code over calling `create_task()` and `gather()` directly ✅[^whatsnew311]. The general idea, a scope that owns and waits for its children, is in `concurrency/structured-concurrency.md`.
6. **Cancellation.** `task.cancel()` makes `asyncio.CancelledError` raise inside the task at its next opportunity ✅[^asyncio-task]. `CancelledError` subclasses `BaseException` directly, so `except Exception` does not catch it; clean up in `try`/`finally`, and if you catch `CancelledError`, re-raise it when the clean-up is done ✅[^asyncio-task]. `TaskGroup` and `asyncio.timeout()` are built on cancellation and can misbehave when a coroutine swallows it ✅[^asyncio-task].
7. **Timeouts.** `async with asyncio.timeout(delay):` (3.11) cancels the current task when the delay expires and turns the resulting `CancelledError` into `TimeoutError`, which can only be caught outside the block ✅[^asyncio-task]. `await asyncio.wait_for(aw, timeout)` cancels `aw` and raises `TimeoutError` on expiry; it waits until `aw` is really cancelled, so the total wait can exceed the timeout ✅[^asyncio-task]. Since 3.11 both raise the built-in `TimeoutError`, and since 3.12 `wait_for` is implemented with `asyncio.timeout()` ✅[^asyncio-task]; in the lab `asyncio.TimeoutError is TimeoutError` is `True` ✅[^lab].
8. **Blocking code.** A CPU-bound or blocking call made directly in a coroutine delays every task and I/O (input/output) operation by its duration ✅[^asyncio-dev]. `await asyncio.to_thread(func, *args)` (3.9) runs `func` in a separate thread and propagates the current context variables ✅[^asyncio-task]; because of the GIL it typically helps only I/O-bound functions ✅[^asyncio-task]. `loop.run_in_executor()` can use a thread, interpreter or process pool instead ✅[^asyncio-dev]. The cross-runtime picture is in `concurrency/blocking-in-async-runtimes.md`.
9. **`Queue` and `Semaphore`.** `asyncio.Queue` is a first-in, first-out queue: `await put()` blocks when `maxsize` is reached, and `join()` unblocks once `task_done()` has been called for every item ✅[^asyncio-queue]. `asyncio.Semaphore(value)` keeps a counter that `acquire()` decrements and `release()` increments; at zero, `acquire()` waits; use it with `async with` ✅[^asyncio-sync]. Both, like `asyncio.Lock`, are not thread-safe ✅[^asyncio-sync] ✅[^asyncio-queue].
10. **Asynchronous iteration and context managers.** An asynchronous iterator has `__aiter__()` and `__anext__()`, and `__anext__()` returns an awaitable; `async for` awaits each one until `StopAsyncIteration` ✅[^glossary]. An `async def` function that contains `yield` is an asynchronous generator function (PEP 525) whose result is used with `async for` ✅[^datamodel] ✅[^pep525]. `async with` awaits the manager's `__aenter__()` and `__aexit__()` ✅[^compound].
11. **Debug mode.** Turn it on with `PYTHONASYNCIODEBUG=1`, the Python Development Mode, `asyncio.run(..., debug=True)` or `loop.set_debug()`; it then raises when non-thread-safe APIs (application programming interfaces) are called from the wrong thread, and logs callbacks that run longer than 100 ms ✅[^asyncio-dev]. In debug mode the never-awaited warning also shows where the coroutine was created ✅[^asyncio-dev].
12. **Introspection (3.14).** `python -m asyncio ps PID` (PID = process ID) prints a table of another process's pending tasks and `pstree PID` the same as an await tree; they read the process without running code in it and may need permission to inspect it ✅[^asyncio-tools]. macOS disallows debugging other processes by default; root, or (for a non-framework build) an ad-hoc code signature with the `get-task-allow` entitlement on the Python binary, lifts that ✅[^remote-debugging]. Inside the program, `asyncio.print_call_graph()`, `format_call_graph()` and `capture_call_graph()` show the current task's call stack and who awaits it ✅[^asyncio-graph].
13. **Eager task factory (3.12).** After `loop.set_task_factory(asyncio.eager_task_factory)`, a coroutine starts running inside `create_task()` and is only scheduled on the loop if it blocks; this is a semantic change that may alter an application's behaviour, for example its task execution order ✅[^asyncio-task]. The 3.12 notes report 2x to 5x speed-ups for some uses ✅[^whatsnew312]. Since 3.14 `create_task()` also takes `eager_start=` per task ✅[^asyncio-task].

## Worked example
One script, every line measured in the lab ✅[^lab]:

| Step | Code | Result |
|---|---|---|
| 1 | `[await fetch(n, 0.2) for n in "abc"]` | 0.604 s: each `await` finishes before the next starts |
| 2 | `await asyncio.gather(*(fetch(n, 0.2) for n in "abc"))` | 0.203 s, `['a done', 'b done', 'c done']` |
| 3 | `async with asyncio.TaskGroup() as tg:` plus three `tg.create_task(fetch(n, 0.2))` | 0.202 s, same results via `task.result()` |
| 4 | `gather` of three coroutines that each call `time.sleep(0.2)` | 0.612 s: the blocking call never yields |
| 5 | `gather` of three `asyncio.to_thread(time.sleep, 0.2)` | 0.207 s: the sleeps run in worker threads |
| 6 | 6 tasks that each `await asyncio.sleep(0.1)` inside `async with asyncio.Semaphore(2)` | 0.304 s, at most 2 running at once |
| 7 | `gather(fail_after(0.05), slow())`, where `fail_after` raises `ValueError('boom')` and `slow` sleeps 0.3 s | `ValueError: boom` reaches the caller; 0.4 s later `slow` has **finished** |
| 8 | The same two coroutines as tasks in a `TaskGroup` | `ExceptionGroup` holding `ValueError('boom')`; `slow` was **cancelled** |
| 9 | `async with asyncio.timeout(0.1): await asyncio.sleep(1)` | `TimeoutError` after 0.103 s |
| 10 | 4 tasks × 1,000 times: read `state["n"]`, `await asyncio.sleep(0)`, write `n + 1` | 1,000 instead of 4,000; with an `asyncio.Lock` around the three steps: 4,000 |

Steps 2–3 overlap the waits; step 4 shows why a blocking call breaks that ✅[^asyncio-dev]; steps 7–8 are the behaviour the docs describe for `gather` and `TaskGroup` ✅[^asyncio-task]. Step 10 is a race without threads: every task read the same value before any wrote, because the `await` between read and write let the others run. Without that `await` all 4,000 increments survived ✅[^lab].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `test()` instead of `await test()` | Nothing prints; stderr shows `RuntimeWarning: coroutine 'test' was never awaited` ✅[^lab] | Calling a coroutine function only creates the object ✅[^asyncio-dev] |
| `asyncio.run()` called inside a running coroutine | `RuntimeError: asyncio.run() cannot be called from a running event loop` ✅[^lab] | Only one loop per thread ✅[^asyncio-runner] |
| `except Exception:` around an `await` in a task that is cancelled | Not entered; the `finally` block runs and `task.cancelled()` is `True` ✅[^lab] | `CancelledError` derives from `BaseException` (MRO, the method resolution order: `CancelledError`, `BaseException`, `object`) ✅[^lab] |
| A coroutine catches `CancelledError` and keeps going inside `asyncio.timeout(0.1)` | No `TimeoutError`; it returned `'kept running'` after 0.302 s ✅[^lab] | `timeout()` relies on the cancellation reaching it ✅[^asyncio-task] |
| `await` of a coroutine that never suspends | No other task runs at that point ✅[^lab] | Only a real suspension hands control back; `asyncio.sleep()` always suspends ✅[^asyncio-task] |
| `gather(..., return_exceptions=True)` | `['ok done', ValueError('boom')]` ✅[^lab] | Exceptions are treated like results ✅[^asyncio-task] |
| Task created with `create_task()` and no reference kept | May be garbage-collected before it finishes ✅[^asyncio-task] | The loop keeps weak references only |
| Fire-and-forget task that fails | Logged as "Task exception was never retrieved" when collected ✅[^asyncio-task] | Nobody awaited it; a `TaskGroup` would propagate it |
| A 0.15 s `time.sleep()` under `asyncio.run(main(), debug=True)` | Logs `Executing <Task finished name='Task-1' ...> took 0.153 seconds` ✅[^lab] | Debug mode logs callbacks slower than 100 ms ✅[^asyncio-dev] |
| `python3.15 -m asyncio ps <pid>` on the lab Mac, same user | Exit 1: `Error: The specified process cannot be attached to due to insufficient permissions.` ✅[^lab] | macOS blocks debugging other processes by default ✅[^remote-debugging] |
| Eager factory and a coroutine that returns without awaiting | `task.done()` is `True` right after `create_task()`; with the default factory it is `False` ✅[^lab] | The coroutine ran synchronously inside `create_task()` ✅[^asyncio-task] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `asyncio.TaskGroup` | Siblings cancelled on failure; all errors reported together; tasks referenced for you ✅[^asyncio-task] | Must catch `ExceptionGroup` (`except*`); 3.11+ |
| `asyncio.gather` | Returns results in order; `return_exceptions=True` collects failures ✅[^asyncio-task] | A failure does not cancel the others ✅[^asyncio-task] |
| `asyncio.timeout()` | Works on any block of awaits; can be rescheduled ✅[^asyncio-task] | `TimeoutError` is only catchable outside the block ✅[^asyncio-task] |
| `asyncio.wait_for()` | One awaitable, one line | May wait past the timeout while the target cancels ✅[^asyncio-task] |
| `asyncio.to_thread()` | Keeps the loop responsive during blocking I/O ✅[^asyncio-task] | No speed-up for CPU-bound Python code under the GIL ✅[^asyncio-task] |

## Takeaways
- Await every coroutine or wrap it in a task; treat a "never awaited" warning as a bug. [rule-candidate]
- Keep a reference to every task, preferably by creating it in a `TaskGroup`. [rule-candidate]
- Never swallow `asyncio.CancelledError`: clean up in `finally`, or re-raise after handling. [rule-candidate]
- Put a timeout (`asyncio.timeout()`) around every network wait.
- Never call blocking functions (`time.sleep`, synchronous HTTP, heavy loops) in a coroutine; use `asyncio.to_thread()` or an executor. [rule-candidate]
- Shared state between tasks is safe only between `await`s; guard a read, `await`, write sequence with an `asyncio.Lock`.
- Run new programs with debug mode on in development to catch slow callbacks and forgotten awaits.

## Verification status
- Verified: 85 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Coroutines and tasks](https://docs.python.org/3/library/asyncio-task.html) — Python Software Foundation, living. Rank 1. Backs: coroutines, awaitables, `create_task` and weak references, `TaskGroup`, `gather`, cancellation, `sleep`, `timeout`, `wait_for`, `to_thread`, eager task factory. [^asyncio-task]
- [Developing with asyncio](https://docs.python.org/3/library/asyncio-dev.html) — Python Software Foundation, living. Rank 1. Backs: debug mode, one thread per loop, blocking code, never-awaited coroutines, thread safety. [^asyncio-dev]
- [Runners](https://docs.python.org/3/library/asyncio-runner.html) — Python Software Foundation, living. Rank 1. Backs: what `asyncio.run()` does and when it fails. [^asyncio-runner]
- [Queues](https://docs.python.org/3/library/asyncio-queue.html) — Python Software Foundation, living. Rank 1. Backs: `asyncio.Queue`, `join`, `task_done`, not thread-safe. [^asyncio-queue]
- [Synchronization Primitives](https://docs.python.org/3/library/asyncio-sync.html) — Python Software Foundation, living. Rank 1. Backs: `Semaphore`, `Lock`, not thread-safe. [^asyncio-sync]
- [Command-line introspection tools](https://docs.python.org/3/library/asyncio-tools.html) — Python Software Foundation, living. Rank 1. Backs: `python -m asyncio ps` and `pstree`. [^asyncio-tools]
- [Call graph introspection](https://docs.python.org/3/library/asyncio-graph.html) — Python Software Foundation, living. Rank 1. Backs: `print_call_graph`, `format_call_graph`, `capture_call_graph`. [^asyncio-graph]
- [Remote debugging attachment protocol: Permission requirements](https://docs.python.org/3/howto/remote_debugging.html) — Python Software Foundation, living. Rank 1. Backs: macOS blocks debugging other processes by default; root or the entitlement. [^remote-debugging]
- [Data model: Coroutine functions, Asynchronous generator functions](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: calling `async def` returns a coroutine; `async def` with `yield`. [^datamodel]
- [Compound statements: Coroutines](https://docs.python.org/3/reference/compound_stmts.html) — Python Software Foundation, living. Rank 1. Backs: `async def` is always a coroutine function; where `await`, `async for`, `async with` are allowed; the `async with` expansion. [^compound]
- [Glossary: asynchronous iterator](https://docs.python.org/3/glossary.html) — Python Software Foundation, living. Rank 1. Backs: `__aiter__`, `__anext__`, `StopAsyncIteration`. [^glossary]
- [What's New In Python 3.11: asyncio](https://docs.python.org/3/whatsnew/3.11.html) — Python Software Foundation, 2022. Rank 1. Backs: `TaskGroup` recommended for new code. [^whatsnew311]
- [What's New In Python 3.12: asyncio](https://docs.python.org/3/whatsnew/3.12.html) — Python Software Foundation, 2023. Rank 1. Backs: eager task factory speed-ups. [^whatsnew312]
- [What's new in Python 3.15: asyncio](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: `TaskGroup.cancel()`. [^whatsnew315]
- [PEP 492 – Coroutines with async and await syntax](https://peps.python.org/pep-0492/) — Yury Selivanov, 2015. Rank 1. Backs: origin of `async`/`await`. [^pep492]
- [PEP 525 – Asynchronous Generators](https://peps.python.org/pep-0525/) — Yury Selivanov, 2016. Rank 1. Backs: asynchronous generators. [^pep525]

## Related
- `concurrency/structured-concurrency.md` — why child tasks should belong to a scope like `TaskGroup`.
- `concurrency/blocking-in-async-runtimes.md` — what a blocking call does to any cooperative scheduler.
- `concurrency/shared-state-and-data-races.md` — races between tasks are still races.
- `python/concurrency/threads-processes-and-the-gil.md` — threads and processes, the other two concurrency models.
- `python/errors-and-resources/exceptions-and-exception-groups.md` — `ExceptionGroup` and `except*`, which `TaskGroup` raises.
- `python/iteration-and-functional/iterators-generators-and-itertools.md` — the synchronous iterators that `async for` mirrors.
