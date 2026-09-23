// `zsite new <dir>`: create a customer site repo from templates/site, then
// apply overlays: `worker` (site Worker for contact forms/checkout: --worker or
// --commerce) and `commerce` (shop config: --commerce). Files ending in `.tmpl`
// get {{PLACEHOLDER}} substitution.

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { slug } from "./html.mjs";

const TEMPLATES = fileURLToPath(new URL("../templates/", import.meta.url));
const PKG = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
export const FRAMEWORK_REPO = "zagware/website-framework";

async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* files(full);
    else yield full;
  }
}

export async function scaffold(dir, { name, commerce = false, worker = false, repo, domain }) {
  const out = resolve(dir);
  if (existsSync(out) && (await readdir(out)).length) throw new Error(`${out} exists and is not empty`);
  const siteSlug = slug(name);
  const repoName = repo ?? `zagware/${basename(out).replace(/_/g, "-")}`;
  const [owner, repoShort] = repoName.split("/");
  const host = domain ? domain.replace(/^https?:\/\//, "").replace(/\/$/, "") : `${siteSlug}.zagware.io`;
  const vars = {
    NAME: name,
    SLUG: siteSlug,
    REPO: repoName,
    PAGES_URL: `https://${owner}.github.io/${repoShort}/`,
    PRODUCTION_URL: `https://${host}/`,
    DOMAIN: host,
    FRAMEWORK: `github:${FRAMEWORK_REPO}#v${PKG.version}`,
    FRAMEWORK_REPO,
    WORKER_NAME: siteSlug,
    COMPAT_DATE: new Date().toISOString().slice(0, 10),
  };

  await mkdir(out, { recursive: true });
  await cp(join(TEMPLATES, "site"), out, { recursive: true });
  const overlays = [...(worker || commerce ? ["worker"] : []), ...(commerce ? ["commerce"] : [])];
  for (const overlay of overlays) {
    // Overlay files replace base files with the same (post-.tmpl) name.
    for await (const f of files(join(TEMPLATES, "overlays", overlay))) {
      const rel = f.slice(join(TEMPLATES, "overlays", overlay).length + 1);
      await rm(join(out, rel.replace(/\.tmpl$/, "")), { force: true });
      await rm(join(out, rel.endsWith(".tmpl") ? rel : `${rel}.tmpl`), { force: true });
      await mkdir(join(out, rel, ".."), { recursive: true });
      await cp(f, join(out, rel));
    }
  }

  for await (const f of files(out)) {
    if (!f.endsWith(".tmpl")) continue;
    const text = (await readFile(f, "utf8")).replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
    await writeFile(f.slice(0, -5), text);
    await rm(f);
  }
  // npm strips .gitignore from published packages; ship it as `gitignore`.
  if (existsSync(join(out, "gitignore"))) await rename(join(out, "gitignore"), join(out, ".gitignore"));

  console.log(`✓ Created ${name} in ${out}${overlays.length ? ` (+ ${overlays.join(", ")})` : ""}
  Next:
    cd ${dir}
    npm install
    npx zsite dev .            # http://localhost:4173
  Preview: push to ${repoName}, then Settings → Pages → Source: GitHub Actions → ${vars.PAGES_URL}
  Production: see README.md "Go live on Cloudflare"`);
  return { out, vars };
}
