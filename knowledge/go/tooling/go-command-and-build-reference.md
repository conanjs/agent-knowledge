---
schema: knowledge-doc/v1
type: reference
topic: go/tooling
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "cmd/go, cmd/compile, cmd/link and cmd/vet as documented on 2026-11-24"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, go-command, build-flags, ldflags, gcflags, trimpath, cross-compile, goos, goarch, cgo-enabled, build-constraints, go-build, go-embed, go-generate, go-debug, go-fix, go-vet, analyzers, modernizers, environment-variables]
ranked-sources: true
---

# The go command: subcommands, flags, build constraints and directives

## Summary
**TL;DR:** A lookup sheet for the `go` command in Go 1.27: its subcommands, the build flags they share, the environment variables that matter most, how build constraints and file-name suffixes pick files, the `//go:` directives, the 35 `go vet` analyzers and the 26 `go fix` modernizers, each checked against the documentation and, where marked, run in the lab.
**Use this when:** you need the exact flag, variable, directive or analyzer name, or want to know which files a build for another platform will include.
**Not this doc:** how tests, benchmarks and fuzzing work → `go/tooling/testing-benchmarks-and-fuzzing.md`; modules, `go.mod` and proxies → `go/packages-modules/modules-and-dependencies.md`; the `go`/`toolchain` lines and GODEBUG as compatibility tools → `go/introduction/toolchain-and-compatibility.md`; profiling flags → `go/runtime/profiling-and-diagnostics.md`.

## Scope
The `go` command of Go 1.27.4 on Linux arm64 (`golang:1.27.4`), its build flags, environment variables, build constraints, the `//go:` directives of the `go` command, compiler and linker, and the analyzers listed by `go tool vet help` and `go tool fix help`. Values in the "Lab" column are what the official image printed on 2026-11-24.

## Catalog

### Subcommands
| Command | Does | Notes |
|---|---|---|
| `go build` | Compiles packages and dependencies; writes an executable only for a single `main` package ✅[^2] | Name: last non-major-version element of the import path, plus `.exe` for Windows (`go build example.com/foo/v2` → `foo`) ✅[^2] |
| `go run` | Compiles and runs a `main` package ✅[^2] ✅[^1] | — |
| `go test` | Builds and runs tests, examples, benchmarks, fuzz tests ✅[^2] | See the testing doc |
| `go install` | Compiles and installs packages; `pkg@version` ignores the current `go.mod` ✅[^2] | Installs into `GOBIN` ✅[^2] |
| `go get` | Adds, upgrades, downgrades or removes requirements in `go.mod` ✅[^2] | `-tool` adds a `tool` line (Go 1.24) ✅[^7] |
| `go mod` | `download`, `edit`, `graph`, `init`, `tidy`, `vendor`, `verify`, `why` ✅[^2] | — |
| `go work` | `edit`, `init`, `sync`, `use`, `vendor` for `go.work` ✅[^2] | — |
| `go list` | Lists packages or modules; `-m` for modules, `-f` for a template ✅[^2] ✅[^1] | `go list -f '{{.GoFiles}}'` shows the files a build uses ✅[^1] |
| `go vet` | Runs the vet analyzers ✅[^2] | `-vettool=prog` swaps in another analysis tool ✅[^2] |
| `go fix` | Applies fixes from the fix analyzers; `-diff` prints a patch instead ✅[^2] | Rewritten in Go 1.26 on the `go vet` framework ✅[^9] |
| `go fmt` | Runs `gofmt -l -w` on packages ✅[^2] | — |
| `go generate` | Runs `//go:generate` commands ✅[^2] ✅[^1] | Never run by `go build` or `go test` ✅[^2] |
| `go doc` | Shows documentation | Go 1.25: `-http` serves docs ✅[^8]; Go 1.26: `go tool doc` removed ✅[^9]; Go 1.27: `pkg@version` and `-ex` ✅[^10] |
| `go env` | Prints or, with `-w`, sets defaults in the Go environment file ✅[^2] | — |
| `go tool` | Runs a toolchain tool or a module `tool` ✅[^2] | Lab: `go tool` lists `asm cgo compile cover fix link preprofile vet` ✅[^1]; since Go 1.25 other tools are built on first use ✅[^8] |
| `go version` | Prints the Go version; `-m` prints a binary's embedded module and build information ✅[^2] ✅[^1] | — |
| `go clean`, `go bug`, `go telemetry` | Remove build or test caches (`-cache`, `-testcache`, `-modcache`, `-fuzzcache`), start a bug report, manage telemetry ✅[^2] | — |

