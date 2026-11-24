---
schema: knowledge-doc/v1
type: concept
topic: python/standard-library
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, re, regular-expressions, regex, raw-strings, prefixmatch, findall, groups, lookahead, lookbehind, flags, unicode, backtracking, possessive-quantifiers, atomic-groups]
ranked-sources: true
---

# Regular expressions with the `re` module

## Summary
**TL;DR:** Write every pattern as a raw string (`r"\d+"`), then pick the entry point that matches the question: `search()` looks anywhere, `prefixmatch()` (the 3.15 name for `match()`) only at the start, `fullmatch()` must cover the whole string ✅[^re]. What `findall()` returns depends on how many capturing groups the pattern has, and `\d` and `\w` match Unicode digits and letters for `str` patterns unless `re.ASCII` is set ✅[^re]. The engine backtracks, so on a failing input a nested quantifier such as `(a+)+` got about four times slower with every two extra characters, while a possessive quantifier (`a++`, added in 3.11) removed the blow-up ✅[^whatsnew311] ✅[^lab].
**Use this when:** a pattern matches nothing or too much, `findall()` returns tuples or partial strings you did not expect, a regex is slow on some inputs, or you choose between `match`, `search` and `fullmatch`.
**Not this doc:** the shared theory of backtracking engines and ReDoS (regular expression denial of service) → `javascript/regular-expressions/regular-expressions-deep-dive.md`; string methods and `str` versus `bytes` → `python/data-structures/strings-bytes-and-formatting.md`; other standard modules → `python/standard-library/standard-library-tour.md`.

## Problem
Regex code in Python fails quietly, with no error to point at the cause:
- `re.match(r"\d+", "abc 42")` returns `None` although the text holds a number.
- `re.findall(r"(\w+)=\d+", "width=20 height=10")` returns `['width', 'height']`, not the whole pairs.
- `re.findall("\bcat\b", "a cat here")` returns `[]`, because the pattern is not a raw string.
- `re.findall(r"\d+", "price ٣٤ or 34")` returns two numbers, one in Arabic-Indic digits.
- `re.fullmatch(r"(a+)+", "a" * 24 + "b")` takes more than half a second.

Each one follows a documented rule of the `re` module, shown below.

## Mental model
**Analogy:** a pattern is a route card handed to a careful walker. The walker starts at one spot in the text and follows the card step by step. At every fork ("take one more `a` or stop?", "left branch or right?") they drop a breadcrumb; at a dead end they walk back to the last breadcrumb and try the other way. `search()` lets them start again from every spot, `prefixmatch()` only from the first, and `fullmatch()` also demands that they finish exactly at the end. A possessive quantifier or atomic group tells them to pick up their breadcrumbs inside that part, so they never come back to it.

**Artifact** (measured in the lab ✅[^lab]):
```python
import re
re.prefixmatch(r"\d+", "abc 42")              # None: only tries position 0
re.search(r"\d+", "abc 42").group()           # '42': tries every position
re.fullmatch(r"\d+", "123abc")                # None: must consume the whole string
re.findall(r"(\w+)=(\d+)", "width=20 height=10")
                                              # [('width', '20'), ('height', '10')]
re.search(r"<.*>", "<a> b <c>").group()       # '<a> b <c>'  greedy
re.search(r"<.*?>", "<a> b <c>").group()      # '<a>'        lazy
re.fullmatch(r"a*a", "aaaa")                  # matches: a* gives one 'a' back
re.fullmatch(r"a*+a", "aaaa")                 # None: a*+ never gives anything back
```

