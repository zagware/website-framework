// Post-deploy smoke test: `zsite smoke <siteUrl> [--api]`.
// Fails on real errors. A Cloudflare bot challenge (403 + `cf-mitigated: challenge`,
// common for GitHub-hosted runners when Bot Fight Mode is on) cannot be verified
// from that network, so it is reported but does not fail the deploy.

const UA = "zagware-zsite-smoke/1 (+https://github.com/zagware/website-framework)";

async function get(url, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (res.status < 500) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1))); // new custom domains may still be provisioning
  }
  throw last;
}

export async function smoke(siteUrl, { api = false, log = console.log } = {}) {
  const base = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  const checks = [
    ["home", "", (res, body) => res.status === 200 && /<html/i.test(body)],
    ["robots.txt", "robots.txt", (res) => res.status === 200],
    ["404 page", "__zsite-smoke-missing__/", (res) => res.status === 404],
  ];
  if (api) {
    checks.push(["api/health", "api/health", (res, body) => res.status === 200 && JSON.parse(body).ok === true]);
  }
  let failed = 0;
  let challenged = 0;
  for (const [name, path, ok] of checks) {
    try {
      const res = await get(new URL(path, base));
      const body = await res.text();
      if (res.status === 403 && res.headers.get("cf-mitigated") === "challenge") {
        challenged++;
        log(`~ ${name}: Cloudflare bot challenge from this network (not verifiable here)`);
      } else if (ok(res, body)) {
        log(`✓ ${name}: ${res.status}`);
      } else {
        failed++;
        log(`✗ ${name}: unexpected ${res.status}`);
      }
    } catch (err) {
      failed++;
      log(`✗ ${name}: ${err.message}`);
    }
  }
  return { failed, challenged };
}
