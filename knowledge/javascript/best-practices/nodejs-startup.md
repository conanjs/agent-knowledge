---
schema: knowledge-doc/v1
type: reference
topic: javascript/best-practices
status: verified
applies-to: ["Node.js 24 (docs v24.22.3)", "lab on Node.js 24.22.1 (V8 13.6.233.17, linux arm64), 2026-11-26; timings are medians of 9 fresh processes after one warm-up", "checked on macOS arm64 with Node.js 22.23.4, 24.22.1, 25.7.0 and Electron 43.7.7, 2026-11-27", "type stripping and subpath imports measured on Node.js 24.22.1 (macOS arm64, 2026-11-14 and 2026-11-16; linux arm64, 2026-11-28)"]
last-verified: 2026-11-28
last-updated: 2026-11-28
tags: [javascript, best-practices, nodejs, startup, lazy-compilation, code-cache, startup-snapshot, typescript]
derived-from: [js-runtime/v8-memory-and-startup-deep-dive.md]
ranked-sources: true
---

# JavaScript best practices: Node.js startup, compiling, caching and loading code

## Summary
**TL;DR:** A Node.js program starts faster when it compiles only what runs, reuses compiled code, rebuilds no data it could have saved, and loads optional modules only when used; and TypeScript or aliases that Node.js runs directly must use forms Node.js understands. The headline results on Node.js 24.22.1: wrapping every function in parentheses doubled load time when 1 % of 3,000 functions ran (15.4 ms against 32.3 ms) ✅[^lab-v8]; a `vm.Script` cache made after running cut a 53.0 ms start to 3.1 ms, one made before running only to 39.9 ms ✅[^lab-v8]; and a same-length edit reused a stale cache and ran the old code ✅[^lab-v8].
**Use this when:** making a command-line tool, short job, serverless handler or worker start faster; caching compiled code; building a startup snapshot; adding a heavy import; or running TypeScript and path aliases with plain `node`.
**Not this doc:** start-time work in Dockerfiles and entrypoints (installs, migrations) → `start-time-build-work` in [problem-classes-containers-and-runtime-config.md](../../performance/code-review/problem-classes-containers-and-runtime-config.md); bundled browser code → `JB-L7` in [browser-loading-and-delivery.md](browser-loading-and-delivery.md) and `JB-F8` in [browser-component-frameworks.md](browser-component-frameworks.md); whether `enum` is slow → `JL-L11` in [language-patterns.md](language-patterns.md); how the parser, code cache and snapshots work → [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md).

## Scope
Ten practices for lazy and eager compilation, compile hints, `vm.Script` code caches, startup snapshots, the module compile cache, lazy imports, import specifiers, type stripping and subpath imports. Timings are medians of 9 fresh processes after one warm-up on Node.js 24.22.1 (V8 13.6.233.17, linux arm64) on 2026-11-26, checked on macOS arm64 with Node.js 22.23.4, 24.22.1, 25.7.0 and Electron 43.7.7 on 2026-11-27; emulated x64 timings were not used. Type stripping and aliases were measured on Node.js 24.22.1. All claims are about Node.js on V8; the compile hint was not checked in Chrome. Not run: Windows, and the code cache for `vm.compileFunction()` and `vm.SourceTextModule`.

How to read the "Applies" column: `always` (the better form is as clear as the other: use it by default), `hot path` (only in code that runs per request, per frame or per element of a large collection, or that a profile points at), `large data` (only above the size the note gives), `startup` (only when start time matters), `check build` (the answer depends on the engine version or build), `no gain` (the lab measured no useful difference, or the advice is outdated: there is no reason to rewrite code for it).

