---
schema: knowledge-doc/v1
type: concept
topic: python/iteration-and-functional
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, iterator, iterable, generator, yield, yield-from, stopiteration, lazy-evaluation, itertools, zip, groupby, batched]
ranked-sources: true
---

# Iterators, generators and itertools

## Summary
**TL;DR:** An iterable (a list, a dict, a file) can hand out a fresh iterator on request; an iterator is a one-pass stream that `next()` advances until it raises `StopIteration`, and then it stays empty. A generator function is the easy way to write an iterator: calling it runs nothing, each `next()` runs the body up to the next `yield`, and `send()`, `throw()` and `close()` steer it from outside. `map`, `filter`, `zip`, generator expressions and the `itertools` functions are lazy: they produce one item at a time, when asked, which saves memory but means a second pass finds nothing.
**Use this when:** a loop over the same data silently produces nothing the second time, `groupby` returns the same key twice, a generator's code "never runs", a `RuntimeError: generator raised StopIteration` appears, or you need to process data too large to hold in a list.
**Not this doc:** `async for` and asynchronous generators → `python/concurrency/asyncio-coroutines-and-tasks.md`; comprehensions and `for`/`else` → `python/fundamentals/control-flow-and-pattern-matching.md`; `functools.reduce` and `operator.itemgetter` → `python/iteration-and-functional/decorators-and-functools.md`; implementing `__iter__` on your own classes next to other special methods → `python/classes/data-model-special-methods.md`.

## Problem
Iteration looks simple until data is consumed in one place and expected in another:
- `matches = filter(pred, rows)` is used once for `len(list(matches))` and then again in a loop that runs zero times.
- `itertools.groupby` on unsorted rows returns `WARN`, `ERROR`, `WARN`: the same key twice.
- `zip(names, prices)` drops the last price without an error, because the two lists had different lengths.
- A helper deep inside a generator calls `next()` on an empty iterator, and the program dies with `RuntimeError` instead of a clean end of loop.
- A generator function's `print` at the top never prints, because nobody called `next()` on it yet.

Each follows from the iterator protocol and from generators being lazy.

## Mental model
**Analogy:** an iterable is a book; an iterator is a bookmark in one copy of it. `next()` reads the page under the bookmark and moves it forward. When the bookmark reaches the end it stays there: reading again gives nothing. Asking the book for a bookmark (`iter(book)`) gives a new one at page 1; asking a bookmark for a bookmark gives the same bookmark back. A generator is a cook who prepares one plate per order and then freezes, apron on, at the exact step where he stopped, until the next order arrives.

**Artifact** (measured in the lab ✅[^lab]):
```python
nums = [10, 20, 30]
i = iter(nums)
iter(i) is i              # True              the bookmark's bookmark is itself
next(i), next(i)          # (10, 20)
list(i)                   # [30]              only what is left
next(i, 'done')           # 'done'            exhausted; without a default: StopIteration
list(nums), list(nums)    # ([10, 20, 30], [10, 20, 30])   the book gives a new bookmark each time
g = (n * 2 for n in nums)
list(g)                   # [20, 40, 60]
list(g)                   # []                a generator is an iterator: one pass only
```

## How it works

### The iterator protocol
1. **Iterable versus iterator.** An iterable returns its members one at a time; examples are all sequences, `dict`, file objects and any class with `__iter__()` or a sequence-style `__getitem__()`; passing it to `iter()` returns an iterator good for one pass ✅[^glossary]. An iterator represents a stream: each `__next__()` call (or `next()`) returns the next item, and `StopIteration` is raised when no data is left; after that the iterator is exhausted and keeps raising `StopIteration` ✅[^glossary]. An iterator must also have an `__iter__()` that returns itself, so every iterator is iterable ✅[^stdtypes]. One whose `__next__()` returns items again after raising `StopIteration` is "deemed broken" ✅[^stdtypes].
2. **`for` drives the protocol.** The expression after `in` is evaluated once and an iterator is created for it; each item is assigned to the target and the body runs; when the iterator is exhausted the `else` clause (if any) runs ✅[^compound]. Written by hand, the same loop gives the same result ✅[^lab].
   ```python
   _it = iter(nums)
   while True:
       try:
           x = next(_it)
       except StopIteration:
           break
       ...                   # loop body
   ```
