---
schema: knowledge-doc/v1
type: concept
topic: deno/modules
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, dependencies, deno-add, deno-install, deno-remove, deno-outdated, deno-update, deno-why, deno-list, deno-ci, deno-lock, lockfile, frozen, deno-dir, cache, deno-clean, node-modules, vendor, minimum-dependency-age, npmrc, private-registry, deno-auth-tokens]
ranked-sources: true
---

# Deno dependency management: deno.json, deno.lock, the cache and node_modules

## Summary
**TL;DR:** `deno add jsr:@std/path npm:chalk@5` writes caret ranges of the resolved versions (`^1.1.6`, `^5.6.2`) into `imports` in `deno.json` (npm packages go to `package.json` when one exists) and pins the exact versions with integrity hashes in `deno.lock` (format `"version": "5"`). Packages are downloaded once into the global cache `DENO_DIR` (`remote/`, `npm/`, `gen/`); a project-local `node_modules/` appears only in `auto` or `manual` mode (`manual` is the default when a `package.json` exists) or with `"vendor": true`, which also copies remote modules into `vendor/`. Since 2.9 Deno skips package versions published less than 24 hours ago, and `--frozen` turns any lockfile change into an error.
**Use this when:** adding, removing, upgrading or tracing packages; setting up CI (continuous integration) installs; a tool needs `node_modules`; a just-published version "cannot be found"; using a private npm registry or private `https:` modules.
**Not this doc:** how specifiers and import maps resolve → `deno/modules/module-specifiers-and-imports.md`; `deno install -g` and `deno compile` → `deno/advanced/compile-and-distribution.md`; every `deno.json` key → `deno/configuration/deno-json-reference.md`; workspace members and `catalog:` → `deno/configuration/workspaces-and-monorepos.md`; npm lifecycle scripts and `package.json` semantics → `deno/node-compat/node-and-npm-compatibility.md`; publishing → `deno/std-and-jsr/jsr-and-publishing.md`.

## Problem
Teams coming from npm expect one install step that creates `node_modules` and a lockfile nobody reads. Deno can run a script with no install step at all, so: nobody commits `deno.lock` and two machines run different versions; CI resolves a new version without telling anyone; a tool that walks `node_modules` finds nothing; a fix published an hour ago "does not exist"; a token in `.npmrc` seems ignored. Each has one specific setting, and without the map people delete caches and lockfiles until things work again.

## Mental model
**Analogy:** a shared kitchen. `deno.json` (or `package.json`) is the shopping list ("flour, any 1.x"). `deno.lock` is the receipt: the exact batch bought, with a tamper seal (the integrity hash). `DENO_DIR` is the building's shared pantry that every project on the machine takes from. `node_modules/` is a fridge in your own flat, needed only when a recipe insists; `vendor/` is canning the food into your own cupboard so you can cook while the shops are shut. The minimum age is a house rule: "never buy anything delivered in the last 24 hours; recalls usually come fast".

**Artifact:** the two files after `deno add jsr:@std/path npm:chalk@5` in a project whose `deno.json` was `{}` ✅[^run].
```json
{
  "imports": {
    "@std/path": "jsr:@std/path@^1.1.6",
    "chalk": "npm:chalk@^5.6.2"
  }
}
```
```json
{
  "version": "5",
  "specifiers": {
    "jsr:@std/internal@^1.0.14": "1.0.14",
    "jsr:@std/path@^1.1.6": "1.1.6",
    "npm:chalk@^5.6.2": "5.6.2"
  },
  "jsr": {
    "@std/internal@1.0.14": {
      "integrity": "291516b3d4c35024d6ffbc0a9df5bf4c64116e05b50012cf846710152d2ffdf7"
    },
    "@std/path@1.1.6": {
      "integrity": "c68485c2a4dfbb5ae3cc74fae4e8c4e5d874cf8a8ed12927917235c758b46cbe",
      "dependencies": [
        "jsr:@std/internal"
      ]
    }
  },
  "npm": {
    "chalk@5.6.2": {
      "integrity": "sha512-7NzBL0rN6fMUW+f7A6Io4h40qQlG+xGmtMxfbnH/K7TAtt8JQWVQK+6g0UXKMeVJoyV5EkkNsErQ8pVD3bLHbA=="
    }
  },
  "workspace": {
    "dependencies": [
      "jsr:@std/path@^1.1.6",
      "npm:chalk@^5.6.2"
    ]
  }
}
```
Reading `deno.lock`: `version` is the lockfile format; `specifiers` maps each range to the version chosen; `jsr` and `npm` hold one entry per exact version with its hash and dependencies (here the transitive `@std/internal`); `workspace.dependencies` repeats what the config declares.

