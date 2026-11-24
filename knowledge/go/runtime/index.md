---
schema: topic-index/v1
kind: subtopic
topic: go/runtime
last-updated: 2026-11-24
---

# The Go runtime

How the Go runtime runs and feeds a program: the scheduler that multiplexes goroutines (G) onto threads (M) through `GOMAXPROCS` processors (P), preemption, the network poller and growing goroutine stacks; the allocator, escape analysis and the concurrent garbage collector with `GOGC`, `GOMEMLIMIT`, Green Tea, cleanups and weak pointers; the compiler's optimizations (inlining, devirtualization, bounds-check elimination, dead-code elimination); and the tools that show what the runtime is doing (pprof profiles, goroutine-leak detection, execution traces, PGO, profile-guided optimization). Every behaviour was run in Go 1.27.4. Not covered: the language's concurrency primitives (see `go/concurrency/`), reflection and `unsafe` (see `go/low-level/`), kernel scheduling and container limits (see `linux/` and `kubernetes/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [scheduler-and-goroutine-stacks.md](scheduler-and-goroutine-stacks.md) | concept | G, M and P; local and global run queues and work stealing; sysmon, 10 ms preemption and signal-based async preemption; system calls and the netpoller; 2 KiB stacks that grow by copying; container-aware `GOMAXPROCS` (Go 1.25) measured under Docker CPU limits | verified |
| [memory-allocation-and-gc.md](memory-allocation-and-gc.md) | concept | Escape analysis and `-gcflags=-m`; the Go 1.27.4 size-class table, the tiny allocator and per-P caches; the concurrent mark-sweep cycle; Green Tea (default in Go 1.26); the `GOGC` target formula and `GOMEMLIMIT` measured; finalizers versus `AddCleanup`, weak pointers and `unique` | verified |
| [compiler-optimizations.md](compiler-optimizations.md) | concept | The compiler's phases, the inlining budget (80 nodes, 57 per call), devirtualization, bounds-check elimination, PGO and the linker's dead-code pass, read through `-m`, `check_bce`, `-S` and `objdump` | verified |
| [profiling-and-diagnostics.md](profiling-and-diagnostics.md) | how-to | CPU (central processing unit) and allocation profiles from `go test`, `runtime/pprof` and `net/http/pprof`; block, mutex and `goroutineleak` (Go 1.27) profiles; execution traces and the flight recorder; the flame-graph web user interface; PGO with `default.pgo`; `runtime/metrics` and `GODEBUG=schedtrace` read from a running program | verified |

## References
- [runtime/HACKING.md at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/HACKING.md) — Go team, 2026. Backs: subtopic scope (scheduler structures, stacks).
- [A Guide to the Go Garbage Collector](https://go.dev/doc/gc-guide) — Go team, living. Backs: subtopic scope (GC).
- [Diagnostics](https://go.dev/doc/diagnostics) — Go team, living. Backs: subtopic scope (profiling and tracing).

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `go/concurrency/` — goroutines, channels and the memory model.
- `go/low-level/` — reflection, `unsafe` and cgo.
- `performance/` — performance engineering across languages.
