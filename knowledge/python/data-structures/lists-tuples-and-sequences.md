---
schema: knowledge-doc/v1
type: concept
topic: python/data-structures
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, list, tuple, sequence, slicing, unpacking, comprehension, sort, deque, copy, deepcopy]
ranked-sources: true
---

# Lists, tuples and the sequence operations

## Summary
**TL;DR:** `list`, `tuple`, `str` and `bytes` share the common sequence operations (`range` most of them): `in`, `+`, `*`, zero-based indexing, negative indices counted from the end, and half-open slices `s[i:j:k]` that never include `j`. A list is mutable (slice assignment, `del`, methods that return `None`); a tuple is immutable and hashable when everything inside it is. Every built-in copy (`lst[:]`, `list.copy()`, `copy.copy()`) is shallow, and `*` repeats references, so nested lists stay shared unless you use `copy.deepcopy()` or a comprehension.
**Use this when:** a slice is off by one, a change to one row of a grid shows up in every row, `x = x.sort()` leaves `None`, items vanish from a loop that removes them, `list.pop(0)` is slow, or an unpacking line raises `ValueError`.
**Not this doc:** names, identity and mutability in general → `python/fundamentals/objects-names-and-types.md`; dicts and sets → `python/data-structures/dicts-sets-and-hashing.md`; string and bytes methods → `python/data-structures/strings-bytes-and-formatting.md`; generator expressions and the iterator protocol → `python/iteration-and-functional/iterators-generators-and-itertools.md`; how sorting algorithms work → `algorithms/sorting-searching/sorting-algorithms.md`.

## Problem
Sequence code fails in ways that look like Python bugs:
- `grid = [[0] * 3] * 3; grid[0][0] = 1` sets the first cell of all three rows.
- `nums = nums.sort()` leaves `nums` as `None`.
- `s[1:3]` returns two items, not three, and `s[1:100]` raises nothing while `s[5]` raises `IndexError`.
- Removing items inside `for v in nums:` skips some of them.
- A copy made with `rows[:]` still changes when a nested row is edited.
- A queue built on `list.pop(0)`, or a tuple built with `+=` in a loop, gets slow as it grows.

Each follows a documented rule of the sequence types.

## Mental model
**Analogy:** a list is a row of numbered hooks, and each hook holds a luggage tag tied to an object, not the object itself. Indices are the fence posts *between* hooks: post 0 stands before the first hook, so `s[1:3]` takes the hooks between posts 1 and 3, which is two hooks. Copying a list copies the row of tags, not the luggage; `[x] * 3` hangs three tags to the same piece of luggage.

**Artifact** (measured in the lab ✅[^lab]):
```python
s = [10, 20, 30, 40, 50]
s[1:3], s[-2:], s[::-1]   # ([20, 30], [40, 50], [50, 40, 30, 20, 10])
s[:2] + s[2:] == s        # True: half-open slices split cleanly
grid = [[0] * 3] * 3
grid[0][0] = 1
grid                      # [[1, 0, 0], [1, 0, 0], [1, 0, 0]]  three tags, one inner list
grid[0] is grid[1]        # True
```

## How it works
### Operations every sequence shares
1. **The common table.** Most sequence types support `x in s`, `s + t`, `s * n`, `s[i]`, `s[i:j]`, `s[i:j:k]`, `len(s)`, `min(s)`, `max(s)`, `s.count(x)` and `s.index(x[, start[, stop]])` ✅[^stdtypes]. `in` tests equality with an item; `str`, `bytes` and `bytearray` also use it for substrings, so `"gg" in "eggs"` is `True` ✅[^stdtypes]. `range` follows a fixed pattern and does not support `+` or `*` ✅[^stdtypes].
2. **Negative indices.** A negative `i` or `j` means `len(s) + i`; `-0` is still `0` ✅[^stdtypes]. So `s[-1]` is the last item.
3. **Half-open slices.** `s[i:j]` holds the items with index `k` where `i <= k < j`. An omitted `i` is `0`, an omitted `j` is `len(s)`, bounds beyond either end are clipped, and `i >= j` gives an empty slice ✅[^stdtypes]. Only a single index can be out of range: `s[1:100]` is `[20, 30, 40, 50]` but `s[5]` raises `IndexError: list index out of range` ✅[^lab].
4. **Steps.** `s[i:j:k]` takes `i`, `i+k`, `i+2*k` … and stops before `j`; with a negative `k` the omitted ends swap, and `k` cannot be zero ✅[^stdtypes]. `s[::0]` raises `ValueError: slice step cannot be zero` ✅[^lab].
5. **Repetition shares items.** `s * n` with `n < 0` gives an empty sequence, and the items are not copied but referenced `n` times ✅[^stdtypes]. That is the `grid` trap in the Mental model.
6. **Comparison is lexicographic.** Two sequences of the same type compare item by item; the first difference decides, and a sequence that is a prefix of the other is the smaller ✅[^tut-ds].

