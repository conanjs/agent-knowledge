---
schema: knowledge-doc/v1
type: reference
topic: python/standard-library
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, standard-library, os, shutil, glob, pathlib, subprocess, argparse, sys, json, csv, tomllib, struct, decimal, fractions, statistics, gzip, http-server, deque, bisect, heapq]
ranked-sources: true
---

# Standard library tour: the modules for everyday tasks

## Summary
**TL;DR:** For most chores the standard library already has a module: `pathlib`, `shutil` and `glob` for files; `subprocess.run` for other programs; `argparse` for command lines; `json`, `csv`, `tomllib` and `struct` for data formats; `decimal`, `fractions` and `statistics` for exact or statistical math; `deque`, `bisect` and `heapq` for queues, sorted lists and priority queues. Each has a trap worth knowing before first use: `json` turns tuples into lists and `int` keys into strings ✅[^json], `subprocess.run` ignores a failing exit code unless `check=True` ✅[^lab], `glob` skips dot files and returns names in no particular order ✅[^glob], and `pprint.pprint` sorts dictionary keys ✅[^pprint].
**Use this when:** you need the right module and its one-line call for a common task, or a standard library call surprised you and you want the documented reason.
**Not this doc:** regular expressions → `python/standard-library/regular-expressions.md`; dates, time zones and clocks → `python/standard-library/dates-and-times.md`; threads → `python/concurrency/threads-processes-and-the-gil.md`; logging, `timeit`, `doctest`, `unittest` → `python/tooling/testing-debugging-and-profiling.md`; weak references → `python/runtime/memory-management-and-garbage-collection.md`; `open()`, encodings and `with` → `python/errors-and-resources/context-managers-and-file-io.md`; why `0.1 + 0.2 != 0.3` → `floating-point/rounding-and-error.md`.

## Scope
- The modules the Python Tutorial's two "Brief tour of the standard library" chapters introduce ✅[^tut-stdlib] ✅[^tut-stdlib2], plus `pathlib`, `subprocess`, `tomllib`, `fractions` and `compression.zstd`, which daily scripts reach for as well.
- Every "Key calls" value ran on CPython 3.15.2 on 2026-11-24 ✅[^lab]; every "Gotcha" either ran there too or cites the module's page in the 3.15 documentation. No probe touched the network: `urllib.request` talked to `http.server` on 127.0.0.1.
- Left out: `smtplib`, `xmlrpc`, `email`, `sqlite3`, `locale`, `gettext`, `codecs`, `zipfile`, `tarfile`, `bz2` and `lzma`, which the tour only names.

## Catalog

### Files and the operating system
| Module | Use it for | Key calls | Gotcha |
|---|---|---|---|
| `os` | Dozens of functions that talk to the operating system ✅[^tut-stdlib] | `os.getcwd()`; `os.environ.get('NO_SUCH_VAR', 'dflt')` → `'dflt'`, while `os.environ['NO_SUCH_VAR']` raises `KeyError`; `os.makedirs(path, exist_ok=True)` (a second call without `exist_ok` raises `FileExistsError`) ✅[^lab] | Write `import os`, never `from os import *`: the star import lets `os.open()` shadow the built-in `open()` ✅[^tut-stdlib]. `os.environ` is captured when `os` is first imported; later changes made outside `os.environ` do not show in it ✅[^os] |
| `shutil` | Higher-level copy, move and delete ✅[^tut-stdlib] | `shutil.copyfile(src, dst)` and `shutil.move(src, dst)` return the destination; `shutil.rmtree(path)` deletes a tree; `shutil.which('sh')` → `'/bin/sh'`, `None` for an unknown command ✅[^lab] | `copyfile()` copies contents only; `copy()` adds the permission mode; `copy2()` also tries to keep the other metadata, yet even it loses owner, group and ACLs (access control lists) on POSIX (Portable Operating System Interface: Unix-like) systems ✅[^shutil] |
| `glob` | File lists from shell wildcards ✅[^tut-stdlib] | `glob.glob('*.py', root_dir=d)` → `['a.py', 'b.py']`; `glob.glob('**/*.py', root_dir=d, recursive=True)` → `['a.py', 'b.py', 'sub/c.py']` ✅[^lab] | Names come back in no particular order, so sort them; files starting with `.` match only a pattern that starts with a dot, or with `include_hidden=True` (3.11) ✅[^glob]. Without `recursive=True`, `'**/*.py'` found only `sub/c.py` ✅[^lab] |
| `pathlib` | Paths as objects, small file reads and writes ✅[^pathlib] | `Path('a') / 'b' / 'c.txt'`; `p.write_text('hi\n', encoding='utf-8')` returns `3`; `p.stem, p.suffix` → `('notes', '.txt')`; `p.with_suffix('.md')`; `p.mkdir(parents=True, exist_ok=True)` ✅[^lab] | `Path.glob()` is not `glob.glob()`: dot files are not special and `**` is always recursive ✅[^pathlib], so `d.glob('*.py')` listed `.hidden.py` ✅[^lab]. `mkdir()` without `parents=True` raises `FileNotFoundError` for a missing parent ✅[^pathlib] |

