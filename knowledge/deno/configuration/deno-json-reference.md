---
schema: knowledge-doc/v1
type: reference
topic: deno/configuration
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, deno-json, deno-jsonc, configuration, config-discovery, no-config, package-json, deno-no-package-json, json-schema]
ranked-sources: true
---

# deno.json keys, config discovery and package.json in Deno 2.9

## Summary
**TL;DR:** Deno 2.9.8 knows 33 top-level `deno.json` keys from its JSON (JavaScript Object Notation) schema, plus `nodeModulesLinker`, which the parser accepts but the schema leaves out. A key it does not know is ignored without a warning. Deno finds the file by walking up from a start folder: the script's folder for `deno run`, the current folder for most other subcommands. `--config` picks a file and `--no-config` turns discovery off. A `package.json` next to it adds dependencies and scripts. When both files declare the same dependency or task name, the `deno.json` entry wins.
**Use this when:** you need the exact name, type or default of a `deno.json` key, want to know which config file a command picked up, or have both `deno.json` and `package.json` in one project.
**Not this doc:** workspaces and per-member settings → `deno/configuration/workspaces-and-monorepos.md`; what each key's feature does in depth → the doc named in the "Depth" column.

## Scope
This catalog covers the configuration file of Deno 2.9.8 (`deno.json` or `deno.jsonc`): every top-level key in the 2.9.8 JSON schema (`cli/schemas/config-file.v1.json` at tag `v2.9.8`) ✅[^schema], the keys the parser reads but the schema does not list ✅[^json-src], how the file is discovered, the flags and environment variables that change discovery, how a `package.json` beside it is read, and the warnings and errors the config produces. Each key's feature is explained in the sibling doc named in its row; this doc only says what the key is.

**Analogy:** config discovery works like house rules pinned on a wall. Deno starts in the room the command points at and walks outward through each enclosing room until it finds a posted sheet (`deno.json`), then keeps walking to check whether a building-wide sheet (a workspace root) covers that room.

**Artifact:** a project where a script two folders deep still picks up the root file:
```text
p1/
├── deno.json          { "imports": { "greet": "./lib/greet.ts" } }
├── lib/greet.ts       export const hi = "hi from lib/greet.ts";
└── src/deep/main.ts   import { hi } from "greet"; console.log(hi);
```
`cd p1/src/deep && deno run main.ts` prints `hi from lib/greet.ts` ✅[^run].

## Catalog

### Top-level keys (Deno 2.9.8)
"Root only" = Deno prints a warning when a workspace member sets the key (measured for every "yes" row) ✅[^run] ✅[^ws-src]. "—" = no member warning exists.

