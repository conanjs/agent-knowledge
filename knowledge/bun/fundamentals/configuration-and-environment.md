---
schema: knowledge-doc/v1
type: reference
topic: bun/fundamentals
status: verified
applies-to: ["Bun 1.4.5", "Node.js 24.22.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, bunfig, configuration, preload, define, loader, smol, console-depth, run-shell, dotenv, env-file, node-env, environment-variables, bun-options, transpiler-cache]
---

# Bun configuration and environment: `bunfig.toml`, `.env` files and the variables Bun reads

## Summary
**TL;DR:** Bun reads `bunfig.toml` from the working directory for the runtime and almost every command (`bunx` skips it); the global `~/.bunfig.toml` (or `$XDG_CONFIG_HOME/.bunfig.toml`) only counts for package-manager commands, where both files load and the project file wins key by key, and CLI flags beat both. The runtime keys are `preload`, the `jsx*` keys, `smol`, `logLevel`, `[define]`, `[loader]`, `telemetry`, `env`, `[console] depth`, `[serve] port` and the `[run]` table. Without `NODE_ENV`, Bun loads `.env`, `.env.development`, `.env.local` and `.env.development.local`, the last one winning; `NODE_ENV=production` or `test` swaps the middle files, and `test` drops `.env.local`. A variable already set in the shell beats every file. `--env-file` replaces the default set, `--no-env-file` or `env = false` turns it off, and Bun running as `node` loads none. `$VAR` expands even inside single quotes. `process.env`, `Bun.env` and `import.meta.env` are one object.
**Use this when:** writing or debugging `bunfig.toml`, finding which `.env` file a value came from, disabling `.env` loading in production, or looking up an environment variable that changes Bun's behaviour.
**Not this doc:** what `bun run` does with scripts and binaries → [running-code-and-transpilation.md](running-code-and-transpilation.md); `[install]` keys → `bun/package-manager/pm-commands-reference.md`; `[test]` keys → `bun/testing/test-config-coverage-reporters.md`; env inlining at build time → `bun/bundler/bun-build.md`.

## Scope
Bun 1.4.5 on Linux (`oven/bun:1.4.5`, arm64), compared with Node.js 24.22.1 where useful. Think of configuration as three layers of transparent sheets laid over each other: the global `bunfig`, the project `bunfig.toml`, then command-line flags; you read the top-most value. The `.env` files are a second, separate stack. Example: `[console] depth = 4` in `bunfig.toml` prints four levels of a nested object, and `bun --console-depth 1` on the same project prints one ✅[^lab].

## Catalog

### Where `bunfig.toml` is read
| File | Read by | Precedence | Evidence |
|---|---|---|---|
| `./bunfig.toml` (next to `package.json`) | The runtime, `bun run` and every command; in the lab not `bunx` (see Lookup notes) | Overrides the same key in the global file; CLI flags override both | ✅[^1] ✅[^lab] |
| `$XDG_CONFIG_HOME/.bunfig.toml` if that variable is an absolute path, else `$HOME/.bunfig.toml` | Package-manager commands only (`install`, `add`, `remove`, `update`, `pm`, `bunx`) ✅[^1]; the source list also has `patch`, `outdated`, `publish`, `audit`, `dedupe`, `prune` ✅[^13]. Lab: a global `registry` reached a local stand-in registry from `bun x`, `bun add`, `bun info`, `bun outdated` and `bun pm view`, and a global `globalDir` placed `bun link`'s link ✅[^lab] | Below the local file, key by key (see the next row) | ✅[^1] ✅[^lab] |
| Both files, under a package-manager command | Both load, global first; each key the project file sets replaces that key, and every other global key stays. Lab: global `[install.lockfile] save = false` plus project `[install] linker = "isolated"` gave `node_modules/.bun` and no `bun.lock`; `[install.cache] dir` in both → `bun pm cache` printed the project's | — | ✅[^1] ✅[^12] ✅[^lab] |
| `XDG_CONFIG_HOME` set | An absolute value wins even when no `.bunfig.toml` exists there: the `$HOME` file was then not read (`bun pm cache` fell back to the default `/tmp/home/.bun/install/cache`); a relative value is ignored and `$HOME` is used | — | ✅[^1] ✅[^12] ✅[^lab] |
| Same global file, under `bun file.ts` or `bun run` | Ignored: a `preload` in it did not run, with `XDG_CONFIG_HOME` or `HOME` pointing at it | — | ✅[^lab] ✅[^1] |
| `--config=<path>` | Replaces `./bunfig.toml` | Relative paths resolve from the working directory | ✅[^3] ✅[^lab] |
| A file that cannot be read | Skipped when Bun found it by itself: a `./bunfig.toml` that was a folder was skipped without a message and the global value applied; the same path passed as `--config=./bunfig.toml` failed with `EISDIR: Is a directory (pread()) while reading config`, exit 1 | — | ✅[^1] ✅[^12] ✅[^lab] |
| A file that cannot be parsed | `error: Strings must be quoted` … `SyntaxError: failed to load bunfig`, exit 1 (for `logLevel = debug`); in `oven/bun:1.3.14` the same file loaded and the program ran, exit 0 | Strict TOML since 1.4.0 | ✅[^lab] ✅[^4] |

### Runtime keys (top level of `bunfig.toml`)
| Key | Value and default | Effect | CLI equivalent | Lab result |
|---|---|---|---|---|
| `preload` | array of paths | Modules run before the entry file; also how runtime plugins are registered ✅[^1] | `--preload`/`-r`, aliases `--require`, `--import` ✅[^3] | `[preload] ran before main` printed first ✅[^lab] |
| `jsx`, `jsxFactory`, `jsxFragment`, `jsxImportSource` | strings | Same meaning as the `tsconfig.json` fields, for projects without one ✅[^1] | `--jsx-runtime`, `--jsx-factory`, `--jsx-fragment`, `--jsx-import-source` ✅[^3] | `jsx = "react"`, `jsxFactory = "h"`, `jsxFragment = "Frag"` turned `<b/>` and `<></>` into calls of `h`; `jsxImportSource = "preact"` asked for `preact/jsx-dev-runtime` ✅[^lab] |
| `smol` | `false` | Garbage collection runs more often; uses less memory, runs slower ✅[^1] ✅[^3] | `--smol` | no measurable change in three workloads (see Lookup notes) ✅[^lab] |
| `logLevel` | `"debug"`, `"warn"` or `"error"` | Bun's own log output ✅[^1] | — | unquoted value rejected; `"error"` hid a `tsconfig.json` warning (`moduleSuffixes is not supported yet`) that no setting, `"warn"` and `"debug"` all printed ✅[^lab] |
| `[define]` | `"expr" = "<JSON>"`; single-quoted strings allowed, `'undefined'` → `undefined` ✅[^1] | Replaces the expression at transpile time | `--define K:V` / `-d` ✅[^3] | `process.env.BUILD_FLAVOR` → `from-bunfig-define`; `DEBUG_MODE = "false"` → boolean `false`; CLI `--define 'process.env.BUILD_FLAVOR:"cli"'` → `cli` ✅[^lab] |
| `[loader]` | `".ext" = "<loader>"`: `jsx`, `js`, `ts`, `tsx`, `css`, `file`, `json`, `toml`, `wasm`, `napi`, `base64`, `dataurl`, `text` ✅[^1] | Which loader reads that extension | `--loader .ext:loader` / `-l` ✅[^3] | `".bagel" = "ts"` ran a typed `.bagel` file ✅[^lab] |
| `telemetry` | `true` | Only anonymous crash reports today; same as `DO_NOT_TRACK` ✅[^1] | — | `false` changed nothing on Linux, like `DO_NOT_TRACK` (see that row) ✅[^lab] |
| `env` | `true`; `env = false` or `[env] file = false` | Turns off automatic `.env` loading; `--env-file` still loads ✅[^1] | `--no-env-file` | both forms loaded nothing; `--env-file=custom.env` still loaded ✅[^lab] |
| `[console] depth` | `2` | Default nesting depth of `console.log` ✅[^1] | `--console-depth` (wins) ✅[^1] | `depth = 4` showed 4 levels; `--console-depth 1` showed `[Object ...]` ✅[^lab] |
| `[serve] port` | `3000` | Default port of `Bun.serve` ✅[^1] | `--port`; variables `BUN_PORT`, `PORT` ✅[^1] and `NODE_PORT` ✅[^11], in that order | default `3000`; `port = 4005` → 4005; `BUN_PORT=4001` → 4001; `PORT=4002` → 4002; both set → 4001; `NODE_PORT=4005` → 4005; `PORT=4002 NODE_PORT=4005` → 4002; `--port 4003` → 4003 ✅[^lab] |

### `[run]` keys (also apply to the naked `bun <file|script>`)
| Key | Default | Effect | CLI equivalent | Lab result |
|---|---|---|---|---|
| `shell` | `"system"` on Linux and macOS, `"bun"` on Windows | Shell for `package.json` scripts ✅[^1] | `--shell=bun\|system` ✅[^3] | `"system"`: `$0` was `/usr/bin/bash`; `--shell=bun` and `shell = "bun"`: `$0` was `sh` and `${BASH_VERSION:-none}` stayed unexpanded, the Bun Shell ✅[^lab] |
| `bun` | on when no `node` is on `PATH` | Prepends a `node` link to Bun for scripts, binaries and `node` shebangs ✅[^1] | `--bun` / `-b` | with a real-looking `node` on `PATH`, `which node` printed `/tmp/bun-node-0-a7733435c/node` ✅[^lab] |
| `silent` | `false` | Does not print `$ <command>` ✅[^1] | `--silent` | `bun run hi` printed only `hi-from-script` ✅[^lab] |
| `elide-lines` | `0` (all lines) | Keeps the last N lines per script under `--filter` ✅[^1] | `--elide-lines` | on a terminal, `--elide-lines 2` left `│ [6 lines elided]` and the last 2 of 8 lines, `elide-lines = 3` left `[5 lines elided]` and 3; through a pipe all 8 lines printed ✅[^lab] |
| `noOrphans` | `false` | Exit when the parent dies; kill all descendants on exit ✅[^1] | `--no-orphans`; `BUN_FEATURE_FLAG_NO_ORPHANS=1` ✅[^1] | with either, killing the parent shell with `SIGKILL` ended `bun` and the `sleep 300` it had spawned within 1.2 s, and a `bun` that exited by itself took its `sleep` with it; without, both `sleep`s and the orphaned `bun` kept running ✅[^lab] |

Other sections, listed by name only: `[install]` (package manager, see `bun/package-manager/pm-commands-reference.md`), `[test]` (see `bun/testing/test-config-coverage-reporters.md`) and `[fmt]` (`bun fmt`) ✅[^1].

### `.env` files loaded automatically
Measured with one variable `WHO` set to a different value in each of the 8 files, plus one marker variable per file ✅[^lab]. Order is increasing precedence; the last file loaded wins ✅[^2].

| Position | File | `NODE_ENV` unset (or `staging`) | `NODE_ENV=production` | `NODE_ENV=test` |
|---|---|---|---|---|
| 1 | `.env` | loaded | loaded | loaded |
| 2 | `.env.development` / `.env.production` / `.env.test` | `.env.development` | `.env.production` | `.env.test` |
| 3 | `.env.local` | loaded | loaded | **not loaded** |
| 4 | `.env.development.local` / `.env.production.local` / `.env.test.local` | `.env.development.local` | `.env.production.local` | `.env.test.local` |
| — | `WHO` ended up as | `.env.development.local` | `.env.production.local` | `.env.test.local` |
| — | A shell variable (`WHO=from-shell bun …`) | wins over every file | | |

### Controlling `.env` loading
| How | Effect | Evidence |
|---|---|---|
| `--env-file=<path>` (repeatable) | Loads only the named files; with two, the later one won (`WHO=.env.test`); relative to the working directory after `--cwd`; pipes, FIFOs and `/dev/stdin` work | ✅[^lab] ✅[^2] |
| `--no-env-file` | No `.env` file loaded | ✅[^lab] ✅[^2] |
| `env = false` in `bunfig.toml` | Same; `--env-file` still loads | ✅[^lab] ✅[^1] |
| Bun invoked as `node` (`node` link, `bunx --bun`, scripts under `bun --bun run`) | No `.env` loading (since 1.4.0); `node --env-file=.env` loads it. In `oven/bun:1.3.14` the image's `node` link still loaded `.env` | ✅[^lab] ✅[^4] |
| `bun --bun file.ts` | Still loaded all four default files, although the docs name `bun --bun` among the ways Bun runs as `node` | ✅[^lab] ✅[^2] |
| `bun run <script>` | The script's shell does **not** get the default `.env` values (`echo WHO=$WHO` printed `WHO=`); a `bun file` started by the script loads them itself; `bun --env-file=custom.env run <script>` does pass that file's values | ✅[^lab] ✅[^5] |

### `.env` value syntax
Results for `BASE=world`, run in Bun 1.4.5 ✅[^lab]; syntax documented in ✅[^2]:

| Line in `.env` | `process.env` value | Node.js 24 `--env-file` |
|---|---|---|
| `EXP=hello-$BASE` | `hello-world` | not expanded: `B=$A-x` stayed `$A-x` ✅[^lab] |
| `EXP_BRACES=hello-${BASE}!` | `hello-world!` | — |
| `ESC=hello-\$BASE` | `hello-$BASE` (escaped) | — |
| `SQ='single $BASE'` | `single world`: expanded despite single quotes | `'lit $A'` → `lit $A` ✅[^lab] |
| `DQ="double $BASE\nnewline"` | a real newline between `world` and `newline` | — |
| ``BT=`backtick $BASE` `` | `backtick world` | — |
| `FROMSHELL=$SHELLVAR` | the shell's `SHELLVAR` (`fromshell`) | — |

### Reading variables
| Accessor | Relation | Evidence |
|---|---|---|
| `process.env` | The source of truth; writes are visible everywhere | ✅[^lab] |
| `Bun.env` | `Bun.env === process.env` → `true` | ✅[^lab] ✅[^2] |
| `import.meta.env` | `import.meta.env === process.env` → `true` | ✅[^lab] ✅[^2] |
| TypeScript | Values are `string \| undefined`; `declare module "bun" { interface Env { AWESOME: string } }` makes one a `string`. Lab, `bun check` with the `bun-types` files of the `bun-v1.4.5` tag: without the declaration, assigning `Bun.env.AWESOME`, `process.env.OTHER` or `import.meta.env.OTHER` to a `string` gave `TS2322: Type 'string \| undefined' is not assignable to type 'string'`; with it, `.AWESOME` passed on all three accessors and `Bun.env.OTHER` still failed | ✅[^2] ✅[^lab] |

### Environment variables Bun reads
| Variable | Effect | Evidence |
|---|---|---|
| `NODE_ENV` | Picks the `.env.<mode>` files; with no `jsx` setting, `production` makes JSX import `react/jsx-runtime` instead of `react/jsx-dev-runtime` | ✅[^lab] ✅[^2] |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | Disables TLS (Transport Layer Security) certificate checks. Lab, against a `Bun.serve` TLS server whose certificate a throwaway CA signed (made with openssl in `bunlab:1`): by default `fetch` and `node:https` both failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; with `0` both got `200` and Bun printed Node's warning that this "makes TLS connections and HTTPS requests insecure"; `1` behaved like the default | ✅[^2] ✅[^lab] |
| `SSL_CERT_FILE`, `SSL_CERT_DIR` | Extra CA (certificate authority) certificates on top of the bundled roots; defaults `/etc/ssl/cert.pem`, `/etc/ssl/certs` ✅[^2]. Lab, same server: `SSL_CERT_FILE=ca.pem` → `200`, and `https://github.com/` still `200` (bundled roots kept); `SSL_CERT_DIR` pointing at a folder made by `openssl rehash` → `200`, also as the second entry of `empty:certs`; an empty folder → failure; the CA copied to `/etc/ssl/cert.pem` → `200` with no variable, and `SSL_CERT_FILE=` (empty) then ignored it; the hashed CA copied into `/etc/ssl/certs` → `200`, and `SSL_CERT_DIR=<empty folder>` then ignored it (`SELF_SIGNED_CERT_IN_CHAIN`). `fetch` and `node:https` agreed in every case | ✅[^2] ✅[^lab] |
| `NODE_USE_SYSTEM_CA=1` | Also trusts the system's certificate authorities, like `--use-system-ca` ✅[^10]; undocumented in the docs released with 1.4.5 ✅[^2], but read by the 1.4.5 binary. Lab, a throwaway CA (made with openssl in `bunlab:1`, as above) appended only to Debian's bundle `/etc/ssl/certs/ca-certificates.crt`: by default `fetch` and `node:https` failed (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`); with `NODE_USE_SYSTEM_CA=1` or `--use-system-ca` both got `200`, with `--use-openssl-ca` both still failed; `tls.getCACertificates("default")` grew from 118 to 272 entries. `1.4.6-canary.1` behaved the same | ✅[^10] ✅[^2] ✅[^lab] |
| `BUN_CONFIG_VERBOSE_FETCH` | `curl` logs each `fetch`/`node:http` request as a `curl` command; `1` or `true` without it (lab, `true`: request line, headers and `< 200 OK` printed) | ✅[^lab] ✅[^2] |
| `BUN_RUNTIME_TRANSPILER_CACHE_PATH` | Folder for the cache of transpiled files over 4 KB (`.pile` files); `""` or `0` disables it. Lab: unset → `/root/.bun/install/cache/@t@/60d7520aaa390689.pile` for an 8,450-byte file; set → the file appeared there | ✅[^lab] ✅[^2] |
| `TMPDIR` | Scratch folder; default `/tmp` on Linux, `/private/tmp` on macOS ✅[^2]. Lab: `os.tmpdir()` returned `/tmp`, or the value of `TMPDIR`; under `strace` (in `bunlab:2`), `bun install` opened `TMPDIR` as its scratch folder; the `node` link of `bun --bun run` stayed at `/tmp/bun-node-0-a7733435c/node`, and `bun build --compile` wrote its temporary file next to the output, not in `TMPDIR` | ✅[^2] ✅[^lab] |
| `NO_COLOR=1` / `FORCE_COLOR=1` | No ANSI colours / colours even when piped (lab: escape codes appeared through a pipe) | ✅[^lab] ✅[^2] |
| `BUN_CONFIG_MAX_HTTP_REQUESTS` | Concurrent requests: `fetch` 256, `bun install` 64 ✅[^2]. Lab, a server that held each response 400 ms and counted requests in flight: 600 parallel `fetch` calls peaked at 256 by default, 10 with `=10`, 50 with `=50`, 600 with `=1000`; `bun install` of 150 packages from a stand-in registry peaked at 64 by default, 20 with `=20`, and `--network-concurrency=100` beat `=20` (peak 100). Each run twice, same numbers | ✅[^2] ✅[^lab] |
| `BUN_CONFIG_HTTP_IDLE_TIMEOUT` | How long auto-install waits for a silent registry (about 30 s) ✅[^6]. Lab, a registry that accepted the connection and never answered: the import failed with `Timeout downloading package manifest lab-auto-pkg` after 36.1 s by default (median of 5, 36.05–36.17 s), 8.0 s with `3`, 16.0 s with `10` | ✅[^6] ✅[^lab] |
| `BUN_CONFIG_WS_CLOSE_TIMEOUT` | Seconds a `WebSocket` client waits after sending Close (30; `0` = no limit) ✅[^2]. Lab, a server that completed the handshake and ignored the Close frame: the `close` event came with code `1006` after 36.0 s by default (median of 5), 8.0 s for any value from 1 to 4, 12.0 s for 5 and 8, 16.0 s for 10; with `0` none came in 45 s | ✅[^2] ✅[^lab] |
| `BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD=true` | `--watch` does not clear the screen; in the lab `--hot` did not either | ✅[^2] ✅[^lab] |
| `DO_NOT_TRACK=1` | No crash-report upload, no telemetry ✅[^2]. In the source it only switches off the crash-report upload, which on Linux release builds is off anyway ✅[^14]. Lab, a real crash (`bun:ffi` `read.u8(16)`, a segmentation fault) with a fake `curl` first on `PATH` to catch the upload: no upload by default or with `DO_NOT_TRACK=1`; `BUN_ENABLE_CRASH_REPORTING=1` ran `curl -fsSL` on a `bun.report/1.4.5/<encoded stack trace>` address with or without `DO_NOT_TRACK=1`. Its effect on macOS and Windows, where uploads are on by default, could not be run: the lab is Linux only | ✅[^2] ✅[^14] ✅[^lab] |
| `BUN_OPTIONS` | Prepends flags to every `bun` call; `BUN_OPTIONS="--console-depth 1"` cut output to one level | ✅[^lab] ✅[^2] |
| `BUN_PORT`, `PORT`, `NODE_PORT` | Default `Bun.serve` port, in that order of precedence, below `--port`; the full order with its lab runs is in `bun/http-and-networking/bun-serve.md` | ✅[^lab] ✅[^11] |
| `NODE_PATH` | Extra module folders (`:`-separated on Unix) | ✅[^lab] ✅[^7] |
| `XDG_CONFIG_HOME`, `HOME` | Where the global `.bunfig.toml` is (lab rows in the first table) | ✅[^1] ✅[^lab] |
| `BUN_INSTALL` | Install root of the script installer (`$HOME/.bun`) ✅[^8]. Lab: with `BUN_INSTALL=/opt/bi` and the image's `BUN_INSTALL_BIN` unset, `bun pm cache` printed `/opt/bi/install/cache` and `bun pm bin -g` printed `/opt/bi/bin` | ✅[^8] ✅[^lab] |
| `BUN_INSTALL_BIN` | Where `bun install -g` links binaries (the images set `/usr/local/bin`) ✅[^9]. Lab: `bun pm bin -g` printed `/usr/local/bin` in the image, `/opt/x` with `BUN_INSTALL_BIN=/opt/x`, and the variable beat a `globalBinDir` in `bunfig.toml` | ✅[^9] ✅[^lab] |
| `BUN_INSTALL_CACHE_DIR` | Package cache; a relative value is relative to the project root. Lab: `BUN_INSTALL_CACHE_DIR=rel-cache bun pm cache` run in `/tmp/c/sub` printed `/tmp/c/rel-cache` | ✅[^1] ✅[^lab] |
| `BUN_FEATURE_FLAG_NO_ORPHANS=1` | Same as `--no-orphans` (lab row in the `[run]` table) | ✅[^1] ✅[^lab] |
| `BUN_JSC_useTemporal=0` | Turns off the `Temporal` global (on by default since 1.4.0); lab: `typeof Temporal` → `"undefined"`, as it was by default in `oven/bun:1.3.14` | ✅[^lab] ✅[^4] |
| `DATABASE_URL` and the `PG*`/`MYSQL_URL` family | Default `Bun.sql` connection → `bun/system-apis/sqlite-and-sql.md` ✅[^2]. Lab, the default `sql` export against `postgres:latest` (18.3) and `mysql:8.4` containers: `DATABASE_URL=postgres://…`, `POSTGRES_URL=…` and `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` each connected to PostgreSQL; `MYSQL_URL=mysql://…?sslmode=require` connected to MySQL (with `NODE_TLS_REJECT_UNAUTHORIZED=0` for the server's self-signed certificate; without TLS the server's password plugin failed with `ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED`); with both a PostgreSQL `DATABASE_URL` and a `MYSQL_URL`, PostgreSQL won; with none, `ERR_POSTGRES_CONNECTION_REFUSED` | ✅[^2] ✅[^lab] |

## Lookup notes
- **Use `--config=<path>`, with `=`.** The docs give `-c` as an alias of `--config` ✅[^3], but in the lab neither flag took a path written after a space: Bun ran that path as the entry file. `--config cfg/my.toml m.ts` and `-c alt.toml m.ts` failed with `Bun cannot run toml files directly`; `-c ./alt.toml m.ts` exited 0 without running `m.ts`, because the TOML file itself was loaded as the entry (a broken one failed with a TOML parse error). `-c=<path>` ran the file without loading the config ✅[^lab].
- **Every key in the runtime and `[run]` tables exists in 1.4.5**: one `bunfig.toml` holding all of them loaded without error ✅[^lab].
- **Unknown `NODE_ENV` values act like development**: `NODE_ENV=staging` loaded the `.development` files ✅[^lab].
- **Docker images disable the transpiler cache**: every `oven/bun` variant sets `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` ✅[^9] ✅[^2]; `echo $BUN_RUNTIME_TRANSPILER_CACHE_PATH` printed `0` in the lab ✅[^lab].
- **Scripts and `.env`**: the script runner skips the default `.env` files on purpose, leaving them to the `bun` process the script starts ✅[^5]. A script that runs `node` or a shell command therefore sees no `.env` values unless you pass `--env-file`.
- **Global `bunfig` for `bun run`**: `bun run` loads only the local project's `bunfig.toml` ✅[^1]; put runtime keys there.
- **`bunx` ignores the project's `bunfig.toml`.** The docs say to put `bunfig.toml` in the project root and that the local file overrides the global one ✅[^1]. In the lab, `bun x lab-pkg` and the `bunx` link, run in a folder whose `bunfig.toml` set `registry = "http://127.0.0.1:4871/"`, sent no request to that registry and tried npm instead (`DNSResolveFailed` without network), while `bun add` in the same folder hit it. With a global file present, `bun x` used the global `registry` even when the project file set another. `bun x` also has no `--config` flag (`error: bunx has no --config=bunfig.toml flag`) ✅[^lab]. Put a registry meant for `bunx` in the global file.
- **Timeouts move in 4-second steps.** Both `BUN_CONFIG_HTTP_IDLE_TIMEOUT` and `BUN_CONFIG_WS_CLOSE_TIMEOUT` fired at a multiple of 4 s, 4 to 8 s after the value: 1–4 → 8 s, 5–8 → 12 s, 10 → 16 s, and the documented 30 s default → 36 s ✅[^lab]. Do not expect sub-4-second precision from either.
- **`smol` showed no effect in the lab.** The docs say it lowers memory use at some speed cost ✅[^1]. Three workloads, each run 5–7 times with and without `--smol` (`process.execArgv` confirmed the flag): short-lived garbage peaked at 127.0 versus 127.4 MB resident memory (RSS) in about 190 ms; a heap retaining 200,000 objects peaked at 304.6 versus 303.4 MB, the `--smol` runs a little faster (2,027 versus 2,211 ms); an idle script sat at 29.5 versus 29.7 MB ✅[^lab]. Measure your own workload before counting on it.
- **Documented on bun.com, not in the 1.4.5 docs**: the live environment page also lists `NODE_USE_SYSTEM_CA`, and says `import.meta.env` in `bun test` carries Vite's `MODE`, `DEV`, `PROD`, `SSR` and `BASE_URL` ✅[^10]. Neither is in the docs released with 1.4.5 ✅[^2]. `NODE_USE_SYSTEM_CA` already works in the 1.4.5 binary (row in the variables table) ✅[^lab]. The Vite variables are in `1.4.6-canary.1`, not in 1.4.5: the same test printed `MODE= test DEV= true PROD= false` in `oven/bun:canary` and `MODE= undefined DEV= undefined PROD= undefined` in 1.4.5 and 1.3.14, all with `NODE_ENV= test` ✅[^lab].

## Takeaways
- Put runtime settings (`preload`, `[define]`, `[run]`) in the project's `bunfig.toml`; the global file is for the package manager only. [rule-candidate]
- In production containers, set `env = false` (or pass `--no-env-file`) and inject variables from the platform, so no stray `.env.local` is picked up. [rule-candidate]
- Escape `$` as `\$` in `.env` values, even inside single quotes; Bun expands both. [rule-candidate]
- Do not expect `package.json` scripts that call `node` or shell commands to see `.env` values under `bun run`; pass `--env-file` explicitly.
- Write `--config=<path>` with `=`; the short `-c` form did not load the file in 1.4.5.
- Set the registry for `bunx` in the global `.bunfig.toml`; `bunx` does not read the project's file.
- Expect Bun's network timeouts (`BUN_CONFIG_HTTP_IDLE_TIMEOUT`, `BUN_CONFIG_WS_CLOSE_TIMEOUT`) to fire up to about 8 s after the value you set.

## Verification status
- Verified: 167 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the Node.js comparison ran in `node:24.22.1-alpine`. The TLS runs used `bunlab:1` (the same Bun plus openssl), the `TMPDIR` trace `bunlab:2` (plus strace), the database runs `postgres:latest` (18.3) and `mysql:8.4` server containers. The stand-in registries, the counting server and the silent servers were small `Bun.serve`/`Bun.listen` scripts in their own containers on one Docker network. The `bun check` run used the `packages/bun-types` files of the `bun-v1.4.5` tag with `@types/node` 26.6.6 copied from an earlier lab folder. A later session (around midnight, 2026-11-24 to 25) ran the version comparisons in `oven/bun:1.3.14` (`1.3.14+0d9b296af`) and `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`), and the `NODE_USE_SYSTEM_CA` runs with a CA and server certificate made by openssl in `bunlab:1`. [^lab]
- [bunfig.toml: docs/runtime/bunfig.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/bunfig.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: global versus local files and precedence, every runtime and `[run]` key, `[serve] port`, `BUN_PORT`/`PORT`, `BUN_INSTALL_CACHE_DIR`, `BUN_FEATURE_FLAG_NO_ORPHANS`, section names. [^1]
- [Environment Variables: docs/runtime/environment-variables.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/environment-variables.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `.env` order, `--env-file`, `--no-env-file`, Bun as `node`, quoting and expansion, `Bun.env`/`import.meta.env`, TypeScript typing, the variables table, the transpiler cache. [^2]
- [bun run CLI flags: docs/snippets/cli/run.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/snippets/cli/run.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: the CLI equivalents (`--preload` and aliases, `--smol`, `--define`, `--loader`, `--jsx-*`, `--shell`, `--config`). [^3]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Oven, 2026. Backs: strict TOML for `bunfig.toml`, no `.env` when invoked as `node`, `BUN_JSC_useTemporal`. [^4]
- [src/runtime/cli/run_command.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/runtime/cli/run_command.rs) — Bun source (Oven), 2026. Backs: the script runner skips default `.env` files; `node` emulation disables them. [^5]
- [Auto-install: docs/runtime/auto-install.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/auto-install.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `BUN_CONFIG_HTTP_IDLE_TIMEOUT`. [^6]
- [Module Resolution: docs/runtime/module-resolution.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/module-resolution.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `NODE_PATH`. [^7]
- [Installation: docs/installation.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/installation.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `BUN_INSTALL`. [^8]
- [dockerhub/ at bun-v1.4.5](https://github.com/oven-sh/bun/tree/bun-v1.4.5/dockerhub) — Bun source (Oven), 2026. Backs: images set `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` and `BUN_INSTALL_BIN=/usr/local/bin`. [^9]
- [Environment Variables (live)](https://bun.com/docs/runtime/environment-variables) — Bun documentation (Oven), living. Backs: only the gap notes: `NODE_USE_SYSTEM_CA` (trust the system's certificate authorities, like `--use-system-ca`) and Vite's `import.meta.env` variables in `bun test`, documented on bun.com but not in the 1.4.5 docs. [^10]
- [Server: docs/runtime/http/server.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/http/server.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `NODE_PORT` after `BUN_PORT` and `PORT` as a default `Bun.serve` port. [^11]
- [src/bunfig/arguments.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/bunfig/arguments.rs) — Bun source (Oven), 2026. Backs: the global file loads before the project file into the same settings, an absolute `XDG_CONFIG_HOME` is used whether or not the file exists, an unreadable file found automatically is skipped. [^12]
- [src/options_types/command_tag.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/options_types/command_tag.rs) — Bun source (Oven), 2026. Backs: the commands that read the global `.bunfig.toml`. [^13]
- [src/crash_handler/lib.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/crash_handler/lib.rs) — Bun source (Oven), 2026. Backs: crash-report upload is off on Linux release builds, `BUN_ENABLE_CRASH_REPORTING` and `BUN_CRASH_REPORT_URL` are checked before `DO_NOT_TRACK`, the upload runs `curl` on Linux. [^14]

## Related
- `bun/fundamentals/running-code-and-transpilation.md` — `bun run`, `--bun`, scripts.
- `bun/fundamentals/watch-hot-and-debugging.md` — `--watch`, `--hot` and the no-clear setting.
- `bun/package-manager/pm-commands-reference.md` — `[install]` keys and `.npmrc`.
- `bun/testing/test-config-coverage-reporters.md` — `[test]` keys.
- `bun/bundler/bun-build.md` — inlining environment variables into bundles.
- `bun/http-and-networking/bun-serve.md` — the full default-port order of `Bun.serve`.
- `linux/lab-setup.md` — the lab.
