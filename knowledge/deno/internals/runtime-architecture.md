---
schema: knowledge-doc/v1
type: concept
topic: deno/internals
status: verified
applies-to: ["Deno 2.9.8", "deno_core 0.413.0 (libs/core in the denoland/deno repository)", "rusty_v8 150.4.0 (V8 15.0.245.2)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, internals, deno_core, deno_runtime, jsruntime, ops, op2, fast-calls, resources, resource-table, extensions, rusty_v8, v8, tokio, event-loop, microtasks, snapshot, startup, permissions]
ranked-sources: true
---

# Deno runtime architecture: crates, ops, resources, the event loop and snapshots

## Summary
**TL;DR:** The `deno` executable is three Rust layers on top of V8. The `deno` CLI (command-line interface) crate in `cli/` owns flags, tools and TypeScript. It builds a `MainWorker` from the `deno_runtime` crate in `runtime/`, which adds the `Deno` namespace, permissions and the extensions in `ext/`. Under that sits a `deno_core::JsRuntime` (`libs/core/`): one V8 isolate plus ops, resources and an event loop, which talks to V8 through `rusty_v8`. JavaScript reaches the operating system only through **ops**, Rust functions declared with `#[op2]`. An op that touches the file system checks permissions inside its own body before it does any work. An async op hands back a promise, and the event loop, driven by Tokio, settles it later. The bootstrapped runtime is restored from a V8 startup snapshot built at compile time, so an empty script exits in about 5–17 ms in the lab, depending on host load.
**Use this when:** you read Deno's source or a stack trace with `ext:` frames; you choose between a sync and an async API (application programming interface); you wonder why a 0 ms timer and a file read settle in a different order from run to run; you embed `deno_core` or `deno_runtime` in a Rust program; you explain where permission checks happen.
**Not this doc:** what happens to your modules before the first line runs (graph, emit, type check) → `deno/internals/module-loading-and-type-checking.md`; the permission rules → `deno/security/permission-model.md`; `--inspect`, V8 flags and profiling → `deno/advanced/debugging-profiling-and-telemetry.md`; the product overview → `deno/fundamentals/what-deno-is.md`; Web Workers → `deno/runtime-apis/workers-kv-and-cron.md`.

## Problem
From the outside, Deno is one binary. Inside it are crates whose names sound alike (`deno`, `deno_runtime`, `deno_core`, `deno_v8`, `v8`), and the docs that explain them are thin or old. The official architecture page still shows `Deno.resources()` and `Deno.metrics()`, and both are `undefined` in 2.9.8 ✅[^run] ✅[^arch]. The standalone `deno_core` repository is archived, and its code now lives in the main repository ✅[^core-archived]. Without a map, a reader cannot tell why a stack frame points at `ext:deno_fs/30_fs.js:1:9859`, why `Deno.core` is missing, why a permission error comes from inside a file API, or why a 0 ms timer and a finished file read settle in either order.

## Mental model
**Analogy:** Deno's own architecture page compares Deno to an operating system. Ops are its system calls, resource IDs (rid) are its file descriptors, Tokio is its scheduler, and Web Workers are its processes ✅[^arch]. Push the picture one step further. V8 is a CPU (central processing unit) that only computes. Every outside effect, such as reading a file, goes through a system call. The kernel (Rust) checks the caller's rights before it touches the disk.

**Artifact:** the stack inside the 2.9.8 binary, top to bottom, with the source folder of each layer ✅[^claude-md] ✅[^deno-cargo] ✅[^ext-dir] ✅[^tokio-util] ✅[^std-fs]:
```
deno (cli/)            flags, subcommands, module graph, TypeScript, language server
  └─ deno_runtime (runtime/)   MainWorker, Deno namespace, permissions, Workers
       └─ ext/* (31 crates)    fs, net, fetch, web, node, crypto, ffi, kv, ...
            └─ deno_core 0.413.0 (libs/core/)   JsRuntime, ops, resources, event loop, snapshots
                 └─ deno_v8 0.5.0 (libs/deno_v8/)   "JavaScript engine facade for Deno"
                      └─ rusty_v8 = crate v8 150.4.0   Rust bindings to V8 15.0.245.2
Tokio (current-thread runtime)  drives the event loop; blocking pool runs file I/O
```

| Term | Plain-English picture | Concrete artifact in 2.9.8 |
|---|---|---|
| V8 isolate | One sealed JavaScript machine with its own heap | `deno --version` prints `v8 15.0.245.2-rusty` ✅[^run] |
| `rusty_v8` | A phrasebook between Rust and V8's C++ API | crate `v8` 150.4.0, README "V8 Version: 15.0.245.2" ✅[^rusty-v8] |
| `JsRuntime` | The machine plus its switchboard (ops) and its to-do list (event loop) | `libs/core/runtime/jsruntime.rs` ✅[^jsruntime] |
| Op | A system call: a Rust function JavaScript may call | `#[op2(stack_trace)] pub fn op_fs_read_file_text_sync(...)` in `ext/fs/ops.rs` ✅[^fs-ops] |
| Fast call | An express lane V8 uses once the call site is optimized | `#[op2(fast)] pub fn op_add(a: i32, b: i32) -> i32` ✅[^ops-readme] |
| Extension | A plug-in pack: ops + JavaScript + state | `deno_core::extension!(deno_fs, deps = [deno_web], ops = [...], lazy_loaded_js = ["30_fs.js"], ...)` ✅[^fs-lib] |
| Resource, rid | A numbered coat-check ticket for a Rust object | `pub type ResourceId = u32;` stored in a `BTreeMap` ✅[^rtable] |
| Event loop | A waiter doing rounds: timers, finished ops, microtasks | `JsRuntime::poll_event_loop`, six phases ✅[^jsruntime] |
| Startup snapshot | A photo of the heap after setup, restored instead of re-run | `CLI_SNAPSHOT.bin`, embedded with `include_bytes!` ✅[^snap-lib] |

## How it works

### 1. Who owns what
| Layer | Source path (tag v2.9.8) | Job |
|---|---|---|
| `deno` crate | `cli/` | "the actual deno executable and the user-facing APIs" ✅[^cli-readme]; flags in `cli/args/flags.rs`, tools in `cli/tools/<tool>` ✅[^claude-md] |
| `deno_runtime` | `runtime/` | "a slim version of the Deno CLI" with no TypeScript or tooling. Its `MainWorker` wraps a `JsRuntime` plus the `Deno` namespace ops; each `WebWorker` gets its own OS (operating system) thread ✅[^rt-readme] |
| Extensions | `ext/` (`fs`, `net`, `fetch`, `web`, `node`, `crypto`, `ffi`, `kv`, `http`, `websocket`, `webgpu`, …) | Rust ops plus the JavaScript that builds the public API on them ✅[^claude-md]; registered in a fixed order by `common_extensions()` in `runtime/worker.rs` ✅[^worker] |
| `deno_core` | `libs/core/` (was `denoland/deno_core`, archived and merged) | `JsRuntime`, the event loop "that keeps track of all pending tasks (async ops, dynamic module loads)" ✅[^core-readme] ✅[^core-archived] |
| `rusty_v8` | separate repo, crate `v8` | Bindings that match V8's C++ API closely and add no call overhead. The build downloads prebuilt static libraries unless `V8_FROM_SOURCE=1` ✅[^rusty-v8] |

The `deno_core` README says the event loop must be driven by a Rust future executor such as Tokio ✅[^core-readme]. `deno_runtime::tokio_util` builds one with `tokio::runtime::Builder::new_current_thread()` ✅[^tokio-util], and `cli/lib.rs` runs the whole command inside it ✅[^cli-lib].

### 2. Ops and extensions
- **Declaring an op.** `#[op2]` generates the V8 binding from a plain Rust function. A function that returns `Result` throws a JavaScript exception on `Err`. An `async fn` gets a hidden `promise_id` argument and is polled at once ("eager"). If it is not ready, the future goes to the pending-op system and JavaScript receives a promise ✅[^op2].
- **Fast calls.** An op marked `fast` also gets a V8 fast-call entry point. V8 switches to it "when v8 optimized the slow function to a fastcall" ✅[^op2]. A snapshot can only store the slow function, so 2.9.8 re-attaches the fast overloads later, at the first load of a lazily loaded extension module. A source comment prices that pass at "~0.9ms, ~1.6k V8 functions", and an empty script never pays it ✅[^jsruntime].
- **Grouping ops.** `deno_core::extension!` bundles `ops`, `esm`, `js`, `lazy_loaded_esm`, `lazy_loaded_js` (stored in the binary but loaded only on demand), `state` and `deps` ✅[^ext-macro]. The `deno_fs` extension declares 68 ops and `lazy_loaded_js = [ "30_fs.js" ]` ✅[^fs-lib].
- **The JavaScript side.** `30_fs.js` takes the op functions from `core.ops` and wraps them. `readTextFileSync(path)` is one line, `op_fs_read_file_text_sync(pathFromURL(path))` ✅[^fs-js]. After bootstrap, `Deno.core` is removed from the public `Deno` object ✅[^jsruntime]. In user code, `typeof Deno.core` is `"undefined"` ✅[^run].

### 3. Resources
A resource is a Rust object attached to one `JsRuntime`, which JavaScript knows only by its number (rid). Resources are reference-counted, can only be used from the runtime's thread, and close when the last reference drops ✅[^resource]. The table is a `BTreeMap<ResourceId, Rc<dyn Resource>>` with a `next_rid` counter that only goes up ✅[^rtable]. `op_fs_open_sync` checks permission, opens the file, calls `resource_table.add(FileResource::new(file, "fsFile".to_string()))` and returns the rid. `Deno.FsFile` keeps it in a private `#rid` field ✅[^fs-ops] ✅[^fs-js]. An `AbortSignal` passed to `Deno.readTextFile` becomes a cancel-handle resource. On abort, JavaScript closes that rid ✅[^fs-js]. Deno 2 removed `Deno.resources()` and `Deno.close()` from the public API: "resource IDs (RIDs) are being phased-out" ✅[^migrate].

### 4. One async op, from `await` to result
**6 actors:**
- **Your code** — its job: call the API, via `await Deno.readTextFile("/etc/alpine-release")`.
- **Extension JavaScript** — its job: translate the call into an op, via `op_fs_read_file_text_async` in `ext:deno_fs/30_fs.js`.
- **The op binding (`deno_core`)** — its job: turn V8 values into Rust arguments and create the promise, via the code `#[op2]` generated.
- **The permission container (`deno_permissions`)** — its job: allow or refuse the path, via `PermissionsContainer::check_open`.
- **Tokio** — its job: run the blocking file read off the JavaScript thread, via `spawn_blocking` on its blocking pool.
- **The event loop (`JsRuntime`)** — its job: hand finished results back to JavaScript, via `poll_event_loop` and the JavaScript callback `__eventLoopTick`.

In the diagram, JS means JavaScript; the line labelled `JS → Rust boundary` is the crossing from V8 into Rust on the same thread.

```
[JS thread: V8]                         [JS thread: Rust]                      [Tokio blocking pool]
Deno.readTextFile(p)
  └─ op_fs_read_file_text_async(p, rid?)
        ──────── JS → Rust boundary ────────▶ check_open(p, Read, "Deno.readFile()")
                                               ├─ denied → Err(NotCapable) → JS exception
                                               └─ allowed → read_file_async(p)
                                                    │  polled once: not ready
  ◀── promise (promise_id) ────────────────────────┤  future parked in pending_ops
...script keeps running...                          └──── spawn_blocking ────▶ open + read_to_end
                                     poll_event_loop: phase 2b                       │
  __eventLoopTick(promiseId, true, text) ◀──── (promise_id, op_id, result) ◀─────────┘
  microtask checkpoint → `await` resumes
```

1. **Your code → extension JavaScript (V8, JavaScript thread).** `readTextFile` makes a cancel-handle resource only when a `signal` is given. Then it awaits `op_fs_read_file_text_async(pathFromURL(path), cancelRid)` ✅[^fs-js].
2. **Op binding → permission container (Rust, same thread).** This is the JavaScript-to-Rust boundary, not a network call.
   - After looking up the optional cancel handle, and before any file work, the op calls `state.borrow::<deno_permissions::PermissionsContainer>().check_open(Cow::Owned(path), OpenAccessKind::Read, Some("Deno.readFile()"))` ✅[^fs-ops].
   - A refusal comes back as an error of class `NotCapable` with the message "Requires … run again with the --allow-… flag" ✅[^perm-lib]. The sync variant makes the same check ✅[^fs-ops].
   - With `--allow-read` for all paths, the check skips the per-path lookup and writes both a read and a write audit line ✅[^perm-lib].
3. **Op → Tokio (leaves the JavaScript thread).**
   - The standard file system runs `open` and `read_to_end` inside `spawn_blocking`, so that a slow open "must not stall the runtime thread" ✅[^std-fs].
   - The eager first poll finds the future not ready. JavaScript gets a promise keyed by `promise_id` and goes on running ✅[^op2].
4. **Event loop → JavaScript (back on the JavaScript thread).**
   - On a later tick, `dispatch_event_loop_tick` collects finished `(promiseId, isOk, res)` triplets, at most 1024 values per call, and calls the JavaScript callback once ✅[^jsruntime].
   - `__eventLoopTick` resolves each promise and leaves microtasks for Rust to run ✅[^core-js].
   - V8 runs with the `Explicit` microtask policy, so promise reactions run only at the checkpoints `JsRuntime` calls ✅[^setup] ✅[^jsruntime].

### 5. One event-loop tick
`poll_event_loop_inner` is "loosely following libuv's architecture", with microtask checkpoints between phases ✅[^jsruntime]:

| Phase | What runs (2.9.8 source) |
|---|---|
| Pre-phase | inspector sessions, V8 foreground tasks, a microtask checkpoint |
| 1 Timers | expired timers of native addons (N-API, Node's native-addon interface) in the libuv-style layer (libuv is the event-loop library of Node.js) |
| 2 Pending work | module loading progress; expired JavaScript timers **first**, then completed async ops; a microtask checkpoint; `nextTick` and macrotask queues; promise-rejection events |
| 3 Idle / prepare | libuv idle and prepare callbacks |
| 4 I/O | one I/O (input/output) pass: TCP (Transmission Control Protocol) read, write and accept in the libuv-compatible layer |
| 5 Check | `setImmediate` callbacks, then `nextTick` again |
| 6 Close | close callbacks |
| End | nothing pending (ops, timers, dynamic imports, module evaluation, inspector) → `Poll::Ready`, `run_event_loop` returns |

## Worked example
`trace.ts` starts a 0 ms timer, an async read it may do, a microtask and a sync read it may not do. Then it prints the order 50 ms later:
```ts
const order: string[] = [];
setTimeout(() => order.push("timer callback"), 0);
Deno.readTextFile("/etc/alpine-release").then((t) => order.push(`async op resolved: ${t.trim()}`));
Promise.resolve().then(() => order.push("microtask"));
order.push("sync code");
try { Deno.readTextFileSync("/etc/hostname"); } catch (e) { order.push(`sync op denied: ${(e as Error).name}`); }
setTimeout(() => console.log(order.join("\n")), 50);
```
```console
$ DENO_AUDIT_PERMISSIONS=/tmp/audit.jsonl deno run --allow-read=/etc/alpine-release trace.ts
sync code
sync op denied: NotCapable
microtask
timer callback
async op resolved: 3.24.2
$ cat /tmp/audit.jsonl
{"v":1,"datetime":"2026-11-24T08:52:19Z","permission":"read","value":"/etc/alpine-release"}
{"v":1,"datetime":"2026-11-24T08:52:19Z","permission":"read","value":"/etc/hostname"}
```
✅[^run]

| Line | Why, by the mechanism |
|---|---|
| `sync code`, then `sync op denied` | The sync op ran inline, and its permission check threw before any disk access ✅[^fs-ops] |
| `microtask` | Promise reactions wait for a microtask checkpoint, and one runs before any timer or op callback in each tick ✅[^jsruntime] |
| `timer callback` before `async op resolved` | This order is not fixed: in 40 re-runs of the same command, `async op resolved` came first 30 times ✅[^run]. Phase 2 fires expired timers before it hands out finished ops, so the timer wins only when both are ready in the same tick; a read that finishes on the blocking pool before the timer has expired is delivered first ✅[^jsruntime] ✅[^std-fs] |
| two audit lines | Both checks were logged, the granted one and the refused one ✅[^run] |

Where the time goes before line 1. `DENO_STARTUP_PHASES=1` is a diagnostic variable read in `jsruntime.rs` ✅[^jsruntime]. For an empty file it printed about 30 `[boot]` and `[startup]` lines; these six carry the main costs ✅[^run]:
```
[startup] create_isolate (v8 snapshot deser)  3.446425ms
[startup]        V8 Context::from_snapshot  2.606131ms
[startup] ops_bindings (fast call upgrade)  3.625µs
[startup]       TOTAL JsRuntime::new_inner  6.821683ms
[startup]  MainWorker::bootstrap (99_main)  373.709µs
[boot]      after worker.run (exit)  13.116739ms
```
Twenty back-to-back runs of the empty file took 0.34 s in total (about 17 ms each) in the first measurement, and 0.15–0.19 s (about 8–10 ms each) in three re-runs the same day; four more `DENO_STARTUP_PHASES` runs ended at 4.9–11.3 ms ✅[^run]. Such timings depend on the host and its load. The 2.9 release note, measured on a dedicated x86_64 Linux machine, reports hello-world cold start going from 34 ms to 17 ms after `node:` globals were lazy-loaded out of the snapshot, a V8 code cache was added for residual lazy modules, and the snapshot was minified ✅[^v29].

**How the snapshot gets there.** At build time, `cli/snapshot/build.rs` calls `deno_runtime::snapshot::create_runtime_snapshot` and writes `CLI_SNAPSHOT.bin` to `OUT_DIR`. Lazy extension files that the snapshot did not use are pre-transpiled and embedded as "residual" sources ✅[^snap-build]. At run time, `cli/snapshot/lib.rs` embeds that file with `include_bytes!` ✅[^snap-lib], and `JsRuntime::new` takes it as `startup_snapshot` ✅[^core-snapshot]. V8 deserializes the saved heap straight into a context, which is quicker than running the setup code again ✅[^v8-snap]. The roll-your-own-runtime series does the same in miniature with `deno_core::snapshot::create_snapshot` in `build.rs` ✅[^ryo3].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `Deno.resources()`, `Deno.metrics()`, `Deno.close()` from the architecture page | `typeof` gives `undefined` for all three in 2.9.8 ✅[^run] | Removed in Deno 2; the page is older than that ✅[^migrate] ✅[^arch] |
| Stack frame `at Object.readTextFileSync (ext:deno_fs/30_fs.js:1:9859)` | Line 1, column in the thousands ✅[^run] | 2.9 ships a minified snapshot ✅[^v29]; the frame is the extension's JavaScript wrapper, not your code |
| `typeof Deno.core` in user code | `"undefined"` ✅[^run]; internal helpers sit behind the `Deno[Deno.internal]` symbol ✅[^run] | Scrubbed from the public `Deno` after bootstrap ✅[^jsruntime] |
| Long sync op (`readFileSync` on a slow mount) | Blocks timers, other ops and microtasks until it returns | The sync op reads the file inside the op body on the JavaScript thread ✅[^fs-ops]; only async reads move to the blocking pool, which exists so they do not "stall the runtime thread" ✅[^std-fs] |
| More than one finished op at once | Delivered in batches of at most 1024 values (341 triplets) per call, then the loop wakes itself again | `MAX_VEC_SIZE_FOR_OPS` in `dispatch_event_loop_tick` ✅[^jsruntime] |
| Audit log under blanket `--allow-read` | One read logs both a `read` and a `write` line; with `--allow-read=/etc/alpine-release` it logs only `read` ✅[^run] | The allow-all shortcut writes both audit entries ✅[^perm-lib]; flags and audit → `deno/security/permission-flags.md` |
| Looking for `deno_core` on GitHub | `denoland/deno_core` is archived: "merged into denoland/deno" ✅[^core-archived] | Read `libs/core/` and `libs/ops/` in the main repository at the release tag |
| Embedding `deno_core` yourself | No TypeScript, no `Deno` namespace, no permissions; you drive `run_event_loop` from your own Tokio runtime ✅[^core-readme] ✅[^ryo1] | Those live in `deno_runtime` and `cli/` ✅[^rt-readme] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Sync API (`readTextFileSync`) | No promise or event-loop round trip; the result comes back at once ✅[^fs-js] | Blocks the only JavaScript thread for the whole call ✅[^fs-ops] |
| Async API (`readTextFile`) | The JavaScript thread stays free; reads run on Tokio's blocking pool ✅[^std-fs] | One tick or more of latency; the order relative to timers depends on the phase ✅[^jsruntime] |
| Startup snapshot | Context ready in about 1.4–2.6 ms in the lab instead of re-running bootstrap JavaScript ✅[^run] | Stores only slow op functions, so fast calls are re-attached later ✅[^jsruntime]; a larger binary, "typically negligible" ✅[^ryo3] |
| Lazily loaded extension JavaScript | An empty script loads none of it ✅[^jsruntime] | First use of an API pays to load the code; the V8 code cache softens this ✅[^v29] |

## Takeaways
- Treat every `Deno.*` call that touches the OS as an op: it checks permissions inside the op, so a refusal is a thrown `NotCapable` at the call site, not at startup. [rule-candidate]
- Use the async file and network APIs on servers and in loops; a sync op blocks timers and every other op until it returns. [rule-candidate]
- Never rely on a 0 ms timer and an async op settling in a fixed order; await the op if order matters. [rule-candidate]
- Read `deno_core` in `libs/core/` of `denoland/deno` at the release tag, not in the archived `deno_core` repository.
- Trust the 2.9.8 source over the contributing architecture page, which still shows APIs Deno 2 removed.

## Verification status
- Verified: 97 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Problem, Mental model, How it works, Worked example, Edge cases and Trade-offs. [^run]
- [ext/ folder (v2.9.8)](https://github.com/denoland/deno/tree/v2.9.8/ext) — Deno project, 2026. Rank 1. Backs: the 31 extension crates. [^ext-dir]
- [Deno Development Guide (CLAUDE.md, v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/CLAUDE.md) — Deno project, 2026. Rank 1. Backs: roles of `cli/`, `runtime/`, `ext/`; ops, extensions, resources. [^claude-md]
- [deno workspace Cargo.toml (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/Cargo.toml) — Deno project, 2026. Rank 1. Backs: `deno_core` 0.413.0 at `libs/core`, `deno_v8` 0.5.0 facade. [^deno-cargo]
- [cli/README.md (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/cli/README.md) — Deno project, 2026. Rank 1. Backs: role of the `deno` crate. [^cli-readme]
- [runtime/README.md (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/runtime/README.md) — Deno project, 2026. Rank 1. Backs: `deno_runtime`, `MainWorker`, a thread per `WebWorker`. [^rt-readme]
- [libs/core/README.md (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/core/README.md) — Deno project, 2026. Rank 1. Backs: `JsRuntime`, event loop driven by an executor, no TypeScript at that layer. [^core-readme]
- [denoland/deno_core](https://github.com/denoland/deno_core) — Deno project, 2026. Rank 1. Backs: repository archived and merged into `denoland/deno`. [^core-archived]
- [libs/ops/op2/README.md (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/ops/op2/README.md) — Deno project, 2026. Rank 1. Backs: `#[op2]`, fallible ops, eager async, `promise_id`, fast calls. [^op2]
- [libs/ops/README.md (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/ops/README.md) — Deno project, 2026. Rank 1. Backs: the `#[op2(fast)] pub fn op_add` example. [^ops-readme]
- [libs/core/extensions.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/core/extensions.rs) — Deno project, 2026. Rank 1. Backs: `extension!` options. [^ext-macro]
- [libs/core/io/resource.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/core/io/resource.rs) — Deno project, 2026. Rank 1. Backs: what a resource is. [^resource]
- [libs/core/io/resource_table.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/core/io/resource_table.rs) — Deno project, 2026. Rank 1. Backs: `ResourceId = u32`, `BTreeMap`, `next_rid`. [^rtable]
- [libs/core/runtime/jsruntime.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/core/runtime/jsruntime.rs) — Deno project, 2026. Rank 1. Backs: event-loop phases, op dispatch, deferred fast calls, `Deno.core` scrubbing, `DENO_STARTUP_PHASES`. [^jsruntime]
- [libs/core/runtime/setup.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/core/runtime/setup.rs) — Deno project, 2026. Rank 1. Backs: `MicrotasksPolicy::Explicit`. [^setup]
- [libs/core/01_core.js (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/core/01_core.js) — Deno project, 2026. Rank 1. Backs: `__eventLoopTick` resolves promises from triplets. [^core-js]
- [libs/core/runtime/snapshot.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/core/runtime/snapshot.rs) — Deno project, 2026. Rank 1. Backs: `create_snapshot` and `startup_snapshot`. [^core-snapshot]
- [runtime/tokio_util.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/runtime/tokio_util.rs) — Deno project, 2026. Rank 1. Backs: current-thread Tokio runtime. [^tokio-util]
- [cli/lib.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/cli/lib.rs) — Deno project, 2026. Rank 1. Backs: the CLI runs in `create_and_run_current_thread_with_maybe_metrics`. [^cli-lib]
- [runtime/worker.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/runtime/worker.rs) — Deno project, 2026. Rank 1. Backs: `common_extensions()` order and lazy init. [^worker]
- [cli/snapshot/build.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/cli/snapshot/build.rs) — Deno project, 2026. Rank 1. Backs: `CLI_SNAPSHOT.bin` built at compile time, residual sources. [^snap-build]
- [cli/snapshot/lib.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/cli/snapshot/lib.rs) — Deno project, 2026. Rank 1. Backs: snapshot embedded with `include_bytes!`. [^snap-lib]
- [ext/fs/ops.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/ext/fs/ops.rs) — Deno project, 2026. Rank 1. Backs: permission check first in each op, `op_fs_open_sync` adds a resource. [^fs-ops]
- [ext/fs/lib.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/ext/fs/lib.rs) — Deno project, 2026. Rank 1. Backs: the `deno_fs` extension declaration. [^fs-lib]
- [ext/fs/30_fs.js (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/ext/fs/30_fs.js) — Deno project, 2026. Rank 1. Backs: JavaScript wrappers, `#rid`, cancel handles. [^fs-js]
- [ext/fs/std_fs.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/ext/fs/std_fs.rs) — Deno project, 2026. Rank 1. Backs: async reads on `spawn_blocking`. [^std-fs]
- [runtime/permissions/lib.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/runtime/permissions/lib.rs) — Deno project, 2026. Rank 1. Backs: `check_open`, `NotCapable`, allow-all audit shortcut. [^perm-lib]
- [rusty_v8 README (v150.4.0)](https://github.com/denoland/rusty_v8/blob/v150.4.0/README.md) — Deno project, 2026. Rank 1. Backs: V8 15.0.245.2, binding goals, prebuilt libraries. [^rusty-v8]
- [Architecture Overview](https://docs.deno.com/runtime/contributing/architecture/) — Deno project, 2025. Rank 1. Backs: operating-system analogy; still shows `Deno.resources()` and `Deno.metrics()`. [^arch]
- [Deno 1.x to 2.x migration guide](https://docs.deno.com/runtime/reference/migration_guide/) — Deno project, living. Rank 1. Backs: `Deno.resources()`, `Deno.metrics()`, `Deno.close()` removed. [^migrate]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: 34 ms → 17 ms cold start, lazy `node:` globals, minified snapshot. [^v29]
- [Roll your own JavaScript runtime](https://deno.com/blog/roll-your-own-javascript-runtime) — Deno project, 2022 (updated 2024). Rank 1. Backs: embedding `deno_core` with Tokio and `run_event_loop`. [^ryo1]
- [Roll your own JavaScript runtime, pt. 3](https://deno.com/blog/roll-your-own-javascript-runtime-pt3) — Deno project, 2023 (updated 2024). Rank 1. Backs: snapshot in `build.rs`, small file-size cost. [^ryo3]
- [Custom startup snapshots](https://v8.dev/blog/custom-startup-snapshots) — V8 team, 2015. Rank 4. Backs: deserializing a snapshot into the heap instead of re-running setup. [^v8-snap]

## Related
- `deno/internals/module-loading-and-type-checking.md` — the steps between `deno run main.ts` and the first line.
- `deno/security/permission-model.md` — what each permission allows and how prompts work.
- `deno/runtime-apis/files-processes-and-environment.md` — the file and process APIs built on these ops.
- `javascript/async/event-loop-and-async-await.md` — microtasks and macrotasks at the language level.
