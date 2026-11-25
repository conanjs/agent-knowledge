---
schema: knowledge-doc/v1
type: concept
topic: bun/package-manager
status: verified
applies-to: ["Bun 1.4.5", "Bun 1.1.45 and 1.3.14 (history of the trust rules, ignoreScripts and minimumReleaseAge)", "esbuild 0.28.2 (native-binary linking)", "Node.js 24.22.1 (ran the Bun-installed esbuild)"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, supply-chain, security, lifecycle-scripts, postinstall, trusteddependencies, bun-pm-trust, security-scanner, minimum-release-age, bun-audit, bun-why]
---

# Lifecycle scripts and supply-chain controls in `bun install`

## Summary
**TL;DR:** `bun install` runs the project's own `preinstall`, `postinstall` and `prepare` scripts but blocks the install scripts of dependencies unless the package is trusted: listed in `trustedDependencies`, or, when that field is absent, on Bun's built-in list of 367 npm packages and installed from the npm registry ✅[^1] ✅[^8] ✅[^lab]. `bun pm untrusted` shows what was blocked and `bun pm trust <name>` runs it and records the trust ✅[^3] ✅[^lab]. Three more controls act at other moments: a *security scanner* module named in `bunfig.toml` can cancel an install before anything is linked, `minimumReleaseAge` hides versions younger than a set age, and `bun audit` checks the locked versions against the npm advisory database ✅[^4] ✅[^2] ✅[^6] ✅[^lab].
**Use this when:** a dependency's native build did not happen after install, you decide which packages may run code at install time, or you set up install-time security for a team or CI (continuous integration).
**Not this doc:** lockfile integrity and `--frozen-lockfile` → [install-mechanics-and-lockfile.md](install-mechanics-and-lockfile.md); the flags of every command → [pm-commands-reference.md](pm-commands-reference.md).

## Problem
A *lifecycle script* is a shell command in a package's `package.json` `scripts` that a package manager runs at a set moment, such as `postinstall` after the package is installed ✅[^1]. A package manager that runs every dependency's `postinstall` lets one compromised version of one transitive package run arbitrary code on every developer laptop and CI runner that installs it, with their tokens and SSH (Secure Shell) keys in reach. Teams that switch to Bun then meet the opposite problem: a package that needs its `postinstall` (to download or build a native binary) is installed but does not work, and nobody knows why. Other attacks need no script at all: a freshly hijacked version that is malicious in its code, or an old version with a known vulnerability that has sat in the lockfile for a year.

## Mental model
**Analogy:** an office building's security. Deliveries (packages) come in, but none may switch on a machine (run a script) unless its sender is on the guest list (`trustedDependencies` or the default list). A guard at the door (the security scanner) inspects every delivery before it is unpacked. Brand-new suppliers wait in a quarantine room for a few days (`minimumReleaseAge`). A weekly check compares what is already inside against a public recall list (`bun audit`).

**Artifact:** which control stops which threat, and where it is set:

| Threat | Control | Where |
|---|---|---|
| A dependency's install script runs malware | Dependency scripts blocked by default ✅[^1] ✅[^lab] | Built in; allow with `trustedDependencies` in `package.json` |
| A `git:`, `github:` or `file:` package named like a trusted one (for example `esbuild`) | The default list trusts npm-registry packages only ✅[^1] ✅[^lab] | Built in since Bun 1.3.5 ✅[^10]; lab: Bun 1.1.45 ran the `postinstall` of a `file:` package named `esbuild`, 1.3.14 and 1.4.5 blocked it ✅[^lab] |
| Even trusted or root scripts must not run (a locked-down CI job) | `--ignore-scripts`, `install.ignoreScripts`, `ignore-scripts=true` in `.npmrc`, `NPM_CONFIG_IGNORE_SCRIPTS=true` ✅[^1] ✅[^lab] | Command line, `bunfig.toml`, `.npmrc` or environment |
| A known-malicious or policy-violating package enters the tree | Security scanner returns a `fatal` advisory ✅[^4] ✅[^lab] | `[install.security] scanner` in `bunfig.toml` |
| A just-published hijacked version | `minimumReleaseAge` ✅[^2] ✅[^lab] | `[install]` in `bunfig.toml` or `--minimum-release-age` |
| A known vulnerability in a locked version | `bun audit`, `bun audit fix` ✅[^6] ✅[^lab] | Run in CI |

