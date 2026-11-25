---
schema: knowledge-doc/v1
type: concept
topic: bun/testing
status: verified
applies-to: ["Bun 1.4.5", "Node.js 24.22.1"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, bun-test, test-runner, jest, isolate, parallel, lifecycle-hooks, concurrency, timeout, test-only, test-each, retry]
---

# `bun test`: discovery, execution model, hooks, concurrency and modifiers

## Summary
**TL;DR:** `bun test` finds files whose names contain `.test.`, `_test.`, `.spec.` or `_spec.` (skipping `node_modules` and dot-folders) and, by default, runs them one after another in **one process with one shared global object and one module registry**: a global that file A sets is still there when file B runs ✅[^lab] ✅[^1]. `--isolate` gives every file a fresh global in the same process, and `--parallel` spreads files over worker processes and implies `--isolate` ✅[^lab] ✅[^3]. Inside a file, tests run one at a time unless marked `test.concurrent` or run with `--concurrent`; the default per-test timeout is 5000 ms; hooks, `-t`, `only`, `skip`, `todo`, `failing` and `each` use Jest's names and call shapes, and the `jest` object is a subset of Jest's ✅[^lab] ✅[^1] ✅[^5].
**Use this when:** a test passes alone but fails in the full suite (or the reverse), you port a Jest suite, you need to know in which order hooks run, or you want to make a suite faster without making it flaky.
**Not this doc:** `mock()`, `mock.module()`, snapshots and fake time → [mocks-snapshots-and-time.md](mocks-snapshots-and-time.md); every flag, every `[test]` key of `bunfig.toml`, coverage, reporters and DOM (Document Object Model, the browser's `document` and `window`) setup → [test-config-coverage-reporters.md](test-config-coverage-reporters.md); moving a Jest project step by step → `bun/node-compat/migrating-from-node.md`.

## Problem
- A file passes only because an earlier file left a global, a patched prototype or a module-level counter behind ✅[^lab]. Jest and Vitest isolate every file by default ✅[^3], so the same suite can behave differently under `bun test`, and the bug shows up only when files run in another order or alone.
- A suite ported from Jest runs a different set of tests than expected: `.only` in one file does not stop other files, `test("name")` without a body breaks the whole file, and a `jest.*` helper such as `jest.requireActual` is simply missing ✅[^lab].
- A slow suite gets "fixed" with the wrong knob: `test.concurrent` does not use more CPU cores (four 200 ms busy-loop tests marked `test.concurrent` started at 0, 200, 400 and 600 ms, 800 ms in all, in 5 of 5 runs), and `--parallel` costs a process per worker ✅[^lab] ✅[^3].
- The live docs site describes a build newer than 1.4.5, so some documented features (`aroundEach`, `--environment`, `describe.shuffle`) do nothing or fail in 1.4.5 ✅[^lab] ✅[^9]. All three are present in `1.4.6-canary.1`, the next build, published as the `oven/bun:canary` image (a canary is Bun's preview build of the next release), not in 1.4.5 ✅[^lab].

## Mental model
**Analogy:** one classroom with one whiteboard. By default every class (test file) uses the same room in turn, and whatever one class leaves on the board, the next class sees. `--isolate` wipes the board between classes. `--parallel` opens several rooms (worker processes), each wiped between classes unless you add `--no-isolate`. Inside one class, questions (tests) are answered one at a time, unless the teacher says "concurrent": then a student waiting for a reply (an `await` on I/O) lets the next one start, but they are still in the same room (one thread).

**Artifact:** two files and what file B saw, measured in Bun 1.4.5 (Docker on OrbStack, arm64, 8 CPU cores; times are process wall time, timed from inside the container) ✅[^lab]:
```ts
// counter.ts
export const state = { hits: 0 };
// a.test.ts
import { state } from "./counter";
test("A", async () => {
  (globalThis as any).leak = "set by A";
  state.hits++;
  (Array.prototype as any).patchedByA = true;
  await Bun.sleep(300);                  // 0 in the last row of the table
});
// b.test.ts
import { state } from "./counter";
test("B", async () => {
  await Bun.sleep(300);
  console.log((globalThis as any).leak, state.hits, (Array.prototype as any).patchedByA, process.pid);
});
```

| Command | Processes | B sees `leak` | B sees `state.hits` | B sees the prototype patch | Median wall time, 7 runs |
|---|---|---|---|---|---|
| `bun test` | 1 (both files pid 7) | `"set by A"` | `1` (one module instance) | `true` | 622 ms |
| `bun test --isolate` | 1 (pid 13), `counter.ts` evaluated twice | `undefined` | `0` | `undefined` | 620 ms |
| `bun test --parallel` | 2 workers (`BUN_TEST_WORKER_ID` 1 and 2) | `undefined` | `0` | `undefined` | 331 ms |
| `bun test --parallel --no-isolate`, tests that do not sleep | 1 worker took both files | `"set by A"` | `1` | `true` | 5 ms |

## How it works
**4 actors:**
- **The `bun test` command** — its job: build the list of test files, via the name patterns, the positional filters and the ignore rules.
- **The runner (main process)** — its job: load preload scripts, then load and run each file, via one JavaScript global by default, or a fresh global per file with `--isolate`.
- **The test file's module** — its job: register tests and hooks, via its top-level code and its `describe` callbacks, which run before any test.
- **Worker processes** (only with `--parallel`) — their job: run the files the runner hands them, via one child process each, and stream results back.

```
bun test [filters]
  │ discovery: *.test.* / *_test.* / *.spec.* / *_spec.*, skip node_modules and .dirs
  ▼
runner (main process) ── loads --preload scripts once (per file with --isolate)
  │
  ├─ default: file 1 ─▶ file 2 ─▶ …   same global, same module registry
  ├─ --isolate: file 1 │ new global │ file 2 …   same process
  └─ --parallel: ═══ process boundary ═══▶ worker 1, worker 2 … (fresh global per file)
        each file: 1) collect (top level + describe bodies)  2) run hooks and tests
```

1. **`bun test` (discovery):**
   - Matches the four name patterns with any of the extensions `js jsx ts tsx mjs cjs mts cts`; in the lab it ran `a.test.ts`, `b_test.js`, `c.spec.tsx`, `d_spec.mjs`, `l.spec.mts`, `sub/e.test.cts` and `vendor/h.test.ts`, and skipped `node_modules/pkg/f.test.ts`, `.hidden/g.test.ts`, `i.tests.ts`, `j-test.ts`, `k.test.json` and `test.ts` ✅[^lab] ✅[^2].
   - Narrows the list by positional filters, via a substring match on the path: `bun test sub` ran only `sub/e.test.cts`, and `bun test spec` ran the three spec files ✅[^lab] ✅[^2]. A glob such as `"*.spec.*"` matched nothing ✅[^lab] ✅[^1].
   - Runs a file that does not match the patterns when its path starts with `./` or `/`: `bun test ./j-test.ts` ran it ✅[^lab] ✅[^2].
   - Exits with code 1 and prints `13 files were searched` plus a naming hint when nothing matches; `--pass-with-no-tests` makes that exit 0 ✅[^lab] ✅[^7].
2. **Runner (preload):** evaluates each `--preload` script once, before the first file, and its `beforeAll`/`afterAll` wrap the whole run. With `--isolate` the preload is evaluated again for every file, so its `beforeAll`/`afterAll` wrap each file ✅[^lab] ✅[^3].
3. **Test file (collection):** the file's top level and every `describe` callback run first and only register tests and hooks; in the trace below, the line from the `describe` body printed before any `beforeAll` ✅[^lab]. A `test("name")` with no function is a load error (`test expects a function as the second argument`), and none of that file's tests run ✅[^lab].
4. **Runner (execution, hook order):** for each test, `beforeEach` hooks run from the outside in (preload, file, outer `describe`, inner `describe`) and `afterEach` hooks from the inside out; a `describe` block's `beforeAll` runs before its first test and its `afterAll` after its last ✅[^lab] ✅[^4]. Trace from two files and a preload (trimmed) ✅[^lab]:
   ```
   a.test.ts:
   preload: module body
   a: module body
   a: describe(outer) body runs at collection time
   preload beforeAll
    a file beforeAll
     outer beforeAll
     preload beforeEach
     a file beforeEach
      outer beforeEach
       TEST outer t1
      outer afterEach
     a file afterEach
     preload afterEach
     … t2 (in "inner"): the same, plus "inner beforeEach" / "inner afterEach" closest to the test
     outer afterAll
     … t3 (top level): only the preload and file beforeEach/afterEach
    a file afterAll
   b.test.ts:
    b file beforeAll
     … b1, wrapped by the preload beforeEach/afterEach
    b file afterAll
   preload afterAll
   ```
5. **Runner (timeouts):** each test gets 5000 ms unless the third argument of `test()` (a number or `{ timeout }`), `--timeout`, or `setDefaultTimeout()` / `jest.setTimeout()` for the rest of the file changes it ✅[^1] ✅[^5] ✅[^8]; with `setDefaultTimeout(100)` and with `jest.setTimeout(100)`, a 200 ms test failed after 100 ms ✅[^lab]. A third argument of `100` or `{ timeout: 100 }` also failed a 200 ms test after 100 ms and `300` let it pass; `--timeout=150` failed the test that had no argument after 150 ms but left the `300` one passing, so the per-test value wins over the flag ✅[^lab]. Measured: a test that slept 4900 ms passed, one that slept 5100 ms failed with `this test timed out after 5000ms.`; `0` disabled the limit (a 150 ms sleep passed with `0`) ✅[^lab] ✅[^6]. A test whose function declares a `done` parameter ends when `done()` is called, fails on `done(error)`, and times out with a hint about the unused `done` if it is never called ✅[^lab] ✅[^5].
6. **Runner (concurrency inside a file):** tests run one at a time by default. `test.concurrent`, `describe.concurrent`, `--concurrent` and `concurrentTestGlob` let async tests overlap while they await; `test.serial` opts out; `--max-concurrency` caps the number (default 20) ✅[^1] ✅[^3]; with 25 `test.concurrent` tests that each sleep 200 ms, 20 started at once and 5 at 201–205 ms, and `--max-concurrency=30` started all 25 at once (2 runs) ✅[^lab]. It is cooperative, on one thread, so it helps I/O waits only ✅[^3]: four 200 ms busy loops marked `test.concurrent` ran one after another ✅[^lab]. Start times measured with four tests that each sleep 200 ms, median of 5 runs, counted from the file's first line to the start of each test and to `afterAll` ✅[^lab]:

   | Run | Start offsets | Last test done |
   |---|---|---|
   | plain `test` (default) | 0, 201, 402, 603 ms, then the `test.serial` one at 805 ms | 1006 ms |
   | `test.concurrent` | 0, 0, 0, 0 ms; a following plain test at 201 ms; a `describe.concurrent` pair after it at 401, 401 ms | 602 ms (7 tests) |
   | `--concurrent` | 0, 0, 0, 0 ms; the `test.serial` one waited until 201 ms | 401 ms |
   | `--concurrent --max-concurrency=2` | 0, 0, 201, 201 ms; `test.serial` at 402 ms | 603 ms |
7. **Runner → workers (`--parallel`), across the process boundary:**
   - The runner becomes a coordinator: it starts worker processes (default: the CPU count, printed as `8x PARALLEL`) and hands each one file at a time ✅[^lab] ✅[^3]. The flag predates 1.4: the 1.4 release notes date it to 1.3.13 ✅[^7], and Bun 1.3.14 (`oven/bun:1.3.14`) already printed `2x PARALLEL` for `--parallel=2` and gave each file a fresh global with `--isolate` ✅[^lab].
   - Workers start lazily: with files that finish in a few milliseconds, `--parallel --no-isolate` ran both files on worker 1 ✅[^lab] ✅[^3].
   - Each worker is a child process started as `bun test --test-worker --isolate --timeout=5000 --max-concurrency=20` (seen in `/proc` during a `--parallel=2` run) ✅[^lab].
   - Each worker gets `BUN_TEST_WORKER_ID` and `JEST_WORKER_ID` set to its 1-based slot; without `--parallel` both are unset ✅[^lab] ✅[^3].

**Modifiers and filters, as measured** ✅[^lab] ✅[^5]:

| Feature | Measured behaviour in 1.4.5 |
|---|---|
| `-t` / `--test-name-pattern` / `--grep` | A regex matched against the `describe` names and the test name joined by spaces: `-t "Math operations add"` ran `Math > operations > adds` (the report joins names with ` > `) and printed `2 filtered out` |
| `test.only` / `describe.only` without `--only` | Skips the other tests **in that file only**; a second file without `.only` still ran all its tests. With `--only`, only the marked tests of the whole run ran |
| `test.skip`, `test.if(false)`, `test.skipIf(true)` | Reported `(skip)` |
| `test.todo`, `test.todoIf(true)` | Reported `(todo)`, not run. With `--todo` they run, and a todo test that passes becomes a failure: `this test is marked as todo but passes` |
| `test.failing` | Passes when the body throws; a body that passes fails with `this test is marked as failing but it passed` |
| `test.each` / `describe.each` | Array rows spread into arguments (`%d + %d = %d` gave `1 + 2 = 3`), object rows are one argument (`$a + $b`), `%#` is the row index |
| `--bail` / `--bail=2` | Stopped after 1 (or 2) failures, printed `Bailed out after 1 failure`, exit code 1 |
| `--retry=1`, `{ retry: 3 }` | A test failing on attempt 1 reported `(pass) … (attempt 2)`; `{ retry: 3 }` ran 4 attempts, the per-test value overriding the flag |
| `{ repeats: 2 }` | Ran 3 times, reported `(run 3)` |
| `--rerun-each=3` | Ran the whole file 3 times, re-evaluating its module body each time |

**Jest compatibility in 1.4.5** ✅[^lab] ✅[^8]:
- `test`, `it`, `describe`, `expect`, `beforeAll`…`afterAll`, `jest` and `vi` are usable in a test file without an import; `mock` and `spyOn` are not, and none of them is a property of `globalThis`.
- **Those globals disappear from a file that imports the test module.** A file that loads `bun:test`, `vitest` or `@jest/globals` in any way (a named import such as `import { expect } from "bun:test"`, a namespace import, a default import, a bare `import "vitest"`, `require("bun:test")` or `await import("bun:test")`) gets none of them: a bare `test(...)` there fails with `ReferenceError: test is not defined`, reported as `# Unhandled error between tests`, 0 pass, 1 fail, and `import { test } from "bun:test"` alone leaves `expect` and `describe` undefined. A file with `import * as bt from "bun:test"` and `import * as v from "vitest"` fails the same way with either import removed, so neither is the culprit on its own. The globals stay with a type-only import (`import type { Mock } from "bun:test"`), with the text `"bun:test"` in a string or comment, and when only an imported helper module imports `bun:test` ✅[^lab]. Bun 1.3.14 behaved the same (`ReferenceError: test is not defined`), while in `1.4.6-canary.1` a file importing only `expect` still had `test` and `describe` as globals, as the live docs describe ✅[^lab] ✅[^11].
- `import … from "bun:test"`, `"@jest/globals"` and `"vitest"` all give the same objects (`v.test === b.test` printed `true`), with no `vitest` package installed.
- `jest` has `fn`, `spyOn`, `mock`, `setTimeout`, `useFakeTimers`, `useRealTimers`, `advanceTimersByTime`, `advanceTimersToNextTimer`, `runAllTimers`, `runOnlyPendingTimers`, `getTimerCount`, `clearAllTimers`, `isFakeTimers`, `setSystemTime`, `now`, `clearAllMocks`, `resetAllMocks` and `restoreAllMocks`. It lacks `doMock`, `unmock`, `requireActual`, `requireMock`, `resetModules`, `isolateModules`, `replaceProperty` and `advanceTimersByTimeAsync`. In `1.4.6-canary.1` all of these except `isolateModules` and `replaceProperty` are functions ✅[^lab].
- `jest.fn`, `vi.fn` and `mock` are one function (`jest.fn === mock` printed `true`).
- `expect` has `assertions`, `hasAssertions`, `extend`, `any`, `anything` and Bun's `unreachable`, but no `soft`, `poll` or `getState`; `expect.addSnapshotSerializer` exists but throws `Not implemented` ✅[^lab] ✅[^5]. All four work in `1.4.6-canary.1`, not in 1.4.5: a test with two failing `expect.soft()` calls reported both failures and still ran its last line, and `expect.poll(() => n).toBeGreaterThan(5)` resolved after 103 ms while a 10 ms interval counted up ✅[^lab] ✅[^12].
- Matchers from the community package jest-extended are built in: `toBeArrayOfSize`, `toStartWith`, `toInclude`, `toBeEven`, `toBeWithin`, `toBeOneOf`, `toContainKey`, `toBeTrue`, `toBeEmpty`, `toBeValidDate`, `toEqualIgnoringWhitespace` all passed without installing anything.
- `toContain` compares with `===` since 1.4.0: `expect([-0]).toContain(0)` passes and `expect([NaN]).toContain(NaN)` fails ✅[^lab] ✅[^7]. Bun 1.3.14 gave the opposite answers (`[-0]` failed, `[NaN]` passed), the `Object.is` rule the release notes say 1.4.0 replaced ✅[^lab] ✅[^7].
- `expect.assertions(2)` with one assertion failed with `expected 2 assertions, but test ended with 1 assertion` ✅[^lab] ✅[^5].
- `bun test` also ran 20 files written with `node:test` and `node:assert` (100 tests) unchanged ✅[^lab].

## Worked example
A suite where `b-users.test.ts` silently depends on `a-setup.test.ts`, run four ways in the lab ✅[^lab]:

```ts
// a-setup.test.ts
beforeAll(() => { (globalThis as any).db = { url: "sqlite://memory" }; }); // never cleaned up
test("a: db is configured", () => expect((globalThis as any).db.url).toBe("sqlite://memory"));
// b-users.test.ts
test("b: reads db created by another file", () => expect((globalThis as any).db?.url).toBe("sqlite://memory"));
```

| Step | Command | Result | Exit code |
|---|---|---|---|
| 1 | `bun test` | 2 pass: B passes only because A ran first in the same global | 0 |
| 2 | `bun test ./b-users.test.ts` | 0 pass, 1 fail: alone, B sees `undefined` | 1 |
| 3 | `bun test --isolate` | 1 pass, 1 fail: fresh global for B | 1 |
| 4 | `bun test --parallel` | `8x PARALLEL`, 1 pass, 1 fail | 1 |

Step 3 is the cheap check to add to CI (continuous integration): it finds the hidden dependency in one process, without the per-worker cost of `--parallel`.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Unknown flag, e.g. `--foo-bar`, `--environment=happy-dom`, `--globals=vitest` | Ignored silently; the run went ahead with exit code 0 and no DOM ✅[^lab]. `1.4.6-canary.1` still ignored `--foo-bar`, but `--environment` and `--globals` are real flags there (`bun/testing/test-config-coverage-reporters.md`) ✅[^lab] | 1.4.5 does not reject unknown `bun test` flags; `--environment` and `--globals` are not in its `--help` ✅[^lab] |
| Features on the live docs site: `aroundEach`/`aroundAll`, `test.extend` fixtures, `describe.shuffle`, `expect.soft`/`poll`, `--isolate=modules`, `VITEST_POOL_ID` | Not exported in 1.4.5; `--isolate=modules` failed with `The argument '--isolate' does not take a value.`; `VITEST_POOL_ID` was unset ✅[^lab]. All present in `1.4.6-canary.1`: `aroundAll` and `aroundEach` logged `all< each< a >each each< b >each >all`; a `test.extend({ db })` fixture set up before its test and tore down after it; `describe.shuffle` ran 10 tests in a shuffled order and printed a ` --seed=`; `--isolate=modules` evaluated the shared module once per file and undid file A's `globalThis` and `Array.prototype` changes before file B; `VITEST_POOL_ID` and `VITEST_WORKER_ID` were `1` without `--parallel` and the worker number with `--parallel=2` ✅[^lab] | bun.com/docs tracks a newer build: the live Test runner, Writing tests and Parallel pages list them ✅[^9] ✅[^12] ✅[^13]; the docs in the 1.4.5 source tree do not list them ✅[^1] ✅[^3] ✅[^4]. The canary's own `--help` says files under `--isolate=modules` "can see each other's changes to globals", while its run undid them, as the live Parallel page's table says ✅[^lab] ✅[^13] |
| Rejected promise at a file's top level, not awaited | `# Unhandled error between tests`, 0 pass, 1 error, exit 1: the file's tests did not run ✅[^lab] ✅[^6]. In `1.4.6-canary.1` the same file, and one that throws from a `queueMicrotask` callback, reported the error and still ran both tests (2 pass, exit 1); a rejected top-level `await` still stopped the file in both versions ✅[^lab] | The file failed to load in 1.4.5; the live docs describe the canary's behaviour ✅[^11] |
| Promise rejected but not awaited inside a test | That test fails with the error; the next test still runs ✅[^lab] | The runner catches unhandled promise rejections ✅[^6]; in the lab it charged this one to the running test |
| `{ repeats: 2 }` on a test while `--retry` is set | Load error `test(): Cannot set both retry and repeats`; the file's tests did not run ✅[^lab] | `retry` and `repeats` cannot be combined, and the flag sets `retry` for every test ✅[^5] |
| `async (done) => { done(); }` | Passed ✅[^lab] | A test that declares `done` must call it, whatever the function returns ✅[^5] |
| `test.each(["x"])("%s / %p")` | Title `x / %p`: the second specifier stays literal ✅[^lab] | A row that is not an array is passed as one argument ✅[^5] |
| `--parallel` with tiny files | The second worker may never start ✅[^lab] | Workers start only after the first has been busy for `--parallel-delay` ms (default 5) ✅[^3]; with `--parallel-delay=0` and 4 tiny files, three runs used worker 1 alone, workers 1–2, and workers 1–3, while the default delay used worker 1 in all three ✅[^lab] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| Default (one process, shared global) | Fastest for many small files: 20 files × 5 tests took a median of 15 ms ✅[^lab] | Files can leak globals, prototype patches and module state into each other ✅[^lab] ✅[^1] |
| `--isolate` | Fresh global and module registry per file, as Jest and Vitest do by default ✅[^3] | Every file re-evaluates its imports and preloads ✅[^3]: a module imported by 4 files ran 4 times instead of once; the 20-file `node:test` suite took a median of 186 ms (default 19 ms, `--parallel` 73 ms, same session), while 20 files that import `bun:test` took 9 ms (default 5 ms) ✅[^lab] |
| `--parallel` | Uses all cores: two 300 ms files went from a median of 622 ms to 331 ms ✅[^lab] | One process per worker: the 20-file suite took a median of 70 ms instead of 15 ms ✅[^lab] |
| `--parallel --no-isolate` | Workers keep one module registry, so imports load once per worker ✅[^3]: 4 files on 2 workers ran a shared import 2 times, once per worker, against 4 times with `--parallel=2` alone ✅[^lab] | Files on the same worker see each other's leftovers ✅[^lab] |
| `test.concurrent` / `--concurrent` | Overlaps waits inside a file (4 × 200 ms in about 200 ms) ✅[^lab] | Shares one thread and one global, so shared state needs `test.serial` ✅[^3]: test A set a module variable, awaited 50 ms, and read the value concurrent test B had written ✅[^lab] |
| `node --test` (Node 24) for the same 20 files | Each file in its own process by default ✅[^10]: the 20 files printed 20 process ids, and 1 with `--test-isolation=none` ✅[^lab] | Median 258 ms; 58 ms with `--test-isolation=none` ✅[^lab] (312 ms and 66 ms in a later session) |

The timings are 7 runs each, median, timed from inside the container (Docker on OrbStack, arm64, 8 cores), so they compare runners on this machine only. Where a later session measured the same suite again, both values are given; they differ by up to a quarter, so compare numbers from one session only.

## Takeaways
- Run the suite with `--isolate` (or `--parallel`) in CI, so a file that depends on an earlier file fails there instead of hiding until the file order changes. [rule-candidate]
- Do not commit `.only`; when you use it locally across several files, pass `--only`, because without it other files still run in full. [rule-candidate]
- Mark only I/O-bound tests `test.concurrent`; mark tests that share state `test.serial`.
- Check `bun test --help` of the installed version before using a flag from bun.com/docs: 1.4.5 ignores flags it does not know. [rule-candidate]
- In a test file, either import nothing from `bun:test`, `vitest` or `@jest/globals`, or import every test function the file uses; one import of any kind turns the injected globals off for that file. [rule-candidate]
- Clean up what a file puts on `globalThis` in `afterAll`, or move it to a preload script that every file is meant to share.

## Verification status
- Verified: 122 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; `node:24.22.1-alpine` ran the `node --test` comparison; `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`) ran the checks of features documented only on bun.com, and `oven/bun:1.3.14` (`1.3.14+0d9b296af`) the before-1.4 checks. [^lab]
- [Test runner (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/index.mdx) — Oven, 2026. Backs: file patterns, single process and shared global, timeout default, concurrency flags, `--retry`, GitHub Actions detection, no glob filters. [^1]
- [Finding tests (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/discovery.mdx) — Oven, 2026. Backs: exclusions, substring filters, `./` paths. [^2]
- [Parallel & isolated test runs (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/parallel.mdx) — Oven, 2026. Backs: `--isolate`, `--parallel`, lazy workers, worker IDs, `--no-isolate`, cooperative concurrency. [^3]
- [Lifecycle hooks (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/lifecycle.mdx) — Oven, 2026. Backs: hook scopes and nested order, preload hooks. [^4]
- [Writing tests (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/writing-tests.mdx) — Oven, 2026. Backs: timeout argument, `done`, retry and repeats, modifiers, `each`, assertion counting. [^5]
- [Runtime behavior (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/runtime-behavior.mdx) — Oven, 2026. Backs: `0` timeout, unhandled errors at load and between tests. [^6]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: `--pass-with-no-tests`, `toContain` with `===`, when `--parallel`/`--isolate` appeared. [^7]
- [`bun-types` test.d.ts at v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/test.d.ts) — Oven, 2026. Backs: `jest` and `vi` members, `setDefaultTimeout`, `HookOptions`. [^8]
- [Test runner (live docs)](https://bun.com/docs/test) — Bun documentation, living (read 2026-11-24). Backs: the live site documents features newer than 1.4.5 (Edge cases). [^9]
- [Command-line API: `--test-isolation`](https://nodejs.org/docs/latest-v24.x/api/cli.html#--test-isolationmode) — Node.js project, v24. Backs: `node --test` runs each file in a child process by default; `none` runs them in one process. [^10]
- [Runtime behavior (live docs)](https://bun.com/docs/test/runtime-behavior) — Bun documentation, living (read 2026-11-24). Backs: the live site says an unhandled rejection or error while a file loads still lets its tests run, while a top-level throw or a rejected top-level `await` stops the file; a file that imports only some test functions keeps the rest as globals (Edge cases, Jest compatibility). [^11]
- [Writing tests (live docs)](https://bun.com/docs/test/writing-tests) — Bun documentation, living (read 2026-11-24). Backs: `test.extend` fixtures and `expect.soft`/`poll` documented for a newer build (Edge cases). [^12]
- [Parallel & isolated test runs (live docs)](https://bun.com/docs/test/parallel) — Bun documentation, living (read 2026-11-24). Backs: `--isolate=modules` and `VITEST_POOL_ID` documented for a newer build (Edge cases). [^13]

## Related
- `bun/testing/mocks-snapshots-and-time.md` — mocks, module mocks, snapshots and fake timers.
- `bun/testing/test-config-coverage-reporters.md` — the flag and `bunfig.toml` catalog, coverage, reporters, DOM setup.
- `bun/node-compat/migrating-from-node.md` — replacing Jest in a Node project.
- `bun/fundamentals/configuration-and-environment.md` — `bunfig.toml` structure and `--preload`.
- `testing/characterization-tests.md` — pinning existing behaviour before a refactor.
- `js-runtime/promise-rejections.md` — unhandled rejections in Node.js.
- `performance/measurement/benchmarking-methodology.md` — how to time runs fairly.
- `linux/lab-setup.md` — the lab.