3. **`iter()` and `next()`.** Without a second argument, `iter(obj)` needs `__iter__()` or a `__getitem__()` that accepts integers from `0`, and raises `TypeError` otherwise ✅[^functions]. For example, `iter(42)` fails with `'int' object is not iterable`, and a class with only a `__getitem__` that raises `IndexError` at 3 iterates as `[0, 1, 4]` ✅[^lab]. With a sentinel, `iter(callable, sentinel)` calls the callable until it returns a value equal to the sentinel ✅[^functions]. `next(it, default)` returns `default` instead of raising `StopIteration` ✅[^functions].
4. **A hand-written iterator** returns `self` from `__iter__()` and raises `StopIteration` from `__next__()` when done. A `Countdown(3)` class written this way lists as `[3, 2, 1]`, and a second `list()` of the same object gives `[]` ✅[^lab].

### Generators
5. **Calling a generator function runs nothing.** A function whose body contains `yield` is a generator function; calling it returns a generator iterator, and execution starts only when one of its methods is called, then runs to the first `yield` and suspends ✅[^expressions]. Suspension keeps the local variables, the instruction pointer, the evaluation stack and the exception-handling state ✅[^expressions]. `inspect.getgeneratorstate()` reports `GEN_CREATED`, `GEN_RUNNING`, `GEN_SUSPENDED` or `GEN_CLOSED` ✅[^inspect]; a generator reads `GEN_CREATED` right after the call, `GEN_SUSPENDED` after the first `next()`, `GEN_RUNNING` when it inspects itself, and `GEN_CLOSED` after its last item ✅[^lab].
6. **`return` ends a generator.** It raises `StopIteration`, and the returned value becomes `StopIteration.value` ✅[^simple], so `return "finished"` arrives as `e.value == 'finished'` ✅[^lab]. A `for` loop swallows that exception, so the value is lost unless something reads it (step 8).
7. **Generator expressions.** `(x ** 2 for x in data)` has the syntax of a list comprehension in parentheses and evaluates to a generator iterator; the parentheses may be dropped when it is the only argument of a call, as in `sum(x ** 2 for x in data)` ✅[^expressions]. Only the leftmost `for` iterable is evaluated immediately; everything else runs lazily, when a value is requested ✅[^expressions]. So `(x for x in undefined_name)` raises `NameError` at once, while `(undefined_name for x in range(3))` is created fine and fails only inside `list()` ✅[^lab]. Since 3.15, generator expressions accept `*` unpacking ✅[^whatsnew315], so `list(*L for L in [[1, 2], [3], [4, 5]])` is `[1, 2, 3, 4, 5]` ✅[^lab].
8. **`yield from` delegates.** `yield from <iterable>` passes every value of the inner iterator straight to the caller and forwards `send()` and `throw()` to it; when the inner iterator finishes, its `StopIteration.value` becomes the value of the `yield from` expression ✅[^expressions]. It was added in 3.3 by PEP 380 (Python Enhancement Proposal) ✅[^pep380]. In the lab, an `outer()` doing `result = yield from inner()` passes `inner`'s `'a'` out, passes `send('x')` in, and then sees `result == 42` from `inner`'s `return 42` ✅[^lab].
9. **`send()`, `throw()`, `close()`** were added in Python 2.5 by PEP 342 ✅[^pep342].
   - `send(value)` resumes the generator and makes `value` the result of the paused `yield`; to start a fresh generator it must be `send(None)` ✅[^stdtypes]. Otherwise CPython says `can't send non-None value to a just-started generator` ✅[^lab].
   - `throw(exc)` raises `exc` where the generator is paused; if the generator does not catch it, it propagates to the caller ✅[^stdtypes]. The three-argument form `throw(type, value, traceback)` is deprecated since 3.12 ✅[^stdtypes].
   - `close()` raises `GeneratorExit` at the paused point. If the generator then yields, `close()` raises `RuntimeError`; since 3.13, a value the generator returns while closing is returned by `close()`; an unfinished generator that is garbage-collected is closed automatically ✅[^stdtypes], which lets its pending `finally` clauses run ✅[^expressions]. A running average generator that catches `GeneratorExit` and returns its last average gives `close()` → `15.0` after `send(10)` and `send(20)` ✅[^lab].
   - `GeneratorExit` inherits from `BaseException`, not `Exception`, because it is not an error ✅[^exceptions], so an `except Exception:` inside a generator does not swallow it.