## How it works
**5 actors:**
- **The `deno` subcommand** (`add`, `install`, `run` …) — its job: read and write the declared ranges, via `imports` in `deno.json` or the dependency fields of `package.json`.
- **The registry** (JSR, the JavaScript Registry, at `jsr.io`; npm at `registry.npmjs.org` or the `.npmrc` registry) — its job: list versions and their publish times, via package metadata.
- **Deno's resolver** — its job: pick one version per range, via the highest version that matches and passes the minimum age.
- **The lockfile** `deno.lock` — its job: pin each choice and its hash, via its `specifiers`, `jsr` and `npm` sections.
- **The cache and linker** — its job: store each package once, via `DENO_DIR`, and expose it to the project, via `node_modules/` or `vendor/` when the mode asks for one.

```
deno add jsr:@std/path npm:chalk@5
  │ (local) which file? deno.json imports | package.json dependencies
  ▼
resolver ══ network ══▶ jsr.io/@std/path/meta.json, registry.npmjs.org/chalk
  │ highest match older than the minimum age → 1.1.6, 5.6.2
  ├─▶ deno.json   "jsr:@std/path@^1.1.6", "npm:chalk@^5.6.2"
  ├─▶ deno.lock   exact versions + integrity hashes
  ├══ network ══▶ download files and tarballs ─▶ DENO_DIR/remote, DENO_DIR/npm
  └─▶ node_modules/ or vendor/  only in auto / manual / vendor mode
```

1. **Subcommand (local), what and where.**
   - JSR names need `jsr:`; since 2.8 an unprefixed name means npm ✅[^add] (`deno add ms` printed `Add npm:ms@2.1.3` ✅[^run]).
   - npm packages go to `dependencies` in `package.json` when there is one (`--dev` → `devDependencies`), otherwise to `imports` in `deno.json`; `--package-json` or `"preferPackageJson": true` sends everything to `package.json` ✅[^add]. A JSR package added to a `package.json`-only project printed `Created deno.json configuration file.` and went there ✅[^run].
2. **Resolver → registry (network).** Downloads the metadata (`Download https://jsr.io/@std/path/meta.json`, `Download https://registry.npmjs.org/chalk`) and picks a version: `Add jsr:@std/path@1.1.6`, `Add npm:chalk@5.6.2` ✅[^run].
3. **Subcommand (local), the range written.** A caret range of the resolved version by default, `--save-exact` for none ✅[^add]; a version given exactly stays exact (`deno add npm:ms@2.0.0` wrote `"ms": "npm:ms@2.0.0"`) ✅[^run].
4. **Lockfile (local).** `deno.lock` records "the exact version and integrity hash of every dependency" ✅[^packages]; its shape in 2.9.8 is the artifact above ✅[^run].
5. **Cache (network, then local).** Tarballs and files land in `DENO_DIR`: `npm/registry.npmjs.org/chalk/5.6.2/` and `remote/https/jsr.io/<hash>` ✅[^run]. `deno info` prints the layout: `DENO_DIR location: /deno-dir/`, `Remote modules cache: /deno-dir/remote`, `npm modules cache: /deno-dir/npm`, `Emitted modules cache: /deno-dir/gen` ✅[^run]; the `DENO_DIR` variable moves it ✅[^envvars].
6. **Linker (local).** Creates a local folder only when the mode says so ✅[^denojson] ✅[^run].

   | Setting | Default when | Project after `deno run main.ts` (imports `npm:ms@^2.1.3`, `jsr:@std/path@^1.1.6`) |
   |---|---|---|
   | `"nodeModulesDir": "none"` | no `package.json` | nothing new besides `deno.lock`; npm code runs from `DENO_DIR/npm` |
   | `"nodeModulesDir": "auto"` | — | `node_modules/ms` and `node_modules/.deno/ms@2.1.3`, created by the run |
   | `"nodeModulesDir": "manual"` | a `package.json` exists | the run fails until an install fills `node_modules/` (here `deno install --entrypoint main.ts`, because the imports are inline) |
   | `"vendor": true` | — | `vendor/jsr.io/@std/path/1.1.6/…`, `vendor/jsr.io/@std/internal/…` and `node_modules/` |

