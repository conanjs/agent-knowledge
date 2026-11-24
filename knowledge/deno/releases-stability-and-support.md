---
schema: knowledge-doc/v1
type: reference
topic: deno
status: verified
applies-to: ["Deno 2.9.8", "Deno 2.0–2.9 release history", "Deno 1.x to 2.x migration"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, releases, release-channels, lts, semver, stability, unstable-flags, deno-upgrade, migration, deno-2, support-timeline, cloudflare]
ranked-sources: true
---

# Deno releases, stability policy, unstable flags and support timeline

## Summary
**TL;DR:** Deno 2.9.8 (2026-10-21) is the latest stable release. Deno ships on four channels: stable, LTS (long-term support), RC (release candidate) and canary. `deno upgrade` follows the channel built into the binary, and a bare version number always means a stable build. New APIs (application programming interfaces) start behind hidden `--unstable-*` flags; 2.9.8 accepts 27 such feature flags, and each also works as a `deno.json` `"unstable"` entry. Several graduated features still accept their old flag. On 2026-10-09 the Deno team announced it is joining Cloudflare: the runtime gets one more year of monthly bug-fix and security releases, then the team ends its development of the runtime, which stays open source; Deno Deploy shuts down after six months; JSR (the JavaScript Registry) keeps running.
**Use this when:** choosing a channel or a version to pin, deciding whether a feature still needs an `--unstable-*` flag, upgrading or downgrading the `deno` binary, porting Deno 1.x code, or planning around the end of upstream support.
**Not this doc:** what Deno is → `deno/fundamentals/what-deno-is.md`; every subcommand and global flag → `deno/toolchain/cli-subcommands.md`; every `deno.json` key → `deno/configuration/deno-json-reference.md`; KV and cron APIs → `deno/runtime-apis/workers-kv-and-cron.md`; npm and `node:` compatibility → `deno/node-compat/node-and-npm-compatibility.md`; the lab → `deno/deno-lab-setup.md`.

## Scope
Covers release channels, cadence, the 2.0–2.9 minor releases, LTS windows, the stability policy, every `--unstable-*` flag Deno 2.9.8 accepts, `deno upgrade`, the Deno 1 → 2 breaking changes, and the support timeline announced on 2026-10-09. Measured with Deno 2.9.8 on 2026-11-24.

Two terms used throughout:
- **Release channel**: a separate track of builds, like separate train lines that never share a carriage. Moving along one never moves you along another. Artifact: `deno upgrade --dry-run lts` printed `Found latest long term support version v2.9.8` ✅[^run].
- **Unstable flag**: a switch that turns on a feature whose API may still change, like a "beta" toggle in an app's settings. Artifact: `deno.json` with `{ "unstable": ["kv"] }` makes `Deno.openKv()` available ✅[^run] ✅[^unst].

## Catalog

### Release channels
| Channel | What it carries | `deno upgrade` form | Download host seen in the lab | Latest on 2026-11-24 |
|---|---|---|---|---|
| `stable` (default) | Semver (semantic versioning) minor and patch releases ✅[^stab] | `deno upgrade`, `deno upgrade stable`, `deno upgrade 2.9.7` ✅[^stab] | `https://github.com/denoland/deno/releases/download/v2.9.7/deno-aarch64-unknown-linux-gnu.zip` ✅[^run] | v2.9.8 ✅[^run] ✅[^gh] |
| `lts` | One stable minor line that gets only backwards-compatible fixes; the 2.9 line from v2.9.3 ✅[^stab] | `deno upgrade lts` ✅[^stab] | `https://dl.deno.land/release/v2.9.8/…` ✅[^run] | v2.9.8 ✅[^run] |
| `rc` | A release candidate of the next minor ✅[^stab] | `deno upgrade rc`, `--release-candidate` ✅[^upg] | `https://dl.deno.land/release/v2.0.0-rc.10/…` ✅[^run] | v2.0.0-rc.10 (see Lookup notes) ✅[^run] |
| `canary` | A build that changes several times a day ✅[^stab] | `deno upgrade canary`, `--canary`, `deno upgrade <git-hash>` ✅[^stab] ✅[^upg] | `https://dl.deno.land/canary/<hash>/…` ✅[^run] | `d8c551b5a5b46d8ec3892a91d0364cfcbca2c681` ✅[^run] |
| `alpha`, `beta` | Published only during a major-version prerelease cycle such as 3.0 ✅[^stab] | `deno upgrade alpha`, `deno upgrade beta` ✅[^upg-src] | `dl.deno.land` ✅[^stab] | not probed |

| Channel rule | Detail |
|---|---|
| Channel is fixed at build time | `deno upgrade` and the update notice use the running binary's channel ✅[^stab] |
| A version number means stable | `deno upgrade 2.9.3` installs the stable build even though 2.9.3 also ships as LTS; on LTS it moves you to stable ✅[^stab] ✅[^upg] |
| No pinned LTS patch | `deno upgrade lts` always installs the newest LTS build ✅[^stab] |

