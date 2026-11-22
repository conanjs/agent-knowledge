# Offline audit of 10 verified docs (judge v4, 2026-11-22)

Report-only (design §4.2 stage 3): no doc was changed. Judge prompt v4 (`d8dcf5d`), run as a Claude Code subagent on Claude Opus 5.5, on inputs built by `evaluate-research.mjs stage1` (`RUNS.md` maps run ids to docs). Every ✅ claim was judged; no doc was sampled.

## Results

| Run | Doc | Verdict | Scores (citation, rank, grounding, structure) | Claims | `entails` | Findings | Not checkable | `CRITICAL_FAIL` by rule |
|---|---|---|---|---|---|---|---|---|
| run-qhk4 | `software-design/oop/polymorphism.md` | FAIL 3.25 | 5, 3, 2, 3 | 15 | 9 | 6 | 0 | grounding 3, KB-15 1 |
| run-qibk | `software-design/design-principles/interface-segregation.md` | FAIL 3.00 | 5, 1, 3, 3 | 10 | 6 | 4 | 0 | KB-15 4, grounding 1 |
| run-g9er | `javascript/object-properties/property-descriptors-and-accessors.md` | PASS 4.25 | 5, 4, 4, 4 | 19 | 8 | 1 | 10 | — |
| run-4mlm | `linux/networking/netfilter-and-nat.md` | FAIL 3.50 | 5, 3, 2, 4 | 21 | 8 | 7 | 6 | grounding 3, KB-17 1 |
| run-roge | `algorithms/data-structures/hash-tables.md` | FAIL 4.00 | 5, 5, 2, 4 | 12 | 5 | 4 | 3 | grounding 3 |
| run-p53j | `algorithms/string-search-and-indexing.md` | PASS 4.50 | 5, 5, 4, 4 | 4 | 0 | 1 | 3 | — |
| run-nafg | `linux/networking/packet-path.md` | FAIL 3.75 | 5, 5, 2, 3 | 29 | 9 | 15 | 5 | grounding 5 |
| run-t3ao | `ai-agents/measure-agent-tokens.md` | PASS 4.25 | 5, 4, 4, 4 | 20 | 4 | 3 | 13 | — |
| run-rrnd | `javascript/data-types/maps-sets-and-weak-collections.md` | PASS 4.75 | 5, 5, 5, 4 | 17 | 12 | 0 | 5 | — |
| run-3nse | `linux/system-management/performance-triage.md` | FAIL 3.00 | 5, 1, 2, 4 | 9 | 3 | 5 | 1 | KB-15 4, grounding 5 |
| **Total** | 10 docs | 6 FAIL, 4 PASS | | 156 | 64 (41%) | 46 (29%): 21 `overstates`, 22 `unsupported`, 3 `contradicted` | 46 (29%): 44 local-only, 2 no saved page | |

"Findings" are verdicts other than `entails` on checkable claims. "Not checkable" claims cite only a local lab file the judge cannot read, or a page that could not be saved.

**Precision.** `evaluate-research.mjs quotes` found every quote behind a finding on the pages its claim cites: 58 of 58 segments.

## Patterns

1. **The tie-break beats the originator rule.** The rank classes list "the originator's own publication of a concept" as Rank 1, but the rule "when two ranks fit, take the higher number" made the judge pick Rank 6 for three originators:
   - Robert C. Martin's blog on the interface segregation principle (run-qibk);
   - Philip Wadler's mailing-list post naming the expression problem (run-qhk4);
   - Brendan Gregg's page on his USE method (run-3nse).

   They cause 9 of the 10 KB-15 failures. The three docs still fail on grounding without them. A project's own repository on GitHub with no rule yet (the Rust book) got Rank 3 the same way. This needs V's ruling.
2. **A PASS can rest on few checked claims.** All 4 passing docs cite local labs for many claims: run-p53j passed with 1 of 4 claims checked, run-t3ao with 7 of 20, run-g9er with 9 of 19. A pass threshold on the checked share, or Stage 1.5 probes for the labs (design §3.6), would close this.
3. **Errors in verified docs.**
   - run-rrnd: the judge noted, outside its verdict and from its own knowledge, that ECMAScript 2023 allows non-registered symbols as `WeakMap` keys. Checked on Node 24.22.1 on 2026-11-22: `new WeakMap().set(Symbol('x'), 1)` works; a `Symbol.for()` key and a string key throw `TypeError`; a `WeakSet` takes a non-registered symbol too. The doc's "`WeakMap` keys must be objects" (line 41) and "Primitive key in `WeakMap` → `TypeError`" (line 61) are incomplete.
   - run-4mlm: "DNAT must be in prerouting" goes against the iptables-extensions page, which says DNAT is valid in the PREROUTING and OUTPUT chains (KB-17, `CRITICAL_FAIL`).
   - run-nafg: `napi_complete_done()` is said to re-enable interrupts; the kernel's NAPI page says it releases the NAPI instance, and the driver unmasks the IRQ afterwards.
4. **Page saving needs work** (for `fetch-source.mjs`, Phase 3).
   - A PDF was saved as unreadable text (run-p53j, Aho–Corasick).
   - GitHub file pages were saved as GitHub's cut-off HTML view: CPython's `dictobject.c` in run-roge, and a source file cut at line 1000 in run-4mlm. So one `unsupported` finding in run-roge may be a false alarm. Fetch `raw.githubusercontent.com` instead.
   - One SIAM page could not be fetched.

## After V's rulings (2026-11-22)

**Final verdicts with the 70% rule** (`evaluate-research.mjs verdict`): 6 FAIL, 3 `INCONCLUSIVE` (run-g9er 9 of 19 claims checkable, run-t3ao 7 of 20, run-p53j 1 of 4), 1 PASS (run-rrnd, 12 of 17 = 71%).

**The three docs with originator breaches, re-judged with v5** (`2b066f6`, tier B rules in order, evidence only from the input), as `verdicts/round-2.json`:

| Run | v4 | v5 | What the new rules did |
|---|---|---|---|
| run-qhk4 | FAIL 3.25, KB-15 1 | FAIL 3.00, KB-15 1 | Wadler's note: Rank 1 by rule 1, because the saved note itself shows he named the expression problem. The Rust book: Rank 1 by rule 2, the project's own repository. But `refactoring.com` went from Rank 3 (v4) to Rank 6 (v5) by the class rule, so one breach remains, on another source |
| run-qibk | FAIL 3.00, KB-15 4 | FAIL 3.00, KB-15 4 | No saved page shows Robert C. Martin or Martin Fowler originated the terms (Fowler's page says Martin "talks about this topic as the Interface Segregation Principle"), so rule 1 could not apply |
| run-3nse | FAIL 3.00, KB-15 4 | FAIL 3.00, KB-15 4 | No saved page shows Brendan Gregg created the USE method |

The rule works when the input holds the evidence and stays out when it does not, as decided. So a research run (Phase 3) must save a page that shows who originated a concept, for example the originator's first publication, or the rule cannot fire. The `refactoring.com` swing (Rank 3, then 6) is judge variance on a class call.

## Cost

| Runs | Tokens |
|---|---|
| 10 audit judges | 1,177k (100k–147k per doc) |
| Recalibration of v4 (3 judges, `../_calibration/REPORT.md` §3.5) | 373k |
| Recalibration of v5 (3 judges, `../_calibration/REPORT.md` §3.6) | 367k |
| v5 re-judging of 3 audit docs | 369k |