### Running other programs
| Module | Use it for | Key calls | Gotcha |
|---|---|---|---|
| `subprocess.run` | The recommended way to start a child process ✅[^subprocess] | `r = subprocess.run([sys.executable, '-c', "print('hi')"], capture_output=True, text=True)` → `r.stdout == 'hi\n'`, `r.returncode == 0`; without `text=True`, `r.stdout == b'hi\n'` ✅[^lab] | Output is bytes unless `text`, `encoding` or `errors` is given ✅[^subprocess] |
| `check=True` | Turn a failing exit code into an exception | A child that exits with 3: `returncode == 3` and no exception; with `check=True`, `CalledProcessError` with `returncode == 3` ✅[^lab] | Without `check=True` a failure passes silently ✅[^lab] |
| A string command | Avoid it on POSIX | `subprocess.run('echo hi')` → `FileNotFoundError: ... 'echo hi'`; `shell=True` works but runs a shell ✅[^lab] | On POSIX a string `args` is the name of the program to run ✅[^subprocess]; with `shell=True`, quoting against shell injection is your job ✅[^subprocess] |
| `timeout=` and `capture_output=` | Bound the wait; collect both streams | `timeout=0.5` on a 5-second child raised `TimeoutExpired` ✅[^lab] | On timeout the child is killed and waited for before `TimeoutExpired` is re-raised; `capture_output` cannot be combined with `stdout=` or `stderr=` ✅[^subprocess] (`ValueError: stdout and stderr arguments may not be used with capture_output.` ✅[^lab]) |

### Command-line arguments and program exit
| Module | Use it for | Key calls | Gotcha |
|---|---|---|---|
| `sys.argv` | The raw argument list ✅[^tut-stdlib] | `python demo.py one two three` → `['demo.py', 'one', 'two', 'three']`; `python -c '...' a b` → `['-c', 'a', 'b']` ✅[^lab] | `argv[0]` is the script name, `'-c'` with `-c`, and whether it is a full path depends on the OS ✅[^sys] |
| `argparse` | Options, positional arguments, help and errors ✅[^tut-stdlib] | The tutorial's parser (`filenames` with `nargs='+'`, `-l/--lines` with `type=int, default=10`) parses `['--lines=5', 'alpha.txt', 'beta.txt']` into `Namespace(filenames=['alpha.txt', 'beta.txt'], lines=5)` ✅[^lab] | On a bad command line it prints usage and the error, then exits ✅[^argparse]; for example `top: error: the following arguments are required: filenames`, exit code `2` ✅[^lab] |
| `argparse` booleans | On/off flags | `action='store_true'`; `action=argparse.BooleanOptionalAction` gives `--color`/`--no-color` ✅[^argparse] | `type=bool` turns every non-empty string into `True` ✅[^argparse]; for example `--flag False` gave `True` ✅[^lab] |
| `argparse` prefixes | Long options | `--line=5` was accepted as `--lines=5` ✅[^lab] | Unambiguous abbreviations are accepted unless `allow_abbrev=False`; since 3.15 `suggest_on_error` defaults to `True`, but it covers only choices and subparser names ✅[^argparse], so `--lnes=5` got just `unrecognized arguments` ✅[^lab] |
| `sys.exit()` | End the program with a status ✅[^tut-stdlib] | `sys.exit('fatal: no config')` → exit code `1`, message on stderr; `sys.exit()` → `0`; an uncaught exception → `1` ✅[^lab] | It raises `SystemExit`, so `finally` blocks run and an outer `try` can catch it; it exits the process only from the main thread ✅[^sys]. Unix programs generally use 2 for command-line syntax errors and 1 for other errors ✅[^sys] |
| `sys.stderr` | Warnings and errors that stay visible when stdout is redirected ✅[^tut-stdlib] | `print('err', file=sys.stderr)` and `sys.stderr.write('warn\n')` reached the child's stderr, not stdout ✅[^lab] | Non-interactive stdout is block-buffered, stderr is line-buffered; `-u` makes both unbuffered ✅[^sys] |