### Cadence
| Item | What the project states | Measured from the release list |
|---|---|---|
| Minor releases | Every 12 weeks (stability page) ✅[^stab]; every six weeks (2.0 and 2.1 posts) ✅[^b20] ✅[^b21] | Gaps from 2.0 to 2.9: 34 to 91 days (4.9 to 13.0 weeks) ✅[^gh] |
| Patch releases | As needed; several per minor ✅[^stab] | 4 (2.8) to 16 (2.2) releases per minor line, counting x.y.0 ✅[^gh] |
| From 2026-10-09 | Monthly bug-fix and security releases for one year ✅[^cf] | v2.9.8 on 2026-10-21 is the only release since ✅[^gh] |

### Deno 2.x minor releases
Dates: the release tag on `github.com/denoland/deno/releases` (UTC, Coordinated Universal Time) and the release post's own date.

| Minor | Tag date | Post date | Post title | Flag and stability changes the post names | Last patch (date) |
|---|---|---|---|---|---|
| 2.0 | 2024-10-09 | 2024-10-09 | Announcing Deno 2 | Standard library stable; LTS channel announced ✅[^b20] | v2.0.6 (2024-11-10) ✅[^gh] |
| 2.1 | 2024-11-21 | 2024-11-21 | Deno 2.1: Wasm Imports and other enhancements | First LTS line; `--unstable-node-globals` added ✅[^b21] | v2.1.14 (2025-09-29) ✅[^gh] |
| 2.2 | 2025-02-19 | 2025-02-19 | Deno 2.2: OpenTelemetry, Lint Plugins, node:sqlite | OpenTelemetry behind `--unstable-otel`; QUIC APIs (a transport protocol over UDP, the User Datagram Protocol) behind `--unstable-net` ✅[^b22] | v2.2.15 (2025-10-01) ✅[^gh] |
| 2.3 | 2025-04-30 | 2025-05-01 ✅[^b23] | Deno 2.3: Improved deno compile, local npm packages, and more | — | v2.3.7 (2025-06-24) ✅[^gh] |
| 2.4 | 2025-07-01 | 2025-07-02 | Deno 2.4: deno bundle is back | `deno bundle` returns; OpenTelemetry stable; `--sloppy-imports` stable; `Buffer`, `global`, `setImmediate`, `clearImmediate` always global; `--unstable-raw-imports` added ✅[^b24] | v2.4.5 (2025-08-21) ✅[^gh] |
| 2.5 | 2025-09-10 | 2025-09-10 | Deno 2.5: Permissions in the config file | `Deno.bundle()` behind `--unstable-bundle`; `--unstable-node-globals` reused for Node-style timers ✅[^b25] | v2.5.7 (2026-01-27) ✅[^gh] |
| 2.6 | 2025-12-10 | 2025-12-10 | Deno 2.6: dx is the new npx | `BroadcastChannel` stable; `--unstable-tsgo` added ✅[^b26] | v2.6.10 (2026-02-17) ✅[^gh] |
| 2.7 | 2026-02-25 | 2026-02-25 | Deno 2.7: Temporal API, Windows ARM, and npm overrides | Temporal stable; `Deno.spawn()` family added as unstable ✅[^b27] | v2.7.14 (2026-04-28) ✅[^gh] |
| 2.8 | 2026-05-22 | 2026-05-22 | Deno 2.8 | Text imports stable (bytes imports stay behind `--unstable-raw-imports`); global `setTimeout`/`setInterval` return Node's `Timeout` object; Geometry Interfaces behind `--unstable-webgpu` ✅[^b28] | v2.8.3 (2026-06-11) ✅[^gh] |
| 2.9 | 2026-06-25 | 2026-06-25 | Deno 2.9 | Stable `--unsafe-proto` alias; bare Node built-ins (`import "fs"`) need no flag; `deno desktop` experimental; legacy `request.signal` abort deprecated, new behaviour via `--unstable-no-legacy-abort` ✅[^b29] | v2.9.8 (2026-10-21) ✅[^gh] |

### LTS windows
| LTS line | Maintenance start | Maintenance end |
|---|---|---|
| v2.1 | 2025-02-01 | 2025-04-30 ✅[^stab] |
| v2.2 | 2025-05-01 | 2025-10-31 ✅[^stab] |
| v2.5 | 2025-11-01 | 2026-04-30 ✅[^stab] |
| v2.9 (from v2.9.3) | 2026-07-01 | 2027-01-31 ✅[^stab] |

LTS backports: security patches, critical bug fixes, and critical performance fixes by severity; no API changes or major features ✅[^stab].

### Stability policy
| Topic | Rule |
|---|---|
| `Deno` namespace | Stable since 1.0.0; the project aims to keep code written for 1.0.0 working ✅[^stab] |
| Version numbers | The stable channel ships semver minor and patch releases ✅[^stab]; the 1.x → 2.x breaking changes are listed in the migration guide ✅[^mig] |
| Unstable APIs | New APIs start unstable: they may change and are unavailable without a flag such as `--unstable-kv` ✅[^stab] |
| Unstable non-runtime features | Some tooling features are gated the same way, for example `--unstable-sloppy-imports` ✅[^stab] |
| Graduation | The stability page describes no formal process ✅[^stab]. In practice a minor release post announces it, and either the feature works without the flag while the flag stays accepted (`BroadcastChannel` in 2.6, Temporal in 2.7) ✅[^b26] ✅[^b27] ✅[^run], or a stable alias is added (`--sloppy-imports` in 2.4, `--unsafe-proto` in 2.9) ✅[^b24] ✅[^b29] ✅[^defs] |
| Standard library (`jsr:@std/*`) | Packages at 1.0.0 or higher are stable; 0.x packages are unstable but need no flag ✅[^stab] |

