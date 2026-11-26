---
schema: topic-index/v1
kind: subtopic
topic: performance/code-review
last-updated: 2026-11-26
---

# Performance code review

How to find performance problems by reading code, before anything is slow: a catalog of problem classes (the code shape, the fix that fits, the cost before and after, and the check that confirms it), and the calibration of a read-only review agent built on that catalog. Not covered: profiling running systems (see `../measurement/`) or tuning a database server.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [problem-classes.md](problem-classes.md) | reference | Thirty-nine problem classes, each with its signals in code, fix, before → after cost and check, from official docs and checked sources | verified |
| [perf-reviewer-calibration.md](perf-reviewer-calibration.md) | deep-dive | A Claude Code review agent with a skill loaded on demand, run on 18 samples with known answers, then on 39 more: setup, commands, accuracy, false positives and token cost | verified |

## References
- [The Algorithm Design Manual: Stony Brook Algorithm Repository](https://www.algorist.com/algorist.html) — Steven Skiena, living. Backs: topic scope (a problem-to-algorithm catalog).

## Related
- `../optimization/optimization-playbook.md` — what to do once a bottleneck is measured.
- `../../algorithms/` — how the data structures and algorithms in the catalog work.
