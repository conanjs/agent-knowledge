---
schema: topic-index/v1
kind: topic
topic: deno
last-updated: 2026-11-24
---

# Deno, the runtime

The Deno JavaScript and TypeScript runtime from the basics to advanced use, written in our own words from the official Deno documentation, the Deno source and its release posts. The basics: what Deno is, running code and TypeScript, web APIs, and the permission sandbox. Day-to-day project work: modules and dependencies, `deno.json` and workspaces, the built-in toolchain (tasks, formatter, linter, docs), testing, coverage and benchmarks, Node.js and npm compatibility, JSR (the JavaScript Registry) and the standard library. Building services: HTTP servers, WebSockets and server-sent events, file, process and environment APIs, workers, local Deno KV and cron. Advanced: the runtime's Rust architecture, module loading and type checking, FFI (foreign function interface) and WebAssembly, `deno compile`, debugging, profiling and OpenTelemetry; plus release channels, unstable flags and the project's support timeline after the 2026-10-09 announcement. Behaviours were run in Deno 2.9.8 in the lab described in `deno-lab-setup.md`; the few that cannot run there (Windows-only behaviour, Node-API native addons, the npm-side JSR commands, a full `deno desktop` build) are backed by the docs or the source, and their doc says so. Start with `learning-path.md`. Not covered: Deno Deploy, Deno Sandbox and the Fresh framework.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [learning-path.md](learning-path.md) | reference | Eight stages from basics to internals: docs to read in order, one lab exercise each with its real 2.9.8 output, and a self-check | verified |
| [deno-lab-setup.md](deno-lab-setup.md) | how-to | The pinned `denoland/deno:alpine-2.9.8` container every example ran in: run command, `NO_COLOR`, root versus `deno` user, expected outputs | verified |
| [releases-stability-and-support.md](releases-stability-and-support.md) | reference | Release channels (stable, LTS, RC, canary) and cadence, the stability policy, all 27 `--unstable-*` features, `deno upgrade`, Deno 1 → 2 changes, and the support timeline announced on 2026-10-09 | verified |

## Subtopics
| Subtopic | Summary |
|---|---|
| [fundamentals/](fundamentals/index.md) | What Deno is (V8, Rust and Tokio in one executable, secure by default, web standards, TypeScript built in), installing, `deno run`/REPL/`eval`, type checking and JSX, web APIs and globals |
| [security/](security/index.md) | The permission sandbox: deny by default, allow and deny lists and how they combine, prompts versus `NotCapable`, the `Deno.permissions` API; every flag and value, permission sets, audit and trace, the permission broker |
| [modules/](modules/index.md) | Specifiers (`jsr:`, `npm:`, `node:`, `https:`, `file:`), import maps, import attributes, dynamic `import()`; `deno add/install/outdated/why/list`, `deno.lock`, the `DENO_DIR` cache, `node_modules` modes, the minimum package age guard, private registries |
| [configuration/](configuration/index.md) | Every `deno.json` key, how the file is found, `package.json` alongside it; workspaces and monorepos |
| [toolchain/](toolchain/index.md) | All 48 entries of `deno --help` (47 subcommands plus `help`) and shared flags; `deno task` and its cross-platform shell; `deno fmt`, `deno lint` with plugins, `deno doc` |
| [testing/](testing/index.md) | `deno test`, `Deno.test`, steps, sanitizers, per-test permissions, `@std/assert`, `@std/expect`, spies, stubs, fake time, snapshots; `deno coverage` and `deno bench` |
| [node-compat/](node-compat/index.md) | `node:` built-ins, npm packages, the CommonJS rules, Node globals, lifecycle scripts; migrating an Express project step by step |
| [std-and-jsr/](std-and-jsr/index.md) | The JSR registry and `deno publish` (slow types, licence, provenance); the 43 `@std` packages with stability and imports |
| [web/](web/index.md) | `Deno.serve` and `deno serve` (shutdown, streaming, TLS and HTTP/2, `--parallel`); WebSockets, server-sent events, `URLPattern` routing, static files |
| [runtime-apis/](runtime-apis/index.md) | Files and `Deno.FsFile`, `Deno.Command`, environment, signals, `Deno.errors`, `import.meta`; Web Workers, local Deno KV, `Deno.cron` |
| [internals/](internals/index.md) | How the executable is built and runs (`deno_core`, ops, resources, extensions, `rusty_v8`, the Tokio event loop, snapshots); module loading, transpiling and type checking |
| [advanced/](advanced/index.md) | FFI and WebAssembly; `deno compile`, `deno install -g` and `deno desktop`; the inspector, V8 flags, CPU profiles and built-in OpenTelemetry |

## References
- [Deno documentation](https://docs.deno.com/runtime/) — Deno project, living. Backs: topic scope.
- [denoland/deno](https://github.com/denoland/deno) — Deno project, living. Backs: topic scope (the runtime's source).

## Related
- `js-runtime/` — V8 and Node.js runtime behaviour.
- `javascript/` — the JavaScript language itself.
- `javascript/node/` — Node.js services and streams, for comparison.
