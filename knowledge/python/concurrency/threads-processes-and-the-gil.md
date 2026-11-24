---
schema: knowledge-doc/v1
type: concept
topic: python/concurrency
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, concurrency, gil, threading, lock, rlock, event, queue, multiprocessing, start-method, concurrent-futures, subinterpreters, pep-734, free-threading, pep-703, pep-779]
ranked-sources: true
---

# Threads, processes and the GIL

## Summary
**TL;DR:** In the default CPython build the GIL (global interpreter lock) lets only one thread run Python bytecode at a time, so threads speed up waiting (I/O, that is input/output, and sleeps) but not pure-Python computation. For CPU-bound (processor-bound) work use processes (`multiprocessing`, `ProcessPoolExecutor`) or, since 3.14, subinterpreters (`InterpreterPoolExecutor`), each of which has its own GIL; both pickle what they send. The GIL does not make your code thread-safe: a read-modify-write that spans a switch point still loses updates, so shared state needs a `Lock`. The free-threaded build (`python3.15t`), officially supported since 3.14, removes the GIL: in the lab its 4 threads ran the same CPU-bound job 3.61x faster than 1 thread, and an unlocked `x += 1` lost about 68% of its updates.
**Use this when:** choosing between threads, processes and interpreters; a threaded CPU-bound job is no faster than a single thread; a `multiprocessing` script fails with `RuntimeError` or `PicklingError`; deciding whether the free-threaded build is worth trying.
**Not this doc:** `async`/`await` → `python/concurrency/asyncio-coroutines-and-tasks.md`; race conditions in general → `concurrency/shared-state-and-data-races.md`; how bytecode runs → `python/runtime/bytecode-and-the-interpreter.md`; the cost of objects and reference counts → `python/runtime/memory-management-and-garbage-collection.md`.

## Problem
- Four threads running pure-Python computation finish little faster than one thread doing all of it, because the GIL limits what threads gain on CPU-bound work ✅[^threading].
- A counter updated from several threads ends lower than expected, although "the GIL protects everything": `i = i+1` and `D[x] = D[x] + 1` are not atomic ✅[^faq-library].
- A script that starts a `Process` at module level fails with a `RuntimeError` under the `spawn` or `forkserver` start method ✅[^multiprocessing], and `fork` is no longer the default on any platform since 3.14 ✅[^multiprocessing].
- `ProcessPoolExecutor.submit(lambda: ...)` fails: only picklable objects can be sent to a worker process ✅[^futures].

## Mental model
**Analogy:** a process is a kitchen and its threads are cooks, but the kitchen has one knife (the GIL). Only the cook holding the knife can chop (run bytecode); a cook who goes to wait at the oven (blocking I/O) puts the knife down so another can chop. More cooks do not chop faster, but they do wait in parallel. Processes are separate kitchens, each with its own knife, and ingredients must be packed and shipped between them (pickled). Subinterpreters are separate kitchens in the same building: own knife, cheaper to reach, ingredients still passed through a hatch. The free-threaded build gives every cook a knife, and now two cooks can grab the same onion, so shared things need a lock.

**Artifact** (measured in the lab ✅[^lab]):
```python
import sys, threading, time
sys._is_gil_enabled()          # True   default build
sys.getswitchinterval()        # 0.005  seconds: the ideal time slice per thread
def run_threads(target, args_list):
    ts = [threading.Thread(target=target, args=a) for a in args_list]
    for t in ts: t.start()
    for t in ts: t.join()
# 4 x time.sleep(0.2): one after another 0.813 s, in 4 threads 0.202 s  (waiting overlaps)
# 4 x pure-Python loop: 1 thread 0.600 s, 4 threads 0.502 s            (computing does not)
# same loop on python3.15t (free-threaded): 1 thread 0.310 s, 4 threads 0.086 s
```

