---
schema: knowledge-doc/v1
type: concept
topic: python/typing
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, typing, protocol, structural-typing, runtime-checkable, typeddict, literal, final, overload, override, narrowing, typeguard, typeis, assert-never, newtype, typeform, disjoint-base]
ranked-sources: true
---

# Protocols, TypedDict and type narrowing

## Summary
**TL;DR:** Most Python types are nominal: a class is a subtype only when it inherits. `Protocol` and `TypedDict` are structural: a type checker accepts any object with the right methods, or any dict with the right keys and value types. The interpreter enforces none of it: a `TypedDict` call returns a plain `dict`, `@runtime_checkable` only tests that member names exist, and `Literal`, `Final`, `@final`, `@override`, `ReadOnly`, `cast` and `NewType` change nothing, or set one marker attribute. Narrowing is how a checker learns a more precise type inside a branch: `isinstance`, a predicate returning `TypeIs` (both branches) or `TypeGuard` (true branch only), and `assert_never` for exhaustive `match` statements.
**Use this when:** an `isinstance` check against a protocol raises `TypeError` or accepts the wrong object, a `TypedDict` lets bad data through, you want the checker to catch a missed `match` case, a reassigned constant or an override that overrides nothing, or you choose between `TypeIs` and `TypeGuard`.
**Not this doc:** annotations, generics and type aliases → `python/typing/type-hints-and-generics.md`; dataclasses, enums and ABCs (abstract base classes) → `python/classes/dataclasses-enums-and-abcs.md`; the `match` statement itself → `python/fundamentals/control-flow-and-pattern-matching.md`; how dicts work → `python/data-structures/dicts-sets-and-hashing.md`.

## Problem
Each of these was measured in the lab ✅[^lab]:
- `SupportsClose` is a `Protocol` with one `close()` method and `Resource` defines `close()`, yet `isinstance(Resource(), SupportsClose)` raises `TypeError`; add `@runtime_checkable` and an object whose `close` is the number `42` passes.
- `Movie(title="Blade Runner", year="nineteen-eighty-two")` returns an ordinary `dict`; so do calls with a missing key or an extra one.
- `MAX_SIZE: Final = 9000` followed by `MAX_SIZE += 1` gives `9001`, and a subclass of a `@final` class is created.
- A predicate annotated `-> TypeIs[int]` that always returns `True` "proves" that `'x'` is an `int`.

The guarantees exist only when a type checker reads the code; the runtime keeps a few marker attributes and introspection helpers.

## Mental model
**Analogy:** nominal typing is a guest list: you get in only if your name, that is your class's ancestry, is on it. Structural typing is a skills test: anyone who can do the listed things gets in. The type checker gives the test before the event. At the event itself there is no examiner, only an optional doorman (`@runtime_checkable`) who checks that you carry something labelled `close`, without looking inside.

**Artifact** (measured in the lab ✅[^lab]):
```python
@runtime_checkable
class Closable(Protocol):
    def close(self) -> None: ...
class AttrNotMethod:
    close = 42
isinstance(AttrNotMethod(), Closable)      # True   only the name is checked

class Movie(TypedDict):
    title: str
    year: int
m = Movie(title="Blade Runner", year="nineteen-eighty-two")
type(m), m                                 # (<class 'dict'>, {'title': 'Blade Runner', 'year': 'nineteen-eighty-two'})
```

## How it works

### Nominal and structural types
1. For a class such as `str`, subtyping is subclassing: a nominal type. Protocols and typed dictionaries instead describe values by their attributes and methods, or their keys and value types; such structural types can be subtypes with no inheritance at all ✅[^spec-concepts]. PEP 484 (PEP = Python Enhancement Proposal) defined only nominal subtyping; PEP 544 added structural subtyping, also called static duck typing ✅[^typing] ✅[^pep544].

