---
schema: topic-index/v1
kind: topic
topic: go
last-updated: 2026-11-24
---

# Go, the language and its runtime

The Go programming language from the basics to the runtime, written in our own words from the Go project's own sources: the language specification, Effective Go, the memory model, the modules reference, the release notes up to Go 1.27, the standard-library documentation, the runtime source and the Go blog. Twelve subtopics go from the toolchain and the syntax, through slices, maps, methods, interfaces, errors and generics, to packages and modules, concurrency and the memory model (with the `golang.org/x/sync` helpers), the standard library (printing, logging, time, files, command-line programs, templates, images, encodings, SQL databases, sockets and HTTP), testing, debugging and vulnerability scanning, the scheduler, garbage collector and compiler optimizations, and reflection, `unsafe`, cgo and WebAssembly. Every behaviour was run in the official `golang:1.27.4` image (`lab-setup.md`); the few examples that need a module or a tool (`golang.org/x/sync`, a pure-Go SQLite driver, Delve, govulncheck, benchstat, the wazero WebAssembly runtime) downloaded a pinned version through the Go module proxy. Start with `learning-path.md`. Not covered: cross-language concurrency and error design (see `concurrency/` and `error-handling/`), doc-comment conventions (see `code-documentation/`), third-party frameworks.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [learning-path.md](learning-path.md) | reference | Thirteen stages from the toolchain to the runtime, each with docs, an exercise and a self-check; A Tour of Go and Effective Go mapped to docs; Go 1.21–1.27 changes mapped to docs | verified |
| [lab-setup.md](lab-setup.md) | how-to | Run every Go example in a throwaway `golang:1.27.4` container with no network, a cached build and a working race detector; allow the module proxy only for runs that download a pinned module or tool | verified |

## Subtopics
| Subtopic | Summary |
|---|---|
| [introduction/](introduction/index.md) | The `go` command, program structure, `gofmt`, the Go 1 compatibility promise, the `go` and `toolchain` lines and GODEBUG |
| [fundamentals/](fundamentals/index.md) | Tokens, literals and automatic semicolons, declarations, zero values, basic types and conversions, constants and `iota`, control flow, `range`, functions, closures and `defer` |
| [data-types/](data-types/index.md) | Arrays and slices, maps, strings, bytes and runes, structs and pointers |
| [methods-interfaces/](methods-interfaces/index.md) | Methods, receivers and method sets, embedding, interfaces, type assertions and the nil-interface trap |
| [errors/](errors/index.md) | Errors as values, wrapping with `%w`, `errors.Is`/`As`/`AsType`/`Join`, `panic` and `recover` |
| [generics/](generics/index.md) | Type parameters, constraints and type sets, inference, generic types and generic methods |
| [packages-modules/](packages-modules/index.md) | Packages, visibility, initialization order, modules, minimal version selection, workspaces |
| [concurrency/](concurrency/index.md) | Goroutines, channels, `select`, `sync` and atomics, `context`, the memory model and data races, patterns and leaks, `errgroup`, `semaphore` and `singleflight` |
| [standard-library/](standard-library/index.md) | Iterators, `io` and JSON, `fmt`, `log/slog`, random numbers and UUIDs, `time`, files and `os.Root`, command-line programs and signals, templates, images, CSV/XML/binary encodings, `database/sql`, TCP and UDP, `net/http` |
| [tooling/](tooling/index.md) | Testing, benchmarks and benchstat, fuzzing, debugging with Delve, govulncheck, `go vet`, `go fix`, build constraints and the `go` command |
| [runtime/](runtime/index.md) | The scheduler and goroutine stacks, allocation, size classes, escape analysis and the garbage collector, compiler optimizations, profiling, `runtime/metrics` and diagnostics |
| [low-level/](low-level/index.md) | Reflection, `unsafe`, cgo and WebAssembly |

## References
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Backs: topic scope.
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Backs: topic scope.
- [Release History](https://go.dev/doc/devel/release) — Go team, living. Backs: the Go versions covered.

## Related
- `concurrency/` — structured concurrency, blocking and data races across Go, Python, Rust and TypeScript.
- `error-handling/` — cross-language error design.
- `code-documentation/` — Go doc comments next to other languages' standards.
- `linux/lab-setup.md` — the Linux lab the other language topics ran in.
