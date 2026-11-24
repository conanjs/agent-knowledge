---
schema: knowledge-doc/v1
type: concept
topic: python/fundamentals
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, control-flow, indentation, if, for, while, range, break, continue, loop-else, pass, walrus, assignment-expression, match, pattern-matching, match-args]
ranked-sources: true
---

# Control flow and structural pattern matching

## Summary
**TL;DR:** Python groups statements by indentation, not braces. `for` walks any iterable and leaves its loop variable bound after the loop; a loop's `else` runs only when the loop ends without `break`. `:=` assigns inside an expression. `match` tries its `case` patterns from the top and runs the first one that fits; a bare name in a pattern captures (assigns) instead of comparing, so constants must be written as dotted names such as `Color.RED`.
**Use this when:** a `match` takes the wrong branch or fails with "makes remaining patterns unreachable", a loop skips items after some were removed, a loop variable holds an unexpected value after the loop, or it is unclear when a loop's `else` runs.
**Not this doc:** truthiness and chained comparisons → `python/fundamentals/objects-names-and-types.md`; the scope rules behind `:=` and capture patterns → `python/fundamentals/functions-scopes-and-closures.md`; `try`/`finally` → `python/errors-and-resources/exceptions-and-exception-groups.md`; what `for` asks an iterable for, and comprehensions → `python/iteration-and-functional/iterators-generators-and-itertools.md`; enums and dataclasses as match targets → `python/classes/dataclasses-enums-and-abcs.md`.

## Problem
Each of these surprises follows a documented rule:
- `case RED:` (with `RED = 'red'` defined above the `match`) matches every value and rebinds `RED`; followed by another `case`, the code does not even compile.
- Removing every `2` from `[1, 2, 2, 3, 2, 4]` inside `for v in nums:` leaves a `2` behind.
- After `for i in range(3): pass`, `i` is `2`; after a loop over an empty list, the loop variable does not exist at all.
- The `else` under a `for` reads like "if the loop never ran", but it runs whenever no `break` happened.
- `match "ab": case [x, y]:` does not match, although a string is a sequence.
- `match True: case 1:` matches, but `match 1: case True:` does not.

## Mental model
**Analogy:** a `match` statement is a stack of stencils tried from the top. The value is held against each stencil in turn, the first one it fits wins, and the rest are never tried. Printed parts of a stencil (the literal `0`, the dotted name `Color.RED`, the outline "two items") must line up with the value. Holes (a bare name such as `y`) let anything through and copy what shows into a variable. A stencil that is one big hole, `case RED:`, fits every value.

**Artifact** (measured in the lab ✅[^lab]):
```python
def describe(point):
    match point:
        case (0, 0):                  # all printed: only (0, 0) fits
            return "origin"
        case (0, y):                  # 0 is printed, y is a hole
            return f"on y axis at {y}"
        case (x, 0):
            return f"on x axis at {x}"
        case (x, y):                  # two holes: any 2-item sequence
            return f"at {x},{y}"
        case _:                       # wildcard: fits anything, binds nothing
            return "not a point"

[describe(p) for p in [(0, 0), (0, 5), (3, 0), (2, 2), "hi"]]
# ['origin', 'on y axis at 5', 'on x axis at 3', 'at 2,2', 'not a point']
```

