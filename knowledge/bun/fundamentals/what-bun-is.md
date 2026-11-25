---
schema: knowledge-doc/v1
type: concept
topic: bun/fundamentals
status: verified
applies-to: ["Bun 1.4.5", "Node.js 24.22.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, runtime, javascriptcore, rust, zig, install, upgrade, version, revision, detect-bun, docker, oven-bun]
---

# What Bun is: one binary that runs, installs, bundles and tests JavaScript

## Summary
**TL;DR:** Bun is a single executable, `bun`, that is a JavaScript and TypeScript runtime, a package manager, a bundler and a test runner at once; since 1.4.3 it also type checks (`bun check`) and since 1.4.4 formats (`bun fmt`). It runs code on JavaScriptCore, the engine of Safari, not on V8. It was written in Zig up to 1.3 and rewritten in Rust for 1.4. `bun --version` prints `1.4.5`; `bun --revision` adds the commit (`1.4.5+a7733435c`). Detect Bun at runtime with `process.versions.bun`; `process.versions.node` and `process.release.name` are set in Bun too (`26.3.0`, `"node"`), so they cannot tell the two apart.
**Use this when:** deciding what Bun replaces in a Node.js project, installing or upgrading it, reporting which exact build you run, writing code that must branch on "am I in Bun?", or picking an `oven/bun` Docker image.
**Not this doc:** running files and scripts → [running-code-and-transpilation.md](running-code-and-transpilation.md); how JavaScriptCore differs from V8 as seen from code → `bun/internals/javascriptcore-engine.md`; measured startup against Node.js → `bun/internals/performance-measured.md`; which `node:*` modules work → `bun/node-compat/nodejs-compatibility.md`.

## Problem
A typical Node.js project glues together five to eight separate tools: `node`, `npm` or `pnpm`, `tsx` or `ts-node` to run TypeScript, `esbuild` or webpack to bundle, Jest or Vitest to test, `nodemon` to restart on change, `dotenv` to read `.env`. Each has its own version, configuration file and upgrade path. When someone says "we moved to Bun", it is unclear which of those tools they replaced. Bug reports say "latest Bun" instead of an exact build. Code that needs a Bun-only API checks `process.release.name === "node"` and gets the wrong answer. Teams pick the default Docker image and get a 105 MB download running as root, when a 58 MB variant was one tag away.

## Mental model
**Analogy:** Node.js plus its tooling is a toolbox: a separate screwdriver, saw and tape measure, bought from different shops. Bun is a multi-tool: one handle, many blades, all from one maker and all the same version. You still pick a blade (`bun run`, `bun install`, `bun build`, `bun test`) for each job.

**Artifact:** the blades, as `bun --help` lists them in the lab (trimmed) ✅[^lab]:
```console
$ bun --help
Bun is a fast JavaScript runtime, package manager, bundler, and test runner. (1.4.5+a7733435c)
  run       ./my-script.ts       Execute a file with Bun
  test                           Run unit tests with Bun
  check                          Type check a TypeScript project
  fmt                            Format JavaScript and TypeScript, like Prettier
  x         prettier             Execute a package binary (CLI), installing if needed (bunx)
  repl                           Start a REPL session with Bun
  install                        Install dependencies for a package.json (bun i)
  build     ./a.ts ./b.jsx       Bundle TypeScript & JavaScript into a single file
  upgrade                        Upgrade to latest version of Bun.
```

## How it works
1. **One executable, many commands.** Bun ships as one dependency-free binary that contains the runtime, the package manager, the test runner and the bundler ✅[^1]. In the `oven/bun:1.4.5` image (arm64) that file is `/usr/local/bin/bun`, 107,405,304 bytes, and `bunx` is only a symbolic link to it ✅[^lab]. "Dependency-free" means no libraries beyond the C library: `ldd` listed only `libc.so.6`, `libpthread.so.0`, `libdl.so.2`, `libm.so.6`, the dynamic loader and `linux-vdso.so.1` ✅[^lab]. What each command stands in for:

   | Command | Replaces in a Node.js project | Owned by |
   |---|---|---|
   | `bun <file>`, `bun run` | `node`, `tsx`/`ts-node`, `npm run`, `nodemon`, `dotenv` | this subtopic |
   | `bun install`, `bun add`, `bunx` | `npm`/`pnpm`/`yarn`, `npx` | `bun/package-manager/` |
   | `bun build` | esbuild, webpack | `bun/bundler/` |
   | `bun test` | Jest, Vitest | `bun/testing/` |
   | `bun check` (since 1.4.3), `bun fmt` (since 1.4.4) | `tsc --noEmit`, Prettier | — |

   `bun check` is a port of the Go-based TypeScript 7 compiler and needs no `typescript` package ✅[^13]: in a folder with no `node_modules` and no network, `bun check k.ts` reported `TS2322: Type 'string' is not assignable to type 'number'` ✅[^lab]. `bun fmt` arrived in 1.4.4 ✅[^14]. In `oven/bun:1.3.14` both printed `error: Script not found` (`"check"`, `"fmt"`), exit 1 ✅[^lab].

2. **The engine is JavaScriptCore.** An *engine* is the part that parses and executes JavaScript; a *runtime* wraps it with APIs for files, network and processes ✅[^1]. Bun uses JavaScriptCore (JSC), the engine Apple develops for Safari, where Node.js uses Google's V8 ✅[^2]. In the lab, Bun reports the WebKit commit it embeds in `process.versions.webkit` (`d6375c72…`) ✅[^lab]. For compatibility it also reports a Node.js version, `process.versions.node` = `26.3.0`, because Bun 1.4 targets Node.js 26 ✅[^lab] ✅[^3]. Older images report older targets: `24.3.0` in `oven/bun:1.3.14`, `22.6.0` in `oven/bun:1.1.45`, and `26.12.1` in `1.4.6-canary.1` ✅[^lab].

3. **Written in Zig, then in Rust.** Bun 1.4 "rewrites Bun from Zig to Rust" ✅[^3]; the runtime page now says the transpiler and runtime are written in Rust ✅[^2]. The repository at the `bun-v1.4.5` tag holds 3,249 `.rs` files (3,238 of them under `src/`) and no `.zig` file (counted through the GitHub tree listing on 2026-11-24) ✅[^12]. The binaries show the same change: the one in `oven/bun:1.3.14` still holds Zig source-file names such as `bundler/bundle_v2.zig` (5 distinct ones, 13 in `oven/bun:1.1.45`), the 1.4.5 binary none ✅[^lab]. Older articles that say "Bun is written in Zig" describe 1.3 and earlier.

4. **Installation.** Four routes ✅[^4]:
   - the install script, `curl -fsSL https://bun.com/install | bash` (Linux needs `unzip`; kernel 5.6 or newer is recommended), which puts the binary in `~/.bun/bin`;
   - a package manager: `npm install -g bun`, `brew install oven-sh/bun/bun`, `scoop install bun`;
   - Docker: `docker pull oven/bun` (x64 and arm64);
   - a direct download from the GitHub releases page, with separate musl builds for Alpine-like systems.

   A specific older version comes from the install script with a tag: `bash -s "bun-v1.3.3"` ✅[^4]. The script checks for `unzip` before it downloads anything ✅[^16]: run from the `bun-v1.4.5` tag in the `oven/bun:1.4.5` image (which has no `unzip`) with networking off, it printed `error: unzip is required to install bun` and stopped ✅[^lab]. What the routes did in throwaway containers on 2026-11-24 (arm64) ✅[^lab]:

   - **Install script.** `https://bun.sh/install` and `https://bun.com/install` served the same 7,631-byte file, identical to `src/runtime/cli/install.sh` at the `bun-v1.4.5` tag ✅[^lab] ✅[^16]. No lab image has both `curl` and `unzip`, so the glibc run used `mysql:8.4` (Oracle Linux 9.9, glibc 2.34, its own curl 7.76.1) with BusyBox's `unzip` from `linlab:1` as the unzip, and the musl run used `linlab:1` (Alpine 3.20, BusyBox `unzip`) with a two-line `curl` stand-in that passes the URL to BusyBox `wget`. The script fetched `releases/latest/download/bun-linux-aarch64.zip`, or `bun-linux-aarch64-musl.zip` on Alpine (it checks for `/etc/alpine-release`), and left `~/.bun/bin/bun` (107,405,304 bytes for glibc, 99,823,264 for musl) plus `~/.bun/bin/bunx`, a link that its `bun completions` step made; `~/.bun/bin/bun --revision` printed `1.4.5+a7733435c` ✅[^lab]. With `SHELL=/bin/bash` and an existing `~/.bashrc`, it appended `# bun`, `export BUN_INSTALL="$HOME/.bun"` and `export PATH="$BUN_INSTALL/bin:$PATH"`, and printed `Added "~/.bun/bin" to $PATH in "~/.bashrc"`. With no `~/.bashrc` or `~/.bash_profile`, or with `SHELL` unset (the default in a container), it changed no profile and printed the two `export` lines to add by hand. Run again with `bun` already on `PATH`, it replaced the binary, printed `Run 'bun --help' to get started` and added nothing ✅[^lab] ✅[^16].
   - **Pinned version.** `bash -s "bun-v1.4.5"` fetched `releases/download/bun-v1.4.5/bun-linux-aarch64.zip`; `bash -s "bun-v1.3.14"` installed `1.3.14+0d9b296af` ✅[^lab].
   - **npm.** In `node:24.22.1-bookworm-slim` (npm 11.19.1), `npm install -g bun@1.4.5` added two packages: `bun` and, of its 12 optional platform packages, only `@oven/bun-linux-aarch64` (declared for `libc: ["glibc"]`). Its `postinstall` script, `node install.js`, moved that package's binary to `bun/bin/bun.exe` and hard-linked `bunx.exe` to it (link count 2), so `/usr/local/bin/bun` is the 107,405,304-byte native file and runs without Node (`process.execPath` was `/usr/local/lib/node_modules/bun/bin/bun.exe`, `bun --revision` `1.4.5+a7733435c`) ✅[^lab]. npm ran the script but warned that it was "not yet covered by allowScripts". With `--ignore-scripts`, `bun.exe` was a 450-byte shell script that printed `Error: Bun's postinstall script was not run.` and the fix (`cd node_modules/bun && node install.js`), exit 1 ✅[^lab].
   - **Homebrew** (macOS 26.1 arm64, Homebrew 7.0.11; run on the Mac itself and removed afterwards) ✅[^lab]: `brew tap oven-sh/bun` added a third-party tap of 172 formulae. Homebrew 7 then refused `brew info oven-sh/bun/bun` with `Refusing to load formula oven-sh/bun/bun from untrusted tap`, yet `brew install oven-sh/bun/bun`, which names the formula in full, installed `bun 1.4.5` in about 7 s and left no `trust.json`. It put the binary in the versioned folder `/opt/homebrew/Cellar/bun/1.4.5/bin/bun`, with `bunx` a symlink to it and `/opt/homebrew/bin/bun` a symlink into the Cellar, plus zsh completions; `bun --revision` printed `1.4.5+a7733435c`, and nothing went to `~/.bun`. The binary is signed with the Bun team's Developer ID (Team ID `7FRXF46ZSN`), notarized, and carries the hardened runtime with the five entitlements of the codesign guide (`bun/bundler/single-file-executables.md`). `brew uninstall bun` and `brew untap oven-sh/bun` removed all of it.
   - **Scoop** is Windows-only and stays as documented; no Windows machine was available. The Docker route is step 8.

5. **Upgrade.** `bun upgrade` downloads the latest stable release and replaces the running binary; on a canary build it fetches the latest canary instead ✅[^5]. `bun upgrade --canary` switches to the build published from every commit on `main`, and `bun upgrade --stable` switches back ✅[^4] ✅[^5]. If Homebrew or Scoop installed Bun, upgrade with `brew upgrade bun` or `scoop update bun` so the package manager's records stay right ✅[^4]. First it asks the GitHub API for the latest release; only when that is newer does it print `Bun v<new> is out! You're on v<old>` and start downloading ✅[^17]. Lab, in a throwaway `oven/bun:1.4.5` container on 2026-11-24, with a watchdog ready to stop it before any download: `bun upgrade` and `bun upgrade --stable` printed `Fetching version tags`, then `Congrats! You're already on the latest version of Bun (which is v1.4.5)` and exited 0, the binary unchanged; with networking off, `Bun upgrade failed with error: DNSResolveFailed`, a hint to run the install script, and exit 1 ✅[^lab]. `bun upgrade --canary`, in another throwaway `oven/bun:1.4.5` container: it downloaded the canary zip (its progress counter stopped at 73,860,289 bytes), then failed with `error: Failed to locate "unzip" in PATH. bun upgrade needs "unzip" to work.`, exit 1, the binary unchanged, because the image has no `unzip` and the check comes after the download ✅[^lab]. With BusyBox's `unzip` on `PATH` it printed `[3.88s] Upgraded.`, `Welcome to Bun's latest canary build!` and a changelog link `compare/a7733435c...bd92f9bef`; `/usr/local/bin/bun` was a new file (new inode, 140,636,984 bytes) and `bun --revision` printed `1.4.6-canary.1+bd92f9bef` (`Bun.version_with_sha`: `v1.4.6-canary.1 (bd92f9bef)`), the build in the `oven/bun:canary` image ✅[^lab]. `bun upgrade --stable` then printed `Downgrading from Bun 1.4.6-canary to Bun v1.4.5`, downloaded 51,133,631 bytes and `[5.99s] Upgraded.`; `--revision` was `1.4.5+a7733435c` again, and the printed commit-log link (`compare/bun-v1.4.6...bun-v1.4.5`) returned 404, since no `bun-v1.4.6` tag exists yet ✅[^lab]. Both `--canary` runs left a `/tmp/bun-canary-timestamp-<hex>` folder. Under Homebrew (macOS, Bun 1.4.5 from `oven-sh/bun`) ✅[^lab]: `brew upgrade bun` printed `oven-sh/bun/bun 1.4.5 already installed`; `bun upgrade` printed the same "already on the latest version" message as in the container, with no word about Homebrew. `bun upgrade --canary` then overwrote the Homebrew-managed file in place: `bun --revision` became `1.4.6-canary.1+6f2cd49af`, the file grew to 138,287,391 bytes and carried only an ad-hoc signature, while `brew list --versions bun` still said `bun 1.4.5` and the folder was still named `1.4.5`. That is the conflict the docs warn about ✅[^4]; `brew reinstall oven-sh/bun/bun` put the signed 1.4.5 binary back. `scoop update bun` stays as documented (no Windows machine).

6. **Version versus revision.** The *version* is the release number in semver form (major.minor.patch); the *revision* is the git commit the binary was compiled from, so two binaries with the same version but different revisions are different builds (a canary, a local build) ✅[^6]. Observed in the lab ✅[^lab] ✅[^9]:

   | Where | Value in Bun 1.4.5 |
   |---|---|
   | `bun --version` | `1.4.5` |
   | `bun --revision` | `1.4.5+a7733435c` |
   | `Bun.version` | `"1.4.5"` |
   | `Bun.revision`, `process.revision` | `"a7733435cf40429e3b35c36072769df2052b80f1"` |
   | `Bun.version_with_sha` | `"v1.4.5 (a7733435c)"` |
   | `process.version` | `"v26.3.0"` (the Node.js version Bun imitates) |

7. **Detecting Bun at runtime.** The documented checks are `process.versions.bun` (works in plain JavaScript and in TypeScript without extra types) and `typeof Bun !== "undefined"`, which needs `@types/bun` in TypeScript, plus `"types": ["bun"]` from TypeScript 6 on ✅[^7]. The type definitions also declare `process.isBun`, "always `true` in Bun" ✅[^8]. See the Worked example for what each check returns in both runtimes.

8. **Docker images.** The `oven/bun` repository publishes four variants: `debian` (the default tag), `slim`, `alpine` and `distroless` ✅[^10]. The Dockerfiles at the release tag ✅[^11] and the tag list on Docker Hub ✅[^10] give the base image and the compressed download; the other columns were observed in the four pulled arm64 images ✅[^lab]:

   | Tag | Base image | C library | Shell | Entrypoint | `node` on `PATH` | Download (compressed) | On disk | User by default |
   |---|---|---|---|---|---|---|---|---|
   | `1.4.5`, `1.4.5-debian` | `debian:trixie` | glibc 2.41 | `dash` as `sh`, plus `bash` | `docker-entrypoint.sh` | link to `bun` | 105.4 MB | 254.1 MB | root; user `bun` (uid 1000) exists |
   | `1.4.5-slim` | `debian:trixie-slim` | glibc 2.41 | `dash`, `bash` | `docker-entrypoint.sh` | link to `bun` | 84.7 MB | 211.7 MB | root; `bun` exists |
   | `1.4.5-alpine` | `alpine:3.24` | musl (the `-musl` build) | BusyBox `sh`, no `bash` | `docker-entrypoint.sh` | link to `bun` | 58.2 MB | 114.5 MB | root; `bun` exists |
   | `1.4.5-distroless` | `gcr.io/distroless/base-nossl-debian13` | glibc | none | `bun` itself | no (the folder holds a link named `nodebun`) | 59.3 MB | 133.6 MB | root (`User` `0`); users `root`, `nobody`, `nonroot` (65532), no `bun` |

   What each lacks, as observed ✅[^lab]:
   - **Debian and slim** hold 80 Debian packages each and the same 107,405,304-byte `bun`; slim only drops documentation, manual pages and locales (1.1 MB in `/usr/share/{doc,man,locale}` against 47.3 MB). Neither has `curl`, `wget`, `unzip` or `git`, only `tar` and `gzip`, so `bun upgrade` to a new build fails there (step 5) and `apt-get install` is the way to add tools.
   - **Alpine** is Alpine 3.24 with 18 packages and `apk`; BusyBox provides `sh`, `wget` and `unzip`. Its `bun` (99,823,264 bytes) links `libstdc++.so.6` and `libgcc_s.so.1`, which the image installs.
   - **Distroless** has no shell and no package manager: `/usr/bin` is empty, `docker run oven/bun:1.4.5-distroless sh` ran `bun sh` and printed `error: Script not found "sh"` (exit 1), and `--entrypoint sh` failed with `executable file not found in $PATH`. Its working directory is `/`; it also sets `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt`, and an HTTPS `fetch` returned `200`.

   Every variant sets `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` (no transpiler cache in throwaway containers) and `BUN_INSTALL_BIN=/usr/local/bin` (so `bun install -g` works) ✅[^11] ✅[^lab]. The Debian, slim and Alpine images create a user `bun` (uid 1000) and use `/home/bun/app` as working directory ✅[^11], but do not switch to it: in all three `id` printed `uid=0(root)` ✅[^lab]. `docker inspect oven/bun:1.4.5` showed `User` empty, `WorkingDir` `/home/bun/app`, entrypoint `/usr/local/bin/docker-entrypoint.sh`, command `/usr/local/bin/bun`, and both variables plus `/usr/local/bun-node-fallback-bin` at the end of `PATH`; `id bun` printed `uid=1000(bun) gid=1000(bun)` ✅[^lab]. The official Docker guide adds `USER bun` in its final stage and starts from `oven/bun:1` ✅[^15].

## Worked example
One probe file, run in both lab images (`docker run --rm -v "$PWD:/w" -w /w oven/bun:1.4.5 bun detect.mjs`, then the same with `node:24.22.1-alpine node detect.mjs`) ✅[^lab]:
```js
// detect.mjs (trimmed: the lab copy also printed Bun.version, Bun.revision and process.versions.webkit)
console.log({
  "typeof Bun": typeof Bun, "process.versions.bun": process.versions.bun,
  "process.isBun": process.isBun, "process.versions.node": process.versions.node,
  "process.release.name": process.release.name, "process.versions.v8": process.versions.v8,
  "navigator.userAgent": globalThis.navigator?.userAgent,
});
```

| Check | Bun 1.4.5 | Node.js 24.22.1 | Tells them apart? |
|---|---|---|---|
| `typeof Bun` | `"object"` | `"undefined"` | yes |
| `process.versions.bun` | `"1.4.5"` | `undefined` | yes (documented way) |
| `process.isBun` | `true` | `undefined` | yes |
| `process.versions.node` | `"26.3.0"` | `"24.22.1"` | no: both set it |
| `process.release.name` | `"node"` | `"node"` | no |
| `process.versions.v8` | `"14.6.202.34-node.20"` | `"13.6.233.17-node.58"` | no: Bun reports a V8 string too |
| `navigator.userAgent` | `"Bun/1.4.5"` | `"Node.js/24"` | yes, but brittle (a string to parse) |

So `const isBun = typeof process !== "undefined" && !!process.versions?.bun;` is the portable test; `process.isBun` is shorter but only Bun's type definitions describe it.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `node` inside the `oven/bun` image | Runs Bun: `node -e '…process.versions.bun'` printed `1.4.5`, `process.execPath` was `/usr/local/bin/bun` ✅[^lab] | The image appends `/usr/local/bun-node-fallback-bin`, which holds `node → bun`, to `PATH` ✅[^11] |
| `node` with no arguments in that image | `error: Missing script to execute. Pass --interactive to start the Node.js-compatible REPL.`, exit 1 ✅[^lab] | Bun's `node` emulation needs a script or `--interactive`, as the message says |
| Bun invoked as `node` and `.env` files | Not loaded, since 1.4.0 ✅[^3]. Lab, a `.env` holding `WHO=from-dotenv`: `node -e` (the image's link to Bun) printed `undefined`, `bun -e` printed `from-dotenv`; in `oven/bun:1.3.14` the same `node -e` printed `from-dotenv` ✅[^lab] | Matches Node.js; see [configuration-and-environment.md](configuration-and-environment.md) |
| The default image's user | `root` (uid 0) ✅[^lab] | The Dockerfile creates `bun` but sets no `USER` ✅[^11]; add `USER bun` yourself ✅[^15] |
| `distroless` image | No shell: `docker run oven/bun:1.4.5-distroless sh` printed `error: Script not found "sh"`, because the entrypoint is `bun`; `Bun.which("node")` returned `null` and the fallback folder held only `nodebun` ✅[^lab] | Its Dockerfile borrows the build stage's `/bin` only while it runs its setup commands, and names the link `nodebun` ✅[^11] |
| `bun upgrade` inside an `oven/bun` Debian image | Downloads the new build, then fails: `Failed to locate "unzip" in PATH` ✅[^lab] | The image has no `unzip` (step 8); pin a new image tag instead of upgrading in place |
| Docs list `bun lint` | `bun lint` in 1.4.5 prints `error: Script not found "lint"` ✅[^lab]. In `1.4.6-canary.1`, not in 1.4.5, it linted a three-line file: `no-unused-vars` and `no-empty` warnings, a `no-debugger` error, `3 problems (1 error, 2 warnings)` ✅[^lab] | Documented, not in the 1.4.5 binary: the welcome page released with 1.4.5 already lists it ✅[^1], but the binary has no such command |
| Checking `process.release.name === "node"` to mean "not Bun" | True in both runtimes ✅[^lab] | Bun sets Node's fields on purpose, to stay a drop-in replacement ✅[^1] |
| Old CPU (x64 without SSE4.2, the instruction-set extension of the Nehalem generation the build targets) | Not supported; 1.4 ships one baseline x64 binary that picks AVX2/AVX-512 paths at run time ✅[^4] ✅[^3] | The separate `-haswell` build was dropped in 1.4.0. Not run: it needs an x64 CPU without SSE4.2, and the lab is an arm64 Mac whose x64 emulation does not model one |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Bun for everything (run, install, build, test) | One version and one config file (`bunfig.toml`) for the whole toolchain | A Bun bug or gap hits every stage at once; JavaScriptCore behaves differently from V8 in corner cases |
| Bun only as package manager or test runner, Node.js in production | Faster installs or tests, production engine unchanged | Two runtimes to keep in step; code may pass under one and fail under the other |
| `debian` image | Has a shell, `apt`, glibc | 105.4 MB download, 254.1 MB on disk (arm64) ✅[^lab] |
| `slim` image | Same package count and `bun` as `debian` ✅[^lab] | No manual pages or locales; still 211.7 MB on disk |
| `alpine` or `distroless` image | 58–59 MB download, 114.5 and 133.6 MB on disk ✅[^lab] | musl (Alpine) or no shell and no package manager (distroless) |

## Takeaways
- Report a Bun build as `bun --revision` (`1.4.5+a7733435c`), not "latest". [rule-candidate]
- Detect Bun with `process.versions.bun`; never with `process.release.name` or `process.versions.node`. [rule-candidate]
- In a Dockerfile `FROM oven/bun:1.4.5`, add `USER bun`, and pin the version tag rather than `latest` or `1`. [rule-candidate]
- Inside `oven/bun` images, `node` is Bun; install real Node.js if a step must run on V8.
- Upgrade with the tool that installed Bun: `bun upgrade` for the script install, `brew upgrade bun` or `scoop update bun` otherwise.
- Installing from npm, let the `bun` package's `postinstall` run; with `--ignore-scripts` the `bun` command is a stub that exits 1.
- In a container, set `SHELL` or edit the profile yourself: the install script only writes `~/.bashrc` when `SHELL` names bash and the file already exists.

## Verification status
- Verified: 81 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the Node.js comparison ran in `node:24.22.1-alpine`. `bun upgrade` ran in a throwaway container with network access, the install-script check with networking off. A later session (23:45 on 2026-11-24 to about 01:00 the next day) pulled in more images: the variants `oven/bun:1.4.5-slim`, `-alpine` and `-distroless`; the older releases `oven/bun:1.3.14` (`1.3.14+0d9b296af`) and `oven/bun:1.1.45` (`1.1.45+196621f25`); `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`); `node:24.22.1-bookworm-slim` (npm 11.19.1) for the npm install; and, for the install script, `mysql:8.4` (Oracle Linux 9.9 with curl) and `linlab:1` (Alpine 3.20 with BusyBox), with BusyBox `unzip` and a `curl`-to-`wget` stand-in where the image lacked one. `bun upgrade --canary` and `--stable` ran in a throwaway `oven/bun:1.4.5` container. The Homebrew route ran on the macOS 26.1 arm64 host on 2026-11-25 (Homebrew 7.0.11), and was removed afterwards with `brew uninstall bun` and `brew untap oven-sh/bun`. [^lab]
- [Welcome to Bun: docs/index.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/index.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: single dependency-free binary, the four tools, engine versus runtime, drop-in replacement for Node.js, the welcome-page tool list. [^1]
- [Bun Runtime: docs/runtime/index.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/index.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: JavaScriptCore by Apple, transpiler and runtime written in Rust. [^2]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Oven, 2026. Backs: the Zig-to-Rust rewrite, Node.js 26 compatibility, `.env` not loaded when invoked as `node`, baseline-only x64 builds. [^3]
- [Installation: docs/installation.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/installation.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: install routes, `unzip` and kernel note, `~/.bun/bin`, Docker variants, versioned installs, `bun upgrade`, canary, Homebrew/Scoop upgrades, CPU requirements. [^4]
- [Upgrade Bun to the latest version: docs/guides/util/upgrade.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/util/upgrade.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: what `bun upgrade`, `--canary` and `--stable` do. [^5]
- [Get the current Bun version: docs/guides/util/version.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/util/version.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `Bun.version` is semver, `Bun.revision` is the git commit. [^6]
- [Detect when code is executed with Bun: docs/guides/util/detect-bun.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/util/detect-bun.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `process.versions.bun`, `typeof Bun`, `@types/bun` and `"types": ["bun"]`. [^7]
- [packages/bun-types/overrides.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/overrides.d.ts) — Bun source (Oven), 2026. Backs: `process.isBun: true`, `process.revision`. [^8]
- [packages/bun-types/bun.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/bun.d.ts) — Bun source (Oven), 2026. Backs: `Bun.version`, `Bun.version_with_sha`, `Bun.revision`. [^9]
- [oven/bun tags](https://hub.docker.com/r/oven/bun/tags) — Docker Hub (Oven), living. Backs: the four variants and the `1.4.5-*` tags with their compressed arm64 sizes (read through the Hub's tag listing on 2026-11-24). [^10]
- [dockerhub/ at bun-v1.4.5](https://github.com/oven-sh/bun/tree/bun-v1.4.5/dockerhub) — Bun source (Oven), 2026. Backs: base images, musl build for Alpine, `node` fallback link, `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`, `BUN_INSTALL_BIN`, user `bun`, working directory, entrypoints, distroless setup. [^11]
- [Bun source repository at bun-v1.4.5](https://github.com/oven-sh/bun/tree/bun-v1.4.5) — Bun source (Oven), 2026. Backs: the source is Rust (3,249 `.rs` files, 3,238 under `src/`, 0 `.zig` files at the tag). [^12]
- [Containerize a Bun application with Docker: docs/guides/ecosystem/docker.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/ecosystem/docker.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `FROM oven/bun:1`, `USER bun` in the final stage. [^15]
- [Bun v1.4.3](https://bun.com/blog/bun-v1.4.3) — Oven, 2026. Backs: `bun check` added, a port of typescript-go, no `typescript` package needed. [^13]
- [Bun v1.4.4](https://bun.com/blog/bun-v1.4.4) — Oven, 2026. Backs: `bun fmt` added. [^14]
- [src/runtime/cli/install.sh at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/runtime/cli/install.sh) — Bun source (Oven), 2026. Backs: the install script checks for `unzip` before it downloads, picks the `-musl` build when `/etc/alpine-release` exists, edits a profile only for the shell named by `SHELL` and only when that file is writable, and skips the profile when `bun` is already on `PATH`. [^16]
- [src/runtime/cli/upgrade_command.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/runtime/cli/upgrade_command.rs) — Bun source (Oven), 2026. Backs: `bun upgrade` asks for the latest release first, stops with "already on the latest version" when current, and prints "is out" before downloading. [^17]

## Related
- `bun/fundamentals/running-code-and-transpilation.md` — the `bun run` blade in detail.
- `bun/fundamentals/configuration-and-environment.md` — `bunfig.toml`, `.env` and the variables the Docker images set.
- `bun/internals/javascriptcore-engine.md` — what using JavaScriptCore instead of V8 changes in code.
- `bun/internals/performance-measured.md` — startup and throughput measured against Node.js 24.
- `bun/node-compat/migrating-from-node.md` — replacing each Node.js tool step by step.
- `linux/lab-setup.md` — the lab.
