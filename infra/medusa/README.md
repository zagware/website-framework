# Medusa v2 local stack

A reproducible local [Medusa v2](https://docs.medusajs.com) backend for evaluating the
"full commerce" tier of Zagware sites. The evaluation and hosting recommendation live in
[`docs/MEDUSA.md`](../../docs/MEDUSA.md); this file is the runbook.

| Service    | Image                        | Notes                                                                 |
| ---------- | ---------------------------- | --------------------------------------------------------------------- |
| `postgres` | `postgres:16-alpine`         | volume `postgres_data`; not published to the host                    |
| `redis`    | `redis:7-alpine` (AOF on)    | cache, event bus, workflow engine, locking; not published to the host |
| `medusa`   | `zag-medusa-backend:local`   | server + admin, `MEDUSA_WORKER_MODE=shared`, `127.0.0.1:9000`         |

```
infra/medusa/
├── docker-compose.yml     # the stack; every setting has a local default
├── .env.example           # optional overrides (copy to .env, git-ignored)
├── backend/               # medusa-starter-default @ 9565d9d (Medusa 2.18.0) + Dockerfile
│   ├── medusa-config.ts   # Redis modules, optional Stripe, worker mode, CORS from env
│   ├── Dockerfile         # multi-stage: yarn build -> .medusa/server + prod deps only
│   └── docker-entrypoint.sh  # medusa db:migrate (unless worker) -> medusa start
└── scripts/
    ├── bootstrap.sh       # wait healthy, seed once, create admin, print publishable key
    ├── smoke.sh           # Store API: products -> cart -> line item -> ... -> order
    ├── measure.sh         # image size, boot-to-healthy, idle RAM (optional CPU/RAM caps)
    └── lib.sh             # shared helpers
```

## Prerequisites

Docker with Compose v2 (tested: Docker Desktop 28.0.4 / Compose 2.34 on macOS, 8 GiB VM),
`curl`, and Node (already required by the repo; the scripts use it for JSON parsing).
No Node/Yarn install is needed for the backend itself: the image build uses Corepack
to fetch Yarn 4.12.0 pinned by `backend/package.json`.

## Run it

All commands run from `infra/medusa/`.

```sh
cp .env.example .env            # optional; only needed to override defaults / add Stripe keys
docker compose up -d --build    # builds the image, starts postgres + redis + medusa, runs migrations
scripts/bootstrap.sh            # seed demo data (once), create admin user, print publishable key
scripts/smoke.sh                # Store API end-to-end check
```

- Admin dashboard: <http://localhost:9000/app> — `admin@zagware.local` / `local-admin-password`
  (override with `MEDUSA_ADMIN_EMAIL` / `MEDUSA_ADMIN_PASSWORD`).
- Health: `curl http://localhost:9000/health` → `OK`.
- Store API (every `/store/*` request needs the publishable key):

  ```sh
  curl -H 'x-publishable-api-key: pk_…' http://localhost:9000/store/products
  ```

What `bootstrap.sh` does (idempotent, safe to re-run):

1. waits for `GET /health` (the container runs `medusa db:migrate` before `medusa start`);
2. if `product` is empty, runs the starter seed
   `docker compose exec medusa ./node_modules/.bin/medusa exec ./src/scripts/seed.js`
   (region "Europe" in EUR incl. GB, 4 demo products, stock, shipping, a "Webshop" publishable key);
3. if the admin cannot log in, creates it:
   `docker compose exec medusa ./node_modules/.bin/medusa user -e <email> -p <password>`;
4. logs in (`POST /auth/user/emailpass`) and prints the publishable key from `GET /admin/api-keys?type=publishable`.

`smoke.sh` looks the key up the same way (or uses `MEDUSA_PUBLISHABLE_KEY` if set) and then drives
the Store API: list products → pick the region → priced variant → `POST /store/carts` →
`POST /store/carts/{id}/line-items` (qty 2) → email + address → shipping option →
payment collection + `pp_system_default` session → `POST /store/carts/{id}/complete` (order).
It exits non-zero on the first failing step.

### Verified output (2026-09-23)

```
$ scripts/smoke.sh
PASS  GET /health
PASS  POST /auth/user/emailpass (admin JWT)
PASS  GET /admin/api-keys -> pk_5a5ec7351...
PASS  GET /store/products -> 4 products (Medusa T-Shirt, Medusa Sweatshirt, Medusa Sweatpants, Medusa Shorts)
PASS  GET /store/regions -> Europe (eur)
PASS  variant variant_01M371G30K48Y6M93E70470026 priced 10 eur
PASS  POST /store/carts -> cart_01M371GNAXBW0YR846KS7Y1YPF
PASS  POST /store/carts/{id}/line-items -> 1 line, qty 2, subtotal 20 eur
PASS  POST /store/carts/{id} (email + address)
PASS  shipping method: Standard Shipping
PASS  payment session (pp_system_default) on pay_col_01M371GS036YYT8SASCNXY9EC7
PASS  POST /store/carts/{id}/complete -> order #1, total 30 eur
Smoke test passed.
```

## Measurements

Host: MacBook Pro i7-9750H, Docker Desktop 28.0.4 VM with 12 CPUs / 8 GiB, 2026-09-23.
Re-measure with `scripts/measure.sh` (see its header for the CPU/RAM-capped variants).

| Metric | Result | Command |
| --- | --- | --- |
| Image size | **554 MB** uncompressed, 135 MB gzipped | `docker image inspect zag-medusa-backend:local --format '{{.Size}}'`; `docker save … \| gzip \| wc -c` |
| Image build, cold cache | 219 s | `docker compose build medusa` |
| First boot, empty DB → healthy | **40.2 s** | `docker compose down -v && docker compose up -d`, poll `/health` |
| `bootstrap.sh` (seed + admin + key) | 22.7 s | `time scripts/bootstrap.sh` |
| Restart → healthy (migrated DB) | **23.1 s** with `db:migrate` / **8.0 s** with `MEDUSA_RUN_MIGRATIONS=false` | `scripts/measure.sh` |
| … at 0.5 vCPU / 4 GiB (≈ Cloudflare standard-1) | 70.2 s / 24.1 s | `CPUS=0.5 MEMORY=4g scripts/measure.sh` |
| … at 0.25 vCPU / 1 GiB (≈ Cloudflare basic) | – / 60.8 s, no OOM | `CPUS=0.25 MEMORY=1g scripts/measure.sh` |
| Idle RAM, medusa (`docker stats --no-stream`, 30 s after healthy) | **235 MiB** (272–274 MiB at 0.5 vCPU) | `scripts/measure.sh` |
| RAM after 7 checkouts | medusa 314 MiB, postgres 105 MiB, redis 11 MiB | `docker stats --no-stream` |
| Idle RAM, postgres / redis | 79 MiB / 11 MiB | `scripts/measure.sh` |
| Idle CPU, medusa | 0.01–0.04 % of one core | `docker stats` |
| Redis commands at idle | 422 / min (≈ 7/s), 13 connections | `redis-cli info stats` delta over 60 s |
| Database size | 19 MB (seed + 7 orders) | `select pg_size_pretty(pg_database_size('medusa'))` |

The CPU/RAM caps are applied with `docker update` (CFS quota on a laptop core), so they approximate
rather than reproduce Cloudflare's instance types. Interpretation and costs: [`docs/MEDUSA.md`](../../docs/MEDUSA.md).

## Configuration

Everything is environment-driven (`docker-compose.yml` defaults, overridden by `.env`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `STORE_CORS` | `http://localhost:4173,http://127.0.0.1:4173` | storefront origins (4173 = zsite dev/preview server) |
| `ADMIN_CORS` / `AUTH_CORS` | `:9000` (+ `:4173` for auth) | admin dashboard / login origins |
| `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET` | empty | when the key is set, `@medusajs/medusa/payment-stripe` is registered as provider id `stripe` (`pp_stripe_stripe`); empty → only `pp_system_default` |
| `JWT_SECRET`, `COOKIE_SECRET` | local placeholders | **must** be random (`openssl rand -hex 32`) anywhere but a laptop |
| `MEDUSA_WORKER_MODE` | `shared` | `server` / `worker` for a production split (two containers, same image) |
| `MEDUSA_RUN_MIGRATIONS` | `true` | entrypoint runs `medusa db:migrate` first (skipped when `worker`) |
| `MEDUSA_COOKIE_SECURE` | `false` | the image runs with `NODE_ENV=production`, whose admin session cookie is `Secure`; browsers drop it over plain-HTTP localhost. Never set on HTTPS deployments |
| `MEDUSA_BACKEND_URL` | `/` | admin → API URL, **inlined at build time** (build arg) |
| `DATABASE_SSL` | unset | `true` for managed Postgres (Neon, Supabase, …) |
| `CACHE_REDIS_URL`, `LOCKING_REDIS_URL` | `REDIS_URL` | optional separate Redis for cache / locks |

Redis-backed modules configured in `medusa-config.ts` (per the
[deployment guide](https://docs.medusajs.com/learn/deployment/general)): Caching
(`@medusajs/caching-redis`), Event Bus (`event-bus-redis`), Workflow Engine
(`workflow-engine-redis`), Locking (`locking-redis`). Files use the default Local File provider
(`/server/static`, volume `medusa_static`); production would use the S3 provider against R2.

### Stripe

1. Put **test** keys in `.env`: `STRIPE_API_KEY=sk_test_…` (and `STRIPE_WEBHOOK_SECRET=whsec_…`),
   then `docker compose up -d medusa` (recreates the container with the new env).
2. Admin → Settings → Regions → Europe → enable the Stripe provider (or via the Admin API).
3. Webhooks: `https://<backend>/hooks/payment/stripe_stripe`, events `payment_intent.succeeded`,
   `payment_intent.amount_capturable_updated`, `payment_intent.payment_failed`,
   `payment_intent.partially_funded`. Locally: `stripe listen --forward-to localhost:9000/hooks/payment/stripe_stripe`.

Verified: with `STRIPE_API_KEY=sk_test_placeholder_not_real docker compose up -d medusa`,
`GET /admin/payments/payment-providers` lists `pp_stripe_stripe` (plus the Bancontact, BLIK,
giropay, iDEAL, OXXO, PromptPay and Przelewy24 variants) next to `pp_system_default`; without the
key only `pp_system_default` is loaded. A real test key is needed to exercise actual payments.

The storefront then creates a payment session with `provider_id: "pp_stripe_stripe"` and confirms
the returned PaymentIntent client secret with Stripe.js (Payment Element) — unlike the stripe-lite
tier there is no hosted Checkout page.

## Everyday commands

```sh
docker compose logs -f medusa                 # logs
docker compose exec postgres psql -U medusa    # SQL shell
docker compose up -d --build medusa           # rebuild after changing backend/ (migrations run on start)
docker compose down                           # stop, keep data (volumes)
docker compose down -v                        # stop and DELETE all data
```

Upgrading Medusa: bump the four `@medusajs/*` versions (and `@medusajs/test-utils`) in
`backend/package.json`, regenerate the lockfile (`docker run --rm -v "$PWD/backend:/w" -w /w node:22-alpine
sh -c 'corepack enable && yarn install'`), rebuild, run `scripts/smoke.sh`. Read the
[release notes](https://github.com/medusajs/medusa/releases) first; minor versions ship data migrations.

## Differences from the upstream starter

- `medusa-config.ts`: Redis modules, optional Stripe, `workerMode`, admin `disable`/`backendUrl`,
  Postgres SSL switch, `cookieOptions` switch — all from env.
- `package.json`: `packageManager: yarn@4.12.0` (Corepack) instead of the vendored 3 MB
  `.yarn/releases` binary; `predeploy` script (`medusa db:migrate`) from the deployment guide.
- Added `Dockerfile`, `.dockerignore`, `docker-entrypoint.sh`; removed the starter's README,
  `.env.template`, `.github/` and `.vscode/`.
