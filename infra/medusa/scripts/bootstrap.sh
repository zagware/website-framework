#!/usr/bin/env bash
# Idempotent first-run setup, after `docker compose up -d --build`:
#   1. wait for /health (the container runs `medusa db:migrate` before starting)
#   2. seed the starter demo data if the database has no products
#   3. create the local admin user if it cannot log in yet
#   4. print the publishable API key the storefront must send as x-publishable-api-key
set -euo pipefail
. "$(dirname "$0")/lib.sh"

log "Waiting for $BASE_URL/health ..."
wait_healthy 300
ok "server healthy"

products="$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-medusa}" -d "${POSTGRES_DB:-medusa}" -tAc \
  'select count(*) from product where deleted_at is null')"
if [ "${products//[[:space:]]/}" = "0" ]; then
  log "Seeding starter demo data (src/scripts/seed.ts) ..."
  docker compose exec -T medusa ./node_modules/.bin/medusa exec ./src/scripts/seed.js
  ok "seeded"
else
  ok "database already has ${products//[[:space:]]/} products, seed skipped"
fi

if admin_login; then
  ok "admin user $ADMIN_EMAIL exists"
else
  log "Creating admin user $ADMIN_EMAIL ..."
  docker compose exec -T medusa ./node_modules/.bin/medusa user -e "$ADMIN_EMAIL" -p "$ADMIN_PASSWORD"
  admin_login || die "admin login failed after creating $ADMIN_EMAIL"
  ok "admin user created"
fi

key="$(publishable_key)"
[ -n "$key" ] || die "no publishable API key found (did the seed run?)"
ok "publishable API key: $key"
log ""
log "Admin dashboard: $BASE_URL/app  ($ADMIN_EMAIL)"
log "Store API:       curl -H 'x-publishable-api-key: $key' $BASE_URL/store/products"
