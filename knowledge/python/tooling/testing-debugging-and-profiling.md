---
schema: knowledge-doc/v1
type: reference
topic: python/tooling
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, unittest, mock, doctest, pdb, breakpoint, faulthandler, traceback, dev-mode, warnings, logging, timeit, profiling, cprofile, tracemalloc, sys-monitoring]
ranked-sources: true
---

# Testing, debugging and profiling tools in the standard library

## Summary
**TL;DR:** CPython ships the whole loop: `unittest` (with `unittest.mock`) and `doctest` to test; `breakpoint()`/`pdb`, `faulthandler` and `traceback` to debug; `-X dev` and `-W` to surface problems that are hidden by default; `logging` to record; and `timeit`, the 3.15 `profiling` package (`profiling.tracing`, formerly `cProfile`, plus the sampling profiler `profiling.sampling`), `tracemalloc` and `sys.monitoring` to measure. The tables give each tool's command-line form, main options and recent version changes, with outputs measured on CPython 3.15.2.
**Use this when:** you need the exact flag, command or default of one of these tools, want to know what `-X dev` turns on, which warning filter wins, what a log level's number is, or which profiler to run in 3.15.
**Not this doc:** how exceptions and tracebacks work → `python/errors-and-resources/exceptions-and-exception-groups.md`; where to catch and log errors → `error-handling/handle-errors-once.md`; garbage collection and memory layout → `python/runtime/memory-management-and-garbage-collection.md`; bytecode and the interpreter loop → `python/runtime/bytecode-and-the-interpreter.md`; installing third-party tools in a venv (virtual environment) → `python/modules-and-packaging/virtual-environments-and-packaging.md`; how the lab was set up → `python/python-lab-setup.md`.

## Scope
Standard-library tools and interpreter options of CPython 3.15.2, with the 3.12–3.15 changes that matter. Every command was run as `python3.15 -I …` on macOS 26.1 (arm64) without root, from a folder of small fixture scripts: `calc.py` (a `mean()` with two doctests, and a `price_in()` that calls a `fetch_rate()` the tests must not reach), `test_calc.py` (the `unittest` cases), `debug_me.py` (a `double()` that calls `breakpoint()`), `crash.py` (divides by zero), `warns.py` (two `DeprecationWarning`s, `spam …` and `eggs …`), `slow.py` (a recursive `fib`), plus short logging, `tracemalloc` and `sys.monitoring` scripts. Timings vary between runs. `pytest` is a third-party framework, listed in the `unittest` page's "See also" as one with a lighter syntax such as plain `assert` ✅[^unittest]; it is not covered here.

## Catalog

### unittest: structure
| Item | Form | What it does |
|---|---|---|
| Test case | `class T(unittest.TestCase)` with methods named `test…` | Methods whose names start with `test` are the tests ✅[^unittest] |
| Fixture | `setUp()`, `tearDown()` | A new `TestCase` instance is created for every test method, and `setUp()`/`tearDown()` run once per test ✅[^unittest]; `tearDown()` runs only if `setUp()` succeeded, whatever the test's result ✅[^unittest] |
| Cleanups | `self.addCleanup(fn, *args)`, `self.enterContext(cm)` | Run after `tearDown()` in LIFO (last in, first out) order, and still run when `setUp()` failed ✅[^unittest] |
| Subtests | `with self.subTest(values=v):` | Each failing iteration is reported with its parameters ✅[^unittest]; lab: `FAIL: test_subtests (test_calc.MeanTests.test_subtests) (values=[1, 2])`, `AssertionError: 1.5 != 2` ✅[^lab] |
| Skips | `@unittest.skip(reason)`, `@skipIf(cond, reason)`, `@expectedFailure` | Skipped tests do not run `setUp()` or `tearDown()` ✅[^unittest] |
| Script entry | `if __name__ == "__main__": unittest.main()` | Loads and runs the module's tests ✅[^unittest] |

