// GTA 6 Tools countdown. Vanilla JS, no dependencies, no network, no storage.
// Only writes with textContent / classList (never innerHTML), so it cannot inject markup.
(function () {
  'use strict';

  var pad = function (n) { return n < 10 ? '0' + n : String(n); };
  var tzName = '';
  try { tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tzName = ''; }

  // Parse "YYYY-MM-DDTHH:MM:SS" as a LOCAL wall-clock time (the visitor's own midnight).
  function localTarget(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(str || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }

  var boxes = document.querySelectorAll('[data-countdown]');
  var timers = [];
  Array.prototype.forEach.call(boxes, function (box) {
    var target = localTarget(box.getAttribute('data-target-local'));
    if (target === null) return;
    var units = {};
    ['d', 'h', 'm', 's'].forEach(function (u) { units[u] = box.querySelector('[data-unit="' + u + '"]'); });
    var note = box.parentNode.querySelector('[data-cd-note]');
    if (note && tzName) {
      var when = new Date(target);
      var utc = pad(when.getUTCHours()) + ':' + pad(when.getUTCMinutes()) + ' UTC';
      note.textContent = 'Counting down to 12:00 AM on Thu, Nov 19, 2026 in your time zone (' + tzName +
        ', which is ' + utc + '). Rockstar says the game unlocks at midnight local time.';
    }
    timers.push({ target: target, units: units, box: box, note: note });
  });

  function tick() {
    var now = Date.now();
    timers.forEach(function (t) {
      var diff = Math.max(0, t.target - now);
      var s = Math.floor(diff / 1000);
      var vals = { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
      Object.keys(vals).forEach(function (u) {
        if (t.units[u]) t.units[u].textContent = u === 'd' ? String(vals[u]) : pad(vals[u]);
      });
      if (diff === 0 && !t.done) {
        t.done = true;
        t.box.classList.add('is-live');
        if (t.note) t.note.textContent = 'It is past midnight on Nov 19 in your time zone: by Rockstar\'s rule, GTA VI is unlocked for you.';
      }
    });
  }
  if (timers.length) { tick(); setInterval(tick, 1000); }

  // "In your time" column on the launch-time table.
  var fmt;
  try {
    fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) { fmt = null; }
  var myMidnight = new Date(2026, 10, 19, 0, 0, 0).getTime();
  Array.prototype.forEach.call(document.querySelectorAll('[data-local-time]'), function (cell) {
    var t = Date.parse(cell.getAttribute('data-local-time'));
    if (isNaN(t)) return;
    cell.textContent = fmt ? fmt.format(new Date(t)) : new Date(t).toString();
    if (t === myMidnight && cell.parentNode) {
      cell.parentNode.classList.add('is-you');
      var th = cell.parentNode.querySelector('th');
      if (th) th.setAttribute('aria-description', 'Matches your time zone');
    }
  });
})();
