-- Experiment 08: the monitoring queries of the doc's playbook, run once to check syntax and output shape.
\set ON_ERROR_STOP on
\pset pager off
SELECT datname, age(datfrozenxid) AS xid_age, mxid_age(datminmxid) AS mxid_age,
       round(100.0 * age(datfrozenxid) / 2147483647, 1) AS pct_of_wrap
FROM pg_database ORDER BY xid_age DESC;
SELECT c.oid::regclass AS table_name,
       greatest(age(c.relfrozenxid), age(t.relfrozenxid)) AS age
FROM pg_class c LEFT JOIN pg_class t ON c.reltoastrelid = t.oid
WHERE c.relkind IN ('r', 'm') ORDER BY age DESC LIMIT 3;
SELECT gid, prepared, age(transaction) FROM pg_prepared_xacts ORDER BY 3 DESC;
SELECT pid, datname, state, xact_start, age(backend_xid) AS xid_age, age(backend_xmin) AS xmin_age
FROM pg_stat_activity WHERE backend_xmin IS NOT NULL OR backend_xid IS NOT NULL ORDER BY xmin_age DESC;
SELECT slot_name, slot_type, active, age(xmin) AS xmin_age, age(catalog_xmin) AS catalog_xmin_age
FROM pg_replication_slots;
SELECT pid, relid::regclass, phase, heap_blks_scanned, heap_blks_total, index_vacuum_count
FROM pg_stat_progress_vacuum;
-- burn-rate sample: run inside one transaction to prove the sample itself takes no XID
BEGIN;
SELECT now(), pg_snapshot_xmax(pg_current_snapshot()) AS next_xid_approx;
SELECT pg_current_xact_id_if_assigned() AS xid_taken_by_this_transaction;
COMMIT;
SELECT pg_snapshot_xmax(pg_current_snapshot()) AS next_xid_approx_again;
