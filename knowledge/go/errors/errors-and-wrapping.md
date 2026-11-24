---
schema: knowledge-doc/v1
type: concept
topic: go/errors
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "errors.Is/As/Unwrap since Go 1.13", "errors.Join and multiple %w since Go 1.20", "errors.AsType since Go 1.26"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, errors, error-wrapping, errors-is, errors-as, errors-astype, errors-join, sentinel-errors, fmt-errorf, go-vet]
ranked-sources: true
---

# Errors as values: wrapping, `errors.Is`, `As`, `AsType` and `Join`

## Summary
**TL;DR:** In Go an error is any value with an `Error() string` method, returned as the last result, with `nil` meaning "no error". Add context with `fmt.Errorf("doing x: %w", err)`; `%w` *wraps* the cause so callers can still find it with `errors.Is` (match a specific value, a *sentinel*) or `errors.As` / `errors.AsType` (match a type, and get its fields), which search the whole tree of wrapped errors. Wrapping is an API (application programming interface) promise: once you wrap a dependency's error, callers may depend on it, so use `%v` when the cause is an implementation detail.
**Use this when:** adding context to an error, checking which error happened, defining your own error values or types, combining several errors into one, or reading a `go vet` report about `%w`.
**Not this doc:** where in a call chain to log or handle an error → `error-handling/handle-errors-once.md`; designing error types for a library versus an application → `error-handling/library-vs-application-errors.md`; `panic` and `recover` → `go/errors/panic-and-recover.md`; why a nil pointer returned as `error` is not nil → `go/methods-interfaces/interfaces.md`.

## Problem
A caller writes `if err == ErrNotFound` and it stops matching the day a lower layer starts adding context. Another parses `err.Error()` with `strings.Contains` because the information it needs is only in the text. A library wraps a database driver's error, a caller starts testing for it, and switching drivers later breaks that caller. Go 1.13 and later give precise tools for each case, but only if errors are built and checked with them.

## Mental model
**Analogy:** a wrapped error is a set of nested envelopes. Each layer writes a note on a new envelope ("load user: …") and puts the previous envelope inside. `err.Error()` reads all the notes at once; `errors.Is` opens envelopes one by one looking for a specific letter; `errors.As` opens them looking for a letter of a specific kind (a form with fields). Writing `%v` instead of `%w` photocopies the inner note onto the new envelope and throws the inner envelope away: the text survives, the letter does not.

**Artifact:** a sentinel, a typed error and a wrap, run in Go 1.27.4 ✅[^1]:
```go
var ErrNotFound = errors.New("not found") // sentinel value

type QueryError struct { // typed error
	Query string
	Err   error
}

func (e *QueryError) Error() string { return "query " + e.Query + ": " + e.Err.Error() }
func (e *QueryError) Unwrap() error { return e.Err }

err := fmt.Errorf("load user: %w", &QueryError{Query: "id=42", Err: ErrNotFound})
fmt.Println(err)                         // load user: query id=42: not found
fmt.Println(errors.Is(err, ErrNotFound)) // true
fmt.Println(err == ErrNotFound)          // false
```

