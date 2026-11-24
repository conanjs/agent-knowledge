---
schema: knowledge-doc/v1
type: concept
topic: python/typing
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, typing, type-hints, annotations, annotationlib, deferred-evaluation, generics, typevar, type-alias, variance, paramspec, self]
ranked-sources: true
---

# Type hints, annotation evaluation and generics

## Summary
**TL;DR:** An annotation is metadata: the interpreter stores it and never checks it, so `def double(x: int)` happily doubles a string; only a separate type checker gives hints meaning. Since 3.14 annotations are not evaluated when the code runs but only when someone asks, through a compiler-made `__annotate__` function that `annotationlib.get_annotations()` can call in a `VALUE`, `FORWARDREF` or `STRING` format. Generics are written with the 3.12 bracket syntax (`def first[T](xs: list[T]) -> T`, `class Box[T]`, `type Alias = ...`), whose bounds, defaults and alias values are lazy too.
**Use this when:** you wonder why a wrong-type call runs, a forward reference raises `NameError` (or no longer does), `from __future__ import annotations` turned hints into strings, `isinstance(x, list[int])` fails, or you need to write or introspect a generic function, class or type alias.
**Not this doc:** `Protocol`, `TypedDict`, `Literal`, `Final`, `@overload` and narrowing → `python/typing/protocols-typeddict-and-narrowing.md`; how dataclasses read annotations → `python/classes/dataclasses-enums-and-abcs.md`; typing decorators with `ParamSpec` → `python/iteration-and-functional/decorators-and-functools.md`; runtime types and identity → `python/fundamentals/objects-names-and-types.md`.

## Problem
Hints look like declarations from a statically typed language, so code built on that belief misbehaves:
- `double("ab")` on a function annotated `x: int` returns `'abab'`; nothing complains ✅[^lab].
- `list[str]([1, 2, 3])` builds `[1, 2, 3]`, and `isinstance([1], list[int])` raises `TypeError` ✅[^lab].
- A function annotated with a class defined further down raised `NameError` at definition time up to 3.13 and does not in 3.14 ✅[^annotationlib], yet reading `__annotations__` still raises it if the name never appears ✅[^lab].
- With `from __future__ import annotations`, `"str"` comes back as `"'str'"` ✅[^lab].
- Old-style type variables live at module level and mean something different in each generic that uses them; their scoping and the notion of variance confuse many developers, which is why PEP 695 (PEP = Python Enhancement Proposal) added a dedicated syntax ✅[^pep695].

## Mental model
**Analogy:** an annotation is a sealed note taped to a parcel. The courier (the interpreter) carries the parcel and never opens the note, so a parcel labelled "books" can hold shoes. An inspector (a type checker, run before the program) reads every note and flags mismatches. Since 3.14 the note is sealed until someone opens it, so it may name a recipient who has not moved in yet; `annotationlib` is the letter opener, and it can either read the note out loud (`STRING`), deliver it (`VALUE`), or deliver it with "unknown recipient" stickers on the names it cannot find (`FORWARDREF`).

**Artifact** (measured in the lab ✅[^lab]):
```python
from annotationlib import get_annotations, Format

def double(x: int) -> int: return x * 2
double("ab")                    # 'abab'        the hint is never checked

def func(a: Cls) -> None: ...   # Cls does not exist yet: no error in 3.14+
class Cls: pass
func.__annotations__            # {'a': <class '__main__.Cls'>, 'return': None}

def g(x: Undefined, y: list[Undefined2]) -> int: ...
g.__annotations__               # NameError: name 'Undefined' is not defined
get_annotations(g, format=Format.STRING)
                                # {'x': 'Undefined', 'y': 'list[Undefined2]', 'return': 'int'}
```

## How it works

### Annotations are metadata
1. The Python runtime does not enforce function and variable annotations; third-party tools such as type checkers, IDEs (integrated development environments) and linters use them ✅[^typing]. Annotations change runtime behaviour only when some mechanism reads them, such as `dataclasses` or `@functools.singledispatch` ✅[^ref-compound]. A type checker can treat a function without annotations as if every parameter and the return were `Any`, and may instead infer more precise types ✅[^spec-annotations].

