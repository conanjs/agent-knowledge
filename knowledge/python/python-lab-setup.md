---
schema: knowledge-doc/v1
type: how-to
topic: python
status: verified
applies-to: ["CPython 3.15.2", "macOS 26.1 on arm64 with Homebrew (python@3.15, python-freethreading)", "python:3.15.2-slim Docker image (Debian 13, arm64)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, lab, cpython, homebrew, isolated-mode, venv, pep-668, free-threading, docker]
ranked-sources: true
---

# Set up the CPython 3.15 lab the Python docs were measured in

## Summary
**TL;DR:** Install CPython 3.15.2 with Homebrew, call it by its full name `python3.15` (a bare `python3` may be an older interpreter earlier on `PATH`), and run every experiment in isolated mode, `python3.15 -I file.py`, so environment variables, the user's site-packages and the script's folder cannot change the result; every output marked as measured in the lab in the `python/` docs came from this setup on 2026-11-24. Add `python3.15t`, the free-threaded build, for experiments without the GIL (global interpreter lock). On macOS 26.1 both bottles' `pyexpat` extension fails to load and breaks `ensurepip`, so anything that needs `pip` runs in the official `python:3.15.2-slim` container instead.
**Use this when:** you want to re-run an example from the `python/` docs, or check whether a behaviour changed in a newer CPython.
**Not this doc:** what each example shows → the concept doc that quotes it; what to learn first → `python/learning-path.md`.

## Goal & prerequisites
**End state:** `python3.15 -VV` and `python3.15t -VV` print their 3.15.2 banners, a script run with `-I` sees neither `PYTHON*` variables nor your user site-packages, and the container's `pip` can install packages.

**Needs:**
- macOS with Homebrew (the reference run: macOS 26.1, arm64) ✅[^run].
- Network access once, for the downloads: the `python@3.15` 3.15.2 bottle was 20.3 MB, plus the `openssl@4` and `lz4` dependencies when they are missing; the `python-freethreading` 3.15.2 bottle was 20.5 MB ✅[^run].
- For the container: Docker with a running engine (the reference run: Docker 29.8.2 on OrbStack) and a pull of `python:3.15.2-slim`, 148 MB once unpacked ✅[^run].

## Steps
1. **Install the interpreter.**
   ```console
   $ brew install python@3.15
   ```
2. **Call it by its versioned name.** Homebrew warns when `python3`, `pip3` and `pydoc3` are shadowed by commands earlier on `PATH`; on the reference machine `/usr/local/bin/python3` was 3.13.7 ✅[^run]. Always type `python3.15`.
3. **Run experiments in isolated mode.** `-I` implies `-E`, `-P` and `-s`: it ignores all `PYTHON*` environment variables, does not prepend the script's directory (or the current directory) to `sys.path`, and leaves out the user's site-packages directory ✅[^cmdline].
   ```console
   $ python3.15 -I probe.py
   $ python3.15 -I -c 'print(7 // -2)'
   ```
4. **Create virtual environments without pip.** A `venv` has its own independent set of packages and, by default, is isolated from the packages of the base installation ✅[^venv]. In the reference lab, the default `python3.15 -m venv .venv` failed at its `ensurepip` step because `pyexpat` would not load (see Troubleshooting) ✅[^run]; `--without-pip` skips that step ✅[^venv] and produced a working environment with its `activate` scripts ✅[^run]:
   ```console
   $ python3.15 -m venv --without-pip .venv
   $ .venv/bin/python -I -c 'import sys; print(sys.prefix != sys.base_prefix)'
   True
   ```
5. **Add the free-threaded build.** A free-threaded build runs Python code with the GIL disabled ✅[^free-threading]; Homebrew's `python-freethreading` formula installs it as `/opt/homebrew/bin/python3.15t`, next to `python3.15` ✅[^run]. To run it with the GIL on, set `PYTHON_GIL=1` or pass `-X gil=1` ✅[^free-threading]; `-I` ignores the variable ✅[^cmdline], so use `-X gil=1` in isolated runs.
   ```console
   $ brew install python-freethreading
   $ python3.15t -I probe.py
   ```
6. **Run anything that needs `pip` in the official container.** The `python:3.15.2-slim` image (Debian 13) has a working `pyexpat`, so `venv` bootstraps pip and `pip install` works there ✅[^run]. Mount the probe folder and run inside:
   ```console
   $ docker pull python:3.15.2-slim
   $ docker run --rm -v "$PWD:/work" -w /work python:3.15.2-slim python -m venv /v
   ```
   The reference pull resolved to the index digest `sha256:63bb298d2b7b88f176f51b5189f54ce6535c997682ea70885d2132f5d473a8a5` ✅[^run]; pin it with `python:3.15.2-slim@sha256:…` to repeat the exact image.

## Verify
| Check | Expected output (reference run) |
|---|---|
| `python3.15 -VV` | `Python 3.15.2 (main, Oct 25 2026, 16:57:51) [Clang 21.0.0 (clang-2100.3.34.2)]` ✅[^run] |
| `python3.15 -I -c 'import sys; print(sys.flags.utf8_mode, sys._is_gil_enabled())'` | `1 True`: UTF-8 mode is on by default in 3.15 ✅[^whatsnew] and this build has the GIL ✅[^run] |
| `python3.15 -I -c 'import sysconfig; print(sysconfig.get_config_var("Py_GIL_DISABLED"))'` | `0`: the Homebrew bottle is the default build, not the free-threaded one ✅[^run] |
| `python3.15t -VV` | `Python 3.15.2 free-threading build (main, Oct 25 2026, 16:57:51) [Clang 21.0.0 (clang-2100.3.34.2)]` ✅[^run]; the banner of a free-threaded build contains "free-threading build" ✅[^free-threading] |
| `python3.15t -I -c 'import sys, sysconfig; print(sys._is_gil_enabled(), sysconfig.get_config_var("Py_GIL_DISABLED"), sys.abiflags)'` | `False 1 t` ✅[^run] |
| `docker run --rm python:3.15.2-slim python -c 'import sys, pyexpat; print(sys.version.split()[0], pyexpat.EXPAT_VERSION)'` | `3.15.2 expat_2.9.0` ✅[^run] |

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `python3 --version` prints 3.13 or older | Another `python3` comes first on `PATH`; Homebrew prints a "shadowed" warning at install ✅[^run] | Type `python3.15`, or put `/opt/homebrew/bin` first |
| `pip install` fails with `error: externally-managed-environment` | The interpreter's stdlib folder holds an `EXTERNALLY-MANAGED` marker file, which tells installers that packages outside a virtual environment are managed by another tool ✅[^pep668]; Homebrew's 3.15 ships one ✅[^run], the container image does not ✅[^run] | Install into a virtual environment (Steps 4 and 6), not into the base interpreter |
| `import pyexpat` (or `plistlib`, `xml.parsers.expat`) fails with `Symbol not found: _XML_SetAllocTrackerActivationThreshold`; `platform.mac_ver()` returns an empty release, `('', ('', '', ''), '')` | The 3.15.2 bottles' `pyexpat` extension, in `python3.15` and in `python3.15t`, links against the system `/usr/lib/libexpat.1.dylib`, and the one in macOS 26.1 lacks that symbol ✅[^run] | No fix on the Mac was verified in this lab; run code that needs `pyexpat` in the container (Step 6) |
| `python3.15 -m venv .venv` prints `Error: Command [... '-m', 'ensurepip', '--upgrade', '--default-pip'] returned non-zero exit status 1.` | `ensurepip` needs the module that fails above ✅[^run] | `python3.15 -m venv --without-pip .venv` (Step 4) for the standard library; the container (Step 6) for `pip install` |
| `uv venv --python /opt/homebrew/bin/python3.15` stops with `Broken Python installation, platform.mac_ver() returned an empty value` | The same `pyexpat` failure seen through `platform.mac_ver()` ✅[^run] | Use `python3.15 -m venv --without-pip`, or the container |
| `PYTHON_GIL=0` or `-X gil=0` on `python3.15` stops with `Fatal Python error: config_read_gil: Disabling the GIL is not supported by this build` | Only free-threaded builds can turn the GIL off ✅[^cmdline] | Use `python3.15t` (Step 5) |
| An example behaves differently when run without `-I` | A `PYTHONPATH`, `PYTHONUTF8` or similar variable, or a file in the script's folder named like a stdlib module, changed the run ✅[^cmdline] | Re-run with `-I` |

## Rollback
```console
$ brew uninstall python-freethreading python@3.15
$ docker rmi python:3.15.2-slim
```
Delete and recreate any `.venv` made with them: a virtual environment is built on top of its "base" Python (its `pyvenv.cfg` has a `home` key pointing at that installation, and `bin/` holds a copy or symlink of its executable), and it is meant to be disposable, not moved or copied ✅[^venv].

## Takeaways
- Pin experiments to a named interpreter (`python3.15`, `python3.15t`), never a bare `python3`. [rule-candidate]
- Run probes with `-I` so the environment cannot change the result.
- Install third-party packages into a virtual environment, never into a package-manager-owned interpreter. [rule-candidate]
- Before trusting a new interpreter build, import a few extension modules (`pyexpat`, `ssl`, `sqlite3`): a bottle can link against a system library that is older than the one it was built for.
- When a host build is broken, measure in the project's official container image rather than patching the host.

## Verification status
- Verified: 33 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 on macOS 26.1 (arm64): Homebrew `python@3.15` and `python-freethreading` 3.15.2, and the `python:3.15.2-slim` image under Docker 29.8.2 (OrbStack); outputs as quoted in Steps, Verify and Troubleshooting, including the `pyexpat` failure (`otool -L` showed the extension linked to `/usr/lib/libexpat.1.dylib`). [^run]
- [Command line and environment](https://docs.python.org/3/using/cmdline.html) — Python Software Foundation, living. Rank 1. Backs: `-I` and what it implies; `PYTHON_GIL` and `-X gil`. [^cmdline]
- [venv — Creation of virtual environments](https://docs.python.org/3/library/venv.html) — Python Software Foundation, living. Rank 1. Backs: `python -m venv`, `--without-pip`, the base Python, `pyvenv.cfg`, disposable environments. [^venv]
- [Python support for free threading](https://docs.python.org/3/howto/free-threading-python.html) — Python Software Foundation, living. Rank 1. Backs: what a free-threaded build is, its banner, `PYTHON_GIL` and `-X gil`. [^free-threading]
- [What's new in Python 3.15](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: UTF-8 as the default encoding (PEP 686). [^whatsnew]
- [PEP 668 – Marking Python base environments as "externally managed"](https://peps.python.org/pep-0668/) — Geoffrey Thomas, Matthias Klose, Filipe Laíns, Donald Stufft, Tzu-ping Chung, Stefano Rivera, Elana Hashman, Pradyun Gedam, 2021. Rank 1. Backs: the `EXTERNALLY-MANAGED` marker and where it lives. [^pep668]

## Related
- `python/learning-path.md` — the order to read the `python/` docs in.
- `python/concurrency/threads-processes-and-the-gil.md` — the measurements made with `python3.15t`.
- `python/modules-and-packaging/virtual-environments-and-packaging.md` — how `venv`, `pip` and `pyproject.toml` fit together, with the container install steps.
- `linux/lab-setup.md` — the Linux container lab used by other topics.
