---
schema: knowledge-doc/v1
type: concept
topic: bun/fundamentals
status: verified
applies-to: ["Bun 1.4.5", "Node.js 24.22.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, bun-run, package-json-scripts, pre-post-scripts, shebang, bun-flag, transpiler, typescript, jsx, tsconfig, decorators, auto-install, eval, repl, stdin]
---

# Running code with Bun: `bun run`, scripts, binaries and the per-file transpiler

## Summary
**TL;DR:** `bun app.ts` and `bun run app.ts` run a file; `bun run <name>` looks for a `package.json` script first, then a file, then a binary in `node_modules/.bin`, then a system command. A script runs its `pre<name>` and `post<name>` scripts, and a failing `pre` stops it. A binary whose first line is `#!/usr/bin/env node` runs in whatever `node` is on `PATH` unless you pass `--bun`. Every file is transpiled on its own: TypeScript and JSX become JavaScript, `enum`, `namespace` and parameter properties work, and types are never checked unless you add `--check`. Bun reads ten-odd `tsconfig.json` fields (`jsx*`, `paths`, the decorator flags, `useDefineForClassFields`), but not `verbatimModuleSyntax`, and `importsNotUsedAsValues` and `moduleSuffixes` have no effect. With no `node_modules` folder, bare imports are installed on the fly into a global cache.
**Use this when:** replacing `node`, `tsx`/`ts-node` or `npm run` with Bun, wondering why a script, a file or a CLI ran instead of the one you meant, checking which TypeScript features and `tsconfig.json` options Bun honours, or running one-liners, stdin and the REPL.
**Not this doc:** how an import string becomes a file, CommonJS interop and the file-type loaders → [module-resolution-and-loaders.md](module-resolution-and-loaders.md); `bunfig.toml` and `.env` → [configuration-and-environment.md](configuration-and-environment.md); restarting on change → [watch-hot-and-debugging.md](watch-hot-and-debugging.md); running a script in many workspace packages (`--filter`) → `bun/package-manager/workspaces-catalogs-and-filter.md`; what Node.js 24 does with the same TypeScript → `js-runtime/node-type-stripping.md`.

## Problem
Moving from `npm run` and `tsx` to Bun breaks expectations in quiet ways. `bun build` runs Bun's bundler, not the project's `"build"` script. `bun run dev --watch` hands `--watch` to the script instead of to Bun. A CLI (command-line program) such as `vite` still runs in Node.js because of its shebang line. A TypeScript file with a type error runs without a word, and a `tsconfig.json` option the team relies on (`verbatimModuleSyntax`) is silently ignored. And in a folder without `node_modules`, `import "zod"` downloads zod from npm at run time instead of failing.

## Mental model
**Analogy:** `bun run <name>` is a receptionist routing a visitor who asks for "build". The receptionist checks the staff list first (`package.json` scripts), then the rooms in the building (files), then contractors on call (`node_modules/.bin`), and last the city phone book (system commands on `PATH`). Each file that then runs goes through an interpreter who translates sentence by sentence, TypeScript into JavaScript, as fast as you speak, but never fact-checks what is said: that is type checking, and it only happens if you ask for it (`--check`).

**Artifact:** one name, four meanings, observed in the lab ✅[^lab]:
```console
# package.json has "scripts": { "hello.ts": "echo from-script-hello.ts", "build": "echo from-script-build" }
# and the folder has a file hello.ts: console.log("from-file hello.ts")
$ bun hello.ts                # naked bun + file with an extension → the file
from-file hello.ts
$ bun run hello.ts            # bun run → the script of the same name wins
$ echo from-script-hello.ts
from-script-hello.ts
$ bun run ./hello.ts          # a path starting with ./ is always a file
from-file hello.ts
$ bun build                   # a built-in command beats the "build" script
bun build v1.4.5 (a7733435c)
error: Missing entrypoints. What would you like to bundle?
```

## How it works
**4 actors:**
- **Bun CLI** — its job: decide what the name after `bun` or `bun run` means, via its resolution order.
- **Script runner** — its job: run a `package.json` script and its `pre`/`post` scripts, via a subshell.
- **Transpiler** — its job: turn each source file into plain JavaScript, via the loader that the file extension picks and the `tsconfig.json` options.
- **JavaScriptCore** — its job: execute that JavaScript, via Bun's module loader (which may auto-install packages).

```
bun [bun flags] run <name> [script args]
  │
  ├─ Bun CLI: ./x or /x? ──────────────────────────────▶ file
  ├─ Bun CLI: package.json script <name>? ─▶ Script runner: pre<name> → <name> → post<name>
  │                                                        (bash/sh/zsh; a failing step stops)
  ├─ Bun CLI: file <name>? ─────────────────────────────▶ file
  ├─ Bun CLI: node_modules/.bin/<name>? ─▶ kernel reads shebang → `node` on PATH (or Bun with --bun)
  └─ Bun CLI (bun run only): system command <name>? ───▶ exec it
file ─▶ Transpiler (per file: strip/convert TS + JSX, no type check) ─▶ JavaScriptCore runs it
                                                     └─ bare import, no node_modules → auto-install
```

1. **Bun CLI (local): split the command line.** Bun flags go between `bun` and `run`; anything after the name goes to the script: `bun run args a b --flag` ran `echo args: a b --flag` ✅[^lab] ✅[^1]. So write `bun --watch run dev`, not `bun run dev --watch` ✅[^1].
2. **Bun CLI: resolve the name.** Absolute paths and paths starting with `./` are always files. Otherwise `bun run` tries, in order, `package.json` scripts, source files, binaries of installed packages and, for `bun run` only, system commands ✅[^1]. In the lab `bun run ls -d /w` ran `/bin/ls`, while `bun ls` failed with `error: Script not found "ls"` ✅[^lab]. The naked form `bun <name>` behaves like `bun run`, except that a built-in command of the same name (`build`, `test`, `install`) wins, and a name with a known extension resolves to the file first ✅[^1] ✅[^lab].
3. **Script runner: run the script.**
   - It prints the command with a `$` prefix (suppressed by `--silent` or `[run] silent = true`) ✅[^lab] ✅[^2].
   - It runs the command in a subshell, using the first of `bash`, `sh`, `zsh` it finds on Linux and macOS, and the Bun Shell on Windows ✅[^1]. Lab, a script printing `$0` and `$BASH_VERSION`: `/usr/bin/bash` and `5.2.37(1)-release` by default; `PATH` holding only `sh` → `/tmp/onlysh/sh` and no `BASH_VERSION`; `PATH` holding no shell at all → `/bin/bash`, so Bun also looks outside `PATH`; `--shell=bun` → the Bun Shell, which left `${BASH_VERSION:-none}` unexpanded ✅[^lab]. The Windows default was not run: the lab has no Windows machine.
   - It runs `pre<name>` first and `post<name>` after; if `pre<name>` fails, the script does not run ✅[^1]. In the lab, `prefail` exiting with 3 printed `error: script "prefail" exited with code 3`, `fail` never ran, and `bun` itself exited 3 ✅[^lab].
   - `bun run` with no name prints the flags and then every script with its command ✅[^lab].
4. **Kernel and `PATH`: run a package binary.** A file in `node_modules/.bin` with `#!/usr/bin/env node` runs in the first `node` on `PATH`; Bun respects that shebang ✅[^1]. `--bun` (or `-b`) makes it run in Bun "via symlinking node" ✅[^10]: in the lab, `which node` inside a script printed `/tmp/bun-node-0-a7733435c/node` with `--bun` and the real `node` without it ✅[^lab]. `[run] bun = true` in `bunfig.toml` has the same effect for every `bun run`, and is on by default when no `node` is on `PATH` ✅[^2] ✅[^lab].
5. **Transpiler: convert the file.** Each file is transpiled on the fly before it runs ✅[^1]. The extension picks the loader: `.ts`/`.mts`/`.cts` → `ts`, `.tsx` → `tsx`, `.js` and `.jsx` → `jsx` (JSX allowed, TypeScript not), `.mjs`/`.cjs` → `js` ✅[^3]. Lab: the same line `const el = <b>hi</b>` parsed in `.js` and `.jsx` (the run then only lacked React) and failed with `error: Unexpected <` in `.mjs` and `.cjs` ✅[^lab]. The `ts` loader removes TypeScript syntax and does not check types ✅[^3]. It also rewrites the syntax that has runtime meaning: in the lab `enum Color { Red, Green = 5 }` gave `0 5 Green`, a `namespace` exported `42`, `constructor(private a: number, public readonly b = 2)` created own fields `a` and `b`, and `<number>(<unknown>"7")` gave `7` ✅[^lab]. Node.js 24 refuses all four in its strip-only mode (see `js-runtime/node-type-stripping.md`).
6. **Transpiler: apply `tsconfig.json`.** Bun reads these `compilerOptions` and ignores the rest (source of `tsconfig_json.rs` at the tag) ✅[^4]:

   | Field | Effect observed or documented |
   |---|---|
   | `extends` | Inherited config (not followed for files inside `node_modules`) ✅[^4]. Lab: a root `tsconfig.json` with `"extends": "./cfg/base.json"` applied the base's `jsxFactory`; inside `node_modules/inner/`, a package `tsconfig.json` with `paths` worked when written directly but not through `extends` (`Cannot find package '@x'`), while the same `extends` layout outside `node_modules` worked ✅[^lab] |
   | `jsx`, `jsxFactory`, `jsxFragmentFactory`, `jsxImportSource` | `"jsx": "react", "jsxFactory": "h"` turned `<Box width={5}>Hello</Box>` into `h(Box, {width: 5}, "Hello")` ✅[^lab] ✅[^5]; `"preserve"` is not supported ✅[^5]: with `"jsx": "preserve"`, Bun emitted `jsxDEV(...)` calls and asked for `react/jsx-dev-runtime`, as with no setting ✅[^lab]. In a package inside `node_modules`, its own `jsx` and `jsxFactory` were not applied either (it too asked for `react/jsx-dev-runtime`) ✅[^lab] |
   | `paths`, `baseUrl` | Import aliases; see [module-resolution-and-loaders.md](module-resolution-and-loaders.md) ✅[^4]. Lab: `"baseUrl": "./src"` alone made `import { u } from "lib/util"` load `src/lib/util.ts` ✅[^lab] |
   | `experimentalDecorators` | Without it, decorators are the standard kind from TC39, the committee that standardises JavaScript (the decorator got a context object, `kind: "method"`); with it, the legacy kind (3 arguments) ✅[^lab] ✅[^6]. `oven/bun:1.3.14` behaved the same (the 1.4 notes date standard decorators to 1.3.10 ✅[^6]); `oven/bun:1.1.45` passed 3 arguments with or without the flag ✅[^lab] |
   | `emitDecoratorMetadata` | Emits `design:paramtypes` metadata (`["Dep", "Number"]` in the lab) and, since 1.3.11, implies legacy decorators by itself ✅[^lab] ✅[^6]; set alone, it gave 3 arguments in `oven/bun:1.3.14` too ✅[^lab]. The change itself cannot be shown here: the only older image, 1.1.45, uses legacy decorators in every case |
   | `useDefineForClassFields` | `false` is honoured since 1.4.0: field initializers move into the constructor after parameter properties ✅[^6]. Lab: `z = this.p + 1` gave `NaN` by default and `11` with `false`; `oven/bun:1.3.14` gave `NaN` both ways ✅[^lab] |
   | `importsNotUsedAsValues`, `moduleSuffixes` | Read ✅[^4], but neither acts. `importsNotUsedAsValues` `"preserve"` and `"error"` are parsed into a flag that the transpiler never uses (it hard-codes `preserve_unused_imports_ts: false`) ✅[^4] ✅[^11]; in the lab `"remove"`, `"preserve"` and `"error"` all dropped an unused import (the side effect did not run), and `"bogus"` printed `warn: Invalid value "bogus" for "importsNotUsedAsValues"` ✅[^lab]. `"moduleSuffixes": [".ios", ""]` printed `warn: moduleSuffixes is not supported yet` and loaded `foo.ts`, not `foo.ios.ts` ✅[^4] ✅[^lab] |
   | `verbatimModuleSyntax` | Not read ✅[^4]: an unused `import { v } from "./side"` in a `.ts` file was dropped (the side effect did not run) with or without it, while the same line in a `.js` file kept it ✅[^lab] |

7. **JavaScriptCore and the module loader: run, and maybe auto-install.** If no `node_modules` folder exists in the importing file's folder or above, Bun switches to its own resolution and installs each imported package into the global cache during the run ✅[^7]. The default is `--install=auto` ("auto-installs when no node_modules"); `--no-install` turns it off and `-i` means `--install=fallback` ✅[^10] ✅[^lab]. In the lab, `import isNumber from "is-number"` in an empty folder resolved to `/root/.bun/install/cache/is-number@7.0.0@@@1/index.js` and created no `node_modules`; `"is-number@6.0.0"` in the specifier pinned a version ✅[^lab] ✅[^7]. With an empty `node_modules` folder, or `--no-install`, the same import failed with `error: Cannot find package 'is-number'` ✅[^lab].
8. **Other entry points.**
   - `bun -e '<code>'` evaluates TypeScript (`const n: number = 2` ran); `bun -p '<expr>'` prints the result and awaits a promise: `bun -p "Promise.resolve(42)"` printed `42`, where `node -p` printed `Promise { 42 }` ✅[^lab].
   - `bun -` and `bun run -` read code from stdin and treat it as TypeScript with JSX ✅[^1] ✅[^lab].
   - `bun repl` is a native REPL (read-eval-print loop) with TypeScript, top-level `await`, `_` and `_error` ✅[^8]. Lab, lines piped into `bun repl`: `const n: number = 2` then `n + 1` printed `3`, `_ * 10` printed `30`, `await Promise.resolve(5)` printed `5`, and after `throw new Error("boom")`, `_error.message` printed `"boom"` ✅[^lab]. `bun repl -e` and `bun repl -p` run one input with REPL rules, so `bun repl -p "{ a: 1, b: 2 }"` printed an object, not a block ✅[^8] ✅[^lab].
   - `bun --check <file>` type checks the file and its imports first and runs nothing on an error ✅[^1] ✅[^9].

## Worked example
A CLI in `node_modules/.bin` with a Node shebang, a fake `node` first on `PATH` (a shell script that only prints its arguments), and scripts that call the CLI. The files:
```js
// node_modules/mycli/cli.js  (linked as node_modules/.bin/mycli, chmod +x)
#!/usr/bin/env node
console.log("mycli runs on", process.versions.bun ? "bun " + process.versions.bun : "node " + process.version);

// package.json "scripts" (excerpt)
// "cli": "mycli", "prebuild2": "echo pre-step", "build2": "echo main-step", "postbuild2": "echo post-step"

// fakebin/node
// #!/bin/sh
// echo "fake node binary called with: $*"
```
The run, in `oven/bun:1.4.5` ✅[^lab]:
```console
$ export PATH=/w/fakebin:$PATH
$ bun run mycli                          # step 2: no script "mycli" → node_modules/.bin/mycli
fake node binary called with: /w/node_modules/.bin/mycli        # step 4: shebang → first node on PATH
$ bun run --bun mycli                    # --bun → a temporary node → Bun
mycli runs on bun 1.4.5
$ bun run cli                            # a script that calls the binary: same shebang rule
$ mycli
fake node binary called with: /w/node_modules/.bin/mycli
$ bun run build2                         # step 3: pre → main → post
$ echo pre-step
pre-step
$ echo main-step
main-step
$ echo post-step
post-step
```
Without the fake `node`, `bun run mycli` printed `mycli runs on bun 1.4.5` in this image too, because the image's own `node` is a link to Bun (see [what-bun-is.md](what-bun-is.md)).

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A `.ts` file with `const bad: number = "oops"` | Runs, prints `oops string`, exits 0; `bun --check` reports `TS2322` and exits 1, even with no network ✅[^lab] | The transpiler never checks types; `--check` uses the built-in checker ✅[^3] ✅[^9] |
| `--check` without `@types/bun` | Also reports `TS2584: Cannot find name 'console'` and suggests `bun add -d @types/bun` ✅[^lab] | The checker needs Bun's type definitions for globals |
| TypeScript syntax in a `.js` file | `error: Expected ";" but found ":"`; the same file piped to `bun run -` runs ✅[^lab] | `.js` uses the `jsx` loader; stdin is read as TypeScript with JSX ✅[^3] ✅[^1] |
| JSX with no `tsconfig.json` and React not installed | With a `node_modules` folder (even an empty one) or `--no-install`: `Cannot find module 'react/jsx-dev-runtime'`; with `NODE_ENV=production`, `react/jsx-runtime`. In a folder with no `node_modules` at all, auto-install fetched `react@19.3.1` and the JSX ran ✅[^lab] | The default runtime is `automatic` with import source `react` ✅[^10]; `"jsx": "react-jsx"` picks `jsx-runtime` since 1.4.0 ✅[^6]: with it, 1.4.5 asked for `react/jsx-runtime` and `oven/bun:1.3.14` for `react/jsx-dev-runtime` ✅[^lab]; auto-install is step 7 |
| `bun run dev --watch` | `--watch` goes to the script: `"dev": "echo dev-script-args: "` printed `dev-script-args: --watch` ✅[^lab] | Flags after the name belong to the script ✅[^1] |
| `pre<name>` fails | The script is skipped and the exit code propagates ✅[^lab] | Documented lifecycle rule ✅[^1] |
| `bun run` in a script and `.env` | The script's shell does not see `.env` values: `echo WHO=$WHO` printed `WHO=` ✅[^lab] | See [configuration-and-environment.md](configuration-and-environment.md) |
| An empty `node_modules` folder in a scratch directory | Auto-install stops; imports fail ✅[^lab] | Auto-install only runs when no `node_modules` is found ✅[^7] |
| `-i` or `--install=force` with an empty `node_modules` folder | The package was installed and loaded anyway (`LOADED: lab-ok says hi`) ✅[^lab] | `fallback` installs missing packages, `force` always installs ✅[^10] |
| A security scanner is configured, or a `bunfig.toml` cannot be parsed | Auto-install is off and `-i` cannot turn it back on ✅[^7]. Lab, with a local stand-in registry: a `[install.security] scanner` in the project file or in the global `~/.bunfig.toml` gave `Cannot find package "lab-ok": auto-install is off because a security scanner is configured. Run "bun install"`, with `-i` too, and no request reached the registry; an unparsable `bunfig.toml` or `package.json` at the project root (the file run from a subfolder) gave `… because a package.json or bunfig.toml cannot be read or parsed` ✅[^lab] | Documented safeguard |
| `node` with no arguments in the `oven/bun` image | `error: Missing script to execute`, not a REPL ✅[^lab] | That `node` is Bun (see [what-bun-is.md](what-bun-is.md)); use `bun repl` or `--interactive` ✅[^10] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Plain `bun file.ts` | Fastest start; no type checker in the loop | Type errors reach run time unnoticed |
| `bun --check file.ts` (or `bun check` in CI) | Same errors as `tsc` before anything runs | Extra time per start; needs `@types/bun` for a clean result |
| Auto-install (no `node_modules`) | One-file scripts with no install step | Downloads at run time; no lockfile unless one exists; no editor types ✅[^7]. Lab: after an auto-install from a stand-in registry, the folder had no `node_modules` and no `bun.lock`; the package sat in `~/.bun/install/cache/lab-ok@1.0.0@@<registry host>__<hash>@@@1` ✅[^lab] |
| `bun install` first | Reproducible `node_modules` and lockfile | One more step for throwaway scripts |

## Takeaways
- Put Bun flags before `run`: `bun --watch run dev`, never `bun run dev --watch`. [rule-candidate]
- Use `bun run <script>` (not `bun <script>`) when a script shares its name with a built-in command such as `build` or `test`. [rule-candidate]
- Run `bun check` (or `bun --check`) in CI; plain `bun` never reports type errors. [rule-candidate]
- Use `bun --bun run <cli>` when a Node-shebang CLI must run in Bun.
- Do not rely on `verbatimModuleSyntax` or `importsNotUsedAsValues` under Bun: write `import "./side"` for an import kept only for its side effect. [rule-candidate]
- In throwaway folders, know that a bare import may download from npm; pass `--no-install` to forbid it.

## Verification status
- Verified: 94 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the Node.js comparison ran in `node:24.22.1-alpine`. The auto-install safeguards ran against a stand-in npm registry (a `Bun.serve` script in its own container serving one package, `lab-ok@1.0.0`, and 404 for every other name). A later session (around midnight, 2026-11-24 to 25) ran the decorator, class-field and JSX probes unchanged in `oven/bun:1.1.45` (`1.1.45+196621f25`) and `oven/bun:1.3.14` (`1.3.14+0d9b296af`). [^lab]
- [Bun Runtime: docs/runtime/index.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/index.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `bun run` forms, flag placement, resolution order, subshell choice, pre/post scripts, the `--bun` shebang rule, `bun run -`, `--check`. [^1]
- [bun run CLI flags: docs/snippets/cli/run.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/snippets/cli/run.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026; the flag list the runtime page includes. Backs: `--bun` "via symlinking node", `--install` (default `auto`), `-i`, `--no-install`, `--interactive`, `--jsx-runtime` and `--jsx-import-source` defaults. [^10]
- [bunfig.toml: docs/runtime/bunfig.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/bunfig.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `[run] silent`, `[run] bun` and its default. [^2]
- [File Types: docs/runtime/file-types.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/file-types.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: default loader per extension, the `ts` loader does not check types. [^3]
- [src/resolver/tsconfig_json.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/resolver/tsconfig_json.rs) — Bun source (Oven), 2026. Backs: the `tsconfig.json` fields Bun reads, `extends` skipped inside `node_modules`. [^4]
- [JSX: docs/runtime/jsx.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/jsx.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `jsx*` options, `"preserve"` not supported. [^5]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Oven, 2026. Backs: standard TC39 decorators (marked 1.3.10), `emitDecoratorMetadata` implies legacy decorators, `useDefineForClassFields: false` honoured, `"react-jsx"` emits `jsx`. [^6]
- [Auto-install: docs/runtime/auto-install.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/auto-install.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: when auto-install runs, the global cache, version specifiers, when it is off, limitations. [^7]
- [REPL: docs/runtime/repl.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/repl.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: `bun repl` features, `_`/`_error`, `-e`/`-p` with REPL semantics. [^8]
- [Bun v1.4.3](https://bun.com/blog/bun-v1.4.3) — Oven, 2026. Backs: `bun check` and `bun run --check` (type check, then run; nothing runs on an error). [^9]
- [src/bundler/transpiler.rs at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/bundler/transpiler.rs) — Bun source (Oven), 2026. Backs: the runtime transpiler passes `preserve_unused_imports_ts: false` to the parser, whatever `importsNotUsedAsValues` says. [^11]

## Related
- `bun/fundamentals/module-resolution-and-loaders.md` — how imports resolve, `tsconfig.json` `paths`, the loaders table.
- `bun/fundamentals/configuration-and-environment.md` — `bunfig.toml`, `[run]` keys, `.env` loading.
- `bun/fundamentals/watch-hot-and-debugging.md` — `--watch`, `--hot`, the debugger.
- `bun/package-manager/workspaces-catalogs-and-filter.md` — `bun run --filter` across a monorepo.
- `js-runtime/node-type-stripping.md` — what Node.js 24 does with the same TypeScript.
- `js-runtime/enums-and-literal-unions.md` — whether to use `enum` at all.
- `linux/lab-setup.md` — the lab.
