---
schema: knowledge-doc/v1
type: concept
topic: python/data-structures
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, str, bytes, bytearray, unicode, utf-8, encode, decode, normalization, f-string, format-spec, t-string, template]
ranked-sources: true
---

# Strings, bytes and string formatting

## Summary
**TL;DR:** A `str` is an immutable sequence of Unicode code points with no separate character type, and `len()` counts code points, not the letters a reader sees. `bytes` is an immutable sequence of integers 0–255 (`bytearray` is the mutable twin); the only bridge between text and bytes is `encode()` / `decode()`, with UTF-8 (Unicode Transformation Format, 8-bit) and `errors='strict'` as defaults. f-strings (any expression since 3.12), `str.format()` and `%` all format values, and the first two share one format-spec mini-language (fill, align, sign, width, grouping, precision, type). A t-string (3.14) returns a `Template` instead of a `str`, so code can escape each value before the pieces are joined.
**Use this when:** a `UnicodeDecodeError` or `UnicodeEncodeError` appears, `strip('...')` removes more than expected, `split()` and `split(' ')` disagree, two equal-looking strings compare unequal, or you need a format spec, or must choose between f-strings, `str.format()`, `%`, `string.Template` and t-strings.
**Not this doc:** opening files and the `encoding=` argument → `python/errors-and-resources/context-managers-and-file-io.md`; slicing, `in`, `+` and the cost of repeated concatenation → `python/data-structures/lists-tuples-and-sequences.md`; why `0.1 + 0.2` prints oddly → `floating-point/rounding-and-error.md`; docstrings → `code-documentation/doc-comments.md`.

## Problem
Text code fails on inputs the author never tried:
- `'Arthur: three!'.lstrip('Arthur: ')` returns `'ee!'`.
- `' a b '.split(' ')` returns empty strings that `' a b '.split()` does not.
- Two strings that both print `ê` compare unequal and have lengths 1 and 2.
- `b'caf\xe9'.decode()` raises `UnicodeDecodeError`, and `'abc' + b'def'` raises `TypeError`.
- `'value: %s' % (1, 2)` raises `TypeError` instead of printing the tuple.
- An f-string that puts user input into HTML (HyperText Markup Language) or SQL (Structured Query Language) cannot be escaped after the fact.

## Mental model
**Analogy:** a `str` is a row of tiles, each stamped with one Unicode code point number (`U+0041` is `A`). A `bytes` object is a row of small boxes, each holding a number from 0 to 255. An encoding is the packing rule that turns tiles into boxes (UTF-8 uses one to four boxes per tile); decoding unpacks boxes into tiles and fails when the boxes do not follow the rule. A letter a reader sees may be two tiles stacked: a base letter plus a combining accent.

**Artifact** (measured in the lab ✅[^lab]):
```python
text = 'café ☕'
data = text.encode()       # b'caf\xc3\xa9 \xe2\x98\x95'
len(text), len(data)       # (6, 9)    6 code points, 9 UTF-8 bytes
data.decode()              # 'café ☕'
len('\u00ea'), len('e\u0302'), '\u00ea' == 'e\u0302'   # (1, 2, False)  both print ê
f'{3.14159:*>10.2f}'       # '******3.14'
```