## How it works
Five actors take part:
- **`bun install`** — its job: resolve, download and link packages, then decide which scripts run, via the trust rules below.
- **The trust lists** — its job: name the packages allowed to run scripts, via `trustedDependencies` in the root `package.json` and the built-in list in `src/install/default-trusted-dependencies.txt`.
- **The security scanner** — its job: judge the resolved packages, via a module that exports `scanner` and is named in `[install.security] scanner`.
- **The npm registry** — its job: serve version publish times and advisories, via the manifest's `time` field and the advisory endpoint.
- **Lifecycle scripts** — their job: run shell commands, via `preinstall`, `install`, `postinstall` and `prepare` in each package's `package.json`.

```
resolve ranges ──(minimumReleaseAge drops too-young versions)──► download + verify
        │
        ▼
security scanner: scan({ packages }) ── fatal ──► abort, exit 1, nothing linked
        │ warn ──► TTY: ask · no TTY: cancel
        ▼ none
link into node_modules
        │
        ▼
scripts: project's own ──────────────────────────────► run (unless --ignore-scripts)
         each dependency: in ignoreScripts? ─ yes ─► skip
                          trusted? ─ no ─► block, count it ("Blocked 2 postinstalls")
                                   └ yes ─► run
```

1. **`bun install` (local, network):** while resolving, a version newer than `minimumReleaseAge` is treated as absent; this applies to new resolutions only, so versions already in `bun.lock` stay ✅[^2] ✅[^lab].
2. **Security scanner (local):** Bun calls `scan({ packages })` with every package it is about to install, transitive ones included, each with `name`, `version`, `requestedRange` and `tarball`; workspace packages are left out ✅[^4] ✅[^9]. In the lab the call came after the download and no `node_modules` was created when it returned a `fatal` advisory ✅[^lab]. A scanner that logged its input got four entries such as `{"name":"chain-b","version":"1.0.0","requestedRange":"^1.0.0","tarball":"http://pm-fake:4874/lc/chain-b/-/chain-b-1.0.0.tgz"}`, for the two direct and two transitive registry packages, and none for the workspace `w` ✅[^lab].
3. **`bun install` (local):** links the packages.
4. **Lifecycle scripts (local):** the root package's own scripts run ✅[^1] ✅[^lab]. A dependency's scripts run only if all of these hold ✅[^1] ✅[^10] ✅[^lab]:
   - it is not in the root `package.json` `ignoreScripts` list (an array of package names, Bun 1.3.2+; lab: Bun 1.1.45 ignored the field and ran a trusted package listed in it, 1.3.14 skipped that package);
   - its exact name is in `trustedDependencies`, or `trustedDependencies` is absent and the name is on the default list *and* the package came from the npm registry;
   - `--ignore-scripts` (or one of its config forms) is not set.
   Scripts run in parallel, at most twice the CPU count at once by default (`--concurrent-scripts`) ✅[^2]. Lab, 24 trusted `file:` packages whose `postinstall` sleeps 1 second, 8 CPUs, two runs each: at most 16 ran at once by default, 3 with `--concurrent-scripts 3`, 5 with `concurrentScripts = 5` in `bunfig.toml` ✅[^lab].
5. **`bun install` (local):** prints `Blocked N postinstalls. Run \`bun pm untrusted\` for details.` ✅[^lab]

### The three modes of `trustedDependencies`
| Root `package.json` | Packages allowed to run scripts |
|---|---|
| no `trustedDependencies` field | the built-in list, npm-registry sources only ✅[^1] |
| `"trustedDependencies": ["hooked"]` | only `hooked`; the built-in list is ignored ✅[^1] ✅[^lab] |
| `"trustedDependencies": []` | none (lab: `Blocked 2 postinstalls`) ✅[^1] ✅[^lab] |

