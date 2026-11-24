---
schema: knowledge-doc/v1
type: concept
topic: python/runtime
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, cpython, memory, reference-counting, garbage-collection, gc, weakref, finalizer, del, immortal-objects, pymalloc, tracemalloc, getsizeof, intern]
ranked-sources: true
---

# Memory management and garbage collection in CPython

## Summary
**TL;DR:** CPython frees an object the moment its reference count (the number of strong references to it) drops to zero; a separate cyclic garbage collector, the `gc` module, later finds groups of objects that only reference each other and frees them. A weak reference lets code reach an object without keeping it alive. All of this is CPython behaviour: the language only says unreachable objects *may* be collected, so close files and sockets explicitly instead of relying on `__del__`. In 3.15 the collector is the generational one from 3.13; the incremental collector shipped in 3.14.0–3.14.4 was reverted.
**Use this when:** memory keeps growing, `__del__` runs late or never, a cache keeps objects alive, `sys.getrefcount` or `sys.getsizeof` returns a surprising number, you tune `gc` around `fork()`, or you hunt a leak with `tracemalloc`.
**Not this doc:** identity, `is` and small-integer reuse → `python/fundamentals/objects-names-and-types.md`; closing resources with `with` → `python/errors-and-resources/context-managers-and-file-io.md`; the GIL (global interpreter lock) and free-threaded builds → `python/concurrency/threads-processes-and-the-gil.md`; profilers → `python/tooling/testing-debugging-and-profiling.md`; `__slots__` → `python/metaprogramming/descriptors-and-attribute-lookup.md`.

## Problem
Memory behaviour in Python is mostly invisible until it surprises you:
- Two objects that point at each other survive `del` of every name: their `__del__` runs only when `gc.collect()` runs ✅[^lab].
- A plain `dict` used as a cache keeps every cached object alive for as long as the cache lives ✅[^weakref].
- `sys.getsizeof` reports 136 bytes for a list of ten references to a 10,000-character string ✅[^lab].
- `sys.getrefcount(None)` returns `3221225472`, which counts nothing real ✅[^lab].
- `__del__` is not guaranteed to run for objects still alive when the interpreter exits ✅[^datamodel].

## Mental model
**Analogy:** a library where every book carries a borrower count. Each strong reference (a name, a list slot, an attribute) is a loan; when the last loan comes back, the book is shredded at once. Books that only cite each other in a ring keep each other's counts above zero, so an auditor (the cyclic collector) walks the shelves now and then, finds rings no reader can reach, and shreds them. A weak reference is a catalogue card: it finds the book if it still exists but is not a loan. Immortal objects are reference books chained to the desk: nobody updates their count.

**Artifact** (measured in the lab ✅[^lab]):
```python
import sys, gc, weakref
x = object()
sys.getrefcount(x)            # 2   the name x + the call's own argument
y = x; sys.getrefcount(x)     # 3
class Noisy:
    def __init__(self, name): self.name = name
    def __del__(self): print(f"  __del__ {self.name}")
n = Noisy("n"); del n         # prints "  __del__ n" at once: the count hit zero
gc.disable(); gc.collect()
a = Noisy("a"); b = Noisy("b"); a.other = b; b.other = a
r = weakref.ref(a); del a, b
r() is not None               # True   the cycle keeps both alive
gc.collect()                  # prints both __del__ lines, returns 2
```

## How it works
1. **What the language promises.** Objects are never explicitly destroyed; once unreachable they may be garbage-collected, and an implementation may postpone collection or omit it, as long as it never collects a reachable object ✅[^datamodel]. CPython implementation detail: CPython uses reference counting plus an optional, delayed detector of cyclic garbage; most objects go as soon as they are unreachable, cycles are not guaranteed to be collected, and code must not depend on immediate finalization ✅[^datamodel].
2. **Reference counting.** The count says how many places hold a strong reference; when it reaches zero the object is deallocated, the references it holds are released, and those objects may be deallocated in turn ✅[^capi-intro]. `del x` only removes one reference; `__del__` runs when the count reaches zero ✅[^datamodel].
   - `sys.getrefcount(obj)` is generally one higher than expected, because the call's argument is a temporary reference; do not rely on any value except 0 or 1 ✅[^sys]. Counts are not stable values and may differ between versions ✅[^glossary]: since 3.14 the interpreter borrows references when loading objects onto its stack, which can make counts smaller than before ✅[^whatsnew314].
   - In the lab: a fresh object `2`, after `y = x` `3`, also stored twice in a list `5`, back to `2` after `del y, lst`, and `2` when measured inside a function that received it ✅[^lab].
