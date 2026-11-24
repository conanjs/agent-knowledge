---
schema: knowledge-doc/v1
type: concept
topic: go/introduction
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "Go 1.21 and later for toolchain switching and GODEBUG defaults"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, toolchain, go-command, gofmt, compatibility, go-mod, gotoolchain, godebug, release-policy]
ranked-sources: true
---

# The go command, compatibility and versions

## Summary
**TL;DR:** A Go program is a `main` package with a `func main()`; the `go` command builds, runs, tests, vets and formats it, and `gofmt` gives every file one standard layout. Go promises that code written for Go 1 keeps compiling and running, with a short list of stated exceptions. Each module's `go.mod` says which Go version it needs: the `go` line is both the minimum toolchain and the language version the compiler enforces, the `toolchain` line suggests a newer toolchain, and the same `go` line also picks the module's GODEBUG defaults, the switches that keep old behaviour after a compatible-but-breaking change.
**Use this when:** starting a Go project, reading or editing a `go.mod` file, choosing which Go version a module should declare, upgrading Go, or debugging an error such as `requires go >= 1.28` or `requires go1.22 or later (-lang was set to go1.21)`.
**Not this doc:** every `go` subcommand and build flag → `go/tooling/go-command-and-build-reference.md`; `require`, minimal version selection and `go.sum` → `go/packages-modules/modules-and-dependencies.md`; semantic versioning in general → `versioning/semantic-versioning.md`.

## Problem
Go code that builds on one machine fails on another with `go.mod requires go >= 1.28`. A loop that captured its variable correctly in one module prints the wrong values in another. A program that compiled yesterday refuses to compile because of an unused import. Raising the `go` line from 1.20 to 1.21 changes how `panic(nil)` behaves, with the same compiler. Each of these comes from the same few rules: what the `go` command checks, what the `go` line in `go.mod` means, and which old behaviours Go keeps behind GODEBUG settings.

## Mental model
**Analogy:** `go.mod` is a recipe card. The `go 1.27` line says "this recipe needs at least a version-1.27 kitchen, and cook it by the 1.27 rules". The `toolchain` line says "a newer kitchen is preferred if you have one". The `godebug` lines say "but keep the old oven setting for this one dish". The `go` command is the cook who reads the card before touching the stove: if the kitchen is too old, it either fetches a newer one or refuses.

**Artifact:** the smallest program and the `go.mod` that `go mod init lab` wrote in the Go 1.27.4 lab ✅[^1]:
```go
package main

import "fmt"

func main() { fmt.Println("hello from the lab") }
```
```text
module lab

go 1.27.4
```

## How it works

### 1. Program structure and the compiler's strictness
- A program is the package named `main`, linked with every package it imports; it must declare `func main()` with no arguments and no results ✅[^2].
- The program exits when `main` returns, without waiting for other goroutines ✅[^2].
- Importing a package without using any of its exported names is illegal; to import a package only for its initialization side effects, import it under the blank name `_` ✅[^2].
- The Go compiler refuses to build programs with unused imports or unused local variables, and it has no warnings at all, only errors ✅[^4]. In Go 1.27.4 an unused `os` import and an unused `x` give `"os" imported and not used` and `declared and not used: x` ✅[^1].
- To keep something temporarily, assign it to the blank identifier (`_ = debugData`), or let the `goimports` tool fix import lists ✅[^4].

### 2. The `go` command and `gofmt`
- `go` is one command with subcommands; the Go 1.27.4 help lists `build`, `run`, `test`, `vet`, `fmt`, `mod`, `doc`, `install`, `get`, `list`, `env`, `fix`, `generate`, `work`, `tool`, `version`, `clean`, `bug` and `telemetry` ✅[^5].
- `gofmt` rewrites source into the standard indentation and alignment, and `go fmt` runs it over a whole package; Effective Go's advice is to let the tool decide layout rather than argue about it ✅[^3].
- `gofmt -l` lists files whose layout differs and `gofmt -d` prints the diff. `go vet` checks for likely mistakes, not layout: on a badly formatted but correct file, vet passed while `gofmt -l` listed the file ✅[^1].
- Since Go 1.26, `go fix` is the home of the "modernizers", fixers that rewrite code to newer idioms and application programming interfaces (APIs), built on the same analysis framework as `go vet` ✅[^10].