Terms:
- **Lazy compilation:** V8 only checks a function's syntax at load (it **preparses** it) and turns it into **bytecode**, the instructions its interpreter runs, on the first call, like cooking a dish only when it is ordered.
- **Code cache:** saved bytecode for one script, like a pre-cooked meal for one recipe.
- **Startup snapshot:** a saved heap after setup code ran, like a photo of a set table rebuilt instantly.
- **Type stripping:** Node.js deleting TypeScript type text in place and running what is left, like erasing pencilled notes from a printed page.
- **Subpath import:** an alias declared in `package.json` `"imports"`, whose key starts with `#`, like an internal phone extension.

## Catalog
| Id | Situation in the code | Practice | Applies | Evidence |
|---|---|---|---|---|
| `JN-U1` | Functions wrapped in parentheses `(function () {})` "to compile eagerly", or `--no-lazy` | Use plain declarations unless most functions run at start | startup | 3,000 functions, 1 % called: 15.4 ms as declarations, 32.3 ms parenthesized (Node.js 24.22.1) ✅[^lab-v8] |
| `JN-U2` | `//# allFunctionsCalledOnLoad` as the first line of a file Node.js loads | Leave it out for Node.js | no gain | Parse and compile events were the same with and without it on every build tested (V8 12.4 to 15.0) ✅[^lab-v8-matrix] |
| `JN-U3` | `createCachedData()` called before the script ran, or `produceCachedData` | Run the script first, then `script.createCachedData()`; save it when absent or rejected | startup | 53.0 ms with no cache, 39.9 ms with a cache made before running, 3.1 ms after (Node.js 24.22.1) ✅[^lab-v8] |
| `JN-U4` | A `vm.Script` cache stored by file name, path or source length | Key it by SHA-256 of the source plus `process.version` and flags | always | A same-length edit was accepted (`cachedDataRejected=false`) and ran the old code, on all seven builds ✅[^lab-v8-matrix] |
| `JN-U5` | A tool whose top level spends its start building tables or state | Build a startup snapshot (`--build-snapshot`, `setDeserializeMainFunction`); start with `--snapshot-blob` | startup | 187.4 ms from source, 20.1 ms from the snapshot, 13.0 ms for `node -e 0` (Node.js 24.22.1) ✅[^lab-v8] |
| `JN-U6` | A Node.js entry started often, with no `module.enableCompileCache()` or `NODE_COMPILE_CACHE` | Call `module.enableCompileCache()` first in the entry file, or set `NODE_COMPILE_CACHE` | startup | 51.9 ms without, 42.8 ms with a filled cache for one 3,000-function module (Node.js 24.22.1) ✅[^lab-v8] |
| `JN-U7` | A static top-level import of a heavy module only one optional path uses | Load it with `await import()` inside that path | startup | A static pdfmake 0.3.13 import added 84 ms, 7.2 MiB of heap and 17 MiB of RSS to the main thread ✅[^lab-pools] |
| `JN-U8` | `import(\`./m.mjs?${Date.now()}\`)` or a per-call query on a dynamic import | Use a fixed specifier | always | Modules are loaded again when the specifier's query or fragment differs ✅[^node-esm] |
| `JN-U9` | `node file.ts` running code with `enum`, parameter properties, `<T>x`, type imports without `type`, no `.ts` extension | Erasable syntax only: `as const` objects, `import type`, `.ts` extensions, `x as T` | check build | Each failed on Node.js 24.22.1, mostly with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` ✅[^lab-strip]; stable since v24.12.0 ✅[^node-ts] |
| `JN-U10` | Aliases like `@/core/x` backed only by tsconfig `paths`, run by Node.js without a rewrite step | Use `package.json` `"imports"` with `#` keys (`#core/*`), or a build step that rewrites aliases | always | `paths` does not change emitted imports ✅[^ts-paths]; a `paths` alias failed with `ERR_MODULE_NOT_FOUND` under type stripping ✅[^lab-strip] |