**The subcommands** (flags as in `deno <cmd> --help` of 2.9.8 ✅[^run]):

| Command | What it does | Lab result ✅[^run] |
|---|---|---|
| `deno add <pkgs>` | An alias of `deno install <pkgs>` ✅[^add] | as above |
| `deno install` | No arguments: installs what `deno.json` and `package.json` declare ✅[^install]; `--entrypoint main.ts` installs what a file imports | in `manual` mode, only `--entrypoint main.ts` filled `node_modules/` for inline imports (Edge cases) |
| `deno remove <pkgs>` | Removes from the config and the lockfile; the cache keeps the files ✅[^remove] | `Removed ms`, and `ms` was gone from `deno.lock` too; an unknown name prints `No packages were removed`, exit code 0 |
| `deno outdated` | Table of `Current` (locked), `Update` (newest in range), `Latest`; `--compatible`, `-u`/`--update`, `--latest`, `-i`, `-r` ✅[^outdated] | worked example |
| `deno update [filters]` | Updates within the ranges unless `--latest`; filters take `*` and `!` ✅[^update] | `All dependencies are at newest compatible versions.`; `deno update --latest ms` → `npm:ms 2.0.0 -> 2.1.3` |
| `deno why <pkg>` | Every path from a direct dependency to the package, read from the lockfile ✅[^why] | worked example |
| `deno list` | Declared packages and resolved versions; `--depth N` draws the tree ✅[^list], new in 2.9 ✅[^v29] | worked example |
| `deno ci` | Installs strictly from the lockfile and fails if it is missing or out of date ✅[^packages] | without `deno.lock`: `error: The lockfile is out of date.` and a diff, exit code 1 |
| `deno clean` | Deletes the global cache; `--dry-run`; `--except <files>` keeps what those files need ✅[^clean] | `Removed /deno-dir/ (188 files, 5.31MB)` |
| `deno install -g` | Global executables → `deno/advanced/compile-and-distribution.md` | |

**Locking.** `--frozen`, or `"lock": { "frozen": true }`, makes new or changed lock entries an error ✅[^supply] ✅[^denojson]. After adding `"ms": "npm:ms@^2.1.3"` to `deno.json`, both `deno install --frozen` and `deno run --frozen main.ts` stopped with ``error: The lockfile is out of date. Run `deno install --frozen=false`, or rerun with `--frozen=false` to update it.``, a diff of the missing entries and exit code 1 ✅[^run]. `--lock=other.lock` writes another file, `--no-lock` left `deno.lock` byte-identical, and `"lock": false` wrote no lockfile ✅[^install] ✅[^denojson] ✅[^run].

**Refreshing.** `--reload` re-downloads everything, `--reload=npm:ms` one package (only `ms` was fetched again), and `--cached-only` refuses the network ✅[^packages] ✅[^run].

**Minimum dependency age.** "Since Deno 2.9 this is on by default with a 24-hour window." ✅[^supply] ✅[^v29]. It covers npm and JSR versions ✅[^denojson]. With a `2024-06-01` cutoff, `deno add jsr:@std/path` chose `0.225.1` ✅[^run].

