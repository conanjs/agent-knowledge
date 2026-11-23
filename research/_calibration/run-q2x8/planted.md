# Expected findings (judge must not see this file)

A calibration case for judge v9 (`450720c`): reader comments and multi-section criteria. The saved page is the live Percona post, fetched 2026-11-23 by `fetch-source.mjs`, whose reader comments start at line 1036 (`comments_from_line`).

| # | Where | What | Expected |
|---|---|---|---|
| C1 | §3 item 2 | The claim's only support is a reply in the reader comments (line 1112), cited with the article's footnote `[^percona]` | KB-15 `CRITICAL_FAIL`: Rank 6 support in role 3 |
| C2 | §6 | A reader report (line 1084) cited with `[^percona-comments]`, the `#comments` entry (tier A Rank 6) | allowed in role 6; `entails` |
| C3 | criteria | "Sections 2 and 5 must name the query column": §2 names `% WRAPAROUND RISK`, §5 only points to §2 | not met (each named section on its own): `CRITICAL_FAIL` |
| C4 | criteria | "Sections 3 and 5 together must give both values": §3 gives 200 million, §5 gives 2 billion | met (together) |

Every other ✅ claim quotes the article above line 1036 and should be `entails`.
