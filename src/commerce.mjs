// Commerce ("stripe-lite" tier): config normalisation, the public catalog the
// engine publishes at /_z/catalog.json, the client config embedded in pages,
// and pure cart pricing shared by the build, the browser display and the
// Cloudflare Worker. Worker-safe: no Node built-ins.

import { slug } from "./html.mjs";

export const PROVIDER = "stripe-lite";
export const MAX_QTY = 99;
export const MAX_LINES = 50;
/** Stripe's unit_amount ceiling for two-decimal currencies. */
const MAX_PRICE = 99_999_999;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DEFAULTS = {
  currency: "GBP",
  locale: "en-GB",
  mode: "test",
  apiBase: "",
  cartPath: "/shop/cart/",
  successPath: "/shop/success/",
  cancelPath: "/shop/cart/",
  countries: ["GB"],
};

const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const isText = (v) => typeof v === "string" && v.trim() !== "";
const show = (v) => JSON.stringify(v) ?? String(v);

/** Only two-decimal currencies: html.money and minor-unit prices assume /100. */
function currencyProblem(code) {
  if (!/^[A-Z]{3}$/.test(code)) return "must be an ISO 4217 code like \"GBP\"";
  if (!Intl.supportedValuesOf("currency").includes(code)) return "is not a known ISO 4217 currency";
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
    .maximumFractionDigits;
  return digits === 2 ? null : "must use two decimal places (zero/three-decimal currencies are unsupported)";
}

function localeValid(locale) {
  try {
    return typeof locale === "string" && Intl.getCanonicalLocales(locale).length === 1;
  } catch {
    return false;
  }
}

const sitePath = (v) => typeof v === "string" && v.startsWith("/") && !v.startsWith("//");

/**
 * Validate and default `site.commerce`. Returns null when commerce is absent or
 * invalid; every problem is pushed to `errors` as a readable message (the
 * config loader prefixes them with "commerce: ").
 */
export function normalizeCommerce(raw, errors = []) {
  if (raw == null || raw === false) return null;
  if (!isObject(raw)) {
    errors.push("must be an object like { provider, currency, products }");
    return null;
  }
  const start = errors.length;
  const err = (msg) => errors.push(msg);

  const provider = raw.provider ?? PROVIDER;
  if (provider !== PROVIDER) err(`provider must be "${PROVIDER}" (got ${show(provider)})`);

  const currency = typeof raw.currency === "string" ? raw.currency.toUpperCase() : raw.currency ?? DEFAULTS.currency;
  const currencyIssue = typeof currency === "string" ? currencyProblem(currency) : "must be a string";
  if (currencyIssue) err(`currency ${currencyIssue} (got ${show(raw.currency)})`);

  const locale = raw.locale ?? DEFAULTS.locale;
  if (!localeValid(locale)) err(`locale must be a BCP 47 tag like "en-GB" (got ${show(locale)})`);

  const mode = raw.mode ?? DEFAULTS.mode;
  if (mode !== "test" && mode !== "live") err(`mode must be "test" or "live" (got ${show(mode)})`);

  let apiBase = raw.apiBase ?? DEFAULTS.apiBase;
  if (typeof apiBase !== "string" || (apiBase !== "" && !/^https?:\/\/[^/\s]+(\/\S*)?$/.test(apiBase))) {
    err(`apiBase must be "" (same origin) or an absolute http(s) URL (got ${show(apiBase)})`);
  } else {
    apiBase = apiBase.replace(/\/+$/, "");
  }

  const paths = {};
  for (const key of ["cartPath", "successPath", "cancelPath"]) {
    paths[key] = raw[key] ?? DEFAULTS[key];
    if (!sitePath(paths[key])) err(`${key} must be a root-relative path like "/shop/cart/" (got ${show(paths[key])})`);
  }

  const products = normalizeProducts(raw.products, err);
  const shipping = normalizeShipping(raw.shipping, err, products.some((p) => p.shippable));

  if (errors.length > start) return null;
  return { provider, currency, locale, mode, apiBase, ...paths, shipping, products };
}

