#!/usr/bin/env node
// Build the SEO/AEO-facing static site from the enriched dataset.
//
//   node scripts/build-site.mjs
//
// Input   data/tools.enriched.json
// Output  site/                one static HTML page per category, plus a
//                               homepage, sitemap.xml, robots.txt, 404.html
//
// Independent of scripts/build.mjs (the offline single-file app) — both
// read the same dataset, neither depends on the other's output. Unlike
// dist/osint-explorer.html, site/ is never committed: it's generated fresh
// by CI on every deploy (see .github/workflows/pages.yml).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_URL = 'https://halans.github.io/osint-explorer-v2/';

export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function slugifyAll(names) {
  const seen = new Map();
  return names.map((name) => {
    const base = slugify(name);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeJsonLd(json) {
  return json.replace(/</g, '\\u003c');
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

const DATASET_KINDS = new Set(['dataset', 'database', 'feed']);
const APP_KINDS = new Set(['software', 'web-tool', 'map', 'search', 'api']);
const CREATIVE_KINDS = new Set(['directory', 'reading']);

export function mapKindToSchemaType(kind) {
  if (DATASET_KINDS.has(kind)) return 'Dataset';
  if (APP_KINDS.has(kind)) return 'SoftwareApplication';
  if (CREATIVE_KINDS.has(kind)) return 'CreativeWork';
  return 'Thing';
}

export function groupByCategory(tools, categoryDefs) {
  const slugs = slugifyAll(categoryDefs.map((c) => c.name));
  return categoryDefs.map((def, i) => {
    // Plain codepoint comparison, not .localeCompare(): the real dataset has
    // names with curly apostrophes whose locale-aware order disagrees with
    // this file's own tests, which check sort order via plain Array.sort().
    const catTools = tools
      .filter((t) => t.category === def.name)
      .sort((a, b) => {
        const aLower = a.name.toLowerCase();
        const bLower = b.name.toLowerCase();
        return aLower < bLower ? -1 : aLower > bLower ? 1 : 0;
      });
    const bySub = new Map();
    for (const t of catTools) {
      const key = t.subcategory || 'General';
      if (!bySub.has(key)) bySub.set(key, []);
      bySub.get(key).push(t);
    }
    const bySubcategory = [...bySub.keys()]
      .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      .map((name) => ({ name, tools: bySub.get(name) }));
    return {
      name: def.name,
      slug: slugs[i],
      tools: catTools,
      subcategoryNames: def.subcategories || [],
      bySubcategory,
    };
  });
}

export function leadSentence(ds) {
  return `OSINT Explorer is a directory of ${ds.stats.live} link-checked open source `
    + `intelligence tools, datasets, and live feeds across ${ds.stats.categories} `
    + `categories. Every entry is health-checked and described.`;
}

export function categoryLeadSentence(category) {
  const subs = category.subcategoryNames;
  let coverage = '';
  if (subs.length) {
    const shown = subs.slice(0, 4).join(', ');
    const more = subs.length > 4 ? `, and ${subs.length - 4} more` : '';
    coverage = `, covering ${shown}${more}`;
  }
  return `${category.tools.length} tools for ${category.name}${coverage}.`;
}

function renderBadges(t) {
  const parts = [`<span class="b kind">${escapeHtml(t.kind)}</span>`];
  if (t.access && t.access !== 'unknown') parts.push(`<span class="b access">${escapeHtml(t.access)}</span>`);
  for (const g of t.targets.slice(0, 3)) parts.push(`<span class="b tgt">${escapeHtml(g)}</span>`);
  for (const r of t.regions.slice(0, 2)) parts.push(`<span class="b region">${escapeHtml(r)}</span>`);
  if (t.retired) parts.push(`<span class="b dead">Retired</span>`);
  return parts.join('');
}

export function renderToolCard(t) {
  const rel = t.retired ? 'nofollow noopener noreferrer' : 'noopener noreferrer';
  const desc = t.description
    ? `<p class="desc">${escapeHtml(t.description)}</p>`
    : `<p class="desc missing">No description verified yet.</p>`;
  // The id lets the site search results deep-link straight to this card.
  const idAttr = t.id ? ` id="${escapeHtml(t.id)}"` : '';
  return `<article${idAttr} class="${t.retired ? 'retired' : ''}">
  <div class="top">
    <h3><a href="${escapeHtml(t.url)}" target="_blank" rel="${rel}">${escapeHtml(t.name)}</a></h3>
    <div class="host">${escapeHtml(hostOf(t.url))}</div>
  </div>
  ${desc}
  <div class="meta">${renderBadges(t)}</div>
</article>`;
}

export function buildToolListItem(t, position) {
  const item = { '@type': mapKindToSchemaType(t.kind), name: t.name, url: t.url };
  if (t.description) item.description = t.description;
  return { '@type': 'ListItem', position, item };
}

export function buildCategoryJsonLd(category, { baseUrl }) {
  const catUrl = `${baseUrl}category/${category.slug}/`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
          { '@type': 'ListItem', position: 2, name: category.name, item: catUrl },
        ],
      },
      {
        '@type': 'CollectionPage',
        name: `${category.name} — OSINT Explorer`,
        url: catUrl,
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: category.tools.map((t, i) => buildToolListItem(t, i + 1)),
        },
      },
    ],
  };
}

