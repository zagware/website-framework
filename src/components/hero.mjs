import { attrs, each, esc } from "../html.mjs";

const HEIGHTS = new Set(["full", "large", "medium", "compact"]);

export const actionButtons = (actions, ctx) =>
  actions?.length
    ? `<div class="btn-row">${each(
        actions,
        (a) =>
          `<a class="btn btn--${esc(a.style ?? "primary")}" href="${esc(ctx.url(a.href))}"${
            /^https?:/.test(a.href) ? ' rel="noopener"' : ""
          }>${esc(a.label)}${a.icon ? ctx.icon(a.icon) : ""}</a>`,
      )}</div>`
    : "";

export default {
  type: "hero",
  summary: "Full-bleed page header: background image or looping video, headline, badge, calls to action, optional aside card.",
  fullBleed: true,
  props: {
    title: { type: "string", required: true },
    lede: { type: "string" },
    badge: { type: "string" },
    actions: { type: "array" },
    image: { type: "string" },
    imageAlt: { type: "string" },
    video: { type: "object" },
    overlay: { type: "number" },
    height: { type: "string" },
    aside: { type: "object" },
  },
  example: {
    eyebrow: "Carlingford · Co. Louth",
    title: "Build *something* worth visiting",
    lede: "A hero with a background photo, a darkening overlay, a date badge and two calls to action.",
    badge: "Saturday 14 March 2027",
    image: "img/sample-1.jpg",
    imageAlt: "",
    actions: [
      { label: "Get started", href: "/#contact", style: "accent" },
      { label: "Learn more", href: "/#about", style: "outline" },
    ],
    aside: { image: "img/portrait-1.jpg", caption: "Scan to visit", alt: "QR code" },
  },
  render(p, ctx) {
    const height = HEIGHTS.has(p.height) ? p.height : "large";
    const overlay = Math.min(Math.max(p.overlay ?? (p.image || p.video ? 0.55 : 0), 0), 0.9);
    const media = p.image || p.video;
    const bg = [
      p.image &&
        ctx.image(p.image, { alt: p.imageAlt ?? "", class: "hero__img", loading: "eager", fetchpriority: "high", sizes: "100vw" }),
      p.video &&
        `<video class="hero__video"${attrs({
          autoplay: true,
          muted: true,
          loop: true,
          playsinline: true,
          preload: "metadata",
          poster: p.video.poster ? ctx.asset(p.video.poster) : null,
          "aria-hidden": "true",
        })}><source src="${esc(ctx.asset(p.video.src))}" type="video/mp4"></video>`,
    ]
      .filter(Boolean)
      .join("");
    const aside = p.aside
      ? `<figure class="hero__aside">${p.aside.href ? `<a href="${esc(ctx.url(p.aside.href))}">` : ""}${ctx.image(p.aside.image, {
          alt: p.aside.alt ?? "",
          sizes: "160px",
        })}${p.aside.href ? "</a>" : ""}${p.aside.caption ? `<figcaption>${esc(p.aside.caption)}</figcaption>` : ""}</figure>`
      : "";
    return `<div class="hero hero--${height}${media ? " hero--media" : ""}${p.align === "center" ? " hero--center" : ""}" style="--overlay:${overlay}">
${media ? `<div class="hero__bg">${bg}</div>` : ""}
<div class="wrap hero__inner">
<div class="hero__content">
${p.eyebrow ? `<span class="eyebrow">${esc(p.eyebrow)}</span>` : ""}
<h1>${ctx.md(p.title)}</h1>
${p.badge ? `<p class="hero__badge">${ctx.icon("calendar")}${esc(p.badge)}</p>` : ""}
${p.lede ? `<p class="hero__lede">${ctx.md(p.lede)}</p>` : ""}
${actionButtons(p.actions, ctx)}
</div>
${aside}
</div>
</div>`;
  },
};