10. **PEP 479: `StopIteration` inside a generator becomes `RuntimeError`.** If generator code raises `StopIteration` directly or indirectly, it is converted to `RuntimeError`, with the `StopIteration` kept as the cause; this is the default for all code since 3.7 ✅[^exceptions]. The reason: an unguarded `next()` several frames deep used to end the iteration silently instead of printing a traceback ✅[^pep479]. In the lab, `yield next(iter(x))` over `[1], [], [3]` raises `RuntimeError: generator raised StopIteration` with `__cause__` a `StopIteration` ✅[^lab]. Use `next(it, default)` or catch `StopIteration` and `return`.

### Lazy built-ins
11. **`map`, `filter`, `zip` and `enumerate` return iterators** ✅[^functions]. Nothing is computed until asked: after `m = map(sq, [1, 2, 3])` the call log is `[]`, and one `next(m)` makes it `[1]` ✅[^lab]. The Functional Programming HOWTO uses the term lazy evaluation for this behaviour of `zip()` ✅[^howto-functional].
12. **`zip` stops at the shortest input** and ignores the rest; `strict=True` (added in 3.10) raises `ValueError` when one input runs out before the others, and is recommended when the inputs are meant to have equal lengths ✅[^functions]. `map` gained the same `strict` flag in 3.14 ✅[^functions]. Lab messages: `zip() argument 2 is shorter than argument 1` and `map() argument 2 is shorter than argument 1` ✅[^lab].
13. **`x in iterator` consumes it.** `3 in iter(range(5))` is `True`, and only `[4]` is left afterwards ✅[^lab].

### itertools
14. Every `itertools` function returns an iterator; some streams are infinite, so they should only be read by a function or loop that cuts the stream short ✅[^itertools]. All values below were measured ✅[^lab].

| Function | What it yields ✅[^itertools] | Lab call → result |
|---|---|---|
| `count(start=0, step=1)` | `start`, `start+step`, … forever | `islice(count(10, 5), 3)` → `[10, 15, 20]` |
| `cycle(it)` | the items, then the saved copy, forever; may need much extra memory | `islice(cycle('AB'), 5)` → `A B A B A` |
| `repeat(obj, times)` | `obj` forever, or `times` times | `repeat('x', 3)` → `x x x` |
| `chain(*its)`, `chain.from_iterable(its)` | the first iterable's items, then the next's | `chain('ab', [1, 2])` → `a b 1 2` |
| `islice(it, start, stop, step)` | slice of a stream; no negative values | `islice(range(10), 2, 8, 3)` → `[2, 5]` |
| `groupby(it, key)` | `(key, group)` each time the key changes, so the input usually needs sorting by the same key; each group shares the source and disappears when `groupby` advances | `groupby('AABBBAC')` keys → `A B A C`; sorted first → `(A,3) (B,3) (C,1)` |
| `tee(it, n=2)` | `n` independent iterators over one source; not thread-safe; may need significant extra storage | `tee(iter([1, 2, 3]))` → both `[1, 2, 3]` |
| `product`, `permutations`, `combinations` | tuples in lexicographic order of the input; `permutations` and `combinations` treat items as unique by position, not value; `product` reads all inputs into memory first, so it is only useful with finite inputs | `combinations('abc', 2)` → `ab ac bc` |
| `accumulate(it, func, initial=None)` | running totals (or running `func`); `initial` adds one item in front | `accumulate([3, 1, 5, 2], max, initial=0)` → `[0, 3, 3, 5, 5]` |
| `pairwise(it)` (3.10) | overlapping pairs, one fewer than the inputs | `pairwise([1, 4, 9, 16])` → `(1,4) (4,9) (9,16)` |
| `batched(it, n, *, strict=False)` (3.12; `strict` 3.13) | tuples of `n`; the last may be shorter, or `ValueError` with `strict=True` | `batched('ABCDEFG', 3)` → `ABC DEF G`; strict → `batched(): incomplete batch` |

15. **3.14 and 3.15 changes.** Copying, deep-copying and pickling `itertools` iterators was removed in 3.14 ✅[^whatsnew314] (`copy.copy(count())` → `TypeError: cannot pickle 'itertools.count' object` ✅[^lab]). 3.15 adds `threading.concurrent_tee()` and `threading.serialize_iterator` for sharing an iterator between threads ✅[^whatsnew315].

An `async def` function that contains `yield` is an asynchronous generator, used with `async for`, and `yield from` is a syntax error inside one ✅[^expressions]; see `python/concurrency/asyncio-coroutines-and-tasks.md`.

## Worked example
A lazy pipeline over seven log lines, one of them malformed; the list `read` records each line `parse()` pulls (every value measured in the lab ✅[^lab]):

