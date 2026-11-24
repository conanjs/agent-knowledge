---
schema: topic-index/v1
kind: subtopic
topic: python/data-structures
last-updated: 2026-11-24
---

# Python built-in data structures

The built-in containers and text types: lists, tuples and the common sequence operations, slicing, sorting, unpacking, comprehensions and copies; dictionaries, sets, hashability and the `collections` helpers; strings, bytes, encodings and every formatting syntax from `%` to t-strings. Measured in CPython 3.15.2. Not covered: the theory of hash tables and sorting (see `algorithms/`), writing your own containers (see `python/classes/data-model-special-methods.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [lists-tuples-and-sequences.md](lists-tuples-and-sequences.md) | concept | Common sequence operations, half-open slicing, list methods, `deque` queues, `sort` versus `sorted`, unpacking, comprehension scope (PEP 709, PEP 798), shallow and deep copies, aliasing traps | verified |
| [dicts-sets-and-hashing.md](dicts-sets-and-hashing.md) | concept | Dict order and live views, `get`/`setdefault`/`pop` and the merge operators, hashability and equal-key collapse, sets, 3.15 `frozendict`, `defaultdict`/`Counter`/`OrderedDict`/`ChainMap`, hash randomization | verified |
| [strings-bytes-and-formatting.md](strings-bytes-and-formatting.md) | concept | `str` as code points, literal prefixes, `split`/`strip`/`removeprefix`/`casefold`, `bytes` and `bytearray`, error handlers, normalization and graphemes, f-strings, the format-spec mini-language, `%`, `Template`, t-strings | verified |

## References
- [The Python Tutorial: Data Structures](https://docs.python.org/3/tutorial/datastructures.html) — Python Software Foundation, living. Backs: subtopic scope.
- [Built-in Types](https://docs.python.org/3/library/stdtypes.html) — Python Software Foundation, living. Backs: subtopic scope.

## Related
- `algorithms/data-structures/` — costs and theory behind these structures.
- `python/learning-path.md` — the order to read the `python/` docs in.