## How it works
### Blocks and branches
1. **Indentation is the block structure.** A compound statement is made of clauses; each clause header starts with a keyword and ends with a colon, and is followed by a suite: simple statements on the same line, or an indented block on the next lines ✅[^compound]. Only the indented form may hold nested compound statements, so `if a: if b: ...` on one line is a syntax error ✅[^compound]. The tokenizer keeps a stack of indentation levels: a deeper line pushes a level and emits an `INDENT` token, a shallower line must equal a level already on the stack, and each level popped emits a `DEDENT` ✅[^lexical]. Mixing tabs and spaces so that the meaning depends on the width of a tab raises `TabError` ✅[^lexical]; in the lab the message is `inconsistent use of tabs and spaces in indentation`, and a dedent to a level never used gives `IndentationError: unindent does not match any outer indentation level` ✅[^lab].
2. **`if` / `elif` / `else`.** The conditions are evaluated one by one until one is true; that suite runs and no other part of the statement is evaluated; if all are false, the `else` suite runs, if present ✅[^compound]. `elif` means "else if", and an `if` … `elif` chain stands in for the `switch` of other languages ✅[^tut-controlflow]. What counts as true is truth value testing, explained in `python/fundamentals/objects-names-and-types.md`.
3. **Conditional expression.** `x if C else y` evaluates `C` first, then only `x` (when `C` is true) or only `y` ✅[^expressions]. The older idiom `C and x or y` gives a wrong result when `x` is false ✅[^faq]. With `C = True`, `C and 0 or 99` is `99`, while `0 if C else 99` is `0` ✅[^lab].

### Loops
4. **`for` iterates any iterable.** The expression after `in` is evaluated once and should give an iterable; an iterator (an object that hands out the items one at a time) is created from it, and each item is assigned to the target with the normal assignment rules before the suite runs ✅[^compound]. Assigning to the loop variable inside the body does not change what comes next, because the next item overwrites it ✅[^compound]. The target names are not deleted when the loop ends; if the iterable was empty, they were never assigned ✅[^compound].
5. **`range()` supplies numbers.** `range(stop)` and `range(start, stop, step)` take integers; `start` defaults to `0`, `step` to `1`, and a zero `step` raises `ValueError` ✅[^stdtypes]. The end point is never included, and a range does not build a list: it hands out the items as the loop asks for them ✅[^tut-controlflow]. In the lab, `list(range(10, 0, -3))` is `[10, 7, 4, 1]` and `sys.getsizeof(range(10**12))` is `48` bytes ✅[^lab]. To loop over the positions of a sequence, `enumerate()` is usually more convenient than `range(len(a))` ✅[^tut-controlflow].
6. **`while`** tests its condition and, while it is true, runs the body and tests again ✅[^compound].
7. **`break` and `continue`.** `break` ends the nearest enclosing loop and skips its `else`; when it ends a `for`, the loop variable keeps its current value ✅[^simple]. `continue` starts the next cycle of the nearest enclosing loop ✅[^simple]. Both may appear only inside a loop, not inside a function or class defined in that loop, and if either leaves a `try` that has a `finally`, the `finally` runs first ✅[^simple].
8. **The loop `else` clause** runs when the loop ends on its own: a `for` when its iterator is exhausted, a `while` when its condition becomes false, even on the first test ✅[^compound]. `break` skips it, and so do `return` and a raised exception ✅[^tut-controlflow]. Read it as "no break": it is closer to the `else` of a `try` (runs when no exception occurred) than to the `else` of an `if` ✅[^tut-controlflow].
9. **`pass`** does nothing; it fills a place where a statement is required, such as an empty function or class body ✅[^simple]. The ellipsis `...` is often used the same way, by convention only ✅[^tut-controlflow].

### Assignment expressions (`:=`, PEP 572)
10. **`NAME := expr` assigns and returns the value** (added in 3.8 by PEP 572, the Python Enhancement Proposal that specified it) ✅[^expressions]. A test can keep what it tested: `if m := re.search(r"\d+", "id=42"):` enters the block with `m.group()` equal to `'42'` ✅[^lab].
11. **Where parentheses are needed.** An unparenthesized `:=` is not allowed as a whole expression statement, at the top of an assignment's right-hand side, as a keyword argument's value, as a default value, in an annotation or directly in a `lambda` ✅[^pep572]. In `if` and `while` headers no parentheses are needed ✅[^expressions]. The rule leaves no position where both `y = f(x)` and `y := f(x)` are valid ✅[^pep572].
12. **Scope.** `:=` creates no new scope: the target is bound in the current scope, and inside a comprehension it is bound in the scope that contains the comprehension ✅[^pep572]. So after `[total := total + v for v in [1, 2, 3, 4]]` the list is `[1, 3, 6, 10]` and `total` is `10` ✅[^lab]. It may not rebind the comprehension's own loop variable, and may not appear in a comprehension inside a class body ✅[^pep572].

