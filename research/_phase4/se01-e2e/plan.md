# Plan: PostgreSQL MVCC and transaction ID wraparound prevention

**Request (V's words):** Explain MVCC and how to prevent Transaction ID Wraparound in PostgreSQL.

## Question

How does PostgreSQL's multi-version concurrency control (MVCC) keep several versions of a row and decide which one each transaction sees, why does the 32-bit transaction ID (XID) counter make wraparound possible, and what must an operator do (freezing, VACUUM, autovacuum, monitoring, recovery) to prevent it?

## Sub-questions, one per profile

- **taxonomy** — The names the PostgreSQL manual itself uses, with a definition and the version they apply to: MVCC, snapshot, row version (tuple), `xmin` / `xmax`, transaction ID (XID) and its size, how XIDs compare (circular, modulo 2^32), epoch or 64-bit form if the manual names one, frozen XID and freezing, `relfrozenxid` / `datfrozenxid`, MultiXact ID and `relminmxid` / `datminmxid`, the visibility map bits, dead tuple, aggressive vacuum, the autovacuum run "to prevent wraparound", and the failsafe. Must find: one Rank 1 or 3 source per term, so later workers search for the right words.
- **ground-truth** — From the PostgreSQL manual (current release, plus the release that introduced each setting when the manual says so) and the source code: how a snapshot decides visibility; why the comparison horizon is about 2 billion XIDs; every setting that drives freezing (`vacuum_freeze_min_age`, `vacuum_freeze_table_age`, `autovacuum_freeze_max_age`, the MultiXact twins, the failsafe ages) with defaults, ranges and limits; the warnings and the hard stop the server applies as the limit nears, with their thresholds; the recovery procedure the manual prescribes once the stop is reached. Must find: exact values, modal verbs and version numbers.
- **practitioner** — How teams that run PostgreSQL in production monitor XID age and prevent wraparound: the queries they run and their real output, alert thresholds they use, per-table autovacuum tuning, and what holds the oldest-XID horizon back (long or idle-in-transaction sessions, prepared transactions, replication slots, standby feedback). Must find: worked examples with real inputs and outputs, and at least one first-hand incident report.
- **pitfall** — What goes wrong and what people believe that is false: why a vacuum fails to advance `relfrozenxid`, what cancels or blocks vacuum, MultiXact exhaustion, tables autovacuum cannot process, advice that newer releases changed (for example the recovery procedure), and common misconceptions about what VACUUM, VACUUM FULL and freezing do. Must find: each failure with its cause and the release it applies to.

## Out of scope

- Isolation levels beyond what a snapshot needs (Serializable Snapshot Isolation, retry logic): covered for performance in `knowledge/performance/database-query-performance.md` (serializable conflict row); the doc links to it.
- Index-only scans and the visibility map's role in query plans: covered in `knowledge/performance/database-query-performance.md`; the doc mentions the visibility map only for vacuum and freezing.
- VACUUM tuning for table bloat and query speed, HOT updates, index bloat, except where they affect freezing.
- MVCC in other databases (MySQL InnoDB, Oracle), and out-of-core 64-bit XID patches or forks.

## Doc settings

- `topic:` `performance` (no `databases/` folder exists in `knowledge/`; this is the closest existing folder, next to `database-query-performance.md`). If V prefers a new `databases/` topic, that is V's call at commit time.
- `MODE:` full-verified. `CAP:` 4 sources per profile.
- Seeds: none supplied by V for any profile; workers search from scratch.
- Related docs to link: `knowledge/performance/database-query-performance.md`.

## Token estimate

- 4 workers at about 135k each: about 540k.
- Judge: at most 80 claims at about 2,600 tokens per claim: about 210k per round; 1 round expected, up to 3 (2 patch rounds): 210k to 630k.
- Orchestrator (reading passages, writing, checks): about 200k.
- Total: about 0.95M expected, about 1.4M worst case.
