---
schema: knowledge-doc/v1
type: how-to
topic: go/runtime
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "goroutineleak profile: Go ≥ 1.27 (experiment in 1.26)", "trace flight recorder: Go ≥ 1.25", "pprof flame-graph default: Go ≥ 1.26", "PGO default.pgo: Go ≥ 1.21"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, profiling, pprof, cpu-profile, heap-profile, goroutine-leak, execution-trace, flight-recorder, pgo, diagnostics, runtime-metrics, schedtrace, godebug]
ranked-sources: true
---

# Profile a Go program: CPU, memory, goroutine leaks, traces and PGO

## Summary
**TL;DR:** Collect a profile with `go test -cpuprofile/-memprofile` (benchmarks), `runtime/pprof` (any program) or `import _ "net/http/pprof"` (a running service), then read it with `go tool pprof -top` or its web UI, which opens on a flame graph since Go 1.26. The same machinery gives goroutine, block, mutex and, since Go 1.27, `goroutineleak` profiles; `go test -trace` and `runtime/trace` (with a flight recorder since Go 1.25) record what every goroutine did over time. A CPU profile saved as `default.pgo` next to `main` makes `go build` apply profile-guided optimization (PGO).
**Use this when:** something in a Go program is slow, allocates too much, leaks goroutines, or waits on locks, and you need evidence before changing code; you want a free 2–14% speed-up from PGO; or you want GC and scheduler numbers from inside a running program (`runtime/metrics`, `GODEBUG=schedtrace`).
**Not this doc:** how sampling profilers and flame graphs work in general → `performance/measurement/profiling-and-flame-graphs.md`; writing benchmarks → `go/tooling/testing-benchmarks-and-fuzzing.md`; what the GC numbers mean → `go/runtime/memory-allocation-and-gc.md`.

## Goal & prerequisites
**End state:** a CPU and an allocation profile whose top entries name the code to fix, a goroutine-leak report, an execution trace file, a binary built with PGO, and runtime metrics and scheduler trace lines read from the running program, all without leaving the terminal.

**Needs:**
- Go 1.27 (the lab in `go/lab-setup.md`; every command below ran there). `go tool pprof` and `go tool trace` ship with Go.
- A benchmark or a program that does the work you want to measure. The examples use a package `report` with `Slow` (string `+=` in a loop) and `Fast` (`strings.Builder`), each building a 2,000-item list.
- For live services: network access to the service's debug port. Expose it on localhost only, since the profiles reveal stack traces and command lines.
- One profile at a time: profiles collected together can interfere with each other ✅[^2].

## Steps
1. **Profile a benchmark.** `go test` writes CPU and memory profiles directly ✅[^8], as shown below:
   ```console
   $ go test -bench . -benchmem -cpuprofile cpu.prof -memprofile mem.prof -trace trace.out
   BenchmarkSlow-8   	     244	   4324598 ns/op	 8895617 B/op	    3902 allocs/op
   BenchmarkFast-8   	   12764	     94459 ns/op	   41196 B/op	    1915 allocs/op
   ```
   `Slow` took 46× the time and 216× the bytes of `Fast` in this run ✅[^1].
2. **Read the CPU profile as text.** `-top` prints the hottest functions ✅[^8]. The CPU profiler samples the running goroutine's stack about 100 times per second; `flat` counts samples in which the function itself was running, `cum` the samples in which it was anywhere on the stack (running or waiting for a callee), and `sum%` is the running total ✅[^11], as shown below:
   ```console
   $ go tool pprof -top -nodecount=4 cpu.prof
   Duration: 2.31s, Total samples = 2150ms (93.23%)
         flat  flat%   sum%        cum   cum%
        520ms 24.19% 24.19%      520ms 24.19%  runtime.memmove
        170ms  7.91% 32.09%      190ms  8.84%  runtime.unlock2
        120ms  5.58% 37.67%      320ms 14.88%  runtime.mallocgcTinySC2
        100ms  4.65% 42.33%      100ms  4.65%  internal/strconv.formatBase10
   ```
   Copying bytes (`memmove`) and allocating dominate ✅[^1]; `mallocgcTinySC2` is one of the size-specialized allocation routines that Go 1.27 added ✅[^7].
