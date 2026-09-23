import { attrs, each } from "../html.mjs";

const external = (href) => /^https?:\/\//.test(href);

export default {
  type: "strip",
  summary: "Compact horizontal strip of icon + short fact items (dates, place, key selling points). Best on dark/primary tone.",
  fullBleed: false,
  props: {
    items: { type: "array", required: true },
  },
  example: {
    tone: "dark",
    items: [
      { icon: "calendar", text: "Saturday 14 June 2026" },
      { icon: "map-pin", text: "Harbour Green, Ardglass", href: "https://www.google.com/maps/search/?api=1&query=Ardglass" },
      { icon: "users", text: "Free entry for spectators" },
      { icon: "leaf", text: "Dog friendly" },
    ],
  },
  render(props, ctx) {
    const item = (it) => {
      const body = `${it.icon ? ctx.icon(it.icon) : ""}<span>${ctx.md(it.text)}</span>`;
      if (!it.href) return `<li class="s-strip__item">${body}</li>`;
      const href = ctx.url(it.href);
      return `<li class="s-strip__item"><a${attrs({ href, rel: external(href) ? "noopener" : null })}>${body}</a></li>`;
    };
    return `${ctx.sectionHead(props, { center: true })}<ul class="s-strip__list">${each(props.items, item)}</ul>`;
  },
};
