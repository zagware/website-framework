import { esc } from "../html.mjs";
import { actionButtons } from "./hero.mjs";

export default {
  type: "split",
  summary: "Two-column text + image (or text + key-facts panel) block for About/story sections; reversible.",
  fullBleed: false,
  props: {
    body: { type: "string|array" },
    paragraphs: { type: "array" },
    image: { type: "string" },
    imageAlt: { type: "string" },
    caption: { type: "string" },
    reverse: { type: "boolean" },
    facts: { type: "array" },
    factsHeading: { type: "string" },
    factsText: { type: "string" },
    actions: { type: "array" },
  },
  example: {
    eyebrow: "About",
    heading: "A split section with a *key facts* panel",
    paragraphs: [
      "Text on one side, an image or facts on the other. Paragraphs support **bold**, *emphasis* and [links](/#faq).",
      "- Bullet lists work too\n- Just start lines with a dash",
    ],
    facts: [
      { label: "When", value: "14 March 2027", sub: "Registration 8:00" },
      { label: "Where", value: "Carlingford", sub: "Co. Louth", href: "https://maps.google.com/?q=Carlingford" },
      { label: "Distance", value: "42 km", sub: "Long course" },
    ],
    actions: [{ label: "Contact us", href: "/#contact" }],
  },
  render(p, ctx) {
    const text = `<div class="s-split__text">${ctx.sectionHead(p)}${ctx.blocks(p.paragraphs ?? p.body)}${actionButtons(p.actions, ctx)}</div>`;
    let side = "";
    if (p.facts?.length) {
      const factsHead = p.factsHeading || p.factsText
        ? `${p.factsHeading ? `<h3>${ctx.md(p.factsHeading)}</h3>` : ""}${p.factsText ? `<p class="muted">${ctx.md(p.factsText)}</p>` : ""}`
        : "";
      side = `<aside class="s-split__aside card">${factsHead}<dl class="s-split__facts">${p.facts
        .map((f) => {
          const value = f.href
            ? `<a href="${esc(ctx.url(f.href))}"${/^https?:/.test(f.href) ? ' rel="noopener"' : ""}>${esc(f.value)}</a>`
            : esc(f.value);
          return `<div><dt>${esc(f.label)}</dt><dd><strong>${value}</strong>${f.sub ? `<span>${esc(f.sub)}</span>` : ""}</dd></div>`;
        })
        .join("")}</dl></aside>`;
    } else if (p.image) {
      side = `<figure class="s-split__figure">${ctx.image(p.image, { alt: p.imageAlt ?? "", sizes: "(max-width: 860px) 100vw, 50vw" })}${
        p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""
      }</figure>`;
    }
    return `<div class="s-split__grid${p.reverse ? " s-split__grid--reverse" : ""}${side ? "" : " s-split__grid--solo"}">${text}${side}</div>`;
  },
};
