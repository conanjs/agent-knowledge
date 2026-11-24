---
schema: knowledge-doc/v1
type: concept
topic: python/errors-and-resources
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, with, context-manager, contextlib, exitstack, open, file-io, encoding, utf-8, pep-686, newline, buffering, pathlib, tempfile, resourcewarning]
ranked-sources: true
---

# Context managers, the `with` statement and file I/O

## Summary
**TL;DR:** `with EXPR as x:` calls the manager's `__enter__()`, binds its return value to `x`, runs the block, then always calls `__exit__(exc_type, exc, tb)`, with three `None`s on a normal exit; a true return value from `__exit__` swallows the exception. Several managers in one `with` behave like nested `with` statements, so they exit in reverse order. `contextlib` builds managers from generators (`@contextmanager`) and covers common needs (`suppress`, `ExitStack`, `closing`, `nullcontext`, `chdir`). For file I/O (input/output), `open()` gives a text file (reads `str`, decodes with UTF-8 by default since 3.15, translates line endings) or a binary file (reads raw `bytes`); writes are buffered, so a file must be closed, best by `with`, before its data is safely on disk.
**Use this when:** writing or reviewing a `with` block or a custom context manager, a file comes out empty or garbled, line endings or encodings differ between machines, `seek()` misbehaves in text mode, the number of resources to open depends on input, or `-X dev` reports a `ResourceWarning`.
**Not this doc:** exceptions, chaining and `finally` → `python/errors-and-resources/exceptions-and-exception-groups.md`; `async with` in practice → `python/concurrency/asyncio-coroutines-and-tasks.md`; `str` versus `bytes` and codecs → `python/data-structures/strings-bytes-and-formatting.md`; how generators suspend → `python/iteration-and-functional/iterators-generators-and-itertools.md`; when objects are freed → `python/runtime/memory-management-and-garbage-collection.md`.

## Problem
File and cleanup code fails quietly:
- `f = open(p, "w"); f.write("important")`, then the process dies abruptly: the file on disk is empty.
- A script that never closes its files prints nothing unusual, until `-X dev` reports `ResourceWarning: unclosed file`.
- A file read without `encoding=` decodes differently on another machine or an older Python, because before 3.15 the default was the locale's encoding.
- A CSV (comma-separated values) file with Windows line endings gives `'a\n'` in one program and `'a\r\n'` in another.
- `f.seek(f.tell() + 2)` on a text file is undefined, and `f.seek(2, 1)` raises.
- A `@contextmanager` generator that catches an exception to log it swallows the exception for every caller.
- The list of files to open comes from user input, so nested `with` statements cannot be written out by hand.

## Mental model
**Analogy:** a context manager is a hotel front desk. Check-in (`__enter__`) hands you a room key (the value bound by `as`); the block is your stay; check-out (`__exit__`) happens however you leave: on time, early (`return`, `break`), or carried out by the fire brigade (an exception). The desk is told why you left (the three exception arguments) and may decide the incident is closed (by returning true). A text file adds an interpreter between you and a store of bytes: it decodes bytes into `str` when reading, encodes when writing, and rewrites line endings; binary mode sends the interpreter home. Written data first lands in an outbox tray (the buffer) and reaches the disk when the tray is full, flushed, or the file is closed.

**Artifact** (measured in the lab ✅[^lab]):
```python
class Tracer:
    def __init__(self, name, suppress=False, log=None):
        self.name, self.suppress, self.log = name, suppress, log
    def __enter__(self):
        self.log.append(f"enter {self.name}")
        return f"value-from-{self.name}"
    def __exit__(self, exc_type, exc, tb):
        self.log.append(f"exit {self.name}: {exc_type.__name__ if exc_type else None}")
        return self.suppress

log = []
with Tracer("A", log=log) as v:
    log.append(f"body sees {v}")
log    # ['enter A', 'body sees value-from-A', 'exit A: None']

log = []
with Tracer("A", suppress=True, log=log):
    raise KeyError("k")
log.append("next statement runs")
log    # ['enter A', 'exit A: KeyError', 'next statement runs']
```

## How it works
### The `with` statement
Two actors take part:
- **The interpreter** — its job: run the `with` statement, via the steps the language reference fixes.
- **The context manager** — its job: set up and tear down, via its `__enter__()` and `__exit__()` methods.

