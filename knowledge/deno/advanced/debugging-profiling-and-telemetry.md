---
schema: knowledge-doc/v1
type: concept
topic: deno/advanced
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, debugging, inspector, inspect-brk, inspect-wait, devtools-protocol, v8-flags, deno-v8-flags, max-old-space-size, cpu-prof, heap-snapshot, console-time, performance-mark, opentelemetry, otlp, otel-deno, tracing]
ranked-sources: true
---

# Debugging, profiling and OpenTelemetry in Deno 2.9

## Summary
**TL;DR:** `--inspect` starts a V8 inspector server (default `127.0.0.1:9229`) that speaks the Chrome DevTools Protocol over a WebSocket; `--inspect-wait` holds user code until a debugger attaches, and `--inspect-brk` also pauses on the first line. `chrome://inspect` and the VS Code Deno extension attach to it. `--v8-flags` (or `DENO_V8_FLAGS`) passes options to V8, such as `--max-old-space-size`. `--cpu-prof` writes a `.cpuprofile` on exit, plus a Markdown report and an SVG (Scalable Vector Graphics) flame graph on request. `OTEL_DENO=true` turns on built-in OpenTelemetry: traces, metrics and logs go over OTLP (OpenTelemetry Protocol), by default `http/protobuf` to `localhost:4318`, with spans for `Deno.serve` and `fetch` created for you.
**Use this when:** you need to step through Deno code, attach a debugger to a running process, raise or test the heap limit, find where CPU (central processing unit) time goes, or send traces and logs from a Deno service to an OpenTelemetry collector.
**Not this doc:** `deno test --coverage` and `deno bench` → `deno/testing/coverage-and-benchmarks.md`; the HTTP (Hypertext Transfer Protocol) server itself → `deno/web/http-server.md`; what an op is → `deno/internals/runtime-architecture.md`; `DENO_AUDIT_PERMISSIONS` and permission tracing → `deno/security/permission-flags.md`; `--inspect` inside a compiled binary → `deno/advanced/compile-and-distribution.md`.

## Problem
- A short script run with `--inspect` finishes before any debugger can attach, so breakpoints never hit.
- A process that is already running cannot be restarted with a flag, yet needs a debugger now.
- Memory limits and V8 options are set in two places (`--v8-flags`, `DENO_V8_FLAGS`), and it is unclear which wins.
- "Where does the time go?" needs a profile, and the profiling flags do not appear in `deno run --help`.
- Teams want traces from a Deno service without wiring an OpenTelemetry SDK, and need to know what is sent, where, and in which encoding.

## Mental model
**Analogy:** the inspector is a maintenance port on a machine: the machine keeps running, and a technician's tablet (DevTools, VS Code) plugs in to pause it, look inside and turn dials. A CPU profile is a stopwatch that looks at the machine every millisecond and notes which part was moving. OpenTelemetry is a flight recorder that streams its records to the ground (a collector) while the flight goes on.

| Term | Plain-English analogy | Concrete artifact (lab, Deno 2.9.8) |
|---|---|---|
| Inspector server | The maintenance port | `Debugger listening on ws://127.0.0.1:9229/8639924f-…` |
| Chrome DevTools Protocol (CDP) | The language spoken over that port | `{"id":3,"method":"Runtime.runIfWaitingForDebugger"}` |
| V8 flag | A dial inside the engine | `--v8-flags=--max-old-space-size=64` |
| Sampling CPU profile | A stopwatch snapshot every interval | `CPU.1795509740308.24.cpuprofile` (6,662 bytes) |
| Span and trace | One timed step, and the tree of steps for one request | four spans named `GET` sharing trace id `063e5127…` |
| OTLP exporter | The radio that sends recorder data | `POST /v1/traces content-type=application/x-protobuf bytes=1203` |

