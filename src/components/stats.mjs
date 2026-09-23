import { attrs, each, esc } from "../html.mjs";

export default {
  type: "stats",
  summary: "Key facts and figures as large numbers with labels (optionally linked).",
  fullBleed: false,
  props: {
    items: { type: "array", required: true },
  },
  example: {
    eyebrow: "By the numbers",
    heading: "Forty years of the rally",
    align: "center",
    items: [
      { value: "40", label: "Years running", sub: "Since 1986" },
      { value: "120+", label: "Cars on the green" },
      { value: "£120k", label: "Raised for charity", sub: "and counting", href: "/#contact" },
      { value: "42", label: "Miles of coast road" },
    ],
  },
  render(props, ctx) {
    const item = (it) => {
      const inner = `<span class="s-stats__value">${esc(it.value)}</span><span class="s-stats__label">${esc(it.label)}</span>${
        it.sub ? `<span class="s-stats__sub">${esc(it.sub)}</span>` : ""
      }`;
      if (!it.href) return `<li class="s-stats__item"><div class="s-stats__box">${inner}</div></li>`;
      const href = ctx.url(it.href);
      return `<li class="s-stats__item"><a${attrs({ class: "s-stats__box s-stats__link", href, rel: /^https?:\/\//.test(href) ? "noopener" : null })}>${inner}</a></li>`;
    };
    return `${ctx.sectionHead(props)}<ul class="s-stats__list">${each(props.items, item)}</ul>`;
  },
};
