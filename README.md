# Zagware website framework

This framework builds static-first customer websites from one config file. Each site gets:

- a **GitHub Pages** preview (noindex) to show prospects
- **Cloudflare** production on the customer's domain
- an optional **Stripe** shop and contact form, served by a small site Worker

```
bin/zsite.mjs        CLI: build · dev · check · new · components
src/                 engine (zero runtime deps; sharp optional for WebP)
  components/        section types (+ CSS)     → docs/COMPONENTS.md
  client/            browser scripts, bundled only when used
worker/              Cloudflare site Worker: /api/checkout, /api/stripe/webhook, /api/contact
templates/           `zsite new` scaffold (+ worker / commerce overlays)
sites/devtest/       staging site: every component, every target, Stripe test mode
infra/medusa/        local Medusa v2 stack (evaluation)  → docs/MEDUSA.md
scripts/with-cf.mjs  run wrangler with Cloudflare creds from a local file (never printed)
```

## Quick start

```bash
npm install
npm run dev                       # devtest at http://localhost:4173 (--port to change)
npm test                          # engine, commerce, worker, contact
node bin/zsite.mjs check sites/devtest    # build all targets; fail on warnings/broken links

# new customer POC (sibling repo)
node bin/zsite.mjs new ../acme_website --name "Acme Ltd" [--worker] [--commerce] [--domain acme.ie]
```

## Docs

- [ARCHITECTURE.md](docs/ARCHITECTURE.md): how the engine works
- [COMPONENTS.md](docs/COMPONENTS.md): section types, the component contract, adding components
- [DEPLOY.md](docs/DEPLOY.md): preview → sale → Cloudflare production, and framework releases
- [COMMERCE.md](docs/COMMERCE.md): commerce tiers and the stripe-lite design
- [MEDUSA.md](docs/MEDUSA.md): Medusa evaluation, measurements and hosting costs

## Release rule

Every change ships to `sites/devtest` first. CI (`.github/workflows/ci.yml`) runs:

- the unit tests
- `zsite check` on devtest
- a Worker dry-run
- a scaffold smoke test

Only after checking the devtest preview do we tag `vX.Y.Z`. Customer sites then bump their pinned tag (see [DEPLOY.md](docs/DEPLOY.md#3-framework-releases--customer-sites)).
