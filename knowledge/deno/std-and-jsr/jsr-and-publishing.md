---
schema: knowledge-doc/v1
type: concept
topic: deno/std-and-jsr
status: verified
applies-to: ["Deno 2.9.8", "JSR (jsr.io) as documented on 2026-11-24"]
last-verified: 2026-11-24
last-updated: 2026-11-28
tags: [deno, jsr, deno-publish, slow-types, exports, semver, provenance, oidc, npm-compatibility, jsr-score, license]
ranked-sources: true
---

# JSR and publishing packages with `deno publish`

## Summary
**TL;DR:** JSR (the JavaScript Registry, jsr.io) is a package registry for JavaScript and TypeScript that accepts ECMAScript modules (ESM) only, stores the TypeScript source itself, and generates documentation and npm-ready JavaScript plus `.d.ts` files (TypeScript type declarations) from it. A package is `@scope/name` with a semver (semantic versioning) `version`, a `license` and an `exports` map. `deno publish` checks all of it on your machine (type check, "slow types", licence, version ranges, file list, uncommitted changes) before it uploads anything, and `--dry-run` runs those checks without uploading or logging in. Publishing from GitHub Actions needs no stored secret and adds a signed provenance statement by default.
**Use this when:** you publish a package to JSR, a `deno publish` run fails, you pick a version range for a `jsr:` import, or you need a JSR package in an npm project.
**Not this doc:** the `@std` packages → `deno/std-and-jsr/standard-library.md`; `jsr:` and `npm:` specifier syntax and import maps → `deno/modules/module-specifiers-and-imports.md`; `deno add`, `deno.lock` and the cache → `deno/modules/dependency-management.md`; publishing several workspace members → `deno/configuration/workspaces-and-monorepos.md`; `deno lint` and `deno doc` → `deno/toolchain/formatting-linting-and-docs.md`; the runtime's support timeline → `deno/releases-stability-and-support.md`.

## Problem
Code that runs fine with `deno run` can still fail its first `deno publish`, for reasons `deno run` never checks:
- an exported function without a return type is a "slow type" error ✅[^run] ✅[^slow-types];
- a package with no `license` field and no `LICENSE` file is refused ✅[^run] ✅[^troubleshoot];
- a `jsr:` import without a version range inside the package is refused ✅[^run];
- a Git repository with uncommitted changes aborts even a dry run, unless `--allow-dirty` is passed ✅[^publish-src].

On the consuming side, `deno add jsr:@std/path@1.0` looks like a pin to 1.0.x, but it saves `^1.0.9`, which installs 1.1.6 ✅[^run]. And npm users cannot write `jsr:` at all; they install through a separate `@jsr` scope ✅[^npm-compat].

## Mental model
**Analogy:** JSR is a publisher that takes manuscripts, not printed books. You hand in the TypeScript source; the publisher prints the editions itself: the original for Deno, a translated JavaScript edition with a type summary for npm, and the catalogue page (the docs) ✅[^jsr-intro] ✅[^npm-compat]. To write the type summary without reading the whole book, it requires every public sentence to state its type up front: that is the "no slow types" rule ✅[^slow-types]. Once an edition is printed it is never reprinted with changes ✅[^packages].

**Artifact:** a package config that passed `deno publish --dry-run` in Deno 2.9.8, and the imports a user would write for it ✅[^run]:
```jsonc
// deno.json
{
  "name": "@lab/greet",            // @scope/name
  "version": "0.1.0",              // valid semver; immutable once published
  "license": "MIT",                // SPDX identifier, or a LICENSE file
  "exports": {                     // the only modules users can import
    ".": "./src/mod.ts",           // import "jsr:@lab/greet@^0.1.0"
    "./add": "./src/add.ts"        // import "jsr:@lab/greet@^0.1.0/add"
  },
  "publish": { "exclude": ["src/tests"] }
}
```
SPDX (Software Package Data Exchange) is the standard list of licence identifiers such as `MIT` ✅[^troubleshoot].

