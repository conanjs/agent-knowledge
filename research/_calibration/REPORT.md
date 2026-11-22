# Phase 0 report: judge calibration and plain-prompt baselines

Date: 2026-11-22. Design: `frameworks/knowledge/research-agent.design.md` §4.2 (verifier lifecycle) and §6 (Phase 0). Judge prompt: `frameworks/knowledge/agents/knowledge-judge/body.md`. Every judge and writer ran as a Claude Code subagent on Claude Opus 5.5 (`claude-opus-5-5`).

## 1. Judge prompt versions

| Version | `prompt_sha` (first 7 hex of SHA-256 of `body.md`) | Change |
|---|---|---|
| v1 | `cded4d1` | First draft: rank table, role map, grounding verdicts, scoring anchors |
| v2 | `9ae51f8` | Three reading rules added to step 5, after v1 missed K1: a plain statement of behaviour reads as a requirement, and a leading modal covers every clause; no `entails` with a caveat; versions stay apart |
| v3 | `f166f98` | V's severity split (2026-11-22): `CRITICAL_FAIL` only for `contradicted`, `unsupported`, a wrong number, version, date or name, and a modal raised to MUST level in the claim's own words; every other `overstates` is a new `WARN`, which lowers `factual_grounding` but does not fail the doc. `factual_grounding` 4 allows at most 3 `WARN`s, or 1 per 10 checked claims. A `claims.json` sample mode. **Neutral examples**: v1 and v2 used calibration answers as examples (finding 6) |

## 2. Calibration docs

| Run folder | Doc | Pages cached | Notes |
|---|---|---|---|
| `mcp-known-errors/`, `run-m7t2/` | `knowledge/ai-agents/model-context-protocol.md` with its "known errors" note removed (lines 18–24) | 30 of 30 | 197 claims, judged in 3 parts (part A: Summary and §1; part B: §2, §4, §5; part C: §3) |
| `private-fields-clean/`, `run-c3x8/` | `knowledge/js-runtime/private-fields.md`, unchanged (status `verified`) | 4 of 4 | 10 ✅ claims |
| `private-fields-planted/`, `run-k4q9/`, `run-p5w1/` | The same doc with 5 planted errors (`private-fields-planted/planted.md`) | 6 of 6 | The GitHub issue was saved through `gh api` |

The pages were saved with a throwaway Phase 0 script: `curl` for the download, then Python's `html.parser` for HTML to text, named by the first 12 hex characters of the SHA-256 of the URL without its `#fragment`. `fetch-source.mjs` (Phase 3) replaces it. Python's own HTTPS failed here (no CA bundle, and a proxy certificate on `v8.dev`), so `curl` with the system trust store did the download.

## 3. Results

### 3.1 MCP known errors (K1–K3, from a blind check of 15 statements on 2026-11-21)

**V's ruling, 2026-11-22: K3 is dropped.** It was an error in the blind check, not in the doc. The calibration set is K1 and K2, and K3 is removed from the MCP doc's known-errors note.

| Id | Error | v1 | v2 (part C only) |
|---|---|---|---|
| K1 | §3.5 step 9: the 403 `insufficient_scope` response is SHOULD in the spec; the doc's step starts "Server must …" | **Missed**: `entails`, with the note "the claim states no modal" | **Found**: `overstates`, "the step's leading 'must' covers it" |
| K2 | §3.5 Scope: "security best practices" lost "security" | **Found** (`overstates`) | **Found** |
| K3 | §1.6 step 5 and §3.4: legacy `list_changed` on the GET stream | `entails` in both places | `entails` (§3.4) |

**Why K3 was dropped.** The cited 2025-11-25 transports page says the server "MAY send JSON-RPC requests and notifications on the stream" that a client opens with HTTP GET, and `list_changed` is a notification. Every judge run read it the same way.

**v3 rerun on a sample** (`run-b9r4`): 15 claims picked by script (seed 20261122), with K1, K2 and both K3 rows forced in, judged with neutral examples in the prompt:

| Id | v3 verdict | v3 severity |
|---|---|---|
| K1 (sample S12) | `overstates`: "The leading 'must' covers every clause … the 403 insufficient_scope response … [is] SHOULD" | `CRITICAL_FAIL` |
| K2 (S11) | `overstates`: drops "security" (and the page's "When supported:" condition) | `WARN`, per V's split |
| K3, section 3.4 row (S10) | `entails` | — |
| K3, section 1.6 row (S4) | `unsupported`: the cited 2025-11-25 pages never name the method `notifications/tools/list_changed` | `CRITICAL_FAIL` |

S4 is a different finding from K3, which said the channel was wrong. I checked the saved pages: `list_changed` appears in none of the cited lifecycle and transports pages, only in the security best-practices page (line 455), which the doc lists under `[4a-sess]` but this claim does not cite. The claim is true but cited to the wrong page. Under the v3 rules, "true per a cached page it does not cite" is `unsupported`, so it fails the doc.

The sample also scored the doc: FAIL, 3.75 (citation 5, rank 5, grounding 2, structure 3).

### 3.2 Planted errors (P1–P5)

| Id | Planted error | v1, folder named "planted" | v1, neutral folder `run-k4q9` | v2, neutral folder `run-p5w1` | v3, `run-t8n3` (severity) |
|---|---|---|---|---|---|
| P1 | "could affect" → "will degrade" | found | found | found | found, `CRITICAL_FAIL` ("will") |
| P2 | V8 9.7 → 9.4 | found | found | found | found, `CRITICAL_FAIL` (`contradicted`) |
| P3 | Rank 6 GitHub issue cited in How it works | found (KB-15) | found | found | found, `CRITICAL_FAIL` (KB-15) |
| P4 | Orphan References entry | found (KB-16, warn) | found | found | found, `SOFT_WARN` (KB-16) |
| P5 | "`structuredClone()` does not copy them" → "copies them" | found | found | found | found, `CRITICAL_FAIL` (`contradicted`) |

5/5 in every run, so the folder name did not cause the result (§4, finding 1). Under v3 every planted error kept the severity it was planted for. v3's verdict: FAIL, 3.00.

### 3.3 The unchanged ("clean") doc

Both runs (v1 and v2) gave **FAIL, overall 4.25**. Under v3 (`run-h2w6`) the doc **passes, overall 4.50** (citation 5, rank 5, grounding 4, structure 4): both findings below are now `WARN`, as V ruled. The critical findings are below; I checked each against the saved page myself.

| Claim | Judge's finding | Page text (saved cache) | v1 | v2 |
|---|---|---|---|---|
| How it works 6: "V8 9.7 moved class-field initialization … onto its inline-cache fast path" | drops a condition | "when V8 considers the pattern of the initialization to be predictable enough", otherwise "it falls back to a runtime call" | `overstates` | `overstates` |
| How it works 1: bracket access and "soft private" for "`private` and `protected`" | wider scope | the handbook gives bracket access and "soft private" to `private` only (line 1295) | `entails` (a close call) | `overstates` |

Neither is a false alarm by the rules: each claim says more than its page. V ruled on 2026-11-22 that such findings are `WARN`, not `CRITICAL_FAIL`. The same two findings appeared in the neutral v1 rerun of the planted copy, so the "protected" call varies between runs.

### 3.4 Precision

- Every quote that backs a failing verdict was checked by script against the saved pages: **87 of 87 quote segments were found verbatim** (all 9 verdict files).
- I read 10 flagged claims against the pages myself: K1, K2, C24 (part A), C38, C41, C51, C60 (part B), C5, C35 (part C), and the two clean-doc findings. All 10 are real: the doc says more than the page.
- The judge also found **22 non-`entails` claims in the MCP doc under v1** (6 in part A, 11 in part B, 5 in part C), against 3 errors in the blind check's 15. v2 raised part C from 5 to 15, mostly SHOULD-level rules written as plain facts.

## 4. Findings for the design

1. **Run folders need neutral names.** One judge noted that the folder name "private-fields-clean" suggested the doc should pass. Inputs now go in `run-<id>/` folders (`RUNS.md` maps them).
2. **A long doc needs the judge split.** The MCP doc (197 claims, 30 pages) took 3 parallel parts of 154k–197k tokens and 8–12 minutes each. Cost was about 2,600 tokens per claim checked.
3. **Judge variance on borderline claims.** The "`protected`" claim got `entails` once and `overstates` twice. Borderline calls should be settled by repeated runs or by V, not by one run.
4. **Plain statements of rules.** Most MCP findings are spec rules (SHOULD, MAY) written as plain facts. v2's rule catches them. V ruled on 2026-11-22 that a plain statement of a SHOULD or MAY rule is a `WARN`, and only a modal raised to MUST level in the claim's own words is critical (v3).
5. **The fetch tool.** All three baseline writers said the web-fetch tool summarizes pages with a small model, and two read raw text with `curl` instead. This supports saving pages with `fetch-source.mjs`, but it is still **unconfirmed** by Claude Code's docs.
6. **Calibration answers leaked into the judge prompt as examples.** v1's definition of `overstates` used "security best practices" written as "best practices", which is K2 itself. v2's reading rule used "Insufficient scope gives `403`", which is K1. So v1 finding K2, and v2 finding K1, were partly the prompt telling the judge the answer. v3 replaced every example with one from a topic no test doc covers (DNS resolvers, a full disk, a nightly index), and still found K1 (`CRITICAL_FAIL`) and K2 (`WARN`). The design's calibration stage now forbids calibration errors as prompt examples (§4.2).

## 5. Plain-prompt baselines

### 5.1 The docs

| Topic | Doc | ✅ marks | URLs | Experiments | Writer tokens / time | Clean baseline? |
|---|---|---|---|---|---|---|
| SE-04 epoll `EPOLLET` | `research/_golden/SE-04/baseline/doc.md`, 433 lines | 185 | 18 (all cached) | 14 C tests in a local Linux container | 232k / 18 min | Yes |
| LS-03 JWT storage (rerun) | `research/_golden/LS-03/baseline/doc.md`, 596 lines | 218 | 23 (all cached) | A Node revocation lab; a cookie lab in headless Chrome 158 and the desktop app's browser | 304k / 22 min | Mostly: see below |
| SE-02 HTTP/2 vs HTTP/3 HOL (rerun) | `research/_golden/SE-02/baseline/doc.md`, 325 lines | 146 | 15 (all cached) | A Python model of one lost packet | 211k / 15 min | Yes |

**The first LS-03 and SE-02 docs were contaminated.** Their writer prompt said "Do not read anything under `research/` other than your own folder, or `frameworks/knowledge/research-agent.design.md`", which reads as allowing the design doc, and both writers opened it. They are kept in `contaminated-baselines/` and were not judged. The rerun prompt lists every forbidden path (the design doc, `frameworks/knowledge/agents/`, `frameworks/knowledge/tools/classify-source/`, and everything under `research/` outside the writer's own folder). A script checked each writer's transcript for any tool call touching those paths:
- **SE-02 rerun: clean.** It read the first 60 lines of `validate-knowledge.mjs` at 04:10:49, before the Phase 1 edit (04:19:23).
- **LS-03 rerun: one minor exposure, caused by me.** At 04:21:31 it read lines 95–135 of `validate-knowledge.mjs`, which by then held the new KB-15 table of section names and allowed ranks, plus a mention of `ranked-sources`. It never opened `source-ranks.json`, the design doc or the judge prompt, and its doc contains no rank wording. Phase 1 was built while the writers ran, in files they could read.

### 5.2 Verdicts (judge v3, 45 claims each)

Each sample is 45 ✅ claims, drawn at random per `##` heading in proportion to its claim count, with seed 20261122. "Checkable" leaves out claims that cite only local lab files, which the judge cannot read.

| Topic | Run | Verdict | Scores (citation, rank, grounding, structure) | Checkable | Grounding findings | Per 15 checkable | Of which `CRITICAL_FAIL` | Per 15 | KB-15 breaches | Judge tokens |
|---|---|---|---|---|---|---|---|---|---|---|
| SE-04 | `run-w3j7` | FAIL 2.75 | 5, 1, 2, 3 | 35 | 9 (3 critical, 4 `WARN`, 2 `SOFT_WARN`) | 3.9 | 3 | 1.3 | 5 | 242k |
| SE-02 | `run-q6v2` | FAIL 3.25 | 5, 1, 3, 4 | 45 | 6 (1 critical, 1 `WARN`, 4 `SOFT_WARN`) | 2.0 | 1 | 0.3 | 11 | 234k |
| LS-03 | `run-z5k8` | FAIL 3.25 | 5, 1, 3, 4 | 39 | 7 (2 critical, 2 `WARN`, 3 `SOFT_WARN`) | 2.7 | 2 | 0.8 | 6 | 249k |

The numbers in "Per 15" are the design's comparison metric (§5 of the design): the research agent must beat them. Example: SE-04 has 9 findings in 35 checkable claims, so 9 × 15 ÷ 35 = 3.9.

**What fails the baselines is rank, more than grounding.** Every baseline scores 1 on `rank_compliance`. The breaches come from sources the judge rated Rank 6 because no rule covers them (tier B):
- SE-04: three Linux kernel mailing-list posts, among them one by Linus Torvalds, and Marek Majkowski's blog;
- SE-02: Robin Marx's Web Performance Calendar article and Daniel Stenberg's book *HTTP/3 explained*;
- LS-03: a 2026 blog post on ECDSA JWT malleability and an OWASP pull request.

Whether a maintainer's mailing-list post or an implementer's self-published book is Rank 6 or Rank 4 is V's call. The judge's notes say re-rating them would remove most breaches, but every doc would still fail on grounding or conflicts.

**Other critical findings.** Each was quoted from the saved page:
- SE-04: 2 unarbitrated conflicts (KB-17), and 1 pass criterion. The drain-until-`EAGAIN` rule appears in the Summary, §6.3, §7.1, §10 and §12, but in no reference section.
- SE-02: 1 conflict. Its two Rank 6 sources disagree on why HTTP/2 can lose to HTTP/1.1 under loss.
- LS-03: the conflict trap is refuted, but in roles 1, 4 and 5, not in role 6 (a `SOFT_WARN`).

**Precision.** 38 of 38 quote segments behind failing verdicts in the v3 runs were found in the saved pages: 35 by script, and 3 by hand, because those quotes are kernel-source comments that wrap across lines with a leading `*`.

**Judge ranks against the rules.** For the 68 distinct URLs the v3 judges ranked, every URL that a `source-ranks.json` rule covers got the same rank from the judge (52 of 52). 16 had no rule.

## 6. Cost of Phase 0

| Runs | Tokens | Time |
|---|---|---|
| 3 first baseline writers (2 contaminated) | 825k | 59 min (in parallel) |
| 9 judge runs, v1 and v2 | 1,259k | 4.7–11.8 min each |
| 2 baseline rerun writers | 515k | 15 and 22 min (in parallel) |
| 6 judge runs, v3: 3 calibration docs and 3 baselines | 1,084k | 5–16 min each |
| Total | about 3.7M | — |

**A 45-claim sample cost about 240k tokens per doc, twice my estimate of 120k.** The estimate came from the MCP doc (about 2,600 tokens per claim). The baselines cite long pages (kernel source, full RFCs), and each judge also re-ranks every source and audits conflicts and structure across the whole doc.
