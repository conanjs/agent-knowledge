---
schema: knowledge-doc/v1
type: concept
topic: python/metaprogramming
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, descriptors, attribute-lookup, getattr, getattribute, property, classmethod, staticmethod, bound-method, slots, set-name, vars]
ranked-sources: true
---

# Descriptors and the attribute lookup order

## Summary
**TL;DR:** A descriptor is an object stored on a class that defines `__get__`, `__set__` or `__delete__`; when `obj.name` finds one, Python calls its method instead of returning it. Reading `obj.name` checks, in order: a data descriptor (one with `__set__` or `__delete__`) on the type, then the instance `__dict__`, then a non-data descriptor or plain class attribute, and only after an `AttributeError` the class's `__getattr__`. Functions are non-data descriptors, which is how `obj.method` becomes a bound method; `property` is a data descriptor, which is why an instance cannot shadow it.
**Use this when:** an attribute returns something other than what you stored, `obj.x = ...` raises "has no setter", `__getattr__` runs (or does not) unexpectedly, a method is shadowed by an instance attribute, or a `__slots__` class rejects an attribute.
**Not this doc:** classes, instances and inheritance basics → `python/classes/classes-instances-and-inheritance.md`; the other special methods → `python/classes/data-model-special-methods.md`; how a class object is built → `python/metaprogramming/metaclasses-and-class-creation.md`; `functools.cached_property` and decorators → `python/iteration-and-functional/decorators-and-functools.md`.

## Problem
Attribute access looks like a dictionary read, but several rules interleave:
- `obj.f = lambda: 0` silently replaces a method for that one object, while `obj.x = 1` on a property raises `AttributeError: property 'x' of 'P' object has no setter` ✅[^lab].
- `__getattr__` is not called for attributes that exist, yet it is called when a property's getter raises `AttributeError` ✅[^datamodel], so a typo inside the getter is silently hidden ✅[^lab].
- `obj.f is obj.f` is `False`, because each access builds a new bound method ✅[^lab].
- A class with `__slots__` refuses new attributes, breaks `vars()` and weak references, and rejects a class-level default for a slot name ✅[^lab].

All of this follows from one lookup algorithm and one small protocol.

## Mental model
**Analogy:** asking an office for a document called `name`. The clerk first checks the company rulebook (the class and its parents). A rulebook entry stamped "always handled by a manager" (a data descriptor) is answered by that manager, even if your personal folder holds a copy. Otherwise the clerk opens your personal folder (the instance `__dict__`). Only if the folder has nothing does an ordinary rulebook entry answer: a "helper" entry runs its routine (a non-data descriptor such as a function), a plain notice is handed over as is (a class attribute). If nothing answers, you are sent to the help desk (`__getattr__`).

**Artifact** (measured in the lab ✅[^lab]):
```python
class Data:                                      # has __set__: a data descriptor
    def __get__(self, obj, owner=None): return "data.__get__"
    def __set__(self, obj, value): print("data.__set__", value)
class NonData:                                   # only __get__: a non-data descriptor
    def __get__(self, obj, owner=None): return "nondata.__get__"
class C:
    d = Data(); n = NonData(); plain = "class attr"
    def __getattr__(self, name): return f"__getattr__({name!r})"

c = C()
c.__dict__.update(d="inst d", n="inst n", plain="inst plain")
c.d, c.n, c.plain, c.missing   # ('data.__get__', 'inst n', 'inst plain', "__getattr__('missing')")
del c.__dict__["n"], c.__dict__["plain"]
c.n, c.plain                   # ('nondata.__get__', 'class attr')
c.d = 5                        # prints: data.__set__ 5
vars(c)                        # {'d': 'inst d'}   (the instance dict was not touched)
```

