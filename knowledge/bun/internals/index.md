---
schema: topic-index/v1
kind: subtopic
topic: bun/internals
last-updated: 2026-11-25
---

# Bun internals: engine, event loop and measured performance

What runs under Bun 1.4.5 and how it differs from Node.js 24 when seen from code: JavaScriptCore's JIT tiers, garbage collector, stack traces, proper tail calls, `bun:jsc` and heap snapshots; the event loop's task, timer and rejection behaviour; and measured startup, CPU, JSON, file, HTTP and install speed against Node 24 with the method and caveats. Not covered here: Node API status and migration (`bun/node-compat/`), the HTTP server API (`bun/http-and-networking/`), and benchmarking in general (`performance/measurement/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [javascriptcore-engine.md](javascriptcore-engine.md) | concept | JSC vs V8 from code: tiers LLInt to FTL with tier-up points and OSR exits measured, Riptide GC, stack traces, proper tail calls, `bun:jsc`, heap snapshots, `--smol` | verified |
| [event-loop-and-scheduling.md](event-loop-and-scheduling.md) | concept | Ordering of ticks, microtasks, immediates, timers and I/O compared with Node 24, with the system calls traced; timers, unhandled rejections, exit events | verified |
| [performance-measured.md](performance-measured.md) | concept | Why Bun is often faster, and medians of 7 rounds against Node 24 for startup, CPU, JSON, file I/O, HTTP and install; Node on glibc against musl; a rendering handler and a PostgreSQL handler (`Bun.sql` vs `pg`); `bun run` vs `npm run`; idle CPU, wake-ups and start-up against Bun 1.3.14; the system calls behind `Bun.write` | verified |

## References
- [Bun Runtime, docs at tag bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/index.mdx) — Bun docs pinned to the 1.4.5 release, 2026. Backs: topic scope.
- [Bun Event Loop Architecture](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/event_loop/README.md) — Bun source, tag bun-v1.4.5. Backs: topic scope.

## Related
- `bun/node-compat/` — Node API status and migration
- `javascript/async/event-loop-and-async-await.md` — the event loop in general
- `performance/measurement/benchmarking-methodology.md` — how to benchmark fairly
- `linux/lab-setup.md` — the lab the measurements ran in
