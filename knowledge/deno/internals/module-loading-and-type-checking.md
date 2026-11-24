---
schema: knowledge-doc/v1
type: concept
topic: deno/internals
status: verified
applies-to: ["Deno 2.9.8", "TypeScript 6.0.3 (bundled)", "deno_graph 0.111.1", "deno_ast 0.53.3"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, internals, module-graph, deno_graph, deno_ast, swc, resolution, jsr, remote-cache, deno-dir, emit-cache, gen, transpile, type-checking, tsc, deno-check, fast-check, tsbuildinfo, v8-code-cache, tsgo, syntax-error]
ranked-sources: true
---

# What runs before line 1: Deno's module graph, emit cache and type checking

## Summary
**TL;DR:** Before `deno run main.ts` executes anything, Deno builds the whole static module graph with `deno_graph`. It resolves every import, reads local files, downloads remote ones once into `DENO_DIR/remote`, and parses each module with `deno_ast` (the swc parser) to find the next imports. A syntax error or a missing module anywhere in that graph stops the program before line 1. Type checking runs only with `--check` or `deno check`, in a second V8 isolate that runs the bundled TypeScript 6.0.3 compiler; a clean result is cached by hash. Then each module is loaded: its types are stripped by swc, the JavaScript is cached in `DENO_DIR/gen`, and V8 compiles it with a code cache. Measured: a first run of 1.0–1.7 s (downloads), about 16 ms warm, a first `deno check` of about 2 s, and 0.04 s when cached.
**Use this when:** you need to know which stage produced an error; a type error did not stop the program, or a syntax error in a rarely used file did; the first run is slow and later ones are fast; you look inside `DENO_DIR/gen` or `remote`; `--check` missed a dynamically imported file.
**Not this doc:** how to use `deno check`, `--check`, `compilerOptions` and JSX → `deno/fundamentals/running-code-and-typescript.md`; specifier kinds and import maps → `deno/modules/module-specifiers-and-imports.md`; the lockfile, `--reload`, `deno clean` and `DENO_DIR` management → `deno/modules/dependency-management.md`; ops and the event loop after line 1 → `deno/internals/runtime-architecture.md`; slow types from the publisher's side → `deno/std-and-jsr/jsr-and-publishing.md`.

## Problem
People expect TypeScript to work as in a compile-then-run toolchain, and Deno breaks that in four ways. `deno run` prints a type error's output and exits 0. A syntax error in a module that is imported but never called still stops the program before its first `console.log`. The first run takes over a second and later runs take about 20 ms. `--check` passes code that imports a file with a type error through a computed `import()`. Without the stage map, people clear the wrong cache, blame V8 for parser messages, or ship type errors because `deno run` "worked".

## Mental model
**Analogy:** a print shop taking a book order. The clerk (resolver) turns each "see chapter X" into a shelf address. The runner (file fetcher) brings any missing chapter from the publisher once and files a copy in the stockroom (`remote/`). The editor (graph builder) skims every chapter only to find its cross-references, and a page that cannot be read at all stops the job. The proofreader (type checker) reads for meaning only when the customer pays for it (`--check`). The typesetter (emitter) crosses out the margin notes (types) and keeps the clean copy (`gen/`), and the press (V8) prints from it.

**Artifact:** the graph for a two-file program that imports `jsr:@std/path@1/join` ✅[^run]:
```console
$ deno info main.ts
local: /lab/main.ts
type: TypeScript
dependencies: 17 unique
size: 20.42KB

file:///lab/main.ts (117B)
├─┬ https://jsr.io/@std/path/1.1.6/join.ts (1.21KB)
│ ├─┬ https://jsr.io/@std/internal/1.0.14/os.ts (232B)
│ │ └── https://jsr.io/@std/internal/1.0.14/_os.ts (535B)
│ ├─┬ https://jsr.io/@std/path/1.1.6/posix/join.ts (1.55KB)
│ │ ├── https://jsr.io/@std/path/1.1.6/_common/assert_path.ts (288B)
...
│   └── https://jsr.io/@std/path/1.1.6/windows/from_file_url.ts *
└── file:///lab/greet.ts (74B)
```
`deno info --json` gives the same graph as data. It has `roots`, `modules` (each with `specifier`, `local`, `mediaType`, `dependencies` and their source spans), `redirects` (`"jsr:@std/path@1/join": "https://jsr.io/@std/path/1.1.6/join.ts"`), `packages` (`"@std/path@1": "@std/path@1.1.6"`) and `npmPackages` ✅[^run]. In the tree, `*` marks a module already printed higher up ✅[^run].

