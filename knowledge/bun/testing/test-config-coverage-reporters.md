---
schema: knowledge-doc/v1
type: reference
topic: bun/testing
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, bun-test, cli-flags, bunfig, coverage, lcov, coverage-threshold, junit, reporters, github-actions, happy-dom, dom-testing]
---

# `bun test` flags, `[test]` config keys, coverage, reporters and DOM setup

## Summary
**TL;DR:** Bun 1.4.5's `bun test --help` lists 31 flags (plus `--check` in its examples), and `bunfig.toml` reads 17 keys under `[test]` plus `junit` and `dots` under `[test.reporter]`; keys it does not know, such as `timeout` or `environment`, and flags it does not know, such as `--environment`, are ignored without a warning ✅[^lab] ✅[^5]. Coverage (`--coverage`) prints a per-file table of function and line percentages or writes `coverage/lcov.info`; a `coverageThreshold` is checked **per file**, and a miss only shows as exit code 1 ✅[^lab] ✅[^3]. `--reporter=junit --reporter-outfile=<file>` writes JUnit XML (Extensible Markup Language), the test-report format CI (continuous integration) servers read, into a folder that must already exist; GitHub Actions gets `::error` annotations automatically, and a DOM (Document Object Model: `document`, `window`) comes from registering happy-dom in a preload script ✅[^lab] ✅[^4] ✅[^6].
**Use this when:** you look up a `bun test` flag or `[test]` key and its default, set up coverage gates or CI reports, or need `document` and `window` in tests.
**Not this doc:** what the execution flags (`--isolate`, `--parallel`, `--concurrent`) do and why → [bun-test-runner.md](bun-test-runner.md); snapshot and mock behaviour → [mocks-snapshots-and-time.md](mocks-snapshots-and-time.md); `bunfig.toml` itself (file lookup, runtime keys) → `bun/fundamentals/configuration-and-environment.md`.

## Scope
Bun 1.4.5 (`1.4.5+a7733435c`) in the `oven/bun:1.4.5` image. The flag list is the image's own `bun test --help`; the key list is what `src/bunfig/bunfig.rs` at tag `bun-v1.4.5` reads, checked in the lab. A coverage report is like a highlighter run over the source while tests execute: every line that ran is marked, and the table counts the marked lines and functions per file. Example: `src/math.ts | 66.67 | 62.50 | 5-6,11` means 2 of 3 functions and 5 of 8 lines ran, and lines 5, 6 and 11 never did ✅[^lab].

## Catalog

