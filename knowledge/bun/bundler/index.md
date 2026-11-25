---
schema: topic-index/v1
kind: subtopic
topic: bun/bundler
last-updated: 2026-11-25
---

# Bun bundler

How Bun 1.4.5 turns source files into shippable output: `Bun.build` and `bun build` (targets, formats, splitting, naming, minification, environment inlining, outputs and errors), the plugin API shared by the bundler and the runtime, bundle-time macros, single-file executables (`--compile`, cross-compiling, embedded files, bytecode), and HTML imports with the dev server, HMR, CSS bundling and production builds. Every behaviour was run in the `oven/bun:1.4.5` lab, and the docs cite the Bun docs pinned at tag `bun-v1.4.5`; features that only the newer bun.com pages describe are listed as gaps in each doc's Edge cases. Not covered here: the loaders table, export conditions and import attributes (`bun/fundamentals/module-resolution-and-loaders.md`), `Bun.serve` routing and server options (`bun/http-and-networking/bun-serve.md`), and `--watch`/`--hot` for server processes (`bun/fundamentals/watch-hot-and-debugging.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [bun-build.md](bun-build.md) | concept | `Bun.build` and `bun build`: pipeline, options side by side, artifacts, `AggregateError` vs `throw: false`, bundler-only loader behaviour, esbuild flags and loaders tried (most accepted and ignored), minify sizes measured, `dts` present only in the 1.4.6 canary | verified |
| [plugins-and-macros.md](plugins-and-macros.md) | concept | One plugin object at bundle time and at run time (preload), which hooks exist where, `defer()`, a C `onBeforeParse` native plugin on the parser threads, virtual modules, macros (order, threads) and what they can return, the node_modules block, runtime `onResolve` for bare names only in the 1.4.6 canary | verified |
| [single-file-executables.md](single-file-executables.md) | concept | `--compile`, sizes, cross-compiling eight targets and running the Linux ones (x64 under emulation, musl needing `libstdc++`), `/$bunfs/root` embedded files and SQLite, config autoload, baked flags, bytecode start-up measured per round and `.jsc` files across Bun versions (silent fallback), macOS ad-hoc signing, hardened runtime and the JIT entitlement measured on a Mac | verified |
| [fullstack-dev-server-and-html.md](fullstack-dev-server-and-html.md) | concept | HTML imports in `Bun.serve`, development vs production, HMR over `/_bun/hmr` and `import.meta.hot` driven in headless Chromium, CSS bundling (small `url()` files inlined), `bun ./index.html`, production and standalone HTML builds, `dispose` not called on tab close, CSS-module class maps at run time only in the 1.4.6 canary | verified |

## References
- [docs/bundler at bun-v1.4.5](https://github.com/oven-sh/bun/tree/bun-v1.4.5/docs/bundler) — Bun documentation source at the release tag, 2026. Backs: subtopic scope; the docs here cite these pinned pages.
- [Bundler](https://bun.com/docs/bundler) — Bun documentation, living (describes a release newer than 1.4.5). Backs: where the docs mention features documented on bun.com but absent in 1.4.5.

## Related
- `bun/fundamentals/module-resolution-and-loaders.md` — loaders and import attributes the bundler uses.
- `bun/http-and-networking/bun-serve.md` — the server that HTML imports plug into.
- `bun/fundamentals/configuration-and-environment.md` — `bunfig.toml` keys (`preload`, `[serve.static]`) and environment variables.