## How it works
### `str`
1. **Code points, no char type.** Strings are immutable sequences of Unicode code points; indexing gives a string of length 1, so `s[0] == s[0:1]`, and there is no mutable string type: build one with `str.join()` or `io.StringIO` ✅[^stdtypes]. A code point is an integer from 0 to 0x10FFFF; `chr()` and `ord()` convert between a one-character string and its code point ✅[^howto-unicode]. `ord('A')` is `65` and `chr(9822)` is `'♞'` ✅[^lab].
2. **Literals.** Single or double quotes (each may contain the other), triple quotes that keep newlines, and adjacent literals that join into one: `("spam " "eggs") == "spam eggs"` ✅[^stdtypes]. The prefixes are `b` (bytes), `r` (raw), `f` (f-string), `t` (t-string) and `u` (no effect); they are case-insensitive, and `r` combines with `f`, `t` or `b` ✅[^lexical]. A raw literal keeps backslashes but cannot end in an odd number of them ✅[^lexical]; `r'C:\dir\'` raises `SyntaxError: unterminated string literal (detected at line 1); perhaps you escaped the end quote?` ✅[^lab]. An unrecognised escape such as `'\q'` stays in the string; since 3.12 it gives a `SyntaxWarning`, and a future version will make it a `SyntaxError` ✅[^lexical].
3. **Splitting.** With a separator, `split(sep)` never groups delimiters, so `'1,,2'.split(',')` is `['1', '', '2']` and `''.split(',')` is `['']`. With no separator, runs of whitespace count as one and no empty strings come from the ends, so `''.split()` is `[]` ✅[^stdtypes]. In the lab `' a b '.split(' ')` gave `['', 'a', 'b', '']` and `'  1  2   3 '.split()` gave `['1', '2', '3']` ✅[^lab].
4. **Stripping takes a set of characters.** `strip(chars)`, `lstrip(chars)` and `rstrip(chars)` remove every leading or trailing character found in `chars`, which is a set, not a prefix or suffix ✅[^stdtypes]. To drop one exact prefix or suffix, use `removeprefix()` / `removesuffix()` (3.9) ✅[^stdtypes]. `'logs.csv'.rstrip('.csv')` is `'log'`; `'logs.csv'.removesuffix('.csv')` is `'logs'` ✅[^lab].
5. **Caseless matching and joining.** `casefold()` is a stronger `lower()` meant for caseless matching: `'straße'.lower()` stays `'straße'`, `'straße'.casefold()` is `'strasse'` ✅[^stdtypes]. `sep.join(iterable)` raises `TypeError` if any item is not a string, including `bytes` ✅[^stdtypes]; the lab message is `sequence item 1: expected str instance, int found` ✅[^lab].

### `bytes` and `bytearray`
6. **Bytes are small integers.** A `bytes` object is an immutable sequence of single bytes; its literals allow only ASCII (American Standard Code for Information Interchange) characters, so larger values need escapes, and each item is an integer with `0 <= x < 256` ✅[^stdtypes]. `b[0]` is an `int` while `b[0:1]` is a `bytes` of length 1 ✅[^stdtypes]. For `b'\x89PNG'` they are `137` and `b'\x89'` ✅[^lab]. `bytes(10)` gives ten zero bytes and `bytes(range(20))` builds from integers ✅[^stdtypes]; `bytes([256])` raises `ValueError: bytes must be in range(0, 256)` ✅[^lab].
7. **`bytearray`** is the mutable counterpart, with no literal syntax: build it with `bytearray(...)` ✅[^stdtypes]. The recommended way to accumulate many `bytes` objects is `+=` on a `bytearray` ✅[^faq].
8. **No mixing.** Bytes methods do not accept `str` arguments and string methods do not accept `bytes` ✅[^stdtypes]. `'abc' + b'def'` raises `TypeError: can only concatenate str (not "bytes") to str`, and `b'abc' == 'abc'` is `False` ✅[^lab]. `str(b'Zoot!')` returns the representation `"b'Zoot!'"`, not decoded text; pass an encoding, `str(data, 'utf-8')`, to decode ✅[^stdtypes].

