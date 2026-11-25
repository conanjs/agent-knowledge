---
schema: knowledge-doc/v1
type: concept
topic: bun/bundler
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, bundler, bun-build, tree-shaking, splitting, minify, sourcemap, env-inlining, define, build-artifact, esbuild]
---

# Bun's bundler: `Bun.build` and `bun build`

## Summary
**TL;DR:** Bun's bundler starts at the entrypoints, follows every import, transpiles TypeScript and JSX, drops code nothing uses, and writes one output per entrypoint plus shared chunks and copied assets. The same options exist as `Bun.build({...})` (JavaScript) and `bun build` flags (CLI, the command-line interface). `target` picks the export condition (`browser`, `bun` or `node`) and, for `bun`, adds a `// @bun` pragma; the default format is ES modules. A failed `Bun.build` rejects with an `AggregateError` unless `throw: false`, which returns `success: false`. Measured: a small zod app went from 112,523 to 58,651 bytes with `minify: true`.
**Use this when:** writing a build script or `bun build` command, choosing target, format, splitting, naming, sourcemaps or minification, inlining build-time values, or reading what `Bun.build` returns and how it fails.
**Not this doc:** plugins and macros → [plugins-and-macros.md](plugins-and-macros.md); `--compile` executables → [single-file-executables.md](single-file-executables.md); HTML entrypoints, the dev server and CSS bundling → [fullstack-dev-server-and-html.md](fullstack-dev-server-and-html.md); the table of file types and loaders → `bun/fundamentals/module-resolution-and-loaders.md`.

## Problem
A browser cannot run `.ts` files or resolve `import "zod"`, and loading hundreds of small modules one request at a time is slow. A bundler fixes both, but its defaults surprise people: `env: "inline"` copies every environment variable, secrets included, into code shipped to browsers; a build script that checks `result.success` never sees `false`, because by default a failure rejects the promise instead; `Bun.build` without `outdir` writes nothing to disk; and options copied from esbuild (`--platform`, `--bundle`, the `dataurl` loader) do not mean the same thing in Bun.

## Mental model
**Analogy:** a bundler binds a book from loose manuscript pages. It starts at the table of contents (the entrypoints), follows every "see chapter X" note (the imports), translates pages written in another language (TypeScript, JSX), leaves out pages no one refers to (tree shaking, which removes unused code), and binds one volume per entrypoint. Pages that two volumes share can go into a separate appendix (a chunk), and pictures are copied as plates with a fingerprint in their name (hashed assets).

**Artifact:** the same build in both forms, and what it returned in the lab ✅[^lab]:
```ts
// build.ts                                   // CLI equivalent:
const r = await Bun.build({                   // bun build ./src/index.ts --outdir ./out
  entrypoints: ["./src/index.ts"],            //   (without --outdir the CLI prints
  define: { DEBUG: "false" },                 //    a single output file to stdout)
});
// r.success === true, r.logs.length === 0, and r.outputs holds three BuildArtifacts:
// { kind: "entry-point", path: "./index.js",         loader: "ts",   hash: "yb4dr4f1", size: 436 }
// { kind: "asset",       path: "./index.css",        loader: "ts",   hash: "pymjtmpb", size: 75 }
// { kind: "asset",       path: "./logo-bdgb9ace.svg", loader: "file", hash: "bdgb9ace", size: 62 }
```
`src/index.ts` imported a helper module, `./logo.svg`, `./notes.txt`, `./style.css` and a package; the bundle kept only the helper function it called.

## How it works
Five actors take part in one build:
- **Your build script or shell** — its job: name the entrypoints and options, via `Bun.build({...})` or `bun build` flags.
- **The resolver** — its job: find the file behind each import string, via relative paths and the `exports` conditions that `target` selects.
- **The loaders** — its job: turn each file into a module, via the loader that the file extension (or a `loader` override) picks.
- **The linker** — its job: connect the modules and drop unused code, via the import graph.
- **The emitter** — its job: write the outputs and report them, via the `naming` templates and the returned `BuildOutput`.

