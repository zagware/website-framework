// Privacy compliance (UK GDPR / EU GDPR, PECR / ePrivacy).
//
// The framework's default is "nothing to consent to": no cookies, fonts
// self-hosted, embeds click-to-load. Two things keep it that way:
//   1. A third-party registry: every external host a site may contact is
//      declared (site `privacy.thirdParties`, component `thirdParties(props)`,
//      built-in integrations) with a name and purpose. The privacy-notice
//      section lists them, so the notice cannot drift from the site.
//   2. A build check that scans the output and fails on any auto-loaded
//      external resource or form destination that is not declared.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_RETENTION = {
  messages: "12 months after we last reply",
  orders: "6 years from the end of the financial year (UK tax record-keeping rules)",
};

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/**
 * Derive what the site collects and who it talks to, from the normalised
 * config. Returns { compliance, errors, warnings }; `compliance` is attached
 * to the site object and read by layout, contact, cart and privacy-notice.
 */
export function collectCompliance(site, components, raw = {}) {
  const errors = [];
  const warnings = [];
  const thirdParties = [];
  const add = (tp, where) => {
    if (!tp?.host || !tp?.name || !tp?.purpose) {
      errors.push(`${where}: third party needs host, name and purpose (got ${JSON.stringify(tp)})`);
      return;
    }
    if (/[/:]/.test(tp.host)) {
      errors.push(`${where}: host "${tp.host}" must be a bare host name like "cdn.example.com"`);
      return;
    }
    const existing = thirdParties.find((t) => t.host === tp.host);
    if (existing) {
      if (!existing.purpose.includes(tp.purpose)) existing.purpose += `; ${tp.purpose}`;
    } else thirdParties.push({ host: tp.host, name: tp.name, purpose: tp.purpose, policyUrl: tp.policyUrl ?? null });
  };

  (raw.thirdParties ?? []).forEach((tp, i) => add(tp, `privacy.thirdParties[${i}]`));

  const forms = [];
  let privacyPath = null;
  for (const page of site.pages) {
    for (const section of page.sections) {
      const comp = components.get(section.type);
      if (!comp) continue;
      if (section.type === "privacy-notice" && !privacyPath) privacyPath = page.path;
      for (const tp of comp.thirdParties?.(section) ?? []) add(tp, `${page.path} ${section.type}`);
      if (section.type === "contact" && section.form?.action && section.form.fields?.length) {
        const external = section.form.action !== "worker" && /^https?:\/\//.test(section.form.action);
        forms.push({
          page: page.path,
          fields: section.form.fields.map((f) => f.label ?? f.name),
          destination: external ? hostOf(section.form.action) : "worker",
        });
      }
    }
  }
  if (site.analytics.cloudflareToken) {
    add(
      {
        host: "static.cloudflareinsights.com",
        name: "Cloudflare Web Analytics",
        purpose: "Cookieless, aggregated visitor statistics (no cross-site tracking)",
        policyUrl: "https://www.cloudflare.com/privacypolicy/",
      },
      "analytics",
    );
  }

  const collectsPersonalData = forms.length > 0 || Boolean(site.commerce);
  const controller = raw.controller ?? null;
  if (privacyPath && (!controller?.name || !controller?.email)) {
    errors.push("privacy.controller: name and email are required when the site has a privacy-notice page");
  }
  if (collectsPersonalData && !privacyPath) {
    warnings.push(
      `the site collects personal data (${[forms.length && "contact form", site.commerce && "shop"].filter(Boolean).join(" + ")}) but has no page with a "privacy-notice" section`,
    );
  }

  return {
    compliance: {
      controller,
      regulator: raw.regulator ?? (site.lang === "en-IE" ? "dpc" : "ico"),
      registration: raw.registration ?? null,
      retention: { ...DEFAULT_RETENTION, ...(raw.retention ?? {}) },
      updated: raw.updated ?? null,
      extra: raw.extra ?? [],
      thirdParties,
      forms,
      privacyPath,
      collectsPersonalData,
    },
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Output scan

const AUTOLOAD_LINK_RELS = /\b(stylesheet|preconnect|dns-prefetch|preload|modulepreload|prefetch|prerender|icon|apple-touch-icon|manifest)\b/i;

function parseAttrs(text) {
  const attrs = {};
  for (const m of text.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[m[1].toLowerCase()] = m[2].replace(/&amp;/g, "&");
  return attrs;
}

/** External URLs a browser fetches (or posts to) without the visitor asking, from one HTML document. */
export function externalRequestsInHtml(html) {
  const found = [];
  const push = (url, kind) => {
    if (/^(https?:)?\/\//i.test(url)) found.push({ url: url.startsWith("//") ? `https:${url}` : url, kind });
  };
  for (const m of html.matchAll(/<([a-z][a-z0-9-]*)(\s[^>]*)?>/gi)) {
    const tag = m[1].toLowerCase();
    const a = parseAttrs(m[2] ?? "");
    if (tag === "script" && a.src) push(a.src, "script");
    else if (tag === "link" && a.href && AUTOLOAD_LINK_RELS.test(a.rel ?? "")) push(a.href, `link rel=${a.rel}`);
    else if (["img", "iframe", "video", "audio", "source", "embed", "track", "input"].includes(tag)) {
      if (a.src) push(a.src, tag);
      if (a.poster) push(a.poster, `${tag} poster`);
      for (const part of (a.srcset ?? "").split(",")) if (part.trim()) push(part.trim().split(/\s+/)[0], `${tag} srcset`);
    } else if (tag === "object" && a.data) push(a.data, "object");
    else if (tag === "form" && a.action) push(a.action, "form action");
    if (a.style) for (const u of a.style.matchAll(/url\(\s*['"]?([^'")]+)/g)) push(u[1], "inline style");
  }
  for (const s of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const u of s[1].matchAll(/url\(\s*['"]?([^'")]+)|@import\s+['"]([^'"]+)/g)) push(u[1] ?? u[2], "inline css");
  }
  return found;
}

/** External hosts referenced by bundled CSS (url()/@import) or JS (string literals). */
export function externalRequestsInAsset(text, kind) {
  const found = [];
  const re = kind === "css" ? /url\(\s*['"]?(https?:\/\/[^'")]+)|@import\s+['"](https?:\/\/[^'"]+)/g : /["'`](https?:\/\/[^"'`\s]+)/g;
  for (const m of text.matchAll(re)) found.push({ url: m[1] ?? m[2], kind });
  return found;
}

/**
 * Scan the built output. Anything external that is not first-party (site or
 * Worker host) and not in the registry is a violation.
 */
export async function scanThirdParties(outDir, { firstParty, declared }) {
  const allowed = new Set([...firstParty, ...declared]);
  const violations = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      const rel = full.slice(outDir.length + 1).split("\\").join("/");
      let found = [];
      if (e.name.endsWith(".html")) found = externalRequestsInHtml(await readFile(full, "utf8"));
      else if (rel.startsWith("_z/h/") && e.name.endsWith(".css")) found = externalRequestsInAsset(await readFile(full, "utf8"), "css");
      else if (rel.startsWith("_z/h/") && e.name.endsWith(".js")) found = externalRequestsInAsset(await readFile(full, "utf8"), "js");
      for (const f of found) {
        const host = hostOf(f.url);
        if (host && !allowed.has(host)) violations.push(`${rel}: ${f.kind} → ${f.url}`);
      }
    }
  };
  await walk(outDir);
  return [...new Set(violations)];
}