**Artifact:** the lines `--inspect` prints, and what `OTEL_DENO=true` sends ✅[^run]:
```console
$ deno run --inspect short.ts
Debugger listening on ws://127.0.0.1:9229/8639924f-3f22-4363-9121-dd473bd4e051
Visit chrome://inspect to connect to the debugger.
user code ran
$ OTEL_DENO=true deno run --allow-net app.ts     # a receiver listens on :4318
[receiver] POST /v1/metrics content-type=application/x-protobuf bytes=3057
[receiver] POST /v1/traces content-type=application/x-protobuf bytes=1203
[receiver] POST /v1/logs content-type=application/x-protobuf bytes=427
```

## How it works

### The inspector
**3 actors:**
- **The Deno process** — its job: run the program and host the inspector server, via `--inspect`, `--inspect-wait` or `--inspect-brk`.
- **The debugger client** (DevTools, VS Code, or any CDP client) — its job: find the target and send commands, via HTTP `/json/list` and then a WebSocket.
- **V8's debugger** — its job: pause, evaluate and resume JavaScript, via CDP domains such as `Debugger` and `Runtime`.

```
[Deno process — local]                 [client — local or remote]
deno run --inspect-brk app.ts
  │ listen 127.0.0.1:9229
  │ print ws://127.0.0.1:9229/<uuid>
  │ "Deno is waiting for debugger to connect."
  │                                 ◀── GET /json/list  (HTTP)
  │  [{ webSocketDebuggerUrl, devtoolsFrontendUrl, … }] ──▶
  │                                 ◀══ WebSocket upgrade, CDP JSON messages ══
  │                                     Runtime.enable · Debugger.enable
  │                                     Runtime.runIfWaitingForDebugger
  ├─ V8 pauses at line 1 ── Debugger.paused ═════════════▶
  │                                 ◀══ Runtime.evaluate · Debugger.resume
  └─ user code runs; console calls ═══ Runtime.consoleAPICalled ══▶
```

1. **Deno (local): listen.** `--inspect[=host:port]` activates the inspector on `127.0.0.1:9229` by default; port `0` picks a free port ✅[^run-cli]. With `--inspect=127.0.0.1:0` the lab got port `36697` ✅[^run]. Deno implements the V8 Inspector Protocol used by Chrome, Edge and Node.js ✅[^debug].
2. **Deno (local): decide when user code starts.** `--inspect` runs at once; `--inspect-wait` waits for a client before user code; `--inspect-brk` waits and breaks at the start of the user script ✅[^run-cli]. With no client, both waiting modes printed `Deno is waiting for debugger to connect.` and stayed there until `timeout` killed them (exit 143) ✅[^run].
3. **Client → Deno (HTTP): discover.** The lab's `GET /json/version` returned `{"Browser":"Deno/2.9.8","Protocol-Version":"1.3","V8-Version":"15.0.245.2-rusty"}`, and `/json/list` returned one target with `webSocketDebuggerUrl`, a `devtools://devtools/bundled/js_app.html?ws=…` front-end URL and `"url": "file:///lab/long.ts"` ✅[^run]. `--inspect-publish-uid=http` stops printing the URL and leaves it only at `/json/list` ✅[^debug]; the lab printed nothing extra ✅[^run].
4. **Client ⇄ V8 (WebSocket): debug.** A 30-line CDP client sent `Runtime.enable`, `Debugger.enable` and `Runtime.runIfWaitingForDebugger` to an `--inspect-brk` process, received `Debugger.paused` (reason `debugCommand`, `file:///lab/short.ts` line 1), evaluated `Deno.version.deno` → `"2.9.8"`, sent `Debugger.resume`, and then saw the program's `console.log` as `Runtime.consoleAPICalled` ✅[^run]. Deno printed `Debugger session started.`, `Waiting for the debugger to disconnect...` and `Debugger session ended` around it ✅[^run].
5. **Clients you would use:** open `chrome://inspect` in Chrome or Edge and click Inspect; VS Code attaches through the official Deno extension ✅[^debug]. DevTools' Network tab shows `fetch()` and WebSocket traffic since 2.8, and each Web Worker is its own target since 2.7 ✅[^debug].
6. **Attaching late:** on Linux and macOS, `SIGUSR1` starts the inspector on `127.0.0.1:9229` without pausing (2.9.2+) ✅[^debug]. In the lab, `kill -USR1 <pid>` on a plain `deno run` made it print the `Debugger listening on …` lines, and `/json/version` answered ✅[^run]. From code, `node:inspector`'s `open()` does the same and needs `--allow-net` ✅[^debug].

