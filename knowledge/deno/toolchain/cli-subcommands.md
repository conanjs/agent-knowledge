---
schema: knowledge-doc/v1
type: reference
topic: deno/toolchain
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, cli, subcommands, flags, global-flags, environment-variables, deno-help]
ranked-sources: true
---

# Deno CLI subcommands and global flags (2.9.8)

## Summary
**TL;DR:** `deno --help` in 2.9.8 lists 48 entries (47 subcommands plus `help`), from `run` and `task` to the 2.8 additions (`ci`, `why`, `pack`, `transpile`, `bump-version`, `audit fix`) and the 2.9 ones (`watch`, `list`, `link`, `unlink`, `desktop`). Only five options are top-level (`-h`, `-V`, `-L`, `-q`, `--env-file`); most other flags belong to shared groups (config, lockfile, permissions, type checking, watch, V8) that each subcommand accepts or not, and the `--unstable-*` flags are hidden from `--help` (only `deno fmt --help` lists two of them). This page is a lookup table; each row points to the doc that explains the subcommand.
**Use this when:** you need the exact name, purpose or key flags of a `deno` subcommand, want to know which subcommands accept a flag, or meet an unfamiliar subcommand in a script.
**Not this doc:** how `deno task` and its shell work → `deno/toolchain/tasks-and-task-shell.md`; `deno fmt`, `deno lint`, `deno doc` in depth → `deno/toolchain/formatting-linting-and-docs.md`; every `--unstable-*` flag → `deno/releases-stability-and-support.md`; every permission flag → `deno/security/permission-flags.md`.

## Scope
- Every entry under `Commands:` in `deno --help` of Deno 2.9.8, in the order of the tables below, with the purpose text that `deno <cmd> --help` prints, the flags most used, and the sibling doc that explains it ("—" when no `deno/` doc goes further than this row).
- The top-level options, the shared flag groups, and the environment variables that act as global switches. An "Accepted by" cell lists the subcommands whose 2.9.8 `--help` shows the flag. Two sets recur there: the **code-running set** (`run`, `watch`, `serve`, `eval`, `repl`, `test`, `bench`, `compile`, `desktop`, `install`, `x`) and the **resolving set** (`add`, `approve-scripts`, `bench`, `bundle`, `cache`, `check`, `compile`, `desktop`, `doc`, `eval`, `info`, `install`, `outdated`, `publish`, `remove`, `repl`, `run`, `serve`, `test`, `transpile`, `uninstall`, `update`, `watch`, `x`).
- Abbreviations in the help texts: JSR is the JavaScript Registry, HMR is hot module replacement, LSP is the Language Server Protocol, TLS is Transport Layer Security, and PEM is the text format of certificate files.
- Not covered: the meaning of each flag value (see the linked docs), Deno Deploy and Deno Sandbox beyond their rows.

## Catalog

### Run code
| Subcommand | Purpose (2.9.8 help text) | Key flags | Explained in |
|---|---|---|---|
| `deno run` | Run a JavaScript or TypeScript program, or a task ✅[^run] | `--allow-*`/`-A`, `--check`, `--watch`, `--hmr`, `--env-file`, `--inspect*`, `--coverage` ✅[^run] | `deno/fundamentals/running-code-and-typescript.md` |
| `deno watch` | Run a JavaScript or TypeScript program, watching for file changes and hot-replacing modules; new in 2.9; printed `HMR Process started.` ✅[^run] ✅[^v29] | Same flags as `run` ✅[^run] | `deno/fundamentals/running-code-and-typescript.md` |
| `deno serve` | Run a server ✅[^run] | `--port`, `--host`, `--parallel`, `--open`, `--watch-hmr` ✅[^run] | `deno/web/http-server.md` |
| `deno eval` | Evaluate a script from the command line ✅[^run] | `-p`/`--print`, `--ext` ✅[^run] | `deno/fundamentals/running-code-and-typescript.md` |
| `deno repl` | Start an interactive Read-Eval-Print Loop (REPL) for Deno ✅[^run] | `--eval`, `--eval-file`, `--json` ✅[^run] | `deno/fundamentals/running-code-and-typescript.md` |
| `deno task` | Run a task defined in the configuration file ✅[^run] | `--cwd`, `-r`, `--members`, `-f`, `--eval`, `--if-present`, `-j`, `--no-prefix`, `--env-file` ✅[^run] | `deno/toolchain/tasks-and-task-shell.md` |
| `deno x` | Execute a binary from npm or jsr, like npx ✅[^run] | `-y`, `-p`/`--package` (2.8), `--install-alias` (creates a `dx` alias) ✅[^run] ✅[^v28] | — |

