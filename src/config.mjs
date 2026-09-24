// Site config loading, normalisation and validation.
// A site is a directory containing `site.config.mjs` (default export),
// an optional `assets/` dir, `components/` dir (site-local sections) and
// `styles/` dir (site CSS appended after framework CSS).

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeCommerce } from "./commerce.mjs";
import { slug } from "./html.mjs";
import { collectCompliance } from "./privacy.mjs";
import { resolveTheme } from "./themes.mjs";

const TYPES = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
  array: Array.isArray,
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
};
const TONES = new Set(["default", "alt", "dark", "primary"]);
const COMMON_PROPS = new Set(["type", "id", "tone", "class", "hidden", "eyebrow", "heading", "intro", "align"]);

export async function loadSiteConfig(siteDir) {
  const dir = resolve(siteDir);
  const file = join(dir, "site.config.mjs");
  if (!existsSync(file)) throw new Error(`No site.config.mjs in ${dir}`);
  const mod = await import(pathToFileURL(file).href);
  return { dir, raw: mod.default };
}

const trailingSlash = (u) => (u.endsWith("/") ? u : `${u}/`);

function checkUrl(value, where, errors) {
  if (value == null) return undefined;
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    return trailingSlash(u.href);
  } catch {
    errors.push(`${where}: "${value}" is not an absolute http(s) URL`);
    return undefined;
  }
}

/**
 * Normalise + validate a raw config against the component registry.
 * Returns { site, errors, warnings }; callers fail the build on errors.
 */
export function normalizeSite(raw, components) {
  const errors = [];
  const warnings = [];
  if (!TYPES.object(raw)) return { site: null, errors: ["site.config.mjs must default-export an object"], warnings };
  if (!raw.name) errors.push("name is required");

  const urls = {
    local: "http://localhost:4173/",
    ...Object.fromEntries(
      Object.entries(raw.urls ?? {}).map(([k, v]) => [k, checkUrl(v, `urls.${k}`, errors)]),
    ),
  };

  const theme = resolveTheme(raw.theme);
  if (theme.error) errors.push(theme.error);
  for (const [k, v] of Object.entries(theme.tokens ?? {})) {
    if (!k.startsWith("--")) errors.push(`theme.tokens: "${k}" must be a CSS custom property (--name)`);
    if (/[;{}<]/.test(String(v))) errors.push(`theme.tokens.${k}: value may not contain ; { } <`);
  }

  const pages = (raw.pages ?? []).map((page, i) => normalizePage(page, i, components, errors, warnings));
  if (!pages.length) errors.push("pages: at least one page is required");
  const seen = new Set();
  for (const p of pages) {
    if (seen.has(p.path)) errors.push(`pages: duplicate path "${p.path}"`);
    seen.add(p.path);
  }
  if (!seen.has("/")) errors.push('pages: a home page with path "/" is required');

  // api.base: where the site Worker's /api/* lives. "" = same origin (Cloudflare).
  // Absolute for GitHub Pages previews, which cannot run a Worker.
  let apiBase = raw.api?.base ?? "";
  if (apiBase !== "") apiBase = (checkUrl(apiBase, "api.base", errors) ?? "").replace(/\/+$/, "");

  const commerceErrors = [];
  const commerce = raw.commerce
    ? normalizeCommerce({ ...raw.commerce, apiBase: raw.commerce.apiBase ?? apiBase }, commerceErrors)
    : null;
  errors.push(...commerceErrors.map((e) => `commerce: ${e}`));

  const site = {
    name: raw.name,
    slug: raw.slug ?? slug(raw.name ?? "site"),
    tagline: raw.tagline ?? "",
    description: raw.description ?? "",
    lang: raw.lang ?? "en-GB",
    locale: raw.locale ?? (raw.lang ?? "en-GB").replace("-", "_"),
    urls,
    logo: raw.logo ?? null,
    favicon: raw.favicon ?? null,
    themeColor: raw.themeColor ?? theme.tokens?.["--c-primary"] ?? "#1f4e79",
    theme: { tokens: theme.tokens ?? {}, fonts: theme.fonts ?? [] },
    topbar: raw.topbar ?? [],
    nav: raw.nav ?? [],
    navCta: raw.navCta ?? null,
    socials: raw.socials ?? [],
    footer: { credit: true, ...(raw.footer ?? {}) },
    seo: raw.seo ?? {},
    analytics: raw.analytics ?? {},
    redirects: raw.redirects ?? [],
    preview: { banner: true, text: "Preview build for review — not the live site.", ...(raw.preview ?? {}) },
    api: { base: apiBase },
    commerce,
    pages,
  };

  for (const item of site.nav) {
    if (!item?.label || !item?.href) errors.push("nav: every item needs label and href");
    else if (item.href.startsWith("/")) {
      const path = item.href.split("#")[0] || "/";
      if (!seen.has(path)) warnings.push(`nav: "${item.href}" does not match any page path`);
    }
  }
  if (commerce && !seen.has(commerce.cartPath)) {
    warnings.push(`commerce.cartPath "${commerce.cartPath}" has no page; add a page with a "cart" section`);
  }
  const privacy = collectCompliance(site, components, raw.privacy);
  site.compliance = privacy.compliance;
  errors.push(...privacy.errors);
  warnings.push(...privacy.warnings.map((w) => `privacy: ${w}`));
  return { site, errors, warnings };
}

