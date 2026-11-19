// GTA 6 Tools: "Is GTA 6 out yet where I am?" live status.
// Vanilla JS, no dependencies, no network, no storage, no cookies.
// It carries no wording of its own: every sentence comes from the page's data-strings attribute, which the build
// writes from data/facts.json (outYet), where each group has sources. This file only picks a string and fills
// {placeholders} with times computed on the visitor's device. It only writes with textContent / classList.
(function () {
  'use strict';

  var root = document.querySelector('[data-outyet]');
  if (!root) return;
  var S;
  try { S = JSON.parse(root.getAttribute('data-strings') || ''); } catch (e) { return; }
  if (!S || !S.status || !S.cloud || !S.ps) return;

  var pad = function (n) { return n < 10 ? '0' + n : String(n); };
  function fill(tpl, vals) {
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vals, k) ? vals[k] : m; });
  }

  // Older zone names some systems still report, mapped to their current names.
  var LEGACY = {
    'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh',
    'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv', 'Atlantic/Faeroe': 'Atlantic/Faroe',
    'America/Buenos_Aires': 'America/Argentina/Buenos_Aires', 'Pacific/Truk': 'Pacific/Chuuk',
    'Pacific/Ponape': 'Pacific/Pohnpei', 'Asia/Ulan_Bator': 'Asia/Ulaanbaatar', 'America/Godthab': 'America/Nuuk',
    'US/Eastern': 'America/New_York', 'US/Central': 'America/Chicago', 'US/Mountain': 'America/Denver',
    'US/Pacific': 'America/Los_Angeles', 'US/Arizona': 'America/Phoenix', 'US/Alaska': 'America/Anchorage',
    'US/Hawaii': 'Pacific/Honolulu', 'Australia/ACT': 'Australia/Sydney', 'Australia/NSW': 'Australia/Sydney',
    'Asia/Istanbul': 'Europe/Istanbul', 'GB': 'Europe/London', 'NZ': 'Pacific/Auckland', 'Japan': 'Asia/Tokyo'
  };
  var tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
  if (LEGACY[tz]) tz = LEGACY[tz];

  // The visitor's own midnight on Thu Nov 19, 2026 (local wall clock), from the page's data attribute.
  function localTarget(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(str || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }
  var target = localTarget(root.getAttribute('data-target-local'));
  var cloudUtc = Date.parse(root.getAttribute('data-cloud-utc') || '');
  var psUsUtc = Date.parse(root.getAttribute('data-ps-us-utc') || '');
  var lastUtc = Date.parse(root.getAttribute('data-last-utc') || '');
  if (target === null) return;

  var fmtLong = null;
  var fmtUtc = null;
  try {
    fmtLong = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    fmtUtc = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
  } catch (e) { fmtLong = null; fmtUtc = null; }
  function when(ms) { return fmtLong ? fmtLong.format(new Date(ms)) : new Date(ms).toString(); }
  function utcLabel(ms) { return fmtUtc ? fmtUtc.format(new Date(ms)) : new Date(ms).toUTCString(); }
  // Round up, so the last second before the moment shows 00:00:01, never 00:00:00.
  function hms(ms) {
    var s = Math.ceil(Math.max(0, ms) / 1000);
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
  }
  function roughly(ms) {
    var min = Math.ceil(ms / 60000);
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h ' + pad(min % 60) + ' min';
  }

  // Coarse zone-to-country lookup, only for countries with several time zones (picks which caveat to show;
  // it never decides the main answer). US territories count as US.
  function multiZoneCountry(name) {
    if (/^America\/(New_York|Detroit|Chicago|Denver|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Nome|Yakutat|Metlakatla|Boise|Menominee|Adak|Puerto_Rico|St_Thomas|Indiana\/.+|Kentucky\/.+|North_Dakota\/.+)$|^Pacific\/(Honolulu|Guam|Saipan|Pago_Pago|Wake|Midway)$/.test(name)) return 'US';
    if (/^America\/(Toronto|Montreal|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Moncton|Glace_Bay|Goose_Bay|Whitehorse|Dawson|Dawson_Creek|Fort_Nelson|Creston|Iqaluit|Rankin_Inlet|Resolute|Cambridge_Bay|Inuvik|Swift_Current|Atikokan|Blanc-Sablon|Thunder_Bay|Nipigon|Rainy_River|Yellowknife|Pangnirtung)$/.test(name)) return 'Canada';
    if (/^Australia\//.test(name)) return 'Australia';
    if (/^America\/(Sao_Paulo|Bahia|Fortaleza|Recife|Belem|Maceio|Araguaina|Santarem|Manaus|Cuiaba|Campo_Grande|Porto_Velho|Boa_Vista|Rio_Branco|Eirunepe|Noronha)$/.test(name)) return 'Brazil';
    if (/^America\/(Mexico_City|Cancun|Merida|Monterrey|Matamoros|Chihuahua|Ciudad_Juarez|Ojinaga|Hermosillo|Mazatlan|Bahia_Banderas|Tijuana)$/.test(name)) return 'Mexico';
    return '';
  }

  var el = {
    title: root.querySelector('[data-oy-title]'),
    timer: root.querySelector('[data-oy-timer]'),
    msg: root.querySelector('[data-oy-msg]'),
    world: root.querySelector('[data-oy-world]'),
    cloud: document.querySelector('[data-oy-cloud]'),
    ps: document.querySelector('[data-oy-ps]')
  };
  var cells = Array.prototype.slice.call(document.querySelectorAll('[data-oy-cell]'));
  var zoneLabel = tz ? ' (' + tz + ')' : '';
  var country = multiZoneCountry(tz);

  // Which PlayStation caveat applies, and whether it can change the answer before / after local midnight.
  var psKey = 'single';
  var caveatBefore = false;
  var caveatAfter = false;
  if (country === 'US' && !isNaN(psUsUtc)) {
    if (target > psUsUtc) { psKey = 'usWest'; caveatBefore = true; }
    else if (target === psUsUtc) { psKey = 'usEast'; }
    else { psKey = 'usOther'; caveatBefore = true; caveatAfter = true; }
  } else if (country) {
    psKey = 'multi'; caveatBefore = true; caveatAfter = true;
  }
  if (el.ps) {
    el.ps.textContent = fill(S.ps[psKey], { psus: isNaN(psUsUtc) ? '' : when(psUsUtc), country: country }) + ' ' + S.ps.tail;
  }

  // Mark the visitor's own row, and rows that unlock at the same moment.
  cells.forEach(function (cell) {
    var row = cell.parentNode;
    var t = Date.parse(cell.getAttribute('data-oy-cell'));
    if (!row || isNaN(t) || t !== target) return;
    var th = row.querySelector('th');
    if (row.getAttribute('data-tz') === tz) {
      row.classList.add('is-you');
      if (th) th.setAttribute('aria-description', 'Your time zone');
    } else {
      row.classList.add('is-same');
      if (th) th.setAttribute('aria-description', 'Same time as you');
    }
  });

  var lastState = '';
  function tick() {
    var now = Date.now();
    var left = target - now;
    // 'all' = midnight has also passed in the last zone of the table (and here).
    var state = left > 0 ? 'before' : (!isNaN(lastUtc) && now >= lastUtc ? 'all' : 'after');
    var vals = { zone: zoneLabel, utc: utcLabel(target), local: when(target), hms: hms(left) };

    if (state === 'before') {
      if (el.timer) el.timer.textContent = fill(S.status.timerBefore, vals);
    } else if (el.timer && (lastState === '' || lastState === 'before')) {
      el.timer.textContent = fill(S.status.timerAfter, vals);
    }

    if (state !== lastState) {
      root.classList.toggle('is-out', state !== 'before');
      root.classList.toggle('is-waiting', state === 'before');
      if (el.title) {
        el.title.textContent = state === 'before'
          ? (caveatBefore ? S.status.titleBeforeCaveat : S.status.titleBefore)
          : state === 'all' ? S.status.titleAll : (caveatAfter ? S.status.titleAfterCaveat : S.status.titleAfter);
      }
      if (el.msg) el.msg.textContent = fill(state === 'before' ? S.status.msgBefore : S.status.msgAfter, vals);
      lastState = state;
    }

    if (el.cloud && !isNaN(cloudUtc)) {
      var cl = cloudUtc - now;
      var ct = fill(cl > 0 ? S.cloud.before : S.cloud.after, { local: when(cloudUtc), left: roughly(cl) });
      if (el.cloud.textContent !== ct) el.cloud.textContent = ct;
    }

    var out = 0;
    cells.forEach(function (cell) {
      var t = Date.parse(cell.getAttribute('data-oy-cell'));
      if (isNaN(t)) return;
      var isOut = now >= t;
      if (isOut) out += 1;
      var text = isOut ? S.status.cellOut : fill(S.status.cellNotYet, { left: roughly(t - now) });
      if (cell.textContent !== text) cell.textContent = text;
      cell.classList.toggle('oy-yes', isOut);
      cell.classList.toggle('oy-no', !isOut);
    });
    if (el.world && cells.length) {
      var w = out === 0 ? S.status.worldNone
        : fill(out === cells.length ? S.status.worldAll : S.status.worldSome, { n: out, total: cells.length });
      if (el.world.textContent !== w) el.world.textContent = w;
    }
  }

  tick();
  setInterval(tick, 1000);
})();
