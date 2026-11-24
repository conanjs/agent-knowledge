---
schema: knowledge-doc/v1
type: concept
topic: deno/node-compat
status: verified
applies-to: ["Deno 2.9.8", "npm packages and Node.js 26 APIs as emulated by Deno 2.9"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, node, npm, commonjs, esm, package-json, node-modules, globals, lifecycle-scripts, allow-scripts, node-api, export-conditions]
ranked-sources: true
---

# How Deno 2.9 runs Node.js code and npm packages

## Summary
**TL;DR:** Deno 2.9 ships a Node.js compatibility layer: `node:` built-ins (bare names such as `"fs"` also work since 2.9), npm packages through `npm:` specifiers or a `package.json` plus `deno install`, `require` for CommonJS files, and the Node globals `process`, `Buffer`, `global` and `setImmediate`. Two rules surprise Node users. First, a `.js` file is CommonJS only when it is `.cjs` or the nearest `package.json` says `"type": "commonjs"`; a missing `"type"` means ES (ECMAScript) module, not CommonJS as in Node. Second, npm lifecycle scripts never run until you approve them, and all npm code still runs under Deno's permission checks.
**Use this when:** you import an npm package or a `node:` module in Deno, a `require is not defined` or `NotCapable` error appears in Node-style code, a package needs its `postinstall` script, or you need to know which Node APIs (application programming interfaces) Deno lacks.
**Not this doc:** moving a real project step by step → `deno/node-compat/migrating-a-node-project.md`; specifier syntax and import maps → `deno/modules/module-specifiers-and-imports.md`; `deno install`, `deno.lock` and `nodeModulesDir` in depth → `deno/modules/dependency-management.md`; what each permission flag allows → `deno/security/permission-model.md`; `deno task` and `package.json` scripts → `deno/toolchain/tasks-and-task-shell.md`.

## Problem
Code written for Node.js assumes things Deno does not do by default. `require` works in any `.js` file under Node, but Deno treats the same file as an ES module and stops with `ReferenceError: require is not defined` ✅[^run]. An npm package that worked under Node throws `NotCapable: Requires env access` because Deno checks every environment, file and network access ✅[^run] ✅[^node-fund]. A package whose `postinstall` script builds a file fails at run time because Deno skipped the script ✅[^run] ✅[^install]. Without the rules below, each of these looks like a Deno bug.

## Mental model
**Analogy:** Deno is a hotel built for ES-module guests that keeps a fully staffed Node wing. A guest who shows a Node passport (a `node:` import, a `package.json` dependency, a `.cjs` file) gets a room in the Node wing, where `require`, `__dirname` and the npm room layout exist. The security desk (permissions) checks guests in both wings, and the hotel never runs a guest's own setup routine (a lifecycle script) unless you sign for it.

**Artifact:** one `package.json` project, measured in Deno 2.9.8 ✅[^run]:
```text
project/
├── package.json        { "type": "commonjs", "dependencies": { "express": "^5.1.0" } }
├── server.js           const express = require("express");   ← CommonJS because of "type"
├── lib/format.mjs      export function formatGreeting() {}   ← always an ES module
├── deno.lock           written by `deno install`
└── node_modules/
    ├── express -> .deno/express@5.3.0/node_modules/express    ← symlink; only direct dependencies sit here
    └── .deno/          one folder per package@version: 65 for express, ms and their dependencies, plus 1 for the project itself (isolated layout)
```

| Term | Plain-English analogy | Concrete artifact |
|---|---|---|
| CommonJS (CJS): Node's original module format | Passing notes by hand: `require` fetches a module the moment the line runs | `const ms = require("ms");` in a `.cjs` file |
| ES module (ESM): the JavaScript-standard module format | A guest list fixed before the party: imports are known before code runs | `import ms from "npm:ms@2.1.3";` |
| `node:` specifier | A department name inside the hotel | `import { readFile } from "node:fs/promises";` |
| Bare built-in specifier | Asking for "the gym" without saying which floor | `import fs from "fs";` resolves to `node:fs` in 2.9 ✅[^run] |
| `npm:` specifier | Ordering from a catalogue by code, no local stock needed | `npm:[@<scope>/]<package>[@<version>][/<subpath>]` ✅[^node-fund] |
| `node_modules` mode (`none`, `auto`, `manual`) | Whether the hotel keeps a local storeroom or fetches from the central warehouse | `"nodeModulesDir": "auto"` in `deno.json` ✅[^node-fund] |
| Lifecycle script | A package's "assemble on arrival" instruction sheet | `"scripts": { "postinstall": "node build.js" }` in a dependency's `package.json` |
| Node-API (N-API) addon: compiled native code loaded by a package | A contractor who works outside the security desk's view | `npm:sqlite3`, one of the addon packages the docs name ✅[^node-fund] |
| Export condition | A door sign that reads "Deno guests this way, Node guests that way" | `"exports": { ".": { "deno": "./deno.mjs", "node": "./node.mjs" } }` |
| `node` shim | A receptionist who answers to the name "node" but is really Deno | `/deno-dir/node_compat_bin/node -> /bin/deno` ✅[^run] |

