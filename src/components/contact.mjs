import { attrs, cls, each, esc, slug } from "../html.mjs";

const ICONS = { email: "mail", phone: "phone", whatsapp: "whatsapp", facebook: "facebook", instagram: "instagram", link: "arrow-right" };
const FIELD_TYPES = new Set(["text", "email", "tel", "textarea", "select"]);
const AUTOCOMPLETE = { email: "email", tel: "tel" };
const NAME_AUTOCOMPLETE = { name: "name", email: "email", phone: "tel", tel: "tel", company: "organization", organisation: "organization" };

/** Contact hrefs: bare addresses/numbers get mailto:/tel:, everything else goes through ctx.url. */
function methodHref(m, ctx) {
  const raw = String(m.href ?? "");
  if (m.kind === "email" && !raw.includes(":")) return `mailto:${raw}`;
  if (m.kind === "phone" && !raw.includes(":")) return `tel:${raw.replace(/[^\d+]/g, "")}`;
  return ctx.url(raw);
}

export default {
  type: "contact",
  summary: "Contact buttons (email, phone, WhatsApp, social) plus an optional no-JS HTML form with honeypot and Cloudflare Turnstile.",
  fullBleed: false,
  props: {
    body: { type: "string|array" },
    methods: { type: "array" },
    form: { type: "object" },
    turnstileSiteKey: { type: "string" },
  },
  /** External hosts this section contacts (privacy registry + build check). */
  thirdParties(props) {
    const out = [];
    const f = props.form;
    if (f?.fields?.length && /^https?:\/\//.test(f.action ?? "")) {
      const host = new URL(f.action).host;
      out.push({ host, name: f.providerName ?? host, purpose: "Receives contact form submissions", policyUrl: f.providerPolicyUrl });
    }
    if (props.turnstileSiteKey && f?.fields?.length) {
      out.push({
        host: "challenges.cloudflare.com",
        name: "Cloudflare Turnstile",
        purpose: "Checks the contact form is used by a person, not a bot",
        policyUrl: "https://www.cloudflare.com/turnstile-privacy-policy/",
      });
    }
    return out;
  },
  example: {
    eyebrow: "Get in touch",
    heading: "Questions? Ask away",
    body: "We usually reply within a day. For anything urgent on the day itself, phone is best.",
    methods: [
      { kind: "email", label: "hello@example.com", href: "hello@example.com" },
      { kind: "phone", label: "028 4484 0000", href: "028 4484 0000" },
      { kind: "whatsapp", label: "WhatsApp us", href: "https://wa.me/447700900000" },
      { kind: "facebook", label: "Facebook", href: "https://facebook.com/example" },
    ],
    form: {
      action: "worker",
      fields: [
        { name: "name", label: "Your name", type: "text", required: true },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "topic", label: "Topic", type: "select", options: ["Entering a car", "Sponsorship", "Press", "Something else"] },
        { name: "message", label: "Message", type: "textarea", required: true },
      ],
      submitLabel: "Send message",
    },
    turnstileSiteKey: "1x00000000000000000000AA",
  },
  render(props, ctx) {
    const method = (m, i) => {
      const href = methodHref(m, ctx);
      const style = m.style ?? (i === 0 ? "primary" : "outline");
      return `<li><a${attrs({
        class: cls("btn", `btn--${style}`, "s-contact__method"),
        href,
        rel: /^https?:\/\//.test(href) ? "noopener" : null,
      })}>${ctx.icon(ICONS[m.kind] ?? "arrow-right")}<span>${esc(m.label ?? m.href)}</span></a></li>`;
    };

    const field = (f) => {
      const type = FIELD_TYPES.has(f.type) ? f.type : "text";
      const id = ctx.uid(`f-${slug(f.name ?? "") || "field"}`);
      const common = {
        id,
        name: f.name,
        required: f.required === true,
        placeholder: f.placeholder ?? null,
        autocomplete: f.autocomplete ?? AUTOCOMPLETE[type] ?? NAME_AUTOCOMPLETE[f.name] ?? null,
      };
      let control;
      if (type === "textarea") {
        control = `<textarea${attrs({ ...common, rows: f.rows ?? 5 })}></textarea>`;
      } else if (type === "select") {
        const opts = (f.options ?? []).map((o) => (o !== null && typeof o === "object" ? o : { value: o, label: o }));
        control = `<select${attrs({ ...common, placeholder: null, autocomplete: f.autocomplete ?? null })}><option value="">${esc(f.placeholder ?? "Please choose…")}</option>${each(
          opts,
          (o) => `<option${attrs({ value: o.value ?? o.label })}>${esc(o.label ?? o.value)}</option>`,
        )}</select>`;
      } else {
        control = `<input${attrs({ ...common, type, inputmode: type === "tel" ? "tel" : null })}>`;
      }
      const wide = f.width ? f.width === "full" : type === "textarea";
      return `<div class="${cls("s-contact__field", wide && "s-contact__field--full")}"><label for="${esc(id)}">${esc(f.label ?? f.name)}${
        f.required ? ` <span class="s-contact__req" aria-hidden="true">*</span>` : ""
      }</label>${control}</div>`;
    };

    let form = "";
    const f = props.form;
    if (f?.action && f.fields?.length) {
      const honeypot = f.honeypot !== false
        ? `<div class="s-contact__hp" aria-hidden="true"><label>Leave this field empty<input type="text" name="${esc(f.honeypotName ?? "_gotcha")}" tabindex="-1" autocomplete="off"></label></div>`
        : "";
      let turnstile = "";
      if (props.turnstileSiteKey) {
        ctx.useScript("turnstile");
        turnstile = `<div class="cf-turnstile s-contact__turnstile"${attrs({ "data-turnstile": true, "data-sitekey": props.turnstileSiteKey })}></div>`;
      }
      const anyRequired = f.fields.some((x) => x.required);
      const httpMethod = String(f.method ?? "POST").toUpperCase() === "GET" ? "get" : "post";
      // action "worker" posts to the site Worker's /api/contact (see worker/contact.mjs).
      // The Worker 303s back to `_next`; by default that is this form's "sent"
      // notice, revealed by CSS :target so no JavaScript is needed.
      const worker = f.action === "worker";
      const action = worker ? ctx.api("/api/contact") : ctx.url(f.action);
      const sentId = ctx.uid("contact-sent");
      const nextHref = f.next ? ctx.url(f.next) : worker ? `#${sentId}` : null;
      const next = nextHref ? `<input type="hidden" name="_next" value="${esc(nextHref)}">` : "";
      const sent = worker && !f.next
        ? `<p class="s-contact__sent" id="${sentId}" role="status">${ctx.icon("check")}${esc(f.sentMessage ?? "Thanks — your message has been sent.")}</p>`
        : "";
      const privacyPath = ctx.site.compliance?.privacyPath;
      const privacyNote = privacyPath
        ? `<p class="s-contact__privacy muted">${esc(f.privacyText ?? "We only use these details to reply to you.")} See our <a href="${esc(ctx.url(privacyPath))}">privacy notice</a>.</p>`
        : "";
      form = `<form${attrs({ class: "s-contact__form card", action, method: httpMethod, "accept-charset": "UTF-8" })}>` +
        sent +
        `${f.heading ? `<h3 class="s-contact__form-title">${esc(f.heading)}</h3>` : ""}` +
        `${anyRequired ? `<p class="s-contact__hint" aria-hidden="true">* Required</p>` : ""}` +
        `<div class="s-contact__fields">${each(f.fields, field)}</div>${honeypot}${next}${turnstile}` +
        privacyNote +
        `<button type="submit" class="btn btn--primary s-contact__submit">${esc(f.submitLabel ?? "Send")}${ctx.icon("arrow-right")}</button></form>`;
    }

    const info = `<div class="s-contact__info">${ctx.sectionHead(props)}${props.body ? `<div class="s-contact__body">${ctx.blocks(props.body)}</div>` : ""}${
      props.methods?.length ? `<ul class="s-contact__methods">${each(props.methods, method)}</ul>` : ""
    }</div>`;

    return `<div class="${cls("s-contact__grid", form && "s-contact__grid--form", props.align === "center" && !form && "s-contact__grid--center")}">${info}${form}</div>`;
  },
};
