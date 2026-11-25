---
schema: knowledge-doc/v1
type: concept
topic: bun/fundamentals
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, watch, hot-reload, globalThis, bun-serve, file-watcher, no-clear-screen, inspect, inspect-wait, inspect-brk, debugger, debug-bun-sh, webkit-inspector-protocol, node-inspector]
---

# Watch mode, hot reload and the debugger in Bun

## Summary
**TL;DR:** `bun --watch app.ts` restarts the program from scratch whenever a file it imported changes: all state is gone (`globalThis.count` was `1` after every edit). `bun --hot app.ts` keeps the same process and re-evaluates every module, so `globalThis` survives (`count` went 1, 2, 3) while module-level variables start over; a `Bun.serve` server keeps its port and serves the new handler. Both watch exactly the files the program has loaded (static, dynamic and `require` imports) outside `node_modules`, not files it only read, and not `.env`, `bunfig.toml` or `tsconfig.json`. On a terminal both clear the screen on reload unless `--no-clear-screen`. `--inspect` starts a WebSocket debugger on `localhost:6499` and prints a `debug.bun.sh` link; `--inspect-wait` and `--inspect-brk` hold the program until the debugger sends `Inspector.initialized`, and `--inspect-brk` then stops on its first line only if the debugger has also switched on breakpoints and pauses at `debugger` statements.
**Use this when:** choosing between `--watch` and `--hot` for a dev loop, wondering why a change did or did not reload, keeping a server or a cache alive across edits, or attaching a debugger to Bun locally or in a container.
**Not this doc:** `server.reload()` and the rest of the `Bun.serve` API → `bun/http-and-networking/bun-serve.md`; browser hot module replacement (HMR) for front-end code → `bun/bundler/fullstack-dev-server-and-html.md`; watch mode for tests → `bun/testing/bun-test-runner.md`; heap snapshots and JavaScriptCore internals → `bun/internals/javascriptcore-engine.md`.

## Problem
Restart-on-change tools such as `nodemon` throw away everything on each save: open database connections, warmed caches, a running server, and the time to start again. Developers switch to `--hot` expecting "nothing is lost" and are surprised that a module-level `let` cache is reset anyway. Others edit `.env` and wait for a reload that never comes, or write `bun run dev --watch` and get no watching at all. When debugging, a short script exits before the debugger banner appears, and a debugger inside a container listens on `localhost`, unreachable from the host browser.

## Mental model
**Analogy:** `--watch` is rebooting a computer after you change a program: everything starts clean, including what was on the desk. `--hot` is closing and reopening only the documents while the computer keeps running: the desk (`globalThis`) keeps what you left on it, but each document's own scribbles (module-level variables) are redrawn from the saved file.

**Artifact:** the same file under both modes, before and after one edit (`version=1` → `version=2`), in the lab ✅[^lab]:
```ts
// state.ts — dep.ts holds: export const label = "dep-v1";
import { label } from "./dep.ts";
declare global { var count: number; }
globalThis.count ??= 0;
globalThis.count++;
console.log(`  pid=${process.pid} uptime=${process.uptime().toFixed(1)}s version=1 label=${label} globalThis.count=${globalThis.count}`);
setInterval(() => {}, 1_000_000);
```
```console
bun --hot state.ts     pid=328 uptime=0.0s version=1 label=dep-v1 globalThis.count=1
                       pid=328 uptime=1.0s version=2 label=dep-v1 globalThis.count=2
bun --watch state.ts   pid=357 uptime=0.0s version=1 label=dep-v1 globalThis.count=1
                       pid=357 uptime=0.0s version=2 label=dep-v1 globalThis.count=1
```

## How it works
**4 actors:**
- **File watcher** — its job: notice that a watched file changed, via the operating system's native API (inotify on Linux, kqueue on macOS).
- **Module registry** — its job: remember which files the program loaded, via Bun's module loader.
- **Bun process** — its job: run the program, via JavaScriptCore; on a change it restarts (`--watch`) or re-evaluates (`--hot`).
- **Debugger client** — its job: inspect and pause the program, via the WebKit Inspector Protocol over a WebSocket.

```
 edit dep.ts ──▶ File watcher (inotify) ──▶ is dep.ts in the module registry?
                                              │ no → nothing happens (.env, data.txt read with Bun.file)
                                              ▼ yes
             ┌────────────── --watch ──────────────┐   ┌──────────────── --hot ─────────────────┐
             │ run SIGTERM handlers                 │   │ reset require cache + ES module registry │
             │ restart: same args and environment   │   │ collect garbage                          │
             │ new VM: globalThis empty, uptime 0   │   │ re-transpile and re-evaluate all modules │
             │ Bun.serve binds the port again       │   │ same VM: globalThis kept, uptime grows   │
             └──────────────────────────────────────┘   │ Bun.serve keeps the port, new handler    │
                                                        └──────────────────────────────────────────┘
```

