# Agent message errors: what was misread, and the fix

Notes from building the research agent (Phases 0–4, 2026-11-22): each place where an instruction, a rule, a criterion or a report was read differently from what its writer meant, by an agent, a tool or a person. Each entry quotes the words as they stood, says how they were read, what the writer expected, and the fix. They are raw notes, kept for later design work: the ones that were tested as wordings belong in `knowledge/ai-agents/instruction-wording-findings.md` (IW rows), which this file feeds (tracker T-3).

**Add an entry** when a run shows a misreading: the exact words (from the file, prompt or report, with its version or commit), the reading, the expected reading, the fix with its commit, or `open`.

## Patterns

| Pattern | Entries | Lesson |
|---|---|---|
| An example in the reader's input is the answer to the test | E1, E6 | Take examples from topics no test covers; check every file an agent reads for test answers |
| An agent that can read the repo finds test material by search | E4, E5 | Forbid the folders by name *and* give the agent what it was going to look for; audit its reads after each run |
| A rule silent on a case is read as permission | E7, E11, E14, E22 | Name the case and what to do in it ("after a PASS, change nothing") |
| Two parts use different conventions for one thing | E10, E13, E15, E16, E17, E18 | When a tool, a rule or a prompt names a format, check every other part that reads or writes it |
| A criterion that names several sections can be read as each or as all | E8 | Write "each of sections 2 and 3" or "sections 2 and 3 together" |
| A message copied in place of the rule | E20 | State the rule; quote the message only as the message |
| An instruction that assumes a state no one checked | E19, E23 | Check the state (what is unpushed, what the reader can know) before acting on the instruction |
| A report written before its evidence was read | E21 | Read the tool output, then write the message |

## Entries

### E1 A judge prompt's example was the test item (judge v2)
- **Words:** v2 added "A modal verb at the start of a sentence or list item ("Server must …; …; …") covers every clause after it." The calibration item was the MCP doc's "Server must validate the token …; insufficient scope gives `403`".
- **Read as:** the judge flagged the item, but the example was the item itself, so the run measured recall of the example, not the rule.
- **Expected:** a rule the judge applies to sentences it has not seen.
- **Fix:** v3 took its examples from topics no test covers (DNS resolvers, a full disk), and the judge still flagged both known errors. Recorded as IW-16.

### E2 A leading modal not carried to later clauses (judge v1)
- **Words:** the doc's "Server must validate the token …; insufficient scope gives `403`"; the spec's "the server SHOULD respond with: … HTTP 403 Forbidden".
- **Read as:** the 403 clause has no modal of its own, so it passed.
- **Expected:** "must" at the start covers every clause, so the 403 clause reads as a MUST where the spec says SHOULD: an error.
- **Fix:** v2's reading rule (E1), kept from v3 on; v8 still finds it as `CRITICAL_FAIL` (`run-c5w9`).

### E3 A blind check reported an error that was its own (K3)
- **Words:** design §3.1: "A third, "the wrong delivery channel", was the blind check's own error; V ruled it out on 2026-11-22."
- **Read as:** a third known error in the MCP doc.
- **Expected:** a known error is one the page shows; this one the page did not.
- **Fix:** V ruled K3 out; the calibration keeps K1 and K2 only.

### E4 Baseline writers read the design doc (Phase 0)
- **Words:** `research/_calibration/RUNS.md`: "Contaminated baselines (writers read the design doc): the first LS-03 and SE-02 docs, moved to `contaminated-baselines/`."
- **Read as:** the design was background reading for the writer.
- **Expected:** a plain-prompt baseline sees only its prompt.
- **Fix:** both baselines were rerun; the first ones are kept apart as contaminated.

### E5 The orchestrator searched the design for a token estimate and found the criteria (3.6, first plan)
- **Words:** the orchestrator body (before `82d5442`): "the doc's `topic:` …, `MODE`, `CAP`, the seeds per profile, and a token estimate." It ran `grep -n "SE-04\|trap" research-agent.design.md`, which printed "SE-04: `## 5. Reference & invariants` requires the EAGAIN loop, and `## 6.` warns of starvation."
- **Read as:** look up how to estimate tokens wherever the repo says it.
- **Expected:** estimate from known costs, without opening test material.
- **Fix:** `82d5442`: the body forbids the design and other `research/` folders and gives the measured costs (a worker about 135k; a judge about 2,600 tokens per claim); the design no longer states any topic's criteria. The plan was set aside and rerun; a transcript audit after each run checks the reads.

### E6 The ledger schema's example was SE-04's answer (3.2)
- **Words:** `ledger.schema.md`'s first example: `"quote": "an event will be generated upon each receipt of a chunk of data"` (epoll(7), EPOLLET).
- **Read as:** (not yet read; caught before the worker ran) a worker reads the schema, so it would have met an SE-04 fact before searching.
- **Expected:** a format example that teaches nothing about any test topic.
- **Fix:** `e1b63c8`: the example is fsync(2), with a note to keep examples off golden-set topics.

