---
schema: knowledge-doc/v1
type: concept
topic: bun/package-manager
status: verified
applies-to: ["Bun 1.4.5", "macOS 26.1 arm64 with APFS (the install backends, Bun 1.4.5 cross-compiled for the host)", "Bun 1.1.45 and 1.3.14 (lockfile history; 1.1.45 wrote the bun.lockb that 1.4.5 converted)", "Node.js 24.22.1 (npm 11.19.1, used to write a package-lock.json, republish a tarball and compare symlink resolution)", "Verdaccio 6.11.3 (local registry in the lab)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, bun-install, lockfile, bun-lock, bun-lockb, global-cache, hardlink, clonefile, frozen-lockfile, bun-ci, migration, package-lock, yarn-lock]
---

# How `bun install` works: resolution, the global cache, linking and `bun.lock`

## Summary
**TL;DR:** `bun install` turns the ranges in `package.json` into exact versions (asking the registry only for ranges that `bun.lock` does not already pin), downloads each package once into a global cache at `~/.bun/install/cache`, and then links the cached files into `node_modules`: hard links on Linux and Windows, copy-on-write clones on macOS (checked on an APFS disk: no extra space), a plain copy when neither works ✅[^1] ✅[^2] ✅[^lab]. It records the result in `bun.lock`, a JSONC text file that replaced the binary `bun.lockb` as the default in Bun 1.2 ✅[^7] ✅[^3]; Bun 1.1.45 still wrote `bun.lockb`, and 1.4.5 converted that file with one command ✅[^lab]. `bun install --frozen-lockfile` and its alias `bun ci` refuse to change `bun.lock` and fail when `package.json` disagrees with it; a project that only has a `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml` is migrated on its first install and keeps the versions that file locked ✅[^1] ✅[^lab].
**Use this when:** you need to know where packages live on disk, why a second install takes milliseconds, what `bun.lock` records, which install flags write files and which do not, or how a project moves from npm or Yarn to Bun.
**Not this doc:** how `node_modules` is laid out (flat or `node_modules/.bun`) → [linkers-hoisted-and-isolated.md](linkers-hoisted-and-isolated.md); why dependency `postinstall` scripts do not run → [lifecycle-scripts-and-supply-chain.md](lifecycle-scripts-and-supply-chain.md); every flag, `bun pm` subcommand and `[install]` key → [pm-commands-reference.md](pm-commands-reference.md); Bun's install speed against npm → `bun/internals/performance-measured.md`.

## Problem
- A CI (continuous integration) job runs a plain `bun install`, silently resolves a newer version than the one the developer tested, and the build breaks for a reason nobody can reproduce locally.
- Developers delete `~/.bun/install/cache` to "fix" an install, then pay the full download again, or they keep a project on a Docker bind mount and lose the disk sharing without noticing.
- Teams hesitate to switch from npm or Yarn because they fear the switch will move every dependency to a new version, and they cannot review a binary lockfile in a pull request.

## Mental model
**Analogy:** a central warehouse and many shop shelves. The first time any shop orders an item, the supplier (the registry) ships it to the warehouse (the global cache). Every shop shelf (a project's `node_modules`) then gets a label that points at that same item instead of a second copy (a hard link). The order book (`bun.lock`) records which item, version and checksum each shelf received, so the next restock orders exactly the same.

A **hard link** is a second name for the same file: both names lead to one block of data on disk, identified by the filesystem's file number (its *inode*). Deleting one name leaves the other working.

**Artifact** (Bun 1.4.5, project and cache inside the container's own filesystem) ✅[^lab]:
```console
$ bun pm cache
/root/.bun/install/cache
$ stat -c '%i %h %n' node_modules/ms/index.js /root/.bun/install/cache/ms@2.1.3@@@1/index.js
2118665 2 node_modules/ms/index.js
2118665 2 /root/.bun/install/cache/ms@2.1.3@@@1/index.js
```
Same inode (`2118665`) and a link count of `2`: the file in `node_modules` is the cache's file under a second name.

## How it works
Five actors take part in an install:
- **The resolver** (`bun install` itself) — its job: turn each range into one exact version, via `package.json`, `bun.lock` and registry manifests.
- **The registry** — its job: serve manifests (the list of a package's versions) and tarballs, via HTTPS to `https://registry.npmjs.org/` unless configured otherwise.
- **The global cache** — its job: keep one extracted copy of each package version and the fetched manifests, via the folder `~/.bun/install/cache` (or `$BUN_INSTALL_CACHE_DIR`).
- **The linker** — its job: place cached files into `node_modules`, via one backend system call per file or folder (`link`, `clonefile`, `copy_file_range`, `symlink`).
- **The lockfile** — its job: remember the resolution for the next run, via `bun.lock` in the project root.

```
[package.json, bun.lock, bunfig.toml, .npmrc]        local
        │ read
        ▼
   resolver ── range already pinned in bun.lock? ── yes ──┐
        │ no                                              │
        ▼                                                 │
   manifest in cache and < 5 min old? ── yes ──┐          │
        │ no                                    │          │
 ═══════╪═══ network ═══════════════════════════╪══════════╪═══
        ▼                                       │          │
   registry: GET manifest ──► pick version ◄────┘          │
                                 │                         │
   tarball in cache? ── no ──► registry: GET tarball, check sha512
        │ yes                    │ extract
 ═══════╪════════════════════════╪═══════════════════════════════
        ▼                        ▼                         ▼
   ~/.bun/install/cache/<name>@<version>@@@1/  ──► linker: hardlink / clonefile / copy
                                                     into node_modules
                                                          │
                                                          ▼
                                                     save bun.lock
```

1. **Resolver (local):** reads `package.json`, then `bun.lock` if it exists, then the global `~/.bunfig.toml` and the project `bunfig.toml` (the project's keys win), plus `.npmrc` for registries ✅[^1] ✅[^9]. In the lab a registry token in `~/.bunfig.toml` and `exact = true` in the project file both applied, and for the same scope key the project's token won over the global one ✅[^lab].
2. **Resolver (local, maybe network):**
   - A range that `bun.lock` already pins is not resolved again, so nothing is asked ✅[^1]. With an unchanged `bun.lock` and an empty cache, the lab registry received four tarball requests and no manifest request ✅[^lab].
   - Any other range needs the package's manifest. Bun keeps manifests in the cache as binary `<hash>.npm` files and reuses them for 5 minutes ✅[^1] ✅[^lab]. The 5 minutes is a ceiling, the constant `MAX_MANIFEST_AGE = 300` (seconds) in the source: a `Cache-Control: max-age` below 300 or `no-cache` shortens it, a longer `max-age` does not lengthen it, and the `Age` header is not read ✅[^12]. The lab's registry published a new version 5 seconds after a first install: a plain `bun add` still took the old one, and only after 305 seconds the new one; a package sent with `max-age=2` or `no-cache` was fetched again after 5 seconds, one sent with `max-age=3600` and `Age: 99999` only after 305 seconds ✅[^lab].
   - `--force` asks the registry again and `--no-cache` ignores the cached manifests for one run ✅[^1]; both took the new version at once in that run ✅[^lab].
   - The resolver picks the newest version the range allows, after any `overrides` and the optional minimum-release-age gate ✅[^1] ✅[^lab].
3. **Bun → registry (network):** a tarball that the cache lacks is downloaded, checked against its `sha512` integrity hash (skipped only with `--no-verify`), and extracted ✅[^1] ✅[^lab]; see the republished-tarball row in Edge cases. Without a lockfile, or after `package.json` changed, downloads start while resolution is still running; with an unchanged lockfile only the missing packages are fetched ✅[^1]. The lab registry's log showed both: on a first install of `chain-a → chain-b → chain-c` the `chain-a` tarball was requested 65 ms in, before the `chain-c` manifest (66 ms); with the lockfile unchanged and one package deleted from `node_modules`, a warm cache put it back with no request, and an empty cache led to one request, for that package's tarball ✅[^lab].
4. **Global cache (local):** each version lands in `<cache>/<name>@<version>@@@1/`, next to a `<cache>/<name>/<version>@@@1` symlink and the hashed `.npm` manifests ✅[^lab]. The docs describe the folder as `${name}@${version}`; a prerelease or build suffix is replaced by a hash to keep paths short ✅[^1] ✅[^2]. In the lab `@lab/hello@1.1.0-beta.1` landed in `hello@1.1.0-c0734e9369ab610d@@pm-verdaccio__2b916cbd6ee04b26@@@1`: the `-beta.1` became a hash, and a package from a registry other than npm gets `@@<host>__<hash>` before `@@@1` ✅[^lab].
5. **Linker (local):** a package that `node_modules` already holds at the expected name and version is skipped ✅[^1] ✅[^2]. In the lab an edit to a copied `node_modules/ms/index.js` survived the next `bun install` (`no changes`); after the `version` in that folder's `package.json` was changed to `2.1.2`, the install put `ms@2.1.3` back ✅[^lab]. Every other package is placed with the backend:

   | Backend | Default on | What `node_modules` gets |
   |---|---|---|
   | `hardlink` | Linux, Windows | hard links to the cache files (link count 2 in the lab, on Linux and on macOS) ✅[^1] ✅[^lab] |
   | `clonefile` | macOS | copy-on-write clones: no extra space until a file is written ✅[^1] ✅[^2]; on macOS each file got its own inode with link count 1 but the cache file's APFS clone ID and 0 private bytes ✅[^lab] |
   | `copyfile` | fallback for both | real copies via `copy_file_range()` on Linux, `fcopyfile()` on macOS ✅[^1]; link count 1 on both, and on macOS a new clone ID with every byte private, so `fcopyfile()` copied the data rather than cloning it ✅[^lab] |
   | `symlink` | only with `--backend symlink` | one symlink per file into the cache ✅[^1] ✅[^lab] |

   **The backends on macOS (measured).** Bun 1.4.5, cross-compiled in a container with `bun build --compile --target=bun-darwin-arm64` and run on the host Mac (macOS 26.1, arm64, APFS) with `HOME` and the cache inside the lab folder; `bun install --help` there lists `"clonefile" (default), "hardlink", "symlink", "copyfile"` ✅[^lab]. An *APFS clone* is a new file (own inode) that shares the original's data blocks until one of them is written. `stat` and `du` cannot see the sharing, so the lab read two attributes with `getattrlist()` from a Bun script: the *clone ID*, the same for files that are pure clones of each other, and the *private size*, the bytes that deleting the file would free ✅[^14] ✅[^lab]. Same 10 packages (1,145 files) as the Linux runs, warm cache, `node_modules` deleted before each run, median of 5 after one warm-up, two batches ✅[^lab]:

   | `--backend` | `node_modules/lodash/lodash.js` | Free space used (`df`, 3 runs) | Time, batch 1 / 2 |
   |---|---|---|---|
   | none (default) or `clonefile` | own inode, link count 1, clone ID `3ce1539` like the cache file, 0 private bytes | 0.4–1.1 MB (folders and inodes only) | 15 / 15 ms |
   | `hardlink` | the cache file's inode, link count 2 | not measured | 360 / 440 ms |
   | `copyfile` | own inode, new clone ID, all 544,768 bytes private | 5.7–6.5 MB, a full copy | 159 / 167 ms |
   | `symlink` | symlink to the absolute cache path | not measured (`du`: 0 KB) | 63 / 61 ms |

   `du -sk node_modules` printed 6,004 KB for clones and copies alike, and over cache plus `node_modules` it counted clones twice (12,536 KB) but hard links once (6,532 KB), so on macOS `df` or the private size, not `du`, shows what a clone costs ✅[^lab]. On the 1,406-package project of [linkers-hoisted-and-isolated.md](linkers-hoisted-and-isolated.md) the gap is clearer: a hoisted install lowered free space by 14 MB with `clonefile` and by 375 MB with `copyfile`, while `du` printed 357 MB for both ✅[^lab].
6. **Scripts (local):** the project's own `preinstall`, `postinstall` and `prepare` run; scripts of dependencies run only for trusted packages, see [lifecycle-scripts-and-supply-chain.md](lifecycle-scripts-and-supply-chain.md) ✅[^1] ✅[^lab].
7. **Lockfile (local):** `bun.lock` is saved except under `--frozen-lockfile`, `--production`, `--dry-run` and `--no-save` ✅[^3] ✅[^lab]. The lockfile page adds "even when nothing changed"; the lab saw no rewrite then, see Edge cases.

### What `bun.lock` records
**JSONC** means "JSON with Comments": JSON that also allows comments and trailing commas, the format of `tsconfig.json` ✅[^7]. The lab's lockfile for four dependencies (trimmed) ✅[^lab]:
```jsonc
{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "p1",
      "dependencies": { "chalk": "^4.1.2", "is-number": "^7.0.0", "ms": "^2.1.3" },
      "devDependencies": { "zod": "^3.23.8" },
    },
  },
  "packages": {
    "chalk": ["chalk@4.1.2", "", { "dependencies": { "ansi-styles": "^4.1.0", "supports-color": "^7.1.0" } }, "sha512-oKnb…"],
    "ms": ["ms@2.1.3", "", {}, "sha512-6Flz…"],
  }
}
```

| Field | Meaning |
|---|---|
| `lockfileVersion` | Format version: `2` for new lockfiles since Bun 1.4.0, `3` when nested or version-scoped `overrides` are used ✅[^6] ✅[^lab]; Bun 1.3.14 (`oven/bun:1.3.14`) wrote `1` for the same project ✅[^lab] |
| `configVersion` | Which install defaults apply: `1` for projects created since Bun 1.3.2, `0` for older lockfiles and npm or Yarn migrations; it picks the default linker ✅[^6] ✅[^8] ✅[^lab]. Bun 1.3.14 also wrote `1`; Bun 1.3.2 itself was not in the lab, so the start date rests on its release notes ✅[^lab] |
| `workspaces` | The ranges each `package.json` declared, keyed by folder (`""` is the root) ✅[^lab] |
| `packages` | One entry per resolved package; its shape depends on where the package came from (below) ✅[^13] ✅[^lab] |

**The fields of a `packages` entry.** The writer in `src/install/lockfile/bun.lock.rs` at tag `bun-v1.4.5` documents one array shape per kind of source ✅[^13]. For a registry package the second field is the tarball URL, written only when that URL is not under the default registry `https://registry.npmjs.org/`; `""` means "the default registry" ✅[^13] ✅[^lab]. Other kinds have no registry field: a tarball, `file:`, `link:` or git entry puts its object of dependencies and `bin` second, and a workspace entry holds only its path. The lab's entries (Verdaccio as the registry, a local git repository in `bunlab:1`; trimmed) ✅[^lab]:
```jsonc
"is-number": ["is-number@7.0.0", "", {}, "sha512-41Ci…"],                       // npm registry: second field ""
"is-number": ["is-number@7.0.0", "http://pm-verdaccio:4873/is-number/-/is-number-7.0.0.tgz", {}, "sha512-41Ci…"], // other registry
"ms":        ["ms@http://pm-verdaccio:4873/ms/-/ms-2.1.3.tgz", {}, "sha512-6Flz…"],  // tarball URL: info object, then integrity
"ms-local":  ["ms@./ms-2.1.2.tgz", {}, "sha512-sGkP…"],                        // local tarball
"localdir":  ["localdir@file:localdir", {}],                                   // file: folder
"linkdir":   ["linkdir@link:./linkdir", {}],                                   // link:
"gitdep":    ["gitdep@git+file:///srv/gitdep#67907d0…", { "dependencies": { "ms": "^2.1.0" } }, "67907d0…"], // git: resolved commit last
"@demo/app": ["@demo/app@workspace:packages/app"]                              // workspace: path only
```

**`bun.lockb`, the legacy binary lockfile.** Bun wrote it before 1.2 ✅[^3]. In `oven/bun:1.1.45` a plain `bun install` wrote a 3,697-byte `bun.lockb` that begins with `#!/usr/bin/env bun` and `bun-lockfile-format-v`, and `bun ./bun.lockb` printed it as a Yarn v1 lockfile (`ms@^2.1.2: version "2.1.2"`, with its `integrity`) ✅[^lab]. Bun 1.4.5 still writes one when `install.saveTextLockfile = false` and no lockfile exists ✅[^5] ✅[^lab]. On the 1.1.45 file, Bun 1.4.5 behaved like this ✅[^lab]:
- A plain `bun install` and `bun add zod` both rewrote `bun.lockb` in place (`Saved lockfile`), created no `bun.lock`, and kept `ms@2.1.2` although `^2.1.2` allows 2.1.3.
- `bun install --save-text-lockfile --frozen-lockfile --lockfile-only`, the documented conversion ✅[^1] ✅[^3], printed `Saved bun.lock (9 packages)` and deleted `bun.lockb`, which the docs tell you to do by hand. The new file had `"lockfileVersion": 2`, `"configVersion": 0` and `"ms": ["ms@2.1.2", "", {}, "sha512-sGkPx+Vj…"]`, the integrity string the binary file held. `bun install --save-text-lockfile` alone converted it as well.
- A monorepo locked by 1.1.45 kept the flat hoisted layout before and after the conversion, because the converted lockfile says `configVersion: 0`.

### Which flags write what

| Command | `node_modules` | `bun.lock` | Lab result |
|---|---|---|---|
| `bun install` | installed | saved | `Saved lockfile` ✅[^lab] |
| `bun install --frozen-lockfile`, `bun ci` | installed | not written (the `bun.lockb` conversion above is the one exception); exit 1 if a `package.json` edit adds or removes a package or changes a locked version ✅[^1] ✅[^3] | `error: lockfile had changes, but lockfile is frozen` ✅[^lab] |
| `bun install --production` | no `devDependencies`; implies `--frozen-lockfile` ✅[^1] | not written | 8 of 9 packages, `zod` (dev) left out; with `is-number` added to `package.json` it failed with the frozen-lockfile error, exit 1 ✅[^lab] |
| `bun install --dry-run` | untouched; prints the resolved tree; no scripts ✅[^1] | not written | folder still held only `package.json`; the root `postinstall` did not run ✅[^lab] |
| `bun install --no-save` | installed | not written ✅[^1] | `node_modules`, no `bun.lock` ✅[^lab] |
| `bun install --lockfile-only` | untouched | saved ✅[^3] | `Saved bun.lock (10 packages)` ✅[^lab] |
| `bun install --frozen-lockfile --dry-run` | untouched | not written; validates only ✅[^1] | exit 1 on the same drift ✅[^lab] |

### Migration from other package managers
- With no `bun.lock`, Bun migrates the first lockfile it can, in this order: `npm-shrinkwrap.json`, `package-lock.json` (`lockfileVersion` 2, 3 or 4), `yarn.lock` (Yarn v1 and Yarn 2+), `pnpm-lock.yaml` (lockfile versions 7 to 9) ✅[^3] ✅[^1]. The lab put hand-written lockfiles for `ms` side by side: with all four present Bun printed `migrated lockfile from npm-shrinkwrap.json` and kept its `2.1.1`; without it, `package-lock.json` (`2.1.2`), then `yarn.lock` (`2.1.0`) won ✅[^lab]. A `package-lock.json` edited to `lockfileVersion: 4` and `pnpm-lock.yaml` files with `lockfileVersion` `'7.0'`, `'8.0'` and `'9.0'` migrated; `'6.0'` and `5.4` gave `warn: cannot migrate pnpm-lock.yaml: unsupported lockfileVersion 6.0, resolving from package.json` ✅[^lab].
- It keeps the locked versions and integrity hashes and leaves the original file in place ✅[^3] ✅[^lab]. In the lab, hand-written Yarn v1, Yarn 2+ (`__metadata.version: 8`) and pnpm v9 lockfiles that pinned `ms@2.1.1` all kept `2.1.1` although `^2.1.0` allows `2.1.3` ✅[^lab].
- Only commands that save a lockfile write the migrated `bun.lock`; `--frozen-lockfile`, `--dry-run`, `--no-save` and read-only commands migrate in memory ✅[^3] ✅[^lab]. `bun pm migrate` migrates without installing ✅[^4]: on a `yarn.lock` project it wrote `bun.lock` with `ms@2.1.0` and created no `node_modules` ✅[^lab].
- A lockfile migrated from npm or Yarn gets `configVersion: 0` (hoisted layout) ✅[^8] ✅[^lab]; one from pnpm gets `1` ✅[^8] ✅[^lab].

## Worked example
An npm project moves to Bun, then CI enforces the lockfile. Bun 1.4.5 in `oven/bun:1.4.5`, project in the container's `/tmp` ✅[^lab].

1. **npm writes the lockfile.** In `node:24.22.1-alpine`, `npm install --package-lock-only --ignore-scripts ms@2.1.2 is-number@7.0.0` writes `"ms": "^2.1.2"` to `package.json` and `lockfileVersion: 3` with `ms` locked at `2.1.2`, although `2.1.3` exists and fits the range.
2. **First `bun install`:**
   ```console
   [0.20ms] migrated lockfile from package-lock.json
   Saved lockfile
   + is-number@7.0.0
   + ms@2.1.2
   2 packages installed [161.00ms]
   ```
   `ms` stays at `2.1.2`; `package-lock.json` is still there next to the new `bun.lock`.
3. **The new lockfile** has `"lockfileVersion": 2`, `"configVersion": 0` and `"ms": ["ms@2.1.2", "", {}, "sha512-sGkPx+Vj…"]`, the same integrity string npm recorded.
4. **On disk:** `node_modules/ms/index.js` and `/root/.bun/install/cache/ms@2.1.2@@@1/index.js` share inode `2253552` with a link count of 2.
5. **A developer adds `zod` to `package.json` but forgets the lockfile.** CI runs `bun ci`:
   ```console
   error: lockfile had changes, but lockfile is frozen
   note: dependencies in package.json changed since bun.lock was saved: zod was added
   note: try re-running without --frozen-lockfile and commit the updated lockfile
   ```
   Exit code 1. After a local `bun install` (which saves `bun.lock`), `bun ci` prints `Checked 3 installs across 4 packages (no changes)` and exits 0.

**What the cache saves (measured).** Five direct dependencies (`chalk`, `ms`, `is-number`, `zod`, `lodash`; 10 packages in `bun.lock`), lockfile present, timed from a Bun script around `bun install --no-progress`, Docker 29.8.2 on OrbStack (arm64, 8 CPUs, kernel 7.2.12), network to the public registry; median of 5 runs, two batches ✅[^lab]:

| Scenario | Batch 1 median | Batch 2 median |
|---|---|---|
| Cold: empty cache (`BUN_INSTALL_CACHE_DIR` new each run), no `node_modules` | 693 ms | 478 ms |
| Warm: cache filled, `node_modules` deleted | 116 ms | 81 ms |
| No-op: everything in place | 7 ms | 5 ms |

The cold runs spread from 397 to 1,151 ms because they depend on the network, and a later warm-only batch gave medians of 36 ms and 27 ms, so warm times on this machine moved between 27 and 116 ms ✅[^lab]; treat the numbers as this machine's, not as a benchmark.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Project on a Docker bind mount, cache inside the container | Files are copied: link count 1 ✅[^lab] | A hard link cannot cross filesystems (`link()` fails with `EXDEV`) ✅[^11], so `hardlink` falls back to copying ✅[^1] |
| `--backend clonefile` on Linux | The lab still got hard links (link count 2); `bun install --help` on Linux lists only `hardlink`, `symlink` and `copyfile`, on macOS all four ✅[^lab] | `clonefile` exists only on macOS ✅[^1] |
| `--frozen-lockfile` after `^7.0.0` → `>=7.0.0` | Passes (`no changes`) ✅[^lab] | Only edits that change a locked version fail; range edits that keep it do not ✅[^1] |
| `package-lock.json` with `lockfileVersion` 1 (npm 6) | `warn: cannot migrate package-lock.json: unsupported lockfileVersion 1, resolving from package.json`; `ms` moved from 2.1.1 to 2.1.3 ✅[^lab] | The docs say v1 is not migrated ✅[^3]; the Bun 1.4 release notes say the npm migrator handles versions 1 through 4 ✅[^6], which 1.4.5 contradicts |
| `--frozen-lockfile` on a migrated npm or Yarn project | Installs from the migrated lockfile, writes nothing; the lab printed no `note:` line ✅[^lab] | The docs say a `note:` asks you to run `bun install` and commit ✅[^3] |
| `devDependencies` already in `node_modules`, then `--production` | They stay ✅[^1] ✅[^lab] | `--production` only decides what is installed; `bun prune --production` removes them (lab: `zod` removed) ✅[^1] ✅[^lab] |
| `--frozen-lockfile` with no lockfile at all | Installs from `package.json`, writes no lockfile ✅[^1] ✅[^lab] | Nothing to compare against |
| A version was published minutes ago | Bun may not see it for up to 5 minutes; `bun add <pkg> --force` or `bun update <pkg>` refreshes ✅[^1]. Lab, 5 seconds after the publish: plain `bun add` → old version; `--force`, `bun update`, `--no-cache` and `disableManifest = true` → new one; `bun add pkg@1.0.0 --force` sent no request; an exact version missing from the cached manifest was fetched ✅[^lab] | Manifests are cached for at most 300 seconds; `max-age` below that and `no-cache` are honoured, `Age` is not read ✅[^12] ✅[^lab] |
| The registry serves other bytes for a locked version | Lab: Verdaccio's `integ-pkg@1.0.0` was unpublished and published again with a changed `index.js`; with the old `bun.lock` and an empty cache: `error: Integrity check failed for tarball: integ-pkg`, exit 1; `--no-verify` installed the changed file ✅[^lab] | The `sha512` in `bun.lock` must match the download ✅[^1] |
| Plain `bun install` or `--lockfile-only` on an up-to-date project | The lockfile page says Bun saves `bun.lock` anyway ✅[^3]; in the lab both printed `no changes` and left the file's modification time (set to 2020-01-01) untouched ✅[^lab] | 1.4.5 skips writing an unchanged lockfile |
| `bun pm cache rm` | Deletes the whole cache, including the global virtual store under `<cache>/links/`; the lab printed `note: global store was removed too, run 'bun install' in each project that uses it` ✅[^1] ✅[^4] ✅[^lab] | Projects using the global store break until reinstalled; see [linkers-hoisted-and-isolated.md](linkers-hoisted-and-isolated.md) |
| Editing a file in `node_modules` by hand | With hard links the edit also changes the cache copy; `bun patch <pkg>` first replaces the links with private copies (link count 1 in the lab) ✅[^lab] ✅[^10]. With the macOS default clones it does not: a line appended to `node_modules/lodash/lodash.js` was absent from the cache copy, and only one 4,096-byte block of the edited file became private ✅[^lab] | Hard link: one file, two names. Clone: two files sharing blocks until one is written |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `hardlink` (Linux default) | No extra disk per project; fast on Linux | An edit in `node_modules` reaches the cache; needs the cache on the same filesystem ✅[^10] ✅[^lab]. On macOS it was the slowest backend: 360 / 440 ms against 15 ms for the default `clonefile` ✅[^lab] |
| `clonefile` (macOS default) | No extra disk until a file is written, and an edit stays in the project's copy; fastest on macOS ✅[^1] ✅[^lab] | APFS only; `du` overstates the disk it uses ✅[^lab] |
| `copyfile` | Each project owns its files | Slowest backend on Linux; full disk use per project ✅[^1]. Lab, 10 packages, warm cache, median of 5 in two batches: `hardlink` 19 / 15 ms, `symlink` 30 / 19 ms, `copyfile` 54 / 30 ms; `du` over cache and `node_modules` together: 6,572 KB with `hardlink` (the cache alone), 12,576 KB with `copyfile` ✅[^lab] |
| `symlink` | Smaller `node_modules` (4,580 KB against 6,004 KB of copies in the lab; with the cache, 11,152 KB in all) ✅[^lab] | Node.js resolves a dependency's own dependencies only with `--preserve-symlinks` or nested `node_modules` ✅[^1]. Lab, cache outside the project: `node app.js` in `node:24.22.1-alpine` failed with `Cannot find module 'ansi-styles'` (chalk's dependency), `node --preserve-symlinks app.js` worked, and `bun app.js` worked without the flag ✅[^lab] |
| `bun.lock` (text) | Reviewable diffs, mergeable, readable by tools ✅[^7] | No size cost in the lab: 2,490 bytes against 4,458 bytes of `bun.lockb` for the same 10 packages ✅[^lab] |
| `bun ci` in CI | Drift fails the build early ✅[^1] | `bun.lock` must be committed and kept current ✅[^1] |

## Takeaways
- Commit `bun.lock` and run `bun ci` (or `bun install --frozen-lockfile`) in CI, never a plain `bun install`. [rule-candidate]
- Refresh one stale package with `bun update <pkg>` or `bun add <pkg> --force`; do not delete the cache to do it.
- Keep `node_modules` on the same filesystem as the cache (not a bind mount) when you want hard links; check with `stat -c '%h'`.
- On macOS keep the default `clonefile` backend, and judge its disk use with `df`, not `du`; `--backend hardlink` was about 25 times slower there.
- Migrate from npm or Yarn by running `bun install` once with the old lockfile still present, then commit `bun.lock`; regenerate an npm 6 lockfile first. [rule-candidate]

## Verification status
- Verified: 154 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24 and 2026-11-25; the macOS rows ran Bun 1.4.5 cross-compiled for `bun-darwin-arm64` on the host Mac (macOS 26.1, arm64, APFS) as the full `bun` CLI (`BUN_BE_BUN=1`) with `HOME`, `TMPDIR` and the cache inside the lab folder, clone IDs and private sizes read with `getattrlist()` through `bun:ffi`; `oven/bun:1.1.45` (`1.1.45+196621f25`) wrote the `bun.lockb` and `oven/bun:1.3.14` (`1.3.14+0d9b296af`) the version-1 lockfile; `node:24.22.1-alpine` (npm 11.19.1) wrote the `package-lock.json`, republished the tampered tarball and ran Node.js on the symlink install; `bunlab:1` (the image plus git 2.47.3) held the git dependency; registries on a private Docker network: `verdaccio/verdaccio:6` (6.11.3, proxying npm) and a small Bun script that serves crafted manifests and logs every request, used for the cache-lifetime and download-order runs. [^lab]
- [bun install](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/install.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: install steps, manifest cache and `--force`, eager and lazy downloads, backends and defaults, `--frozen-lockfile`, `bun ci`, `--production`, `--dry-run`, `--no-save`, offline flags, bunfig lookup, lockfile conversion command. [^1]
- [Global cache](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/global-cache.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: cache location, folder naming, skip check, hard links and `clonefile`. [^2]
- [Lockfile](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/lockfile.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: when `bun.lock` is saved, `bun.lockb` history, migration order and versions, in-memory migration. [^3]
- [bun pm](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/pm.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `bun pm cache rm`, `bun pm migrate`. [^4]
- [bunfig.toml](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/bunfig.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `install.saveTextLockfile`. [^5]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: `lockfileVersion` 2 and 3, `configVersion` history, the npm migrator claim in Edge cases. [^6]
- [Bun's new text-based lockfile](https://bun.com/blog/bun-lock-text-lockfile) — Bun blog, 2024. Backs: why a text lockfile, JSONC format. [^7]
- [Isolated installs](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/isolated-installs.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `configVersion` per migration source. [^8]
- [.npmrc support](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/npmrc.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `.npmrc` read for registries. [^9]
- [bun patch](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/patch.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `bun patch` makes an unlinked copy before editing; editing without it can change the cache. [^10]
- [link(2)](https://man7.org/linux/man-pages/man2/link.2.html) — Linux man-pages project, living. Backs: `EXDEV` across filesystems. [^11]
- [src/install/npm.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/install/npm.rs) — Bun source, 2026. Backs: `MAX_MANIFEST_AGE = 300`, `Cache-Control` handling in `manifest_expiry`. [^12]
- [src/install/lockfile/bun.lock.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/install/lockfile/bun.lock.rs) — Bun source, 2026. Backs: the array shape of each `packages` entry kind, the registry field written only for a non-default registry. [^13]
- [getattrlist(2)](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/man/man2/getattrlist.2) — Apple, XNU kernel source (man page), living. Backs: `ATTR_CMNEXT_CLONEID` identifies pure clones, `ATTR_CMNEXT_PRIVATESIZE` is the bytes freed on deletion. [^14]

## Related
- `bun/package-manager/linkers-hoisted-and-isolated.md` — the layout the linker builds and the global virtual store.
- `bun/package-manager/lifecycle-scripts-and-supply-chain.md` — which install scripts run.
- `bun/package-manager/pm-commands-reference.md` — all flags and `[install]` keys.
- `bun/fundamentals/configuration-and-environment.md` — `bunfig.toml` structure and `BUN_*` variables.
- `bun/internals/performance-measured.md` — install speed against npm.
- `linux/lab-setup.md` — the lab.