### 3. The Go 1 compatibility promise
- Go 1 defines a language specification and a set of standard-library APIs. Programs written to that specification are intended to keep compiling and running, unchanged, across Go 1.x releases ✅[^6].
- Compatibility is at the source level: compiled packages must be rebuilt for each release ✅[^6].
- The stated exceptions: security fixes, programs that rely on unspecified behaviour, fixes to errors in the specification, programs that rely on a compiler or library bug, unkeyed struct literals of another package's types (a new field breaks them), method conflicts when a new method appears on an embedded type, dot imports (`import . "pkg"`), and code that imports `unsafe` ✅[^6].
- Release policy: each major release is supported until there are two newer major releases, and supported releases get minor revisions for critical problems, security issues included ✅[^7]. Go 1.26 arrived in February 2026 and Go 1.27 in August 2026, six months apart ✅[^10] ✅[^11]; Go 1.27.4 was released on 2026-11-10 ✅[^7].
- Version numbers: a release is `1.N.P`, the P-th release of Go 1.N; the first one is `1.N.0` (since Go 1.21, which renamed its first release Go 1.21.0), and release candidates before it are `1.NrcR` ✅[^8] ✅[^14]. `1.N` on its own is a *language version*: `1.21`, `1.21rc2` and `1.21.3` all implement language version 1.21 ✅[^8]. The lab toolchain reports itself as `go1.27.4` ✅[^1].

### 4. The `go` and `toolchain` lines: who decides which compiler runs
Four actors take part:
- **The `go` command** — its job: pick which toolchain runs, via the `GOTOOLCHAIN` setting and the `go.mod` lines.
- **`go.mod`** (or `go.work` in a workspace) — its job: declare what the module needs, via its `go`, `toolchain` and `godebug` lines.
- **The compiler** — its job: enforce one language version per file, via the module's `go` line or a file's `//go:build go1.N` line.
- **The built program** — its job: run with the GODEBUG defaults compiled into it, via the `GODEBUG` environment variable at run time for overrides.

```
 you: go build                      [local]
   │
   ▼
 go command ── reads GOTOOLCHAIN (env → go env -w file → $GOROOT/go.env → "local")
   │           reads go.mod: go 1.N.P, toolchain goX, godebug ...
   │
   ├─ bundled toolchain ≥ go/toolchain line?  ── yes ──► use bundled toolchain
   │
   └─ no:  GOTOOLCHAIN=local  ──────────────────────────► error "requires go >= …"
           GOTOOLCHAIN=auto   ── look in PATH for goX ──► found: run it
                                   │ not found
                                   ═══ network: module proxy ═══ download, verify, run
   ▼
 compiler: language version = go line (or //go:build go1.N per file)
   ▼
 program: GODEBUG defaults = toolchain defaults, amended to the go line, then godebug / //go:debug
```

Step by step:
1. **go command (local):** reads `GOTOOLCHAIN` from the process environment, then the user's `go env -w` file, then `$GOROOT/go.env`; standard toolchains ship `GOTOOLCHAIN=auto` there, and with no setting at all the default is `local` ✅[^8]. The official Docker image sets `GOTOOLCHAIN=local` in its environment, while its `go.env` still says `auto` ✅[^1].
2. **go command reads `go.mod` (local):** the `go` line is the minimum Go version for using the module; with no `go` line a `go.mod` counts as `go 1.16` ✅[^8]. The `toolchain` line suggests a toolchain; when it is absent the module behaves as if it said `toolchain go<version of the go line>` ✅[^8].
3. **go command decides (local):** with `local`, the bundled toolchain always runs, and since Go 1.21 a toolchain refuses a module whose `go` line is newer than itself ✅[^8]. In the lab, Go 1.27.4 with `GOTOOLCHAIN=local` on a `go 1.28` module printed `go: go.mod requires go >= 1.28 (running go 1.27.4; GOTOOLCHAIN=local)` ✅[^1].
4. **go command switches (network):** with `auto` (short for `local+auto`), a newer `toolchain` or `go` line makes the go command look in `PATH` for a program named like `go1.21.9`, and otherwise download and verify that toolchain ✅[^8]. With `GOTOOLCHAIN=auto` and no network, the lab printed `go: downloading go1.28.0 (linux/arm64)` and then failed to reach the module proxy ✅[^1]. Since Go 1.24, `GODEBUG=toolchaintrace=1` traces this choice ✅[^8].
5. **compiler (local):** the `go` line sets the language version the compiler enforces for the module's packages; a file with `//go:build go1.22` (or newer) is compiled with that newer language version ✅[^8]. In a `go 1.21` module, `for i := range 3` failed with `requires go1.22 or later (-lang was set to go1.21; check go.mod)`; adding `//go:build go1.22` to the file made it compile and print `012` ✅[^1].

