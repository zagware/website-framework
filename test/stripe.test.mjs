import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, mock, test } from "node:test";
import { catalog, normalizeCommerce } from "../src/commerce.mjs";
import worker from "../worker/index.mjs";
import { chunkMetadata, formEncode, joinMetadata, SignatureError, verifyWebhook } from "../worker/stripe.mjs";

const SECRET = "whsec_test_secret";
const ORIGIN = "https://shop.example";

// Capture Worker logs for the file; the last test asserts nothing sensitive leaks.
const logged = [];
for (const level of ["log", "warn", "error"]) {
  mock.method(console, level, (...args) => logged.push(args.map(String).join(" ")));
}

const COMMERCE = normalizeCommerce(
  {
    provider: "stripe-lite",
    currency: "GBP",
    shipping: { countries: ["GB", "IE"], rates: [{ id: "standard", label: "Standard delivery", amount: 395, freeOver: 5000 }] },
    products: [
      { id: "tee", name: "Tee", price: 2000, image: "img/tee.jpg", options: [{ name: "Size", values: ["S", "M"] }, { name: "Colour", values: ["Navy", "Stone"] }] },
      { id: "mug", name: "Mug", price: 1200 },
    ],
  },
  [],
);
const CATALOG = catalog(COMMERCE, {
  assetPath: (src) => `/assets/${src}`,
  abs: (href) => new URL(href.replace(/^\//, ""), `${ORIGIN}/`).href,
});

function assets() {
  const seen = [];
  return {
    seen,
    async fetch(request) {
      const url = new URL(request.url);
      seen.push(url.pathname);
      if (url.pathname === "/_z/catalog.json") return Response.json(CATALOG);
      return new Response(`asset ${url.pathname}`, { status: 200 });
    },
  };
}

function env(overrides = {}) {
  return {
    ASSETS: assets(),
    STRIPE_SECRET_KEY: "sk_test_123",
    STRIPE_WEBHOOK_SECRET: SECRET,
    SITE_URL: ORIGIN,
    ALLOWED_ORIGINS: "https://zagware.github.io, http://localhost:4173",
    ...overrides,
  };
}

/** Mock global fetch (Stripe API); records calls and replies with `reply(url, init)`. */
function mockStripe(t, reply = () => Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" })) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), init, form: init.body ? new URLSearchParams(init.body) : null });
    return reply(String(url), init);
  });
  return calls;
}

