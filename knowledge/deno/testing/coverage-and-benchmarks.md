---
schema: knowledge-doc/v1
type: concept
topic: deno/testing
status: verified
applies-to: ["Deno 2.9.8"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, coverage, deno-coverage, lcov, branch-coverage, line-coverage, coverage-threshold, deno-bench, benchmark, baseline, percentiles]
ranked-sources: true
---

# Coverage and benchmarks in Deno: `deno coverage` and `deno bench`

## Summary
**TL;DR:** `deno test --coverage` has V8 record which code ran and writes one JSON (JavaScript Object Notation) profile per module into `coverage/` (or the folder you name, or `DENO_COVERAGE_DIR`); in Deno 2.9 it then prints a Branch / Function / Line table and writes `lcov.info` and an HTML (web page) report into the same folder. `deno coverage <dir>` rebuilds those reports from the profiles, with `--detailed`, `--lcov`, `--html`, regex `--include`/`--exclude` and a `--threshold` that fails the command. A line counts as covered when any part of it ran, a branch only when that side ran, so `total > 100 ? 0 : 5` can be a covered line with half its branches missed. `deno bench` runs `Deno.bench` cases from `*_bench.ts`-style files and prints average time per iteration, iterations per second, min…max and the p75/p99/p995 percentiles; cases sharing a `group` with one `baseline` get a "summary" ratio.
**Use this when:** setting up or reading a coverage report, gating continuous integration (CI) on coverage, or timing two implementations against each other with `deno bench`.
**Not this doc:** writing the tests themselves → `deno/testing/testing-and-mocking.md`; how to run a benchmark you can trust (dead-code elimination, warm-up, noise) → `performance/measurement/benchmarking-methodology.md`; what p99 means → `performance/fundamentals/latency-percentiles-and-tail.md`; CPU profiles and `--inspect` → `deno/advanced/debugging-profiling-and-telemetry.md`.

## Problem
- A report that reads 100 % lines can still hide a branch no test took.
- Profiles collected with `--coverage-raw-data-only` pile up across runs, so a deleted or renamed file keeps skewing the merged numbers until the folder is cleaned; a plain `deno test --coverage` instead empties the folder, unrelated files included.
- Deno's own pages disagree on whether coverage can fail a build, and on the column order of the table.
- A benchmark of an empty function prints 630.6 picoseconds per iteration: it measured nothing, and the table does not warn about it.
- `n` and `warmup` look like exact iteration counts but did not behave as such in 2.9.8.

## Mental model
**Analogy:** coverage is a highlighter pen V8 runs over your source while the tests execute; the report counts highlighted lines, highlighted forks in the road (branches) and functions entered at least once. A benchmark is a stopwatch timing many laps of the same track: the average lap, the fastest and slowest, and the lap time that 99 % of laps beat.

**Artifact:** the lcov lines for one ternary, `return total > 100 ? 0 : 5;` on line 9, after a test that called only `shipping(150)` ✅[^run]:
```text
DA:9,1          ← line 9 ran: the line counts as covered
BRDA:9,2,0,0    ← one path of the branch on line 9: last number 0
BRDA:9,2,1,1    ← the other path: last number 1
```
The file's totals agree: `BRH:2` of `BRF:4` branch paths, but `LH:8` of `LF:12` lines with line 9 among the eight.

| Term | Analogy | Concrete artifact |
|---|---|---|
| Coverage profile | The raw highlighter strokes, before anyone counts them | `coverage/0d46dbd8-….json` ✅[^run], one JSON file per module ✅[^cov-guide] |
| Line coverage | Pages with any highlight on them | `DA:5,0` for the missed `return base;`; `LH:8` (lines hit) of `LF:12` (lines found) → 66.7 % ✅[^run] ✅[^cov-guide] |
| Branch coverage | Forks where each road was driven | `BRH:2` of `BRF:4` → 50.0 % ✅[^run] |
| Function coverage | Rooms entered at least once | `FNDA:0,unused` → 2 of 3 = 66.7 % ✅[^run] |
| lcov | A standard tally sheet other tools read | `deno coverage --lcov` output, `SF:` … `end_of_record` ✅[^run] |
| Threshold | A pass mark for the exam | `--threshold=80` → `error: Coverage threshold not met:` ✅[^run] |
| Ignore comment | Masking tape over a part of the page | `// deno-coverage-ignore-start` … `-stop` ✅[^cov-cli] |
| Iteration | One lap | one call of the bench `fn` |
| `time/iter (avg)`, `iter/s` | Average lap time; laps per second | `24.8 µs` and `40,290` for `Array.join` ✅[^run] |
| p75, p99, p995 | The lap time that 75 %, 99 %, 99.5 % of laps beat | `25.1 µs`, `118.4 µs`, `193.6 µs` ✅[^run] |
| Group and baseline | A heat of runners and the one everyone is compared to | `group: "concat", baseline: true` ✅[^bench-cli] |

