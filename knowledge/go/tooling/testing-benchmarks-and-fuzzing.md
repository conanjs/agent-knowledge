---
schema: knowledge-doc/v1
type: concept
topic: go/tooling
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "testing.B.Loop, T.Context, T.Chdir since Go 1.24", "testing/synctest since Go 1.25", "T.ArtifactDir since Go 1.26", "benchstat from golang.org/x/perf v0.0.0-20261117185222-4febdb082b2c"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, testing, go-test, table-driven-tests, subtests, t-parallel, t-cleanup, examples, benchmarks, b-loop, benchstat, fuzzing, coverage, test-cache, go-vet, synctest]
ranked-sources: true
---

# Go testing, benchmarks and fuzzing

## Summary
**TL;DR:** `go test` builds a separate test binary per package from the `_test.go` files and runs every `TestXxx`, every `ExampleXxx` that has an `// Output:` comment, and the seed inputs of every `FuzzXxx`; benchmarks run only with `-bench`, fuzzing only with `-fuzz`. `t.Error` records a failure and continues, `t.Fatal` stops the test. Write table-driven tests with `t.Run` subtests, write benchmarks as `for b.Loop() { … }` (Go 1.24), and let fuzzing find inputs that break a property — it saves each one under `testdata/fuzz/` as a permanent regression test. Before the tests run, `go test` runs a subset of `go vet`, and in package-list mode it caches passing results.
**Use this when:** writing or reviewing Go tests, a benchmark gives an implausible number or you must tell whether a benchmark change is real, a test result says `(cached)`, a test is skipped by vet, or you want fuzzing to look for edge cases.
**Not this doc:** the flags and environment of the `go` command → `go/tooling/go-command-and-build-reference.md`; testing concurrent code and goroutine leaks → `go/concurrency/patterns-and-goroutine-leaks.md`; how to run a trustworthy benchmark in any language → `performance/measurement/benchmarking-methodology.md`; pinning legacy behaviour before a change → `testing/characterization-tests.md`.

## Problem
Go's test tool is simple, but its quiet defaults mislead. A benchmark can report 0.5 ns/op (nanoseconds per operation) because the compiler deleted the work. A second `go test ./...` prints `(cached)` and runs nothing. A `t.Fatal` in a helper goroutine does not stop the test. A table of cases stops at the first `t.Fatal`, hiding the other failures. A test file with a misused `Printf` never runs because vet failed first. Fuzzing finds a crash, and the next plain `go test` fails because the crashing input has become part of the test suite.

## Mental model
**Analogy:** `go test` is an inspection line. Each package gets its own inspection booth (a test binary). `t.Error` is a red mark on the checklist — the inspector keeps checking; `t.Fatal` sends the item off the line. Subtests are numbered sub-items on one checklist. A benchmark is a stopwatch that only runs inside the `for b.Loop()` loop. The fuzzer is a machine that keeps bending sample inputs; when one breaks the product, it files that input as a new permanent sample for every future inspection.

**Artifact:** the four kinds of test function the `testing` package recognizes ✅[^2]:
```go
func TestReverse(t *testing.T)       // go test runs it; Xxx must not start with a lower-case letter
func ExampleReverse()                // run and checked when it ends with an // Output: comment
func BenchmarkReverse(b *testing.B)  // run only with -bench
func FuzzReverse(f *testing.F)       // seeds run always; random inputs only with -fuzz
```

## How it works
Four actors take part in one `go test` run:
- **The `go` command** — its job: pick each package's `.go` and `_test.go` files and reuse earlier passing results, via the package arguments and the test cache ✅[^3].
- **`go vet`** — its job: stop a package with likely mistakes before its tests run, via the 11-check subset in step 9 ✅[^3].
- **The test binary** — its job: run the package's test, example, benchmark and fuzz-seed functions, via the `testing` package, one binary per package ✅[^3].
- **The fuzzing engine** — its job: mutate seed inputs and save the ones that fail, via parallel workers (8 in the lab) and `testdata/fuzz/`; it starts only with `-fuzz` ✅[^2] ✅[^1].

