---
schema: knowledge-doc/v1
type: concept
topic: python/iteration-and-functional
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, decorator, functools, wraps, partial, placeholder, lru_cache, cache, cached_property, reduce, singledispatch, cmp_to_key, operator, itemgetter]
ranked-sources: true
---

# Decorators, functools and the operator module

## Summary
**TL;DR:** `@deco` above `def f` means `f = deco(f)`, run once when the `def` statement executes; the name `f` then refers to whatever `deco` returned, usually a wrapper that calls the original. Copy the original's name, docstring and signature onto the wrapper with `@functools.wraps`, add one more nested function when the decorator takes arguments, and remember that stacked decorators are applied bottom-up but run top-down. `functools` supplies ready-made higher-order tools (`partial`, `lru_cache`/`cache`, `cached_property`, `reduce`, `singledispatch`, `cmp_to_key`), and `operator.itemgetter`/`attrgetter`/`methodcaller` replace small lambdas in `key=` arguments.
**Use this when:** every decorated function shows up as `wrapper` in logs or `help()`, a decorator with arguments raises `missing 1 required positional argument: 'func'`, `@lru_cache` raises `unhashable type`, a cached value goes stale, or you are choosing between a lambda and `partial`/`itemgetter`.
**Not this doc:** closures and `nonlocal`, which every wrapper relies on → `python/fundamentals/functions-scopes-and-closures.md`; `functools.total_ordering` → `python/classes/data-model-special-methods.md`; `property`, `classmethod` and descriptors → `python/metaprogramming/descriptors-and-attribute-lookup.md`; `@dataclass` → `python/classes/dataclasses-enums-and-abcs.md`; `itertools` → `python/iteration-and-functional/iterators-generators-and-itertools.md`.

## Problem
Decorators hide a rebinding, and the `functools` tools each carry one rule that surprises:
- A logging decorator makes every function report its name as `wrapper` and its signature as `(*args, **kwargs)`.
- `@retry` written without parentheses fails with `TypeError` at the first call, not at definition.
- A decorator's side effect (registering, printing) happens at import time, before any call.
- `@lru_cache` on a function that receives a list fails with `TypeError: unhashable type: 'list'`; on a method it keeps every `self` alive.
- `@cached_property` keeps returning an old value after the data it was computed from changed.

## Mental model
**Analogy:** a decorator is a gift-wrapping desk at the door of a room. Each function walks past it once, when the room is built (the `def` runs), and the desk hands back a box with the function inside; from then on the name on the guest list points at the box. Calls go to the box, which may do something before and after opening it. `functools.wraps` copies the label from the gift onto the box, so people reading the list still see the real name. Stacked decorators are boxes inside boxes: the bottom one wraps first, the top one is opened first.

**Artifact** (measured in the lab ✅[^lab]):
```python
import inspect
from functools import wraps

def naive(func):
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    return wrapper

def traced(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    return wrapper

@naive
def add(a, b=0): "Add two numbers."
@traced
def mul(a, b=1): "Multiply two numbers."

add.__name__, add.__doc__        # ('wrapper', None)
mul.__name__, mul.__doc__        # ('mul', 'Multiply two numbers.')
inspect.signature(add)           # (*args, **kwargs)
inspect.signature(mul)           # (a, b=1)     found through mul.__wrapped__
```

## How it works

