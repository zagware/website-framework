// Page chrome shared by every page: skip link, preview banner, nav, footer.

import { attrs, each, esc } from "./html.mjs";

const SOCIAL_LABEL = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  strava: "Strava",
  whatsapp: "WhatsApp",
};

function socialLinks(site, ctx) {
  return each(
    site.socials,
    (s) =>
      `<a href="${esc(s.href)}" rel="noopener" aria-label="${esc(s.label ?? SOCIAL_LABEL[s.network] ?? s.network)}">${ctx.icon(s.network)}</a>`,
  );
}

function isCurrent(href, page) {
  if (!href.startsWith("/") || href.includes("#")) return false;
  return href === page.path;
}

export function renderNav(site, page, ctx) {
  const brand = site.logo
    ? `${ctx.image(site.logo.src, { alt: "", loading: "eager", class: "site-nav__logo", width: site.logo.width, height: site.logo.height })}<span>${esc(site.name)}</span>`
    : `<span>${esc(site.name)}</span>`;
  const links = each(
    site.nav,
    (item) =>
      `<li><a${attrs({ href: ctx.url(item.href), "aria-current": isCurrent(item.href, page) ? "page" : null })}>${esc(item.label)}</a></li>`,
  );
  const cta = site.navCta
    ? `<li><a class="btn btn--accent btn--sm" href="${esc(ctx.url(site.navCta.href))}">${esc(site.navCta.label)}</a></li>`
    : "";
  const cart = site.commerce
    ? `<a class="cart-link" href="${esc(ctx.url(site.commerce.cartPath))}" data-cart-link aria-label="Basket">${ctx.icon("cart")}<span class="cart-link__count" data-cart-count></span></a>`
    : "";
  if (site.nav.length || site.navCta) ctx.useScript("nav");
  const burger = site.nav.length || site.navCta
    ? `<input class="site-nav__toggle visually-hidden" type="checkbox" id="nav-toggle" aria-label="Show menu">
<label class="site-nav__burger" for="nav-toggle" aria-hidden="true">${ctx.icon("menu")}</label>
<ul class="site-nav__links">${links}${cta}</ul>`
    : "";
  return `<header class="site-nav">
<nav class="wrap site-nav__inner" aria-label="Main">
<a class="site-nav__brand" href="${esc(ctx.url("/"))}">${brand}</a>
${burger}
<div class="site-nav__social">${socialLinks(site, ctx)}</div>
${cart}
</nav>
</header>`;
}

export function renderFooter(site, ctx) {
  const f = site.footer;
  const year = new Date().getUTCFullYear();
  const links = f.links?.length
    ? `<ul class="site-footer__links">${each(f.links, (l) => `<li><a href="${esc(ctx.url(l.href))}">${esc(l.label)}</a></li>`)}</ul>`
    : "";
  const sponsors = f.sponsors?.length
    ? `<div class="site-footer__sponsors"><h2>${esc(f.sponsorsHeading ?? "Supported by")}</h2><ul>${each(
        f.sponsors,
        (s) => {
          const inner = s.logo ? ctx.image(s.logo, { alt: s.name }) : esc(s.name);
          return `<li>${s.href ? `<a href="${esc(s.href)}" rel="noopener">${inner}</a>` : `<span>${inner}</span>`}</li>`;
        },
      )}</ul></div>`
    : "";
  const brand = site.logo ? ctx.image(site.logo.src, { alt: "", width: site.logo.width, height: site.logo.height }) : "";
  const credit = f.credit
    ? ` · Built by <a href="https://zagware.io" rel="noopener">zagware.io</a>`
    : "";
  return `<footer class="site-footer">
<div class="wrap">
<div class="site-footer__top">
<div><div class="site-footer__brand">${brand}<span>${esc(site.name)}</span></div>${f.text ? `<p class="muted">${ctx.md(f.text)}</p>` : ""}</div>
${links}
<div class="site-footer__social">${socialLinks(site, ctx)}</div>
</div>
${sponsors}
<div class="site-footer__bottom"><span>© ${year} ${esc(f.owner ?? site.name)}${credit}</span>${f.smallprint ? `<span>${ctx.md(f.smallprint)}</span>` : ""}</div>
</div>
</footer>`;
}

export function renderSection(section, comp, ctx) {
  const tone = section.tone ?? "default";
  const inner = comp.render(section, ctx);
  const body = comp.fullBleed ? inner : `<div class="wrap">${inner}</div>`;
  return `<section${attrs({
    id: section.id,
    class: ["band", tone !== "default" && `band--${tone}`, `s-${section.type}`, section.class].filter(Boolean).join(" "),
  })}>
${body}
</section>`;
}
