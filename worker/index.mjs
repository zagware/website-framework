// Zagware site Worker: serves the static site through the ASSETS binding and
// adds a tiny API for shops ("stripe-lite") and contact forms.
//
//   GET  /api/health          → config status (no secrets)
//   POST /api/checkout        → { url } of a Stripe hosted Checkout Session
//   POST /api/stripe/webhook  → records paid orders in D1 (binding DB, optional)
//   POST /api/contact         → stores/emails contact form posts (see contact.mjs)
//
// Prices are always recomputed from the published catalog (/_z/catalog.json or
// env.CATALOG_URL); client-sent prices are never read.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// Vars:    SITE_URL (redirect base; defaults to the request origin),
//          ALLOWED_ORIGINS (comma list of extra origins allowed to call /api),
//          CATALOG_URL (catalog location when the site is hosted elsewhere).

import { CartError, decodeCartRef, encodeCartRef, optionLabel, priceCart } from "../src/commerce.mjs";
import {
  SignatureError,
  StripeError,
  chunkMetadata,
  createCheckoutSession,
  joinMetadata,
  listLineItems,
  METADATA_VALUE_LIMIT,
  sha256Hex,
  verifyWebhook,
} from "./stripe.mjs";
import { contact } from "./contact.mjs";

const CATALOG_PATH = "/_z/catalog.json";
const MAX_BODY_BYTES = 32 * 1024;
const LOG = "zsite-commerce:";

class CatalogError extends Error {}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }
    try {
      return await api(request, env, url);
    } catch (error) {
      console.error(LOG, "unhandled error", error?.name, error?.message);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  },
};

async function api(request, env, url) {
  // Stripe calls the webhook server-to-server: no CORS.
  if (url.pathname === "/api/stripe/webhook") {
    return request.method === "POST" ? webhook(request, env, url) : methodNotAllowed("POST");
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin && !allowedOrigins(env).includes(origin)) {
    return json({ error: "Origin not allowed" }, 403, { Vary: "Origin" });
  }
  const cors = origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  switch (url.pathname) {
    case "/api/health":
      return request.method === "GET" || request.method === "HEAD" ? health(env, cors) : methodNotAllowed("GET", cors);
    case "/api/checkout":
      return request.method === "POST" ? checkout(request, env, url, cors) : methodNotAllowed("POST", cors);
    case "/api/contact":
      return request.method === "POST"
        ? contact(request, env, url, { cors, allowed: allowedOrigins(env), json })
        : methodNotAllowed("POST", cors);
    default:
      return json({ error: "Not found" }, 404, cors);
  }
}

const methodNotAllowed = (allow, headers = {}) => json({ error: "Method not allowed" }, 405, { ...headers, Allow: allow });

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function health(env, headers) {
  const key = env.STRIPE_SECRET_KEY ?? "";
  return json(
    {
      ok: true,
      checkout: Boolean(key),
      mode: key ? (/^(sk|rk)_live_/.test(key) ? "live" : "test") : null,
      webhook: Boolean(env.STRIPE_WEBHOOK_SECRET),
      orders: Boolean(env.DB),
      contact: Boolean(env.DB || (env.CONTACT_EMAIL && env.CONTACT_TO && env.CONTACT_FROM)),
    },
    200,
    headers,
  );
}

async function loadCatalog(env, url) {
  let res;
  if (env.CATALOG_URL) res = await fetch(env.CATALOG_URL, { headers: { Accept: "application/json" } });
  else if (env.ASSETS) res = await env.ASSETS.fetch(new Request(new URL(CATALOG_PATH, url.origin)));
  else throw new CatalogError("no catalog source (set CATALOG_URL or bind ASSETS)");
  if (!res.ok) throw new CatalogError(`catalog request failed with ${res.status}`);
  const cat = await res.json().catch(() => null);
  if (!isObject(cat) || !Array.isArray(cat.products) || typeof cat.currency !== "string") {
    throw new CatalogError("catalog is malformed");
  }
  return cat;
}

/**
 * Absolute base URL (ending in "/") Stripe returns customers to. The client's
 * `returnBase` wins when it is https (or http://localhost) and its origin is this
 * Worker's or listed in ALLOWED_ORIGINS — e.g. a GitHub Pages preview under a
 * subpath. Anything else falls back to SITE_URL, then the request origin.
 */