## How it works
1. **The GIL.** It is the mechanism CPython uses so that only one thread executes Python bytecode at a time; it makes the object model, including `dict`, implicitly safe against concurrent access, at the cost of much of the parallelism a multi-core machine offers ✅[^glossary]. The `threading` docs mark this as a CPython implementation detail and point CPU-bound work to `multiprocessing` or `ProcessPoolExecutor`, while threads stay right for I/O-bound tasks ✅[^threading]. The lab build reports `sys._is_gil_enabled()` as `True` and `Py_GIL_DISABLED` as `0` ✅[^lab].
2. **When a thread lets go.** The GIL is always released during I/O, and some extension modules release it during heavy work such as compression or hashing ✅[^glossary]. In general Python offers to switch threads only between bytecode instructions, at an interval set by `sys.setswitchinterval()` ✅[^faq-library]; the interval is the ideal length of a thread's time slice, the real one can be longer, and the operating system, not Python, picks the next thread ✅[^sys]. The default was `0.005` seconds in the lab ✅[^lab].
3. **`threading` basics.**
   - `Thread(target=f, args=(...))`, then `start()` and `join()`; `join(timeout)` always returns `None`, so call `is_alive()` afterwards to see whether it timed out ✅[^threading]. Joining the current thread raises `RuntimeError` ✅[^threading].
   - A daemon thread does not keep the program alive: the program exits when only daemon threads are left, and they are stopped abruptly, possibly without releasing files or transactions ✅[^threading]. The flag is inherited from the creating thread, and the main thread is not a daemon, so threads created in the main thread default to `daemon=False` ✅[^threading].
   - `Lock` is locked or unlocked; `acquire()` blocks while it is locked, and releasing an unlocked lock raises `RuntimeError` ✅[^threading]. `RLock` may be acquired again by the thread that holds it and must be released once per acquire ✅[^threading]. `Event` holds a flag set with `set()`, cleared with `clear()`, and `wait()` blocks until it is true ✅[^threading].
   - `queue.Queue` is a multi-producer, multi-consumer queue that does its own locking ✅[^queue]. Each `get()` is matched by a `task_done()`, and `join()` unblocks when every item put in has been marked done ✅[^queue]; `shutdown()` (3.13) makes further `put()` calls raise `ShutDown` and, once the queue is empty, `get()` too ✅[^queue].
4. **The GIL does not prevent data races.** Each bytecode instruction is atomic from the program's point of view, so operations that are one instruction "look atomic", but `i = i+1` and `D[x] = D[x] + 1` are not ✅[^faq-library]. Read-modify-write and check-then-act sequences on lists and dicts are never atomic ✅[^threadsafety]. In the lab, `box["n"] += 1` run 250,000 times in each of 4 threads lost no update in 10 runs, with the default switch interval and with `1e-6`; a version that reads, calls `time.sleep(0)`, then writes kept only 1,000 of 4,000 increments, and the same code under a `Lock` kept all 4,000 ✅[^lab]. On the free-threaded build the same `box["n"] += 1` test lost 678,489 to 695,629 of 1,000,000 updates per run (about 68–70%), and the read/`sleep(0)`/write version kept 1,724 of 4,000; with a `Lock`, both builds kept all 4,000 ✅[^lab]. A race that does not show up in a test is still a race; the general treatment is in `concurrency/shared-state-and-data-races.md`.
5. **`multiprocessing`.** It runs work in subprocesses instead of threads, which side-steps the GIL and lets one program use several processors ✅[^multiprocessing]. There are three start methods ✅[^multiprocessing]:
   - `spawn`: a fresh interpreter that inherits only what it needs; the slowest to start; the default on Windows and macOS.
   - `fork`: `os.fork()` makes the child a copy of the parent that inherits all its resources, and forking a multithreaded process safely is problematic; since 3.12 it raises a `DeprecationWarning` when the parent has several threads, and since 3.14 it is the default nowhere.
   - `forkserver`: a server process, normally single-threaded, forks each child; the default on POSIX (Portable Operating System Interface, Unix-like) platforms since 3.14, and since 3.15.1 `spawn` is used instead when no writable temporary directory exists.

   `get_all_start_methods()` lists the default first ✅[^multiprocessing]; on the lab Mac it returned `['spawn', 'fork', 'forkserver']` and `get_start_method()` returned `'spawn'` ✅[^lab]. Under `spawn` and `forkserver` a new interpreter must be able to import the main module without side effects such as starting a process, or the start fails with `RuntimeError`; so put process start-up under `if __name__ == '__main__':` ✅[^multiprocessing]. The lab traceback shows the child running the script again under the name `__mp_main__` ✅[^lab]. Arguments to `Process` usually need to be picklable ✅[^multiprocessing]. Pick a method with `set_start_method()` once, inside that guard, or with `get_context()` ✅[^multiprocessing].