### Build flags (shared by build, clean, get, install, list, run and test)
| Flag | Effect | Lab or note |
|---|---|---|
| `-o file\|dir/` | Output file, or directory when it ends with a slash ✅[^2] | `GOOS=windows go build -o /tmp/out/ .` wrote `buildlab.exe` ✅[^1] |
| `-C dir` | Change directory first; must be the first flag ✅[^2] | — |
| `-race` | Data race detection; linux/amd64 and linux/arm64 (48-bit virtual address space only) are among the supported targets ✅[^2] | Needs cgo: with `CGO_ENABLED=0` the lab printed `go: -race requires cgo; enable cgo by setting CGO_ENABLED=1` ✅[^1]; see `go/lab-setup.md` |
| `-tags a,b` | Extra build tags, comma-separated (space-separated is deprecated) ✅[^2] | `-tags pro` picked `edition_pro.go` ✅[^1] |
| `-ldflags '[pattern=]args'` | Arguments for the linker ✅[^2] | `-X main.version=1.2.3` set a string variable ✅[^1] ✅[^6]; `-s` drops the symbol table and debug information, `-w` the DWARF (debugging-information format) symbol table ✅[^6] |
| `-gcflags '[pattern=]args'` | Arguments for the compiler; without a pattern only for the named packages, `all=` for every dependency ✅[^2] | `-gcflags=-m` prints optimization decisions such as escape analysis ✅[^5] |
| `-trimpath` | Removes file-system paths from the binary ✅[^2] | `go version -m` shows `build -trimpath=true` ✅[^1] |
| `-cover`, `-covermode`, `-coverpkg` | Coverage instrumentation; mode `set` (default), `count`, `atomic` (default with `-race`) ✅[^2] | `GOCOVERDIR` receives data from a `-cover` binary ✅[^2] |
| `-pgo file\|auto\|off` | Profile-guided optimization; `auto` (default) uses `default.pgo` in the main package's directory ✅[^2] | — |
| `-mod readonly\|vendor\|mod` | Module download mode; `vendor` is the default when `vendor/` exists and `go` ≥ 1.14 ✅[^2] | — |
| `-buildvcs true\|false\|auto` | Stamp version-control information into binaries ✅[^2] | — |
| `-json` | Build output as JSON (JavaScript Object Notation) ✅[^2] | — |
| `-a`, `-n`, `-x`, `-v`, `-p n`, `-work` | Force rebuild, print commands without running, print commands, print package names, parallelism, keep the work directory ✅[^2] | — |

### Environment variables
| Variable | Meaning | Lab (`golang:1.27.4`) |
|---|---|---|
| `GOOS`, `GOARCH` | Target operating system and architecture ✅[^2] | `linux`, `arm64` ✅[^1] |
| `CGO_ENABLED` | Whether cgo is supported, `0` or `1` ✅[^2] | `1`; a cross-build to `windows/amd64` recorded `CGO_ENABLED=0` ✅[^1] |
| `GOFLAGS` | Space-separated `-flag=value` defaults; values may not contain spaces; command-line flags override them ✅[^2] | — |
| `GOPROXY`, `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, `GOSUMDB`, `GOINSECURE` | Module download and verification ✅[^2] | `GOPROXY=https://proxy.golang.org,direct` ✅[^1] |
| `GOTOOLCHAIN` | Which toolchain runs ✅[^2] | `local` ✅[^1] |
| `GODEBUG` | Run-time and tool debugging settings; cannot be set with `go env -w` ✅[^2] | — |
| `GOEXPERIMENT` | Toolchain experiments; meant for developing Go itself, other use unsupported ✅[^2] | — |
| `GOCACHE`, `GOMODCACHE`, `GOBIN`, `GOPATH` | Build cache, module cache, install directory, Go path ✅[^2] | `/root/.cache/go-build`, `/go/pkg/mod`, `/go/bin`, `/go` ✅[^1]; `GOBIN` is unset in the image, and `go env` reports `$GOPATH/bin` ✅[^1] |
| `GOWORK` | `go.work` file to use, `off` to disable workspaces ✅[^2] | — |
| `GOENV` | Location of the Go environment file; `off` disables it; cannot be set with `go env -w` ✅[^2] | — |
| `GOAMD64`, `GOARM64`, `GOARM`, … | Instruction-set level per architecture, e.g. `GOAMD64=v1` (default) to `v4`, `GOARM64=v8.0` (default) ✅[^2] | `go version -m` showed `GOARM64=v8.0` ✅[^1] |

