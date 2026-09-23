#!/bin/sh
# Runs pending migrations + link sync, then starts Medusa in $MEDUSA_WORKER_MODE.
# A dedicated worker instance (MEDUSA_WORKER_MODE=worker) skips migrations so
# only the server/shared instance owns schema changes.
set -e

if [ "${MEDUSA_RUN_MIGRATIONS:-true}" = "true" ] && [ "${MEDUSA_WORKER_MODE:-shared}" != "worker" ]; then
  echo "[entrypoint] medusa db:migrate"
  ./node_modules/.bin/medusa db:migrate
fi

echo "[entrypoint] medusa start (worker mode: ${MEDUSA_WORKER_MODE:-shared})"
exec ./node_modules/.bin/medusa start