3. **Immortal objects (PEP 683, 3.12; PEP = Python Enhancement Proposal).** An immortal object's count is never modified, so it is never deallocated while the interpreter runs; `True` and `None` are examples, and immortality is a CPython implementation detail ✅[^glossary]. The PEP makes the singletons, the static types and small ints immortal, and keeps the marking details private and subject to change ✅[^pep683]. Since 3.12 their counts are very large numbers ✅[^sys]. `sys._is_immortal()` (3.14) reports it, for specialised use only ✅[^sys]. In the lab, `None`, `True`, `""`, `()` and `object` were immortal, as were the ints from -5 to 1024, while `-6`, `1025` and `10**6` were not ✅[^lab].
4. **The cyclic collector.** It supplements reference counting and can be disabled with `gc.disable()` if a program creates no reference cycles ✅[^gc]. It sorts tracked objects into three generations: new objects start in generation 0, survivors move one generation up; a collection starts when allocations minus deallocations exceed `threshold0`, and generation 1 is examined too once generation 0 has been examined more than `threshold1` times ✅[^gc]. The lab's defaults were `(2000, 10, 10)` ✅[^lab]. Since 3.12 the collector is started only from the "eval breaker" mechanism of the bytecode evaluation loop, not on object allocation, and it can also run when C code calls `PyErr_CheckSignals()` ✅[^whatsnew312].
   - `gc.collect()` runs a full collection and returns collected plus uncollectable objects ✅[^gc]: `2` for the two-object cycle, `1` for an object that references itself, `0` when nothing is left ✅[^lab].
   - Only containers are tracked: instances of atomic types are not, and some types skip tracking for simple contents ✅[^gc]; in the lab `0`, `"a"` and `(1, 2)` were untracked, lists, dicts and class instances tracked ✅[^lab].
5. **The 3.14 incremental collector, reverted.** 3.14.0–3.14.4 shipped an incremental collector with only young and old generations; `gc.collect(1)` then ran one increment ✅[^whatsnew314]. After reports of significant memory pressure in production, 3.14.5 restored the generational collector from 3.13, and 3.15 uses it too ✅[^whatsnew315]. The `gc` page records the same: generation 1 and `threshold2` were removed in 3.14 and restored in 3.14.5 ✅[^gc]. New in 3.15: `gc.get_stats()` and `gc.callbacks` also report `duration` and `candidates` ✅[^gc].
6. **`gc.freeze()` for fork-based servers.** It moves every tracked object into a permanent generation that later collections ignore ✅[^gc]. To keep memory pages shared after `fork()` without `exec()`, call `gc.disable()` early in the parent, `gc.freeze()` right before `fork()`, and `gc.enable()` early in each child ✅[^gc].
7. **Finalizers and PEP 442 (3.4).** `__del__`, also called a finalizer, runs when an instance is about to be destroyed; it may resurrect the object by storing a new reference, and CPython calls it only once ✅[^datamodel]. PEP 442 lets objects with finalizers be reclaimed even inside cycles: the collector clears weak references (running their callbacks), calls every finalizer in the isolated group in an undefined order, checks the group is still unreachable (otherwise it resurrects all of it), and only then breaks the references ✅[^pep442]. Since then, objects with `__del__` no longer land in `gc.garbage` ✅[^gc]; it stayed `[]` in the lab ✅[^lab].
8. **Weak references (`weakref`).** A weak reference does not keep its referent alive ✅[^weakref].
   - `weakref.ref(obj, callback)` returns a callable that gives the object, or `None` once it is gone; the optional callback receives the weak reference when the object is about to be finalized ✅[^weakref].
   - `WeakValueDictionary` and `WeakKeyDictionary` drop an entry when no strong reference to its value or key remains ✅[^weakref]; in the lab the `WeakValueDictionary` key list went from `['big']` to `[]` after `del big` ✅[^lab].
   - `weakref.finalize(obj, func, *args)` registers a cleanup that stays alive until `obj` is collected, runs once, and by default also runs at interpreter shutdown ✅[^weakref].