### Type-check, test and measure
| Subcommand | Purpose (2.9.8 help text) | Key flags | Explained in |
|---|---|---|---|
| `deno check` | Type-check the dependencies ✅[^run] | `--all`, `--doc`, `--doc-only`, `--watch` ✅[^run] | `deno/fundamentals/running-code-and-typescript.md` |
| `deno test` | Run tests ✅[^run] | `--filter`, `--parallel`, `--doc`, `--coverage`, `--watch`, `--changed`, `--related`, `--shard`, `--retry`, `-u` ✅[^run] ✅[^v29] | `deno/testing/testing-and-mocking.md` |
| `deno bench` | Run benchmarks ✅[^run] | `--filter`, `--json`, `--no-run` ✅[^run] | `deno/testing/coverage-and-benchmarks.md` |
| `deno coverage` | Print coverage reports ✅[^run] | `--lcov`, `--html`, `--detailed`, `--threshold` ✅[^run] | `deno/testing/coverage-and-benchmarks.md` |

### Format, lint and document
| Subcommand | Purpose (2.9.8 help text) | Key flags | Explained in |
|---|---|---|---|
| `deno fmt` | Format source files ✅[^run] | `--check`, `--fail-fast`, `--watch`, `--ignore`, `--line-width`, `--single-quote`, `--no-semicolons`, `--unstable-component`, `--unstable-sql` ✅[^run] | `deno/toolchain/formatting-linting-and-docs.md` |
| `deno lint` | Lint source files ✅[^run] | `--rules`, `--fix`, `--rules-tags`, `--rules-include`, `--rules-exclude`, `--json`, `--compact` ✅[^run] | `deno/toolchain/formatting-linting-and-docs.md` |
| `deno doc` | Generate and show documentation for a module or built-ins ✅[^run] | `--html`, `--json`, `--lint`, `--filter`, `--private`, `--name`, `--output` ✅[^run] | `deno/toolchain/formatting-linting-and-docs.md` |

### Dependencies and cache
| Subcommand | Purpose (2.9.8 help text) | Key flags | Explained in |
|---|---|---|---|
| `deno add` | Add dependencies ✅[^run] | `-D`, `--npm`, `--jsr`, `--save-exact`, `--package-json` ✅[^run] | `deno/modules/dependency-management.md` |
| `deno remove` | Remove dependencies ✅[^run] | `-g`, `--package-json` ✅[^run] | `deno/modules/dependency-management.md` |
| `deno install` | Installs dependencies either in the local project or globally to a bin directory ✅[^run] | `-g`, `-n`, `--root`, `-e`, `--prod`, `--compile`, `--os`, `--arch` ✅[^run] | `deno/modules/dependency-management.md`; `-g` → `deno/advanced/compile-and-distribution.md` |
| `deno uninstall` | Uninstalls a dependency or an executable script in the installation root's bin directory ✅[^run] | `-g`, `--root` ✅[^run] | `deno/modules/dependency-management.md` |
| `deno ci` | Install dependencies from a lockfile in a frozen state; new in 2.8 ✅[^run] ✅[^v28] | `--prod`, `--skip-types` ✅[^run] | `deno/modules/dependency-management.md` |
| `deno outdated` | Find outdated dependencies ✅[^run] | `-u`, `--latest`, `--compatible`, `-i`, `-r` ✅[^run] | `deno/modules/dependency-management.md` |
| `deno update` | Update outdated dependencies ✅[^run] | `--latest`, `--compatible`, `-i`, `-r` ✅[^run] | `deno/modules/dependency-management.md` |
| `deno list` | List the dependencies declared in deno.json / package.json; new in 2.9; printed a table row `jsr:@std/path │ ^1 │ 1.1.6` ✅[^run] ✅[^v29] | `--depth`, `--prod`, `--dev`, `-r` ✅[^run] | `deno/modules/dependency-management.md` |
| `deno why` | Show why a package is installed; new in 2.8; printed `jsr:@std/path@1 > @std/internal@1.0.14` ✅[^run] ✅[^v28] | `<PACKAGE>` ✅[^run] | `deno/modules/dependency-management.md` |
| `deno audit` | Audit currently installed dependencies ✅[^run] | `--level`, `--fix` (or `deno audit fix`, 2.8), `--ignore-unfixable`, `--ignore` ✅[^run] ✅[^v28] | `deno/modules/dependency-management.md` |
| `deno approve-scripts` | Approve npm lifecycle scripts ✅[^run] | `[PACKAGES]...` ✅[^run] | `deno/node-compat/node-and-npm-compatibility.md` |
| `deno link` | Link a local JSR package into the current project for development; CLI added in 2.9 ✅[^run] ✅[^v29] | `<PATHS>...`, `--lockfile-only` ✅[^run] | — |
| `deno unlink` | Remove a linked local package from the current project ✅[^run] | `<NAMES_OR_PATHS>...` ✅[^run] | — |
| `deno cache` | Cache the dependencies ✅[^run] | `--check`, `-r` ✅[^run] | `deno/modules/dependency-management.md` |
| `deno clean` | Remove the cache directory ✅[^run] | `-e`/`--except`, `--dry-run` ✅[^run] | `deno/modules/dependency-management.md` |
| `deno info` | Show info about cache or info related to source file ✅[^run] | `--json` ✅[^run] | `deno/internals/module-loading-and-type-checking.md` |

