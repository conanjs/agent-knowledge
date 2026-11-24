---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "DateTime, DateOnly, TimeOnly and Time.Compare: Go ≥ 1.20", "vet check for time.Since in defer: Go ≥ 1.22", "golang:1.27.4 image (Debian 13) for the time zone runs"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, time, monotonic-clock, duration, time-zone, tzdata, layout, rfc3339, parse, json]
ranked-sources: true
---

# Time, durations and clocks

## Summary
**TL;DR:** A `time.Time` from `time.Now()` carries two readings: a wall clock, for telling the time, and a monotonic clock, for measuring it. Comparisons and subtraction use the monotonic reading when both values have one, so `time.Since(start)` stays right even if the system clock is reset; `UTC`, `In`, `Round`, `Truncate`, `AddDate` and every serialized form drop it. Compare instants with `t.Equal(u)`, never `==`, which also compares the location and the monotonic reading. A `Duration` is an `int64` count of nanoseconds. Layouts are written as the reference time `Mon Jan 2 15:04:05 MST 2006`; `Parse` assumes UTC (Coordinated Universal Time) when the text has no zone, `ParseInLocation` the zone you give; and on a machine without a time zone database `LoadLocation` fails unless the program imports `time/tzdata`.
**Use this when:** you measure elapsed time, compare times or use them as map keys, format or parse dates, convert between time zones, ship a Go binary in a minimal container image, or store times as JSON (JavaScript Object Notation).
**Not this doc:** timer and ticker channels inside `select`, and their Go 1.23 and 1.27 changes → `go/concurrency/goroutines-and-channels.md`; deadlines carried by a context → `go/concurrency/context-and-cancellation.md`; `omitempty` versus `omitzero` on a `time.Time` field → `go/standard-library/io-and-encoding-json.md`; random durations for jitter → `go/standard-library/random-numbers-and-uuids.md`.

## Problem
The wall clock is subject to changes for clock synchronization ✅[^2], so an elapsed time computed from two wall readings can be wrong. A test that writes a `time.Time` to JSON and reads it back fails with `==` although `Equal` says both are the same instant ✅[^1]. A layout written as `"YYYY-MM-DD"` prints `YYYY-MM-DD` as it is, not a date ✅[^1]. A service that loads `"Asia/Tokyo"` on a laptop fails with `unknown time zone Asia/Tokyo` in a container without zone files ✅[^1]. And a weekly meeting computed with `Add(7*24*time.Hour)` moves by an hour when daylight saving time starts ✅[^1].

## Mental model
**Analogy:** a `Time` from `time.Now()` is a photo stamped with two things: the date and time on the office wall clock, which anyone may reset, and the reading of a stopwatch started when the program began, which nobody can reset and which means nothing outside this process. Read the wall clock to tell the time; read the stopwatch to measure it. Converting the photo to another time zone, rounding it or mailing it (serializing) keeps only the wall-clock stamp.

**Artifact:** the stopwatch reading is visible in `String()` as `m=±seconds` (Go 1.27.4 ✅[^1]):
```go
start := time.Now()
time.Sleep(20 * time.Millisecond)
fmt.Println(time.Now())          // 2026-11-24 15:36:45.333739323 +0000 UTC m=+0.022950721
fmt.Println(start.Round(0))      // 2026-11-24 15:36:45.311026064 +0000 UTC     (stripped)
fmt.Println(start.Add(time.Second)) // 2026-11-24 15:36:46.311026064 +0000 UTC m=+1.000237420
```

