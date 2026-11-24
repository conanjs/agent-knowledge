---
schema: knowledge-doc/v1
type: concept
topic: dotnet/errors-and-resources
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [dotnet, csharp, exceptions, try-catch-finally, exception-filters, rethrow, stack-trace, exceptiondispatchinfo, aggregateexception, unhandled-exception, stackoverflow, throw-helpers, tryparse]
ranked-sources: true
---

# Exceptions: throwing, filtering, rethrowing and what crashes the process

## Summary
**TL;DR:** A thrown exception travels up the call stack in two passes: first the runtime looks for a `catch` that matches, evaluating `when` filters while every frame is still intact; then it unwinds, running the `finally` blocks on the way, and enters the chosen `catch`. Rethrow with `throw;` to keep the original stack trace (`throw ex;` restarts it), or with `ExceptionDispatchInfo` from outside the handler. An exception that no `catch` takes ends the process (exit code 134 on macOS in the lab), and a stack overflow cannot be caught at all. Throwing costs microseconds, so expected failures belong to `Try…` methods.
**Use this when:** a stack trace points at the wrong line, you need to choose between `catch` + `if` and a `when` filter, an `AggregateException` appears, a service dies with "Unhandled exception.", you are writing a custom exception or argument checks, or exceptions show up in a profile.
**Not this doc:** exceptions in `async` methods, `async void` and `Task.WhenAll` → `dotnet/async/tasks-and-async-await.md`; `OperationCanceledException` → `dotnet/async/cancellation-valuetask-and-async-streams.md`; `using` and cleanup → `dotnet/errors-and-resources/disposal-and-finalization.md`; exceptions inside iterators → `dotnet/collections-and-linq/iterators.md`; errors-as-values designs across languages → `error-handling/` (outside this topic).

## Problem
Exception code that compiles fine still goes wrong at run time:
- A log shows the stack trace of the `catch` block that rethrew, not of the method that failed.
- A `catch (Exception)` around a deep recursion never runs; the process prints "Stack overflow." and exits.
- A `finally` throws, and the original exception, the one that explains the failure, is gone.
- `Task.WhenAll(a, b).Wait()` throws `AggregateException`, while `await Task.WhenAll(a, b)` throws only one of the two errors.
- A parser that relies on `int.Parse` + `catch` runs about 77 times slower than with `int.TryParse` when half the input is bad (385 ms against 5 ms in the lab).

## Mental model
**Analogy:** a fire alarm in an office tower. `throw` pulls the alarm on one floor. Before anyone moves, the safety team phones each floor upwards asking "do you handle this kind of fire?"; a floor with a `when` filter can look at the fire first, with every room still exactly as it was. Only when some floor says yes does the evacuation start: everyone between the fire and that floor leaves, closing their doors on the way out (`finally`), and the floor that said yes deals with it (`catch`). If no floor says yes, the whole building is evacuated (the process ends). A stack overflow is the building running out of stairs: there is no way to send anyone anywhere.

**Artifact** (run in the lab ✅[^lab]): the filter runs before the inner `finally`, which proves the two passes.
```csharp
static void Inner() { try { throw new InvalidOperationException("boom"); }
                      finally { Console.WriteLine("3. inner finally runs (unwinding)"); } }
static bool Log(string m) { Console.WriteLine($"2. filter runs: {m}"); return true; }

try { Console.WriteLine("1. calling Inner"); Inner(); }
catch (InvalidOperationException e) when (Log(e.Message)) { Console.WriteLine("4. catch block runs"); }
// 1. calling Inner
// 2. filter runs: boom
// 3. inner finally runs (unwinding)
// 4. catch block runs
```

## How it works
Four actors handle one exception:
- **Thrower (a `throw` statement, or the runtime itself for errors such as division by zero)** — its job: create and raise an `Exception` object, via `throw` or a failing operation.
- **Runtime exception dispatcher (the CLR, the common language runtime)** — its job: find a handler, via a search through the `catch` clauses and filters of each frame, then unwind, via running `finally` blocks.
- **Handler (`catch` block)** — its job: recover, rethrow or wrap, via its body, `throw;` or `throw new …(…, inner)`.
- **Host process** — its job: report an exception nobody handled and terminate, via the `AppDomain.UnhandledException` event and the default handler.