| Where | Setting | Lab result for `deno add npm:chalk@5` ✅[^run] |
|---|---|---|
| `deno.json` | `"minimumDependencyAge": "P3D"`, or `{ "age": "P3D", "exclude": ["npm:@scope/pkg"] }` ✅[^denojson] | `"2023-01-01"` → `Add npm:chalk@5.2.0` (published 2022-12-08) |
| Command line | `--min-dep-age=<value>` (`--help` marks it "(Unstable)") or `--minimum-dependency-age=<value>` ✅[^add] ✅[^supply] | both → `chalk@5.2.0` for `2023-01-01`; `0` → `chalk@5.6.2` |
| `.npmrc` | `min-release-age=<whole days>` (2.8+) ✅[^supply] | `1500` → `Add npm:chalk@5.1.2` |

Values: an ISO 8601 duration (the international date-and-time standard; `P3D` = 3 days, `PT72H` = 72 hours), a number of minutes, a cutoff date (`2025-09-16`) or RFC 3339 timestamp (the internet timestamp format, `2025-09-16T12:00:00+00:00`), or `0` to turn it off ✅[^supply]. The default was observed with a local fake registry whose version 1.1.0 was one hour old: `deno add npm:fakepkg` chose `1.0.0`, and with `--min-dep-age=0` it chose `1.1.0` ✅[^run].

**Private registries.**
- npm: an `.npmrc` in the project root or `$HOME` sets `registry=`, `@scope:registry=` and `//host/:_authToken=` ✅[^node]. With `_authToken=tok-from-npmrc`, every metadata and tarball request reached the lab registry with `Authorization: Bearer tok-from-npmrc` ✅[^run].
- `NPM_CONFIG_REGISTRY` overrides the registry in `.npmrc` ✅[^node] ✅[^v28]. With `.npmrc` pointing at a closed port, the variable made the same `deno add` succeed ✅[^run].
- `https:`/`http:` modules: `DENO_AUTH_TOKENS` holds `;`-separated `{token}@{hostname[:port]}` (sent as `Bearer`) or `{username}:{password}@{hostname[:port]}` (sent as `Basic`) ✅[^private]. `s3cret@127.0.0.1:4873` arrived as `Bearer s3cret`, and `user:pw@127.0.0.1:4873` as `Basic dXNlcjpwdw==` ✅[^run].

## Worked example
One container run, starting from `deno.json` = `{}` and a `main.ts` that imports `@std/path` and `chalk` ✅[^run].

| Step | Command | Output (Deno 2.9.8) |
|---|---|---|
| 1 | `deno add jsr:@std/path npm:chalk@5` | `Add jsr:@std/path@1.1.6`, `Add npm:chalk@5.6.2`, then `Dependencies: + jsr:@std/internal 1.0.14 + jsr:@std/path 1.1.6 + npm:chalk 5.6.2`; writes the two files of Mental model |
| 2 | `deno add npm:ms@2.0.0` | `Add npm:ms@2.0.0`; `deno.json` gains `"ms": "npm:ms@2.0.0"` (exact) |
| 3 | `deno list` | rows `jsr:@std/path │ ^1.1.6 │ 1.1.6`, `npm:chalk │ ^5.6.2 │ 5.6.2`, `npm:ms │ 2.0.0 │ 2.0.0` under `Package │ Required │ Resolved` |
| 4 | `deno list --depth 1` | `jsr:@std/path 1.1.6` / `└─ jsr:@std/internal 1.0.14` / `npm:chalk 5.6.2` / `npm:ms 2.0.0` |
| 5 | `deno outdated` | `npm:ms │ 2.0.0 │ 2.0.0 │ 2.1.3` and `npm:chalk │ 5.6.2 │ 5.6.2 │ 6.0.1` under `Package │ Current │ Update │ Latest`; exit code 0 |
| 6 | `deno why @std/internal` | `@std/internal@1.0.14` / `jsr:@std/path@^1.1.6 > @std/internal@1.0.14`; exit code 0 |
| 7 | `deno why left-pad` | `error: package 'left-pad' not found in the dependency tree`; exit code 1 |
| 8 | `deno run -E main.ts` | `a/b true`; no `node_modules/` or `vendor/` appeared in the project folder |