### Every `--unstable-*` flag in Deno 2.9.8
The 27 runtime and CLI (command-line interface) features below are defined in `runtime/features/data.rs` ✅[^feat]. Each one is accepted by `deno run` (exit 0) and as a `deno.json` `"unstable"` value without a warning ✅[^run]. None appears in `deno run --help` ✅[^run], because every one is defined as hidden ✅[^defs]. Kind: **API** = a runtime API, **CLI** = resolution or tooling behaviour ✅[^feat].

| Flag | Kind | What it enables | State in 2.9.8 | Env variable |
|---|---|---|---|---|
| `--unstable-bare-node-builtins` | CLI | Bare Node built-ins: `import "fs"` resolves as `node:fs` ✅[^feat] ✅[^b29] | Not needed since 2.9 ✅[^b29] | `DENO_UNSTABLE_BARE_NODE_BUILTINS` ✅[^feat] |
| `--unstable-broadcast-channel` | API | The `BroadcastChannel` global ✅[^unst] | Stable since 2.6 ✅[^b26]; `typeof BroadcastChannel` is `function` without the flag ✅[^run] | — |
| `--unstable-bundle` | API | `Deno.bundle()`, bundling from code ✅[^unst] | Gated: `typeof Deno.bundle` is `undefined`, then `function` with the flag ✅[^run] | — |
| `--unstable-byonm` | CLI | No help text in the source; hidden ✅[^feat] | Accepted ✅[^run] | — |
| `--unstable-cron` | API | `Deno.cron()` ✅[^unst] | Gated: `undefined` → `function` ✅[^run] | — |
| `--unstable-detect-cjs` | CLI | Treats `.js`, `.jsx`, `.ts`, `.tsx` as possibly CommonJS also when `package.json` has no `"type"` or is missing ✅[^unst] | Accepted ✅[^run] | `DENO_UNSTABLE_DETECT_CJS` per the docs ✅[^unst] (see Lookup notes) |
| `--unstable-ffi` | API | Unstable FFI (foreign function interface) APIs ✅[^feat] | Accepted; `--allow-ffi` itself is labelled "(Unstable)" in help ✅[^run] | — |
| `--unstable-fs` | API | Unstable file-system APIs ✅[^feat] | Accepted ✅[^run] | — |
| `--unstable-http` | API | Unstable HTTP (HyperText Transfer Protocol) APIs ✅[^feat] | Accepted ✅[^run] | — |
| `--unstable-kv` | API | Deno KV (key-value store) APIs in the `Deno` namespace ✅[^unst] | Gated; error quoted below ✅[^run] | — |
| `--unstable-lazy-dynamic-imports` | CLI | Loads statically analyzable `import()` calls lazily when not type-checking; may change semver resolution order ✅[^unst] ✅[^feat] | Accepted ✅[^run] | `DENO_UNSTABLE_LAZY_DYNAMIC_IMPORTS` ✅[^feat] |
| `--unstable-lockfile-v5` | CLI | Lockfile format v5 ✅[^feat] | Accepted ✅[^run] | `DENO_UNSTABLE_LOCKFILE_V5` ✅[^feat] |
| `--unstable-net` | API | `WebSocketStream`, `Deno.DatagramConn` ✅[^unst]; QUIC APIs ✅[^b22] | Gated: `typeof WebSocketStream` `undefined` → `function` ✅[^run] | — |
| `--unstable-no-legacy-abort` | API | `request.signal` in `Deno.serve` aborts only when the client really disconnects, not after every successful response ✅[^unst] | Accepted ✅[^run]; 2.9 warns once about the legacy behaviour ✅[^b29] | — |
| `--unstable-node-globals` | API | Docs: injects `Buffer`, `global`, `setImmediate`, `clearImmediate` ✅[^unst]. Source: deprecated, no effect ✅[^feat] | Those four globals exist without the flag ✅[^run] ✅[^b24] | — |
| `--unstable-npm-lazy-caching` | CLI | Installs only npm packages that an import references, not every `package.json` dependency at start ✅[^unst] ✅[^feat] | Accepted ✅[^run] | `DENO_UNSTABLE_NPM_LAZY_CACHING` ✅[^feat] |
| `--unstable-otel` | API | OpenTelemetry (OTel) integration ✅[^unst] | Stable since 2.4; flag not needed ✅[^unst] ✅[^b24] | — |
| `--unstable-process` | API | Unstable process APIs ✅[^feat] | `Deno.spawnAndWait()` ran without it ✅[^run] | — |
| `--unstable-raw-imports` | API | `with { type: "bytes" }` imports ✅[^feat] ✅[^b28] | Bytes gated, text stable since 2.8 ✅[^b28]; error quoted below ✅[^run] | `DENO_UNSTABLE_RAW_IMPORTS` ✅[^feat] |
| `--unstable-sloppy-imports` | CLI | Missing extensions, `.js` resolving to `.ts`, a folder resolving to its `index` file, each with a warning ✅[^unst] | Stable alias `--sloppy-imports` ✅[^b24] ✅[^defs] ✅[^run], also missing from `deno run --help` ✅[^run]; `DENO_COMPAT=1` turns it on too ✅[^run]; not supported by `deno compile` ✅[^unst] | `DENO_UNSTABLE_SLOPPY_IMPORTS` ✅[^unst] ✅[^run] |
| `--unstable-subdomain-wildcards` | CLI | Subdomain wildcards in `--allow-net` ✅[^feat] | Accepted ✅[^run] | `DENO_UNSTABLE_SUBDOMAIN_WILDCARDS` ✅[^feat] |
| `--unstable-temporal` | API | The Temporal date-time API ✅[^unst] | Stable since 2.7 ✅[^unst] ✅[^b27]; `typeof Temporal` is `object` without the flag ✅[^run] | — |
| `--unstable-tsgo` | CLI | Type-checks with TypeScript's native compiler written in Go; a preview ✅[^unst] ✅[^b26] | Accepted ✅[^run] | `DENO_UNSTABLE_TSGO` ✅[^unst] ✅[^feat] |
| `--unstable-unsafe-proto` | API | `Object.prototype.__proto__`, which Deno leaves out for security ✅[^unst] ✅[^feat] | Stable alias `--unsafe-proto` since 2.9 ✅[^b29]; `({}).__proto__` `undefined` → `object` with either spelling ✅[^run] | — |
| `--unstable-vsock` | API | VSOCK (virtual sockets between a virtual machine and its host) APIs ✅[^feat] | Accepted ✅[^run] | — |
| `--unstable-webgpu` | API | The WebGPU graphics API for the GPU (graphics processing unit), `navigator.gpu` ✅[^unst]; the 2.8 post also put the Geometry Interfaces behind it ✅[^b28] | Accepted; `DOMPoint`, `DOMMatrix`, `DOMRect` and `DOMQuad` exist without it; see Lookup notes ✅[^run] | — |
| `--unstable-worker-options` | API | `deno: { permissions }` in `new Worker()` options ✅[^unst] | Gated; error quoted below ✅[^run] | — |

