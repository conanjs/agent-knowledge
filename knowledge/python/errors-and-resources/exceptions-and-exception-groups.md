---
schema: knowledge-doc/v1
type: concept
topic: python/errors-and-resources
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, exceptions, try, except, finally, raise, exception-chaining, add-note, exceptiongroup, except-star, pep-654, pep-758, pep-765, warnings, eafp]
ranked-sources: true
---

# Exceptions, exception chaining and exception groups

## Summary
**TL;DR:** An exception is an object that, once raised, travels up the call stack until an `except` clause names its class or one of its base classes; `else` runs only when the `try` body raised nothing, and `finally` runs on every way out, `return` included. `except Exception` deliberately misses `KeyboardInterrupt` and `SystemExit`, which derive from `BaseException` directly. A new exception raised while another is being handled records the old one in `__context__`, or in `__cause__` with `raise … from err`; `from None` hides the old one from the printed traceback. An `ExceptionGroup` carries several unrelated failures at once, and `except*` splits it by type, each clause taking its share once.
**Use this when:** a `try` statement runs a clause you did not expect, Ctrl-C or `sys.exit()` slips past a handler, a traceback shows two exceptions and you need to know which caused which, several failures must be reported together, or Python 3.14+ prints a `SyntaxWarning` about `finally`.
**Not this doc:** where to handle an error and what context to add → `error-handling/handle-errors-once.md`; which errors a library should expose → `error-handling/library-vs-application-errors.md`; `with` and closing files → `python/errors-and-resources/context-managers-and-file-io.md`; task groups that raise exception groups → `python/concurrency/asyncio-coroutines-and-tasks.md`; reading tracebacks in a debugger → `python/tooling/testing-debugging-and-profiling.md`; writing classes → `python/classes/classes-instances-and-inheritance.md`.

## Problem
Exception code that looks right often does something else:
- A `try: … except Exception:` around a long loop does not stop Ctrl-C or `sys.exit(3)` from ending the program.
- A `return` inside `finally` throws away the exception that was on its way out, so a failing function returns `42` as if nothing happened.
- After `except ZeroDivisionError as e:`, reading `e` on the next line raises `NameError`, even when `e` had a value before the `try`.
- A traceback prints two errors joined by "During handling of the above exception, another exception occurred", and the reader fixes the wrong one.
- `except TypeError, ValueError:` is valid in 3.14, but adding `as e` to it is a `SyntaxError`.
- A batch job meets three independent failures; raising only the first hides the other two.

## Mental model
**Analogy:** raising an exception is pulling a fire alarm on one floor of a building, where each floor is a function that is still running. The alarm climbs floor by floor until it reaches a warden trained for that kind of alarm (a matching `except` clause); the warden deals with it, and work resumes after that warden's desk. A `finally` clause is the rule "switch off the lights on your way out": it runs whether you leave calmly, by `return`, or because the alarm is passing through. Chaining staples the earlier incident report to the new one. An exception group is a folder of reports from several rooms; `except*` is a sorting desk where each warden takes out the reports of their kind, and the rest go further up.

**Artifact** (measured in the lab ✅[^lab]):
```python
def run(x):
    log = []
    try:
        log.append("try"); r = 10 / x
    except ZeroDivisionError:
        log.append("except")
    else:
        log.append("else")
    finally:
        log.append("finally")
    return log
run(2)                 # ['try', 'else', 'finally']
run(0)                 # ['try', 'except', 'finally']

try:
    raise ExceptionGroup("batch", [ValueError(1), TypeError(2), OSError(3)])
except* OSError as g:
    print(repr(g))     # ExceptionGroup('batch', [OSError(3)])
except* TypeError as g:
    print(repr(g))     # ExceptionGroup('batch', [TypeError(2)])
# nothing took ValueError(1): ExceptionGroup('batch', [ValueError(1)]) propagates
```

## How it works
1. **Syntax errors stop the code before it runs; exceptions happen while it runs.** The parser rejects `while True print('x')` with `SyntaxError: invalid syntax` and points at the place it noticed the problem, which is not always the place to fix ✅[^tut-errors]. An exception is an error detected while running code that is syntactically correct, such as `10 * (1/0)` raising `ZeroDivisionError` ✅[^tut-errors]. Every exception is an instance of a class derived from `BaseException` ✅[^exceptions]. `SyntaxError` is itself a subclass of `Exception`, so code that compiles other code with `compile()` can catch it ✅[^lab].