## How it works
**Wall and monotonic readings.**
1. `time.Now()` returns a `Time` with both readings; later time-telling operations use the wall reading, and time-measuring ones — comparisons and subtraction — use the monotonic reading ✅[^2]. So `t.Sub(start)`, `time.Since(start)`, `time.Until(deadline)` and `time.Now().Before(deadline)` are robust against wall-clock resets ✅[^2].
2. **Kept or stripped.** `t.Add(d)` adds `d` to both readings ✅[^2]. `AddDate`, `Round` and `Truncate` are wall-time computations, and `In`, `Local` and `UTC` change how the wall time is read, so all six strip the monotonic reading; `t.Round(0)` is the canonical way to strip it ✅[^2]. If only one of two times has a monotonic reading, `After`, `Before`, `Equal`, `Compare` and `Sub` fall back to the wall readings ✅[^2].
3. **Never outside the process.** The serialized forms (`GobEncode`, `MarshalBinary`, `MarshalJSON`, `MarshalText`) omit the monotonic reading, `Format` has no layout element for it, and `Date`, `Parse`, `ParseInLocation`, `Unix` and the unmarshalers create times without one ✅[^2]. It is not part of a `Duration` or of `t.Unix()` ✅[^2].
4. **Sleep.** On some systems the monotonic clock stops while the computer sleeps, so `Sub`, `Since` and friends may then miss the time spent asleep ✅[^2].

**Comparing times.**
1. `==` compares the instant, the `Location` and the monotonic reading; `t.Equal(u)` compares only the instant, also when only one side has a monotonic reading, so most code should use `Equal` ✅[^2]. `t.Compare(u)` (Go 1.20) returns -1, 0 or +1 ✅[^2].
2. Before using `Time` as a map or database key, give all values the same location (`UTC()` or `Local()`) and strip the monotonic reading with `Round(0)` ✅[^2].
3. In the lab: `a == a.Round(0)` was `false` and `Equal` `true`; `a.Round(0) == a.UTC()` was `false` (location `Local` against `UTC`, though both showed `+0000 UTC`) and `Equal` `true`; 12:30 UTC against 20:30 at UTC+8 gave `==` `false`, `Equal` `true`, `Compare` `0` ✅[^1].
4. Store and pass `time.Time` as a value, not a pointer; its zero value is January 1, year 1, 00:00:00 UTC, which `IsZero` detects ✅[^2].

**Durations.**
1. `Duration` is an `int64` count of nanoseconds, so the largest is about 290 years ✅[^2]; in the lab `time.Duration(math.MaxInt64)` printed `2562047h47m16.854775807s`, about 292.3 years ✅[^1].
2. The constants run from `Nanosecond` to `Hour`; there is no `Day`, to avoid confusion across daylight saving changes ✅[^2]. Multiply to convert a count: `time.Duration(n) * time.Second`; divide to count units: `int64(d / time.Millisecond)` ✅[^2]. In the lab `time.Duration(10)` alone printed `10ns` ✅[^1].
3. `String` prints forms like `72h3m0.5s`, uses a smaller unit below one second, and prints the zero duration as `0s` ✅[^2]; the lab printed `1h2m0.3s`, `300ms`, `1.5ms`, `0s` and `-1m30s` ✅[^1]. `ParseDuration` reads the same form with units `ns`, `us` (or `µs`), `ms`, `s`, `m` and `h` ✅[^2]; `"1d"` failed with `time: unknown unit "d" in duration "1d"` ✅[^1].
4. `Since(t)` is short for `time.Now().Sub(t)` and `Until(t)` for `t.Sub(time.Now())` ✅[^2]. In `defer log.Println(time.Since(t))` the argument is evaluated at the `defer` line, not at return; since Go 1.22 `go vet` reports it ✅[^5]. In the lab vet printed `call to time.Since is not deferred`, and the program logged between `took 41ns` and `took 125ns` over six runs for a function that slept 10 ms ✅[^1].