### Text
| Module | Use it for | Key calls | Gotcha |
|---|---|---|---|
| `textwrap` | Fit paragraphs to a width ✅[^tut-stdlib2] | `textwrap.fill(doc, width=40)` (4 lines); `wrap()` returns the list; `shorten('Hello  world, this is long', width=15)` → `'Hello [...]'`; `dedent('    a\n      b\n')` → `'a\n  b\n'` ✅[^lab] | `shorten()` collapses whitespace first; `dedent()` treats a tab and a space as different, so `" hello"` and `"\thello"` share no indent ✅[^textwrap] |
| `reprlib` | Short `repr()` of big containers ✅[^tut-stdlib2] | `reprlib.repr(list(range(100)))` → `'[0, 1, 2, 3, 4, 5, ...]'` ✅[^lab] | The limits live on a shared object (`maxlist=6`, `maxstring=30` by default); changing `reprlib.aRepr` also changes the debugger's output ✅[^reprlib] |
| `pprint` | Readable nested data ✅[^tut-stdlib2] | `pprint.pprint(t, width=30)` breaks the tutorial's nested list over 5 lines ✅[^lab] | `pprint()` and `pformat()` sort dict keys by default, `pp()` keeps insertion order ✅[^pprint]; for example `pformat({'b': 1, 'a': 2})` → `"{'a': 2, 'b': 1}"` ✅[^lab] |
| `string.Template` | `$name` placeholders that end users can edit ✅[^tut-stdlib2] | `Template('${village}folk send $$10 to $cause.').substitute(village='Nottingham', cause='the ditch fund')` → `'Nottinghamfolk send $10 to the ditch fund.'` ✅[^lab] | `substitute()` raises `KeyError` for a missing name; `safe_substitute()` leaves `$owner` in place ✅[^tut-stdlib2] ✅[^lab]. It is unrelated to t-strings, which build `string.templatelib.Template` (3.14) ✅[^string] |