### Decorator syntax
1. **`@` is a rebinding at definition time.** Decorator expressions are evaluated when the function is defined, in the enclosing scope; the result must be a callable, which is called with the function object as its only argument, and its return value is bound to the function's name ✅[^compound]. The glossary calls the syntax merely syntactic sugar for `f = staticmethod(f)`-style code ✅[^glossary]. In the lab, a `register` decorator's log reads `['register(ping)']` before `ping` is ever called ✅[^lab]. Since 3.9 any assignment expression may follow `@` ✅[^compound].
2. **The wrapper forwards everything.** A wrapper defined as `def wrapper(*args, **kwargs): return func(*args, **kwargs)` accepts any call and passes it on unchanged; it remembers `func` through a closure (`python/fundamentals/functions-scopes-and-closures.md`). In the lab, `mul(3, b=4)` arrives in the wrapper as `args=(3,)`, `kwargs={'b': 4}` and returns `12` ✅[^lab].
3. **`functools.wraps(func)` copies the metadata.** It is `update_wrapper()` used as a decorator, and by default it assigns `__module__`, `__name__`, `__qualname__`, `__annotations__`, `__type_params__` and `__doc__` from the wrapped function and updates the wrapper's `__dict__` ✅[^functools]. In the lab the constant behind that default, `functools.WRAPPER_ASSIGNMENTS`, read `('__module__', '__name__', '__qualname__', '__doc__', '__annotate__', '__type_params__')`, with `__annotate__` where the page lists `__annotations__`; the wrapper's `__annotations__` still came out as the wrapped function's ✅[^lab]. It also adds `__wrapped__`, pointing at the wrapped function, for introspection or for bypassing a cache ✅[^functools]. `inspect.signature()` follows `__wrapped__` by default ✅[^inspect], which is why `mul` shows `(a, b=1)` above ✅[^lab].
4. **A decorator with arguments is a decorator factory.** `@decomaker(argA, argB)` means `func = decomaker(argA, argB)(func)`: the expression after `@` is called first, and what it returns is the decorator ✅[^pep318]. That gives three levels: factory (takes the options), decorator (takes the function), wrapper (takes the call). A `retry(times=3)` built this way calls a function that fails twice and returns `'ok'` on the third attempt; written as `@retry` without parentheses, `retry` receives the function as `times`, and the first call fails with `retry.<locals>.decorator() missing 1 required positional argument: 'func'` ✅[^lab].
5. **Stacking order.** `@f1(arg)` above `@f2` above `def func` is roughly `func = f1(arg)(f2(func))` ✅[^compound], bottom to top, matching function composition in mathematics ✅[^pep318]. In the lab, two tracing decorators logged `apply inner, apply outer` at definition and `enter outer, enter inner, body` at the call ✅[^lab].
6. **Class decorators** follow the same rules, and the result is bound to the class name; they came with PEP 3129 (Python Enhancement Proposal) ✅[^compound]. A `@plugin` decorator that stores the class in a registry dict and sets an attribute on it leaves `REGISTRY == {'CsvExporter': ...}` and `CsvExporter.registered == True` ✅[^lab]. `functools.total_ordering` is a class decorator of this kind (`python/classes/data-model-special-methods.md`).

### functools
7. **`partial(func, /, *args, **keywords)`** returns a callable that calls `func` with the frozen arguments; extra positional arguments are appended, extra keywords extend and override ✅[^functools]. `partial(int, base=2)('10010')` is `18`, and passing `base=10` at the call gives `12` for `'12'` ✅[^lab]. A partial object exposes `func`, `args` and `keywords`, and does not get `__name__` or `__doc__` automatically ✅[^functools].
   - **`Placeholder`** (3.14) reserves a positional slot to be filled at call time, and every placeholder must be filled ✅[^functools]. In the lab, `partial(pow, Placeholder, 3)(2)` is `8`, and calling it with no arguments raises `TypeError: missing positional arguments in 'partial' call; expected at least 1, got 0` ✅[^lab].
   - Since 3.14 `partial` is a method descriptor, so a partial stored on a class binds `self` like a function; wrap it in `staticmethod()` for the old behaviour ✅[^whatsnew314]. In the lab, `Box(5).show_v()` returns `'v=5'` ✅[^lab].