### `bun test` flags (from `bun test --help`, 1.4.5)
| Flag | Default | Effect | Evidence |
|---|---|---|---|
| `<patterns>` (positional) | all files | Substring filters on the file path; a path starting with `./` or `/` runs that file even if its name does not match | ✅[^lab] ✅[^1] |
| `--timeout=<ms>` | `5000` | Per-test timeout | ✅[^lab] ✅[^1] |
| `-u`, `--update-snapshots` | off | Rewrite snapshot files; also allows new snapshots in CI | ✅[^lab] ✅[^1] |
| `--rerun-each=<n>` | off | Run each test file n times | ✅[^lab] ✅[^1] |
| `--retry=<n>` | `0` | Default retry count; per-test `{ retry: n }` overrides it | ✅[^lab] ✅[^1] |
| `--todo` | off | Run `test.todo` tests; a passing todo fails | ✅[^lab] ✅[^1] |
| `--only` | off | Run only `test.only`/`describe.only` across all files | ✅[^lab] ✅[^5] |
| `--pass-with-no-tests` | off | Exit 0 when no test file matches (otherwise 1) | ✅[^lab] ✅[^5] |
| `--concurrent` | off | Treat every test as `test.concurrent` | ✅[^lab] ✅[^1] |
| `--max-concurrency=<n>` | `20` | Cap on concurrent tests | ✅[^lab] ✅[^1] |
| `--randomize` | off | Random test order; prints ` --seed=<n>` in the summary | ✅[^lab] ✅[^1] |
| `--seed=<n>` | random | Reproducible order (implies randomize) | ✅[^lab] ✅[^1] |
| `--bail[=<n>]` | off; `1` when given without a number | Stop after n failures, print `Bailed out after n failure(s)` | ✅[^lab] ✅[^1] |
| `-t`, `--test-name-pattern=<regex>` (alias `--grep`) | all tests | Run tests whose `describe` + test names match | ✅[^lab] ✅[^7] |
| `--coverage` | off | Collect coverage and report it | ✅[^lab] ✅[^3] |
| `--coverage-reporter=<text\|lcov>` | `text` | Repeatable; implies `--coverage` | ✅[^lab] ✅[^5] |
| `--coverage-dir=<dir>` | `coverage` | Where `lcov.info` goes; nested folders are created | ✅[^lab] ✅[^5] |
| `--reporter=<junit\|dots>` | console | `junit` needs `--reporter-outfile` | ✅[^lab] ✅[^5] |
| `--reporter-outfile=<file>` | — | JUnit output path | ✅[^lab] ✅[^4] |
| `--dots` | off | Same as `--reporter=dots` | ✅[^lab] ✅[^4] |
| `--only-failures` | off | Hide passing and skipped tests | ✅[^lab] ✅[^5] |
| `--path-ignore-patterns=<glob>` | none | Skip matching files during discovery (`vendor/**` dropped `vendor/h.test.ts`) | ✅[^lab] ✅[^5] |
| `--isolate` | off | Fresh global per file, same process | ✅[^lab] ✅[^8] |
| `--parallel[=<n>]` | off; n = CPU count | Worker processes; implies `--isolate` | ✅[^lab] ✅[^8] |
| `--no-isolate` | — | With `--parallel`: one global per worker | ✅[^lab] ✅[^8] |
| `--parallel-delay=<ms>` | `5` | How long the first worker must be busy before the others start; `0` starts every worker at once, so even tiny files reached workers 2 and 3 | ✅[^lab] ✅[^5] ✅[^8] |
| `--shard=<i>/<n>` | off | Run slice i of n; file k of the path-sorted list goes to shard (k mod n) + 1 | ✅[^lab] ✅[^8] |
| `--timings=<file>` / `--update-timings` | off | Read / write per-file durations (JSON, slowest first) to balance shards and workers | ✅[^lab] ✅[^8] |
| `--changed[=<ref>]` | off | Only test files affected by git changes, following imports; see Lookup notes | ✅[^5] ✅[^7] ✅[^lab] |
| `--check` | off | Type check test files and their imports first; on errors, exit 1 and run nothing. Bun 1.3.14 (`oven/bun:1.3.14`) ignored the flag and ran a test file that had a type error | ✅[^lab] ✅[^9] |
| `--no-orphans` | off | Exit when the parent dies and kill descendants: 1.5 s after the parent shell got `SIGKILL`, `bun test --no-orphans` and the `sleep` its test had spawned were gone, while without the flag both kept running | ✅[^lab] ✅[^5] |
| `--test-worker` | — | Internal: marks a `--parallel` worker (each worker ran as `bun test --test-worker --isolate --timeout=5000 --max-concurrency=20`); started by hand it waits for its coordinator and ran nothing in 3 s | ✅[^lab] ✅[^5] |
| `--preload`, `--smol`, `--watch`, `--define`, `--env-file`, `--inspect` (runtime flags, not in this `--help`) | — | Work with `bun test` too: inside a test, `--preload` set a global, `--define` replaced a constant, `--env-file` loaded a variable, and `--inspect` printed the `Bun Inspector` banner and listened on its port; `--watch` re-ran on change (Lookup notes); `--smol` was accepted, with no measurable difference | ✅[^lab] ✅[^10] |