```
Bun.build / bun build
   │ entrypoints + options
   ▼
resolver ──► loaders (ts, tsx, css, text, file …) ──► linker (tree shaking, define/env/drop,
   ▲              │                                     splitting into chunks)
   └── each import found while parsing                        │
                                                              ▼
                                       emitter: entry files, chunks, assets, sourcemaps
                                       (naming templates) ──► disk (outdir) or memory
                                                              │
                                                              ▼
                                       BuildOutput { success, outputs[], logs[] }
```

1. **Your script → bundler (in-process, no network):**
   - `Bun.build()` returns a `Promise<BuildOutput>`; `bun build` takes the same options as flags ✅[^1].
   - Without `outdir`, `Bun.build` writes nothing and returns the files in memory as `BuildArtifact` objects; with `outdir`, each artifact's `path` is the absolute path written ✅[^1] ✅[^lab].
2. **Resolver:**
   - `target: "browser"` (the default) prefers the `"browser"` export condition, `"node"` prefers `"node"`, and `"bun"` prefers `"bun"` ✅[^1]. Measured with a local package exporting all four conditions: `picked:browser`, `picked:node`, `picked:bun` ✅[^lab].
   - With `external` (or `packages: "external"` for every import that does not start with `.`, `..` or `/`), the import statement stays in the output for the runtime to resolve ✅[^1] ✅[^lab].
3. **Loaders:** the extension picks the loader; the loaders table lives in `bun/fundamentals/module-resolution-and-loaders.md`. What only the bundler does with them:
   - `file` (any unknown extension, such as `.svg`): the file is copied into `outdir` under `naming.asset`, default `[name]-[hash].[ext]`, and the import becomes its path: `var logo_default = "./logo-bdgb9ace.svg"` ✅[^1] ✅[^lab]. `publicPath: "https://static.example/"` turned it into `"https://static.example/logo-bdgb9ace.svg"` ✅[^lab].
   - `text` (`.txt`): the contents are inlined as a string, `var notes_default = "hello from notes"` ✅[^2] ✅[^lab].
   - `css` imported from JavaScript: every CSS file an entrypoint imports is merged into one `.css` file named after the entrypoint (`index.css`) ✅[^2] ✅[^lab].
4. **Linker:**
   - Tree shaking is on by default; the unused export `unused()` was absent from every target's output ✅[^3] ✅[^lab].
   - `define` replaces global identifiers or dotted paths with the given JSON or identifier text, `env` replaces `process.env.X` with the variable's value, and `drop` removes calls such as `console.*` and `debugger` statements together with their arguments ✅[^1].
   - With `splitting: true`, code that several entrypoints share goes into a chunk, and each `import()` gets its own chunk ✅[^1].
5. **Emitter:**
   - `target: "bun"` output starts with `// @bun`, which tells the runtime it need not transpile the file again; with `format: "cjs"` it is `// @bun @bun-cjs`, a wrapper Node.js cannot run ✅[^1] ✅[^lab]: Node 24 loaded such a file without an error, but its exports were `{}` (Edge cases) ✅[^lab].
   - An entrypoint with a `#!/usr/bin/env bun` shebang makes `bun` the default target ✅[^1]; the lab output kept the shebang and then `// @bun` ✅[^lab].
   - `banner` and `footer` add text at the top and bottom of JavaScript bundles ✅[^1] ✅[^3]. Built together with `--banner "/* BANNER */"`, the JavaScript entry started with the banner and the CSS entry `s.css` did not ✅[^lab].