```
frame:   Main                    B (try/finally)            C
         try { B() }             try { C() }                throw new X()
         catch (X) when (f)      finally { cleanup }            │
                                                                │ pass 1: search (stack intact)
           f() evaluated ◀──────────────────────────────────────┘  C: no catch, B: no catch, Main: filter f
           true │                                                  
                │ pass 2: unwind
                ├──▶ B's finally runs ──▶ C, B frames popped
                ▼
         catch body runs                          (no match anywhere ═══▶ UnhandledException event, process exits)
```

1. **Thrower: what can be thrown.** `System.Exception` is the base type of all exceptions; every exception has a `Message` and an `InnerException` that names the exception that caused it ✅[^spec-exceptions]. Besides `throw`, operations raise exceptions themselves: `DivideByZeroException`, `OverflowException` in a `checked` context, `IndexOutOfRangeException`, `InvalidCastException`, `NullReferenceException`, `ArrayTypeMismatchException`, `TypeInitializationException` and others ✅[^spec-exceptions]. In the lab, `checked(int.MaxValue + 1)` threw `OverflowException`, while `unchecked` wrapped to `-2147483648` ✅[^lab].
2. **Dispatcher, pass 1: search.** The runtime looks for the nearest `catch` that matches the exception's run-time type: first in the current method's enclosing `try` statements, clause by clause in order, then in the caller, and so on ✅[^spec-exceptions]. A clause matches when its type matches and its `when` filter, if any, is true ✅[^spec-statements]. The filter runs before the stack is unwound, so the failing frames and their locals are still there ✅[^ref-statements]. Several clauses may name the same type if filters tell them apart ✅[^ref-statements], but a clause that comes after an unfiltered clause for the same type or a base type is a compile error ✅[^spec-statements]; the lab got CS0160 for `catch (ArgumentException)` after `catch (Exception)` ✅[^lab].
3. **Dispatcher, pass 2: unwind.** Before the chosen `catch` block starts, the `finally` clauses of the more nested `try` statements run, in order ✅[^spec-exceptions]. A `finally` also runs on normal exit and on `return`, `break`, `continue` and `goto` ✅[^spec-statements]. A `return` inside `finally` is a compile error (CS0157 in the lab ✅[^lab]) ✅[^spec-statements]. If a `finally` throws, the exception that was propagating is lost ✅[^spec-statements]; the lab caught `IOException: from finally` and never saw the original ✅[^lab].
4. **Handler: rethrow.** `throw;` inside a `catch` keeps the exception's original stack trace; `throw e;` resets it to the current method ✅[^ref-statements]. In the lab, the top frame after `throw;` was the failing `Thrower` method, after `throw ex;` it was the rethrowing method ✅[^lab]. Rule CA2200 flags the second form ✅[^ca2200], and the lab build reported it as a warning ✅[^lab]. To rethrow later or on another thread, `ExceptionDispatchInfo.Capture(e)` stores the stack trace and `Throw()` raises the exception again as if it had flowed from the capture point, adding an "End of stack trace from previous location" line ✅[^api-edi]; the lab rethrew a capture from a worker thread and kept the worker's frame ✅[^lab].
5. **Handler: wrap or aggregate.** To add context, throw a new exception with the original as `InnerException` ✅[^best-practices]. `AggregateException` combines several failures into one throwable object and is used throughout the Task Parallel Library ✅[^api-aggregate]; `Flatten()` turns nested aggregates into one level ✅[^api-aggregate]. In the lab, `Task.WhenAll(t1, t2).Wait()` threw an `AggregateException` holding both inner exceptions, while `await Task.WhenAll(t1, t2)` threw only the first ✅[^lab].
6. **Host: unhandled exceptions end the process.** Most unhandled exceptions, on any thread, terminate the application ✅[^ref-threads]. `AppDomain.UnhandledException` lets code log the exception before the default handler reports it and terminates the application ✅[^api-unhandled]. In the lab, an exception left unhandled in `Main` or in a worker `Thread` raised the event with `IsTerminating=True`, printed `Unhandled exception. System.InvalidOperationException: …`, and the process exited with code 134 ✅[^lab].
7. **Two failures you cannot catch reliably.** A `StackOverflowException` cannot be caught by `try`/`catch`, and the process is terminated ✅[^api-stackoverflow]; the lab printed `Stack overflow.` and `Repeated 261288 times`, ran neither the `catch` nor the `finally`, and exited with 134 ✅[^lab]. A real `OutOfMemoryException` from the runtime failing to allocate is a catastrophic failure, and the docs advise calling `Environment.FailFast` if you catch it ✅[^api-oom]; an impossible request such as `new long[int.MaxValue]` throws a catchable `OutOfMemoryException: Array dimensions exceeded supported range.` ✅[^lab].
8. **Thrower: built-in throw helpers.** The BCL (base class library) has static helpers that build and throw the right exception, such as `ArgumentNullException.ThrowIfNull`, `ArgumentException.ThrowIfNullOrWhiteSpace` and `ArgumentOutOfRangeException.ThrowIf…`, and the docs recommend them over constructing the exception yourself ✅[^best-practices]. Their `paramName` parameter is filled by `[CallerArgumentExpression]`, so it should be left out ✅[^api-argnull]; in the lab, `ThrowIfGreaterThan(count + 20, 10)` reported `(Parameter 'count + 20')` ✅[^lab].
9. **Thrower: custom exceptions.** Use a predefined type when one fits (`InvalidOperationException` for a wrong object state, `ArgumentException` and its subclasses for bad arguments); do not throw reserved types such as `NullReferenceException`, `IndexOutOfRangeException` or `StackOverflowException` ✅[^best-practices]. A custom type derives from `Exception`, ends its name in `Exception`, and has at least the parameterless, message and message-plus-inner-exception constructors ✅[^best-practices].
10. **Cost.** For conditions that happen routinely, check first or call a `Try…` method (`int.TryParse`, `Dictionary.TryGetValue`), which returns `false` instead of throwing ✅[^best-practices]. .NET 9 replaced the runtime's exception handling with the model of Native AOT (ahead-of-time compilation to machine code), 2 to 4 times faster in micro-benchmarks, with a `DOTNET_LegacyExceptionHandling=1` switch back ✅[^whatsnew9-runtime]. The switch is defined in the .NET 9 runtime source ✅[^src-clrconfig9] and no longer in the .NET 10 one ✅[^src-clrconfig10].