## Lookup notes
### `JN-U1` Eager compilation pays off only when most of the file runs at startup
**Prefer:**
```js
function parseRow(x) { /* ... */ }   // plain declaration: compiled on first call
```
**Avoid:**
```js
const parseRow = (function (x) { /* ... */ }); // compiled at load even if never called
```
**Why:** V8 assumes a parenthesized function expression is called at once and compiles it eagerly ✅[^preparse]. That saves the second scan when the function does run at start, and wastes compile time and memory when it does not ✅[^preparse]. This matters only when start time matters and most functions of the file are not called during start.
**Evidence:** Node.js 24.22.1 (V8 13.6.233.17, arm64), a generated file of 3,000 functions of 20 statements: with 1 % called, 15.4 ms as declarations, 32.3 ms parenthesized, 19.2 ms with `--no-lazy`; with all called, 45.2 ms, 31.8 ms and 31.4 ms ✅[^lab-v8]. In three runs each, the doubling held at 1,000 functions with 10 % called (6.8 to 7.1 ms against 10.4 to 10.6 ms) and at 10,000 functions with 1 % called (51.2 to 54.2 against 107.2 to 118.2 ms); `--max-lazy` undid the effect both ways ✅[^lab-v8]. The order held on macOS with Node.js 22.23.4, 24.22.1, 25.7.0 and Electron 43.7.7 ✅[^lab-v8-matrix].
**Exceptions:** When all 3,000 functions ran at start-up, the parenthesized file loaded 11 to 30 % faster over four runs ✅[^lab-v8]. Smaller or larger function bodies were not tried: measure both forms.
**Check it:** `node --log-function-events --logfile=fe.log --no-logfile-per-isolate app.js` lists per function `preparse-resolution` (lazy) or `full-parse -> interpreter` at load; time fresh processes.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.9 "Startup: the scanner, the preparser and lazy compilation" and §4.6 "Lazy against eager compilation, timed".

### `JN-U2` `//# allFunctionsCalledOnLoad` does nothing for code that Node.js runs
**Keep writing:** the file without the comment.
**Why:** The V8 blog (29 April 2025) describes this explicit compile hint for whole files in Chrome 136; it does not mention Node.js or other embedders ✅[^hints].
**Evidence:** Node.js 24.22.1 (V8 13.6.233.17): the parse and compile events were the same with and without the comment, as the main CommonJS file, through `require`, as an ES module and through `vm.Script` ✅[^lab-v8]. No effect on any build of the matrix (V8 12.4 to 15.0). V8 12.4 (Node.js 22.23.4) lists `--compile-hints-magic`, off by default; with it on, the comment still changed nothing for a CommonJS main file ✅[^lab-v8-matrix]. Not checked in Chrome: the lab script needs Node.js APIs (`node:child_process` and files).
**Exceptions:** Code shipped to Chrome 136 or later, which the blog describes ✅[^hints]; not measured here.
**Check it:** Compare `--log-function-events` output with and without the comment.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.9 and §6.4.

### `JN-U3` Create a `vm.Script` code cache after the code has run
**Prefer:**
```js
const script = new vm.Script(src, { filename: 'app.js', cachedData });
script.runInThisContext();
if (!cachedData || script.cachedDataRejected) save(script.createCachedData()); // after running
```
**Avoid:**
```js
save(new vm.Script(src).createCachedData()); // made before running: functions still lazy are missing
```
**Why:** A cache holds what V8 has compiled when it is made; functions that were still lazy are not in it ✅[^nodevm], so a cache made before running skips little. The V8 team's guidance is to make the cache after execution ✅[^ccdev]; `produceCachedData` is deprecated in favour of `createCachedData()` ✅[^nodevm]. This matters for tools that compile the same large script in many processes.
**Evidence:** Node.js 24.22.1, a 3,000-function script with every function called: 53.0 ms with no cache, 39.9 ms with a cache made before running (396,608 bytes), 3.1 ms with one made after running (2,516,608 bytes); with 1,000 functions, 15.6 to 16.8, 11.6 to 14.1 and 1.1 to 1.2 ms ✅[^lab-v8]. The fastest path was the same on every build where timing ran; cache sizes differ by V8 version ✅[^lab-v8-matrix].
**Exceptions:** Measured only for scripts whose every function is called.
**Check it:** `script.cachedDataRejected` must be `false` on the run that uses the cache; time fresh processes.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.10 and §4.7 "`vm.Script` cached data, timed".