## How it works
1. **The protocol.** A descriptor defines any of `__get__(self, instance, owner=None)`, `__set__(self, instance, value)` and `__delete__(self, instance)`; it only acts when it sits in the owner class's dictionary or a parent's ✅[^datamodel]. `__get__` receives the instance, or `None` when the attribute is read through the class ✅[^datamodel]. The glossary calls descriptors the basis of functions, methods, properties, class methods, static methods and `super()` ✅[^glossary].
2. **Data versus non-data.** Defining `__set__` or `__delete__` makes a data descriptor; defining only `__get__` makes a non-data descriptor ✅[^descr-guide]. A data descriptor wins over an instance-dictionary entry of the same name; an instance-dictionary entry wins over a non-data descriptor ✅[^descr-guide]. A read-only data descriptor defines `__set__` and makes it raise `AttributeError` ✅[^descr-guide].
3. **Reading `obj.name`: `object.__getattribute__`.** The Descriptor Guide's pure-Python equivalent does this ✅[^descr-guide]:
   1. Search `type(obj).__mro__` (MRO = method resolution order, the list of the class and its parents in lookup order) for `name` in each class's `__dict__`; call the hit `cls_var`.
   2. If the *type* of `cls_var` has `__get__` and also `__set__` or `__delete__`, return `cls_var.__get__(obj, type(obj))`.
   3. Else, if `name` is in `vars(obj)`, return that value.
   4. Else, if the type of `cls_var` has `__get__` (a non-data descriptor), return `cls_var.__get__(obj, type(obj))`.
   5. Else, if `cls_var` was found, return it unchanged; otherwise raise `AttributeError`.

   `__getattr__` is not part of this method: the dot operator and `getattr()` call it when `__getattribute__` raises `AttributeError`, so calling `object.__getattribute__` or `super().__getattribute__` directly skips it ✅[^descr-guide].
4. **Reading `Cls.name`: `type.__getattribute__`.** The steps are the same, except the instance-dictionary check is replaced by a search through the class's MRO, and a descriptor is called as `desc.__get__(None, Cls)` ✅[^descr-guide]. In the lab, `C.d` and `C.n` on the artifact's class both returned their `__get__` result ✅[^lab]. Assigning `Cls.name = v` updates that class's own dictionary, never a base class's ✅[^datamodel].
5. **Functions are non-data descriptors.** A function's `__get__` returns the function itself when `obj` is `None` and otherwise a bound method, a small `types.MethodType` object that pairs the function with the instance ✅[^descr-guide]. The bound method keeps the function in `__func__` and the instance in `__self__`, and calling it prepends the instance to the arguments ✅[^descr-guide]. In the lab, `D.__dict__['f']` and `D.f` were both `function`, `d.f` was `method`, `d.f.__self__ is d` was `True`, and `d.f is d.f` was `False` while `d.f == d.f` was `True` ✅[^lab].
6. **`property`, `classmethod`, `staticmethod`.** `property` is a data descriptor, so instances cannot override it; methods, including those decorated with `@staticmethod` and `@classmethod`, are non-data descriptors, so instances can ✅[^datamodel]. A `staticmethod` returns the plain function from both `obj.f` and `Cls.f`; a `classmethod` binds the class (`type(obj)` when called on an instance), giving `f(cls, *args)` ✅[^descr-guide]. Called on a subclass, the subclass is passed ✅[^functions]. Since 3.13, `classmethod` can no longer wrap other descriptors such as `property` ✅[^functions]. The Guide's pure-Python `Property` keeps `fget`/`fset`/`fdel`, returns itself when `obj` is `None`, and raises `AttributeError` when the needed function is missing ✅[^descr-guide].
7. **`__set_name__(self, owner, name)`.** `type.__new__` scans the new class's namespace and calls this hook on each attribute that defines it, so a descriptor learns the name it was assigned to ✅[^datamodel]. A descriptor attached after the class exists is not notified; call the hook by hand ✅[^datamodel].
8. **`__slots__`.** Listing names in `__slots__` reserves space for them and stops the automatic per-instance `__dict__` and `__weakref__` ✅[^datamodel]. Each slot becomes a descriptor on the class, of type `types.MemberDescriptorType` in CPython ✅[^types]. An unlisted name raises `AttributeError`; add `'__dict__'` or `'__weakref__'` to the list to get them back ✅[^datamodel]. A subclass without its own `__slots__` gets a `__dict__` again ✅[^datamodel]. What's New 3.15 says `__dict__` and `__weakref__` may now be listed for any class, and a `tuple` subclass (including one made by `collections.namedtuple()`) may define any slots ✅[^whatsnew315]; one combination still fails (Edge cases).
9. **Writing and deleting.** A class's `__setattr__` is called for `obj.name = v` instead of the normal mechanism (storing into the instance dictionary); an override that wants to store should call `object.__setattr__(self, name, value)` ✅[^datamodel]. The default path still lets a data descriptor's `__set__` intercept the write ✅[^lab]. `__delattr__` is the same for `del obj.name` ✅[^datamodel].
10. **Introspection helpers.** `getattr(obj, name, default)` returns `default` when the attribute does not exist ✅[^functions]. `hasattr` calls `getattr` and checks for `AttributeError` ✅[^functions], so any other exception propagates: a property raising `ValueError` made `hasattr` raise `ValueError` ✅[^lab]. `vars(obj)` returns `obj.__dict__`; a class's is a read-only `types.MappingProxyType`; and an object without `__dict__` (a slotted instance) raises `TypeError` ✅[^functions].

