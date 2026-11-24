---
schema: knowledge-doc/v1
type: concept
topic: python/modules-and-packaging
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, modules, packages, import, sys-path, sys-modules, namespace-packages, relative-imports, circular-imports, importlib, lazy-imports, pep-810, pep-420]
ranked-sources: true
---

# Modules, packages and the import system

## Summary
**TL;DR:** A module is a `.py` file that Python runs once per process into a module object, whose namespace becomes the module's globals. `import` first looks in the `sys.modules` cache; on a miss, finders search `sys.path` (the script's folder or the current directory first, then `PYTHONPATH`, the standard library, site-packages) and a loader runs the file, then the statement binds a name. A package is a module with a `__path__`: regular with `__init__.py`, or a namespace package (PEP 420, a Python Enhancement Proposal) without one. Python 3.15 adds `lazy import` (PEP 810), which binds a proxy and loads the module on first use.
**Use this when:** you hit `ModuleNotFoundError`, "attempted relative import with no known parent package" or "partially initialized module", a local file hides a standard module, `importlib.reload()` seems to do nothing, or you want to defer an expensive import.
**Not this doc:** virtual environments, `pip` and `pyproject.toml` → `python/modules-and-packaging/virtual-environments-and-packaging.md`; `.pyc` files and bytecode → `python/runtime/bytecode-and-the-interpreter.md`; global, local and enclosing scopes → `python/fundamentals/functions-scopes-and-closures.md`; what a name binding is → `python/fundamentals/objects-names-and-types.md`.

## Problem
Import errors look random until the rules are known:
- `python shop/cart.py` fails with `ImportError: attempted relative import with no known parent package`, while `python -m shop.cart` works.
- A file called `random.py` next to a script breaks `import random` for that script.
- Two modules that import names from each other fail with "cannot import name … from partially initialized module".
- After `importlib.reload(cfg)`, a name taken earlier with `from cfg import LEVEL` still holds the old value.
- A `print()` at the top of a module runs once, although three modules import it.

## Mental model
**Analogy:** a library with a loan register. The register (`sys.modules`) lists every book already lent to this process; anyone asking for a listed title gets the same copy, so each book is read (its module body run) only once. A title not in the register is searched shelf by shelf in a fixed order (`sys.path`), and the first shelf holding it wins, even if the "real" book sits on a later shelf. `import` then writes a note in your own notebook (a name in your namespace) pointing at that copy.

**Artifact** (measured in the lab ✅[^lab]):
```python
# counter.py contains:  print("counter: module body runs"); hits = 0
import counter                 # counter: module body runs
import counter as again        # (prints nothing: found in sys.modules)
counter is again, sys.modules["counter"] is counter   # (True, True)
import shop.cart               # binds only the name 'shop'
from shop import tax           # binds only 'tax'
import shop.cart as sc         # binds only 'sc', the shop.cart module
sorted(k for k in sys.modules if k.startswith("shop"))  # ['shop', 'shop.cart', 'shop.tax']
```

## How it works
Four actors take part in an `import`:
- **The `import` statement** — its job: name the module and bind the result, via `__import__()` ✅[^import-system].
- **The module cache** — its job: hand back modules already imported, via the `sys.modules` dict ✅[^import-system].
- **Finders** — their job: locate a module and describe it, via `find_spec()` on each `sys.meta_path` entry, returning a module spec ✅[^import-system].
- **The loader** — its job: run the module's code, via `exec_module(module)` into `module.__dict__` ✅[^import-system].

```
import shop.cart
   │ (for "shop", then "shop.cart")
   ├─▶ sys.modules["shop"] present? ── yes ─▶ reuse it
   │        no
   ├─▶ sys.meta_path: BuiltinImporter → FrozenImporter → PathFinder
   │        PathFinder walks sys.path (or shop.__path__ for the submodule)
   │        └─ returns ModuleSpec(name, loader, origin, …)
   ├─▶ create module, put it in sys.modules, loader.exec_module(module)
   └─▶ bind the name 'shop' in the importing namespace
```

1. **A module is a file plus a module object.** A module is a file of Python definitions and statements, its name is the file name without `.py`, and inside it `__name__` holds that name ✅[^tut-modules]. Its top-level statements run only the first time the module name is met in an import, and each module has a private namespace that its functions use as their global namespace ✅[^tut-modules].
2. **Statement: search, then bind.** `import` combines a search (a call to `__import__()`) with binding the result; a direct `__import__()` call searches but binds nothing ✅[^import-system]. The binding rules ✅[^simple-stmts]:
   - `import a.b.c` imports `a`, `a.b` and `a.b.c` but binds only `a`; `as x` binds `x` to `a.b.c` itself.
   - `from a.b import c` checks for an attribute `c` on `a.b`, tries to import a submodule `a.b.c` if there is none, and raises `ImportError` if both fail.
   - Loading a submodule also binds it as an attribute of its parent, so `sys.modules["shop"].cart is sys.modules["shop.cart"]` ✅[^import-system] (`True` in the lab ✅[^lab]).
   - `importlib.import_module("pkg.mod")` returns `pkg.mod`, while `__import__("pkg.mod")` returns the top-level `pkg` ✅[^importlib].
