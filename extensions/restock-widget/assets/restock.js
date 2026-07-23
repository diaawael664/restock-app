(function () {
  var s = document.currentScript;
  var proxy = s.dataset.proxy;
  var label = s.dataset.buttonText || "Notify me when available";
  var color = s.dataset.color || "#111111";

  function currentVariant() {
    var url = new URL(location.href);
    return (
      url.searchParams.get("variant") ||
      (document.querySelector('form[action*="/cart/add"] [name="id"]') || {}).value ||
      (document.querySelector('[name="id"]') || {}).value
    );
  }

  function productHandle() {
    var m = location.pathname.match(/\/products\/([^\/?#]+)/);
    return m ? m[1] : null;
  }

  // Cache the product JSON per handle so variant switches don't refetch.
  var productCache = {};
  function loadProduct() {
    var h = productHandle();
    if (!h) return Promise.resolve(null);
    if (!productCache[h]) {
      productCache[h] = fetch("/products/" + h + ".js", {
        headers: { Accept: "application/json" },
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return productCache[h];
  }

  // Fallback for when the .js fetch fails: a disabled/"sold out" add-to-cart button.
  // Returns null when there's no button at all (theme removed it) — availability is unknown.
  function buttonSaysSoldOut() {
    var btn = document.querySelector(
      'form[action*="/cart/add"] [type="submit"], form[action*="/cart/add"] button[name="add"]'
    );
    if (!btn) return null;
    return btn.disabled || /sold out|unavailable|out of stock/i.test(btn.textContent || "");
  }

  // The option values currently selected in the theme's variant pickers
  // (radios / selects). Used to identify the variant when the id input is gone.
  function selectedOptionValues() {
    var form = document.querySelector('form[action*="/cart/add"]');
    var scope = form || document;
    var vals = [];
    scope.querySelectorAll('input[type="radio"]:checked').forEach(function (r) {
      if (r.value) vals.push(r.value);
    });
    scope.querySelectorAll("select").forEach(function (sel) {
      if (sel.name !== "id" && sel.value) vals.push(sel.value);
    });
    return vals;
  }

  // Resolve the selected variant from the JSON. Themes that delete the buy button
  // on sold-out often strip the hidden [name="id"] too, so currentVariant() can be
  // empty — fall back to (a) matching selected option values, then (b) the sole variant.
  function pickVariant(p) {
    if (!p || !p.variants || !p.variants.length) return null;
    var vid = String(currentVariant() || "");
    if (vid) {
      var byId = p.variants.filter(function (x) { return String(x.id) === vid; })[0];
      if (byId) return byId;
    }
    var opts = selectedOptionValues();
    if (opts.length) {
      var byOpts = p.variants.filter(function (v) {
        return (v.options || []).every(function (o) { return opts.indexOf(o) !== -1; });
      })[0];
      if (byOpts) return byOpts;
    }
    if (p.variants.length === 1) return p.variants[0];
    return null;
  }

  // Authoritative check: ask Shopify whether THIS variant is available.
  // Themes vary wildly in how they render sold-out (some delete the button entirely),
  // so we trust the storefront's own variant data, not the DOM. Returns Promise<boolean>.
  function isSoldOut() {
    return loadProduct().then(function (p) {
      var v = pickVariant(p);
      if (v) return v.available === false;
      // Couldn't identify the selected variant. If every variant is sold out, the
      // notify prompt is correct regardless of which one is "selected".
      if (p && p.variants && p.variants.length &&
          p.variants.every(function (x) { return x.available === false; })) {
        return true;
      }
      return buttonSaysSoldOut() === true;
    });
  }

  // The variant id to subscribe with — prefer the DOM, else the resolved sole variant.
  function subscribeVariantId() {
    var vid = currentVariant();
    if (vid) return Promise.resolve(vid);
    return loadProduct().then(function (p) {
      var v = pickVariant(p);
      return v ? v.id : "";
    });
  }

  function injectStyles() {
    if (document.getElementById("restock-styles")) return;
    var css = document.createElement("style");
    css.id = "restock-styles";
    css.textContent =
      "#restock-btn{width:100%;padding:14px;margin-top:10px;border:0;border-radius:8px;cursor:pointer;color:#fff;font-size:15px;font-weight:600;line-height:1.2}" +
      "#restock-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px}" +
      "#restock-modal{background:#fff;border-radius:14px;max-width:400px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:inherit}" +
      "#restock-modal h3{margin:0 0 8px;font-size:19px;color:#111}" +
      "#restock-modal p{margin:0 0 18px;font-size:14px;color:#666;line-height:1.5}" +
      "#restock-modal input{width:100%;box-sizing:border-box;padding:12px 14px;font-size:15px;border:1px solid #ddd;border-radius:8px;margin-bottom:12px}" +
      "#restock-modal .rs-actions{display:flex;gap:10px}" +
      "#restock-modal .rs-submit{flex:1;padding:12px;border:0;border-radius:8px;color:#fff;font-weight:600;font-size:15px;cursor:pointer}" +
      "#restock-modal .rs-cancel{padding:12px 16px;border:1px solid #ddd;background:#fff;border-radius:8px;font-size:15px;cursor:pointer;color:#555}" +
      "#restock-modal .rs-msg{font-size:14px;color:#666;text-align:center;padding:8px 0}";
    document.head.appendChild(css);
  }

  function openModal() {
    injectStyles();
    var overlay = document.createElement("div");
    overlay.id = "restock-overlay";
    overlay.innerHTML =
      '<div id="restock-modal">' +
      "<h3>Get notified</h3>" +
      "<p>Enter your email and we'll tell you the moment this is back in stock.</p>" +
      '<input id="restock-email" type="email" placeholder="you@example.com" autocomplete="email">' +
      '<div class="rs-actions">' +
      '<button class="rs-cancel" type="button">Cancel</button>' +
      '<button class="rs-submit" type="button" style="background:' + color + '">Notify me</button>' +
      "</div></div>";
    document.body.appendChild(overlay);

    var input = overlay.querySelector("#restock-email");
    var modal = overlay.querySelector("#restock-modal");
    input.focus();

    function close() {
      overlay.remove();
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".rs-cancel").addEventListener("click", close);

    function submit() {
      var email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        input.style.borderColor = "#e00";
        input.focus();
        return;
      }
      modal.innerHTML = '<div class="rs-msg">Adding you to the list…</div>';
      subscribeVariantId()
        .then(function (variantId) {
          return fetch(proxy + "/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ email: email, variantId: variantId }),
          });
        })
        .then(function (r) {
          return r.json().catch(function () {
            return { ok: r.ok };
          });
        })
        .then(function (data) {
          if (data && data.ok) {
            modal.innerHTML =
              '<h3>✓ You\'re on the list</h3><p>We\'ll email you the moment it\'s back. You can close this.</p>' +
              '<div class="rs-actions"><button class="rs-submit" type="button" style="background:' + color + '">Done</button></div>';
            modal.querySelector(".rs-submit").addEventListener("click", close);
            var b = document.getElementById("restock-btn");
            if (b) b.textContent = "✓ You're on the list";
          } else {
            modal.innerHTML = '<div class="rs-msg">Something went wrong. Please try again later.</div>';
          }
        })
        .catch(function () {
          modal.innerHTML = '<div class="rs-msg">Something went wrong. Please try again later.</div>';
        });
    }

    overlay.querySelector(".rs-submit").addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit();
    });
  }

  function removeBtn() {
    var b = document.getElementById("restock-btn");
    if (b) b.remove();
  }

  function mount() {
    // Off a PDP, or no product form → make sure no stale button lingers.
    if (!/\/products\//.test(location.pathname) || !document.querySelector('form[action*="/cart/add"]')) {
      removeBtn();
      return;
    }
    isSoldOut().then(function (soldOut) {
      // In stock (e.g. switched to an available variant) → tear our button back down.
      if (!soldOut) return removeBtn();
      if (document.getElementById("restock-btn")) return;
      var form = document.querySelector('form[action*="/cart/add"]');
      if (!form) return;

      injectStyles();
      var btn = document.createElement("button");
      btn.id = "restock-btn";
      btn.type = "button";
      btn.textContent = label;
      btn.style.background = color;
      btn.addEventListener("click", openModal);
      form.appendChild(btn);
    });
  }

  // PDPs swap variants without a full reload — re-check on DOM changes and variant changes.
  mount();
  new MutationObserver(mount).observe(document.body, { subtree: true, childList: true });
  document.addEventListener("change", mount);
})();
