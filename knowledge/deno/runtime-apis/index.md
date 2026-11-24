---
schema: topic-index/v1
kind: subtopic
topic: deno/runtime-apis
last-updated: 2026-11-24
---

# Deno runtime APIs

How a Deno 2.9 program uses the `Deno` namespace to reach the machine: files and `Deno.FsFile` with `using`, subprocesses with `Deno.Command`, environment variables, arguments, exit and lifecycle events, OS (operating system) signals, the `Deno.errors` classes and `import.meta`; then Web Workers, the local Deno KV database (keys, versionstamps, atomic operations, `watch`, queues) and `Deno.cron`. Every behaviour was measured in Deno 2.9.8. Not covered: the permission rules themselves (`deno/security/`), HTTP servers (`deno/web/`), web-standard globals such as `fetch` (`deno/fundamentals/web-platform-apis.md`), and hosted services such as Deno Deploy.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [files-processes-and-environment.md](files-processes-and-environment.md) | concept | File system calls and `Deno.FsFile` disposal, `Deno.Command`, `Deno.env` / `Deno.args`, exit and unload events, signals, which `Deno.errors` class each failure throws, `import.meta`, standard streams | verified |
| [workers-kv-and-cron.md](workers-kv-and-cron.md) | concept | Module-only Web Workers and their messaging, local Deno KV (key order, versionstamps, atomic checks, `sum`, `watch`, queues), `Deno.cron` schedules and flags | verified |

## References
- [Deno APIs](https://docs.deno.com/api/deno/) — Deno project, living. Backs: the scope of the `Deno` namespace covered here.

## Related
- `deno/security/permission-model.md` — the permission gate every call in this subtopic passes.
- `deno/fundamentals/web-platform-apis.md` — the web-standard globals next to the `Deno` namespace.
- `deno/releases-stability-and-support.md` — the `--unstable-*` flags that KV, cron and worker options need.