1. **Interpreter:** evaluates the expression to get the manager, and looks up its `__enter__()` and `__exit__()` for later use ✅[^compound].
2. **Interpreter → manager:** calls `__enter__()`; if there is an `as` target, binds the return value to it ✅[^compound]. Once `__enter__()` has returned without error, `__exit__()` is guaranteed to be called, and an error while binding the target counts as an error in the block ✅[^compound]. If `__enter__()` itself raises, `__exit__()` is not called: the lab's `BadEnter` never ran its `__exit__` ✅[^lab].
3. **Interpreter:** runs the block.
4. **Interpreter → manager:** calls `__exit__()`. If an exception ended the block, it passes the exception's type, value and traceback; otherwise it passes three `None`s ✅[^compound]. In the lab a `ZeroDivisionError` arrived as `('ZeroDivisionError', "ZeroDivisionError('division by zero')", 'traceback')` ✅[^lab].
5. **Manager → interpreter:** after an exception, a true return value suppresses it and execution continues after the `with`; a false one makes the interpreter re-raise it. After a normal exit, a `return` or a `break`, the return value is ignored ✅[^compound]. `__exit__()` should not re-raise the exception itself; that is the caller's job ✅[^datamodel]. "True" means truthy: an `__exit__` returning `"yes"` suppressed a `ValueError` in the lab ✅[^lab].

```
interpreter                                   manager
evaluate EXPR ─────────────────────────────▶  the manager object
call __enter__() ──────────────────────────▶  returns value; interpreter binds `as x`
run the block
 ├─ ends normally / return / break ────────▶  __exit__(None, None, None)   result ignored
 └─ raises E ──────────────────────────────▶  __exit__(type(E), E, tb)
                                               true  → E suppressed, continue after the with
                                               false → interpreter re-raises E
```

6. **Several managers.** `with A() as a, B() as b:` means `with A() as a:` with `with B() as b:` inside it ✅[^compound]. Since 3.10 the items may be wrapped in parentheses and split over lines ✅[^compound]. The lab order was `enter A, enter B, body, exit B, exit A`; when the inner `__exit__` returned false and the outer one true, the exception reached both and the outer one suppressed it ✅[^lab].
7. **`async with`** is the same protocol with awaited `__aenter__()` and `__aexit__()`, and it is a `SyntaxError` outside a coroutine function ✅[^compound].

### `contextlib`
8. **`@contextmanager`** turns a generator function into a manager factory: the generator must yield exactly once, the yielded value is bound to the `as` target, and an exception from the block is re-raised inside the generator at the `yield` ✅[^contextlib]. Wrap the `yield` in `try … finally` for cleanup; a generator that catches the exception only to log it must re-raise it, or the `with` statement treats it as handled ✅[^contextlib]. Lab: the re-raising version logged `['open <p>', "saw ValueError('bad'), re-raising", 'close </p>', 'caller saw ValueError']`, and a version with `except ZeroDivisionError: pass` let the next statement run ✅[^lab]. These managers are single use; files are effectively single use too, because the first `with` closes them ✅[^contextlib].
9. **`suppress(*exceptions)`** ignores the named exception types raised in the block and continues after the `with`, exactly like `try: … except X: pass` ✅[^contextlib]; use it only where silently continuing is known to be right ✅[^contextlib]. Since 3.12 it also removes matching members from an exception group and re-raises the rest ✅[^contextlib].
10. **`ExitStack`** collects managers and callbacks at run time and unwinds them in reverse order when the `with` ends, as if they were nested `with` statements ✅[^contextlib]. `enter_context(cm)` enters a manager and returns its `__enter__()` value; `callback(fn, *args)` registers a plain function; `pop_all()` moves the registrations to a new stack without running them; `close()` unwinds now ✅[^contextlib]. Callbacks do not run when the stack is garbage-collected ✅[^contextlib]. Lab: three callbacks ran as `cleanup c, cleanup b, cleanup a`; when the fourth of four `open()` calls failed, the first three files were already closed ✅[^lab].
11. **Small helpers.** `closing(thing)` calls `thing.close()` at the end of the block, for objects that have `close()` but are not managers ✅[^contextlib]. `nullcontext(value)` does nothing and returns `value` from `__enter__()`, a stand-in when a manager is optional ✅[^contextlib]. `chdir(path)` (added in 3.11) changes the working directory and restores the old one on exit; it changes process-wide state, so it does not suit most threaded or async code ✅[^contextlib].

