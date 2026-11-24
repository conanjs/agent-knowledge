---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "log/slog: Go ≥ 1.21", "SetLogLoggerLevel and the vet slog check: Go ≥ 1.22", "DiscardHandler: Go ≥ 1.24", "GroupAttrs: Go ≥ 1.25", "NewMultiHandler: Go ≥ 1.26"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, log, slog, structured-logging, handler, textHandler, jsonHandler, levels, logvaluer, badkey]
ranked-sources: true
---

# Logging with log and log/slog

## Summary
**TL;DR:** The `log` package writes one line of text per call; `log.Fatal*` writes the line and then calls `os.Exit(1)`, so deferred calls never run, while `log.Panic*` writes it and then panics. `log/slog` (Go 1.21) adds structured logging: a `Logger` turns each call into a record (time, level, message, key-value attributes) and passes it to a `Handler`, which decides whether to keep it and how to write it — `TextHandler` writes `key=value` pairs, `JSONHandler` one JSON (JavaScript Object Notation) object per line. `slog.SetDefault` also sends the old `log` package's output through the new handler, so existing `log.Printf` calls join the structured stream.
**Use this when:** you pick between `log` and `slog`, set up a service logger (level, source position, redaction), see `!BADKEY` in your output, wonder why cleanup did not run after `log.Fatal`, or write or wrap a `slog.Handler`.
**Not this doc:** why logs should be structured events with correlation fields and central redaction, in any language → `operations/structured-logging.md`; the `fmt` verbs that `log.Printf` uses → `go/standard-library/fmt-and-printing.md`; `panic` and `recover` → `go/errors/panic-and-recover.md`; putting values in a `context.Context` → `go/concurrency/context-and-cancellation.md`.

## Problem
A command-line tool calls `log.Fatal` in a function that deferred a file close; the close never runs, because `os.Exit` ends the process at once ✅[^2]. A service writes `log.Printf("user %s failed: %v", id, err)`, and every search for that failure has to pick the user and the error back out of prose. Large programs often pull in several third-party logging packages through their dependencies, and the main program must configure each one so that all output goes to the same place in the same format ✅[^9]. And slog's light key-value syntax is easy to get wrong: drop one value and the output gains a `!BADKEY` field ✅[^1].

## Mental model
**Analogy:** a `slog.Logger` is a front desk clerk who fills in a standard form for every event: time, level, message, and named fields. The `Handler` is the back office: it first says whether it wants forms of that level at all, then decides how to write each form (plain `key=value` text or JSON) and where to file it. `Logger.With` hands the clerk a pre-stamped pad, so every form from it already carries `req_id=r-17`. A level is the urgency box on the form, and the back office sets the lowest urgency it files. A `LogValuer` is a name badge: the clerk copies what the badge says (`REDACTED`), not the person's real details.

**Artifact:** the same call through the two built-in handlers, with the time removed by `ReplaceAttr` so the output is stable (Go 1.27.4 ✅[^1]):
```go
opts := &slog.HandlerOptions{ReplaceAttr: noTime} // noTime returns slog.Attr{} for the "time" key
slog.New(slog.NewTextHandler(os.Stdout, opts)).Info("hello world", "user", "ana", "n", 3)
slog.New(slog.NewJSONHandler(os.Stdout, opts)).Info("hello world", "user", "ana", "n", 3)
// Output:
// level=INFO msg="hello world" user=ana n=3
// {"level":"INFO","msg":"hello world","user":"ana","n":3}
```

## How it works
**The log package.**
1. `Print`, `Printf` and `Println` format their arguments like `fmt.Print`, `fmt.Printf` and `fmt.Println`; the standard logger writes to standard error with the date and time, and adds a newline when the message lacks one ✅[^2]. `Fatal*` is the matching `Print*` followed by `os.Exit(1)`, and `Panic*` the matching `Print*` followed by `panic` ✅[^2].
2. Flags choose the line header: `Ldate`, `Ltime`, `Lmicroseconds`, `Llongfile`, `Lshortfile`, `LUTC` and `Lmsgprefix` (which moves the prefix from the start of the line to just before the message); `LstdFlags` is `Ldate | Ltime` ✅[^2]. Apart from `Lmsgprefix`, you cannot change the order or the format of these header parts ✅[^2].
3. `log.New(w, prefix, flags)` makes a logger on any `io.Writer`; `SetOutput`, `SetPrefix` and `SetFlags` change one; `log.Default()` returns the standard logger used by the top-level functions ✅[^2]. Each call makes a single `Write` call, and a `Logger` serializes access to its writer, so many goroutines can share it ✅[^2].
4. In the lab, `log.New(&buf, "app: ", log.Lshortfile)` wrote `app: main.go:16: no newline`; with `Lmsgprefix` added the line became `main.go:19: app: msgprefix moves the prefix` ✅[^1].

