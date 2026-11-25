---
schema: knowledge-doc/v1
type: concept
topic: bun/bundler
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, bundler, plugins, bun-plugin, onresolve, onload, virtual-modules, preload, macros, import-attributes]
---

# Bun plugins and macros

## Summary
**TL;DR:** A Bun plugin is an object `{ name, setup(build) }`. The same object works in two places: in `Bun.build({ plugins })`, where `setup` gets a builder with `onStart`, `onResolve`, `onLoad`, `onEnd` and `config`, and at run time through `Bun.plugin()` in a preload script, where Bun 1.4.5's builder has only `onResolve`, `onLoad` and `module` (virtual modules). A macro is a function imported `with { type: "macro" }`: Bun calls it while transpiling and inlines its return value, so the function's code never reaches the output. JSON-like values, `Response` and `Blob` can be inlined; functions and `Date` objects fail the build, and code under `node_modules` may not call macros.
**Use this when:** adding a file type or a virtual module to Bun, making a build plugin also work under `bun run`, embedding build-time data (a commit hash, a fetched page) into a bundle, or reviewing a dependency that ships macros.
**Not this doc:** build options and outputs → [bun-build.md](bun-build.md); plugins for `Bun.serve` HTML routes (`[serve.static] plugins`) → [fullstack-dev-server-and-html.md](fullstack-dev-server-and-html.md); the built-in loaders → `bun/fundamentals/module-resolution-and-loaders.md`; `preload` and other `bunfig.toml` keys → `bun/fundamentals/configuration-and-environment.md`.

## Problem
Teams write a loader plugin for `Bun.build`, then run the same code with `bun app.ts` and get `Cannot find package 'virtual:build-info'`, because at run time nothing registered the plugin. When they do register it, hooks they used at bundle time (`onStart`, `onEnd`, `build.config`) do not exist at run time, and `build.module()` works only at run time. Macros cause the opposite confusion: they look like normal imports, yet they run on the build machine (and again under an unbundled `bun app.ts`), and calling a macro exported by a dependency runs that package's code during your build.

## Mental model
**Analogy:** plugins are clerks at a post office sorting room. The `onResolve` clerk reads the address on each parcel (the import string) and may rewrite it, adding a department stamp (the namespace). The `onLoad` clerk opens parcels for its department and hands over the contents plus a label saying how to read them (the loader). A macro is a mail merge done at the print shop: the formula runs once, before printing, and only its result is printed in every copy.

**Artifact:** one plugin with three hooks, used unchanged in both places below (the lab copy also logs each hook call) ✅[^lab]:
```ts
// upper-plugin.ts
import type { BunPlugin } from "bun";
export const upperTxt: BunPlugin = {
  name: "upper-txt",
  setup(build) {
    // build.config exists only in Bun.build
    const where = build.config ? `bundler (target=${build.config.target})` : "runtime";
    build.onResolve({ filter: /^virtual:build-info$/ }, () => ({ path: "build-info", namespace: "virtual" }));
    build.onLoad({ filter: /.*/, namespace: "virtual" }, () =>
      ({ contents: `export const where = ${JSON.stringify(where)};`, loader: "js" }));
    build.onLoad({ filter: /\.txt$/ }, async args =>
      ({ contents: `export default ${JSON.stringify((await Bun.file(args.path).text()).toUpperCase())};`, loader: "js" }));
  },
};
```

## How it works
Four actors take part:
- **Your plugin** — its job: register hooks, via `setup(build)`.
- **The bundler** — its job: call the hooks while it builds, via `Bun.build({ plugins })`.
- **The runtime module loader** — its job: call the hooks on each `import` or `require()` as code runs, via plugins registered with `Bun.plugin()`.
- **The transpiler** — its job: run macro calls and turn their results into code, via imports marked `with { type: "macro" }`.

```
Bun.build({ plugins })                         bun app.ts  (bunfig.toml: preload = ["./register.ts"])
  setup(build)  build.config = BuildConfig       register.ts → Bun.plugin(upperTxt) → setup(build), no config
  onStart()  ─ once per build                    import "./greeting.txt"
  for each import string:                          └─ onLoad (matching filter) → module
    onResolve(filter, namespace) → {path, namespace}  import "virtual:build-info"
    onLoad(filter, namespace) → {contents, loader}     └─ onLoad for namespace "virtual" → module
  link + emit                                    build.module("virtual:answer", …) → module
  onEnd(BuildOutput) ─ Bun.build waits for it
```