function normalizeProducts(raw, err) {
  if (!Array.isArray(raw) || raw.length === 0) {
    err("products must be a non-empty array");
    return [];
  }
  const seen = new Set();
  return raw.map((p, i) => {
    const at = `products[${i}]`;
    if (!isObject(p)) {
      err(`${at} must be an object`);
      return { shippable: false };
    }
    const where = isText(p.id) ? `products[${i}] ("${p.id}")` : at;
    if (typeof p.id !== "string" || !ID_RE.test(p.id)) {
      const hint = typeof p.id === "string" && slug(p.id) ? ` — try "${slug(p.id)}"` : "";
      err(`${at}.id must be lowercase letters, digits and single hyphens (got ${show(p.id)})${hint}`);
    } else if (seen.has(p.id)) {
      err(`${where}.id is a duplicate; product ids must be unique`);
    } else {
      seen.add(p.id);
    }
    if (!isText(p.name)) err(`${where}.name is required`);
    if (!Number.isInteger(p.price) || p.price <= 0 || p.price > MAX_PRICE) {
      err(`${where}.price must be a positive integer in minor units, e.g. 1500 for 15.00 (got ${show(p.price)})`);
    }
    const description = p.description ?? null;
    if (description != null && typeof description !== "string" && !(Array.isArray(description) && description.every((d) => typeof d === "string"))) {
      err(`${where}.description must be a string or array of strings`);
    }
    if (p.image != null && !isText(p.image)) err(`${where}.image must be an asset path like "img/tee.jpg"`);
    if (p.shippable != null && typeof p.shippable !== "boolean") err(`${where}.shippable must be true or false`);
    if (p.sku != null && !isText(p.sku)) err(`${where}.sku must be a non-empty string`);
    const tags = p.tags ?? [];
    if (!Array.isArray(tags) || !tags.every(isText)) err(`${where}.tags must be an array of strings`);
    return {
      id: p.id,
      name: p.name,
      description,
      price: p.price,
      image: p.image ?? null,
      options: normalizeOptions(p.options, `${where}.options`, err),
      shippable: p.shippable ?? true,
      sku: p.sku ?? null,
      tags: Array.isArray(tags) ? tags : [],
    };
  });
}

function normalizeOptions(raw, at, err) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    err(`${at} must be an array of { name, values }`);
    return [];
  }
  const names = new Set();
  return raw.map((o, i) => {
    if (!isObject(o) || !isText(o.name)) {
      err(`${at}[${i}].name is required`);
      return { name: "", values: [] };
    }
    if (names.has(o.name)) err(`${at}[${i}].name "${o.name}" is duplicated`);
    names.add(o.name);
    const values = o.values;
    if (!Array.isArray(values) || values.length === 0 || !values.every(isText)) {
      err(`${at}[${i}] ("${o.name}").values must be a non-empty array of strings`);
      return { name: o.name, values: [] };
    }
    if (new Set(values).size !== values.length) err(`${at}[${i}] ("${o.name}").values contains duplicates`);
    return { name: o.name, values: [...values] };
  });
}

