---
schema: knowledge-doc/v1
type: reference
topic: go
status: verified
applies-to: ["the docs under knowledge/go/ as of 2026-11-24", "Go 1.27 (go1.27.4)", "A Tour of Go", "Effective Go"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, learning-path, curriculum, tour-of-go, effective-go, release-notes]
ranked-sources: true
---

# Go learning path

## Summary
**TL;DR:** Thirteen stages take you from the `go` command to the runtime: basics, built-in data types, methods and interfaces, errors, packages and modules, testing and debugging, generics, concurrency, the standard library in two stages, the runtime and the compiler, and finally reflection, `unsafe`, cgo and WebAssembly. Each stage lists the docs to read in order, an exercise to run in the Docker lab and a self-check. Three maps follow: every chapter of A Tour of Go and every section of Effective Go to the doc that covers it, and the language and library changes of Go 1.21 to 1.27 to the doc that explains each one.
**Use this when:** you start learning Go, want to know which doc covers a Tour of Go page or an Effective Go section, or need to catch up on what changed in recent Go releases.
**Not this doc:** how to set up the lab → `go/lab-setup.md`; cross-language concurrency and error design → `concurrency/`, `error-handling/`.

## Scope
The 48 other docs under `knowledge/go/` as of 2026-11-24, all checked against Go 1.27.4. Exercises run in the `golang:1.27.4` container described in `go/lab-setup.md`; each one is a prediction to make first and then check by running it. A Tour of Go is a series of slides and exercises whose example programs you edit and run as you read ✅[^10]. Effective Go was written for Go's first release in 2009, is not actively updated, and does not cover generics, modules or libraries added since ✅[^8]: the release-notes map below covers what came later.

## Catalog

### Stages

