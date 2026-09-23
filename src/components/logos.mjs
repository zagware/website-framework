import { attrs, each, esc } from "../html.mjs";

export default {
  type: "logos",
  summary: "Sponsor / partner logo wall; names without a logo render as text pills.",
  fullBleed: false,
  props: {
    items: { type: "array", required: true },
  },
  example: {
    eyebrow: "Thank you",
    heading: "Our sponsors",
    align: "center",
    items: [
      { name: "Zagware", href: "https://example.com", logo: "img/logo.svg" },
      { name: "Harbour Garage", href: "https://example.com" },
      { name: "Ardglass Golf Club" },
      { name: "County Motors", logo: "img/logo.svg" },
      { name: "The Coast Café", href: "https://example.com" },
    ],
  },
  render(props, ctx) {
    const item = (it) => {
      const inner = it.logo
        ? `<span class="s-logos__logo">${ctx.image(it.logo, { alt: it.name ?? "", sizes: "180px" })}</span>`
        : `<span class="s-logos__name">${esc(it.name)}</span>`;
      const kind = it.logo ? "s-logos__item--logo" : "s-logos__item--text";
      if (!it.href) return `<li class="s-logos__item ${kind}">${inner}</li>`;
      const href = ctx.url(it.href);
      return `<li class="s-logos__item ${kind}"><a${attrs({ href, rel: /^https?:\/\//.test(href) ? "noopener" : null })}>${inner}</a></li>`;
    };
    return `${ctx.sectionHead(props)}<ul class="s-logos__list">${each(props.items, item)}</ul>`;
  },
};
