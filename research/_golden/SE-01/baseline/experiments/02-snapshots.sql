-- Experiment 02: snapshots. Session A is this psql session; session B is a second
-- connection opened through dblink, so both run concurrently in one script.
\set ON_ERROR_STOP on
\pset pager off
DROP TABLE IF EXISTS acct2;
CREATE TABLE acct2 (id int PRIMARY KEY, balance int) WITH (autovacuum_enabled = off);
INSERT INTO acct2 VALUES (1, 90);
SELECT dblink_connect('b', 'dbname=lab');

\echo '=== A. REPEATABLE READ: one snapshot for the whole transaction'
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT ctid, xmin, xmax, balance FROM acct2 WHERE id = 1;   -- snapshot taken here
SELECT pg_current_snapshot() AS a_snapshot;
\echo '--- B updates the row to 80 and commits (autocommit)'
SELECT dblink_exec('b', 'UPDATE acct2 SET balance = 80 WHERE id = 1');
\echo '--- A reads again: still the old version'
SELECT ctid, xmin, xmax, balance FROM acct2 WHERE id = 1;
\echo '--- A tries to update the same row'
\set ON_ERROR_STOP off
UPDATE acct2 SET balance = balance - 10 WHERE id = 1;
\set ON_ERROR_STOP on
ROLLBACK;

\echo '=== B. READ COMMITTED (default): a new snapshot for every statement'
BEGIN;
SELECT balance FROM acct2 WHERE id = 1;
SELECT dblink_exec('b', 'UPDATE acct2 SET balance = 70 WHERE id = 1');
SELECT balance FROM acct2 WHERE id = 1;
COMMIT;

\echo '=== C. An in-progress writer appears in the snapshot xip list'
SELECT dblink_exec('b', 'BEGIN');
SELECT dblink_exec('b', 'INSERT INTO acct2 VALUES (2, 5)');
SELECT * FROM dblink('b', 'SELECT pg_current_xact_id()::text') AS t(b_xid text);
SELECT pg_current_snapshot() AS a_snapshot_while_b_open;
\echo '--- A commits a write of its own (gets a higher XID than B) while B is still open'
INSERT INTO acct2 VALUES (3, 1);
SELECT pg_current_snapshot() AS a_snapshot_after_own_commit;
SELECT pg_visible_in_snapshot(pg_snapshot_xmin(pg_current_snapshot()), pg_current_snapshot()) AS b_xid_visible;
SELECT id FROM acct2 ORDER BY id;  -- A sees 1 and its own 3, not B's 2
SELECT * FROM dblink('b', 'SELECT id FROM acct2 ORDER BY id') AS t(ids_b_sees int);
SELECT dblink_exec('b', 'COMMIT');
SELECT id AS ids_a_sees_after_b_commit FROM acct2 ORDER BY id;
SELECT dblink_disconnect('b');

\echo '=== D. A read-only transaction gets no XID (only a virtual one)'
BEGIN;
SELECT count(*) FROM acct2;
SELECT pg_current_xact_id_if_assigned() AS xid_if_assigned,
       (SELECT virtualtransaction FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'virtualxid') AS vxid;
COMMIT;