| Term | Plain-English analogy | Concrete artifact |
|---|---|---|
| Scope | A publisher's imprint printed on every book | `@std` in `@std/path`; 2–20 lowercase letters, digits or hyphens ✅[^scopes] ✅[^jsr-ids] |
| `exports` map | The table of contents: only listed chapters can be opened from outside | `"./add": "./src/add.ts"`; any other path fails with `Unknown export './_common/does-not-exist' for '@std/path@1.1.6'` ✅[^run] ✅[^using] |
| Semver range | "Any edition of volume 1, newest first" | `^1.1.6` = 1.1.6 or a newer 1.x: fixes and features, no breaking changes ✅[^using] ✅[^std-faq] |
| Slow type | A public sentence whose type must be worked out from the whole paragraph | `export function add(a: number, b: number) { return a + b; }`, with no `: number` after `)` ✅[^slow-types] |
| Fast check | The publisher's quick skim that reads only the types written down | the `info: fast check avoids type inference` line in `deno publish` output ✅[^run] |
| Provenance | A tamper-evident receipt naming the build machine that made this edition | the "Provenance" section at the bottom of a package's overview tab, linking a Sigstore entry ✅[^trust] |
| OIDC (OpenID Connect) token | A visitor badge the CI (continuous integration) service hands one job, which JSR accepts instead of a password | `permissions: id-token: write` in a GitHub Actions workflow ✅[^jsr-publish] |
| JSR score | A report-card percentage | `@std/path` 100, `@std/cli` 88 ✅[^jsr-api] |
| npm compatibility layer | A translation desk that serves the npm edition | `"@std/encoding": "npm:@jsr/std__encoding@1"` in `package.json`, served from `https://npm.jsr.io` ✅[^jsr-publish] ✅[^npm-compat] |

## How it works
**Registry status:** the post "Deno is joining Cloudflare" (2026-10-09) says JSR will keep operating, with its infrastructure moving to Cloudflare ✅[^cloudflare]; what changes for the runtime is in `deno/releases-stability-and-support.md`.

### Publishing a version: 5 actors
- **You (the author)** — its job: describe the package, via `deno.json` or `jsr.json`.
- **Deno CLI (command-line interface)** — its job: check and pack the package on your machine, via `deno publish`.
- **GitHub Actions** — its job: vouch for the job that runs the publish, via an OIDC token.
- **JSR registry** — its job: re-check, store and serve each version, via jsr.io (and `npm.jsr.io` for npm tools).
- **Sigstore Rekor** — its job: keep a public, append-only record of provenance statements, via its transparency log.

```
[You — local]         [Deno CLI — local]                      [JSR — remote]          [Sigstore — remote]
deno.json ──────────▶ 1 read name / version / exports
                      2 type-check local modules
                      3 fast check of the public API
                        (+ license, version ranges)
                      4 pick files (.gitignore, publish.exclude)
                      5 git status --porcelain (if git exists)
                      6 --dry-run? ── yes ──▶ print file list, exit 0
                        │ no
              ═════════ network boundary ═════════
                      7 authenticate: --token │ OIDC │ browser,
                        upload ─────────────────────────▶ 8 check again,
                                                            store the version
                      9 only on GitHub Actions with OIDC ────────────────────────▶ provenance in Rekor
```

1. **Deno CLI (local): read the config.**
   - Reads `name`, `version` and `exports` from `deno.json` or `jsr.json` ✅[^publish-ref].
   - A missing `version` stops with `error: file:///lab/p4-noversion/deno.json is missing 'version' field`; the name `greet` stops with `package name must use the '@<scope>/<package>' format` ✅[^run].
2. **Deno CLI (local): type-check.** Local modules are checked by default (`Check mod.ts`); `--check=all` adds remote modules and `--no-check` skips the step ✅[^publish-ref] ✅[^run]. An `exports` entry naming a missing file fails here: `TS2307 [ERROR]: Cannot find module 'file:///lab/p13-badexport/src/modes.ts'.` ✅[^run]
3. **Deno CLI (local): fast check of the public API (application programming interface)**, printed as `Checking for slow types in the public API...`.
   - Only symbols reachable from `exports` must be explicit; an unexported helper may keep an inferred type ✅[^slow-types].
   - Each rule and the code 2.9.8 printed for it ✅[^run] ✅[^slow-types]:

     | Rule | Breaks it | 2.9.8 diagnostic |
     |---|---|---|
     | Exported functions have a return type | `export function add(a: number, b: number) {` | `error[missing-explicit-return-type]` |
     | Exported constants and class properties have a type, unless a simple literal | `export const ID = crypto.randomUUID();`, a class field `name;` | `error[missing-explicit-type]` |
     | No destructuring in exports | `export const { foo, bar } = { … }` | `error[unsupported-destructuring]` |
     | No `declare global` or `declare module` | `declare global { var labGlobal: string; }` | `error[unsupported-global-module]` |
     | A JavaScript entrypoint needs a `.d.ts` | `"exports": "./mod.cjs"` | `warning[unsupported-javascript-entrypoint]` |
   - The same step reports `error[missing-license]` (no `license` field or `LICENSE` file) and `error[missing-constraint]` for `import { join } from "jsr:@std/path";`, whose two `info:` lines read "the specifier resolved to version 1.1.6 today, but will resolve to a different major version if one is published in the future and potentially break" ✅[^run].