**Locations and the time zone database.**
1. A `Location` maps instants to the zone in use at that moment; `In`, `Local` and `UTC` change only the zone used to read a `Time`, never the instant ✅[^2]. `FixedZone(name, offsetSeconds)` builds a zone with one fixed offset ✅[^2].
2. On Unix, `Local` reads the `TZ` environment variable: unset means `/etc/localtime`, `TZ=""` means UTC, and `TZ=Name` a file in the system zone directory ✅[^2]. In the `golang:1.27.4` image `/etc/localtime` points to `Etc/UTC`, so `Local` was UTC; with `TZ=Asia/Ho_Chi_Minh` the zone was `+07` with offset 25200 seconds ✅[^1].
3. `LoadLocation("")` and `LoadLocation("UTC")` return UTC, `"Local"` returns `Local`, and any other name is looked up in the IANA (Internet Assigned Numbers Authority) time zone database, in this order: the directory or zip named by `ZONEINFO`, the system location on Unix, `$GOROOT/lib/time/zoneinfo.zip`, then the `time/tzdata` package if it was imported ✅[^2].
4. `time/tzdata` embeds the database, which the program uses only when it finds no zone files on the system; it adds about 450 KB (kilobytes), belongs in the `main` package rather than a library, and is imported automatically by `go build -tags timetzdata` ✅[^3].
5. In the lab, with `/usr/share/zoneinfo` and `$GOROOT/lib/time` hidden: the plain binary got `unknown time zone Asia/Tokyo`, and `TZ=Asia/Ho_Chi_Minh` silently left `Local` at UTC; the binary that imported `time/tzdata`, and the one built with `-tags timetzdata`, loaded `Asia/Tokyo` and honoured `TZ` ✅[^1]. The import grew the binary from 2,366,056 to 2,762,968 bytes, 396,912 bytes more ✅[^1].

**Formatting and parsing.**
1. A layout is the reference time `01/02 03:04:05PM '06 -0700` — `Mon Jan 2 15:04:05 MST 2006` — written the way you want your output to look ✅[^2]. The pieces: year `2006`/`06`; month `Jan`/`January`/`01`/`1`; day `02`/`_2`/`2`; weekday `Mon`/`Monday`; hour `15`/`03`/`3`; minute `04`/`4`; second `05`/`5`; `PM`; zone `MST`, `-0700`, `-07:00`, or `Z07:00` (prints `Z` for UTC); fractions `.000` (fixed) or `.999` (trailing zeros removed) ✅[^2]. Any other text is copied as is ✅[^2].
2. Predefined layouts include `RFC3339` (`2006-01-02T15:04:05Z07:00`), `RFC3339Nano`, `Kitchen` and, since Go 1.20, `DateTime` (`2006-01-02 15:04:05`), `DateOnly` and `TimeOnly` ✅[^2] ✅[^4]. The docs prefer `RFC3339` for new protocols, and warn that `RFC3339Nano` drops trailing zeros and so may not sort correctly as text ✅[^2].
3. `Parse(layout, value)` returns UTC when the value has no zone. A numeric offset that matches the local zone gives `Local`; any other offset gives a made-up location fixed at that offset; an unknown zone abbreviation gives a made-up location with that name and a zero offset ✅[^2]. Two-digit years 69–99 mean 19xx and 00–68 mean 20xx, and years must be 0000–9999 ✅[^2].
4. `ParseInLocation(layout, value, loc)` differs twice: a value without zone is read in `loc`, and an offset or abbreviation is matched against `loc` instead of `Local` ✅[^2].
5. In the lab (date 2026-03-05 14:07:09): `Parse(time.DateTime, …)` gave `+0000 UTC`; `ParseInLocation` with `Asia/Singapore` gave `+0800 +08`, an instant 8 hours earlier; `Parse` of `14:07 PST` gave `14:07:00 +0000 PST`, an instant of 14:07 UTC that is off by the zone's real offset ✅[^1]; `"2026-02-30"` failed with `day out of range`, while `time.Date(2026, 10, 32, …)` normalized to `2026-11-01` ✅[^1], as `Date` documents for October 32 ✅[^2].

**Timers in brief.** `Sleep(d)` pauses the goroutine for at least `d`; `After(d)` is `NewTimer(d).C`; `NewTicker(d)` panics if `d <= 0` and drops ticks for slow receivers; `AfterFunc(d, f)` runs `f` in its own goroutine, its `Timer.C` is `nil`, and `Stop` cancels the call ✅[^2]. Since Go 1.23 the garbage collector can recover timers and tickers that nothing references, even unstopped ones ✅[^2]. Timer resolution is about 1 ms on Unix ✅[^2]. In the lab `Stop` on a pending `AfterFunc` returned `true`, then `false`, and a 10 ms ticker fired at about 10, 20 and 30 ms ✅[^1].

