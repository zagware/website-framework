# Commerce: tiers and recommendation

## Recommendation

Use **Stripe for payments in every tier**, and choose the backend by what the customer actually needs. Medusa + Stripe is a sound stack for real commerce. It is the wrong default for small shops, because each customer then needs a Node server, Postgres and Redis to run, patch and back up. See [MEDUSA.md](MEDUSA.md) for the measured evaluation and costs.

| Tier | Fits | Built | Extra cost per customer / month | Operates |
|---|---|---|---|---|
| **0. Informational** | Brochure, event, portfolio | ✅ | £0 (Pages / Workers static assets) | nothing |
| **1. Payment links** | 1–5 items, donations, deposits, event entries | ✅ via `cards`/`cta` links to Stripe Payment Links | £0 | Stripe dashboard |
| **2. stripe-lite** (default shop) | Up to a few dozen products with options (size/colour), flat-rate UK/IE shipping, owner fulfils from Stripe emails/dashboard | ✅ `products`, `cart`, `checkout-status` + site Worker | ≈ £0 (inside the account's Workers plan; D1 free tier) | Cloudflare + Stripe |
| **3. Medusa "commerce+"** | Stock across locations, customer accounts, returns, promotions/price lists, multi-currency/region tax, staff editing a large catalogue | Evaluated: `infra/medusa` runs a full cart → order locally | ≈ $2–8 on a shared VPS / Railway; ≈ $27–58 on Cloudflare Containers | **us** (upgrades, backups) |

Stripe's processing fees apply equally to every tier and are not counted above.

Alternatives considered:

- **Shopify Starter / Buy Button.** Good when the owner wants to manage stock themselves in a polished admin and accepts Shopify's subscription and fees.
- **Snipcart.** A drop-in cart for static sites, with a percentage fee on top of Stripe.
- **Lemon Squeezy / Paddle.** Merchant of record, so they handle VAT/sales tax on **digital** goods. Worth it for software or downloads sold internationally.

stripe-lite covers the common Zagware case: a local business selling a handful of physical products to UK/IE customers. There is no admin to secure and nothing to patch.

## How stripe-lite works

```mermaid
sequenceDiagram
  participant B as Browser (static site)
  participant W as Site Worker (/api)
  participant S as Stripe
  B->>B: basket in localStorage (display prices only)
  B->>W: POST /api/checkout {items, shippingRate, returnBase}
  W->>W: load /_z/catalog.json and re-price everything server-side
  W->>S: create Checkout Session (price_data, shipping, idempotency key)
  S-->>W: session url
  W-->>B: {url}; browser goes to Stripe hosted Checkout
  S->>W: webhook checkout.session.completed (signed)
  W->>W: verify signature; INSERT OR IGNORE order into D1
  S-->>B: redirect to /shop/success/?session_id=… (basket cleared)
```

- **The catalogue is config.** `commerce.products` in `site.config.mjs` (prices in pence) is published as `/_z/catalog.json`. The Worker prices every checkout from it and ignores client-sent prices.
- **Card data never touches our code.** Stripe hosted Checkout handles cards, Apple/Google Pay, 3-D Secure, receipts and address collection.
- **Orders.**
  - The Stripe Dashboard is the order list. Stripe emails the owner, and optionally the customer.
  - D1 keeps an order log (`worker/migrations/0001_orders.sql`) for reporting or fulfilment integrations, for example print-on-demand in the style of `selling_app`'s Inkthreadable adapter.
- **Previews.** GitHub Pages can't run the Worker. A preview therefore calls a deployed Worker that uses **test** keys:
  - Set `targets.pages.api.base`.
  - Add the Pages origin to `ALLOWED_ORIGINS`.
  - The Worker returns shoppers to the preview only if its origin is allow-listed (`returnBase`).
- **Contact forms** use the same Worker: `form.action: "worker"` posts to `/api/contact`, which stores to D1 and/or emails via Email Routing. There is a honeypot, optional Turnstile, and no JavaScript is required.

### Stripe account model

**Each customer has their own Stripe account.** They are the merchant of record, payouts go directly to them, disputes are theirs, and we never hold funds.

- The Worker gets a **restricted key** (`rk_…`) limited to Checkout Sessions (write/read). Store it with `wrangler secret put STRIPE_SECRET_KEY`. [INFERENCE: inline `price_data` should need no Products permission; confirm when creating the first live key.]
- Stripe Connect (Zagware as a platform taking an application fee) is possible later. It adds onboarding and platform liability, so only use it if the business model needs a revenue share.

### Going live checklist (per shop)

1. Customer creates or activates their Stripe account. Enable Stripe Tax if they are VAT registered and need tax lines.
2. Create a restricted live key, then `wrangler secret put STRIPE_SECRET_KEY`.
3. In Stripe → Developers → Webhooks, add `https://<domain>/api/stripe/webhook` with events `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. Then `wrangler secret put STRIPE_WEBHOOK_SECRET`.
4. Set `commerce.mode: "live"` (removes the test-mode notice), tag a release, and place one real low-value order and refund it.

## Next steps for commerce (not built yet)

- **Catalogue from Stripe Products** (`commerce.source: "stripe"`, read at build time). The owner edits products in the Stripe Dashboard, and a Stripe webhook triggers a rebuild. This gives self-service product edits without Medusa.
- **Medusa storefront adapter** for tier 3. The catalogue is rendered from `/store/products` at build time; cart and checkout call the Store API from the browser. Build it only when the first commerce+ customer appears.
