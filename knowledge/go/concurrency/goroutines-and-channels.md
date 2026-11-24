---
schema: knowledge-doc/v1
type: concept
topic: go/concurrency
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "timer-channel rules: Go ≥ 1.23"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, goroutine, channel, select, close, nil-channel, deadlock, timer, time-after, asynctimerchan]
ranked-sources: true
---

# Goroutines, channels and `select`

## Summary
**TL;DR:** `go f()` runs `f` in a new goroutine and does not wait for it; the program ends when `main` returns, whatever other goroutines are doing. A channel passes values between goroutines: an unbuffered channel is a hand-to-hand meeting, a buffered one a shelf with a fixed number of slots. Five rules cover almost every surprise: receiving from a closed channel returns the zero value with `ok == false`, sending on a closed channel panics, closing a nil or closed channel panics, a nil channel blocks forever, and `select` picks a random ready case. Since Go 1.23 timer channels are unbuffered, and Go 1.27 removed the setting that undid that.
**Use this when:** starting goroutines, choosing between a buffered and an unbuffered channel, closing a channel, writing a `select` with a timeout, or reading a `fatal error: all goroutines are asleep - deadlock!`.
**Not this doc:** locks, `WaitGroup` and atomics → `go/concurrency/sync-and-atomics.md`; cancellation → `go/concurrency/context-and-cancellation.md`; why a channel makes a write visible → `go/concurrency/memory-model-and-data-races.md`; pipelines, worker pools and leaks → `go/concurrency/patterns-and-goroutine-leaks.md`.

## Problem
A goroutine that "should" print never does, because `main` returned first. A program crashes with `send on closed channel`. Another hangs on a channel that was never created with `make`. A timeout written with `len(timer.C)` stops working after an upgrade to Go 1.23. Each follows a fixed rule of the language or the `time` package; without the rules they look random.

## Mental model
**Analogy:** a goroutine is a worker you start with one word (`go`) and never hear from again unless you agree on a way to talk. A channel is a hatch between two rooms. An unbuffered hatch has no shelf: the sender holds the parcel until a receiver takes it. A buffered hatch has a shelf with *n* slots: the sender drops the parcel and leaves unless the shelf is full. `close` hangs a "no more deliveries" sign: receivers still empty the shelf, then get an empty box and the sign (zero value, `ok == false`). A nil channel is a hatch that was never built: whoever waits at it waits forever.

**Artifact:** run on Go 1.27.4 ✅[^1]:
```go
unbuf := make(chan int)    // unbuffered
buf := make(chan int, 2)   // buffered, 2 slots
fmt.Println(len(unbuf), cap(unbuf)) // 0 0
buf <- 1
buf <- 2                   // both fit; no receiver needed
fmt.Println(len(buf), cap(buf))     // 2 2
close(buf)
for v := range buf {       // 1, then 2, then the loop ends
	fmt.Println("range got", v)
}
v, ok := <-buf
fmt.Println(v, ok)         // 0 false
```

## How it works
**Goroutines.**
1. A `go` statement evaluates the function value and its arguments in the calling goroutine, then runs the call in a new goroutine without waiting; the goroutine ends when the function returns, and any return values are discarded ✅[^2].
2. Goroutines are cheap: a goroutine costs little more than its stack, stacks start small and grow as needed, and goroutines are multiplexed onto operating-system threads, so one blocked on input/output (I/O) does not stop the others ✅[^3].
3. The program runs `main.main` and exits when it returns, without waiting for other goroutines ✅[^2]. In the lab, a goroutine that slept 100 ms before printing never printed: `main` returned first and the exit code was 0 ✅[^1].

**Channels.** `make(chan T)` or `make(chan T, 0)` makes an unbuffered channel, `make(chan T, n)` a buffered one, and the zero value of a channel type is `nil` ✅[^2] ✅[^3]. Any number of goroutines may send, receive, and call `len` and `cap` on one channel without extra locking, and values come out in the order they were sent ✅[^2].

**One handoff on an unbuffered channel** — 3 actors:
- **Sender goroutine** — its job: offer a value, via `ch <- v`.
- **Channel** — its job: pair one sender with one receiver, via the runtime's channel object made by `make`.
- **Receiver goroutine** — its job: take the value, via `<-ch`, `v, ok := <-ch` or `range ch`.