### Protocols
2. **Defining.** A protocol is a class with `typing.Protocol` among its bases; a class whose members have assignable types is implicitly assignable to it, so `close_all([f, r])` passes for a file and a `Resource` while `close_all([1])` is an error ✅[^spec-protocol]. The attributes and methods a class must have are the *protocol members* ✅[^spec-protocol]; `get_protocol_members()` lists them and `is_protocol()` tells whether a class is a protocol (both 3.13) ✅[^typing]. A protocol can be generic, `class GenProto[T](Protocol)` ✅[^typing]. In the lab `SupportsClose()` raised `TypeError: Protocols cannot be instantiated`, while a class that explicitly subclassed it inherited its method bodies ✅[^lab].
3. **At runtime.** A protocol without `@runtime_checkable` cannot be the second argument of `isinstance()` or `issubclass()` ✅[^typing]. With the decorator, the check looks only for the presence of the members and ignores their signatures and types ✅[^typing]: a `close(self, a, b, c)` method, a `close = 42` attribute and an instance with `name = 42` against a `name: str` protocol all passed ✅[^lab]. `issubclass()` works only with non-data protocols, those whose members are all methods ✅[^spec-protocol]; for `Named` it raised `TypeError: Protocols with non-method members don't support issubclass()` ✅[^lab]. Since 3.12 the check uses `inspect.getattr_static()` and the protocol's members are frozen when the class is created; the check can be surprisingly slow compared with one against an ordinary class, so `hasattr()` calls may suit performance-sensitive code ✅[^typing]. A checker should reject an `isinstance()` call whose first argument only "unsafely overlaps" the protocol (matches its names but not its types) ✅[^spec-protocol].
4. **Not inherited.** A sub-protocol of a runtime-checkable protocol must be decorated again ✅[^typing]. Since 3.15, `isinstance()` on an undecorated one is deprecated and will raise `TypeError` in 3.20 ✅[^whatsnew315]; the lab got `True` plus a `DeprecationWarning` naming 3.20 ✅[^lab].

### TypedDict
5. **A dict with a key schema.** A `TypedDict` declares which keys a dict should have and the type of each value; the expectation is checked by type checkers only, and at runtime its "instances" are plain dicts ✅[^typing]. In the lab a wrong value type, a missing key and an extra key were all accepted, `type(m)` was `dict`, and `isinstance(m, Movie)` raised `TypeError: TypedDict does not support instance and class checks` ✅[^lab]. PEP 589 names JSON (JavaScript Object Notation) objects as the canonical use and leaves runtime validation out on purpose ✅[^pep589].
6. **Required and optional keys.** All keys are required by default; `NotRequired[...]` (3.11) marks one key as optional, `total=False` makes all optional, and `Required[...]` brings one back ✅[^typing]. Use `__required_keys__` and `__optional_keys__` (frozensets) to introspect; `__total__` only echoes the `total` argument of that one class ✅[^typing]. With `from __future__ import annotations` or string annotations, those key sets may be wrong ✅[^typing].
7. **`ReadOnly` (3.13).** `title: ReadOnly[str]` makes `m["title"] = ...` a checker error, with no runtime check ✅[^typing]; the lab write succeeded, and `__readonly_keys__` was `frozenset({'title'})` ✅[^lab].
8. **Closed and extra items (3.15).** By default a `TypedDict` is open: it may hold keys beyond those declared. `closed=True` forbids extra keys; `extra_items=T` allows any extra key whose value has type `T`; both are inherited by subclasses and cannot be combined ✅[^typing]. `closed=True` means the same as `extra_items=Never`, and passing both is a runtime error ✅[^pep728]: `TypeError: Cannot combine closed=True and extra_items` ✅[^lab]. A closed base forces closed children; a base with mutable extra items forces the same extra items on its children ✅[^spec-typeddict]. The runtime keeps the arguments as `__closed__` (`True`, `False` or `None`) and `__extra_items__` (a type or `NoExtraItems`) ✅[^typing], and still builds `Closed(x=1, y=2)` with the undeclared `y` ✅[^lab].
9. **Typing `**kwargs`.** `def foo(**kwargs: Unpack[Movie])` tells a checker which keyword arguments the function takes ✅[^typing].