```python
LINES = ["10:01 INFO start", "10:02 WARN disk 91%", "garbage", "10:02 INFO ok",
         "10:03 ERROR db timeout", "10:03 WARN disk 95%", "10:04 INFO done"]
read = []

def parse(lines):
    skipped = 0
    for line in lines:
        read.append(line)
        parts = line.split(maxsplit=2)
        if len(parts) < 3:
            skipped += 1
            continue
        yield tuple(parts)          # (time, level, message)
    return skipped
```

| Step | Code | Result | Why |
|---|---|---|---|
| 1 | `records = parse(LINES)` | `len(read) == 0` | calling a generator function runs nothing (How it works 5) |
| 2 | `problems = (r for r in records if r[1] != "INFO")`; `next(problems)` | `('10:02', 'WARN', 'disk 91%')`, `len(read) == 2` | only two lines were pulled to find the first match |
| 3 | `rest = list(problems)` | `ERROR db timeout`, `WARN disk 95%`; `len(read) == 7` | the rest of the input is read once, on demand |
| 4 | `next(records)` | `StopIteration` with `value` `None` | the generator expression already received the `StopIteration` carrying `skipped`; the value is delivered once |
| 5 | `stats["skipped"] = yield from parse(lines)` inside a wrapper | `skipped = 1`, 3 problems | `yield from` hands back the return value (How it works 8) |
| 6 | `groupby(sorted(all_problems, key=itemgetter(1)), key=itemgetter(1))` | `[('ERROR', 1), ('WARN', 2)]` | unsorted, the keys come out `WARN, ERROR, WARN` |
| 7 | `batched(all_problems, 2)` | times `['10:02', '10:03']`, `['10:03']` | the last batch is shorter |
| 8 | `list(records)` | `[]` | an exhausted generator stays exhausted |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Looping twice over a `map`, `filter`, `zip` or generator | The second loop runs zero times ✅[^lab] | An iterator is exhausted after one pass; a container makes a fresh iterator each time ✅[^glossary] |
| `groupby` groups stored with `list(groupby('AABB'))`, then read | `[('A', []), ('B', [])]` ✅[^lab] | Each group shares the source; advancing `groupby` hides the previous group, so copy it with `list(g)` inside the loop ✅[^itertools] |
| The source of a `tee` is advanced directly | Both copies skip that item: `[2, 3, 4]` ✅[^lab] | `tee` reads from the shared source; use only the copies |
| `zip` over unequal lengths | Silent truncation: `zip('abc', [1, 2])` → two pairs ✅[^lab] | Default stops at the shortest; pass `strict=True` ✅[^functions] |
| `takewhile` followed by further reading of the same iterator | The first failing item is gone ✅[^itertools] | `takewhile` consumes that item to test it |
| `close()` on a generator that yields in `finally` | `RuntimeError: generator ignored GeneratorExit` ✅[^lab] | A generator may not yield while closing ✅[^stdtypes] |
| A generator calls `next()` on itself while running | `ValueError: generator already executing` ✅[^lab] | Calling a generator method while one is executing raises `ValueError` ✅[^stdtypes] |
| `islice(it, -1)` | `ValueError` ✅[^lab] | No negative `start`, `stop` or `step` ✅[^itertools] |
| `cycle` or `tee` over a large stream | Memory grows with the saved items | Both may need significant extra storage; if one `tee` copy reads most data before the other starts, `list()` is faster ✅[^itertools] |
| `product(count(), 'ab')` | `product()` first tries to read the infinite `count()` completely | It keeps pools of every input in memory before producing, so it is only useful with finite inputs ✅[^itertools] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| List or list comprehension | Many passes, `len()`, indexing | Holds every item in memory |
| Generator or generator expression | One item in memory at a time; works on infinite streams ✅[^howto-functional] | One pass only; errors surface when consumed, not when defined |
| `tee()` | Several readers over one stream | Much memory when one copy runs far ahead of another ✅[^howto-functional]; not thread-safe ✅[^itertools] |
| `list()` then reuse | Simple and fast when every reader needs all data | Memory for the whole stream |

## Takeaways
- Materialize with `list()` (or `tuple()`) before reading data twice; never pass a one-shot iterator to two consumers. [rule-candidate]
- Pass `strict=True` to `zip()` (and `map()` with several inputs) when the inputs must have equal lengths. [rule-candidate]
- Sort by the same key before `itertools.groupby`, and copy each group with `list(g)` inside the loop. [rule-candidate]
- Inside a generator, use `next(it, default)` or catch `StopIteration` and `return`; a bare `next()` turns into `RuntimeError`. [rule-candidate]
- Use `yield from` to delegate to a sub-generator and to get its return value.
- Prefer a generator expression over a list comprehension when the result is consumed once, such as `sum(x for x in data)`.

