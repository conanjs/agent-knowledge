---
schema: knowledge-doc/v1
type: reference
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "binary.AppendByteOrder and AppendUvarint: Go ≥ 1.19", "binary.NativeEndian: Go ≥ 1.21", "base64 and hex AppendEncode/AppendDecode: Go ≥ 1.22", "binary.Append, Encode, Decode: Go ≥ 1.23"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, encoding-csv, encoding-xml, encoding-binary, encoding-gob, encoding-base64, encoding-hex, struct-tags, varint, endianness, padding]
ranked-sources: true
---

# CSV, XML and binary encodings: encoding/csv, xml, binary, gob, base64 and hex

## Summary
**TL;DR:** A lookup sheet for six standard encoding packages in Go 1.27, for CSV (comma-separated values), XML (Extensible Markup Language) and binary data: the `csv.Reader` fields and when the `csv.Writer` quotes, the `xml` struct-tag options and how names match, `binary` byte orders, fixed-size values, varints and the Go 1.23 `Append`/`Encode`/`Decode` functions, `gob`'s Go-only self-describing streams and `Register`, and the four `base64` encodings and `hex` with their padding and length rules. Rows marked with the lab note were run on Go 1.27.4.
**Use this when:** you need the exact field, tag option, function or error text of one of these packages, or want to know why a CSV field got quotes, an XML element was skipped, or a gob or base64 decode failed.
**Not this doc:** JSON and the `io.Reader`/`io.Writer` contract → `go/standard-library/io-and-encoding-json.md`; struct tags and reflection in general → `go/low-level/reflection.md`; PNG and other image formats → `go/standard-library/images.md`.

## Scope
The packages `encoding/csv` (CSV: comma-separated values), `encoding/xml` (XML: Extensible Markup Language), `encoding/binary`, `encoding/gob`, `encoding/base64` and `encoding/hex` as documented on pkg.go.dev for Go 1.27, plus the release notes that changed them. Lab values come from the `golang:1.27.4` image on linux/arm64.

| Term | Plain meaning | Example |
|---|---|---|
| Byte order (endianness) | Which end of a number is written first, like writing a date as year-month-day or day-month-year | `0x01020304` big-endian is `01 02 03 04`, little-endian `04 03 02 01` ✅[^1] |
| Fixed-size value | A value whose encoded length never changes: sized numbers, `bool`, and arrays or structs made only of them ✅[^5] | `uint32` is 4 bytes; plain `int` is not fixed-size ✅[^1] |
| Varint | A number written in as few bytes as it needs, like writing "7" instead of "0007" ✅[^5] | `300` → `ac 02` ✅[^1] |
| Self-describing stream | The data carries its own type description, like a parcel with the packing list inside ✅[^6] | A gob's first value carries the type, later ones do not |
| Padding | Filler characters that round base64 output up to a multiple of 4 ✅[^7] | `"a"` → `YQ==` ✅[^1] |

## Catalog

### `encoding/csv`: `Reader` fields (set before the first `Read`)
| Field | Default from `NewReader` | Effect ✅[^2] | Lab on Go 1.27.4 ✅[^1] |
|---|---|---|---|
| `Comma` | `','` | Field delimiter; a valid rune, not `\r`, `\n` or U+FFFD | `'\t'`: `a⇥b c⇥d` (⇥ is a tab) → `["a" "b c" "d"]` |
| `Comment` | `0` (off) | Lines that **start** with it are skipped; after leading white space it is part of the field | `#skip me` skipped; ` #kept` → `[" #kept"]` |
| `FieldsPerRecord` | `0` | `> 0`: exactly that many; `0`: set from the first record; `< 0`: no check | `0`: line 2 with 3 fields → `record on line 2: wrong number of fields`, record still returned |
| `LazyQuotes` | `false` | A quote may appear in an unquoted field, and a lone quote inside a quoted field | `a,b"c",d` → `["a" "b\"c\"" "d"]` |
| `TrimLeadingSpace` | `false` | Ignore leading white space in a field, even when `Comma` is white space | `a, b ,c` → `["a" "b " "c"]` |
| `ReuseRecord` | `false` | `Read` may return a slice that shares the previous call's backing array | The first record's slice now read `["c" "d"]` |
| `TrailingComma` | — | Deprecated, not used | — |

