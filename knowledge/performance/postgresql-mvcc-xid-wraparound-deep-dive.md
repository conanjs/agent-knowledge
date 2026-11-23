---
schema: deep-dive/v1
topic: performance
status: verified
applies-to: ["PostgreSQL 19 (manual at docs/19, source tag REL_19_0)", "Amazon RDS for PostgreSQL user guide, read 2026-11-22", "practitioner and incident reports 2015-2025, release named per claim"]
last-updated: 2026-11-23
last-verified: 2026-11-23
synthesized-into: []
tags: [postgresql, mvcc, vacuum, autovacuum, freezing, transaction-id-wraparound, multixact, monitoring, incident]
ranked-sources: true
---

# PostgreSQL MVCC and transaction ID wraparound prevention

## Summary
**TL;DR:** PostgreSQL implements multi-version concurrency control (MVCC) by creating copies (versions) of tuples as they are modified and removing the old versions once the transactions that can see them have ended ✅[^pg-gloss]. Transaction IDs (XIDs) are 32 bits wide, and normal XIDs are compared with modulo-2^32 arithmetic, so it is necessary to vacuum every table in every database at least once every two billion transactions; in PostgreSQL 19 the server starts warning when the oldest XIDs are one hundred million transactions from the wraparound point and refuses to assign new XIDs once fewer than three million are left ✅[^pg-vac]. Preventing wraparound therefore means letting VACUUM freeze old rows, watching XID age, and removing whatever holds the oldest XID back.

**Use this when:** you need to explain why PostgreSQL keeps dead rows and needs VACUUM; you set or review the freezing settings; you build XID-age monitoring or alerts; a server logs "must be vacuumed within … transactions" or refuses to assign transaction IDs; you suspect MultiXact (shared row-lock) exhaustion.

**Depth:** snapshot visibility rules from the PostgreSQL 19 source; the 32-bit XID circle, freezing and the special XIDs; normal, eager and aggressive vacuums; every freezing setting with default, range and effective cap; the escalation from forced autovacuum to failsafe, warning and hard stop, with thresholds and message texts; the manual's recovery procedure; what holds the XID horizon back; MultiXacts; monitoring queries with output, alert thresholds and two incident reports (Sentry 2015, Metronome 2025); trade-offs, misconceptions and the conflicts between sources.

## 1. Mental model

**The problem.** In PostgreSQL an UPDATE or DELETE of a row does not immediately remove the old version: that version must not be deleted while it is still potentially visible to other transactions, and VACUUM later removes such dead row versions and marks their space for reuse ✅[^pg-vac].

**The thesis.** Visibility depends on comparing XIDs, and since XIDs have only 32 bits, a cluster that runs for more than 4 billion transactions would suffer transaction ID wraparound: transactions in the past suddenly appear to be in the future and their output becomes invisible, which the manual calls catastrophic data loss even though the data is still there ✅[^pg-vac]. Freezing is the cure: VACUUM marks rows as frozen once their inserting transaction committed far enough in the past that its effects are certain to be visible to all current and future transactions ✅[^pg-vac].

**Analogy.** Picture XIDs as times on a clock face with no date. You can say 11 o'clock came before 1 o'clock only if you know less than half a turn has passed. PostgreSQL makes the same bet with half of its 32-bit circle, about two billion transactions. Freezing replaces a row's time stamp with a permanent "long ago" label, so the clock no longer matters for that row. The concrete artifact an operator meets is the warning in §5.2: `database "mydb" must be vacuumed within 99985967 transactions`.

**Scope.** This doc follows the PostgreSQL 19 manual and the `REL_19_0` source tag; practitioner posts and incident reports carry their own dates and releases. Not covered: isolation levels beyond what a snapshot needs, and index-only scans (see [Database query performance](database-query-performance.md)); VACUUM tuning for bloat, HOT (heap-only tuple) updates and index bloat; MVCC in other databases.

## 2. Concept architecture

| Part | What it is |
|---|---|
| Row version (tuple) | One version of a row; old versions become dead row versions (§1) |
| `xmin`, `xmax` of a row | `xmin` is the row's insertion XID, visible as a system column; `xmax` is a field of the tuple header, where a multixact ID is stored whenever more than one transaction concurrently locks a row ✅[^pg-vac] |
| Transaction ID (XID) and epoch | The unique, sequentially assigned number a transaction receives when it first causes a database modification, only 32 bits wide on disk; a 32-bit epoch extends it, and in some contexts epoch and XID are considered together as a single 64-bit value ✅[^pg-gloss] |
| MVCC snapshot | A `SnapshotData` structure; the same structure also represents special snapshots with non-MVCC semantics ✅[^src-snap] |
| Visibility map | Two bits per page: all-visible (all tuples on the page are visible to all transactions) and all-frozen (all tuples on the page are marked frozen) ✅[^pg-gloss] |
| `relfrozenxid`, `datfrozenxid` | `pg_class.relfrozenxid` holds a table's oldest unfrozen XID left at the end of the last VACUUM that advanced it; `pg_database.datfrozenxid` is the minimum of those per-table values ✅[^pg-vac] |
| MultiXact ID (MXID), `relminmxid` | A multixact ID encodes lock information when more than one transaction locks a row at once; `pg_class.relminmxid` stores the oldest multixact ID that may still appear in the table ✅[^pg-vac] |
| Normal and aggressive vacuum | The two scanning strategies of VACUUM (§3.3) |
| Anti-wraparound autovacuum | The autovacuum forced by a table's XID age (§3.3) |
| Failsafe | VACUUM's last-resort mode (§3.4) |