### E7 Heading names without their jobs (SE-04, criterion for §5)
- **Words:** the orchestrator body (before `ba709a1`): "the body headings, exactly: `## 1. Mental model`, … `## 5. Reference & invariants`, …". The criterion: "Section 5 must mandate the EAGAIN check." The judge: "§5 states no caller rule for EPOLLET, and the epoll(7) "consider it ready until ... EAGAIN" rule appears only in §3.8."
- **Read as:** any section may hold a rule; the writer put the caller's rule where it explained the mechanism.
- **Expected:** `## 5.` holds exact values and every rule a user must follow.
- **Fix:** `ba709a1`: the body says what each heading holds. Caveat: the fix came from SE-04's own criterion, so only other topics test it.

### E8 "Sections 2 and 3 must differentiate …" read two ways (SE-02, v8)
- **Words:** SE-02's `criteria.json`: "Sections 2 and 3 must differentiate Application-layer vs Transport-layer HoL blocking". The agent's judge (`run-m2v6`): "I read "Sections 2 and 3" as each section, not the two taken together. If the caller means them together, the doc passes." The baseline's judge (`run-g5r8`): "Role 2 … gives HTTP-message ordering its own row … Role 3 … shows HTTP/2 frames already interleaved while TCP holds the 7 later packets" — met.
- **Read as:** one judge required each section to cover both layers; the other took the two sections together.
- **Expected:** V's reading: "Judge chấm Baseline hiểu gộp cả hai mục (Mục 2 nói tầng ứng dụng + Mục 3 nói tầng giao vận = Đạt), còn Judge chấm Agent lại hiểu khắt khe là từng mục riêng lẻ đều phải phân tích cả hai tầng, nên đánh trượt Mục 3 vì mục này chỉ tập trung giải thích tầng giao vận QUIC. Đây là dao động diễn giải tự nhiên của tiêu chí đề bài, không phải lỗi của hệ thống."
- **Fix (open):** write multi-section criteria as "each of …" or "… together"; or give the judge one rule for them (a judge prompt change, so after Phase 4, with recalibration). Until then, count a criterion result as weaker evidence than grounding findings.

### E9 A rigged probe seen but mislabelled (judge v6)
- **Words:** `REPORT.md` §3.7: "It said the rigged probe-03 "cannot fail: the empty catch swallows every error", but gave the claim `not_checkable`, not `invalid_probe`."
- **Read as:** a probe that cannot fail leaves the claim unchecked.
- **Expected:** a probe that cannot fail is `invalid_probe`, a `CRITICAL_FAIL`; a claim that needs its probe is `observed`, not `entails`.
- **Fix:** v7: "Check every cited probe first, by reading its code"; v8 still catches it (`run-d1q4`).

### E10 `expect=stdout:` meant "and exit 0" in the harness
- **Words:** the tag `expect=stdout:<text>`.
- **Read as (by the harness):** the output contains the text *and* the exit code is 0, so a type-check probe that prints `TS2341` and exits 2 failed.
- **Expected:** the output contains the text, whatever the exit code.
- **Fix:** Phase 2b: the harness checks only the output for `stdout:`; its usage says so.

### E11 "Only through the fetch tool" did not stop `curl` (worker, 3.4)
- **Words:** the worker body: "Pages reach `RUN/cache/` and `RUN/sources.json` only through the fetch tool". On HTTP 429 the worker ran `curl -s -o /dev/null -w '%{http_code} …'`.
- **Read as:** the rule covers saving pages, not checking a URL.
- **Expected:** the web only through `WebSearch` and the fetch tool.
- **Fix:** `e1b63c8`: "Reach the web only through `WebSearch` and the fetch tool, never `curl` or another client"; `fetch-source.mjs` retries a 429 or 503 itself.

