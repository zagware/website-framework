/*
 * Lightbox: accessible <dialog>-based image viewer driven purely by data attributes,
 * so any component can opt in by emitting the hooks below and calling ctx.useScript("lightbox").
 *
 *   [data-lightbox-group]     Optional container. Its items form one prev/next sequence
 *                             (in document order). Items outside any group open alone.
 *   [data-lightbox-item]      <a> or <button> that opens the viewer on activation.
 *     data-full               Full-size image URL. Falls back to the element's href, so an
 *                             <a href="full.jpg"> still works without JavaScript.
 *     data-caption            Optional caption (plain text).
 *     data-alt                Optional alt text; defaults to the alt of the first <img> inside.
 *
 * Keyboard: Esc closes, ArrowLeft/ArrowRight step, Home/End jump. Swipe steps on touch.
 * Focus returns to the trigger on close. Modified clicks (ctrl/cmd/shift/middle) are left to
 * the browser. No-op when <dialog> is unsupported; nothing is built until an item is activated.
 */
(function lightbox() {
  if (typeof HTMLDialogElement !== "function") return;

  var ICON = function (d) {
    return '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
  };
  var CSS =
    ".z-lightbox{position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:var(--c-dark);color:var(--c-dark-text);overflow:hidden}" +
    ".z-lightbox[open]{display:grid;grid-template-rows:auto minmax(0,1fr) auto;animation:z-lightbox-in .2s ease}" +
    ".z-lightbox::backdrop{background:var(--c-dark)}" +
    ".z-lightbox__bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem 1rem}" +
    ".z-lightbox__count{margin:0;font-size:.9rem;color:var(--c-dark-muted)}" +
    ".z-lightbox__stage{position:relative;display:grid;place-items:center;min-height:0;overflow:hidden;padding:0 clamp(.5rem,6vw,4.5rem)}" +
    ".z-lightbox__img{max-width:100%;max-height:calc(100vh - 9rem);max-height:calc(100dvh - 9rem);width:auto;height:auto;object-fit:contain;border-radius:var(--radius)}" +
    ".z-lightbox__caption{margin:0;padding:.75rem 1rem 1.25rem;text-align:center;color:var(--c-dark-text)}" +
    ".z-lightbox__caption:empty{display:none}" +
    ".z-lightbox__btn{display:grid;place-items:center;width:2.75rem;height:2.75rem;border-radius:999px;border:0;cursor:pointer;background:var(--c-dark-text);color:var(--c-dark)}" +
    ".z-lightbox__btn:hover{background:var(--c-accent);color:var(--c-accent-contrast)}" +
    ".z-lightbox__btn[hidden]{display:none}" +
    ".z-lightbox__nav{position:absolute;top:50%;transform:translateY(-50%)}" +
    ".z-lightbox__nav--prev{left:.5rem}.z-lightbox__nav--next{right:.5rem}" +
    "@keyframes z-lightbox-in{from{opacity:0}to{opacity:1}}";

  var dialog, img, caption, count, prevBtn, nextBtn;
  var items = [];
  var index = 0;
  var trigger = null;
  var rootOverflow = "";

  function build() {
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    dialog = document.createElement("dialog");
    dialog.className = "z-lightbox";
    dialog.setAttribute("aria-label", "Image viewer");
    dialog.innerHTML =
      '<div class="z-lightbox__bar"><p class="z-lightbox__count" aria-live="polite"></p>' +
      '<button type="button" class="z-lightbox__btn" data-lb="close" aria-label="Close">' + ICON("M18 6L6 18M6 6l12 12") + "</button></div>" +
      '<div class="z-lightbox__stage">' +
      '<button type="button" class="z-lightbox__btn z-lightbox__nav z-lightbox__nav--prev" data-lb="prev" aria-label="Previous image">' + ICON("M15 18l-6-6 6-6") + "</button>" +
      '<img class="z-lightbox__img" alt="" decoding="async">' +
      '<button type="button" class="z-lightbox__btn z-lightbox__nav z-lightbox__nav--next" data-lb="next" aria-label="Next image">' + ICON("M9 18l6-6-6-6") + "</button>" +
      "</div>" +
      '<p class="z-lightbox__caption"></p>';
    document.body.appendChild(dialog);

    img = dialog.querySelector(".z-lightbox__img");
    caption = dialog.querySelector(".z-lightbox__caption");
    count = dialog.querySelector(".z-lightbox__count");
    prevBtn = dialog.querySelector('[data-lb="prev"]');
    nextBtn = dialog.querySelector('[data-lb="next"]');

    dialog.addEventListener("click", function (event) {
      var action = event.target.closest("[data-lb]");
      if (action) {
        var name = action.getAttribute("data-lb");
        if (name === "close") dialog.close();
        else step(name === "next" ? 1 : -1);
        return;
      }
      // Clicking the empty scrim around the image closes, like most viewers.
      if (event.target === dialog || event.target.classList.contains("z-lightbox__stage")) dialog.close();
    });

    dialog.addEventListener("keydown", function (event) {
      if (items.length < 2) return;
      var key = event.key;
      if (key === "ArrowRight") step(1);
      else if (key === "ArrowLeft") step(-1);
      else if (key === "Home") show(0);
      else if (key === "End") show(items.length - 1);
      else return;
      event.preventDefault();
    });

    var startX = null;
    dialog.addEventListener("pointerdown", function (event) {
      startX = event.pointerType === "mouse" ? null : event.clientX;
    });
    dialog.addEventListener("pointerup", function (event) {
      if (startX === null) return;
      var dx = event.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50 && items.length > 1) step(dx < 0 ? 1 : -1);
    });

    dialog.addEventListener("close", function () {
      document.documentElement.style.overflow = rootOverflow;
      img.removeAttribute("src");
      if (trigger && document.contains(trigger)) trigger.focus();
      trigger = null;
    });
  }

  function source(el) {
    return el.getAttribute("data-full") || el.getAttribute("href") || "";
  }

  function altFor(el) {
    if (el.hasAttribute("data-alt")) return el.getAttribute("data-alt");
    var inner = el.querySelector("img");
    return inner ? inner.getAttribute("alt") || "" : "";
  }

  function show(i) {
    var n = items.length;
    index = ((i % n) + n) % n;
    var el = items[index];
    img.src = source(el);
    img.alt = altFor(el);
    caption.textContent = el.getAttribute("data-caption") || "";
    count.textContent = n > 1 ? index + 1 + " / " + n : "";
    // Warm the cache for the neighbours so stepping feels instant.
    if (n > 1) {
      [items[(index + 1) % n], items[(index - 1 + n) % n]].forEach(function (near) {
        new Image().src = source(near);
      });
    }
  }

  function step(delta) {
    show(index + delta);
  }

  function open(el) {
    if (!dialog) build();
    var group = el.closest("[data-lightbox-group]");
    items = group
      ? Array.prototype.filter.call(group.querySelectorAll("[data-lightbox-item]"), function (item) {
          return source(item) && item.closest("[data-lightbox-group]") === group;
        })
      : [el];
    trigger = el;
    var single = items.length < 2;
    prevBtn.hidden = single;
    nextBtn.hidden = single;
    show(Math.max(0, items.indexOf(el)));
    rootOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    dialog.showModal();
    dialog.querySelector('[data-lb="close"]').focus();
  }

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var el = event.target.closest && event.target.closest("[data-lightbox-item]");
    if (!el || !source(el)) return;
    event.preventDefault();
    open(el);
  });
})();
