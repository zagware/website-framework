#!/usr/bin/env bash
# Measures the running stack: image size, boot-to-healthy time of the medusa container
# (stop + start with an already-migrated database, i.e. the "scale from zero" case) and
# idle memory of every container after IDLE_SECONDS.
#
#   scripts/measure.sh                          # host resources
#   CPUS=0.5 MEMORY=4g scripts/measure.sh       # emulate a Cloudflare standard-1 instance
#   CPUS=0.25 MEMORY=1g scripts/measure.sh      # emulate a Cloudflare basic instance
#
# Boot time includes the entrypoint's `medusa db:migrate` unless the container was created with
# it disabled: MEDUSA_RUN_MIGRATIONS=false docker compose up -d medusa, then export the same
# variable for this script so the final recreate keeps it.
#
# Limits are applied with `docker update`; the script recreates the container without
# limits at the end.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

IDLE_SECONDS="${IDLE_SECONDS:-30}"
image="$(docker compose config --images | grep medusa-backend)"
cid="$(docker compose ps -q medusa)"
[ -n "$cid" ] || die "medusa container not running (docker compose up -d)"

bytes="$(docker image inspect "$image" --format '{{.Size}}')"
log "image           $image  $(( bytes / 1000000 )) MB"

docker compose stop medusa >/dev/null 2>&1
if [ -n "${CPUS:-}${MEMORY:-}" ]; then
  update=()
  [ -n "${CPUS:-}" ] && update+=(--cpus "$CPUS")
  [ -n "${MEMORY:-}" ] && update+=(--memory "$MEMORY" --memory-swap "$MEMORY")
  docker update "${update[@]}" "$cid" >/dev/null
  log "limits          cpus=${CPUS:-host} memory=${MEMORY:-host}"
fi

t0="$(now_ms)"
docker compose start medusa >/dev/null 2>&1
wait_healthy 600
t1="$(now_ms)"
log "boot->healthy   $(awk "BEGIN { printf \"%.1f\", ($t1 - $t0) / 1000 }") s  (docker compose start -> GET /health 200)"

sleep "$IDLE_SECONDS"
log "idle after ${IDLE_SECONDS}s:"
docker stats --no-stream --format '  {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' \
  $(docker compose ps -q)

restarts="$(docker inspect "$cid" --format '{{.RestartCount}}')"
oom="$(docker inspect "$cid" --format '{{.State.OOMKilled}}')"
log "restarts        $restarts (OOM-killed: $oom)"

if [ -n "${CPUS:-}${MEMORY:-}" ]; then
  docker compose up -d --force-recreate --wait medusa >/dev/null 2>&1
  log "limits removed (container recreated)"
fi