2. **The order of a `try` statement.**
   - The `try` body runs. If it raises nothing, every `except` clause is skipped ✅[^tut-errors].
   - If it raises, the rest of the body is skipped and the `except` clauses are tested in order; the first match runs, and at most one handler runs ✅[^tut-errors]. A handler also catches exceptions raised in functions the body called, even indirectly ✅[^tut-errors].
   - `else` runs only when control leaves the body with no exception and no `return`, `break` or `continue`; an exception raised inside `else` is not handled by the same statement's `except` clauses ✅[^compound]. Code placed in `else` instead of the body cannot be caught by mistake by a handler meant for the body ✅[^tut-errors].
   - `finally` runs last, on every exit: an unhandled exception is saved, `finally` runs, and the saved exception is re-raised at its end; a `return`, `break` or `continue` in the body also runs `finally` on the way out ✅[^compound]. In the lab a `finally` appended to a list after `return log` had already been chosen, and the caller saw the append ✅[^lab].
   - If no clause matches, the search continues in the surrounding code and up the call stack (the chain of functions waiting for each other to return) ✅[^compound]; if nothing handles it, the program stops with a traceback, the printed list of those calls ✅[^tut-errors].

3. **Matching is by class, base classes included.** The expression after `except` must evaluate to an exception class or a tuple of them, and it matches the raised object's class or any non-virtual base class of it ✅[^compound]. So `except ValueError` caught a `UnicodeDecodeError` in the lab ✅[^lab], and if `except B` comes before `except D` where `D` derives from `B`, the `B` clause wins every time ✅[^tut-errors]. A bare `except:` matches any exception and must be last ✅[^compound]; in the lab it caught `SystemExit(2)` ✅[^lab].
   - **Several types.** `except (TypeError, ValueError):` always worked. Since 3.14 the parentheses may be dropped when several types are listed and no `as` clause is used (PEP 758; PEP = Python Enhancement Proposal) ✅[^compound]. In the lab `except TypeError, ValueError:` ran, and `except TypeError, ValueError as e:` failed to compile with `SyntaxError: multiple exception types must be parenthesized when using 'as'` ✅[^lab]. The same applies to `except*`, and the unparenthesised form does not bring back Python 2's meaning, where the second name was the capture variable ✅[^pep758].

4. **`BaseException` versus `Exception`.** `BaseException` is the root class; `Exception` is the base of every built-in exception that does not exit the program, and user-defined exceptions should derive from it ✅[^exceptions]. `SystemExit` (raised by `sys.exit()`), `KeyboardInterrupt` (Ctrl-C), `GeneratorExit` and `BaseExceptionGroup` sit directly under `BaseException` ✅[^exceptions], so that a handler for `Exception` does not stop the interpreter from exiting ✅[^exceptions]. In the lab, `sys.exit(3)` passed through `except Exception` and was caught only by `except BaseException`, with `code` equal to `3`; a `KeyboardInterrupt` triggered by sending the process a real SIGINT signal with `os.kill()` passed through the same way ✅[^lab]. Because `KeyboardInterrupt` can arrive at unpredictable points, it is generally best to let it end the program ✅[^exceptions].

5. **Raising and re-raising.** `raise X` needs an instance or a subclass of `BaseException`; a class is instantiated with no arguments, so `raise ValueError` raises `ValueError()` ✅[^raise]. A bare `raise` re-raises the exception being handled (the "active exception"), and raises `RuntimeError` when there is none ✅[^raise]; the message in 3.15.2 is `No active exception to reraise` ✅[^lab]. The usual shape of a broad handler is to log the exception, then re-raise it so a caller can handle it too ✅[^tut-errors].

