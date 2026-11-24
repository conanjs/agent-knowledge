---
schema: knowledge-doc/v1
type: concept
topic: deno/configuration
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, workspace, monorepo, deno-json, package-json, npm-workspaces, catalog, deno-task, deno-publish, config-inheritance]
ranked-sources: true
---

# Deno workspaces: members, shared config and imports across members

## Summary
**TL;DR:** A root `deno.json` with a `workspace` key lists the member folders, as paths or globs (`*`, `**`, `!` to exclude). A member is any listed folder with a `deno.json` or a `package.json`. Other members import it by its `name` as a bare specifier (an import string that is neither a path nor a URL, or web address, such as `@lab/add`), and Deno resolves that name through the member's `exports`. Settings that must hold for the whole workspace (lockfile, `node_modules` mode, `unstable`, `scopes` and ten more) are root-only. A member that sets one gets a warning, and in the lab `unstable` set in a member did not take effect. Per-package settings (`compilerOptions`, `imports`, `fmt`, `lint`, `test`, `tasks`) are merged, and the member's value wins.
**Use this when:** you split a Deno project into packages, add Deno to an npm monorepo, or a member's setting seems ignored.
**Not this doc:** every `deno.json` key and how the file is found → `deno/configuration/deno-json-reference.md`; the task runner itself → `deno/toolchain/tasks-and-task-shell.md`; publishing rules → `deno/std-and-jsr/jsr-and-publishing.md`.

## Problem
Without a workspace, packages in a monorepo (one repository that holds several packages) import each other through relative paths such as `../../add/mod.ts`. Each package repeats its dependency versions and its formatter and linter settings. Two packages can also disagree on settings that must be global, for example one wanting a local `node_modules` folder and the other not. And an existing Node.js monorepo that uses npm `workspaces` should keep working while Deno is added.

## Mental model
**Analogy:** an apartment building. The building lease (the root `deno.json`) fixes what every flat must share: the water and power hookups, which here are the lockfile, the `node_modules` layout and the unstable features. Each flat (a member) has a nameplate on its door (`name`) and furnishes its own rooms (`fmt`, `lint`, `compilerOptions`), keeping the building's defaults wherever it says nothing. Mail addressed to a nameplate (`@lab/add`) reaches the flat's front door (`exports`) without a street address (a relative path).

**Artifact:** the workspace used in the worked example ✅[^run]:
```text
ws1/
├── deno.json            { "workspace": ["packages/*", "!packages/internal"],
│                          "imports": { "greet": "./shared/greet.ts" },
│                          "fmt": { "singleQuote": true, "lineWidth": 60 },
│                          "lint": { "rules": { "exclude": ["no-unused-vars"] } },
│                          "tasks": { "build": "echo root build from $(pwd)" } }
├── main.ts              import { add } from "@lab/add";
├── shared/greet.ts
└── packages/
    ├── add/deno.json      { "name": "@lab/add", "version": "0.1.0",
    │                        "exports": { ".": "./mod.ts", "./extra": "./extra.ts" },
    │                        "fmt": { "semiColons": false },
    │                        "tasks": { "build": "echo add build from $(pwd)" } }
    ├── subtract/deno.json { "name": "@lab/subtract", "version": "0.3.0", "exports": "./mod.ts",
    │                        "lint": { "rules": { "include": ["no-unused-vars"] } },
    │                        "tasks": { "build": "echo subtract build from $(pwd)" } }
    └── internal/deno.json  excluded by "!packages/internal"
```

## How it works
**4 actors:**
- **Discovery (the Deno CLI)** — its job: find the config that governs the start folder, then the workspace root above it, via a walk up the file system.
- **Root `deno.json`** — its job: list the members and hold the settings that apply to every member, via `workspace` and the root-only keys.
- **Member config** (`deno.json`, `package.json`, or both) — its job: name the package and set its own options, via `name`, `exports`, `imports`, `fmt`, `lint`, `compilerOptions`, `tasks`.
- **Resolver** — its job: turn a bare specifier into a file inside a member, via the member names and their `exports` maps.

```text
[Discovery]                 [Root deno.json]             [Member config]            [Resolver]
start folder (script dir
or cwd, per subcommand)
  │ walk up ───────────────▶ "workspace": [...] expanded
  │                          member listed? ── no ─▶ warn, use member alone
  │                               │ yes
  │                               ▼
  │                          root-only keys + defaults ─▶ merged with member keys
  │                                                        (member value wins)
  ▼                                                               │
import "@lab/add/extra" ─────────────────────────────────────────▶ name "@lab/add"
                                                                    exports "./extra" → extra.ts
(all local file reads; only npm: and jsr: packages ever go over the network)
```

