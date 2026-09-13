// Surface-equivalence tests.
//
// The library, the CLI and the embedded web page must answer the same query the same way.
// These tests run real commands and diff real output — no mocks — so a reimplementation or
// a stale build breaks the suite rather than shipping quietly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { search } from '../src/search.mjs';
import { inlineEngine } from '../scripts/build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin/osint.mjs');
const DATASET = join(ROOT, 'data/tools.enriched.json');
const PAGE = join(ROOT, 'dist/osint-explorer.html');

const hasDataset = existsSync(DATASET);
const hasPage = existsSync(PAGE);
const dataOpts = { skip: hasDataset ? false : 'dataset not built — run npm run data' };
const pageOpts = { skip: hasDataset && hasPage ? false : 'page not built — run npm run data' };

const ds = hasDataset ? JSON.parse(readFileSync(DATASET, 'utf8')) : { tools: [] };
const page = hasPage ? readFileSync(PAGE, 'utf8') : '';

const run = (args) => execFileSync('node', [CLI, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });

const QUERIES = [
  'flood region:AU',
  'bushfire kind:feed',
  'target:geo access:free',
  'satellite imagery',
  '"reverse image"',
  'telegram -paid',
  'kind:dataset region:AU-NSW',
  'shodan',
  'region:AU has:description',
  'is:retired',
];

test('CLI and library return identical results for the same query', dataOpts, () => {
  for (const q of QUERIES) {
    const cli = JSON.parse(run(['search', ...q.split(' '), '--json', '--all']));
    const lib = search(ds.tools, q, { limit: Number.MAX_SAFE_INTEGER });
    assert.equal(cli.total, lib.total, `total mismatch for "${q}"`);
    assert.deepEqual(
      cli.results.map((t) => t.id),
      lib.results.map((t) => t.id),
      `result order mismatch for "${q}"`,
    );
  }
});

test('the page embeds the engine verbatim, modulo export keywords', pageOpts, () => {
  const moduleSource = readFileSync(join(ROOT, 'src/search.mjs'), 'utf8');
  const expected = inlineEngine(moduleSource);
  assert.ok(page.includes(expected), 'dist/osint-explorer.html does not contain the current src/search.mjs — rebuild');
  assert.ok(!/^export\s/m.test(expected), 'inlined engine still declares exports');
});

test('the page embeds every live tool and no stale count', pageOpts, () => {
  const m = page.match(/const DATA = JSON\.parse\("(.*?)"\);\n/s);
  assert.ok(m, 'embedded payload not found');
  const payload = JSON.parse(JSON.parse(`"${m[1]}"`));
  assert.equal(payload.tools.length, ds.tools.length, 'page payload is out of date with the dataset');
  assert.equal(payload.stats.live, ds.stats.live);
});

test('the embedded payload rehydrates into the shape the engine expects', pageOpts, () => {
  const m = page.match(/const DATA = JSON\.parse\("(.*?)"\);\n/s);
  const payload = JSON.parse(JSON.parse(`"${m[1]}"`));
  const rehydrated = payload.tools.map((t) => ({
    id: t.i, name: t.n, url: t.u, category: t.c, subcategory: t.s, subSubcategory: t.ss,
    description: t.d, targets: t.g, access: t.a, kind: t.k, regions: t.r, tags: t.t,
    health: { status: t.h }, retired: !!t.x, notes: t.o,
  }));
  for (const q of QUERIES) {
    const fromPage = search(rehydrated, q, { limit: Number.MAX_SAFE_INTEGER });
    const fromLib = search(ds.tools, q, { limit: Number.MAX_SAFE_INTEGER });
    assert.equal(fromPage.total, fromLib.total, `page/library total mismatch for "${q}"`);
  }
});

test('the page is self-contained: no external scripts or stylesheets beyond fonts', pageOpts, () => {
  const scripts = [...page.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(scripts, [], `page loads external scripts: ${scripts.join(', ')}`);
  const links = [...page.matchAll(/<link[^>]*href=["']([^"']+)["']/g)].map((m) => m[1]);
  const nonFont = links.filter((h) => !/fonts\.(googleapis|gstatic)\.com/.test(h));
  assert.deepEqual(nonFont, [], `page loads external stylesheets: ${nonFont.join(', ')}`);
  assert.ok(page.includes('rel="noopener noreferrer"') || page.includes("rel = 'noopener noreferrer'") || page.includes("rel = \"noopener noreferrer\"") || page.includes(".rel = 'noopener noreferrer'"),
    'outbound links must be rel="noopener noreferrer"');
});

test('the page ships a mobile layout and does not hide functionality behind width', pageOpts, () => {
  assert.match(page, /<meta name="viewport"[^>]*width=device-width/);
  assert.match(page, /@media \(max-width: 860px\)/);
  assert.ok(page.includes('filtersbtn'), 'no mobile filter affordance');
  assert.ok(!/display:\s*none[^}]*}\s*@media[^{]*\(min-width/.test(page), 'no desktop-only content gate');
});

test('CLI exit codes: 0 for hits, 1 for no hits, 2 for usage errors', dataOpts, () => {
  run(['search', 'flood']); // throws on non-zero
  assert.throws(() => run(['search', 'zzzzzznotathing']), (e) => e.status === 1, 'no-results should exit 1');
  assert.throws(() => run(['frobnicate']), (e) => e.status === 2, 'unknown command should exit 2');
  assert.throws(() => run(['search', 'flood', '--limit', 'abc']), (e) => e.status === 2, 'bad --limit should exit 2');
});

test('CLI reporters emit parseable json and csv', dataOpts, () => {
  const json = JSON.parse(run(['search', 'region:AU', '--json', '--limit', '5']));
  assert.equal(json.results.length, 5);
  const csv = run(['search', 'region:AU', '--csv', '--limit', '5']).trim().split('\n');
  assert.equal(csv.length, 6, 'csv should be a header plus five rows');
  assert.match(csv[0], /^id,name,url,category/);
  const ids = run(['search', 'region:AU', '--ids', '--limit', '3']).trim().split('\n');
  assert.equal(ids.length, 3);
});

test('CLI validate agrees with the library validator', dataOpts, () => {
  const out = run(['validate']);
  assert.match(out, /^ok /);
});
