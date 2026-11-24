---
schema: knowledge-doc/v1
type: concept
topic: deno/testing
status: verified
applies-to: ["Deno 2.9.8", "@std/assert 1.0.19", "@std/expect 1.0.20", "@std/testing 1.0.21"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [deno, testing, deno-test, test-steps, sanitizers, permissions, doc-tests, reporters, std-assert, std-expect, std-testing, spy, stub, fake-time, snapshot, bdd]
ranked-sources: true
---

# Testing in Deno: `deno test`, sanitizers, assertions and test doubles

## Summary
**TL;DR:** `deno test` collects files named `*_test.ts`, `*.test.ts` or `test.ts` (and anything under `__tests__/`), type-checks them, and runs every `Deno.test` they register. Each test carries its own options: `ignore`, `only`, `permissions` (which can only narrow what the command line granted), sanitizers, `t.step` sub-steps, `timeout` and `retry`. Since Deno 2.8 only the exit sanitizer is on by default, so a leaked timer or an unclosed file passes unless you opt in. Assertions come from `@std/assert` (plain functions) or `@std/expect` (Jest-style); spies, stubs and `FakeTime` come from `@std/testing`; snapshots are built in as `t.assertSnapshot()` since Deno 2.9, and the `@std/testing` `bdd` and `snapshot` modules are deprecated.
**Use this when:** writing or reviewing Deno tests; a test passes or fails for a reason its assertions do not explain (a leak, a permission, a stray `only`); choosing between `@std/assert`, `@std/expect` and `@std/testing`.
**Not this doc:** coverage and benchmarks → `deno/testing/coverage-and-benchmarks.md`; what each permission flag allows → `deno/security/permission-flags.md`; how permissions work → `deno/security/permission-model.md`; the `test` keys of `deno.json` → `deno/configuration/deno-json-reference.md`; `deno check` → `deno/fundamentals/running-code-and-typescript.md`; the lab → `deno/deno-lab-setup.md`.

## Problem
- A test that starts a 10-second timer, or opens a file and never closes it, prints `ok` in Deno 2.9: two of the three leak checks are off by default.
- `permissions: { env: true }` in a test does not grant environment access; it fails the test before its body runs.
- One forgotten `Deno.test.only` makes the whole run exit with code 1 although every test that ran passed.
- Code examples in JSDoc comments (JavaScript documentation comments) and READMEs rot unless something runs them.
- Older suites mix `@std/testing/snapshot`, which needs `--allow-read` and `-- --update`, with the built-in `t.assertSnapshot()`, which needs neither and updates with `-u`.

## Mental model
**Analogy:** `deno test` is a referee with a match sheet. Each `Deno.test` call writes one match onto the sheet while the file loads; the referee then plays the matches in order, hands each player a guest pass (its permissions, never wider than the stadium badge the command line issued), and after each match an inspector checks that nothing was left running in the room.

**Artifact:** one registration and the line the runner printed for it ✅[^run]:
```ts
// math_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { add } from "./math.ts";
Deno.test("add sums two numbers", () => { assertEquals(add(1, 2), 3); });
```
```text
add sums two numbers ... ok (11ms)
```

| Term | Analogy | Concrete artifact |
|---|---|---|
| Test step (`t.step`) | A chapter inside one match | `await t.step("create", () => {})` prints indented as `  create ... ok (0ms)` ✅[^run] |
| Sanitizer | The room inspector after each match | `sanitizeOps: true` turns a leaked `setTimeout` into `error: Leaks detected:` ✅[^run] |
| Per-test permissions | A guest pass that can only be narrower than the badge | `permissions: { read: false }` under `--allow-read` ✅[^run] |
| Assertion | A line judge who stops play on a fault | `assertEquals(add(2, 2), 5)` throws `AssertionError: Values are not equal.` ✅[^run] |
| Spy | A wiretap on a phone line: calls go through and are recorded | `const double = spy((x: number) => x * 2)` ✅[^mock] |
| Stub | A stand-in actor who replaces the real one | `stub(api, "fetchUser", returnsNext([...]))` ✅[^mock] |
| Fake time | A remote control for the clock | `using time = new FakeTime(); time.tick(60_000)` ✅[^time] |
| Snapshot | A photo of the expected output, compared on every run | `__snapshots__/snap_test.ts.snap` ✅[^snapshots] |
| Doc test | Cooking the recipe printed in the cookbook to prove it works | a fenced `ts` block in JSDoc run by `deno test --doc` ✅[^doctests] |
| Reporter | The scoreboard format | `--reporter=dot` prints `.` per pass and `!` per failure ✅[^run] |
| BDD (behaviour-driven development) | Grouping matches by league with `describe`, one match per `it` | `describe("Cart", () => { it("starts empty", …) })` ✅[^bdd] |

## How it works
**5 actors:**
- **`deno test` (the CLI, command-line interface)** — its job: collect test modules and set run-wide options, via the default file glob and flags.
- **The test module** — its job: register tests, via `Deno.test(...)` calls that run while the module loads.
- **The runner** — its job: run each registered test under its options, via per-test permissions, sanitizers, steps and timeouts.
- **Assertion and test-double libraries** — their job: decide pass or fail, via throwing an `AssertionError`.
- **The reporter** — its job: print results and set the exit code, via `pretty`, `dot`, `tap` or `junit`.

```text
[deno test — local]        [test module]          [runner — same process]        [reporter]
flags + glob
 ├─ finds *_test.ts, *.test.ts, test.ts, __tests__/*
 ├─ type-checks ("Check math_test.ts")
 ├─ first run only: fetches jsr:@std/* ══ network ══
 └────────────▶ loads module
                 Deno.test(...) × n ──▶ for each test (filter, only, ignore, shuffle):
                                         apply permissions (narrow only)
                                         run fn, t.step → nested steps
                                         sanitizers check, timeout, retry
                                                          └──────────▶ "name ... ok (1ms)"
                                                                        ERRORS, FAILURES,
                                                                        summary, exit 0 or 1
```

1. **`deno test` (local, then network once):**
   - Finds test files, via the glob `{*_,*.,}test.{ts, tsx, mts, js, mjs, jsx}` plus any script inside a `__tests__` folder ✅[^test-guide]. In the run, `a_test.ts`, `b.test.ts` and `__tests__/anything.ts` were picked and `helper.ts` was not ✅[^run]. `test.include` and `test.exclude` in the config file change the set ✅[^test-cli]; `--ignore=<path>` skips files ✅[^run].
   - Type-checks local modules first, via the bundled TypeScript (`Check a_test.ts`); `--no-check` skips it ✅[^run] ✅[^test-cli].
   - Downloads remote imports such as `jsr:@std/assert@1` (`Download https://jsr.io/@std/assert/1.0.19/mod.ts`), via the network; this is the only step that leaves the machine, and later runs use the cache ✅[^run].
   - With no test files found it prints `error: No test modules found` and exits 1; `--permit-no-files` makes that exit 0 ✅[^run].
2. **Test module (local):** registers tests at load time, via `Deno.test(name, fn)`, `Deno.test({ name, fn, ...options })`, `Deno.test(name, options, fn)` or `Deno.test(fn)` with a named function; a nested `Deno.test()` call is not supported, use `t.step()` ✅[^api].
3. **Runner (local, same process):** runs each test, via the options in §1 to §4 below; `console.log` inside a test is captured between `------- output -------` and `----- output end -----` ✅[^run].
4. **Assertion libraries:** fail a test, via throwing; the runner prints the error and a stack under ` ERRORS ` ✅[^run].
5. **Reporter:** prints one summary line such as `FAILED | 1 passed (2 steps) | 2 failed (2 steps) | 1 ignored (1 step) (648ms)` and `error: Test failed`, and exits 1 when any test failed ✅[^run].

### 1. Test options
| Option | Default | Effect, as run in 2.9.8 |
|---|---|---|
| `ignore` | off | `skipped on purpose ... ignored (0ms)` ✅[^run]; `Deno.test.ignore()` is the shorthand ✅[^api] |
| `only` | off | Runs only focused tests, then `error: Test failed because the "only" option was used`, exit 1 ✅[^run] ✅[^test-guide] |
| `permissions` | `"inherit"` | See §3 ✅[^api] |
| `sanitizeOps`, `sanitizeResources` | `false` | See §2 ✅[^api] |
| `sanitizeExit` | `true` | See §2 ✅[^api] |
| `timeout` (milliseconds) | none | `error: Test timed out after 200ms.`; the next test still runs ✅[^run] ✅[^api] |
| `retry` | `0` | `retrying (attempt 1 failed) (Uncaught Error: flaky)`, then `ok`; the summary adds `1 flaky` ✅[^run] ✅[^v29] |
| `repeats` | `0` | Runs the test that many extra times; every run must pass ✅[^api] |

- **Steps.** `t.step(name, fn)` runs a nested test and resolves `true` on success or `false` when ignored, without rejecting ✅[^api]. A failing step marks its parents `FAILED (due to 1 failed step)` and the failure is named by its path, `user flow ... update ... fails` ✅[^run]. `--filter` matches test names only: a matching test runs all its steps ✅[^test-cli].
- **Parameterized tests (Deno 2.9) and hooks (Deno 2.5).** `Deno.test.each([{ a: 1, b: 1, sum: 2 }, …])("$a + $b = $sum", fn)` registered tests named `1 + 1 = 2` and `2 + 3 = 5`; array cases with `"case %# adds %d and %d"` became `case 0 adds 1 and 2` ✅[^run] ✅[^v29]. `Deno.test.beforeEach(fn)` ran before every test and `Deno.test.afterAll(fn)` printed under `------- post-test output -------` ✅[^run]; the four hooks exist since Deno 2.5 ✅[^bdd]; before-hooks run first in, first out and after-hooks last in, first out ✅[^api].

### 2. Sanitizers
| Sanitizer | Option | Default | Message when it fires (2.9.8) |
|---|---|---|---|
| Async operations (ops) | `sanitizeOps` | off since Deno 2.8 ✅[^sanitizers] | `Leaks detected:` / `` - A timer was started in this test, but never completed. This is often caused by not calling `clearTimeout`. `` ✅[^run] |
| Resources | `sanitizeResources` | off since Deno 2.8 ✅[^sanitizers] | `` - A file was opened during the test, but not closed during the test. Close the file handle by calling `file.close()`. `` ✅[^run] |
| Exit | `sanitizeExit` | on ✅[^sanitizers] | `Error: Test case attempted to exit with exit code: 0`; the next test still ran ✅[^run] |

- **Five switches, highest precedence first:** the per-test option; `Deno.test.sanitizer({ ops: true, resources: true })` for the module; `--sanitize-ops` and `--sanitize-resources`; `DENO_TEST_SANITIZE_OPS=1` and `DENO_TEST_SANITIZE_RESOURCES=1`; `"test": { "sanitizeOps": true, "sanitizeResources": true }` in `deno.json` ✅[^sanitizers]. Each one turned the two leaks into failures in the run, and a per-test `sanitizeOps: false` beat the module default ✅[^run].
- **`--trace-leaks`** appends `The operation was started here:` and a stack ending at `file:///lab/leak_test.ts:2:3` ✅[^run].

### 3. Per-test permissions versus the command line
The `permissions` option can deny but not grant: anything the command line did not grant stays denied ✅[^test-guide]. Measured with `deno test --allow-read` (plus `--allow-env` for row 3) ✅[^run]:

| Test option | Inside the test |
|---|---|
| `{ read: false }` | `NotCapable: Requires read access to "a.txt", run again with the --allow-read flag` |
| `{ env: true }` (env not granted on the CLI) | Fails before the body runs: `NotCapable: Can't escalate parent thread permissions` |
| `{ read: true }` under `--allow-read --allow-env` | `read: granted env: prompt`: a kind the object leaves out is dropped ✅[^test-guide] |
| `{ read: ["./a.txt"] }` | `a.txt` reads; `/etc/hostname` fails with `NotCapable` |
| `"none"` | `Deno.permissions.querySync({ name: "read" }).state` is `prompt` |
| omitted (`"inherit"`) | `granted` |

### 4. Choosing, ordering and repeating tests
| Flag | Effect | Measured |
|---|---|---|
| `--filter <text>` or `--filter "/regex/"` | Runs tests whose name matches ✅[^test-cli] | `ok \| 2 passed \| 0 failed \| 2 filtered out` ✅[^run] |
| `--fail-fast[=N]` | Stops after N failures, 1 by default ✅[^test-cli] | The second failing test never ran: `FAILED \| 2 passed \| 1 failed` ✅[^run] |
| `--shuffle[=SEED]` | Shuffles test order ✅[^test-cli] | `--shuffle=1` ran `t3 t6 t4 t2 t1 t5`; seed 2 gave another order ✅[^run] |
| `--parallel` | Runs modules in parallel, CPU count or `DENO_JOBS` ✅[^test-cli] | Lines gain the file: `./many_test.ts => t1 ... ok (8ms)` ✅[^run] |
| `--watch` | Reruns when a file in the module graph changes ✅[^test-cli] | `Watcher Restarting! File change detected: "/lab/v.ts"` ✅[^run] |
| `--changed[=ref]`, `--related=<file>`, `--shard=I/N` | Deno 2.9: only tests that reach changed or named files; one of N groups of files ✅[^v29] ✅[^test-cli] | Not run in the lab |

### 5. Reporters
- `pretty` is the default; `--reporter` also takes `dot`, `tap` and `junit` ✅[^test-cli].
- `tap` printed `TAP version 14`, `ok 1 - connect ok`, `not ok 3 - parse header` with a JSON (JavaScript Object Notation) block, then `1..4` ✅[^run]. TAP is the Test Anything Protocol.
- `junit` printed JUnit XML (Extensible Markup Language) to stdout: `<testsuites name="deno test" tests="4" failures="1" ...>`; tests removed by `--filter` appeared as `<skipped/>` ✅[^run]. `--junit-path=report.xml` wrote the file and kept the pretty output ✅[^run] ✅[^test-cli].

### 6. Doc tests (`--doc`)
- `deno test --doc` evaluates fenced blocks tagged `js`, `javascript`, `mjs`, `cjs`, `jsx`, `ts`, `typescript`, `mts`, `cts` or `tsx` in JSDoc and Markdown ✅[^doctests]; a `sh` block was not run ✅[^run].
- The module's exports are imported for the snippet automatically ✅[^doctests]: `assertEquals(greet("Deno"), "Hello, Deno!")` ran without importing `greet` ✅[^run].
- A fence written `` ```ts ignore `` is skipped ✅[^doctests] ✅[^run]. A hashbang line such as `#!/usr/bin/env -S deno run --allow-env=MY_ENV_VAR` narrows the snippet's permissions, never beyond what `deno test` was granted ✅[^doctests].
- Each block becomes a test named after its file and lines; in 2.9.8: `file:///lab/greet.ts#5-9.ts ... ok (577µs)` ✅[^run].

### 7. Assertions: `@std/assert` and `@std/expect`
- **`@std/assert`** (JSR, the JavaScript Registry, version 1.0.19) holds functions that throw `AssertionError` with a diff ✅[^assert]. Run results ✅[^run]: `assertEquals` compares deeply; `assertStrictEquals({ a: 1 }, { a: 1 })` fails with `Values have the same structure but are not reference-equal.`; `assertThrows(fn, TypeError, "nope")` returns the error; `assertRejects` must be awaited; `assertObjectMatch` ignores extra keys.
- **`@std/expect`** (1.0.20) is a Jest-compatible `expect` ✅[^expect]. `expect({ id: 1, tags: ["a"] }).toEqual({ id: 1, tags: ["b"] })` printed the same `[Diff] Actual / Expected` block; `fn()` from the same package recorded calls for `toHaveBeenCalledWith(3)` ✅[^run]. `toThrowErrorMatchingSnapshot` and `toThrowErrorMatchingInlineSnapshot` are not supported ✅[^expect].

### 8. Test doubles and fake time (`@std/testing` 1.0.21)
```ts
// api.fetchUser, greetUser() and remindLater(cb) (a 60 s setTimeout) come from ./deps.ts; cb = spy()
const double = spy((x: number) => x * 2);
assertEquals(double(21), 42);
assertSpyCall(double, 0, { args: [21], returned: 42 });   // passed
{
  using s = stub(api, "fetchUser", returnsNext([Promise.resolve({ id: 1, name: "Ada" })]));
  assertEquals(await greetUser(1), "Hello, Ada");          // passed
}                                                          // `using` restored api.fetchUser
using time = new FakeTime(new Date("2026-11-24T00:00:00Z"));
remindLater(cb);  time.tick(59_999);  assertSpyCalls(cb, 0);
time.tick(1);     assertSpyCalls(cb, 1);                   // new Date() → 2026-11-24T00:01:00.000Z
```
- All four checks passed in the run, and a wrong count failed with `AssertionError: Spy not called as much as expected:` and a `-   1` / `+   2` diff ✅[^run].
- A spy keeps the original behaviour; a stub replaces it; `returnsNext` returns its values in order ✅[^mock] ✅[^mocking].
- Spies, stubs and `FakeTime` are disposable, so `using` restores the original at the end of the block; without `using`, call `.restore()` in a `finally` ✅[^mocking].
- `FakeTime` replaces `Date`, `setTimeout`, `setInterval` and related timers; `tick(ms)` advances the clock and runs timers that fall due ✅[^mocking] ✅[^time].

### 9. Snapshots and BDD
- **Built-in snapshots (Deno 2.9):** `await t.assertSnapshot(value)` needs no import ✅[^v29]. The first run without a snapshot failed with `AssertionError: Missing snapshot file.`; `deno test -u` printed ` > 1 snapshot updated.` and wrote `__snapshots__/snap_test.ts.snap` with ``snapshot[`user card 1`] = …`` keyed by test name and counter; a changed value failed with `Snapshot does not match:` and the hint `deno test --update-snapshots [files]...` ✅[^run]. The default location needs no read or write permission ✅[^snapshots] ✅[^run].
- **`@std/testing/snapshot`** is deprecated and will be removed in 2.0.0 ✅[^snapshot-std]. Its `assertSnapshot(t, value)` needs `--allow-read`, and `--allow-write` plus `-- --update` to write ✅[^snapshot-std] ✅[^run].
- **`@std/testing/bdd`** is deprecated too; the replacements are `node:test`'s `describe`/`it` or flat `Deno.test()` with `Deno.test.beforeEach()` and friends ✅[^bdd]. A top-level `describe` registers a `Deno.test` and nested suites and `it` run as `t.step`, so they cannot set `permissions` ✅[^bdd]; the run counted `ok | 2 passed (4 steps)` for two `describe` blocks holding four `it` ✅[^run].

## Worked example
One file, four tests, run with `deno test` in a clean container ✅[^run]:
```ts
// math_test.ts (add() is imported from ./math.ts and returns a + b)
Deno.test("add sums two numbers", () => { assertEquals(add(1, 2), 3); });
Deno.test("add is wrong on purpose", () => { assertEquals(add(2, 2), 5); });
Deno.test({ name: "skipped on purpose", ignore: true, fn: () => {} });
Deno.test("user flow", async (t) => {
  await t.step("create", () => {});
  await t.step("update", async (t) => {
    await t.step("rename", () => {});
    await t.step("fails", () => { throw new Error("step broke"); });
  });
  await t.step({ name: "ignored step", ignore: true, fn: () => {} });
});
```
```text
running 4 tests from ./math_test.ts
add sums two numbers ... ok (11ms)
add is wrong on purpose ... FAILED (460ms)
skipped on purpose ... ignored (0ms)
user flow ...
  create ... ok (0ms)
  update ...
    rename ... ok (0ms)
    fails ... FAILED (4ms)
  update ... FAILED (due to 1 failed step) (14ms)
  ignored step ... ignored (1ms)
user flow ... FAILED (due to 1 failed step) (19ms)

 ERRORS 

add is wrong on purpose => ./math_test.ts:8:6
error: AssertionError: Values are not equal.

    [Diff] Actual / Expected

-   4
+   5
(stack trace and the step error cut here)
FAILED | 1 passed (2 steps) | 2 failed (2 steps) | 1 ignored (1 step) (648ms)

error: Test failed
```
Reading it: `-` marks the actual value (4) and `+` the expected one (5); `./math_test.ts:8:6` points at the `Deno.test` call; the step counts in brackets (`2 steps` passed: `create`, `rename`) are separate from the test counts; the process exited with code 1.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A test leaves a 10-second timer and an open file | `ok \| 2 passed ... (42ms)`: the runner did not wait for the timer ✅[^run] | Ops and resource sanitizers are off by default since Deno 2.8 ✅[^sanitizers] |
| `sanitizeOps: true` and an un-awaited `Deno.readTextFile` | The test passed in the run ✅[^run] | Not stated in the docs; do not rely on the sanitizer to find every missing `await` |
| A promise that never settles, with no `timeout` | Fails at once: `Promise resolution is still pending but the event loop has already resolved.` ✅[^run] | As the message says, the event loop had nothing left to run; a test that waits on a slow timer needs `timeout` instead |
| `expect.assertions(1)` inside `Deno.test` | `` AssertionCounter was not cleaned up: … ensure `expect.hasAssertion` and `expect.assertions` are only run in bdd tests ``, reported as an uncaught error of the module ✅[^run] | The message itself says these two calls belong in `bdd` tests |
| `@std/testing/bdd` page says `sanitizeOps` "Defaults to true" ✅[^bdd] | A leaked timer inside `it` passed in 2.9.8 ✅[^run] | The run follows the runtime's documented 2.8 default ✅[^sanitizers]; trust that over the module page |
| Doc-test name | Docs show `example.ts$4-10.ts` ✅[^doctests]; 2.9.8 printed `file:///lab/greet.ts#5-9.ts` ✅[^run] | Docs and run differ; the run shows the format 2.9.8 prints |
| `deno test -u` with `@std/testing/snapshot` | Still `AssertionError: Missing snapshot file.` ✅[^run] | `-u` updates only `t.assertSnapshot()` ✅[^test-cli]; the module reads `-- --update` ✅[^snapshot-std] |
| Snapshot diff signs | `+ "guest"` is the new value and `- "admin"` the stored one under `[Diff] Actual / Expected` ✅[^run] | The reverse of `assertEquals`, where `-` is actual |
| A file written into the project folder while `--watch` runs (here the watcher's own log) | `Watcher Restarting! File change detected: "/lab/w.log"` over and over; a one-off change to an unrelated `notes.txt` restarted with `ok \| 0 passed` ✅[^run] | The watcher reacts to files outside the module graph too; keep logs and outputs elsewhere |
| `permissions: "none"` then `querySync` | `prompt`, not `denied` ✅[^run] | Not explained in the docs; test for `state !== "granted"`, not `=== "denied"` |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `@std/assert` functions | Plain functions that throw with a diff; browser-compatible ✅[^assert] | Less familiar to Jest users |
| `@std/expect` | Jest-style matchers and `fn()` mocks ✅[^expect] | `expect.assertions` needs `bdd`, which is deprecated ✅[^run] ✅[^bdd] |
| Flat `Deno.test` with `t.step` and `Deno.test.*` hooks | Every option per test: permissions, sanitizers, timeout ✅[^api] | Grouping is by hand |
| `node:test` `describe`/`it` | The same suite runs on Node.js; equally supported by `deno test` ✅[^test-guide] | No `sanitizeOps`, `sanitizeResources` or `permissions` options ✅[^bdd] |
| Built-in `t.assertSnapshot()` | No import, no permissions, `-u` ✅[^snapshots] | Deno 2.9 or newer only ✅[^v29] |

## Takeaways
- Turn on the ops and resource sanitizers for the whole project in `deno.json` (`"test": { "sanitizeOps": true, "sanitizeResources": true }`), since Deno 2.8 leaves them off. [rule-candidate]
- Grant the suite's permissions on the `deno test` command line, as narrow as possible, and use the per-test `permissions` option only to narrow further; it cannot widen. [rule-candidate]
- Never commit `only`: the run exits 1 even when every focused test passes. [rule-candidate]
- Write new suites with flat `Deno.test`, `t.step` and `t.assertSnapshot()`; `@std/testing/bdd` and `@std/testing/snapshot` are deprecated. [rule-candidate]
- Declare spies, stubs and `FakeTime` with `using` so the originals come back even when an assertion throws. [rule-candidate]
- Add `deno test --doc` to continuous integration (CI) so JSDoc and README examples keep running.

## Verification status
- Verified: 128 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- Commands run on 2026-11-24 with `denoland/deno:alpine-2.9.8` (Deno 2.9.8, V8 15.0.245.2-rusty, TypeScript 6.0.3, Alpine 3.24.2, aarch64) in the lab of `deno/deno-lab-setup.md`; outputs as quoted in Mental model, How it works, Worked example, Edge cases and Trade-offs. [^run]
- [Testing](https://docs.deno.com/runtime/test/) — Deno project, living. Rank 1. Backs: file glob and `__tests__`, `only` failing the run, `Deno.test` and `node:test` equally supported, permissions deny but do not grant, unlisted kinds denied. [^test-guide]
- [deno test](https://docs.deno.com/runtime/reference/cli/test/) — Deno project, living. Rank 1. Backs: `--filter` and steps, `test.include`/`test.exclude`, `--no-check`, `--fail-fast`, `--shuffle`, `--parallel` and `DENO_JOBS`, `--watch`, `--changed`/`--related`/`--shard`, reporters, `--junit-path`, `-u` for `t.assertSnapshot()`. [^test-cli]
- [Testing - Deno documentation](https://docs.deno.com/api/deno/testing/) — Deno project, living. Rank 1. Backs: call forms, option defaults, `t.step` results, hook order, `Deno.test.ignore`. [^api]
- [Test sanitizers](https://docs.deno.com/runtime/test/sanitizers/) — Deno project, living. Rank 1. Backs: the three sanitizers, defaults since 2.8, the five switches and their precedence. [^sanitizers]
- [Documentation tests](https://docs.deno.com/runtime/test/doc_tests/) — Deno project, living. Rank 1. Backs: evaluated languages, automatic imports, `ignore`, hashbang permissions, the documented test name. [^doctests]
- [Snapshot testing](https://docs.deno.com/runtime/test/snapshots/) — Deno project, living. Rank 1. Backs: `__snapshots__/<file>.snap`, no permissions in the default location. [^snapshots]
- [Mocking and test doubles](https://docs.deno.com/runtime/test/mocking/) — Deno project, living. Rank 1. Backs: spy versus stub, `using` and `restore()`, what `FakeTime` replaces. [^mocking]
- [Deno 2.9](https://deno.com/blog/v2.9) — Deno project, 2026. Rank 1. Backs: built-in `t.assertSnapshot()`, `Deno.test.each`, `retry` and the `flaky` label, change-aware selection and sharding. [^v29]
- [@std/assert](https://jsr.io/@std/assert) — Deno project on JSR, living. Rank 1. Backs: assertions throw `AssertionError` with a diff; browser-compatible; version 1.0.19. [^assert]
- [@std/expect](https://jsr.io/@std/expect) — Deno project on JSR, living. Rank 1. Backs: Jest-compatible `expect`; unsupported matchers; version 1.0.20. [^expect]
- [mock - @std/testing](https://jsr.io/@std/testing/doc/mock) — Deno project on JSR, living. Rank 1. Backs: `spy`, `stub`, `returnsNext`, `assertSpyCall(s)`. [^mock]
- [time - @std/testing](https://jsr.io/@std/testing/doc/time) — Deno project on JSR, living. Rank 1. Backs: `FakeTime`, `tick`. [^time]
- [snapshot - @std/testing](https://jsr.io/@std/testing/doc/snapshot) — Deno project on JSR, living. Rank 1. Backs: deprecation, `--allow-read`/`--allow-write`, `-- --update`. [^snapshot-std]
- [bdd - @std/testing](https://jsr.io/@std/testing/doc/bdd) — Deno project on JSR, living. Rank 1. Backs: deprecation and replacements, the `Deno.test` hooks since Deno 2.5, `describe`/`it` mapping to `Deno.test`/`t.step`, no permissions on nested suites, the stale "Defaults to true". [^bdd]

## Related
- `deno/testing/coverage-and-benchmarks.md` — measuring which code the tests ran, and timing code with `deno bench`.
- `deno/security/permission-model.md` — why a test can narrow but never widen its permissions.
- `deno/security/permission-flags.md` — the flags to pass to `deno test`.
- `deno/configuration/deno-json-reference.md` — the `test` section of `deno.json`.
- `testing/characterization-tests.md` — pinning existing behaviour before a change, in any language.