### Numbers and math
| Module | Use it for | Key calls | Gotcha |
|---|---|---|---|
| `math` | C-library float functions ✅[^tut-stdlib] | `math.log(1024, 2)` → `10.0`; `floor(-2.5), ceil(-2.5), trunc(-2.5)` → `(-3, -2, -2)`; `prod([1, 2, 3, 4])` → `24`; `comb(5, 2)` → `10`; `isclose(0.1 + 0.2, 0.3)` → `True` ✅[^lab] | `isclose()` defaults to `rel_tol=1e-09, abs_tol=0.0`, so a comparison with `0.0` needs an `abs_tol` ✅[^math]. `sqrt(-1)` raises `ValueError: expected a nonnegative input, got -1.0` ✅[^lab] |
| `sum` / `math.fsum` | Adding many floats | `sum([0.1] * 10)` and `math.fsum([0.1] * 10)` both gave `1.0` ✅[^lab] | Since 3.12 `sum()` of floats uses an algorithm with higher accuracy on most builds ✅[^functions]; `fsum()` tracks several partial sums to avoid losing precision ✅[^math] |
| `random` | Simulations and sampling ✅[^tut-stdlib] | `choice(seq)`; `sample(range(100), 10)` (10 distinct values); `randrange(6)` drew 0 to 5, `randint(1, 6)` drew 1 to 6; `seed(42)` repeats the sequence ✅[^lab] | Not for security: use `secrets` ✅[^random]. `randint(a, b)` includes `b` ✅[^random]; `shuffle(xs)` works in place and returns `None` ✅[^lab] |
| `statistics` | Mean, median, variance ✅[^tut-stdlib] | On the tutorial's data: `mean` → `1.6071428571428572`, `median` → `1.25`, `variance` → `1.3720238095238095` ✅[^lab] | `variance()` is the sample variance (n − 1), `pvariance()` the population one → `1.1760204081632653` ✅[^statistics] ✅[^lab]. `median([1, 2, 3, 4])` → `2.5` (mean of the middle two) ✅[^statistics] ✅[^lab]; empty data raises `StatisticsError` ✅[^statistics] |
| `decimal` | Money and other exact decimal work ✅[^tut-stdlib2] | `round(Decimal('0.70') * Decimal('1.05'), 2)` → `Decimal('0.74')`, while the float version gives `0.73`; `Decimal('2.665').quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)` → `Decimal('2.67')`; `localcontext()` for a temporary precision ✅[^lab] | `Decimal(0.1)` converts the float exactly ✅[^decimal] → `Decimal('0.1000000000000000055511151231257827021181583404541015625')` ✅[^lab]. The default context is `prec=28, rounding=ROUND_HALF_EVEN` ✅[^decimal], so plain `quantize` gives `2.66` ✅[^lab]. `Decimal + float` raises `TypeError` ✅[^decimal] |
| `fractions` | Exact rational numbers ✅[^fractions] | `Fraction(1, 3) + Fraction(1, 6)` → `Fraction(1, 2)`; `Fraction('0.1')` → `Fraction(1, 10)` ✅[^lab] | `Fraction(0.1)` is the float's exact value, not 1/10 ✅[^fractions]; for example `Fraction(3602879701896397, 36028797018963968)`; `.limit_denominator()` → `Fraction(1, 10)` ✅[^lab] |