### The options, side by side
| `Bun.build` option | `bun build` flag | Default | What it did in the lab |
|---|---|---|---|
| `entrypoints` | positional paths | required | One output per entrypoint ✅[^1] |
| `outdir` | `--outdir` (or `--outfile` for a single output) | none (memory) | Without it: `outputs` only, nothing on disk; `--outfile out.js` wrote one file ✅[^lab] |
| `target` | `--target` | `browser` | Export condition and `// @bun` pragma (above) ✅[^lab] |
| `format` | `--format` | `esm` (`cjs`, `iife` experimental) | `cjs` added a `__toCommonJS` helper and `module.exports = …`; `iife` wrapped the code in `(() => { … })();` ✅[^1] ✅[^lab] |
| `splitting` | `--splitting` | `false` | Two entries sharing `shared.ts` gave `chunk-zyt4bsq3.js` plus `chunk-wd10dt4x.js` for an `import()` ✅[^lab] |
| `naming` (string or `{entry, chunk, asset}`) | `--entry-naming`, `--chunk-naming`, `--asset-naming` | `[dir]/[name].[ext]`, `[name]-[hash].[ext]`, `[name]-[hash].[ext]` | `--entry-naming "[dir]/[name]-[hash].[ext]"` wrote `entry-a-y2gpxdt9.js` ✅[^1] ✅[^lab] |
| `external` | `--external` (repeat; `'*'` for all) | `[]` | `import which from "cond-pkg"` kept as is ✅[^lab] |
| `packages` | `--packages` | `bundle` | `external` kept every package import ✅[^lab] |
| `sourcemap` | `--sourcemap[=…]` | `none` | `linked`: `lib.js.map` plus `//# sourceMappingURL=lib.js.map`; `external`: the map plus `//# debugId=…`; `inline`: a base64 `data:` URL; the bare flag meant `linked` ✅[^1] ✅[^lab] |
| `minify` (`true` or `{whitespace, syntax, identifiers}`) | `--minify`, `--minify-whitespace`, `--minify-syntax`, `--minify-identifiers` | `false` | Sizes in the Worked example ✅[^4] ✅[^lab] |
| `define` | `--define K=V` | none | `DEBUG: "true"` turned `if (DEBUG)` into `if (true)` ✅[^lab] |
| `env` | `--env` | none | `"PUBLIC_*"` inlined only `PUBLIC_URL`; `"inline"` also inlined `SECRET` ✅[^1] ✅[^lab] |
| `drop` | `--drop` | none | `["console", "debugger"]` removed both ✅[^lab] |
| `banner` / `footer` | `--banner` / `--footer` | none | `"use client";` on the first line, the footer comment last ✅[^lab] |
| `publicPath` | `--public-path` | none | Prefix on asset, chunk and external paths ✅[^1] ✅[^lab] |
| `root` | `--root` | common ancestor of the entrypoints | `pages/a.ts`, `pages/b.ts` gave `a.js, b.js`; `root: "."` gave `pages/a.js, pages/b.js` ✅[^1] ✅[^lab] |
| `loader` | `--loader .ext:loader` | by extension | `{ ".txt": "file" }` copied `notes-w8eez4tb.txt` ✅[^lab] |
| `throw` | none | `true` | See below ✅[^5] |

`--production` sets `NODE_ENV=production` and turns on minification: `process.env.NODE_ENV` became `"production"` in a minified one-liner ✅[^lab].

### What a build returns, and how it fails
- `BuildOutput` has `success`, `outputs` and `logs`; each `BuildArtifact` has `kind` (`entry-point`, `chunk`, `asset`, `sourcemap` or `bytecode`), `path`, `loader`, `hash` and `sourcemap` ✅[^1] ✅[^5]. A `target: "bun", format: "cjs", bytecode: true` build returned `entry-point` `cjs.js` and `bytecode` `cjs.js.jsc` ✅[^lab].
- `console.log(artifact)` pretty-prints it; with `outdir` the lab showed a `FileRef ("/w/out-map/lib.js")` and the linked sourcemap artifact nested inside ✅[^lab].
- `new Response(artifact)` set `content-type: text/javascript;charset=utf-8` ✅[^lab].
- **Default (`throw: true`):** a missing import made `Bun.build` reject with an `AggregateError` holding one `ResolveMessage`: message `Could not resolve: "./does-not-exist.ts"`, `code: "ERR_MODULE_NOT_FOUND"`, `specifier: "./does-not-exist.ts"`, `level: "error"` ✅[^1] ✅[^lab].
- **`throw: false`:** the same build resolved to `{ success: false, outputs: [], logs: [ResolveMessage] }` ✅[^5] ✅[^lab].
- **CLI:** `bun build` printed the error with a code frame and exited with code 1 ✅[^lab].

