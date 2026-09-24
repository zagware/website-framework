# AGENTS.md — Zagware website framework

Read this first. It is the fastest way to get productive in this repo. It is written for AI agents and new developers alike. Deeper docs: `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`, `docs/DEPLOY.md`, `docs/COMMERCE.md`, `docs/PRIVACY.md`, `docs/MEDUSA.md`.

## What this is

A static-first site generator for Zagware customer websites. One `site.config.mjs` plus an `assets/` folder builds a complete site.

- **Previews** go to GitHub Pages as proof-of-concept sites for prospects. They are noindex and carry a preview banner.
- **Production** goes to Cloudflare (Workers static assets) on the customer's domain.
- **Optional site Worker** adds a Stripe shop (the "stripe-lite" tier) and a contact form.

`sites/devtest` is the staging site. **Every framework change is proven there before customer sites upgrade.** It deploys automatically from `main`:

- Preview: https://zagware.github.io/website-framework/
- Cloudflare: https://devtest.zagware.io (Stripe test mode, D1 database `zagware-devtest`)

## Repo map

```
bin/zsite.mjs            CLI: build · dev · check · new · smoke · components
src/
  build.mjs              orchestrator: config → pass 1 render → bundles → pass 2 documents → extras → privacy scan → link check
  config.mjs             load + normalise + validate site.config.mjs (props checked against component `props`)
  components.mjs         auto-discovers src/components/*.mjs and <site>/components/*.mjs (site overrides framework)
  components/<type>.mjs  one section type each (+ optional <type>.css, bundled only if used)
  client/<name>.js       browser scripts, bundled only when a render calls ctx.useScript(name)
  layout.mjs             nav (CSS-only burger + nav.js), footer (auto "Privacy" link), section wrapper
  head.mjs               title/meta/OG/canonical/robots/favicon/JSON-LD
  themes.mjs             presets (classic, heritage, midnight, plain) + self-hosted font registry
  fonts/                 bundled OFL woff2 (latin + latin-ext) + fonts.json
  assets.mjs             copy assets/, WebP variants via optional sharp, 25 MiB limit, content-hashed files
  targets.mjs            local | pages | cloudflare: robots, sitemap, _headers, _redirects
  privacy.mjs            third-party registry, collected-data summary, output scan (fails build on undeclared requests)
  commerce.mjs           stripe-lite: normalise, public catalog, client config, priceCart (shared with Worker)
  scaffold.mjs           `zsite new` from templates/
  dev-server.mjs         rebuild-in-child-process + SSE live reload
  smoke.mjs              post-deploy check (tolerates Cloudflare bot challenges from CI runners)
worker/                  Cloudflare site Worker: /api/health, /api/checkout, /api/stripe/webhook, /api/contact; migrations/
templates/site/          customer repo scaffold; templates/overlays/{worker,commerce} applied by --worker/--commerce
sites/devtest/           staging site (site.config.mjs, assets/, wrangler.jsonc)
infra/medusa/            local Medusa v2 evaluation stack (Docker Compose) — not used by sites yet
scripts/with-cf.mjs      run a command with CLOUDFLARE_* loaded from a local secrets file, never printing values
test/*.test.mjs          node:test suites (engine, privacy, commerce, stripe/worker, contact)
.github/workflows/       ci.yml (reusable) · devtest-pages.yml · devtest-cloudflare.yml
```

## Commands

```bash
npm install
npm test                                           # all unit tests (node --test)
node bin/zsite.mjs dev sites/devtest --port 4180   # live reload; 4173 is often taken by ardleevan's server
node bin/zsite.mjs check sites/devtest             # builds local+pages+cloudflare; fails on warnings, broken links, undeclared third parties
node bin/zsite.mjs build sites/devtest --target cloudflare [--out dir] [--strict]
node bin/zsite.mjs components                      # list section types
node bin/zsite.mjs new ../acme_website --name "Acme Ltd" [--worker] [--commerce] [--domain acme.ie]
node bin/zsite.mjs smoke https://devtest.zagware.io --api
```

