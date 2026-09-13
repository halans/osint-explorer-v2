#!/usr/bin/env node
// Build every secondary surface from the enriched dataset.
//
//   node scripts/build.mjs [--no-icons]
//
// Inputs   data/tools.enriched.json, data/icons.json, src/search.mjs
// Outputs  dist/osint-explorer.html   single self-contained offline page
//          dist/tools.min.json        dataset without icons, minified (for the CLI/API)
//
// The page embeds src/search.mjs VERBATIM (only the `export ` keywords are stripped, so
// the same code runs in the browser as in the CLI). test/equivalence.test.mjs asserts
// that the inlined copy still matches the module on disk.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const withIcons = !process.argv.includes('--no-icons');

const ds = JSON.parse(readFileSync(join(ROOT, 'data/tools.enriched.json'), 'utf8'));
const icons = withIcons && existsSync(join(ROOT, 'data/icons.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'data/icons.json'), 'utf8'))
  : {};
const engineSource = readFileSync(join(ROOT, 'src/search.mjs'), 'utf8');

export function inlineEngine(src) {
  return src.replace(/^export\s+(const|function)\s/gm, '$1 ');
}

// Trim fields the page never reads, to keep the payload lean.
const slim = ds.tools.map((t) => ({
  i: t.id,
  n: t.name,
  u: t.url,
  c: t.category,
  s: t.subcategory || null,
  ss: t.subSubcategory || null,
  d: t.description || null,
  g: t.targets || [],
  a: t.access,
  k: t.kind,
  r: t.regions || [],
  t: t.tags || [],
  h: t.health?.status || 'unchecked',
  hs: t.health?.httpStatus ?? null,
  f: t.health?.finalUrl || null,
  x: t.retired ? 1 : 0,
  xr: t.retiredReason || null,
  o: t.notes || null,
  p: t.provenance,
  cf: t.confidence || null,
  l: t.licence || null,
  fm: t.format || null,
  ic: t.hasIcon ? 1 : 0,
}));

const payload = {
  generatedAt: ds.generatedAt,
  stats: ds.stats,
  categories: ds.categories.map((c) => ({ name: c.name, count: c.count, subcategories: c.subcategories })),
  sources: ds.sources,
  tools: slim,
};

// Keep embedded JSON safe inside <script>: escape '<' and the two JS line separators.
const esc = (s) => String(s)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');
const html = page({
  payload: esc(JSON.stringify(payload)),
  icons: esc(JSON.stringify(icons)),
  engine: inlineEngine(engineSource),
  stats: ds.stats,
  generatedAt: ds.generatedAt,
});

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/osint-explorer.html'), html);
writeFileSync(join(ROOT, 'dist/tools.min.json'), JSON.stringify(ds));
const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`dist/osint-explorer.html  ${kb(Buffer.byteLength(html))}  (${ds.stats.tools} tools, icons: ${Object.keys(icons).length})`);
console.log(`dist/tools.min.json       ${kb(Buffer.byteLength(JSON.stringify(ds)))}`);

function page({ payload, icons, engine, stats, generatedAt }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OSINT Explorer — ${stats.tools} tools</title>
<meta name="description" content="Searchable directory of ${stats.live} open-source intelligence tools, datasets and feeds, with link-health status and faceted filters.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0f14;
    --panel: #111820;
    --panel-2: #161f29;
    --line: #223040;
    --line-soft: #1a2532;
    --ink: #e6edf5;
    --ink-dim: #94a6bb;
    --ink-faint: #64798f;
    --accent: #4cc2ff;
    --accent-dim: #1b4f6b;
    --warn: #ffb454;
    --bad: #ff6b6b;
    --good: #5fd38d;
    --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    --sans: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --display: 'Archivo', 'Inter', system-ui, sans-serif;
    --radius: 10px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; overflow-x: hidden; }
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ---------------- header ---------------- */
  header {
    position: sticky; top: 0; z-index: 40;
    background: rgba(11,15,20,.92);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line);
  }
  .bar { max-width: 1440px; margin: 0 auto; padding: 14px 24px; display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
  .brand { font-family: var(--display); font-weight: 700; font-size: 19px; letter-spacing: -.01em; white-space: nowrap; color: var(--ink); }
  .brand span { color: var(--accent); }
  .searchwrap { flex: 1 1 340px; position: relative; display: flex; align-items: center; }
  #q {
    width: 100%; padding: 11px 92px 11px 38px;
    background: var(--panel); color: var(--ink);
    border: 1px solid var(--line); border-radius: var(--radius);
    font-family: var(--mono); font-size: 14px;
  }
  #q:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(76,194,255,.13); }
  .searchwrap .mag { position: absolute; left: 13px; color: var(--ink-faint); font-size: 14px; pointer-events: none; }
  .searchwrap .hint { position: absolute; right: 10px; font-family: var(--mono); font-size: 11px; color: var(--ink-faint); border: 1px solid var(--line); border-radius: 5px; padding: 2px 6px; }
  .searchwrap .clear { position: absolute; right: 10px; background: none; border: none; color: var(--ink-dim); cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 8px; display: none; }
  .counts { font-family: var(--mono); font-size: 12.5px; color: var(--ink-dim); white-space: nowrap; }
  .counts b { color: var(--ink); font-weight: 500; }
  .filtersbtn { display: none; }

  /* ---------------- layout ---------------- */
  .shell { max-width: 1440px; margin: 0 auto; padding: 22px 24px 80px; display: grid; grid-template-columns: 244px 1fr; gap: 28px; align-items: start; }
  aside { position: sticky; top: 78px; max-height: calc(100vh - 100px); overflow-y: auto; padding-right: 4px; }
  aside::-webkit-scrollbar { width: 8px; }
  aside::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }

  .facet { margin-bottom: 22px; }
  .facet h3 {
    font-family: var(--mono); font-size: 10.5px; font-weight: 500; letter-spacing: .12em; text-transform: uppercase;
    color: var(--ink-faint); margin: 0 0 8px; display: flex; justify-content: space-between; align-items: center;
  }
  .facet h3 button { background: none; border: none; color: var(--accent); font-family: var(--mono); font-size: 10.5px; cursor: pointer; padding: 0; display: none; }
  .facet.active h3 button { display: block; }
  .opt {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    width: 100%; padding: 5px 8px; margin: 1px 0;
    background: none; border: 1px solid transparent; border-radius: 7px;
    color: var(--ink-dim); font-family: var(--sans); font-size: 13px; text-align: left; cursor: pointer;
  }
  .opt:hover { background: var(--panel); color: var(--ink); }
  .opt[aria-pressed="true"] { background: var(--accent-dim); border-color: var(--accent); color: #eaf7ff; }
  .opt .c { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); }
  .opt[aria-pressed="true"] .c { color: #bfe7fb; }
  .facet .more { background: none; border: none; color: var(--ink-faint); font-size: 12px; cursor: pointer; padding: 4px 8px; font-family: var(--sans); }
  .facet .more:hover { color: var(--accent); }

  /* ---------------- results ---------------- */
  .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }
  .chip {
    font-family: var(--mono); font-size: 11.5px; padding: 4px 9px; border-radius: 20px;
    background: var(--accent-dim); border: 1px solid var(--accent); color: #eaf7ff; cursor: pointer;
  }
  .chip::after { content: ' ×'; opacity: .7; }
  select {
    background: var(--panel); color: var(--ink-dim); border: 1px solid var(--line);
    border-radius: 8px; padding: 6px 9px; font-family: var(--mono); font-size: 12px;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(322px, 1fr)); gap: 12px; }
  article {
    background: var(--panel); border: 1px solid var(--line-soft); border-radius: var(--radius);
    padding: 13px 14px; display: flex; flex-direction: column; gap: 8px; min-width: 0;
  }
  article:hover { border-color: var(--line); background: var(--panel-2); }
  article.retired { opacity: .55; }
  .top { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
  .ico { width: 18px; height: 18px; border-radius: 4px; flex: 0 0 18px; margin-top: 2px; background: var(--panel-2); object-fit: contain; }
  .ico.fallback { display: grid; place-items: center; font-family: var(--mono); font-size: 10px; color: var(--ink-faint); border: 1px solid var(--line); }
  .title { min-width: 0; flex: 1; }
  .title h2 { margin: 0; font-family: var(--display); font-size: 15px; font-weight: 600; line-height: 1.25; letter-spacing: -.005em; overflow-wrap: anywhere; }
  .host { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); overflow-wrap: anywhere; }
  .desc { margin: 0; font-size: 13.5px; color: var(--ink-dim); line-height: 1.45; overflow-wrap: anywhere; }
  .desc.missing { color: var(--ink-faint); font-style: italic; }
  .meta { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-top: auto; }
  .b {
    font-family: var(--mono); font-size: 10.5px; padding: 2px 7px; border-radius: 5px;
    border: 1px solid var(--line); color: var(--ink-faint); white-space: nowrap;
  }
  .b.kind { color: var(--ink-dim); }
  .b.free { color: var(--good); border-color: #23503a; }
  .b.paid { color: var(--warn); border-color: #55401f; }
  .b.reg { color: #b39ddb; border-color: #3c3355; }
  .b.tgt { color: var(--accent); border-color: var(--accent-dim); }
  .b.region { color: #ffd479; border-color: #4d3f22; }
  .b.dead { color: var(--bad); border-color: #5a2a2a; }
  .b.warnst { color: var(--warn); border-color: #55401f; }
  .note { font-size: 12px; color: var(--ink-faint); border-left: 2px solid var(--line); padding-left: 8px; }
  .empty { padding: 60px 20px; text-align: center; color: var(--ink-dim); }
  .empty code { font-family: var(--mono); color: var(--accent); }
  #more { display: block; margin: 22px auto 0; padding: 10px 20px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; color: var(--ink); font-family: var(--mono); font-size: 13px; cursor: pointer; }
  #more:hover { border-color: var(--accent); }
  footer { max-width: 1440px; margin: 0 auto; padding: 0 24px 60px; color: var(--ink-faint); font-size: 12.5px; line-height: 1.7; overflow-wrap: anywhere; }
  footer .syn { font-size: 12px; color: var(--ink-dim); line-height: 2; }
  footer code { font-family: var(--mono); font-size: 11px; background: var(--panel); border: 1px solid var(--line-soft); border-radius: 5px; padding: 2px 6px; white-space: nowrap; }
  kbd { font-family: var(--mono); font-size: 11px; border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; color: var(--ink-dim); }

  /* ---------------- mobile ---------------- */
  @media (max-width: 860px) {
    .bar { padding: 11px 14px; gap: 10px; }
    .brand { font-size: 16px; }
    .searchwrap { flex: 1 1 100%; order: 3; }
    .searchwrap .hint { display: none; }
    .counts { font-size: 11.5px; order: 2; margin-left: auto; }
    .filtersbtn {
      display: block; order: 4; width: 100%; padding: 9px; background: var(--panel);
      border: 1px solid var(--line); border-radius: 8px; color: var(--ink);
      font-family: var(--mono); font-size: 12.5px; cursor: pointer;
    }
    .shell { grid-template-columns: 1fr; padding: 14px 14px 60px; gap: 14px; }
    aside {
      position: static; max-height: none; display: none;
      background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px;
    }
    body.filters-open aside { display: block; }
    .grid { grid-template-columns: 1fr; }
    /* Comfortable tap targets: 28px facet rows are too small for a thumb. */
    .opt { padding: 11px 10px; font-size: 14px; margin: 2px 0; }
    .facet { margin-bottom: 16px; }
    .facet .more { padding: 10px 8px; }
    .chip { padding: 7px 12px; font-size: 12px; }
    select { padding: 9px 10px; }
    article { padding: 14px; }
    footer { padding: 0 14px 50px; }
  }
</style>
</head>
<body>
<header>
  <div class="bar">
    <a class="brand" href="../" title="Back to OSINT Explorer">OSINT<span>/</span>Explorer</a>
    <div class="searchwrap">
      <span class="mag">⌕</span>
      <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder='search — try  target:geo  access:free  kind:feed  region:AU'>
      <span class="hint">/</span>
      <button class="clear" id="clear" aria-label="Clear search">×</button>
    </div>
    <div class="counts" id="counts"></div>
    <button class="filtersbtn" id="filtersbtn" aria-expanded="false">Filters</button>
  </div>
</header>

<div class="shell">
  <aside id="facets"></aside>
  <main>
    <div class="toolbar">
      <div class="chips" id="chips"></div>
      <select id="sort" aria-label="Sort order">
        <option value="relevance">sort: relevance</option>
        <option value="name">sort: name</option>
        <option value="category">sort: category</option>
        <option value="health">sort: health</option>
      </select>
      <select id="retired" aria-label="Retired entries">
        <option value="hide">retired: hidden</option>
        <option value="show">retired: shown</option>
        <option value="only">retired: only</option>
      </select>
    </div>
    <div class="grid" id="grid"></div>
    <button id="more" hidden>Show more</button>
  </main>
</div>

<footer>
  <p class="syn">query syntax:
    <code>term</code>, <code>"exact phrase"</code>, <code>-exclude</code>,
    <code>target:geo</code>,
    <code>access:free|freemium|paid|api-key|free-registration</code>,
    <code>kind:map|feed|dataset|search|database|software|api|directory|reading|web-tool</code>,
    <code>region:AU</code>, <code>category:mapping</code>, <code>tag:bushfire</code>,
    <code>health:alive|bot-walled|dead</code>, <code>is:retired</code>, <code>has:description</code>
  </p>
  <p>Press <kbd>/</kbd> to focus search, <kbd>Esc</kbd> to clear. Filters and queries are written to the URL, so any view can be bookmarked or shared. This page is self-contained: the dataset and the search engine are embedded, and it works with no network connection.</p>
  <p id="prov"></p>
</footer>

<script type="module">
${engine}

const DATA = JSON.parse(${JSON.stringify(payload)});
const ICONS = JSON.parse(${JSON.stringify(icons)});

// Rehydrate the slim payload into the shape src/search.mjs expects.
const TOOLS = DATA.tools.map((t) => ({
  id: t.i, name: t.n, url: t.u, category: t.c, subcategory: t.s, subSubcategory: t.ss,
  description: t.d, targets: t.g, access: t.a, kind: t.k, regions: t.r, tags: t.t,
  health: { status: t.h, httpStatus: t.hs, finalUrl: t.f }, retired: !!t.x,
  retiredReason: t.xr, notes: t.o, provenance: t.p, confidence: t.cf,
  licence: t.l, format: t.fm, hasIcon: !!t.ic,
}));

const PAGE = 60;
const state = { q: '', facets: {}, sort: 'relevance', retired: 'hide', shown: PAGE };

const el = (id) => document.getElementById(id);
const grid = el('grid'), facetsEl = el('facets'), chipsEl = el('chips');

const FACET_ORDER = [
  ['category', 'Category'],
  ['target', 'Input'],
  ['kind', 'Type'],
  ['access', 'Access'],
  ['region', 'Region'],
  ['health', 'Link health'],
];
const expanded = new Set();

function buildQuery() {
  const parts = [state.q.trim()];
  for (const [k, vals] of Object.entries(state.facets)) {
    for (const v of vals) parts.push(\`\${k}:\${/\\s/.test(v) ? JSON.stringify(v) : v}\`);
  }
  if (state.retired === 'only') parts.push('is:retired');
  else if (state.retired === 'show') parts.push('is:any');
  return parts.filter(Boolean).join(' ');
}

function currentResults() {
  const r = search(TOOLS, buildQuery(), { limit: Number.MAX_SAFE_INTEGER });
  let list = r.results;
  if (state.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  else if (state.sort === 'category') list = [...list].sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));
  else if (state.sort === 'health') {
    const rank = { dead: 0, unreachable: 1, 'server-error': 2, inconclusive: 3, 'bot-walled': 4, redirected: 5, alive: 6, unchecked: 7 };
    list = [...list].sort((a, b) => (rank[a.health.status] ?? 9) - (rank[b.health.status] ?? 9) || a.name.localeCompare(b.name));
  }
  return list;
}

const ACCESS_CLASS = { free: 'free', 'free-registration': 'reg', freemium: 'reg', paid: 'paid', 'api-key': 'reg', unknown: '' };
const HEALTH_LABEL = {
  alive: null, redirected: 'redirected', 'bot-walled': 'bot-walled', dead: 'dead',
  unreachable: 'unreachable', 'server-error': 'server error', inconclusive: 'unverified', unchecked: 'unchecked',
};

function host(u) { try { return new URL(u).hostname.replace(/^www\\./, ''); } catch { return u; } }

function card(t) {
  const a = document.createElement('article');
  if (t.retired) a.className = 'retired';

  const top = document.createElement('div');
  top.className = 'top';
  const icon = ICONS[t.id];
  if (icon) {
    const img = document.createElement('img');
    img.className = 'ico'; img.src = icon; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    top.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'ico fallback'; ph.textContent = (t.name[0] || '?').toUpperCase();
    top.appendChild(ph);
  }
  const title = document.createElement('div');
  title.className = 'title';
  const h2 = document.createElement('h2');
  const link = document.createElement('a');
  link.href = t.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = t.name;
  h2.appendChild(link);
  const hostLine = document.createElement('div');
  hostLine.className = 'host';
  hostLine.textContent = host(t.url) + (t.subcategory ? ' · ' + t.subcategory : '');
  title.append(h2, hostLine);
  top.appendChild(title);
  a.appendChild(top);

  const p = document.createElement('p');
  if (t.description) { p.className = 'desc'; p.textContent = t.description; }
  else { p.className = 'desc missing'; p.textContent = 'No description verified yet.'; }
  a.appendChild(p);

  if (t.notes) {
    const n = document.createElement('div');
    n.className = 'note'; n.textContent = t.notes;
    a.appendChild(n);
  }
  if (t.retired) {
    const n = document.createElement('div');
    n.className = 'note'; n.textContent = 'Retired' + (t.retiredReason ? ': ' + t.retiredReason : '');
    a.appendChild(n);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const badge = (text, cls, filter) => {
    const b = document.createElement(filter ? 'button' : 'span');
    b.className = 'b ' + (cls || '');
    b.textContent = text;
    if (filter) { b.style.cursor = 'pointer'; b.onclick = () => { toggleFacet(filter[0], filter[1]); }; }
    meta.appendChild(b);
  };
  badge(t.kind, 'kind', ['kind', t.kind]);
  if (t.access && t.access !== 'unknown') badge(t.access, ACCESS_CLASS[t.access], ['access', t.access]);
  for (const g of t.targets.slice(0, 3)) badge(g, 'tgt', ['target', g]);
  for (const r of t.regions.slice(0, 2)) badge(r, 'region', ['region', r]);
  const hl = HEALTH_LABEL[t.health.status];
  if (hl) badge(hl, t.health.status === 'dead' || t.health.status === 'unreachable' ? 'dead' : 'warnst', null);
  if (t.format) badge(t.format, 'kind', null);
  a.appendChild(meta);
  return a;
}

function renderFacets(list) {
  const counts = facetCounts(list);
  // Facet options are computed from the whole corpus so a selected value never vanishes,
  // but the counts shown reflect the current result set.
  const all = facetCounts(TOOLS.filter((t) => state.retired === 'hide' ? !t.retired : true));
  facetsEl.textContent = '';
  for (const [key, label] of FACET_ORDER) {
    const selected = state.facets[key] || [];
    let entries = Object.entries(all[key] || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!entries.length) continue;
    const sec = document.createElement('div');
    sec.className = 'facet' + (selected.length ? ' active' : '');
    const h = document.createElement('h3');
    h.textContent = label;
    const clr = document.createElement('button');
    clr.textContent = 'clear'; clr.onclick = () => { delete state.facets[key]; render(true); };
    h.appendChild(clr);
    sec.appendChild(h);

    const isOpen = expanded.has(key);
    // Small closed enums (type, access, link health) are shown in full — hiding 'feed' or
    // 'dataset' behind a "+2 more" link buried the filters people reach for most.
    const CAPS = { category: 16, kind: Infinity, access: Infinity, health: Infinity, target: 12, region: 12 };
    const cap = CAPS[key] ?? 10;
    const visible = isOpen ? entries : entries.slice(0, cap);
    for (const [value, _total] of visible) {
      const n = counts[key]?.[value] || 0;
      const btn = document.createElement('button');
      btn.className = 'opt';
      btn.setAttribute('aria-pressed', selected.includes(value.toLowerCase()) ? 'true' : 'false');
      const name = document.createElement('span');
      name.textContent = value;
      const c = document.createElement('span');
      c.className = 'c'; c.textContent = n;
      btn.append(name, c);
      btn.onclick = () => toggleFacet(key, value);
      sec.appendChild(btn);
    }
    if (entries.length > cap) {
      const more = document.createElement('button');
      more.className = 'more';
      more.textContent = isOpen ? '− less' : \`+ \${entries.length - cap} more\`;
      more.onclick = () => { isOpen ? expanded.delete(key) : expanded.add(key); render(); };
      sec.appendChild(more);
    }
    facetsEl.appendChild(sec);
  }
}

function toggleFacet(key, value) {
  const v = String(value).toLowerCase();
  const cur = state.facets[key] || [];
  state.facets[key] = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  if (!state.facets[key].length) delete state.facets[key];
  render(true);
}

function renderChips() {
  chipsEl.textContent = '';
  for (const [key, vals] of Object.entries(state.facets)) {
    for (const v of vals) {
      const b = document.createElement('button');
      b.className = 'chip'; b.textContent = \`\${key}:\${v}\`;
      b.onclick = () => toggleFacet(key, v);
      chipsEl.appendChild(b);
    }
  }
}

function render(resetPage) {
  if (resetPage) state.shown = PAGE;
  const list = currentResults();
  renderFacets(list);
  renderChips();

  el('counts').innerHTML = \`<b>\${list.length}</b> of \${DATA.stats.live} tools\`;
  el('clear').style.display = state.q ? 'block' : 'none';

  grid.textContent = '';
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.innerHTML = 'No matches. Try a broader term, or a facet like <code>target:geo</code> / <code>region:AU</code>.';
    grid.appendChild(e);
  } else {
    const frag = document.createDocumentFragment();
    for (const t of list.slice(0, state.shown)) frag.appendChild(card(t));
    grid.appendChild(frag);
  }
  const more = el('more');
  more.hidden = list.length <= state.shown;
  more.textContent = \`Show more (\${Math.max(0, list.length - state.shown)} remaining)\`;
  writeUrl();
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.q.trim()) p.set('q', state.q.trim());
  for (const [k, vals] of Object.entries(state.facets)) p.set(k, vals.join(','));
  if (state.sort !== 'relevance') p.set('sort', state.sort);
  if (state.retired !== 'hide') p.set('retired', state.retired);
  const s = p.toString();
  history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
}

function readUrl() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  state.q = p.get('q') || '';
  state.facets = {};
  for (const [key] of FACET_ORDER) {
    const v = p.get(key);
    if (v) state.facets[key] = v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  }
  const tag = p.get('tag');
  if (tag) state.facets.tag = tag.split(',');
  state.sort = p.get('sort') || 'relevance';
  state.retired = p.get('retired') || 'hide';
  el('q').value = state.q;
  el('sort').value = state.sort;
  el('retired').value = state.retired;
}

let timer;
el('q').addEventListener('input', (e) => {
  state.q = e.target.value;
  clearTimeout(timer);
  timer = setTimeout(() => render(true), 110);
});
el('clear').onclick = () => { state.q = ''; el('q').value = ''; render(true); };
el('sort').onchange = (e) => { state.sort = e.target.value; render(); };
el('retired').onchange = (e) => { state.retired = e.target.value; render(true); };
el('more').onclick = () => { state.shown += PAGE; render(); };
el('filtersbtn').onclick = (e) => {
  const open = document.body.classList.toggle('filters-open');
  e.target.setAttribute('aria-expanded', String(open));
  e.target.textContent = open ? 'Hide filters' : 'Filters';
};
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== el('q')) { e.preventDefault(); el('q').focus(); }
  if (e.key === 'Escape' && document.activeElement === el('q')) { state.q = ''; el('q').value = ''; render(true); }
});
window.addEventListener('hashchange', () => { readUrl(); render(true); });

el('prov').textContent =
  \`\${DATA.stats.tools} entries · \${DATA.stats.described} with verified descriptions · \${DATA.stats.fromResearch} added by the \${new Date(DATA.generatedAt).getFullYear()} research pass · dataset built \${DATA.generatedAt.slice(0, 10)} · seeded from halans/osint-explorer (bookmark export, 2025-11-04).\`;

readUrl();
render(true);
</script>
</body>
</html>
`;
}
