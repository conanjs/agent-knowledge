---
schema: knowledge-doc/v1
type: reference
topic: bun/package-manager
status: verified
applies-to: ["Bun 1.4.5", "Bun 1.1.45 and 1.3.14 (lockfile history)", "macOS 26.1 arm64 (one Lookup note)", "Verdaccio 6.11.3 (local registry in the lab)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, package-manager, bun-add, bun-update, bun-outdated, bun-why, bun-patch, bun-pm, bun-publish, bunx, overrides, resolutions, npmrc, registry, bunfig, install-config]
---

# Bun package-manager commands, overrides, registries and `[install]` keys

## Summary
**TL;DR:** Lookup tables for Bun 1.4.5's package-manager surface: every command with its purpose, key flags and what it did in the lab; the `bun pm` subcommands; how `bunx` finds and caches a package; the `overrides` and `resolutions` forms; where registry settings come from and in which order (`.npmrc` < `bunfig.toml` < environment < `--registry`, all four checked in the lab); and every `[install]` key of `bunfig.toml` with its default ✅[^1] ✅[^18] ✅[^19] ✅[^lab].
**Use this when:** you need the exact flag or key name, its default, or which command does a job (`why`, `outdated`, `dedupe`, `prune`, `patch`, `pm diff` …).
**Not this doc:** how install, the cache and `bun.lock` work → [install-mechanics-and-lockfile.md](install-mechanics-and-lockfile.md); linkers → [linkers-hoisted-and-isolated.md](linkers-hoisted-and-isolated.md); `--filter` patterns and workspaces → [workspaces-catalogs-and-filter.md](workspaces-catalogs-and-filter.md); trust, scanner, release age, audit → [lifecycle-scripts-and-supply-chain.md](lifecycle-scripts-and-supply-chain.md); `bunfig.toml` structure and the general `BUN_*` variables → `bun/fundamentals/configuration-and-environment.md`.

## Scope
Bun 1.4.5 (`1.4.5+a7733435c`) on Linux arm64; the backslash Lookup note also ran on macOS 26.1 arm64. Names come from each command's `--help` output in that build ✅[^lab] and from the Bun docs source pinned at tag `bun-v1.4.5` (the `.mdx` pages in References); a name found only in the docs was run in the lab or found as a string in the binary before it went into a table ✅[^lab]. A *flag* is a command-line option (`--exact`); a *key* is a setting in `bunfig.toml` (`install.exact`); an `.npmrc` *option* is npm's config-file form of the same idea (`save-exact=true`). Think of them as three doors into one room: with `save-exact=true` in `.npmrc`, `bun add is-number` wrote `"is-number": "7.0.0"` instead of `"^7.0.0"` ✅[^lab], and `-E` or `install.exact = true` do the same ✅[^2] ✅[^19].

## Catalog

### Commands
| Command (alias) | Purpose | Key flags | Lab result (1.4.5) |
|---|---|---|---|
| `bun install` (`bun i`) | Install everything in `package.json` | `--frozen-lockfile`, `-p/--production`, `--omit dev\|optional\|peer`, `--dry-run`, `--no-save`, `--lockfile-only`, `-f/--force`, `--linker`, `--backend`, `-F/--filter`, `--ignore-scripts`, `--trust`, `--offline`, `--prefer-offline`, `--minimum-release-age`, `--cpu/--os/--libc`, `-g` ✅[^1] | See [install-mechanics-and-lockfile.md](install-mechanics-and-lockfile.md) ✅[^lab] |
| `bun ci` | Same as `bun install --frozen-lockfile` ✅[^1] | as `install` | Same error text and exit 1 on drift ✅[^lab] |
| `bun add <pkg>` (`bun a`) | Add a dependency and install | `-d/--dev`, `--optional`, `--peer`, `-E/--exact`, `--save-prod`, `--catalog[=name]`, `-F/--filter`, `--only-missing`, `--trust`, `-g` ✅[^2] | `bun add ms --minimum-release-age 2200d` wrote `"ms": "^2.1.2"` ✅[^lab] |
| `bun remove <pkg>` (`bun r`) | Remove from `package.json` and `node_modules` | `-F/--filter` ✅[^3] | `- is-number` ✅[^lab] |
| `bun update [pkg…]` (`bun up`) | Move dependencies, direct and transitive, to the newest version their ranges allow | `-L/--latest`, `-i/--interactive`, `-F/--filter`, `-r/--recursive`, `-d/--dev`, `--prod`, `--no-optional`, `--depth 0`, `-E/--exact`; names may be globs and `!`-exclusions ✅[^4] | `bun update chalk` rewrote `~4.1.0` to `~4.1.2` (`package.json synced`) ✅[^lab] |
| `bun outdated [pattern]` | Table of `Current`, `Update` (newest in range) and `Latest` per dependency | `-F/--filter`, `-r/--recursive`; name patterns such as `"is-*"`, `"!is-even"` ✅[^5] | `chalk 4.1.2 / 4.1.2 / 6.0.1`, `zod (dev)` marked ✅[^lab] |
| `bun why <pkg>` | Show every dependency chain that pulls a package in | `--top`, `--depth <n>`; globs such as `"@types/*"` ✅[^6] | `has-flag@4.0.0 └─ supports-color@7.2.0 (requires ^4.0.0) └─ chalk@4.1.2 …` ✅[^lab] |
| `bun info <pkg>[@ver] [prop…]` | Registry metadata, npm `view` path syntax | `--json` ✅[^7] | `bun info ms version license` → `version = "2.1.3"`, `license = "MIT"` ✅[^lab] |
| `bun link` / `bun link <pkg>` | Register the current folder as linkable / symlink a registered package into `node_modules` | `--save` writes `"<pkg>": "link:<pkg>"` ✅[^8] | `node_modules/libx -> ../../libx`; only `--save` edited `package.json` ✅[^lab] |
| `bun unlink` | Unregister the current folder ✅[^8] | — | `success: unlinked package "libx"` ✅[^lab] |
| `bun patch <pkg>` | Replace the package's hard links with private copies so you can edit it ✅[^9] | `--commit <dir>` writes `patches/<pkg>@<ver>.patch` and `patchedDependencies`; `--patches-dir` ✅[^9] | Link count went from 2 to 1; `--commit` failed with `error: git must be installed to use \`bun patch --commit\`` in the git-less image ✅[^lab]. With git installed (`bunlab:1`) the whole cycle ran; see the Lookup note ✅[^lab] |
| `bun patch-commit <dir>` | Same as `bun patch --commit` (pnpm name) ✅[^9] | `--patches-dir` | Same git requirement ✅[^lab] |
| `bun publish [dist]` | Pack (rewriting `workspace:` and `catalog:`) and upload | `--access`, `--tag`, `--otp`, `--auth-type`, `--dry-run`, `--tolerate-republish`, `-F/--filter`, `-r/--recursive`, `--gzip-level` ✅[^10] | Against Verdaccio 6.11.3: published, re-published (`409 Conflict`), tolerated, tagged and installed back; see the Lookup note ✅[^lab] |
| `bun dedupe` | Collapse duplicate versions in `bun.lock` onto versions already locked; never edits `package.json` ✅[^12] | `--check` (exit 1 if any), `--dry-run`, `--lockfile-only` ✅[^12] | `~ is-number 7.0.0 -> 6.0.0 (downgrade)`, `--check` exit 1 ✅[^lab] |
| `bun prune` | Delete packages in `node_modules` that `bun.lock` no longer has | `--production` (also dev-only packages), `--dry-run`, `--check`, `-F/--filter` ✅[^13] | `- stray@1.0.0`; `--production` removed `zod` ✅[^lab] |
| `bun audit` / `bun audit fix` | Check locked versions against npm advisories / upgrade them | `--audit-level`, `--prod`, `--omit`, `--ignore <id>` (a GitHub Security Advisory id, `GHSA-…`, or a numeric one), `--json`; `fix --dry-run`, `fix --latest` ✅[^14] | 6 advisories for `lodash@4.17.20` and `ms@0.7.0`, exit 1 ✅[^lab] |
| `bunx <pkg>` (`bun x`) | Run a package's executable, installing it if needed | `--bun`, `-p/--package`, `--no-install`, `--trust`, `--minimum-release-age` ✅[^15] | `bunx semver 1.2.3 -r '^1'` → `1.2.3`; `--trust` and `--minimum-release-age 2200d` were accepted, and `bunx --help` lists both, plus `--registry`, `--ignore-scripts`, `--cwd` and `--env-file` ✅[^lab] |

### `bun pm` subcommands
| Subcommand | What it does | Lab result |
|---|---|---|
| `pack` | Write the `.tgz` that would be published; `--dry-run`, `--destination`, `--filename`, `--ignore-scripts`, `--gzip-level`, `--quiet` ✅[^11] | `demo-app-0.1.0.tgz` with rewritten versions ✅[^lab] |
| `bin [-g]` | Path of the local (or global) `.bin` folder ✅[^11] | `/tmp/c1/node_modules/.bin`; `-g` printed `/usr/local/bin` because the image sets `BUN_INSTALL_BIN` ✅[^lab] |
| `ls [names…]` (`bun list`) | Direct dependencies; `--all` for the tree, `--trusted`, `--prod`, `-g`; a name lists every installed version ✅[^11] | `bun pm ls is-number` → `is-number@7.0.0`, `is-number@6.0.0` ✅[^lab] |
| `why <pkg>` | Same as `bun why` ✅[^lab] | `bun pm why has-flag` → `has-flag@4.0.0 └─ supports-color@7.2.0 (requires ^4.0.0) …` ✅[^lab] |
| `diff [a] [b]` | What changed between two versions (or locked → latest); `--stat`, `--name-only`, `-U n`, `--json` ✅[^11] | `4 files changed … ! engines changed: { "node": ">=0.10.0" } → { "node": ">=0.12.0" }` ✅[^lab] |
| `licenses` | Installed packages grouped by license; `--json`, `--prod`, `--dev`, `--long`, `--filter` ✅[^11] | `MIT (10)` ✅[^lab] |
| `scan` | Run the configured security scanner over every package in `bun.lock` ✅[^lab] | `1 advisory (1 fatal)` with the lab scanner ✅[^lab] |
| `whoami` | npm user name of the configured credentials ✅[^11] | With a Verdaccio token in `.npmrc`: `lab` ✅[^lab] |
| `view` | Registry metadata; its help line says to use `bun info` instead ✅[^lab] | `bun pm view ms version` → `2.1.3` ✅[^lab] |
| `version [increment]` | Bump `version`, commit and tag; `--dry-run`, `--no-git-tag-version`, `--preid` ✅[^11] | `patch --dry-run` → `v1.0.1`; all three flags listed by `bun pm version` ✅[^lab] |
| `pkg get\|set\|delete\|fix` | Read or edit `package.json` with dot and bracket paths ✅[^11] | `get name version` → JSON object ✅[^lab] |
| `hash`, `hash-string`, `hash-print` | The lockfile hash, the string it is computed from, the stored hash ✅[^11] | `hash-print` printed zeros for a text `bun.lock` ✅[^lab] |
| `cache`, `cache rm [--dry-run]` | Print / delete the cache, including `<cache>/links/` ✅[^11] | `/root/.bun/install/cache` ✅[^lab] |
| `cache prune [--max-age d] [--dry-run]` | Delete packages older than 30 days (default) ✅[^11] | `none older than 30 days` ✅[^lab] |
| `cache pack\|unpack <file>` | Move the cache entries a lockfile needs as one file, for CI (continuous integration) caches ✅[^11] | `Packed 10 packages (1145 files, 2.19 MB)`; into an empty cache `Unpacked 10 packages (10 new, …)`, after which `bun install --offline` installed all 10 ✅[^lab] |
| `fetch [--dry-run]` | Download every dependency into the cache without installing ✅[^11] | `10 packages already in cache` ✅[^lab] |
| `migrate [--dry-run]` | Convert another manager's lockfile without installing ✅[^11] | `--dry-run` on a `yarn.lock` project: `dry run: would write bun.lock`, nothing written ✅[^lab] |
| `untrusted`, `trust <names> [--all] [--dry-run]`, `default-trusted` | Blocked scripts, allow them, print the built-in list ✅[^11] | See [lifecycle-scripts-and-supply-chain.md](lifecycle-scripts-and-supply-chain.md) ✅[^lab] |

### `bunx` behaviour
| Situation | Behaviour |
|---|---|
| Package installed in the project | Uses it: with `semver@7.5.4` installed, `bunx semver --help` printed `SemVer 7.5.4` ✅[^15] ✅[^lab] |
| Version given (`bunx semver@7.8.6`) | Ignores the local copy and resolves the requested version ✅[^15] ✅[^lab] |
| Not installed | Installs into the cache; the lab found it in `/root/.bun/install/cache/.bunx-0/semver@latest/` ✅[^15] ✅[^lab] |
| Freshness | Checks the registry for newer versions once a day; `@latest` checks every run ✅[^15]. The source dates the tree by the modification time of its `package.json` and calls it stale after 1 day ✅[^21]. Lab, fake registry: after a new version was published, `bunx` kept the old one; with that `package.json` set 2 days back it took the new one; `bunx pkg@latest` took the newest at once; `--no-install` on a stale tree printed `warn: Using a stale installation of bunx-fresh2 because --no-install was passed` and ran the old one ✅[^lab] |
| `#!/usr/bin/env node` shebang | Runs with `node`; `--bun` (before the package name) runs it with Bun ✅[^15]. Lab, with a stand-in `node` script first on `PATH`: `bunx bunx-fresh a b` called `node …/.bin/bunx-fresh a b`, `bunx --bun bunx-fresh a b` ran it in Bun. The `oven/bun` image itself has a `node` that is Bun (`/usr/local/bun-node-fallback-bin/node`), so there a node shebang runs Bun anyway ✅[^lab] |
| Binary name differs from package name | `bunx -p <package> <binary>`; the command can be any program found on the package's `PATH` ✅[^15]. Lab: `bunx -p two-bins tool-one x` ran `tool-one`; `bunx bin-pkg`, whose only bin is `which-runtime`, ran that bin without `-p` ✅[^lab] |
| Flags after the package name | Passed to the executable (lab: `a b` arrived as arguments) ✅[^15] ✅[^lab] |

### `overrides` and `resolutions`
Both pin the version of a dependency of a dependency (a *metadependency*); only the root `package.json` is read, and when both fields exist only `overrides` counts ✅[^16] ✅[^lab]. Every form below ran in the lab, on `chalk@^4.1.2`, pinning `supports-color` to 7.1.0 instead of 7.2.0 unless the row says otherwise ✅[^lab].

| Form | Example | Effect |
|---|---|---|
| Top-level | `"overrides": { "supports-color": "7.1.0" }` | Every `supports-color` resolves to 7.1.0 (lab: `bun why` showed `supports-color@7.1.0 └─ chalk@4.1.2 (requires ^7.1.0)`) ✅[^16] ✅[^lab] |
| Yarn field | `"resolutions": { "has-flag": "4.0.0" }` | Same, Yarn syntax ✅[^16] ✅[^lab] |
| npm nested object | `"overrides": { "is-odd": { "is-number": "6.0.0" } }` | Only `is-odd`'s direct dependency; lab lockfile became `lockfileVersion: 3` ✅[^16] ✅[^lab] |
| pnpm `>` / Yarn `/` path | `"micromatch>picomatch"`, `"resolutions": { "micromatch/picomatch": … }` | Parent's direct dependency only ✅[^16] ✅[^lab] |
| Parent with version | `"micromatch@^4>picomatch": "^2.3.2"` | Only that parent range; most specific rule wins ✅[^16]. Lab, made-up packages: with `parent-b@1.0.0` and `parent-b@2.0.0` (as alias `pb2`) both depending on `child`, `"parent-b@^1>child": "1.0.0"` gave 1.0.0 to the first and left 1.2.0 to the second; adding `"child": "1.1.0"` moved the second to 1.1.0 while the first kept 1.0.0 ✅[^lab] |
| Version-scoped key | `"semver@<7.5.2": "7.5.2"` | Only dependents whose range overlaps (lab: `"supports-color@^7": "7.1.0"`) ✅[^16] ✅[^lab] |
| Special values | `"npm:@myorg/quux@^1.0.0"`, `"catalog:"`, `"$foo"` | A fork, a catalog entry, your own range for `foo` (lab: `"color-name": "npm:color-name@1.1.3"`, `"supports-color": "catalog:"` and `"$supports-color"` all applied) ✅[^16] ✅[^lab] |

### Registries and `.npmrc`
Sources, later wins (each step checked in the lab by pointing one source at a closed port, `http://127.0.0.1:9/`, which fails with `error: ConnectionRefused downloading package manifest ms`) ✅[^18] ✅[^lab]:

| Order | Source | Lab |
|---|---|---|
| 1 | The user file: `$NPM_CONFIG_USERCONFIG` when set, else `$XDG_CONFIG_HOME/.npmrc` if it exists, else `~/.npmrc` ✅[^18] | with a good token in one file and a bad one in the other, Verdaccio accepted the `NPM_CONFIG_USERCONFIG` file over XDG, and the XDG file over `~/.npmrc` (a good `~/.npmrc` beside a bad XDG file gave 401); a relative `NPM_CONFIG_USERCONFIG` was read from the current folder ✅[^lab] |
| 2 | `./.npmrc` next to the root `package.json` ✅[^18] | bad registry here → install failed; a wrong token under the same `//host/` key replaced a good one in `~/.npmrc` (401), while a token in `~/.npmrc` and a registry in `./.npmrc` combined ✅[^lab] |
| 3 | `bunfig.toml`: global, then project ✅[^18] | good registry here beat the bad `.npmrc` ✅[^lab] |
| 4 | `BUN_CONFIG_REGISTRY` / `NPM_CONFIG_REGISTRY`, `BUN_CONFIG_TOKEN` / `NPM_CONFIG_TOKEN` ✅[^18] | bad env var beat a good `bunfig.toml` ✅[^lab] |
| 5 | `--registry <url>` ✅[^18] | beat a bad env var ✅[^lab] |

| `.npmrc` option | `bunfig.toml` equivalent | Notes |
|---|---|---|
| `registry=` | `install.registry` (string, `{ url, token }`, or URL with `user:password@`; the lab ran the string and table forms) ✅[^18] ✅[^19] ✅[^lab] | Default `https://registry.npmjs.org/` ✅[^19] |
| `@scope:registry=` | `[install.scopes]` `myorg = "…"` or `{ url, token }` / `{ url, username, password }` (lab: string and `{ url, token }` forms) ✅[^17] ✅[^18] ✅[^lab] | Lab: `@types:registry` at a bad host failed only `@types/ms` ✅[^lab] |
| `//host/:_authToken`, `username`, `_password` (base64), `_auth`, `email` (ignored) | `token` / `username` / `password` (plain; Bun encodes) in `install.scopes` ✅[^18] | Matched by dropping path segments, as npm does; never sent to another host ✅[^18]; every form run in the lab, see the credentials table below ✅[^lab] |
| `link-workspace-packages` | `install.linkWorkspacePackages` ✅[^18] | Lab: `=false` gave a workspace named `is-number` the registry copy, `=true` linked the workspace ✅[^lab] |
| `save-exact` | `install.exact` ✅[^18] | Lab: `bun add is-number` wrote `"7.0.0"` ✅[^lab] |
| `ignore-scripts` | `install.ignoreScripts` ✅[^18] | Lab: `true`, `True`, `1` and an empty value skipped the root `postinstall`; `false`, `0` and `null` ran it ✅[^lab] |
| `dry-run` | `install.dryRun` ✅[^18] | Lab: `bun install` wrote neither `bun.lock` nor `node_modules` ✅[^lab] |
| `cache` (`=false` disables) | `[install.cache] dir`, `disable` ✅[^18] | Lab: `=false` extracted into `node_modules/.cache`; `=./mycache` was read relative to the `.npmrc` ✅[^lab] |
| `ca`, `ca[]`, `cafile` | `install.ca`, `install.cafile` ✅[^18] | `cafile` wins over `ca` ✅[^18]; lab, HTTPS registry signed by a lab CA: right `cafile` plus a wrong `ca` worked; the right `ca` inline worked; neither gave `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; `install.cafile` worked ✅[^lab] |
| `omit`, `include` | `--omit` / `install.dev` etc. ✅[^18] | Lab: `omit=dev` left out the dev dependency ✅[^lab] |
| `install-strategy` (`hoisted`, `linked`), `node-linker` (`isolated`, `hoisted`, `pnpm`, `node-modules`) | `install.linker` ✅[^18] | Lab: `node-linker=isolated` gave `.bun` ✅[^lab] |
| `public-hoist-pattern`, `hoist-pattern`, `hoist` | `install.publicHoistPattern`, `hoistPattern`, `hoist` ✅[^18] | Isolated linker only ✅[^19]; lab: a hoisted install with `hoist = false` and `publicHoistPattern` stayed flat ✅[^lab] |

**Credentials, run against Verdaccio 6.11.3.** The lab's `@lab/hello` needs a login, so Verdaccio answers `401` to an unauthenticated `GET`; each row is one fresh project and cache running `bun add @lab/hello@1.0.0`. The header column comes from a second, fake registry that logged the `Authorization` header it received; `not logged` marks rows run against Verdaccio only ✅[^lab].

| Configuration | Result | Header sent |
|---|---|---|
| `//pm-verdaccio:4873/:_authToken=${TOKEN}` (`.npmrc`) | installed | `Bearer <token>` |
| same with `$TOKEN` (no braces) | installed; with `TOKEN` unset, `401`. The docs name only `${NAME}` ✅[^18] | not logged |
| `${NOPE}` (unset) / `${NOPE?}` | `401` / `401`: left as written / empty, as the docs say ✅[^18] | not logged |
| `//host:port/:_auth=<base64 of lab:labsecret>` | installed | `Basic <value as written>` |
| `//host:port/:username=lab` + `:_password=<base64 of labsecret>` | installed | `Basic bGFiOmxhYnNlY3JldA==` |
| wrong token / key for another host / key without the port | `401` / `401` / `401` | not logged |
| `@lab:registry=http://pm-verdaccio:4873/` plus the token line, default registry npm | installed; without the token line, `401` | not logged |
| `bunfig.toml` `[install.scopes] lab = { url, token = "$TOKEN" }` | installed; `"${TOKEN}"` was not expanded (`401`); unset `$VAR`: `warn: registry token references unset variable $NOPE_UNSET, ignoring credential`, then the `.npmrc` token was used | not logged |
| `[install.scopes]` `{ url, username, password = "$PASS" }` / `"http://lab:labsecret@host/"` | installed / installed | not logged |
| `install.registry = { url, token }` / `"http://lab:labsecret@host/"` | installed / installed | fake registry: `{ url, username, password }` sent `Basic bGFiOmxhYnNlY3JldA==`; `p%40ss` in a URL arrived as `p@ss` |
| `BUN_CONFIG_REGISTRY` + `BUN_CONFIG_TOKEN`, or the `NPM_CONFIG_` pair | installed | `Bearer <value>` |
| `bunfig.toml` token against the `.npmrc` `//host/` line, both ways | the `bunfig.toml` token won (wrong one → `401`) | not logged |
| `BUN_CONFIG_TOKEN=wrong` against a right `//host/` line | `401`: the variable won | not logged |
| `registry=http://lab:wrong@host/` plus a right `//host/` line | installed: the `//host/` line replaced the URL's credential | not logged |
| `email=` lines | installed, ignored | not logged |
| `--registry` set to `http://pm-verdaccio:4873/`, token only in `.npmrc` | installed | not logged |

Path, port and host rules, run only against the fake registry (`pm-fake`, plus a second name `pm-other` for "another host") ✅[^lab]:

| Configuration | `Authorization` header received |
|---|---|
| registry `…/team/a/`, key `//pm-fake:4874/…/team/:_authToken=T1` | `Bearer T1`: one path segment dropped |
| keys for both `…/team/a/` and the bare host | the longer key's token |
| registry `http://pm-fake:80/` with key `//pm-fake/`, and the reverse | the token both ways: `:80` and no port match |
| tarball on another host over `http`, with a `.npmrc` line for that host | none to that host |
| tarball on another host over `https`, with / without a line for it | that line's token / none |
| `--registry` set to `http://pm-other:4874/…` while the configured registry has a token | none to `pm-other` |
| `registry=pm-fake:4874/k15/` (no scheme) | no request: `error: Failed to join registry … InvalidURL` |

### `[install]` keys in `bunfig.toml`
| Key | Default | Effect |
|---|---|---|
| `optional` / `dev` / `peer` | `true` / `true` / `true` | Install that dependency group (lab: `dev = false` left out the dev dependency) ✅[^19] ✅[^lab] |
| `production` | `false` | No `devDependencies`, lockfile frozen; `add`/`remove`/`update` then fail ✅[^19]; lab: all three failed with `error: lockfile had changes, but lockfile is frozen` (`update` when a newer version in range existed) ✅[^lab] |
| `exact` | `false` | Write exact versions instead of `^` (lab: `bun add chalk@^4` wrote `"4.1.2"`) ✅[^19] ✅[^lab] |
| `ignoreScripts` | `false` | Skip all lifecycle scripts, root included ✅[^19] ✅[^lab] |
| `concurrentScripts` | 2 × CPU count | Parallel lifecycle scripts; lab: 16 at once on 8 CPUs, 5 with `concurrentScripts = 5` ✅[^19] ✅[^lab] |
| `saveTextLockfile` | `true` (since 1.2) | `false` writes `bun.lockb` when no lockfile exists ✅[^19] ✅[^lab]. Lab history: a plain `bun install` wrote `bun.lockb` in Bun 1.1.45 and `bun.lock` in 1.3.14 ✅[^lab] |
| `auto` | `"auto"` | Run-time auto-install: `"auto"`, `"force"`, `"disable"`, `"fallback"` (lab: `"disable"` gave `Cannot find package 'is-odd'`) ✅[^19] ✅[^lab] |
| `prefer` | `"online"` | `"offline"` = `--prefer-offline`; `"latest"` ✅[^19]. Lab: `"offline"` and `--prefer-offline` both used a 305-second-old manifest and kept the old version; `"latest"`, documented as "always check npm", behaved like `"online"`: with a manifest under 5 minutes old, `bun add` and run-time auto-install took 1.0.1 although 1.0.2 was out; `"bogus"` gave `error: Invalid prefer setting, must be one of online or offline` ✅[^lab] |
| `offline` | `false` | Never touch the network (lab, empty cache: `error: --offline: "chalk" is not in the cache`) ✅[^19] ✅[^lab] |
| `frozenLockfile` / `dryRun` | `false` / `false` | As the flags; `dryRun` also applies to `publish`, `pm pack`, `prune`, `dedupe`, `audit fix`; lab: `bun add` failed under `frozenLockfile`, nothing installed under `dryRun` ✅[^19] ✅[^lab] |
| `globalDir` / `globalBinDir` | `~/.bun/install/global` / `~/.bun/bin` | Global packages and their bins; ignored in a project `bunfig.toml` ✅[^19]. Lab: there `bun install` printed `warn: ignoring "globalDir" in project bunfig.toml, set it in $HOME/.bunfig.toml or $BUN_INSTALL_GLOBAL_DIR` and `bun add -g` used the default; in `~/.bunfig.toml` both keys applied, but the image's `BUN_INSTALL_BIN` beat `globalBinDir` until unset ✅[^lab] |
| `registry` | `https://registry.npmjs.org/` | Default registry; `bun.lock` writes `""` for it, see [install-mechanics-and-lockfile.md](install-mechanics-and-lockfile.md) ✅[^19] ✅[^lab] |
| `linkWorkspacePackages` | `true` | `false` installs workspace packages from the registry (lab: a workspace named `is-number` was replaced by the registry copy) ✅[^19] ✅[^lab] |
| `scopes` | — | Per-scope registries, `$VAR` references allowed (lab: `token = "$TOKEN"` and `password = "$PASS"` worked, `"${TOKEN}"` did not) ✅[^19] ✅[^lab] |
| `ca` / `cafile` | — | CA (certificate authority) certificate text / file; `cafile` wins ✅[^19] ✅[^lab] |
| `cache.dir` / `cache.disable` / `cache.disableManifest` | `~/.bun/install/cache` / `false` / `false` | Cache folder; no cache (extract to `node_modules/.cache`); always fetch manifests; lab: `disable = true` left `node_modules/.cache`, and `disableManifest = true` fetched a manifest that was 5 seconds old ✅[^19] ✅[^lab] |
| `lockfile.save` / `lockfile.print` | `true` / — | Write a lockfile; `"yarn"` also writes `yarn.lock` (both checked in the lab) ✅[^19] ✅[^lab] |
| `linker` | `"isolated"` for new workspaces, else `"hoisted"` | Layout; lab defaults in [linkers-hoisted-and-isolated.md](linkers-hoisted-and-isolated.md) ✅[^19] ✅[^lab] |
| `globalStore` | `false` | Global virtual store for the isolated linker ✅[^19] ✅[^lab] |
| `publicHoistPattern` / `hoistPattern` / `hoist` | `[]` / `["*"]` / `true` | Isolated linker hoisting controls (lab: `hoist = false`, `publicHoistPattern`, and `hoistPattern = ["has-*"]`, which left only `has-flag` in the fallback folder) ✅[^19] ✅[^lab] |
| `logLevel` | — | `"debug"`, `"warn"` or `"error"` ✅[^19]. Lab: those three and an undocumented `"info"` were accepted, `"bogus"` gave `error: Invalid log level, must be one of debug, error, or warn`; none changed what `bun install` printed (6 lines, a `warn:` line kept even under `"error"`); for that use `--verbose` (55 lines) or `--silent` (none) ✅[^lab] |
| `security.scanner` | — | Scanner package or file path (lab: `./scanner.ts`) ✅[^19] ✅[^lab] |
| `minimumReleaseAge` / `minimumReleaseAgeExcludes` | `null` (off) / `[]` | Age gate and its exemptions (lab: `"2200d"`, seconds, `["ms"]`) ✅[^19] ✅[^lab] |

Install-specific environment variables: `BUN_CONFIG_YARN_LOCKFILE`, `BUN_CONFIG_SKIP_SAVE_LOCKFILE`, `BUN_CONFIG_SKIP_LOAD_LOCKFILE`, `BUN_CONFIG_SKIP_INSTALL_PACKAGES`, `BUN_CONFIG_HTTP_RETRY_COUNT` (default 5) and `BUN_CONFIG_HTTP_RETRY_BACKOFF` (default 50 ms); environment variables beat `bunfig.toml` ✅[^1] ✅[^lab]. Each ran in the lab ✅[^lab]:

| Variable | Lab result |
|---|---|
| `BUN_CONFIG_YARN_LOCKFILE=1` | `Saved lockfile` and `Saved yarn.lock` (a Yarn v1 file); it also did so with `lockfile.print = "bun"` in `bunfig.toml` |
| `BUN_CONFIG_SKIP_SAVE_LOCKFILE=1` | `node_modules`, no `bun.lock` |
| `BUN_CONFIG_SKIP_LOAD_LOCKFILE=1` | a `bun.lock` pinning `ms@2.1.1` for `^2.1.0` was ignored: `+ ms@2.1.3` |
| `BUN_CONFIG_SKIP_INSTALL_PACKAGES=1` | `bun.lock` saved, no `node_modules` |
| `BUN_CONFIG_HTTP_RETRY_COUNT`, `…_BACKOFF` | a registry answering `503`: 6 requests by default, waits 49, 87, 234, 426, 856 ms (doubling from 50 ms); `COUNT=2` → 3 requests; `COUNT=0` → 1; `BACKOFF=0` → no wait; `BACKOFF=200 COUNT=3` → waits 233, 325, 887 ms |

## Lookup notes
- **npm, Yarn and pnpm flags are translated:** `--save-dev` → `--dev`, `--immutable` → `--frozen-lockfile`, `--shamefully-hoist` → `--linker=hoisted`, `--legacy-peer-deps` is accepted and ignored; an unknown flag such as `--frozen-lockfil` is an error (`error: bun install has no --frozen-lockfil flag.`); all four were run in the lab ✅[^1] ✅[^lab].
- **`bun update` rewrites the floor of a range** (`~4.1.0` → `~4.1.2`) but leaves exact pins, dist-tags and forms like `>=1.0.0` alone; `bun update <name>` on a name that is not in `bun.lock` is an error ✅[^4] ✅[^lab].
- **`bun dedupe` may downgrade:** when only an older locked version satisfies every range, it moves to that one and marks `(downgrade)`; the lab output used `~` where the docs show `↳` ✅[^lab] ✅[^12].
- **`bun patch --commit` needs `git` on `PATH`** in 1.4.5; the docs do not say so ✅[^lab]. It needs the program, not a repository: in `bunlab:1` (the image plus git) the full cycle ran in a folder with no `.git`, and created none ✅[^lab]:
  1. `bun patch is-number` → the edited file's link count 1; `--commit --dry-run` printed `dry run: would write patches/is-number@7.0.0.patch and add is-number@7.0.0 to patchedDependencies` and wrote nothing ✅[^9] ✅[^lab].
  2. `bun patch --commit is-number` wrote `patches/is-number@7.0.0.patch` in `git diff` format (`diff --git a/index.js b/index.js`, one `@@` hunk), and added `"is-number@7.0.0": "patches/is-number@7.0.0.patch"` to `patchedDependencies` in both `package.json` and `bun.lock` ✅[^9] ✅[^lab].
  3. After `rm -rf node_modules && bun install` the change was back in the installed package ✅[^lab].
  4. Undoing the edit and committing again printed `Removed the patch for is-number@7.0.0 (deleted patches/is-number@7.0.0.patch)` and removed the `package.json` entry ✅[^9] ✅[^lab].
  5. With the patch file deleted but still listed, `bun install` exited 1 with `error: patch file not found: 'patches/is-number@7.0.0.patch'` and the two fixes the docs describe (recreate it with `bun patch --commit is-number@7.0.0`, or remove the entry), and created no `node_modules` ✅[^9] ✅[^lab].
- **`bun link <pkg>` does not edit `package.json`**; `bun link --save <pkg>` does. `link:./dir` links a folder by path with no registration ✅[^8] ✅[^lab].
- **`bun publish --dry-run` still needs credentials** in 1.4.5; use `bun pm pack --dry-run` to list files without them ✅[^lab].
- **`bun publish` end to end against a local registry.** The lab ran Verdaccio 6.11.3 on a private Docker network, created the test user `lab` through its `PUT /-/user/org.couchdb.user:lab` endpoint, which returned a token, and put `//pm-verdaccio:4873/:_authToken=${TOKEN}` and `registry=http://pm-verdaccio:4873/` in `.npmrc` ✅[^lab]:
  1. `bun pm whoami` printed `lab`. `bun publish --dry-run` listed three files, `Tag: latest`, `Access: default`, `Registry:` `http://pm-verdaccio:4873/` and `+ @lab/hello@1.0.0 (dry-run)`; the registry still answered `404` for the package afterwards ✅[^lab].
  2. `bun publish` printed the shasum, integrity, packed size and `+ @lab/hello@1.0.0` ✅[^lab].
  3. Running it again: `409 Conflict … this package is already present`, exit 1; with `--tolerate-republish`: `warn: Registry already knows about version 1.0.0; skipping.`, exit 0 ✅[^10] ✅[^lab].
  4. Version `1.1.0-beta.1` with `--tag beta`: `bun info @lab/hello dist-tags` showed `"latest": "1.0.0", "beta": "1.1.0-beta.1"`. Version `1.0.1` with `--access restricted` printed `Access: restricted` and moved `latest` to 1.0.1 ✅[^lab].
  5. Against a registry that logs headers, `--otp 123456` sent `npm-otp: 123456`, and `--auth-type web` sent `npm-auth-type: web` instead of the default `legacy` ✅[^lab].
  6. In an empty project with the same `.npmrc`, `bun add @lab/hello` installed 1.0.1 with its `lab-hello` bin, and `bun add @lab/hello@beta` installed 1.1.0-beta.1; without the token line it failed with `error: GET` `http://pm-verdaccio:4873/@lab%2fhello` `- 401` ✅[^lab].
  What `workspace:` and `catalog:` become in the published tarball is in [workspaces-catalogs-and-filter.md](workspaces-catalogs-and-filter.md) ✅[^lab].
- **Documented on bun.com, not in the 1.4.5 docs:** the live `bun install` page adds that when the cache path contains a backslash (macOS and Linux) Bun copies from it instead of symlinking ✅[^20]; the page at tag `bun-v1.4.5` lacks that sentence ✅[^1]. In 1.4.5 the backslash did not survive: `BUN_INSTALL_CACHE_DIR='/tmp/back\slash'` and `[install.cache] dir = '/tmp/bf\back'` both became folders `/tmp/back/slash` and `/tmp/bf/back`, and `--backend symlink` still symlinked into them ✅[^lab]. On macOS 26.1 (Bun 1.4.5 cross-compiled for the host) the same happened: a cache path ending in `back\slash` became the folders `back/slash`, and `node_modules/ms/index.js` was a symlink into them ✅[^lab].
- **Global installs:** `bun add -g` uses `install.globalDir` and `install.globalBinDir`; in the `oven/bun` image `BUN_INSTALL_BIN=/usr/local/bin` moves the bins there ✅[^19] ✅[^lab].

## Takeaways
- Read `bun outdated` before `bun update`, and `bun why <pkg>` before adding an override for a transitive package.
- Pin a metadependency with a nested override (`"parent": { "child": "x" }`) rather than a top-level one when only one parent needs it; expect `lockfileVersion: 3` in `bun.lock`. [rule-candidate]
- Keep registry and scope settings in the project `bunfig.toml`; it overrides `.npmrc` for the same key, and keep tokens in variable references, not in the file: `"$NPM_TOKEN"` in `bunfig.toml` (the braced form is not expanded there), `${NPM_TOKEN}` in `.npmrc`. [rule-candidate]
- In CI images without `git`, run `bun patch --commit` on a developer machine and commit the patch file.

## Verification status
- Verified: 246 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, and `bunlab:1` with git 2.47.3 for `bun patch --commit` and openssl for the lab CA, arm64) where every ✅[^lab] behaviour ran on 2026-11-24 and 2026-11-25, including each command's `--help`; `oven/bun:1.1.45` and `oven/bun:1.3.14` for the lockfile history; the macOS backslash run used Bun 1.4.5 cross-compiled for `bun-darwin-arm64` on the host Mac with `HOME` and the cache inside the lab folder; registries on a private Docker network: `verdaccio/verdaccio:6` (6.11.3) with the test user `lab`, and a small Bun script serving made-up packages over HTTP and HTTPS that logged each request's host and `Authorization`, `npm-otp` and `npm-auth-type` headers. [^lab]
- [bun install](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/install.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: install flags, `bun ci`, flag translation, install environment variables. [^1]
- [bun add](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/add.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: add flags. [^2]
- [bun remove](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/remove.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: remove. [^3]
- [bun update](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/update.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: update flags and rewrite rules. [^4]
- [bun outdated](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/outdated.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: columns, filters. [^5]
- [bun why](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/why.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: why flags. [^6]
- [bun info](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/info.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: info usage. [^7]
- [bun link](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/link.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: link, unlink, `link:` paths. [^8]
- [bun patch](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/patch.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: patch workflow and flags. [^9]
- [bun publish](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/publish.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: publish flags. [^10]
- [bun pm](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/pm.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: every `bun pm` subcommand. [^11]
- [bun dedupe](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/dedupe.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: dedupe behaviour and flags. [^12]
- [bun prune](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/prune.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: prune flags. [^13]
- [bun audit](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/audit.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: audit flags. [^14]
- [bunx](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/bunx.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: bunx resolution, cache, freshness, shebangs, flags. [^15]
- [Overrides and resolutions](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/overrides.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: every override form. [^16]
- [Scopes and registries](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/scopes-registries.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `install.scopes` forms. [^17]
- [.npmrc support](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/npmrc.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: source order, supported options, credential matching. [^18]
- [bun install (live page)](https://bun.com/docs/pm/cli/install) — Bun documentation, living (newer than 1.4.5). Backs: only the backslash-path sentence in Lookup notes. [^20]
- [bunfig.toml](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/bunfig.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: every `[install]` key and default. [^19]
- [src/runtime/cli/bunx_command.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/runtime/cli/bunx_command.rs) — Bun source, 2026. Backs: `SECONDS_CACHE_VALID` (1 day) checked against the tree's `package.json` modification time. [^21]

## Related
- `bun/package-manager/install-mechanics-and-lockfile.md` — what the install flags change on disk.
- `bun/package-manager/workspaces-catalogs-and-filter.md` — the `--filter` grammar.
- `bun/package-manager/lifecycle-scripts-and-supply-chain.md` — trust, scanner, release age, audit.
- `bun/fundamentals/configuration-and-environment.md` — `bunfig.toml` structure and `BUN_*` variables.
- `linux/lab-setup.md` — the lab.
