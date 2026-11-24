---
schema: knowledge-doc/v1
type: concept
topic: python/modules-and-packaging
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15", "pip 26.2"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, venv, virtual-environment, pip, pyproject-toml, wheel, sdist, pep-517, pep-621, pep-440, pep-508, pep-660, pep-751, pep-829, entry-points, importlib-metadata, pth-files]
ranked-sources: true
---

# Virtual environments and Python packaging

## Summary
**TL;DR:** A virtual environment is a folder holding a `pyvenv.cfg` file and links to a base interpreter. Running its `bin/python` (activation is optional) points `sys.prefix` at that folder, so only its own `site-packages` is searched and `pip` installs there. A project describes itself in `pyproject.toml`: `[build-system]` names a build backend that a frontend such as `pip` calls to produce a wheel, a zip that installing unpacks into site-packages; `[project]` holds the name, the version, the dependencies (dependency specifiers carrying version specifiers such as `~=2.2`) and the console scripts. The name you install and the name you import can differ, and `importlib.metadata` maps one to the other.
**Use this when:** `pip install` succeeded but `import` fails, you wonder whether to activate a venv, you write a `pyproject.toml` or a version constraint, an installed command is missing, you need an editable install or a lock file, or a `.pth` file runs code at startup.
**Not this doc:** how `import` searches `sys.path` → `python/modules-and-packaging/modules-packages-and-imports.md`; why `pip install` into the lab's Homebrew interpreter is refused ("externally managed", Python Enhancement Proposal (PEP) 668) → `python/python-lab-setup.md`; testing tools → `python/tooling/testing-debugging-and-profiling.md`.

## Problem
- `pip install x` reports success, yet `import x` fails, because `pip` and `python` belong to two different interpreters.
- After `python -m venv .venv`, it is unclear whether `source .venv/bin/activate` is required, or what it changes.
- A user runs `pip install pillow` but writes `import PIL`: the installed name and the imported name are not the same thing.
- A dependency written as `requests>=2` silently accepts a future `3.0` with breaking changes.
- A command such as `greet` exists after one install method and not after another.
- Code runs at every interpreter start because some `.pth` file holds an `import` line.

## Mental model
**Analogy:** a virtual environment is an annex to a workshop. It uses the main building's machines (the base interpreter and its standard library) but has its own parts shelf (`site-packages`). Entering through the annex door (running `.venv/bin/python`) means every part fetched or stored goes to the annex shelf; "activating" only puts the annex door first in your hallway (`PATH`). A wheel is a flat-pack box with an inventory sheet (its `.dist-info` folder): the build backend is the factory that packs it from source, and `pip` is the courier that orders the factory's work and unpacks boxes onto the shelf.

**Artifact** (measured in the lab ✅[^lab]; `<V>` is the venv folder, `<base>` the Homebrew 3.15.2 framework):
```console
$ python3.15 -I -m venv --without-pip <V> && cat <V>/pyvenv.cfg
home = /opt/homebrew/opt/python@3.15/bin
include-system-site-packages = false
version = 3.15.2
executable = <base>/bin/python3.15
command = /opt/homebrew/opt/python@3.15/bin/python3.15 -m venv --without-pip <V>
$ <V>/bin/python -I -c 'import sys, os; print(sys.prefix, sys.base_prefix, os.environ.get("VIRTUAL_ENV"))'
<V> <base> None                                  # in a venv, without activation
$ python3.15 -I -c 'import sys; print(sys.prefix == sys.base_prefix)'
True                                             # the base interpreter
```

## How it works
Five actors take part, from creating an environment to running an installed command:
- **The venv folder** — its job: mark an environment and hold its packages, via `pyvenv.cfg` and `lib/python3.X/site-packages`.
- **Interpreter startup** — its job: point `sys.prefix` at the venv and add its site-packages, via path initialization and the `site` module.
- **The build frontend** (`pip`, `build` ✅[^glossary]) — its job: turn a source tree into a wheel, via the PEP 517 hooks.
- **The build backend** (setuptools, hatchling, flit-core, … ✅[^glossary]) — its job: produce the wheel, via `build_wheel()`.
- **The installer** (`pip`) — its job: unpack the wheel and create command wrappers, via the wheel's `.dist-info` files.

