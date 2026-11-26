---
schema: deep-dive/v1
topic: performance/code-review
status: verified
applies-to: ["Claude Code 2.1.332, headless -p, Sonnet for the reviewer and Haiku for the loading probes, one macOS machine (Apple M2)", "Node.js 24.22.1; ESLint 10.15.0 with the typescript-eslint parser", "runs of 2026-11-25, and one trap sample run on 2026-11-26"]
last-verified: 2026-11-26
last-updated: 2026-11-26
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

**Use this when:**
- you build or change a review agent and want measured accuracy, false positives and cost;
- you decide how to load an agent's knowledge (a preloaded skill, the Skill tool, or a path in the agent's body);
- you want to repeat the runs; every command is given.

**Depth:**
- three ways to load a skill into an agent run as the session, measured;
- the agent and skill design;
- 18 samples and their answer key;
- 54 scored runs in two arms, with hand checks; a second round of 78 runs on 39 new samples;
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
skills/perf-patterns/SKILL.md              the index: 15 classes at the calibration of §6, 33 in §6.1, 39 in §6.3; each with its signals and its reference file
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
- A cheaper middle arm is untested: the index alone (class ids and signals, no reference files).

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
4. **Measure what the knowledge adds.** Over two rounds (Sonnet, headless, small samples with a stated workload) the reference files added 27–43 % input and changed no verdict read by hand; they made the class labels stable (§6, §6.3). Keep the part that a measurement shows is needed; the traps did not show which part that is.
5. **Parse an agent's JSON defensively.** Two wordings and an extra field did not make every reply pure JSON in round 1: 84 of 87 were. In round 2, with the field, 78 of 78 were; whether the field caused that is undetermined (§5, §6.2, §6.3).
6. **Check the scorer too.** A too-narrow regex marked a correct answer wrong; read a sample of findings by hand (§5).
7. **The growth exponent separates quadratic from near-linear, but it is not an exact O() meter.** Under about 10 ms per run, start-up and warm-up hid the growth; at millions of items, memory effects pushed linear code to 1.4–1.6 (Node.js 24.22.1, Apple M2, these fixtures). Compare before and after at the same sizes, at three sizes or more (§7.1, §7.3).

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

- **Measured on 2026-11-25** on one machine: every ✅[^lab-probe] and ✅[^lab-cal] result, except the G14 trap of §6.3, run on 2026-11-26. Raw CLI output, per-run metadata and `scores.json` are in the plugin's `calibration/perf-reviewer/results/2026-11-25/`. Each S sample ran twice and each N sample once, so the numbers show size, not spread.
- **Checked against the Claude Code docs on 2026-11-25:** the `skills` field, the plugin-agent fields, path-variable substitution, and `--allowedTools Read` in headless mode.
- **Read on 2026-11-25:** the studies in §8, in their abstracts or full text through a page reader that returns extracted text. The numbers are as quoted there. For Mytkowicz et al. the text read was the submission draft.
- **Re-checked on 2026-11-26 by an independent reviewer:** every table in §6–§6.3 recomputed from the `scores.json` files; §7.1, §7.3 and the Map-lookup table re-run or compared with `bench/results-2026-11-25.txt`; the study numbers re-read in the papers' text (SWE-Perf's 2.26 % and 10.85 % in Table 2 of its HTML version; Mytkowicz et al.'s 33 % and 300 % were not on the landing page and were not re-read); the ESLint tables were not re-run.
- **Synthesis, not a sourced claim:** the "Reading" paragraph in §6 and §9.
- **Changed after the runs:** one row of `references/verification.md` now warns that linear code on millions of items can fit a slope of 1.4–1.6, from §7.3. The reviewer ran with the earlier text.
- **Changed after the review of 2026-11-26:** six reference files were corrected to match what their sources say (virtual-thread pinning by JDK version, the skip-scan condition, Dijkstra's stated bounds, `ArrayList` costs, the Django Tasks exception, the latency table's origin). No run has used the corrected text.
- **Not settled:**
  - whether the index alone (class ids and signals, without reference files) keeps the labels stable at lower cost;
  - whether reference files help on facts newer than the model: no sample tested that;
  - behaviour on real, larger code flows: every sample here is small and has a stated workload;
  - how the second version of the lint rules behaves on known-good code it was not tuned on (§7.2);
  - why `skills:` is not preloaded for an agent run as the session: the docs do not state it (§3.1);
  - why USD rose by 77 % when input rose by 27 % (the token types and prices were not split).

## References

- Local experiments: the loading probes of §3, a throwaway plugin and a project-level agent, run with Claude Code 2.1.332 and Haiku, 2026-11-25. Sessions 38ea613a, 17de3294, a7fd634a and d5946330 (§3); ab8874d3, 96116e54, 89b962e6, 1baa10c7, 766bcb4f and 3d6fcd06 (§3.1). Sizes from `measure.py` over their transcripts; the tool definitions and the skill listing read from the recorded requests. Backs: §3. [^lab-probe]
- Local calibration: `archkit-build` plugin, `calibration/perf-reviewer/` (samples, `expected.json`, `run.mjs`, `score.mjs`, `lint-samples.mjs`, `bench/`) and `tests/`. Run with Claude Code 2.1.332 and Sonnet, Node.js 24.22.1, ESLint 10.15.0, on an Apple M2, 2026-11-25; the G14 trap of §6.3 ran on 2026-11-26 (`results/2026-11-26-skip-scan/`). Backs: §3.2, §6, §7. [^lab-cal]
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