## How it works
1. **The `error` interface.** The predeclared type `error` is an interface with one method, `Error() string`; it is the conventional way to report an error, and the nil value means no error ✅[^2]. Functions return it next to their normal result, and a library may implement it with a richer type, as `os.Open` does with `*os.PathError` (fields `Op`, `Path`, `Err`) ✅[^3].
2. **Errors are values.** Because errors are ordinary values, code can store them, pass them around and program with them; one example is a writer that records the first error and turns later writes into no-ops, so the caller checks once at the end ✅[^5].
3. **Creating errors.** `errors.New(text)` returns an error that prints as `text`; every call returns a distinct value even for identical text ✅[^4] ✅[^1]. That distinctness is what makes a package-level `var ErrX = errors.New(…)` usable as a *sentinel*: callers compare against that one value.
4. **Wrapping.** An error `e` wraps `w` when `e`'s type has `Unwrap() error` returning `w`, or `Unwrap() []error` returning a slice containing `w` ✅[^4]. `fmt.Errorf` with a `%w` verb returns an error whose `Unwrap` returns the operand; with several `%w` verbs it returns one whose `Unwrap` returns a `[]error` of all of them, in order; otherwise `%w` acts like `%v` ✅[^6]. Several `%w` verbs, `Unwrap() []error` and `errors.Join` arrived in Go 1.20 ✅[^7].
5. **The error tree.** Repeated unwrapping forms a tree; `Is`, `As` and `AsType` examine the error itself, then each child's tree in turn, depth-first in pre-order ✅[^4].
6. **`errors.Is(err, target)`** reports whether any error in the tree matches `target`: equal to it, or having a method `Is(error) bool` that returns true for it; `target` must be comparable ✅[^4]. Prefer it to `err == target`, because it still succeeds when `err` wraps the target ✅[^4].
7. **`errors.As(err, &target)` and `errors.AsType[E](err)`.** `As` finds the first error in the tree assignable to the value `target` points to (or whose `As(any) bool` method accepts it), stores it in `target` and returns true; it panics if `target` is not a non-nil pointer to an error type or to an interface type ✅[^4]. `AsType`, added in Go 1.26, is the generic form: it returns the match and a bool instead of filling a variable, and the documentation recommends it for most uses ✅[^4] ✅[^8]. Both succeed where a plain type assertion fails, because they look through wrapped errors ✅[^4].
8. **`errors.Join(errs...)`** wraps all non-nil errors given; it returns nil when all are nil; its message is the messages joined by newlines; and the result implements `Unwrap() []error` ✅[^4]. `errors.Unwrap` only calls `Unwrap() error`, so it returns nil for an error made by `Join` or by several `%w` ✅[^4] ✅[^1].
9. **Wrap or not is an API decision.** Wrap to expose an error to callers; do not wrap when that would expose an implementation detail, because once callers can test for a wrapped error, you must keep returning it ✅[^9]. The message text is the same either way; the choice only decides whether programs can inspect the cause ✅[^9].
10. **Message style.** Error strings should identify their origin, for example with a prefix naming the operation or package, so they stay useful when printed far from the call ✅[^3].
11. **Go 1.27 vet check.** The `printf` analyzer now reports `fmt.Errorf("…: %w", p)` when `p` has type `*E` and `E` itself implements `error`, because wrapping such a pointer makes type assertions and `errors.Is` checks fail unexpectedly ✅[^10]. In the lab, `go test` on the same package failed with that report and `[build failed]`, so the check also stops tests ✅[^1].

## Worked example
Every operation on one chain, from the same Go 1.27.4 run ✅[^1]:

| Code | Output | Why |
|---|---|---|
| `errors.New("x") == errors.New("x")` | `false` | Each `New` call is a distinct value ✅[^4] |
| `errors.As(err, &qe)` with `var qe *QueryError` | `true`, `qe.Query == "id=42"` | `*QueryError` is one level down the tree ✅[^4] |
| `qe2, ok := errors.AsType[*QueryError](err)` | `ok == true`, same query | Generic form of `As`, Go 1.26 ✅[^8] |
| `errors.Is(fmt.Errorf("load user: %v", inner), ErrNotFound)` | `false` | `%v` formats the text but does not wrap ✅[^6] |
| `errors.Unwrap(err)` | `query id=42: not found` | One step down through `Unwrap() error` ✅[^4] |
| `multi := fmt.Errorf("both: %w and %w", ErrNotFound, fs.ErrPermission)` | `both: not found and permission denied`; `Is` true for both; `errors.Unwrap(multi)` is `<nil>` | Two `%w` give `Unwrap() []error`, which `errors.Unwrap` ignores ✅[^6] ✅[^4] |
| `errors.Join(ErrNotFound, nil, fs.ErrPermission)` | `not found` and `permission denied` on two lines; `Is(…, fs.ErrPermission)` true | Nil discarded, messages joined by newline ✅[^4] |
| `errors.Join(nil, nil) == nil` | `true` | All inputs nil ✅[^4] |
| `_, oerr := os.Open("/does/not/exist")` | `open /does/not/exist: no such file or directory`; `errors.Is(oerr, fs.ErrNotExist)` true; `errors.As(oerr, &pe)` gives `pe.Op == "open"` | The standard library's own typed error, `*fs.PathError` ✅[^3] |