6. **`concurrent.futures`.** `ThreadPoolExecutor`, `InterpreterPoolExecutor` and `ProcessPoolExecutor` share one `Executor` interface (`submit`, `map`) ✅[^futures].
   - `ThreadPoolExecutor` defaults to `min(32, (os.process_cpu_count() or 1) + 4)` workers since 3.13 ✅[^futures].
   - `ProcessPoolExecutor` defaults to `os.process_cpu_count()` workers (at most 61 on Windows), can only send and return picklable objects, needs an importable `__main__`, and so does not work in the interactive interpreter ✅[^futures]. Since 3.14 its default start method is no longer `fork`; pass `mp_context=multiprocessing.get_context("fork")` if code needs it ✅[^futures].
   - `InterpreterPoolExecutor` (3.14) is a `ThreadPoolExecutor` whose worker threads each run in their own interpreter; each interpreter has its own GIL, so the work runs in parallel on several cores, and the callable, arguments and result are pickled ✅[^futures].
7. **Subinterpreters (PEP 734, `concurrent.interpreters`, 3.14; PEP = Python Enhancement Proposal).** An interpreter is the runtime's execution context: its own import state, builtins and modules ✅[^interpreters]. Interpreters are isolated by default, start no threads of their own, and have not shared the GIL since 3.12 ✅[^interpreters]. Objects passed between them are copied, mostly with `pickle` ✅[^interpreters]. `create()` makes one; `exec()`, `call()` and `call_in_thread()` run code in it; `create_queue()` passes messages ✅[^interpreters]. Isolation is best-effort, so they are not a security boundary ✅[^interpreters]. PEP 734 proposed both the module and `InterpreterPoolExecutor`, and was accepted on condition that the module be named `concurrent.interpreters` ✅[^pep734]. Known limits in 3.14: start-up is not optimised, each uses more memory than needed, and many third-party extension modules are not yet compatible ✅[^whatsnew314]. In the lab, an interpreter's own `__main__.x` stayed `41` after the main interpreter set its `x` to `1` ✅[^lab].
8. **The free-threaded build (PEP 703).** A build configured with `--disable-gil` runs Python code without the GIL ✅[^pep703]. It was experimental in 3.13, as a separate executable usually called `python3.13t` ✅[^whatsnew313], and became officially supported but optional in 3.14 (phase II) ✅[^whatsnew314], under criteria such as at most 15% slowdown and 20% extra memory ✅[^pep779]. The 3.15 macOS installer installs `python3.15t` by default ✅[^using-mac].
   - Check it with `python -VV` or `sys.version` (they contain "free-threading build"), `sys._is_gil_enabled()` for the running process, and `sysconfig.get_config_var("Py_GIL_DISABLED") == 1` for the build ✅[^free-threading].
   - `PYTHON_GIL=0|1` or `-X gil=0|1` force the GIL off or on; `0` is only available on `--disable-gil` builds ✅[^cmdline]. Importing a C extension not marked as free-threading-safe re-enables the GIL with a warning ✅[^free-threading].
   - Built-in types such as `dict`, `list` and `set` use internal locks, but the docs recommend `threading.Lock` over relying on them ✅[^free-threading]. Single-threaded code runs slower: about 1% on macOS aarch64 to 8% on x86-64 Linux on pyperformance ✅[^free-threading].
   - In the lab, Homebrew's `python-freethreading` formula installed `python3.15t`, whose `-VV` banner reads `Python 3.15.2 free-threading build (main, Oct 25 2026, 16:57:51)`; it reported `sys._is_gil_enabled()` `False`, `Py_GIL_DISABLED` `1` and `sys.abiflags` `'t'`, and `PYTHON_GIL=1` or `-X gil=1` turned the GIL back on (`True`) ✅[^lab]. On the one tight loop of the worked example, one thread was 13% slower than on the default build (0.310 s against 0.274 s): a single microbenchmark, not the pyperformance average above ✅[^lab].