### `encoding/csv`: reading rules
| Rule ✅[^2] | Lab ✅[^1] |
|---|---|
| Format of RFC 4180 (Request for Comments 4180) | — |
| White space belongs to the field | `a, b ,c` → `" b "` |
| `\r\n` becomes `\n`, also inside multi-line quoted fields | `"line1\r\nline2"` → `"line1\nline2"` |
| Blank lines are skipped; a line of only spaces is not blank | `a,b,c\n\n…` gave two records |
| `""` inside a quoted field is one `"`; commas and newlines are allowed inside quotes | `"say ""hi"""` → `say "hi"` |
| `Read` returns the record **and** `ErrFieldCount`; on a parse error, the fields read so far and the error; at the end `nil, io.EOF` | bare quote → `["a"]` and the error |
| `ReadAll` returns `err == nil` at end of file, not `io.EOF` | `[["h1" "h2"] ["v1" "v2"]] err=<nil>` |
| `*ParseError` has `StartLine`, `Line`, `Column` (1-based byte index) and `Err`, one of `ErrBareQuote`, `ErrQuote`, `ErrFieldCount`; `Unwrap` since Go 1.13 | `parse error on line 1, column 4: bare " in non-quoted-field`; `errors.Is(err, csv.ErrBareQuote)` true |
| `FieldPos(i)` (Go 1.17) and `InputOffset()` (Go 1.19) locate the last record | field 1 of line 2 → `2 4`, offset `14` |

### `encoding/csv`: `Writer`
| Item | Rule | Lab ✅[^1] |
|---|---|---|
| `Comma`, `UseCRLF` | Delimiter `','`; lines end in `\n` (LF, line feed) unless `UseCRLF` asks for `\r\n` (CRLF, carriage return + line feed) ✅[^2] | `Comma=';'`, `UseCRLF`: `"a;b";c,d\r\ne;f\r\n` |
| When a field is quoted | It contains `Comma`, `"`, `\r` or `\n`, starts with a white-space character, or is exactly `\.`; the empty string is not quoted (since Go 1.4) ✅[^3] | `has,comma` → `"has,comma"`, ` leading space` → `" leading space"`, `\.` → `"\."`, `trailing space ` and `""` unquoted |
| Quotes inside a field | Doubled | `has "quote"` → `"has ""quote"""` |
| Buffering | `Write` buffers; call `Flush`, then check `Error`, which reports any error from `Write` or `Flush` ✅[^2] | 0 bytes in the buffer before `Flush` |
| `WriteAll` | `Write` for each record, then `Flush`; returns the `Flush` error ✅[^2] | — |

### `encoding/xml`: struct tags
| Tag (key `xml`) | `Marshal` ✅[^4] | `Unmarshal` ✅[^4] | Lab ✅[^1] |
|---|---|---|---|
| `XMLName xml.Name` field | Its tag, then its value, names the element | Records the element name; a tag `"name"` requires that root name | `expected element type <book> but have <Book>` |
| `"name"` | Element `name` | Sub-element `name`, compared case-sensitively | `<Title>` ignored, `<title>` taken |
| `"-"` | Omitted | Never set | — |
| `"name,attr"`, `",attr"` | Attribute with that name, or the field name | Attribute value of that name | `<book id="b1" Lang="en">` |
| `",chardata"` | Character data, not an element | Character data of the element, in the first such field (`string` or `[]byte`) | `a < b` → `a &lt; b`; `one <i>two</i> three` → `"one  three"` |
| `",cdata"` | Character data inside `<![CDATA[ … ]]>` | — | `<code><![CDATA[if a < b && c]]></code>` |
| `",innerxml"` | Written verbatim | Raw XML inside the element | `<b>bold</b> tail` |
| `",comment"` | XML comment; must not contain `--` | Comments of the element | `a--b` → `xml: comments must not contain "--"` |
| `",omitempty"` | Skipped when false, 0, nil pointer or interface, or length zero | — | `Price: 0` left out |
| `"a>b>c"` | Nested in parents `a`, `b`; neighbouring fields share a parent | Descends the path | `<authors><author>A</author><author>B</author></authors>` |
| `",any"` | — | A sub-element no other rule matched | `Other: [x y]` |
| `",any,attr"` | — | An attribute no other rule matched | `Attrs: [a=1 b=2]` |
| Anonymous struct field | Fields promoted to the outer struct | Same | — |
| Unexported field | Not written | Cannot be set (reflection reaches exported fields only) | `internal` stayed empty |

