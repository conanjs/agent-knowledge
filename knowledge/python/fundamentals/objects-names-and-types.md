---
schema: knowledge-doc/v1
type: concept
topic: python/fundamentals
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, objects, identity, mutability, names, binding, int, float, bool, truthiness, floor-division, modulo, round]
ranked-sources: true
---

# Objects, names and the built-in scalar types

## Summary
**TL;DR:** Every Python value is an object with an identity, a type and a value; a variable is only a name bound to an object, so `y = x` never copies anything. Whether a change made through one name shows through another depends on the object's type being mutable (list, dict) or immutable (int, str, tuple). Integers have unlimited precision, floats are usually C doubles, `bool` is a subtype of `int`; `//` rounds toward minus infinity, `%` takes the sign of the divisor, and `round()` sends halves to the even neighbour.
**Use this when:** a change "leaks" between two variables, `is` and `==` disagree, an integer division or `round()` result looks off by one, or an `if value:` test rejects a legitimate `0`.
**Not this doc:** how floats are stored and rounded → `floating-point/`; `global`, `nonlocal` and closures → `python/fundamentals/functions-scopes-and-closures.md`; copying containers → `python/data-structures/lists-tuples-and-sequences.md`.

## Problem
Code written with habits from other languages misbehaves in ways that look random:
- `y = x` followed by `y.append(10)` also changes `x`.
- `-7 // 2` is `-4`, not `-3`; `-7 % 3` is `2`, not `-1`.
- `round(2.5)` is `2`, and `round(2.675, 2)` is `2.67`.
- `if not qty:` rejects a quantity of `0` as if it were missing.
- `a is b` is `True` for one pair of equal integers and `False` for another.

Each follows a documented rule of the data model or the numeric types.

## Mental model
**Analogy:** objects are suitcases and names are luggage tags tied to them. `y = x` ties a second tag to the same suitcase; it does not pack a new one. Opening the suitcase through either tag (mutating it) changes what both tags reach. Retying a tag to another suitcase (`x = x + 1` on an int) leaves the other tag where it was.

**Artifact** (measured in the lab ✅[^lab]):
```python
x = []; y = x; y.append(10)
x, x is y              # ([10], True)   one list, two names
a = 5; b = a; a = a + 1
a, b                   # (6, 5)         a now names a new int; b still names 5
t = (1, [2]); t[1].append(3)
t                      # (1, [2, 3])    the tuple is immutable, the list inside is not
```

## How it works
1. **Every object has an identity, a type and a value.** Identity never changes after creation (in CPython, `id(x)` is the memory address); the type is unchangeable too and decides which operations the object supports ✅[^datamodel]. `type(1)` is `int`, and `type(int)` is `type`: types are objects as well ✅[^lab].
2. **Names refer to objects; binding operations create the reference.** The constructs that bind a name include function parameters, `def`, `class`, assignment and assignment expressions (`:=`), `for` targets, the target after `as` in `with`, `except` and `match`, capture patterns, `import`, and the `type` statement ✅[^execmodel]. `y = x` creates a new name for the object `x` names, not a copy ✅[^faq].
3. **Mutability belongs to the type.** Numbers, strings and tuples are immutable; lists and dictionaries are mutable ✅[^datamodel]. An immutable container that holds a mutable object still counts as immutable, because the identities of the objects it contains cannot change, even though its value changes when the inner object does ✅[^datamodel].
4. **`is` compares identity, `==` compares value.** `x is y` is true only when both are the same object ✅[^expressions]. For immutable types, an operation may return an existing object with the same type and value, so after `a = 1; b = 1` the two names may or may not share one object; after `c = []; d = []` they are guaranteed to be two new lists ✅[^datamodel]. Comparisons to singletons such as `None` should always use `is` or `is not` ✅[^pep8].
5. **Numeric types.** There are three: `int`, `float` and `complex`; `bool` is a subtype of `int`, integers have unlimited precision, and floats are usually C doubles (`sys.float_info` describes them) ✅[^stdtypes].
   - `/` always returns a float: `4 / 2` is `2.0` ✅[^lab].
   - `//` is floor division, always rounded toward minus infinity: `(-1)//2` is `-1` ✅[^stdtypes].
   - `%` always has the sign of its second operand (or is zero), and its absolute value is smaller than the second operand's ✅[^expressions]. So `x == (x // y) * y + x % y` holds for both signs ✅[^lab].
   - `round(x)` rounds to the closest multiple of 10 to the power minus `ndigits`; on a tie it picks the even choice, so `round(0.5)` and `round(-0.5)` are `0` and `round(1.5)` is `2` ✅[^functions].
   - Decimal `int` ↔ `str` conversion is capped at 4,300 digits by default (a mitigation for CVE-2020-10735, a Common Vulnerabilities and Exposures identifier, because no base-10 conversion runs in linear time); hexadecimal, octal and binary conversions are unlimited ✅[^stdtypes].
6. **Truth value testing.** An object is true unless its class defines `__bool__()` returning `False` or `__len__()` returning zero. The built-in false values are `None` and `False`, zero of any numeric type, and empty sequences and collections (`''`, `()`, `[]`, `{}`, `set()`, `range(0)`) ✅[^stdtypes]. `or` and `and` return one of their operands, not necessarily a `bool` ✅[^stdtypes]: `0 or 'default'` is `'default'` ✅[^lab]. Since 3.14, `NotImplemented` in a boolean context raises `TypeError` ✅[^datamodel].
7. **Comparisons chain.** `x < y <= z` means `x < y and y <= z`, except that `y` is evaluated once and `z` not at all when `x < y` is false ✅[^expressions].
8. **`None` is a singleton.** Its type has one value and one object; functions that don't explicitly return anything return it; it is false ✅[^datamodel].

