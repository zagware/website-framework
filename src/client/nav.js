/*
 * Mobile nav: the burger is a CSS-only checkbox (#nav-toggle), so the menu works
 * without JavaScript. This enhancement closes it after a link is chosen (same-page
 * anchors would otherwise leave it covering the content) and on Escape.
 */
var toggle = document.getElementById("nav-toggle");
if (toggle) {
  document.querySelectorAll(".site-nav__links a").forEach(function (a) {
    a.addEventListener("click", function () {
      toggle.checked = false;
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && toggle.checked) {
      toggle.checked = false;
      toggle.focus();
    }
  });
}
