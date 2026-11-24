---
schema: knowledge-doc/v1
type: concept
topic: go/runtime
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "container-aware GOMAXPROCS: Go ≥ 1.25 with a `go 1.25` or later line in go.mod", "linux/arm64 lab; the mechanism is the same on other platforms"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, runtime, scheduler, goroutine, gmp, gomaxprocs, preemption, sysmon, netpoller, stack, containers, cgroups]
ranked-sources: true
---

# The Go scheduler and goroutine stacks

## Summary
**TL;DR:** The Go runtime runs many goroutines (G) on a few operating-system threads (M). A thread may run Go code only while it holds a P ("processor"), and there are exactly `GOMAXPROCS` Ps, so `GOMAXPROCS` caps how many goroutines run at the same moment. Each P keeps its own queue of ready goroutines; idle Ps steal from busy ones, a background monitor (sysmon) preempts goroutines that run longer than about 10 ms and takes Ps away from threads stuck in system calls, and the network poller wakes goroutines whose sockets are ready. Each goroutine starts with a 2 KiB stack that grows by copying. Since Go 1.25 the default `GOMAXPROCS` follows a container's CPU limit.
**Use this when:** you need to reason about how many goroutines really run in parallel, why a service in a container uses the CPU it does, what blocking or a tight loop does to other goroutines, or why 100,000 goroutines are cheap.
**Not this doc:** goroutine and channel semantics → `go/concurrency/goroutines-and-channels.md`; memory allocation and the garbage collector → `go/runtime/memory-allocation-and-gc.md`; how the Linux kernel schedules threads → `linux/processes/cpu-scheduling.md`; container CPU throttling → `kubernetes/cpu-limits-and-throttling.md`.

## Problem
A goroutine looks like a thread, but it is not one. Without the scheduler's model, common questions have no answer: why a program with 100,000 goroutines uses only a handful of threads, why a service with a 2-CPU container limit ran 8 goroutines in parallel before Go 1.25 (and got throttled), why one goroutine stuck in a loop with no function calls could once freeze a program, and why a goroutine that waits on a socket costs no thread at all.

## Mental model
**Analogy:** a kitchen. Orders (goroutines, **G**) wait on ticket rails. Cooks (threads, **M**) do the work, but a cook may only cook while standing at a stove (**P**), and the kitchen has exactly `GOMAXPROCS` stoves. Each stove has its own small rail of tickets; a cook with an empty rail first checks the shared rail now and then, then takes half of another stove's tickets. A cook who leaves to wait for a delivery (a system call) stops cooking but at first still holds the stove; if the wait drags on, the floor manager hands that stove to another cook. A floor manager (**sysmon**) walks around: an order hogging a stove for more than about 10 ms is put back on a rail, and a stove left idle by a waiting cook is handed to someone else.

**Artifact:** the three letters as the scheduler's source in `runtime/proc.go` (Go 1.27.4) names them, in our words ✅[^2]:

| Letter | What it stands for |
|---|---|
| G | a goroutine |
| M | a worker thread, which the source also calls a "machine" |
| P | a processor: the resource a thread must hold to execute Go code |

The same comment adds that an M needs a P to run Go code, but can be blocked or in a system call without one ✅[^2].

## How it works

**5 actors:**
- **G (goroutine)** — its job: hold the code to run and its stack, via a `g` object that the runtime reuses after the goroutine exits ✅[^3].
- **M (thread)** — its job: execute code, via an operating-system thread; any number can exist, because any number may be blocked in system calls ✅[^3].
- **P (processor)** — its job: grant the right and the per-CPU state (run queue, allocator cache) to run Go code, via exactly `GOMAXPROCS` `p` objects ✅[^3].
- **sysmon** — its job: watch for goroutines that run too long and Ps stuck in system calls, via a dedicated thread that runs without a P ✅[^2].
- **Network poller** — its job: report which goroutines' file descriptors are ready, via the operating system's readiness API (epoll, kqueue and others) ✅[^7].