### Structural pattern matching (`match`, PEP 634)
13. **The statement.** `match` and `case` are soft keywords: they are keywords only inside a match statement ✅[^lexical], so `match = 3` is still a valid assignment ✅[^lab]. The expression after `match`, the subject, is evaluated once (a comma in it builds a tuple); the case blocks are tried in order, and the first whose pattern succeeds and whose guard, if any, is true runs; no other block runs ✅[^compound]. If no case matches, the statement completes without running any block ✅[^compound] and no error is raised ✅[^lab]. Names bound by the successful match stay bound after the statement ✅[^compound]. After a failed attempt, some names may or may not have been bound: code should rely on neither ✅[^pep634].
14. **The pattern kinds.**

    | Pattern | Example | Succeeds when | Binds |
    |---|---|---|---|
    | Literal | `404`, `"go"`, `-1`, `3 + 4j`, `None` | `subject == literal`; for `None`, `True` and `False`, `subject is literal` ✅[^compound] | nothing |
    | Capture | `x` | always ✅[^compound] | `x` to the subject |
    | Wildcard | `_` | always ✅[^compound] | nothing |
    | Value | `Color.RED`, `math.pi` | the dotted name, looked up normally, `==` the subject ✅[^compound] | nothing |
    | Sequence | `[x, y, *rest]`, `(x, y, *rest)` | the subject is a sequence other than `str`, `bytes` or `bytearray`, and its length fits ✅[^compound] | each item's names; `rest` gets a list |
    | Mapping | `{"sleep": s, **rest}` | the subject is a mapping holding every listed key with a matching value ✅[^compound] | the values; `rest` gets the other keys |
    | Class | `Point(0, y=yy)` | `isinstance(subject, Point)`, then each keyword subpattern matches the attribute of that name ✅[^compound] | names in the subpatterns |
    | OR | `401 \| 403 \| 404` | an alternative matches, tried left to right; every alternative must bind the same names ✅[^compound] | the winning alternative's names |
    | AS | `("go" \| "move") as verb` | the pattern on the left matches ✅[^compound] | `verb` to the subject |

15. **Literal details.** f-strings and t-strings cannot be literal patterns ✅[^compound]. Since 3.15 a literal may carry a unary plus, `case +1:`, mirroring the unary minus that was already accepted ✅[^whatsnew315].
16. **Sequence details.** `[...]` and `(...)` mean the same, but one pattern in parentheses without a comma, `(3 | 4)`, is only a grouping ✅[^compound]. At most one starred subpattern is allowed, in any position ✅[^compound]. Sequence patterns match lists, tuples and other sequences, but not iterators or strings ✅[^tut-controlflow].
17. **Mapping details.** Extra keys in the subject are ignored; `**rest` collects them, and `**_` is not allowed because it would be redundant ✅[^tut-controlflow]. Keys are looked up with the mapping's two-argument `get()`, so a key that `__missing__()` would create does not count as present ✅[^compound]. Matching `{"k": val}` against an empty `defaultdict(int)` fails and leaves it empty ✅[^lab].
18. **Class patterns and `__match_args__`.** Positional subpatterns are turned into keyword subpatterns through the class attribute `__match_args__`, a tuple of attribute names: with `("x", "y")`, `case Point(1, v)` means `case Point(x=1, y=v)` ✅[^datamodel]. A missing `__match_args__` counts as `()`, and more positional subpatterns than it lists raise `TypeError` ✅[^datamodel]; the lab message is `TypeError: Point() accepts 2 positional sub-patterns (3 given)` ✅[^lab]. Dataclasses and named tuples get a generated `__match_args__`; for a dataclass it follows the order of the `__init__()` parameters ✅[^pep634], so one with fields `dx` and `dy` has `('dx', 'dy')` ✅[^lab]. For `bool`, `bytearray`, `bytes`, `dict`, `float`, `frozendict`, `frozenset`, `int`, `list`, `set`, `str` and `tuple`, one positional subpattern matches the whole subject: `int(0 | 1)` matches `0` but not `0.0` ✅[^compound].
19. **Guards.** In `case P if cond:`, `cond` is evaluated only after `P` succeeded, so its names are already bound; a false guard moves on to the next case ✅[^compound]. Guards run in case order, one at a time, and stop at the selected case ✅[^compound].
20. **An always-matching case goes last.** A case with no guard whose pattern always succeeds (a capture, a wildcard, or an OR or AS pattern built on one) may appear only once, as the last case ✅[^compound]. A bare name is always a capture, never a comparison, so constants in patterns must be qualified names ✅[^pep636].