The list is also stored in `bun.lock`, so a `--frozen-lockfile` install in a partial checkout still applies it ✅[^1] ✅[^lab]. `bun pm default-trusted` prints the built-in list (`Default trusted dependencies (367):` in 1.4.5), the same entries as `src/install/default-trusted-dependencies.txt` at tag `bun-v1.4.5`; `esbuild` and `sharp` are on it ✅[^3] ✅[^8] ✅[^lab]. Bun also links the right prebuilt binary for packages such as `esbuild` without running their `postinstall` ✅[^2] ✅[^10]. `esbuild` ships its compiled program as one optional dependency per platform (`@esbuild/linux-arm64`, `@esbuild/darwin-arm64` …) and a `postinstall` (`node install.js`) that checks it. Lab, `esbuild@0.28.2` in Bun 1.4.5 on linux-arm64 ✅[^lab]:
- Of the 26 platform packages only `@esbuild/linux-arm64` was installed (`--verbose`: `Skip installing @esbuild/darwin-arm64 - os mismatch` and so on), and `--verbose` printed `[Lifecycle Scripts] ignoring esbuild lifecycle scripts`; `bun pm untrusted` listed nothing.
- `node_modules/.bin/esbuild` pointed straight at `../@esbuild/linux-arm64/bin/esbuild`, and under the isolated linker at `../.bun/@esbuild+linux-arm64@0.28.2/node_modules/@esbuild/linux-arm64/bin/esbuild`.
- Under hoisted, isolated and isolated with the global store, and also with `--ignore-scripts` or `"trustedDependencies": []` (which printed `Blocked 1 postinstall`), `esbuild --version` printed `0.28.2` and `transformSync()` worked, in Bun and in Node.js 24.22.1 (`node:24.22.1-bookworm-slim`). With the global store, `esbuild` and its platform package stayed project-local folders, as a default-trusted package should ✅[^12].
- The two switches the release notes name undo it ✅[^10]: `BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER=1` pointed `.bin/esbuild` at the JavaScript launcher `../esbuild/bin/esbuild` and still skipped the script; adding `BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS=1` ran `node install.js`, which put the native ELF binary in place of that launcher.

### Security scanner
A scanner is a module whose `scanner` export implements `Bun.Security.Scanner`: `version: "1"` and an async `scan()` that returns advisories with `level` (`"fatal"` or `"warn"`), `package`, `url` and `description` ✅[^4] ✅[^9]. The value of `scanner` is a package of the project or a file path relative to `bunfig.toml` ✅[^5]; the lab ran both, the package form as a `file:` devDependency named `lab-scanner` ✅[^lab]. A `fatal` advisory cancels the install with a non-zero exit; a `warn` asks in an interactive terminal (a TTY) and cancels without one ✅[^4] ✅[^9] ✅[^lab]. Under `script` (a pseudo-terminal) the lab got `Security warnings found. Continue anyway? [y/N]`: `n` gave `Installation cancelled.` and exit 1, `y` gave `Continuing with installation...` and exit 0 ✅[^lab]. If `scan()` throws, the install stops with `error: Security scanner failed: <message>` and nothing is linked ✅[^9] ✅[^lab]. `bun pm scan` runs the configured scanner over every package in `bun.lock` without installing; with no scanner it prints `error: no security scanner configured` ✅[^lab]. While a scanner is configured, auto-install of imports at run time is off (`error: Cannot find package "is-odd": auto-install is off because a security scanner is configured`) ✅[^5] ✅[^lab]. `bun pm fetch` does not call the scanner; the next `bun install` does ✅[^3] ✅[^lab].

### Minimum release age
`minimumReleaseAge` (bunfig) or `--minimum-release-age` takes seconds or a number with a unit such as `90m`, `3d` or `2 weeks` ✅[^2] ✅[^lab]. `minimumReleaseAgeExcludes` exempts a whole package (`"ms"`) or exact versions (`"typescript@5.4.5"`); the flag `--minimum-release-age-excludes` replaces that list ✅[^2] ✅[^lab]. When the gate removes versions, a stability check skips a burst of releases published close together just outside the gate, looking up to 7 days further back ✅[^2] ✅[^lab]. The source spells out the rule: walking from the newest matching version down, a version that passes the gate is taken only if it was published at least the gate's length (capped at 7 days) before the next newer version Bun set aside, by the gate or by this same check; once a version is older than the gate plus 7 days, Bun takes the first passing version it met ✅[^13]. The lab checked it with a registry serving made-up publish times and a 3-day gate ✅[^lab]:

| Versions (age in days) | Bun took | Why |
|---|---|---|
| `stab-a`: 1.0.0 (8), 1.1.0 (3.5), 1.1.1 (1) | `1.0.0` | 1.1.0 passes the gate but came only 2.5 days before the rejected 1.1.1 |
| 1.0.0 (8), 1.1.0 (4), 1.1.1 (1) | `1.1.0` | a 3-day gap is enough |
| 1.0.0 (20), then 1.1.0 … 1.1.3 every 1.5–2 days (9 to 3.5), 1.1.4 (1) | `1.1.3` | still rapid past 10 days, so the check is dropped |
| `stab-a@1.1.0` asked for exactly | `1.1.0` | exact requests skip the check; `stab-a@1.1.1` failed with `blocked by minimum-release-age: 259200 seconds` |
| `stab-a` with `minimumReleaseAgeExcludes = ["stab-a@1.1.0"]` / `["stab-a"]` | `1.1.0` / `1.1.1` | an excluded version counts as stable; an excluded name skips the gate |

The name is unchanged in 1.4.5; it arrived in Bun 1.3 together with the scanner API ✅[^11] ✅[^lab]. Bun 1.1.45 has no such flag (it took `--minimum-release-age 2200d` as a package to add, and its `GET` of the npm registry path `/2200d` got `404`); Bun 1.3.14 had the flag but took seconds only (`error: Expected --minimum-release-age to be a positive number: 2200d`), where 1.4.5 installed `ms@2.1.2` ✅[^lab].

### `bun audit`, `bun why` and `bun pm diff`
- `bun audit` reads the package list from `bun.lock` (no `node_modules` needed), sends it to the npm advisory endpoint, prints each advisory with its severity and link, and exits 1 when any remain after `--audit-level` and `--ignore` ✅[^6] ✅[^lab]. It never changes files; `bun audit fix` upgrades within declared ranges, `--latest` also rewrites your ranges ✅[^6] ✅[^lab].
- `bun why <pkg>` prints every chain of dependents that pulls a package in, with the range each one requires; `--top` stops at the first level ✅[^7] ✅[^lab].
- `bun pm diff <pkg>` compares the locked version with `latest` (or two versions), and its summary flags new install scripts and new imports of `child_process`, `fs`, `net` and similar modules, so an update can be reviewed before it is taken ✅[^3] ✅[^lab].

## Worked example
A project with two local dependencies that each have a `postinstall`, one of them named `esbuild` to imitate a trusted package, plus `ms` from the registry. Bun 1.4.5 in the container's `/tmp/life` ✅[^lab].

```json
{ "name": "life",
  "dependencies": { "hooked": "file:./deps/hooked", "esbuild": "file:./deps/esbuild", "ms": "^2.1.3" },
  "scripts": { "preinstall": "echo root-preinstall >> root-scripts.txt",
               "postinstall": "echo root-postinstall >> root-scripts.txt",
               "prepare": "echo root-prepare >> root-scripts.txt" } }
```
`deps/hooked` writes `"$npm_lifecycle_event of $npm_package_name, INIT_CWD=$INIT_CWD"` to `$INIT_CWD/hooked-ran.txt`; `deps/esbuild` writes `esbuild-ran.txt`.

1. `bun install` prints the three root scripts (`$ echo root-preinstall >> root-scripts.txt` …), `3 packages installed` and `Blocked 2 postinstalls. Run \`bun pm untrusted\` for details.` Only `root-scripts.txt` exists. The local `esbuild` got no trust from the built-in list's `esbuild` entry.
2. `bun pm untrusted` lists both, with their commands:
   ```console
   ./node_modules/hooked @deps/hooked
    » [postinstall]: echo "$npm_lifecycle_event of $npm_package_name, INIT_CWD=$INIT_CWD" > "$INIT_CWD/hooked-ran.txt"
   ```
