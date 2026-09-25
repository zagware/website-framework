# Components

A page is an ordered list of **sections**. Each section is `{ type, ...props }`, and `type` names a component. To see all of them rendered:

- run `npx zsite components`, or
- open the devtest catalogue at `/components/`, which renders every component's `example` automatically.

| Type | Use |
|---|---|
| `hero` | Full-bleed header: background image or looping video, headline (`*word*` gets the accent colour), badge, CTAs, aside card (e.g. QR code) |
| `strip` | Row of icon + short facts (date, place, key points) |
| `split` | Text beside an image or a key-facts panel (optional `factsHeading`/`factsText`); `reverse` swaps the sides |
| `showcase` | Alternating image/text rows (product range, services) with ticks, chips, meta and an expandable details panel of text, key/value tables and data tables; optional schema.org JSON-LD per item |
| `cards` | Services, features, offers, buying options |
| `stats` | Big numbers with labels |
| `gallery` | Photo grid with wide tiles, focal points and a lightbox |
| `videos` | Video players, plus muted clips that play only while visible |
| `documents` | Downloadable files (PDF press packs, rules) |
| `location` | Venue text, details, map links, and an OpenStreetMap map that loads only on click |
| `quote` | A testimonial or a grid of them (Review JSON-LD when rated); `background` puts a photo behind a single quote |
| `table` | Comparison or data table |
| `logos` | Sponsor / partner wall |
| `faq` | Accordion with FAQPage JSON-LD generated from the same data |
| `cta` | Call-to-action band |
| `contact` | Contact buttons and an optional form. The form works without JavaScript and has a honeypot and optional Turnstile |
| `code` | Code, command or config snippets with an optional filename, language label and copy button. One `code`/`language`/`filename`, or several in `blocks` |
| `rich-text` | Prose |
| `products` / `cart` / `checkout-status` | Shop (see [COMMERCE.md](COMMERCE.md)) |
| `privacy-notice` | Privacy notice generated from what the site does (see [PRIVACY.md](PRIVACY.md)) |

## Common props (every section)

| Prop | Effect |
|---|---|
| `id` | Anchor for nav links, e.g. `href: "/#faq"` |
| `tone` | `default`, `alt` (tinted), `dark` or `primary`. Alternate these to separate sections visually |
| `class` | Extra CSS class |
| `hidden` | `true` drops the section (keep content ready for later) |
| `eyebrow`, `heading`, `intro`, `align: "center"` | Standard section header |

Text props accept a small inline markup: `**bold**`, `*emphasis*`, `` `code` ``, `[label](/path/)`, and `--` for an em dash. Block props (`body`, `paragraphs`, answers) are either one string with paragraphs separated by blank lines or an array of paragraphs. A paragraph whose lines all start with `- ` becomes a bullet list. All config text is HTML-escaped.

Links written from the site root (`/shop/`, `/#faq`) are rewritten relative to the page, so they work on a GitHub Pages sub-path. Images are paths inside `assets/` (`img/photo.jpg`). They get responsive WebP versions and width/height attributes automatically.

## Writing a component

A component is one file, `src/components/<type>.mjs`, with an optional `<type>.css` beside it. A site-only component goes in `<site>/components/` instead. A site component with the same type overrides the framework's.

```js
import { esc } from "../html.mjs";

export default {
  type: "team",                       // must equal the file name
  summary: "Team members with photo and role.",
  fullBleed: false,                   // true: the engine does not wrap output in .wrap
  props: {                            // validated at build: string|number|boolean|array|object, unions via "string|array"
    people: { type: "array", required: true },
  },
  example: { heading: "Our team", people: [{ name: "Ann", role: "Founder", photo: "img/portrait-1.jpg" }] },
  // Only if the section makes the browser contact another host (see PRIVACY.md):
  // thirdParties: (p) => [{ host: "player.vimeo.com", name: "Vimeo", purpose: "Plays the video" }],
  render(p, ctx) {
    return `${ctx.sectionHead(p)}<ul class="grid">${p.people
      .map((x) => `<li class="card">${ctx.image(x.photo, { alt: x.name, sizes: "300px" })}<h3>${esc(x.name)}</h3><p>${esc(x.role)}</p></li>`)
      .join("")}</ul>`;
  },
};
```

The engine wraps the output in `<section id class="band band--{tone} s-{type}">`. Put CSS under `.s-<type>` and use the tokens from `src/styles/base.css` (`--c-*`, `--font-*`, `--radius`, `--btn-*`, `--nav-*`, `--logo-h`, …). Never hard-code brand colours. **Never give an inner element the class `s-<type>` itself.** That class belongs to the `<section>`, so a rule like `.s-split { display: grid }` would hit the section. Use `s-<type>__<part>`; a test enforces this.

### Render context (`ctx`)

| Member | Purpose |
|---|---|
| `url(href)` | Root-relative → page-relative. External, `#`, `mailto:` and `tel:` links are left alone |
| `asset(src)` / `assetPath(src)` / `abs(href)` | Asset URL relative to the page / root-relative asset path / absolute URL on the target site (for JSON-LD and OG) |
| `image(src, { alt, sizes, loading, class, width, height, fetchpriority })` | `<picture>` with a WebP srcset and intrinsic size |
| `md(text)`, `blocks(value)` | Inline markup and block markup |
| `icon(name, { label })` | Sprite icon (the list is in `src/icons.mjs`) |
| `sectionHead(props, { center })` | Eyebrow, `h2` and intro |
| `addJsonLd(node)` | Add a schema.org node to the page `@graph` |
| `useScript(name)` | Include `src/client/<name>.js` (or `<site>/scripts/<name>.js`) in the site bundle |
| `api(path)` | URL of a site Worker endpoint (`site.api.base` + path) |
| `uid(prefix)` | Unique id within the page |
| `site`, `page`, `target`, `commerce` | Normalised config |

**External hosts:** the build fails if a section's output loads anything from another host that has not been declared. Self-host the resource, or make it click-to-load with `data-embed` / `data-embed-load` / `data-embed-url` (see `src/client/embed.js`). If neither is possible, declare the host through `thirdParties(props)`; it is then listed in the privacy notice.

Client scripts are plain browser JS. The engine wraps each in an IIFE and bundles only the scripts that pages use. A script must do nothing when its `data-*` hooks are absent.

### Checklist for a new component

1. Add a realistic `example` that uses the devtest assets. It appears on `/components/` automatically.
2. Run `node bin/zsite.mjs check sites/devtest`. It fails on any warning, broken link or undeclared third-party request.
3. Check it at 360 px and 1280 px, with the keyboard, and with `prefers-reduced-motion` if it animates.
