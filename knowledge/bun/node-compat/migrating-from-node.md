---
schema: knowledge-doc/v1
type: how-to
topic: bun/node-compat
status: verified
applies-to: ["Bun 1.4.5", "Node.js 24.22.1", "npm 11.19.1", "Jest 30.5.2"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, nodejs, migration, npm, bunx, tsx, nodemon, dotenv, jest, docker, lockfile]
---

# Migrate a Node.js 24 + npm project to Bun

## Summary
**TL;DR:** Run `bun install` (it converts `package-lock.json` into `bun.lock` with the same versions), then swap one tool at a time: `npx` → `bunx`, `tsx`/`ts-node` → `bun file.ts`, `nodemon` → `bun --watch`, `dotenv` → Bun's built-in `.env` loading, `jest` → `bun test`, `node` → `bun` in scripts, and `FROM node` → `FROM oven/bun` in the Dockerfile ✅[^lab] ✅[^1]. Two traps showed up in the lab: a script that still calls `node` does not see `.env` values under Bun 1.4, and `--watch` written after the file name is passed to your program instead of to Bun ✅[^lab] ✅[^2].
**Use this when:** moving a Node project (scripts, dev loop, tests, container) to Bun, or checking what each Node tool turns into.
**Not this doc:** which Node APIs behave differently → [nodejs-compatibility.md](nodejs-compatibility.md); how `bun.lock` and the cache work → `bun/package-manager/install-mechanics-and-lockfile.md`; `.env` load order → `bun/fundamentals/configuration-and-environment.md`; `--watch` vs `--hot` → `bun/fundamentals/watch-hot-and-debugging.md`; Jest compatibility in depth → `bun/testing/bun-test-runner.md`.

## Goal & prerequisites
**End state:** the project installs from a committed `bun.lock`, and runs, restarts on change, reads `.env` and tests with Bun alone; its image builds `FROM oven/bun:1.4.5`; `package-lock.json` stays until Verify passes.

**Needs:** Bun 1.4.5 (`bun --version` prints `1.4.5`), the project under version control, and Docker for step 9.

**The sample project** used for every output below (`greeter`, an Express-free HTTP server):
```
greeter/
├── .env                  PORT=3000, GREETING=Hello
├── package.json          scripts below; dependency is-number; devDependencies dotenv, nodemon, tsx, jest
├── jest.config.js        testEnvironment node, setupFiles ["dotenv/config"], .ts files through jest-esbuild.cjs
├── jest-esbuild.cjs      Jest transform: TypeScript + ESM → CommonJS with the esbuild that tsx installed
├── package-lock.json     lockfileVersion 3, from npm 11.19.1
├── src/greet.ts          greet(name, n) → { greeting: `${GREETING}, ${name}`, n }
├── src/server.ts         import 'dotenv/config'; http.createServer(...).listen(PORT)
├── scripts/greet.ts      uses an enum, so it needs tsx (Node's type stripping rejects enums)
├── scripts/check.js      prints process.env.GREETING
├── test/greet.test.ts    Jest style: describe/test/expect globals and jest.fn(), no imports from jest
└── Dockerfile            FROM node:24.22.1-alpine … CMD ["node", "src/server.ts"]
```
```json
"scripts": {
  "start": "node src/server.ts",
  "dev": "nodemon --exec node src/server.ts",
  "greet": "tsx scripts/greet.ts",
  "check": "node scripts/check.js",
  "test": "jest"
}
```
On Node 24.22.1 this project serves `{"greeting":"Hello, Ann","n":3}` for `/?name=Ann&n=3` via type stripping, and `node scripts/greet.ts` fails on the `enum` line ✅[^lab]. Its tests pass under real Jest 30.5.2 (`npm test` → `Tests: 3 passed, 3 total`) ✅[^lab]. Jest needs both config entries: without the `transform`, it refused the TypeScript file with `Must use import to load ES Module`, and without `setupFiles` two of the three tests failed (`Received: "undefined, Cy"`) because nothing loaded `.env` ✅[^lab]. The transform reuses esbuild because only `jest` was added to the sample; a project would more often use `ts-jest` or Babel.