## How it works
### Coverage: 3 actors
- **V8** — its job: record which code blocks ran, via its built-in coverage counters.
- **`deno test --coverage`** (or `deno run --coverage`) — its job: save V8's data and print a first report, via JSON profiles in the coverage folder.
- **`deno coverage`** — its job: turn profiles into reports, via include/exclude filters and an output format.

```text
[deno test --coverage — local]          [V8 — same process]       [deno coverage — local, later]
runs tests ───────────────────────────▶ counts blocks run
writes coverage/<uuid>.json × modules ◀─┘
prints table, writes coverage/lcov.info and coverage/html/
                                                                  reads coverage/*.json
                                                                  keeps URLs matching ^file:, drops test.(js|mjs|ts|jsx|tsx)
                                                                  prints table | --detailed | --lcov | --html
                                                                  --threshold → exit 1 below target
```
Nothing here leaves the machine.

1. **`deno test --coverage[=DIR]`:**
   - Collects V8's data into `DIR`, `coverage/` by default, also settable with `DENO_COVERAGE_DIR` ✅[^test-cli]; one JSON profile per module ✅[^cov-guide], two files in the run ✅[^run].
   - Prints the summary table and writes `lcov.info` and `html/index.html` into that folder: `Lcov coverage report has been generated at file:///lab/coverage/lcov.info` ✅[^run] ✅[^cov-guide]. `--coverage-raw-data-only` skips the reports ✅[^test-cli] ✅[^run].
   - Adds to what is already in the folder only with `--coverage-raw-data-only`: two such runs left 4 profiles. A run that writes reports first emptied the folder: it left only its own 2 profiles, did not merge the earlier ones into its table, and also deleted an unrelated `marker.txt` placed there ✅[^run]. `--clean` empties the folder before any run ✅[^test-cli].
   - `DENO_COVERAGE_DIR=envcov deno test`, with no `--coverage` flag, still wrote profiles; child Deno processes inherit the variable ✅[^run] ✅[^cov-guide]. `deno run --coverage=runcov main.ts` collects for a plain script ✅[^cov-guide] ✅[^run].
2. **`deno coverage [DIR]`:**
   - Selects files, via `--include` (default: local `file:` URLs) and `--exclude` (default: names ending `test.js`, `test.mjs`, `test.ts`, `test.jsx`, `test.tsx`); a file must match the first and not the second ✅[^cov-guide] ✅[^cov-cli]. In the run `price_test.ts` never appeared ✅[^run].
   - Prints the format asked for:

     | Flag | Output in 2.9.8 ✅[^run] |
     |---|---|
     | none | `\| price.ts  \|     50.0 \|       66.7 \|   66.7 \|` under `\| File \| Branch % \| Function % \| Line % \|` |
     | `--detailed` | `cover file:///lab/price.ts ... 66.667% (8/12)`, then each uncovered line: `   5 \|   return base;` |
     | `--lcov` | lcov on stdout; `--output=cov.lcov` writes a file ✅[^cov-cli] |
     | `--html` | `DIR/html/index.html` and one page per file, `price.ts.html` |
   - Fails below a target, via `--threshold=N`, applied to line, branch and function coverage ✅[^cov-cli]; `deno test --coverage --coverage-threshold=N` does the same in one step ✅[^test-cli]. Per-metric targets live in `deno.json` as `"coverage": { "thresholds": { "lines": 90, "branches": 80, "functions": 90 } }`, checked against the "All files" totals; the flag wins ✅[^cov-cli].
