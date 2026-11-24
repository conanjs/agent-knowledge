---
schema: topic-index/v1
kind: subtopic
topic: python/metaprogramming
last-updated: 2026-11-24
---

# Python metaprogramming

The machinery under classes: the descriptor protocol and the exact order in which attribute lookup consults the type, the instance and its fallbacks (which is how methods, `property` and `__slots__` work), and the steps a `class` statement takes to build a class, with the hooks that customize it (metaclasses, `__prepare__`, `__init_subclass__`, `__set_name__`). Measured in CPython 3.15.2. Not covered: everyday class usage (see `python/classes/`), decorators on functions (see `python/iteration-and-functional/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [descriptors-and-attribute-lookup.md](descriptors-and-attribute-lookup.md) | concept | The descriptor protocol and attribute lookup order: data descriptors, the instance `__dict__`, non-data descriptors, `__getattr__`; bound methods, `property`/`classmethod`/`staticmethod`, `__slots__` | verified |
| [metaclasses-and-class-creation.md](metaclasses-and-class-creation.md) | concept | How a class statement builds a class: `__mro_entries__`, choosing the metaclass, `__prepare__`, the body, `type.__new__` hooks, decorators; `__init_subclass__`, `ABCMeta`, `EnumType` | verified |

## References
- [Descriptor Guide](https://docs.python.org/3/howto/descriptor.html) — Python Software Foundation, living. Backs: subtopic scope.
- [Data model: Customizing class creation](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Backs: subtopic scope.

## Related
- `python/classes/` — classes, special methods, dataclasses.
- `python/learning-path.md` — the order to read the `python/` docs in.