export function buildHomeJsonLd(ds, categories, { baseUrl }) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'OSINT Explorer', url: baseUrl, description: leadSentence(ds) },
      {
        '@type': 'CollectionPage',
        name: 'OSINT Explorer — Categories',
        url: baseUrl,
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: categories.map((c, i) => ({
            '@type': 'ListItem', position: i + 1, name: c.name, url: `${baseUrl}category/${c.slug}/`,
          })),
        },
      },
    ],
  };
}

function headTags({ title, description, canonical, robots }) {
  return `<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${robots ? `<meta name="robots" content="${robots}">\n` : ''}<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">`;
}

function basePage({ head, body, jsonLd, cssHref, searchJsHref }) {
  const searchScript = searchJsHref ? `\n<script src="${searchJsHref}" defer></script>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
<link rel="stylesheet" href="${cssHref}">
<script type="application/ld+json">${escapeJsonLd(JSON.stringify(jsonLd))}</script>
</head>
<body>
${body}${searchScript}
</body>
</html>
`;
}

// Shared header markup for every page: brand link, the client-side search box
// (wired up by assets/search.js), and a link to the full interactive app —
// `homeHref`/`appHref` are relative and differ by how deep the page sits.
function siteHeader({ homeHref, appHref }) {
  return `<header><div class="bar">
  <a class="brand" href="${homeHref}">OSINT<span>/</span>Explorer</a>
  <div class="sitesearch">
    <input type="search" id="ss-q" placeholder="Search tools…" autocomplete="off" aria-label="Search tools">
    <div id="ss-results" class="ss-results" hidden></div>
  </div>
  <a class="applink" href="${appHref}">Full search app →</a>
</div></header>`;
}

export function renderHomePage(ds, categories, { baseUrl }) {
  const description = leadSentence(ds);
  const head = headTags({ title: 'OSINT Explorer — open source intelligence tools directory', description, canonical: baseUrl });
  const cards = categories.map((c) => `<a class="catcard" href="category/${c.slug}/">
    <h2>${escapeHtml(c.name)}</h2>
    <p>${escapeHtml(categoryLeadSentence(c))}</p>
  </a>`).join('\n');
  const body = `${siteHeader({ homeHref: './', appHref: 'app/' })}
<main class="shell">
  <h1>OSINT Explorer</h1>
  <p class="lead">${escapeHtml(description)}</p>
  <p class="stats">${ds.stats.live} live tools · ${ds.stats.categories} categories · updated ${ds.generatedAt.slice(0, 10)}</p>
  <div class="grid catgrid">${cards}</div>
  <p class="cta">Want the full faceted search and filter experience? Open the <a href="app/">interactive explorer</a>, or clone the repo and install the CLI — <a href="https://github.com/halans/osint-explorer-v2">halans/osint-explorer-v2</a> on GitHub.</p>
</main>
<footer><p>Data generated ${ds.generatedAt.slice(0, 10)}.</p></footer>`;
  return basePage({ head, body, jsonLd: buildHomeJsonLd(ds, categories, { baseUrl }), cssHref: 'assets/style.css', searchJsHref: 'assets/search.js' });
}

