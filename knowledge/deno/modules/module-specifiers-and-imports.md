---
schema: knowledge-doc/v1
type: concept
topic: deno/modules
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, modules, esm, specifiers, jsr, npm, node-builtins, import-map, scopes, import-attributes, dynamic-import, import-meta-resolve]
ranked-sources: true
---

# Deno module specifiers, import maps and import attributes

## Summary
**TL;DR:** Deno loads ES modules (ECMAScript modules, the standard `import`/`export` system) by **specifier**, the string after `from`: a relative path with its full extension (`./calc.ts`, never `./calc`), a package prefix (`jsr:`, `npm:`, `node:`), a URL (uniform resource locator: `https:`, `http:`, `file:`), or a bare name such as `chalk` that works only once `imports` in `deno.json` (or a `package.json` dependency) maps it, with `scopes` giving one folder its own mappings. Non-code files need an import attribute (`with { type: "json" }` or `"text"`; `"bytes"` is still unstable). A dynamic `import()` whose specifier Deno cannot work out before the run is checked against `--allow-read` / `--allow-import` when it runs.
**Use this when:** an import fails with `Module not found`, `not a dependency and not in import map` or `Expected a JavaScript or TypeScript module`; you choose between `jsr:`, `npm:` and an `https:` URL; you want short import names or a per-folder override; you load modules with `import()`.
**Not this doc:** adding, locking, caching and vendoring packages → `deno/modules/dependency-management.md`; how the module graph is built, fetched and type-checked → `deno/internals/module-loading-and-type-checking.md`; what `--allow-import` grants → `deno/security/permission-flags.md`; CommonJS and npm package behaviour → `deno/node-compat/node-and-npm-compatibility.md`; every `deno.json` key → `deno/configuration/deno-json-reference.md`; the other `import.meta` fields → `deno/runtime-apis/files-processes-and-environment.md`; sloppy imports and every other `--unstable-*` flag → `deno/releases-stability-and-support.md`.

## Problem
Code written for Node.js or a bundler imports `./calc` and `chalk`, reads `config.json` with a plain `import`, and builds plugin paths at run time. In Deno each of these fails at load time, each with a different message, and the tempting fixes (a sloppy-imports flag, `--allow-all`) hide the rule that was broken. A quieter trap: once `scopes` is in use, the same bare name loads a different module depending on which folder imports it.

## Mental model
**Analogy:** a specifier is a delivery address and Deno is a courier that never guesses. A street without a house number (`./calc`) is refused. A nickname (`chalk`) works only if your address book (`imports`) lists it. The prefix (`jsr:`, `npm:`, `node:`, `https:`) names the delivery network. `scopes` is a second address book that only one neighbourhood (folder) uses. An import attribute is the label on the parcel: "this box holds JSON (JavaScript Object Notation) data, not code".

**Artifact:** the main kinds of specifier and the URL `import.meta.resolve()` returned for each in Deno 2.9.8, with the `deno.json` of the worked example ✅[^run].

| Kind | Specifier | Resolved to |
|---|---|---|
| Relative | `./data.json` | `file:///lab/data.json` |
| Bare, mapped to `jsr:` | `@std/path` (`"jsr:@std/path@^1"`) | `https://jsr.io/@std/path/1.1.6/mod.ts` |
| Bare, mapped to `npm:` | `chalk` (`"npm:chalk@^5"`) | `file:///deno-dir/npm/registry.npmjs.org/chalk/5.6.2/source/index.js` |
| Bare, mapped to a file | `greet` (`"./lib/greet-v2.ts"`) | `file:///lab/lib/greet-v2.ts` |
| `node:` built-in | `node:fs` | `node:fs` |

## How it works
**4 actors:**
- **Your module** — its job: name each dependency, via a specifier string in `import`, `export … from` or `import()`.
- **Deno's resolver** — its job: turn the specifier into one absolute URL, via `scopes` and `imports` in `deno.json` (or `package.json` dependencies) and the specifier's prefix.
- **Deno's loader** — its job: get the source and its module type for that URL, via the local disk, the global cache or the network.
- **V8** — its job: link the imports to the exports and run the module, via ES module linking.

```
your module           resolver (local)                    loader                           V8
import … from "S" ─▶ 1. scopes[folder of importer]["S"]?
                     2. imports["S"]?  ("S/sub" too)
                     3. relative / file: / https: → join to importer URL
                        jsr: / npm: / node: → package or built-in
                        bare built-in name → node:
                        anything else → error
                              │ absolute URL
                              ▼
                                                 file:      → read from disk
                                                 jsr:/npm:/https: → global cache,
                                                 ═══ network on a miss: "Download …" ═══
                                                 type vs attribute (json/text/bytes)
                                                              │ source + type
                                                              ▼
                                                                              link names, evaluate
```

