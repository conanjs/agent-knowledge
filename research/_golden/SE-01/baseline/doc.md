---
schema: deep-dive/v1
topic: databases
status: draft
applies-to: ["PostgreSQL 18 (lab runs on 18.3)", "PostgreSQL 19 (from its documentation and release notes)"]
last-updated: 2026-11-23
last-verified: 2026-11-23
synthesized-into: []
tags: [postgresql, mvcc, snapshot, isolation, vacuum, autovacuum, freezing, transaction-id-wraparound, multixact, replication-slot]
---

# PostgreSQL MVCC and transaction ID wraparound, end to end

## Summary
**TL;DR:** PostgreSQL implements MVCC (multiversion concurrency control) by never changing a row in place: each write stamps row versions with 32-bit transaction IDs (XIDs) in their `xmin` and `xmax` fields, and each statement's snapshot decides which versions it sees, so reading and writing do not block each other. The price is maintenance: VACUUM must remove dead versions and **freeze** old ones, because XIDs are compared on a circle of 2³² values and a version older than about 2.1 billion XIDs would suddenly look as if it were in the future. When freezing falls behind, PostgreSQL warns (40 million XIDs before the wrap point in version 18, 100 million in version 19) and then refuses to hand out new XIDs 3 million before it. Prevention means keeping autovacuum able to finish and removing whatever holds the oldest XID back: long or forgotten transactions, prepared transactions and replication slots.
**Use this when:** you need the full model of row versions, snapshots and VACUUM; you set up monitoring or tuning for freezing; or a server logs `must be vacuumed within … transactions` or refuses writes `to avoid wraparound data loss`.
**Depth:** tuple header fields and flag bits read from a real page; XID assignment, snapshots and isolation levels; the visibility rule and hint bits; HOT updates and pruning; VACUUM and the xmin horizon; multixacts; freezing, `relfrozenxid` / `datfrozenxid` and the full threshold ladder from `vacuum_freeze_min_age` to the stop limit, for PostgreSQL 18 and 19; every freezing-related setting with its default, clamp and "unset" behaviour; cross-actor interactions; a lab cluster driven past the stop limit by a forgotten replication slot and recovered; a prevention playbook, an emergency runbook, a failure matrix and misconceptions; verified (✅) and unverified (⚠️) marks.

## 1. Context

### 1.1 MVCC in one picture

PostgreSQL keeps data consistent with a multiversion model: each SQL statement sees a snapshot of the data as it was at some earlier moment, whatever the current state is, so reading never blocks writing and writing never blocks reading ✅[^3]. It does this by keeping old row versions in the table itself: an `UPDATE` or `DELETE` does not remove the old version at once, because another transaction may still be able to see it, and VACUUM later reclaims the space ✅[^1]. Other MVCC databases split storage into the data and an undo log from which older versions are rebuilt ✅[^29].

**Analogy:** a paper ledger in which nobody erases. A clerk who changes a line crosses it out, writes their ticket number next to the cross, and adds a new line carrying the same ticket number. A reader who started at 10:00 ignores lines added by clerks who were still at work at 10:00, and still reads lines crossed out by them. From time to time somebody removes crossed-out lines that no reader can still need: that is VACUUM.

**Concrete artifact**, from the lab (PostgreSQL 18.3, `pageinspect` extension) ✅[^30]:
```text
INSERT in transaction 757:   ctid (0,1)  xmin 757  xmax 0    balance 100
UPDATE in transaction 758:   ctid (0,3)  xmin 758  xmax 0    balance 90    <- the version queries now return
raw page 0 still holds:      item 1      xmin 757  xmax 758  t_ctid (0,3)  <- the old version, kept for older snapshots
```

### 1.2 Why a 32-bit counter makes freezing mandatory

XIDs are 32 bits wide, so the counter wraps around after about 4 billion transactions ✅[^6]. Two normal XIDs are compared with modulo-2³² arithmetic: from any XID, about 2 billion others count as older and 2 billion as newer ✅[^1]. A row version left untouched for more than about 2 billion transactions would therefore flip from "long ago" to "in the future", and become invisible ✅[^1]. The cure is **freezing**: VACUUM marks such versions as visible to everyone, outside the XID comparison ✅[^1]. That is why every table in every database must be vacuumed at least once every 2 billion transactions ✅[^1].

**Analogy:** a wall clock with no date. If it is 5 o'clock now, a note saying "3 o'clock" means two hours ago; but a note older than 6 hours can no longer be placed: it could just as well mean the next 3 o'clock. Freezing writes "long ago" on the note, so the time on it stops mattering.

### 1.3 Why it matters in production

Two public post-mortems show the cost:

| Year | Service | What happened | How it ended |
|---|---|---|---|
| 2015 | A hosted error-tracking service | Autovacuum fell behind on very large, write-heavy tables; the settings included a high `autovacuum_freeze_max_age`, the default 3 autovacuum workers and a high vacuum cost delay. Writes stopped, and the team waited nearly three hours on autovacuum ✅[^27] | One large table whose data could be rebuilt was truncated; service returned about five minutes later. Afterwards: 6 workers, `autovacuum_vacuum_cost_delay = 0`, `autovacuum_naptime = 15s` among other changes ✅[^27] |
| 2019 | A transactional e-mail service | A skewed hash sent more writes to one shard, whose database reached the XID limit. The first logged error was buried among unrelated alerts ✅[^28] | A vacuum in standalone mode was estimated at days to weeks (worst case 40 days). Truncating two terabyte-scale tables let it finish about an hour later. Outage: 05:35 UTC on 4 Feb to 22:09 UTC on 5 Feb, that is 24 h + 16 h 34 min = 40 h 34 min ✅[^28] |

## 2. The actors

MVCC and wraparound protection involve 10 actors:

- **Client transaction** — its job: read and write rows, via SQL statements on one connection.
- **XID counter** — its job: hand out transaction IDs and enforce the warning and stop limits, via shared memory (saved in `pg_control` at each checkpoint).
- **Snapshot** — its job: say which transactions count as finished for a statement or a transaction, via its `xmin:xmax:xip` triple.
- **Tuple header** — its job: record which transaction created and which deleted a row version, via the fields `t_xmin`, `t_xmax`, `t_ctid` and `t_infomask`.
- **Commit log** — its job: record each XID's outcome, via 2 bits per transaction in the `pg_xact` directory.
- **VACUUM** — its job: remove dead versions, freeze old ones and advance each table's oldest-XID marker, via a scan of the table (a manual `VACUUM` or an autovacuum worker).
- **Autovacuum** — its job: start VACUUM on tables that need it, via one launcher process and worker processes driven by thresholds and ages.
- **Visibility map** — its job: remember which pages are all-visible and which are all-frozen, via 2 bits per table page.
- **Horizon holders** — their job: keep the versions an old reader may need, via their own `xmin` (open transactions, prepared transactions, replication slots, standbys sending feedback).
- **MultiXact manager** — its job: record several lockers of one row under one ID, via the `pg_multixact` directory.

Each actor's resting state, and what happens when it is absent:

| Actor | Default or resting state | When absent, unset or empty |
|---|---|---|
| Client transaction | Read Committed isolation ✅[^4]; gets only a virtual ID until its first write ✅[^6] | A read-only transaction never consumes an XID (lab: 10 reads, 0 XIDs) ✅[^30] |
| XID counter | Normal XIDs start at 3; 0 = invalid, 1 = bootstrap, 2 = frozen ✅[^17] | — (always present); the 64-bit form adds an epoch that grows at each wrap ✅[^6] |
| Snapshot | Taken per statement (Read Committed) or once per transaction (Repeatable Read) ✅[^4] | A transaction with no open snapshot no longer holds the horizon back (lab, §3.7) ✅[^30] |
| Tuple header | `xmax = 0` means "not deleted or locked" ✅[^5]; freshly inserted rows show it (lab) ✅[^30] | — |
| Commit log | Status "in progress" until commit or abort ✅[^7] | Status of very old XIDs is discarded; `pg_xact_status()` then returns NULL ✅[^7] |
| VACUUM | Plain `VACUUM`: no exclusive lock, space kept for reuse in the same table ✅[^18] | Dead versions accumulate (bloat) and nothing advances `relfrozenxid` ✅[^1] |
| Autovacuum | `autovacuum = on` ✅[^10] | With `off`, anti-wraparound vacuums still run ✅[^1] |
| Visibility map | Bits are set only by vacuum (and, in 19, by query scans) and cleared by any change to the page ✅[^9] ✅[^11] | An unset bit means "unknown", never "false" ✅[^9] |
| Horizon holders | None: `max_prepared_transactions = 0` and `hot_standby_feedback = off` ✅[^25] ✅[^24]; a fresh cluster has no replication slots ✅[^30] | — |
| MultiXact manager | Used only when two or more transactions lock the same row ✅[^1] | — |