1. **Discovery (local, file system):**
   - Picks the start folder: the script's folder for `deno run <file>`, the current folder for `deno check`, `deno test` and most others (table in `deno/configuration/deno-json-reference.md`).
   - Walks up to the first `deno.json` or `package.json`, then keeps walking to find a root with `workspace` ✅[^disc-src].
   - A config whose folder the root does not list is used on its own, with `Warning: config file file:///lab/ws1/packages/internal/deno.json is not a member of the workspace at file:///lab/ws1/. Ignoring the parent workspace config.` ✅[^disc-src] ✅[^run]
2. **Root `deno.json` (local):**
   - Expands `workspace` (an array, or `{ "members": [...] }`) ✅[^ws-docs].
   - `packages/*` matches one level, `*/*` exactly two, `**` any depth, and a `!` entry removes folders an earlier entry matched (patterns since Deno 2.1) ✅[^ws-docs].
   - A listed folder that does not exist is skipped with `Workspace member "./missing" not found at file:///lab/ws6/missing/. Skipping.`; a member outside the root folder is an error ✅[^run].
3. **Member config, merged with the root (local):**
   - Root-only keys set in a member are reported, one warning each, and the member still runs ✅[^ws-src] ✅[^run]. In the lab the key did not take effect: with `"unstable": ["kv"]` in a member, `typeof Deno.openKv` printed `undefined`, and the same key in a standalone project printed `function` ✅[^run]. The keys: `importMap`, `scopes`, `lock`, `nodeModulesDir`, `vendor`, `minimumDependencyAge`, `links`, `unstable`, `allowScripts`, `preferPackageJson`, `catalog`, `catalogs`, `workspace`, `lint.report`. Example: `Warning "lock" field can only be specified in the workspace root deno.json file.`
   - Shared keys are merged per member folder. The table below lists what the lab showed.
4. **Resolver (local):**
   - Matches a bare specifier against the members' `name` fields and maps the subpath through that member's `exports` ✅[^ws-docs] ✅[^run].
   - `@lab/add` → `./mod.ts` and `@lab/add/extra` → `./extra.ts`. A path not in `exports` fails: `error: Unknown export './hidden.ts' for '@lab/add'.` ✅[^run]
   - A member that has only a `package.json` resolves by that file's `name` ✅[^ws-docs] ✅[^run].

### What a member may set, and how it merges
| Key | Root | Member | Merge rule (lab result) |
|---|---|---|---|
| `compilerOptions` | yes | yes | Root then member are merged onto Deno's defaults; member wins per option, and an array is replaced, not joined ✅[^resolver-src] ✅[^ts-src] ✅[^ws-docs]. A member's `strict: false`, `noUnusedLocals: false` and `lib: ["esnext", "dom"]` took effect, and root `checkJs: true` still applied in the member. A root `lib: ["deno.window", "dom"]` with a member `lib: ["deno.window"]` made `document` fail only in the member ✅[^run] |
| `imports` | yes | yes | Member entry wins inside the member folder; root entries are inherited (`member file: member import map \| inherited from root`) ✅[^ws-docs] ✅[^run] |
| `fmt` options | yes | yes | Per option, member wins: `add/` got `'double'` without `;` (own `semiColons: false`, root `singleQuote`) ✅[^ws-docs] ✅[^run] |
| `lint.rules` | yes | yes | Member `include` beats root `exclude`: `no-unused-vars` fired only in `subtract/` ✅[^ws-docs] ✅[^run] |
| `test` / `bench` `include`, `exclude` | yes | yes | Root `test.exclude: ["**/slow_test.ts"]` also skipped a member's `slow_test.ts` ✅[^ws-docs] ✅[^run] |
| `test.permissions` | yes | yes | The closest `deno.json` decides ✅[^denojson] ✅[^run] |
| `tasks` | yes | yes | Member task wins on a name clash; a root task still runs from a member folder (`root hello`) ✅[^ws-docs] ✅[^run] |
| `name`, `version`, `exports`, `publish: false` | docs: no | yes | Member keys; see Edge cases for a root that sets them ✅[^ws-docs] |
| the 14 root-only keys above | yes | warns | Warning per key; `unstable` was measured to have no effect in the member ✅[^ws-src] ✅[^run] |

Unsupported compiler options are reported per file: `target` and `outDir` in a member printed `Unsupported compiler options in "file:///lab/ws7/odd/deno.json".` and `The following options were ignored:` ✅[^run]. What each compiler option does is in `deno/fundamentals/running-code-and-typescript.md`.