## Worked example
Four chunks of the same pure-Python loop (3,000,000 iterations of `total += i % 7`), run 7 times in interleaved rounds, with the pool workers started before timing. Machine: `os.cpu_count()`, the number of logical CPUs ✅[^os], returned 8, and the load average was about 16 from other work during the run, so the times are noisy; the medians are what to compare ✅[^lab].

| Mode | Median wall time | Range | Speed-up vs 1 thread |
|---|---|---|---|
| 1 thread, 4 calls in a row | 0.600 s | 0.470–1.003 s | 1.00x |
| 4 `threading.Thread`s | 0.502 s | 0.452–0.793 s | 1.19x |
| `ProcessPoolExecutor(4)` | 0.172 s | 0.144–0.210 s | 3.48x |
| `InterpreterPoolExecutor(4)` | 0.149 s | 0.132–0.259 s | 4.02x |

Reading it ✅[^lab]:
- With 4 threads, the process's CPU time divided by its wall time had a median of `0.81`: about one core busy, where four parallel threads would approach `4`. Two earlier runs gave thread speed-ups of 0.92x and 1.07x, so the 1.19x is noise, not parallelism.
- Processes and interpreters ran the chunks on separate cores, each with its own GIL ✅[^futures].
- Creating and shutting down a fresh 4-process pool around one batch took 0.684 s, longer than the 0.600 s sequential run; two later runs on the same machine took 0.179 s and 0.190 s against 0.291 s and 0.334 s sequential, so whether a fresh pool beats the sequential run depends on the machine's load. Processes pay off only when the work outweighs the start-up.
- The I/O case is the reverse: 4 × `time.sleep(0.2)` took 0.813 s in a row and 0.202 s in 4 threads, because sleeping releases the GIL.

The same probe was then run on both builds one after the other, with the load average down to about 3.8 ✅[^lab]:

| Mode | Default build (`python3.15`) | Free-threaded build (`python3.15t`) |
|---|---|---|
| 1 thread, 4 calls in a row | 0.274 s (1.00x) | 0.310 s (1.00x) |
| 4 `threading.Thread`s | 0.279 s (0.98x) | 0.086 s (3.61x) |
| `ProcessPoolExecutor(4)` | 0.076 s (3.59x) | 0.085 s (3.66x) |
| `InterpreterPoolExecutor(4)` | 0.079 s (3.49x) | 0.088 s (3.51x) |
| 4 threads: CPU time / wall time | 1.00 | 3.94 |

