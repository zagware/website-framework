// Build orchestrator: config → validated site → rendered pages + bundles
// → target-specific extras (robots, sitemap, _headers, _redirects, 404).

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyStatic, processAssets, writeHashed } from "./assets.mjs";
import { catalog, clientConfig } from "./commerce.mjs";
import { loadComponents } from "./components.mjs";
import { loadSiteConfig, normalizeSite, pageDepth, pageFile } from "./config.mjs";
import { generatedFavicon, renderHead, siteJsonLd } from "./head.mjs";
import { attrs, blocks, esc, inline, jsonScript } from "./html.mjs";
import { ICONS, sprite } from "./icons.mjs";
import { renderFooter, renderNav, renderSection } from "./layout.mjs";
import { headersFile, redirectsFile, resolveTarget, robotsTxt, sitemapXml } from "./targets.mjs";
import { scanThirdParties } from "./privacy.mjs";
import { FONTS, FONTS_DIR, themeCss } from "./themes.mjs";

const SRC = fileURLToPath(new URL("./", import.meta.url));
const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;

export class BuildError extends Error {
  constructor(errors, warnings = []) {
    super(`Site config has ${errors.length} error(s):\n  - ${errors.join("\n  - ")}`);
    this.errors = errors;
    this.warnings = warnings;
  }
}