| Term | Plain-English picture | Concrete artifact in 2.9.8 |
|---|---|---|
| Module graph | The book's table of contents, with every cross-reference followed | `ModuleGraph::new(GraphKind::All)` then `.build(roots, loader, …)` ✅[^graph-readme] |
| Specifier resolution | Turning "see chapter X" into a shelf address | `jsr:@std/path@1/join` → `https://jsr.io/@std/path/1.1.6/join.ts` ✅[^run] |
| Remote cache | The stockroom of fetched chapters | `/deno-dir/remote/https/jsr.io/da88f2…639a` = SHA-256 (Secure Hash Algorithm, 256-bit) of `/@std/internal/1.0.14/_os.ts` ✅[^run] ✅[^cache-dir] |
| Emit (transpile) | The clean copy with margin notes crossed out | `/deno-dir/gen/file/lab/greet.ts.js` = `export function greet(name) {` ✅[^run] |
| Emit cache | The shelf of clean copies, each with a seal | last line `// denoCacheMetadata=5503007453377772694,15629656892083532577` ✅[^run] ✅[^emit-cache] |
| Type check | The proofread, only on request | `Check main.ts`, then `TS2322 [ERROR]` or nothing ✅[^run] |
| Check cache | The "already proofread" stamp | `/deno-dir/check_cache_v2` ✅[^deno-dir] |
| Fast check | Proofreading a library from its declared signatures only | debug line `Analyzing '@std/path@1.1.6' for fast check` ✅[^run]; "fast check avoids type inference" ✅[^slow-types] |
| V8 code cache | Bytecode kept from last time, so V8 skips parse and compile | `/deno-dir/v8_code_cache_v2`; debug `V8 code cache hit for ES module: file:///lab/main.ts` ✅[^run] ✅[^v8-cache] |

## How it works

**7 actors:**
- **The CLI (command-line interface) module loader** — its job: run the stages in order, via `prepare_module_load` in `cli/module_loader.rs`, called before any root is loaded.
- **The resolver** — its job: turn each import string into a URL, via `deno_graph`'s `Resolver` trait, which the CLI fills with import maps, `jsr:` and `npm:` rules.
- **The file fetcher** — its job: read local files and download remote ones once, via `FileFetcher` in `libs/cache_dir` and the `remote/` cache.
- **`deno_graph`** — its job: parse each module and collect its dependencies, via `ModuleGraph::build` and `deno_ast` (swc).
- **The type checker** — its job: run TypeScript when asked, via `TypeChecker::check`, which calls `tsc::exec` in a second `JsRuntime`.
- **The emitter** — its job: strip types to plain JavaScript, via `deno_ast` transpile and the `gen/` cache.
- **V8, through `deno_core`'s module map** — its job: compile, link and run each module, via the V8 code cache.

```
deno run main.ts
  │ CLI: prepare_module_load ─ "Preparing module load." / "Building module graph."
  ▼
[resolver] ─ jsr:@std/path@1/join ─▶ [file fetcher] ─ cached? ─ yes ─▶ remote/https/jsr.io/<sha256>
                                         │ no
                                         │ import permission check ("Granted import access to "jsr.io:443"")
                                         │ ═══════════ network boundary ═══════════
                                         ▼
                              GET https://jsr.io/@std/path/meta.json → 1.1.6_meta.json → 1.1.6/join.ts
  ▼
[deno_graph + deno_ast/swc] parse → imports found → loop until no new specifiers
  │ any module error (syntax, not found) ──▶ "error: …" exit 1, nothing has run
  ▼
[type checker] only if --check / deno check, and only for the first graph
  │ check hash in check_cache_v2? ─ yes ─▶ skip, no "Check" line
  │ no ─▶ "Check main.ts" → TypeScript 6.0.3 in a second isolate → diagnostics → exit 1, or record hash
  ▼
per module, as V8 asks for it:
[emitter] gen/ hit (source hash + emit hash) ─ or ─ swc transpile → write gen/…js
  ▼
[V8] compile (+ v8_code_cache_v2) → link → evaluate → first line runs
```