## How it works
**5 actors:**
- **`deno install`** — its job: fill `node_modules` and `deno.lock` from `package.json`, via the npm registry, and run approved lifecycle scripts, via `--allow-scripts` or `allowScripts` in `deno.json`.
- **Resolver** — its job: turn each import or `require` string into a file, via `deno.json` `imports`, `package.json` dependencies, `node_modules` and the built-in module list.
- **Module loader** — its job: decide CommonJS or ESM for each file, via the file extension and the nearest `package.json` `"type"`.
- **Node compatibility layer** — its job: provide `node:*` modules, Node globals and `require`, via Deno's built-in Node code (stack frames such as `ext:deno_node/net.ts` and `node:module`) ✅[^run].
- **Permission checker** — its job: allow or refuse each file, network and environment access, via the `--allow-*` flags.

```
[deno install]                [deno run: resolver → loader → Node layer]          [permission checker]
reads package.json
  │ ═══ network: npm registry ═══
  ├─ downloads tarballs to DENO_DIR/npm
  ├─ links node_modules/<pkg> → .deno/<pkg@ver>
  ├─ writes deno.lock
  └─ runs lifecycle scripts only if approved
                              import "fs" / require("express")
                                │ resolver: deno.json imports → package.json deps
                                │           → node: built-ins → node_modules
                                ▼
                              loader: .cjs | "type":"commonjs" → CJS, else ESM
                                ▼
                              Node layer runs the code; it calls
                              process.env, fs.stat, server.listen ───────▶ flag granted? run : NotCapable
```

1. **`deno install` (local, then network):**
   - Reads `package.json` (and `deno.json` if present) ✅[^install].
   - Downloads each package, via the npm registry (the only step here that leaves the machine), into the global cache; with a `package.json` it also creates `node_modules` ✅[^install] ✅[^run].
   - Seeds `deno.lock` from an existing npm, pnpm, Yarn or Bun lockfile when no `deno.lock` exists ✅[^v29]; measured with a `package-lock.json` pinning `ms@2.1.2`: `Seeded deno.lock from /lab/lockseed/package-lock.json`, and `ms` stayed at 2.1.2 although 2.1.3 exists ✅[^run].
   - Skips every lifecycle script unless the package is approved (§ Lifecycle scripts) ✅[^install] ✅[^run].
2. **Resolver (local):**
   - `deno.json` `imports` and `package.json` dependencies win over a built-in of the same name; a measured `"imports": { "fs": "./myfs.js" }` made `import fs from "fs"` load `myfs.js` ✅[^run] ✅[^v29].
   - Otherwise a bare built-in name resolves to the built-in with no flag since 2.9, and a package in `node_modules` no longer shadows it ✅[^v29] ✅[^node-fund]. `import fs from "fs"` and `"fs/promises"` ran, passed `deno check` and `deno lint`, and printed no warning ✅[^run]. The docs still recommend writing `node:` because it is unambiguous ✅[^node-fund].
   - An `import` of a package listed in `package.json` but missing from `node_modules` fails: `error: Could not resolve "peek", but found it in a package.json. Deno expects the node_modules/ directory to be up to date. Did you forget to run \`deno install\`?` ✅[^run].
   - `npm:` specifiers need no install step: packages land in the global cache (`DENO_DIR`) and no `node_modules` folder appears ✅[^node-fund] ✅[^run]. `require("npm:ms@2.1.3")` does not work: `Cannot find module 'npm:ms@2.1.3'` ✅[^run].
