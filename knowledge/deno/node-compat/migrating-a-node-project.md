---
schema: knowledge-doc/v1
type: how-to
topic: deno/node-compat
status: verified
applies-to: ["Deno 2.9.8", "Node.js projects with a package.json, CommonJS or ES modules", "express 5.3.0"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, node, migration, express, package-json, commonjs, deno-install, deno-task, node-test, permissions]
ranked-sources: true
---

# Run an existing Node.js Express project with Deno 2.9

## Summary
**TL;DR:** In a Node project, `deno install` reads `package.json` and builds `node_modules` and `deno.lock`; then add `"type": "commonjs"` to `package.json` if your `.js` files use `require`, and run the entry point with `deno run` plus the exact permissions the errors name. `package.json` scripts run unchanged with `deno task`, and `node:test` tests run with `deno test`. A script that calls `node` runs through Deno's `node` shim with every permission granted, so give the server its own `deno.json` task with explicit flags.
**Use this when:** you want an existing Node.js project (for example an Express server) to run under Deno without rewriting it, or a migration attempt stops at `require is not defined` or `NotCapable`.
**Not this doc:** why these rules exist (CommonJS detection, globals, export conditions, lifecycle scripts) → `deno/node-compat/node-and-npm-compatibility.md`; what each permission flag allows → `deno/security/permission-flags.md`; the task runner and its shell → `deno/toolchain/tasks-and-task-shell.md`.

## Goal & prerequisites
**End state:** the sample Express server answers `GET /hello/Deno` with status 200 under `deno run` with three permission flags, two of them scoped to a path or an address; `deno task greet` and `deno test` pass. The only edits are a new `deno.json` and one `package.json` field whose value Node already assumes when the field is missing ✅[^node-pkg], so the Node setup is left as it was.

**Needs:**
- Deno 2.9.8. The reference run used the container lab in `deno/deno-lab-setup.md`, which has no Node.js installed ✅[^run]. Each command ran as `docker run --rm -e NO_COLOR=1 -v "$PWD:/lab" -w /lab denoland/deno:alpine-2.9.8 sh -c '…'`, with server and client in the same container.
- Network access to the npm registry for `deno install`.
- The starting project, written for Node.js (no `"type"` field, so Node treats `.js` as CommonJS ✅[^node-pkg]):