## Worked example
An event loop that dispatches on the shape of each event, skips noise with `continue`, stops at `esc` with `break`, and reports through the loop's `else` when no quit event arrived. Every value below was measured in the lab ✅[^lab].

```python
def handle(events):
    log, handled = [], 0
    for i, ev in enumerate(events):
        match ev:
            case {"type": "click", "pos": [0, 0]}:
                log.append("click at origin")
            case {"type": "click", "pos": [x, y], "button": ("left" | "middle") as b}:
                log.append(f"{b} click at {x},{y}")
            case {"type": "key", "key": "esc"}:
                log.append(f"quit at event {i}")
                break
            case {"type": "key", "key": str(k)} if len(k) == 1:
                log.append(f"key {k!r}")
            case _:
                log.append(f"skip {ev!r}")
                continue
        handled += 1
    else:
        log.append("no quit event")
    return log, handled, i

events = [
    {"type": "click", "pos": [3, 4], "button": "left"},
    {"type": "key", "key": "q"},
    "noise",
    {"type": "click", "pos": (5, 5), "button": "right"},
    {"type": "click", "pos": [0, 0], "button": "right", "extra": True},
    {"type": "key", "key": "esc"},
    {"type": "key", "key": "x"},
]
```

| Event | Case that fits | Log line | Why |
|---|---|---|---|
| 0 | second | `left click at 3,4` | `[x, y]` captures the list items; `("left" \| "middle") as b` binds `b` |
| 1 | fourth | `key 'q'` | `str(k)` checks the type and binds the whole value; the guard `len(k) == 1` is true |
| 2 | `_` | `skip 'noise'` | a string is not a mapping; `continue` skips `handled += 1` |
| 3 | `_` | `skip {'type': 'click', 'pos': (5, 5), 'button': 'right'}` | the tuple `(5, 5)` fits `[x, y]`, but `"right"` is neither alternative |
| 4 | first | `click at origin` | the extra keys `button` and `extra` are ignored |
| 5 | third | `quit at event 5` | `break` ends the loop: the `else` is skipped and event 6 is never read |