3. `bun pm trust --dry-run hooked` prints `dry run: would run 1 script across 1 package` and `would add to trustedDependencies: - hooked`, and changes nothing.
4. `bun pm trust hooked` prints `✓ [postinstall]: …` and `1 script ran across 1 package`; `hooked-ran.txt` now reads `postinstall of hooked, INIT_CWD=/tmp/life`, and `"trustedDependencies": ["hooked"]` is in both `package.json` and `bun.lock`.
5. After `rm -rf node_modules`, `bun install` runs `hooked` again on its own and reports `Blocked 1 postinstall` (the fake `esbuild`).
6. `bun install --ignore-scripts` on a clean `node_modules` runs nothing, not even the root's `preinstall`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `--frozen-lockfile` when the trusted package is already in `node_modules` | Its script does not run again; the root's scripts do ✅[^lab] | Frozen installs run trusted scripts only for packages they install ✅[^1] |
| `NPM_CONFIG_IGNORE_SCRIPTS=false` | Does not turn scripts back on when a config file disabled them (lab: `install.ignoreScripts = true` still won) ✅[^1] ✅[^lab] | The variable can only switch scripts off ✅[^1] |
| Package in both `trustedDependencies` and `ignoreScripts` | Skipped (lab: `hooked-ran.txt` missing) ✅[^lab] | `ignoreScripts` wins ✅[^10] |
| Dependency installed under an alias (`"x": "npm:node-sass@^6"`) | Trust the package's own name, not the alias ✅[^1]. Lab: `"myalias": "npm:hooked-reg@1.0.0"` with `"trustedDependencies": ["myalias"]` gave `Blocked 1 postinstall`; with `["hooked-reg"]` the script ran ✅[^lab]. Bun 1.3.14 did the opposite: the alias name ran the script, the real name did not ✅[^lab] | Matching is by exact package name since Bun 1.4 ✅[^10] |
| Scanner returns only `warn` in CI | `Security warnings found. Cannot prompt for confirmation (no TTY). Installation cancelled.`, exit 1 ✅[^lab] | No terminal to ask ✅[^4] |
| `bun add x`, `bun update x` with a lockfile and `node_modules` | The scanner gets only `x`, its dependencies and what changed ✅[^4]; lab: `bun add hooked-reg` passed one package, `hooked-reg`, not the four already installed ✅[^lab] | Run a full `bun install` to scan everything ✅[^4] |
| Gate stricter than every allowed version | `error: No version matching "^2.1.3" found for specifier "ms" (blocked by minimum-release-age: 345600000 seconds)` ✅[^lab] | `4000d` converted to seconds; nothing old enough fits the range |
| Version without a `time` field / with an unreadable one | Passes the gate / is blocked ✅[^2]. Lab: a manifest with no `time` gave `1.0.1` under a 3-day gate; one whose `1.0.1` had `"time": "not-a-date"` gave `1.0.0` under a 1-day gate, `1.0.1` without a gate ✅[^lab] | Unknown age is only accepted when the field is missing ✅[^2] |
| `bun audit --json` | Prints the registry's raw response, not filtered by `--audit-level` or `--ignore` ✅[^6]. Lab: the same 1,852 bytes (6 advisories, `high` and `moderate`) with `--audit-level=critical` (exit 0) and with `--ignore GHSA-35jh-r3h4-6jhm` (exit 1) as without either (exit 1) ✅[^lab] | Those only change the exit code ✅[^6] ✅[^lab] |
| `bun audit fix` and an exact pin (`"ms": "0.7.0"`) | Lab: `blocked by a dependent's range … package.json depends on ms@0.7.0`, suggests `--latest` ✅[^lab] | Only `--latest` rewrites your ranges across the pin's major ✅[^6] |
| A trusted package with the global virtual store on | It and its dependencies stay in a project-local store folder ✅[^12]; lab: the trusted `is-odd@3.0.1` and its `is-number@6.0.0` were real folders, the other packages symlinks ✅[^lab] | Its script could change a shared copy; see [linkers-hoisted-and-isolated.md](linkers-hoisted-and-isolated.md) |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Default (built-in list) | Common native packages work without setup | Trust is decided by Bun's list, not by you ✅[^1] |
| Explicit `trustedDependencies` | Every script that runs is one you named ✅[^1] | You must re-add `sharp`, `esbuild` and the like yourself ✅[^1] |
| `--ignore-scripts` everywhere | No install-time code at all, root included ✅[^lab] | Native builds and the project's own `prepare` stop working (lab: the root's own scripts did not run) ✅[^1] ✅[^lab] |
| `minimumReleaseAge` | Time for the community to catch a hijacked release ✅[^11] | Urgent fixes arrive days later unless excluded (lab: excluding the name gave the 1-day-old version) ✅[^2] ✅[^lab] |
| Security scanner | A policy check before anything is linked ✅[^4] | Every install calls third-party code that you must trust; auto-install is off ✅[^5] |

