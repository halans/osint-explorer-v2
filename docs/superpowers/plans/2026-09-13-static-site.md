# Static SEO/AEO Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, independent build target — `npm run build:site` — that generates a real multi-page static site (`site/`) from `data/tools.enriched.json`, suitable for hosting on GitHub Pages, with per-category pages, JSON-LD, sitemap, and canonical/OG tags, plus a GitHub Actions workflow that deploys it on push.

**Architecture:** `scripts/build-site.mjs` follows the same pattern as the existing `scripts/build.mjs`: small pure functions (slugify, escape, render, JSON-LD builders) exported for direct unit testing, plus a script body that loads the dataset and writes files. No new dependencies. `site/` is gitignored (CI builds fresh on every deploy); it is unrelated to `dist/osint-explorer.html`, which keeps being the offline single-file artifact.

**Tech Stack:** Node.js (`node:fs`, `node:path`, `node:url`), `node --test` + `node:assert/strict` for tests (matches `test/equivalence.test.mjs`), GitHub Actions (`actions/setup-node`, `actions/upload-pages-artifact`, `actions/deploy-pages`).

**Spec:** `docs/superpowers/specs/2026-09-13-static-site-design.md`

---

## Before you start

Read `scripts/build.mjs` in full — this plan's code follows its conventions
(ESM, `node:fs`/`node:path`/`node:url` imports, `ROOT` computed via
`fileURLToPath`, exported pure functions for testability). Read
`test/equivalence.test.mjs` for the test conventions this plan's tests
follow (`hasDataset` skip guard, real dataset, no mocks).

All file paths below are relative to the repo root:
`/Users/halans/Development/GitHub/_HYPERAGENT/osint-explorer-v2`.

---

### Task 1: Scaffolding — new script file, npm script, gitignore entry

**Files:**
- Create: `scripts/build-site.mjs`
- Modify: `package.json` (scripts block)
- Modify: `.gitignore`

- [ ] **Step 1: Create the script file with imports and the base URL constant**

Write `scripts/build-site.mjs`:

```js
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
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add `"build:site"` to the `"scripts"` object, right after
`"build"`:

```json
    "build": "node scripts/build.mjs",
    "build:site": "node scripts/build-site.mjs",
```

- [ ] **Step 3: Add the gitignore entry**

Append to `.gitignore`:

```
# Generated static site (CI builds this fresh on every deploy)
site/
```

- [ ] **Step 4: Verify the script runs (does nothing yet, but must not error)**

Run: `node scripts/build-site.mjs`
Expected: exits with no output and no error (the script currently has no
body statements after the constants — this just confirms the imports and
ROOT/BASE_URL setup are syntactically valid).

- [ ] **Step 5: Commit**

```bash
git add scripts/build-site.mjs package.json .gitignore
git commit -m "Scaffold build-site.mjs, npm script, and gitignore entry"
```

---

### Task 2: String helpers — slugify, escapeHtml, escapeJsonLd, hostOf, mapKindToSchemaType

**Files:**
- Modify: `scripts/build-site.mjs`
- Test: `test/site.test.mjs` (create)

- [ ] **Step 1: Write the failing tests**

Create `test/site.test.mjs`:

```js
// Static-site build tests.
//
// Same conventions as test/equivalence.test.mjs: real dataset, no mocks,
// pure functions imported directly from the build script.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BASE_URL, slugify, slugifyAll, escapeHtml, escapeJsonLd, hostOf,
  mapKindToSchemaType,
} from '../scripts/build-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = join(ROOT, 'data/tools.enriched.json');
const hasDataset = existsSync(DATASET);
const dataOpts = { skip: hasDataset ? false : 'dataset not built — run npm run data' };
const ds = hasDataset
  ? JSON.parse(readFileSync(DATASET, 'utf8'))
  : { tools: [], categories: [], stats: {}, generatedAt: '' };

test('slugify lowercases, strips punctuation, and hyphenates', () => {
  assert.equal(slugify('Area & Event Monitoring'), 'area-event-monitoring');
  assert.equal(slugify('OSINT Tools, Resources & Blogs'), 'osint-tools-resources-blogs');
  assert.equal(slugify('  Leading/Trailing  '), 'leading-trailing');
});

test('slugifyAll de-duplicates collisions with a numeric suffix', () => {
  assert.deepEqual(slugifyAll(['A & B', 'A - B', 'A / B']), ['a-b', 'a-b-2', 'a-b-3']);
});