### When annotations are evaluated
2. **Three models.** Stock semantics (3.0 through 3.13) evaluate annotations eagerly, where they appear; `from __future__ import annotations` (3.7+, PEP 563) stores them as strings; deferred evaluation (default since 3.14, PEP 649 and PEP 749) evaluates them only when accessed ✅[^annotationlib].
3. **The mechanism.** Annotations are stored in an *annotate function* (a small generated function that builds the annotations dict) and evaluated only when needed ✅[^whatsnew314]. `obj.__annotate__(format)` returns a new dict of annotations; it must support `VALUE` and may raise `NameError` only for `VALUE` ✅[^datamodel]. `__annotations__` is a data descriptor (an attribute whose reads and writes run code): on first access it calls `__annotate__(1)` and caches the result, and that cache is the only caching PEP 649 defines ✅[^pep649]. In the lab, annotations with a side effect ran zero times at `def`, twice on the first `h.__annotations__` (parameter and return), and not again on the second access, which returned the same dict ✅[^lab]. Reading `__annotations__` may therefore execute arbitrary code and raise exceptions ✅[^datamodel].
4. **What is never evaluated.** Annotations of local variables inside a function are never evaluated or stored, and neither are annotations on non-simple targets such as `self.x: int` ✅[^ref-simple]: `y: undefined_name = 5` inside a function runs ✅[^lab].
5. **Formats.** `annotationlib.get_annotations(obj, format=...)` is the main entry point ✅[^annotationlib]:
   - `Format.VALUE` (1) evaluates the expressions and may raise, for example on an undefined name;
   - `Format.FORWARDREF` (3) returns real values where it can and `ForwardRef` proxies for names it cannot resolve;
   - `Format.STRING` (4) returns the source-like text, which may change between versions;
   - `VALUE_WITH_FAKE_GLOBALS` (2) is internal and should not be passed ✅[^annotationlib].

   It returns a new dict on every call ✅[^annotationlib] (the lab saw equal but distinct dicts ✅[^lab]). A `ForwardRef` can be evaluated later: once `Undefined = float` ran, `fr["x"].evaluate()` returned `<class 'float'>` ✅[^lab]. Prefer this function over touching `__annotations__`: on 3.14+ how a class stores annotations in its `__dict__` is private, and `cls.__dict__.get('__annotations__')` may be `None` even when the class has annotations ✅[^howto-annotations].
6. **`from __future__ import annotations` still stringifies.** With it, every annotation is stored as a string ✅[^ref-compound], and in 3.14 its behaviour is unchanged ✅[^whatsnew314]. A string annotation is then quoted twice: `def foo(a: "str")` gives `{'a': "'str'"}` ✅[^howto-annotations]. To get objects back, `get_annotations(obj, eval_str=True)` calls `eval()` once per string (so `"'str'"` becomes the string `'str'`), while `typing.get_type_hints()` resolved it all the way to `<class 'str'>` ✅[^lab]. The import is expected to be removed in a future version, not before Python 3.13 reaches its end of life in 2029 ✅[^whatsnew314]; PEP 749 plans a `DeprecationWarning` at compile time no sooner than the first release after that, and a `SyntaxError` at least two releases later ✅[^pep749]. Compiling it in 3.15.2 produced no warning ✅[^lab]. For checking, a type checker resolves names in such a file with the rules for explicitly quoted annotations ✅[^spec-annotations].

### Everyday hints
7. **Built-in generics.** Subscripting a class creates a `GenericAlias` such as `list[int]` (3.9, PEP 585) ✅[^stdtypes]. The runtime checks neither the elements nor the parameter: `list[str]([1, 2, 3])` is `[1, 2, 3]` and the object made is a plain `list` ✅[^stdtypes]. `isinstance()` rejects a parameterized generic as its second argument ✅[^stdtypes]. `typing.List`, `typing.Dict` and friends are deprecated aliases since 3.9, with no runtime warning and no removal planned ✅[^typing].
8. **Unions, `Optional`, `None`.** `X | Y` (3.10, PEP 604) means `Union[X, Y]`; since 3.14 both spellings create instances of one class, and `types.UnionType` is an alias of `typing.Union` ✅[^typing]. Unions flatten, drop duplicates, ignore order, and `Union[int]` returns `int` ✅[^typing]. `isinstance(3, int | str)` works ✅[^stdtypes]. `Optional[X]` is `X | None`; it is not the same as an optional argument, which only needs a default ✅[^typing]. In a hint, `None` means `type(None)` ✅[^spec-special-types], and `get_type_hints()` replaces it with `types.NoneType` ✅[^typing].
9. **`Any` versus `object`.** To a type checker every type is assignable to `Any` and `Any` to every type, so operations on an `Any` value are not checked; every type is also a subtype of `object`, but `object` is not assignable to narrower types and almost every operation on it is rejected ✅[^typing]. Use `object` for "any value, type-safely" and `Any` for "dynamically typed" ✅[^typing]. The spec puts it as: `object` is the set of all objects, `Any` is an unknown static type ✅[^spec-concepts]. At runtime `isinstance(1, Any)` raises `TypeError`, while `class Dyn(Any)` is allowed (since 3.11) ✅[^typing] ✅[^lab].
10. **Callables.** Annotate with `collections.abc.Callable` (`typing.Callable` is deprecated): `Callable[[int], str]` takes one `int` and returns `str`, `Callable[..., str]` accepts any parameter list. Keyword-only, variadic or overloaded signatures need a `Protocol` with `__call__` ✅[^typing].

