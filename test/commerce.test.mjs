import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CartError,
  catalog,
  clientConfig,
  decodeCartRef,
  encodeCartRef,
  normalizeCommerce,
  priceCart,
} from "../src/commerce.mjs";
import { blocks, esc, inline } from "../src/html.mjs";
import products from "../src/components/products.mjs";

const RAW = {
  provider: "stripe-lite",
  currency: "GBP",
  locale: "en-GB",
  mode: "test",
  shipping: {
    countries: ["GB", "ie"],
    rates: [
      { id: "standard", label: "Standard", amount: 395, freeOver: 5000 },
      { id: "express", label: "Express", amount: 895 },
    ],
  },
  products: [
    {
      id: "tee",
      name: "Tee",
      description: "Soft **cotton**.",
      price: 2000,
      image: "img/tee.jpg",
      options: [
        { name: "Size", values: ["S", "M", "L"] },
        { name: "Colour", values: ["Navy", "Stone"] },
      ],
      tags: ["apparel"],
      sku: "TEE-1",
    },
    { id: "mug", name: "Mug", price: 1200, tags: ["home"] },
    { id: "voucher", name: "Gift voucher", price: 2500, shippable: false },
  ],
};

function normalized(overrides = {}) {
  const errors = [];
  const commerce = normalizeCommerce({ ...RAW, ...overrides }, errors);
  assert.deepEqual(errors, []);
  return commerce;
}

