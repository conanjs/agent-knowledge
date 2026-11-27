---
schema: deep-dive/v1
topic: performance/code-review
status: verified
applies-to: ["Claude Code 2.1.332, headless -p, Sonnet for the reviewer and Haiku for the loading probes, one macOS machine (Apple M2)", "Node.js 24.22.1; ESLint 10.15.0 with the typescript-eslint parser", "runs of 2026-11-25; one trap sample, the index-only arm and round 3 run on 2026-11-26; three repaired samples re-run on 2026-11-27"]
last-verified: 2026-11-27
last-updated: 2026-11-27
synthesized-into: []
tags: [performance, code-review, agent, claude-code, skills, progressive-disclosure, calibration, false-positives, token-cost, lint, benchmark]
---

# Calibrating a performance-review agent: setup, commands and results

## Summary
**TL;DR:** A read-only Claude Code agent, `perf-reviewer`, names performance problem classes in a code flow and returns JSON findings: class, `file:line`, current and proposed complexity, risk and a check. Its knowledge is a skill loaded on demand: a short index plus one reference file per class. It was run headless on 18 TypeScript samples with known answers: 14 with a known best fix and 4 already optimal.
- **With the skill**, in both runs it found all 14 problems with the right fix and complexity, raised nothing on the 4 optimal samples, and on every bad sample read only the index plus the one matching reference file (on the optimal samples: the index alone in 5 of 8 runs, one reference file in 3).
- **Without the reference files** (one run), the same agent was nearly as good: 13 of 14, and the miss was a wrong class name with a right fix. It used 22 % less input.

So on these single-problem samples with a stated workload, run headless with Sonnet, the skill bought consistency and fewer extra findings, not detection. Round 2 below used a harder set; its limits are in §6.3.

Later the same day the index grew to 39 classes and a second round ran 39 more samples: one per new class, two multi-problem flows and 13 traps. With the skill the agent found 29 of 29 planted problems and stayed clean on all 13 traps (one run per arm). Without the reference files the scorer counted 25 of 29; read by hand, the other four had the right fix under a wrong label or line. It cost about half as much.

On 2026-11-26 a third arm ran once on all 58 samples: the index without the reference files. It found the same problems with the same fixes and stayed clean on all 18 good samples. The class id was right for 42 of 43 planted problems, and two findings sat a few lines away from the answer key's lines. On the round-2 samples it used 11 % less input than the full skill, so most of the skill's extra cost is the index: 65 % of the tokens (§6.4).

Later that day the index grew to 135 classes and a third round ran 127 new samples: one per new class and 31 traps (one run per arm). With the skill the agent filed all 96 planted problems under the right class id and raised nothing on the sound traps. Without it the class id was right for 86 of 96, and three sound traps drew findings. Both arms found every defect and a correct fix in that run; two flawed traps and one sample were repaired and re-run the next day. A review with the skill now costs 0.084 USD against 0.023 without it (§6.5).

**Use this when:**
- you build or change a review agent and want measured accuracy, false positives and cost;
- you decide how to load an agent's knowledge (a preloaded skill, the Skill tool, or a path in the agent's body);
- you want to repeat the runs; every command is given.

**Depth:**
- three ways to load a skill into an agent run as the session, measured;
- the agent and skill design;
- 18 samples and their answer key;
- 54 scored runs in two arms, with hand checks; a second round of 78 runs on 39 new samples; a third arm of 58 runs with the index alone; a third round of 272 runs on 127 new samples, with 135 classes in the index;
- the lint rules and the scaling harness, each tested against known-good and known-bad inputs;
- ground-truth benchmarks of the samples;
- what published studies say about finding performance bugs and about language models doing it.

---

## 1. Words first

| Term | Plain English | Analogy | Concrete artifact |
|---|---|---|---|
| Problem class | A code shape that costs more than needed as input grows, with its standard fix | A named diagnosis with a standard treatment | `lookup-in-loop`: `customers.find` inside `orders.map` |
| Progressive disclosure | Load a short index first, and a detail file only when it applies | A library catalog card first, the book only if needed | `SKILL.md` (index) then `references/lookup-in-loop.md` |
| Calibration | Running a checker on cases whose right answer is known, before trusting it | Weighing a known 1 kg mass before using a scale | 14 samples with a planted problem, 4 without one |
| Known-good sample | Code that is already as fast as it needs to be; any finding on it is a false positive | A clean blood sample sent to a lab to test for false alarms | `G02-bounded`: nested loops over 7 days × 3 shifts × at most 12 staff |
| Arm | One configuration under test | One group in a trial | S: agent with the skill; N: the same agent without reference files |
| Growth exponent | How time grows when the input doubles: ln(t₂/t₁) / ln(n₂/n₁); about 1 is linear, about 2 quadratic | Checking whether a bill doubles or quadruples when usage doubles | `perf-scale.mjs` prints `"slope": 1.89` for a quadratic workload |
| First request | Everything the model reads before acting: system prompt, tools, instruction files, the task | The binder handed to a temp worker on day one | 4,438 tokens for the reviewer |
| Cumulative input | The sum of every request's full context in one run | Photocopying the whole file again for each new page | 20,222 tokens for a median review with the skill |

---

## 2. What was built

