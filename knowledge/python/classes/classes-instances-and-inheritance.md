---
schema: knowledge-doc/v1
type: concept
topic: python/classes
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, classes, instances, namespaces, methods, self, inheritance, super, mro, c3, multiple-inheritance, name-mangling, classmethod, staticmethod, property]
ranked-sources: true
---

# Classes, instances and inheritance

## Summary
**TL;DR:** A `class` statement runs its body once, when the definition is reached, and turns the names the body bound into a class object. An instance has its own attribute dictionary and falls back to the class, then to the base classes in MRO (method resolution order) order; a function stored on the class becomes a bound method when fetched through an instance, which is how `self` arrives. With several bases, Python orders the classes by the C3 linearization, and `super()` calls the *next* class in that order, which can be a sibling rather than the parent.
**Use this when:** a change to one instance's attribute shows up on every instance, a `super()` call runs a method you did not expect, a class definition fails with `Cannot create a consistent method resolution order`, or `obj.__name` is "missing" outside the class.
**Not this doc:** how functions become bound methods (descriptors, `__getattribute__`) → `python/metaprogramming/descriptors-and-attribute-lookup.md`; `__new__`, operators and protocols → `python/classes/data-model-special-methods.md`; `@dataclass`, `Enum`, abstract base classes → `python/classes/dataclasses-enums-and-abcs.md`; metaclasses and `__init_subclass__` → `python/metaprogramming/metaclasses-and-class-creation.md`.

## Problem
Python classes look like Java or C++ classes but follow other rules, and code written on that assumption breaks:
- A list created in the class body is shared by every instance: one dog's new trick appears on all dogs.
- `self.count += 1` on a class attribute does not update the class; it creates an instance attribute.
- With `B(A)`, `C(A)` and `D(B, C)`, calling `save()` on a `D` makes `super().save()` inside `B` run `C.save`, a class that `B` never mentions.
- `class GrandKid(Grand, Kid)` fails with a `TypeError` although both bases exist.
- `obj.__balance` raises `AttributeError` although `__init__` set `self.__balance`.

Each follows from three mechanisms: the class body is ordinary code that runs once, attribute lookup walks a fixed chain of namespaces, and that chain (the MRO) is computed by a specific algorithm.

## Mental model
**Analogy:** every instance carries a personal notebook; its class is a shared reference binder on a shelf, and the base classes are older binders behind it, in a fixed shelf order. To answer `obj.name`, Python opens the notebook first, then the binders in shelf order. Writing `obj.name = value` always writes in the notebook, never in a binder. A method is a recipe kept in a binder; reading it through an instance clips that instance to the recipe as its first ingredient, `self`.

**Artifact** (measured in the lab ✅[^lab]):
```python
class Dog:
    print("body runs now")            # printed while the class statement executes
    kind = "canine"                   # class attribute, stored in Dog.__dict__
    def __init__(self, name):
        self.name = name              # instance attribute, stored in d.__dict__
    def speak(self):
        return f"{self.name} says woof"

d = Dog("Rex")
type(Dog.__dict__).__name__           # 'mappingproxy'  read-only view of the class namespace
d.__dict__                            # {'name': 'Rex'}
d.kind, "kind" in d.__dict__          # ('canine', False)  found on the class
type(Dog.__dict__["speak"]).__name__  # 'function'  what the class stores
type(d.speak).__name__                # 'method'    what the instance hands out; d.speak.__self__ is d
d.speak() == Dog.speak(d)             # True
```

Lookup of `d.attr`, simplified (descriptors and `__getattr__` can change it; see the descriptors doc):
```
d.__dict__ ──miss──▶ Dog.__dict__ ──miss──▶ next class in Dog.__mro__ … object ──miss──▶ AttributeError
```