Terms used below:
- **Lockfile** — a receipt listing the exact version of every installed package, so the next install buys the same things. Artifact: the `bun.lock` line `"is-number": ["is-number@7.0.0", "", {}, "sha512-41Ci…"]`.
- **Shebang** — the first line of a script that names the program to open it, like an "open with" label. Artifact: `#!/usr/bin/env node`, the first line of `node_modules/.bin/tsx` ✅[^lab].
- **Watch mode** — a supervisor that restarts the program whenever a file it imported changes ✅[^4] ✅[^lab]. Artifact: `bun --watch src/server.ts`, which printed `listening on 3000` a second time after one edit (step 6).

## Steps
1. **Check the Bun version.**
   ```console
   $ bun --version
   1.4.5
   ```
2. **Install with Bun; this migrates the lockfile.** Bun converts an existing `package-lock.json` (npm lockfile versions 2, 3 or 4) and keeps the original file ✅[^3]. The lab removed `node_modules` first for a clean run ✅[^lab]:
   ```console
   $ rm -rf node_modules && bun install
   [2.14ms] migrated lockfile from package-lock.json
   Saved lockfile
   + is-number@7.0.0
   + dotenv@16.6.1
   + jest@30.5.2
   + nodemon@3.1.14
   + tsx@4.23.15
   293 packages installed [1484.00ms]
   Blocked 1 postinstall. Run `bun pm untrusted` for details.
   $ grep -E '"(is-number|jest)": \[' bun.lock
       "is-number": ["is-number@7.0.0", "", {}, "sha512-41Ci…"],
       "jest": ["jest@30.5.2", "", { "dependencies": { "@jest/core": "30.5.2", …
   ```
   The versions match `package-lock.json` (`is-number` 7.0.0, `dotenv` 16.6.1, `nodemon` 3.1.14, `tsx` 4.23.15, `jest` 30.5.2) ✅[^lab]. The new file starts with `"lockfileVersion": 2` ✅[^lab] ✅[^5]; Bun 1.3.14 (`oven/bun:1.3.14`) wrote `1` for the same kind of project ✅[^lab]. Before Jest was added, the same step installed 32 packages ✅[^lab]. `package-lock.json` is still there afterwards ✅[^lab] ✅[^3], and Node can already run the app from Bun's `node_modules`: `node src/server.ts` in `node:24.22.1-alpine` served `{"greeting":"Hello, Ann","n":3}` and Jest passed 3 of 3 ✅[^lab].
3. **Replace `npx` with `bunx`.** `bunx` uses a locally installed package first and otherwise installs it into Bun's global cache ✅[^6] ✅[^lab]:
   ```console
   $ bunx tsx --version
   tsx v4.23.15
   ```
   A bin whose shebang says `node` runs with `node`; `bunx --bun <bin>` forces Bun's runtime, and `--bun` must come before the bin name ✅[^6]. Measured with a local package whose bin starts with `#!/usr/bin/env node` and a stand-in `node` script first on `PATH` ✅[^lab]: `bunx mycli a b` called that `node`; `bunx --bun mycli a b` skipped it and ran in Bun; `bunx mycli --bun a` called `node` and passed `["--bun","a"]` to the program. In an empty folder, `bunx jest --version` downloaded Jest into Bun's global cache (`/root/.bun/install/cache/jest@30.5.2…`, 4.1 s) and left the folder empty; the second call took 54 ms ✅[^lab].
4. **Replace `tsx`/`ts-node` with `bun`.** Bun transpiles TypeScript itself, enums included ✅[^lab]:
   ```console
   $ bun scripts/greet.ts
   mood=happy greeting=Hello
   ```
   Change `"greet": "tsx scripts/greet.ts"` to `"greet": "bun scripts/greet.ts"`.
