---
schema: topic-index/v1
kind: subtopic
topic: python/typing
last-updated: 2026-11-24
---

# Python type hints

Type hints as the interpreter sees them (unenforced metadata, evaluated lazily since 3.14) and as the typing specification defines them for type checkers: generics, aliases, protocols, `TypedDict`, literal and final types, overloads and narrowing. Runtime behaviour measured in CPython 3.15.2; type-checker behaviour taken from the typing specification and the PEPs, since no checker was run. Not covered: individual checkers (mypy, pyright) and their settings.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [type-hints-and-generics.md](type-hints-and-generics.md) | concept | Annotations are unenforced metadata, evaluated lazily since 3.14 through `annotationlib` formats; everyday hints, `type` aliases, PEP 695 generics, defaults, variance, introspection | verified |
| [protocols-typeddict-and-narrowing.md](protocols-typeddict-and-narrowing.md) | concept | Structural typing with `Protocol` and `TypedDict` (not enforced at runtime); `Literal`, `Final`, overloads, `@override`; narrowing with `TypeIs`, `TypeGuard`, `assert_never`; 3.15 `TypeForm`, `@disjoint_base` | verified |

## References
- [typing — Support for type hints](https://docs.python.org/3/library/typing.html) — Python Software Foundation, living. Backs: subtopic scope.
- [Specification for the Python type system](https://typing.python.org/en/latest/spec/index.html) — Python typing council, living. Backs: subtopic scope.

## Related
- `python/classes/dataclasses-enums-and-abcs.md` — nominal interfaces with ABCs.
- `python/learning-path.md` — the order to read the `python/` docs in.