## 3. How MVCC works

### 3.1 Row versions on the page

Every table is an array of fixed-size pages, usually 8 kB ✅[^5]. A page holds a 24-byte header, then 4-byte item identifiers ("line pointers"), then the row versions ("tuples") ✅[^5]. A tuple is addressed by its TID (tuple identifier) `(page, item)` ✅[^5], the value the `ctid` system column shows, such as `(0,3)` ✅[^30].

**Analogy for line pointers:** a table of contents printed at the top of each page. An index entry points at the table-of-contents line, not at the row's bytes, so the row can move within the page and only the line needs to change.

Each tuple starts with a header of 23 bytes on most machines ✅[^5]:

| Field | Size | Meaning ✅[^5] |
|---|---|---|
| `t_xmin` | 4 bytes | XID that inserted this version |
| `t_xmax` | 4 bytes | XID that deleted or locked it (0 if none) |
| `t_cid` / `t_xvac` | 4 bytes | Command ID (CID) of the insert and/or delete inside its transaction; overlays `t_xvac` |
| `t_ctid` | 6 bytes | TID of this version or of the newer version that replaced it |
| `t_infomask2` | 2 bytes | Number of columns, plus flag bits |
| `t_infomask` | 2 bytes | Flag bits |
| `t_hoff` | 1 byte | Offset to the column data |

Five logical fields (Xmin, Cmin, Xmax, Cmax, Xvac) share three physical ones; a version inserted and deleted by the same transaction stores a "combo" command ID that only the originating session can map back ✅[^13]. Both XID fields are 32 bits wide, and that is the root of wraparound.

The flag bits that matter for visibility ✅[^13]:

| Bit | Value | Meaning |
|---|---|---|
| `HEAP_XMIN_COMMITTED` | `0x0100` | Inserter known committed (a hint, §3.5) |
| `HEAP_XMIN_INVALID` | `0x0200` | Inserter known aborted |
| `HEAP_XMIN_FROZEN` | `0x0300` (both bits above) | Version is frozen (§4.2) |
| `HEAP_XMAX_COMMITTED` | `0x0400` | Deleter known committed |
| `HEAP_XMAX_INVALID` | `0x0800` | `xmax` is empty or its transaction aborted |
| `HEAP_XMAX_IS_MULTI` | `0x1000` | `xmax` is a MultiXact ID (§3.8) |
| `HEAP_XMAX_LOCK_ONLY` | `0x0080` | `xmax` only locked the row, did not delete it |
| `HEAP_UPDATED` | `0x2000` | This version was created by an `UPDATE` |
| `HEAP_HOT_UPDATED` (in `t_infomask2`) | `0x4000` | Replaced by a heap-only tuple (§3.6) |
| `HEAP_ONLY_TUPLE` (in `t_infomask2`) | `0x8000` | This is a heap-only tuple |

**Lab trace** (experiment 01): XID 757 inserts rows 1 and 2, XID 758 updates row 1's balance, XID 759 deletes row 2 ✅[^30]:
```text
 lp | lp_flags | t_xmin | t_xmax | t_ctid | infomask | infomask2
----+----------+--------+--------+--------+----------+-----------
  1 |        1 |    757 |    758 | (0,3)  | 502      | 4003        old version of row 1
  2 |        1 |    757 |    759 | (0,2)  | 502      | 2003        deleted row 2
  3 |        1 |    758 |      0 | (0,3)  | 2902     | 8003        current version of row 1
```
Reading the bits: item 1 has `0x0400 + 0x0100` (deleter and inserter both known committed) and `infomask2 = 0x4000 + 3` (HOT-updated, 3 columns); item 3 has `0x2000 + 0x0800 + 0x0100` (made by an UPDATE, no deleter, inserter committed) and `0x8000` (heap-only). The remaining `0x0002` bit describes the column layout (a variable-width column), not visibility ⚠️ unverified. A `ROLLBACK`ed update leaves a version too: XID 760 set row 1 to 0 and rolled back, after which `pg_xact_status('760')` returned `aborted` and the visible version carried `xmax = 760` with `HEAP_XMAX_INVALID` set, so readers ignore that `xmax` ✅[^30].

### 3.2 Transaction IDs: who gets one, and when

Every transaction has a virtual transaction ID (vxid) made of a backend number and a local counter, for example `4/12532`; a real XID is taken from a cluster-wide counter only when the transaction first writes ✅[^6]. So XID order is the order of first writes, not of start times ✅[^6]. In the lab a read-only transaction showed vxid `4/17` and no XID, and 10 read-only transactions advanced the counter by 0 ✅[^30].

Subtransactions (`SAVEPOINT`) that write get their own XID, a "subxid", and force their parents to take XIDs too; a parent's XID is always lower than its children's ✅[^26]. Lab: one transaction that wrote inside 5 savepoints consumed 6 XIDs (its rows carry `xmin` 5783 to 5788), while the same 6 inserts without savepoints consumed 1 ✅[^30]. Beyond 64 open subxids per backend, lookups move to the `pg_subtrans` directory and get much slower ✅[^26].

The 64-bit type `xid8` adds an epoch that grows at each wrap, so it never wraps during an installation's life; functions such as `pg_current_xact_id()` return it ✅[^6]. Internally the next XID is kept in that 64-bit form (`FullTransactionId`) ✅[^17], but tuples still store 32-bit `t_xmin` and `t_xmax` ✅[^5]. A committed top-level XID is marked in `pg_xact`, 2 bits per transaction ✅[^6] ✅[^15].

Useful functions ✅[^7]: `pg_current_xact_id()` assigns an XID if the transaction has none; `pg_current_xact_id_if_assigned()` returns NULL instead, and the docs advise it for transactions that might otherwise stay read-only; `age(xid)` counts transactions between an XID and the current counter; `pg_xact_status(xid8)` reports `in progress`, `committed` or `aborted` (prepared transactions show as `in progress`).

### 3.3 Snapshots and isolation levels

A snapshot has three parts ✅[^7]:
- `xmin` — the lowest XID still active; everything below it is finished (committed or rolled back).
- `xmax` — one past the highest completed XID; everything at or above it counts as not finished.
- `xip` — the XIDs between the two that were still in progress.

**Analogy:** a door list written at one moment. Everyone who had left by then counts as finished; everyone named as still inside, or who arrived later, does not.

**Lab** (experiment 02, session A and a second connection B through `dblink`) ✅[^30]:
```text
B opens a transaction and inserts row 2      B's XID = 769
A: pg_current_snapshot()                     769:769:        (xmax 769: B is not finished for A)
A commits an insert of its own (XID 770)
A: pg_current_snapshot()                     769:771:769     (xmin 769, xmax 771, in progress: 769)
A sees ids 1, 3; B sees 1, 2, 3; after B commits, A sees 1, 2, 3
```

How the isolation levels use snapshots ✅[^4]:

| Level | Snapshot taken | Effect |
|---|---|---|
| Read Committed (the default; Read Uncommitted behaves the same) | At the start of each statement | Two `SELECT`s in one transaction can see different data. A blocked `UPDATE` re-checks its `WHERE` clause against the newer version of the row and proceeds on it |
| Repeatable Read | At the first statement of the transaction | Sees the same data throughout; updating a row changed by a transaction that committed after the snapshot fails with `could not serialize access due to concurrent update`, and the transaction should be retried |
| Serializable | — | None of the phenomena is possible, serialization anomalies included |

Lab: under Repeatable Read, A still read balance 90 after B committed 80, and A's own `UPDATE` failed with exactly that error; under Read Committed, A read 80 and then 70 in the same transaction ✅[^30].

### 3.4 The visibility rule, step by step

For a tuple and a snapshot, the visibility test works as follows (paraphrased from `HeapTupleSatisfiesMVCC`) ✅[^14]:

1. **Inserter (`xmin`):** if it aborted, the tuple is invisible. If it is the current transaction, the tuple is visible only if it was inserted by an earlier command (command IDs decide). If the snapshot counts it as not finished (in `xip`, or at or above `xmax`), the tuple is invisible. Otherwise it committed: go on.
2. **Deleter (`xmax`):** if there is none, or it aborted, or it only locked the row, the tuple is visible. If it is the current transaction, the command IDs decide. If the snapshot counts it as not finished, the tuple is still visible. Otherwise the deleter committed before the snapshot: the tuple is invisible.

