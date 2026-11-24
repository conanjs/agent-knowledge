---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "Append, Appendf, Appendln: Go ≥ 1.19", "maps printed in key order: Go ≥ 1.12", "vet non-constant format check: language version Go ≥ 1.24"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, fmt, printf, sprintf, println, verbs, stringer, gostringer, formatter, errorf, scanf, go-vet, printf-check]
ranked-sources: true
---

# Formatted printing with fmt

## Summary
**TL;DR:** `fmt` prints in four families named by destination: `Print*` to standard output, `Sprint*` to a returned string, `Fprint*` to any `io.Writer`, and `Append*` (Go 1.19) to a byte slice. The suffix decides the layout: no suffix uses default formats and puts spaces only between two non-string operands, `ln` always puts spaces and a newline, `f` follows a format string of *verbs* such as `%v`, `%d`, `%s` and `%q`. `%v` prints any value (structs as `{…}`, maps with sorted keys), `%+v` adds field names, `%#v` prints Go syntax and `%T` the type. Before laying out an operand, `fmt` checks its methods in a fixed order (`Format`, then `GoString` for `%#v`, then `Error`, then `String`), and a `String` method that formats its own receiver with `%s` or `%v` recurses until the stack overflows. Mistakes never panic: they appear in the output as `%!d(string=hi)`, `%!d(MISSING)` or `%!(EXTRA …)`, and `go vet`'s `printf` check catches most of them before the program runs.
**Use this when:** you pick a print function or a verb, line up columns with width and precision, give a type a `String` method, see `%!` text or a stack overflow in output, or read a `go vet` report about a format string.
**Not this doc:** wrapping errors with `%w`, `errors.Is` and `errors.As` → `go/errors/errors-and-wrapping.md`; `Stringer` as an interface and type switches → `go/methods-interfaces/interfaces.md`; logging → `go/standard-library/log-and-slog.md`; reading text streams → `go/standard-library/io-and-encoding-json.md`; how literals are written in source → `go/fundamentals/lexical-elements-and-semicolons.md`.

## Problem
Printing looks too simple to get wrong, yet its mistakes are quiet. `fmt.Println("total: %d", 3)` prints `total: %d 3` ✅[^1]. `fmt.Printf("%d", "hi")` prints `%!d(string=hi)` and carries on ✅[^1] ✅[^2]. A one-line `String` method, `return fmt.Sprintf("MyString=%s", m)`, crashes the program with `fatal error: stack overflow` ✅[^1]. `%x` on a type with a `String` method hex-encodes the string it returns instead of the number ✅[^1], and a pointer stored in a struct field prints as an address rather than its contents ✅[^1]. Each follows from a documented rule about families, verbs or the method checks.

## Mental model
**Analogy:** `fmt` is a print shop working from a job ticket. The format string is the ticket: plain text is copied as it is, and each `%` slot, called a *directive*, says how to lay out the next item (flags, width, precision, verb). Before using its house layout, the shop asks the item whether it brings its own printing plate (`Format`), a Go-syntax plate for `%#v` (`GoString`) or a ready-made label (`Error`, `String`). A slot with no item, or an item with no slot, gets a stamped note in the output instead of a refused job.

**Artifact:** two directives taken apart, run on Go 1.27.4 ✅[^1]:
```go
fmt.Printf("[%-8.3s][%+08.2f]\n", "gopher", math.Pi) // [gop     ][+0003.14]
// %-8.3s : "-" pad on the right · "8" at least 8 runes wide · ".3" use at most 3 runes of input · "s" plain string
// %+08.2f: "+" always a sign · "0" pad with zeros after the sign · "8" width · ".2" two decimals · "f" decimal float
```

## How it works
Four actors take part in every call; all of them run in your process:
- **Your call** — its job: choose the destination and the layout, via the function name (`Print`, `Sprint`, `Fprint`, `Append` plus nothing, `ln` or `f`) and the format string.
- **The `fmt` printer** — its job: walk the format string and lay out each operand, via the rules of the package documentation (the `pp` type in `fmt/print.go`).
- **The operand** — its job: supply its own text if it wants to, via a `Format`, `GoString`, `Error` or `String` method.
- **The destination** — its job: receive the bytes, via `os.Stdout`, an `io.Writer`, a returned `string` or a returned `[]byte`.