### Data formats
| Module | Use it for | Key calls | Gotcha |
|---|---|---|---|
| `json` | JSON (JavaScript Object Notation) text ↔ dicts, lists, strings, numbers ✅[^tut-stdlib] | `json.dumps(obj, indent=2, sort_keys=True)`; `json.loads(s)`; `json.loads('1.1', parse_float=Decimal)` → `Decimal('1.1')` ✅[^lab] | Tuples are written as arrays ✅[^json] and come back as lists: `loads(dumps((1, 2)))` → `[1, 2]` ✅[^lab]. Since 3.15, `array_hook=tuple` → `(1, (2,))` ✅[^json] ✅[^lab] |
| `json` keys | Dicts with non-string keys | `dumps({1: 'a'})` → `'{"1": "a"}'`, read back as `{'1': 'a'}` ✅[^lab] | Keys are always converted to strings, so `loads(dumps(x)) != x` ✅[^json]. `dumps({1: 'a', '1': 'b'})` writes `"1"` twice, and `loads` keeps the last repeated name ✅[^json] ✅[^lab] |
| `json` numbers | Floats, huge ints | `dumps(0.1)` → `'0.1'`; `loads('12345678901234567890123')` → that exact `int` ✅[^lab] | `NaN` and `Infinity` are written by default though JSON forbids them; `allow_nan=False` makes it a `ValueError` ✅[^json] (`Out of range float values are not JSON compliant: nan` ✅[^lab]). `ensure_ascii=True` (the default) escapes non-ASCII (American Standard Code for Information Interchange) characters ✅[^json], so `é` becomes `\u00e9` ✅[^lab] |
| `json` errors | Unsupported types | `dumps({'s': {1, 2}})` → `TypeError: Object of type set is not JSON serializable` with the note `when serializing dict item 's'` ✅[^lab] | The note that names the failing item is new in 3.14 ✅[^whatsnew314] |
| `csv` | CSV (comma-separated values) rows, as spreadsheets export them ✅[^tut-stdlib] | `csv.writer(f).writerow([1, 'a,b', None])` wrote `1,"a,b",\r\n`; `csv.reader` gave `['1', 'a,b', '']`; `csv.DictReader` gives one dict per row ✅[^lab] | Open the file with `newline=''`, or quoted newlines break and an extra `\r` can appear; the reader returns strings only, with no type conversion ✅[^csv] |
| `tomllib` | Reading TOML (Tom's Obvious Minimal Language) configuration files ✅[^tomllib] | `with open(path, 'rb') as f: tomllib.load(f)` → `{'name': 'demo', 'version': 2}`; `tomllib.loads(text)` ✅[^lab] | `load()` needs a binary file ✅[^tomllib]; for example text mode raises `TypeError: File must be opened in binary mode` ✅[^lab]. It cannot write TOML, and since 3.15 it parses TOML 1.1.0 ✅[^tomllib]; for example `dt = 2010-02-03 14:15` (no seconds) loads ✅[^lab] |
| `struct` | Binary record layouts ✅[^tut-stdlib2] | `struct.pack('<IH', 1, 2)` → `b'\x01\x00\x00\x00\x02\x00'`; `struct.unpack('<IH', data)` → `(1, 2)` ✅[^lab] | No prefix means native byte order, size and alignment, with pad bytes ✅[^struct]; for example `calcsize('@HI')` → `8`, `calcsize('<HI')` → `6` ✅[^lab]. Out-of-range values raise `struct.error` ✅[^lab] |

### Compression
| Module | Use it for | Key calls | Gotcha |
|---|---|---|---|
| `zlib` | Compress bytes in memory; CRC (cyclic redundancy check) checksums ✅[^tut-stdlib] ✅[^zlib] | The tutorial's 41-byte sentence compressed to 37 bytes; `zlib.crc32(s)` → `226805979`; 12,000 bytes of repeated text → 62 bytes ✅[^lab] | `crc32` is not cryptographically strong ✅[^zlib] |
| `gzip` | `.gz` files and gzip blobs ✅[^tut-stdlib] | `gzip.open(path, 'wt', encoding='utf-8')` to write text, `'rt'` to read it ✅[^lab] | The default mode is `'rb'` ✅[^gzip], so a bare `gzip.open(path)` returns bytes ✅[^lab]. `gzip.compress()` uses `mtime=0` by default since 3.14 (reproducible output) and level 6 since 3.15 ✅[^gzip] |
| `compression.zstd` | The Zstandard format, new in 3.14 ✅[^whatsnew314] | `zstd.decompress(zstd.compress(data)) == data` → `True` in this build ✅[^lab] | `compression.gzip`, `compression.zlib` and friends re-export the old modules; the old names are not deprecated ✅[^whatsnew314] |

### Internet (localhost only)
| Module | Use it for | Key calls | Gotcha |
|---|---|---|---|
| `urllib.request` | Fetch a URL (web address) ✅[^tut-stdlib] | `with urlopen(url, timeout=5) as resp:` → `resp.status` `200`, `resp.headers['Content-Type']` `'text/plain'`, `resp.read()` `b'hello\n'` ✅[^lab] | The body is bytes; a 404 raises `HTTPError` with `.code == 404` ✅[^lab]. The docs recommend the third-party Requests package for a higher-level client ✅[^urllib-request] |
| `http.server` | Serve a folder over HTTP (Hypertext Transfer Protocol) ✅[^http-server] | `python3.15 -m http.server 8000 --bind 127.0.0.1 --directory DIR` ✅[^http-server]; on a free port it printed `Serving HTTP on 127.0.0.1 port PORT ...` and served `/hello.txt` ✅[^lab] | It binds to all interfaces unless `--bind` is given, is not recommended for production, and follows symlinks out of the served folder ✅[^http-server] |

### Containers and algorithms
| Module | Use it for | Key calls | Gotcha |
|---|---|---|---|
| `array` | Compact homogeneous numbers ✅[^tut-stdlib2] | `array('H', [4000, 10, 700, 22222])`: `sum` → `26932`, `a[1:3]` → `array('H', [10, 700])`, `itemsize` → `2` ✅[^lab] | `array('H', [70000])` raises `OverflowError`; appending `1.5` raises `TypeError` ✅[^lab]. `array.typecodes` became a tuple in 3.15 ✅[^array] ✅[^lab] |
| `collections.deque` | Queues and breadth-first search ✅[^tut-stdlib2]; "last N items", like Unix `tail` ✅[^collections] | `append`/`popleft` (FIFO: first in, first out); `appendleft`; `deque([1, 2, 3, 4], maxlen=3)` → `deque([2, 3, 4], maxlen=3)`; `rotate(1)` ✅[^lab] | Appends and pops take about O(1) (constant) time at both ends, but indexing slows to O(n) (proportional to length) in the middle; a full bounded deque silently drops items from the other end ✅[^collections] |
| `bisect` | Keep a list sorted; range lookups ✅[^tut-stdlib2] | `insort(scores, (300, 'ruby'))`; on `[1, 2, 2, 3]`, `bisect_left(xs, 2)` → `1`, `bisect_right(xs, 2)` → `3`; `bisect_left(scores, 300, key=lambda t: t[0])` → `2`; a grade table maps `[33, 99, 77, 70, 89, 90, 100]` to `['F', 'A', 'C', 'C', 'B', 'A', 'A']` ✅[^lab] | The list must already be sorted; `insort`'s O(log n) search is dominated by the O(n) insertion; `key=` (3.10) is not applied to the searched value; not thread-safe ✅[^bisect] |
| `heapq` | Priority queues on a plain list ✅[^tut-stdlib2] | `heapify(data)`, `heappush`, three `heappop` calls → `[-5, 0, 1]`; `(priority, task)` tuples pop as `['plan', 'write', 'ship']`; `heapify_max` + `heappop_max` → `9` ✅[^lab] | It is a min-heap: `heap[0]` is the smallest; `_max` functions arrived in 3.14 ✅[^heapq]. `(priority, task)` comparison fails on equal priorities when tasks cannot be compared ✅[^heapq] |

### Covered by other docs
| Module | Use it for | Key fact | Read next |
|---|---|---|---|
| `re` | Pattern matching in strings ✅[^tut-stdlib] | Prefer plain string methods when they are enough ✅[^tut-stdlib] | `python/standard-library/regular-expressions.md` |
| `datetime`, `zoneinfo`, `time` | Dates, time zones, clocks ✅[^tut-stdlib] | `datetime` supports time-zone-aware objects ✅[^tut-stdlib] | `python/standard-library/dates-and-times.md` |
| `threading`, `queue` | Background work ✅[^tut-stdlib2] | The tutorial prefers one thread that owns a resource, fed by a `queue` ✅[^tut-stdlib2] | `python/concurrency/threads-processes-and-the-gil.md` |
| `logging` | Diagnostic messages ✅[^tut-stdlib2] | Default: debug and info are dropped, output goes to stderr ✅[^tut-stdlib2], as `WARNING:root:Warning:config file server.conf not found` ✅[^lab] | `python/tooling/testing-debugging-and-profiling.md` |
| `weakref` | Track objects without keeping them alive ✅[^tut-stdlib2] | A `WeakValueDictionary` entry vanishes when its object is collected ✅[^tut-stdlib2] | `python/runtime/memory-management-and-garbage-collection.md` |
| `timeit`, `profile`, `doctest`, `unittest` | Timing, profiling, tests ✅[^tut-stdlib] | `profile` is deprecated in 3.15 in favour of `profiling.tracing` ✅[^whatsnew315] | `python/tooling/testing-debugging-and-profiling.md` |

## Lookup notes
| Version | Change that can break older code or habits | Module |
|---|---|---|
| 3.11 | `include_hidden=` added ✅[^glob]; `tomllib` added ✅[^tomllib] | `glob`, `tomllib` |
| 3.12 | `sum()` of floats became more accurate ✅[^functions] | built-ins |
| 3.14 | `gzip.compress()` defaults to `mtime=0` ✅[^gzip]; max-heap functions ✅[^heapq]; `compression` package ✅[^whatsnew314] | `gzip`, `heapq`, `compression` |
| 3.15 | `suggest_on_error=True` by default ✅[^argparse]; `typecodes` is a tuple ✅[^array]; TOML 1.1.0 ✅[^tomllib]; `array_hook=` ✅[^json]; `gzip.compress()` level 6 ✅[^gzip] | `argparse`, `array`, `tomllib`, `json`, `gzip` |

## Takeaways
- Call `subprocess.run` with a list of arguments and `check=True`; add `capture_output=True, text=True` when you read the output. [rule-candidate]
- Open CSV files with `newline=''` and TOML files with `'rb'`. [rule-candidate]
- Never use `type=bool` in `argparse`; use `action='store_true'` or `BooleanOptionalAction`. [rule-candidate]
- Build `Decimal` values from strings, and round money with `quantize(..., rounding=...)` so the rule is explicit. [rule-candidate]
- Sort `glob.glob()` results before depending on their order. [rule-candidate]
- Expect JSON to give back lists and string keys; convert on load instead of assuming a round trip.
- Use `random` for simulations and `secrets` for tokens. [rule-candidate]
- Bind `python -m http.server` to `127.0.0.1`, and keep it out of production.

## Verification status
- Verified: 190 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [10. Brief tour of the standard library](https://docs.python.org/3/tutorial/stdlib.html) — Python Software Foundation, living. Rank 1. Backs: the modules part I introduces and what each is for; `import os` versus `from os import *`; the `zlib` example. [^tut-stdlib]
- [11. Brief tour of the standard library — part II](https://docs.python.org/3/tutorial/stdlib2.html) — Python Software Foundation, living. Rank 1. Backs: the modules part II introduces; `Template.substitute` versus `safe_substitute`; the `Decimal` tax example; threads fed by a queue; logging defaults; weak references. [^tut-stdlib2]
- [`os` — Miscellaneous operating system interfaces](https://docs.python.org/3/library/os.html) — Python Software Foundation, living. Rank 1. Backs: `os.environ` captured at import. [^os]
- [`shutil` — High-level file operations](https://docs.python.org/3/library/shutil.html) — Python Software Foundation, living. Rank 1. Backs: what `copyfile`, `copy` and `copy2` preserve. [^shutil]
- [`glob` — Unix style pathname pattern expansion](https://docs.python.org/3/library/glob.html) — Python Software Foundation, living. Rank 1. Backs: unordered results, dot files, `include_hidden`. [^glob]
- [`pathlib` — Object-oriented filesystem paths](https://docs.python.org/3/library/pathlib.html) — Python Software Foundation, living. Rank 1. Backs: `Path.glob` versus `glob.glob`; `mkdir` and missing parents. [^pathlib]
- [`subprocess` — Subprocess management](https://docs.python.org/3/library/subprocess.html) — Python Software Foundation, living. Rank 1. Backs: `run()` as the recommended API; text mode; string `args` on POSIX; shell injection; timeout; `capture_output`. [^subprocess]
- [`argparse` — Parser for command-line options, arguments and subcommands](https://docs.python.org/3/library/argparse.html) — Python Software Foundation, living. Rank 1. Backs: error exit with usage; `type=bool`; `allow_abbrev`; `suggest_on_error` in 3.15. [^argparse]
- [`sys` — System-specific parameters and functions](https://docs.python.org/3/library/sys.html) — Python Software Foundation, living. Rank 1. Backs: `argv[0]`; `sys.exit` semantics and exit-code conventions; stream buffering. [^sys]
- [`textwrap` — Text wrapping and filling](https://docs.python.org/3/library/textwrap.html) — Python Software Foundation, living. Rank 1. Backs: `shorten` collapsing whitespace; `dedent` and tabs. [^textwrap]
- [`reprlib` — Alternate `repr()` implementation](https://docs.python.org/3/library/reprlib.html) — Python Software Foundation, living. Rank 1. Backs: default size limits; the shared `aRepr`. [^reprlib]
- [`pprint` — Data pretty printer](https://docs.python.org/3/library/pprint.html) — Python Software Foundation, living. Rank 1. Backs: `sort_dicts` defaults of `pprint`, `pformat` and `pp`. [^pprint]
- [`string` — Common string operations](https://docs.python.org/3/library/string.html) — Python Software Foundation, living. Rank 1. Backs: `Template` is unrelated to t-strings. [^string]
- [`math` — Mathematical functions](https://docs.python.org/3/library/math.html) — Python Software Foundation, living. Rank 1. Backs: `isclose` tolerances. [^math]
- [Built-in functions](https://docs.python.org/3/library/functions.html) — Python Software Foundation, living. Rank 1. Backs: the 3.12 change to float summation in `sum()`. [^functions]
- [`random` — Generate pseudo-random numbers](https://docs.python.org/3/library/random.html) — Python Software Foundation, living. Rank 1. Backs: not for security; `randint` bounds. [^random]
- [`statistics` — Mathematical statistics functions](https://docs.python.org/3/library/statistics.html) — Python Software Foundation, living. Rank 1. Backs: sample versus population variance; median of an even count; empty data. [^statistics]
- [`decimal` — Decimal fixed-point and floating-point arithmetic](https://docs.python.org/3/library/decimal.html) — Python Software Foundation, living. Rank 1. Backs: exact conversion from float; default context; no mixing with float. [^decimal]
- [`fractions` — Rational numbers](https://docs.python.org/3/library/fractions.html) — Python Software Foundation, living. Rank 1. Backs: `Fraction(float)` keeps the float's exact value. [^fractions]
- [`json` — JSON encoder and decoder](https://docs.python.org/3/library/json.html) — Python Software Foundation, living. Rank 1. Backs: the conversion table; string keys; repeated names; `allow_nan`; `ensure_ascii`; `array_hook`. [^json]
- [`csv` — CSV file reading and writing](https://docs.python.org/3/library/csv.html) — Python Software Foundation, living. Rank 1. Backs: `newline=''`; rows as lists of strings. [^csv]
- [`tomllib` — Parse TOML files](https://docs.python.org/3/library/tomllib.html) — Python Software Foundation, living. Rank 1. Backs: binary file required; no writing; TOML 1.1.0 in 3.15; added in 3.11. [^tomllib]
- [`struct` — Interpret bytes as packed binary data](https://docs.python.org/3/library/struct.html) — Python Software Foundation, living. Rank 1. Backs: native mode and padding versus `<`, `>`, `!`. [^struct]
- [`zlib` — Compression compatible with gzip](https://docs.python.org/3/library/zlib.html) — Python Software Foundation, living. Rank 1. Backs: `crc32` is not cryptographic. [^zlib]
- [`gzip` — Support for gzip files](https://docs.python.org/3/library/gzip.html) — Python Software Foundation, living. Rank 1. Backs: default mode `'rb'`; `compress()` defaults for `mtime` (3.14) and level (3.15). [^gzip]
- [`urllib.request` — Extensible library for opening URLs](https://docs.python.org/3/library/urllib.request.html) — Python Software Foundation, living. Rank 1. Backs: the Requests recommendation. [^urllib-request]
- [`http.server` — HTTP servers](https://docs.python.org/3/library/http.server.html) — Python Software Foundation, living. Rank 1. Backs: the command line, `--bind`, `--directory`, not for production, symlinks. [^http-server]
- [`array` — Efficient arrays of numeric values](https://docs.python.org/3/library/array.html) — Python Software Foundation, living. Rank 1. Backs: `typecodes` became a tuple in 3.15. [^array]
- [`collections` — Container datatypes: `deque`](https://docs.python.org/3/library/collections.html) — Python Software Foundation, living. Rank 1. Backs: deque costs; bounded deques. [^collections]
- [`bisect` — Array bisection algorithm](https://docs.python.org/3/library/bisect.html) — Python Software Foundation, living. Rank 1. Backs: sorted input; insertion cost; `key`; thread safety. [^bisect]
- [`heapq` — Heap queue algorithm](https://docs.python.org/3/library/heapq.html) — Python Software Foundation, living. Rank 1. Backs: min-heap invariant; `_max` functions in 3.14; ties in `(priority, task)` tuples. [^heapq]
- [What's new in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, 2025. Rank 1. Backs: JSON exception notes; the `compression` package and `compression.zstd`. [^whatsnew314]
- [What's new in Python 3.15](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: `profile` deprecated in favour of `profiling.tracing`. [^whatsnew315]

## Related
- `python/standard-library/regular-expressions.md` — the `re` module, the tour's string pattern matching.
- `python/standard-library/dates-and-times.md` — `datetime`, `zoneinfo` and the `time` clocks.
- `python/errors-and-resources/context-managers-and-file-io.md` — `open()`, encodings and `with`, which every file row above relies on.
- `floating-point/choosing-and-comparing-numbers.md` — when to pick `float`, `Decimal` or `Fraction`.
- `algorithms/data-structures/trees-heaps-and-b-trees.md` — how the binary heap behind `heapq` works.
- `python/modules-and-packaging/virtual-environments-and-packaging.md` — installing the third-party packages named here (Requests, Tomli-W, tzdata).
- `python/tooling/testing-debugging-and-profiling.md` — `logging`, `timeit`, `doctest`, `unittest` and the profilers.