## How it works
1. **Raw strings keep backslashes for the regex engine.** Python string literals and regex syntax both use `\`; in a raw string (`r"..."`) backslashes are not processed, so `r"\n"` is two characters while `"\n"` is one ✅[^re]. Without `r`, `"\b"` is a single backspace character, so `"\bcat\b"` finds nothing in `'a cat here'` while `r"\bcat\b"` finds `['cat']` ✅[^lab]. Since 3.12 an unknown escape such as `"\d"` in a normal literal emits a `SyntaxWarning` ✅[^whatsnew312]; 3.15.2 prints `"\d" is an invalid escape sequence ... A raw string is also an option.` ✅[^lab].
2. **Choose the entry point.** `search()` scans for the first position where the pattern matches; `prefixmatch()` matches only at the beginning, even in `MULTILINE` mode; `fullmatch()` needs the whole string to match ✅[^re]. All three return a `Match` object or `None` ✅[^re]; calling `.group()` on `None` raises `AttributeError: 'NoneType' object has no attribute 'group'` ✅[^lab]. `prefixmatch()` was added in 3.15 and `match()` is soft deprecated in its favour: it stays, will not be removed, and is still the name to use for code that must run on older versions ✅[^whatsnew315]. Calling `re.match()` emitted no warning ✅[^lab].
3. **Read the match.** `m.group(0)` (or `m[0]`) is the whole match, `m.group(1)` or `m[1]` a group, `m.groups()` all groups, `m.groupdict()` the named ones, `m.span(1)` a group's positions ✅[^re]. For `search(r"(\w+)@(\w+)\.com", "mail bob@example.com now")`: `m[0]` is `'bob@example.com'`, `m.groups()` is `('bob', 'example')`, `m.span(1)` is `(5, 8)` ✅[^lab]. An optional group that did not take part is `None`, or the `default` passed to `groups()` ✅[^re]; for example `fullmatch(r"(\d+)(?:\.(\d+))?", "42").groups()` is `('42', None)` ✅[^lab].
4. **Find many matches.** `findall()` returns strings or tuples by group count: no group gives whole matches, one group gives that group's text, two or more give tuples; non-capturing groups `(?:...)` do not change the shape ✅[^re]. `finditer()` yields `Match` objects instead, so positions survive: `[(1, '1'), (4, '22'), (8, '333')]` for `r"\d+"` on `'a1 b22 c333'` ✅[^lab]. `split()` with a capturing group keeps the separators in the result ✅[^re]; for example `re.split(r"(\W+)", "Words, words, words.")` gives `['Words', ', ', 'words', ', ', 'words', '.', '']` ✅[^lab].
5. **Replace.** `sub(pattern, repl, string)` takes a replacement string, where `\1`, `\g<name>` and `\g<1>` refer to groups, or a function that receives each `Match` and returns the text ✅[^re]. `\g<2>0` means group 2 then `'0'`, while `\20` means group 20 ✅[^re]. `subn()` also returns the number of replacements ✅[^re]. Passing `count` or `flags` positionally is deprecated since 3.13 ✅[^whatsnew313]; for example `re.sub('a', 'b', 'aaa', 1)` emitted a `DeprecationWarning`; write `count=1` ✅[^lab].
6. **Groups.** `(...)` captures; `(?P<name>...)` captures under a name and is also numbered; `(?:...)` groups without capturing; `(?P=name)` or `\1` inside the pattern matches the same text again ✅[^re]. `re.compile(r"(a)(?:b)(?P<c>c)").groups` is `2` ✅[^lab].
7. **Quantifiers and backtracking.** `*`, `+`, `?` and `{m,n}` are greedy: they take as much as possible, and when the rest of the pattern fails the engine backs up and retries with fewer repetitions ✅[^howto]. Adding `?` (`*?`, `+?`, `{m,n}?`) makes them lazy, taking as little as possible ✅[^re]. Adding `+` (`*+`, `++`, `?+`, `{m,n}+`) makes them possessive: as many as possible, with no backtracking into them; `x*+` equals the atomic group `(?>x*)`; both arrived in 3.11 ✅[^re] ✅[^whatsnew311].
8. **Lookaround checks without consuming.** `(?=...)` and `(?!...)` test what follows, `(?<=...)` and `(?<!...)` what precedes ✅[^re]. `re.findall(r"\d+(?=px)", "10px 20em 30px")` gives `['10', '30']`; `re.findall(r"(?<=\$)\d+", "cost $30 or 40")` gives `['30']` ✅[^lab]. A lookbehind must match strings of a fixed length ✅[^re]; `(?<=a+)b` raises `PatternError: look-behind requires fixed-width pattern` ✅[^lab]. `re.PatternError` is the 3.13 name of `re.error`, which stays as an alias ✅[^whatsnew313] ✅[^lab].
9. **Flags change the rules.** `IGNORECASE` (`re.I`, inline `(?i)`) ignores case; `MULTILINE` (`re.M`) lets `^` and `$` match at every line; `DOTALL` (`re.S`) lets `.` match a newline; `VERBOSE` (`re.X`) ignores whitespace and allows `#` comments; `ASCII` (`re.A`) makes `\w`, `\b`, `\d` and `\s` ASCII-only (ASCII = American Standard Code for Information Interchange) ✅[^re]. Combine them with `|`; a scoped form such as `(?i:a)bc` applies a flag to part of the pattern ✅[^re] (it matches `'Abc'` but not `'ABC'` ✅[^lab]).
10. **Unicode by default.** For `str` patterns, `\d` matches any Unicode decimal digit (category Nd) and `\w` any character for which `str.isalnum()` is true, plus `_` ✅[^re]. So `\d+` finds `'٣٤'` and `\w+` keeps `'café'` whole, while with `re.ASCII` they give `['34']` and `['caf', 'na', 've']`; `[0-9]` stays ASCII either way ✅[^lab]. `int('٣٤')` is `34`, so a Unicode digit match can flow into arithmetic unnoticed ✅[^lab]. A `str` pattern cannot search `bytes` (or the reverse) ✅[^re]; for example `TypeError: cannot use a string pattern on a bytes-like object` ✅[^lab].
11. **Compiled patterns and the cache.** `re.compile()` returns a `Pattern`; keeping it is more efficient when one expression is used several times, and its methods take optional `pos` and `endpos` limits ✅[^re]. The module functions also cache the most recently used patterns, so a program with a few regexes need not compile them by hand ✅[^re] ✅[^howto]; `re.purge()` clears that cache ✅[^re]. In 3.15.2 two `re.compile(r"\d+")` calls returned the same object ✅[^lab], a cache effect that no page promises.