```
 fmt.Fprintf(w, "%-10s|%v\n", name, ip)                         [your call]
   │
   ▼ printer: "%-10s" → flag "-", width 10, verb 's' → takes the next operand
   │   for each operand, unless the verb is %T or %p:
   │     a reflect.Value?               → use the value it holds, go on
   │     has Format?                    → Format(state, verb), done
   │     verb %#v and has GoString?     → GoString(), done
   │     verb v, s, q, x or X (not %#v):
   │        has Error?  → Error()  → lay out that string, done
   │        has String? → String() → lay out that string, done
   │     else the default layout for its kind: {…}, […], map[k:v] in key order, &{…}
   ▼
 bytes ──▶ os.Stdout (Print*) · w io.Writer (Fprint*) · string (Sprint*) · []byte (Append*)
```

1. **Families and spacing (your call → destination).**
   - `Print`, `Println`, `Printf` write to `os.Stdout`; `Sprint*` return a string; `Fprint*` write to an `io.Writer`; `Append`, `Appendln`, `Appendf` append to a byte slice ✅[^2]. The `Append` family was added in Go 1.19 ✅[^2].
   - The plain forms use default formats and add a space between operands only when neither is a string; the `ln` forms always add spaces and a final newline; the `f` forms follow the verbs ✅[^2] ✅[^3]. `fmt.Print(1, 2, "a", 3, "b", "c", 4.5, true, "\n")` printed `1 2a3bc4.5 true`, `Sprint("x", 1, 2, "y")` returned `"x1 2y"`, and `Sprintln` with the same operands returned `"x 1 2 y\n"` ✅[^1].
   - The writing functions return the number of bytes written and any write error ✅[^2]; `Fprintf(&buf, "%s=%d", "k", 42)` returned `4 <nil>` ✅[^1]. The package's own examples call ignoring the error from `Printf` conventional ✅[^2].
2. **General verbs and the default layout (printer).**
   - `%v` is the default format, `%+v` adds field names to structs, `%#v` is Go syntax, `%T` the type in Go syntax, and `%%` prints a percent sign without using an operand ✅[^2].
   - The defaults per kind: `bool` as `%t`, integers as `%d` (unsigned ones as `%#x` under `%#v`), floats and complex numbers as `%g`, strings as `%s`, channels and pointers as `%p`; structs as `{field0 field1 …}`, arrays and slices as `[elem0 elem1 …]`, maps as `map[key:value …]`, and a pointer to one of these as `&{}`, `&[]` or `&map[]` ✅[^2].
   - Effective Go's struct `T{7, -2.35, "abc\tdef"}` behind a pointer printed `&{7 -2.35 abc	def}` with `%v`, `&{a:7 b:-2.35 c:abc	def}` with `%+v`, `&main.T{a:7, b:-2.35, c:"abc\tdef"}` with `%#v` and `*main.T` with `%T` ✅[^3] ✅[^1].
   - The `&{…}` form applies only at the top level: deeper pointers print as addresses to avoid loops ✅[^4]. A linked `Node{"a", &Node{"b", nil}}` printed `&{a 0x5e214ceac048}` ✅[^1].
   - Maps print sorted by key since Go 1.12 ✅[^5] ✅[^3]: `map[CST:-21600 EST:-18000 PST:-28800 UTC:0]` and, for `int` keys, `map[-1:minus 2:two 10:ten]` ✅[^1].
   - For slices, arrays and structs the verb applies to each element ✅[^2]: `%q` on `[]string{"x", "y"}` gave `["x" "y"]`, `%6.2f` on `[]float64{1, 2.5}` gave `[  1.00   2.50]` ✅[^1]. A byte slice with `%s`, `%q`, `%x` or `%X` is treated as one string ✅[^2].
   - An interface operand is printed by its concrete value ✅[^2]: `var i any = 23` gave `23` and `int` ✅[^1].
   - Nil values on Go 1.27.4: `nil`, a nil `*int`, a nil `error` and a nil channel printed `<nil>`, a nil slice `[]` and a nil map `map[]`; under `%#v` they became `(*int)(nil)`, `[]int(nil)` and `map[string]int(nil)` ✅[^1]. The printer writes `<nil>` for a nil operand under `%v` and `%T` and reports any other verb as an error ✅[^4], so `%d` of `nil` gave `%!d(<nil>)` ✅[^1].