5. **Drop `dotenv`.** Bun reads `.env` on its own, so `dotenv` is unnecessary ✅[^2]. Delete `import 'dotenv/config';` from `src/server.ts`, then ✅[^lab]:
   ```console
   $ bun src/server.ts &
   listening on 3000 (runtime: bun 1.4.5)
   $ bun -e 'console.log(await (await fetch("http://127.0.0.1:3000/?name=Ann&n=3")).text())'
   {"greeting":"Hello, Ann","n":3}
   ```
   `PORT=3000` and `GREETING=Hello` came from `.env` ✅[^lab].
6. **Replace `nodemon` with `bun --watch`.** Set `"dev": "bun --watch src/server.ts"`. Bun flags go right after `bun` ✅[^7]. Watch mode restarts the process with the same arguments and environment when an imported file changes ✅[^4]: a probe started as `bun --watch app.ts --port 9 extra` printed the same `argv` and the same container environment variable after the restart, kept process id 1, and did not restart when a file it does not import changed (2 of 2 runs) ✅[^lab]. After editing `src/greet.ts` once, the log showed two starts ✅[^lab]:
   ```console
   $ bun --watch --no-clear-screen src/server.ts
   listening on 3000 (runtime: bun 1.4.5)
   listening on 3000 (runtime: bun 1.4.5)
   ```
7. **Replace `jest` with `bun test`.** Jest-style globals and `jest.fn()` work without Jest installed, and imports from `@jest/globals` are rewritten to `bun:test` ✅[^lab] ✅[^8]. The same test file, first under Jest (Node container, before the switch), then under Bun, with `jest.config.js` still present ✅[^lab]:
   ```console
   $ npm test
   > jest
   PASS test/greet.test.ts
     greet
       ✓ uses GREETING and parses n (1 ms)
       ✓ ignores a non-number n
       ✓ jest.fn records calls (1 ms)
   Tests:       3 passed, 3 total
   $ bun test
   (pass) greet > uses GREETING and parses n [0.36ms]
   (pass) greet > ignores a non-number n [0.03ms]
   (pass) greet > jest.fn records calls [0.22ms]
    3 pass
    0 fail
   ```
   `bun test` needs neither config entry: it transpiles TypeScript itself and loads `.env`, so `GREETING` was set without the `dotenv/config` setup file ✅[^lab]. Wall time, median of 7 runs: Jest 238 ms, `bun test` 8 ms; until the script is changed, `bun run test` still runs Jest, through the image's `node` symlink to Bun (235 ms, 3 passed) ✅[^lab].
   Move Jest config keys to `bunfig.toml` `[test]` (`setupFiles` → `preload`, `rootDir` → `root`); for `testEnvironment: "jsdom"`, preload a happy-dom setup file (`preload = ["./happydom.ts"]`) ✅[^8]. Checked on a small fixture: Jest with `rootDir: "src"` and a `setupFiles` script that sets a global, and `bun test` with `root = "src"` and the same script in `preload`, both ran only the test under `src/` and saw the global ✅[^lab]. A `setupFiles` entry that only loads `.env`, as here, can be dropped instead. Every `[test]` key and the measured happy-dom setup are in `bun/testing/test-config-coverage-reporters.md`.
8. **Point the scripts at `bun` and remove the replaced tools.**
   ```console
   $ bun remove dotenv nodemon tsx jest
   - dotenv
   - nodemon
   - tsx
   - jest
   4 packages removed [574.00ms]
   $ rm jest.config.js jest-esbuild.cjs
   ```
   ```json
   "scripts": {
     "start": "bun src/server.ts",
     "dev": "bun --watch src/server.ts",
     "greet": "bun scripts/greet.ts",
     "check": "bun scripts/check.js",
     "test": "bun test"
   }
   ```
   Keep a script on `node` only for a tool you cannot change, and give it `--env-file=.env` (Troubleshooting row 1) ✅[^lab] ✅[^5].