### unittest: assert methods
| Method | Checks ✅[^unittest] | Since |
|---|---|---|
| `assertEqual(a, b)`, `assertNotEqual` | `a == b`; list, tuple, dict, set, frozenset and str get a type-specific diff | — |
| `assertTrue(x)`, `assertFalse(x)` | `bool(x) is True`, not `x is True` (use `assertIs(x, True)`) | — |
| `assertIs`, `assertIsNone`, `assertIn`, `assertIsInstance` (and `…Not…` forms) | identity, `is None`, `in`, `isinstance()` | 3.1 / 3.2 |
| `assertIsSubclass`, `assertNotIsSubclass` | `issubclass()` | 3.14 |
| `assertRaises(exc)`, `assertRaisesRegex(exc, r)` | the call or the `with` block raises `exc` | — / 3.1 |
| `assertWarns(w)`, `assertWarnsRegex(w, r)` | a warning of category `w` is triggered; since 3.15 non-matching warnings are no longer swallowed | 3.2 |
| `assertLogs(logger, level)`, `assertNoLogs` | the `with` block logs (or does not log) at `level` or above; `assertLogs` takes a `formatter` since 3.15 | 3.4 / 3.10 |
| `assertAlmostEqual(a, b, places=7, delta=None)` | `round(a - b, 7) == 0`: decimal places, not significant digits; lab: `0.1 + 0.2` against `0.3` passes ✅[^lab] | — |
| `assertCountEqual(a, b)` | same elements, any order | 3.2 |
| `assertStartsWith`, `assertEndsWith`, `assertHasAttr` (and `Not` forms) | `startswith()`, `endswith()`, `hasattr()`; lab: `assertStartsWith("profiling.tracing", "profiling")` passes ✅[^lab] | 3.14 |

### unittest: command line
| Command or option | Effect ✅[^unittest] |
|---|---|
| `python -m unittest` | Same as `python -m unittest discover` |
| `discover -s DIR -p PATTERN -t TOP` | Start directory (default `.`), file pattern (default `test*.py`), top-level directory (default: the start directory); test files must be importable modules |
| `python -m unittest test_mod.TestClass.test_method` or `tests/test_x.py` | Run the named tests; a path is turned into a module name and must still be importable |
| `-v`, `-f`, `-b`, `-c`, `--locals` | Verbose; stop at the first failure; buffer output (shown only for failures); Ctrl-C finishes the current test, then reports; show locals in tracebacks |
| `-k PATTERN` (3.7) | Run only tests whose fully qualified name matches: `fnmatch` style with `*`, else case-sensitive substring |
| `--durations N` (3.12) | Show the N slowest tests (0 for all) |
| Colors (3.14) | Output is colorized by default, controlled by environment variables |
| Lab | `python3.15 -I -m unittest discover -k price -v` → `test_price_patched (test_calc.MeanTests.test_price_patched) ... ok`, `Ran 1 test` ✅[^lab] |

### unittest.mock
| Item | What it does |
|---|---|
| `Mock(return_value=…, side_effect=…, spec=…)` | Records how it is called; `side_effect` may be a function, an exception class or instance (raised on call), or an iterable (one value per call) ✅[^mock] |
| `MagicMock` | A `Mock` subclass with default implementations of most magic methods ✅[^mock] |
| `m.assert_called_once_with(*args, **kwargs)` | Passes only if the mock was called exactly once, with these arguments ✅[^mock] |
| `patch("pkg.mod.Name", new=…)` | Decorator, class decorator or context manager; replaces the target with a `MagicMock` (an `AsyncMock` for an async function) and undoes it on exit; the target string is imported when the test runs, not at decoration ✅[^mock] |
| Where to patch | Patch the name where the code under test looks it up: `b.SomeClass` when `b` did `from a import SomeClass` ✅[^mock]; lab: `@mock.patch("calc.fetch_rate", return_value=1.1)` made `calc.price_in(10, "EUR")` return `11.0` and `assert_called_once_with("EUR")` pass ✅[^lab] |
| `autospec=True` | The mock copies the replaced object's spec; calls with a wrong signature raise `TypeError` ✅[^mock] |
| `patch.object(obj, "attr")`, `patch.dict(d, values)` | Patch one attribute; patch a dictionary and restore a copy of the original afterwards ✅[^mock] |