3. **Ignore comments**, written with `//` only: `// deno-coverage-ignore` (next line), `// deno-coverage-ignore-start` … `// deno-coverage-ignore-stop` (a block, branches included, no nesting), `// deno-coverage-ignore-file` ✅[^cov-cli]. A `windows`-only block wrapped in start/stop dropped out of the line count: `feature.ts ... 75.000% (3/4)` ✅[^run].

### Benchmarks: 3 actors
- **`deno bench`** — its job: collect bench files and run them, via the glob `{*_,*.,}bench.{ts, tsx, mts, js, mjs, jsx}` and the same permission flags as `deno run` ✅[^bench-cli].
- **`Deno.bench`** — its job: register one case, via a name, a function and options ✅[^api].
- **The bench runner** — its job: warm up, time many iterations, and report, via the table, a group summary or `--json` ✅[^bench-cli].

Options of `Deno.bench` ✅[^api]: `name`, `fn`, `ignore`, `only` (the run then fails: `error: Bench failed because the "only" option was used`, exit 1 ✅[^run]), `group`, `baseline` (the first one wins if a group has several), `n` (iterations), `warmup` (warm-up runs), `permissions` (default `"inherit"`), `sanitizeExit` (default `true`). `b.start()` and `b.end()` limit the timed part to the code between them ✅[^bench-cli].

A two-case group with a baseline, plus one case with setup excluded, run with `deno bench` ✅[^run]:
```ts
const parts = Array.from({ length: 1_000 }, (_, i) => `item${i}`);
Deno.bench({ name: "Array.join", group: "concat", baseline: true, fn: () => { parts.join(","); } });
Deno.bench({ name: "+= in a loop", group: "concat",
  fn: () => { let s = ""; for (const p of parts) s += p + ","; } });
Deno.bench("sort with setup excluded", (b) => {
  const data = Array.from({ length: 10_000 }, () => Math.random());
  b.start(); data.sort((x, y) => x - y); b.end();
});
```
```text
    CPU | unknown
Runtime | Deno 2.9.8 (aarch64-unknown-linux-gnu)

file:///lab/join_bench.ts

| benchmark                  | time/iter (avg) |        iter/s |      (min … max)      |      p75 |      p99 |     p995 |
| -------------------------- | --------------- | ------------- | --------------------- | -------- | -------- | -------- |
| sort with setup excluded   |          4.3 ms |         231.7 | (  2.0 ms …  16.2 ms) |   4.6 ms |  13.5 ms |  16.2 ms |

group concat
| Array.join                 |         24.8 µs |        40,290 | ( 11.6 µs …   3.9 ms) |  25.1 µs | 118.4 µs | 193.6 µs |
| += in a loop               |         17.7 µs |        56,550 | (  7.6 µs …   5.5 ms) |  17.1 µs | 124.6 µs | 228.0 µs |

summary
  Array.join
     1.40x slower than += in a loop
```
Reading the `Array.join` row, column by column:
- `24.8 µs` — mean time of one call (µs = microsecond, a millionth of a second).
- `40,290` — calls per second, about 1 / 24.8 µs.
- `( 11.6 µs …   3.9 ms)` — the fastest and the slowest call; the slowest took about 336 times as long as the fastest.
- `25.1 µs` (p75) — three calls in four were at least this fast; `118.4 µs` (p99) and `193.6 µs` (p995) describe the slow tail.
- `summary` — the baseline `Array.join` is `1.40x slower than` the other case (17.7 µs × 1.40 ≈ 24.8 µs). The docs' own example prints `1.35x faster than` for a faster baseline ✅[^bench-cli].

`--json` (marked UNSTABLE) prints `version`, `runtime`, `cpu` and one entry per bench with `results[0].ok` holding `n`, `min`, `max`, `avg`, `p75`, `p99`, `p995`, `p999`, `highPrecision` and `usedExplicitTimers` ✅[^bench-cli] ✅[^run]. The times are in nanoseconds: a bench that busy-waits 1 millisecond reported `"avg": 1001625.0` ✅[^run]. `--filter` takes a substring or a `/regex/`, as in `deno test` ✅[^bench-cli]; `--filter "/^Array/"` kept the `concat` group with only `Array.join` ✅[^run].

