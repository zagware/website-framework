import { each, esc } from "../html.mjs";

export default {
  type: "table",
  summary: "Data or comparison table with row headers, yes/no ticks and horizontal scrolling on small screens.",
  fullBleed: false,
  props: {
    caption: { type: "string" },
    headers: { type: "array", required: true },
    rows: { type: "array", required: true },
    note: { type: "string" },
  },
  example: {
    eyebrow: "Entry",
    heading: "Choose your class",
    caption: "Entry classes and what's included",
    headers: ["Class", "Price", "Rally plaque", "Parking on the green", "Lunch"],
    rows: [
      ["Spectator", "Free", false, false, false],
      ["Show car", "£15", true, true, false],
      ["Show car + run", "£25", true, true, true],
      ["Club stand (5+ cars)", "£60", true, true, "**Optional** extra"],
    ],
    note: "Prices per vehicle. Entries close on **31 May**; see the [entry form](/#faq) for details.",
  },
  render(props, ctx) {
    const cell = (value) => {
      if (value === true) return `${ctx.icon("check")}<span class="visually-hidden">Yes</span>`;
      if (value === false) return `<span aria-hidden="true">&ndash;</span><span class="visually-hidden">No</span>`;
      return ctx.md(value == null ? "" : String(value));
    };
    const tick = (value) => (typeof value === "boolean" ? ` class="s-table__tick"` : "");
    const row = (cells) => {
      const [first, ...rest] = Array.isArray(cells) ? cells : [cells];
      return `<tr><th scope="row">${cell(first)}</th>${each(rest, (v) => `<td${tick(v)}>${cell(v)}</td>`)}</tr>`;
    };
    const id = ctx.uid("table");
    const label = props.caption ? `aria-labelledby="${id}"` : `aria-label="${esc(props.heading ?? "Data table")}"`;
    return `${ctx.sectionHead(props)}<div class="s-table__scroll" role="region" tabindex="0" ${label}><table class="s-table__table" style="--cols:${props.headers.length}">` +
      `${props.caption ? `<caption id="${id}">${ctx.md(props.caption)}</caption>` : ""}` +
      `<thead><tr>${each(props.headers, (h) => `<th scope="col">${ctx.md(String(h ?? ""))}</th>`)}</tr></thead>` +
      `<tbody>${each(props.rows, row)}</tbody></table></div>` +
      `${props.note ? `<p class="s-table__note">${ctx.md(props.note)}</p>` : ""}`;
  },
};