### Literal, Final, overloads and overrides
10. **`Literal`** says a value equals one of the given literals: `Literal['r', 'rb', 'w', 'wb']` rejects `'typo'` at check time ✅[^typing]. Checkers accept literal `int`, `str`, `bytes`, `bool`, enum members and `None`, and `Literal[3]` is a subtype of `int`; the runtime performs no checks ✅[^spec-literal]. In the lab `open_helper('typo')` ran, `Literal[1, 2, 1] == Literal[1, 2]` was `True`, and `isinstance('r', Mode)` raised `TypeError` ✅[^lab].
11. **`Final` and `@final`.** A `Final` name may be assigned exactly once and a class-level one not overridden in subclasses ✅[^spec-qualifiers]; a `@final` class may not be subclassed and a `@final` method not overridden ✅[^spec-qualifiers]. There is no runtime checking; since 3.11 `@final` sets `__final__ = True` where it can ✅[^typing]. The lab printed `9001` and created `Sub(Leaf)` ✅[^lab].
12. **`@overload`** lists several signatures for one function, for relations a union cannot state, such as "`int` in, `int` out; `slice` in, `bytes` out" ✅[^spec-overload]. The `@overload` definitions must be followed by exactly one undecorated implementation, which replaces them at runtime; calling an `@overload`-decorated function directly raises `NotImplementedError` ✅[^typing]. A checker wants at least two overloads, and an implementation unless the overloads sit in a stub file, a protocol or an abstract method ✅[^spec-overload]. `get_overloads()` (3.11) returns the definitions ✅[^typing]; in the lab it returned the three original functions, whose `...` bodies return `None` when called ✅[^lab].
13. **`@override` (3.12, PEP 698).** A checker reports an error when the decorated method overrides nothing in an ancestor, or when its type is not assignable to the overridden one ✅[^spec-class-compat]. There is no runtime check; the decorator sets `__override__ = True` ✅[^typing], and a method overriding nothing ran normally ✅[^lab].

### Narrowing
14. **Narrowing** is how a checker works out a more precise type for an expression inside a branch, from a condition called a type predicate: after `if isinstance(val, str):` the value is `str` in the `if` branch and `float` in the `else` branch of a `str | float` parameter ✅[^typing].
15. **`TypeGuard` (3.10, PEP 647)** marks a user-written predicate: when it returns `True`, the argument takes exactly the guarded type, which need not be a subtype (so `list[object]` can become `list[str]`); when it returns `False`, nothing is narrowed ✅[^typing]. Narrowing applies to the first positional argument, or the second for a method (after `self` or `cls`) ✅[^spec-narrowing].
16. **`TypeIs` (3.13, PEP 742)** narrows in both branches: on `True` to the intersection of the argument's known type and the `TypeIs` type, on `False` to the known type minus it ✅[^typing]. Its type must be assignable to the parameter's type ✅[^spec-narrowing]. It was added because `TypeGuard` can neither use the variable's previous type nor narrow on `False` ✅[^pep742]. Prefer `TypeIs` unless the types are incompatible or the function does not return `True` for every instance of the type ✅[^typing]. At runtime such a function just returns a `bool`; a wrong one makes the type system unsound, and writing it correctly is the author's responsibility ✅[^typing].
17. **`Never` and `assert_never`.** `Never` (and `NoReturn`) is the bottom type, with no values ✅[^typing]. Calling `assert_never(x)` in the last `case` makes a checker report an error if that line is reachable, that is if `x` is not `Never`; at runtime it raises ✅[^typing]: `AssertionError: Expected code to be unreachable, but got: 1.5` ✅[^lab]. Checkers should do this exhaustiveness check for enums and literal types ✅[^spec-literal].
18. **`cast`, `assert_type`, `reveal_type`.** `cast(T, v)` returns `v` unchanged without any check; `assert_type()` does nothing at runtime; `reveal_type(x)` prints the runtime type to `sys.stderr` and returns `x` ✅[^typing]. The lab printed `Runtime type is 'list'` ✅[^lab].
19. **`NewType`.** `UserId = NewType('UserId', int)` is a distinct type to a checker, treated as a subclass of `int`, while a type alias is exactly equivalent to its target; at runtime calling it returns the argument unchanged, so `some_value is UserId(some_value)` always holds, and subclassing it is invalid ✅[^typing]. The lab saw `True` for that identity and `TypeError: Cannot subclass an instance of NewType` ✅[^lab].

