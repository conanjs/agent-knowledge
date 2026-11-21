---
name: research-knowledge
description: "Research a topic into the knowledge base so every claim can be checked: plan the questions (V approves), send one researcher agent per question, verify quotes by script, have a fresh verifier agent run experiments and judge the rest, then write the doc with claim ids and keep the evidence in research/<topic>/<slug>/. Use when asked to research a topic into agent-knowledge, write a sourced or verified deep dive, or refresh a researched doc whose versions have aged."
---

# Research a topic into the knowledge base

You are the orchestrator: you plan, start the agents, run the scripts and write the doc. The workflow, its roles and why it is built this way are in `frameworks/knowledge/research.md`; the run folder's format and rules RR-1 … RR-15 are in `frameworks/knowledge/schemas/research-run.schema.md`. Read both before step 2.

**Where:** the agent-knowledge clone. That is the working folder if it holds `frameworks/knowledge/research.md`, otherwise the `{{KNOWLEDGE_REPO}}` row of `~/.agent-config/global-variables.md`. Every command below runs from its root. `R` stands for the run folder `research/<topic>/<slug>`, and the scripts are `node frameworks/knowledge/tools/research-run/research-run.mjs` (`pnpm install` once first).

## 1. Scope

Search `knowledge/` first (`knowledge/index.md`, the topic's `index.md`, grep). Write down what the knowledge base already answers and which gaps are left; only the gaps get researched. A doc that already covers the subject is extended or refreshed, not duplicated.

## 2. Plan, then stop for V

`research-run.mjs init <topic>/<slug>`, then fill in `R/plan.md`:

- **Questions:** 2–4 lines `- Q<n>: …`, each answerable by one researcher.
- **Out of scope**, **Done when**, and **Budget:** researchers, at most this many sources, which questions need experiments.

Show V the plan and **wait for a yes.** Then set `status: approved` and `approved: <today>`. Exception, the fast track: a refresh with at most 3 sources and no experiments (RR-2).

## 3. Research: one agent per question, in parallel

Start one `research-researcher` agent per question, all at once. In Claude Code that is the Agent tool with that agent type; in Codex and Copilot, ask for that agent by name. Give each one only:

- the absolute path of `R`;
- its question id and text;
- the plan's out-of-scope lines and source budget;
- today's date.

Do not pass your own notes or the other questions. Each agent writes `R/batches/<Qn>/` and `R/.cache/`, and reports its claim ids.

## 4. Merge and check quotes (scripts, no agent)

```bash
node frameworks/knowledge/tools/research-run/research-run.mjs merge R
node frameworks/knowledge/tools/research-run/research-run.mjs quotes R
```

Fix every merge FAIL (RR-11, RR-12) in the batch files, never in the merged files. `quotes` verifies the documented claims whose quotes are in the cached page and lists the rest for the verifier.

## 5. Verify: a fresh agent

Start one `research-verifier` agent with only the absolute path of `R` and the job "claims". It reads `claims.yaml`, `sources.yaml`, `.cache/` and `experiments/`, never `plan.md` or the doc. It writes verdicts, experiments and `verification.md`. Then:

```bash
node frameworks/knowledge/tools/research-run/research-run.mjs replay R
```

Every experiment must pass. Set `status: verified` and run `validate R`; fix what fails. A failure in a claim goes back to the verifier, or to a researcher for a missing source. Do not edit a verdict yourself.

## 6. Write the doc

Write `knowledge/<topic>/<slug>.md`, usually a `deep-dive/v1` (`frameworks/knowledge/schemas/deep-dive.schema.md`), from **verified claims only**:

- each verified fact: `✅ (Q1-C2)`;
- an unsupported claim worth keeping: `⚠️ unverified (Q2-C1)`, with the verifier's note in your words;
- a contradicted claim: left out;
- where sources disagree: say so.

Write your own words, not the quotes (KB-1). Under References, list the sources by their URLs and the run folder: ``- `research/<topic>/<slug>/` — research run: plan, sources, claims, experiments, verification.`` Add the doc to its topic `index.md`.

## 7. Entailment: does each sentence say what its claim says?

```bash
node frameworks/knowledge/tools/research-run/research-run.mjs pairs R
```

Start a **fresh** `research-verifier` with the path of `R` and the job "entailment". It judges each pending pair in `entailment.yaml`.

For every `overstates` or `unrelated`: fix the sentence (or its claim id), then run `pairs` again and send the new pending pairs to a fresh verifier. Repeat until every pair says `entails`.

## 8. Check and hand over

Set `status: published` and `last-updated`, then run:

```bash
node frameworks/knowledge/tools/research-run/research-run.mjs validate R
pnpm run verify-before-commit
```

Then run the `review-knowledge-doc` skill on the doc. Report to V:

- the doc and the run folder;
- the claims, counted by verdict;
- the experiments;
- what was out of scope or left unverified.

**V decides the commit.** Commit the doc and `R` together (`.cache/` is gitignored).

## Refresh mode

When a researched doc's `applies-to` versions have aged, or V asks:

1. Set `mode: refresh` in the existing `plan.md`.
2. Re-fetch the sources into `.cache/`. For each claim whose source changed, a researcher adds a new claim to its batch and marks the old one `status: superseded` with `superseded-by: <new id>`.
3. Run steps 4, 5, 7 and 8 again.

Never delete a claim or an experiment (RR-12): git and the superseded claims keep the history.
