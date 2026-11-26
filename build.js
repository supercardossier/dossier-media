#!/usr/bin/env node
// GTA 6 Tools static site generator.
// Zero dependencies: Node built-ins only (fs, path, crypto). Never touches the network.
// Reads data/*.json + src/assets/*, writes dist/. See SECURITY.md before changing anything here.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// ---------------------------------------------------------------------------
// Config
// PLACEHOLDER BASE URL: replace by setting SITE_URL when the real address is known,
// e.g. SITE_URL=https://your-project.vercel.app npm run build
// ---------------------------------------------------------------------------
const PLACEHOLDER_URL = 'https://gta6-tools.invalid';
const SITE_URL = (process.env.SITE_URL || PLACEHOLDER_URL).replace(/\/+$/, '');
// Indexing is OFF unless INDEXABLE=true, so previews and placeholder URLs never get indexed.
const INDEXABLE = process.env.INDEXABLE === 'true';
// Ad slots render as empty, hidden placeholders. No ad code exists in this repo.
const SITE_NAME = 'GTA 6 Tools';
const DISCLAIMER = 'Unofficial fan site, not affiliated with Rockstar Games or Take-Two.';

const sources = readJson('data/sources.json');
const facts = readJson('data/facts.json');
const cars = readJson('data/cars.json');
const completion = readJson('data/completion.json');
const money = readJson('data/money.json');
const vehicles = readJson('data/vehicles.json');
// Optional tool (Nov 24): the update tracker is built only when data/updates.json is present, so a deploy can leave it out.
const updates = fs.existsSync(path.join(ROOT, 'data/updates.json')) ? readJson('data/updates.json') : null;
const CT_ITEMS = completion.groups.flatMap((g) => g.items);
const AS_OF = facts.asOf;
const CAR_TOTAL = cars.sections.reduce((n, s) => n + s.cars.length, 0);

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

// ---------------------------------------------------------------------------
// Safety helpers
// ---------------------------------------------------------------------------
function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const usedSources = new Set();
function requireSources(ids, where) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(`Build blocked: a fact has no source (${where}). Every fact needs one.`);
  }
  for (const id of ids) {
    const s = sources[id];
    if (!s) throw new Error(`Build blocked: unknown source id "${id}" (${where}).`);
    if (!/^https:\/\//.test(s.url)) throw new Error(`Build blocked: source "${id}" is not https.`);
    if (!s.checked) throw new Error(`Build blocked: source "${id}" has no checked date.`);
    usedSources.add(id);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function srcLinks(ids, where, label = 'Source') {
  requireSources(ids, where);
  const parts = ids.map((id) => {
    const s = sources[id];
    const date = s.published ? `, ${fmtDate(s.published)}` : `, checked ${fmtDate(s.checked)}`;
    return `<a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.publisher)}</a>${esc(date)}`;
  });
  const lbl = ids.length > 1 ? `${label}s` : label;
  return `<span class="src">${lbl}: ${parts.join('; ')}</span>`;
}

const STATUS = {
  confirmed: ['Confirmed', 'chip-ok'],
  partial: ['Partly confirmed', 'chip-warn'],
  reported: ['Reported', 'chip-warn'],
  conflict: ['Unclear', 'chip-warn'],
  unknown: ['Not announced', 'chip-unknown'],
  guide: ['Official guide', 'chip-press'],
};
function chip(status) {
  const [text, cls] = STATUS[status] || STATUS.unknown;
  return `<span class="chip ${cls}">${esc(text)}</span>`;
}

// ---------------------------------------------------------------------------
// Time zone math (Intl, built into Node). Used for the launch-time table.
// ---------------------------------------------------------------------------
function offsetMinutes(tz, utcMs) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === 'timeZoneName').value; // e.g. "GMT+13:00" or "GMT"
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}
// UTC instant at which the wall clock in `tz` reads y-m-d 00:00.
function localMidnightUtc(tz, y, m, d) {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let t = guess - offsetMinutes(tz, guess) * 60000;
  t = guess - offsetMinutes(tz, t) * 60000; // second pass handles DST edges
  return t;
}
function fmtIn(tz, utcMs) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(utcMs));
}
function fmtUtc(utcMs) {
  const d = new Date(utcMs);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
function hashOf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
}
const cssBuf = fs.readFileSync(path.join(ROOT, 'src/assets/site.css'));
const jsBuf = fs.readFileSync(path.join(ROOT, 'src/assets/countdown.js'));
const CSS_HREF = `/assets/site.css?v=${hashOf(cssBuf)}`;
const JS_SRC = `/assets/countdown.js?v=${hashOf(jsBuf)}`;
const outYetBuf = fs.readFileSync(path.join(ROOT, 'src/assets/out-yet.js'));
const OUTYET_SRC = `/assets/out-yet.js?v=${hashOf(outYetBuf)}`;
const completionBuf = fs.readFileSync(path.join(ROOT, 'src/assets/completion.js'));
const COMPLETION_SRC = `/assets/completion.js?v=${hashOf(completionBuf)}`;
const moneyBuf = fs.readFileSync(path.join(ROOT, 'src/assets/money.js'));
const MONEY_SRC = `/assets/money.js?v=${hashOf(moneyBuf)}`;
const carsJsBuf = fs.readFileSync(path.join(ROOT, 'src/assets/cars.js'));
const CARS_SRC = `/assets/cars.js?v=${hashOf(carsJsBuf)}`;
const updatesBuf = updates ? fs.readFileSync(path.join(ROOT, 'src/assets/updates.js')) : null;
const UPDATES_SRC = updates ? `/assets/updates.js?v=${hashOf(updatesBuf)}` : null;

