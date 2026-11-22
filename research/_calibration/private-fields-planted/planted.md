# Planted errors (judge must not see this file)

Copy of `knowledge/js-runtime/private-fields.md` (verified, 2026-11-14) with 5 planted errors:

| # | Kind | Where | Change | Expected finding |
|---|---|---|---|---|
| P1 | Hedge strengthened (overstates) | How it works, step 3 | "could affect performance" → "will degrade performance" | `overstates` on step 3 |
| P2 | Wrong number | How it works, step 6 | V8 9.7 → 9.4 | `contradicted` on step 6 |
| P3 | Rank 6 source in a core section | How it works, "Where each form fits" table | new citation [^5] = GitHub issue (Rank 6 by path) | KB-15 breach |
| P4 | Orphan source | References | new entry [^6] (TC39 proposal), never cited | KB-16 orphan |
| P5 | Claim contradicted by its Rank 3 source | How it works, step 4 | "`structuredClone()` does not copy them" → "copies them like public fields" | `contradicted` on step 4 |

P5 replaces the design's "hidden conflict" plant: a true KB-17 conflict needs worker ledgers, which arrive in Phase 2–3.