6. **Chaining records how one failure led to another.**
   - Raising a new exception while another is being handled (in `except`, in `finally`, or inside a `with` block) sets the new one's `__context__` to the old one automatically ✅[^exceptions]. The traceback joins them with "During handling of the above exception, another exception occurred" ✅[^tut-errors].
   - `raise New(...) from err` stores `err` in `__cause__` and also sets `__suppress_context__` to `True` ✅[^exceptions]; the traceback says "The above exception was the direct cause of the following exception" ✅[^raise].
   - `raise New(...) from None` hides the old exception from the display while keeping it in `__context__` for debugging ✅[^exceptions].
   - Display rule: `__cause__` is always shown when set; `__context__` is shown only when `__cause__` is `None` and `__suppress_context__` is false; the last line always names the last exception raised ✅[^exceptions].

   Raising `LookupError` inside `except KeyError` gave these values in the lab ✅[^lab]:

   | Form | `__cause__` | `__context__` | `__suppress_context__` |
   |---|---|---|---|
   | `raise LookupError("…")` | `None` | `KeyError('port')` | `False` |
   | `raise LookupError("…") from err` | `KeyError('port')` | `KeyError('port')` | `True` |
   | `raise LookupError("…") from None` | `None` | `KeyError('port')` | `True` |

7. **Notes add context after the fact.** Since 3.11, `e.add_note(text)` appends a string to `e.__notes__`, a list created by the first call; the standard traceback prints the notes after the exception message, in the order added; a non-string raises `TypeError` ✅[^exceptions]. Notes are meant for people reading the traceback; data a program needs back belongs in an attribute of its own ✅[^pep678].

8. **Exception groups bundle unrelated failures.** `ExceptionGroup(msg, excs)` wraps a list of exception instances so they can be raised together, and is itself an exception ✅[^tut-errors]. `ExceptionGroup` extends `Exception` and may wrap only `Exception` subclasses; `BaseExceptionGroup` extends `BaseException` and may wrap anything, and its constructor returns an `ExceptionGroup` when every member is an `Exception` ✅[^exceptions]. `.exceptions` is the tuple of members; `split(condition)` returns `(match, rest)`, and `subgroup(condition)` returns only the match, or `None` when it is empty; both keep the nesting and copy `message`, `__traceback__`, `__cause__`, `__context__` and `__notes__` ✅[^exceptions]. A "leaf" is a member that is not itself a group, and splitting by type tests the leaves ✅[^pep654].

9. **`except*` hands each clause its share** ✅[^compound]:
   1. The first `except*` clause splits the raised group into the part matching its type and the rest.
   2. If the matching part is not empty, it becomes the handled exception (the `as` target, and the value of `sys.exception()`), and the clause body runs.
   3. The rest goes to the next `except*` clause in the same way, until nothing is left or the clauses run out.
   4. Whatever no clause took is merged with any exception raised or re-raised inside the clauses, and that group propagates.

   Each `except*` clause runs at most once, receiving every matching leaf in one group ✅[^pep654]. A nested group splits along its nesting (measured in the lab ✅[^lab]):
   ```
   raised:              ExceptionGroup('batch', [ValueError(1), TypeError(2), OSError(3), ExceptionGroup('inner', [OSError(4), KeyError(5)])])
   except* OSError ->   ExceptionGroup('batch', [OSError(3), ExceptionGroup('inner', [OSError(4)])])
   except* TypeError -> ExceptionGroup('batch', [TypeError(2)])
   propagates:          ExceptionGroup('batch', [ValueError(1), ExceptionGroup('inner', [KeyError(5)])])
   ```
   A single exception that is not a group, raised in the body and matched by an `except*` clause, is wrapped in a group with an empty message, so the target is always a group ✅[^compound]: `BlockingIOError` arrived as `ExceptionGroup('', (BlockingIOError(),))`, and a `ValueError` matched by no clause propagated unwrapped ✅[^lab]. One `try` may use `except` or `except*`, not both; `except*:` without a type is a syntax error; matching on a subclass of `BaseExceptionGroup` raises `TypeError`; `break`, `continue` and `return` cannot appear in an `except*` clause ✅[^compound].

10. **Handler state.** Inside an `except` or `except*` clause, `sys.exception()` (added in 3.11) returns the exception being handled, the innermost one when handlers nest, and `None` outside any handler ✅[^sys]. The older `sys.exc_info()` returns `(type(e), e, e.__traceback__)` ✅[^sys]. At the end of `except E as N:` the name `N` is deleted, as if the body were wrapped in `try: … finally: del N`, because the exception's traceback refers to the running frame and would form a reference cycle that keeps every local variable of the frame alive until the next garbage collection ✅[^compound]. To keep the exception, assign it to another name inside the clause ✅[^compound].