**The slog pipeline — 4 actors:**
- **Your code** — its job: report an event, via a `Logger` method such as `Info`, `InfoContext` or `LogAttrs`.
- **`slog.Logger`** — its job: build a `Record` (time, level, message, attributes), via the call's arguments plus the attributes stored by `With`.
- **`slog.Handler`** — its job: filter and format the record, via its `Enabled` and `Handle` methods.
- **The `io.Writer`** — its job: receive the finished bytes, via one `Write` call per record.

```
your code            slog.Logger                     Handler                        io.Writer
lg.Info(msg, k, v)
   │ arguments are evaluated here, always
   └──────────────▶ Enabled(ctx, LevelInfo)? ─────▶ level ≥ minimum?
                        │ false: stop, nothing built   │
                        │ true                          │
                        ▼                               │
                     Record{time, level, msg,           │
                       attrs: With-attrs + args}        │
                        └─────────────────────────────▶ Handle(ctx, rec)
                                                         formats text / JSON
                                                         └──── one Write ───────▶ bytes
```

1. **Your code (in process):** the arguments of the call are evaluated before slog sees them, even when the level is disabled ✅[^3]; in the lab `text.Debug("dropped", "v", expensive())` still printed `(expensive() was called)` ✅[^1].
2. **Logger → Handler:** the logger calls `Enabled` first, before it processes any argument, so a disabled event costs little ✅[^3]. In the lab a disabled `Debug` call took 7.8–8.4 ns (nanoseconds) over four runs, against 607–671 ns for an enabled `Info` call with five constant values to a `JSONHandler` writing to `io.Discard` ✅[^1].
3. **Logger:** it builds the record. Its attributes are the logger's own (from `With`) followed by the call's: an `Attr` argument is used as is; a string that is not the last argument becomes a key, and the next argument its value; anything else becomes a value under the key `!BADKEY` ✅[^3].
4. **Handler:** `Handle` formats the record. `TextHandler` writes the time in RFC (Request for Comments) 3339 format with millisecond precision, quotes keys and values that contain spaces, non-printing characters, `"` or `=`, and writes an `encoding.TextMarshaler`'s text or else `fmt.Sprint` of the value ✅[^3]. `JSONHandler` writes the time as `json.Marshal` does and other values like an `encoding/json` encoder, except that an `error` attribute becomes its `Error()` string ✅[^3]. In the lab the two time forms were `time=2026-11-24T15:37:35.318Z` and `"time":"2026-11-24T15:37:35.318694571Z"` ✅[^1].
5. **Handler → io.Writer:** each `Handle` call of the built-in handlers makes one `Write`, under a lock, so a record is never interleaved with another; they do not sort records by time ✅[^3]. The logger ignores any error `Handle` returns ✅[^3].

**Levels and options.**
1. A `Level` is an `int`; `LevelDebug`, `LevelInfo`, `LevelWarn` and `LevelError` are -4, 0, 4 and 8, and any integer is allowed ✅[^3]. In the lab level 2 printed as `INFO+2` and `LevelError+2` as `ERROR+2` ✅[^1].
2. `HandlerOptions.Level` sets the minimum level; `nil` means `LevelInfo` ✅[^3]. A `*slog.LevelVar` there lets the program change the level while it runs, safely from many goroutines ✅[^3].
3. `AddSource: true` adds a `source` attribute ✅[^3]: `source=main.go:76` in text, `"source":{"function":"main.main","file":"main.go","line":78}` in JSON, after `ReplaceAttr` trimmed the directory ✅[^1].
4. `ReplaceAttr(groups, a)` is called for every non-group attribute, including the built-in `time`, `level`, `source` and `msg`; returning a zero `Attr` drops it ✅[^3]. It can rename keys, convert types or mask personal data; in the lab it renamed `level` to `severity` and masked `email` both at the top and inside a group ✅[^1].

