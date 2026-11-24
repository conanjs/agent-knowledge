---
schema: topic-index/v1
kind: subtopic
topic: deno/internals
last-updated: 2026-11-24
---

# Deno internals

How the Deno 2.9.8 executable works inside. It covers the crate layers (the `deno` command-line interface or CLI, `deno_runtime`, the `ext/` extensions, `deno_core`, `rusty_v8`), ops, resources, the Tokio-driven event loop and the startup snapshot. It also covers what happens between `deno run main.ts` and the first line: the module graph, fetching and caching, type stripping and the emit cache, and type checking with the bundled TypeScript compiler. Every claim is backed by the v2.9.8 source and lab runs. Not covered: how to use the permission flags, `deno check` or the dependency commands day to day (see Related), the language server, and Deno Deploy.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [runtime-architecture.md](runtime-architecture.md) | concept | The crate stack, `#[op2]` ops and fast calls, resources and rids, extensions, one async op from `await` to result, the six-phase event-loop tick, the startup snapshot and measured startup phases | verified |
| [module-loading-and-type-checking.md](module-loading-and-type-checking.md) | concept | `deno_graph` resolution and fetching, the `remote/` and `gen/` caches and their hash trailers, swc type stripping, when and how TypeScript 6.0.3 type-checks, and which stage reports which error | verified |

## References
- [denoland/deno at v2.9.8](https://github.com/denoland/deno/tree/v2.9.8) — Deno project, 2026. Backs: the source both docs were read from.

## Related
- `deno/security/permission-model.md` — the rules each op's permission check enforces.
- `deno/fundamentals/running-code-and-typescript.md` — using `deno run`, `deno check` and `--check`.
- `deno/modules/dependency-management.md` — the `DENO_DIR` cache, `--reload` and `deno clean` from the user's side.
- `deno/advanced/debugging-profiling-and-telemetry.md` — inspecting a running isolate.