| # | Stage | Read, in order | Exercise | Self-check: you can explain … |
|---|---|---|---|---|
| 1 | Toolchain and versions | `go/lab-setup.md` → `go/introduction/toolchain-and-compatibility.md` | Run one program that recovers from `panic(nil)` with `go 1.20`, then `go 1.27`, in `go.mod`; compare `go list -f '{{.DefaultGODEBUG}}' .` | … why one toolchain gives two behaviours, and what `GOTOOLCHAIN=local` does with a module that says `go 1.28` |
| 2 | Basics | `go/fundamentals/lexical-elements-and-semicolons.md` → `go/fundamentals/declarations-types-and-constants.md` → `go/fundamentals/control-flow-and-functions.md` | Put an `if` body's opening brace on the next line and read the error; predict `const Huge = 1 << 100; fmt.Println(Huge >> 98)`, `x := Huge` and an `int8` of 127 plus one; run the closures-in-a-loop example from the spec with `go 1.21` and `go 1.22` | … why a brace on the next line, a multi-line literal without a trailing comma and a bare `return` line all follow one semicolon rule, and why `defer fmt.Println(x)` prints the old `x` |
| 3 | Built-in data types | `go/data-types/arrays-and-slices.md` → `go/data-types/maps.md` → `go/data-types/strings-bytes-and-runes.md` → `go/data-types/structs-and-pointers.md` | Append two different values to the same length-2, capacity-4 slice, then fix the aliasing with `s[:2:2]`; cut `"Öl世界!"` to four characters by bytes and by runes | … when two slices share an array, why `m[k].x = 1` does not compile, and why `len` counts bytes |
| 4 | Methods, interfaces and printing | `go/methods-interfaces/methods-and-embedding.md` → `go/methods-interfaces/interfaces.md` → `go/standard-library/fmt-and-printing.md` | Call a pointer method on `m["a"]` in a `map[string]Counter` and read the error; return a nil `*MyErr` as an `error` and test `err != nil`; give `IPAddr` a `String` method and print it with `%v`, `%d`, `%x` and `%#v` | … method sets of `T` and `*T`, the (type, value) pair inside an interface value, and the order in which `fmt` looks for `Format`, `GoString`, `Error` and `String` |
| 5 | Errors | `go/errors/errors-and-wrapping.md` → `go/errors/panic-and-recover.md` | Wrap one cause with `%w` and with `%v`, then compare `errors.Is` and `errors.AsType`; panic inside a goroutine and watch `main`'s `defer` not run | … why wrapping makes an error part of your API, and why `recover` in a helper function returns `nil` |
| 6 | Packages and modules | `go/packages-modules/packages-and-initialization.md` → `go/packages-modules/modules-and-dependencies.md` → `go/tooling/vulnerability-scanning-with-govulncheck.md` | Predict the initialization order of out-of-order package variables; request a commit that is not a tagged release and read its pseudo-version; scan three modules on a vulnerable dependency (one calls the function, one only imports the package, one only requires the module) | … minimal version selection without a lock file, and why calling a vulnerable function is reported as affecting you while only importing its package is not |
| 7 | Testing, debugging and the `go` command | `go/tooling/testing-benchmarks-and-fuzzing.md` → `go/tooling/debugging-with-delve.md` → `go/tooling/go-command-and-build-reference.md` | Fuzz a byte-wise `Reverse` until it breaks on UTF-8; compare two benchmark versions with benchstat; run a scripted Delve session against an optimized and an unoptimized build | … why a second `go test ./...` prints `(cached)`, what benchstat's `~` means, and why a breakpoint line can vanish in an optimized binary |
| 8 | Generics | `go/generics/type-parameters-and-constraints.md` → `go/generics/generic-types-methods-and-inference.md` | Write `Max[T any]`, read the operator error, fix it with `cmp.Ordered`; compile a generic method with `go 1.26`, then `go 1.27` | … type sets and `~T`, and why a generic method cannot implement an interface method |
| 9 | Concurrency | `go/concurrency/goroutines-and-channels.md` → `go/concurrency/sync-and-atomics.md` → `go/concurrency/context-and-cancellation.md` → `go/concurrency/memory-model-and-data-races.md` → `go/concurrency/patterns-and-goroutine-leaks.md` → `go/concurrency/errgroup-semaphore-and-singleflight.md` | Tabulate every channel operation on a nil, an open and a closed channel; run a shared counter with and without `-race`; make an early-return leak and read the `goroutineleak` profile; call `singleflight` from five goroutines with short deadlines | … why a receive from a nil channel blocks while one from a closed channel returns, what "happens before" means, and why a panic inside an `errgroup` task ends the program |
| 10 | Standard library: data, files and programs | `go/standard-library/iterators.md` → `go/standard-library/io-and-encoding-json.md` → `go/standard-library/csv-xml-and-binary-encodings.md` → `go/standard-library/files-and-filesystems.md` → `go/standard-library/command-line-programs.md` → `go/standard-library/time-and-clocks.md` → `go/standard-library/log-and-slog.md` → `go/standard-library/random-numbers-and-uuids.md` | Write an in-order `All() iter.Seq[int]` for a tree and `break` early; read a tree with escaping symbolic links through `os.DirFS` and through `os.Root`; shut a program down cleanly on `SIGTERM` with `NotifyContext`; compare `a == a.Round(0)` with `a.Equal(…)`; seed two PCG generators the same way | … what `yield` returning `false` means, why `os.DirFS` is not a sandbox while `os.Root` is, why `Equal` beats `==` for times, and why `math/rand` is wrong for secrets |
| 11 | Standard library: services | `go/standard-library/net-http.md` → `go/standard-library/tcp-udp-and-deadlines.md` → `go/standard-library/database-sql.md` → `go/standard-library/text-and-html-templates.md` → `go/standard-library/images.md` | Route requests through `httptest.NewServer`; read with a 250 ms deadline from a peer that sends a byte every 100 ms; leak `Rows` with `SetMaxOpenConns(2)` and watch `db.Stats()`; render a hostile `javascript:` link through `html/template`; write and decode a PNG | … which `http.Server` timeouts are off by default, why a deadline is a point in time, why a forgotten `rows.Close()` hangs the next query, and why `html/template` reports escaping errors at `Execute` |
| 12 | Runtime and performance | `go/runtime/scheduler-and-goroutine-stacks.md` → `go/runtime/memory-allocation-and-gc.md` → `go/runtime/compiler-optimizations.md` → `go/runtime/profiling-and-diagnostics.md` | Print `GOMAXPROCS` under `docker run --cpus=2`; run one program with `GOGC=50`, `100`, `400` and `GOMEMLIMIT`; add `_ = s[3]` before summing `s[0]` to `s[3]` and count the bounds checks; profile string `+=` against `strings.Builder` | … G, M and P, the GOGC heap target, the inlining budget, and flat versus cumulative time in a profile |
| 13 | Reflection, `unsafe`, cgo and WebAssembly | `go/low-level/reflection.md` → `go/low-level/unsafe-and-cgo.md` → `go/low-level/webassembly.md` | Fill a struct from its tags with `reflect`; call C with `C.CString` and free the memory; build a `wasip1` reactor with `//go:wasmexport` and call it from a host | … why `reflect.ValueOf(x).SetInt` panics, why a stored `uintptr` does not keep memory alive, and why a reactor needs `_initialize` before its exports |