3. **Verbs by type (printer).** Values below are for `x := 42`, `f := 12.345`, `s := "héllo"`, run on Go 1.27.4 ✅[^1]; the verb meanings are from the package documentation ✅[^2].

   | Type | Verbs | Output |
   |---|---|---|
   | Boolean | `%t` | `true` |
   | Integer | `%b %o %O %d %x %X` | `101010 52 0o52 42 2a 2A` |
   | Integer as a character | `%c %q %U %#U` | `* '*' U+002A U+002A '*'` |
   | Float | `%e %f %.2f %g %.3g %x %b` | `1.234500e+01 12.345000 12.35 12.345 12.3 0x1.8b0a3d70a3d71p+03 6949617174986097p-49` |
   | Complex `1.2+3.4i` | `%v %f` | `(1.2+3.4i) (1.200000+3.400000i)` |
   | String | `%s %q %x % x` | `héllo "héllo" 68c3a96c6c6f 68 c3 a9 6c 6c 6f` |
   | `[]byte("a⌘")` | `%v %s %x` | `[97 226 140 152] a⌘ 61e28c98` |
   | Pointer | `%p` of `(*int)(nil)` | `0x0` |

   - Numeric verbs take no size or sign flags; the operand's type decides ✅[^3]: for `uint64(1<<64 - 1)`, `%d %x` gave `18446744073709551615 ffffffffffffffff`, and for the same bits as `int64`, `-1 -1` ✅[^1].
   - `%e`, `%f` and `%#g` default to 6 digits of precision; `%g` uses the fewest digits that identify the value ✅[^2]. `%q` on an invalid code point prints the replacement character ✅[^2]: `%q` of `0x110000` gave `'�'` ✅[^1].
4. **Width, precision, flags, `*` and `[n]` (printer).**
   - Width is a decimal number right before the verb; precision follows a period, and a period alone means precision 0 ✅[^2]. Both count runes, not bytes ✅[^2]: `%8s` padded `"héllo"` (6 bytes, 5 runes) with three spaces ✅[^1].
   - For strings and byte slices precision limits the *input*, in runes, except under `%x`/`%X`, where it counts bytes ✅[^2]: `%.3s` gave `hél`, `%.2x` gave `68c3` ✅[^1]. For floats precision is the number of decimals, but for `%g` the maximum number of significant digits ✅[^2].
   - Flags ✅[^2]: `+` always prints a sign (and, for `%+q`, output limited to ASCII, the 7-bit American Standard Code for Information Interchange); `-` pads on the right; `#` selects an alternate form (`0b`, `0`, `0x` prefixes, no `0x` for `%#p`, a backquoted string for `%#q` when possible, trailing zeros kept for `%#g`, `U+0078 'x'` for `%#U`); a space leaves room for a sign and separates hex bytes; `0` pads with zeros after the sign. `%+d|% d|% d|%5d|%-5d|%05d|%+05d` on 7, 7, -7, 7, 7, 7, 7 gave `+7| 7|-7|    7|7    |00007|+0007`, `%#g` of 100 gave `100.000`, `%#q` gave `` `say "hi"` `` and `%+q` of `"héllo"` gave `"h\u00e9llo"` ✅[^1].
   - Flags a verb does not expect are ignored, so `%#d` equals `%d` ✅[^2] ✅[^1].
   - `*` takes the width or precision from the next operand, which must be an `int` ✅[^2]: `[%*d]`, `[%-*d]` and `[%.*f]` gave `[   42]`, `[42   ]` and `[3.14]` ✅[^1].
   - `[n]` before a verb or a `*` picks the n-th operand, counting from 1, and later verbs continue with n+1 ✅[^2]: `%[2]d %[1]d` gave `22 11`, `%[3]*.[2]*[1]f` gave ` 12.00`, `%d %d %#[1]x %#x` gave `16 17 0x10 0x11` ✅[^2] ✅[^1].
