// GTA 6 Tools: vehicle finder (search, class filter, sort).
// Vanilla JS, no dependencies, no network, no storage. It carries no wording of its own: every label and sentence is
// in the page's HTML, which the build writes from data/vehicles.json (sourced). This file only reads the search box and
// the two drop-downs, hides or reorders table rows, and writes the number of rows shown with textContent.
(function () {
  'use strict';

  var root = document.querySelector('[data-finder]');
  if (!root) return;
  var search = root.querySelector('[data-vf-search]');
  var klass = root.querySelector('[data-vf-class]');
  var sort = root.querySelector('[data-vf-sort]');
  var countEl = root.querySelector('[data-vf-count]');
  var emptyEl = root.querySelector('[data-vf-empty]');
  var body = root.querySelector('[data-vf-body]');
  if (!search || !klass || !sort || !body) return;
  var rows = Array.prototype.slice.call(body.querySelectorAll('[data-vf-row]'));
  if (!rows.length) return;

  // Lower-case, strip accents and anything that is not a letter or digit, so "ubermacht" finds "Übermacht".
  function norm(s) {
    var t = String(s || '').toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function num(row, attr) {
    var v = row.getAttribute(attr);
    if (!/^\d+(\.\d+)?$/.test(v || '')) return -1;
    return Number(v);
  }

  var items = rows.map(function (row, i) {
    return {
      row: row,
      order: i,
      name: norm(row.getAttribute('data-name')),
      classes: (row.getAttribute('data-classes') || '').split(' ').filter(Boolean),
      speed: num(row, 'data-speed'),
      sell: num(row, 'data-sell')
    };
  });

  function compare(key) {
    return function (a, b) {
      if (key === 'name') return a.name < b.name ? -1 : a.name > b.name ? 1 : a.order - b.order;
      if (key === 'speed' || key === 'sell') {
        if (b[key] !== a[key]) return b[key] - a[key];
      }
      return a.order - b.order;
    };
  }

  function apply() {
    var q = norm(search.value).slice(0, 60);
    var c = String(klass.value);
    var k = String(sort.value);
    if (!/^(speed|sell|name)$/.test(k)) k = 'speed';
    var shown = 0;
    items.slice().sort(compare(k)).forEach(function (it) {
      var hide = (q && it.name.indexOf(q) === -1) || (c && c !== 'all' && it.classes.indexOf(c) === -1);
      it.row.hidden = !!hide;
      if (!hide) shown += 1;
      body.appendChild(it.row);
    });
    if (countEl) countEl.textContent = String(shown);
    if (emptyEl) emptyEl.hidden = shown !== 0;
  }

  search.addEventListener('input', apply);
  klass.addEventListener('change', apply);
  sort.addEventListener('change', apply);
  search.disabled = false;
  klass.disabled = false;
  sort.disabled = false;
  apply();
})();
