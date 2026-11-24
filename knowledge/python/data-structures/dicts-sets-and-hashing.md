---
schema: knowledge-doc/v1
type: concept
topic: python/data-structures
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, dict, set, frozenset, frozendict, hashable, hash, defaultdict, counter, ordereddict, chainmap, pythonhashseed]
ranked-sources: true
---

# Dicts, sets and hashing

## Summary
**TL;DR:** A `dict` maps hashable keys to values and keeps insertion order (guaranteed since 3.7); a `set` holds distinct hashable items in no promised order. Both find an entry by its hash and then by equality, so a key must be hashable (its hash never changes, and equal objects hash equal), and keys that compare equal, such as `1`, `1.0` and `True`, are one key. `keys()`, `values()` and `items()` are live views, and adding or removing entries while iterating may raise `RuntimeError`. `collections` adds `defaultdict`, `Counter`, `OrderedDict` and `ChainMap`; 3.15 adds the built-in immutable `frozendict`.
**Use this when:** a lookup raises `KeyError` or `TypeError: ... unhashable`, a loop raises `dictionary changed size during iteration`, entries in `{1: ..., True: ...}` collapse, set order changes between runs, or you are choosing between `get`, `setdefault`, `defaultdict` and `Counter`.
**Not this doc:** writing `__hash__` and `__eq__` for your own classes → `python/classes/data-model-special-methods.md`; how hash tables work inside → `algorithms/data-structures/hash-tables.md`; lists, tuples and copying → `python/data-structures/lists-tuples-and-sequences.md`; looping patterns → `python/fundamentals/control-flow-and-pattern-matching.md`.

## Problem
Mapping code breaks in ways that look random:
- `{1: 'a', 1.0: 'b', True: 'c'}` holds one entry, `{1: 'c'}`.
- `{[1, 2]: 'x'}` raises `TypeError`, but `{(1, 2): 'x'}` works.
- Deleting stale keys inside `for k in d:` raises `RuntimeError`.
- `print({'apple', 'banana', 'cherry'})` can show a different order from one run to the next.
- `defaultdict(list).get(k)` returns `None`, not `[]`.
- Two `OrderedDict`s with the same items compare unequal, while two `dict`s compare equal.

Each comes from how hashing, views or one `collections` class is specified.

## Mental model
**Analogy:** a cloakroom. You hand in a coat (the value) with a ticket (the key). The attendant works out a hook number from the ticket (the hash), then checks that the ticket on the hook really matches (equality). A ticket that could change after filing would send the attendant to the wrong hook, so only unchangeable tickets are accepted (hashable). Tickets the attendant considers equal, `1`, `1.0` and `True`, fetch the same hook. The cloakroom also keeps an arrival log, which is why a dict iterates in insertion order. A set is the same cloakroom with tickets and no coats.

**Artifact** (measured in the lab ✅[^lab]):
```python
tel = {'jack': 4098, 'sape': 4139}
tel['guido'] = 4127
list(tel)                        # ['jack', 'sape', 'guido']   insertion order
{1: 'a', 1.0: 'b', True: 'c'}    # {1: 'c'}   one key: first key object, last value
hash(1) == hash(1.0) == hash(True)   # True
{[1]: 0}   # TypeError: cannot use 'list' as a dict key (unhashable type: 'list')
```

