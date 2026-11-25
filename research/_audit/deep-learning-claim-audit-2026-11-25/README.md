# Claim-by-claim audit of the deep-learning docs (2026-11-25)

Every `✅[^label]` claim in the 19 deep-learning docs was checked by an agent that did not write the doc, against the passage, table or figure of its cited source, or against the doc's printed lab output. This folder keeps the proof: one ledger per doc, with one row per claim in the order the claims appear.

The 19 docs are the 16 in `knowledge/machine-learning/deep-learning/`, plus three in `knowledge/machine-learning/transformers/`: `vision-transformers.md`, `mixture-of-experts.md` and `efficient-attention-and-state-space-models.md`.

## Why it was run
- The docs were written by agents that marked their own claims ✅.
- Three review rounds, merged in PRs #14 and #15, spot-checked about 60 % of the 1,008 source-cited claims. The other 40 % had been checked only by the agent that wrote them.
- This audit covers all of them. It found something to fix in 121 claims (about 10 %): most were missing a condition, used a stronger verb than the source (for example "must" where the source says "should"), or cited the wrong footnote; a few were wrong.

## Result
| Verdict | Claims | Meaning |
|---|---|---|
| OK | 898 | Supported by the cited source as written |
| FIXED | 121 | Reworded, narrowed, corrected or re-cited, and now supported |
| LAB-OK | 200 | Matches the doc's printed lab output; scripts re-run where a number was in doubt |
| Dropped | 0 | — |
| **Total** | **1,219** | Three claims were split in two during the audit (1,216 before) |

Examples of fixes:
- GraphSAGE samples 10 one-hop and 250 two-hop neighbours (S1 = 25, S2 = 10), not "25 at the first hop".
- ViT's 38,809 attention scores are 197², because the class token is counted.
- Goyal et al.'s warmup spike and "never fully recovers" are about training error, not validation error.
- `strict=True` in `load_state_dict` raises an error, while `strict=False` returns the mismatched keys.

## Files
- `ledgers/<doc-slug>.tsv`: tab-separated, with the header `n label kind verdict evidence source`.
  - `n`: the claim's number, in body order.
  - `label`: its footnote label.
  - `kind`: `source` or `lab`.
  - `verdict`: `OK`, `FIXED` or `LAB-OK`.
  - `evidence`: the section, table, figure or output line, with a quote of at most 15 words.
  - `source`: the URL that was read, or `lab`.
- `check_ledgers.py`: compares each ledger's `label` column with the doc's markers, in order, and checks each doc's "Verification status" count. Run it from the repo root as `python3 research/_audit/deep-learning-claim-audit-2026-11-25/check_ledgers.py .`. Once a doc is edited after this audit, its ledger no longer matches, and that is expected.
- `brief.md`: the instructions the audit agents followed. Local paths are replaced by placeholders.

## How sources were read
- HTML pages went through WebFetch.
- Papers were read in full, from the ar5iv or arXiv HTML version or from the PDF. PDF text came from `pypdf` or macOS PDFKit.
- Figures were rendered from the PDF and viewed. Pages too large for WebFetch were read in the built-in browser pane.
- The limits met along the way are in `research/_notes/ai-limitations.md` (L6, L7).
