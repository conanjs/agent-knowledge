---
schema: knowledge-doc/v1
type: concept
topic: go/data-types
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "strings.Lines and SplitSeq: Go ≥ 1.24", "strings.CutLast and bytes.CutLast: Go ≥ 1.27"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, string, byte, rune, utf-8, unicode, strings-builder, strconv, unicode-utf8, conversion]
ranked-sources: true
---

# Strings, bytes and runes: UTF-8 in Go

## Summary
**TL;DR:** A Go `string` is an immutable sequence of **bytes**, not of characters; text in it is normally UTF-8 (Unicode Transformation Format, 8-bit) but does not have to be. `len(s)` counts bytes, `s[i]` is a byte, and slicing cuts at byte offsets, so it can split a multi-byte character. Only a `for range` loop over a string (and the `unicode/utf8` package) decodes UTF-8 into **runes**, Go's name for Unicode code points; an invalid byte decodes as U+FFFD and the loop moves on one byte. Convert to `[]byte` to change bytes, to `[]rune` to index by code point, and build long strings with `strings.Builder`.
**Use this when:** you count, truncate, reverse or index text with non-ASCII (American Standard Code for Information Interchange) characters, see `\xe4` or `�` in output, convert between `string`, `[]byte`, `[]rune` and numbers, or pick a function from `strings`, `bytes`, `unicode/utf8` or `strconv`.
**Not this doc:** reading and writing text streams → `go/standard-library/io-and-encoding-json.md`; `[]byte` as a slice (capacity, append) → `go/data-types/arrays-and-slices.md`.

## Problem
Text handling looks the same as in other languages until the input is not ASCII: `len("héllo")` is 6, `name[:4]` produces invalid UTF-8, `s[0] = 'H'` does not compile, `string(65)` gives `"A"` rather than `"65"`, and two strings that print as the same `é` compare unequal. Each comes from the rule that strings hold bytes and only some operations decode them.

## Mental model
**Analogy:** a string is a **sealed tape of bytes**. Most tools (length, index, slice, compare) measure the tape in bytes and ignore what the bytes mean. A `for range` loop is a **reader** that walks the tape and announces each Unicode character it recognizes, with the byte position where it starts; when it meets a byte it cannot read it announces "�" and steps one byte forward.

**Artifact:** one string, three ways of counting it (Go 1.27.4) ✅[^1]:
```go
s := "héllo, 世界"
len(s)                       // 14  bytes
utf8.RuneCountInString(s)    // 9   runes (code points)
s[1]                         // 195 (a byte: the first half of "é")
for i, r := range "aé世" {   // 0:'a'(U+0061) 1:'é'(U+00E9) 3:'世'(U+4E16)
	fmt.Printf("%d:%q(%U) ", i, r, r)
}
```