1. **CLI (local).** `deno run` resolves the main module, logs `main_module file:///lab/main.ts`, then calls `prepare_module_load`. That function builds the graph, validates the roots, type-checks "if necessary" and writes the lockfile, in that order ✅[^ml] ✅[^run].
2. **Resolver and file fetcher (local first, then network).**
   - Local files are read through `FileFetcher::fetch_no_follow` ✅[^run].
   - A `jsr:` specifier is resolved through the registry's `<package>/meta.json`, then `<package>/<version>_meta.json` ✅[^graph-jsr]. The debug log shows exactly those two downloads before `https://jsr.io/@std/path/1.1.6/join.ts` ✅[^run].
   - Every remote fetch first passes an import permission check: `Granted import access to "jsr.io:443"`, with no flag given ✅[^run]. `--allow-import` has a default host list ✅[^check-doc].
   - This is where anything leaves the machine, and only on a cache miss. A warm run logs `fetch_cached_no_follow` and nothing else for remote modules ✅[^run].
   - A downloaded file is stored at `remote/<scheme>/<host>/<SHA-256 of path and query>` ✅[^cache-dir], followed by a line `// denoCacheMetadata={"headers":{…},"url":"https://jsr.io/@std/internal/1.0.14/_os.ts","time":…}` ✅[^cache-file] ✅[^run].
3. **`deno_graph` (local work on the CPU, the central processing unit).**
   - `build` "will load and parse the root module and recursively all of its dependencies" ✅[^graph-readme].
   - Parsing uses `deno_ast` ✅[^ast-readme], built on `swc_ecma_parser` 27.0.7 in the 0.53.3 release Deno 2.9.8 pins ✅[^ast-cargo] ✅[^deno-cargo].
   - An `import()` whose argument is not a string or template literal is recorded as an unanalyzable expression and not followed ✅[^graph-analysis]. Such an import is checked against permissions only when it runs ✅[^modules-doc].
   - Per-module dependency facts are cached in `dep_analysis_cache_v2` (debug: `Caching module info for https://jsr.io/@std/path/1.1.6/join.ts`) ✅[^run] ✅[^deno-dir]. When an entry exists, `deno_graph` can skip parsing that module ✅[^module-info].
4. **CLI validates the graph (local).** A module error surfaces here as `error: …` with the file and position, exit code 1, before any user code runs ✅[^run].
5. **Type checker (local; only with `--check`, `deno check`, `deno test` or `deno bench`)** ✅[^ts-doc].
   - It runs only when the type-check mode is on, and only the first time the graph is built, so modules added later by a dynamic import are not checked ✅[^ml]. `deno run` skips the stage by default ✅[^ts-doc].
   - JSR (the JavaScript Registry) packages first go through a "fast check graph" (debug: `Building fast check graph`) ✅[^run]. The checker then prefers each module's fast-check dependencies ✅[^tc].
   - If the graph's check hash is already in `check_cache_v2`, the checker returns without printing `Check` ✅[^tc] ✅[^run].
   - Otherwise it prints `Check <root>` and calls `tsc::exec` ✅[^tc]. That call starts a new `JsRuntime` from the CLI snapshot with the `deno_cli_tsc` extension. The compiler runs as `ext:deno_cli_tsc/00_typescript.js` and asks Rust for files and resolutions through the ops `op_load` and `op_resolve`, then answers through `op_respond` ✅[^tsc-js]. The compiler source is embedded in the binary as `tsc/00_typescript.js`, zstd-compressed (Zstandard) when the build compresses it ✅[^tsc-mod].
   - The options it used in the lab included `"strict":true`, `"noEmit":true`, `"isolatedModules":true`, `"incremental":true`, `"target":"esnext"`, `"module":"NodeNext"` and `"lib":["deno.window","deno.unstable","node"]` ✅[^run].
   - The checker stores the compiler's `.tsbuildinfo` for the first root. It adds the check hash only when there were no diagnostics ✅[^tc].
6. **Emitter (local; per module, when V8 asks for it).**
   - Only emittable media types are transpiled; JavaScript passes through unchanged ✅[^emit]. In the lab, a `.ts` file importing `./plain.js` left only `gen/file/lab/usejs.ts.js` ✅[^run].
   - The cache key is a hash of the source and the transpile options. A `gen/` file is accepted only if its first number matches that source hash and its second number matches a hash of the content plus the CLI version ✅[^emit] ✅[^emit-cache].
   - On a miss, `deno_ast` transpiles and the result is written with that trailer ✅[^emit]. "Deno strips the types and hands the resulting JavaScript to V8" ✅[^ts-doc].
   - Import specifiers stay as written. `gen/file/lab/main.ts.js` still says `import { join } from "jsr:@std/path@1/join";` and carries an inline source map ✅[^run].