### Coming from esbuild
Bun's options follow esbuild's, with these differences ✅[^3]:
- Bun always bundles: there is no `--bundle`, and `--no-bundle` turns bundling off. `bun build --help` does not list `--bundle`, yet passing it gave no error ✅[^lab].
- `--platform` is `--target`, without `neutral`; esbuild's `--target` (syntax down-levelling) does not exist, because Bun does not rewrite new syntax for old engines. Lab: `--platform=bun` was accepted and ignored (no `// @bun` line), and `--target=es2020` failed with `error: Invalid Argument ''` ✅[^lab].
- Loaders use `--loader .ext:loader`; the esbuild loaders `dataurl`, `binary`, `base64`, `copy` and `empty` are not implemented. Lab: `binary`, `copy` and `empty` failed with `error: invalid loader "binary", expected one of: …`, while `dataurl` and `base64` built and emitted `""` ✅[^lab].
- `naming` templates must include `[ext]`; esbuild's `--entry-names` and `--outbase` are `--entry-naming` and `--root`. Lab: `--entry-naming "[dir]/[name]"` wrote a file called `app`, without an extension and without a warning; `--entry-names="[name]-EN.[ext]"` and `--outbase=sub` were accepted and ignored ✅[^lab].
- Plugins get `onStart`, `onEnd`, `onResolve` and `onLoad`, but not `onDispose` or `resolve` (hooks by place: [plugins-and-macros.md](plugins-and-macros.md)).

## Worked example
A small app validates two inputs with zod 3.25.76 (11 modules after bundling) ✅[^lab]:
```ts
// app.ts
import { z } from "zod";
const User = z.object({ name: z.string().min(1), age: z.number().int().nonnegative(), email: z.string().email() });
export function parseUser(input: unknown) {
  const result = User.safeParse(input);
  return result.success ? `ok: ${result.data.name}` : `invalid: ${result.error.issues.length} issue(s)`;
}
console.log(parseUser({ name: "Ada", age: 36, email: "ada@example.com" }));
console.log(parseUser({ name: "", age: -1, email: "nope" }));
```
1. `bun build ./app.ts --outfile out.js` → `out.js 112.52 KB (entry point)`; `bun out.js` printed `ok: Ada` and `invalid: 3 issue(s)` ✅[^lab].
2. `bun build ./app.ts --minify --outfile out.min.js` → `58.65 KB`, same two lines when run ✅[^lab].
3. Each minify mode alone, measured with `Bun.build({ target: "browser", minify })` and `Bun.gzipSync` on the output ✅[^lab]:

| `minify` | Bytes | Gzip bytes | Bytes vs none |
|---|---|---|---|
| `false` | 112,523 | 17,667 | 100% |
| `{ whitespace: true }` | 83,092 | 15,577 | 73.8% |
| `{ syntax: true }` | 105,236 | 17,313 | 93.5% |
| `{ identifiers: true }` | 90,742 | 15,772 | 80.6% |
| `true` (all three) | 58,651 | 13,385 | 52.1% (58,651 / 112,523) |

