---
schema: topic-index/v1
kind: subtopic
topic: performance/code-review
last-updated: 2026-11-26
---

# Performance code review

How to find performance problems by reading code, before anything is slow: catalogs of problem classes (the code shape, the fix that fits, the cost before and after, and the check that confirms it): a first catalog of 39 general classes and seven domain catalogs with 57 more; and the calibration of a read-only review agent built on the first catalog. Not covered: profiling running systems (see `../measurement/`) or tuning a database server.

## Docs
| Doc | Type | Summary | Status |
|---|---|---|---|
| [problem-classes.md](problem-classes.md) | reference | Thirty-nine problem classes, each with its signals in code, fix, before → after cost and check, from official docs and checked sources | verified |
| [problem-classes-datastores.md](problem-classes-datastores.md) | reference | Eight problem classes for Redis, DynamoDB, MongoDB, Cassandra and Elasticsearch, and for storage that only grows (retention, the write cost of indexes), each with code signals, fix, cost and check | verified |
| [problem-classes-messaging-and-jobs.md](problem-classes-messaging-and-jobs.md) | reference | Nine problem classes for producers, consumers, background jobs and schedules (Kafka, SQS, RabbitMQ, Celery, Sidekiq, BullMQ): per-message calls, oversized payloads, prefetch and lease mistakes, poison messages, key-ordering ceilings, unchunked jobs and schedule bursts | verified |
| [problem-classes-web-and-mobile-clients.md](problem-classes-web-and-mobile-clients.md) | reference | Nine browser, React, Android and Jetpack Compose code shapes that add per-frame, per-update or per-navigation work, each with its fix, its cost as a count and a check | verified |
| [problem-classes-language-runtimes.md](problem-classes-language-runtimes.md) | reference | Eight classes of cost hidden by language and runtime features (lazy re-enumeration, copies, boxing, capacity hints, V8 shapes, reflection, weak hash keys, false sharing) for Java, C#, Go, Rust, C++, Python and JavaScript | verified |
| [problem-classes-data-pipelines.md](problem-classes-data-pipelines.md) | reference | Seven classes for pandas, Polars, DuckDB, Spark and SQL batch code: row-multiplying joins, unpruned file reads, small files, wasteful column types, shuffle-heavy aggregation, exact distinct counts and full-scan sampling | verified |
| [problem-classes-ml-and-llm-applications.md](problem-classes-ml-and-llm-applications.md) | reference | Seven classes for machine-learning and large-language-model application code: starved input pipelines, per-step tensor reads, per-item inference, cache-breaking prompt order, offline work on the real-time API, unbounded conversation history and exact vector scans, with provider facts dated 2026-11-26 | verified |
| [problem-classes-network-and-delivery.md](problem-classes-network-and-delivery.md) | reference | Nine network and delivery classes: HTTP caching, compression, CORS preflights, small socket writes, connection fan-out, slow hashing on every request, and object-store transfers and listing | verified |
| [perf-reviewer-calibration.md](perf-reviewer-calibration.md) | deep-dive | A Claude Code review agent with a skill loaded on demand, run on 18 samples with known answers, then on 39 more, with a third arm that reads the index alone: setup, commands, accuracy, false positives and token cost | verified |

## References
- [The Algorithm Design Manual: Stony Brook Algorithm Repository](https://www.algorist.com/algorist.html) — Steven Skiena, living. Backs: topic scope (a problem-to-algorithm catalog).

## Related
- `../optimization/optimization-playbook.md` — what to do once a bottleneck is measured.
- `../../algorithms/` — how the data structures and algorithms in the catalog work.
