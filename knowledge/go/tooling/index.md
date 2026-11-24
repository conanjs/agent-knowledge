---
schema: topic-index/v1
kind: subtopic
topic: go/tooling
last-updated: 2026-11-24
---

# Go tooling: testing, debugging, vulnerability scanning and the go command

Testing Go code with `go test` and the `testing` package — table-driven tests and subtests, `t.Parallel`, cleanup and `t.Context`, examples, benchmarks with `b.Loop` compared with benchstat, fuzzing, coverage, the test cache and the vet checks `go test` runs, `testing/synctest` — debugging with Delve (scripted sessions, attaching, core dumps), finding known vulnerabilities with govulncheck, and a lookup sheet for the `go` command: subcommands, build flags, environment variables, build constraints and file suffixes, `//go:` directives, every `go vet` analyzer and `go fix` modernizer in Go 1.27. Not covered: modules and `go.mod` (see `go/packages-modules/`), profiling and PGO, profile-guided optimization (see `go/runtime/`), testing concurrent code in depth (see `go/concurrency/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [testing-benchmarks-and-fuzzing.md](testing-benchmarks-and-fuzzing.md) | concept | `go test` end to end in Go 1.27.4: `t.Error` vs `t.Fatal`, subtests and `t.Parallel`, cleanup order and `t.Context`, examples, `b.Loop` vs `b.N` (dead-code elimination measured), a fuzz run that finds a UTF-8 (Unicode byte encoding) bug, coverage, caching and vet, and comparing benchmark runs with benchstat | verified |
| [debugging-with-delve.md](debugging-with-delve.md) | how-to | Install Delve v1.27.2, script `dlv debug` and `dlv test` sessions, attach through ptrace in Docker, and read `GOTRACEBACK=crash` core dumps with `dlv core` | verified |
| [vulnerability-scanning-with-govulncheck.md](vulnerability-scanning-with-govulncheck.md) | how-to | Find known vulnerabilities with govulncheck v1.10.0: database entries, symbol, package and module levels, JSON and binary modes, exit codes, and fixing by upgrading | verified |
| [go-command-and-build-reference.md](go-command-and-build-reference.md) | reference | Subcommands, shared build flags, environment variables, build constraints and file suffixes, `//go:embed`/`generate`/`debug`/`fix inline` and compiler directives, the 35 vet analyzers and 26 fix modernizers of Go 1.27.4 | verified |

## References
- [Command go](https://pkg.go.dev/cmd/go) — Go team, living. Backs: subtopic scope.
- [Package testing](https://pkg.go.dev/testing) — Go team, living. Backs: subtopic scope.

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `go/packages-modules/` — packages, modules and `go.mod`.
- `performance/measurement/` — benchmarking methodology across languages.
- `testing/` — characterization tests and Gherkin scenarios.