### `[test]` keys in `bunfig.toml` (read by 1.4.5)
| Key | Type | Default | Effect | Evidence |
|---|---|---|---|---|
| `root` | string | `.` | Directory scanned for tests (`root = "src"` skipped `tests/`) | ✅[^lab] ✅[^2] |
| `preload` | string or array | none | Scripts run before the test files | ✅[^lab] ✅[^2] |
| `smol` | bool | `false` | Memory-saving mode for the test run; read as a bool (`smol = "yes"` stopped the run with `expected boolean but received string`), but no effect was measurable inside `bun test`, while `bun --smol <script>` lowered `heap_size_limit` from about 565 to 525 MB (5 runs) | ✅[^lab] ✅[^2] |
| `coverage` | bool | `false` | Same as `--coverage` | ✅[^lab] ✅[^2] |
| `coverageReporter` | string or array of `text`, `lcov` | `["text"]` | Which reports to produce | ✅[^lab] ✅[^2] |
| `coverageDir` | string | `"coverage"` | Folder for `lcov.info` | ✅[^lab] ✅[^2] |
| `coverageThreshold` | number, or `{ lines, functions, statements }` | none | Exit 1 when any file is below; a number sets lines and functions; an omitted key keeps `0.9`; `statements` is accepted but not enforced | ✅[^lab] ✅[^3] ✅[^11] |
| `coverageSkipTestFiles` | bool | `true` | Leave test files out of the report | ✅[^lab] ✅[^12] |
| `coveragePathIgnorePatterns` | glob or array | none | Leave matching files out of the report | ✅[^lab] ✅[^2] |
| `coverageIgnoreSourcemaps` | bool | `false` | Report against transpiled output (debugging only): an uncovered line of a TypeScript file reported as `13` became `6`, its line in the type-stripped output | ✅[^lab] ✅[^2] ✅[^3] |
| `pathIgnorePatterns` | glob or array | none | Skip files during discovery (`["vendor/**"]` dropped `vendor/v.test.ts`); the CLI flag replaces, not merges (`--path-ignore-patterns="other/**"` brought `vendor/v.test.ts` back) | ✅[^lab] ✅[^2] ✅[^11] |
| `randomize` | bool | `false` | Random order | ✅[^lab] ✅[^2] |
| `seed` | number | none | Fixed order; an error unless `randomize = true` | ✅[^lab] ✅[^11] |
| `rerunEach` | number | `0` | Like `--rerun-each`; an error together with `retry` | ✅[^lab] ✅[^11] |
| `retry` | number | `0` | Like `--retry`; an error together with `rerunEach` | ✅[^lab] ✅[^11] |
| `concurrentTestGlob` | glob or array | none | Files whose tests all run concurrently | ✅[^lab] ✅[^11] |
| `onlyFailures` | bool | `false` | Like `--only-failures` | ✅[^lab] ✅[^2] |
| `[test.reporter] junit` | string path | none | Turns on JUnit and sets the output file: `junit = "reports/junit.xml"` wrote the XML without any `--reporter` flag; a boolean fails with `expected string but received boolean`; the CLI's `--reporter-outfile` does not override it (Lookup notes) | ✅[^lab] ✅[^2] ✅[^11] |
| `[test.reporter] dots` (alias `dot`) | bool | `false` | Dots reporter | ✅[^lab] ✅[^11] |

