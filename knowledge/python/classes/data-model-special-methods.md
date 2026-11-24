---
schema: knowledge-doc/v1
type: concept
topic: python/classes
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, data-model, special-methods, dunder, operator-overloading, notimplemented, rich-comparison, hash, eq, repr, format, container-protocol, total-ordering]
ranked-sources: true
---

# Special methods and the Python data model

## Summary
**TL;DR:** Operators and built-in functions call special ("dunder") methods such as `__add__`, `__len__` and `__eq__`, and Python looks them up on the object's type, never in the instance. A binary operator asks the left operand first; if it answers `NotImplemented`, Python tries the right operand's reflected method (`__radd__` for `+`, `__gt__` for `<`), and only then raises `TypeError`. Defining `__eq__` without `__hash__` makes instances unhashable, and any `__hash__` you write must give equal objects equal hashes.
**Use this when:** making a class work with `+`, `+=`, `==`, `<`, `sorted()`, `sum()`, `len()`, `in`, `obj[key]`, `f"{obj:>10}"`, sets or dict keys; or when an operator fails with `unsupported operand type(s)` or `unhashable type`.
**Not this doc:** classes, `__init__`, inheritance, `super()` → `python/classes/classes-instances-and-inheritance.md`; `__init_subclass__` and class creation → `python/metaprogramming/metaclasses-and-class-creation.md`; `__getattr__` and descriptors → `python/metaprogramming/descriptors-and-attribute-lookup.md`; `__del__` → `python/runtime/memory-management-and-garbage-collection.md`; `__enter__`/`__exit__` → `python/errors-and-resources/context-managers-and-file-io.md`; writing `__iter__` and `__next__` → `python/iteration-and-functional/iterators-generators-and-itertools.md`; the full truthiness rules → `python/fundamentals/objects-names-and-types.md`.

## Problem
- `c.__len__ = lambda: 5` followed by `len(c)` raises `TypeError`.
- `V(1) + 2` works, but `2 + V(1)` and `sum([V(1), V(2)])` raise `TypeError: unsupported operand type(s) for +: 'int' and 'V'`.
- Adding an `__eq__` to a class makes `{obj}` fail with `unhashable type`.
- An `__eq__` that returns `False` or raises for unknown types stops the other operand from answering.
- Writing six comparison methods by hand is tedious, and inconsistent sets of them sort wrongly.

All five come from a small set of lookup and fallback rules in the data model.

## Mental model
**Analogy:** an operator is a phone call to the operand's *type* at a fixed extension: `+` dials `__add__`, `len()` dials `__len__`. Notes stuck on the object itself (instance attributes) are ignored. If the left operand's type answers "not my job" (`NotImplemented`), the operator calls the right operand's type at the mirrored extension (`__radd__`). Only when both decline does Python give up.

**Artifact** (measured in the lab ✅[^lab]):
```python
class C: pass
c = C()
c.__len__ = lambda: 5
len(c)              # TypeError: object of type 'C' has no len()
c.__len__()         # 5    an explicit call does find the instance attribute
C.__len__ = lambda self: 7
len(c)              # 7    the implicit call looks at type(c)
```

How `x + y` is dispatched:
```
x + y
 └─▶ type(x).__add__(x, y) ── a value ──▶ result
        │ NotImplemented or missing, and type(y) is not type(x)
        ▼
     type(y).__radd__(y, x) ── a value ──▶ result
        │ NotImplemented or missing
        ▼
     TypeError: unsupported operand type(s) for +
(if type(y) is a subclass of type(x) with its own __radd__, that call goes first)
```

## How it works
### Lookup and construction
1. **Special methods are found on the type.** A special method is one Python calls implicitly to perform an operation on a type; its name starts and ends with double underscores, hence "dunder" ✅[^glossary]. `x[i]` is roughly `type(x).__getitem__(x, i)` ✅[^datamodel]. Implicit calls are only guaranteed to work when the method is defined on the type, not in the instance dictionary, and they generally bypass `__getattribute__` as well ✅[^datamodel]. Setting a special method to `None` marks the operation as unavailable: with `__iter__ = None`, `iter()` raises `TypeError` without falling back to `__getitem__` ✅[^datamodel].
2. **`__new__` creates, `__init__` customises.** `__new__(cls, ...)` is a static method (special-cased, no decorator needed) that returns the new object, typically via `super().__new__(cls)`; if it returns an instance of `cls`, `__init__` runs next with the same arguments, otherwise `__init__` is skipped ✅[^datamodel]. Its main use is subclassing immutable types such as `int`, `str` or `tuple` ✅[^datamodel]: a `str` subclass whose `__new__` upper-cases its argument gives `'ABC'` for `"abc"`, while the same code in `__init__` is too late and the value stays `'abc'` ✅[^lab].

