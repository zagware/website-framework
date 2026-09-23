# Deploying sites: preview → sale → production

Every customer site goes through the same three stages. The same source builds for each one. Only the **target** changes.

| Stage | Target | Where | Indexing | Cost |
|---|---|---|---|---|
| Develop | `local` | `npx zsite dev .` → http://localhost:4173 | n/a | free |
| POC / pitch | `pages` | `https://zagware.github.io/<repo>/` | `noindex` + `Disallow: /` + preview banner | free |
| Customer bought it | `cloudflare` | customer domain (Workers static assets) | indexable, sitemap, `_headers` | free plan (static) / $5 Workers Paid if the account needs it |

Per-target differences are set in `site.config.mjs` under `targets.<name>`. They are deep-merged, and arrays replace. Example: a shop preview on Pages calls the Worker on another origin.

```js
targets: { pages: { commerce: { apiBase: "https://shop-api.example.com" } } }
```

## 1. New customer POC

```bash
cd ~/zagware
node website_framework/bin/zsite.mjs new acme_website --name "Acme Ltd" [--commerce] [--domain acme.ie]
cd acme_website && npm install && npx zsite dev .
```

Edit `site.config.mjs` and drop images into `assets/img/`. Then:

```bash
gh repo create zagware/acme-website --private --source . --push   # or --public
gh api -X POST repos/zagware/acme-website/pages -f build_type=workflow
```

The **Preview (GitHub Pages)** workflow publishes on every push to `main`. Send the customer the `https://zagware.github.io/acme-website/` link.

> GitHub Pages from a **private** repo needs a paid plan (Team/Enterprise for orgs). The published site is still public. That is fine for a POC because it is `noindex`.

## 2. Going live on Cloudflare

1. **Domain**
   - If the customer already owns it, add the zone to our Cloudflare account (dashboard → Add a domain) and have them change nameservers at their registrar.
   - To register it for them, use Cloudflare Registrar (at-cost pricing).
   - Before the nameserver switch, copy their mail records (MX, SPF, DKIM, DMARC). Cloudflare's import scan usually finds them. Check against `dig` output, as `ardleevan_website/DNS-CUTOVER.md` does.
2. **wrangler.jsonc**: uncomment `routes` with `custom_domain: true` for apex and `www`. Cloudflare creates the DNS records and certificates automatically.
3. **Secrets in the site repo** (Settings → Secrets → Actions):
   - `CLOUDFLARE_API_TOKEN`: a token scoped to *Workers Scripts:Edit*, *Workers Routes:Edit*, *D1:Edit*, and *Zone:Read* on that zone.
   - `CLOUDFLARE_ACCOUNT_ID`
4. **Sites with a Worker (contact form and/or shop)**:
   - `npx wrangler d1 create <slug>-site`, paste the id into `wrangler.jsonc`, then `npx wrangler d1 migrations apply DB --remote`.
   - Shops: `npx wrangler secret put STRIPE_SECRET_KEY` (restricted key), then add a Stripe webhook endpoint `https://<domain>/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`, and `npx wrangler secret put STRIPE_WEBHOOK_SECRET` with its signing secret.
   - Contact messages are stored in D1 without further setup. To have them emailed as well, see [Contact form email](#contact-form-email).
5. **Deploy**: tag `v1.0.0` (or run the **Deploy (Cloudflare)** workflow by hand). The workflow builds with `--strict`, applies D1 migrations, deploys, and runs `zsite smoke` (`/`, `/robots.txt`, the 404 page, `/api/health`). A Cloudflare bot challenge seen from the GitHub runner (Bot Fight Mode) is reported, not failed; every other error fails the deploy.
6. **www → apex (or the reverse)**: dashboard → Rules → Redirect Rules → "Redirect from WWW to root" template.
7. **Pages preview**: turn off the Pages site (Settings → Pages → Unpublish), or keep it for staging changes. It stays `noindex` either way.

### Contact form email

The Worker emails messages through Cloudflare **Email Routing** (`send_email` binding). Destinations must be addresses verified in Email Routing.

> ⚠️ Enabling Email Routing on a domain **replaces its MX records**. `zagware.io` receives mail at Proton (`mail.protonmail.ch`), so **never** enable it on the apex. Enable it on a subdomain only, which leaves apex mail untouched. Apply the same rule to any customer domain whose mailbox is hosted elsewhere.

One-time setup in the dashboard (the API token needs *Email Routing Addresses:Edit* and *Zone Email Routing Rules/Settings:Edit* to script it):

1. Account → **Email** → Email Routing → **Destination addresses** → add the inbox that should receive messages. Click the link in the verification email.
2. Zone (e.g. `zagware.io`) → Email → Email Routing → **Settings → Subdomains** → add a subdomain, e.g. `devtest`. Accept the MX/SPF records it adds for that subdomain only.
3. In the site's `wrangler.jsonc`:
   ```jsonc
   "send_email": [{ "name": "CONTACT_EMAIL", "destination_address": "you@example.com" }],
   "vars": { "CONTACT_TO": "you@example.com", "CONTACT_FROM": "website@devtest.zagware.io" }
   ```
4. Deploy. `/api/health` reports `"contact": true`. Messages are stored in D1 and emailed with `Reply-To` set to the sender's address.

To read stored messages: `npx wrangler d1 execute DB --remote --command "select created_at, fields_json from messages order by id desc limit 20"`.

### Local deploys without GitHub

`scripts/with-cf.mjs` loads `CLOUDFLARE_*` keys from a local secrets file into the child process only, and never prints them:

```bash
export ZSITE_CF_ENV_FILE=~/zagware/cloudflare_poc_app/.dev.vars
node ~/zagware/website_framework/scripts/with-cf.mjs -- npx wrangler deploy
```

## 3. Framework releases → customer sites

- Customer sites pin the framework by git tag: `"@zagware/site-framework": "github:zagware/website-framework#v0.1.0"`.
- Release flow:
  1. Change the framework.
  2. CI builds `sites/devtest` on every target (`zsite check`: fails on warnings or broken links), dry-runs the Worker bundle, and smoke-tests the scaffold.
  3. The merge to `main` deploys devtest to GitHub Pages (and Cloudflare, once enabled).
  4. Check devtest, especially `/components/` and the test-mode shop.
  5. Bump `package.json` version, then `git tag vX.Y.Z && git push --tags`.
  6. In each customer repo: `npm install github:zagware/website-framework#vX.Y.Z`, `npx zsite check .`, open a PR, and the preview updates.
- If the framework repo is private, customer CI needs read access: add a fine-grained PAT (Contents:Read on the framework repo) as `FRAMEWORK_TOKEN`, and add this step before `npm ci`:
  ```yaml
  - run: git config --global url."https://x-access-token:${{ secrets.FRAMEWORK_TOKEN }}@github.com/".insteadOf "https://github.com/"
  ```
  Making the framework repo public avoids this. It contains no customer content or secrets.

## What never gets deployed

Only `dist/` is uploaded. It holds rendered HTML, the hashed `_z/h/` bundle and `assets/`. Design mock-ups, source PNGs, zips and anything else in the repo root are never published. This is unlike `car_website`, whose `wrangler.jsonc` uploads the repo root. The build fails on any asset over Cloudflare's 25 MiB per-file limit; host large video on R2 or Stream instead.
