/*
 * Turnstile loader: injects Cloudflare's Turnstile API once when the page has a widget.
 *
 *   div.cf-turnstile[data-turnstile][data-sitekey]   Widget placeholder inside a <form>.
 *     Turnstile renders implicitly into every .cf-turnstile and adds a hidden
 *     `cf-turnstile-response` input for the endpoint to verify server-side.
 *
 * No-op when no [data-turnstile] element exists or the API script is already present.
 */
(function turnstile() {
  var SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  if (!document.querySelector("[data-turnstile]")) return;
  if (window.turnstile || document.querySelector('script[src^="' + SRC + '"]')) return;
  var script = document.createElement("script");
  script.src = SRC;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
})();