1. **Bundler, in order** (lab log of one `Bun.build`) ✅[^lab]:
   - `[setup] bundler (target=bun)` — `setup` ran once with `build.config` set to the build's options ✅[^1].
   - `[onStart]` — once per build; Bun waits for every `onStart` promise before continuing ✅[^1]. An `onStart` that slept 300 ms moved the first `onResolve` to 311 ms after the build began ✅[^lab].
   - `[onResolve] virtual:build-info from app.ts` — `filter` is a regular expression tested against the import string, `namespace` narrows it further; returning `{ path, namespace }` gives the module the id `namespace:path` ✅[^1].
   - `[onLoad] greeting.txt (default loader: text, namespace: file)` — the default namespace is `file`, and returning `{ contents, loader }` replaces the file's contents and how they are parsed ✅[^1] ✅[^2]. Returning `undefined` passed the module on: a second matching `onLoad` then supplied it, and with no other plugin the file loaded as usual (`"plain text"`) ✅[^lab].
   - `[onEnd] success=true outputs=1` — `onEnd` gets the `BuildOutput`, and the `Bun.build` promise waits for every `onEnd` promise ✅[^1]. An `onEnd` that started at 328 ms and slept 300 ms held `Bun.build` until 629 ms ✅[^lab].
   - `onLoad`'s `defer()` returns a promise that resolves once every other module is loaded, and may be called once per callback ✅[^1]. Lab: a `stats.json` `onLoad` called `defer()` when only `app.ts` had loaded; it resolved after `a.ts`, `b.ts` and `c.ts`, the module then exported `["app.ts","a.ts","b.ts","c.ts"]`, and a second `defer()` threw `Can't call .defer() more than once within an onLoad plugin` ✅[^lab].
   - `onBeforeParse` runs native (Node-API) plugins on the parser threads ✅[^1]. Lab, in `bunlab:1`: a 21-line C file built with `gcc -shared -fPIC` against `bundler_plugin.h` from the release tag ✅[^8] exported `napi_register_module_v1` and a hook `void replace_foo(const OnBeforeParseArguments *args, OnBeforeParseResult *result)` that calls `result->fetchSourceCode(args, result)` and hands back new source. Registered with `build.onBeforeParse({ filter: /\.ts$/, namespace: "file" }, { napiModule: require("./plugin.node"), symbol: "replace_foo" })`, it turned every `foo` into `bar` in 7 files, on 4 and 6 different threads in two runs, none of them the JavaScript thread (for example threads 17, 18, 21 and 22 against 13), while a JavaScript `onLoad` in the same build ran on the JavaScript thread ✅[^lab].
2. **Runtime registration:**
   - `Bun.plugin(plugin)` registers hooks for the running process; because ES modules resolve their imports before any code in the file runs, register plugins in a preload script, before the code that imports through them ✅[^2] ✅[^5]. A file that called `plugin()` and then statically imported `greeting.txt` got the plain text `shout this`, while a dynamic `import()` placed after `plugin()` got the plugin's `SHOUT THAT` ✅[^lab].
   - `preload = ["./register.ts"]` in `bunfig.toml` runs the script before the entry file ✅[^6] ✅[^lab].
   - In 1.4.5 the runtime builder's keys were `target, onLoad, onResolve, module`; `build.config` was `undefined` and `build.onStart` / `build.onEnd` were not functions ✅[^lab].
3. **Virtual modules:** `build.module("virtual:answer", () => ({ exports: { answer: 42 }, loader: "object" }))` creates a module that exists only in memory, built lazily on first import ✅[^5]; at run time `import { answer } from "virtual:answer"` gave `42` ✅[^lab]. In `Bun.build` the same call threw `TypeError: module() is not supported in Bun.build() yet. Only via Bun.plugin() at runtime` ✅[^lab]; use `onResolve` plus `onLoad` with a namespace there.
4. **Compatibility with esbuild plugins:** Bun implements `onStart`, `onEnd`, `onResolve` and `onLoad`, not esbuild's `onDispose` and `resolve`; `initialOptions` is partial and read-only, so use `build.config` ✅[^7]. In 1.4.5 `onDispose` and `resolve` exist but throw when called, and `initialOptions` accepted a write (Edge cases) ✅[^lab].

### Hooks by place, measured
| Builder member | In `Bun.build` | At run time (`Bun.plugin`) |
|---|---|---|
| `onStart(cb)` | Ran once, before resolving ✅[^lab] | `build.onStart is not a function` ✅[^lab] |
| `onResolve({ filter, namespace }, cb)` | Ran for `virtual:build-info` ✅[^lab] | Ran for `bare.thing`, not for `bare-thing` or `@/utils` (Edge cases) ✅[^lab] |
| `onLoad({ filter, namespace }, cb)` | `args.loader` `"text"`, `args.namespace` `"file"` ✅[^lab] | Ran; `args.loader` and `args.namespace` were `undefined` ✅[^lab] |
| `onEnd(cb)` | Ran with `success=true outputs=1` ✅[^lab] | `build.onEnd is not a function` ✅[^lab] |
| `config` | The `BuildConfig` (here `target: "bun"`) ✅[^lab] | `undefined` ✅[^lab] |
| `module(specifier, cb)` | Throws `TypeError` ✅[^lab] | Works ✅[^lab] |

### Macros
1. **Marking:** `import { buildInfo } from "./macros.ts" with { type: "macro" }`; the older `assert { type: "macro" }` form also works ✅[^4] ✅[^lab].
2. **Execution:** when the transpiler reaches a call to a macro import, it loads the module, runs the function, awaits a returned promise, and converts the result into a syntax-tree node; calls run in source order, and the bundler runs them in parallel worker threads ✅[^4]. Lab: four files each called one macro three times; inside each file the calls ran in source order, each file's calls ran on its own thread (`isMainThread` was `false`, the thread id differed per file), and the order of the files changed between runs (b, c, d, a, then c, d, a, b) ✅[^lab].
3. **Arguments** must be known at bundle time (literals or other macro results) ✅[^4]; `echo(v)` with `v` computed from `Math.random()` failed with `"Cannot convert identifier to JS. Try a statically-known value" error in macro` ✅[^lab].
4. **Results** are serialized ✅[^4] ✅[^lab]:

   | Macro returns | Inlined as (lab, `bun build --minify-syntax`) |
   |---|---|
   | `{ builtBy: "macro", items: [1, 2, { nested: true }] }` | The object literal (`nested: !0`) |
   | `async` function → `"async value"` | `"async value"` |
   | `Response` with `content-type: application/json` | `{ fromResponse: 1 }` |
   | `Response` with `content-type: text/plain` | `"plain text body"` |
   | `Response` with `application/octet-stream` body `hi` | `"data:application/octet-stream;base64,aGk="` |
   | `Response` with no content type, body `hi` | `"hi"` |
   | `Blob` of type `application/json` | `{ a: 1 }` |
   | `() => 1` | Build error `cannot coerce Function (JSType(36)) to Bun's AST. Please return a simpler type` |
   | `new Date(0)` | Build error `cannot coerce JSType(73) to Bun's AST` |