test('escapeHtml escapes &, <, >, and "', () => {
  assert.equal(escapeHtml('<a> & "b"'), '&lt;a&gt; &amp; &quot;b&quot;');
});

test('escapeJsonLd escapes < so </script> cannot break out of the tag', () => {
  assert.equal(escapeJsonLd('{"x":"</script>"}'), '{"x":"\\u003c/script>"}');
});

test('hostOf strips a leading www. and tolerates a malformed url', () => {
  assert.equal(hostOf('https://www.example.com/path'), 'example.com');
  assert.equal(hostOf('not a url'), 'not a url');
});

test('mapKindToSchemaType covers every kind value present in the real dataset', dataOpts, () => {
  const kinds = new Set(ds.tools.map((t) => t.kind));
  assert.ok(kinds.size > 0, 'dataset has no tools to check kinds against');
  for (const k of kinds) {
    assert.notEqual(mapKindToSchemaType(k), 'Thing', `unmapped kind: ${k}`);
  }
});

test('mapKindToSchemaType has a Thing fallback for anything unrecognized', () => {
  assert.equal(mapKindToSchemaType('made-up-kind'), 'Thing');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/site.test.mjs`
Expected: FAIL — `slugify is not a function` (or similar import error), since
none of these functions exist yet.

- [ ] **Step 3: Implement the functions**

Append to `scripts/build-site.mjs`, after the `BASE_URL` constant:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/site.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-site.mjs test/site.test.mjs
git commit -m "Add slug/escape/host/kind-mapping helpers for the static site build"
```

---

### Task 3: Category grouping — groupByCategory

**Files:**
- Modify: `scripts/build-site.mjs`
- Test: `test/site.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `test/site.test.mjs`:

```js
import { groupByCategory } from '../scripts/build-site.mjs';

test('groupByCategory assigns one unique slug per category', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  assert.equal(categories.length, ds.categories.length);
  const slugs = categories.map((c) => c.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate category slugs');
});

test('groupByCategory accounts for every tool that has a matching category', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  const totalGrouped = categories.reduce((n, c) => n + c.tools.length, 0);
  const categoryNames = new Set(ds.categories.map((c) => c.name));
  const totalExpected = ds.tools.filter((t) => categoryNames.has(t.category)).length;
  assert.equal(totalGrouped, totalExpected);
});

test('groupByCategory groups tools under their subcategory, sorted by name', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  const withSubs = categories.find((c) => c.bySubcategory.length > 1);
  assert.ok(withSubs, 'fixture dataset needs at least one category with multiple subcategories');
  for (const sub of withSubs.bySubcategory) {
    const names = sub.tools.map((t) => t.name.toLowerCase());
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted, `tools in ${withSubs.slug}/${sub.name} are not sorted`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/site.test.mjs`
Expected: FAIL — `groupByCategory is not a function`.

- [ ] **Step 3: Implement groupByCategory**

Append to `scripts/build-site.mjs`:

```js
export function groupByCategory(tools, categoryDefs) {
  const slugs = slugifyAll(categoryDefs.map((c) => c.name));
  return categoryDefs.map((def, i) => {
    const catTools = tools
      .filter((t) => t.category === def.name)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const bySub = new Map();
    for (const t of catTools) {
      const key = t.subcategory || 'General';
      if (!bySub.has(key)) bySub.set(key, []);
      bySub.get(key).push(t);
    }
    const bySubcategory = [...bySub.keys()]
      .sort((a, b) => a.localeCompare(b))
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/site.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-site.mjs test/site.test.mjs
git commit -m "Add groupByCategory for the static site build"
```

---

### Task 4: Lead sentences and tool card rendering

**Files:**
- Modify: `scripts/build-site.mjs`
- Test: `test/site.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `test/site.test.mjs`:

```js
import { leadSentence, categoryLeadSentence, renderToolCard } from '../scripts/build-site.mjs';

test('leadSentence reports live tool and category counts from the dataset', dataOpts, () => {
  const s = leadSentence(ds);
  assert.match(s, new RegExp(String(ds.stats.live)));
  assert.match(s, new RegExp(String(ds.stats.categories)));
});

test('categoryLeadSentence names up to four subcategories and counts the rest', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  const big = categories.find((c) => c.subcategoryNames.length > 4);
  assert.ok(big, 'fixture dataset needs a category with more than four subcategories');
  const s = categoryLeadSentence(big);
  assert.match(s, new RegExp(String(big.tools.length)));
  assert.match(s, /and \d+ more/);
});

test('renderToolCard escapes the tool name and links to its url', () => {
  const t = { name: 'A & B <Tool>', url: 'https://example.com/x', kind: 'software', access: 'free', targets: [], regions: [], retired: false, description: 'desc' };
  const html = renderToolCard(t);
  assert.match(html, /A &amp; B &lt;Tool&gt;/);
  assert.match(html, /href="https:\/\/example\.com\/x"/);
});

test('renderToolCard marks retired tools nofollow and shows a Retired badge; live tools are not nofollow', () => {
  const base = { name: 'X', url: 'https://example.com', kind: 'software', access: 'unknown', targets: [], regions: [], description: null };
  const retired = renderToolCard({ ...base, retired: true });
  const live = renderToolCard({ ...base, retired: false });
  assert.match(retired, /rel="nofollow noopener noreferrer"/);
  assert.match(retired, />Retired</);
  assert.match(live, /rel="noopener noreferrer"/);
  assert.doesNotMatch(live, /nofollow/);
});

test('renderToolCard falls back to placeholder text when description is missing', () => {
  const t = { name: 'X', url: 'https://example.com', kind: 'software', access: 'unknown', targets: [], regions: [], retired: false, description: null };
  assert.match(renderToolCard(t), /No description verified yet\./);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/site.test.mjs`
Expected: FAIL — `leadSentence is not a function`.

- [ ] **Step 3: Implement the functions**

Append to `scripts/build-site.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/site.test.mjs`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-site.mjs test/site.test.mjs
git commit -m "Add lead-sentence and tool-card rendering for the static site build"
```

---

### Task 5: JSON-LD builders

**Files:**
- Modify: `scripts/build-site.mjs`
- Test: `test/site.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `test/site.test.mjs`:

```js
import { buildToolListItem, buildCategoryJsonLd, buildHomeJsonLd } from '../scripts/build-site.mjs';

test('buildToolListItem maps kind to a schema.org type and includes description only when present', () => {
  const withDesc = buildToolListItem({ name: 'X', url: 'https://x.example', kind: 'dataset', description: 'd' }, 1);
  assert.equal(withDesc.item['@type'], 'Dataset');
  assert.equal(withDesc.item.description, 'd');
  assert.equal(withDesc.position, 1);
  const noDesc = buildToolListItem({ name: 'X', url: 'https://x.example', kind: 'dataset', description: null }, 2);
  assert.equal('description' in noDesc.item, false);
});

test('buildCategoryJsonLd emits a BreadcrumbList and a CollectionPage whose ItemList matches the category tool count', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  const category = categories[0];
  const jsonLd = buildCategoryJsonLd(category, { baseUrl: BASE_URL });
  const types = jsonLd['@graph'].map((n) => n['@type']);
  assert.ok(types.includes('BreadcrumbList'));
  const collection = jsonLd['@graph'].find((n) => n['@type'] === 'CollectionPage');
  assert.equal(collection.mainEntity.itemListElement.length, category.tools.length);
  assert.equal(collection.url, `${BASE_URL}category/${category.slug}/`);
});

test('buildHomeJsonLd lists every category as an ItemList entry', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  const jsonLd = buildHomeJsonLd(ds, categories, { baseUrl: BASE_URL });
  const collection = jsonLd['@graph'].find((n) => n['@type'] === 'CollectionPage');
  assert.equal(collection.mainEntity.itemListElement.length, categories.length);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/site.test.mjs`
Expected: FAIL — `buildToolListItem is not a function`.

- [ ] **Step 3: Implement the functions**

Append to `scripts/build-site.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/site.test.mjs`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-site.mjs test/site.test.mjs
git commit -m "Add JSON-LD builders for the static site build"
```

---

### Task 6: Page assembly — headTags, basePage, renderHomePage, renderCategoryPage, render404

**Files:**
- Modify: `scripts/build-site.mjs`
- Test: `test/site.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `test/site.test.mjs`:

```js
import { renderHomePage, renderCategoryPage, render404 } from '../scripts/build-site.mjs';

test('renderHomePage has exactly one h1, a canonical link, and OG/Twitter tags', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  const html = renderHomePage(ds, categories, { baseUrl: BASE_URL });
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.match(html, new RegExp(`<link rel="canonical" href="${BASE_URL}">`));
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:card"/);
});

test('renderHomePage links to every category and to the GitHub repo', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  const html = renderHomePage(ds, categories, { baseUrl: BASE_URL });
  for (const c of categories) {
    assert.match(html, new RegExp(`href="category/${c.slug}/"`), `missing link to ${c.slug}`);
  }
  assert.match(html, /href="https:\/\/github\.com\/halans\/osint-explorer-v2"/);
});

test('renderCategoryPage has exactly one h1, an h2 per subcategory, and a breadcrumb', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  const category = categories.find((c) => c.bySubcategory.length > 1) || categories[0];
  const html = renderCategoryPage(category, { baseUrl: BASE_URL });
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.equal((html.match(/<h2[ >]/g) || []).length, category.bySubcategory.length);
  assert.match(html, /class="breadcrumb"/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${BASE_URL}category/${category.slug}/">`));
});

test('renderCategoryPage includes every tool name from that category', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  const category = categories[0];
  const html = renderCategoryPage(category, { baseUrl: BASE_URL });
  for (const t of category.tools) {
    assert.ok(html.includes(escapeHtml(t.name)), `${t.name} missing from its category page`);
  }
});

function extractJsonLd(html) {
  const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(m, 'no JSON-LD script tag found');
  return JSON.parse(m[1]);
}

test('a rendered category page\'s embedded JSON-LD parses and its ItemList length matches the tool count', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  for (const category of categories) {
    const html = renderCategoryPage(category, { baseUrl: BASE_URL });
    const jsonLd = extractJsonLd(html);
    const collection = jsonLd['@graph'].find((n) => n['@type'] === 'CollectionPage');
    assert.equal(collection.mainEntity.itemListElement.length, category.tools.length, `ItemList length mismatch for ${category.slug}`);
  }
});