```text
go test ./...                          (everything runs locally)
  │
  ├─ go command: per package, collect *.go and *_test.go (skip _*, .*, testdata/)
  ├─ go command: build pkg.test ── go vet subset runs as part of the build
  │                                    └─ finding ──▶ "FAIL pkg [build failed]", no test runs
  ├─ go command: same binary, only cacheable flags, passed before? ── yes ──▶ replay output, "(cached)"
  ├─ test binary: TestXxx, ExampleXxx with // Output:, FuzzXxx seeds; BenchmarkXxx only with -bench
  │     └─ fuzzing engine, only with -fuzz and after all of the above: mutate seeds on the workers
  │           └─ failure ──▶ write the input to testdata/fuzz/FuzzXxx/<hash>, FAIL
  └─ go command: passed, package-list mode ──▶ store the result in the test cache
```

The test cache matches on the test binary and the flags, and a hit replays the earlier output instead of running the binary; vet runs as part of building that binary ✅[^3]. Fuzzing starts only after the tests, benchmarks, other fuzz tests' seeds and examples have finished ✅[^3].

1. **Test files and packages.** Files ending in `_test.go` are left out of normal builds and compiled by `go test` ✅[^2] ✅[^3]. A test file may be in the same package (it can use unexported names) or in a `_test` package that imports the package under test (black-box testing) ✅[^2]. Each package listed becomes a separate test binary, files starting with `_` or `.` are ignored, and a directory named `testdata` is ignored by the build, so it can hold test fixtures ✅[^3].
2. **Failing and logging.** `Error` is `Log` plus `Fail`: the test is marked failed and continues ✅[^2] ✅[^1]. `Fatal` is `Log` plus `FailNow`, which stops the test through `runtime.Goexit` after running its deferred calls ✅[^2] ✅[^1]. `FailNow` must be called from the goroutine running the test, not from goroutines the test started ✅[^2]. `Log` output is shown only when the test fails or with `-v` ✅[^2]. `t.Helper()` marks a helper, so a failure is reported at the caller's line ✅[^2] ✅[^1].
3. **Table-driven tests and subtests.** A slice of cases looped over by one test is the table-driven style ✅[^10]. `t.Run(name, f)`, available since Go 1.7, runs each case as a subtest named `TestReverse/word` ✅[^10] ✅[^2]. The `-run` pattern is split at slashes and matched against each name element, so `go test -run Reverse/word` picks one case ✅[^2]. `t.Parallel()` pauses a test until all non-parallel tests are done and then runs it alongside other parallel tests; a parent finishes only after its subtests ✅[^2] ✅[^1].
4. **Lifecycle helpers.** `t.Cleanup` functions run when the test and its subtests finish, last registered first ✅[^2] ✅[^1]. `t.TempDir` gives a fresh directory that is removed afterwards ✅[^2]. Since Go 1.24, `t.Context()` returns a context canceled just before the cleanup functions run, and `t.Chdir` changes the working directory for one test ✅[^2] ✅[^6] ✅[^1]. Since Go 1.26, `t.ArtifactDir()` gives a per-test directory for output files, kept under the output directory when `go test -artifacts` is used ✅[^2] ✅[^3]. `t.Setenv` and `t.Chdir` change the whole process, so they cannot be used in parallel tests ✅[^2]. A `TestMain(m *testing.M)` function can wrap the whole binary with set-up and tear-down ✅[^2].
5. **Examples.** An example whose body ends with `// Output:` is run and its standard output compared with the comment, ignoring leading and trailing space; `// Unordered output:` ignores line order; an example with no output comment is compiled but not run ✅[^2]. Names follow `Example`, `ExampleF`, `ExampleT`, `ExampleT_M`, plus an optional `_suffix` that starts with a lower-case letter ✅[^2].
6. **Benchmarks.** `go test -bench <regexp>` runs matching benchmarks, one after another; none run by default ✅[^2] ✅[^3]. With `for b.Loop() { … }` (Go 1.24) the timer resets at the first call and stops when the loop ends, so set-up and cleanup are not measured; values used in the loop body are kept alive so the compiler cannot delete the work; and the benchmark function runs once per measurement ✅[^2] ✅[^11]. The older `for range b.N` style must run the body `b.N` times, the function is called repeatedly with growing `b.N`, and set-up before the loop needs `b.ResetTimer` ✅[^2]. `-benchmem` adds allocation counts ✅[^3]. A result line such as `BenchmarkReverseLoop-8  2584909  404.7 ns/op` means the body ran 2,584,909 times at 404.7 ns each ✅[^2] ✅[^1]; the `-8` suffix is the run's `GOMAXPROCS` value, normally the number of CPUs (central processing units) available ✅[^3], which `-cpu 1,2,8` varies (the names become `BenchmarkX`, `BenchmarkX-2`, `BenchmarkX-8`) ✅[^3] ✅[^1]; `golang.org/x/perf/cmd/benchstat` compares runs statistically ✅[^2].
7. **Fuzzing.** A fuzz test `FuzzXxx(f *testing.F)` registers seed inputs with `f.Add` (or files under `testdata/fuzz/FuzzXxx/`) and has exactly one fuzz target, `f.Fuzz(func(t *testing.T, …))` ✅[^4] ✅[^2]. Arguments may only be `string`, `[]byte`, the integer types, `float32`, `float64` and `bool` ✅[^4]. Without `-fuzz` the seeds run like ordinary subtests ✅[^2]. With `-fuzz=<regexp>`, which must match exactly one fuzz test in one package, the engine mutates the seeds, keeps inputs that add coverage, and on a failure writes the input to `testdata/fuzz/<Name>/`, where it becomes a seed ✅[^3] ✅[^2] ✅[^1]. `-fuzztime` bounds the run; by default it runs until it fails ✅[^3]. Coverage guidance needs an amd64 or arm64 machine, and targets should be fast, deterministic and free of state kept between calls ✅[^4]. `t.Skip()` rejects an invalid input without failing ✅[^2].
8. **Coverage.** `-cover` reports statement coverage, `-coverprofile=cover.out` writes a profile (and sets `-cover`), and `-covermode` is `set`, `count` or `atomic` (the default with `-race`) ✅[^3] ✅[^1].
9. **Caching and vet.** `go test` with package arguments (`go test ./...`, even `go test .`) is package-list mode and caches passing results, printing `(cached)`; plain `go test` in a folder is local directory mode and never caches ✅[^3] ✅[^1]. Only runs that use the cacheable flags (`-run`, `-v`, `-short`, `-timeout` and a few more) are cached, and `-count=1` is the idiomatic way to force a real run ✅[^3]. Before running, `go test` runs the vet checks `atomic`, `bools`, `buildtag`, `directive`, `errorsas`, `ifaceassert`, `nilfunc`, `printf`, `stdversion`, `stringintconv` and `tests`; a finding stops the test binary from running, and `-vet=off` disables this ✅[^3] ✅[^1]. `stdversion` joined that list in Go 1.27 ✅[^8]. A test binary that runs longer than `-timeout` (10 minutes by default) panics ✅[^3].
10. **Testing time with `testing/synctest`.** Since Go 1.25, `synctest.Test(t, f)` runs `f` in an isolated "bubble" whose `time` package uses a fake clock that starts at midnight UTC (Coordinated Universal Time) on 2000-01-01 and moves only when every goroutine in the bubble is durably blocked ✅[^7] ✅[^5]. A `time.Sleep(2 * time.Hour)` inside the bubble returned at once, with `time.Since` reporting `2h0m0s` ✅[^1].
11. **Comparing runs with benchstat.** One benchmark line is one sample, and samples on a shared machine scatter widely (see Edge cases), so a comparison needs many samples per side and a statistical test. `benchstat` reads files in the Go benchmark format, such as `go test -bench` output, and each benchmark should run at least 10 times; it prints the median of each benchmark with a confidence interval for that median and, given two or more files, compares each benchmark in the first file with the same benchmark in each later file ✅[^9]. `golang.org/x/perf` has no tagged versions, so the tool is pinned by its pseudo-version ✅[^1]. In the lab, package `join` had two builds of `Join(parts []string) string` over 100 parts: by default a loop of `s += ","` and `s += p`, and with `-tags builder` one `strings.Builder` sized up front with `Grow`; `Words(s string) int`, which counts commas, is the same in both builds and serves as a control ✅[^1]. Both builds are one package, so their file-level `pkg:` lines match and benchstat puts them in one table; different configurations, such as two packages, get separate tables ✅[^9].
    ```console
    $ go install golang.org/x/perf/cmd/benchstat@v0.0.0-20261117185222-4febdb082b2c
    $ go test -run='^$' -bench=. -benchmem -count=10 ./join > old.txt
    $ go test -tags builder -run='^$' -bench=. -benchmem -count=10 ./join > new.txt
    $ benchstat old.txt new.txt
    goos: linux
    goarch: arm64
    pkg: lab/join
            │    old.txt     │               new.txt                │
            │     sec/op     │    sec/op     vs base                │
    Join-8    32409.0n ± 23%   989.9n ± 34%  -96.95% (p=0.000 n=10)
    Words-8     250.8n ± 11%   245.8n ±  5%        ~ (p=0.853 n=10)
    geomean     2.851µ         493.2n        -82.70%

            │    old.txt     │               new.txt                │
            │      B/op      │    B/op     vs base                  │
    Join-8    71400.0 ± 0%     704.0 ± 0%  -99.01% (p=0.000 n=10)
    Words-8     0.000 ± 0%     0.000 ± 0%        ~ (p=1.000 n=10) ¹
    geomean                ²               -90.07%                ²
    ¹ all samples are equal
    ² summaries must be >0 to compute geomean
    (an allocs/op table follows: Join 198.000 → 1.000, -99.49%; Words ~)
    ```
    ✅[^1] How to read it, in the terms benchstat's documentation uses:
    - **Columns and units.** One column per input file, named after it; an argument `plus=old.txt` relabels a column ✅[^9] ✅[^1]. There is one table per unit: `sec/op` (benchstat turns `ns` into `sec`, so `32409.0n` is 32,409 nanoseconds), then `B/op` (bytes allocated per operation) and `allocs/op` (allocations per operation) from `-benchmem` ✅[^9] ✅[^2] ✅[^1].
    - **The value and `± 23%`.** The value is the median of the 10 samples, and the `±` percentage is the 95% confidence interval around it: the error bar, the range the true median very likely lies in ✅[^9]. Here the intervals are wide because the lab machine was busy ✅[^1].
    - **`vs base`.** The change of the median against the first column: `-96.95%` means the builder version took about 3% of the time ✅[^9] ✅[^1].
    - **`(p=0.000 n=10)`.** `n` is the number of samples from each file, and the p-value measures how likely it is that the difference is only noise ✅[^9]. By default benchstat uses non-parametric statistics (they assume no particular distribution of the samples): the median for summaries and the Mann-Whitney U-test for comparisons, with a threshold α (alpha) of 0.05 ✅[^9]. Analogy: pool all 20 timings, deal them at random into two piles of 10, and ask how often two such piles differ as much as the real ones; a small p means rarely.
    - **`~`.** benchstat detected no statistically significant difference: `Words` went from 250.8n to 245.8n, but p = 0.853 says that is noise ✅[^9] ✅[^1]. Significant is not the same as large: with enough low-noise data, even a tiny change counts as significant ✅[^9].
    - **`geomean`.** The geometric mean of each column, an overall picture across the benchmarks ✅[^9]; footnote ² marks a column holding a zero, which has no geometric mean ✅[^1].

    Over four lab sessions (the last a review rerun of the same commands) the `Join` change was -96.95% to -97.83%, `Words` stayed `~` with p from 0.085 to 0.853, and the `±` intervals ranged from 2% to 72% ✅[^1]. The documentation also advises interleaving the before and after runs instead of running all of one side first, choosing a run count (at least 10, ideally 20) and keeping it ✅[^9].

