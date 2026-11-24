---
schema: knowledge-doc/v1
type: concept
topic: go/fundamentals
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "0b and 0o prefixes, digit separators, hexadecimal floats, imaginary suffix on any literal: language version Go ≥ 1.13"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, lexical-elements, tokens, semicolons, automatic-semicolon-insertion, comments, literals, integer-literals, rune-literals, raw-strings, escapes, gofmt, go-scanner]
ranked-sources: true
---

# Lexical elements and automatic semicolons

## Summary
**TL;DR:** Before Go parses a program, it cuts the UTF-8 (the standard byte encoding of Unicode text) source into tokens: identifiers, 25 keywords, operators and punctuation, and literals. While doing so it inserts a semicolon after the last token of a line whenever that token could end a statement: an identifier, a literal, `break`, `continue`, `fallthrough`, `return`, `++`, `--`, `)`, `]` or `}`. This one rule explains why an opening brace cannot start the next line and why every line of a multi-line list needs a trailing comma. Number literals take `0b`, `0o` and `0x` prefixes and `_` digit separators (Go 1.13); a rune literal holds exactly one code point; a raw (backquoted) string keeps backslashes as they are and drops carriage returns.
**Use this when:** a compile error says `unexpected newline`, `unexpected semicolon or newline before {` or `possibly missing comma`; you write number, rune or string literals with prefixes or escapes; a literal gives a surprising value (`0600` is 384); or you wonder why `gofmt` rewrote a literal or a line.
**Not this doc:** what a string holds at run time (`len`, `range`, conversions) → `go/data-types/strings-bytes-and-runes.md`; constant types and default types → `go/fundamentals/declarations-types-and-constants.md`; `gofmt -l`/`-d` and the `go` command → `go/introduction/toolchain-and-compatibility.md`; `if`, `for` and `switch` syntax → `go/fundamentals/control-flow-and-functions.md`.

## Problem
Go code looks free of semicolons, so programmers from C, Java or JavaScript lay it out the way they are used to and meet errors that seem unrelated to what they wrote. A brace on its own line fails with `syntax error: unexpected newline, expected { after if clause` ✅[^1]. A multi-line slice literal without a comma after its last element fails with `syntax error: unexpected newline in composite literal; possibly missing comma or }` ✅[^1]. A long sum broken before the `+` gives `+2 (untyped int constant 2) is not used` ✅[^1]. Literals have their own traps: `0600` is the octal number 384 ✅[^1], `'\"'` is rejected as an `unknown escape` ✅[^1], and a raw string copied from a file with Windows line endings silently loses its `\r` characters ✅[^1] ✅[^2]. Each follows from a lexical rule.

## Mental model
**Analogy:** the scanner is a stenographer who types a speech word by word. At the end of every spoken line she looks only at the last word. If that word could end a sentence (a name, a number, `return`, a closing bracket), she types a full stop; if it could not (a comma, an opening bracket, a `+`), she waits for the next line. She never looks ahead, so a line that ends in `0` gets its full stop even when the speaker meant to go on with `{` on the next line.

**Artifact:** where the scanner puts semicolons in a short fragment, as Go 1.27.4's `go/scanner` reported it (worked example below) ✅[^1]:
```go
x := f(a,      // last token ","  → nothing inserted, the call goes on
	b)         // last token ")"  → ";" inserted
if x > 0       // last token "0"  → ";" inserted: "if x > 0;" has no body
{              // last token "{"  → nothing inserted; this block now stands alone
```

## How it works
Four actors take part; none of them uses the network:
- **The source file** — its job: hold the program as Unicode text, via a UTF-8 encoded `.go` file.
- **The scanner (lexer)** — its job: cut the text into tokens and insert semicolons, via the rules of the specification's *Lexical elements* section (`go/scanner` is the same logic as a library).
- **The parser** — its job: match the tokens against the grammar, via productions that end statements with `;`.
- **`gofmt`** — its job: print the parsed program in the standard layout, via `gofmt` or `go fmt`.

```
 main.go (UTF-8 bytes)
   │  scanner: decode UTF-8 · skip white space and comments · take the longest token
   │           · at each newline: last token can end a statement? → emit ";"
   ▼
 tokens  IDENT x  :=  IDENT f  (  IDENT a  ,  IDENT b  )  ;"\n"  if  IDENT x  >  INT 0  ;"\n"  {  …
   │  parser: statements end with ";" → "if x > 0;" is missing its block → syntax error
   ▼
 syntax tree ──▶ type checker ──▶ code generation
   ▲
 gofmt: parses the same tokens, then prints them back in the standard layout (step 6)
```

