---
schema: topic-index/v1
kind: subtopic
topic: deno/node-compat
last-updated: 2026-11-24
---

# Node.js and npm compatibility in Deno

How Deno 2.9 runs code written for Node.js: `node:` built-in modules, npm packages through `npm:` or `package.json`, the rules that decide whether a file is CommonJS or an ES module, Node globals and types, export conditions, npm lifecycle scripts and native addons, and a step-by-step migration of an Express project. Every behaviour was run in Deno 2.9.8, except loading a Node-API addon. Not covered: the general specifier and import-map rules (`deno/modules/`), `deno install` and lockfiles in depth (`deno/modules/dependency-management.md`), and the permission system itself (`deno/security/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [node-and-npm-compatibility.md](node-and-npm-compatibility.md) | concept | `node:` and bare built-ins, `npm:` and `package.json`, CommonJS detection, Node globals, `@types/node`, export conditions, lifecycle scripts, Node-API addons, the `node` shim, the published API status and where it lags | verified |
| [migrating-a-node-project.md](migrating-a-node-project.md) | how-to | Run an Express project with `deno install`, `"type": "commonjs"`, scoped `deno run` flags, `deno task` and `deno test`; troubleshooting from real errors | verified |

## References
- [Node and npm Compatibility](https://docs.deno.com/runtime/fundamentals/node/) — Deno project, living. Backs: subtopic scope.
- [Migrate from Node.js](https://docs.deno.com/runtime/migrate/) — Deno project, living. Backs: the migration how-to.

## Related
- `deno/modules/` — specifiers, import maps and dependency management.
- `deno/security/` — permissions that npm code runs under.
- `deno/toolchain/tasks-and-task-shell.md` — `deno task` and `package.json` scripts.