`package.json`:
```json
{
  "name": "sample-app",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "greet": "node scripts/greet.mjs World",
    "test": "node --test"
  },
  "dependencies": { "express": "^5.1.0", "ms": "^2.1.3" }
}
```
`server.js` (CommonJS):
```js
const express = require("express");
const ms = require("ms");
const { formatGreeting } = require("./lib/format.mjs");
const app = express();
const started = Date.now();
app.get("/hello/:name", (req, res) => {
  res.json({ message: formatGreeting(req.params.name), uptime: ms(Date.now() - started) });
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`listening on http://localhost:${port}`));
```
`lib/format.mjs` (an ES, ECMAScript, module), `scripts/greet.mjs` and `test/format.test.mjs`:
```js
// lib/format.mjs
export function formatGreeting(name) { return `Hello, ${name}!`; }
// scripts/greet.mjs
import { formatGreeting } from "../lib/format.mjs";
console.log(formatGreeting(process.argv[2] ?? "you"));
// test/format.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { formatGreeting } from "../lib/format.mjs";
test("formatGreeting greets by name", () => assert.equal(formatGreeting("Deno"), "Hello, Deno!"));
```

## Steps
1. **Install the dependencies with Deno.** `deno install` reads `package.json`, resolves the npm packages and writes `node_modules` ✅[^migrate]:
   ```console
   $ deno install
   Installed 65 packages in 899ms
   …
   Dependencies:
   + npm:express 5.3.0
   + npm:ms 2.1.3
   ```
   It also writes `deno.lock` ✅[^run]. If the project has a `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` or `bun.lock` and no `deno.lock`, Deno seeds `deno.lock` from it and keeps the locked versions ✅[^v29]; measured: `Seeded deno.lock from /lab/lockseed/package-lock.json`, with `ms` kept at the locked 2.1.2 and `package-lock.json` left in place ✅[^run].
2. **Run the entry point once to see what breaks.**
   ```console
   $ deno run server.js
   error: Uncaught (in promise) ReferenceError: require is not defined
   const express = require("express");
   ```
   Exit code 1 ✅[^run]. Deno treats a `.js` file as CommonJS only when the nearest `package.json` sets `"type": "commonjs"` ✅[^migrate].
3. **Mark the package as CommonJS.** Add one field to `package.json`:
   ```json
   "type": "commonjs",
   ```
   With it, the `require()`-based `.js` files run under both Node and Deno ✅[^migrate]; Node already treats a missing `"type"` as CommonJS ✅[^node-pkg], so Node behaviour does not change. Renaming `server.js` to `server.cjs` works too ✅[^migrate]. `lib/format.mjs` stays an ES module, and `server.js` loads it with `require()` because it has no top-level `await` ✅[^node-fund] ✅[^run].
4. **Run it again with no flags and read the permission error.**
   ```console
   $ deno run server.js
   error: Uncaught (in promise) NotCapable: Requires env access, run again with the --allow-env flag
   exports.inspectOpts = Object.keys(process.env).filter(key => {
   ```
   The access comes from the `debug` package inside `express`, which lists every variable ✅[^run]. Deno grants nothing by default; you can pass `-A` while migrating and tighten later ✅[^migrate], but the next step tightens now.
5. **Grant exactly what the server needs.** Each flag below was found by removing it and reading the error ✅[^run]:
   ```console
   $ deno run --allow-env --allow-read=. --allow-net="[::]:3000" server.js
   listening on http://localhost:3000
   ```
   - `--allow-env`: whole environment, because `debug` enumerates it; `--allow-env=PORT` still fails ✅[^run].
   - `--allow-read=.`: `require("./lib/format.mjs")` checks files in the project folder; packages in `node_modules` loaded without it ✅[^run].
   - `--allow-net="[::]:3000"`: `app.listen(3000)` binds the IPv6 any-address; `--allow-net=0.0.0.0:3000` fails ✅[^run].
6. **Call the server from a second Deno script.** Save as `client.ts`:
   ```ts
   const res = await fetch("http://localhost:3000/hello/Deno");
   console.log(res.status, res.headers.get("content-type"), await res.json());
   ```
   ```console
   $ deno run --allow-net=localhost:3000 client.ts
   200 application/json; charset=utf-8 { message: "Hello, Deno!", uptime: "3s" }
   ```
   ✅[^run]
7. **Run the existing `package.json` scripts with `deno task`**, the equivalent of `npm run` ✅[^migrate]:
   ```console
   $ deno task greet
   Task greet node scripts/greet.mjs World
   Hello, World!
   ```
   ✅[^run]. With no real `node` on `PATH`, the `node` in a script is Deno itself ✅[^node-fund]. Measured: that process got every permission (`read=granted write=granted net=granted env=granted run=granted sys=granted ffi=granted`), so `deno task start` would run the server unsandboxed ✅[^run]. `pre<name>` and `post<name>` scripts run around a script (`pretest`, `test`, `posttest` ran in that order) ✅[^run] ✅[^releases].
8. **Give the server a sandboxed task.** Create `deno.json` next to `package.json`:
   ```json
   {
     "tasks": {
       "start": "deno run --allow-env --allow-read=. --allow-net=[::]:3000 server.js"
     }
   }
   ```
   A `deno.json` task hides the `package.json` script of the same name, so `deno task start` now runs this line ✅[^run], while the `package.json` script stays as it was for Node users.
9. **Run the tests.** `deno test` finds `test/format.test.mjs` and runs its `node:test` test ✅[^run]; `node:test` is on the docs' fully supported list ✅[^node-apis]:
   ```console
   $ deno test
   running 1 test from ./test/format.test.mjs
   formatGreeting greets by name ... ok (596µs)

   ok | 1 passed | 0 failed (2ms)
   ```
   `deno task test` (the unchanged `node --test` script, through the shim) printed the same result ✅[^run].

**Leave unchanged:** the `require` calls, `package.json` scripts, `node:test` tests, a lockfile from another package manager, and bare imports such as `"fs"`, which resolve to `node:fs` in 2.9 ✅[^v29]. Lifecycle scripts are the exception: a dependency that needs its `postinstall` must be approved (Troubleshooting).

## Verify
| Check | Expected output (reference run, 2026-11-24) |
|---|---|
| `ls` | `deno.json`, `deno.lock` and `node_modules` beside the original files; `node_modules` holds `express` and `ms` as symlinks into `node_modules/.deno/` ✅[^run] |
| `deno task` | `start` (from `deno.json`, the `deno run …` line), then `greet (package.json)` and `test (package.json)` ✅[^run] |
| `deno task start &`, then `deno run --allow-net=localhost:3000 client.ts` | `listening on http://localhost:3000`, then `200 application/json; charset=utf-8 { message: "Hello, Deno!", uptime: "3s" }` (the uptime varies) ✅[^run] |
| `deno task greet` | `Hello, World!`, exit 0 ✅[^run] |
| `deno test` | `ok \| 1 passed \| 0 failed`, exit 0 ✅[^run] |

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `ReferenceError: require is not defined`, with `hint: Rewrite this module to ESM, or change the file extension to .cjs, …` ✅[^run] | A `.js` file uses `require` and the nearest `package.json` has no `"type": "commonjs"` ✅[^migrate] | Add `"type": "commonjs"`, rename the file to `.cjs`, or run with `--unstable-detect-cjs` ✅[^run] |
| `Error: Cannot find module 'express'` from `require`, or `Could not resolve "<pkg>", but found it in a package.json. … Did you forget to run \`deno install\`?` from `import` ✅[^run] | `node_modules` is missing or stale | Run `deno install` ✅[^migrate] |
| `NotCapable: Requires env access, run again with the --allow-env flag` at `debug/src/node.js`, even with `--allow-env=PORT` ✅[^run] | The package reads the whole environment | Pass `--allow-env` without a list |
| `NotCapable: Requires env access to "TF_BUILD"` as soon as `chalk` 5.6.2 is imported ✅[^run] | Its colour detection reads environment variables at import time ✅[^run] | Pass `--allow-env` |
| A `deno.json` appears after `deno add jsr:@std/assert` in a `package.json`-only project (`Created deno.json configuration file.`) ✅[^run] | JSR (the JavaScript Registry) packages are recorded in `deno.json` `imports`; `deno add npm:chalk@5` wrote to `package.json` instead ✅[^run] | Expected; keep `deno.json` with the project |
| `NotCapable: Requires read access to "/lab/sample-app"` at a `require("./…")` line ✅[^run] | `require()` of a local file looks it up on disk, which needs read access ✅[^run] | `--allow-read=.` |
| `NotCapable: Requires net access to "[::]:3000"` with `--allow-net=0.0.0.0:3000` ✅[^run] | `listen(port)` with no host binds `[::]` | `--allow-net="[::]:3000"`, or pass a host to `listen` |
| Warning box `Ignored build scripts for packages: npm:<pkg>@<ver>` … `Run "deno approve-scripts" to run build scripts.`, then that package fails at run time ✅[^run] | Deno does not run npm lifecycle scripts by default ✅[^migrate] | `deno approve-scripts npm:<pkg>` (records it in `deno.json`) or `deno install --allow-scripts=npm:<pkg>` ✅[^migrate] ✅[^run] |
| `Lifecycle scripts are only supported when using a \`node_modules\` directory.` ✅[^run] | `npm:` imports with no `package.json` use the global cache ✅[^install] | Set `"nodeModulesDir": "auto"` in `deno.json`, as the warning says ✅[^run] |
| `ERR_REQUIRE_ASYNC_MODULE - require() cannot be used on an ESM graph with top-level await. Use import() instead.` ✅[^run] | `require()` of an ES module that uses top-level `await` | Use `await import()` for that module |
| `Warning /lab/sample-b/package.json: engines.node ">=30" is not satisfied by current node version 26.5.1` ✅[^run] | `deno install` checks `engines` and only warns ✅[^v29] | Nothing breaks; relax `engines` if the warning is noise |
| A tool that runs `node --version` gets `deno 2.9.8 (stable, …)` ✅[^run] | The `node` on `PATH` is Deno's shim ✅[^node-fund] | Install Node.js if the tool needs a real one; the shim never shadows it ✅[^node-fund] |
| `node: command not found`, exit 127 ✅[^run] | `DENO_DISABLE_NODE_SHIM=1` is set and Node.js is not installed ✅[^node-fund] | Unset the variable or install Node.js |
| A `file:./pkg-1.0.0.tgz` dependency fails with `SyntaxError: Invalid or unexpected token` ✅[^run] | Deno 2.9.8 links the tarball file itself into `node_modules` ✅[^run] | Point the dependency at an unpacked folder (`file:./deps/pkg`) or a registry |
| A `postinstall` in a `file:./deps/pkg` folder dependency never runs, with no warning ✅[^run] | Folder dependencies are symlinked, not installed ✅[^run] | Run that package's build step yourself, for example as a task |
| A behaviour differs from Node inside a `node:` module | Partial or missing API (application programming interface) ✅[^migrate] | Check the module's notes on the Node APIs page ✅[^node-apis] |

## Rollback
```console
$ rm -rf node_modules deno.lock deno.json
```
Then remove `"type": "commonjs"` from `package.json` if you want the original file back; Node behaves the same either way ✅[^node-pkg]. Deno's global cache (`DENO_DIR`) keeps its own copy of the packages ✅[^install].

## Takeaways
- Start every migration with `deno install`, then fix errors one at a time from the error text; most name their fix. [rule-candidate]
- Put explicit `"type": "commonjs"` in a CommonJS project's `package.json`; Node already assumes it, and Deno needs it for `require` in `.js` files. [rule-candidate]
- Never run the server through a `node …` script under Deno; define a `deno.json` task with scoped `--allow-*` flags. [rule-candidate]
- Approve a dependency's lifecycle script only after reading what it runs. [rule-candidate]

## Verification status
- Verified: 73 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Goal & prerequisites, Steps, Verify and Troubleshooting. The lifecycle-script rows used a local one-package registry with `--network none`. [^run]
- [Migrate from Node.js](https://docs.deno.com/runtime/migrate/) — Deno project, living. Rank 1. Backs: `deno install` in a Node project, CommonJS rules, `-A` while migrating, `deno task` as `npm run`, common errors. [^migrate]
- [Node and npm Compatibility](https://docs.deno.com/runtime/fundamentals/node/) — Deno project, living. Rank 1. Backs: `require(esm)`, the `node` shim and `DENO_DISABLE_NODE_SHIM`. [^node-fund]
- [Node APIs](https://docs.deno.com/runtime/reference/node_apis/) — Deno project, living. Rank 1. Backs: `node:test` fully supported, per-module notes. [^node-apis]
- [deno install](https://docs.deno.com/runtime/reference/cli/install/) — Deno project, living. Rank 1. Backs: global cache without a `package.json`. [^install]
- [Releases.md at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/Releases.md) — Deno project, 2026. Rank 1. Backs: pre and post scripts run (1.34.0). [^releases]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: lockfile seeding, `engines` warning, bare built-ins. [^v29]
- [Modules: Packages](https://nodejs.org/api/packages.html) — Node.js project, v26 docs. Rank 1. Backs: Node treats `.js` without `"type"` as CommonJS. [^node-pkg]

## Related
- `deno/node-compat/node-and-npm-compatibility.md` — the rules behind each step.
- `deno/deno-lab-setup.md` — the container every command ran in.
- `deno/security/permission-flags.md` — `--allow-env`, `--allow-read`, `--allow-net` value syntax.
- `deno/toolchain/tasks-and-task-shell.md` — `deno task`, `package.json` scripts, the task shell.
- `deno/testing/testing-and-mocking.md` — `deno test` beyond `node:test`.