function returnBase(raw, env, url) {
  if (typeof raw === "string" && raw.length <= 2048) {
    let u = null;
    try {
      u = new URL(raw);
    } catch {}
    const secure = u?.protocol === "https:" || (u?.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname));
    if (secure && !u.username && !u.password && (u.origin === url.origin || allowedOrigins(env).includes(u.origin))) {
      return `${u.origin}${u.pathname.replace(/\/*$/, "/")}`;
    }
  }
  return `${String(env.SITE_URL || url.origin).replace(/\/+$/, "")}/`;
}

/** Stripe Checkout Session parameters for a priced cart. `base` ends in "/". */
function sessionParams(priced, cat, { base, cartRef }) {
  const currency = priced.currency.toLowerCase();
  const withQuery = (path, query) =>
    `${base}${path.replace(/^\/+/, "")}${query ? (path.includes("?") ? "&" : "?") + query : ""}`;
  const params = {
    mode: "payment",
    line_items: priced.lines.map((line) => {
      const label = optionLabel(line, cat);
      const options = label ? JSON.stringify(line.options) : "";
      const product_data = {
        name: (label ? `${line.name} (${label})` : line.name).slice(0, 250),
        metadata: { product_id: line.id, ...(options && options.length <= METADATA_VALUE_LIMIT ? { options } : {}) },
      };
      if (line.image?.startsWith("https://")) product_data.images = [line.image];
      return { quantity: line.qty, price_data: { currency, unit_amount: line.unitPrice, product_data } };
    }),
    success_url: withQuery(cat.paths?.success ?? "/shop/success/", "session_id={CHECKOUT_SESSION_ID}"),
    cancel_url: withQuery(cat.paths?.cancel ?? "/shop/cart/"),
    metadata: {
      ...chunkMetadata("cart", cartRef),
      ...(priced.shippingRate ? { shipping_rate: priced.shippingRate.id } : {}),
    },
  };
  if (priced.lines.some((l) => l.shippable)) {
    params.shipping_address_collection = { allowed_countries: cat.shipping?.countries ?? ["GB"] };
    if (priced.shippingRate) {
      params.shipping_options = [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            display_name: priced.shippingRate.label,
            fixed_amount: { amount: priced.shippingRate.amount, currency },
          },
        },
      ];
    }
  }
  return params;
}

async function checkout(request, env, url, headers) {
  if (!env.STRIPE_SECRET_KEY) {
    console.error(LOG, "STRIPE_SECRET_KEY is not set");
    return json({ error: "Checkout isn't available yet. Please contact us to order." }, 503, headers);
  }
  // JSON-only also stops cross-site HTML form posts (they cannot send application/json).
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "Send the cart as JSON." }, 415, headers);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json({ error: "Cart is too large." }, 413, headers);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Cart data is not valid JSON." }, 400, headers);
  }
  if (!isObject(body)) return json({ error: "Cart data is malformed." }, 400, headers);

  let cat;
  try {
    cat = await loadCatalog(env, url);
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    console.error(LOG, error.message);
    return json({ error: "Checkout is temporarily unavailable. Please try again shortly." }, 503, headers);
  }

  let priced;
  try {
    priced = priceCart(cat, body.items, body.shippingRate);
  } catch (error) {
    if (!(error instanceof CartError)) throw error;
    return json({ error: error.message, code: error.code }, 400, headers);
  }

  const base = returnBase(body.returnBase, env, url);
  const params = sessionParams(priced, cat, { base, cartRef: encodeCartRef(priced.lines, cat) });
  // A client retry with the same key and cart returns the same session; any
  // change to the cart yields a new key, so Stripe never sees a mismatch.
  const clientKey = request.headers.get("Idempotency-Key");
  const idempotencyKey =
    clientKey && /^[\w-]{8,100}$/.test(clientKey)
      ? `zsite_${(await sha256Hex(`${clientKey}\n${JSON.stringify(params)}`)).slice(0, 48)}`
      : `zsite_${crypto.randomUUID()}`;

  try {
    const session = await createCheckoutSession(env.STRIPE_SECRET_KEY, params, { idempotencyKey });
    if (typeof session?.url !== "string") throw new StripeError("Stripe returned no checkout URL");
    return json({ url: session.url }, 200, headers);
  } catch (error) {
    if (!(error instanceof StripeError)) throw error;
    console.error(LOG, "checkout session failed", error.status, error.type, error.code, error.param);
    return json({ error: "We couldn't start checkout. Please try again shortly." }, 502, headers);
  }
}