5. **Dead code:** `if (returnFalse()) console.log("eliminated")` left nothing in the output once syntax minification was on ✅[^4] ✅[^lab].
6. **Security:**
   - A macro runs only where it is imported with the attribute and called ✅[^4]. The same function imported without the attribute ran nothing at build time; the bundle kept its code and the call `var p = tick("plain-call")` for run time ✅[^lab].
   - A call from a file under `node_modules` fails: `error: For security reasons, macros cannot be run from node_modules.` at `node_modules/evil/index.js:2:18` ✅[^4] ✅[^lab].
   - `--no-macros` turns every call into `error: Macros are disabled` ✅[^4] ✅[^lab].

## Worked example
The plugin from the Mental model, used both ways on this app ✅[^lab]:
```ts
// app.ts                                        // greeting.txt contains: shout this
import greeting from "./greeting.txt";
import { where } from "virtual:build-info";
console.log("greeting =", greeting, "| where =", where);
```
1. **Bundle time:** `build.ts` calls `Bun.build({ entrypoints: ["./app.ts"], target: "bun", plugins: [upperTxt] })`. The bundle text ✅[^lab]:
   ```js
   // @bun
   // greeting.txt
   var greeting_default = "SHOUT THIS";

   // virtual:build-info
   var where = "bundler (target=bun)";

   // app.ts
   console.log("greeting =", greeting_default, "| where =", where);
   ```