1. **Bun CLI (local): read the flag.** `--watch` and `--hot` are Bun flags, so they go right after `bun`: `bun --watch run dev`; after the script name they are passed to the script ✅[^1] (lab: `bun run dev --watch` printed `dev-script-args: --watch` and watched nothing ✅[^lab]). Watch mode works for running files, `bun test` and `bun build` ✅[^2]. Lab: `bun test --watch` ran the test again after an edit (`TEST RUN v1`, then `TEST RUN v2`), and `bun build --watch entry.ts --outdir out` rebuilt `out/entry.js` with the new text ✅[^lab].
2. **Module registry: decide what is watched.** Bun tracks every file the program imports ✅[^2]; under `--hot` it starts at the entry file and skips `node_modules` ✅[^2]. Files that no module imports, such as `.env`, `bunfig.toml` and `tsconfig.json`, are not watched; restart Bun to apply them ✅[^3]. Lab, under `--watch` ✅[^lab]:

   | Edited file | How the program used it | Reloaded? |
   |---|---|---|
   | `dep.ts` | `import { label } from "./dep.ts"` | yes |
   | `lazy.ts` | `await import("./lazy" + ".ts")` (computed at run time) | yes |
   | `conf.json` | `require("./conf.json")` | yes |
   | `data.txt` | `Bun.file("./data.txt").text()` | no (picked up at the next reload) |
   | `unrelated.ts`, `.env` | not used | no |
   | `node_modules/dep/index.js` | `import d from "dep"` | no, under `--watch` and under `--hot` alike ✅[^lab] |