4. **Deno CLI (local): pick the files.**
   - Leaves out files listed in the root `.gitignore`, then applies `publish.include` and `publish.exclude`; `"exclude": ["!dist"]` brings a git-ignored `dist/` back ✅[^jsr-publish].
   - Measured: with `.gitignore` = `.env` and `dist/`, and `"exclude": ["src/tests"]`, only `README.md`, `deno.json`, `src/add.ts` and `src/mod.ts` were listed ✅[^run].
   - Rewrites bare specifiers from the import map or `package.json` into full `jsr:`/`npm:` specifiers in the uploaded copy ✅[^jsr-publish].
5. **Deno CLI (local): uncommitted-changes check.**
   - If a `git` binary exists, it runs `git status --porcelain`; any output aborts with `Aborting due to uncommitted changes. Check in source code or run with --allow-dirty` ✅[^publish-src] ✅[^git-src].
   - The check sits before the dry-run exit in the 2.9.8 source, so a dry run in a dirty repository aborts too; with no `git` installed it is skipped ✅[^publish-src] ✅[^git-src]. The lab image has no `git`, so no lab run needed `--allow-dirty` ✅[^run].
6. **Deno CLI (local): `--dry-run` stops here.** It prints `Simulating publish of @lab/greet@0.1.0 with files:`, the list, and `Success Dry run complete`, and does not authenticate ✅[^auth-src]. It ran with the container's network switched off (`docker run --network none`) and exited 0 ✅[^run]. `--set-version 0.2.0` simulated `@lab/greet@0.2.0` without editing `deno.json` ✅[^run].
7. **Deno CLI → JSR (network): authenticate and upload.**
   - Order: `--token <value>` → the GitHub Actions OIDC environment → a browser approval when stdin is a terminal → otherwise ``No means to authenticate. Pass a token to `--token`.`` ✅[^auth-src] ✅[^jsr-publish].
   - The package must already exist (created at jsr.io/new) ✅[^publish-ref].
8. **JSR registry (remote): check again and store.** The CLI and the server both run checks ✅[^jsr-publish]; a version is immutable once stored, and a version already on JSR is not published again ✅[^packages] ✅[^jsr-publish].
9. **GitHub Actions → Sigstore (remote): provenance.**
   - On GitHub Actions with an OIDC token, and without `--no-provenance` or the `DISABLE_JSR_PROVENANCE` variable, the CLI creates a SLSA (Supply-chain Levels for Software Artifacts) provenance statement stored in the Sigstore Rekor log ✅[^publish-src] ✅[^trust].
   - Publishing with `--token` creates none ✅[^jsr-publish].

A workflow that publishes with OIDC: link the package to the repository in the package's settings on jsr.io first ✅[^jsr-publish] ✅[^setup-deno].
```yaml
# .github/workflows/publish.yml
on: { push: { branches: [main] } }
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write          # the OIDC token JSR accepts instead of a secret
    steps:
      - uses: actions/checkout@v6
      - uses: denoland/setup-deno@v2
      - run: deno publish
```

### Consuming a version
`jsr:@std/path@^1/join` reads, piece by piece ✅[^using]:
- `jsr:` — the scheme: resolve from JSR.
- `@std` — the scope.
- `path` — the package name.
- `^1` — the semver range; the newest version that satisfies every constraint wins.
- `/join` — an entrypoint: the `./join` key of the package's `exports`. No entrypoint means the `.` key ✅[^jsr-publish].

Pre-release versions (`2.0.0-beta.1`) are skipped by ranges unless named exactly; a yanked version is skipped by ranges but still installs when pinned or already in a lock file ✅[^packages]. What Deno 2.9.8 saved and resolved on 2026-11-24 ✅[^run]:

| You write | `deno.json` / `deno.lock` records | Resolved |
|---|---|---|
| `deno add jsr:@std/path` | `"@std/path": "jsr:@std/path@^1.1.6"` | 1.1.6 |
| `import … from "jsr:@std/path@^1"` | lock key `jsr:@std/path@1` | 1.1.6 |
| `import … from "jsr:@std/path@1.0/join-globs"` | lock key `jsr:@std/path@1.0` | 1.0.9 |
| `import … from "jsr:@std/path"` | lock key `jsr:@std/path@*` | 1.1.6 |
| `deno add jsr:@std/log` | `^0.224.14`; lock `jsr:@std/log@~0.224.14` | 0.224.14 |

### From npm and other package managers
- pnpm 10.9+, Yarn 4.9+ and vlt (another npm-compatible package manager) take `jsr:@luca/cases` directly; npm, Bun and older pnpm or Yarn use `npx jsr add @luca/cases` (or `bunx`, `yarn dlx`, `pnpm dlx`) ✅[^npm-compat] ✅[^using].
- That writes `"@luca/cases": "npm:@jsr/luca__cases@^1.0.1"` to `package.json` and `@jsr:registry=https://npm.jsr.io` to `.npmrc`, which belongs in source control ✅[^using].
- The name maps by dropping the first `@` and turning `/` into `__`: `jsr:@luca/cases` → `@jsr/luca__cases` ✅[^npm-compat].
- Without the `jsr` tool, add the `.npmrc` line by hand and install the mapped name as usual, for example `npm install @jsr/luca__cases@1` (or `yarn add`, `pnpm install`) ✅[^npm-compat].
- The tarball holds JavaScript transpiled from the source, `.d.ts` files for the TypeScript files, and a `package.json` carrying the original `exports`; you cannot publish to JSR with `npm publish` ✅[^npm-compat].
- Not run in the lab: its network allowed only jsr.io, not `npm.jsr.io`.

### JSR score
A percentage from 0 to 100, used to rank search results, built from 4 categories: documentation (README, module docs, symbol docs), best practices (no slow types, provenance), discoverability (a description) and compatibility (at least one runtime marked compatible, more is better). The exact weights are on each package's "Score" tab and may change ✅[^scoring].

## Worked example
A one-function package taken from failing to a passing dry run in the lab, network off ✅[^run]:

1. Start: `deno.json` holds `name`, `version` and `exports` only; `mod.ts` has `export function add(a: number, b: number) { return a + b; }`.
2. `deno publish --dry-run` prints (blank and caret lines trimmed):
   ```
   Check mod.ts
   Checking for slow types in the public API...
   error[missing-explicit-return-type]: missing explicit return type in the public API
    --> /lab/p16-worked/mod.ts:7:17
     = hint: add an explicit return type to the function
     info: all functions in the public API must have an explicit return type
     docs: https://jsr.io/go/slow-type-missing-explicit-return-type
   error[missing-license]: missing license field or file
    --> /lab/p16-worked/deno.json
     = hint: add a "license" field. Alternatively, add a LICENSE file to the package and ensure it is not ignored from being published
   ...
   Don't want to bother? You can choose to skip this step by
   providing the --allow-slow-types flag.

   error: Found 2 problems
   ```
   Exit code 1.
3. Change the signature to `add(a: number, b: number): number`. The next dry run reports only `error[missing-license]` and `error: Found 1 problem`, exit code 1.
4. Add `"license": "MIT"`. The next dry run prints:
   ```
   Check mod.ts
   Checking for slow types in the public API...
   Check mod.ts
   Simulating publish of @lab/greet@0.1.0 with files:
      file:///lab/p16-worked/deno.json (94B)
      file:///lab/p16-worked/mod.ts (135B)
   Success Dry run complete
   ```
   Exit code 0. Nothing was uploaded; a real `deno publish` would now log in (step 7 above).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A `.cjs` (CommonJS) entrypoint | 2.9.8's dry run printed only `warning[unsupported-javascript-entrypoint]` and exited 0 ✅[^run]; JSR's rules say CommonJS cannot be published, and its troubleshooting page lists a `commonJs` publishing error ✅[^jsr-publish] ✅[^troubleshoot] | The dry run never contacts the registry (it passed offline), so it shows only the CLI's checks; a pass is not a promise that the upload is accepted |