How the parts relate (each arrow is explained in §3):

```
transaction --first write--> XID --stored as--> row xmin
statement --takes--> snapshot (xmin, xmax, xip) --tests--> row xmin / xmax --> visible or not
VACUUM --removes--> dead row versions
       --freezes--> old rows --advances--> relfrozenxid --minimum over tables--> datfrozenxid
oldest datfrozenxid --sets--> forced autovacuum, warnings, hard stop (§3.4)
```

A snapshot works like a photograph of the transaction list taken at one instant: whatever was still running, or had not started, when the photo was taken stays out of the picture.

## 3. How it works

### 3.1 Which row versions a snapshot sees

1. Under an MVCC snapshot a tuple is visible if and only if it is valid for that snapshot: the effects of all transactions committed as of the snapshot and of previous commands of the own transaction count, while transactions shown as in progress by the snapshot, transactions started after it was taken and changes made by the current command do not ✅[^src-snap].
2. The snapshot can never see the effects of XIDs at or above its `xmax` and can see all older XIDs except those listed in the snapshot: `xip` holds the in-progress XIDs (empty for a snapshot taken during recovery) and `subxip` the in-progress subtransaction IDs (and, for a snapshot taken during recovery, the other in-progress transactions); its `xmin` is stored as an optimization, so that most tuples need no search of the XID arrays ✅[^src-snap].
3. A non-vacuumable snapshot (`SNAPSHOT_NON_VACUUMABLE`) asks a different question: a tuple is visible if it might be visible to some transaction, and vacuumable if it is surely dead to everyone, judged against an xmin horizon ✅[^src-snap].

### 3.2 Why the horizon is about two billion

1. Normal XIDs are compared using modulo-2^32 arithmetic, so every normal XID has two billion older and two billion newer XIDs, and a row version created with a normal XID appears to be in the past for the next two billion transactions but suddenly appears to be in the future if it still exists after more than two billion ✅[^pg-vac].
2. `FrozenTransactionId` (2) does not follow the normal comparison rules and is always considered older than every normal XID, as is `BootstrapTransactionId` (1), which system catalogs may contain in rows inserted during the first phase of initdb; before PostgreSQL 9.4 freezing replaced the row's insertion XID with `FrozenTransactionId`, while newer versions set a flag bit and keep the original `xmin` for forensic use ✅[^pg-vac].
3. When the counter reaches the maximum XID value it starts over at 3, because the values under that are reserved, and the epoch is incremented by one ✅[^pg-gloss].
4. The server's own limit arithmetic puts the point of real trouble, `xidWrapLimit`, halfway around the XID space from the oldest `datfrozenxid` (`oldest_datfrozenxid + (MaxTransactionId >> 1)`), and its comment notes that the special XIDs make the loop a little smaller ✅[^src-xid].

### 3.3 How freezing advances `relfrozenxid`

1. VACUUM uses the visibility map to choose pages and normally skips pages without dead row versions even if they hold old XIDs, so normal VACUUMs won't always freeze every old row version; a normal vacuum may also eagerly scan some all-visible but not all-frozen pages to freeze them, which reduces the pages the next aggressive vacuum must scan ✅[^pg-vac].
2. An aggressive vacuum freezes all eligible unfrozen XID and MXID values, and `relfrozenxid` advances only when every page that might contain unfrozen XIDs is scanned: when `relfrozenxid` is more than `vacuum_freeze_table_age` old, when VACUUM's FREEZE option is used, or when all pages not already all-frozen happen to need vacuuming ✅[^pg-vac].
3. A table can go unvacuumed for at most two billion transactions minus the `vacuum_freeze_min_age` of its last aggressive vacuum, so autovacuum is invoked on any table that might contain unfrozen XIDs older than `autovacuum_freeze_max_age`, even if autovacuum is disabled; unlike a normal autovacuum, this one is not automatically interrupted by a conflicting lock request, and it shows `(to prevent wraparound)` at the end of its query in `pg_stat_activity`, or `autovacuum_wraparound` in the `started_by` column of `pg_stat_progress_vacuum` ✅[^pg-vac].
4. The autovacuum launcher gives priority to databases at risk of XID or multixact ID wraparound, and within a database PostgreSQL 19 scores tables, with an XID component that increases greatly once a table's age passes `vacuum_failsafe_age`; before PostgreSQL 19, tables were taken in the order `pg_class` lists them ✅[^pg-vac].

