# Calibration run ids

Neutral folder names, so the judge cannot guess what a run expects.

| Run | Source | Judge prompt |
|---|---|---|
| run-k4q9 | private-fields-planted, round 1 input | v1 `cded4d1` |
| run-m7t2 | mcp-known-errors, round 1 input | v2 `9ae51f8` |
| run-c3x8 | private-fields-clean, round 1 input | v2 `9ae51f8` |
| run-p5w1 | private-fields-planted, round 1 input | v2 `9ae51f8` |
| run-h2w6 | private-fields-clean, round 1 input | v3 `f166f98` |
| run-t8n3 | private-fields-planted, round 1 input | v3 `f166f98` |
| run-b9r4 | mcp-known-errors, round 1 input, plus `claims.json`: 15 claims (seed 20261122) with K1, K2 and both K3 rows forced in | v3 `f166f98` |
| run-w3j7 | SE-04 baseline, plus `claims.json`: 45 of 185 claims, stratified by `##` heading (seed 20261122) | v3 `f166f98` |

Contaminated baselines (writers read the design doc): the first LS-03 and SE-02 docs, moved to `contaminated-baselines/`. Their reruns write to `research/_golden/<id>/baseline/` again.
| run-q6v2 | SE-02 baseline (rerun), plus `claims.json`: 45 claims, stratified by `##` heading (seed 20261122) | v3 `f166f98` |
| run-z5k8 | LS-03 baseline (rerun), plus `claims.json`: 45 claims, stratified by `##` heading (seed 20261122) | v3 `f166f98` |
| run-f2n8 | private-fields-clean, input built by `evaluate-research.mjs stage1` (with `stage1.json`) | v4 `d8dcf5d` |
| run-x7d3 | private-fields-planted, input built by `stage1` | v4 `d8dcf5d` |
| run-r9k5 | mcp-known-errors, input built by `stage1 --sample 15 --seed 20261122` with K1, K2 and both K3 rows forced in (the JS sampler; its other 11 claims differ from run-b9r4's) | v4 `d8dcf5d` |
| run-k8w2 | private-fields-clean, input by `stage1` | v5 `2b066f6`, run as the linked `knowledge-judge` agent |
| run-d5h9 | private-fields-planted, input by `stage1` | v5 `2b066f6`, `knowledge-judge` agent |
| run-m3v6 | mcp-known-errors, `stage1 --sample 15 --seed 20261122` with K1, K2 and both K3 rows forced in (same sample as run-r9k5) | v5 `2b066f6`, `knowledge-judge` agent |
