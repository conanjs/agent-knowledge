---
schema: knowledge-doc/v1
type: reference
topic: deno
status: verified
applies-to: ["the docs under knowledge/deno/ as of 2026-11-24", "Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, learning-path, curriculum, exercises]
ranked-sources: true
---

# Deno learning path

## Summary
**TL;DR:** Eight stages from "what is Deno" to FFI (foreign function interface: calling C code from JavaScript) and the runtime's Rust internals. Each stage lists the docs to read in order, one exercise to run in the Deno 2.9.8 lab, the output that exercise printed there, and a self-check question. Stages 1–3 are the basics every Deno user needs (running code, TypeScript, permissions); 4–6 are day-to-day project work (modules, configuration, tools, Node.js code, JSR, the JavaScript Registry); 7–8 build services and go under the hood.
**Use this when:** you start learning Deno, want to know which doc covers a feature, or want a self-test after reading.
**Not this doc:** how to set up the lab → `deno/deno-lab-setup.md`; the JavaScript language itself → `javascript/learning-path.md`.

## Scope
The v1 docs under `knowledge/deno/` (one root folder and twelve subtopics), Deno 2.9.8. Every exercise was run on 2026-11-24 in the container described in `deno/deno-lab-setup.md`, with the probe folder mounted at `/lab`.

## Catalog

### Stages

| # | Stage | Read, in order | Exercise | Output in the lab (2.9.8) | Self-check: you can explain … |
|---|---|---|---|---|---|
| 1 | What Deno is | `fundamentals/what-deno-is.md` → `deno-lab-setup.md` → `releases-stability-and-support.md` | Steps 2–4 of `deno-lab-setup.md`: read `HOME` with no flag, then with `--allow-env=HOME` | First run: `NotCapable: Requires env access to "HOME", run again with the --allow-env flag`, exit 1; second run: `/root` ✅[^run] | … what "secure by default" blocks, and what the 2026-10-09 announcement means for how long the runtime gets fixes |
| 2 | Running code and TypeScript | `fundamentals/running-code-and-typescript.md` → `fundamentals/web-platform-apis.md` | `t.ts` below: `deno run t.ts`, then `deno check t.ts` | `deno run` prints `x` and exits 0; `deno check` prints `TS2322 [ERROR]: Type 'string' is not assignable to type 'number'.` and `error: Type checking failed.`, exit 1 ✅[^run] | … why `deno run` executes a file that fails type checking, and which globals a browser has that Deno lacks |
| 3 | Permissions | `security/permission-model.md` → `security/permission-flags.md` | `read.ts` below with `--allow-read=/lab --deny-read=/lab/secret` | `ok`, then `NotCapable: Requires read access to "/lab/secret/a.txt", run again with the --allow-read flag`, exit 1 ✅[^run] | … how an allow list and a deny list combine, and why `--allow-run` or `--allow-ffi` is close to `-A` |
| 4 | Modules and configuration | `modules/module-specifiers-and-imports.md` → `modules/dependency-management.md` → `configuration/deno-json-reference.md` → `configuration/workspaces-and-monorepos.md` | In a folder holding only `deno.json` with `{}`: `deno add jsr:@std/path`, then read `deno.json` and `deno.lock` | `Add jsr:@std/path@1.1.6`; `deno.json` gains `"imports": { "@std/path": "jsr:@std/path@^1.1.6" }`; `deno.lock` has `"version": "5"`, maps `jsr:@std/path@^1.1.6` to `1.1.6`, records an `integrity` hash, and also pins the dependency `@std/internal` 1.0.14 ✅[^run] | … what the lockfile pins and what `--frozen` refuses, and when a local `node_modules` folder appears |
| 5 | Toolchain and testing | `toolchain/cli-subcommands.md` → `toolchain/tasks-and-task-shell.md` → `toolchain/formatting-linting-and-docs.md` → `testing/testing-and-mocking.md` → `testing/coverage-and-benchmarks.md` | `leak_test.ts` below, then the same test with `sanitizeOps: true` (`leak2_test.ts`) | First: `leaks a timer ... ok`; second: `FAILED` with `Leaks detected:` and ``- A timer was started in this test, but never completed. This is often caused by not calling `clearTimeout`.`` ✅[^run] | … which leak checks run by default in Deno 2.9 and how to turn the others on, and how a task's dependencies are ordered |
| 6 | Node.js code and JSR | `node-compat/node-and-npm-compatibility.md` → `node-compat/migrating-a-node-project.md` → `std-and-jsr/jsr-and-publishing.md` → `std-and-jsr/standard-library.md` | `barefs.ts`, `c.js` and the same file renamed `c.cjs`, each with `deno run` | `barefs.ts`: `function` (a bare `"fs"` import resolves to the Node built-in); `c.js`: `ReferenceError: require is not defined`; `c.cjs`: `function` ✅[^run] | … how Deno decides whether a file is CommonJS or an ES (ECMAScript) module, and why JSR rejects "slow types" |
| 7 | Building services | `web/http-server.md` → `web/websockets-sse-and-routing.md` → `runtime-apis/files-processes-and-environment.md` → `runtime-apis/workers-kv-and-cron.md` | `srv.ts` below, first with `--allow-net=localhost:8000`, then with `--allow-net=0.0.0.0:8000,localhost:8000` | First: `NotCapable: Requires net access to "0.0.0.0:8000"` (the server listens on `0.0.0.0` when no hostname is given); second: `200 hi /deno` and `server finished`, exit 0 ✅[^run] | … how `Deno.serve` shuts down gracefully, and what a Deno KV (key-value store) atomic `check` prevents |
| 8 | Under the hood | `internals/runtime-architecture.md` → `internals/module-loading-and-type-checking.md` → `advanced/ffi-and-webassembly.md` → `advanced/compile-and-distribution.md` → `advanced/debugging-profiling-and-telemetry.md` | `ffi.ts` below, without and with `--allow-ffi` | Without: `NotCapable: Requires ffi access to "/lib/ld-musl-aarch64.so.1"`; with: `4n` (the C `strlen` of `"deno"`, returned as a `bigint` for the `usize` result type) ✅[^run] | … how a JavaScript call reaches a Rust op, what happens between `deno run` and the first line executing, and what `deno compile` puts in the executable |

### Exercise files

Stage 2, `t.ts`:
```ts
const n: number = "x";
console.log(n);
```

Stage 3, `read.ts` (with `ok.txt` holding `ok` and `secret/a.txt` next to it):
```ts
console.log(await Deno.readTextFile("/lab/ok.txt"));
console.log(await Deno.readTextFile("/lab/secret/a.txt"));
```

Stage 5, `leak_test.ts` and `leak2_test.ts`:
```ts
Deno.test("leaks a timer", () => { setTimeout(() => {}, 1000); });
```
```ts
Deno.test({ name: "leaks a timer", sanitizeOps: true, fn() { setTimeout(() => {}, 1000); } });
```

Stage 6, `barefs.ts` and `c.js` (copy `c.js` to `c.cjs` for the third run):
```ts
import fs from "fs";
console.log(typeof fs.readFileSync);
```
```js
const fs = require("fs");
console.log(typeof fs.readFileSync);
```

Stage 7, `srv.ts`:
```ts
const ac = new AbortController();
const server = Deno.serve({ port: 8000, signal: ac.signal, onListen() {} },
  (req) => new Response(`hi ${new URL(req.url).pathname}`));
const res = await fetch("http://localhost:8000/deno");
console.log(res.status, await res.text());
ac.abort();
await server.finished;
console.log("server finished");
```

Stage 8, `ffi.ts`:
```ts
const lib = Deno.dlopen("/lib/ld-musl-aarch64.so.1", {
  strlen: { parameters: ["buffer"], result: "usize" },
});
console.log(lib.symbols.strlen(new TextEncoder().encode("deno\0")));
lib.close();
```

## Lookup notes
- The `ffi.ts` library path is where the C library lives in the arm64 Alpine image of the lab ✅[^run]; on another image or architecture, use that system's C library path.
- The stage 4 versions (`@std/path` 1.1.6, `@std/internal` 1.0.14) are what JSR served on 2026-11-24 ✅[^run]; a later run picks the newest matching version, so the numbers may be higher.
- In the stage 7 run, `--allow-net=localhost:8000` covered the `fetch` but not the listener, because the listener address was `0.0.0.0:8000` ✅[^run]; `security/permission-flags.md` gives the host-matching rules.

## Takeaways
- Run each stage's exercise before its self-check: most of Deno's surprises (type checks skipped by `deno run`, leak checks off by default, the `0.0.0.0` listener grant) show up only when the code runs.

## Verification status
- Verified: 11 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Catalog and Lookup notes. [^run]
- [Deno documentation](https://docs.deno.com/runtime/) — Deno project, living. Rank 1. Backs: the scope of the topic the stages follow.

## Related
- `deno/index.md` — every doc of the topic with a one-line summary.
- `deno/deno-lab-setup.md` — the lab every exercise ran in.
- `javascript/learning-path.md` — the language underneath.