5. **The methods `fmt` looks for (printer → operand).**
   - Except under `%T` and `%p`, in this order: a `reflect.Value` is replaced by the value it holds; a `Formatter` is called and controls every verb and flag; with `%#v` a `GoStringer` is called; then, for `%v` (not `%#v`) and the string verbs `%s %q %x %X`, an `error`'s `Error` method and otherwise a `Stringer`'s `String` method produce a string that is then formatted ✅[^2]. `fmt/print.go` at go1.27.4 checks them in this order ✅[^4].
   - A `Level` type with `String`, `Error` and `GoString` printed `Error()` for `%v` and `%s`, `"Error()"` for `%q`, `4572726f722829` (the hex of `Error()`) for `%x`, `GoString()` for `%#v`, `3` for `%d` and `main.Level` for `%T` ✅[^1].
   - A `Formatter` received the verb, width and flags: for `%+8.2f` it saw `verb=f width=8 plus=true`, and `fmt.FormatString` (Go 1.20) rebuilt `%+8.2f` ✅[^2] ✅[^1].
   - A non-string verb skips `String`: a `Count` integer type printed `Count(3)` with `%v` and `%s` but `3` with `%d` ✅[^1]. Effective Go relies on this: a `String` method that calls `Sprintf` with `%f` on its receiver is safe because `%f` wants a number ✅[^3]; a `ByteSize` type built that way printed `ByteSize(2048)` as `2.00KB` ✅[^1].
   - Method sets matter: with `String` on `*PtrOnly`, the value printed `{7}` and its address printed `PtrOnly(7)` ✅[^1]; Effective Go advises a value receiver when both `T` and `*T` are printed ✅[^3].
   - `fmt` does not call `Error` or `String` on unexported struct fields ✅[^2]: `struct{ d, D time.Duration }` holding one second printed `{1000000000 1s}` ✅[^1].
   - A panic inside these methods is recovered and written into the output, and a panic caused by a nil receiver prints just `<nil>` ✅[^2]. A nil `*NilSafe` whose `String` dereferences its receiver printed `<nil>` ✅[^1].
   - A Tour of Go calls `Stringer` one of the most ubiquitous interfaces: a type that can describe itself as a string ✅[^9]. Its interface side is in `go/methods-interfaces/interfaces.md`.
6. **The recursion trap (operand → printer → operand …).**
   - A `String` method must not hand its own receiver to `Sprintf` with a verb that wants a string: `func (m MyString) String() string { return fmt.Sprintf("MyString=%s", m) }` calls itself forever; convert first, `string(m)`, because the basic type has no `String` method ✅[^3] ✅[^2]. Self-referential data, such as a slice that contains itself, can recurse too when its type has a `String` method, and `fmt` does not guard against it ✅[^2].
   - On Go 1.27.4 the broken version died with `runtime: goroutine stack exceeds 1000000000-byte limit` and `fatal error: stack overflow`; `go vet` reported `fmt.Sprintf format %s with arg m causes recursive (command-line-arguments.MyString).String method call` and exited 1; the fixed version printed `MyString=hi` ✅[^1].
7. **Format errors (printer → output).** Every error starts with `%!`, often followed by the verb, and ends in a description in parentheses ✅[^2]:

   | Mistake | Output on Go 1.27.4 ✅[^1] |
   |---|---|
   | Wrong type, `Sprintf("%d", "hi")` | `%!d(string=hi)` |
   | Too many operands, `Sprintf("hi", "guys")` | `hi%!(EXTRA string=guys)` |
   | Too few, `Sprintf("hi%d")` | `hi%!d(MISSING)` |
   | Non-`int` width or precision, `"%*s"` / `"%.*s"` with `4.5` | `%!(BADWIDTH)hi` / `%!(BADPREC)hi` |
   | Bad index, `Sprintf("%*[2]d", 7)` | `%!d(BADINDEX)` |
   | Unknown verb `%z` | `%!z(int=1)` |
   | A `%` at the end of the format | `100%!(NOVERB)` |
   | `%w` outside `Errorf` | `%!w(*errors.errorString=&{boom})` |
   | `String` panics with `"bad"`, verb `%s` | `%!s(PANIC=String method: bad)` |