### Text forms
3. **`__repr__`, `__str__`, `__format__`.** `repr()` calls `__repr__`, which should if possible look like an expression that recreates the object, or else `<...some useful description...>`, and must return a `str` ✅[^datamodel]. `str()`, `print()` and the default `__format__` call `__str__`, and the default `__str__` calls `__repr__`, so a class that defines only `__repr__` uses it everywhere ✅[^datamodel]. `format()`, f-strings and `str.format()` call `__format__(format_spec)`; the inherited `object.__format__` raises `TypeError` for any non-empty spec ✅[^datamodel], with the message `unsupported format string passed to Plain.__format__` ✅[^lab].

### Comparisons and arithmetic
4. **Rich comparisons.** `x<y` calls `x.__lt__(y)`, and `<=`, `==`, `!=`, `>`, `>=` call `__le__`, `__eq__`, `__ne__`, `__gt__`, `__ge__`; a method returns `NotImplemented` when it does not handle the pair ✅[^datamodel]. There are no swapped-argument versions: `__lt__` and `__gt__` reflect each other, `__le__` and `__ge__` too, and `__eq__` and `__ne__` are their own reflection; when the right operand's type is a subclass of the left's, its reflected method has priority ✅[^datamodel]. If every candidate returns `NotImplemented`, `==` and `!=` fall back to `is` and `is not` ✅[^datamodel], and an order comparison raises `TypeError` ✅[^lab]. By default `__ne__` inverts the result of `__eq__`; no other relation is implied, so `x<y or x==y` does not give you `x<=y` ✅[^datamodel].
5. **Binary arithmetic.** `x + y` calls `type(x).__add__(x, y)`, which should return `NotImplemented` for an operand it cannot handle ✅[^datamodel]. Then `type(y).__radd__(y, x)` is tried, but only when the operands have different types; for two operands of the same type a failed `__add__` is taken to mean "not supported" and no reflected call is made ✅[^datamodel]. When the right operand's type is a subclass of the left's and provides its own reflected method, that method is called *before* the left operand's `__add__` ✅[^datamodel]. `sum()` adds the items to its start value `0` from left to right ✅[^functions], so the first step is `0 + item`, which needs the item's `__radd__`.
6. **Augmented assignment.** `x += y` is `x = x.__iadd__(y)`; `__iadd__` should modify `self` in place and return the result, which may be `self` ✅[^datamodel]. If `__iadd__` is missing or returns `NotImplemented`, `x.__add__(y)` and `y.__radd__(x)` are tried as for `x + y` ✅[^datamodel], and `x` is then bound to a new object ✅[^lab].

### Hashing and truth
7. **The hash invariant.** `hash()` and the hashed collections (`set`, `frozenset`, `dict`, `frozendict`) call `__hash__`, which should return an integer; the only required property is that objects which compare equal have the same hash, and the advice is to hash a tuple of the fields that take part in comparison ✅[^datamodel]. A class that overrides `__eq__` and does not define `__hash__` gets `__hash__` set to `None`: hashing an instance raises `TypeError`, and `isinstance(obj, collections.abc.Hashable)` is false ✅[^datamodel]. A class with mutable instances that implements `__eq__` should not implement `__hash__`, because a key whose hash changes sits in the wrong hash bucket ✅[^datamodel]. To keep a parent's hash while overriding `__eq__`, write `__hash__ = Parent.__hash__` ✅[^datamodel]. How hash tables use the hash: `algorithms/data-structures/hash-tables.md`.
8. **`__bool__`, then `__len__`.** Truth testing calls `__bool__`, which should return `False` or `True`; if it is not defined, `__len__` is called and a nonzero result counts as true; with neither, every instance is true ✅[^datamodel].

