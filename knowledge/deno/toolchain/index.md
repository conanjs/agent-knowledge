---
schema: topic-index/v1
kind: subtopic
topic: deno/toolchain
last-updated: 2026-11-24
---

# Deno toolchain: CLI, tasks, formatter, linter and docs

The tools built into the `deno` executable, as measured in Deno 2.9.8: the catalog of every subcommand with its key flags and the shared flag groups, the `deno task` runner and its cross-platform shell, and the code-quality trio `deno fmt`, `deno lint` (with plugins) and `deno doc`. Not covered here: testing, coverage and benchmarks (`deno/testing/`), dependency commands in depth (`deno/modules/dependency-management.md`), compiling and packaging (`deno/advanced/compile-and-distribution.md`), and the `--unstable-*` flags (`deno/releases-stability-and-support.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [cli-subcommands.md](cli-subcommands.md) | reference | All 48 entries of `deno --help` with purpose, key flags and owner doc; top-level options, shared flag groups, global environment variables | verified |
| [tasks-and-task-shell.md](tasks-and-task-shell.md) | concept | `deno task`: task sources and object form, dependencies and parallelism, wildcards, caching, workspaces; the built-in shell's syntax, built-in commands and unsupported features | verified |
| [formatting-linting-and-docs.md](formatting-linting-and-docs.md) | concept | `deno fmt` file types, options and ignore comments; `deno lint` rules, tags, ignores and `--fix`; lint plugins; `deno doc` output modes and doc lint | verified |

## References
- [Deno CLI Subcommands](https://docs.deno.com/runtime/reference/cli/) — Deno project, living. Backs: subtopic scope.

## Related
- `deno/deno-lab-setup.md` — the container every example in these docs ran in.
- `deno/configuration/` — `deno.json`, where `tasks`, `fmt` and `lint` are configured.
- `deno/testing/` — `deno test`, `deno bench`, `deno coverage`.
