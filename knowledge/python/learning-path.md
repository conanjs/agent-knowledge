---
schema: knowledge-doc/v1
type: reference
topic: python
status: verified
applies-to: ["the docs under knowledge/python/ as of 2026-11-24", "The Python Tutorial for Python 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, learning-path, curriculum, tutorial]
ranked-sources: true
---

# Python learning path

## Summary
**TL;DR:** Nine stages from the basics to the internals: objects and control flow, built-in data structures, programs that last (modules, errors, files, the standard library), classes, iteration and decorators, the object model underneath (descriptors and metaclasses), the CPython runtime, concurrency, and type hints with tooling. Each stage lists the docs to read in order, an exercise to run in the CPython 3.15 lab, and a self-check. A second table maps every chapter of the official Python Tutorial to the doc that covers it.
**Use this when:** you start learning Python, want to know what to read after a given doc, or want to find which doc covers a Tutorial chapter.
**Not this doc:** how to install the interpreter the exercises use → `python/python-lab-setup.md`.

## Scope
The v1 docs under `knowledge/python/` (27 docs in 12 subtopics, plus the lab how-to and this path), ordered for a first reading (every path in the tables is relative to `knowledge/`), and the 16 chapters of the Python Tutorial for Python 3.15. Run every exercise with `python3.15 -I` as `python/python-lab-setup.md` describes, predict the output first, and compare your run with the doc's measured result.

## Catalog

### Stages

| # | Stage | Read, in order | Exercise | Self-check: you can explain … |
|---|---|---|---|---|
| 1 | Basics | `python/python-lab-setup.md` → `python/fundamentals/objects-names-and-types.md` → `python/fundamentals/control-flow-and-pattern-matching.md` → `python/fundamentals/functions-scopes-and-closures.md` | Predict, then run, `-7 // 2`, `-7 % 3`, `round(2.5)`, `0 or 'default'`; write a `match` with `case RED:` and see why it captures; call a function whose default is `[]` three times | … why `y = x` never copies, why a mutable default is shared between calls, and why `lambda: i` in a loop sees the last `i` |
| 2 | Built-in data structures | `python/data-structures/lists-tuples-and-sequences.md` → `python/data-structures/dicts-sets-and-hashing.md` → `python/data-structures/strings-bytes-and-formatting.md` | Build `[[0] * 3] * 3`, change one cell, then fix it with a comprehension; build `{1: 'a', 1.0: 'b', True: 'c'}`; format `1234.5` with `f'{x:>12,.2f}'` | … the difference between a shallow and a deep copy, what makes an object hashable, and why `'logs.csv'.rstrip('.csv')` is `'log'` |
| 3 | Programs that last | `python/modules-and-packaging/modules-packages-and-imports.md` → `python/modules-and-packaging/virtual-environments-and-packaging.md` → `python/errors-and-resources/exceptions-and-exception-groups.md` → `python/errors-and-resources/context-managers-and-file-io.md` → `python/standard-library/standard-library-tour.md` → `python/standard-library/regular-expressions.md` → `python/standard-library/dates-and-times.md` | Make a package with two modules that import each other and watch the partially initialised module; write a `@contextmanager` that times a block; add one day to an aware `datetime` the night before a daylight-saving change | … why a module body runs once per process, when `else` and `finally` run in a `try`, what `raise … from` records, and why `<` between a naive and an aware datetime raises `TypeError` while `==` returns `False` |
| 4 | Classes | `python/classes/classes-instances-and-inheritance.md` → `python/classes/data-model-special-methods.md` → `python/classes/dataclasses-enums-and-abcs.md` | Build a diamond `D(B, C)` with cooperative `super().__init__()` calls and print `D.__mro__`; give a class `__eq__` and try to put an instance in a set | … the C3 order, why defining `__eq__` alone makes instances unhashable, and what `NotImplemented` asks the interpreter to do |
| 5 | Iteration and functions of functions | `python/iteration-and-functional/iterators-generators-and-itertools.md` → `python/iteration-and-functional/decorators-and-functools.md` | Iterate a generator twice; `list(groupby(...))` on unsorted input; write a timing decorator with and without `functools.wraps` and compare `__name__` | … the difference between an iterable and an iterator, what `yield from` returns, and in which order stacked decorators apply |
| 6 | The object model underneath | `python/metaprogramming/descriptors-and-attribute-lookup.md` → `python/metaprogramming/metaclasses-and-class-creation.md` | Write a data descriptor and a non-data descriptor with the same name as an instance attribute, and see which wins; register subclasses with `__init_subclass__` | … the attribute lookup order, how a function becomes a bound method, and the steps between `class X:` and the finished class object |
| 7 | The CPython runtime | `python/runtime/memory-management-and-garbage-collection.md` → `python/runtime/bytecode-and-the-interpreter.md` | Create a reference cycle with a `weakref.finalize` on it and watch `gc.collect()`; `dis.dis` a small loop before and after warm-up with `adaptive=True` | … why `sys.getrefcount` reports one more, what the cyclic collector adds to reference counting, and what a specialised instruction is |
| 8 | Concurrency | `python/concurrency/threads-processes-and-the-gil.md` → `python/concurrency/asyncio-coroutines-and-tasks.md` | Time a CPU-bound function in 4 threads and in 4 processes; run three `asyncio.sleep(1)` calls one after another and then with a `TaskGroup` | … what the GIL (global interpreter lock) serializes and what releases it, why a coroutine object does nothing until awaited, and why a caught `CancelledError` should be re-raised |
| 9 | Types and tools | `python/typing/type-hints-and-generics.md` → `python/typing/protocols-typeddict-and-narrowing.md` → `python/tooling/testing-debugging-and-profiling.md` | Call an annotated function with the wrong type and see that it runs; read `annotationlib.get_annotations(f, format=Format.FORWARDREF)` for an undefined name; run one `unittest` test and one `timeit` from the command line | … why annotations are not enforced, when an annotation is evaluated since 3.14, and the difference between `TypeGuard` and `TypeIs` |

### Python Tutorial chapter-to-doc map

| Chapter | Sections | Doc(s) |
|---|---|---|
| 1 Whetting Your Appetite | (motivation) | this doc |
| 2 Using the Python Interpreter | 2.1 invoking, 2.2 environment | `python/python-lab-setup.md` |
| 3 An Informal Introduction to Python | 3.1 numbers | `python/fundamentals/objects-names-and-types.md` |
| 3 An Informal Introduction to Python | 3.1 text, 3.1 lists, 3.2 first steps | `python/data-structures/strings-bytes-and-formatting.md`, `python/data-structures/lists-tuples-and-sequences.md` |
| 4 More Control Flow Tools | 4.1–4.7 (`if`, `for`, `range`, `break`/`continue`, loop `else`, `pass`, `match`) | `python/fundamentals/control-flow-and-pattern-matching.md` |
| 4 More Control Flow Tools | 4.8–4.9 defining functions, 4.10 coding style | `python/fundamentals/functions-scopes-and-closures.md`; PEP 8 (the Python Enhancement Proposal that sets the style guide) itself is only cited, not summarized |
| 5 Data Structures | 5.1 lists, 5.2 `del`, 5.3 tuples, 5.8 comparing sequences | `python/data-structures/lists-tuples-and-sequences.md` |
| 5 Data Structures | 5.4 sets, 5.5 dictionaries | `python/data-structures/dicts-sets-and-hashing.md` |
| 5 Data Structures | 5.6 looping techniques | `python/iteration-and-functional/iterators-generators-and-itertools.md`, `python/fundamentals/control-flow-and-pattern-matching.md` |
| 5 Data Structures | 5.7 more on conditions | `python/fundamentals/objects-names-and-types.md` |
| 6 Modules | 6.1–6.4 | `python/modules-and-packaging/modules-packages-and-imports.md`; `dir()` in `python/standard-library/standard-library-tour.md` |
| 7 Input and Output | 7.1 fancier output formatting | `python/data-structures/strings-bytes-and-formatting.md` |
| 7 Input and Output | 7.2 reading and writing files | `python/errors-and-resources/context-managers-and-file-io.md`; `json` in `python/standard-library/standard-library-tour.md` |
| 8 Errors and Exceptions | 8.1–8.10 | `python/errors-and-resources/exceptions-and-exception-groups.md`; 8.8 predefined clean-up actions in `python/errors-and-resources/context-managers-and-file-io.md` |
| 9 Classes | 9.1 names and objects, 9.2 scopes and namespaces | `python/fundamentals/objects-names-and-types.md`, `python/fundamentals/functions-scopes-and-closures.md` |
| 9 Classes | 9.3–9.7 | `python/classes/classes-instances-and-inheritance.md` |
| 9 Classes | 9.8 iterators, 9.9 generators, 9.10 generator expressions | `python/iteration-and-functional/iterators-generators-and-itertools.md` |
| 10 Brief Tour of the Standard Library | 10.1–10.4, 10.6, 10.7, 10.9, 10.12 | `python/standard-library/standard-library-tour.md` |
| 10 Brief Tour of the Standard Library | 10.5 string pattern matching | `python/standard-library/regular-expressions.md` |
| 10 Brief Tour of the Standard Library | 10.8 dates and times | `python/standard-library/dates-and-times.md` |
| 10 Brief Tour of the Standard Library | 10.10 performance measurement, 10.11 quality control | `python/tooling/testing-debugging-and-profiling.md` |
| 11 Brief Tour — Part II | 11.1 output formatting, 11.2 templating, 11.3 binary records, 11.7 list tools, 11.8 decimal | `python/standard-library/standard-library-tour.md` |
| 11 Brief Tour — Part II | 11.4 multi-threading | `python/concurrency/threads-processes-and-the-gil.md` |
| 11 Brief Tour — Part II | 11.5 logging | `python/tooling/testing-debugging-and-profiling.md` |
| 11 Brief Tour — Part II | 11.6 weak references | `python/runtime/memory-management-and-garbage-collection.md` |
| 12 Virtual Environments and Packages | 12.1–12.3 | `python/modules-and-packaging/virtual-environments-and-packaging.md` |
| 13 What Now? | (reading list) | the resources table below |
| 14 Interactive Input Editing | 14.1–14.2 | not covered |
| 15 Floating-Point Arithmetic | 15.1 representation error | `floating-point/` (outside this topic), `python/fundamentals/objects-names-and-types.md` |
| 16 Appendix | 16.1 interactive mode | not covered |

### Free, authoritative resources

| Resource | Why |
|---|---|
| [The Python Tutorial](https://docs.python.org/3/tutorial/index.html) | The chapter sequence mapped above, with longer explanations |
| [The Python Language Reference](https://docs.python.org/3/reference/index.html) | The normative definition of syntax and semantics |
| [The Python Standard Library](https://docs.python.org/3/library/index.html) | Every built-in type, function and module |
| [Python HOWTOs](https://docs.python.org/3/howto/index.html) | Focused guides: descriptors, sorting, logging, regular expressions, free threading |
| [PEP index](https://peps.python.org/) | The design and rationale behind each feature |
| [Specification for the Python type system](https://typing.python.org/en/latest/spec/index.html) | What type checkers must do with annotations |
| [Python Packaging User Guide](https://packaging.python.org/en/latest/) | Packaging specifications and guides |

### Not yet covered in this knowledge base

| Topic | Fits under | Start with |
|---|---|---|
| The C API (application programming interface) and writing extension modules | a new `python/` subtopic | `extending/index.html` and `c-api/index.html` |
| Interactive shell features (PyREPL, completion, history) | `python/tooling/` | Tutorial chapter 14 |

## Lookup notes
- Every behaviour the stage docs mark as measured in the lab ran in CPython 3.15.2 (Homebrew, macOS 26.1, arm64) on 2026-11-24; the rest is backed by the official pages they cite. Timings in the concurrency, sequences and regular-expression docs come from one loaded machine: compare their ratios, not their absolute values.
- docs.python.org/3/ served the 3.15 documentation when these docs were written. Links will move to 3.16 when it is released; the version-pinned form is `docs.python.org/3.15/`.
- The docs summarize the official pages in new words and add measured results; the Tutorial's longer explanations remain worth reading.

## Takeaways
- Follow the stages in order: stages 4–6 rely on names, closures and the iteration protocol from stages 1 and 5.
- Predict each exercise's output before running it, then compare your run with the doc.

## Verification status
- Verified: 0 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab every exercise runs in.
- [The Python Tutorial](https://docs.python.org/3/tutorial/index.html) — Python Software Foundation, living. Rank 1. Backs: the chapter and section structure of the map.
- [The Python Language Reference](https://docs.python.org/3/reference/index.html) — Python Software Foundation, living. Rank 1. Backs: resources table.
- [The Python standard library](https://docs.python.org/3/library/index.html) — Python Software Foundation, living. Rank 1. Backs: resources table.
- [Python HOWTOs](https://docs.python.org/3/howto/index.html) — Python Software Foundation, living. Rank 1. Backs: resources table.
- [PEP 0 – Index of Python Enhancement Proposals (PEPs)](https://peps.python.org/) — Python Software Foundation, living. Rank 1. Backs: resources table.
- [Specification for the Python type system](https://typing.python.org/en/latest/spec/index.html) — Python typing council, living. Rank 1. Backs: resources table.
- [Python Packaging User Guide](https://packaging.python.org/en/latest/) — Python Packaging Authority, living. Rank 1. Backs: resources table.

## Related
- `python/index.md` — the topic index with every doc's summary.
- `javascript/learning-path.md` — the same kind of path for JavaScript.
- `floating-point/` — Tutorial chapter 15 in depth.
