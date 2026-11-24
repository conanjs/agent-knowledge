---
schema: topic-index/v1
kind: subtopic
topic: go/packages-modules
last-updated: 2026-11-24
---

# Go packages and modules

How Go code is split into packages and grouped into modules: the package clause and one package per directory, exported names, import forms, `internal/` directories, the order in which packages, variables and `init` functions are initialized, then `go.mod` and its directives, minimal version selection, `go.sum` and the checksum database, proxies and private modules, major version suffixes, pseudo-versions, vendoring and workspaces. Covers Effective Go's "Names", "Initialization" and "The blank identifier" sections and the Go Modules Reference. Not covered: what semantic versions promise (see `versioning/`), the `go` and `toolchain` lines as Go-version switches (see `go/introduction/`), every `go` subcommand and flag (see `go/tooling/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [packages-and-initialization.md](packages-and-initialization.md) | concept | Package clause and directories, naming, exported identifiers, import forms, `internal/`, import cycles, and the start-up order of imported packages, variables and `init` functions, measured in Go 1.27.4 | verified |
| [modules-and-dependencies.md](modules-and-dependencies.md) | concept | `go.mod` directives (including `tool` and `ignore`), minimal version selection run offline against a file proxy, `go.sum` and a checksum mismatch, proxies and `GOPRIVATE`, `/v2` paths, pseudo-versions, vendoring and `go.work` | verified |

## References
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Backs: package and initialization rules.
- [Go Modules Reference](https://go.dev/ref/mod) — Go team, living. Backs: subtopic scope for modules.

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `go/tooling/` — the `go` command, build constraints and testing.
- `versioning/` — semantic versioning and pinning.