### Type aliases
11. `type Vector = list[float]` (3.12) creates a `typing.TypeAliasType`; its value is evaluated in an *annotation scope* (a hidden function-like scope) only when `__value__` is accessed, so it may name things not yet defined ✅[^ref-simple]. In the lab `type Later = NotYetDefined` ran, and only `Later.__value__` raised `NameError` ✅[^lab]. A checker treats the alias as exactly the aliased type ✅[^typing]. Older spellings, `Vector = list[float]` or `Vector: TypeAlias = list[float]`, still work; `TypeAlias` is deprecated since 3.12 in favour of `type` ✅[^typing]. An alias can be generic, `type Pair[T] = tuple[T, T]` ✅[^ref-compound], and is not a class: `isinstance([], Vector)` raises `TypeError` ✅[^lab].

### Generics with type parameter syntax
12. **Declaring.** Functions, classes and type aliases may carry a type parameter list in brackets right after the name (3.12) ✅[^ref-compound]. A plain name (`T`) is a `TypeVar`, one type; `*Ts` is a `TypeVarTuple`, any number of types; `**P` is a `ParamSpec`, the parameters of a callable ✅[^ref-compound]. The parameters exist only inside the generic object (after `def func[T](): pass`, `T` is not a module name), and the object lists them in `__type_params__` ✅[^ref-compound]; the lab got `NameError: name 'T' is not defined` and `first.__type_params__ == (T,)` ✅[^lab]. A generic class implicitly inherits `typing.Generic` ✅[^ref-compound]: for `class Box[T]` holding one `item: T`, `Box.__mro__` is `(Box, Generic, object)` ✅[^lab].
13. **At runtime generics behave much like non-generic objects** ✅[^ref-compound]: `Box[int]("not an int")` builds a `Box` holding the string ✅[^lab].
14. **Bounds and constraints.** `[T: int]` limits `T` to subtypes of `int`; `[T: (str, bytes)]` makes `T` exactly one of those types; both are evaluated only when `__bound__` or `__constraints__` is read ✅[^ref-compound]. A type variable cannot be both bounded and constrained ✅[^typing]. A checker solves a bounded variable with the most specific type (a `str` subclass stays that subclass) and a constrained one with one of the listed types (the subclass becomes `str`) ✅[^typing].
15. **Defaults (3.13, PEP 696).** `[T = str]` gives a default used when no argument is supplied; it is evaluated lazily, and without one `__default__` is `typing.NoDefault` ✅[^ref-compound]. A parameter without a default cannot follow one with a default; with the new syntax that is a `SyntaxError` ✅[^spec-generics], which the lab saw as `non-default type parameter 'U' follows default type parameter` ✅[^lab].
16. **Variance** says whether `Box[Manager]` may be used where `Box[Employee]` is expected (`Manager` being a subclass of `Employee`). Covariant means yes, as for read-only containers such as `Sequence`; contravariant means the reverse, as for the `send()` argument type of `Generator`; invariant means neither, as for mutable containers such as `list`, because a function given a `list[Manager]` could append an `Employee` to it ✅[^spec-generics]. Type parameters from the bracket syntax always get inferred variance: the checker tests whether `C[T]` is assignable to `C[object]` (covariant), the reverse (contravariant), or neither (invariant) ✅[^spec-generics]. In the lab `__infer_variance__` was `True` for a bracket parameter and `False` for `TypeVar("OldT")` ✅[^lab].
17. **The older form.** `T = TypeVar("T")` plus `class C(Generic[T])` is kept for 3.11 and earlier ✅[^typing]. Such variables are invariant unless created with `covariant=True`, `contravariant=True` or `infer_variance=True` ✅[^spec-generics], and a checker should flag a declaration that mixes them with bracket parameters ✅[^spec-generics]. `isinstance(x, T)` raises `TypeError` ✅[^typing].
18. **`ParamSpec` and `TypeVarTuple`.** `def logged[**P, R](f: Callable[P, R]) -> Callable[P, R]` lets a decorator keep the wrapped function's signature, with `*args: P.args, **kwargs: P.kwargs` in the inner function ✅[^typing]. `class Arr[*Ts]` accepts any number of type arguments ✅[^ref-compound]; since 3.15 `TypeVarTuple` also accepts `bound`, `covariant`, `contravariant` and `infer_variance` ✅[^typing].
19. **`Self` (3.11, PEP 673)** stands for the enclosing class: a method annotated `-> Self` that returns `self` is seen as returning the subclass when called on a subclass. Do not use it when the method always returns an instance of the base class ✅[^typing].

