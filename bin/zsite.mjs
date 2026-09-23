#!/usr/bin/env node
// zsite — Zagware site framework CLI.
//   zsite build <site> [--target local|pages|cloudflare] [--out dir] [--no-images] [--strict]
//   zsite dev <site> [--port 4173]
//   zsite check <site>            build every configured target to a temp dir; fail on errors/broken links
//   zsite new <dir> --name "Customer Ltd" [--worker] [--commerce] [--repo owner/name] [--domain example.com]
//   zsite smoke <url> [--api]     post-deploy check (home, robots, 404, /api/health)
//   zsite components              list section types

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { build, BuildError } from "../src/build.mjs";
import { loadComponents } from "../src/components.mjs";
import { dev } from "../src/dev-server.mjs";
import { scaffold } from "../src/scaffold.mjs";
import { smoke } from "../src/smoke.mjs";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: "string", default: "local" },
    out: { type: "string" },
    port: { type: "string", default: "4173" },
    "no-images": { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    name: { type: "string" },
    commerce: { type: "boolean", default: false },
    worker: { type: "boolean", default: false },
    repo: { type: "string" },
    domain: { type: "string" },
    api: { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
});
const [command, arg] = positionals;

const USAGE = `zsite <command>
  build <site> [--target local|pages|cloudflare] [--out dir] [--no-images] [--strict]
  dev <site> [--port 4173]
  check <site>
  new <dir> --name "Customer" [--worker] [--commerce] [--repo owner/name] [--domain example.com]
  smoke <url> [--api]
  components`;

function report(result) {
  const { site, target, pages, warnings, broken, outDir, ms } = result;
  console.log(`✓ ${site.name}: ${pages} page(s) → ${outDir} [${target.name} · ${target.siteUrl}] in ${ms}ms`);
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  for (const b of broken) console.warn(`  ✗ broken link ${b}`);
  return warnings.length + broken.length;
}

async function main() {
  if (opts.help || !command) return console.log(USAGE);
  switch (command) {
    case "build": {
      if (!arg) throw new Error("build needs a site directory");
      const result = await build({ siteDir: arg, target: opts.target, outDir: opts.out, images: !opts["no-images"] });
      const issues = report(result);
      if (result.broken.length || (opts.strict && issues)) process.exitCode = 1;
      return;
    }
    case "dev":
      if (!arg) throw new Error("dev needs a site directory");
      return dev(arg, { port: Number(opts.port) });
    case "check": {
      if (!arg) throw new Error("check needs a site directory");
      let failed = false;
      for (const target of ["local", "pages", "cloudflare"]) {
        const out = await mkdtemp(join(tmpdir(), `zsite-${target}-`));
        try {
          const result = await build({ siteDir: arg, target, outDir: out });
          if (report(result) && result.broken.length) failed = true;
          if (result.warnings.length) failed = true;
        } catch (err) {
          if (/needs urls\./.test(err.message)) console.log(`- ${target}: skipped (${err.message.split(" in ")[0]})`);
          else throw err;
        } finally {
          await rm(out, { recursive: true, force: true });
        }
      }
      if (failed) process.exitCode = 1;
      return;
    }
    case "new":
      if (!arg || !opts.name) throw new Error('new needs a directory and --name "Customer"');
      return scaffold(arg, { name: opts.name, commerce: opts.commerce, worker: opts.worker, repo: opts.repo, domain: opts.domain });
    case "smoke": {
      if (!arg) throw new Error("smoke needs the deployed site URL");
      const { failed } = await smoke(arg, { api: opts.api });
      if (failed) process.exitCode = 1;
      return;
    }
    case "components": {
      const registry = await loadComponents(arg);
      for (const [type, c] of [...registry].sort()) console.log(`${type.padEnd(16)} ${c.summary ?? ""}`);
      return;
    }
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  if (err instanceof BuildError) {
    console.error(`✗ ${err.message}`);
    for (const w of err.warnings) console.warn(`  ⚠ ${w}`);
  } else console.error(err);
  process.exitCode = 1;
});