### Build constraints
| Rule | Detail |
|---|---|
| Syntax | `//go:build <expr>` with `\|\|`, `&&`, `!` and parentheses; at most one per file ✅[^2] |
| Position | Near the top, before the package clause, followed by a blank line ✅[^2] |
| Tags satisfied | `GOOS`, `GOARCH`, `unix`, the compiler (`gc`/`gccgo`), `cgo` when enabled, `go1.1` … up to the current release, architecture feature tags such as `amd64.v2`, and `-tags` values ✅[^2] |
| File-name suffixes | `*_GOOS.go`, `*_GOARCH.go`, `*_GOOS_GOARCH.go` add an implicit constraint ✅[^2]; on linux the lab built `name_other.go`, with `GOOS=windows` it built `name_windows.go` instead ✅[^1] |
| Platform families | `GOOS=android` also matches `linux` files and tags; `ios` matches `darwin`; `illumos` matches `solaris` ✅[^2] |
| Excluding a file | `//go:build ignore` by convention ✅[^2] |
| Language version | In a `go 1.21`+ module, a `go1.N` term in a file's constraint sets that file's language version ✅[^2] |
| Old syntax | `// +build` (Go 1.16 and earlier); `gofmt` adds the matching `//go:build` line ✅[^2] |
| Test files | `_test.go` files are left out of `go build` ✅[^2] |

### Directives
| Directive | Rule | Lab |
|---|---|---|
| `//go:embed patterns` | In a file that imports `embed`; above a package-level variable of type `string`, `[]byte` or `embed.FS`; `string`/`[]byte` take one file; patterns cannot contain `.` or `..` and cannot leave the module; files starting with `.` or `_` are skipped in directories unless the pattern starts with `all:` ✅[^3] | A file read into a `string` at compile time ✅[^1] |
| `//go:generate cmd args` | No space after `//`; runs only with `go generate`; sets `$GOFILE`, `$GOPACKAGE`, `$GOOS`, `$GOARCH`, `$GOLINE` and more; generated files start with a `// Code generated … DO NOT EDIT.` line ✅[^2] | Printed `generating for main.go in package main on linux/arm64` ✅[^1] |
| `//go:debug key=value` | Before the package clause of a `main` package (or in its `_test.go` files); an unknown key or a duplicate makes the program invalid ✅[^4] | `//go:debug panicnil=1` made `recover()` return `nil` after `panic(nil)`; without it the value was `*runtime.PanicNilError` ✅[^1] |
| `//go:fix inline` | Since Go 1.26: marks a function whose calls `go fix` may inline ✅[^9] | `go fix` rewrote `oldapi.Yell("hello")` to `oldapi.Shout("hello")` ✅[^1] |
| `//go:noinline`, `//go:nosplit`, `//go:noescape`, `//go:norace`, `//go:uintptrescapes` | Compiler function directives; `nosplit` outside runtime code can corrupt memory ✅[^5] | — |
| `//go:linkname local [importpath.name]` | Aliases an object-file symbol; only in files that import `unsafe` ✅[^5] | — |
| `//line file:line` | Changes reported positions, mostly in generated code ✅[^5] | — |

