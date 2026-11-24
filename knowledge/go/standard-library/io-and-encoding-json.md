---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "omitzero: Go ≥ 1.24", "encoding/json/v2 and jsontext: Go ≥ 1.27"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, io, reader, writer, bufio, scanner, encoding-json, json-v2, jsontext, omitempty, omitzero]
ranked-sources: true
---

# Readers, writers and JSON encoding

## Summary
**TL;DR:** An `io.Reader` may hand back data *and* an error in the same call, so always use the `n` bytes before looking at `err`; `io.EOF` means a clean end and is compared with `==`. Small adapters (`LimitReader`, `TeeReader`, `MultiWriter`, `bufio`) snap together like plumbing, but a `bufio.Writer` keeps data until `Flush`, and a `bufio.Scanner` stops for good on a line longer than 64 KiB (kibibytes: 65,536 bytes). `encoding/json` (JSON: JavaScript Object Notation) maps only exported fields, matches keys case-insensitively, ignores unknown keys and turns numbers in `any` into `float64`. Since Go 1.27 it runs on the new `encoding/json/v2` implementation but keeps that v1 behaviour; code that calls `encoding/json/v2` directly gets stricter defaults (exact-case names; duplicate names and invalid UTF-8 — the standard byte encoding of Unicode text — rejected).
**Use this when:** you write or review code that reads files, request bodies or streams, wraps readers and writers, scans lines, or encodes and decodes JSON — especially untrusted JSON — or you consider moving to `encoding/json/v2`.
**Not this doc:** the `error` values and wrapping that `io` uses → `go/errors/errors-and-wrapping.md`; reading HTTP bodies and closing them → `go/standard-library/net-http.md`; streaming versus loading data in general (Node.js) → `javascript/node/data-wrangling-deep-dive.md`.

## Problem
Stream code fails at the edges. A loop that checks `err` before `n` throws away the last chunk of a file. Code that treats `io.EOF` from `io.Copy` as a failure, or forgets `Flush`, produces errors or truncated output only on some inputs. A log scanner stops silently at the first very long line. JSON adds its own surprises: a lowercase field never appears, a nil slice becomes `null`, a large ID (identifier) decoded into `any` loses digits, and two services can read the same request with duplicate keys as two different values.

## Mental model
**Analogy:** a reader is a tap you hold a bucket under. Each turn fills *some* of the bucket (`n`), and the tap may say "that was the last of it" (`io.EOF`) on the same turn as the final water. A writer is a drain. The `io` adapters are pipe fittings: a flow limiter (`LimitReader`), a T-junction that copies what flows past (`TeeReader`), a splitter (`MultiWriter`), and a holding tank you must empty (`bufio.Writer` and `Flush`).

**Artifact:** the two interfaces and the read loop that respects the contract ✅[^2]:
```go
type Reader interface{ Read(p []byte) (n int, err error) }
type Writer interface{ Write(p []byte) (n int, err error) }

for {
	n, err := r.Read(buf)
	process(buf[:n])        // use the bytes first: n > 0 can come with an error
	if err == io.EOF {
		break               // clean end of input
	}
	if err != nil {
		return err          // a real failure, after keeping what was read
	}
}
```

