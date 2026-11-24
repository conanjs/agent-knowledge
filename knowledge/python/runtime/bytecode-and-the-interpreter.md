---
schema: knowledge-doc/v1
type: concept
topic: python/runtime
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, cpython, bytecode, dis, ast, tokenize, code-object, pyc, pycache, pep-552, pep-659, specializing-interpreter, jit, pep-744, tail-call-interpreter, frames]
ranked-sources: true
---

# Bytecode and the CPython interpreter

## Summary
**TL;DR:** CPython never runs `.py` text directly: it cuts the text into tokens, parses them into an abstract syntax tree (AST), compiles the tree into a code object that holds bytecode, and a C evaluation loop runs that bytecode on a stack. Imported modules keep their compiled form in `__pycache__/*.pyc`, checked against the source by timestamp or by hash. Since 3.11 the interpreter rewrites hot instructions into type-specialised forms; the experimental JIT (just-in-time) compiler exists only in builds configured for it, and the lab build does not have it.
**Use this when:** reading `dis` output, choosing how `.pyc` files are built and invalidated (reproducible builds, read-only installs), checking whether an interpreter has the JIT, or explaining why a loop got faster after it warmed up.
**Not this doc:** tracing, `sys.monitoring` and profilers → `python/tooling/testing-debugging-and-profiling.md`; reference counting and the cycle collector → `python/runtime/memory-management-and-garbage-collection.md`; how `import` finds a module → `python/modules-and-packaging/modules-packages-and-imports.md`; the GIL (global interpreter lock) → `python/concurrency/threads-processes-and-the-gil.md`.

## Problem
- A `dis` listing copied from an older article shows `BINARY_SUBSCR`, while 3.15 shows `BINARY_OP` with a subscript argument, `LOAD_FAST_BORROW` and `LOAD_SMALL_INT`, all of which changed in 3.14 ✅[^dis].
- A deployed service keeps running old code after its `.py` file was edited, because its `.pyc` files are "unchecked": Python assumes they are valid if they exist ✅[^import].
- Two builds of the same sources give different `.pyc` bytes, because the default header embeds the source's modification time ✅[^pep552].
- `ast.parse()` accepts code that `compile()` then rejects ✅[^ast].
- Setting `PYTHON_JIT=1` changes nothing, because the variable only acts on builds where the JIT is available ✅[^cmdline].

## Mental model
**Analogy:** a recipe translated into a factory work sheet. The tokenizer cuts the text into words; the parser draws the sentence diagram (the AST); the compiler writes numbered steps for a worker who has one tray (the stack): "put `price` on the tray, put `qty` on the tray, multiply the top two, store the result as `total`". The evaluation loop is the worker reading one step at a time. After running the same sheet many times the worker pencils notes on it ("these are always floats") and rubs them out when a guess turns out wrong: that is specialisation. The `.pyc` file is a photocopy of the work sheet kept in a drawer, with the recipe's date or fingerprint written on top.

**Artifact** (one line through every stage, measured in the lab ✅[^lab]):
```python
import ast, dis, io, tokenize
SRC = "total = price * qty\n"
for t in tokenize.generate_tokens(io.StringIO(SRC).readline):
    print(tokenize.tok_name[t.type], repr(t.string))
# one line per token: NAME 'total' | OP '=' | NAME 'price' | OP '*' | NAME 'qty' | NEWLINE '\n' | ENDMARKER ''
print(ast.dump(ast.parse(SRC)))
# Module(body=[Assign(targets=[Name(id='total', ctx=Store())], value=BinOp(left=Name(id='price'), op=Mult(), right=Name(id='qty')))])
code = compile(SRC, "<demo>", "exec")
print(code.co_names, code.co_consts)   # ('price', 'qty', 'total') (None,)
dis.dis(code)
#   0           RESUME                   0
#   1           LOAD_NAME                0 (price)
#               LOAD_NAME                1 (qty)
#               BINARY_OP                5 (*)
#               STORE_NAME               2 (total)
#               LOAD_COMMON_CONSTANT     7 (None)
#               RETURN_VALUE
exec(code, {"price": 2.5, "qty": 4})   # sets total = 10.0
```

