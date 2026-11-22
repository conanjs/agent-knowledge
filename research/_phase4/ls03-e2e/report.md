# Run report: LS-03, storing and revoking JWTs in web applications

The orchestrator's step 10 report, saved by its caller (a subagent may not write report files). The caller's checks follow.

## Orchestrator's report (2026-11-22)

1. **Verdicts:** round 1 FAIL, 4.0 (citation 5, rank 4, grounding 3, Diátaxis 4); round 2 PASS, 4.75 (5, 5, 5, 4); 80 of 80 claims checkable in both. Round 2: 78 `entails`, 2 `observed`. Round 1's fixes: probe-02's text said both spare bits were flipped where its code flips one (`CRITICAL_FAIL`); the audience rule had dropped RFC 9700's "if that is not feasible"; the GitHub advisory re-rated from Rank 2 to 3; a `200 OK` status line in §4.2, marked as implied by the rule. Left: one `SOFT_WARN` (§4.5 and §4.6 restate vendor settings instead of showing a request and response); two optional patches not applied (a §6 decision table, a note on Okta's grace period), since they would pass 80 claims.
2. **Tokens of the agents it started:** taxonomy 97,538; ground-truth 117,809; practitioner 119,640; pitfall 91,934; judge round 1 217,177; judge round 2 230,474; 874,572 in all (about 2,700–2,900 tokens per judged claim).
3. **Tier B sources and the judge's ranks:** Rank 1 for claims about their own product: Duende BFF docs, Okta developer docs, dj-rest-auth docs. Rank 3: GitHub Advisory Database, OWASP JWT cheat sheet. Rank 4: the Auth0 blog (Tim McLean, 2015), the WorkOS blog. Rank 6: Pragmatic Web Security, cited in §6 only. Proposed rules, none added: `cheatsheetseries.owasp.org/cheatsheets/` 3, `github.com/advisories/` 3, `workos.com/blog/` 4, `auth0.com/blog/` 4; vendor docs hosts stay tier B, since their Rank 1 holds for their own product only.
4. **Terms in step 2:** dropped "denylist / blocklist" (no Rank 1 source has a standard term); RFC 7009 and 7662 terms went on as RFC names only; `__Host-` became `__Host-Http-` (recommended by RFC 10017, a SHOULD; defined only in draft-ietf-httpbis-layered-cookies-02); "by-value / by-reference" became RFC 6749's identifier against self-contained, plus RFC 9700's "structured access token"; "reuse detection" became "refresh token replay" (RFC 9700) and "refresh token reuse" (RFC 10017); "browser-only client" became "browser-based OAuth client". The plan's "IETF draft" for browser-based apps is published as RFC 10017.
5. **Conflicts:** none left open; the ledgers' 13 were settled in §6 by rank, by a Rank 1 fact (RFC 9700 updates RFC 6749; RFC 10017 further restricts RFC 9700), or as conditions under which both hold.
6. **Quote check:** round 1, one quote not found (C45 joined a code line and the probe output); round 2, none missing.
7. **Not covered:** RFC 8725's stricter `alg` and `aud` rules; RFC 7662 introspection; RFC 9449's proof and key rules; the cookie spec's own text on `__Host-` and `SameSite`; OAuth 2.1 and RFC 9068 validation; clock skew beyond RFC 7519's "MAY allow leeway"; denylist growth and cache consistency; the "stop using JWT for sessions" essay (the site refused the connection); any source for "access token in memory, refresh token in an `HttpOnly` cookie"; Curity's token handler.

## Caller's checks (2026-11-22)

- Both verdicts match the report; `final` is FAIL then PASS, 100% checkable; judge v8 (`d4787fb`).
- `evaluate-research.mjs ledger`: 4 ledgers, 198 facts, all at their place, 0 errors, 5 warnings (tier B without `provenance_ref`).
- The doc is unchanged since the round 2 input, apart from its `status` and `last-verified` lines.
- Transcripts: the orchestrator and its 4 workers opened neither the design nor other `research/` folders and wrote no file in the repo outside this run. The taxonomy worker also wrote a 31 KB helper script, `build-ledger.mjs`, in the session's scratchpad (notes E24). The 2 judges wrote their verdicts and helper scripts in the scratchpad.
- Tokens: the orchestrator's own 260,126; with its agents, 1,134,698; with the plan step (32,670), 1,167,368.

## Comparison with the plain-prompt baseline (2026-11-23)

Both docs judged by v8 (`d4787fb`) in neutral folders, built as for SE-02 (`stage1 --sample 45 --seed 20261122`, LS-03's `criteria.json`, no `validator` key; the agent's copy `status: draft`, with its probes and round 2's harness result).

| | Baseline (`run-t4h7`) | Agent (`run-w9c3`) |
|---|---|---|
| Verdict, overall | FAIL, 3.25 | **PASS, 4.75** |
| Rubric (citation, rank, grounding, Diátaxis) | 5, 1, 3, 4 | 5, 5, 5, 4 |
| Doc | 218 claims, 23 References URLs | 80 claims, 13 |
| Sample verdicts | 30 entails, 4 overstates, 3 unsupported, 8 not_checkable (local labs only) | 44 entails, 1 observed |
| Checkable | 37 of 45 (82%) | 45 of 45 |
| Grounding findings per 15 checkable claims | 2.84 | 0 |
| `CRITICAL_FAIL` | 9: 6 × KB-15 (a personal blog and a GitHub pull request, both Rank 6, in mechanism and rule sections), 1 × KB-17 (a Rank 1 spec allows retransmission after an outage; the doc says a down client misses the logout), 2 unsupported | 0 |
| Criteria | both met; the trap not stated in roles 1–5, refuted in roles 1 and 3 but not in role 6 (`SOFT_WARN`) | both met; the trap not stated in roles 1–5, refuted in role 6 only by implication (`SOFT_WARN`) |
| Tokens | writer 304k, 22 min | 1,167k (with its 2 judge rounds and plan) |

The comparison judges cost 265,606 (baseline) and 196,550 (agent) tokens; every quote either made was found on its page.
