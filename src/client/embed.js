/*
 * Embed: click-to-load for third-party iframes (maps, videos, ...). Nothing is requested from
 * the third party until the visitor asks for it, so no data leaves the page by default
 * (UK/EU privacy). Any component can opt in by emitting the hooks below and calling
 * ctx.useScript("embed").
 *
 *   [data-embed]              Placeholder container (notice, button, fallback link). On load it
 *                             is replaced by the <iframe>, so size the box around it (e.g. a
 *                             parent with aspect-ratio) and style `iframe` inside that parent.
 *   [data-embed-load]         <button> inside [data-embed] that loads the embed on click.
 *     data-embed-url          Required iframe URL (must be https://).
 *     data-embed-title        Accessible iframe title (required for a11y; defaults to "Embedded content").
 *     data-embed-allow        Optional iframe `allow` value (e.g. "autoplay; fullscreen; picture-in-picture").
 *
 * The placeholder SHOULD also contain a plain <a> to the third-party page so it works without JS.
 * The iframe gets loading="lazy" and referrerpolicy="strict-origin-when-cross-origin", and
 * receives focus once inserted. No-op when no hooks are present.
 */
(function embed() {
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-embed-load]");
    if (!button) return;
    var src = button.getAttribute("data-embed-url") || "";
    if (!/^https:\/\//i.test(src)) return;
    var holder = button.closest("[data-embed]");
    if (!holder) return;
    event.preventDefault();

    var frame = document.createElement("iframe");
    frame.src = src;
    frame.title = button.getAttribute("data-embed-title") || "Embedded content";
    frame.setAttribute("loading", "lazy");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    var allow = button.getAttribute("data-embed-allow");
    if (allow) {
      frame.setAttribute("allow", allow);
      if (/fullscreen/.test(allow)) frame.setAttribute("allowfullscreen", "");
    }
    holder.replaceWith(frame);
    frame.focus();
  });
})();