## Worked example
Parsing 200,000 strings, half of them invalid, in a Release build on an Apple M2 (the lab machine) ✅[^lab].

| Step | Code | Measured | Reading |
|---|---|---|---|
| 1 | warm up both methods 20,000 times | — | so the timings below are past the first JIT (just-in-time compiler) tiers |
| 2 | `try { return int.Parse(s, …); } catch (FormatException) { return 0; }` × 200,000 | 385 ms | 100,000 throws and catches |
| 3 | `int.TryParse(s, NumberStyles.Integer, …, out var v) ? v : 0` × 200,000 | 5 ms | same sums as step 2 |
| 4 | (385 − 5) ms / 100,000 failures | about 3.8 µs (microseconds) per thrown and caught `FormatException` | the cost of one exception |
| 5 | `throw` caught 1 frame up / 20 frames up, 20,000 times each | about 3.1 µs / 7.7 µs each | unwinding more frames costs more |
| 6 | `GC.GetAllocatedBytesForCurrentThread()` around one throw/catch | 296 bytes | allocated by each throw, on top of the time |
| 7 | rerun with `DOTNET_LegacyExceptionHandling=1` | 357 ms, 3.5 µs, 3.1 µs, 7.4 µs: the same within noise | the .NET 9 switch has no effect on .NET 10 (How it works 10) |