### Changing a list
7. **Slice assignment and `del`.** `s[i:j] = t` replaces the slice with the items of any iterable, and the lengths may differ, so the list can grow or shrink ✅[^simple-stmts]. With a step other than 1, `t` must have the slice's length ✅[^stdtypes]. `del s[i:j]` is the same as `s[i:j] = []` ✅[^stdtypes]. In the lab, `a = [0, 1, 2, 3, 4, 5]; a[1:3] = ['x', 'y', 'z']` gives `[0, 'x', 'y', 'z', 3, 4, 5]`, and `a[0:0] = [...]` inserts without replacing ✅[^lab].
8. **Methods.** `append`, `extend`, `insert`, `remove` (first equal item, `ValueError` if none), `pop` (last item by default, `IndexError` on an empty list), `clear`, `index`, `count`, `sort`, `reverse` and `copy` ✅[^tut-ds]. Methods that only modify the list return `None`, a design principle for all of Python's mutable data structures ✅[^tut-ds].
9. **Stacks and queues.** `append()` plus `pop()` makes a last-in, first-out stack ✅[^tut-ds]. A list is a poor first-in, first-out queue: appends and pops at the end are fast, but inserts or pops at the start shift every other element ✅[^tut-ds]. `collections.deque` (double-ended queue) appends and pops at either end in about O(1) time (constant, whatever the length), while a list pays O(n) memory movement (proportional to the length) for `pop(0)` and `insert(0, v)`; indexing a deque is O(1) at the ends but O(n) in the middle ✅[^collections]. A deque with `maxlen` drops items from the opposite end when full ✅[^collections]. `deque(maxlen=3)` fed `0..4` holds `deque([2, 3, 4], maxlen=3)` ✅[^lab]. In the lab, 2,000 `insert(0)`/`pop(0)` pairs on a 100,000-item list were over 100 times slower than `appendleft()`/`popleft()` on a deque of the same size ✅[^lab].
10. **`list.sort()` versus `sorted()`.** `sort()` sorts in place, exists only on lists and returns `None`; `sorted()` accepts any iterable and returns a new list ✅[^sorting]. `sort()` takes keyword-only `key` and `reverse` and computes each item's key once ✅[^stdtypes]; `sorted()` takes the same two as keyword arguments ✅[^functions]. Both are guaranteed stable: items that compare equal keep their order, which makes multi-pass sorts work ✅[^stdtypes] ✅[^functions]. `sort()` uses only `<` comparisons; if one fails, the whole sort fails and the list is likely left partly modified ✅[^stdtypes]. In the lab, `[9, 8, 1, 2, 'x', 7].sort()` raised `TypeError` and left `[1, 2, 8, 9, 'x', 7]` ✅[^lab]. CPython detail: during a sort the list appears empty, and a detected mutation raises `ValueError` ✅[^stdtypes].

### Tuples and unpacking
11. **The comma makes the tuple.** `()` is the empty tuple, `a,` or `(a,)` a one-item tuple, and parentheses are optional except for the empty tuple or to avoid ambiguity ✅[^stdtypes]; `(1)` is just the `int` 1 ✅[^lab]. `tuple(t)` returns an existing tuple unchanged, while `list(l)` returns a copy ✅[^stdtypes].
12. **Hashable when the contents are.** Immutable sequences support `hash()`, which lets a tuple be a dict key or set member, but hashing one that contains an unhashable value raises `TypeError` ✅[^stdtypes]. `hash(([1], 2))` gives `TypeError: unhashable type: 'list'` ✅[^lab]. Tuples usually hold mixed items read by unpacking or index; lists usually hold similar items read by iterating ✅[^tut-ds].
13. **Packing and unpacking.** `t = 12345, 54321, 'hello'` packs a tuple and `x, y, z = t` unpacks it; plain unpacking needs exactly as many targets as items ✅[^tut-ds]. One starred target collects the remaining items into a list, possibly empty, and the iterable needs at least as many items as the other targets ✅[^simple-stmts]. `first, *rest = [1, 2, 3, 4]` gives `1` and `[2, 3, 4]`; `head, *mid, tail = [1, 2]` gives `mid == []` ✅[^lab]. `a, b = b, a` swaps: the right side is evaluated into one tuple first, then assigned to the targets from left to right ✅[^simple-stmts]. `*` also unpacks inside displays: `[0, *x, 4]` ✅[^tut-ds].
14. **`+=` on a list inside a tuple.** `t[0] += ['item']` calls the list's `__iadd__` (which extends it in place), then tries to store the result back into the tuple and fails: the `TypeError` is raised, yet the list was changed ✅[^faq].

