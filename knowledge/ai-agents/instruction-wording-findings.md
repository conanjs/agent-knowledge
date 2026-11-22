---
schema: knowledge-doc/v1
type: reference
topic: ai-agents
status: verified
applies-to: ["Claude Code 2.1.318 with Claude Opus 5.5", "GitHub Copilot CLI 1.0.105 with Claude Sonnet 5.5", "Codex CLI 0.166.0-alpha.6 with gpt-6.1-sol and gpt-6-luna", "runs of 2026-11-07 and 2026-11-09", "knowledge-judge prompt runs of 2026-11-22 (Claude Code subagents, Claude Opus 5.5)"]
last-verified: 2026-11-10
last-updated: 2026-11-22
tags: [instructions, wording, compliance, triggers, agents-md, claude-md, copilot-instructions, measurement]
---

# How coding agents follow instruction wording: tested findings

## Summary
**TL;DR:** A log of how real coding agents followed specific instruction wordings in measured runs. Each entry gives the exact words, the agents and models, the count of runs that complied, and the date. The pattern so far: a trigger the agent can see in its context (a tag, a phrase, a placeholder) is followed almost every time. A condition the agent must look up (does a graph exist?) makes it read files to find out. A layout called "default" is treated as optional, and `gpt-6.1-sol` skipped it every time. Naming the cases ("every response, including drafts, emails and short answers") fixed it in all three agents.
**Use this when:** writing or changing agent instructions, skills, prompts or `AGENTS.md` / `CLAUDE.md` files, choosing between wordings, or planning a test of a new wording.
**Not this doc:** what the instructions cost in tokens → `tokenizers-for-coding-agents.md` and `agent-token-accounting.md`; general prompt technique → `prompt-engineering-deep-dive.md`.

## Scope
Covered: wordings in this repo's global instructions (`copilot/instructions/`) and in the candidate core of `proposals/instruction-loading.md`, as followed by three agents:
- Claude Code 2.1.318 with Claude Opus 5.5;
- GitHub Copilot CLI 1.0.105 with Claude Sonnet 5.5;
- Codex CLI 0.166.0-alpha.6 with `gpt-6.1-sol`.

The runs were scripted (`claude -p`, `copilot -p`, `codex exec`), in a small test project, two runs per prompt and wording. Copilot Chat in VS Code and other models are not covered yet. Each count is "runs that complied / runs".

IW-16 and IW-17 are a different kind of wording: an agent prompt in agent-knowledge (the knowledge-judge), run as Claude Code subagents on Claude Opus 5.5, one run per prompt version and test doc.

**Analogy:** a recipe card in a busy kitchen. "When the order says *vegan*, use the blue binder" works, because the cook sees the word on the order. "When the pantry has saffron, use the red binder" makes the cook walk to the pantry to check. "The default plate has four sides" gets ignored when the order is a quick snack.

## Catalog

### Findings