At 3.8 µs, an exception per request is invisible in a web request that takes milliseconds, but an exception per input line of a large file dominates the run time.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `return x;` then `finally { x = 99; }` | The caller gets `1`; for `return list;` with `finally { list.Add(99); }` it sees `[1,99]` ✅[^lab] | The return value is evaluated before the `finally` runs; a reference still points at the same object |
| Static initializer throws | `TypeInitializationException: The type initializer for 'Config' threw an exception.`, and the same exception again on the next access ✅[^lab] | An exception escaping a static constructor or field initializer is wrapped in `TypeInitializationException` ✅[^spec-exceptions]; the type stays unusable for the process |
| Unhandled exception and `finally` | In the lab, the `finally` in `Main` and in the worker thread printed after the runtime's "Unhandled exception." report, then exit code 134 ✅[^lab] | The standard leaves the effect of an unhandled exception implementation-defined ✅[^spec-exceptions]; do not rely on that cleanup |
| `checked` overflow and `finally` | `OverflowException` is caught normally and `finally` runs ✅[^lab] | The exception-handling statements page lists an `OverflowException` among the cases where `finally` does not run because the program terminates ✅[^ref-statements]; in the lab that held only for the stack overflow (How it works 7), so the page probably means `StackOverflowException` |
| `throw ex;` with CA2200 suppressed | Stack trace starts at the rethrow ✅[^lab] | How it works 4 |
| `int.Parse("99999999999")` | `OverflowException: Value was either too large or too small for an Int32.`; `TryParse` returns `false` ✅[^lab] | `Parse` throws for out-of-range values, `TryParse` does not ✅[^best-practices] |
| Filter that logs and returns `false` | The log line is written, and the original exception goes on to the outer `catch` unchanged ✅[^lab] | A `false` filter does not unwind the stack ✅[^ref-statements]; logging from a filter is a documented use |
| Exception thrown inside a `when` filter | Swallowed: the clause counts as not matching, and the outer `catch` receives the original `InvalidOperationException` ✅[^lab] | Observed in the lab; write filters that cannot throw |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `catch (X e) when (cond)` | The stack is still intact for logging and dumps; no rethrow needed when `cond` is false ✅[^ref-statements] | Filter code runs during the search, before inner `finally` blocks |
| `catch (X e) { if (!cond) throw; … }` | Plain code | The catch block runs after the stack is unwound, so a debugger or dump no longer shows the failing frames' state ✅[^ref-statements] |
| `throw new Y("context", e)` | Adds meaning for the caller ✅[^best-practices] | Callers must read `InnerException` for the root cause |
| `Try…` method or a pre-check | Microseconds cheaper per failure (worked example) | A race can still make the operation fail after the check ✅[^best-practices] |

## Takeaways
- Rethrow with `throw;`, never `throw ex;`; use `ExceptionDispatchInfo.Capture(e).Throw()` when the rethrow happens outside the `catch`. [rule-candidate]
- Use `when` filters to choose which exceptions to handle, so unhandled ones keep their full stack. [rule-candidate]
- Never throw from a `finally` block; the exception in flight is lost. [rule-candidate]
- Use `Try…` methods for input that is often invalid; keep exceptions for conditions that are rare and mean an error.
- Validate arguments with `ArgumentNullException.ThrowIfNull` and the other throw helpers, and let `[CallerArgumentExpression]` name the parameter.
- Subscribe to `AppDomain.CurrentDomain.UnhandledException` to log, but expect the process to end anyway.

