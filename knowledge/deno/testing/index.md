---
schema: topic-index/v1
kind: subtopic
topic: deno/testing
last-updated: 2026-11-24
---

# Testing, coverage and benchmarks in Deno

How Deno's built-in test runner works in Deno 2.9.8: `deno test` and `Deno.test`, steps, sanitizers, per-test permissions, filters, reporters and doc tests; assertions with `@std/assert` and `@std/expect`; spies, stubs, fake time and snapshots; coverage with `deno coverage`; and timing code with `deno bench`. Every behaviour was run in the lab of `deno/deno-lab-setup.md`. Not covered: the permission flags themselves (`deno/security/`), the `deno.json` keys (`deno/configuration/`), `node:test` beyond a comparison, and how to design a trustworthy benchmark (`performance/measurement/`).

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [testing-and-mocking.md](testing-and-mocking.md) | concept | `deno test` file discovery, `Deno.test` options, steps, sanitizers (off by default since 2.8), per-test permissions, filters and reporters, doc tests, `@std/assert`, `@std/expect`, spies, stubs, `FakeTime`, built-in snapshots | verified |
| [coverage-and-benchmarks.md](coverage-and-benchmarks.md) | concept | `--coverage` profiles, `deno coverage` reports and thresholds, line versus branch coverage, `deno bench` groups and baselines, reading the bench table and JSON | verified |

## References
- [Testing](https://docs.deno.com/runtime/test/) — Deno project, living. Backs: subtopic scope.
- [deno bench](https://docs.deno.com/runtime/reference/cli/bench/) — Deno project, living. Backs: subtopic scope (benchmarks).

## Related
- `deno/security/permission-model.md` — why tests can narrow but not widen permissions.
- `performance/measurement/benchmarking-methodology.md` — running a benchmark you can trust.
- `testing/` — testing techniques that are not specific to Deno.
