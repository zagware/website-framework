import { attrs, each, esc } from "../html.mjs";

// Site asset path ("docs/a.pdf") → ctx.asset; root-relative, anchors and absolute URLs → ctx.url.
const href = (ctx, value) => (/^(\/|#|[a-z][a-z0-9+.-]*:)/i.test(value) ? ctx.url(value) : ctx.asset(value));
const kindOf = (item) => item.kind ?? /\.([a-z0-9]{2,4})(?:[?#].*)?$/i.exec(String(item.href))?.[1]?.toUpperCase() ?? "FILE";

export default {
  type: "documents",
  summary: "Cards linking downloadable files (press packs, entry forms, rules) with file type and size.",
  fullBleed: false,
  props: {
    items: { type: "array", required: true },
  },
  example: {
    eyebrow: "Media",
    heading: "Press & downloads",
    intro: "Everything you need to cover the event or enter a car.",
    items: [
      { title: "Press release 2026", text: "Dates, route, charity partners and contact details for journalists.", href: "docs/sample.pdf", kind: "PDF", size: "240 KB" },
      { title: "Entry form", text: "Print, complete and post back, or bring it on the day.", href: "docs/sample.pdf", size: "120 KB" },
      { title: "Route map", text: "The full 42-mile coastal route with rest stops.", href: "docs/sample.pdf" },
    ],
  },
  render(props, ctx) {
    const card = (item) => {
      const url = href(ctx, item.href);
      const kind = kindOf(item);
      const meta = [kind, item.size].filter(Boolean).map(esc).join(" · ");
      return `<li><a${attrs({ class: "s-documents__card card", href: url, rel: /^https?:\/\//.test(url) ? "noopener" : null })}>` +
        `<span class="s-documents__kind" aria-hidden="true">${ctx.icon("file")}<span>${esc(kind)}</span></span>` +
        `<div class="s-documents__body"><h3 class="s-documents__title">${esc(item.title)}</h3>` +
        `${item.text ? `<p class="s-documents__text">${esc(item.text)}</p>` : ""}` +
        `<span class="s-documents__meta">${ctx.icon("download")}<span>Download · ${meta}</span></span></div></a></li>`;
    };
    return `${ctx.sectionHead(props)}<ul class="s-documents__list">${each(props.items, card)}</ul>`;
  },
};