The three modes combine: whitespace removal deletes spaces and newlines, syntax minification rewrites code into shorter equivalents (`true` → `!0`, constant folding, dead branches removed), and identifier minification renames local variables ✅[^4]. Measured after gzip, the saving shrinks from 48% (1 − 58,651 / 112,523) to 24% (1 − 13,385 / 17,667), so compare minified sizes gzipped when the files are served compressed.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `await artifact.bytes()` | `TypeError: … bytes is not a function`; `artifact instanceof Blob` was `false`; `arrayBuffer()` and `text()` work ✅[^lab]. The same in `1.4.6-canary.1` (the `oven/bun:canary` preview of the next release) ✅[^lab] | The docs and `bun.d.ts` say `BuildArtifact extends Blob` and show `bytes()` ✅[^1] ✅[^5]; in 1.4.5 it is a Blob-like object without `bytes()`. Use `new Uint8Array(await a.arrayBuffer())` |
| `loader: { ".svg": "dataurl" }` | Build succeeded, and the import became `""` (an empty string) ✅[^lab]; `base64` did the same, while `binary`, `copy` and `empty` failed with `invalid loader` ✅[^lab]. `1.4.6-canary.1` also emitted `""` for `dataurl` ✅[^lab] | `dataurl` is one of the esbuild loaders Bun does not implement ✅[^3], although the bundler page uses it in an example ✅[^1]; nothing warns |
| esbuild flags `--bundle`, `--platform`, `--entry-names`, `--outbase` | Accepted without an error and ignored: `--platform=bun` gave no `// @bun` line, `--entry-names="[name]-EN.[ext]"` still wrote `app.js` ✅[^lab] | Not in `bun build --help` ✅[^lab]; an esbuild command line copied over runs but does not do what it says. Use `--target`, `--entry-naming` and `--root` ✅[^3] |
| `--entry-naming "[dir]/[name]"` (no `[ext]`) | Wrote `app` with no extension, no warning ✅[^lab] | The docs require `[ext]` ✅[^3]; 1.4.5 does not check it |
| Setting `process.env.X` inside the build script, then `env: "inline"` | Not inlined: the output kept `process.env.PUBLIC_URL` ✅[^lab] | Only variables present when the process started were inlined in this test; pass them in the shell (`PUBLIC_URL=… bun build.ts`) or use `define` |
| `drop: ["console"]` plus `minify.syntax` | Whole `console.log(...)` lines vanished, and so did a helper used only inside them ✅[^lab] | Arguments of dropped calls are removed even with side effects ✅[^1], so tree shaking then finds the helper unused |
| `bun build ./css-runtime.ts --target=bun` with no `--outdir`, where the entry imports two CSS files | `error: cannot write multiple output files without an output directory` ✅[^lab] | The CLI prints to stdout only when the build has one output file; pass `--outdir` |
| Same splitting build from the CLI and the API | API: `chunk-<hash>.js`; CLI: `entry-a-<hash>.js` and `lazy-<hash>.js` ✅[^1] ✅[^lab] | The CLI names a chunk after a module in it; set `--chunk-naming` to make both the same |
| CSS artifact metadata | `kind: "asset"`, `loader: "ts"` for `index.css` ✅[^lab] | Observed in 1.4.5; filter CSS by `path.endsWith(".css")`, not by `loader` |
| `format: "cjs"` with `target: "bun"` | `// @bun @bun-cjs` and a `(function(exports, require, module, __filename, __dirname) {` wrapper ✅[^lab]; Node 24's `require()` of that file returned `{}` without an error, and the same module built with `target: "node"` returned `answer` 42 and `hi()` ✅[^lab] | Bun-only wrapper: Node evaluates the function expression but never calls it; use `target: "node"` for CommonJS that Node.js runs ✅[^1] |
| `dts: true` / `--dts`: documented on bun.com, not in 1.4.5 | Accepted silently; only `lib.js` was written, no `.d.ts` ✅[^lab]. Present in `1.4.6-canary.1`, not in 1.4.5: both forms also wrote `lib.d.ts` (listed as `(declaration)`, holding `export declare function greet(u: User): string;`) and `lib.aot.ts` (`(aot source)`: the bundle with its TypeScript types kept) ✅[^lab] | The live `bun.com/docs/bundler` page documents `dts`, with both files, for a newer release ✅[^6]; the 1.4.5 docs at the release tag do not mention it ✅[^1]; use `tsc` for declarations in 1.4.5 |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `minify: true` | 48% smaller here (24% after gzip) | Unreadable output; add `sourcemap` for stack traces |
| `splitting: true` | Shared code downloaded once, lazy `import()` chunks | More files and requests; output names carry hashes |
| `packages: "external"` | Small server bundles, `node_modules` stays authoritative | The deploy target must install the same packages |
| `env: "PUBLIC_*"` vs `"inline"` | Prefix inlines only values meant to be public | `"inline"` copies every variable, secrets included, into the output |
| `throw: false` | One code path that checks `success` and `logs` | A forgotten check ships nothing without an exception |