### New in 3.15
20. **`TypeForm` (PEP 747)** annotates a value that is itself a type expression, such as `int` or `str | None`: `TypeForm[T]` describes objects representing `T` or a type assignable to it, and `TypeForm(obj)` returns `obj` unchanged ✅[^typing]. A typed helper reads `def cast[T](typ: TypeForm[T], value: Any) -> T` ✅[^whatsnew315]. Correct use is enforced only by type checkers ✅[^pep747].
21. **`@disjoint_base` (PEP 800)** tells checkers that subclasses of a class `C` cannot also inherit from another disjoint base that is neither a parent nor a child of `C` ✅[^typing]. Its runtime counterpart is the *solid base*: class creation fails unless one base's solid base is a subclass of all the others, and which classes are solid bases depends on the implementation; in CPython (an implementation detail) a class with a non-empty `__slots__` and most built-ins such as `int` are solid bases ✅[^ref-compound]. The decorator itself only sets `__disjoint_base__ = True`, enforces nothing on user classes, and is meant mainly for stub files ✅[^pep800]. In the lab `class D3(D1, D2)` with two decorated classes was created, while `class IntStr(int, str)` and a class with two `__slots__` bases raised `TypeError: multiple bases have instance lay-out conflict` ✅[^lab].

## Worked example
Validating an order read from JSON, then dispatching on its status, run in the lab ✅[^lab]:
```python
type Status = Literal["new", "paid", "shipped"]
class Order(TypedDict):
    id: int
    status: Status
    note: NotRequired[str]
STATUSES = get_args(Status.__value__)
def is_order(obj: object) -> TypeIs[Order]:
    return (isinstance(obj, dict) and isinstance(obj.get("id"), int)
            and obj.get("status") in STATUSES and isinstance(obj.get("note", ""), str))
def next_step(order: Order) -> str:
    match order["status"]:
        case "new": return "charge card"
        case "paid": return "pack box"
        case "shipped": return "nothing"
        case _ as unreachable: assert_never(unreachable)
```

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | `STATUSES` | `('new', 'paid', 'shipped')` | `get_args()` reads a `Literal` |
| 2 | `good = json.loads('{"id": 7, "status": "paid"}')`; `is_order(good)` | `dict`, `True` | the check is code you wrote, not the `TypedDict` |
| 3 | `next_step(good)` | `'pack box'` | inside `if is_order(good):` a checker would treat `good` as `Order` (How it works 16) |
| 4 | `bad = json.loads('{"id": "7", "status": "lost"}')`; `is_order(bad)` | `False` | the hand-written check catches it |
| 5 | `Order(**bad)` | `{'id': '7', 'status': 'lost'}` | the `TypedDict` call checks nothing (How it works 5) |
| 6 | `forced = cast(Order, bad)`; `forced is bad` | `True` | `cast` only informs the checker (How it works 18) |
| 7 | `next_step(forced)` | `AssertionError: Expected code to be unreachable, but got: 'lost'` | `assert_never` is the runtime backstop |
| 8 | `Order.__required_keys__`, `__optional_keys__` | `['id', 'status']`, `['note']` (sorted) | `NotRequired` is recorded for introspection |

