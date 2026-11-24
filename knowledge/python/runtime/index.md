---
schema: topic-index/v1
kind: subtopic
topic: python/runtime
last-updated: 2026-11-24
---

# CPython runtime internals

What the CPython interpreter does with a program while it runs: how it manages memory (reference counting, the cyclic garbage collector, weak references, finalizers, immortal objects, allocators) and how source code becomes bytecode that the specializing interpreter executes. These are CPython implementation details, not language guarantees, measured in CPython 3.15.2. Not covered: the C API for writing extensions, threads and the GIL (see `python/concurrency/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [memory-management-and-garbage-collection.md](memory-management-and-garbage-collection.md) | concept | CPython reference counting, the cyclic `gc` (3.14's incremental collector reverted), `weakref`, `__del__` and PEP 442, immortal objects, pymalloc, `getsizeof`, `tracemalloc`, `intern` | verified |
| [bytecode-and-the-interpreter.md](bytecode-and-the-interpreter.md) | concept | How CPython turns source into tokens, an AST, code objects and bytecode; reading `dis`; `.pyc` invalidation; the specializing interpreter; the experimental JIT; the tail-calling interpreter; frames | verified |

## References
- [gc — Garbage Collector interface](https://docs.python.org/3/library/gc.html) — Python Software Foundation, living. Backs: subtopic scope.
- [dis — Disassembler for Python bytecode](https://docs.python.org/3/library/dis.html) — Python Software Foundation, living. Backs: subtopic scope.

## Related
- `python/concurrency/threads-processes-and-the-gil.md` — the GIL and the free-threaded build.
- `python/learning-path.md` — the order to read the `python/` docs in.