9. **Allocators.** All Python objects live in a private heap run by the Python memory manager; a raw allocator talks to the operating system, and object-specific allocators work on top of it ✅[^capi-memory]. Allocation functions belong to three domains: raw (memory requested directly from the system), "mem" (general buffers from the Python heap) and object (Python objects from the Python heap) ✅[^capi-memory]. In a default release build, raw requests go to the C `malloc` and the other two to pymalloc; the free-threaded build uses mimalloc ✅[^capi-memory]. pymalloc serves small (at most 512 bytes), short-lived objects from "arenas", memory mappings of 1 MiB on 64-bit platforms, and passes larger requests to the raw allocator ✅[^capi-memory]. The `PYTHONMALLOC` environment variable picks the allocators, for example `malloc`, `mimalloc` or `pymalloc_debug` ✅[^capi-memory]. The lab's `sys._debugmallocstats()` printed `Small block threshold = 512` and `1048576 bytes/arena` ✅[^lab].
10. **Measuring.** `sys.getsizeof(obj)` counts only the memory attributed directly to the object, not the objects it refers to, plus the collector's overhead for tracked objects ✅[^sys]. `tracemalloc` traces blocks allocated by Python; `start()` installs the hooks, `take_snapshot()` excludes blocks allocated before tracing began, and by default each trace keeps one frame ✅[^tracemalloc].
11. **String interning.** `sys.intern(s)` returns the one shared copy from the interned-strings table, so dictionary key comparisons can use a pointer compare; names in programs are interned automatically; interned strings are not immortal, so keep a reference to the result ✅[^sys]. In the lab `"".join(["ab", "cd"]) is "abcd"` was `False`, and after `sys.intern` on both it was `True` ✅[^lab].

## Worked example
A tree whose children point back at their parent, built first with a strong and then with a weak back-pointer. `gc` is disabled during the run so only reference counting acts until `gc.collect()` is called. Every value ran in the lab ✅[^lab]:

| Step | Code | Result | Why |
|---|---|---|---|
| 1 | `root = Node("root"); leaf = Node("leaf", root)` (child stores `self._parent = parent`) | `sys.getrefcount(root)` `3`, `sys.getrefcount(leaf)` `3` | `root`: its name, `leaf._parent`, the call argument; `leaf`: its name, `root.children`, the argument |
| 2 | `probe = weakref.ref(root); del root, leaf` | `probe() is not None` is `True`; no `__del__` printed | the cycle `root.children → leaf → root` keeps both counts above zero |
| 3 | `gc.collect()` with `gc.DEBUG_SAVEALL` | prints `__del__ root`, `__del__ leaf`; returns `4`; found `['Node', 'Node', 'list', 'list']` | the two nodes and their two `children` lists formed the unreachable group |
| 4 | Rebuild with `self._parent = weakref.ref(parent)` | `sys.getrefcount(root)` `2`; `leaf._parent() is root` `True` | the back-pointer is no longer a loan |
| 5 | `del leaf` | nothing printed | `root.children` still holds the leaf |
| 6 | `del root` | prints `__del__ root`, `__del__ leaf` at once; `gc.collect()` returns `0` | no cycle: counts reach zero, and freeing `root` releases `leaf` |