### V8 flags
- `--v8-flags=<list>` passes options to V8; `--v8-flags=--help` lists them; `DENO_V8_FLAGS` sets them from the environment, and the command-line flags are appended after it ✅[^run-cli] ✅[^envvars].
- Measured with `node:v8` `getHeapStatistics().heap_size_limit`, in MiB (mebibytes, 1 MiB = 1,048,576 bytes) ✅[^run]:

  | Setting | `heap_size_limit` |
  |---|---|
  | none (lab default) | 4098 MiB |
  | `--v8-flags=--max-old-space-size=64` | 160 MiB |
  | `DENO_V8_FLAGS=--max-old-space-size=128` | 224 MiB |
  | both: env `128`, flag `96` | 192 MiB: the flag, applied last, wins |
  | `--v8-flags=--expose-gc,--max-old-space-size=64` | 160 MiB, and `typeof gc` is `"function"`: commas separate flags |
- `--v8-flags=--help` printed 1988 lines, among them `--max-old-space-size (max size of the old space (in Mbytes))`, `--jitless` and `--prof` ✅[^run]. An unknown flag fails with `error: V8 did not recognize flag '--no-such-flag'`, exit 1 ✅[^run].
- At `--max-old-space-size=32`, an array-growing loop died with `Fatal JavaScript out of memory: Reached heap limit`, exit code 133 ✅[^run].

### CPU profiles, heap snapshots and timers
| Flag | Default | Effect ✅[^cpuprof] |
|---|---|---|
| `--cpu-prof` | off | Profile the run; written to disk on exit |
| `--cpu-prof-dir=<dir>` | current folder | Output folder; implies `--cpu-prof` |
| `--cpu-prof-name=<name>` | `CPU.<timestamp>.<pid>.cpuprofile` | File name |
| `--cpu-prof-interval=<µs>` | `1000` | Sampling interval; lower is finer and larger |
| `--cpu-prof-md` | off | Markdown report next to the profile |
| `--cpu-prof-flamegraph` | off | Interactive SVG flame graph next to the profile |

- **Run:** `deno run --cpu-prof --cpu-prof-md --cpu-prof-flamegraph hot.ts` wrote `CPU.1795509740308.24.cpuprofile` (6,662 bytes), `.md` (1,259 bytes) and `.svg` (17,713 bytes); the report's hot-function table put `fib` first, at `100.0%` self time; a re-run gave `60.0%`, because the share depends on which samples land where ✅[^run]. The profile is JSON (JavaScript Object Notation) with `nodes`, `startTime`, `endTime`, `samples` and `timeDeltas` ✅[^run]; DevTools' Performance tab loads it with "Load profile" ✅[^cpuprof].
- **Heap:** 2.9.8 has no `--heap-prof` (`error: unexpected argument '--heap-prof' found`) ✅[^run]. `node:v8`'s `writeHeapSnapshot()` is described as writing a V8 heap snapshot to a JSON file ✅[^nodev8]; it wrote `Heap.20261124.084235.22.0.001.heapsnapshot` (6,652,939 bytes) with `--allow-write` ✅[^run].
- **In-code timers:** `console.timeEnd(label)` prints the label, a colon, a space and the duration ✅[^console]; Deno printed `work: 22.6ms` ✅[^run]. `performance.mark()` stores a named timestamp and `performance.measure()` returns a `PerformanceMeasure` whose `entryType` is `"measure"` ✅[^usertiming]; the lab's measure had a positive `duration` ✅[^run].
- **Op tracing:** `--trace-ops` prints each op's dispatch and completion with a timestamp, for example `op_fs_read_file_text_async : Dispatched Async` then `CompletedAsync Async` ✅[^run]. The debugging guide calls the flag `--strace-ops` ✅[^debug] (see Edge cases).

