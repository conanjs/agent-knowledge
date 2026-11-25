---
schema: topic-index/v1
kind: subtopic
topic: bun/fundamentals
last-updated: 2026-11-25
---

# Bun fundamentals

What Bun is and how it runs code, measured on Bun 1.4.5: the single binary and its commands, the JavaScriptCore engine and the Rust rewrite, installing, upgrading, version and revision, detecting Bun and the `oven/bun` Docker images; `bun <file>` and `bun run` with scripts, binaries and shebangs; the per-file transpiler for TypeScript and JSX (no type checking unless `--check`) and the `tsconfig.json` fields it honours; auto-install; module resolution, ES module and CommonJS interop, export conditions, `import.meta` and the runtime loaders table; `bunfig.toml`, `.env` loading and the environment variables Bun reads; `--watch`, `--hot` and the debugger. Not covered here: the package manager (`bun/package-manager/`), the bundler (`bun/bundler/`), the test runner (`bun/testing/`), the HTTP server (`bun/http-and-networking/`), and engine internals and performance (`bun/internals/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [what-bun-is.md](what-bun-is.md) | concept | One binary for run, install, build, test (plus `check`, `fmt`); JavaScriptCore; Zig to Rust in 1.4; install by script, npm and pinned tag as run in containers, `bun upgrade` to canary and back (and why it fails without `unzip`); `--version` vs `--revision`; detecting Bun; the four `oven/bun` image variants measured (size, user, shell, libc, what each lacks) | verified |
| [running-code-and-transpilation.md](running-code-and-transpilation.md) | concept | `bun <file>` vs `bun run`, the script/file/binary/system resolution order, pre/post scripts, `--bun` and Node shebangs, per-file TypeScript and JSX transpiling without type checks, honoured and ignored `tsconfig.json` fields, auto-install and its safeguards, `-e`/`-p`, stdin, REPL | verified |
| [module-resolution-and-loaders.md](module-resolution-and-loaders.md) | concept | ESM and CommonJS interop, `require()` of ESM and top-level `await`, four extension orders (`.node` last in the `require()` ones), `--extension-order`, `paths` and `imports`, `exports` conditions with `"bun"`, `import.meta`, `Bun.resolveSync`, and the runtime loaders table, with what changed since 1.3.14 and what `1.4.6-canary.1` adds | verified |
| [configuration-and-environment.md](configuration-and-environment.md) | reference | `bunfig.toml` locations, how global and project files merge (and `bunx` skipping the project file), runtime and `[run]` keys, `.env` file order by `NODE_ENV`, `--env-file`/`--no-env-file`, expansion rules, `Bun.env`, and the environment variables Bun reads, with lab runs (TLS, concurrency, timeouts in 4-second steps) | verified |
| [watch-hot-and-debugging.md](watch-hot-and-debugging.md) | concept | `--watch` restarts, `--hot` keeps `globalThis` and the server port, what is watched, screen clearing, `--inspect`, `--inspect-wait`, `--inspect-brk` and the inspector handshake a client must send, `debug.bun.sh`, `node:inspector` | verified |

## References
- [Bun Runtime: docs/runtime/index.mdx at bun-v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/index.mdx) — Bun documentation as released with 1.4.5 (Oven), 2026. Backs: subtopic scope (running files and scripts, flags).
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Oven, 2026. Backs: the 1.4 line these docs describe (Rust rewrite, behaviour changes).
- `linux/lab-setup.md` — the lab where every behaviour ran (`oven/bun:1.4.5`, arm64, 2026-11-24).

## Related
- `bun/package-manager/` — installing packages, lockfile, workspaces.
- `bun/bundler/` — `bun build`, plugins, executables, HTML.
- `bun/node-compat/` — Node.js compatibility and migrating.
- `js-runtime/node-type-stripping.md` — Node.js 24's TypeScript support, for comparison.
- `linux/lab-setup.md` — the lab.
