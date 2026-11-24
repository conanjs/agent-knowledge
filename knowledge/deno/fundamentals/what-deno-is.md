---
schema: knowledge-doc/v1
type: concept
topic: deno/fundamentals
status: verified
applies-to: ["Deno 2.9.8", "Node.js 26.13 docs (comparison rows only)"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, runtime, v8, rust, tokio, secure-by-default, web-standards, typescript, toolchain, nodejs, install, upgrade]
ranked-sources: true
---

# What Deno is: one executable that runs JavaScript, TypeScript and WebAssembly

## Summary
**TL;DR:** Deno is a JavaScript, TypeScript and WebAssembly runtime shipped as one executable that embeds the V8 engine, a Rust core and the Tokio async runtime ✅[^readme] ✅[^install]. A program gets no file, network or environment access until a flag grants it ✅[^start], its globals are web-standard APIs (application programming interfaces) such as `fetch` and `Request` ✅[^webapis], `.ts` files run with no build step ✅[^start], and the same executable formats, lints, tests and benchmarks code ✅[^start]. Deno 2 also runs Node.js and npm code ✅[^v2], but its defaults differ from Node.js: access is denied until granted, there is no `window`, and ES (ECMAScript) modules come first.
**Use this when:** deciding whether Deno fits a project, explaining Deno to someone who knows Node.js, or installing it on a new machine.
**Not this doc:** running files, the REPL (read-eval-print loop) and type checking → `deno/fundamentals/running-code-and-typescript.md`; which web APIs and globals exist → `deno/fundamentals/web-platform-apis.md`; release channels, `deno upgrade` in depth and the support timeline → `deno/releases-stability-and-support.md`; `deno_core`, ops and the event loop in depth → `deno/internals/runtime-architecture.md`; what each permission allows → `deno/security/permission-model.md`.

## Problem
Someone who knows Node.js meets three surprises in Deno's first hour:
- A script that reads a file stops with `NotCapable: Requires read access to "./name.txt", run again with the --allow-read flag` and exit code 1 ✅[^run], although the user running it can read the file.
- Code that checks `typeof window` to detect a browser takes the wrong branch: Deno 2 removed the `window` global ✅[^v2rc], so `typeof window` is `"undefined"` in 2.9.8 ✅[^run].
- They install a formatter, a linter, a test runner and a type checker from npm, although the `deno` executable already ships a formatter, linter, test runner and benchmarking ✅[^start], and type-checks with `deno check` ✅[^ts].

Without a picture of what Deno contains and what it refuses by default, each of these looks like a bug.

## Mental model
**Analogy:** Deno is a sealed workshop delivered as one crate. Every tool is already inside (formatter, linter, test runner, type checker), and the workshop's doors to the outside, meaning the disk, the network, environment variables and other programs, stay locked until you hand over a key that names one door (`--allow-read=name.txt`). The sockets inside take the same plugs as a web browser (`fetch`, `URL`, `Request`), so a part built for the browser often fits.

**Artifact:** one executable reports its engine and bundled TypeScript, then refuses an environment read that no flag granted. Both outputs are from the lab ✅[^run].
```console
$ deno --version
deno 2.9.8 (stable, release, aarch64-unknown-linux-gnu)
v8 15.0.245.2-rusty
typescript 6.0.3
$ echo 'console.log(Deno.env.get("HOME"))' | deno run -
error: Uncaught (in promise) NotCapable: Requires env access to "HOME", run again with the --allow-env flag
```

**Terms used below:**

| Term | Plain-English analogy | Concrete artifact |
|---|---|---|
| V8 | The car's engine: it executes JavaScript and nothing else | `v8 15.0.245.2-rusty` in `deno --version` ✅[^run] |
| Rust | The chassis the engine is bolted to: the language Deno's own code is written in | the `deno_core` crate, whose main dependency is the V8-Rust bindings `rusty_v8` ✅[^core] |
| Tokio | A dispatcher that holds waiting jobs (timers, sockets, file reads) and calls back when each is done | the Rust future executor (Tokio or smol) that must drive `JsRuntime::run_event_loop` ✅[^core] |
| Op | A service hatch between JavaScript and Rust: JavaScript passes a request through, Rust does the work | Rust functions registered into JavaScript with `deno_core::extension!` ✅[^core]; the frame `ext:deno_fs/30_fs.js` in a `NotCapable` stack trace is Deno's own JavaScript for the file-system API, an `ext:` module ✅[^run] |
| Permission | A key card for one door | `--allow-read=name.txt`, which let the worked example below read exactly that file ✅[^run] |
| Web-standard API | A plug shape every browser also uses | `typeof fetch`, `typeof Request` and `typeof Response` are `"function"` in 2.9.8 ✅[^run] |