1. **Source text (source file → scanner).**
   - Source code is UTF-8 encoded Unicode text and is not canonicalized: a single accented code point and the same character built from a letter plus a combining accent are different ✅[^2].
   - A compiler may reject the NUL character (U+0000, the zero byte) and may ignore a byte order mark (BOM, the code point U+FEFF) at the very start ✅[^2]. Go 1.27.4 reported `invalid NUL character` for a NUL inside a string, compiled a file that starts with a BOM, and reported `invalid BOM in the middle of the file` and `invalid UTF-8 encoding` for a stray BOM and a stray `0xFF` byte ✅[^1].
2. **Tokens (scanner).**
   - A token is one word of the language, such as `x`, `:=` or `"hi"`. There are four classes of tokens: identifiers, keywords, operators and punctuation, and literals. Spaces, tabs, carriage returns and newlines are ignored except where they separate tokens, and a newline or the end of the file may trigger a semicolon ✅[^2].
   - The next token is always the longest sequence of characters that forms a valid token ✅[^2]. So `i+++j` scans as `i`, `++`, `+`, `j`; Go 1.27.4 rejects it with `syntax error: unexpected ++ in argument list; possibly missing comma or )` ✅[^1].
   - An identifier is a letter followed by letters and digits, and `_` counts as a lowercase letter ✅[^2]; `αβ` and `_x9` are valid names ✅[^1].
   - The 25 keywords (`break`, `case`, `chan`, `const`, `continue`, `default`, `defer`, `else`, `fallthrough`, `for`, `func`, `go`, `goto`, `if`, `import`, `interface`, `map`, `package`, `range`, `return`, `select`, `struct`, `switch`, `type`, `var`) are reserved ✅[^2]; `go/token` in Go 1.27.4 lists the same 25 ✅[^1]. `var type = 1` fails with `syntax error: unexpected keyword type, expected name` ✅[^1].
   - The 48 operators and punctuation sequences include `&^` (bit clear, AND NOT), `<-` (channel send and receive), `:=`, `...` and `~` ✅[^2].
   - Names such as `int`, `true`, `nil`, `len` and `any` are *predeclared identifiers*, declared in the universe block (the scope that encloses all Go source text), not keywords ✅[^2], so a local `true := false` compiles ✅[^1].
3. **Comments (scanner).**
   - A line comment runs from `//` to the end of the line; a general comment runs from `/*` to the first following `*/`; a comment cannot start inside a rune literal, a string literal or another comment ✅[^2]. Hence `"// not a comment"` prints as text, and general comments do not nest ✅[^1].
   - A general comment with no newline acts like a space; any other comment acts like a newline ✅[^2]. `return /* a comment` followed by `that spans lines */ 5` therefore ends the `return` statement before the `5`: Go 1.27.4 reports `not enough return values` and `5 (untyped int constant) is not used`, while the same comment on one line returns 5 ✅[^1]. `go/scanner` places that synthesized semicolon right after the comment token ✅[^6].
   - Effective Go calls line comments the norm; block comments appear mostly as package comments, but are useful inside an expression or to disable large stretches of code ✅[^3].
4. **Automatic semicolons (scanner → parser).** The grammar ends many productions with `;`, and Go lets programs omit most of them by two rules ✅[^2]:
   - **Rule 1.** When the input is broken into tokens, a semicolon is inserted right after a line's final token if that token is an identifier; an integer, floating-point, imaginary, rune or string literal; one of the keywords `break`, `continue`, `fallthrough` or `return`; or one of `++`, `--`, `)`, `]`, `}` ✅[^2].
   - **Rule 2.** To let complex statements occupy a single line, a semicolon may be omitted before a closing `)` or `}` ✅[^2]. That is why `import ("fmt"; "strings")`, `var (a = 1; b = 2)` and `go func() { for { dst <- <-src } }()` compile on one line ✅[^1].
   - Effective Go sums rule 1 up: "if the newline comes after a token that could end a statement, insert a semicolon" ✅[^3]. Idiomatic Go has semicolons only in `for` clauses and between several statements on one line ✅[^3].
   - `go/scanner` returns an inserted semicolon with the literal `"\n"` and a typed one with `";"` ✅[^6].