### 3.4 Escalation as the oldest XID ages

The checks run each time a backend asks for a new XID, against limits computed from the oldest `datfrozenxid`:

1. **Forced autovacuum, warning, stop.** Past `xidVacLimit` (`oldest_datfrozenxid + autovacuum_freeze_max_age`) the backend signals the postmaster to start the autovacuum launcher, once every 65,536 XIDs; past `xidWarnLimit` (`xidWrapLimit - 100000000`, a limit the source says it will not make configurable) it logs a WARNING; past `xidStopLimit` (`xidWrapLimit - 3000000`) it raises an ERROR, but only under the postmaster, which leaves single-user mode as an escape hatch for the database administrator (DBA) ✅[^src-xid].
2. **Failsafe.** When a table's `relfrozenxid` reaches `vacuum_failsafe_age`, VACUUM stops applying any cost-based delay, bypasses further non-essential maintenance such as index vacuuming, and disables any Buffer Access Strategy, so it may use all of shared buffers ✅[^pg-conf].
3. In the `REL_19_0` source the failsafe also bypasses heap vacuuming and heap truncation, is checked each time VACUUM scans another 4GB of pages, and logs a WARNING that it is bypassing nonessential maintenance of the table because its `relfrozenxid` or `relminmxid` is too far in the past ✅[^src-vac].
4. **The stopped state.** Once fewer than three million XIDs are left, transactions already in progress can continue, only read-only transactions can be started, operations that modify database records or truncate relations fail, and the VACUUM command can still be run normally ✅[^pg-vac].

### 3.5 What holds the oldest XID back

1. The manual's recovery steps name the holders and where to find them: old prepared transactions in `pg_prepared_xacts` (large `age(transactionid)`), long-running open transactions in `pg_stat_activity` (large `age(backend_xid)` or `age(backend_xmin)`), and old replication slots in `pg_replication_slots` (large `age(xmin)` or `age(catalog_xmin)`) ✅[^pg-vac].
2. pganalyze adds that with `hot_standby_feedback` on, queries on a standby hold back the xmin horizon as if they ran on the primary and a lagging or stale replica's physical slot can leave it stuck, that a logical-replication subscriber stopped by a schema mismatch holds back the publisher's system-catalog xmin until replication resumes, and that a long transaction in one database does not stop the cleanup of tables in another ✅[^pganalyze].
3. Read-only transactions count too (§6.3, misconception 7).

### 3.6 MultiXacts, a second 32-bit counter

1. The members of a multixact are stored separately in `pg_multixact`, with only the multixact ID in the tuple's `xmax`; multixact IDs are a 32-bit counter like XIDs, and MXIDs have the same margins, a warning one hundred million from the wraparound point and a refusal below three million, but MXID exhaustion blocks only writes whose row locks need an MXID, while XID exhaustion blocks all writes ✅[^pg-vac].
2. Inserting a child row takes `SELECT … FOR KEY SHARE` on the referenced parent row, so concurrent inserts lock parent rows and those locks become MultiXacts; savepoints do the same when different sub-transactions lock or modify the same row, and every PL/pgSQL EXCEPTION clause creates a savepoint ✅[^aws-mxact].
3. MultiXacts are immutable, so each new share-locker of a row creates a new MultiXact holding all earlier members: quoting PostgreSQL developer Thomas Munro, n lockers make n - 1 multixacts and (n * (n + 1)) / 2 - 1 members, for example 4 MultiXacts with 14 members for 5 transactions ✅[^metronome].
4. Whenever VACUUM scans part of a table it replaces multixact IDs older than `vacuum_multixact_freeze_min_age`; a `relminmxid` older than `vacuum_multixact_freeze_table_age` forces an aggressive vacuum, a multixact age above `autovacuum_multixact_freeze_max_age` forces one even if autovacuum is nominally disabled, and once member entries exceed approximately 2 billion (roughly 10GB in `pg_multixact/members`) aggressive scans occur more often for all tables, oldest first ✅[^pg-vac].

## 4. Worked examples

### 4.1 A snapshot decision, step by step

An illustration of the rules in §3.1, not taken from a source: a snapshot with `xmin` 100, `xmax` 105 and `xip` [102] tests rows by their inserting XID.

| Row `xmin` | Rule applied | Seen? |
|---|---|---|
| 99 | below `xmin` | yes, if it committed |
| 102 | listed in `xip` (in progress) | no |
| 104 | below `xmax`, not listed | yes, if it committed |
| 106 | at or above `xmax` | no |

### 4.2 The server's limit arithmetic, run

