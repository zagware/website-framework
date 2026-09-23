#!/usr/bin/env node
// Run a command with CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID loaded from
// a local secrets file, without ever printing them.
//
//   node scripts/with-cf.mjs [--env-file path] -- npx wrangler deploy
//
// The file may use `KEY=value` or `KEY value` lines. Default path comes from
// $ZSITE_CF_ENV_FILE. Only CLOUDFLARE_* keys are read.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1 || sep === argv.length - 1) {
  console.error("usage: with-cf.mjs [--env-file path] -- <command> [args...]");
  process.exit(2);
}
const flags = argv.slice(0, sep);
const command = argv.slice(sep + 1);
const fileFlag = flags.indexOf("--env-file");
const file = (fileFlag !== -1 ? flags[fileFlag + 1] : process.env.ZSITE_CF_ENV_FILE)?.replace(/^~(?=\/)/, homedir());
if (!file) {
  console.error("No env file: pass --env-file or set ZSITE_CF_ENV_FILE");
  process.exit(2);
}

const env = { ...process.env };
const loaded = [];
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*(?:export\s+)?(CLOUDFLARE_[A-Z_]+)\s*(?:=|\s)\s*["']?([^"'\s]+)["']?\s*$/);
  if (m) {
    env[m[1]] = m[2];
    loaded.push(m[1]);
  }
}
if (!loaded.includes("CLOUDFLARE_API_TOKEN")) {
  console.error(`CLOUDFLARE_API_TOKEN not found in ${file}`);
  process.exit(2);
}
console.error(`with-cf: loaded ${loaded.join(", ")} (values hidden)`);
const child = spawn(command[0], command.slice(1), { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code));