### Coverage reporters and thresholds (measured)
| Setup | Output | Exit code | Evidence |
|---|---|---|---|
| `--coverage` | Table `File \| % Funcs \| % Lines \| Uncovered Line #s` plus an `All files` row; test files left out | 0 | ✅[^lab] ✅[^3] |
| `coverageSkipTestFiles = false` | Adds `math.test.ts \| 75.00 \| 85.71 \| 4` | 0 | ✅[^lab] |
| `--coverage-reporter=lcov` | `coverage/lcov.info` with `SF:`, `FNF:`/`FNH:` (functions found/hit), `DA:<line>,<hits>`, `LF:`/`LH:` per file; no table | 0 | ✅[^lab] ✅[^3] |
| `coverageThreshold = 0.9`, `--coverage` | Same table, no extra message | **1** | ✅[^lab] ✅[^3] |
| `coverageThreshold = 0.8` (`All files` 83.33 / 81.25, `src/math.ts` 66.67 / 62.50) | — | **1**: checked per file, not on `All files` | ✅[^lab] ✅[^13] |
| `coverageThreshold = { lines = 0.5 }` | — | **1**: functions still need the default 0.9 | ✅[^lab] ✅[^3] |
| `coverageThreshold = { lines = 0.5, functions = 0.5, statements = 0.99 }` | — | 0: `statements` not enforced | ✅[^lab] ✅[^3] |
| `coverageThreshold = 0.9`, `--coverage-reporter=lcov` only | No table | **1** | ✅[^lab] |
| `coverageThreshold = 0.9`, no `--coverage` | No report | 0 | ✅[^lab] ✅[^3] |
| `coverageThreshold = 0.9`, `--coverage --parallel` | Merged table | **1** | ✅[^lab] ✅[^8] |

### Reporters and CI output (measured)
| Reporter | How to turn it on | What it prints or writes | Evidence |
|---|---|---|---|
| Console | default | `(pass)`, `(fail)`, `(skip)`, `(todo)` lines when the terminal has no colour support, then counts | ✅[^lab] ✅[^4] |
| Dots | `--dots`, `--reporter=dots`, `[test.reporter] dots = true` | One `.` per passing or skipped test, full failures, counts | ✅[^lab] ✅[^4] |
| Only failures | `--only-failures`, `onlyFailures = true` | Failures and the summary only | ✅[^lab] ✅[^2] |
| JUnit XML | `--reporter=junit --reporter-outfile=junit.xml` | `<testsuites>` → one `<testsuite>` per file → a nested `<testsuite>` per `describe` → `<testcase name classname file line assertions>`, with `<failure type message>`, `<skipped />` or `<skipped message="TODO" />`; console output unchanged | ✅[^lab] ✅[^4] |
| GitHub Actions | automatic when `GITHUB_ACTIONS=true` (not with `CI=true` alone) | `::group::<file>:` … `::error title=…::<message>` (with `file=,line=,col=` when a source position is known) … `::endgroup::`, on stderr; exact format in Lookup notes | ✅[^lab] ✅[^1] |
| Agent mode | `AGENT=1`, `CLAUDECODE=1` or `REPL_ID=1` (each measured) | Passing, skipped and todo lines hidden; failures and counts kept | ✅[^lab] ✅[^1] |

### DOM setup with happy-dom (measured)
| Item | Value | Evidence |
|---|---|---|
| Install, inside the container | `bun add -d --ignore-scripts happy-dom @happy-dom/global-registrator` → `happy-dom@21.0.4`, `@happy-dom/global-registrator@21.0.4`, 10 packages | ✅[^lab] ✅[^6] |
| Preload file `happydom.ts` | `import { GlobalRegistrator } from "@happy-dom/global-registrator"; GlobalRegistrator.register();` | ✅[^lab] ✅[^6] |
| `bunfig.toml` | `[test]` `preload = ["./happydom.ts"]` | ✅[^lab] ✅[^6] |
| Type support | `/// <reference lib="dom" />` at the top of a test file: `bun test --check` reported `Cannot find name 'document'` and `Cannot find name 'HTMLButtonElement'` without it and no DOM error with it (both runs also reported the missing `@types/bun`, which was not installed) | ✅[^lab] ✅[^17] |
| Test | set `document.body.innerHTML`, `querySelector("button")`, add a click listener, `button.click()` | ✅[^lab] |
| Result | `(pass) dom test`, `1 pass`, `2 expect() calls`; `window.location.href` was `about:blank` and `navigator.userAgent` contained `HappyDOM` | ✅[^lab] |
| Without the preload | `typeof document` is `"undefined"` | ✅[^lab] |

