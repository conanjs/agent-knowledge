-- Experiment 03: an old snapshot (the "xmin horizon") stops VACUUM from removing dead rows,
-- and idle_in_transaction_session_timeout ends such a session.
\set ON_ERROR_STOP on
\pset pager off
DROP TABLE IF EXISTS bloat;
CREATE TABLE bloat (id int PRIMARY KEY, v int) WITH (autovacuum_enabled = off);
INSERT INTO bloat SELECT g, 0 FROM generate_series(1, 1000) g;
VACUUM bloat;

\echo '--- an "old" session opens a REPEATABLE READ snapshot and goes idle'
SELECT dblink_connect('old', 'dbname=lab application_name=old_reader');
SELECT dblink_exec('old', 'BEGIN ISOLATION LEVEL REPEATABLE READ');
SELECT * FROM dblink('old', 'SELECT count(*) FROM bloat') AS t(n bigint);

\echo '--- 3 updates of all 1000 rows -> 3000 dead versions'
UPDATE bloat SET v = v + 1;
UPDATE bloat SET v = v + 1;
UPDATE bloat SET v = v + 1;
SELECT application_name, state, backend_xid, backend_xmin, age(backend_xmin) AS xmin_age
FROM pg_stat_activity WHERE application_name = 'old_reader';

\echo '--- VACUUM while the old snapshot is open'
VACUUM (VERBOSE) bloat;

\echo '--- the old session ends its transaction; VACUUM again'
SELECT dblink_exec('old', 'COMMIT');
VACUUM (VERBOSE) bloat;
SELECT dblink_disconnect('old');

\echo '--- guard: idle_in_transaction_session_timeout = 2s ends an idle-in-transaction session'
SELECT dblink_connect('idle', 'dbname=lab application_name=idle_reader');
SELECT dblink_exec('idle', 'SET idle_in_transaction_session_timeout = ''2s''');
SELECT dblink_exec('idle', 'BEGIN ISOLATION LEVEL REPEATABLE READ');
SELECT * FROM dblink('idle', 'SELECT count(*) FROM bloat') AS t(n bigint);
SELECT count(*) AS idle_sessions_before FROM pg_stat_activity WHERE application_name = 'idle_reader';
SELECT pg_sleep(3);
SELECT count(*) AS idle_sessions_after_3s FROM pg_stat_activity WHERE application_name = 'idle_reader';
\set ON_ERROR_STOP off
SELECT * FROM dblink('idle', 'SELECT 1') AS t(x int);
\set ON_ERROR_STOP on