1. **Resolver (local), map lookup.**
   - Checks the `scopes` entry whose path prefix matches the importing module, then `imports` ✅[^denojson]. In the lab, `greet` gave `v2` in `main.ts` and `v1` in `./legacy/old.ts` ✅[^run].
   - A `deno.json` entry also covers the package's subpaths: `"@std/path": "jsr:@std/path@^1"` makes `@std/path/basename` work, and `"lodash-es": "npm:lodash-es@^4"` makes `lodash-es/debounce.js` work ✅[^modules] ✅[^run].
2. **Resolver (local), relative and URL specifiers.** A relative path is joined to the importing module's URL, with no extension guessing: "local import specifiers must always include the full file extension" ✅[^modules]. For `import { add } from "./calc"` Deno 2.9.8 prints `error: Module not found "file:///lab/calc". Maybe add a '.ts' extension or run with --sloppy-imports`, exit code 1 ✅[^run]. `file:`, `https:`, `http:` and `data:` specifiers are already absolute; a `data:application/typescript,…` module ran and printed `42` ✅[^run] ✅[^modules].
3. **Resolver (local), prefixes and bare names.**
   - `jsr:@scope/name@<constraint>[/<entrypoint>]` names a package on JSR (the JavaScript Registry) and one of its exported entrypoints ✅[^jsr]; it resolves to a file under `https://jsr.io/` of the highest matching version old enough for the minimum package age ✅[^run].
   - `npm:<package-name>[@<version-requirement>][/<sub-path>]` names an npm package ✅[^node]; `npm:lodash-es@4.17.21/camelCase.js` loaded one file of the package ✅[^run].
   - `node:<name>` is a Node.js built-in. Since 2.9 a bare built-in name (`os`) resolves to it too, unless `imports` or `package.json` maps that name ✅[^node]; `import os from "os"` ran without a flag ✅[^run].
   - Any other bare name fails: `error: Import "not-mapped" not a dependency and not in import map from "file:///lab/bare.ts"` with ``hint: If you want to use the npm package, try running `deno add npm:not-mapped` `` ✅[^run]. In a folder with no config file the message stops at `Import "not-mapped" not a dependency`, with the same hint ✅[^run].
4. **Loader (local, then network).** A `file:` module is read from disk. A `jsr:`, `npm:` or `https:` module comes from the global cache; on a miss Deno downloads it (lines such as `Download https://jsr.io/@std/path/1.1.6/mod.ts`) — the only step that leaves the machine ✅[^run]. Where the cache lives and how the lockfile pins it: `deno/modules/dependency-management.md`.
5. **Loader (local), module type.** A file that is not JavaScript or TypeScript loads only when the import declares its type ✅[^modules].

   | Import | Deno 2.9.8 result ✅[^run] |
   |---|---|
   | `import data from "./data.json"` | `error: Expected a JavaScript or TypeScript module, but identified a Json module. Consider importing Json modules with an import attribute with the type of "json".` |
   | `… "./data.json" with { type: "json" }` | the parsed object (`data.n` → `3`) |
   | `… "./note.txt" with { type: "text" }` | the string `"hello text\n"`; stable since 2.8 ✅[^v28] |
   | `… "./note.txt" with { type: "bytes" }` | `error: The import attribute type of "bytes" is unsupported.` with `hint: run with --unstable-raw-imports`; with the flag, a `Uint8Array` of 11 bytes ✅[^modules] |
   | `await import("./data.json", { with: { type: "json" } })` | `default.n` → `3` |
6. **Loader (at run time), dynamic `import()`.**
   - A string-literal specifier "is part of the static module graph and loads without extra permissions" ✅[^modules].
   - A computed one is checked when it runs: local paths need `--allow-read`, remote URLs `--allow-import` ✅[^modules]. `import(["./lib", "add.ts"].join("/"))` threw `TypeError: Requires read access to "/lab/lib/add.ts", run again with the --allow-read flag`, and `deno info` listed `dependencies: 0 unique` for that file ✅[^run].
7. **V8, link and evaluate.** Named imports are matched to exports before any code runs: `import { posix } from "jsr:@std/path@^1"` fails with `SyntaxError: The requested module 'jsr:@std/path@^1' does not provide an export named 'posix'`, because `posix` is its own entrypoint (`jsr:@std/path@^1/posix`) ✅[^run].
8. **`import.meta.resolve(specifier)`** applies the resolver's rules (steps 1–3) and returns the URL as a string ✅[^modules]; for an unmapped name it throws `TypeError: Import "not-mapped" not a dependency and not in import map from "file:///lab/resolve.ts"` ✅[^run].