## How it works
1. **The class statement executes.** Python runs the body in a new execution frame with a fresh local namespace, then creates the class object from the base list and that saved namespace, and binds the class name in the enclosing scope ✅[^compound]. So the body runs once, at definition time, not per instance ✅[^lab]. A class without a base list inherits from `object` ✅[^compound], and the order in which the body defined its attributes is kept in the class's `__dict__` ✅[^compound].
2. **Two kinds of namespace.** A class namespace is a dictionary: `C.x` is looked up as `C.__dict__["x"]`, and on a miss the search continues in the base classes ✅[^datamodel]; `C.__dict__` is a read-only mapping proxy ✅[^datamodel]. An instance has its own dictionary, searched first; when a name is not there, the class attributes are searched ✅[^datamodel]. Assignments and deletions through an instance update the instance's dictionary, never a class's ✅[^datamodel].
3. **Methods are functions stored on the class.** Fetching a function attribute through an instance packs the instance and the function into a method object; calling it calls the function with the instance inserted first, so `x.f(1)` equals `C.f(x, 1)` ✅[^datamodel]. The bound method keeps both parts as `m.__self__` and `m.__func__` ✅[^tut-classes]. A function stored on the instance itself is not turned into a bound method ✅[^datamodel]. The name `self` is only a convention ✅[^tut-classes]. The machinery that performs the binding is the descriptor protocol: `python/metaprogramming/descriptors-and-attribute-lookup.md`.
4. **Class attributes are shared; instance attributes are per object.** Names assigned in the class body are class attributes shared by all instances; `self.name = value` in a method creates an instance attribute, which hides a class attribute of the same name; class attributes can serve as defaults, but mutable values there "can lead to unexpected results" ✅[^compound]. A `tricks = []` in the class body is one list for every instance; create it in `__init__` instead ✅[^tut-classes].
5. **`__init__` initialises the new instance.** Calling the class creates an object and then calls `__init__` with the arguments of the call ✅[^tut-classes]. `__init__` must return `None`; any other value raises `TypeError` ✅[^datamodel]. If a base class has an `__init__`, the derived class's `__init__` must call it explicitly, for example `super().__init__(...)` ✅[^datamodel]. How the object is created before that (`__new__`) is in `python/classes/data-model-special-methods.md`.
6. **Inheritance and overriding.** `class Derived(Base):` remembers the base, and an attribute not found in the class is looked up in the base, recursively ✅[^tut-classes]. A derived class can override any method; because methods call each other through `self`, a base-class method may end up calling the override, so all methods are effectively virtual ✅[^tut-classes].
7. **`super()` delegates to the next class in the MRO.** `super(type, obj)` returns a proxy that searches the MRO of `obj`'s class, starting right after `type` ✅[^functions]. Inside an ordinary method both arguments can be omitted: `type` is the enclosing class and `obj` the method's first argument ✅[^functions], which the compiler makes available through an implicit `__class__` closure cell ✅[^datamodel]. It serves two uses: in single inheritance, naming the parent without hard-coding it; in multiple inheritance, cooperative calls along the MRO, where good design gives every implementation of the method the same calling signature ✅[^functions].
8. **The MRO is a C3 linearization.** `__mro__` is the tuple of classes searched during method resolution ✅[^datamodel]. The order keeps the left-to-right base order given in each class, visits each class once, and is monotonic: subclassing a class never changes the precedence order of its parents ✅[^tut-classes]; a class always comes before its bases ✅[^compound]. The C3 rule: the linearization of `C(B1, …, BN)` is `C` followed by the merge of the bases' linearizations and the list `B1 … BN`; the merge repeatedly takes the first head that is not in the tail of any other list, and when no list has such a head, the class is refused ✅[^mro]. For the diamond `B(A)`, `C(A)`, `D(B, C)`: `L[D] = D + merge(B A O, C A O, B C)` takes `B`, skips `A` (it is in the tail of `C A O`), takes `C`, then `A`, then `object`, giving `D B C A object`, which matches `D.__mro__` ✅[^lab].
9. **`isinstance` and `issubclass`.** `isinstance(obj, cls)` is true for instances of `cls` and of its direct, indirect or virtual subclasses; `cls` may also be a tuple of classes or, since 3.10, a union such as `int | str` ✅[^functions]. A class counts as a subclass of itself ✅[^functions]. `isinstance()` is recommended over comparing `type(obj)` because it takes subclasses into account ✅[^functions].
10. **Private names are mangled, not hidden.** Nothing in Python enforces data hiding; a single leading underscore (`_spam`) marks a name as non-public by convention ✅[^tut-classes]. A name written inside a class that starts with two or more underscores and does not end with two or more is a private name, and the compiler rewrites `__spam` in class `Foo` to `_Foo__spam` ✅[^expressions]. The purpose is to avoid clashes with names that subclasses define ✅[^tut-classes]; the value stays reachable from outside, e.g. `acct._Account__balance` is `100` ✅[^lab]. Name strings passed to `getattr()`, `setattr()` and `delattr()` are not mangled ✅[^tut-classes].
11. **`classmethod`, `staticmethod`, `property`.** A `@classmethod` receives the class as its first argument, and when called through a subclass it receives the subclass ✅[^functions], which makes it the usual way to write an alternate constructor: with `from_fahrenheit(cls, f)` returning `cls((f - 32) * 5 / 9)` on a `Temperature` class, `Temperature.from_fahrenheit(212).celsius` is `100.0`, and the same call on a subclass `Kelvinish` returns a `Kelvinish` ✅[^lab]. A `@staticmethod` receives no implicit first argument ✅[^functions]. `property(fget, fset, fdel)` makes a managed attribute, and `@property` alone gives a read-only one; `@x.setter` adds the setter ✅[^functions]. How they hook into attribute lookup is in the descriptors doc.

