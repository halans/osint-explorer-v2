#!/usr/bin/env node
// Normalise the two seed bookmark exports into one v2 dataset.
//
//   node scripts/normalise.mjs
//
// Reads   data/seed/tools.json        (richer: icons, subSubcategory)
//         data/seed/osint-tools.json  (tree with counts, slug ids)
// Writes  data/tools.v2.json          (dataset, no icons)
//         data/icons.json             (id -> base64 data URI, split out to keep the dataset light)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCHEMA_VERSION, slugify } from '../src/schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const seed = JSON.parse(readFileSync(join(ROOT, 'data/seed/tools.json'), 'utf8'));
const alt = JSON.parse(readFileSync(join(ROOT, 'data/seed/osint-tools.json'), 'utf8'));

// --- categories ------------------------------------------------------------
const treeCounts = new Map(Object.entries(alt.targets?.topLevelCounts || {}));
const categories = (seed.categories || []).map((c) => {
  const name = typeof c === 'string' ? c : c.name;
  return {
    name,
    subcategories: (typeof c === 'object' && Array.isArray(c.subcategories)) ? c.subcategories : [],
    seedCount: seed.tools.filter((t) => t.category === name).length,
    treeCount: treeCounts.get(name) ?? null,
  };
});

// --- tools -----------------------------------------------------------------
const ids = new Set();
const uniqueId = (base) => {
  let id = base || 'tool';
  let n = 2;
  while (ids.has(id)) id = `${base}-${n++}`;
  ids.add(id);
  return id;
};

const icons = {};
const byUrl = new Map();
const tools = [];
let droppedDuplicates = 0;

for (const t of seed.tools) {
  const urlKey = String(t.url || '').replace(/\/+$/, '').toLowerCase();
  if (!urlKey) continue;
  if (byUrl.has(urlKey)) {
    // Same URL bookmarked under two categories: keep the first, record the alias.
    const existing = tools[byUrl.get(urlKey)];
    if (!existing.alsoIn.includes(t.path)) existing.alsoIn.push(t.path);
    droppedDuplicates++;
    continue;
  }

  const id = uniqueId(slugify(t.category, t.name));
  if (t.icon) icons[id] = t.icon;

  byUrl.set(urlKey, tools.length);
  tools.push({
    id,
    name: cleanName(t.name),
    url: t.url,
    category: t.category,
    subcategory: t.subcategory || null,
    subSubcategory: t.subSubcategory || null,
    path: t.path,
    alsoIn: [],
    tags: dedupe(t.tags || []),
    // --- enrichment layer, filled in by the research + description passes ---
    description: null,
    targets: [],
    access: 'unknown',
    kind: 'web-tool',
    regions: [],           // ISO-ish region hints, e.g. ['AU'] or [] for global
    health: { status: 'unchecked', httpStatus: null, finalUrl: null, checkedAt: null },
    retired: false,
    notes: null,
    provenance: 'seed:bookmarks.html@2025-11-04',
    hasIcon: Boolean(t.icon),
  });
}

function cleanName(name) {
  return String(name)
    .replace(/\s+/g, ' ')
    .trim();
}
function dedupe(arr) {
  return [...new Set(arr.map((s) => String(s).toLowerCase().trim()).filter(Boolean))];
}

const dataset = {
  schemaVersion: SCHEMA_VERSION,
  title: 'OSINT Explorer',
  generatedAt: new Date().toISOString(),
  sources: [
    { id: 'seed', file: 'data/seed/tools.json', origin: 'halans/osint-explorer', generatedAt: seed.metadata?.generatedAt, tools: seed.tools.length },
    { id: 'seed-alt', file: 'data/seed/osint-tools.json', origin: 'halans/osint-explorer', generatedAt: alt.generatedAt, tools: (alt.tools || []).length },
  ],
  categories,
  tools,
};

writeFileSync(join(ROOT, 'data/tools.v2.json'), JSON.stringify(dataset, null, 2) + '\n');
writeFileSync(join(ROOT, 'data/icons.json'), JSON.stringify(icons) + '\n');

console.log(`normalised ${tools.length} tools (${droppedDuplicates} duplicate URLs folded) across ${categories.length} categories`);
console.log(`icons: ${Object.keys(icons).length}`);
