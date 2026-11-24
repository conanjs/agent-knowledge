---
schema: topic-index/v1
kind: subtopic
topic: go/errors
last-updated: 2026-11-24
---

# Go errors, panic and recover

Errors as values: the `error` interface, sentinel and typed errors, wrapping with `%w`, the error tree searched by `errors.Is`, `errors.As` and Go 1.26's `errors.AsType`, `errors.Join` and multiple `%w` (Go 1.20), wrapping as an API decision and Go 1.27's vet check on `%w` with pointers; then panics: unwinding and deferred calls, where `recover` works, `runtime.Error`, `panic(nil)` since Go 1.21, goroutine panics ending the process, and the `net/http` server's per-request recovery. Covers Effective Go's Errors, Panic and Recover sections. Not covered: where to log and handle errors across layers (see `error-handling/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [errors-and-wrapping.md](errors-and-wrapping.md) | concept | `error`, `errors.New`, `fmt.Errorf` with `%w`, `Is`/`As`/`AsType`/`Join`/`Unwrap`, sentinel versus typed errors, when to wrap, Go 1.27 vet check | verified |
| [panic-and-recover.md](panic-and-recover.md) | concept | Panicking and deferred calls, `recover` only directly in a deferred function, run-time errors, `PanicNilError`, re-panic, goroutine panics, `net/http` recovery | verified |

## References
- [Package errors](https://pkg.go.dev/errors) — Go team, living. Backs: subtopic scope.
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Backs: subtopic scope (§Errors, §Panic, §Recover).

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `error-handling/handle-errors-once.md`, `error-handling/library-vs-application-errors.md` — cross-language error design.
- `go/methods-interfaces/interfaces.md` — the typed-nil error trap.
