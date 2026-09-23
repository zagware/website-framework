import { attrs, cls, each } from "../html.mjs";

// object-position values only: keywords, numbers, %, px. Anything else is dropped.
const focal = (value) => (value && /^[a-z0-9.%\s-]+$/i.test(String(value)) ? String(value) : null);

export default {
  type: "gallery",
  summary: "Responsive photo grid with captions, wide tiles, focal points and an accessible lightbox.",
  fullBleed: false,
  props: {
    images: { type: "array", required: true },
    columns: { type: "number" },
    lightbox: { type: "boolean" },
  },
  example: {
    eyebrow: "Gallery",
    heading: "Scenes from last year",
    intro: "Tap any photo to view it full size.",
    columns: 3,
    images: [
      { src: "img/sample-1.jpg", alt: "Classic cars lined up along the harbour front", caption: "The harbour line-up", wide: true },
      { src: "img/portrait-1.jpg", alt: "Driver polishing a chrome bumper", focal: "50% 30%" },
      { src: "img/sample-2.jpg", alt: "Crowd admiring a red roadster", caption: "Crowd favourite" },
      { src: "img/sample-3.jpg", alt: "Close-up of a vintage dashboard" },
      { src: "img/sample-4.jpg", alt: "Cars driving along the coast road at sunset", caption: "The evening run" },
      { src: "img/portrait-2.jpg", alt: "Child sitting in the driver's seat of a vintage car" },
    ],
  },
  render(props, ctx) {
    const lightbox = props.lightbox !== false;
    if (lightbox) ctx.useScript("lightbox");
    const cols = Math.min(Math.max(Math.round(props.columns ?? 3), 1), 6);
    const sizesFor = (span) => `(min-width: 900px) ${Math.round((100 * Math.min(span, cols)) / cols)}vw, (min-width: 560px) ${span > 1 ? 100 : 50}vw, 100vw`;

    const figure = (img) => {
      const wide = img.wide && cols > 1;
      const pic = ctx.image(img.src, { alt: img.alt ?? "", sizes: sizesFor(wide ? 2 : 1) });
      const media = lightbox
        ? `<a${attrs({
            class: "s-gallery__media",
            href: ctx.asset(img.src),
            "data-lightbox-item": true,
            "data-caption": img.caption ?? null,
          })}>${pic}<span class="s-gallery__zoom">${ctx.icon("expand")}<span class="visually-hidden">View full size</span></span></a>`
        : `<div class="s-gallery__media">${pic}</div>`;
      const pos = focal(img.focal);
      return `<figure${attrs({
        class: cls("s-gallery__item", wide && "s-gallery__item--wide"),
        style: pos ? `--focal: ${pos}` : null,
      })}>${media}${img.caption ? `<figcaption>${ctx.md(img.caption)}</figcaption>` : ""}</figure>`;
    };

    return `${ctx.sectionHead(props)}<div${attrs({
      class: "s-gallery__grid",
      style: `--cols: ${cols}; --cols-md: ${Math.min(cols, 2)}`,
      "data-lightbox-group": lightbox,
    })}>${each(props.images, figure)}</div>`;
  },
};