11. **`return`, `break` or `continue` in `finally`.** Any of them discards the saved exception, and a `return` there replaces the body's return value ✅[^compound]. Since 3.14 the compiler emits a `SyntaxWarning` when one of them would leave a `finally` block (PEP 765) ✅[^whatsnew314]; the language spec also allows other implementations to make it a `SyntaxError` ✅[^pep765]. CPython raises the warning when it builds the syntax tree, so it shows during compilation, not when already-compiled bytecode runs ✅[^pep765]. In the lab, compiling `try: 1/0` with `finally: return 42` warned `'return' in a 'finally' block`, calling the function returned `42` with the `ZeroDivisionError` gone, and a `return` inside a function defined within the `finally` block did not warn ✅[^lab].

12. **Custom exceptions.** Derive them from `Exception`, directly or through a base class of your own; they are usually kept simple, often just attributes a handler can read, and most names end in "Error" like the standard ones ✅[^tut-errors]. Subclass only one built-in exception type at a time, because the bases may handle `args` differently and, as a CPython implementation detail, may have incompatible memory layouts ✅[^exceptions].

13. **Warnings report problems that should not stop the program.** `warnings.warn(message, category)` issues one; the default category is `UserWarning`, and `stacklevel=2` makes the message point at the caller of the function that warns ✅[^warnings]. Every category subclasses `Warning`, which subclasses `Exception` ✅[^warnings]. An ordered filter list decides for each warning whether to ignore it, print it, or raise it as an exception (`"error"`); in release builds the default filters show `DeprecationWarning` only when triggered by code in `__main__`, and ignore `PendingDeprecationWarning`, `ImportWarning` and `ResourceWarning` ✅[^warnings]. The lab's default filter list was exactly those entries ✅[^lab]. Filters come from `-W` (for example `-W error::DeprecationWarning`), `PYTHONWARNINGS` or `warnings.filterwarnings()`, and tests can capture warnings with `warnings.catch_warnings(record=True)` ✅[^warnings].

## Worked example
Loading a config dict, reporting every bad key at once instead of the first one. Run in the lab ✅[^lab]:
```python
class ConfigError(Exception):
    """A config value is present but invalid."""

def parse_port(raw):
    try:
        port = int(raw)
    except ValueError as err:
        raise ConfigError(f"port must be an integer, got {raw!r}") from err
    if not 1 <= port <= 65535:
        raise ConfigError(f"port out of range: {port}")
    return port

def parse_workers(raw):
    n = int(raw)
    if n < 1:
        raise ConfigError(f"workers must be >= 1, got {n}")
    return n

def load(cfg):
    errors, result = [], {}
    for key, parse in [("port", parse_port), ("workers", parse_workers), ("host", str)]:
        try:
            result[key] = parse(cfg[key])
        except (ConfigError, KeyError) as e:     # parentheses: required with `as`
            e.add_note(f"while loading key {key!r}")
            errors.append(e)
    if errors:
        raise ExceptionGroup("invalid config", errors)
    return result

try:
    load({"port": "80a", "workers": "0"})
except* ConfigError as g:
    ...                                          # step 6
except* KeyError as g:
    ...                                          # step 7
```

| Step | What runs | Value in the lab |
|---|---|---|
| 1 | `load({"port": "8080", "workers": "4", "host": "db1"})` | `{'port': 8080, 'workers': 4, 'host': 'db1'}` |
| 2 | `int("80a")` fails in `parse_port`, which raises `ConfigError(...) from err` | `__cause__` is `ValueError("invalid literal for int() with base 10: '80a'")` |
| 3 | `parse_workers("0")` raises without `from` | `__cause__` is `None` |
| 4 | `cfg["host"]` is missing | `KeyError('host')` |
| 5 | each handler adds a note and keeps the error | `["while loading key 'port'"]`, `["while loading key 'workers'"]`, `["while loading key 'host'"]` |
| 6 | `except* ConfigError` runs once | `ExceptionGroup('invalid config', [ConfigError("port must be an integer, got '80a'"), ConfigError('workers must be >= 1, got 0')])` |
| 7 | `except* KeyError` runs once | `ExceptionGroup('invalid config', [KeyError('host')])` |
| 8 | both clauses took their share | nothing propagates |