## Takeaways
- Set `trustedDependencies` explicitly, review new entries in code review, and re-add the built-in packages you still need. [rule-candidate]
- After adding a dependency, read `Blocked N postinstalls` and run `bun pm untrusted` before deciding to trust; trust with `bun pm trust <name>`, never `--all` blindly. [rule-candidate]
- Run `bun audit --audit-level=high` in CI and set `minimumReleaseAge = "3d"` with an excludes list for packages you must take at once.
- Use `bun pm diff <pkg>` before `bun update <pkg>` on a security-sensitive dependency.

## Verification status
- Verified: 127 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24 and 2026-11-25; `oven/bun:1.1.45` (`1.1.45+196621f25`) and `oven/bun:1.3.14` (`1.3.14+0d9b296af`) for the history rows (the 1.3.14 alias run against the same kind of fake registry); `esbuild@0.28.2` from npm, and `node:24.22.1-bookworm-slim` to run the Bun-installed `esbuild` with Node.js; the scanner was a local `scanner.ts` and the audited project pinned `lodash@4.17.20` and `ms@0.7.0`; made-up packages (crafted publish times, a `postinstall`, dependency chains) came from a small Bun script serving a fake registry on a private Docker network, and the global-store run used `verdaccio/verdaccio:6` (6.11.3) as an npm proxy. [^lab]
- [Lifecycle scripts](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/lifecycle.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: blocked dependency scripts, `trustedDependencies` modes, npm-only default list, lockfile record, frozen behaviour, aliases, `--ignore-scripts` forms, script environment. [^1]
- [bun install](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/install.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: minimum release age rules and units, excludes, stability check, `--concurrent-scripts`, native-dependency optimisation. [^2]
- [bun pm](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/pm.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `untrusted`, `trust`, `default-trusted`, `diff`, `fetch` and the scanner. [^3]
- [Security Scanner API](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/security-scanner-api.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: scanner module, levels, package fields, partial scans. [^4]
- [bunfig.toml](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/bunfig.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: `install.security.scanner` value, auto-install off. [^5]
- [bun audit](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/audit.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: lockfile source, advisory endpoint, exit codes, `--json`, `audit fix`. [^6]
- [bun why](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/cli/why.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: dependency chains, `--top`. [^7]
- [src/install/default-trusted-dependencies.txt at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/install/default-trusted-dependencies.txt) — Bun source, 2026. Backs: the built-in list (367 lines). [^8]
- [packages/bun-types/security.d.ts at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/security.d.ts) — Bun source, 2026. Backs: `Bun.Security.Scanner`, `Package` and `Advisory` fields, behaviour on throw. [^9]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: npm-only default trust (1.3.5), `ignoreScripts` and native dependency linking (1.3.2), exact-name matching (1.4.0). [^10]
- [Bun 1.3](https://bun.com/blog/bun-v1.3) — Bun blog, 2025. Backs: Security Scanner API and `minimumReleaseAge` introduced, their purpose. [^11]
- [Global virtual store](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/global-store.mdx) — Bun documentation source at tag `bun-v1.4.5`, 2026. Backs: trusted packages stay project-local. [^12]
- [src/install/npm.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/install/npm.rs) — Bun source, 2026. Backs: the stability-check rule in `search_version_list`. [^13]

## Related
- `bun/package-manager/install-mechanics-and-lockfile.md` — integrity hashes and frozen installs.
- `bun/package-manager/pm-commands-reference.md` — flags of `bun audit`, `bun why`, `bun pm`.
- `bun/package-manager/linkers-hoisted-and-isolated.md` — why trusted packages stay out of the global store.
- `linux/lab-setup.md` — the lab.