/** Create the render context for one page (see docs/COMPONENTS.md). */
export function createContext({ site, page, target, manifest, assetFiles, warnings }) {
  const depth = pageDepth(page.path);
  const prefix = page.notFound ? target.basePath : depth ? "../".repeat(depth) : "./";
  const state = { icons: new Set(), scripts: new Set(), jsonLd: [], uid: 0 };

  const url = (href) => {
    if (href == null || href === "") return href;
    if (EXTERNAL.test(href) || !href.startsWith("/")) return href;
    const [path, hash] = href.split("#");
    if (!page.notFound && (path || "/") === page.path && hash != null) return `#${hash}`;
    return prefix + href.slice(1);
  };
  const assetPath = (src) => {
    if (src == null || /^(https?:)?\/\//.test(src) || src.startsWith("data:")) return src;
    const rel = src.replace(/^\/?(assets\/)?/, "");
    if (assetFiles && !assetFiles.has(rel)) warnings.add(`${page.path}: asset "${src}" not found in assets/`);
    return `/assets/${rel}`;
  };
  const ctx = {
    site,
    page,
    target: target.name,
    siteUrl: target.siteUrl,
    commerce: site.commerce,
    url,
    assetPath,
    asset: (src) => url(assetPath(src)),
    abs: (href) => (/^https?:\/\//.test(href) ? href : new URL(String(href).replace(/^\//, ""), target.siteUrl).href),
    md: (text) => inline(text, url),
    blocks: (value) => blocks(value, url),
    icon(name, { label } = {}) {
      if (!ICONS[name]) {
        warnings.add(`${page.path}: unknown icon "${name}"`);
        return "";
      }
      state.icons.add(name);
      const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
      return `<svg class="icon icon--${name}" ${a11y}><use href="#i-${name}"></use></svg>`;
    },
    image(src, opts = {}) {
      if (opts.alt == null) warnings.add(`${page.path}: image "${src}" has no alt text`);
      const rel = typeof src === "string" ? src.replace(/^\/?(assets\/)?/, "") : src;
      const meta = manifest.get(rel);
      const img = `<img${attrs({
        src: ctx.asset(src),
        alt: opts.alt ?? "",
        width: opts.width ?? meta?.width,
        height: opts.height ?? meta?.height,
        loading: opts.loading ?? "lazy",
        decoding: "async",
        fetchpriority: opts.fetchpriority,
        class: opts.class,
        style: opts.style,
      })}>`;
      if (!meta?.variants.length) return img;
      const srcset = meta.variants.map((v) => `${url(`/assets/${v.path}`)} ${v.w}w`).join(", ");
      return `<picture><source type="image/webp"${attrs({ srcset, sizes: opts.sizes ?? "100vw" })}>${img}</picture>`;
    },
    sectionHead(props, { center } = {}) {
      if (!props.eyebrow && !props.heading && !props.intro) return "";
      const centered = center || props.align === "center";
      return `<div class="section-head${centered ? " section-head--center" : ""}">${
        props.eyebrow ? `<span class="eyebrow">${esc(props.eyebrow)}</span>` : ""
      }${props.heading ? `<h2>${inline(props.heading, url)}</h2>` : ""}${
        props.intro ? `<p class="section-head__intro">${inline(props.intro, url)}</p>` : ""
      }</div>`;
    },
    /** Absolute or root-relative URL of a site Worker endpoint, e.g. ctx.api("/api/contact"). */
    api: (path) => `${site.api.base}${path}`,
    addJsonLd: (node) => state.jsonLd.push(node),
    useScript: (name) => state.scripts.add(name),
    uid: (p = "z") => `${p}-${++state.uid}`,
  };
  return { ctx, state };
}

/** Copy the theme's self-hosted fonts into _z/h/fonts/ and return their @font-face rules. */
async function fontFaces(out, ids) {
  const rules = [];
  for (const id of ids) {
    const font = FONTS[id];
    for (const { file, unicodeRange } of font.files) {
      const name = file.split("/").pop().replace(/\.woff2$/, "");
      const rel = await writeHashed(out, `fonts/${name}`, "woff2", await readFile(new URL(file, FONTS_DIR)));
      // url() is relative to the CSS bundle, which also lives in _z/h/.
      rules.push(
        `@font-face { font-family: "${font.family}"; font-style: ${font.style}; font-weight: ${font.weight}; font-display: swap; src: url("${rel.slice("_z/h/".length)}") format("woff2"); unicode-range: ${unicodeRange}; }`,
      );
    }
  }
  return rules.join("\n");
}

async function readDirCss(dir) {
  if (!existsSync(dir)) return "";
  const files = (await readdir(dir)).filter((f) => f.endsWith(".css")).sort();
  return (await Promise.all(files.map((f) => readFile(join(dir, f), "utf8")))).join("\n");
}

async function scriptBundle(names, siteDir) {
  const parts = [];
  for (const name of [...names].sort()) {
    const candidates = [join(siteDir, "scripts", `${name}.js`), join(SRC, "client", `${name}.js`)];
    const file = candidates.find(existsSync);
    if (!file) throw new Error(`Client script "${name}" not found (looked in ${candidates.join(", ")})`);
    parts.push(`/* ${name} */\n(() => {\n${await readFile(file, "utf8")}\n})();`);
  }
  return parts.join("\n");
}

function notFoundPage(site) {
  return {
    path: "/404.html",
    notFound: true,
    noindex: true,
    title: "Page not found",
    description: null,
    ogImage: null,
    sections: [],
    body: (ctx) => `<section class="band"><div class="wrap section-head">
<span class="eyebrow">404</span><h1>We couldn’t find that page.</h1>
<p class="section-head__intro">It may have moved. Try the <a href="${esc(ctx.url("/"))}">${esc(site.name)} home page</a>.</p>
</div></section>`,
  };
}

/** Find page-relative href/src targets in built HTML that do not exist. */
export async function checkLinks(outDir, basePath) {
  const broken = [];
  const htmlFiles = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".html")) htmlFiles.push(full);
    }
  };
  await walk(outDir);
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const rel = file.slice(outDir.length).split("\\").join("/");
    const refs = [...html.matchAll(/\s(?:href|src|poster|data-full)="([^"]+)"/g)].map((m) => m[1]);
    const srcsets = [...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+/)[0]));
    for (const ref of [...refs, ...srcsets]) {
      if (EXTERNAL.test(ref)) continue;
      const clean = ref.replace(/&amp;/g, "&").split(/[?#]/)[0];
      if (!clean) continue;
      let target = clean.startsWith("/")
        ? clean.startsWith(basePath) ? clean.slice(basePath.length) : null
        : posix.normalize(posix.join(posix.dirname(rel), clean)).replace(/^\//, "");
      if (target == null) {
        broken.push(`${rel}: ${ref} (absolute path outside base ${basePath})`);
        continue;
      }
      if (target === "" || target === "." || target.endsWith("/")) target = `${target === "." ? "" : target}index.html`;
      if (target.startsWith("..") || !existsSync(join(outDir, target))) broken.push(`${rel}: ${ref}`);
    }
  }
  return [...new Set(broken)];
}

export function deepMerge(base, over) {
  if (over === undefined) return base;
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isObj(base) || !isObj(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

export async function build({ siteDir, target: targetName = "local", outDir, images = true } = {}) {
  const t0 = performance.now();
  const { dir, raw: baseRaw } = await loadSiteConfig(siteDir);
  // `targets.<name>` holds per-target overrides (deep-merged; arrays replace).
  const { targets: perTarget = {}, ...rest } = baseRaw ?? {};
  const raw = deepMerge(rest, perTarget[targetName]);
  const components = await loadComponents(dir);
  const { site, errors, warnings: configWarnings } = normalizeSite(raw, components);
  if (errors.length) throw new BuildError(errors, configWarnings);
  const target = resolveTarget(site, targetName);
  const out = resolve(outDir ?? join(dir, "dist"));
  const warnings = new Set(configWarnings);

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const assets = await processAssets({ siteDir: dir, outDir: out, target: target.name, images });
  assets.warnings.forEach((w) => warnings.add(w));
  if (assets.errors.length) throw new BuildError(assets.errors, [...warnings]);

  const staticFiles = await copyStatic({ siteDir: dir, outDir: out, target: target.name });
  staticFiles.warnings.forEach((w) => warnings.add(w));
  if (staticFiles.errors.length) throw new BuildError(staticFiles.errors, [...warnings]);

  const pages = [...site.pages];
  if (!pages.some((p) => p.notFound)) pages.push(notFoundPage(site));

  // Pass 1: render page bodies, recording which components/scripts/icons are used.
  const usedTypes = new Set();
  const scripts = new Set(site.commerce ? ["cart"] : []);
  const rendered = [];
  for (const page of pages) {
    const { ctx, state } = createContext({ site, page, target, manifest: assets.manifest, assetFiles: assets.files, warnings });
    const main = page.body
      ? page.body(ctx)
      : page.sections
          .map((section) => {
            usedTypes.add(section.type);
            return renderSection(section, components.get(section.type), ctx);
          })
          .join("\n");
    const nav = renderNav(site, page, ctx);
    const footer = renderFooter(site, ctx);
    state.scripts.forEach((s) => scripts.add(s));
    rendered.push({ page, ctx, state, main, nav, footer });
  }

  // Bundles: self-hosted fonts → base → theme tokens → used component CSS → site CSS.
  const css = [
    await fontFaces(out, site.theme.fonts),
    await readFile(join(SRC, "styles", "base.css"), "utf8"),
    themeCss(site.theme.tokens),
    ...[...usedTypes].sort().map((t) => components.get(t).css && `/* ${t} */\n${components.get(t).css}`),
    await readDirCss(join(dir, "styles")),
  ]
    .filter(Boolean)
    .join("\n");
  const cssRel = await writeHashed(out, "site", "css", css);
  const js = await scriptBundle(scripts, dir);
  const jsRel = js ? await writeHashed(out, "site", "js", js) : null;

  let faviconRel = site.favicon ? `assets/${site.favicon.replace(/^\/?(assets\/)?/, "")}` : null;
  if (!faviconRel) {
    faviconRel = await writeHashed(out, "favicon", "svg", generatedFavicon(site));
  }

  if (site.commerce) {
    const { ctx } = rendered[0];
    await writeFile(join(out, "_z", "catalog.json"), JSON.stringify(catalog(site.commerce, ctx), null, 2));
  }

  // Pass 2: assemble documents.
  for (const { page, ctx, state, main, nav, footer } of rendered) {
    const jsonLd = [...(page.path === "/" ? siteJsonLd(site, ctx) : []), ...state.jsonLd];
    const head = renderHead({
      site,
      page,
      target,
      ctx,
      cssHref: ctx.url(`/${cssRel}`),
      faviconHref: ctx.url(`/${faviconRel}`),
      jsonLd,
    });
    const scriptsTag = jsRel ? `<script defer src="${esc(ctx.url(`/${jsRel}`))}"></script>` : "";
    const commerceTag = site.commerce
      ? `<script type="application/json" id="zsite-commerce">${jsonScript(clientConfig(site.commerce, ctx))}</script>`
      : "";
    const beacon =
      target.analytics && site.analytics.cloudflareToken
        ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${esc(JSON.stringify({ token: site.analytics.cloudflareToken }))}'></script>`
        : "";
    const banner = target.banner ? `<div class="preview-banner" role="note">${esc(site.preview.text)}</div>` : "";
    const html = `<!doctype html>
<html lang="${esc(site.lang)}">
<head>
${head}
${scriptsTag}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${sprite(state.icons)}
${banner}
${nav}
<main id="main">
${main}
</main>
${footer}
${commerceTag}
${beacon}
</body>
</html>
`;
    const file = join(out, pageFile(page.path));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, html);
  }

  // Target extras.
  await writeFile(join(out, "robots.txt"), robotsTxt(target));
  if (target.indexable) {
    await writeFile(join(out, "sitemap.xml"), sitemapXml(pages, target, new Date().toISOString().slice(0, 10)));
  }
  if (target.name === "cloudflare") {
    await writeFile(join(out, "_headers"), headersFile(site));
    const redirects = redirectsFile(site);
    if (redirects) await writeFile(join(out, "_redirects"), redirects);
  }
  if (target.name === "pages") await writeFile(join(out, ".nojekyll"), "");

  // Privacy: nothing external may load (or receive form posts) unless declared.
  const firstParty = [new URL(target.siteUrl).host, site.api.base && new URL(site.api.base).host].filter(Boolean);
  const violations = await scanThirdParties(out, { firstParty, declared: site.compliance.thirdParties.map((t) => t.host) });
  if (violations.length) {
    throw new BuildError(
      violations.map(
        (v) => `undeclared third-party request ${v} — self-host it, make it click-to-load, or declare it in privacy.thirdParties (it will be listed in the privacy notice)`,
      ),
      [...warnings],
    );
  }

  const broken = await checkLinks(out, target.basePath);
  return {
    outDir: out,
    site,
    target,
    pages: pages.length,
    warnings: [...warnings],
    broken,
    ms: Math.round(performance.now() - t0),
  };
}
