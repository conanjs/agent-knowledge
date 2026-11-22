-- Experiment 04b: why did plain VACUUM in 04 set no page all-visible?
-- Hypothesis: the XIDs burnt by the DO loop commit asynchronously (they wrote no WAL),
-- so the commit LSN kept for xid 778's clog group is not yet flushed; SetHintBits then
-- refuses to set HEAP_XMIN_COMMITTED, and VACUUM needs that hint to call a page all-visible.
\set ON_ERROR_STOP on
\pset pager off
CREATE EXTENSION IF NOT EXISTS pg_visibility;
CREATE EXTENSION IF NOT EXISTS pageinspect;
\echo '--- case 1: no XID burning after the INSERT'
CREATE TABLE c1 (id int, pad text) WITH (autovacuum_enabled = off);
INSERT INTO c1 SELECT g, repeat('x', 100) FROM generate_series(1, 2000) g;
VACUUM (VERBOSE) c1;
SELECT sum(all_visible::int) AS c1_all_visible FROM pg_visibility_map('c1');
\echo '--- case 2: burn XIDs right after the INSERT, VACUUM immediately'
CREATE TABLE c2 (id int, pad text) WITH (autovacuum_enabled = off);
INSERT INTO c2 SELECT g, repeat('x', 100) FROM generate_series(1, 2000) g;
DO $$ BEGIN FOR i IN 1..5000 LOOP PERFORM pg_current_xact_id(); COMMIT; END LOOP; END $$;
VACUUM (VERBOSE) c2;
SELECT sum(all_visible::int) AS c2_all_visible FROM pg_visibility_map('c2');
SELECT to_hex(t_infomask) AS c2_infomask FROM heap_page_items(get_raw_page('c2', 0)) LIMIT 1;
\echo '--- case 2 again after 2 s (WAL writer has flushed the async commits)'
SELECT pg_sleep(2);
VACUUM (VERBOSE) c2;
SELECT sum(all_visible::int) AS c2_all_visible_after_sleep FROM pg_visibility_map('c2');
SELECT to_hex(t_infomask) AS c2_infomask_after_sleep FROM heap_page_items(get_raw_page('c2', 0)) LIMIT 1;