### Catastrophic backtracking, measured
When the rest of a pattern fails, the engine backs up and retries with fewer repetitions ✅[^howto], and `(a+)+` offers it a great many ways to split one run of `a`s between the inner and the outer `+` (the theory lives in `javascript/regular-expressions/regular-expressions-deep-dive.md`). Times are observations from one run on the lab machine, best of three `fullmatch()` calls on `'a' * n + 'b'` ✅[^lab].

| n | `(a+)+` | `(a++)+` | `(?>a+)+` | `a+` |
|---|---|---|---|---|
| 16 | 2.7 ms | 0.0002 ms | 0.0002 ms | 0.0003 ms |
| 18 | 11.5 ms | 0.0002 ms | 0.0003 ms | 0.0003 ms |
| 20 | 39.4 ms | 0.0005 ms | 0.0006 ms | 0.0007 ms |
| 22 | 149.2 ms | 0.0003 ms | 0.0003 ms | 0.0003 ms |
| 24 | 582.3 ms | 0.0002 ms | 0.0003 ms | 0.0003 ms |

Every two extra characters made `(a+)+` about four times slower. The possessive and atomic versions failed at once, and on 100,000 `a`s `(a++)+` took 0.05 ms; all four still match the valid input `'aaaa'` ✅[^lab].