## Worked example
One project that uses every specifier kind, run with `deno run -q -E main.ts` in a fresh container ✅[^run]. `deno.json`:
```json
{
  "imports": {
    "@std/path": "jsr:@std/path@^1",
    "chalk": "npm:chalk@^5",
    "lodash-es": "npm:lodash-es@^4",
    "greet": "./lib/greet-v2.ts"
  },
  "scopes": {
    "./legacy/": { "greet": "./lib/greet-v1.ts" }
  }
}
```
`legacy/old.ts` is `import { greet } from "greet"; export const fromLegacy = greet();`. `main.ts`:
```ts
import { join } from "@std/path";                      // bare → imports → jsr:
import { basename } from "@std/path/basename";         // subpath of the same entry
import * as posix from "jsr:@std/path@^1/posix";       // inline jsr: with entrypoint
import chalk from "chalk";                             // bare → imports → npm:
import debounce from "lodash-es/debounce.js";          // subpath of an npm entry
import camel from "npm:lodash-es@4.17.21/camelCase.js"; // inline npm: version + subpath
import { sep } from "node:path";                       // node: built-in
import os from "os";                                   // bare built-in name (2.9)
import { add } from "file:///lab/lib/add.ts";          // file: URL
import { greet } from "greet";                         // root mapping
import { fromLegacy } from "./legacy/old.ts";          // scoped mapping inside
import data from "./data.json" with { type: "json" };  // import attribute

console.log(join("a", "b"), basename("/x/y.ts"), posix.join("p", "q"));
console.log(typeof chalk.red, typeof debounce, camel("hello world"));
console.log(sep, typeof os.platform, add(1, 2), data.n);
console.log("root:", greet(), "| legacy:", fromLegacy);
for (const s of ["./data.json", "@std/path", "chalk", "node:fs", "greet"]) {
  console.log(s, "→", import.meta.resolve(s));
}
```
Output (exit code 0):
```text
a/b y.ts p/q
function function helloWorld
/ function 3 3
root: v2 | legacy: v1
./data.json → file:///lab/data.json
@std/path → https://jsr.io/@std/path/1.1.6/mod.ts
chalk → file:///deno-dir/npm/registry.npmjs.org/chalk/5.6.2/source/index.js
node:fs → node:fs
greet → file:///lab/lib/greet-v2.ts
```
- The ranges `^1`, `^5` and `^4` resolved to `@std/path` 1.1.6, `chalk` 5.6.2 and `lodash-es` 4.17.21 (the version the inline `npm:lodash-es@4.17.21` import requires; see Edge cases), and Deno wrote them to a new `deno.lock` (`"version": "5"`).
- `deno info main.ts` counted `dependencies: 85 unique` for these 20 lines: the files of `@std/path` 1.1.6 and its dependency `@std/internal` 1.0.14, plus the npm packages.
- Without `-E` the same run stops at `error: Uncaught (in promise) NotCapable: Requires env access to "TF_BUILD", run again with the --allow-env flag`: chalk reads environment variables when it loads, and permissions apply to code inside npm packages too.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `import "./calc.js"` when only `calc.ts` exists | `error: Module not found "file:///lab/calc.js". Maybe change the extension to '.ts' or run with --sloppy-imports` ✅[^run] | No extension rewriting. `--sloppy-imports`, `--unstable-sloppy-imports` and `DENO_COMPAT=1` each made the import work, and neither flag appears in `deno run --help` ✅[^run]; their status: `deno/releases-stability-and-support.md` |
| An import map file (`"importMap": "./import_map.json"` or `--import-map`) with only `"lodash-es": "npm:lodash-es@^4"` | `lodash-es/debounce.js` fails with `not a dependency and not in import map`; adding `"lodash-es/": "npm:/lodash-es@^4/"` fixes it ✅[^run] | A standalone import map follows the standard, which needs a second entry with a trailing `/`; `imports` in `deno.json` extends the standard ✅[^modules] |
| A template literal with a fixed prefix, `` import(`./lib/${name}.ts`) `` | Ran without `--allow-read`; `deno info` listed every `.ts` file in `./lib/` as a dependency ✅[^run] | Deno expanded the fixed prefix into the matching files and put them in the static graph. The docs name only string literals and computed specifiers ✅[^modules] |
| Static `https:`/`http:` import from a host outside the default list | `error: Requires import access to "127.0.0.1:4873", run again with the --allow-import flag`, exit code 1; with `--allow-import=127.0.0.1:4873` it loaded ✅[^run] | `deno run --help` gives `--allow-import` a default value: `deno.land:443`, `jsr.io:443` and five other public code hosts ✅[^run]; a static import from any other host needs the flag. The security page says the static graph imports "without restrictions" ✅[^security]; that wording is compared with 2.9.8 in `deno/security/permission-model.md` |
| A bare built-in name that is also mapped | The `imports` or `package.json` mapping wins over the built-in ✅[^node] | Prefer `node:` — it is never ambiguous ✅[^node] |
| `import.meta.resolve("npm:ms@^2.1.3")` | `file:///deno-dir/npm/registry.npmjs.org/ms/2.1.3/index.js` without a local `node_modules`; `file:///lab/p7-nm/auto/node_modules/.deno/ms@2.1.3/node_modules/ms/index.js` with `"nodeModulesDir": "auto"` ✅[^run] | It returns the file the module is loaded from, never the `npm:` string, so do not store or compare its result across machines |
| The same package written inline and through `imports` | Two lock entries, `npm:lodash-es@4` and `npm:lodash-es@4.17.21`, both resolved to 4.17.21, although `^4` alone resolved to 4.18.1 in a separate project ✅[^run] | Each spelling gets its own lock entry; here the resolver reused the already-required 4.17.21 for `^4`, so the inline pin silently held the mapped range back. Map the package once in `imports` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Bare names mapped in `imports` | One place for every version; `deno add` writes the entry ✅[^jsr] and `deno outdated --update` updates it ✅[^modules] | A config file is needed; `scopes` can make one name mean two modules |
| Inline `jsr:`/`npm:` specifiers | A single file runs with no config | Versions scattered across files |
| `https:` URLs | Any host, no registry | Not managed by `deno add`/`deno install`, can drift across files, and trusts the serving host ✅[^packages] |
| Literal `import()` | In the static graph: no extra permission, seen by `deno info` ✅[^modules] | The module set is fixed in the code |
| Computed `import()` | Load plugins chosen at run time | Needs `--allow-read`/`--allow-import`; invisible to `deno info` ✅[^run] |