function normalizeShipping(raw, err, needed) {
  const src = raw ?? {};
  if (!isObject(src)) {
    err("shipping must be an object { countries, rates }");
    return { countries: [], rates: [] };
  }
  const countries = (src.countries ?? DEFAULTS.countries);
  let outCountries = [];
  if (!Array.isArray(countries) || !countries.every((c) => typeof c === "string" && /^[A-Za-z]{2}$/.test(c))) {
    err(`shipping.countries must be ISO 3166-1 alpha-2 codes like ["GB", "IE"] (got ${show(countries)})`);
  } else {
    outCountries = [...new Set(countries.map((c) => c.toUpperCase()))];
    if (needed && outCountries.length === 0) err("shipping.countries must list at least one country for shippable products");
  }

  const rates = src.rates ?? [];
  if (!Array.isArray(rates)) {
    err("shipping.rates must be an array");
    return { countries: outCountries, rates: [] };
  }
  const ids = new Set();
  const outRates = rates.map((r, i) => {
    const at = `shipping.rates[${i}]`;
    if (!isObject(r)) {
      err(`${at} must be an object`);
      return null;
    }
    if (typeof r.id !== "string" || !ID_RE.test(r.id)) err(`${at}.id must be a slug like "standard" (got ${show(r.id)})`);
    else if (ids.has(r.id)) err(`${at}.id "${r.id}" is duplicated`);
    ids.add(r.id);
    if (!isText(r.label)) err(`${at}.label is required`);
    if (!Number.isInteger(r.amount) || r.amount < 0 || r.amount > MAX_PRICE) {
      err(`${at}.amount must be a non-negative integer in minor units (got ${show(r.amount)})`);
    }
    if (r.freeOver != null && (!Number.isInteger(r.freeOver) || r.freeOver <= 0)) {
      err(`${at}.freeOver must be a positive integer in minor units (got ${show(r.freeOver)})`);
    }
    return { id: r.id, label: r.label, amount: r.amount, freeOver: r.freeOver ?? null };
  });
  return { countries: outCountries, rates: outRates.filter(Boolean) };
}

/** Absolute URL for a product image (asset path or http(s) URL). */
function imageUrl(src, ctx) {
  return src ? ctx.abs(ctx.assetPath(src)) : null;
}

/**
 * Public catalog published at /_z/catalog.json. The Worker prices checkouts
 * from this file, so it carries everything pricing needs and nothing private.
 */
export function catalog(commerce, ctx) {
  return {
    currency: commerce.currency,
    locale: commerce.locale,
    products: commerce.products.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      image: imageUrl(p.image, ctx),
      // Site-root-relative (or absolute) path for the basket thumbnail; resolved
      // against the deployment's own root so previews and local dev work too.
      thumb: p.image ? ctx.assetPath(p.image).replace(/^\//, "") : null,
      options: p.options,
      shippable: p.shippable,
    })),
    shipping: commerce.shipping,
    paths: { success: commerce.successPath, cancel: commerce.cancelPath },
  };
}

/**
 * Browser config embedded as <script type="application/json" id="zsite-commerce">.
 * `siteRoot` (page-relative) lets the client send an absolute return base so a
 * cross-origin Worker can send Stripe customers back to a preview deployment.
 */
export function clientConfig(commerce, ctx) {
  return {
    apiBase: commerce.apiBase,
    currency: commerce.currency,
    locale: commerce.locale,
    mode: commerce.mode,
    cartPath: ctx.url(commerce.cartPath),
    catalogUrl: ctx.url("/_z/catalog.json"),
    siteRoot: ctx.url("/"),
    storageKey: `zsite-cart:${ctx.site.slug}`,
  };
}

export class CartError extends Error {
  /** code: empty_cart | too_many_items | invalid_cart | unknown_product | invalid_option | invalid_quantity | invalid_shipping_rate */
  constructor(code, message) {
    super(message);
    this.name = "CartError";
    this.code = code;
  }
}

const clip = (v) => String(v).slice(0, 60);

function pickOptions(product, raw) {
  if (raw != null && !isObject(raw)) throw new CartError("invalid_option", `Options for ${product.name} are malformed.`);
  const given = raw ?? {};
  for (const key of Object.keys(given)) {
    if (!product.options.some((o) => o.name === key)) {
      throw new CartError("invalid_option", `${product.name} has no "${clip(key)}" option.`);
    }
  }
  const picked = {};
  for (const option of product.options) {
    const value = given[option.name];
    if (typeof value !== "string" || !option.values.includes(value)) {
      throw new CartError("invalid_option", `Choose a valid ${option.name} for ${product.name}.`);
    }
    picked[option.name] = value;
  }
  return picked;
}

/**
 * Price a cart against the catalog. Client-sent prices are never read: only
 * `{ id, qty, options }` per item. Identical lines are merged.
 * Returns { currency, lines, subtotal, shipping, shippingRate, total } in minor units.
 */
