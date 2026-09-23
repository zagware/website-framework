// Component discovery: framework sections in src/components/*.mjs plus
// site-local sections in <site>/components/*.mjs (site wins on type clash).

import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FRAMEWORK_COMPONENTS = fileURLToPath(new URL("./components/", import.meta.url));

async function loadDir(dir, origin, into) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort()) {
    const mod = (await import(pathToFileURL(join(dir, file)).href)).default;
    const type = file.slice(0, -4);
    if (!mod || typeof mod.render !== "function") throw new Error(`${origin} component ${file}: default export needs render()`);
    if (mod.type !== type) throw new Error(`${origin} component ${file}: type "${mod.type}" must equal file name "${type}"`);
    const cssFile = join(dir, `${type}.css`);
    into.set(type, { ...mod, origin, css: existsSync(cssFile) ? await readFile(cssFile, "utf8") : "" });
  }
}

export async function loadComponents(siteDir) {
  const registry = new Map();
  await loadDir(FRAMEWORK_COMPONENTS, "framework", registry);
  if (siteDir) await loadDir(join(siteDir, "components"), "site", registry);
  return registry;
}