The call returns `handled = 3` and `i = 5`: the loop variable kept its value after `break`. Calling `handle(events[:3])` logs the first three lines, then `no quit event` from the `else`, and returns `handled = 2`, `i = 2`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `case RED:` as the last case, `RED = "red"` defined earlier | Matches `"blue"` and rebinds `RED` to `'blue'` ✅[^lab] | A bare name is a capture pattern ✅[^pep636]; use `Color.RED` |
| `case RED:` followed by another case | `SyntaxError: name capture 'RED' makes remaining patterns unreachable`; `case _:` first gives `wildcard makes remaining patterns unreachable` ✅[^lab] | An always-matching case must be last ✅[^compound] |
| `match True:` against `case 1:` | Matches ✅[^lab] | Literals compare with `==` ✅[^compound], and booleans are a subtype of integers ✅[^stdtypes] |
| `match 1:` against `case True:` | Does not match ✅[^lab] | `True`, `False` and `None` compare with `is` ✅[^compound] |
| `True` against `case int(0 \| 1):` | Matches ✅[^lab] | `True` is an `int` instance and `True == 1`; put `case bool():` first to separate them |
| `"ab"` or `iter([1, 2])` against `case [x, y]:` | No match ✅[^lab] | Strings and iterators are excluded from sequence patterns ✅[^tut-controlflow] |
| `{"a": 1, **_}` as a pattern | `SyntaxError: invalid syntax` ✅[^lab] | `**_` is redundant, so it is not allowed ✅[^tut-controlflow] |
| `case x, x:` or `case [x] \| y:` | `SyntaxError: multiple assignments to name 'x' in pattern`; `alternative patterns bind different names` ✅[^lab] | A name binds once per pattern; OR alternatives bind the same names ✅[^compound] |
| Removing every `2` from `[1, 2, 2, 3, 2, 4]` inside `for v in nums:` | Leaves `[1, 3, 2, 4]`: the item right after each removed one is skipped ✅[^lab] | Loop over a copy (`nums[:]`, `d.copy().items()`) or build a new collection ✅[^tut-controlflow] |
| Adding keys to a dict inside `for key in d:` | `RuntimeError: dictionary changed size during iteration` ✅[^lab] | Adding or deleting entries while iterating a dict may raise `RuntimeError` or miss entries ✅[^stdtypes] |
| Reading the loop variable after an empty loop, inside a function | `UnboundLocalError: cannot access local variable 'j' where it is not associated with a value` ✅[^lab] | The target was never assigned ✅[^compound]; a local used before binding raises `UnboundLocalError` ✅[^execmodel] |
| `y := f(x)` as a statement | `SyntaxError: invalid syntax`; `(y := f(x))` compiles ✅[^lab] | Forbidden unparenthesized at statement level ✅[^pep572] |
| `[i := i + 1 for i in range(5)]` | `SyntaxError: assignment expression cannot rebind comprehension iteration variable 'i'` ✅[^lab] | The loop variable is local to the comprehension, the `:=` target is not ✅[^pep572] |
| `f'{x:=10}'` with `x = 10` | `'        10'`: no assignment happens ✅[^lab] | In an f-string, `:` starts the format options, so `=10` goes to the formatter; write `f'{(x:=10)}'` to assign ✅[^pep572] |
| `break`, `continue` or `return` inside `finally` | Compiles with `SyntaxWarning: 'break' in a 'finally' block` ✅[^lab] | The warning is new in 3.14 (PEP 765) ✅[^whatsnew314] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `if` / `elif` chain | Any condition, in any order | Repeats the subject; destructuring done by hand |
| `match` | Tests the shape and unpacks sequences, mappings and objects in one step | Needs 3.10 or later ✅[^compound]; the bare-name capture trap; constants must be dotted |
| Loop `else` for "searched, not found" | No flag variable | Easy to misread as the `else` of the `if` inside the loop ✅[^tut-controlflow] |
| Flag variable checked after the loop | Obvious to any reader | One more piece of state to keep right |
| `:=` in a condition | Tests and keeps a value in one place | Parentheses needed in many positions; the target outlives a comprehension ✅[^pep572] |

## Takeaways
- In a `case`, write constants as dotted names (`Color.RED`, `HTTPStatus.OK`); a bare name always captures. [rule-candidate]
- Put the catch-all `case _:` last, once.
- Never add to or remove from a list or dict while looping over it; loop over a copy or build a new collection. [rule-candidate]
- Read a loop's `else` as "no break", and use it for search loops.
- Do not read a `for` variable after the loop unless the loop surely ran, or bind it before the loop. [rule-candidate]
- Write `x if c else y`, never `c and x or y`. [rule-candidate]
- Put `case bool():` before `case int(...)` when `True` and `1` must be told apart.