### Opening files
12. **Modes.** `open()` returns a file object and raises `OSError` when the file cannot be opened ✅[^open]. The mode letters ✅[^open]:

    | Letter | Meaning |
    |---|---|
    | `r` | read (the default; `'r'` is the same as `'rt'`) |
    | `w` | write, truncating the file first |
    | `x` | create; fail if the file exists (`FileExistsError`) |
    | `a` | write, appending to the end |
    | `b` / `t` | binary / text (text is the default) |
    | `+` | read and write; `w+` truncates, `r+` does not |

    The class depends on the mode: in the lab `'r'` and `'a'` gave `TextIOWrapper`, `'rb'` `BufferedReader`, `'w+b'` and `'rb+'` `BufferedRandom`, and `'rb'` with `buffering=0` the raw `FileIO` ✅[^lab].
13. **Text versus binary.** Binary mode returns `bytes` with no decoding; text mode returns `str`, decoded from the file's bytes ✅[^open]. Binary streams also skip newline translation ✅[^io]. Passing `str` to a binary stream's `write()`, or `bytes` to a text stream's, raises `TypeError` ✅[^io]. In the lab, `'café\n'` was stored as `b'caf\xc3\xa9\n'` ✅[^lab].
14. **The default encoding.** Since 3.15 text files default to UTF-8 regardless of the system's locale (PEP 686, PEP = Python Enhancement Proposal) ✅[^whatsnew315]. UTF-8 Mode can still be disabled with `PYTHONUTF8=0` or `-X utf8=0` ✅[^whatsnew315], and only then does the default fall back to `locale.getencoding()` ✅[^open]. `encoding="locale"` asks for the locale encoding explicitly and exists since 3.10 ✅[^whatsnew315]. For code that runs on several Python versions, pass `encoding=` every time ✅[^whatsnew315]. To find calls that rely on the default, `-X warn_default_encoding` or `PYTHONWARNDEFAULTENCODING` emits an `EncodingWarning` ✅[^io]; in the lab that printed `EncodingWarning: 'encoding' argument not specified` ✅[^lab]. `errors=` chooses what happens to bytes that do not decode ✅[^open].
15. **Newlines.** With the default `newline=None`, reading turns `'\n'`, `'\r'` and `'\r\n'` into `'\n'`, and writing turns `'\n'` into `os.linesep`; `newline=''` reads endings untranslated and writes without translation; any other legal value (`'\n'`, `'\r'`, `'\r\n'`) ends lines only at that string on reading and replaces `'\n'` with it on writing ✅[^open]. Lab: the bytes `b"a\r\nb\rc\n"` read as `'a\nb\nc\n'` by default and as `'a\r\nb\rc\n'` with `newline=''`; writing `"x\ny\n"` with `newline='\r\n'` stored `b'x\r\ny\r\n'` ✅[^lab].
16. **Buffering.** Binary files are buffered in fixed-size chunks, typically 128 kilobytes; text files attached to a terminal are line-buffered; `buffering=0` (unbuffered) is allowed only in binary mode, and `buffering=1` (line buffering) only for text writing ✅[^open]. In the lab, after `write("hello\n")` the file was 0 bytes on disk and 6 bytes after `flush()`; `io.DEFAULT_BUFFER_SIZE` was `131072` ✅[^lab]. Without `with` or `close()`, the written data might not be completely written to disk, even when the program exits successfully ✅[^tut-io]: a child process that wrote `'important'` and then called `os._exit(0)` left a 0-byte file, while a normal exit left 9 bytes ✅[^lab].
17. **Positions.** `tell()` is a byte offset in binary mode and an opaque number in text mode ✅[^tut-io]. A text file may only `seek()` to `0`, to a value `tell()` returned, or to the end with `seek(0, 2)`; any other offset is undefined behaviour ✅[^io]. Lab: after reading `'é1\n'` (3 characters), `tell()` was `4`, which here matched the bytes consumed, not the characters; treat it only as a token to give back to `seek()`. `seek(2, 1)` raised `io.UnsupportedOperation: can't do nonzero cur-relative seeks` ✅[^lab].
18. **Reading.** `read(size)` returns at most `size` characters (text) or bytes (binary), everything when `size` is omitted, and `''` at the end of the file; `readline()` keeps the trailing `'\n'`, so a blank line is `'\n'` and the end is `''`; looping `for line in f` is memory efficient; `write()` returns the number of characters written ✅[^tut-io]. After `close()`, any read or write raises `ValueError`; calling `close()` again does nothing ✅[^io]. Lab: `ValueError: I/O operation on closed file.` ✅[^lab].