### `JN-U4` Key a stored code cache by a hash of the source, the Node.js version and the flags
**Prefer:**
```js
const key = crypto.createHash('sha256')
  .update(src).update(process.version).update(process.execArgv.join(' '))
  .digest('hex');
const cachedData = readCache(key); // a missing entry means: compile without a cache
```
**Avoid:**
```js
const cachedData = readCache(`${filename}.cache`); // an edited file of the same length reuses it
```
**Why:** V8 checks a cache against its version and flags, and against a source hash that is the source's length plus two bits, not the source text ✅[^codeser]. A cache for a same-length edit is accepted and runs the old code.
**Evidence:** Node.js 24.22.1 (V8 13.6.233.17): a cache made for `globalThis.r = 111;` was accepted for `globalThis.r = 222;` (`cachedDataRejected=false`) and set `r=111`; one character added: rejected; `--no-lazy`: rejected ✅[^lab-v8]. The accept and reject results were the same on all seven builds (V8 12.4 to 15.0, macOS and linux, arm64 and x64, pointer compression off and on) ✅[^lab-v8-matrix].
**Exceptions:** Not tested for `vm.compileFunction()` and `vm.SourceTextModule`. A later V8 may compare more; the hash key stays correct either way.
**Check it:** Change one character of the source without changing its length and confirm the cache is not used.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.10 "The code cache and `v8.Script` cached data".

### `JN-U5` Build a startup snapshot when start-up spends its time building data
**Prefer:**
```js
// snap-entry.js: built once with  node --snapshot-blob snap.blob --build-snapshot snap-entry.js
const v8 = require('node:v8');
const table = buildTable();                                   // runs at build time only
v8.startupSnapshot.setDeserializeMainFunction(() => main(table));
// start with:  node --snapshot-blob snap.blob
```
**Avoid:**
```js
main(buildTable()); // recomputed on every start
```
**Why:** At start V8 deserializes the saved heap instead of running the setup code again ✅[^snap15]; Node.js exposes this through `--build-snapshot` and `--snapshot-blob` ✅[^node-cli] and `setDeserializeMainFunction` ✅[^nodev8]. This matters for setup code that computes tables or state for tens of milliseconds or more.
**Evidence:** Node.js 24.22.1, a program that builds a table of 300,000 primes: 187.4 ms from source, 20.1 ms from an 8.5 MiB snapshot, 13.0 ms for `node -e 0` ✅[^lab-v8]. On macOS (Node.js 22.23.4, 24.22.1, 25.7.0, three runs each, with other jobs running): 195 to 263 ms, 29 to 80 ms and 23 to 43 ms, a smaller ratio. Electron 43.7.7 run as Node could not build the snapshot (`ERR_NOT_BUILDING_SNAPSHOT`) ✅[^lab-v8-matrix].
**Exceptions:** The building script is one entry point that can load built-in modules but not other user-land modules; loading needs the same Node.js version, architecture and platform, or the process exits with status 1 ✅[^node-cli]; values such as `Math.random()` are frozen at build time ✅[^snap15]. The build process is no longer experimental since Node.js 24.13.1 ✅[^node-cli].
**Check it:** Wall time of fresh processes with and without `--snapshot-blob`; both must print the same result.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.11 and §4.8 "A startup snapshot, timed".