```
source tree ──pyproject.toml──▶ frontend (pip) ──calls build_wheel()──▶ backend
                                                         │
                                       demo_greet-1.2.0-py3-none-any.whl (a zip)
                                                         │
<V>/bin/python ─▶ sys.prefix = <V> ─▶ installer unpacks into <V>/lib/python3.15/site-packages
                                       └─ entry_points.txt ─▶ wrapper script <V>/bin/greet
```

### Virtual environments
1. **Creation.** `python -m venv DIR` writes `DIR/pyvenv.cfg` with a `home` key naming the base installation, a `bin` folder with a copy or symlink of the interpreter, and `lib/pythonX.Y/site-packages` ✅[^venv]. Since 3.13 it also writes a `.gitignore`, and unless `--without-pip` is given it runs `ensurepip` to bootstrap `pip` ✅[^venv]; since 3.12 setuptools is no longer a core venv dependency ✅[^venv]. In the lab, `bin/python` is a symlink to `python3.15`, which links to the Homebrew interpreter, and `.gitignore` holds `*` ✅[^lab].
2. **Detection at startup.** When `PYTHONHOME` is not set and `pyvenv.cfg` sits next to the running executable or one folder up, `sys.prefix` and `sys.exec_prefix` become that folder, while `sys.base_prefix` keeps pointing at the base installation ✅[^sys-path-init]. `sys.prefix != sys.base_prefix` is enough to tell that a venv is in use ✅[^venv]. Since 3.14 this happens during path initialization, not in `site`, so it holds even with `-S` ✅[^sys]; in the lab, `<V>/bin/python -I -S` still reported `prefix <V>` but listed no site-packages folder ✅[^lab].
3. **Site-packages.** With `include-system-site-packages = false`, `site` searches neither the base installation's site-packages nor the user's ✅[^site]. The lab venv's `sys.path` held only `<V>/lib/python3.15/site-packages`, where the base interpreter had `/opt/homebrew/lib/python3.15/site-packages` ✅[^lab].
4. **Activation is optional.** The `activate` script prepends the venv's `bin` folder to `PATH` and sets `VIRTUAL_ENV`; running the venv's interpreter by its full path works without it, and installed scripts carry a shebang line naming that interpreter, so they run without it too; hence `VIRTUAL_ENV` cannot tell whether a venv is in use ✅[^venv]. Activation does not change `PYTHONPATH` ✅[^tut-venv].
5. **Where `pip` installs.** Run from inside a venv, installers such as `pip` install into it without being told ✅[^venv]: the lab's `<V>/bin/python -m pip --version` printed `pip 26.2.2 from <V>/lib/python3.15/site-packages/pip (python 3.15)` ✅[^lab]. `python -m pip freeze > requirements.txt` records what is installed so another environment can be rebuilt with `pip install -r` ✅[^tut-venv].
6. **Disposable, not movable.** Shebang lines hold absolute paths, so a venv should be deleted and recreated rather than moved or copied ✅[^venv].

### Distributions, sdists and wheels
7. **Two meanings of "package".** A distribution package is the versioned archive you download and install; an import package is a module that contains other modules ✅[^glossary]. One distribution can hold several import packages, and a namespace import package can come from several distributions; `importlib.metadata.packages_distributions()` maps top-level import names to distribution names ✅[^metadata]. A project may declare its import names in `pyproject.toml`, for example `name = "pillow"` with `import-names = ["PIL"]` ✅[^pyproject].
8. **sdist and wheel.** A source distribution (sdist) still needs a build step; a built distribution such as a wheel only needs its files moved into place ✅[^glossary]. An sdist is `{name}-{version}.tar.gz` holding the sources, `pyproject.toml` and a `PKG-INFO` metadata file ✅[^sdist]. A wheel is a ZIP archive named `{distribution}-{version}(-{build tag})?-{python tag}-{abi tag}-{platform tag}.whl` (ABI = application binary interface); installing it means unpacking it into site-packages, then moving any `.data` subfolders to their final paths, and a wheel may even be installed by simply unzipping it into site-packages ✅[^wheel].