## How it works
### Dicts
1. **Building one.** Use `{key: value}` pairs, a dict comprehension, or `dict()` with a mapping, an iterable of pairs, or keyword arguments; when a key repeats, its last value wins, and keyword arguments only work for keys that are valid identifiers ✅[^stdtypes]. `dict([('a', 1), ('a', 2)])` is `{'a': 2}` ✅[^lab].
2. **Looking up.** `d[key]` raises `KeyError` for a missing key; `d.get(key, default=None)` never raises ✅[^stdtypes]. `key in d` tests keys only ✅[^stdtypes], so `4127 in tel` is `False` even though `4127` is a value ✅[^lab].
3. **Order.** Dicts preserve insertion order: updating a key keeps its place, and a key deleted and added again goes to the end. The order is guaranteed since 3.7 and was a CPython implementation detail in 3.6 ✅[^stdtypes]. `popitem()` removes the last-inserted pair, and dicts and their views are reversible since 3.8 ✅[^stdtypes].
4. **Equality.** Two dicts are equal exactly when they hold the same `(key, value)` pairs, in any order; `<`, `<=`, `>`, `>=` raise `TypeError` ✅[^stdtypes].
5. **Views are live.** `keys()`, `values()` and `items()` return view objects that reflect later changes to the dict ✅[^stdtypes]. After adding `'ham'` and deleting `'eggs'` from `{'eggs': 2, 'spam': 500}`, a keys view taken earlier lists `['spam', 'ham']` ✅[^lab]. Keys views are set-like, items views are set-like when the values are hashable, and values views are not; two distinct `values()` views never compare equal, even of the same dict ✅[^stdtypes].
6. **`setdefault`, `pop`, `fromkeys`.** `setdefault(key, default=None)` returns the value if the key exists, otherwise inserts `default` and returns it; `pop(key)` removes and returns the value and raises `KeyError` unless a default is given ✅[^stdtypes]. `dict.fromkeys(keys, value)` shares one `value` object between all keys, so a mutable value such as `[]` generally makes no sense; use a dict comprehension for distinct values ✅[^stdtypes].
7. **`|` and `|=` (3.9, PEP 584, a Python Enhancement Proposal).** `d | other` returns a new dict and needs both operands to be dicts; `d |= other` updates in place and accepts any mapping or iterable of pairs; on a shared key the right side wins ✅[^stdtypes]. The union is therefore not commutative ✅[^pep584]. With `a = {'spam': 1, 'cheese': 3}` and `b = {'cheese': 'cheddar', 'aardvark': 'Ethel'}`, `a | b` keeps `'cheddar'` and `b | a` keeps `3` ✅[^lab]. `a | [('spam', 999)]` raises `TypeError: unsupported operand type(s) for |: 'dict' and 'list'`, while `a |= [('spam', 999)]` works ✅[^lab].
8. **Dict comprehensions.** `{x: x**2 for x in (2, 4, 6)}` is `{2: 4, 4: 16, 6: 36}` ✅[^tut-ds]. The key is evaluated before the value (since 3.8), and a key produced twice keeps the last value ✅[^expressions]. Inverting `{'a': 1, 'b': 1}` gives `{1: 'b'}` ✅[^lab]. Since 3.15 (PEP 798) `{**d for d in dicts}` merges a series of dicts ✅[^whatsnew315].
9. **Changing size while iterating.** Iterating a view while adding or deleting entries may raise `RuntimeError` or fail to visit every entry ✅[^stdtypes]. In the lab both deleting and adding inside `for k in d:` raised `RuntimeError: dictionary changed size during iteration`, assigning new values to existing keys was fine, `for k in list(d):` let the loop delete, and a set raised `RuntimeError: Set changed size during iteration` ✅[^lab]. The tutorial's two fixes: loop over a copy, or build a new collection ✅[^tut-controlflow].

### Hashing
10. **What "hashable" means.** An object is hashable if its hash value never changes during its lifetime (it has `__hash__()`) and it can be compared to others (it has `__eq__()`); hashable objects that compare equal must have the same hash ✅[^glossary]. Most immutable built-ins are hashable, mutable containers are not, and immutable containers such as tuples and frozensets are hashable only if their elements are; instances of your own classes are hashable by default, compare unequal to everything but themselves, and hash from their `id()` ✅[^glossary]. Since 3.14 the error names the role: `cannot use 'tuple' as a dict key (unhashable type: 'list')` for `{([1], 2): 0}` ✅[^whatsnew314] ✅[^lab].
11. **Equal keys collapse.** Dicts and sets use the hash internally ✅[^glossary], and values that compare equal, such as `1`, `1.0` and `True`, index the same entry ✅[^stdtypes]. In the lab the first key object stays and the last value wins: `{1: 'a', 1.0: 'b', True: 'c'}` is `{1: 'c'}`, `{True: 'c', 1: 'a'}` is `{True: 'a'}`, and `{1, 1.0, True}` is `{1}` ✅[^lab].
12. **Defining `__eq__` removes the default hash.** A class that overrides `__eq__()` without defining `__hash__()` gets `__hash__ = None`, so its instances cannot be keys ✅[^datamodel]; the lab shows `EqOnly.__hash__` as `None` ✅[^lab]. The full contract for your own classes is in `python/classes/data-model-special-methods.md`.
13. **Identity first.** For dicts and sets, `x in y` means `any(x is e or x == e for e in y)` ✅[^expressions]. So a NaN (not-a-number) key, which never equals itself ✅[^expressions], is found only through the very same object: `nan in {nan: 1}` is `True`, `float('nan') in {nan: 1}` is `False` ✅[^lab].
14. **Hash randomization.** By default the hashes of `str` and `bytes` are salted with an unpredictable per-process value, as protection against denial-of-service inputs that push dict insertion to its O(n²) worst case (time growing with the square of the number of keys); this changes set iteration order, which Python has never guaranteed ✅[^datamodel]. `PYTHONHASHSEED` unset or `random` keeps the random seed, an integer fixes it, and `0` disables randomization ✅[^cmdline]. In the lab `hash('spam')` differed between two runs while `hash(42)` (which is `42`) did not, `PYTHONHASHSEED=0` made two runs agree, and eight seeds gave more than one iteration order for the same four-string set ✅[^lab]. Dict iteration follows insertion order instead ✅[^stdtypes], so the salt does not reorder a dict.