export function priceCart(cat, items, shippingRateId) {
  if (!Array.isArray(items) || items.length === 0) throw new CartError("empty_cart", "Your cart is empty.");
  if (items.length > MAX_LINES) throw new CartError("too_many_items", `A cart can hold at most ${MAX_LINES} different items.`);
  const products = new Map(cat.products.map((p) => [p.id, p]));
  const merged = new Map();
  for (const item of items) {
    if (!isObject(item)) throw new CartError("invalid_cart", "A cart item is malformed.");
    const product = typeof item.id === "string" ? products.get(item.id) : undefined;
    if (!product) throw new CartError("unknown_product", `"${clip(item.id)}" is not available.`);
    const qtyError = () =>
      new CartError("invalid_quantity", `Quantity for ${product.name} must be a whole number from 1 to ${MAX_QTY}.`);
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) throw qtyError();
    const options = pickOptions(product, item.options);
    const key = [product.id, ...product.options.map((o) => options[o.name])].join("\u0000");
    const line = merged.get(key);
    if (line) {
      line.qty += item.qty;
      if (line.qty > MAX_QTY) throw qtyError();
    } else {
      merged.set(key, {
        id: product.id,
        name: product.name,
        options,
        qty: item.qty,
        unitPrice: product.price,
        shippable: product.shippable !== false,
        image: product.image ?? null,
      });
    }
  }
  const lines = [...merged.values()].map((l) => ({ ...l, lineTotal: l.unitPrice * l.qty }));
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  const rates = cat.shipping?.rates ?? [];
  const wanted = shippingRateId == null || shippingRateId === "" ? null : shippingRateId;
  if (wanted != null && !rates.some((r) => r.id === wanted)) {
    throw new CartError("invalid_shipping_rate", "Choose a valid delivery option.");
  }
  let shippingRate = null;
  if (rates.length && lines.some((l) => l.shippable)) {
    const rate = rates.find((r) => r.id === wanted) ?? rates[0];
    const free = rate.freeOver != null && subtotal >= rate.freeOver;
    shippingRate = { id: rate.id, label: rate.label, amount: free ? 0 : rate.amount, free };
  }
  const shipping = shippingRate?.amount ?? 0;
  return { currency: cat.currency, lines, subtotal, shipping, shippingRate, total: subtotal + shipping };
}

/** "Size: M / Colour: Black"-style label for a priced line, in catalog option order. */
export function optionLabel(line, cat) {
  const product = cat.products.find((p) => p.id === line.id);
  return (product?.options ?? []).map((o) => line.options[o.name]).filter(Boolean).join(" / ");
}

/**
 * Compact, delimiter-safe cart reference for Stripe metadata:
 * "tee:2:1.0,mug:1" = id:qty[:optionValueIndexes]. Ids are slugs, so ":" "," "." never collide.
 */
export function encodeCartRef(lines, cat) {
  const products = new Map(cat.products.map((p) => [p.id, p]));
  return lines
    .map((l) => {
      const opts = (products.get(l.id)?.options ?? []).map((o) => o.values.indexOf(l.options[o.name]));
      return [l.id, l.qty, ...(opts.length ? [opts.join(".")] : [])].join(":");
    })
    .join(",");
}

/** Inverse of encodeCartRef. Unknown products/indexes keep id+qty with options null. */
export function decodeCartRef(ref, cat) {
  if (!ref) return [];
  const products = new Map((cat?.products ?? []).map((p) => [p.id, p]));
  return String(ref)
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [id, qty, idx = ""] = part.split(":");
      const product = products.get(id);
      const indexes = idx === "" ? [] : idx.split(".").map(Number);
      let options = null;
      if (product && indexes.length === product.options.length) {
        options = {};
        product.options.forEach((o, i) => (options[o.name] = o.values[indexes[i]] ?? null));
      }
      return { id, qty: Number(qty), name: product?.name ?? null, unitPrice: product?.price ?? null, options };
    });
}