## Worked example
A byte-wise `Reverse(s string) string`, tested in the lab ✅[^1]. The fuzz test checks one property: reversing valid UTF-8 (Unicode Transformation Format, 8-bit: Unicode characters stored as 1 to 4 bytes each) gives valid UTF-8.

```go
func TestReverse(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{"empty", "", ""}, {"one", "a", "a"}, {"word", "gopher", "rehpog"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := Reverse(tc.in); got != tc.want {
				t.Errorf("Reverse(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func FuzzReverse(f *testing.F) {
	for _, seed := range []string{"hello", " ", "!12345"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, s string) {
		if !utf8.ValidString(s) {
			t.Skip()
		}
		if r := Reverse(s); !utf8.ValidString(r) {
			t.Errorf("Reverse(%q) = %q, not valid UTF-8", s, r)
		}
	})
}
```

| Step | Command | Result in Go 1.27.4 |
|---|---|---|
| 1 | `go test -cover ./rev` | `ok lab/rev 0.032s coverage: 100.0% of statements` — every case and the example pass ✅[^1] |
| 2 | `go test ./rev` twice | Second run prints `ok lab/rev (cached)` ✅[^1] |
| 3 | `go test -run '^$' -fuzz=FuzzReverse -fuzztime=30s ./rev` | After 1,197 executions: `Reverse("޺") = "\xba\xde", not valid UTF-8`; `Failing input written to testdata/fuzz/FuzzReverse/9fc4db104cc0166e` ✅[^1] |
| 4 | `cat testdata/fuzz/FuzzReverse/9fc4db104cc0166e` | `go test fuzz v1` then `string("޺")` ✅[^1] |
| 5 | `go test ./rev` | Now fails: the saved input runs as subtest `FuzzReverse/9fc4db104cc0166e` ✅[^1] |
| 6 | Reverse `[]rune(s)` instead of bytes, `go test ./rev2` | `--- PASS: FuzzReverse/9fc4db104cc0166e`; a further 5 s of fuzzing finds nothing ✅[^1] |

