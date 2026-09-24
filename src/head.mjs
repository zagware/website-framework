// <head>: title, description, canonical, Open Graph / Twitter, robots,
// favicon, stylesheet, and the JSON-LD @graph (site nodes + nodes
// that components registered via ctx.addJsonLd).

import { attrs, esc, jsonScript } from "./html.mjs";

export function documentTitle(site, page) {
  return page.path === "/" ? page.title : `${page.title} | ${site.name}`;
}

export function siteJsonLd(site, ctx) {
  const org = {
    "@type": "Organization",
    "@id": ctx.abs("/#organization"),
    name: site.name,
    url: ctx.abs("/"),
    ...(site.logo ? { logo: ctx.abs(ctx.assetPath(site.logo.src)) } : {}),
    ...(site.socials.length ? { sameAs: site.socials.map((s) => s.href) } : {}),
    ...(site.seo.organization ?? {}),
  };
  const website = {
    "@type": "WebSite",
    "@id": ctx.abs("/#website"),
    url: ctx.abs("/"),
    name: site.name,
    publisher: { "@id": org["@id"] },
    inLanguage: site.lang,
  };
  return [org, website];
}

export function renderHead({ site, page, target, ctx, cssHref, faviconHref, jsonLd }) {
  const title = documentTitle(site, page);
  const description = page.description ?? site.description;
  const canonical = ctx.abs(page.path);
  const ogImageSrc = page.ogImage ?? site.seo.ogImage;
  const ogImage = ogImageSrc ? ctx.abs(ctx.assetPath(ogImageSrc)) : null;
  const noindex = !target.indexable || page.noindex;

  const meta = (a) => `<meta${attrs(a)}>`;
  return [
    `<meta charset="utf-8">`,
    meta({ name: "viewport", content: "width=device-width, initial-scale=1" }),
    `<title>${esc(title)}</title>`,
    description && meta({ name: "description", content: description }),
    noindex && meta({ name: "robots", content: "noindex, nofollow" }),
    !page.notFound && `<link rel="canonical" href="${esc(canonical)}">`,
    meta({ name: "theme-color", content: site.themeColor }),
    meta({ property: "og:type", content: "website" }),
    meta({ property: "og:site_name", content: site.name }),
    meta({ property: "og:title", content: title }),
    description && meta({ property: "og:description", content: description }),
    meta({ property: "og:url", content: canonical }),
    meta({ property: "og:locale", content: site.locale }),
    ogImage && meta({ property: "og:image", content: ogImage }),
    meta({ name: "twitter:card", content: ogImage ? "summary_large_image" : "summary" }),
    site.seo.twitter && meta({ name: "twitter:site", content: site.seo.twitter }),
    `<link rel="icon" href="${esc(faviconHref)}">`,
    `<link rel="stylesheet" href="${esc(cssHref)}">`,
    jsonLd.length &&
      `<script type="application/ld+json">${jsonScript({ "@context": "https://schema.org", "@graph": jsonLd })}</script>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Default favicon: brand initial on the primary colour. */
export function generatedFavicon(site) {
  const letter = esc((site.name ?? "?").trim().charAt(0).toUpperCase());
  const bg = esc(site.theme.tokens["--c-primary"] ?? site.themeColor);
  const fg = esc(site.theme.tokens["--c-primary-contrast"] ?? "#ffffff");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/><text x="32" y="44" font-family="Georgia,serif" font-size="38" font-weight="700" text-anchor="middle" fill="${fg}">${letter}</text></svg>`;
}
