import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { build, BuildError } from "../src/build.mjs";
import { loadComponents } from "../src/components.mjs";
import { normalizeSite } from "../src/config.mjs";
import { externalRequestsInHtml } from "../src/privacy.mjs";

let root;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "zsite-privacy-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

const site = (overrides = {}) => ({
  name: "Acme",
  urls: { production: "https://acme.example/", pages: "https://org.github.io/acme/" },
  theme: { preset: "classic" },
  privacy: { controller: { name: "Acme Ltd", email: "privacy@acme.example" } },
  pages: [
    {
      path: "/",
      title: "Home",
      sections: [
        { type: "hero", title: "Hi" },
        {
          type: "contact",
          form: { action: "worker", fields: [{ name: "email", label: "Email", type: "email" }, { name: "message", label: "Message", type: "textarea" }] },
        },
      ],
    },
    { path: "/privacy/", title: "Privacy", sections: [{ type: "privacy-notice" }] },
  ],
  ...overrides,
});

async function buildSite(name, config, target = "cloudflare") {
  const dir = join(root, name);
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "site.config.mjs"), `export default ${JSON.stringify(config)};`);
  const out = join(dir, "dist");
  return { result: await build({ siteDir: dir, target, outDir: out }), out };
}

describe("third-party requests", () => {
  it("self-hosts theme fonts: no Google requests, woff2 files emitted beside the CSS", async () => {
    const { out } = await buildSite("fonts", site());
    const home = await readFile(join(out, "index.html"), "utf8");
    assert.doesNotMatch(home, /googleapis|gstatic/);
    const css = readdirSync(join(out, "_z", "h")).find((f) => f.endsWith(".css"));
    const text = await readFile(join(out, "_z", "h", css), "utf8");
    const urls = [...text.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((m) => m[1]);
    assert.ok(urls.length >= 4);
    for (const u of urls) assert.ok(existsSync(join(out, "_z", "h", u)), u);
  });

  it("fails the build on an undeclared external resource, and passes once it is declared", async () => {
    const bad = site();
    bad.pages[0].sections[0].image = "https://cdn.tracker.example/hero.jpg";
    await assert.rejects(buildSite("undeclared", bad), (err) => {
      assert.ok(err instanceof BuildError);
      assert.match(err.message, /undeclared third-party request index\.html: img → https:\/\/cdn\.tracker\.example\/hero\.jpg/);
      return true;
    });
    bad.privacy.thirdParties = [{ host: "cdn.tracker.example", name: "Tracker CDN", purpose: "Hosts the hero photo" }];
    const { out } = await buildSite("declared", bad);
    assert.match(await readFile(join(out, "privacy", "index.html"), "utf8"), /Tracker CDN<\/strong> — Hosts the hero photo/);
  });

  it("treats the site's own Worker (api.base) as first party", async () => {
    const { result } = await buildSite("preview", site({ api: { base: "https://acme.example" } }), "pages");
    assert.equal(result.broken.length, 0);
  });

  it("detects auto-loaded resources but ignores links, canonical and click-to-load embeds", () => {
    const found = externalRequestsInHtml(`
      <a href="https://example.com/page">x</a>
      <link rel="canonical" href="https://acme.example/">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2">
      <button data-embed-load data-embed-url="https://www.openstreetmap.org/export/embed.html">Show map</button>
      <iframe src="https://www.youtube.com/embed/x"></iframe>
      <img srcset="https://img.example/a.webp 480w, /local.webp 960w">
      <form action="https://formspree.io/f/x"></form>
      <div style="background:url('https://bg.example/x.png')"></div>`).map((f) => new URL(f.url).host);
    assert.deepEqual(found, ["fonts.googleapis.com", "www.youtube.com", "img.example", "formspree.io", "bg.example"]);
  });
});

describe("privacy notice", async () => {
  const components = await loadComponents();

  it("describes only what the site does", async () => {
    const { out } = await buildSite("notice", site());
    const html = await readFile(join(out, "privacy", "index.html"), "utf8");
    assert.match(html, /Contact form\.<\/strong> What you enter \(Email, Message\)/);
    assert.doesNotMatch(html, /Stripe/);
    assert.doesNotMatch(html, /local storage/);
    assert.match(html, /Information Commissioner/);
    const home = await readFile(join(out, "index.html"), "utf8");
    assert.match(home, /href="\.\/privacy\/">Privacy<\/a>/); // footer
    assert.match(home, /class="s-contact__privacy muted">.*href="\.\/privacy\/"/); // next to the form
  });

  it("warns when personal data is collected without a notice, and requires a controller when there is one", () => {
    const noNotice = site();
    noNotice.pages.pop();
    assert.match(normalizeSite(noNotice, components).warnings.join("\n"), /collects personal data \(contact form\) but has no page/);
    const noController = site({ privacy: {} });
    assert.match(normalizeSite(noController, components).errors.join("\n"), /privacy\.controller: name and email are required/);
  });

  it("uses the Irish regulator for en-IE sites", async () => {
    const { out } = await buildSite("ie", site({ lang: "en-IE" }));
    assert.match(await readFile(join(out, "privacy", "index.html"), "utf8"), /Data Protection Commission \(Ireland\)/);
  });
});
