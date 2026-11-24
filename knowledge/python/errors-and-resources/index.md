---
schema: topic-index/v1
kind: subtopic
topic: python/errors-and-resources
last-updated: 2026-11-24
---

# Python errors and resources

How exceptions are raised, caught, chained and grouped, and how the `with` statement and `contextlib` release resources such as open files; plus text and binary file I/O, encodings and `pathlib`. Measured in CPython 3.15.2. Not covered: how to design error handling across a program (see `error-handling/`), `async with` (see `python/concurrency/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [exceptions-and-exception-groups.md](exceptions-and-exception-groups.md) | concept | How `try`/`except`/`else`/`finally` run, `BaseException` versus `Exception`, chaining (`__cause__`, `__context__`), `add_note`, `ExceptionGroup` and `except*`, warnings | verified |
| [context-managers-and-file-io.md](context-managers-and-file-io.md) | concept | The `with` protocol, `contextlib` helpers, `open()` modes, the UTF-8 default (PEP 686), newlines, buffering, `tell`/`seek`, `pathlib`, `tempfile`, and why files must be closed | verified |

## References
- [The Python Tutorial: Errors and Exceptions](https://docs.python.org/3/tutorial/errors.html) — Python Software Foundation, living. Backs: subtopic scope.
- [The Python Tutorial: Input and Output](https://docs.python.org/3/tutorial/inputoutput.html) — Python Software Foundation, living. Backs: subtopic scope.

## Related
- `error-handling/` — cross-language error design.
- `python/learning-path.md` — the order to read the `python/` docs in.