8. **`fmt.Errorf` and `%w`.** `Errorf` formats like `Sprintf` and returns an `error`; with one `%w` operand the error's `Unwrap` returns that operand, with several `%w` it returns all of them as `[]error`, a non-error `%w` operand is invalid, and otherwise `%w` acts like `%v` ✅[^2]. `fmt.Errorf("load: %w", errors.New("boom"))` printed `load: boom`, and `errors.Unwrap` gave back `boom` ✅[^1]. When to wrap and how callers test wrapped errors is in `go/errors/errors-and-wrapping.md`.
9. **Scanning, briefly.**
   - `Scan`, `Scanf`, `Scanln` read standard input; `Fscan*` read an `io.Reader`; `Sscan*` read a string. The plain forms treat newlines as spaces, the `ln` forms stop at a newline and need a newline or end of input after the last item, and the `f` forms follow a format string ✅[^2].
   - Every argument must be a pointer to a basic type or implement `Scanner`; the functions return how many items they stored, and an error when that is fewer than the arguments ✅[^2]. Integer prefixes (`0b`, `0o`, `0x`) and `_` separators are accepted without a format or with `%v` ✅[^2].
   - On Go 1.27.4: `Sscan("5 true\ngophers", &i, &b, &s)` stored 3 items, `Sscanln` on the same input stopped at 2 with `unexpected newline`, `Sscan("0x1F 0b101 1_000", …)` gave `31 5 1000`, `Sscanf(" 1234567 ", "%5s%d", …)` gave `12345` and `67`, and `Sscan("abc", &i)` gave `0 expected integer` ✅[^1].
   - `Fscan` can read one rune past what it returns; wrap a reader that lacks `UnreadRune` in `bufio.NewReader` before scanning it in a loop ✅[^2].
10. **`go vet`'s `printf` check (before run time).**
    - `vet` reports suspicious constructs such as `Printf` calls whose arguments do not match the format; its heuristics make it guidance, not proof ✅[^7]. The `printf` analyzer covers `fmt.Printf`, `fmt.Sprintf` and functions it detects as wrappers of them, such as `log.Printf` ✅[^6].
    - Its reports on Go 1.27.4, for a module with `go 1.27.4` ✅[^1]:
      ```console
      main.go:17:14: fmt.Printf format %d has arg "hello" of wrong type string
      main.go:18:14: fmt.Printf format %d reads arg #1, but call has 0 args
      main.go:19:2: fmt.Printf call needs 1 arg but has 2 args
      main.go:20:14: fmt.Printf format %[3]d reads arg #3, but call has 2 args
      main.go:21:2: fmt.Println call has possible Printf formatting directive %d
      main.go:22:13: non-constant format string in call to fmt.Printf
      main.go:23:28: lab.logf format %v reads arg #1, but call has 0 args
      main.go:24:14: fmt.Printf format %z has unknown verb z
      main.go:25:24: fmt.Errorf format %w has arg "not an error" of wrong type string
      ```
      Line 23 calls `logf`, a local function that passes its arguments to `log.Printf`, so the analyzer treated it as a wrapper ✅[^6] ✅[^1].
    - The non-constant format string report (`fmt.Printf(s)` with no other operands) exists since Go 1.24 and applies only to files whose language version is at least 1.24 ✅[^8]. Go 1.27 adds a report for `%w` with a pointer to an error type; see `go/errors/errors-and-wrapping.md` ✅[^6].
    - `go test` runs `printf` among its vet checks: on the same package it printed the same nine reports, then `FAIL lab [build failed]` (tab-separated), and exited 1 ✅[^1]. Which analyzers `go test` runs is in `go/tooling/go-command-and-build-reference.md`.