### `encoding/xml`: other rules
| Rule | Lab ✅[^1] |
|---|---|
| Element name, in order of preference: tag on `XMLName`, value of `XMLName`, field tag, field name, type name ✅[^4] | — |
| `Marshal` fails on channels, functions and maps ✅[^4] | `xml: unsupported type: map[string]int` |
| `xml.Header` (`<?xml version="1.0" encoding="UTF-8"?>` and a newline) is never added for you ✅[^4] | — |
| Well-formed data that does not fit the target is discarded ✅[^4] | `<extra>z</extra>` ignored |
| A missing element or empty attribute leaves the zero value; numbers are parsed in decimal with white space trimmed and no overflow check ✅[^4] | — |
| `Decoder.Token` streams `StartElement`, `CharData`, `EndElement` …; `Strict = false` with `HTMLAutoClose` and `HTMLEntity` parses typical HTML ✅[^4] | `start a [{{ x} 1}]`, `chardata "hi"`, `end a`, then `EOF` |
| Malformed input | `XML syntax error on line 1: element <title> closed by </book>` |

### `encoding/binary`: fixed-size values
| Name | Since | Does ✅[^5] | Lab ✅[^1] |
|---|---|---|---|
| `BigEndian`, `LittleEndian` | — | `ByteOrder`: `Uint16/32/64`, `PutUint16/32/64` | `e8 03` → 59395 big-endian, 1000 little-endian |
| `NativeEndian` | Go 1.21 ✅[^9] | The machine's own byte order | linux/arm64: `04 03 02 01` |
| `AppendByteOrder` | Go 1.19 | `AppendUint16/32/64` on all three orders | `AppendUint16([]byte{0xAA}, 0x0102)` → `aa 01 02` |
| `Write(w, order, data)` | — | A fixed-size value, a slice of them, or a pointer to such data; `bool` is one byte; blank `_` fields write zeros | 13-byte header struct; `int` → `binary.Write: some values are not fixed-sized in type int` |
| `Read(r, order, &data)` | — | Pointer to fixed-size data or a slice of it; blank fields skipped; other fields must be exported; `io.EOF` only if no bytes, else `io.ErrUnexpectedEOF` | 5 of 13 bytes → `unexpected EOF`; empty → `EOF` |
| `Size(v)` | — | Bytes `Write` would produce; `-1` if not fixed-size | `13`; `Size(42)` → `-1` |
| `Append(buf, order, data)` | Go 1.23 ✅[^11] | Appends to `buf` (which may be nil) | `uint32(7)`, `int16(-1)` → `07 00 00 00 ff ff` |
| `Encode(buf, order, data)` | Go 1.23 ✅[^11] | Writes into `buf`; error if too small, else bytes written | 2-byte buffer → `buffer too small`; 8-byte → `n=4` |
| `Decode(buf, order, &data)` | Go 1.23 ✅[^11] | Reads from `buf`; error if too small, else bytes consumed | `1 4`; 3 bytes → `buffer too small` |