### Introspection
20. `typing.get_type_hints(obj)` resolves string and `ForwardRef` annotations, replaces `None` with `NoneType`, merges a class's annotations with its bases along the MRO (method resolution order), and strips `Annotated`, `Required`, `NotRequired` and `ReadOnly` unless `include_extras=True`; with `Format.VALUE` an unresolvable name raises `NameError` ✅[^typing]. `get_origin(X[Y, Z])` returns `X` (or `None`) and `get_args()` returns `(Y, Z)` (or `()`) ✅[^typing].

## Worked example
A generic shelf with an alias defined before its element type and a method annotated with a class defined later, run in the lab ✅[^lab] (`0x…` is a memory address):
```python
type Inventory[T] = dict[str, list[T]]          # alias before Item exists

class Shelf[T]:
    def __init__(self) -> None:
        self.stock: Inventory[T] = {}
    def put(self, code: str, item: T) -> Shelf[T]:
        self.stock.setdefault(code, []).append(item)
        return self
    def first(self, code: str) -> T | None:
        items = self.stock.get(code)
        return items[0] if items else None
    def audit(self, ledger: Ledger) -> int:       # Ledger defined later, never imported
        return len(self.stock)

class Item:
    def __init__(self, name: str) -> None: self.name = name
    def __repr__(self) -> str: return f"Item({self.name!r})"
```

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | run the definitions above | all defined; `Shelf[T]` inside its own body and `Ledger` are not looked up | annotations are lazy (How it works 3) |
| 2 | `s = Shelf[Item](); s.put("A1", Item("bolt")).put("A1", "not an item").put("B2", 42)` | `s.stock == {'A1': [Item('bolt'), 'not an item'], 'B2': [42]}` | nothing checks `item: T` (How it works 13) |
| 3 | `s.first("A1")`, `s.first("Z9")` | `Item('bolt')`, `None` | the `T \| None` hint documents the `None` |
| 4 | `Inventory.__value__`, `Inventory[Item]` | `dict[str, list[T]]`, `__main__.Inventory[__main__.Item]` | alias value read on demand (How it works 11) |
| 5 | `get_annotations(Shelf.put)` | `{'code': <class 'str'>, 'item': T, 'return': __main__.Shelf[T]}` | `VALUE` format |
| 6 | `get_annotations(Shelf.audit)` while `Ledger` is still undefined | `NameError: name 'Ledger' is not defined` | `VALUE` evaluates |
| 7 | same with `format=Format.FORWARDREF` | `{'ledger': ForwardRef('Ledger', owner=<function Shelf.audit at 0x…>), 'return': <class 'int'>}` | unresolved names become proxies |
| 8 | same with `format=Format.STRING` | `{'ledger': 'Ledger', 'return': 'int'}` | text only, nothing evaluated |
| 9 | define `class Ledger`, then `get_type_hints(Shelf.audit)` | `{'ledger': <class '__main__.Ledger'>, 'return': <class 'int'>}` | evaluation succeeds once the name exists |
| 10 | `hint = get_type_hints(Shelf.first)["return"]`; `get_origin(hint)`, `get_args(hint)` | `T \| None`, `<class 'typing.Union'>`, `(T, <class 'NoneType'>)` | introspection (How it works 20) |

