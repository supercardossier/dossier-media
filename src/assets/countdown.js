// GTA 6 Tools countdown sign. Vanilla JS, no dependencies, no network, no storage.
// It carries no wording of its own: every sentence comes from the sign's data-strings attribute, which the build
// writes from data/facts.json (launchState), where it has sources. This file only picks a string and fills
// {placeholders} with times computed on the visitor's device. It only writes with textContent / classList.
// States: 'before' (counting down to the visitor's own midnight), 'here' (past their midnight), 'all' (past the
// last zone's midnight too). The digits and the "out" face share one grid cell, so switching never moves the page.
(function () {
  'use strict';

  var pad = function (n) { return n < 10 ? '0' + n : String(n); };
  function fill(tpl, vals) {
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vals, k) ? vals[k] : m; });
  }
  var tzName = '';
  try { tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tzName = ''; }

  // Parse "YYYY-MM-DDTHH:MM:SS" as a LOCAL wall-clock time (the visitor's own midnight).
  function localTarget(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(str || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }

  var fmtLong = null;
  var fmtUtc = null;
  try {
    fmtLong = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    fmtUtc = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
  } catch (e) { fmtLong = null; fmtUtc = null; }
  function when(ms) { return fmtLong ? fmtLong.format(new Date(ms)) : new Date(ms).toString(); }
  function utcLabel(ms) { return fmtUtc ? fmtUtc.format(new Date(ms)) : new Date(ms).toUTCString(); }
  function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }

  var timers = [];
  Array.prototype.forEach.call(document.querySelectorAll('[data-cd-box]'), function (box) {
    var S = null;
    try { S = JSON.parse(box.getAttribute('data-strings') || ''); } catch (e) { S = null; }
    var target = localTarget(box.getAttribute('data-target-local'));
    var last = Date.parse(box.getAttribute('data-last-utc') || '');
    if (!S || target === null || isNaN(last)) return;
    var units = {};
    ['d', 'h', 'm', 's'].forEach(function (u) { units[u] = box.querySelector('[data-unit="' + u + '"]'); });
    timers.push({
      box: box, S: S, target: target, last: last, units: units, state: '',
      top: box.querySelector('[data-cd-top]'), big: box.querySelector('[data-cd-big]'),
      small: box.querySelector('[data-cd-small]'), note: box.querySelector('[data-cd-note]')
    });
  });

  function tick() {
    var now = Date.now();
    timers.forEach(function (t) {
      var S = t.S;
      var state = now < t.target ? 'before' : (now >= t.last ? 'all' : 'here');
      if (state === 'before') {
        // Round up, so the last second shows 00:00:01, never 00:00:00 before the moment.
        var s = Math.ceil((t.target - now) / 1000);
        var vals = { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
        Object.keys(vals).forEach(function (u) { setText(t.units[u], u === 'd' ? String(vals[u]) : pad(vals[u])); });
      }
      if (state === t.state) return;
      var v = { zone: tzName ? ' (' + tzName + ')' : '', utc: utcLabel(t.target), last: when(t.last) };
      t.box.classList.toggle('is-out', state !== 'before');
      setText(t.top, state === 'before' ? S.topBefore : S.topAfter);
      setText(t.big, S.outBig);
      setText(t.small, state === 'all' ? S.outAll : S.outHere);
      if (state === 'before') setText(t.note, tzName ? fill(S.noteBefore, v) : S.noteStatic);
      else setText(t.note, fill(state === 'all' ? S.noteAll : S.noteHere, v));
      t.state = state;
    });
  }
  if (timers.length) { tick(); setInterval(tick, 1000); }

  // "In your time" column on the launch-time table.
  var myMidnight = new Date(2026, 10, 19, 0, 0, 0).getTime();
  Array.prototype.forEach.call(document.querySelectorAll('[data-local-time]'), function (cell) {
    var t = Date.parse(cell.getAttribute('data-local-time'));
    if (isNaN(t)) return;
    cell.textContent = when(t);
    if (t === myMidnight && cell.parentNode) {
      cell.parentNode.classList.add('is-you');
      var th = cell.parentNode.querySelector('th');
      if (th) th.setAttribute('aria-description', 'Matches your time zone');
    }
  });
})();