### Containers and calls
9. **The container methods.** `len()` calls `__len__`, which should return an integer `>= 0` ✅[^datamodel]. `obj[key]` calls `__getitem__`, which should raise `TypeError` for a key of the wrong type and `IndexError` (sequences) or `KeyError` (mappings) for a missing one; slicing passes a `slice` object, so `a[1:2]` hands `__getitem__` the value `slice(1, 2, None)` ✅[^datamodel]. `obj[key] = v` calls `__setitem__` and `del obj[key]` calls `__delitem__` ✅[^datamodel].
10. **Fallbacks for `iter()`, `in` and `reversed()`.** `iter(obj)` uses `__iter__`, or else the sequence protocol: `__getitem__` with integers starting at `0` ✅[^functions], where an `IndexError` marks the end ✅[^datamodel]. `x in obj` calls `__contains__`; without it, Python iterates with `__iter__`; without that, it tries `obj[0]`, `obj[1]`, … until `IndexError` ✅[^expressions]. `reversed()` uses `__reversed__`, or else `__len__` and `__getitem__` ✅[^datamodel].
11. **`__missing__` is a `dict`-subclass hook.** `dict.__getitem__` calls it when a key is absent in a subclass of `dict` ✅[^datamodel]; only `d[key]` invokes it, not `get()` or `in` ✅[^stdtypes].
12. **`__call__` makes instances callable.** `x(a, b)` becomes `type(x).__call__(x, a, b)` ✅[^datamodel].
13. **`functools.total_ordering` fills in the rest.** Given a class that defines one of `__lt__`, `__le__`, `__gt__` or `__ge__` and should also supply `__eq__`, this class decorator supplies the remaining ordering methods ✅[^functools]. The generated methods run slower and give deeper stack traces than hand-written ones, and the decorator never replaces a comparison already defined in the class or a superclass ✅[^functools].

## Worked example
A `Money` value type that supports printing, formatting, equality, hashing, ordering and `sum()`. Every value below was measured in the lab ✅[^lab]:

```python
@functools.total_ordering
class Money:
    def __init__(self, cents, currency="EUR"):
        self.cents, self.currency = cents, currency
    def __repr__(self):
        return f"Money({self.cents}, {self.currency!r})"
    def __str__(self):
        units, rest = divmod(self.cents, 100)
        return f"{units}.{rest:02d} {self.currency}"
    def __format__(self, spec):
        return format(str(self), spec)          # reuse str's alignment rules
    def _key(self):
        return (self.cents, self.currency)
    def __eq__(self, other):
        if not isinstance(other, Money):
            return NotImplemented
        return self._key() == other._key()
    def __hash__(self):
        return hash(self._key())               # same fields as __eq__
    def __lt__(self, other):
        if not isinstance(other, Money) or other.currency != self.currency:
            return NotImplemented
        return self.cents < other.cents
    def __add__(self, other):
        if isinstance(other, Money) and other.currency == self.currency:
            return Money(self.cents + other.cents, self.currency)
        return NotImplemented
    def __radd__(self, other):
        if other == 0:                         # sum() starts from 0
            return self
        return NotImplemented
    def __bool__(self):
        return self.cents != 0

lunch, taxi = Money(1250), Money(990)
```