## Worked example
Splitting a bill of 1,000 cents between 3 people, then refunding it, with every value measured in the lab ✅[^lab]:

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | `share, rest = divmod(1000, 3)` | `333, 1` | for integers `divmod(a, b)` is `(a // b, a % b)` ✅[^functions] |
| 2 | `[share + (1 if i < rest else 0) for i in range(3)]` | `[334, 333, 333]`, sum `1000` | no cent lost |
| 3 | `divmod(-1000, 3)` for the refund | `(-334, 2)` | `//` floors toward minus infinity, `%` takes the divisor's sign (How it works 5) |
| 4 | `int(-1000 / 3)` | `-333` | `int()` of a float truncates toward zero ✅[^functions], unlike `//` |
| 5 | `round(1000 / 3, 2)` | `333.33` | fine for display; keep money as integer cents |
| 6 | `qty = int(' 0 ')`, then `not qty` | `0`, `True` | `int()` accepts surrounding whitespace ✅[^functions]; `0` is false, so `if not qty` would treat a real 0 as missing |

Steps 3 and 4 give different answers for the same division: pick `//` when the result must satisfy `(a // b) * b + a % b == a`, and say so in the code.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `0.1 + 0.2 == 0.3` | `False` (the sum is `0.30000000000000004`) ✅[^lab] | Binary floats cannot hold most decimal fractions; compare with `math.isclose` ✅[^lab] |
| `round(2.675, 2)` | `2.67`, not `2.68` | `2.675` is stored as a float slightly below it; documented as "not a bug" ✅[^functions] |
| `True + True` | `2` ✅[^lab] | `bool` is a subtype of `int` ✅[^stdtypes] |
| `10**6 is int('1000000')` | `False` in 3.15.2, while `257 is int('257')` was `True` ✅[^lab] | Reuse of immutable objects is an implementation choice and should not be relied on ✅[^datamodel] |
| `int('2' * 5000)` | `ValueError: Exceeds the limit (4300 digits) for integer string conversion` ✅[^lab] | Default digit cap; `sys.set_int_max_str_digits()` changes it ✅[^stdtypes] |
| `'1' + 1` | `TypeError: can only concatenate str (not "int") to str` ✅[^lab] | No implicit conversion between `str` and `int` |
| `bool(float('nan'))`, `bool('0')`, `bool([0])` | all `True` ✅[^lab] | Only zero numbers and empty collections are false |
| `bool(NotImplemented)` | `TypeError` ✅[^lab] | Changed in 3.14 (it was `True` with a `DeprecationWarning`) ✅[^datamodel] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `if value is None:` | Rejects only the missing value; `0`, `''` and `[]` pass. PEP 8 (the Python Enhancement Proposal that sets the style guide) warns against writing `if x` when `if x is not None` is meant ✅[^pep8] | Slightly longer than `if not value:` |
| `if not value:` | Short; treats every empty or zero value alike | Also rejects legitimate `0`, `0.0` and `''` |
| Integer cents with `divmod` | Exact; the parts always add up | Formatting needed for display |
| `float` amounts with `round()` | Simple | Representation error and ties-to-even surprises; see `floating-point/choosing-and-comparing-numbers.md` |

## Takeaways
- Treat assignment as "add a name", never as "copy"; copy explicitly when two names must not share a mutable object. [rule-candidate]
- Compare to `None` with `is` / `is not`; compare values with `==`; never use `is` on numbers or strings. [rule-candidate]
- Use `//` and `%` (or `divmod`) when the remainder matters, and remember both follow the divisor's sign.
- Test for a missing value with `is None`, not with truthiness, when `0` or `''` are valid. [rule-candidate]

## Verification status
- Verified: 41 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Data model: Objects, values and types](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: identity, type and value; mutability; object reuse for immutable types; `None`; `NotImplemented` in a boolean context. [^datamodel]
- [Execution model: Naming and binding](https://docs.python.org/3/reference/executionmodel.html) — Python Software Foundation, living. Rank 1. Backs: names refer to objects; the binding constructs. [^execmodel]
- [Expressions](https://docs.python.org/3/reference/expressions.html) — Python Software Foundation, living. Rank 1. Backs: `is`, the sign of `%`, chained comparisons. [^expressions]
- [Built-in Types](https://docs.python.org/3/library/stdtypes.html) — Python Software Foundation, living. Rank 1. Backs: truth value testing, `and`/`or`, numeric types, floor division, the integer string conversion limit. [^stdtypes]
- [Built-in functions](https://docs.python.org/3/library/functions.html) — Python Software Foundation, living. Rank 1. Backs: `round()` ties and `round(2.675, 2)`; `divmod()`; `int()` truncation and accepted whitespace. [^functions]
- [Programming FAQ: Why did changing list 'y' also change list 'x'?](https://docs.python.org/3/faq/programming.html) — Python Software Foundation, living. Rank 1. Backs: `y = x` does not copy. [^faq]
- [PEP 8 – Style Guide for Python Code](https://peps.python.org/pep-0008/) — Guido van Rossum, Barry Warsaw, Alyssa Coghlan, 2001. Rank 1. Backs: compare to singletons with `is`; `if x` versus `if x is not None`. [^pep8]

## Related
- `python/fundamentals/control-flow-and-pattern-matching.md` — where truthiness and comparisons are used.
- `python/data-structures/lists-tuples-and-sequences.md` — shallow and deep copies.
- `floating-point/rounding-and-error.md` — why `0.1 + 0.2` is not `0.3`.