### `encoding/binary`: varints
| Name | Does ✅[^5] | Lab ✅[^1] |
|---|---|---|
| `PutUvarint`, `AppendUvarint` (Go 1.19), `Uvarint`, `ReadUvarint` | Unsigned varint; `Put…` panics if the buffer is too small | `1`→`01`, `127`→`7f`, `128`→`80 01`, `300`→`ac 02`, `1<<63` → 10 bytes |
| `PutVarint`, `AppendVarint` (Go 1.19), `Varint`, `ReadVarint` | Signed varint | `-1`→`01`, `1`→`02`, `-64`→`7f`, `64`→`80 01` |
| `MaxVarintLen16/32/64` | 3, 5, 10 bytes | — |
| `Uvarint(buf)` results | `n > 0` bytes read; `n == 0` buffer too small; `n < 0` overflow after `-n` bytes | `ac 02 ff` → `300 2`; `80` → `0 0`; eleven `ff` → `0 -11` |
| `ReadUvarint(r)` errors | `io.EOF` only if no bytes were read, else `io.ErrUnexpectedEOF` | `300`, `3`, then `EOF`; lone `80` → `unexpected EOF` |

### `encoding/gob`
| Rule | Detail | Lab ✅[^1] |
|---|---|---|
| What it is | Streams of binary values between an `Encoder` and a `Decoder`, for example the arguments and results of remote procedure calls (RPCs) in `net/rpc` ✅[^6] | — |
| Go only | Designed for Go-to-Go traffic; gobs "will never work as well with other languages" ✅[^12] | — |
| Self-describing | Each item is preceded by its type; the `Encoder` sends type information once, before it is needed; one `Encoder` per stream is the efficient way ✅[^6] | First value 64 bytes, second value of the same type 11 bytes (sizes depend on the values sent) |
| Matching | Struct fields match by name, in any order; extra and missing fields are ignored; pointers and integer sizes may differ ✅[^6] | `P{X,Y,Z,Name}` decoded into `Q{Y,X *int32,Name,Extra}` |
| Incompatible types | A change of signedness or kind, or no field names in common, is a decode error ✅[^6] | `gob: wrong type (uint) for received field Signed.B`; `gob: type mismatch: no fields matched compiling decoder for` |
| What is sent | Exported fields only; zero-valued fields are omitted; `chan` and `func` fields are ignored ✅[^6] | Top-level `func` → `gob NewTypeObject can't handle type: func()` |
| Nil pointers | Not permitted ✅[^6] | Top-level `(*P)(nil)` **panicked**: `gob: cannot encode nil pointer of type *main.P` |
| Interface values | Sent with the concrete type's name, which must be registered with `Register` or `RegisterName`; `Register` panics if names and types are not one-to-one ✅[^6] | Unregistered → `gob: type not registered for interface: main.Square`; after `gob.Register(Square{})` it decoded |
| Decoding into existing values | Maps, structs and slices are merged element by element, not cleared ✅[^6] | `map[a:1]` + received `map[b:2]` → `map[a:1 b:2]` |
| Custom encoding | `GobEncoder`/`GobDecoder`, then `encoding.BinaryMarshaler`/`BinaryUnmarshaler`, in that order ✅[^6] | — |
| Untrusted input | Not hardened against adversarial input and outside the Go security policy; size limits are basic and not configurable ✅[^6] | — |

### `encoding/base64`
| Encoding | Characters 62 and 63 | Padding | Lab: bytes `fb ff fe 68 69` ✅[^1] |
|---|---|---|---|
| `StdEncoding` | `+` `/` ✅[^7] | `=` | `+//+aGk=` |
| `URLEncoding` | `-` `_`, for URLs and file names ✅[^7] | `=` | `-__-aGk=` |
| `RawStdEncoding` | `+` `/` | none (RFC 4648 §3.2) ✅[^7] | `+//+aGk` |
| `RawURLEncoding` | `-` `_` | none ✅[^7] | `-__-aGk` |