## Worked example
Parse a small log, measured in the lab ✅[^lab]. The input has three log lines and one line of noise:
```text
2026-11-24 09:30 WARN disk=91% host=db-1
2026-11-24 09:31 INFO disk=40% host=web-2
not a log line
2026-11-24 09:32 WARN disk=97% host=db-2
```
```python
LINE = re.compile(r"""
    ^(?P<date>\d{4}-\d\d-\d\d) \s+   # ISO date
    (?P<time>\d\d:\d\d)        \s+   # hh:mm
    (?P<level>[A-Z]+)          \s+   # level word
    (?P<rest>.*)$                    # the key=value tail
""", re.MULTILINE | re.VERBOSE | re.ASCII)
first = next(LINE.finditer(log))                  # log holds the four lines above
date_pattern = r"(?P<y>\d{4})-(?P<m>\d\d)-(?P<d>\d\d)"
```

| Step | Code | Result |
|---|---|---|
| 1 | `[m["level"] for m in LINE.finditer(log)]` | `['WARN', 'INFO', 'WARN']`: `MULTILINE` lets `^`/`$` work per line, and the noise line fails |
| 2 | `first.groupdict()` | `{'date': '2026-11-24', 'time': '09:30', 'level': 'WARN', 'rest': 'disk=91% host=db-1'}` |
| 3 | `dict(re.findall(r"(\w+)=(\S+)", first["rest"]))` | `{'disk': '91%', 'host': 'db-1'}`: two groups, so `findall` gives pairs |
| 4 | keep lines where `int(re.search(r"disk=(\d+)%", rest)[1]) > 90` | `['disk=91% host=db-1', 'disk=97% host=db-2']` |
| 5 | `re.sub(r"host=(?P<name>[a-z]+)-\d+", r"host=\g<name>-*", log)` | first line ends `host=db-*`, fourth `host=db-*` |
| 6 | `re.sub(date_pattern, r"\g<d>/\g<m>/\g<y>", log, count=1)` | `24/11/2026 09:30 WARN disk=91% host=db-1` (only the first date) |
| 7 | `re.sub(r"(\d+)%", lambda m: f"{int(m[1]) / 100:.2f}", first["rest"])` | `disk=0.91 host=db-1` |
| 8 | `LINE.prefixmatch("not a log line")` | `None` |

`re.ASCII` limits `\d` to `[0-9]` ✅[^re], so this pattern accepts only dates written in ASCII digits.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `re.findall(r"(ab)+", "ababab abab")` | `['ab', 'ab']` ✅[^lab] | With one group `findall` returns the group, which holds only its last repetition; `(?:ab)+` gives `['ababab', 'abab']` ✅[^lab] |
| `re.sub("x*", "-", "abxd")` | `'-a-b--d-'` ✅[^lab] | An empty match can occur right after a non-empty one ✅[^re] |
| `re.search(r"end$", "the end\n")` | Matches; `r"end\z"` does not ✅[^lab] | `$` also matches before a final newline; `\z` (3.14) only at the very end ✅[^re] |
| `re.search(r"\B", "")` | Matches at `(0, 0)` ✅[^lab] | Changed in 3.14 so that `\B` is always the opposite of `\b` ✅[^whatsnew314] |
| `re.sub("a", r"\q", "a")` | `PatternError: bad escape \q at position 0` ✅[^lab] | Unknown escapes of ASCII letters in the replacement are errors ✅[^re] |
| `re.fullmatch(r"a*+a", "aaaa")` | `None` ✅[^lab] | A possessive quantifier never gives characters back, which can change what matches, not only the speed ✅[^re] |
| `[a-z]` with `re.IGNORECASE` | Also matches `İ`, `ı`, `ſ` and the Kelvin sign ✅[^re] | Documented Unicode case folding; add `re.ASCII` to keep it to 52 letters ✅[^re] |
| User text inside a pattern | `re.escape("1+1=2?")` → `'1\\+1=2\\?'` ✅[^lab] | `escape()` quotes regex metacharacters; do not use it on a `sub()` replacement string ✅[^re] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| String methods (`in`, `replace`, `split`, `translate`) | Usually much faster and easier to read for fixed text ✅[^howto] ✅[^tut-stdlib] | No word boundaries, classes or groups |
| Module functions (`re.search(p, s)`) | Short; recent patterns are cached ✅[^re] | No `pos`/`endpos`; inside a loop, a few extra function calls each time ✅[^howto] |
| `re.compile()` once | Reuse, `pos`/`endpos`, a named object to document | One more line |
| Possessive or atomic groups | Removes backtracking blow-ups ✅[^lab] | Can reject inputs the greedy form accepts ✅[^re] |
| Rewriting to an unambiguous pattern (`a+` for `(a+)+`) | Same matches, no blow-up ✅[^lab] | Needs thought per pattern |

