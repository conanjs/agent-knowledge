---
schema: knowledge-doc/v1
type: concept
topic: python/metaprogramming
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, metaclass, type, class-creation, prepare, init-subclass, set-name, mro-entries, class-getitem, abcmeta, enumtype, class-decorator]
ranked-sources: true
---

# Metaclasses and how a class statement builds a class

## Summary
**TL;DR:** A class is an object made by calling its metaclass, which is `type` unless something says otherwise: `class X: a = 1` does the same as `X = type('X', (), {'a': 1})`. A `class` statement runs in a fixed order: replace non-class bases via `__mro_entries__`, pick the most derived metaclass (or fail with "metaclass conflict"), get a namespace from `__prepare__`, run the body in it, call `metaclass(name, bases, namespace, **kwds)` (inside `type.__new__`, every attribute's `__set_name__` runs, then the parent's `__init_subclass__`), and finally apply class decorators. Most needs are met by `__init_subclass__` or a decorator; a metaclass is for behaviour of the class object itself.
**Use this when:** writing or debugging a metaclass, a plugin registry or class keyword arguments (`class X(Base, tag=...)`); seeing `TypeError: metaclass conflict`; deciding between a decorator, `__init_subclass__` and a metaclass; or `Cls[...]` returning something unexpected.
**Not this doc:** descriptors and the attribute lookup that `__set_name__` serves → `python/metaprogramming/descriptors-and-attribute-lookup.md`; using ABCs (abstract base classes), enums and dataclasses → `python/classes/dataclasses-enums-and-abcs.md`; generic classes and `class C[T]` → `python/typing/type-hints-and-generics.md`; function decorators → `python/iteration-and-functional/decorators-and-functools.md`.

## Problem
Class creation looks atomic, but it is a sequence with several hooks, and code that misreads the order breaks:
- Inheriting from an `abc.ABC` subclass and an `Enum` subclass at once fails with `TypeError: metaclass conflict: the metaclass of a derived class must be a (non-strict) subclass of the metaclasses of all its bases` ✅[^lab].
- A metaclass that rebuilds the namespace and drops its `__classcell__` entry makes defining any class that uses `super()` fail with `RuntimeError` ✅[^lab].
- Calling a metaclass directly, as `type('A', (), {})` or `SomeMeta('A', (), {})` does, skips its `__prepare__` ✅[^functions], so names that a custom `__prepare__` injects are missing ✅[^lab].
- `class G(object, color="red")` fails with `TypeError: G.__init_subclass__() takes no keyword arguments` ✅[^lab].

## Mental model
**Analogy:** building a house from a plan. First the "based on" list is cleaned up (a stand-in swaps itself for real parents). Then the contractor is chosen: the most specialised one that every parent's contractor agrees with (the metaclass). The contractor hands over an empty site (the namespace from `__prepare__`), the plan's lines are carried out on it (the class body), and the contractor builds the house (`type.__new__`). During the build, each fitting that wants to know its room is told (`__set_name__`), and the parent house gets a call to inspect the new one (`__init_subclass__`). Last, decorators renovate the finished house before the name goes on the door.

**Artifact** (measured in the lab ✅[^lab]):
```python
class X:
    a = 1
Y = type("X", (), {"a": 1})        # the same call the class statement makes
type(X), type(Y)                   # (<class 'type'>, <class 'type'>)
Y.__name__, Y.__bases__, Y.a       # ('X', (<class 'object'>,), 1)
type(X.__dict__).__name__          # 'mappingproxy'  (the class namespace is read-only)
```

## How it works
Seven actors take part:
- **The `class` statement** — its job: run the steps in order, via the interpreter.
- **Each base** — its job: optionally replace itself, via `__mro_entries__`.
- **The metaclass** — its job: supply the namespace and build the class, via `__prepare__`, `__new__` and `__init__`.
- **`type.__new__`** — its job: make the class object and fire the creation hooks, via the default metaclass's code.
- **Each namespace attribute** — its job: learn its owner and name, via `__set_name__`.
- **The parent class** — its job: react to a new subclass, via `__init_subclass__`.
- **Class decorators** — their job: post-process or replace the finished class, via `@decorator` lines.

