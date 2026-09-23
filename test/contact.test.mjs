import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { buildEmail } from "../worker/contact.mjs";
import worker from "../worker/index.mjs";

const ORIGIN = "https://shop.example";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeDb() {
  const rows = [];
  return {
    rows,
    prepare: (sql) => ({ bind: (...args) => ({ run: async () => rows.push({ sql, args }) }) }),
  };
}

const formPost = (fields, headers = {}) =>
  new Request(`${ORIGIN}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${ORIGIN}/about/`, ...headers },
    body: new URLSearchParams(fields),
  });

describe("POST /api/contact", () => {
  it("stores a plain HTML form post and 303s back to the form's sent notice", async () => {
    const DB = fakeDb();
    const res = await worker.fetch(formPost({ name: "Ann", email: "ann@example.com", message: "Hi", _next: "#contact-sent-1", _gotcha: "" }), { DB });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("Location"), `${ORIGIN}/about/#contact-sent-1`);
    assert.equal(DB.rows.length, 1);
    assert.deepEqual(JSON.parse(DB.rows[0].args[0]), { name: "Ann", email: "ann@example.com", message: "Hi" });
  });

  it("never redirects to an origin that is not the Worker's or allow-listed", async () => {
    const res = await worker.fetch(formPost({ message: "Hi", _next: "https://evil.example/phish" }), { DB: fakeDb() });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /message sent/);
  });

  it("redirects cross-origin previews listed in ALLOWED_ORIGINS", async () => {
    const res = await worker.fetch(
      formPost({ message: "Hi", _next: "#sent" }, { Origin: "https://org.github.io", Referer: "https://org.github.io/repo/" }),
      { DB: fakeDb(), ALLOWED_ORIGINS: "https://org.github.io" },
    );
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("Location"), "https://org.github.io/repo/#sent");
  });

  it("silently drops honeypot submissions but looks successful to the bot", async () => {
    const DB = fakeDb();
    const res = await worker.fetch(formPost({ message: "buy pills", _gotcha: "http://spam" }), { DB });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("Location"), `${ORIGIN}/about/`);
    assert.equal(DB.rows.length, 0);
  });

  it("requires a valid Turnstile token when TURNSTILE_SECRET is set", async () => {
    const DB = fakeDb();
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      return Response.json({ success: init.body.get("response") === "good" });
    };
    const env = { DB, TURNSTILE_SECRET: "s" };
    assert.equal((await worker.fetch(formPost({ message: "Hi" }), env)).status, 400);
    assert.equal((await worker.fetch(formPost({ message: "Hi", "cf-turnstile-response": "bad" }), env)).status, 400);
    assert.equal((await worker.fetch(formPost({ message: "Hi", "cf-turnstile-response": "good" }), env)).status, 303);
    assert.equal(DB.rows.length, 1);
  });

  it("answers JSON clients with JSON and validates input", async () => {
    const post = (body) =>
      worker.fetch(
        new Request(`${ORIGIN}/api/contact`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        { DB: fakeDb() },
      );
    assert.deepEqual(await (await post({ message: "Hi" })).json(), { ok: true });
    assert.equal((await post({ email: "not-an-email", message: "Hi" })).status, 400);
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ "bad name!": "x" })).status, 400);
  });

  it("rejects cross-origin posts from unknown origins and reports 503 when unconfigured", async () => {
    assert.equal((await worker.fetch(formPost({ message: "Hi" }, { Origin: "https://evil.example" }), { DB: fakeDb() })).status, 403);
    assert.equal((await worker.fetch(formPost({ message: "Hi" }), {})).status, 503);
  });
});

describe("contact email", () => {
  it("keeps submitted values out of the headers except a validated Reply-To", () => {
    const raw = buildEmail({
      from: "web@shop.example",
      to: "owner@shop.example",
      host: "shop.example",
      fields: { email: "a@b.co", name: "x\r\nBcc: victim@example.com" },
      page: null,
    });
    const [headers, body] = raw.split("\r\n\r\n");
    assert.match(headers, /^Reply-To: a@b\.co$/m);
    assert.doesNotMatch(headers, /Bcc/);
    assert.match(body, /Bcc: victim/); // stays inert in the text body
  });
});
