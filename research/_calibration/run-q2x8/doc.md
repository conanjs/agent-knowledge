---
schema: deep-dive/v1
topic: performance
status: draft
applies-to: ["PostgreSQL, as one Percona post of April 2022 and its reader comments describe it"]
last-updated: 2026-11-23
synthesized-into: []
tags: [postgresql, wraparound, vacuum, monitoring]
ranked-sources: true
---

# Transaction ID wraparound warnings, from one vendor post

## Summary
**TL;DR:** PostgreSQL forces a shutdown to protect the data when the number of unique transaction IDs reaches its maximum, and Percona's post gives queries that report how close each database is ✅[^percona].
**Use this when:** you read a wraparound risk report or a shutdown warning.
**Depth:** one vendor post, its queries, and one reader report from its comments.

## 1. Mental model
PostgreSQL tracks transactions with unique IDs, and the count approaches an upper limit that can be registered ✅[^percona]. Analogy: an odometer that must be reset before it rolls over.

## 2. Concept architecture
- The post's database-level query reports `age(datfrozenxid)` per database, and a column it names `% WRAPAROUND RISK` ✅[^percona].
- Its table-level query takes the greater of a table's `relfrozenxid` age and its TOAST table's ✅[^percona].

## 3. How it works
1. 200 million transactions is the default threshold used by `autovacuum_freeze_max_age` ✅[^percona].
2. VACUUM cannot operate on a TOAST table alone, so to vacuum a TOAST table you vacuum the table it belongs to ✅[^percona].

## 4. Worked examples
The post's sample log message for a database close to shutdown carries the hint "To avoid a database shutdown, execute a database-wide VACUUM in "mydb"." ✅[^percona]

## 5. Reference & invariants
- 2 billion transactions is the upper limit that PostgreSQL permits before forcing a shutdown ✅[^percona].
- The risk columns are defined in §2.

## 6. Trade-offs, pitfalls & misconceptions
- One reader in a wraparound situation listed the oldest tables and found they were all TOAST tables, and reported no problem vacuuming a TOAST table directly ✅[^percona-comments].

## References
- [Overcoming VACUUM WRAPAROUND](https://www.percona.com/blog/overcoming-vacuum-wraparound/) — Percona, 2022. Rank 4. Backs: Summary, §1–§5. [^percona]
- [Reader comments on Overcoming VACUUM WRAPAROUND](https://www.percona.com/blog/overcoming-vacuum-wraparound/#comments) — readers, 2022–2026. Rank 6. Backs: §6, one report. [^percona-comments]

## Related
- _None yet._