```
[sender]                 [channel, cap 0]              [receiver]
ch <- 42 ─── blocks ───▶ no receiver yet
                                 │◀────────────────── <-ch arrives
                         value copied to receiver
send completes ◀──────── pair done ─────────────────▶ receive returns 42
```
1. **Sender:** evaluates the channel and the value first, then blocks until the send can proceed; on an unbuffered channel that means until a receiver is ready ✅[^2].
2. **Channel:** a receive blocks until a value is available ✅[^2]. Unbuffered communication combines the exchange of a value with synchronization: both goroutines are known to be at the same point ✅[^3].
3. **Buffered variant:** the sender only waits until the value is copied into the buffer, and waits for a receiver only when the buffer is full ✅[^3].

**What each operation does in each channel state** ✅[^2]:

| Operation | nil channel | open channel | closed channel |
|---|---|---|---|
| `ch <- v` | blocks forever | blocks until a receiver is ready (unbuffered) or there is room (buffered) | run-time panic |
| `<-ch`, `v, ok := <-ch` | blocks forever | blocks until a value arrives; `ok == true` | returns buffered values first, then the zero value at once with `ok == false` |
| `close(ch)` | run-time panic | allowed (compile error on a receive-only channel) | run-time panic |
| `for v := range ch` | blocks forever | yields each value sent until the channel is closed | yields the values still buffered, then ends |

The lab printed the three panic messages as `send on closed channel`, `close of closed channel` and `close of nil channel` ✅[^1].

**Directions.** `chan<- T` can only send and `<-chan T` can only receive; a bidirectional channel becomes directional by assignment or conversion ✅[^2]. Sending on a receive-only parameter is a compile error: `invalid operation: cannot send to receive-only channel <-chan int in (variable of type <-chan int)` ✅[^1].

**`select`.**
1. On entry, every channel operand (and every value to send) is evaluated once, in source order ✅[^2].
2. If one or more cases can proceed, one is chosen by uniform pseudo-random selection; otherwise the `default` case runs if there is one; otherwise `select` blocks until a case can proceed ✅[^2].
3. A case on a nil channel never proceeds, so a `select` over only nil channels with no `default` blocks forever, and `select {}` blocks forever ✅[^2].

In the lab, with both of two buffered channels ready on each of 10,000 rounds, one run picked them 5031 and 4969 times, and three more runs gave 5041/4959, 5025/4975 and 5025/4975 ✅[^1].

**Timeouts and timer channels.**
1. `time.After(d)` is equivalent to `time.NewTimer(d).C` ✅[^6]. Since Go 1.23 the garbage collector can reclaim timers that are no longer referenced even if they never fired, so there is no reason to prefer `NewTimer` when `After` will do ✅[^6].
2. Go 1.23 made the channel of a `Timer` or `Ticker` unbuffered (capacity 0), which guarantees that no stale value prepared before a `Stop` or `Reset` call is received after it; `len` and `cap` of timer channels now return 0 ✅[^4]. In Go 1.23 to 1.26 this applied only to a main module whose `go` line says 1.23 or later, and `GODEBUG=asynctimerchan=1` restored the old buffered channels ✅[^4] ✅[^7].
3. Go 1.27 removed `asynctimerchan`: channels created by package `time` are always unbuffered, whatever the GODEBUG settings ✅[^5]. The `go` command accepts a removed setting only when it is set to its final default, and fails when it is set to an old value ✅[^5].

Observed on Go 1.27.4 ✅[^1]: a module with `go 1.22` in `go.mod` printed `timer cap: 0`; `//go:debug asynctimerchan=0` built and ran; `//go:debug asynctimerchan=1` failed to build with `invalid //go:debug: removed GODEBUG "asynctimerchan" set to old value "1"`; a built binary run with `GODEBUG=asynctimerchan=1` stopped at start-up with a `fatal error` and exit status 2.

**Deadlock detection.** When the lab program's only goroutine received from a nil channel, the runtime stopped it with `fatal error: all goroutines are asleep - deadlock!`, showed the goroutine as `[chan receive (nil chan)]`, and the exit status was 2 ✅[^1]. The check needs *every* goroutine to be stuck: in the leak example of `go/concurrency/patterns-and-goroutine-leaks.md`, three goroutines blocked forever on a send while `main` kept running, and no fatal error appeared ✅[^1].

## Worked example
Wait for a slow worker, but give up after 50 ms (Go 1.27.4 ✅[^1]):

```go
results := make(chan string)

select { // nothing is ready yet, so default runs at once
case r := <-results:
	fmt.Println(r)
default:
	fmt.Println("no result yet")
}

go func() {
	time.Sleep(200 * time.Millisecond)
	results <- "slow answer"
}()
start := time.Now()
select {
case r := <-results:
	fmt.Println(r)
case <-time.After(50 * time.Millisecond):
	fmt.Println("timed out after", time.Since(start).Round(10*time.Millisecond))
}
t := time.NewTimer(time.Hour)
fmt.Println("timer channel cap:", cap(t.C))
```

