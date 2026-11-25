---
schema: knowledge-doc/v1
type: how-to
topic: bun/package-manager
status: verified
applies-to: ["Bun 1.4.5", "Bun 1.3.14 and 1.4.6-canary.1 (version comparisons in Troubleshooting)", "Verdaccio 6.11.3 (local registry in the lab)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, workspaces, monorepo, workspace-protocol, catalogs, filter, bun-run, bun-pm-pack, bun-publish]
---

# Set up a Bun monorepo: workspaces, the `workspace:` protocol, catalogs and `--filter`

## Summary
**TL;DR:** List the package folders in the root `package.json` `workspaces`, make packages depend on each other with `workspace:*` or `workspace:^`, and put shared version ranges in a `catalog` (or named `catalogs`) that workspaces reference as `catalog:` or `catalog:<name>` ✅[^1] ✅[^2]. One `bun install` at the root installs every workspace and links them to each other ✅[^1] ✅[^lab]. `--filter` selects workspaces by name, path, folder or dependency relation for `bun install`, `bun add`, `bun run` and other commands; `bun run --filter` starts a package only after the workspaces it depends on finish ✅[^3] ✅[^lab]. `bun pm pack` and `bun publish` replace `workspace:` and `catalog:` with real versions ✅[^1] ✅[^2] ✅[^lab].
**Use this when:** you create or extend a monorepo with Bun, run a script across packages, add a dependency to one package from the root, or prepare a workspace package for publishing.
**Not this doc:** why a monorepo gets `node_modules/.bun` and what that blocks → [linkers-hoisted-and-isolated.md](linkers-hoisted-and-isolated.md); `bun run` for one package (scripts, `pre`/`post` hooks) → `bun/fundamentals/running-code-and-transpilation.md`; every flag of every command → [pm-commands-reference.md](pm-commands-reference.md).

## Goal & prerequisites
**End state:** a repository with four workspace packages (`@demo/utils`, `@demo/cfg`, `@demo/app`, `docs`) that share `ms` and `is-number` versions through catalogs, run their `build` scripts in dependency order with one command, and pack `@demo/app` with real version numbers in place of `workspace:` and `catalog:`.

A **workspace** is one package folder inside the repository, with its own `package.json`, that the root treats as part of the same project; a **monorepo** is a repository that holds several such packages. A **catalog** is a named list of version ranges in the root `package.json`, like a shared price list that every shop in a chain reads instead of printing its own: `"ms": "catalog:"` means "whatever range the root's catalog gives `ms`".

**Needs:** Bun 1.4.5 (`bun --revision` prints `1.4.5+a7733435c` in the lab), network access to the npm registry, and `tar` to inspect the packed file ✅[^lab].

## Steps
1. **Write the root `package.json`.** `workspaces` can be a list of globs or an object with `packages`, `catalog` and `catalogs` ✅[^1] ✅[^2]:
   ```json
   {
     "name": "mono",
     "private": true,
     "workspaces": {
       "packages": ["packages/*"],
       "catalog": { "ms": "^2.1.3" },
       "catalogs": { "num": { "is-number": "^7.0.0" } }
     },
     "scripts": { "build": "echo root build" }
   }
   ```
2. **Write the workspace packages.** Every workspace needs a `name`; a matched folder without one is skipped with a warning ✅[^1]. In the lab a nameless `package.json` with dependencies gave `warn: skipping workspace "packages/noname": package.json has no "name"`, and one holding only `{ "type": "module" }` was skipped without a warning, as the docs say for a folder with no dependencies ✅[^1] ✅[^lab].
   ```jsonc
   // packages/utils/package.json
   { "name": "@demo/utils", "version": "1.2.3", "main": "index.js",
     "dependencies": { "ms": "catalog:" },
     "scripts": { "build": "echo utils start && sleep 1 && echo utils done" } }
   // packages/cfg/package.json
   { "name": "@demo/cfg", "version": "2.0.0", "main": "index.js",
     "scripts": { "build": "echo cfg start && sleep 1 && echo cfg done" } }
   // packages/app/package.json
   { "name": "@demo/app", "version": "0.1.0", "main": "index.js",
     "dependencies": { "@demo/utils": "workspace:*", "@demo/cfg": "workspace:^",
                       "is-number": "catalog:num", "ms": "catalog:" },
     "scripts": { "build": "echo app start && echo app done" } }
   // packages/docs/package.json
   { "name": "docs", "version": "0.0.1", "private": true, "scripts": { "lint": "echo docs lint" } }
   ```
   `packages/utils/index.js` exports `(s) => require("ms")(s)`, `packages/cfg/index.js` exports `{ unit: "1h" }`, and `packages/app/index.js` prints `unit, "=", toMs(unit), "ms; isNumber:", isNumber(toMs(unit))`.
3. **Install from the root.**
   ```console
   $ bun install
   Resolved, downloaded and extracted [8]
   Saved lockfile
   2 packages installed [757.00ms]
   ```
   A new project with workspaces gets the isolated linker, so the two registry packages sit in `node_modules/.bun/` and each workspace's `node_modules` holds symlinks ✅[^lab]:
   ```console
   $ ls -l packages/app/node_modules packages/app/node_modules/@demo
   is-number -> ../../../node_modules/.bun/is-number@7.0.0/node_modules/is-number
   ms -> ../../../node_modules/.bun/ms@2.1.3/node_modules/ms
   cfg -> ../../../cfg
   utils -> ../../../utils
   ```
   `bun.lock` records each workspace under `"workspaces"` (`"packages/app": { "name": "@demo/app", "version": "0.1.0", "dependencies": { "@demo/cfg": "workspace:^", … "ms": "catalog:" } }`), copies the `"catalog"` and `"catalogs"` sections, and lists each workspace package as `"@demo/app": ["@demo/app@workspace:packages/app"]` ✅[^lab] ✅[^2].
4. **Run the app.** `bun packages/app/index.js` prints `1h = 3600000 ms; isNumber: true` ✅[^lab].
5. **Add a dependency to one workspace from the root.** Put `--filter` after the subcommand ✅[^3]:
   ```console
   $ bun add ms --filter docs          # the default catalog already lists ms
   $ bun add is-odd --catalog=num --filter docs
   ```
   `packages/docs/package.json` now has `"ms": "catalog:"` and `"is-odd": "catalog:num"`, and the root gained `"is-odd": "^3.0.1"` under `catalogs.num` ✅[^lab]. A plain `bun add x` writes `catalog:` whenever the default catalog lists `x`; `--catalog` adds the resolved range to the root catalog first ✅[^2] ✅[^6] ✅[^lab].
6. **Install only some workspaces** (for example in a Docker layer). In a checkout without `node_modules`:
   ```console
   $ bun install --filter '@demo/app'
   2 packages installed [187.00ms]
   $ ls node_modules/.bun
   is-number@7.0.0  ms@2.1.3  node_modules
   ```
   `--filter '@demo/utils'` installed only `ms` ✅[^lab]. Several `--filter` flags combine: all positive matches minus every `!` match (the `!@demo/cfg` row in step 8) ✅[^3] ✅[^lab].
7. **Run a script in every workspace.** Without `--parallel`, `bun run --filter` waits for a package's workspace dependencies ✅[^3]. Lab output with timestamps (seconds) ✅[^lab]:
   ```console
   $ bun run --filter '*' build
   33.67 @demo/utils build: utils start
   33.69 @demo/cfg build: cfg start
   34.68 @demo/cfg build: cfg done
   34.69 @demo/cfg build: Exited with code 0
   34.71 @demo/utils build: utils done
   34.72 @demo/utils build: Exited with code 0
   34.73 @demo/app build: app start
   34.76 @demo/app build: app done
   34.77 @demo/app build: Exited with code 0
   ```
   `utils` and `cfg` ran side by side; `app`, which depends on both, started after both exited. `docs` has no `build` and was skipped. In a terminal (TTY, an interactive console) Bun draws a live view per package instead of these prefixed lines ✅[^3]; `--elide-lines <n>` (or `[run] elide-lines`) keeps the last *n* lines per package there, and had no effect on the piped output above ✅[^8] ✅[^lab]. Run under `script` (a tool that gives a command a pseudo-terminal), the lab got that view: a bold `@demo/utils build $ …` header, output lines behind `│`, a closing `└─ Done in 1.00 s`, redrawn in place with cursor-up codes; with `--elide-lines 1` the earlier line became `│ [1 lines elided]` ✅[^lab].
8. **Pick packages with a pattern.** The grammar is the same for every command that takes `--filter` (`-F`) ✅[^3]:

   | Pattern | Selects | Lab: `build` ran in |
   |---|---|---|
   | `'*'` | every workspace (name glob; `*` does not cross `/`) | utils, cfg, app ✅[^lab] |
   | `'@demo/*' --filter '!@demo/cfg'` | names matching, minus the excluded one | utils, app ✅[^lab] |
   | `'./packages/*'` | workspaces whose folder matches the path glob | utils, cfg, app ✅[^lab] |
   | `'{packages}'` | every workspace in or below that folder | 3 packages ✅[^lab] |
   | `'@demo/app...'` | app and every workspace it depends on | utils, cfg, then app ✅[^lab] |
   | `'@demo/app^...'` | only what app depends on | cfg, utils ✅[^lab] |
   | `'...@demo/utils'` | utils and every workspace that depends on it | utils, then app ✅[^lab] |
   | `'...^@demo/utils'` | only the dependents, not utils itself | app ✅[^3] ✅[^lab] |

   `bun --filter '@demo/cfg' build` is a shorthand for `bun run --filter …`, and it works from any folder inside the repository (the lab ran it from `packages/docs`) ✅[^3] ✅[^lab]. Commands that accept `--filter`: `bun run`, `bun install`, `bun add`, `bun remove`, `bun update`, `bun outdated`, `bun prune`, `bun pm licenses` ✅[^3], and `bun publish` ✅[^5]; the lab ran each of them with `--filter` (`outdated` and `publish` in a second monorepo, the rest in this one or in Troubleshooting) ✅[^lab].
9. **Choose parallel or sequential output when order does not matter.**
   ```console
   $ bun run --parallel --filter '*' build
   32.59 @demo/app:build   | app start
   32.60 @demo/app:build   | app done
   32.66 @demo/app:build   | Done in 9ms
   32.69 @demo/cfg:build   | cfg start
   32.77 @demo/utils:build | utils start
   33.61 @demo/utils:build | utils done
   ```
   `--parallel` started `app` first, before its dependencies, and uses the `package:script |` prefix ✅[^lab] ✅[^3]. `--sequential` runs one at a time with the same prefix, and `--no-exit-on-error` keeps the others running after a failure ✅[^3]. In a lab monorepo where `cfg`'s `build` exits 3: `--sequential` ran `app`, then `cfg`, and stopped (`utils` never ran; exit 3); with `--no-exit-on-error` it went on to `utils` (still exit 3); `--sequential` followed name order, not dependency order (`app` before `utils`, which it depends on); and under `--parallel` the scripts already running finished even without the flag ✅[^lab]. `--workspaces` runs a script in every workspace and errors on one without it (`error: Missing 'build' script at '/tmp/mono/packages/docs'`); add `--if-present` to skip such packages ✅[^lab] ✅[^3].
10. **Pack a workspace package.** In `packages/app`:
    ```console
    $ bun pm pack
    packed 263B package.json
    packed 190B index.js
    demo-app-0.1.0.tgz
    $ mkdir -p /tmp/x && tar -xzf demo-app-0.1.0.tgz -C /tmp/x && cat /tmp/x/package/package.json
      "dependencies": {
        "@demo/utils": "1.2.3",
        "@demo/cfg": "^2.0.0",
        "is-number": "^7.0.0",
        "ms": "^2.1.3"
      },
    ```
    `bun pm pack` builds the `.tgz` that `npm pack` would, from the files that would be published ✅[^4]. On one folder, `npm pack` (npm 11.19.1) and `bun pm pack` listed the same eight files: both honoured `.npmignore` (`test/` left out), skipped `node_modules`, and both packed `.env` and `debug.log`, so keep secrets out with `files` or `.npmignore` ✅[^lab]. The rewrite rules ✅[^1] ✅[^2] ✅[^lab]:

    | In `package.json` | Packed or published as |
    |---|---|
    | `"workspace:*"` | the workspace's version, `1.2.3` ✅[^lab] |
    | `"workspace:^"` / `"workspace:~"` | `^2.0.0` (`@demo/cfg` is 2.0.0) / `~1.0.1` (a second lab repo whose `pkg-b` is 1.0.1) ✅[^1] ✅[^lab] |
    | `"workspace:1.0.2"` | `1.0.2`, whatever the workspace's version ✅[^1]; in the lab only `bun pm pack` did that, `bun install` and `bun publish` failed (see Troubleshooting) ✅[^lab] |
    | `"workspace:^1.0.0"` | `^1.0.0`, the range as written (lab, workspace at 1.3.0) ✅[^lab] |
    | `"b": "workspace:pkg-b@*"` or `"c": "workspace:../pkg-b"` / `"bb": "workspace:pkg-b@^"` | `npm:pkg-b@1.0.1` (an alias, because the names differ) / `npm:pkg-b@^1.0.1` ✅[^1] ✅[^lab] |
    | `"catalog:"` / `"catalog:num"` | the catalog's range, `^2.1.3` / `^7.0.0` ✅[^lab] |
11. **Publish.** `bun publish` packs the same way and uploads; `--recursive` publishes every workspace whose version is not on the registry yet, dependencies first, and `--filter` publishes the matching ones ✅[^5] ✅[^lab]. The lab published a copy of this monorepo (scope `@mono`) to a local Verdaccio 6.11.3 registry, with a token in the root `.npmrc` ✅[^lab]:
    - `bun publish --filter '@mono/app' --dry-run` printed the files and `+ @mono/app@0.1.0 (dry-run)`, and uploaded nothing.
    - `bun publish --recursive` printed `skipped mono: private` and `skipped @mono/docs: private`, then published `@mono/cfg`, `@mono/pin2` (an extra workspace at 1.3.0 that `app` lists as `workspace:^1.0.0`) and `@mono/utils` before `@mono/app`, which depends on them; a second run printed `skipped <name>@<version>: already on the registry` for each of the four and exited 0.
    - The registry's copy of `@mono/app` had `"@mono/utils": "1.2.3"`, `"@mono/cfg": "^2.0.0"`, `"is-number": "^7.0.0"` and `"ms": "^2.1.3"`, both in the tarball's `package.json` and in the version manifest; no `workspace:` or `catalog:` was left.
    - In an empty project, `bun add @mono/app` installed it with its 5 dependencies from the registry.

## Verify
```console
$ bun packages/app/index.js
1h = 3600000 ms; isNumber: true
$ bun install --frozen-lockfile
Checked 9 installs across 7 packages (no changes) [1.00ms]
$ bun run --filter '*' build 2>&1 | grep Exited
@demo/utils build: Exited with code 0
@demo/cfg build: Exited with code 0
@demo/app build: Exited with code 0       # always after the two it depends on
$ grep -E '"(@demo/utils|ms)"' /tmp/x/package/package.json
    "@demo/utils": "1.2.3",
    "ms": "^2.1.3"
```
These are the lab outputs; the `utils` and `cfg` lines can swap places because they run concurrently ✅[^lab].

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `error: ms@catalog:nope: there is no catalog named "nope" in the root package.json` | A `catalog:<name>` reference with no such catalog ✅[^lab] | Add the catalog or fix the name; a `catalog:` entry must exist in `catalog` or `catalogs` ✅[^2] |
| `bun run --filter mono build` or `--filter './' build`: `error: No workspace packages matched the filter` | `bun run --filter` did not select the root package in the lab, by name or by `./` ✅[^lab] | Run the root script with plain `bun run build` |
| `bun add ms --filter nomatch`: `error: No workspace packages matched the filter "nomatch"`; `bun install --filter nomatch` only warns | Selecting nothing is an error for `add`, `remove`, `update`, `prune`, `pm licenses` and a warning for `install` ✅[^3] ✅[^lab] | Check names with the full scope: `core` does not match `@acme/core` ✅[^3]; lab: `bun run --filter utils build` gave `No workspace packages matched the filter "utils"` for `@demo/utils` ✅[^lab] |
| `error: No matching version for workspace dependency "pin". Version: "workspace:1.0.2"` | The workspace `pin` is at 1.0.1: in the lab `bun install` and `bun publish` treat the number after `workspace:` as a version the workspace must match, although the docs say it is published as written ✅[^1] ✅[^lab] | Make the number match the workspace's `version`, or use `workspace:^` |
| `error: Missing 'build' script at '…/packages/docs'` | `--workspaces` (and `--sequential --workspaces`) require the script in every workspace ✅[^lab] | Add `--if-present` ✅[^3] |
| A dependent's script ran although its dependency's script failed | Lab: with `cfg` exiting 3, `app` still built; the command exited 3 ✅[^lab] | Check the exit code in CI (continuous integration); do not rely on the order to stop a broken chain |
| Output order ignores dependencies | `--parallel` starts every package at once ✅[^lab] | Use plain `--filter` for dependency order ✅[^3] |
| A published package contains `"workspace:*"` or `"catalog:"` | It was published with a tool that does not rewrite them | Publish with `bun publish` or pack with `bun pm pack` ✅[^1] ✅[^2]; Bun 1.4 refuses `workspace:` inside a downloaded package ✅[^7]. Lab: `raw-ws`, published with `npm publish` and `"ms": "workspace:*"`, made `bun add raw-ws` fail with `error: Workspace dependency "ms" not found` and `error: ms@workspace:* failed to resolve`, exit 1 ✅[^lab]. But in a monorepo that has a workspace named `ms`, Bun 1.4.5 installed `raw-ws` from a registry and linked its `ms` to that workspace, so `require("ms")` inside `raw-ws` loaded `packages/ms/index.js`, under both linkers; Bun 1.3.14 and `1.4.6-canary.1` did the same, so the release-note claim did not hold in the lab ✅[^lab] |
| `bun add x --filter '*'` did not touch the root | Since Bun 1.4, `add` and `remove` with `--filter '*'` leave out the root ✅[^7]; lab: `bun add is-number --filter '*'` edited both workspaces and not the root `package.json` ✅[^lab]. Bun 1.3.14 read the filter's value as one more package to add, as the 1.4 notes say older versions did: `--filter '*'` gave `error: unrecognised dependency format: *`, and `--filter lib-x` with a workspace `lib-x` gave `error: Package "lib-x@1.0.0" has a dependency loop` ✅[^7] ✅[^lab] | Run `bun add x` in the root folder |
| `bun publish --dry-run`: `error: missing authentication` | Bun 1.4.5 checks for credentials even in a dry run; with a token in `.npmrc` the same dry run worked and uploaded nothing ✅[^lab] | Use `bun pm pack --dry-run` to see the files, or log in first |

## Rollback
Delete `workspaces` (and with it `catalog`/`catalogs`) from the root `package.json`, replace every `workspace:` and `catalog:` range with a real range, then `rm -rf node_modules packages/*/node_modules bun.lock && bun install` in each package you keep.

## Takeaways
- Depend on sibling packages with `workspace:*` (exact) or `workspace:^` (range) and publish only through `bun publish` or `bun pm pack`, which rewrite them. [rule-candidate]
- Keep a shared dependency's range in one root catalog and write `catalog:` in every workspace; `bun add <pkg>` then reuses it.
- Use `bun run --filter '<pkg>...' build` to build a package with its workspace dependencies first, and check the exit code, because a failed dependency does not stop its dependents.
- Put `--filter` after the subcommand (`bun install --filter api`); `bun --filter <pattern> <word>` treats `<word>` as a script.

## Verification status
- Verified: 96 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24 and 2026-11-25; `oven/bun:1.3.14` (`1.3.14+0d9b296af`) and `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`) for the version comparisons, with made-up packages (`raw-ws`, `lib-x`, `plain-a`) from a small Bun script serving a fake registry on a private Docker network; publishing went to `verdaccio/verdaccio:6` (6.11.3) on a private Docker network with a test user; `node:24.22.1-alpine` (npm 11.19.1) published the raw `workspace:` package and ran `npm pack` for the comparison. [^lab]
- [Workspaces](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/workspaces.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `workspaces` globs, `name` requirement, `workspace:` forms and how publishing rewrites them. [^1]
- [Catalogs](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/catalogs.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `catalog`/`catalogs`, references, lockfile sections, publishing rewrite, missing-entry rule. [^2]
- [bun --filter](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/filter.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: pattern grammar, commands that accept it, dependency order, terminal view, `--parallel`/`--sequential`, `--if-present`, errors on empty selection. [^3]
- [bun pm](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/pm.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `bun pm pack`. [^4]
- [bun publish](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/publish.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `--recursive`, `--filter`, `--dry-run`. [^5]
- [bun add](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/add.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `--catalog`, `--filter`. [^6]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: `workspace:` only in the project's own files, `add`/`remove --filter '*'` leaving out the root. [^7]
- [bunfig.toml](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/bunfig.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `run.elide-lines`. [^8]

## Related
- `bun/package-manager/linkers-hoisted-and-isolated.md` — the isolated layout a new monorepo gets.
- `bun/package-manager/install-mechanics-and-lockfile.md` — `bun.lock` and `--frozen-lockfile`.
- `bun/package-manager/pm-commands-reference.md` — flags of `bun add`, `bun update`, `bun outdated`, `bun publish`.
- `bun/fundamentals/running-code-and-transpilation.md` — `bun run` for a single package.
- `linux/lab-setup.md` — the lab.
