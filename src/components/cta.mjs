import { attrs, cls, each, esc } from "../html.mjs";

const STYLES = new Set(["primary", "accent", "outline"]);

export default {
  type: "cta",
  summary: "Centred call-to-action band: heading, short text and one to three buttons.",
  fullBleed: false,
  props: {
    heading: { type: "string", required: true },
    text: { type: "string" },
    actions: { type: "array", required: true },
  },
  example: {
    tone: "primary",
    eyebrow: "Entries open",
    heading: "Bring your car to the harbour",
    text: "Places on the green are limited to **120 cars**. Enter by 31 May to guarantee a spot.",
    actions: [
      { label: "Enter your car", href: "/#contact", style: "accent" },
      { label: "Read the FAQ", href: "#faq", style: "outline" },
    ],
  },
  render(props, ctx) {
    const action = (a, i) => {
      const style = STYLES.has(a.style) ? a.style : i === 0 ? "primary" : "outline";
      const href = ctx.url(a.href);
      return `<a${attrs({ class: cls("btn", `btn--${style}`), href, rel: /^https?:\/\//.test(href) ? "noopener" : null })}>${esc(a.label)}${
        i === 0 ? ctx.icon("arrow-right") : ""
      }</a>`;
    };
    const head = ctx.sectionHead({ eyebrow: props.eyebrow, heading: props.heading, intro: props.text ?? props.intro }, { center: true });
    return `<div class="s-cta__inner">${head}<div class="btn-row s-cta__actions">${each(props.actions, action)}</div></div>`;
  },
};