3. **File watcher: notice the change.** Bun uses the native watcher APIs (kqueue, inotify) rather than polling, and reuses file descriptors ✅[^2]. Lab: the file-descriptor list of a running `bun --watch idle.ts` (`/proc/<pid>/fd`) held one `anon_inode:inotify` descriptor plus open descriptors for `/tmp/i.ts` and its folder `/tmp`, all in the one `bun` process ✅[^lab].
4. **Bun process under `--watch`: hard restart.**
   - Before each restart, it runs the handlers the program registered for the kill signal, `SIGTERM` by default; `--watch-kill-signal` picks another ✅[^2]. Lab: a `process.on("SIGTERM")` handler printed before every restart; with `--watch-kill-signal=SIGINT` the `SIGINT` handler printed instead ✅[^lab].
   - It restarts with the same arguments and environment variables, and restarts after a crash too ✅[^2]. Lab: `LABVAR=hello bun --watch crash.ts a1 a2` printed `ARGS a1,a2 ENV hello` on the first run and again after the restart ✅[^lab]. A JavaScript error that ends the program leaves Bun waiting; the next edit runs it again ✅[^lab]. A crash of Bun itself (a native segmentation fault, here from reading address 16 with `bun:ffi`'s `read.u8(16)`) restarted at once, in a loop: 532 crash reports in 1.5 s, until an edit removed the bad read ✅[^lab].
   - Lab: every run began with `uptime=0.0s` and `globalThis.count=1`, while the PID (process ID) stayed the same ✅[^lab].
5. **Bun process under `--hot`: soft reload.** Bun resets the `require` cache and the ES module registry, runs the garbage collector, re-transpiles every file and re-evaluates it with JavaScriptCore; `globalThis` persists ✅[^2]. Lab: same PID, uptime growing (`1.0s`, `2.0s`), `globalThis.count` 1 → 2 → 3, but a module-level `let moduleLocal = 0; moduleLocal++` printed `1` every time ✅[^lab].
6. **`Bun.serve` under each mode.** Under `--hot`, Bun detects the server and swaps in the new `fetch` handler without restarting the process ✅[^3] ✅[^2]. Lab, port 3999, handler text changed from `v1` to `v2` ✅[^lab]:

   | Mode | First `GET` | After the edit | Evaluations counter (`globalThis.starts`) |
   |---|---|---|---|
   | `--hot` | `handler=v1 pid=407` | `handler=v2 pid=407` | 1 → 2 |
   | `--watch` | `handler=v1 pid=436` | `handler=v2 pid=436` | 1 → 1 (fresh VM) |

   Under `--hot`, a `new SQL()` with unchanged settings reuses its PostgreSQL or MySQL connections across reloads since 1.4.4 ✅[^6]. Lab, a module-level `new SQL(url)` queried its server-side connection ID on every evaluation, against `postgres:latest` (18.3) and `mysql:8.4` containers: under `--hot`, `select pg_backend_pid()` returned `123` before and after two edits and `select connection_id()` returned `88` each time; under `--watch` each restart got a new one (`130`, `147`, `151`) ✅[^lab]. The same PostgreSQL probe in `oven/bun:1.3.14`, twice: under `--hot` every reload got a new connection too (`370`, `378`, `393`; then `430`, `439`, `449`), while 1.4.5 in the same session kept one (`489` three times; `531` three times) ✅[^lab]. How `server.reload()` swaps handlers is in `bun/http-and-networking/bun-serve.md`.
7. **Terminal: clear the screen.** On a terminal (a TTY, "teletypewriter", meaning an interactive console), each reload printed the sequence `ESC[2J ESC[3J ESC[H` (clear screen, clear scrollback, cursor home) twice in a row before the new output, under `--watch` and `--hot` alike, and nothing before the first run. That held with a terminal from `script` and from `docker run -t`, and for edits that replaced the file by renaming ✅[^lab]. `--no-clear-screen` or `BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD=true` removed both copies, and output to a file or pipe never had them ✅[^lab] ✅[^2] ✅[^4].
8. **Debugger: open the inspector.**
   - `--inspect` starts a WebSocket server speaking the WebKit Inspector Protocol and prints the address and a `debug.bun.sh` link ✅[^5]. Lab: the banner went to **stderr**, with `ws://localhost:6499/<uuid>` and `https://debug.bun.sh/#localhost:6499/<uuid>` ✅[^lab].
   - `--inspect=<port>`, `--inspect=<host>:<port>` and `--inspect=<host>:<port>/<prefix>` choose the address ✅[^5]; `--inspect=127.0.0.1:4000/lab` printed `ws://127.0.0.1:4000/lab` ✅[^lab].
   - `--inspect-wait` does not run the code until a debugger attaches; `--inspect-brk` also sets a breakpoint on the first line ✅[^5]. "Attaches" means more than opening the WebSocket: Bun releases the wait when a message `"method":"Inspector.initialized"` arrives ✅[^8]. Lab: a client that connected and sent nothing kept the program blocked for the whole 6 s it stayed connected; a client that sent `Inspector.enable` and `Debugger.enable`, waited 1 s, then sent `Inspector.initialized` saw the first line run 1–3 ms after that last message (median 2 ms over 6 runs) ✅[^lab].
   - The first-line breakpoint of `--inspect-brk` is a `debugger;` statement that the transpiler puts at the top of the entry file ✅[^9]. JavaScriptCore (JSC) stopped at it only when the client had switched on both `Debugger.setBreakpointsActive {"active": true}` and `Debugger.setPauseOnDebuggerStatements {"enabled": true}` ✅[^lab]. Bun's own debug adapter, written for editors such as VS Code, sends `Inspector.enable`, `Runtime.enable`, `Console.enable`, `Debugger.enable`, then `Debugger.setBreakpointsActive` and `Inspector.initialized`, and sends `Debugger.setPauseOnDebuggerStatements` when the editor's exception filters include `debugger` ✅[^10]. Lab, the same handshake with and without those two commands ✅[^lab]:

     | Sent before `Inspector.initialized` | Result |
     |---|---|
     | `Inspector.enable`, `Debugger.enable` only | no pause; the script ran 2 ms later |
     | + `Debugger.setBreakpointsActive` only | no pause |
     | + `Debugger.setPauseOnDebuggerStatements` only | no pause |
     | + both | `Debugger.paused` with `reason: "DebuggerStatement"`, top frame `module code`, line 0, column 0, 2–12 ms after `Inspector.initialized` (median 4 ms over 5 runs); nothing printed during the next second; `Debugger.resume` gave `Debugger.resumed` and the first line ran 0–3 ms later (median 1 ms) |

   - `debug.bun.sh` is a hosted, modified WebKit Web Inspector: sources, breakpoints, step controls and a console in the paused scope ✅[^5]. Lab, headless Chromium 156 in `bunlab:2` opening `https://debug.bun.sh/#127.0.0.1:6499/lab`: the page loaded but its WebSocket closed at once until Chromium's local-network-access checks, which hold back requests from a public site to a local address, were turned off (`--disable-features=LocalNetworkAccessChecks`). Then `--inspect-wait` released about 3 s after the browser started, and under `--inspect-brk` the program stayed stopped for the 14 s the page was open and ran as soon as the browser closed ✅[^lab]. The VS Code extension is experimental ✅[^5]; it was not tried, because the lab has no VS Code.
   - `node:inspector` works too: `inspector.open(9229, "127.0.0.1")` printed Node's `Debugger listening on ws://127.0.0.1:9229/<uuid>` and served `/json/list`, which `chrome://inspect` uses to discover targets ✅[^lab] ✅[^7].

## Worked example
One container, one shell script that starts Bun in the background, then edits files from the shell (a second process) one second apart, in the container's own filesystem. The entry `state.ts` imports `dep.ts` ✅[^lab]:

| Time | Event | `bun --hot state.ts` printed | `bun --watch state.ts` printed |
|---|---|---|---|
| 0 s | start | `pid=328 uptime=0.0s version=1 label=dep-v1 globalThis.count=1` | `pid=357 uptime=0.0s version=1 label=dep-v1 globalThis.count=1` |
| 1 s | `state.ts`: `version=1` → `version=2` | `pid=328 uptime=1.0s version=2 … count=2` | `pid=357 uptime=0.0s version=2 … count=1` |
| 2 s | `dep.ts`: `label` → `dep-v2` | `pid=328 uptime=2.0s … label=dep-v2 count=3` | `pid=357 uptime=0.0s … label=dep-v2 count=1` |
| 3 s | write `unrelated.ts` (not imported) | nothing | nothing |
| 4 s | write `.env` | nothing | nothing |

Both modes picked up both edits; only `--hot` carried `globalThis.count` across them, and only `--hot` let `uptime` grow.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Module-level variables under `--hot` | Reset on every reload (`moduleLocal` stayed `1`) ✅[^lab] | Every module is re-evaluated; only `globalThis` persists ✅[^2] |
| Timers under `--hot` | A `setInterval` from the old version keeps running: after one edit the output alternated `tick v1`, `tick v2` ✅[^lab] | The process and its event loop survive the reload; nothing clears the old module's timers |
| Editing through an OrbStack bind mount from macOS | Each save fired two reloads for 12 of 15 saves over 3 runs of 5 saves; the same edits made inside the container's own filesystem fired one each ✅[^lab] | Traced with a small inotify reader (C, built in `bunlab:1`): each save on the host arrived in the container as two write-and-close events, `MODIFY ATTRIB CLOSE_WRITE` then `MODIFY CLOSE_WRITE` 1–11 ms apart (10 events for 5 saves), where an edit inside the container gave one (5 for 5) ✅[^lab]. The doubling comes from the file-sharing layer, not from Bun |
| `bun run dev --watch` | No watching: the flag goes to the script, which printed `dev-script-args: --watch` ✅[^1] ✅[^lab] | Bun flags go before `run` |
| A quick script under `--inspect` | Exited before any banner was printed ✅[^lab] | The banner is written asynchronously to stderr; use `--inspect-wait` or `--inspect-brk` |
| `--inspect-brk` with a minimal protocol client (`Inspector.enable`, `Debugger.enable`, `Inspector.initialized`) | No `Debugger.paused` event; the script ran 2 ms after `Inspector.initialized` ✅[^lab] | Breakpoints and pauses at `debugger` statements were never switched on; adding `Debugger.setBreakpointsActive` and `Debugger.setPauseOnDebuggerStatements` gave the pause (step 8) ✅[^lab] |
| A client that connects but never sends `Inspector.initialized` | `--inspect-wait` and `--inspect-brk` keep the program blocked as long as the client stays connected (6 s in the lab) ✅[^lab] | The wait ends on that message, not on the connection ✅[^8] |
| Debugging inside Docker | `localhost` is the container's; bind `--inspect=0.0.0.0:6499` (printed `ws://0.0.0.0:6499/<uuid>`) and publish the port ✅[^lab] | Anyone who reaches that port can run code in the process: publish it only to `127.0.0.1` on the host |
| `debug.bun.sh` in Chromium 156 | The page loads but its WebSocket to `127.0.0.1` closes at once; headless, it connected only with `--disable-features=LocalNetworkAccessChecks` ✅[^lab] | The browser holds back a public `https` site's requests to a local address while that check is on |
| `--watch --check` | After a type error, Bun waits for the next change instead of running ✅[^2]. Lab: `TS2322` printed and nothing ran; after the fix, `CHECK RAN v2` printed (the file declared `console` and `setInterval` itself, since no `@types/bun` was installed) ✅[^lab] | Type check before every restart |
| `import.meta.hot` | Not supported; listed as planned ✅[^2]. Lab: `typeof import.meta.hot` was `"undefined"` under `--hot` ✅[^lab] | Use `globalThis` for state that must survive |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `--watch` | Clean state on every change; works for any program, tests and builds | Restart cost; connections and caches are rebuilt |
| `--hot` | Keeps the process, the port, `globalThis` and database connections; near-instant reloads | Module state resets anyway; leaks if old timers or listeners keep references (an old `setInterval` kept firing in the lab ✅[^lab]); re-transpiles every file ✅[^2] |
| `--inspect` on `0.0.0.0` | Debugger reachable from the host | Remote code execution for anyone on that network |

## Takeaways
- Use `--hot` for servers whose state (connections, caches) lives on `globalThis`; use `--watch` when every run must start clean. [rule-candidate]
- Keep state that must survive a hot reload on `globalThis` (`globalThis.cache ??= new Map()`), never in a module-level `let`. [rule-candidate]
- Restart Bun by hand after editing `.env`, `bunfig.toml` or `tsconfig.json`; neither mode watches them.
- Use `--inspect-wait` (or `--inspect-brk`) for short scripts; `--inspect` alone may exit before you attach.
- Under `--hot`, keep timer and listener handles on `globalThis` and clear the old ones at the top of the module; the old version's timers keep running otherwise.
- A hand-written inspector client must send `Debugger.setBreakpointsActive` and `Debugger.setPauseOnDebuggerStatements` before `Inspector.initialized`, or `--inspect-brk` runs straight through. [rule-candidate]
- In containers, bind the inspector to `0.0.0.0` and publish it only on the host's loopback: `-p 127.0.0.1:6499:6499`. [rule-candidate]

## Verification status
- Verified: 68 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; edits were made by a shell in the same container unless the text says the macOS host. The inotify trace used `bunlab:1` (the same Bun plus gcc), the `debug.bun.sh` run `bunlab:2` (plus Chromium 156), and the database runs `postgres:latest` (18.3) and `mysql:8.4` server containers; the inspector client was a 50-line Bun script speaking the protocol over `WebSocket`. The `--hot` comparison with `oven/bun:1.3.14` (`1.3.14+0d9b296af`) ran just after midnight on 2026-11-25 against a fresh `postgres:latest` container. [^lab]
- [Bun Runtime: docs/runtime/index.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/index.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: Bun flags go before `run`. [^1]
- [Watch Mode: docs/runtime/watch-mode.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/watch-mode.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `--watch` and `--hot` semantics, what each tracks, native watchers, kill signal handlers, `--check` with `--watch`, the hot-reload steps, `globalThis` persistence, `import.meta.hot` planned. [^2]
- [Hot reload an HTTP server: docs/guides/http/hot.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/http/hot.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `Bun.serve` reloaded without a restart; `.env`, `bunfig.toml`, `tsconfig.json` not watched. [^3]
- [Environment Variables: docs/runtime/environment-variables.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/environment-variables.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD`. [^4]
- [Debugging: docs/runtime/debugger.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/debugger.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: WebKit Inspector Protocol, `--inspect`, `--inspect-wait`, `--inspect-brk`, address forms, `debug.bun.sh`, the VS Code extension. [^5]
- [Bun v1.4.4](https://bun.com/blog/bun-v1.4.4) — Oven, 2026. Backs: `--hot` reuses database connections. [^6]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Oven, 2026. Backs: `node:inspector` `open`/`url`/`close`/`waitForDebugger`, Node's discovery endpoints and `chrome://inspect`. [^7]
- [src/jsc/bindings/BunDebugger.cpp at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/jsc/bindings/BunDebugger.cpp) — Bun source (Oven), 2026. Backs: the wait for a debugger ends when an `Inspector.initialized` message arrives. [^8]
- [src/js_parser/parse/parse_entry.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/js_parser/parse/parse_entry.rs) — Bun source (Oven), 2026. Backs: `--inspect-brk` inserts a `debugger` statement at the top of the entry file. [^9]
- [packages/bun-debug-adapter-protocol/src/debugger/adapter.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-debug-adapter-protocol/src/debugger/adapter.ts) — Bun source (Oven), 2026. Backs: the commands Bun's debug adapter sends on start (`Inspector.enable` … `Debugger.setBreakpointsActive`, `Inspector.initialized`) and when it sends `Debugger.setPauseOnDebuggerStatements`. [^10]

## Related
- `bun/http-and-networking/bun-serve.md` — `server.reload()` and the server under `--hot`.
- `bun/fundamentals/configuration-and-environment.md` — the no-clear variable and other settings.
- `bun/bundler/fullstack-dev-server-and-html.md` — browser-side HMR.
- `bun/testing/bun-test-runner.md` — `bun --watch test`.
- `bun/internals/javascriptcore-engine.md` — heap snapshots and memory.
- `linux/lab-setup.md` — the lab.
