---
schema: knowledge-doc/v1
type: concept
topic: deno/fundamentals
status: verified
applies-to: ["Deno 2.9.8", "TypeScript 6.0.3 (bundled)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, deno-run, deno-eval, repl, shebang, watch, typescript, deno-check, type-checking, jsx, tsx, compiler-options, lib, d-ts, ts-types, tsgo]
ranked-sources: true
---

# Running code and type checking TypeScript in Deno

## Summary
**TL;DR:** `deno run` (or plain `deno <file>`) runs a local file, a URL or code piped to stdin (`-`). It treats `.ts`, `.tsx`, stdin and extensionless files as TypeScript and strips the types without checking them, so a type error never stops `deno run` on its own. Types are checked only by `deno run --check` (your local modules), `--check=all` (remote and npm modules too) or `deno check`, which use the bundled TypeScript 6.0.3 in strict mode. `deno eval` and a bare `deno` REPL (read-eval-print loop) run with all permissions, `deno repl` with none. JSX (HTML-like tags inside JavaScript) uses the classic `React.createElement` transform until `compilerOptions` choose `react-jsx`, and emit options such as `target` are ignored.
**Use this when:** starting a script, adding type checking to CI (continuous integration), writing a shebang script, configuring JSX or `compilerOptions`, or giving a JavaScript dependency its types.
**Not this doc:** what Deno is and how to install it → `deno/fundamentals/what-deno-is.md`; permission flags → `deno/security/permission-flags.md`; import specifiers and import maps → `deno/modules/module-specifiers-and-imports.md`; every `deno.json` key → `deno/configuration/deno-json-reference.md`; how the module graph and the checker work inside → `deno/internals/module-loading-and-type-checking.md`; type checking in tests → `deno/testing/testing-and-mocking.md`; the `--unstable-*` flags → `deno/releases-stability-and-support.md`.

## Problem
- `const n: number = "hello"` runs under `deno run`, prints `hello` and exits 0 ✅[^run]. A CI job that only runs the program passes code with broken types.
- A `.tsx` file throws `ReferenceError: React is not defined` although nothing in it mentions React ✅[^run].
- An `add.d.ts` placed next to `add.js` is ignored: the import stays untyped, and a wrong use type-checks clean ✅[^run] ✅[^ts].
- A shebang line copied from the docs fails on Alpine Linux with `/usr/bin/env: unrecognized option: S` ✅[^run].

## Mental model
**Analogy:** `deno run` is a live interpreter who turns TypeScript into JavaScript as fast as it is spoken and never stops for grammar mistakes. `deno check` is a proofreader who reads the whole text and refuses to sign while one mistake remains. `deno run --check` puts the proofreader in front of the interpreter.

**Artifact:** one file, three commands, two exit codes ✅[^run].
```console
$ cat typeerr.ts
const n: number = "hello";
console.log("ran, n =", n);
$ deno run typeerr.ts; echo "exit=$?"
ran, n = hello
exit=0
$ deno run --check typeerr.ts; echo "exit=$?"
Check typeerr.ts
TS2322 [ERROR]: Type 'string' is not assignable to type 'number'.
const n: number = "hello";
      ^
    at file:///lab/typeerr.ts:1:7

error: Type checking failed.

  info: The program failed type-checking, but it still might work correctly.
  hint: Re-run with --no-check to skip type-checking.
exit=1
```
`deno check typeerr.ts` prints the same diagnostic without the `info:` and `hint:` lines, runs nothing, and exits 1 ✅[^run].

**Terms used below:**

| Term | Plain-English analogy | Concrete artifact |
|---|---|---|
| Transpile | Retyping a text in another alphabet without reading it for sense | `deno transpile hello.tsx` printed `React.createElement("h1", { class: "title" }, "Hello")` ✅[^run] |
| Type check | Proofreading against the rules of the language | the `TS2322 [ERROR]` above |
| Main module (entry point) | The first domino; everything it imports falls after it | for piped code, `import.meta.url` is `file:///lab/$deno$stdin.mts` ✅[^run] |
| Shebang | A note on line 1 telling the shell which program reads the rest | `#!/usr/bin/env -S deno run --allow-env=HOME` |
| REPL (read-eval-print loop) | A calculator: type one line, see the answer | `_` holds the last value, `_error` the last thrown error ✅[^repl] |
| `compilerOptions` | House rules handed to the proofreader | `"jsx": "react-jsx"` in `deno.json` |
| `lib` | The dictionary the proofreader checks global names against | the default `deno.window` knows `Deno` but not `document` ✅[^ts] |
| Declaration file (`.d.ts`) | A spec sheet that lists a part's shape without the part | `export declare function add(a: number, b: number): number;` |
| JSX | HTML-like tags in code that are rewritten into function calls | `<h1 class="title">Hello</h1>` |

## How it works

### Ways to start code

| Command | Code comes from | Permissions | Type check | Lab result |
|---|---|---|---|---|
| `deno run main.ts`, or `deno main.ts` | a local file; the `run` word is optional ✅[^run-ref] | none until flags grant them | no ✅[^run-ref] | `deno ok.ts` printed `ok` ✅[^run] |
| `deno run http://127.0.0.1:4507/hello.ts` | a URL, downloaded once into the cache | none until flags grant them | no | `Download http://127.0.0.1:4507/hello.ts`, then the program's output ✅[^run] |
| `echo "…" \| deno run -` | stdin ✅[^run-ref], run as the TypeScript module `$deno$stdin.mts` | none until flags grant them | no | `deno run - one two` printed `[ "one", "two" ] file:///lab/$deno$stdin.mts` ✅[^run] |
| `deno eval "code"` | a string, run as `$deno$eval.mts` | all permissions by default ✅[^eval] | no ✅[^eval] | `deno eval -p "1 + 2"` printed `3` ✅[^run] |
| `deno repl` | lines typed or piped in | none: `Deno.permissions.querySync({name:"env"}).state` was `"prompt"` ✅[^run] | no | top-level `await Promise.resolve(7)` printed `7` ✅[^run] |
| `deno` with no arguments | the REPL | all: the banner says `REPL is running with all permissions allowed.` ✅[^run] | no | the same REPL |
| `deno run hello`, where `hello` is a task in `deno.json` | the task | the task's own command line | — | `Task hello echo task-ran` ✅[^run]; `deno run` runs "a JavaScript or TypeScript program, or a task" ✅[^run-ref] |

- A remote main module ran with no extra flag, but a static import from a host outside the default allow list stopped with `Requires import access to "127.0.0.1:4508", run again with the --allow-import flag` ✅[^run]; the specifier rules are in `deno/modules/module-specifiers-and-imports.md`.
- The REPL also has `clear()` and `close()`, `--eval` (code to run before the prompt) and `--eval-file` (files or URLs to run first); history goes to `deno_history.txt` in `DENO_DIR`, and an empty `DENO_REPL_HISTORY` turns it off ✅[^repl]. In the lab, `_ * 2` after `42` printed `84` and `_error.message` after `throw new Error("boom")` printed `"boom"` ✅[^run].

### What `deno run` does with one file
**4 actors:**
- **Deno CLI** (command-line interface) — its job: split the command line into Deno's flags and the program's arguments, via its argument parser.
- **Module loader** — its job: give each module a media type and turn it into JavaScript, via the file extension, `--ext` and the cache.
- **TypeScript checker** — its job: check types before anything runs, via the bundled TypeScript 6.0.3, only when `--check` is given.
- **V8** — its job: execute the JavaScript, via the embedded engine.

```
deno run --check main.ts a b
   │
   ├─ CLI: flags = [--check]          program args = ["a", "b"]  (everything after the file name)
   ├─ Loader: main.ts → TypeScript → strip types → JavaScript
   ├─ Checker (only with --check): local modules; remote and npm too with --check=all
   │      error? → print TS diagnostics, exit 1, nothing runs
   └─ V8: run the JavaScript
```

1. **Deno CLI (local):** flags must come before the file name ✅[^run-ref]. Anything after it is the program's: `deno run watch/args.ts --watch x` printed `args: [ "--watch", "x" ]` ✅[^run].
2. **Module loader (local):** a `.ts` file is TypeScript. So is an extensionless local file in 2.9.8: `deno info extless` printed `type: TypeScript`, and the file's `interface` and `enum` ran ✅[^run]. `--ext` sets the content type ✅[^run-ref]; `--ext=js` turned the same file into `SyntaxError: Expected ';', '}' or <eof>` ✅[^run].
3. **TypeScript checker (local, only on request):** with `--check`, a type error stops the process before any code runs ✅[^ts].
4. **V8 (local):** runs the result.