3. **Module loader (local):** picks the format per file (table below). There is no content sniffing unless you opt in, to keep loading fast ✅[^node-fund].
4. **Node compatibility layer (local):** runs CommonJS through its own `node:module` loader, supplies the globals (table below), and implements `node:*` modules. `require()` of an ES module works when the module graph has no top-level `await`, as in Node ✅[^node-fund]; with one, it throws `ERR_REQUIRE_ASYNC_MODULE` ✅[^run]. `createRequire(import.meta.url)` from `node:module` gives an ES module its own `require` ✅[^node-fund] ✅[^run].
5. **Permission checker (local):** npm code gets no exemption at run time ✅[^node-fund] ✅[^security]. Measured: `chalk` needed `--allow-env` (it reads `TF_BUILD`), `debug` (inside `express`) needed the whole environment because it calls `Object.keys(process.env)`, and a `require("./lib/format.mjs")` of a local file needed read access to the project folder, while `require("express")` from `node_modules` did not ✅[^run].

### Which local file is CommonJS
Measured with a `main.js` that calls `require("os")` ✅[^run]; rules from the docs ✅[^node-fund] ✅[^unstable]:

| Layout | Deno 2.9.8 | Node.js, for comparison |
|---|---|---|
| `.cjs` extension, any folder | CommonJS | CommonJS |
| `.mjs` extension | ES module ✅[^migrate] | ES module |
| `.js` (or `.ts`, `.jsx`, `.tsx`), nearest `package.json` has `"type": "commonjs"` | CommonJS | CommonJS |
| `.js`, nearest `package.json` has no `"type"` | ES module: `ReferenceError: require is not defined` | CommonJS (ES module only if it contains ES syntax) ✅[^node-pkg] |
| `.js`, no `package.json` at all | ES module: same error | CommonJS ✅[^node-pkg] |
| `.js`, `"type": "module"` | ES module: same error | ES module |
| `--unstable-detect-cjs` with no `"type"` or no `package.json` | CommonJS (flag since 2.1.2) | — |
| `--unstable-detect-cjs` with `"type": "module"` | still ES module | — |
| A registry package in `node_modules` with no top-level `"type"` (`express` 5.3.0, `debug`, `ms`) | CommonJS: `require` inside it works | CommonJS |

The error itself names the four fixes: rewrite to ESM, rename to `.cjs`, add `"type": "commonjs"`, or pass `--unstable-detect-cjs`, and links to `https://docs.deno.com/go/commonjs` ✅[^run].

### Node globals
`typeof` measured in a `.mjs` and a `.cjs` file with no `package.json` ✅[^run]:

| Name | ES module | CommonJS | Source of the rule |
|---|---|---|---|
| `process` | `object` | `object` | Global for all code ✅[^node-fund] |
| `Buffer`, `global`, `setImmediate`, `clearImmediate` | `function`, `object`, `function`, `function` | same | Global for user code since 2.4 ✅[^v24] |
| `__dirname`, `__filename` | `undefined` | `string` | CommonJS only; use `import.meta.dirname` and `import.meta.filename` ✅[^node-apis] |
| `require`, `module`, `exports` | `undefined` | `function`, `object`, `object` | CommonJS only ✅[^node-fund] |
| `window` | `undefined` | `undefined` | measured only |

- `setTimeout` returns a Node `Timeout` object that still converts to a number (`typeof t` is `object`, `typeof Number(t)` is `number`) ✅[^run] ✅[^v28].
- `process.version` printed `v26.5.1` and `process.versions.napi` printed `10` ✅[^run]; Deno 2.9 targets Node.js 26 ✅[^v29].
- Types: since 2.8, `deno check` includes Node's type library by default ✅[^node-fund] ✅[^v28]; a file using `Buffer`, `NodeJS.Timeout` and `process.env` passed `deno check` with no setup ✅[^run]. To pin `@types/node`, map it in `deno.json` `imports`, for example `"@types/node": "npm:@types/node@^22"` ✅[^node-fund].

### Export conditions
A package's `exports` map points each condition name at a file. Measured with a local package whose root export lists `development`, `deno`, `node`, `default` in that order ✅[^run]; the condition lists are from the docs ✅[^node-fund]:

| Caller | Conditions Deno sets | Measured file |
|---|---|---|
| `import "cond"` | `deno`, `node`, `import`, `module-sync`, `default` | `deno.mjs` |
| `require("cond")` or `createRequire(...)("cond")` | `require`, `node`, `module-sync`, `default` | `node.mjs` |
| either, with `--conditions development` | the custom condition is added | `dev.mjs` |
| `import`, with `DENO_CONDITIONS=development` | same as `--conditions` ✅[^envvars] | `dev.mjs` |

### Lifecycle scripts and native addons
- Deno does not run `preinstall` or `postinstall` scripts unless you allow them, because they are a security risk ✅[^install] ✅[^approve].
- Three ways to allow one package: `deno install --allow-scripts=npm:<pkg>` ✅[^install], the same flag on `deno run` ✅[^run], or `deno approve-scripts`, which is an interactive review without arguments ✅[^approve] (with no terminal it stopped with `error: No such device or address (os error 6)`) ✅[^run] and also accepts package names: `deno approve-scripts npm:hello-build` wrote `"allowScripts": ["npm:hello-build"]` to `deno.json` and ran the script at once ✅[^run].
- `allowScripts` takes `true`, a list of package constraints, or `{ "allow": …, "deny": … }` ✅[^schema].
- Scripts run only with a local `node_modules` ✅[^install]; with the global cache Deno warns `Lifecycle scripts are only supported when using a \`node_modules\` directory.` ✅[^run].
- Node-API addons work when a local `node_modules` exists and `--allow-ffi` is granted ✅[^node-fund]. Native code runs outside Deno's checks, so treat `--allow-ffi` as `--allow-all` ✅[^security]. Not run in the lab: none of the packages used here ships an addon. The permission side is in `deno/security/permission-model.md`.

### The `node` shim
- Since 2.9, when no real `node` is on `PATH`, child processes get a `node` that is Deno itself; a real Node.js install is never shadowed, and `DENO_DISABLE_NODE_SHIM=1` turns it off ✅[^node-fund] ✅[^v29].
- Measured under `deno task`: `PATH` began `node_modules/.bin` folders, then `/deno-dir/node_compat_bin`, where `node` is a symlink to `/bin/deno` ✅[^run].
- `node server.js` through the shim ran with every permission granted (`read=granted … ffi=granted`), while `deno run perm.js` in the same task got `prompt` for each ✅[^run].
- `node --version` printed `deno 2.9.8 (stable, release, aarch64-unknown-linux-gnu)`, not a Node version ✅[^run]. With the shim disabled: `node: command not found`, exit 127 ✅[^run].

### Compatibility status the docs publish
- Deno passes over 75% of Node's own test suite as of 2.8 ✅[^node-fund]; the 2.8 post gives 76.4% (3,405 of 4,457), up from about 42% in 2.7 ✅[^v28].
- The Node APIs page sorts 44 modules into "Fully supported modules (22/44)", "Partially supported modules (16/44)" and "Unsupported modules (6/44)" ✅[^node-apis].
- Partial examples: `http` lacks the `createConnection` option, `http2` and `dgram` have stub methods, `worker_threads` has no `parentPort.emit`, `vm.measureMemory` is a stub ✅[^node-apis].
- Listed as unsupported: `cluster`, `domain`, `repl`, `sea`, `trace_events`, `wasi` ✅[^node-apis] (but see Edge cases).
- Deno type-checks npm packages with `node16` module resolution only, so some packages' types fail in `deno check` though `tsc` accepts them ✅[^node-fund].

## Worked example
A dependency whose `postinstall` writes `built.json`, which its `index.js` then reads. The lab served it from a one-package registry on `localhost:4873` (`NPM_CONFIG_REGISTRY=http://localhost:4873/`, container network off) ✅[^run]:
```text
hello-build@1.0.0/package.json   "scripts": { "postinstall": "node build.js" }
hello-build@1.0.0/build.js       writes built.json next to itself
hello-build@1.0.0/index.js       throws if built.json is missing, else exports its content
app/package.json                 { "type": "commonjs", "dependencies": { "hello-build": "^1.0.0" } }
app/main.js                      console.log(require("hello-build"));
```