### `JN-U6` Turn on the module compile cache for programs that start often
**Prefer:**
```js
// first lines of the entry file, before the heavy imports
import module from 'node:module';
module.enableCompileCache(); // or NODE_COMPILE_CACHE=<dir> in the environment
```
**Avoid:**
```js
// no compile cache: every start compiles every module again
```
**Why:** Node.js keeps an on-disk V8 code cache per module; it is made when the module is compiled and written when the process exits or on `module.flushCompileCache()` ✅[^nodemodule]. This matters for command-line tools, short jobs and serverless handlers.
**Evidence:** Node.js 24.22.1, importing a 3,000-function ES module: 51.9 ms without the cache, 53.2 ms on the run that fills it, 42.8 ms with a filled cache; over four runs the filled cache was about 10 to 20 % faster than none, for this one module ✅[^lab-v8]. On macOS (Node.js 22.23.4, 24.22.1, 25.7.0 and Electron 43, three runs each) the gain was mostly 30 to 40 % (14 to 53 % over all twelve runs) ✅[^lab-v8-matrix]. The gain is far smaller than that of a `vm.Script` cache made after running (`JN-U3`). Stable since Node.js 24.15.0 ✅[^nodemodule].
**Exceptions:** The first run is slightly slower ✅[^lab-v8]; caches are invalidated when a module's absolute path changes (unless `portable`) and are typically reusable only by the same Node.js version; `NODE_DISABLE_COMPILE_CACHE=1` turns it off ✅[^nodemodule].
**Check it:** `module.enableCompileCache()` returns an object whose `status` is `module.constants.compileCacheStatus.ENABLED` when it works; compare import time on the second start.
**Full lab:** [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.12 and §4.9 "The module compile cache, timed".

### `JN-U7` Load heavy optional modules on the path that uses them
**Prefer:**
```js
async function renderInline(task) {
  const { render } = await import('./render.task.js'); // loaded on first use, cached after
  return render(task);
}
```
**Avoid:**
```js
import { render } from './render.task.js'; // loaded at start even when workers do all renders
```
**Why:** A static import loads the module and runs its top-level code at start. After the first load, modules are cached and later calls do not run the module again ✅[^node-modules]; so the lazy path pays the load once, at its first call (synchronously, for `require`). This matters for a large module needed only by one mode or route.
**Evidence:** Node.js 24.22.1, 2026-11-05: a statically imported pdfmake 0.3.13 task module added 84 ms, 7.2 MiB of heap and 17 MiB of RSS (resident set size, memory held in RAM) to a service's main thread. Compiled by TypeScript with `"module": "commonjs"`, `await import(...)` became a `require` cache hit costing 0.5 µs per call after the first ✅[^lab-pools].
**Exceptions:** A module every request uses: load it at start so the first request does not pay for it. For browser code built with a bundler, see `JB-L7` in [browser-loading-and-delivery.md](browser-loading-and-delivery.md) and `JB-F8` in [browser-component-frameworks.md](browser-component-frameworks.md).
**Check it:** `node --cpu-prof` at start, or `process.memoryUsage()` right after start with and without the import.
**Full lab:** [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), Edge cases, "Statically importing the worker task module".

### `JN-U8` Never vary an import specifier's query or fragment per call
**Prefer:**
```js
const { handler } = await import('./m.mjs'); // loaded once, then served from the cache
```
**Avoid:**
```js
const { handler } = await import(`./m.mjs?v=${Date.now()}`); // a new module each time
```
**Why:** An ES module is loaded again when its specifier's query or fragment differs ✅[^node-esm], so each call parses and runs the module anew and keeps another copy.
**Evidence:** Node.js 24 ES modules docs (v24.22.3), section URLs ✅[^node-esm]. A documented statement; no lab timing.
**Exceptions:** A development hot-reload tool that wants a fresh copy and accepts the growing number of loaded modules.
**Check it:** Count module loads per request (a log line at the module's top level).
**Full lab:** none; the shape is listed under `caching-recomputation` in [problem-classes-nodejs-runtime.md](../../performance/code-review/problem-classes-nodejs-runtime.md), Lookup notes.

### `JN-U9` Write TypeScript that Node.js runs directly with erasable syntax only
**Prefer:**
```ts
import type { Role } from './role.ts';
import { load } from './load.ts';
const Mode = { Read: 'read', Write: 'write' } as const;
class User { id: number; constructor(id: number) { this.id = id; } }
const n = value as number;
```
**Avoid:**
```ts
import { Role } from './role';            // ERR_MODULE_NOT_FOUND, and Role is a type only
enum Mode { Read, Write }                  // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
class User { constructor(private id: number) {} }
const n = <number>value;
```
**Why:** Node.js deletes the type text in place and runs what is left; syntax that needs new JavaScript written cannot be stripped ✅[^node-ts]. Line and column numbers stay the same ✅[^lab-strip]. The Node.js 24 docs list type stripping as on by default since v23.6.0, free of the experimental warning since v24.3.0 and stable since v24.12.0 ✅[^node-ts]. The Node.js 22 docs list it as on by default and without the warning since v22.18.0, and label it Stability 1.2 (release candidate), not stable ✅[^node-ts22]. Results were measured only on 24.22.1.
**Evidence:** Node.js 24.22.1 (macOS arm64, 2026-11-14) (✅[^lab-strip]):
- `enum`, a runtime `namespace`, a parameter property and `<T>expr` each failed with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`;
- a type imported without `type` failed with "does not provide an export named";
- an import without extension failed with `ERR_MODULE_NOT_FOUND`;
- `.tsx` and `.ts` under `node_modules` are refused, and `tsconfig.json` is ignored.
No warning is printed for stripping since v24.3.0 ✅[^node-ts].
**Exceptions:** `--experimental-transform-types` runs an `enum`, with an `ExperimentalWarning` ✅[^lab-strip]. The compiler flags `erasableSyntaxOnly` and `verbatimModuleSyntax` catch these forms at type-check time. Whether `enum` is slow is a separate question: `JL-L11` in [language-patterns.md](language-patterns.md).
**Check it:** `node -p "process.features.typescript"` prints `strip`; run the file with `node`.
**Full lab:** [node-type-stripping.md](../../js-runtime/node-type-stripping.md), Catalog.

### `JN-U10` Use `#` subpath imports, not tsconfig `paths` alone, for aliases Node.js resolves
**Prefer:**
```jsonc
// package.json
{ "imports": { "#core/*": { "source": "./src/core/*.ts", "default": "./dist/core/*.js" } } }
```
```ts
import { Role } from '#core/domain/Role';
```
**Avoid:**
```ts
import { Role } from '@/core/domain/Role'; // type-checks, then ERR_MODULE_NOT_FOUND at run time
```
**Why:** tsconfig `paths` does not change emitted import paths ✅[^ts-paths], and Node.js type stripping ignores tsconfig and names subpath imports as the alternative ✅[^node-ts]. `imports` keys must start with `#`, which keeps them apart from package names ✅[^node-packages]. This applies when Node.js runs the source or the build output without an alias-rewriting step.
**Evidence:** Node.js 24.22.1 (macOS arm64): a tsconfig `paths` alias under type stripping failed with `ERR_MODULE_NOT_FOUND` ✅[^lab-strip]. Keys starting with `#/` are allowed from Node.js 24.14.0 and 25.4.0 ✅[^node-packages].
**Exceptions:** A build step that rewrites aliases (`tsc-alias`, a bundler) or a runtime hook (`tsconfig-paths`). With the `source` / `default` form above, plain `node main.ts` resolved `#core/*` to `default` (the built `dist` file) and `node --conditions=source main.ts` to the `.ts` source, re-run for this doc on Node.js 24.22.1 (linux arm64) ✅[^spot]; the `source` condition applies only where the tool is told to use it (tsc `customConditions`, tsx or Node.js `--conditions=source`). `imports` targets cannot leave the package folder: `ERR_INVALID_PACKAGE_TARGET`, measured on 24.22.1 ✅[^lab-subpath].
<details><summary>Spot check: which condition plain <code>node</code> picks</summary>

A package with `"type": "module"` and the `imports` field above, `src/core/x.ts` exporting `where = "src"`, `dist/core/x.js` exporting `where = "dist"`, and `main.ts` doing `import { where } from "#core/x"; console.log("resolved to", where);`, run with `docker run --rm --network none -v "$PWD:/w:ro" -w /w node:24.22.1-alpine sh -c 'node main.ts; node --conditions=source main.ts'`:
```text
resolved to dist
resolved to src
```
</details>

**Check it:** Run the built or stripped entry with plain `node` and no loaders.
**Full lab:** [subpath-imports.md](../../js-runtime/subpath-imports.md), How it works and Edge cases; [node-type-stripping.md](../../js-runtime/node-type-stripping.md), Catalog.

## Takeaways
- Lazy compilation is the right default: forcing eager compilation doubled load time when 1 % of the functions ran, and helped only when nearly all of them ran at start.
- A `vm.Script` cache is worth its keep only when made after running and keyed by a hash of the source, the Node.js version and the flags. [rule-candidate]
- A startup snapshot turns seconds of setup into a deserialization; the module compile cache gives a smaller, cheaper gain.
- Optional heavy modules belong behind `await import()` on the path that uses them, with a fixed specifier.
- TypeScript run by plain `node` must be erasable, and its aliases must be `#` subpath imports or rewritten by a build step.

## Verification status
- Verified: 65 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-28

## References
- V8 startup lab: the scripts of the deep dive, run on 2026-11-26 with Node.js 24.22.1 (V8 13.6.233.17-node.58) in `node:24.22.1-alpine`, arm64, 8 CPUs, 8 GiB, `--network none`; timings are medians of 9 fresh processes after one warm-up, in three full passes; scripts and outputs in [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §3.9 to §3.12 and §4.6 to §4.9. Rank 1 (primary measurement). Backs: Summary; Catalog, JN-U1, JN-U3, JN-U5 and JN-U6; Lookup notes. [^lab-v8]
- V8 startup lab matrix: the same scripts re-run on 2026-11-27 on macOS 26.1 arm64 with Node.js 24.22.1, 22.23.4 (V8 12.4) and 25.7.0 (V8 14.1), Electron 43.7.7 as Node (V8 15.0), linux x64 emulated with Node.js 24.22.1 and Node.js 24.22.3 with pointer compression (no timings used from the emulated builds); outputs in [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md), §6.4. Rank 1 (primary measurement). Backs: Catalog, JN-U2 and JN-U4; Lookup notes. [^lab-v8-matrix]
- Worker-pool measurements, 2026-11-05: Node.js 24.22.1, pdfmake 0.3.13, a main-thread service with and without the static task import; numbers in [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md), Edge cases. Rank 1 (primary measurement). Backs: Catalog and Lookup notes, JN-U7. [^lab-pools]
- Type stripping probe, 2026-11-14: Node.js 24.22.1 on macOS 26.1 arm64, one-line `.ts` files run with `node <file>` and the flags named; results in [node-type-stripping.md](../../js-runtime/node-type-stripping.md), Catalog. Rank 1 (primary measurement). Backs: Catalog, JN-U9 and JN-U10; Lookup notes. [^lab-strip]
- Subpath imports measurement, 2026-11-16: a package whose `imports` targets point outside it, Node.js 24.22.1 on macOS; result in [subpath-imports.md](../../js-runtime/subpath-imports.md), Edge cases. Rank 1 (primary measurement). Backs: Lookup notes, JN-U10. [^lab-subpath]
- Spot check for this doc: the condition check in the `JN-U10` note, run on 2026-11-28 with `node:24.22.1-alpine` (Node.js 24.22.1, linux arm64, `--network none`); setup and output in that note. Rank 1 (primary measurement). Backs: Lookup notes, JN-U10. [^spot]
- [Command-line API: --build-snapshot, --snapshot-blob](https://nodejs.org/docs/latest-v24.x/api/cli.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Lookup notes, JN-U5. [^node-cli]
- [Modules: node:module API, Module compile cache](https://nodejs.org/docs/latest-v24.x/api/module.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Lookup notes, JN-U6. [^nodemodule]
- [VM (executing JavaScript)](https://nodejs.org/docs/latest-v24.x/api/vm.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Lookup notes, JN-U3. [^nodevm]
- [V8 module: Startup Snapshot API](https://nodejs.org/docs/latest-v24.x/api/v8.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Lookup notes, JN-U5. [^nodev8]
- [Modules: CommonJS modules, Caching](https://nodejs.org/docs/latest-v24.x/api/modules.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Lookup notes, JN-U7. [^node-modules]
- [Modules: ECMAScript modules, URLs](https://nodejs.org/docs/latest-v24.x/api/esm.html) — Node.js project, v24.22.3 docs. Rank 1. Backs: Catalog and Lookup notes, JN-U8. [^node-esm]
- [Modules: TypeScript](https://nodejs.org/docs/latest-v24.x/api/typescript.html) — Node.js project, v24.x docs (history table re-read 2026-11-28). Rank 1. Backs: Catalog, JN-U9; Lookup notes, JN-U9 and JN-U10. [^node-ts]
- [Modules: TypeScript (Node.js 22 docs)](https://nodejs.org/docs/latest-v22.x/api/typescript.html) — Node.js project, v22.x docs (read 2026-11-28). Rank 1. Backs: Lookup notes, JN-U9. [^node-ts22]
- [Packages: subpath imports](https://nodejs.org/api/packages.html#subpath-imports) — Node.js project, living. Rank 1. Backs: Lookup notes, JN-U10. [^node-packages]
- [TSConfig reference: paths](https://www.typescriptlang.org/tsconfig/#paths) — TypeScript team, living. Rank 1. Backs: Catalog and Lookup notes, JN-U10. [^ts-paths]
- [src/snapshot/code-serializer.cc at 13.6.233.17](https://github.com/v8/v8/blob/13.6.233.17/src/snapshot/code-serializer.cc) — V8 project, 2025. Rank 1. Backs: Lookup notes, JN-U4. [^codeser]
- [Blazingly fast parsing, part 2: lazy parsing](https://v8.dev/blog/preparser) — V8 team (Verwaest, Hölttä), 2019-04-15. Rank 4. Backs: Lookup notes, JN-U1. [^preparse]
- [Code caching for JavaScript developers](https://v8.dev/blog/code-caching-for-devs) — V8 team (Leszek Swirski), 2019-04-08, updated 2020-06-16. Rank 4. Backs: Lookup notes, JN-U3. [^ccdev]
- [Custom startup snapshots](https://v8.dev/blog/custom-startup-snapshots) — V8 team (Yang Guo), 2015-09-25. Rank 4. Backs: Lookup notes, JN-U5. [^snap15]
- [Giving V8 a heads-up: faster JavaScript startup with explicit compile hints](https://v8.dev/blog/explicit-compile-hints) — V8 team (Marja Hölttä), 2025-04-29. Rank 4. Backs: Lookup notes, JN-U2. [^hints]

## Related
- [v8-memory-and-startup-deep-dive.md](../../js-runtime/v8-memory-and-startup-deep-dive.md) — the parser, code cache, snapshots and compile cache, with every script behind `JN-U1` to `JN-U6`.
- [node-type-stripping.md](../../js-runtime/node-type-stripping.md) — what Node.js 24.12+ type stripping runs and rejects.
- [subpath-imports.md](../../js-runtime/subpath-imports.md) — why Node.js aliases start with `#`.
- [worker-thread-pools.md](../../js-runtime/worker-thread-pools.md) — the static-import measurement behind `JN-U7`.
- [../../js-runtime/barrel-files.md](../../js-runtime/barrel-files.md) — the load cost of re-export files.
