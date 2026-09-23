import { esc } from "../html.mjs";

export default {
  type: "rich-text",
  summary: "Prose block with a readable measure (paragraphs, lists, inline links) and an optional aside panel.",
  fullBleed: false,
  props: {
    body: { type: "string|array", required: true },
    aside: { type: "object" },
  },
  example: {
    eyebrow: "Our story",
    heading: "Forty years on the harbour",
    body:
      "The rally started in 1986 when a handful of friends drove their cars down to the harbour for a **charity bake sale**. It has grown every year since, but the idea hasn't changed: good cars, good company, good causes.\n\n" +
      "Every penny raised goes to local charities. Over the years that has included:\n\n" +
      "- Ardglass RNLI lifeboat station\n- The Northern Ireland Children's Hospice\n- Local schools and youth clubs\n\n" +
      "Want to help? We're always looking for marshals -- [get in touch](/#contact).",
    aside: {
      heading: "At a glance",
      body: "- Founded 1986\n- Run entirely by volunteers\n- Over £120,000 raised",
    },
  },
  render(props, ctx) {
    const aside = props.aside?.body || props.aside?.heading
      ? `<aside class="s-rich-text__aside card">${props.aside.heading ? `<h3>${esc(props.aside.heading)}</h3>` : ""}${ctx.blocks(props.aside.body)}</aside>`
      : "";
    return `${ctx.sectionHead(props)}<div class="s-rich-text__layout${aside ? " s-rich-text__layout--aside" : ""}"><div class="s-rich-text__body">${ctx.blocks(props.body)}</div>${aside}</div>`;
  },
};