| `name` set but no `exports` | `Warning "exports" field should be specified when specifying a "name".`, then an error whose sample config shows `"version": "@lab/greet"` ✅[^run] | The sample in the message is wrong; write a real semver version |
| `--allow-slow-types` | Dry run passes with `Warning Publishing a library with slow types is not recommended…` ✅[^run] | Consumers type-check about 1.5–2× slower for most packages, possibly much more, and slow types are left out or become `any` in the npm `.d.ts` ✅[^slow-types] |
| `// deno-lint-ignore no-slow-types` | Not honoured; only package-wide exclusion works ✅[^slow-types] | `deno lint` in a package with `name` + `exports` reported `error[no-slow-types]`; `--rules-exclude=no-slow-types` silenced it ✅[^run] |
| `export const five = 5;`, `export const double = (n: number) => n * 2;` | No diagnostic ✅[^run] | Literals and single-expression arrows count as simple inference ✅[^slow-types] |
| `deno add jsr:@std/path@1.0` | JSR's guide presents `deno add jsr:@luca/cases@1.0` as the way to use a specific minor version ✅[^using]; Deno 2.9.8 printed `Add jsr:@std/path@1.0.9`, saved `^1.0.9` and installed 1.1.6 ✅[^run] | `deno add` turns the resolved version into a caret range; write `jsr:@std/path@~1.0.9` by hand, or pass `--save-exact` ("Save exact version without the caret (^)", from `deno add --help`) ✅[^run] |
| Name length limits | The publishing guide says scope 2–32 and package 2–20 characters ✅[^jsr-publish]; the scopes and packages pages say scope 2–20 and package 2–58 characters, no leading hyphen ✅[^scopes] ✅[^packages]; the registry's validation code (read 2026-11-28) also enforces those lengths and rejects a leading, trailing or double hyphen ✅[^jsr-ids] | The code is what the registry enforces; the guide's numbers are out of date |
| A bad version is already published | It cannot be changed; yank it (ranges skip it, pinned and locked users keep it), or delete it only within 24 hours and under 10 downloads; a deleted number is never reusable ✅[^packages] | Registry immutability ✅[^packages] |
| Publishing from another CI with `--token` | Works, but no provenance is created ✅[^jsr-publish] | Provenance needs the GitHub Actions OIDC integration ✅[^trust] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Fix every slow type | Fast type checking for users, full docs, `.d.ts` for npm, a better score ✅[^slow-types] ✅[^scoring] | Explicit annotations on every export |
| `--allow-slow-types` | Publish today | Slower checking for every user, weaker docs, no `.d.ts` for Node.js ✅[^run] ✅[^slow-types] |
| GitHub Actions with OIDC | No stored secret, provenance ✅[^jsr-publish] ✅[^trust] | Only on GitHub Actions; the package must be linked to the repository |
| `--token` from any CI | Works everywhere ✅[^jsr-publish] | A secret to store and rotate; no provenance |
| Native `jsr:` (Deno, pnpm 10.9+, Yarn 4.9+, vlt) | Imports the TypeScript source; no `.npmrc` ✅[^npm-compat] | Older npm-based tools need the compatibility layer |
| npm compatibility layer | Any `node_modules` tool works ✅[^npm-compat] | Editors jump to transpiled code; slower installs; npm and Yarn may install duplicate copies ✅[^npm-compat] |

## Takeaways
- Run `deno publish --dry-run` in CI on every change; it needs no login and caught every local error measured here. [rule-candidate]
- Give every exported function a return type and every exported constant or class field a type, unless it is a plain literal. [rule-candidate]
- Never use an unversioned `jsr:` specifier inside a package; `deno publish` rejects it. [rule-candidate]
- Set `"license"` in `deno.json` before the first publish.
- Publish from GitHub Actions with `id-token: write` rather than a token, so each version gets provenance. [rule-candidate]
- To stay on one minor line, write `~1.0.9`; `deno add …@1.0` saves a caret range.

