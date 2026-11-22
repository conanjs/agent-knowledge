-- Experiment 06: what consumes XIDs from the cluster-wide counter.
\set ON_ERROR_STOP on
\pset pager off
DROP TABLE IF EXISTS c;
CREATE TABLE c (x int);
SELECT pg_current_xact_id() AS before \gset
\echo '--- 10 read-only transactions'
SELECT count(*) FROM c; SELECT count(*) FROM c; SELECT count(*) FROM c; SELECT count(*) FROM c; SELECT count(*) FROM c;
SELECT count(*) FROM c; SELECT count(*) FROM c; SELECT count(*) FROM c; SELECT count(*) FROM c; SELECT count(*) FROM c;
SELECT pg_current_xact_id() AS after_reads \gset
SELECT :'after_reads'::text::bigint - :'before'::text::bigint - 1 AS xids_used_by_10_read_only_transactions;
\echo '--- one transaction that writes inside 5 savepoints'
BEGIN;
INSERT INTO c VALUES (0);
SAVEPOINT s1; INSERT INTO c VALUES (1); RELEASE s1;
SAVEPOINT s2; INSERT INTO c VALUES (2); RELEASE s2;
SAVEPOINT s3; INSERT INTO c VALUES (3); RELEASE s3;
SAVEPOINT s4; INSERT INTO c VALUES (4); RELEASE s4;
SAVEPOINT s5; INSERT INTO c VALUES (5); RELEASE s5;
COMMIT;
SELECT pg_current_xact_id() AS after_subxacts \gset
SELECT :'after_subxacts'::text::bigint - :'after_reads'::text::bigint - 1 AS xids_used_by_1_txn_with_5_writing_savepoints;
SELECT x, xmin FROM c ORDER BY x;
\echo '--- the same 6 inserts without savepoints'
BEGIN;
INSERT INTO c VALUES (10); INSERT INTO c VALUES (11); INSERT INTO c VALUES (12);
INSERT INTO c VALUES (13); INSERT INTO c VALUES (14); INSERT INTO c VALUES (15);
COMMIT;
SELECT pg_current_xact_id() AS after_plain \gset
SELECT :'after_plain'::text::bigint - :'after_subxacts'::text::bigint - 1 AS xids_used_by_1_txn_without_savepoints;
