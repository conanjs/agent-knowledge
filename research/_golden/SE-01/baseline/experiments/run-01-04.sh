#!/usr/bin/env bash
# Runs experiments 01-04 and 06 in a throwaway PostgreSQL container (local image postgres:latest = 18.3).
# No port is published, so nothing is reachable from outside the container.
# Output: <name>.out.txt next to each .sql file.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME=se01-mvcc-lab
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_HOST_AUTH_METHOD=trust \
  -v "$HERE":/exp:ro postgres:latest \
  -c log_autovacuum_min_duration=0 >/dev/null
until docker exec "$NAME" pg_isready -U postgres -q; do sleep 1; done
sleep 2
docker exec "$NAME" psql -U postgres -qc 'CREATE DATABASE lab'
for f in 01-tuple-versions 02-snapshots 03-horizon 04-freezing 06-xid-consumption; do
  echo "== $f"
  docker exec "$NAME" psql -U postgres -d lab -X -e -f "/exp/$f.sql" > "$HERE/$f.out.txt" 2>&1 || echo "  (non-zero exit, see $f.out.txt)"
done
docker rm -f "$NAME" >/dev/null