The check "is this XID still running?" must come before the commit-log lookup, because a committing transaction writes its status to `pg_xact` slightly before it stops being listed as running; reversing the order could make a tuple look committed to one reader and running to a later one ✅[^14].

**Worked example** (lab, Repeatable Read case): A's snapshot is `766:766:` and B's update is XID 766 ✅[^30].
- Old version: `xmin` 765 is below 766 and committed, so step 1 passes; `xmax` 766 is at the snapshot's `xmax`, so for A the deleter has not finished, and step 2 keeps it visible. A reads balance 90.
- New version: `xmin` 766 is not finished for A, so step 1 hides it.

### 3.5 Hint bits

When a visibility check learns a transaction's final outcome, it records it on the tuple as a hint bit (such as `HEAP_XMIN_COMMITTED`), so later readers can skip the commit-log lookup ✅[^14]. Setting a hint marks the page dirty, even during a `SELECT` (`MarkBufferDirtyHint`) ✅[^14]. A "committed" hint may be set only once the transaction's commit record is guaranteed on disk before the page; for an asynchronous commit whose record is not yet flushed, the hint is skipped until a later visit ✅[^14].

**Analogy:** a sticky note on a ledger line saying "this clerk's work was approved", so the next reader does not walk to the archive to check.

A side effect seen in the lab: the commit log keeps one "latest asynchronous commit" log position per group of 32 transactions, so the check can use a later transaction's position ✅[^15], and a transaction that took an XID but wrote nothing else commits asynchronously ✅[^15]. In experiment 04b a table was filled by XID 778 and then 5000 empty write transactions followed. An immediate `VACUUM` set no page all-visible and left the tuples at `infomask 0x802` (no committed hint); 2 seconds later the same `VACUUM` set all 35 pages all-visible and the tuples showed `0x902` ✅[^30]. The likely mechanism: XID 778 shares its 32-transaction group with those asynchronous commits, and VACUUM will not mark a page all-visible while a tuple lacks the committed hint ⚠️ unverified (consistent with the code read, but the VACUUM side was not checked in source).

### 3.6 Dead versions: pruning, HOT and VACUUM

A version is **dead** once its deleter committed and no transaction can still see it; until then it must stay ✅[^1]. Three mechanisms clean up:

- **HOT (heap-only tuple) updates.** When an `UPDATE` changes no indexed column (other than summarizing indexes such as BRIN) and the new version fits on the same page, no new index entry is made ✅[^8]. Indexes keep pointing at the original line pointer; once the old data is removed, that line pointer becomes a redirect to the oldest version some transaction may still see ✅[^8]. Middle versions of a HOT chain can be removed during normal operation, including `SELECT`s ✅[^8]. Lowering a table's `fillfactor` leaves room on pages for HOT updates, and `pg_stat_all_tables` counts HOT and non-HOT updates ✅[^8]; the lab's update showed `n_tup_hot_upd = 1` ✅[^30]. **Analogy:** a forwarding note on the same floor of the building, so the building directory (the index) never changes.
- **VACUUM.** Plain `VACUUM` removes dead versions, makes the space reusable inside the table and runs alongside normal reads and writes without an exclusive lock; it returns space to the operating system only for empty pages at the end of the table ✅[^18] ✅[^1]. `VACUUM FULL` rewrites the table, needs an `ACCESS EXCLUSIVE` lock and extra disk space ✅[^18]; in PostgreSQL 19 it is deprecated in favour of the new `REPACK` command, which can also run `CONCURRENTLY` ✅[^18] ✅[^11]. `VACUUM` cannot run inside a transaction block ✅[^18], and manual `VACUUM` is not throttled by default (`vacuum_cost_delay = 0` in the 18.3 lab) ✅[^30].
- **The visibility map.** Two bits per page: all-visible (no tuple needs vacuuming; index-only scans may skip the table page) and all-frozen (every tuple frozen; even an anti-wraparound vacuum can skip the page) ✅[^9]. **Analogy:** two tick boxes per page in a cleaning log, "nothing to tidy here" and "everything here is archived"; anybody who touches the page wipes both ticks. Any data change clears them ✅[^9]; in the lab an `UPDATE` on page 0 of a frozen table cleared both bits of that page ✅[^30].

Lab, after `VACUUM (VERBOSE)` on the experiment-01 table ✅[^30]:
```text
tuples: 3 removed, 1 remain, 0 are dead but not yet removable
removable cutoff: 761, which was 0 XIDs old when operation ended
new relfrozenxid: 758, which is 2 XIDs ahead of previous value
 lp | lp_flags | t_xmin | t_xmax
  1 |        2 |        |          <- LP_REDIRECT: the index entry still lands here
  2 |        0 |        |          <- LP_UNUSED: reusable
  3 |        1 |    758 |    760   <- the live version (xmax 760 aborted, ignored)
```
`lp_flags` values: 0 unused, 1 normal, 2 HOT redirect, 3 dead ✅[^31].

### 3.7 The xmin horizon: who keeps dead versions alive

VACUUM may remove only versions whose deleter finished before the oldest XID that anybody may still need: the **xmin horizon**, printed as `removable cutoff`. **Analogy:** the bookmark of the slowest reader; pages can be shredded only behind every bookmark.

Lab (experiment 03): a second session opened a Repeatable Read snapshot and went idle; then all 1000 rows were updated three times ✅[^30].
```text
pg_stat_activity: old_reader | idle in transaction | backend_xmin 773 | age 3
VACUUM while it is open:   tuples: 0 removed, 4000 remain, 3000 are dead but not yet removable
                           removable cutoff: 773            (no "new relfrozenxid" line)
VACUUM after its COMMIT:   tuples: 3000 removed, 1000 remain, 0 are dead but not yet removable
                           new relfrozenxid: 775; 18 pages set all-visible
```
The same horizon caps freezing: VACUUM's freeze cutoff is never newer than the horizon (`FreezeLimit` is clamped to `OldestXmin`) ✅[^16], so a stuck horizon also stops `relfrozenxid` from advancing (§7).

What can hold the horizon, and where it shows ✅[^1] ✅[^23]:

| Holder | Where to see it | Notes |
|---|---|---|
| Open transaction, often "idle in transaction" | `pg_stat_activity.backend_xid`, `backend_xmin` | Ended by `idle_in_transaction_session_timeout` (lab: a 2 s timeout ended the session with `terminating connection due to idle-in-transaction timeout`) ✅[^22] ✅[^30] |
| Prepared transaction (two-phase commit) | `pg_prepared_xacts.transaction` | Keeps its locks and hinders VACUUM; in extreme cases it can force the wraparound shutdown ✅[^21] |
| Replication slot (a reservation that makes the server keep data for a consumer that may come back) | `pg_replication_slots.xmin` (all tables), `catalog_xmin` (system catalogs only) ✅[^23] | The lab's logical slot showed `catalog_xmin = 766` and no `xmin`, and held every database's `datfrozenxid` (§7) ✅[^30] |
| Standby with `hot_standby_feedback = on` | The standby's slot or connection | Avoids query cancels on the standby but can bloat the primary ✅[^24] |

### 3.8 Multixacts

When more than one transaction locks the same row, `xmax` holds a MultiXact ID (MXID), a separate 32-bit counter, and the list of members lives in `pg_multixact` ✅[^1]. MXIDs wrap like XIDs, and their member storage must be managed too ✅[^1]. Typical sources are many `UPDATE`s with foreign-key checks, concurrent `SELECT … FOR SHARE` and heavy use of savepoints ✅[^1].

**Analogy:** a group ticket: one number written on the row that stands for a list of holders kept elsewhere.

Lab: two sessions ran `SELECT … FOR SHARE` on row 3; its `xmax` became `1` with `infomask 0x11d2` (`0x1000` is-multi, `0x0080` lock-only, `0x0050` shared lock, `0x0100` inserter committed, `0x0002`), and `pg_get_multixact_members('1')` returned XIDs 762 and 763 in mode `sh` ✅[^30] ✅[^13].

## 4. Wraparound and freezing

### 4.1 Comparing XIDs on a circle

`TransactionIdPrecedes(id1, id2)` uses a plain comparison when either ID is one of the special values 0 to 2, and otherwise computes `diff = (int32)(id1 - id2)` and returns `diff < 0` ✅[^17].

**Worked arithmetic:**
- `id1 = 100`, `id2 = 1,000,000`: `100 − 1,000,000 = −999,900`, negative, so 100 precedes 1,000,000 (as expected).
- `id1 = 100`, `id2 = 2,147,483,800` (more than 2³¹ − 1 = 2,147,483,647 later): the unsigned difference is `4,294,967,296 − 2,147,483,700 = 2,147,483,596`, which still fits in a positive `int32`. So 100 does **not** precede 2,147,483,800: a row written at XID 100 now looks newer than the reader, and is invisible.