`go get go@latest` raises the `go` line the same way `go get` raises a dependency, and a module's `go` line must be at least the `go` line of every module it requires ✅[^8].

### 5. GODEBUG: keeping old behaviour after a permitted change
- A GODEBUG setting is a `key=value` pair that switches one part of a program back to an older behaviour; the `GODEBUG` environment variable holds a comma-separated list, and unknown names in it are ignored ✅[^9].
- Settings added for compatibility are kept for at least two years (four releases) ✅[^9].
- Defaults come from three places, in order: the defaults of the toolchain that built the program, amended to match the `go` line of the main module (the "work module"), then explicit `//go:debug` lines in the main package ✅[^9]. Settings introduced for security releases apply to all versions ✅[^9].
- Since Go 1.23, `go.mod` (or `go.work`) may list `godebug` lines, including `default=go1.21` to take all unlisted defaults from another version; only the main module's lines count ✅[^9].
- An unknown `//go:debug` setting makes the program invalid ✅[^9]; Go 1.27.4 reported `invalid //go:debug: unknown //go:debug setting "nosuchsetting"` ✅[^1].
- `go list -f '{{.DefaultGODEBUG}}' <package>` prints the defaults compiled into a main package, as differences from the toolchain's own defaults ✅[^9].
- Go 1.27 removed several settings (for example `asynctimerchan` and `gotypesalias`). The go command still accepts a removed setting in `go.mod` or `//go:debug` when it is set to its final default value, and fails when it is set to an old value ✅[^11]. In the lab, `godebug asynctimerchan=0` built and `godebug asynctimerchan=1` failed with `removed GODEBUG "asynctimerchan" set to old value "1"` ✅[^1].

### 6. What `go mod init` writes
- `go mod init [module-path]` creates `go.mod` in the current folder; the file must not exist yet ✅[^5].
- The Go 1.26 release notes say a 1.N.X toolchain writes `go 1.(N-1).0`, to favour versions that supported releases can still build ✅[^10]; the go1.26.0 source calls a `DefaultModInitGoVersion` function that steps back one release (two for pre-releases) ✅[^13].
- Go 1.27.4 behaves differently: its source passes the toolchain's own version to the new `go` line ✅[^12], and in the lab `go mod init lab` wrote `go 1.27.4` with both `GOTOOLCHAIN=local` and `GOTOOLCHAIN=auto` ✅[^1]. The Go 1.27 release notes do not mention the change ✅[^11]. Run `go get go@1.26.0` (or edit the line) right after `go mod init` when the module should build with an older supported release.

## Worked example
The same program changes behaviour when only the `go` line changes. The program recovers from `panic(nil)`:
```go
package main

import "fmt"

func main() {
	defer func() {
		r := recover()
		fmt.Printf("recovered %T: %v\n", r, r)
	}()
	panic(nil)
}
```

| Step | `go.mod` says | `go list -f '{{.DefaultGODEBUG}}' .` | `go run .` prints |
|---|---|---|---|
| 1 | `go 1.20` | a long list that includes `panicnil=1` ✅[^1] | `recovered <nil>: <nil>` ✅[^1] |
| 2 | `go 1.27` | empty: no differences from the toolchain defaults ✅[^1] | `recovered *runtime.PanicNilError: runtime error: panic called with nil argument` ✅[^1] |