## Takeaways
- Write the full extension on every relative import (`./calc.ts`); do not rely on sloppy-imports flags. [rule-candidate]
- Map each third-party package once in `deno.json` `imports` and import it by bare name; keep versions out of source files. [rule-candidate]
- Declare the type of every non-code import: `with { type: "json" }` or `with { type: "text" }`. [rule-candidate]
- Use string literals in `import()` when the set of modules is known; a computed specifier needs run-time permissions and is invisible to `deno info`. [rule-candidate]
- Write Node built-ins as `node:fs`, even though 2.9 resolves `fs`. [rule-candidate]

## Verification status
- Verified: 47 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example and Edge cases. [^run]
- [Modules](https://docs.deno.com/runtime/fundamentals/modules/) — Deno project, living. Rank 1. Backs: full extensions, subpaths of `deno.json` entries versus import map files, `data:` imports, import attributes (`json`, `text`, `bytes` behind `--unstable-raw-imports`), literal versus computed `import()`, `import.meta.resolve`. [^modules]
- [Configuration file (deno.json)](https://docs.deno.com/runtime/reference/deno_json/) — Deno project, living. Rank 1. Backs: `imports` and `scopes` (per path prefix). [^denojson]
- [Node and npm Compatibility](https://docs.deno.com/runtime/fundamentals/node/) — Deno project, living. Rank 1. Backs: the `npm:` specifier format, `node:` built-ins, bare built-in names since 2.9 and their precedence. [^node]
- [Security and permissions](https://docs.deno.com/runtime/fundamentals/security/) — Deno project, living. Rank 1. Backs: the statement that the static module graph loads without restrictions (Edge cases). [^security]
- [Dependency management](https://docs.deno.com/runtime/packages/) — Deno project, living. Rank 1. Backs: the costs of `https:` imports. [^packages]
- [Deno 2.8](https://deno.com/blog/v2.8) — Deno project, 2026. Rank 1. Backs: text imports stable without a flag. [^v28]
- [Using packages](https://jsr.io/docs/using-packages) — JSR project, living. Rank 1. Backs: the `jsr:` specifier format with an entrypoint after the version constraint. [^jsr]

## Related
- `deno/modules/dependency-management.md` — adding, locking, caching and vendoring the packages these specifiers name.
- `deno/internals/module-loading-and-type-checking.md` — how the module graph is fetched, transpiled and type-checked.
- `deno/security/permission-flags.md` — `--allow-import`, `--allow-read` and their value syntax.
- `deno/node-compat/node-and-npm-compatibility.md` — CommonJS, `package.json` and npm package behaviour.
- `deno/configuration/deno-json-reference.md` — every `deno.json` key, including `imports`, `scopes` and `importMap`.
