import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { build, BuildError, createContext, deepMerge } from "../src/build.mjs";
import { loadComponents } from "../src/components.mjs";
import { normalizeSite } from "../src/config.mjs";
import { resolveTarget } from "../src/targets.mjs";

const BASE = {
  name: "Test <Site>",
  urls: { production: "https://example.com/", pages: "https://org.github.io/repo/" },
  nav: [{ label: "About", href: "/about/" }],
  pages: [
    {
      path: "/",
      title: "Home <b>",
      sections: [
        { type: "hero", title: "Hello <script>alert(1)</script>", actions: [{ label: "About", href: "/about/" }] },
        { type: "faq", id: "faq", items: [{ q: "Q1?", a: "A1 with [link](/about/)." }] },
      ],
    },
    { path: "/about/", title: "About", sections: [{ type: "split", body: "Back [home](/#faq)." }] },
  ],
  targets: { pages: { description: "pages-only description" } },
};

let root;
const siteDir = (name) => join(root, name);
async function writeSite(name, config, files = {}) {
  const dir = siteDir(name);
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "site.config.mjs"), `export default ${JSON.stringify(config)};`);
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
  return dir;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "zsite-test-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("page-relative URLs", async () => {
  const components = await loadComponents();
  const { site } = normalizeSite(BASE, components);
  const pagesTarget = resolveTarget(site, "pages");
  const ctxFor = (page, target = pagesTarget) =>
    createContext({ site, page, target, manifest: new Map(), assetFiles: null, warnings: new Set() }).ctx;

  it("rewrites root-relative links by page depth so subpath hosting works", () => {
    const home = ctxFor({ path: "/" });
    const nested = ctxFor({ path: "/shop/cart/" });
    assert.equal(home.url("/about/"), "./about/");
    assert.equal(home.url("/"), "./");
    assert.equal(nested.url("/about/"), "../../about/");
    assert.equal(nested.url("/"), "../../");
    assert.equal(nested.asset("img/a.jpg"), "../../assets/img/a.jpg");
  });

  it("keeps same-page anchors as fragments and leaves external links alone", () => {
    const home = ctxFor({ path: "/" });
    assert.equal(home.url("/#faq"), "#faq");
    assert.equal(ctxFor({ path: "/about/" }).url("/#faq"), "../#faq");
    for (const href of ["https://x.test/a", "mailto:a@b.c", "tel:+44", "#top"]) assert.equal(home.url(href), href);
  });

  it("uses the target base path on the 404 page, which is served at any depth", () => {
    const nf = ctxFor({ path: "/404.html", notFound: true });
    assert.equal(nf.url("/about/"), "/repo/about/");
    assert.equal(nf.abs("/about/"), "https://org.github.io/repo/about/");
  });
});

describe("config validation", async () => {
  const components = await loadComponents();
  const errorsFor = (config) => normalizeSite(config, components).errors.join("\n");

  it("rejects unknown section types, missing required props and bad paths", () => {
    const errs = errorsFor({
      name: "x",
      pages: [
        { path: "/", title: "Home", sections: [{ type: "nope" }, { type: "hero" }] },
        { path: "/About", title: "Bad path", sections: [] },
      ],
    });
    assert.match(errs, /unknown section type "nope"/);
    assert.match(errs, /\(hero\): "title" is required/);
    assert.match(errs, /path "\/About" must look like/);
  });

  it("requires a home page and unique paths", () => {
    const errs = errorsFor({ name: "x", pages: [{ path: "/a/", title: "A" }, { path: "/a/", title: "A2" }] });
    assert.match(errs, /duplicate path "\/a\/"/);
    assert.match(errs, /home page with path "\/" is required/);
  });

  it("rejects theme token values that could break out of the :root block", () => {
    const errs = errorsFor({ ...BASE, theme: { tokens: { "--c-primary": "red;} body{display:none" } } });
    assert.match(errs, /may not contain/);
  });

  it("deep-merges per-target overrides with arrays replacing", () => {
    assert.deepEqual(deepMerge({ a: { b: 1, c: [1, 2] } }, { a: { c: [3] } }), { a: { b: 1, c: [3] } });
  });
});

describe("builds per target", () => {
  it("pages target: noindex everywhere, robots disallow, no sitemap, preview banner, escaped content", async () => {
    const dir = await writeSite("pages-site", BASE);
    const out = join(dir, "dist");
    const result = await build({ siteDir: dir, target: "pages", outDir: out });
    assert.deepEqual(result.broken, []);
    const home = await readFile(join(out, "index.html"), "utf8");
    assert.match(home, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(home, /class="preview-banner"/);
    assert.match(home, /<link rel="canonical" href="https:\/\/org\.github\.io\/repo\/">/);
    assert.match(home, /pages-only description/);
    assert.doesNotMatch(home, /<script>alert/);
    assert.match(home, /Hello &lt;script&gt;/);
    assert.equal(await readFile(join(out, "robots.txt"), "utf8"), "User-agent: *\nDisallow: /\n");
    assert.ok(!existsSync(join(out, "sitemap.xml")));
    assert.ok(existsSync(join(out, ".nojekyll")));
    assert.ok(existsSync(join(out, "404.html")));
  });

  it("cloudflare target: indexable, sitemap of indexable pages, _headers, FAQ JSON-LD", async () => {
    const dir = await writeSite("cf-site", BASE);
    const out = join(dir, "dist");
    await build({ siteDir: dir, target: "cloudflare", outDir: out });
    const home = await readFile(join(out, "index.html"), "utf8");
    assert.doesNotMatch(home, /noindex/);
    assert.doesNotMatch(home, /preview-banner/);
    assert.match(home, /"@type":"FAQPage"/);
    const sitemap = await readFile(join(out, "sitemap.xml"), "utf8");
    assert.match(sitemap, /<loc>https:\/\/example\.com\/<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/example\.com\/about\/<\/loc>/);
    assert.doesNotMatch(sitemap, /404/);
    assert.match(await readFile(join(out, "robots.txt"), "utf8"), /Sitemap: https:\/\/example\.com\/sitemap\.xml/);
    assert.match(await readFile(join(out, "_headers"), "utf8"), /\/_z\/h\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
  });

  it("fails the cloudflare build on assets over the 25 MiB Workers limit", async () => {
    const dir = await writeSite("big-site", BASE);
    await mkdir(join(dir, "assets", "video"), { recursive: true });
    const big = join(dir, "assets", "video", "huge.mp4");
    await writeFile(big, "");
    await truncate(big, 26 * 1024 * 1024);
    await assert.rejects(build({ siteDir: dir, target: "cloudflare", outDir: join(dir, "dist") }), (err) => {
      assert.ok(err instanceof BuildError);
      assert.match(err.message, /25 MiB/);
      return true;
    });
    const res = await build({ siteDir: dir, target: "pages", outDir: join(dir, "dist") });
    assert.ok(res.warnings.some((w) => /25 MiB/.test(w)));
  });

  it("reports broken internal links", async () => {
    const config = structuredClone(BASE);
    config.pages[1].sections[0].body = "See [missing](/nowhere/).";
    const dir = await writeSite("broken-site", config);
    const res = await build({ siteDir: dir, target: "pages", outDir: join(dir, "dist") });
    assert.deepEqual(res.broken, ["/about/index.html: ../nowhere/"]);
  });
});
