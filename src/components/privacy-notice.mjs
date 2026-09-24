import { each, esc } from "../html.mjs";

// Privacy notice generated from what the site actually does (site.compliance,
// derived at build time from config: forms, shop, analytics, declared third
// parties). Wording is a template for UK/EU GDPR: the customer (data controller)
// must review it before launch — see docs/PRIVACY.md.

const REGULATORS = {
  ico: {
    name: "the Information Commissioner's Office (ICO)",
    href: "https://ico.org.uk/make-a-complaint/",
  },
  dpc: {
    name: "the Data Protection Commission (Ireland)",
    href: "https://www.dataprotection.ie/",
  },
};

const link = (href, label) => `<a href="${esc(href)}" rel="noopener">${esc(label)}</a>`;

export default {
  type: "privacy-notice",
  summary: "Privacy notice generated from what the site really collects (forms, shop, analytics, third parties); linked from the footer, forms and basket.",
  fullBleed: false,
  props: {
    hostingName: { type: "string" },
    storageRegion: { type: "string" },
  },
  example: { heading: "Privacy notice" },
  render(p, ctx) {
    const c = ctx.site.compliance;
    const owner = c.controller ?? {};
    const shop = Boolean(ctx.site.commerce);
    const forms = c.forms;
    const workerForms = forms.filter((f) => f.destination === "worker");
    const externalForms = forms.filter((f) => f.destination !== "worker");
    const hosting = p.hostingName ?? "Cloudflare";
    const region = p.storageRegion ? ` (${esc(p.storageRegion)})` : "";
    const analytics = c.thirdParties.find((t) => t.host === "static.cloudflareinsights.com");
    const regulator = REGULATORS[c.regulator] ?? REGULATORS.ico;
    const contactLine = owner.email ? `<a href="mailto:${esc(owner.email)}">${esc(owner.email)}</a>` : "us";

    const processors = [
      { name: hosting, purpose: `Website hosting and security${workerForms.length || shop ? "; stores contact messages and order records" : ""}`, policyUrl: "https://www.cloudflare.com/privacypolicy/" },
      ...(shop ? [{ name: "Stripe", purpose: "Takes payments and sends receipts; card details go directly to Stripe", policyUrl: "https://stripe.com/gb/privacy" }] : []),
      ...c.thirdParties,
    ];

    const sections = [];
    sections.push([
      "Who we are",
      `<p>${esc(owner.name ?? ctx.site.name)} is responsible for the personal information collected through this website (the "data controller").${
        owner.address ? ` Our address is ${esc(owner.address)}.` : ""
      } Contact us about anything in this notice at ${contactLine}${owner.phone ? ` or ${esc(owner.phone)}` : ""}.${
        c.registration ? ` Our data protection registration number is ${esc(c.registration)}.` : ""
      }</p>`,
    ]);

    const collect = [
      `<li><strong>Visiting the site.</strong> Our hosting provider, ${esc(hosting)}, processes your IP address and browser details to deliver pages and protect the site from attacks. We do not use this to identify you. Lawful basis: our legitimate interest in running a secure website.</li>`,
    ];
    if (workerForms.length || externalForms.length) {
      const fields = [...new Set(forms.flatMap((f) => f.fields))].join(", ");
      const where = [
        workerForms.length && `stored in our website's database, hosted by ${esc(hosting)}${region}, and may be emailed to us`,
        externalForms.length && `sent to ${externalForms.map((f) => esc(f.destination)).join(", ")}, which processes it for us`,
      ]
        .filter(Boolean)
        .join("; ");
      collect.push(
        `<li><strong>Contact form.</strong> What you enter (${esc(fields)}) is ${where}. We use it only to reply to you. Lawful basis: our legitimate interest in answering your enquiry, or taking steps at your request before a contract.</li>`,
      );
    }
    if (shop) {
      collect.push(
        `<li><strong>Orders.</strong> When you buy, Stripe collects your name, email, delivery address and payment details on its secure checkout page. We receive your name, email, delivery address, what you bought and the payment status — never your card details. Lawful basis: to perform our contract with you, and to meet our legal obligation to keep accounting records.</li>`,
      );
    }
    sections.push(["What we collect and why", `<ul>${collect.join("")}</ul>`]);

    const storage = [
      `<li>This website does not use cookies for analytics, advertising or tracking.</li>`,
      shop &&
        `<li>Your basket is saved in your browser's local storage (not a cookie) so it is still there when you come back. It stays on your device and is only sent to us when you check out. It is cleared after your order, or you can clear it in your browser settings. This is strictly necessary for the basket you asked for, so no consent is needed.</li>`,
      `<li>${esc(hosting)} may set strictly necessary security cookies (such as <code>__cf_bm</code> or <code>cf_clearance</code>) when it needs to check that traffic is not automated. These are not used to track you.</li>`,
      analytics &&
        `<li>We use ${esc(analytics.name)} to count visits and see which pages are popular. It does not use cookies or collect data that identifies you, and it does not follow you across other websites.</li>`,
    ].filter(Boolean);
    sections.push(["Cookies and similar technologies", `<ul>${storage.join("")}</ul>`]);

    sections.push([
      "Who we share it with",
      `<p>We never sell your information. We use these service providers, who act on our instructions:</p><ul>${each(
        processors,
        (t) => `<li><strong>${esc(t.name)}</strong> — ${esc(t.purpose)}${t.policyUrl ? ` (${link(t.policyUrl, "privacy policy")})` : ""}</li>`,
      )}</ul><p>Some providers may process data outside the UK or EEA. When they do, they rely on legal safeguards such as adequacy decisions or standard contractual clauses.</p>`,
    ]);

    const keep = [
      (workerForms.length || externalForms.length) && `<li>Contact messages: ${esc(c.retention.messages)}.</li>`,
      shop && `<li>Order records: ${esc(c.retention.orders)}.</li>`,
      `<li>Hosting security logs: kept for short periods by ${esc(hosting)}.</li>`,
    ].filter(Boolean);
    sections.push(["How long we keep it", `<ul>${keep.join("")}</ul>`]);

    sections.push([
      "Your rights",
      `<p>You can ask for a copy of your information, and ask us to correct it, delete it, restrict or object to how we use it, or transfer it to someone else. Email ${contactLine}. We will reply within one month.</p>
<p>If you are unhappy with how we have handled your information, you can complain to ${link(regulator.href, regulator.name)}. We would appreciate the chance to put things right first.</p>`,
    ]);

    for (const x of c.extra) sections.push([x.heading, ctx.blocks(x.body)]);

    const head = ctx.sectionHead({ ...p, heading: p.heading ?? "Privacy notice" });
    return `${head}<div class="s-privacy">${sections
      .map(([h, body]) => `<section class="s-privacy__part"><h3>${esc(h)}</h3>${body}</section>`)
      .join("\n")}${c.updated ? `<p class="muted s-privacy__updated">Last updated: ${esc(c.updated)}</p>` : ""}</div>`;
  },
};