| Key | Type | Default | Effect | Root only | Depth |
|---|---|---|---|---|---|
| `name` | string | none | JSR (the JavaScript Registry) or workspace package name, `@scope/name` ✅[^schema] | — | `deno/std-and-jsr/jsr-and-publishing.md` |
| `version` | string | none | JSR package version ✅[^schema] | — | `deno/std-and-jsr/jsr-and-publishing.md` |
| `exports` | string `./…` or object (`"."`, `"./x"` → `./file`) | none | Entry points of the package ✅[^schema] ✅[^denojson] | — | `deno/std-and-jsr/jsr-and-publishing.md` |
| `license` | string (an SPDX, Software Package Data Exchange, license identifier) | none | Package license; `deno publish` fails with `error[missing-license]` without it or a LICENSE file ✅[^schema] ✅[^run] | — | `deno/std-and-jsr/jsr-and-publishing.md` |
| `publish` | `{include, exclude}` or `false` | none (all package files; `.gitignore` respected ✅[^denojson]) | Files to publish; `false` skips the package ✅[^schema] ✅[^ws-docs] | — | `deno/std-and-jsr/jsr-and-publishing.md` |
| `imports` | object (specifier → target) | none | Import map entries ✅[^schema] | — | `deno/modules/module-specifiers-and-imports.md` |
| `scopes` | object (path prefix → map) | `{}` | Import map entries that apply only under a path prefix ✅[^schema] ✅[^denojson] | yes | `deno/modules/module-specifiers-and-imports.md` |
| `importMap` | string (path) | none | External import map file; ignored when `imports` or `scopes` is set ✅[^schema] ✅[^run] | yes | `deno/modules/module-specifiers-and-imports.md` |
| `links` | array of paths, `file://` URLs or globs (`!` excludes) | none | Use local copies of JSR or npm packages, like `npm link` ✅[^schema] ✅[^denojson] | yes | `deno/modules/dependency-management.md` |
| `patch` | array | none | Old name of `links` (renamed in 2.3.6); warns ✅[^schema] ✅[^run] | — | `deno/modules/dependency-management.md` |
| `lock` | boolean, string (path) or `{path, frozen}` | `true`, `deno.lock`, `frozen: false` | Lockfile on/off, location, fail-if-outdated; with `false` no `deno.lock` was written ✅[^schema] ✅[^denojson] ✅[^run] | yes | `deno/modules/dependency-management.md` |
| `nodeModulesDir` | `"none"`, `"auto"`, `"manual"` (boolean deprecated) | `"none"`; `"manual"` when a `package.json` exists ✅[^denojson] | How npm packages are laid out on disk ✅[^schema] | yes | `deno/modules/dependency-management.md` |
| `nodeModulesLinker` | `"isolated"` or `"hoisted"` | not stated | Linker mode for npm packages; parsed but missing from the schema ✅[^json-src] ✅[^run] | — | `deno/modules/dependency-management.md` |
| `vendor` | boolean | unset | Keep remote modules in a local `vendor/` folder ✅[^schema] | yes | `deno/modules/dependency-management.md` |
| `jsrDepsInNodeModules` | boolean | off | Install `jsr:` packages into `node_modules` through JSR's npm registry ✅[^schema] ✅[^denojson] | — | `deno/modules/dependency-management.md` |
| `preferPackageJson` | boolean | unset | `deno add/install/remove` write to `package.json` ✅[^schema] ✅[^denojson] | yes | `deno/modules/dependency-management.md` |
| `minimumDependencyAge` | string (an ISO 8601 duration, the international date-and-time standard; minutes; or a date), number, or `{age, exclude}` | 24 hours since Deno 2.9 when unset ✅[^denojson] | Refuse npm/JSR versions newer than the age ✅[^schema] | yes | `deno/modules/dependency-management.md` |
| `catalog` | object (npm name → version range) | none | Default npm version catalog for `catalog:` references ✅[^schema] ✅[^ws-docs] | yes | `deno/configuration/workspaces-and-monorepos.md` |
| `catalogs` | object (catalog name → catalog) | none | Named catalogs for `catalog:<name>` ✅[^schema] | yes | `deno/configuration/workspaces-and-monorepos.md` |
| `workspace` | array of member paths or globs, or `{members}` | none | Makes this file a workspace root ✅[^schema] | yes | `deno/configuration/workspaces-and-monorepos.md` |
| `compilerOptions` | object | none (Deno's own defaults apply) | TypeScript options; unsupported ones are ignored with a warning ✅[^schema] ✅[^run] | — | `deno/fundamentals/running-code-and-typescript.md` |
| `unstable` | array of feature names | none | Turn on unstable features (`kv`, `cron`, `webgpu`, …); the schema lists 18 example names, and an unknown name prints `Warning 'foo' isn't a valid unstable feature` ✅[^schema] ✅[^denojson] ✅[^run] | yes | `deno/releases-stability-and-support.md` |
| `tasks` | object; name matches `^[A-Za-z][A-Za-z0-9_\-:]*$`; value string or `{command, description, dependencies, files, output, env}` | none | Commands for `deno task` ✅[^schema] | — | `deno/toolchain/tasks-and-task-shell.md` |
| `lint` | `{include, exclude, plugins, rules, report}` | none | Linter scope and rules ✅[^schema] ✅[^denojson] | `report` only | `deno/toolchain/formatting-linting-and-docs.md` |
| `fmt` | `{include, exclude, …options}` (`lineWidth` 80, `indentWidth` 2, `semiColons` true, …) | as listed | Formatter options ✅[^schema] ✅[^denojson] | — | `deno/toolchain/formatting-linting-and-docs.md` |
| `test` | `{include, exclude, permissions, sanitizeOps, sanitizeResources}` | none | `deno test` file set, permissions, sanitizers ✅[^schema] | — | `deno/testing/testing-and-mocking.md` |
| `bench` | `{include, exclude, permissions}` | none | `deno bench` file set and permissions ✅[^schema] | — | `deno/testing/coverage-and-benchmarks.md` |
| `coverage` | `{thresholds: {lines, branches, functions}}`, each 0–100 | none | Minimum coverage for the command to succeed ✅[^schema] | — | `deno/testing/coverage-and-benchmarks.md` |
| `permissions` | object (set name → permission set); `"default"` is used by a bare `-P` | none | Named permission sets, loaded only with `-P` or a permission flag ✅[^schema] ✅[^denojson] | — | `deno/security/permission-flags.md` |
| `compile` | `{include, exclude, permissions}` | none | Extra files and permissions for `deno compile`; merged with `--include`/`--exclude` ✅[^schema] ✅[^denojson] | — | `deno/advanced/compile-and-distribution.md` |
| `desktop` | `{app, backend: "webview" or "cef", output, release}` | none | Settings for `deno desktop`, the 2.9.8 subcommand that compiles a script into a desktop application ✅[^schema] ✅[^run] | — | `deno/advanced/compile-and-distribution.md` |
| `allowScripts` | boolean, `["npm:pkg", …]` or `{allow, deny}` | none | Which npm lifecycle scripts may run ✅[^schema] | yes | `deno/node-compat/node-and-npm-compatibility.md` |
| `exclude` | array of paths or globs | none | Ignored by every subcommand and the language server ✅[^schema] ✅[^denojson] | — | this doc |
| `deploy` | object | none | Deno Deploy and Deno Sandbox settings; out of scope here ✅[^schema] | — | none |
| `workspaces` (plural) | array | none | Not a Deno key; ignored with a warning ✅[^json-src] ✅[^run] | — | `deno/configuration/workspaces-and-monorepos.md` |

### Where discovery starts
| Command | Start folder | Lab check |
|---|---|---|
| `deno run <file>`, `deno compile <file>`, `deno desktop <file>` | the script's own folder; for `deno desktop <folder>`, that folder ✅[^flags-src] | run from `/lab/p2`, `deno run /lab/p1/src/deep/main.ts` used `/lab/p1/deno.json` ✅[^run] |
| `deno run` with a remote `https:` script | none: no auto-discovery ✅[^flags-src] | not run (no network) |
| `deno run npm:…` / `jsr:…` | current folder ✅[^flags-src] | not run |
| `deno fmt <paths>`, `deno lint <paths>` | each given path; the current folder when none ✅[^flags-src] | — |
| `deno task --cwd <dir>` | `<dir>` ✅[^flags-src] | `deno task --cwd=packages/add build` ran the member's task ✅[^run] |
| `deno cache <files>`, `deno install <entrypoints>` | the first entrypoint's folder ✅[^flags-src] | — |
| every other subcommand (`check`, `test`, `info`, `task`, `bench`, `publish`, `add`, …) | current folder ✅[^flags-src] | from `/lab/p2`, `deno info /lab/p1/src/deep/main.ts` resolved `greet` to `file:///lab/p2/greet.ts` ✅[^run] |

### How the walk proceeds
| Step | Rule |
|---|---|
| 1 | From the start folder up through every parent, look in each folder for `deno.json` (or else `deno.jsonc`) and for `package.json` ✅[^json-src] ✅[^disc-src] |
| 2 | `deno.json` and `deno.jsonc` in one folder: `deno.json` is used ✅[^json-src] ✅[^run] |
| 3 | After the first config folder, keep walking up to find a workspace root ✅[^disc-src] |
| 4 | A root whose `workspace` does not list that folder is ignored: `Warning: config file file:///lab/ws1/packages/internal/deno.json is not a member of the workspace at file:///lab/ws1/. Ignoring the parent workspace config.` ✅[^disc-src] ✅[^run] |
| 5 | A folder with no config of its own under a root uses the root's config (`tools/scratch/s.ts` resolved the root's `greet` alias) ✅[^run] |
| 6 | No discovery inside `node_modules` ✅[^disc-src] |