The program ran to the end with a string and an `int` on a `Shelf[Item]`: catching step 2 is the type checker's job, and steps 5 to 9 show what a library that reads annotations at runtime sees.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `isinstance([1], list[int])` | `TypeError: isinstance() argument 2 cannot be a parameterized generic` ✅[^lab] | Parameterized generics are not accepted by `isinstance()` ✅[^stdtypes] |
| `int \| "Foo"` | `TypeError: unsupported operand type(s) for \|: 'type' and 'str'` ✅[^lab] | `\|` cannot take a forward-reference string; quote the whole union, `"int \| Foo"` ✅[^stdtypes] |
| `from __future__ import annotations` with `b: "str"` | `{'b': "'str'"}` ✅[^lab] | The future import stringifies the already-quoted text ✅[^howto-annotations] |
| `cls.__dict__.get('__annotations__')` on 3.14+ | may be `None` although the class has annotations | Storage is a private detail now; use `get_annotations()` ✅[^howto-annotations] |
| Names imported only under `if TYPE_CHECKING:` | `get_type_hints()` raises `NameError` | Use `Format.STRING` or `Format.FORWARDREF` to read them safely ✅[^typing] |
| `Base` has `a: int`; `Child(Base)` has `b: Annotated[str, "meta"]` and `c: "list[int]"`; compare `get_annotations(Child)` with `get_type_hints(Child)` | the first gives only `b` and `c`, with `c` still `'list[int]'`; the second adds `a`, resolves `c` to `list[int]` and strips `b` to `str` ✅[^lab] | `get_annotations` ignores inherited annotations; `get_type_hints` walks the MRO ✅[^annotationlib] ✅[^typing] |
| `TypeVar("X", int, str, bound=int)` | `TypeError: Constraints cannot be combined with bound=...` ✅[^lab] | Bounded or constrained, never both ✅[^typing] |
| `Union[int] is int`, `Optional[int] == int \| None` | both `True` ✅[^lab] | A one-argument union returns its argument ✅[^typing] |
| `Union[int, str] is Union[int, str]` | `False`, while `==` is `True` ✅[^lab] | Since 3.14 unions built with `Union[...]` are no longer cached; compare with `==` ✅[^whatsnew314] |
| `type Later = NotYetDefined` | defines fine; `Later.__value__` raises `NameError` ✅[^lab] | The alias value is evaluated on access ✅[^ref-simple] |
| `class Lazy[B: Missing]` | defines fine; reading `__bound__` raises `NameError` ✅[^lab] | Bounds are evaluated on access ✅[^ref-compound] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `type X = ...` (3.12+) | Lazy value, forward references without quotes, explicit type parameters ✅[^ref-simple] | Not a class: no `isinstance`; needs 3.12 |
| `X = ...` or `X: TypeAlias = ...` | Runs on old versions; `X` is the real object | Eager; `TypeAlias` is deprecated ✅[^typing] |
| Bracket generics `[T]` | No module-level `TypeVar`s, inferred variance ✅[^spec-generics] | Needs 3.12 (defaults 3.13) |
| `TypeVar` plus `Generic[T]` | Works on 3.11 and earlier ✅[^typing] | Variance by hand; must not be mixed with brackets ✅[^spec-generics] |
| `object` hint | Checker forces you to narrow before use ✅[^typing] | More `isinstance` checks in code |
| `Any` hint | Escape hatch for dynamic code ✅[^typing] | Errors in that value go unseen |
| `from __future__ import annotations` | Unquoted forward references on 3.7 to 3.13 too ✅[^pep749] | Strings make runtime introspection harder ✅[^ref-compound]; scheduled for removal ✅[^pep749] |

## Takeaways
- Never rely on hints for runtime validation; validate inputs explicitly, and run a type checker for the static guarantees. [rule-candidate]
- Read annotations with `annotationlib.get_annotations()` (pick `FORWARDREF` or `STRING` when names may be missing) or `typing.get_type_hints()`, not with `__annotations__` or a class `__dict__`. [rule-candidate]
- On 3.14+ code, drop quoted forward references and new uses of `from __future__ import annotations`. [rule-candidate]
- Write `list[int]`, `X | None` and `collections.abc.Callable`, not `typing.List`, `Optional` or `typing.Callable`. [rule-candidate]
- Prefer the bracket syntax and `type` aliases on 3.12+; never mix module-level `TypeVar`s into a bracket declaration. [rule-candidate]
- Hint `object` when a value may be anything and must be checked; reserve `Any` for code that cannot be typed.

