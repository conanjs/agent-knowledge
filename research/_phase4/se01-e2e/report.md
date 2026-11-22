# Run report: SE-01, PostgreSQL MVCC and transaction ID wraparound

The orchestrator's step 10 report, saved by its caller (a subagent may not write report files). The caller's checks follow.

## Orchestrator's report (2026-11-23)

1. **Verdicts:** round 1 FAIL, 4.00 (citation 5, rank 4, grounding 3, Diátaxis 4); round 2 PASS, 4.75 (5, 5, 5, 4); 80 of 80 claims checkable in both. Round 1's `CRITICAL_FAIL`: §3.1 said VACUUM uses a non-vacuumable snapshot, which `snapshot.h` never says; it and 7 smaller points were patched once. Left from round 2: §4.5 and §4.4's pganalyze queries have no sample output; §3.5 item 3 is an unmarked pointer line; §6.1 has no decision table.
2. **Status:** `draft`, not `verified`: §6.2 keeps two `⚠️ unverified` points (Sentry's 1GB `maintenance_work_mem` limit and Metronome's MultiXact member limit, both for PostgreSQL 19), which KD-2 forbids in a verified doc. A Summary note says so. V's call: drop them and set `verified`, or keep the draft.
3. **Probes:** both pass (C, `linlab:1`, kernel 7.2.12-orbstack): 4.66% of the XID space left at the manual's sample warning; the hard stop at an XID age of 2,144,483,647.
4. **Tokens of the agents it started:** taxonomy 92,451; ground-truth 97,191; practitioner 97,539; pitfall 120,976; judge round 1 243,855; judge round 2 246,772; 898,784 in all (about 3,050 tokens per judged claim).
5. **Tier B sources and the judge's ranks:** Rank 4: the Sentry, Crunchy Data, Metronome and Percona blogs (a reader comment on the Percona page Rank 6); pganalyze docs Rank 1 for claims about its own check, Rank 4 for claims about PostgreSQL. Proposed rules, none added: `blog.sentry.io/`, `www.crunchydata.com/blog/`, `metronome.com/blog/`, `www.percona.com/blog/` (its pages carry reader comments) and `pganalyze.com/docs/`, all Rank 4.
6. **Terms:** none dropped or renamed; the manual's one-off "relminxid" (a typo in its recovery step 4) and `datminmxid` (no source names it) were left out.
7. **Conflicts:** none left open. The XID restart point ("zero" against "3" in the manual's own pages) settled by `varsup.c` for 3; AWS's "read-only at 2 billion" by the stop in `varsup.c`; "shuts down", "1M / 10M" and "use single-user mode" (Percona, Sentry) by the PostgreSQL 19 manual and source, each refuted in §6.3; member-space visibility by the 19 manual's `pg_get_multixact_stats()`; the visibility rule, both Rank 1, follows `snapshot.h` (a judgement call); the TOAST question kept in §6.4 with neither side stated as a rule.
8. **Quote check:** round 1, 8 found, 0 missing; round 2, nothing to check.
9. **Not covered:** `ALTER TABLE` syntax for per-table settings and `idle_in_transaction_session_timeout` as prevention (only on pages dropped for the cap); the release that introduced each freezing setting; the lower bound of `autovacuum_freeze_max_age`; `xid8` and FullTransactionId; `HeapTupleSatisfiesMVCC`; whether VACUUM processes a TOAST table alone; whether Sentry's and Metronome's limits hold in PostgreSQL 19.

## Caller's checks (2026-11-23)

- Both verdicts match the report; `final` is FAIL then PASS, 100% checkable; judge v8 (`d4787fb`). One patch round.
- `evaluate-research.mjs ledger`: 4 ledgers, 185 facts, all at their place, 0 errors, 5 warnings.
- Since the round 2 input, only the Summary's status note was added; no claim changed.
- Transcripts: the orchestrator and its 4 workers opened neither the design nor `research/` outside this run and wrote nothing in the repo outside it.
- Tokens: the orchestrator's own 273,242; with its agents, 1,172,026; with the plan step (31,221), 1,203,247.
- The baseline (`research/_golden/SE-01/baseline/`, written by the Phase 0 rerun prompt, word for word): 582 lines, 319 ✅ markers (323 claims by the sampler), 8 ⚠️, 32 URLs, 9 lab experiments on PostgreSQL 18.3; 362,592 tokens, 31 minutes. Its writer opened none of the forbidden paths. Its 32 pages were saved afterwards with `fetch-source.mjs`, as the Phase 0 baselines' pages were.

## Comparison with the plain-prompt baseline (2026-11-23)

Both docs judged by v8 (`d4787fb`) in neutral folders, built as for SE-02 and LS-03 (`stage1 --sample 45 --seed 20261122`, SE-01's `criteria.json`, no `validator` key; the agent's copy with its probes and round 2's harness result; both copies `status: draft`).

| | Baseline (`run-p8x3`) | Agent (`run-r6k1`) |
|---|---|---|
| Verdict, overall | FAIL, 3.50 | FAIL, 4.25 |
| Rubric (citation, rank, grounding, Diátaxis) | 5, 3, 2, 4 | 5, 4, 4, 4 |
| Doc | 323 claims by the sampler, 32 References URLs | 80 claims, 13 |
| Sample verdicts | 31 entails, 3 overstates, 3 unsupported, 8 not_checkable (6 local-lab only, 2 lines that are not claims: the Summary's **Depth:** line and a marker count in "## 11. Verification notes") | 43 entails, 1 observed, 1 overstates |
| Checkable | 37 of 45 (82%) | 45 of 45 |
| Grounding findings per 15 checkable claims | 2.43 | 0.33 |
| `CRITICAL_FAIL` | 6: 3 unsupported, 1 × KB-17 (two same-rank pages disagree on who sets visibility-map bits, left unarbitrated), 2 criteria | 1: the §6 criterion |
| "Sections 3 and 5 must mandate standard VACUUM" | §3 met, §5 not met | §3 met (a judgement call: it never says "standard" against FULL), §5 met |
| "Section 6 must isolate VACUUM FULL as a severe table-locking anti-pattern" | not met | not met: misconception 8 in §6.3 rejects VACUUM FULL (rewrite, time, disk, failure in the stopped state) but never names its `ACCESS EXCLUSIVE` lock, which its cited manual page states |
| Trap ("schedule VACUUM FULL via cron") | not stated in roles 1–5; not refuted in role 6 | not stated in roles 1–5; refuted in role 6 only in part (routine use against wraparound not addressed) |
| Tokens | writer 363k, 31 min | 1,203k (with its 2 judge rounds and plan) |

The comparison judges cost 230,494 (baseline) and 220,558 (agent) tokens; every quote either made was found. SE-01 in all: 2.02M, under the 2.1M V set.

What SE-01 was run to check: the `## 5.` fix held (the rule is in §5, the baseline's is not); the explicit-refutation fix half held (an explicit entry exists, but without the lock, the harm the criterion names).