| # | Expression | Result | Method that answered |
|---|---|---|---|
| 1 | `repr(lunch)` | `Money(1250, 'EUR')` | `__repr__` |
| 2 | `print(lunch)` | `12.50 EUR` | `__str__` |
| 3 | `f"[{lunch:>12}]"` | `[   12.50 EUR]` | `__format__`, delegating to `str` |
| 4 | `lunch == Money(1250)`, `lunch == 1250` | `True`, `False` | `__eq__`; for `1250` both sides return `NotImplemented`, so identity decides |
| 5 | `len({lunch, Money(1250), taxi})` | `2` | `__hash__` plus `__eq__` |
| 6 | `sum([lunch, taxi])` | `22.40 EUR` | `int.__add__(0, lunch)` declines, `lunch.__radd__(0)` returns `lunch`, then `__add__` |
| 7 | `sorted([lunch, taxi, Money(5)])` | `[Money(5, 'EUR'), Money(990, 'EUR'), Money(1250, 'EUR')]` | `__lt__` |
| 8 | `lunch >= taxi` | `True` | `__ge__` generated by `total_ordering` |
| 9 | `bool(Money(0))`, `bool(taxi)` | `False`, `True` | `__bool__` |
| 10 | `lunch + Money(100, "USD")` | `TypeError: unsupported operand type(s) for +: 'Money' and 'Money'` | same type: no reflected call after `NotImplemented` |
| 11 | `lunch < Money(100, "USD")` | `TypeError: '<' not supported between instances of 'Money' and 'Money'` | `__lt__` and reflected `__gt__` both decline |
| 12 | `total = Money(0); total += lunch` | `12.50 EUR`, a new object | no `__iadd__`, so `__add__` is used |
| 13 | `{lunch: "lunch"}[Money(1250, "EUR")]` | `'lunch'` | equal objects, equal hashes |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `__eq__` that always returns `NotImplemented` | `Neither() == Neither()` is `False`; `n == n` is `True`; `n != n` is `False` ✅[^lab] | Both sides declined, so `==` falls back to identity ✅[^datamodel] |
| `L(1) < R(2)`, where `L.__lt__` returns `NotImplemented` and `R` defines `__gt__` | `True`; the trace shows `L.__lt__` then `R.__gt__` ✅[^lab] | `__gt__` is the reflection of `__lt__` ✅[^datamodel] |
| `Base() == Derived()`, both defining `__eq__` | Only `Derived.__eq__` runs ✅[^lab] | The right operand's subclass gets priority ✅[^datamodel] |
| `Same() < Same()` vs `SameAdd() + SameAdd()`, every method returning `NotImplemented` | The comparison tried `__lt__` then `__gt__`; the addition tried only `__add__` ✅[^lab] | The "same type, no reflected call" rule is stated for the arithmetic methods ✅[^datamodel]; comparisons have no such exception, so the reflected method is the fallback even within one type |
| `2 + V(1)` where `V` has only `__add__` | `TypeError: unsupported operand type(s) for +: 'int' and 'V'` ✅[^lab] | `int` declines and `V` has no `__radd__` ✅[^datamodel] |
| `__iadd__` that forgets `return self` | After `f += 1`, `f` is `None` ✅[^lab] | `x += y` assigns the return value: `x = x.__iadd__(y)` ✅[^datamodel] |
| `t = (["foo"], "bar")`; `t[0] += ["item"]` | `TypeError: 'tuple' object does not support item assignment`, yet `t` is now `(['foo', 'item'], 'bar')` ✅[^lab] | The list's `__iadd__` extends the list, then the assignment back into the tuple fails ✅[^faq] |
| `__eq__` without `__hash__`, then `{P(1)}` | `TypeError: cannot use 'P' as a set element (unhashable type: 'P')` ✅[^lab]; this wording is new in 3.14 ✅[^whatsnew314] | `__hash__` was set to `None` ✅[^datamodel] |
| `__hash__` returning `id(self)` while all instances compare equal | `x1 == x2` is `True`, `x2 in [x1]` is `True`, but `x2 in {x1}` is `False` ✅[^lab] | Equal objects must have equal hashes ✅[^datamodel] |
| Changing a field used by `__hash__` after adding the object to a set | `m in s`, `Mut(1) in s` and `Mut(2) in s` are all `False` ✅[^lab] | The object sits in the bucket of its old hash ✅[^datamodel] |
| `__hash__` that raises `TypeError` | `isinstance(obj, Hashable)` is still `True` ✅[^lab] | Use `__hash__ = None` to declare a class unhashable ✅[^datamodel] |
| `__bool__` returns `1`; `__len__` returns `-1` | `TypeError: BadBool.__bool__() must return a bool, not int`; `ValueError: __len__() should return >= 0` ✅[^lab] | The return types are checked ✅[^datamodel] |
| A class with only `__getitem__` (raising `IndexError` at 4) | `list(sq)` is `[0, 1, 4, 9]` and `9 in sq` is `True`, but `isinstance(sq, Iterable)` is `False` ✅[^lab] | The `Iterable` check does not detect `__getitem__` iteration; call `iter(obj)` to test ✅[^collections-abc] |
| `reversed()` on that class | `TypeError: object of type 'Squares' has no len()` ✅[^lab] | The fallback needs both `__len__` and `__getitem__` ✅[^datamodel] |
| `dd.get('zz')` on a `dict` subclass with `__missing__` | `None`, while `dd['zz']` returns the `__missing__` value ✅[^lab] | No method other than `d[key]` calls `__missing__` ✅[^stdtypes] |
| `__repr__` returns an `int` | `TypeError: BadRepr.__repr__() must return a str, not int` ✅[^lab] | The return value must be a string ✅[^datamodel] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Return `NotImplemented` for unknown operand types | The other operand gets its turn; `==` still answers via identity ✅[^datamodel] | The resulting `TypeError` names only the operand types, not your reason ✅[^lab] |
| `@functools.total_ordering` | Write `__eq__` and one ordering method ✅[^functools] | Slower derived methods and deeper stack traces ✅[^functools] |
| All six comparison methods by hand | Faster, per the `functools` docs ✅[^functools] | More code to keep consistent |
| `__hash__` over the compared fields | Usable in sets and as dict keys | Those fields must never change while the object is stored ✅[^datamodel] |
| `__hash__ = None` for mutable value objects | Cannot be silently corrupted in a set | Instances cannot be items of hashed collections ✅[^datamodel] |

