#!/usr/bin/env bash
# Store API smoke test against a running, bootstrapped stack:
#   products -> region -> cart -> line item -> address + shipping -> payment session -> order.
# Uses MEDUSA_PUBLISHABLE_KEY when set, otherwise logs in as the local admin to look it up.
# Exits non-zero on the first failing step.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

wait_healthy 60
ok "GET /health"

if [ -n "${MEDUSA_PUBLISHABLE_KEY:-}" ]; then
  PUBLISHABLE_KEY="$MEDUSA_PUBLISHABLE_KEY"
else
  admin_login || die "admin login failed for $ADMIN_EMAIL (run scripts/bootstrap.sh first)"
  ok "POST /auth/user/emailpass (admin JWT)"
  PUBLISHABLE_KEY="$(publishable_key)"
  [ -n "$PUBLISHABLE_KEY" ] || die "no publishable API key (run scripts/bootstrap.sh first)"
  ok "GET /admin/api-keys -> ${PUBLISHABLE_KEY:0:12}..."
  unset ADMIN_TOKEN
fi

# 1. Catalogue
res="$(api GET '/store/products?limit=50&fields=id,title,handle')"
count="$(printf '%s' "$res" | json count)"
[ "${count:-0}" -gt 0 ] || die "GET /store/products returned no products: $res"
titles="$(printf '%s' "$res" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).products.map(p=>p.title).join(", ")))')"
ok "GET /store/products -> $count products ($titles)"

# 2. Region (the starter seed creates "Europe", EUR, incl. gb)
res="$(api GET '/store/regions?fields=id,name,currency_code')"
region_id="$(printf '%s' "$res" | json regions.0.id)"
currency="$(printf '%s' "$res" | json regions.0.currency_code)"
[ -n "$region_id" ] || die "no regions: $res"
ok "GET /store/regions -> $(printf '%s' "$res" | json regions.0.name) ($currency)"

# 3. A priced variant in that region
res="$(api GET "/store/products?limit=1&region_id=$region_id&fields=id,title,*variants.calculated_price")"
variant_id="$(printf '%s' "$res" | json products.0.variants.0.id)"
price="$(printf '%s' "$res" | json products.0.variants.0.calculated_price.calculated_amount)"
[ -n "$variant_id" ] && [ -n "$price" ] || die "no priced variant: $res"
ok "variant $variant_id priced $price $currency"

# 4. Cart + line item
res="$(api POST /store/carts "{\"region_id\":\"$region_id\"}")"
cart_id="$(printf '%s' "$res" | json cart.id)"
[ -n "$cart_id" ] || die "cart not created: $res"
ok "POST /store/carts -> $cart_id"

res="$(api POST "/store/carts/$cart_id/line-items" "{\"variant_id\":\"$variant_id\",\"quantity\":2}")"
items="$(printf '%s' "$res" | json cart.items.length)"
qty="$(printf '%s' "$res" | json cart.items.0.quantity)"
[ "$items" = "1" ] && [ "$qty" = "2" ] || die "line item not added: $res"
ok "POST /store/carts/{id}/line-items -> 1 line, qty 2, subtotal $(printf '%s' "$res" | json cart.item_subtotal) $currency"

# 5. Checkout details: email + address, cheapest shipping option
address='{"first_name":"Smoke","last_name":"Test","address_1":"1 Test Street","city":"Belfast","postal_code":"BT1 1AA","country_code":"gb"}'
api POST "/store/carts/$cart_id" "{\"email\":\"smoke@example.com\",\"shipping_address\":$address,\"billing_address\":$address}" >/dev/null
ok "POST /store/carts/{id} (email + address)"

res="$(api GET "/store/shipping-options?cart_id=$cart_id")"
option_id="$(printf '%s' "$res" | json shipping_options.0.id)"
[ -n "$option_id" ] || die "no shipping options: $res"
api POST "/store/carts/$cart_id/shipping-methods" "{\"option_id\":\"$option_id\"}" >/dev/null
ok "shipping method: $(printf '%s' "$res" | json shipping_options.0.name)"

# 6. Payment: manual system provider (Stripe would be pp_stripe_stripe once STRIPE_API_KEY is set
#    and the provider is enabled on the region)
res="$(api POST /store/payment-collections "{\"cart_id\":\"$cart_id\"}")"
pc_id="$(printf '%s' "$res" | json payment_collection.id)"
[ -n "$pc_id" ] || die "no payment collection: $res"
api POST "/store/payment-collections/$pc_id/payment-sessions" '{"provider_id":"pp_system_default"}' >/dev/null
ok "payment session (pp_system_default) on $pc_id"

# 7. Complete -> order
res="$(api POST "/store/carts/$cart_id/complete")"
[ "$(printf '%s' "$res" | json type)" = "order" ] || die "cart not completed: $res"
ok "POST /store/carts/{id}/complete -> order #$(printf '%s' "$res" | json order.display_id), total $(printf '%s' "$res" | json order.total) $currency"

log "Smoke test passed."
