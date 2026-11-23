# AI limitations met in building and testing the research agent

Notes from Phases 0–4 and the judge versions v6–v10 (2026-11-22 to 2026-11-23): limits of the models, of the platform they run on, and of the web they read, that rewording an instruction did not remove, or removed only in part. Each entry gives the evidence (runs, versions, dates), what was tried and how it came out, how the limit is handled now, and what stays open. The sibling file `agent-message-errors.md` holds the misreadings that a better wording did fix; an entry moves here when a wording fix was tried and the behaviour stayed.

**Add an entry** when a run shows a behaviour that a clearer instruction did not change: what the agent did, the runs that show it (with their judge or agent version), the fixes tried and their results, the current handling, and its cost.

## Summary

| # | Limit | Kind | Handled by | Open |
|---|---|---|---|---|
| L1 | A keyword search cannot reach an exception written in other words | model | a second run or V for borderline claims | yes, accepted at v10 |
| L2 | The same judge grades a borderline claim differently from run to run | model | comparing like for like; weighing grounding counts over criteria | yes, accepted |
| L3 | An agent fills a gap by searching the repo, test material included | model | naming forbidden paths, giving what it would look for, auditing every transcript | no while audited |
| L4 | A model writes a number before reading the tool that gives it | model | running the count first; amending before push | habit, not a rule |
| L5 | Hidden criteria fail a doc whose claims are all grounded | evaluation design | generic section rules; criteria as weaker evidence | yes, by design |
| L6 | Platform limits of Claude Code subagents and auto mode | platform | workarounds per case | no |
| L7 | What the web serves to an automated client | environment | `fetch-source.mjs` retries and marks; gaps reported | partly |
| L8 | What a probe can and cannot show | method | probes worded as observations; labs stay unchecked | yes |
| L9 | The cost of grounding every claim (about 3–5× the plain prompt) | cost | at most 80 claims per doc; sampled comparisons | V's call |

## Entries