## Takeaways
- Define special methods in the class body, never by assigning them to an instance. [rule-candidate]
- Return `NotImplemented` (do not raise, do not return `False`) from operator and comparison methods for operand types you do not handle. [rule-candidate]
- Whenever you define `__eq__`, decide `__hash__` on purpose: hash the same fields `__eq__` compares if they are immutable, otherwise leave it `None`. [rule-candidate]
- Make `__iadd__` and the other in-place methods return `self`. [rule-candidate]
- Add a `__radd__` that accepts `0` when instances should work with `sum()`.
- Give every class a useful `__repr__`; add `__str__` only when end users need different text.

## Verification status
- Verified: 82 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [3. Data model: Special method names](https://docs.python.org/3/reference/datamodel.html#special-method-names) — Python Software Foundation, living. Rank 1. Backs: special method lookup on the type; setting a method to `None`; `__new__` and `__init__`; `__repr__`, `__str__`, `__format__`; rich comparisons, reflection and the identity fallback; binary, reflected and in-place arithmetic; `__hash__` rules; `__bool__`; container methods, slicing, `__reversed__`, `__missing__`; `__call__`. [^datamodel]
- [6. Expressions: Membership test operations](https://docs.python.org/3/reference/expressions.html#membership-test-operations) — Python Software Foundation, living. Rank 1. Backs: the `__contains__`, `__iter__`, `__getitem__` fallback order of `in`. [^expressions]
- [Built-in functions](https://docs.python.org/3/library/functions.html) — Python Software Foundation, living. Rank 1. Backs: `iter()` and the sequence protocol; `sum()` starting from `0`. [^functions]
- [Built-in Types: Mapping types — dict](https://docs.python.org/3/library/stdtypes.html#mapping-types-dict) — Python Software Foundation, living. Rank 1. Backs: only `d[key]` calls `__missing__`. [^stdtypes]
- [functools: total_ordering](https://docs.python.org/3/library/functools.html#functools.total_ordering) — Python Software Foundation, living. Rank 1. Backs: what the decorator needs, generates and costs. [^functools]
- [collections.abc — Abstract Base Classes for Containers](https://docs.python.org/3/library/collections.abc.html) — Python Software Foundation, living. Rank 1. Backs: `isinstance(obj, Iterable)` misses `__getitem__` iteration. [^collections-abc]
- [Programming FAQ: Why does a_tuple[i] += ['item'] raise an exception when the addition works?](https://docs.python.org/3/faq/programming.html) — Python Software Foundation, living. Rank 1. Backs: the tuple item `+=` case. [^faq]
- [What's new in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, living. Rank 1. Backs: the improved unhashable-type error message. [^whatsnew314]
- [Glossary](https://docs.python.org/3/glossary.html) — Python Software Foundation, living. Rank 1. Backs: "special method" and "dunder". [^glossary]

## Related
- `python/classes/classes-instances-and-inheritance.md` — classes, `__init__`, inheritance and `super()`, used by `__new__` and reflected operators.
- `python/classes/dataclasses-enums-and-abcs.md` — `@dataclass` generates `__init__`, `__repr__`, `__eq__` and `__hash__` from fields.
- `python/metaprogramming/descriptors-and-attribute-lookup.md` — `__getattr__`, `__getattribute__` and descriptors.
- `python/iteration-and-functional/iterators-generators-and-itertools.md` — writing `__iter__` and `__next__`.
- `python/data-structures/dicts-sets-and-hashing.md` — how sets and dicts use `__hash__` and `__eq__`.
- `algorithms/data-structures/hash-tables.md` — buckets and why a changed hash loses the key.
