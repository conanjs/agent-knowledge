---
schema: knowledge-doc/v1
type: concept
topic: bun/fundamentals
status: verified
applies-to: ["Bun 1.4.5", "Node.js 24.22.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, module-resolution, esm, commonjs, require-esm, top-level-await, extensions, tsconfig-paths, exports, conditions, import-meta, loaders, import-attributes, toml, yaml, json5, sqlite, resolveSync]
---

# Module resolution and loaders in Bun: from an import string to a value

## Summary
**TL;DR:** Bun lets ES modules (ESM) and CommonJS (CJS) meet in every direction: an ESM file may also call `require()`, `require()` of an ESM file returns its namespace object, and `import` of a CJS file gives `module.exports` as default plus its keys as named exports. `require()` of a module with top-level `await` works only if the await settles without waiting for the event loop; otherwise it throws `TypeError: require() async module … is unsupported`. Extensionless imports try one of four extension orders (local ESM: `.tsx .jsx .mts .ts .mjs .js .cts .cjs .json`; `require()` lists end with `.node`), a `.js` specifier also finds the `.ts` file, and `tsconfig.json` `paths` work without a build step. In `package.json` `exports`, the first key that matches wins, and Bun matches `"bun"`, so a package can ship TypeScript source to Bun only. This doc owns the runtime **loaders table**: JSON, JSONC, TOML, YAML, JSON5, text, Markdown and XML files import as parsed values, SQLite files as a `Database` with `with { type: "sqlite" }`, and anything unknown as its path.
**Use this when:** an import resolves to the wrong file or fails, mixing `require` and `import`, publishing a package with conditions, aliasing paths, reading `import.meta`, or importing a non-JavaScript file.
**Not this doc:** which syntax the transpiler accepts and which `tsconfig.json` fields it honours → [running-code-and-transpilation.md](running-code-and-transpilation.md); installing on import when there is no `node_modules` → same doc, step 7; how `bun build` bundles these file types → `bun/bundler/bun-build.md`; HTML imports for `Bun.serve` → `bun/bundler/fullstack-dev-server-and-html.md`; the `Database` API → `bun/system-apis/sqlite-and-sql.md`; why `#` aliases exist → `js-runtime/subpath-imports.md`.

## Problem
Code that works under Bun can fail under Node.js and the reverse, because the two resolve differently. A `.js` import of a `.ts` file, an extensionless import or a `tsconfig.json` alias runs in Bun and throws `ERR_MODULE_NOT_FOUND` in Node.js 24. `import { a } from "./legacy.cjs"` gives `a` in Bun but `SyntaxError: Named export 'a' not found` in Node.js. A library that uses top-level `await` breaks every CJS consumer, but only when the await waits for I/O. A package whose `exports` lists `"node"` before `"bun"` never reaches its Bun entry. And `import config from "./app.toml"` returns an object in Bun, which no other runtime does.

## Mental model
**Analogy:** resolution is a postal sorting office. The address on the envelope (the specifier, `"./util"` or `"zod"`) is first expanded into a full street address (an absolute file path) using the office's rules: try these house numbers in this order, look up this company's internal directory (`exports`), honour forwarding orders (`paths`, `imports`). Then a clerk who knows the file's language (the *loader*) opens the parcel: a letter in TypeScript is translated, a spreadsheet in TOML is turned into a table, an unknown package is handed over unopened, as its address.

**Artifact:** one folder, four imports, Bun 1.4.5 against Node.js 24.22.1 ✅[^lab]:
```js
// main.js — only src/lib/util.ts exists; node_modules/cond has "exports" with a "bun" key
import { util } from "./src/lib/util.js";     // Bun: util.ts      Node: ERR_MODULE_NOT_FOUND
import { util as u2 } from "./src/lib/util";  // Bun: util.ts      (extensionless)
import c from "cond";                         // Bun: "bun condition -> src/index.ts (TypeScript source)"
                                              // Node: "node condition -> dist/node.js"
const { util: u3 } = await import("#lib/util"); // package.json "imports": util.ts
```

## How it works
**3 actors:**
- **Resolver** — its job: turn a specifier into an absolute path, via extension lists, `package.json` and `tsconfig.json`.
- **Loader** — its job: turn the file into a module, via the `type` import attribute, a configured mapping, or the extension.
- **Module system** — its job: link and evaluate the module as ESM or CJS, via JavaScriptCore's module loader and a CJS wrapper.

```
"./x" ──▶ Resolver: exact file? else try extensions (order depends on ESM/require/node_modules), then x/index.*
"#a"  ──▶ Resolver: package.json "imports"
"@a/x"──▶ Resolver: tsconfig "paths" ─┐
"zod" ──▶ Resolver: node_modules up the tree → package.json "exports" (first matching key) or "main"
                                    ▼
                         /abs/path/file.ext
                                    ▼
          Loader: with { type } ? → bunfig/--loader map ? → extension → (unknown → "file")
                                    ▼
          Module system: ESM (import/export) or CJS (module/exports/require wrapper) → value
```

1. **Resolver: relative paths.** A specifier with an extension is tried as is first; if that file is missing, Bun appends each extension to the full path ✅[^1]. Lab: `import "./a.b"` loaded `a.b.ts`, and `import "./cfg.json"` with only `cfg.json.ts` on disk loaded that file ✅[^lab]. Without one, it tries an extension list, then `<dir>/index.*` ✅[^1] (`import "./dir"` loaded `dir/index.ts` ✅[^lab]). Four lists exist in the source ✅[^2], and a probe that deleted the winning file each round (nine files `x.tsx` … `x.json`, plus `x.node` for the `require()` rows) found all four ✅[^lab]:

   | Importer | Order observed |
   |---|---|
   | ESM `import` in your code | `.tsx .jsx .mts .ts .mjs .js .cts .cjs .json` |
   | `require()` in your code | `.tsx .ts .jsx .cts .cjs .js .mjs .mts .json .node` |
   | ESM `import` of a file inside `node_modules` | `.mjs .jsx .mts .js .cjs .tsx .ts .cts .json` |
   | `require()` inside `node_modules` | `.jsx .cjs .js .mjs .mts .tsx .ts .cts .json .node` |

   The `.node` entry at the end of both `require()` lists is added only for target `bun`, "to support require'ing .node files" ✅[^2]: `require("./addon")` with only `addon.node` on disk loaded the Node-API add-on (built with gcc in `bunlab:1`), while `import "./addon"` failed with `Cannot find module './addon'` ✅[^lab]. The `require()` order in your code is exactly the `--extension-order` default that the run-flags page gives, `.tsx,.ts,.jsx,.cts,.cjs,.js,.mjs,.mts,.json,.node` ✅[^9] ✅[^lab]. A specifier ending in `.js` or `.jsx` also matches a `.ts` or `.tsx` file, and outside `node_modules` `.mjs` matches `.mts`, following TypeScript's extension substitution ✅[^1]. Lab: `./s.mjs` found `s.mts` and `./c.jsx` found `c.tsx` in your code; inside `node_modules`, `./j.js` still found `j.ts` but `./s.mjs` did not find `s.mts` ✅[^lab].
2. **Resolver: aliases.** `tsconfig.json` (or `jsconfig.json`) `compilerOptions.paths` maps specifiers to files, and `package.json` `"imports"` maps `#`-prefixed ones; both may be used together ✅[^1] ✅[^3]. In the lab `"@lib/*": ["./src/lib/*"]`, `"cfg": ["./src/lib/util.ts"]` and `"#lib/*": "./src/lib/*.ts"` all resolved, and a `jsconfig.json` alone with `"@z": ["./src/z.js"]` did too ✅[^lab].
3. **Resolver: packages.** A bare specifier walks up to a `node_modules` folder containing the package; `NODE_PATH` adds folders to search ✅[^1] (`NODE_PATH=/w/packages` found `packages/foo/index.js` in the lab ✅[^lab]). In the package's `exports`, Bun checks the conditions `bun`, `node-addons`, `node`, `require` or `import` (by how it was loaded) and `default`, and "whichever of these conditions occurs first" in the object wins ✅[^1]. `--conditions=<name>` adds a custom one ✅[^1]. Lab: with `"bun"` listed first Bun loaded `src/index.ts`; with `"node"` listed first Bun loaded `dist/node.js`, like Node.js did; `--conditions=custom` picked the `"custom"` entry; `{ "import", "require", "default" }` gave the `import` file to `import` and the `require` file to `require()`; a `"node-addons"` key before `"default"` won for both ✅[^lab]. Without `exports`, Bun prefers `main` (or an implicit `index.*`) and falls back to `module` ✅[^1]: a package with only `"module"` loaded that file, and one with both loaded `main`, for `import` and `require()` alike ✅[^lab]. A subpath not listed in `exports` cannot be imported ✅[^1].
4. **Resolver: built-in replacements.** Some npm specifiers load Bun's own module even when the package is installed: `undici`, `node-fetch`, `isomorphic-fetch`, `@vercel/fetch`, `ws`, `utf-8-validate`, `abort-controller` and Next.js's compiled copies of the first three ✅[^1]. Lab, with a fake package of each name in `node_modules` whose `index.js` exported `{ FAKE: … }`: every one of those specifiers, plus `ws/lib/websocket`, `abort-controller/polyfill` and `next/dist/compiled/{undici,node-fetch,ws}`, returned Bun's module (`undici` had `Agent`, `BalancedPool`, …), never the fake; `require.resolve("undici")` returned `"undici"`, and `undici/package.json` loaded the fake package's file (version `9.9.9`) ✅[^lab].
5. **Loader: pick how to read the file.** The `type` import attribute overrides the extension: `import cfg from "./app.cfg" with { type: "toml" }` ✅[^4] ✅[^lab]; a `[loader]` table in `bunfig.toml` ✅[^5] or the `--loader .ext:loader` flag ✅[^9] maps extensions. Lab: `import v from "./f.bagel"` gave the file's path, `/tmp/m/f.bagel`; with `--loader .bagel:ts` it gave the module's value `5`, with `-l .bagel:text` the source text ✅[^lab]. The table under **Runtime loaders** lists what each loader returns.
6. **Module system: ESM or CJS.** A `.cjs` file, or a file in which the transpiler sees `module.exports`/`exports`, is CommonJS: Bun wraps it in a function that receives `module`, `exports` and `require` ✅[^1]. Lab: `arguments` inside a `.cjs` file had 5 entries, of types `object, function, object, string, string`, the last two equal to `__filename` and `__dirname` ✅[^lab]. After it runs, Bun builds an ES module whose `default` is `module.exports` and, when that is an object, whose named exports are its keys ✅[^1]. Both ESM and CJS files may call `require()`; on an ESM target it returns the namespace object ✅[^1]. Lab results ✅[^lab]:

   | Code | Bun 1.4.5 | Node.js 24.22.1 |
   |---|---|---|
   | `require("./esm.mjs")` | keys `default`, `named`; `__esModule` is `true` | keys `__esModule`, `default`, `named` |
   | `import d, { a } from "./cjs.cjs"` (`module.exports = { a: 1, b: 2 }`) | `d` = `{a:1,b:2}`, `a` = `1` | `SyntaxError: Named export 'a' not found` |
   | `import fn, { extra }` from `module.exports = function hello(){}; module.exports.extra = 5` | `fn()` = `"hi"`, `extra` = `5` | — |
   | `import` and `require()` in one ESM `.ts` file | both work | — |
   | `import` plus `module.exports =` in one file | `error: Cannot use import statement with CommonJS-only features` + `note: This file is CommonJS because 'module' was used` | — |
   | `require()` of a module whose top-level `await` is `await Promise.resolve()` | loads, `t` = `1` | `ERR_REQUIRE_ASYNC_MODULE` |
   | `require()` of a module that awaits a 50 ms `setTimeout` | `TypeError: require() async module "/w/tla2.mjs" is unsupported. use "await import()" instead.` | `ERR_REQUIRE_ASYNC_MODULE` |

   The docs state the rule without the microtask nuance: a file that uses top-level `await` cannot be `require()`d ✅[^1].
7. **`import.meta`.** For `/w/entry.ts` the lab printed ✅[^lab] ✅[^1]:

   | Property | Value | Node.js 24.22.1 |
   |---|---|---|
   | `dir`, `dirname` | `"/w"` | `dirname` only |
   | `file` | `"entry.ts"` | `undefined` |
   | `path`, `filename` | `"/w/entry.ts"` | `filename` only |
   | `url` | `"file:///w/entry.ts"` | same form |
   | `main` | `true` in the entry file, `false` in an imported one | `true` in the entry |
   | `resolve("./sub/child.ts")` | `"file:///w/sub/child.ts"` | same form |
   | `env` | the same object as `process.env` | `undefined` |

   `Bun.main` holds the absolute path of the entry file (`/w/entry.ts`) ✅[^lab] ✅[^6].
8. **`Bun.resolveSync(specifier, fromDir)`.** Runs the resolver without loading: `Bun.resolveSync("cond", "/w")` returned `/w/node_modules/cond/src/index.ts`, `"@lib/util"` returned the aliased file, and a missing package threw a `ResolveMessage` with `code` `ERR_MODULE_NOT_FOUND` ✅[^lab].

### Runtime loaders
What `import x from "<file>"` gives under `bun run` (each row measured with a one-line file in the lab ✅[^lab]; loader names and extensions from the docs ✅[^4]):

| Extension | Loader | Value of the default export | Notes |
|---|---|---|---|
| `.js`, `.jsx` / `.mjs`, `.cjs` / `.ts`, `.mts`, `.cts` / `.tsx` | `jsx` / `js` / `ts` / `tsx` | the module | see [running-code-and-transpilation.md](running-code-and-transpilation.md) |
| `.json` | `json` | parsed object | `with { type: "json" }` is the standard attribute |
| `.jsonc` | `jsonc` | parsed; comments and trailing commas allowed | Bun also reads `tsconfig.json`, `package.json` and `bun.lock` this way ✅[^4]: a `package.json` with `//` and `/* */` comments and a trailing comma loaded through `require()`, and a `tsconfig.json` with them applied its `jsxFactory` ✅[^lab]; `with { type: "json" }` on a `.jsonc` file throws `SyntaxError: JSON Parse error: Unrecognized token '/'` |
| `.toml` | `toml` | parsed object (`{ kind: "toml", n: 3, server: { port: 8080 } }`) | `with { type: "toml" }` works on any extension |
| `.yaml`, `.yml` | `yaml` | parsed object | YAML 1.2: `on: push` gives the key `"on"`, not `true` ✅[^7]. Lab: the values `on`, `yes`, `no`, `off` and `y` came back as strings and `true` as a boolean, the same in `oven/bun:1.3.14` (the notes date this change to 1.3.5 ✅[^7]); `oven/bun:1.1.45` returned the file's path ✅[^lab] |
| `.json5` | `json5` | parsed object | unquoted keys, single quotes, comments |
| `.txt`, `.text` | `text` | the file as a string | `with { type: "text" }` on `.html` gives its source |
| `.md`, `.markdown` | `md` | rendered HTML: `"<h1>Title</h1>\n<p>Some <em>md</em>.</p>\n"` | |
| `.xml` | `xml` | parsed object: `{ user: { "@id": "1", name: "Ada", role: ["a", "b"] } }` | since 1.4.0; before, the path ✅[^7]: `oven/bun:1.3.14` returned `"/tmp/fx/mr/data.xml"` ✅[^lab] |
| `.css`, `.module.css` | `css` | `{}` | 1.4.0 changed plain `.css` from the path to `{}`; `.module.css` still differs from `bun build`, which emits a class map ✅[^7]. In `oven/bun:1.3.14` both imports returned the file's path; in `1.4.6-canary.1`, not in 1.4.5, `.module.css` returned a class map (`{ btn: "btn_5WBUVQ" }`) ✅[^lab] |
| `.html` | `html` | `HTMLBundle { index: "/w/page.html" }` | meant for `Bun.serve` routes → `bun/bundler/fullstack-dev-server-and-html.md` |
| any file + `with { type: "sqlite" }` | `sqlite` | an open `Database` (`db.query("select x from t").get()` → `{x: 42}`) | runtime and bundler, target `bun` only ✅[^4]. Lab: `bun build --target=bun` kept `import db from "./x.db" with { type: "sqlite" }` in the output; `--target=node` silently dropped the attribute, leaving a plain `import db from "./x.db"` ✅[^lab] |
| `.node` | `napi` | in 1.4.5 `import` throws `TypeError: To load Node-API modules, use require() or process.dlopen instead of import.` (static, dynamic and `with { type: "napi" }`, in the `bunlab:1` image); the same dynamic `import` threw the same error in `oven/bun:1.3.14`, `oven/bun:1.1.45` and `1.4.6-canary.1`, while `createRequire(...)("./addon.node")` loaded it in all four ✅[^lab] | the docs say add-ons can be imported directly ✅[^4]; use `require()`, `process.dlopen` or `createRequire` → `bun/system-apis/workers-ffi-and-native-code.md`; `require()` also finds `.node` without the extension (step 1) |
| `.sh` | Bun Shell | only as an entry: `bun s.sh` ran it | not importable as code ✅[^4]: `import v from "./s.sh"` gave the path string `"/tmp/m/s.sh"`, like the `file` loader, and ran nothing ✅[^lab] |
| anything else (`.svg`, `.wasm`, `.jsonl`, …) | `file` | absolute path: `"/w/logo.svg"`, `"/w/empty.wasm"` | `with { type: "file" }` forces it: on `a.b.ts` it gave `"/tmp/m/a.b.ts"` ✅[^lab]. As an entry file, an unknown extension runs as code: `bun g.weird` ran its `console.log` ✅[^lab] |

## Worked example
Ship TypeScript source to Bun and built JavaScript to everyone else from one local package, without publishing. Files ✅[^lab]:
```json
// node_modules/cond/package.json
{ "name": "cond", "version": "1.0.0",
  "exports": {
    ".": { "bun": "./src/index.ts", "node": "./dist/node.js", "import": "./dist/index.mjs",
           "require": "./dist/index.cjs", "default": "./dist/index.js" },
    "./feature": { "custom": "./dist/custom.js", "default": "./dist/feature.js" },
    "./package.json": "./package.json" } }
```
Runs, in `oven/bun:1.4.5` and `node:24.22.1-alpine` ✅[^lab]:

| Step | Command or import | Bun 1.4.5 | Node.js 24.22.1 |
|---|---|---|---|
| 1 | `import c from "cond"` | `src/index.ts`, a TypeScript file, runs as is | `dist/node.js` |
| 2 | `import f from "cond/feature"` | `dist/feature.js` (`default`) | — |
| 3 | `bun --conditions=custom` + step 2 | `dist/custom.js` | — |
| 4 | `await import("cond/dist/hidden.js")` | `ResolveMessage`: `Cannot find package 'cond' imported from /w/main.js` | — |
| 5 | `Bun.resolveSync("cond", "/w")` | `/w/node_modules/cond/src/index.ts` | — |

Step 1 is the point of the `"bun"` condition: Bun "imports and executes your TypeScript source files directly" ✅[^1]. Step 4 is blocked because `exports` lists no such subpath, but the message names the package, not the subpath.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `typeof module` anywhere in an ESM file | The file turns CJS and its `import` fails with `Cannot use import statement with CommonJS-only features` ✅[^lab] | The transpiler marks a file CJS when it sees `module` or `exports` ✅[^1] |
| `bun --help` says `--extension-order` defaults to `.tsx,.ts,.jsx,.js,.json` | Out of date; the observed orders are the four in step 1 ✅[^lab] ✅[^2]. The run-flags page gives a third default, `.tsx,.ts,.jsx,.cts,.cjs,.js,.mjs,.mts,.json,.node` ✅[^9], which is the observed `require()` order in your code ✅[^lab] | Help text not updated |
| `--extension-order` itself | Changes only the `require()` list for your code; `import` kept its order. One extension per flag: `--extension-order=.js` made `require("./eo/u")` pick `u.js` over `u.ts`, two flags `--extension-order=.js --extension-order=.ts` did too, and `--extension-order=.js,.ts` (one comma list) found nothing (`Cannot find module './eo/u'`) ✅[^lab] | The value is not split on commas, and the ESM list is separate |
| `"node"` listed before `"bun"` in `exports` | Bun loads the `node` entry ✅[^lab] | First matching key wins ✅[^1] |
| `import "."` inside `lib/run.ts` | Loads `lib/index.ts` (since 1.4.0), no longer a sibling `lib.ts` ✅[^7]; in the lab it printed `lib/index.ts` with `lib.ts` present, and `lib.ts` in `oven/bun:1.3.14` ✅[^lab] | Matches Node.js |
| Wildcard `exports` target with no such file | Retried with each known extension, or `.ts` for `.js` (since 1.4.0) ✅[^7]. Lab: `"./*": "./dist/*"` resolved `wc/server/stdio` to `dist/server/stdio.js`, and `"./typed/*": "./dist/*.js"` resolved `wc/typed/only` to `dist/only.ts`; `oven/bun:1.3.14` threw `Cannot find module 'wc/server/stdio'` and `'wc/typed/only'` ✅[^lab] | Makes subpaths like `@modelcontextprotocol/sdk/server/stdio` resolve |
| `?raw` suffix (`import t from "./data.toml?raw"`) | The file's text, also in `oven/bun:1.3.14`; `oven/bun:1.1.45` ignored the suffix and returned the parsed TOML ✅[^lab] | Works in 1.4.5 although the docs released with it list no import suffixes ✅[^1]; bun.com lists `?raw` ✅[^8] |
| `?url` and `?worker` suffixes | Ignored in 1.4.5: `./note.txt?url` gave the text, `./w.ts?url` and `?worker` threw `Missing 'default' export` ✅[^lab]. In `1.4.6-canary.1`, not in 1.4.5: `?url` gave the absolute path (`/w/w.ts`), and the `?worker` default export was a constructor (`WorkerWrapper`) whose instance was a `Worker` that answered a message ✅[^lab] | Documented on bun.com, not in 1.4.5 ✅[^8]; absent from the docs released with 1.4.5 ✅[^1] |
| `import.meta.glob(...)` | `TypeError: import.meta.glob is not a function` ✅[^lab]; in `1.4.6-canary.1`, `import.meta.glob("./*.toml")` returned an object keyed `"./data.toml"` ✅[^lab] | Documented on bun.com, not in 1.4.5 ✅[^8] |
| `.module.css` class names | `{}` at runtime ✅[^lab]; a class map in `1.4.6-canary.1` (loaders table) ✅[^lab] | Documented on bun.com, not in 1.4.5 ✅[^10]; the 1.4 notes say runtime `.module.css` still differs from `bun build` ✅[^7] |
| `with { type: "bogus" }` | Accepted without error ✅[^lab] | An unknown type is not rejected |
| Same specifier imported with and without an attribute | Each import is resolved with its own loader ✅[^lab] | — |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `tsconfig.json` `paths` | Editors and Bun agree, no build step | Node.js ignores them; a bundler or `#` imports are needed there |
| `package.json` `"imports"` (`#x`) | Works in Bun, Node.js and TypeScript | Must start with `#` |
| A `"bun"` export condition pointing at `.ts` | No build for Bun consumers | Node.js and bundlers still need built files; keep `"bun"` first |
| Importing `.toml`/`.yaml` directly | No parser dependency | Bun-only code; use `Bun.TOML.parse` or a library where portability matters |

## Takeaways
- Put `"bun"` first in a package's `exports` object if you ship a Bun-specific entry; the first matching key wins. [rule-candidate]
- Never `require()` a module that uses top-level `await`; use `await import()`. Bun tolerates an await that settles at once, Node.js never does. [rule-candidate]
- Write explicit `.ts` extensions or `#` imports in code that must also run on Node.js. [rule-candidate]
- Use `with { type: "toml" | "yaml" | "text" | "sqlite" }` to load a file whose extension does not say what it is.
- In Bun 1.4.5, do not rely on `?url`, `?worker`, `import.meta.glob` or CSS-module class maps at runtime, even though bun.com documents them; all four work in `1.4.6-canary.1`.

## Verification status
- Verified: 93 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the Node.js comparison ran in `node:24.22.1-alpine`. The `.node` runs used `bunlab:1` (the same Bun plus gcc) and a 9-line Node-API add-on written without headers. A later session (around midnight, 2026-11-24 to 25) ran one probe file unchanged in `oven/bun:1.1.45` (`1.1.45+196621f25`), `oven/bun:1.3.14` (`1.3.14+0d9b296af`), `oven/bun:1.4.5` and `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`). [^lab]
- [Module Resolution: docs/runtime/module-resolution.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/module-resolution.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: extension fallback and substitution, ESM/CJS interop and the CJS wrapper, top-level `await` and `require`, `exports` conditions and order, `--conditions`, `main`/`module`, `NODE_PATH`, built-in replacements, `paths` and `imports`, `import.meta`, the `"bun"` condition; it has no import-suffix or `import.meta.glob` section. [^1]
- [src/bundler/options.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/bundler/options.rs) — Bun source (Oven), 2026. Backs: the four extension orders, and `.node` appended to both `require()` lists for target `bun`. [^2]
- [Re-map import paths: docs/guides/runtime/tsconfig-paths.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/runtime/tsconfig-paths.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `tsconfig.json` `paths` rewrites imports. [^3]
- [File Types: docs/runtime/file-types.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/file-types.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: loader names and extensions, the `type` attribute, JSONC for config files, `sqlite` for target `bun`, `napi`, `sh`, `file`. [^4]
- [bunfig.toml: docs/runtime/bunfig.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/bunfig.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: the `[loader]` table. [^5]
- [Get the absolute path to the current entrypoint: docs/guides/util/main.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/util/main.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `Bun.main`. [^6]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Oven, 2026. Backs: YAML 1.2 booleans, `.xml` returns the parsed document, `.css` exports `{}` and `.module.css` differs from `bun build`, `import "."` as a directory, wildcard `exports` retries. [^7]
- [Module Resolution (live)](https://bun.com/docs/runtime/module-resolution) — Bun documentation (Oven), living. Backs: only the gap rows: import suffixes (`?raw`, `?url`, `?worker`) and `import.meta.glob`, documented on bun.com but not in 1.4.5. [^8]
- [File Types (live)](https://bun.com/docs/runtime/file-types) — Bun documentation (Oven), living. Backs: only the gap row: a class-name map for `.module.css` at runtime. [^10]
- [bun run CLI flags: docs/snippets/cli/run.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/snippets/cli/run.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: the `--loader` flag, the `--extension-order` default `.tsx,.ts,.jsx,.cts,.cjs,.js,.mjs,.mts,.json,.node`. [^9]

## Related
- `bun/fundamentals/running-code-and-transpilation.md` — transpiler, `tsconfig.json` fields, auto-install.
- `bun/bundler/bun-build.md` — the same loaders at bundle time.
- `bun/bundler/fullstack-dev-server-and-html.md` — HTML imports.
- `bun/system-apis/sqlite-and-sql.md` — the `Database` an `sqlite` import returns.
- `bun/package-manager/linkers-hoisted-and-isolated.md` — the `node_modules` layout the resolver walks.
- `js-runtime/subpath-imports.md` — `#` imports versus `paths`.
- `javascript/modules/es-modules.md` — ES modules in the language.
- `linux/lab-setup.md` — the lab.
