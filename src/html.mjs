// Escape-safe HTML helpers shared by the engine and every component.
// Components build markup with template literals; every piece of content
// that came from config MUST pass through esc(), attrs(), md() or blocks().

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const esc = (value) =>
  value == null ? "" : String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** Join class names, skipping falsy entries. */
export const cls = (...names) => names.flat().filter(Boolean).join(" ");

/** Render attributes: null/undefined/false are dropped, true renders bare. */
export function attrs(obj) {
  let out = "";
  for (const [key, value] of Object.entries(obj)) {
    if (value == null || value === false) continue;
    out += value === true ? ` ${key}` : ` ${key}="${esc(value)}"`;
  }
  return out;
}

/** Map a list to markup and join. Undefined lists render nothing. */
export const each = (list, fn) => (list ?? []).map(fn).join("");

/** Serialize JSON for embedding inside <script>; neutralises `</script>`. */
export const jsonScript = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

/**
 * Inline markup subset, applied after escaping:
 *   **bold**  *em*  `code`  [label](href)  --  (em dash)
 * `link` rewrites hrefs (root-relative → page-relative); defaults to identity.
 */
export function inline(text, link = (href) => href) {
  if (text == null) return "";
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      // href was escaped already; unescape &amp; for the rewrite, re-escape after.
      const raw = href.replace(/&amp;/g, "&");
      const external = /^https?:\/\//.test(raw);
      return `<a href="${esc(link(raw))}"${external ? ' rel="noopener"' : ""}>${label}</a>`;
    })
    .replace(/ -- /g, " &mdash; ");
}

/**
 * Block markup: a string (paragraphs split on blank lines) or string[].
 * A paragraph whose lines all start with "- " becomes a <ul>.
 */
export function blocks(value, link) {
  if (value == null) return "";
  const paras = Array.isArray(value) ? value : String(value).split(/\n\s*\n/);
  return paras
    .map((p) => String(p).trim())
    .filter(Boolean)
    .map((p) => {
      const lines = p.split("\n").map((l) => l.trim());
      if (lines.every((l) => l.startsWith("- "))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.slice(2), link)}</li>`).join("")}</ul>`;
      }
      return `<p>${inline(lines.join(" "), link)}</p>`;
    })
    .join("\n");
}

/** Slugify for ids/anchors. */
export const slug = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Format integer minor units as a localised currency string. */
export const money = (minor, currency, locale = "en-GB") =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