### Which command checks what

| Command | Local modules | Remote and npm modules | Runs the code |
|---|---|---|---|
| `deno run` | no | no | yes |
| `deno run --check` | yes | no | only if the check passes |
| `deno run --check=all` | yes | yes | only if the check passes |
| `deno check` | yes | no | no |
| `deno check --all` | yes | yes | no |
| `deno test`, `deno bench` | yes, by default; `--no-check` skips it | — | yes |

The table follows the docs ✅[^ts] ✅[^check]. In the lab, a local file importing `http://127.0.0.1:4507/bad.ts` (which assigns `"x"` to a `number`) passed `deno check` with exit 0 and ran under `deno run --check`; `deno check --all` and `deno run --check=all` both reported `TS2322 ... at http://127.0.0.1:4507/bad.ts:1:7` and exited 1 ✅[^run].

- `deno check` takes files, folders or globs (`deno check src/`, `deno check "src/**/*.ts"`), exits non-zero on type errors, and with `--doc` or `--doc-only` also checks code blocks in JSDoc and Markdown ✅[^check].
- **Strict by default:** `strict` is on, and so is `noImplicitOverride`, which `tsc` leaves off even under `strict` ✅[^ts]; `useUnknownInCatchVariables` is on too ✅[^tsconfig]. One lab file got `TS4114` (missing `override`), `TS18046` (`'e' is of type 'unknown'`) and `TS7006` (implicit `any` parameter) with no config at all ✅[^run].
- **JavaScript** is checked only with `// @ts-check` at the top of the file, `"checkJs": true`, or `deno check --check-js` ✅[^ts]. `deno check nocheck.js` printed nothing and exited 0; with `--check-js` it reported `TS2345 [ERROR]: Argument of type 'string' is not assignable to parameter of type 'number'.` ✅[^run]