8. **`lru_cache(maxsize=128, typed=False)` and `cache`** memoize: they save up to `maxsize` most recent results ✅[^functools].
   - Results live in a dictionary, so the positional and keyword arguments must be hashable ✅[^functools]; a list argument raises `TypeError: unhashable type: 'list'` ✅[^lab].
   - `f(a=1, b=2)` and `f(b=2, a=1)` may get separate entries ✅[^functools]; in the lab they did (`currsize` 2) ✅[^lab]. With `typed=False`, some types such as `str` and `int` may still be cached separately ✅[^functools]; `1` and `1.0` gave two entries ✅[^lab].
   - `maxsize=None` disables eviction; `cache` is the same as `lru_cache(maxsize=None)`, smaller and faster because it never evicts ✅[^functools].
   - The wrapper has `cache_info()` (hits, misses, maxsize, currsize), `cache_clear()` and `cache_parameters()` ✅[^functools]. `fib(80)` through `@cache` returns `23416728348467685` with `CacheInfo(hits=78, misses=81, maxsize=None, currsize=81)` ✅[^lab].
   - The cache stays coherent across threads, but the function may run more than once for the same arguments if another thread calls before the first call finishes ✅[^functools].
   - Caching makes no sense for functions with side effects, functions that must return a new mutable object each call (such as generators), or impure functions such as `time()` ✅[^functools]. On a method, `self` is part of the key ✅[^functools], so instances stay alive until they age out or the cache is cleared ✅[^faq].
9. **`cached_property`** runs the getter once and stores the result as an ordinary attribute of the same name; it runs only when no such attribute exists, allows writes, and deleting the attribute clears it ✅[^functools]. In the lab, `r.__dict__` was `{'rows': [1, 2, 3]}` before the first `r.total` and `{'rows': [1, 2, 3], 'total': 6}` after; `del r.total` made the next read compute again ✅[^lab].
   - It needs a mutable instance `__dict__`, so it fails on classes whose `__slots__` leave out `__dict__` ✅[^functools]; the lab error reads `No '__dict__' attribute on 'Slotted' instance to cache 'y' property.` ✅[^lab]
   - Before 3.12 it held an undocumented per-property lock; since 3.12 there is no lock, and in threaded code the getter may run more than once per instance ✅[^functools].
   - It cannot see changes to the attributes it was computed from ✅[^faq].
10. **`reduce(function, iterable, /[, initial])`** folds left: `reduce(add, [1, 2, 3, 4, 5])` computes `((((1+2)+3)+4)+5)`; `initial` goes before the items and is the result for an empty iterable ✅[^functools]. Lab: `15`; `reduce(add, [], 0)` is `0`; with no `initial` an empty input raises `TypeError: reduce() of empty iterable with no initial value` ✅[^lab]. Since 3.14 `initial` may be passed by keyword ✅[^functools], and `reduce(mul, [2, 3], initial=10)` is `60` ✅[^lab]. For every intermediate value, use `itertools.accumulate()` ✅[^functools].
11. **`singledispatch`** turns a function into a generic function that picks an implementation by the type of its first argument; implementations are added with `.register`, from a type annotation or an explicit type; a type with no registered implementation falls back along its MRO (method resolution order), and the original function is registered for `object` ✅[^functools]. In the lab, `describe(True)` used the `int` implementation, because `bool` subclasses `int`, and `describe.dispatch(bool) is describe.dispatch(int)` is `True` ✅[^lab]. **`singledispatchmethod`** dispatches on the first argument after `self` or `cls`, and must be the outermost decorator when combined with `@classmethod` ✅[^functools]; 3.15 adds support for non-descriptor callables ✅[^functools]. `Formatter().fmt(3.14159)` gave `'3.14'` and `fmt('x')` the fallback `"? 'x'"` ✅[^lab].
12. **`cmp_to_key(func)`** turns an old-style comparison function (negative, zero or positive result) into a key function for `sorted()`, `min()`, `max()` or `groupby()`; it exists mainly for code converted from Python 2 ✅[^functools]. Sorting `['bb', 'a', 'ccc', 'aa']` by length, then reverse alphabetically, gives `['a', 'bb', 'aa', 'ccc']` ✅[^lab].