function fakeCtx(commerce) {
  let uid = 0;
  const ctx = {
    site: { slug: "acme-shop", name: "Acme Shop", lang: "en-GB" },
    page: { path: "/shop/" },
    commerce,
    jsonLd: [],
    scripts: new Set(),
    url: (href) => (href?.startsWith("/") ? `../${href.slice(1)}` : href),
    assetPath: (src) => (/^https?:\/\//.test(src) ? src : `/assets/${src.replace(/^\/?(assets\/)?/, "")}`),
    abs: (href) => (/^https?:\/\//.test(href) ? href : new URL(href.replace(/^\//, ""), "https://acme.example/").href),
    image: (src, o) => `<img src="${esc(src)}" alt="${esc(o.alt)}">`,
    md: (text) => inline(text),
    blocks: (value) => blocks(value),
    icon: () => "",
    sectionHead: () => "",
    addJsonLd: (node) => ctx.jsonLd.push(node),
    useScript: (name) => ctx.scripts.add(name),
    uid: (p = "z") => `${p}-${++uid}`,
  };
  return ctx;
}

const CAT = catalog(normalized(), fakeCtx(null));

function rejects(items, code, rate) {
  assert.throws(
    () => priceCart(CAT, items, rate),
    (e) => e instanceof CartError && e.code === code,
  );
}

describe("normalizeCommerce", () => {
  test("absent commerce is null without errors", () => {
    const errors = [];
    assert.equal(normalizeCommerce(undefined, errors), null);
    assert.deepEqual(errors, []);
  });

  test("applies defaults and normalises codes", () => {
    const c = normalized({ currency: "gbp", mode: undefined, cartPath: undefined });
    assert.equal(c.currency, "GBP");
    assert.equal(c.mode, "test");
    assert.equal(c.apiBase, "");
    assert.equal(c.cartPath, "/shop/cart/");
    assert.equal(c.successPath, "/shop/success/");
    assert.deepEqual(c.shipping.countries, ["GB", "IE"]);
    const mug = c.products.find((p) => p.id === "mug");
    assert.deepEqual(mug.options, []);
    assert.equal(mug.shippable, true);
    assert.equal(c.shipping.rates[1].freeOver, null);
  });

  test("strips trailing slashes from apiBase", () => {
    assert.equal(normalized({ apiBase: "https://api.acme.example/" }).apiBase, "https://api.acme.example");
  });

  const invalid = {
    provider: [{ provider: "medusa" }, /provider/],
    "unknown currency": [{ currency: "ZZZ" }, /currency/],
    "zero-decimal currency": [{ currency: "JPY" }, /two decimal/],
    mode: [{ mode: "prod" }, /mode/],
    apiBase: [{ apiBase: "api.example.com" }, /apiBase/],
    path: [{ successPath: "shop/success/" }, /successPath/],
    "no products": [{ products: [] }, /products must be a non-empty array/],
    "non-slug id": [{ products: [{ id: "Tee Shirt", name: "Tee", price: 100 }] }, /tee-shirt/],
    "duplicate id": [{ products: [{ id: "a", name: "A", price: 100 }, { id: "a", name: "B", price: 100 }] }, /duplicate/],
    "decimal price": [{ products: [{ id: "a", name: "A", price: 12.5 }] }, /price must be a positive integer/],
    "zero price": [{ products: [{ id: "a", name: "A", price: 0 }] }, /price must be a positive integer/],
    "options without values": [{ products: [{ id: "a", name: "A", price: 100, options: [{ name: "Size" }] }] }, /values/],
    "duplicate option values": [
      { products: [{ id: "a", name: "A", price: 100, options: [{ name: "Size", values: ["S", "S"] }] }] },
      /duplicates/,
    ],
    "negative rate": [{ shipping: { rates: [{ id: "std", label: "Std", amount: -1 }] } }, /amount/],
    "duplicate rate": [
      { shipping: { rates: [{ id: "std", label: "A", amount: 1 }, { id: "std", label: "B", amount: 2 }] } },
      /duplicated/,
    ],
    "bad country": [{ shipping: { countries: ["GBR"] } }, /countries/],
  };
  for (const [name, [overrides, pattern]] of Object.entries(invalid)) {
    test(`rejects ${name}`, () => {
      const errors = [];
      assert.equal(normalizeCommerce({ ...RAW, ...overrides }, errors), null);
      assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
    });
  }
});

describe("catalog / clientConfig", () => {
  test("catalog exposes pricing data with absolute image URLs and nothing private", () => {
    const tee = CAT.products.find((p) => p.id === "tee");
    assert.deepEqual(Object.keys(tee).sort(), ["id", "image", "name", "options", "price", "shippable", "thumb"]);
    assert.equal(tee.image, "https://acme.example/assets/img/tee.jpg");
    assert.equal(tee.thumb, "assets/img/tee.jpg");
    assert.equal(CAT.products.find((p) => p.id === "mug").image, null);
    assert.deepEqual(CAT.paths, { success: "/shop/success/", cancel: "/shop/cart/" });
  });

  test("clientConfig routes paths through ctx.url and namespaces storage by site", () => {
    const cfg = clientConfig(normalized({ apiBase: "https://api.acme.example" }), fakeCtx(null));
    assert.deepEqual(cfg, {
      apiBase: "https://api.acme.example",
      currency: "GBP",
      locale: "en-GB",
      mode: "test",
      cartPath: "../shop/cart/",
      catalogUrl: "../_z/catalog.json",
      siteRoot: "../",
      storageKey: "zsite-cart:acme-shop",
    });
  });
});

describe("priceCart", () => {
  test("prices lines from the catalog, merging identical lines", () => {
    const r = priceCart(
      CAT,
      [
        { id: "tee", qty: 1, options: { Size: "M", Colour: "Navy" } },
        { id: "mug", qty: 2 },
        { id: "tee", qty: 1, options: { Colour: "Navy", Size: "M" } },
      ],
      "express",
    );
    assert.equal(r.lines.length, 2);
    assert.deepEqual(
      r.lines.map((l) => [l.id, l.qty, l.unitPrice, l.lineTotal]),
      [
        ["tee", 2, 2000, 4000],
        ["mug", 2, 1200, 2400],
      ],
    );
    assert.equal(r.subtotal, 6400);
    assert.deepEqual(r.shippingRate, { id: "express", label: "Express", amount: 895, free: false });
    assert.equal(r.shipping, 895);
    assert.equal(r.total, 7295);
  });

  test("defaults to the first rate and applies its free-shipping threshold", () => {
    const tee = { id: "tee", qty: 1, options: { Size: "S", Colour: "Navy" } };
    const below = priceCart(CAT, [tee, { id: "mug", qty: 2 }]);
    assert.equal(below.subtotal, 4400);
    assert.deepEqual(below.shippingRate, { id: "standard", label: "Standard", amount: 395, free: false });
    assert.equal(below.total, 4795);

    const over = priceCart(CAT, [{ ...tee, qty: 2 }, { id: "mug", qty: 1 }]);
    assert.equal(over.subtotal, 5200);
    assert.equal(over.shipping, 0);
    assert.equal(over.shippingRate.free, true);

    const atThreshold = { ...CAT, shipping: { ...CAT.shipping, rates: [{ ...CAT.shipping.rates[0], freeOver: 2400 }] } };
    assert.equal(priceCart(atThreshold, [{ id: "mug", qty: 2 }]).shipping, 0, "subtotal equal to freeOver ships free");
    assert.equal(priceCart(atThreshold, [{ id: "mug", qty: 1 }]).shipping, 395);

    assert.equal(priceCart(CAT, [{ ...tee, qty: 3 }], "express").shipping, 895, "rates without freeOver always charge");
  });

  test("carts with only non-shippable items have no delivery", () => {
    const r = priceCart(CAT, [{ id: "voucher", qty: 1 }], "express");
    assert.equal(r.shippingRate, null);
    assert.equal(r.shipping, 0);
    assert.equal(r.total, 2500);
  });

  test("ignores client-sent prices", () => {
    const r = priceCart(CAT, [{ id: "mug", qty: 1, price: 1, unitPrice: 1 }]);
    assert.equal(r.lines[0].unitPrice, 1200);
  });

  test("rejects an empty or malformed cart", () => {
    rejects([], "empty_cart");
    rejects(undefined, "empty_cart");
    rejects([null], "invalid_cart");
    rejects(Array.from({ length: 51 }, () => ({ id: "mug", qty: 1 })), "too_many_items");
  });

  test("rejects unknown products", () => {
    rejects([{ id: "nope", qty: 1 }], "unknown_product");
    rejects([{ id: { toString: () => "mug" }, qty: 1 }], "unknown_product");
  });

  test("rejects invalid options", () => {
    rejects([{ id: "tee", qty: 1, options: { Size: "XXL", Colour: "Navy" } }], "invalid_option");
    rejects([{ id: "tee", qty: 1, options: { Size: "M" } }], "invalid_option");
    rejects([{ id: "tee", qty: 1 }], "invalid_option");
    rejects([{ id: "mug", qty: 1, options: { Size: "M" } }], "invalid_option");
    rejects([{ id: "tee", qty: 1, options: ["M", "Navy"] }], "invalid_option");
  });

  test("rejects quantities outside 1..99 whole numbers", () => {
    for (const qty of [0, -1, 100, 1.5, "2", null, Number.NaN]) rejects([{ id: "mug", qty }], "invalid_quantity");
    rejects([{ id: "mug", qty: 60 }, { id: "mug", qty: 40 }], "invalid_quantity");
    assert.equal(priceCart(CAT, [{ id: "mug", qty: 99 }]).lines[0].qty, 99);
  });

  test("rejects unknown shipping rates", () => {
    rejects([{ id: "mug", qty: 1 }], "invalid_shipping_rate", "teleport");
  });
});

describe("cart reference", () => {
  test("round-trips ids, quantities and options compactly", () => {
    const priced = priceCart(CAT, [
      { id: "tee", qty: 3, options: { Size: "L", Colour: "Stone" } },
      { id: "mug", qty: 1 },
    ]);
    const ref = encodeCartRef(priced.lines, CAT);
    assert.equal(ref, "tee:3:2.1,mug:1");
    assert.deepEqual(
      decodeCartRef(ref, CAT).map(({ id, qty, options }) => ({ id, qty, options })),
      [
        { id: "tee", qty: 3, options: { Size: "L", Colour: "Stone" } },
        { id: "mug", qty: 1, options: {} },
      ],
    );
  });
});

describe("products component", () => {
  test("renders add-to-basket forms and Product JSON-LD from the commerce catalog", () => {
    const commerce = normalized({ products: [{ id: "tee", name: 'Tee <"best">', price: 2000, options: [{ name: "Size", values: ["S&M"] }] }] });
    const ctx = fakeCtx(commerce);
    const html = products.render({}, ctx);
    assert.match(html, /data-add-to-cart data-product-id="tee"/);
    assert.match(html, /data-option="Size"/);
    assert.match(html, /<option>S&amp;M<\/option>/);
    assert.match(html, /£20\.00/);
    assert.ok(!html.includes('<"best">'), "product name is escaped");
    assert.ok(ctx.scripts.has("cart"));
    assert.equal(ctx.jsonLd[0]["@type"], "Product");
    assert.deepEqual(ctx.jsonLd[0].offers, {
      "@type": "Offer",
      price: "20.00",
      priceCurrency: "GBP",
      availability: "https://schema.org/InStock",
      url: "https://acme.example/shop/#product-tee",
    });
  });

  test("filters by ids and tag", () => {
    const ctx = fakeCtx(normalized());
    assert.deepEqual(
      [...products.render({ ids: ["voucher", "tee"] }, ctx).matchAll(/id="product-([a-z]+)"/g)].map((m) => m[1]),
      ["voucher", "tee"],
    );
    assert.deepEqual(
      [...products.render({ tag: "home" }, ctx).matchAll(/id="product-([a-z]+)"/g)].map((m) => m[1]),
      ["mug"],
    );
    assert.throws(() => products.render({ ids: ["missing"] }, ctx), /unknown product id "missing"/);
  });

  test("without commerce renders a price list without basket controls", () => {
    const ctx = fakeCtx(null);
    const html = products.render(products.example, ctx);
    assert.match(html, /£24\.99/);
    assert.doesNotMatch(html, /data-add-to-cart|<form/);
    assert.equal(ctx.scripts.size, 0);
  });
});