### Mixing Deno members and npm packages
- **Three member kinds:** `deno.json` only, `deno.json` plus `package.json`, or `package.json` only ✅[^ws-docs].
- **A `package.json`-only member in a Deno workspace:** with `"workspace": ["./legacy", "./modern"]`, where `legacy/` holds only `{"name": "@lab/legacy", …}`, `import { legacy } from "@lab/legacy"` worked ✅[^run].
- **Both workspace styles at once:** a root `deno.json` with `"workspace": {"members": ["hi"]}` next to a root `package.json` with `"workspaces": ["log"]`. The member `hi` imports `npm:@lab/log@^0.5`, and Deno resolved it to the local `log/` package with no network (`--network none`), printing `Hi, friend!` ✅[^ws-docs] ✅[^run].
- **`workspace:` protocol:** `workspace:*`, `workspace:~` and `workspace:^` work in `package.json` dependencies ✅[^ws-docs].
- **pnpm:** a `pnpm-workspace.yaml` file is not read; move its `packages` list into `deno.json` `workspace` ✅[^ws-docs].
- **Catalogs** (npm-only, root-only, since Deno 2.8) pin one npm version for every member ✅[^ws-docs]. With a root `"catalog": {"ms": "2.0.0"}`, both a `package.json` member (`"ms": "catalog:"`) and a `deno.json` member (`"imports": {"ms": "catalog:"}`, allowed since 2.9 ✅[^ws-docs]) resolved `npm:ms@2.0.0` ✅[^run].

### Running commands across members
- `deno check`, `deno test`, `deno fmt` and `deno lint` run from the root cover every member, each with its merged config ✅[^ws-docs] ✅[^run].
- `deno task` options ✅[^task] ✅[^run]:
  - `--cwd=packages/add build` runs one member's task.
  - `--recursive` runs the root and every member, and prefixes each output line (`[@lab/add#build]`).
  - `--members` runs every member but not the root.
  - `--filter <name>` selects members by `name` and implies `--recursive`; in the lab `add` matched `@lab/add` and `sub` matched `@lab/subtract`.
- Task syntax, dependencies and caching are explained in `deno/toolchain/tasks-and-task-shell.md`.

### Publishing from a workspace
`deno publish` at the root publishes every member that has `name` and `exports`. It stops with `error: file:///lab/ws9/noversion/deno.json is missing 'version' field` when one lacks a version. `"publish": false` skips a member, and `package.json`-only members are never published ✅[^ws-docs] ✅[^run]. With versions and `license` set, `deno publish --dry-run` printed `Simulating publish of @lab/noversion@0.0.1` and `Simulating publish of @lab/add@0.1.0`, then `Success Dry run complete` ✅[^run]. Slow types, provenance and JSR (the JavaScript Registry) rules are in `deno/std-and-jsr/jsr-and-publishing.md`.

## Worked example
The `ws1/` workspace from Mental model, with `packages/subtract/mod.ts` importing `@lab/add` and the root alias `greet`. All commands ran offline (`--network none`) ✅[^run].

| Step | Command (folder) | Output |
|---|---|---|
| 1 | `deno run main.ts` (`ws1/`) | `1 + 2 = 3 \| 2 - 4 = -2 \| extra subpath \| hi subtract`: two members and a subpath export resolved by name |
| 2 | `deno run bad-excluded.ts` (`ws1/`) | `error: Import "@lab/internal" not a dependency and not in import map …`, exit 1: `!packages/internal` removed that member |
| 3 | `deno task build` (`ws1/packages/add/`) | `add build from /lab/ws1/packages/add`: the member's own task, run in its folder |
| 4 | `deno task --recursive build` (`ws1/`) | three lines: `[build] root build from /lab/ws1`, `[@lab/add#build] …`, `[@lab/subtract#build] …` |
| 5 | `deno fmt --check` (`ws1/`) | root `fmt-sample.ts`: `const s = 'double';`; `packages/add/fmt-sample.ts`: `const s = 'double'` (no `;`): root `singleQuote` everywhere, member `semiColons: false` only in `add/` |
| 6 | `deno lint` (`ws1/`) | `error[no-unused-vars]` only in `packages/subtract/mod.ts`; the same unused variable in root `main.ts` passed |