## How it works
1. **Tokenize, then parse.** CPython's compilation runs five steps: tokenize the source, parse the tokens into an AST, turn the AST into an instruction sequence, build a control flow graph and optimise it, then emit bytecode ✅[^cpython-compiler]. The parser has been a PEG (parsing expression grammar) parser since 3.9 and reads tokens, not characters ✅[^cpython-compiler]. The `tokenize` module shows the token stream and returns every operator as the generic `OP` type ✅[^tokenize].
2. **The AST.** `ast.parse()` is `compile()` with the `ast.PyCF_ONLY_AST` flag; the result is a tree of `ast.AST` objects, and `compile()` turns such a tree into a code object ✅[^ast]. The abstract grammar itself may change with each release ✅[^ast]. Parsing does no scoping checks, so a tree can be valid while compiling it raises `SyntaxError` ✅[^ast].
3. **The code object.** Compilation builds a symbol table from the AST first, then generates code from it ✅[^cpython-compiler]. The result is immutable and carries no context: the function object, not the code object, holds the globals and the default argument values ✅[^datamodel]. Its main fields ✅[^datamodel]:
   - `co_varnames`: names of the local variables, parameters first.
   - `co_names`: names the bytecode uses (globals, attributes).
   - `co_consts`: the literals the bytecode uses; `LOAD_CONST i` pushes `co_consts[i]` ✅[^dis].
   - `co_code`: the instruction bytes; `co_stacksize`: the stack depth the code needs.
4. **The evaluation loop.** The interpreter is a stack machine: instructions push and pop object references on a stack that is part of the frame, pre-allocated to `co_stacksize` ✅[^cpython-interpreter]. Bytecode is an array of 16-bit code units, an 8-bit opcode plus an 8-bit argument, and the loop decodes one unit after another and runs the code for that opcode ✅[^cpython-interpreter]. The `dis` docs describe each instruction as an operation on a list called `STACK`; `BINARY_OP` pops `rhs`, then `lhs`, and pushes `lhs op rhs` ✅[^dis]. The glossary calls this software computer the virtual machine ✅[^glossary].
5. **Reading `dis`.** In the lab output each line shows the source line number, a jump label when one targets it, the opcode name, its argument, and the argument's meaning in parentheses ✅[^lab]. Since 3.13 jump targets are shown as labels (`L1`) instead of offsets ✅[^dis]. Inline cache entries (`CACHE`) are hidden unless `show_caches=True` ✅[^dis]. Bytecode is a CPython implementation detail: instructions may be added, removed or changed between versions, so `dis` output is not portable across releases ✅[^dis]. Recent renames: `LOAD_FAST_BORROW` and `LOAD_SMALL_INT` (an integer in `range(256)` carried in the argument) were added in 3.14, and `BINARY_OP` with `NB_SUBSCR` replaced `BINARY_SUBSCR` in 3.14 ✅[^dis].
6. **`.pyc` files.** Importing a module caches its compiled form as `__pycache__/<module>.<tag>.pyc` ✅[^tut-modules]; the tag comes from `sys.implementation.cache_tag` ✅[^importlib], which is `cpython-315` in the lab ✅[^lab]. The header is four 32-bit words: the magic number (the bytecode format version), a bit field, then either the source timestamp and size (bit field 0) or a 64-bit hash of the source (lowest bit set; the next bit is the `check_source` flag) ✅[^pep552]. Before loading a `.pyc`, the import system checks it against the source: by default it compares the stored timestamp and size; a checked hash-based file is validated by hashing the source; an unchecked one is assumed valid ✅[^import]. `importlib.util.MAGIC_NUMBER` holds the bytecode version bytes ✅[^importlib]; in the lab it was `b'R\x0e\r\n'`, every `.pyc` started with it, and the bit field read `0`, `3` and `1` for timestamp, checked-hash and unchecked-hash files ✅[^lab]. A `.pyc` does not make the program run faster, only load faster ✅[^tut-modules].
   - `py_compile.compile()` writes one file and `python -m compileall` a whole tree; both default to timestamp mode, or to checked hash when `SOURCE_DATE_EPOCH` is set ✅[^py_compile] ✅[^compileall].
   - `--check-hash-based-pycs always|never` overrides hash validation; timestamp files are unaffected ✅[^cmdline]. `-B` (or `sys.dont_write_bytecode`) stops writing `.pyc` files, and `sys.pycache_prefix` moves them to a separate tree ✅[^sys].