### doctest
| Form | Effect |
|---|---|
| `python -m doctest [-v] [-o OPTION] [-f] file …` | A `.py` file is imported and `testmod()` runs on it; any other name runs through `testfile()`; `-f` is short for `-o FAIL_FAST` ✅[^doctest] |
| Output | Nothing when every example passes; `-v` logs each example and a summary ✅[^doctest]; lab on `calc.py`: `2 tests in 4 items.`, `2 passed.`, `Test passed.` ✅[^lab] |
| Expected exception | An example may expect `Traceback (most recent call last):` followed by `...` and the exception line; lab: `ZeroDivisionError: division by zero` matched ✅[^lab] |

### Debugging
| Tool | Form | What it does |
|---|---|---|
| `breakpoint()` (3.7) | built-in call | Calls `sys.breakpointhook()`, which by default calls `pdb.set_trace()` ✅[^functions]; since 3.13 `set_trace()` stops immediately, not at the next line ✅[^pdb] |
| `PYTHONBREAKPOINT` | environment variable | `0`: `breakpoint()` returns at once; unset or empty: `pdb.set_trace`; a dotted name: that callable is imported and called; not consulted once code replaces `sys.breakpointhook` ✅[^sys]; lab: a replaced hook printed `custom hook` ✅[^lab] |
| `python -m pdb [-c cmd] (-m module \| -p pid \| pyfile) [args]` | command line | Stops before the first line; enters post-mortem debugging if the program exits abnormally; restarts the program afterwards ✅[^pdb]; lab on `crash.py`: `Uncaught exception. Entering post mortem debugging`, then `p a, b` → `(1, 0)` ✅[^lab] |
| `python -m pdb -p PID` (3.14) | attach | Debugs a running process given its PID (process ID) ✅[^pdb] through PEP 768 (Python Enhancement Proposal) and `sys.remote_exec()` ✅[^whatsnew314]; a process blocked in a system call is reached only at its next bytecode instruction or signal ✅[^pdb]; both interpreters must have the same major and minor version ✅[^sys] |
| Remote-attach switches | `PYTHON_DISABLE_REMOTE_DEBUG`, `-X disable-remote-debug` | The variable (set to a non-empty string) and the option disable both sending and receiving remote code ✅[^cmdline]; a `--without-remote-debug` build flag removes the feature ✅[^whatsnew314] |
| `faulthandler` | `-X faulthandler`, `PYTHONFAULTHANDLER`, `faulthandler.enable()` | Dumps the Python traceback on `SIGSEGV`, `SIGFPE`, `SIGABRT`, `SIGBUS`, `SIGILL`; ASCII only, 100 frames per thread, most recent call first ✅[^faulthandler]; 3.14 adds the C stack, 3.15 a `max_threads` cap ✅[^faulthandler]; lab: `ctypes.string_at(0)` → `Fatal Python error: Segmentation fault`, the Python frames, then `Current thread's C stack trace`; the process was killed by signal 11 (`SIGSEGV`) ✅[^lab] |
| `faulthandler.dump_traceback_later(timeout, repeat=False, exit=False)` | watchdog | Dumps every thread after `timeout` seconds (or every `timeout` with `repeat`), optionally followed by `_exit()` ✅[^faulthandler]; lab: `Timeout (0:00:00.200000)!` and exit status 1 ✅[^lab] |
| `traceback` | `print_exc()`, `format_exc()`, `print_stack()`, `TracebackException` | Print the exception being handled; the same as a string; print the current stack; capture an exception for later rendering ✅[^traceback]; lab: the last line of `format_exc()` is `ZeroDivisionError: division by zero` ✅[^lab] |