Reading a parent pointer through a weak reference costs one call (`leaf._parent()`), and frees the whole tree as soon as the last outside name goes.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `gc.is_tracked({})` | `True` in the lab ✅[^lab]; the `gc` page's example shows `False` ✅[^gc] | The page allows type-specific tracking optimizations, so the result is a CPython detail that changed ✅[^gc] |
| `__del__` raises | The program continues; `sys.unraisablehook` received `('RuntimeError', 'boom in __del__')` ✅[^lab] | Exceptions in `__del__` are ignored and reported as a warning on `sys.stderr` ✅[^datamodel] |
| `__del__` stores `self` in a global (resurrection) | Object survives; `gc.is_finalized` is `True`; dropping it again did not call `__del__` a second time ✅[^lab] | CPython calls `__del__` only once ✅[^datamodel] ✅[^pep442] |
| `weakref.ref` to an `int`, `str`, `list`, `dict` or `tuple` | `TypeError: cannot create weak reference to 'int' object` (and so on); a `dict` subclass worked ✅[^lab] | `list` and `dict` need a subclass; in CPython `tuple` and `int` cannot be weakly referenced even then ✅[^weakref] |
| `weakref.ref(c.method)()` | `None` straight away; `weakref.WeakMethod(c.method)()()` returned `'hi'` ✅[^lab] | A bound method is created fresh on each access, so use `WeakMethod` ✅[^weakref] |
| `weakref.finalize(obj, obj.close)` | `obj` is never collected ✅[^weakref] | `func`, `args` and `kwargs` must not reference `obj`; a bound method of `obj` does ✅[^weakref] |
| An exception caught into a local variable | Creates a cycle frame → exception → traceback → frame | Left for the cyclic collector (CPython detail) ✅[^datamodel] |
| `gc.collect(3)` | `ValueError: invalid generation` ✅[^lab] | Only generations 0 to 2 exist ✅[^gc] |
| `sys.intern` result dropped | The string may leave the table | Interned strings are not immortal ✅[^sys] |
| List growth by `append` | `sys.getsizeof` stepped 56 → 88 → 120 → 184 → 248 bytes at lengths 0, 1, 5, 9, 17 ✅[^lab] | Observation of over-allocation in 3.15.2, not a guarantee |
| `tracemalloc` around `[str(i) * 10 for i in range(100_000)]` | `compare_to` put that line first: `+9560 KiB`, `count_diff=100001`; after `del` the traced total fell to 4 KiB ✅[^lab] | Snapshots diff per line; `get_traced_memory()` gives `(current, peak)` ✅[^tracemalloc] |
| `PYTHONMALLOC=malloc` with `python3.15 -I` | Ignored | `-I` ignores all `PYTHON*` variables ✅[^cmdline] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `with` / explicit `close()` | Release at a known point; recommended for external resources ✅[^datamodel] | Every caller must use it |
| `__del__` | Runs automatically when the count hits zero | Not guaranteed at exit; may run in any thread or during shutdown; exceptions ignored ✅[^datamodel] |
| `weakref.finalize` | Runs once, survives until collection, runs at exit by default ✅[^weakref] | Must not capture the object |
| Weak back-pointers / `WeakValueDictionary` cache | No cycle; objects leave as soon as unused | Each read may return `None`; not every type is weak-referenceable |
| `gc.disable()` / `gc.freeze()` | No collector pauses; shared pages after `fork()` ✅[^gc] | Leaks any cycle the program creates |

## Takeaways
- Close files, sockets and locks with `with` or `close()`; never rely on `__del__` or garbage collection to do it ✅[^datamodel]. [rule-candidate]
- Break parent/child cycles with `weakref.ref` back-pointers, and cache with `WeakValueDictionary` when entries must not keep objects alive ✅[^weakref]. [rule-candidate]
- Read `sys.getrefcount` only as "0, 1 or more", and `sys.getsizeof` as the shallow size ✅[^sys]. [rule-candidate]
- Use `tracemalloc` snapshot diffs to find which line allocates, before tuning `gc`.
- Pass `weakref.finalize` a function that does not reference the object, never one of its bound methods ✅[^weakref]. [rule-candidate]
- Do not depend on 3.14.0–3.14.4's incremental collector behaviour: 3.14.5+ and 3.15 are generational ✅[^whatsnew315].