7. **V8 through `deno_core` (local).** For each JavaScript module the loader looks up a V8 code cache entry by a hash of the code ✅[^ml]. A hit is logged as `V8 code cache hit for ES module` (ES = ECMAScript, the language standard). After evaluation, missing entries are written (`Updating V8 code cache for ES module`) ✅[^run]. Code caching stores "the result of parsing + compilation" ✅[^v8-cache]. `--no-code-cache` turns it off ✅[^check-doc].

| Stage | Skipped when | Cache in `DENO_DIR` | Typical error |
|---|---|---|---|
| Fetch | already cached | `remote/`, `npm/` | network or `Module not found` |
| Parse (graph) | module info cached ✅[^module-info] | `dep_analysis_cache_v2` | `SyntaxError: Expression expected` |
| Type check | no `--check`; or hash cached | `check_cache_v2`, `fast_check_cache_v2` | `TS2322 [ERROR]` |
| Emit | JavaScript file; or `gen/` hit | `gen/` | — |
| Compile | code cache hit | `v8_code_cache_v2` | runtime exceptions only |

(Cache names from `deno_dir.rs` ✅[^deno-dir] and the lab listing ✅[^run].)

## Worked example
One container, so the cache survives between commands ✅[^run]:

| Command | Result |
|---|---|
| `deno run main.ts`, empty `DENO_DIR` | 20 lines of the form `Download <jsr.io URL>`, prints `hello a/b`; 1.73 s, 1.02 s and 1.06 s in three fresh containers |
| `deno info main.ts` | Downloads the graph but emits nothing: `gen/` does not exist afterwards |
| `deno run main.ts` after `deno info` | Emits only: 0.14 s, 0.05 s, 0.06 s |
| `deno run main.ts`, warm | 0.05 s, 0.02 s, 0.02 s; twenty runs of `local.ts` took 0.33 s, about 16.5 ms each |
| `find /deno-dir/gen -type f` | `gen/file/lab/greet.ts.js`, `gen/file/lab/main.ts.js` and 16 files `gen/https/jsr.io/<hash>.js`, the same hash as each module's `remote/` file |
| `deno check main.ts`, first (graph already downloaded) | `Check main.ts`, 2.46 s. Debug statistics: `Files: 165`, `Parse time: 1286`, `Check time: 51`, `Total TS time: 1625` (no unit printed) |
| `deno check main.ts`, again | No output, 0.17 s |
| after appending a comment to `greet.ts` | `Check main.ts` again, 1.98 s |
| twenty `deno run --check local.ts`, check cached | 0.47 s, about 23.5 ms each |

