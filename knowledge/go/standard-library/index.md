---
schema: topic-index/v1
kind: subtopic
topic: go/standard-library
last-updated: 2026-11-24
---

# Go standard library essentials

The standard-library APIs (application programming interfaces) most Go code touches, beyond the built-in types: iterators and range over functions (`iter`, and the iterator functions in `slices`, `maps`, `strings` and `bytes`), streams (`io`, `bufio`) and JSON, JavaScript Object Notation (`encoding/json`, and since Go 1.27 `encoding/json/v2` and `jsontext`), HTTP (Hypertext Transfer Protocol) servers and clients (`net/http`, `net/http/httptest`), formatted printing (`fmt`), logging (`log`, `log/slog`), random numbers and UUIDs, universally unique identifiers (`math/rand/v2`, `crypto/rand`, `uuid`), time and clocks (`time`), files and file systems (`os`, `io/fs`, `os.Root`), command-line programs (`flag`, `os/exec`, `os/signal`), templates (`text/template`, `html/template`), images (`image` and its sub-packages), CSV, XML and binary encodings, SQL databases (`database/sql`) and TCP and UDP sockets with deadlines (`net`). Behaviours marked with each doc's lab footnote were run on Go 1.27.4 in `go/lab-setup.md`; the rest are checked against the official docs. Not covered: `context` (see `go/concurrency/`), `testing` (see `go/tooling/`), cryptography beyond random numbers, third-party database drivers beyond the one used in the lab, and the many smaller packages.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [iterators.md](iterators.md) | concept | Range over functions (Go 1.23), `iter.Seq`/`Seq2`, the `yield` contract and its panic, cleanup on `break`, single-use iterators, `iter.Pull` and `stop`, standard iterator functions, a paginated source as an iterator | verified |
| [io-and-encoding-json.md](io-and-encoding-json.md) | concept | The `io.Reader`/`Writer` contracts and `io.EOF`, `Copy`/`ReadAll`/`ReadFull`, limit/tee/multi adapters, `bufio.Writer.Flush` and the 64 KiB `Scanner` limit; `encoding/json` tags, `omitempty` versus `omitzero`, decoding rules, and the stricter `encoding/json/v2` defaults of Go 1.27 | verified |
| [net-http.md](net-http.md) | concept | Handlers and middleware, Go 1.22 `ServeMux` patterns and precedence, server and client timeouts, closing bodies, request-context cancellation, handler panics, graceful `Shutdown`, testing with `httptest` | verified |
| [fmt-and-printing.md](fmt-and-printing.md) | concept | The Print, Sprint, Fprint and Append families and their spacing, general and per-type verbs, width, precision, flags, `*` and `[n]`, nil values, the order fmt checks `Format`/`GoString`/`Error`/`String`, the `String` recursion trap, the `%!` error notes, Scan in brief, `go vet`'s printf check | verified |
| [log-and-slog.md](log-and-slog.md) | concept | `log` (Print, Fatal and its `os.Exit(1)`, Panic, flags) and `log/slog`: the Logger-to-Handler pipeline, text and JSON handlers, `!BADKEY`, levels and `HandlerOptions`, the `SetDefault` bridge, `With` and groups, `LogValuer`, Context methods, `LogAttrs`, `DiscardHandler` (Go 1.24), `NewMultiHandler` (Go 1.26), writing a Handler | verified |
| [random-numbers-and-uuids.md](random-numbers-and-uuids.md) | concept | `math/rand/v2` (automatic seeding, no `Seed`, PCG and ChaCha8, `N`, Go 1.27 `(*Rand).N`), the seeding GODEBUG settings of `math/rand`, `crypto/rand` (`Read` crashes on failure since Go 1.24, `Text`), the Go 1.27 `uuid` package (versions 4 and 7, parsing, ordering, JSON) | verified |
| [time-and-clocks.md](time-and-clocks.md) | concept | Wall and monotonic readings, `==` versus `Equal`, `Duration`, `Since`/`Until` and vet's deferred-`Since` check, locations, `TZ`, `LoadLocation` and `time/tzdata` in containers, layouts and `Parse` versus `ParseInLocation`, `AddDate` across a daylight-saving change, timers in brief, the JSON form | verified |
| [files-and-filesystems.md](files-and-filesystems.md) | concept | `ReadFile`/`WriteFile`, `*os.File` streams, permission bits and the umask, `Close` and `Sync`, temp files and `Rename`, `path` versus `path/filepath`, `WalkDir` versus `Walk`, `io/fs.FS` (`DirFS`, `embed.FS`, `fstest.MapFS`, `CopyFS`), `os.Root` against path traversal (Go 1.24, 1.25), `*fs.PathError` and `errors.Is` | verified |
| [command-line-programs.md](command-line-programs.md) | concept | `os.Args` and `flag` (accepted forms, the boolean exception, `FlagSet` subcommands, `Func`/`TextVar`), standard streams, `LookupEnv`, exit codes (`os.Exit` skips defers, `log.Fatal`, panic exits 2), `os/exec` (no shell, `ExitError`, `ErrDot`, `CommandContext`, `Cancel`, `WaitDelay`), signals and `NotifyContext` shutdown | verified |
| [text-and-html-templates.md](text-and-html-templates.md) | concept | `text/template` actions, pipelines, functions, `FuncMap`, `define`/`block`, trimming and `missingkey`; `html/template` contextual escaping, typed strings that bypass it, and Parse-time versus Execute-time errors | verified |
| [images.md](images.md) | concept | `image.Image`, `Point` and `Rectangle` bounds, alpha-premultiplied 16-bit colours, the concrete image types, PNG encoding and decoding with format registration, `draw` with `Src` versus `Over`, `SubImage` sharing pixels; the Images pages of A Tour of Go | verified |
| [csv-xml-and-binary-encodings.md](csv-xml-and-binary-encodings.md) | reference | Lookup tables for the `encoding/csv` Reader and Writer, `encoding/xml` struct tags, `encoding/binary` byte orders, varints and the Append/Encode/Decode functions, `encoding/gob` rules, `base64` and `hex` | verified |
| [database-sql.md](database-sql.md) | concept | `sql.DB` as a pool safe for concurrent use, `Open` versus `PingContext`, driver registration by blank import, `QueryRow`/`Query`/`Exec`, the unclosed-`Rows` leak seen in `db.Stats()`, prepared statements, transactions and `ErrTxDone`, cancellation, NULL and `sql.Null[T]`, pool settings, SQL injection, the Go 1.27 driver additions | verified |
| [tcp-udp-and-deadlines.md](tcp-udp-and-deadlines.md) | concept | `Listen`/`Accept`/`Dial`, one goroutine per connection, absolute deadlines and `os.ErrDeadlineExceeded`, idle timeouts, `Dialer` timeouts and keep-alive, `CloseWrite` half-close, UDP datagram boundaries, `JoinHostPort` and `net/netip`, the pure-Go versus cgo DNS resolver and `GODEBUG=netdns` | verified |

## References
- [Standard library](https://pkg.go.dev/std) — Go team, living. Backs: subtopic scope.
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Backs: the Go version covered.

## Related
- `go/learning-path.md` — where this subtopic sits in the learning order.
- `go/concurrency/` — `context`, which `net/http` request handling builds on.
- `go/tooling/` — testing the code these packages support.