2. **Run time:** `register.ts` holds `import { plugin } from "bun"; plugin(upperTxt);` plus a second plugin that calls `build.module("virtual:answer", …)`, and `bunfig.toml` holds `preload = ["./register.ts"]`. `bun app2.ts` (this app plus `import { answer } from "virtual:answer"`) printed `greeting = SHOUT THIS | where = runtime | answer = 42` ✅[^lab].
3. **Without the preload** (`bunfig.toml` renamed): `error: Cannot find package 'virtual:build-info' from '/w/app.ts'` ✅[^lab].
4. **A macro in the same project:** `bun build ./app.ts --minify-syntax` with `export const info = buildInfo();` printed `[macro ran at bundle time, pid 7]` on the build's stderr and emitted `var info = { builtBy: "macro", nodeVersion: "1.4.5", … }`; the `macros.ts` source is not in the bundle ✅[^lab].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Runtime `onResolve` with a bare specifier: documented on bun.com, not in 1.4.5 | `bare-thing` and `@/utils` never reached the callback; Bun tried the npm registry instead (its note: `GET …/bare-thing - 404`), and `lodash` loaded the real package through auto-install (the folder had no `node_modules`) instead of being redirected. `bare.thing` did reach it ✅[^lab] | `bun.d.ts` 1.4.5 says runtime hooks match only specifiers containing `.` or `:` ✅[^5]. The live `bun.com/docs/runtime/plugins` page says callbacks run for any import string, including `"react"` and `"@/utils"` ✅[^3], but the 1.4.5 docs at the release tag do not say so ✅[^2]: it describes a newer release. Present in `1.4.6-canary.1` (the `oven/bun:canary` preview build), not in 1.4.5: the same preload plugin received `bare-thing`, `@/utils` and `lodash` as well as `bare.thing`, and each import returned the plugin's module ✅[^lab] |
| Runtime `onLoad` arguments | `args.loader` and `args.namespace` were `undefined` for a `.txt` file, also in `1.4.6-canary.1` ✅[^lab] | Both docs pages list them as arguments ✅[^1] ✅[^2]; read the extension from `args.path` instead |
| `virtual:build-info` at run time | The `namespace: "virtual"` `onLoad` handled it, and the `onResolve` callback did not log ✅[^lab] | A `prefix:` string already names a namespace at run time; do not rely on `onResolve` side effects there |
| `bunfig.toml` preload while running a build script | `bun build.ts` printed `[setup] runtime` before `[setup] bundler` ✅[^lab] | `preload` applies to every `bun <file>` in that folder, the build script included ✅[^6] |
| Macros under plain `bun app.ts` | The macro ran again (its stderr line printed, pid 25) ✅[^lab] | The runtime transpiler also runs macros, so a slow or privileged macro can run each time the file is transpiled at start-up |
| `Response` with no `content-type` | Inlined as text (`"hi"`; bytes 1, 2, 3 became an escaped string) ✅[^lab]; `"hi"` in `1.4.6-canary.1` too ✅[^lab] | The docs say such responses are base64-encoded ✅[^4]; in 1.4.5 only `application/octet-stream` gave base64, as a `data:` URL |
| `build.module()` inside `Bun.build` | `TypeError: module() is not supported in Bun.build() yet` ✅[^lab] | Runtime-only API in 1.4.5; use `onResolve` + `onLoad` with a namespace |
| esbuild's `build.onDispose()`, `build.resolve()` and `build.initialOptions` | Both functions exist and throw `On-dispose callbacks is not implemented yet` / `build.resolve() is not implemented yet` (each with a link to issue 2771); `initialOptions` had 11 keys (`entrypoints`, `target`, `plugins`, `bundle`, `entryPoints`, four `minify` keys, `outbase`, `platform`), was not frozen, and a write to `initialOptions.target` stuck while `build.config.target` did not change ✅[^lab] | The docs call `initialOptions` read-only and say the two hooks are not implemented ✅[^7]; test with `typeof` and you get `"function"`, so call them inside `try` or not at all |
| A package `"macro"` export condition (`"macro": "./index.macro.js"`) | `import { who } from "mpkg" with { type: "macro" }` ran `index.js` and inlined `"runtime"`, with the `"macro"` key placed last or first in `exports` ✅[^lab]; `1.4.6-canary.1` also inlined `"runtime"` ✅[^lab] | The docs say the bundler resolves a macro import through the `"macro"` condition ✅[^4]; not observed in 1.4.5, so keep macros in a separate entry file (`"pkg/macro"`) |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| JavaScript plugin | Any file type or virtual module, one object for bundler and runtime | Runs on the single JavaScript thread while the native bundler parses on several ✅[^1]; the lab's `onLoad` ran on the JavaScript thread ✅[^lab] |
| Native plugin (`onBeforeParse`) | Runs on the parser threads (4–6 of them in the lab ✅[^lab]), no UTF-16 conversion ✅[^1] | Needs a thread-safe Node-API add-on (for example in Rust) ✅[^1]; a plain C file and the C header also worked ✅[^lab] |
| Macro | Values computed once and inlined; the code and its secrets stay out of the bundle | Also runs under unbundled `bun app.ts`; only static arguments; build depends on what the macro reads |
| `define` / `env` | No code runs at build time | Only constants, no computed or fetched data |