function normalizePage(page, i, components, errors, warnings) {
  const where = `pages[${i}]`;
  if (!TYPES.object(page)) {
    errors.push(`${where}: must be an object`);
    return { path: `/__invalid-${i}/`, sections: [] };
  }
  const notFound = page.notFound === true;
  let path = page.path;
  if (notFound) path = "/404.html";
  else if (typeof path !== "string" || !/^\/([a-z0-9-]+\/)*$/.test(path)) {
    errors.push(`${where}: path "${path}" must look like "/" or "/about/" or "/shop/cart/" (lowercase, trailing slash)`);
  }
  if (!page.title) errors.push(`${where} (${path}): title is required`);

  const ids = new Set();
  const sections = (page.sections ?? [])
    .filter((s) => !s?.hidden)
    .map((section, j) => {
      const sw = `${where}.sections[${j}]`;
      const comp = components.get(section?.type);
      if (!comp) {
        errors.push(`${sw}: unknown section type "${section?.type}" (have: ${[...components.keys()].sort().join(", ")})`);
        return section;
      }
      if (section.tone && !TONES.has(section.tone)) errors.push(`${sw} (${section.type}): tone "${section.tone}" not one of ${[...TONES].join("|")}`);
      if (section.id) {
        if (ids.has(section.id)) errors.push(`${sw}: duplicate section id "${section.id}"`);
        ids.add(section.id);
      }
      for (const [name, spec] of Object.entries(comp.props ?? {})) {
        const value = section[name];
        if (value == null) {
          if (spec.required) errors.push(`${sw} (${section.type}): "${name}" is required`);
        } else if (!spec.type.split("|").some((t) => TYPES[t]?.(value))) {
          errors.push(`${sw} (${section.type}): "${name}" must be ${spec.type.split("|").join(" or ")}`);
        }
      }
      for (const name of Object.keys(section)) {
        if (!COMMON_PROPS.has(name) && !(name in (comp.props ?? {}))) {
          warnings.push(`${sw} (${section.type}): unknown prop "${name}" is ignored`);
        }
      }
      return section;
    });

  return {
    path,
    notFound,
    title: page.title,
    description: page.description ?? null,
    ogImage: page.ogImage ?? null,
    noindex: page.noindex === true || notFound,
    sections,
  };
}

/** Output file for a page path: "/" → index.html, "/a/b/" → a/b/index.html. */
export const pageFile = (path) => (path.endsWith(".html") ? path.slice(1) : `${path.slice(1)}index.html`);

/** Directory depth of a page, used to build page-relative URLs. */
export const pageDepth = (path) => (path.endsWith(".html") ? 0 : path.split("/").filter(Boolean).length);
