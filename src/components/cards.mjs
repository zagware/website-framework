import { esc } from "../html.mjs";
import { actionButtons } from "./hero.mjs";

export default {
  type: "cards",
  summary: "Grid of cards (services, features, offers, buying options) with optional icon, image, tag, meta and link.",
  fullBleed: false,
  props: {
    items: { type: "array", required: true },
    columns: { type: "number" },
    style: { type: "string" },
    actions: { type: "array" },
  },
  example: {
    eyebrow: "What we do",
    heading: "Cards for services, features or offers",
    intro: "Each card can have an icon **or** an image, a tag, a meta line and a link.",
    items: [
      { icon: "leaf", title: "Informational sites", text: "Static, fast and cheap to host on GitHub Pages or Cloudflare.", href: "/#about", linkLabel: "About" },
      { icon: "cart", title: "Online shop", text: "Stripe Checkout with a tiny Cloudflare Worker; no servers to patch.", tag: "New" },
      { image: "img/sample-2.jpg", title: "Image card", text: "Cards with an image header crop to a consistent 16:10 ratio.", meta: "From £48.00" },
    ],
  },
  render(p, ctx) {
    const cols = p.columns ? ` style="--min:${Math.round(1100 / p.columns) - 40}px"` : "";
    const plain = p.style === "plain";
    const cards = p.items
      .map((item) => {
        const external = item.href && /^https?:/.test(item.href);
        const link = item.href
          ? `<a class="s-cards__link" href="${esc(ctx.url(item.href))}"${external ? ' rel="noopener"' : ""}>${esc(item.linkLabel ?? "Find out more")}${ctx.icon(external ? "external" : "arrow-right")}</a>`
          : "";
        return `<article class="${plain ? "s-cards__item s-cards__item--plain" : "card s-cards__item"}">
${item.image ? `<div class="s-cards__media">${ctx.image(item.image, { alt: item.imageAlt ?? "", sizes: "(max-width: 760px) 100vw, 33vw" })}</div>` : ""}
${item.icon ? `<span class="s-cards__icon">${ctx.icon(item.icon)}</span>` : ""}
${item.tag ? `<span class="chip s-cards__tag">${esc(item.tag)}</span>` : ""}
<h3>${ctx.md(item.title)}</h3>
${item.text ? ctx.blocks(item.text) : ""}
${item.meta ? `<p class="s-cards__meta">${ctx.md(item.meta)}</p>` : ""}
${link}
</article>`;
      })
      .join("\n");
    return `${ctx.sectionHead(p)}<div class="grid s-cards__grid"${cols}>${cards}</div>${
      p.actions?.length ? `<div class="s-cards__actions">${actionButtons(p.actions, ctx)}</div>` : ""
    }`;
  },
};
