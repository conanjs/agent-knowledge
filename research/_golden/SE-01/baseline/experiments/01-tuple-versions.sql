-- Experiment 01: what INSERT, UPDATE and DELETE do to row versions (tuples).
-- Runs in database "lab" of a throwaway PostgreSQL 18.3 container (see run-01-03.sh).
\set ON_ERROR_STOP on
\pset pager off
SELECT version();

CREATE EXTENSION IF NOT EXISTS pageinspect;
CREATE EXTENSION IF NOT EXISTS dblink;

DROP TABLE IF EXISTS acct;
-- autovacuum off for this table only, so nothing cleans up behind our back
CREATE TABLE acct (id int PRIMARY KEY, owner text, balance int)
  WITH (autovacuum_enabled = off);

\echo '--- 1. INSERT in transaction T1'
BEGIN;
INSERT INTO acct VALUES (1, 'ann', 100), (2, 'bob', 50);
SELECT pg_current_xact_id() AS t1_xid;
COMMIT;
SELECT ctid, xmin, xmax, * FROM acct ORDER BY id;

\echo '--- 2. UPDATE id=1 in transaction T2 (balance is not indexed -> HOT update)'
BEGIN;
UPDATE acct SET balance = 90 WHERE id = 1;
SELECT pg_current_xact_id() AS t2_xid;
COMMIT;
SELECT ctid, xmin, xmax, * FROM acct ORDER BY id;

\echo '--- 3. DELETE id=2 in transaction T3'
BEGIN;
DELETE FROM acct WHERE id = 2;
SELECT pg_current_xact_id() AS t3_xid;
COMMIT;
SELECT ctid, xmin, xmax, * FROM acct ORDER BY id;

\echo '--- 4. Raw page 0: every tuple still physically there (pageinspect)'
SELECT lp, lp_flags, t_xmin, t_xmax, t_ctid,
       to_hex(t_infomask)  AS infomask,
       to_hex(t_infomask2) AS infomask2,
       (t_infomask & x'0100'::int) <> 0 AS xmin_committed_hint,
       (t_infomask & x'0800'::int) <> 0 AS xmax_invalid_hint,
       (t_infomask2 & x'4000'::int) <> 0 AS hot_updated,
       (t_infomask2 & x'8000'::int) <> 0 AS heap_only
FROM heap_page_items(get_raw_page('acct', 0));

\echo '--- 5. Statistics view counts dead tuples (may lag: stats are flushed asynchronously)'
SELECT pg_sleep(1.5);
SELECT n_live_tup, n_dead_tup, n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relname = 'acct';

\echo '--- 6. ROLLBACK leaves an aborted version behind'
BEGIN;
UPDATE acct SET balance = 0 WHERE id = 1;
SELECT pg_current_xact_id() AS t4_xid_rolled_back \gset
ROLLBACK;
SELECT ctid, xmin, xmax, * FROM acct ORDER BY id;
\echo 'T4 xid was' :t4_xid_rolled_back
SELECT pg_xact_status(:'t4_xid_rolled_back'::xid8) AS status_of_t4;
SELECT lp, lp_flags, t_xmin, t_xmax, t_ctid, to_hex(t_infomask) AS infomask
FROM heap_page_items(get_raw_page('acct', 0));

\echo '--- 7. VACUUM (VERBOSE): dead versions removed, line pointers reusable'
VACUUM (VERBOSE) acct;
SELECT lp, lp_flags, t_xmin, t_xmax, t_ctid, to_hex(t_infomask) AS infomask
FROM heap_page_items(get_raw_page('acct', 0));

\echo '--- 8. Two sessions lock the same row FOR SHARE -> xmax becomes a MultiXactId'
INSERT INTO acct VALUES (3, 'cat', 10);
SELECT dblink_connect('s2', 'dbname=lab');
BEGIN;
SELECT id FROM acct WHERE id = 3 FOR SHARE;
SELECT dblink_exec('s2', 'BEGIN');
SELECT * FROM dblink('s2', 'SELECT id FROM acct WHERE id = 3 FOR SHARE') AS t(id int);
SELECT xmax, ctid, (ctid::text::point)[1]::int AS lpno FROM acct WHERE id = 3 \gset
\echo 'row id=3: xmax =' :xmax ', ctid =' :ctid
SELECT lp, t_xmin, t_xmax, to_hex(t_infomask) AS infomask,
       (t_infomask & x'1000'::int) <> 0 AS xmax_is_multi,
       (t_infomask & x'0080'::int) <> 0 AS xmax_lock_only
FROM heap_page_items(get_raw_page('acct', 0)) WHERE lp = :lpno;
SELECT * FROM pg_get_multixact_members(:'xmax');
COMMIT;
SELECT dblink_exec('s2', 'COMMIT');
SELECT dblink_disconnect('s2');