Other `--unstable*` spellings in 2.9.8:

| Flag | Where | Effect |
|---|---|---|
| `--unstable` | Every subcommand | Prints ``Warning The `--unstable` flag has been removed in Deno 2.0. Use granular `--unstable-*` flags instead.``, has no effect, exit 0 ✅[^run] |
| `--unstable-hmr` | `deno run` | Alias of `--hmr` (HMR, hot module replacement), which also accepts `--watch-hmr` ✅[^defs]; `deno run --help` lists only `--hmr` ✅[^run]; printed `HMR Process started.` and kept watching ✅[^run] |
| `--unstable-component` | `deno fmt` | Formats Svelte, Vue, Astro and Angular files; `deno.json` value `fmt-component` ✅[^defs] ✅[^run] |
| `--unstable-sql` | `deno fmt` | Formats SQL (Structured Query Language) files; `deno.json` value `fmt-sql`. With either, `deno fmt --check` turned `select   a,b from   t where x=1;` into `SELECT a,b` / `FROM t` / `WHERE x=1;` and exited 1; without, it exited 0 ✅[^run] |
| `--unstable-css`, `--unstable-html`, `--unstable-yaml` | `deno fmt` | Hidden flags for CSS (Cascading Style Sheets), HTML (HyperText Markup Language) and YAML formatting ✅[^defs]; `fmt-css`, `fmt-html` and `fmt-yaml` in `deno.json` print `isn't a valid unstable feature` ✅[^run]. HTML, XML (Extensible Markup Language) and SVG (Scalable Vector Graphics) files format by default since 2.9 ✅[^b29] |

Flags without the `--unstable-` prefix that `deno run --help` labels "(Unstable)" in 2.9.8:

| Flag | Help label | Also listed by |
|---|---|---|
| `--min-dep-age <VALUE>` | "(Unstable)" minimum package age, in minutes, an ISO 8601 (the international date and time standard) duration such as `P2D`, or a date ✅[^run]; its default and behaviour → `deno/modules/dependency-management.md` | `deno add`, `outdated`, `update`, `test`, `check`, `compile`, `bundle`, `serve`, `install` help ✅[^run] |
| `--allow-ffi[=<PATH>...]`, `--deny-ffi[=<PATH>...]` | "(Unstable)" allow or deny loading dynamic libraries ✅[^run] | `deno test`, `compile`, `serve`, `install` help ✅[^run] |

### Turning a feature on
| Way | Example | Result in 2.9.8 |
|---|---|---|
| CLI flag | `deno run --unstable-kv kv.ts` | Prints `v`, exit 0 ✅[^run] |
| `deno.json` `"unstable"` | `{ "unstable": ["kv"] }` (the flag name without `--unstable-`) | Prints `v`, exit 0 ✅[^run] ✅[^unst] |
| Unknown `deno.json` value | `{ "unstable": ["foo"] }` | `Warning 'foo' isn't a valid unstable feature`, then the program runs ✅[^run] |
| Environment variable | `DENO_UNSTABLE_SLOPPY_IMPORTS=1 deno run foo.ts` | Prints `Example`, exit 0; any value counts ✅[^run] ✅[^unst] |
| `DENO_COMPAT=1` | `DENO_COMPAT=1 deno run foo.ts` | Turns on detect-cjs, node-globals, bare-node-builtins and sloppy-imports ✅[^b24]; the sloppy import printed `Example`, exit 0 ✅[^run] |