### Paths and temporary files
19. **`pathlib.Path`** objects represent paths with methods that touch the file system ✅[^pathlib]. `/` joins segments, and an absolute right-hand side discards the left ✅[^pathlib]: `Path('/etc') / '/tmp'` is `/tmp` ✅[^lab]. `read_text()` and `write_text()` open, read or write, and close in one call, taking the same `encoding`, `errors` and `newline` arguments as `open()` ✅[^pathlib]. `mkdir(parents=True, exist_ok=True)` behaves like `mkdir -p` ✅[^pathlib]. For `report.final.csv` the lab gave `name` `'report.final.csv'`, `stem` `'report.final'`, `suffix` `'.csv'` and `suffixes` `['.final', '.csv']` ✅[^lab]. `open()` accepts any path-like object, `Path` included ✅[^open].
20. **`tempfile`.** `TemporaryFile`, `NamedTemporaryFile`, `TemporaryDirectory` and `SpooledTemporaryFile` clean up after themselves and work as context managers; `mkstemp()` and `mkdtemp()` leave the cleanup to you ✅[^tempfile]. `TemporaryFile` defaults to mode `'w+b'` and is destroyed when closed; `NamedTemporaryFile` has a visible name, and with `delete_on_close=False` (added in 3.12) it survives `close()` and is deleted when the `with` ends; `TemporaryDirectory` removes the directory and everything in it on exit ✅[^tempfile]. Lab: the `as` target of `TemporaryDirectory` was a `str`, and the directory was gone after the block ✅[^lab].

### Why files must be closed explicitly
21. **Finalization is not guaranteed.** Objects are never destroyed explicitly; an implementation may postpone garbage collection or skip it, so objects holding external resources such as open files offer `close()`, and programs are strongly recommended to call it, with `try … finally` or `with` ✅[^datamodel]. CPython's reference counting frees most objects as soon as they become unreachable, but that is an implementation detail: do not depend on it, and always close files explicitly ✅[^datamodel]. An `IOBase` object's `__del__()` calls `close()` ✅[^io], so a forgotten file is closed whenever the object happens to be finalized, if it is.
22. **`ResourceWarning` makes leaks visible.** It is ignored by default; Python Development Mode (`-X dev` or `PYTHONDEVMODE=1`) adds the `default` warning filter, which shows it ✅[^devmode]. Adding `-X tracemalloc=5` also shows where the resource was allocated ✅[^devmode]. The lab script below printed `4` with no warning under `python3.15 -I`, and under `-X dev` also printed `<work>/leak.py:4: ResourceWarning: unclosed file <_io.TextIOWrapper name='<work>/leak.py' mode='r' encoding='utf-8'>`, where `<work>` stands for the script's temporary folder ✅[^lab]:
    ```python
    def main():
        f = open(__file__, encoding='utf-8')
        return len(f.readlines())
    print(main())
    ```

## Worked example
Converting a CSV with Windows line endings (`\r\n`) into a Unix copy (`\n`), inside a temporary directory, run in the lab ✅[^lab]:
```python
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as tmp:
    src = Path(tmp) / "people.csv"
    dst = Path(tmp) / "people-lf.csv"
    src.write_bytes(b"id,name\r\n1,Zo\xc3\xab\r\n2,Ana\r\n")     # 24 bytes
    with (
        open(src, encoding="utf-8") as fin,
        open(dst, "x", encoding="utf-8", newline="\n") as fout,
    ):
        lines = list(fin)
        for line in lines:
            fout.write(line)
```

