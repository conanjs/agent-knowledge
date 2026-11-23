-- Experiment 04: freezing. What VACUUM and VACUUM (FREEZE) do to xmin, the infomask
-- bits, the visibility map and pg_class.relfrozenxid.
\set ON_ERROR_STOP on
\pset pager off
CREATE EXTENSION IF NOT EXISTS pg_visibility;
SHOW vacuum_freeze_min_age;
SHOW vacuum_freeze_table_age;
SHOW autovacuum_freeze_max_age;
SHOW vacuum_failsafe_age;

DROP TABLE IF EXISTS frz;
CREATE TABLE frz (id int, pad text) WITH (autovacuum_enabled = off);
INSERT INTO frz SELECT g, repeat('x', 100) FROM generate_series(1, 2000) g;
SELECT relpages, relfrozenxid, age(relfrozenxid) FROM pg_class WHERE relname = 'frz';

\echo '--- burn 5000 XIDs (each loop iteration is its own committed transaction)'
DO $$ BEGIN
  FOR i IN 1..5000 LOOP PERFORM pg_current_xact_id(); COMMIT; END LOOP;
END $$;
SELECT relfrozenxid, age(relfrozenxid) FROM pg_class WHERE relname = 'frz';
-- Those 5000 transactions wrote no WAL, so they commit asynchronously; wait for the WAL
-- writer to flush them, or VACUUM cannot set hint bits yet (see 04b-allvisible-check.sql).
SELECT pg_sleep(2);

\echo '--- plain VACUUM: rows are younger than vacuum_freeze_min_age (50M), so few or none are frozen'
VACUUM (VERBOSE) frz;
SELECT relfrozenxid, age(relfrozenxid), relallvisible, relallfrozen FROM pg_class WHERE relname = 'frz';
SELECT sum(all_visible::int) AS pages_all_visible, sum(all_frozen::int) AS pages_all_frozen
FROM pg_visibility_map('frz');
SELECT lp, t_xmin, to_hex(t_infomask) AS infomask,
       (t_infomask & x'0300'::int) = x'0300'::int AS xmin_frozen
FROM heap_page_items(get_raw_page('frz', 0)) LIMIT 2;

\echo '--- VACUUM (FREEZE): same as vacuum_freeze_min_age = 0 and vacuum_freeze_table_age = 0'
VACUUM (FREEZE, VERBOSE) frz;
SELECT relfrozenxid, age(relfrozenxid), relallvisible, relallfrozen FROM pg_class WHERE relname = 'frz';
SELECT sum(all_visible::int) AS pages_all_visible, sum(all_frozen::int) AS pages_all_frozen
FROM pg_visibility_map('frz');
\echo '--- the original xmin is kept; only the infomask bits say "frozen"'
SELECT lp, t_xmin, to_hex(t_infomask) AS infomask,
       (t_infomask & x'0300'::int) = x'0300'::int AS xmin_frozen
FROM heap_page_items(get_raw_page('frz', 0)) LIMIT 2;
SELECT xmin, age(xmin) AS age_of_raw_xmin FROM frz LIMIT 1;

\echo '--- an UPDATE clears the all-frozen bit of the page it touches'
UPDATE frz SET pad = 'y' WHERE id = 1;
SELECT blkno, all_visible, all_frozen FROM pg_visibility_map('frz') WHERE blkno = 0;

\echo '--- the monitoring queries from the docs'
SELECT c.oid::regclass AS table_name,
       greatest(age(c.relfrozenxid), age(t.relfrozenxid)) AS age
FROM pg_class c LEFT JOIN pg_class t ON c.reltoastrelid = t.oid
WHERE c.relkind IN ('r', 'm') ORDER BY 2 DESC LIMIT 5;
SELECT datname, datfrozenxid, age(datfrozenxid), datminmxid, mxid_age(datminmxid) FROM pg_database ORDER BY 3 DESC;