### OpenTelemetry
**3 actors:**
- **Your code** — its job: serve and fetch as usual, and log with `console.*`, via plain Deno APIs.
- **Deno's telemetry layer** — its job: create spans, metrics and log records and batch them, via the `OTEL_*` environment variables.
- **The OTLP receiver** (a collector or backend) — its job: accept the batches, via HTTP `POST` to `/v1/traces`, `/v1/metrics` and `/v1/logs`.

1. **Turn it on:** `OTEL_DENO=true` enables the integration ✅[^otel]; it is stable, and `--unstable-otel` is unnecessary from 2.4 ✅[^unstable]. Without `OTEL_DENO`, the same app sent nothing ✅[^run].
2. **Automatic spans:** one server span per `Deno.serve` request and one client span per `fetch`, each named after the HTTP method, plus `node:http2` (2.9) and `Deno.cron()` (2.7) ✅[^otel] ✅[^v29]. Attributes include `http.request.method`, `url.full`, `url.scheme`, `url.path`, `url.query` ✅[^otel]. Trace context crosses `fetch` and `Deno.serve` automatically ✅[^otel].
3. **Logs:** `console.*` output becomes log records, and records written inside an active span carry its trace context ✅[^otel]. `OTEL_DENO_CONSOLE` chooses `capture` (default), `replace` or `ignore` ✅[^otel].
4. **Metrics:** `http.server.request.duration`, `http.server.active_requests`, `http.server.request.body.size` and `http.server.response.body.size` ✅[^otel], exported every `OTEL_METRIC_EXPORT_INTERVAL` ms (default `60000`) ✅[^otel]. Synchronous metrics are also exported on exit ✅[^otel].
5. **Export:** the default is `http/protobuf` to `localhost:4318` ✅[^otel]; `OTEL_EXPORTER_OTLP_PROTOCOL` also takes `http/json`, `grpc` (2.8+) and `console` ✅[^otel]. OTLP/HTTP's default port is 4318, its paths are `/v1/traces`, `/v1/metrics` and `/v1/logs`, and its content types are `application/x-protobuf` and `application/json` ✅[^otlp]. Deno's requests matched all three ✅[^run].
6. **Resource:** each batch carries `service.name` (from `OTEL_SERVICE_NAME`), `process.runtime.name: deno`, `telemetry.sdk.name: deno-opentelemetry` and `telemetry.sdk.language: deno-rust` ✅[^otel]; the lab also saw `telemetry.sdk.version: 2.9.8-0.32.1` ✅[^run].
7. **Your own spans and metrics** use `npm:@opentelemetry/api@1` with no provider setup ✅[^otel]. The lab did not fetch that package, so this step is backed by the docs only.

Other variables: `OTEL_EXPORTER_OTLP_ENDPOINT` (and per-signal `…_TRACES_ENDPOINT`, `…_METRICS_ENDPOINT`, `…_LOGS_ENDPOINT`), `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_PROPAGATORS` (default `tracecontext,baggage`) ✅[^otel], and since 2.9 `OTEL_TRACES_SAMPLER`/`OTEL_TRACES_SAMPLER_ARG` and the span attribute and event count limits (default 128) ✅[^v29].

## Worked example
Trace one request that makes a nested `fetch`, and receive it in the same container. `app.ts` serves `/` on port 8000; its handler logs `handling /`, fetches `/inner` on itself, and returns `outer+inner`; the top level fetches `/?q=1`, waits 1.5 s, and shuts the server down. `receiver.ts` is a `Deno.serve` on port 4318 that prints each `POST`, decodes JSON bodies, and returns `200`.

