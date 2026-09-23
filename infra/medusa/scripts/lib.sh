# Shared helpers for bootstrap.sh / smoke.sh / measure.sh. Source, don't execute.
# Requires: docker compose, curl, node (JSON parsing; already a repo prerequisite).

MEDUSA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MEDUSA_DIR"
if [ -f .env ]; then set -a; . ./.env; set +a; fi

BASE_URL="${MEDUSA_URL:-http://localhost:${MEDUSA_PORT:-9000}}"
ADMIN_EMAIL="${MEDUSA_ADMIN_EMAIL:-admin@zagware.local}"
ADMIN_PASSWORD="${MEDUSA_ADMIN_PASSWORD:-local-admin-password}"

log() { printf '%s\n' "$*"; }
ok() { printf 'PASS  %s\n' "$*"; }
die() { printf 'FAIL  %s\n' "$*" >&2; exit 1; }
now_ms() { node -e 'process.stdout.write(String(Date.now()))'; }

# json <path> : read JSON on stdin, print the value at a dotted path ("products.0.id",
# "items.length"). Objects/arrays print as JSON, missing values print nothing.
json() {
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let o = JSON.parse(s);
      for (const k of process.argv[1].split(".").filter(Boolean)) o = o == null ? o : o[k];
      process.stdout.write(o == null ? "" : typeof o === "object" ? JSON.stringify(o) : String(o));
    });' "$1"
}

# api <METHOD> <path> [json-body] : prints the response body; fails on HTTP >= 400.
# Adds the publishable key ($PUBLISHABLE_KEY) and admin bearer token ($ADMIN_TOKEN) when set.
api() {
  local method="$1" path="$2" body="${3:-}" out status
  local args=(-sS -X "$method" -o - -w '\n%{http_code}' -H 'content-type: application/json')
  [ -n "${PUBLISHABLE_KEY:-}" ] && args+=(-H "x-publishable-api-key: $PUBLISHABLE_KEY")
  [ -n "${ADMIN_TOKEN:-}" ] && args+=(-H "authorization: Bearer $ADMIN_TOKEN")
  [ -n "$body" ] && args+=(--data "$body")
  out="$(curl "${args[@]}" "$BASE_URL$path")" || die "$method $path: curl failed"
  status="${out##*$'\n'}"
  out="${out%$'\n'*}"
  if [ "$status" -ge 400 ]; then die "$method $path -> HTTP $status: $out"; fi
  printf '%s' "$out"
}

# wait_healthy [timeout-seconds] : poll GET /health until it answers 200.
wait_healthy() {
  local timeout="${1:-180}" start
  start="$(date +%s)"
  until curl -fsS -o /dev/null "$BASE_URL/health" 2>/dev/null; do
    [ $(( $(date +%s) - start )) -ge "$timeout" ] && die "Medusa not healthy at $BASE_URL/health after ${timeout}s (docker compose logs medusa)"
    sleep 0.5
  done
}

# admin_login : sets ADMIN_TOKEN (JWT) for the local admin user; returns 1 if login fails.
admin_login() {
  local res
  res="$(curl -sS -X POST -H 'content-type: application/json' \
    --data "$(node -e 'process.stdout.write(JSON.stringify({ email: process.argv[1], password: process.argv[2] }))' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")" \
    "$BASE_URL/auth/user/emailpass")" || return 1
  ADMIN_TOKEN="$(printf '%s' "$res" | json token)"
  [ -n "$ADMIN_TOKEN" ]
}

# publishable_key : prints the first active publishable API key (needs ADMIN_TOKEN).
publishable_key() {
  api GET "/admin/api-keys?type=publishable&fields=id,title,token" | json api_keys.0.token
}
