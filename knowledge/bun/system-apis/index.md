---
schema: topic-index/v1
kind: subtopic
topic: bun/system-apis
last-updated: 2026-11-25
---

# Bun system APIs

The parts of the Bun runtime that talk to the operating system and to native code, all run in Bun 1.4.5: reading and writing files with `Bun.file`, `Bun.write` and `FileSink`; starting processes with `Bun.spawn` and scripting them with the Bun Shell `$`; SQLite through `bun:sqlite` and SQL databases through `Bun.sql`; worker threads, `bun:ffi`, the embedded C compiler and Node-API add-ons; and a catalog of the built-in utilities (hashing, parsers, compression, cron, images, S3 and Redis clients). Not covered here: the HTTP server, WebSockets and `fetch` extensions (see `bun/http-and-networking/`), `node:*` module compatibility (see `bun/node-compat/`), and why these APIs are fast and how they measured against Node.js (see `bun/internals/performance-measured.md`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [file-io.md](file-io.md) | concept | `Bun.file` as a lazy handle, readers, `Bun.write` inputs and the syscalls `strace` showed for each (and the pipe input that fails in 1.4.5), macOS clones shown by effect (1 GiB in 0.5 ms to a new path, a full copy onto an existing file), `FileSink` and pipe lifetime, stdio as files, stale sizes and non-truncating writers, `node:fs` for the rest | verified |
| [processes-and-shell.md](processes-and-shell.md) | concept | `Bun.spawn`/`spawnSync` options and defaults, exit codes and signals, timeouts, IPC (including a Node.js child); the Bun Shell's escaping, builtins (traced: no `/bin/sh`; Linux and macOS compared, the experimental `cat` hangs on macOS), `ShellError`, redirects to JS objects, argument injection; contrast with `child_process.exec` | verified |
| [sqlite-and-sql.md](sqlite-and-sql.md) | concept | `bun:sqlite` statements, parameters, `strict`, `safeIntegers`, transactions and their lock modes, WAL; on macOS Apple's SQLite 3.51.0, its persistent `-wal`/`-shm` files and `setCustomSQLite`; `Bun.sql` tagged templates as injection defence, helpers, adapters, `sql.begin`, pooling; run against PostgreSQL 18.3 and MySQL 8.4 (64-bit integer types, pool lifetime and timeouts, `LISTEN`, MySQL 8 authentication over plain TCP and TLS) | verified |
| [workers-ffi-and-native-code.md](workers-ffi-and-native-code.md) | concept | `Worker` options and structured-clone messages, environment data, lifetime; `bun:ffi` `dlopen`, pointers, `JSCallback`; thread-safe callbacks; `cc()` with and without libc headers, and on macOS; Node-API add-ons (a hand-built one and `bufferutil`), loaded by `require` but not `import` | verified |
| [builtin-utilities-reference.md](builtin-utilities-reference.md) | reference | Catalog of `Bun.*` helpers with defaults and lab results: hashing and passwords, glob, semver, TOML/YAML/JSON5/JSONC/JSONL/XML/Markdown, HTMLRewriter, Transpiler, compression, Archive, CSRF, secrets, cron (in-process and crontab), Image, color; S3 against versitygw, Redis against Redis 7.4, `Bun.WebView` on Chromium and macOS WebKit, `Bun.Image` system codecs on macOS | verified |

## References
- [Bun runtime docs at bun-v1.4.5](https://github.com/oven-sh/bun/tree/bun-v1.4.5/docs/runtime) — Oven, 2026. Backs: the runtime API pages these docs cite (file I/O, spawn, shell, SQLite, SQL, workers, FFI, utilities), as shipped with 1.4.5.
- [Bun documentation](https://bun.com/docs) — Oven, living. Backs: the current docs, which can describe a newer Bun than 1.4.5; each doc names any gap it found.
- [packages/bun-types at bun-v1.4.5](https://github.com/oven-sh/bun/tree/bun-v1.4.5/packages/bun-types) — Oven, 2026. Backs: option names and defaults for 1.4.5.

## Related
- `bun/http-and-networking/` — `Bun.serve`, WebSockets, `fetch`, sockets.
- `bun/node-compat/` — `node:fs`, `node:child_process`, `node:worker_threads` status.
- `js-runtime/worker-thread-pools.md` — sizing worker pools for CPU-limited containers.
- `performance/sqlite-covering-index-lab.md` — SQLite indexing.
- `linux/lab-setup.md` — the lab every example ran in.
