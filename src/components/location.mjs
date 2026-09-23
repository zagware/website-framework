import { attrs, cls, each, esc } from "../html.mjs";

const external = (href) => /^https?:\/\//.test(href);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** OpenStreetMap embed URL centred on lat/lng; bbox span derived from zoom. */
function osmEmbed(lat, lng, zoom) {
  const dLng = (360 / 2 ** zoom) * 1.5;
  const dLat = dLng * Math.cos((lat * Math.PI) / 180) * 0.6;
  const f = (n) => n.toFixed(5);
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map(f).join(",");
  return {
    src: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${f(lat)},${f(lng)}`,
    link: `https://www.openstreetmap.org/?mlat=${f(lat)}&mlon=${f(lng)}#map=${zoom}/${f(lat)}/${f(lng)}`,
  };
}

export default {
  type: "location",
  summary: "Venue/location split: photo or map, descriptive text, icon details (address, times, parking) and map links.",
  fullBleed: false,
  props: {
    image: { type: "string" },
    imageAlt: { type: "string" },
    body: { type: "string|array" },
    details: { type: "array" },
    mapQuery: { type: "string" },
    mapLabel: { type: "string" },
    embed: { type: "string" },
    lat: { type: "number" },
    lng: { type: "number" },
    zoom: { type: "number" },
    mapTitle: { type: "string" },
    reverse: { type: "boolean" },
  },
  example: {
    tone: "alt",
    eyebrow: "Getting there",
    heading: "Harbour Green, Ardglass",
    image: "img/sample-6.jpg",
    imageAlt: "Harbour Green with the sea wall and lighthouse behind",
    body: "The show field sits right on the harbour, a two-minute walk from the town centre.\n\nFree parking is signposted from the main road; please follow the marshals on arrival.",
    details: [
      { icon: "map-pin", label: "Address", text: "Harbour Road, Ardglass BT30 7TU" },
      { icon: "clock", label: "Open", text: "10am -- 5pm, Saturday 14 June" },
      { icon: "mail", label: "Questions?", text: "hello@example.com", href: "mailto:hello@example.com" },
    ],
    mapQuery: "Harbour Road, Ardglass BT30 7TU",
    embed: "osm",
    lat: 54.2636,
    lng: -5.6089,
    zoom: 15,
  },
  render(props, ctx) {
    const detail = (d) => {
      const text = d.href
        ? `<a${attrs({ href: ctx.url(d.href), rel: external(d.href) ? "noopener" : null })}>${esc(d.text)}</a>`
        : ctx.md(d.text);
      return `<li class="s-location__detail">${ctx.icon(d.icon ?? "info")}<span>${d.label ? `<strong>${esc(d.label)}</strong> ` : ""}${text}</span></li>`;
    };

    const lat = num(props.lat);
    const lng = num(props.lng);
    let map = "";
    let osmLink = "";
    if (props.embed === "osm" && lat !== null && lng !== null) {
      const zoom = Math.min(Math.max(Math.round(num(props.zoom) ?? 15), 3), 19);
      const osm = osmEmbed(lat, lng, zoom);
      const title = props.mapTitle ?? `Map showing ${props.heading ?? props.mapQuery ?? "the location"}`;
      map = `<div class="s-location__map"><iframe${attrs({
        src: osm.src,
        title,
        loading: "lazy",
        referrerpolicy: "no-referrer-when-downgrade",
      })}></iframe></div>`;
      osmLink = `<a class="btn btn--outline btn--sm" href="${esc(osm.link)}" rel="noopener">${ctx.icon("map-pin")}View larger map</a>`;
    }

    const media = props.image
      ? `<div class="s-location__image">${ctx.image(props.image, { alt: props.imageAlt ?? "", sizes: "(min-width: 900px) 45vw, 100vw" })}</div>`
      : "";

    const gmaps = props.mapQuery
      ? `<a class="btn btn--primary btn--sm" href="https://www.google.com/maps/search/?api=1&amp;query=${esc(encodeURIComponent(props.mapQuery))}" rel="noopener">${ctx.icon("external")}${esc(props.mapLabel ?? "Open in Google Maps")}</a>`
      : "";

    const text = `<div class="s-location__text">${ctx.sectionHead(props)}${props.body ? `<div class="s-location__body">${ctx.blocks(props.body)}</div>` : ""}${
      props.details?.length ? `<ul class="s-location__details">${each(props.details, detail)}</ul>` : ""
    }${gmaps || osmLink ? `<div class="btn-row s-location__actions">${gmaps}${osmLink}</div>` : ""}</div>`;

    const aside = media || map ? `<div class="s-location__media">${media}${map}</div>` : "";
    return `<div class="${cls("s-location__grid", !aside && "s-location__grid--single", props.reverse && "s-location__grid--reverse")}">${aside}${text}</div>`;
  },
};