## Verification status
- Verified: 84 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Data model: Objects, values and types; object.\_\_del\_\_](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: collection is optional and unreachable-only; CPython's reference counting plus cycle detection; `del` versus `__del__`; resurrection and single call; exit, thread and exception caveats; exception cycles; explicit close. [^datamodel]
- [gc — Garbage Collector interface](https://docs.python.org/3/library/gc.html) — Python Software Foundation, living. Rank 1. Backs: generations and thresholds, `collect()` return value and valid generations, `is_tracked`, `freeze` and the fork recipe, `garbage` after PEP 442, the 3.14/3.14.5 changes, 3.15 stats keys. [^gc]
- [weakref — Weak references](https://docs.python.org/3/library/weakref.html) — Python Software Foundation, living. Rank 1. Backs: `ref` and callbacks, weak dictionaries, `WeakMethod`, `finalize` and its caveat, which types support weak references. [^weakref]
- [sys — System-specific parameters and functions](https://docs.python.org/3/library/sys.html) — Python Software Foundation, living. Rank 1. Backs: `getrefcount`, `getsizeof`, `intern`, `_is_immortal`, immortal refcounts since 3.12. [^sys]
- [tracemalloc — Trace memory allocations](https://docs.python.org/3/library/tracemalloc.html) — Python Software Foundation, living. Rank 1. Backs: what it traces, `start`, `take_snapshot`, `get_traced_memory`. [^tracemalloc]
- [Memory Management](https://docs.python.org/3/c-api/memory.html) — Python Software Foundation, living. Rank 1. Backs: the private heap, allocator domains, default allocators per build, pymalloc's 512-byte limit and arenas, `PYTHONMALLOC`. [^capi-memory]
- [Introduction: Objects, Types and Reference Counts](https://docs.python.org/3/c-api/intro.html) — Python Software Foundation, living. Rank 1. Backs: what a reference count counts and the cascade at zero. [^capi-intro]
- [Glossary: reference count, immortal](https://docs.python.org/3/glossary.html) — Python Software Foundation, living. Rank 1. Backs: counts are not stable between versions; immortal objects are a CPython detail. [^glossary]
- [Command line and environment](https://docs.python.org/3/using/cmdline.html) — Python Software Foundation, living. Rank 1. Backs: `-I` ignores `PYTHON*` variables. [^cmdline]
- [What's new in Python 3.12](https://docs.python.org/3/whatsnew/3.12.html) — Python Software Foundation, 2023. Rank 1. Backs: the collector runs on the eval breaker. [^whatsnew312]
- [What's new in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, 2025. Rank 1. Backs: the incremental collector in 3.14.0–3.14.4; borrowed references lowering counts. [^whatsnew314]
- [What's new in Python 3.15](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: 3.15 uses the generational collector from 3.13. [^whatsnew315]
- [PEP 442 – Safe object finalization](https://peps.python.org/pep-0442/) — Antoine Pitrou, 2013. Rank 1. Backs: finalizers in cycles, the disposal sequence, undefined order, one call. [^pep442]
- [PEP 683 – Immortal Objects, Using a Fixed Refcount](https://peps.python.org/pep-0683/) — Eric Snow, Eddie Elizondo, 2022. Rank 1. Backs: which objects are immortal; the details are private. [^pep683]

## Related
- `python/fundamentals/objects-names-and-types.md` — identity, `is`, and why small-int reuse must not be relied on.
- `python/errors-and-resources/context-managers-and-file-io.md` — releasing resources deterministically with `with`.
- `python/runtime/bytecode-and-the-interpreter.md` — the evaluation loop the collector runs from.
- `python/concurrency/threads-processes-and-the-gil.md` — threads, `fork()` and the free-threaded build.
- `python/tooling/testing-debugging-and-profiling.md` — profiling memory and time.