### operator
13. **`itemgetter`, `attrgetter`, `methodcaller`** build small callables. `itemgetter(2)` returns `r[2]` through `__getitem__`, and several items give a tuple; `attrgetter('name.first')` follows dotted names; `methodcaller('name', 'foo', bar=1)` calls `b.name('foo', bar=1)` ✅[^operator]. With rows `("pear", 5), ("fig", 3), ("apple", 3)`, `sorted(rows, key=itemgetter(1))` keeps `fig` before `apple`, and `key=itemgetter(1, 0)` puts `apple` first ✅[^lab]. 3.14 added `operator.is_none()` and `is_not_none()` ✅[^whatsnew314]; `is_none(None)` and `is_not_none(0)` are both `True` ✅[^lab].

## Worked example
A tracing decorator stacked with `lru_cache(maxsize=2)`, both orders, called with `1, 2, 1, 3, 1, 2` (every value measured in the lab ✅[^lab]):

```python
@traced                   # A: tracer outside
@lru_cache(maxsize=2)
def square(n):
    body_calls.append(n)
    return n * n
```

| Call | Body ran? | Why |
|---|---|---|
| `square(1)` | yes | cache empty |
| `square(2)` | yes | cache now holds 1, 2 |
| `square(1)` | no (hit) | 1 is cached and becomes most recent |
| `square(3)` | yes | evicts 2, the least recently used |
| `square(1)` | no (hit) | 1 still cached |
| `square(2)` | yes | 2 was evicted |

Measured results:
- Order A (tracer outside): the tracer saw all six calls, `[1, 2, 1, 3, 1, 2]`; the body ran for `[1, 2, 3, 2]`.
- `square.__name__` is `'square'` thanks to `wraps`, but `hasattr(square, 'cache_info')` is `False`: the cache methods sit on the inner object, reached as `square.__wrapped__.cache_info()` → `CacheInfo(hits=2, misses=4, maxsize=2, currsize=2)`.
- `square.__wrapped__.__wrapped__(9)` calls the raw function and returns `81`, bypassing both layers.
- Order B (`@lru_cache` above `@traced`): the tracer saw only `[1, 2, 3, 2]`, the misses, with the same `CacheInfo`.

Choose the order by what the outer layer should see: put a tracer outside to count every request, inside to count real computations.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Decorator without `@wraps` | `__name__` is `'wrapper'`, `__doc__` is `None`, no `__wrapped__` ✅[^lab] | Only `update_wrapper()` copies the metadata ✅[^functools] |
| `@factory` without `()` | `TypeError` at the first call ✅[^lab] | The factory received the function as its option and returned the decorator |
| Attribute of an inner decorator (`cache_info`) after a `wraps` wrapper | Missing on the outer function ✅[^lab] | `wraps` copies only the listed attributes and the `__dict__` ✅[^functools] |
| `@lru_cache` on a method | Instances are kept alive by the cache ✅[^faq] | `self` is part of the key ✅[^functools] |
| `@lru_cache` on a function returning a list | Every caller gets the same list object; one caller's `append` shows up for the next (`['base', 'mine']`) ✅[^lab] | One cached result is returned for equal arguments; functions that must create distinct mutable objects should not be cached ✅[^functools] |
| `@cached_property` with `__slots__` and no `__dict__` | `TypeError` on first access ✅[^lab] | It stores the value in the instance `__dict__` ✅[^functools] |
| `@cached_property` on many instances | Instance dicts take more space | It interferes with PEP 412 key-sharing dictionaries ✅[^functools] |
| `partial` object in `help()` or logs | No `__name__` ✅[^lab] | Not created automatically ✅[^functools] |
| `partial` stored on a class, after upgrading to 3.14 | Now receives `self` | `partial` became a method descriptor ✅[^whatsnew314] |
| `@describe.register` with only a `list[int]` annotation | `TypeError: Invalid annotation for 'x'. list[int] is not a class.` ✅[^lab] | For a collection type, pass the dispatch type to the decorator, `@describe.register(list)`, and keep `list[int]` in the function's annotation ✅[^functools] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `@lru_cache(maxsize=N)` | Bounded memory; evicts old entries ✅[^functools] | Keeps arguments and results alive until evicted ✅[^functools] |
| `@cache` | Smaller and faster than a bounded LRU (least recently used) cache ✅[^functools] | Grows without limit |
| `@cached_property` | Result freed with the instance; no reference to `self` held elsewhere ✅[^faq] | Needs `__dict__` ✅[^functools]; no arguments; stale if inputs change ✅[^faq] |
| `partial` / `itemgetter` | Inspectable (`func`, `args`, `keywords`) ✅[^functools]; no new function body | Fixed shapes only |
| `lambda` | Any expression | Every lambda is named `'<lambda>'` ✅[^lab], so tracebacks and logs cannot tell them apart |

