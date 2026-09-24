import { cls, each, esc } from "../html.mjs";

const ratingOf = (q) => {
  const n = Number(q.rating);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5) : null;
};

export default {
  type: "quote",
  summary: "One large testimonial, or a grid of testimonials; star ratings add schema.org Review data.",
  fullBleed: false,
  props: {
    text: { type: "string" },
    author: { type: "string" },
    role: { type: "string" },
    image: { type: "string" },
    background: { type: "string" },
    rating: { type: "number" },
    testimonials: { type: "array" },
  },
  example: {
    eyebrow: "Kind words",
    heading: "What people say",
    align: "center",
    testimonials: [
      { text: "Brilliant day out -- the kids loved sitting in the old cars and the harbour setting is stunning.", author: "Aoife M.", role: "Visitor, 2025", image: "img/portrait-1.jpg", rating: 5 },
      { text: "The best-organised show I've entered. Friendly marshals, a great route and a proper cup of tea at the end.", author: "Gerry D.", role: "1967 MGB owner", image: "img/portrait-2.jpg", rating: 5 },
      { text: "Raised more for the RNLI than we ever hoped. Thank you to everyone who came along.", author: "Ardglass RNLI", role: "Charity partner" },
    ],
  },
  render(props, ctx) {
    const figure = (q, large) => {
      const rating = ratingOf(q);
      if (rating) {
        ctx.addJsonLd({
          "@type": "Review",
          reviewBody: String(q.text ?? ""),
          author: { "@type": "Person", name: String(q.author ?? "Anonymous") },
          reviewRating: { "@type": "Rating", ratingValue: rating, bestRating: 5, worstRating: 1 },
          ...(ctx.site?.name ? { itemReviewed: { "@type": "Organization", name: ctx.site.name, url: ctx.abs("/") } } : {}),
        });
      }
      const stars = rating
        ? `<p class="s-quote__stars"><span aria-hidden="true">${"★".repeat(Math.round(rating))}${"☆".repeat(5 - Math.round(rating))}</span><span class="visually-hidden">Rated ${rating} out of 5</span></p>`
        : "";
      const avatar = q.image
        ? `<span class="s-quote__avatar">${ctx.image(q.image, { alt: "", sizes: large ? "72px" : "56px", width: large ? 72 : 56, height: large ? 72 : 56 })}</span>`
        : "";
      const who = q.author || q.role
        ? `<figcaption class="s-quote__by">${avatar}<span>${q.author ? `<cite class="s-quote__author">${esc(q.author)}</cite>` : ""}${q.role ? `<span class="s-quote__role">${ctx.md(q.role)}</span>` : ""}</span></figcaption>`
        : "";
      return `<figure class="${cls("s-quote__item", large ? "s-quote__item--large" : "card")}">${stars}<blockquote class="s-quote__text">${ctx.blocks(q.text)}</blockquote>${who}</figure>`;
    };

    const head = ctx.sectionHead(props);
    if (props.testimonials?.length) {
      return `${head}<div class="s-quote__grid">${each(props.testimonials, (q) => figure(q, false))}</div>`;
    }
    // background: a decorative full-width photo behind a single large quote (white text on a dark overlay).
    const bg = props.background
      ? `<div class="s-quote__bg" aria-hidden="true">${ctx.image(props.background, { alt: "", sizes: "100vw" })}</div>`
      : "";
    return `${bg}<div class="${props.background ? "s-quote__over" : ""}">${head}${figure(props, true)}</div>`;
  },
};