**JSON form.** `MarshalJSON` writes a quoted RFC 3339 string with sub-second precision and fails for a time it cannot represent that way, such as a year outside 0–9999; `UnmarshalJSON` accepts only RFC 3339 ✅[^2]. The stored form keeps the zone offset but not the location name, so daylight saving information is lost ✅[^2]. In the lab a time with zone `EST` came back with an empty location name and offset `-05:00`, `"2026-11-24 09:00:00"` failed with `cannot parse " 09:00:00" as "T"`, and year 10000 failed with `year outside of range [0,9999]` ✅[^1].

## Worked example
A user in New York books a weekly meeting at 09:30 on Thursday 5 March 2026; daylight saving time starts there on Sunday 8 March. The program stores the next meeting as UTC JSON and shows it back in the user's zone (Go 1.27.4 ✅[^1]):

```go
ny, _ := time.LoadLocation("America/New_York")
first, _ := time.ParseInLocation("2006-01-02 15:04", "2026-03-05 09:30", ny)
next := first.AddDate(0, 0, 7)                        // same wall time, one week later
out, _ := json.Marshal(Meeting{"standup", next.UTC()}) // store UTC
var m Meeting
_ = json.Unmarshal(out, &m)
fmt.Println(m.At.In(ny).Format("Mon 2 Jan 15:04 MST"))
now := time.Date(2026, 3, 11, 12, 0, 0, 0, time.UTC)   // a fixed "now"
fmt.Println(m.At.Sub(now))
```

| Step | Call | Output |
|---|---|---|
| 1 | `ParseInLocation` reads the typed wall time in New York | `2026-03-05 09:30:00 -0500 EST` |
| 2 | `first.AddDate(0, 0, 7)` keeps 09:30 local across the change | `2026-03-12 09:30:00 -0400 EDT` |
| 3 | `first.Add(7*24*time.Hour)` adds exactly 168 hours | `2026-03-12 10:30:00 -0400 EDT` — one hour late |
| 4 | `json.Marshal` of the UTC value | `{"title":"standup","at":"2026-03-12T13:30:00Z"}` |
| 5 | Decode, then `In(ny).Format(...)` | `Thu 12 Mar 09:30 EDT` |
| 6 | `m.At.Sub(now)` | `25h30m0s` |

`AddDate` is a wall-time computation ✅[^2], which is what a calendar needs; `Add` counts elapsed nanoseconds, which is what a timeout needs.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `got == want` after a JSON or database round trip | `false` although both print the same instant ✅[^1] | The decoded value has no monotonic reading and may have another `Location` ✅[^2]; use `Equal` |
| `Time` as a map key | Equal instants land in different entries | `==` semantics; normalize with `UTC()` and `Round(0)` first ✅[^2] |
| Layout `"YYYY-MM-DD"` or `"2006-02-01"` | Prints `YYYY-MM-DD`; day and month swapped (`2026-05-03`) ✅[^1] | Only reference-time pieces are recognized; `01` is the month ✅[^2] |
| `Parse` with an abbreviation such as `PST` that `Local` does not know | Offset taken as zero ✅[^1] | Fabricated location with zero offset ✅[^2]; use numeric offsets or `ParseInLocation` |
| Minimal (`scratch`-style) image without zone files | `unknown time zone …`; `TZ` ignored ✅[^1] | No database to search ✅[^2]; import `time/tzdata` in `main` ✅[^3] |
| `defer log.Println("took", time.Since(t))` | Logs a near-zero duration ✅[^1] | Arguments are evaluated at the `defer`; vet reports it since Go 1.22 ✅[^5] |
| Laptop sleeps during a measurement | `Since` can be short | The monotonic clock may stop during sleep ✅[^2] |
| `time.Duration(n)` where `n` is meant as seconds | `10ns` instead of `10s` ✅[^1] | The unit is the nanosecond ✅[^2]; multiply by `time.Second` |
| Parsing a leap second (`23:59:60`) | Error | Not representable by `Time` ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Store UTC as RFC 3339 text | The format the docs prefer for new protocols ✅[^2] | Loses the user's zone name; keep it separately ✅[^2] |
| Store wall time plus an IANA zone name | Recurring events keep their local time across daylight saving changes ✅[^1] | Needs the zone database wherever it is read ✅[^2] |
| Unix seconds or milliseconds (`t.Unix()`, `t.UnixMilli()`) | A plain integer count since 1 January 1970 UTC ✅[^2] | No zone name or offset; the reader must know the unit |
| `import _ "time/tzdata"` | Works in any image ✅[^1] | About 450 KB larger binary ✅[^3] (397 KB in the lab ✅[^1]) |

