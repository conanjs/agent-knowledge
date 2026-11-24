---
schema: topic-index/v1
kind: subtopic
topic: go/introduction
last-updated: 2026-11-24
---

# Go: getting started with the toolchain

What a Go program is (`package main`, `func main`), the `go` command and `gofmt` at concept level, why the compiler rejects unused imports and variables, the Go 1 compatibility promise and the release policy, and how `go.mod`'s `go`, `toolchain` and `godebug` lines choose the toolchain, the language version and the GODEBUG defaults. Not covered: every subcommand and build flag (see `go/tooling/`), module dependencies and `go.sum` (see `go/packages-modules/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [toolchain-and-compatibility.md](toolchain-and-compatibility.md) | concept | Program structure, the `go` command and `gofmt`, the Go 1 compatibility promise and its exceptions, release policy, `go`/`toolchain` lines and `GOTOOLCHAIN` switching, GODEBUG defaults and `//go:debug`, what `go mod init` writes in Go 1.27.4 | verified |

## References
- [Go Toolchains](https://go.dev/doc/toolchain) — Go team, living. Backs: subtopic scope.
- [Go 1 and the Future of Go Programs](https://go.dev/doc/go1compat) — Go team, living. Backs: subtopic scope.

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `go/lab-setup.md` — the Docker lab every example ran in.
- `go/tooling/` — the `go` command in full.