| Step | Command | Real output |
|---|---|---|
| 1 | `deno install` | `Installed 1 package in 19ms` … then a box: `Ignored build scripts for packages: npm:hello-build@1.0.0` / `Run "deno approve-scripts" to run build scripts.`; exit 0 |
| 2 | `deno run -R main.js` | `Error: hello-build: built.json missing - was the postinstall script run?`, exit 1 |
| 3 | `deno install` again | the same warning box: Deno repeats it until you decide |
| 4 | `deno install --allow-scripts=npm:hello-build` | `Initialize hello-build@1.0.0: running 'postinstall' script`; `built.json` appears under `node_modules/.deno/hello-build@1.0.0/node_modules/hello-build/` |
| 5 | `deno run -R main.js` | `{ builtAt: "postinstall" }`, exit 0 |

Step 4 writes nothing to `deno.json`, so the approval is not recorded; `deno approve-scripts npm:hello-build` records it as `allowScripts` ✅[^run].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Docs say `Buffer` is "Not global in your own code" | Deno 2.9.8 has `Buffer`, `global`, `setImmediate`, `clearImmediate` as globals in user ES modules ✅[^run] | The 2.4 post made them global ✅[^v24], and the 2.4.0 release notes deprecated `--unstable-node-globals` ✅[^releases]; the Node page ✅[^node-fund], the Node APIs page ("only available in the npm package scope") ✅[^node-apis] and the unstable-flags page ✅[^unstable] were not updated |
| `cluster` and `repl` listed as unsupported stubs ✅[^node-apis] | `cluster.fork()` started a worker that sent a message back, and `repl.start()` evaluated `1+2` to `3` on Linux ✅[^run] | The 2.8.0 release notes list "implement node:cluster on unix" and `node:repl` improvements ✅[^releases]; the status page lags |
| `DENO_COMPAT=1` | Still works: `server.js` with `require` and no `"type"` ran ✅[^run] | It turns on `--unstable-detect-cjs`, `--unstable-node-globals`, `--unstable-bare-node-builtins` and `--unstable-sloppy-imports` ✅[^v24]; the environment variables page does not list it ✅[^envvars] |
| `--allow-env=PORT` for an Express app | `NotCapable: Requires env access, run again with the --allow-env flag` from `debug/src/node.js` ✅[^run] | The package enumerates all variables, so a scoped grant is not enough |
| `file:./deps/pkg` folder dependency with a `postinstall` | Symlinked into `node_modules`; the script never runs and no warning prints, even with `--allow-scripts` ✅[^run] | measured only |
| `file:./pkg-1.0.0.tgz` tarball dependency | `node_modules/pkg` becomes a symlink to the `.tgz`, and `require` fails with `SyntaxError: Invalid or unexpected token` ✅[^run] | measured only; use a folder or a registry |
| A `file:` folder dependency with no `"type"` | Its `module.exports` file loads as ESM: `does not provide an export named 'default'` ✅[^run] | Unlike registry packages, it gets the local-file rule; adding `"type": "commonjs"` to its `package.json` fixed it ✅[^run] |
| Tool parses `node --version` | Gets Deno's version text under the shim ✅[^run] | The shim is the `deno` binary |
| `NO_COLOR=1` and the CommonJS hint | The `info:`/`hint:` lines still carry underline and italic escape codes ✅[^run] | measured only; strip them when quoting |
| `process.version` | `v26.5.1` in 2.9.8 ✅[^run], while the 2.9 post says `v26.3.0` ✅[^v29] | 2.9.0 set it to `v26.3.0` ✅[^releases]; a later 2.9.x release raised it, and no changelog line up to 2.9.8 names the new value ✅[^releases] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `"type": "commonjs"` in `package.json` | One line; Node behaves the same, since a missing `"type"` already means CommonJS there ✅[^node-pkg] | Every `.js` in that package becomes CommonJS; ESM files must be `.mjs` |
| Rename files to `.cjs` | Unambiguous in both runtimes ✅[^node-fund] | Touches every `require` path that names the file |
| `--unstable-detect-cjs` or `DENO_COMPAT=1` | No file changes | Unstable flag; content detection slows loading ✅[^node-fund] |
| `npm:` specifiers, no `package.json` | No install step, no `node_modules` ✅[^run] | CommonJS `require` cannot use them; lifecycle scripts cannot run ✅[^run] |
| `package.json` + `deno install` (`manual` mode) | Bare imports resolve, and `deno task` finds tools in `node_modules/.bin` ✅[^node-fund] | Re-run `deno install` after each dependency change, or imports fail with "Did you forget to run `deno install`?" ✅[^run] |
| `node` scripts through the shim | Unchanged `package.json` scripts run ✅[^run] | All permissions granted; the sandbox is off for that process ✅[^run] |