## Worked example
A cooperative `__init__` across a diamond: each class takes its own keyword argument and passes the rest on with `super()`. Measured in the lab ✅[^lab]:

```python
class Model:
    def __init__(self, **kw):
        self.log = ["Model"]
        super().__init__(**kw)              # next in the MRO: object
class Timestamped(Model):
    def __init__(self, *, created, **kw):
        super().__init__(**kw)
        self.created = created
        self.log.append("Timestamped")
class Owned(Model):
    def __init__(self, *, owner, **kw):
        super().__init__(**kw)
        self.owner = owner
        self.log.append("Owned")
class Document(Timestamped, Owned):
    def __init__(self, *, title, **kw):
        super().__init__(**kw)
        self.title = title
        self.log.append("Document")

doc = Document(title="Q3 plan", created="2026-11-24", owner="ana")
```

| Step | What runs | Result |
|---|---|---|
| 1 | `Document.__mro__` | `Document, Timestamped, Owned, Model, object`: C3 puts the sibling `Owned` before the shared base `Model` |
| 2 | `Document.__init__` keeps `title`, `super()` | calls `Timestamped.__init__` with `created` and `owner` |
| 3 | `Timestamped.__init__` keeps `created`, `super()` | calls `Owned.__init__`, the next class in *`Document`'s* MRO, not `Model` |
| 4 | `Owned.__init__` keeps `owner`, `super()` → `Model.__init__` → `object.__init__()` | no keywords left, so `object` accepts the call |
| 5 | the `append` calls run as each call returns | `doc.log == ['Model', 'Owned', 'Timestamped', 'Document']` |
| 6 | `Document(title="x", created="y", owner="z", color="red")` | `TypeError: object.__init__() takes exactly one argument (the instance to initialize)`: the unclaimed `color` reaches `object` |
| 7 | A copy `Timestamped2` that calls `Model.__init__(self, **kw)` instead of `super()`, used in `Document2(Timestamped2, Owned)` | `Owned.__init__` never runs: without `owner`, the object has no `owner` attribute (`log` is `['Model', 'Timestamped2', 'Document2']`); with `owner`, `Model`'s `super()` hands it to `object.__init__()` and step 6's `TypeError` follows |

Step 7 is why a class that may be combined with others calls `super()` in every override instead of naming its parent.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `count = 0` in the class, `self.count += 1` in a method, called twice | `c1.count` is `2`, `Counter.count` stays `0`, `c1.__dict__` is `{'count': 2}` ✅[^lab] | The read finds the class attribute; the write goes to the instance dictionary ✅[^datamodel] |
| `tricks = []` in the class body | After `a.add_trick('roll over')` and `b.add_trick('play dead')`, `a.tricks` is `['roll over', 'play dead']` and `a.tricks is b.tricks` ✅[^lab] | One list object, stored once on the class ✅[^tut-classes] |
| `Dog.speak()` with no instance | `TypeError: Dog.speak() missing 1 required positional argument: 'self'` ✅[^lab] | Through the class, `speak` is a plain function object ✅[^tut-classes] |
| `d.speak is d.speak` | `False`, while `d.speak == d.speak` is `True` ✅[^lab] | The method object is created when the attribute is fetched ✅[^datamodel] |
| `__init__` returns `1` | `TypeError: __init__() should return None, not 'int'` ✅[^lab] | Only `None` may be returned ✅[^datamodel] |
| `Kid(Grand)`, then `class GrandKid(Grand, Kid)` | `TypeError: Cannot create a consistent method resolution order (MRO) for bases Grand, Kid` ✅[^lab]; `(Kid, Grand)` works | `Grand` must come before `Kid` (listed first) and after it (its parent) ✅[^compound] |
| `P(X, Y)`, `Q(Y, X)`, then `class R(P, Q)` | The same `TypeError`, "for bases X, Y" ✅[^lab] | `P` and `Q` disagree on the order of `X` and `Y`, so no merge exists ✅[^mro] |
| `class SubBool(bool)` | `TypeError: type 'bool' is not an acceptable base type` ✅[^lab] | Some built-in classes do not allow subclassing ✅[^compound] |
| Zero-argument `super()` in a nested function | `RuntimeError: super(): no arguments` ✅[^lab] | The zero-argument form does not work as expected in nested functions ✅[^functions] |
| Zero-argument `super()` in a generator expression | `TypeError: super(type, obj): obj (instance of range) is not an instance or subtype of type (GenExp).` ✅[^lab] | A generator expression is an implicit nested function, and the zero-argument form takes the first argument of the immediately enclosing function ✅[^functions] |
| `acct.__balance` outside the class | `AttributeError: 'Account' object has no attribute '__balance'`; `acct.__dict__` holds `'_Account__balance': 100` ✅[^lab] | The name was transformed before code was generated for the class ✅[^expressions] |
| `getattr(acct, "__balance", "missing")` | `'missing'` ✅[^lab] | Strings passed to `getattr()` are not mangled ✅[^tut-classes] |
| `self.__dunder__ = ...` | Stored unmangled as `__dunder__` ✅[^lab] | Names ending in two underscores are not private names ✅[^expressions] |
| `type(True) is int` | `False`, while `isinstance(True, int)` is `True` ✅[^lab] | `bool` is a subclass of `int` ✅[^tut-classes] |
| Assigning to a `@property` that has no setter | `AttributeError: property 'x' of 'ReadOnly' object has no setter` ✅[^lab] | `@property` alone makes a read-only attribute ✅[^functions] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `super().method(...)` | The parent is not named, and cooperative multiple inheritance works ✅[^functions] | Every class in the chain has to call it (Worked example step 7), and good design gives every implementation one calling signature ✅[^functions]; the class reached is decided at runtime by the final MRO and can be a sibling unknown to the author ✅[^functions] |
| `Base.method(self, ...)` | The target is explicit ✅[^tut-classes] | Works only while the base is reachable by that name ✅[^tut-classes]; in a diamond it skips siblings (Worked example step 7) |
| `_name` attribute | Signals "internal" with no runtime effect ✅[^tut-classes] | Nothing stops callers from using it |
| `__name` attribute | Subclasses cannot clash with it by accident ✅[^tut-classes] | Awkward to reach in tests and debuggers (`obj._Class__name`); `getattr()` strings are not mangled |
| Class attribute as a default | One shared value, overridable per instance ✅[^compound] | A mutable value is shared by all instances ✅[^compound] |