## Verification status
- Verified: 104 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [8. Compound statements](https://docs.python.org/3/reference/compound_stmts.html) — Python Software Foundation, living. Rank 1. Backs: clauses and suites; `if`, `while`, `for` and the loop `else`; the `match` statement, its patterns, guards and irrefutable cases, and completion when no case matches; built-in classes in class patterns. [^compound]
- [7. Simple statements](https://docs.python.org/3/reference/simple_stmts.html) — Python Software Foundation, living. Rank 1. Backs: `pass`, `break`, `continue`. [^simple]
- [2. Lexical analysis: Indentation, Soft keywords](https://docs.python.org/3/reference/lexical_analysis.html) — Python Software Foundation, living. Rank 1. Backs: the indentation stack, `INDENT`/`DEDENT`, `TabError`; `match` and `case` as soft keywords. [^lexical]
- [6. Expressions: Conditional expressions, Assignment expressions](https://docs.python.org/3/reference/expressions.html) — Python Software Foundation, living. Rank 1. Backs: evaluation order of `x if C else y`; `:=` returns its value and needs no parentheses in `if`/`while`. [^expressions]
- [4. Execution model: Resolution of names](https://docs.python.org/3/reference/executionmodel.html) — Python Software Foundation, living. Rank 1. Backs: `UnboundLocalError` for a local used before binding. [^execmodel]
- [3. Data model: Customizing positional arguments in class pattern matching](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: `__match_args__`. [^datamodel]
- [Built-in Types: Ranges, Dictionary view objects](https://docs.python.org/3/library/stdtypes.html) — Python Software Foundation, living. Rank 1. Backs: `range` arguments and `ValueError`; changing a dict while iterating; booleans as a subtype of integers. [^stdtypes]
- [4. More Control Flow Tools](https://docs.python.org/3/tutorial/controlflow.html) — Python Software Foundation, living. Rank 1. Backs: `elif` and `switch`; looping over a copy; `range` end point and laziness; `enumerate()`; loop `else`; `...` as a placeholder; strings and iterators in sequence patterns; mapping patterns and `**_`. [^tut-controlflow]
- [Programming FAQ: Is there an equivalent of C's "?:" ternary operator?](https://docs.python.org/3/faq/programming.html) — Python Software Foundation, living. Rank 1. Backs: the `and`/`or` idiom is unsafe. [^faq]
- [What's new in Python 3.15: Other language changes](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, living. Rank 1. Backs: unary plus in literal patterns. [^whatsnew315]
- [What's new in Python 3.14: PEP 765](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, living. Rank 1. Backs: `SyntaxWarning` for `return`, `break`, `continue` leaving a `finally` block. [^whatsnew314]
- [PEP 572 – Assignment Expressions](https://peps.python.org/pep-0572/) — Chris Angelico, Tim Peters, Guido van Rossum, 2018. Rank 1. Backs: where `:=` needs parentheses, scope of the target, comprehension restrictions, `:=` in f-strings. [^pep572]
- [PEP 634 – Structural Pattern Matching: Specification](https://peps.python.org/pep-0634/) — Brandt Bucher, Guido van Rossum, 2020. Rank 1. Backs: bindings after a failed match are unspecified; generated `__match_args__` for dataclasses and named tuples. [^pep634]
- [PEP 636 – Structural Pattern Matching: Tutorial](https://peps.python.org/pep-0636/) — Daniel F Moisset, 2020. Rank 1. Backs: an unqualified name is always a capture pattern; use qualified constants. [^pep636]

## Related
- `python/fundamentals/objects-names-and-types.md` — truthiness, chained comparisons and `is` versus `==`, which conditions and literal patterns rely on.
- `python/fundamentals/functions-scopes-and-closures.md` — the scope rules that `:=` targets and capture patterns follow.
- `python/iteration-and-functional/iterators-generators-and-itertools.md` — the iterator protocol behind `for`, and comprehensions.
- `python/errors-and-resources/exceptions-and-exception-groups.md` — `try`/`finally`, and what `break` and `return` do inside it.
- `python/classes/dataclasses-enums-and-abcs.md` — enums as match constants and dataclass `__match_args__`.
