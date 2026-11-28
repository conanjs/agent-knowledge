---
schema: topic-index/v1
kind: subtopic
topic: javascript/best-practices
last-updated: 2026-11-28
---

# JavaScript best practices

157 practices for writing JavaScript and TypeScript, in 17 small catalogs: the language and its memory behaviour, how the V8 engine runs the code, the Node.js runtime, and the browser. Each practice names the situation in the code, what to prefer, when it matters (always, only in a hot path, only on large data, only at startup, depending on the build, or not at all: measured to gain nothing), and its evidence: a lab run of this knowledge base with the build it ran on, or a statement of a source. Most lab evidence is from V8 (Node.js and Chrome); 46 practices were also checked on SpiderMonkey and JavaScriptCore, and each catalog says which. These are documents for readers, not installed agent skills or rules that a check enforces; the mechanisms behind them are explained in `js-runtime/`, and the review-side view of the same findings is in `performance/code-review/`.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [language-patterns.md](language-patterns.md) | reference | Twelve practices for costs countable from source on any engine: array chains, first match, sort keys, error stacks, spread calls, rebuilt collections, TypeScript target, `#` fields, enums, barrel files (`JL-L`) | verified |
| [async-and-promises.md](async-and-promises.md) | reference | Eight practices for `await`, promise ownership and cancellation: microtask turns per `await`, `return await`, concurrency caps, unhandled rejections, `AbortSignal`, blocking loops (`JL-A`) | verified |
| [memory-and-garbage-collection.md](memory-and-garbage-collection.md) | reference | Eight practices on what keeps memory alive (closures, timers, listeners, string slices, `WeakMap`, finalizers) and what garbage collection costs (per-call arrays, `null`, forced collection) (`JL-G`) | verified |
| [objects-and-shapes.md](objects-and-shapes.md) | reference | Seven practices for object layout on V8: one fixed field order, no `delete`, fields written by name, copies by spread, prototypes set at creation, built-ins left unpatched; no single 128-property limit (`JE-O`) | verified |
| [numbers-and-arrays.md](numbers-and-arrays.md) | reference | Eleven practices for numbers and arrays: doubles in double-only or typed arrays, number fields started as numbers, the index `for` over arrays, what `0.0` and holes do not change, and what pointer compression does in Chrome and Electron (`JE-N`) | verified |
| [strings-and-collections.md](strings-and-collections.md) | reference | Nine practices for strings, `Map`, `Set`, typed arrays, getters and `Proxy`: tables keyed at run time, dense ids, `+=`, raw targets instead of proxies, getters on classes (`JE-S`) | verified |
| [functions-and-optimization.md](functions-and-optimization.md) | reference | Twelve practices for hot functions and call sites: shapes and types per site, inlining limits, huge functions, direct `eval`, generators, loop forms; half say what there is no reason to rewrite (`JE-F`) | verified |
| [measuring-performance.md](measuring-performance.md) | reference | Thirteen practices for timing JavaScript, measuring its memory and reading V8's tiers, flags and status values on a given build, including headless Chrome and tabs that are not in front (`JE-M`) | verified |
| [nodejs-event-loop-and-threads.md](nodejs-event-loop-and-threads.md) | reference | Nine practices for the Node.js event loop and its thread pool: capping pool-heavy calls, yielding with `setImmediate`, `AsyncLocalStorage`, synchronous calls and slow hashes kept out of per-request code (`JN-E`) | verified |
| [nodejs-streams-buffers-and-io.md](nodejs-streams-buffers-and-io.md) | reference | Nine practices for streams, `Buffer` and input/output: kept slices copied out, chunks joined once, backpressure respected, the cheaper `fs` and socket forms (`JN-S`) | verified |
| [nodejs-worker-threads.md](nodejs-worker-threads.md) | reference | Nine practices for worker threads and pools: CPU work moved off the main thread, pools sized from `availableParallelism()`, large buffers transferred, per-worker heaps capped, pool and queue library behaviours (`JN-W`) | verified |
| [nodejs-heap-limits-and-containers.md](nodejs-heap-limits-and-containers.md) | reference | Six practices for heap flags and container limits: heap flags below the container limit, every memory counter read, the semi-space flag left alone, limits read through the right APIs (`JN-H`) | verified |
| [nodejs-startup.md](nodejs-startup.md) | reference | Ten practices for Node.js start time and loading: lazy compilation, code caches keyed by a source hash, snapshots, the compile cache, lazy optional imports, erasable TypeScript and `#` import aliases (`JN-U`) | verified |
| [browser-rendering-and-interaction.md](browser-rendering-and-interaction.md) | reference | Nine practices for rendering and input: `transform` and `opacity` animations, batched layout reads, windowed lists, light handlers, yielding in long tasks, input-to-paint time; plus what differs in Chrome, in background tabs and on other engines (`JB-R`) | verified |
| [browser-loading-and-delivery.md](browser-loading-and-delivery.md) | reference | Seven practices for page load: the main image loaded eagerly, image dimensions and `srcset`, `defer` and `async` scripts, fonts, on-demand chunks, staying eligible for the back/forward cache (`JB-L`) | verified |
| [browser-network-requests.md](browser-network-requests.md) | reference | Nine practices for requests and responses: immutable caching of hashed assets, `no-cache` with `ETag`, compression of text only, preflight caching, one HTTP/2 connection, the limits of HTTP/3, paginated lists, conditional polls, direct multipart uploads (`JB-N`) | verified |
| [browser-component-frameworks.md](browser-component-frameworks.md) | reference | Nine practices for React rendering: stable keys, narrow store selectors and cached snapshots, split contexts, memoization from about 1 ms, parallel fetches, top-level `lazy`, `'use client'` on leaves (`JB-F`) | verified |

## References
- [ECMAScript Language Specification](https://tc39.es/ecma262/) — Ecma TC39, living. Backs: subtopic scope (the language the practices are about).
- [V8 documentation](https://v8.dev/docs) — V8 team, living. Backs: subtopic scope (the engine most lab evidence comes from).
- [Node.js API documentation](https://nodejs.org/api/) — Node.js project, living. Backs: subtopic scope (the `nodejs-*` catalogs).
- `js-runtime/v8-compiler-pipeline-deep-dive.md`, `js-runtime/v8-object-and-value-representation-deep-dive.md`, `js-runtime/v8-memory-and-startup-deep-dive.md`, `js-runtime/v8-rules-on-spidermonkey-and-javascriptcore-deep-dive.md` — the deep dives these catalogs distil; they hold the lab scripts and outputs.

## Related
- `js-runtime/` — how V8 and Node.js work inside: the mechanisms behind these practices.
- `performance/code-review/` — the same findings as problem classes for a performance review.
- `javascript/learning-path.md` — where the language itself is taught, before these practices.