## Worked example
Measure and gate coverage for a pricing module, in one container ✅[^run]. The source, with line numbers:
```ts
 1 export function price(base: number, member: boolean): number {
 2   if (member) {
 3     return base * 0.9;
 4   }
 5   return base;
 6 }
 7
 8 export function shipping(total: number): number {
 9   return total > 100 ? 0 : 5;
10 }
11
12 export function unused(): string {
13   return "never called";
14 }
```
The test file calls each path once:
```ts
// price_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { price, shipping } from "./price.ts";
Deno.test("member discount", () => { assertEquals(price(100, true), 90); });
Deno.test("free shipping over 100", () => { assertEquals(shipping(150), 0); });
```
1. `deno test --coverage` → `ok | 2 passed | 0 failed (20ms)`, then:
   ```text
   | File      | Branch % | Function % | Line % |
   | --------- | -------- | ---------- | ------ |
   | price.ts  |     50.0 |       66.7 |   66.7 |
   | All files |     50.0 |       66.7 |   66.7 |
   ```
2. `deno coverage --detailed` → `cover file:///lab/price.ts ... 66.667% (8/12)` and the missed lines 5 (`return base;`) and 12–14 (`unused`). Line 9, the ternary, is not listed: it ran.
3. `deno coverage --lcov` → `FNH:2` of `FNF:3`, `BRH:2` of `BRF:4`, `LH:8` of `LF:12`, and for line 9 `DA:9,1` with `BRDA:9,2,0,0`: the line is covered, the `: 5` side never ran.
4. `deno coverage --threshold=80 coverage` → the table, then exit 1:
   ```text
   error: Coverage threshold not met:
     - Line coverage 66.66% is below the threshold of 80.00%
     - Branch coverage 50.00% is below the threshold of 80.00%
     - Function coverage 66.66% is below the threshold of 80.00%
   ```
5. `deno test --coverage=th --coverage-threshold=60` → tests pass, reports are written, then `- Branch coverage 50.00% is below the threshold of 60.00%` and exit 1: the line and function numbers cleared 60 %, the branch number did not.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Can coverage fail a build? | The coverage guide says `deno coverage` has "no built-in flag to fail when coverage drops below a target" ✅[^cov-guide]; the CLI reference documents `--threshold` ✅[^cov-cli]; 2.9.8 honoured it with exit 1 ✅[^run] | Thresholds arrived in Deno 2.9 ✅[^v29]; the run follows the CLI reference and `deno coverage --help`, not the guide's sentence |
| Column order | The CLI reference shows `Branch % \| Line % \| Function %` ✅[^cov-cli]; 2.9.8 printed `Branch % \| Function % \| Line %`, as the guide shows ✅[^run] ✅[^cov-guide] | Parse lcov, not the table, in scripts |
| Does coverage data accumulate across runs? | The guide says it does and that `--clean` empties the folder ✅[^cov-guide]; in 2.9.8 only `--coverage-raw-data-only` runs added to it, while a reporting `deno test --coverage` replaced the folder's contents ✅[^run] | Merge runs with raw-only collection plus `deno coverage`; keep the coverage folder for profiles only |
| A source file named `footest.ts` (ends in `test.ts`, no `_` or `.` before `test`) | Listed in the `deno test --coverage` table, missing from `deno coverage` on the same profiles ✅[^run] | `deno coverage`'s default `--exclude` matches the name ending; the test run's own table skipped only `_test`/`.test` names ✅[^run] |
| `--include="^file:\|https:"` to add remote modules ✅[^cov-cli] | The `jsr:@std/assert` modules the test imported still did not appear ✅[^run] | Not explained in the docs |
| `--exclude` set to a pattern that matches nothing | `price_test.ts` still did not appear ✅[^run] | Not explained in the docs; do not expect a test-file report |
| `deno coverage` on a folder with no profiles (here one that did not exist) | `error: No coverage files found` ✅[^run] | Point it at the folder `--coverage` wrote |
| `b.start()`/`b.end()` in a case under 10 µs | `Warning: start() and end() calls in "tiny with start/end" are ignored because it averages less than 10µs per iteration.` ✅[^run] | The API documents this 10 µs rule ✅[^api]; drop the calls for tiny cases |
| `n: 20, warmup: 3` | The function ran 40 times and the JSON reported `"n": 30` ✅[^run] | The CLI page does not document `n` or `warmup` ✅[^bench-cli]; treat them as hints, not exact counts |
| Empty or dead work | `focused ... 630.6 ps`, `1,586,000,000` iter/s ✅[^run] | Nothing was measured; see `performance/measurement/benchmarking-methodology.md` |
| A case without the permission it needs | The row prints `needs read   error: NotCapable: Requires read access to "/etc/hostname"…`, then `error: Bench failed` ✅[^run] | Same permission model as `deno run` ✅[^bench-cli] |
| Run inside the lab container | `CPU \| unknown` in the header ✅[^run] | Record the host CPU (central processing unit) yourself next to the numbers |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `deno test --coverage` alone | Table, lcov and HTML in one step ✅[^cov-guide] | Reports rebuilt on every run; earlier profiles in the folder are deleted, not merged ✅[^run] |
| `--coverage-raw-data-only`, then `deno coverage` | Several runs and subprocesses merged into one report ✅[^cov-guide] | Two commands; remember `--clean` |
| `--threshold` flag | One number for all three metrics ✅[^cov-cli] | Cannot ask less of branches than of lines |
| `deno.json` `coverage.thresholds` | A target per metric; a metric left out is not checked ✅[^cov-cli] | Overridden by the flag |
| `b.start()`/`b.end()` | Setup and teardown leave the measurement ✅[^bench-cli] | Ignored below 10 µs per iteration ✅[^run] |

