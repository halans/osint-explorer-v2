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