```console
$ deno run --allow-net receiver.ts &
$ OTEL_DENO=true OTEL_EXPORTER_OTLP_PROTOCOL=http/json OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  OTEL_SERVICE_NAME=lab-app OTEL_METRIC_EXPORT_INTERVAL=1000 deno run --allow-net app.ts
```

| Step | Output in the lab ✅[^run] | Meaning |
|---|---|---|
| 1 | `handling /`, `client got: outer+inner` | the app ran normally; stdout still got the logs (`capture`) |
| 2 | `POST /v1/metrics content-type=application/json bytes=18905` | first metric interval; scopes `deno` (four `http.server.*`) and `v8js` (`v8js.gc.duration`, `v8js.memory.heap.limit`, …) |
| 3 | `POST /v1/traces … bytes=8400` with 4 spans, all `GET`, all trace `063e5127` | client `/?q=1` (root) → server `/` → client `/inner` → server `/inner` |
| 4 | span attributes, for example `"url.path":"/","url.query":"q=1","http.response.status_code":"200"` | the same keys on client and server spans |
| 5 | `POST /v1/logs … bytes=2750`: `body="handling /\n" trace=063e5127`, `body="client got: outer+inner\n" trace=-` | only the log written inside the handler's span carries a trace id |
| 6 | a second `POST /v1/metrics`, then `app exit=0` | the final export at exit |
| 7 | the same run without `OTEL_EXPORTER_OTLP_PROTOCOL` | `content-type=application/x-protobuf`, 3057 / 1203 / 427 bytes |
| 8 | `OTEL_EXPORTER_OTLP_PROTOCOL=console` | `SPAN GET [6a01ddb3…/81a6d78c…] Server 0.692ms` blocks and `LOG [INFO] … "handling /` on stderr |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `fetch` client span status attribute | The docs name it `http.status_code` ✅[^otel]; 2.9.8 sent `http.response.status_code`, the same key as server spans ✅[^run] | The run shows 2.9.8; query both names if dashboards span versions |
| Status code attribute type | Exported as a string (`{"stringValue":"500"}`), not an integer ✅[^run] | A numeric filter such as `>= 500` may not match |
| Handler throws inside `Deno.serve` | The docs say the server span gets no status and no error event ✅[^otel]; 2.9.8 set `status.code` 2 on both spans, with no event ✅[^run] | Code 2 is `STATUS_CODE_ERROR` ✅[^otlp-proto]; it came with the 500 response, and the exception itself was not recorded |
| `v8js.*` metrics | Exported in the lab (`v8js.gc.duration`, `v8js.memory.heap.size`, …) but not listed in the docs ✅[^run] | Undocumented: do not build alerts on their names yet |
| `--strace-ops` from the docs | `error: unexpected argument '--strace-ops' found` with `tip: a similar argument exists: '--trace-ops'` ✅[^run] ✅[^debug] | Use `--trace-ops` in 2.9.8 |
| `--cpu-prof*` in `deno run --help` | Not listed (0 matches), yet all six flags worked ✅[^run] | Hidden in help; documented in the profiling guide ✅[^cpuprof] |
| `writeHeapSnapshot()` support | Worked ✅[^run], though the `node:v8` page lists only `cachedDataVersionTag`, `getHeapStatistics`, `serialize` and `deserialize` as supported ✅[^nodev8] | The run shows what 2.9.8 did; recheck after upgrades |
| `--inspect` on a short script | The program finished before any client could attach ✅[^run] | `--inspect` starts at once ✅[^debug]; use `--inspect-brk` or `--inspect-wait` |
| `--inspect=0.0.0.0:9229` | Any CDP client that reaches the port can evaluate code in the process, as the lab's client did with `Runtime.evaluate` ✅[^run] | The guide calls a public inspector address insecure ✅[^debug] |
| `SIGUSR1` on Windows | Not available ✅[^debug] | Windows has no `SIGUSR1` |