## Takeaways
- Gate CI on branch coverage as well as lines; a covered line can hide an untested branch. [rule-candidate]
- When merging runs with `--coverage-raw-data-only`, start from `--clean` or a fresh folder so stale profiles do not skew the report, and keep nothing else in the coverage folder. [rule-candidate]
- Read coverage numbers in scripts from lcov (`LH`/`LF`, `BRH`/`BRF`, `FNH`/`FNF`), not from the table layout.
- Compare implementations only inside one `group` with one `baseline`, in the same run on the same machine, and check the summary's wording: it says "slower" when the baseline loses. [rule-candidate]
- Treat `deno bench --json` as unstable and its times as nanoseconds.

## Verification status
- Verified: 80 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example, Edge cases and Trade-offs. [^run]
- [Test coverage](https://docs.deno.com/runtime/test/coverage/) — Deno project, living. Rank 1. Backs: JSON profiles in `coverage/`, reports written by `deno test --coverage`, accumulation and `--clean`, `DENO_COVERAGE_DIR` for subprocesses, `deno run --coverage`, default include/exclude, the "no built-in flag" sentence, column order. [^cov-guide]
- [deno coverage](https://docs.deno.com/runtime/reference/cli/coverage/) — Deno project, living. Rank 1. Backs: flags, include/exclude rule, ignore comments, `--threshold` and `coverage.thresholds`, the remote-include pattern, the documented column order. [^cov-cli]
- [deno test](https://docs.deno.com/runtime/reference/cli/test/) — Deno project, living. Rank 1. Backs: `--coverage[=DIR]` default and `DENO_COVERAGE_DIR`, `--coverage-raw-data-only`, `--clean`, `--coverage-threshold`. [^test-cli]
- [deno bench](https://docs.deno.com/runtime/reference/cli/bench/) — Deno project, living. Rank 1. Backs: file glob, permission model, `b.start()`/`b.end()`, groups and baselines, output columns, `--json` fields, `--filter`, no docs for `n`/`warmup`. [^bench-cli]
- [Testing - Deno documentation](https://docs.deno.com/api/deno/testing/) — Deno project, living. Rank 1. Backs: `Deno.bench` options and defaults, the 10 µs rule for `start()`/`end()`. [^api]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: coverage thresholds arrived in Deno 2.9. [^v29]

## Related
- `deno/testing/testing-and-mocking.md` — writing the tests that coverage measures.
- `performance/measurement/benchmarking-methodology.md` — keeping a benchmark honest: live results, warm-up, repeats, a quiet machine.
- `performance/fundamentals/latency-percentiles-and-tail.md` — what p75 and p99 say and hide.
- `deno/advanced/debugging-profiling-and-telemetry.md` — CPU profiles when a benchmark shows a slow case.
