# Run report: SE-04, mechanics of epoll EPOLLET

The orchestrator's step 10 report, saved by its caller (Claude Code refused the orchestrator's own write of this file: "Subagents should return findings as text, not write report files"). The caller's checks follow at the end.

## Orchestrator's report (2026-11-22)

1. **Verdict per round:** round 1 FAIL, 3.50 (citation integrity 5, rank compliance 4, factual grounding 1, Diátaxis rigor 4), 7 `CRITICAL_FAIL`, 5 of them one cause: probe claims named "Linux 7.2.12" while `harness.json` recorded no kernel. Round 2 PASS, 4.75 (5, 5, 5, 4): 73 `entails`, 7 `observed`, nothing failing. Checkable: 79 of 79, then 80 of 80.
2. **Status:** set to `verified`, `last-verified: 2026-11-22`. As verified, the validator fails KD-2 (a verified doc may not hold `⚠️ unverified`), which KB-17 requires on the 2 open conflicts in §6.7.
3. **Tokens:** workers taxonomy 88,600, ground-truth 113,018, practitioner 98,728, pitfall 125,852; judges round 1 240,894, round 2 233,979; 901,071 for the agents it started.
4. **Tier B sources and the judge's ranks:** Rank 1: epoll_wait(2) on git.kernel.org (man-pages-6.19), POSIX.1-2024 definitions, the nginx development guide (for claims about nginx). Rank 4: LWN article 864947 (its reader comments Rank 6). Rank 6: both idea.popcount.org posts. The 2003 lore.kernel.org thread: written Rank 6; the judge rated Davide Libenzi's own messages Rank 1 (he created epoll), the rest Rank 6; cited only in §6.
5. **Proposed rules, none added:** `git.kernel.org/pub/scm/docs/man-pages/man-pages.git/` Rank 1; `pubs.opengroup.org/onlinepubs/` Rank 1; `nginx.org/en/docs/` Rank 1; perhaps `lwn.net/Articles/` Rank 4 (it would rank reader comments 4 too). None for lore.kernel.org (many posters).
6. **Terms:** kept `non-blocking` (the knowledge base's spelling); dropped `epoll set` (the knowledge base says `interest list`), synonyms of `open file description`, `blocking`, `EINVAL`, `EPOLLWAKEUP`, and kernel helper names.
7. **Open conflicts (§6.7, ⚠️):** an edge-triggered listening socket and a connection that arrives while others are queued (a blog says no report; probe-06 on Linux 7.2.12 saw one); `EPOLLWAKEUP` with `EPOLLET` while an event is pending.
8. **Quote check:** round 1, 15 of 15 found; round 2, none to check.
9. **Not covered:** the 2020 `ep_poll` lost-wakeup race (no saved page); whether Torvalds's follow-up pipe patch was merged; multithreaded `epoll_wait` in production loops, Redis, Tokio; the flags nginx and mio register; `EWOULDBLOCK`'s definition; kernel code read at v6.12 only.

Framework problems it found: KB-15's footnote pattern did not match `[^probe-01]` (worked around with a `[^harness]` footnote); KD-2 against KB-17; the harness recorded no kernel; one round-2 finding (uneven columns in the §5.3 table) left unpatched after PASS.

## Caller's checks (2026-11-22)

- Both verdict files match the report; `final` (by `evaluate-research.mjs verdict`) is FAIL then PASS, 100% checkable.
- `evaluate-research.mjs ledger` on the 4 ledgers: 193 facts, all at their place, 0 errors, 3 warnings (tier B Rank 1 without `provenance_ref`).
- Transcripts: the orchestrator and its 4 workers opened neither the design nor other `research/` folders, and wrote only inside this run; the 2 judges wrote only their verdicts and a helper script in the scratchpad.
- The orchestrator's own tokens, from its task notification: 261,674. The run's total: 1,162,745 (plus 83,446 for the two plan steps, the first set aside because it had read the golden criteria in the design).
- Fixed since: the validator accepts `[^probe-01]`; `harness.json` records the kernel; the orchestrator body puts its report in its reply and uses the judge-version id of `RUNS.md`.

## Comparison with the plain-prompt baseline (2026-11-22)

Both docs judged the same way: knowledge-judge v7 (`73b3759`), a 45-claim sample stratified by `##` heading with seed 20261122, SE-04's `criteria.json`, probes and their harness result. The agent's doc was copied to the neutral folder `research/_calibration/run-k7d2` with `status: draft` (as the baseline was), and its `stage1.json` without the `validator` key (the baseline's input had none).

| | Baseline (`run-h6t1`) | Agent (`run-k7d2`) |
|---|---|---|
| Verdict, overall | FAIL, 3.25 | FAIL, 4.75 |
| Rubric (citation, rank, grounding, Diátaxis) | 5, 2, 2, 4 | 5, 5, 5, 4 |
| Doc | 432 lines, 185 claims | 484 lines, 80 claims |
| Sample verdicts | 29 entails, 5 observed, 9 overstates, 2 unsupported | 41 entails, 4 observed |
| Grounding findings per 15 checkable claims | 3.67 | 0 |
| `CRITICAL_FAIL` | 7: the §5 criterion, 2 × KB-15 (Rank 6 in role 3), KB-17, 3 grounding | 1: the §5 criterion |
| Criterion "Section 5 must mandate the EAGAIN check" | not met | not met: the rule is in §3.8 only |
| Criterion "Section 6 must warn of socket starvation if draining is omitted" | met | met (the judge notes "starvation" names other cases; the drain row says data stays unreported) |
| Trap claim (skip the drain loop for speed) | — | not in roles 1–5, refuted in §6 |
| Tokens | writer 232k, 18 min | workers 426k + orchestrator 262k; with its 2 judge rounds 1,163k; about 69 min |

The comparison judge cost 203,783 tokens; its quote check had nothing to check (no finding). The agent's one failure is placement: it wrote the caller's EAGAIN rule in `## 3.` and not in `## 5.`, since its body listed the headings without what each holds. The body now says what each heading holds, `## 5.` including every rule a user must follow; that change was prompted by this golden criterion, so a re-run of SE-04 would partly measure a fix made from SE-04's own feedback, and Phase 4's other topics are the fairer test.