## Takeaways
- Create mutable per-object state in `__init__` (`self.items = []`), never in the class body. [rule-candidate]
- In classes meant to be combined by multiple inheritance, call `super()` in every overriding method, accept `**kwargs` and consume only your own arguments. [rule-candidate]
- When a `super()` call surprises you, print `type(self).__mro__`: the next class may be a sibling.
- List bases from most specific to most general; a base listed before its own subclass makes the MRO impossible.
- Test types with `isinstance()`, not `type(x) is C`. [rule-candidate]
- Use `_name` for internal attributes; keep `__name` for avoiding clashes with subclasses.

## Verification status
- Verified: 81 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [9. Classes](https://docs.python.org/3/tutorial/classes.html) — Python Software Foundation, living. Rank 1. Backs: `__init__` on instantiation; bound method attributes; `self` as convention; the shared mutable class attribute; inheritance, overriding, virtual methods, explicit base calls; MRO properties; the `_spam` convention, the purpose of mangling, unmangled `getattr()` strings; `bool` as a subclass of `int`. [^tut-classes]
- [8. Compound statements: Class definitions](https://docs.python.org/3/reference/compound_stmts.html#class-definitions) — Python Software Foundation, living. Rank 1. Backs: the class body runs in a new frame, the class object and name binding, `object` as default base, attribute order; class vs instance attributes and mutable defaults; MRO consistency rules and the `bool` subclassing error. [^compound]
- [3. Data model](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: class and instance namespaces and the mapping proxy; instance method objects; `__init__` must return `None` and must call the base `__init__`; `__mro__`; the `__class__` cell used by zero-argument `super()`. [^datamodel]
- [6. Expressions: Private name mangling](https://docs.python.org/3/reference/expressions.html#private-name-mangling) — Python Software Foundation, living. Rank 1. Backs: which names are private and how they are transformed. [^expressions]
- [Built-in functions](https://docs.python.org/3/library/functions.html) — Python Software Foundation, living. Rank 1. Backs: `super()` forms, uses and limits; `isinstance()`, `issubclass()`, union arguments since 3.10; `isinstance()` preferred over `type()`; `classmethod`, `staticmethod`, `property`. [^functions]
- [The Python 2.3 Method Resolution Order](https://docs.python.org/3/howto/mro.html) — Python Software Foundation, living. Rank 1. Backs: the C3 linearization and merge rule; refusing classes whose bases disagree on order. [^mro]

## Related
- `python/metaprogramming/descriptors-and-attribute-lookup.md` — how functions become bound methods, and what `property`, `classmethod` and `staticmethod` do during lookup.
- `python/classes/data-model-special-methods.md` — `__new__`, operators, comparisons, hashing and container protocols.
- `python/classes/dataclasses-enums-and-abcs.md` — generated record classes, enums and abstract interfaces.
- `python/metaprogramming/metaclasses-and-class-creation.md` — what runs when the class object is built.
- `python/fundamentals/objects-names-and-types.md` — identity and mutability, the basis of the shared-class-attribute pitfall.
