---
schema: knowledge-doc/v1
type: reference
topic: performance/code-review
status: verified
applies-to: ["Redis docs 'latest' (no single version on the pages; each command page carries a 'since' version)", "Amazon DynamoDB Developer Guide, living", "MongoDB Manual 9.0", "Apache Cassandra docs (the 'latest' path showed version 5.0, with a banner calling it a prerelease version)", "Elasticsearch current docs (no version stated on the pages)", "PostgreSQL 19", "all read 2026-11-26"]
last-verified: 2026-11-26
last-updated: 2026-11-26
tags: [performance, code-review, redis, dynamodb, mongodb, cassandra, elasticsearch, postgresql, retention, ttl, partitioning, indexes, vacuum]
ranked-sources: true
---

# Performance problem classes for code review: key-value, document, wide-column and search stores

## Summary
**TL;DR:** Non-relational stores make some costs easy to miss in review: one command that walks a whole key, a "query" that reads the whole table and filters afterwards, a partition key that sends all traffic to one partition, an item that grows forever, and data that is never deleted. Each of the eight classes below has a code signal, a named fix, a before → after cost stated as growth or counts, and a check. Time speedups still need a measurement.
**Use this when:** you review code or schema that talks to Redis, DynamoDB, MongoDB, Cassandra or Elasticsearch; you review a table, collection or index that has no retention plan; you review PostgreSQL schema changes that add indexes or drop old rows.
**Not this doc:** the first catalog of 39 classes (N+1 calls, missing SQL indexes, query shape, lock scope, connection reuse, over-fetching) → [problem-classes.md](problem-classes.md); caching strategy and Redis as a cache → [../optimization/caching.md](../optimization/caching.md); a sourced hot-partition incident → [../case-hot-partition.md](../case-hot-partition.md); why PostgreSQL keeps dead rows and how wraparound happens → [../postgresql-mvcc-xid-wraparound-deep-dive.md](../postgresql-mvcc-xid-wraparound-deep-dive.md).

## Scope
The domain is data stores reached by key or by search, and storage that grows over time. Covered: Redis, Amazon DynamoDB, MongoDB, Apache Cassandra, Elasticsearch, and PostgreSQL for two classes only (retention by partition, write cost of indexes). Not covered: shapes already in [problem-classes.md](problem-classes.md) (they are listed under "Belongs to an existing class" in Lookup notes), cluster sizing, replication and backup settings.

A problem class here is a code or schema shape whose cost grows with data size or data age, plus its standard remedy. Analogy: a librarian asked "find every book with a red cover" must walk every shelf, while "find the book with call number 512.7" is one walk to one shelf. The concrete artifact: `dynamodb.scan(FilterExpression="status = :s")` walks every shelf; `dynamodb.query(KeyConditionExpression="status = :s")` against an index on `status` walks one.

**Notation** (each symbol is a size read from the code or the workload):

| Symbol | Meaning | Worked example |
|---|---|---|
| n | items, documents or rows in the table, collection or index | a `sessions` table with n = 2,000,000 items |
| k | items that match the request | 40 of those sessions belong to one user, so k = 40 |
| N | elements inside one Redis key (members of a set, fields of a hash) | a set `online-users` with N = 300,000 members |
| s | shards a search request touches | an index with s = 5 primary shards |
| d, p | the search offset (`from`) and page size (`size`) | page 500 of 20 hits: d = 9,980, p = 20 |
| i | indexes on one table or collection | a table with i = 9 indexes |
| r | how long data is kept (retention window) versus how long the system has run | keep r = 30 days of events in a system that has run 3 years |

**Terms:**

