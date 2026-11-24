---
schema: topic-index/v1
kind: subtopic
topic: python/concurrency
last-updated: 2026-11-24
---

# Python concurrency

Running work at the same time in Python: threads and the global interpreter lock (GIL), processes and the `multiprocessing` start methods, the `concurrent.futures` executors, subinterpreters and the free-threaded build; and single-threaded concurrency with `asyncio` coroutines, tasks, cancellation and timeouts. Measured in CPython 3.15.2, in both the default GIL build and the free-threaded build (`python3.15t`). Not covered: cross-language theory such as structured concurrency and data races (see `concurrency/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [threads-processes-and-the-gil.md](threads-processes-and-the-gil.md) | concept | The GIL and what it means for threads; `threading` and `queue` basics; data races; `multiprocessing` start methods; the three executors; subinterpreters; the free-threaded build; CPU timings measured on both builds (4 threads: 0.98x with the GIL, 3.61x without) | verified |
| [asyncio-coroutines-and-tasks.md](asyncio-coroutines-and-tasks.md) | concept | Coroutines versus tasks, `asyncio.run`, cooperative switching at `await`, `gather` versus `TaskGroup`, cancellation, timeouts, `to_thread`, queues and semaphores, async iteration, debug mode, 3.14 introspection | verified |

## References
- [Concurrent Execution](https://docs.python.org/3/library/concurrency.html) — Python Software Foundation, living. Backs: subtopic scope.
- [asyncio — Asynchronous I/O](https://docs.python.org/3/library/asyncio.html) — Python Software Foundation, living. Backs: subtopic scope.

## Related
- `concurrency/` — structured concurrency, blocking in async runtimes, shared state and data races across languages.
- `python/learning-path.md` — the order to read the `python/` docs in.