All files are in the `archkit-build` Claude Code plugin (the author's own project), next to its existing implementer and reviewer agents:

```
agents/perf-reviewer.md                    tools: Read, Grep, Glob · model: sonnet · maxTurns: 15 · omitClaudeMd: true
skills/perf-patterns/SKILL.md              the index: 15 classes at the calibration of §6, 33 in §6.1, 39 in §6.3, 135 in §6.5; each with its signals and its reference file
skills/perf-patterns/references/*.md       one file per class + verification.md (signals, "Not a problem when",
                                           fixes with before → after cost, how to verify, sources)
scripts/perf-scale.mjs                     scaling harness: growth exponent from runs at N, 2N, 4N…
lint/perf-rules.mjs                        ESLint rules (hints): linear lookup in a loop, accumulating spread, sort then
                                           take the first k; since §7.2's second version also await per item and retry without delay
tests/perf-scale.test.mjs, perf-rules.test.mjs   known-good and known-bad inputs for both
calibration/perf-reviewer/                 samples/, expected.json, run.mjs, score.mjs, lint-samples.mjs, bench/,
                                           variants/no-skill/ (the control arm), results/2026-11-25/
```

**The agent's instructions** describe the scope and the criteria; they assign no persona:
1. Read the workload file, the code and the index in the first turn.
2. Follow the flow, and for each cost that grows with input, read the matching reference file (at most three).
3. Derive the cost from the code, with each loop's `file:line` and size.
4. Report only changes of growth class, round trips cut by a growing factor, or a bound on something unbounded.
5. Skip constant factors, small fixed sizes, and anything the reference lists under "Not a problem when".
6. Put unknown sizes under `unsure`.
7. Never state a speedup in time units.

**Output contract:** `{"verdict": "findings" | "clean" | "unsure", "findings": [{class, file, line, evidence, current, proposed, expected, risk, verify, confidence, severity}], "unsure": [{file, line, question}]}`. A `checked` field was added after the calibration (§6.2).

These choices follow earlier measurements:
- a tool allowlist keeps the start small ✅[^lab-notebook];
- personas did not improve factual accuracy ✅[^persona];
- accuracy falls as simultaneous instructions grow ✅[^ifscale];
- a model that abstained more had a lower error rate (SimpleQA: 52 % abstained and 26 % wrong, against 1 % and 75 %; two models, so suggestive only) ✅[^oai-hall];
- a reviewer must first be shown to fail known-bad work and pass known-good work ✅[^lab-notebook].

The catalog behind the reference files, with its sources, is [problem-classes.md](problem-classes.md).

---

## 3. Three ways to load the skill, measured

**Question:** when an agent from a plugin runs as the whole session (`claude -p --agent <plugin>:<agent>`), how does it get its skill, and what does each way cost?

**Setup.**
- A throwaway plugin `probe` with a skill `kit`. Its `SKILL.md` holds the codeword HERON-31 and points to `references/detail.md`, which holds MAPLE-88.
- Four agents, all on Haiku and run from an empty folder under `/tmp`, with `--setting-sources project,local --allowedTools Read Grep Glob Skill`:
  - `skills: [kit]` in the frontmatter;
  - `skills: [probe:kit]`;
  - the `Skill` tool in `tools`;
  - a body line naming `${CLAUDE_PLUGIN_ROOT}/skills/kit/SKILL.md`.
- Each was asked for both codewords and the paths it read.

**Result** ✅[^lab-probe]:

| Agent | Answer | Tool calls | First request | Cumulative input |
|---|---|---|---|---|
| `skills: [kit]` | NO-INDEX: the skill was not in its context | 8 Glob/Grep calls in its own folder | 3,638 | 19,332 |
| `skills: [probe:kit]` | HERON-31 and MAPLE-88, but only after globbing the parent folder and finding the plugin by chance | 4 Glob, 2 Read | 4,380 | 26,248 |
| `Skill` tool | Both; the tool result was only "Launching skill: probe:kit", and the skill's body (without its front matter) followed as a separate message that began "Base directory for this skill: /tmp/…/skills/kit" | Skill, Glob, Read, Read | 7,340 | 33,919 |
| `${CLAUDE_PLUGIN_ROOT}` in the body | Both; the transcript shows the variable replaced by the plugin's absolute path | Read, Read | 4,429 | 13,955 |

The last two rows, request by request (input tokens of each request, then what the model did) ✅[^lab-probe]:

| Agent | Request 1 | Request 2 | Request 3 | Request 4 |
|---|---|---|---|---|
| `Skill` tool | 7,340: calls `Skill`; the body of `SKILL.md` comes back in a message after the tool result | 8,257: lists the skill folder with Glob and reads `SKILL.md` again | 9,097: reads the detail file | 9,225: answers |
| `${CLAUDE_PLUGIN_ROOT}` in the body | 4,429: reads `SKILL.md` | 4,649: reads the detail file | 4,877: answers | none |

- **The docs agree in part.**
  - For a subagent, the `skills` field injects "the full skill content", not only the description. The fields that plugin agents ignore are `hooks`, `mcpServers` and `permissionMode`, so `skills` is not one of them ✅[^cc-sub].
  - The part of the page read does not say whether `skills` applies when the agent runs as the main session; in this run it did not.
  - In skill, command and agent content, Claude Code substitutes path variables such as `${CLAUDE_PLUGIN_ROOT}` inline when it loads the content ✅[^cc-plugins].
- **Reading files outside the working folder:** no permission was denied. Listing `Read` in `--allowedTools` lets Claude read files without asking, apart from network paths ✅[^cc-headless].
- **Conclusion** (Claude Code 2.1.332, headless `-p`, Haiku, the four probe agents above, one run each): for an agent run with `--agent`, name the index by `${CLAUDE_PLUGIN_ROOT}` in the agent body and let it Read the files. That costs about 2,900 tokens less per request than the Skill tool on this machine. The 2,900 depends on the skill listing: the 18 built-in skills here (§3.2). The request counts, 3 against 4, do not show that the tool costs a request. The `Skill` call stood where the Read of `SKILL.md` stands, request 1 in both runs. The fourth request came from the model: after the skill's text had arrived, it listed the skill folder and read `SKILL.md` a second time. The two prompts also differed: only the Skill-tool probe's began "Use the kit skill first".

### 3.1 Is it the plugin, or the mode?

**Question:** was `skills:` skipped because the agent came from a plugin, or because it ran as the session?

**Setup.** Agents with `tools: Read` and the instruction "Never call a tool", asked for the codeword or NO-INDEX, so the answer can only come from what is already in the context. Each ran as the session (`--agent`) and as a subagent launched by a default session. One more agent and skill were project-level files (`.claude/agents/`, `.claude/skills/`, codeword FALCON-12).

**Result** ✅[^lab-probe]:

| Agent | As the session (`--agent`) | As a subagent |
|---|---|---|
| Plugin agent, `skills: [kit]` | NO-INDEX | HERON-31 |
| Plugin agent, `skills: [probe:kit]` | NO-INDEX | HERON-31 |
| Project agent, `skills: [localkit]` | NO-INDEX | FALCON-12 |

- **In a subagent,** the skill arrives as a user message that begins "Base directory for this skill: …", under either name form.
- **As the session,** it does not arrive, for plugin and project agents alike (Claude Code 2.1.332, headless, Haiku; one run per cell). So the cause is the mode, not the plugin.
- **The docs describe the two modes differently, and do not state this case.**
  - `--agent` starts a session "where the main thread itself takes on that subagent's tool restrictions and model", and the agent's prompt replaces the default system prompt ✅[^cc-sub].
  - Preloaded skills are listed under what "a non-fork subagent's initial context contains" ✅[^cc-sub].
  - Other fields are marked one by one for session mode: `omitClaudeMd` is ignored there, while `initialPrompt`, `hooks` and `mcpServers` apply ✅[^cc-sub]. `skills` has no such note.
- **Reading** *(synthesis)*: skill preloading belongs to the start of a subagent, and running an agent as the session applies only the fields the docs name for that mode.

### 3.2 What the Skill tool adds to every request

The recorded request of the `Skill`-tool run was compared with the path-in-body run ✅[^lab-probe]:

| Part | Characters |
|---|---|
| The `Skill` tool's definition | 3,372 |
| The skill listing as sent in the request, with its heading line "The following skills are available for use with the Skill tool:": 19 skills, the plugin's one and 18 that ship with Claude Code (8,726 characters without the heading) | 8,791 |
| Together | 12,163 |

At about 4.2 characters per token, the ratio measured for requests on this machine ✅[^lab-notebook], 12,163 characters are about 2,900 tokens (12,163 / 4.2 = 2,896). The measured gap between the two first requests is 7,340 − 4,429 = 2,911 tokens. So the tool's definition and the skill listing account for the gap to within 15 tokens (2,911 − 2,896), and both are sent again on every request: the path-in-body run had neither the `Skill` tool nor the listing in its requests. The two prompts also differed by a sentence.

Whether the Skill tool also costs a request in a review is **not measured**. The tool's description in the probe's request tells the model, when a listed skill covers the task, to "call this tool first" ✅[^lab-probe]. But the probes had no code file to read, so they do not show whether a model sends a `Skill` call together with file reads in one request, the way request 2 of the Skill-tool run carried two tool calls. The path-in-body side is measured: in all 112 transcripts of the calibration agent with the skill (arm S, §5) kept on this machine, the first request read `SKILL.md` together with the sample's files ✅[^lab-cal]. No calibration arm used the `Skill` tool.

---

## 4. The calibration set

Each sample is a folder with source files and a `workload.json`: entry point, files, data sizes, call rates, and the database or runtime where it matters. The answer key, `expected.json`, sits outside the sample folders, so the agent never sees it. No sample has a comment that hints at its problem.

| Sample | Code shape | Workload | Known best fix |
|---|---|---|---|
| B01-lookup | `customers.find` inside `orders.map` | 200,000 orders, 50,000 customers | `Map` by id: O(n·m) → O(n + m) |
| B02-dedup | `all.filter((e, i) => all.indexOf(e) === i)` | 300,000 emails, 250,000 distinct | seen-`Set`: O(n·d) → O(n) |
| B03-topk | `[...scores].sort(…).slice(0, k)` | 2,000,000 scores, k = 10, every 5 s | heap of size k: O(n log n) → O(n log k) |
| B04-range | a loop from `from` to `to` per query | 525,600 values, 100,000 queries of about 50,000 | prefix sums: O(Q·L) → O(n + Q) |
| B05-graph | Dijkstra choosing the next stop by scanning all of `dist` | 200,000 stops, 600,000 edges | binary heap: O(V²) → O((V + E) log V) |
| B06-scheduling | `pending.sort(…)` then `shift()` on every `takeDue` | 100,000 pending, 500 calls/s | priority queue: O(log n) per operation |
| B07-string | each of 5,000 phrases tested with `includes` on each message | 20,000 messages per minute | Aho–Corasick automaton |
| B08-caching | rules JSON read and parsed per line item | 12 regions, 10,000 items per invoice, 50 invoices/s | load once per region |
| B09-allocation | `reduce((acc, p) => ({ ...acc, [p.id]: p }), {})` | 100,000 products | mutate a local accumulator: O(n²) → O(n) |
| B10-n-plus-one | a query for invoice lines inside a loop over invoices | up to 5,000 invoices, 1 ms per round trip | one `= ANY($1)` query or a join: n + 1 → 2 |
| B11-db-index | `WHERE customer_id = $1 ORDER BY created_at DESC LIMIT … OFFSET …`, only an index on `status` | 50,000,000 rows, up to page 500 | index on `(customer_id, created_at)`; keyset pagination |
| B12-concurrency | `Promise.all(accounts.map(upsert))` | 40,000 accounts, API limit 20 concurrent | a pool of at most 20, or the bulk endpoint |
| B13-distributed | 10 immediate retries, no timeout | 300 calls/s, a 2 s budget, 503s during incidents | timeout, capped backoff with jitter, a retry budget |
| B14-frontend | 20,000 rows rendered; filter and sort in the render body | React 19 without React Compiler | virtualization |
| G01-lookup-ok | B01 with a `Map` | as B01 | none |
| G02-bounded | `staff.filter(…some…)` inside loops over 7 days × 3 shifts | at most 12 staff × 21 slots | none |
| G03-sort-needed | full sort, then streaming CSV with `await once(out, "drain")` in the loop | 1,000,000 rows, all exported in order | none: the full order is the output |
| G04-bounded-sync | 10 workers, bulk calls of 100, `AbortSignal.timeout`, capped jittered backoff | 40,000 accounts | none |

---

## 5. How it ran, and how it was scored

**Arms:**
- **S**: `archkit-build:perf-reviewer` with the skill, run twice.
- **N**: a copy of the agent in a separate plugin, without the index and reference files, run once. It keeps the list of class ids, so its answers can be scored the same way. The diff against S is six lines: the description, the index line, the two steps that mention it, the "Not a problem when" clause, and "class id from the index" in the output contract.
- **I** (added on 2026-11-26, §6.4): a copy with the index but no reference files, run once.

**Command, per sample and run.** Each run works on a fresh copy of the sample under `/tmp/perf-cal/<arm>-r<rep>/<sample>/`, a folder where no project `CLAUDE.md` loaded in earlier tests ✅[^lab-notebook]:

```bash
claude -p "Review the performance of the code flow described in workload.json: it gives the entry point, the files, data sizes and call rates." \
  --plugin-dir ~/workspace/archkit/build --agent archkit-build:perf-reviewer --model sonnet \
  --setting-sources project,local --output-format json --allowedTools Read Grep Glob
```

`run.mjs` runs all of them, four at a time:

```bash
node run.mjs --out results/2026-11-25 --arms S:2,N:1 --parallel 4
```

**Scoring** (`score.mjs`):
- **Bad samples.** A bad sample counts as detected when a finding has an expected class, the expected file, and a line within 3 lines of the anchor lines in the answer key. Regexes then check the matched findings: the fix, the current cost, the expected cost, and whether a concrete `verify` is present.
- **Good samples.** On a good sample every finding is a false positive.
- **Tokens.** Token numbers come from `measure.py` over each session's transcript: request size = input + cache creation + cache read; repeated message ids count once.
- **USD.** USD is the CLI's `total_cost_usd`.

**One wording change before the full run.** In a 2-run smoke test, the clean verdict on G02 came back as prose followed by the JSON. Both arms' contract line was then changed:
- from "Reply with JSON only: no code fence, no text before or after.";
- to "Reply with JSON only. A program parses your whole reply, so its first character is `{` and its last is `}`: no code fence, no notes before or after."

**One scorer correction after the run.** B10's "current cost" regex accepted "n + 1" but not "1 + n". So it marked N's correct answer "1 + n sequential round trips" as wrong. The regex was widened and every run re-scored; S's results did not change.

---

## 6. Results

**Per arm** ✅[^lab-cal]:

| Arm | Bad found | Fix right | Complexity right | Verify given | Extra findings on bad | Good samples clean | JSON only | First request (median) | Cumulative input (median) | Requests (median) | Output tokens (median) | Seconds (median) | USD, 18 runs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S, run 1 | 14/14 | 14/14 | 14/14 | 14/14 | 0 | 4/4 | 18/18 | 4,438 | 20,222 | 3 | 1,046 | 11.4 | 0.57 |
| S, run 2 | 14/14 | 14/14 | 14/14 | 14/14 | 0 | 4/4 | 17/18 | 4,438 | 20,342 | 3 | 1,111 | 12.1 | 0.57 |
| N, run 1 | 13/14 | 13/14 | 13/14 | 13/14 | 2 | 4/4 | 18/18 | 4,462 | 15,868 | 3 | 839 | 10.9 | 0.32 |

**What happened:**
- **No false positives in either arm.** No finding at all, major or minor, on any of the 12 good-sample runs.
  - G02's nested loops over constant sizes and G03's full sort both came back `clean`.
  - So did G03's `await` inside a loop and G04's retry loop.
- **N's miss was a name, not a defect.** On B13, N filed the finding under `concurrency-backpressure` instead of `distributed-calls`. Its fix was right and complete: a per-attempt `AbortSignal.timeout`, 2–3 attempts with exponential backoff and jitter, an overall deadline, a token-bucket retry budget, a circuit breaker and an idempotency key.
- **N's second extra finding was valid.** On B14, beside virtualization, it added precomputing lowercase keys and pre-sorting once per `products` or `sortBy` change. The answer key did not list that, but it is a real cost per keystroke. S folded the same point into its rendering finding.
- **S read exactly what it needed.**
  - Every bad-sample run read `SKILL.md` and the one matching reference file, 28 of 28.
  - On good samples it read the index alone in 5 runs, the matching reference file in 3 (G01 run 2: `lookup-in-loop.md`; G04 both runs: `concurrency-backpressure.md`), and never more than one reference file.
- **JSON only.** 53 of 54 replies were pure JSON after the wording change. The exception was again G02, in S run 2: a clean verdict, preceded by its arithmetic ("21 slots × 12 staff × 21 availability entries ≈ 5,300 comparisons").
- **What the skill cost.** Median cumulative input was 27 % higher with the skill (S run 1: 20,222 against 15,868; 28 % for run 2), and output 25 % higher (1,046 against 839). The CLI's reported cost was 77 % higher (0.5683 against 0.3204 USD for 18 runs; the table shows them rounded). The requests were the same: a median of 3, because the index is read in the same turn as the code.
- **Hand checks.**
  - All five findings of S run 1 on B05, B06, B11 and B13 (1, 1, 2 and 1) were read in full.
  - B11 gave two findings: a composite index `(customer_id, created_at DESC, id DESC)`, built with `CONCURRENTLY`, then keyset pagination with `(created_at, id) < ($2, $3)`.
  - Each finding stated its sizes from the workload and its risks: stable tie-break order for the heap; duplicate charges without an idempotency key.
  - Each check was runnable: `EXPLAIN (ANALYZE)` at page 0 and page 500; a failing stub counting attempts per charge.
  - No finding promised a speedup in time units; B13 quotes the workload's 400 ms p99 as an input.

### 6.1 After the index grew from 15 to 33 classes

Eighteen classes were added to the index and the reference files later the same day (their sources are in [problem-classes.md](problem-classes.md); they have no samples yet). The index doubled, so the 18 samples were run once more, to see whether a longer index costs accuracy ✅[^lab-cal]:

| Index | Bad found, fix and complexity right | Good samples clean | Reference files read | Cumulative input (median) | USD, 18 runs |
|---|---|---|---|---|---|
| 15 classes (S, run 1) | 14/14 | 4/4 | index + the matching file on every bad sample | 20,222 | 0.57 |
| 33 classes | 14/14 | 4/4 | the same files as before on every sample | 23,069 | 0.66 |

The longer index cost 14 % more input (23,069 against 20,222) and changed no result on these samples. Whether the new classes are found, and whether they bring false positives, is untested.

### 6.2 A field for the reasoning: `checked`

**Question:** the only replies that were not pure JSON were clean verdicts on G02, where the model wrote its size arithmetic before the JSON. Does giving that reasoning a field of its own stop it?

**Change.** The contract gained `"checked": "<one or two sentences: what you examined and, for a clean verdict, why its cost is fine, with the sizes>"`. The four good samples then ran three times and three bad samples once ✅[^lab-cal]:

| | Before the field (72 runs: §6 and §6.1) | With the field (15 runs) |
|---|---|---|
| Replies that were pure JSON | 70 of 72 | 14 of 15 |
| G02 alone | 2 of 4 | 2 of 3 |
| Verdicts | as in §6 and §6.1 | 12 of 12 clean on good samples; 3 of 3 found on B01, B08 and B13 |

- **Not shown to help.** G02 still came back once with prose first, and 3 runs cannot separate 2 of 4 from 2 of 3.
- **Kept anyway,** because a clean verdict now says why. Example, G02: "It runs 7 days × 3 shifts = 21 passes over staff", with the sizes from the workload.
- **Round 2 narrows this.** With the field, all 78 round-2 replies (both arms) were pure JSON (§6.3), so the field may help, but those samples contained no G02-like trap and nothing separates the two cases. Its effect stays undetermined.
- **Consequence for a harness:** for Sonnet in these runs, take the JSON object out of the reply (from the first `{` to the last `}`) before parsing, as `score.mjs` does; no wording or field tried here made every reply pure JSON in round 1. The calibration in §6 ran without this field.

### 6.3 Round 2: 24 new classes, traps and multi-problem flows

**Question:** does the agent find the classes added after round 1, does it stay quiet on code built to look like them, and do the reference files matter now?

**Setup.**
- The index had grown to 39 classes: the 18 of §6.1 and 6 more (`linear-call-in-loop`, `combinatorial-explosion`, `sql-query-shape`, `unbuffered-io`, `parallelism-overhead`, `unbounded-input`).
- 39 new samples, in TypeScript, Python, Go and SQL:
  - 24 with one planted problem, one per new class (B15–B38);
  - 2 flows with several problems across files: M01 (a query per account, a `find` per transaction, an accumulating spread; three files) and M02 (an unbounded fan-out and a retry loop with no delay; two files, plus a bounded loop as bait);
  - 13 known-good traps (G05–G13, G16–G19), each built on a "Not a problem when" line: pushes and pops at the end of an array, merge sort's two recursive calls, a 12-row loop that calls an API, a remote call made before `BEGIN`, a shared pool with `pool.query`, Python `re.search` in a loop, Prisma `findUnique` calls in one tick, a component under React Compiler, a cursor loop, lazy images below the fold, an enqueued email, parameterized logging, start-up work in a long-running service.
- Arms S and N as in §5, one run each; N's prompt lists all 39 class ids. Both carry the `checked` field of §6.2.

```bash
node run.mjs --out results/2026-11-25-round2 --arms S:1,N:1 --samples <the 39 new samples> --parallel 5
```

**Result** ✅[^lab-cal]:

| Arm | Planted problems found (class, file and line) | Samples with every problem found | Good samples clean | Findings outside the answer key | JSON only | Cumulative input (median) | Output tokens (median) | USD, 39 runs |
|---|---|---|---|---|---|---|---|---|
| S | 29/29 | 26/26 | 13/13 | 0 | 39/39 | 23,905 | 1,224 | 1.56 |
| N | 25/29 | 22/26 | 13/13 | 6 | 39/39 | 16,664 | 1,000 | 0.75 |

- **N's four misses were labels, not defects.** Read by hand, each had the right fix:
  - B24: the remote call under a Go mutex, filed under `transaction-lock-scope` instead of `lock-contention`;
  - B27: the missing effect cleanup, filed at the `useEffect` line (8), six lines above the first listener (14), outside the 3-line window;
  - M01: the accumulating spread, filed under `linear-call-in-loop`;
  - M02: the retry loop, filed under `concurrency-backpressure`.
- **N's other two extra findings were valid second problems** the answer key had not listed: `pd.concat` per row in B17, and `SELECT *` in B23.
- **No false positive in either arm** on the 13 traps. N stayed clean on the traps whose reason sits in the reference files, and gave that reason itself: Prisma "batching of findUnique calls made in the same tick", and that `re.search` "looks up its compiled pattern in the `re` module cache".
- **S read what it needed:** exactly the matching reference file on all 24 single-problem samples; none on M01 and one on M02; the index alone on 12 of the 13 traps.
- **Cost of the skill:** 43 % more cumulative input (23,905 against 16,664) and about twice the CLI's reported cost (1.56 against 0.75 USD).

**One more trap, 2026-11-26.** G14 asks for a count by `received_at` alone, on PostgreSQL 19, where the only index is `(warehouse_id, received_at)` over 8 warehouses. Since PostgreSQL 18 a skip scan can serve that query, so a finding that the index cannot be used would be a false positive. Each arm ran twice: all four verdicts were `clean`, and in the two runs read by hand N named the skip scan itself ✅[^lab-cal]. Like the other traps, it did not separate the arms.

**Limits of this round.** Each sample ran once per arm. Several traps were also small (50 ids, 60 contacts), so a clean verdict there does not prove the knowledge was needed. The answer key's line windows are 3 lines wide, which is what failed B27 for N.

**Reading** *(synthesis)*:
- Over both rounds, 43 planted problems and 17 known-good samples (18 with the trap added on 2026-11-26) (one or two runs each, Sonnet, headless, Claude Code 2.1.332), the reference files changed no verdict as read by hand: with or without them, Sonnet found every problem with a correct fix and raised nothing on good code. The scorer's 5 misses without them (13 of 14, 25 of 29) are label or line differences.
- What the skill did buy is a stable label: the class id and line matched the answer key in 57 of 57 scored findings with it (14 + 14 + 29), against 38 of 43 without it (13 of 14, then 25 of 29). That matters when a program routes or deduplicates findings by class.
- It cost 27–43 % more input and up to twice the reported cost.
- The traps did not separate the arms: the model already knew the facts they rest on. The reference files' remaining possible value is facts newer than the model, and that has not been tested.
- The middle arm, the index alone (class ids and signals, no reference files), ran the next day: §6.4.

### 6.4 The index alone: arm I

**Question:** which part of the skill keeps the class labels stable, the index or the reference files? And how much of the skill's cost does each part carry?

**Setup** (2026-11-26, Claude Code 2.1.332, headless; the CLI reported the model id `claude-sonnet-5-5` in every run of §6 to §6.4).
- **Arm I** is a third copy of the agent in its own plugin, `variants/index-only/`. It has the same index of 39 class ids and their signals, without the "File" column, and that plugin holds no reference file.
- Its agent text differs from S in four lines: the description, the sentence about relative paths, the step that reads a reference file, and the "Not a problem when" clause.
- A script derives both files from the real agent and index, `variants/build-index-only.mjs`, so the arm is rebuilt, not edited by hand.
- One run on all 58 samples. S and N were not run again: their rows below are those of §6.3.

```bash
node variants/build-index-only.mjs
node run.mjs --out results/2026-11-26-index-only --arms I:1 --parallel 4
node score.mjs results/2026-11-26-index-only
```

**Result on the 39 samples of round 2.** There all three arms ran with the same 39 classes and the same output contract ✅[^lab-cal]:

| Arm | The agent reads | Class and place both right | Class id right | Place right | Good samples clean | JSON only | Cumulative input (median) | Output tokens (median) | USD, 39 runs |
|---|---|---|---|---|---|---|---|---|---|
| S | the index, then reference files | 29/29 | 29/29 | 29/29 | 13/13 | 39/39 | 23,905 | 1,224 | 1.56 |
| I | the index | 26/29 | 28/29 | 27/29 | 13/13 | 38/39 | 21,346 | 1,125 | 1.24 |
| N | a list of the class ids | 25/29 | 26/29 | 28/29 | 13/13 | 39/39 | 16,664 | 1,000 | 0.75 |

- **"Class id right"** counts a finding with an expected class in the expected file, on any line.
- **"Place right"** counts a finding within 3 lines of the answer key's lines, under any class.
- The scorer of §5 asks for both in one finding.

**I's three misses, read by hand, were labels, as N's were.** Each described the same defect and the same fix as S's finding:
- B27: the missing effect cleanup, filed at the `useEffect` line (8) and not at the first listener (14). N filed it at the same line.
- B30: the chain of three fetches, filed at its first fetch (line 36), 3 lines past the window, which ends at line 33.
- M01: the accumulating spread, filed under `linear-call-in-loop` instead of `allocation-gc`. N gave the same label.

**The M01 miss is not an effect of the reference files.** S read no reference file on M01 (§6.3), so S and I had the same text there, and S still chose `allocation-gc`. With one run per arm, a difference like this cannot be told from run-to-run variation.

**The rest of I's run** ✅[^lab-cal]:
- **Good samples:** 13 of 13 traps clean, and G14 clean.
- **Round-1 samples:** 14 of 14 problems with class and place right, nothing raised on the 4 good samples.
- **All 58 samples:** 40 of 43 with class and place right, 42 of 43 class ids right, 41 of 43 places right, 18 of 18 good samples clean, for 1.83 USD.
- **Two more findings outside the answer key,** which the scorer counts as extra. Read by hand, both describe a real cost: on B12, the bulk endpoint that the workload names, reported as a second finding (`io-batching-n-plus-one`); on B28, the synchronous file read in the handler, reported again as a minor `blocking-in-async`.
- **JSON only:** 56 of 58. B18 and G02 came back as a few sentences of reasoning, then the JSON. G02 did the same in §5, §6 and §6.2.
- **How it ran:** in all 58 runs the first request read the index together with the sample's files, and every run took 3 requests. No run opened a path under `references/` or the real plugin's skill folder.

**What each arm filed, problem by problem** ✅[^lab-cal]. One row per planted problem, taken from the raw replies: the class id and the line of the finding that matched it. Bold marks a cell where the class id or the line falls outside the answer key. For B01–B14 the S and N columns come from round 1 (S run 1; a 15-class index), for the other rows from round 2.

<details>
<summary>All 43 planted problems in arms S, N and I</summary>

| Planted problem | Accepted class ids | Lines in the answer key | S filed | N filed | I filed |
|---|---|---|---|---|---|
| B01-lookup | `lookup-in-loop` | report.ts:7 | `lookup-in-loop` @ 7 | `lookup-in-loop` @ 7 | `lookup-in-loop` @ 7 |
| B02-dedup | `dedup-set-ops` or `lookup-in-loop` | contacts.ts:5 | `dedup-set-ops` @ 5 | `dedup-set-ops` @ 5 | `dedup-set-ops` @ 5 |
| B03-topk | `top-k-selection` | leaderboard.ts:4 | `top-k-selection` @ 4 | `top-k-selection` @ 4 | `top-k-selection` @ 4 |
| B04-range | `range-query` | metrics.ts:6 | `range-query` @ 4 | `range-query` @ 4 | `range-query` @ 6 |
| B05-graph | `graph-search` | routes.ts:9 | `graph-search` @ 7 | `graph-search` @ 9 | `graph-search` @ 9 |
| B06-scheduling | `scheduling-intervals` or `top-k-selection` | jobQueue.ts:11–13 | `scheduling-intervals` @ 11 | `scheduling-intervals` @ 11 | `scheduling-intervals` @ 11 |
| B07-string | `string-matching` | moderation.ts:7–8 | `string-matching` @ 7 | `string-matching` @ 7 | `string-matching` @ 7 |
| B08-caching | `caching-recomputation` | pricing.ts:1–15 | `caching-recomputation` @ 15 | `caching-recomputation` @ 15 | `caching-recomputation` @ 10 |
| B09-allocation | `allocation-gc` | catalogIndex.ts:4–8 | `allocation-gc` @ 4 | `allocation-gc` @ 4 | `allocation-gc` @ 4 |
| B10-n-plus-one | `io-batching-n-plus-one` | invoices.ts:12–14 | `io-batching-n-plus-one` @ 12 | `io-batching-n-plus-one` @ 12 | `io-batching-n-plus-one` @ 12 |
| B11-db-index | `db-query-index` | orderHistory.ts:11–13; 001_orders.sql:9 | `db-query-index` @ 8 | `db-query-index` @ 8 | `db-query-index` @ 8 |
| B12-concurrency | `concurrency-backpressure` or `distributed-calls` | crmSync.ts:8 | `concurrency-backpressure` @ 8 | `concurrency-backpressure` @ 8 | `concurrency-backpressure` @ 8 |
| B13-distributed | `distributed-calls` | paymentsClient.ts:8–10 | `distributed-calls` @ 8 | **`concurrency-backpressure` @ 8** | `distributed-calls` @ 8 |
| B14-frontend | `frontend-rendering` | ProductTable.tsx:10–22 | `frontend-rendering` @ 22 | `frontend-rendering` @ 22 | `frontend-rendering` @ 22 |
| B15-seq-shift | `sequence-shift-in-loop` | taskList.ts:5 | `sequence-shift-in-loop` @ 5 | `sequence-shift-in-loop` @ 5 | `sequence-shift-in-loop` @ 5 |
| B16-subproblems | `overlapping-subproblems` | change.ts:5 | `overlapping-subproblems` @ 5 | `overlapping-subproblems` @ 5 | `overlapping-subproblems` @ 5 |
| B17-vectorization | `numeric-vectorization` | features.py:6–13 | `numeric-vectorization` @ 13 | `numeric-vectorization` @ 6 | `numeric-vectorization` @ 13 |
| B18-spatial | `spatial-search` or `db-query-index` | nearbyStores.ts:8–10; 004_stores.sql:7 | `spatial-search` @ 10 | `spatial-search` @ 10 | `spatial-search` @ 10 |
| B19-transaction | `transaction-lock-scope` | checkout.ts:12–19 | `transaction-lock-scope` @ 19 | `transaction-lock-scope` @ 11 | `transaction-lock-scope` @ 19 |
| B20-connection | `connection-management` | reportHandler.ts:5–6 | `connection-management` @ 5 | `connection-management` @ 5 | `connection-management` @ 5 |
| B21-payload | `payload-overfetch` or `db-query-index` | customerList.ts:5 | `payload-overfetch` @ 5 | `payload-overfetch` @ 5 | `payload-overfetch` @ 5 |
| B22-rescan | `full-rescan-incremental` | dailyTotalsJob.ts:7–9 | `full-rescan-incremental` @ 7 | `full-rescan-incremental` @ 7 | `full-rescan-incremental` @ 7 |
| B23-warehouse | `warehouse-query-cost` | dailyActiveReport.ts:7–9 | `warehouse-query-cost` @ 7 | `warehouse-query-cost` @ 7 | `warehouse-query-cost` @ 7 |
| B24-lock | `lock-contention` | handler.go:21–25 | `lock-contention` @ 21 | **`transaction-lock-scope` @ 21** | `lock-contention` @ 21 |
| B25-blocking | `blocking-in-async` | profile.py:13–16 | `blocking-in-async` @ 13 | `blocking-in-async` @ 13 | `blocking-in-async` @ 13 |
| B26-polling | `polling-event-rate` | useNotifications.ts:9–12 | `polling-event-rate` @ 9 | `polling-event-rate` @ 9 | `polling-event-rate` @ 9 |
| B27-leak | `resource-leak` | PriceTicker.tsx:14–16 | `resource-leak` @ 14 | **`resource-leak` @ 8** | **`resource-leak` @ 8** |
| B28-coldstart | `startup-cold-start` or `caching-recomputation` or `connection-management` | handler.ts:8–9 | `caching-recomputation` @ 8 | `startup-cold-start` @ 8 | `caching-recomputation` @ 8 |
| B29-logging | `logging-overhead` | importBatch.ts:8–11 | `logging-overhead` @ 8 | `logging-overhead` @ 8 | `logging-overhead` @ 8 |
| B30-pageload | `page-load-delivery` | Dashboard.tsx:19–30 | `page-load-delivery` @ 24 | `page-load-delivery` @ 27 | **`page-load-delivery` @ 36** |
| B31-inline | `inline-slow-work` | orderRoute.ts:13–15 | `inline-slow-work` @ 13 | `inline-slow-work` @ 13 | `inline-slow-work` @ 13 |
| B32-hotpath | `hot-path-constants` | exportNames.ts:4–5 | `hot-path-constants` @ 4 | `hot-path-constants` @ 4 | `hot-path-constants` @ 4 |
| B33-linear-call | `linear-call-in-loop` or `lookup-in-loop` or `dedup-set-ops` | duplicates.py:4 | `linear-call-in-loop` @ 4 | `linear-call-in-loop` @ 4 | `linear-call-in-loop` @ 4 |
| B34-combinatorial | `combinatorial-explosion` | routePlanner.ts:5–16 | `combinatorial-explosion` @ 16 | `combinatorial-explosion` @ 16 | `combinatorial-explosion` @ 16 |
| B35-sql-shape | `sql-query-shape` or `db-query-index` | eventsPage.ts:15 | `sql-query-shape` @ 15 | `sql-query-shape` @ 15 | `sql-query-shape` @ 15 |
| B36-unbuffered | `unbuffered-io` or `io-batching-n-plus-one` | export_rows.py:7–10 | `unbuffered-io` @ 7 | `unbuffered-io` @ 6 | `unbuffered-io` @ 7 |
| B37-parallelism | `parallelism-overhead` | score_documents.py:12 | `parallelism-overhead` @ 12 | `parallelism-overhead` @ 12 | `parallelism-overhead` @ 12 |
| B38-unbounded | `unbounded-input` or `payload-overfetch` | searchRoute.ts:6–15 | `unbounded-input` @ 9 | `unbounded-input` @ 9 | `unbounded-input` @ 9 |
| M01-statement, part 1 | `io-batching-n-plus-one` | transactions.ts:7–8 | `io-batching-n-plus-one` @ 7 | `io-batching-n-plus-one` @ 7 | `io-batching-n-plus-one` @ 7 |
| M01-statement, part 2 | `lookup-in-loop` | summarize.ts:9 | `lookup-in-loop` @ 9 | `lookup-in-loop` @ 9 | `lookup-in-loop` @ 9 |
| M01-statement, part 3 | `allocation-gc` | csv.ts:5 | `allocation-gc` @ 4 | **`linear-call-in-loop` @ 4** | **`linear-call-in-loop` @ 4** |
| M02-webhooks, part 1 | `concurrency-backpressure` or `distributed-calls` | dispatch.ts:9 | `concurrency-backpressure` @ 9 | `concurrency-backpressure` @ 9 | `concurrency-backpressure` @ 9 |
| M02-webhooks, part 2 | `distributed-calls` | deliver.ts:5–7 | `distributed-calls` @ 5 | **`concurrency-backpressure` @ 5** | `distributed-calls` @ 5 |

</details>

All 18 good samples came back `clean` with no finding in every arm that ran them: S and N on the 4 of round 1, the 13 traps of round 2 and G14; I on all 18.

**Where the skill's cost sits** (the 39 samples of round 2; each step is the difference between two rows of the table above):

| Step | Cumulative input (median) | USD, 39 runs | USD per review |
|---|---|---|---|
| N: the ids only | 16,664 | 0.7528 | 0.0193 |
| N → I: add the index | + 4,682 (28 % of N) | + 0.4831 (64 % of N) | 0.0317 |
| I → S: add the reference files | + 2,559 (12 % of I) | + 0.3212 (26 % of I) | 0.0399 |

- Of the 7,241 tokens between N and S, 4,682 belong to the index: 65 %.
- Of the 0.8043 USD between them, 0.4831 belongs to the index: 60 %.
- A likely reason, not measured separately: the index is read in request 1, so it is sent again in requests 2 and 3; a reference file is read in request 2 and sent again once.

**Limits.**
- One run per arm, and I ran a day after S and N, with the same Claude Code version and model id.
- Only the round-2 rows compare like with like. On the round-1 samples S and N had run with a 15-class index and without the `checked` field.
- "Class id right" and "place right" were computed after the runs, by a separate script over the same replies; `score.mjs` reports only the two together.
- The gap between I and S is three findings out of 29.

**Reading** *(synthesis)*:
- **On these samples the index did the labelling.** With the index alone the class id was right for 42 of 43 planted problems, against 43 of 43 with the reference files and 39 of 43 with the bare list of ids (one run each, Sonnet, headless).
- **Between S and I three findings differ, and only in their labels:** two were filed at other lines (B27, B30), and one got another class id (M01, where both arms had read the same text). Detection, fixes and false positives were the same.
- **Dropping them saves little:** 11 % of the input (21,346 against 23,905) and 21 % of the reported cost (1.24 against 1.56 USD), about 0.008 USD per review. So cost is a weak reason to drop the reference files, and stable class ids are a weak reason to keep them.
- **What would decide it is still untested:** whether the reference files help on facts newer than the model, and on real, larger flows.
- **The larger share of the cost is the index.** A shorter index, with fewer words per signal, has not been tried.

### 6.5 Round 3: 96 new classes, 135 in the index

**Question:** after the index grew from 39 to 135 classes, does the agent find the new classes, does it stay quiet on code built to look like them, and does the skill still cost what §6.4 predicts?

**Setup** (2026-11-26, Claude Code 2.1.332, headless, model id `claude-sonnet-5-5`, one run per arm).
- **The skill.** 96 classes were added from thirteen domain catalogs (`problem-classes-<domain>.md`, listed in `problem-classes.md`): one reference file per class, written from the reviewed catalog and checked against it, and one index row each. The index is 31,330 characters with 135 rows (8,432 with 39 rows in §6.3). 36 of the rows sit under "Only when the workload asks for it", because their cost is a constant factor per call or per element.
- **Samples.** 127 new ones in TypeScript, JavaScript, Python, Go, Java, C#, Kotlin, Rust, C++, Ruby, SQL, YAML, Dockerfiles and nginx configuration:
  - 96 with one planted problem, one per new class (B39–B134);
  - 31 known-good traps (G20–G50), each built on a "Not a problem when" row of a new class.
  - One agent per catalog wrote them from a shared brief; a script checked every answer-key line, and that no file or folder name gives the answer away.
- **Arms.** S and N as in §5. N's prompt lists all 135 class ids. S also ran on the 18 good samples of the earlier rounds.
- **Work folders have neutral names.** Until this round the copy of a sample kept the sample's name, and the agent sees its working directory: good samples such as `G09-shared-clients-ok` told it the answer. `run.mjs` now copies each sample to a numbered folder (`c074`).

```bash
node run.mjs --out results/2026-11-26-round3 --arms S:1 --samples <the 127 new samples and the 18 old good ones> --parallel 6
node run.mjs --out results/2026-11-26-round3 --arms N:1 --samples <the 127 new samples> --parallel 6
node score.mjs results/2026-11-26-round3
```

**Result on the 127 new samples** ✅[^lab-cal]:

| Arm | Class and place both right | Class id right | Place right | Fix pattern matched, of the matched findings | Traps clean | Findings outside the answer key | JSON only | First request (median) | Cumulative input (median) | Output tokens (median) | USD, 127 runs | USD per review |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S | 96/96 | 96/96 | 96/96 | 96/96 | 30/31 | 4 | 126/127 | 4,473 | 44,425 | 1,410 | 10.62 | 0.0836 |
| N | 86/96 | 86/96 | 96/96 | 86/86 | 26/31 | 18 | 124/127 | 5,603 | 19,926 | 1,164 | 2.91 | 0.0229 |

These are the scores after the answer key was corrected (below). Before the correction the scorer gave S 94 of 96 and N 83 of 96. The scorer tests a fix only on a finding that matched class and place, so N's column covers 86 findings; the fixes of its other ten findings were judged by hand (next paragraph).

**Read by hand**, by an independent agent that opened every flagged sample, key entry and reply:
- **No real miss in either arm.** Both arms found all 96 planted defects and proposed a correct fix for each.
- **N's ten misses are wrong class ids at the right line:**

  | Sample | Planted class | Id that N used |
  |---|---|---|
  | B47 | `send-per-message` | `await-per-sync-value` |
  | B54 | `unchunked-batch-job` | `unbounded-input` |
  | B63 | `compose-new-instance-params` | `caching-recomputation` |
  | B65 | `lazy-reenumeration` | `io-batching-n-plus-one` |
  | B94 | `whole-object-transfer` | `unchunked-batch-job` |
  | B95 | `object-store-listing` | `full-pass-for-first` |
  | B107 | `source-maps-on-hot-stacks` | `stack-capture-per-call` |
  | B108 | `sibling-collection-join` | `join-row-explosion` |
  | B109 | `tracked-read-only-query` | `allocation-gc` |
  | B128 | `type-unstable-site` | `primitive-boxing` |

- **Two traps were flawed:** each held a real problem its author had not meant. G41 scans a 30 MiB buffer once per word (both arms reported it). G23 has one serial consumer that takes 400 ms per record at 15 records per second (N reported it, S did not).
- **The lint rules agree on G41.** Run over all 185 samples after the round, the five rules of §7.2 flagged that same line of G41 (`no-linear-lookup-in-loop`) and no other good sample. Among the new bad samples they flagged one, B99, at its planted line (`no-await-per-item`); most of the new samples are not TypeScript or JavaScript, so the rules do not see them ✅[^lab-cal].
- **On the 29 sound traps, S raised nothing and N raised findings on three:**
  - G24: a `send-per-message` finding on a topic whose volume fits one lane;
  - G25: a `poison-message-loop` finding although the queue declares a delivery limit of 5 and a dead-letter exchange;
  - G46: a `single-connection-stream-cap` finding although that gRPC client version opens more connections when the stream limit is reached. This is the trap whose reason sits only in the reference file.
  - On the flawed G41, N also filed a `worker-message-copy` finding for a copy made once at start-up.
- **Findings outside the answer key.**
  - S, four: three valid second problems (B42, B62, B98) and one restatement of the planted problem under the key's second class (B84).
  - N, eighteen: the ten mislabelled findings above, five valid second problems (B42, B62, B98, B85, B128), two restatements (B48, B85) and one wrong finding (B84: a prompt-cache finding on a prompt the agent itself called too short to cache).
- **The 18 old good samples** stayed clean in arm S: 18 of 18, with neutral folder names and the 135-class index.
- **By tier:** S found 33 of 33 planted problems of "Only when the workload asks for it" classes and 63 of 63 of the others; N 29 of 33 and 57 of 63. Each sample of the first kind marks its path as hot in the workload.
- **JSON only:** S 143 of 145 (G02 and G27 began with a sentence or two of reasoning); N 124 of 127, and one N reply (G45) could not be parsed at all because prose followed the JSON.
- **How S ran:** it read no reference file in 34 of the 127 new runs, one in 87 and two in 6. 92 runs took 3 requests, 34 took 4 and one took 5.

**Per catalog** (class and place right, then traps clean) ✅[^lab-cal]:

| Catalog | Classes | S | N | Traps | S clean | N clean |
|---|---|---|---|---|---|---|
| datastores | 8 | 8/8 | 8/8 | 3 | 3/3 | 3/3 |
| messaging and jobs | 9 | 9/9 | 7/9 | 3 | 3/3 | 0/3 |
| web and mobile clients | 9 | 9/9 | 8/9 | 3 | 3/3 | 3/3 |
| language runtimes | 8 | 8/8 | 7/8 | 3 | 3/3 | 3/3 |
| data pipelines | 7 | 7/7 | 7/7 | 2 | 2/2 | 2/2 |
| machine-learning and LLM applications | 7 | 7/7 | 7/7 | 2 | 2/2 | 2/2 |
| network and delivery | 9 | 9/9 | 7/9 | 3 | 3/3 | 3/3 |
| JavaScript engine | 8 | 8/8 | 7/8 | 2 | 2/2 | 2/2 |
| JavaScript and TypeScript language | 6 | 6/6 | 6/6 | 2 | 2/2 | 2/2 |
| Node.js runtime | 6 | 6/6 | 5/6 | 2 | 1/2 | 1/2 |
| ORM and migrations | 9 | 9/9 | 7/9 | 3 | 3/3 | 3/3 |
| API and RPC | 3 | 3/3 | 3/3 | 1 | 1/1 | 0/1 |
| containers and runtime configuration | 7 | 7/7 | 7/7 | 2 | 2/2 | 2/2 |

The two flawed traps are counted as the scorer saw them: G41 (Node.js runtime) as not clean in both arms, G23 (messaging and jobs) as not clean in N.

**What the larger index costs** (arithmetic on the tables of §6.3, §6.4 and this section):

| | 39 classes (§6.3) | 135 classes (this round) | Change |
|---|---|---|---|
| Index size | 8,432 characters | 31,330 characters | × 3.7 |
| S: cumulative input (median) | 23,905 | 44,425 | + 86 % |
| S: USD per review | 0.0399 | 0.0836 | × 2.1 |
| N: cumulative input (median) | 16,664 | 19,926 | + 20 % |
| N: USD per review | 0.0193 | 0.0229 | × 1.2 |
| S against N, USD per review | × 2.1 | × 3.7 | |

The whole round cost 14.83 USD (S 11.92 for 145 runs, N 2.91 for 127), plus 0.26 USD for a 4-run smoke test.

**Corrections to the answer key after the run**, each found by the hand reading and applied before the scores above:
- three entries accepted too few places: B100 (the call that captures the stack, ten lines below the anchor), B126 (the missing CPU request is in the Deployment, the key named only the autoscaler file) and B119 (the method declaration in the `.proto` file);
- three fix patterns rejected a correct fix worded differently (B97, B133, B83).
- The two flawed traps and a second real problem in B128 were marked in `expected.json`, and the three samples were repaired the next day (below). The copies that round 3 ran are kept in `results/2026-11-26-round3/samples-as-run/`.

**Repaired samples, re-run on 2026-11-27** ✅[^lab-cal]. Both arms ran once on the three repaired samples, with the skill text as corrected after round 3:

| Sample | Repair | S | N |
|---|---|---|---|
| G41 (trap) | the worker and the main thread look terms up in a `Set` built once | clean | clean |
| G23 (trap) | the workload gives 12 partitions and 12 instances, about 1.3 records per second for each | clean | clean |
| B128 (bad) | keys are 8 characters, so the hash leaves the small-integer range but stays exact and no longer sends every key to one shard | found, with the right class and fix | clean: nothing reported |

- **All 31 traps are sound now.** S raised nothing on any of them; N raised findings on three (G24, G25, G46).
- **N did not report B128.** Its reply names the cause (the arithmetic "runs in doubles, not int32") and calls it a constant factor, although the workload marks the path as hot. N's count stays 86 of 96: 9 wrong class ids and 1 problem not reported. S has the index's rule for such classes ("Only when the workload asks for it") and the reference file, and reported it.
- The lint rules flag neither G41 nor B128 now. The six replies were read here; all were pure JSON. Cost: 0.35 USD.
- These three results come from a second run, a day after the other 124.

**Limits.**
- One run per arm. §6.4 showed one label changing between two runs that had read the same text.
- The samples and the reference files come from the same catalogs. A trap is built on a "Not a problem when" row that arm S can read, so a clean trap shows that the agent used the reference, not that the row is true.
- The samples are small, one problem each, with a stated workload, and were written by agents. No person read all 127.
- The hand reading was done by an agent, not by a person; three of its verdicts on fixes were re-read here.
- N was not run on the old samples with 135 ids, and S was not re-run on the old bad samples.
- The skill text changed after the run: the `object-shape-instability` row and reference file lost a signal (`new Array(n)` filled by index) that a measurement contradicted, and the `for-in-over-array` reference gained a sentence. Only the re-run of the three repaired samples has used the changed text.
- On 2026-11-27, after that re-run, nineteen reference files of the JavaScript engine, JavaScript language and Node.js runtime classes gained version scopes, when their catalogs' lab scripts were run on five more builds. No calibration run has used those nineteen files as they are now.

**Reading** *(synthesis)*:
- **With 135 classes the skill changes what a program receives.** The class id was right for 96 of 96 planted problems with it and 86 of 96 without it; on the traps it raised nothing (29 sound ones in the round, the two repaired ones in the re-run), against findings on 3 without it. With 39 classes the same comparison was 43 of 43 against 39 of 43, and no trap separated the arms (§6.3, §6.4).
- **Detection barely changed.** In the round, with or without the skill, Sonnet found every planted defect and proposed a correct fix, as in rounds 1 and 2. The one exception came in the re-run: without the skill it saw the cause of B128 and chose not to report it.
- **The price went up as §6.4 predicts.** A review with the skill costs 0.084 USD against 0.023 without it, 3.7 times; the index carries most of that, and it is sent again in every request after the first.
- **The untested lever is a smaller index per kind of repository** (client, server, data): the agent of a front-end repository does not need the rows on brokers or migrations.

---

## 7. The computational checks, calibrated

### 7.1 The scaling harness

`perf-scale.mjs` runs a command at each size, with `N` in its environment, and takes the median of several runs of the `ms=<time>` the command prints. It reports the exponent between neighbouring sizes and the least-squares slope of log time on log size. `--expect-max <e>` fails when the slope is above e.

Tests, with known inputs ✅[^lab-cal]:

| Fixture | Sizes | Slope | Test |
|---|---|---|---|
| One pass over N items (linear) | 250,000 … 2,000,000 | inside 0.7–1.3 | pass |
| `indexOf` for each of N items (quadratic) | 8,000 … 64,000 | 1.89 (pairs 1.67, 2.03, 1.94) | pass |
| The same, `--expect-max 1.3` | 8,000 … 32,000 | — | exits 1, as it should |

**A finding about sizes.** With the quadratic fixture at 2,000 … 8,000, the medians were 2.2, 3.6 and 8.3 ms, and the fitted slope was 0.94, although the code is quadratic ✅[^lab-cal].

The cause is a fixed cost in every run. Taking the quadratic part from the largest size (442.6 ms at 64,000, so 1.08 × 10⁻⁷ ms per n²):

| n | Measured | Quadratic part | Left over (fixed cost) |
|---|---|---|---|
| 2,000 | 2.23 ms | 0.43 ms | 1.80 ms |
| 4,000 | 3.59 ms | 1.73 ms | 1.86 ms |
| 8,000 | 8.26 ms | 6.92 ms | 1.34 ms |
| 16,000 | 28.31 ms | 27.66 ms | 0.64 ms |

About 1–2 ms of each run does not depend on n. The likely cause, inferred and not measured separately, is that the loop first runs in the interpreter and is compiled only once it is hot. At n = 2,000 that fixed part is four times the real work, so doubling n raised the time by 1.6×, not 4×. The harness therefore warns when any median is under 10 ms.

### 7.2 The lint rules

Three rules in `lint/perf-rules.mjs` use only the AST and scope API that ESLint passes in:
- `no-linear-lookup-in-loop`; in the first version it skipped only searches inside a loop element's own sub-collection and some strings (the small-literal-array guard, up to 16 items, came in the second version below);
- `no-accumulating-spread`;
- `no-sort-for-top-k`.

The first version's RuleTester suite (11 valid, 11 invalid snippets) passed, and its recommended config also turned on ESLint's `no-await-in-loop`. ESLint was not installed when this doc was reviewed on 2026-11-26, so the lint tables were not re-run; the second version's 24 valid and 18 invalid snippets were counted in `tests/perf-rules.test.mjs`.

**Run over the 18 samples** with ESLint 10.15.0 and the typescript-eslint parser (`lint-samples.mjs`) ✅[^lab-cal]:

| Result | Samples |
|---|---|
| A hit at the planted problem | B01, B02 (`no-linear-lookup-in-loop`); B03 (`no-sort-for-top-k`); B07 (`includes` inside the nested loop); B09 (two `no-accumulating-spread`); B10 and B13 (`no-await-in-loop`): 7 of 14 |
| A hit, but not at the main problem | B14: `includes` inside the filter callback (the main cost is rendering 20,000 rows) |
| No hit | B04, B05, B06, B08, B11, B12 |
| Hits on good samples (false positives) | G02: `staff.filter` inside the day and shift loops (sizes are small); G03 and G04: `no-await-in-loop` on intentional sequential awaits: 3 of 4 |

So the rules are leads for the reviewer, not a gate. The `no-await-in-loop` docs name the same exception: iterations that depend on each other ✅[^eslint-await].

**Second version: guards for the false positives.** The three false positives each had a cause a rule can see, so the rules were changed and the core `no-await-in-loop` was dropped:

| False positive | Cause | Guard added |
|---|---|---|
| G02: `staff.filter` inside loops over days and shifts | Both loops run over small constant arrays | A loop over a literal array of up to 16 items (inline or `const`) does not count as a loop |
| G03: `await once(out, "drain")` in the write loop | The awaited call does not depend on the loop's element | New rule `no-await-per-item`: only a `for…of` whose awaited call uses the element (or a value derived from it) |
| G04: awaits in a worker loop and in a retry loop with a delay | Counter and `while` loops are workers, retries or cursors, not one call per item | The same rule ignores them. New rule `no-retry-without-delay`: a retry loop counts only when no delay is awaited between attempts |
| B14: `p.name.toLowerCase().includes(q)` | A search in the element's own text, reached through a method call | The receiver is traced back through method calls to the element |

**Result of the second version** on the same 18 samples ✅[^lab-cal]:

| | First version | Second version |
|---|---|---|
| Bad samples flagged at the planted problem | 7 of 14 (B01, B02, B03, B07, B09, B10, B13) | 6 of 14 (B01, B02, B03, B09, B10, B13) |
| Hits beside the main problem | 1 (B14) | 0 |
| Good samples flagged | 3 of 4 | 0 of 4 |
| RuleTester snippets | 11 valid, 11 invalid | 24 valid, 18 invalid |

- **What was lost:** B07. Its hit came from the string `includes` inside two nested loops, which the new guard treats as a search in the element's own text. No rule here targets "every phrase against every message".
- **Caution:** the guards were written while looking at these four good samples, so "0 of 4" shows that the guards work on them, not how the rules behave on new code. The snippets in `tests/perf-rules.test.mjs` add other shapes, and a test now fails if any known-good sample is flagged. Fresh known-good samples are still needed.

### 7.3 Ground truth: do the known fixes change the growth?

Six samples' own code (`VARIANT=before`, imported straight from the `.ts` files) and their known fixes (`after`) were run under `perf-scale.mjs`. Each run checks that both versions give the same answer (`bench/`, Node.js 24.22.1, Apple M2) ✅[^lab-cal]:

| Sample (data shape) | Before: sizes → slope | After: sizes → slope | Same size, before / after, median of 5 runs |
|---|---|---|---|
| B01-lookup (m = n/4 customers) | 8,000–64,000 → 1.55 (pairs 0.63, 2.35, 1.42); at 2,000–8,000 the pairs were 1.90 and 1.97 | 400,000–3,200,000 → 1.59 | n = 32,000: 474.7 ms / 2.8 ms, 168× |
| B02-dedup (85 % distinct) | 8,000–64,000 → 2.14 | 800,000–6,400,000 → 1.43 | n = 64,000: 4,858.7 ms / 6.4 ms, 765× |
| B03-topk (k = 10) | 250,000–2,000,000 → 1.18 | 1,000,000–8,000,000 → 0.61 | n = 2,000,000: 829.7 ms / 19.6 ms, 42× |
| B04-range (n/8 queries, ranges up to n/4) | 32,000–256,000 → 2.05 | 2,000,000–16,000,000 → 0.85 | n = 256,000: 577.1 ms / 2.5 ms, 233× |
| B05-graph (E = 3V, goal unreachable) | 2,000–16,000 → 2.28 | 50,000–400,000 → 1.46 | V = 16,000: 6,008.4 ms / 12.8 ms, 468× |
| B09-allocation | 1,000–8,000 → 2.33 | 400,000–3,200,000 → 1.15 | n = 8,000: 8,045.8 ms / 0.67 ms, about 12,000× |

- **Before.** The four quadratic samples (B02, B04, B05, B09) fitted 2.05–2.33. B03's sort fitted 1.18, as n log n should. B01 was noisy across sizes: its pairs ranged from 0.63 to 2.35.
- **After.** The fixed versions fitted 0.61–1.59, not a clean 1. At millions of items, hash maps and sets outgrow the caches, and B01 and B02 fitted 1.59 and 1.43. Where the work per item is tiny (B03, B04), fixed costs flatten the smaller sizes and the slope falls below 1.
- **Why "after" is not a clean 1.** The operation count is linear, but one operation does not cost the same at every size. With the number of lookups fixed at 2,000,000 and only the `Map` size changed (best of 5 runs per size) ✅[^lab-cal]:

  | Entries in the `Map` | Time per lookup |
  |---|---|
  | 1,000 | 23.4 ns |
  | 10,000 | 23.8 ns |
  | 100,000 | 37.5 ns |
  | 1,000,000 | 216.6 ns |
  | 4,000,000 | 224.1 ns |

  A small table stays in the processor's caches. A table of a million entries does not, so most lookups wait for main memory ([memory hierarchy](../hardware/memory-hierarchy-and-caches.md)). The cost per lookup rose about 9× while the count stayed the same (a re-run on 2026-11-26 gave 20.3 ns and 161.8 ns, 8×, so the size of the rise varies between runs), and that rise is what bends a linear algorithm's slope above 1.
- **Same size.** The clearest signal: at one size, the fix was 42× to about 12,000× faster, and both versions gave the same answer in every run. B03's 42× is far more than its comparison count predicts (log n against log k, about 6×): the heap rejects most items with one comparison, while the sort copies and compares every item.
- **Re-runs.** Seven entries of the first pass had a median under 10 ms. They were re-run at larger sizes, and the table shows the re-runs; both passes are in `bench/results-2026-11-25.txt`.

**Round 2 samples.** Five of the new samples were run the same way ✅[^lab-cal]:

| Sample | The sample's code | The known fix |
|---|---|---|
| B15-seq-shift, 200,000 tasks, 30 % cancelled | 3,900 ms | one `filter` pass: 131 ms |
| B16-subproblems, 8 coins | amount 30: 136 ms; amount 40: 29,061 ms; amount 50: stopped after several minutes | a table for amount 10,000: 3.4 ms |
| B32-hotpath, 200,000 rows | 13,012 ms | one `Intl.Collator` and one `Intl.NumberFormat`: 535 ms |
| B33-linear-call (Python 3.13) | 10,000 items: 882 ms; 20,000: 4,333 ms; 40,000: 15,010 ms | `Counter`, 40,000 items: 5.0 ms; 200,000: 28.9 ms |
| B34-combinatorial | 8 stops: 27 ms; 9: 213 ms; 10: 2,179 ms | not implemented |

B16 shows exponential growth directly: ten more units of amount multiplied the time by 214. B34's times grew ×7.8 and then ×10.2 per added stop, close to the ×9 and ×10 that n! predicts; at that rate 40 stops is out of reach by many orders of magnitude.

---

## 8. What studies say

**Real performance bugs often follow patterns that a rule or a reader can spot:**
- **Jin et al. (PLDI 2012)** studied 109 performance bugs from Apache, Chrome, GCC, Mozilla and MySQL. They extracted efficiency rules from 25 patches, and those rules found 332 previously unknown performance problems ✅[^jin].
- **Selakovic and Pradel (ICSE 2016)** studied 98 fixed JavaScript issues:
  - the most common root cause (52 %) was choosing the slower of functionally equivalent APIs;
  - only 42.68 % of the optimizations improved performance consistently across all versions of both engines studied (SpiderMonkey and V8), and 15.85 % made some engine slower ✅[^selakovic].
- **CARAMEL (ICSE 2015)** looked for loops whose fix is a non-intrusive condition. It found 61 new bugs in Java and 89 in C/C++ applications, with 19 and 4 false positives ✅[^caramel].

**Language models find and fix performance problems less reliably than they write code:**
- **SWE-Perf (2025):** in its repository-level setting, OpenHands with Claude 3.7 Sonnet gained 2.26 % against the experts' 10.85 % on real repositories (Table 2 of the paper) ✅[^sweperf].
- **GSO (2025):** leading software-engineering agents succeeded on under 5 % of its optimization tasks ✅[^gso].
- **EffiBench (2024):** GPT-4's code took on average 3.12 times the execution time of the canonical human solutions ✅[^effibench].
- **Yi, Gay and Leitner (2025):** language models "struggle to autonomously pinpoint performance hotspots" ✅[^yi].
- **SWE-PRBench (2026):** eight frontier models detected 15–31 % of the issues human reviewers had flagged, given only the diff ✅[^swepr].
- **RAPGen (2023)** retrieves known fix patterns into the prompt. On its expert-verified set, its fix was equivalent to or better than the developer's in about 60 % of cases, on C# performance changes ✅[^rapgen]. No with-and-without-retrieval comparison was found.

**Timing claims need controls:**
- **Mytkowicz et al. (ASPLOS 2009):** changing the size of an unused environment variable changed a program's performance "frequently by about 33% and once by almost 300%". Of 133 surveyed papers from ASPLOS, PACT, PLDI and CGO, none of those with experimental results adequately considered this measurement bias ✅[^mytkowicz].
- **Georges et al. (OOPSLA 2007)** advise many measurements and confidence intervals ✅[^georges].
- **PIE (ICLR 2024)** built its evaluation environment on the gem5 simulator and reports a mean speedup of 6.86 with eight generations, against 3.66 for individual human programmers ✅[^pie].

**No study was found** of performance issues raised in code review as such, nor of a language model reviewing code for performance classes. This calibration is a small local substitute, not that study.

---

## 9. Lessons

1. **For an agent run as the session, point to its knowledge by path.** `${CLAUDE_PLUGIN_ROOT}` in the agent body is replaced with the plugin's path. In Claude Code 2.1.332, headless, with Haiku, frontmatter `skills:` was preloaded only when the agent ran as a subagent (§3, §3.1: three agent kinds, one run each), and the Skill tool added about 2,900 tokens to every request with this machine's skill listing (§3.2).
2. **Progressive disclosure held.** In round 1 (Sonnet, S runs 1 and 2) the agent read the index plus exactly the matching reference file in 28 of 28 bad-sample runs, and never more than one reference file; in round 2 it did the same on 24 of 24 single-problem samples (§6, §6.3).
3. **Calibrate with known-good samples, not only known-bad ones.** The traps (constant-size nested loops, a necessary sort, intentional awaits) are where a checker's false positives show. The first lint rules fired on 3 of 4 good samples; the agent on none of 17 good samples. Each false positive pointed to a guard the rule could have, and the second version fired on none of the 4 it was tuned on (§6, §6.3, §7.2).
4. **Measure what the knowledge adds.** Over two rounds (Sonnet, headless, small samples with a stated workload) the skill added 27–43 % input and changed no verdict read by hand; it made the class labels stable (§6, §6.3). A third arm then split the skill into its two parts (§6.4, one run): the index alone gave 42 of 43 class ids right and carried 65 % of the extra tokens; the reference files carried the rest, and without them two findings were filed at other lines. Measure the parts apart before deciding which to keep. And measure again when the knowledge grows: with 135 classes the skill did change the class ids (96 of 96 against 86 of 96) and the false positives on traps (none against three of 29), at 3.7 times the cost per review (§6.5).
5. **Parse an agent's JSON defensively.** Two wordings and an extra field did not make every reply pure JSON in round 1: 84 of 87 were. In round 2, with the field, 78 of 78 were; whether the field caused that is undetermined (§5, §6.2, §6.3).
6. **Check the scorer too.** A too-narrow regex marked a correct answer wrong; read a sample of findings by hand (§5).
7. **The growth exponent separates quadratic from near-linear, but it is not an exact O() meter.** Under about 10 ms per run, start-up and warm-up hid the growth; at millions of items, memory effects pushed linear code to 1.4–1.6 (Node.js 24.22.1, Apple M2, these fixtures). Compare before and after at the same sizes, at three sizes or more (§7.1, §7.3).

8. **Hide the answer from the working directory.** The agent sees the folder it runs in. For two rounds the good samples ran in folders whose names ended in `-ok`; the 18 of them stayed clean when re-run under neutral names, so no effect was seen, but the leak was real (§6.5).
9. **Read the scorer's misses before believing them.** In round 3 the scorer first reported 2 misses with the skill and 13 without. Read by hand, none was a missed defect: 3 were places the key did not accept, 10 were wrong class ids. Two traps held a real problem their author had not planted (§6.5).

---

## 10. Repeat it

All paths are relative to the plugin folder (`~/workspace/archkit/build`).

**Plugin tests (hooks, scaling harness, lint rules, lint over the samples):**

```bash
ESLINT_DIR=<an installed eslint package folder> TS_PARSER_DIR=<@typescript-eslint/parser folder> node --test tests/*.test.mjs
```

**Calibration** (54 headless runs):

```bash
cd calibration/perf-reviewer
node run.mjs --out results/<date> --arms S:2,N:1 --parallel 4
node score.mjs results/<date>
```

**The index-only arm** (58 headless runs; rebuild the variant after any change to the agent or the index):

```bash
cd calibration/perf-reviewer
node variants/build-index-only.mjs
node run.mjs --out results/<date>-index-only --arms I:1 --parallel 4
node score.mjs results/<date>-index-only
```

**Round 3** (272 headless runs, about 15 USD on 2026-11-26; the sample lists are comma-separated folder names under `samples/`):

```bash
cd calibration/perf-reviewer
node run.mjs --out results/<date>-round3 --arms S:1 --samples <B39 to B134, G20 to G50 and the old G samples> --parallel 6
node run.mjs --out results/<date>-round3 --arms N:1 --samples <B39 to B134 and G20 to G50> --parallel 6
node score.mjs results/<date>-round3
```

**Lint over the samples:**

```bash
ESLINT_DIR=… TS_PARSER_DIR=<@typescript-eslint/parser folder> node lint-samples.mjs
```

**Ground truth:**

```bash
cd bench && sh run-all.sh
```

**Tokens for any session:** `python3 -I scripts/measure.py <session-id>`.

---

## 11. Verification

- **Measured on 2026-11-25** on one machine: every ✅[^lab-probe] and ✅[^lab-cal] result, except the G14 trap of §6.3, arm I of §6.4 and round 3 of §6.5, all run on 2026-11-26, and the three repaired samples of §6.5, run on 2026-11-27. Raw CLI output, per-run metadata and `scores.json` are in the plugin's `calibration/perf-reviewer/results/2026-11-25/`. Each S sample ran twice and each N sample once, so the numbers show size, not spread.
- **Checked against the Claude Code docs on 2026-11-25:** the `skills` field, the plugin-agent fields, path-variable substitution, and `--allowedTools Read` in headless mode.
- **Read on 2026-11-25:** the studies in §8, in their abstracts or full text through a page reader that returns extracted text. The numbers are as quoted there. For Mytkowicz et al. the text read was the submission draft.
- **Re-checked on 2026-11-26 by an independent reviewer:** every table in §6–§6.3 recomputed from the `scores.json` files; §7.1, §7.3 and the Map-lookup table re-run or compared with `bench/results-2026-11-25.txt`; the study numbers re-read in the papers' text (SWE-Perf's 2.26 % and 10.85 % in Table 2 of its HTML version; Mytkowicz et al.'s 33 % and 300 % were not on the landing page and were not re-read); the ESLint tables were not re-run.
- **Arm I, 2026-11-26:** its three scorer misses and its two findings outside the answer key were read by hand; class and place were split by a separate script over the same replies; the files each run read were taken from its transcript. An independent agent then recomputed every number of §6.4 from the raw result files and the transcripts and found none that differed. The raw replies themselves stay in the plugin folder (`results/2026-11-26-index-only/`), which is not under version control; the per-problem table of §6.4 is the copy kept here.
- **Round 3, 2026-11-26:** the tables of §6.5 come from `scores.json` of `results/2026-11-26-round3/` after the answer-key corrections listed there; the first scores are kept beside it as the corrections' record. Every flagged case was read by an independent agent; its verdicts on three fixes were re-read. The 127 samples, the 96 reference files and the index rows were written by agents and checked by scripts and by other agents, not by a person.
- **Synthesis, not a sourced claim:** the "Reading" paragraph in §6 and §9.
- **Changed after the runs:** one row of `references/verification.md` now warns that linear code on millions of items can fit a slope of 1.4–1.6, from §7.3. The reviewer ran with the earlier text.
- **Changed after the review of 2026-11-26:** six reference files were corrected to match what their sources say (virtual-thread pinning by JDK version, the skip-scan condition, Dijkstra's stated bounds, `ArrayList` costs, the Django Tasks exception, the latency table's origin). No run has used the corrected text.
- **Not settled:**
  - how much the class ids vary from run to run: §6.4 and §6.5 have one run per arm, and in §6.4 one label differed between two arms that had read the same text;
  - whether a smaller index per kind of repository keeps the round-3 result at a lower cost (§6.5);
  - whether the traps' reasons are true: a clean trap in arm S shows that the agent used the reference file, and the reference files rest on the reviewed catalogs, not on runs of the code;
  - whether a shorter index keeps the class ids right at lower cost: the index carries about 65 % of the skill's extra tokens (§6.4);
  - whether reference files help on facts newer than the model: no sample tested that;
  - behaviour on real, larger code flows: every sample here is small and has a stated workload;
  - how the second version of the lint rules behaves on known-good code it was not tuned on (§7.2);
  - why `skills:` is not preloaded for an agent run as the session: the docs do not state it (§3.1);
  - why USD rose by 77 % when input rose by 27 % (the token types and prices were not split).

## References

- Local experiments: the loading probes of §3, a throwaway plugin and a project-level agent, run with Claude Code 2.1.332 and Haiku, 2026-11-25. Sessions 38ea613a, 17de3294, a7fd634a and d5946330 (§3); ab8874d3, 96116e54, 89b962e6, 1baa10c7, 766bcb4f and 3d6fcd06 (§3.1). Sizes from `measure.py` over their transcripts; the tool definitions and the skill listing read from the recorded requests. Backs: §3. [^lab-probe]
- Local calibration: `archkit-build` plugin, `calibration/perf-reviewer/` (samples, `expected.json`, `run.mjs`, `score.mjs`, `lint-samples.mjs`, `bench/`) and `tests/`. Run with Claude Code 2.1.332 and Sonnet, Node.js 24.22.1, ESLint 10.15.0, on an Apple M2, 2026-11-25; the G14 trap of §6.3 and arm I of §6.4 ran on 2026-11-26 (`results/2026-11-26-skip-scan/`, `results/2026-11-26-index-only/`, `variants/index-only/`), and so did round 3 of §6.5 (`results/2026-11-26-round3/`, samples B39 to B134 and G20 to G50); the three repaired samples ran on 2026-11-27 (`results/2026-11-27-repaired/`). Backs: §3.2, §6, §7. [^lab-cal]
- [Harness lab notebook](../../ai-agents/harness-lab/lab-notebook.md) — the earlier experiments on tool allowlists (E2, E8), reviewer calibration (E4), characters per token in a recorded request (E11), `CLAUDE.md` loading by folder (E12) and the settings layer (E13). Backs: §2, §3.2, §5. [^lab-notebook]
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Anthropic, living, read 2026-11-25. Backs: §3, the `skills` field. [^cc-sub]
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference) — Anthropic, living, read 2026-11-25. Backs: §3, plugin-agent fields and path variables. [^cc-plugins]
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) — Anthropic, living, read 2026-11-25. Backs: §3, `--allowedTools Read`. [^cc-headless]
- [When "A Helpful Assistant" Is Not Really Helpful: Personas in System Prompts Do Not Improve Performances of Large Language Models](https://arxiv.org/abs/2311.10054) — Zheng et al., Findings of EMNLP 2024. Backs: §2. [^persona]
- [How Many Instructions Can LLMs Follow at Once?](https://arxiv.org/abs/2507.11538) — Jaroslawicz et al., 2025. Backs: §2. [^ifscale]
- [Why language models hallucinate](https://openai.com/index/why-language-models-hallucinate/) — Kalai et al., OpenAI, 2025. Backs: §2. [^oai-hall]
- [no-await-in-loop](https://eslint.org/docs/latest/rules/no-await-in-loop) — ESLint, living. Backs: §7.2. [^eslint-await]
- [Understanding and Detecting Real-World Performance Bugs](https://ece.uwaterloo.ca/~wshang/soen691/current/papers/pldi118-jin.pdf) — Jin, Song, Shi, Scherpelz, Lu, PLDI 2012. Backs: §8. [^jin]
- [Performance Issues and Optimizations in JavaScript: An Empirical Study](https://software-lab.org/publications/icse2016-perf.pdf) — Selakovic and Pradel, ICSE 2016. Backs: §8. [^selakovic]
- [CARAMEL: Detecting and Fixing Performance Problems That Have Non-Intrusive Fixes](https://ece.uwaterloo.ca/~wshang/soen691/2016winter/papers/icse15.pdf) — Nistor, Chang, Radoi, Lu, ICSE 2015. Backs: §8. [^caramel]
- [SWE-Perf: Can Language Models Optimize Code Performance on Real-World Repositories?](https://arxiv.org/abs/2507.12415) — He et al., 2025. Backs: §8. [^sweperf]
- [GSO: Challenging Software Optimization Tasks for Evaluating SWE-Agents](https://arxiv.org/abs/2505.23671) — Shetty et al., 2025. Backs: §8. [^gso]
- [EffiBench: Benchmarking the Efficiency of Automatically Generated Code](https://arxiv.org/abs/2402.02037) — Huang et al., NeurIPS 2024 Datasets and Benchmarks. Backs: §8. [^effibench]
- [Do AI Models Dream of Faster Code? An Empirical Study on LLM-Proposed Performance Improvements in Real-World Software](https://arxiv.org/abs/2510.15494) — Yi, Gay, Leitner, 2025. Backs: §8. [^yi]
- [SWE-PRBench: Benchmarking AI Code Review Quality Against Pull Request Feedback](https://arxiv.org/abs/2603.26130) — Kumar, 2026. Backs: §8. [^swepr]
- [RAPGen: An Approach for Fixing Code Inefficiencies in Zero-Shot](https://arxiv.org/abs/2306.17077) — Garg, Zilouchian Moghaddam, Sundaresan, 2023. Backs: §8. [^rapgen]
- [Producing Wrong Data Without Doing Anything Obviously Wrong!](https://sape.inf.usi.ch/publications/asplos09) — Mytkowicz, Diwan, Hauswirth, Sweeney, ASPLOS 2009. Backs: §8. [^mytkowicz]
- [Statistically Rigorous Java Performance Evaluation](https://dri.es/files/oopsla07-georges.pdf) — Georges, Buytaert, Eeckhout, OOPSLA 2007. Backs: §8. [^georges]
- [Learning Performance-Improving Code Edits](https://arxiv.org/abs/2302.07867) — Shypula et al., ICLR 2024. Backs: §8. [^pie]

## Related

- [problem-classes.md](problem-classes.md) — the catalog the reference files are written from, with its sources.
- [../../ai-agents/efficient-coding-agents-deep-dive.md](../../ai-agents/efficient-coding-agents-deep-dive.md) — why tool allowlists, few instructions and separate evaluators.
- [../../ai-agents/harness-lab/lab-notebook.md](../../ai-agents/harness-lab/lab-notebook.md) — the harness this agent joins, and its earlier experiments.
- [../measurement/benchmarking-methodology.md](../measurement/benchmarking-methodology.md) — running a benchmark you can trust.
- [../../algorithms/fundamentals/measuring-complexity-empirically.md](../../algorithms/fundamentals/measuring-complexity-empirically.md) — the doubling experiment behind the scaling harness, with its sources and limits.
