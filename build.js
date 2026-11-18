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
  conflict: ['Unclear', 'chip-warn'],
  unknown: ['Not announced', 'chip-unknown'],
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
  ['/launch-time/', 'Launch time'],
  ['/editions/', 'Editions'],
  ['/cars/', 'Real cars'],
  ['/file-size/', 'File size'],
  ['/faq/', 'Confirmed facts'],
];

function layout({ urlPath, title, description, body, hero = '', countdown = false, noCanonical = false }) {
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
${countdown ? `<script src="${JS_SRC}" defer></script>\n` : ''}</head>
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

function pageHeader(kicker, h1, lede) {
  return `<header class="page-head">
  <h1>${esc(h1)}</h1>
  <p class="lede">${lede}</p>
  <p class="asof">Facts checked <time datetime="${esc(AS_OF)}">${esc(fmtDate(AS_OF))}</time></p>
</header>`;
}

function sourcesSection(ids, where) {
  requireSources(ids, where);
  const uniq = [...new Set(ids)];
  const items = uniq.map((id) => {
    const s = sources[id];
    const kind = s.kind === 'official' ? 'Official' : 'Press';
    return `<li><span class="chip ${s.kind === 'official' ? 'chip-ok' : 'chip-press'}">${kind}</span> <a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.title)}</a> <span class="muted">(${esc(s.publisher)}${s.published ? `, published ${esc(fmtDate(s.published))}` : ', live store page'}; checked ${esc(fmtDate(s.checked))})</span></li>`;
  }).join('\n');
  return `<section class="sources" aria-labelledby="sources-h"><h2 id="sources-h">Sources for this page</h2><ul>${items}</ul></section>`;
}

function collectSrc(...lists) {
  const out = [];
  for (const l of lists) for (const x of l) out.push(...(x.src || []));
  return out;
}

function countdownBlock(kind) {
  const id = kind === 'hero' ? 'cd-hero' : 'cd-main';
  return `<div class="countdown-box sign" id="${id}">
  <p class="sign-top" aria-hidden="true">Open at midnight</p>
  <div class="countdown" data-countdown data-target-local="2026-11-19T00:00:00" role="timer" aria-live="off" aria-label="Time until midnight on November 19 in your time zone">
    <div class="cd-unit"><span class="cd-num" data-unit="d">--</span><span class="cd-lbl">days</span></div>
    <div class="cd-unit"><span class="cd-num" data-unit="h">--</span><span class="cd-lbl">hours</span></div>
    <div class="cd-unit"><span class="cd-num" data-unit="m">--</span><span class="cd-lbl">min</span></div>
    <div class="cd-unit"><span class="cd-num" data-unit="s">--</span><span class="cd-lbl">sec</span></div>
  </div>
  <p class="cd-note" data-cd-note>Counting down to 12:00 AM on Thursday, Nov 19, 2026 in your own time zone, which is when Rockstar says the game unlocks.</p>
  <noscript><p class="cd-note">The live countdown needs JavaScript. The rule is simple: midnight on November 19 where you live.</p></noscript>
</div>`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
const pages = [];

// HOME ----------------------------------------------------------------------
{
  const L = facts.launch.confirmed;
  const cards = [
    ['/launch-time/', 'Launch time in every time zone', 'Live countdown plus a 23-zone unlock table. Rockstar: midnight local time on Nov 19.'],
    ['/editions/', 'Editions and platforms compared', 'Standard $79.99, Ultimate $99.99, what the $20 upgrade adds, and which consoles get it.'],
    ['/cars/', 'The real cars behind GTA 6\'s cars', `${CAR_TOTAL} cars from the trailers and edition listings, each matched to a real model and honestly rated.`],
    ['/file-size/', 'File size and console requirements', 'Up to 212 GB to pre-load, no disc, 30 fps target, PS5 Pro extras, Xbox One via cloud.'],
    ['/faq/', 'Everything confirmed so far', '18 straight answers with sources, and a clear list of what is still not announced.'],
  ];
  const cardHtml = cards.map(([href, h, p]) => `<li class="tool-row"><a href="${href}"><h2>${esc(h)}</h2><p>${esc(p)}</p></a></li>`).join('\n');
  const hero = `<section class="hero" aria-labelledby="hero-h">
  <div class="sky" aria-hidden="true"></div>
  <img class="skyline" src="/assets/skyline.svg" alt="" width="1600" height="420">
  <div class="wrap hero-inner">
    <h1 id="hero-h">GTA 6 unlocks at midnight on November 19, wherever you are</h1>
    ${countdownBlock('hero')}
  </div>
</section>
`;
  const body = `
<section class="intro">
  <p class="lede">Five sourced tools for launch week. Every number links to Rockstar, PlayStation, Xbox or a named car outlet, with the date we checked it. ${srcLinks(['rs_support_times'], 'home hero')}</p>
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
  const rows = L.zones.map((z) => ({ ...z, utc: localMidnightUtc(z.tz, 2026, 11, 19) }))
    .sort((a, b) => a.utc - b.utc);
  // Self-check against figures stated by the sources: NZ 11:00 UTC Nov 18, UK 00:00 UTC, NY 05:00 UTC.
  const check = { 'Pacific/Auckland': '2026-11-18T11:00:00.000Z', 'Europe/London': '2026-11-19T00:00:00.000Z', 'America/New_York': '2026-11-19T05:00:00.000Z', 'Europe/Berlin': '2026-11-18T23:00:00.000Z' };
  for (const r of rows) {
    if (check[r.tz] && new Date(r.utc).toISOString() !== check[r.tz]) throw new Error(`Time zone math check failed for ${r.tz}`);
  }
  const tableRows = rows.map((r) => {
    const iso = new Date(r.utc).toISOString();
    return `<tr data-utc="${esc(iso)}"><th scope="row">${esc(r.city)}</th><td data-label="Unlocks (local)">${esc(fmtIn(r.tz, r.utc))}</td><td data-label="In UTC">${esc(fmtUtc(r.utc))}</td><td class="yours" data-label="In your time" data-local-time="${esc(iso)}">-</td></tr>`;
  }).join('\n');
  const body = `
${pageHeader('Launch time', 'GTA 6 release time in every time zone', 'Rockstar\'s rule: <strong>GTA VI unlocks at midnight local time on Thursday, November 19, 2026</strong>, on both PS5 and Xbox Series X|S. Here is what that means where you are, and the one detail that is still unclear.')}
${countdownBlock('main')}
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
</section>
<section aria-labelledby="tips-h">
  <h2 id="tips-h">Be ready at midnight</h2>
  <ul class="ticks">
    <li>Pre-load now: it needs up to 212 GB. ${srcLinks(['rs_preload_nov10'], 'launch tip size')}</li>
    <li>PS5: turn on auto-downloads and leave the console on or in Rest Mode. Xbox: turn on automatic updates and use Sleep mode. ${srcLinks(['rs_support_preload'], 'launch tip auto')}</li>
    <li>Code-in-box buyers: there is no disc. Redeem the code as soon as you have it so the pre-load can start. ${srcLinks(['rs_preload_now', 'rs_store_game'], 'launch tip code')}</li>
  </ul>
  <p>Full storage details: <a href="/file-size/">GTA 6 file size and requirements</a>.</p>
</section>
${sourcesSection(collectSrc(L.confirmed, [L.conflict]).concat(['rs_preload_nov10', 'rs_support_preload', 'rs_preload_now', 'rs_store_game']), 'launch sources')}`;
  pages.push({
    urlPath: '/launch-time/', file: 'launch-time/index.html', countdown: true,
    title: 'GTA 6 Release Time in Every Time Zone (Live Countdown)',
    description: 'When does GTA 6 unlock? Rockstar says midnight local time on Nov 19, 2026. Live countdown, a 23-zone table, Xbox Cloud timing and what is still unclear.',
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
  <p>Car fan? See which real cars these are based on in <a href="/cars/">the real cars behind GTA 6's cars</a>.</p>
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
    <li>${chip('unknown')} The PlayStation price of the Ultimate Edition Upgrade (listed, but we couldn't read the price on Nov 17).</li>
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
  const toc = cars.sections.map((s) => `<a href="#${esc(s.id)}">${esc(s.title)}</a>`).join('') + '<a href="#builds">Real-life builds</a><a href="#quick-list">Quick list</a>';
  const allSrc = [];
  for (const s of cars.sections) { for (const c of s.cars) allSrc.push(...c.src); if (s.traffic) allSrc.push(...s.traffic.src); }
  allSrc.push(...builds.src);
  const body = `
${pageHeader('For car people', 'The real cars behind GTA 6\'s cars', `Rockstar's legal text says the game is fictional and any similarity to real-world entities is coincidental, yet car journalists see clear real-world inspirations. Here are ${total} cars from the official trailers and edition listings, matched to the real models that car journalists say inspired them, with an honest confidence rating on each.`)}
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
<nav class="toc" aria-label="On this page">${toc}</nav>
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
${sourcesSection(allSrc.concat(['ps_game_page']), 'cars sources')}`;
  pages.push({
    urlPath: '/cars/', file: 'cars/index.html',
    title: 'The Real Cars Behind GTA 6\'s Cars: Trailer-by-Trailer Guide',
    description: `GTA 6 cars and their real-life counterparts: ${total} cars from the trailers and edition listings, each matched to a real model with a sourced, honest confidence rating.`,
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
  const items = facts.faq.map((f, i) => `<details class="faq-item"${i < 3 ? ' open' : ''}>
  <summary><span>${esc(f.q)}</span> ${chip(f.status)}</summary>
  <div class="faq-a"><p>${esc(f.a)}</p><p>${srcLinks(f.src, `faq ${i}`)}</p></div>
</details>`).join('\n');
  const body = `
${pageHeader('Confirmed facts', 'GTA 6: everything confirmed so far', `${facts.faq.length} common questions answered only from official announcements, with a source on every answer. If Rockstar hasn't said it, we mark it <span class="chip chip-unknown">Not announced</span>.`)}
<section class="faq" aria-label="Questions and answers">
${items}
</section>
<section class="callout" aria-labelledby="norumor-h">
  <h2 id="norumor-h">What we leave out on purpose</h2>
  <p>Leaked footage, unofficial playtime estimates, PC release rumors and "insider" claims. They change daily and often turn out wrong. When Rockstar confirms something, it goes here with a source.</p>
</section>
${sourcesSection(collectSrc(facts.faq), 'faq sources')}`;
  pages.push({
    urlPath: '/faq/', file: 'faq/index.html',
    title: 'GTA 6: Everything Confirmed So Far (Sourced FAQ)',
    description: 'GTA 6 FAQ with official sources only: release date and time, price, platforms, PC, disc, file size, rating, delays, pre-order bonus and what is not announced.',
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
<li><strong>Named outlets second.</strong> Car identifications come from named car journalists, and we say which outlet said what.</li>
<li><strong>Every fact has a source and a date.</strong> The site's build refuses to publish a fact without one.</li>
<li><strong>Unknown means unknown.</strong> If it hasn't been announced, we say "Not announced" instead of guessing.</li>
<li><strong>No game media.</strong> We don't use Rockstar logos, artwork, screenshots or trailer frames. Graphics on this site are our own.</li>
</ol></section>
<section><h2>Corrections</h2><p>Facts change fast around a launch. Every page shows the date its facts were last checked. If something is out of date, the source links let you check it yourself, and corrections are made as soon as we see them.</p></section>`,
});
pages.push({
  urlPath: '/privacy/', file: 'privacy/index.html',
  title: 'Privacy | GTA 6 Tools',
  description: 'GTA 6 Tools collects nothing: no accounts, no forms, no cookies, no analytics, no ads, no third-party scripts.',
  body: `${pageHeader('Privacy', 'Privacy', 'Short version: this site collects nothing about you.')}
<section><ul class="ticks">
<li>No accounts, sign-ups or forms.</li>
<li>No cookies and no local storage.</li>
<li>No analytics, ads or third-party scripts, fonts or images.</li>
<li>The countdown runs in your browser and reads your device's time zone only to show times; nothing is sent anywhere.</li>
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
<li>Pages work without JavaScript, except the live countdown and the "in your time" column.</li>
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
for (const f of ['favicon.svg', 'og.png', '66a8619d4867c953e5cea981e7b50c5a.txt']) {
  const src = path.join(ROOT, 'src/assets', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, 'assets', f));
  else console.warn(`WARNING: src/assets/${f} missing`);
}
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
${indexable.map((p) => `  <url><loc>${esc(SITE_URL + p.urlPath)}</loc><lastmod>${AS_OF}</lastmod></url>`).join('\n')}
</urlset>
`);

// Report
const unused = Object.keys(sources).filter((k) => !k.startsWith('_') && !usedSources.has(k));
console.log(`Built ${pages.length + 1} pages into dist/ (as of ${AS_OF}).`);
console.log(`Sources cited: ${usedSources.size}. Unused sources: ${unused.length ? unused.join(', ') : 'none'}.`);
console.log(`Base URL: ${SITE_URL}${SITE_URL === PLACEHOLDER_URL ? '  <-- PLACEHOLDER: set SITE_URL before production' : ''}`);
console.log(`Indexing: ${INDEXABLE ? 'ON' : 'OFF (noindex + robots Disallow)'}`);