### Sets and frozensets
15. **Two types.** A set is an unordered collection of distinct hashable objects with no indexing or slicing; `set` is mutable and therefore unhashable, `frozenset` is immutable and hashable, so it can be a dict key or an element of another set ✅[^stdtypes]. `{}` is an empty dict; an empty set is `set()` ✅[^tut-ds].
16. **Operations.** `|`, `&`, `-` and `^` give union, intersection, difference and symmetric difference; `<=` and `<` test subset and proper subset ✅[^stdtypes]. The operators need sets on both sides, the methods (`union()`, `intersection()` …) accept any iterable ✅[^stdtypes]. `set('abc') & 'cbs'` raises `TypeError`, `set('abc').intersection('cbs')` gives `{'b', 'c'}` ✅[^lab]. Mixing `set` and `frozenset` returns the type of the first operand; `remove()` raises `KeyError` for a missing element, `discard()` does not ✅[^stdtypes]. Subset is only a partial order, so sorting a list of sets gives an undefined result ✅[^stdtypes].
17. **Set comprehensions.** `{x for x in 'abracadabra' if x not in 'abc'}` is `{'r', 'd'}`, and `{*fruit for fruit in fruits}` unions a series of sets ✅[^tut-ds]; that starred form is new in 3.15 ✅[^whatsnew315].

### `frozendict` (3.15, PEP 814)
18. **An immutable mapping.** `frozendict` is a new built-in that cannot be changed after creation; it is not a `dict` subclass but inherits directly from `object`; it is hashable when all its keys and values are, and it keeps insertion order while comparison ignores order ✅[^whatsnew315]. It lacks `__setitem__`, `__delitem__`, `clear`, `pop`, `popitem`, `setdefault` and `update`, and `fd |= other` builds a new frozendict instead of changing it ✅[^stdtypes]. The immutability is shallow: a list stored as a value can still be changed ✅[^pep814]. In the lab `fd['z'] = 3` raised `TypeError: 'frozendict' object does not support item assignment`, `isinstance(fd, dict)` was `False`, `fd |= {'z': 3}` rebound `fd` to a new object, and `frozendict(k=[1])['k'].append(2)` succeeded ✅[^lab]. Code that tests `isinstance(arg, dict)` can widen it to `(dict, frozendict)` or to `collections.abc.Mapping` ✅[^whatsnew315].

### `collections` helpers
19. **`defaultdict`.** A `dict` subclass: when `d[key]` misses, it calls `default_factory()` with no arguments, stores the result under the key and returns it; only `__getitem__` does this, so `get()` still returns `None`, and with no factory a miss raises `KeyError` ✅[^collections]. Grouping with `defaultdict(list)` is simpler and faster than `setdefault(k, []).append(v)` ✅[^collections]. In the lab `dd.get('red')` left `'red'` out of the dict, and reading `dd['red']` put it in ✅[^lab].
20. **`Counter`.** A `dict` subclass for counting hashable objects: a missing item counts `0` instead of raising, setting a count to `0` keeps the entry (`del` removes it), `most_common(n)` lists the largest counts with ties in first-seen order, `+`, `-`, `&`, `|` combine counters and drop results of zero or below, `^` (symmetric difference) is new in 3.15, and equality treats missing items as zero since 3.10 ✅[^collections]. In the lab `Counter(a=3, b=1) - Counter(a=1, b=2)` gave `Counter({'a': 2})` and `c['purple']` returned `0` without adding `'purple'` ✅[^lab].
21. **`OrderedDict`.** Less important now that `dict` keeps order; it is built for frequent reordering (for example LRU, least recently used, caches) and has `move_to_end(key, last=True)` and `popitem(last=False)` ✅[^collections]. Equality between two `OrderedDict`s is order-sensitive, while against any other mapping it is not ✅[^collections]. `OrderedDict(a=1, b=2) == OrderedDict(b=2, a=1)` is `False` but `== dict(b=2, a=1)` is `True` ✅[^lab].
22. **`ChainMap`.** Groups several mappings into one updatable view: lookups search them in order, but writes, updates and deletions touch only the first; the mappings are held by reference, so later changes show through; `new_child()` adds a fresh front mapping, which models nested scopes ✅[^collections]. With `defaults = {'color': 'blue', 'user': 'guest'}`, `cli = {'user': 'admin'}` and `cm = ChainMap(cli, defaults)`, `cm['user']` was `'admin'`, `cm['color'] = 'red'` went into `cli` and left `defaults` alone, and after `defaults['theme'] = 'dark'` the chain answered `cm['theme'] == 'dark'` ✅[^lab].