### Build, package and publish
| Subcommand | Purpose (2.9.8 help text) | Key flags | Explained in |
|---|---|---|---|
| `deno compile` | Compile the script into a self contained executable ✅[^run] | `-o`, `--target`, `--include`, `--exclude`, `--icon`, `--bundle`, `--minify`, `--self-extracting` ✅[^run] | `deno/advanced/compile-and-distribution.md` |
| `deno bundle` | Output a single JavaScript file with all dependencies ✅[^run] | `-o`, `--outdir`, `--platform`, `--minify`, `--code-splitting`, `--declaration` ✅[^run] | No doc covers it in depth yet; `deno/advanced/compile-and-distribution.md` covers `deno compile --bundle` only |
| `deno transpile` | Transpile TypeScript/JSX/TSX files to JavaScript; new in 2.8; prints `⚠️  deno transpile is experimental and subject to changes` ✅[^run] ✅[^v28] | `-o`, `--outdir`, `--source-map`, `--declaration` ✅[^run] | `deno/advanced/compile-and-distribution.md` |
| `deno pack` | Create a tarball of the package; new in 2.8; `--dry-run` listed `package.json`, `mod.js`, `mod.d.ts` for `lab-pkg-1.0.0.tgz` ✅[^run] ✅[^v28] | `-o`, `--dry-run`, `--set-version`, `--allow-dirty`, `--allow-slow-types` ✅[^run] | `deno/advanced/compile-and-distribution.md` |
| `deno publish` | Publish the current working directory's package or workspace ✅[^run] | `--dry-run`, `--allow-slow-types`, `--allow-dirty`, `--no-provenance`, `--set-version`, `--token` ✅[^run] | `deno/std-and-jsr/jsr-and-publishing.md` |
| `deno bump-version` | Update version in the configuration file; new in 2.8; `--dry-run patch` printed `[dry-run] file:///lab/newcmd/deno.json: 1.0.0 -> 1.0.1` ✅[^run] ✅[^v28] | `[INCREMENT]`, `-w`, `--dry-run`, `--start`, `--base`, `--release-notes` ✅[^run] | `deno/std-and-jsr/jsr-and-publishing.md` |
| `deno desktop` | Compile a script into a desktop application; new in 2.9, experimental ✅[^run] ✅[^v29] | `-o`, `--target`, `--all-targets`, `--backend`, `--hmr`, `--compress`, `--icon` ✅[^run] | `deno/advanced/compile-and-distribution.md` |

