---
schema: topic-index/v1
kind: subtopic
topic: bun/testing
last-updated: 2026-11-25
---

# Testing with `bun test`

Bun's built-in, Jest-style test runner as it behaves in Bun 1.4.5, measured in the lab: how it finds test files and runs them (one shared process by default, `--isolate`, `--parallel`), hook order, concurrency, timeouts and modifiers, how far it matches Jest; mock functions, spies and module mocks (including why `mock.module()` and `jest.mock()` are not hoisted), snapshots and fake time; and a lookup catalog of `bun test` flags, `[test]` keys of `bunfig.toml`, coverage, reporters and DOM (Document Object Model) setup with happy-dom. Not covered here: the `bunfig.toml` file itself and `.env` loading (see `bun/fundamentals/configuration-and-environment.md`), replacing Jest in an existing Node project step by step (see `bun/node-compat/migrating-from-node.md`), and the `node:test` module's own API.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [bun-test-runner.md](bun-test-runner.md) | concept | File discovery, the shared-global execution model and what `--isolate` and `--parallel` change (with measured costs), hook order, concurrency, timeouts, filters and modifiers, Jest compatibility and when the injected Jest globals disappear, and which bun.com-only features (`aroundEach`, `test.extend`, `--isolate=modules`, …) the `1.4.6-canary.1` build has | verified |
| [mocks-snapshots-and-time.md](mocks-snapshots-and-time.md) | concept | `mock()`, `spyOn()` and restoring, `mock.module()` timing, live bindings and async factories, no hoisting (compared with real Jest), snapshot files, inline snapshots and CI (continuous integration), `setSystemTime` and fake timers; hoisting, per-file mock removal and `toMatchFileSnapshot` checked in the 1.4.6 canary, `resetAllMocks` in 1.3.14 | verified |
| [test-config-coverage-reporters.md](test-config-coverage-reporters.md) | reference | Every `bun test` flag and `[test]` key with defaults, each checked in the lab, coverage reporters and per-file thresholds, JUnit, GitHub Actions output format, `--watch`, happy-dom setup; `--environment`, `--globals` and JUnit folder creation in the 1.4.6 canary, and the flag lists of 1.3.14, 1.4.5 and the canary | verified |

## References
- [Test runner (docs at v1.4.5)](https://github.com/oven-sh/bun/blob/bun-v1.4.5/docs/test/index.mdx) — Oven, 2026. Backs: the scope of the runner in the version these docs describe.
- [Test runner (live docs)](https://bun.com/docs/test) — Bun documentation, living. Backs: the current docs section, which describes builds newer than 1.4.5.

## Related
- `bun/fundamentals/configuration-and-environment.md` — `bunfig.toml`, `--preload`, `.env` files.
- `bun/node-compat/migrating-from-node.md` — moving a Jest suite to `bun test`.
- `testing/characterization-tests.md` — pinning behaviour before a refactor.
- `linux/lab-setup.md` — the lab where every behaviour ran.