### Unstable APIs without and with their flag
| Code | Without the flag | With the flag |
|---|---|---|
| `await Deno.openKv(":memory:")` | `error: Uncaught (in promise) TypeError: Deno.openKv is not a function`, then `info: Deno.openKv() is an unstable API.` and ``hint: Run again with `--unstable-kv` flag to enable this API.``; exit 1 ✅[^run] | `v`, exit 0 ✅[^run] |
| `new Worker(url, { type: "module", deno: { permissions: { read: true } } })` | ``Unstable API 'Worker.deno.permissions'. The `--unstable-worker-options` flag must be provided.``; exit 70 ✅[^run] | `worker read permission: granted` ✅[^run] |
| `import b from "./hello.txt" with { type: "bytes" }` | `error: The import attribute type of "bytes" is unsupported.` … `hint: run with --unstable-raw-imports`; exit 1 ✅[^run] | `Uint8Array 5` ✅[^run] |
| `import { Example } from "./bar"` | `error: Module not found "file:///lab/sloppy/bar". Maybe add a '.ts' extension or run with --sloppy-imports`; exit 1 ✅[^run] | `Example` ✅[^run] |
| `typeof Deno.cron` | `undefined` ✅[^run] | `function` ✅[^run] |

### `deno upgrade`
Usage in 2.9.8: `deno upgrade [OPTIONS] <VERSION-OR-HASH-OR-CHANNEL> [PR-NUMBER-POSITIONAL]` ✅[^run]. Dry runs from 2.9.8 on aarch64 Linux, 2026-11-24:

| Command | Output | Exit |
|---|---|---|
| `deno upgrade --dry-run` | `Looking up stable version`, `Local deno version 2.9.8 is the most recent release` ✅[^run] | 0 |
| `deno upgrade --dry-run 2.9.7` | `Downloading https://github.com/denoland/deno/releases/download/v2.9.7/deno-aarch64-unknown-linux-gnu.zip`, `Deno is upgrading to version 2.9.7`, `Upgraded successfully (dry run)` ✅[^run] | 0 |
| `deno upgrade --dry-run --version 2.8.0` | The same steps for 2.8.0, then links to the 2.8.0 release notes and blog post ✅[^run] | 0 |
| `deno upgrade --dry-run 2.9.8` | `Version 2.9.8 is already installed` ✅[^run] | 0 |
| `deno upgrade --dry-run 9.9.9` | `Download could not be found, aborting` ✅[^run] | 1 |
| `deno upgrade --dry-run lts` | `Found latest long term support version v2.9.8`, download from `https://dl.deno.land/release/v2.9.8/…` ✅[^run] | 0 |
| `deno upgrade --dry-run rc` | `Found latest release candidate version v2.0.0-rc.10` ✅[^run] | 0 |
| `deno upgrade --dry-run canary` | `Found latest canary version d8c551b5a5b46d8ec3892a91d0364cfcbca2c681` ✅[^run] | 0 |
| `deno upgrade --dry-run --output /tmp/deno-297 2.9.7` | `Using cached binary from /deno-dir/dl/release/v2.9.7/deno-aarch64-unknown-linux-gnu.zip`, `Upgraded successfully (dry run)`; `/tmp/deno-297` was not created ✅[^run] | 0 |

| Option | Effect |
|---|---|
| `--dry-run` | Performs all checks without replacing the executable ✅[^run] |
| `-f`, `--force` | Replaces the executable even if it is not out of date ✅[^run] |
| `--version <VALUE>` | The version to install; same as the positional version ✅[^run] ✅[^upg] |
| `--canary`, `--release-candidate` | Same as the `canary` and `rc` channel names ✅[^run] ✅[^upg] |
| `-o`, `--output <VALUE>` | Writes the new binary to a path instead of replacing the running one ✅[^run] ✅[^upg] |
| `--checksum <VALUE>` | Verifies the archive against a SHA-256 (Secure Hash Algorithm, 256-bit) hash; releases publish `.sha256sum` files ✅[^run] ✅[^upg] |
| `--no-delta` | Always downloads the full archive; small binary patches (deltas) are the default since 2.8 ✅[^run] ✅[^upg] |
| `pr <number>`, `--pr` | Installs a pull-request (PR) build from the project's CI (continuous integration); needs the `gh` command-line tool, logged in ✅[^upg] |
| `--branch <VALUE>` | Listed with no help text ✅[^run] ✅[^upg] |
| `--cert`, `--unsafely-ignore-certificate-errors` | Custom certificate authority; skip TLS (Transport Layer Security) verification ✅[^run] |
| `-q`, `--quiet` | Hides progress, download and success messages ✅[^upg]; a global option ✅[^run] |
| Download cache | `$DENO_DIR/dl/`, reused on reinstall; keeps the 10 newest canary builds ✅[^upg] ✅[^run] |