### Flags and environment variables
| Control | Effect | Lab check |
|---|---|---|
| `-c, --config <file>` | Use this file instead of the discovered one ✅[^config] | `--config p1alt/custom.json` worked; a missing file gives `error: Error reading config file 'file:///lab/nope.json'.` and `No such file or directory (os error 2)`, exit 1 ✅[^run] |
| `--no-config` | "Disable automatic loading of the configuration file" (help text) ✅[^run] | the alias failed with `error: Import "greet" not a dependency`, exit 1; a `package.json` dependency was not resolved either ✅[^run] |
| `DENO_NO_PACKAGE_JSON` (any value) | Disables auto-resolution of `package.json` ✅[^env] | `deno task only-pkg` → `Task not found: only-pkg`; `import ms from "ms"` → `Import "ms" not a dependency` ✅[^run] |
| `--node-modules-dir`, `--vendor`, `--lock`/`--no-lock`, `--node-modules-linker`, `-P` | Flag forms of `nodeModulesDir`, `vendor`, `lock`, `nodeModulesLinker`, `permissions` (listed in `deno run --help`) ✅[^run] | — |

### deno.json next to package.json
| Question | Answer |
|---|---|
| What does each file configure? | `package.json`: dependencies and scripts; Deno's own settings (fmt, lint, compiler, lockfile) come only from `deno.json` ✅[^config] |
| Same dependency in both (`"ms": "npm:ms@2.0.0"` in `imports`, `"ms": "2.1.3"` in `dependencies`) | The `deno.json` entry wins: `deno info` showed `ms@2.0.0`. `deno install` installed both versions, and `deno.lock` recorded them under `workspace.dependencies` and `workspace.packageJson.dependencies` ✅[^run] |
| Same task and script name | The `deno.json` task runs (`dev from deno.json`); `deno task` lists a script only in `package.json` as `only-pkg (package.json)` ✅[^run] ✅[^task] |
| `package.json` dependency without `deno install` | `error: Could not resolve "ms", but found it in a package.json. Deno expects the node_modules/ directory to be up to date. Did you forget to run \`deno install\`?` ✅[^run] |
| `npm_*` variables (`npm_package_name`, …) | Set only for `package.json` scripts, not `deno.json` tasks ✅[^task] |