5. **Consequences for layout (parser).**
   - The opening brace of `if`, `for`, `switch` or `select` cannot go on the next line, because a semicolon would be inserted before it ✅[^3]. Go 1.27.4 reports `syntax error: unexpected newline, expected { after if clause` for an `if`, and `syntax error: unexpected semicolon or newline before {` for a `func` ✅[^1].
   - In a composite literal or call that spans lines, the last element is followed by a newline, so it needs a trailing comma: without one, Go 1.27.4 reports `syntax error: unexpected newline in composite literal; possibly missing comma or }` or `syntax error: unexpected newline in argument list; possibly missing comma or )` ✅[^1].
   - A long expression must break after a binary operator or after the `.` of a method chain. `total := 1` then `+ 2` on the next line makes two statements (`+2 (untyped int constant 2) is not used`), and a line that starts with `.Replace(…)` fails with `syntax error: unexpected ., expected }`; with the `+` or `.` at the end of the first line both compile ✅[^1].
   - A bare `return` at the end of a line returns nothing: `return` then `x + 1` on the next line gives `not enough return values` and `x + 1 (value of type int) is not used` ✅[^1].
6. **`gofmt` (after parsing).**
   - `gofmt` prints a Go program in a standard style, using tabs for indentation and blanks for alignment ✅[^3] ✅[^5]; Effective Go's advice is to let it decide layout questions ✅[^3]. Its flags (`-l`, `-d`, `-w`) and its place next to `go vet` are in `go/introduction/toolchain-and-compatibility.md`.
   - On Go 1.27.4, `gofmt` split `a := 0B1010; b := 0XabcDEF` onto separate lines, dropped the stray `;` after a call, expanded `import ("fmt"; "strings")` into a block, and left `func main() { fmt.Println(…) }` on one line ✅[^1].
   - Since Go 1.13, `gofmt` rewrites number prefixes and exponents to lower case but leaves hexadecimal digits alone, and drops leading zeros from integer imaginary literals: `0B1010`, `0XabcDEF`, `0O660`, `1.2E3` and `01i` become `0b1010`, `0xabcDEF`, `0o660`, `1.2e3` and `1i` ✅[^4]; Go 1.27.4 did exactly that ✅[^1].
   - `gofmt` cannot repair a misplaced brace or a missing comma: it must parse the file first, so it stops with a syntax error and exit status 2 ✅[^1].
7. **Integer literals (scanner).**
   - An optional prefix sets the base: `0b`/`0B` binary, `0`, `0o` or `0O` octal, `0x`/`0X` hexadecimal; a lone `0` is decimal zero ✅[^2]. The `0b` and `0o` prefixes and digit separators need language version Go 1.13 ✅[^2] ✅[^4], and the old leading-`0` octal form stays valid ✅[^4]. `0600`, `0_600`, `0o600` and `0O600` all printed 384 ✅[^1].
   - An underscore may appear after a base prefix or between two digits and does not change the value ✅[^2]: `1_000_000` is one million, `0xBad_Face` is 195951310 ✅[^1]. `_42` is an identifier, not a number ✅[^2].
   - A module whose `go.mod` says `go 1.12` gets `binary literal requires go1.13 or later (-lang was set to go1.12; check go.mod)` and `underscore in numeric literal requires go1.13 or later` ✅[^1].
8. **Floating-point and imaginary literals (scanner).**
   - A decimal float has an integer part, a decimal point, a fractional part and an exponent (`e` or `E`); one of the two parts and one of the point or the exponent may be left out ✅[^2]. `.25`, `1E6`, `1_5.` (15) and `072.40` (72.4, not octal) are valid ✅[^2] ✅[^1].
   - A hexadecimal float (Go 1.13) has a `0x` mantissa (the digits before the exponent) and a required `p` exponent that scales by a power of two ✅[^2] ✅[^4]: `0x1p-2` is 0.25, `0x2.p10` is 2048, `0x1.Fp+0` is 1.9375 ✅[^1]. `0x15e-2` is not a float at all but the integer subtraction `0x15e - 2`, which is 348 ✅[^2] ✅[^1].
   - An imaginary literal is an integer or float literal followed by `i` ✅[^2], in any base since Go 1.13 ✅[^4]. For backward compatibility an integer part made only of decimal digits is decimal even with a leading zero ✅[^2]: `0123i` is `123i`, `0o123i` is `83i` and `0xabci` is `2748i` ✅[^1].
   - Untyped, `42`, `1.5`, `2i` and `'x'` printed the types `int`, `float64`, `complex128` and `int32` (`rune`) ✅[^1]; why is covered in `go/fundamentals/declarations-types-and-constants.md`.