### Deno 1 → Deno 2 changes
| Deno 1.x | Deno 2 replacement | Seen in 2.9.8 |
|---|---|---|
| `"nodeModulesDir": true \| false` | `"none" \| "auto" \| "manual"`; with a `package.json` the default is now `"manual"`, so set `"auto"` to keep 1.x auto-install ✅[^mig] | — |
| `catch (err)` typed `any` | `useUnknownInCatchVariables` is on: `err` is `unknown` ✅[^mig] | — |
| `deno bundle` | Removed in 2.0, with esbuild suggested ✅[^mig]; back in 2.4 ✅[^b24] | `deno bundle --help` prints `Output a single JavaScript file with all dependencies` ✅[^run] |
| `deno cache main.ts` | `deno install --entrypoint main.ts` ✅[^mig] | Both exit 0 ✅[^run] |
| `deno vendor` | `"vendor": true` in `deno.json` ✅[^mig] | ``error: ⚠️  `deno vendor` was removed in Deno 2.``, exit 1 ✅[^run] |
| `deno test --allow-none` | `--permit-no-files` ✅[^mig] | `error: unexpected argument '--allow-none' found` ✅[^run] |
| `--jobs=4` | `DENO_JOBS=4` ✅[^mig] | `error: unexpected argument '--jobs=2' found` ✅[^run] |
| `--ts`, `-T` | `--ext=ts` ✅[^mig] | `error: unexpected argument '--ts' found` ✅[^run] |
| `deno test --trace-ops` | `--trace-leaks` ✅[^mig] | Still accepted, exit 0 ✅[^run] |
| `--unstable` | Granular `--unstable-*` flags or `deno.json` `"unstable"` ✅[^mig] | Warning, no effect ✅[^run] |
| `import x from "./a.json" assert { type: "json" }` | `with { type: "json" }` ✅[^mig] | `error: Uncaught SyntaxError: Unexpected identifier 'assert'` ✅[^run] |
| `window` | `globalThis` ✅[^mig] | `typeof window` is `undefined` ✅[^run] |
| `Deno.run()` | `new Deno.Command()`; soft-removed (types gone, code kept) ✅[^mig] | Still a function ✅[^run] |
| `Deno.serveHttp()` | `Deno.serve()`; soft-removed ✅[^mig] | Still a function ✅[^run] |
| `Deno.stdin.rid`, `Deno.stdout.rid`, `Deno.stderr.rid` | Instance methods; soft-removed ✅[^mig] | `Deno.stdin.rid` is a number ✅[^run] |
| `.rid` on `Conn`, `FsFile`, `Listener`, `TcpConn`, `TlsConn`, `TlsListener`, `UnixConn`, `FsWatcher` | Instance methods; RIDs (resource IDs) are being phased out ✅[^mig] | — |
| `Deno.close`, `read`, `write`, `seek`, `fstat`, `ftruncate`, `fsync`, `fdatasync`, `flock`, `funlock`, `futime`, `shutdown` (and `*Sync`) | The same method on the resource, e.g. `file.close()` ✅[^mig] | `typeof Deno.close` is `undefined` ✅[^run] |
| `Deno.Buffer`, `copy`, `iter`, `readAll`, `writeAll` (and `*Sync`); types `Reader`, `Writer`, `Closer`, `Seeker` | `jsr:@std/io` ✅[^mig] | `Deno.Buffer`, `Deno.copy`, `Deno.iter`, `Deno.readAll` are `undefined` ✅[^run] |
| `Deno.File`, `new Deno.FsFile(rid)` | `Deno.FsFile`; `Deno.open()` / `Deno.openSync()` ✅[^mig] | `Deno.File` is `undefined` ✅[^run] |
| `Deno.isatty(rid)` | `isTerminal()` on the file or stdio object ✅[^mig] | Still a function (`Deno.isatty(0)` → `false`) ✅[^run] |
| `Deno.customInspect` | `Symbol.for("Deno.customInspect")` ✅[^mig] | `undefined` ✅[^run] |
| `Deno.metrics()`, `Deno.resources()` | No replacement ✅[^mig] | Both `undefined` ✅[^run] |
| `Deno.Server` type | `Deno.HttpServer` ✅[^mig] | — |
| TLS options `certChain`, `certFile`, `privateKey`, `keyFile` | `cert` and `key`, given as file contents ✅[^mig] | — |

### Project status after "Deno is joining Cloudflare"
Post by Ryan Dahl, 2026-10-09 ✅[^cf].

| Item | What the post says | Date |
|---|---|---|
| Deno team | Joins Cloudflare ✅[^cf] | 2026-10-09 |
| Deno runtime | "We will support the Deno runtime for another year with monthly releases", with bug fixes and security updates; after that year, the team ends its development of the runtime ✅[^cf] | About 2027-10-09 (one year after 2026-10-09; derived, the post gives no date) |
| Open source | Deno stays open source, and others are welcome to continue its development ✅[^cf]; the repository is MIT-licensed ✅[^lic] | — |
| Deno Deploy | Keeps operating for six months, then shuts down; paying customers get migration help to Cloudflare Workers ✅[^cf] | About 2027-04-09 (six months after 2026-10-09; derived) |
| JSR | Keeps operating; its infrastructure moves to Cloudflare ✅[^cf] | No date given |
| `rusty_v8` (the Rust bindings to V8) | Support continues ✅[^cf] | No date given |
| Fresh, Deno KV, LTS | Not addressed; Fresh appears only in the site menu and footer ✅[^cf] | — |
| Releases since the post | v2.9.8 ✅[^gh] | 2026-10-21 |