### Comments and parse errors
| Input | Result |
|---|---|
| `deno.jsonc` with `//`, `/* */` comments and trailing commas | Accepted ✅[^config] ✅[^run] |
| The same comments in a file named `deno.json` | Also accepted ✅[^run] |
| Unknown top-level key (`foo`, `fmtt`, `include`) | Ignored, no warning, exit 0 ✅[^run] |
| Unknown key inside a section (`"fmt": {"lineWidht": 40}`) | `deno run` ignores it; `deno fmt` fails with `error: Failed to parse "fmt" configuration` / ``unknown field `lineWidht`, expected one of `useTabs`, `lineWidth`, …``, exit 1 ✅[^run] |
| Broken JSON (missing `}`) | `error: Failed deserializing config file 'file:///lab/p3c/deno.json'.` / `Unterminated object on line 2 column 1`, exit 1 ✅[^run] |
| `"nodeModulesLinker": "flat"` | `error: Unsupported "nodeModulesLinker" value.` / `invalid value: string "flat", expected "isolated" or "hoisted"`, exit 1 ✅[^run] |

### Warnings the config itself prints
The command still runs after each of these. The first six add a second line naming the file, `    at file:///…/deno.json` ✅[^run] ✅[^ws-src].

| Trigger | Warning text |
|---|---|
| A root-only key in a member | `Warning "nodeModulesDir" field can only be specified in the workspace root deno.json file.` |
| `importMap` together with `imports` or `scopes` | `Warning "importMap" field is ignored when "imports" or "scopes" are specified in the config file.` |
| `"nodeModulesDir": true` | ``Warning `"nodeModulesDir": true` is deprecated in Deno 2.0. Use `"nodeModulesDir": "auto"` instead.`` |
| `patch` | `Warning "patch" property was renamed to "links".` |
| `workspaces` in `deno.json` | `Warning "workspaces" field was ignored. Use "workspace" instead.` |
| `name` without `exports` | `Warning "exports" field should be specified when specifying a "name".` |
| `compilerOptions` with `target`, `outDir` | `Unsupported compiler options in "file:///lab/ws7/odd/deno.json".` / `The following options were ignored:` / `outDir, target` |
| `test.permissions` with `deno test -P` | `Warning Permissions in the config file is an experimental feature and may change in the future.` |