## Verification status
- Verified: 60 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [C# standard: Exceptions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/exceptions) — ECMA TC49-TG2 / Microsoft, living. Rank 1. Backs: `System.Exception` and `InnerException`, the handler search, `finally` before `catch`, `TypeInitializationException`, thread termination is implementation-defined, the runtime-thrown exception classes. [^spec-exceptions]
- [C# standard: Statements (§13.11 The try statement)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/statements) — ECMA TC49-TG2 / Microsoft, living. Rank 1. Backs: a clause matches by type and filter, `finally` on every exit, no `return` in `finally`, an exception in `finally` loses the other. [^spec-statements]
- [Exception-handling statements (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/exception-handling-statements) — Microsoft, living. Rank 1. Backs: `throw;` versus `throw e;`, filters before unwinding, filtered clause ordering, when `finally` does not run. [^ref-statements]
- [Best practices for exceptions](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) — Microsoft, living. Rank 1. Backs: `Try…` methods and pre-checks, wrapping with an inner exception, throw helpers, predefined and reserved types, custom exception naming and constructors. [^best-practices]
- [ExceptionDispatchInfo Class](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.exceptionservices.exceptiondispatchinfo) — Microsoft, living. Rank 1. Backs: capture and later rethrow with the original stack, the restore-point marker line. [^api-edi]
- [AggregateException Class](https://learn.microsoft.com/en-us/dotnet/api/system.aggregateexception) — Microsoft, living. Rank 1. Backs: several failures in one exception, use in the TPL, `Flatten()`. [^api-aggregate]
- [Exceptions in managed threads](https://learn.microsoft.com/en-us/dotnet/standard/threading/exceptions-in-managed-threads) — Microsoft, living. Rank 1. Backs: most unhandled exceptions terminate the application. [^ref-threads]
- [AppDomain.UnhandledException Event](https://learn.microsoft.com/en-us/dotnet/api/system.appdomain.unhandledexception) — Microsoft, living. Rank 1. Backs: notification before the default handler terminates the application. [^api-unhandled]
- [StackOverflowException Class](https://learn.microsoft.com/en-us/dotnet/api/system.stackoverflowexception) — Microsoft, living. Rank 1. Backs: cannot be caught; the process is terminated. [^api-stackoverflow]
- [OutOfMemoryException Class](https://learn.microsoft.com/en-us/dotnet/api/system.outofmemoryexception) — Microsoft, living. Rank 1. Backs: a runtime allocation failure is catastrophic; `FailFast` if caught. [^api-oom]
- [ArgumentNullException.ThrowIfNull Method](https://learn.microsoft.com/en-us/dotnet/api/system.argumentnullexception.throwifnull) — Microsoft, living. Rank 1. Backs: `paramName` filled by `CallerArgumentExpression`, leave it out. [^api-argnull]
- [CA2200: Rethrow to preserve stack details](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2200) — Microsoft, living. Rank 1. Backs: the rule that flags `throw ex;`. [^ca2200]
- [What's new in the .NET 9 runtime](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-9/runtime) — Microsoft, living. Rank 1. Backs: the new exception handling, 2–4 times faster, `DOTNET_LegacyExceptionHandling`. [^whatsnew9-runtime]
- [clrconfigvalues.h, release/9.0](https://github.com/dotnet/runtime/blob/release/9.0/src/coreclr/inc/clrconfigvalues.h) — .NET team (dotnet/runtime), 2024. Rank 1. Backs: the `LegacyExceptionHandling` setting exists in .NET 9. [^src-clrconfig9]
- [clrconfigvalues.h, release/10.0](https://github.com/dotnet/runtime/blob/release/10.0/src/coreclr/inc/clrconfigvalues.h) — .NET team (dotnet/runtime), 2025. Rank 1. Backs: the .NET 10 runtime no longer defines `LegacyExceptionHandling`. [^src-clrconfig10]

## Related
- `dotnet/errors-and-resources/disposal-and-finalization.md` — `using` and `finally` for cleanup, and why a finalizer must not throw.
- `dotnet/async/tasks-and-async-await.md` — exceptions stored in tasks, `await` versus `.Wait()`, `async void`.
- `dotnet/collections-and-linq/iterators.md` — why an exception in an iterator appears at `MoveNext`, and the split-method fix for argument checks.
- `dotnet/fundamentals/types-values-and-conversions.md` — `checked` and `unchecked` arithmetic.
- `dotnet/tooling/analyzers-and-code-quality.md` — CA2200 and the other exception rules.