**SetDefault and the bridge to log.**
1. Before any `SetDefault` call, slog's top-level functions write through the `log` package's default logger ✅[^3]: `slog.Info("hello", "count", 3)` printed `2026/11/24 15:33:30 INFO hello count=3`, and `slog.Debug` printed nothing ✅[^1].
2. `slog.SetDefault(l)` makes `l` the default for `slog.Info` and friends, and from then on `log.Print` and friends go to `l`'s handler ✅[^3]. In the lab `log.Printf("old code says %d", 7)` came out as `{"level":"INFO","msg":"old code says 7"}` ✅[^1].
3. `SetLogLoggerLevel` (Go 1.22) sets the level of that bridge: before `SetDefault`, the minimum level of slog calls passed to `log`; after it, the level at which `log` calls are recorded ✅[^3] ✅[^5]. After `SetLogLoggerLevel(slog.LevelWarn)` the lab's `log.Print` line carried `"level":"WARN"` ✅[^1]. `slog.NewLogLogger(h, level)` builds a separate `*log.Logger` that feeds `h` ✅[^3].

**With, groups and LogValuer.**
1. `Logger.With(args...)` returns a logger whose attributes appear in every record; the built-in handlers format them once, at the `With` call, not at each log call ✅[^3].
2. `slog.Group("http", "method", "GET")` nests attributes: `TextHandler` joins the names with a dot (`http.method=GET`), `JSONHandler` writes a nested object (`"http":{"method":"GET"}`) ✅[^3] ✅[^1]. `Logger.WithGroup("parser")` qualifies every later key with the group name, which keeps the same key from two subsystems apart ✅[^3]. A group with no attributes is left out ✅[^3] ✅[^1]. `GroupAttrs` (Go 1.25) builds a group from a `[]Attr` ✅[^7].
3. A type with a `LogValue() slog.Value` method (the `LogValuer` interface) is logged as the value that method returns ✅[^3]. In the lab a `Password` type logged as `pw=REDACTED`, and a `User` type returning `slog.GroupValue(...)` logged as `user.id=7 user.name=ana` ✅[^1]. Because `LogValue` is called only when the line is enabled, it also keeps expensive work out of disabled calls ✅[^3].

**Context methods and LogAttrs.**
1. `DebugContext`, `InfoContext`, `WarnContext`, `ErrorContext`, `Log` and `LogAttrs` take a `context.Context`, which reaches the handler's `Enabled` and `Handle` so that it can read values such as a trace identifier; the docs recommend passing one when you have it ✅[^3]. Cancelling the context does not stop the record ✅[^3] ✅[^9]: the lab's `WarnContext` with a cancelled context still printed ✅[^1].
2. `LogAttrs` accepts only `Attr` values (built with `slog.Int`, `slog.String`, `slog.Any` and so on), which lets it avoid allocation; it is the most efficient form ✅[^3] ✅[^9]. In a lab benchmark with four run-time values, `Info` with key-value pairs made 4 allocations (48 bytes) per call and took 616–852 ns over four runs; `LogAttrs` made 0 and took 557–644 ns ✅[^1]. With constant values both forms made 0 allocations ✅[^1].

**DiscardHandler and MultiHandler.**
1. `slog.DiscardHandler` (Go 1.24) discards everything; its `Enabled` returns false for every level ✅[^3] ✅[^6].
2. `slog.NewMultiHandler(h1, h2, …)` (Go 1.26) sends each record to every handler: `Enabled` is true if any handler is enabled, and `Handle`, `WithAttrs` and `WithGroup` go to each enabled handler ✅[^3] ✅[^8]. In the lab an Info-level text handler and a Debug-level JSON handler behind one multi handler got `m.Debug` only in the JSON output and `m.Info` in both ✅[^1].

**Writing a Handler.** A `Handler` implements four methods ✅[^3]:
- `Enabled(ctx, level) bool` — called early, to drop unwanted records cheaply.
- `Handle(ctx, Record) error` — called only when `Enabled` returned true. Output should ignore a zero time and a zero PC (program counter, the call site), resolve attribute values, skip an attribute whose key and value are both zero, inline a group with an empty key, and skip a group with no attributes.
- `WithAttrs([]Attr) Handler` — a new handler with these attributes added; the handler owns the slice.
- `WithGroup(name) Handler` — a new handler whose later keys are qualified by `name`; an empty name returns the receiver.