## Worked example
A validating data descriptor that stores each value in the instance dictionary under its own name, which works because a data descriptor outranks the instance dictionary (How it works 2). Every row ran in the lab ✅[^lab]:

```python
class Positive:
    def __set_name__(self, owner, name): self.name = name
    def __get__(self, obj, owner=None):
        return self if obj is None else obj.__dict__[self.name]
    def __set__(self, obj, value):
        if value <= 0: raise ValueError(f"{self.name} must be > 0, got {value}")
        obj.__dict__[self.name] = value

class Order:
    qty = Positive(); price = Positive()
    def __init__(self, qty, price): self.qty = qty; self.price = price
    def total(self): return self.qty * self.price
```

| Step | Code | Result | Which rule answered |
|---|---|---|---|
| 1 | `Order.__dict__["qty"].name` | `'qty'` | `__set_name__` ran when `class Order` finished |
| 2 | `o = Order(3, 250); vars(o)` | `{'qty': 3, 'price': 250}` | `self.qty = 3` went through `Positive.__set__` |
| 3 | `o.qty` | `3` | data descriptor found first; `__get__` read `o.__dict__` |
| 4 | `o.qty = 0` | `ValueError: qty must be > 0, got 0` | `__set__` intercepts every write |
| 5 | `type(Order.qty).__name__` | `'Positive'` | class access passes `obj=None`; `__get__` returns the descriptor |
| 6 | `type(o.total).__name__`, `o.total()` | `'method'`, `750` | the function's `__get__` bound `o` |
| 7 | `o.total = lambda: 0; o.total()` | `0` | instance dict beats a non-data descriptor |
| 8 | `del o.total; o.total()` | `750` | the class's function is visible again |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A property getter has a typo (`self.itemz`) and the class defines `__getattr__` | `__getattr__` runs twice (`'itemz'`, then `'total'`) and its fallback hides the bug; `G().total` returned `0` ✅[^lab] | `__getattr__` also runs when a property's `__get__` raises `AttributeError` ✅[^datamodel] |
| `__getattribute__` that reads `self.__dict__` | `RecursionError: maximum recursion depth exceeded` ✅[^lab] | Every `self.x` inside it calls it again; use `object.__getattribute__(self, name)` ✅[^datamodel] |
| `c.__len__ = lambda: 5`, then `len(c)` | `TypeError: object of type 'L' has no len()` ✅[^lab] | Implicit special-method lookup uses the type and bypasses the instance dict and even `__getattribute__` ✅[^datamodel]; the special-method side is in `python/classes/data-model-special-methods.md` |
| `__slots__ = ("x",)` plus `x = 0` in the class body | `ValueError: 'x' in __slots__ conflicts with class variable` ✅[^lab] | The slot is a class-level descriptor; a class attribute would overwrite it ✅[^datamodel] |
| `vars()` or `weakref.ref()` on a slotted instance | `TypeError: vars() argument must have __dict__ attribute`; `TypeError: cannot create weak reference to 'V' object` ✅[^lab] | No `__dict__` or `__weakref__` unless listed ✅[^datamodel] |
| `functools.cached_property` on a class with `__slots__ = ()` | `TypeError: No '__dict__' attribute on 'CP' instance to cache 'pi' property.` ✅[^lab] | It needs an instance dictionary ✅[^descr-guide] |
| Two slotted parents with non-empty slots | `TypeError: multiple bases have instance lay-out conflict` ✅[^lab] | Only one parent may have slot-created attributes ✅[^datamodel] |
| `__slots__ = ("u",)` on an `int` subclass | `TypeError: arbitrary __slots__ not supported for subtype of 'int'`; `("__weakref__",)` on `int` and `("__dict__",)` on `bytes` worked ✅[^lab] | Variable-length built-ins accept only `__dict__` and `__weakref__` slots, `tuple` excepted ✅[^datamodel] |
| `__slots__ = ("__dict__",)` on a subclass of a class that already has a `__dict__` | Still `TypeError: __dict__ slot disallowed: we already got one` in 3.15.2 ✅[^lab] | The 3.15 change widened which classes may list it ✅[^whatsnew315], but this case stays an error |
| Two unrelated classes' `__dict__` descriptors | `Q1.__dict__['__dict__'] is Q2.__dict__['__dict__']` was `True` ✅[^lab] | Since 3.15 one shared instance per interpreter ✅[^whatsnew315] |
| `getattr(obj, "__secret")` for a `self.__secret` attribute | Not found; `getattr(obj, "_M__secret")` works ✅[^lab] | Name mangling happens at compile time, so mangle by hand ✅[^functions] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `property` | One-off computed or validated attribute; read-only unless a setter is added ✅[^functions] | Repeated per attribute; logic cannot be reused across classes |
| Custom descriptor with `__set_name__` | One validator reused across fields and classes | More protocol to get right (`obj is None`, where to store) |
| `__getattr__` | Fallback only for missing names; normal attributes stay fast ✅[^datamodel] | Also swallows `AttributeError` from properties (Edge cases) |
| `__getattribute__` | Total control of every read | Runs on every access; recursion risk; skipped for implicit special methods ✅[^datamodel] |
| `__slots__` | Typo-proof attributes; can save significant space and speed up attribute lookup ✅[^datamodel] | No ad-hoc attributes, no `vars()`, no weak references or `cached_property` unless planned for |

