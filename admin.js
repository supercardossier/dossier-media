#!/usr/bin/env node
// Safehouse: the private admin dashboard for GTA 6 Tools.
// Built from the same data as the public site, deployed as a SEPARATE Vercel project that is locked behind
// Vercel Authentication (owner's Vercel login with 2FA/passkey). There is no homemade password system,
// no login form, no database and no server code: nothing here for an attacker to brute-force or inject.
// Zero dependencies. Usage: node admin.js  ->  dist-admin/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist-admin');
const PUBLIC_URL = (process.env.SITE_URL || 'https://gta6-launch-guide.vercel.app').replace(/\/+$/, '');
const BUILT_AT = new Date();

const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const sources = read('data/sources.json');
const facts = read('data/facts.json');
const cars = read('data/cars.json');

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; }
function daysSince(iso) { return Math.floor((BUILT_AT - new Date(iso + 'T12:00:00Z')) / 86400000); }

const srcIds = Object.keys(sources).filter((k) => !k.startsWith('_'));
for (const id of srcIds) if (!/^https:\/\//.test(sources[id].url)) throw new Error(`Admin build blocked: source ${id} is not https`);
const ages = srcIds.map((id) => ({ id, ...sources[id], age: daysSince(sources[id].checked) })).sort((a, b) => b.age - a.age);
const stale = ages.filter((s) => s.age >= 3);
const carTotal = cars.sections.reduce((n, s) => n + s.cars.length, 0);
const factAge = daysSince(facts.asOf);

const PAGES = [['/', 'Home + countdown'], ['/launch-time/', 'Launch time'], ['/editions/', 'Editions'], ['/cars/', 'Real cars'], ['/file-size/', 'File size'], ['/faq/', 'Confirmed facts'], ['/about/', 'About'], ['/privacy/', 'Privacy'], ['/accessibility/', 'Accessibility']];

const statusRows = [
  ['Public site', `<a href="${esc(PUBLIC_URL)}/" rel="noopener noreferrer">${esc(PUBLIC_URL.replace('https://', ''))}</a>`],
  ['Facts last checked', `${esc(fmtDate(facts.asOf))} <span class="chip ${factAge >= 2 ? 'chip-warn' : 'chip-ok'}">${factAge === 0 ? 'Today' : `${factAge} day${factAge === 1 ? '' : 's'} ago`}</span>`],
  ['Sources', `${srcIds.length} total, ${stale.length ? `<span class="chip chip-warn">${stale.length} need a re-check</span>` : '<span class="chip chip-ok">All fresh</span>'}`],
  ['Cars matched', `${carTotal}`],
  ['FAQ answers', `${facts.faq.length}`],
  ['Dashboard built', `${esc(BUILT_AT.toISOString().replace('T', ' ').slice(0, 16))} UTC`],
];

const todo = [
  ['Turn on 2FA or a passkey for your Vercel account', 'This dashboard is only as safe as that login. Vercel: Account settings, Authentication.'],
  ['Turn on 2FA for the GitHub account that holds the site code', 'Whoever controls the code controls the site.'],
  ['Say "go public" in the GTA 6 chat', 'Claude switches on indexing and opens the public address. Previews stay locked.'],
  ['Sign in to Google Search Console once', 'So Google finds the sitemap. Claude prepares everything else.'],
  ['Before any ads: upgrade Vercel to Pro or move hosts', 'Vercel\'s free plan does not allow ads.'],
];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>Safehouse | GTA 6 Tools admin</title>
<meta name="theme-color" content="#1a0b2e">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/admin.css">
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <span class="brand"><span class="brand-sun" aria-hidden="true"></span><span class="brand-name">Safehouse</span><span class="brand-tag">private admin for GTA 6 Tools</span></span>
    <span class="lock">Signed in through Vercel</span>
  </div>
</header>
<main id="main" class="wrap">
<header class="page-head">
  <h1>Site control room</h1>
  <p class="lede">Only you can open this page. It is a separate, locked deployment, so the public site has no login form and nothing to break into.</p>
</header>

<section aria-labelledby="status-h">
  <h2 id="status-h">Status</h2>
  <dl class="fact-list">${statusRows.map(([k, v]) => `<div class="fact-row"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('\n')}</dl>
</section>

<section aria-labelledby="todo-h">
  <h2 id="todo-h">Waiting on you</h2>
  <ul class="todo">${todo.map(([t, d]) => `<li><strong>${esc(t)}</strong><span class="note">${esc(d)}</span></li>`).join('\n')}</ul>
</section>

<section aria-labelledby="pages-h">
  <h2 id="pages-h">Pages</h2>
  <ul class="tool-list">${PAGES.map(([p, l]) => `<li class="tool-row"><a href="${esc(PUBLIC_URL + p)}" rel="noopener noreferrer"><h2>${esc(l)}</h2><p>${esc(p)}</p></a></li>`).join('\n')}</ul>
</section>

<section aria-labelledby="src-h">
  <h2 id="src-h">Source freshness</h2>
  <p class="muted">Oldest check first. Anything checked 3 or more days ago gets re-verified by the night shift.</p>
  <div class="table-wrap"><table class="stack">
    <thead><tr><th scope="col">Source</th><th scope="col">Publisher</th><th scope="col">Last checked</th><th scope="col">Age</th></tr></thead>
    <tbody>${ages.map((s) => `<tr><th scope="row"><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.title)}</a></th><td data-label="Publisher">${esc(s.publisher)}</td><td data-label="Checked">${esc(fmtDate(s.checked))}</td><td data-label="Age"><span class="chip ${s.age >= 3 ? 'chip-warn' : 'chip-ok'}">${s.age} d</span></td></tr>`).join('\n')}</tbody>
  </table></div>
</section>

<section aria-labelledby="sec-h">
  <h2 id="sec-h">How this login is protected</h2>
  <ul class="ticks">
    <li>Access goes through Vercel Authentication. Only members of your Vercel team (just you) can open it, using your Vercel login.</li>
    <li>No passwords are stored by this site, so there is no password database to leak.</li>
    <li>No server code, database or forms run here: it is one static page.</li>
    <li>Strict security headers: the page can't be framed, can't load outside scripts, and sends no referrer.</li>
    <li>Search engines are told never to index it, and nothing on the public site links here.</li>
  </ul>
</section>
</main>
</body>
</html>
`;

if (/\sstyle=|<script|\son[a-z]+\s*=/i.test(html)) throw new Error('Admin build blocked: inline style/script/handler.');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets/fonts'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, '404.html'), html.replace(/<main[\s\S]*<\/main>/, '<main class="wrap"><h1>Not here</h1><p><a href="/">Back to the control room</a></p></main>'));
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
for (const f of ['site.css', 'admin.css', 'favicon.svg']) fs.copyFileSync(path.join(ROOT, 'src/assets', f), path.join(OUT, 'assets', f));
for (const f of fs.readdirSync(path.join(ROOT, 'src/assets/fonts'))) if (/\.woff2$/.test(f)) fs.copyFileSync(path.join(ROOT, 'src/assets/fonts', f), path.join(OUT, 'assets/fonts', f));
console.log(`Safehouse built: ${srcIds.length} sources (${stale.length} stale), facts ${factAge} day(s) old.`);