const checkoutRequest = (body, headers = {}) =>
  new Request(`${ORIGIN}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });

const TEE = { id: "tee", qty: 2, options: { Size: "M", Colour: "Navy" } };

function sign(payload, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
}

describe("stripe helpers", () => {
  test("formEncode uses Stripe bracket syntax", () => {
    const form = new URLSearchParams(formEncode({ a: 1, line_items: [{ price_data: { unit_amount: 5 } }], skip: null, meta: { k: "v w" } }));
    assert.deepEqual([...form], [
      ["a", "1"],
      ["line_items[0][price_data][unit_amount]", "5"],
      ["meta[k]", "v w"],
    ]);
  });

  test("metadata chunks stay within 500 chars and join back", () => {
    const value = "x".repeat(1234);
    const chunks = chunkMetadata("cart", value);
    assert.deepEqual(Object.keys(chunks), ["cart", "cart_2", "cart_3"]);
    assert.ok(Object.values(chunks).every((v) => v.length <= 500));
    assert.equal(joinMetadata(chunks, "cart"), value);
    assert.deepEqual(chunkMetadata("cart", "short"), { cart: "short" });
  });
});

describe("verifyWebhook", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "ping" });

  test("accepts a valid signature (including alongside a rotated one)", async () => {
    assert.equal((await verifyWebhook(payload, sign(payload), SECRET)).id, "evt_1");
    const t = Math.floor(Date.now() / 1000);
    const rotated = `t=${t},v1=${"0".repeat(64)},${sign(payload, SECRET, t).split(",")[1]}`;
    assert.equal((await verifyWebhook(payload, rotated, SECRET)).id, "evt_1");
  });

  test("rejects a wrong secret or tampered payload", async () => {
    await assert.rejects(verifyWebhook(payload, sign(payload, "whsec_other"), SECRET), SignatureError);
    await assert.rejects(verifyWebhook(payload.replace("ping", "pong"), sign(payload), SECRET), SignatureError);
  });

  test("rejects timestamps outside the 5 minute tolerance", async () => {
    const now = Math.floor(Date.now() / 1000);
    await assert.rejects(verifyWebhook(payload, sign(payload, SECRET, now - 301), SECRET, { now }), /tolerance/);
    await assert.rejects(verifyWebhook(payload, sign(payload, SECRET, now + 301), SECRET, { now }), /tolerance/);
    assert.ok(await verifyWebhook(payload, sign(payload, SECRET, now - 299), SECRET, { now }));
  });

  test("rejects missing or malformed headers", async () => {
    await assert.rejects(verifyWebhook(payload, null, SECRET), /Missing/);
    await assert.rejects(verifyWebhook(payload, "v1=abc", SECRET), /Malformed/);
    await assert.rejects(verifyWebhook(payload, `t=${Math.floor(Date.now() / 1000)}`, SECRET), /Malformed/);
  });
});

describe("worker routing", () => {
  test("non-/api paths fall through to the ASSETS binding", async () => {
    const e = env();
    const res = await worker.fetch(new Request(`${ORIGIN}/shop/`), e);
    assert.equal(await res.text(), "asset /shop/");
    assert.deepEqual(e.ASSETS.seen, ["/shop/"]);
    assert.equal((await worker.fetch(new Request(`${ORIGIN}/shop/`), env({ ASSETS: undefined }))).status, 404);
  });

  test("health reports configuration without secrets", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/health`), env({ DB: undefined }));
    const body = await res.json();
    assert.deepEqual(body, { ok: true, checkout: true, mode: "test", webhook: true, orders: false, contact: false });
    assert.doesNotMatch(JSON.stringify(body), /sk_test|whsec/);
  });

  test("unknown /api routes and wrong methods are rejected", async () => {
    assert.equal((await worker.fetch(new Request(`${ORIGIN}/api/nope`), env())).status, 404);
    assert.equal((await worker.fetch(new Request(`${ORIGIN}/api/checkout`), env())).status, 405);
  });
});

describe("CORS", () => {
  const preflight = (origin) =>
    new Request(`${ORIGIN}/api/checkout`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    });

  test("allows listed origins and same origin", async () => {
    for (const origin of ["https://zagware.github.io", ORIGIN]) {
      const res = await worker.fetch(preflight(origin), env());
      assert.equal(res.status, 204);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
      assert.match(res.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
    }
  });

  test("rejects unknown origins on preflight and on POST without calling Stripe", async (t) => {
    const calls = mockStripe(t);
    const pre = await worker.fetch(preflight("https://evil.example"), env());
    assert.equal(pre.status, 403);
    assert.equal(pre.headers.get("Access-Control-Allow-Origin"), null);
    const res = await worker.fetch(checkoutRequest({ items: [TEE] }, { Origin: "https://evil.example" }), env());
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0);
  });
});