## Verification status
- Verified: 113 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [typing — Support for type hints](https://docs.python.org/3/library/typing.html) — Python Software Foundation, living. Rank 1. Backs: no runtime enforcement; type aliases and `TypeAlias`; `Any` versus `object`; `Callable`; unions and `Optional`; `TypeVar` bounds, constraints, old form; `ParamSpec`, `TypeVarTuple`; `Self`; `get_type_hints`, `get_origin`, `get_args`; `TYPE_CHECKING`; deprecated aliases. [^typing]
- [annotationlib — Functionality for introspecting annotations](https://docs.python.org/3/library/annotationlib.html) — Python Software Foundation, living. Rank 1. Backs: the three evaluation models; `Format` members; `get_annotations()` behaviour. [^annotationlib]
- [Annotations Best Practices](https://docs.python.org/3/howto/annotations.html) — Python Software Foundation, living. Rank 1. Backs: prefer `get_annotations()`; class `__dict__` storage is private on 3.14+; double-quoted strings under the future import. [^howto-annotations]
- [Built-in Types: Type Annotation Types — Generic Alias, Union](https://docs.python.org/3/library/stdtypes.html) — Python Software Foundation, living. Rank 1. Backs: `GenericAlias`, no element checks, erasure, `isinstance` limits, `\|` with strings. [^stdtypes]
- [Compound statements: Type parameter lists; Annotations](https://docs.python.org/3/reference/compound_stmts.html) — Python Software Foundation, living. Rank 1. Backs: type parameter syntax, scope, `__type_params__`, lazy bounds and defaults, implicit `Generic`; annotations do not change semantics; the future import. [^ref-compound]
- [Simple statements: Annotated assignment statements; The type statement](https://docs.python.org/3/reference/simple_stmts.html) — Python Software Foundation, living. Rank 1. Backs: local and non-simple annotations never evaluated; `type` creates a lazily evaluated `TypeAliasType`. [^ref-simple]
- [Data model: Annotations](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: `__annotations__` is lazy and may run code; `__annotate__(format)` contract. [^datamodel]
- [What's new in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, living. Rank 1. Backs: annotate functions; future import unchanged and its removal timeline; uncached old-style unions. [^whatsnew314]
- [Generics](https://typing.python.org/en/latest/spec/generics.html) — The Python Typing Team, living. Rank 1. Backs: variance and its inference; default ordering; mixing traditional and new type parameters. [^spec-generics]
- [Type system concepts](https://typing.python.org/en/latest/spec/concepts.html) — The Python Typing Team, living. Rank 1. Backs: `object` versus `Any`. [^spec-concepts]
- [Type annotations](https://typing.python.org/en/latest/spec/annotations.html) — The Python Typing Team, living. Rank 1. Backs: unannotated functions treated as `Any`; name resolution under the future import. [^spec-annotations]
- [Special types in annotations](https://typing.python.org/en/latest/spec/special-types.html) — The Python Typing Team, living. Rank 1. Backs: `None` means `type(None)`. [^spec-special-types]
- [PEP 649 – Deferred Evaluation Of Annotations Using Descriptors](https://peps.python.org/pep-0649/) — Larry Hastings, 2021. Rank 1. Backs: `__annotations__` calls `__annotate__(1)` once and caches. [^pep649]
- [PEP 749 – Implementing PEP 649](https://peps.python.org/pep-0749/) — Jelle Zijlstra, 2024. Rank 1. Backs: the deprecation and removal plan for `from __future__ import annotations`. [^pep749]
- [PEP 695 – Type Parameter Syntax](https://peps.python.org/pep-0695/) — Eric Traut, 2022. Rank 1. Backs: why the old type variable scoping and variance confused developers. [^pep695]

## Related
- `python/typing/protocols-typeddict-and-narrowing.md` — structural types, `TypedDict`, `Literal`, `Final`, overloads and narrowing.
- `python/classes/dataclasses-enums-and-abcs.md` — a standard-library consumer of annotations.
- `python/iteration-and-functional/decorators-and-functools.md` — decorators that `ParamSpec` types.
- `python/fundamentals/functions-scopes-and-closures.md` — the function scopes that annotation scopes resemble.
- `python/fundamentals/objects-names-and-types.md` — what a runtime type is, as opposed to a hint.