### Encoding and decoding
9. **The two calls.** `str.encode(encoding='utf-8', errors='strict')` returns `bytes` and `bytes.decode(encoding='utf-8', errors='strict')` returns `str`; with `'strict'` a failure raises `UnicodeError` ✅[^stdtypes] or a subclass such as `UnicodeEncodeError`, and these are `ValueError` subclasses ✅[^codecs] ✅[^lab]. In UTF-8 a code point below 128 is one byte and any other is two to four bytes ✅[^howto-unicode].
10. **Error handlers.** The `errors` argument picks what happens to data that does not fit ✅[^codecs]:

    | Handler | Effect ✅[^codecs] | Lab: `'café ☕'.encode('ascii', h)` or `b'caf\xe9'.decode('utf-8', h)` ✅[^lab] |
    |---|---|---|
    | `strict` | raise (the default) | `UnicodeDecodeError: 'utf-8' codec can't decode byte 0xe9 in position 3: unexpected end of data` |
    | `ignore` | drop the bad data | `b'caf '` / `'caf'` |
    | `replace` | `?` when encoding, `U+FFFD` when decoding | `b'caf? ?'` / `'caf�'` |
    | `backslashreplace` | escape sequences | `b'caf\\xe9 \\u2615'` / `'caf\\xe9'` |
    | `surrogateescape` | decode bad bytes to `U+DC80`–`U+DCFF`, restore them when encoding | `'caf\udce9'`, which encodes back to `b'caf\xe9'` |
    | `xmlcharrefreplace` | encoding only: `&#num;` | `b'caf&#233; &#9749;'` |
    | `namereplace` | encoding only: `\N{...}` | `b'caf\\N{LATIN SMALL LETTER E WITH ACUTE} \\N{HOT BEVERAGE}'` |