### L1 A keyword search cannot reach an exception written in other words
- **Limit:** the judge looks for a claim's support with the claim's own words. When the passage that contradicts the claim uses other words, the search never lands on it, and the judge passes the claim.
- **Evidence:** `knowledge/js-runtime/private-fields.md` How it works 5 said a `#` field read throws on "an object whose class did not declare it" (V8's error message). MDN's own "Returning overriding object" example, further down the same page, stamps a `#` field onto a plain `{}` and reads 42. The claim's words ("doesn't have the element", "TypeError") lead to the rule passage (line 368), never to the example (lines 450–474), which says "stamp". Judge v6 `entails` (`run-e2s8`), v8 `contradicted` (`run-a3m6`), v9 `entails` (`run-e7k3`), v10 `entails` (`run-b3w7`).
- **Tried:** v10's two search rules (every cited page; every hit, not only the first). They made the judge name the pages it searched (MCP S4 in `run-g9t4`), but did not change item 5: the hits a search finds are still the rule passage.
- **Handling now:** stop at v10 (V, 2026-11-23). A claim that states a general rule ("always", "throws", "never") about a behaviour with known corner cases is borderline: a second judge run, or V, settles it. The private-fields defect itself was fixed in `knowledge/` (`1e0ba30`).
- **Open:** a judge that asks "what would make this false?" and searches for that, not for the claim. Untested; it would need a new calibration case with an exception in other words, and about 0.55M tokens.

### L2 The same judge grades a borderline claim differently from run to run
- **Limit:** with the same prompt and input, the verdict on a claim near the line between two verdicts changes between runs.
- **Evidence:** the private-fields `protected` claim: `entails` once, `overstates` twice (Phase 0, `research/_calibration/REPORT.md` §4 finding 3). MCP S4: `WARN` under v8, `CRITICAL_FAIL` under v9 and v10, the later reading matching the doc's own References (notes E30). SE-02's "Sections 2 and 3 must …": met for the baseline, not met for the agent, by two judges of the same version (before v9's rule; notes E8). Private-fields item 5 (L1).
- **Tried:** v9's rule for multi-section criteria removed the criteria case; nothing removes the rest.
- **Handling now:** a comparison judges both sides with one judge version, one run each, on a fixed sample (45 claims, seed 20261122); grounding findings per 15 claims count for more than a criterion's result. Calibration compares each test with the earlier versions' results, so a change can be told from variance.
- **Open:** repeated runs (2 or 3 per doc) with a majority verdict would measure the variance, at 2–3× the judge's cost. Not done.

### L3 An agent fills a gap by searching the repo, test material included
- **Limit:** when an agent needs a fact it was not given, it searches the files it can read, and finds what it should not see.
- **Evidence:** the first SE-02 and LS-03 baseline writers read the design doc (`RUNS.md`: contaminated baselines). The first 3.6 orchestrator plan grepped `research-agent.design.md` for "SE-04" while looking for a token estimate and read SE-04's pass criteria (notes E5).
- **Tried:** forbidding the paths by name (it worked in every later run); giving the agent the fact it was looking for (measured token costs in the orchestrator body); keeping criteria only in `research/_golden/`.
- **Handling now:** a transcript audit after every run (a script that lists each read outside the run and each write outside it), before any result is used. After the fix it found no forbidden read in any audited run: the plan steps and runs of SE-04, SE-02, LS-03 and SE-01, and the SE-01 baseline writer.
- **Open:** a tool-level block on paths for one subagent is unconfirmed in Claude Code (design §1.3 step 6), so the audit stays.

### L4 A model writes a number before reading the tool that gives it
- **Limit:** a count or result written from what it should be, not from the tool's output.
- **Evidence:** commit `6b8d55a` ("finds every quote", when 12 of 17 were found; corrected in `31ee7fc`); "15 commits", then "16", when `git log main..` counted 13 (2026-11-22); a draft commit message with "246 docs, 33 deep dives" when the validator printed 244 and 31 (amended before push, `1e0ba30`).
- **Tried:** notes E21; reading the output before writing.
- **Handling now:** run the count, then write; check a commit message against the command output before pushing (an amend is free until then).
- **Open:** a habit, not something a rule enforces.

### L5 Hidden criteria fail a doc whose claims are all grounded
- **Limit:** the agent never sees a golden topic's criteria (by design, so the comparison stays fair), so a doc can ground every claim and still fail a criterion about what a section holds.
- **Evidence:** on the baselines' method, the agent's docs had 0–0.33 grounding findings per 15 claims, yet SE-04 failed "Section 5 must mandate the EAGAIN check", SE-02 failed "Sections 2 and 3 must differentiate …" for §3, and SE-01 failed "Section 6 must isolate VACUUM FULL as a severe table-locking anti-pattern"; only LS-03 passed (design §6, Phase 4 table).
- **Tried:** generic body rules drawn from the failed criteria (what each heading holds, `ba709a1`; explicit refutation in `## 6.`, `c4efbad`; the harm of acting on a misconception, `9b4b3ad`). SE-01 showed the first held and the second half held; the third is untested.
- **Handling now:** each such rule is worded without a golden topic's content, and its result is read as weaker evidence than grounding.
- **Open:** a rule made from a test's own criterion partly teaches the test; only new topics measure it fairly.

### L6 Platform limits of Claude Code subagents and auto mode
- **Limit:** behaviours of the platform that no instruction changes.
- **Evidence (Claude Code 2.1.330, desktop app, 2026-11-22/23):**
  - a subagent's `Write` of a report file is refused: "Subagents should return findings as text, not write report files" (`claude-code-usage-reference.md` [^22]);
  - an agent linked into `~/.claude/agents/` mid-session is "not found" until the session announces it, about 7 minutes later ([^22]);
  - a subagent is not told its own token use; its caller reads `subagent_tokens` in the task notification;
  - the auto-mode classifier refused enabling GitHub auto-merge on a PR (2026-11-23); a plain `gh pr merge` after CI went through.
- **Handling now:** the report goes in the reply and the caller saves it; a just-linked agent is replaced by `general-purpose` with its body word for word, or the run waits; the caller adds up tokens; PRs are merged after CI with V's yes.
- **Open:** none to fix here; re-check on a new Claude Code version.

### L7 What the web serves to an automated client
- **Limit:** a page an agent saves can lack what a person sees, or not come at all.
- **Evidence:** LWN serves reader comments to automated clients only behind a "See the comments" button (2026-11-23), so a new save has no comments; `raw.githubusercontent.com` answered 429 to a worker (3.4); one essay's site refused the connection (LS-03 report); comments that a page loads by script (Disqus) never reach the saved text; PDFs are refused by design (v1).
- **Tried:** `fetch-source.mjs` retries a 429 or 503 after its Retry-After; marks server-rendered comments (wpDiscuz, WordPress) and records `comments_from_line`; refuses PDFs with a pointer to the HTML version.
- **Handling now:** what a run could not save goes into its report's "not covered" list; a doc cites only saved pages.
- **Open:** pages that need a browser to render.

### L8 What a probe can and cannot show
- **Limit:** a probe shows what one runtime version did on one machine, never what a spec guarantees; a claim that rests on a local lab the judge cannot read is not checkable.
- **Evidence:** SE-04's baseline had 10 of 45 sampled claims `not_checkable` (lab only) until its labs became probes (0 of 45, `run-h6t1`); LS-03's baseline 8 of 45, SE-01's 6 of 45 (local labs). A probe claim naming a kernel the evidence did not record cost 5 of 7 `CRITICAL_FAIL`s in SE-04 round 1, until `harness.json` recorded the kernel.
- **Handling now:** probe claims are worded as observations with the version `harness.json` records; a probe never backs a role-5 claim alone; browser labs are out of scope (v1).
- **Open:** browser probes.

### L9 The cost of grounding every claim
- **Limit:** a judge reads the cited passage of every claim, which costs about 2,600–3,050 tokens per claim.
- **Evidence:** the research agent cost 1.1–1.2M tokens per topic against the plain prompt's 211–363k, 3.3× (SE-01) to 5.2× (SE-02); judge rounds of 80 claims took 197–247k; calibrations 0.5–0.58M each (REPORT §3.9–§3.11, design §6).
- **Handling now:** a doc holds at most 80 ✅ claims, so one judge reads all of them; comparisons judge a fixed sample of 45; calibrations reuse the same inputs.
- **Open:** V accepted the cost with ADOPT (2026-11-23); a cheaper worker model is untested (design §1.4).