### pdb commands
| Command | Does ✅[^pdb] |
|---|---|
| `h(elp) [command]` | Help |
| `w(here)` | Stack trace, newest frame at the bottom; `>` marks the current frame |
| `u(p) [n]`, `d(own) [n]` | Move to an older or newer frame |
| `b(reak) [file:]line \| function [, condition]`, `tbreak`, `cl(ear)` | Set a (conditional) breakpoint, a one-shot one, or clear; `b` alone lists them with hit counts |
| `s(tep)`, `n(ext)` | Run the line, stopping inside a called function; run to the next line of this function |
| `unt(il) [line]`, `r(eturn)`, `c(ont(inue))` | Run to a later line; to the end of this function; to the next breakpoint |
| `j(ump) line` | Set the next line to run, bottom frame only; not into a `for` loop or out of a `finally` |
| `l(ist)`, `ll` | 11 lines around the current one; the whole function |
| `a(rgs)`, `p expr`, `pp expr`, `display expr` | Arguments; print; pretty-print; print when the value changes |
| `interact` | Python shell seeded with the current scope's names |
| `retval`, `exceptions [n]` | Last return value; list or switch between chained exceptions |
| `q(uit)` | Abort the program; 3.14 asks for confirmation in `'inline'` mode |

### Development mode and warnings
| Item | Effect |
|---|---|
| `-X dev` or `PYTHONDEVMODE=1` (3.7) | Adds the `default` warning filter, so `DeprecationWarning`, `ImportWarning`, `PendingDeprecationWarning` and `ResourceWarning` show; installs memory-allocator debug hooks; calls `faulthandler.enable()`; turns on asyncio debug mode; checks `encoding`/`errors` arguments; logs `io.IOBase` `close()` exceptions; sets `sys.flags.dev_mode` ✅[^devmode] |
| What `-X dev` does not do | Start `tracemalloc`, or stop `-O` from removing `assert`; it can only be enabled at startup ✅[^devmode] |
| Lab, `-X dev` | An unclosed file printed `ResourceWarning: unclosed file <_io.TextIOWrapper name='calc.py' mode='r' encoding='utf-8'>` (nothing without `-X dev`); `faulthandler.is_enabled()` and `sys.flags.dev_mode` were `True` ✅[^lab] |
| `-W action:message:category:module:lineno` | Empty fields match everything; trailing ones may be omitted; `PYTHONWARNINGS` takes the same filters, comma-separated ✅[^cmdline] |
| Actions | `default` once per location; `error` raise; `ignore` never; `always` (alias `all`) every time; `module` once per module; `once` once per process ✅[^warnings] |
| `message` field | Must match the start of the message, case-insensitively; a literal string unless written `/regex/` (3.15) ✅[^warnings]; lab: `-W 'ignore:/^(spam\|eggs)/'` hid both warnings, `-W 'ignore:^(spam\|eggs)'` (literal) hid neither ✅[^lab] |
| `module` field | Literal: the module name must be equal, case-sensitively; `/regex/` (3.15) matches its start ✅[^warnings] |
| Precedence | The last matching `-W` wins ✅[^cmdline]; lab: `-W default::DeprecationWarning -W ignore:spam` hid only `spam`; the reverse order hid nothing ✅[^lab] |
| Default filters (release build) | `default::DeprecationWarning:__main__`, `ignore::DeprecationWarning`, `ignore::PendingDeprecationWarning`, `ignore::ImportWarning`, `ignore::ResourceWarning` ✅[^warnings]; lab `warnings.filters` held exactly these five ✅[^lab] |
| `-W error::DeprecationWarning` | Lab: exit status 1 with a traceback ending `DeprecationWarning: spam is deprecated` ✅[^lab] |

