#!/usr/bin/env bash
# Build the compiler image, run it the way docker-compose does (internal network, 1 GB, 2 CPUs,
# read-only root, non-root), and run the in-container self-check. Used by CI.
set -euo pipefail
cd "$(dirname "$0")/../../.."
docker build -q -f apps/compiler/Dockerfile -t linelab-compiler:check . >/dev/null
docker network inspect linelab-sandbox-check >/dev/null 2>&1 || docker network create --internal linelab-sandbox-check >/dev/null
trap 'docker rm -f linelab-compiler-check >/dev/null 2>&1 || true; docker network rm linelab-sandbox-check >/dev/null 2>&1 || true' EXIT
docker run -d --name linelab-compiler-check --network linelab-sandbox-check --memory 1g --cpus 2 --pids-limit 256 \
  --read-only --tmpfs /tmp:rw,size=512m --cap-drop ALL --security-opt no-new-privileges linelab-compiler:check >/dev/null
docker exec linelab-compiler-check node dist/selfcheck.js
