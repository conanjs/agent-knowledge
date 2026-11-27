---
schema: topic-index/v1
kind: subtopic
topic: performance/code-review
last-updated: 2026-11-27
---

# Performance code review

How to find performance problems by reading code, before anything is slow: catalogs of problem classes (the code shape, the fix that fits, the cost before and after, and the check that confirms it): a first catalog of 39 general classes and thirteen domain catalogs with 96 more; and the calibration of a read-only review agent built on these catalogs. Not covered: profiling running systems (see `../measurement/`) or tuning a database server.

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
| [problem-classes-javascript-engine.md](problem-classes-javascript-engine.md) | reference | Eight JavaScript code shapes that stop V8 13.6 from specializing hot code (megamorphic sites, type changes, oversized functions, `eval`, `Proxy`, `for…in` over arrays, patched or per-object prototypes), each shown in a Node.js 24 lab run, with corrections to outdated V8 advice, and Chrome 158's ratios beside the baseline's | verified |
| [problem-classes-javascript-language.md](problem-classes-javascript-language.md) | reference | Six JavaScript and TypeScript classes (chained array passes, a full pass for the first match, sort keys recomputed, `await` on plain values, stack capture per call, TypeScript downlevel helpers), each with a cost count measured on Node.js 24.22.1 and re-run on other builds, Chrome 158 among them | verified |
| [problem-classes-nodejs-runtime.md](problem-classes-nodejs-runtime.md) | reference | Six Node.js 24 runtime classes: the libuv thread pool, microtask starvation, async hooks, retained Buffer views, worker message copies and source-map stack cost, five backed by lab runs | verified |
| [problem-classes-orm-and-migrations.md](problem-classes-orm-and-migrations.md) | reference | Nine ORM and migration classes, from sibling-collection joins and tracking overhead to table-rewriting DDL, blocking index builds and in-migration backfills, with the locks each PostgreSQL 19 and MySQL 8.4 statement takes | verified |
| [problem-classes-api-and-rpc.md](problem-classes-api-and-rpc.md) | reference | Three gRPC classes (stream-limit queueing, connection pinning behind L4 balancers, bulk unary messages), plus the API-specific signal for every shape that belongs to an existing class | verified |
| [problem-classes-containers-and-runtime-config.md](problem-classes-containers-and-runtime-config.md) | reference | Seven configuration classes from Kubernetes manifests, Dockerfiles and runtime flags: CPU-quota throttling, pools sized from the host's CPUs, heaps that ignore the memory limit, `ndots` DNS expansion, missing readiness gates, build work at container start, autoscaling on the wrong signal | verified |
| [perf-reviewer-calibration.md](perf-reviewer-calibration.md) | deep-dive | A Claude Code review agent with a skill loaded on demand, run on 18 samples with known answers, then on 39 more, with a third arm that reads the index alone, then on 127 more after the index grew to 135 classes: setup, commands, accuracy, false positives and token cost | verified |

## References
- [The Algorithm Design Manual: Stony Brook Algorithm Repository](https://www.algorist.com/algorist.html) — Steven Skiena, living. Backs: topic scope (a problem-to-algorithm catalog).

## Related
- `../optimization/optimization-playbook.md` — what to do once a bottleneck is measured.
- `../../algorithms/` — how the data structures and algorithms in the catalog work.
