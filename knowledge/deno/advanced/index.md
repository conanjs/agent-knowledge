---
schema: topic-index/v1
kind: subtopic
topic: deno/advanced
last-updated: 2026-11-24
---

# Deno advanced: native code, distribution and diagnostics

Using Deno 2.9.8 beyond ordinary scripts: calling C libraries through FFI (foreign function interface) and loading WebAssembly modules; turning a program into a standalone executable with `deno compile`, installing tools with `deno install -g`, and the experimental `deno desktop`; and finding out what a running program does with the inspector, V8 flags, CPU (central processing unit) profiles and built-in OpenTelemetry. Every behaviour was measured in the lab of `deno/deno-lab-setup.md`. Not covered: the permission model itself (`deno/security/`), the HTTP server (`deno/web/`), tests and benchmarks (`deno/testing/`), and hosted services such as Deno Deploy.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [ffi-and-webassembly.md](ffi-and-webassembly.md) | concept | `Deno.dlopen`, native types, nonblocking calls, pointers and callbacks, why `--allow-ffi` voids the sandbox; `.wasm` imports, `instantiate`/`instantiateStreaming`, shared memory | verified |
| [compile-and-distribution.md](compile-and-distribution.md) | concept | `deno compile` (`denort`, embedded files, six targets, baked permissions and arguments, measured sizes), `deno install -g`/`deno uninstall -g`, `deno desktop` | verified |
| [debugging-profiling-and-telemetry.md](debugging-profiling-and-telemetry.md) | concept | `--inspect*` and the DevTools protocol, `SIGUSR1`, `--v8-flags`, `--cpu-prof*`, heap snapshots, timers, and OpenTelemetry export over OTLP | verified |

## References
- [Foreign Function Interface](https://docs.deno.com/runtime/fundamentals/ffi/) — Deno project, living. Backs: FFI scope.
- [deno compile](https://docs.deno.com/runtime/reference/cli/compile/) — Deno project, living. Backs: distribution scope.
- [Debugging](https://docs.deno.com/runtime/fundamentals/debugging/) — Deno project, living. Backs: diagnostics scope.

## Related
- `deno/deno-lab-setup.md` — the lab every output here came from.
- `deno/security/permission-model.md` — what `--allow-ffi` and baked permissions mean.
- `deno/internals/runtime-architecture.md` — ops, resources and the event loop underneath.
