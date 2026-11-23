# Run report: SE-02, head-of-line blocking in HTTP/2 and HTTP/3

The orchestrator's step 10 report, saved by its caller (a subagent may not write report files). The caller's checks follow.

## Orchestrator's report (2026-11-22)

1. **Verdicts:** round 1 FAIL, 4.25 (citation 5, rank 5, grounding 3, structure 4), 79 of 79 claims checkable. Its one failure: the Summary's "HTTP/3 runs over QUIC" cited only RFC 9000, which never mentions HTTP/3; patched to cite RFC 9114 too. §6.5 became "Partly resolved conflict"; a new §6.7 maps symptoms to causes (no new ✅). Round 2 PASS, 4.5 (5, 5, 4, 4), 80 of 80 checkable: 78 `entails`, 1 `observed`, 1 `overstates` (`WARN`): C20 in §3.2, "the other streams keep going" for the RFC's "can". **After the PASS** the orchestrator changed it to RFC 9000's "can continue making progress"; that change was not judged in its own loop. A structure note stays: §4.2 and §4.3 retell a figure and read code rather than run full examples.
2. **Probe:** probe-01 (Node.js 24.22.1, `node:http2`) passed in both rounds: `ids=1,3,5 sockets=1`.
3. **Tokens of the agents it started:** taxonomy 101,466; ground-truth 108,771; practitioner 96,694; pitfall 119,989; judge round 1 214,621; judge round 2 197,053; 838,594 in all.
4. **Tier B sources and the judge's ranks:** the H2O directives page Rank 1, for claims about H2O; `github.com/cloudflare/quiche/blob/0.22.0/…/encoder.rs` Rank 1, for quiche 0.22.0; a Fastly blog post Rank 4. Possible rules, none added: `h2o.examp1e.net/` → 1, `github.com/cloudflare/quiche/` → 1 (repo rule; its issues and pull requests stay 6), `www.fastly.com/blog/` → 4.
5. **Terms:** none dropped; `QUIC-RECOVERY` → "QUIC loss detection (RFC 9002)", `Offset` → "STREAM frame Offset field", `blocked stream` → "QPACK blocked stream" (RFC 9000 also says "blocked" for flow control).
6. **Conflicts:** two open (`⚖️`, §6.3): how common high loss is (Marx against Fastly, both Rank 4); whether and why HTTP/2 is slower than HTTP/1.1 (Marx against Cloudflare, both Rank 4). Partly resolved: QUIC's CPU cost (Zhang, Rank 2, over Marx, Rank 4; per-packet against per-record encryption untested). Settled by the detailed RFC text: the "streams are independent" overview sentences of RFC 9113 and 9114.
7. **Quote check:** every judge quote found, both rounds.
8. **Not covered:** RFC 7541 and 9002 text of their own; RFC 9218 prioritization; controlled HTTP/2 against HTTP/3 page loads across loss rates (the loss thresholds compare HTTP/2 with HTTP/1, from 2016 data); QPACK implementations allowing blocked streams above 0 (neqo 20, Google quiche 100 were found but not saved); real QUIC connection-level flow-control stalls; current browser UDP fallback (the UDP-blocking data is 2015–2016).

## Caller's checks (2026-11-22)

- Both verdicts match the report; `final` is FAIL then PASS, 100% checkable; judge v8 (`d4787fb`) in both rounds.
- `evaluate-research.mjs ledger`: 4 ledgers, 189 facts, all at their place, 0 errors, 2 warnings.
- Transcripts: the orchestrator and its 4 workers opened neither the design nor other `research/` folders and wrote only in this run (16 calls first flagged were the run's own folder written as a relative path); the 2 judges wrote only their verdicts and a helper script in the scratchpad.
- Tokens: the orchestrator's own 228,177 (its task notification); with its agents, 1,066,771; with the plan step (40,694), 1,107,465.
- The post-PASS edit breaks the body's rule that patches follow a FAIL only. It narrows a claim to its source's modal verb, and the comparison judge below judges the doc as it stands, that edit included.

## Comparison with the plain-prompt baseline (2026-11-22)

Both docs judged by v8 (`d4787fb`) in neutral folders, each built by `stage1 --sample 45 --seed 20261122` with SE-02's `criteria.json` and without the `validator` key; the agent's copy has `status: draft`, its probe and round 2's harness result. The baseline's only earlier verdict was v3's (`run-q6v2`), so it was judged again for a like-for-like comparison.

| | Baseline (`run-g5r8`) | Agent (`run-m2v6`) |
|---|---|---|
| Verdict, overall | FAIL, 4.25 | FAIL, 4.75 |
| Rubric (citation, rank, grounding, Diátaxis) | 5, 5, 3, 4 | 5, 5, 5, 4 |
| Doc | 146 claims, 15 References URLs | 80 claims, 12 |
| Sample verdicts | 39 entails, 4 overstates, 2 unsupported | 45 entails |
| Grounding findings per 15 claims | 2.0 | 0 |
| `CRITICAL_FAIL` | 0 (it fails on 6 grounding findings: 3 `WARN`, 3 `SOFT_WARN`) | 1: the criterion "Sections 2 and 3 must differentiate application-layer vs transport-layer HoL blocking", read as each section; `## 3.` explains only the transport side |
| Criteria met | 4 of 4 (role 2's table and role 3's step-by-step read together) | 5 of 6 |
| Trap claim ("HTTP/2 completely eliminated HoL blocking") | refuted in role 1–2 text, only implicitly in role 6 | refuted in §6.2 |
| Tokens | writer 211k, 15 min | 1,107k (with its 2 judge rounds and plan) |

The two judges read the same criterion differently: the baseline's judge took sections 2 and 3 together, the agent's took each one. The criterion outcome is therefore weaker evidence than the grounding counts, which the same rules decide on both sides. The comparison judges cost 205,654 (baseline) and 169,596 (agent) tokens; every quote either made was found on its page.
