import { each, esc } from "../html.mjs";

// Languages are a label and a CSS hook only. The framework ships no syntax
// highlighter: highlighting means either a runtime dependency on every page or
// a build-time one in src/, and neither earns its place for command snippets.
const LANGUAGES = {
  bash: "Shell",
  yaml: "YAML",
  json: "JSON",
  js: "JavaScript",
  sql: "SQL",
  text: "",
};

export default {
  type: "code",
  summary: "Code, command or config snippet with an optional filename, language label and copy button.",
  fullBleed: false,
  props: {
    code: { type: "string" },
    language: { type: "string" },
    filename: { type: "string" },
    blocks: { type: "array" },
    note: { type: "string" },
    copy: { type: "boolean" },
  },
  example: {
    eyebrow: "Quick start",
    heading: "Run the scanner on a pull request",
    blocks: [
      {
        filename: ".github/workflows/scan.yml",
        language: "yaml",
        code:
          "name: scan\non: [pull_request]\njobs:\n  scan:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: zagware/scanner-action@v1",
      },
      { language: "bash", code: "docker run --rm -v \"$PWD:/src\" ghcr.io/zagware/scanner:latest" },
    ],
    note: "The action needs no token for public repositories.",
  },
  render(props, ctx) {
    const blocks = props.blocks?.length ? props.blocks : props.code != null ? [props] : [];
    if (!blocks.length) return ctx.sectionHead(props);
    const copy = props.copy !== false;
    if (copy) ctx.useScript("copy-code");

    const block = (b) => {
      const lang = typeof b.language === "string" ? b.language.toLowerCase() : "";
      const label = b.filename ?? LANGUAGES[lang] ?? "";
      const id = ctx.uid("code");
      const head = label || copy
        ? `<div class="s-code__head">` +
          `<span class="s-code__label"${b.filename ? ' data-filename="true"' : ""}>${esc(label)}</span>` +
          (copy ? `<button type="button" class="s-code__copy" data-copy-code="${id}">Copy</button>` : "") +
          `</div>`
        : "";
      return `<figure class="s-code__block">${head}` +
        `<pre class="s-code__pre"${lang ? ` data-lang="${esc(lang)}"` : ""}><code id="${id}">${esc(String(b.code ?? ""))}</code></pre>` +
        `</figure>`;
    };

    return `${ctx.sectionHead(props)}<div class="s-code__list">${each(blocks, block)}</div>` +
      `${props.note ? `<p class="s-code__note">${ctx.md(props.note)}</p>` : ""}`;
  },
};