Adding `"refunded"` to `Status` without a new `case` makes a checker flag the `assert_never` line, because the argument there is no longer `Never` ✅[^typing].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `isinstance(x, Proto)` without `@runtime_checkable` | `TypeError: Instance and class checks can only be used with @runtime_checkable protocols` ✅[^lab] | Runtime checks are opt-in, since they are not type-safe ✅[^spec-protocol] |
| `issubclass(Thing, Named)` for a protocol with `name: str` | `TypeError: Protocols with non-method members don't support issubclass()` ✅[^lab] | A data attribute may be set only in `__init__`, invisible on the class ✅[^spec-protocol] |
| Undecorated sub-protocol in `isinstance()` | works, with a `DeprecationWarning` in 3.15 ✅[^lab] | `TypeError` from 3.20 ✅[^whatsnew315] |
| `Movie(title="Heat", year=1995, rating=8)` on an open `TypedDict` | builds the dict with `rating` ✅[^lab] | A checker should still flag extra keys in the construction ✅[^pep728] |
| `class ClosedChild(Closed): pass` | `ClosedChild.__closed__` is `None` ✅[^lab] | The attribute records only that class's argument ✅[^typing]; checkers treat the child as closed ✅[^spec-typeddict] |
| `get_overloads(process)[0](None)` for a `process()` with three overloads and an implementation | returns `None` ✅[^lab] | `get_overloads()` returns the `@overload`-decorated definitions themselves ✅[^typing], whose bodies are `...` |
| A lone `@overload def only(x: int) -> int: ...`, then `only(1)` | `NotImplementedError: You should not call an overloaded function...` ✅[^lab] | The decorated name is a stub that raises ✅[^typing] |
| `class AdminId(UserId): pass` | `TypeError: Cannot subclass an instance of NewType...` ✅[^lab] | Use `NewType('AdminId', UserId)` instead ✅[^typing] |
| `liar('x')` where `liar` returns `True` for anything | `True` ✅[^lab] | An incorrect `TypeIs` function is unsound; nothing verifies it ✅[^typing] |
| `Literal[1 + 2]` in an annotation | runs; checkers should reject it ✅[^spec-literal] | The runtime performs no checks on `Literal` arguments ✅[^spec-literal] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Protocol` | Matches classes with no inheritance link, even the file object `open()` returns ✅[^spec-protocol] | Runtime checks are names-only and slower ✅[^typing] |
| `hasattr()` in hot code | Cheaper than a protocol `isinstance()` ✅[^typing] | Says nothing to the checker |
| `TypedDict` | Data stays a plain `dict`, easy to serialize, JSON being the canonical use ✅[^pep589] | No validation; write it yourself; for a class with behaviour, see `python/classes/dataclasses-enums-and-abcs.md` |
| `TypeIs` | Narrows both branches, keeps known type ✅[^typing] | Narrowed type must fit the parameter ✅[^spec-narrowing] |
| `TypeGuard` | Can map `list[object]` to `list[str]` ✅[^typing] | No narrowing on `False` ✅[^typing] |
| `cast()` | No runtime check at all, so as fast as possible; tells the checker the type ✅[^typing] | Lies if wrong; prefer a real check |

## Takeaways
- Never trust a `TypedDict` or protocol hint for data from outside; validate with code and narrow with a `TypeIs` function. [rule-candidate]
- Use `@runtime_checkable` only for presence checks, and decorate every sub-protocol you test with `isinstance()`. [rule-candidate]
- End every `match` over a union, enum or `Literal` with `case _ as x: assert_never(x)`. [rule-candidate]
- Prefer `TypeIs` over `TypeGuard` unless the narrowed type does not fit the parameter. [rule-candidate]
- Mark overriding methods with `@override` and constants with `Final`; at runtime they at most set a marker attribute, and they let a checker catch drift. [rule-candidate]
- Treat `cast()` as a last resort.

## Verification status
- Verified: 105 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [typing — Support for type hints](https://docs.python.org/3/library/typing.html) — Python Software Foundation, living. Rank 1. Backs: nominal versus structural; `Protocol`, `runtime_checkable` and its limits; `TypedDict`, `Required`, `NotRequired`, `ReadOnly`, `closed`, `extra_items` and their attributes; `Unpack`; `Literal`; `Final`, `@final`; `@overload`, `get_overloads`; `@override`; narrowing, `TypeGuard`, `TypeIs`; `Never`, `assert_never`; `cast`, `assert_type`, `reveal_type`; `NewType`; `TypeForm`; `@disjoint_base`. [^typing]
- [Compound statements: Multiple inheritance](https://docs.python.org/3/reference/compound_stmts.html) — Python Software Foundation, living. Rank 1. Backs: solid bases as a CPython implementation detail. [^ref-compound]
- [What's new in Python 3.15](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, living. Rank 1. Backs: the sub-protocol deprecation; `TypeForm` example. [^whatsnew315]
- [Type system concepts](https://typing.python.org/en/latest/spec/concepts.html) — The Python Typing Team, living. Rank 1. Backs: nominal and structural types. [^spec-concepts]
- [Protocols](https://typing.python.org/en/latest/spec/protocol.html) — The Python Typing Team, living. Rank 1. Backs: defining protocols, members, data protocols and `issubclass`, unsafe overlap. [^spec-protocol]
- [Typed dictionaries](https://typing.python.org/en/latest/spec/typeddict.html) — The Python Typing Team, living. Rank 1. Backs: inheritance of openness. [^spec-typeddict]
- [Literals](https://typing.python.org/en/latest/spec/literal.html) — The Python Typing Team, living. Rank 1. Backs: legal parameters, no runtime checks, exhaustiveness. [^spec-literal]
- [Type qualifiers](https://typing.python.org/en/latest/spec/qualifiers.html) — The Python Typing Team, living. Rank 1. Backs: `@final` and `Final` rules. [^spec-qualifiers]
- [Overloads](https://typing.python.org/en/latest/spec/overload.html) — The Python Typing Team, living. Rank 1. Backs: why overloads, required implementation and exemptions. [^spec-overload]
- [Class type assignability: @override](https://typing.python.org/en/latest/spec/class-compat.html) — The Python Typing Team, living. Rank 1. Backs: the `@override` check. [^spec-class-compat]
- [Type narrowing](https://typing.python.org/en/latest/spec/narrowing.html) — The Python Typing Team, living. Rank 1. Backs: which argument is narrowed; `TypeIs` assignability rule. [^spec-narrowing]
- [PEP 544 – Protocols: Structural subtyping (static duck typing)](https://peps.python.org/pep-0544/) — Ivan Levkivskyi, Jukka Lehtosalo, Łukasz Langa, 2017. Rank 1. Backs: PEP 484 was nominal only; "static duck typing". [^pep544]
- [PEP 589 – TypedDict: Type Hints for Dictionaries with a Fixed Set of Keys](https://peps.python.org/pep-0589/) — Jukka Lehtosalo, 2019. Rank 1. Backs: JSON as the canonical use; no runtime validation. [^pep589]
- [PEP 728 – TypedDict with Typed Extra Items](https://peps.python.org/pep-0728/) — Zixuan James Li, 2023. Rank 1. Backs: `closed=True` equals `extra_items=Never`; combining them is a runtime error; extra keys in construction. [^pep728]
- [PEP 742 – Narrowing types with TypeIs](https://peps.python.org/pep-0742/) — Jelle Zijlstra, 2024. Rank 1. Backs: the limits of `TypeGuard` that motivated `TypeIs`. [^pep742]
- [PEP 747 – Annotating Type Forms](https://peps.python.org/pep-0747/) — David Foster, Eric Traut, 2024. Rank 1. Backs: `TypeForm` is enforced only by type checkers. [^pep747]
- [PEP 800 – Disjoint bases in the type system](https://peps.python.org/pep-0800/) — Jelle Zijlstra, 2025. Rank 1. Backs: `__disjoint_base__`, no runtime enforcement, intended for stubs. [^pep800]

## Related
- `python/typing/type-hints-and-generics.md` — how annotations are stored and evaluated, and generics.
- `python/classes/dataclasses-enums-and-abcs.md` — nominal interfaces (ABCs), enums and dataclasses.
- `python/fundamentals/control-flow-and-pattern-matching.md` — the `match` statement used for exhaustiveness.
- `python/data-structures/dicts-sets-and-hashing.md` — the `dict` a `TypedDict` really is.
- `python/metaprogramming/descriptors-and-attribute-lookup.md` — attribute lookup, which runtime protocol checks rely on.