3. **Cache: `sys.modules`.** It is checked first; a hit ends the search, a value of `None` raises `ModuleNotFoundError`, and deleting a key makes the next import search again and build a new, different module object ✅[^import-system]. A new module is added to `sys.modules` before its code runs, so a module that imports itself does not recurse forever; if loading fails, only the failing module is removed ✅[^import-system].
4. **Finders and specs.** On a cache miss, each finder on `sys.meta_path` is asked in turn; the defaults find built-in modules, frozen modules and modules on an import path ✅[^import-system], listed in the lab as `['BuiltinImporter', 'FrozenImporter', 'PathFinder']` ✅[^lab]. A finder does not load anything: it returns a module spec, exposed later as `module.__spec__`, with fields such as `name`, `loader`, `origin` (the file), `cached` (the bytecode file), `parent` and `submodule_search_locations` ✅[^importlib]. `importlib.util.find_spec(name)` returns that spec, or `None` when no finder knows the name ✅[^importlib]. The path based finder asks the hooks in `sys.path_hooks` for a path entry finder per `sys.path` entry and caches it in `sys.path_importer_cache` ✅[^import-system]; for a folder that finder is a `FileFinder` ✅[^lab].
5. **Loader.** The loader executes a Python module's code in `module.__dict__` ✅[^import-system]. Python caches the compiled code as `__pycache__/<name>.cpython-<XY>.pyc` and recompiles when the source changes ✅[^tut-modules]; the lab wrote `__pycache__/counter.cpython-315.pyc` ✅[^lab]. Details: `python/runtime/bytecode-and-the-interpreter.md`.
6. **How `sys.path` is built.** At startup the first entry is the script's folder, or the current directory for the REPL (read–eval–print loop, the interactive prompt), `-c` and `-m` ✅[^sys-path-init]; for a script reached through a symbolic link, the link is resolved first ✅[^sys]. Next come `PYTHONPATH` entries, then the standard library folders (a `python3XY.zip`, `lib/python3.X`, `lib-dynload`), and finally `site` adds the site-packages folders ✅[^sys-path-init]. `-P` (or `PYTHONSAFEPATH`) skips the first entry, and `-I` implies `-E`, `-P` and `-s` ✅[^cmdline]. Lab runs, with `PYTHON*` variables ignored (`-E`) ✅[^lab]:

   | Start mode | `sys.path[0]` |
   |---|---|
   | `python3.15 -E bin/show_path.py` | `'<W>/bin'` (the script's folder) |
   | `python3.15 -E -c '…'` | `''` (the current directory) |
   | `cd bin && python3.15 -E -m show_path` | `'<W>/bin'` (the current directory, absolute) |
   | `python3.15 -E -P bin/show_path.py` or `-I` | `'…/lib/python315.zip'`: no script folder at all |
   | `PYTHONPATH=<W>/extra python3.15 -c …` vs. `-I` | `<W>/extra` is on `sys.path`; with `-I` it is not |
7. **`__main__` and `-m`.** The module Python starts with runs under the name `'__main__'`, so `if __name__ == "__main__":` guards code that must not run on import ✅[^main]. `-m mod` finds `mod` through the normal import machinery and runs it as `__main__`; given a package, it runs `<pkg>.__main__` ✅[^cmdline]. `__main__.__spec__` is `None` for a script file, `-c` and the REPL, and is a real spec under `-m` ✅[^import-system]. In the lab, `python greet.py` printed `__name__ = '__main__' | __spec__ is None: True`, `python -m greet` printed `'__main__'` with `False`, and `import greet` printed `'greet'` ✅[^lab].
8. **Packages.** Any module with a `__path__` attribute is a package ✅[^import-system].
   - A regular package is a folder with `__init__.py`; importing `parent.one` runs `parent/__init__.py`, then `parent/one/__init__.py` ✅[^import-system].
   - A namespace package (PEP 420) has no `__init__.py`. While scanning the parent path for `foo`, a `foo/__init__.py` wins at once; a bare `foo` folder is only recorded, and if the scan ends without a regular package, a namespace package is built whose `__path__` lists every recorded folder ✅[^pep420]. In the lab, `portion_a/ns/alpha.py` and `portion_b/ns/beta.py` became one package with `__path__` = `NamespacePath(['<W>/portion_a/ns', '<W>/portion_b/ns'])` ✅[^lab].
9. **Relative imports.** One leading dot means the current package, each further dot one parent up, and only the `from … import` form may be relative ✅[^import-system]. They resolve against the current module's package name, and a main module has none, so a module run as the main program must use absolute imports ✅[^tut-modules].
10. **`from x import *` and `__all__`.** If the module defines `__all__`, those names are the public names and must exist; otherwise every name not starting with `_` is public; the star form is allowed only at module level ✅[^simple-stmts]. In a package, `__all__` in `__init__.py` lists the submodules to import ✅[^tut-modules].
11. **Circular imports.** When `foo` starts importing `bar` and `bar` asks `foo` for a name, `foo`'s globals are still empty, so the lookup fails; the fixes are to use `import foo` with `foo.name` inside functions, to move the import into the function, or to restructure ✅[^faq].
12. **Reload.** `importlib.reload(mod)` recompiles and reruns the module code with the loader that first loaded it ✅[^importlib], inside the same module object ✅[^import-system]. The old dictionary is kept, so removed names linger; names bound elsewhere by `from mod import x`, and instances of reloaded classes, keep the old objects ✅[^importlib].
13. **Lazy imports (3.15, PEP 810).** `lazy import json` and `lazy from json import dumps` bind a proxy object instead of loading the module; the module loads on first use of the name, and a load error is raised there, not at the import line ✅[^simple-stmts]. The proxy type is `types.LazyImportType` ✅[^whatsnew315]. Rules:
    - `lazy` is a soft keyword: it may still be used as an ordinary name elsewhere ✅[^pep810].
    - Allowed only at module scope: inside a function, a class body or a `try`/`except`/`finally` block it is a `SyntaxError`, as are `lazy from m import *` and a lazy `__future__` import ✅[^simple-stmts].
    - With `lazy from m import a, b`, the first use of either name loads all of `m` and resolves only that name ✅[^simple-stmts].
    - Until it is loaded, the module is absent from `sys.modules` and listed in `sys.lazy_modules`; `globals()` and a module's `__dict__` return the proxies without loading them ✅[^pep810].
    - Loading uses `sys.path` and the import hooks as they are at first use, not as they were at the `lazy import` line ✅[^pep810].
    - `__lazy_modules__ = ["json"]` makes a plain `import json` in that module lazy, for code that must also run on older versions ✅[^simple-stmts].
    - `-X lazy_imports=all` or `PYTHON_LAZY_IMPORTS=all` makes imports lazy by default; `normal` (the default) honours only the keyword ✅[^cmdline]. `sys.set_lazy_imports()` changes the mode at runtime, and `sys.set_lazy_imports_filter()` takes a callable that decides per import ✅[^sys].
14. **Other 3.15 changes.** The import system acquires per-module locks in hierarchical order (parent packages before submodules), which fixes a deadlock between a thread importing `pkg.sub` and one importing `pkg.sub.mod` ✅[^whatsnew315]. In 3.15.2 a package's import lock is released as soon as its `__init__` returns, and `importlib.import_module()` returns the partially initialised module in a circular import split across threads instead of raising `_DeadlockError` ✅[^whatsnew315]. Modules no longer get a `__cached__` attribute: read `__spec__.cached` ✅[^whatsnew315].

## Worked example
A package `shop` with `shop/__init__.py` (prints `shop/__init__.py runs`), `shop/tax.py` (`RATE = 0.1`), `shop/cart.py` (`from . import tax`, `from .tax import RATE`, `def total(x): return round(x * (1 + RATE), 2)`) and `shop/__main__.py` (calls `total(100)`), run from the folder that holds `shop/` ✅[^lab]:

| Step | Command | Output | Rule |
|---|---|---|---|
| 1 | `python3.15 -E shop/cart.py` | `ImportError: attempted relative import with no known parent package` | the file runs as `__main__`, which has no package (How it works 9) |
| 2 | `python3.15 -E -m shop.cart` | `shop/__init__.py runs` | `-m` imports `shop` first, so `.` resolves to `shop` |
| 3 | `python3.15 -E -m shop` | `shop/__init__.py runs`, then `python -m shop -> 110.0` | a package given to `-m` runs `shop.__main__` ✅[^cmdline] |
| 4 | in one process: `import shop.cart` | `sys.modules` keys `['shop', 'shop.cart', 'shop.tax']` | `cart`'s own import of `tax` was cached too |
| 5 | `importlib.import_module("shop.cart").__name__` vs. `__import__("shop.cart").__name__` | `shop.cart` vs. `shop` | How it works 2 |
| 6 | `sys.modules["shop.cart"].total(100)` | `110.0` | one module object, shared by every importer |
| 7 | `python3.15 -I -m shop` | `…/python3.15: No module named shop` | `-I` leaves the current folder off `sys.path` (How it works 6) |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `random.py` next to a script that runs `import random` | `AttributeError: module 'random' has no attribute 'seed' (consider renaming '<W>/shadow/random.py' since it has the same name as the standard library module named 'random' …)`; under `-I` the same script prints `2` ✅[^lab] | The script's folder comes before the standard library on `sys.path` ✅[^tut-modules]; the renaming hint is new in 3.13 ✅[^whatsnew313] |
| Two modules use `from other import name` at top level | `ImportError: cannot import name 'a_func' from partially initialized module 'circ_a' (most likely due to a circular import) (<W>/circ_a.py)`; both modules are dropped from `sys.modules`; the `import circ_a` plus `circ_a.a_func()` form works ✅[^lab] | The first module's globals are still empty when the second asks ✅[^faq] |
| `sys.modules["blocked"] = None`, then `import blocked` | `ModuleNotFoundError: import of blocked halted; None in sys.modules` ✅[^lab] | A `None` value forces that error ✅[^import-system] |
| Reloading `cfg` after its file changed `LEVEL = 1` to `2` and dropped `OLD` | `cfg.LEVEL` is `2`, a `from cfg import LEVEL` name is still `1`, `cfg.OLD` still exists, an old `Thing()` is not an instance of the new `cfg.Thing` ✅[^lab] | Reload refills the old dictionary; other references are not rebound ✅[^importlib] |
| `__file__` of a namespace package | `None`, with `__spec__.origin` `None` ✅[^lab] | PEP 420 says such packages have no `__file__` ✅[^pep420]; 3.15 sets the attribute but to `None`, and `__file__` is optional anyway ✅[^datamodel] |
| `from pkg import *` with no `__all__` in `pkg/__init__.py` | Submodules not imported before are not bound | Only names already in the package namespace are taken ✅[^tut-modules] |
| `sys.path[0]` is `'…/python315.zip'`, which does not exist ✅[^lab] | Harmless | The expected zip location is added even if the archive is missing ✅[^sys-path-init] |
| `lazy import json` inside `def f():` | `SyntaxError: lazy import not allowed inside functions` ✅[^lab] | Module scope only ✅[^simple-stmts] |
| `lazy from json import dumsp` (typo) | The import line passes; first use raises `ImportError: cannot import name 'dumsp' from 'json' … Did you mean: 'dump'?`, chained to `ImportError: lazy import of 'json.dumsp' raised an exception during resolution` ✅[^lab] | Errors move to first use, with both locations in the traceback ✅[^pep810] |
| `sys.set_lazy_imports("none")` | `ValueError: mode must be 'normal' or 'all'` ✅[^lab] | PEP 810 also describes a `"none"` mode ✅[^pep810], but the 3.15 `sys` docs list only `"normal"` and `"all"` ✅[^sys] |
| `sys._path0` | `AttributeError: module 'sys' has no attribute '_path0'` in the 3.15.2 lab build ✅[^lab] | The `sys` page lists it as "Added in version 3.15.2 (unreleased)" ✅[^sys]; do not rely on it yet |
| `json.__package__` | Still `'json'` in 3.15.2 ✅[^lab] | The data model page calls `__package__` removed in 3.15 and says to use `__spec__.parent` ✅[^datamodel]; What's New 3.15 calls it deprecated and scheduled for removal ✅[^whatsnew315] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `import mod`, then `mod.name` | Works in import cycles; sees reloaded values | Longer names at each use |
| `from mod import name` | Short names | A snapshot: stale after reload, fails in a top-level cycle ✅[^faq] |
| `lazy import mod` (3.15) | Pays the load cost only for modules actually used ✅[^whatsnew315] | Import errors and import-time side effects move to the first use ✅[^pep810]; module scope only |
| Import inside a function | Breaks a cycle or defers cost on any version | Hides the dependency; each call still costs a couple of dict lookups ✅[^faq] |
| Regular package (`__init__.py`) | Created as soon as it is found on the path ✅[^pep420] | Must live in one folder |
| Namespace package | Portions can come from several folders or distributions | Every path entry must be scanned first ✅[^pep420] |

## Takeaways
- Run modules that use relative imports with `python -m pkg.mod`, never by file path. [rule-candidate]
- Never give a local module the name of a standard library module; check `sys.stdlib_module_names`. [rule-candidate]
- Between modules that import each other, use `import mod` and `mod.name` inside functions, not top-level `from mod import name`.
- Give every folder meant as a regular package an `__init__.py`; leave it out only for a deliberate namespace package. [rule-candidate]
- Read `__spec__.cached` and `__spec__.parent`, not `__cached__` or `__package__`. [rule-candidate]
- Mark heavy imports that a run may never need `lazy` (3.15+), and test the first-use path, where their errors now surface.
- Treat `importlib.reload()` as an interactive convenience; restart the process to pick up changes reliably.

## Verification status
- Verified: 92 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [6. Modules](https://docs.python.org/3/tutorial/modules.html) — Python Software Foundation, living. Rank 1. Backs: module definition, run-once bodies, private namespace, `.pyc` caching, script folder first on `sys.path`, relative imports from a main module, `__all__` in packages. [^tut-modules]
- [5. The import system](https://docs.python.org/3/reference/import.html) — Python Software Foundation, living. Rank 1. Backs: search and bind, `sys.modules`, finders, loaders, specs, path entry finders, packages, relative-import dots, `__main__.__spec__`. [^import-system]
- [7. Simple statements: The import statement](https://docs.python.org/3/reference/simple_stmts.html) — Python Software Foundation, living. Rank 1. Backs: binding rules, public names and `__all__`, star import at module level, lazy imports and `__lazy_modules__`. [^simple-stmts]
- [3. Data model: Modules](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: `__file__` is optional, `__package__` status and `__spec__.parent`. [^datamodel]
- [importlib — The implementation of import](https://docs.python.org/3/library/importlib.html) — Python Software Foundation, living. Rank 1. Backs: `import_module()`, `reload()` and its caveats, `ModuleSpec` fields, `find_spec()`. [^importlib]
- [The initialization of the sys.path module search path](https://docs.python.org/3/library/sys_path_init.html) — Python Software Foundation, living. Rank 1. Backs: order of `sys.path` entries, the stdlib zip entry. [^sys-path-init]
- [sys — System-specific parameters and functions](https://docs.python.org/3/library/sys.html) — Python Software Foundation, living. Rank 1. Backs: symlinked script folder, lazy-import mode functions and their values, `sys._path0` status. [^sys]
- [`__main__` — Top-level code environment](https://docs.python.org/3/library/__main__.html) — Python Software Foundation, living. Rank 1. Backs: `__name__ == "__main__"`. [^main]
- [1. Command line and environment](https://docs.python.org/3/using/cmdline.html) — Python Software Foundation, living. Rank 1. Backs: `-m`, `-P`, `-I`, `-X lazy_imports`, `PYTHON_LAZY_IMPORTS`. [^cmdline]
- [Programming FAQ: How can I have modules that mutually import each other?](https://docs.python.org/3/faq/programming.html) — Python Software Foundation, living. Rank 1. Backs: why circular `from` imports fail and the fixes; cost of repeated imports. [^faq]
- [What's New In Python 3.13: Improved error messages](https://docs.python.org/3/whatsnew/3.13.html) — Python Software Foundation, 2024. Rank 1. Backs: the hint for a script named like a standard module. [^whatsnew313]
- [What's new in Python 3.15](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: `types.LazyImportType`, lazy-import motivation, hierarchical import locks and the 3.15.2 fix, `__cached__` removal, `__package__` deprecation. [^whatsnew315]
- [PEP 420 – Implicit Namespace Packages](https://peps.python.org/pep-0420/) — Eric V. Smith, 2012. Rank 1. Backs: the namespace-package scan, no `__file__`, regular-package speed. [^pep420]
- [PEP 810 – Explicit lazy imports](https://peps.python.org/pep-0810/) — Pablo Galindo Salgado, Germán Méndez Bravo, Thomas Wouters, Dino Viehland, Brittany Reynoso, Noah Kim, Tim Stumbaugh, 2025. Rank 1. Backs: soft keyword, `sys.lazy_modules`, `globals()` not reifying, import state at first use, chained errors, the `"none"` mode. [^pep810]

## Related
- `python/modules-and-packaging/virtual-environments-and-packaging.md` — where site-packages comes from and how installed distributions reach `sys.path`.
- `python/runtime/bytecode-and-the-interpreter.md` — what the cached `.pyc` holds and when it is rebuilt.
- `python/fundamentals/functions-scopes-and-closures.md` — module globals as the global scope of functions.
- `python/fundamentals/objects-names-and-types.md` — names, binding and identity, which `import` builds on.
- `python/python-lab-setup.md` — the lab and why probes run with `-I`.
