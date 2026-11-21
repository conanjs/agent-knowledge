---
last-updated: 2026-11-21
---

# Knowledge research: researched docs whose every claim can be checked

> **Plain English:** a researched doc comes with its lab notebook. Every ✅ in the doc names a claim; the claim carries the source's exact words or a test you can re-run; a second agent that never saw the draft checked it. The notebook (`research/<topic>/<slug>/`) stays in git next to the doc.

**Use this when:** V asks to research a topic into the knowledge base ("research X", "deep dive into X with sources", "verify this doc"), or a researched doc's `applies-to` versions have aged (refresh).

**Example.** "How do Codex plugins load, and what does turning one off change?" The run plans two questions. Two researchers fetch the Codex config reference and plugin page. Script checks verify the claims a source states word for word. The verifier writes one experiment: turn a plugin off, start a session, count the skills. The doc `knowledge/ai-agents/codex-plugin-loading.md` cites `✅ (Q1-C3)`, and `research/ai-agents/codex-plugin-loading/` holds the quotes, the experiment and the verdicts.

## 1. Roles

| Role | Runs as | Model | Sees | Writes |
|---|---|---|---|---|
| **Orchestrator** | the `research-knowledge` skill, in the main session (a Claude Code subagent cannot start other subagents) | the session's model | everything | `plan.md`, the doc, runs every script |
| **Researcher**, 2–4 in parallel | the `research-researcher` agent, one per question | cheap: Claude Haiku, a cheap Codex model; set in each agent header | its own question, nothing else | `batches/<Qn>/sources.yaml`, `claims.yaml`, `.cache/<Qn>-S<n>.txt` |
| **Verifier** | the `research-verifier` agent, fresh context | Claude Sonnet, Codex high effort | claims, sources, cached pages, experiments, entailment pairs; **never the draft or plan.md** | verdicts in `claims.yaml`, `experiments/<id>/`, `verification.md`, verdicts in `entailment.yaml` |
| **Scripts** | `research-run.mjs` (`tools/research-run/`) | none (no tokens) | the run folder | merged files, quote-check results, replay output, entailment pairs, validation |

Why a separate verifier: whoever wrote a claim tends to confirm it. The verifier rebuilds the case from the sources and its own experiments. It writes each experiment from the claim's statement, not from the researcher's notes.

## 2. Flow

```
 1 Scope       Orchestrator searches knowledge/ (index.md, grep). Only the gaps get researched.
 2 Plan        research-run init <topic>/<slug> → plan.md (questions Q1…Qn, out of scope, done when, budget)
               → V approves → status: approved, approved: <date>
               Fast track: a refresh with ≤ 3 sources and no experiments needs no approval (RR-2).
 3 Research    one research-researcher per question, in parallel → batches/<Qn>/ + .cache/
 4 Merge       research-run merge → sources.yaml, claims.yaml (verdicts already there stay; nothing is dropped)
 5 Quotes      research-run quotes → a documented claim whose quotes are in the cached page: verified, no LLM.
               A failed quote, a missing page, a runtime or interpretive claim: left for the verifier.
 6 Verify      research-verifier: experiments for runtime claims, re-fetch for failed quotes, judgment for
               interpretive claims → verified | contradicted | unsupported (+ note), verification.md
               research-run replay → every experiment re-run, output = expected.txt after normalizing
               → status: verified (research-run validate passes)
 7 Draft       Orchestrator writes the doc from verified claims only: ✅ (id) for verified, ⚠️ unverified (id)
               for an unsupported claim worth keeping, contradicted claims left out. References lists the run folder.
 8 Entailment  research-run pairs → entailment.yaml (each ✅ sentence with its claim)
               research-verifier (fresh) → entails | overstates | unrelated; the orchestrator fixes the doc and repeats
 9 Check       research-run validate (status: published) → validate-knowledge → review-knowledge-doc → V commits
10 Refresh     when applies-to versions age: mode: refresh; re-fetch, quotes, verifier and replay; a changed claim
               becomes superseded (superseded-by the new one), never deleted
```

**Which claims need what:**

| Claim | Enough | Extra |
|---|---|---|
| A source states it (`documented`) | One primary source; the quote check verifies it | A second publisher when it is `critical`, or the only sources are secondary (RR-5) |
| Behaviour or a number (`runtime`) | An experiment whose `claims` list names it | A documented limit may also cite the vendor's own statement |
| A reading of several sources (`interpretive`) | The verifier's judgment, with a note | — |
| Sources disagree | The verifier records both and marks the claim it can support; the doc says they disagree | — |

`contradicted` blocks the doc (RR-8). `unsupported` is dropped, or kept as ⚠️ with the verifier's note.

## 3. Where each piece lives

| Piece | Path |
|---|---|
| Run folders (kept, next to the docs they back) | `research/<topic>/[<sub>/]<slug>/`, `.cache/` gitignored |
| The run schema, RR-1 … RR-15 | `schemas/research-run.schema.md` |
| The scripts and their scenarios | `tools/research-run/` (`pnpm run research -- <command> <run>`) |
| The orchestrator skill | `../../plugin/skills/research-knowledge/SKILL.md` (agent-knowledge plugin) |
| The two agents | `agents/research-researcher/`, `agents/research-verifier/`: `body.md` plus one header per coding agent, built and linked by agent-config's `build-agents.mjs` (its installer adds this folder through `agent-sources` in `installer/mapping.yaml`) |

Why `research/` sits outside `knowledge/`: the validator reads every Markdown file under `knowledge/` as a doc, and a run's `plan.md` and `verification.md` are not docs. The paths mirror each other: `knowledge/ai-agents/x.md` ↔ `research/ai-agents/x/`.

## 4. Design decisions

| Decision | Why | Rejected |
|---|---|---|
| 3 roles: one researcher per question, not a scout handing URLs to one reader per source | Fewer agent starts and handoffs; a researcher that picks its own sources also reads them | 5 roles (scout, reader, experimenter, verifier, orchestrator) |
| The verifier also writes the experiments | It tests the claim as stated, without the researcher's notes; independence is kept | A separate experimenter |
| Deterministic checks are scripts: merge, quote check, replay, pairs, validate | They cost no tokens and give the same answer every time | An LLM re-reading every source |
| Cached page text, quote check after normalizing | A documented claim whose exact words are in the page needs no second reading | Exact byte match (fails on line breaks and curly quotes) |
| Per-batch files, merged by a script | Parallel researchers never write the same file | One shared `claims.yaml` |
| The verifier judges entailment from (sentence, claim) pairs only | It cannot be swayed by the draft's argument; the script proves the pairs match the doc | A script-only entailment check (meaning needs judgment) |
| Run folders kept in git | The doc's claims stay auditable and the refresh starts from the old evidence | Deleting the run after publishing |
| Cost figures come from measurement (agent-config `efficiency-audit`, cheap models on Codex or Copilot) | No measurement exists yet | Estimates from a review |

## 5. Status and next steps

- Built on 2026-11-21: the schema, the scripts with their scenarios (one plants a wrong quote and checks it is caught), the skill, the two agents.
- Next: one real run on a small topic with a known answer, then measure tokens with a cheap model and tune the agents' wording (record it in `knowledge/ai-agents/instruction-wording-findings.md`), then the first refresh.

## References

- `schemas/research-run.schema.md` — the run folder's format and rules.
- `tools/research-run/research-run.mjs` — the scripts.
- `schemas/deep-dive.schema.md` — the usual shape of the researched doc, and synthesis into typed docs.

## Related

- `index.md` — the knowledge framework this workflow writes into.