The bug: `"޺"` is two UTF-8 bytes, and reversing bytes breaks the character; reversing runes keeps it whole. Fuzzing is random: a re-run of step 3 in the same lab found `"Ė"` after 129 executions and saved it as `02b35f7e3f52e284`, so the input, the count and the file name change from run to run while the failure stays the same ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| `for range b.N { isCond(201) }` with the result unused | 0.32–0.57 ns/op; the same body in `for b.Loop()` gives 2.2–2.9 ns/op (two lab sessions) ✅[^1] | The inlined call is removed as dead code, so the old loop times nothing; `b.Loop` keeps it alive ✅[^11] |
| Benchmark function that logs `b.N` | `b.N`-style: called 6 times (`b.N` = 1, 100, … 1,000,000,000); `b.Loop` style: called once ✅[^1] | `b.N` benchmarks are re-run with growing `b.N`; `b.Loop` ramps up inside one call ✅[^2] ✅[^11] |
| The same benchmark run 4 times on a busy 8-CPU machine | 220–461 ns/op in one session, 119–144 ns/op in a later, quieter one ✅[^1] | One run is not a measurement: use `-count` and benchstat ✅[^2], and see `performance/measurement/benchmarking-methodology.md` |
| `t.Error` then more checks | Every later check still runs and reports ✅[^1] | `Error` does not stop the test ✅[^2] |
| `t.Fatal` called in a goroutine the test started | Not allowed; vet's `testinggoroutine` analyzer reports it ✅[^2] ✅[^1] | `FailNow` must run on the test's own goroutine ✅[^2] |
| `fmt.Printf("%d\n", "x")` in a test file | `go test` prints the vet finding and `FAIL lab/vetfail [build failed]`; no test runs ✅[^1] | `printf` is in the vet subset `go test` runs ✅[^3] |
| A test reads a file outside its module, and that file changes | `go test ./...` can still print `(cached)` ✅[^3]; in the lab, changing a file outside the module kept `(cached)`, changing one inside re-ran the test ✅[^1] | Only files opened inside the package's module, and environment variables the test reads, invalidate a cached result ✅[^3] |
| Example with no `// Output:` comment | Compiled, never run ✅[^2] | Only examples with output comments are executed ✅[^2] |
| Fuzz target taking a struct argument | Not allowed ✅[^4] | Only basic types, `string` and `[]byte` can be fuzzed ✅[^4] |
| `benchstat` on 3 runs per side | `76343.0n ± ∞ ¹` against `788.5n ± ∞ ¹`, and `~ (p=0.100 n=3) ²` despite a 99% drop; the footnotes read `need >= 6 samples for confidence interval at level 0.95` and `need >= 4 samples to detect a difference at alpha level 0.05` ✅[^1] | Too few samples for the interval and the test; benchstat asks for at least 10 runs per benchmark ✅[^9] |
| Rerunning benchmarks until benchstat reports a change | It eventually reports one, even when nothing changed ✅[^9] | Multiple testing: at α = 0.05, about 5% of comparisons look significant by chance ✅[^9] |
| Package directory is read-only while fuzzing | The failing input goes to the fuzz cache in the build cache instead ✅[^2] | `testdata/fuzz/` could not be written ✅[^2] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Table-driven test with `t.Run` | One loop, every case reported, any case runnable by name ✅[^2] ✅[^10] | Case data and assertions can drift apart in large tables |
| `t.Parallel()` subtests | Shorter wall time | Shared state must be safe; no `t.Setenv`/`t.Chdir` ✅[^2] |
| `b.Loop` | No dead-code surprises, set-up excluded, faster to run ✅[^11] | Needs Go 1.24 or later |
| Fuzzing in continuous integration with `-fuzztime` | Finds inputs nobody thought of ✅[^4] | Unbounded by default ✅[^3]; results vary run to run |