```c verify id=probe-01 runtime=c expect=stdout:pct=4.66%
#include <stdio.h>
#include <stdint.h>

int main(void) {
    /* Assumption: MaxTransactionId is the 32-bit maximum (its definition is not in this doc's sources). */
    const uint32_t MaxTransactionId = 0xFFFFFFFFu;
    const uint32_t oldest_datfrozenxid = 1000u;  /* any normal XID */
    uint32_t xidWrapLimit = oldest_datfrozenxid + (MaxTransactionId >> 1); /* varsup.c */
    uint32_t xidStopLimit = xidWrapLimit - 3000000u;                       /* varsup.c */
    uint32_t xidWarnLimit = xidWrapLimit - 100000000u;                     /* varsup.c */
    printf("warn_age=%u stop_age=%u wrap_age=%u\n",
           xidWarnLimit - oldest_datfrozenxid, xidStopLimit - oldest_datfrozenxid,
           xidWrapLimit - oldest_datfrozenxid);
    uint32_t left = 99985967u;                   /* the manual's sample warning */
    printf("left=%u pct=%.2f%%\n", left, (double) left / (MaxTransactionId / 2) * 100);
    return 0;
}
```

On one run (gcc in the harness's `linlab:1` image, kernel 7.2.12-orbstack), the `varsup.c` formulas with `MaxTransactionId` taken as 4,294,967,295 printed `warn_age=2047483647 stop_age=2144483647`, a hard stop at an XID age of about 2.14 billion, and, for 99,985,967 XIDs left, `pct=4.66%`, the figure in the DETAIL line of the manual's sample warning ✅[^probe-01][^pg-vac].

### 4.3 The circle, run

```c verify id=probe-02 runtime=c expect="stdout:after 2.2e9: future"
#include <stdio.h>
#include <stdint.h>

/* a counts as older than b when the 32-bit difference a - b, read as signed, is negative */
static int older(uint32_t a, uint32_t b) { return (int32_t) (a - b) < 0; }

int main(void) {
    uint32_t row = 100u;  /* a row's insertion XID */
    printf("after 2.0e9: %s\n", older(row, row + 2000000000u) ? "past" : "future");
    printf("after 2.2e9: %s\n", older(row, row + 2200000000u) ? "past" : "future");
    printf("4294967000 vs 100: %s\n", older(4294967000u, 100u) ? "older" : "newer");
    return 0;
}
```

On one run (gcc in the harness's `linlab:1` image, kernel 7.2.12-orbstack), comparing by the sign of the 32-bit difference printed that a row stamped XID 100 is still in the past 2.0 billion XIDs later but in the future 2.2 billion later, and that XID 4294967000 counts as older than XID 100; this C function illustrates the circle the manual describes and is not PostgreSQL's own comparison code ✅[^probe-02].

### 4.4 Monitoring queries with output

The manual's two queries report the age of each table, taking the older of the table and its TOAST table (linked through `reltoastrelid`), and of each database; the age is the number of transactions from the cutoff XID to the current transaction's XID ✅[^pg-vac].

```sql
SELECT c.oid::regclass AS table_name,
       greatest(age(c.relfrozenxid), age(t.relfrozenxid)) AS age
FROM pg_class c
LEFT JOIN pg_class t ON c.reltoastrelid = t.oid
WHERE c.relkind IN ('r', 'm');

SELECT datname, age(datfrozenxid) FROM pg_database;
```

In Crunchy Data's worked example, the per-database query returned `postgres` at 170,604,895 and `mydb` at 169,088,197 against an `autovacuum_freeze_max_age` of 200000000, and the per-table query over relkinds `r`, `t` and `m` outside the `pg_toast` schema listed `pg_proc` first at 170,606,208 (936 kB) ✅[^crunchy].

```
 datname   |    age    | current_setting
-----------+-----------+-----------------
 postgres  | 170604895 | 200000000
 mydb      | 169088197 | 200000000
 template0 | 142915024 | 200000000
 template1 | 142914999 | 200000000
```

The PostgreSQL 19 manual shows `pg_get_multixact_stats()` reporting multixact usage, with a sample of 311,740,299 multixact IDs and 2,785,241,176 member entries in 13 GB ✅[^pg-vac].

pganalyze finds the holders of §3.5 with `pg_stat_activity` ordered by `greatest(age(backend_xmin), age(backend_xid))`, `pg_stat_replication` ordered by `age(backend_xmin)` for standbys and `pg_prepared_xacts` ordered by `age(transaction)`, and ends them with `pg_cancel_backend` (active query) or `pg_terminate_backend` (idle in transaction), both of which roll the transaction back, or with `COMMIT PREPARED` / `ROLLBACK PREPARED` ✅[^pganalyze].

### 4.5 Alert thresholds in use

1. The AWS (Amazon Web Services) RDS user guide's sample strategy sets `autovacuum_freeze_max_age` to 200 million, raises a low-severity alarm when a table reaches 500 million unfrozen transactions, treats 1 billion as an alarm to take action on, and raises a high-severity alarm at 1.5 billion that it recommends resolving immediately ✅[^aws-rds].
2. Crunchy Data alerts on `percent_towards_wraparound` (age against 2 billion), whose 100% should be acted upon immediately, and on `percent_towards_emergency_autovac`, which watches for a table reaching `autovacuum_freeze_max_age` ✅[^crunchy].
3. pganalyze checks every 30 minutes and by default raises a warning when the server's xmin horizon was assigned more than 24 hours ago, even if no VACUUM is blocked yet ✅[^pganalyze].

### 4.6 Incident: Sentry, July 2015 (XID exhaustion)

Sentry's hosted service was down for most of the US working day on Monday, July 20 (2015), running read-only with replicas serving reads; the team let the running autovacuums finish rather than restart, one of them failed or did nothing with no trace in the non-verbose logs, and with every relation but one huge event-mapping table vacuumed, truncating that table restored the system five minutes later ✅[^sentry]. Sentry named as causes too high an `autovacuum_freeze_max_age`, the default of 3 autovacuum workers and far too much vacuum delay, and moved to `autovacuum_freeze_max_age = 500000000`, `autovacuum_max_workers = 6`, `autovacuum_naptime = '15s'`, `autovacuum_vacuum_cost_delay = 0`, `maintenance_work_mem = '10GB'` and `vacuum_freeze_min_age = 10000000` ✅[^sentry].

### 4.7 Incident: Metronome, May 2025 (MultiXact members, Aurora PostgreSQL 13.18)

Metronome had four outages between May 10 and May 17, 2025, each lasting over an hour, that severely impacted write operations on an AWS Aurora PostgreSQL 13.18 cluster exceeding 30TB: crossing a global limit on MultiXact members triggered emergency vacuums and PostgreSQL's defensive lockout of write operations until they completed, a recovery that takes several hours for their larger tables ✅[^metronome]. Misconception 5 (§6.3) gives what their monitoring missed.

## 5. Reference & invariants

### 5.1 Freezing settings (PostgreSQL 19)

The PostgreSQL 19 manual does not state the release that introduced each setting.

1. **XID settings.** `vacuum_freeze_min_age` is the cutoff age for freezing pages with an older XID (default 50 million, settable from zero to one billion, silently limited to half of `autovacuum_freeze_max_age`); `vacuum_freeze_table_age` is the `relfrozenxid` age at which VACUUM scans aggressively (default 150 million, zero to two billion, silently limited to 95% of `autovacuum_freeze_max_age`); `autovacuum_freeze_max_age` forces a VACUUM to prevent wraparound even when autovacuum is otherwise disabled (default 200 million, can only be set at server start, can be reduced per table through storage parameters); `vacuum_failsafe_age` defaults to 1.6 billion, accepts zero to 2.1 billion and is silently adjusted to no less than 105% of `autovacuum_freeze_max_age` ✅[^pg-conf].
2. **MultiXact settings.** `autovacuum_multixact_freeze_max_age` defaults to 400 million multixacts and can only be set at server start; `vacuum_multixact_freeze_table_age` defaults to 150 million (zero to two billion, limited to 95% of `autovacuum_multixact_freeze_max_age`); `vacuum_multixact_freeze_min_age` defaults to 5 million (zero to one billion, limited to half of it); `vacuum_multixact_failsafe_age` defaults to 1.6 billion (zero to 2.1 billion, no less than 105% of it), and when that failsafe triggers, cost-based delay stops and non-essential tasks are bypassed ✅[^pg-conf].
3. **Eager freezing.** `vacuum_max_eager_freeze_failure_rate` is the fraction of pages VACUUM may scan and fail to set all-frozen before it disables eager scanning: 0 disables eager scanning, the default is 0.03 (3%), and successful eager freezes are capped internally at 20% of the all-visible but not all-frozen pages ✅[^pg-conf].

### 5.2 Messages (`REL_19_0`)

```
WARNING: database "mydb" must be vacuumed within 99985967 transactions
DETAIL: Approximately 4.66% of transaction ID space remains before wraparound.
HINT: To avoid transaction ID assignment failures, execute a database-wide VACUUM in that database.
You might also need to commit or roll back old prepared transactions, or drop stale replication slots.

ERROR: database is not accepting commands that assign new transaction IDs to avoid wraparound data loss in database "mydb"
HINT: Execute a database-wide VACUUM in that database.
You might also need to commit or roll back old prepared transactions, or drop stale replication slots.
```

The `REL_19_0` source builds these messages (the values above are the manual's sample), raises the error with code `ERRCODE_PROGRAM_LIMIT_EXCEEDED`, and gives each hint a second line about prepared transactions and replication slots, which the manual's printed samples leave out ✅[^src-xid][^pg-vac].

### 5.3 Rules

1. **Recovery, steps 1-3.** Resolve old prepared transactions, which should be committed or rolled back; end long-running open transactions, which should be committed or rolled back, or whose session can be terminated with `pg_terminate_backend`; drop old replication slots, knowing that if a slot's server still exists and might still connect to it, that replica may need to be rebuilt ✅[^pg-vac].
2. **Recovery, step 4 onward.** Execute VACUUM in the target database, database-wide (simplest) or on the tables with the oldest XIDs, and the VACUUM should be performed by a superuser, else it fails to process system catalogs and cannot advance `datfrozenxid`; do not use VACUUM FULL, which requires an XID and will therefore fail, except in what the manual calls super-user mode, where it consumes an XID and increases the risk of wraparound; do not use VACUUM FREEZE either, because it does more than the minimum work; once normal operation is restored, ensure that autovacuum is properly configured in the target database ✅[^pg-vac].
3. **No single-user mode by default.** Stopping the postmaster or entering single-user mode is not necessary or desirable to restore normal operation: in typical scenarios it should be avoided whenever possible, since it takes the system down and disables the wraparound safeguards, and its only use here is to TRUNCATE or DROP unneeded tables, which the three-million-transaction margin exists for ✅[^pg-vac].
4. **MXID exhaustion.** The same steps apply, except that running and prepared transactions can be ignored when they cannot appear in a multixact, and replication slots do not directly hold back multixact cleanup ✅[^pg-vac].
5. **Per-table settings and temporary tables.** Autovacuum thresholds and many other autovacuum parameters can be overridden per table through storage parameters, and for insert-mostly tables it may be beneficial to lower the table's `autovacuum_freeze_min_age`; temporary tables cannot be accessed by autovacuum, so they should be vacuumed and analyzed through session SQL commands ✅[^pg-vac].

## 6. Trade-offs, pitfalls & misconceptions

### 6.1 Trade-offs

1. **Raising `autovacuum_freeze_max_age`.** Its sole disadvantage is more space in `pg_xact` and `pg_commit_ts` (about half a gigabyte and 20GB at the maximum of two billion, against about 50MB and 2GB at the default), and the manual recommends the maximum when that is trivial against the database size; one disadvantage of lowering `vacuum_freeze_min_age` is that VACUUM might do useless work, freezing rows that are modified soon after ✅[^pg-vac].
2. **What practitioners choose.** AWS's sample keeps 200 million (§4.5) and Sentry moved to 500 million (§4.6), while for databases with a high transaction rate Crunchy Data's author has often set 1 billion, but only when sure wraparound is monitored and the disk space is available ✅[^crunchy].
3. **Cancelling an anti-wraparound autovacuum.** Crunchy Data's author calls it perfectly safe to cancel the emergency vacuum when it causes lock contention, but it keeps restarting until that vacuum completes or a manual vacuum is run ✅[^crunchy]. Sentry, already past the stop, chose to let its autovacuums finish (§4.6).

### 6.2 Pitfalls

1. **Lock conflicts starve autovacuum.** A lock request that conflicts with a normal autovacuum's SHARE UPDATE EXCLUSIVE lock interrupts it, and regularly running such commands, ANALYZE for example, can effectively prevent autovacuums from ever completing ✅[^pg-vac].
2. **Silent vacuums.** Sentry could not tell why one autovacuum failed (§4.6); `VACUUM VERBOSE`, and autovacuum logging controlled by `log_autovacuum_min_duration`, report how `relfrozenxid` and `relminmxid` advanced and how many pages were newly frozen ✅[^pg-vac].
3. **Memory that is never used.** Sentry later found that `maintenance_work_mem` had a hard internal limit of 1GB for the relevant paths, so its much larger setting was not used ✅[^sentry].
4. **A second MultiXact limit.** Metronome, on Aurora PostgreSQL 13.18, describes a hard limit of approximately 4 billion members across all MultiXacts and says PostgreSQL exposes no metric for member space consumption ✅[^metronome]. The PostgreSQL 19 manual instead describes a members storage that cannot wrap around but must be managed to keep disk usage under control ✅[^pg-vac], and documents `pg_get_multixact_stats()` (§4.4).

### 6.3 Misconceptions

1. **"At wraparound PostgreSQL shuts down."** Percona's 2022 post says the service is forced to shut down and quotes a hint reading "To avoid a database shutdown", and Crunchy Data's 2019 post says the database will be forced to shut down ✅[^percona][^crunchy]. That is wrong for PostgreSQL 19: the server refuses to assign new XIDs, while read-only transactions can still start and VACUUM can still be run (§3.4), and the `REL_19_0` hint reads "To avoid transaction ID assignment failures" ✅[^pg-vac][^src-xid].
2. **"Warnings start 10 million and writes stop 1 million before the limit."** Percona gives a countdown from 10 million and read-only mode at 1 million, and Sentry says commands stop with fewer than one million left ✅[^percona][^sentry]. In PostgreSQL 19 the warning starts 100,000,000 and the stop 3,000,000 transactions before `xidWrapLimit` ✅[^src-xid]; neither post names the release its numbers come from.
3. **"Recover in single-user mode."** Percona's recovery procedure is a cluster-wide VACUUM in single-user mode (`postgres --single`), and Sentry cites restarting in single-user mode as general advice ✅[^percona][^sentry]. The PostgreSQL 19 manual says this was sometimes recommended in earlier releases and is not necessary or desirable now, since in the stopped state the VACUUM command can still be run normally (§5.3, rule 3) ✅[^pg-vac].
4. **"Turning autovacuum off, or running it only at quiet times, is a safe way to save load."** Sentry calls such advice awful, and Percona lists autovacuum turned off among the causes of wraparound ✅[^sentry][^percona]. Turning autovacuum off does not stop the anti-wraparound runs, because the system launches autovacuum processes to prevent wraparound even when autovacuum is otherwise disabled ✅[^pg-conf].
5. **"MultiXact IDs well under their threshold mean MultiXacts are safe."** Metronome's metrics showed MultiXact ID use below 50% of the threshold, and emergency vacuums began at around 200 million MultiXact IDs although `autovacuum_multixact_freeze_max_age` was 400 million, because the separate member space limit was hit first ✅[^metronome]. Member entries are a second budget, separate from MXID age: once multixact member entries exceed approximately 2 billion, PostgreSQL 19 runs aggressive vacuum scans more often for all tables (§3.6), and `pg_get_multixact_stats()` reports the member count and size (§4.4) ✅[^pg-vac].
6. **"A plain VACUUM cleans up finished MultiXacts."** In the AWS Database Blog demo a standard VACUUM left the MultiXact in the row's `xmax`, because it only releases MultiXact IDs older than `vacuum_multixact_freeze_min_age`, and only VACUUM FREEZE cleared it ✅[^aws-mxact].
7. **"Only transactions that write hold vacuum back."** Read-only transactions do too: vacuum must retain the information they may need until they close, for both XIDs and MultiXacts ✅[^aws-mxact].
8. **"VACUUM FULL is the strong fix."** The standard VACUUM does not return space to the operating system, except when pages at the end of a table become entirely free and an exclusive table lock can be easily obtained, while VACUUM FULL rewrites the whole table, can take a long time and needs extra disk space for the new copy; in the stopped state it fails because it requires an XID, except in super-user mode, where it consumes one and increases the risk of wraparound (§5.3, rule 2) ✅[^pg-vac]. VACUUM FULL also requires an ACCESS EXCLUSIVE lock on the table it is working on, so it cannot run in parallel with other use of the table, and the manual's advice is to strive to use standard VACUUM and avoid VACUUM FULL ✅[^pg-vac]. A job that runs VACUUM FULL on a schedule therefore locks the table on every run; what prevents wraparound is the standard VACUUM and autovacuum setup of §3 and §5.

### 6.4 Conflicts between sources

1. **Where the counter restarts.** The wraparound paragraph of the manual says the XID counter "wraps around to zero" ✅[^pg-vac]. The glossary says it starts over at 3, and the `REL_19_0` source's note that the special XIDs make the loop smaller agrees (§3.2), so this doc follows the glossary and reads "zero" as loose wording.
2. **What a row's XID is compared with.** The manual motivates XID comparison with a row whose insertion XID is greater than the current transaction's XID being "in the future" ✅[^pg-vac]. Both are Rank 1 sources; this doc's §3.1 follows `snapshot.h`, which states the test against the snapshot's `xmin`, `xmax` and `xip`, because that is the code that decides, and reads the manual's sentence as the reason XIDs must stay comparable.
3. **"Read-only at 2 billion."** The AWS RDS user guide says that when a database's age reaches 2 billion transaction IDs, wraparound occurs and the database becomes read-only ✅[^aws-rds]. Both it and the manual are Rank 1; the `REL_19_0` source settles it: the stop comes 3 million before a point halfway round the circle, an age of about 2.14 billion on the run in §4.2, so "2 billion" is a round figure.
4. **What triggers aggressive MultiXact vacuums.** The AWS Database Blog says aggressive VACUUMs are invoked when the storage occupied by MultiXacts exceeds 10 GB ✅[^aws-mxact]. The manual (Rank 1) words it as member entries exceeding approximately 2 billion, roughly 10GB, after which aggressive scans occur more often (§3.6); this doc follows the manual.
5. **Can VACUUM process a TOAST table on its own?** Percona's author, replying in the post's comments, says vacuum cannot operate on TOAST tables alone, so the owning table must be vacuumed (Rank 4) ✅[^percona]. A reader on the same page answers that autovacuum processes TOAST tables independently, that a manual VACUUM on the TOAST table worked, and that its `relfrozenxid` appears to be maintained separately (a reader comment, Rank 6) ✅[^percona]. By rank the author's reply outranks the reader comment, so this doc states neither as a rule in §1-§5; the reader's side holds as a first-hand report of their own runs, no saved Rank 1 page settles whether VACUUM accepts a TOAST table directly, and the manual's monitoring query (§4.4) does read the TOAST table's own `relfrozenxid`.

## References

- [24.1. Routine Vacuuming](https://www.postgresql.org/docs/19/routine-vacuuming.html) — PostgreSQL Global Development Group, PostgreSQL 19 manual, 2026. Rank 1. Backs: MVCC and dead row versions, the XID circle, freezing, special XIDs, relfrozenxid and datfrozenxid, aggressive and anti-wraparound vacuums, warning and stop thresholds, recovery steps, MultiXacts, monitoring queries, autovacuum prioritization. [^pg-vac]
- [Appendix M. Glossary](https://www.postgresql.org/docs/19/glossary.html) — PostgreSQL Global Development Group, PostgreSQL 19 manual, 2026. Rank 1. Backs: MVCC, transaction ID, epoch and restart at 3, visibility map bits. [^pg-gloss]
- [19.10. Vacuuming (server configuration)](https://www.postgresql.org/docs/19/runtime-config-vacuum.html) — PostgreSQL Global Development Group, PostgreSQL 19 manual, 2026. Rank 1. Backs: freezing settings with defaults, ranges and caps; the failsafe. [^pg-conf]
- [src/include/utils/snapshot.h at REL_19_0](https://github.com/postgres/postgres/blob/REL_19_0/src/include/utils/snapshot.h) — PostgreSQL source, tag REL_19_0, 2026. Rank 1. Backs: MVCC snapshot rules, xmin, xmax and xip, non-vacuumable snapshots. [^src-snap]
- [src/backend/access/heap/vacuumlazy.c at REL_19_0](https://github.com/postgres/postgres/blob/REL_19_0/src/backend/access/heap/vacuumlazy.c) — PostgreSQL source, tag REL_19_0, 2026. Rank 1. Backs: failsafe behaviour, its 4GB check interval and warning. [^src-vac]
- [src/backend/access/transam/varsup.c at REL_19_0](https://github.com/postgres/postgres/blob/REL_19_0/src/backend/access/transam/varsup.c) — PostgreSQL source, tag REL_19_0, 2026. Rank 1. Backs: xidVacLimit, xidWarnLimit, xidStopLimit and xidWrapLimit, message texts, the single-user escape. [^src-xid]
- [Determining if the tables in your database need vacuuming](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Autovacuum.NeedVacuuming.html) — Amazon Web Services, Amazon RDS User Guide, read 2026. Rank 1. Backs: alert thresholds, the "read-only at 2 billion" claim. [^aws-rds]
- [Transaction ID Wraparound in Postgres](https://blog.sentry.io/transaction-id-wraparound-in-postgres) — Sentry (David Cramer), 2015. Rank 4. Backs: the July 2015 incident, its causes and new settings, the 1GB maintenance_work_mem note. [^sentry]
- [Managing Transaction ID Exhaustion (Wraparound) in PostgreSQL](https://www.crunchydata.com/blog/managing-transaction-id-wraparound-in-postgresql) — Crunchy Data (Keith Fiske), 2019. Rank 4. Backs: PGmonitor alert metrics, per-database and per-table output, 1 billion setting, cancelling the emergency vacuum. [^crunchy]
- [VACUUM: Bloat - VACUUM Blocked by Xmin Horizon](https://pganalyze.com/docs/checks/vacuum/xmin_horizon) — pganalyze, living docs, read 2026. Rank 4. Backs: xmin horizon holders, queries and remedies, the 24-hour check. [^pganalyze]
- [Root Cause Analysis: PostgreSQL MultiXact member exhaustion incidents (May 2025)](https://metronome.com/blog/root-cause-analysis-postgresql-multixact-member-exhaustion-incidents-may-2025) — Metronome, 2025. Rank 4. Backs: the May 2025 incident, MultiXact member growth, member-limit observations. [^metronome]
- [MultiXacts in PostgreSQL: usage, side effects, and monitoring](https://aws.amazon.com/blogs/database/multixacts-in-postgresql-usage-side-effects-and-monitoring) — AWS Database Blog (Shawn McCoy, Divya Sharma), 2024, updated 2025. Rank 4. Backs: what creates MultiXacts, plain VACUUM vs VACUUM FREEZE demo, read-only transactions, the 10 GB trigger wording. [^aws-mxact]
- [Overcoming VACUUM WRAPAROUND](https://www.percona.com/blog/overcoming-vacuum-wraparound/) — Percona (Robert Bernier), 2022. Rank 4. Backs: the shutdown, 10 million / 1 million and single-user claims; the TOAST exchange in the comments. [^percona]
- The `probe-01` block (`probes/probe-01.c` once `run-code-harness.mjs` extracts it) — verify, c (gcc in the harness's linlab:1 image, Docker 29.8.2, kernel 7.2.12-orbstack-00394-gbecdd6130068), prints `warn_age=2047483647 stop_age=2144483647 wrap_age=2147483647` and `pct=4.66%`. [^probe-01]
- The `probe-02` block (`probes/probe-02.c` once `run-code-harness.mjs` extracts it) — verify, c (gcc in the harness's linlab:1 image, Docker 29.8.2, kernel 7.2.12-orbstack-00394-gbecdd6130068), prints `after 2.0e9: past`, `after 2.2e9: future` and `4294967000 vs 100: older`. [^probe-02]

## Related

- [Database query performance](database-query-performance.md) — isolation-level retries, index-only scans and the visibility map's role in query plans.