## How it works

### The pieces when `deno run --allow-read=name.txt greet.ts` starts
**4 actors:**
- **Deno CLI** (command-line interface) — its job: read the subcommand, the flags and the file name, via the argument parser inside the `deno` executable.
- **Module loader** — its job: find, fetch, cache and transpile every module the program imports, via the file system, HTTP(S) (HyperText Transfer Protocol, plain or Secure) and the `DENO_DIR` cache.
- **V8** — its job: execute the resulting JavaScript, via a `JsRuntime` built on the `rusty_v8` bindings.
- **Ops on Tokio** — its job: do the privileged and asynchronous work JavaScript asks for, via Rust functions registered as ops and an event loop driven by Tokio.

```
[Deno CLI — local]        [Module loader — local]          [V8 — local]              [Ops + Tokio — local]
deno run --allow-read=name.txt greet.ts
  │ parse flags → permission set {read: name.txt}
  └──────────────────────▶ read greet.ts, resolve imports
                            │  (remote import? ═══ network boundary ═══ download once, cache)
                            │ strip TypeScript types (no type check by default)
                            └─────────────────────────▶ run JavaScript
                                                         │ Deno.readTextFile("./name.txt")
                                                         └───────────────────▶ permission granted?
                                                                                 no → NotCapable error
                                                                                 yes → async read on the event loop
                                                         ◀───────────────────── promise resolves with the text
```

1. **Deno CLI (local):**
   - Reads `run`, `--allow-read=name.txt` and `greet.ts` from the command line.
   - Builds the permission set: read access to `name.txt` and nothing else. With no flag, every sensitive API (file system, network, environment) stays closed ✅[^security].
2. **Module loader (local; the network only for remote imports):**
   - Reads `greet.ts` and resolves its imports. A remote module is downloaded on first use and cached; the lab printed `Download http://127.0.0.1:4507/hello.ts` once, then ran it ✅[^run].
   - Turns TypeScript into JavaScript. It does not type-check unless asked with `--check` or `deno check` ✅[^ts]; the details are in `deno/fundamentals/running-code-and-typescript.md` and `deno/internals/module-loading-and-type-checking.md`.
3. **V8 (local):** executes the JavaScript. In `deno_core`, `JsRuntime` is the abstraction that executes JavaScript ✅[^core].
4. **Ops (local):** `Deno.readTextFile("./name.txt")` crosses from JavaScript into Rust. The call is refused unless the permission set grants it ✅[^security]; without the flag the lab got `NotCapable ... at Object.readTextFile (ext:deno_fs/30_fs.js:1:10048)`, with it the file was read ✅[^run].
5. **Tokio (local):** an asynchronous op is a pending task. The `JsRuntime` event loop keeps track of all pending tasks (async ops, dynamic module loads) and runs inside a Rust future executor such as Tokio ✅[^core]. When the read finishes, the promise in JavaScript resolves.

### Five design choices