## Takeaways
- Write every pattern as a raw string. [rule-candidate]
- Use `fullmatch()` to validate a whole value, `search()` to find inside text, and `prefixmatch()` (or `match()` on older Pythons) only when "at the start" is the point. [rule-candidate]
- Use `(?:...)` for grouping you do not need to capture, especially in `findall()` and `split()` patterns. [rule-candidate]
- Add `re.ASCII` or `[0-9]` when only ASCII digits are valid input. [rule-candidate]
- Pass `count=` and `flags=` to `sub()` and `split()` as keywords. [rule-candidate]
- Never nest unbounded quantifiers over the same characters (`(a+)+`, `(\w*)*`); rewrite, or make the inner one possessive. [rule-candidate]
- Run `re.escape()` on user text before putting it in a pattern. [rule-candidate]

## Verification status
- Verified: 80 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [`re` — Regular expression operations](https://docs.python.org/3/library/re.html) — Python Software Foundation, living. Rank 1. Backs: raw strings; `search`, `prefixmatch`, `match`, `fullmatch`; `findall` result shapes; `split`, `sub`, `subn`, `escape`; group syntax; lazy and possessive quantifiers; atomic groups; lookaround; flags; Unicode `\d` and `\w`; `$`, `\z`; compile and cache. [^re]
- [Regular expression HOWTO](https://docs.python.org/3/howto/regex.html) — Python Software Foundation, living. Rank 1. Backs: how greedy repetition backs up; the module-level cache; use string methods first. [^howto]
- [10. Brief tour of the standard library](https://docs.python.org/3/tutorial/stdlib.html) — Python Software Foundation, living. Rank 1. Backs: string methods are preferred for simple jobs. [^tut-stdlib]
- [What's New In Python 3.11](https://docs.python.org/3/whatsnew/3.11.html) — Python Software Foundation, 2022. Rank 1. Backs: atomic groups and possessive quantifiers added. [^whatsnew311]
- [What's New In Python 3.12](https://docs.python.org/3/whatsnew/3.12.html) — Python Software Foundation, 2023. Rank 1. Backs: invalid escape sequences raise `SyntaxWarning`. [^whatsnew312]
- [What's New In Python 3.13](https://docs.python.org/3/whatsnew/3.13.html) — Python Software Foundation, 2024. Rank 1. Backs: `re.error` renamed `PatternError`; positional `count`, `maxsplit` and `flags` deprecated. [^whatsnew313]
- [What's new in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, 2025. Rank 1. Backs: `\B` matches the empty string. [^whatsnew314]
- [What's new in Python 3.15](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: `prefixmatch()` added, `match()` soft deprecated and kept. [^whatsnew315]

## Related
- `javascript/regular-expressions/regular-expressions-deep-dive.md` — backtracking, ReDoS and lookaround theory shared by both engines, measured in Node.js.
- `python/standard-library/standard-library-tour.md` — the other modules of the tutorial's standard-library tour.
- `python/data-structures/strings-bytes-and-formatting.md` — the string methods to try before a regex, and `str` versus `bytes`.