9. **Rune literals (scanner).**
   - A rune literal is one character, or one escape, between single quotes; any character may appear except a newline and an unescaped `'` ✅[^2]. `'ä'` is two bytes in the source (`0xc3 0xa4`) but its value is 0xe4 ✅[^2], printed as 228 ✅[^1].
   - Four numeric escapes exist: `\x` plus exactly two hex digits, `\u` plus four, `\U` plus eight, and `\` plus exactly three octal digits. Octal escapes must stay within 0–255, and `\u`/`\U` must name a valid code point: nothing above 0x10FFFF and no surrogate halves ✅[^2]. On Go 1.27.4 `'\uD7FF'` and `'\uE000'` compiled while `'\uD800'` and `'\uDFFF'` did not, so the rejected block runs from U+D800 to U+DFFF ✅[^1].
   - The named escapes are `\a` (7), `\b` (8), `\f` (12), `\n` (10), `\r` (13), `\t` (9), `\v` (11) and `\\` (92); `\'` is valid only in rune literals and `\"` only in string literals; any other character after a backslash is illegal ✅[^2]. The values printed in the lab match ✅[^1].
10. **String literals (scanner).**
    - A *raw* string sits between backquotes and may contain any character except a backquote; backslashes have no special meaning, newlines are allowed, and carriage returns are discarded from the value ✅[^2]. A raw string made of `\n`, a line break and `\n` equals the interpreted `"\\n\n\\n"` and has length 5 ✅[^1]. In a file saved with CRLF (carriage return plus line feed) line endings, a raw string spanning a line break came out as `"a\nb"` (3 bytes), while the interpreted `"a\r\nb"` kept its `\r` ✅[^1].
    - An *interpreted* string sits between double quotes, may not contain a newline, and interprets the same escapes as rune literals, with `\"` legal and `\'` illegal ✅[^2]. A newline inside one gives `newline in string` ✅[^1].
    - In an interpreted string, `\nnn` and `\xnn` put single bytes into the string; every other escape puts the UTF-8 encoding of a character ✅[^2]. `"\xff\u00FF"` holds the bytes `ff c3 bf`, and `"日本語"`, `` `日本語` ``, `"\u65e5\u672c\u8a9e"`, `"\U000065e5\U0000672c\U00008a9e"` and the nine explicit UTF-8 bytes all compared equal ✅[^2] ✅[^1].
    - A character written as two code points (letter plus combining accent) is an error in a rune literal and two code points in a string literal ✅[^2]: `'é'` built that way gave `more than one character in rune literal`, and the string version had `len` 3 and runes `[101 769]` ✅[^1]. What you can do with such a string afterwards is in `go/data-types/strings-bytes-and-runes.md`.

## Worked example
Diagnose a brace placed C-style, end to end. The program `brace-if.go`:
```go
package main

func main() {
	x := 1
	if x > 0
	{
		println(x)
	}
}
```

| Step | Action | Observed on Go 1.27.4 ✅[^1] |
|---|---|---|
| 1 | `go run brace-if.go` | `./brace-if.go:5:10: syntax error: unexpected newline, expected { after if clause` |
| 2 | `gofmt brace-if.go` | `brace-if.go:5:10: unexpected newline, expecting { after if clause`, exit status 2: no formatting happens |
| 3 | Feed the same shape to `go/scanner` (`x := f(a,` / `b)` / `if x > 0` / `{` / `return /* one` / `line */ x` / `}`) and print each token | see the trace below |
| 4 | Move `{` to the end of line 5 and run again | prints `1` |