## Takeaways
- Decorate every wrapper function with `@functools.wraps(func)`. [rule-candidate]
- Accept and forward `*args, **kwargs` in wrappers unless the decorator deliberately changes the signature.
- Give a decorator with options three levels (factory, decorator, wrapper), and always call the factory with `()`. [rule-candidate]
- Read stacks bottom-up for application and top-down for execution; put caching where the outer layers should not see hits.
- Cache only pure functions with hashable arguments; prefer `cached_property` or a module-level function over `lru_cache` on methods. [rule-candidate]
- Use `operator.itemgetter`/`attrgetter` for sort keys instead of one-line lambdas.

## Verification status
- Verified: 87 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Compound statements: Function definitions, Class definitions](https://docs.python.org/3/reference/compound_stmts.html#function-definitions) — Python Software Foundation, living. Rank 1. Backs: decorators run at definition time and rebind the name; nesting order; any assignment expression since 3.9; class decorators and PEP 3129. [^compound]
- [Glossary: decorator](https://docs.python.org/3/glossary.html) — Python Software Foundation, living. Rank 1. Backs: decorator syntax is syntactic sugar for reassignment. [^glossary]
- [functools — Higher-order functions and operations on callable objects](https://docs.python.org/3/library/functools.html) — Python Software Foundation, living. Rank 1. Backs: `wraps`/`update_wrapper` attributes and `__wrapped__`; `partial` and `Placeholder`; `lru_cache`, `cache` and their rules; `cached_property` and its 3.12 change; `reduce`; `singledispatch`, `singledispatchmethod`; `cmp_to_key`. [^functools]
- [operator — Standard operators as functions](https://docs.python.org/3/library/operator.html) — Python Software Foundation, living. Rank 1. Backs: `itemgetter`, `attrgetter`, `methodcaller`. [^operator]
- [inspect — Inspect live objects: signature](https://docs.python.org/3/library/inspect.html) — Python Software Foundation, living. Rank 1. Backs: `signature()` follows `__wrapped__` by default. [^inspect]
- [Programming FAQ: How do I cache method calls?](https://docs.python.org/3/faq/programming.html) — Python Software Foundation, living. Rank 1. Backs: `lru_cache` keeps instances alive; `cached_property` holds no reference to the instance and cannot detect changed inputs. [^faq]
- [What's new in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, living. Rank 1. Backs: `partial` as a method descriptor; `operator.is_none()` and `is_not_none()`. [^whatsnew314]
- [PEP 318 – Decorators for Functions and Methods](https://peps.python.org/pep-0318/) — Kevin D. Smith, Jim J. Jewett, Skip Montanaro, Anthony Baxter, 2003. Rank 1. Backs: decorator factories; bottom-to-top application order. [^pep318]

## Related
- `python/fundamentals/functions-scopes-and-closures.md` — closures, `nonlocal` and `*args`/`**kwargs`, which every wrapper uses.
- `python/classes/data-model-special-methods.md` — `functools.total_ordering` and rich comparisons.
- `python/metaprogramming/descriptors-and-attribute-lookup.md` — why `property`, `cached_property` and `partial` behave differently on classes.
- `python/iteration-and-functional/iterators-generators-and-itertools.md` — `itertools.accumulate`, `groupby` and lazy pipelines that take these key functions.
- `python/typing/type-hints-and-generics.md` — typing decorators that preserve signatures.