## Takeaways
- Remember the order: data descriptor, instance `__dict__`, non-data descriptor or class attribute, then `__getattr__` ✅[^descr-guide].
- Use `property` for a single managed attribute and a descriptor with `__set_name__` when the same rule repeats across fields. [rule-candidate]
- Inside `__getattribute__` or `__setattr__`, reach attributes through `object.__getattribute__` / `object.__setattr__`, never `self.x`. [rule-candidate]
- Keep property getters free of `AttributeError` when the class defines `__getattr__`, or the fallback hides the error. [rule-candidate]
- Put special methods on the class, not on instances; implicit calls ignore instance attributes ✅[^datamodel].
- Add `'__weakref__'` (and `'__dict__'` if needed) to `__slots__` when weak references or dynamic attributes are required.

## Verification status
- Verified: 68 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Data model: Customizing attribute access, Implementing and Invoking Descriptors, __slots__, Special method lookup](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: the descriptor methods and where they must live; `__getattr__`, `__getattribute__`, `__setattr__`, `__delattr__`; property as data descriptor and methods as non-data descriptors; `__set_name__`; the `__slots__` notes; class assignment updates only that class; special-method lookup. [^datamodel]
- [Descriptor Guide](https://docs.python.org/3/howto/descriptor.html) — Python Software Foundation, living. Rank 1. Backs: data versus non-data precedence; the pure-Python `object.__getattribute__` and `__getattr__` hook; class and instance invocation; functions, `MethodType`, static and class methods; `Property`; `cached_property` needing `__dict__`. [^descr-guide]
- [Built-in functions](https://docs.python.org/3/library/functions.html) — Python Software Foundation, living. Rank 1. Backs: `getattr` default and name mangling, `hasattr`, `vars`, `classmethod` on subclasses and the 3.13 removal of descriptor wrapping. [^functions]
- [types — Dynamic type creation and names for built-in types](https://docs.python.org/3/library/types.html) — Python Software Foundation, living. Rank 1. Backs: `MemberDescriptorType` for slots. [^types]
- [Glossary: descriptor](https://docs.python.org/3/glossary.html) — Python Software Foundation, living. Rank 1. Backs: descriptors underlie methods, properties and `super()`. [^glossary]
- [What's new in Python 3.15](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: `__dict__`/`__weakref__` slots for any class, any slots on `tuple` subclasses, shared `__dict__`/`__weakref__` descriptors. [^whatsnew315]

## Related
- `python/classes/classes-instances-and-inheritance.md` — classes, instances and the MRO that the lookup walks.
- `python/metaprogramming/metaclasses-and-class-creation.md` — when `__set_name__` runs during class creation.
- `python/classes/data-model-special-methods.md` — the special methods whose implicit lookup skips instances.
- `python/iteration-and-functional/decorators-and-functools.md` — `functools.cached_property` and other decorators built on descriptors.
- `python/runtime/memory-management-and-garbage-collection.md` — weak references, which `__slots__` disables by default.