Printed alone, step 2's error shows the `ValueError` traceback, then "The above exception was the direct cause of the following exception:", then `ConfigError: port must be an integer, got '80a'` as the last line ✅[^lab]. Steps 6 and 7 show the split of How it works 9 on real data: the caller decides per type, and no failure is lost.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `except Exception:` around `sys.exit(3)` or Ctrl-C | Not caught ✅[^lab] | `SystemExit` and `KeyboardInterrupt` derive from `BaseException` directly ✅[^exceptions] |
| Bare `raise` with nothing being handled | `RuntimeError: No active exception to reraise` ✅[^lab] | There is no active exception to re-raise ✅[^raise] |
| `raise ValueError("x") from 5` | `TypeError: exception causes must derive from BaseException` ✅[^lab] | `from` takes an exception or `None` ✅[^exceptions] |
| `except TypeError, ValueError as e:` | `SyntaxError` at compile time ✅[^lab] | PEP 758 keeps parentheses mandatory with `as` ✅[^pep758] |
| `except* ExceptionGroup:` | `TypeError: catching ExceptionGroup with except* is not allowed. Use except instead.` ✅[^lab] | Matching on a group type would be ambiguous ✅[^compound] |
| `except` and `except*` on one `try` | `SyntaxError: cannot have both 'except' and 'except*' on the same 'try'` ✅[^lab] | The grammar allows one kind per statement ✅[^compound] |
| `raise KeyError(...)` inside `except* ValueError` while a `TypeError` is unhandled | `ExceptionGroup('', [KeyError('raised in handler'), ExceptionGroup('eg', [TypeError('b')])])` propagates ✅[^lab] | Raised exceptions are merged with the unhandled rest ✅[^compound] |
| `ExceptionGroup("x", [KeyboardInterrupt()])` | `TypeError: Cannot nest BaseExceptions in an ExceptionGroup` ✅[^lab] | Use `BaseExceptionGroup` for non-`Exception` members ✅[^exceptions] |
| `ExceptionGroup("x", [])`, or a class as a member | `ValueError: second argument (exceptions) must be a non-empty sequence`, or `ValueError: Item 0 of second argument (exceptions) is not an exception` ✅[^lab] | Members must be exception instances, not types ✅[^tut-errors] |
| `return` in `finally`, compiled with `-W error` | `SyntaxError: 'return' in a 'finally' block` ✅[^lab] | The warning becomes an error; PEP 765 notes code run with `-We` may stop working ✅[^pep765] |
| `warnings.filterwarnings("ignore", category=SyntaxWarning)` at runtime | Silences only code compiled afterwards; modules imported earlier already warned | The warning is issued at compile time ✅[^whatsnew314] |
| `sys.exception()` inside `finally` while an exception propagates | Returned `ValueError('pending')` in CPython 3.15.2 ✅[^lab] | The reference says the exception information is not available during `finally` ✅[^compound]; depend on neither, and catch the exception if you need it |
| `e.add_note(42)` | `TypeError: add_note() argument must be str, not int` ✅[^lab] | Notes must be strings ✅[^exceptions] |
| Two exception classes named `Error` in different modules | Neither handler catches the other's | Classes not related by subclassing never match, even with the same name ✅[^exceptions] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| EAFP (easier to ask for forgiveness than permission): `try: v = d[k]` / `except KeyError: v = default` | Clean and fast; no gap between the check and the use ✅[^glossary] | A `KeyError` from deeper inside a large `try` body is caught too; keep the body to the one risky line |
| LBYL (look before you leap): `if k in d: v = d[k]` | The precondition is visible as an `if` ✅[^glossary] | In threaded code another thread can change `d` between the test and the lookup ✅[^glossary] |
| Catch specific types | Unexpected exceptions keep propagating, as the tutorial advises ✅[^tut-errors] | More clauses to write |
| `except Exception` with log and re-raise | One place sees every non-fatal failure ✅[^tut-errors] | Without the re-raise it hides bugs |
| Raise the first error | Simple; plain `except` works | Later independent failures are never reported |
| Collect into an `ExceptionGroup` | Every failure is reported; `except*` handles each type once ✅[^pep654] | Callers must use `except*` or `split()`; plain `except ConfigError` no longer matches |

## Takeaways
- Catch the narrowest exception class you can actually handle, and let everything else propagate. [rule-candidate]
- Never use bare `except:` or `except BaseException:` unless the handler re-raises; they also swallow Ctrl-C and `sys.exit()`. [rule-candidate]
- Keep the `try` body to the statements that can fail; put follow-up work in `else`.
- Never `return`, `break` or `continue` inside `finally`; 3.14+ warns, and it silently drops exceptions. [rule-candidate]
- When translating an exception, write `raise NewError(...) from err`; use `from None` only when the old exception is pure noise. [rule-candidate]
- Copy the `as` target to another name if you need it after the `except` clause.
- Report independent failures as an `ExceptionGroup` with a note on each, and handle them with `except*`.
- Derive custom exceptions from `Exception`, never directly from `BaseException`. [rule-candidate]

