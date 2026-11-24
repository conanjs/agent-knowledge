---
schema: topic-index/v1
kind: subtopic
topic: deno/security
last-updated: 2026-11-24
---

# Deno security and permissions

How Deno's permission sandbox decides what a program may read, write, connect to, run or import in Deno 2.9.8: deny by default, scoped grants and deny lists and how they combine, prompts versus `NotCapable` errors, the `Deno.permissions` API, the permissions that amount to full access, workers and subprocesses, then every flag and value, permission sets in `deno.json`, audit and trace variables and the permission broker. Every behaviour was measured in the lab of `deno/deno-lab-setup.md`. Not covered: the Worker API itself (`deno/runtime-apis/workers-kv-and-cron.md`), per-test permissions (`deno/testing/testing-and-mocking.md`), compiled executables (`deno/advanced/compile-and-distribution.md`), dependency auditing with `deno audit`, and operating-system sandboxing.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [permission-model.md](permission-model.md) | concept | Deny by default, the most-specific-entry rule for allow and deny, prompts only when stdin and stderr are terminals, `query`/`request`/`revoke`, why `--allow-run` and `--allow-ffi` equal `-A`, workers and subprocesses, import hosts | verified |
| [permission-flags.md](permission-flags.md) | reference | Every permission flag and short form in 2.9.8, value syntax (paths, hosts, CIDR, `unix:`, env wildcards, `sys` names), default import hosts, `deno.json` permission sets and `-P`, `DENO_NO_PROMPT`, `DENO_TRACE_PERMISSIONS`, `DENO_AUDIT_PERMISSIONS`, the permission broker protocol | verified |

## References
- [Security and permissions](https://docs.deno.com/runtime/fundamentals/security/) — Deno project, living. Backs: subtopic scope.
- [Permissions](https://docs.deno.com/runtime/reference/permissions/) — Deno project, living. Backs: subtopic scope.

## Related
- `deno/deno-lab-setup.md` — the container every run used.
- `deno/runtime-apis/` — the file, process, environment and worker APIs these permissions guard.
- `deno/configuration/deno-json-reference.md` — the rest of `deno.json`.
