/* Zyndy Unlock Copy - content script
 * Strategi:
 *  1) Inject CSS untuk override user-select: none (biar teks bisa di-blok lagi).
 *  2) Pasang listener fase-CAPTURE di window+document untuk event copy/cut/contextmenu/
 *     selectstart/dragstart -> stopImmediatePropagation() supaya handler pemblokir milik
 *     halaman TIDAK pernah jalan. Kita TIDAK preventDefault, jadi aksi native (copy / menu
 *     klik-kanan / select) tetap berjalan normal.
 *  3) Bersihkan handler inline (oncopy, oncontextmenu, dst) + inline style user-select,
 *     plus pantau node baru via MutationObserver.
 *
 * Karena content script jalan di document_start (sebelum script halaman), listener kita
 * teregistrasi paling awal -> dipanggil paling dulu -> stopImmediatePropagation menang.
 */
(function () {
  if (window.__zyndyUnlockInit) return;
  window.__zyndyUnlockInit = true;

  var STORAGE_KEY = "zyndy_unlock";
  var state = { active: false, forced: false };

  // Event yang murni dipakai halaman untuk memblokir -> aman di-stop total.
  var KILL_EVENTS = [
    "copy", "cut", "paste",
    "beforecopy", "beforecut", "beforepaste",
    "contextmenu", "selectstart", "dragstart"
  ];
  // Shortcut keyboard yang sering ikut diblokir.
  var KILL_KEYS = ["c", "x", "a"]; // dengan Ctrl/Cmd — "v" tidak perlu: paste sudah di KILL_EVENTS

  // Atribut handler inline yang aman dihapus (tujuannya cuma memblokir).
  var INLINE_HANDLERS = [
    "oncopy", "oncut", "onpaste",
    "oncontextmenu", "onselectstart", "ondragstart"
  ];

  // ---------- CSS override ----------
  var styleEl = null;
  var CSS =
    "*, *::before, *::after {" +
    "  -webkit-user-select: text !important;" +
    "  -moz-user-select: text !important;" +
    "  -ms-user-select: text !important;" +
    "  user-select: text !important;" +
    "  -webkit-touch-callout: default !important;" +
    "}" +
    "html, body {" +
    "  -webkit-user-drag: auto !important;" +
    "}";

  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return;
    styleEl = document.createElement("style");
    styleEl.id = "zyndy-unlock-style";
    styleEl.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleEl);
  }
  function removeStyle() {
    if (styleEl) { try { styleEl.remove(); } catch (e) {} styleEl = null; }
  }

  // ---------- Event killers (didaftarkan sekali, di-gate oleh isOn) ----------
  function isOn() { return state.active || state.forced; }

  function killHandler(e) {
    if (!isOn()) return;
    e.stopImmediatePropagation();
    // sengaja TIDAK preventDefault -> biarkan copy / context menu native jalan
  }
  function keyHandler(e) {
    if (!isOn()) return;
    if (e.ctrlKey || e.metaKey) {
      var k = (e.key || "").toLowerCase();
      if (KILL_KEYS.indexOf(k) !== -1) e.stopImmediatePropagation();
    }
  }
  function registerKillers() {
    for (var i = 0; i < KILL_EVENTS.length; i++) {
      window.addEventListener(KILL_EVENTS[i], killHandler, true);
      document.addEventListener(KILL_EVENTS[i], killHandler, true);
    }
    window.addEventListener("keydown", keyHandler, true);
    document.addEventListener("keydown", keyHandler, true);
  }

  // ---------- Bersih-bersih inline ----------
  function stripEl(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.hasAttribute && el.hasAttribute("style")) {
      var s = el.getAttribute("style");
      if (s && /user-select|touch-callout|user-drag/i.test(s)) {
        el.style.removeProperty("user-select");
        el.style.removeProperty("-webkit-user-select");
        el.style.removeProperty("-moz-user-select");
        el.style.removeProperty("-ms-user-select");
        el.style.removeProperty("-webkit-touch-callout");
      }
    }
    if (el.hasAttribute && el.hasAttribute("unselectable")) {
      el.removeAttribute("unselectable");
    }
    for (var i = 0; i < INLINE_HANDLERS.length; i++) {
      if (el.hasAttribute && el.hasAttribute(INLINE_HANDLERS[i])) {
        el.removeAttribute(INLINE_HANDLERS[i]);
      }
    }
  }

  var SELECTOR = "[style],[unselectable]," +
    INLINE_HANDLERS.map(function (a) { return "[" + a + "]"; }).join(",");

  function stripTree(root) {
    if (!root) return;
    if (root.nodeType === 1) stripEl(root);
    if (root.querySelectorAll) {
      var list = root.querySelectorAll(SELECTOR);
      for (var i = 0; i < list.length; i++) stripEl(list[i]);
    }
  }

  function clearDocHandlers() {
    var props = INLINE_HANDLERS.slice();
    var targets = [document, document.documentElement, document.body];
    for (var t = 0; t < targets.length; t++) {
      var tgt = targets[t];
      if (!tgt) continue;
      for (var p = 0; p < props.length; p++) {
        try { tgt[props[p]] = null; } catch (e) {}
      }
    }
  }

  var observer = null;
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function (muts) {
      if (!isOn()) return;
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "childList") {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 1) stripTree(n);
          }
        } else if (m.type === "attributes") {
          stripEl(m.target);
        }
      }
    });
    try {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "unselectable"].concat(INLINE_HANDLERS)
      });
    } catch (e) {}
  }
  function stopObserver() {
    if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
  }

  // ---------- Apply on/off ----------
  function applyOn() {
    ensureStyle();
    clearDocHandlers();
    stripTree(document.documentElement);
    startObserver();
  }
  function applyOff() {
    removeStyle();
    stopObserver();
    // Catatan: pemblokir bawaan halaman tak bisa "dikembalikan", tapi setelah CSS dilepas
    // perilaku seleksi kembali ke default halaman.
  }

  function refresh() {
    if (isOn()) applyOn(); else applyOff();
  }
  function setActive(v) { state.active = !!v; refresh(); }
  function setForced(v) { state.forced = !!v; refresh(); }

  // Daftarkan killer sekarang juga (ringan, di-gate oleh isOn)
  registerKillers();

  // Baca status awal
  try {
    chrome.storage.local.get(STORAGE_KEY, function (res) {
      var conf = res && res[STORAGE_KEY];
      setActive(conf && conf.enabled);
    });
  } catch (e) {}

  // Reaksi saat toggle diubah dari popup
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      var nv = changes[STORAGE_KEY].newValue;
      setActive(nv && nv.enabled);
    });
  } catch (e) {}

  // Pesan dari popup (force / ping)
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === "ZYNDY_FORCE") {
        setForced(true);
        if (sendResponse) sendResponse({ ok: true });
      } else if (msg && msg.type === "ZYNDY_PING") {
        if (sendResponse) sendResponse({ ok: true, active: isOn() });
      }
      // semua path sync — tidak perlu return true
    });
  } catch (e) {}

  // Re-apply saat DOM siap & load penuh (menangkap pemblokir yang dipasang belakangan)
  var reapply = function () { if (isOn()) applyOn(); };
  document.addEventListener("DOMContentLoaded", reapply, true);
  window.addEventListener("load", reapply, true);
})();