### A Tour of Go → doc

Chapter and page names are the tour's own ✅[^10].

| Chapter | Pages | Doc |
|---|---|---|
| Welcome | Hello, 世界; Go local | `go/lab-setup.md`, `go/introduction/toolchain-and-compatibility.md` |
| Packages, variables, and functions | Packages, Imports, Exported names | `go/packages-modules/packages-and-initialization.md` |
| Packages, variables, and functions | Functions, Functions continued, Multiple results, Named return values | `go/fundamentals/control-flow-and-functions.md` |
| Packages, variables, and functions | Variables, Variables with initializers, Short variable declarations, Basic types, Zero values, Type conversions, Type inference, Constants, Numeric Constants | `go/fundamentals/declarations-types-and-constants.md` |
| Flow control statements | For (four pages), If (three pages), Exercise: Loops and Functions, Switch (three pages), Defer, Stacking defers | `go/fundamentals/control-flow-and-functions.md` |
| More types | Pointers, Structs, Struct Fields, Pointers to structs, Struct Literals | `go/data-types/structs-and-pointers.md` |
| More types | Arrays, Slices (nine pages), Exercise: Slices, Range, Range continued | `go/data-types/arrays-and-slices.md` |
| More types | Maps, Map literals (two pages), Mutating Maps, Exercise: Maps | `go/data-types/maps.md`, `go/data-types/strings-bytes-and-runes.md` (`strings.Fields`) |
| More types | Function values, Function closures, Exercise: Fibonacci closure | `go/fundamentals/control-flow-and-functions.md` |
| Methods and interfaces | Methods (eight pages, up to Choosing a value or pointer receiver) | `go/methods-interfaces/methods-and-embedding.md` |
| Methods and interfaces | Interfaces (six pages), Type assertions, Type switches, Stringers, Exercise: Stringers | `go/methods-interfaces/interfaces.md`; printing a `Stringer` in `go/standard-library/fmt-and-printing.md` |
| Methods and interfaces | Errors, Exercise: Errors | `go/errors/errors-and-wrapping.md` |
| Methods and interfaces | Readers, Exercise: Readers, Exercise: rot13Reader | `go/standard-library/io-and-encoding-json.md` |
| Methods and interfaces | Images, Exercise: Images | `go/standard-library/images.md` |
| Generics | Type parameters | `go/generics/type-parameters-and-constraints.md` |
| Generics | Generic types | `go/generics/generic-types-methods-and-inference.md` |
| Concurrency | Goroutines, Channels, Buffered Channels, Range and Close, Select, Default Selection, Exercise: Equivalent Binary Trees | `go/concurrency/goroutines-and-channels.md`; how goroutines are scheduled → `go/runtime/scheduler-and-goroutine-stacks.md` |
| Concurrency | sync.Mutex, Exercise: Web Crawler | `go/concurrency/sync-and-atomics.md`, `go/concurrency/patterns-and-goroutine-leaks.md`, `go/concurrency/errgroup-semaphore-and-singleflight.md` |

### Effective Go → doc

Section names are Effective Go's own ✅[^8].