| Choice | What it means in Deno 2.9.8 | Seen in the lab |
|---|---|---|
| One executable | "a single binary executable with no external dependencies", for macOS, Linux and Windows on x64 and arm64 ✅[^install] | `/bin/deno`, 85,616,329 bytes, ran, type-checked, tested, formatted and linted code with the network switched off ✅[^run] |
| Secure by default | Code runs with no file, network or environment access until you grant it ✅[^start] ✅[^security] | `NotCapable` for an unflagged environment read and file read ✅[^run] |
| Web standards first | Deno uses standard web platform APIs such as `fetch` and WebSockets ✅[^webapis]; its server API takes a `Request` and returns a `Response` ✅[^start] | `fetch`, `Request`, `URL`, `URLPattern` and `Temporal` exist; `document` and `window` do not ✅[^run] |
| TypeScript built in | `.ts` files run directly: no `tsc`, no build step, no config ✅[^start] | the executable bundles TypeScript 6.0.3 ✅[^run] |
| All-in-one toolchain | a built-in formatter, linter, test runner, benchmarking and more ✅[^start], grouped as execution, dependency management and tooling subcommands ✅[^cli] | `deno --help` lists 48 entries: 47 subcommands from `run` to `x`, plus `help`; one of them, `vendor`, only says it was removed in Deno 2 ✅[^run] |

### Deno and Node.js at a glance

| Topic | Deno 2.9.8 | Node.js 26 |
|---|---|---|
| Engine | V8, with a Rust core and Tokio ✅[^readme] | the V8 version built into the Node.js binary ✅[^node-v8] |
| Default access | none until a flag grants it ✅[^security] | restricted only when started with `--permission`, a stable feature ✅[^node-perm] |
| TypeScript | runs `.ts` directly ✅[^start]; type-checks only with `deno check` or `deno run --check` ✅[^ts] | runs files with only erasable TypeScript syntax, and "no type checking is performed" ✅[^node-ts] |
| How a `.js` file is read | as an ES module; it is CommonJS only as `.cjs` or under a `package.json` with `"type": "commonjs"` ✅[^node] | as CommonJS unless `"type": "module"` is set or ES module syntax is detected ✅[^node-pkg] |
| Toolchain | formatter, linter, test runner, benchmarks, type checker, compiler, doc generator in one executable ✅[^cli] | a built-in test runner, `node --test` ✅[^node-test] |

Points only Deno has: `npm:` and `jsr:` import specifiers, a global package cache with no `node_modules` folder when the project has no `package.json`, and npm lifecycle scripts that do not run unless allowed ✅[^node]. How far Node.js compatibility goes is in `deno/node-compat/node-and-npm-compatibility.md`.

### Getting the executable
Every command below is from the official installation page ✅[^install]; the lab cannot run them because its network is off, so only `deno --version` was run there.

