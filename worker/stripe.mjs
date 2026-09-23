// Minimal Stripe REST client for Cloudflare Workers (and Node >= 20): form
// encoding, API requests via global fetch, metadata chunking and webhook
// signature verification with WebCrypto. No SDK, no Node built-ins.

const API = "https://api.stripe.com/v1";
/** Stripe caps each metadata value at 500 characters. */
export const METADATA_VALUE_LIMIT = 500;
const TOLERANCE_SECONDS = 300;

export class StripeError extends Error {
  constructor(message, { status = 0, type = null, code = null, param = null } = {}) {
    super(message);
    this.name = "StripeError";
    Object.assign(this, { status, type, code, param });
  }
}

export class SignatureError extends Error {
  constructor(message) {
    super(message);
    this.name = "SignatureError";
  }
}

/** Encode nested objects/arrays in Stripe's bracket syntax: a[b][0][c]=v. */
export function formEncode(value) {
  const params = new URLSearchParams();
  const walk = (key, v) => {
    if (v == null) return;
    if (Array.isArray(v)) v.forEach((item, i) => walk(`${key}[${i}]`, item));
    else if (typeof v === "object") for (const [k, item] of Object.entries(v)) walk(key ? `${key}[${k}]` : k, item);
    else params.append(key, String(v));
  };
  walk("", value);
  return params.toString();
}

async function stripeRequest(secretKey, method, path, { body, query, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${secretKey}` };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const qs = query ? `?${formEncode(query)}` : "";
  const res = await fetch(`${API}${path}${qs}`, { method, headers, body: body ? formEncode(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new StripeError(e.message ?? `Stripe request failed (${res.status})`, {
      status: res.status,
      type: e.type,
      code: e.code,
      param: e.param,
    });
  }
  return data;
}

/** POST /v1/checkout/sessions. `params` is a plain object; see formEncode. */
export function createCheckoutSession(secretKey, params, { idempotencyKey } = {}) {
  return stripeRequest(secretKey, "POST", "/checkout/sessions", { body: params, idempotencyKey });
}

/** GET a session's line items with each ad-hoc product expanded (for product metadata). */
export function listLineItems(secretKey, sessionId) {
  return stripeRequest(secretKey, "GET", `/checkout/sessions/${encodeURIComponent(sessionId)}/line_items`, {
    query: { limit: 100, expand: ["data.price.product"] },
  });
}

/** Split a long value over `key`, `key_2`, `key_3`… so each stays within Stripe's limit. */
export function chunkMetadata(key, value, limit = METADATA_VALUE_LIMIT) {
  const out = {};
  const text = String(value);
  for (let i = 0, n = 1; i < text.length || n === 1; i += limit, n++) {
    out[n === 1 ? key : `${key}_${n}`] = text.slice(i, i + limit);
  }
  return out;
}

/** Inverse of chunkMetadata. */
export function joinMetadata(metadata, key) {
  let text = metadata?.[key] ?? "";
  for (let n = 2; metadata?.[`${key}_${n}`] != null; n++) text += metadata[`${key}_${n}`];
  return text;
}

const encoder = new TextEncoder();

const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Constant-time comparison for equal-length strings (length is not secret). */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/**
 * Verify a `Stripe-Signature` header ("t=…,v1=…[,v1=…]") against the raw
 * request body and return the parsed event. Throws SignatureError.
 */
export async function verifyWebhook(payload, header, secret, { tolerance = TOLERANCE_SECONDS, now } = {}) {
  if (!header) throw new SignatureError("Missing Stripe-Signature header");
  let timestamp = Number.NaN;
  const signatures = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    else if (key === "v1") signatures.push(value);
  }
  if (!Number.isSafeInteger(timestamp) || signatures.length === 0) {
    throw new SignatureError("Malformed Stripe-Signature header");
  }
  const current = now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(current - timestamp) > tolerance) throw new SignatureError("Webhook timestamp is outside the tolerance window");

  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`)));
  let match = false;
  for (const signature of signatures) match = safeEqual(signature, expected) || match;
  if (!match) throw new SignatureError("No matching webhook signature");

  try {
    return JSON.parse(payload);
  } catch {
    throw new SignatureError("Webhook payload is not valid JSON");
  }
}