## Takeaways
- Compare `time.Time` values with `Equal`, `Before`, `After` or `Compare`, never `==`. [rule-candidate]
- Measure with `start := time.Now()` and `time.Since(start)`; never subtract `Unix()` values to time an operation. [rule-candidate]
- Write layouts from the reference time `2006-01-02 15:04:05`, preferably the named constants (`time.RFC3339`, `time.DateTime`). [rule-candidate]
- Parse user-entered local times with `ParseInLocation`, and add calendar periods with `AddDate`, not `Add`. [rule-candidate]
- Import `time/tzdata` in `main` when the program loads named zones and may run in a minimal container image. [rule-candidate]
- Wrap `time.Since` in a closure inside `defer`: `defer func() { log.Println(time.Since(t)) }()`.

## Verification status
- Verified: 84 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24: monotonic readings in `String`, `==` against `Equal`, `Duration` printing and parsing, layouts, `Parse` and `ParseInLocation`, `TZ` and `LoadLocation` with zone files present and hidden (tmpfs mounts over `/usr/share/zoneinfo` and `/usr/local/go/lib/time`), `time/tzdata` and `-tags timetzdata`, `AddDate` across a daylight saving change, `AfterFunc` and `Ticker`, JSON round trips, and the vet `time.Since` check. [^1]
- [time package](https://pkg.go.dev/time) — Go team, living. Rank 1. Backs: wall and monotonic clocks and which operations keep or strip them, `==` versus `Equal`, `Compare`, map-key advice, `Duration` and its constants and `String`, `ParseDuration`, `Since`/`Until`, `Location`, `Local` and `TZ`, `LoadLocation` search order, layouts and constants, `Parse` and `ParseInLocation` zone rules, `Date` normalization, timers, resolution, JSON methods. [^2]
- [time/tzdata package](https://pkg.go.dev/time/tzdata) — Go team, living. Rank 1. Backs: embedded database used as a fallback, about 450 KB, import from `main`, `-tags timetzdata`. [^3]
- [Go 1.20 Release Notes](https://go.dev/doc/go1.20) — Go team, 2023. Rank 1. Backs: the `DateTime`, `DateOnly` and `TimeOnly` layout constants. [^4]
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22) — Go team, 2024. Rank 1. Backs: vet reports a non-deferred `time.Since` inside a `defer` statement. [^5]

## Related
- `go/concurrency/goroutines-and-channels.md` — `select` with `time.After`, and the unbuffered timer channels of Go 1.23 and 1.27.
- `go/concurrency/context-and-cancellation.md` — `context.WithTimeout` and `WithDeadline`, built on these clocks.
- `go/standard-library/io-and-encoding-json.md` — `omitzero` for a zero `time.Time` field.
- `go/standard-library/random-numbers-and-uuids.md` — `rand.N` for random durations; version 7 UUIDs carry a Unix millisecond timestamp.
- `go/standard-library/log-and-slog.md` — how slog's handlers print the record time.
- `go/learning-path.md`