Why: Go 1.21 added the `panicnil` setting with default `panicnil=0`, which turns `panic(nil)` into a run-time error; a module that still says `go 1.20` gets `panicnil=1`, the Go 1.20 behaviour ✅[^9]. Both runs used the same Go 1.27.4 toolchain; only the recipe card changed.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `go.mod` has no `go` line | Treated as `go 1.16` ✅[^8] | Compatibility with files written before the line existed |
| Dependency declares `go 1.22.0`, your module says `go 1.21.3` | Not allowed ✅[^8] | Your `go` line must be ≥ every required module's `go` line |
| Two `//go:debug` lines for the same setting | Invalid program ✅[^9] | Each setting may be set once |
| `//go:debug` outside a main package or its tests | Ignored by the toolchain; `go vet` reports it as misplaced ✅[^9] | Only the main package's defaults are compiled into a binary |
| `godebug` lines in a dependency's `go.mod` | Ignored ✅[^9] | Only the main module or workspace decides |
| Unkeyed literal `pkg.T{3, "x"}` of another package's struct | May stop compiling when that struct gains a field ✅[^6] | Listed exception to the compatibility promise; use keyed literals |
| `go test` on a module declaring an old `go` line uses a too-new standard-library function | Since Go 1.27, `go test` runs the `stdversion` vet check by default and reports it ✅[^11] | The `go` line also limits which standard-library symbols a file may use |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Low `go` line (oldest supported release) | More users and dependents can build the module | No newer language features; old GODEBUG defaults apply |
| High `go` line (latest release) | Newest language features and defaults | Users on older toolchains must switch or upgrade |
| `toolchain` line above the `go` line | Developers in the module get a newer toolchain; dependents keep the low minimum ✅[^8] | One more line to keep current |
| `GOTOOLCHAIN=local` (as in the official image) | Never downloads a toolchain | Builds fail on any module that needs a newer Go |

## Takeaways
- Keep code `gofmt`-clean and run `go vet` in CI (continuous integration); neither is optional style. [rule-candidate]
- Set the `go` line deliberately: it is the minimum toolchain, the language version and the GODEBUG baseline at once. Check it after `go mod init`, which in Go 1.27.4 writes the toolchain's own version. [rule-candidate]
- Use keyed struct literals for types from other packages, so new fields cannot break the build. [rule-candidate]
- When an upgrade changes behaviour, look for a GODEBUG setting before rewriting code, and plan to drop it: compatibility settings last at least two years.

## Verification status
- Verified: 63 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §Program execution, §Import declarations. [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Formatting (`gofmt`, `go fmt`). [^3]
- [Frequently Asked Questions (FAQ)](https://go.dev/doc/faq) — Go team, living. Rank 1. Backs: unused variables and imports are errors, no warnings, blank-identifier workaround, `goimports`. [^4]
- [go command (cmd/go)](https://pkg.go.dev/cmd/go) — Go team, Go 1.27. Rank 1. Backs: the subcommand list, `go mod init`. [^5]
- [Go 1 and the Future of Go Programs](https://go.dev/doc/go1compat) — Go team, living. Rank 1. Backs: the compatibility promise and its exceptions. [^6]
- [Release History](https://go.dev/doc/devel/release) — Go team, living. Rank 1. Backs: release policy, release dates. [^7]
- [Go Toolchains](https://go.dev/doc/toolchain) — Go team, living. Rank 1. Backs: version syntax `1.N.P`, `1.NrcR` and language versions; `go` and `toolchain` lines, `GOTOOLCHAIN` forms and lookup order, switching and downloads, per-file language version, `toolchaintrace`. [^8]
- [Go, Backwards Compatibility, and GODEBUG](https://go.dev/doc/godebug) — Go team, living. Rank 1. Backs: GODEBUG settings, defaults and their order, `godebug` and `//go:debug`, `panicnil`, `DefaultGODEBUG`. [^9]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: release month, `go fix` modernizers, `go mod init` default version. [^10]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: release month, removed GODEBUG settings, `stdversion` in `go test`. [^11]
- [cmd/go/internal/modload/init.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/cmd/go/internal/modload/init.go) — Go team, 2026. Rank 1. Backs: `CreateModFile` adds the toolchain's own version as the `go` line. [^12]
- [cmd/go/internal/modload/init.go at go1.26.0](https://github.com/golang/go/blob/go1.26.0/src/cmd/go/internal/modload/init.go) — Go team, 2026. Rank 1. Backs: `DefaultModInitGoVersion` in Go 1.26.0. [^13]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: the first release of a family is numbered `1.N.0` starting with Go 1.21. [^14]

## Related
- `go/learning-path.md` — where this doc sits in the learning order.
- `go/tooling/go-command-and-build-reference.md` — the full catalog of subcommands, flags and build constraints.
- `go/packages-modules/modules-and-dependencies.md` — `require`, minimal version selection, `go.sum`, workspaces.
- `go/fundamentals/control-flow-and-functions.md` — the per-iteration loop variables that the `go` line switches on.
- `go/lab-setup.md` — the Docker lab used for every example.
- `versioning/semantic-versioning.md` — version numbers in general.
