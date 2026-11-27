---
schema: topic-index/v1
kind: topic
topic: js-runtime
last-updated: 2026-11-27
---

# JavaScript runtime internals

JavaScript runtime internals covers engine and Node.js behaviors that affect correctness, cancellation, async failures, and hot-path performance. It does not cover package-manager dispatch details; see the legacy Node.js reference below.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [v8-hidden-classes.md](v8-hidden-classes.md) | concept | Object shapes, V8 Maps, inline caches, dictionary mode, and stable-field construction | verified |
| [v8-compiler-pipeline-deep-dive.md](v8-compiler-pipeline-deep-dive.md) | deep-dive | How V8 13.6 in Node.js 24 runs JavaScript through Ignition, Sparkplug, Maglev and TurboFan, why it deoptimizes, how inlining and on-stack replacement work, and which old optimization advice no longer holds, checked in a lab and re-run on nine more builds, Chrome 158 among them (where headless runs can stay in Maglev) | verified |
| [v8-object-and-value-representation-deep-dive.md](v8-object-and-value-representation-deep-dive.md) | deep-dive | How V8 13.6 stores numbers, objects, arrays, strings and Maps, when each representation goes slow or comes back, bytes per element, and nine corrected beliefs, measured on Node.js 24.22.1; what pointer compression is for, what it costs, why Chrome has it on and Node.js off, with the same labs run on a pointer-compression Node.js build and in Chrome 158 | verified |
| [v8-memory-and-startup-deep-dive.md](v8-memory-and-startup-deep-dive.md) | deep-dive | How V8 manages memory in Node.js 24 (the scavenger, mark-compact, what keeps memory alive, weak references, external memory, heap flags) and how code gets ready to run (lazy parsing, code cache, snapshots, compile cache), with lab measurements and corrections; retained sizes and heap limits also measured on a pointer-compression Node.js build and in Chrome 158 | verified |
| [promise-rejections.md](promise-rejections.md) | concept | Floating promises, unhandled rejection behavior, and why linting promise handling matters | verified |
| [subpath-imports.md](subpath-imports.md) | concept | `package.json` `imports`: why internal aliases start with `#`, versus `paths`, self-reference and relative paths | verified |
| [private-fields.md](private-fields.md) | concept | `#x` versus TypeScript `private`: runtime privacy, serialization leaks, measured performance | verified |
| [barrel-files.md](barrel-files.md) | concept | Re-export files (`index.ts`): measured load cost, cycles, and the alternative of importing the declaring file | verified |
| [enums-and-literal-unions.md](enums-and-literal-unions.md) | concept | `enum` vs `as const` object, `as const` array and literal union: erasability, measured emit, what a rename breaks, and which to pick (an object for codes the project owns and repeats) | verified |
| [abort-signal.md](abort-signal.md) | concept | AbortController and AbortSignal as a cancellation contract across fetch and own APIs | verified |
| [worker-thread-pools.md](worker-thread-pools.md) | concept | piscina task dispatch, `availableParallelism()` under a container CPU limit, measured worker sizing, and pool statistics that mislead | verified |
| [node-worker-default-heap-limit.md](node-worker-default-heap-limit.md) | concept | The heap limit a Node.js worker gets without `resourceLimits` in a memory-limited container: `clamp(limit ÷ 2, 256 MiB, 2 GiB)` per worker, why several workers can still get the container OOM-killed, measured at 11 limits | verified |
| [piscina-queue-size.md](piscina-queue-size.md) | concept | What piscina's `queueSize` counts (waiting tasks only, minus starting workers), why `maxQueue` is not enforced for tasks with an `AbortSignal`, and how `needsDrain` and `'drain'` really behave, measured on 5.3.2 | verified |
| [node-type-stripping.md](node-type-stripping.md) | reference | Node 24.12+ type stripping: what runs, what fails (enum, namespace, parameter property, `<T>x`, type imports, tsconfig, node_modules) and the one warning text found, measured on 24.22.1 | verified |
| [windows-home-links-and-modes.md](windows-home-links-and-modes.md) | reference | Windows in Node 24: `os.homedir()` reads `USERPROFILE`, symlink and junction types, `fs.rename` over a directory, `chmod` as a read-only switch (docs and libuv source; to be run on the Windows runner) | verified |
| [atomic-symlink-swap.md](atomic-symlink-swap.md) | reference | Replacing a directory symlink in one step with `fs.renameSync` (macOS, measured); Windows untested, docs summarized in the Windows doc | verified |
| [yaml-comment-round-trip.md](yaml-comment-round-trip.md) | reference | `yaml` 2.9.1 keeps comments when a tool rewrites a hand-edited file, but not inline-comment spacing (measured) | verified |
| [eslint-nested-config-lookup.md](eslint-nested-config-lookup.md) | reference | Which `eslint.config.*` ESLint 10 uses per file: own folder, then parents; one root `eslint .` runs nested configs (measured) | verified |
| [eslint-custom-rules.md](eslint-custom-rules.md) | reference | Writing an ESLint rule and plugin, testing it with `RuleTester`, typed rules (typescript-eslint 8.73 needs TypeScript below 6.1), and the existing rules that already cover common checks | verified |
| [url-parser-differential-node-git.md](url-parser-differential-node-git.md) | reference | Node `URL` reads `\` as `/` and drops tabs and newlines, git does not: check the exact string (measured) | verified |
| [hash-input-and-realpath-case.md](hash-input-and-realpath-case.md) | reference | Lone surrogates hash the same through createHash, and realpathSync keeps typed case while .native returns disk case (measured) | verified |
| [Node.js / nvm / corepack / pnpm / yarn Architecture](../nodejs/node-nvm-corepack-pnpm-yarn-architecture.md) | legacy | Windows Node.js toolchain dispatch and Corepack behavior | — |

## References
- [V8 documentation](https://v8.dev/docs) — V8 team, living. Backs: topic scope.
- [Node.js API documentation](https://nodejs.org/api/) — Node.js project, living. Backs: topic scope.

## Related
- `operations/` — runtime configuration and logging practices that surround Node.js applications.
- `web-apis/` — HTTP API surface practices.
- `nodejs/node-nvm-corepack-pnpm-yarn-architecture.md` — legacy Node.js toolchain reference.
