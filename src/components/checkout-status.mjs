import { esc } from "../html.mjs";

const DEFAULTS = {
  success: {
    icon: "check",
    heading: "Thank you — your order is confirmed",
    body: "We've emailed your receipt. We'll be in touch when your order is on its way.",
  },
  cancelled: {
    icon: "info",
    heading: "Checkout cancelled",
    body: "No payment was taken. Your basket has been kept, so you can pick up where you left off.",
  },
};

export default {
  type: "checkout-status",
  summary: "Stripe return page (success or cancelled) with icon, heading (h1) and next steps; success empties the basket.",
  fullBleed: false,
  props: {
    status: { type: "string", required: true },
    heading: { type: "string" },
    body: { type: "string" },
    actions: { type: "array" },
  },
  example: {
    status: "success",
    heading: "Thanks — order received",
    body: "Your receipt is on its way by email.",
    actions: [{ label: "Back to the shop", href: "/shop/" }],
  },
  render(p, ctx) {
    const commerce = ctx.commerce;
    if (!DEFAULTS[p.status]) {
      throw new Error(`checkout-status: status must be "success" or "cancelled" (got ${JSON.stringify(p.status)})`);
    }
    const kind = p.status;
    const d = DEFAULTS[kind];
    // Success clears the basket (client checks for Stripe's ?session_id= first).
    if (kind === "success" && commerce) ctx.useScript("cart");
    const actions =
      p.actions ??
      (kind === "cancelled" && commerce
        ? [{ label: "Return to your basket", href: commerce.cartPath }, { label: "Continue shopping", href: "/", style: "outline" }]
        : [{ label: "Back to the home page", href: "/" }]);
    const buttons = actions
      .map(
        (a, i) =>
          `<a class="btn ${a.style === "outline" || (i > 0 && !a.style) ? "btn--outline" : "btn--primary"}" href="${esc(ctx.url(a.href))}">${esc(a.label)}</a>`,
      )
      .join("");
    return `<div class="s-checkout-status s-checkout-status--${kind}"${kind === "success" ? " data-cart-clear" : ""}>
<span class="s-checkout-status__icon">${ctx.icon(d.icon)}</span>
<h1>${ctx.md(p.heading ?? d.heading)}</h1>
<div class="s-checkout-status__body">${ctx.blocks(p.body ?? d.body)}</div>
${buttons ? `<div class="btn-row s-checkout-status__actions">${buttons}</div>` : ""}
</div>`;
  },
};