| Where | Command |
|---|---|
| macOS, Linux (shell script) | `curl -fsSL https://deno.land/install.sh \| sh` |
| Windows (PowerShell) | `irm https://deno.land/install.ps1 \| iex` |
| Homebrew / MacPorts / Nix | `brew install deno` / `sudo port install deno` / `nix-shell -p deno` |
| Scoop / Chocolatey / Winget | `scoop install deno` / `choco install deno` / `winget install DenoLand.Deno` |
| asdf / vfox | `asdf plugin add deno https://github.com/asdf-community/asdf-deno.git`, then `asdf install deno latest` / `vfox add deno`, then `vfox install deno@latest` |
| Cargo (build from source) | `cargo install deno --locked` |
| npm | `npm install -g deno` (works, but can slow Deno's startup) |
| Docker | official images in `debian`, `ubuntu`, `alpine`, `distroless` and `bin` variants |
| Manual | download the zip for the platform from the GitHub releases page, check it against its `.sha256sum` file, put `deno` on `PATH` |

- **Verify:** `deno --version` prints the version; `command not found` usually means the install folder is not on `PATH` yet, and a new terminal fixes it ✅[^install].
- **Upgrade:** `deno upgrade` fetches the latest release and replaces the current executable; `deno upgrade --version 2.7.0` installs one version; a package-manager install has its own command (`brew upgrade deno`, `scoop update deno`, `choco upgrade deno`, `winget upgrade DenoLand.Deno`) ✅[^install]. Release channels and the support timeline are in `deno/releases-stability-and-support.md`.

## Worked example
A two-file project shows the sandbox, built-in TypeScript, the global `Temporal` API and four toolchain commands, in one container with the network off ✅[^run].

```ts
// greet.ts
export function greet(name: string): string {
  return `Hello, ${name}! Today is ${Temporal.Now.plainDateISO("UTC")}.`;
}
if (import.meta.main) {
  const name = await Deno.readTextFile("./name.txt"); // name.txt holds "Ada"
  console.log(greet(name.trim()));
}
```
`greet_test.ts` calls `Deno.test("greet starts with Hello", …)`, and `messy.ts` holds `const   x=1` / `let y = 2` / `console.log(x)`.

| Step | Command | Output (2026-11-24) | Exit |
|---|---|---|---|
| 1 | `deno run greet.ts` | `error: Uncaught (in promise) NotCapable: Requires read access to "./name.txt", run again with the --allow-read flag` | 1 |
| 2 | `deno run --allow-read=name.txt greet.ts` | `Hello, Ada! Today is 2026-11-24.` | 0 |
| 3 | `deno check greet.ts` | `Check greet.ts` | 0 |
| 4 | `deno test` | `greet starts with Hello ... ok (5ms)`, then `ok \| 1 passed \| 0 failed (16ms)` | 0 |
| 5 | `deno fmt --check` | a diff for `messy.ts` (`const x = 1;`, `let y = 2;`), then `error: Found 1 not formatted file in 3 files` | 1 |
| 6 | `deno lint` | ``error[no-unused-vars]: `y` is never used`` and ``error[prefer-const]: `y` is never reassigned``, then `Found 2 problems` | 1 |

Nothing was installed besides the `deno` executable, and no step needed the network ✅[^run].

## Edge cases

| Case | What happens | Why |
|---|---|---|
| A library tests `typeof window` to detect a browser | It sees `"undefined"` and takes its non-browser path ✅[^run] | `window` is gone in Deno 2; use `globalThis` or `self` ✅[^v2rc] |
| `deno run -A` (or `--allow-all`) | Every permission is granted and the sandbox is off ✅[^security] | `-A` is all keys at once |
| `--allow-run` or `--allow-ffi` granted | A child process runs with its own permissions, and native code can make system calls directly, both outside the sandbox ✅[^security] | Those processes and that native code do not pass through Deno's permission checks |
| `eval`, `new Function`, dynamic import or a worker on the same thread | Runs with the same privileges as the caller ✅[^security] | All code on one thread shares one privilege level |
| Deno installed with `npm install -g deno` | It works, but the docs warn it can slow Deno's startup ✅[^install] | The docs recommend the shell or PowerShell script instead |
| Deno from a Linux distribution's package manager | Often older than the latest release ✅[^install] | Those packages are community maintained; there is no official apt repository |
| Windows older than 10 version 1709 (or Windows Server 2016 version 1709) | Not supported ✅[^install] | The minimum Windows version the docs list |
| `deno compile` with no network | Fails: it downloads `https://dl.deno.land/release/v2.9.8/denort-aarch64-unknown-linux-gnu.zip` as its base binary ✅[^run] | "One executable" covers running code, not every subcommand; see `deno/advanced/compile-and-distribution.md` |

## Trade-offs

| Option | Gains | Costs |
|---|---|---|
| Deny-by-default permissions | A dependency cannot read files, the network or the environment unless you allowed it ✅[^security] | Every script needs explicit flags; reaching for `-A` turns the protection off entirely ✅[^security] |
| Built-in toolchain | One install formats, lints, tests and benchmarks ✅[^start] | A large executable: 85,616,329 bytes on aarch64 Linux ✅[^run] |
| Web-standard APIs | Code written against `fetch`, `Request` and `Response` uses the same APIs as browsers ✅[^webapis] | No DOM (Document Object Model): `document` is not defined at run time ✅[^run] |
| TypeScript with no build step | `.ts` runs directly ✅[^start] | `deno run` does not stop on type errors; only `--check` or `deno check` does ✅[^ts] |

## Takeaways
- Grant the narrowest permission a script needs (`--allow-read=name.txt`), and never ship a command line with `-A`. [rule-candidate]
- Detect the environment by feature (`typeof Deno !== "undefined"`, `"document" in globalThis`), never by `window`. [rule-candidate]
- Use `deno fmt`, `deno lint`, `deno test` and `deno check` before adding npm tools that do the same job.
- Install with the official script or a package manager, not `npm install -g deno`, and upgrade through whichever one installed it.

## Verification status
- Verified: 74 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`, with `--network none` (a small `Deno.serve` server inside the same container stood in for remote modules); outputs as quoted in Summary, Problem, Mental model, How it works, Worked example, Edge cases and Trade-offs. [^run]
- [Get started with Deno](https://docs.deno.com/runtime/) — Deno project, living. Rank 1. Backs: secure by default, `.ts` with no build step, built-in toolchain, the `Request`/`Response` server API. [^start]
- [Installation](https://docs.deno.com/runtime/getting_started/installation/) — Deno project, living. Rank 1. Backs: single binary with no external dependencies, platforms, every install command, verify and upgrade commands, npm and distribution-package caveats. [^install]
- [Security and permissions](https://docs.deno.com/runtime/fundamentals/security/) — Deno project, living. Rank 1. Backs: no access without flags, `-A`, `--allow-run`/`--allow-ffi` outside the sandbox, one privilege level per thread. [^security]
- [TypeScript support](https://docs.deno.com/runtime/fundamentals/typescript/) — Deno project, living. Rank 1. Backs: no type check by default, `deno check`, `--check`. [^ts]
- [Web Platform APIs](https://docs.deno.com/runtime/reference/web_platform_apis/) — Deno project, living. Rank 1. Backs: Deno uses standard web platform APIs such as `fetch` and WebSockets. [^webapis]
- [Node and npm Compatibility](https://docs.deno.com/runtime/fundamentals/node/) — Deno project, living. Rank 1. Backs: CommonJS rules, `npm:` specifiers, global cache, lifecycle scripts. [^node]
- [Deno CLI Subcommands](https://docs.deno.com/runtime/reference/cli/) — Deno project, living. Rank 1. Backs: the toolchain's subcommand groups. [^cli]
- [denoland/deno](https://github.com/denoland/deno) — Deno project, living. Rank 1. Backs: a JavaScript, TypeScript and WebAssembly runtime built on V8, Rust and Tokio. [^readme]
- [Deno Core Crate README (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/core/README.md) — Deno project, 2026. Rank 1. Backs: `rusty_v8`, `JsRuntime`, the event loop of pending async ops driven by Tokio, ops registered with `deno_core::extension!`. [^core]
- [Announcing Deno 2](https://deno.com/blog/v2.0) — Deno project, 2024. Rank 1. Backs: Deno 2 is backwards compatible with Node and npm. [^v2]
- [Deno 2.0 Release Candidate](https://deno.com/blog/v2.0-release-candidate) — Deno project, 2024. Rank 1. Backs: `window` is gone; use `globalThis` or `self`. [^v2rc]
- [V8 — Node.js v26.13.1 Documentation](https://nodejs.org/api/v8.html) — Node.js project, living. Rank 1. Backs: Node.js has V8 built into its binary. [^node-v8]
- [Permissions — Node.js v26.13.1 Documentation](https://nodejs.org/api/permissions.html) — Node.js project, living. Rank 1. Backs: `--permission` restricts access; stable. [^node-perm]
- [Modules: TypeScript — Node.js v26.13.1 Documentation](https://nodejs.org/api/typescript.html) — Node.js project, living. Rank 1. Backs: erasable TypeScript runs by default with no type checking. [^node-ts]
- [Modules: Packages — Node.js v26.13.1 Documentation](https://nodejs.org/api/packages.html) — Node.js project, living. Rank 1. Backs: `.js` is CommonJS unless `"type": "module"` or ES module syntax is detected. [^node-pkg]
- [Test runner — Node.js v26.13.1 Documentation](https://nodejs.org/api/test.html) — Node.js project, living. Rank 1. Backs: `node --test`. [^node-test]

## Related
- `deno/fundamentals/running-code-and-typescript.md` — `deno run`, the REPL, `deno eval` and type checking.
- `deno/fundamentals/web-platform-apis.md` — every web API and global in Deno 2.9.
- `deno/security/permission-model.md` — how permissions are granted, denied and prompted.
- `deno/releases-stability-and-support.md` — release channels, `deno upgrade` and the support timeline.
- `deno/internals/runtime-architecture.md` — `deno_core`, ops, resources and the Tokio event loop in depth.
- `deno/deno-lab-setup.md` — the container every output above came from.