3. **Read the memory profile by allocated bytes.** A heap profile has four views (`inuse_space`, `inuse_objects`, `alloc_space`, `alloc_objects`); to cut GC cost, `alloc_space` is usually the most useful because it follows the allocation rate ✅[^3], as shown below:
   ```console
   $ go tool pprof -sample_index=alloc_space -top -nodecount=3 mem.prof
         flat  flat%   sum%        cum   cum%
    2067.22MB 79.70% 79.70%  2072.22MB 79.89%  example.com/report.Slow
     427.39MB 16.48% 96.18%   427.39MB 16.48%  strings.(*Builder).WriteString (inline)
       85.50MB  3.30% 99.47%    85.50MB  3.30%  internal/strconv.FormatInt
   ```
   The fix is in `Slow` ✅[^1].
4. **Profile a program that is not a test.** Call `pprof.StartCPUProfile(f)` and `defer pprof.StopCPUProfile()` at the start of `main`; for memory, call `runtime.GC()` and then `pprof.Lookup("allocs").WriteTo(f, 0)` (or `"heap"` for live objects) ✅[^8].
5. **Profile a running service.** Import the HTTP handlers and serve them on localhost ✅[^9], as shown below:
   ```go
   import _ "net/http/pprof" // registers /debug/pprof/ on http.DefaultServeMux

   go func() { log.Println(http.ListenAndServe("localhost:6060", nil)) }()
   ```
   ```console
   $ go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30   # 30 s CPU profile
   $ go tool pprof http://localhost:6060/debug/pprof/heap                 # live heap
   $ curl -o trace.out http://localhost:6060/debug/pprof/trace?seconds=5  # 5 s execution trace
   ```
   The index page `/debug/pprof/` listed `allocs`, `block`, `cmdline`, `goroutine`, `goroutineleak`, `heap`, `mutex`, `profile`, `symbol`, `threadcreate` and `trace` in the lab ✅[^1]. With your own `ServeMux`, register the exported handlers yourself ✅[^2] ✅[^9].
