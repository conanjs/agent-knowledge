---
schema: topic-index/v1
kind: subtopic
topic: python/modules-and-packaging
last-updated: 2026-11-24
---

# Python modules and packaging

How code is split into modules and packages and found at run time (the import system, `sys.path`, `sys.modules`, specs, relative and circular imports, 3.15 lazy imports), and how third-party code is isolated and distributed (virtual environments, `pyproject.toml`, build backends, wheels, version specifiers, entry points, lock files). Measured in CPython 3.15.2: offline on the Mac, and with `pip install`, console scripts and editable installs in the official `python:3.15.2-slim` container. Not covered: individual installers and project managers beyond `pip` and `venv`.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [modules-packages-and-imports.md](modules-packages-and-imports.md) | concept | How `import` finds, runs once, caches and binds modules: `sys.path`, `sys.modules`, finders/loaders/specs, packages, relative and circular imports, reload, 3.15 lazy imports | verified |
| [virtual-environments-and-packaging.md](virtual-environments-and-packaging.md) | concept | How a `venv` redirects `sys.prefix` and site-packages, and how `pyproject.toml`, build backends, wheels, specifiers, entry points, editable installs, lock files and `.start` files fit together | verified |

## References
- [The Python Tutorial: Modules](https://docs.python.org/3/tutorial/modules.html) — Python Software Foundation, living. Backs: subtopic scope.
- [Python Packaging User Guide](https://packaging.python.org/en/latest/) — Python Packaging Authority, living. Backs: subtopic scope.

## Related
- `python/python-lab-setup.md` — `-I`, PEP 668 and the lab's `venv` limits.
- `python/learning-path.md` — the order to read the `python/` docs in.