## Worked example
Counting page views from five log lines, with every value measured in the lab ✅[^lab]:

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | `pairs = [line.split() for line in logs]` with `logs = ['ann /home', 'bob /cart', 'ann /cart', 'cy /home', 'ann /home']`; `hits = Counter(path for _, path in pairs)` | `Counter({'/home': 3, '/cart': 2})`; `hits.most_common(1) == [('/home', 3)]` | `Counter` tallies hashable items ✅[^collections] |
| 2 | `by_user = defaultdict(list)`; `by_user[user].append(path)` for each pair | `{'ann': ['/home', '/cart', '/home'], 'bob': ['/cart'], 'cy': ['/home']}` | the factory builds each missing list ✅[^collections] |
| 3 | `distinct = {u: len(set(p)) for u, p in by_user.items()}` | `{'ann': 2, 'bob': 1, 'cy': 1}` | a set has no duplicate elements ✅[^tut-ds] |
| 4 | `for user in by_user: if distinct[user] == 1: del by_user[user]` | `RuntimeError: dictionary changed size during iteration`, after `'bob'` was already deleted | deleting while iterating (How it works 9) |
| 5 | the same loop over `list(by_user)` | `{'ann': ['/home', '/cart', '/home']}` | the loop walks a separate list of keys |
| 6 | `settings = {'theme': 'light', 'page_size': 20} \| {'page_size': 50}` | `{'theme': 'light', 'page_size': 50}`; the left dict unchanged | right operand wins, a new dict is built ✅[^stdtypes] |
| 7 | `cache = {frozendict(settings): 'rendered page'}`; `cache[frozendict(page_size=50, theme='light')]` | `'rendered page'` | a frozendict hashes and compares regardless of order ✅[^whatsnew315] |
| 8 | `{settings: 'x'}` | `TypeError: cannot use 'dict' as a dict key (unhashable type: 'dict')` | a plain dict is mutable, so unhashable ✅[^glossary] |

Step 4 fails half-way, which is why the loop in step 5 must not assume the dict is untouched.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `x = {}` | `type(x)` is `dict` ✅[^lab] | Braces with nothing inside are an empty dict ✅[^tut-ds] |
| `d.values() == d.values()` | `False` ✅[^lab] | Values views never compare equal ✅[^stdtypes] |
| `dict.fromkeys(names, [])` | Every key shares one list | `fromkeys` reuses the single value ✅[^stdtypes] |
| `c = Counter(...); c['purple']` | `0`, and `'purple' in c` stays `False` ✅[^lab] | `Counter` answers zero for missing items ✅[^collections] |
| `float('nan')` as a key | Found only with the same object ✅[^lab] | Identity is tried before equality ✅[^expressions] |
| A key whose hash changes after insertion | The entry sits in the wrong hash bucket ✅[^datamodel] | A key's hash must never change ✅[^glossary]; a class with mutable state and `__eq__` should not define `__hash__` ✅[^datamodel] |
| `ChainMap` iteration order | `list(cm)` for the chain in How it works 22 was `['color', 'user', 'theme']` ✅[^lab] | Iteration scans the mappings last to first ✅[^collections] |
| `fd.copy()` on a frozendict | `fd.copy() is fd` was `True` ✅[^lab] | In CPython `copy()` returns the same object; use `copy.deepcopy()` for a deep copy ✅[^pep814] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `d[key]` | A missing key fails loudly with `KeyError` ✅[^stdtypes] | Needs `in` or `try` when absence is normal |
| `d.get(key, default)` | Never raises ✅[^stdtypes] | A misspelled key quietly returns the default too |
| `d.setdefault(key, [])` | Insert-and-return in one call ✅[^stdtypes] | Less simple and slower than `defaultdict` for grouping ✅[^collections] |
| `defaultdict(factory)` | Simplest grouping code ✅[^collections] | Any `d[key]` read inserts a key ✅[^collections] |
| `dict` | Designed to be very good at mapping operations ✅[^collections] | No efficient move to the front ✅[^collections] |
| `OrderedDict` | Handles frequent reordering better; order-sensitive equality ✅[^collections] | Space, iteration speed and update speed were secondary design goals ✅[^collections] |
| `frozendict` | Hashable, safe to share between threads if values are not modified ✅[^pep814] | No in-place updates ✅[^stdtypes]; immutability is shallow ✅[^pep814] |