9. **Swap the Docker base image.** Only the base image, the install command and the start command change ✅[^lab] ✅[^9]:
   ```diff
   -FROM node:24.22.1-alpine
   +FROM oven/bun:1.4.5
    WORKDIR /app
   -COPY package.json package-lock.json ./
   -RUN npm ci --omit=dev --ignore-scripts
   +COPY package.json bun.lock ./
   +RUN bun install --frozen-lockfile --production
    COPY src ./src
    COPY .env ./
   +USER bun
    EXPOSE 3000
   -CMD ["node", "src/server.ts"]
   +CMD ["bun", "src/server.ts"]
   ```
   The `oven/bun:1.4.5` image runs as root unless `USER bun` is set, and it puts a `node` symlink to Bun at the end of `PATH` (`/usr/local/bun-node-fallback-bin/node`) ✅[^lab]. Image variants are covered in `bun/fundamentals/what-bun-is.md`.
10. **Commit `bun.lock`, then delete `package-lock.json`** once Verify passes. Bun keeps the old lockfile until you remove it ✅[^3]; it was still there after step 2 and step 8 ✅[^lab].

## Verify
```console
$ bun install --frozen-lockfile; echo "exit=$?"
Checked 1 install across 2 packages (no changes) [7.00ms]
exit=0
$ bun pm ls
/w node_modules (1 installed)
└── is-number@7.0.0
$ bun run greet
$ bun scripts/greet.ts
mood=happy greeting=Hello
$ bun run test 2>&1 | grep -c '(pass)'
3
$ docker build -t greeter-bun . && docker run -d --name greeter greeter-bun
$ docker logs greeter
listening on 3000 (runtime: bun 1.4.5)
$ docker run --rm --network container:greeter oven/bun:1.4.5 bun -e 'console.log(await (await fetch("http://127.0.0.1:3000/?name=Ann&n=3")).text())'
{"greeting":"Hello, Ann","n":3}
$ docker exec greeter sh -c 'id -un; ls node_modules'
bun
is-number
```
All outputs above were observed in the lab ✅[^lab]. The image held only the production dependency `is-number` and ran as user `bun` ✅[^lab].

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| A script `"check": "node scripts/check.js"` prints `GREETING=undefined` under `bun run check` | Inside the Bun image `node` is Bun's fallback symlink, and since Bun 1.4 Bun invoked as `node` does not load `.env`, to match Node ✅[^lab] ✅[^5]; the same symlink in Bun 1.3.14 still printed `GREETING=Hello` ✅[^lab] | Call `bun scripts/check.js`, or pass `node --env-file=.env …` (measured: prints `Hello`) ✅[^lab] ✅[^5] |
| `"envsh": "echo $GREETING"` prints an empty value under `bun run` | `bun run` does not export `.env` values into the script's shell; only a Bun process started by the script reads `.env` itself ✅[^lab] | Run `bun --env-file=.env run envsh`, or source the file in the script (`set -a; . ./.env; set +a; …`); both printed `Hello` ✅[^lab] ✅[^2]. The full `.env` rules: `bun/fundamentals/configuration-and-environment.md` |
| `bun run src/server.ts --watch` never restarts | Flags after the file name are arguments for the program, not for Bun ✅[^lab] ✅[^7] | Write `bun --watch src/server.ts` or `bun --watch run dev` ✅[^7] |
| `error: lockfile had changes, but lockfile is frozen` and exit code 1 in CI (continuous integration) or `docker build` | `package.json` changed (the lab added `is-odd`) without a new `bun.lock` ✅[^lab] | Run `bun install` locally and commit `bun.lock` |
| `error: Failed to start server. Is port 3000 in use?` | A previous watcher or server still holds the port (seen when two `--watch` runs overlapped) ✅[^lab] | Stop the old process; use another `PORT` in `.env` |
| `bun install` resolves fresh versions instead of the npm ones, after `warn: cannot migrate package-lock.json: unsupported lockfileVersion 1, resolving from package.json` | The `package-lock.json` is from npm 6 (`lockfileVersion` 1), which Bun does not migrate ✅[^3]: with `dotenv` locked at 16.0.0 and `^16.0.0` in `package.json`, Bun installed 16.6.1; the same lock rewritten as version 3 installed 16.0.0 ✅[^lab] | Regenerate it with a newer npm first (Bun's own note says `npm install --package-lock-only --lockfile-version=3`), then run `bun install` ✅[^lab] |
| A binary `bun.lockb` from an older Bun is in the repo | Bun 1.2 switched to the text `bun.lock` ✅[^3]. A plain `bun install` in 1.4.5 does not switch: it kept the `bun.lockb`, rewrote it (1,576 → 1,616 bytes) and wrote no `bun.lock`, and Bun 1.1.45 then rejected the file (`Outdated lockfile version: failed to parse lockfile: 'bun.lockb'`, then `lockfile had changes, but lockfile is frozen` under `--frozen-lockfile`; 2 runs) ✅[^lab] | `bun install --save-text-lockfile --frozen-lockfile --lockfile-only`, then delete `bun.lockb` ✅[^3]. Lab: Bun 1.1.45 (`oven/bun:1.1.45`) wrote a `bun.lockb` locking `dotenv` `^16.0.0` at 16.0.0 and `is-number` `^7.0.0` at 7.0.0; in 1.4.5 that command printed `Saved bun.lock (3 packages)`, exit 0, wrote a `lockfileVersion: 2` `bun.lock` with `dotenv@16.0.0` and `is-number@7.0.0`, and deleted `bun.lockb` itself ✅[^lab]. Commit `bun.lock` before anyone runs an older Bun on the branch |
| A Jest config option (`testEnvironment`, `setupFiles`, `coverageThreshold`) has no effect | `bun test` does not read `jest.config.*`: a `jest.config.js` with `setupFiles` and `testTimeout: 50` changed nothing (the setup file never ran, a 200 ms test passed) ✅[^lab]; the guide maps each option to `bunfig.toml` or a flag instead ✅[^8] | Move it to `bunfig.toml` `[test]`, or to a CLI flag (`--coverage`, `--timeout`, `--bail`) ✅[^8] |
| `[test] environment = "jsdom"` in `bunfig.toml` does nothing: `typeof document` is `undefined`, no warning | Documented on bun.com, not in 1.4.5: the live Jest guide maps `testEnvironment` to `environment` ✅[^10], the 1.4.5 guide does not ✅[^8], and 1.4.5 ignored the key ✅[^lab]. Present in `1.4.6-canary.1` (the `oven/bun:canary` preview build), not in 1.4.5: with jsdom not installed, the canary failed the file with `Cannot set up the "jsdom" test environment … cannot find package "jsdom"` ✅[^lab] | Use the 1.4.5 way: preload a happy-dom setup file (`preload = ["./happydom.ts"]`) ✅[^8]; the setup and the other ignored `[test]` keys: `bun/testing/test-config-coverage-reporters.md` |
| A native add-on fails to load after the switch | Bun 1.4 reports `NODE_MODULE_VERSION` 147 (Node 26), so a prebuild for Node 24 (137) does not match ✅[^lab] ✅[^5]; Bun 1.3.14 still reported 137 and `v24.3.0` ✅[^lab] | Install a build for ABI (application binary interface) 147 or rebuild the add-on |
| A package fails on `process.binding('tcp_wrap')` or on `module.register` hooks | Not implemented in Bun ✅[^lab] | See [nodejs-compatibility.md](nodejs-compatibility.md); replace loader hooks with `Bun.plugin` |

## Rollback
1. Restore `package.json`, `src/server.ts` (the `dotenv` import) and `Dockerfile` from version control, for example `git checkout -- package.json src Dockerfile`.
2. Delete `bun.lock` and `node_modules`, then reinstall with the kept lockfile:
   ```console
   $ rm -rf bun.lock node_modules && npm ci --ignore-scripts
   $ node src/server.ts &
   listening on 3000 (runtime: node v24.22.1)
   ```
   In the lab, `npm ci` on the original files restored a working Node server ✅[^lab].

## Takeaways
- Migrate in two commits: first `bun install` alone (Node still runs the app from Bun's `node_modules`, as step 2 showed), then the runtime and tool swaps, so each step can be reverted on its own ✅[^1] ✅[^lab].
- Put Bun flags immediately after `bun` in every script (`bun --watch run dev`, `bunx --bun tool`). [rule-candidate]
- Replace `node` with `bun` in scripts that read `.env`; a remaining `node` call needs an explicit `--env-file`. [rule-candidate]
- Keep `package-lock.json` until `bun install --frozen-lockfile`, the tests and the container all pass; then commit `bun.lock` and delete the old file.

## Verification status
- Verified: 84 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the Node side used `node:24.22.1-alpine` with npm 11.19.1, where Jest 30.5.2 was installed with npm; `oven/bun:1.1.45` (`1.1.45+196621f25`) wrote the `bun.lockb`, `oven/bun:1.3.14` (`1.3.14+0d9b296af`) ran the before-1.4 checks, and `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`) the `[test] environment` check. [^lab]
- [Migrate from npm install to bun install](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/install/from-npm-install-to-bun-install.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: `bun install` as a drop-in for `npm install`, `bunx`, `--bun`, script mapping. [^1]
- [Environment Variables](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/environment-variables.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: automatic `.env` loading, `dotenv` unnecessary, `--env-file`. [^2]
- [Lockfile](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/lockfile.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: automatic migration, npm lockfile versions, original kept, `bun.lockb` conversion. [^3]
- [Watch Mode](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/watch-mode.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: `--watch` restarts with the same arguments and environment. [^4]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: `node` invocation no longer loads `.env`, `lockfileVersion: 2`, `NODE_MODULE_VERSION` 147. [^5]
- [bunx](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/pm/bunx.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: local-first lookup, global cache, shebang handling, `--bun` placement. [^6]
- [Bun Runtime](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/index.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: Bun flags go immediately after `bun`. [^7]
- [Migrate from Jest to Bun's test runner](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/test/migrate-from-jest.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: `@jest/globals` rewrite, injected globals, config key mapping, CLI flags. [^8]
- [Containerize a Bun application with Docker](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/ecosystem/docker.mdx) — Bun docs at tag bun-v1.4.5, 2026. Backs: `oven/bun` base image, `--frozen-lockfile --production`, `USER bun`. [^9]
- [Migrate from Jest to Bun's test runner, live page](https://bun.com/docs/guides/test/migrate-from-jest) — Bun docs, living (read 2026-11-24, describes a Bun newer than 1.4.5). Backs: only the `[test] environment` row. [^10]

## Related
- `bun/node-compat/nodejs-compatibility.md` — API status and measured differences
- `bun/package-manager/install-mechanics-and-lockfile.md` — `bun.lock`, cache and `--frozen-lockfile`
- `bun/fundamentals/configuration-and-environment.md` — `.env` order, `--env-file`, `bunfig.toml`
- `bun/fundamentals/watch-hot-and-debugging.md` — `--watch` vs `--hot`
- `bun/fundamentals/what-bun-is.md` — Docker image variants
- `bun/testing/bun-test-runner.md` — Jest compatibility of `bun test`
- `bun/testing/test-config-coverage-reporters.md` — `[test]` keys and the happy-dom setup
- `js-runtime/node-type-stripping.md` — what Node 24 can run from a `.ts` file