## Takeaways
- Use `env: "PUBLIC_*"` (or another prefix) for browser builds, never `env: "inline"`. [rule-candidate]
- Either keep the default `throw: true` and `try`/`catch` the `AggregateError`, or pass `throw: false` and check `result.success`; do not mix the two. [rule-candidate]
- Read artifact bytes with `arrayBuffer()` or `text()`: `BuildArtifact.bytes()` does not exist in 1.4.5.
- Do not use esbuild-only loaders: in Bun 1.4.5 `dataurl` and `base64` do not fail but emit an empty string, and `binary`, `copy` and `empty` fail the build. [rule-candidate]
- Pass build-time environment variables in the shell that starts the build, not by assigning `process.env` inside the build script.

## Verification status
- Verified: 101 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the CommonJS outputs were loaded by Node.js 24.22.1 in `node:24.22.1-alpine`; `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`) ran the checks of the next build. [^lab]
- [docs/bundler/index.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/index.mdx) — Bun documentation source at the release tag, 2026. Backs: `Bun.build`/CLI forms, outdir and in-memory outputs, targets and the `// @bun` pragma, shebang default, formats, splitting, naming tokens and defaults, external and packages, sourcemap modes, define, env, drop, banner/footer, publicPath, root, `BuildOutput`/`BuildArtifact` and `bytes()`, `AggregateError` on failure, the `dataurl` example, no `dts` option. [^1]
- [docs/bundler/loaders.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/loaders.mdx) — Bun documentation source at the release tag, 2026. Backs: `text` inlining, CSS merged per entrypoint. [^2]
- [docs/bundler/esbuild.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/esbuild.mdx) — Bun documentation source at the release tag, 2026. Backs: migration differences, tree shaking on, banner/footer only for JS, loaders not implemented, plugin hooks. [^3]
- [docs/bundler/minifier.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/bundler/minifier.mdx) — Bun documentation source at the release tag, 2026. Backs: the three minify modes and what each rewrites. [^4]
- [packages/bun-types/bun.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/bun.d.ts) — Bun source, 2026. Backs: `throw` option (default `true`, `false` returns `success: false`), `BuildArtifact extends Blob`, `BuildOutput` fields. [^5]
- [Bundler](https://bun.com/docs/bundler) — Bun documentation, living (read 2026-11-24; describes a release newer than 1.4.5). Backs: only the `dts` gap row in Edge cases. [^6]

## Related
- `bun/bundler/plugins-and-macros.md` — extend the bundler with plugins, run code at bundle time with macros.
- `bun/bundler/single-file-executables.md` — `--compile`, bytecode, embedded files.
- `bun/bundler/fullstack-dev-server-and-html.md` — HTML entrypoints, CSS bundling, the dev server.
- `bun/fundamentals/module-resolution-and-loaders.md` — the loaders table, export conditions, import attributes.
- `bun/fundamentals/configuration-and-environment.md` — where environment variables come from (`.env`, `Bun.env`).
- `javascript/modules/es-modules.md` — the module format the bundler emits by default.