const EVENT_STATUS = {
  "checkout.session.completed": (s) => (s.payment_status === "unpaid" ? "pending" : "paid"),
  "checkout.session.async_payment_succeeded": () => "paid",
  "checkout.session.async_payment_failed": () => "failed",
};

async function webhook(request, env, url) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error(LOG, "STRIPE_WEBHOOK_SECRET is not set");
    return json({ error: "Webhook is not configured" }, 503);
  }
  const payload = await request.text();
  let event;
  try {
    event = await verifyWebhook(payload, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    if (!(error instanceof SignatureError)) throw error;
    return json({ error: error.message }, 400);
  }

  const statusFor = EVENT_STATUS[event?.type];
  const session = event?.data?.object;
  if (!statusFor || !isObject(session) || typeof session.id !== "string") {
    return json({ received: true, ignored: true });
  }
  const status = statusFor(session);
  if (!env.DB) {
    console.log(LOG, event.type, session.id, status, "(no DB binding; order not stored)");
    return json({ received: true });
  }

  const order = await orderRow(session, status, env, url);
  // Stripe retries and may reorder events: the first event inserts, later
  // async outcomes update the status, duplicates change nothing.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO orders
       (stripe_session_id, payment_intent, email, name, amount_total, currency, status, shipping_json, items_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  )
    .bind(
      order.stripe_session_id,
      order.payment_intent,
      order.email,
      order.name,
      order.amount_total,
      order.currency,
      order.status,
      order.shipping_json,
      order.items_json,
      order.created_at,
    )
    .run();
  if (event.type !== "checkout.session.completed") {
    await env.DB.prepare("UPDATE orders SET status = ?2 WHERE stripe_session_id = ?1").bind(session.id, status).run();
  }
  console.log(LOG, event.type, session.id, status);
  return json({ received: true });
}

async function orderRow(session, status, env, url) {
  const details = session.customer_details ?? {};
  const ship = session.collected_information?.shipping_details ?? session.shipping_details ?? null;
  const shipping = ship
    ? {
        name: ship.name ?? null,
        phone: details.phone ?? null,
        address: ship.address ?? null,
        rate: session.metadata?.shipping_rate ?? null,
        amount: session.shipping_cost?.amount_total ?? null,
      }
    : null;
  return {
    stripe_session_id: session.id,
    payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
    email: details.email ?? session.customer_email ?? null,
    name: ship?.name ?? details.name ?? null,
    amount_total: Number.isInteger(session.amount_total) ? session.amount_total : 0,
    currency: String(session.currency ?? "").toUpperCase(),
    status,
    shipping_json: shipping ? JSON.stringify(shipping) : null,
    items_json: JSON.stringify(await orderItems(session, env, url)),
    created_at: new Date(Number.isInteger(session.created) ? session.created * 1000 : Date.now()).toISOString(),
  };
}

/** Order lines: Stripe's line items when reachable (what was charged), else the metadata cart reference. */
async function orderItems(session, env, url) {
  if (env.STRIPE_SECRET_KEY) {
    try {
      const list = await listLineItems(env.STRIPE_SECRET_KEY, session.id);
      return list.data.map((li) => {
        const meta = li.price?.product?.metadata ?? {};
        let options = null;
        try {
          options = meta.options ? JSON.parse(meta.options) : null;
        } catch {}
        return {
          id: meta.product_id ?? null,
          name: li.description ?? null,
          qty: li.quantity,
          options,
          unit_amount: li.price?.unit_amount ?? null,
          amount_total: li.amount_total ?? null,
        };
      });
    } catch (error) {
      if (!(error instanceof StripeError)) throw error;
      console.error(LOG, "line items unavailable", session.id, error.status, error.code);
    }
  }
  const cat = await loadCatalog(env, url).catch(() => null);
  return decodeCartRef(joinMetadata(session.metadata, "cart"), cat).map((i) => ({
    id: i.id,
    name: i.name,
    qty: i.qty,
    options: i.options,
    unit_amount: i.unitPrice,
    amount_total: null,
  }));
}