## Verification status
- Verified: 100 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [8. Errors and Exceptions](https://docs.python.org/3/tutorial/errors.html) — Python Software Foundation, living. Rank 1. Backs: syntax errors versus exceptions; how `try` runs and handler order; `else`; log and re-raise; implicit chaining text; user-defined exceptions; `ExceptionGroup` basics; members must be instances; be specific when catching. [^tut-errors]
- [8. Compound statements: The try statement](https://docs.python.org/3/reference/compound_stmts.html) — Python Software Foundation, living. Rank 1. Backs: `except` matching and bare `except`; PEP 758 form; deleting the `as` target and why; `sys.exception()` in handlers; `except*` splitting and its restrictions; `else` and `finally` semantics; exception information during `finally`. [^compound]
- [7. Simple statements: The raise statement](https://docs.python.org/3/reference/simple_stmts.html) — Python Software Foundation, living. Rank 1. Backs: what `raise` accepts; bare `raise` and `RuntimeError`; the "direct cause" traceback text. [^raise]
- [Built-in Exceptions](https://docs.python.org/3/library/exceptions.html) — Python Software Foundation, living. Rank 1. Backs: `BaseException` and `Exception`; `SystemExit` and `KeyboardInterrupt`; `__context__`, `__cause__`, `__suppress_context__` and their display; `add_note()` and `__notes__`; `ExceptionGroup`, `BaseExceptionGroup`, `split()`, `subgroup()`; subclassing one built-in type; same-name classes. [^exceptions]
- [sys — System-specific parameters and functions](https://docs.python.org/3/library/sys.html) — Python Software Foundation, living. Rank 1. Backs: `sys.exception()` and `sys.exc_info()`. [^sys]
- [warnings — Warning control](https://docs.python.org/3/library/warnings.html) — Python Software Foundation, living. Rank 1. Backs: `warn()`, categories, `stacklevel`, the filter actions and default filters, `catch_warnings`. [^warnings]
- [Glossary: EAFP, LBYL](https://docs.python.org/3/glossary.html) — Python Software Foundation, living. Rank 1. Backs: the two coding styles and the race in LBYL. [^glossary]
- [What's new in Python 3.14: PEP 765](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, 2025. Rank 1. Backs: the `SyntaxWarning` for control flow leaving `finally`; filters applied at runtime only affect code compiled later. [^whatsnew314]
- [PEP 654 – Exception Groups and except*](https://peps.python.org/pep-0654/) — Irit Katriel, Yury Selivanov, Guido van Rossum, 2021. Rank 1. Backs: leaf exceptions; each `except*` clause runs at most once. [^pep654]
- [PEP 678 – Enriching Exceptions with Notes](https://peps.python.org/pep-0678/) — Zac Hatfield-Dodds, 2021. Rank 1. Backs: notes are for display, not structured data. [^pep678]
- [PEP 758 – Allow except and except* expressions without parentheses](https://peps.python.org/pep-0758/) — Pablo Galindo Salgado, Brett Cannon, 2024. Rank 1. Backs: parentheses still required with `as`; no return to Python 2 semantics. [^pep758]
- [PEP 765 – Disallow return/break/continue that exit a finally block](https://peps.python.org/pep-0765/) — Irit Katriel, Alyssa Coghlan, 2024. Rank 1. Backs: `SyntaxError` allowed by the spec; warning at compile time only; `-We` impact. [^pep765]

## Related
- `error-handling/handle-errors-once.md` — handle or add context, not both, at each layer.
- `error-handling/library-vs-application-errors.md` — what exception types a library should expose.
- `python/errors-and-resources/context-managers-and-file-io.md` — `with`, `__exit__` and how cleanup interacts with exceptions.
- `python/concurrency/asyncio-coroutines-and-tasks.md` — task groups, the main source of exception groups.
- `concurrency/structured-concurrency.md` — why concurrent children report failures to one parent scope.
- `python/fundamentals/control-flow-and-pattern-matching.md` — `break`, `continue` and `return` in loops.