## Worked example
A Tour of Go's *Exercise: Stringers* asks for an `IPAddr` type that prints as a dotted quad ✅[^9]. Here it is, printed four ways, as run on Go 1.27.4 ✅[^1]:

```go
type IPAddr [4]byte

func (ip IPAddr) String() string {
	return fmt.Sprintf("%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3])
}

func main() {
	hosts := map[string]IPAddr{
		"loopback": {127, 0, 0, 1},
		"dns":      {8, 8, 8, 8},
	}
	// 1. Default formats: String is called for each map value; keys come out sorted.
	fmt.Println(hosts)
	// 2. A fixed-width table: %-10s left-justifies, %15v right-justifies the String result.
	for _, name := range slices.Sorted(maps.Keys(hosts)) {
		fmt.Fprintf(os.Stdout, "%-10s|%15v|\n", name, hosts[name])
	}
	ip := hosts["loopback"]
	// 3. %d is not a string verb: String is skipped. %x is one: String runs first.
	fmt.Printf("%d %x %#v\n", ip, ip, ip)
	// 4. %q quotes the String result; %T names the type.
	fmt.Printf("%q %T\n", ip, ip)
}
```

| Step | Call | Output | Rule |
|---|---|---|---|
| 1 | `Println(hosts)` | `map[dns:8.8.8.8 loopback:127.0.0.1]` | `%v` calls `String` on each element; map keys sorted |
| 2 | `Fprintf("%-10s\|%15v\|\n", …)` | `dns       \|        8.8.8.8\|` and `loopback  \|      127.0.0.1\|` | Width pads the string that `String` returned |
| 3 | `%d %x %#v` | `[127 0 0 1] 3132372e302e302e31 main.IPAddr{0x7f, 0x0, 0x0, 0x1}` | `%d` formats each byte; `%x` hex-encodes `"127.0.0.1"`; `%#v` has no `GoString`, so Go syntax with bytes as `%#x` |
| 4 | `%q %T` | `"127.0.0.1" main.IPAddr` | `%q` is a string verb; `%T` bypasses methods |

Step 3 is the surprise: to get the address itself in hex, convert away the method first; `%x` on `[4]byte(ip)` printed `7f000001` ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `fmt.Println("total: %d", 3)` | Prints `total: %d 3`; `go vet` flags a possible formatting directive ✅[^1] | Only the `f` functions read verbs ✅[^2] |
| `fmt.Printf(msg)` where `msg` holds `"100%"` | Prints `100%!(NOVERB)` ✅[^1] | The text is read as a format; use `Print(msg)` or `Printf("%s", msg)` ✅[^6] |
| `%x` or `%q` on a type with `String` | Formats the returned string, not the number ✅[^1] | Both are string verbs ✅[^2] |
| `String` declared on `*T`, a `T` value printed | `String` is not called: `{7}` ✅[^1] | A `T` value does not have `*T`'s methods ✅[^3] |
| Pointer inside a struct | Printed as an address, `&{a 0x5e214ceac048}` ✅[^1] | `&{…}` only at the top level ✅[^4] |
| Explicit index skips an operand: `"[%+09.3[2]f]"` with `0, math.Pi` | `[+0003.142]`, no `EXTRA` note ✅[^1] | Observed on Go 1.27.4; the docs only describe `[n]` selection ✅[^2] |
| A `String` method panics with `"bad"` | Go 1.27.4 prints `%!s(PANIC=String method: bad)`, while the package doc's example shows `%!s(PANIC=bad)` ✅[^1] ✅[^2] | `fmt/print.go` at go1.27.4 writes the method name into the note ✅[^4] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `Print` / `Println` | No format string to get wrong | Fixed spacing rules; no width or precision ✅[^2] |
| `Printf` family | Full control of layout ✅[^2] | Mistakes become `%!` text at run time; rely on `go vet` ✅[^6] |
| A `String` method | Every print site, `%v`, `%s` and `%q` included, uses it ✅[^2] | `%x` uses it too; the recursion trap ✅[^3] |
| A `Format` method | Controls every verb, flag, width and precision ✅[^2] | You must handle each verb yourself |