## How it works
1. **The `Read` contract.** `Read` fills up to `len(p)` bytes and returns how many (`0 <= n <= len(p)`) ✅[^2]. When it hits an error or the end after reading `n > 0` bytes, it returns those bytes and may return the error in the same call or as `0, err` on the next; at the end of input that means either `err == EOF` or `err == nil` followed by `0, EOF` ✅[^2]. So callers must process the `n` bytes before considering `err` ✅[^2]. A return of `0, nil` means "nothing happened", not end of file, and an implementation must not keep `p` after returning ✅[^2]. In the lab a reader that returns its last bytes with `io.EOF` gave `n=5 data="hello" err=EOF` in one call ✅[^1].
2. **`io.EOF` is a sentinel.** `Read` must return `io.EOF` itself, never an error wrapping it, because callers test it with `==`; functions should return it only for a graceful end, and an unexpected end inside structured data should be a different error such as `io.ErrUnexpectedEOF` ✅[^2].
3. **The `Write` contract.** `Write` must return a non-nil error whenever it writes fewer than `len(p)` bytes, and must not modify the slice, even for a moment ✅[^2].
4. **Helpers that read to the end.** `io.Copy` and `io.ReadAll` read until `EOF` and report success as `err == nil`, not `EOF` ✅[^2]; the lab printed `Copy: 7 bytes, err=<nil>` ✅[^1]. `io.Copy` uses the source's `WriteTo` or the destination's `ReadFrom` method when one exists ✅[^2]. `io.ReadFull` reads exactly `len(buf)` bytes and returns `io.ErrUnexpectedEOF` when the input ends part-way ✅[^2] (`unexpected EOF` for 3 bytes into a 5-byte buffer ✅[^1]).
5. **Adapters.** `io.LimitReader(r, n)` stops with `EOF` after `n` bytes; `io.TeeReader(r, w)` writes to `w` everything read from `r`, with no buffering, and reports a write error as a read error; `io.MultiWriter` sends each write to every writer in turn and stops at the first error ✅[^2].
6. **`bufio.Writer` needs `Flush`.** It buffers writes; after all data is written the caller should call `Flush` to push it to the underlying writer, and after any write error every later write and `Flush` return that error ✅[^3]. In the lab, after `fmt.Fprint(bw, "buffered line")` the destination held 0 bytes and the writer 13 buffered bytes until `Flush` ✅[^1].
7. **`bufio.Scanner` and its token limit.** The default split function returns lines with the line ending stripped ✅[^3]. Without an explicit buffer the largest token is `MaxScanTokenSize = 64 * 1024` bytes ✅[^3]. Scanning stops for good at `EOF`, at the first I/O (input/output) error, or at a token too large for the buffer, and the reader may have advanced past the last token ✅[^3]. `Scanner.Buffer(buf, max)` raises the limit and panics if called after scanning started; programs that need more control should use `bufio.Reader` ✅[^3]. In the lab a 71,680-byte line stopped the scan with `bufio.Scanner: token too long` (`errors.Is(err, bufio.ErrTooLong)` was true), and with `Buffer(make([]byte, 0, 64*1024), 1<<20)` the same line came through ✅[^1].
8. **JSON encoding rules (`encoding/json`).**
   - Each exported struct field becomes an object member; the `json` tag sets the name and options; `json:"-"` always omits the field ✅[^4].
   - `omitempty` omits `false`, `0`, a nil pointer, a nil interface and any array, slice, map or string of length zero ✅[^4]. `omitzero` (Go 1.24) omits a zero value, using the type's `IsZero() bool` method when it has one, so it omits a zero `time.Time`, which `omitempty` does not ✅[^6].
   - The `string` option stores a string, number or boolean field as JSON inside a JSON string ✅[^4].
   - A nil slice encodes as `null` and `[]byte` as a base64 string ✅[^4].
9. **JSON decoding rules.** `Unmarshal` prefers an exact key match but also accepts a case-insensitive one, and ignores keys with no matching field unless the `Decoder` has `DisallowUnknownFields` ✅[^4]. Into an `any`, it stores `bool`, `float64` for every number, `string`, `[]any`, `map[string]any` or `nil` ✅[^4]; `Decoder.UseNumber` stores a `json.Number` instead of a `float64` ✅[^4].
10. **Go 1.27: v2 underneath v1.** Go 1.27 adds `encoding/json/v2` (`Marshal`, `MarshalWrite`, `Unmarshal`, `UnmarshalRead` and friends, each taking variadic options) and `encoding/json/jsontext` for token-level JSON ✅[^7]. The v1 package is now implemented on v2 with options that keep v1's historical behaviour; error texts may differ, and building with `GOEXPERIMENT=nojsonv2` restores the old implementation for now ✅[^7] ✅[^4]. In the lab, the v1 program printed the same output with and without `nojsonv2`, and with `nojsonv2` the `encoding/json/v2` and `jsontext` packages did not build at all ("build constraints exclude all Go files") ✅[^1]. The v1 docs encourage new code to use v2, because v1's defaults are less secure ✅[^4].
11. **What v2 changes.** The v1 docs list each difference and the option that switches it back ✅[^4]; the ones observed in the lab, same input, Go 1.27.4 ✅[^1]:

    | Input or value | v1 (`encoding/json`) | v2 (`encoding/json/v2`) |
    |---|---|---|
    | `{"name":"first","name":"second"}` | `"second"`, no error | `jsontext: duplicate object member name "name"` |
    | a JSON string holding byte `0xFF` | `"bad�byte"` (replaced), no error | `jsontext: invalid UTF-8 after offset 4` |
    | `{"NAME":"cup"}` into field tagged `name` | `Name = "cup"` | `Name = ""` (exact-case match only) |
    | nil `[]string` field | `"tags":null` | `"tags":[]` |
    | the string `<b>&</b>` | `"<b>&</b>"` (HTML characters escaped) | `"<b>&</b>"` (escaped only where JSON requires) |

    `jsontext.AllowDuplicateNames(true)` and `jsontext.AllowInvalidUTF8(true)` restore the v1 behaviour for those two cases ✅[^5]. Both versions ignore unknown object members by default; v2's `RejectUnknownMembers` option turns that into an error ✅[^5].
