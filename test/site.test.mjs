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