### Logging basics
| Level | Number ✅[^logging] | When to use ✅[^logging] |
|---|---|---|
| `NOTSET` | 0 | On a logger: defer to ancestors |
| `DEBUG` | 10 | Detail for diagnosing a problem |
| `INFO` | 20 | Things work as expected |
| `WARNING` | 30 | Something unexpected, or a problem soon; still working |
| `ERROR` | 40 | A function could not be performed |
| `CRITICAL` | 50 | The program may be unable to continue |

| Item | Behaviour |
|---|---|
| `logging.basicConfig(level=…, format=…, filename=…, force=False)` | Adds a `StreamHandler` with a default formatter to the root logger; does nothing if the root already has handlers, unless `force=True`; `logging.info()` and friends call it when the root has no handlers ✅[^logging] |
| Defaults | Level `WARNING`; format `severity:logger name:message` ✅[^howto-logging]; lab: `INFO:shop.cart:item added` ✅[^lab] |
| `logging.getLogger(__name__)` | The same name always returns the same object; dotted names form a hierarchy that mirrors the package tree ✅[^logging]; lab: `same object: True parent: shop` ✅[^lab] |
| Effective level, propagation | A logger without a level uses its nearest ancestor's (root: `WARNING`); records go up to ancestors' handlers unless `propagate` is false ✅[^howto-logging]; lab: setting `shop` to `ERROR` gave `shop.cart` effective level `40` and hid its warning ✅[^lab] |
| `logging.lastResort` | With no configuration at all, a `WARNING`-level handler writes to `sys.stderr` ✅[^logging]; lab: a warning logged before `basicConfig()` still printed ✅[^lab] |
| In a library | Log to a named logger, never the root, and add no handler other than `NullHandler` ✅[^howto-logging] |