## Takeaways
- Write `node:` in new imports even though bare `"fs"` works in 2.9. [rule-candidate]
- Give every `package.json` an explicit `"type"`; Deno and Node disagree on what a missing one means. [rule-candidate]
- Approve lifecycle scripts per package (`deno approve-scripts npm:<pkg>`), never with `allowScripts: true`. [rule-candidate]
- Run servers with `deno run` and explicit flags, not through a `node …` script, or the shim grants everything. [rule-candidate]
- Check the Node APIs page for a module's status, then test: the page lags the release notes.

## Verification status
- Verified: 118 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Problem, Mental model, How it works, Worked example, Edge cases and Trade-offs. Lifecycle-script runs used a local one-package registry with `--network none`. [^run]
- [Node and npm Compatibility](https://docs.deno.com/runtime/fundamentals/node/) — Deno project, living. Rank 1. Backs: bare built-ins, `npm:` format, CommonJS rules, globals, `createRequire`, `require(esm)`, conditions, types, native addons, the `node` shim, test-suite share. [^node-fund]
- [Node APIs](https://docs.deno.com/runtime/reference/node_apis/) — Deno project, living. Rank 1. Backs: module status counts and notes, `__dirname` in ES modules, "npm package scope" globals. [^node-apis]
- [Migrate from Node.js](https://docs.deno.com/runtime/migrate/) — Deno project, living. Rank 1. Backs: `.mjs` is always an ES module. [^migrate]
- [deno install](https://docs.deno.com/runtime/reference/cli/install/) — Deno project, living. Rank 1. Backs: what `deno install` reads and writes, `--allow-scripts`, scripts need `node_modules`. [^install]
- [deno approve-scripts](https://docs.deno.com/runtime/reference/cli/approve_scripts/) — Deno project, living. Rank 1. Backs: scripts off by default, interactive review. [^approve]
- [Environment variables](https://docs.deno.com/runtime/reference/env_variables/) — Deno project, living. Rank 1. Backs: `DENO_CONDITIONS`; absence of `DENO_COMPAT`. [^envvars]
- [Unstable feature flags](https://docs.deno.com/runtime/reference/cli/unstable_flags/) — Deno project, living. Rank 1. Backs: `--unstable-detect-cjs` scenarios, `--unstable-node-globals`. [^unstable]
- [Security and permissions](https://docs.deno.com/runtime/fundamentals/security/) — Deno project, living. Rank 1. Backs: npm code checked at run time, `--allow-ffi` equals `--allow-all` for trust. [^security]
- [cli/schemas/config-file.v1.json at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/cli/schemas/config-file.v1.json) — Deno project, 2026. Rank 1. Backs: `allowScripts` value shapes. [^schema]
- [Releases.md at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/Releases.md) — Deno project, 2026. Rank 1. Backs: 2.4.0 globals and `--unstable-node-globals` deprecation, 2.8.0 `node:cluster` and `node:repl` work, 2.9.0 `process.version` set to v26.3.0. [^releases]
- [Deno 2.4: deno bundle is back](https://deno.com/blog/v2.4) — Deno project, 2025. Rank 1. Backs: `Buffer`, `global`, `setImmediate`, `clearImmediate` global; `DENO_COMPAT`. [^v24]
- [Deno 2.8](https://deno.com/blog/v2.8) — Deno project, 2026. Rank 1. Backs: 76.4% test pass rate, `Timeout` objects, Node types by default. [^v28]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: Node 26 target, bare built-ins, precedence, lockfile seeding, the `node` shim. [^v29]
- [Modules: Packages](https://nodejs.org/api/packages.html) — Node.js project, v26 docs. Rank 1. Backs: Node treats `.js` without `"type"` as CommonJS. [^node-pkg]

## Related
- `deno/node-compat/migrating-a-node-project.md` — the same rules applied to an Express project.
- `deno/modules/dependency-management.md` — `deno install`, `deno.lock`, `nodeModulesDir` modes.
- `deno/modules/module-specifiers-and-imports.md` — `npm:`, `node:` and import maps.
- `deno/security/permission-model.md` — what `--allow-env`, `--allow-read`, `--allow-ffi` grant.
- `deno/configuration/deno-json-reference.md` — `allowScripts`, `nodeModulesDir`, `nodeModulesLinker`.