Definition of done for any framework change:

1. `npm test` passes.
2. `node bin/zsite.mjs check sites/devtest` passes.
3. The change is visible on devtest. New components appear on `/components/` automatically.
4. Docs are updated.

## How a site is described (`site.config.mjs`)

It is a default-exported object. Top-level keys:

| Key | Purpose |
|---|---|
| `name`, `slug`, `tagline`, `description`, `lang` (`en-GB`/`en-IE`), `locale` | identity and SEO |
| `urls.production`, `urls.pages`, (`urls.local`) | absolute site URL per target; required for that target |
| `logo {src,width,height}`, `favicon` | asset paths relative to `assets/` (favicon is generated if omitted) |
| `theme {preset, tokens, fonts}` | preset + CSS custom property overrides (`--c-primary`, …) + font ids from `src/fonts/fonts.json` |
| `nav [{label, href}]`, `navCta`, `socials [{network, href}]` | header |
| `footer {text, links, sponsors, owner, smallprint, credit}` | footer (a Privacy link is added automatically) |
| `seo {ogImage, twitter, organization, headers}` | OG image, Organization JSON-LD extras, extra `_headers` |
| `analytics {cloudflareToken}` | cookieless Cloudflare Web Analytics on the cloudflare target only |
| `redirects [{from,to,status}]` | `_redirects` (cloudflare target) |
| `api {base}` | site Worker location: `""` = same origin; absolute for Pages previews |
| `privacy {controller, regulator, registration, retention, updated, extra, thirdParties}` | feeds the `privacy-notice` section and the third-party check |
| `commerce {…}` | stripe-lite shop (see docs/COMMERCE.md) |
| `targets {local, pages, cloudflare}` | per-target overrides, deep-merged (arrays replace) |
| `pages [{path, title, description, ogImage, noindex, notFound, sections}]` | `path` is `/` or `/a/b/` (lowercase, trailing slash) |

A section is `{ type, ...props }`. Common props on every section: `id`, `tone` (`default|alt|dark|primary`), `class`, `hidden`, `eyebrow`, `heading`, `intro`, `align`. Text supports inline markup: `**bold**`, `*em*`, `` `code` ``, `[label](/path/)`. Write links root-relative (`/shop/`, `/#faq`). The engine rewrites them relative to each page, which is why the same build works on a Pages sub-path.

## Contracts you must keep

- **Component module**: `{ type (== file name), summary, fullBleed, props, example, render(props, ctx), thirdParties?(props) }`.
  - `render` returns the inner HTML; the engine wraps it in `<section class="band … s-<type>">`.
  - Escape everything from config: `esc`/`attrs` from `src/html.mjs`, and `ctx.md`/`ctx.blocks`/`ctx.url`/`ctx.image`.
  - CSS must be scoped under `.s-<type>` and use only tokens from `src/styles/base.css`.
  - The full `ctx` API is in `docs/COMPONENTS.md`.
- **Client scripts**: plain JS, no imports. Select elements via `data-*` hooks. Do nothing when those hooks are absent. Each script is wrapped in its own IIFE.
- **Relative URLs**: never hard-code `/assets/...` in markup; use `ctx.asset`/`ctx.url`. The 404 page is the only exception: it uses the target base path, and the engine handles that.
- **Privacy (hard rule)**: the build fails if the output auto-loads, or posts a form to, any external host that is not declared. When you add anything external:
  1. Prefer self-hosting (fonts live in `src/fonts`) or click-to-load (`src/client/embed.js` with `data-embed`, `data-embed-load`, `data-embed-url`).
  2. If it must be external, declare it through the component's `thirdParties(props)` or the site's `privacy.thirdParties`. It then appears in the privacy notice automatically.
  3. Never add cookies, trackers or analytics that need consent without first adding a consent mechanism (not built; ask).
