---
schema: topic-index/v1
kind: topic
topic: bun
last-updated: 2026-11-24
---

# Bun, the JavaScript toolkit

Bun from the basics to advanced use, written in our own words: one binary that is a JavaScript and TypeScript runtime (built on JavaScriptCore, written in Zig up to 1.3 and in Rust since 1.4), a package manager, a bundler and a test runner. The subtopics follow that split, then go past it: the HTTP server and networking APIs, the system APIs (files, processes and the Bun Shell, SQLite and SQL, workers and FFI, built-in utilities), Node.js compatibility and migration, and the internals (the JavaScriptCore engine, the event loop, measured performance against Node.js 24). Every behaviour was run in Bun 1.4.5 in the `oven/bun:1.4.5` image of the lab described in `linux/lab-setup.md` (plus `bunlab:1`, the same image with git, a C toolchain and a Secret Service; PostgreSQL and MySQL containers; and a Mac for code signing), and compared with Node.js 24.22.1 where that sharpens a point. Start with `learning-path.md`. Not covered: frameworks built on Bun (Elysia, Hono, Next.js), hosting providers' deploy guides, and JavaScript language behaviour that is the same in every engine (see `javascript/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [learning-path.md](learning-path.md) | reference | Eight stages from running code to the internals, each with docs, an exercise and a self-check, plus a map of every Bun documentation section to its doc | verified |

## Subtopics
| Subtopic | Summary |
|---|---|
| [fundamentals/](fundamentals/index.md) | What Bun is, running files and scripts, TypeScript and JSX transpilation without type checking, module resolution and file-type loaders, `bunfig.toml` and `.env` loading, watch and hot mode, debugging |
| [package-manager/](package-manager/index.md) | How `bun install` resolves, caches and links; `bun.lock`; hoisted and isolated linkers; workspaces, catalogs and `--filter`; lifecycle scripts and supply-chain controls; command reference |
| [http-and-networking/](http-and-networking/index.md) | `Bun.serve` routes and handlers, WebSockets with pub/sub and backpressure, `fetch` extensions, TCP, UDP, DNS and cookies |
| [system-apis/](system-apis/index.md) | `Bun.file` and `Bun.write`, `Bun.spawn` and the Bun Shell, `bun:sqlite` and `Bun.sql`, workers, FFI and Node-API, built-in utilities |
| [bundler/](bundler/index.md) | `Bun.build` options and output, plugins and macros, single-file executables, HTML imports, the full-stack dev server and HMR |
| [testing/](testing/index.md) | `bun test` discovery and execution model, mocks, module mocks, snapshots and fake time, configuration, coverage and reporters |
| [node-compat/](node-compat/index.md) | Node.js API compatibility status with measured differences, and migrating a Node.js project to Bun |
| [internals/](internals/index.md) | JavaScriptCore versus V8 as seen from code, event-loop ordering versus Node.js, and what we measured about Bun's speed |

## References
- [Bun documentation](https://bun.com/docs) — Oven, living. Backs: topic scope and structure.
- [Bun source repository at v1.4.5](https://github.com/oven-sh/bun/tree/bun-v1.4.5) — Oven and contributors, 2026. Backs: the version every doc describes.

## Related
- `js-runtime/` — V8 and Node.js runtime behaviour, the comparison point for Bun.
- `javascript/` — the language itself, measured in Node.js 24.
- `linux/lab-setup.md` — the lab every example ran in.
