---
schema: topic-index/v1
kind: subtopic
topic: bun/package-manager
last-updated: 2026-11-25
---

# Bun's package manager

How `bun install` resolves, downloads, caches and links packages and what `bun.lock` records; the hoisted and isolated `node_modules` layouts and the global virtual store; monorepos with workspaces, the `workspace:` protocol, catalogs and `--filter`; which install-time scripts run and the supply-chain controls around them (trust lists, security scanner, minimum release age, `bun audit`); and a lookup reference for every package-manager command, override form, registry setting and `[install]` key. Every behaviour was run in Bun 1.4.5 in the `oven/bun:1.4.5` lab image. Not covered here: running scripts and files with `bun run` (`bun/fundamentals/running-code-and-transpilation.md`), the general `bunfig.toml` structure and `BUN_*` variables (`bun/fundamentals/configuration-and-environment.md`), run-time auto-install (`bun/fundamentals/`), and install speed measured against npm (`bun/internals/performance-measured.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [install-mechanics-and-lockfile.md](install-mechanics-and-lockfile.md) | concept | Resolution, the 5-minute manifest cache and `Cache-Control`, integrity checks, hard-link/clonefile/copy/symlink backends measured on Linux and on macOS (APFS clones), what each `bun.lock` entry field means, `bun.lock` vs `bun.lockb` and a real Bun 1.1.45 `bun.lockb` converted by 1.4.5, flags that write or do not write, lockfile migration order and versions, cold vs warm timing | verified |
| [linkers-hoisted-and-isolated.md](linkers-hoisted-and-isolated.md) | concept | Hoisted vs isolated layout, defaults by `configVersion`, phantom dependencies proved, peer sets per linker, `install.hoist` and hoist patterns, linker switching, the global virtual store, what stays project-local and its macOS benchmark on a 1,406-package project, the defaults in Bun 1.1.45 and 1.3.14, a pnpm 12 install compared link for link | verified |
| [workspaces-catalogs-and-filter.md](workspaces-catalogs-and-filter.md) | how-to | A monorepo end to end: workspaces, `workspace:*`/`workspace:^`, catalogs, `bun add/install --filter`, `bun run --filter` ordering, patterns and failures, `bun pm pack` rewrites, `bun publish --recursive` to a local registry, a registry package's `workspace:` range that still reaches a project workspace | verified |
| [lifecycle-scripts-and-supply-chain.md](lifecycle-scripts-and-supply-chain.md) | concept | Dependency scripts blocked by default, `trustedDependencies` modes, the built-in trust list and how it changed since Bun 1.1.45, `esbuild`'s binary linked without its `postinstall`, `bun pm trust`, script concurrency, security scanner, minimum release age and its stability check, `bun audit`, `bun why`, `bun pm diff` | verified |
| [pm-commands-reference.md](pm-commands-reference.md) | reference | Commands and flags, `bun pm` subcommands, `bun publish` against a local registry, `bunx`, overrides and resolutions, registry sources, `.npmrc` options and every credential form tested, `[install]` keys and install variables with defaults | verified |

## References
- [bun install](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/install.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: subtopic scope.
- [Bun source at bun-v1.4.5](https://github.com/oven-sh/bun/tree/bun-v1.4.5) — Bun source, 2026. Backs: the version these docs describe.

## Related
- `bun/fundamentals/configuration-and-environment.md` — `bunfig.toml` and environment variables.
- `bun/internals/performance-measured.md` — install speed against npm.
- `nodejs/node-nvm-corepack-pnpm-yarn-architecture.md` — legacy doc on how pnpm and Yarn are dispatched on Windows.
- `linux/lab-setup.md` — the lab.