Step 5 explains itself: `ms` is pinned exactly, so `Update` stays at 2.0.0, and `chalk` 6 is outside `^5.6.2`. In a copy of this project, `deno update --latest ms` moved `ms` to 2.1.3 and `deno outdated --update --latest chalk` printed `npm:chalk ^5.6.2 -> ^6.0.1` ✅[^run] ✅[^update].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| An integrity hash edited in `deno.lock` while the package is cached | The program ran normally; after `--reload` npm failed with `Tarball checksum did not match what was provided by npm registry for chalk@5.6.2.` and JSR with `Integrity check failed for package. The source code is invalid, as it does not match the expected hash in the lock file.` ✅[^run] | The hash was checked when the package was downloaded, not on every run |
| `manual` mode, package imported only inline (`npm:ms@^2.1.3` in `main.ts`) | `deno install` installed nothing and the run failed with `Could not find a matching package for 'npm:ms@^2.1.3' in the node_modules directory.`; `deno install --entrypoint main.ts` fixed it ✅[^run] | A plain `deno install` reads only the config files ✅[^install] |
| `package.json` lists `ms`, no install yet | ``error: Could not resolve "ms", but found it in a package.json. Deno expects the node_modules/ directory to be up to date. Did you forget to run `deno install`?`` ✅[^run] | `manual` is the default with a `package.json` ✅[^node] |
| Two names for one flag | `--frozen` and `--frozen-lockfile` both worked; `--min-dep-age` and `--minimum-dependency-age` both worked ✅[^run] | `--help` lists `--frozen-lockfile` and `--min-dep-age`; the supply-chain page uses `--frozen` and `--minimum-dependency-age` ✅[^supply]; Deno's own error hint names both age flags ✅[^run] |
| No version matching the range is old enough | `error: Could not find npm package 'chalk' matching '6'.` then `A newer matching version was found, but it was not used because it was newer than the specified minimum dependency date of 2024-06-01 00:00:00 UTC.`, exit code 1 ✅[^run] | The guard removed every version inside the range; the hint names the flags and `"minimumDependencyAge"` as the way out |
| `deno outdated` while the guard hides newer versions | Printed nothing for `chalk@5.1.2` under `min-release-age=1500` ✅[^run] | Versions newer than the cutoff are not offered |
| `deno outdated` with `NO_COLOR=1` | Its closing hint still contained colour codes (`[38;5;245mRun[39m`) ✅[^run] | A 2.9.8 output detail; strip it when parsing |
| `.npmrc` registry on a closed port | `error: npm:fakepkg was not found.` ✅[^run] | The message does not say the registry was unreachable; check `.npmrc` and `NPM_CONFIG_REGISTRY` first |
| `deno why` as a CI gate | Exit code 1 when the package is absent ✅[^run] | The docs suggest `! deno why left-pad` ✅[^why] |
| `vendor: true` after `deno clean` | `deno run --cached-only main.ts` still printed `1m a/b` ✅[^run] | Remote modules come from `vendor/`, npm packages from `node_modules/` ✅[^packages] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `nodeModulesDir: "none"` | A clean repo; one shared copy per machine ✅[^node] | Tools and add-ons that read `node_modules` fail ✅[^node] |
| `"auto"` | `node_modules` exists and Deno keeps it current ✅[^denojson] | A folder in the project; the run itself installs |
| `"manual"` | Works with an existing `package.json` install step ✅[^node] | Forgetting `deno install` breaks the run |
| `vendor: true` | Offline and hermetic builds; survives a missing source ✅[^supply] | `vendor/` and `node_modules/` live in the repo |
| `--frozen` / `deno ci` | No silent version changes in CI ✅[^supply] | Intended updates need `--frozen=false` |
| A longer minimum age | More time for a bad release to be caught and pulled ✅[^supply] | Fixes arrive later; exempt your own packages with `exclude` |

## Takeaways
- Commit `deno.lock`, and install in CI with `deno ci` or `--frozen`. [rule-candidate]
- Declare every package in `deno.json` or `package.json`, even one imported inline, so `deno install`, `outdated` and `update` see it. [rule-candidate]
- Keep the default 24-hour minimum age; exempt only packages you publish yourself, with `exclude`. [rule-candidate]
- Run `deno why <pkg>` before removing or overriding a transitive package, and `! deno why <banned>` as a CI gate.
- Pick `nodeModulesDir` on purpose: `none` unless a tool needs `node_modules`.