### Measuring
| Tool | Form | Notes |
|---|---|---|
| `timeit` | `python -m timeit [-n N] [-r N] [-u U] [-s S] [-p] [-t T] [-v] stmt` | `-r` default 5; `-s` setup default `pass`; `-p` process time via `time.process_time()`; `-u` `nsec`/`usec`/`msec`/`sec`; without `-n`, the loop count grows 1, 2, 5, 10, 20, 50 … until the run takes `--target-time` (default 0.2 s, option new in 3.15); colored output since 3.15 ✅[^timeit]; lab: `-s 'x = list(range(1000))' 'sum(x)'` → `100000 loops, best of 5: 3.06 usec per loop` ✅[^lab] |
| `profiling` (3.15, PEP 799) | package | Groups `profiling.tracing` (deterministic, relocated from `cProfile`) and `profiling.sampling` (the Tachyon sampling profiler) ✅[^whatsnew315]; profilers describe where time goes and are not for benchmarks: use `timeit` ✅[^profiling] |
| `profiling.tracing` | `python -m profiling.tracing [-o file] [-s sort] (-m module \| script.py)` | Records every call, return and exception, so counts are exact; `-o` writes a `pstats` file; `-s` sorts by `cumulative`, `time`, `calls`, `name` … ✅[^profiling-tracing]; lab: `25088 function calls (8 primitive calls)` and `25083/3 … slow.py:1(fib)` ✅[^lab], read as total/primitive calls, where primitive means not induced by recursion ✅[^profiling] |
| `cProfile` | `python -m cProfile …`, `import cProfile` | Alias of `profiling.tracing`, kept in all future versions ✅[^profiling-tracing]; lab: `cProfile.Profile is profiling.tracing.Profile` → `True` ✅[^lab]; it observes only the main thread ✅[^pep799] |
| `profile` | pure-Python tracer | Deprecated in 3.15, to be removed in 3.17; use `profiling.tracing` ✅[^profile]; lab with `-W default`: `DeprecationWarning: The profile module is deprecated and will be removed in Python 3.17.` ✅[^lab] |
| `profiling.sampling` | `python -m profiling.sampling run script.py`, `attach PID`, `dump PID`, `replay` | Samples stacks at `-r` (default 1 kHz), for `-d` seconds (default: to completion), main thread unless `-a`; `--mode wall\|cpu\|gil\|exception`; output `--pstats`, `--collapsed`, `--flamegraph`, `--gecko`, `--heatmap` ✅[^profiling-sampling]; reading the target's memory needs elevated rights on most systems (on macOS: root, the `com.apple.security.cs.debugger` entitlement, or SIP, System Integrity Protection, disabled), and both sides must run the same minor version ✅[^profiling-sampling]; lab, `run` without root: `Permission Error: Unable to access process memory on macOS` ✅[^lab] |
| `tracemalloc` | `-X tracemalloc[=N]`, `PYTHONTRACEMALLOC`, `tracemalloc.start(nframe=1)` | Traces Python allocations: `take_snapshot()`, `Snapshot.compare_to(old, "lineno")`, `get_traced_memory()` → `(current, peak)`; one frame per trace by default ✅[^tracemalloc]; lab: a 100,000-string list showed `count_diff: 100001` on its line, and `-X tracemalloc=5` gave `is_tracing()` `True`, limit `5` ✅[^lab] |
| `sys.monitoring` (3.12, PEP 669) | `sys.monitoring.use_tool_id()`, `register_callback()`, `set_events()` | Event callbacks for tools; IDs 0–5, with `DEBUGGER_ID` 0, `COVERAGE_ID` 1, `PROFILER_ID` 2, `OPTIMIZER_ID` 5; a callback for a local event may return `DISABLE` to switch that event off at that code location ✅[^monitoring]; designed to monitor at low cost ✅[^pep669]; lab: a `PY_START` counter saw `fib(10)` start `177` times ✅[^lab] |
| `-X importtime` | `python -X importtime -c 'import json'` | Prints each import's self and cumulative time in microseconds ✅[^cmdline]; lab header: `import time: self [us] \| cumulative \| imported package` ✅[^lab] |

## Lookup notes
- **`-I` ignores every `PYTHON*` variable** ✅[^cmdline]. In the lab, `PYTHONBREAKPOINT=0 python3.15 -I debug_me.py` still stopped at `breakpoint()` ✅[^lab]. Under `-I`, use the option forms: `-X dev`, `-X faulthandler`, `-X tracemalloc`, `-W`.
- **`python -m unittest test_calc.py` fails under `-I`** with `ModuleNotFoundError: No module named 'test_calc'`, while `python -m unittest discover` found the same tests ✅[^lab]. With `-I` or `-P`, `sys._path0` (the current directory for `python -m`) is not added to `sys.path` ✅[^sys].
- **The `profiling` overview's quick start shows `-i 50`**, but 3.15.2 rejects it: `error: unrecognized arguments: -i` ✅[^lab]. The `profiling.sampling` page documents `-r`/`--sampling-rate` instead ✅[^profiling-sampling].
- **`PYTHON_DISABLE_REMOTE_DEBUG` set to an empty string:** PEP 768 says any value, even empty, disables attaching, but the PEP marks itself a historical document ✅[^pep768]; the current command-line docs require a non-empty string ✅[^cmdline], and they govern.
- **pdb from a pipe:** `printf 'b double\nc\np x\nn\np y\nc\nc\nq\n' | python3.15 -I -m pdb debug_me.py` printed `Breakpoint 1 at debug_me.py:2`, `21`, `42`, then `The program finished and will be restarted` ✅[^lab].
- **`timeit` results depend on the machine**; repeat the timing and take the best, and the default of 5 repeats is usually enough ✅[^timeit]. The same `sum(x)` statement took 3.06 µs per loop in the saved lab run and 2.46 µs in two later runs ✅[^lab].
- **`import sys.monitoring` fails**: it is a namespace inside `sys` ✅[^monitoring]; lab: `ModuleNotFoundError: No module named 'sys.monitoring'; 'sys' is not a package` ✅[^lab].

