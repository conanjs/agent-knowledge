---
schema: topic-index/v1
kind: topic
topic: python
last-updated: 2026-11-24
---

# Python, the language

The Python language and its standard library, from the basics to the internals, written in our own words from the official documentation (the Python Tutorial, the Language Reference, the Library Reference, the HOWTOs and the PEPs) and checked by running every behaviour in CPython 3.15.2 (the default build, the free-threaded build `python3.15t`, and the official `python:3.15.2-slim` container for `pip`). The docs go from objects, names and control flow, through data structures, modules, errors and classes, to iteration, decorators, descriptors, metaclasses, memory management, bytecode, threads and `asyncio`, and type hints. Start with `learning-path.md`, which also maps every chapter of the Python Tutorial to the doc that covers it. Not covered: third-party frameworks and tools (web frameworks, NumPy, pytest, type checkers) and the C API.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [learning-path.md](learning-path.md) | reference | Nine stages with an exercise and a self-check each, plus a map of every Python Tutorial chapter to the doc that covers it | verified |
| [python-lab-setup.md](python-lab-setup.md) | how-to | Install CPython 3.15.2 and the free-threaded `python3.15t` with Homebrew, run probes with `python3.15 -I`, and use the `python:3.15.2-slim` container for `pip` (the bottles' `pyexpat` fails on macOS 26.1) | verified |

## Subtopics
| Subtopic | Summary |
|---|---|
| [fundamentals/](fundamentals/index.md) | Objects, names and scalar types; control flow and `match`; functions, scopes and closures |
| [data-structures/](data-structures/index.md) | Lists, tuples and sequences; dicts, sets and hashing; strings, bytes and formatting |
| [modules-and-packaging/](modules-and-packaging/index.md) | Modules, packages and the import system; virtual environments, `pyproject.toml` and wheels |
| [errors-and-resources/](errors-and-resources/index.md) | Exceptions, chaining and exception groups; `with`, `contextlib` and file I/O |
| [classes/](classes/index.md) | Classes, inheritance and the MRO; special methods; dataclasses, enums and ABCs |
| [iteration-and-functional/](iteration-and-functional/index.md) | Iterators, generators and `itertools`; decorators and `functools` |
| [standard-library/](standard-library/index.md) | A task-ordered tour of the standard library; regular expressions; dates and times |
| [metaprogramming/](metaprogramming/index.md) | Descriptors and attribute lookup; metaclasses and class creation |
| [runtime/](runtime/index.md) | Reference counting and the garbage collector; bytecode, `.pyc` files and the adaptive interpreter |
| [concurrency/](concurrency/index.md) | Threads, processes and the GIL; `asyncio` coroutines and tasks |
| [typing/](typing/index.md) | Type hints, generics and annotations; protocols, `TypedDict` and narrowing |
| [tooling/](tooling/index.md) | Testing, debugging, logging and profiling tools in the standard library |

## References
- [Python 3.15 documentation](https://docs.python.org/3/) — Python Software Foundation, living. Backs: topic scope.
- [The Python Tutorial](https://docs.python.org/3/tutorial/index.html) — Python Software Foundation, living. Backs: topic structure and the chapter map.

## Related
- `floating-point/` — how Python floats are stored and rounded (IEEE 754).
- `concurrency/` — cross-language structured concurrency, blocking in async runtimes, data races.
- `error-handling/` — cross-language error design.
- `javascript/` — the same curriculum for JavaScript.