## How it works
1. **Strings are immutable bytes.** A string value is a possibly empty sequence of bytes; its length is the number of bytes, and once created its contents cannot change ✅[^2]. `s[i]` is a byte (type `byte`, an alias for `uint8`), cannot be assigned to, and `&s[i]` is invalid ✅[^2]. A string holds arbitrary bytes and is not required to be valid UTF-8 ✅[^10].
2. **Source code is UTF-8.** Go source text is UTF-8 and is not normalized, so an accented code point and the same accent built from a letter plus a combining mark are different code point sequences ✅[^2]. Hence string literals without byte escapes hold valid UTF-8 ✅[^10]. In an interpreted literal `"…"`, `\xnn` and `\nnn` put single bytes into the string, while `\u` and `\U` escapes put the UTF-8 encoding of a character ✅[^2]. A raw literal `` `…` `` keeps backslashes as is and may span lines ✅[^2].
3. **Runes.** `rune` is an alias for `int32` ✅[^2]; it names a Unicode code point, and a rune constant such as `'⌘'` has type `rune` ✅[^10]. "Character" is ambiguous: one visible character may be several code points ✅[^10].
4. **`range` decodes UTF-8.** Each iteration gives the byte index where a code point starts and the code point; on an invalid sequence the value is `0xFFFD` and the next iteration advances one byte ✅[^2] ✅[^3]. `utf8.DecodeRuneInString` produces exactly the same sequence ✅[^10]; it returns `(RuneError, 1)` for an invalid encoding and `(RuneError, 0)` for an empty string, where `RuneError` is `'�'` ✅[^5].
5. **Conversions.** `string([]byte)` copies the bytes; `[]byte(s)` gives a new, non-nil slice of the bytes; `[]rune(s)` gives the code points; `string([]rune)` concatenates their UTF-8 encodings ✅[^2]. Converting an integer to a string gives the UTF-8 of that code point (`string(65)` is `"A"`), values outside the Unicode range give `"�"`, the form may be removed from the language, and `go vet` flags it ✅[^2]. Use `strconv.Itoa` for digits.
6. **Comparison and size.** Strings compare lexically byte by byte ✅[^2], so `"Z" < "a"` is true ✅[^1]. `unsafe.Sizeof` of a string measured 16 bytes on 64-bit Linux, independent of its length ✅[^1]; `unsafe.StringData` returns a pointer to the underlying bytes, which must not be modified ✅[^6].
7. **The four packages.**
   - `strings` works on UTF-8 strings ✅[^4]: `Contains`, `Index`, `HasPrefix`, `Split`, `Fields`, `Join`, `ReplaceAll`, `TrimSpace`, `EqualFold`, `ToUpper`, and `Cut` (Go 1.18) ✅[^4]; `Lines` and `SplitSeq` return iterators since Go 1.24 ✅[^4] ✅[^8]; `CutLast` splits around the last separator since Go 1.27 ✅[^4] ✅[^9].
   - `strings.Builder` builds a string with few copies; its zero value is ready to use, and a non-zero Builder must not be copied ✅[^4].
   - `bytes` offers the same kind of functions for `[]byte` ✅[^7]; Go 1.27 added `bytes.CutLast` ✅[^9]. Its `bytes.Buffer` zero value is an empty, ready buffer ✅[^7].
   - `unicode/utf8`: `RuneCountInString`, `ValidString`, `DecodeRuneInString`, `RuneError` ✅[^5].
   - `strconv` converts to and from string representations: `Atoi` is `ParseInt(s, 10, 0)` converted to `int`, and `Itoa`, `ParseInt` and `Quote` cover the common cases ✅[^11].

## Worked example
Truncate a display name to 4 characters for a narrow column. Input: `"Öl世界!"` (5 runes, 10 bytes) ✅[^1].

```go
name := "Öl世界!"
bad := name[:4]                       // "Öl\xe4": cuts "世" in half, ValidString == false
func truncateRunes(s string, n int) string {
	i := 0
	for pos := range s {              // pos = byte offset where each rune starts
		if i == n {
			return s[:pos]
		}
		i++
	}
	return s
}
good := truncateRunes(name, 4)        // "Öl世界", ValidString == true, 9 bytes
alt := string([]rune(name)[:4])       // "Öl世界" too, but allocates a []rune
```

