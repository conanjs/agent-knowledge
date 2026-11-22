#!/usr/bin/env bash
# Experiment 05: drive a throwaway PostgreSQL 18.3 cluster into the XID warning zone and then
# past the XID stop limit, with a forgotten logical replication slot holding back freezing,
# then recover the way the docs describe (remove the blocker, VACUUM, no single-user mode).
#
# How the XID counter is moved: pg_resetwal -x (a last-resort repair tool; never on real data).
# The target values are multiples of 1048576 (one pg_xact segment), as pg_resetwal's docs ask.
# Lab only: own Docker volume, no published port, deleted at the end.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME=se01-wrap-lab
VOL=se01-wrap-data
IMG=postgres:latest
PGDATA=/var/lib/postgresql/18/docker
OUT="$HERE/05-wraparound.out.txt"
: > "$OUT"
log() { echo "$@" | tee -a "$OUT"; }
q() { # q <db> <sql>
  log "lab=# [$1] $2"
  docker exec "$NAME" psql -U postgres -d "$1" -X -c "$2" >>"$OUT" 2>&1
}
start() {
  docker run -d --name "$NAME" -e POSTGRES_HOST_AUTH_METHOD=trust -v "$VOL":/var/lib/postgresql "$IMG" \
    -c wal_level=logical -c autovacuum_naptime=2s -c log_autovacuum_min_duration=0 >/dev/null
  until docker exec "$NAME" pg_isready -U postgres -q 2>/dev/null; do sleep 1; done
  sleep 1
}
stop() { # keeps only the wraparound-related server log lines (the full log is megabytes of repeats)
  docker stop -t 60 "$NAME" >/dev/null
  docker logs "$NAME" 2>&1 | grep -E "must be vacuumed|not accepting|failsafe|to prevent wraparound|far in the past|ready to accept" \
    | head -40 > "$HERE/05-server-log-$1.txt"
  docker rm "$NAME" >/dev/null
}
controldata() {
  log "\$ pg_controldata | grep -E 'NextXID|oldestXID'"
  docker run --rm -u postgres -v "$VOL":/var/lib/postgresql "$IMG" pg_controldata -D "$PGDATA" \
    | grep -E "NextXID|oldestXID" | tee -a "$OUT"
}
resetxid() {
  log "\$ pg_resetwal -x $1"
  docker run --rm -u postgres -v "$VOL":/var/lib/postgresql "$IMG" pg_resetwal -x "$1" -D "$PGDATA" 2>&1 | tee -a "$OUT"
}

docker rm -f "$NAME" >/dev/null 2>&1; docker volume rm "$VOL" >/dev/null 2>&1
docker volume create "$VOL" >/dev/null

log "=== Step 1. Fresh cluster; a logical replication slot is created and then forgotten"
start
docker exec "$NAME" psql -U postgres -qc 'CREATE DATABASE lab'
q lab "SELECT version()"
q lab "CREATE TABLE t (id int GENERATED ALWAYS AS IDENTITY, v int); INSERT INTO t (v) SELECT g FROM generate_series(1,1000) g"
q lab "SELECT slot_name FROM pg_create_logical_replication_slot('forgotten_slot', 'test_decoding')"
q lab "SELECT slot_name, slot_type, active, xmin, catalog_xmin FROM pg_replication_slots"
q lab "SELECT pg_current_xact_id() AS next_xid_now"
q lab "SELECT datname, datfrozenxid, age(datfrozenxid) FROM pg_database ORDER BY datname"
OLDEST=$(docker exec "$NAME" psql -U postgres -d lab -XAtc "SELECT min(datfrozenxid::text::bigint) FROM pg_database")
q lab "CHECKPOINT"
stop 1
controldata