## Takeaways
- Use `--inspect-brk` for scripts and tests, and keep the inspector on `127.0.0.1`; never publish it on a public address. [rule-candidate]
- Set memory limits with `--v8-flags=--max-old-space-size=<MiB>`; the flag overrides `DENO_V8_FLAGS` because it is applied last.
- Profile with `--cpu-prof --cpu-prof-md` first; open the `.cpuprofile` in DevTools only when the Markdown report is not enough.
- Turn on telemetry with `OTEL_DENO=true` plus `OTEL_SERVICE_NAME`; point `OTEL_EXPORTER_OTLP_ENDPOINT` at the collector and pick `http/json` only when debugging the payload. [rule-candidate]
- Use `OTEL_EXPORTER_OTLP_PROTOCOL=console` to see spans locally without a collector.

## Verification status
- Verified: 75 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example and Edge cases. The CDP client and the OTLP receiver were small Deno scripts in the same container; no browser or collector was used. [^run]
- [Debugging](https://docs.deno.com/runtime/fundamentals/debugging/) — Deno project, living. Rank 1. Backs: protocol, wait modes, clients, `--inspect-publish-uid`, `SIGUSR1`, `node:inspector`, Network tab and workers, public-address warning, `--strace-ops` spelling. [^debug]
- [deno run](https://docs.deno.com/runtime/reference/cli/run/) — Deno project, living. Rank 1. Backs: `--inspect*` defaults and port 0, `--v8-flags=--help`, `DENO_V8_FLAGS` order. [^run-cli]
- [CPU profiling](https://docs.deno.com/runtime/fundamentals/cpu_profiling/) — Deno project, living. Rank 1. Backs: the six `--cpu-prof*` flags and defaults, loading into DevTools. [^cpuprof]
- [Environment variables](https://docs.deno.com/runtime/reference/env_variables/) — Deno project, living. Rank 1. Backs: `DENO_V8_FLAGS`. [^envvars]
- [OpenTelemetry](https://docs.deno.com/runtime/fundamentals/open_telemetry/) — Deno project, living. Rank 1. Backs: `OTEL_DENO`, variables and defaults, automatic spans, attributes, metrics, logs, resource attributes, user API, limitations. [^otel]
- [Unstable feature flags](https://docs.deno.com/runtime/reference/cli/unstable_flags/) — Deno project, living. Rank 1. Backs: `--unstable-otel` unnecessary from 2.4. [^unstable]
- [node:v8](https://docs.deno.com/api/node/v8/) — Deno project, living. Rank 1. Backs: `writeHeapSnapshot` description and the support note. [^nodev8]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: `node:http2` instrumentation, sampler variables, span limits. [^v29]
- [OTLP Specification](https://opentelemetry.io/docs/specs/otlp/) — OpenTelemetry project, living. Rank 1. Backs: port 4318, `/v1/*` paths, content types. [^otlp]
- [trace.proto](https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/trace/v1/trace.proto) — OpenTelemetry project, living. Rank 1. Backs: `STATUS_CODE_ERROR = 2`. [^otlp-proto]
- [Console Standard](https://console.spec.whatwg.org/) — WHATWG, living. Rank 1. Backs: `console.timeEnd` output format. [^console]
- [User Timing](https://www.w3.org/TR/user-timing/) — W3C, 2026. Rank 1. Backs: `performance.mark` and `performance.measure`. [^usertiming]

## Related
- `deno/testing/coverage-and-benchmarks.md` — coverage and `deno bench`.
- `deno/web/http-server.md` — `Deno.serve`, whose requests become server spans.
- `deno/internals/runtime-architecture.md` — the ops that `--trace-ops` prints.
- `deno/security/permission-flags.md` — `DENO_AUDIT_PERMISSIONS=otel` and permission tracing.
- `deno/advanced/compile-and-distribution.md` — `deno compile` also accepts `--inspect*` and `--v8-flags`.