```
class Order(Proxy(), tag="v1"):   body...
  │
  ├─1 bases: Proxy().__mro_entries__(bases) → (Base,)
  ├─2 metaclass: most derived of explicit + type(Base) → Meta
  ├─3 ns = Meta.__prepare__("Order", (Base,), tag="v1")
  ├─4 exec(body, globals(), ns)
  ├─5 cls = Meta("Order", (Base,), ns, tag="v1")
  │      └─ Meta.__new__ → type.__new__ ── copies ns into a new dict
  │                          ├─ attr.__set_name__(cls, name)  for each attribute
  │                          └─ Base.__init_subclass__ for cls, tag="v1"  (the parent's hook)
  │         Meta.__init__(cls, ...)
  ├─6 cls = decorator(cls)  for each class decorator
  └─7 bind the name Order
```

1. **The statement resolves MRO (method resolution order) entries.** If a base is not an instance of `type`, its `__mro_entries__(bases)` is called with the original bases tuple and must return a tuple of classes to use instead; an empty tuple drops the base ✅[^datamodel]. `types.get_original_bases(cls)` returns the bases as written ✅[^types].
2. **The statement determines the metaclass.** With no bases and no `metaclass=`, it is `type`; an explicit metaclass that is not an instance of `type` (a plain function, say) is used directly; otherwise the most derived metaclass is chosen from the explicit one and `type(base)` of every base, and if none is a subtype of all of them the class fails with `TypeError` ✅[^datamodel]. In the lab, bases with metaclasses `M1` and `M3(M1)` gave `M3`, while unrelated `M1` and `M2` raised the conflict ✅[^lab].
3. **The metaclass prepares the namespace.** If it has `__prepare__`, the statement calls `metaclass.__prepare__(name, bases, **kwds)` with the class keywords; it should be a `classmethod`; without it the namespace is an empty ordered mapping ✅[^datamodel]. PEP 3115 (PEP = Python Enhancement Proposal) added this hook so the metaclass gets involved before the body runs, for example to record declaration order or to inject names valid only during class construction ✅[^pep3115]. `enum.EnumType.__prepare__` returns an `EnumDict` ✅[^lab], the `dict` subclass used as the namespace for defining enums ✅[^enum].
4. **The statement executes the body** roughly as `exec(body, globals(), namespace)`; methods defined in the body still cannot see class-scope names directly ✅[^datamodel].
5. **The statement calls the metaclass**, `metaclass(name, bases, namespace, **kwds)`, with the same keywords given to `__prepare__` ✅[^datamodel]. When the metaclass is `type` or calls `type.__new__`:
   - `type.__new__` copies the namespace into a new ordered mapping, discards the original, and wraps the copy in a read-only proxy that becomes `__dict__` ✅[^datamodel];
   - it calls `__set_name__(cls, name)` on each attribute that defines it ✅[^datamodel];
   - it calls `__init_subclass__` on the immediate parent in the MRO ✅[^datamodel], so subclass hooks already see initialised descriptors ✅[^pep487].
   - CPython implementation detail: if a method uses `super()` or `__class__`, the namespace carries a `__classcell__` entry that must reach `type.__new__`, or class creation raises `RuntimeError` ✅[^datamodel].
6. **Class decorators** receive the created class, and their result is bound to the class name ✅[^datamodel].

**`__init_subclass__` (PEP 487, 3.6).** Defined on a parent, it runs whenever that class is subclassed, with `cls` as the new subclass; a plain method is turned into a class method automatically ✅[^datamodel]. Keyword arguments in the class header (except `metaclass`) are passed to it; each implementation should take its own and pass the rest to `super().__init_subclass__(**kwargs)`, and `object.__init_subclass__` raises an error if any are left ✅[^datamodel]. PEP 487 found that most metaclass uses fall into three groups: code run after class creation, initialising descriptors, and keeping attribute order; it covers the first two with these hooks ✅[^pep487].