### `pyproject.toml` and the build
9. **The file.** `pyproject.toml` is TOML (Tom's Obvious Minimal Language) with four specified tables: `[build-system]`, `[project]`, `[dependency-groups]` and `[tool]` ✅[^pyproject]. The file began with PEP 518, which lets a project state what it needs installed to build ✅[^pep518]; `[project]` came from PEP 621 ✅[^pyproject].
10. **`[build-system]`.** Its `requires` key is a list of dependency specifiers that must be installed before building ✅[^pyproject]. PEP 517 adds `build-backend`, a `module:object` string naming the backend, and `backend-path` for a backend kept inside the source tree ✅[^pep517]. Common pairs are `requires = ["hatchling >= 1.26"]` with `build-backend = "hatchling.build"`, and `["setuptools >= 77.0.3"]` with `"setuptools.build_meta"` ✅[^writing-pyproject].
11. **Frontend and backend.** A build frontend (such as `pip` or `build`) takes a source tree or sdist and delegates the build to the backend through a standard interface ✅[^glossary]. The backend must provide `build_wheel()` and `build_sdist()`, each returning the base name of the file it wrote, and may provide `get_requires_for_build_wheel()` and `prepare_metadata_for_build_wheel()` ✅[^pep517]. A frontend should build in an isolated environment containing only the standard library and the declared build requirements, and should call each hook in a fresh subprocess ✅[^pep517].
12. **`[project]` metadata.** `name` must be given statically; `version` is required but may be listed in `dynamic` for the backend to compute ✅[^pyproject]. `requires-python` becomes the `Requires-Python` metadata field, `dependencies` becomes `Requires-Dist` entries, `optional-dependencies` defines extras, and `[project.scripts]` becomes the `console_scripts` entry-point group ✅[^pyproject]. Tool settings go in `[tool.<name>]` ✅[^pyproject].
13. **Dependency specifiers (PEP 508).** One string holds a distribution name, optional extras in brackets, an optional version specifier and an optional environment marker after `;`, as in `requests [security,tests] >= 2.8.1, == 2.8.* ; python_version < "3.7"`; when the marker is false, the dependency is ignored ✅[^dep-spec].
14. **Version specifiers (PEP 440).** Clauses are joined by commas, which mean "and" ✅[^version-spec]. The operators ✅[^version-spec]:
    - `~=V.N` (compatible release) is about `>= V.N, == V.*`: `~=2.2` allows any later 2.x, `~=1.4.5` any later 1.4.x; a single-part `~=1` is not allowed.
    - `==` is strict equality after zero padding, so `== 3.1` matches `3.1.0` but not `3.1.1`; a trailing `.*` turns it into a prefix match (`== 3.1.*`).
    - `!=` excludes, with the same rules as `==`, prefix form included.
    - `<`, `<=`, `>`, `>=` follow version order, but `>V` never admits a post-release of `V` (unless `V` is one), and `<V` never a pre-release of `V` (unless `V` is one).
    - Pre-releases are left out unless already installed, explicitly requested, or the only versions that match.
    - Exact `==` pins in a published distribution's dependencies are strongly discouraged; they suit repeatable application deployments.
15. **Entry points and console scripts.** An entry point has a group, a name and an object reference `module:attr`, and lives in `entry_points.txt` (INI format) inside the `.dist-info` folder ✅[^entry-points]. For the `console_scripts` group, an installer creates a command named after the entry point that calls the function with no arguments and passes its return value to `sys.exit()`; returning `None` means exit code 0 ✅[^entry-points].
16. **Editable installs (PEP 660).** An editable install keeps the code in the source tree, so source edits take effect without reinstalling; adding entry points or dependencies still needs a new install ✅[^pep660]. The backend's optional `build_editable()` hook builds a throwaway wheel that is never distributed, and the simplest such wheel holds a `.pth` file naming the source folder ✅[^pep660].
17. **Lock files (PEP 751).** A lock file named `pylock.toml`, or `pylock.<name>.toml`, records exactly what to install so that installers need no dependency resolution at install time ✅[^pep751] ✅[^pylock]. It is TOML with a `lock-version` key and a `[[packages]]` array; each wheel or archive entry must carry at least one hash ✅[^pylock].
18. **Reading metadata at runtime.** `importlib.metadata` reads installed distributions' `dist-info` folders: `version(name)` returns the version and raises `PackageNotFoundError`, a subclass of `ModuleNotFoundError`, when the distribution is missing ✅[^metadata]. Since 3.15, a metadata folder with no metadata file raises `MetadataNotFound` instead of returning empty metadata ✅[^whatsnew315].
19. **Startup configuration files (3.15, PEP 829).** At startup, `site` reads `name.pth` and `name.start` files in each site-packages folder, in alphabetical order ✅[^site].
    - A `.pth` line names a folder to append to `sys.path`; folders that do not exist are never added ✅[^site].
    - A `.pth` line starting with `import` is executed. In 3.15 that is deprecated but still runs, unless a `.start` file with the same base name exists ✅[^site].
    - A `.start` line names an entry point `pkg.mod:callable`, called with no arguments; all `.start` files run after every `.pth` path line has been applied ✅[^site].
    - PEP 829 plans to silently ignore `.pth` `import` lines in 3.18 and 3.19, and to warn about them from 3.20 ✅[^pep829].
    - `-S` disables both kinds of file ✅[^pep829].

## Worked example
A project `demo-greet` whose import package is `greet`, built offline by `pip wheel` with a 47-line in-tree backend, `_build/tiny_backend.py`, that writes the wheel with `zipfile` ✅[^lab]:

```toml
[build-system]
requires = []
build-backend = "tiny_backend"
backend-path = ["_build"]

[project]
name = "demo-greet"
version = "1.2.0"
requires-python = ">=3.15"
dependencies = []

[project.scripts]
greet = "greet.cli:main"
```

| Step | Command or call | Lab output ✅[^lab] | Rule |
|---|---|---|---|
| 1 | `<V>/bin/python -m pip wheel --no-index --no-deps -v -w dist ./demo_greet_project` | `Getting requirements to build wheel` → backend prints `get_requires_for_build_wheel called`; `Preparing metadata (pyproject.toml)` → `build_wheel called`; `Building wheel for demo-greet (pyproject.toml)` prints no backend line; `Created wheel for demo-greet: filename=demo_greet-1.2.0-py3-none-any.whl size=1566` | pip is the frontend, `tiny_backend` the backend (How it works 11); a backend without `prepare_metadata_for_build_wheel()` gets `build_wheel` called when the frontend needs metadata ✅[^pep517] |
| 2 | list the wheel | `demo_greet-1.2.0.dist-info/{METADATA,RECORD,WHEEL,entry_points.txt}`, `greet/__init__.py`, `greet/cli.py` | a `.dist-info` folder for the distribution, plus the import package `greet` |
| 3 | unzip it into `<V>/lib/python3.15/site-packages` | `pip list` shows `demo-greet 1.2.0`; no `<V>/bin/greet` | unzipping installs the files ✅[^wheel]; writing command wrappers is the installer's job ✅[^entry-points] |
| 4 | `importlib.metadata.version("demo-greet")`, `packages_distributions()["greet"]`, `version("greet")` | `1.2.0`, `['demo-greet']`, `PackageNotFoundError: No package metadata was found for greet` | metadata is keyed by the distribution name (How it works 7) |
| 5 | `entry_points(group="console_scripts", name="greet")`, then `ep.load()()` | `greet = greet.cli:main`, prints `hello from greet`, returns `0` | what the `greet` wrapper would run |
| 6 | call `build_editable()` as a frontend would, unzip that wheel | `demo_greet_editable.pth` containing `<P>/demo_greet_project`; after editing `greet/__init__.py`, the entry point prints `edited in the source tree` with no reinstall | How it works 16 |
| 7 | `<V>/bin/python -m pip lock --no-index -o pylock.toml ./demo_greet_project` | `WARNING: pip lock is currently an experimental command…`, then `lock-version = "1.0"`, `created-by = "pip"`, `packages = [{ name = "demo-greet", directory = { path = "demo_greet_project" } }]` | How it works 17 |

Step 3 unzips by hand because `pip install` of the wheel failed in the Mac lab (next table, first row). In the container lab (`python:3.15.2-slim`, Debian 13, whose `pyexpat` loads; see `python/python-lab-setup.md`), the installer's own steps ran on the same project ✅[^lab]:

| Step | Command | Container output ✅[^lab] | Rule |
|---|---|---|---|
| 8 | `python -m venv /v` | exit 0; `/v/bin` holds `pip`, `pip3`, `pip3.15` and the `activate` scripts | `ensurepip` bootstraps pip unless `--without-pip` is given ✅[^venv] |
| 9 | `/v/bin/python -m pip install --no-index /work` | `Preparing metadata (pyproject.toml)`, `Building wheel for demo-greet (pyproject.toml)`, `Successfully installed demo-greet-1.2.0` | pip is the frontend: it has the backend build a wheel, then installs it |
| 10 | `head -1 /v/bin/greet`, then `greet` | `#!/v/bin/python`; the wrapper runs `from greet.cli import main` and `sys.exit(main())`; prints `hello from greet`, exit 0 | the console-script command calls the function and passes its return value to `sys.exit()` ✅[^entry-points] |
| 11 | read the installed `.dist-info` | `entry_points.txt` holds `[console_scripts]` and `greet = greet.cli:main`; `RECORD` lists `bin/greet`; `INSTALLER` reads `pip` | the wrapper is installed from the wheel's entry points (step 2) |
| 12 | `pip uninstall -y demo-greet` | `Successfully uninstalled demo-greet-1.2.0`; `/v/bin/greet` is gone | — |
| 13 | `pip install --no-index -e /work`, then edit `greet/__init__.py` | `Preparing editable metadata (pyproject.toml)`, `Building editable for demo-greet (pyproject.toml)`; site-packages gets `demo_greet_editable.pth` containing `/work`; `greet` printed `hello from greet`, then `edited in the source tree` with no reinstall | How it works 16 |
| 14 | `pip install six==1.17.0` | `Downloading six-1.17.0-py2.py3-none-any.whl (11 kB)`, `Successfully installed six-1.17.0`, imported from `/v/lib/python3.15/site-packages/six.py` | `pip` installs from the Python Package Index by default ✅[^tut-venv] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `python3.15 -m venv` in the reference lab | `Error: Command ['<B>/bin/python3.15', '-m', 'ensurepip', '--upgrade', '--default-pip'] returned non-zero exit status 1`; `bin/` has only the `python` links, no `pip` and no `activate` ✅[^lab] | The lab's `pyexpat` failure, described in `python/python-lab-setup.md` Troubleshooting, breaks `ensurepip`; with pip's wheel unpacked by hand, `pip install` of any wheel still fails with `ImportError: No module named 'pip._internal.operations.install.wheel'` ✅[^lab]. The probe uses `--without-pip`, unpacks pip's bundled wheel and repairs `mac_ver()` with a `.start` entry point |
| `pip install` with the container image's own interpreter, outside a venv | Goes ahead and fails only on the missing package (`ERROR: No matching distribution found for nothing-here`); the image has no `EXTERNALLY-MANAGED` file ✅[^lab] | Only an installation that ships that marker refuses installs outside a venv (`python/python-lab-setup.md`) |
| A venv `sitecustomize.py` in the lab | Ignored: `import sitecustomize` loads Homebrew's copy from the standard library folder ✅[^lab] | Standard library folders come before site-packages on `sys.path` ✅[^sys-path-init] |
| `pip install --no-index requests` | `ERROR: Could not find a version that satisfies the requirement requests (from versions: none)` ✅[^lab] | `pip` installs from the Python Package Index by default ✅[^tut-venv]; with the index switched off and no local file, nothing matches |
| `>=1.0` and pre-releases | Among `2.0a1` and `2.0`, only `2.0` is chosen; with only `2.0a1` available, it is accepted (pip's vendored `packaging` 26.2) ✅[^lab] | Pre-releases count only when nothing else matches ✅[^version-spec] |
| `>1.7` against `1.7.0.post1` and `1.7.1` | Rejects `1.7.0.post1`, accepts `1.7.1` ✅[^lab] | `>V` excludes post-releases of `V` ✅[^version-spec] |
| `~=1` | `InvalidSpecifier: Invalid specifier: '~=1'` ✅[^lab] | `~=` needs at least two release segments ✅[^version-spec] |
| `zz_demo.pth` with an `import` line plus `zz_demo.start` | Only the `.start` entry point runs; `zz_other.pth`, which has no `.start` twin, still runs its `import` line ✅[^lab] | A matching `.start` file disables that `.pth` file's `import` lines ✅[^site] |
| A `.pth` line naming a missing folder | Not added; 3.15.2 also prints `In <V>/…/zz_paths.pth: <P>/missing_dir does not exist; skipping sys.path append` without `-v` ✅[^lab] | Non-existing folders are never added ✅[^site] |
| Moving or copying a venv folder | Scripts keep pointing at the old interpreter path | Shebangs are absolute; recreate instead ✅[^venv] |
| `VIRTUAL_ENV` checked to detect a venv | `None` while `<V>/bin/python` runs unactivated ✅[^lab] | Set only by activation ✅[^venv] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Call `.venv/bin/python -m pip …` by path | No shell state; works in scripts and CI (continuous integration) | Longer commands |
| `source .venv/bin/activate` | Plain `python` and installed commands resolve to the venv ✅[^venv] | Per-shell state that is easy to forget |
| `~=2.2` or `>=2.2, <3` in a library | Accepts later 2.x releases, blocks 3.0 ✅[^version-spec] | Must be widened once the next major version is tested |
| Exact `==` pins | Repeatable application installs ✅[^version-spec] | In a library, blocks users from getting security fixes ✅[^version-spec]; use a lock file for applications instead ✅[^pylock] |
| Editable install | Source edits show up at once ✅[^pep660] | New entry points or dependencies still need a reinstall ✅[^pep660] |
| `--system-site-packages` | Reuses packages already in the base installation ✅[^venv] | Loses isolation from the base environment |

## Takeaways
- Make one venv per project and run its interpreter by path, `.venv/bin/python -m pip …`; activation is optional. [rule-candidate]
- Detect a venv with `sys.prefix != sys.base_prefix`, never with `VIRTUAL_ENV`. [rule-candidate]
- Treat a venv as disposable: never move or copy it; rebuild it from `requirements.txt` or a lock file.
- Give every `pyproject.toml` a `[build-system]` with both `requires` and `build-backend`, and put metadata in `[project]`. [rule-candidate]
- In a library's `dependencies`, use ranges such as `~=2.2` or `>=2.2, <3`; keep exact pins for applications, in a lock file. [rule-candidate]
- Look up versions with `importlib.metadata.version("<distribution name>")`, the name you install, not the name you import.
- Move startup code from `import` lines in `.pth` files to `.start` entry points (3.15+). [rule-candidate]

## Verification status
- Verified: 93 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24; steps 8–14 and the container row of Edge cases ran in its `python:3.15.2-slim` container. [^lab]
- [venv — Creation of virtual environments](https://docs.python.org/3/library/venv.html) — Python Software Foundation, living. Rank 1. Backs: what `venv` creates, `ensurepip`, `.gitignore`, `sys.prefix != sys.base_prefix`, activation, shebangs, `VIRTUAL_ENV`, disposable environments, `--system-site-packages`. [^venv]
- [12. Virtual Environments and Packages](https://docs.python.org/3/tutorial/venv.html) — Python Software Foundation, living. Rank 1. Backs: activation leaves `PYTHONPATH` alone; `pip freeze` and `requirements.txt`. [^tut-venv]
- [The initialization of the sys.path module search path](https://docs.python.org/3/library/sys_path_init.html) — Python Software Foundation, living. Rank 1. Backs: `pyvenv.cfg` detection, `sys.prefix` and `sys.base_prefix`, standard library before site-packages. [^sys-path-init]
- [sys — System-specific parameters and functions: sys.prefix](https://docs.python.org/3/library/sys.html) — Python Software Foundation, living. Rank 1. Backs: since 3.14 the venv prefix is set by path initialization, unaffected by `-S`. [^sys]
- [site — Site-specific configuration hook](https://docs.python.org/3/library/site.html) — Python Software Foundation, living. Rank 1. Backs: `include-system-site-packages`, `.pth` and `.start` processing rules in 3.15. [^site]
- [importlib.metadata – Accessing package metadata](https://docs.python.org/3/library/importlib.metadata.html) — Python Software Foundation, living. Rank 1. Backs: distribution vs. import names, `packages_distributions()`, `version()`, `PackageNotFoundError`. [^metadata]
- [What's new in Python 3.15: importlib.metadata](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: `MetadataNotFound`. [^whatsnew315]
- [Glossary](https://packaging.python.org/en/latest/glossary/) — Python Packaging Authority, living. Rank 1. Backs: distribution package, import package, sdist, built distribution, build frontend and backend. [^glossary]
- [pyproject.toml specification](https://packaging.python.org/en/latest/specifications/pyproject-toml/) — Python Packaging Authority, living. Rank 1. Backs: the four tables, `[build-system] requires`, `[project]` keys and their metadata fields, `import-names`, `[tool]`, history. [^pyproject]
- [Writing your pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/) — Python Packaging Authority, living. Rank 1. Backs: `requires` and `build-backend` values for common backends. [^writing-pyproject]
- [Dependency specifiers](https://packaging.python.org/en/latest/specifications/dependency-specifiers/) — Python Packaging Authority, living. Rank 1. Backs: name, extras, versions and markers in one string. [^dep-spec]
- [Version specifiers](https://packaging.python.org/en/latest/specifications/version-specifiers/) — Python Packaging Authority, living. Rank 1. Backs: operators, `~=` expansion, prefix matching, exclusive comparisons, pre-release handling, advice on `==`. [^version-spec]
- [Entry points specification](https://packaging.python.org/en/latest/specifications/entry-points/) — Python Packaging Authority, living. Rank 1. Backs: entry point data model, `entry_points.txt`, console-script wrappers. [^entry-points]
- [pylock.toml Specification](https://packaging.python.org/en/latest/specifications/pylock-toml/) — Python Packaging Authority, living. Rank 1. Backs: lock file names, format, required hashes. [^pylock]
- [Wheel distribution format](https://packaging.python.org/en/latest/specifications/binary-distribution-format/) — Python Packaging Authority, living. Rank 1. Backs: wheel file name, unpack and spread, install by unzipping. [^wheel]
- [Source distribution format](https://packaging.python.org/en/latest/specifications/source-distribution-format/) — Python Packaging Authority, living. Rank 1. Backs: sdist name and contents. [^sdist]
- [PEP 517 – A build-system independent format for source trees](https://peps.python.org/pep-0517/) — Nathaniel J. Smith, Thomas Kluyver, 2015. Rank 1. Backs: `build-backend`, `backend-path`, mandatory and optional hooks, isolated build environments. [^pep517]
- [PEP 518 – Specifying Minimum Build System Requirements for Python Projects](https://peps.python.org/pep-0518/) — Brett Cannon, Nathaniel J. Smith, Donald Stufft, 2016. Rank 1. Backs: `pyproject.toml` introduced to declare build dependencies. [^pep518]
- [PEP 660 – Editable installs for pyproject.toml based builds (wheel based)](https://peps.python.org/pep-0660/) — Daniel Holth, Stéphane Bidoul, 2021. Rank 1. Backs: editable mode, `build_editable()`, `.pth`-based editable wheels. [^pep660]
- [PEP 751 – A file format to record Python dependencies for installation reproducibility](https://peps.python.org/pep-0751/) — Brett Cannon, 2024. Rank 1. Backs: installing from a lock file without resolution. [^pep751]
- [PEP 829 – Package Startup Configuration Files](https://peps.python.org/pep-0829/) — Barry Warsaw, 2026. Rank 1. Backs: the deprecation timeline for `.pth` `import` lines; `-S` disables `.pth` and `.start` files. [^pep829]

## Related
- `python/modules-and-packaging/modules-packages-and-imports.md` — how `import` finds what an install put on `sys.path`.
- `python/python-lab-setup.md` — the lab, and why its interpreter refuses `pip install` outside a venv.
- `python/tooling/testing-debugging-and-profiling.md` — tools usually installed into a project's venv.