describe("POST /api/checkout", () => {
  test("creates a Stripe Checkout Session priced from the catalog", async (t) => {
    const calls = mockStripe(t);
    const res = await worker.fetch(
      checkoutRequest({ items: [{ ...TEE, qty: 1, price: 1, unitPrice: 1 }, { id: "mug", qty: 1, price: 0 }], shippingRate: "standard" }),
      env(),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { url: "https://checkout.stripe.com/c/pay/cs_test_1" });

    assert.equal(calls.length, 1);
    const [{ url, init, form }] = calls;
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer sk_test_123");
    assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.match(init.headers["Idempotency-Key"], /^zsite_/);
    assert.deepEqual(Object.fromEntries(form), {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "gbp",
      "line_items[0][price_data][unit_amount]": "2000",
      "line_items[0][price_data][product_data][name]": "Tee (M / Navy)",
      "line_items[0][price_data][product_data][metadata][product_id]": "tee",
      "line_items[0][price_data][product_data][metadata][options]": '{"Size":"M","Colour":"Navy"}',
      "line_items[0][price_data][product_data][images][0]": `${ORIGIN}/assets/img/tee.jpg`,
      "line_items[1][quantity]": "1",
      "line_items[1][price_data][currency]": "gbp",
      "line_items[1][price_data][unit_amount]": "1200",
      "line_items[1][price_data][product_data][name]": "Mug",
      "line_items[1][price_data][product_data][metadata][product_id]": "mug",
      success_url: `${ORIGIN}/shop/success/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${ORIGIN}/shop/cart/`,
      "metadata[cart]": "tee:1:1.0,mug:1",
      "metadata[shipping_rate]": "standard",
      "shipping_address_collection[allowed_countries][0]": "GB",
      "shipping_address_collection[allowed_countries][1]": "IE",
      "shipping_options[0][shipping_rate_data][type]": "fixed_amount",
      "shipping_options[0][shipping_rate_data][display_name]": "Standard delivery",
      "shipping_options[0][shipping_rate_data][fixed_amount][amount]": "395",
      "shipping_options[0][shipping_rate_data][fixed_amount][currency]": "gbp",
    });
  });

  test("returns to an allowed returnBase (e.g. a GitHub Pages preview subpath)", async (t) => {
    const calls = mockStripe(t);
    const body = { items: [TEE], returnBase: "https://zagware.github.io/acme-poc/?x=1#top" };
    const res = await worker.fetch(checkoutRequest(body, { Origin: "https://zagware.github.io" }), env());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://zagware.github.io");
    assert.equal(calls[0].form.get("success_url"), "https://zagware.github.io/acme-poc/shop/success/?session_id={CHECKOUT_SESSION_ID}");
    assert.equal(calls[0].form.get("cancel_url"), "https://zagware.github.io/acme-poc/shop/cart/");
  });

  test("falls back to SITE_URL when returnBase is not allowed", async (t) => {
    const calls = mockStripe(t);
    for (const returnBase of ["https://evil.example/", "http://zagware.github.io/acme-poc/", "javascript:alert(1)", 42]) {
      const res = await worker.fetch(checkoutRequest({ items: [TEE], returnBase }), env());
      assert.equal(res.status, 200);
    }
    assert.equal(calls.length, 4);
    for (const call of calls) {
      assert.equal(call.form.get("success_url"), `${ORIGIN}/shop/success/?session_id={CHECKOUT_SESSION_ID}`);
      assert.equal(call.form.get("cancel_url"), `${ORIGIN}/shop/cart/`);
    }
  });

  test("rejects invalid carts with 400 and never calls Stripe", async (t) => {
    const calls = mockStripe(t);
    const cases = [
      { items: [] },
      { items: [{ id: "nope", qty: 1 }] },
      { items: [{ ...TEE, options: { Size: "XXL", Colour: "Navy" } }] },
      { items: [{ id: "mug", qty: 100 }] },
      { items: [{ id: "mug", qty: 1 }], shippingRate: "free-for-me" },
    ];
    for (const body of cases) {
      const res = await worker.fetch(checkoutRequest(body), env());
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(typeof (await res.json()).error, "string");
    }
    const notJson = new Request(`${ORIGIN}/api/checkout`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
    assert.equal((await worker.fetch(notJson, env())).status, 415);
    assert.equal(calls.length, 0);
  });

  test("reads the catalog from CATALOG_URL when set", async (t) => {
    const calls = mockStripe(t, (url) =>
      url === "https://zagware.github.io/acme-poc/_z/catalog.json"
        ? Response.json(CATALOG)
        : Response.json({ id: "cs_test_2", url: "https://checkout.stripe.com/c/pay/cs_test_2" }),
    );
    const res = await worker.fetch(
      checkoutRequest({ items: [{ id: "mug", qty: 1 }] }),
      env({ ASSETS: undefined, CATALOG_URL: "https://zagware.github.io/acme-poc/_z/catalog.json" }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(calls.map((c) => c.url), ["https://zagware.github.io/acme-poc/_z/catalog.json", "https://api.stripe.com/v1/checkout/sessions"]);
  });

  test("client idempotency keys are stable per cart and change with it", async (t) => {
    const calls = mockStripe(t);
    const headers = { "Idempotency-Key": "attempt-1234" };
    await worker.fetch(checkoutRequest({ items: [TEE] }, headers), env());
    await worker.fetch(checkoutRequest({ items: [TEE] }, headers), env());
    await worker.fetch(checkoutRequest({ items: [{ ...TEE, qty: 3 }] }, headers), env());
    const keys = calls.map((c) => c.init.headers["Idempotency-Key"]);
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[0], keys[2]);
  });

  test("maps Stripe failures to 502 and missing configuration to 503", async (t) => {
    mockStripe(t, () => Response.json({ error: { type: "invalid_request_error", message: "bad" } }, { status: 400 }));
    const failed = await worker.fetch(checkoutRequest({ items: [TEE] }), env());
    assert.equal(failed.status, 502);
    assert.doesNotMatch(JSON.stringify(await failed.json()), /bad|sk_test/);
    assert.equal((await worker.fetch(checkoutRequest({ items: [TEE] }), env({ STRIPE_SECRET_KEY: undefined }))).status, 503);
  });
});

/** Minimal D1 stand-in honouring INSERT OR IGNORE on the unique session id. */
function fakeD1() {
  const rows = new Map();
  const statements = [];
  return {
    rows,
    statements,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              statements.push({ sql, args });
              if (/^\s*INSERT OR IGNORE INTO orders/.test(sql)) {
                if (!rows.has(args[0])) {
                  const cols = ["stripe_session_id", "payment_intent", "email", "name", "amount_total", "currency", "status", "shipping_json", "items_json", "created_at"];
                  rows.set(args[0], Object.fromEntries(cols.map((c, i) => [c, args[i]])));
                }
              } else if (/^UPDATE orders SET status/.test(sql)) {
                if (rows.has(args[0])) rows.get(args[0]).status = args[1];
              } else {
                throw new Error(`unexpected SQL ${sql}`);
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

const SESSION = {
  id: "cs_test_42",
  object: "checkout.session",
  payment_status: "paid",
  payment_intent: "pi_42",
  amount_total: 4395,
  currency: "gbp",
  created: 1_760_000_000,
  customer_details: { email: "buyer@example.com", name: "Billing Name", phone: null },
  collected_information: { shipping_details: { name: "Ship Name", address: { line1: "1 High St", city: "Leeds", postal_code: "LS1 1AA", country: "GB" } } },
  shipping_cost: { amount_total: 395 },
  metadata: { cart: "tee:2:1.0", shipping_rate: "standard" },
};

const webhookRequest = (event, signature) => {
  const payload = JSON.stringify(event);
  return new Request(`${ORIGIN}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature ?? sign(payload) },
    body: payload,
  });
};

describe("POST /api/stripe/webhook", () => {
  const completed = { id: "evt_1", type: "checkout.session.completed", data: { object: SESSION } };

  test("records a completed checkout once, with Stripe line items", async (t) => {
    const calls = mockStripe(t, () =>
      Response.json({
        data: [
          {
            description: "Tee (M / Navy)",
            quantity: 2,
            amount_total: 4000,
            price: { unit_amount: 2000, product: { metadata: { product_id: "tee", options: '{"Size":"M","Colour":"Navy"}' } } },
          },
        ],
      }),
    );
    const DB = fakeD1();
    const first = await worker.fetch(webhookRequest(completed), env({ DB }));
    assert.equal(first.status, 200);
    const again = await worker.fetch(webhookRequest(completed), env({ DB }));
    assert.equal(again.status, 200);

    assert.equal(DB.rows.size, 1);
    const row = DB.rows.get("cs_test_42");
    assert.equal(row.status, "paid");
    assert.equal(row.email, "buyer@example.com");
    assert.equal(row.name, "Ship Name");
    assert.equal(row.amount_total, 4395);
    assert.equal(row.currency, "GBP");
    assert.equal(row.payment_intent, "pi_42");
    assert.equal(row.created_at, new Date(1_760_000_000_000).toISOString());
    assert.equal(JSON.parse(row.shipping_json).address.postal_code, "LS1 1AA");
    assert.deepEqual(JSON.parse(row.items_json), [
      { id: "tee", name: "Tee (M / Navy)", qty: 2, options: { Size: "M", Colour: "Navy" }, unit_amount: 2000, amount_total: 4000 },
    ]);
    assert.match(calls[0].url, /\/v1\/checkout\/sessions\/cs_test_42\/line_items\?limit=100&expand/);
  });

  test("falls back to the metadata cart reference when line items are unavailable", async (t) => {
    mockStripe(t, () => Response.json({ error: { message: "down" } }, { status: 500 }));
    const DB = fakeD1();
    assert.equal((await worker.fetch(webhookRequest(completed), env({ DB }))).status, 200);
    assert.deepEqual(JSON.parse(DB.rows.get("cs_test_42").items_json), [
      { id: "tee", name: "Tee", qty: 2, options: { Size: "M", Colour: "Navy" }, unit_amount: 2000, amount_total: null },
    ]);
  });

  test("async payment outcomes update the order status", async () => {
    const DB = fakeD1();
    const e = env({ DB, STRIPE_SECRET_KEY: undefined });
    await worker.fetch(webhookRequest({ ...completed, data: { object: { ...SESSION, payment_status: "unpaid" } } }), e);
    assert.equal(DB.rows.get("cs_test_42").status, "pending");
    await worker.fetch(webhookRequest({ id: "evt_2", type: "checkout.session.async_payment_succeeded", data: { object: SESSION } }), e);
    assert.equal(DB.rows.get("cs_test_42").status, "paid");
  });

  test("rejects bad signatures with 400 and stores nothing", async () => {
    const DB = fakeD1();
    const res = await worker.fetch(webhookRequest(completed, sign("{}", "whsec_wrong")), env({ DB }));
    assert.equal(res.status, 400);
    const stale = await worker.fetch(webhookRequest(completed, sign(JSON.stringify(completed), SECRET, 1_000_000)), env({ DB }));
    assert.equal(stale.status, 400);
    assert.equal(DB.statements.length, 0);
  });

  test("acknowledges ignored events and works without a DB binding", async () => {
    const DB = fakeD1();
    const ignored = await worker.fetch(webhookRequest({ id: "evt_3", type: "payment_intent.created", data: { object: {} } }), env({ DB }));
    assert.equal(ignored.status, 200);
    assert.equal(DB.statements.length, 0);
    const noDb = await worker.fetch(webhookRequest(completed), env({ DB: undefined, STRIPE_SECRET_KEY: undefined }));
    assert.equal(noDb.status, 200);
  });
});

// The migration and the Worker's SQL against real SQLite (node:sqlite, Node >= 22.13).
const sqlite = await import("node:sqlite").catch(() => null);
test("migration accepts the webhook's INSERT OR IGNORE and UPDATE", { skip: !sqlite && "node:sqlite unavailable" }, async () => {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(await readFile(new URL("../worker/migrations/0001_orders.sql", import.meta.url), "utf8"));
  const DB = {
    prepare: (sql) => ({ bind: (...args) => ({ run: async () => db.prepare(sql).run(...args) }) }),
  };
  const e = env({ DB, STRIPE_SECRET_KEY: undefined });
  const completed = { id: "evt_1", type: "checkout.session.completed", data: { object: { ...SESSION, payment_status: "unpaid" } } };
  assert.equal((await worker.fetch(webhookRequest(completed), e)).status, 200);
  assert.equal((await worker.fetch(webhookRequest(completed), e)).status, 200);
  await worker.fetch(webhookRequest({ id: "evt_2", type: "checkout.session.async_payment_failed", data: { object: SESSION } }), e);
  const rows = db.prepare("SELECT stripe_session_id, status, amount_total, currency FROM orders").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ stripe_session_id: "cs_test_42", status: "failed", amount_total: 4395, currency: "GBP" }]);
});

test("logs never contain secrets or customer details", () => {
  assert.ok(logged.length > 0);
  const text = logged.join("\n");
  for (const secret of ["sk_test_123", SECRET, "buyer@example.com", "Ship Name", "High St", "LS1 1AA"]) {
    assert.ok(!text.includes(secret), `log leaked ${secret}`);
  }
});
