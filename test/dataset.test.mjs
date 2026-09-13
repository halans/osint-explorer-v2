import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateDataset, SCHEMA_VERSION, TARGETS, ACCESS, KINDS, HEALTH_STATES } from '../src/schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = join(ROOT, 'data/tools.enriched.json');
const hasDataset = existsSync(DATASET);
const ds = hasDataset ? JSON.parse(readFileSync(DATASET, 'utf8')) : null;
const opts = { skip: hasDataset ? false : 'data/tools.enriched.json not built — run npm run data' };

test('the built dataset passes schema validation', opts, () => {
  const errors = validateDataset(ds);
  assert.deepEqual(errors, [], `validator reported:\n${errors.slice(0, 10).join('\n')}`);
});

test('dataset carries the expected shape and stats', opts, () => {
  assert.equal(ds.schemaVersion, SCHEMA_VERSION);
  assert.ok(ds.tools.length > 500, `expected a substantial corpus, got ${ds.tools.length}`);
  assert.equal(ds.stats.tools, ds.tools.length);
  assert.equal(ds.stats.live + ds.stats.retired, ds.tools.length);
  assert.ok(ds.sources.length >= 1);
});

test('ids and URLs are unique', opts, () => {
  const ids = new Set(), urls = new Set();
  for (const t of ds.tools) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`);
    ids.add(t.id);
    const key = t.url.replace(/\/+$/, '').toLowerCase();
    assert.ok(!urls.has(key), `duplicate url ${t.url}`);
    urls.add(key);
  }
});

test('every enum value is in range', opts, () => {
  for (const t of ds.tools) {
    assert.ok(ACCESS.includes(t.access), `${t.id}: access ${t.access}`);
    assert.ok(KINDS.includes(t.kind), `${t.id}: kind ${t.kind}`);
    assert.ok(HEALTH_STATES.includes(t.health.status), `${t.id}: health ${t.health.status}`);
    for (const g of t.targets) assert.ok(TARGETS.includes(g), `${t.id}: target ${g}`);
  }
});

test('every tool references a declared category', opts, () => {
  const names = new Set(ds.categories.map((c) => c.name));
  for (const t of ds.tools) assert.ok(names.has(t.category), `${t.id}: unknown category ${t.category}`);
});

test('category counts match the tools that claim them', opts, () => {
  for (const c of ds.categories) {
    const actual = ds.tools.filter((t) => t.category === c.name && !t.retired).length;
    assert.equal(c.count, actual, `category ${c.name}`);
  }
});

test('descriptions are single-sentence-scale and free of marketing filler', opts, () => {
  const banned = /\b(powerful|comprehensive|seamless|cutting[- ]edge|robust|one[- ]stop|game[- ]changing|revolutionary|ultimate|go[- ]to solution)\b/i;
  const filler = /^(a tool that|this (website|tool|site) (allows|lets)|an online platform)/i;
  const offenders = [];
  for (const t of ds.tools) {
    if (!t.description) continue;
    assert.ok(t.description.length <= 240, `${t.id}: description too long (${t.description.length})`);
    if (banned.test(t.description) || filler.test(t.description)) offenders.push(`${t.id}: ${t.description}`);
  }
  assert.deepEqual(offenders, [], `marketing language found:\n${offenders.slice(0, 8).join('\n')}`);
});

test('coverage floor: most of the corpus is described and link-checked', opts, () => {
  const described = ds.tools.filter((t) => t.description).length;
  const checked = ds.tools.filter((t) => t.health.status !== 'unchecked').length;
  assert.ok(described / ds.tools.length > 0.9, `only ${described}/${ds.tools.length} described`);
  assert.ok(checked / ds.tools.length > 0.9, `only ${checked}/${ds.tools.length} link-checked`);
});

test('entries flagged dead by the link check are retired', opts, () => {
  for (const t of ds.tools) {
    if (t.health.status === 'dead') assert.equal(t.retired, true, `${t.id} is dead but still listed`);
  }
});

test('research-sourced entries record their provenance and evidence', opts, () => {
  const fromResearch = ds.tools.filter((t) => t.provenance.startsWith('research:'));
  assert.ok(fromResearch.length > 50, `expected a real research pass, got ${fromResearch.length}`);
  for (const t of fromResearch) assert.ok(t.description, `${t.id}: research entry without a description`);
});

test('country-specific entries carry a region code', opts, () => {
  const missing = ds.tools.filter((t) => t.category === 'Country Specific' && !t.retired && !(t.regions || []).length);
  assert.ok(missing.length / ds.tools.filter((t) => t.category === 'Country Specific').length < 0.15,
    `${missing.length} country-specific entries have no region: ${missing.slice(0, 5).map((t) => t.id).join(', ')}`);
});

test('Australian hazard feeds requested by the brief are present', opts, () => {
  const au = ds.tools.filter((t) => (t.regions || []).some((r) => r.startsWith('AU')));
  assert.ok(au.length > 40, `expected a substantial Australian set, got ${au.length}`);
  const hay = (t) => `${t.name} ${t.description || ''} ${t.tags.join(' ')}`.toLowerCase();
  assert.ok(au.some((t) => /bushfire|fire/.test(hay(t))), 'no Australian bushfire source');
  assert.ok(au.some((t) => /flood/.test(hay(t))), 'no Australian flood source');
  assert.ok(au.some((t) => t.kind === 'feed'), 'no Australian live feed');
  assert.ok(au.some((t) => t.kind === 'dataset'), 'no Australian bulk dataset');
});

test("God's Eye View — the staleness the refresh was asked to fix — is listed", opts, () => {
  const gev = ds.tools.find((t) => /god'?s eye view/i.test(t.name) || t.url.includes('gods-eye-view'));
  assert.ok(gev, 'God\'s Eye View missing from the dataset');
  assert.ok(gev.description, 'God\'s Eye View has no description');
  assert.ok(gev.provenance.startsWith('research:'), 'expected it to come from the research pass');
});
