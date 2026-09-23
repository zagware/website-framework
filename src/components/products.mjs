import { esc, money } from "../html.mjs";

// Plain text for JSON-LD: strip the inline markup subset.
const plain = (text) =>
  (Array.isArray(text) ? text.join(" ") : String(text))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/^- /gm, "")
    .replace(/\s+/g, " ")
    .trim();

/** Products to show: commerce catalog (or `products` prop for price lists), filtered by `ids` then `tag`. */
function selectProducts(p, ctx) {
  const all = ctx.commerce?.products ?? (p.products ?? []).filter((x) => x?.name && Number.isInteger(x.price));
  let list = all;
  if (p.ids?.length) {
    const byId = new Map(all.map((x) => [x.id, x]));
    list = p.ids.map((id) => {
      if (!byId.has(id)) throw new Error(`products: unknown product id "${id}" in ids (page ${ctx.page.path})`);
      return byId.get(id);
    });
  }
  return p.tag ? list.filter((x) => x.tags?.includes(p.tag)) : list;
}

export default {
  type: "products",
  summary: "Product grid with prices, option selectors and Add to basket (stripe-lite commerce); price list only when commerce is off. Emits Product JSON-LD.",
  fullBleed: false,
  props: {
    ids: { type: "array" },
    tag: { type: "string" },
    columns: { type: "number" },
    addLabel: { type: "string" },
    products: { type: "array" },
    currency: { type: "string" },
    jsonLd: { type: "boolean" },
  },
  example: {
    eyebrow: "Shop",
    heading: "Featured products",
    intro: "Prices come from the site's commerce catalog; the Worker re-prices every checkout.",
    // Used only when the site has no `commerce` block (price-list mode).
    products: [
      { id: "tee", name: "Club T-shirt", description: "Organic cotton, printed in the UK.", price: 2499, image: "img/product-1.jpg" },
      { id: "mug", name: "Enamel mug", description: "Camp mug with a rolled rim.", price: 1200, image: "img/product-2.jpg" },
      { id: "poster", name: "A2 route poster", description: "Giclée print of the route map.", price: 3000, image: "img/product-3.jpg" },
    ],
  },
  render(p, ctx) {
    const commerce = ctx.commerce;
    const currency = commerce?.currency ?? p.currency ?? "GBP";
    const locale = commerce?.locale ?? ctx.site.lang ?? "en-GB";
    const products = selectProducts(p, ctx);
    const head = ctx.sectionHead(p);
    if (!products.length) return `${head}<p class="muted">No products to show right now.</p>`;
    if (commerce) ctx.useScript("cart");

    const cols = p.columns ? ` style="--min:${Math.round(1100 / p.columns) - 40}px"` : "";
    const addLabel = p.addLabel ?? "Add to basket";
    const cards = products
      .map((x) => {
        const anchor = `product-${x.id}`;
        if (p.jsonLd !== false) {
          const pageUrl = ctx.abs(`${ctx.page.path}#${anchor}`);
          ctx.addJsonLd({
            "@type": "Product",
            "@id": pageUrl,
            name: x.name,
            description: x.description ? plain(x.description) : undefined,
            image: x.image ? ctx.abs(ctx.assetPath(x.image)) : undefined,
            sku: x.sku ?? undefined,
            offers: {
              "@type": "Offer",
              price: (x.price / 100).toFixed(2),
              priceCurrency: currency,
              availability: "https://schema.org/InStock",
              url: pageUrl,
            },
          });
        }
        const fields = commerce
          ? (x.options ?? [])
              .map((o) => {
                const id = ctx.uid("opt");
                return `<div class="s-products__field"><label for="${id}">${esc(o.name)}</label><select id="${id}" data-option="${esc(o.name)}">${o.values
                  .map((v) => `<option>${esc(v)}</option>`)
                  .join("")}</select></div>`;
              })
              .join("")
          : "";
        const qtyId = ctx.uid("qty");
        const form = commerce
          ? `<form class="s-products__form" action="${esc(ctx.url(commerce.cartPath))}" method="get">
${fields}<div class="s-products__field s-products__field--qty"><label for="${qtyId}">Quantity</label><input id="${qtyId}" type="number" inputmode="numeric" min="1" max="99" step="1" value="1" required data-qty></div>
<button type="submit" class="btn btn--primary s-products__add" data-add-to-cart data-product-id="${esc(x.id)}">${ctx.icon("cart")}<span>${esc(addLabel)}<span class="visually-hidden">: ${esc(x.name)}</span></span></button>
<p class="s-products__status" role="status" data-cart-status></p>
</form>`
          : "";
        return `<article class="card s-products__item" id="${esc(anchor)}">
${x.image ? `<div class="s-products__media">${ctx.image(x.image, { alt: x.name, sizes: "(max-width: 760px) 100vw, 33vw" })}</div>` : ""}
<h3 class="s-products__name">${esc(x.name)}</h3>
<p class="s-products__price">${esc(money(x.price, currency, locale))}</p>
${x.description ? `<div class="s-products__desc">${ctx.blocks(x.description)}</div>` : ""}
${form}
</article>`;
      })
      .join("\n");
    return `${head}<div class="grid s-products__grid"${cols}>${cards}</div>`;
  },
};