**Subscription: `__class_getitem__` versus a metaclass `__getitem__`.** For `obj[x]`, Python calls `type(obj).__getitem__` if it exists; otherwise, if `obj` is a class with `__class_getitem__`, it calls that ✅[^datamodel]. `type` defines no `__getitem__`, so `list[int]` calls `list.__class_getitem__(int)` and returns a `types.GenericAlias` ✅[^datamodel]. Using `__class_getitem__` for anything other than type hinting is discouraged ✅[^datamodel].

**Metaclasses in the standard library.**
- `abc.ABCMeta` lets an ABC register unrelated classes as virtual subclasses: `issubclass()` accepts them, but the ABC does not appear in their MRO ✅[^abc]. A class whose metaclass derives from `ABCMeta` cannot be instantiated until all its abstract methods are overridden ✅[^abc]. `abc.ABC` is a helper class whose metaclass is `ABCMeta`, so inheriting from it can still cause metaclass conflicts ✅[^abc]. `ABCMeta` implements `__instancecheck__` and `__subclasscheck__`, which must live on the metaclass ✅[^datamodel].
- `enum.EnumType` creates the members, sets `__repr__`, `__str__`, `__format__` and `__reduce__`, handles duplicates and makes the class iterable; before 3.11 it was named `EnumMeta`, which remains an alias ✅[^enum]. Its `__getitem__(cls, name)` returns the member with that name ✅[^enum], so `Color['BLUE']` gives `Color.BLUE` instead of a generic alias ✅[^lab].

**Creating classes dynamically.** `type(name, bases, dict, **kwargs)` builds a class; an empty `bases` gets `object` added, and keywords go to the metaclass machinery, usually `__init_subclass__` ✅[^functions]. Unlike a `class` statement it does not call `__prepare__`; `types.new_class()` does ✅[^functions]. Since 3.15, `dict` may be a `frozendict` ✅[^functions]. `types.prepare_class()` returns `(metaclass, namespace, kwds)` with `metaclass` removed from `kwds` ✅[^types].

## Worked example
One class whose creation fires every hook, run in the lab ✅[^lab]:

```python
class Meta(type):
    @classmethod
    def __prepare__(mcls, name, bases, **kw):
        print(f"2 Meta.__prepare__({name!r}, {bases}, {kw})")
        return {}
    def __new__(mcls, name, bases, ns, **kw):
        print(f"4 Meta.__new__ before type.__new__, keys={[k for k in ns if not k.startswith('__')]}")
        cls = super().__new__(mcls, name, bases, ns, **kw)
        print("6 Meta.__new__ after type.__new__")
        return cls
    def __init__(cls, name, bases, ns, **kw):
        print("7 Meta.__init__")
        super().__init__(name, bases, ns, **kw)

class Base(metaclass=Meta):
    def __init_subclass__(cls, /, tag=None, **kw):
        print(f"5b Base.__init_subclass__({cls.__name__}, tag={tag!r})")
        super().__init_subclass__(**kw)
        cls.tag = tag

class Field:
    def __set_name__(self, owner, name):
        print(f"5a Field.__set_name__({owner.__name__}, {name!r})")

class Proxy:  # not a class: provides __mro_entries__
    def __mro_entries__(self, bases):
        print(f"1 Proxy.__mro_entries__ -> (Base,)")
        return (Base,)

def deco(cls):
    print(f"8 decorator({cls.__name__})")
    return cls

@deco
class Order(Proxy(), tag="v1"):
    print("3 class body runs")
    qty = Field()
print("9 bound:", Order.__name__, type(Order).__name__, Order.__bases__, Order.tag)
```

