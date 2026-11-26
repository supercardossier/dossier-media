// GTA 6 Tools: 100% completion tracker.
// Vanilla JS, no dependencies, no network, no cookies. It carries no wording of its own: every label and sentence is in
// the page's HTML, which the build writes from data/completion.json (sourced). This file only reads the numbers typed
// into the table, computes the weighted estimate, toggles classes / hidden-state, and writes numbers with textContent.
// Storage: one localStorage key on this device (numbers only, validated and clamped on read). Nothing is sent anywhere.
(function () {
  'use strict';

  var root = document.querySelector('[data-completion]');
  if (!root) return;
  var KEY = root.getAttribute('data-key');
  var rows = Array.prototype.slice.call(document.querySelectorAll('[data-ct-row]'));
  var pctEl = root.querySelector('[data-ct-pct]');
  var barEl = root.querySelector('[data-ct-bar]');
  var doneEl = root.querySelector('[data-ct-done]');
  var savedEl = root.querySelector('[data-ct-saved]');
  var nosaveEl = root.querySelector('[data-ct-nosave]');
  var resetBtn = root.querySelector('[data-ct-reset]');
  var confirmEl = root.querySelector('[data-ct-confirm]');

  // Storage can be missing or throw (private windows, blocked site data); the tracker still works without it.
  var store = null;
  try {
    store = window.localStorage;
    store.setItem(KEY + '.t', '1');
    store.removeItem(KEY + '.t');
  } catch (e) {
    store = null;
  }

  // Count and dollar rows take whole numbers only; percent rows may hold decimals.
  function clamp(x, max, whole) {
    var n = Number(x);
    if (!isFinite(n) || n < 0) n = 0;
    if (n > max) n = max;
    return whole ? Math.floor(n) : n;
  }

  function load() {
    if (!store) return {};
    try {
      var o = JSON.parse(store.getItem(KEY) || '{}');
      return o && typeof o === 'object' && o.d && typeof o.d === 'object' ? o.d : {};
    } catch (e) {
      return {};
    }
  }

  function save(d) {
    if (!store) return false;
    try {
      store.setItem(KEY, JSON.stringify({ v: 1, d: d }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function show(el, on) {
    if (el) el.classList.toggle('on', on);
  }

  function round2(n) {
    return String(Math.round(n * 100) / 100);
  }

  var items = rows.map(function (r) {
    return {
      row: r,
      id: r.getAttribute('data-ct-row'),
      max: Number(r.getAttribute('data-target')),
      whole: r.getAttribute('data-unit') !== 'percent',
      prev: 0,
      weight: Number(r.getAttribute('data-weight')),
      input: r.querySelector('[data-ct-input]'),
      btn: r.querySelector('[data-ct-max]'),
      pts: r.querySelector('[data-ct-pts]'),
    };
  });

  function update(persist) {
    var total = 0;
    var done = 0;
    var data = {};
    items.forEach(function (it) {
      var v = clamp(it.input.value, it.max, it.whole);
      var share = it.max > 0 ? v / it.max : 0;
      var pts = it.weight * share;
      total += pts;
      var finished = v >= it.max;
      if (finished) done += 1;
      it.row.classList.toggle('is-done', finished);
      it.row.classList.toggle('is-started', v > 0 && !finished);
      it.btn.setAttribute('aria-pressed', finished ? 'true' : 'false');
      it.pts.textContent = round2(pts);
      if (v > 0) data[it.id] = v;
    });
    if (total > 100) total = 100;
    pctEl.textContent = total.toFixed(1);
    barEl.value = Math.round(total * 10) / 10;
    barEl.textContent = total.toFixed(1);
    doneEl.textContent = String(done);
    if (persist) {
      var ok = save(data);
      show(savedEl, ok);
      show(nosaveEl, !ok);
    }
  }

  var saved = load();
  items.forEach(function (it) {
    // Saved values must be plain finite numbers; anything else (strings, hex, objects) is ignored.
    if (Object.prototype.hasOwnProperty.call(saved, it.id) && typeof saved[it.id] === 'number' && isFinite(saved[it.id])) {
      it.input.value = String(clamp(saved[it.id], it.max, it.whole));
    }
    it.input.disabled = false;
    it.btn.disabled = false;
    it.input.addEventListener('input', function () { update(true); });
    it.input.addEventListener('change', function () {
      it.input.value = String(clamp(it.input.value, it.max, it.whole));
      update(true);
    });
    // Done fills the target; pressing it again restores what was there before (or 0).
    it.btn.addEventListener('click', function () {
      var cur = clamp(it.input.value, it.max, it.whole);
      if (cur >= it.max) {
        it.input.value = String(it.prev < it.max ? it.prev : 0);
      } else {
        it.prev = cur;
        it.input.value = String(it.max);
      }
      update(true);
    });
  });

  // Clearing needs two presses within five seconds.
  var armed = null;
  resetBtn.disabled = false;
  resetBtn.addEventListener('click', function () {
    if (!armed) {
      show(confirmEl, true);
      armed = setTimeout(function () { armed = null; show(confirmEl, false); }, 5000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    show(confirmEl, false);
    items.forEach(function (it) { it.input.value = '0'; });
    if (store) {
      try { store.removeItem(KEY); } catch (e) { /* ignore */ }
    }
    update(false);
  });

  update(false);
  show(store ? savedEl : nosaveEl, true);
})();
