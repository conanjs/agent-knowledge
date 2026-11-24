---
schema: topic-index/v1
kind: subtopic
topic: python/fundamentals
last-updated: 2026-11-24
---

# Python fundamentals

Objects, names and the built-in scalar types; control flow and structural pattern matching; functions, arguments, scopes and closures. Measured in CPython 3.15.2. Not covered: containers (see `python/data-structures/`), classes (see `python/classes/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [objects-names-and-types.md](objects-names-and-types.md) | concept | Identity, type and value; names bound to objects; mutability; `is` vs `==`; `int`, `float`, `bool`; `//`, `%`, `round()`; truthiness | verified |
| [control-flow-and-pattern-matching.md](control-flow-and-pattern-matching.md) | concept | Indentation blocks, `if`/`elif`, `for` and `range()`, `break`/`continue`, loop `else`, `:=`, and `match` patterns (literal, capture, value, sequence, mapping, class, OR/AS, guards) with their traps | verified |
| [functions-scopes-and-closures.md](functions-scopes-and-closures.md) | concept | `def` as a runtime statement, parameter kinds (`/`, `*`, `*args`, `**kwargs`), defaults evaluated once, `lambda`, name resolution, `global`/`nonlocal`, closures, cells, late binding | verified |

## References
- [The Python Tutorial](https://docs.python.org/3/tutorial/index.html) — Python Software Foundation, living. Backs: subtopic scope.

## Related
- `python/learning-path.md` — the order to read the `python/` docs in.