// Our own simple body-style icons (no game art). 120x48 viewBox, two wheels + body path.
const ICONS = {
  sports: 'M8 34 L22 26 L46 20 L74 20 L98 27 L112 30 L112 36 L8 36 Z',
  supercar: 'M6 35 L30 25 L58 19 L80 20 L104 28 L114 31 L114 36 L6 36 Z',
  muscle: 'M6 34 L10 27 L36 25 L48 17 L78 17 L90 25 L112 27 L114 36 L6 36 Z',
  classic: 'M4 34 L8 26 L34 24 L44 16 L82 16 L92 24 L114 26 L116 36 L4 36 Z',
  sedan: 'M6 35 L10 27 L32 24 L44 15 L80 15 L94 24 L112 27 L114 36 L6 36 Z',
  suv: 'M6 36 L8 22 L18 21 L30 10 L92 10 L104 21 L114 23 L114 36 Z',
  pickup: 'M6 36 L8 22 L24 21 L32 10 L62 10 L66 21 L114 21 L114 36 Z',
  offroad: 'M8 30 L14 22 L34 20 L44 12 L76 12 L86 20 L108 22 L112 30 Z',
  bike: 'M30 30 L48 18 L66 18 L74 12 L82 14 L76 22 L90 30 Z',
  boat: 'M4 24 L116 24 L104 38 L16 38 Z M40 24 L52 12 L78 12 L84 24 Z',
};
function iconSvg(kind) {
  const body = ICONS[kind];
  const wheels = kind === 'boat' ? ''
    : kind === 'bike' ? '<circle cx="30" cy="34" r="8"/><circle cx="90" cy="34" r="8"/>'
      : '<circle cx="30" cy="36" r="8"/><circle cx="90" cy="36" r="8"/>';
  const water = kind === 'boat' ? '<path d="M2 44 Q 16 40 30 44 T 58 44 T 86 44 T 118 44" fill="none" stroke="#3cf2d6" stroke-width="2"/>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 48" width="120" height="48"><path d="${body}" fill="#ff8a3d"/><g fill="#1a0b2e" stroke="#ff8a3d" stroke-width="3">${wheels}</g>${water}</svg>\n`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
const NAV = [
  ['/100-percent/', '100% tracker'],
  ['/money/', 'Money guide'],
  ['/out-yet/', 'Out yet?'],
  ['/launch-time/', 'Launch time'],
  ['/editions/', 'Editions'],
  ['/cars/', 'Car finder'],
  ...(updates ? [['/updates/', 'Patch notes']] : []),
  ['/file-size/', 'File size'],
  ['/faq/', 'Confirmed facts'],
];

function layout({ urlPath, title, description, body, hero = '', countdown = false, scripts = null, noCanonical = false }) {
  const scriptList = scripts || (countdown ? [JS_SRC] : []);
  if (!title || title.length > 70) throw new Error(`Bad <title> on ${urlPath}: "${title}"`);
  if (!description || description.length > 170) throw new Error(`Bad description length on ${urlPath}`);
  const canonical = SITE_URL + urlPath;
  const nav = NAV.map(([href, label]) => {
    const current = href === urlPath ? ' aria-current="page"' : '';
    return `<a href="${href}"${current}>${esc(label)}</a>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noCanonical ? '' : `<link rel="canonical" href="${esc(canonical)}">\n`}${INDEXABLE ? '' : '<meta name="robots" content="noindex, nofollow">\n'}<meta name="theme-color" content="#1a0b2e">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${noCanonical ? '' : `<meta property="og:url" content="${esc(canonical)}">\n`}<meta property="og:image" content="${esc(SITE_URL)}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="GTA 6 Tools: unofficial launch guide">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/anybody-latin-standard-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/instrument-sans-latin-standard-normal.woff2" as="font" type="font/woff2" crossorigin>
${countdown ? '<link rel="preload" href="/assets/fonts/tilt-neon-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>\n' : ''}<link rel="stylesheet" href="${CSS_HREF}">
${scriptList.map((s) => `<script src="${s}" defer></script>\n`).join('')}</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><span class="brand-sun" aria-hidden="true"></span><span class="brand-name">${esc(SITE_NAME)}</span><span class="brand-tag">unofficial fan guide</span></a>
    <nav aria-label="Main" class="nav">${nav}</nav>
  </div>
</header>
${hero}<main id="main" class="wrap">
${body}
</main>
<div class="ad-slot wrap" data-ad-slot="below-content" hidden></div>
<footer class="site-footer">
  <div class="horizon" aria-hidden="true"></div>
  <div class="wrap">
    <p class="disclaimer"><strong>${esc(DISCLAIMER)}</strong> Grand Theft Auto, GTA VI and related names are trademarks of Take-Two Interactive. We use no Rockstar logos, artwork or screenshots.</p>
    <p>Facts checked ${esc(fmtDate(AS_OF))}. Every fact links to its source. Spot an error? It will be fixed. See <a href="/about/">how we source facts</a>.</p>
    <nav aria-label="Footer" class="footer-nav"><a href="/">Home</a>${nav}<a href="/about/">About &amp; sources</a><a href="/privacy/">Privacy</a><a href="/accessibility/">Accessibility</a></nav>
  </div>
</footer>
</body>
</html>
`;
}

function pageHeader(kicker, h1, lede, asOf = AS_OF) {
  return `<header class="page-head">
  <h1>${esc(h1)}</h1>
  <p class="lede">${lede}</p>
  <p class="asof">Facts checked <time datetime="${esc(asOf)}">${esc(fmtDate(asOf))}</time></p>
</header>`;
}

function sourcesSection(ids, where) {
  requireSources(ids, where);
  const uniq = [...new Set(ids)];
  const items = uniq.map((id) => {
    const s = sources[id];
    const kind = s.kind === 'official' ? 'Official' : 'Press';
    return `<li><span class="chip ${s.kind === 'official' ? 'chip-ok' : 'chip-press'}">${kind}</span> <a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.title)}</a> <span class="muted">(${esc(s.publisher)}${s.published ? `, published ${esc(fmtDate(s.published))}` : s.undated ? ', undated page' : ', live page'}; checked ${esc(fmtDate(s.checked))})</span></li>`;
  }).join('\n');
  return `<section class="sources" aria-labelledby="sources-h"><h2 id="sources-h">Sources for this page</h2><ul>${items}</ul></section>`;
}

function collectSrc(...lists) {
  const out = [];
  for (const l of lists) for (const x of l) out.push(...(x.src || []));
  return out;
}

// The sign has three live states (before your midnight / out in your zone / out everywhere). Every text it can show
// comes from facts.launchState (sourced) and is also stacked invisibly in the same grid cell ("ghosts"), so a state
// change never moves the page. Without JavaScript it shows the text for the build's launch phase (see PHASE).
function countdownBlock(kind) {
  const id = kind === 'hero' ? 'cd-hero' : 'cd-main';
  const LS = facts.launchState;
  const SAMPLE = { zone: ' (America/Argentina/Buenos_Aires)', utc: 'Nov 19, 03:00 UTC', last: 'Wed, Nov 18, 10:00 PM' };
  const fillT = (t) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in SAMPLE ? SAMPLE[k] : m));
  const ghosts = (variants) => variants.map((v) => `<span class="oy-ghost" aria-hidden="true">${esc(fillT(v))}</span>`).join('');
  const out = PHASE !== 'pre';
  const top = PHASE === 'all' ? LS.topAfter : LS.topBefore;
  const big = PHASE === 'all' ? LS.outBig : LS.rollBig;
  const small = PHASE === 'all' ? LS.outAll : LS.rollSmall;
  const note = { pre: LS.noteStatic, rolling: LS.noteRolling, all: LS.noteAllStatic }[PHASE];
  return `<div class="countdown-box sign${out ? ' is-out' : ''}" id="${id}" data-cd-box data-target-local="2026-11-19T00:00:00" data-last-utc="${esc(LAST_ISO)}" data-strings="${esc(JSON.stringify(CD_STRINGS))}">
  <p class="sign-top oy-slot" aria-hidden="true"><span data-cd-top>${esc(top)}</span>${ghosts([LS.topBefore, LS.topAfter])}</p>
  <div class="cd-face">
    <div class="countdown" role="timer" aria-live="off" aria-label="Time until midnight on November 19 in your time zone">
      <div class="cd-unit"><span class="cd-num" data-unit="d">--</span><span class="cd-lbl">days</span></div>
      <div class="cd-unit"><span class="cd-num" data-unit="h">--</span><span class="cd-lbl">hours</span></div>
      <div class="cd-unit"><span class="cd-num" data-unit="m">--</span><span class="cd-lbl">min</span></div>
      <div class="cd-unit"><span class="cd-num" data-unit="s">--</span><span class="cd-lbl">sec</span></div>
    </div>
    <p class="cd-out"><span class="cd-out-big oy-slot"><span data-cd-big>${esc(big)}</span>${ghosts([LS.outBig, LS.rollBig])}</span><span class="cd-out-small oy-slot"><span data-cd-small>${esc(small)}</span>${ghosts([LS.outHere, LS.outAll, LS.rollSmall])}</span></p>
  </div>
  <p class="cd-note oy-slot"><span data-cd-note>${esc(note)}</span>${ghosts([LS.noteStatic, LS.noteRolling, LS.noteAllStatic, LS.noteBefore, LS.noteHere, LS.noteAll])}</p>
${PHASE === 'all' ? '' : `  <noscript><p class="cd-note">The live countdown needs JavaScript. The rule is simple: midnight on November 19 where you live.</p></noscript>
`}</div>`;
}

// ---------------------------------------------------------------------------
// Shared launch-time data (one source of truth for /launch-time/ and /out-yet/)
// ---------------------------------------------------------------------------
const ZONE_ROWS = facts.launch.zones.map((z) => ({ ...z, utc: localMidnightUtc(z.tz, 2026, 11, 19) }))
  .sort((a, b) => a.utc - b.utc);
// A zone may override the time zone abbreviation (e.g. B.C.'s "PCT"); overrides and notes need a source.
for (const z of ZONE_ROWS) if (z.label || z.note) requireSources(z.src, `zone ${z.tz}`);
const zoneLocal = (r) => (r.label ? fmtIn(r.tz, r.utc).replace(/\s\S+$/, ` ${r.label}`) : fmtIn(r.tz, r.utc));
const ZONE_NOTES = ZONE_ROWS.filter((r) => r.note);
const zoneNotesHtml = (where) => ZONE_NOTES.map((r) => `<p class="muted small">${esc(r.note)} ${srcLinks(r.src, `${where} ${r.tz}`)}</p>`).join('\n');
const ZONE_SRC = ZONE_NOTES.flatMap((r) => r.src);
{
  // Self-check against figures stated by the sources: NZ 11:00 UTC Nov 18, UK 00:00 UTC, NY 05:00 UTC.
  const check = { 'Pacific/Auckland': '2026-11-18T11:00:00.000Z', 'Europe/London': '2026-11-19T00:00:00.000Z', 'America/New_York': '2026-11-19T05:00:00.000Z', 'Europe/Berlin': '2026-11-18T23:00:00.000Z' };
  for (const r of ZONE_ROWS) {
    if (check[r.tz] && new Date(r.utc).toISOString() !== check[r.tz]) throw new Error(`Time zone math check failed for ${r.tz}`);
  }
}
// Machine-readable instants must agree with the sourced wording shown on the page.
const CLOUD = facts.launch.confirmed.find((f) => f.utc);
if (!CLOUD || !/06:00 UTC/.test(CLOUD.value) || CLOUD.utc !== '2026-11-19T06:00:00Z') throw new Error('Build blocked: Xbox Cloud instant does not match its sourced text.');
const PS_US_UTC = facts.launch.conflict.psUsStoreUtc;
if (PS_US_UTC !== '2026-11-19T05:00:00Z' || !/05:00 UTC on Nov 19/.test(facts.launch.conflict.body)) throw new Error('Build blocked: PS US store instant does not match its sourced text.');
const UNLOCK_RULE = facts.launch.confirmed.find((f) => /^Unlock rule/.test(f.label));
if (!UNLOCK_RULE) throw new Error('Build blocked: unlock rule fact missing.');
// Launch phase at build time: 'pre' (before New Zealand's midnight), 'rolling', or 'all' (midnight has passed in the
// last zone of the table, UTC-11). It only picks the no-JavaScript text, which must be true from the build onwards;
// the scripts take over live. BUILD_NOW=<ISO time> overrides the clock (for tests).
const FIRST_MS = ZONE_ROWS[0].utc;
const LAST_MS = ZONE_ROWS[ZONE_ROWS.length - 1].utc;
const LAST_ISO = new Date(LAST_MS).toISOString();
if (new Date(FIRST_MS).toISOString() !== '2026-11-18T11:00:00.000Z' || LAST_ISO !== '2026-11-19T11:00:00.000Z') throw new Error('Build blocked: first/last unlock instants changed; update the launchState wording.');
const NOW_MS = process.env.BUILD_NOW ? Date.parse(process.env.BUILD_NOW) : Date.now();
if (Number.isNaN(NOW_MS)) throw new Error('Build blocked: BUILD_NOW is not a valid date.');
const PHASE = NOW_MS < FIRST_MS ? 'pre' : NOW_MS < LAST_MS ? 'rolling' : 'all';
{
  const LS = facts.launchState;
  requireSources(LS.src, 'launch state');
  if (![LS.noteRolling, LS.noteAllStatic, facts.outYet.status.staticMsgAll].every((t) => /11:00 UTC on Nov 19/.test(t)) || !/11:00 UTC on Nov 18/.test(LS.noteRolling)) throw new Error('Build blocked: launch-state wording does not match the first/last unlock instants.');
}
const CD_STRINGS = Object.fromEntries(Object.entries(facts.launchState).filter(([k]) => !['_note', 'src'].includes(k)));
// Script files may not carry factual wording of their own (their sentences come from sourced data attributes).
function assertNoWording(buf, name) {
  const jsText = buf.toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // comments are not shown to visitors
  const literals = jsText.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || [];
  const offenders = literals.filter((x) => /\w+\s+\w+/.test(x) && /PlayStation|PS5|Xbox|Rockstar|UTC|\bET\b|Nov|midnight|unlock|out now|everywhere|rolling/i.test(x));
  if (offenders.length) throw new Error(`Build blocked: ${name} contains unsourced wording: ${offenders.join(', ')}`);
}
assertNoWording(jsBuf, 'countdown.js');
// FAQ items marked showFrom "launch" only appear in builds made after the first unlock.
for (const f of facts.faq) if (f.showFrom && f.showFrom !== 'launch') throw new Error(`Build blocked: unknown showFrom "${f.showFrom}".`);
const FAQ_ITEMS = facts.faq.filter((f) => !f.showFrom || PHASE !== 'pre');

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
const pages = [];

// HOME ----------------------------------------------------------------------
{
  const L = facts.launch.confirmed;
  const cards = [
    ['/100-percent/', 'GTA 6 100% completion tracker', `All ${CT_ITEMS.length} categories that count toward 100%, with targets and weights from the official guide. Enter your progress; it stays on your device.`],
    ['/money/', 'GTA 6 money guide: every way to make money', `${money.methods.length} story-mode money makers, when each one opens and what it pays, compared across named guides, with every disagreement shown. Filter by chapter.`],
    ['/out-yet/', 'Is GTA 6 out yet where I am?', 'Launch-day live check for your time zone, with the PlayStation caveat and a city-by-city status table.'],
    ['/launch-time/', 'Launch time in every time zone', `Live countdown plus a ${facts.launch.zones.length}-zone unlock table. Rockstar: midnight local time on Nov 19.`],
    ['/editions/', 'Editions and platforms compared', 'Standard $79.99, Ultimate $99.99, what the $20 upgrade adds, and which consoles get it.'],
    ['/cars/', 'GTA 6 car finder and the real cars behind them', `${vehicles.vehicles.length} vehicles with class, how to get them, price and speed stat from named guides, plus ${CAR_TOTAL} trailer cars matched to real models. Search and filter.`],
    ...(updates ? [['/updates/', 'GTA 6 patch notes and update tracker', `All ${updates.updates.length} game updates with PS5 and Xbox version numbers, sizes and Rockstar's fixes. Check if your copy is up to date and search the fixes.`]] : []),
    ['/file-size/', 'File size and console requirements', 'Up to 212 GB to pre-load, no disc, 30 fps target, PS5 Pro extras, Xbox One via cloud.'],
    ['/faq/', 'Everything confirmed so far', `${FAQ_ITEMS.length} straight answers with sources, and a clear list of what is still not announced.`],
  ];
  const COUNT_WORD = { 8: 'Eight', 9: 'Nine' }[cards.length];
  if (!COUNT_WORD || cards.length !== NAV.length) throw new Error('Build blocked: home tool count wording does not match the cards and nav.');
  const cardHtml = cards.map(([href, h, p]) => `<li class="tool-row"><a href="${href}"><h2>${esc(h)}</h2><p>${esc(p)}</p></a></li>`).join('\n');
  const hero = `<section class="hero" aria-labelledby="hero-h">
  <div class="sky" aria-hidden="true"></div>
  <img class="skyline" src="/assets/skyline.svg" alt="" width="1600" height="420">
  <div class="wrap hero-inner">
    <h1 id="hero-h">${esc(PHASE === 'all' ? facts.launchState.h1All : 'GTA 6 unlocks at midnight on November 19, wherever you are')}</h1>
    ${countdownBlock('hero')}
  </div>
</section>
`;
  const body = `
<section class="intro">
  <p class="lede">${COUNT_WORD} sourced tools for launch week and after. Every number links to Rockstar, PlayStation, Xbox or a named outlet, with the date we checked it. ${srcLinks(['rs_support_times'], 'home hero')}</p>
  <p class="hero-out"><a href="/out-yet/">Is it out yet where you are? Check live</a></p>
</section>
<ul class="tool-list" aria-label="Tools">
${cardHtml}
</ul>
<section class="quick" aria-labelledby="quick-h">
  <h2 id="quick-h">Quick facts</h2>
  <dl class="facts">
    <div><dt>Release</dt><dd>${esc(L[0].value)} ${srcLinks(L[0].src, 'home release')}</dd></div>
    <div><dt>Platforms</dt><dd>PS5, PS5 Pro, Xbox Series X|S. Xbox One by cloud only. Not on PS4; PC not announced. ${srcLinks(['rs_preorder', 'ps_game_page', 'xbox_wire_cloud'], 'home platforms')}</dd></div>
    <div><dt>Price (US)</dt><dd>$79.99 Standard, $99.99 Ultimate ${srcLinks(['ps_game_page', 'xbox_game_page'], 'home price')}</dd></div>
    <div><dt>Space needed</dt><dd>Up to 212 GB to pre-load ${srcLinks(['rs_preload_nov10'], 'home size')}</dd></div>
  </dl>
</section>
<section class="trust" aria-labelledby="trust-h">
  <h2 id="trust-h">How this site works</h2>
  <p>We only state what Rockstar, Sony or Microsoft has published, or what a named outlet reported, and we say which. Anything not announced is labeled <span class="chip chip-unknown">Not announced</span> instead of guessed. Read more about <a href="/about/">our sourcing rules</a>.</p>
</section>`;
  pages.push({
    urlPath: '/', file: 'index.html', countdown: true, hero,
    title: 'GTA 6 Tools: Launch Countdown, Editions, Real Cars & Facts',
    description: 'Unofficial GTA 6 launch guide: live countdown to midnight Nov 19, editions and prices, real cars behind the game\'s cars, file size and confirmed facts, all sourced.',
    body, srcIds: ['rs_support_times', 'rs_nov19', 'rs_preorder', 'ps_game_page', 'xbox_game_page', 'xbox_wire_cloud', 'rs_preload_nov10'],
  });
}

// LAUNCH TIME ----------------------------------------------------------------
{
  const L = facts.launch;
  const confirmedRows = L.confirmed.map((f, i) => `<div class="fact-row"><dt>${esc(f.label)} ${chip(f.status)}</dt><dd><strong>${esc(f.value)}</strong>${f.note ? `<span class="note">${esc(f.note)}</span>` : ''}${srcLinks(f.src, `launch confirmed ${i}`)}</dd></div>`).join('\n');
  const rows = ZONE_ROWS;
  const tableRows = rows.map((r) => {
    const iso = new Date(r.utc).toISOString();
    return `<tr data-utc="${esc(iso)}"><th scope="row">${esc(r.city)}</th><td data-label="Unlocks (local)">${esc(zoneLocal(r))}</td><td data-label="In UTC">${esc(fmtUtc(r.utc))}</td><td class="yours" data-label="In your time" data-local-time="${esc(iso)}">-</td></tr>`;
  }).join('\n');
  const body = `
${pageHeader('Launch time', 'GTA 6 release time in every time zone', 'Rockstar\'s rule: <strong>GTA VI unlocks at midnight local time on Thursday, November 19, 2026</strong>, on both PS5 and Xbox Series X|S. Here is what that means where you are, and the one detail that is still unclear.')}
${countdownBlock('main')}
<p class="out-link">Launch day? <a href="/out-yet/">Check whether GTA 6 is out yet where you are</a>, live, with every major city's status.</p>
<section aria-labelledby="conf-h">
  <h2 id="conf-h">What is confirmed</h2>
  <dl class="fact-list">${confirmedRows}</dl>
</section>
<section class="callout callout-warn" aria-labelledby="conflict-h">
  <h2 id="conflict-h">${esc(L.conflict.title)} ${chip('conflict')}</h2>
  <p>${esc(L.conflict.body)}</p>
  <p>${srcLinks(L.conflict.src, 'launch conflict')}</p>
</section>
<section aria-labelledby="table-h">
  <h2 id="table-h">Unlock time by time zone</h2>
  <p>Using Rockstar's midnight-local rule, earliest first. The last column converts each one into your time, so you can see when friends abroad start. Times are our own conversions of the official rule.</p>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Unlock times table, scrolls sideways on small screens">
  <table class="zones stack">
    <thead><tr><th scope="col">Where</th><th scope="col">Unlocks (local)</th><th scope="col">Same moment in UTC</th><th scope="col">In your time</th></tr></thead>
    <tbody>
${tableRows}
    </tbody>
  </table>
  </div>
  <p class="muted small">Your row is highlighted if your clock matches one of these zones. "In your time" needs JavaScript; everything else works without it.</p>
  ${zoneNotesHtml('launch zone note')}
</section>
<section aria-labelledby="tips-h">
${PHASE === 'pre' ? `  <h2 id="tips-h">Be ready at midnight</h2>
  <ul class="ticks">
    <li>Pre-load now: it needs up to 212 GB. ${srcLinks(['rs_preload_nov10'], 'launch tip size')}</li>
    <li>PS5: turn on auto-downloads and leave the console on or in Rest Mode. Xbox: turn on automatic updates and use Sleep mode. ${srcLinks(['rs_support_preload'], 'launch tip auto')}</li>
    <li>Code-in-box buyers: there is no disc. Redeem the code as soon as you have it so the pre-load can start. ${srcLinks(['rs_preload_now', 'rs_store_game'], 'launch tip code')}</li>
  </ul>` : `  <h2 id="tips-h">Before you play</h2>
  <ul class="ticks">
    <li>PS5: install the latest system software first. PlayStation Support US said on X (Nov 17) that an update is required before playing GTA VI, as reported by Kotaku. ${srcLinks(['ps_support_x_update', 'kotaku_ps5_update'], 'launch tip ps update')}</li>
    <li>Not downloaded yet? Clear up to 212 GB of free space, Rockstar's pre-load figure. ${srcLinks(['rs_preload_nov10'], 'launch tip size')}</li>
    <li>Code-in-box buyers: there is no disc. Redeem the code to start the download. ${srcLinks(['rs_preload_now', 'rs_store_game'], 'launch tip code')}</li>
  </ul>`}
  <p>Full storage details: <a href="/file-size/">GTA 6 file size and requirements</a>.</p>
</section>
${sourcesSection(collectSrc(L.confirmed, [L.conflict]).concat(['rs_preload_nov10', ...(PHASE === 'pre' ? ['rs_support_preload'] : ['ps_support_x_update', 'kotaku_ps5_update']), 'rs_preload_now', 'rs_store_game'], ZONE_SRC), 'launch sources')}`;
  pages.push({
    urlPath: '/launch-time/', file: 'launch-time/index.html', countdown: true,
    title: 'GTA 6 Release Time in Every Time Zone (Live Countdown)',
    description: `When does GTA 6 unlock? Rockstar says midnight local time on Nov 19, 2026. Live countdown, a ${facts.launch.zones.length}-zone table, Xbox Cloud timing and what is still unclear.`,
    body,
  });
}

// OUT YET (launch-day live status) ------------------------------------------
// Every sentence on this page comes from facts.outYet (sourced). out-yet.js only chooses a string and fills
// {placeholders} with times computed on the visitor's device; the build refuses it if it carries its own wording.
{
  const L = facts.launch;
  const OY = facts.outYet;
  for (const k of ['status', 'cloud', 'ps']) requireSources(OY[k].src, `out-yet ${k}`);
  // Sourced instants must agree with the sentences that mention them.
  if (!/1:00 AM ET/.test(CLOUD.value) || !['static', 'before', 'after'].every((k) => /1:00 AM ET/.test(OY.cloud[k]))) throw new Error('Build blocked: out-yet cloud wording does not match the Xbox Cloud fact.');
  if (!['usWest', 'usEast', 'usOther'].every((k) => /05:00 UTC on Nov 19/.test(OY.ps[k]))) throw new Error('Build blocked: out-yet PS wording does not match the PS Store instant.');
  // out-yet.js may not carry factual wording of its own.
  assertNoWording(outYetBuf, 'out-yet.js');
  const strings = { status: OY.status, cloud: OY.cloud, ps: OY.ps };
  for (const g of Object.values(strings)) delete g._note;
  const tableRows = ZONE_ROWS.map((r) => {
    const iso = new Date(r.utc).toISOString();
    return `<tr data-tz="${esc(r.tz)}"><th scope="row">${esc(r.city)}</th><td data-label="Unlocks (local)">${esc(zoneLocal(r))}</td><td data-label="In UTC">${esc(fmtUtc(r.utc))}</td><td class="oy-cell${PHASE === 'all' ? ' oy-yes' : ''}" data-label="Out yet?" data-oy-cell="${esc(iso)}">${esc(PHASE === 'all' ? OY.status.cellOut : OY.status.cellStatic)}</td></tr>`;
  }).join('\n');
  const first = ZONE_ROWS[0];
  // Layout-shift guard: each live slot also holds every text it can show (filled with sample values), hidden and
  // stacked in the same grid cell, so the slot is always as tall as its longest variant and never moves the page.
  const SAMPLE = { zone: ' (America/Los_Angeles)', utc: 'Nov 19, 08:00 UTC', local: 'Wed, Nov 18, 10:00 PM', hms: '00:00:00', left: '17 h 03 min', psus: 'Wed, Nov 18, 10:00 PM', country: 'Australia', n: '12', total: String(ZONE_ROWS.length) };
  const fillT = (t) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in SAMPLE ? SAMPLE[k] : m));
  const slot = (tag, cls, attrs, shown, variants, id = '') => `<${tag}${id ? ` id="${id}"` : ''} class="${cls} oy-slot"><span ${attrs}>${esc(shown)}</span>${[shown, ...variants].map((v) => `<span class="oy-ghost" aria-hidden="true">${esc(fillT(v))}</span>`).join('')}</${tag}>`;
  const st = OY.status;
  const all = PHASE === 'all';
  const psVariants = ['static', 'usWest', 'usEast', 'usOther', 'multi', 'single'].map((k) => (k === 'static' ? OY.ps.static : `${OY.ps[k]} ${OY.ps.tail}`));
  const body = `
${pageHeader('Launch day', 'Is GTA 6 out yet where you are?', 'Rockstar\'s rule: <strong>GTA VI unlocks at midnight local time on Thursday, November 19, 2026</strong>, on PS5 and Xbox Series X|S. This page checks your device\'s time zone live. Nothing is stored or sent anywhere.')}
<section class="oy${all ? ' is-out' : ''}" aria-labelledby="oy-h" data-outyet data-target-local="2026-11-19T00:00:00" data-cloud-utc="${esc(CLOUD.utc)}" data-ps-us-utc="${esc(PS_US_UTC)}" data-last-utc="${esc(LAST_ISO)}" data-strings="${esc(JSON.stringify(strings))}">
  ${slot('h2', 'oy-title', 'data-oy-title', all ? st.staticTitleAll : st.staticTitle, [st.staticTitle, st.staticTitleAll, st.titleBefore, st.titleBeforeCaveat, st.titleAfter, st.titleAfterCaveat, st.titleAll], 'oy-h')}
  ${slot('p', 'oy-timer', 'data-oy-timer', all ? st.staticTimerAll : st.staticTimer, [st.staticTimer, st.staticTimerAll, st.timerBefore, st.timerAfter])}
  ${slot('p', 'oy-msg', 'data-oy-msg role="status"', all ? st.staticMsgAll : st.staticMsg, [st.staticMsg, st.staticMsgAll, st.msgBefore, st.msgAfter])}
  ${slot('p', 'oy-world', 'data-oy-world', all ? st.worldAll.replace('{total}', String(ZONE_ROWS.length)) : `First unlock: ${first.city} (${fmtUtc(first.utc)}).`, [`First unlock: ${first.city} (${fmtUtc(first.utc)}).`, st.worldNone, st.worldSome, st.worldAll])}
  <p class="oy-src">${srcLinks(OY.status.src, 'out-yet rule')}</p>
</section>
<div class="oy-grid">
<section class="callout" aria-labelledby="oy-cloud-h">
  <h2 id="oy-cloud-h">Xbox Cloud Gaming (Xbox One and streaming)</h2>
  ${slot('p', 'oy-cloud', 'data-oy-cloud', OY.cloud.static, [OY.cloud.before, OY.cloud.after])}
  <p>${srcLinks(OY.cloud.src, 'out-yet cloud')}</p>
</section>
<section class="callout callout-warn" aria-labelledby="oy-ps-h">
  <h2 id="oy-ps-h">PlayStation: one caveat ${chip('conflict')}</h2>
  ${slot('p', 'oy-ps', 'data-oy-ps', OY.ps.static, psVariants.slice(1))}
  <p>${srcLinks(OY.ps.src, 'out-yet ps caveat')} <a href="/launch-time/#conflict-h">Full details on the launch-time page</a>.</p>
</section>
</div>
<section aria-labelledby="oy-table-h">
  <h2 id="oy-table-h">Is it out yet around the world?</h2>
  <p>Rockstar's midnight-local rule for ${ZONE_ROWS.length} major cities and zones, earliest first. The last column updates live. Your own zone is marked "you"; other rows that unlock at the same moment are marked "same time as you". Times are our own conversions of the official rule.</p>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Out-yet status by city">
  <table class="zones stack">
    <thead><tr><th scope="col">Where</th><th scope="col">Unlocks (local)</th><th scope="col">Same moment in UTC</th><th scope="col">Out yet?</th></tr></thead>
    <tbody>
${tableRows}
    </tbody>
  </table>
  </div>
  ${zoneNotesHtml('out-yet zone note')}
</section>
<section aria-labelledby="oy-how-h">
  <h2 id="oy-how-h">How this check works</h2>
  <ul class="ticks">
    <li>Your browser tells this page its time zone and clock. The check runs on your device; nothing is saved or sent.</li>
    <li>If your device clock or time zone is wrong, the answer will be too. Your console's store countdown is the final word.</li>
    <li>Devices with outdated time-zone data (for example in B.C., which stopped changing clocks this month) may show the wrong hour here. The table above is the reference.</li>
    <li>Want the full schedule and what is confirmed? See <a href="/launch-time/">GTA 6 release time in every time zone</a>.</li>
  </ul>
</section>
${sourcesSection([...OY.status.src, ...OY.cloud.src, ...OY.ps.src, ...L.conflict.src, ...ZONE_SRC], 'out-yet sources')}`;
  pages.push({
    urlPath: '/out-yet/', file: 'out-yet/index.html', scripts: [OUTYET_SRC],
    title: 'Is GTA 6 Out Yet Where I Am? Live Launch-Day Check',
    description: 'Live check for your time zone: is GTA 6 unlocked yet on PS5 and Xbox Series X|S? Rockstar says midnight local time on Nov 19, 2026. City table and PS5 caveat.',
    body,
  });
}

