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

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
  return `<article class="${t.retired ? 'retired' : ''}">
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

function basePage({ head, body, jsonLd, cssHref }) {
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
${body}
</body>
</html>
`;
}

export function renderHomePage(ds, categories, { baseUrl }) {
  const description = leadSentence(ds);
  const head = headTags({ title: 'OSINT Explorer — open source intelligence tools directory', description, canonical: baseUrl });
  const cards = categories.map((c) => `<a class="catcard" href="category/${c.slug}/">
    <h2>${escapeHtml(c.name)}</h2>
    <p>${escapeHtml(categoryLeadSentence(c))}</p>
  </a>`).join('\n');
  const body = `<header><div class="bar"><a class="brand" href="./">OSINT<span>/</span>Explorer</a></div></header>
<main class="shell">
  <h1>OSINT Explorer</h1>
  <p class="lead">${escapeHtml(description)}</p>
  <p class="stats">${ds.stats.live} live tools · ${ds.stats.categories} categories · updated ${ds.generatedAt.slice(0, 10)}</p>
  <div class="grid catgrid">${cards}</div>
  <p class="cta">Want to search and filter interactively? Clone the repo and open <code>dist/osint-explorer.html</code>, or install the CLI — <a href="https://github.com/halans/osint-explorer-v2">halans/osint-explorer-v2</a> on GitHub.</p>
</main>
<footer><p>Data generated ${ds.generatedAt.slice(0, 10)}.</p></footer>`;
  return basePage({ head, body, jsonLd: buildHomeJsonLd(ds, categories, { baseUrl }), cssHref: 'assets/style.css' });
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
  const body = `<header><div class="bar"><a class="brand" href="../../">OSINT<span>/</span>Explorer</a></div></header>
<main class="shell">
  <nav class="breadcrumb"><a href="../../">Home</a> / ${escapeHtml(category.name)}</nav>
  <h1>${escapeHtml(category.name)}</h1>
  <p class="lead">${escapeHtml(description)}</p>
  ${sections}
</main>
<footer><p><a href="../../">&larr; All categories</a></p></footer>`;
  return basePage({ head, body, jsonLd: buildCategoryJsonLd(category, { baseUrl }), cssHref: '../../assets/style.css' });
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