WRAP=$(( OLDEST + 2147483647 ))
WARN=$(( WRAP - 40000000 ))
STOPL=$(( WRAP - 3000000 ))
SEG=1048576
T1=$(( (WARN + SEG - 1) / SEG * SEG ))
T2=$(( (STOPL + SEG - 1) / SEG * SEG ))
log "oldest datfrozenxid = $OLDEST"
log "computed (PG 18 varsup.c): wrap limit = $WRAP, warn limit = $WARN, stop limit = $STOPL"
log "jump targets: T1 = $T1 (between warn and stop), T2 = $T2 (past stop, before wrap)"

log ""
log "=== Step 2. Jump the XID counter into the warning zone"
resetxid "$T1"
controldata
start
log "(wait 10 s so that autovacuum has had a few rounds; autovacuum_naptime = 2s)"
sleep 10
q lab "INSERT INTO t (v) VALUES (1)"
q lab "SELECT datname, datfrozenxid, age(datfrozenxid) FROM pg_database ORDER BY 3 DESC"
q lab "SELECT slot_name, active, catalog_xmin, age(catalog_xmin) FROM pg_replication_slots"
q lab "SELECT c.oid::regclass AS table_name, age(c.relfrozenxid) FROM pg_class c WHERE c.relkind IN ('r','m') ORDER BY 2 DESC LIMIT 3"
q lab "SELECT c.oid::regclass AS table_name, age(c.relfrozenxid) FROM pg_class c WHERE c.relname = 't'"
log "--- VACUUM of a catalog that the slot holds back (age > vacuum_failsafe_age = 1.6 billion)"
q lab "VACUUM (VERBOSE) pg_catalog.pg_class"
stop 2
log "--- autovacuum log lines from the server log (first 6)"
head -6 "$HERE/05-server-log-2.txt" | tee -a "$OUT"

log ""
log "=== Step 3. Jump past the stop limit"
resetxid "$T2"
start
sleep 10
q lab "INSERT INTO t (v) VALUES (2)"
q lab "SELECT count(*) AS reads_still_work FROM t"
q lab "CREATE TABLE should_fail (x int)"

log ""
log "=== Step 4. Diagnose with the three queries from the docs"
q lab "SELECT gid, prepared, age(transaction) FROM pg_prepared_xacts"
q lab "SELECT pid, datname, state, age(backend_xid) AS xid_age, age(backend_xmin) AS xmin_age FROM pg_stat_activity WHERE backend_xid IS NOT NULL OR backend_xmin IS NOT NULL ORDER BY 5 DESC NULLS LAST"
q lab "SELECT slot_name, slot_type, active, age(xmin) AS xmin_age, age(catalog_xmin) AS catalog_xmin_age FROM pg_replication_slots"

log ""
log "=== Step 5. Recover: drop the slot, then a database-wide VACUUM in every database"
q lab "SELECT pg_drop_replication_slot('forgotten_slot')"
SECONDS=0
log "\$ vacuumdb --all (skips template0, which does not accept connections; autovacuum covers it)"
VAC=$(docker exec "$NAME" vacuumdb -U postgres --all 2>&1)
echo "$VAC" | grep -v '^vacuumdb: vacuuming' | head -4 | tee -a "$OUT"
log "(vacuumdb printed $(echo "$VAC" | grep -c bypassing) failsafe warnings in all; databases: $(echo "$VAC" | grep -c '^vacuumdb: vacuuming'))"
log "vacuumdb took ${SECONDS}s"
for i in $(seq 1 15); do
  AGE=$(docker exec "$NAME" psql -U postgres -d lab -XAtc "SELECT max(age(datfrozenxid)) FROM pg_database")
  log "t+${SECONDS}s: oldest database age = $AGE"
  [ "$AGE" -lt 100000000 ] && break
  sleep 2
done
q lab "SELECT datname, datfrozenxid, age(datfrozenxid) FROM pg_database ORDER BY 3 DESC"
q lab "INSERT INTO t (v) VALUES (3)"
q lab "SELECT count(*) FROM t"
stop 3
controldata
docker volume rm "$VOL" >/dev/null
log "done"