| Step | Value | Why |
|---|---|---|
| `len(name)` | 10 | `Ö` 2 bytes, `l` 1, `世` 3, `界` 3, `!` 1 ✅[^1] |
| `name[:4]` | `"Öl\xe4"`, invalid UTF-8 | Slicing a string cuts at byte offsets ✅[^2] ✅[^1] |
| `range` offsets | 0, 2, 3, 6, 9 | Each iteration starts at the first byte of a code point ✅[^2] |
| `truncateRunes(name, 4)` | `"Öl世界"` (cut at offset 9) | Cutting at a rune start keeps the string valid ✅[^1] |

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `s[0] = 72` | Compile error `cannot assign to s[0] (neither addressable nor a map index expression)` ✅[^1] | Strings are immutable ✅[^2] |
| `range "a\xffb"` | Values `U+0061`, `U+FFFD`, `U+0062` at offsets 0, 1, 2 ✅[^1] | Invalid byte decodes as U+FFFD and advances one byte ✅[^2] |
| `"\u00e9" == "e\u0301"` (both print as `é`) | `false`; lengths 2 and 3 bytes ✅[^1] | Text is not canonicalized ✅[^2]; normalize first if needed |
| `string(n)` with `n := 65` | Compiles and prints `A`; `go vet` reports `conversion from int to string yields a string of one rune, not a string of digits` ✅[^1] | Historical integer-to-string conversion ✅[^2] |
| `strings.ToUpper("straße")` | `STRAßE`: the `ß` stays lower case ✅[^1] | `ToUpper` maps each Unicode letter to its upper case ✅[^4]; in this run that mapping left `ß` unchanged |
| `strconv.Atoi("42px")` | Error `strconv.Atoi: parsing "42px": invalid syntax` ✅[^1] | The whole string must be a number |
| `strings.Split("a,b,,c", ",")` | `["a" "b" "" "c"]` ✅[^1] | `Split` keeps empty pieces; `Fields` splits on runs of white space and returns only non-empty elements ✅[^4] |
| `fmt.Printf("%q", s[1])` on `"héllo"` | `'Ã'` ✅[^1] | The byte 195 printed as the code point U+00C3 |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Index and slice the string by bytes | No allocation; fast | Can split a code point |
| `for range` over the string | No allocation; correct code points | Sequential only |
| Convert to `[]rune` | Random access by code point | Allocates 4 bytes per code point |
| `+=` in a loop | Simple | A new string each time (strings are immutable ✅[^2]) |
| `strings.Builder` | Few copies ✅[^4] | Must not be copied once used ✅[^4] |

## Takeaways
- Count, cut and reverse user-visible text by runes (`range`, `utf8`), never by `len` and byte slicing. [rule-candidate]
- Convert numbers with `strconv.Itoa`/`Atoi`, never `string(n)`; keep `go vet` in continuous integration (CI) to catch it. [rule-candidate]
- Validate external input with `utf8.ValidString` before treating it as text, since strings may hold any bytes.
- Build strings in loops with `strings.Builder` (or `bytes.Buffer` for bytes). [rule-candidate]

## Verification status
- Verified: 56 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: Source code representation, String literals, String types, Numeric types (`byte`, `rune` aliases), Index expressions, Conversions to and from a string type, For statements with range clause, Comparison operators. [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: For (range over strings, U+FFFD for erroneous encodings). [^3]
- [Package strings](https://pkg.go.dev/strings) — Go team, living. Rank 1. Backs: package scope, `Builder`, `Cut`, `CutLast`, `Lines`, `SplitSeq` and the function list. [^4]
- [Package unicode/utf8](https://pkg.go.dev/unicode/utf8) — Go team, living. Rank 1. Backs: `RuneError`, `DecodeRuneInString`, `RuneCountInString`, `ValidString`. [^5]
- [Package unsafe](https://pkg.go.dev/unsafe) — Go team, living. Rank 1. Backs: `StringData`. [^6]
- [Package bytes](https://pkg.go.dev/bytes) — Go team, living. Rank 1. Backs: analogous to `strings`; `Buffer` zero value. [^7]
- [Package strconv](https://pkg.go.dev/strconv) — Go team, living. Rank 1. Backs: `Atoi`, `Itoa`, `ParseInt`, `Quote`. [^11]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: iterator functions in `strings`. [^8]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: `strings.CutLast`, `bytes.CutLast`. [^9]
- [Strings, bytes, runes and characters in Go](https://go.dev/blog/strings) — Rob Pike, Go blog, 2013. Rank 4. Backs: strings hold arbitrary bytes, literals are UTF-8, runes and code points, character ambiguity, `DecodeRuneInString` matches `range`. [^10]

## Related
- `go/data-types/arrays-and-slices.md` — `[]byte` and `[]rune` as slices.
- `go/fundamentals/declarations-types-and-constants.md` — `byte`, `rune` and untyped rune constants.
- `go/standard-library/io-and-encoding-json.md` — text streams, `bufio` and JSON (JavaScript Object Notation) strings.
- `go/standard-library/iterators.md` — `strings.Lines`, `strings.SplitSeq` and range-over-func.
- `go/learning-path.md` — where this doc sits in the learning order.
