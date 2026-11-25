---
schema: knowledge-doc/v1
type: concept
topic: bun/testing
status: verified
applies-to: ["Bun 1.4.5"]
last-verified: 2026-11-25
last-updated: 2026-11-25
tags: [bun, bun-test, mock, spyOn, mock-module, jest-mock, hoisting, live-bindings, snapshots, inline-snapshots, fake-timers, setSystemTime]
---

# Mocks, module mocks, snapshots and fake time in `bun test`

## Summary
**TL;DR:** `mock()` (the same function as `jest.fn` and `vi.fn`) records every call and result and can be given an implementation queue; `spyOn()` wraps an existing method until `mockRestore()` or `mock.restore()` puts it back ✅[^lab] ✅[^1]. `mock.module(specifier, factory)` replaces a module's exports even after it was imported, and existing ESM (ECMAScript module) imports and `require()` see the new values, but in 1.4.5 it is **not hoisted, and neither is `jest.mock`**: the original module has already run its side effects, and any value another module computed from it at import time keeps the real result ✅[^lab] ✅[^1]. Register such mocks in a `--preload` script, and expect a module mock to stay in place for later files unless you run with `--isolate` ✅[^lab]. Snapshots live in `__snapshots__/<file>.snap`, `-u` rewrites them, CI refuses to create new ones, and `toMatchInlineSnapshot()` rewrites the test file itself ✅[^lab] ✅[^2]. `setSystemTime()` freezes the clock at a date; `jest.useFakeTimers()` plus `advanceTimersByTime()` drives `setTimeout`, `setInterval`, `Date` and `performance.now()` ✅[^lab] ✅[^3] ✅[^4].
**Use this when:** you replace a dependency in a test, a module mock "does not work" or leaks into another file, a snapshot test fails only in CI (continuous integration), or you test code that waits for timers or reads the clock.
**Not this doc:** how files are run, hooks and modifiers → [bun-test-runner.md](bun-test-runner.md); the `-u` flag and `[test]` keys in a table → [test-config-coverage-reporters.md](test-config-coverage-reporters.md).