### 4.2 Freezing

`FrozenTransactionId` (2) is always older than every normal XID, so a frozen version stays visible until it is deleted ✅[^1]. Since PostgreSQL 9.4 freezing sets flag bits instead of overwriting `xmin`, keeping the original XID for forensics; `xmin = 2` still appears in data upgraded with `pg_upgrade` from older versions, and system catalogs can show `xmin = 1` (bootstrap) ✅[^1]. The flag is `HEAP_XMIN_FROZEN`, the committed and invalid bits together ✅[^13].

Lab (experiment 04, 2000 rows inserted by XID 778, then 5000 XIDs consumed) ✅[^30]:
```text
plain VACUUM:      frozen: 0 pages ... had 0 tuples frozen     35 pages all-visible, 0 all-frozen
                   tuple: t_xmin 778, infomask 0x902           relfrozenxid 778, age 5001
VACUUM (FREEZE):   aggressively vacuuming ... frozen: 35 pages ... had 2000 tuples frozen
                   tuple: t_xmin 778, infomask 0xb02 (0x0300 set)   35 all-frozen; relfrozenxid 5779, age 0
SELECT xmin, age(xmin):  778 | 5001          <- the raw xmin is kept and keeps ageing; only the flag matters
```
Plain VACUUM froze nothing because the rows were younger than `vacuum_freeze_min_age` (50 million), the age a row XID must reach before it is frozen ✅[^1]; `FREEZE` is the same as setting `vacuum_freeze_min_age` and `vacuum_freeze_table_age` to 0 ✅[^18].

### 4.3 Bookkeeping: `relfrozenxid`, `datfrozenxid` and `age()`

- `pg_class.relfrozenxid` — the oldest unfrozen XID left in a table at the end of the last VACUUM that advanced it ✅[^1].
- `pg_database.datfrozenxid` — the minimum `relfrozenxid` over the database's tables ✅[^1].
- The limits of the XID counter come from the oldest `datfrozenxid` of all databases: after updating `datfrozenxid`, VACUUM scans `pg_database` for the minimum and passes it to `SetTransactionIdLimit` ✅[^16].
- `age(x)` is the number of transactions from `x` to the current counter ✅[^7].