export function renderCategoryPage(category, { baseUrl }) {
  const catUrl = `${baseUrl}category/${category.slug}/`;
  const description = categoryLeadSentence(category);
  const head = headTags({ title: `${category.name} — OSINT Explorer`, description, canonical: catUrl });
  const sections = category.bySubcategory.map((sub) => `<section>
    <h2>${escapeHtml(sub.name)}</h2>
    <div class="grid">
      ${sub.tools.map(renderToolCard).join('\n')}
    </div>
  </section>`).join('\n');
  const body = `${siteHeader({ homeHref: '../../', appHref: '../../app/' })}
<main class="shell">
  <nav class="breadcrumb"><a href="../../">Home</a> / ${escapeHtml(category.name)}</nav>
  <h1>${escapeHtml(category.name)}</h1>
  <p class="lead">${escapeHtml(description)}</p>
  ${sections}
</main>
<footer><p><a href="../../">&larr; All categories</a></p></footer>`;
  return basePage({ head, body, jsonLd: buildCategoryJsonLd(category, { baseUrl }), cssHref: '../../assets/style.css', searchJsHref: '../../assets/search.js' });
}

export function render404({ baseUrl }) {
  const head = headTags({ title: '404 — OSINT Explorer', description: 'Page not found.', canonical: `${baseUrl}404.html`, robots: 'noindex' });
  const body = `<main class="shell"><h1>404 — page not found</h1><p><a href="./">Back to OSINT Explorer</a></p></main>`;
  return basePage({ head, body, jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: '404 Not Found' }, cssHref: 'assets/style.css' });
}

