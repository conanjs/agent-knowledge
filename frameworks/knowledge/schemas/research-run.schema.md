---
schema: schema/v1
last-updated: 2026-11-21
---

# Schema: Research run (`research-run/v1`)

**Applies to:** `research/<topic>/[<sub>/]<slug>/`, one folder per researched doc · **Written by:** the research agents and `research-run.mjs` (`../research.md`) · **Read by:** the verifier, `research-run.mjs validate`, and anyone auditing a doc's claims · **Loaded as:** ③ (only when referenced)

A research run holds the evidence behind one doc. Each claim has its quote, the page it came from and the verifier's verdict; each claim about behaviour has a re-runnable experiment. The doc in `knowledge/` is what readers read. The run folder is how anyone can check it: it is kept in git next to the doc for good, and refreshed in place.

Analogy: the doc is the published paper; the run folder is its lab notebook and data set.

Example: `knowledge/ai-agents/codex-plugin-loading.md` and its run `research/ai-agents/codex-plugin-loading/`. The doc says "a turned-off plugin's skills do not load ✅ (Q1-C3)". In the run, `claims.yaml` has Q1-C3, which cites `sources.yaml` Q1-S2 and experiment `experiments/E-1/`.

## Layout

```
research/<topic>/<slug>/
├── plan.md            front matter (below) + Questions, Out of scope, Done when, Budget
├── batches/<Qn>/      one per researcher: sources.yaml, claims.yaml, ids prefixed with the question
├── sources.yaml       merged by `research-run merge`
├── claims.yaml        merged; the quote check and the verifier add verdicts
├── experiments/<id>/  experiment.yaml, run.mjs or run.sh, env.txt, expected.txt, output.txt; pinned dependencies
├── verification.md    the verifier's report, in prose
├── entailment.yaml    the doc's ✅ sentences paired with their claims (`research-run pairs`), with verdicts
└── .cache/            the fetched text of each source, <source-id>.txt; gitignored, never committed
```

## Front matter of `plan.md`

| Key | Required | Values / meaning |
|---|---|---|
| `schema` | yes | `research-run/v1` |
| `doc` | yes | The doc this run backs, `knowledge/<topic>/<slug>.md` |
| `mode` | yes | `new` (a new doc) · `refresh` (re-checking a doc whose `applies-to` versions aged) |
| `status` | yes | `planned` → `approved` (V approved the plan) → `verified` (every claim has a final verdict) → `published` (the doc is written and checked) |
| `approved` | from `approved` on | The day V approved the plan, `YYYY-MM-DD`; empty while planned |
| `last-updated` | yes | Date of the last change to the run |

Questions are lines `- Q<n>: <question>` under `## Questions`. Each researcher takes one question; its batch folder and ids carry that question (`batches/Q2/`, `Q2-S1`, `Q2-C3`).

## Entries

**Source** (`sources.yaml` → `sources:`):