## Lookup notes
- **Ignored without a warning in 1.4.5:** the `[test]` keys `timeout` (a 300 ms test passed with `timeout = 100`) and `environment = "happy-dom"`, the flags `--environment=happy-dom`, `--globals=vitest` and `--foo-bar`, and the comment `// @vitest-environment happy-dom` (all left `document` undefined, exit 0) ✅[^lab]. Use `--timeout` and a happy-dom preload instead.
- **Present in `1.4.6-canary.1`, not in 1.4.5: `environment`, `--environment`, `--globals` and the `@vitest-environment` comment.** The live site documents them for a newer build ✅[^14] ✅[^15], and the `oven/bun:canary` image (Bun's preview build of the next release) reads them ✅[^lab]. With happy-dom and jsdom not installed (the lab installed no DOM package for this check), `environment = "happy-dom"` and `--environment=happy-dom` each failed the file with `Cannot set up the "happy-dom" test environment for "…/d.test.ts": cannot find package "happy-dom"` and `note: to install it, run "bun add -d happy-dom"`, exit 1; `// @vitest-environment happy-dom` and `/** @jest-environment jsdom */` printed the same text as a `warn:` and ran the file without a DOM; `--environment=node` ran normally; `--globals=vitest` made `globalThis.test` a function ✅[^lab]. The `timeout` key is on neither docs site, and the canary still ignored it, as it did `--foo-bar` ✅[^lab].
- **`bun test --help` across versions:** 28 flags in Bun 1.3.14, 31 in 1.4.5 (new: `--no-isolate`, `--timings`, `--update-timings`), 37 in `1.4.6-canary.1` (new: `--environment`, `--globals`, `--files-from`, `--reporter-junit-suites`, `--react-compiler`, `--no-compile-function-source`; `--isolate` takes a value) ✅[^lab]. `--parallel`, `--isolate`, `--shard`, `--changed`, `--no-orphans` and `--pass-with-no-tests` were already in 1.3.14 ✅[^lab].
- **`--seed` on the CLI did not override `seed` in `bunfig.toml`:** with `seed = 42` in the file, `--seed=7` still printed ` --seed=42` and the seed-42 order; without the key, `--seed=7` changed the order ✅[^lab]. The 1.4.5 docs say the flag overrides the key ✅[^2]. `1.4.6-canary.1` printed ` --seed=42` too ✅[^lab].
- **Docs disagree on two defaults; the lab and the source settle them:** `coverageSkipTestFiles` is `true` (test files were absent until it was set to `false`, and the source default is `!ALLOW_ASSERT`, true in release builds), though the `bunfig.toml` page says `false` ✅[^lab] ✅[^12] ✅[^2]. A threshold with only `--coverage-reporter=lcov` exited 1, though the coverage page says such a run "currently exits 0 regardless of the threshold" ✅[^lab] ✅[^3]. Both held in `1.4.6-canary.1` ✅[^lab].
- **A threshold miss prints nothing extra:** in a terminal without colour, the only sign is exit code 1, so read `$?` in CI scripts ✅[^lab].
- **The JUnit folder must exist:** `--reporter-outfile=missing/dir/j.xml` failed with `JUnitReportFailed: Failed to write JUnit report … ENOENT`, and the run still exited 0 (2 of 2 runs; the same with `[test.reporter] junit = "missing/dir/j.xml"`), while `coverageDir = "reports/cov"` created its folders ✅[^lab]. The live docs say the JUnit reporter creates the folder, which 1.4.5 does not ✅[^16]. Folder creation is present in `1.4.6-canary.1`, not in 1.4.5: the same command wrote a 440-byte `missing-canary/dir/j.xml`, creating both folders, with no error ✅[^lab].
- **`[test.reporter] junit` in `bunfig.toml` beats the CLI path:** with `junit = "reports/from-bunfig.xml"` in the file, `--reporter=junit --reporter-outfile=cli.xml` still wrote only `reports/from-bunfig.xml` (2 of 2 runs); without the key, the same flags wrote `cli.xml` ✅[^lab]. This is the same direction as `--seed` above, so set the path in one place only. `1.4.6-canary.1` also wrote only `reports/from-bunfig.xml` ✅[^lab].
- **GitHub Actions output, as printed by 1.4.5** with `GITHUB_ACTIONS=true` (all of it on stderr; stdout carried only the `bun test v1.4.5` header) ✅[^lab]:
  ```
  ::group::a.test.ts:
  (pass) math > adds [0.02ms]
  ::error file=a.test.ts,line=4,col=39,title=error: expect(received).toBe(expected)::Expected: 3%0AReceived: 2%0A%0A      at <anonymous> (/w/a.test.ts:4:39)
  (fail) math > fails [0.62ms]
  ::error file=a.test.ts,line=6,col=55,title=TypeError: bad input::%0A      at <anonymous> (/w/a.test.ts:6:55)
  (fail) throws [0.21ms]
  ::endgroup::
  ```
  The usual code frame and diff are printed too (trimmed here). Newlines in the message become `%0A` and a comma in the title becomes `%2C`; a timeout and a thrown string have no source position, so their lines have no `file=` (`::error title=error: Test "times out" timed out after 50ms::`, `::error title=error: a string%2C no stack::`). A file that fails to load gets its `::group::` and an `::error file=…` line, but no `::endgroup::` ✅[^lab]. Not verified: how a real Actions runner renders these lines, including whether it reads them from stderr, because that needs a workflow run on GitHub.
- **`bun test --watch` re-runs on save.** Started in a container, with the edits made from a second process (`docker exec`) in a folder on the container's own filesystem: one re-run per edit of `sum.ts` (imported by `sum.test.ts`) or of a test file, and none for a file no test imports; each re-run ran both test files, not only the affected one, in the same process id (2 of 2 trials) ✅[^lab]. In a folder bind-mounted from the macOS host (Docker on OrbStack), the same edits produced two runs each, and the start produced two runs as well ✅[^lab].
- **`seed` needs `randomize`, and `retry` excludes `rerunEach`:** both combinations stop the run with `Invalid Bunfig: failed to load bunfig` ✅[^lab] ✅[^11].
- **What `--changed` selects.** The 1.4.5 help says it runs the test files "affected by changed files according to git", optionally against a commit or branch ✅[^5]; the tag's docs pages do not describe it further. In `bunlab:1` (the image plus git), with `a.test.ts` → `src/a.ts` → `src/shared.ts`, `b.test.ts` → `src/b.ts` and a stand-alone `c.test.ts` ✅[^lab]:
  - nothing changed → `--changed: no changed files, nothing to run`, 0 tests;
  - `src/shared.ts` edited, staged or not → `running 1/3 test files`: only `a.test.ts`, two imports away;
  - after the edit was committed → nothing to run again; `--changed=HEAD~1` → `a.test.ts`; on a branch, `--changed=main` → the files the branch changed;
  - a new untracked test and source file counted (`2 changed files`, only the new test ran), and an edited test file selected itself;
  - outside a repository → `error: --changed: fatal: not a git repository`.
- **CI detection** also covers `GITHUB_ACTIONS=true` and `BUILDKITE=true` without `CI`; `CI=false` turns it off ✅[^lab]. It matters for snapshots (see [mocks-snapshots-and-time.md](mocks-snapshots-and-time.md)).

## Takeaways
- After adding a `[test]` key or a `bun test` flag, prove it works with a deliberately failing case; Bun 1.4.5 ignores unknown keys and flags silently. [rule-candidate]
- Gate coverage with `coverageThreshold` and check the exit code, not the log; the gate is per file, so one weak file fails the run. [rule-candidate]
- Create the JUnit output folder before the run (`mkdir -p reports`); a failed report write does not change the exit code. [rule-candidate]
- Set a DOM up with a happy-dom preload in 1.4.5; the `environment` key and `--environment` flag do nothing in this version.

## Verification status
- Verified: 191 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, and `bunlab:1` with git 2.47.3 for `--changed`, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; happy-dom was installed inside the container only; `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`) ran the checks of features documented only on bun.com, and `oven/bun:1.3.14` (`1.3.14+0d9b296af`) the before-1.4 checks. [^lab]
- [Test runner (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/index.mdx) — Oven, 2026. Backs: positional filters, `--timeout`, `--retry`, `--concurrent`, `--max-concurrency`, randomize/seed, `--bail`, `--todo`, GitHub Actions, agent mode. [^1]
- [bunfig.toml (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/runtime/bunfig.mdx) — Oven, 2026. Backs: `[test]` keys and documented defaults. [^2]
- [Code coverage (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/code-coverage.mdx) — Oven, 2026. Backs: reporters, `lcov.info`, thresholds, `statements`, the lcov-only statement. [^3]
- [Test Reporters (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/reporters.mdx) — Oven, 2026. Backs: console, dots and JUnit reporters. [^4]
- `bun test --help` output of the `oven/bun:1.4.5` image, captured 2026-11-24 in the lab. Backs: the flag list and defaults. [^5]
- [Write browser DOM tests with Bun and happy-dom (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/test/happy-dom.mdx) — Oven, 2026. Backs: the preload setup with `@happy-dom/global-registrator`. [^6]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: `--grep`, `--changed`. [^7]
- [Parallel & isolated test runs (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/parallel.mdx) — Oven, 2026. Backs: `--isolate`, `--parallel`, `--no-isolate`, `--shard`, `--timings`, merged coverage. [^8]
- [Bun v1.4.3](https://bun.com/blog/bun-v1.4.3) — Bun blog, 2026. Backs: `bun test --check`. [^9]
- [Runtime behavior (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/runtime-behavior.mdx) — Oven, 2026. Backs: runtime flags that work with `bun test`. [^10]
- [`src/bunfig/bunfig.rs` at v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/bunfig/bunfig.rs) — Oven, 2026. Backs: the set of `[test]` keys read, their types and validation errors. [^11]
- [`src/options_types/code_coverage_options.rs` at v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/options_types/code_coverage_options.rs) — Oven, 2026. Backs: coverage defaults (`skip_test_files`, 0.9 fractions, `coverage` folder). [^12]
- [Set a code coverage threshold with the Bun test runner (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/guides/test/coverage-threshold.mdx) — Oven, 2026. Backs: the threshold is checked per file. [^13]
- [Test configuration (live docs)](https://bun.com/docs/test/configuration) — Bun documentation, living (read 2026-11-24). Backs: `environment` and `globals` keys documented for a newer build. [^14]
- [DOM testing (live docs)](https://bun.com/docs/test/dom) — Bun documentation, living (read 2026-11-24). Backs: `--environment` and the `@vitest-environment` comment documented for a newer build. [^15]
- [Test Reporters (live docs)](https://bun.com/docs/test/reporters) — Bun documentation, living (read 2026-11-24). Backs: the live claim that the JUnit reporter creates its folder. [^16]
- [DOM testing (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/dom.mdx) — Oven, 2026. Backs: the `lib="dom"` directive for TypeScript. [^17]

## Related
- `bun/testing/bun-test-runner.md` — what the execution flags do.
- `bun/testing/mocks-snapshots-and-time.md` — snapshots in CI, module mocks in preloads.
- `bun/fundamentals/configuration-and-environment.md` — `bunfig.toml` lookup and runtime keys.
- `linux/lab-setup.md` — the lab.
