import { attrs, each, esc } from "../html.mjs";

// Alternating image/text rows for a product range, services or menu, each with
// an optional expandable "details" panel holding paragraphs, key/value tables
// and data tables. Nothing here is shop-specific: prices are plain meta text.

function pairs(list) {
  const rows = Array.isArray(list) ? list : Object.entries(list ?? {});
  return `<table class="s-showcase__pairs"><tbody>${each(rows, ([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`)}</tbody></table>`;
}

function dataTable(t, ctx) {
  return `<div class="s-showcase__scroll" role="region" tabindex="0" aria-label="${esc(t.caption ?? "Table")}"><table class="s-showcase__table">${
    t.caption ? `<caption>${ctx.md(t.caption)}</caption>` : ""
  }<thead><tr>${each(t.headers, (h) => `<th scope="col">${ctx.md(String(h))}</th>`)}</tr></thead><tbody>${each(
    t.rows,
    ([first, ...rest]) => `<tr><th scope="row">${ctx.md(String(first))}</th>${each(rest, (c) => `<td>${ctx.md(String(c ?? ""))}</td>`)}</tr>`,
  )}</tbody></table></div>`;
}

function group(g, ctx) {
  return `<div class="s-showcase__group${g.wide ? " s-showcase__group--wide" : ""}">${g.heading ? `<h4>${esc(g.heading)}</h4>` : ""}${
    g.text ? ctx.blocks(g.text) : ""
  }${g.pairs ? pairs(g.pairs) : ""}${g.table ? dataTable(g.table, ctx) : ""}${
    g.bullets?.length ? `<ul class="s-showcase__notes">${each(g.bullets, (b) => `<li>${ctx.md(b)}</li>`)}</ul>` : ""
  }</div>`;
}

export default {
  type: "showcase",
  summary: "Alternating image/text rows (product range, services) with ticks, chips, meta and an expandable details panel of text and tables.",
  fullBleed: false,
  props: {
    items: { type: "array", required: true },
    alternate: { type: "boolean" },
    imageRatio: { type: "string" },
  },
  example: {
    eyebrow: "The range",
    heading: "A row for every product",
    intro: "Rows alternate sides. Expand any row for the full specification.",
    items: [
      {
        id: "sample-puppy",
        eyebrow: "Puppies",
        title: "Puppy formula",
        tagline: "Where the journey begins",
        text: "A complete feed for growing dogs, with everything they need until they move to the adult range.",
        image: "img/product-1.jpg",
        imageAlt: "Puppy formula bag",
        bullets: ["Rich in fresh chicken", "Balanced for growth", "No artificial colours"],
        chips: [{ value: "29%", label: "Protein" }, { value: "18%", label: "Fat" }],
        meta: ["Best for: birth to 8 months", "15 kg bag · guide price £48.00"],
        details: {
          summary: "Full composition & feeding guide",
          text: "Everything on the bag, in one place.",
          groups: [
            { heading: "Composition", text: "Chicken meal, rice, maize, chicken fat, beet pulp.", wide: true },
            { heading: "Analytical constituents", pairs: [["Protein", "29%"], ["Fat", "18%"], ["Fibre", "2.5%"]] },
            { heading: "Additives", text: "Vitamin A, vitamin D3, vitamin E." },
            {
              heading: "Feeding guide",
              wide: true,
              table: { caption: "Grams per day", headers: ["Weight", "2 months", "4 months"], rows: [["5 kg", "140", "180"], ["10 kg", "220", "300"]] },
              bullets: ["Always provide fresh water."],
            },
          ],
        },
        schema: { "@type": "Product", brand: { "@type": "Brand", name: "Example Farm" } },
      },
      {
        id: "sample-adult",
        eyebrow: "Adults",
        title: "Working adult",
        text: "For dogs in regular work.",
        image: "img/product-2.jpg",
        imageAlt: "Working adult bag",
        meta: ["15 kg bag · guide price £30.00"],
      },
    ],
  },
  render(p, ctx) {
    const alternate = p.alternate !== false;
    const ratio = /^\d+\s*\/\s*\d+$/.test(p.imageRatio ?? "") ? p.imageRatio : "4 / 5";
    const rows = p.items
      .map((item, i) => {
        if (item.schema) {
          ctx.addJsonLd({
            name: item.title,
            description: item.text ? String(Array.isArray(item.text) ? item.text[0] : item.text) : undefined,
            ...(item.image ? { image: ctx.abs(ctx.assetPath(item.image)) } : {}),
            ...(item.id ? { "@id": ctx.abs(`${ctx.page.path}#${item.id}`) } : {}),
            ...item.schema,
          });
        }
        const d = item.details;
        const details = d
          ? `<details class="s-showcase__details"><summary>${esc(d.summary ?? "More details")}</summary><div class="s-showcase__detail">${
              d.text ? `<div class="s-showcase__detail-text">${ctx.blocks(d.text)}</div>` : ""
            }${d.groups?.length ? `<div class="s-showcase__groups">${each(d.groups, (g) => group(g, ctx))}</div>` : ""}</div></details>`
          : "";
        return `<article${attrs({ class: `s-showcase__row${alternate && i % 2 ? " s-showcase__row--flip" : ""}`, id: item.id })}>
${item.image ? `<div class="s-showcase__media" style="--ratio:${ratio}">${ctx.image(item.image, { alt: item.imageAlt ?? "", sizes: "(max-width: 860px) 100vw, 40vw" })}</div>` : ""}
<div class="s-showcase__body">
${item.eyebrow ? `<p class="eyebrow">${esc(item.eyebrow)}</p>` : ""}
<h3>${ctx.md(item.title)}</h3>
${item.tagline ? `<p class="s-showcase__tagline">${ctx.md(item.tagline)}</p>` : ""}
${item.text ? `<div class="s-showcase__text">${ctx.blocks(item.text)}</div>` : ""}
${item.bullets?.length ? `<ul class="s-showcase__ticks">${each(item.bullets, (b) => `<li>${ctx.md(b)}</li>`)}</ul>` : ""}
${item.chips?.length ? `<div class="s-showcase__chips">${each(item.chips, (c) => `<span class="s-showcase__chip"><b>${esc(c.value)}</b> ${esc(c.label)}</span>`)}</div>` : ""}
${item.meta?.length ? `<p class="s-showcase__meta">${each(item.meta, (m) => `<span>${ctx.md(m)}</span>`)}</p>` : ""}
${details}
</div>
</article>`;
      })
      .join("\n");
    return `${ctx.sectionHead(p)}<div class="s-showcase__list">${rows}</div>`;
  },
};