| Section | Subsections | Doc |
|---|---|---|
| Formatting | — | `go/introduction/toolchain-and-compatibility.md` |
| Commentary | — | `code-documentation/doc-comments.md` |
| Names | Package names, Getters, Interface names, MixedCaps | `go/packages-modules/packages-and-initialization.md`; interface names in `go/methods-interfaces/interfaces.md`; MixedCaps also in `go/fundamentals/declarations-types-and-constants.md` |
| Semicolons | — | `go/fundamentals/lexical-elements-and-semicolons.md` |
| Control structures | If, Redeclaration and reassignment, For, Switch | `go/fundamentals/control-flow-and-functions.md`; redeclaration in `go/fundamentals/declarations-types-and-constants.md` |
| Control structures | Type switch | `go/methods-interfaces/interfaces.md` |
| Functions | Multiple return values, Named result parameters, Defer | `go/fundamentals/control-flow-and-functions.md` |
| Data | Allocation with new, Constructors and composite literals, Allocation with make | `go/data-types/structs-and-pointers.md` |
| Data | Arrays, Slices, Two-dimensional slices, Append | `go/data-types/arrays-and-slices.md` |
| Data | Maps | `go/data-types/maps.md` |
| Data | Printing | `go/standard-library/fmt-and-printing.md` |
| Initialization | Constants | `go/fundamentals/declarations-types-and-constants.md` |
| Initialization | Variables, The init function | `go/packages-modules/packages-and-initialization.md` |
| Methods | Pointers vs. Values | `go/methods-interfaces/methods-and-embedding.md` |
| Interfaces and other types | Interfaces, Conversions, Interface conversions and type assertions, Generality, Interfaces and methods | `go/methods-interfaces/interfaces.md`; reader and writer composition in `go/standard-library/io-and-encoding-json.md`; explicit conversions in `go/fundamentals/declarations-types-and-constants.md`; a function type with a method (`http.HandlerFunc`) in `go/standard-library/net-http.md`; Generality (exporting only the interface) in `go/methods-interfaces/interfaces.md` |
| The blank identifier | in multiple assignment, Unused imports and variables, Import for side effect, Interface checks | `go/fundamentals/declarations-types-and-constants.md`, `go/introduction/toolchain-and-compatibility.md`, `go/packages-modules/packages-and-initialization.md` (database drivers and image formats registering themselves: `go/standard-library/database-sql.md`, `go/standard-library/images.md`), `go/methods-interfaces/interfaces.md` |
| Embedding | — | `go/methods-interfaces/methods-and-embedding.md` |
| Concurrency | Share by communicating, Goroutines, Channels, A leaky buffer | `go/concurrency/goroutines-and-channels.md` |
| Concurrency | Channels of channels, Parallelization | `go/concurrency/patterns-and-goroutine-leaks.md` (request channels and worker pools), `go/runtime/scheduler-and-goroutine-stacks.md` (parallelism and `GOMAXPROCS`); a request that carries its own reply channel in `go/concurrency/patterns-and-goroutine-leaks.md` |
| Errors | — | `go/errors/errors-and-wrapping.md` |
| Errors | Panic, Recover | `go/errors/panic-and-recover.md` |
| A web server | — | `go/standard-library/net-http.md` (today's `ServeMux` patterns instead of the 2009 example) and `go/standard-library/text-and-html-templates.md` (the template half) |

### Changes by release (Go 1.21 to 1.27) → doc

| Release | Change | Doc |
|---|---|---|
| Go 1.21 | Built-ins `min`, `max` and `clear` ✅[^1] | `go/fundamentals/declarations-types-and-constants.md`, `go/data-types/maps.md` |
| Go 1.21 | `panic(nil)` becomes a `*runtime.PanicNilError` ✅[^1] | `go/errors/panic-and-recover.md` |
| Go 1.21 | `toolchain` line and toolchain switching; releases numbered `1.N.0` ✅[^1] | `go/introduction/toolchain-and-compatibility.md` |
| Go 1.21 | New `log/slog` package for structured logging ✅[^1] | `go/standard-library/log-and-slog.md` |
| Go 1.21 | `GOOS=wasip1` WebAssembly port ✅[^1] | `go/low-level/webassembly.md` |
| Go 1.21 | New `slices`, `maps` and `cmp` packages; `sync.OnceFunc`; `context.WithoutCancel` ✅[^1] | `go/data-types/arrays-and-slices.md`, `go/data-types/maps.md`, `go/generics/type-parameters-and-constraints.md`, `go/concurrency/sync-and-atomics.md`, `go/concurrency/context-and-cancellation.md` |
| Go 1.22 | Each loop iteration gets new loop variables; `range` over an integer ✅[^2] | `go/fundamentals/control-flow-and-functions.md` |
| Go 1.22 | `ServeMux` patterns with methods and wildcards ✅[^2] | `go/standard-library/net-http.md` |
| Go 1.22 | New `math/rand/v2` package ✅[^2] | `go/standard-library/random-numbers-and-uuids.md` |
| Go 1.23 | `range` over functions and the `iter` package; the `unique` package ✅[^3] | `go/standard-library/iterators.md`, `go/runtime/memory-allocation-and-gc.md` |
| Go 1.23 | Timer channels become unbuffered ✅[^3] | `go/concurrency/goroutines-and-channels.md` |
| Go 1.24 | `os.Root` for access confined to one directory; `crypto/rand.Text`; the `go:wasmexport` directive ✅[^4] | `go/standard-library/files-and-filesystems.md`, `go/standard-library/random-numbers-and-uuids.md`, `go/low-level/webassembly.md` |
| Go 1.24 | Generic type aliases ✅[^4] | `go/generics/generic-types-methods-and-inference.md` |
| Go 1.24 | Maps built on Swiss tables ✅[^4] | `go/data-types/maps.md` |
| Go 1.24 | `tool` directive in `go.mod`; `T.Context` and `B.Loop` in `testing` ✅[^4] | `go/packages-modules/modules-and-dependencies.md`, `go/tooling/testing-benchmarks-and-fuzzing.md` |
| Go 1.24 | `omitzero` JSON option; `weak` package and `runtime.AddCleanup`; `strings.SplitSeq` and friends ✅[^4] | `go/standard-library/io-and-encoding-json.md`, `go/runtime/memory-allocation-and-gc.md`, `go/standard-library/iterators.md` |
| Go 1.25 | Core types removed from the specification ✅[^5] | `go/generics/type-parameters-and-constraints.md` |
| Go 1.25 | `GOMAXPROCS` follows the cgroup CPU bandwidth limit on Linux ✅[^5] | `go/runtime/scheduler-and-goroutine-stacks.md` |
| Go 1.25 | `sync.WaitGroup.Go`; `testing/synctest`; trace flight recorder; `ignore` directive ✅[^5] | `go/concurrency/sync-and-atomics.md`, `go/tooling/testing-benchmarks-and-fuzzing.md`, `go/runtime/profiling-and-diagnostics.md`, `go/packages-modules/modules-and-dependencies.md` |
| Go 1.25 | Green Tea garbage collector as an experiment (`GOEXPERIMENT=greenteagc`) ✅[^5] | `go/runtime/memory-allocation-and-gc.md` |
| Go 1.26 | `new(expr)`; a generic type may refer to itself in its type parameter list ✅[^6] | `go/data-types/structs-and-pointers.md`, `go/generics/generic-types-methods-and-inference.md` |
| Go 1.26 | `errors.AsType`; `slog.NewMultiHandler` ✅[^6] | `go/errors/errors-and-wrapping.md`, `go/standard-library/log-and-slog.md` |
| Go 1.26 | `go fix` rebuilt around modernizers ✅[^6] | `go/tooling/go-command-and-build-reference.md` |
| Go 1.26 | Green Tea garbage collector on by default; cgo calls about 30% cheaper ✅[^6] | `go/runtime/memory-allocation-and-gc.md`, `go/low-level/unsafe-and-cgo.md` |
| Go 1.27 | Generic methods; struct literal keys may be any field selector; function type inference in more assignments ✅[^7] | `go/generics/generic-types-methods-and-inference.md`, `go/data-types/structs-and-pointers.md` |
| Go 1.27 | New `uuid` package; generic method `(*Rand).N` in `math/rand/v2` ✅[^7] | `go/standard-library/random-numbers-and-uuids.md` |
| Go 1.27 | `encoding/json/v2` and `encoding/json/jsontext`; `encoding/json` backed by the v2 implementation ✅[^7] | `go/standard-library/io-and-encoding-json.md` |
| Go 1.27 | `goroutineleak` profile generally available; `asynctimerchan` setting removed ✅[^7] | `go/concurrency/patterns-and-goroutine-leaks.md`, `go/runtime/profiling-and-diagnostics.md`, `go/concurrency/goroutines-and-channels.md` |
| Go 1.27 | `go test` runs the `stdversion` vet check; size-specialized small allocations ✅[^7] | `go/tooling/testing-benchmarks-and-fuzzing.md`, `go/runtime/memory-allocation-and-gc.md` |

### Free, authoritative resources

| Resource | Why |
|---|---|
| [The Go Programming Language Specification](https://go.dev/ref/spec) | The definition of the language; every doc's rules come back to it |
| [A Tour of Go](https://go.dev/tour/) | Interactive first contact with the syntax, in the browser |
| [Effective Go](https://go.dev/doc/effective_go) | Idioms for the core language, from 2009 |
| [The Go Memory Model](https://go.dev/ref/mem) | What concurrent code may assume |
| [Go Modules Reference](https://go.dev/ref/mod) | Exact behaviour of `go.mod`, versions and the module proxy |
| [Release History](https://go.dev/doc/devel/release) | Every release with its notes; read the notes of each new release |
| [Standard library](https://pkg.go.dev/std) | Package documentation with runnable examples |
| [A Guide to the Go Garbage Collector](https://go.dev/doc/gc-guide) | `GOGC`, `GOMEMLIMIT` and the cost model of the collector |
| [The Go Blog](https://go.dev/blog/) | Design background for features such as iterators, generics and Swiss-table maps |

## Lookup notes
- A stage's exercise asks you to predict before you run: the matching doc has the observed output, so read the doc after the run, not before.
- The Tour and Effective Go maps list only the sections those sources have; topics they never covered, such as `context`, modules, fuzzing, iterators and the runtime, appear only in the stages table and the release map.
- When a release map row names a Go version, the behaviour may also depend on the `go` line of your module, not only on the installed toolchain; `go/introduction/toolchain-and-compatibility.md` explains which.

## Takeaways
- Run every exercise in the pinned lab image and write the Go version next to what you observed: several rows above change behaviour between releases or with the module's `go` line.
- Learn stages 1 to 5 before concurrency: goroutines, channels and `context` assume closures, interfaces and error values.
- Read Effective Go for idioms, but take anything about generics, modules or newer libraries from the release notes and the docs here, since Effective Go predates them ✅[^8].

## Verification status
- Verified: 34 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Docker lab every exercise runs in.
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: the Go 1.21 rows. [^1]
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22) — Go team, 2024. Rank 1. Backs: the Go 1.22 rows. [^2]
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23) — Go team, 2024. Rank 1. Backs: the Go 1.23 rows. [^3]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: the Go 1.24 rows. [^4]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: the Go 1.25 rows. [^5]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: the Go 1.26 rows. [^6]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: the Go 1.27 rows. [^7]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, 2009, living. Rank 1. Backs: its section names; written for 2009 and not updated for generics or modules. [^8]
- [A Tour of Go](https://go.dev/tour/) — Go team, living. Rank 1. Background: the tour itself, linked from the resources table.
- [Tour content in the golang/website repository](https://github.com/golang/website/tree/master/_content/tour) — Go team, living. Rank 1. Backs: chapter and page names of the tour; slides and exercises with editable, runnable programs. [^10]

## Related
- `go/lab-setup.md` — the lab for every exercise.
- `go/introduction/toolchain-and-compatibility.md` — the first doc to read.
- `javascript/learning-path.md` and `linux/learning-path.md` — the same kind of path for other topics.
- `concurrency/` and `error-handling/` — cross-language views that the Go docs link to.