11. **Guessing is not decoding.** Without outside information the encoding of a byte string cannot be reliably detected ✅[^codecs]. `latin-1` maps the bytes `0x0`–`0xff` to the code points 0–255 ✅[^codecs], so it decodes any byte sequence: in the lab `bytes(range(256)).decode('latin-1')` returned all 256 code points in order ✅[^lab]. So `b'caf\xe9'.decode('latin-1')` succeeds with `'café'` ✅[^lab], but success proves nothing about the sender's encoding.
12. **UTF-8 by default (3.15, PEP 686).** PEP 686 (a Python Enhancement Proposal, the project's design documents) made input and output (I/O) without an explicit `encoding` use UTF-8 whatever the environment says ✅[^whatsnew315]; the opt-out, `encoding="locale"` and the warning that finds affected calls are covered in `python/errors-and-resources/context-managers-and-file-io.md`. The PEP covers files, standard input/output and pipes ✅[^pep686]. The lab reports `sys.flags.utf8_mode == 1` and `locale.getpreferredencoding(False) == 'utf-8'` ✅[^lab].

### What `len()` counts
13. **Combining characters.** `ê` can be one code point (`U+00EA`) or two (`U+0065` plus `U+0302`, the combining circumflex): they print the same but have lengths 1 and 2 ✅[^howto-unicode], and `==` is `False` ✅[^lab]. `unicodedata.normalize(form, s)` converts to a normal form: NFD (normal form D, canonical decomposition) splits characters apart, NFC decomposes then recomposes, and NFKD/NFKC (the compatibility forms) also replace compatibility characters such as `U+2160` (Roman numeral one) with `I` ✅[^unicodedata]. Two strings that look the same may still compare unequal if one holds combining characters and the other does not ✅[^unicodedata]. For caseless comparison the HOWTO normalizes, casefolds and normalizes again: `NFD(NFD(s).casefold())` ✅[^howto-unicode].
14. **Emoji and grapheme clusters.** The family emoji 👨‍👩‍👧 is five code points (three people joined by two `U+200D` zero-width joiners) and 18 UTF-8 bytes, and a flag is two code points ✅[^lab]. `unicodedata.iter_graphemes()` (new in 3.15) splits a string into grapheme clusters by the extended rules of Unicode Standard Annex #29 ✅[^unicodedata]; in the lab it yields one cluster each for the family, the flag and `'e\u0302'`, matching what a reader sees ✅[^lab]. Slicing works on code points, so `'e\u0302'[::-1]` puts the accent before its letter ✅[^lab].

### f-strings
15. **Evaluated at run time.** An f-string is an expression evaluated at run time, not a constant ✅[^pep498]. Each `{...}` holds an expression evaluated where the literal appears, left to right; `{{` and `}}` give literal braces; an empty expression is not allowed; `lambda` and `:=` need parentheses; and an f-string cannot be a docstring ✅[^lexical].
16. **The parts of a field.** After the expression a field may hold a debug specifier `=`, a conversion `!s`, `!r` or `!a` (`str()`, `repr()`, `ascii()`), and a format spec after `:` ✅[^stdtypes]. The value goes through `str()` by default, but through `repr()` when `=` is used without a format spec, and whitespace around `=` is kept ✅[^stdtypes]. In the lab with `name, n = 'Ada', 14.3`: `f'{n=}'` is `'n=14.3'`, `f'{ n - 4 = }'` is `' n - 4 = 10.3'`, `f'{name=:>6}'` is `'name=   Ada'`, and `f'{"é"!a}'` is `"'\\xe9'"` ✅[^lab].
17. **3.12 grammar (PEP 701).** PEP 701 lifted restrictions from PEP 498 and gave f-strings a formal grammar in the parser ✅[^pep701]. Since 3.12 a field can hold any valid expression: the same quote as the enclosing string, several lines, comments, backslashes and `\N{...}` escapes, and f-strings nest to any depth ✅[^whatsnew312]. A `#` in a field comments out the rest of that line, closing brace included ✅[^lexical]. Portable code should not nest more than 5 levels; CPython has no limit ✅[^lexical]. In the lab `f"{d["x"]}"` gave `'2'` and `f'{"\n".join(words)}'` gave `'a\nb'` ✅[^lab].
18. **Nested fields in the spec.** The format spec may itself contain replacement fields, one level deep ✅[^lexical]. For example `f'{3.14159:{width}.{prec}f}'` with `width, prec = 10, 2` is `'      3.14'` ✅[^lab].

### The format-spec mini-language
19. **Grammar.** `[[fill]align][sign]["z"]["#"]["0"][width][grouping]["." [precision][grouping]][type]`; most built-in types follow it, and an empty spec gives the same result as `str()` ✅[^string]. `format(value, spec)` takes the same spec ✅[^string].

    | Part | Meaning ✅[^string] | Lab example ✅[^lab] |
    |---|---|---|
    | fill + align `<` `>` `^` `=` | `<` is the default for most objects, `>` for numbers; `=` pads between sign and digits | `format('hi', '*^8')` → `'***hi***'`; `format(-42, '=+8')` → `'-     42'` |
    | sign `+` `-` space | sign for both, negatives only (default), or a space for positives | `format(42, '+')` → `'+42'`; `format(42, ' ')` → `' 42'` |
    | `z` (3.11) | turn negative zero into zero after rounding | `format(-0.0001, '.2f')` → `'-0.00'`; `'z.2f'` → `'0.00'` |
    | `#` | alternate form: `0b`/`0o`/`0x` prefixes, always a decimal point | `format(255, '#x')` → `'0xff'`; `format(3.0, '#.0f')` → `'3.'` |
    | `0` before width | sign-aware zero padding | `format(-42, '08')` → `'-0000042'` |
    | grouping `,` `_` | separator every 3 digits; `_` every 4 for `b`, `o`, `x`, `X`; after the precision it groups the fraction (3.14) | `format(1234567, ',')` → `'1,234,567'`; `format(0xFFFFFFFF, '_x')` → `'ffff_ffff'`; `format(1234.56789, '.6_f')` → `'1234.567_890'` |
    | precision | digits after the point for `f`, significant digits for `g`, maximum length for strings; not allowed for integers | `format('truncate me', '.5')` → `'trunc'`; `format(42, '.2d')` → `ValueError: Precision not allowed in integer format specifier` |
    | type | `s`; `b c d o x X n`; `e E f F g G n %` | `format(255, 'b')` → `'11111111'`; `format(0.25, '.1%')` → `'25.0%'` |
20. **Rounding.** Float formatting rounds the way `round()` does ✅[^string]. In the lab `format(2.5, '.0f')` is `'2'` and `format(3.5, '.0f')` is `'4'`: the even neighbour each time ✅[^lab].

### `str.format()`, `%`, `string.Template` and t-strings
21. **`str.format()`.** Fields are `{}` (auto-numbered), `{0}`, `{name}`, with `.attr` and `[index]` lookups, an optional `!conversion` and a `:spec`; it does not evaluate arbitrary expressions ✅[^string]. `'{x+1}'.format(x=1)` raises `KeyError: 'x+1'` ✅[^lab].
22. **`%` (printf-style).** Its quirks cause common errors such as showing tuples and dicts wrongly, and f-strings, `str.format()` or `string.Template` may help avoid them ✅[^stdtypes]. The right operand is one non-tuple value, a tuple with exactly one item per conversion, or a mapping used with `%(key)s`; to print a tuple, wrap it in a one-item tuple ✅[^stdtypes]. `'value: %s' % (1, 2)` raises `TypeError: not all arguments converted during string formatting (required 1, got 2)`, while `% ((1, 2),)` prints `'value: (1, 2)'` ✅[^lab].
23. **`string.Template` ($-strings).** Simpler substitution with `$name`, `${name}` and `$$`, aimed mainly at translated text; `substitute()` raises `KeyError` for a missing name, and `safe_substitute()` leaves the placeholder as it was ✅[^string]. It is unrelated to t-strings ✅[^string].
24. **t-strings (3.14, PEP 750).** A `t`-prefixed literal follows the f-string syntax but evaluates to a `string.templatelib.Template` instead of a `str`; `format()` is not called, and each value's conversion and format spec are stored in an `Interpolation` for the processing code to apply or ignore ✅[^stdtypes]. A `Template` exposes `strings` (always one more item than `interpolations`), `interpolations` and `values`, and iterating it yields the strings and `Interpolation` objects in order ✅[^templatelib]. It has no special `__str__()`, because there is no single right way to turn a template into a string ✅[^pep750]. The motivation: an f-string gives no chance to transform values before they are joined, which invites SQL injection and cross-site scripting (XSS, script injected into a web page) bugs ✅[^pep750]; `string.templatelib.convert()` applies `!s`, `!r` or `!a` for custom processors ✅[^templatelib]. In the lab a ten-line renderer that runs `html.escape()` on each value turned `t'Hello {user}!'` with `user = "<b>Bob</b>"` into `'Hello &lt;b&gt;Bob&lt;/b&gt;!'`, where the f-string gave `'Hello <b>Bob</b>!'` ✅[^lab].

## Worked example
Turning an uploaded price list (32 bytes) into an aligned report, with every value measured in the lab ✅[^lab]:

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | `raw = b'name;price\nCaf\xc3\xa9;1234.5\nThe\xcc\x81;7\n'`; `raw.decode('ascii')` | `UnicodeDecodeError: 'ascii' codec can't decode byte 0xc3 in position 14: ordinal not in range(128)` | `strict` raises ✅[^codecs] |
| 2 | `text = raw.decode('utf-8')` | `'name;price\nCafé;1234.5\nThé;7\n'` | the bytes are valid UTF-8 |
| 3 | `header, *lines = text.splitlines()`; `rows = [l.split(';') for l in lines]` | `[['Café', '1234.5'], ['Thé', '7']]` | `split(sep)` keeps every field ✅[^stdtypes] |
| 4 | `[len(name) for name, _ in rows]` | `[4, 4]`: `Café` is precomposed, `Thé` has a combining accent | `len()` counts code points ✅[^howto-unicode] |
| 5 | `f'{name:<6}\|{float(price):>10,.2f}'` per row | `'Café  \|  1,234.50'` and `'Thé  \|      7.00'`: the second bar is one column early on screen | width counts code points too |
| 6 | normalize names with `unicodedata.normalize('NFC', name)`, then repeat step 5 | lengths `[4, 3]`; `'Thé   \|      7.00'` lines up | NFC recomposes ✅[^unicodedata] |
| 7 | `report.encode('ascii', 'xmlcharrefreplace')` | `b'Caf&#233;  \|  1,234.50\nTh&#233;   \|      7.00'` | encode-only handler ✅[^codecs] |

Step 5 is the bug that survives tests written with ASCII names; normalizing at the input boundary (step 6) fixes it.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `s[0] = 'J'` | `TypeError: 'str' object does not support item assignment` ✅[^lab] | Strings are immutable ✅[^stdtypes] |
| `b'café'` in source | `SyntaxError: bytes can only contain ASCII literal characters` ✅[^lab] | Bytes literals are ASCII only ✅[^lexical] |
| `'\q'` in source | `SyntaxWarning: "\q" is an invalid escape sequence...` ✅[^lab] | Unrecognised escapes warn since 3.12 ✅[^lexical] |
| `f'{}'` | `SyntaxError: f-string: valid expression required before '}'` ✅[^lab] | Empty expressions are not allowed ✅[^lexical] |
| `format('x', ',')` | `ValueError: Cannot specify ',' with 's'.` ✅[^lab] | Grouping is for `d` and float types only ✅[^string] |
| `t'x' + 'y'` | `TypeError: can only concatenate string.templatelib.Template (not "str") to string.templatelib.Template` ✅[^lab] | A `Template` is not a `str` ✅[^stdtypes] |
| `Template('Give $who $100').substitute(who='tim')` | `ValueError: Invalid placeholder in string: line 1, col 11` ✅[^lab] | A `$` not followed by a valid placeholder is invalid ✅[^string] |
| A misspelled `errors` value | `'abc'.encode('utf-8', 'bogus')` returns `b'abc'`; `'é'.encode('ascii', 'bogus')` raises `LookupError: unknown error handler name 'bogus'` ✅[^lab] | `errors` is only checked when an encoding error occurs, in development mode or in a debug build ✅[^stdtypes] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| f-string | Any expression in place; debug `=` ✅[^stdtypes] | No way to transform values before they are joined ✅[^pep750] |
| `str.format()` | The format string is plain data: one stored `'{name:<5}\|{qty:>3}'` gave `'tea  \|  2'` and `'milk \| 10'` ✅[^lab] | More manual than an f-string ✅[^tut-io]; no arbitrary expressions ✅[^string] |
| `%` formatting | Familiar from C; often faster for the cases it handles ✅[^stdtypes] | Tuple and dict quirks ✅[^stdtypes]; it is kept, not deprecated ✅[^pep498] |
| `string.Template` | Simple syntax, easy for translators ✅[^string] | Much less control over formatting ✅[^tut-io] |
| t-string | Values reach your code before joining ✅[^pep750] | Needs a processing function; no `__str__()` ✅[^pep750] |

## Takeaways
- Decode bytes at the input boundary and encode at the output boundary; keep `str` everywhere in between, and always name the encoding. [rule-candidate]
- Use `removeprefix()` / `removesuffix()` to drop a fixed string; `strip(chars)` removes a set of characters. [rule-candidate]
- Normalize (NFC) user text before comparing, measuring or padding it.
- Never build SQL, HTML or shell commands with f-strings or `%`; use the library's parameters or a t-string processor that escapes. [rule-candidate]
- Use `split()` with no argument for whitespace-separated words, `split(sep)` for fixed-format fields.
- Prefer f-strings; reach for `str.format()` when the format string is data, and `string.Template` when non-programmers edit it.

## Verification status
- Verified: 115 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Built-in Types: Text Sequence Type — str; Binary Sequence Types](https://docs.python.org/3/library/stdtypes.html) — Python Software Foundation, living. Rank 1. Backs: str as code points, literal forms, `split`, `strip`, `removeprefix`, `casefold`, `join`, bytes and bytearray, `encode`/`decode`, f-string fields and conversions, t-string evaluation, printf-style formatting. [^stdtypes]
- [2. Lexical analysis: String and Bytes literals, f-strings](https://docs.python.org/3/reference/lexical_analysis.html) — Python Software Foundation, living. Rank 1. Backs: prefixes, raw literals, unrecognised escapes, bytes literals, f-string evaluation, comments, nesting limits, nested format fields. [^lexical]
- [string — Common string operations: Format string syntax, Format specification mini-language, Template strings](https://docs.python.org/3/library/string.html) — Python Software Foundation, living. Rank 1. Backs: `str.format()` fields, the mini-language, rounding, `string.Template`. [^string]
- [string.templatelib — Support for template string literals](https://docs.python.org/3/library/string.templatelib.html) — Python Software Foundation, living. Rank 1. Backs: `Template` attributes and iteration, `convert()`. [^templatelib]
- [codecs — Codec registry and base classes: Error Handlers, Encodings and Unicode](https://docs.python.org/3/library/codecs.html) — Python Software Foundation, living. Rank 1. Backs: error handlers, `ValueError` subclasses, encoding detection, the `latin-1` byte mapping. [^codecs]
- [unicodedata — Unicode Database](https://docs.python.org/3/library/unicodedata.html) — Python Software Foundation, living. Rank 1. Backs: normal forms, look-alike strings, `iter_graphemes()`. [^unicodedata]
- [Unicode HOWTO](https://docs.python.org/3/howto/unicode.html) — Python Software Foundation, living. Rank 1. Backs: code point range, `chr`/`ord`, UTF-8 byte counts, combining characters, caseless comparison. [^howto-unicode]
- [7. Input and output: Fancier output formatting](https://docs.python.org/3/tutorial/inputoutput.html) — Python Software Foundation, living. Rank 1. Backs: `str.format()` is more manual; `string.Template` offers less control. [^tut-io]
- [Programming FAQ: What is the most efficient way to concatenate many strings together?](https://docs.python.org/3/faq/programming.html) — Python Software Foundation, living. Rank 1. Backs: accumulate bytes with `bytearray +=`. [^faq]
- [What's New In Python 3.12: PEP 701](https://docs.python.org/3/whatsnew/3.12.html) — Python Software Foundation, 2023. Rank 1. Backs: quote reuse, multi-line expressions, comments, backslashes, nesting. [^whatsnew312]
- [What's new in Python 3.15: Other language changes](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: UTF-8 as the default encoding and how to opt out. [^whatsnew315]
- [PEP 498 – Literal String Interpolation](https://peps.python.org/pep-0498/) — Eric V. Smith, 2015. Rank 1. Backs: f-strings are run-time expressions; older mechanisms are not deprecated. [^pep498]
- [PEP 701 – Syntactic formalization of f-strings](https://peps.python.org/pep-0701/) — Pablo Galindo Salgado, Batuhan Taskaya, Lysandros Nikolaou, Marta Gómez Macías, 2022. Rank 1. Backs: lifted restrictions and a formal grammar. [^pep701]
- [PEP 750 – Template Strings](https://peps.python.org/pep-0750/) — Jim Baker, Guido van Rossum, Paul Everitt, Koudai Aono, Lysandros Nikolaou, Dave Peck, 2024. Rank 1. Backs: motivation (injection, XSS), no `Template.__str__()`. [^pep750]
- [PEP 686 – Make UTF-8 mode default](https://peps.python.org/pep-0686/) — Inada Naoki, 2022. Rank 1. Backs: UTF-8 for files, stdio and pipes. [^pep686]

## Related
- `python/errors-and-resources/context-managers-and-file-io.md` — `open()`, `encoding=` and newline handling.
- `python/data-structures/lists-tuples-and-sequences.md` — the sequence operations `str` and `bytes` share, and why `+=` in a loop is quadratic.
- `python/fundamentals/control-flow-and-pattern-matching.md` — why f-strings and t-strings cannot be `case` patterns.
- `floating-point/rounding-and-error.md` — why a formatted float can differ from the decimal you typed.
