// GTA 6 Tools: update tracker (version check + fix search).
// Vanilla JS, no dependencies, no network, no storage. It carries no wording of its own: every answer and label is in
// the page's HTML, which the build writes from data/updates.json (sourced). This file only reads the version drop-down
// and the search box, shows the one pre-written answer that matches, hides fix lines that do not match (in the list and in the
// shown answer), and writes the number of fixes shown with textContent.
(function () {
  'use strict';

  var root = document.querySelector('[data-updates]');
  if (!root) return;
  var ver = root.querySelector('[data-up-ver]');
  var search = root.querySelector('[data-up-q]');
  var countEl = root.querySelector('[data-up-count]');
  var emptyEl = root.querySelector('[data-up-empty]');
  var answers = Array.prototype.slice.call(root.querySelectorAll('[data-up-answer]'));
  var fixes = Array.prototype.slice.call(document.querySelectorAll('[data-up-fix]'));
  if (!ver || !search) return;

  // Lower-case, strip accents and anything that is not a letter or digit.
  function norm(s) {
    var t = String(s || '').toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.replace(/[^a-z0-9]+/g, ' ').trim();
  }
  var afixes = Array.prototype.slice.call(root.querySelectorAll('[data-up-afix]'));
  var fixText = fixes.map(function (li) { return norm(li.getAttribute('data-text')); });
  var afixText = afixes.map(function (li) { return norm(li.getAttribute('data-text')); });

  function showAnswer() {
    var v = String(ver.value);
    if (!/^[a-z0-9]+:(\d+(\.\d+)+|other)$/.test(v)) v = '';
    answers.forEach(function (el) {
      el.hidden = el.getAttribute('data-up-answer') !== v;
    });
  }

  function filter() {
    var q = norm(search.value).slice(0, 60);
    // Loose match: long words drop their last two letters, so autosave finds autosaving and crashes finds crash.
    var words = (q ? q.split(' ') : []).map(function (w) { return w.length > 5 ? w.slice(0, -2) : w; });
    var shown = 0;
    fixes.forEach(function (li, i) {
      var hit = words.every(function (w) { return fixText[i].indexOf(w) !== -1; });
      li.hidden = !hit;
      if (hit) shown += 1;
    });
    afixes.forEach(function (li, i) {
      li.hidden = !words.every(function (w) { return afixText[i].indexOf(w) !== -1; });
    });
    if (countEl) countEl.textContent = String(shown);
    if (emptyEl) emptyEl.hidden = shown !== 0;
  }

  ver.addEventListener('change', showAnswer);
  search.addEventListener('input', filter);
  ver.disabled = false;
  search.disabled = false;
  showAnswer();
  filter();
})();
