// POST /api/contact — receives the `contact` component's plain HTML form
// (no JavaScript needed) or a JSON body, then stores it in D1 and/or emails it.
//
// Delivery (at least one required, else 503):
//   env.DB                       D1; table `messages` (migrations/0002_messages.sql)
//   env.CONTACT_EMAIL            send_email binding (Cloudflare Email Routing) plus
//   env.CONTACT_TO, CONTACT_FROM  verified destination and a sender on the zone
// Spam: hidden honeypot `_gotcha` (silently accepted, never stored) and, when
// env.TURNSTILE_SECRET is set, a required Cloudflare Turnstile token.
// Form posts get a 303 back to `_next` (resolved against the page that posted);
// the component points it at a :target-revealed "sent" notice.

const MAX_BODY_BYTES = 32 * 1024;
const MAX_FIELDS = 20;
const MAX_VALUE = 5000;
const RESERVED = new Set(["_gotcha", "_next", "cf-turnstile-response"]);
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const LOG = "zsite-contact:";

const wantsHtml = (request) => !/json/.test(request.headers.get("Content-Type") ?? "");

function htmlPage(status, title, text, back) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>` +
      `<body style="font:1.1rem/1.6 system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 1.25rem"><h1>${esc(title)}</h1><p>${esc(text)}</p>` +
      (back ? `<p><a href="${esc(back)}">Back to the site</a></p>` : "") +
      "</body></html>",
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

async function readFields(request) {
  const type = request.headers.get("Content-Type") ?? "";
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BODY_BYTES) return { error: "Message is too large.", status: 413 };
  let entries;
  if (/^application\/json/.test(type)) {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return { error: "Message is too large.", status: 413 };
    const body = JSON.parse(text || "null");
    if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Expected a JSON object.", status: 400 };
    entries = Object.entries(body);
  } else if (/^(application\/x-www-form-urlencoded|multipart\/form-data)/.test(type)) {
    entries = [...(await request.formData()).entries()].filter(([, v]) => typeof v === "string");
  } else {
    return { error: "Unsupported content type.", status: 415 };
  }
  const meta = {};
  const fields = {};
  for (const [name, raw] of entries) {
    const value = String(raw ?? "").trim();
    if (RESERVED.has(name)) {
      meta[name] = value;
      continue;
    }
    if (!/^[\w-]{1,64}$/.test(name)) return { error: "Invalid field name.", status: 400 };
    if (value.length > MAX_VALUE) return { error: `"${name}" is too long.`, status: 400 };
    if (value) fields[name] = value;
  }
  if (Object.keys(fields).length > MAX_FIELDS) return { error: "Too many fields.", status: 400 };
  if (!Object.keys(fields).length) return { error: "The form is empty.", status: 400 };
  if (fields.email && !EMAIL.test(fields.email)) return { error: "Please enter a valid email address.", status: 400 };
  return { fields, meta };
}

async function verifyTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  return data.success === true;
}

/** Plain-text MIME message; header values are CR/LF-free by construction. */
export function buildEmail({ from, to, host, fields, page }) {
  const clean = (s) => String(s).replace(/[\r\n]+/g, " ");
  const replyTo = fields.email && EMAIL.test(fields.email) ? `Reply-To: ${clean(fields.email)}\r\n` : "";
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}:\n${v}\n`)
    .join("\n");
  return (
    `From: ${clean(from)}\r\nTo: ${clean(to)}\r\n${replyTo}` +
    `Subject: Website enquiry (${clean(host)})\r\n` +
    `Message-ID: <${crypto.randomUUID()}@${clean(host)}>\r\nDate: ${new Date().toUTCString()}\r\n` +
    "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n" +
    `${body}\n--\nSent from ${page || host}\n`
  );
}

/**
 * Where to send the browser after a form post: `_next` resolved against the
 * posting page (Referer), accepted only for this Worker's origin or ALLOWED_ORIGINS.
 */
export function redirectTarget(next, referer, url, allowed) {
  if (!referer) return null;
  try {
    const target = new URL(next || "", referer);
    const ok = target.origin === url.origin || allowed.includes(target.origin);
    return ok && /^https?:$/.test(target.protocol) ? target.href : null;
  } catch {
    return null;
  }
}

export async function contact(request, env, url, { cors, allowed, json }) {
  const html = wantsHtml(request);
  const referer = request.headers.get("Referer");
  const fail = (status, message) =>
    html ? htmlPage(status, "Message not sent", message, referer) : json({ error: message }, status, cors);

  const canStore = Boolean(env.DB);
  const canEmail = Boolean(env.CONTACT_EMAIL && env.CONTACT_TO && env.CONTACT_FROM);
  if (!canStore && !canEmail) return fail(503, "The contact form is not configured yet. Please email us instead.");

  let parsed;
  try {
    parsed = await readFields(request);
  } catch {
    return fail(400, "Could not read the form.");
  }
  if (parsed.error) return fail(parsed.status, parsed.error);
  const { fields, meta } = parsed;

  const done = () => {
    if (!html) return json({ ok: true }, 200, cors);
    const target = redirectTarget(meta._next, referer, url, allowed);
    return target
      ? new Response(null, { status: 303, headers: { Location: target, "Cache-Control": "no-store" } })
      : htmlPage(200, "Thanks — message sent", "We'll get back to you soon.", referer);
  };

  if (meta._gotcha) return done(); // bot: pretend success, keep nothing
  if (!(await verifyTurnstile(env, meta["cf-turnstile-response"], request))) {
    return fail(400, "Please complete the anti-spam check and try again.");
  }

  const page = referer ? String(referer).slice(0, 500) : null;
  let delivered = false;
  if (canStore) {
    try {
      await env.DB.prepare("INSERT INTO messages (fields_json, email, page, created_at) VALUES (?, ?, ?, ?)")
        .bind(JSON.stringify(fields), fields.email ?? null, page, new Date().toISOString())
        .run();
      delivered = true;
    } catch (error) {
      console.error(LOG, "d1 insert failed", error?.message);
    }
  }
  if (canEmail) {
    try {
      const { EmailMessage } = await import("cloudflare:email");
      const raw = buildEmail({ from: env.CONTACT_FROM, to: env.CONTACT_TO, host: url.host, fields, page });
      await env.CONTACT_EMAIL.send(new EmailMessage(env.CONTACT_FROM, env.CONTACT_TO, raw));
      delivered = true;
    } catch (error) {
      console.error(LOG, "email send failed", error?.message);
    }
  }
  if (!delivered) return fail(500, "Sorry, your message could not be sent. Please try again or email us.");
  return done();
}