12. **Why stricter is safer.** Many JSON texts are valid but ambiguous, for example the standard does not say what duplicate names mean; if one service authenticates a request and another executes it, and they read a duplicate or case-folded key differently, an attacker can act as a different user ✅[^5].

## Worked example
Cap an upload at 10 bytes, hash it while copying, and keep two copies — one `io.Copy` call through three fittings:

```go
h := sha256.New()
var copyA, copyB bytes.Buffer
src := io.TeeReader(io.LimitReader(strings.NewReader("0123456789ABCDEF"), 10), h)
n, err := io.Copy(io.MultiWriter(&copyA, &copyB), src)
```

| Step | What flows | Observed ✅[^1] |
|---|---|---|
| 1 | `LimitReader` passes the first 10 of 16 bytes, then reports `EOF` | `0123456789` |
| 2 | `TeeReader` writes each chunk it reads into the hash `h` | the hash sees the same 10 bytes |
| 3 | `MultiWriter` writes each chunk to `copyA`, then `copyB` | both hold `"0123456789"` |
| 4 | `io.Copy` ends at the limit's `EOF` and reports success as `nil` | `n = 10`, `err = <nil>` |

A JSON body read through such a pipeline then follows the decoding rules above: with v1, `{"NAME":"cup","qty":"7","color":"red"}` into a struct with fields `name` and `qty,string` gave `Name=cup Qty=7` and no error, because the key match is case-insensitive and `color` is ignored; a `Decoder` with `DisallowUnknownFields` instead returned `json: unknown field "color"` ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Last bytes arrive together with `io.EOF` | Lost if the loop checks `err` first | Readers may return `n > 0` with an error ✅[^2] |
| A wrapped EOF (`fmt.Errorf("…: %w", io.EOF)`) returned from `Read` | Callers comparing `err == io.EOF` miss it | `Read` must return `io.EOF` itself ✅[^2] |
| `bufio.Writer` without `Flush` before exit | Output is missing | Data stays in the buffer until `Flush` ✅[^3] ✅[^1] |
| Log line longer than 64 KiB in a `Scanner` | Loop ends; `sc.Err()` is `bufio.ErrTooLong`; later lines are not read ✅[^1] | Default token limit `MaxScanTokenSize` and the scan stops unrecoverably ✅[^3] |
| `json:"created,omitempty"` on a zero `time.Time` | Still encoded as `"0001-01-01T00:00:00Z"`; `omitzero` drops it ✅[^1] | `omitempty` checks emptiness, not the zero struct; `omitzero` uses `IsZero` ✅[^6] |
| Lowercase (unexported) field | Not encoded ✅[^1] | Only exported fields are members ✅[^4] |
| `12345678901234567890` decoded into `any` | `float64` `1.2345678901234567e+19` — digits lost; `UseNumber` keeps `12345678901234567890` ✅[^1] | Numbers in `any` are `float64` by default ✅[^4] |
| Duplicate keys in v1 | The last one wins silently (`"second"`) ✅[^1] | v1 permits duplicate names; v2 rejects them ✅[^4] |
| `GOEXPERIMENT=nojsonv2` with code importing `encoding/json/v2` | Build fails ✅[^1] | The opt-out restores the original v1 implementation ✅[^7] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `bufio.Scanner` | Shortest line-by-line loop | 64 KiB default limit; stops for good on an error ✅[^3] |
| `bufio.Reader` | Full control over long lines and errors ✅[^3] | More code per read |
| `encoding/json` (v1) | Stable API, existing code unchanged ✅[^7] | Lenient defaults: duplicates, invalid UTF-8, case-folded names ✅[^4] |
| `encoding/json/v2` | Stricter, more interoperable defaults ✅[^7] | Behaviour differences to review before migrating ✅[^4] |