| Id | Wording tested (exact) | What the agents did | Claude Code, Claude Opus 5.5 | Copilot CLI, Claude Sonnet 5.5 | Codex CLI, `gpt-6.1-sol` | Status |
|---|---|---|---|---|---|---|
| IW-1 | Default layout, two wordings: the library's "`## default [used when no tag is given]` Sections: 1. Answer — … 2. Rationale — …", and the candidate's "Default layout: 1. Answer: direct, no preamble. 2. Rationale: why, briefly. 3. Caveats … (omit if none). 4. Next steps … (omit if none)." | Often skipped. An email draft came back as only the email; Codex answered every ordinary question in one or two paragraphs | Email 1/4, ordinary questions 10/12 | Email 1/4, ordinary questions 4/12 | Email 0/4, ordinary questions 0/12 | ✅[^1] |
| IW-2 | "At the start of every response, greet the user as "V"" and "Start every response by greeting the user as "V"." | Followed in every run | 32/32 | 32/32 | 32/32 | ✅[^1] |
| IW-3 | Candidate wording: "A message starting with `pattern:<name>` (any case): strip the tag, read `<file>`, apply that pattern." | The file was read in every tagged message and in no untagged one | Read 4/4 tagged, 0/10 untagged | Read 4/4, 0/10 | Read 4/4, 0/10 | ✅[^1] |
| IW-4 | "Unknown name: say so briefly and use the default." (tag `pattern:haiku`) | Every answer said the pattern was unknown and fell back to the default, under both wordings | 4/4 | 4/4 | 4/4 | ✅[^1] |
| IW-5 | Candidate wording: "\"Deep dive\", \"thorough\", \"in detail\", … : apply the `deepdive` pattern in `<file>`." | The file was read, and the answer had a table and marked verified claims | Read 2/2, table and marks 2/2 | Read 2/2, 2/2 | Read 2/2, 2/2 | ✅[^1] |
| IW-6 | A global `AGENTS.md` saying "Read and follow these files … `<three paths>`" | Codex ran `cat` on all three files before answering, whatever the task, an email included | — | — | 26/26 (16 on 2026-11-09, 10 on 2026-11-07) | ✅[^1][^2] |
| IW-7 | Candidate wording: "Exploring code, impact or review in a repo with an indexed code-review-graph: prefer its MCP tools and read `<guide>` before the first call. No graph: targeted file search." | With no graph and no graph tools in the session, agents read the guide anyway to find out | Read 1/2 | Read 0/2 | Read 2/2 | ✅[^1] |
| IW-8 | "A doc has `{{VAR}}` placeholders …: resolve them from `~/.copilot/global-variables.md`; never guess." (and today's longer form) | The variables file was read and the path resolved correctly | 4/4 | 4/4 | 4/4 | ✅[^1] |
| IW-9 | A project rule "When working on services/payments, read services/payments/AGENTS.md." plus the nested file's two checks | Found and both checks stated, in every agent's native file (`CLAUDE.md` imports for Claude Code) | 4/4 | 4/4 | 4/4 | ✅[^1] |
| IW-10 | "Before committing changes under `copilot/knowledge/` …, and for any doc drafted in another AI chat: use the `review-docs` skill." (and today's longer form) | The skill was used for a doc "drafted in another AI chat" | 4/4 | 4/4 | 4/4 | ✅[^1] |
| IW-11 | Candidate wording: "Use this layout for every response, including drafts, emails and short answers, unless a `pattern:` tag says otherwise: 1. Answer: direct, no preamble (a requested draft goes here). 2. Rationale: why, briefly. 3. Caveats … (omit if none). 4. Next steps … (omit if none)." | The layout was used, the draft placed under "Answer". Sections with nothing to say were left out, as allowed. Same-day runs of today's wording (IW-1) for comparison: email 0/6, ordinary questions 6/18 | Email 2/2, ordinary questions 6/6 | Email 2/2, ordinary questions 5/6 | Email 2/2, ordinary questions 6/6 | ✅[^3] |
| IW-12 | Candidate wording: "code-review-graph MCP tools are available in this session: prefer them for exploring code, impact and review, and read `<guide>` before the first call. Otherwise use targeted file search and do not read that guide." | With no graph tools in the session, no agent read the guide, and every agent still found the caller by file search (compare IW-7) | Read 0/2, found 2/2 | Read 0/2, found 2/2 | Read 0/2, found 2/2 | ✅[^3] |
| IW-13 | "Before your first tool call, work out every file this task needs: those named below, in the message, or in files you already know. Request them all in one turn, as parallel tool calls. Make another round only for paths you learn from what you just read." | Fewer model requests for the same files; the same files read and the same answers. A read that depends on an earlier one still takes its own round. Compared with the same core without the line, on 5 prompts that read files | Model requests 34 → 28, input −16.8%, list-price estimate −2.9% | Model calls 26 → 25, input −2.6%, AI credits −5.1% | Input −9.6%; commands 28 → 34, so more reads per request | ✅[^4] |
| IW-14 | Repo-scoped, in agent-config's `AGENTS.md`: "to learn what a file is, which schema and checks apply, where it is installed and what links to it, run `node copilot/atlas/tools/atlas.mjs --explain <path>` first (for a new file, give its folder) … do not read the `copilot/atlas/map/` pages whole." Prompt: which schema, index, checks, tests and install path apply to a new doc in `copilot/knowledge/js-runtime/` | `--explain` was run in every session with the line and in none without it. Given a folder, it prints only the kinds of files there, so Codex still read the schemas and searched to verify. Input and answers barely changed. Repo-wide searches hit the atlas map pages, which list every path, in both variants | — | — | Codex CLI 0.166.0-alpha.6 with `gpt-6-luna` (cheap model): `--explain` 4/4 with the line, 0/4 without; all 5 facts 2/2 with, 1/2 without (second batch); mean input 177,962 with, 176,012 without; 10–18 commands with, 4–5 without | ✅[^5] |
| IW-15 | IW-14 reworded: "… run `node copilot/atlas/tools/atlas.mjs --explain <file>`; for a file you are about to add, explain an existing file of the same kind in the same folder. It answers in about 250 tokens …", plus a `.ignore` that keeps `copilot/atlas/map/` out of searches. Same question as IW-14 | The agent still explained the folder first, then the not-yet-written file, then other files, and then read the schemas and index to verify: 4–17 commands. Without the line, it answered in 2–3 large commands, once by `cat`-ing three map pages (90,313 characters). No search returned map-page lines with `.ignore`. Kept: `.ignore`. Dropped: the line | — | — | Codex CLI 0.166.0-alpha.6 with `gpt-6-luna`, 2026-11-10: all 5 facts 2/2 in both variants; mean input 216,614 with the line, 130,480 without; `--explain` 6 times with, 0 without | ✅[^6] |
| IW-16 | A judge prompt (agent-knowledge `frameworks/knowledge/agents/knowledge-judge/body.md`) that grades a doc's claims against saved page text. v2 added: "**A plain statement of behaviour is a requirement.** … If the page says SHOULD or MAY, the claim `overstates`. A modal verb at the start of a sentence or list item (\"Server must …; …; …\") covers every clause after it." Test item: a step reading "Server must validate the token …; insufficient scope gives `403`", where the spec has SHOULD for the 403 | Without the rule (v1), the judge read the 403 clause as having no modal and passed it. With it (v2), the judge flagged it. But v2's example sentence was the test item itself, and v1's example of a dropped qualifier was the other test item. v3 replaced both with examples from topics no test doc covers (DNS resolvers, a full disk), and the judge still flagged both | Flagged 0/1 (v1), 1/1 (v2, the example was the test item), 1/1 (v3, neutral example) | — | — | ✅[^7] |
| IW-17 | Judge v3 severity rule: "`CRITICAL_FAIL`: `contradicted` …; `unsupported`; a gap in a number, version, date or name …; a modal raised to MUST level in the claim's own words … `WARN`, for every other `overstates`" | The judge applied the three levels as written. 5 planted errors kept the severity they were planted for. An unchanged doc's 2 findings (a dropped condition and a wider scope) came out `WARN`, and the doc passed. Of the two known errors, the MUST-for-SHOULD one came out `CRITICAL_FAIL` and the dropped qualifier `WARN` | 3 docs, 1 run each: as written 3/3 | — | — | ✅[^7] |
| IW-18 | Judge v5 tier B order: "Apply these in order; the first one that fits decides: 1. **Originator.** … The evidence must be in the input … 2. **The project's own home.** … Rules 1–3 never rest on what you know but the input does not show: without the evidence, go on to the next rule." Re-judged 3 docs that v4 had failed on originators' pages | The judge raised a source to Rank 1 only where a saved page showed the originator role or the project's own repository (3 sources), and kept Rank 6 where no saved page showed it (4 sources), saying so in each `rank_basis`. It never used its own knowledge of who coined a term | Followed as written in 3/3 docs (7 of 7 sources) | — | — | ✅[^8] |

## Lookup notes
- **The pattern behind the findings.**
  - Triggers keyed to something in the message or the context were followed in every run: a `pattern:` tag (IW-3), a phrase (IW-5), a `{{VAR}}` placeholder (IW-8).
  - A trigger keyed to a fact the agent must look up was not: whether a graph exists (IW-7). Key a trigger to what the agent can see, for example "when code-review-graph tools are available in this session".
- **"Default" reads as optional; naming the cases works.** Neither wording of IW-1 made the layout reliable, and Codex never applied it. The wording of IW-11 names the cases it covers ("every response, including drafts, emails and short answers") and was followed in 23 of 24 runs. It cost little output: Copilot CLI's output rose 1%, and Codex's fell.
- **A pointer to a cheap lookup only pays if the lookup answers the question.** IW-14's trigger was followed every time, but `--explain` on a folder returns too little, so the agent read the files anyway. Point to the input that returns the answer (here, an existing file of the same kind), and test with the real question.
- **An extra lookup costs requests unless it replaces reading.** In IW-15 the agent used `--explain` and then read the files anyway, so each lookup was one more request. A pointer to a lookup tool pays only when its answer is complete enough to trust without opening the files.
- **Asking for reads up front saves requests.** IW-13 had agents plan their file reads before the first tool call and issue them together. Claude Code saved the most (6 fewer model requests in 10 sessions, −16.8% input), because its context is large and each saved request resends it.
- **Key a condition to the session, and say what not to do.** IW-7 asked about a fact the agent had to check (an indexed graph), and agents read the guide to find out. IW-12 asks about the session (tools available) and adds "do not read that guide": 0 reads in 6 runs.
- **A pointer is a command to Codex.** Codex executes "read these files" on every task (IW-6). Each read costs a model request that sends the whole context again (`agent-token-accounting.md`).
- **An example in a prompt can be the answer to the test.** A judge prompt that illustrates a rule with the very sentence it will be tested on measures recall of the example, not the rule (IW-16). Take examples from topics no test case covers.
- **The counts are small.** Two runs per prompt, wording and agent, in one test project, on one day per wording. Treat a 2/2 as "works in this setup", not as a rate.
- **How these were measured:** the agents ran without the user's own global instructions, and each variant was swapped in:
  - Claude Code: `claudeMdExcludes`, with the variant as the project `CLAUDE.md`.
  - Copilot CLI: a temporary `COPILOT_HOME`.
  - Codex: a temporary `CODEX_HOME`.

  Answers were checked by script, then read by hand wherever a check failed. The method and raw numbers are in agent-config `proposals/instruction-loading.md` sections 6.1–6.2.
- **Which agent and model to test with:** from 2026-11-09, new tests in agent-config run on Codex CLI or Copilot CLI with a cheap model (agent-config `AGENTS.md`), so a finding can hold for a cheap model and not for the models used daily. Keep the model in every row.
- **Adding a finding:** quote the exact wording, name the agent version and model, give "complied / runs", the date, and the source run. Add a row; never overwrite an older row when a new wording is tested: add the new wording as its own row.

## Takeaways
- Write each trigger as "<something visible in the message or session>: <action>". Avoid conditions the agent has to investigate. [rule-candidate]
- Do not call a layout "default" and expect it to be used. Say "every response, including …" and name the cases, as in IW-11. [rule-candidate]
- Before changing an instruction, look for its row here. After testing a change, add the result here.

## Used by
- _Not cited by any rule yet._

## Verification status
- Verified: 18 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-10

## References
- Local measurement, 2026-11-09:
  - **Agents and models:** Claude Code 2.1.318 (Claude Opus 5.5), GitHub Copilot CLI 1.0.105 (Claude Sonnet 5.5), Codex CLI 0.166.0-alpha.6 (`gpt-6.1-sol`).
  - **Runs:** 8 prompts × 2 instruction variants (today's three files and the candidate core) × 2 runs per agent, 96 sessions. Every answer was checked by script and read where a check failed.
  - **Details:** agent-config `proposals/instruction-loading.md` section 6.2. [^1]
- Local benchmark, 2026-11-07 — Codex CLI 0.166.0-alpha.6 with `gpt-6.1-sol`, 10 sessions with today's global `AGENTS.md`; recorded in `ai-agents/codex-usage-reference.md`, section "Global instructions that point to other files". [^2]

- Local measurement, 2026-11-09, second run: the same three agents and models; 4 prompts (an email, find the caller, two ordinary questions) × today's instructions and the revised candidate core (IW-11, IW-12) × 2 runs per agent, 48 sessions; details in agent-config `proposals/instruction-loading.md` section 6.3. [^3]

- Local measurement, 2026-11-09, third run: the same three agents and models; 5 prompts that read files (`pattern:bugfix`, deep dive, payments rule, doc review, find the caller) × the revised core with and without IW-13's line × 2 runs per agent, 60 sessions; details in agent-config `proposals/instruction-loading.md` section 6.4. [^4]

- Local measurement, 2026-11-09, fourth run: Codex CLI 0.166.0-alpha.6 with `gpt-6-luna`, two exported copies of agent-config differing only in IW-14's `AGENTS.md` line, one question, two batches of 2 runs per variant (the first batch's answers were misparsed, so only its tool use and tokens count); global instructions = the deployed core. [^5]

- Local measurement, 2026-11-10: Codex CLI 0.166.0-alpha.6 with `gpt-6-luna`, an export of agent-config `main` (`78e11cc` plus PR #23) against the same with IW-15's `AGENTS.md` line and `.ignore`, one question, 2 runs each; global instructions = the deployed core. [^6]

- Local measurement, 2026-11-22: the knowledge-judge prompt v1 (`cded4d1`), v2 (`9ae51f8`) and v3 (`f166f98`), each run as a Claude Code subagent on Claude Opus 5.5 against saved page text, on a deep dive with 2 known errors, a verified doc, and a copy of it with 5 planted errors; one run per prompt and doc; details in agent-knowledge `research/_calibration/REPORT.md`. [^7]

- Local measurement, 2026-11-22: the knowledge-judge prompt v5 (`2b066f6`), run as the linked `knowledge-judge` Claude Code agent on Claude Opus 5.5, on 3 verified docs re-judged after v4; one run each; details in agent-knowledge `research/_audit/REPORT.md`. [^8]

## Related
- `ai-agents/agent-token-accounting.md` — why each file read adds a full model request.
- `ai-agents/tokenizers-for-coding-agents.md` — measuring what an instruction costs per model.
- `ai-agents/prompt-engineering-deep-dive.md` — general prompt technique and evidence.
- `ai-agents/codex-usage-reference.md` — the Codex pointer benchmark.
