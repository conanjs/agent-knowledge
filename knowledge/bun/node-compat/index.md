---
schema: topic-index/v1
kind: subtopic
topic: bun/node-compat
last-updated: 2026-11-25
---

# Bun and Node.js compatibility

How far Bun 1.4.5 behaves like Node.js: the status of every `node:*` module and Node global as Bun's 1.4.5 docs give it, a probe run side by side in Bun 1.4.5 and Node 24.22.1, and a step-by-step move of a Node 24 + npm project to Bun (install, scripts, TypeScript, watch mode, `.env`, tests, Docker). Not covered here: the event loop and engine differences (`bun/internals/`), package-manager internals (`bun/package-manager/`), and the test runner itself (`bun/testing/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [nodejs-compatibility.md](nodejs-compatibility.md) | reference | Status of every `node:*` module and global per the 1.4.5 docs with a lab check of each listed gap, a measured Bun-vs-Node table (including heap behaviour under container memory limits), and the gaps between bun.com and 1.4.5, checked in the 1.4.6 canary | verified |
| [migrating-from-node.md](migrating-from-node.md) | how-to | Replace npm, npx, tsx, nodemon, dotenv, Jest (starting from a working Jest 30 setup) and the Node base image with Bun, with verified commands, troubleshooting (including converting a Bun 1.1 `bun.lockb`) and rollback | verified |

## References
- [Node.js Compatibility, docs at tag bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/nodejs-compat.mdx) — Bun docs pinned to the 1.4.5 release, 2026. Backs: topic scope.
- [Migrate from npm install to bun install](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/install/from-npm-install-to-bun-install.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: topic scope.

## Related
- `bun/internals/` — JavaScriptCore, the event loop and measured performance
- `bun/fundamentals/` — running code, configuration and `.env`
- `bun/package-manager/` — `bun install` and `bun.lock`
- `js-runtime/node-type-stripping.md` — what Node 24 runs from a `.ts` file