## Takeaways
- Use `t.Error` for independent checks and `t.Fatal` only when the rest of the test cannot run. [rule-candidate]
- Write new benchmarks as `for b.Loop() { … }`, and compare benchmark runs with `-count` and benchstat, never a single run. [rule-candidate]
- Run each side of a benchmark comparison at least 10 times, keep that count fixed, and do not rerun until benchstat reports a change. [rule-candidate]
- Commit the inputs fuzzing writes under `testdata/fuzz/`: they are regression tests. [rule-candidate]
- Use `go test -count=1 ./...` when you need the tests to actually run, for example after changing files the tests read outside the module.

## Verification status
- Verified: 136 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24 (an 8-CPU arm64 container shared with other jobs, which explains the benchmark noise), plus benchstat from `golang.org/x/perf` v0.0.0-20261117185222-4febdb082b2c, installed from the module proxy (`go list -m -versions golang.org/x/perf` lists no tagged versions). [^1]
- [Package testing](https://pkg.go.dev/testing) — Go team, living. Rank 1. Backs: test, benchmark, example and fuzz functions; `Error`/`Fatal`/`FailNow`/`Helper`/`Log`; `Run`, `Parallel`, `Cleanup`, `TempDir`, `Context`, `Chdir`, `Setenv`, `ArtifactDir`, `TestMain`; `B.Loop` and `b.N`; the `B/op` and `allocs/op` metrics; benchstat. [^2]
- [Command go](https://pkg.go.dev/cmd/go) — Go team, living. Rank 1. Backs: §Test packages (vet subset, local directory and package list modes, caching), §Testing flags (`-bench`, `-benchmem`, `-count`, `-cover`, `-coverprofile`, `-covermode`, `-fuzz`, `-fuzztime`, `-timeout`, `-artifacts`). [^3]
- [Go Fuzzing](https://go.dev/doc/security/fuzz/) — Go team, living. Rank 1. Backs: fuzz test rules, allowed argument types, running modes, coverage platforms, suggestions. [^4]
- [Package testing/synctest](https://pkg.go.dev/testing/synctest) — Go team, living. Rank 1. Backs: bubbles, the fake clock and its start time, durably blocked goroutines. [^5]
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — Go team, 2025. Rank 1. Backs: `T.Context`, `T.Chdir`, `B.Loop`. [^6]
- [Go 1.25 Release Notes](https://go.dev/doc/go1.25) — Go team, 2025. Rank 1. Backs: `testing/synctest` generally available. [^7]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: `go test` runs `stdversion` by default. [^8]
- [benchstat command](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat) — Go team, v0.0.0-20261117185222-4febdb082b2c. Rank 1. Backs: input format, at least 10 runs, median and 95% confidence interval, `vs base`, p-value, `~`, geomean, separate tables per configuration, `label=path`, unit normalization, Mann-Whitney U-test, α = 0.05, interleaving and multiple-testing advice. [^9]
- [Using Subtests and Sub-benchmarks](https://go.dev/blog/subtests) — Marcel van Lohuizen, Go blog, 2016. Rank 4. Backs: table-driven tests; `Run` since Go 1.7. [^10]
- [More predictable benchmarking with testing.B.Loop](https://go.dev/blog/testing-b-loop) — Junyang Shao, Go blog, 2025. Rank 4. Backs: dead-code elimination in `b.N` loops, what `b.Loop` fixes, one-shot ramp-up. [^11]

## Related
- `go/tooling/go-command-and-build-reference.md` — every `go` subcommand, flag, environment variable and directive.
- `go/concurrency/patterns-and-goroutine-leaks.md` — testing concurrent code and finding leaked goroutines.
- `go/runtime/profiling-and-diagnostics.md` — profiling what a benchmark shows is slow.
- `performance/measurement/benchmarking-methodology.md` — trustworthy benchmarking in any language.
- `testing/characterization-tests.md` — pinning existing behaviour before a change.
- `go/learning-path.md` — where this doc sits in the learning order.
