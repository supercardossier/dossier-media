// GTA 6 Tools: money guide stage filter.
// Vanilla JS, no dependencies, no network, no storage. It carries no wording of its own: every label and sentence is
// in the page's HTML, which the build writes from data/money.json (sourced). This file only reads the chosen story
// stage, hides the table rows that open later, and writes the number of rows shown with textContent.
(function () {
  'use strict';

  var root = document.querySelector('[data-money]');
  if (!root) return;
  var select = root.querySelector('[data-mn-stage]');
  var countEl = root.querySelector('[data-mn-count]');
  var rows = Array.prototype.slice.call(document.querySelectorAll('[data-mn-row]'));
  if (!select || !rows.length) return;

  // A row's data-from is the earliest stage (1-5) it opens at, or empty when no source says.
  function stageOf(row) {
    var raw = row.getAttribute('data-from');
    if (!/^[1-5]$/.test(raw || '')) return 0;
    return Number(raw);
  }

  function apply() {
    var v = String(select.value);
    var stage = /^[1-5]$/.test(v) ? Number(v) : 0;
    var shown = 0;
    rows.forEach(function (row) {
      var from = stageOf(row);
      var hide = stage > 0 && from > stage;
      row.hidden = hide;
      row.classList.toggle('is-open', stage > 0 && from > 0 && !hide);
      if (!hide) shown += 1;
    });
    if (countEl) countEl.textContent = String(shown);
    root.classList.toggle('is-filtered', stage > 0);
  }

  select.addEventListener('change', apply);
  select.disabled = false;
  apply();
})();