test('render404 is marked noindex and links home', () => {
  const html = render404({ baseUrl: BASE_URL });
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /href="\.\/"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/site.test.mjs`
Expected: FAIL — `renderHomePage is not a function`.

- [ ] **Step 3: Implement the functions**

Append to `scripts/build-site.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/site.test.mjs`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-site.mjs test/site.test.mjs
git commit -m "Add page assembly (homepage, category page, 404) for the static site build"
```

---

### Task 7: Sitemap and robots.txt

**Files:**
- Modify: `scripts/build-site.mjs`
- Test: `test/site.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `test/site.test.mjs`:

```js
import { buildSitemap, buildRobotsTxt } from '../scripts/build-site.mjs';

test('buildSitemap has exactly one <url> per category plus the homepage', dataOpts, () => {
  const categories = groupByCategory(ds.tools, ds.categories);
  const paths = ['', ...categories.map((c) => `category/${c.slug}/`)];
  const xml = buildSitemap(paths, { baseUrl: BASE_URL, lastmod: ds.generatedAt.slice(0, 10) });
  const count = [...xml.matchAll(/<url>/g)].length;
  assert.equal(count, categories.length + 1);
  assert.match(xml, new RegExp(`<loc>${BASE_URL}</loc>`));
  assert.match(xml, new RegExp(`<loc>${BASE_URL}category/${categories[0].slug}/</loc>`));
});

test('buildRobotsTxt allows everything and points at the sitemap under the base URL', () => {
  const txt = buildRobotsTxt(BASE_URL);
  assert.match(txt, /Allow: \//);
  assert.match(txt, new RegExp(`Sitemap: ${BASE_URL}sitemap\\.xml`));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/site.test.mjs`
Expected: FAIL — `buildSitemap is not a function`.

- [ ] **Step 3: Implement the functions**

Append to `scripts/build-site.mjs`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/site.test.mjs`
Expected: PASS, 26 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-site.mjs test/site.test.mjs
git commit -m "Add sitemap and robots.txt builders for the static site build"
```

---

### Task 8: Stylesheet and the main script body — write site/ to disk

**Files:**
- Modify: `scripts/build-site.mjs`
- Test: `test/site.test.mjs`

- [ ] **Step 1: Write the failing integration test**

Append to `test/site.test.mjs`:

```js
import { execFileSync } from 'node:child_process';

test('npm run build:site writes a complete site/ tree', dataOpts, () => {
  execFileSync('node', [join(ROOT, 'scripts/build-site.mjs')], { encoding: 'utf8' });
  const categories = groupByCategory(ds.tools, ds.categories);
  assert.ok(existsSync(join(ROOT, 'site/index.html')));
  assert.ok(existsSync(join(ROOT, 'site/sitemap.xml')));
  assert.ok(existsSync(join(ROOT, 'site/robots.txt')));
  assert.ok(existsSync(join(ROOT, 'site/404.html')));
  assert.ok(existsSync(join(ROOT, 'site/assets/style.css')));
  for (const c of categories) {
    assert.ok(existsSync(join(ROOT, 'site/category', c.slug, 'index.html')), `missing page for ${c.slug}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/site.test.mjs`
Expected: FAIL — `site/index.html` does not exist (the script has no write
logic yet).

- [ ] **Step 3: Add the stylesheet constant and the script body**

Append to `scripts/build-site.mjs`:

```js
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
.bar { max-width: 1100px; margin: 0 auto; padding: 14px 24px; }
.brand { font-weight: 700; font-size: 19px; color: var(--ink); }
.brand span { color: var(--accent); }
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

function writeSite(ds) {
  const categories = groupByCategory(ds.tools, ds.categories);
  const lastmod = ds.generatedAt.slice(0, 10);

  mkdirSync(join(ROOT, 'site/assets'), { recursive: true });
  writeFileSync(join(ROOT, 'site/assets/style.css'), STYLE_CSS);
  writeFileSync(join(ROOT, 'site/index.html'), renderHomePage(ds, categories, { baseUrl: BASE_URL }));
  writeFileSync(join(ROOT, 'site/404.html'), render404({ baseUrl: BASE_URL }));

  for (const category of categories) {
    const dir = join(ROOT, 'site/category', category.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderCategoryPage(category, { baseUrl: BASE_URL }));
  }

  const paths = ['', ...categories.map((c) => `category/${c.slug}/`)];
  writeFileSync(join(ROOT, 'site/sitemap.xml'), buildSitemap(paths, { baseUrl: BASE_URL, lastmod }));
  writeFileSync(join(ROOT, 'site/robots.txt'), buildRobotsTxt(BASE_URL));

  return categories;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ds = loadDataset();
  const categories = writeSite(ds);
  console.log(`site/  ${categories.length} category pages, ${ds.stats.live} live tools`);
}
```

Note the `if (import.meta.url === ...)` guard: it makes the write-to-disk
side effect run only when the file is executed directly (`node
scripts/build-site.mjs`), not when `test/site.test.mjs` imports functions
from it — matching how `scripts/build.mjs` is written to be both a CLI
script and an importable module.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/site.test.mjs`
Expected: PASS, 27 tests.

- [ ] **Step 5: Manually inspect the output**

Run: `node scripts/build-site.mjs`
Expected output: `site/  15 category pages, 711 live tools` (exact numbers
depend on the current dataset).

Then open `site/index.html` and one category page (e.g.
`site/category/country-specific/index.html`) directly in a browser and
confirm: the page renders with the dark theme, category cards / tool cards
link out correctly, and there is no visible layout breakage.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-site.mjs test/site.test.mjs
git commit -m "Wire up the static site build: stylesheet, disk writes, CLI entry point"
```

---

### Task 9: GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/pages.yml`:

```yaml
name: Deploy static site to Pages

on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm run build:site
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Validate the YAML parses**

Run: `node -e "require('node:fs').readFileSync('.github/workflows/pages.yml','utf8')"` to
confirm the file is readable, then run any locally-available YAML linter if
one exists in the environment (e.g. `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pages.yml'))"`).
Expected: no errors from either command. If neither tool is available,
visually re-check indentation against the block above — GitHub Actions
YAML is indentation-sensitive and this is the most common failure mode.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "Add GitHub Actions workflow to build and deploy the static site to Pages"
```

- [ ] **Step 4: One-time manual step (not performable from the repo)**

In the GitHub repo (`halans/osint-explorer-v2`) settings:
**Settings → Pages → Source → "GitHub Actions"**.

Without this, the workflow will run and upload the artifact successfully
but the `deploy` job will fail with a permissions/configuration error.

---

## Final check

- [ ] Run the full test suite: `npm test`
  Expected: all suites pass, including `test/site.test.mjs`.
- [ ] Run `npm run build:site` once more from a clean state and confirm
  `site/` is not tracked by git: `git status --short` should show nothing
  under `site/`.
- [ ] Push to `master` (or open a PR) and confirm the "Deploy static site to
  Pages" workflow run succeeds, then visit
  `https://halans.github.io/osint-explorer-v2/` to confirm the homepage and
  at least one category page load correctly.