The monitoring queries from the docs (the first also counts each table's TOAST table, the side table holding large values) ✅[^1]:
```sql
SELECT c.oid::regclass AS table_name,
       greatest(age(c.relfrozenxid), age(t.relfrozenxid)) AS age
FROM pg_class c
LEFT JOIN pg_class t ON c.reltoastrelid = t.oid
WHERE c.relkind IN ('r', 'm');

SELECT datname, age(datfrozenxid) FROM pg_database;
```
Output shape (lab, fresh cluster after about 5000 transactions): one row per table or database, for example `pg_authid | 5035` and `postgres | 5035` ✅[^30].

### 4.4 The threshold ladder

With D = the oldest `datfrozenxid` in the cluster, the source computes (PostgreSQL 18, `varsup.c`) ✅[^12]:
- wrap limit = D + (2³² − 1) / 2 = D + 2,147,483,647
- stop limit = wrap limit − 3,000,000
- warning limit = wrap limit − 40,000,000 (PostgreSQL 19: − 100,000,000 ✅[^11])
- forced-autovacuum limit = D + `autovacuum_freeze_max_age`; once past it, every 65,536th XID assignment signals the postmaster to start the autovacuum launcher

As ages, with default settings:
```text
age  0      50M         150M          200M              1.6B           2.047B     2.107B     2.144B    2.147B
     |-------|------------|-------------|-----------------|--------------|----------|----------|---------|
             |            |             |                 |              |          |          |         wrap point
             |            |             |                 |              |          |          stop: no new XIDs
             |            |             |                 |              |          PG 18 warnings start
             |            |             |                 |              PG 19 warnings start
             |            |             |                 failsafe: skip index vacuuming, no throttling
             |            |             forced anti-wraparound autovacuum (per table)
             |            aggressive VACUUM (per table)
             row XIDs older than this are frozen when a VACUUM visits them
```

| Age reached | Setting or rule | Default | Applies to | What happens |
|---|---|---|---|---|
| 50 million | `vacuum_freeze_min_age` | 50,000,000 ✅[^10] | Each row's XID | A VACUUM that visits the page freezes it ✅[^1] |
| 150 million | `vacuum_freeze_table_age` | 150,000,000 ✅[^10] | Table's `relfrozenxid` | The next VACUUM is aggressive: it scans every page not marked all-frozen ✅[^10] ✅[^19] |
| 200 million | `autovacuum_freeze_max_age` | 200,000,000 ✅[^10] | Table's `relfrozenxid` | Autovacuum is forced on the table, even with `autovacuum = off` ✅[^1] |
| 1.6 billion | `vacuum_failsafe_age` | 1,600,000,000 ✅[^10] | Table's `relfrozenxid` | Failsafe: cost delay off, index vacuuming and other non-essential work skipped, buffer ring disabled ✅[^10] |
| 2,047,483,647 (19) or 2,107,483,647 (18) | Warning limit | 100 M or 40 M before wrap ✅[^1] ✅[^2] | Oldest `datfrozenxid` | Each XID assignment warns `database "…" must be vacuumed within N transactions` ✅[^12] |
| 2,144,483,647 | Stop limit | 3 M before wrap ✅[^12] | Oldest `datfrozenxid` | New XIDs refused; running transactions may continue, read-only transactions can start, `VACUUM` still works ✅[^1] |
| 2,147,483,647 | Wrap point | 2³¹ − 1 | — | Never reached: the stop limit prevents it |

Arithmetic for the ages: 2,147,483,647 − 3,000,000 = 2,144,483,647; − 40,000,000 = 2,107,483,647; − 100,000,000 = 2,047,483,647.

The exact messages, PostgreSQL 18 (the example number is from the 18 docs) ✅[^2] ✅[^12]:
```text
WARNING:  database "mydb" must be vacuumed within 39985967 transactions
HINT:  To avoid transaction ID assignment failures, execute a database-wide VACUUM in that database.
ERROR:  database is not accepting commands that assign new transaction IDs to avoid wraparound data loss in database "mydb"
HINT:  Execute a database-wide VACUUM in that database.
You might also need to commit or roll back old prepared transactions, or drop stale replication slots.
```
PostgreSQL 19's warning adds a line such as `DETAIL: Approximately 4.66% of transaction ID space remains before wraparound.` ✅[^1].

**How fast is "200 million"?** Time to an age = age ÷ XID rate. At 1,000 writing transactions per second: 200,000,000 ÷ 1,000 = 200,000 s ≈ 55.6 hours to the forced autovacuum, and 2,147,483,647 ÷ 1,000 ≈ 24.9 days to the wrap point. At 10,000 per second: about 5.6 hours and 2.5 days. Freezing therefore has to run continuously on busy systems, not as an occasional chore.

### 4.5 The kinds of VACUUM, as far as freezing goes

| Kind | Triggered by | Pages scanned | Can advance `relfrozenxid`? |
|---|---|---|---|
| Normal | Dead-tuple or insert thresholds, or a manual `VACUUM` ✅[^1] | Skips all-visible pages; may "eagerly" scan some all-visible pages to freeze them, giving up after failing on `vacuum_max_eager_freeze_failure_rate` (3 %) of the table ✅[^1] ✅[^10] | Only as far as the pages it scanned allow; lab: "new relfrozenxid: 778, 1 XID ahead" ✅[^30] |
| Aggressive | `relfrozenxid` age ≥ `vacuum_freeze_table_age`, or `VACUUM (FREEZE)` ✅[^10] ✅[^18] | Every page not all-frozen; freezes all eligible XIDs and MXIDs ✅[^1] | Yes, but never past the horizon ✅[^16] |
| Anti-wraparound autovacuum | `relfrozenxid` age > `autovacuum_freeze_max_age` ✅[^1] | As aggressive | Yes; shown as `(to prevent wraparound)` in `pg_stat_activity` (18) or `started_by = autovacuum_wraparound` (19), and not cancelled by conflicting lock requests ✅[^2] ✅[^19] |
| Failsafe | `relfrozenxid` age > `vacuum_failsafe_age` ✅[^10] | As aggressive, minimum work only; `mode = failsafe` in 19 ✅[^19] | Yes, faster, at the cost of skipping index cleanup |

### 4.6 Life of one row, from INSERT to frozen

A row inserted once and never changed, default settings, X = the inserting XID:

1. **X:** the client inserts; `xmin = X`, the page's visibility-map bits are clear.
2. **X + a little:** once the table has received 1,000 + 20 % of its unfrozen size in new rows, autovacuum's insert threshold fires ✅[^1] ✅[^10]. The row is younger than 50 million, so it is not frozen, but the page becomes all-visible.
3. **X + 50 million:** the row is now old enough to freeze, but a normal VACUUM skips all-visible pages unless it scans the page eagerly ✅[^1].
4. **X + 150 million (or less):** the table's `relfrozenxid` (at most X) has age ≥ 150 million, so the next VACUUM is aggressive, visits the page, freezes the row and marks the page all-frozen; `relfrozenxid` moves forward ✅[^10].
5. **X + 200 million:** if no VACUUM ran at all, autovacuum forces one ✅[^1].
6. **X + 1.6 billion and later:** only if every vacuum failed or was blocked: failsafe, then warnings, then the stop limit (§4.4).

## 5. Settings catalog

Defaults below match the PostgreSQL 18.3 lab's `pg_settings` ✅[^30] and the PostgreSQL 19 documentation ✅[^10] unless a version is named.

| Setting | Default | Range, clamp, context | Special or unset value | What it does |
|---|---|---|---|---|
| `vacuum_freeze_min_age` | 50,000,000 | 0 to 1 billion; effective value at most half of `autovacuum_freeze_max_age` ✅[^10] ✅[^16] | 0: freeze everything visited | Row XIDs older than this are frozen when visited. Higher saves work on rows that change again soon ✅[^1] |
| `vacuum_freeze_table_age` | 150,000,000 | 0 to 2 billion; effective value at most 95 % of `autovacuum_freeze_max_age`, so a periodic manual VACUUM can run before an anti-wraparound one ✅[^10] | 0: every VACUUM aggressive ✅[^1] | Table age that makes VACUUM aggressive |
| `autovacuum_freeze_max_age` | 200,000,000 | Up to 2 billion; server start only; can be lowered per table ✅[^10] ✅[^1] | — | Table age that forces autovacuum. Storage: 200 M ≈ 50 MB of `pg_xact` and ≈ 2 GB of `pg_commit_ts`; 2 B ≈ 0.5 GB and ≈ 20 GB ✅[^1] |
| `vacuum_failsafe_age` | 1,600,000,000 | 0 to 2.1 billion; effective value at least 105 % of `autovacuum_freeze_max_age` ✅[^10] ✅[^16] | — | Table age that starts the failsafe |
| `vacuum_multixact_freeze_min_age` | 5,000,000 | 0 to 1 billion; at most half of `autovacuum_multixact_freeze_max_age` ✅[^10] | — | MXIDs older than this are replaced (by zero, one XID or a newer MXID) ✅[^1] |
| `vacuum_multixact_freeze_table_age` | 150,000,000 | 0 to 2 billion; at most 95 % of the max age ✅[^10] | — | Table MXID age (`relminmxid`) that makes VACUUM aggressive ✅[^1] |
| `autovacuum_multixact_freeze_max_age` | 400,000,000 | Server start only; per table lower ✅[^10] | — | Forces autovacuum, even if autovacuum is nominally off ✅[^1] |
| `vacuum_multixact_failsafe_age` | 1,600,000,000 | At least 105 % of the max age ✅[^10] | — | MXID failsafe |
| `vacuum_max_eager_freeze_failure_rate` | 0.03 | Fraction of pages ✅[^10] | 0 disables eager scanning ✅[^10] | Budget of failed eager-freeze attempts in a normal VACUUM |
| `autovacuum` | on | Config file or command line ✅[^10] | off: no routine vacuums, anti-wraparound ones still run ✅[^1] | Runs the launcher; needs `track_counts` on ✅[^10] |
| `autovacuum_naptime` | 1 min | — | — | Delay between rounds on one database ✅[^10] |
| `autovacuum_max_workers` / `autovacuum_worker_slots` | 3 / 16 (typical) | Workers above the slot count have no effect; slots need a restart ✅[^10] | — | Parallel autovacuum workers |
| `autovacuum_vacuum_threshold`, `_scale_factor`, `_max_threshold` | 50, 0.2, 100,000,000 | Vacuum when dead tuples > min(max, 50 + 0.2 × rows) ✅[^1] ✅[^10] | max −1: no cap ✅[^10] | Dead-tuple trigger |
| `autovacuum_vacuum_insert_threshold`, `_insert_scale_factor` | 1000, 0.2 | Inserts > 1000 + 0.2 × rows × unfrozen fraction ✅[^1] | −1 disables ✅[^10] | Insert trigger; keeps insert-only tables frozen |
| `autovacuum_vacuum_cost_delay` / `_cost_limit` | 2 ms / −1 | The limit is shared among running workers ✅[^10] | limit −1: use `vacuum_cost_limit` (200) ✅[^10] | Throttles autovacuum I/O |
| `vacuum_cost_delay` | 0 (lab) ✅[^30] | — | 0: manual VACUUM unthrottled | Throttle for manual VACUUM |
| `maintenance_work_mem` / `autovacuum_work_mem` | 64 MB / −1 ✅[^25] | Up to `autovacuum_max_workers` × this can be allocated ✅[^25] | −1: use `maintenance_work_mem` ✅[^25] | Bounds the dead-tuple data VACUUM collects before it must run an index pass ✅[^19] |
| `log_autovacuum_min_duration` | 10 min (lab: 600000 ms) ✅[^30] | In 19 it covers only vacuums; `log_autoanalyze_min_duration` is new ✅[^11] | 0: log every run (the lab's setting in experiment 05) ✅[^30] | Logs slow autovacuums |
| `autovacuum_freeze_score_weight` (19 only) | 1.0 ✅[^10] | Absent in 18.3 ✅[^30] | 0.0 for all weights: the pre-19 order ✅[^1] | Weights the XID-age part of autovacuum's table priority |
| `idle_in_transaction_session_timeout` | 0 | ms ✅[^22] | 0: disabled | Ends sessions idle inside a transaction |
| `transaction_timeout` | 0 | Prepared transactions are exempt ✅[^22] | 0: disabled | Ends sessions whose transaction runs too long |
| `max_prepared_transactions` | 0 | Server start ✅[^25] | 0: feature off, which the docs advise if unused ✅[^25] | Allows `PREPARE TRANSACTION` |
| `hot_standby_feedback` | off ✅[^24] | On a standby | — | Standby tells the primary which rows its queries still need |
| `idle_replication_slot_timeout` | 0 ✅[^24] ✅[^30] | Checked at checkpoints; not for slots that reserve no WAL ✅[^24] | 0: disabled | Invalidates replication slots inactive for longer |
| `max_slot_wal_keep_size` | −1 ✅[^24] | — | −1: slots may keep unlimited WAL | Limits WAL kept for slots |

## 6. Cross-actor interactions

| A change in … | … does this to … | Mechanism |
|---|---|---|
| An open transaction or snapshot (client) | VACUUM on every table: no cleanup, no freezing past its `xmin` | The horizon caps both the removable cutoff and `FreezeLimit` ✅[^16] ✅[^30] |
| A forgotten prepared transaction | Same as above, plus held locks | ✅[^21] |
| A forgotten logical slot | System catalogs in **every** database stop advancing `relfrozenxid`, so every `datfrozenxid` stays old; user tables are unaffected | `catalog_xmin` holds catalog cleanup ✅[^23]; lab: all 4 databases stuck at 766 while table `t` had age 2 ✅[^30] |
| A physical slot or `hot_standby_feedback` | All tables on the primary | `xmin` of the slot ✅[^23] ✅[^24] |
| `autovacuum = off` | Routine vacuums stop; forced ones still come at 200 M and are not cancelled by lock requests, so a conflicting `ALTER TABLE` waits behind them | ✅[^1] |
| Raising `autovacuum_freeze_max_age` | Fewer forced vacuums; larger `pg_xact` and `pg_commit_ts`; less margin before the warnings; raises the caps of `vacuum_freeze_min_age` (½) and `vacuum_freeze_table_age` (95 %) and the failsafe floor (105 %) | ✅[^1] ✅[^10] |
| Cost delay and cost limit | Speed of every autovacuum worker; the failsafe drops the delay | ✅[^10] |
| VACUUM run by a non-superuser | Skips system catalogs, so `datfrozenxid` cannot advance | ✅[^1] |
| A database that refuses connections (`template0`) | `vacuumdb --all` cannot reach it; autovacuum still freezes it | Lab: vacuumdb processed 3 databases and autovacuum fixed `template0` within 2 s ✅[^30] |
| Temporary tables | Only the owning session can vacuum them; autovacuum cannot ✅[^1] | A long-lived session with an old temporary table keeps that table's `relfrozenxid` old |
| Any `UPDATE`, `DELETE` or `INSERT` on a page | Clears its all-visible and all-frozen bits, so the next aggressive VACUUM revisits it | ✅[^9] ✅[^30] |
| PostgreSQL 19 query scans | May set pages all-visible, so less work for VACUUM | ✅[^11] |

## 7. Worked example: a forgotten replication slot stops all writes

### 7.1 Method

Experiment 05 (PostgreSQL 18.3, a throwaway Docker volume, `wal_level=logical`, `autovacuum_naptime=2s`) ✅[^30]. Reaching 2 billion XIDs honestly would take days, so the counter was moved with `pg_resetwal -x`, a repair tool the docs reserve for last-resort recovery of a damaged cluster ✅[^20]: never run it on real data. Each target value is a multiple of 1,048,576 (one `pg_xact` segment), as its docs recommend for a safe next XID ✅[^20]. In the lab, `pg_resetwal -x` changed only the next XID and left `oldestXID` at 745 in `pg_control` ✅[^30].

### 7.2 Timeline

All numbers are from the run's output ✅[^30].

1. **Client → server, setup:** create database `lab` and table `t` with 1000 rows; create logical slot `forgotten_slot` (`test_decoding`) when the next XID is 766. The slot shows `catalog_xmin = 766`. All four databases have `datfrozenxid = 745`.
2. **Operator, offline:** clean shutdown, then `pg_resetwal -x 2107637760` (call it T1 = 2010 × 1,048,576). With D = 745 the PostgreSQL 18 limits are: wrap 2,147,484,392, warning 2,107,484,392, stop 2,144,484,392; the target lies between warning and stop.
3. **Server, startup:** logs `database with OID 1 must be vacuumed within 39846632 transactions` (2,147,484,392 − 2,107,637,760).
4. **Autovacuum, within seconds:** runs `automatic aggressive vacuum to prevent wraparound of table "postgres.pg_catalog.pg_statistic"`, with `bypassing nonessential maintenance … as a failsafe` (age above 1.6 billion) and `cutoff for removing and freezing tuples is far in the past` — the warning VACUUM gives when the horizon is older than next XID − `autovacuum_freeze_max_age` ✅[^16]. Table `t` advances to age 2. The catalogs cannot pass the slot's 766, so every `datfrozenxid` becomes 766, and the limits move by 21: wrap 2,147,484,413.
5. **Client:** `INSERT` succeeds with `WARNING: database "postgres" must be vacuumed within 39846652 transactions` plus the HINT about prepared transactions and stale replication slots. Check: 2,147,484,413 − 39,846,652 = 2,107,637,761, so the INSERT got XID T1 + 1.
6. **Client:** `VACUUM (VERBOSE) pg_catalog.pg_class` reports `removable cutoff: 766, which was 2107636996 XIDs old` and no `new relfrozenxid` line: it worked, but could not freeze anything.
7. **Operator, offline:** `pg_resetwal -x 2145386496` (T2 = 2046 × 1,048,576), past the stop limit 2,144,484,413. Startup logs `must be vacuumed within 2097917 transactions` (2,147,484,413 − 2,145,386,496).
8. **Client:** `INSERT` and `CREATE TABLE` both fail with `database is not accepting commands that assign new transaction IDs to avoid wraparound data loss in database "postgres"`; `SELECT count(*) FROM t` still returns 1001.
9. **Operator, diagnosis with the docs' three queries:** `pg_prepared_xacts` is empty; `pg_stat_activity` shows only the operator's own session; `pg_replication_slots` shows `forgotten_slot`, inactive, `age(catalog_xmin) = 2145385730` (2,145,386,496 − 766).
10. **Operator, fix:** `SELECT pg_drop_replication_slot('forgotten_slot')`, then `vacuumdb --all`: 3 databases, 182 failsafe warnings, "0 s" on the shell's whole-second timer. Two seconds later autovacuum has also frozen `template0`; the oldest database age falls from 2,145,385,730 to 37,748,736.
11. **Client:** `INSERT` succeeds. `pg_control` now records `oldestXID 2107637760`.

### 7.3 What the numbers show

- The blocker was outside any table: one inactive slot in one database pinned the catalogs of all four databases, and so the whole cluster's XID limits.
- Autovacuum did run, aggressively and in failsafe mode, every 2 seconds; the problem was never "autovacuum is off" but "the horizon cannot move".
- Recovery needed no single-user mode: remove the blocker, `VACUUM` each database as a superuser, let autovacuum handle `template0`.
- The final age 37,748,736 equals T2 − T1 = 2,145,386,496 − 2,107,637,760: `lab` keeps `datfrozenxid` at the first jump target because table `t` holds rows written then, which are still younger than `vacuum_freeze_min_age`. That is normal and far below every threshold.

## 8. Preventing wraparound: the playbook

### 8.1 Measure

```sql
-- 1. Cluster: how far each database is from the wrap point (2^31 - 1)
SELECT datname, age(datfrozenxid) AS xid_age, mxid_age(datminmxid) AS mxid_age,
       round(100.0 * age(datfrozenxid) / 2147483647, 1) AS pct_of_wrap
FROM pg_database ORDER BY xid_age DESC;
-- 2. Tables (with TOAST): the first docs query in section 4.3, ordered by age DESC
-- 3. Horizon holders: the docs' three diagnosis queries
SELECT gid, prepared, age(transaction) FROM pg_prepared_xacts ORDER BY 3 DESC;
SELECT pid, datname, state, xact_start, age(backend_xid) AS xid_age, age(backend_xmin) AS xmin_age
FROM pg_stat_activity WHERE backend_xmin IS NOT NULL OR backend_xid IS NOT NULL ORDER BY xmin_age DESC;
SELECT slot_name, slot_type, active, age(xmin) AS xmin_age, age(catalog_xmin) AS catalog_xmin_age
FROM pg_replication_slots;
-- 4. Running vacuums (19 adds mode and started_by)
SELECT pid, relid::regclass, phase, heap_blks_scanned, heap_blks_total, index_vacuum_count
FROM pg_stat_progress_vacuum;
-- 5. XID burn rate without consuming an XID: sample twice, divide by the seconds between
SELECT now(), pg_snapshot_xmax(pg_current_snapshot());
```
Sources: queries 2 and 3 follow the docs ✅[^1]; the progress view and its columns ✅[^19]; snapshot `xmax` is one past the highest completed XID ✅[^7]. In PostgreSQL 19, `pg_stat_autovacuum_scores` shows how autovacuum ranks tables and `pg_get_multixact_stats()` reports multixact use ✅[^1] ✅[^11].

All of them ran unchanged on the lab's fresh 18.3 cluster (experiment 08); query 1 returned rows such as `postgres | 8 | 0 | 0.0`. Run inside one transaction, the burn-rate sample left `pg_current_xact_id_if_assigned()` NULL, and a second sample showed the same value (753), so sampling consumes no XID ✅[^30].

**Suggested alerts** (operational judgement, not from a source) ⚠️ unverified:

| Signal | Warn | Page | Why |
|---|---|---|---|
| Max `age(datfrozenxid)` | > 2 × `autovacuum_freeze_max_age` (400 M by default) | > 1 billion | Above the forced-vacuum age means forced vacuums are not finishing; 1 B leaves time before the 1.6 B failsafe |
| Max `mxid_age(datminmxid)` | > 2 × `autovacuum_multixact_freeze_max_age` | > 1 billion | Same logic for MXIDs |
| `age(backend_xmin)` or transaction duration | > 1 hour or > 50 M | > 4 hours | Long snapshots block cleanup and freezing |
| Any prepared transaction | Older than 5 minutes | Older than 1 hour | The docs expect a prepared transaction to be resolved as soon as the transaction manager has checked the other databases ✅[^21] |
| Inactive replication slot | Any | `age(xmin)` or `age(catalog_xmin)` > 100 M | The lab's failure (§7) |
| Server log | Any `must be vacuumed within` | — | Already late: 40 M (18) or 100 M (19) left |

### 8.2 Keep autovacuum able to finish

- Leave `autovacuum` on: it is what vacuums and freezes tables as they need it ✅[^1].
- Give it throughput on large or busy systems: more workers, a higher cost limit, a lower cost delay, enough `autovacuum_work_mem` ✅[^10] ✅[^25]. The 2015 incident's fix went in this direction ✅[^27]; the right values depend on hardware ⚠️ unverified.
- Use per-table storage parameters for the largest tables rather than raising cluster-wide values: the freeze max age can be lowered per table ✅[^10].
- In PostgreSQL 19, parallel autovacuum of indexes (`autovacuum_max_parallel_workers`, per-table `autovacuum_parallel_workers`) and the scoring system help large tables; note that parallel vacuum workers now share one cost budget ✅[^11].
- Watch for vacuums that never complete because a lock request keeps cancelling them: routine autovacuum yields to conflicting locks, wraparound autovacuum does not ✅[^1].

### 8.3 Remove horizon holders

- Set `idle_in_transaction_session_timeout` for application roles; the docs give it exactly this purpose, since an open transaction stops VACUUM removing dead rows ✅[^22]. It is a user-level setting (lab context `user`) ✅[^30], so `ALTER ROLE … SET` works. The docs advise against setting `transaction_timeout` or `statement_timeout` in `postgresql.conf`, because that affects all sessions ✅[^22].
- Keep `max_prepared_transactions = 0` unless a transaction manager uses two-phase commit ✅[^25]; when used, alert on any prepared transaction older than a few minutes ✅[^21].
- Drop replication slots nobody consumes; dropping one used by a live replica may force rebuilding that replica ✅[^1]. Consider `idle_replication_slot_timeout` for slots that reserve WAL ✅[^24]. Logical slots left behind by change-data-capture tools are a common source ⚠️ unverified.
- With `hot_standby_feedback = on`, long standby queries hold the primary's horizon; weigh that against query cancels on the standby ✅[^24].

### 8.4 Freeze ahead of time

- Insert-only tables are covered by the insert threshold since autovacuum counts unfrozen pages ✅[^1].
- For large tables that are rarely updated, the docs suggest raising `autovacuum_freeze_max_age` or lowering `vacuum_freeze_min_age` to lengthen the time between forced vacuums ✅[^1].
- Run a manual `VACUUM` in quiet hours before tables reach `autovacuum_freeze_max_age`; the 95 % clamp on `vacuum_freeze_table_age` exists so such a periodic vacuum runs aggressively first ✅[^10]. `VACUUM (FREEZE)` on a cold table after a bulk load makes later aggressive vacuums skip it via all-frozen pages ✅[^9] ✅[^30].
- Data that can be thrown away in bulk is cheaper to drop than to freeze: the docs' only reason for single-user mode is to `DROP` or `TRUNCATE` tables so they need no vacuuming ✅[^1]; designing such data as partitions that are dropped is the routine version of that ⚠️ unverified.

### 8.5 Spend fewer XIDs

- Reads do not consume XIDs; only writes do ✅[^6] ✅[^30].
- Each writing savepoint costs an extra XID (lab: 6 instead of 1) ✅[^30]. ORMs and drivers that wrap statements in savepoints multiply the burn rate ⚠️ unverified.
- Batch many small writes into one transaction where the application allows (lab: 6 inserts in one transaction, 1 XID) ✅[^30].
- Use `pg_current_xact_id_if_assigned()`, not `pg_current_xact_id()`, in code that only inspects ✅[^7].

### 8.6 Emergency runbook (the docs' procedure, 18 and 19)

1. Commit or roll back old prepared transactions (`pg_prepared_xacts`) ✅[^1].
2. End long transactions (`pg_stat_activity`, `pg_terminate_backend`) ✅[^1].
3. Drop stale replication slots (`pg_replication_slots`) ✅[^1].
4. Run `VACUUM` as a superuser in each database with an old `datfrozenxid`; a database-wide `VACUUM` is simplest. Do not use `VACUUM FULL` (it needs an XID) or `VACUUM FREEZE` (more work than needed) ✅[^1].
5. Fix the autovacuum configuration so it does not happen again ✅[^1].

Stopping the server or entering single-user mode is not necessary and the docs advise against it, since it takes the system down and disables the wraparound safeguards; its one use is to `TRUNCATE` or `DROP` unneeded tables, which the 3-million-XID margin leaves room for ✅[^1] ✅[^2]. How long step 4 takes depends on table size: in the 2019 incident the estimate was days to weeks until large tables were truncated ✅[^28].

## 9. Failure and edge-case matrix

| Situation | Symptom | What blocks freezing | Fix | Evidence |
|---|---|---|---|---|
| Session idle in transaction for days | Bloat, `dead but not yet removable` in VACUUM output, ages grow | Its `backend_xmin` | End it; set `idle_in_transaction_session_timeout` | ✅[^22] ✅[^30] |
| Forgotten prepared transaction | Same, and its locks stay held | Its XID | `COMMIT PREPARED` or `ROLLBACK PREPARED` | ✅[^21] ✅[^1] |
| Inactive logical slot | `datfrozenxid` stuck in all databases; catalogs at the slot's `catalog_xmin` | Slot `catalog_xmin` | Drop the slot | ✅[^30] |
| Physical slot or standby feedback | Bloat and old ages on the primary | Slot or feedback `xmin` | Fix or drop the slot; reconsider feedback | ✅[^23] ✅[^24] ✅[^1] |
| Autovacuum throttled on a huge table | Anti-wraparound vacuum runs for days; ages keep rising | Nothing; too slow | Lower cost delay, more memory; failsafe engages at 1.6 B | ✅[^27] ✅[^10] |
| Autovacuum turned off | Forced vacuums at 200 M, which conflicting DDL cannot cancel | Nothing | Turn it back on | ✅[^1] |
| VACUUM run as non-superuser | `datfrozenxid` does not move | Catalogs skipped | Run as superuser | ✅[^1] |
| `template0` | Old age, cannot connect | Nothing | Autovacuum handles it | ✅[^30] |
| Temporary table in a long-lived session | One table's age grows | Autovacuum cannot vacuum it | The owning session vacuums or drops it | ✅[^1] |
| Multixact exhaustion | Only writes needing an MXID fail, such as row locks | Running transactions that can be members | Same steps; slots do not hold MXIDs back | ✅[^1] |
| Multixact member storage over about 2 billion entries (≈ 10 GB) | Aggressive vacuums more often for all tables | — | Find heavy `FOR SHARE` or foreign-key locking | ✅[^1] |
| Warnings start (40 M in 18, 100 M in 19) | `must be vacuumed within N transactions` on every XID | Whatever the diagnosis shows | Runbook §8.6 | ✅[^1] ✅[^2] |
| Stop limit reached | `not accepting commands that assign new transaction IDs` | Same | Runbook §8.6; reads keep working | ✅[^1] ✅[^30] |
| VACUUM right after many empty write transactions | Pages not set all-visible yet | Unflushed asynchronous commits delay hint bits | Harmless; the next VACUUM sets them | ✅[^30] ⚠️ unverified (mechanism, §3.5) |

## 10. Misconceptions and version differences

| Belief | What actually holds | Evidence |
|---|---|---|
| "`VACUUM FULL` is the strongest fix in an emergency" | It needs an XID, so it fails at the stop limit, and it rewrites the whole table | ✅[^1] ✅[^18] |
| "Turning autovacuum off stops all vacuuming" | Anti-wraparound vacuums still start | ✅[^1] |
| "Freezing sets `xmin` to 2" | Since 9.4 it sets flag bits and keeps `xmin`; lab `age(xmin)` kept growing after `FREEZE` | ✅[^1] ✅[^30] |
| "Long reports are harmless because they only read" | They consume no XID, but their snapshot holds the horizon | ✅[^6] ✅[^30] |
| "Single-user mode is required to recover" | Not necessary and discouraged in 18 and 19 | ✅[^1] ✅[^2] |
| "PostgreSQL has 64-bit transaction IDs now" | `xid8` and `FullTransactionId` are 64-bit, but tuples still store 32-bit XIDs; 19 made multixact members 64-bit | ✅[^6] ✅[^5] ✅[^11] |
| "If autovacuum is running, we are safe" | It can run in a loop and freeze nothing while a horizon holder exists | ✅[^30] |

| Topic | PostgreSQL 18 | PostgreSQL 19 (released 2026-11-19) |
|---|---|---|
| Warning limit | 40 M XIDs or MXIDs before wrap ✅[^11] ✅[^12] | 100 M, to clients and the log; warning has a DETAIL line with the remaining percentage ✅[^11] ✅[^1] |
| Autovacuum order | Order of the `pg_class` listing ✅[^1] | Scores; `pg_stat_autovacuum_scores`; `autovacuum_*_score_weight` ✅[^11] ✅[^1] |
| Spotting wraparound vacuums | `(to prevent wraparound)` in `pg_stat_activity` ✅[^2] | Also `started_by` and `mode` in `pg_stat_progress_vacuum` ✅[^19] |
| Rewriting tables | `VACUUM FULL`, `CLUSTER` | `REPACK`, `REPACK (CONCURRENTLY)`; old commands kept for compatibility ✅[^11] |
| Visibility map bits | Set by VACUUM (and `COPY … FREEZE`) ✅[^11] | Query scans can set all-visible too ✅[^11] |
| Multixact | — | `pg_get_multixact_stats()`; members 64-bit ✅[^11] |

One discrepancy in the 19 documentation: the visibility map page still says its bits are only set by vacuum ✅[^9], while the 19 release notes say query scans can now set all-visible ✅[^11] (and `COPY … FREEZE` could before). The release notes describe the newer behaviour.

## 11. Verification notes

- PostgreSQL 19 documentation (`/docs/current/`, which is 19 since 2026-11-19), the PostgreSQL 18 routine-vacuuming page and the PostgreSQL 18 source (`REL_18_STABLE`) were read on 2026-11-23.
- Every lab result comes from PostgreSQL 18.3 (`postgres:latest` Docker image, Debian build, aarch64) on 2026-11-23 (UTC+7). Scripts and full outputs are in `experiments/` next to this doc. PostgreSQL 19 behaviour is from its documentation only.
- Counts in this doc (claim markers in the body: ✅ with a footnote, and ⚠️ marks): ✅ 319, ⚠️ 8. A claim backed by two sources carries two ✅ markers.

## References
- [Routine Vacuuming (PostgreSQL 19)](https://www.postgresql.org/docs/current/routine-vacuuming.html) — PostgreSQL Global Development Group, 2026. Backs: dead versions and VACUUM, wraparound, freezing, `relfrozenxid`/`datfrozenxid`, monitoring queries, warning and stop behaviour, recovery procedure, single-user mode, multixacts, autovacuum thresholds and scoring. [^1]
- [Routine Vacuuming (PostgreSQL 18)](https://www.postgresql.org/docs/18/routine-vacuuming.html) — PostgreSQL Global Development Group, 2025. Backs: 40 million warning, recovery procedure without single-user mode, `(to prevent wraparound)`, eager scanning. [^2]
- [Introduction to MVCC](https://www.postgresql.org/docs/current/mvcc-intro.html) — PostgreSQL Global Development Group, living. Backs: snapshots per statement; reading and writing do not block each other. [^3]
- [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) — PostgreSQL Global Development Group, living. Backs: isolation levels, snapshot timing, serialization error, `WHERE` re-check. [^4]
- [Database Page Layout](https://www.postgresql.org/docs/current/storage-page-layout.html) — PostgreSQL Global Development Group, living. Backs: page and tuple header layout, field sizes. [^5]
- [Transactions and Identifiers](https://www.postgresql.org/docs/current/transaction-id.html) — PostgreSQL Global Development Group, living. Backs: vxid and XID assignment, 32-bit wrap, `xid8` epoch, `pg_xact`. [^6]
- [System Information Functions and Operators](https://www.postgresql.org/docs/current/functions-info.html) — PostgreSQL Global Development Group, living. Backs: `age`, `mxid_age`, `pg_current_xact_id*`, `pg_xact_status`, snapshot components. [^7]
- [Heap-Only Tuples (HOT)](https://www.postgresql.org/docs/current/storage-hot.html) — PostgreSQL Global Development Group, living. Backs: HOT conditions, redirects, pruning, fillfactor, statistics. [^8]
- [Visibility Map](https://www.postgresql.org/docs/current/storage-vm.html) — PostgreSQL Global Development Group, living. Backs: two bits per page, who sets and clears them, conservative bits. [^9]
- [Server Configuration: Vacuuming](https://www.postgresql.org/docs/current/runtime-config-vacuum.html) — PostgreSQL Global Development Group, living. Backs: settings catalog, defaults, clamps, failsafe effects. [^10]
- [Release 19](https://www.postgresql.org/docs/19/release-19.html) — PostgreSQL Global Development Group, 2026. Backs: 100 million warning, scoring, parallel autovacuum, REPACK, progress columns, query scans setting all-visible, multixact changes. [^11]
- [varsup.c (REL_18_STABLE)](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/access/transam/varsup.c) — PostgreSQL source, living. Backs: wrap, stop, warning and forced-autovacuum limits; message texts; launcher signal. [^12]
- [htup_details.h (REL_18_STABLE)](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/include/access/htup_details.h) — PostgreSQL source, living. Backs: infomask bit values, combo command IDs. [^13]
- [heapam_visibility.c (REL_18_STABLE)](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/access/heap/heapam_visibility.c) — PostgreSQL source, living. Backs: visibility rule, check order, hint bits and the flush interlock. [^14]
- [clog.c](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/access/transam/clog.c) and [xact.c](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/access/transam/xact.c) (REL_18_STABLE) — PostgreSQL source, living. Backs: 2 status bits per XID, LSN groups of 32, asynchronous commit of transactions that wrote no WAL. [^15]
- [vacuum.c (REL_18_STABLE)](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/commands/vacuum.c) — PostgreSQL source, living. Backs: freeze and aggressive cutoffs and clamps, failsafe floor, "far in the past" warning, minimum `datfrozenxid` passed to `SetTransactionIdLimit`. [^16]
- [transam.h](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/include/access/transam.h) and [transam.c](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/access/transam/transam.c) (REL_18_STABLE) — PostgreSQL source, living. Backs: special XIDs, `FullTransactionId`, modulo-2³² comparison. [^17]
- [VACUUM](https://www.postgresql.org/docs/current/sql-vacuum.html) — PostgreSQL Global Development Group, living. Backs: plain vs FULL, FREEZE option, no transaction block, REPACK relation. [^18]
- [Progress Reporting](https://www.postgresql.org/docs/current/progress-reporting.html) — PostgreSQL Global Development Group, living. Backs: `pg_stat_progress_vacuum` columns, `mode`, `started_by`. [^19]
- [pg_resetwal](https://www.postgresql.org/docs/current/app-pgresetwal.html) — PostgreSQL Global Development Group, living. Backs: last-resort use, safe `-x` values. [^20]
- [PREPARE TRANSACTION](https://www.postgresql.org/docs/current/sql-prepare-transaction.html) — PostgreSQL Global Development Group, living. Backs: long-prepared transactions block VACUUM and hold locks. [^21]
- [Client Connection Defaults](https://www.postgresql.org/docs/current/runtime-config-client.html) — PostgreSQL Global Development Group, living. Backs: idle-in-transaction and transaction timeouts, per-role setting. [^22]
- [pg_replication_slots](https://www.postgresql.org/docs/current/view-pg-replication-slots.html) — PostgreSQL Global Development Group, living. Backs: slot `xmin` and `catalog_xmin`. [^23]
- [Replication settings](https://www.postgresql.org/docs/current/runtime-config-replication.html) — PostgreSQL Global Development Group, living. Backs: `hot_standby_feedback`, `max_slot_wal_keep_size`, `idle_replication_slot_timeout`. [^24]
- [Resource Consumption](https://www.postgresql.org/docs/current/runtime-config-resource.html) — PostgreSQL Global Development Group, living. Backs: `max_prepared_transactions`, `maintenance_work_mem`, `autovacuum_work_mem`. [^25]
- [Subtransactions](https://www.postgresql.org/docs/current/subxacts.html) — PostgreSQL Global Development Group, living. Backs: subxid assignment, 64 cached subxids. [^26]
- [Transaction ID Wraparound in Postgres](https://blog.sentry.io/transaction-id-wraparound-in-postgres/) — Sentry (David Cramer), 2015. Backs: the 2015 incident. [^27]
- [What we learned from the recent Mandrill outage](https://mailchimp.com/what-we-learned-from-the-recent-mandrill-outage/) — Mailchimp, 2019. Backs: the 2019 incident. [^28]
- [Multiversion concurrency control](https://en.wikipedia.org/wiki/Multiversion_concurrency_control) — Wikipedia, living. Backs: undo-log designs in other databases. [^29]
- `experiments/` (next to this doc) — the lab, PostgreSQL 18.3, 2026-11-23: `run-01-04.sh` runs `01-tuple-versions`, `02-snapshots`, `03-horizon`, `04-freezing` and `06-xid-consumption`; `run-05-wraparound.sh` runs experiment 05 and keeps its filtered server logs; `04b-allvisible-check`, `07-settings-pg18` and `08-monitoring-queries` were run in one-off containers. Each `.sql` file has its `.out.txt` output. [^30]
- [itemid.h (REL_18_STABLE)](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/include/storage/itemid.h) — PostgreSQL source, living. Backs: line pointer flag values. [^31]

## Related
- `performance/database-query-performance.md` — query and data-path performance, where bloat from blocked vacuums shows up.
- `concurrency/index.md` — shared state and data races in application code, the other side of isolation.