Any method may be called concurrently, so the handler does its own locking ✅[^3]. A wrapper that embeds another handler and overrides `Handle` is the short route: the lab's `ctxHandler` read a trace identifier from the context and added `trace_id=t-42` to each record ✅[^1]. Before modifying a `Record` passed to you, copy it with `Record.Clone`, because a plain copy shares attribute state with the original ✅[^3]. The `testing/slogtest` package (Go 1.21) helps validate a `Handler` implementation ✅[^4].

## Worked example
A service sets one JSON logger as the default, keeps its level in a `LevelVar`, gives each request a child logger, redacts a token type, and still has one dependency on the old `log` package (Go 1.27.4 ✅[^1]):

```go
type Token string
func (Token) LogValue() slog.Value { return slog.StringValue("REDACTED") }

var level = new(slog.LevelVar) // Info by default

func handle(ctx context.Context, lg *slog.Logger, id string, tok Token) {
	reqLog := lg.With("req_id", id)
	reqLog.DebugContext(ctx, "auth check", "token", tok)
	reqLog.InfoContext(ctx, "request done", slog.Group("http", "method", "GET", "status", 200))
}

// in main (ReplaceAttr drops "time" only to keep this output stable):
lg := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level, ReplaceAttr: noTime})).With("svc", "orders")
slog.SetDefault(lg)
handle(ctx, lg, "r-1", "s3cr3t")
log.Printf("legacy: cache warmed (%d keys)", 120)
level.Set(slog.LevelDebug)
handle(ctx, lg, "r-2", "s3cr3t")
slog.Warn("bad call", "user")
```

| Step | What happens | Output |
|---|---|---|
| 1 | First request at the default Info level: the `Debug` record is dropped by `Enabled` | `{"level":"INFO","msg":"request done","svc":"orders","req_id":"r-1","http":{"method":"GET","status":200}}` |
| 2 | The dependency's `log.Printf` goes through the bridge into the JSON handler, with the default logger's `svc` attribute | `{"level":"INFO","msg":"legacy: cache warmed (120 keys)","svc":"orders"}` |
| 3 | `level.Set(slog.LevelDebug)`; the second request logs its debug line, and the token is redacted by `LogValue` | `{"level":"DEBUG","msg":"auth check","svc":"orders","req_id":"r-2","token":"REDACTED"}` |
| 4 | Same request, Info line | `{"level":"INFO","msg":"request done","svc":"orders","req_id":"r-2","http":{"method":"GET","status":200}}` |
| 5 | A key without a value | `{"level":"WARN","msg":"bad call","svc":"orders","!BADKEY":"user"}` |
| 6 | `go vet .` on the full lab file | `main.go:40:2: call to slog.Warn missing a final value` |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `log.Fatalf` in a function with a `defer` | Message printed, deferred call skipped, exit status 1 ✅[^1] | `Fatal*` is `Print*` plus `os.Exit(1)` ✅[^2] |
| `log.Panicln` not recovered | Deferred calls run, then `panic: bad state: 42` and a stack trace, exit status 2 ✅[^1]; with `recover` the value was the `string` `"bad state: 42"` ✅[^1] | `Panic*` is `Print*` plus `panic` ✅[^2] |
| Odd number of key-value arguments | The last one becomes `!BADKEY=dangling` ✅[^1] | A string in the last position has no value ✅[^3] |
| A non-string key: `Info("m", 42, "x")` | `!BADKEY=42 !BADKEY=x` ✅[^1] | 42 is neither a string nor an `Attr`, and `"x"` is then the last argument ✅[^3] |
| Catching these mistakes before running | `go vet` reports `missing a final value` and `arg "42" should be a string or a slog.Attr` ✅[^1] | Since Go 1.22 vet checks slog's key-value calls ✅[^5] |
| `slog.Debug` with no setup | Nothing printed ✅[^1] | The default minimum level is Info ✅[^3] |
| An expensive argument at a disabled level | It is still computed ✅[^1] | Arguments are always evaluated; wrap the work in a `LogValuer` ✅[^3] |
| A helper `Infof` that calls `logger.Info` | `source` names the helper's file, not the caller's | slog finds the call site from the stack; pass the right PC to `NewRecord` instead ✅[^3] |
| Group keys with dots, text output | `a.b.c` cannot be split back into groups and keys | `TextHandler` does no further escaping ✅[^3] |
| An `error` inside a struct, JSON output | Encoded by `encoding/json`, not by `Error()` | Only `error` values of attributes get the string treatment ✅[^3] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `log` package | Small API (application programming interface) and plain text lines ✅[^2] | No levels or fields; `Fatal` skips deferred cleanup ✅[^2] |
| slog with `TextHandler` | Fields and levels in `key=value` pairs that machines parse easily ✅[^3] | Group structure can be ambiguous ✅[^3] |
| slog with `JSONHandler` | One JSON object per line, nested groups ✅[^3] | Longer lines: the artifact's record took 55 characters in JSON and 41 in text ✅[^1] |
| Key-value arguments | Short calls ✅[^9] | Easy to get wrong by omitting a key or value ✅[^9]; relies on `go vet` ✅[^5]; allocates for run-time values ✅[^1] |
| `LogAttrs` with `Attr` values | No allocation, typed fields ✅[^3] ✅[^1] | Longer calls |
| Code logs through slog; the program plugs in a `Handler` from a third-party logging package | Packages interoperate through one backend interface ✅[^9] | Another dependency |

