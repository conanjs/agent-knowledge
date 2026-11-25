---
schema: knowledge-doc/v1
type: concept
topic: bun/internals
status: verified
applies-to: ["Bun 1.4.5", "Node.js 24.22.1"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [bun, event-loop, microtasks, nexttick, settimeout, setimmediate, timers, unhandled-rejection, uncaught-exception, process-exit, nodejs]
---

# Bun's event loop: task ordering, timers, rejections and process exit

## Summary
**TL;DR:** Bun's event loop is built on uSockets (a small C event-loop library over epoll on Linux and kqueue on macOS) plus JavaScriptCore's microtask queue and a Node-style `process.nextTick` queue ✅[^1]. The same ordering probe gave the same order as Node 24 for sync code, `nextTick`, promise reactions and `queueMicrotask`, in both ES modules and CommonJS ✅[^lab]. The macrotask order differed: in 39 of 40 ES-module runs over two sessions, Bun ran a fast `fs.readFile` callback first, then `setImmediate`, then `setTimeout(0)` ✅[^lab]. Node never ran the read first, and which of `setTimeout(0)` and `setImmediate` came first changed between sessions: timeout first in 18 of 20 ES-module runs on a loaded host, in 8 of 20 at lower load ✅[^lab]. Unhandled rejections, uncaught exceptions, `beforeExit`/`exit` and "no open handles means exit" behaved like Node 24, with one difference under `--unhandled-rejections=strict` ✅[^lab].
**Use this when:** code depends on the order of timers, immediates, I/O callbacks and microtasks; or you need to know when a Bun process crashes or exits.
**Not this doc:** microtask theory and `async`/`await` → `javascript/async/event-loop-and-async-await.md`; floating promises and linting → `js-runtime/promise-rejections.md`; JIT and memory → [javascriptcore-engine.md](javascriptcore-engine.md).

## Problem
Code moved from Node to Bun may rely, often without knowing it, on `setTimeout(fn, 0)` firing before `setImmediate(fn)`, or on a file read finishing after the current timers. Those orders are not guaranteed even in Node from the main module ✅[^2], and Bun's loop picks a different typical order ✅[^lab] ✅[^1]. People also assume a runtime "just logs" an unhandled rejection; both runtimes exit with code 1 by default ✅[^lab].

## Mental model
**Analogy:** an office with one worker. Synchronous code is the task on the desk. `process.nextTick` callbacks are sticky notes that must be cleared before the worker looks up; promise reactions and `queueMicrotask` are the follow-ups done right after the notes. Timers, immediates and I/O completions are letters in the in-tray; the worker opens one letter, then clears every new note and follow-up it caused, then opens the next. Bun and Node agree on the notes and follow-ups; they sort the in-tray differently.

**Artifact:** one line of the probe below, printed by Bun 1.4.5 for an ES module ✅[^lab]:
```
sync promise micro promise>micro tick promise>tick tick>tick tick>promise io io>tick io>promise immediate io>immediate timeout io>timeout
```

## How it works
Five actors take part in one turn of Bun's loop:
- **JavaScriptCore microtask queue** — its job: hold promise reactions and `queueMicrotask` jobs, via the engine's built-in queue ✅[^1].
- **nextTick queue** — its job: run `process.nextTick` callbacks before microtasks, via a Node-compatible queue drained by `processTicksAndRejections()` ✅[^1].
- **Task and concurrent queues** — its job: hold finished async work (file I/O, network, timers) and work posted from other threads, via a task queue fed by a thread-safe concurrent queue ✅[^1].
- **Immediate queues** — its job: hold `setImmediate` callbacks, via two queues so an immediate scheduled inside an immediate waits for the next turn ✅[^1].
- **uSockets loop and timer heap** — its job: wait for I/O and fire timers, via `epoll_pwait2()` or `kevent64()` with a timeout ✅[^1].

```
 ┌─ after every task, timer or I/O callback ──────────────────────────────────┐
 │  nextTick batch → drain microtasks → repeat while ticks remain → deferred   │
 └─────────────────────────────────────────────────────────────────────────────┘
 one loop turn (POSIX):
   1 immediates ─▶ 2 poll I/O (epoll/kqueue, may block) ─▶ 3 due timers ─▶ 4 queued tasks ─▶ 5 rejected promises
        ▲                                                                                        │
        └──────────────────────────────── next turn while handles are alive ─────────────────────┘
```

1. **Bun (JS thread) — after each callback:** runs every queued `nextTick`, then drains microtasks, and repeats while new ticks appeared; then it runs the deferred queue (buffered writes, file-sink flushes) ✅[^1]. The CommonJS row of the Worked example shows the first part: `tick tick>tick` (the tick batch), then `promise micro tick>promise promise>micro` (the drain), then `promise>tick` (the repeat) ✅[^lab].
2. **Bun (JS thread) — immediates:** runs the `setImmediate` callbacks queued for this turn ✅[^1]. Under strace 6.13 in `bunlab:2`, an immediate scheduled inside an immediate ran after the other queued immediate and after one `epoll_pwait2(3, [], 1024, {tv_sec=0, tv_nsec=0}, …)` poll, so in the next turn ✅[^lab].
3. **uSockets (kernel boundary):** blocks in `epoll_pwait2()` (Linux) or `kevent64()` until I/O is ready or the next timer is due; ready sockets and file descriptors become callbacks or queued tasks ✅[^1]. Linux, under strace: a pending 50 ms timer was waited for with one `epoll_pwait2(3, [], 1024, {tv_sec=0, tv_nsec=36425891}, [], 8)` ✅[^lab]. The macOS `kevent64()` path was not traced, because the lab runs Linux containers only.
4. **Timer heap (JS thread):** fires due `setTimeout`/`setInterval` callbacks after the poll, each followed by a microtask drain ✅[^1]. Two 5 ms timers printed `t1 t1>tick t1>promise t2` in three runs of each runtime: the first timer's tick and promise ran before the second timer ✅[^lab].
5. **Bun (JS thread) — tasks and rejections:** runs queued tasks, then reports promises rejected without a handler ✅[^1].

Node's loop runs timers first, then the poll phase, then `setImmediate` (the "check" phase); from the main module, whether `setTimeout(0)` or `setImmediate` runs first depends on process performance ✅[^2]. Bun's own notes say the typical order is "immediate, then timeout", with the same caveat ✅[^1].

## Worked example
The probe `order.mjs` schedules one callback of each kind, nests more inside, prints the log after 100 ms, and ran 20 times per runtime on a host loaded by other work; `order.cjs` is the same body as CommonJS ✅[^lab]:
```js
setTimeout(() => log.push('timeout'), 0);
setImmediate(() => log.push('immediate'));
fs.readFile(__self, () => { log.push('io'); setTimeout(() => log.push('io>timeout'), 0);
  setImmediate(() => log.push('io>immediate')); process.nextTick(() => log.push('io>tick'));
  Promise.resolve().then(() => log.push('io>promise')); });
Promise.resolve().then(() => { log.push('promise'); process.nextTick(() => log.push('promise>tick'));
  queueMicrotask(() => log.push('promise>micro')); });
queueMicrotask(() => log.push('micro'));
process.nextTick(() => { log.push('tick'); process.nextTick(() => log.push('tick>tick'));
  Promise.resolve().then(() => log.push('tick>promise')); });
log.push('sync');
```

| Runtime, file | Count of 20 | Order |
|---|---|---|
| Bun, `.mjs` | 19 | `sync promise micro promise>micro tick promise>tick tick>tick tick>promise` · `io io>tick io>promise immediate io>immediate timeout io>timeout` |
| Bun, `.mjs` | 1 | same microtask part · `immediate timeout io io>tick io>promise io>immediate io>timeout` |
| Node, `.mjs` | 18 | same microtask part · `timeout immediate io io>tick io>promise io>immediate io>timeout` |
| Node, `.mjs` | 2 | same microtask part · `immediate timeout io …` |
| Bun, `.cjs` | 18 | `sync tick tick>tick promise micro tick>promise promise>micro promise>tick` · `io … immediate io>immediate timeout io>timeout` |
| Bun, `.cjs` | 2 | same microtask part · `immediate timeout io …` |
| Node, `.cjs` | 19 | same microtask part as Bun `.cjs` · `timeout immediate io …` |
| Node, `.cjs` | 1 | same microtask part · `immediate timeout io …` |

All counts and orders above were measured ✅[^lab]. A second batch of 20 runs per runtime and file, at lower host load (1-minute load average about 2), gave Bun's main order in 20 of 20 runs for both files ✅[^lab]. Node changed: `.mjs` gave `timeout immediate io …` 8 times, `immediate timeout io …` 9 times and `immediate io io>tick io>promise io>immediate timeout io>timeout` 3 times; `.cjs` gave the same three orders 5, 8 and 7 times ✅[^lab]. Reading it:
1. **Microtasks match.** In an ES module, promise jobs ran before `nextTick`; in CommonJS, `nextTick` ran first. Both runtimes agree in both formats ✅[^lab].
2. **Inside a callback, ticks first.** After `io`, both run `io>tick` then `io>promise` ✅[^lab].
3. **Macrotasks differ.** Bun ran the file-read callback before the first immediate and the first timer in 77 of 80 runs, and ran immediates (`immediate`, then `io>immediate`) before `timeout` ✅[^lab]. Node never ran the read first in 80 runs, and its `timeout`-versus-`immediate` order changed between the two sessions (timeout first in 37 of 40 runs on the loaded host, 13 of 40 at lower load), as its docs warn ✅[^lab] ✅[^2].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `setTimeout(fn, 0)` delay, median of 30 | Bun 1.08–2.97 ms, Node 2.72–2.86 ms over four runs on a loaded host; 2.96 and 2.93 ms in a re-run at lower load ✅[^lab] | Node turns a delay below 1 into 1 ms ✅[^3], and under strace Bun asked `epoll_pwait2` for about 0.99 ms per step, each wait lasting 2.6–4.6 ms ✅[^lab]. The rest is this VM (virtual machine) waking late: in five processes per runtime that timed both, a 1 ms `Atomics.wait` took a median 2.88–3.04 ms (Bun) and 2.87–3.01 ms (Node, one 1.10), and `setTimeout(0)` 2.38–3.01 ms and 2.96–3.50 ms; `Bun.sleepSync(1)` also took 3.00 ms ✅[^lab] |
| 12 nested `setTimeout(0)` | No step to 4 ms after the 5th level in either runtime ✅[^lab] | Neither applies the browser's nesting clamp |
| `timer.refresh()` at 50 ms on a 100 ms timer | fired at 153 ms (Bun), 150 ms (Node); 160 and 167 ms in a re-run ✅[^lab] | The countdown restarts |
| `setTimeout(…, 5000).unref()` as the only handle | exits after 0 ms in both ✅[^lab] | An unref'd timer does not keep the loop alive |
| `setTimeout` return value | a `Timeout` object with `hasRef()`; `Number(t)` is a positive id that `clearTimeout` accepts, in both ✅[^lab] | Node-compatible timer objects |
| `await Bun.sleep(10)` | median 11.5 ms; `Bun.sleep(new Date(Date.now() + 20))` 22 ms; `Bun.sleepSync(15)` 18 ms (blocks the thread) ✅[^lab] | `sleep` is a promise over a timer ✅[^4]; `sleepSync` calls `nanosleep` ✅[^5], which strace showed reaching the kernel as `clock_nanosleep(CLOCK_MONOTONIC, 0, {tv_sec=0, tv_nsec=15000000}, …)` ✅[^lab] |
| `Promise.reject(err)` with no handler | prints the error, exit code 1; a pending 20 ms timer never runs, in both ✅[^lab] | Default mode `throw` ✅[^6] |
| `process.on('unhandledRejection', h)` | `h(reason, promise)` called; timers keep running; exit 0, in both ✅[^lab] | A handler replaces the crash ✅[^7] |
| Handler attached 10 ms after the rejection, no `unhandledRejection` listener | crash, exit 1, in both ✅[^lab] | The rejection was unhandled when the microtasks drained |
| Same, with a listener | `unhandledRejection`, then `caught later`, then `rejectionHandled`; exit 0, in both ✅[^lab] | Late handling is reported as a separate event ✅[^7] |
| `--unhandled-rejections=warn` / `none` / `warn-with-error-code` | warning and exit 0 / silence and exit 0 / warning and exit 1, the same in both ✅[^lab] | Bun accepts Node's five modes ✅[^8] |
| `--unhandled-rejections=strict` with an `unhandledRejection` listener | Bun calls the listener, then exits 1; Node exits 1 without calling it ✅[^lab] | Node raises the rejection as an uncaught exception first ✅[^6] |
| `--unhandled-rejections=throw` written explicitly | Bun prints the error twice, default mode prints it once ✅[^lab] | Not documented; seen in both lab sessions with Bun 1.4.5 |
| `throw` inside a timer | error printed with a source preview, exit 1; with `uncaughtException` listener the next timer runs, exit 0, in both ✅[^lab] | Node semantics ✅[^7] |
| `process.exitCode = 3`, work scheduled in `beforeExit` | `beforeExit` code=3, the work runs, `beforeExit` fires again, then `exit` code=3; a timer set in `exit` never runs, in both ✅[^lab] | `beforeExit` fires each time the loop empties ✅[^9] |
| `process.exit(4)` | `exit` fires with 4, `beforeExit` does not, in both ✅[^lab] | Explicit exit skips `beforeExit` ✅[^9] |
| An HTTP server and an interval, both `unref()`ed | exits after 3–4 ms in both ✅[^lab] | No ref'd handles left |

## Takeaways
- Never depend on `setTimeout(fn, 0)` vs `setImmediate(fn)` order, or on a file read finishing after a timer; chain the work explicitly with `await` or callbacks. [rule-candidate]
- Keep relying on `nextTick`-before-promise order only inside CommonJS; in ES modules both runtimes run promise jobs first.
- Register `process.on('unhandledRejection')` only to log and exit; without it both runtimes exit with code 1, which is the safer default. [rule-candidate]
- Use `unref()` for housekeeping timers and servers that must not keep a CLI process alive.

## Verification status
- Verified: 66 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; Node comparisons used `node:24.22.1-alpine` on the same host. Two sessions: the first while other work loaded the host, the re-runs later that day at a 1-minute load average below 3. The system-call traces and the 1 ms sleep checks ran later still (load average 6–9), with strace 6.13 in `bunlab:2`. [^lab]
- [Bun Event Loop Architecture (src/event_loop/README.md)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/event_loop/README.md) — Bun source, tag bun-v1.4.5. Backs: uSockets, queues, tick flow, nextTick batching, timer vs immediate order. [^1]
- [The Node.js Event Loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) — Node.js, living. Backs: phases, non-deterministic timeout vs immediate order in the main module. [^2]
- [Timers](https://nodejs.org/api/timers.html) — Node.js docs, v24. Backs: delays below 1 become 1. [^3]
- [Sleep for a fixed number of milliseconds](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/util/sleep.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: `Bun.sleep` equals a `setTimeout` promise. [^4]
- [bun.d.ts](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/bun.d.ts) — Bun source, tag bun-v1.4.5. Backs: `sleep(ms | Date)`, `sleepSync` via `nanosleep`. [^5]
- [Command-line API: --unhandled-rejections](https://nodejs.org/api/cli.html#--unhandled-rejectionsmode) — Node.js docs, v24. Backs: default `throw`, `strict` semantics. [^6]
- [Process: unhandledRejection event](https://nodejs.org/api/process.html#event-unhandledrejection) — Node.js docs, v24. Backs: listener arguments, `rejectionHandled`, `uncaughtException`. [^7]
- [bun run CLI flags (docs/snippets/cli/run.mdx)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/snippets/cli/run.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: Bun's five `--unhandled-rejections` modes (also listed by `bun --help` in 1.4.5). [^8]
- [Process: beforeExit event](https://nodejs.org/api/process.html#event-beforeexit) — Node.js docs, v24. Backs: `beforeExit` repeats, not emitted on explicit exit. [^9]

## Related
- `javascript/async/event-loop-and-async-await.md` — microtasks and `async`/`await` in general
- `js-runtime/promise-rejections.md` — floating promises and Node's rejection modes
- `bun/internals/javascriptcore-engine.md` — the engine under the loop
- `bun/node-compat/nodejs-compatibility.md` — `node:timers`, `perf_hooks` and `async_hooks` status
- `bun/http-and-networking/bun-serve.md` — servers that keep the loop alive
- `js-runtime/abort-signal.md` — cancelling timers and I/O
