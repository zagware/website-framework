import { attrs, each, esc } from "../html.mjs";

const TYPES = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg" };
const mime = (src) => TYPES[/\.([a-z0-9]+)(?:[?#].*)?$/i.exec(String(src))?.[1]?.toLowerCase()] ?? null;
// Site asset path ("video/a.mp4") → ctx.asset; root-relative, anchors and absolute URLs → ctx.url.
const href = (ctx, value) => (/^(\/|#|[a-z][a-z0-9+.-]*:)/i.test(value) ? ctx.url(value) : ctx.asset(value));

export default {
  type: "videos",
  summary: "Video grid with posters and captions, plus an optional track of muted looping clips that play when visible.",
  fullBleed: false,
  props: {
    videos: { type: "array" },
    clips: { type: "array" },
    clipsLabel: { type: "string" },
  },
  example: {
    eyebrow: "Watch",
    heading: "On film",
    intro: "Highlights from the 2025 rally, filmed by our volunteers.",
    videos: [
      { src: "video/sample.mp4", poster: "video/sample-poster.jpg", title: "Rally highlights", caption: "Three minutes of the best moments." },
      { src: "video/sample.mp4", poster: "img/sample-5.jpg", title: "The coast road run" },
    ],
    clipsLabel: "Quick clips",
    clips: [
      { src: "video/sample.mp4", poster: "video/sample-poster.jpg" },
      { src: "video/sample.mp4", poster: "img/sample-2.jpg" },
      { src: "video/sample.mp4", poster: "img/sample-3.jpg" },
      { src: "video/sample.mp4", poster: "img/sample-6.jpg" },
    ],
  },
  render(props, ctx) {
    const video = (v) => {
      const src = href(ctx, v.src);
      const label = v.title ?? v.caption ?? null;
      return `<figure class="s-videos__item"><div class="s-videos__frame"><video${attrs({
        controls: true,
        preload: "none",
        playsinline: true,
        poster: v.poster ? href(ctx, v.poster) : null,
        "aria-label": label,
      })}><source${attrs({ src, type: mime(v.src) })}><a href="${esc(src)}">Download the video${label ? `: ${esc(label)}` : ""}</a></video></div>${
        v.title || v.caption
          ? `<figcaption>${v.title ? `<h3 class="s-videos__title">${ctx.md(v.title)}</h3>` : ""}${v.caption ? `<p class="muted">${ctx.md(v.caption)}</p>` : ""}</figcaption>`
          : ""
      }</figure>`;
    };

    const clip = (c) =>
      `<li class="s-videos__clip"><video${attrs({
        muted: true,
        loop: true,
        playsinline: true,
        preload: "none",
        poster: c.poster ? href(ctx, c.poster) : null,
        "aria-hidden": "true",
        tabindex: "-1",
        "data-clip": true,
      })}><source${attrs({ src: href(ctx, c.src), type: mime(c.src) })}></video></li>`;

    let clips = "";
    if (props.clips?.length) {
      ctx.useScript("clips");
      const id = ctx.uid("clips");
      const title = `<h3${attrs({ class: props.clipsLabel ? "s-videos__clips-title" : "visually-hidden", id })}>${esc(props.clipsLabel ?? "Short clips")}</h3>`;
      clips = `<div class="s-videos__clips" data-clips><div class="s-videos__clips-head">${title}` +
        `<button type="button" class="btn btn--outline btn--sm" data-clips-toggle hidden>Pause clips</button></div>` +
        `<ul class="s-videos__track" role="list" tabindex="0" aria-labelledby="${id}">${each(props.clips, clip)}</ul></div>`;
    }

    const grid = props.videos?.length ? `<div class="s-videos__grid">${each(props.videos, video)}</div>` : "";
    return `${ctx.sectionHead(props)}${grid}${clips}`;
  },
};