export function buildSitemap(paths, { baseUrl, lastmod }) {
  const urls = paths.map((p) => `  <url>
    <loc>${baseUrl}${p}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function buildRobotsTxt(baseUrl) {
  return `User-agent: *
Allow: /

Sitemap: ${baseUrl}sitemap.xml
`;
}

// Flat, cross-category index for the client-side search box. Absolute hrefs
// (baseUrl-prefixed) so the same generated array works unmodified regardless
// of which page depth loaded it — homepage, a category page, or the 404.
// Description is truncated: it's only ever used for substring matching, not
// displayed, and this asset is repeated in full on every page load until the
// browser caches it.
const SEARCH_DESCRIPTION_MAX = 100;

export function buildSearchIndex(categories, { baseUrl }) {
  const entries = [];
  for (const c of categories) {
    for (const t of c.tools) {
      entries.push({
        n: t.name,
        c: c.name,
        d: t.description ? t.description.slice(0, SEARCH_DESCRIPTION_MAX) : '',
        h: `${baseUrl}category/${c.slug}/${t.id ? `#${t.id}` : ''}`,
      });
    }
  }
  return entries;
}

// Vanilla JS, no dependencies. Builds result elements via createElement/
// textContent (not innerHTML) so dataset-controlled tool names/categories
// can never be interpreted as markup — same discipline as the tool-card
// rendering in scripts/build.mjs.
const SEARCH_SCRIPT = `(function () {
  var input = document.getElementById('ss-q');
  var box = document.getElementById('ss-results');
  if (!input || !box || typeof SEARCH_INDEX === 'undefined') return;

  function renderResults(list) {
    box.textContent = '';
    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'ss-empty';
      empty.textContent = 'No matches';
      box.appendChild(empty);
      box.hidden = false;
      return;
    }
    var frag = document.createDocumentFragment();
    list.slice(0, 25).forEach(function (e) {
      var a = document.createElement('a');
      a.href = e.h;
      var name = document.createElement('span');
      name.className = 'ss-name';
      name.textContent = e.n;
      var cat = document.createElement('span');
      cat.className = 'ss-cat';
      cat.textContent = e.c;
      a.appendChild(name);
      a.appendChild(cat);
      frag.appendChild(a);
    });
    box.appendChild(frag);
    box.hidden = false;
  }

  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    if (!q) { box.hidden = true; box.textContent = ''; return; }
    renderResults(SEARCH_INDEX.filter(function (e) {
      return e.n.toLowerCase().indexOf(q) !== -1
        || e.c.toLowerCase().indexOf(q) !== -1
        || (e.d && e.d.toLowerCase().indexOf(q) !== -1);
    }));
  });
  input.addEventListener('keydown', function (evt) {
    if (evt.key === 'Escape') { input.value = ''; box.hidden = true; box.textContent = ''; }
  });
  document.addEventListener('click', function (evt) {
    if (evt.target !== input && !box.contains(evt.target)) box.hidden = true;
  });
})();
`;

export function buildSearchAssetJs(categories, { baseUrl }) {
  return `const SEARCH_INDEX = ${JSON.stringify(buildSearchIndex(categories, { baseUrl }))};\n${SEARCH_SCRIPT}`;
}

const STYLE_CSS = `:root {
  --bg: #0b0f14; --panel: #111820; --panel-2: #161f29;
  --line: #223040; --line-soft: #1a2532;
  --ink: #e6edf5; --ink-dim: #94a6bb; --ink-faint: #64798f;
  --accent: #4cc2ff; --accent-dim: #1b4f6b;
  --good: #5fd38d; --warn: #ffb454; --bad: #ff6b6b;
  --sans: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --radius: 10px;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 15px; line-height: 1.5; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header { border-bottom: 1px solid var(--line); }
.bar { max-width: 1100px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.brand { font-weight: 700; font-size: 19px; color: var(--ink); white-space: nowrap; }
.brand span { color: var(--accent); }
.sitesearch { position: relative; flex: 1 1 240px; }
.sitesearch #ss-q { width: 100%; padding: 8px 10px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; font-family: var(--sans); font-size: 13px; }
.sitesearch #ss-q:focus { outline: none; border-color: var(--accent); }
.ss-results { position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; max-height: 320px; overflow-y: auto; z-index: 50; }
.ss-results a { display: flex; justify-content: space-between; gap: 10px; padding: 8px 10px; color: var(--ink); font-size: 13px; border-bottom: 1px solid var(--line-soft); }
.ss-results a:last-child { border-bottom: none; }
.ss-results a:hover { background: var(--panel-2); text-decoration: none; }
.ss-cat { color: var(--ink-faint); font-family: var(--mono); font-size: 11px; white-space: nowrap; }
.ss-empty { padding: 10px; color: var(--ink-faint); font-size: 13px; }
.applink { font-size: 12.5px; color: var(--accent); white-space: nowrap; }
.shell { max-width: 1100px; margin: 0 auto; padding: 22px 24px 60px; }
h1 { font-size: 26px; margin: 0 0 8px; }
h2 { font-size: 18px; margin: 28px 0 10px; }
h3 { font-size: 15px; margin: 0; }
.lead { color: var(--ink-dim); max-width: 70ch; }
.stats { font-family: var(--mono); font-size: 12.5px; color: var(--ink-faint); }
.breadcrumb { font-size: 13px; color: var(--ink-faint); margin-bottom: 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.catgrid a.catcard { display: block; background: var(--panel); border: 1px solid var(--line-soft); border-radius: var(--radius); padding: 16px; color: var(--ink); }
.catgrid a.catcard:hover { border-color: var(--line); text-decoration: none; }
.catgrid a.catcard p { color: var(--ink-dim); font-size: 13.5px; margin: 6px 0 0; }
article { background: var(--panel); border: 1px solid var(--line-soft); border-radius: var(--radius); padding: 13px 14px; display: flex; flex-direction: column; gap: 8px; }
article.retired { opacity: .6; }
.host { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); }
.desc { margin: 0; font-size: 13.5px; color: var(--ink-dim); }
.desc.missing { font-style: italic; color: var(--ink-faint); }
.meta { display: flex; gap: 5px; flex-wrap: wrap; }
.b { font-family: var(--mono); font-size: 10.5px; padding: 2px 7px; border-radius: 5px; border: 1px solid var(--line); color: var(--ink-faint); }
.b.dead { color: var(--bad); border-color: #5a2a2a; }
.cta { color: var(--ink-dim); font-size: 13.5px; margin-top: 30px; }
footer { max-width: 1100px; margin: 0 auto; padding: 0 24px 50px; color: var(--ink-faint); font-size: 12.5px; }
code { font-family: var(--mono); font-size: 11px; background: var(--panel); border: 1px solid var(--line-soft); border-radius: 5px; padding: 2px 6px; }
@media (max-width: 860px) {
  .shell, .bar, footer { padding-left: 14px; padding-right: 14px; }
  .grid { grid-template-columns: 1fr; }
}
`;

function loadDataset() {
  return JSON.parse(readFileSync(join(ROOT, 'data/tools.enriched.json'), 'utf8'));
}

// Publishes the already-built interactive app (npm run build) alongside the
// static site, so GitHub Pages visitors get full faceted search without
// cloning the repo. A no-op (returns false) if dist/ hasn't been built yet.
function copyInteractiveApp() {
  const src = join(ROOT, 'dist/osint-explorer.html');
  if (!existsSync(src)) return false;
  mkdirSync(join(ROOT, 'site/app'), { recursive: true });
  writeFileSync(join(ROOT, 'site/app/index.html'), readFileSync(src, 'utf8'));
  return true;
}

function writeSite(ds) {
  const categories = groupByCategory(ds.tools, ds.categories);
  const lastmod = ds.generatedAt.slice(0, 10);

  mkdirSync(join(ROOT, 'site/assets'), { recursive: true });
  writeFileSync(join(ROOT, 'site/assets/style.css'), STYLE_CSS);
  writeFileSync(join(ROOT, 'site/assets/search.js'), buildSearchAssetJs(categories, { baseUrl: BASE_URL }));
  writeFileSync(join(ROOT, 'site/index.html'), renderHomePage(ds, categories, { baseUrl: BASE_URL }));
  writeFileSync(join(ROOT, 'site/404.html'), render404({ baseUrl: BASE_URL }));
  const appPublished = copyInteractiveApp();

  for (const category of categories) {
    const dir = join(ROOT, 'site/category', category.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderCategoryPage(category, { baseUrl: BASE_URL }));
  }

  const paths = ['', ...categories.map((c) => `category/${c.slug}/`)];
  writeFileSync(join(ROOT, 'site/sitemap.xml'), buildSitemap(paths, { baseUrl: BASE_URL, lastmod }));
  writeFileSync(join(ROOT, 'site/robots.txt'), buildRobotsTxt(BASE_URL));

  return { categories, appPublished };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ds = loadDataset();
  const { categories, appPublished } = writeSite(ds);
  console.log(`site/  ${categories.length} category pages, ${ds.stats.live} live tools`);
  console.log(appPublished
    ? 'site/app/  interactive explorer published (from dist/osint-explorer.html)'
    : 'site/app/  skipped — run `npm run build` first to publish the interactive explorer');
}