Most of the 165 files are bundled library declarations: 162 of the 223 `getSourceFile` calls in the debug log were for `asset:///` files such as `lib.deno.window.d.ts`, `lib.es2025.d.ts` and `node/*.d.cts`. That is why a two-file program pays about 2 s on its first check ✅[^run].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `const n: number = "not a number"` with `deno run` | Prints `first line ran not a number`, exit 0 ✅[^run] | No type check unless asked ✅[^ts-doc] |
| Same file with `deno run --check` | `TS2322 [ERROR]: Type 'string' is not assignable to type 'number'.`, `error: Type checking failed.`, an `info:` line, a `hint:` to use `--no-check`, exit 1 ✅[^run] | The check stage runs before evaluation ✅[^ml] |
| Same file with `deno check` | Same diagnostic and `error: Type checking failed.`, no `info:`/`hint:` lines, exit 1 ✅[^run] | `deno check` plays the role of `tsc --noEmit` ✅[^ts-doc] |
| `const x = ;` on line 2 of a `.ts` or `.js` file | `error: SyntaxError: Expression expected` at `2:11`; line 1's `console.log("before")` never prints; `deno run`, `deno check` and `deno info` all report it ✅[^run] | The graph's swc parser rejects it ✅[^ast-cargo]; V8's own parser words it differently (`new Function("const x = ;")` → `SyntaxError: Unexpected token ';'`) ✅[^run] |
| `deno info --json` on that file | Exit 0; the module entry has `"error": "SyntaxError: Expression expected…"` ✅[^run] | Graph errors are data in the JSON (JavaScript Object Notation) form |
| `import "./nope.ts"` | `error: Module not found "file:///tmp/nope.ts".` `at file:///tmp/missing.ts:1:8`, exit 1, before line 1 ✅[^run] | Graph validation ✅[^ml] |
| `await import("./syntax" + "err.ts")` | Line 1 runs; the import rejects with a `TypeError` whose message is `SyntaxError: Expression expected`; without `--allow-read`, a `TypeError` `Requires read access to "/lab/syntaxerr.ts"` ✅[^run] | Not in the static graph ✅[^graph-analysis]; computed specifiers face permissions at run time ✅[^modules-doc] |
| Same computed `import()` of the type-error file, `deno run --check` | `Check dyntype.ts`, then it runs to the end, exit 0 ✅[^run] | Only the first graph is checked ✅[^ml] |
| `await import("./typeerr.ts")` (string literal), `--check` | Fails with TS2322, exit 1 ✅[^run] | Literal dynamic imports are part of the graph ✅[^graph-analysis] |
| A failing check, run twice | `Check typeerr.ts` prints both times ✅[^run] | The hash is stored only when there are no diagnostics ✅[^tc] |
| Editing a `gen/` file by hand | Ignored and rewritten; the program printed the original output ✅[^run] | Its emit hash no longer matches ✅[^emit-cache] |
| `DENO_EMIT_CACHE_MODE=disable` | Runs normally, no `gen/` folder is created ✅[^run] | Read in `EmitCache::new` ✅[^emit-cache]; not on the documented variable list ✅[^envvars] |
| `--unstable-tsgo` or `DENO_UNSTABLE_TSGO=1` | Accepted, but the debug log shows the bundled `ext:deno_cli_tsc/00_typescript.js` running, and no compiler was downloaded (container without network) ✅[^run] | The docs say it type-checks "with TypeScript's native (Go) compiler" ✅[^envvars] ✅[^ts-doc] and the README describes a subprocess backend ✅[^tsc-readme]; in v2.9.8, `tsc::exec` calls only the JavaScript backend ✅[^tsc-mod]; the flag is defined ✅[^features] |
| `NO_COLOR=1` and a failed `deno run --check` | The `info:` and `hint:` lines still contain ANSI (American National Standards Institute) colour codes ✅[^run] | Observed in 2.9.8; the diagnostic itself is plain |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `deno run` (default, no check) | Fastest start, about 16 ms warm ✅[^run] | Type errors never reported ✅[^ts-doc] |
| `deno run --check` | Local type errors stop the run before line 1; about 23.5 ms warm when cached ✅[^run] | About 2 s on a cache miss; misses computed `import()`; remote code only with `--check=all` ✅[^ts-doc] ✅[^run] |
| `deno check` in CI (continuous integration) | Same check without running; `--all` adds remote and npm code ✅[^check-doc] | One more step |
| Emit and code caches on (default) | No re-transpile or re-compile on warm runs ✅[^run] | Disk space; clean with `deno clean` (→ `deno/modules/dependency-management.md`) |

## Takeaways
- Run `deno check` (or `deno run --check`) in CI: `deno run` alone never reports a type error. [rule-candidate]
- Write `import()` with a string literal whenever the target is known, so the graph, the type checker and the up-front permission model see it. [rule-candidate]
- A syntax error in any statically imported file fails the whole program before line 1, even if that code path is never used.
- Read `SyntaxError: Expression expected` as a graph-stage (swc) error, and `Unexpected token` as a V8 runtime error.
- Do not edit `DENO_DIR/gen` or `remote` by hand; Deno rejects changed emits. Use `--reload` or `deno clean`.
- Do not count on `--unstable-tsgo` in 2.9.8; the lab run still used the bundled TypeScript.

