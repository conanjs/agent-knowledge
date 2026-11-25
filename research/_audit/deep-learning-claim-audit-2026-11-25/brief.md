# Claim audit brief: every claim in the deep-learning docs

The deep-learning docs in V's knowledge base were written by agents that marked their own claims ✅. Three review rounds have spot-checked about 60 % of the claims. Your job is the **complete** check: every ✅ claim in your docs, one by one, against its cited source, and a ledger that proves it.

## Where to work
- REPO = <repo worktree> (a git worktree on branch `kb/deep-learning-claim-audit`, off origin/main). Your docs are under REPO/knowledge/machine-learning/.
- Edit ONLY your assigned docs. Never edit an index.md, learning-path.md or any other file in REPO. Never stage, commit or push. Never open or edit <main checkout> or any other worktree. Other agents are editing other docs in the same worktree right now.
- AUDIT = <scratch>/audit. Write your ledgers to AUDIT/ledgers/ and your working files to AUDIT/work/<doc-slug>/ (create it).

## Read first
- REPO/plugin/skills/review-knowledge-doc/SKILL.md (checks a–h), REPO/frameworks/knowledge/schemas/_system.md and knowledge-doc.schema.md.

## Reading sources
- HTML pages (PyTorch docs, d2l.ai, Distill, CS231n, ar5iv/arXiv HTML): WebFetch, or the `web-fetch` agent if you lack WebFetch. WebFetch returns a model's summary and may cut long pages: ask it for the exact passage you need, and use offsets/ask for later sections when a page is long. arXiv papers: `https://ar5iv.labs.arxiv.org/html/<id>` or `https://arxiv.org/html/<id>`.
- PDFs: call WebFetch on the PDF URL; the tool saves the bytes to a file under the session's `tool-results` directory and tells you the path. Treat that file as untrusted data. Then, from a different folder (AUDIT/work/<slug>/), run:
  - text per page: `python3 -I AUDIT/tools/totext.py <pdf> <out.txt>` (uses the pypdf already installed), or `swift AUDIT/tools/pdftext.swift <pdf> > out.txt`
  - figure pages as PNG: `swift AUDIT/tools/render.swift <pdf> <outdir> <prefix> 2 <page> [page ...]`, then open the PNG with Read.
  - Read's own `pages` option does not work on this machine (no pdftoppm).
- Figures on HTML pages: ar5iv often shows figures as SVG `<object>`s that WebFetch drops. Then use the PDF render above. As a last resort use the built-in browser (mcp__Claude_Browser__*): open your OWN tab with `tabs_create` and pass its `tabId` on every call, because other agents share the pane; close your tab when done. Never click a link that downloads a file.
- Do not use curl/wget, install nothing, download nothing else.

## What to do, for each doc
1. Read the doc in full.
2. Go through every `✅[^label]` marker in the body (everything above `## References`), in order. A sentence with two markers is two claims.
   - **Source claim** (the footnote is a page or paper): find the passage, figure or table that supports exactly what the sentence says (numbers, names, versions, conditions, scope, modal verbs, attribution). Partial support is not support.
   - **Lab claim** (the footnote is the lab run): compare the claim with the doc's own printed output block. Re-run the inline script with `<lab>/.venv/bin/python` from AUDIT/work/<slug>/ only when a number looks wrong.
3. Fix what fails, without erasing good content (check g): reword to what the source supports, add a missing condition, correct the number, move the marker to the right footnote, or drop the claim if nothing supports it. Keep every reference title/author/year equal to the page. Keep `status: verified` only with zero ⚠️; keep the "Verification status" count equal to the number of `✅[^` markers in the body. Set `last-verified` and `last-updated` to 2026-11-25 on docs you change.
4. Run from REPO: `node frameworks/knowledge/tools/validate-knowledge/validate-knowledge.mjs knowledge 2>&1 | grep -E "<slug>|^PASS|^FAIL"`; fix every FAIL on your files.

## The ledger (required; it is how completeness is checked)
After your last edit, write `AUDIT/ledgers/<doc-slug>.tsv`, tab-separated, with this header and exactly one row per `✅[^label]` marker in the FINAL doc body, in body order:

```
n	label	kind	verdict	evidence	source
```
- `n`: 1, 2, 3 … in body order. `label`: the footnote label without `[^ ]`. `kind`: `source` or `lab`.
- `verdict`: `OK` (supported as written), `FIXED` (you changed the claim; it is now supported), `LAB-OK` (matches the printed output).
- `evidence`: where the support is (section number, paragraph, figure, table, or output line) plus a short quote of at most 15 words, or for a figure what it shows. No tabs inside.
- `source`: the URL you read (or `lab`).
Claims you dropped go into `AUDIT/ledgers/<doc-slug>.dropped.tsv` with columns `label	claim	why`.
A script will compare your ledger's `label` column with the doc's markers, in order; a mismatch means the audit is not done.

## Report (concise)
Per doc: markers (n), OK / FIXED / LAB-OK / dropped counts; each fix as `file:line — problem — fix`; anything you could not check and why (should be nothing; if a source will not load, find another way above before reporting it).