7. **The specialising adaptive interpreter (PEP 659, 3.11; PEP = Python Enhancement Proposal).** Instructions that can benefit are replaced by an adaptive form; once one has run enough times it is replaced by a specialised instruction for the types it saw. A specialised instruction checks its inputs each time, runs the generic operation when they are not as expected, and after enough misses is turned back into the adaptive form ✅[^pep659]. The PEP describes the mechanism and warns that its details may change ✅[^pep659]. Specialisation is only tried on "hot" code, and certain instruction pairs are combined into superinstructions ✅[^whatsnew311]. The extra data lives in inline cache entries after the instruction ✅[^pep659]. `dis.dis(f, adaptive=True)` (or `python -m dis -S`, 3.14) shows the specialised bytecode ✅[^dis]. Programs cannot see the change except through timing, debugging tools or memory use ✅[^pep659]; 3.11 measured a 1.25x average speed-up over 3.10 ✅[^whatsnew311].
8. **The experimental JIT (PEP 744).** Added in 3.13 behind `--enable-experimental-jit`: hot specialised bytecode is translated into "Tier 2" micro-operations, optimised, and, when the JIT is on, turned into machine code with the copy-and-patch technique, which needs LLVM at build time but nothing at run time ✅[^whatsnew313]. The configure option takes `no` (the default), `yes`, `yes-off` (built but off until `PYTHON_JIT=1`) and `interpreter` ✅[^configure]. `sys._jit.is_available()` says whether the executable supports it, `is_enabled()` whether it is on in this process, `is_active()` whether the topmost frame runs JIT code (all added in 3.14) ✅[^sys].
   - 3.14: the official macOS and Windows binaries include the JIT, off unless `PYTHON_JIT=1`; the impact ranged from 10% slower to 20% faster, and free-threaded builds do not support it ✅[^whatsnew314].
   - 3.15: an upgraded JIT with a new tracing frontend and register allocation; pyperformance (the standard benchmark suite) reports a 7–8% geometric-mean gain on x86-64 Linux and 11–12% over the tail-calling interpreter on AArch64 macOS ✅[^whatsnew315].
   - Until it is declared non-experimental it should not be used in production ✅[^pep744].
9. **The tail-calling interpreter (3.14, a build option).** Instead of one large C `switch`, each opcode is a small C function and they call each other with tail calls; in 3.14 it worked only with Clang 19 or newer on x86-64 and AArch64, gave 3–5% on pyperformance, was opt-in through `--with-tail-call-interp`, and changes no visible behaviour ✅[^whatsnew314]. It is not tail-call optimisation of Python functions, which CPython does not implement ✅[^whatsnew314]. In 3.15 the official Windows 64-bit binaries use it ✅[^whatsnew315]. The lab's Homebrew build was configured with `--with-tail-call-interp`, and `sysconfig.get_config_var("_Py_TAIL_CALL_INTERP")` returns `1` ✅[^lab].
10. **Frames.** A frame object represents one running call: `f_code` is its code object, `f_back` the caller's frame, `f_locals` its local namespace, `f_lineno` the current line ✅[^datamodel]. `sys._getframe(depth)` returns a frame from the call stack and is CPython-only ✅[^sys]; `inspect.currentframe()` returns the caller's frame, or `None` on implementations without frame support ✅[^inspect]. Since 3.11 frame objects are only created when something such as these functions asks for one ✅[^whatsnew311]. Holding a frame can create a reference cycle, so delete it in a `finally` clause ✅[^inspect]. In the lab, inside `inner()` called from `outer()`, `sys._getframe() is inspect.currentframe()` was `True` and `f_back.f_code.co_name` was `'outer'` ✅[^lab].

## Worked example
One function, `scale`, compiled from a string so its lines are numbered 1–5, inspected before and after a warm-up, all measured in the lab ✅[^lab]:

```python
def scale(values, factor):          # line 1
    total = 0                       # line 2
    for v in values:                # line 3
        total += v * factor         # line 4
    return round(total, 2)          # line 5
```

| Step | What was run | Result |
|---|---|---|
| 1 | `scale.__code__.co_varnames`, `co_names`, `co_consts` | `('values', 'factor', 'total', 'v')`, `('round',)`, `(0,)` |
| 2 | `co_argcount`, `co_nlocals`, `co_stacksize`, `len(co_code)` | `2`, `4`, `5`, `82` |
| 3 | `dis.dis(scale)` (cold) | line 4 is `LOAD_FAST_BORROW_LOAD_FAST_BORROW 35 (total, v)`, `LOAD_FAST_BORROW 1 (factor)`, `BINARY_OP 5 (*)`, `BINARY_OP 13 (+=)`, `STORE_FAST 2 (total)`, `JUMP_BACKWARD 20 (to L1)` |
| 4 | 2,000 calls `scale([1.5, 2.5, 3.0] * 10, 3.0)`, then `dis.dis(scale, adaptive=True)` | see the table below; the call returns `210.0` |
| 5 | 2,000 more calls with `list(range(30))` and `3` | the two `BINARY_OP` lines became `BINARY_OP_MULTIPLY_INT` and `BINARY_OP_ADD_INT` |

| Line | Cold bytecode | After float calls | After int calls |
|---|---|---|---|
| 1 | `RESUME` | `RESUME_CHECK` | `RESUME_CHECK` |
| 3 | `GET_ITER`, `FOR_ITER` | `GET_ITER_VIRTUAL`, `FOR_ITER_LIST` | unchanged |
| 4 | `BINARY_OP 5 (*)` | `BINARY_OP_MULTIPLY_FLOAT` | `BINARY_OP_MULTIPLY_INT` |
| 4 | `BINARY_OP 13 (+=)` | `BINARY_OP_ADD_FLOAT` | `BINARY_OP_ADD_INT` |
| 4 | `JUMP_BACKWARD` | `JUMP_BACKWARD_NO_JIT` | unchanged |
| 5 | `LOAD_GLOBAL 1 (round + NULL)` | `LOAD_GLOBAL_BUILTIN` | unchanged |
| 5 | `CALL 2` | `CALL_BUILTIN_FAST_WITH_KEYWORDS` | unchanged |

Reading it: `35` packs two local indexes, `2 << 4 | 3`, so one superinstruction pushes `total` and `v` ✅[^dis]. `round` sits in `co_names` because `LOAD_GLOBAL` looks its name up there ✅[^dis], and `LOAD_GLOBAL_BUILTIN` is the specialised form for a value found in the builtins ✅[^pep659]. The float-specialised operations switched to the int forms once the inputs changed type, which is the "adaptive" half of PEP 659 ✅[^pep659]. `JUMP_BACKWARD_NO_JIT` is what this build, which has no JIT, specialised the loop's back-jump into ✅[^lab].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `compile(ast.parse("return 42"), "<s>", "exec")` | `ast.parse` succeeds; `compile` raises `SyntaxError: 'return' outside function` ✅[^lab] | Parsing does no scoping checks; compiling does ✅[^ast] |
| Unchecked-hash `.pyc`, then the source edited from `VALUE = 1` to `VALUE = 2` | A new process still imports `1`; with `--check-hash-based-pycs always` it imports `2` ✅[^lab] | Unchecked files are assumed valid if they exist ✅[^import] |
| Timestamp `.pyc`, then the source edited | The next import sees the new value (`22`) ✅[^lab] | The stored modification time (mtime) and size no longer match ✅[^import] |
| A script run as `python3.15 -I main_script.py` | No `main_script.cpython-315.pyc` is written ✅[^lab] | The module loaded directly from the command line is always recompiled and never cached ✅[^tut-modules] |
| `PYTHON_JIT=1` on the lab build | `sys._jit.is_available()` and `is_enabled()` stay `False` ✅[^lab] | The variable only acts where the JIT was built in ✅[^cmdline] |
| `PYTHON_JIT` or any `PYTHON*` variable with `-I` or `-E` | Ignored ✅[^cmdline] | `-E` ignores all `PYTHON*` environment variables, and `-I` implies it |
| Branching on `sys._jit.is_active()` in a hot loop | Can give contradictory results ✅[^sys] | Entering or leaving JIT code changes the answer; it is meant only for testing the JIT itself |
| `LOAD_COMMON_CONSTANT 7 (None)` ends a module in 3.15.2 ✅[^lab] | The 3.15 docs describe a hardcoded list of constants and name only `assert` loading `AssertionError` as a use ✅[^dis] | Opcode docs can lag the interpreter; trust `dis` on the running version |
| `sys._getframe(10_000)` | `ValueError: call stack is not deep enough` ✅[^lab] | Asking deeper than the stack raises `ValueError` ✅[^sys] |
| `py_compile.compile()` when the target `.pyc` path is a symlink | `FileExistsError` ✅[^py_compile] | Import replaces the file by renaming, which would turn the link into a regular file |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Timestamp `.pyc` (default) | Cheap check: compare metadata ✅[^import] | Output depends on the source mtime, so builds are not reproducible ✅[^pep552] |
| Checked-hash `.pyc` | Deterministic bytes; edits are still detected ✅[^pep552] | Every import reads and hashes the source ✅[^pep552] |
| Unchecked-hash `.pyc` | No source check at all | Stale code unless an outside system keeps the files current ✅[^py_compile] |
| A JIT-enabled build | 7–8% to 11–12% geometric mean on pyperformance in 3.15, depending on platform ✅[^whatsnew315] | Experimental, not for production ✅[^pep744]; not available in free-threaded builds in 3.14 ✅[^whatsnew314] |