| Key | Required | Values / meaning |
|---|---|---|
| `id` | yes | `Q<n>-S<n>` |
| `url` | yes | `https://…`, or a path for `retrieval-method: local` |
| `locator` | yes | Where in the page: a section anchor, a file path, a line range. Never the whole site |
| `title`, `publisher`, `version` | yes | The page's own title; who publishes it; the version it describes, or `living` |
| `tier` | yes | `primary` (spec, vendor docs, source code, the author's own site) · `secondary` (blogs, answers, articles about it) |
| `retrieved-at` | yes | `YYYY-MM-DD` |
| `retrieval-method` | yes | `web-fetch` · `gh-api` · `local` · `browser`: how to fetch it again |
| `applies-to` | no | `[{ name, version }]`, e.g. `{ name: codex-cli, version: ">=0.166" }` |

**Claim** (`claims.yaml` → `claims:`):

| Key | Required | Values / meaning |
|---|---|---|
| `id` | yes | `Q<n>-C<n>` |
| `statement` | yes | One atomic statement, in the researcher's own words |
| `kind` | yes | `documented` (a source states it) · `runtime` (behaviour or a number, needs an experiment) · `interpretive` (a reading of the sources; always goes to the verifier) |
| `evidence` | yes unless `experiment` | `[{ source, locator, quote }]`: the quote is the source's exact words, at most two sentences |
| `experiment` | for `runtime` | The `experiments/<id>/` that tests it |
| `critical` | no | `true` when the doc's main answer rests on it |
| `applies-to` | no | As for sources |
| `status` | merge sets `active` | `active` · `superseded` (with `superseded-by: <id>`) · `deprecated`. A claim is never deleted |
| `quote-check` | `quotes` writes it | `pass` · `fail` · `no-cache` |
| `verdict` | merge sets `pending` | `pending` · `verified` · `contradicted` · `unsupported` |
| `verified-by` | when verified | `quote-check` · `verifier` · `experiment` |
| `note` | when contradicted or unsupported | Why |

**Experiment** (`experiments/<id>/experiment.yaml`): `claims` (the claim ids its assertions test), `command` (run in the experiment folder), optional `timeout` (seconds, default 60), `expected-exit` (default 0), and `normalize` (`[{ pattern, replace }]`, extra regex replacements). `replay` always strips ANSI codes, ISO timestamps (`<time>`), durations such as `12ms` (`<duration>`), the folder's own path (`<dir>`) and trailing spaces.

**Entailment pair** (`entailment.yaml` → `pairs:`): `claim`, `sentence` (the doc's sentence or table cell, as `pairs` extracts it), `verdict`: `pending` · `entails` · `overstates` · `unrelated`.

**Claim markers in the doc:** `✅ (Q1-C2)` for a verified claim, `⚠️ unverified (Q2-C1)` for one kept with a warning; several ids are separated by commas, `✅ (Q1-C2, Q3-C1)`. In a researched doc every ✅ names its claims. The run folder is listed under References as a local artifact: ``- `research/<topic>/<slug>/` — research run: plan, sources, claims, experiments, verification.``

## Rules

| Id | Rule | Holds when | Enforced by |
|---|---|---|---|
| RR-1 | `plan.md` has the front matter above and at least one question; `init` never overwrites a run | the keys and values match | script |
| RR-2 | A run past `planned` names the day V approved it. Fast track: a `refresh` with at most 3 sources and no experiments needs no approval | `approved` is a date | script |
| RR-3 | Every source has the keys above, a targeted `locator` and an `https://` url (or a path, for local) | — | script |
| RR-4 | Every claim has the keys above; its evidence cites known sources with quotes; a `runtime` claim has an experiment folder; a `superseded` claim names an existing successor | — | script |
| RR-5 | A verified claim that is `critical`, or backed only by `secondary` sources, has sources from two publishers or an experiment. Otherwise one primary source is enough | — | script |
| RR-6 | Verdicts are final in a `verified` or `published` run (no `pending`). `verified-by: quote-check` only for a `documented` claim whose quote check passed; a claim verified by experiment is named in that experiment's `claims`. A `contradicted` or `unsupported` claim has a `note` | — | script |
| RR-7 | Every experiment has `experiment.yaml` (with `claims` and `command`), `env.txt` and `expected.txt`; a `package.json` has a lockfile and exact versions; from `verified` on, `output.txt` equals `expected.txt` | — | script |
| RR-8 | In a `published` run, the doc exists and lists the run folder under References. Every claim id it cites exists and is `active` and not contradicted; every ✅ cites a `verified` claim; no ✅ lacks an id | — | script |
| RR-9 | A `verified` or `published` run has `verification.md` | — | script |
| RR-10 | In a `published` run, every ✅ sentence has an entailment pair with verdict `entails`. A pair whose sentence left the doc warns. The script checks that the pairs match the doc; whether the sentence says what the claim says is the verifier's judgment | — | script + llm |
| RR-11 | `merge`: each batch folder is a question of the plan, and each id in it carries that question; ids are unique. Two sources with the same url and locator warn | — | script |
| RR-12 | `merge` never drops a claim that is already in `claims.yaml`: a claim that is no longer wanted is marked `superseded` or `deprecated` in its batch | — | script |
| RR-13 | `quotes`: each quote is in `.cache/<source-id>.txt` after normalizing (Unicode NFKC, plain quotes and dashes, no `*` or `` ` ``, runs of white space as one space). A documented claim whose quotes all match is verified by the quote check; a missing page or a quote that does not match goes to the verifier (warn), and an earlier quote-check verdict is withdrawn | — | script |
| RR-14 | A quote longer than 300 characters warns (KB-1: quotes are at most two sentences) | — | script (warn) |
| RR-15 | `replay`: every experiment exits with `expected-exit` within its timeout, and its normalized output equals `expected.txt` | — | script |

## Example

A claim verified by the quote check, and one by an experiment (from the tool's test fixture, `tools/research-run/tests/fixtures/base/`):

```yaml
claims:
  - id: Q1-C1
    statement: A widget holds at most 64 items.
    kind: documented
    evidence:
      - { source: Q1-S1, locator: "#limits", quote: A widget holds at most 64 items. }
    status: active
    verdict: verified
    quote-check: pass
    verified-by: quote-check
  - id: Q2-C1
    statement: Adding a 65th item throws a RangeError.
    kind: runtime
    experiment: E-1
    evidence:
      - { source: Q2-S1, locator: "#the-error", quote: the 65th item throws a RangeError }
    status: active
    verdict: verified
    quote-check: pass
    verified-by: experiment
```

## Checks

| Check | Tool |
|---|---|
| RR-1 … RR-15 | `node frameworks/knowledge/tools/research-run/research-run.mjs <command> <run>` (`pnpm run research -- …`) |
| The judgment parts: does a quote say what the claim says (interpretive claims), does a doc sentence say what its claim says (RR-10) | the `research-verifier` agent |

## References

**Local artifacts:**
- `../research.md`: the research workflow (roles, flow, gates) that produces runs.
- `../tools/research-run/`: the scripts and their scenarios.

## Related

- `deep-dive.schema.md`: the usual shape of a researched doc.
- `knowledge-doc.schema.md`: a researched fact can also land in a typed doc.