### Project, editor and environment
| Subcommand | Purpose (2.9.8 help text) | Key flags | Explained in |
|---|---|---|---|
| `deno init` | Initialize a new project ✅[^run] | `--lib`, `--serve`, `--npm`, `--jsr`, `--empty`, `-y` ✅[^run] | — |
| `deno create` | Create a project from a template ✅[^run] | `--npm`, `--jsr`, `-y` ✅[^run] | — |
| `deno upgrade` | Upgrade deno executable to given version ✅[^run] | `--dry-run`, `--canary`, `--release-candidate`, `--version`, `-o`, `--no-delta`, `pr <number>` ✅[^run] ✅[^v28] | `deno/releases-stability-and-support.md` |
| `deno types` | Print runtime TypeScript declarations; output starts `// Copyright 2018-2026 the Deno authors. MIT license.` ✅[^run] | none ✅[^run] | `deno/fundamentals/running-code-and-typescript.md` |
| `deno completions` | Generate shell completions ✅[^run] | `<SHELL>`, `--dynamic` (unstable; adds task names) ✅[^run] | — |
| `deno lsp` | Start the language server ✅[^run] | none ✅[^run] | — |
| `deno jupyter` | Deno kernel for Jupyter notebooks ✅[^run] | `--install`, `--kernel`, `-n`, `-d` ✅[^run] | — |
| `deno help` | Show help for a command; `deno help task` printed the same text as `deno task --help` ✅[^run] | `[SUBCOMMAND]` ✅[^run] | — |

### Hosted services and removed commands
| Subcommand | Purpose (2.9.8 help text) | Notes | Explained in |
|---|---|---|---|
| `deno deploy` | Deploy to Deno Deploy ✅[^run] | First `--help` downloaded the `jsr:@deno/deploy` tool (version 0.0.9909) and its npm dependencies before printing ✅[^run] | Out of scope; timeline in `deno/releases-stability-and-support.md` |
| `deno sandbox` | Run in sandbox mode ✅[^run] | Same downloaded tool; its help reads "Interact with sandboxes" ✅[^run] | Out of scope |
| `deno vendor` | `` `deno vendor` was removed in Deno 2. `` ✅[^run] | Running it prints that line as an error, exit 1 ✅[^run] | `deno/releases-stability-and-support.md` |

### Top-level options (`deno --help`)
| Option | Effect in 2.9.8 |
|---|---|
| `-h`, `--help[=<VALUE>]` | Help; `--help=full` and `--help=unstable` printed the same text as `--help` (110 lines for `run`) ✅[^run] |
| `-V`, `--version` | `deno -V` prints `deno 2.9.8`; `deno --version` adds the V8 and TypeScript lines ✅[^run] |
| `-L`, `--log-level <VALUE>` | `trace`, `debug` or `info`; other values fail with `error: invalid value 'nope' for '--log-level': possible values: trace, debug, info`; works before (`deno -L debug check`) or after the subcommand ✅[^run] |
| `-q`, `--quiet` | Suppress diagnostic output: hid every `Download <url>` line of a fresh run ✅[^run] |
| `--env-file[=<VALUE>]` | Listed at top level, but `deno --env-file run …` failed: `error: unexpected argument '--env-file' found` / `tip: 'run --env-file' exists`; put it after the subcommand ✅[^run] |

