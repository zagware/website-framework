// Asset pipeline: copy <site>/assets → dist/assets, generate responsive WebP
// variants for raster images when `sharp` is installed (optional dependency),
// and record intrinsic dimensions so <img> gets width/height (no layout shift).
// Only the assets dir is deployed — never the site root.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";

export const VARIANT_WIDTHS = [480, 960, 1600];
const RASTER = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // Cloudflare Workers static assets per-file limit
const IGNORE = new Set([".DS_Store", "Thumbs.db"]);

let sharpModule;
async function loadSharp() {
  if (sharpModule === undefined) {
    try {
      sharpModule = (await import("sharp")).default;
    } catch {
      sharpModule = null;
    }
  }
  return sharpModule;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const posix = (p) => p.split(sep).join("/");
const variantName = (rel, w) => `${rel.slice(0, -extname(rel).length)}-${w}w.webp`;

/**
 * Copy assets and build the image manifest.
 * @returns {{ manifest: Map<string, {width, height, variants: {w, path}[]}>, files: Set<string>, warnings: string[], errors: string[] }}
 */
export async function processAssets({ siteDir, outDir, target, images = true }) {
  const src = join(siteDir, "assets");
  const manifest = new Map();
  const files = new Set();
  const warnings = [];
  const errors = [];
  if (!existsSync(src)) return { manifest, files, warnings, errors };

  const sharp = images ? await loadSharp() : null;
  if (images && !sharp) warnings.push("sharp not installed: images are copied without responsive variants or dimensions");
  const cacheDir = join(siteDir, ".zsite-cache", "img");

  for (const file of await walk(src)) {
    const rel = posix(relative(src, file));
    const dest = join(outDir, "assets", rel);
    const info = await stat(file);
    if (info.size > MAX_ASSET_BYTES) {
      const msg = `assets/${rel} is ${(info.size / 1048576).toFixed(1)} MiB; Cloudflare static assets cap files at 25 MiB (host large media on R2/Stream)`;
      (target === "cloudflare" ? errors : warnings).push(msg);
    }
    if (/\s/.test(rel)) warnings.push(`assets/${rel}: file names with spaces make fragile URLs; rename it`);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(file, dest);
    files.add(rel);

    if (!sharp || !RASTER.has(extname(rel).toLowerCase())) continue;
    const meta = await sharp(file).metadata();
    const entry = { width: meta.width, height: meta.height, variants: [] };
    const key = createHash("sha1").update(`${rel}:${info.size}:${info.mtimeMs}`).digest("hex").slice(0, 12);
    for (const w of VARIANT_WIDTHS.filter((w) => w < meta.width)) {
      const vRel = variantName(rel, w);
      const cached = join(cacheDir, `${key}-${w}.webp`);
      if (!existsSync(cached)) {
        await mkdir(cacheDir, { recursive: true });
        await sharp(file).resize({ width: w }).webp({ quality: 78 }).toFile(cached);
      }
      await copyFile(cached, join(outDir, "assets", vRel));
      entry.variants.push({ w, path: vRel });
    }
    // Always offer a full-width WebP when the source is not already WebP.
    if (extname(rel).toLowerCase() !== ".webp") {
      const vRel = variantName(rel, meta.width);
      const cached = join(cacheDir, `${key}-full.webp`);
      if (!existsSync(cached)) {
        await mkdir(cacheDir, { recursive: true });
        await sharp(file).webp({ quality: 80 }).toFile(cached);
      }
      await copyFile(cached, join(outDir, "assets", vRel));
      entry.variants.push({ w: meta.width, path: vRel });
    }
    manifest.set(rel, entry);
  }
  return { manifest, files, warnings, errors };
}

/**
 * Copy <site>/static verbatim into the site root. For files that must keep an exact URL --
 * legacy pages, PDFs, .well-known -- and are not part of the image pipeline. Nothing is
 * renamed, hashed or transformed, so these URLs survive a redesign.
 * @returns {{ files: Set<string>, warnings: string[], errors: string[] }}
 */
export async function copyStatic({ siteDir, outDir, target }) {
  const src = join(siteDir, "static");
  const files = new Set();
  const warnings = [];
  const errors = [];
  if (!existsSync(src)) return { files, warnings, errors };

  for (const file of await walk(src)) {
    const rel = posix(relative(src, file));
    const info = await stat(file);
    if (info.size > MAX_ASSET_BYTES) {
      const msg = `static/${rel} is ${(info.size / 1048576).toFixed(1)} MiB; Cloudflare static assets cap files at 25 MiB (host large media on R2/Stream)`;
      (target === "cloudflare" ? errors : warnings).push(msg);
    }
    if (/\s/.test(rel)) warnings.push(`static/${rel}: file names with spaces make fragile URLs; rename it`);
    const dest = join(outDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(file, dest);
    files.add(rel);
  }
  return { files, warnings, errors };
}

/** Write a content-hashed file under dist/_z/h/ and return its dist-relative path. */
export async function writeHashed(outDir, name, ext, content) {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 10);
  const rel = `_z/h/${name}.${hash}.${ext}`;
  await mkdir(dirname(join(outDir, rel)), { recursive: true });
  await writeFile(join(outDir, rel), content);
  return rel;
}
