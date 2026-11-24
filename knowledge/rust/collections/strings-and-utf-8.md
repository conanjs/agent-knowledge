---
schema: knowledge-doc/v1
type: concept
topic: rust/collections
status: verified
applies-to: ["Rust 1.100.0", "edition 2024"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [rust, string, str, utf-8, char-boundary, slicing, cow, format, osstring, cstring, path]
---

# Strings and UTF-8

## Summary
**TL;DR:** `String` is an owned, growable buffer of UTF-8 bytes (pointer, capacity, length: 24 bytes); `&str` is a borrowed view of UTF-8 bytes (pointer and length: 16 bytes), and string literals are `&'static str`. Lengths and positions are in **bytes**: `"Tiếng Việt".len()` is 14 while `.chars().count()` is 10. There is no integer indexing (`s[0]` is E0277); slicing takes byte ranges and **panics when a bound falls inside a character** ("end byte index 3 is not a char boundary; it is inside 'ế' (bytes 2..5 of string)"), while `s.get(0..3)` returns `None` and `floor_char_boundary` finds a safe cut. `chars()` yields Unicode scalar values, which are not always what a reader calls a letter. `a + &b` consumes `a` and borrows `b`; `format!` borrows everything. Bytes that are not UTF-8 go through `String::from_utf8` (an error) or `from_utf8_lossy` (a `Cow<str>` that allocates only when it must replace bytes). At system boundaries use `OsString`/`&OsStr`, `CString`/`&CStr` and `PathBuf`/`&Path`.
**Use this when:** you slice or truncate text, count characters, a string index panics or does not compile, you concatenate strings, you read bytes that may not be UTF-8, or you pass strings to the OS or to C.
**Not this doc:** `&str` as a borrowed slice and the borrowing rules → `rust/ownership/borrowing-references-and-slices.md`; `char` as a scalar type → `rust/fundamentals/variables-types-and-control-flow.md`; deref coercion (`&String` to `&str`) → `rust/smart-pointers/box-deref-and-drop.md`; `Vec` growth, which `String` shares → `rust/collections/vec-hashmap-and-std-collections.md`; passing `CString` to C → `rust/unsafe/ffi-and-c-interop.md`; `Cow` as an API idiom → `rust/design-patterns/idioms-and-api-guidelines.md`.

## Problem
Text code written with ASCII in mind breaks on the first non-English input. `&title[..3]` crashes on a Vietnamese title, a "max 20 characters" check counts bytes instead, `name[0]` does not compile, and `s1 + s2` with two `String`s is a type error. Upper-casing "straße" changes its length, and two strings that print the same é compare unequal.

## Mental model
**Analogy:** a `String` is a shelf of byte-sized slots where each letter occupies one to four slots. You cannot ask for "the third letter" without walking from the left end, so Rust does not offer `s[2]`. You may cut the shelf only between letters, never through one. A `&str` is a pointer to a stretch of somebody's shelf plus its length.

**Artifact:** the bytes behind a Vietnamese phrase (lab, Rust 1.100.0) ✅[^1]:
```rust
fn main() {
    let lang = String::from("Tiếng Việt");
    println!("len() = {} bytes, chars().count() = {}", lang.len(), lang.chars().count());
    println!("bytes: {:?}", lang.as_bytes());
    println!("char_indices: {:?}", lang.char_indices().collect::<Vec<_>>());
    println!("&lang[2..5] = {:?}, get(0..3) = {:?}", &lang[2..5], lang.get(0..3));
}
```
```text
len() = 14 bytes, chars().count() = 10
bytes: [84, 105, 225, 186, 191, 110, 103, 32, 86, 105, 225, 187, 135, 116]
char_indices: [(0, 'T'), (1, 'i'), (2, 'ế'), (5, 'n'), (6, 'g'), (7, ' '), (8, 'V'), (9, 'i'), (10, 'ệ'), (13, 't')]
&lang[2..5] = "ế", get(0..3) = None
```
`ế` takes bytes 2, 3 and 4 (`225, 186, 191`), so 3 is not a valid cut.

## How it works
1. **Two types.**
   - The core language has one string type, `str`, usually seen as `&str`; `String` comes from the standard library and is growable, owned and UTF-8 ✅[^2] ✅[^4].
   - A `String` is a wrapper over a `Vec<u8>` with the extra rule that the bytes stay valid UTF-8 ✅[^2]; it is made of a pointer, a length and a capacity, always on the heap ✅[^3]. A `&str` is a pointer and a length ✅[^4]. Measured on aarch64: `String` 24 bytes, `&str` 16, `Box<str>` 16 ✅[^1].
   - A string literal has type `&'static str` ✅[^4] ✅[^1].
   - `String` implements `Deref<Target = str>`, so it has every `str` method and `&my_string` can be passed where `&str` is expected ✅[^3]. Write functions that read text as `fn f(s: &str)`.
2. **UTF-8 and lengths.**
   - `len()` is the length in bytes, not in `char`s or graphemes ✅[^4]. A scalar value takes 1 to 4 bytes ✅[^7].
   - Text has three views: bytes, scalar values (`char`) and grapheme clusters (what a reader calls letters); std iterates the first two (`bytes()`, `chars()`, `char_indices()`), and grapheme clusters need a crate ✅[^2] ✅[^4].
   - Measured ✅[^1]:

     | Text | Bytes | `chars().count()` | Note |
     |---|---|---|---|
     | `"Tiếng Việt"` | 14 | 10 | `ế`, `ệ` take 3 bytes each |
     | `"\u{00E9}"` (é, one code point) | 2 | 1 | compares unequal to the next row |
     | `"e\u{0301}"` (e + combining accent) | 3 | 2 | prints as the same é ✅[^7] |
     | `"👨‍👩‍👧"` (family emoji) | 18 | 5 | three people joined by two U+200D |
3. **No integer indexing.** `word[0]` fails with E0277 "the type `str` cannot be indexed by `{integer}`", and the compiler suggests `.chars().nth()` or `.bytes().nth()` ✅[^2] ✅[^1]. Indexing should be O(1), which a variable-width encoding cannot give for "the n-th character" ✅[^2] ✅[^3].
4. **Slicing by byte range.**
   - `&s[a..b]` takes byte offsets and returns a `&str`; each bound must be a char boundary ✅[^2] ✅[^3].
   - A bound inside a character panics at run time: `&title[..3]` on `"Tiếng Việt"` stopped the program with exit code 101 and "end byte index 3 is not a char boundary; it is inside 'ế' (bytes 2..5 of string)" ✅[^1].
   - `is_char_boundary(i)` tests an offset; `get(range)` returns `None` where slicing would panic ✅[^4] ✅[^1].
   - `floor_char_boundary(i)` (stable since 1.91.0) returns the largest boundary not above `i`, the tool for truncating to a byte budget; it can still split a grapheme such as an emoji sequence ✅[^4].
5. **Building strings.**
   - `String::new()`, `String::from("…")` and `"…".to_string()` create one; `push_str(&str)` appends without taking ownership of its argument, `push(char)` appends one `char` ✅[^2].
   - `+` calls `fn add(self, s: &str) -> String`: it consumes the left `String` and borrows the right side ✅[^2]. `log + " host=" + &host` gave `"id=7 host=db1"` with `host` still usable; using `a` after `a + &b` fails with E0382; `a + b` with two `String`s fails with E0308 "expected `&str`, found `String`" ✅[^1].
   - `format!` returns a new `String` and borrows its arguments ✅[^2]: `format!("{a}-{b}-{}", 3)` gave `"x-y-3"`, and `a` and `b` were still usable ✅[^1]. `["a", "b"].concat()` is `"ab"`, `["a", "b", "c"].join("/")` is `"a/b/c"` ✅[^1].
6. **Case mapping can change the length.** `char::to_uppercase` yields one to three `char`s ✅[^7]. Measured ✅[^1]:
   - `"straße"` (6 chars) upper-cases to `"STRASSE"` (7 chars);
   - `"ﬁle"` (5 bytes, with the ligature ﬁ) upper-cases to `"FILE"` (4 bytes);
   - `"İ"` (1 char) lower-cases to `"i\u{307}"` (2 chars).
7. **Comparing and parsing.** `==` and `<` compare bytes, so `"Zebra" < "apple"` is `true`; `eq_ignore_ascii_case` folds ASCII letters only: `"HeLLo"` equals `"hello"`, but `"ÉTÉ"` does not equal `"été"` ✅[^1]. `"  port = 8080  ".trim().split_once('=')` and `parse::<u16>()` gave the port 8080; `"abc".parse::<u16>()` is `Err(ParseIntError { kind: InvalidDigit })` ✅[^1].
8. **Bytes that may not be UTF-8.**
   - A `str` is always assumed to be UTF-8; building one that is not can cause undefined behaviour later, in any function that relies on the rule ✅[^4]. `String` is always valid UTF-8 ✅[^3].
   - `String::from_utf8(vec![b'o', b'k', 0xFF])` returns `Err(Utf8Error { valid_up_to: 2, error_len: Some(1) })` ✅[^3] ✅[^1].
   - `String::from_utf8_lossy` replaces invalid sequences with U+FFFD and returns a `Cow<str>`: owned (`"ok�"`) when it had to replace, borrowed when the input was already valid (`"fine"`) ✅[^3] ✅[^1].
9. **`Cow<str>`.** `Cow` (clone on write) holds either borrowed data (`Cow::Borrowed(&str)`) or owned data (`Cow::Owned(String)`) and clones only when ownership or mutation is needed; `to_mut` and `into_owned` clone only if the data is still borrowed ✅[^5]. A function that escapes `<` only when present (`fn escape_lt(input: &str) -> Cow<'_, str>`) returned borrowed `"plain"` and owned `"a&lt;b"` ✅[^1].
10. **Strings at system boundaries.**

    | Owned / borrowed | Holds | Lab result ✅[^1] |
    |---|---|---|
    | `String` / `&str` | UTF-8, may contain `\0`, no terminator ✅[^6] | — |
    | `OsString` / `&OsStr` | the platform's native string: on Unix any non-zero bytes, on Windows 16-bit units ✅[^8] | `OsStr::from_bytes(b"report\xFF.csv")`: `to_str()` is `None`, `to_string_lossy()` is `"report�.csv"` |
    | `CString` / `&CStr` | nul-terminated, no nul inside ✅[^6] ✅[^9] | `CString::new("hello")` bytes end in `0`; `CString::new("he\0llo")` is `Err(NulError(2, …))` |
    | `PathBuf` / `&Path` | an OS string with path operations; `to_str` returns `None` for non-UTF-8, `display` may be lossy ✅[^10] | `extension()` of that file is `"csv"`, `file_stem()` is `"report\xFF"`; `/var/log` + `push("app")` + `set_extension("log")` is `"/var/log/app.log"` |

    `OsStrExt::from_bytes` and `as_bytes` exist on Unix only ✅[^6]. Environment values can be read without a UTF-8 check: `let home: Option<OsString> = std::env::var_os("HOME");` compiled and gave `Some("/root")` ✅[^1].

## Worked example
Truncating a title to a byte budget without panicking (lab) ✅[^1]:
```rust
fn clip(s: &str, max_bytes: usize) -> &str {
    &s[..s.floor_char_boundary(max_bytes)]       // largest char boundary <= max_bytes
}

fn main() {
    let title = "Tiếng Việt";
    for max in [2, 3, 4, 5, 11, 20] {
        let c = clip(title, max);
        println!("max {max:>2}: {c:?} ({} bytes, {} chars)", c.len(), c.chars().count());
    }
    println!("get(..3) = {:?}", title.get(..3));
    let naive = std::hint::black_box(3);
    println!("{}", &title[..naive]);
}
```
stdout, then stderr:
```text
max  2: "Ti" (2 bytes, 2 chars)
max  3: "Ti" (2 bytes, 2 chars)
max  4: "Ti" (2 bytes, 2 chars)
max  5: "Tiế" (5 bytes, 3 chars)
max 11: "Tiếng Vi" (10 bytes, 8 chars)
max 20: "Tiếng Việt" (14 bytes, 10 chars)
get(..3) = None
thread 'main' (23) panicked at clip.rs:13:26:
end byte index 3 is not a char boundary; it is inside 'ế' (bytes 2..5 of string)
```
Reading it: budgets 3 and 4 land inside `ế` (bytes 2–4), so `floor_char_boundary` steps back to 2; budget 5 is the end of `ế`; budget 11 lands inside `ệ` (bytes 10–12) and steps back to 10. The naive `&title[..3]` on the last line panics with exit code 101.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `s.chars().nth(i)` in a loop over `i` | O(n) per call, O(n²) overall | Every call walks from the start ✅[^2] |
| `s.chars().rev()` | `"Tiếng Việt"` → `"tệiV gnếiT"` is fine, but `"ae\u{0301}x"` → `"x\u{301}ea"`: the accent moves onto the `x` ✅[^1] | Reverses scalar values, and a combining mark is its own `char` ✅[^7] |
| `"\u{00E9}" == "e\u{0301}"` | `false` ✅[^1] | Byte comparison, no Unicode normalization |
| `.len()` used as "number of characters" | Wrong for non-ASCII: 14 vs 10 above ✅[^1] | Bytes, not `char`s ✅[^4] |
| `floor_char_boundary(20)` on a 14-byte string | Returns 14, whole string ✅[^1] | Never beyond the end |
| `"abc".parse::<u16>()` | `Err`, not a panic ✅[^1] | `parse` returns a `Result` |
| A `"🧑‍🔬"` cut by `floor_char_boundary` | Can leave only `"🧑"` | Boundaries are per `char`, not per grapheme ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Accept `&str` in parameters | Callers pass literals, `&String` or slices ✅[^3] | Cannot keep the text past the borrow |
| Return `String` | Caller owns the result | One allocation per call |
| Return `Cow<'_, str>` | Allocates only when the text changes ✅[^5] | A lifetime in the signature; callers see two cases |
| `+` chains | Reuses the left buffer ✅[^2] | Moves the left operand; hard to read past two terms |
| `format!` | Clear, borrows all inputs ✅[^2] | Always allocates a new `String` |
| `from_utf8` vs `from_utf8_lossy` | Error you can report vs best-effort text ✅[^3] | Handling an `Err` vs silently replaced bytes |

## Takeaways
- Never slice a `&str` with an offset you computed by counting; use `char_indices`, `get`, or `floor_char_boundary`. [rule-candidate]
- Do not treat `len()` as a character count in user-facing limits. [rule-candidate]
- Take `&str` parameters, return `String` (or `Cow<str>` when most inputs pass through unchanged). [rule-candidate]
- Build strings with `format!` or `push_str`; keep `+` for one short join.
- Keep paths and OS strings in `Path`/`OsStr` until you must show them; convert with `to_string_lossy` or `display` only at the edge.

## Verification status
- Verified: 67 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `linux/lab-setup.md` — the Rust 1.100.0 lab (`rustlab:1`) where every behaviour marked with this note ran on 2026-11-24. [^1]
- [Storing UTF-8 Encoded Text with Strings](https://doc.rust-lang.org/book/ch08-02-strings.html) — The Rust Programming Language (Klabnik, Nichols, Krycho and the Rust community), living. Backs: `str` vs `String`, `Vec<u8>` wrapper, `push_str`/`push`, `+` and `format!`, no indexing and why, byte ranges, three views of text. [^2]
- [String in std::string](https://doc.rust-lang.org/std/string/struct.String.html) — Rust standard library docs 1.100.0, living. Backs: always UTF-8, representation, `Deref<Target = str>`, indexing forbidden, `from_utf8`, `from_utf8_lossy`. [^3]
- [str](https://doc.rust-lang.org/std/primitive.str.html) — Rust standard library docs 1.100.0, living. Backs: `&'static str` literals, pointer and length, UTF-8 invariant, `len` in bytes, `is_char_boundary`, `get`, `floor_char_boundary`, `chars`. [^4]
- [Cow in std::borrow](https://doc.rust-lang.org/std/borrow/enum.Cow.html) — Rust standard library docs 1.100.0, living. Backs: clone-on-write, variants, `to_mut`, `into_owned`. [^5]
- [std::ffi](https://doc.rust-lang.org/std/ffi/index.html) — Rust standard library docs 1.100.0, living. Backs: owned/borrowed pairs, nul terminators, `OsStrExt` on Unix. [^6]
- [char](https://doc.rust-lang.org/std/primitive.char.html) — Rust standard library docs 1.100.0, living. Backs: 1–4 UTF-8 bytes, composed vs decomposed é, `to_uppercase` up to three `char`s. [^7]
- [OsString in std::ffi](https://doc.rust-lang.org/std/ffi/struct.OsString.html) — Rust standard library docs 1.100.0, living. Backs: Unix and Windows native strings. [^8]
- [CString in std::ffi](https://doc.rust-lang.org/std/ffi/struct.CString.html) — Rust standard library docs 1.100.0, living. Backs: nul-terminated, `NulError` with the position. [^9]
- [Path in std::path](https://doc.rust-lang.org/std/path/struct.Path.html) — Rust standard library docs 1.100.0, living. Backs: unsized path slice, `extension`, `file_stem`, lossy `display`, `to_str`. [^10]

## Related
- `rust/collections/vec-hashmap-and-std-collections.md` — the `Vec` underneath every `String`.
- `rust/ownership/borrowing-references-and-slices.md` — `&str` as a slice and the borrow rules.
- `rust/unsafe/ffi-and-c-interop.md` — `CString` and `CStr` across the C boundary.
- `rust/design-patterns/idioms-and-api-guidelines.md` — `Cow`, `AsRef<str>` and `Into<String>` in APIs.
