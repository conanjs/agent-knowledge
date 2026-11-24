---
schema: topic-index/v1
kind: subtopic
topic: deno/fundamentals
last-updated: 2026-11-24
---

# Deno fundamentals

What Deno is and how its pieces fit (one executable built on V8, Rust and Tokio, secure by default, web standards first, TypeScript built in, an all-in-one toolchain), how to install it, how to start code (`deno run`, stdin, `deno eval`, the REPL, shebangs, `--watch`), how type checking, JSX and `compilerOptions` work, and which web APIs and globals Deno 2.9 offers. Every behaviour was run in Deno 2.9.8 in the lab of `deno/deno-lab-setup.md`. Not covered here: permissions in depth (`deno/security/`), import specifiers and dependencies (`deno/modules/`), every `deno.json` key (`deno/configuration/`), release channels and the support timeline (`deno/releases-stability-and-support.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [what-deno-is.md](what-deno-is.md) | concept | The pieces of Deno and how they fit when a program runs; five design choices; Deno and Node.js at a glance; install, verify and upgrade commands | verified |
| [running-code-and-typescript.md](running-code-and-typescript.md) | concept | `deno run` (file, URL, stdin), `deno eval`, the REPL, shebangs and `--watch`; `--check`, `--check=all` and `deno check`; `compilerOptions`, `lib`, `@ts-types`, `.d.ts`; JSX transforms; the `DENO_UNSTABLE_TSGO` switch | verified |
| [web-platform-apis.md](web-platform-apis.md) | reference | Every web API and global in Deno 2.9.8 with its differences from browsers, the browser globals that are missing, Node globals in user code, and the `Deno` namespace areas with their owning docs | verified |

## References
- [Deno documentation](https://docs.deno.com/runtime/) — Deno project, living. Backs: subtopic scope.

## Related
- `deno/index.md` — the whole Deno topic.
- `deno/security/` — how permissions work and every permission flag.
- `deno/toolchain/` — every subcommand, tasks, formatting and linting.
