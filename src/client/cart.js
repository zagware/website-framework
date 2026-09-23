/*
 * Basket for stripe-lite commerce. Plain browser JS, no dependencies.
 *
 *   #zsite-commerce          JSON config from the engine: { apiBase, currency, locale, mode,
 *                            cartPath, catalogUrl, siteRoot, storageKey }. Absent → no-op.
 *   [data-cart-count]        Badge text = total quantity ("" when empty; CSS hides :empty).
 *   [data-cart-link]         aria-label kept in sync with the count.
 *   form > [data-add-to-cart][data-product-id]
 *                            Submit adds the product with its [data-option] <select>s and
 *                            [data-qty] input; feedback goes to the form's [data-cart-status].
 *   [data-cart-root]         Basket UI (data-continue-href, data-continue-label, data-empty-text).
 *   [data-cart-clear]        Stripe success page: empties the basket when ?session_id= is present.
 *
 * Storage: localStorage[storageKey] = { v: 1, items: [{ id, qty, options }], rate }.
 * Prices shown here are display only; the Worker re-prices every checkout from the catalog.
 */
(function cart() {
  var configEl = document.getElementById("zsite-commerce");
  if (!configEl) return;
  var config;
  try {
    config = JSON.parse(configEl.textContent);
  } catch (e) {
    return;
  }

  var MAX_QTY = 99;
  var locale = config.locale || "en-GB";
  var fmt = new Intl.NumberFormat(locale, { style: "currency", currency: config.currency || "GBP" });
  var money = function (minor) {
    return fmt.format(minor / 100);
  };
  // Basket thumbnails resolve against this deployment's root (preview, local or production).
  var siteRoot = new URL(config.siteRoot || "/", location.href);
  var thumbUrl = function (product) {
    return product.thumb ? new URL(product.thumb, siteRoot).href : product.image;
  };
  var ENT = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ENT[c];
    });
  };

  /* ---------- storage ---------- */
  var memory = null;
  function validItem(x) {
    return (
      x && typeof x.id === "string" && Number.isInteger(x.qty) && x.qty >= 1 && x.qty <= MAX_QTY &&
      (x.options == null || (typeof x.options === "object" && !Array.isArray(x.options)))
    );
  }
  function readStore() {
    var raw = memory;
    try {
      raw = localStorage.getItem(config.storageKey);
    } catch (e) {}
    try {
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.items)) {
        return { items: data.items.filter(validItem), rate: typeof data.rate === "string" ? data.rate : null };
      }
    } catch (e) {}
    return { items: [], rate: null };
  }
  function writeStore() {
    memory = JSON.stringify({ v: 1, items: state.items, rate: state.rate });
    try {
      localStorage.setItem(config.storageKey, memory);
    } catch (e) {}
  }

  var state = readStore();
  var catalog = null;
  var catalogFailed = false;
  var catalogPromise = null;
  var attemptKey = null;
  var busy = false;
  var notice = "";

  function optionsKey(options) {
    return Object.keys(options || {})
      .sort()
      .map(function (k) {
        return k + "=" + options[k];
      })
      .join("&");
  }
  function sameLine(a, b) {
    return a.id === b.id && optionsKey(a.options) === optionsKey(b.options);
  }
  function count() {
    return state.items.reduce(function (n, i) {
      return n + i.qty;
    }, 0);
  }

  function updateCount() {
    var n = count();
    document.querySelectorAll("[data-cart-count]").forEach(function (el) {
      el.textContent = n ? String(n) : "";
    });
    document.querySelectorAll("[data-cart-link]").forEach(function (el) {
      el.setAttribute("aria-label", n ? "Basket, " + n + " item" + (n === 1 ? "" : "s") : "Basket");
    });
  }

  /** Persist, refresh badges and basket views. Any change invalidates the checkout attempt key. */
  function commit(message) {
    attemptKey = null;
    notice = "";
    writeStore();
    updateCount();
    scheduleRender();
    if (message) announce(message);
  }

  /* ---------- catalog + display pricing (mirrors priceCart in src/commerce.mjs) ---------- */
  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetch(config.catalogUrl, { headers: { Accept: "application/json" } })
        .then(function (res) {
          if (!res.ok) throw new Error("catalog " + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data || !Array.isArray(data.products)) throw new Error("catalog malformed");
          catalog = data;
          catalogFailed = false;
          return data;
        })
        .catch(function (err) {
          catalogPromise = null;
          catalogFailed = true;
          throw err;
        });
    }
    return catalogPromise;
  }

  function productById(id) {
    for (var i = 0; i < catalog.products.length; i++) if (catalog.products[i].id === id) return catalog.products[i];
    return null;
  }

  /** Validated options object in catalog order, or null when the selection is invalid. */
  function pick(product, given) {
    given = given || {};
    var names = product.options.map(function (o) {
      return o.name;
    });
    for (var key in given) if (names.indexOf(key) < 0) return null;
    var out = {};
    for (var i = 0; i < product.options.length; i++) {
      var o = product.options[i];
      if (o.values.indexOf(given[o.name]) < 0) return null;
      out[o.name] = given[o.name];
    }
    return out;
  }

  /** Drop items the catalog no longer sells (removed products or options). */
  function reconcile() {
    var kept = state.items.filter(function (item) {
      var product = productById(item.id);
      return product && pick(product, item.options);
    });
    if (kept.length !== state.items.length) {
      state.items = kept;
      writeStore();
      updateCount();
      notice = "Some items are no longer available and were removed from your basket.";
    }
  }

  function priceState() {
    var lines = state.items.map(function (item, index) {
      var product = productById(item.id);
      return { index: index, product: product, options: pick(product, item.options), qty: item.qty, total: product.price * item.qty };
    });
    var subtotal = lines.reduce(function (s, l) {
      return s + l.total;
    }, 0);
    var needsShipping = lines.some(function (l) {
      return l.product.shippable !== false;
    });
    var rates = (catalog.shipping && catalog.shipping.rates) || [];
    var rate = null;
    var shipping = 0;
    if (needsShipping && rates.length) {
      rate = rates.filter(function (r) {
        return r.id === state.rate;
      })[0] || rates[0];
      shipping = rateAmount(rate, subtotal);
    }
    return { lines: lines, subtotal: subtotal, needsShipping: needsShipping, rates: rates, rate: rate, shipping: shipping, total: subtotal + shipping };
  }
  function rateAmount(rate, subtotal) {
    return rate.freeOver != null && subtotal >= rate.freeOver ? 0 : rate.amount;
  }

  /* ---------- live announcements ---------- */
  function announce(message) {
    document.querySelectorAll("[data-cart-live]").forEach(function (el) {
      el.textContent = "";
      setTimeout(function () {
        el.textContent = message;
      }, 60);
    });
  }

  /* ---------- basket view ---------- */
  var roots = Array.prototype.slice.call(document.querySelectorAll("[data-cart-root]"));
  var renderQueued = false;
  function scheduleRender() {
    if (!roots.length || renderQueued) return;
    renderQueued = true;
    // Deferred so a change event triggered by Tab lets focus land first; we then restore it.
    setTimeout(function () {
      renderQueued = false;
      roots.forEach(render);
    }, 0);
  }

  var FOCUS_HOOKS = ["data-cart-inc", "data-cart-dec", "data-cart-qty", "data-cart-remove", "data-cart-rate", "data-cart-checkout", "data-cart-retry"];
  function focusToken(root) {
    var el = document.activeElement;
    if (!el || !root.contains(el)) return null;
    for (var i = 0; i < FOCUS_HOOKS.length; i++) {
      if (el.hasAttribute(FOCUS_HOOKS[i])) return { attr: FOCUS_HOOKS[i], value: el.getAttribute(FOCUS_HOOKS[i]) };
    }
    return { attr: null, value: null };
  }
  function restoreFocus(root, token) {
    if (!token) return;
    var find = function (attr, value) {
      return attr ? root.querySelector("[" + attr + '="' + value + '"]') : null;
    };
    var el = find(token.attr, token.value);
    if (el && el.disabled) el = find("data-cart-qty", token.value);
    if (!el) el = token.attr ? root.querySelector("[data-cart-qty], [data-cart-empty-link]") || root : root;
    el.focus({ preventScroll: true });
  }

  function regionNames() {
    var countries = (catalog.shipping && catalog.shipping.countries) || [];
    if (!countries.length) return "";
    var names = countries;
    try {
      var dn = new Intl.DisplayNames([locale], { type: "region" });
      names = countries.map(function (c) {
        return dn.of(c) || c;
      });
    } catch (e) {}
    try {
      return new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
    } catch (e) {
      return names.join(", ");
    }
  }

  function lineHtml(l) {
    var name = esc(l.product.name);
    var opts = l.product.options
      .map(function (o) {
        return o.name + ": " + l.options[o.name];
      })
      .join(" · ");
    var i = l.index;
    return (
      '<li class="s-cart__line">' +
      (l.product.thumb || l.product.image
        ? '<img class="s-cart__thumb" src="' + esc(thumbUrl(l.product)) + '" alt="" width="96" height="96" loading="lazy" decoding="async">'
        : '<span class="s-cart__thumb" aria-hidden="true"></span>') +
      '<div class="s-cart__info"><p class="s-cart__name">' + name + "</p>" +
      (opts ? '<p class="s-cart__opts">' + esc(opts) + "</p>" : "") +
      '<p class="s-cart__unit">' + esc(money(l.product.price)) + " each</p></div>" +
      '<div class="s-cart__qty" role="group" aria-label="Quantity of ' + name + '">' +
      '<button type="button" class="s-cart__step" data-cart-dec="' + i + '" aria-label="Decrease quantity of ' + name + '"' + (l.qty <= 1 ? " disabled" : "") + ">&minus;</button>" +
      '<input type="number" inputmode="numeric" min="1" max="' + MAX_QTY + '" step="1" value="' + l.qty + '" data-cart-qty="' + i + '" aria-label="Quantity of ' + name + '">' +
      '<button type="button" class="s-cart__step" data-cart-inc="' + i + '" aria-label="Increase quantity of ' + name + '"' + (l.qty >= MAX_QTY ? " disabled" : "") + ">+</button></div>" +
      '<p class="s-cart__total">' + esc(money(l.total)) + "</p>" +
      '<button type="button" class="btn btn--ghost btn--sm s-cart__remove" data-cart-remove="' + i + '">Remove<span class="visually-hidden"> ' + name + "</span></button>" +
      "</li>"
    );
  }

  function summaryHtml(p, root, uid) {
    var rows = '<div><dt>Subtotal</dt><dd>' + esc(money(p.subtotal)) + "</dd></div>";
    var rates = "";
    if (p.needsShipping) {
      if (p.rates.length > 1) {
        rates =
          '<fieldset class="s-cart__rates"><legend>Delivery</legend>' +
          p.rates
            .map(function (r) {
              var amount = rateAmount(r, p.subtotal);
              return (
                '<label class="s-cart__rate"><input type="radio" name="' + uid + '-rate" value="' + esc(r.id) + '" data-cart-rate="' + esc(r.id) + '"' +
                (p.rate && p.rate.id === r.id ? " checked" : "") + "><span>" + esc(r.label) + "</span><strong>" +
                (amount === 0 ? "Free" : esc(money(amount))) + "</strong></label>"
              );
            })
            .join("") +
          "</fieldset>";
      }
      var label = p.rate && p.rates.length === 1 ? ' <span class="muted">(' + esc(p.rate.label) + ")</span>" : "";
      rows += "<div><dt>Delivery" + label + "</dt><dd>" + (p.shipping === 0 ? "Free" : esc(money(p.shipping))) + "</dd></div>";
    }
    rows += '<div class="s-cart__grand"><dt>Total</dt><dd>' + esc(money(p.total)) + "</dd></div>";

    var hint = "";
    if (p.rate && p.rate.freeOver != null && p.subtotal < p.rate.freeOver && p.rate.amount > 0) {
      hint = '<p class="s-cart__hint">Spend ' + esc(money(p.rate.freeOver - p.subtotal)) + " more for free delivery.</p>";
    }
    var regions = p.needsShipping ? regionNames() : "";
    return (
      '<aside class="card s-cart__summary" aria-labelledby="' + uid + '-title">' +
      '<h3 id="' + uid + '-title">Order summary</h3>' + rates +
      '<dl class="s-cart__totals">' + rows + "</dl>" + hint +
      (regions ? '<p class="s-cart__countries">We deliver to ' + esc(regions) + ".</p>" : "") +
      '<button type="button" class="btn btn--primary s-cart__checkout" data-cart-checkout="go">Checkout securely</button>' +
      '<p class="s-cart__error" role="alert" data-cart-error></p>' +
      (config.mode === "test"
        ? '<p class="s-cart__test"><strong>Test mode:</strong> no real payment is taken. Pay with card <strong>4242 4242 4242 4242</strong>, any future expiry date and any CVC.</p>'
        : "") +
      '<p class="s-cart__continue"><a href="' + esc(root.getAttribute("data-continue-href") || "./") + '">' +
      esc(root.getAttribute("data-continue-label") || "Continue shopping") + "</a></p>" +
      "</aside>"
    );
  }

  function viewHtml(root, uid) {
    if (catalogFailed) {
      return (
        '<p class="s-cart__notice" role="alert">We couldn\u2019t load the shop right now.</p>' +
        '<button type="button" class="btn btn--outline" data-cart-retry="go">Try again</button>'
      );
    }
    if (!catalog) return '<p class="muted">Loading your basket\u2026</p>';
    var noticeHtml = notice ? '<p class="s-cart__notice">' + esc(notice) + "</p>" : "";
    if (!state.items.length) {
      return (
        noticeHtml + '<div class="s-cart__empty"><p>' + esc(root.getAttribute("data-empty-text") || "Your basket is empty.") + "</p>" +
        '<a class="btn btn--primary" data-cart-empty-link href="' + esc(root.getAttribute("data-continue-href") || "./") + '">' +
        esc(root.getAttribute("data-continue-label") || "Continue shopping") + "</a></div>"
      );
    }
    var p = priceState();
    return (
      noticeHtml + '<div class="s-cart__layout"><div><h3 class="visually-hidden">Items</h3><ul class="s-cart__lines" role="list">' +
      p.lines.map(lineHtml).join("") + "</ul></div>" + summaryHtml(p, root, uid) + "</div>"
    );
  }

  function render(root) {
    var view = root.querySelector("[data-cart-view]");
    if (catalog) reconcile();
    var token = focusToken(root);
    view.innerHTML = viewHtml(root, view.id);
    view.removeAttribute("aria-busy");
    restoreFocus(root, token);
  }

  /* ---------- mutations ---------- */
  function add(item) {
    var existing = state.items.filter(function (x) {
      return sameLine(x, item);
    })[0];
    var before = existing ? existing.qty : 0;
    var after = Math.min(MAX_QTY, before + item.qty);
    if (existing) existing.qty = after;
    else state.items.push({ id: item.id, qty: after, options: item.options });
    commit();
    return after - before;
  }
  function setQty(index, qty, relative) {
    var item = state.items[index];
    if (!item) return;
    item.qty = Math.max(1, Math.min(MAX_QTY, relative ? item.qty + qty : qty));
    commit("Quantity updated to " + item.qty + ".");
  }
  function remove(index) {
    var item = state.items[index];
    if (!item) return;
    var product = catalog && productById(item.id);
    state.items.splice(index, 1);
    commit("Removed " + (product ? product.name : "item") + " from your basket.");
  }

  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function checkout(root, button) {
    if (busy || !catalog) return;
    reconcile();
    if (!state.items.length) return scheduleRender();
    var p = priceState();
    var error = root.querySelector("[data-cart-error]");
    var label = button.innerHTML;
    busy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Opening secure checkout\u2026";
    if (error) error.textContent = "";
    attemptKey = attemptKey || newKey();
    var fail = function (message) {
      busy = false;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = label;
      if (error) error.textContent = message;
    };
    fetch((config.apiBase || "") + "/api/checkout", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": attemptKey },
      body: JSON.stringify({
        items: p.lines.map(function (l) {
          return { id: l.product.id, qty: l.qty, options: l.options };
        }),
        shippingRate: p.rate ? p.rate.id : undefined,
        returnBase: new URL(config.siteRoot || "/", location.href).href,
      }),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            if (res.ok && data && typeof data.url === "string" && /^https:\/\//.test(data.url)) {
              location.assign(data.url);
              return;
            }
            fail(data && typeof data.error === "string" ? data.error : "Checkout isn\u2019t available right now. Please try again shortly.");
          });
      })
      .catch(function () {
        fail("We couldn\u2019t reach the checkout. Check your connection and try again.");
      });
  }

  /* ---------- events ---------- */
  document.addEventListener("submit", function (event) {
    var form = event.target;
    var button = form.querySelector && form.querySelector("[data-add-to-cart]");
    if (!button) return;
    event.preventDefault();
    var options = {};
    form.querySelectorAll("[data-option]").forEach(function (select) {
      options[select.getAttribute("data-option")] = select.value;
    });
    var qtyEl = form.querySelector("[data-qty]");
    var qty = qtyEl ? parseInt(qtyEl.value, 10) : 1;
    if (!(qty >= 1)) qty = 1;
    var added = add({ id: button.getAttribute("data-product-id"), qty: Math.min(qty, MAX_QTY), options: options });
    var status = form.querySelector("[data-cart-status]");
    if (!status) return;
    status.textContent = "";
    var text = added
      ? (added === 1 ? "Added to your basket. " : "Added " + added + " to your basket. ")
      : "You already have the maximum of " + MAX_QTY + " in your basket. ";
    var link = document.createElement("a");
    link.href = config.cartPath;
    link.textContent = "View basket";
    status.append(text, link);
  });

  document.addEventListener("click", function (event) {
    var t = event.target.closest && event.target.closest("[data-cart-inc],[data-cart-dec],[data-cart-remove],[data-cart-checkout],[data-cart-retry]");
    var root = t && t.closest("[data-cart-root]");
    if (!root) return;
    var index = function (attr) {
      return parseInt(t.getAttribute(attr), 10);
    };
    if (t.hasAttribute("data-cart-inc")) setQty(index("data-cart-inc"), 1, true);
    else if (t.hasAttribute("data-cart-dec")) setQty(index("data-cart-dec"), -1, true);
    else if (t.hasAttribute("data-cart-remove")) remove(index("data-cart-remove"));
    else if (t.hasAttribute("data-cart-checkout")) checkout(root, t);
    else if (t.hasAttribute("data-cart-retry")) start();
  });

  document.addEventListener("change", function (event) {
    var t = event.target;
    if (!t.closest || !t.closest("[data-cart-root]")) return;
    if (t.hasAttribute("data-cart-qty")) {
      var index = parseInt(t.getAttribute("data-cart-qty"), 10);
      var qty = parseInt(t.value, 10);
      if (qty === 0) remove(index);
      else if (qty >= 1) setQty(index, qty);
      else scheduleRender(); // blank/invalid: restore the stored quantity
    } else if (t.hasAttribute("data-cart-rate")) {
      state.rate = t.value;
      commit();
    }
  });

  // Another tab changed the basket.
  window.addEventListener("storage", function (event) {
    if (event.key !== config.storageKey) return;
    state = readStore();
    attemptKey = null;
    updateCount();
    scheduleRender();
  });

  // Back from Stripe via the bfcache: re-enable the checkout button.
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    busy = false;
    state = readStore();
    updateCount();
    scheduleRender();
  });

  /* ---------- init ---------- */
  if (document.querySelector("[data-cart-clear]") && new URLSearchParams(location.search).has("session_id")) {
    state = { items: [], rate: state.rate };
    writeStore();
  }

  roots.forEach(function (root, i) {
    root.innerHTML =
      '<div data-cart-view id="zsite-cart-' + i + '" aria-busy="true"></div>' +
      '<p class="visually-hidden" role="status" data-cart-live></p>';
  });

  function start() {
    catalogFailed = false;
    scheduleRender();
    loadCatalog().then(scheduleRender, scheduleRender);
  }

  updateCount();
  if (roots.length) start();
})();
