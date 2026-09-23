// Deploy targets. The same site builds differently per destination:
//   local       dev server; noindex; no analytics
//   pages       GitHub Pages POC preview: noindex everywhere, preview banner,
//               robots Disallow, works under a /<repo>/ project subpath
//   cloudflare  production on Cloudflare Workers static assets: indexable,
//               sitemap, _headers (caching + security), _redirects, analytics

export const TARGETS = ["local", "pages", "cloudflare"];

export function resolveTarget(site, name) {
  if (!TARGETS.includes(name)) throw new Error(`Unknown target "${name}" (have: ${TARGETS.join(", ")})`);
  const key = name === "cloudflare" ? "production" : name;
  const siteUrl = site.urls[key];
  if (!siteUrl) {
    throw new Error(`Target "${name}" needs urls.${key} in site.config.mjs (absolute URL, e.g. https://example.com/)`);
  }
  return {
    name,
    siteUrl,
    basePath: new URL(siteUrl).pathname, // "/" or "/repo-name/"
    indexable: name === "cloudflare",
    banner: name === "pages" && site.preview.banner,
    analytics: name === "cloudflare",
  };
}

export function robotsTxt(target) {
  if (!target.indexable) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap.xml", target.siteUrl).href}\n`;
}

export function sitemapXml(pages, target, lastmod) {
  const urls = pages
    .filter((p) => !p.noindex)
    .map((p) => `  <url><loc>${new URL(p.path.slice(1), target.siteUrl).href}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// Workers static assets honours _headers/_redirects; GitHub Pages ignores them.
export function headersFile(site) {
  const extra = Object.entries(site.seo.headers ?? {})
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");
  return [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  X-Frame-Options: SAMEORIGIN",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()",
    extra,
    "",
    "/_z/h/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/assets/*",
    "  Cache-Control: public, max-age=86400",
    "",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function redirectsFile(site) {
  return site.redirects.map((r) => `${r.from} ${r.to} ${r.status ?? 301}`).join("\n") + (site.redirects.length ? "\n" : "");
}