| Step | What happens | Value in the lab |
|---|---|---|
| 1 | `write_bytes` stores the source | returns `24` |
| 2 | `list(fin)`: universal newlines turn `\r\n` into `\n`, UTF-8 decodes `\xc3\xab` | `['id,name\n', '1,Zoë\n', '2,Ana\n']` |
| 3 | inside the `with`, after the writes | `fout.closed` is `False`; `dst` is `0` bytes on disk (still buffered) |
| 4 | the `with` ends: `fout` exits first, then `fin` ✅[^compound] | both closed; `dst` is `21` bytes |
| 5 | `dst.read_bytes()` | `b'id,name\n1,Zo\xc3\xab\n2,Ana\n'`: 3 bytes shorter, one per `\r` dropped |
| 6 | a second `with` opens `src`, then `dst` with mode `'x'` again | `FileExistsError: File exists`; the already-opened `fin` was closed |
| 7 | after `TemporaryDirectory` exits | `Path(tmp).exists()` is `False` |

Step 6 is How it works 2 and 6 together: `open(dst, "x")` failed while the second item was being evaluated, which happens inside the first item's block, so the first item's `__exit__()` still ran, and nothing was overwritten.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Re-entering one `@contextmanager` object | CPython 3.15.2: `AttributeError: '_GeneratorContextManager' object has no attribute 'args'` ✅[^lab] | The docs' own example shows `RuntimeError: generator didn't yield` ✅[^contextlib]; either way, create the manager in the `with` header each time |
| `@contextmanager` generator that yields twice | `RuntimeError: generator didn't stop` ✅[^lab] | It must yield exactly once ✅[^contextlib] |
| `__enter__()` raises | `__exit__()` is not called ✅[^lab] | The guarantee starts only once `__enter__()` returns ✅[^compound] |
| `suppress(FileNotFoundError)` around a `PermissionError` | The `PermissionError` propagates ✅[^lab] | Only the listed types are suppressed ✅[^contextlib] |
| `stack.enter_context(object())` | `TypeError: 'builtins.object' object does not support the context manager protocol` ✅[^lab] | `TypeError` since 3.11 (was `AttributeError`) ✅[^contextlib] |
| `open(p, "rb", encoding="utf-8")` | `ValueError: binary mode doesn't take an encoding argument` ✅[^lab] | Encoding is for text mode only ✅[^open] |
| `open(p, "r", buffering=0)` | `ValueError: can't have unbuffered text I/O` ✅[^lab] | Unbuffered is binary-only ✅[^open] |
| `open("nodir/f.txt", "w")` with no `nodir` | `FileNotFoundError` ✅[^lab] | `open()` does not create folders; use `Path.mkdir(parents=True)` ✅[^pathlib] |
| Reading `'café'` with `encoding="ascii"` | `UnicodeDecodeError` at byte 3; with `errors="replace"`, `'caf��\n'` ✅[^lab] | `errors=` picks the handler ✅[^open] |
| `-W error::ResourceWarning` on the leaking script | `Exception ignored while finalizing file …`, exit code `0` ✅[^lab] | The warning is raised during finalization, and exceptions raised in `__del__()` are ignored with a message on `sys.stderr` ✅[^datamodel] |
| `-X warn_default_encoding` on 3.15 | Still warns, although the default is now UTF-8 ✅[^lab] | It flags every use of the default encoding ✅[^io] |
| `NamedTemporaryFile(delete_on_close=False)` | Still on disk after `close()`, gone after the `with` ✅[^lab] | Deletion moves to context-manager exit ✅[^tempfile] |
| `ExitStack()` dropped without `close()` or `with` | Its callbacks are not run | Garbage collection does not invoke them ✅[^contextlib] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `with open(...) as f:` | Closed on every exit, shorter than `try … finally` ✅[^tut-io] | One indentation level |
| `f = open(...)` and `f.close()` by hand | Works across functions | An exception before `close()` leaks the file |
| Class with `__enter__` / `__exit__` | Reusable; full control of suppression | More code |
| `@contextmanager` generator | No class and no separate `__enter__`/`__exit__` methods ✅[^contextlib] | Single use; a missing re-raise swallows errors ✅[^contextlib] |
| Nested or multi-item `with` | Plain and static | Fixed number of resources |
| `ExitStack` | Any number of resources, chosen at run time ✅[^contextlib] | Harder to read |
| `Path.read_text()` | One line, closes the file ✅[^pathlib] | Whole file in memory |
| `for line in f` | Memory efficient and fast ✅[^tut-io] | Needs a `with` around it |
| Explicit `encoding="utf-8"` | Same result on every Python version ✅[^whatsnew315] | A few more characters |

