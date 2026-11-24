---
schema: topic-index/v1
kind: subtopic
topic: deno/configuration
last-updated: 2026-11-24
---

# Deno configuration: deno.json and workspaces

How Deno 2.9 is configured through `deno.json` (or `deno.jsonc`): every top-level key, how the file is found, how a `package.json` next to it is read, and how a workspace root and its members share and override settings. Not covered here: what each configured feature does in depth (the lockfile, tasks, lint and fmt rules, permissions, TypeScript options), which the sibling subtopics own and each key's row links to.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [deno-json-reference.md](deno-json-reference.md) | reference | Every `deno.json` key in 2.9.8 with type, default and owning doc; discovery start folder per subcommand; `--config`, `--no-config`, `DENO_NO_PACKAGE_JSON`; `deno.json` versus `package.json` precedence; config warnings and errors | verified |
| [workspaces-and-monorepos.md](workspaces-and-monorepos.md) | concept | The `workspace` key and member globs, root-only versus merged keys, importing members by name, mixing Deno and npm members, catalogs, tasks and publishing across members | verified |

## References
- [Config files](https://docs.deno.com/runtime/fundamentals/configuration/) — Deno project, living. Backs: subtopic scope.
- [Workspaces and monorepos](https://docs.deno.com/runtime/fundamentals/workspaces/) — Deno project, living. Backs: subtopic scope.

## Related
- `deno/modules/` — import maps and dependency management, which many keys configure.
- `deno/toolchain/` — `deno task`, `deno fmt`, `deno lint`.
- `deno/deno-lab-setup.md` — the lab the outputs were measured in.