## Takeaways
- Never call `log.Fatal` (or `os.Exit`) below `main`: return an error so deferred cleanup runs. [rule-candidate]
- Create one slog logger in `main`, call `slog.SetDefault` with it so old `log` calls join the stream, and pass child loggers built with `With` to the code that handles each request. [rule-candidate]
- Run `go vet` in CI (continuous integration): it catches slog key-value mistakes that would otherwise show up as `!BADKEY`. [rule-candidate]
- Give secret-bearing types a `LogValue` method that redacts them. [rule-candidate]
- Use `LogAttrs` on hot paths, and `HandlerOptions.Level` with a `LevelVar` to change verbosity without a restart.
- Prefer the `…Context` methods when a context is at hand, so handlers can add trace fields.

## Verification status
- Verified: 97 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24: `log` flags and prefixes, `Fatal` and `Panic` exit statuses, both built-in handlers, `!BADKEY`, groups, levels, `AddSource`, `ReplaceAttr`, the `log` bridge, `LogValuer`, a context-reading handler, `DiscardHandler`, `MultiHandler`, the `go vet` slog check and the `Info`/`LogAttrs` benchmark. [^1]
- [log package](https://pkg.go.dev/log) — Go team, living. Rank 1. Backs: `Print`/`Fatal`/`Panic` semantics, flags and their order, `New`, `SetOutput`, `Default`, one `Write` per call and serialized access. [^2]
- [log/slog package](https://pkg.go.dev/log/slog) — Go team, living. Rank 1. Backs: `Logger`/`Handler`/`Record`, argument processing and `!BADKEY`, levels, `HandlerOptions`, `SetDefault`, `SetLogLoggerLevel`, `NewLogLogger`, groups, `LogValuer`, context methods, `LogAttrs`, both built-in handlers' formats, `DiscardHandler`, `MultiHandler`, the `Handler` interface rules, `Record.Clone`, the wrapper source problem. [^3]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: `log/slog` and `testing/slogtest` are new in Go 1.21. [^4]
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22) — Go team, 2024. Rank 1. Backs: vet reports mismatched slog key-value arguments; `SetLogLoggerLevel`. [^5]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: `DiscardHandler`. [^6]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: `GroupAttrs`. [^7]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: `NewMultiHandler`. [^8]
- [Structured Logging with slog](https://go.dev/blog/slog) — Jonathan Amsterdam, Go team, 2023. Rank 4. Backs: why a standard structured logger (many packages, one backend), the key-value syntax choice, `LogAttrs` being faster, cancelled contexts still logging. [^9]

## Related
- `operations/structured-logging.md` — event names, correlation fields, redaction and stdout logging, independent of language.
- `go/standard-library/fmt-and-printing.md` — the verbs `log.Printf` passes to `fmt`.
- `go/errors/panic-and-recover.md` — what `log.Panic` triggers, and how `recover` stops it.
- `go/concurrency/context-and-cancellation.md` — the contexts the `…Context` methods take.
- `go/tooling/go-command-and-build-reference.md` — the `go vet` analyzers, `slog` among them.
- `go/tooling/testing-benchmarks-and-fuzzing.md` — how the benchmark numbers above are measured.
- `go/learning-path.md`