// 100% COMPLETION TRACKER (first post-launch tool, Nov 20) -----------------------
// Categories, targets and weights come from data/completion.json (sourced). completion.js only computes numbers from the
// inputs and toggles classes; every word on the page is written here, and the build refuses wording in the script.
{
  requireSources(completion.src, 'completion data');
  for (const [k, n] of Object.entries(completion.notes)) requireSources(n.src, `completion note ${k}`);
  const ids = new Set();
  for (const it of CT_ITEMS) {
    if (!/^[a-z]+$/.test(it.id) || ids.has(it.id)) throw new Error(`Build blocked: bad or duplicate completion id "${it.id}".`);
    ids.add(it.id);
    if (!['count', 'percent', 'dollars'].includes(it.unit)) throw new Error(`Build blocked: unknown unit on ${it.name}.`);
    if (!(Number.isInteger(it.target) && it.target > 0) || !(it.weight > 0)) throw new Error(`Build blocked: bad target/weight on ${it.name}.`);
    if (it.unit === 'percent' && it.target !== 100) throw new Error(`Build blocked: percent target must be 100 (${it.name}).`);
    if (it.guide && !/^[A-Za-z0-9_%]+$/.test(it.guide)) throw new Error(`Build blocked: bad guide path on ${it.name}.`);
    if (it.conflict) requireSources(it.conflict.src, `completion conflict ${it.name}`);
  }
  const sum = CT_ITEMS.reduce((n, it) => n + it.weight, 0);
  const stated = CT_ITEMS.filter((it) => it.weightStated !== false).reduce((n, it) => n + it.weight, 0);
  // The source states 35 categories whose stated weights add to 99%; one blank weight is inferred as 1%.
  if (CT_ITEMS.length !== 35 || sum !== 100 || stated !== 99) throw new Error(`Build blocked: completion data no longer matches the source (categories ${CT_ITEMS.length}, weights ${sum}, stated ${stated}).`);
  if (!completion.notes.categories.text.includes(`${CT_ITEMS.length} categories`)) throw new Error('Build blocked: completion category count in the wording does not match the data.');
  assertNoWording(completionBuf, 'completion.js');
  // The tracker script may not contain words of its own either (beyond the assertNoWording terms): no string literal
  // with two or more words at all.
  const ctLiterals = (completionBuf.toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || []).filter((x) => x.slice(1, -1) !== 'use strict' && /[A-Za-z]+\s+[A-Za-z]+/.test(x));
  if (ctLiterals.length) throw new Error(`Build blocked: completion.js contains wording: ${ctLiterals.join(', ')}`);

  const N = completion.notes;
  const fmtTarget = (it) => (it.unit === 'percent' ? `${it.target}%` : it.unit === 'dollars' ? `$${it.target.toLocaleString('en-US')}` : String(it.target));
  const IGN_BASE = 'https://www.ign.com/wikis/gta-6/';
  const groupHtml = completion.groups.map((g) => {
    const gw = g.items.reduce((n, it) => n + it.weight, 0);
    const rowsHtml = g.items.map((it) => {
      const inferred = it.weightStated === false;
      const worth = `${it.weight}%${inferred ? '<span class="ct-inferred"> (inferred)</span>' : ''}`;
      const guide = it.guide ? ` <a class="ct-guide" href="${esc(IGN_BASE + it.guide)}" rel="noopener noreferrer">IGN guide</a>` : '';
      const step = it.unit === 'dollars' ? 1000 : 1;
      const label = `${it.name}: your progress, out of ${fmtTarget(it)}`;
      const conflict = it.conflict ? `<span class="ct-conflict"><span class="chip chip-dispute">Guides disagree</span> ${esc(it.conflict.text)} ${srcLinks(it.conflict.src, `completion conflict ${it.id}`)}</span>` : '';
      return `<tr data-ct-row="${esc(it.id)}" data-target="${esc(it.target)}" data-weight="${esc(it.weight)}" data-unit="${esc(it.unit)}"${it.conflict ? ' class="has-conflict"' : ''}>
  <th scope="row">${esc(it.name)}${guide}${conflict}</th>
  <td data-label="Target">${esc(fmtTarget(it))}</td>
  <td data-label="Worth">${worth}</td>
  <td data-label="Your progress" class="ct-cell"><span class="ct-in"><input type="number" inputmode="numeric" min="0" max="${esc(it.target)}" step="${step}" value="0" disabled data-ct-input aria-label="${esc(label)}"><button type="button" class="ct-btn" data-ct-max disabled aria-pressed="false" aria-label="${esc(`${it.name}: mark as finished`)}">Done</button></span></td>
  <td data-label="Counts for" class="ct-pts"><span data-ct-pts>0</span> of ${esc(it.weight)}%</td>
</tr>`;
    }).join('\n');
    return `<section aria-labelledby="ct-${esc(g.id)}-h">
  <h2 id="ct-${esc(g.id)}-h">${esc(g.title)} <span class="ct-gw">${gw}% of the total</span></h2>
  <div class="table-wrap" tabindex="0" role="region" aria-label="${esc(g.title)} checklist">
  <table class="ct stack">
    <thead><tr><th scope="col">Category</th><th scope="col">Target</th><th scope="col">Worth</th><th scope="col">Your progress</th><th scope="col">Counts for</th></tr></thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
  </div>
</section>`;
  }).join('\n');
  const body = `
${pageHeader('100% completion', 'GTA 6 100% completion checklist and tracker', `All ${CT_ITEMS.length} categories that count toward 100% in GTA VI, with each target and how much it is worth, from IGN's Official Guide. Enter your progress to estimate your completion; it is saved in this browser only.`, completion.asOf)}
<section class="callout" aria-labelledby="ct-cov-h">
  <h2 id="ct-cov-h">What this covers <span class="chip chip-press">Updated ${esc(fmtDate(completion.asOf))}</span></h2>
  <p>${esc(N.coverage.text)} ${srcLinks(N.coverage.src, 'completion coverage')}</p>
  <p>${esc(N.official.text)} ${srcLinks(N.official.src, 'completion official guide')}</p>
</section>
<section class="ct-summary" aria-labelledby="ct-sum-h" data-completion data-key="${esc(completion.storageKey)}">
  <h2 id="ct-sum-h">Your estimated completion</h2>
  <p class="ct-big"><span data-ct-pct>0.0</span><span class="ct-unit">%</span></p>
  <progress class="ct-bar" data-ct-bar max="100" value="0" aria-labelledby="ct-sum-h">0.0</progress>
  <p class="ct-line"><span data-ct-done>0</span> of ${CT_ITEMS.length} categories finished.</p>
  <p class="ct-slot small"><span data-ct-saved>Your progress is saved in this browser only. Nothing is sent anywhere.</span><span data-ct-nosave>This browser blocks saving, so your progress will be lost when you leave the page.</span></p>
  <p class="ct-reset-line"><button type="button" class="ct-btn ct-reset" data-ct-reset disabled>Clear all progress</button><span class="ct-slot small"><span data-ct-confirm>Press again within 5 seconds to clear everything.</span></span></p>
  <noscript><p>The tracker needs JavaScript. The tables below still work as a printable checklist.</p></noscript>
</section>
${groupHtml}
<section aria-labelledby="ct-how-h">
  <h2 id="ct-how-h">How the percentage is worked out</h2>
  <ul class="ticks">
    <li>${esc(N.categories.text)} ${srcLinks(N.categories.src, 'completion categories')}</li>
    <li>${esc(N.inferred.text)} ${srcLinks(N.inferred.src, 'completion inferred')}</li>
    <li>${esc(N.conflicts.text)} ${srcLinks(N.conflicts.src, 'completion conflicts')}</li>
    <li>${esc(N.partial.text)} ${srcLinks(N.partial.src, 'completion partial')}</li>
    <li>${esc(N.stats.text)} ${srcLinks(N.stats.src, 'completion stats')}</li>
  </ul>
</section>
<section class="callout" aria-labelledby="ct-rule-h">
  <h2 id="ct-rule-h">What we leave out on purpose</h2>
  <p>Leaked lists, datamined counts and unverified "all locations" claims. Item lists will appear here only when an official or named source has published them, with a date.</p>
</section>
${sourcesSection([...completion.src, ...Object.values(N).flatMap((n) => n.src), ...CT_ITEMS.flatMap((it) => (it.conflict ? it.conflict.src : []))], 'completion sources')}`;
  pages.push({
    urlPath: '/100-percent/', file: '100-percent/index.html', scripts: [COMPLETION_SRC], lastmod: completion.asOf,
    title: 'GTA 6 100% Completion Checklist & Tracker (All 35 Categories)',
    description: 'Every GTA 6 category that counts toward 100% completion, with targets and weights from IGN\'s Official Guide. Track your progress; it stays on your device.',
    body,
  });
}

// MONEY GUIDE (second post-launch tool, Nov 21) ----------------------------------
// Methods, unlock points and payouts come from data/money.json. Rockstar publishes no payout table, so each fact carries
// a status: two or more named sources agreeing, disagreeing (all figures shown), one source only, or not yet stated.
// money.js only hides rows that open later than the chosen story stage; it carries no wording (the build checks).
{
  const MSTATUS = {
    confirmed: ['Rockstar', 'chip-ok'],
    reported: ['Rockstar, via press', 'chip-press'],
    agree: ['Guides agree', 'chip-likely'],
    disagree: ['Guides disagree', 'chip-dispute'],
    single: ['One guide only', 'chip-warn'],
    unknown: ['Not yet confirmed', 'chip-unknown'],
  };
  const mchip = (s) => `<span class="chip ${MSTATUS[s][1]}">${esc(MSTATUS[s][0])}</span>`;
  const STAGES = new Map(money.stages.map((s) => [s.n, s.label]));
  // Every fact: known status, sources present, and the status must fit the sources behind it.
  const checkFact = (f, where, allowed) => {
    if (!f || typeof f.text !== 'string' || !f.text.trim()) throw new Error(`Build blocked: money fact without text (${where}).`);
    if (!allowed.includes(f.status)) throw new Error(`Build blocked: money status "${f.status}" not allowed (${where}).`);
    requireSources(f.src, `money ${where}`);
    const uniq = new Set(f.src);
    if (uniq.size !== f.src.length) throw new Error(`Build blocked: duplicate source on money ${where}.`);
    if (['agree', 'disagree'].includes(f.status) && uniq.size < 2) throw new Error(`Build blocked: "${f.status}" needs two or more sources (money ${where}).`);
    if (f.status === 'confirmed' && !f.src.every((id) => sources[id].kind === 'official')) throw new Error(`Build blocked: "confirmed" needs official sources only (money ${where}).`);
    if (/\b(leak\w*|datamin\w*|rumou?r\w*)\b|\binsider\b(?! Gaming)/i.test(f.text)) throw new Error(`Build blocked: leak/rumor wording in money ${where}.`);
  };
  const FACT_STATES = ['agree', 'disagree', 'single', 'unknown'];
  for (const o of money.official) checkFact(o, `official ${o.id}`, ['confirmed', 'reported']);
  for (const t of money.tips) checkFact(t, `tip ${t.id}`, FACT_STATES);
  for (const [k, n] of Object.entries(money.notes)) requireSources(n.src, `money note ${k}`);
  const mids = new Set();
  for (const m of money.methods) {
    if (!/^[a-z0-9]+$/.test(m.id) || mids.has(m.id)) throw new Error(`Build blocked: bad or duplicate money id "${m.id}".`);
    mids.add(m.id);
    if (m.from !== null && !STAGES.has(m.from)) throw new Error(`Build blocked: unknown stage ${m.from} on ${m.name}.`);
    checkFact(m.opens, `${m.id} opens`, FACT_STATES);
    checkFact(m.pay, `${m.id} pay`, FACT_STATES);
    for (const [i, n] of (m.notes || []).entries()) checkFact(n, `${m.id} note ${i}`, FACT_STATES);
    // A method with no known stage must say so; a known stage cannot be labelled unknown.
    if ((m.from === null) !== (m.opens.status === 'unknown')) throw new Error(`Build blocked: stage and "opens" status disagree on ${m.name}.`);
  }
  if (!money.notes.coverage.text.includes(`${money.methods.length} ways`)) throw new Error('Build blocked: money method count in the wording does not match the data.');
  assertNoWording(moneyBuf, 'money.js');
  const mnLiterals = (moneyBuf.toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || []).filter((x) => x.slice(1, -1) !== 'use strict' && /[A-Za-z]+\s+[A-Za-z]+/.test(x));
  if (mnLiterals.length) throw new Error(`Build blocked: money.js contains wording: ${mnLiterals.join(', ')}`);

  const factHtml = (f, where) => `${mchip(f.status)} ${esc(f.text)} ${srcLinks(f.src, `money ${where}`)}`;
  const rowsHtml = money.methods.map((m) => {
    const notes = (m.notes || []).map((n, i) => `<span class="mn-note">${factHtml(n, `${m.id} note ${i}`)}</span>`).join('');
    const stage = m.from === null ? '' : `<span class="mn-stage">${esc(STAGES.get(m.from))}</span>`;
    return `<tr data-mn-row="${esc(m.id)}" data-from="${m.from === null ? '' : esc(m.from)}">
  <th scope="row">${esc(m.name)}${stage}${notes}</th>
  <td data-label="When it opens">${factHtml(m.opens, `${m.id} opens`)}</td>
  <td data-label="What it pays">${factHtml(m.pay, `${m.id} pay`)}</td>
</tr>`;
  }).join('\n');
  const options = [`<option value="0">Show all</option>`, ...money.stages.map((s) => `<option value="${esc(s.n)}">${esc(s.label)}</option>`)].join('');
  const N = money.notes;
  const legend = ['confirmed', 'reported', 'agree', 'disagree', 'single', 'unknown'];
  const legendText = {
    confirmed: 'Rockstar said it on its own site (Rockstar Support).',
    reported: 'A Rockstar developer said it in an interview, as reported by a named outlet.',
    agree: 'Two or more named guide sites state the same figure or chapter.',
    disagree: 'Named guide sites give different figures; we show all of them.',
    single: 'Only one named guide states it so far.',
    unknown: 'No source we read states it yet.',
  };
  const allMoneySrc = [
    ...money.official.flatMap((o) => o.src), ...money.tips.flatMap((t) => t.src), ...Object.values(N).flatMap((n) => n.src),
    ...money.methods.flatMap((m) => [...m.opens.src, ...m.pay.src, ...(m.notes || []).flatMap((n) => n.src)]),
  ];
  const body = `
${pageHeader('Money', 'GTA 6 money guide: every way to make money, compared', `Rockstar says money matters more in GTA VI than in earlier games, and some missions wait until you can pay. Here are ${money.methods.length} ways to make money in story mode, when each one opens and what it pays, with the figures from each named guide side by side.`, money.asOf)}
<section class="callout" aria-labelledby="mn-cov-h">
  <h2 id="mn-cov-h">What this covers <span class="chip chip-press">Updated ${esc(fmtDate(money.asOf))}</span></h2>
  <p>${esc(N.coverage.text)} ${srcLinks(N.coverage.src, 'money coverage')}</p>
  <p>${esc(N.method.text)} ${srcLinks(N.method.src, 'money method')}</p>
</section>
<section aria-labelledby="mn-rs-h">
  <h2 id="mn-rs-h">What Rockstar has said about money</h2>
  <ul class="ticks plain">
${money.official.map((o) => `    <li>${factHtml(o, `official ${o.id}`)}</li>`).join('\n')}
  </ul>
</section>
<section class="mn" aria-labelledby="mn-h" data-money>
  <h2 id="mn-h">Ways to make money, by when they open</h2>
  <div class="mn-filter">
    <label for="mn-stage">Where are you in the story?</label>
    <select id="mn-stage" data-mn-stage disabled>${options}</select>
    <p class="mn-count small" aria-live="polite">Showing <span data-mn-count>${money.methods.length}</span> of ${money.methods.length} ways. Ways with no confirmed unlock point always stay in the list.</p>
    <noscript><p class="small">The chapter filter needs JavaScript. The full table below works without it.</p></noscript>
  </div>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Money-making methods table">
  <table class="mn-table stack">
    <thead><tr><th scope="col">Method</th><th scope="col">When it opens</th><th scope="col">What it pays</th></tr></thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
  </div>
</section>
<section aria-labelledby="mn-tips-h">
  <h2 id="mn-tips-h">Money tips from the guides</h2>
  <ul class="ticks plain">
${money.tips.map((t) => `    <li>${factHtml(t, `tip ${t.id}`)}</li>`).join('\n')}
  </ul>
  <p>${esc(N.tracker.text)} ${srcLinks(N.tracker.src, 'money tracker')} Track it on the <a href="/100-percent/">GTA 6 100% completion tracker</a>.</p>
</section>
<section class="callout" aria-labelledby="mn-legend-h">
  <h2 id="mn-legend-h">How to read the labels</h2>
  <ul class="legend">
${legend.map((s) => `    <li>${mchip(s)} ${esc(legendText[s])}</li>`).join('\n')}
  </ul>
  <p class="small">${esc(N.independence.text)} ${srcLinks(N.independence.src, 'money independence')}</p>
</section>
<section class="callout" aria-labelledby="mn-rule-h">
  <h2 id="mn-rule-h">What we leave out on purpose</h2>
  <p>Leaked or datamined figures, "unlimited money glitch" videos, per-location lists copied from other guides, and anything we could not tie to a named source and a date.</p>
</section>
${sourcesSection(allMoneySrc, 'money sources')}`;
  pages.push({
    urlPath: '/money/', file: 'money/index.html', scripts: [MONEY_SRC], lastmod: money.asOf,
    title: 'GTA 6 Money Guide: Every Way to Make Money, Compared',
    description: `How to make money in GTA 6: ${money.methods.length} story-mode methods with when each opens and what it pays, compared across named guides. Filter by chapter.`,
    body,
  });
}

// EDITIONS ------------------------------------------------------------------
{
  const E = facts;
  const edRows = E.editions.map((e, i) => `<article class="edition">
  <header><h3>${esc(e.name)}</h3><p class="price">${esc(e.price)}</p>${chip(e.status)}</header>
  <p class="muted">${esc(e.formats)}</p>
  <ul>${e.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  ${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
  <p>${srcLinks(e.src, `edition ${i}`)}</p>
</article>`).join('\n');
  const ult = E.ultimateContents.map((u) => `<tr><th scope="row">${esc(u.item)}</th><td>${esc(u.detail)}</td></tr>`).join('');
  const plat = E.platforms.map((p, i) => `<tr><th scope="row">${esc(p.platform)}</th><td data-label="Status">${chip(p.level)} ${esc(p.status)}${p.note ? `<span class="note">${esc(p.note)}</span>` : ''}</td><td>${srcLinks(p.src, `platform ${i}`)}</td></tr>`).join('\n');
  const body = `
${pageHeader('Editions & platforms', 'GTA 6 editions and platforms compared', 'Only what Rockstar, PlayStation and Xbox have officially listed. Two editions of the game, one upgrade, one pre-order bonus, and a $399.99 collector\'s box that does not include the game. US prices; other countries differ.')}
<section aria-labelledby="ed-h">
  <h2 id="ed-h">The editions</h2>
  <div class="edition-grid">${edRows}</div>
</section>
<section aria-labelledby="ult-h">
  <h2 id="ult-h">What the Ultimate Edition adds</h2>
  <p>The $20 difference buys this in-game content (official descriptions, shortened):</p>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Ultimate Edition contents table, scrolls sideways on small screens"><table><thead><tr><th scope="col">Item</th><th scope="col">What it is</th></tr></thead><tbody>${ult}</tbody></table></div>
  <p>${srcLinks(E.ultimateSrc, 'ultimate contents')}</p>
  <p>Car fan? See how to get these cars and which real cars they are based on in <a href="/cars/">the GTA 6 car finder</a>.</p>
</section>
<section aria-labelledby="pre-h">
  <h2 id="pre-h">Pre-order bonus and GTA+</h2>
  <p><strong>Vintage Vice City Pack:</strong> ${E.preorderBonus.items.map(esc).join(', ')}. ${esc(E.preorderBonus.rule)} ${srcLinks(E.preorderBonus.src, 'preorder bonus')}</p>
  <p><strong>GTA+:</strong> ${esc(E.gtaPlus.text)} ${srcLinks(E.gtaPlus.src, 'gta plus')}</p>
</section>
<section class="callout" aria-labelledby="ce-h">
  <h2 id="ce-h">${esc(E.collectors.name)}: ${esc(E.collectors.price)}</h2>
  <p>${esc(E.collectors.text)}</p>
  <p>${srcLinks(E.collectors.src, 'collectors')}</p>
</section>
<section aria-labelledby="plat-h">
  <h2 id="plat-h">Which consoles get GTA 6?</h2>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Platforms table, scrolls sideways on small screens"><table class="platforms stack"><thead><tr><th scope="col">Platform</th><th scope="col">Status</th><th scope="col">Source</th></tr></thead><tbody>
${plat}
  </tbody></table></div>
</section>
<section aria-labelledby="unk-h">
  <h2 id="unk-h">Still unknown</h2>
  <ul class="ticks">
    <li>${chip('unknown')} A PC version and its price.</li>
    <li>${chip('unknown')} A disc release. Only a code-in-box physical version has been announced.</li>
    <li>${chip('unknown')} The PlayStation price of the Ultimate Edition Upgrade (listed, but we couldn't read the price; checked again Nov 18).</li>
  </ul>
</section>
${sourcesSection(collectSrc(E.editions, E.platforms, [E.preorderBonus, E.gtaPlus, E.collectors]).concat(E.ultimateSrc), 'editions sources')}`;
  pages.push({
    urlPath: '/editions/', file: 'editions/index.html',
    title: 'GTA 6 Editions Compared: Standard vs Ultimate, Prices & Platforms',
    description: 'GTA 6 Standard ($79.99) vs Ultimate ($99.99): what the Ultimate Edition adds, the pre-order bonus, the $399.99 collector\'s box, and every platform, all sourced.',
    body,
  });
}

// CARS ------------------------------------------------------------------------
{
  const LBL = {
    strong: ['Strong match', 'chip-ok'],
    likely: ['Likely', 'chip-likely'],
    possible: ['Possible', 'chip-warn'],
    disputed: ['Outlets disagree', 'chip-dispute'],
    none: ['No match yet', 'chip-unknown'],
  };
  const NAME = { official: 'Official name', reported: 'Reported name', unnamed: 'Name not reported' };
  let total = 0;
  const counts = { strong: 0, likely: 0, possible: 0, disputed: 0, none: 0 };
  const quick = [];
  const sectionsHtml = cars.sections.map((sec) => {
    const cards = sec.cars.map((c, i) => {
      if (!LBL[c.match]) throw new Error(`Bad match level on ${c.game}`);
      if (!ICONS[c.body]) throw new Error(`Bad body icon on ${c.game}`);
      if (c.match !== 'none' && !c.real) throw new Error(`Car ${c.game} has a match level but no real car`);
      total += 1; counts[c.match] += 1;
      quick.push(c);
      const [mtxt, mcls] = LBL[c.match];
      return `<article class="car" id="${esc(sec.id)}-${i}">
  <div class="car-top"><img class="car-icon" src="/assets/icons/${esc(c.body)}.svg" alt="" width="120" height="48" loading="lazy"><span class="chip ${mcls}">${esc(mtxt)}</span></div>
  <h3>${esc(c.game)}</h3>
  <p class="name-status">${esc(NAME[c.nameStatus])} · seen in ${esc(sec.seen)}</p>
  <p class="real"><span class="real-lbl">Real car</span> ${c.real ? esc(c.real) : '<span class="muted">Not established</span>'}</p>
  <p class="role">${esc(c.role)}</p>
  <p class="why">${esc(c.why)}</p>
  <p>${srcLinks(c.src, `car ${c.game}`)}</p>
</article>`;
    }).join('\n');
    const traffic = sec.traffic ? `<p class="traffic">${esc(sec.traffic.text)} ${srcLinks(sec.traffic.src, 'traffic')}</p>` : '';
    return `<section class="car-section" id="${esc(sec.id)}" aria-labelledby="${esc(sec.id)}-h">
  <h2 id="${esc(sec.id)}-h">${esc(sec.title)}</h2>
  <p>${esc(sec.intro)}</p>
  <div class="car-grid">${cards}</div>
  ${traffic}
</section>`;
  }).join('\n');
  const quickRows = quick.filter((c) => c.real).map((c) => {
    const [mtxt, mcls] = LBL[c.match];
    return `<tr><th scope="row">${esc(c.game)}</th><td>${esc(c.real)}</td><td><span class="chip ${mcls}">${esc(mtxt)}</span></td></tr>`;
  }).join('\n');
  const legend = cars.legend;
  const builds = cars.builds;
  const buildRows = builds.cars.map((b) => `<li><strong>${esc(b.game)}</strong>: ${esc(b.detail)}</li>`).join('');
  const toc = '<a href="#vf-h">Vehicle finder</a>' + cars.sections.map((s) => `<a href="#${esc(s.id)}">${esc(s.title)}</a>`).join('') + '<a href="#builds">Real-life builds</a><a href="#quick-list">Quick list</a>';
  const allSrc = [];
  for (const s of cars.sections) { for (const c of s.cars) allSrc.push(...c.src); if (s.traffic) allSrc.push(...s.traffic.src); }
  allSrc.push(...builds.src);

  // VEHICLE FINDER (third post-launch tool, Nov 22) ------------------------------
  // Rows come from data/vehicles.json. Rockstar publishes no vehicle list, prices or stats, so each field carries a
  // status: Rockstar, two or more publishers agreeing, sources disagreeing (all shown), or one guide only. A missing
  // field is shown as not reported, never guessed. cars.js only filters, sorts and counts rows; it carries no wording.
  const V = vehicles.vehicles;
  const VSTATUS = {
    official: ['Official', 'chip-ok'],
    agree: ['Guides agree', 'chip-likely'],
    disagree: ['Sources disagree', 'chip-dispute'],
    single: ['One guide only', 'chip-warn'],
  };
  const vchip = (s) => `<span class="chip ${VSTATUS[s][1]}">${esc(VSTATUS[s][0])}</span>`;
  const LEAKY = /\b(leak\w*|datamin\w*|rumou?r\w*)\b|\binsider\b(?! Gaming)/i;
  const checkV = (f, where, needText = true) => {
    if (!f || typeof f !== 'object') throw new Error(`Build blocked: vehicle fact missing (${where}).`);
    if (needText && (typeof f.text !== 'string' || !f.text.trim() || f.text.length > 400)) throw new Error(`Build blocked: vehicle fact without usable text (${where}).`);
    if (!VSTATUS[f.status]) throw new Error(`Build blocked: vehicle status "${f.status}" not allowed (${where}).`);
    requireSources(f.src, `vehicle ${where}`);
    if (new Set(f.src).size !== f.src.length) throw new Error(`Build blocked: duplicate source on vehicle ${where}.`);
    const pubs = new Set(f.src.map((id) => sources[id].publisher.replace(/\s*\(.*\)$/, '')));
    if (f.status === 'agree' && pubs.size < 2) throw new Error(`Build blocked: "agree" needs two or more different publishers (vehicle ${where}).`);
    // "agree" must be explicit per source: every cited source carries its own claim note (what that source states), and
    // the claims must come from two or more publishers. Claims are only allowed where they can be checked this way.
    if (f.claims !== undefined || f.status === 'agree') {
      const cl = f.claims && typeof f.claims === 'object' && !Array.isArray(f.claims) ? f.claims : null;
      if (!cl) throw new Error(`Build blocked: "agree" needs a claim note from each source (vehicle ${where}).`);
      const keys = Object.keys(cl);
      if (keys.some((k) => !f.src.includes(k))) throw new Error(`Build blocked: claim from a source the fact does not cite (vehicle ${where}).`);
      if (!f.src.every((id) => typeof cl[id] === 'string' && cl[id].trim().length >= 3 && cl[id].length <= 200)) throw new Error(`Build blocked: every cited source needs its own claim note (vehicle ${where}).`);
      const claimPubs = new Set(keys.map((id) => sources[id].publisher.replace(/\s*\(.*\)$/, '')));
      if (f.status === 'agree' && claimPubs.size < 2) throw new Error(`Build blocked: "agree" needs claims from two or more publishers (vehicle ${where}).`);
    }
    if (f.status === 'disagree' && f.src.length < 2) throw new Error(`Build blocked: "disagree" needs two or more sources (vehicle ${where}).`);
    if (f.status === 'single' && pubs.size !== 1) throw new Error(`Build blocked: "single" must cite one publisher only (vehicle ${where}).`);
    if (f.status === 'official' && !f.src.every((id) => sources[id].kind === 'official')) throw new Error(`Build blocked: "official" needs official sources only (vehicle ${where}).`);
    if (needText && LEAKY.test(f.text)) throw new Error(`Build blocked: leak/rumor wording in vehicle ${where}.`);
  };
  const CLASS_IDS = new Map(vehicles.classes.map((c) => [c.id, c.label]));
  const TRACKERS = ['None', 'Standard', 'Advanced', 'Military'];
  const carRef = (ref, where) => {
    const m = /^([a-z0-9]+)\/(.+)$/.exec(ref || '');
    const sec = m && cars.sections.find((s) => s.id === m[1]);
    const i = sec ? sec.cars.findIndex((c) => c.game === m[2]) : -1;
    if (i < 0) throw new Error(`Build blocked: vehicle ${where} links to a car that is not on the real-cars list ("${ref}").`);
    return { sec, i, car: sec.cars[i] };
  };
  const vids = new Set();
  for (const v of V) {
    if (!/^[a-z0-9]+$/.test(v.id) || vids.has(v.id)) throw new Error(`Build blocked: bad or duplicate vehicle id "${v.id}".`);
    vids.add(v.id);
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 80 || LEAKY.test(v.name)) throw new Error(`Build blocked: bad vehicle name on ${v.id}.`);
    if (!Array.isArray(v.classes) || !v.classes.every((c) => CLASS_IDS.has(c)) || new Set(v.classes).size !== v.classes.length) throw new Error(`Build blocked: unknown or repeated class on ${v.id}.`);
    if ((v.class === null) !== (v.classes.length === 0)) throw new Error(`Build blocked: class text and class filter disagree on ${v.id}.`);
    if (v.class !== null) checkV(v.class, `${v.id} class`);
    if (v.get !== null) checkV(v.get, `${v.id} get`);
    for (const [i, n] of (v.notes || []).entries()) checkV(n, `${v.id} note ${i}`);
    if (v.real !== null) checkV(v.real, `${v.id} real`);
    if (v.price !== null) {
      checkV(v.price, `${v.id} price`, false);
      const ok = (x) => x === null || (Number.isInteger(x) && x > 0 && x < 100000000);
      if (!ok(v.price.sell) || !ok(v.price.register) || (v.price.sell === null && v.price.register === null)) throw new Error(`Build blocked: bad price on ${v.id}.`);
      if (!TRACKERS.includes(v.price.tracker)) throw new Error(`Build blocked: unknown tracker on ${v.id}.`);
    }
    if (v.speed !== null) {
      checkV(v.speed, `${v.id} speed`, false);
      if (typeof v.speed.value !== 'number' || !(v.speed.value >= 0 && v.speed.value <= 10) || Math.round(v.speed.value * 10) !== v.speed.value * 10) throw new Error(`Build blocked: speed stat on ${v.id} must be 0-10 with one decimal.`);
    }
    if (v.cars !== undefined) carRef(v.cars, v.id);
  }
  for (const r of vehicles.rules) checkV(r, `rule ${r.id}`);
  for (const [k, n] of Object.entries(vehicles.notes)) { requireSources(n.src, `vehicle note ${k}`); if (LEAKY.test(n.text)) throw new Error(`Build blocked: leak/rumor wording in vehicle note ${k}.`); }
  if (!vehicles.notes.coverage.text.includes(`${V.length} vehicles`)) throw new Error('Build blocked: vehicle count in the coverage wording does not match the data.');
  assertNoWording(carsJsBuf, 'cars.js');
  const vfLiterals = (carsJsBuf.toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || []).filter((x) => x.slice(1, -1) !== 'use strict' && /[A-Za-z]+\s+[A-Za-z]+/.test(x));
  if (vfLiterals.length) throw new Error(`Build blocked: cars.js contains wording: ${vfLiterals.join(', ')}`);

  // Default order (also the no-JavaScript order): highest speed stat first, then vehicles without one, in data order.
  const sorted = V.map((v, i) => ({ v, i })).sort((a, b) => ((b.v.speed ? b.v.speed.value : -1) - (a.v.speed ? a.v.speed.value : -1)) || a.i - b.i).map((x) => x.v);
  const money$ = (n) => `$${n.toLocaleString('en-US')}`;
  const vfact = (f, where) => `${vchip(f.status)} ${esc(f.text)} ${srcLinks(f.src, `vehicle ${where}`)}`;
  const none = (t) => `<span class="vf-none">${esc(t)}</span>`;
  const vRows = sorted.map((v) => {
    const cls = v.class ? `<span class="vf-class">${vfact(v.class, `${v.id} class`)}</span>` : `<span class="vf-class">${none('Class not reported yet.')}</span>`;
    const notes = (v.notes || []).map((n, i) => `<span class="vf-note">${vfact(n, `${v.id} note ${i}`)}</span>`).join('');
    const get = v.get ? vfact(v.get, `${v.id} get`) : none('No guide lists where to find one yet. See how you get cars above.');
    let price = none('Not reported yet.');
    if (v.price) {
      const p = v.price;
      const parts = [];
      if (p.sell !== null) parts.push(`Sells for <strong>${esc(money$(p.sell))}</strong> stolen`);
      parts.push(p.register !== null ? `costs <strong>${esc(money$(p.register))}</strong> to register` : 'no register cost listed');
      price = `${vchip(p.status)} ${parts.join('; ')}. Tracker: ${esc(p.tracker.toLowerCase())}. ${srcLinks(p.src, `vehicle ${v.id} price`)}`;
    }
    const speed = v.speed ? `<span class="vf-speed"><strong>${esc(v.speed.value.toFixed(1))}</strong> of 10</span> ${vchip(v.speed.status)} ${srcLinks(v.speed.src, `vehicle ${v.id} speed`)}` : none('Not reported yet.');
    let real = v.real ? vfact(v.real, `${v.id} real`) : none('No guide names one yet.');
    if (v.cars !== undefined) {
      const { sec, i, car } = carRef(v.cars, v.id);
      const [mtxt, mcls] = LBL[car.match];
      real += `<span class="vf-note">Car journalists, on our trailer list: ${car.real ? esc(car.real) : 'no match yet'} <span class="chip ${mcls}">${esc(mtxt)}</span> <a href="#${esc(sec.id)}-${i}">See the ${esc(car.game)} card</a></span>`;
    }
    return `<tr data-vf-row id="v-${esc(v.id)}" data-name="${esc(v.name)}" data-classes="${esc(v.classes.join(' '))}" data-speed="${v.speed ? esc(v.speed.value.toFixed(1)) : ''}" data-sell="${v.price && v.price.sell !== null ? esc(v.price.sell) : ''}">
  <th scope="row"><span class="vf-name">${esc(v.name)}</span>${cls}${notes}</th>
  <td data-label="How to get it">${get}</td>
  <td data-label="Price">${price}</td>
  <td data-label="Speed stat">${speed}</td>
  <td data-label="Real-life car">${real}</td>
</tr>`;
  }).join('\n');
  const fastest = sorted.filter((v) => v.speed).slice(0, 3).map((v, i) => `${esc(v.name)} (${esc(v.speed.value.toFixed(1))}${i === 0 ? ' of 10' : ''})`);
  const VN = vehicles.notes;
  const classOptions = ['<option value="all">All classes</option>', ...vehicles.classes.map((c) => `<option value="${esc(c.id)}">${esc(c.label)} (${V.filter((v) => v.classes.includes(c.id)).length})</option>`)].join('');
  const vSrc = [
    ...V.flatMap((v) => [v.class, v.get, v.real, v.price, v.speed, ...(v.notes || [])].filter(Boolean).flatMap((f) => f.src)),
    ...vehicles.rules.flatMap((r) => r.src), ...Object.values(VN).flatMap((n) => n.src),
  ];
  const finderHtml = `<section class="callout" aria-labelledby="vf-cov-h">
  <h2 id="vf-cov-h">What this covers <span class="chip chip-press">Updated ${esc(fmtDate(vehicles.asOf))}</span></h2>
  <p>${esc(VN.coverage.text)} ${srcLinks(VN.coverage.src, 'vehicle coverage')}</p>
  <p><strong>Fastest in this finder by the in-game speed stat:</strong> ${fastest.slice(0, -1).join(', ')} and ${fastest[fastest.length - 1]}. ${esc(VN.speed.text)} ${srcLinks(VN.speed.src, 'vehicle speed note')}</p>
</section>
<section class="vf" aria-labelledby="vf-h" data-finder>
  <h2 id="vf-h">Vehicle finder</h2>
  <div class="vf-controls">
    <p class="vf-field vf-field-search"><label for="vf-search">Find a vehicle by name</label><input id="vf-search" type="search" maxlength="60" autocomplete="off" spellcheck="false" disabled data-vf-search></p>
    <p class="vf-field"><label for="vf-class">Class</label><select id="vf-class" disabled data-vf-class>${classOptions}</select></p>
    <p class="vf-field"><label for="vf-sort">Sort by</label><select id="vf-sort" disabled data-vf-sort><option value="speed">Speed stat, fastest first</option><option value="sell">Sell value, highest first</option><option value="name">Name, A to Z</option></select></p>
    <p class="vf-count small" aria-live="polite">Showing <span data-vf-count>${V.length}</span> of ${V.length} vehicles. A vehicle whose class the sources disagree on is listed under each class they name.</p>
    <noscript><p class="small">Search, filter and sort need JavaScript. The full table below, fastest first, works without it.</p></noscript>
  </div>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Vehicle finder table">
  <table class="vf-table stack">
    <thead><tr><th scope="col">Vehicle and class</th><th scope="col">How to get it</th><th scope="col">Price</th><th scope="col">Speed stat</th><th scope="col">Real-life car</th></tr></thead>
    <tbody data-vf-body>
${vRows}
    </tbody>
  </table>
  </div>
  <p class="vf-empty" data-vf-empty hidden>No vehicle matches. Try fewer letters, or pick All classes.</p>
  <p class="small">${esc(VN.price.text)} ${srcLinks(VN.price.src, 'vehicle price note')}</p>
  <p class="small">${esc(VN.supercars.text)} ${srcLinks(VN.supercars.src, 'vehicle supercars note')}</p>
</section>
<section aria-labelledby="vf-how-h">
  <h2 id="vf-how-h">How you get cars in GTA 6</h2>
  <ul class="ticks plain">
${vehicles.rules.map((r) => `    <li>${vfact(r, `rule ${r.id}`)}</li>`).join('\n')}
  </ul>
  <p>Selling stolen cars is also a way to make money: see the <a href="/money/">GTA 6 money guide</a> for what Moses, Pay 'n' Spray and Randy pay.</p>
</section>
<section class="callout" aria-labelledby="vf-legend-h">
  <h2 id="vf-legend-h">How to read the finder's labels</h2>
  <ul class="legend">
    <li>${vchip('official')} Rockstar, PlayStation or Xbox published it.</li>
    <li>${vchip('agree')} Two or more different named publishers each state it; we keep a note of what each one says.</li>
    <li>${vchip('disagree')} Sources give different answers; we show all of them, even when it is one site's own pages that differ.</li>
    <li>${vchip('single')} Only one named guide states it so far.</li>
  </ul>
  <p class="small">${esc(VN.independence.text)} ${srcLinks(VN.independence.src, 'vehicle independence')}</p>
</section>
<section class="callout" aria-labelledby="vf-rule-h">
  <h2 id="vf-rule-h">What we leave out on purpose</h2>
  <p>Leaked or datamined vehicle lists, pre-launch lists that mix leaks with confirmations, AI-written guides, other sites' per-location lists, and any figure we could not tie to a named source and a date. No game images: the outlines below are our own drawings.</p>
</section>`;
  const body = `
${pageHeader('Cars', 'GTA 6 car finder and the real cars behind them', `Search ${V.length} GTA VI vehicles by name or class, with how to get each one, what it sells for, its in-game speed stat and the real car it is based on, from named guides side by side. Further down: ${total} cars from the trailers and edition listings, matched to real models by car journalists.`, vehicles.asOf)}
<nav class="toc" aria-label="On this page">${toc}</nav>
${finderHtml}
<section aria-labelledby="real-h">
  <h2 id="real-h">The real cars behind GTA 6's cars</h2>
  <p>Rockstar's legal text says the game is fictional and any similarity to real-world entities is coincidental, yet car journalists see clear real-world inspirations. Here are ${total} cars from the official trailers and edition listings, matched to the real models that car journalists say inspired them, with an honest confidence rating on each.</p>
</section>
<section class="callout" aria-labelledby="legend-h">
  <h2 id="legend-h">How to read the ratings</h2>
  <p>A real-world match can never be "confirmed": Rockstar's legal text says any similarity to real-world entities is coincidental. So the best rating here is <strong>Strong match</strong>. ${srcLinks(['ps_game_page'], 'legend legal text')}</p>
  <ul class="legend">
    <li><span class="chip chip-ok">Strong match</span> ${esc(legend.strong.replace(/^[^:]+: /, ''))} <span class="muted">(${counts.strong})</span></li>
    <li><span class="chip chip-likely">Likely</span> ${esc(legend.likely.replace(/^[^:]+: /, ''))} <span class="muted">(${counts.likely})</span></li>
    <li><span class="chip chip-warn">Possible</span> ${esc(legend.possible.replace(/^[^:]+: /, ''))} <span class="muted">(${counts.possible})</span></li>
    <li><span class="chip chip-dispute">Outlets disagree</span> ${esc(legend.disputed.replace(/^[^:]+: /, ''))} <span class="muted">(${counts.disputed})</span></li>
    <li><span class="chip chip-unknown">No match yet</span> ${esc(legend.none.replace(/^[^:]+: /, ''))} <span class="muted">(${counts.none})</span></li>
  </ul>
  <p class="small">In-game names are marked <em>Official</em> (Rockstar or a console store printed it), <em>Reported</em> (read off the car or given by the outlet) or <em>not reported</em>. The car outlines are our own generic drawings of the body style, not game art.</p>
</section>
${sectionsHtml}
<section class="car-section" id="builds" aria-labelledby="builds-h">
  <h2 id="builds-h">${esc(builds.title)}</h2>
  <p>${esc(builds.intro)}</p>
  <ul class="ticks">${buildRows}</ul>
  <p>${srcLinks(builds.src, 'builds')}</p>
</section>
<section id="quick-list" aria-labelledby="quick-list-h">
  <h2 id="quick-list-h">Quick list: game car to real car</h2>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Game car to real car table, scrolls sideways on small screens"><table><thead><tr><th scope="col">In the game</th><th scope="col">Real car</th><th scope="col">Rating</th></tr></thead><tbody>
${quickRows}
  </tbody></table></div>
</section>
${sourcesSection(vSrc.concat(allSrc, ['ps_game_page']), 'cars sources')}`;
  pages.push({
    urlPath: '/cars/', file: 'cars/index.html', scripts: [CARS_SRC], lastmod: vehicles.asOf,
    title: 'GTA 6 Cars: Vehicle Finder, Fastest Cars & Real-Life Matches',
    description: `Every GTA 6 vehicle named guides report: ${V.length} cars with class, how to get them, price, speed stat and the real car behind each, sourced and compared.`,
    body,
  });
}

// FILE SIZE ---------------------------------------------------------------------
{
  const S = facts.storage;
  const rows = S.map((f, i) => `<div class="fact-row"><dt>${esc(f.label)} ${chip(f.status)}</dt><dd><strong>${esc(f.value)}</strong>${srcLinks(f.src, `storage ${i}`)}</dd></div>`).join('\n');
  const auto = facts.autoDownload.map((a, i) => `<li><strong>${esc(a.platform)}:</strong> ${esc(a.text)} ${srcLinks(a.src, `auto ${i}`)}</li>`).join('');
  const plat = facts.platforms.map((p, i) => `<li>${chip(p.level)} <strong>${esc(p.platform)}:</strong> ${esc(p.status)} ${srcLinks(p.src, `fs platform ${i}`)}</li>`).join('');
  const body = `
${pageHeader('File size & requirements', 'GTA 6 file size and console requirements', 'You need <strong>up to 212 GB of free space</strong> to pre-load GTA 6, and even the boxed version is a download. Here is everything officially stated about storage, performance and which consoles can run it.')}
<div class="big-number" aria-hidden="true"><span class="num">212</span><span class="unit">GB</span><span class="cap">max pre-load size</span></div>
<section aria-labelledby="st-h">
  <h2 id="st-h">Storage and performance facts</h2>
  <dl class="fact-list">${rows}</dl>
</section>
<section aria-labelledby="auto-h">
  <h2 id="auto-h">Let it download while you sleep</h2>
  <ul class="ticks">${auto}</ul>
  <p>Pre-load opened on Nov 10: midnight local time on PS5, 12:00 AM GMT worldwide on Xbox. ${srcLinks(['rs_support_times'], 'fs preload times')}</p>
</section>
<section aria-labelledby="fsplat-h">
  <h2 id="fsplat-h">Can my console run it?</h2>
  <ul class="ticks plain">${plat}</ul>
</section>
<section class="callout" aria-labelledby="space-h">
  <h2 id="space-h">Short on space?</h2>
  <p>Both consoles support extra storage. Sony points PS5 owners to its <a href="https://www.playstation.com/en-us/accessories/storage-solutions/" rel="noopener noreferrer">storage options page</a>. Exact free space on your console varies with what you have installed, so check Settings &gt; Storage before launch night.</p>
</section>
${sourcesSection(collectSrc(S, facts.autoDownload, facts.platforms).concat(['rs_support_times']), 'storage sources')}`;
  pages.push({
    urlPath: '/file-size/', file: 'file-size/index.html',
    title: 'GTA 6 File Size: 212 GB Pre-Load & Console Requirements',
    description: 'How big is GTA 6? Up to 212 GB to pre-load on PS5 and Xbox Series X|S. No disc, 30 fps target, PS5 Pro extras, Xbox One via cloud. Official sources only.',
    body,
  });
}

// FAQ --------------------------------------------------------------------------
{
  const items = FAQ_ITEMS.map((f, i) => `<details class="faq-item"${i < 3 ? ' open' : ''}>
  <summary><span>${esc(f.q)}</span> ${chip(f.status)}</summary>
  <div class="faq-a"><p>${esc(f.a)}</p><p>${srcLinks(f.src, `faq ${i}`)}</p></div>
</details>`).join('\n');
  const body = `
${pageHeader('Confirmed facts', 'GTA 6: everything confirmed so far', `${FAQ_ITEMS.length} common questions answered only from official announcements, with a source on every answer. If Rockstar hasn't said it, we mark it <span class="chip chip-unknown">Not announced</span>.`)}
<section class="faq" aria-label="Questions and answers">
${items}
</section>
<section class="callout" aria-labelledby="norumor-h">
  <h2 id="norumor-h">What we leave out on purpose</h2>
  <p>Leaked footage, unofficial playtime estimates, PC release rumors and "insider" claims. They change daily and often turn out wrong. When Rockstar confirms something, it goes here with a source.</p>
</section>
${sourcesSection(collectSrc(FAQ_ITEMS), 'faq sources')}`;
  pages.push({
    urlPath: '/faq/', file: 'faq/index.html',
    title: 'GTA 6: Everything Confirmed So Far (Sourced FAQ)',
    description: 'GTA 6 FAQ with official sources only: release date and time, price, platforms, PC, disc, file size, rating, delays, pre-order bonus and what is not announced.',
    body,
  });
}

// UPDATE TRACKER (fourth post-launch tool, Nov 24) -------------------------------
// Game updates come from data/updates.json, newest first. Rockstar Support publishes the fix list; version numbers
// and download sizes come from named outlets, so each carries a status like the car finder's. The version checker's
// answers are written here at build time, one hidden paragraph per known version; updates.js only shows the one that
// matches the chosen version and filters the fix list. It carries no wording (the build checks).
if (updates) {
  const U = updates.updates;
  const USTATUS = {
    confirmed: ['Official', 'chip-ok'],
    reported: ['Official, via press', 'chip-press'],
    agree: ['Guides agree', 'chip-likely'],
    disagree: ['Guides disagree', 'chip-dispute'],
    single: ['One guide only', 'chip-warn'],
    none: ['No patch notes', 'chip-unknown'],
  };
  const uchip = (s) => `<span class="chip ${USTATUS[s][1]}">${esc(USTATUS[s][0])}</span>`;
  const pubOf = (id) => sources[id].publisher.replace(/\s*\(.*\)$/, '');
  const LEAKY = /\b(leak\w*|datamin\w*|rumou?r\w*)\b|\binsider\b(?! Gaming)/i;
  const checkU = (f, where, allowed, needText = true) => {
    if (!f || typeof f !== 'object') throw new Error(`Build blocked: update fact missing (${where}).`);
    if (!allowed.includes(f.status) || !USTATUS[f.status]) throw new Error(`Build blocked: update status "${f.status}" not allowed (${where}).`);
    if (needText && (typeof f.text !== 'string' || !f.text.trim() || f.text.length > 400)) throw new Error(`Build blocked: update fact without usable text (${where}).`);
    if (needText && LEAKY.test(f.text)) throw new Error(`Build blocked: leak/rumor wording in update ${where}.`);
    requireSources(f.src, `update ${where}`);
    if (new Set(f.src).size !== f.src.length) throw new Error(`Build blocked: duplicate source on update ${where}.`);
    const pubs = new Set(f.src.map(pubOf));
    if (['confirmed', 'reported'].includes(f.status) && !f.src.some((id) => sources[id].kind === 'official')) throw new Error(`Build blocked: "${f.status}" needs an official source (update ${where}).`);
    if (f.status === 'confirmed' && !f.src.every((id) => sources[id].kind === 'official')) throw new Error(`Build blocked: "confirmed" needs official sources only (update ${where}).`);
    if (f.status === 'single' && pubs.size !== 1) throw new Error(`Build blocked: "single" must cite one publisher only (update ${where}).`);
    if (f.status === 'disagree' && pubs.size < 2) throw new Error(`Build blocked: "disagree" needs two or more publishers (update ${where}).`);
    // "agree" and "none" (no patch notes) need a claim note from every cited source, from two or more publishers.
    if (['agree', 'none'].includes(f.status) || f.claims !== undefined) {
      const cl = f.claims && typeof f.claims === 'object' && !Array.isArray(f.claims) ? f.claims : null;
      if (!cl) throw new Error(`Build blocked: "${f.status}" needs a claim note from each source (update ${where}).`);
      if (Object.keys(cl).some((k) => !f.src.includes(k))) throw new Error(`Build blocked: claim from a source the fact does not cite (update ${where}).`);
      if (!f.src.every((id) => typeof cl[id] === 'string' && cl[id].trim().length >= 3 && cl[id].length <= 200)) throw new Error(`Build blocked: every cited source needs its own claim note (update ${where}).`);
      if (['agree', 'none'].includes(f.status) && pubs.size < 2) throw new Error(`Build blocked: "${f.status}" needs two or more publishers (update ${where}).`);
    }
  };
  const PLAT = new Map(updates.platforms.map((p) => [p.id, p.label]));
  const NAV_HREFS = new Set(NAV.map(([h]) => h));
  const ids = new Set();
  let prevDate = '9999-12-31';
  const fixCount = { n: 0 };
  for (const u of U) {
    if (!/^u\d+$/.test(u.id) || ids.has(u.id)) throw new Error(`Build blocked: bad or duplicate update id "${u.id}".`);
    ids.add(u.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(u.date) || u.date > updates.asOf) throw new Error(`Build blocked: bad date on update ${u.id}.`);
    if (u.date > prevDate) throw new Error('Build blocked: updates must be listed newest first.');
    prevDate = u.date;
    if (!u.name || u.name.length > 60) throw new Error(`Build blocked: update ${u.id} needs a short name.`);
    for (const k of Object.keys(u.versions)) if (!PLAT.has(k)) throw new Error(`Build blocked: unknown platform "${k}" on update ${u.id}.`);
    for (const [k, v] of Object.entries(u.versions)) {
      if (v === null) continue;
      if (!/^\d{1,3}(\.\d{1,3}){2,3}$/.test(v.v)) throw new Error(`Build blocked: bad version "${v.v}" on update ${u.id}.`);
      checkU(v, `${u.id} ${k} version`, ['confirmed', 'agree', 'single'], false);
    }
    checkU(u.size, `${u.id} size`, ['confirmed', 'agree', 'disagree', 'single']);
    const n = u.notes;
    if (n.status === 'confirmed') {
      checkU(n, `${u.id} notes`, ['confirmed'], false);
      if (!Array.isArray(n.fixes) || !n.fixes.length) throw new Error(`Build blocked: confirmed notes need fixes (update ${u.id}).`);
      const fids = new Set();
      for (const fx of n.fixes) {
        if (!/^[a-z0-9]+$/.test(fx.id) || fids.has(fx.id)) throw new Error(`Build blocked: bad or duplicate fix id on update ${u.id}.`);
        fids.add(fx.id);
        if (!fx.text || fx.text.length > 200 || !fx.area || fx.area.length > 20 || LEAKY.test(fx.text)) throw new Error(`Build blocked: bad fix "${fx.id}" on update ${u.id}.`);
        if (fx.tool && !NAV_HREFS.has(fx.tool.href)) throw new Error(`Build blocked: fix link must point at one of our tools (update ${u.id}).`);
        fixCount.n += 1;
      }
    } else {
      checkU(n, `${u.id} notes`, ['none']);
      if (n.fixes) throw new Error(`Build blocked: fixes listed without official notes (update ${u.id}).`);
    }
    for (const [i, x] of (u.extra || []).entries()) checkU(x, `${u.id} extra ${i}`, ['confirmed', 'agree', 'disagree', 'single']);
  }
  checkU(updates.howto, 'howto', ['confirmed']);
  checkU(updates.system, 'system', ['reported']);
  for (const [k, n] of Object.entries(updates.notes)) requireSources(n.src, `update note ${k}`);
  if (!updates.notes.coverage.text.includes(`${U.length} game updates`)) throw new Error('Build blocked: update count in the wording does not match the data.');
  assertNoWording(updatesBuf, 'updates.js');
  const upLiterals = (updatesBuf.toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || []).filter((x) => x.slice(1, -1) !== 'use strict' && /[A-Za-z]+\s+[A-Za-z]+/.test(x));
  if (upLiterals.length) throw new Error(`Build blocked: updates.js contains wording: ${upLiterals.join(', ')}`);

  const factHtml = (f, where) => `${uchip(f.status)} ${esc(f.text)} ${srcLinks(f.src, `update ${where}`)}`;
  const verHtml = (u, k) => {
    const v = u.versions[k];
    if (!v) return '<span class="vf-none">Not reported</span>';
    return `<strong class="up-ver">${esc(v.v)}</strong> ${uchip(v.status)} ${srcLinks(v.src, `update ${u.id} ${k}`)}`;
  };
  const fixLi = (u, fx, where) => `<li ${where === 'list' ? 'data-up-fix' : 'data-up-afix'} data-text="${esc(`${fx.area} ${fx.text}`.toLowerCase())}"><span class="up-area">${esc(fx.area)}</span> ${esc(fx.text)}${fx.tool ? ` <a href="${esc(fx.tool.href)}">See the ${esc(fx.tool.label)}</a>` : ''}</li>`;
  const notesHtml = (u) => {
    const n = u.notes;
    if (n.status !== 'confirmed') return `<p>${factHtml(n, `${u.id} notes`)}</p>`;
    return `<p>${uchip('confirmed')} Rockstar's notes list ${n.fixes.length} fixed issues: ${srcLinks(n.src, `update ${u.id} notes`)}</p>
      <ul class="up-fixes">
${n.fixes.map((fx) => `        ${fixLi(u, fx, 'list')}`).join('\n')}
      </ul>`;
  };
  const timeline = U.map((u, i) => `<article class="up-item${i === 0 ? ' is-latest' : ''}" id="${esc(u.id)}" aria-labelledby="${esc(u.id)}-h">
  <h3 id="${esc(u.id)}-h"><time datetime="${esc(u.date)}">${esc(fmtDate(u.date))}</time>: ${esc(u.name)}${i === 0 ? ' <span class="chip chip-ok">Latest</span>' : ''}</h3>
  <dl class="up-facts">
${updates.platforms.map((p) => `    <div><dt>${esc(p.label)} version</dt><dd>${verHtml(u, p.id)}</dd></div>`).join('\n')}
    <div><dt>Download size</dt><dd>${factHtml(u.size, `${u.id} size`)}</dd></div>
  </dl>
  <div class="up-notes">
    <h4>What changed</h4>
    ${notesHtml(u)}
${(u.extra || []).map((x, j) => `    <p class="up-extra">${factHtml(x, `${u.id} extra ${j}`)}</p>`).join('\n')}
  </div>
</article>`).join('\n');

  // Version checker: one answer per known version, written now from the data.
  const options = [];
  const answers = [];
  for (const p of updates.platforms) {
    const list = U.map((u, idx) => ({ u, idx, v: u.versions[p.id] })).filter((x) => x.v);
    if (!list.length) continue;
    const newest = list[0];
    const opts = list.map((x) => `<option value="${esc(`${p.id}:${x.v.v}`)}">${esc(x.v.v)} (${esc(fmtDate(x.u.date))})</option>`);
    const oldest = list[list.length - 1];
    opts.push(`<option value="${esc(`${p.id}:other`)}">${esc(p.label)}: my version is not listed</option>`);
    options.push(`<optgroup label="${esc(p.label)}">${opts.join('')}</optgroup>`);
    answers.push(`<div class="up-answer" data-up-answer="${esc(`${p.id}:other`)}" hidden><p><strong>Not in our list.</strong> For ${esc(p.label)} our list starts at ${esc(oldest.v.v)} (${esc(fmtDate(oldest.u.date))})${U.indexOf(oldest.u) < U.length - 1 ? `; no outlet we read reported the ${esc(p.label)} version number of the earlier update${U.length - 1 - U.indexOf(oldest.u) > 1 ? 's' : ''}` : ''}. A version that is not listed is either older, or newer than our last check (${esc(fmtDate(updates.asOf))}). Either way, check for an update on your console.</p></div>`);
    for (const x of list) {
      const missing = U.slice(0, x.idx); // every update newer than this one
      let html;
      if (!missing.length) {
        html = `<p><strong>${esc(x.v.v)} is the newest ${esc(p.label)} update we know of</strong> (${esc(fmtDate(x.u.date))}). Nothing to install: you have every fix listed below.</p>`;
      } else {
        const fixes = missing.flatMap((m) => (m.notes.status === 'confirmed' ? m.notes.fixes.map((fx) => fixLi(m, fx, 'answer')) : []));
        const noNotes = missing.filter((m) => m.notes.status !== 'confirmed').length;
        html = `<p><strong>${esc(x.v.v)} is ${missing.length} update${missing.length > 1 ? 's' : ''} behind.</strong> The newest ${esc(p.label)} update we know of is ${esc(newest.v.v)} (${esc(fmtDate(newest.u.date))}). Updating adds ${fixes.length ? 'these fixes from Rockstar\'s notes' : 'no listed fixes'}${noNotes ? ` (plus ${noNotes} update${noNotes > 1 ? 's' : ''} that came without patch notes)` : ''}:</p>${fixes.length ? `<ul class="up-fixes">${fixes.join('')}</ul>` : ''}`;
      }
      answers.push(`<div class="up-answer" data-up-answer="${esc(`${p.id}:${x.v.v}`)}" hidden>${html}</div>`);
    }
  }
  // "Not listed" is per console: our list starts at a different update on each one.

  const latest = U[0];
  const legend = ['confirmed', 'reported', 'agree', 'disagree', 'single', 'none'];
  const legendText = {
    confirmed: 'Rockstar, PlayStation or Xbox said it on its own site.',
    reported: 'An official account said it, as reported by a named outlet.',
    agree: 'Two or more named outlets state the same version or size.',
    disagree: 'Named outlets give different figures; we show all of them.',
    single: 'Only one named outlet states it so far.',
    none: 'Rockstar published no notes for that update; outlets agree on that.',
  };
  const N = updates.notes;
  const allSrc = [
    ...U.flatMap((u) => [...Object.values(u.versions).filter(Boolean).flatMap((v) => v.src), ...u.size.src, ...u.notes.src, ...(u.extra || []).flatMap((x) => x.src)]),
    ...updates.howto.src, ...updates.system.src, ...Object.values(N).flatMap((n) => n.src),
  ];
  const latestVers = updates.platforms.filter((p) => latest.versions[p.id]).map((p) => `${esc(p.label)} <strong>${esc(latest.versions[p.id].v)}</strong>`).join(', ');
  const body = `
${pageHeader('Updates', 'GTA 6 patch notes and update tracker', `Every GTA VI game update since Nov 13, newest first: the version number on PS5 and Xbox, the download size, and what Rockstar says it fixed. Check whether your copy is up to date, or search the fixes for your bug.`, updates.asOf)}
<section class="callout" aria-labelledby="up-cov-h">
  <h2 id="up-cov-h">Latest update: ${esc(fmtDate(latest.date))} <span class="chip chip-press">Updated ${esc(fmtDate(updates.asOf))}</span></h2>
  <p>${esc(latest.name)}: ${latestVers}. ${srcLinks([...new Set(updates.platforms.filter((p) => latest.versions[p.id]).flatMap((p) => latest.versions[p.id].src))], 'update latest versions')} <a href="#${esc(latest.id)}">What it fixed</a></p>
  <p>${esc(N.coverage.text)} ${srcLinks(N.coverage.src, 'update coverage')}</p>
</section>
<section class="up" aria-labelledby="up-h" data-updates>
  <h2 id="up-h">Is my copy up to date?</h2>
  <div class="vf-controls up-controls">
    <p class="vf-field"><label for="up-ver">Which version does your console show?</label><select id="up-ver" disabled data-up-ver><option value="">Choose a version</option>${options.join('')}</select></p>
    <p class="vf-field vf-field-search"><label for="up-q">Search the fixes</label><input id="up-q" type="search" maxlength="60" autocomplete="off" spellcheck="false" placeholder="for example: wanted, autosave, fence" disabled data-up-q></p>
    <p class="vf-count small" aria-live="polite">Showing <span data-up-count>${fixCount.n}</span> of ${fixCount.n} fixes in Rockstar's notes, in the list of updates below.</p>
    <noscript><p class="small">The version check and the search need JavaScript. Every update and fix is listed below without it.</p></noscript>
  </div>
  <div class="up-answers" aria-live="polite">
${answers.map((a) => `    ${a}`).join('\n')}
  </div>
  <p class="vf-empty" data-up-empty hidden>No fix in Rockstar's notes mentions that yet. Rockstar has published notes for one update so far; the two before launch came without any.</p>
  <p class="small">${factHtml(updates.howto, 'howto')}</p>
</section>
<section class="up-list" aria-labelledby="up-list-h">
  <h2 id="up-list-h">Every update, newest first</h2>
${timeline}
</section>
<section class="callout" aria-labelledby="up-sys-h">
  <h2 id="up-sys-h">PS5 system software</h2>
  <p>${factHtml(updates.system, 'system')} See <a href="/file-size/">file size and console requirements</a>.</p>
</section>
<section class="callout" aria-labelledby="up-legend-h">
  <h2 id="up-legend-h">How to read the labels</h2>
  <ul class="legend">
${legend.map((s) => `    <li>${uchip(s)} ${esc(legendText[s])}</li>`).join('\n')}
  </ul>
  <p class="small">${esc(N.independence.text)} ${srcLinks(N.independence.src, 'update independence')}</p>
</section>
<section class="callout" aria-labelledby="up-rule-h">
  <h2 id="up-rule-h">What we leave out on purpose</h2>
  <p>Guesses about what an update without notes changed, file-by-file size comparisons, predicted dates for the next update, and anything we could not tie to Rockstar or a named outlet with a date.</p>
</section>
${sourcesSection(allSrc, 'update sources')}`;
  pages.push({
    urlPath: '/updates/', file: 'updates/index.html', scripts: [UPDATES_SRC], lastmod: updates.asOf,
    title: 'GTA 6 Patch Notes & Update Tracker: Every Fix, Every Version',
    description: `GTA 6 patch notes: ${U.length} game updates with PS5 and Xbox version numbers, download sizes and Rockstar's fixes. Check if your copy is up to date.`,
    body,
  });
}

// ABOUT / PRIVACY / ACCESSIBILITY / 404 ---------------------------------------
pages.push({
  urlPath: '/about/', file: 'about/index.html',
  title: 'About GTA 6 Tools and How We Source Facts',
  description: 'How GTA 6 Tools sources every fact: official Rockstar, PlayStation and Xbox pages first, named outlets second, dates on everything. Unofficial fan site.',
  body: `${pageHeader('About', 'About this site and how we source facts', 'GTA 6 Tools is an unofficial fan site. It is not affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive.')}
<section><h2>Our rules</h2><ol class="ticks">
<li><strong>Official first.</strong> Rockstar Newswire, Rockstar Support, the Rockstar Store, PlayStation and Xbox pages come first.</li>
<li><strong>Named outlets second.</strong> Car identifications come from named car journalists. In-game data such as the 100% categories comes from IGN's Official Grand Theft Auto VI Guide, which Rockstar pointed players to at launch. Money payouts and vehicle details (class, price, speed stat, where to get a car) come from named guide sites, side by side, with every disagreement shown. We always say which outlet said what.</li>
<li><strong>No leaks.</strong> Leaked, datamined or rumored in-game lists are never used, even after launch.</li>
<li><strong>Every fact has a source and a date.</strong> The site's build refuses to publish a fact without one.</li>
<li><strong>Unknown means unknown.</strong> If it hasn't been announced, we say "Not announced" instead of guessing.</li>
<li><strong>No game media.</strong> We don't use Rockstar logos, artwork, screenshots or trailer frames. Graphics on this site are our own.</li>
</ol></section>
<section><h2>Corrections</h2><p>Facts change fast around a launch. Every page shows the date its facts were last checked. If something is out of date, the source links let you check it yourself, and corrections are made as soon as we see them.</p></section>`,
});
pages.push({
  urlPath: '/privacy/', file: 'privacy/index.html',
  title: 'Privacy | GTA 6 Tools',
  description: 'GTA 6 Tools collects nothing: no accounts, no forms, no cookies, no analytics, no ads, no third-party scripts. Tracker progress stays on your device.',
  body: `${pageHeader('Privacy', 'Privacy', 'Short version: this site collects nothing about you.')}
<section><ul class="ticks">
<li>No accounts, sign-ups or forms.</li>
<li>No cookies. The only thing stored is your own progress on the 100% tracker, in this browser's local storage, on your device. It is never sent anywhere; the tracker's "Clear all progress" button deletes it.</li>
<li>No analytics, ads or third-party scripts, fonts or images.</li>
<li>The countdown and the "out yet?" check run in your browser and read your device's time zone only to show times; nothing is sent anywhere.</li>
<li>The money guide's chapter filter${updates ? ', the car finder\'s search, filter and sort, and the update tracker\'s version check and fix search' : ' and the car finder\'s search, filter and sort'} run in your browser and store nothing.</li>
<li>Our hosting provider keeps standard server logs (such as IP address and pages requested) for security and operations, under its own privacy policy.</li>
</ul><p>If this ever changes (for example, if ads are added), this page will be updated first.</p></section>`,
});
pages.push({
  urlPath: '/accessibility/', file: 'accessibility/index.html',
  title: 'Accessibility Statement | GTA 6 Tools',
  description: 'Accessibility statement for GTA 6 Tools: what we tested, known limits, and how to report a problem.',
  body: `${pageHeader('Accessibility', 'Accessibility statement', 'We aim for WCAG 2.1 AA on every page.')}
<section><h2>What we did</h2><ul class="ticks">
<li>Semantic HTML: one H1 per page, labeled navigation, table headers, a skip link.</li>
<li>Keyboard: everything works with Tab and Enter; focus is always visible.</li>
<li>Color contrast checked for text and labels on the dark theme; labels never rely on color alone (every chip has a word).</li>
<li>The countdown does not announce every second to screen readers; the rule is also written out in plain text.</li>
<li>Pages work without JavaScript, except the live countdown, the "in your time" column, the live "out yet?" status (which falls back to the plain rule and a city table) and the 100% tracker's sums (its tables still work as a printable checklist).</li>
<li>The 100% tracker's number fields and Done buttons each have a label naming their category, and Done buttons announce whether they are pressed.</li>
<li>The money guide's chapter filter is a labeled drop-down; without JavaScript the full table shows.</li>
<li>The car finder's search box and drop-downs are labeled, the number of vehicles shown is announced politely, and without JavaScript the full table shows, fastest first.</li>${updates ? '\n<li>The update tracker\'s version drop-down and fix search are labeled, their results are announced politely, and without JavaScript every update and fix is listed.</li>' : ''}
<li>Respects reduced-motion settings; there are no animations beyond the countdown digits.</li>
</ul></section>
<section><h2>Known limits</h2><p>Tested with automated checks and keyboard navigation in Chromium at desktop and phone widths on ${esc(fmtDate(AS_OF))}. Not yet tested with a screen reader on iOS or Android.</p></section>
<section><h2>Report a problem</h2><p>There is no contact form yet. Every fact is re-checked against its source as the launch news changes, and the date at the top of each page shows the last check.</p></section>`,
});

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
try {
  fs.rmSync(DIST, { recursive: true, force: true });
} catch (e) {
  // Some sandboxed folders forbid deletes; overwrite in place instead (every output file is rewritten below).
  console.warn(`Note: could not clear dist/ (${e.code}); overwriting files in place.`);
}
fs.mkdirSync(path.join(DIST, 'assets/icons'), { recursive: true });

for (const p of pages) {
  const out = path.join(DIST, p.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const html = layout(p);
  if (/\sstyle=|<script>|\son[a-z]+\s*=/i.test(html.replace(/<script src="[^"]+" defer><\/script>/g, ''))) {
    throw new Error(`Build blocked: inline style/script/handler found in ${p.file} (CSP forbids it).`);
  }
  fs.writeFileSync(out, html);
}

// 404
fs.writeFileSync(path.join(DIST, '404.html'), layout({
  urlPath: '/404', noCanonical: true, title: 'Page not found | GTA 6 Tools',
  description: 'That page does not exist. Try the launch countdown, editions, real cars, file size or confirmed facts.',
  body: `${pageHeader('404', 'Page not found', 'That page doesn\'t exist. Try one of these:')}<ul class="ticks">${NAV.map(([h, l]) => `<li><a href="${h}">${esc(l)}</a></li>`).join('')}</ul>`,
}));

// Assets
fs.writeFileSync(path.join(DIST, 'assets/site.css'), cssBuf);
fs.writeFileSync(path.join(DIST, 'assets/countdown.js'), jsBuf);
fs.writeFileSync(path.join(DIST, 'assets/out-yet.js'), outYetBuf);
fs.writeFileSync(path.join(DIST, 'assets/completion.js'), completionBuf);
fs.writeFileSync(path.join(DIST, 'assets/money.js'), moneyBuf);
fs.writeFileSync(path.join(DIST, 'assets/cars.js'), carsJsBuf);
if (updates) fs.writeFileSync(path.join(DIST, 'assets/updates.js'), updatesBuf);
for (const f of ['favicon.svg', 'og.png', '66a8619d4867c953e5cea981e7b50c5a.txt']) {
  const src = path.join(ROOT, 'src/assets', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, 'assets', f));
  else console.warn(`WARNING: src/assets/${f} missing`);
}
// IndexNow: the key file must sit at the site root to cover every URL.
fs.copyFileSync(path.join(ROOT, 'src/assets/66a8619d4867c953e5cea981e7b50c5a.txt'), path.join(DIST, '66a8619d4867c953e5cea981e7b50c5a.txt'));
for (const f of ['skyline.svg', 'grain.svg']) fs.copyFileSync(path.join(ROOT, 'src/assets', f), path.join(DIST, 'assets', f));
fs.mkdirSync(path.join(DIST, 'assets/fonts'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'src/assets/fonts'))) {
  if (/\.(woff2|txt)$/.test(f)) fs.copyFileSync(path.join(ROOT, 'src/assets/fonts', f), path.join(DIST, 'assets/fonts', f));
}
for (const k of Object.keys(ICONS)) fs.writeFileSync(path.join(DIST, `assets/icons/${k}.svg`), iconSvg(k));

// robots.txt + sitemap.xml
const indexable = pages.filter((p) => !['/privacy/', '/accessibility/'].includes(p.urlPath));
fs.writeFileSync(path.join(DIST, 'robots.txt'), INDEXABLE
  ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`
  : 'User-agent: *\nDisallow: /\n# Indexing disabled for previews. Build with INDEXABLE=true and a real SITE_URL for production.\n');
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexable.map((p) => `  <url><loc>${esc(SITE_URL + p.urlPath)}</loc><lastmod>${p.lastmod || AS_OF}</lastmod></url>`).join('\n')}
</urlset>
`);

// Cloudflare Pages: mirror vercel.json's security headers into dist/_headers, so both hosts
// serve identical headers from one source of truth. Rules apply in file order; a later rule that
// re-sets a header from "/*" first detaches it ("! Name"), because Pages would otherwise join both values.
{
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const out = [];
  const global = new Set();
  for (const rule of vj.headers || []) {
    const m = /^((?:\/[A-Za-z0-9._-]+)*)\/\(\.\*\)$/.exec(rule.source);
    let pattern;
    if (m) pattern = `${m[1]}/*`;
    else if (/^(\/[A-Za-z0-9._-]+)+$/.test(rule.source)) pattern = rule.source;
    else throw new Error(`Build blocked: cannot translate header source "${rule.source}" to _headers.`);
    out.push(pattern);
    for (const { key, value } of rule.headers) {
      if (!/^[A-Za-z0-9-]+$/.test(key) || /[\r\n]/.test(value)) throw new Error(`Build blocked: unsafe header ${key}`);
      const line = `  ${key}: ${value}`;
      if (line.length > 2000) throw new Error(`Build blocked: _headers line too long for ${key}`);
      if (pattern !== '/*' && global.has(key.toLowerCase())) out.push(`  ! ${key}`);
      out.push(line);
      if (pattern === '/*') global.add(key.toLowerCase());
    }
  }
  // Pages keeps only the last block per pattern, so extra global headers go inside the first "/*" block.
  if (out.filter((l) => !l.startsWith(' ')).length !== new Set(out.filter((l) => !l.startsWith(' '))).size) throw new Error('Build blocked: duplicate _headers pattern');
  if (!out.includes('/*')) throw new Error('Build blocked: _headers needs a /* rule');
  if (!INDEXABLE) out.splice(out.indexOf('/*') + 1, 0, '  X-Robots-Tag: noindex, nofollow');
  fs.writeFileSync(path.join(DIST, '_headers'), out.join('\n') + '\n');
}

// Report
const unused = Object.keys(sources).filter((k) => !k.startsWith('_') && !usedSources.has(k));
console.log(`Built ${pages.length + 1} pages into dist/ (as of ${AS_OF}).`);
console.log(`Sources cited: ${usedSources.size}. Unused sources: ${unused.length ? unused.join(', ') : 'none'}.`);
console.log(`Base URL: ${SITE_URL}${SITE_URL === PLACEHOLDER_URL ? '  <-- PLACEHOLDER: set SITE_URL before production' : ''}`);
console.log(`Indexing: ${INDEXABLE ? 'ON' : 'OFF (noindex + robots Disallow)'}`);
console.log(`Launch phase for no-JS text: ${PHASE} (build clock ${new Date(NOW_MS).toISOString()}${process.env.BUILD_NOW ? ', from BUILD_NOW' : ''}).`);