### E12 Profile ranks that would drop an official page's pitfalls
- **Words:** design §1.4: `pitfall` allows ranks "2, 4, 6".
- **Read as (risk):** a pitfall that only a Rank 1 page states (epoll(7)'s starvation warning) has no worker to collect it.
- **Expected:** official warnings reach the doc.
- **Fix:** the worker body's `ground-truth` row adds "the pitfalls the official pages warn about". Not tested apart.

### E13 Two ids for one judge version
- **Words:** the orchestrator body (before `edc0140`): "`PROMPT_SHA` = the output of `git -C REPO log -1 --format=%h -- …/knowledge-judge/body.md`"; `REPORT.md` §1: "`prompt_sha` (first 7 hex of SHA-256 of `body.md`)".
- **Read as:** v7 recorded as `fb60524` (a commit) in the run, `73b3759` (a content hash) in the calibration; I first looked `73b3759` up as a commit.
- **Expected:** one id per judge version.
- **Fix:** `edc0140`: the body uses the SHA-256 prefix, as `RUNS.md` does.

### E14 "Report in `RUN/report.md`" from a subagent
- **Words:** the orchestrator body (before `edc0140`): "10. **Report** to V in `RUN/report.md`, and the same in your reply". Claude Code answered its write: "Subagents should return findings as text, not write report files. Include this content in your final response instead."
- **Read as (by the platform):** a subagent may not write a report file.
- **Expected:** a report V can open later.
- **Fix:** `edc0140`: the report goes in the reply and the caller saves it; recorded in `claude-code-usage-reference.md` [^22].

### E15 One marker, two rules (KD-2 against KB-17)
- **Words:** KD-2: "`status: verified` ⇒ zero `⚠️ unverified` markers"; KB-17 (before `f1b8a9e`): "both claims go under the pitfalls section as an open conflict marked `⚠️ unverified`".
- **Read as:** a verified doc with an open conflict fails the validator.
- **Expected:** an open conflict is honest and can sit in a verified doc.
- **Fix:** `f1b8a9e` (V's decision): `⚖️ open conflict`, which KD-2 does not count; the validator fails a `⚖️` outside the pitfalls section.

### E16 Probe footnotes the validator could not read
- **Words:** design §3.6: "cited with a normal footnote `[^probe-01]`"; the harness requires `id=probe-<nn>`; the validator matched `\[\^\w+\]`.
- **Read as (by the validator):** `✅[^probe-01]` has no footnote.
- **Expected:** a hyphen is part of a label.
- **Fix:** `edc0140`: labels may hold hyphens (KB-12, KB-15, KB-16). The SE-04 run had worked around it with a `[^harness]` footnote.

### E17 A kernel named in the doc, absent from the evidence
- **Words:** SE-04 round 1: probe claims "on Linux 7.2.12"; `harness.json` had no kernel field.
- **Read as (by the judge):** "a number, version, date or name the page lacks": 5 of 7 `CRITICAL_FAIL`s.
- **Expected:** the version a probe ran on is in its evidence.
- **Fix:** `edc0140`: `harness.json` records the containers' kernel; the body says to name the version `harness.json` records.

### E18 The judge's notes taken as quotes
- **Words:** the judge's `page_says`: "structuredClone() does not clone private elements [probe-02 stdout: false]"; "(Searched 'ExperimentalWarning', '24.22', 'warning' with transform-types: not found)"; a probe's code in backticks.
- **Read as (by `evaluate-research.mjs quotes`):** 5 quotes missing.
- **Expected:** bracketed notes and search terms are the judge's words; a quote of probe code is checked against the probe file.
- **Fix:** `ce9e9dd`: 343 of 343 found over every verdict.

### E19 An orchestrator that cannot know the comparison rule proposed seeds
- **Words:** SE-02's plan: "Seeds: none supplied by V. Proposed, for V to accept or strike when approving: …" (4 RFCs). Design §1.5: in a golden-set comparison "the list stays empty, or the same list goes to the plain-prompt baseline".
- **Read as:** seeds help, so propose them.
- **Expected:** no seeds in a comparison run. The orchestrator may not read the design (E5), so it could not know.
- **Fix:** V struck them (`9723ab8`). Open: an input such as `COMPARISON: golden` that the body maps to "no seeds", so the caller need not catch it.

### E20 An error message copied as the rule (a verified doc)
- **Words:** `knowledge/js-runtime/private-fields.md`: "Reading a `#` field from an object whose class did not declare it throws a `TypeError`." MDN: "If you access a private element from an object that doesn't have the element, a TypeError is thrown"; V8's message: "Cannot read private member #x from an object whose class did not declare it"; MDN also stamps a field onto a plain `{}` and reads 42.
- **Read as (by the writer):** V8's message states the rule.
- **Expected:** the rule is about the object having the field, not its class.
- **Fix (open):** tracker T-2, after Phase 4. v6 passed it; v8 found it (`run-a3m6`).

### E21 Reports written before the evidence was read (mine)
- **Words:** commit `6b8d55a`: "evaluate-research.mjs quotes finds every quote", when the tool had found 12 of 17. In chat: the branch "15 commit", then "16 commit"; `git log main..research-agent-phase-0-1` counts 13.
- **Read as:** a claim from memory of what should be true.
- **Expected:** the number the tool prints.
- **Fix:** `31ee7fc` corrected the commit message; the count was corrected in chat on 2026-11-22. Lesson: run the count, then write it.

### E22 "Patch when FAIL" did not say "not after PASS" (SE-02)
- **Words:** the orchestrator body (before `10d49af`): "8. **Patch** when the final verdict is FAIL …". Its report: "After the pass I changed it to RFC 9000's "can continue making progress". That one-word change was not re-judged".
- **Read as:** small fixes after a PASS are allowed.
- **Expected:** after a PASS the claims stay as judged.
- **Fix:** `10d49af`: "After a PASS, change nothing in the doc's claims … Put a remaining `WARN` in the report instead."

### E23 "Push the two clean commits" when 13 were unpushed
- **Words:** the relayed decision: "Bạn có thể `git push` hai commit sạch (`f1b8a9e` và `ce9e9dd`) lên remote ngay bây giờ."
- **Read as:** two commits sit on top of what the remote has.
- **Expected:** the remote had only `main` at `d324cb4`; those two stand on 9 more commits of the same branch, which a push must carry too.
- **Fix:** asked first; V approved pushing the branch as its own remote branch, and it was pushed at `10d49af`.
