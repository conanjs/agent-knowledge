---
schema: topic-index/v1
kind: subtopic
topic: python/standard-library
last-updated: 2026-11-24
---

# Python standard library essentials

The modules a working programmer reaches for daily, following the Python Tutorial's two-part "Brief tour of the standard library": files and the OS, processes, command-line arguments, text, math, data formats, compression, internet access and collections, as a task-ordered catalog; then two areas deep enough for their own docs, regular expressions and dates and times. Measured in CPython 3.15.2, with no network access in the probes. Not covered: threading, logging, weak references and testing (each has its own `python/` doc, linked from the catalog).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [standard-library-tour.md](standard-library-tour.md) | reference | Task-ordered catalog of the Tutorial's standard-library tour modules, with key calls run in the lab and documented gotchas per module | verified |
| [regular-expressions.md](regular-expressions.md) | concept | The `re` module: raw strings, `prefixmatch`/`search`/`fullmatch`, `findall` shapes, groups, lookaround, Unicode flags, and backtracking blow-ups fixed with possessive quantifiers | verified |
| [dates-and-times.md](dates-and-times.md) | concept | `datetime` naive vs aware, `zoneinfo` and `tzdata`, wall-clock `timedelta` arithmetic across DST and `fold`, ISO and `strptime` parsing, and which clock measures durations | verified |

## References
- [Brief Tour of the Standard Library](https://docs.python.org/3/tutorial/stdlib.html) — Python Software Foundation, living. Backs: subtopic scope.
- [Brief Tour of the Standard Library — Part II](https://docs.python.org/3/tutorial/stdlib2.html) — Python Software Foundation, living. Backs: subtopic scope.

## Related
- `javascript/regular-expressions/regular-expressions-deep-dive.md` — regex theory shared across engines.
- `python/learning-path.md` — the order to read the `python/` docs in.