## Verification status
- Verified: 72 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Glossary: iterable, iterator](https://docs.python.org/3/glossary.html) — Python Software Foundation, living. Rank 1. Backs: what an iterable and an iterator are; exhaustion; containers return fresh iterators. [^glossary]
- [Built-in Types: Iteration-related types](https://docs.python.org/3/library/stdtypes.html) — Python Software Foundation, living. Rank 1. Backs: the iterator protocol; broken iterators; generator `send()`, `throw()`, `close()`; re-entrant calls raise `ValueError`. [^stdtypes]
- [Compound statements: The for statement](https://docs.python.org/3/reference/compound_stmts.html) — Python Software Foundation, living. Rank 1. Backs: how `for` creates and drives an iterator. [^compound]
- [Built-in functions](https://docs.python.org/3/library/functions.html) — Python Software Foundation, living. Rank 1. Backs: `iter()` both forms, `next()` default, `map`/`filter`/`zip`/`enumerate` return iterators, `zip(strict=True)` and `map(strict=True)`. [^functions]
- [Expressions: Generator expressions, Yield expressions](https://docs.python.org/3/reference/expressions.html) — Python Software Foundation, living. Rank 1. Backs: when generator bodies run, suspension state, eager leftmost iterable, `yield from`, `close()` on finalization, async generators. [^expressions]
- [Simple statements: The return statement](https://docs.python.org/3/reference/simple_stmts.html) — Python Software Foundation, living. Rank 1. Backs: `return` in a generator sets `StopIteration.value`. [^simple]
- [inspect — Inspect live objects: getgeneratorstate](https://docs.python.org/3/library/inspect.html) — Python Software Foundation, living. Rank 1. Backs: the four generator states. [^inspect]
- [Built-in Exceptions: StopIteration, GeneratorExit](https://docs.python.org/3/library/exceptions.html) — Python Software Foundation, living. Rank 1. Backs: `StopIteration` to `RuntimeError` conversion and its version history; `GeneratorExit` derives from `BaseException`. [^exceptions]
- [itertools — Functions creating iterators for efficient looping](https://docs.python.org/3/library/itertools.html) — Python Software Foundation, living. Rank 1. Backs: every `itertools` row; `groupby` sorting and shared groups; `tee` storage and thread safety; `takewhile`; `product` with finite inputs; `batched` versions. [^itertools]
- [Functional Programming HOWTO](https://docs.python.org/3/howto/functional.html) — Python Software Foundation, living. Rank 1. Backs: the term lazy evaluation; generator expressions suit infinite or very large streams; `tee` memory when copies drift apart. [^howto-functional]
- [What's new in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, living. Rank 1. Backs: removal of copy and pickle support from `itertools`. [^whatsnew314]
- [What's new in Python 3.15](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, living. Rank 1. Backs: unpacking in generator expressions (PEP 798); `threading.concurrent_tee()` and `serialize_iterator`. [^whatsnew315]
- [PEP 342 – Coroutines via Enhanced Generators](https://peps.python.org/pep-0342/) — Guido van Rossum, Phillip J. Eby, 2005. Rank 1. Backs: `send()`, `throw()` and `close()` added in Python 2.5. [^pep342]
- [PEP 380 – Syntax for Delegating to a Subgenerator](https://peps.python.org/pep-0380/) — Gregory Ewing, 2009. Rank 1. Backs: `yield from` and its return value. [^pep380]
- [PEP 479 – Change StopIteration handling inside generators](https://peps.python.org/pep-0479/) — Chris Angelico, Guido van Rossum, 2014. Rank 1. Backs: why a stray `StopIteration` became `RuntimeError`. [^pep479]

## Related
- `python/iteration-and-functional/decorators-and-functools.md` — `reduce`, `partial` and the `operator` getters used as `key=` functions.
- `python/concurrency/asyncio-coroutines-and-tasks.md` — asynchronous generators and `async for`.
- `python/fundamentals/control-flow-and-pattern-matching.md` — `for`/`else` and comprehensions.
- `python/classes/data-model-special-methods.md` — `__iter__`, `__next__` and `__getitem__` among the other special methods.
- `python/errors-and-resources/context-managers-and-file-io.md` — files as iterators and `contextlib.contextmanager`, which is built on generators.
