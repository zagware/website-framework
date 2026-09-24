import { attrs } from "../html.mjs";

export default {
  type: "cart",
  summary: "Basket page: the cart client script renders lines, quantities, delivery choice, totals and Stripe checkout; no-JS fallback message.",
  fullBleed: false,
  props: {
    emptyText: { type: "string" },
    continueHref: { type: "string" },
    continueLabel: { type: "string" },
    note: { type: "string" },
  },
  example: {
    heading: "Your basket",
    continueHref: "/shop/",
    note: "Secure payment by Stripe. We deliver to the UK and Ireland.",
  },
  render(p, ctx) {
    const head = ctx.sectionHead(p);
    if (!ctx.commerce) return `${head}<p class="muted">Online ordering isn't enabled on this site.</p>`;
    ctx.useScript("cart");
    // The client script owns everything inside the root; strings ride on data-*.
    const root = attrs({
      class: "s-cart__root",
      "data-cart-root": true,
      "data-continue-href": ctx.url(p.continueHref ?? "/"),
      "data-continue-label": p.continueLabel ?? "Continue shopping",
      "data-empty-text": p.emptyText ?? "Your basket is empty.",
      tabindex: "-1",
    });
    const privacy = ctx.site.compliance?.privacyPath
      ? `<p class="s-cart__note muted">Payment is handled by Stripe; we never see your card details. See our <a href="${ctx.url(ctx.site.compliance.privacyPath)}">privacy notice</a>.</p>`
      : "";
    return `${head}<div${root}>
<noscript><p class="s-cart__fallback">Your basket needs JavaScript. Please enable JavaScript to review your basket and pay securely, or get in touch to order.</p></noscript>
</div>
${p.note ? `<p class="s-cart__note muted">${ctx.md(p.note)}</p>` : ""}${privacy}`;
  },
};