## Verification status
- Verified: 79 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example and Edge cases. Private-registry and default-age results came from a fake npm registry and module host on `127.0.0.1:4873` inside the container. [^run]
- [Dependency management](https://docs.deno.com/runtime/packages/) — Deno project, living. Rank 1. Backs: what `deno.lock` records, `deno ci`, `--reload`, `--cached-only`, vendoring. [^packages]
- [Supply chain management](https://docs.deno.com/runtime/packages/supply_chain/) — Deno project, living. Rank 1. Backs: the 24-hour default, the three age settings and value formats, `--frozen`, `lock.frozen`, vendoring versus lockfile. [^supply]
- [Configuration file (deno.json)](https://docs.deno.com/runtime/reference/deno_json/) — Deno project, living. Rank 1. Backs: `nodeModulesDir` modes and defaults, `lock` options, `minimumDependencyAge` with `exclude` covering npm and JSR. [^denojson]
- [Node and npm Compatibility](https://docs.deno.com/runtime/fundamentals/node/) — Deno project, living. Rank 1. Backs: `.npmrc` location and keys, `NPM_CONFIG_REGISTRY` precedence, `manual` default with `package.json`, when to use each mode. [^node]
- [Private repositories](https://docs.deno.com/runtime/packages/private_repositories/) — Deno project, living. Rank 1. Backs: `DENO_AUTH_TOKENS` bearer and basic forms with ports. [^private]
- [Environment variables](https://docs.deno.com/runtime/reference/env_variables/) — Deno project, living. Rank 1. Backs: `DENO_DIR`. [^envvars]
- [deno add](https://docs.deno.com/runtime/reference/cli/add/) — Deno project, living. Rank 1. Backs: alias of `deno install`, unprefixed names as npm, target file rules, caret default, `--save-exact`, `--min-dep-age`. [^add]
- [deno install](https://docs.deno.com/runtime/reference/cli/install/) — Deno project, living. Rank 1. Backs: `deno install` with no arguments, `--entrypoint`, `--lock`, `--no-lock`. [^install]
- [deno remove](https://docs.deno.com/runtime/reference/cli/remove/) — Deno project, living. Rank 1. Backs: removal leaves the cache. [^remove]
- [deno outdated](https://docs.deno.com/runtime/reference/cli/outdated/) — Deno project, living. Rank 1. Backs: the columns and flags. [^outdated]
- [deno update](https://docs.deno.com/runtime/reference/cli/update/) — Deno project, living. Rank 1. Backs: compatible-only default, `--latest`, filters. [^update]
- [deno why](https://docs.deno.com/runtime/reference/cli/why/) — Deno project, living. Rank 1. Backs: paths read from the lockfile, the CI gate. [^why]
- [deno list](https://docs.deno.com/runtime/reference/cli/list/) — Deno project, living. Rank 1. Backs: declared packages, `--depth`. [^list]
- [deno clean](https://docs.deno.com/runtime/reference/cli/clean/) — Deno project, living. Rank 1. Backs: removes the global cache, `--dry-run`, `--except`. [^clean]
- [Deno 2.8](https://deno.com/blog/v2.8) — Deno project, 2026. Rank 1. Backs: `NPM_CONFIG_REGISTRY` overriding `.npmrc`. [^v28]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: minimum age on by default with 24 hours, `deno list`. [^v29]

## Related
- `deno/modules/module-specifiers-and-imports.md` — how the `jsr:`, `npm:` and bare specifiers these commands write are resolved.
- `deno/configuration/deno-json-reference.md` — every key named here, with its type and default.
- `deno/configuration/workspaces-and-monorepos.md` — lockfiles, `node_modules` and `deno outdated -r` across workspace members.
- `deno/node-compat/node-and-npm-compatibility.md` — `package.json`, lifecycle scripts and `--allow-scripts`.
- `deno/advanced/compile-and-distribution.md` — `deno install -g` and `deno compile`.
- `deno/deno-lab-setup.md` — the container the outputs above came from.