| Printed line (exact) | Step |
|---|---|
| `1 Proxy.__mro_entries__ -> (Base,)` | 1: the `Proxy()` instance is not a class, so it is replaced by `Base` |
| `2 Meta.__prepare__('Order', (<class '__main__.Base'>,), {'tag': 'v1'})` | 2–3: `Meta` comes from `type(Base)`; the class keyword reaches `__prepare__` |
| `3 class body runs` | 4: the body executes in the prepared namespace |
| `4 Meta.__new__ before type.__new__, keys=['qty']` | 5: the namespace now holds `qty` |
| `5a Field.__set_name__(Order, 'qty')` | 5: inside `type.__new__`, first hook |
| `5b Base.__init_subclass__(Order, tag='v1')` | 5: inside `type.__new__`, second hook, with the keyword |
| `6 Meta.__new__ after type.__new__` | 5: `type.__new__` has returned |
| `7 Meta.__init__` | 5: the metaclass call continues with `__init__` |
| `8 decorator(Order)` | 6: decorators run last |
| `9 bound: Order Meta (<class '__main__.Base'>,) v1` | 7: `type(Order)` is `Meta`, `__bases__` is `(Base,)`, the hook set `tag` |

Defining `Base` itself printed only lines 2, 4, 6 and 7 ✅[^lab]: its parent is `object`, whose `__init_subclass__` does nothing ✅[^datamodel]. `types.get_original_bases(Order)` returned a one-item tuple holding the `Proxy` instance ✅[^lab].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `class Both(Shape, Color)` with `Shape(abc.ABC)` and `Color(enum.Enum)` | `TypeError: metaclass conflict: ...` ✅[^lab] | `ABCMeta` and `EnumType` are unrelated, so no candidate is a subtype of both ✅[^datamodel] |
| A metaclass `__new__` that filters `__classcell__` out of the namespace, on a class using `super()` | `RuntimeError: __class__ not set defining 'UsesSuper' as <class '__main__.UsesSuper'>. Was __classcell__ propagated to type.__new__?` ✅[^lab] | CPython passes the `__class__` cell this way; it must reach `type.__new__` ✅[^datamodel] |
| `class F(metaclass=func)` where `func` returns `7` | `F` is bound to `7` ✅[^lab] | A non-`type` explicit metaclass is just called ✅[^datamodel] |
| `PMeta("A", (), {})` with a `PMeta.__prepare__` that injects a name | `A` lacks the name; `types.new_class("B", (), {"metaclass": PMeta})` has it ✅[^lab] | Calling a metaclass directly skips `__prepare__` ✅[^functions] |
| `type("Y", (), types.MappingProxyType({}))` | `TypeError: type.__new__() argument 3 must be dict or frozendict, not mappingproxy`; a `frozendict` worked ✅[^lab] | 3.15 accepts `frozendict` as the namespace ✅[^functions] |
| `class G(object, color="red")` | `TypeError: G.__init_subclass__() takes no keyword arguments` ✅[^lab] | Unconsumed keywords reach `object.__init_subclass__` ✅[^datamodel] |
| Reading annotations in a metaclass `__new__` (3.14+) | `annotationlib.get_annotate_from_class_namespace(ns)` returned a function for `x: int; y: Undefined`; calling it with `FORWARDREF` gave `{'x': <class 'int'>, 'y': ForwardRef('Undefined')}`; reading `Typed.__annotations__` later raised `NameError: name 'Undefined' is not defined` ✅[^lab] | Annotations are evaluated lazily since 3.14; do not read them from the namespace dictionary, use this function during class construction and `annotationlib.get_annotations()` afterwards ✅[^whatsnew314] ✅[^annotationlib] |
| A class with no annotations | `cls.__annotate__` is `None` ✅[^lab] | `type.__annotate__` is the class's annotate function or `None` (3.14) ✅[^datamodel] |
| `tuple.register` on an ABC, then `Shape in tuple.__mro__` | `issubclass(tuple, Shape)` is `True`, `Shape in tuple.__mro__` is `False` ✅[^lab] | Virtual subclasses are not added to the MRO ✅[^abc] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Class decorator | Plain function; touches only the decorated class ✅[^datamodel] | Not inherited: each subclass must be decorated again |
| `__init_subclass__` | Runs for every future subclass using ordinary inheritance; adding one carries about the risk of adding an `__init__` ✅[^pep487] | Does not run for the class that defines it, and runs only after the class object exists ✅[^datamodel] |
| `__set_name__` on a descriptor | Works in any class, no base or metaclass needed ✅[^pep487] | Only for attributes present when the class is created ✅[^datamodel] |
| Custom metaclass | Hooks before the body (`__prepare__`) and methods on the class object itself, such as `__getitem__` or `__instancecheck__` ✅[^datamodel] | Persists for the class's whole life and combines badly: two unrelated metaclasses need a hand-made combined one ✅[^pep487] |