### Shared flag groups
| Group | Flags | Accepted by | Explained in |
|---|---|---|---|
| Config file | `-c`/`--config <file>`, `--no-config` | `-c`: 31 subcommands, the resolving set plus `bump-version`, `fmt`, `lint`, `pack`, `task` (and `deploy`, `sandbox` with their own `--config`); `--no-config`: the same minus `bump-version`, `task`, `deploy`, `sandbox` ✅[^run] | `deno/configuration/deno-json-reference.md` |
| Import map | `--import-map <file or URL>` | The resolving set plus `bump-version` ✅[^run] | `deno/modules/module-specifiers-and-imports.md` |
| Lockfile | `--lock [<file>]`, `--no-lock`, `--frozen-lockfile[=<bool>]` | The resolving set plus `task`, `audit`, `link`, `unlink`, `why` ✅[^run] | `deno/modules/dependency-management.md` |
| Cache and resolution | `-r`/`--reload[=<specifiers>]`, `--no-remote`, `--no-npm`, `--min-dep-age` (unstable); `--cached-only` | The resolving set; `--cached-only`: the code-running set plus `check` ✅[^run] | `deno/modules/dependency-management.md` |
| `node_modules` | `--node-modules-dir[=auto\|manual\|none]`, `--vendor`, `--node-modules-linker <isolated\|hoisted>` | The resolving set plus `task` (`--node-modules-dir` only) and `clean` ✅[^run] | `deno/modules/dependency-management.md` |
| TLS trust | `--cert <PEM file>`, `--unsafely-ignore-certificate-errors[=<hosts>]` | The resolving set plus `upgrade` ✅[^run] | — |
| Type checking | `--check[=all]`, `--no-check[=remote]` | `--check`: `run`, `watch`, `serve`, `test`, `bench`, `eval`, `install`, `compile`, `bundle`, `cache`, `publish`, `desktop`, `x` (`fmt --check` is a different flag); `--no-check`: the resolving set ✅[^run] | `deno/fundamentals/running-code-and-typescript.md` |
| V8 and runtime | `--v8-flags=<flags>` (`--v8-flags=--help` prints V8's own option list), `--seed`, `--location`, `--preload`, `--require`, `--conditions` | The code-running set plus `check`; `--location` also `info` ✅[^run] | `deno/advanced/debugging-profiling-and-telemetry.md` |
| Inspector | `--inspect[=<host:port>]`, `--inspect-brk`, `--inspect-wait` | The code-running set plus `cache` ✅[^run] | `deno/advanced/debugging-profiling-and-telemetry.md` |
| Watch | `--watch[=<paths>]`, `--watch-exclude`, `--no-clear-screen`; `--hmr` | `run`, `watch`, `serve`, `test`, `bench`, `check`, `compile`, `bundle`, `fmt`, `lint`; `--hmr`: `run`, `watch`, `desktop` (`serve` has `--watch-hmr`) ✅[^run] | `deno/fundamentals/running-code-and-typescript.md` |
| Permissions | `-A`, `-P`/`--permission-set`, `--allow-*`, `--deny-*`, `--ignore-env`, `--ignore-read`, `--no-prompt` | The code-running set ✅[^run] | `deno/security/permission-flags.md` |
| Remote imports | `-I`/`--allow-import[=<hosts>]`, `--deny-import` | The code-running set plus `add`, `bundle`, `cache`, `check`, `doc`, `info`, `lint` ✅[^run] | `deno/security/permission-flags.md` |
| Unstable features | `--unstable-<feature>` | Not shown in `--help`, except `--unstable-component` and `--unstable-sql` in `deno fmt --help`; accepted by `run`, `test`, `fmt`, `lint`, `task`, `check` in the lab ✅[^run] | `deno/releases-stability-and-support.md` |

### Environment variables that act as global switches
| Variable | Effect (2.9.8 `deno --help` text, shortened) |
|---|---|
| `DENO_DIR` | Set the cache directory ✅[^run] |
| `DENO_INSTALL_ROOT` | Set `deno install`'s output directory (default `$HOME/.deno/bin`) ✅[^run] |
| `DENO_NO_PROMPT` | Disable permission prompts, like `--no-prompt` ✅[^run] |
| `DENO_NO_UPDATE_CHECK` | Disable the check for a newer Deno version ✅[^run] |
| `DENO_NO_PACKAGE_JSON` | Disable auto-resolution of `package.json` ✅[^run] |
| `DENO_V8_FLAGS` | V8 options, like `--v8-flags`; flags from `--v8-flags` are appended after these ✅[^run] |
| `DENO_CERT`, `DENO_TLS_CA_STORE` | Extra CA (certificate authority) file; ordered list of CA stores, `system` or `mozilla` (default `mozilla`) ✅[^run] |
| `DENO_AUTH_TOKENS` | Bearer tokens per host for private remote modules ✅[^run] |
| `DENO_JOBS` | Parallel workers for `deno test --parallel`; `deno task --jobs` overrides it ✅[^run]; also read by `deno serve --parallel` (`DENO_JOBS=2` printed `Listening on http://0.0.0.0:8123/ with 2 threads`) ✅[^run] |
| `NO_COLOR`, `FORCE_COLOR` | Disable colour; force colour when stdout is not a terminal ✅[^run] |
| `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` | Proxy for module downloads and `fetch` ✅[^run] |
| `NPM_CONFIG_REGISTRY` | URL of the npm registry ✅[^run] |

## Lookup notes
- **A word that is not a subcommand is run as a script:** `deno frobnicate` gave `error: Module not found "file:///lab/cli/frobnicate".` ✅[^run]. With a task of that name in `deno.json`, `deno run hello` ran the task (`Task hello echo hello-task`) ✅[^run].
- **`--unstable` alone** still runs, with a removal warning; its text and the whole `--unstable-*` catalog are in `deno/releases-stability-and-support.md`. An unknown `--unstable-*` name fails: `error: unexpected argument '--unstable-bogus' found` with `tip: a similar argument exists: '--unstable-byonm'` ✅[^run].
- **`--help` is not the full flag list:** besides `--unstable-*`, 2.9.8 accepted `deno test --trace-leaks`, `deno run --watch-hmr` and `deno fmt --unstable-css` / `--unstable-html` / `--unstable-yaml`, none of which its `--help` shows; a truly unknown flag fails with `error: unexpected argument '--no-such-flag' found` ✅[^run].
- **`deno cache`** is marked deprecated in favour of `deno install` on the CLI index page ✅[^cli]; 2.9.8 ran `deno cache hello.ts` with no warning and exit code 0 ✅[^run].
- **`deno watch` versus `--watch-hmr`:** the 2.9 post calls `deno watch` a shorter form of `deno run --watch-hmr` ✅[^v29]; the 2.9.8 `run --help` lists the flag as `--hmr`, and `deno run --watch-hmr` was still accepted ✅[^run].
- **Experimental labels:** `deno transpile` and `deno bump-version` print an "experimental" line on every run ✅[^run]; the 2.9 post calls `deno desktop` experimental ✅[^v29].
- **`--cert` is read only when needed:** `deno run --cert /nope.pem hello.ts` (no network use) exited 0; with a `jsr:` import and an empty cache it failed with `error: JSR package manifest for '@std/path' failed to load.` ✅[^run].
- **`deno ci` without `deno.lock`** downloaded the graph, then failed: `error: The lockfile is out of date. Run \`deno install --frozen=false\` …`, exit 1 ✅[^run]; the 2.8 post says it errors when the lockfile is absent, removes any existing `node_modules` and installs with `--frozen` ✅[^v28].
- **Grouping differs from the docs:** the CLI index page sorts subcommands into Execution, Dependency management, Tooling and Other, and lists `ci`, `clean`, `link`, `list`, `sandbox`, `unlink`, `update` and `watch` only in its sidebar ✅[^cli]. The tables here follow topics instead.

## Takeaways
- Check a flag against `deno <cmd> --help` of the installed version before relying on it; flag sets differ per subcommand (for example `task` takes `-c` but not `--no-config`), and a flag missing from `--help` may still be accepted as a hidden one. [rule-candidate]
- Put every flag after the subcommand (`deno run --env-file …`), except `-L` and `-q`, which work in both places.
- Spell `--unstable-*` flags carefully: apart from two in `deno fmt`, they are not in `--help`, and only the error's `tip:` line suggests the right name.

## Verification status
- Verified: 154 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`: `deno --help` and `deno <cmd> --help` for every subcommand, plus the runs quoted in Catalog and Lookup notes. [^run]
- [Deno CLI Subcommands](https://docs.deno.com/runtime/reference/cli/) — Deno project, living. Rank 1. Backs: the docs' grouping of subcommands, `deno cache` marked deprecated, sidebar-only entries. [^cli]
- [Deno 2.8](https://deno.com/blog/v2.8) — Deno project, 2026. Rank 1. Backs: `ci`, `why`, `pack`, `transpile`, `bump-version`, `audit fix`, `x --package`, `upgrade pr` and `--no-delta`. [^v28]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: `watch`, `list`, `link`/`unlink`, `desktop` (experimental), new `deno test` flags. [^v29]

## Related
- `deno/toolchain/tasks-and-task-shell.md` — `deno task` and its built-in shell.
- `deno/toolchain/formatting-linting-and-docs.md` — `deno fmt`, `deno lint`, lint plugins, `deno doc`.
- `deno/releases-stability-and-support.md` — the `--unstable-*` flags, `deno upgrade`, removed commands.
- `deno/security/permission-flags.md` — every permission flag.