## Takeaways
- Run test suites and CI (continuous integration) jobs with `-X dev` and `-W error::DeprecationWarning` so hidden warnings and unclosed resources surface. [rule-candidate]
- Use `breakpoint()`, not `import pdb; pdb.set_trace()`, so `PYTHONBREAKPOINT=0` or another hook can switch it. [rule-candidate]
- Patch names where the code under test looks them up, and prefer `autospec=True`. [rule-candidate]
- Use `logging.getLogger(__name__)` in every module; configure handlers only in the application entry point. [rule-candidate]
- In 3.15, write `profiling.tracing` instead of `profile`; reach for `profiling.sampling` for low-overhead or production profiling, and for `timeit` to compare small snippets. [rule-candidate]
- Enable `faulthandler` (or `-X dev`) on services so a crash or hang leaves a traceback.

## Verification status
- Verified: 106 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [unittest — Unit testing framework](https://docs.python.org/3/library/unittest.html) — Python Software Foundation, living. Rank 1. Backs: `TestCase`, fixtures, cleanups, subtests, skips, the assert-method tables with their 3.14 and 3.15 changes, the command line and discovery; pytest listed as third-party. [^unittest]
- [unittest.mock — mock object library](https://docs.python.org/3/library/unittest.mock.html) — Python Software Foundation, living. Rank 1. Backs: `Mock`, `MagicMock`, `side_effect`, `assert_called_once_with`, `patch` and where to patch, `autospec`, `patch.object`, `patch.dict`. [^mock]
- [doctest — Test interactive Python examples](https://docs.python.org/3/library/doctest.html) — Python Software Foundation, living. Rank 1. Backs: the `python -m doctest` command line and its silence on success. [^doctest]
- [Built-in functions: breakpoint](https://docs.python.org/3/library/functions.html) — Python Software Foundation, living. Rank 1. Backs: `breakpoint()` calls `sys.breakpointhook()`. [^functions]
- [sys — System-specific parameters and functions](https://docs.python.org/3/library/sys.html) — Python Software Foundation, living. Rank 1. Backs: `sys.breakpointhook()` and `PYTHONBREAKPOINT`; `sys._path0` under `-P`/`-I`; `sys.remote_exec()` version rule. [^sys]
- [pdb — The Python Debugger](https://docs.python.org/3/library/pdb.html) — Python Software Foundation, living. Rank 1. Backs: the command line, post-mortem and restart, `-p PID`, `set_trace()` in 3.13, the debugger commands. [^pdb]
- [faulthandler — Dump the Python traceback](https://docs.python.org/3/library/faulthandler.html) — Python Software Foundation, living. Rank 1. Backs: signals handled, dump limits, C stack (3.14), `max_threads` (3.15), `dump_traceback_later()`. [^faulthandler]
- [traceback — Print or retrieve a stack traceback](https://docs.python.org/3/library/traceback.html) — Python Software Foundation, living. Rank 1. Backs: `print_exc`, `format_exc`, `print_stack`, `TracebackException`. [^traceback]
- [Python Development Mode](https://docs.python.org/3/library/devmode.html) — Python Software Foundation, living. Rank 1. Backs: every effect of `-X dev` and what it leaves out. [^devmode]
- [Command line and environment](https://docs.python.org/3/using/cmdline.html) — Python Software Foundation, living. Rank 1. Backs: `-W` syntax and precedence, `PYTHONWARNINGS`, `-I` ignoring `PYTHON*` variables, `-X disable-remote-debug`, `PYTHON_DISABLE_REMOTE_DEBUG`, `-X importtime`. [^cmdline]
- [warnings — Warning control](https://docs.python.org/3/library/warnings.html) — Python Software Foundation, living. Rank 1. Backs: filter actions, `message` and `module` fields with the 3.15 regex form, default filters. [^warnings]
- [logging — Logging facility for Python](https://docs.python.org/3/library/logging.html) — Python Software Foundation, living. Rank 1. Backs: level numbers and meanings, `basicConfig()`, `getLogger()` and the hierarchy, `lastResort`. [^logging]
- [Logging HOWTO](https://docs.python.org/3/howto/logging.html) — Python Software Foundation, living. Rank 1. Backs: default level and format, effective level, propagation, advice for libraries. [^howto-logging]
- [timeit — Measure execution time of small code snippets](https://docs.python.org/3/library/timeit.html) — Python Software Foundation, living. Rank 1. Backs: command-line options and defaults, `--target-time`, repeat advice. [^timeit]
- [profiling — Python profilers](https://docs.python.org/3/library/profiling.html) — Python Software Foundation, living. Rank 1. Backs: profilers are not benchmarking tools; total/primitive call counts. [^profiling]
- [profiling.tracing — Deterministic profiler](https://docs.python.org/3/library/profiling.tracing.html) — Python Software Foundation, living. Rank 1. Backs: the command line, exact counts, the `cProfile` alias. [^profiling-tracing]
- [profiling.sampling — Statistical profiler](https://docs.python.org/3/library/profiling.sampling.html) — Python Software Foundation, living. Rank 1. Backs: subcommands, defaults, modes, output formats, platform permissions, version compatibility. [^profiling-sampling]
- [profile — Pure Python profiler](https://docs.python.org/3/library/profile.html) — Python Software Foundation, living. Rank 1. Backs: deprecation in 3.15 and removal in 3.17. [^profile]
- [tracemalloc — Trace memory allocations](https://docs.python.org/3/library/tracemalloc.html) — Python Software Foundation, living. Rank 1. Backs: start-up options, snapshots, `get_traced_memory()`. [^tracemalloc]
- [sys.monitoring — Execution event monitoring](https://docs.python.org/3/library/sys.monitoring.html) — Python Software Foundation, living. Rank 1. Backs: tool IDs, the registration calls, `DISABLE`, the namespace note. [^monitoring]
- [What's new in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, living. Rank 1. Backs: `pdb -p` built on PEP 768 and `sys.remote_exec()`; the `--without-remote-debug` build flag. [^whatsnew314]
- [What's new in Python 3.15](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, living. Rank 1. Backs: the `profiling` package (PEP 799). [^whatsnew315]
- [PEP 669 – Low Impact Monitoring for CPython](https://peps.python.org/pep-0669/) — Mark Shannon, 2021. Rank 1. Backs: the goal of low-cost monitoring. [^pep669]
- [PEP 768 – Safe external debugger interface for CPython](https://peps.python.org/pep-0768/) — Pablo Galindo Salgado, Matt Wozniski, Ivona Stojanovic, 2024. Rank 1. Backs: the historical wording on `PYTHON_DISABLE_REMOTE_DEBUG`. [^pep768]
- [PEP 799 – A dedicated profiling package for organizing Python profiling tools](https://peps.python.org/pep-0799/) — Pablo Galindo Salgado, László Kiss Kollár, 2025. Rank 1. Backs: `cProfile` observes only the main thread. [^pep799]

## Related
- `python/python-lab-setup.md` — the interpreter and `-I` mode every command above ran with.
- `python/errors-and-resources/exceptions-and-exception-groups.md` — what a traceback contains and how exceptions chain.
- `error-handling/handle-errors-once.md` — where to log an error and where to let it propagate.
- `testing/characterization-tests.md` — pinning existing behaviour before a refactor.
- `python/runtime/memory-management-and-garbage-collection.md` — what `tracemalloc` numbers mean.
- `python/concurrency/asyncio-coroutines-and-tasks.md` — asyncio debug mode, which `-X dev` turns on.