```
                 ┌──────────── global run queue (shared, locked) ◄─── overflow / batches
                 │
 P0: runnext + local queue [256] ──► M (thread) runs G ──► blocks? ── channel/mutex ──► G parks (no thread used)
 P1: runnext + local queue [256] ──► M runs G               │
  ▲   empty? 1. every 61st tick: global queue               ├─ network I/O ──► netpoller watches fd ──► G runnable again
  │          2. own queue  3. global queue (batch)          │
  │          4. netpoll    5. steal half of another P's     └─ system call ──► M keeps G, P handed off by sysmon
  │                                                                           (after ≥ 20 µs) to another M
 sysmon (own thread, no P): G on same P > 10 ms ──► preempt (signal) ──► G back on a queue
```

1. **`go f()` (the running G's thread, via `newproc`):**
   - The runtime creates a G and puts it in the current P's `runnext` slot, so it runs next ✅[^2].
   - A P's local queue holds 256 goroutines ✅[^4]; when it is full, the goroutine and a batch of the local queue move to the global run queue ✅[^2].
2. **Picking the next G (the thread that owns a P, via `findRunnable`):**
   - On every 61st scheduling round the thread checks the global queue first, so two goroutines that keep re-spawning each other cannot starve it ✅[^2].
   - Otherwise it tries, in order: its own local queue, a batch from the global queue, a non-blocking network poll, then stealing ✅[^2].
   - Stealing takes half of another P's local queue, trying other Ps in random order ✅[^2]. At most half as many threads as busy Ps may be "spinning" (searching for work), which saves CPU when parallelism is low ✅[^2].
3. **Blocking on a channel, mutex or timer (the runtime, in the blocked G's thread):** the G parks and its thread goes back to step 2 for another G. Waiting on Go synchronization holds no thread: the lab parked 100,000 goroutines on one channel with 9 threads in total ✅[^1], and a new thread is only created for the cases in step 5 ✅[^9].
4. **Blocking on the network (G, netpoller):**
   - The netpoller arms edge-triggered notifications for the descriptor ✅[^7] (the kernel side is explained in `linux/networking/epoll-edge-triggered-deep-dive.md`).
   - When a thread looks for work it polls the network and makes the goroutines whose descriptors are ready runnable ✅[^2] ✅[^7].
5. **Blocking in a system call (M, sysmon):**
   - An M in a system call stops executing Go code and no longer needs its P; to run Go code again after the call it must hold a P again ✅[^3].
   - The P is not handed over at once: sysmon retakes a P that has sat in a system call for more than one sysmon tick (at least 20 µs) and hands it to another thread ✅[^2]. A new thread is created only when a goroutine is ready but every thread is blocked in a system call, a cgo call, or locked to a goroutine ✅[^9].
6. **Preemption (sysmon, then the signalled thread):**
   - A goroutine that has run on the same P for 10 ms (`forcePreemptNS`) gets a preemption request ✅[^2].
   - Synchronous preemption reuses the stack check at the start of each function: the runtime poisons the stack bound so the next check enters the scheduler ✅[^6].
   - Asynchronous preemption suspends the thread with a signal and, when the goroutine is at a safe point, makes it call `asyncPreempt`, which saves the registers and enters the scheduler ✅[^6]. This reaches even loops with no function calls (Edge cases).
7. **Stacks (the function prologue, `morestack`, `copystack`):**
   - A goroutine's stack starts at `stackMin = 2048` bytes ✅[^5] and grows or shrinks as needed ✅[^3].
   - Most functions start with a prologue that compares the stack pointer with the goroutine's stack bound and calls `morestack` when more space is needed (functions marked `//go:nosplit` have none) ✅[^3]; the runtime then allocates a stack twice as large and copies the old one into it ✅[^5].
   - The maximum is 1 GB on 64-bit systems and 250 MB on 32-bit systems; `runtime/debug.SetMaxStack` changes it ✅[^2] ✅[^9].
8. **`GOMAXPROCS` (the runtime at start-up and about once per second):**
   - The `GOMAXPROCS` environment variable wins when it is a positive number. Otherwise the default is the minimum of the logical CPU count, the CPU affinity mask, and, on Linux, the cgroup CPU limit (quota ÷ period, from `cpu.max` in cgroup v2), rounded up, and never below 2 unless the CPU count or affinity mask is below 2 ✅[^8].
   - The runtime re-checks those values and updates the default, at most once per second ✅[^8]. Both behaviours are new in Go 1.25; before, the default was `runtime.NumCPU` ✅[^10].
   - The CPU request of a container is not considered, only its limit ✅[^10] ✅[^11].

## Worked example
One program, run in the lab, that parks 100,000 goroutines on a channel and then reads the runtime's own numbers:

```go
block := make(chan struct{})
for range 100_000 {
	started.Add(1)
	go func() { started.Done(); <-block }() // every goroutine waits here
}
started.Wait()
// then: runtime.NumGoroutine(), Threads: from /proc/self/status, MemStats.StackInuse delta
```
```console
goroutines: 100001
OS threads: 9
stack memory: 195 MiB, 2050 bytes per goroutine
```
100,001 goroutines (the 100,000 plus `main`) ran on 9 operating-system threads, and each parked goroutine cost about 2 KiB of stack, matching `stackMin` ✅[^1] ✅[^5].

The same tiny program printing `runtime.NumCPU()` and `runtime.GOMAXPROCS(0)`, built with `go 1.27` in go.mod, under different Docker CPU settings on an 8-CPU machine ✅[^1], as shown below:

| Docker flags | `/sys/fs/cgroup/cpu.max` | NumCPU | GOMAXPROCS | Rule that applies |
|---|---|---|---|---|
| none | `max 100000` | 8 | 8 | no limit: CPU count ✅[^8] |
| `--cpus=2` | `200000 100000` | 8 | 2 | quota ÷ period = 2 ✅[^8] |
| `--cpus=1.5` | `150000 100000` | 8 | 2 | 1.5 rounded up ✅[^8] |
| `--cpus=1` | `100000 100000` | 8 | 2 | never below 2 when the CPU count is ≥ 2 ✅[^8] |
| `--cpuset-cpus=0` | `max 100000` | 1 | 1 | affinity mask of 1 CPU ✅[^8] |
| `--cpus=2`, go.mod says `go 1.24` | `200000 100000` | 8 | 8 | old default for language version ≤ 1.24 ✅[^8] |
| `--cpus=2`, `GOMAXPROCS=6` | `200000 100000` | 8 | 6 | the environment variable wins ✅[^8] |
| `--cpus=2`, `GODEBUG=containermaxprocs=0` | `200000 100000` | 8 | 8 | container awareness switched off ✅[^10] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A goroutine spins in `for i := 0; ; i++ {}` with `GOMAXPROCS(1)` | `main`, asked to sleep 1 ms, ran again after 9–14 ms in six lab runs ✅[^1] | sysmon preempts after 10 ms and the signal-based preemption stops the loop ✅[^2] ✅[^6] |
| The same loop with `GODEBUG=asyncpreemptoff=1` | The program never finished; `timeout 5` killed it (exit 124) ✅[^1] | Without signal-based preemption some loops cannot be preempted for long periods, which may delay the GC and goroutine scheduling ✅[^8] |
| Module with `go 1.24` (or lower) in go.mod, built by Go 1.27 | Container limits are ignored: GOMAXPROCS 8 under `--cpus=2` ✅[^1] | `containermaxprocs=0` and `updatemaxprocs=0` are the defaults for language version 1.24 and below ✅[^8] |
| Infinite recursion | `runtime: goroutine stack exceeds 1000000000-byte limit` then `fatal error: stack overflow` ✅[^1] | The 1 GB 64-bit maximum stack ✅[^2] |
| `runtime.LockOSThread()` | The goroutine saw 1 thread ID across 200 sleeps, against 6 without the lock ✅[^1]; if it exits without unlocking, its thread is terminated ✅[^8] | It wires the goroutine to its thread until the goroutine has called `UnlockOSThread` as many times as `LockOSThread`; no other goroutine runs on that thread ✅[^8] |
| More than 10,000 threads (many goroutines blocked in system calls or cgo) | The program crashes ✅[^9] | `runtime/debug.SetMaxThreads` default of 10,000 |
| `runtime.Gosched()` | Lets other goroutines run; the caller is not suspended and resumes automatically ✅[^8] | It gives up the P, but the goroutine stays runnable |
| Very spiky workload under a CPU limit (Go ≥ 1.25) | May see more latency than before ✅[^11] | `GOMAXPROCS` now caps short bursts of extra threads that the 100 ms CPU quota would have allowed ✅[^11] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Default `GOMAXPROCS` (Go ≥ 1.25) | Matches the container CPU limit; avoids CPU throttling that pauses the whole application for the rest of the throttling period, typically 100 ms ✅[^11] | Spiky workloads lose short bursts above the limit ✅[^11] |
| Setting `GOMAXPROCS` by hand | Full control, e.g. when only a CPU request is set and the default stays at the machine's CPU count ✅[^11] | Turns off automatic updates when the limit changes ✅[^8] |
| Many goroutines instead of a worker pool | About 2 KiB each, no thread per goroutine ✅[^1] | Each parked goroutine keeps its stack until it exits: 100,000 held 195 MiB in the lab ✅[^1] |

## Takeaways
- Use a `go 1.25` or later line in go.mod for services that run under a container CPU limit, or set `GOMAXPROCS` explicitly; a `go 1.24` line keeps the old, limit-blind default even with a new toolchain. [rule-candidate]
- Do not set `GODEBUG=asyncpreemptoff=1` except to debug; it lets a call-free loop stall the GC and every other goroutine on that P. [rule-candidate]
- Call `runtime.LockOSThread` before using operating-system or C library state that is per-thread, and always pair it with `UnlockOSThread`. [rule-candidate]
- Parked goroutines are cheap (about 2 KiB in the lab), but `GOMAXPROCS`, not the goroutine count, decides how much Go code runs at once.

## Verification status
- Verified: 69 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24 (OrbStack, 8 logical CPUs, cgroup v2). [^1]
- [runtime/proc.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/proc.go) — Go team, 2026. Rank 1. Backs: G/M/P definitions, `newproc` and `runnext`, `findRunnable` order and the 61-tick fairness check, spinning limit, `runqsteal` (half), sysmon's 20 µs–10 ms sleep and `retake`, `forcePreemptNS` = 10 ms, maximum stack 1 GB / 250 MB. [^2]
- [runtime/HACKING.md at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/HACKING.md) — Go team, 2026. Rank 1. Backs: Gs, Ms and Ps; exactly GOMAXPROCS Ps; an M gives up its P in a system call; user stacks start small and grow; the `morestack` prologue. [^3]
- [runtime/runtime2.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/runtime2.go) — Go team, 2026. Rank 1. Backs: the 256-slot local run queue and the `runnext` slot. [^4]
- [runtime/stack.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/stack.go) — Go team, 2026. Rank 1. Backs: `stackMin = 2048`; `newsize := oldsize * 2`; `copystack`; the stack-overflow message. [^5]
- [runtime/preempt.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/preempt.go) — Go team, 2026. Rank 1. Backs: safe points; synchronous preemption via the stack bound; asynchronous preemption via signals and `asyncPreempt`. [^6]
- [runtime/netpoll.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/runtime/netpoll.go) — Go team, 2026. Rank 1. Backs: the integrated network poller and its epoll/kqueue back ends; edge-triggered arming; `netpoll` returns a list of goroutines. [^7]
- [Package runtime](https://pkg.go.dev/runtime) — Go team, living. Rank 1. Backs: `GOMAXPROCS` default, updates, rounding and the minimum of 2; `containermaxprocs`/`updatemaxprocs` defaults for language version ≤ 1.24; `Gosched`; `LockOSThread`; `NumGoroutine`; `asyncpreemptoff`. [^8]
- [Package runtime/debug](https://pkg.go.dev/runtime/debug) — Go team, living. Rank 1. Backs: `SetMaxStack` defaults; `SetMaxThreads` default 10,000 and when new threads are created. [^9]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: container-aware GOMAXPROCS, the CPU request is not considered, `GODEBUG=containermaxprocs=0`. [^10]
- [Container-aware GOMAXPROCS](https://go.dev/blog/container-aware-gomaxprocs) — Go team (Michael Pratt, Carlos Amedee), 2025. Rank 4. Backs: why throttling hurts tail latency, the 100 ms period, parallelism versus throughput limits, spiky workloads, CPU requests. [^11]

## Related
- `go/learning-path.md` — where this doc sits in the learning order.
- `go/concurrency/goroutines-and-channels.md` — the language-level view of goroutines.
- `go/runtime/memory-allocation-and-gc.md` — stacks and heap from the allocator's side.
- `go/runtime/profiling-and-diagnostics.md` — seeing the scheduler in execution traces.
- `kubernetes/cpu-limits-and-throttling.md` — the kernel side of CPU limits.
- `linux/processes/cpu-scheduling.md` — how the kernel schedules the Ms.
- `linux/networking/epoll-edge-triggered-deep-dive.md` — the readiness API under the netpoller.
