# Phase 0 scripts

Throw-away Python scripts used for Phase 0 (`../REPORT.md`), kept so the runs can be reproduced. Phase 2 replaces them with tools that have scenarios (`frameworks/knowledge/tools/`). Run each with `python3 -I`.

| Script | What it does |
|---|---|
| `fetch_pages.py <run> <url>…` | Saves each page as text in `<run>/cache/<sha256(url)[:12]>.txt` (curl, then `html.parser`) and indexes it in `<run>/sources.json` |
| `make_input.py <run> <n>` | Builds `<run>/verdicts/round-<n>.input/`: the doc, the cited pages' cache files, `sources.json`, `criteria.json` |
| `sample_claims.py <doc> <n> <seed> <out> [--include <regex>…]` | Picks the stratified claim sample for `claims.json`: each `##` heading gets its share of `n` by its ✅ count, at least 1 |
| `check_quotes.py <run>…` | Checks that each quote behind a failing verdict is in the saved pages |
| `scan_reads.py <transcript> <own-folder> [<regex>…]` | Lists a writer's tool calls that touched forbidden paths (the contamination check) |
| `summarize_verdict.py <verdict.json>…` | Prints scores, counts per verdict and every non-`entails` claim |

The 45-claim samples of the baselines used `sample_claims.py … 45 20261122`.