## Takeaways
- Open every file with `with`, or hand it to an `ExitStack`; never rely on garbage collection to close it. [rule-candidate]
- Pass `encoding=` on every text-mode `open()`, `read_text()` and `write_text()`. [rule-candidate]
- In a `@contextmanager`, put cleanup in `finally` and re-raise any exception you catch only to log. [rule-candidate]
- Use mode `'x'` when overwriting an existing file would be a bug.
- Seek in text files only to `0`, the end, or a value `tell()` returned.
- Use `newline=''` when a library (such as a CSV parser) must see the original line endings.
- Run tests with `-X dev` so `ResourceWarning` exposes unclosed files. [rule-candidate]

## Verification status
- Verified: 105 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [8. Compound statements: The with statement](https://docs.python.org/3/reference/compound_stmts.html) — Python Software Foundation, living. Rank 1. Backs: the steps of `with`; the `__exit__()` guarantee; suppression by a true return value; several items as nesting; the parenthesised form; `async with`. [^compound]
- [3. Data model: Objects, values and types; object.__del__(); With Statement Context Managers](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: `__exit__()` should not re-raise; finalization is not guaranteed; close files explicitly; exceptions in `__del__()` are ignored. [^datamodel]
- [contextlib — Utilities for with-statement contexts](https://docs.python.org/3/library/contextlib.html) — Python Software Foundation, living. Rank 1. Backs: `@contextmanager`, `suppress`, `ExitStack`, `closing`, `nullcontext`, `chdir`; single-use managers; the documented reuse error. [^contextlib]
- [Built-in functions: open()](https://docs.python.org/3/library/functions.html) — Python Software Foundation, living. Rank 1. Backs: modes; text versus binary; default encoding when UTF-8 Mode is off; `errors`; `newline`; buffering; path-like arguments. [^open]
- [io — Core tools for working with streams](https://docs.python.org/3/library/io.html) — Python Software Foundation, living. Rank 1. Backs: `TypeError` on the wrong data type; no translation in binary I/O; opt-in `EncodingWarning`; text `seek()`; `close()`; `IOBase.__del__()`. [^io]
- [7. Input and output: Reading and writing files](https://docs.python.org/3/tutorial/inputoutput.html) — Python Software Foundation, living. Rank 1. Backs: data may not reach the disk without `close()`; `read`, `readline`, line iteration, `write` return value; `tell()` in text versus binary mode; `with` versus `try … finally`. [^tut-io]
- [pathlib — Object-oriented filesystem paths](https://docs.python.org/3/library/pathlib.html) — Python Software Foundation, living. Rank 1. Backs: `Path`, the `/` operator, `read_text`/`write_text`, `mkdir`. [^pathlib]
- [tempfile — Generate temporary files and directories](https://docs.python.org/3/library/tempfile.html) — Python Software Foundation, living. Rank 1. Backs: the four self-cleaning helpers, `mkstemp`, `delete_on_close`. [^tempfile]
- [Python Development Mode](https://docs.python.org/3/library/devmode.html) — Python Software Foundation, living. Rank 1. Backs: `-X dev` shows `ResourceWarning`; `-X tracemalloc`. [^devmode]
- [What's new in Python 3.15: Other language changes](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: UTF-8 as the default encoding; `encoding='locale'` since 3.10; pass `encoding` explicitly. [^whatsnew315]

## Related
- `python/errors-and-resources/exceptions-and-exception-groups.md` — what `__exit__()` receives, chaining and `finally`.
- `python/concurrency/asyncio-coroutines-and-tasks.md` — `async with` and asynchronous context managers.
- `python/data-structures/strings-bytes-and-formatting.md` — `str`, `bytes` and encodings.
- `python/iteration-and-functional/decorators-and-functools.md` — decorators, which `@contextmanager` is.
- `python/runtime/memory-management-and-garbage-collection.md` — reference counting and when finalizers run.
- `python/python-lab-setup.md` — the interpreter these outputs came from.