## Lookup notes
- **The docs say discovery starts in the current folder; for `deno run <file>` it starts in the script's folder.** The configuration page says Deno finds the file "in your current working directory or any parent directory" ✅[^config]. In 2.9.8, `deno run` and `deno compile` start from the script's folder, while `deno check` and `deno info` start from the current folder ✅[^flags-src] ✅[^run]. One file can resolve differently under `deno run` and `deno check` when it is run from another project's folder.
- **A typo in a top-level key is silent.** `fmtt` or a top-level `include` (no such key; `include` lives inside `lint`, `fmt`, `test`, `bench`, `publish`, `compile`) is dropped without a word ✅[^run]. The schema does not catch it either: it sets no `additionalProperties: false` at the top level, only inside some sections (`compile`, `desktop`, `compilerOptions`, `deploy`, `tasks`, permission sets, and the object forms of `allowScripts` and `minimumDependencyAge`) ✅[^schema]. The docs offer the schema for editor autocompletion ✅[^denojson], which helps while typing but does not reject an extra key.
- **A typo inside a section fails only in the subcommand that reads it.** `deno run` succeeded with the misspelled `fmt.lineWidht`, and `deno fmt` refused it ✅[^run].
- **`--no-config` also hid `package.json` in the lab.** Its help text mentions only "the configuration file"; with `--no-config` an import declared only in `package.json` failed ✅[^run]. Use `DENO_NO_PACKAGE_JSON` when only `package.json` should be ignored ✅[^env].
- **The schema's `$id` and the docs link point at `main`.** For 2.9.8 read the file at tag `v2.9.8`: `main` may already list keys that 2.9.8 lacks ✅[^schema] ✅[^denojson].
- **The error text for config test permissions differs from the docs:** 2.9.8 adds "or a permission flag"; the 2.9.8 text and the comparison are in `deno/security/permission-flags.md`.

## Takeaways
- Commit a `deno.json` (not only a `package.json`) whenever the project needs fmt, lint, compiler or lockfile settings: `package.json` cannot carry them. [rule-candidate]
- Put an explicit `--config` in scripts and continuous integration (CI) jobs that run a file from outside its own project, so `deno run` and `deno check` read the same config. [rule-candidate]
- Do not declare one dependency in both `deno.json` `imports` and `package.json` `dependencies`: the `deno.json` entry wins, both versions get installed, and the lockfile carries both. [rule-candidate]
- Check top-level key names against the catalog when reviewing a `deno.json`: neither Deno 2.9.8 nor its schema rejects an unknown top-level key. [rule-candidate]

## Verification status
- Verified: 118 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Scope and Catalog. Probes ran with `--network none`, except the two that fetched `npm:ms`. [^run]
- [cli/schemas/config-file.v1.json at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/cli/schemas/config-file.v1.json) — Deno project, 2026. Rank 1. Backs: the key list, types, defaults, task-name pattern. [^schema]
- [libs/config/deno_json/mod.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/libs/config/deno_json/mod.rs) — Deno project, 2026. Rank 1. Backs: parsed keys (`nodeModulesLinker`, `workspaces`), the `deno.json` then `deno.jsonc` file-name order. [^json-src]
- [libs/config/workspace/mod.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/libs/config/workspace/mod.rs) — Deno project, 2026. Rank 1. Backs: the root-only key list and warning texts. [^ws-src]
- [libs/config/workspace/discovery.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/libs/config/workspace/discovery.rs) — Deno project, 2026. Rank 1. Backs: the upward walk, the workspace-root search, no discovery in `node_modules`. [^disc-src]
- [cli/args/flags.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/cli/args/flags.rs) — Deno project, 2026. Rank 1. Backs: the start folder per subcommand. [^flags-src]
- [Config files](https://docs.deno.com/runtime/fundamentals/configuration/) — Deno project, living. Rank 1. Backs: discovery in the current folder and parents, `--config`, `.jsonc`, what `package.json` configures. [^config]
- [Configuration file (deno.json)](https://docs.deno.com/runtime/reference/deno_json/) — Deno project, living. Rank 1. Backs: key behaviour and defaults, the test-permissions error text, the schema link. [^denojson]
- [Workspaces and monorepos](https://docs.deno.com/runtime/fundamentals/workspaces/) — Deno project, living. Rank 1. Backs: `publish: false`, catalogs. [^ws-docs]
- [Environment variables](https://docs.deno.com/runtime/reference/env_variables/) — Deno project, living. Rank 1. Backs: `DENO_NO_PACKAGE_JSON`. [^env]
- [deno task](https://docs.deno.com/runtime/reference/cli/task/) — Deno project, living. Rank 1. Backs: `package.json` scripts as a fallback, `npm_*` variables. [^task]

## Related
- `deno/configuration/workspaces-and-monorepos.md` — root and member configs, member imports, tasks and publishing across members.
- `deno/modules/dependency-management.md` — the lockfile, `node_modules` modes, minimum dependency age.
- `deno/toolchain/tasks-and-task-shell.md` — what a task value can contain.
- `deno/deno-lab-setup.md` — the container every output above came from.