## Takeaways
- Group with `defaultdict(list)` and count with `Counter`, not hand-written `if key in d` blocks. [rule-candidate]
- Never add or delete keys of a dict or set while iterating over it; iterate over `list(d)` or build a new one. [rule-candidate]
- Never rely on set iteration order in output or tests; sort first. [rule-candidate]
- Never pass a mutable object as the value to `dict.fromkeys()`; use a dict comprehension. [rule-candidate]
- Do not mix `1`, `1.0` and `True` as keys of one dict; they are the same key.
- To accept any mapping, including `frozendict`, check `collections.abc.Mapping`, not `dict`. [rule-candidate]

## Verification status
- Verified: 101 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Built-in Types: Mapping types — dict, frozendict; Set Types](https://docs.python.org/3/library/stdtypes.html) — Python Software Foundation, living. Rank 1. Backs: dict construction, lookup, order, equality, views, `setdefault`/`pop`/`fromkeys`, `|` and `|=`, mutation during iteration, set and frozenset operations, the frozendict API. [^stdtypes]
- [5. Data Structures: Sets, Dictionaries](https://docs.python.org/3/tutorial/datastructures.html) — Python Software Foundation, living. Rank 1. Backs: `{}` versus `set()`, dict and set comprehensions. [^tut-ds]
- [4. More Control Flow Tools: for statements](https://docs.python.org/3/tutorial/controlflow.html) — Python Software Foundation, living. Rank 1. Backs: loop over a copy or build a new collection. [^tut-controlflow]
- [collections — Container datatypes](https://docs.python.org/3/library/collections.html) — Python Software Foundation, living. Rank 1. Backs: `defaultdict`, `Counter`, `OrderedDict`, `ChainMap`. [^collections]
- [Glossary: hashable](https://docs.python.org/3/glossary.html) — Python Software Foundation, living. Rank 1. Backs: the definition of hashable and which objects are. [^glossary]
- [3. Data model: object.__hash__](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: `__eq__` without `__hash__`, mutable objects and hashing, str/bytes hash salting. [^datamodel]
- [6. Expressions: Membership test operations, Dictionary displays](https://docs.python.org/3/reference/expressions.html) — Python Software Foundation, living. Rank 1. Backs: identity-then-equality membership, NaN never equal, key-before-value and last-value-wins in dict comprehensions. [^expressions]
- [1. Command line and environment: PYTHONHASHSEED](https://docs.python.org/3/using/cmdline.html) — Python Software Foundation, living. Rank 1. Backs: seed values and disabling randomization. [^cmdline]
- [What's new in Python 3.14: Improved error messages](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, 2025. Rank 1. Backs: the unhashable-key message. [^whatsnew314]
- [What's new in Python 3.15: PEP 814, PEP 798](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: frozendict semantics and `isinstance` advice; `**` in dict comprehensions. [^whatsnew315]
- [PEP 584 – Add Union Operators To dict](https://peps.python.org/pep-0584/) — Steven D'Aprano, Brandt Bucher, 2019. Rank 1. Backs: dict union is not commutative. [^pep584]
- [PEP 814 – Add frozendict built-in type](https://peps.python.org/pep-0814/) — Victor Stinner, Donghee Na, 2025. Rank 1. Backs: shallow immutability, `copy()` in CPython, sharing between threads. [^pep814]

## Related
- `algorithms/data-structures/hash-tables.md` — buckets, collisions and why lookups are O(1) on average.
- `python/classes/data-model-special-methods.md` — implementing `__hash__` and `__eq__` consistently.
- `python/data-structures/lists-tuples-and-sequences.md` — tuples as keys, shallow and deep copies.
- `python/fundamentals/control-flow-and-pattern-matching.md` — mapping patterns in `match`.