## Lookup notes
- **Cadence.** The stability page says 12 weeks between minors ✅[^stab]; the 2.0 and 2.1 posts said six weeks ✅[^b20] ✅[^b21]. The measured gaps (34 to 91 days) fit neither exactly ✅[^gh]. The living docs page is the current statement.
- **The `rc` channel pointed backwards.** The docs say `rc` is the next minor's candidate ✅[^stab], but on 2026-11-24 it resolved to v2.0.0-rc.10 ✅[^run]. Without `--dry-run`, `deno upgrade rc` would have installed a pre-release of 2.0.0, which shipped on 2024-10-09 ✅[^gh].
- **LTS end versus runtime support.** The 2.9 LTS window ends 2027-01-31 ✅[^stab], about eight months before the derived end of runtime support. The stability page was last modified 2026-07-16, before the announcement, and the post does not mention LTS ✅[^cf]. No checked source says whether the LTS window changes.
- **Derived dates.** "About 2027-10-09" and "about 2027-04-09" are one year and six months after the post's date; the post states durations only ✅[^cf].
- **Hidden flags.** The `--unstable` flag's help text in the source tells users to run `--help=unstable` ✅[^defs], and the docs say `deno --help` lists the flags ✅[^unst]. In 2.9.8, `deno run --help=unstable` printed the same 110 lines as `deno run --help`, with no `--unstable-*` entry ✅[^run]. A typo such as `--unstable-foo` gets `tip: a similar argument exists: '--unstable-ffi'` ✅[^run].
- **`--unstable` wording.** The docs call it deprecated and due for removal ✅[^unst]; the 2.9.8 warning says it "has been removed in Deno 2.0" ✅[^run]. Both are true in effect: the flag is parsed and ignored.
- **`--unstable-node-globals`.** The docs page (2026-07-02) still describes the 2.1 behaviour ✅[^unst]. In 2.4 those four globals became permanent ✅[^b24]. In 2.5 the flag switched to Node-style timers ✅[^b25], and in 2.8 those timers became the default ✅[^b28]. The 2.9.8 source calls the flag a no-op ✅[^feat].
- **`DENO_UNSTABLE_DETECT_CJS`.** The docs list this variable ✅[^unst]; `data.rs` gives `detect-cjs` no environment variable ✅[^feat]. Not probed.
- **WebGPU.** `typeof navigator.gpu` was `object` even without `--unstable-webgpu`, and `requestAdapter()` returned `null` both ways in the container, which has no GPU ✅[^run]. `DOMPoint`, `DOMMatrix`, `DOMRect` and `DOMQuad` were functions without the flag as well ✅[^run], although the 2.8 post put the Geometry Interfaces behind it ✅[^b28]. The lab could not show what the flag gates there.
- **`--unstable-process`.** The 2.7 post introduced `Deno.spawn()`, `Deno.spawnAndWait()` and `Deno.spawnAndWaitSync()` as unstable ✅[^b27]. In 2.9.8, `Deno.spawnAndWait("echo", ["hi"])` printed `true hi` without the flag ✅[^run]. No checked post announces the change.
- **`--dry-run` still downloads.** It fetches the archive into `$DENO_DIR/dl/` (a later run said `Using cached binary`) and only skips the replacement ✅[^run]. The docs example prints `Would upgrade to version …` ✅[^upg]; 2.9.8 printed `Upgraded successfully (dry run)` ✅[^run].
- **Colour.** `deno upgrade` printed terminal colour escape codes (such as `[32m`) around version numbers even with `NO_COLOR=1` ✅[^run].
- **The migration guide is frozen.** It is marked historical and no longer updated ✅[^mig]. Where 2.9.8 differs from it (`deno bundle`, `deno cache`, `Deno.isatty`, `--trace-ops`, the soft-removed APIs), see the last column of the Deno 1 → 2 table.
- **Config schema.** The `unstable` examples in the 2.9.8 `deno.json` schema list 18 names ✅[^schema]; the runtime accepted all 27 feature names plus `fmt-component` and `fmt-sql` ✅[^run].
- **Wikipedia's wording.** Wikipedia (Rank 5) calls the announcement "deprecation following acquisition" by Cloudflare and puts the end of development in 2027 ✅[^wiki]. The official post uses neither word and names no year ✅[^cf].

## Takeaways
- Pin a version, not a channel, in CI and container images (`deno upgrade 2.9.8`, the `denoland/deno:alpine-2.9.8` image); a bare version always resolves to the stable build ✅[^stab]. [rule-candidate]
- Put unstable features in `deno.json` `"unstable"` so every subcommand uses the same set, and treat `isn't a valid unstable feature` as an error ✅[^run]. [rule-candidate]
- Drop flags for graduated features (OpenTelemetry, Temporal, `BroadcastChannel`, text imports, bare Node built-ins) and use the stable aliases `--sloppy-imports` and `--unsafe-proto` ✅[^b24] ✅[^b29]. [rule-candidate]
- Run `deno upgrade --dry-run <channel>` before any channel switch; on 2026-11-24 `rc` pointed at v2.0.0-rc.10 ✅[^run]. [rule-candidate]
- Plan for the Deno team's runtime development to end about 2027-10-09 (derived) and for the 2.9 LTS window to end on 2027-01-31 ✅[^cf] ✅[^stab].

