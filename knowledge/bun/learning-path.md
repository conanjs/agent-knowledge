---
schema: knowledge-doc/v1
type: reference
topic: bun
status: verified
applies-to: ["the docs under knowledge/bun/ as of 2026-11-24", "Bun 1.4.5"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [bun, learning-path, curriculum, runtime, package-manager, bundler, test-runner]
---

# Bun learning path

## Summary
**TL;DR:** Eight stages from the basics to the internals: run code, configure the development loop, manage packages, serve HTTP and WebSockets, use the system APIs, test, bundle and ship, then Node.js compatibility and the engine underneath. Each stage lists the docs to read in order, one exercise to run in the `oven/bun:1.4.5` image, and a self-check. A second table maps every section of the official Bun documentation to the doc here that covers it.
**Use this when:** you start learning Bun, plan a move from Node.js, or want to know which doc covers a page of the Bun documentation.
**Not this doc:** JavaScript language behaviour that is the same in every engine → `javascript/learning-path.md`; V8 and Node.js internals → `js-runtime/`.

## Scope
The v1 docs under `knowledge/bun/`, eight subtopics, all describing Bun 1.4.5 and run in the lab of `linux/lab-setup.md` (`docker run --rm -v "$PWD:/w" -w /w oven/bun:1.4.5 bun <file>`). Paths below are relative to `knowledge/bun/`.

## Catalog

### Stages

| # | Stage | Read | Exercise | Self-check: you can explain … |
|---|---|---|---|---|
| 1 | Run code | `fundamentals/what-bun-is.md` → `fundamentals/running-code-and-transpilation.md` → `fundamentals/module-resolution-and-loaders.md` | Run a `.ts` file that has a type error with `bun file.ts`, then with `bun --check file.ts`; import a `.toml` file and `require()` an ES module from a `.cjs` file | … why a type error still runs by default, why `process.versions.node` cannot tell Bun from Node, and which loader handles an import without an extension |
| 2 | Configure the development loop | `fundamentals/configuration-and-environment.md` → `fundamentals/watch-hot-and-debugging.md` | Put conflicting values in `.env`, `.env.production` and `.env.local`, print them under three `NODE_ENV` values; count a `globalThis` counter under `--watch` and under `--hot` | … which `.env` file wins, why `bun run <script>` does not hand `.env` values to the script's shell, and what survives a `--hot` reload |
| 3 | Manage packages | `package-manager/install-mechanics-and-lockfile.md` → `package-manager/linkers-hoisted-and-isolated.md` → `package-manager/workspaces-catalogs-and-filter.md` → `package-manager/lifecycle-scripts-and-supply-chain.md` → `package-manager/pm-commands-reference.md` | Install the same project with `--linker hoisted` and `--linker isolated`, then import a transitive dependency directly; add a local dependency with a `postinstall` script | … what a phantom dependency is and which linker blocks it, what `bun.lock` records, and why a dependency's lifecycle script does not run until it is trusted |
| 4 | Serve HTTP and WebSockets | `http-and-networking/bun-serve.md` → `http-and-networking/websockets-and-pubsub.md` → `http-and-networking/networking-apis-reference.md` | Write a `routes` table with a static path, a `:param` and a wildcard that all match one URL; build a two-client pub/sub chat | … which route wins, what an unlisted method on a per-method route gets, and what `ws.send()` returning `-1` versus `0` means |
| 5 | Use the system APIs | `system-apis/file-io.md` → `system-apis/processes-and-shell.md` → `system-apis/sqlite-and-sql.md` → `system-apis/workers-ffi-and-native-code.md` → `system-apis/builtin-utilities-reference.md` | Pass `"x; echo pwned"` into a Bun Shell template; store `2**53 + 1` in SQLite with and without `safeIntegers` | … why `Bun.file()` on a missing path does not throw, why shell interpolation is not injection, and when `bun:ffi` beats a worker |
| 6 | Test | `testing/bun-test-runner.md` → `testing/mocks-snapshots-and-time.md` → `testing/test-config-coverage-reporters.md` | Set a global in one test file and read it in another, with and without `--isolate`; call `mock.module()` after the import it should replace | … why files share globals by default, why `mock.module()` needs a preload for import-time values, and how a coverage threshold failure shows up |
| 7 | Bundle and ship | `bundler/bun-build.md` → `bundler/plugins-and-macros.md` → `bundler/single-file-executables.md` → `bundler/fullstack-dev-server-and-html.md` | Bundle with and without `minify` and compare sizes; compile a hello-world with `--compile` and look at its size; inline a value with a macro | … what runs at bundle time in a macro, what a compiled executable embeds, and how an HTML import becomes bundled assets |
| 8 | Node.js compatibility and internals | `node-compat/nodejs-compatibility.md` → `node-compat/migrating-from-node.md` → `internals/javascriptcore-engine.md` → `internals/event-loop-and-scheduling.md` → `internals/performance-measured.md` | Run a strict-mode tail-recursive `sum(1e6)` in Bun and in Node 24; log the order of `nextTick`, a microtask, `setImmediate`, `setTimeout(0)` and an `fs` callback in both | … which `node:*` modules are partial, why strict-mode stack traces lose frames in Bun, and where Node 24 measured faster |

### Bun documentation to doc map

| Bun documentation section | Pages | Doc(s) |
|---|---|---|
| Get started | Welcome, Installation, Quickstart, TypeScript, `bun init`, `bun create` | `fundamentals/what-bun-is.md`, `fundamentals/running-code-and-transpilation.md` |
| Runtime: running code | Bun Runtime, JSX, Auto-install, REPL | `fundamentals/running-code-and-transpilation.md` |
| Runtime: resolution and file types | Module Resolution, File Types, TOML, YAML, JSON5, JSONL, XML, Markdown imports | `fundamentals/module-resolution-and-loaders.md` (the parse APIs: `system-apis/builtin-utilities-reference.md`) |
| Runtime: configuration | bunfig.toml, Environment Variables | `fundamentals/configuration-and-environment.md` |
| Runtime: development loop | Watch Mode, Debugging | `fundamentals/watch-hot-and-debugging.md` |
| HTTP server | Server, Routing, Cookies, TLS, Error Handling, Metrics | `http-and-networking/bun-serve.md`, `http-and-networking/networking-apis-reference.md` |
| WebSockets | WebSockets | `http-and-networking/websockets-and-pubsub.md` |
| Networking | Fetch, TCP, UDP, DNS | `http-and-networking/networking-apis-reference.md` |
| Files and data | File I/O, Streams, Binary Data, Archive | `system-apis/file-io.md`, `system-apis/builtin-utilities-reference.md` |
| Processes | Shell, Spawn, Cron | `system-apis/processes-and-shell.md`, `system-apis/builtin-utilities-reference.md` |
| Databases and services | SQLite, SQL, S3, Redis, Secrets | `system-apis/sqlite-and-sql.md`, `system-apis/builtin-utilities-reference.md` |
| Concurrency and native code | Workers, Node-API, FFI, C Compiler | `system-apis/workers-ffi-and-native-code.md` |
| Utilities | Hashing, Glob, Semver, Color, Utils, HTMLRewriter, Transpiler, CSRF Protection, Image, Console, Globals, Bun APIs, Web APIs | `system-apis/builtin-utilities-reference.md` |
| Package manager | `bun install`, `add`, `remove`, `update`, `outdated`, `why`, `audit`, `info`, `link`, `pm`, `patch`, `publish`, `dedupe`, `prune`, `bunx`, Scopes and registries, `.npmrc`, Overrides | `package-manager/pm-commands-reference.md` |
| Package manager: internals | Global cache, Lockfile | `package-manager/install-mechanics-and-lockfile.md` |
| Package manager: layouts | Isolated installs, Global virtual store | `package-manager/linkers-hoisted-and-isolated.md` |
| Package manager: monorepos | Workspaces, Catalogs, `--filter` | `package-manager/workspaces-catalogs-and-filter.md` |
| Package manager: security | Lifecycle scripts, Security Scanner API | `package-manager/lifecycle-scripts-and-supply-chain.md` |
| Bundler | Bundler, Loaders, Minifier, esbuild | `bundler/bun-build.md` |
| Bundler: extending | Plugins, Macros | `bundler/plugins-and-macros.md` |
| Bundler: shipping | Single-file executable, Bytecode Caching | `bundler/single-file-executables.md` |
| Bundler: full stack | Fullstack dev server, Hot reloading, HTML & static sites, Standalone HTML, CSS | `bundler/fullstack-dev-server-and-html.md` |
| Test runner | Test runner, Writing tests, Finding tests, Parallel & isolated runs, Lifecycle hooks, Runtime behavior | `testing/bun-test-runner.md` |
| Test runner: test doubles | Mocks, Snapshots, Dates and times | `testing/mocks-snapshots-and-time.md` |
| Test runner: configuration | Test configuration, Code coverage, Test Reporters, DOM testing | `testing/test-config-coverage-reporters.md` |
| Compatibility | Node.js Compatibility | `node-compat/nodejs-compatibility.md`, `node-compat/migrating-from-node.md` |
| Project | Benchmarking | `internals/performance-measured.md` |

## Lookup notes
- **Read the docs pinned to the release.** The live bun.com documentation runs ahead of the latest release: its lifecycle-hooks page documents `aroundEach` ✅[^2], the same page at the `bun-v1.4.5` tag does not ✅[^3], and `typeof aroundEach` from `bun:test` is `"undefined"` in Bun 1.4.5 ✅[^lab]. The pinned copies live in the repository as `.mdx` files: `https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/<path>.mdx` answers 200, the same path ending in `.md` answers 404 ✅[^lab]. Each doc here lists the features it found on bun.com but not in 1.4.5 in its Edge cases or Lookup notes.
- Bun 1.4 rewrote Bun from Zig to Rust ✅[^4]; articles that say Bun is written in Zig describe 1.3 and earlier.

## Takeaways
- Learn Bun in the order run → configure → install → serve → system APIs → test → bundle → internals; each stage uses the previous one.
- Check a feature against the docs pinned to your Bun version, not the live site, before relying on it. [rule-candidate]

## Verification status
- Verified: 5 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24, and where every exercise runs. [^lab]
- [Bun documentation](https://bun.com/docs) — Oven, living. Backs: the section and page names of the documentation map.
- [Lifecycle hooks](https://bun.com/docs/test/lifecycle) — Bun documentation (live), living. Backs: `aroundEach` documented on the live site. [^2]
- [docs/test/lifecycle.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/lifecycle.mdx) — Bun documentation as released with 1.4.5, 2026. Backs: no `aroundEach` in the 1.4.5 docs. [^3]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Oven, 2026. Backs: the rewrite from Zig to Rust. [^4]

## Related
- `bun/index.md` — the topic and its subtopics.
- `javascript/learning-path.md` — the language, stage by stage.
- `js-runtime/` — V8 and Node.js internals, the comparison point.
