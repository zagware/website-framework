// Dev server: rebuilds in a child process on change (fresh module graph, so
// edits to site.config.mjs, imported JSON, components and engine all apply),
// serves the output, and live-reloads browsers over Server-Sent Events.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".woff2": "font/woff2",
};
const RELOAD = `<script>(()=>{const s=new EventSource("/__zsite/events");s.onmessage=()=>location.reload();})();</script>`;
const IGNORED = /(^|[/\\])(\.zsite-dev|\.zsite-cache|dist|node_modules|\.git|\.wrangler)([/\\]|$)/;
const CLI = fileURLToPath(new URL("../bin/zsite.mjs", import.meta.url));
const FRAMEWORK_SRC = fileURLToPath(new URL("./", import.meta.url));

export async function serveStatic(root, { port = 4173, liveReload = false, onListen } = {}) {
  const clients = new Set();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (liveReload && url.pathname === "/__zsite/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    let path = decodeURIComponent(url.pathname);
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, safe);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!path.endsWith("/")) return res.writeHead(301, { location: `${path}/` }).end();
      file = join(file, "index.html");
    }
    let status = 200;
    if (!existsSync(file)) {
      status = 404;
      file = join(root, "404.html");
      if (!existsSync(file)) return res.writeHead(404).end("Not found");
    }
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    if (liveReload && type.startsWith("text/html")) {
      const html = (await readFile(file, "utf8")).replace("</body>", `${RELOAD}</body>`);
      return res.writeHead(status, { "content-type": type, "cache-control": "no-store" }).end(html);
    }
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    createReadStream(file).pipe(res);
  });
  await new Promise((ok) => server.listen(port, ok));
  onListen?.(`http://localhost:${port}/`);
  return {
    server,
    reload: () => clients.forEach((c) => c.write("data: reload\n\n")),
  };
}

function rebuild(siteDir, outDir) {
  return new Promise((ok) => {
    const child = spawn(process.execPath, [CLI, "build", siteDir, "--target", "local", "--out", outDir], {
      stdio: "inherit",
    });
    child.on("exit", (code) => ok(code === 0));
  });
}

export async function dev(siteDir, { port = 4173 } = {}) {
  const dir = resolve(siteDir);
  const outDir = join(dir, ".zsite-dev");
  await rebuild(dir, outDir);
  const { reload } = await serveStatic(outDir, {
    port,
    liveReload: true,
    onListen: (u) => console.log(`\nzsite dev → ${u}  (watching ${dir})`),
  });

  let timer = null;
  let building = false;
  let queued = false;
  const trigger = (_event, name) => {
    if (name && IGNORED.test(String(name))) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (building) return void (queued = true);
      building = true;
      do {
        queued = false;
        if (await rebuild(dir, outDir)) reload();
      } while (queued);
      building = false;
    }, 120);
  };
  watch(dir, { recursive: true }, trigger);
  watch(FRAMEWORK_SRC, { recursive: true }, trigger);
}
