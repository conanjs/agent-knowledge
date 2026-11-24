---
schema: knowledge-doc/v1
type: concept
topic: dotnet/fundamentals
status: verified
applies-to: [".NET 10 (runtime 10.0.12)", "C# 14", "macOS 26.1 with ICU for the culture results"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [csharp, string, immutability, utf-16, rune, grapheme, stringinfo, interpolation, raw-string-literals, verbatim, utf-8-literals, interning, stringbuilder, stringcomparison, ordinal, culture, turkish-i, invariant-globalization, icu, formatting]
ranked-sources: true
---

# Strings, text and culture-aware comparison

## Summary
**TL;DR:** A `string` is an immutable sequence of UTF-16 (16-bit Unicode Transformation Format) code units (`char`), so `Length` counts code units, not what a reader sees: one emoji can be 4 `char`s, 2 `Rune`s (Unicode scalar values) and 1 grapheme cluster (`StringInfo` text element). `==` and `string.Equals` compare ordinally (code unit by code unit), while `Compare`, `StartsWith(string)`, `EndsWith(string)`, `IndexOf(string)` and `ToUpper()` follow the current culture unless told otherwise, which is how the Turkish dotless i and a decimal comma break code. Pass `StringComparison.Ordinal`/`OrdinalIgnoreCase` for identifiers and `CultureInfo.InvariantCulture` for data that machines read back.
**Use this when:** a string length or substring is wrong for non-English text or emoji, a comparison passes on one machine and fails on another, a CSV (comma-separated values) or log line gets an extra comma, or you choose between interpolation, `StringBuilder`, raw literals and `u8` literals.
**Not this doc:** numeric parsing and rounding → `dotnet/fundamentals/types-values-and-conversions.md`; slicing text without copying (`ReadOnlySpan<char>`, `SearchValues`) → `dotnet/performance/span-and-memory.md`; avoiding string allocations (`string.Create`, `StringBuilder` reuse) → `dotnet/performance/measuring-and-reducing-allocations.md`; `[GeneratedRegex]` → `dotnet/metaprogramming/source-generators.md`.

## Problem
- `"👍🏽".Length` is `4`, and `Substring(0, 1)` returns half a surrogate pair that prints as garbage.
- `"é" == "é"` is `false` when one is precomposed and the other is `e` plus a combining accent.
- `url.ToUpper().StartsWith("FILE")` is `false` for `"file-index"` when the current culture is Turkish.
- A CSV line built with `$"{name},{price}"` has three fields on a machine whose culture writes `1234,5`.
- `double.Parse("3.5")` returns `35` on the same machine.
- `(object)a == (object)b` is `false` for two strings with the same text.

## Mental model
**Analogy:** a `string` is a sealed roll of 16-bit tiles. Most letters take one tile, some symbols take two tiles that only make sense together (a surrogate pair), and what a reader calls one character can be several symbols glued together (a grapheme cluster: base letter plus accent, emoji plus skin tone). Comparison comes in two kinds: *ordinal* compares tile numbers one by one, like matching serial numbers; *linguistic* (culture) comparison asks a dictionary editor of one language whether two words count as the same, and editors disagree.

**Artifact** (lab output ✅[^lab]):
```text
emoji 👍🏽       Length(UTF-16 units)=4 Runes=2 Graphemes=1 UTF-8 bytes=8
flag 🇻🇳        Length(UTF-16 units)=4 Runes=2 Graphemes=1 UTF-8 bytes=8
e + U+0301     Length(UTF-16 units)=2 Runes=2 Graphemes=1 UTF-8 bytes=3
é precomposed  Length(UTF-16 units)=1 Runes=1 Graphemes=1 UTF-8 bytes=2
"file".ToUpper(tr-TR) = FİLE    "file".ToUpperInvariant() = FILE
```

## How it works
1. **Immutable.** A string's contents never change after creation; every method or operator that seems to modify one returns a new string ✅[^strings]. In the lab `s.ToUpper()` returned a different object and `s` kept its value ✅[^lab].
2. **UTF-16 code units.** .NET stores `string` text as UTF-16, where one 16-bit code unit (`char`) covers the Basic Multilingual Plane and a code point above it needs two, a *surrogate pair* from the range `U+D800`–`U+DFFF` ✅[^encoding]. `Length` counts `char` values ✅[^strings]. In the lab `"👍🏽"[0]` was the high surrogate `U+D83D` and the first `Rune` was `U+1F44D` ✅[^lab].
3. **Rune and grapheme cluster.** `System.Text.Rune` represents one Unicode scalar value; a grapheme cluster, called a *text element* in .NET APIs, is what displays as one character and is enumerated with `StringInfo` ✅[^encoding]. Splitting text every N `char`s or every N runes can cut a cluster; splitting by text elements cannot ✅[^encoding]. Canonically equivalent forms differ ordinally: `"é" == "é"` was `False`, `True` after `Normalize()`, and an invariant-culture `Compare` returned `0` ✅[^lab].
4. **`==` is value equality, but only when the compiler sees `string`.** `==` and `!=` on `string` compare values, not references ✅[^reftypes]. `Equals` overloads without a `StringComparison`, and the `==` operator, use ordinal comparison ✅[^bestpractices]. Typed as `object`, `==` is reference equality: in the lab two equal strings gave `a1==a2 True` but `(object)== False`, while `o1.Equals(o2)` stayed `True` ✅[^lab].
5. **Defaults differ by method.** Culture-sensitive by default: `String.Compare` and `CompareTo`, `StartsWith(string)`, `EndsWith(string)`, and `IndexOf`/`LastIndexOf` with a `string` argument ✅[^bestpractices]. Ordinal by default: `Equals`, `==`, `IndexOf(char)`, and `Contains` for both `char` and `string` ✅[^bestpractices]. The guidance: pass a `StringComparison` every time, use `Ordinal`/`OrdinalIgnoreCase` as the safe default for non-linguistic matching, and use the current culture only for text shown to users ✅[^bestpractices].
6. **The current culture comes from the operating system.** When the program does not set it, the current culture is the OS setting ✅[^bestpractices]. On the lab Mac it was `en-VN` (from the macOS region setting) with decimal separator `,`; with `LANG=en_US.UTF-8` the same probe ran as `en-US` ✅[^lab]. Interpolated strings, concatenation, `String.Format` and `ToString` all format with the current culture by default ✅[^displaydata].
7. **Turkish i.** In `tr-TR` the upper case of `i` is `İ` (U+0130) and the lower case of `I` is `ı` (U+0131) ✅[^lab]. A check like `IsFileURI("file:")` that uppercases with the current culture returns `true` in US English and `false` in Turkish, which is why culture rules must not guard security decisions ✅[^bestpractices]. To normalize case for comparison, prefer `ToUpperInvariant` over `ToLowerInvariant` ✅[^bestpractices].
8. **ICU zero-weight characters.** Linguistic operations run on ICU (International Components for Unicode), the library .NET has used on Unix for years and, from .NET 5, on recent Windows too; ICU gives some characters zero weight: `"Hel\0lo".IndexOf("\0")` returns `0` in a culture search and `3` in an ordinal one ✅[^icu]. The lab reproduced `0`, `0`, `3`, plus `"abc".EndsWith("\0") = True` (culture) and `False` (ordinal); a soft hyphen made `"co­op"` equal `"coop"` under the invariant culture but not ordinally ✅[^lab].
9. **Invariant globalization mode.** `InvariantGlobalization=true` (or `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`) runs the app without culture data ✅[^globalconfig]. Then `Compare`, `IndexOf` and `LastIndexOf` are always ordinal, and creating any culture other than the invariant one throws by default (`PredefinedCulturesOnly`) ✅[^invariant]. Lab: `string.Compare("a", "B", InvariantCulture)` went from `-1` to `31`, `"Hel\0lo".IndexOf("\0")` became `3`, and `new CultureInfo("tr-TR")` threw `CultureNotFoundException: Only the invariant culture is supported in globalization-invariant mode.` ✅[^lab].
10. **Interpolation.** A placeholder is `{expression[,width][:format]}`: a positive width right-aligns, a negative one left-aligns, and `{{`/`}}` produce literal braces ✅[^interp]. When the target is `string`, the compiler lowers the interpolation to `DefaultInterpolatedStringHandler` ✅[^interp]. `string.Create(provider, $"…")` (since .NET 6) formats with a chosen culture; `FormattableString` is the older route ✅[^interp]. A `const string` may be interpolated if every hole is a constant string ✅[^interp]. Lab, under the invariant culture: `[{price,10:F2}]` printed `[   1234.50]`, `{0.256:P1}` printed `25.6 %` (`25.6%` in `en-US`, `25,6%` in `en-VN`), and `string.Create(new CultureInfo("vi-VN"), $"{price:N2}")` printed `1.234,50` ✅[^lab].
11. **Literal forms.** In a verbatim literal (`@"…"`) escape sequences are not processed and `""` stands for one quote ✅[^verbatim]. A raw literal (C# 11) starts and ends with at least three quotes; in the multi-line form the whitespace left of the closing quotes is removed from every line ✅[^raw]. An interpolated raw literal with `$$` needs `{{…}}` around holes, so single braces are plain text ✅[^interp]. A `u8` suffix (C# 11) stores the literal as UTF-8 bytes in a `ReadOnlySpan<byte>`; such literals are not compile-time constants and cannot be interpolated ✅[^reftypes]. Lab: `"héllo"u8` was 6 bytes ✅[^lab].
12. **Interning.** The runtime keeps an *intern pool* with one reference per unique string value, and `String.Intern` returns the pooled instance; automatic interning of literals is not guaranteed ✅[^intern]. In the lab the literal `"lab"` and the constant-folded `"l" + "ab"` were one object, a string built at run time was a different one, and `string.Intern(built)` returned the literal's object ✅[^lab].
13. **`StringBuilder`.** Because every string method allocates a new string, repeated changes belong in a `StringBuilder` ✅[^sbguide]. Its default capacity is 16 characters and it doubles when full ✅[^sbapi]; the lab saw capacities 16, 32, 64, 128 while appending 100 characters ✅[^lab].

## Worked example
Writing a CSV line and checking a scheme name on the lab machine (current culture `en-VN`) ✅[^lab].

| Step | Code | Result | Rule |
|---|---|---|---|
| 1 | `CultureInfo.CurrentCulture.Name` | `en-VN` | taken from the OS (How it works 6) |
| 2 | `$"{name},{price}"` with `price = 1234.5` | `file-index,1234,5`: 3 fields | interpolation formats with the current culture |
| 3 | `string.Create(CultureInfo.InvariantCulture, $"{name},{price}")` | `file-index,1234.5`: 2 fields | invariant culture for persisted data ✅[^displaydata] |
| 4 | `double.Parse("1234.5")` vs `double.Parse("1234.5", CultureInfo.InvariantCulture)` | `12345` vs 1234.5 (which the `en-VN` console printed as `1234,5`) | parsing also follows the current culture |
| 5 | current culture `tr-TR`, `name.ToUpper().StartsWith("FILE")` | `FİLE-İNDEX`, `False` | Turkish casing |
| 6 | `name.StartsWith("FILE", StringComparison.OrdinalIgnoreCase)` | `True` | ordinal ignore-case does not use culture rules |
| 7 | `new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "File-Index" }.Contains("FILE-INDEX")` | `True` | give collections an explicit comparer |

Steps 2–4 corrupt data silently and step 5 skips a check silently; none throws.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `$$"""{"id": {{id}}, "set": {1,2}}"""` | `error CS9007: The interpolated raw string literal does not start with enough '$' characters to allow this many consecutive closing braces as content.` ✅[^lab] | the content ends in `}}`, as many braces as `$` signs; use `$$$` or change the text ✅[^interp] |
| Reversing `"ab👍"` with `Array.Reverse` on its `char[]` | the result starts with a lone low surrogate ✅[^lab] | the pair's order is reversed; reverse by text elements instead ✅[^encoding] |
| `"line1\r\nline2".IndexOf("\n")` with the current culture | `6`, the same as ordinal ✅[^lab] | not a zero-weight case on this ICU; the documented zero-weight example is `\0` ✅[^icu] |
| Sorting `b, A, a, B, _x, 10, 9` | invariant culture: `_x,10,9,a,A,b,B`; ordinal: `10,9,A,B,_x,a,b` ✅[^lab] | ordinal sorts by code-unit value, culture by dictionary rules; neither sorts numbers numerically |
| Case mapping in invariant globalization mode | `"héllo ǆ".ToUpper()` gave `HÉLLO Ǆ` and `"ΣΑΣ".ToLower()` gave `σασ` ✅[^lab] | the runtime design doc says invariant mode cases only `a`–`z` ✅[^invariant], but the .NET 6 breaking-change notice says invariant mode has mapped case for every Unicode character since .NET 6 ✅[^casemap6]; .NET 10 maps beyond ASCII (American Standard Code for Information Interchange), so the design doc is out of date on this point |
| `(object)s1 == (object)s2` | reference comparison; the compiler's operator choice follows the static type ✅[^lab] | the `string` overload of `==` applies only when both operands are typed `string` ✅[^reftypes] |
| `ReadOnlySpan<byte>` from `"…"u8` passed to `$"{span.GetType()}"` | `error CS0029: Cannot implicitly convert type 'System.ReadOnlySpan<byte>' to 'object'` ✅[^lab] | a span is a `ref struct` and cannot be boxed → `dotnet/performance/ref-safety-and-ref-structs.md` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `StringComparison.Ordinal` / `OrdinalIgnoreCase` | predictable on every machine; fastest ✅[^bestpractices] | wrong for sorting words for people |
| `StringComparison.CurrentCulture` | matches the user's language ✅[^bestpractices] | results change with the machine; unsafe for identifiers and security checks |
| `InvariantGlobalization=true` | no dependency on globalization data, smaller distribution ✅[^invariant] | all comparison becomes ordinal and only the invariant culture exists ✅[^invariant] |
| Interpolated strings | readable; a handler can skip building a string nobody uses, such as a disabled log message ✅[^handler] | culture-dependent unless a provider is passed |
| `StringBuilder` for loops | amortized growth by doubling ✅[^sbapi] | overkill for a handful of concatenations |

## Takeaways
- Pass a `StringComparison` (or a `StringComparer`) to every comparison, search and dictionary of strings; use `Ordinal`/`OrdinalIgnoreCase` unless the text is shown to a person. [rule-candidate]
- Format and parse anything a machine reads back (CSV, JSON (JavaScript Object Notation), logs, file names) with `CultureInfo.InvariantCulture`. [rule-candidate]
- Never use culture-sensitive `ToUpper`/`ToLower` in security or protocol checks; use `OrdinalIgnoreCase`. [rule-candidate]
- Count, cut and reverse user-visible text by text elements (`StringInfo`), not by `Length` or `char`.
- Treat `string.Intern` and literal interning as an optimization, never as a way to compare.

## Verification status
- Verified: 62 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `dotnet/lab-setup.md` — the .NET SDK 10.0.401 lab (runtime 10.0.12, C# 14, macOS 26.1 arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [Strings and string literals](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/strings/) — Microsoft, living. Rank 1. Backs: immutability; `Length` counts `char` objects. [^strings]
- [Built-in reference types: string](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/reference-types) — Microsoft, living. Rank 1. Backs: `==` compares values; UTF-8 literals as `ReadOnlySpan<byte>`, not constants, no interpolation. [^reftypes]
- [Character encoding in .NET](https://learn.microsoft.com/en-us/dotnet/standard/base-types/character-encoding-introduction) — Microsoft, living. Rank 1. Backs: UTF-16 code units, surrogate pairs, `Rune`, grapheme clusters and `StringInfo`; safe splitting. [^encoding]
- [Best practices for comparing strings in .NET](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-strings) — Microsoft, living. Rank 1. Backs: recommendations; which methods default to culture or ordinal; OS culture default; the Turkish `IsFileURI` example; `ToUpperInvariant`. [^bestpractices]
- [Best practices for displaying and persisting formatted data](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-display-data) — Microsoft, living. Rank 1. Backs: current culture by default for interpolation, concatenation, `Format`, `ToString`; invariant culture for persisted data. [^displaydata]
- [Globalization and ICU](https://learn.microsoft.com/en-us/dotnet/core/extensions/globalization-icu) — Microsoft, living. Rank 1. Backs: ICU zero-weight `\0` example. [^icu]
- [Runtime configuration options for globalization](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/globalization) — Microsoft, living. Rank 1. Backs: `InvariantGlobalization` and its environment variable. [^globalconfig]
- [.NET globalization invariant mode](https://github.com/dotnet/runtime/blob/main/docs/design/features/globalization-invariant-mode.md) — .NET runtime team, living. Rank 1. Backs: reduced dependencies and distribution size; ordinal operations; `PredefinedCulturesOnly`; the ASCII-only casing statement. [^invariant]
- [Culture creation and case mapping in globalization-invariant mode](https://learn.microsoft.com/en-us/dotnet/core/compatibility/globalization/6.0/culture-creation-invariant-mode) — Microsoft, 2021. Rank 1. Backs: full Unicode case mapping in invariant mode since .NET 6. [^casemap6]
- [String interpolation using $](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/interpolated) — Microsoft, living. Rank 1. Backs: placeholder syntax, width and braces; `DefaultInterpolatedStringHandler`; `string.Create` and `FormattableString`; constant interpolated strings; `$$` raw interpolation. [^interp]
- [Write a custom string interpolation handler](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/performance/interpolated-string-handler) — Microsoft, living. Rank 1. Backs: handlers can skip work when the string is not needed. [^handler]
- [Verbatim text](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/verbatim) — Microsoft, living. Rank 1. Backs: escapes not processed; `""`. [^verbatim]
- [Raw string literals](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/raw-string) — Microsoft, living. Rank 1. Backs: three-quote delimiters; indentation removal. [^raw]
- [String.Intern](https://learn.microsoft.com/en-us/dotnet/api/system.string.intern) — Microsoft, living. Rank 1. Backs: intern pool; literal interning not guaranteed. [^intern]
- [Using the StringBuilder class in .NET](https://learn.microsoft.com/en-us/dotnet/standard/base-types/stringbuilder) — Microsoft, living. Rank 1. Backs: string methods allocate; use `StringBuilder` for repeated changes. [^sbguide]
- [StringBuilder class](https://learn.microsoft.com/en-us/dotnet/api/system.text.stringbuilder) — Microsoft, living. Rank 1. Backs: default capacity 16; capacity doubles. [^sbapi]

## Related
- `dotnet/fundamentals/types-values-and-conversions.md` — numeric parsing with a culture.
- `dotnet/performance/span-and-memory.md` — `ReadOnlySpan<char>`, `AsSpan`, `SearchValues`.
- `dotnet/performance/measuring-and-reducing-allocations.md` — `string.Create` and `StringBuilder` reuse.
- `dotnet/tooling/analyzers-and-code-quality.md` — turning on CA (code analysis) rules, measured there for the culture rules CA1304, CA1305 and CA1311; CA1307 and CA1309, which flag string comparisons without `StringComparison`, are not covered there but are configured the same way.
