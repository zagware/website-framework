# Privacy and cookie compliance (UK / EU)

**Goal:** every site built with the framework has *nothing that needs consent*, so it needs no cookie banner. It also always has an accurate privacy notice.

Legal context (checked September 2026):

- **UK.** PECR regulation 6, as amended by the Data (Use and Access) Act 2025. The new cookie exemptions and higher fines (up to £17.5m or 4% of turnover) took effect on 5 Feb 2026, and the ICO finalised its guidance on 29 Apr 2026. Two kinds of storage need no consent:
  - storage *strictly necessary for a service the user requested*, such as a shopping basket;
  - first-party statistics, provided they are disclosed and visitors can opt out.

  Third-party analytics such as Google Analytics 4 still needs consent.
- **EU / Ireland.** ePrivacy Directive art. 5(3) plus GDPR, enforced by the DPC. There is no analytics exemption. Sending visitor IP addresses to third parties without a legal basis is a GDPR risk. The best-known example is the Munich Regional Court's January 2022 ruling on Google Fonts.

This page describes what the framework does. It is not legal advice. The customer is the data controller and must review their notice.

## What the framework guarantees

| Risk | How it is handled |
|---|---|
| Cookies | Our code sets none. Cloudflare may set strictly necessary security cookies (`__cf_bm`, `cf_clearance`) on flagged traffic; the notice discloses them. |
| Basket | Kept in `localStorage` (`zsite-cart:<site>`). Strictly necessary, never sent to us until checkout, and disclosed in the notice. |
| Fonts | Self-hosted from `src/fonts/` (OFL woff2, latin + latin-ext). No requests to Google Fonts. |
| Maps / embeds | Click-to-load (`src/client/embed.js`). The `location` section's OpenStreetMap map loads only after "Show map" is pressed, and says so beforehand. |
| Analytics | Off by default. `analytics.cloudflareToken` enables Cloudflare Web Analytics, which is cookieless and first-party-style, on the Cloudflare target only. It is declared in the notice automatically. |
| Undeclared third parties | `src/privacy.mjs` scans the build output and **fails the build** on any external script, stylesheet, font, iframe, image, media, CSS `url()`/`@import`, JS URL literal or form `action` whose host is not first party (the site or its Worker) or declared. |
| Privacy notice | The `privacy-notice` section is generated from what the site actually does: contact forms and their fields, shop, basket storage, analytics, and every declared third party with its purpose. The footer links to it automatically, and so do contact forms and the basket. |
| Missing notice | A site with a contact form or a shop but no `privacy-notice` page produces a warning. Warnings fail `--strict` and `zsite check`, so CI blocks it. |

## Declaring a third party

The first choice is to self-host it or make it click-to-load. If it really must load from another host:

```js
privacy: {
  thirdParties: [
    { host: "player.vimeo.com", name: "Vimeo", purpose: "Plays the race highlights video", policyUrl: "https://vimeo.com/privacy" },
  ],
}
```

Components declare their own hosts with `thirdParties(props)`, for example `contact` (external form endpoints, Turnstile) and `location` (OpenStreetMap). A new component that contacts another host must do the same, or the build fails.

## Site config

```js
privacy: {
  controller: { name: "Acme Ltd", email: "privacy@acme.ie", address: "…", phone: "…" }, // required with a notice page
  regulator: "ico" | "dpc",        // default: "dpc" for lang en-IE, else "ico"
  registration: "ZA123456",        // ICO registration number, if any
  retention: { messages: "12 months after we last reply", orders: "6 years …" }, // defaults shown
  updated: "24 September 2026",
  extra: [{ heading: "Marketing emails", body: "…" }],     // extra sections
  thirdParties: [ … ],
}
```

Section props: `hostingName` (default "Cloudflare") and `storageRegion` (e.g. "Western Europe", matching the D1 location).

## Go-live checklist (per customer)

1. Fill in `privacy.controller` with the customer's legal name, address and email.
2. The customer reviews `/privacy/`, especially retention periods and anything they do offline with the data.
3. `npx zsite check .` passes, which confirms there are no undeclared third parties.
4. If they want Google Analytics, Meta Pixel, YouTube auto-embeds or anything similar: **stop**. That needs a consent mechanism, which the framework does not have yet. Offer Cloudflare Web Analytics instead.