- **Commerce**: prices are integer minor units (pence). The Worker re-prices every checkout from `/_z/catalog.json` and ignores client-sent prices. `priceCart` in `src/commerce.mjs` is shared by the tests and the Worker, so keep it free of Node built-ins.
- **Worker**: `worker/index.mjs` default-exports `{ fetch }`. Non-`/api/*` requests fall through to `env.ASSETS`. It uses no npm dependencies; Stripe is called with `fetch` and webhooks are verified with WebCrypto.
- **No runtime npm dependencies in `src/` or `worker/`.** `sharp` is optional; without it, images are copied unchanged and the build warns.

## Adding things

- **A section type**: `src/components/<type>.mjs` (+ `.css`) with a realistic `example` that uses devtest assets (`img/sample-1..6.jpg`, `img/portrait-1..2.jpg`, `img/product-1..3.jpg`, `img/logo.svg`, `docs/sample.pdf`, `video/sample.mp4`). Then run `check`, look at `/components/` at 360 px and 1280 px, and test it with the keyboard.
- **A customer-only section**: put it in `<customer site>/components/<type>.mjs`. It follows the same contract and overrides a framework type with the same name.
- **A theme preset**: add it to `PRESETS` in `src/themes.mjs`, and bundle its fonts in `src/fonts/` (OFL/Apache licence only, latin + latin-ext subsets, entry in `fonts.json`, licence file beside the woff2).
- **A Worker endpoint**: add a route in `worker/index.mjs`, a module beside it, a D1 migration in `worker/migrations/000N_*.sql` (additive only), and tests in `test/`.

## Customer sites

- Customer sites live in their own repos, e.g. `~/zagware/<name>_website` → `github.com/zagware/<name>-website`.
- Each pins the framework by tag: `"@zagware/site-framework": "github:zagware/website-framework#vX.Y.Z"`.
- A release is a version bump in `package.json` plus `git tag vX.Y.Z`, made after devtest has been checked. Customer repos then upgrade with `npm install github:zagware/website-framework#vX.Y.Z && npx zsite check .`.
- Existing hand-built sites (`car_website`, `ardleevan_website`, `website`) are **not** on the framework yet. Migrating one means turning its HTML into config sections. The component set was designed from those sites.

## Secrets and safety (strict)

- **Never print or `cat` secret files**: `~/zagware/.env`, any `.dev.vars`, `.env*`. Some lines have no `KEY=` prefix, so even "key names only" filters can leak values. To inspect one, print value *shapes* only (length/prefix) with `awk`, or load values straight into a child process.
- **Cloudflare**: `node scripts/with-cf.mjs --env-file ~/zagware/cloudflare_poc_app/.dev.vars -- npx wrangler …`. The token has deployed Workers, created D1 databases and attached custom domains on `zagware.io`. Zones on the account: `zagware.io` and `carlingfordadventurerace.com`. It has **no** Email Routing permission.
- **Stripe (test)**: the key is in `~/zagware/.env`. Pipe it into `wrangler secret put` through stdin, never through argv or output. Worker secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and optionally `TURNSTILE_SECRET`.
- **Email Routing: never enable it on `zagware.io` itself** (mail is on Proton). Use subdomains only; see docs/DEPLOY.md.
- **GitHub**: `gh` is authenticated as davymcaleer (org `zagware`). The repo has Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and the variable `DEVTEST_CLOUDFLARE=true`.

## Gotchas

- `node --test` needs the glob form (`"test/*.test.mjs"`); a bare directory argument fails on newer Node.
- `wrangler` custom domains are defined in `wrangler.jsonc` `routes` with `custom_domain: true`.
- GitHub-hosted runners get Cloudflare bot challenges (403 with `cf-mitigated: challenge`). `zsite smoke` reports those instead of failing on them.
- Workers static assets serve `_headers`/`_redirects`; GitHub Pages ignores them, and ignores `CNAME` files for Actions-based deploys.
- Hashed bundles and fonts live in `_z/h/` (cached as immutable). `/_z/catalog.json` is not hashed, on purpose.
- The dev server rebuilds in a child process, so edits to config, imported JSON, components and the engine all take effect without restarting.