## Takeaways
- Reach for a class decorator or `__init_subclass__` first; use a metaclass only when the class object itself needs behaviour or `__prepare__` is required ✅[^pep487]. [rule-candidate]
- In `__init_subclass__`, take your own keywords and pass the rest to `super().__init_subclass__(**kwargs)` ✅[^datamodel]. [rule-candidate]
- In a metaclass, pass the namespace (with `__classcell__`) on to `super().__new__`; never rebuild it by dropping dunder keys. [rule-candidate]
- To create a class at runtime with a metaclass that has `__prepare__`, use `types.new_class()`, not a bare metaclass call ✅[^functions].
- Remember the order: `__mro_entries__`, metaclass choice, `__prepare__`, body, `type.__new__` (`__set_name__`, then `__init_subclass__`), metaclass `__init__`, decorators ✅[^lab].

## Verification status
- Verified: 73 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Data model: Customizing class creation, Metaclasses, Emulating generic types, Customizing instance and subclass checks](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: the class-creation steps; metaclass selection and the conflict; `__prepare__`; body execution; `type.__new__`'s copy, `__set_name__` and `__init_subclass__`; `__classcell__`; decorators; `__init_subclass__` keywords; `__class_getitem__` versus `__getitem__`; `__instancecheck__`/`__subclasscheck__`; `type.__annotate__`. [^datamodel]
- [Built-in functions: type](https://docs.python.org/3/library/functions.html) — Python Software Foundation, living. Rank 1. Backs: the three-argument `type()`, its keywords, skipping `__prepare__`, `frozendict` in 3.15. [^functions]
- [types — Dynamic type creation and names for built-in types](https://docs.python.org/3/library/types.html) — Python Software Foundation, living. Rank 1. Backs: `get_original_bases()`, `prepare_class()`. [^types]
- [abc — Abstract Base Classes](https://docs.python.org/3/library/abc.html) — Python Software Foundation, living. Rank 1. Backs: `ABCMeta`, `ABC`, virtual subclasses, `abstractmethod` blocking instantiation, metaclass-conflict warning. [^abc]
- [enum — Support for enumerations](https://docs.python.org/3/library/enum.html) — Python Software Foundation, living. Rank 1. Backs: `EnumType`'s job, the `EnumMeta` alias, `EnumType.__getitem__`, `EnumDict`. [^enum]
- [annotationlib — Functionality for introspecting annotations](https://docs.python.org/3/library/annotationlib.html) — Python Software Foundation, living. Rank 1. Backs: `get_annotate_from_class_namespace()` for metaclasses. [^annotationlib]
- [What's new in Python 3.14: Related changes (annotations)](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, 2025. Rank 1. Backs: do not read annotations from a class namespace dictionary. [^whatsnew314]
- [PEP 487 – Simpler customisation of class creation](https://peps.python.org/pep-0487/) — Martin Teichmann, 2015. Rank 1. Backs: the three groups of metaclass uses, hook order, reduced metaclass conflicts, `__set_name__` working in any class. [^pep487]
- [PEP 3115 – Metaclasses in Python 3000](https://peps.python.org/pep-3115/) — Talin, 2007. Rank 1. Backs: why `__prepare__` exists. [^pep3115]

## Related
- `python/metaprogramming/descriptors-and-attribute-lookup.md` — what `__set_name__` is for and how attributes are then looked up.
- `python/classes/classes-instances-and-inheritance.md` — classes, bases and the MRO.
- `python/classes/dataclasses-enums-and-abcs.md` — using `abc`, `enum` and `dataclasses` day to day.
- `python/typing/type-hints-and-generics.md` — `list[int]`, `typing.Generic` and annotations.
- `python/iteration-and-functional/decorators-and-functools.md` — decorators, including class decorators.