6. **Turn on block and mutex profiles when you suspect waiting.** They are off by default: call `runtime.SetBlockProfileRate` and `runtime.SetMutexProfileFraction` first ✅[^2]. The block profile covers time blocked on `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, `sync.Cond` and channel operations; the mutex profile covers holders of contended locks ✅[^8].
7. **Find leaked goroutines (Go ≥ 1.27).** The `goroutineleak` profile lists goroutines blocked on a channel, mutex or other primitive that nothing reachable can ever unblock; the runtime finds them with the garbage collector ✅[^7]. A function that starts 10 senders on an unbuffered channel and returns at the first error:
   ```console
   $ go run main.go          # main calls pprof.Lookup("goroutineleak").WriteTo(os.Stdout, 1)
   process: item 0 failed
   goroutines alive: 9
   goroutineleak profile: total 8
   8 @ 0x88198 0x21214 0x20e28 0xdbe34 0x8dfb4
   #	0xdbe33	main.process.func1+0x83	/src/main.go:29
   ```
   Line 29 is `ch <- result{v, err}`: eight senders wait forever ✅[^1]. Over HTTP the same profile is `/debug/pprof/goroutineleak` ✅[^7]. The leak itself, its cause and the buffered-channel fix are walked through in `go/concurrency/patterns-and-goroutine-leaks.md`.
8. **Record an execution trace.** A trace captures goroutine creation, blocking and unblocking, system calls, GC events, heap size changes and processor start and stop, with nanosecond timestamps ✅[^10]. Collect it with `go test -trace=trace.out` or `runtime/trace`, then open it with `go tool trace trace.out` (a web UI) or convert it to a profile, for example the scheduler-latency view with `go tool trace -pprof=sched trace.out` ✅[^1]. To catch a rare event, a `trace.FlightRecorder` (Go ≥ 1.25) keeps the last few seconds in memory, and `FlightRecorder.WriteTo` saves them when the event happens ✅[^5].
9. **Use the web UI.** `go tool pprof -http=localhost:8080 cpu.prof` opens a browser view; since Go 1.26 it starts on the flame graph, and the old graph view is under *View → Graph* or `/ui/graph` ✅[^6]. Read the flame graph as `performance/measurement/profiling-and-flame-graphs.md` explains.
10. **Build with PGO.** Save a representative CPU profile as `default.pgo` in the main package's directory; `go build` picks it up because `-pgo=auto` is the default (since Go 1.21) ✅[^4], as shown below:
    ```console
    $ ./app -cpuprofile default.pgo     # a run with representative load
    $ go build -o app-pgo .
    $ go version -m app-pgo | grep pgo
    	build	-pgo=/src/default.pgo
    ```
    The Go team measured a 2–14% improvement across a set of programs as of Go 1.22 ✅[^4]. Merge several profiles with `go tool pprof -proto a.pprof b.pprof > merged.pprof` ✅[^4]. What PGO changes in the generated code is in `go/runtime/compiler-optimizations.md`.
11. **Read the runtime's own counters from inside the program (`runtime/metrics`).** A profile is taken on demand; metrics are running totals and gauges the runtime keeps, which you can read at any time, like a car's dashboard next to the mechanic's full diagnosis. The package is a stable, more general interface than `runtime.ReadMemStats` to metrics the runtime exports ✅[^12].
    - *Names:* each metric is a string key made of a path, a colon and a unit, such as `/gc/heap/goal:bytes` ✅[^12].
    - *Discovery:* `metrics.All()` returns a `Description` for every supported metric: its name, an English description, its kind (`KindUint64`, `KindFloat64` or `KindFloat64Histogram`) and whether it is cumulative ✅[^12]. A metric's kind never changes; if its meaning must change, a new key is added instead ✅[^12].
    - *Reading:* put the names in a `[]metrics.Sample` and call `metrics.Read`; reusing the slice is allowed, but its values must not be read while a `Read` on it is running, and a name the runtime does not know comes back as `KindBad` ✅[^12].
    ```go
    samples := []metrics.Sample{{Name: "/gc/heap/goal:bytes"}, {Name: "/sched/latencies:seconds"}}
    metrics.Read(samples)
    goal := samples[0].Value.Uint64()            // KindUint64
    lat := samples[1].Value.Float64Histogram()   // KindFloat64Histogram: Counts and Buckets
    ```
    A run with 100 goroutines that allocate and then wait on a channel ✅[^1], as shown below:
    ```console
    metrics.All: 108 metrics (uint64 88, float64 12, histogram 8; cumulative 76)
    /sched/goroutines:goroutines             114
    /sched/goroutines/waiting:goroutines     49
    /sched/goroutines/runnable:goroutines    58
    /sched/goroutines/running:goroutines     7
    /sched/goroutines/not-in-go:goroutines   0
    /gc/cycles/total:gc-cycles               50
    /gc/heap/goal:bytes                      4194304
    /gc/gogc:percent                         100
    /memory/classes/total:bytes              26630408
    /sched/latencies:seconds                 histogram: 162 buckets, 1005 samples
    /no/such/metric:bytes                    KindBad (unknown name)
    ```
    What each one reports, as the package defines it ✅[^12].

    | Metric | Reports |
    |---|---|
    | `/sched/goroutines:goroutines` | live goroutines |
    | `/sched/goroutines/waiting`, `/runnable`, `/running` (`:goroutines`) | approximate counts per state, not guaranteed to add up to the total |
    | `/gc/cycles/total:gc-cycles` | completed GC cycles |
    | `/gc/heap/goal:bytes` | the heap size target for the end of the GC cycle |
    | `/gc/gogc:percent` | the `GOGC` setting, 100 unless set |
    | `/memory/classes/total:bytes` | all memory the runtime mapped read-write, without memory mapped by cgo or `syscall` |
    | `/sched/latencies:seconds` | distribution of time goroutines spent runnable before running |
    | `/sync/mutex/wait/total:seconds` | approximate total time blocked on `sync.Mutex`, `sync.RWMutex` or runtime locks |
    | `/cpu/classes/gc/total:cpu-seconds` | estimated GC CPU time: an overestimate, comparable only with other `/cpu/classes` metrics |

    In five runs of the same program the waiting count ranged from 32 to 111 as the workers reached the channel at different times; the three state counts summed to the total in every run that read them ✅[^1].
12. **Watch the scheduler with `GODEBUG=schedtrace=X`.** It makes the scheduler print one summary line to standard error every X milliseconds; adding `scheddetail=1` prints detailed lines for the scheduler, each processor (P), thread (M) and goroutine ✅[^13]. Set it on the built binary, not through `go run` (see `go/runtime/memory-allocation-and-gc.md` for why).
    ```console
    $ GODEBUG=schedtrace=50 ./app
    SCHED 55ms: gomaxprocs=8 idleprocs=1 threads=10 spinningthreads=2 needspinning=0 idlethreads=1 runqueue=0 [ 0 0 0 0 0 0 0 0 ] schedticks=[ 11223 69 83 28 20 47 85 58 ]
    ```
    The fields, as the runtime's `schedtrace` function prints them and the scheduler's field comments describe them ✅[^14] ✅[^15].

    | Field | Meaning |
    |---|---|
    | `SCHED 55ms` | milliseconds since the first trace line |
    | `gomaxprocs`, `idleprocs` | the `GOMAXPROCS` value; Ps currently idle |
    | `threads`, `idlethreads` | threads (Ms) the runtime has, created minus freed; idle Ms waiting for work |
    | `spinningthreads` | Ms out of local work that found none in the global run queue or the network poller and keep looking |
    | `needspinning` | 1 asks an M that is about to give up its P to stay and look for work instead, so newly found work is not left without a thread |
    | `runqueue` | length of the global run queue |
    | `[ … ]` | length of each P's local run queue |
    | `schedticks=[ … ]` | per P, a counter incremented on every scheduler call |

    What Ps, Ms and run queues are is explained in `go/runtime/scheduler-and-goroutine-stacks.md`.

## Verify
| Check | Command | Expected |
|---|---|---|
| CPU profile has samples | `go tool pprof -top cpu.prof` | A `Total samples = …` line and your functions near the top ✅[^1] |
| Memory profile points at the allocating code | `go tool pprof -sample_index=alloc_space -top mem.prof` | The allocating function (here `report.Slow`) first ✅[^1] |
| Endpoints are served | `curl localhost:6060/debug/pprof/goroutine?debug=1` | HTTP 200 and a first line `goroutine profile: total <n>` ✅[^1] |
| Leak profile is empty for a healthy program | `/debug/pprof/goroutineleak?debug=1` | `total 0`; the lab's healthy server showed 0 ✅[^1] |
| PGO was applied | `go version -m <binary>` | A `build -pgo=<path>` line; it is absent with `-pgo=off` ✅[^1] |
| A metric name is right | `metrics.Read` on a one-element sample | Any kind except `KindBad`; the misspelt `/no/such/metric:bytes` came back `KindBad` ✅[^1] |
| The scheduler trace is on | `GODEBUG=schedtrace=50 ./app 2>&1 \| grep SCHED` | One `SCHED <n>ms: gomaxprocs=…` line about every 50 ms ✅[^1] |

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `POST /debug/pprof/heap` returns 405 | Since Go 1.22 every pprof path must be requested with `GET` ✅[^9]; the lab saw 405 ✅[^1] | Use `GET` (what `go tool pprof` and `curl` do by default) |
| Block or mutex profile is empty | Both are off by default ✅[^2] | Call `runtime.SetBlockProfileRate` / `runtime.SetMutexProfileFraction` early in `main` |
| Heap profile misses the most recent allocations | It reports figures as of the last completed GC ✅[^8] | Use `?gc=1` on the endpoint ✅[^9], or call `runtime.GC()` before writing it |
| A known leak is not in `goroutineleak` | Detection uses reachability, so a primitive reachable from a global or a running goroutine's locals hides the leak ✅[^7] | Combine it with the plain `goroutine` profile and look for many identical stacks |
| `go tool trace -http=:6060` cannot be reached from another machine | Since Go 1.27 a port-only address listens on localhost only ✅[^7] | Pass `-http=0.0.0.0:6060` explicitly, and only on a trusted network |
| PGO gives no speed-up | The profile does not match production behaviour ✅[^4] | Collect profiles from production, or merge several representative ones ✅[^4] |
| Service slows down while profiling | CPU profiling has a cost in production ✅[^2] | Profile one replica at a time for a short window ✅[^2] |
| `Value.Uint64()` panics on a metric | The metric has another kind, or the name is unknown and the kind is `KindBad` ✅[^12] | Check `Value.Kind()` first, or take names from `metrics.All()` ✅[^12] |
| `/sched/goroutines/waiting` plus the other states does not equal `/sched/goroutines` | The state counts are approximate ✅[^12] | Use the total for alerts; use the states for trends |

## Rollback
Profiling changes nothing persistent. Delete `cpu.prof`, `mem.prof`, `trace.out` and `default.pgo` (removing `default.pgo` turns PGO off again ✅[^4]), and remove the `net/http/pprof` import if the service should not expose debug endpoints.

## Takeaways
- Profile before optimizing, and read `alloc_space` when the goal is lower GC cost. [rule-candidate]
- Serve `net/http/pprof` on localhost or an internal-only port, never on the public listener. [rule-candidate]
- Check `goroutineleak` (Go ≥ 1.27) in tests and in production when the goroutine count keeps growing.
- Commit a representative `default.pgo` for long-running services and refresh it regularly. [rule-candidate]

## Verification status
- Verified: 59 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24 (OrbStack, 8 logical CPUs, arm64), including the `runtime/metrics` and `schedtrace` runs. [^1]
- [Diagnostics](https://go.dev/doc/diagnostics) — Go team, living. Rank 1. Backs: the predefined profiles, block and mutex off by default, profiling cost in production, one profile at a time, custom handler paths. [^2]
- [A Guide to the Go Garbage Collector](https://go.dev/doc/gc-guide) — Go team, living. Rank 1. Backs: the four heap-profile views and why `alloc_space` matters for GC cost. [^3]
- [Profile-guided optimization](https://go.dev/doc/pgo) — Go team, living. Rank 1. Backs: `default.pgo`, `-pgo=auto` default since Go 1.21, `-pgo=off`, 2–14% as of Go 1.22, representative profiles, merging. [^4]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: `runtime/trace.FlightRecorder` and `WriteTo`. [^5]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: the pprof web UI defaults to the flame graph. [^6]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: the `goroutineleak` profile is generally available, how it detects leaks and what it can miss; `go tool trace -http` on localhost; size-specialized allocation. [^7]
- [Package runtime/pprof](https://pkg.go.dev/runtime/pprof) — Go team, living. Rank 1. Backs: `go test -cpuprofile -memprofile`, `StartCPUProfile`, `Lookup("allocs")`, the predefined profiles, the heap profile's last-GC rule, block and mutex profile contents. [^8]
- [Package net/http/pprof](https://pkg.go.dev/net/http/pprof) — Go team, living. Rank 1. Backs: the side-effect import, `/debug/pprof/` paths, GET-only since Go 1.22, `seconds` and `gc` parameters, usage examples. [^9]
- [Package runtime/trace](https://pkg.go.dev/runtime/trace) — Go team, living. Rank 1. Backs: what an execution trace records; `go test -trace`. [^10]
- [Package runtime/metrics (go1.27.4)](https://pkg.go.dev/runtime/metrics@go1.27.4) — Go team, 2026. Rank 1. Backs: the stable interface, key format, `All`, `Description`, kinds, `Read` and its reuse rules, `KindBad`, the definitions of each metric quoted. [^12]
- [Package runtime](https://pkg.go.dev/runtime) — Go team, living. Rank 1. Backs: `GODEBUG=schedtrace=X` and `scheddetail=1`. [^13]
- [runtime/proc.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/proc.go) — Go team, 2026. Rank 1. Backs: the `schedtrace` line format and its sources; the definition of a spinning thread; `needspinning`. [^14]
- [runtime/runtime2.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/runtime2.go) — Go team, 2026. Rank 1. Backs: the comments on `nmidle`, the global run queue and `schedtick`. [^15]
- [Profiling Go Programs](https://go.dev/blog/pprof) — Go team (Russ Cox), 2011, updated 2013. Rank 4. Backs: about 100 samples per second; the meaning of the flat, sum and cum columns. [^11]

## Related
- `go/learning-path.md` — where this doc sits in the learning order.
- `go/runtime/memory-allocation-and-gc.md` — what to change once a heap profile names the code.
- `go/runtime/scheduler-and-goroutine-stacks.md` — what the scheduler events in a trace and the `schedtrace` fields mean.
- `go/runtime/compiler-optimizations.md` — what a PGO build changes in the machine code.
- `go/concurrency/patterns-and-goroutine-leaks.md` — patterns that leak goroutines and how to avoid them.
- `go/tooling/testing-benchmarks-and-fuzzing.md` — writing the benchmarks profiled here.
- `performance/measurement/profiling-and-flame-graphs.md` — sampling profilers and flame graphs in general.
