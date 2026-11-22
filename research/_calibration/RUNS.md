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
