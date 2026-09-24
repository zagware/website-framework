import { esc } from "../html.mjs";

// Plain text for JSON-LD: strip the inline markup subset.
const plain = (text) =>
  String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`]/g, "");

export default {
  type: "faq",
  summary: "Accordion of questions (native <details>, no JS), optionally grouped; emits FAQPage JSON-LD from the same data.",
  fullBleed: false,
  props: {
    items: { type: "array" },
    groups: { type: "array" },
    jsonLd: { type: "boolean" },
    footnote: { type: "string" },
  },
  example: {
    eyebrow: "Good to know",
    heading: "Frequently asked questions",
    groups: [
      {
        title: "Getting started",
        icon: "info",
        items: [
          { q: "How long does a preview take?", a: "Usually a day or two. Previews go live on GitHub Pages with a **noindex** banner." },
          { q: "Can I use my own domain?", a: "Yes — once you're happy we move the site to Cloudflare on your domain." },
        ],
      },
      {
        title: "Shop",
        icon: "cart",
        items: [
          { q: "Which payment methods are supported?", a: "Cards, Apple Pay and Google Pay via Stripe Checkout." },
          { q: "When does shipping start?", a: "", tbd: true },
        ],
      },
    ],
    footnote: "Still stuck? [Email us](mailto:hello@example.com).",
  },
  render(p, ctx) {
    const groups = p.groups ?? [{ items: p.items ?? [] }];
    const all = groups.flatMap((g) => g.items ?? []);
    if (p.jsonLd !== false) {
      const answered = all.filter((i) => !i.tbd && i.a);
      if (answered.length) {
        ctx.addJsonLd({
          "@type": "FAQPage",
          "@id": ctx.abs(`${ctx.page.path}#faq`),
          mainEntity: answered.map((i) => ({
            "@type": "Question",
            name: plain(i.q),
            acceptedAnswer: { "@type": "Answer", text: plain(i.a) },
          })),
        });
      }
    }
    const body = groups
      .map((g) => {
        const head = g.title
          ? `<header class="s-faq__group-head">${g.icon ? ctx.icon(g.icon) : ""}<h3>${esc(g.title)}</h3><span class="muted">${g.items.length} question${g.items.length === 1 ? "" : "s"}</span></header>`
          : "";
        const items = g.items
          .map(
            (i) => `<details class="s-faq__item">
<summary>${ctx.md(i.q)}${i.tbd ? ' <span class="chip">TBC</span>' : ""}</summary>
<div class="s-faq__answer">${i.tbd && !i.a ? "<p>We'll confirm this soon.</p>" : ctx.blocks(i.a)}</div>
</details>`,
          )
          .join("\n");
        return `<div class="s-faq__group">${head}${items}</div>`;
      })
      .join("\n");
    return `${ctx.sectionHead(p)}<div class="s-faq__groups">${body}</div>${p.footnote ? `<p class="s-faq__footnote muted">${ctx.md(p.footnote)}</p>` : ""}`;
  },
};