### `go vet` analyzers (Go 1.27.4, from `go tool vet help`, all run by default ✅[^1])
| Analyzer | Checks | Analyzer | Checks |
|---|---|---|---|
| `appends` | missing values after `append` | `nilfunc` | comparing functions with `nil` |
| `asmdecl` | assembly vs Go declarations | `printf` | `Printf` format vs arguments |
| `assign` | useless assignments | `shift` | shifts ≥ the integer width |
| `atomic` | common `sync/atomic` mistakes | `sigchanyzer` | unbuffered `os.Signal` channels |
| `bools` | mistakes with boolean operators | `slog` | invalid structured logging calls |
| `buildtag` | `//go:build` and `// +build` lines | `stdmethods` | signatures of well-known methods |
| `cgocall` | cgo pointer-passing rules | `stdversion` | standard-library symbols too new for the file's Go version |
| `composites` | unkeyed composite literals | `stringintconv` | `string(int)` conversions |
| `copylocks` | locks passed by value | `structtag` | struct tags vs `reflect.StructTag.Get` |
| `defers` | mistakes in `defer` statements | `testinggoroutine` | `t.Fatal` from goroutines started by a test |
| `directive` | toolchain directives such as `//go:debug` | `tests` | malformed tests, fuzzers, benchmarks, examples |
| `errorsas` | bad `errors.As` arguments | `timeformat` | `Format`/`Parse` with `2006-02-01` |
| `framepointer` | assembly clobbering the frame pointer | `unmarshal` | non-pointer values passed to unmarshal |
| `hostport` | address format passed to `net.Dial` | `unreachable` | unreachable code |
| `httpresponse` | mistakes using HTTP (Hypertext Transfer Protocol) responses | `unsafeptr` | invalid `uintptr` → `unsafe.Pointer` conversions |
| `ifaceassert` | impossible interface-to-interface assertions | `unusedresult` | unused results of some calls |
| `loopclosure` | loop variables referenced from nested functions | `waitgroup` | misuses of `sync.WaitGroup` |
| `lostcancel` | cancel func from `context.WithCancel` not called | — | — |

### `go fix` fixers (Go 1.27.4, from `go tool fix help` ✅[^1])
| Fixer | Rewrites | Fixer | Rewrites |
|---|---|---|---|
| `any` | `interface{}` → `any` | `rangeint` | 3-clause `for` loops → `for range n` |
| `atomictypes` | basic types in `sync/atomic` calls → atomic types | `reflecttypefor` | `reflect.TypeOf(x)` → `TypeFor[T]()` |
| `buildtag` | checks `//go:build` / `// +build` | `slicesbackward` | backward loops → `slices.Backward` |
| `embedlit` | references to embedded fields in composite literals | `slicescontains` | loops → `slices.Contains[Func]` |
| `errorsastype` | `errors.As` → `errors.AsType[T]` | `slicessort` | `sort.Slice` → `slices.Sort` for basic types |
| `forvar` | redundant loop-variable re-declarations | `stditerators` | Len/At-style APIs (application programming interfaces) → iterators |
| `hostport` | address format for `net.Dial` | `stringsbuilder` | `+=` → `strings.Builder` |
| `inline` | calls to `//go:fix inline` functions | `stringscut` | `strings.Index` etc. → `strings.Cut` |
| `mapsloop` | explicit map loops → `maps` package | `stringscutprefix` | `HasPrefix`/`TrimPrefix` → `CutPrefix` |
| `minmax` | if/else → `min`/`max` | `stringsseq` | ranging over `Split`/`Fields` → `SplitSeq`/`FieldsSeq` |
| `newexpr` | uses Go 1.26 `new(expr)` | `testingcontext` | `context.WithCancel` in tests → `t.Context` |
| `omitzero` | suggests `omitzero` instead of `omitempty` for struct fields | `unsafefuncs` | unsafe pointer arithmetic → function calls |
| `plusbuild` | removes obsolete `//+build` lines | `waitgroupgo` | `wg.Add(1)`/`go`/`wg.Done()` → `wg.Go` |