## Verification status
- Verified: 105 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example, Edge cases and Trade-offs. [^run]
- [cli/module_loader.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/cli/module_loader.rs) — Deno project, 2026. Rank 1. Backs: `prepare_module_load` order, check only for the first graph, code-cache lookup. [^ml]
- [cli/cache/module_info.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/cli/cache/module_info.rs) — Deno project, 2026. Rank 1. Backs: cached module info lets `deno_graph` skip parsing. [^module-info]
- [cli/type_checker.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/cli/type_checker.rs) — Deno project, 2026. Rank 1. Backs: check hash, `Check` line, `.tsbuildinfo`, fast-check dependencies. [^tc]
- [cli/tsc/mod.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/cli/tsc/mod.rs) — Deno project, 2026. Rank 1. Backs: compressed TypeScript source; `exec` calls the JavaScript backend only. [^tsc-mod]
- [cli/tsc/js.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/cli/tsc/js.rs) — Deno project, 2026. Rank 1. Backs: second `JsRuntime`, `deno_cli_tsc` extension, `op_load`/`op_resolve`/`op_respond`. [^tsc-js]
- [cli/tsc/README.md (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/cli/tsc/README.md) — Deno project, 2026. Rank 1. Backs: described TypeScript Go subprocess backend. [^tsc-readme]
- [runtime/features/data.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/runtime/features/data.rs) — Deno project, 2026. Rank 1. Backs: `tsgo` unstable feature and `DENO_UNSTABLE_TSGO`. [^features]
- [libs/resolver/emit.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/resolver/emit.rs) — Deno project, 2026. Rank 1. Backs: emittable media types, source hash, `deno_ast` transpile. [^emit]
- [libs/resolver/cache/emit.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/resolver/cache/emit.rs) — Deno project, 2026. Rank 1. Backs: `denoCacheMetadata` trailer, emit hash with CLI version, `DENO_EMIT_CACHE_MODE`. [^emit-cache]
- [libs/resolver/cache/deno_dir.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/resolver/cache/deno_dir.rs) — Deno project, 2026. Rank 1. Backs: names of the `DENO_DIR` caches. [^deno-dir]
- [libs/cache_dir/cache.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/cache_dir/cache.rs) — Deno project, 2026. Rank 1. Backs: remote file name = SHA-256 of path and query. [^cache-dir]
- [libs/cache_dir/global/cache_file.rs (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/libs/cache_dir/global/cache_file.rs) — Deno project, 2026. Rank 1. Backs: metadata line after cached remote content. [^cache-file]
- [deno workspace Cargo.toml (v2.9.8)](https://github.com/denoland/deno/blob/v2.9.8/Cargo.toml) — Deno project, 2026. Rank 1. Backs: `deno_ast` =0.53.3, `deno_graph` =0.111.1. [^deno-cargo]
- [deno_graph README](https://github.com/denoland/deno_graph) — Deno project, living. Rank 1. Backs: `ModuleGraph::build`, `Resolver` trait. [^graph-readme]
- [deno_graph src/analysis.rs (0.111.1)](https://github.com/denoland/deno_graph/blob/0.111.1/src/analysis.rs) — Deno project, 2026. Rank 1. Backs: dynamic import arguments: string, template, unanalyzable expression. [^graph-analysis]
- [deno_graph src/jsr.rs (0.111.1)](https://github.com/denoland/deno_graph/blob/0.111.1/src/jsr.rs) — Deno project, 2026. Rank 1. Backs: `meta.json` and `<version>_meta.json` URLs. [^graph-jsr]
- [deno_ast README](https://github.com/denoland/deno_ast) — Deno project, living. Rank 1. Backs: parsing for Deno, regular swc upgrades. [^ast-readme]
- [deno_ast Cargo.toml (0.53.3)](https://github.com/denoland/deno_ast/blob/0.53.3/Cargo.toml) — Deno project, 2026. Rank 1. Backs: `swc_ecma_parser` 27.0.7, `transpiling` feature. [^ast-cargo]
- [TypeScript support](https://docs.deno.com/runtime/fundamentals/typescript/) — Deno project, living. Rank 1. Backs: no check by default, `--check`, `--check=all`, type stripping, unstable Go compiler. [^ts-doc]
- [deno check](https://docs.deno.com/runtime/reference/cli/check/) — Deno project, living. Rank 1. Backs: `--all`, `--no-code-cache`, default import host list. [^check-doc]
- [Modules](https://docs.deno.com/runtime/fundamentals/modules/) — Deno project, living. Rank 1. Backs: computed dynamic imports checked by permissions at run time. [^modules-doc]
- [Environment variables](https://docs.deno.com/runtime/reference/env_variables/) — Deno project, living. Rank 1. Backs: `DENO_UNSTABLE_TSGO`; `DENO_EMIT_CACHE_MODE` not listed. [^envvars]
- [About "slow types"](https://jsr.io/docs/about-slow-types) — JSR (Deno project), living. Rank 1. Backs: fast check avoids type inference. [^slow-types]
- [Code caching for JavaScript developers](https://v8.dev/blog/code-caching-for-devs) — V8 team, 2019. Rank 4. Backs: code cache stores parse and compile results. [^v8-cache]

## Related
- `deno/internals/runtime-architecture.md` — ops, resources and the event loop that take over after line 1.
- `deno/fundamentals/running-code-and-typescript.md` — the user-facing `deno check`, `--check` and `compilerOptions`.
- `deno/modules/dependency-management.md` — the lockfile, `--reload`, `deno clean` and the `DENO_DIR` layout from the user's side.
- `js-runtime/node-type-stripping.md` — how Node.js strips types, for comparison.
