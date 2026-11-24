---
schema: knowledge-doc/v1
type: concept
topic: python/standard-library
status: verified
applies-to: ["CPython 3.15", "Python language reference 3.15"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [python, datetime, zoneinfo, time-zones, dst, timedelta, fold, isoformat, strptime, utcnow, monotonic, perf-counter]
ranked-sources: true
---

# Dates, times and time zones in Python

## Summary
**TL;DR:** A `datetime` is either naive (no time zone, so its meaning is up to the program) or aware (it carries a `tzinfo` and names one moment) ✅[^datetime]. Make times aware with `datetime.now(UTC)` and `zoneinfo.ZoneInfo("Region/City")`, and remember that adding a `timedelta` to an aware `datetime` moves the wall clock with no time-zone adjustment, so "plus one day" across a daylight-saving change is 23 or 25 real hours ✅[^datetime] ✅[^lab]. Measure durations with `time.perf_counter()` or `time.monotonic()`, never `time.time()`, which can go backwards when the system clock is set back ✅[^time].
**Use this when:** you store or compare timestamps, schedule something in a named time zone, parse or print ISO 8601 (the international standard date and time notation) or custom formats, see `can't compare offset-naive and offset-aware datetimes`, or replace `datetime.utcnow()`.
**Not this doc:** the other standard modules → `python/standard-library/standard-library-tour.md`; benchmarking with `timeit` → `python/tooling/testing-debugging-and-profiling.md`; why `timestamp()` returns a float with limited precision → `floating-point/rounding-and-error.md`.

## Problem
Time code passes its tests and then breaks twice a year, or on a server in another zone:
- A New York meeting at 12:00 on 7 March 2026 plus `timedelta(days=1)` lands at 12:00 on 8 March, which is only 23 hours later, because clocks jumped from 02:00 to 03:00 that night (DST, daylight saving time, started).
- `datetime.now()` returns a naive local time; comparing it with an aware value using `<` raises `TypeError`, while `==` quietly returns `False`.
- `datetime.utcnow()` returns a naive value that many methods then treat as local time, and it is deprecated.
- `datetime.strptime("02/29", "%m/%d")` raises `ValueError` in 3.15.
- A duration measured with `time.time()` can come out negative after a clock correction.

## Mental model
**Analogy:** a naive `datetime` is a wall-clock reading on a sticky note with no city written on it. An aware one names the city, so it pins down one moment. Adding a `timedelta` to it turns the hands of that city's clock; it does not run a stopwatch. When the city skips an hour overnight, "the same time tomorrow" is 23 stopwatch hours away. For elapsed time, read a clock that never jumps: UTC (Coordinated Universal Time) for instants, `time.monotonic()` for durations.

**Artifact** (measured in the lab ✅[^lab]):
```python
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo
NY = ZoneInfo("America/New_York")
before = datetime(2026, 3, 7, 12, 0, tzinfo=NY)   # 2026-03-07T12:00:00-05:00
after = before + timedelta(days=1)                # 2026-03-08T12:00:00-04:00  wall clock
after - before                                    # timedelta(days=1)          same tzinfo
after.astimezone(UTC) - before.astimezone(UTC)    # timedelta(seconds=82800)   23 real hours
(before.astimezone(UTC) + timedelta(hours=24)).astimezone(NY)
                                                  # 2026-03-08T13:00:00-04:00  24 real hours
```

## How it works
1. **Naive or aware.** `date` objects are always naive; a `datetime` or `time` is aware when `utcoffset()` does not return `None` ✅[^datetime]. An aware object represents a specific moment; a naive one does not say whether it is UTC, local time or something else ✅[^datetime]. For `datetime(2026, 11, 24, 9, 30)`, `tzinfo` and `utcoffset()` are both `None`; with `tzinfo=NY`, `utcoffset()` is `timedelta(days=-1, seconds=68400)` (minus five hours) and `tzname()` is `'EST'` ✅[^lab].
2. **Getting the current time.** `datetime.now()` returns local time with `tzinfo` `None`; `datetime.now(tz)` converts to `tz` and returns an aware value; `now()` is preferred over `today()` and `utcnow()` ✅[^datetime]. `utcnow()` also returns a naive value, is deprecated since 3.12, and the docs recommend `datetime.now(timezone.utc)` because many methods treat naive values as local time ✅[^datetime] ✅[^whatsnew312]. In 3.15.2 it warns `DeprecationWarning: datetime.datetime.utcnow() is deprecated and scheduled for removal in a future version` ✅[^lab]. `datetime.UTC` (3.11) is an alias of `timezone.utc` ✅[^datetime].
3. **Two kinds of zone.** `datetime.timezone` is a fixed offset from UTC; `zoneinfo.ZoneInfo(key)` implements the IANA (Internet Assigned Numbers Authority) time zone database, whose use the `datetime` docs recommend ✅[^datetime]. `ZoneInfo` datetimes work with datetime arithmetic and handle DST transitions with no further intervention ✅[^zoneinfo]; in practice the result of an addition carries the offset in force at its new wall time, such as `-04:00` after the March jump ✅[^lab]. Calls with the same key return the same object (`ZoneInfo.no_cache()` bypasses that) ✅[^zoneinfo]; an unknown key raises `ZoneInfoNotFoundError`, a subclass of `KeyError`, and a key such as `'../etc/passwd'` raises `ValueError` ✅[^zoneinfo] ✅[^lab].
4. **Where zone data comes from.** `zoneinfo` ships no data: it uses the system time zone database, falls back to the first-party `tzdata` package from PyPI (the Python Package Index), and raises `ZoneInfoNotFoundError` for every key when neither is present ✅[^zoneinfo]. Some systems, notably Windows, have no IANA database, so cross-platform projects are advised to depend on `tzdata` ✅[^zoneinfo]. The search path is `zoneinfo.TZPATH`, which the `PYTHONTZPATH` environment variable can override ✅[^zoneinfo]. In the lab it was `('/usr/share/zoneinfo', '/usr/lib/zoneinfo', '/usr/share/lib/zoneinfo', '/etc/zoneinfo')`, `tzdata` was not installed, and `America/New_York` still loaded from the system data ✅[^lab].
5. **Attach versus convert.** `dt.replace(tzinfo=tz)` attaches a zone without changing the date and time fields; `dt.astimezone(tz)` returns the same UTC moment expressed in `tz`; on a naive `dt`, `astimezone()` assumes the system time zone ✅[^datetime]. 09:30 in New York became `'2026-11-24T14:30:00+00:00'` in UTC and `'2026-11-24T21:30:00+07:00'` in `Asia/Ho_Chi_Minh` ✅[^lab].
6. **Arithmetic is wall-clock arithmetic.** `datetime + timedelta` keeps the input's `tzinfo` and does no time zone adjustment, even for aware objects ✅[^datetime]. Subtracting two datetimes that are both naive, or aware with the same `tzinfo`, ignores the `tzinfo` too; only different `tzinfo` objects make Python subtract as if both were converted to UTC; mixing naive and aware raises `TypeError` ✅[^datetime]. That is why the Artifact shows `timedelta(days=1)` for 23 real hours, and why `timedelta(hours=24)` gave the same `12:00-04:00` as `timedelta(days=1)` ✅[^lab]. At the November fall-back the same rule stretches the day: 31 October 12:00 plus one day is `2026-11-01T12:00:00-05:00`, 25 real hours later ✅[^lab]. For elapsed (absolute) time, convert to UTC first.
7. **The repeated hour and `fold`.** When clocks go back, one wall time happens twice; `fold=0` means the earlier of the two moments and `fold=1` the later ✅[^datetime]. With `ZoneInfo`, `fold=0` uses the offset from before the transition and `fold=1` the offset after, and converting from another zone sets `fold` correctly ✅[^zoneinfo]. On 1 November 2026, `01:30` in New York gave `-04:00 EDT` with `fold=0` and `-05:00 EST` with `fold=1`; `06:30 UTC` converted to `01:30-05:00` with `fold=1` ✅[^lab]. Datetimes that differ only in `fold` compare equal ✅[^datetime], so the two `01:30` values were `==` and subtracted to `timedelta(0)`, although they are an hour apart in UTC ✅[^lab].
8. **The skipped hour.** On 8 March 2026, `02:30` does not exist in New York. The lab gave `02:30-05:00` with `fold=0` (the offset from before the jump) and `02:30-04:00` with `fold=1`; a round trip through UTC normalised the first to `03:30-04:00` ✅[^lab].
9. **Comparisons.** Naive and aware datetimes are never equal, and ordering them raises `TypeError` (equality stopped raising in 3.3) ✅[^datetime]; for example `TypeError: can't compare offset-naive and offset-aware datetimes` ✅[^lab]. Aware values with different `tzinfo` compare as UTC instants; with the same `tzinfo` the base fields are compared and `fold` is ignored ✅[^datetime].
10. **`date` versus `datetime`.** `datetime` is a subclass of `date` (`isinstance(datetime(2026, 1, 1), date)` is `True`) ✅[^lab], yet a plain `date` is never equal to a `datetime`, and ordering the two raises `TypeError` ✅[^datetime]. Use `dt.date()` to compare calendar days. `date + timedelta` ignores the `seconds` and `microseconds` parts ✅[^datetime], so `date(2026, 1, 1) + timedelta(hours=36)` is `date(2026, 1, 2)` ✅[^lab].
11. **ISO 8601 in and out.** `fromisoformat()` accepts most ISO 8601 formats since 3.11, except fractional hours and minutes, reduced precision (`YYYY-MM`), extended years and ordinal dates ✅[^datetime] ✅[^whatsnew311]. It parsed `'2026-11-24T02:30:00Z'` to `timezone.utc`, the basic form `'20261124T093000'`, and rejected `'2026-11'` with `ValueError: Invalid isoformat string` ✅[^lab]. `isoformat()` takes `sep` and `timespec`; with microseconds it prints `'2026-11-24T09:30:00.000500'` ✅[^lab]. The string keeps only the offset: parsing `aware.isoformat()` gives an equal value whose `tzinfo` is a fixed `timezone(timedelta(days=-1, seconds=68400))`, not `America/New_York` ✅[^lab].
12. **`strftime` and `strptime`.** `strftime` formats with `%` codes, and so do f-strings (`f"{aware:%d %b %Y}"` gave `'24 Nov 2026'`) ✅[^datetime] ✅[^lab]. For a naive value `%z` and `%Z` become empty strings ✅[^datetime]. `strptime` returns a naive value unless the format has `%z`, which produces an aware one with a `timezone` ✅[^datetime]. In 3.15 `%d` without a year raises `ValueError`, because the default year 1900 is not a leap year and `02/29` could never parse; add a leap year such as `1984` to the input and format ✅[^datetime] ✅[^whatsnew315]. The `datetime.date.strptime()` and `datetime.time.strptime()` class methods arrived in 3.14 ✅[^whatsnew314].
13. **`timedelta`.** It stores only days, seconds and microseconds, normalised so `0 <= seconds < 86400` ✅[^datetime]; `timedelta(hours=-5)` is `timedelta(days=-1, seconds=68400)` and prints as `-1 day, 19:00:00` ✅[^datetime] ✅[^lab]. `.seconds` is not the total: for `timedelta(seconds=11235813)`, `.days, .seconds` are `130, 3813` and `.total_seconds()` is `11235813.0` ✅[^datetime] ✅[^lab]. Dividing two timedeltas gives a float (`timedelta(days=1) / timedelta(hours=1)` is `24.0`) and `//` an int ✅[^lab].
14. **Clocks for durations.** `time.time()` is seconds since the epoch and can return a lower value than a previous call if the system clock is set back ✅[^time]. `time.monotonic()` cannot go backwards and is not affected by system clock updates; `time.perf_counter()` is the highest-resolution clock for short durations, includes sleep, and on CPython uses the same clock as `monotonic()`; `time.process_time()` counts the process's CPU (processor) time and excludes sleep ✅[^time]. Only differences between two calls of these three mean anything ✅[^time]. The lab's `time.get_clock_info()` reported `time` as adjustable (`clock_gettime(CLOCK_REALTIME)`, 1 µs resolution) and `monotonic` and `perf_counter` as `mach_absolute_time()`, not adjustable, about 42 ns resolution; across `time.sleep(0.2)`, `perf_counter` advanced 0.2 s and `process_time` less than 0.05 s ✅[^lab].

## Worked example
A daily 09:00 stand-up in New York, generated across the DST start of 8 March 2026 and stored as ISO strings, all measured in the lab ✅[^lab].

| Step | Code | Result |
|---|---|---|
| 1 | `occ = [datetime(2026, 3, 6, 9, 0, tzinfo=NY) + timedelta(days=i) for i in range(4)]` | Local: `Fri 06 09:00 EST`, `Sat 07 09:00 EST`, `Sun 08 09:00 EDT`, `Mon 09 09:00 EDT` |
| 2 | `[o.astimezone(UTC) for o in occ]` | UTC: `06 14:00`, `07 14:00`, `08 13:00`, `09 13:00` |
| 3 | Gaps between consecutive UTC values | `1 day, 0:00:00`, `23:00:00`, `1 day, 0:00:00` |
| 4 | Gaps between the same-zone values | `1 day, 0:00:00` three times (wall-clock subtraction) |
| 5 | `stored = occ[1].isoformat()` | `'2026-03-07T09:00:00-05:00'` |
| 6 | `back = datetime.fromisoformat(stored)`; `back.tzinfo` | `UTC-05:00`: a fixed offset, the zone name is gone |
| 7 | `back + timedelta(days=1)` | `2026-03-08T09:00:00-05:00`, which is 10:00 EDT in New York: one hour late |
| 8 | `back.astimezone(NY) + timedelta(days=1)` | `2026-03-08T09:00:00-04:00`: correct |

Lesson: wall-clock arithmetic is right for "same local time tomorrow" only while the value carries the real zone. Store the zone key (`'America/New_York'`) next to the timestamp, or store UTC and convert at display time.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `naive == aware` | `False`, no error ✅[^lab] | Equality between naive and aware never raises since 3.3; ordering does ✅[^datetime] |
| `aware - naive` | `TypeError: can't subtract offset-naive and offset-aware datetimes` ✅[^lab] | Subtraction needs both naive or both aware ✅[^datetime] |
| `date(2026, 1, 1) == datetime(2026, 1, 1)` | `False`; `<` raises `TypeError` ✅[^lab] | A plain `date` is never equal to a `datetime` ✅[^datetime] |
| `strptime("02/29", "%m/%d")` | `ValueError: Day of month directive '%d' may not be used without a year directive...` ✅[^lab] | Changed in 3.15 to avoid the leap-year bug ✅[^whatsnew315] |
| `strptime` with `%e` and no year | Deprecated | Pending removal in 3.17 ✅[^whatsnew315] |
| `datetime.fromtimestamp(ts)` without `tz` | Naive local time | Pass `tz=UTC` for an aware value ✅[^datetime] |
| `timedelta.seconds` used as a total | Wrong for anything over a day | It holds 0–86,399 only; use `total_seconds()` ✅[^datetime] |
| A system with no IANA data (notably Windows) and no `tzdata` | `ZoneInfoNotFoundError` for every key | `zoneinfo` ships no data of its own ✅[^zoneinfo] |
| `ZoneInfo.clear_cache()` or `no_cache()` | Two objects for one key | Can change datetime semantics in surprising ways; use only when needed ✅[^zoneinfo] |
| Fixed `timezone(timedelta(hours=-5))` | Never ambiguous, never follows DST | Fixed-offset `tzinfo` classes have no wall-time ambiguity ✅[^datetime] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Store UTC (`datetime.now(UTC)`), convert for display | One unambiguous timeline; plain subtraction gives real elapsed time | Local "same time tomorrow" needs the zone again at display time |
| Store local time plus the zone key | Recurring local events stay at 09:00 across DST | Needs `ZoneInfo` data wherever it is read; gaps and folds to handle |
| ISO strings with an offset | Readable and parseable by `fromisoformat()` | The offset is not the zone: arithmetic after parsing ignores DST rules ✅[^lab] |
| `time.perf_counter()` for durations | Highest resolution, never goes back on CPython ✅[^time] | Its value alone means nothing; only differences ✅[^time] |
| `time.time()` for durations | Same number as a timestamp | Can go backwards after a clock change ✅[^time] |

## Takeaways
- Keep datetimes aware: `datetime.now(UTC)` instead of `datetime.now()` or `datetime.utcnow()`. [rule-candidate]
- Use `zoneinfo.ZoneInfo` for named zones, and add `tzdata` as a dependency when the code must also run on Windows. [rule-candidate]
- Convert to UTC before computing elapsed time; add `timedelta` in the local zone only for "same wall time" schedules.
- After `fromisoformat()`, re-attach the real zone with `astimezone(ZoneInfo(key))` before doing local arithmetic.
- Always include a year in `strptime` formats that parse a day of the month. [rule-candidate]
- Use `total_seconds()`, never `.seconds`, for the length of a `timedelta`. [rule-candidate]
- Measure durations with `time.perf_counter()` or `time.monotonic()`, never `time.time()`. [rule-candidate]

## Verification status
- Verified: 83 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `python/python-lab-setup.md` — the CPython 3.15.2 lab (macOS 26.1, arm64) where every behaviour marked with this note ran on 2026-11-24. [^lab]
- [`datetime` — Basic date and time types](https://docs.python.org/3/library/datetime.html) — Python Software Foundation, living. Rank 1. Backs: naive and aware objects; `now`, `utcnow`, `UTC`; `timezone`; `replace` and `astimezone`; arithmetic and comparison rules; `fold`; `date` versus `datetime`; `fromisoformat`; `strftime`/`strptime` behaviour; `timedelta` normalisation. [^datetime]
- [`zoneinfo` — IANA time zone support](https://docs.python.org/3/library/zoneinfo.html) — Python Software Foundation, living. Rank 1. Backs: data sources and `tzdata`; `TZPATH` and `PYTHONTZPATH`; the cache; `fold` handling; `ZoneInfoNotFoundError`. [^zoneinfo]
- [`time` — Time access and conversions](https://docs.python.org/3/library/time.html) — Python Software Foundation, living. Rank 1. Backs: `time()`, `monotonic()`, `perf_counter()`, `process_time()`. [^time]
- [What's New In Python 3.11](https://docs.python.org/3/whatsnew/3.11.html) — Python Software Foundation, 2022. Rank 1. Backs: `fromisoformat()` parses most ISO 8601 formats. [^whatsnew311]
- [What's New In Python 3.12](https://docs.python.org/3/whatsnew/3.12.html) — Python Software Foundation, 2023. Rank 1. Backs: `utcnow()` and `utcfromtimestamp()` deprecated. [^whatsnew312]
- [What's new in Python 3.14](https://docs.python.org/3/whatsnew/3.14.html) — Python Software Foundation, 2025. Rank 1. Backs: `date.strptime()` and `time.strptime()` added. [^whatsnew314]
- [What's new in Python 3.15](https://docs.python.org/3/whatsnew/3.15.html) — Python Software Foundation, 2026. Rank 1. Backs: `%d` without a year raises; `%e` without a year pending removal in 3.17. [^whatsnew315]

## Related
- `python/standard-library/standard-library-tour.md` — the other modules of the tutorial's standard-library tour.
- `python/tooling/testing-debugging-and-profiling.md` — `timeit` and profilers, built on these clocks.
- `python/fundamentals/objects-names-and-types.md` — why `datetime` objects are immutable values you rebind, not change.