## Verification status
- Verified: 102 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Problem, Mental model, How it works, Worked example, Edge cases and Trade-offs. Publish runs were `deno publish --dry-run` only, mostly with `--network none`. [^run]
- [Introduction to JSR](https://jsr.io/docs/introduction) — JSR project, living. Rank 1. Backs: what JSR is, docs generated from source. [^jsr-intro]
- [Publishing packages](https://jsr.io/docs/publishing-packages) — JSR project, living. Rank 1. Backs: ESM only, config fields, file filtering, specifier rewriting, CLI and server checks, GitHub Actions OIDC, tokens without provenance, the outdated name lengths. [^jsr-publish]
- [About "slow types"](https://jsr.io/docs/about-slow-types) — JSR project, living. Rank 1. Backs: slow-type rules, simple inference, 1.5–2× slowdown, lint exclusion. [^slow-types]
- [npm compatibility](https://jsr.io/docs/npm-compatibility) — JSR project, living. Rank 1. Backs: `@jsr` scope, name mapping, installing by hand, tarball contents, limitations. [^npm-compat]
- [Provenance and trust](https://jsr.io/docs/trust) — JSR project, living. Rank 1. Backs: SLSA statements in Sigstore Rekor, `--no-provenance`, the Provenance section. [^trust]
- [Scoring](https://jsr.io/docs/scoring) — JSR project, living. Rank 1. Backs: the 4 score categories. [^scoring]
- [Using packages](https://jsr.io/docs/using-packages) — JSR project, living. Rank 1. Backs: semver resolution, entrypoints, `exports`-only imports, `package.json` and `.npmrc` entries. [^using]
- [Packages](https://jsr.io/docs/packages) — JSR project, living. Rank 1. Backs: package name length, immutability, pre-releases, yanking, deletion. [^packages]
- [Scopes](https://jsr.io/docs/scopes) — JSR project, living. Rank 1. Backs: scope name length. [^scopes]
- [Troubleshooting](https://jsr.io/docs/troubleshooting) — JSR project, living. Rank 1. Backs: `missingLicense`, SPDX, `commonJs`. [^troubleshoot]
- [shared/src/ids.rs at 96d8bd4](https://github.com/jsr-io/jsr/blob/96d8bd406f6494b6404bbe1e05697228f0215458/shared/src/ids.rs) — JSR project, 2026. Rank 1. Backs: scope 2–20 and package 2–58 characters, hyphen rules; read 2026-11-28 at commit 96d8bd4 (the file moved from `crates/jsr_types/src/` to `shared/src/` on 2026-11-27, limits unchanged; [current version on `main`](https://github.com/jsr-io/jsr/blob/main/shared/src/ids.rs)). [^jsr-ids]
- [Frequently Asked Questions (Deno Standard Library)](https://github.com/denoland/std/blob/main/.github/FAQ.md) — Deno project, living. Rank 1. Backs: a caret range allows fixes and features but not breaking changes. [^std-faq]
- [JSR API: packages in scope std](https://api.jsr.io/scopes/std/packages?limit=100) — JSR project, living. Rank 1. Backs: `@std/path` and `@std/cli` scores. [^jsr-api]
- [deno publish](https://docs.deno.com/runtime/reference/cli/publish/) — Deno project, living. Rank 1. Backs: required fields, `--check`, create the package first. [^publish-ref]
- [cli/tools/publish/mod.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/cli/tools/publish/mod.rs) — Deno project, 2026. Rank 1. Backs: dirty check before the dry-run exit, its message, provenance conditions. [^publish-src]
- [cli/util/git.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/cli/util/git.rs) — Deno project, 2026. Rank 1. Backs: `git status --porcelain`, skipped without git. [^git-src]
- [cli/tools/publish/auth.rs at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/cli/tools/publish/auth.rs) — Deno project, 2026. Rank 1. Backs: no login in a dry run, authentication order. [^auth-src]
- [denoland/setup-deno](https://github.com/denoland/setup-deno) — Deno project, living. Rank 1. Backs: `denoland/setup-deno@v2` step. [^setup-deno]
- [Deno is joining Cloudflare](https://deno.com/blog/cloudflare) — Deno project, 2026. Rank 1. Backs: JSR keeps operating. [^cloudflare]

## Related
- `deno/std-and-jsr/standard-library.md` — the `@std` packages published on JSR.
- `deno/modules/dependency-management.md` — `deno add`, `deno.lock`, `deno outdated`.
- `deno/modules/module-specifiers-and-imports.md` — `jsr:` next to `npm:`, `node:` and import maps.
- `deno/configuration/workspaces-and-monorepos.md` — publishing a workspace.
- `deno/releases-stability-and-support.md` — the support timeline after the Cloudflare announcement.