### Comprehensions
15. **Shape.** Brackets around an expression, a `for` clause, then zero or more `for` or `if` clauses, nested in the same order as the equivalent loops ✅[^tut-ds]. A tuple expression must be parenthesised ✅[^tut-ds]; `[x, x**2 for x in range(6)]` raises `SyntaxError: did you forget parentheses around the comprehension target?` ✅[^lab].
16. **Scope.** Except for the iterable of the leftmost `for`, which is evaluated in the enclosing scope, a comprehension runs in its own implicitly nested scope, so its loop variable does not leak ✅[^expressions]. After `xv = 'old value'; [xv for xv in range(3)]`, `xv` is still `'old value'` ✅[^lab].
17. **Inlined since 3.12 (PEP 709).** Under PEP 709 (a Python Enhancement Proposal, the project's design documents), list, dict and set comprehensions are compiled inline instead of creating a single-use function each time, up to twice as fast; the isolation stays, but the comprehension no longer has its own traceback frame and `locals()` inside it also shows the enclosing function's variables ✅[^whatsnew312]. PEP 709's implementation leaves generator expressions as separate functions ✅[^pep709]. In the lab the bytecode of `[v for v in lst]` has no `MAKE_FUNCTION` but has `LOAD_FAST_AND_CLEAR`, while `(v for v in lst)` still uses `MAKE_FUNCTION`. In a function that sets `outer = 1` and returns `[sorted(locals()) for _ in range(1)]`, the comprehension saw `['_', 'outer']`, and a `ZeroDivisionError` raised inside a comprehension in a function `boom()` had only the frames `<module>` and `boom` in its traceback ✅[^lab].
18. **Nested comprehensions.** The first expression can itself be a comprehension; it is evaluated for each item of the `for` that follows it, so `[[row[i] for row in matrix] for i in range(4)]` transposes a matrix, though `list(zip(*matrix))` is the built-in way ✅[^tut-ds].
19. **Unpacking in comprehensions (3.15, PEP 798).** A starred expression flattens: `[*L for L in lists]` equals `[x for L in lists for x in L]`; it also works in set comprehensions and generator expressions, and `{**d for d in dicts}` merges dicts with later values winning ✅[^whatsnew315]. `**` in a list comprehension is a syntax error ✅[^pep798]; the lab message is `cannot use dict unpacking in list comprehension` ✅[^lab].

### Copies, aliasing and mutation during iteration
20. **Shallow versus deep.** A shallow copy builds a new container and fills it with references to the original items; a deep copy fills it with recursive copies ✅[^copy]. `lst[:]`, `list.copy()` and `copy.copy()` are shallow; `copy.deepcopy()` keeps a memo of objects already copied, so a list that contains itself does not loop forever ✅[^copy]. Slicing or `.copy()` on a subclass may return the base type, while `copy.copy()` normally keeps the type ✅[^copy]. For a `class MyList(list)`, `ml[:]` is a `list` and `copy.copy(ml)` a `MyList` ✅[^lab].
21. **Building a grid.** `[[None] * 2] * 3` holds three references to one row, so an assignment shows up in every row; create each row separately with `[[None] * w for i in range(h)]` ✅[^faq].
22. **Mutating while iterating.** A forward iterator over a mutable sequence keeps an index that marches on even when the sequence changes ✅[^stdtypes]. Removing the current item therefore skips the next one: removing even numbers from `[1, 2, 2, 3, 4]` inside the loop left `[1, 2, 3]`, and items appended during a loop are visited too ✅[^lab]. To filter in place, replace the whole slice: `mylist[:] = [x for x in mylist if keep_condition]` ✅[^faq].
23. **Repeated concatenation is quadratic.** Concatenating immutable sequences always creates a new object, so building one by repeated `+` costs time quadratic in the total length; collect into a list and `str.join()` it, use `io.StringIO`, `bytearray` for bytes, or extend a list instead of a tuple ✅[^stdtypes]. In the lab `t += (1,)` produced a new tuple while `l += [1]` kept the same list, and building a 20,000-item tuple with `+=` was over 100 times slower than appending to a list ✅[^lab].

## Worked example
Sorting and batching four orders `(id, region, amount)`, with every value measured in the lab ✅[^lab]:

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | `by_amount = sorted(orders, key=lambda o: o[2])` with `orders = [('o1','eu',30), ('o2','us',10), ('o3','eu',10), ('o4','us',30)]` | `[('o2','us',10), ('o3','eu',10), ('o1','eu',30), ('o4','us',30)]`; `orders` unchanged | `sorted()` returns a new list ✅[^sorting] |
| 2 | `by_amount.sort(key=lambda o: o[1])` | `[('o3','eu',10), ('o1','eu',30), ('o2','us',10), ('o4','us',30)]`: by region, then amount | stability keeps step 1's order among equal regions ✅[^sorting] |
| 3 | `first, *rest = by_amount` | `first == ('o3','eu',10)`, `len(rest) == 3` | starred target (How it works 13) |
| 4 | `[oid for oid, region, _ in by_amount if region == 'eu']` | `['o3', 'o1']` | comprehension with unpacking and a filter |
| 5 | `batches = [[] for _ in range(2)]`, then `batches[i % 2].append(oid)` | `[['o3', 'o2'], ['o1', 'o4']]` | one new list per row |
| 6 | the same with `batches = [[]] * 2` | `[['o3','o1','o2','o4'], ['o3','o1','o2','o4']]` | `*` repeats one reference ✅[^stdtypes] |
| 7 | `queue = deque(by_amount); queue.popleft()` | `('o3','eu',10)`, 3 left | O(1) at the left end ✅[^collections] |
| 8 | `rows = [list(o) for o in orders]`; `shallow, deep = rows[:], copy.deepcopy(rows)`; `rows[0][2] = 99` | `shallow[0] == ['o1','eu',99]`, `deep[0] == ['o1','eu',30]` | the shallow copy shares the inner lists ✅[^copy] |

Steps 5 and 6 differ only in how the outer list was built, which is the whole bug.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `[1, 2] * -1` | `[]` ✅[^lab] | `n` below 0 counts as 0 ✅[^stdtypes] |
| `b = list(range(6)); b[::2] = [9, 9]` | `ValueError: attempt to assign sequence of size 2 to extended slice of size 3` ✅[^lab] | An extended slice cannot change length ✅[^stdtypes] |
| `p, q = [1, 2, 3]` | `ValueError: too many values to unpack (expected 2, got 3)` ✅[^lab] | Plain unpacking needs an exact count ✅[^tut-ds] |
| `t = (['foo'], 'bar'); t[0] += ['item']` | `TypeError`, and `t` is now `(['foo', 'item'], 'bar')` ✅[^lab] | The in-place extend runs before the failing store ✅[^faq] |
| `sorted([3, 'a', None])` | `TypeError: '<' not supported between instances of 'str' and 'int'` ✅[^lab] | Most cross-type comparisons raise `TypeError` ✅[^sorting] |
| `f.append('kiwi')` used as a value | `None` ✅[^lab] | Mutating methods return `None` ✅[^tut-ds] |
| `list.index` with `start` | The result counts from the start of the whole list ✅[^tut-ds] | The arguments only narrow the search |
| `s.index(99)` for a missing value | `ValueError: list.index(x): x not in list` ✅[^lab] | `index()` raises when the value is absent ✅[^tut-ds] |
| `list(*row for row in matrix)` | `[1, 2, 3, 4, 5, 6]` in 3.15 ✅[^lab] | PEP 798 also covers generator expressions passed as the sole argument ✅[^pep798] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `list` | Mutable; fast `append`/`pop` at the end ✅[^tut-ds] | Slow at the front ✅[^tut-ds]; no `hash()`, so never a dict key ✅[^stdtypes] |
| `tuple` | Immutable; usable as a dict key when its items are hashable ✅[^stdtypes] | Growing one by `+=` is quadratic ✅[^stdtypes] |
| `collections.deque` | About O(1) at both ends; optional `maxlen` ✅[^collections] | O(n) indexing in the middle ✅[^collections] |
| `list.sort()` | Slightly more efficient when the original list is not needed ✅[^sorting] | Returns `None`; lists only ✅[^sorting]; the original order is gone |
| `sorted()` | Any iterable ✅[^sorting]; the input is left unaltered ✅[^tut-ds] | Allocates a new list |
| `lst[:]` / `copy.copy()` | Only the outer container is new ✅[^copy] | Nested objects stay shared ✅[^copy] |
| `copy.deepcopy()` | Copies nested objects recursively ✅[^copy] | May copy too much, such as data meant to be shared ✅[^copy] |

## Takeaways
- Build grids and lists of lists with a comprehension, `[[0] * w for _ in range(h)]`, never with `[[0] * w] * h`. [rule-candidate]
- Never use the result of `list.sort()`, `append()` or `reverse()`; call `sorted()` when you need the sorted value. [rule-candidate]
- Use `collections.deque` for first-in, first-out queues instead of `list.pop(0)`. [rule-candidate]
- Never remove items from a list inside a loop over it; filter with `lst[:] = [...]` or build a new list. [rule-candidate]
- Use `copy.deepcopy()` when a copy holds nested mutable objects that must not be shared.
- Accumulate pieces in a list and join or convert once at the end, instead of `+=` on a `str` or `tuple` in a loop. [rule-candidate]

## Verification status
- Verified: 103 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Built-in Types: Sequence Types — list, tuple, range](https://docs.python.org/3/library/stdtypes.html) — Python Software Foundation, living. Rank 1. Backs: the common and mutable sequence operations, negative indices, slice rules, repetition by reference, quadratic concatenation, the index-based iterator, `list.sort()` (key, reverse, stability, failure, CPython detail), tuple construction and hashing, `tuple()`/`list()` copying. [^stdtypes]
- [5. Data Structures](https://docs.python.org/3/tutorial/datastructures.html) — Python Software Foundation, living. Rank 1. Backs: list methods and their `None` return, stacks and queues, comprehension shape and parentheses, nested comprehensions, unpacking in displays, tuples and sequence unpacking, sequence comparison. [^tut-ds]
- [collections — Container datatypes: deque objects](https://docs.python.org/3/library/collections.html) — Python Software Foundation, living. Rank 1. Backs: deque O(1) ends versus list O(n) `pop(0)`/`insert(0, v)`, `maxlen`, middle indexing cost. [^collections]
- [copy — Shallow and deep copy operations](https://docs.python.org/3/library/copy.html) — Python Software Foundation, living. Rank 1. Backs: shallow versus deep copy, the memo, copying too much, subclass copies. [^copy]
- [Built-in functions: sorted()](https://docs.python.org/3/library/functions.html) — Python Software Foundation, living. Rank 1. Backs: `sorted()` keyword arguments and stability. [^functions]
- [Sorting Techniques](https://docs.python.org/3/howto/sorting.html) — Python Software Foundation, living. Rank 1. Backs: `sort()` versus `sorted()`, stability for multi-pass sorts, cross-type comparison errors. [^sorting]
- [Programming FAQ: Sequences (tuples/lists)](https://docs.python.org/3/faq/programming.html) — Python Software Foundation, living. Rank 1. Backs: creating a multidimensional list, removing items with slice replacement, `a_tuple[i] += ['item']`. [^faq]
- [6. Expressions: Comprehensions](https://docs.python.org/3/reference/expressions.html) — Python Software Foundation, living. Rank 1. Backs: the implicitly nested scope and the leftmost iterable. [^expressions]
- [7. Simple statements: Assignment statements](https://docs.python.org/3/reference/simple_stmts.html) — Python Software Foundation, living. Rank 1. Backs: starred targets, slice assignment, simultaneous swap. [^simple-stmts]
- [What's New In Python 3.12: PEP 709](https://docs.python.org/3/whatsnew/3.12.html) — Python Software Foundation, 2023. Rank 1. Backs: comprehension inlining and its visible effects. [^whatsnew312]
- [What's new in Python 3.15: PEP 798](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: `*` and `**` unpacking in comprehensions. [^whatsnew315]
- [PEP 709 – Inlined comprehensions](https://peps.python.org/pep-0709/) — Carl Meyer, 2023. Rank 1. Backs: its implementation does not inline generator expressions. [^pep709]
- [PEP 798 – Unpacking in Comprehensions](https://peps.python.org/pep-0798/) — Adam Hartz, Erik Demaine, 2025. Rank 1. Backs: `**` rejected in list comprehensions; starred generator expressions as a sole argument. [^pep798]

## Related
- `python/fundamentals/objects-names-and-types.md` — why `y = x` shares one list.
- `python/data-structures/dicts-sets-and-hashing.md` — hashing, the reason tuples can be keys and lists cannot.
- `python/fundamentals/control-flow-and-pattern-matching.md` — `for` loops and sequence patterns.
- `python/iteration-and-functional/iterators-generators-and-itertools.md` — generator expressions and lazy alternatives to building lists.
- `algorithms/sorting-searching/sorting-algorithms.md` — stability and the algorithms behind `sort()`.