## Takeaways
- In every read loop, handle `buf[:n]` before checking `err`, and compare with `err == io.EOF` (or `errors.Is`) only after that ✅[^2]. [rule-candidate]
- Call `Flush` on every `bufio.Writer` before its destination is used or closed, and check the error it returns ✅[^3]. [rule-candidate]
- Check `sc.Err()` after every `Scanner` loop; set `Scanner.Buffer` when lines can exceed 64 KiB ✅[^3]. [rule-candidate]
- For untrusted JSON, reject duplicates, invalid UTF-8 and (if the API is strict) unknown fields — v2's defaults, or `DisallowUnknownFields` in v1 ✅[^5]. [rule-candidate]
- Use `omitzero` rather than `omitempty` for numbers, booleans, pointers and `time.Time` ✅[^4] ✅[^6].
- Decode IDs and money into concrete integer types (both versions keep their precision ✅[^5]) or `json.Number`, never into `any` as `float64`.

## Verification status
- Verified: 70 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24: the EOF-with-data reader, `Copy`/`ReadAll`/`ReadFull`, the limit-tee-multiwriter copy, `bufio.Writer` before and after `Flush`, the 70 KiB scanner line, and the same JSON program under v1, v2 and `GOEXPERIMENT=nojsonv2`. [^1]
- [io package](https://pkg.go.dev/io) — Go team, living. Rank 1. Backs: the `Reader` and `Writer` contracts, `EOF`, `Copy`, `ReadAll`, `ReadFull`, `LimitReader`, `TeeReader`, `MultiWriter`. [^2]
- [bufio package](https://pkg.go.dev/bufio) — Go team, living. Rank 1. Backs: `Writer` and `Flush`, `Scanner` splitting, `MaxScanTokenSize`, unrecoverable stop, `Scanner.Buffer`. [^3]
- [encoding/json package](https://pkg.go.dev/encoding/json) — Go team, living. Rank 1. Backs: `Marshal` tag rules, `omitempty`, `string`, nil slice and `[]byte`, `Unmarshal` matching and `any` types, `DisallowUnknownFields`, `UseNumber`, v1 implemented on v2, the list of v1–v2 differences. [^4]
- [encoding/json/v2 package](https://pkg.go.dev/encoding/json/v2) — Go team, living. Rank 1. Backs: Security Considerations (ambiguous JSON, duplicate names, invalid UTF-8, case-insensitive names, integer precision), unknown members ignored by both versions, `RejectUnknownMembers`, `jsontext.AllowDuplicateNames` and `AllowInvalidUTF8`. [^5]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: the `omitzero` tag option and `IsZero`; it omits zero `time.Time`. [^6]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: new `encoding/json/v2` and `jsontext`, v1 backed by v2, error texts may differ, `GOEXPERIMENT=nojsonv2`. [^7]

## Related
- `go/standard-library/net-http.md` — request and response bodies are `io.Reader`s you must close.
- `go/standard-library/iterators.md` — `strings.Lines` and `bytes.Lines`, iterator alternatives to a `Scanner` for in-memory text.
- `go/errors/errors-and-wrapping.md` — sentinel errors such as `io.EOF` and `errors.Is`.
- `go/methods-interfaces/interfaces.md` — why small interfaces like `io.Reader` compose.
- `floating-point/` — why `float64` cannot hold every 64-bit integer.
- `javascript/node/data-wrangling-deep-dive.md` — streaming versus loading, in Node.js.
- `go/learning-path.md`