| Rule ✅[^7] | Lab ✅[^1] |
|---|---|
| `Encode` pads to a multiple of 4 bytes, so it is not for single blocks of a stream; use `NewEncoder` and `Close` it to flush the last partial block | Stream printed `Zm9vAGJh`, and `cg==` only at `Close` |
| `EncodedLen(n)`; `DecodedLen(n)` is the maximum decoded length | `"a"`, `"ab"`, `"abc"` → 4; `"abcd"` → 8; `DecodedLen(8)` = 6 |
| Decoding ignores `\r` and `\n`; bad input gives `CorruptInputError` | `"YW\nI="` → `ab`; `illegal base64 data at input byte 3` |
| Padded and raw encodings do not accept each other's input | Std on `YWI` → error; Raw on `YWI=` → error at byte 3 |
| `Strict()` (Go 1.8) also requires the unused trailing bits to be zero | `YWJ=` → `ab` normally, error in strict mode |
| `WithPadding(r)` (Go 1.5); since Go 1.22 a negative value other than `NoPadding` panics ✅[^10] | `WithPadding(-2)` → panic `invalid padding` |
| `AppendEncode`, `AppendDecode` since Go 1.22 ✅[^10] | `AppendEncode([]byte("data:"), "hi")` → `data:aGk=` |

### `encoding/hex`
| Rule ✅[^8] | Lab ✅[^1] |
|---|---|
| `EncodeToString` and `NewEncoder` write lowercase; `EncodedLen(n)` = `n*2`, `DecodedLen(x)` = `x/2` | `"Hi!\xff"` → `486921ff` |
| `Decode`/`DecodeString` need hex digits and an even length | `48492Aff` (mixed case) → `"HI*\xff"` |
| Odd length → `ErrLength`; the stream `NewDecoder` returns `io.ErrUnexpectedEOF` instead | `encoding/hex: odd length hex string` |
| A non-hex byte → `InvalidByteError` | `encoding/hex: invalid byte: U+007A 'z'` |
| `Dump` and `Dumper` match `hexdump -C` | `00000000  47 6f 20 69 73 20 66 75  6e 00 01   |Go is fun..|` |
| `AppendEncode`, `AppendDecode` since Go 1.22 ✅[^10] | `AppendEncode([]byte("0x"), de ad)` → `0xdead` |

## Lookup notes
| Note | Detail |
|---|---|
| CSV output looks unflushed | Nothing reaches the writer until `Flush` ✅[^1]; `Error` is the only place a write error shows up ✅[^2] |
| CSV trailing spaces | Leading white space triggers quoting, trailing does not ✅[^3] ✅[^1] |
| `ReuseRecord` and stored records | Copy a record before the next `Read` if you keep it ✅[^2] |
| XML names are case-sensitive | `<Title>` does not fill a field tagged `title` ✅[^4] ✅[^1]; JSON decoding, by contrast, folds case (see `go/standard-library/io-and-encoding-json.md`) |
| XML `chardata` loses nested markup | Text inside child elements is not part of the parent's character data ✅[^1]; use `innerxml` for the raw content ✅[^4] |
| `binary.Write` with `int` | Fails: use sized types such as `int32` or `uint64` ✅[^1] ✅[^5] |
| `binary` speed | The package favours simplicity over efficiency; for large data structures it points to `encoding/gob` or protocol buffers ✅[^5] |
| Gob nil pointer | Panics at the top level instead of returning an error ✅[^1]; the docs state that passing a nil pointer to an `Encoder` panics ✅[^6] |
| Gob across languages | Use JSON, XML or protocol buffers; gob is Go-centric ✅[^12] |
| Base64 error offsets | For `YWI` in `StdEncoding` the error named byte 0, the start of the incomplete block ✅[^1] |
| Base64 in URLs and file names | `URLEncoding` swaps `+` and `/` for `-` and `_`; `RawURLEncoding` also drops the padding ✅[^7] |

