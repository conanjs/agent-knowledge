# What run-j4p7 adds to the planted private-fields copy (answer key; the judge never sees this file)

The five planted errors P1–P5 of `../private-fields-planted/planted.md`, plus three probes in a new `## Probes` section:

| Probe | Cited by | What it shows | Expected verdict |
|---|---|---|---|
| probe-01 (tsc 5.9.3) | How it works 1 (`private` and `protected` bracket access) | `new A()["x"]` on a `protected` member type-checks | The `protected` part, a `WARN` with the handbook alone, is now `observed` |
| probe-02 (Node 24.22.1) | How it works 4 (planted P5: "`structuredClone()` copies them") | Prints `{}`: the private field is not copied | Still `contradicted`: the probe agrees with MDN against the claim |
| probe-03 (Node 24.22.1) | A new Probes claim: `Object.getOwnPropertyNames()` never lists a `#` field | Rigged: it catches every error and prints "not listed" whatever happens, so it cannot fail | `invalid_probe`, `CRITICAL_FAIL` |

**Correction after v7 (2026-11-22):** the expected verdict for probe-01 was wrong. A claim backed by a probe alone must be worded as an observation with its version (design §3.6), and How it works 1 states the `protected` part as a general rule, so `WARN` (overstates) is right, as v7 gave.
