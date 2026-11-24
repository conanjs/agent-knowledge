---
schema: topic-index/v1
kind: subtopic
topic: python/classes
last-updated: 2026-11-24
---

# Python classes

How a class statement builds a class object, how instances find their attributes, inheritance and the method resolution order, the special ("dunder") methods that plug a class into operators and built-ins, and the standard helpers that write classes for you: dataclasses, enums, abstract base classes and named tuples. Measured in CPython 3.15.2. Not covered: the descriptor and metaclass machinery underneath (see `python/metaprogramming/`), structural typing (see `python/typing/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [classes-instances-and-inheritance.md](classes-instances-and-inheritance.md) | concept | How the class body runs, how attribute lookup searches the instance then the class, bound methods, shared class attributes, `super()` and the C3 method resolution order (MRO), name mangling | verified |
| [data-model-special-methods.md](data-model-special-methods.md) | concept | Special methods are looked up on the type; `__new__`/`__init__`; text forms; `NotImplemented` and reflected operators; in-place fallback; the hash invariant; container protocol; `total_ordering` | verified |
| [dataclasses-enums-and-abcs.md](dataclasses-enums-and-abcs.md) | concept | What `@dataclass` generates and its options; enum members as singletons with `auto`, `IntEnum`, `StrEnum`, `Flag`; abstract base classes, `register()`, `collections.abc` mixins; named tuples | verified |

## References
- [The Python Tutorial: Classes](https://docs.python.org/3/tutorial/classes.html) — Python Software Foundation, living. Backs: subtopic scope.
- [Data model](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Backs: subtopic scope.

## Related
- `python/metaprogramming/` — descriptors and metaclasses.
- `software-design/` — object-oriented design principles across languages.
- `python/learning-path.md` — the order to read the `python/` docs in.