## Takeaways
- Never assert on opcode names or `dis` output without pinning the CPython version; bytecode changes between releases. [rule-candidate]
- For reproducible builds, generate checked-hash `.pyc` files (`compileall --invalidation-mode checked-hash`, or set `SOURCE_DATE_EPOCH`). [rule-candidate]
- Use unchecked-hash `.pyc` files only when a package manager regenerates them on every source change.
- Check for the JIT with `sys._jit.is_available()` and `sys._jit.is_enabled()`, not by setting `PYTHON_JIT` and timing.
- To see whether a hot loop specialised, warm it up, run `dis.dis(f, adaptive=True)` and compare it with the cold listing.
- Delete frame references in a `finally` block after `sys._getframe()` or `inspect.currentframe()`. [rule-candidate]

## Verification status
- Verified: 91 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [dis — Disassembler for Python bytecode](https://docs.python.org/3/library/dis.html) — Python Software Foundation, living. Rank 1. Backs: bytecode as an implementation detail, `STACK` semantics, `BINARY_OP`, `LOAD_CONST`, `LOAD_SMALL_INT`, `LOAD_FAST_BORROW`, labels, caches, `adaptive=True`, `-S`, `LOAD_COMMON_CONSTANT`. [^dis]
- [ast — Abstract syntax trees](https://docs.python.org/3/library/ast.html) — Python Software Foundation, living. Rank 1. Backs: `ast.parse` as `compile` with `PyCF_ONLY_AST`, grammar changes per release, no scoping checks. [^ast]
- [tokenize — Tokenizer for Python source](https://docs.python.org/3/library/tokenize.html) — Python Software Foundation, living. Rank 1. Backs: operators returned as `OP`. [^tokenize]
- [Data model: Code objects, Frame objects](https://docs.python.org/3/reference/datamodel.html) — Python Software Foundation, living. Rank 1. Backs: code object fields and immutability; frame attributes. [^datamodel]
- [The import system: Cached bytecode invalidation](https://docs.python.org/3/reference/import.html) — Python Software Foundation, living. Rank 1. Backs: timestamp, checked and unchecked hash validation. [^import]
- [importlib: importlib.util](https://docs.python.org/3/library/importlib.html) — Python Software Foundation, living. Rank 1. Backs: `cache_from_source` and `cache_tag`. [^importlib]
- [py_compile — Compile Python source files](https://docs.python.org/3/library/py_compile.html) — Python Software Foundation, living. Rank 1. Backs: `PycInvalidationMode`, the `SOURCE_DATE_EPOCH` default, `FileExistsError` on symlinks. [^py_compile]
- [compileall — Byte-compile Python libraries](https://docs.python.org/3/library/compileall.html) — Python Software Foundation, living. Rank 1. Backs: `--invalidation-mode` and its default. [^compileall]
- [Modules: "Compiled" Python files](https://docs.python.org/3/tutorial/modules.html) — Python Software Foundation, living. Rank 1. Backs: `__pycache__` naming, the main script is not cached, `.pyc` only loads faster. [^tut-modules]
- [sys — System-specific parameters and functions](https://docs.python.org/3/library/sys.html) — Python Software Foundation, living. Rank 1. Backs: `_getframe`, `_jit`, `dont_write_bytecode`, `pycache_prefix`. [^sys]
- [inspect: The interpreter stack](https://docs.python.org/3/library/inspect.html) — Python Software Foundation, living. Rank 1. Backs: `currentframe()`, deleting frames in `finally`. [^inspect]
- [Glossary: bytecode, virtual machine](https://docs.python.org/3/glossary.html) — Python Software Foundation, living. Rank 1. Backs: the virtual machine runs bytecode. [^glossary]
- [Command line and environment](https://docs.python.org/3/using/cmdline.html) — Python Software Foundation, living. Rank 1. Backs: `PYTHON_JIT`, `-E`, `-B`, `--check-hash-based-pycs`. [^cmdline]
- [Configure Python: Performance options](https://docs.python.org/3/using/configure.html) — Python Software Foundation, living. Rank 1. Backs: `--enable-experimental-jit` values. [^configure]
- [What's New In Python 3.11: Faster CPython](https://docs.python.org/3/whatsnew/3.11.html) — Python Software Foundation, 2022. Rank 1. Backs: hot-code specialisation, superinstructions, 1.25x, lazy frames. [^whatsnew311]
- [What's New In Python 3.13: An experimental just-in-time (JIT) compiler](https://docs.python.org/3/whatsnew/3.13.html) — Python Software Foundation, 2024. Rank 1. Backs: Tier 2 micro-ops, copy-and-patch, LLVM at build time. [^whatsnew313]
- [What's new in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, 2025. Rank 1. Backs: JIT in official binaries, its range of impact, the tail-calling interpreter. [^whatsnew314]
- [What's new in Python 3.15](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: the upgraded JIT's results; tail-calling interpreter in Windows binaries. [^whatsnew315]
- [PEP 552 – Deterministic pycs](https://peps.python.org/pep-0552/) — Benjamin Peterson, 2017. Rank 1. Backs: the four-word header, hash-based pycs, reproducibility. [^pep552]
- [PEP 659 – Specializing Adaptive Interpreter](https://peps.python.org/pep-0659/) — Mark Shannon, 2021. Rank 1. Backs: adaptive and specialised instructions, de-optimisation, inline data cache, `LOAD_GLOBAL_BUILTIN`, invisibility to programs. [^pep659]
- [PEP 744 – JIT Compilation](https://peps.python.org/pep-0744/) — Brandt Bucher, Savannah Ostrowski, 2024. Rank 1. Backs: not for production while experimental. [^pep744]
- [CPython InternalDocs: Compiler design](https://github.com/python/cpython/blob/main/InternalDocs/compiler.md) — CPython core developers, living. Rank 1. Backs: the five compilation steps, the PEG parser, the symbol table. [^cpython-compiler]
- [CPython InternalDocs: The bytecode interpreter](https://github.com/python/cpython/blob/main/InternalDocs/interpreter.md) — CPython core developers, living. Rank 1. Backs: stack machine, `co_stacksize`, 16-bit code units, the decode loop. [^cpython-interpreter]

## Related
- `python/tooling/testing-debugging-and-profiling.md` — `sys.monitoring`, tracing and profilers built on frames and code objects.
- `python/runtime/memory-management-and-garbage-collection.md` — reference counts and why frame cycles matter.
- `python/modules-and-packaging/modules-packages-and-imports.md` — how `import` finds the module whose `.pyc` is cached.
- `python/concurrency/threads-processes-and-the-gil.md` — the lock that lets one thread run bytecode at a time.
- `python/fundamentals/functions-scopes-and-closures.md` — the scopes the symbol table decides.