### `compilerOptions` Deno honours
Options go in `compilerOptions` of `deno.json`, or in a `tsconfig.json` that Deno finds in each folder holding a `deno.json` or `package.json`; when both exist, `deno.json` wins ✅[^tsconfig]. A lab folder with only `package.json` and a `tsconfig.json` setting `noUnusedLocals` got `TS6133 [ERROR]: 'unused' is declared but its value is never read.` ✅[^run]

| Option | Deno's default |
|---|---|
| `strict`, `noImplicitAny`, `noImplicitThis`, `noImplicitOverride`, `useUnknownInCatchVariables` | `true` |
| `checkJs`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noUncheckedIndexedAccess` | `false` |
| `jsx` / `jsxFactory` / `jsxFragmentFactory` | `"react"` / `"React.createElement"` / `"React.Fragment"` |
| `lib` | `["deno.window"]`, replaced (not merged) when you set it |
| `module` | `"nodenext"`; also `esnext` or `preserve` |
| `moduleResolution` | `"nodenext"`; also `bundler` |
| `paths` / `rootDirs` | `{}` / `null` |

Values from Deno's TypeScript configuration page ✅[^tsconfig]. Deno never writes output files, so it ignores emit options: `target`, `outDir`, `outFile`, `rootDir`, `declaration`, `sourceMap`, `inlineSourceMap`, `esModuleInterop`, `allowSyntheticDefaultImports`, `importHelpers`, `downlevelIteration`, `resolveJsonModule`, `skipLibCheck` ✅[^tsconfig]. A `deno.json` with three of them printed `Unsupported compiler options in "file:///lab/emitopts/deno.json". The following options were ignored: outDir, sourceMap, target` and went on checking ✅[^run].

### `lib` and the Deno types
- **`deno.window`** (the default) holds the `Deno` namespace and the web globals, but no DOM (Document Object Model) ✅[^ts], so `document.querySelector("h1")` failed with `TS2584 [ERROR]: Cannot find name 'document'. Do you need to change your target library? Try changing the 'lib' compiler option to include 'dom'.` ✅[^run]
- **`deno.ns`** holds only the `Deno` namespace and the `import.meta` additions, so it does not clash with other libraries ✅[^tsconfig]. For code shared with browsers, `"lib": ["dom", "dom.iterable", "dom.asynciterable", "deno.ns"]` ✅[^ts]. With it the same file passed `deno check`, then `deno run` failed with `ReferenceError: document is not defined` and `info: document global is not available in Deno.` ✅[^run]. `lib` changes types, never the runtime.
- **`deno.worker`** is for worker code ✅[^tsconfig]; `"lib": ["deno.worker"]` let `const w: WorkerGlobalScope = self` pass ✅[^run]. `dom` and `webworker` conflict with `deno.window` and `deno.worker` ✅[^tsconfig].
- `deno types` prints the runtime's declarations: 23,336 lines in 2.9.8 ✅[^run].

### Types for JavaScript and for globals
Each row imports `add` from a JavaScript file and writes `const r: string = add(1, 2)`, which should fail because `add` returns a `number` ✅[^run].

| Mechanism | Written where | `deno check` result |
|---|---|---|
| nothing (plain `import { add } from "./add.js"`) | — | passes: `add` stays untyped, because a `.d.ts` next to a `.js` is not picked up automatically ✅[^ts] |
| `// @ts-types="./add.d.ts"` | the line above the import | `TS2322 [ERROR]: Type 'number' is not assignable to type 'string'.` |
| `// @ts-self-types="./add.d.ts"` | the top of `add.js` | the same error, for every importer; the preferred option ✅[^ts] |
| `X-TypeScript-Types: ./add.d.ts` | the HTTP (HyperText Transfer Protocol) response header of a remote `add.js` | Deno also downloaded `add.d.ts` and reported the same error; the path resolves against the module URL ✅[^ts] |