## Verification status
- Verified: 326 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Scope, Catalog, Lookup notes and Takeaways. [^run]
- [Stability and releases](https://docs.deno.com/runtime/fundamentals/stability_and_releases/) — Deno project, living (modified 2026-07-16). Rank 1. Backs: channels, channel rules, 12-week cadence, LTS windows and backports, stability policy, standard library. [^stab]
- [Unstable feature flags](https://docs.deno.com/runtime/reference/cli/unstable_flags/) — Deno project, living (modified 2026-07-02). Rank 1. Backs: flag descriptions, `deno.json` `"unstable"`, environment variables, `--unstable` deprecation, OTel and Temporal stable. [^unst]
- [deno upgrade](https://docs.deno.com/runtime/reference/cli/upgrade/) — Deno project, living (modified 2026-07-15). Rank 1. Backs: channel forms, checksums, deltas, PR builds, `--quiet`, download cache. [^upg]
- [Deno 1.x to 2.x Migration Guide](https://docs.deno.com/runtime/reference/migration_guide/) — Deno project, living (modified 2026-06-19). Rank 1. Backs: every row of the Deno 1 → 2 table. [^mig]
- [Releases · denoland/deno](https://github.com/denoland/deno/releases) — Deno project, living. Rank 1. Backs: tag dates, patch counts, latest patches. [^gh]
- [runtime/features/data.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/runtime/features/data.rs) — Deno project, 2026. Rank 1. Backs: the 27 unstable features, their kind, help text and environment variables. [^feat]
- [libs/cli_parser/src/defs.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/libs/cli_parser/src/defs.rs) — Deno project, 2026. Rank 1. Backs: flags defined as hidden, `--sloppy-imports` and `--unsafe-proto` aliases, `--unstable-hmr`, `deno fmt` unstable flags, `--help=unstable` text. [^defs]
- [cli/args/flags.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/cli/args/flags.rs) — Deno project, 2026. Rank 1. Backs: `deno upgrade alpha` and `beta` usage. [^upg-src]
- [cli/schemas/config-file.v1.json at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/cli/schemas/config-file.v1.json) — Deno project, 2026. Rank 1. Backs: the 18 `unstable` examples. [^schema]
- [LICENSE.md at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/LICENSE.md) — Deno project, 2026. Rank 1. Backs: MIT licence. [^lic]
- [Deno is joining Cloudflare](https://deno.com/blog/cloudflare) — Ryan Dahl, Deno, 2026-10-09. Rank 1. Backs: the project status table, the one-year and six-month durations. [^cf]
- [Announcing Deno 2](https://deno.com/blog/v2.0) — Deno, 2024-10-09. Rank 1. Backs: stable standard library, LTS announcement, six-week cadence. [^b20]
- [Deno 2.1: Wasm Imports and other enhancements](https://deno.com/blog/v2.1) — Deno, 2024-11-21. Rank 1. Backs: first LTS line, `--unstable-node-globals`, six-week cadence. [^b21]
- [Deno 2.2: OpenTelemetry, Lint Plugins, node:sqlite](https://deno.com/blog/v2.2) — Deno, 2025-02-19. Rank 1. Backs: `--unstable-otel`, QUIC behind `--unstable-net`. [^b22]
- [Deno 2.3: Improved deno compile, local npm packages, and more](https://deno.com/blog/v2.3) — Deno, 2025-05-01. Rank 1. Backs: post date and title. [^b23]
- [Deno 2.4: deno bundle is back](https://deno.com/blog/v2.4) — Deno, 2025-07-02. Rank 1. Backs: `deno bundle`, OTel stable, `--sloppy-imports`, Node globals, raw imports, `DENO_COMPAT`. [^b24]
- [Deno 2.5: Permissions in the config file](https://deno.com/blog/v2.5) — Deno, 2025-09-10. Rank 1. Backs: `--unstable-bundle`, Node-style timers flag. [^b25]
- [Deno 2.6: dx is the new npx](https://deno.com/blog/v2.6) — Deno, 2025-12-10. Rank 1. Backs: `BroadcastChannel` stable, `--unstable-tsgo`. [^b26]
- [Deno 2.7: Temporal API, Windows ARM, and npm overrides](https://deno.com/blog/v2.7) — Deno, 2026-02-25. Rank 1. Backs: Temporal stable, `Deno.spawn()` unstable. [^b27]
- [Deno 2.8](https://deno.com/blog/v2.8) — Deno, 2026-05-22. Rank 1. Backs: text imports stable, Node `Timeout` timers, Geometry Interfaces behind `--unstable-webgpu`. [^b28]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno, 2026-06-25. Rank 1. Backs: `--unsafe-proto`, bare Node built-ins, `deno desktop`, legacy abort deprecation, `deno fmt` changes. [^b29]
- [Deno (software)](https://en.wikipedia.org/wiki/Deno_%28software%29) — Wikipedia, living. Rank 5. Backs: Lookup notes, its "deprecation following acquisition" wording only. [^wiki]

## Related
- `deno/deno-lab-setup.md` — the container every output above came from.
- `deno/toolchain/cli-subcommands.md` — every subcommand and global flag in 2.9.
- `deno/configuration/deno-json-reference.md` — the full `deno.json` reference, including `unstable`.
- `deno/node-compat/node-and-npm-compatibility.md` — what the Node-related flags change in practice.
- `deno/runtime-apis/workers-kv-and-cron.md` — the KV, cron and worker APIs behind `--unstable-kv`, `--unstable-cron` and `--unstable-worker-options`.
- `deno/learning-path.md` — the reading order for the `deno/` docs.