| Step | What happens | Output |
|---|---|---|
| 1 | First `select`: `results` has no sender, so `default` runs | `no result yet` |
| 2 | Worker goroutine starts and sleeps 200 ms | — |
| 3 | Second `select` blocks on two cases: `results` and the 50 ms timer | — |
| 4 | Timer fires first; its case is the only ready one | `timed out after 50ms` |
| 5 | Timer channel capacity on Go 1.27.4 | `timer channel cap: 0` |

`main` returns at step 5; the worker is still asleep and never delivers, which is harmless here only because the program ends (rule 3 of Goroutines). In a long-running server the same worker would block forever on its send: a goroutine leak (see `go/concurrency/patterns-and-goroutine-leaks.md`).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `range` over a channel nobody closes | The loop blocks after the last value | Range yields values until the channel is closed ✅[^2] |
| Closing while another goroutine may still send | The sender panics | A send on a closed channel panics ✅[^2] |
| Reading `len(timer.C)` to decide whether a tick is waiting | Always 0 since Go 1.23 | Timer channels are unbuffered; use a non-blocking receive (`select` with `default`) instead ✅[^4] |
| `v := <-ch` on a closed channel | Gets the zero value silently | Use `v, ok := <-ch` to tell a real zero from "closed and empty" ✅[^2] |
| Loop variable captured by `go func(){...}()` before Go 1.22 | All goroutines may see the same variable | Effective Go notes this bug for Go versions before 1.22 ✅[^3] |
| `go f()` where `f` returns values | The values are lost | Results of a `go` call are discarded ✅[^2] |
| Free list as a buffered channel with `default` cases | Neither side ever blocks: an empty list allocates, a full list drops the buffer for the garbage collector | Effective Go's "leaky buffer" idiom ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Channel that hands data to its owner | Only one goroutine touches the value at a time, so no locks around it ✅[^3] | Message design, and a way to stop every sender and receiver |
| Mutex around a small value | Simplest for a counter or a reference count ✅[^3] | Easy to forget a lock; see `go/concurrency/sync-and-atomics.md` |
| Unbuffered channel | The send tells the sender that the receiver has the value | Each send waits for a receiver |
| Buffered channel | Absorbs bursts; can act as a semaphore ✅[^3] | Hides slow consumers until the buffer fills; a buffer size picked to avoid a hang is fragile |

## Takeaways
- Only the sending side closes a channel, once, when it will send no more; receivers learn about it with `range` or `v, ok`. [rule-candidate]
- Never start a goroutine without knowing how it will end: a receiver, a closed channel, or a cancelled context. [rule-candidate]
- Write timeouts with `select` and `time.After` or a context; never poll `len` of a timer channel. [rule-candidate]
- Remove any `asynctimerchan=1` from `go.mod`, `go.work`, `//go:debug` lines or the environment before moving to Go 1.27: it stops the build or the program. [rule-candidate]

## Verification status
- Verified: 41 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: Go statements, Program execution, Channel types, Send statements, Receive operator, Close, Select statements, For statements with range clause. [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: Concurrency — share by communicating, goroutines, channels, the semaphore, the pre-1.22 loop-variable bug, a leaky buffer. [^3]
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23) — Go team, 2024. Rank 1. Backs: timer changes (unbuffered timer channels, Stop/Reset guarantee, `len`/`cap` 0, `go` line gate, `asynctimerchan`). [^4]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: `asynctimerchan` removed; the `go` command's handling of removed GODEBUG settings. [^5]
- [Package time](https://pkg.go.dev/time) — Go team, living. Rank 1. Backs: `After` equals `NewTimer(d).C`; unreferenced timers are collected since Go 1.23. [^6]
- [Go, Backwards Compatibility, and GODEBUG](https://go.dev/doc/godebug) — Go team, living. Rank 1. Backs: `asynctimerchan` history and its removal in Go 1.27. [^7]

## Related
- `go/concurrency/sync-and-atomics.md`
- `go/concurrency/context-and-cancellation.md`
- `go/concurrency/memory-model-and-data-races.md`
- `go/concurrency/patterns-and-goroutine-leaks.md`
- `go/fundamentals/control-flow-and-functions.md` — `range` forms and the Go 1.22 loop variable.
- `concurrency/structured-concurrency.md` — giving every goroutine an owner, across languages.
- `go/learning-path.md`