## Lookup notes
| Note | Detail |
|---|---|
| `-X` only sets strings | It works on a string variable that is uninitialized or initialized to a constant string expression ✅[^6] |
| `-gcflags`/`-ldflags` scope | Without a pattern they apply only to the packages named on the command line; use `all=` for dependencies ✅[^2] |
| Cross-builds and cgo | The lab's `windows/amd64` build recorded `CGO_ENABLED=0` although the host default is `1` ✅[^1] |
| `go generate` is manual | `go build` and `go test` never run it, so run `go generate` yourself before building ✅[^2] |
| `go generate` parses nothing | Lines that look like directives inside comments or multi-line strings are still run ✅[^2] |
| `go env -w` limits | `GODEBUG` and `GOENV` cannot be set with it ✅[^2] |
| Vet inside `go test` | `go test` runs only `atomic`, `bools`, `buildtag`, `directive`, `errorsas`, `ifaceassert`, `nilfunc`, `printf`, `stdversion`, `stringintconv` and `tests` ✅[^2] |
| Recently added analyzers | `tests` (Go 1.24) ✅[^7]; `waitgroup` and `hostport` (Go 1.25) ✅[^8]; in Go 1.27 `printf` also reports a `%w` operand of type `*E` when `E` itself implements `error` ✅[^10] |
| Fixer changes in Go 1.27 | Added `atomictypes`, `embedlit`, `slicesbackward`, `unsafefuncs`; removed `fmtappendf`; renamed `waitgroup` to `waitgroupgo` ✅[^10] |
| `go fix` and generated code | Fixes that would edit generated files are discarded ✅[^11] |
| Where to read a binary's settings | `go version -m <binary>` prints `-trimpath`, `CGO_ENABLED`, `GOOS`, `GOARCH` and the module path it was built from ✅[^1] |

## Takeaways
- Before debugging a platform-only build failure, list the files that build uses: `GOOS=<os> go list -tags <tags> -f '{{.GoFiles}}' .`.
- Stamp release versions with `-ldflags "-X main.version=…"` into an uninitialized string variable. [rule-candidate]
- Run the full `go vet ./...` in continuous integration; `go test` runs only a subset of its analyzers. [rule-candidate]
- Run `go fix ./...` from a clean working tree each time the project moves to a newer Go release, as the Go team recommends ✅[^11]. [rule-candidate]

## Verification status
- Verified: 109 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24: `go help`, `go tool`, `go tool vet help`, `go tool fix help`, build tags, file suffixes, `//go:embed`, `//go:generate`, `-ldflags -X`, `-trimpath`, cross-compilation, `//go:debug` and `//go:fix inline`. [^1]
- [Command go](https://pkg.go.dev/cmd/go) — Go team, living. Rank 1. Backs: subcommands, build flags, §Build constraints, §Generate Go files, §Environment variables, §Test packages, `go fix` and `go vet` flags. [^2]
- [Package embed](https://pkg.go.dev/embed) — Go team, living. Rank 1. Backs: `//go:embed` rules. [^3]
- [Go, Backwards Compatibility, and GODEBUG](https://go.dev/doc/godebug) — Go team, living. Rank 1. Backs: `//go:debug` placement and validity. [^4]
- [Command compile](https://pkg.go.dev/cmd/compile) — Go team, living. Rank 1. Backs: `-m`, compiler directives, `//go:linkname`, line directives. [^5]
- [Command link](https://pkg.go.dev/cmd/link) — Go team, living. Rank 1. Backs: `-X`, `-s`, `-w`. [^6]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: `go get -tool`, the `tests` analyzer. [^7]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: fewer prebuilt tools, `go doc -http`, the `waitgroup` and `hostport` analyzers. [^8]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: the rewritten `go fix`, `//go:fix inline`, `go tool doc` removed. [^9]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: new and renamed fixers, `go doc pkg@version` and `-ex`, the `printf` `%w` check. [^10]
- [Using go fix to modernize Go code](https://go.dev/blog/gofix) — Alan Donovan, Go blog, 2026. Rank 4. Backs: `go fix` discards fixes to generated files. [^11]

## Related
- `go/tooling/testing-benchmarks-and-fuzzing.md` — `go test` in depth.
- `go/packages-modules/modules-and-dependencies.md` — `go.mod`, `go get`, proxies and workspaces.
- `go/introduction/toolchain-and-compatibility.md` — `GOTOOLCHAIN`, the `go` line and GODEBUG.
- `go/runtime/profiling-and-diagnostics.md` — `-cpuprofile`, pprof and PGO profiles.
- `go/learning-path.md` — where this doc sits in the learning order.