The Go 1.27 vet check, from the same lab ✅[^1]:
```go
type E struct{}

func (E) Error() string { return "E" } // E (the value type) implements error

err := fmt.Errorf("wrap: %w", &E{})          // the operand is *E
var target E
fmt.Println(errors.As(err, &target))         // false: the tree holds *E, not E
```
```console
$ go vet ./...
main.go:14:27: %w wants operand of error type E, not pointer type *E (defeats errors.Is)
$ go test ./...
./main.go:14:27: %w wants operand of error type E, not pointer type *E (defeats errors.Is)
FAIL	lab [build failed]
```

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A function returns a nil `*QueryError` variable as `error` | The caller sees `err != nil` | The interface holds a type and a nil pointer; see `go/methods-interfaces/interfaces.md` |
| `%w` with an operand that is not an `error` | Invalid use of `%w` | `fmt` requires an error operand for `%w` ✅[^6] |
| `errors.As(err, qe)` (not a pointer to a target) | Panic | `As` requires a non-nil pointer to an error type or interface ✅[^4] |
| `errors.Is` with a target of an uncomparable type | Not allowed | The target must be comparable ✅[^4] |
| An `Unwrap() []error` method returns a slice with a nil inside | Invalid by the package contract | Stated in the `errors` overview ✅[^4] |
| A custom error type needs to match an existing sentinel | Give it a method `Is(target error) bool` | `Is` calls such a method ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Sentinel value (`var ErrNotFound = errors.New(…)`) | Cheap to compare with `errors.Is`; easy to document | Carries no fields; becomes part of the API ✅[^9] |
| Typed error (`*QueryError`) | Carries fields such as the query or path, read with `As`/`AsType` ✅[^3] ✅[^4] | More code; the type becomes part of the API |
| Wrap with `%w` | Callers can inspect the cause ✅[^9] | You must keep returning that cause in future versions ✅[^9] |
| Annotate with `%v` | Keeps the abstraction; the text is identical ✅[^9] | Callers cannot test for the cause |
| `errors.Join` | Reports every failure of a batch at once ✅[^4] | `errors.Unwrap` cannot walk it; callers must use `Is`/`As` ✅[^4] |

## Takeaways
- Check error identity with `errors.Is` and error types with `errors.AsType` (or `errors.As`), never with `==`, a plain type assertion or the message text. [rule-candidate]
- Wrap with `%w` only the errors you are willing to support as part of your API; annotate the rest with `%v`. [rule-candidate]
- Start every error message with the operation or package that failed, so it reads well when the layers above prepend their own context.
- When a value type implements `error`, wrap the value, not a pointer to it; Go 1.27's `go vet` flags the pointer form.

## Verification status
- Verified: 49 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §Errors (the `error` interface, nil means no error). [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Errors (`os.PathError`, error strings name their origin). [^3]
- [Package errors](https://pkg.go.dev/errors) — Go team, living. Rank 1. Backs: wrapping definition, the error tree, `New`, `Is`, `As`, `AsType`, `Join`, `Unwrap`. [^4]
- [Package fmt](https://pkg.go.dev/fmt) — Go team, living. Rank 1. Backs: `Errorf` and the `%w` verb, single and multiple. [^6]
- [Go 1.20 Release Notes](https://go.dev/doc/go1.20) — Go team, 2023. Rank 1. Backs: wrapping multiple errors, `errors.Join`. [^7]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: `errors.AsType`. [^8]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: the vet `printf` check for `%w` with a pointer operand. [^10]
- [Errors are values](https://go.dev/blog/errors-are-values) — Go team, 2015. Rank 4. Backs: programming with error values, the `errWriter` pattern. [^5]
- [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors) — Go team, 2019. Rank 4. Backs: "Whether to Wrap", wrapping as part of the API. [^9]

## Related
- `go/errors/panic-and-recover.md` — the other failure path: panics and runtime errors.
- `go/methods-interfaces/interfaces.md` — interface values and the typed-nil error trap.
- `error-handling/handle-errors-once.md` — log or return, not both; add context per layer.
- `error-handling/library-vs-application-errors.md` — choosing error types by audience.
- `go/learning-path.md`