Step 6 also reported `error[no-slow-types]` (missing explicit type in the public API, the application programming interface a package exports) for the untyped export `hello` in `subtract/` ✅[^run]; slow types are explained in `deno/std-and-jsr/jsr-and-publishing.md`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A member sets `workspace` (nested workspace) | From the root: warning, and the inner folder is not a member (`Import "@lab/inner" not a dependency`); from inside the member: it acts as its own root, no warning ✅[^run] | Nested workspaces are not supported ✅[^ws-docs] |
| The root sets `name`, `version`, `exports` | Accepted with no warning; members can import `@lab/root`; `deno publish --dry-run` at the root simulated only `@lab/root@1.0.0`, not the member ✅[^run] | The docs matrix marks these keys member-only ✅[^ws-docs], but 2.9.8 neither warns nor refuses them ✅[^run] |
| Two members with the same `name` | `error: The '@lab/same' package ('file:///lab/ws11/b/deno.json') cannot have the same name as the package at 'file:///lab/ws11/a/deno.json'.`, exit 1 ✅[^run] | Names must be unique ✅[^ws-src] |
| A listed member outside the root folder (`../p1`) | `error: Workspace member must be nested in a directory under the workspace.`, exit 1 ✅[^run] | Members are descendants of the root ✅[^ws-src] |
| A member sets `test.permissions`, `deno test` without `-P` | Other members' tests run, then `error: Test permissions were found in the config file. Did you mean to run with \`-P\` or a permission flag?`, exit 1 ✅[^run] | Config permissions need an explicit opt-in ✅[^denojson] |
| `deno task --filter @lab/nothing build` | `No matching task or script 'build' found in selected packages.`, exit 0 ✅[^run] | An empty match is not an error; check the output in scripts |
| A container image copies only one member | `subtract/` copied alone failed at its first root alias: `error: Import "greet" not a dependency and not in import map …`, exit 1 ✅[^run] | The root `deno.json`, every member it depends on and the same folder layout must be copied ✅[^ws-docs] |
| `catalog` in both root `deno.json` and root `package.json` | `package.json` wins entirely, no merge ✅[^ws-docs] | Documented rule (not run) |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Deno `workspace` in `deno.json` | Globs with `!`, root-only safety warnings, merged fmt/lint/compiler config, JSR publishing per member | Members need `name` and `exports` to be importable by name |
| npm `workspaces` in `package.json` only | Unchanged for Node.js tools | No place for Deno's fmt, lint or compiler settings |
| Both files at the root | Gradual migration: npm packages keep working while Deno members are added ✅[^ws-docs] | Two member lists to keep in step |

## Takeaways
- Put lockfile, `node_modules` mode, `unstable`, `scopes`, `links` and catalogs only in the root `deno.json`. In a member they print a warning, and `unstable` was measured to have no effect there. [rule-candidate]
- Import another member by its `name` (`@scope/pkg`), never by a relative path, and list every public subpath in its `exports`. [rule-candidate]
- Keep `name`, `version` and `exports` out of the root config. A root that has them becomes a package, and `deno publish` at the root then publishes only that package. [rule-candidate]
- Give a container build the root `deno.json` and every depended-on member, in the same layout.

## Verification status
- Verified: 69 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example and Edge cases. Probes ran with `--network none`, except the catalog probe, which fetched `npm:ms`. [^run]
- [libs/config/workspace/mod.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/libs/config/workspace/mod.rs) — Deno project, 2026. Rank 1. Backs: the root-only key checks, duplicate-name and non-descendant errors. [^ws-src]
- [libs/config/workspace/discovery.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/libs/config/workspace/discovery.rs) — Deno project, 2026. Rank 1. Backs: the walk from the first config up to the workspace root, the non-member warning. [^disc-src]
- [libs/resolver/deno_json.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/libs/resolver/deno_json.rs) — Deno project, 2026. Rank 1. Backs: each config's `compilerOptions` merged in turn onto the base options. [^resolver-src]
- [libs/config/deno_json/ts.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/libs/config/deno_json/ts.rs) — Deno project, 2026. Rank 1. Backs: the merge rule (objects merged key by key, other values replaced). [^ts-src]
- [Workspaces and monorepos](https://docs.deno.com/runtime/fundamentals/workspaces/) — Deno project, living. Rank 1. Backs: member kinds, patterns, the option matrix and merge rules, resolution steps, npm and pnpm compatibility, catalogs, publishing, containers. [^ws-docs]
- [Configuration file (deno.json)](https://docs.deno.com/runtime/reference/deno_json/) — Deno project, living. Rank 1. Backs: closest `deno.json` for test permissions, the `-P` opt-in. [^denojson]
- [deno task](https://docs.deno.com/runtime/reference/cli/task/) — Deno project, living. Rank 1. Backs: `--recursive`, `--filter` matching member names. [^task]

## Related
- `deno/configuration/deno-json-reference.md` — every key, the discovery start folder per subcommand, all warning texts.
- `deno/toolchain/tasks-and-task-shell.md` — task syntax and the task shell.
- `deno/std-and-jsr/jsr-and-publishing.md` — `deno publish`, slow types, provenance.
- `deno/node-compat/migrating-a-node-project.md` — moving an npm monorepo to Deno step by step.
