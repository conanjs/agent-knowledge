---
schema: topic-index/v1
kind: subtopic
topic: python/iteration-and-functional
last-updated: 2026-11-24
---

# Python iteration and functional tools

The iteration protocol that every `for` loop uses, generators and generator expressions, the lazy built-ins and `itertools`; then functions that take and return functions: decorators, `functools` (partial application, caching, single dispatch, reduction) and the `operator` getters. Measured in CPython 3.15.2. Not covered: closures themselves (see `python/fundamentals/functions-scopes-and-closures.md`), async generators (see `python/concurrency/asyncio-coroutines-and-tasks.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [iterators-generators-and-itertools.md](iterators-generators-and-itertools.md) | concept | Iterable vs iterator, the protocol and `for`, generators (`yield`, `yield from`, `send`/`throw`/`close`, PEP 479), lazy built-ins and the main `itertools` functions | verified |
| [decorators-and-functools.md](decorators-and-functools.md) | concept | Decorator syntax and stacking, `wraps`, decorator factories, class decorators; `functools` `partial`/`Placeholder`, caches, `cached_property`, `reduce`, `singledispatch`, `cmp_to_key`; `operator` getters | verified |

## References
- [Functional Programming HOWTO](https://docs.python.org/3/howto/functional.html) — Python Software Foundation, living. Backs: subtopic scope.
- [itertools — Functions creating iterators for efficient looping](https://docs.python.org/3/library/itertools.html) — Python Software Foundation, living. Backs: subtopic scope.

## Related
- `software-design/functional-modeling/` — functional design across languages.
- `python/learning-path.md` — the order to read the `python/` docs in.