## Problem
- A test calls `mock.module()` (or `jest.mock()`, expecting Jest's behaviour) after its imports, and the code under test still uses the real value, or the real module already opened a connection while loading ✅[^lab] ✅[^5].
- A module mock or fake clock set in one file is still active in the next file, so that file passes or fails depending on run order ✅[^lab].
- Snapshot tests pass locally and fail in CI with `Snapshot creation is disabled in CI environments`, because the `.snap` file was never committed ✅[^lab].
- `jest.resetAllMocks()` in an `afterEach` suddenly makes mocks return `undefined` after an upgrade to 1.4 ✅[^lab] ✅[^4].

## Mental model
**Analogy:** a module mock is a new label on a shared drawer. Everyone who opens the drawer **from now on** (a live import binding, a later `import()` or `require()`) finds the new content. But anyone who already took a photocopy out of the drawer (a `const` computed while a module loaded) keeps the copy, and whatever the old content did when it was first put in the drawer (top-level side effects) has already happened.

**Artifact:** `greeter.ts` copies a value from `config.ts` while it loads; the test mocks `config.ts` after the imports (Bun 1.4.5 output in comments) ✅[^lab]:
```ts
// config.ts:  console.log("[config.ts evaluated: side effect ran]");
//             export function name() { return "real"; }  export const value = "real-value";
// greeter.ts: import { name } from "./config";
//             export const greetingAtLoad = "Hello " + name();   // computed once, at import time
//             export function greet() { return "Hello " + name(); }
import { test, mock } from "bun:test";
import { greetingAtLoad, greet } from "./greeter";
import { value } from "./config";
mock.module("./config", () => ({ name: () => "mock", value: "mock-value" }));
test("mock.module after static imports", () => {
  value;                 // "mock-value"  (live binding updated)
  greet();               // "Hello mock"  (name() looked up at call time)
  greetingAtLoad;        // "Hello real"  (the photocopy)
  require("./config").value; // "mock-value"
});
// printed first: [config.ts evaluated: side effect ran]
```

## How it works
**4 actors:**
- **The test code** — its job: create mocks and spies and call `mock.module()`, via the `bun:test` exports.
- **A mock function** — its job: record calls and return what its implementation queue says, via its `.mock` property.
- **The module registry** — its job: hold one instance of each loaded module and its exports, via ESM live bindings and the CommonJS cache that `mock.module()` patches.
- **The snapshot store and the fake clock** — their job: keep expected output and the current time, via `__snapshots__/*.snap` (or the test file itself) and a clock that only moves when the test advances it.

### 1. Mock functions and spies
- `mock(fn)` returns a function whose `.mock.calls`, `.mock.results` and `.mock.lastCall` record every call: `f(2); f(10); f(-1)` gave `calls [[2],[10],[-1]]` and `results` of type `return`, `return`, `throw` ✅[^lab] ✅[^1].
- One-shot values win over the default: `mockImplementation(() => "default").mockReturnValueOnce("first").mockImplementationOnce(() => "second")` returned `first, second, default, default`; `mockResolvedValueOnce("r1").mockResolvedValue("r*")` resolved `r1, r*, r*` ✅[^lab] ✅[^1].
- `spyOn(obj, "greet")` replaces the property with a recording wrapper that calls the original (`obj.greet === original` became `false`) until `mockRestore()` puts the original back (`true` again) ✅[^lab] ✅[^1].
- `using spy = spyOn(…)` restores at the end of the block (since 1.3.9): `"fake"` inside the block, `"real"` after it, in 1.4.5 and in Bun 1.3.14 (`oven/bun:1.3.14`) ✅[^lab] ✅[^4].

| Call | Recorded calls | Implementation | Spied method |
|---|---|---|---|
| `mockFn.mockClear()` / `mock.clearAllMocks()` | cleared (2 → 0) | kept (`plain()` still 42) | stays mocked (`"mA"`) |
| `mockFn.mockReset()` / `jest.resetAllMocks()` | cleared | dropped: `jest.fn(() => 42)` then returned `undefined` | stays a spy |
| `mockFn.mockRestore()` / `mock.restore()` | — | — | original back (`"A"`, `"B"`) |

All rows measured ✅[^lab]; `resetAllMocks` dropping implementations is new in 1.4.0, before that it behaved like `clearAllMocks` ✅[^4] ✅[^1]. Measured in Bun 1.3.14: after `jest.resetAllMocks()`, `jest.fn(() => 42)` still returned `42`, a `mockReturnValue("rv")` mock still `"rv"` and a spy still `"mA"`, with the call history cleared; 1.4.5 returned `undefined` for all three. `mockFn.mockReset()` on a single mock dropped the implementation in both versions ✅[^lab].

### 2. Module mocks: the order of events
Numbered timeline for the artifact above ✅[^lab] ✅[^1]:
1. **Runner → module registry (link and evaluate the test file's static imports):** `config.ts` runs (its `console.log` prints), then `greeter.ts` runs and stores `greetingAtLoad = "Hello real"`.
2. **Test code → module registry (top level of the test file):** `mock.module("./config", factory)` runs. The module is already loaded, so Bun patches its exports in place: the `value` binding in the test file and the `name` binding inside `greeter.ts` now point at the factory's values.
3. **Runner (the test runs):** `value` reads `"mock-value"`, `greet()` calls the mocked `name()`, `require("./config")` returns the patched exports, and `greetingAtLoad` is still the string made in step 1.

```
step 1 (load)                        step 2 (mock.module)            step 3 (test)
config.ts ── evaluated, side effect   config exports ← factory        value      → "mock-value"
   ▲                                    (patched in place)            greet()    → "Hello mock"
greeter.ts ─ greetingAtLoad="Hello real"  ─────── not re-run ──────▶  greetingAtLoad → "Hello real"
```

- **Not hoisted.** Jest's `babel-jest` moves `jest.mock()` calls above the imports ✅[^5]: under real Jest 30.5.2 (installed with npm in `node:24.22.1-alpine`), a CommonJS test that called `jest.mock("./config", …)` on the line after `require("./greeter")` got `"Hello mock"`, and `config.js` never ran; the same file under `bun test` printed the side effect and `"Hello real"` ✅[^lab]. In 1.4.5, `jest.mock`, `vi.mock` and `mock.module` are one function (`jest.mock === mock.module` printed `true`), and the same file written with `jest.mock` printed the side effect and `"Hello real"` ✅[^lab]. Hoisting is present in `1.4.6-canary.1` (the `oven/bun:canary` preview of the next release), not in 1.4.5: there the ES module test files with `vi.mock` or `jest.mock` after the imports, and the CommonJS one, got `"Hello mock"` from `greetingAtLoad` without `config.ts` running, and a factory that read a `vi.hoisted()` value worked; `mock.module()` stayed where it was written (`"Hello real"`, side effect printed), as the live docs say ✅[^lab] ✅[^6].
- **The fix: mock before the first import.** With the same `mock.module()` call in a preload (`bun test --preload ./preload-mocks.ts`), `config.ts` never ran and `greetingAtLoad` was `"Hello mock"` ✅[^lab] ✅[^1]. Calling `mock.module()` inside the test and then `await import("./greeter")` also gave `"Hello mock"` ✅[^lab].
- **`mock.restore()` does not undo a module mock:** after it, `value` was still `"mock-value"` ✅[^lab] ✅[^1].
- **It outlives the file (serial runs).** File A mocked `./config`; file B, which imported `./config` without mocking it, saw `mock-from-A`. With `--isolate`, B loaded the real module (its side effect printed) and saw `real-value` ✅[^lab]; `--isolate` clears the module registries between files ✅[^9]. In `1.4.6-canary.1` the mock ended with file A: without `--isolate`, B loaded the real module and saw `real-value` ✅[^lab] ✅[^6].
- The specifier is resolved like an `import` (relative path, absolute path or package name) ✅[^1]: `mock.module("/w/config.ts", …)` replaced what the file had imported as `./config` (also through `require("./config")`), `mock.module("labpkg", …)` replaced a package in `node_modules` for both the static import and `import("labpkg")`, and a later `mock.module("./config.ts", …)` replaced the same module again ✅[^lab].

### 3. Snapshots
- `toMatchSnapshot()` writes `__snapshots__/<test file>.snap` next to the test file on the first run (`snapshots: +4 added`); the key is the `describe` and test names plus a counter, and an optional hint becomes part of it ✅[^lab] ✅[^2]:
  ```
  // Bun Snapshot v1, https://bun.sh/docs/test/snapshots

  exports[`user two snapshots in one test 1`] = `"a"`;

  exports[`user two snapshots in one test: answer 1`] = `42`;

  exports[`user property matcher 1`] = `
  {
    "id": Any<Number>,
    "name": "x",
  }
  `;
  ```
- Values are printed with sorted keys, dates as ISO strings and functions as `[Function: hello]`; a property matcher such as `{ id: expect.any(Number) }` stores `Any<Number>` ✅[^lab] ✅[^2].
- A mismatch fails the test with a line diff (`-   "id": 1,` / `+   "id": 2,`), prints `snapshots: 3 passed, 1 failed`, and exits 1; `bun test -u` (`--update-snapshots`) rewrites the file ✅[^lab] ✅[^2].
- An entry whose test no longer exists is not reported; `-u` rewrites the file with only the entries of the tests that ran (2 entries became 1) ✅[^lab].
- `toMatchInlineSnapshot()` with no argument **rewrites the test file** on the first run (`snapshots: +2 added`), and the second run compares against the inserted text ✅[^lab] ✅[^2]. The file after the first run:
  ```ts
  expect({ hello: "world", n: 1 }).toMatchInlineSnapshot(`
    {
      "hello": "world",
      "n": 1,
    }
  `);
  expect(() => { throw new Error("Another error"); }).toThrowErrorMatchingInlineSnapshot(`"Another error"`);
  ```
- **In CI, no new snapshots** ✅[^lab] ✅[^2]:

  | Environment | New `toMatchSnapshot()` | New inline snapshot |
  |---|---|---|
  | `CI=true`, `CI=1`, `GITHUB_ACTIONS=true` or `BUILDKITE=true` | fails: `Snapshot creation is disabled in CI environments unless --update-snapshots is used`, exit 1 | fails: `Inline snapshot creation is disabled in CI environments …` |
  | the same plus `-u` | written (`+1 added`) | written |
  | `CI=false`, or no CI variable | written | written |

  Existing entries are still compared in CI: with `CI=true` a matching run passed (`4 snapshots`) and a changed value failed with the usual diff ✅[^lab].
- `expect.addSnapshotSerializer()` threw `Not implemented`, and `toMatchFileSnapshot` does not exist in 1.4.5 ✅[^lab] ✅[^2]. Both are present in `1.4.6-canary.1`, not in 1.4.5: the serializer call returned without an error, and `toMatchFileSnapshot("./snaps/out.txt")` created the folder and the file (`snapshots: +1 added`), passed on the next run, failed a changed value with a line diff, was rewritten by `-u`, and under `CI=true` refused to create a new file with the usual `Snapshot creation is disabled in CI environments` error ✅[^lab] ✅[^10].

### 4. System time and fake timers
- `setSystemTime(date | ms)` sets `Date.now()`, `new Date()` and `Intl.DateTimeFormat().format()` (`1577836800000`, `2020-01-01T00:00:00.000Z`, `1/1/2020`); `setSystemTime()` with no argument goes back to real time ✅[^lab] ✅[^3].
- The set time does not move: `Date.now()` changed by 0 ms across a real 50 ms sleep ✅[^lab].
- The `Date` constructor stays the same object (`Date === realDate` printed `true`), unlike Jest's fake timers, and `jest.now()` returns the mocked timestamp ✅[^lab] ✅[^3].
- `jest.useFakeTimers()` (or `vi.useFakeTimers()`) puts `setTimeout` and `setInterval` on a fake clock that moves only when the test advances it ✅[^lab] ✅[^4]; the release notes date it to 1.3.4, and in Bun 1.3.14 a 60 000 ms timeout fired after `advanceTimersByTime(60_000)` too ✅[^lab]. Measured with a 60 000 ms timeout and a 1000 ms interval ✅[^lab]:

  | Call | Timeout callback calls | Interval callback calls |
  |---|---|---|
  | `advanceTimersByTime(59_999)` | 0 | 59 |
  | `advanceTimersByTime(1)` | 1 | 60 |
  | `runOnlyPendingTimers()` | 1 | 61 |
  | `clearAllTimers()` | `getTimerCount()` became 0 | — |

- The fake clock also drives `Date.now()`, `performance.now()` and `Bun.sleep()`: `useFakeTimers({ now: new Date("2021-06-01T00:00:00Z") })` plus `advanceTimersByTime(1500)` moved both clocks by 1500 ms, and a pending `Bun.sleep(1000)` resolved only after `advanceTimersByTime(1000)` ✅[^lab].
- `setImmediate`, `process.nextTick` and `queueMicrotask` stay real: an `await new Promise(r => setImmediate(r))` resolved without advancing ✅[^lab].
- `runAllTimers()` also runs timers that callbacks schedule (order `1,2`), and `useRealTimers()` turns the fake clock off (`isFakeTimers()` → `false`) ✅[^lab] ✅[^8].
- **Missing in 1.4.5:** `vi.setSystemTime` (`undefined`; use `setSystemTime` or `jest.setSystemTime`), the `…Async` advance functions and `runAllTicks` ✅[^lab] ✅[^8]. In `1.4.6-canary.1`, `vi.setSystemTime`, `jest.advanceTimersByTimeAsync` and `jest.runAllTicks` are functions ✅[^lab].
- `process.env.TZ` can change during a run: the offset for 2020-07-01 was 240 for `America/New_York`, -420 for `Asia/Ho_Chi_Minh`, and 0 after `delete process.env.TZ` (UTC is the default in `bun test`) ✅[^lab] ✅[^3].

## Worked example
One snapshot's life, in the lab ✅[^lab]:

| Step | Command | Output | Exit code |
|---|---|---|---|
| 1 | `bun test` (no `__snapshots__` yet) | 3 pass, `snapshots: +4 added`, file `__snapshots__/snap.test.ts.snap` created | 0 |
| 2 | `bun test` | `4 snapshots, 4 expect() calls` | 0 |
| 3 | `ID=2 bun test` (the test now builds `id: 2`) | `(fail) user > shape`, diff `-   "id": 1,` / `+   "id": 2,`, `snapshots: 3 passed, 1 failed` | 1 |
| 4 | `ID=2 bun test -u` | 3 pass, `snapshots: +4 added`; the file now holds `"id": 2,` | 0 |
| 5 | `CI=true bun test` on a new test with no entry | `Snapshot creation is disabled in CI environments …`, prints the received value | 1 |

Commit the `.snap` file after step 4, so step 5 never happens in CI.

## Edge cases
| Case | What happens | Why |
|---|---|---|
| A failed `CI=true` run | Leaves `__snapshots__/new.test.ts.snap` holding only the header line `// Bun Snapshot v1, …` ✅[^lab] | Observed only; the docs do not mention it. Delete the file or run `-u` locally before committing |
| `jest.useFakeTimers()` and `setSystemTime()` in file A, no cleanup | File B saw `isFakeTimers true` and year 2000; with `--isolate` it saw `false` and 2026 ✅[^lab]. In `1.4.6-canary.1`, B saw `false` and 2026 without `--isolate` ✅[^lab] | Serial files share one global; `--isolate` restores fake timers between files ✅[^9]; the live docs, written for a newer build, say Bun restores them at the end of each file ✅[^7] |
| Live docs: `vi.mock`/`jest.mock` hoisting, `vi.hoisted`, module mocks removed when a file ends, timers restored at file end | Not the 1.4.5 behaviour, as the measurements above show ✅[^lab]; all four are the behaviour of `1.4.6-canary.1` (measurements above) ✅[^lab] | bun.com/docs tracks a newer build ✅[^6] ✅[^7]; the 1.4.5 docs only offer `--preload` ✅[^1] |
| `mock.module()` with a factory that returns a pending promise for an imported module | At the top level, `mock.module()` returned a `Promise`; right after the call the import still read `"real"`, and the first test started 302–307 ms later (3 runs, factory waiting 300 ms) with the mocked `foo` and `getFoo()`. Inside a test the returned promise resolved after about 200 ms, and only then did the import change; a synchronous factory returned `undefined` and applied at once. For a module not imported yet, `await import()` waited for the factory (205 ms) and the real module never ran ✅[^lab] | As the 1.4.5 docs say: Bun updates the module once the promise settles, and waits for pending top-level module mocks before the file's tests ✅[^1] |
| The same factory rejects | Awaited inside a test, `mock.module()` rejected with the factory's error and the module kept its real exports; at the top level the file stopped with `# Unhandled error between tests`, 0 tests run, exit 1 ✅[^lab] | Observed only: the 1.4.5 docs do not describe a rejecting factory |
| `mock.clearAllMocks()` on a spy set with `mockReturnValue("mA")` | Still returned `"mA"` ✅[^lab] | Clearing removes history, not implementations ✅[^1] |
| `vi` object | Has `fn`, `spyOn`, `mock`, the mock-reset helpers and the timer functions only, 15 keys; 45 in `1.4.6-canary.1`, including `hoisted` and `setSystemTime` ✅[^lab] ✅[^8] | 1.4.5's `vi` is an alias for part of `jest` ✅[^1] |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `mock.module()` in the test file | Local and readable; live bindings follow it ✅[^lab] | Side effects already ran; values computed at import time stay real; leaks into later files without `--isolate` ✅[^lab] |
| `mock.module()` in a `--preload` script | The real module never loads ✅[^lab] ✅[^1] | Applies to every file; hidden from the reader of the test |
| Mock, then `await import()` the code under test | Works per test without a preload ✅[^lab] | Every test must import dynamically |
| `toMatchSnapshot()` | Large values stay out of the test file, in `__snapshots__/<file>.snap` (Worked example) ✅[^lab] ✅[^2] | Review happens in a separate `.snap` diff |
| `toMatchInlineSnapshot()` | The expected value sits next to the assertion ✅[^2] | Bun edits your source file; refused in CI ✅[^lab] |

## Takeaways
- Put module mocks that must stop side effects, or that code reads at import time, in a `--preload` script; never rely on `jest.mock()` being hoisted in Bun 1.4.5. [rule-candidate]
- Run suites that use `mock.module()` or fake timers with `--isolate`, or undo them in `afterAll`, so they cannot leak into the next file. [rule-candidate]
- Commit `__snapshots__/` and inline-snapshot edits; CI will refuse to create them. [rule-candidate]
- Use `mock.clearAllMocks()` in `afterEach` when you only want fresh call history; `jest.resetAllMocks()` also removes implementations.
- Freeze time with `setSystemTime()` for date logic; use `jest.useFakeTimers()` only when you need timers to fire, and call `jest.useRealTimers()` at the end.

## Verification status
- Verified: 109 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-25

## References
- `linux/lab-setup.md` — the Bun 1.4.5 lab (`oven/bun:1.4.5` image, arm64) where every ✅[^lab] behaviour ran on 2026-11-24; the Jest comparison ran Jest 30.5.2, installed with npm inside `node:24.22.1-alpine`; `oven/bun:canary` (`1.4.6-canary.1+bd92f9bef`) ran the checks of features documented only on bun.com, and `oven/bun:1.3.14` (`1.3.14+0d9b296af`) the before-1.4 checks. [^lab]
- [Mocks (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/mocks.mdx) — Oven, 2026. Backs: mock properties and methods, spies, `mock.module`, live bindings, preload advice, clear/reset/restore, `vi` alias, path resolution. [^1]
- [Snapshots (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/snapshots.mdx) — Oven, 2026. Backs: file location and format, `--update-snapshots`, CI, inline snapshots, property matchers. [^2]
- [Dates and times (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/dates-times.mdx) — Oven, 2026. Backs: `setSystemTime`, `Date` identity, `jest.now()`, time zone. [^3]
- [Bun 1.4](https://bun.com/blog/bun-v1.4) — Bun blog, 2026. Backs: `jest.useFakeTimers()` and `advanceTimersByTime`, `resetAllMocks` change, `using spy`. [^4]
- [The Jest Object](https://jestjs.io/docs/jest-object) — Jest project, living. Backs: `babel-jest` hoists `jest.mock` calls. [^5]
- [Mocks (live docs)](https://bun.com/docs/test/mocks) — Bun documentation, living (read 2026-11-24). Backs: the live site describes hoisting and per-file mock removal (Edge cases). [^6]
- [Dates and times (live docs)](https://bun.com/docs/test/dates-times) — Bun documentation, living (read 2026-11-24). Backs: the live site describes timers restored at file end (Edge cases). [^7]
- [`bun-types` test.d.ts at v1.4.5](https://github.com/oven-sh/bun/blob/bun-v1.4.5/packages/bun-types/test.d.ts) — Oven, 2026. Backs: members of `jest` and `vi`. [^8]
- [Parallel & isolated test runs (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/parallel.mdx) — Oven, 2026. Backs: `--isolate` clears module registries and restores fake timers. [^9]
- [Snapshots (live docs)](https://bun.com/docs/test/snapshots) — Bun documentation, living (read 2026-11-24). Backs: `toMatchFileSnapshot()` documented for a newer build. [^10]

## Related
- `bun/testing/bun-test-runner.md` — execution model, `--isolate`, hooks and modifiers.
- `bun/testing/test-config-coverage-reporters.md` — flags and `bunfig.toml` keys, including `preload`.
- `bun/fundamentals/module-resolution-and-loaders.md` — how specifiers resolve and ESM/CommonJS interop.
- `javascript/modules/es-modules.md` — live bindings in ES modules.
- `javascript/async/event-loop-and-async-await.md` — timers, microtasks and `nextTick`.
- `linux/lab-setup.md` — the lab.
