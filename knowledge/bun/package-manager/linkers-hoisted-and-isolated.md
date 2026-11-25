---
schema: knowledge-doc/v1
type: concept
topic: bun/package-manager
status: verified
applies-to: ["Bun 1.4.5", "macOS 26.1 arm64 (global virtual store benchmark, Bun 1.4.5 cross-compiled for the host)", "Bun 1.1.45 and 1.3.14 (default-linker and global-store history)", "pnpm 12.23.0 on Node.js 24.22.1 (layout comparison)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, bun-install, linker, hoisted, isolated, node-modules, phantom-dependencies, global-virtual-store, configversion, pnpm, workspaces]
---

# Hoisted and isolated linkers, phantom dependencies and the global virtual store

## Summary
**TL;DR:** The *linker* decides the shape of `node_modules`. `hoisted` puts every package once at the top of `node_modules`, the npm and Yarn layout, so code can import a package it never declared (a *phantom dependency*). `isolated` puts each package in `node_modules/.bun/<name>@<version>/node_modules/<name>` with symlinks to only the packages it declares, the pnpm layout ✅[^1] ✅[^lab]. In Bun 1.4.5 a new project with `workspaces` gets `isolated`, a new single-package project gets `hoisted`, and any lockfile with `configVersion: 0` (made before Bun 1.3.2, or migrated from npm or Yarn) keeps `hoisted` ✅[^1] ✅[^6] ✅[^lab]. The *global virtual store* is an opt-in for the isolated linker that turns each `node_modules/.bun/<name>@<version>` into a symlink to one shared copy under `<cache>/links/` ✅[^2] ✅[^lab].
**Use this when:** an import works on one machine and fails on another, you choose a layout for a monorepo, you wonder why a project got `node_modules/.bun`, or you want to share package folders across checkouts.
**Not this doc:** how packages reach the cache and `bun.lock` → [install-mechanics-and-lockfile.md](install-mechanics-and-lockfile.md); setting up workspaces → [workspaces-catalogs-and-filter.md](workspaces-catalogs-and-filter.md); the `[install]` keys in one table → [pm-commands-reference.md](pm-commands-reference.md).

## Problem
- An app imports `supports-color` without listing it. It works because `chalk` pulled it in and the hoisted layout put it at the top. A later `chalk` upgrade drops it, or a teammate's install uses the isolated layout, and the import fails with `Cannot find module`.
- In a monorepo, one workspace silently uses another workspace's dependencies, so publishing it alone breaks.
- The default changed twice (Bun 1.3.0 made isolated the default for workspaces, 1.3.2 limited that to new projects), so two repos on the same Bun version get different layouts ✅[^5] ✅[^6]. In the lab, Bun 1.1.45 had no `--linker` flag and laid a fresh monorepo out flat, while 1.3.14 and 1.4.5 gave the same monorepo `node_modules/.bun` ✅[^lab].

## Mental model
**Analogy:** the hoisted layout is an open-plan office where every package works at one big table, so anyone can grab any tool on it, even one they never asked for. The isolated layout gives each package its own office (a store entry) with a phone list (symlinks) of the colleagues it declared. A phantom dependency is borrowing a tool from the big table: it works until the owner leaves.

A **symlink** (symbolic link) is a small file that only holds a path to another file or folder; opening it opens the target.

**Artifact:** the same project (`app` depends on `chalk@^4.1.2`) after each linker, Bun 1.4.5 ✅[^lab]:
```console
# --linker hoisted
$ ls node_modules
ansi-styles  app  chalk  color-convert  color-name  has-flag  supports-color

# --linker isolated
$ ls -A node_modules node_modules/.bun
node_modules:      .bun
node_modules/.bun: ansi-styles@4.3.0  chalk@4.1.2  color-convert@2.0.1  color-name@1.1.4  has-flag@4.0.0  node_modules  supports-color@7.2.0
$ ls -l packages/app/node_modules
chalk -> ../../../node_modules/.bun/chalk@4.1.2/node_modules/chalk
$ ls -l node_modules/.bun/chalk@4.1.2/node_modules
ansi-styles -> ../../ansi-styles@4.3.0/node_modules/ansi-styles
chalk                                   # the real files, hard-linked from the cache
supports-color -> ../../supports-color@7.2.0/node_modules/supports-color
```

## How it works
Three actors decide what an `import` finds:
- **Linker selection** — its job: pick `hoisted` or `isolated`, via `--linker`, `install.linker` in `bunfig.toml` or `node-linker` in `.npmrc`, else the lockfile's `configVersion`.
- **The linker** — its job: build the folder tree, via hard links from the global cache and symlinks between packages.
- **Module resolution** (Bun's runtime or Node.js) — its job: find a bare import such as `require("chalk")`, via the `node_modules` folders above the importing file's real path.

1. **Linker selection (local):** the `--linker` flag wins, then the config files (lab: `linker = "hoisted"` in `bunfig.toml` plus `--linker isolated` gave `.bun`); without either, the default comes from this table ✅[^1] ✅[^4] ✅[^lab]:

   | `configVersion` in `bun.lock` | Workspaces? | Default linker | Lab |
   |---|---|---|---|
   | `1` (new projects since 1.3.2) | yes | `isolated` | fresh monorepo got `node_modules/.bun` ✅[^lab] |
   | `1` | no | `hoisted` | fresh single package got a flat tree ✅[^lab] |
   | `0` (older lockfiles, npm or Yarn migrations) | yes or no | `hoisted` | monorepo with `configVersion` edited to 0 got a flat tree ✅[^lab] |

   A lockfile without the field is treated as `0`, and Bun writes `"configVersion": 0` into it on the next install ✅[^1] ✅[^lab]. A pnpm migration gets `1` ✅[^1] ✅[^lab]. Bun 1.3.14 (`oven/bun:1.3.14`) gave all three table rows and the missing-field case the same results as 1.4.5; Bun 1.3.0 and 1.3.2, where the two changes landed, were not in the lab, so those dates rest on the release notes ✅[^5] ✅[^6] ✅[^lab].
2. **Hoisted linker (local):** each package version is placed once, as high in `node_modules` as it can go; a workspace package is linked at the root too (`app` above) ✅[^lab]. `--backend` and the hard links work as in [install-mechanics-and-lockfile.md](install-mechanics-and-lockfile.md).
3. **Isolated linker (local):**
   - Each package gets a store entry `node_modules/.bun/<name>@<version>/node_modules/<name>` whose files are hard links to the cache (link count 2 in the lab) ✅[^1] ✅[^lab].
   - Next to it, one symlink per declared dependency points at that dependency's store entry ✅[^1] ✅[^lab].
   - The root `node_modules` and each workspace's `node_modules` hold symlinks to their *direct* dependencies only; workspace packages are symlinked to their source folders ✅[^1] ✅[^lab].
   - Scoped names use `+` for `/` (`@types+react@18.2.0`), and an entry with peer dependencies gets a `+<16 hex>` suffix for each distinct peer set ✅[^1]. Lab: `@lab/hello` became `@lab+hello@1.0.0`, and `plugin-x` used by two workspaces with different `peer-host` versions became `plugin-x@1.0.0+57a833830f387679` and `plugin-x@1.0.0+603cea61f8b4eec9` ✅[^lab].
   - `node_modules/.bun/node_modules` is a fallback folder with a symlink for every package name ✅[^1] ✅[^lab].
4. **Module resolution (local, at run time):** starting from the importing file's real path, it tries each parent's `node_modules`. From `packages/app/index.js` that is `packages/app/node_modules`, then the root `node_modules`, where only direct dependencies live. From inside `node_modules/.bun/chalk@4.1.2/node_modules/chalk/` it first sees chalk's declared siblings, then the `.bun/node_modules` fallback, then the root ✅[^1] ✅[^lab].

### What can import what (measured)
`require.resolve()` results in Bun 1.4.5, one fresh project per column with the linker set in `bunfig.toml` ✅[^lab]:

| Import | `hoisted` | `isolated` (default) | `isolated`, `hoist = false` | `isolated`, global store |
|---|---|---|---|---|
| `chalk` from `app` (declared) | resolved | resolved | resolved | resolved |
| `supports-color` from `app` (undeclared, chalk's dependency) | resolved | `MODULE_NOT_FOUND` | `MODULE_NOT_FOUND` | `MODULE_NOT_FOUND` |
| `has-flag` from inside `chalk` (undeclared by chalk) | resolved | resolved, via `.bun/node_modules` | `MODULE_NOT_FOUND` | `MODULE_NOT_FOUND` |

`install.hoist = false` (or `hoist=false` in `.npmrc`) skips the fallback folder, so store packages resolve only what they declare plus whatever is linked at the root ✅[^1] ✅[^4]. `install.hoistPattern` limits which names go into the fallback, and `install.publicHoistPattern` copies matching names to the root `node_modules` for every package to see ✅[^4]; with `hoistPattern = ["has-*"]` the lab's `.bun/node_modules` held only `has-flag` instead of six names, and with `publicHoistPattern = ["supports-color"]` the root held `.bun chalk supports-color` ✅[^lab].

### The global virtual store
Without it, every project builds its own store entries. With it, a store entry is created once in `<cache>/links/<name>@<version>-<16 hex>/` and each project's `node_modules/.bun/<name>@<version>` is a symlink to it ✅[^2] ✅[^lab]. The hash covers the package and every dependency it links to, so two projects share an entry only when they resolved the same dependency versions ✅[^2]. In the lab a project that overrode `supports-color` to 7.1.0 linked `chalk@4.1.2-50cbd727ae2e89e3`, a plain one `chalk@4.1.2-d4ffa048793dcb3d` ✅[^lab].

- **Turn it on:** `linker = "isolated"` plus `globalStore = true` under `[install]` in `bunfig.toml`, or `BUN_INSTALL_GLOBAL_STORE=1 bun install --linker isolated` (lab: both gave symlinks into `<cache>/links/`) ✅[^2] ✅[^4] ✅[^lab]. It is off by default, and the hoisted linker ignores it (the lab's hoisted install with `globalStore = true` stayed flat) ✅[^2] ✅[^lab].
- **What the lab saw:** `chalk@4.1.2 -> /root/.bun/install/cache/links/chalk@4.1.2-d4ffa048793dcb3d`, and a plain isolated install without the setting still made a real folder `drwxr-xr-x node_modules/.bun/chalk@4.1.2` ✅[^lab]. The Bun 1.4 release notes say the isolated linker "now uses a shared global virtual store" but also that it is opt-in; in 1.4.5 it needs the setting ✅[^7] ✅[^lab]. The notes tag the feature `v1.3.14`, and in Bun 1.3.14 `BUN_INSTALL_GLOBAL_STORE=1 bun install --linker isolated` already linked `chalk@4.1.2` to `<cache>/links/chalk@4.1.2-622f856b42fd873b`; 1.4.5 named the same resolution `-d4ffa048793dcb3d`, as expected from a hash that covers the entry layout's version ✅[^7] ✅[^2] ✅[^lab].
- **What stays project-local:** a patched package, a trusted package (its scripts could write into the shared copy) and that package's dependencies, anything that is or links to a `workspace:`, `file:` or `link:` package, and a package whose peer is typed by an `@types/*` package of the project ✅[^2]. In the lab these were real folders in `node_modules/.bun` while the rest were symlinks: the trusted `is-odd@3.0.1` and its dependency `is-number@6.0.0`, two `file:` packages, `is-number@7.0.0` after `bun patch --commit` (in `bunlab:2`, which has git), and `plugin-x` whose peer `peer-host` had `@types/peer-host` in the project; `ms`, used by a workspace and by a `file:` package but linking to neither, stayed shared ✅[^lab].
- **The cost:** packages now resolve from `<cache>/links/`, so the `.bun/node_modules` fallback is no longer above them; a true phantom dependency inside a package fails (the `has-flag` row above) ✅[^2] ✅[^lab]. `bun pm cache rm` deletes `<cache>/links/` and breaks every project that links into it until each is reinstalled ✅[^2] ✅[^lab].
- **Measured, small project:** 10 packages, warm cache, `node_modules` deleted before each run, median of 5 on the lab machine: `hoisted` 14 ms, `isolated` 19 ms, isolated with the global store 2 ms; the apparent size of `node_modules` (`du --apparent-size`) was 2 KB of symlinks instead of 5,003 KB ✅[^lab].
- **Measured on macOS, the docs' scenario:** the docs time a warm install of a 1,400-package React/webpack/Babel/jest project on Apple Silicon at 823.9 ms hoisted, 840.9 ms isolated and 124.8 ms with the global store, 6.7× faster, with about 5 MB of symlinks in `node_modules` ✅[^2]. The lab ran Bun 1.4.5 on the host Mac (macOS 26.1, arm64, APFS; cross-compiled, with its own `HOME` and cache in the lab folder) on `react-scripts@5.0.1`, `react`, `react-dom` and the create-react-app test packages, 1,406 packages in `bun.lock`, with `--ignore-scripts`, the lockfile present and `node_modules` deleted before each run ✅[^lab]:

  | Run | `hoisted` | `isolated` | `isolated` + global store |
  |---|---|---|---|
  | Warm: package cache filled (median of 7 after 2 warm-ups, batch 1 / 2) | 883 / 920 ms | 1,067 / 1,067 ms | 300 / 303 ms |
  | Store cold: cache filled, `<cache>/links` emptied (median of 5) | — | — | 1,100 ms |
  | Cold: empty cache, downloads from npm (median of 5) | 3,554 ms | 3,766 ms | 3,820 ms |
  | `du -sh node_modules` | 357 MB | 331 MB | 56 MB, plus 275 MB in `<cache>/links` |

  So the warm gain was 3.5–3.6× over plain isolated and 2.9–3.0× over hoisted here, not 6.7× ✅[^lab]. Of the 1,252 store entries, 1,075 were symlinks into the global store and 177 stayed project-local folders; all 177 carry a peer-set suffix (`+<16 hex>`), and the project held 49 `@types/*` packages, such as `@types/babel__core` for the `@babel/core` that the `@babel/plugin-*` entries peer on ✅[^lab]. That matches the docs' rule that a package whose peer is typed by an `@types/*` package of the project, and everything linking to it, stays out of the store ✅[^2]. A cold install gained nothing, because downloading dominates it ✅[^lab].

### Compared with pnpm
pnpm keeps one content-addressable store (files named by a hash of their content), hard-links every file from it into `node_modules/.pnpm/<name>@<version>/node_modules/<name>`, symlinks each package's dependencies next to it, and symlinks only direct dependencies into the root `node_modules` ✅[^8] ✅[^9]. Bun's isolated layout has the same shape with `.bun` in place of `.pnpm`, hard links (clones on macOS) from Bun's per-version global cache, and a global virtual store as an option ✅[^1] ✅[^lab]. The lab installed one project that depends only on `chalk@^4.1.2` with pnpm 12.23.0 (activated by Corepack in `node:24.22.1-alpine`) and with `bun install --linker isolated` in Bun 1.4.5 ✅[^lab]:

| What | pnpm 12.23.0 | Bun 1.4.5, isolated |
|---|---|---|
| Root `node_modules` | `.modules.yaml .pnpm .pnpm-workspace-state-v1.json chalk` | `.bun chalk` |
| The direct dependency | `chalk -> .pnpm/chalk@4.1.2/node_modules/chalk` | `chalk -> .bun/chalk@4.1.2/node_modules/chalk` |
| `chalk@4.1.2/node_modules` | real `chalk` folder, `ansi-styles -> ../../ansi-styles@4.3.0/node_modules/ansi-styles`, same for `supports-color` | the same three entries and targets |
| Fallback folder | `.pnpm/node_modules`: 5 symlinks, every package except `chalk` | `.bun/node_modules`: 6 symlinks, `chalk` included |
| Second name of `chalk/source/index.js` (link count 2) | `~/.local/share/pnpm/store/v11/files/6e/6f6bd9fc…`, a file named by its content hash; the store holds `files/`, `index.db`, `projects` | `~/.bun/install/cache/chalk@4.1.2@@@1/source/index.js`, a folder per package version |
| `supports-color` from the project / `has-flag` from inside `chalk` | `MODULE_NOT_FOUND` / `.pnpm/has-flag@4.0.0/…` | `MODULE_NOT_FOUND` / `.bun/has-flag@4.0.0/…` |

So the two trees match link for link; they differ in what the store is keyed by and in pnpm's bookkeeping files, whose `.modules.yaml` records `nodeLinker: isolated`, `hoistPattern: ["*"]` and `publicHoistPattern: []`, the same defaults as Bun's `hoistPattern` and `publicHoistPattern` ✅[^4] ✅[^lab]. Bun reads pnpm's and Yarn's names for the setting: `node-linker=isolated`, `pnpm`, `hoisted` or `node-modules` in `.npmrc`, and `--shamefully-hoist` means `--linker=hoisted` ✅[^11] ✅[^3] ✅[^lab]. How pnpm itself is launched through Corepack on Windows is in `nodejs/node-nvm-corepack-pnpm-yarn-architecture.md` (legacy doc).

## Worked example
A small monorepo shows the phantom dependency and the default, in the container's `/tmp/ws1` ✅[^lab].

1. `package.json`: `{ "name": "ws-root", "private": true, "workspaces": ["packages/*"] }`; `packages/app/package.json` depends on `"chalk": "^4.1.2"`; `packages/app/probe.cjs` calls `require.resolve()` for `chalk` and `supports-color`.
2. `bun install` (no flags, no `bunfig.toml`) prints `6 packages installed` and writes `"lockfileVersion": 2, "configVersion": 1`. The root `node_modules` holds only `.bun`.
3. `bun probe.cjs` in `packages/app`:
   ```console
   chalk: resolved -> /tmp/ws1/node_modules/.bun/chalk@4.1.2/node_modules/chalk/source/index.js
   supports-color: MODULE_NOT_FOUND: Cannot find module 'supports-color'
   ```
4. `bun install --linker hoisted` prints `7 packages installed` (the extra one is the `app` link); now `ls node_modules` shows `ansi-styles app chalk color-convert color-name has-flag supports-color`, `packages/app/node_modules` does not exist, and the probe prints `supports-color: resolved -> /tmp/ws1/node_modules/supports-color/index.js`. `bun.lock` still says `"configVersion": 1`.
5. A plain `bun install` afterwards prints `6 packages installed` and the root holds only `.bun` again: the flag was not remembered.

The import of `supports-color` was never safe: it worked only under one layout. Declaring it in `packages/app/package.json` makes it work under both.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `--linker isolated` once in a single-package project, then plain `bun install` | Lab: `Done! Checked 7 packages (no changes)`, the isolated tree stayed; after `rm -rf node_modules` the next install was flat again ✅[^lab]. This conflicts with the tag's isolated-installs page, which says switching linkers in either direction reinstalls from scratch ✅[^1] | The flag is not saved, and the hoisted linker decides from the name and version it finds at each expected path, not from how the tree was built ✅[^3]. Pin the choice with `install.linker` |
| `globalStore = true` with `linker = "hoisted"` | Flat tree, no `<cache>/links` entries used ✅[^lab] | The global store applies only to the isolated linker ✅[^2] |
| Switching linkers on an existing `node_modules` | The old tree is moved to `node_modules/.old_modules-<random>` and deleted after a successful install; other tools' dot-folders such as `.cache` stay ✅[^1]. Lab (`bunlab:2`, `strace`): after `install.linker` changed in `bunfig.toml`, `bun install` renamed `node_modules/ms` to `node_modules/.old_modules-0225b856694a0852/ms`, removed that folder, and kept `node_modules/.cache/tool/x`; switching back moved `.bun` and `ms` the same way ✅[^lab] | A full reinstall is needed for the other shape; a changed config setting triggers it, the `--linker` flag alone did not (row above) |
| `hoist = false` but the import is a root dependency | Still resolves from any store package (lab: `has-flag` as a root dependency resolved from inside `chalk`; without it, `MODULE_NOT_FOUND`) ✅[^1] ✅[^lab] | The root `node_modules` is above `.bun`, as in pnpm ✅[^1] |
| Tool that scans `node_modules` without following symlinks | May miss packages under isolated or global store ✅[^1] ✅[^2]; lab: `find node_modules -maxdepth 2 -name package.json` found 0 files in an isolated install, `find -L` found 1 ✅[^lab] | Most entries are symlinks |
| A workspace that bundlers repackage on its own (Electron, serverless) | Mark it with `"installConfig": { "hoistingLimits": "workspaces" }` or `workspaces.selfContained`; only affects the hoisted linker ✅[^10] | Gives that workspace a complete `node_modules` of real copies ✅[^10]; lab: `apps/desktop/node_modules` held `is-number lib ms`, link count 1 ✅[^lab] |
| Peer dependencies | Isolated applies the peer rules at every use; hoisted may give one copy per location ✅[^3]. Lab: workspaces `a` (`peer-host@1.0.0`) and `b` (`peer-host@1.5.0`) both used `plugin-x`, which has `peer-host` as a peer. Isolated: `a`'s copy saw 1.0.0 and `b`'s saw 1.5.0. Hoisted: one `node_modules/plugin-x`, which saw 1.0.0 from both workspaces, while 1.5.0 sat unused by it in `packages/b/node_modules` ✅[^lab] | Isolated encodes the peer set in the store folder name ✅[^1] ✅[^lab] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `hoisted` | Works with tools that expect a flat tree; default for single packages and old lockfiles ✅[^1] | Phantom dependencies go unnoticed ✅[^1] ✅[^lab] |
| `isolated` | Undeclared imports from your code fail at once; workspaces cannot borrow each other's dependencies ✅[^1] ✅[^lab] | Store packages still see the fallback folder unless `hoist = false`; symlink-unaware tools can break (the `find` row in Edge cases) ✅[^1] ✅[^lab] |
| `isolated` + global store | Warm installs are one symlink per package; one copy shared across checkouts ✅[^2] ✅[^lab] | Even store packages lose the fallback; `bun pm cache rm` breaks linked projects ✅[^2] |

## Takeaways
- Treat a `Cannot find module` that appears only under `isolated` as a missing dependency declaration, and add the package to that `package.json`. [rule-candidate]
- Pin the layout in `bunfig.toml` (`[install] linker = "..."`) instead of relying on `--linker` or on `configVersion`. [rule-candidate]
- Use `isolated` for monorepos; add `hoist = false` when you also want store packages to be strict.
- Turn on `globalStore` for many checkouts of the same project (CI (continuous integration) workers, worktrees), and never run `bun pm cache rm` to refresh metadata there.

## Verification status
- Verified: 111 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24 and 2026-11-25; `bunlab:2` (the image plus git 2.47.3 and strace 6.13) for the patched package and the linker switch; `oven/bun:1.1.45` (`1.1.45+196621f25`) and `oven/bun:1.3.14` (`1.3.14+0d9b296af`) for the default-linker and global-store history; `node:24.22.1-alpine` with pnpm 12.23.0 from Corepack for the pnpm layout; the macOS benchmark ran Bun 1.4.5 cross-compiled for `bun-darwin-arm64` on the host Mac (macOS 26.1, arm64, APFS) with `HOME` and the cache inside the lab folder, timed from a Bun script; packages came through `verdaccio/verdaccio:6` (6.11.3, proxying npm) or, for the peer-dependency packages, a small Bun script serving made-up packages, both on a private Docker network. [^lab]
- [Isolated installs](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/isolated-installs.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: layout, store naming, fallback folder and `install.hoist`, `configVersion` table, workspace handling, linker switching, compatibility notes. [^1]
- [Global virtual store](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/global-store.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `<cache>/links/` layout, entry hash, enabling, project-local cases, fallback loss, `bun pm cache rm` warning, benchmark. [^2]
- [bun install](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/install.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: default strategy, hoisted skip check, peer rules, npm/pnpm flag translation. [^3]
- [bunfig.toml](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/bunfig.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `install.linker`, `install.globalStore`, `install.hoist`, `hoistPattern`, `publicHoistPattern`. [^4]
- [Bun 1.3](https://bun.com/blog/bun-v1.3) — Bun blog, 2025. Backs: isolated installs became the default for workspaces in 1.3.0. [^5]
- [Bun v1.3.2](https://bun.com/blog/bun-v1.3.2) — Bun blog, 2025. Backs: isolated default limited to new projects, `configVersion`. [^6]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: global virtual store introduced as opt-in. [^7]
- [Symlinked node_modules structure](https://pnpm.io/symlinked-node-modules-structure) — pnpm documentation, living. Backs: pnpm's `.pnpm` layout, hard links and symlinks. [^8]
- [Motivation](https://pnpm.io/motivation) — pnpm documentation, living. Backs: content-addressable store, only direct dependencies at the root. [^9]
- [Workspaces](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/workspaces.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: self-contained workspaces. [^10]
- [.npmrc support](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/npmrc.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `node-linker` and `hoist` keys. [^11]

## Related
- `bun/package-manager/install-mechanics-and-lockfile.md` — the cache and backends the linker uses.
- `bun/package-manager/workspaces-catalogs-and-filter.md` — a monorepo end to end.
- `bun/fundamentals/module-resolution-and-loaders.md` — how Bun resolves imports.
- `nodejs/node-nvm-corepack-pnpm-yarn-architecture.md` — legacy doc: how pnpm and Yarn are dispatched through nvm and Corepack on Windows.
- `linux/lab-setup.md` — the lab.