## Takeaways
- Always `Flush` a `csv.Writer` and then check `w.Error()`. [rule-candidate]
- Set `FieldsPerRecord = -1` only when ragged CSV is expected; the default `0` catches broken rows ✅[^2].
- Give every XML struct an `XMLName` field with a tag, so a wrong root element fails loudly ✅[^4] ✅[^1]. [rule-candidate]
- Use sized integer types in structs passed to `binary.Read` or `binary.Write`. [rule-candidate]
- Use gob only between Go programs you control, `Register` every concrete type sent in an interface, and never decode gob from untrusted sources ✅[^6]. [rule-candidate]
- Pick the base64 variant from the receiving side's spec: padded or raw, standard or URL alphabet; the variants do not read each other's output ✅[^1].

## Verification status
- Verified: 81 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24: CSV reading and writing with each `Reader` field, XML marshal and unmarshal with each tag option, `binary` byte orders, `Read`/`Write`/`Size`, `Append`/`Encode`/`Decode` and varints, gob streams, matching, `Register` and nil pointers, base64 variants, `Strict` and `WithPadding`, and `hex`. [^1]
- [encoding/csv package](https://pkg.go.dev/encoding/csv) — Go team, living. Rank 1. Backs: RFC 4180 format, reading rules, `Reader` fields, `Read`/`ReadAll` results, `ParseError` and its errors, `FieldPos`, `InputOffset`, `Writer` fields, `Flush`, `Error`, `WriteAll`. [^2]
- [encoding/csv writer.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/encoding/csv/writer.go) — Go team, 2026. Rank 1. Backs: `fieldNeedsQuotes` (comma, quote, CR, LF, leading space, `\.`, empty string unquoted since Go 1.4). [^3]
- [encoding/xml package](https://pkg.go.dev/encoding/xml) — Go team, living. Rank 1. Backs: `Marshal` and `Unmarshal` tag rules, name precedence, case-sensitive matching, unsupported types, `Header`, discarded data, zero values, `Decoder` fields and `Token`. [^4]
- [encoding/binary package](https://pkg.go.dev/encoding/binary) — Go team, living. Rank 1. Backs: fixed-size values, `ByteOrder` and `AppendByteOrder`, `Read`, `Write`, `Size`, `Append`, `Encode`, `Decode`, the varint functions and their results, `MaxVarintLen*`, simplicity over efficiency. [^5]
- [encoding/gob package](https://pkg.go.dev/encoding/gob) — Go team, living. Rank 1. Backs: streams and RPC use, self-describing types, field matching and errors, exported fields, nil pointers, interface values and `Register`, merging on decode, `GobEncoder`, Security. [^6]
- [encoding/base64 package](https://pkg.go.dev/encoding/base64) — Go team, living. Rank 1. Backs: the four encodings and their alphabets, padding, `Encode` and `NewEncoder`/`Close`, lengths, ignored newlines, `CorruptInputError`, `Strict`, `WithPadding`, `AppendEncode`/`AppendDecode`. [^7]
- [encoding/hex package](https://pkg.go.dev/encoding/hex) — Go team, living. Rank 1. Backs: lowercase output, lengths, even-length rule, `ErrLength` and the stream decoder's `io.ErrUnexpectedEOF`, `InvalidByteError`, `Dump`, `AppendEncode`/`AppendDecode`. [^8]
- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — Go team, 2023. Rank 1. Backs: `binary.NativeEndian`. [^9]
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22) — Go team, 2024. Rank 1. Backs: `AppendEncode`/`AppendDecode` in base32, base64 and hex; `WithPadding` panics on negative values. [^10]
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23) — Go team, 2024. Rank 1. Backs: `binary.Encode`, `Decode` and `Append`. [^11]
- [Gobs of data](https://go.dev/blog/gob) — Rob Pike, Go blog, 2011. Rank 4. Backs: gob is Go-centric and meant for Go-to-Go communication. [^12]

## Related
- `go/standard-library/io-and-encoding-json.md` — JSON, the cross-language choice, and the reader/writer contract these packages build on.
- `go/low-level/reflection.md` — how struct tags are read.
- `go/standard-library/images.md` — PNG bytes, often carried as base64.
- `javascript/browser/binary-data-blobs-and-files.md` — byte order and binary data on the JavaScript side.
- `go/learning-path.md`