## Takeaways
- Register runtime plugins in a `preload` script (`bunfig.toml`) so they exist before any import resolves. [rule-candidate]
- In a plugin meant for both places, test `build.config` before calling `onStart`/`onEnd`, and do not call `build.module()` from `Bun.build`. [rule-candidate]
- At run time in 1.4.5, give virtual modules a `prefix:` name (`virtual:x`) or a dot in the name; bare names such as `bare-thing` and `@/utils` did not reach `onResolve`.
- Keep macros pure and fast: return JSON-like data, pass only literal arguments, and remember they run again under `bun app.ts`. [rule-candidate]
- Build with `--no-macros` when building code you do not trust.

## Verification status
- Verified: 87 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the native plugin was compiled and run in `bunlab:1`, the same image plus gcc 14.2 and libc6-dev; `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`) ran the checks of the next build. [^lab]
- [docs/bundler/plugins.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/plugins.mdx) — Bun documentation source at the release tag, 2026. Backs: plugin shape, `onStart`/`onResolve`/`onLoad`/`onEnd` semantics, namespaces, `defer()`, native plugins and `onBeforeParse`, onLoad arguments. [^1]
- [docs/runtime/plugins.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/plugins.mdx) — Bun documentation source at the release tag, 2026. Backs: the 1.4.5 runtime `onResolve`/`onLoad` text, registering with `plugin()`, onLoad arguments. [^2]
- [Plugins (runtime)](https://bun.com/docs/runtime/plugins) — Bun documentation, living (read 2026-11-24, newer than 1.4.5). Backs: only the "any import string" gap row in Edge cases. [^3]
- [docs/bundler/macros.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/macros.mdx) — Bun documentation source at the release tag, 2026. Backs: import attribute, execution order and threads, static arguments, serialization of JSON, `Response` and `Blob`, dead-code elimination, node_modules block, `--no-macros`, the `"macro"` export condition. [^4]
- [packages/bun-types/bun.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/bun.d.ts) — Bun source, 2026. Backs: `PluginBuilder` members, `module()` virtual modules with `loader: "object"`, runtime hooks matching only specifiers with `.` or `:`, ES module ordering note. [^5]
- [docs/runtime/bunfig.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/bunfig.mdx) — Bun documentation source at the release tag, 2026. Backs: `preload` runs scripts and plugins before `bun run`-ing a file. [^6]
- [docs/bundler/esbuild.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/esbuild.mdx) — Bun documentation source at the release tag, 2026. Backs: which esbuild plugin hooks Bun implements, `initialOptions` vs `config`. [^7]
- [packages/bun-native-bundler-plugin-api/bundler_plugin.h at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-native-bundler-plugin-api/bundler_plugin.h) — Bun source, 2026. Backs: the C structs `OnBeforeParseArguments` and `OnBeforeParseResult` (with `fetchSourceCode`) that a native `onBeforeParse` hook receives. [^8]

## Related
- `bun/bundler/bun-build.md` — the build options a plugin's `build.config` holds.
- `bun/bundler/fullstack-dev-server-and-html.md` — plugins for HTML routes via `[serve.static]`.
- `bun/fundamentals/module-resolution-and-loaders.md` — loader names that `onLoad` returns, import attributes.
- `bun/fundamentals/configuration-and-environment.md` — `preload` and `bunfig.toml`.
- `bun/package-manager/lifecycle-scripts-and-supply-chain.md` — the other way a dependency can run code on your machine.
