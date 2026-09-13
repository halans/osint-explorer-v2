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
  mapKindToSchemaType, groupByCategory, leadSentence, categoryLeadSentence, renderToolCard,
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