## Takeaways
- Never pass a variable as the format string: write `Print(msg)` or `Printf("%s", msg)`. [rule-candidate]
- In a `String` method, convert the receiver to its underlying type (`string(m)`, `int(c)`) before formatting it with `%v` or `%s`. [rule-candidate]
- Declare `String` on the value receiver when both `T` and `*T` values get printed. [rule-candidate]
- Run `go vet` on every package: it catches wrong verbs, missing and extra operands, wrapper misuse and the `String` recursion. [rule-candidate]
- Debug with `%+v` (field names), `%#v` (Go syntax), `%T` (type) and `%q` (hidden characters made visible).
- Use `%w` only in `fmt.Errorf`; elsewhere it prints a `%!w(…)` note.

## Verification status
- Verified: 114 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24: the four families and their spacing, every verb, width, flag and index example, nil values, the method-order types (`Level`, `Temp`, `Count`, `PtrOnly`, `Panicky`, `NilSafe`), the `String` recursion with and without the fix, the format-error notes, `Errorf` with `%w`, the `Sscan*` calls, the `go vet` and `go test` runs, and the `IPAddr` worked example. [^1]
- [fmt package](https://pkg.go.dev/fmt) — Go team, living (go1.27.4). Rank 1. Backs: §Printing (families, verbs, defaults, width, precision, flags, interface order, unexported fields, recursion), §Explicit argument indexes, §Format errors, §Scanning, `Append*` (Go 1.19), `Errorf` and `%w`, `FormatString` (Go 1.20), `Formatter`, `GoStringer`, `Stringer`, the package examples. [^2]
- [Effective Go](https://go.dev/doc/effective_go) — Go team, living. Rank 1. Backs: §Printing (Print versus Println spacing, `io.Writer`, numeric verbs without size flags, `%v`/`%+v`/`%#v`/`%T`, sorted maps, `String` methods, the recursion trap and its fix, value receivers), §Initialization (the `%f` `String` that does not recurse). [^3]
- [fmt/print.go at go1.27.4](https://github.com/golang/go/blob/go1.27.4/src/fmt/print.go) — Go team, 2026. Rank 1. Backs: `handleMethods` order, the `PANIC=… method:` note, `<nil>` for nil operands, `&` only at depth 0. [^4]
- [Go 1.12 Release Notes](https://go.dev/doc/go1.12) — Go team, 2019. Rank 1. Backs: maps printed in key-sorted order. [^5]
- [printf analyzer](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/printf) — Go team, living (x/tools v0.53.0). Rank 1. Backs: what the `printf` check reports, inferred wrappers, the non-constant format suggestion, the Go 1.27 `%w` pointer check. [^6]
- [Command vet](https://pkg.go.dev/cmd/vet) — Go team, living. Rank 1. Backs: vet reports `Printf` mismatches, uses heuristics, guidance only. [^7]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: the non-constant format string report and its language-version gate. [^8]
- [A Tour of Go, methods.article](https://github.com/golang/website/blob/0eef789c9f9a7cc074eab1b3fb2d96baea282546/_content/tour/methods.article) — Go team, living (golang/website at commit 0eef789). Rank 1. Backs: §Stringers, §Exercise: Stringers. [^9]

## Related
- `go/methods-interfaces/interfaces.md` — `Stringer` and `error` as interfaces, type switches, the typed-nil trap.
- `go/errors/errors-and-wrapping.md` — `%w`, `errors.Is`/`As`, and the Go 1.27 vet check on `%w` operands.
- `go/standard-library/log-and-slog.md` — `log.Printf` and structured logging, which build on these verbs.
- `go/data-types/strings-bytes-and-runes.md` — why width counts runes and `%x` counts bytes.
- `go/fundamentals/lexical-elements-and-semicolons.md` — the literal syntax that `%q`, `%#v` and `%U` print back.
- `go/tooling/go-command-and-build-reference.md` — every vet analyzer and the subset `go test` runs.
- `go/learning-path.md`