Reading it ✅[^lab]: without the GIL, threads reached the speed-up of processes (3.61x against 3.66x) while sharing memory, and kept close to four cores busy (3.94); with the GIL they kept one (1.00). Each speed-up is the build's own 1-thread median divided by that row's median, for example 0.310 / 0.086 ≈ 3.6.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `mp.Process(target=f).start()` at the top of a script, run on macOS | The child prints `RuntimeError: An attempt has been made to start a new process before the current process has finished its bootstrapping phase` and exits with code 1; the parent goes on ✅[^lab] | The child imports the main module, whose top level starts a process again ✅[^multiprocessing] |
| `ProcessPoolExecutor().submit(lambda: 1)` | `PicklingError: Can't pickle local object <function main.<locals>.<lambda> ...>` ✅[^lab] | Lambdas and REPL (interactive interpreter) functions cannot be sent to a worker process ✅[^futures] |
| Sending a `threading.Lock` to a child | `TypeError: cannot pickle '_thread.lock' object` ✅[^lab] | Arguments are pickled; `multiprocessing` has its own equivalents of the `threading` primitives ✅[^multiprocessing] |
| A `fork`-context lock given to a `spawn` or `forkserver` process | Not supported ✅[^multiprocessing] | Objects of one context may not work with another |
| Code that relied on `fork` copying module globals, moved to Linux on 3.14 | Behaviour can change for code that shares mutable globals or objects that cannot be pickled ✅[^whatsnew314] | The POSIX default changed from `fork` to `forkserver` |
| `t.join(timeout=0.05)` on a thread that sleeps 0.5 s | Returns `None`; `t.is_alive()` is `True` ✅[^lab] | `join()` always returns `None` ✅[^threading] |
| `threading.current_thread().join()` | `RuntimeError: cannot join current thread` ✅[^lab] | It would deadlock ✅[^threading] |
| A daemon thread still sleeping when the main thread ends | Its `print('worker finished')` never runs; the non-daemon version prints it ✅[^lab] | Daemon threads are stopped abruptly at shutdown ✅[^threading] |
| `Lock().release()` on an unlocked lock | `RuntimeError: release unlocked lock` ✅[^lab] | Only a locked lock may be released ✅[^threading] |
| `PYTHON_GIL=0` or `-X gil=0` on the lab build | `Fatal Python error: config_read_gil: Disabling the GIL is not supported by this build`, exit 1 ✅[^lab] | Only `--disable-gil` builds can turn the GIL off ✅[^cmdline] |
| `box["n"] += 1` from 4 threads on `python3.15t` | 678,489 to 695,629 of 1,000,000 updates lost per run; 0 on the default build ✅[^lab] | Read-modify-write is never atomic ✅[^threadsafety], and without the GIL the threads really run at the same time |
| `PYTHON_GIL=1` or `-X gil=1` on `python3.15t` | `sys._is_gil_enabled()` is `True` ✅[^lab] | A free-threaded build can run with the GIL enabled at run time ✅[^free-threading] |
| Free-threaded build: reading `frame.f_locals` of a frame running in another thread, or sharing one iterator between threads | May crash the interpreter; iterators may yield duplicate or missing items ✅[^free-threading] | Known limitations of the free-threaded build |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Threads (`threading`, `ThreadPoolExecutor`) | Shared memory; I/O waits overlap ✅[^threading] | No CPU parallelism for Python code under the GIL; shared state needs locks |
| Processes (`multiprocessing`, `ProcessPoolExecutor`) | Separate GILs, so CPU work runs on several cores ✅[^multiprocessing] | Start-up cost; everything sent is pickled; `__main__` guard needed ✅[^futures] |
| Subinterpreters (`InterpreterPoolExecutor`) | Own GIL per interpreter in one process, fewer resources than processes ✅[^whatsnew314] | Values still pickled; many extension modules not yet compatible ✅[^whatsnew314] |
| Free-threaded build (`python3.15t`) | Threads run Python code in parallel ✅[^free-threading]: 3.61x with 4 threads in the lab ✅[^lab] | Slower single-threaded code and more memory ✅[^free-threading] (13% on the lab's loop ✅[^lab]); some extensions re-enable the GIL; latent races lose data ✅[^lab] |

## Takeaways
- Use threads for I/O-bound work and processes or `InterpreterPoolExecutor` for CPU-bound pure-Python work.
- Guard every read-modify-write of shared state with a `Lock`, even under the GIL; never count on `x += 1` being atomic. [rule-candidate]
- Start processes only under `if __name__ == "__main__":`, and send only module-level functions and picklable arguments to process pools. [rule-candidate]
- Do not depend on the default start method; if code needs `fork`, ask for it with `get_context("fork")`. [rule-candidate]
- Never make a thread that holds files or transactions a daemon; stop it with an `Event` instead.
- Before tuning for free threading, check `sysconfig.get_config_var("Py_GIL_DISABLED")` and `sys._is_gil_enabled()`.
- Run the tests of threaded code on the free-threaded build too: races that never show under the GIL lose data there. [rule-candidate]

## Verification status
- Verified: 99 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24, with the default build `python3.15` and, for the free-threaded rows, `python3.15t`. [^lab]
- [Glossary: global interpreter lock](https://docs.python.org/3/glossary.html) — Python Software Foundation, living. Rank 1. Backs: what the GIL is and protects; released during I/O. [^glossary]
- [threading — Thread-based parallelism](https://docs.python.org/3/library/threading.html) — Python Software Foundation, living. Rank 1. Backs: GIL note, `Thread`, `join`, daemon threads, `Lock`, `RLock`, `Event`. [^threading]
- [queue — A synchronized queue class](https://docs.python.org/3/library/queue.html) — Python Software Foundation, living. Rank 1. Backs: `Queue`, `task_done`, `join`, `shutdown`. [^queue]
- [sys.setswitchinterval](https://docs.python.org/3/library/sys.html) — Python Software Foundation, living. Rank 1. Backs: what the switch interval controls. [^sys]
- [Library and Extension FAQ: What kinds of global value mutation are thread-safe?](https://docs.python.org/3/faq/library.html) — Python Software Foundation, living. Rank 1. Backs: switching between bytecode instructions; non-atomic examples. [^faq-library]
- [Thread safety guarantees](https://docs.python.org/3/library/threadsafety.html) — Python Software Foundation, living. Rank 1. Backs: read-modify-write is never atomic; the guarantees apply with the GIL disabled. [^threadsafety]
- [multiprocessing — Process-based parallelism](https://docs.python.org/3/library/multiprocessing.html) — Python Software Foundation, living. Rank 1. Backs: start methods and defaults, the main-module guard, picklable arguments, contexts. [^multiprocessing]
- [os — Miscellaneous operating system interfaces: cpu_count](https://docs.python.org/3/library/os.html) — Python Software Foundation, living. Rank 1. Backs: `os.cpu_count()` counts logical CPUs. [^os]
- [concurrent.futures — Launching parallel tasks](https://docs.python.org/3/library/concurrent.futures.html) — Python Software Foundation, living. Rank 1. Backs: the three executors, default worker counts, pickling, the 3.14 start-method change. [^futures]
- [concurrent.interpreters — Multiple interpreters in the same process](https://docs.python.org/3/library/concurrent.interpreters.html) — Python Software Foundation, living. Rank 1. Backs: what an interpreter is, isolation, own GIL, copying, the API. [^interpreters]
- [Python support for free threading](https://docs.python.org/3/howto/free-threading-python.html) — Python Software Foundation, living. Rank 1. Backs: identifying the build, GIL re-enabling, internal locks, overhead, known limitations. [^free-threading]
- [Command line and environment: PYTHON_GIL, -X gil](https://docs.python.org/3/using/cmdline.html) — Python Software Foundation, living. Rank 1. Backs: forcing the GIL on or off. [^cmdline]
- [Using Python on macOS: Installing free-threaded binaries](https://docs.python.org/3/using/mac.html) — Python Software Foundation, living. Rank 1. Backs: `python3.15t` installed by default in 3.15. [^using-mac]
- [What's New In Python 3.13: Free-threaded CPython](https://docs.python.org/3/whatsnew/3.13.html) — Python Software Foundation, 2024. Rank 1. Backs: experimental status, `python3.13t`. [^whatsnew313]
- [What's new in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, 2025. Rank 1. Backs: free threading officially supported; PEP 734 limitations; `forkserver` default. [^whatsnew314]
- [PEP 703 – Making the Global Interpreter Lock Optional in CPython](https://peps.python.org/pep-0703/) — Sam Gross, 2023. Rank 1. Backs: the `--disable-gil` build. [^pep703]
- [PEP 734 – Multiple Interpreters in the Stdlib](https://peps.python.org/pep-0734/) — Eric Snow, 2023. Rank 1. Backs: origin of `concurrent.interpreters` and `InterpreterPoolExecutor`, the module name. [^pep734]
- [PEP 779 – Criteria for supported status for free-threaded Python](https://peps.python.org/pep-0779/) — Thomas Wouters, Matt Page, Sam Gross, 2025. Rank 1. Backs: the phase II criteria. [^pep779]

## Related
- `concurrency/shared-state-and-data-races.md` — why unsynchronised shared state breaks, in any language.
- `python/concurrency/asyncio-coroutines-and-tasks.md` — one thread, many waits, without the GIL question.
- `python/runtime/bytecode-and-the-interpreter.md` — the bytecode the GIL serialises.
- `python/runtime/memory-management-and-garbage-collection.md` — reference counting, the reason the GIL exists.
- `python/tooling/testing-debugging-and-profiling.md` — measuring before choosing a concurrency model.