| Term | Plain meaning | Analogy | Concrete example |
|---|---|---|---|
| Partition key | The attribute whose value decides which partition (server slice) stores an item | The first letter of a surname deciding which filing cabinet a folder goes in | DynamoDB table `orders` with partition key `customer_id` |
| Hot partition | One partition that gets far more reads or writes than the others | One checkout lane open while nine stand empty | Every write uses partition key `2026-11-26` (today's date) |
| Read or write capacity unit | DynamoDB's unit of throughput: one strongly consistent read per second of up to 4 KB, or one write per second of up to 1 KB ✅[^ddb-constraints] | A metered ticket per item read | A 1 MB Scan page of 4 KB items costs 128 eventually consistent reads ✅[^ddb-bp-scan] |
| Big key | A Redis key that holds very many elements or bytes | One drawer stuffed with a whole year of receipts | A hash `user:42:events` with 2 million fields |
| Time to live (TTL) | An expiry time after which the store deletes the item by itself | A carton of milk with a date on it | Redis `SET k v EX 3600`; a MongoDB TTL index with `expireAfterSeconds` |
| Mapping | Elasticsearch's schema: the list of fields an index knows | The column headings of a spreadsheet | A log index whose mapping gains one field per customer id |
| Cleanup horizon (`xmin`) | The oldest snapshot any PostgreSQL session may still need; dead rows newer than it cannot be removed | A shared fridge nobody can clean while one person says "I might still eat that" | `pg_stat_activity.backend_xmin` of a session left `idle in transaction` |
| HOT update | A PostgreSQL update that adds no new index entries; possible when it changes no column the table's indexes reference (summarizing indexes such as BRIN excepted) and the old row's page has enough free space ✅[^pg-hot] | Editing a page in place without retyping the book's index | `UPDATE accounts SET last_seen = now()` when `last_seen` is not indexed |

## Catalog

**Key-value and document access**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `linear-command-big-key` | Redis `KEYS pattern`; `SMEMBERS`, `HGETALL`, `LRANGE key 0 -1`, `SUNION`, `SORT` on keys that grow with users or time; `DEL` of a large key | `SCAN` / `SSCAN` / `HSCAN` / `ZSCAN` with a cursor and `COUNT`; a set kept as an index instead of `KEYS`; bounded ranges (`LRANGE key 0 99`); `UNLINK` instead of `DEL` | One O(N) command that stalls every client → O(1) per call and O(N) spread over many calls. `KEYS` is O(N) in the number of keys and should not be used in regular application code ✅[^redis-keys]; `HGETALL` is O(N) in the hash size ✅[^redis-hgetall]; `LRANGE` is O(S+N), where S is the distance of the start offset from the nearest end of the list and N the number of elements returned ✅[^redis-lrange]; Redis serves requests on a mostly single thread, so a slow command makes all other clients wait ✅[^redis-latency]; `SCAN` is O(1) per call and avoids the multi-second blocking of `KEYS` or `SMEMBERS` on big collections ✅[^redis-scan]; `UNLINK` is O(1) per key and reclaims memory in another thread, while `DEL` blocks ✅[^redis-unlink] | `SLOWLOG` (Redis's log of slow commands) shows no slow commands blocking the server ✅[^redis-latency]; `redis-cli --bigkeys` lists the largest keys and uses `SCAN`, so it can run against a busy server ✅[^redis-cli] |
| `scan-then-filter` | DynamoDB `Scan` (or `Query` on a non-key attribute) with `FilterExpression`; `ScanFilter`; Cassandra `... ALLOW FILTERING` | Design the key or a secondary index for the access pattern, then `Query` / `GetItem` / `BatchGetItem`; in Cassandra, a table whose partition key is the filtered column | Read cost O(n) per request → O(k). A Scan reads every item, and the filter runs after the Scan, so it consumes the same read capacity with or without the filter ✅[^ddb-scan]; AWS advises designing tables so the application can use `Query` instead of `Scan` ✅[^ddb-bp-scan]; `ALLOW FILTERING` explicitly executes a full scan with unpredictable performance (Cassandra 5.0) ✅[^cass-dml] | DynamoDB: `ScannedCount` far above `Count` marks an inefficient Scan ✅[^ddb-scan]; `ReturnConsumedCapacity=TOTAL` at two table sizes. Cassandra: the same query without `ALLOW FILTERING` is rejected ✅[^cass-dml] |
| `partition-key-skew` | A partition or shard key with few values (`status`, `type`, `country`, today's date); a key that only grows (timestamp, auto-increment id, MongoDB `ObjectId`) | A high-cardinality key with even access; write sharding with a random or calculated suffix; MongoDB hashed sharding | Throughput capped at one partition → spread over many. Each DynamoDB partition is designed to deliver at most 3,000 read units and 1,000 write units per second ✅[^ddb-partition]; a suffix from 1 to 200 spreads one day's writes, at the cost of reading all 200 suffixes and merging ✅[^ddb-sharding]; in MongoDB 9.0 low cardinality caps the number of chunks, and an always-increasing key routes all new inserts to the `maxKey` chunk, so the page says to consider hashed sharding ✅[^mongo-shardkey] | DynamoDB Contributor Insights shows the most accessed items (in its accessed-and-throttled mode) and the most throttled items ✅[^ddb-ci]; per-partition or per-shard write counts are about equal |
| `unbounded-item-growth` | `$push` with no `$slice`; DynamoDB `list_append` or `ADD` to a set on every event; a Cassandra partition key with no time bucket (`sensor_id` only); Elasticsearch documents whose field names come from data (`{"<customer_id>": …}`) | MongoDB subset or reference pattern, or `$push` with `$each` and `$slice`; one item per event under a shared partition key; a bucket column in the Cassandra partition key; Elasticsearch `flattened` type or explicit mapping | Item size and per-access work O(history) → bounded. MongoDB 9.0: an unbounded array can pass the 16 MB document limit and decrease index performance; bound it by subsetting and referencing ✅[^mongo-arrays]; the limit is 16 mebibytes ✅[^mongo-limits]; `$slice` limits the number of array elements ✅[^mongo-push]; a DynamoDB item is at most 400 KB including attribute names ✅[^ddb-constraints]; Cassandra's hard limit is 2 billion cells per partition, split by adding a column to the partition key ✅[^cass-model]; runaway field growth is "mapping explosion", with a default limit of 1,000 fields ✅[^es-mapexp], and `flattened` maps a whole object as one field ✅[^es-flattened] | Largest item or document size and partition size over time stay flat; mapping field count stays flat as data grows |

**Search engines**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `search-deep-pagination` | `from` computed as `page * size` with no cap; `index.max_result_window` raised; scroll used for user-facing paging | `search_after` with a point in time (PIT); cap the page number users can reach | Per request O(s·(d + p)) hits held → O(s·p). By default `from` + `size` cannot page past 10,000 hits; each shard loads the requested hits and those of all previous pages into memory; use `search_after` with a PIT ✅[^es-paginate] | Memory and time of a request at `from` 0 against `from` 9,980; any raised `index.max_result_window` in index settings |
| `leading-wildcard-search` | `wildcard`, `query_string` or `regexp` with a pattern starting `*` or `?` (`*@example.com`, `.*error`) built from user input | `wildcard` field type for grep-like search; index the reversed or tokenized value; set `search.allow_expensive_queries: false` to block such queries | Extra iterations to find matching terms on every query → a field indexed as n-grams. A pattern beginning with `*` or `?` can increase the iterations needed to find matching terms ✅[^es-wildcard]; the `wildcard` type indexes the whole value with n-grams and stores the full string; exact matches on full terms are slower ✅[^es-keyword]; wildcard queries do not run when `search.allow_expensive_queries` is false ✅[^es-wildcard] | Profile (`"profile": true`) of the query on the production index; time at two index sizes |

**Storage that only grows**

| Class | Signals in code | Fix | Before → after | Check |
|---|---|---|---|---|
| `no-retention-policy` | Redis `SET` with no `EX`/`PX` on per-session or per-request keys; a DynamoDB table with no TTL attribute; a MongoDB event collection with no TTL index; Elasticsearch indices with no lifecycle policy; a cron job running `DELETE FROM events WHERE created_at < …` on a large unpartitioned table | Expiry at write time (`EX`, DynamoDB TTL, MongoDB TTL index); Elasticsearch ILM rollover and delete; PostgreSQL range partitions dropped or detached; Cassandra TWCS for TTL data | Storage O(system age) → O(r); deleting old data O(rows deleted) plus cleanup → one metadata operation. Redis keys without an expiry live forever ✅[^redis-expire]; DynamoDB deletes expired items typically within a few days after expiry, without consuming write throughput ✅[^ddb-ttl]; a MongoDB TTL index removes documents after a set time ✅[^mongo-ttl]; an example ILM policy on the page deletes the index once its 30-day retention period is reached ✅[^es-ilm], and deleted documents keep using resources until a segment merge, so delete whole indices ✅[^es-shards]; in PostgreSQL 19, dropping or detaching a partition is far faster than a bulk `DELETE` and avoids its `VACUUM` overhead ✅[^pg-partition]; TWCS (Cassandra's time-window compaction) is recommended for time-series and TTL workloads and drops whole SSTables when they expire; the same page says out-of-order writes that mix old and new data in one SSTable undermine it ✅[^cass-twcs] | Storage size per day levels off at about r days of data; the purge job's run time does not grow with system age |
| `excess-write-indexes` | A migration adding an index nobody queries; many indexes on an insert-heavy table or collection; an index on a column updated on every request (`last_seen`, `counter`) | Drop indexes with no scans over a full business cycle; merge overlapping indexes; keep frequently updated columns out of indexes | Index maintenance per write 1 + i → 1 + (indexes actually used). PostgreSQL 19 keeps every index in sync with the table, which adds overhead to data changes and can prevent HOT updates, so indexes seldom or never used should be removed ✅[^pg-indexes-intro]; a HOT update needs no change to indexed columns (summarizing indexes aside) and free space on the old row's page ✅[^pg-hot]; in MongoDB 9.0, for collections with a high write-to-read ratio, each insert must also update any indexes ✅[^mongo-ops] | PostgreSQL `pg_stat_all_indexes.idx_scan` (index scans started on the index) ✅[^pg-stats]; MongoDB `$indexStats` `accesses.ops` ✅[^mongo-indexstats]; write latency before and after the drop |

## Lookup notes

**Not a problem when**

| Class | Not a problem when |
|---|---|
| `linear-command-big-key` | N is bounded by the code (a hash of 10 config fields, a list capped with `LTRIM`); the command runs on a replica kept for slow queries ✅[^redis-latency]; `KEYS` runs in a one-off debugging or migration script ✅[^redis-keys] |
| `scan-then-filter` | The table is small and bounded; it is an offline export or backfill that reads everything anyway (then a parallel Scan with a `Limit` can keep it from starving other traffic ✅[^ddb-scan]; the best-practices page suggests parallel scans only when the table is 20 GB or larger, provisioned read throughput is not fully used and sequential scans are too slow ✅[^ddb-bp-scan]); Cassandra `ALLOW FILTERING` runs a full scan ✅[^cass-dml], so it is acceptable only on a dataset the code knows is small (reviewer judgment) |
| `partition-key-skew` | Total traffic stays well under one partition's limit; the low-cardinality value is a sort key, not the partition key; a monotonic key in a table that is not sharded |
| `unbounded-item-growth` | The array has a fixed maximum the code enforces (`$slice`, a domain cap such as "up to 5 addresses"); the field names come from a closed list |
| `search-deep-pagination` | The UI cannot reach deep pages (a fixed cap of, say, 50 pages); the index is small; the request is a one-off export written with `search_after` |
| `leading-wildcard-search` | The field is a `wildcard` field ✅[^es-keyword]; the index is small and bounded; the pattern has a fixed leading prefix (`err*`) |
| `no-retention-policy` | The data is a system of record with a legal duty to keep it; the volume is bounded by the domain (one row per country); archival to cheaper storage is already in place |
| `excess-write-indexes` | The table is read-heavy and rarely written; MongoDB says such collections often benefit from more indexes ✅[^mongo-ops]; the index enforces a constraint (unique, primary key) even if no query reads it |

**Belongs to an existing class** (not added here)
- A Redis `GET` per item in a loop, or a DynamoDB `GetItem` per id → `io-batching-n-plus-one`. Redis advises fewer round trips: aggregated commands (`MGET`, `MSET`) or variadic commands first, then pipelining, then a sequence of round trips ✅[^redis-latency]; one `BatchGetItem` retrieves at most 100 items ✅[^ddb-constraints].
- A MongoDB query with no supporting index (`COLLSCAN` in `explain`) → `db-query-index`. Check: `COLLSCAN` against `IXSCAN`, and `totalDocsExamined`, which counts documents examined, not returned ✅[^mongo-explain].
- A Redis client connected per request → `connection-management`; Redis advises long-lived connections ✅[^redis-latency].
- A DynamoDB read that returns whole items for a few attributes → `payload-overfetch`, with the correction below.
- A PostgreSQL transaction held open (a remote call or user wait after `BEGIN`, a session left `idle in transaction`) → `transaction-lock-scope`, which already carries the open-transaction and dead-rows claim. Three additions from the PostgreSQL 19 pages: `idle_in_transaction_session_timeout` and `transaction_timeout` both default to 0 (off) ✅[^pg-client]; `pg_stat_activity` shows `idle in transaction` sessions ✅[^pg-stats]; the manual's steps for a held-back horizon are to resolve old prepared transactions, end long-running transactions and drop old replication slots, found with `age(backend_xmin)` and `pg_replication_slots` ✅[^pg-vacuum]. Why dead rows stay is in [../postgresql-mvcc-xid-wraparound-deep-dive.md](../postgresql-mvcc-xid-wraparound-deep-dive.md).

**Corrections found while checking the sources (2026-11-26)**
- A DynamoDB `ProjectionExpression` reduces bytes returned but not read capacity: consumption depends on item count and size, not on the attributes requested or on a filter ✅[^ddb-scan].
- A parallel Scan is not a fix for `scan-then-filter`: segments are assigned by partition-key hash and can be uneven, and many workers can consume all the table's throughput ✅[^ddb-scan].
- Redis `SCAN ... TYPE` filters after elements are retrieved, so it does not reduce the server's work ✅[^redis-scan]; a full `SCAN` may return an element more than once ✅[^redis-scan].
- Redis `SET` without `EX` on an existing key clears its timeout, while `INCR`, `LPUSH` and `HSET` leave it untouched ✅[^redis-expire]. Code that refreshes a value with plain `SET` silently turns an expiring key into a permanent one.
- Expiry is not instant. DynamoDB may delete expired items at any time, typically within a few days after expiry, and advises filtering expired items out of reads ✅[^ddb-ttl]; MongoDB's TTL task runs every 60 seconds and gives no guarantee of immediate deletion ✅[^mongo-ttl]. Redis can block when many keys expire in the same second and they make up at least 25% of the keys that have an expiry ✅[^redis-latency], so spread expiry times that are set in bulk.
- With `volatile-*` eviction policies, Redis behaves like `noeviction` when no key has an expiry, and `maxmemory` 0 (no limit) is the default on 64-bit systems ✅[^redis-eviction].
- PostgreSQL 19 `DROP TABLE` on a partition takes an `ACCESS EXCLUSIVE` lock on the parent table (`DETACH PARTITION ... CONCURRENTLY` needs only `SHARE UPDATE EXCLUSIVE`); too many partitions lengthen planning and raise memory use ✅[^pg-partition].
- Elastic no longer recommends the scroll API for deep pagination ✅[^es-paginate].
- Index-usage counters reset: MongoDB `$indexStats` on `mongod` restart and per node ✅[^mongo-indexstats]; PostgreSQL statistics after an unclean shutdown ✅[^pg-stats]. A zero count proves little unless the window covers a full business cycle on every node.

**What the sources do not say**
- The Cassandra data-modeling page gives only the hard limit of 2 billion cells; the "100 MB or 100,000 rows per partition" guideline often quoted is not on it.
- MongoDB's unbounded-arrays page does not explain why index performance drops, and does not mention the bucket pattern.
- Elastic's ILM page does not say that deleting an index beats deleting documents; the shard-sizing page does ✅[^es-shards].
- Redis's eviction page does not state the default `maxmemory-policy`.
- The Elasticsearch pages carry no version number; they were read as the current docs.
- One source number with its conditions: Redis says an entry-level laptop scans a 1 million key database with `KEYS` in 40 milliseconds ✅[^redis-keys]. It shows `KEYS` is fast per key, not that it is safe: the server serves no one else meanwhile.

**Calibration state (2026-11-26).** Each class of this catalog has one known-bad sample in round 3 of the review-agent calibration, and some of its "Not a problem when" rows have a trap sample. In that round (one run per arm) the agent with the skill filed all 96 planted problems of the thirteen domain catalogs under the right class id, and without the skill 86 of them. Results per catalog, and the limits of the round: [perf-reviewer-calibration.md](perf-reviewer-calibration.md) §6.5.

## Takeaways
- In Redis, check the documented complexity of every command on a key that grows with users or time; an O(N) command blocks all clients, so use the `SCAN` family or bound N. [rule-candidate]
- A filter after a scan (DynamoDB `FilterExpression`, Cassandra `ALLOW FILTERING`) costs the whole table per request; ask for a key or index that serves the access pattern. [rule-candidate]
- Every table, collection, index or key family that receives events needs a retention mechanism named in the same change: TTL, lifecycle policy or partition drop. [rule-candidate]
- Count indexes as a write cost: in PostgreSQL every index is kept in step with the table and can prevent heap-only updates, so indexes that are seldom or never used should be removed.

## Verification status
- Verified: 72 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-26

## References
- [KEYS](https://redis.io/docs/latest/commands/keys/) — Redis, docs "latest" (Redis 8.x), living. Rank 1. Backs: Catalog, linear-command-big-key; Lookup notes. [^redis-keys]
- [HGETALL](https://redis.io/docs/latest/commands/hgetall/) — Redis, docs "latest", living. Rank 1. Backs: Catalog, linear-command-big-key. [^redis-hgetall]
- [LRANGE](https://redis.io/docs/latest/commands/lrange/) — Redis, docs "latest", living. Rank 1. Backs: Catalog, linear-command-big-key. [^redis-lrange]
- [SCAN](https://redis.io/docs/latest/commands/scan/) — Redis, docs "latest", living. Rank 1. Backs: Catalog, linear-command-big-key; Lookup notes. [^redis-scan]
- [UNLINK](https://redis.io/docs/latest/commands/unlink/) — Redis, docs "latest", living. Rank 1. Backs: Catalog, linear-command-big-key. [^redis-unlink]
- [Diagnosing latency issues](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/) — Redis, docs "latest", living. Rank 1. Backs: Catalog, linear-command-big-key; Lookup notes. [^redis-latency]
- [Redis CLI](https://redis.io/docs/latest/develop/tools/cli/) — Redis, docs "latest", living. Rank 1. Backs: Catalog, linear-command-big-key check. [^redis-cli]
- [EXPIRE](https://redis.io/docs/latest/commands/expire/) — Redis, docs "latest", living. Rank 1. Backs: Catalog, no-retention-policy; Lookup notes. [^redis-expire]
- [Key eviction](https://redis.io/docs/latest/develop/reference/eviction/) — Redis, docs "latest", living. Rank 1. Backs: Lookup notes. [^redis-eviction]
- [Scanning tables in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html) — Amazon Web Services, DynamoDB Developer Guide, living. Rank 1. Backs: Catalog, scan-then-filter; Lookup notes. [^ddb-scan]
- [Best practices for querying and scanning data in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-query-scan.html) — Amazon Web Services, living. Rank 1. Backs: Scope; Catalog, scan-then-filter. [^ddb-bp-scan]
- [Best practices for designing and using partition keys effectively in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, partition-key-skew. [^ddb-partition]
- [Using write sharding to distribute workloads evenly](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-sharding.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, partition-key-skew. [^ddb-sharding]
- [Using time to live (TTL) in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, no-retention-policy; Lookup notes. [^ddb-ttl]
- [Constraints in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html) — Amazon Web Services, living. Rank 1. Backs: Scope; Catalog, unbounded-item-growth; Lookup notes. [^ddb-constraints]
- [CloudWatch contributor insights for DynamoDB: How it works](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/contributorinsights_HowItWorks.html) — Amazon Web Services, living. Rank 1. Backs: Catalog, partition-key-skew check. [^ddb-ci]
- [Unbounded arrays](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/unbounded-arrays/) — MongoDB, Manual 9.0. Rank 1. Backs: Catalog, unbounded-item-growth. [^mongo-arrays]
- [MongoDB limits and thresholds](https://www.mongodb.com/docs/manual/reference/limits/) — MongoDB, Manual 9.0. Rank 1. Backs: Catalog, unbounded-item-growth. [^mongo-limits]
- [$push](https://www.mongodb.com/docs/manual/reference/operator/update/push/) — MongoDB, Manual 9.0. Rank 1. Backs: Catalog, unbounded-item-growth. [^mongo-push]
- [Explain results](https://www.mongodb.com/docs/manual/reference/explain-results/) — MongoDB, Manual 9.0. Rank 1. Backs: Lookup notes. [^mongo-explain]
- [TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/) — MongoDB, Manual 9.0. Rank 1. Backs: Catalog, no-retention-policy; Lookup notes. [^mongo-ttl]
- [Operational factors and data models](https://www.mongodb.com/docs/manual/core/data-model-operations/) — MongoDB, Manual 9.0. Rank 1. Backs: Catalog, excess-write-indexes; Lookup notes. [^mongo-ops]
- [$indexStats](https://www.mongodb.com/docs/manual/reference/operator/aggregation/indexStats/) — MongoDB, Manual 9.0. Rank 1. Backs: Catalog, excess-write-indexes check; Lookup notes. [^mongo-indexstats]
- [Choose a shard key](https://www.mongodb.com/docs/manual/core/sharding-choose-a-shard-key/) — MongoDB, Manual 9.0. Rank 1. Backs: Catalog, partition-key-skew. [^mongo-shardkey]
- [Data manipulation (CQL DML)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html) — Apache Cassandra, docs "latest" (5.0). Rank 1. Backs: Catalog, scan-then-filter; Lookup notes. [^cass-dml]
- [Refining the data model](https://cassandra.apache.org/doc/latest/cassandra/developing/data-modeling/data-modeling_refining.html) — Apache Cassandra, docs "latest" (5.0). Rank 1. Backs: Catalog, unbounded-item-growth. [^cass-model]
- [Time Window Compaction Strategy](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/twcs.html) — Apache Cassandra, docs "latest" (5.0). Rank 1. Backs: Catalog, no-retention-policy. [^cass-twcs]
- [Paginate search results](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results) — Elastic, Elasticsearch current docs, living. Rank 1. Backs: Catalog, search-deep-pagination; Lookup notes. [^es-paginate]
- [Wildcard query](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-wildcard-query) — Elastic, current docs, living. Rank 1. Backs: Catalog, leading-wildcard-search. [^es-wildcard]
- [Keyword type family (wildcard field type)](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/keyword) — Elastic, current docs, living. Rank 1. Backs: Catalog, leading-wildcard-search; Lookup notes. [^es-keyword]
- [Index lifecycle management](https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management) — Elastic, current docs, living. Rank 1. Backs: Catalog, no-retention-policy. [^es-ilm]
- [Size your shards](https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards) — Elastic, current docs, living. Rank 1. Backs: Catalog, no-retention-policy; Lookup notes. [^es-shards]
- [Mapping explosion](https://www.elastic.co/docs/troubleshoot/elasticsearch/mapping-explosion) — Elastic, current docs, living. Rank 1. Backs: Catalog, unbounded-item-growth. [^es-mapexp]
- [Flattened field type](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/flattened) — Elastic, current docs, living. Rank 1. Backs: Catalog, unbounded-item-growth. [^es-flattened]
- [Table Partitioning](https://www.postgresql.org/docs/19/ddl-partitioning.html) — PostgreSQL Global Development Group, 19. Rank 1. Backs: Catalog, no-retention-policy; Lookup notes. [^pg-partition]
- [Indexes: Introduction](https://www.postgresql.org/docs/19/indexes-intro.html) — PostgreSQL Global Development Group, 19. Rank 1. Backs: Catalog, excess-write-indexes. [^pg-indexes-intro]
- [Heap-Only Tuples (HOT)](https://www.postgresql.org/docs/19/storage-hot.html) — PostgreSQL Global Development Group, 19. Rank 1. Backs: Scope; Catalog, excess-write-indexes. [^pg-hot]
- [The Cumulative Statistics System](https://www.postgresql.org/docs/19/monitoring-stats.html) — PostgreSQL Global Development Group, 19. Rank 1. Backs: Catalog, excess-write-indexes check; Lookup notes. [^pg-stats]
- [Client Connection Defaults](https://www.postgresql.org/docs/19/runtime-config-client.html) — PostgreSQL Global Development Group, 19. Rank 1. Backs: Lookup notes. [^pg-client]
- [Routine Vacuuming](https://www.postgresql.org/docs/19/routine-vacuuming.html) — PostgreSQL Global Development Group, 19. Rank 1. Backs: Lookup notes. [^pg-vacuum]

## Related
- [problem-classes.md](problem-classes.md) — the first catalog of 39 classes, including the relational-database shapes this doc does not repeat.
- [perf-reviewer-calibration.md](perf-reviewer-calibration.md) — the review agent built on these catalogs, and how it scored on known samples.
- [../postgresql-mvcc-xid-wraparound-deep-dive.md](../postgresql-mvcc-xid-wraparound-deep-dive.md) — why dead rows stay and what holds the cleanup horizon back, for the held-open transaction note.
- [../case-hot-partition.md](../case-hot-partition.md) — a sourced hot-partition case, for `partition-key-skew`.
- [../optimization/caching.md](../optimization/caching.md) — caching with Redis and expiry strategy.
- [../database-query-performance.md](../database-query-performance.md) — query and data-path performance in depth.
