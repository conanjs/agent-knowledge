#!/bin/sh
# Builds and runs et_lab.c in a local Linux container (no network, no image pull).
# Image: any local image with gcc + musl-dev (here: an Alpine 3.20 image with gcc).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
image=${IMAGE:-linlab:1}
docker run --rm --pull=never --network none -v "$here":/exp -w /exp "$image" \
  sh -c 'gcc -O1 -Wall -pthread -o /tmp/et_lab et_lab.c && /tmp/et_lab'