The trace from step 3 (position, token, literal; 13 of the 22 lines shown):
```console
1:9	,	""          ← line 1 ends in ",": nothing inserted
2:3	)	""
2:4	;	"\n"        ← inserted after ")"
3:8	INT	"0"
3:9	;	"\n"        ← inserted after "0": the if statement ends here
4:1	{	""          ← a block on its own, so the parser expects "{" after "if x > 0"
5:2	return	"return"
5:9	COMMENT	"/* one\nline */"
5:15	;	"\n"        ← the comment contains a newline, so it acts like one
6:9	IDENT	"x"
6:10	;	"\n"
7:1	}	""
7:2	;	"\n"        ← inserted after "}"
```
The scanner never looked ahead: the newline after `0` was enough. Only the layout changes in step 4; the tokens `if x > 0 {` then reach the parser without a semicolon in between.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `'\"'` in a rune, `"\'"` in a string | Both fail with `unknown escape` ✅[^1] | `\"` is valid only in strings, `\'` only in runes ✅[^2] |
| `'\xa'`, `'\0'` | `invalid character '\'' in hexadecimal escape`, `invalid character '\'' in octal escape` ✅[^1] | `\x` needs exactly two hex digits, octal exactly three ✅[^2] |
| `'\400'` | `octal escape value 256 > 255` ✅[^1] | Octal escapes must be 0–255 ✅[^2] |
| `'\uDFFF'`, `"\uD800"`, `'\U00110000'` | `escape is invalid Unicode code point U+DFFF` (and `U+D800`, `U+110000`) ✅[^1] | Surrogate halves and values above 0x10FFFF are not code points ✅[^2] |
| `'aa'`, `'\k'` | `more than one character in rune literal`, `unknown escape` ✅[^1] | One character per rune literal; `k` is not an escape ✅[^2] |
| `42_`, `4__2`, `1_.5`, `1.5e_1` | `'_' must separate successive digits` ✅[^1] | One `_` at a time, only between digits or after a prefix ✅[^2] |
| `08`, `0b102` | `invalid digit '8' in octal literal`, `invalid digit '2' in binary literal` ✅[^1] | A leading `0` makes the literal octal ✅[^2] |
| `1p-2`, `0x1.5e-2`, `0x.p1` | `'p' exponent requires hexadecimal mantissa`, `hexadecimal mantissa requires a 'p' exponent`, `hexadecimal literal has no digits` ✅[^1] | A `p` exponent and a hex mantissa go together ✅[^2] |
| `/* outer /* inner */ still outer? */` | The comment ends at the first `*/`; the rest is code: `invalid character U+003F '?'` ✅[^1] | A comment cannot start inside a comment ✅[^2] |
| Missing trailing comma, checked by `gofmt` instead of the compiler | `missing ',' before newline in composite literal` ✅[^1] | The two tools word the same syntax error differently; both refuse the file ✅[^1] |
| A BOM in the middle of a file | `invalid BOM in the middle of the file` ✅[^1] | A BOM may be disallowed anywhere but the start ✅[^2] |

## Takeaways
- Keep the opening brace on the same line as `if`, `for`, `switch`, `select` and `func`. [rule-candidate]
- End every line of a multi-line composite literal, call or parameter list with a comma, the last one included. [rule-candidate]
- Break long expressions after a binary operator or after the `.` of a method chain, never before it. [rule-candidate]
- Write octal numbers as `0o600`; a bare leading zero (`0600`) is easy to misread as decimal. [rule-candidate]
- Use raw strings for regular expressions and multi-line text, but remember that they cannot hold a backquote and lose every `\r`.
- Let `gofmt` settle layout; it formats only code that already parses.

## Verification status
- Verified: 109 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24: the `go/scanner` token trace, the brace, comma, operator, method-chain and `return` layouts, comments spanning lines, NUL/BOM/invalid UTF-8 files, every valid and illegal literal listed, a CRLF file with a raw string, `gofmt` on messy and broken files, and a `go 1.12` module. [^1]
- [The Go Programming Language Specification](https://go.dev/ref/spec) — Go team, living. Rank 1. Backs: §Source code representation, §Lexical elements (Comments, Tokens, Semicolons, Identifiers, Keywords, Operators and punctuation, Integer, Floating-point, Imaginary, Rune and String literals), §Predeclared identifiers, §Language versions (Go 1.13). [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Formatting (`gofmt`), §Commentary, §Semicolons (the summary of the rule, where semicolons remain, the brace consequence). [^3]
- [Go 1.13 Release Notes](https://go.dev/doc/go1.13) — Go team, 2019. Rank 1. Backs: binary and `0o` octal prefixes, legacy octal still valid, hexadecimal floats, imaginary suffix on any literal, digit separators, `gofmt` canonicalizing prefixes, exponents and imaginary literals. [^4]
- [gofmt command](https://pkg.go.dev/cmd/gofmt) — Go team, living. Rank 1. Backs: tabs for indentation and blanks for alignment. [^5]
- [go/scanner package](https://pkg.go.dev/go/scanner) — Go team, living. Rank 1. Backs: `Scan` returns `";"` or `"\n"` for typed and inserted semicolons; the semicolon synthesized after a comment that contains a newline. [^6]

## Related
- `go/data-types/strings-bytes-and-runes.md` — strings and runes at run time: bytes, `len`, `range`, conversions, the four text packages.
- `go/fundamentals/declarations-types-and-constants.md` — untyped constants and the default types of literals.
- `go/fundamentals/control-flow-and-functions.md` — the `if`, `for` and `switch` statements whose braces this doc places.
- `go/introduction/toolchain-and-compatibility.md` — `gofmt`, `go fmt` and the `go` line that sets the language version.
- `go/standard-library/fmt-and-printing.md` — how `%q`, `%x` and `%U` print the literals shown here.
- `go/learning-path.md`