- `@ts-types` works on static `import` statements only, not on `import()` ✅[^ts].
- **Globals:** `/// <reference types="./global.d.ts" />`, where `global.d.ts` holds `declare global { var APP_NAME: string; }`, made `APP_NAME` a typed global; without the reference the same code got `TS2304 [ERROR]: Cannot find name 'APP_NAME'.` ✅[^run]. Use `var` in `declare global`, because Deno 2 has no `window` and globals live on `globalThis`; listing the file in `compilerOptions.types` works too ✅[^ts].

### JSX and TSX
Deno runs `.jsx` and `.tsx` files with no build step ✅[^jsx]. The `jsx` option picks the transform ✅[^jsx].

| `jsx` value | Transform | Use |
|---|---|---|
| `"react"` (Deno's default) | classic: `React.createElement` calls; a `React` variable must be in scope | legacy code |
| `"react-jsx"` | automatic: imports from `<jsxImportSource>/jsx-runtime` | recommended for new code |
| `"react-jsxdev"` | automatic, plus file, line and column debug info | development only |
| `"precompile"` | static JSX becomes prebuilt HTML strings for server rendering | Preact and Hono; does not work with React |

`jsxImportSource` names the library and Deno appends `/jsx-runtime`; a file can set it with a leading `/** @jsxImportSource npm:preact */` comment; `jsxImportSourceTypes` supplies types for a library that ships none; `jsxPrecompileSkipElements` lists tags that `precompile` leaves alone ✅[^jsx].

### Shebangs and `--watch`
- **Shebang:** `#!/usr/bin/env -S deno run --allow-env --ext=js` on line 1, then `chmod +x` once; `-S` makes `env` split `deno run …` into separate arguments; on Windows a shebang needs WSL (Windows Subsystem for Linux) or a Unix-like shell such as Git Bash ✅[^hashbang]. With GNU `env` (coreutils 9.4), `./greet.ts a b` printed `home: /root | args: [ "a", "b" ]` ✅[^run].
- **`--watch`** restarts the program when a local file of the entry point's module graph changes; the flag goes before the file name; since Deno 2.8 a restart sends SIGTERM, then waits 500 ms before a hard kill ✅[^run-ref]. The lab printed `Watcher Process started.`, then after an edit `Watcher Restarting! File change detected: "/lab/watch/app.ts"` and the new output ✅[^run].

### The native type checker (`DENO_UNSTABLE_TSGO`)
The docs describe TypeScript's Go-based compiler, integrated behind an unstable flag and "often around 10 times faster" than the JavaScript `tsc`. It is switched on with `DENO_UNSTABLE_TSGO=1 deno check main.ts`, `deno check --unstable-tsgo main.ts` or `"unstable": ["tsgo"]` in `deno.json`, understands `jsr:` and `npm:` specifiers and the `Deno` global, and is a preview not yet fit for CI or release builds ✅[^ts]. In 2.9.8 the lab saw no effect from any of the three switches (Edge cases).

## Worked example
A `.tsx` file with no React, fixed with a short JSX runtime of its own ✅[^run].

1. `hello.tsx` holds `const el = <h1 class="title">Hello</h1>; console.log(el);`. `deno run hello.tsx` stops with `error: Uncaught (in promise) ReferenceError: React is not defined` and exit 1, because the default `"react"` transform compiles the tag to `React.createElement("h1", { class: "title" }, "Hello")`.
2. `deno check hello.tsx` finds 3 errors: twice `TS7026 [ERROR]: JSX element implicitly has type 'any' because no interface 'JSX.IntrinsicElements' exists.` and once `TS2874 [ERROR]: This JSX tag requires 'React' to be in scope, but it could not be found.`; exit 1.
3. A new folder gets this `deno.json`:
   ```json
   {
     "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "tiny-jsx" },
     "imports": { "tiny-jsx/jsx-runtime": "./jsx-runtime.ts" }
   }
   ```
   and a `jsx-runtime.ts` that exports `jsx(type, props)` returning `{ type, props }`, `jsxs = jsx`, `Fragment`, and a `JSX` namespace with `IntrinsicElements`.
4. `deno run app.tsx` (the same tag, printed with `JSON.stringify`) prints `{"type":"h1","props":{"class":"title","children":"Hello"}}` and exits 0; `deno check app.tsx` exits 0. The automatic transform moved the text child into `props.children` and imported `tiny-jsx/jsx-runtime`, which the import map pointed at the local file.
5. Without any `compilerOptions`, a `/** @jsxImportSource tiny-jsx */` comment on line 1 of a file did the same: `{"type":"p","props":{"children":"pragma"}}`, and `deno check` passed.

## Edge cases

| Case | What happens | Why |
|---|---|---|
| `#!/usr/bin/env -S deno run …` on Alpine | `/usr/bin/env: unrecognized option: S`, exit 1 ✅[^run] | Alpine's `env` is BusyBox v1.37.0, which has no `-S` ✅[^run] |
| `#!/usr/bin/env deno run` (no `-S`) with GNU `env` | `/usr/bin/env: 'deno run': No such file or directory` and `use -[v]S to pass options in shebang lines`, exit 127 ✅[^run] | `env` looks for a program literally named `deno run` ✅[^hashbang] |
| `#!/bin/deno run --allow-env` (no `env`) | `error: Module not found "file:///lab/run%20--allow-env".` ✅[^run] | Deno received `run --allow-env` as one argument; `#!/bin/deno run` with one word worked ✅[^run] |
| An extensionless script | Read as TypeScript in 2.9.8 ✅[^run]; the shebang tutorial still says to add `--ext` for extensionless files ✅[^hashbang] | `--ext` is needed only to force another type, such as `--ext=js` |
| A flag after the file name | It reaches the program as `Deno.args`, and Deno ignores it ✅[^run] | Deno's flags end at the file name ✅[^run-ref] |
| `deno eval` with a type error | Runs: `deno eval 'const x: number = "s"; console.log(x)'` printed `s` ✅[^run] | `eval` does not type-check by default ✅[^eval] |
| Permission probes in `deno eval` or bare `deno` | Every check passes (`/root granted`) ✅[^run] | Both run with all permissions ✅[^eval] ✅[^run]; use `deno run` or `deno repl` |
| A type error typed into the REPL | Accepted: `const z: number = "str"` then `z` printed `"str"` ✅[^run] | The REPL strips types without checking them |
| A `tsconfig.json` with `target`, `outDir`, `sourceMap`, `esModuleInterop`, `skipLibCheck` | No warning in 2.9.8; the same options in `deno.json` warned ✅[^run] | The docs say Deno warns about ignored options in a `tsconfig.json` ✅[^tsconfig]; the run did not show it |
| `DENO_UNSTABLE_TSGO=1`, `--unstable-tsgo` or `"unstable": ["tsgo"]` | Same output as without; the `-L debug` log still showed the JavaScript compiler `ext:deno_cli_tsc/00_typescript.js` running (network off) ✅[^run] | The docs describe the switches ✅[^ts]; the 2.9.8 release notes last mention tsgo in 2.7.6 ✅[^releases] |
| The checker's effective libraries | The `-L debug` log listed `"lib":["deno.window","deno.unstable","node"]` ✅[^run] | The documented default is `["deno.window"]` ✅[^tsconfig]; unstable and Node types are added internally |
| `// @ts-types` above a dynamic `import()` | No effect; cast the result instead, for example `as typeof import("npm:@types/marked-terminal@6")` ✅[^ts] | The directive covers static imports only ✅[^ts] |
| `"jsx": "precompile"` with React | Does not work ✅[^jsx] | It targets Preact and Hono server rendering ✅[^jsx] |

## Trade-offs

| Option | Gains | Costs |
|---|---|---|
| `deno run` alone | The program starts with no checker in front ✅[^run-ref] | Type errors reach run time ✅[^run] |
| `deno run --check` | A type error stops the process before any code runs ✅[^ts] | The checker runs in front of every start |
| `deno check` in CI, plain `deno run` elsewhere | One gate for types, fast local runs; non-zero exit fits CI ✅[^check] | Local runs never see type errors |
| `--check=all` / `--all` | Catches type errors in remote and npm modules too ✅[^run] | An error in code you do not own blocks your run ✅[^run] |

## Takeaways
- Run `deno check` (or `deno run --check`) in CI: `deno run` alone never fails on a type error. [rule-candidate]
- Put every Deno flag before the file name; anything after it goes to the program. [rule-candidate]
- Give a JavaScript module its types with `// @ts-self-types` in the module, or `// @ts-types` at the import; a `.d.ts` beside it is ignored. [rule-candidate]
- Set `"jsx": "react-jsx"` and a `jsxImportSource` for new JSX code instead of relying on the classic default. [rule-candidate]
- Test permission behaviour with `deno run` or `deno repl`, never `deno eval` or a bare `deno` REPL, which have every permission.
- On BusyBox-based systems such as Alpine, write `#!/bin/deno run` (one word after the path) or call `deno run` explicitly; `env -S` needs GNU `env`.

## Verification status
- Verified: 106 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`, with `--network none` (small `Deno.serve` servers inside the same container served the remote modules and the `X-TypeScript-Types` header); the GNU `env -S` shebang ran the same Deno 2.9.8 executable copied into `ubuntu:24.04` (GNU coreutils 9.4); outputs as quoted in Problem, Mental model, How it works, Worked example, Edge cases and Trade-offs. [^run]
- [deno run](https://docs.deno.com/runtime/reference/cli/run/) — Deno project, living. Rank 1. Backs: `run` optional, stdin with `-`, no type check by default, a task as target, flags before the file name, `--ext`, `--watch` behaviour. [^run-ref]
- [deno eval](https://docs.deno.com/runtime/reference/cli/eval/) — Deno project, living. Rank 1. Backs: all permissions by default, no type check by default. [^eval]
- [deno repl](https://docs.deno.com/runtime/reference/cli/repl/) — Deno project, living. Rank 1. Backs: `_`, `_error`, `clear()`, `close()`, `--eval`, `--eval-file`, history file, `DENO_REPL_HISTORY`. [^repl]
- [deno check](https://docs.deno.com/runtime/reference/cli/check/) — Deno project, living. Rank 1. Backs: files, folders and globs, `--all`, `--doc`, `--doc-only`, non-zero exit on errors. [^check]
- [TypeScript support](https://docs.deno.com/runtime/fundamentals/typescript/) — Deno project, living. Rank 1. Backs: `--check`, `--check=all`, `deno check`, strict defaults and `noImplicitOverride`, JavaScript checking, `@ts-types`, `@ts-self-types`, `X-TypeScript-Types`, `.d.ts` not picked up, global augmentation, `lib` for shared code, `DENO_UNSTABLE_TSGO`. [^ts]
- [Configuring TypeScript](https://docs.deno.com/runtime/reference/ts_config_migration/) — Deno project, living. Rank 1. Backs: `compilerOptions` defaults, ignored emit options and the warning, `tsconfig.json` detection and precedence, `deno.ns`, `deno.window`, `deno.worker`, library conflicts. [^tsconfig]
- [JSX and React](https://docs.deno.com/runtime/reference/jsx/) — Deno project, living. Rank 1. Backs: `.jsx`/`.tsx` with no build step, the classic default, `jsx` values, `jsxImportSource`, the pragma, `jsxImportSourceTypes`, `jsxPrecompileSkipElements`. [^jsx]
- [Executable scripts](https://docs.deno.com/examples/hashbang_tutorial/) — Deno project, living. Rank 1. Backs: the `env -S` shebang, `--ext` for extensionless files, `chmod`, Windows needs WSL or Git Bash. [^hashbang]
- [Releases.md at v2.9.8](https://github.com/denoland/deno/blob/v2.9.8/Releases.md) — Deno project, 2026. Rank 1. Backs: the last tsgo entries are in 2.7.6. [^releases]

## Related
- `deno/fundamentals/what-deno-is.md` — the pieces of Deno and how to install it.
- `deno/fundamentals/web-platform-apis.md` — the globals your code can use once it runs.
- `deno/security/permission-model.md` — what the permissions in the table above control.
- `deno/configuration/deno-json-reference.md` — every `deno.json` key, including `compilerOptions` and `unstable`.
- `deno/internals/module-loading-and-type-checking.md` — the module graph, the emit cache and the bundled TypeScript inside.
- `deno/toolchain/cli-subcommands.md` — every subcommand and its flags.
