import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, search, facetCounts } from '../src/search.mjs';

// A small fixture corpus. Deliberately includes a retired entry, a missing description,
// and overlapping facets so filter interactions are actually exercised.
const TOOLS = [
  {
    id: 'nsw-rfs', name: 'NSW RFS Major Incidents', url: 'https://www.rfs.nsw.gov.au/feeds/majorIncidents.json',
    category: 'Country Specific', subcategory: 'Australia', description: 'Current bushfire incidents in New South Wales as GeoJSON',
    targets: ['geo', 'dataset'], access: 'free', kind: 'feed', regions: ['AU', 'AU-NSW'], tags: ['bushfire', 'incidents'],
    health: { status: 'alive' }, retired: false, notes: null,
  },
  {
    id: 'bom-flood', name: 'BoM Flood Warnings', url: 'https://www.bom.gov.au/australia/warnings/',
    category: 'Country Specific', subcategory: 'Australia', description: 'Flood and severe weather warnings issued for Australian regions',
    targets: ['geo'], access: 'free', kind: 'feed', regions: ['AU'], tags: ['flood', 'warnings', 'weather'],
    health: { status: 'bot-walled' }, retired: false, notes: 'Cloudflare-fronted',
  },
  {
    id: 'shodan', name: 'Shodan', url: 'https://www.shodan.io/',
    category: 'Corporate Profiling & Website OSINT', subcategory: 'Technical Artefacts',
    description: 'Searches internet-wide scan results for hosts, banners and exposed services',
    targets: ['ip', 'domain'], access: 'freemium', kind: 'search', regions: [], tags: ['scanning', 'ports'],
    health: { status: 'alive' }, retired: false, notes: null,
  },
  {
    id: 'crowdtangle', name: 'CrowdTangle', url: 'https://www.crowdtangle.com/',
    category: 'Social Media & Forums', subcategory: 'Social Media', description: null,
    targets: ['social'], access: 'unknown', kind: 'web-tool', regions: [], tags: ['meta'],
    health: { status: 'dead' }, retired: true, retiredReason: 'shut down by Meta in 2024', notes: null,
  },
  {
    id: 'gev', name: "God's Eye View", url: 'https://github.com/bilawalsidhu/gods-eye-view',
    category: 'Mapping', subcategory: 'Sat Imagery', description: 'Aggregates ADS-B, AIS, orbital and quake feeds onto a 3D globe',
    targets: ['geo', 'vehicle'], access: 'free', kind: 'map', regions: [], tags: ['satellite', 'cesium', 'adsb'],
    health: { status: 'alive' }, retired: false, notes: null,
  },
];

test('parseQuery splits terms, phrases, exclusions, facets and flags', () => {
  const q = parseQuery('flood "severe weather" -shodan target:geo region:AU-NSW is:any');
  assert.deepEqual(q.terms, ['flood']);
  assert.deepEqual(q.phrases, ['severe weather']);
  assert.deepEqual(q.exclude, ['shodan']);
  assert.deepEqual(q.facets.target, ['geo']);
  assert.deepEqual(q.facets.region, ['au-nsw']);
  assert.ok(q.flags.has('is:any'));
});

test('parseQuery treats an unknown prefix as a plain term, not a facet', () => {
  const q = parseQuery('vendor:acme');
  assert.deepEqual(q.facets, {});
  assert.deepEqual(q.terms, ['vendor:acme']);
});

test('free-text search matches name, description and tags', () => {
  assert.equal(search(TOOLS, 'bushfire').total, 1);
  assert.equal(search(TOOLS, 'flood').total, 1);
  assert.equal(search(TOOLS, 'adsb').total, 1);           // tag only
  assert.equal(search(TOOLS, 'banners').total, 1);        // description only
});

test('retired entries are hidden by default and reachable on request', () => {
  assert.equal(search(TOOLS, 'crowdtangle').total, 0);
  assert.equal(search(TOOLS, 'crowdtangle is:any').total, 1);
  assert.equal(search(TOOLS, 'is:retired').total, 1);
  assert.equal(search(TOOLS, 'is:retired').results[0].id, 'crowdtangle');
});

test('region facet matches a country and its subdivisions', () => {
  assert.equal(search(TOOLS, 'region:AU').total, 2, 'AU matches AU and AU-NSW entries');
  assert.equal(search(TOOLS, 'region:AU-NSW').total, 1);
  assert.equal(search(TOOLS, 'region:NZ').total, 0);
});

test('facets AND across groups, OR within a group', () => {
  assert.equal(search(TOOLS, 'kind:feed access:free').total, 2);
  assert.equal(search(TOOLS, 'kind:feed kind:map').total, 3, 'two feeds plus one map');
  assert.equal(search(TOOLS, 'kind:feed region:AU-NSW').total, 1);
  assert.equal(search(TOOLS, 'kind:map access:paid').total, 0);
});

test('exclusions and phrases filter the result set', () => {
  assert.equal(search(TOOLS, 'incidents -geojson').total, 0);
  assert.equal(search(TOOLS, '"3D globe"').total, 1);
  assert.equal(search(TOOLS, '"3d globe"').total, 1, 'phrase matching is case-insensitive');
});

test('has:description excludes undescribed entries', () => {
  assert.equal(search(TOOLS, 'is:any has:description').total, 4);
});

test('ranking puts a name hit above a description hit', () => {
  const r = search(TOOLS, 'shodan');
  assert.equal(r.results[0].id, 'shodan');
  const r2 = search(TOOLS, 'flood warnings');
  assert.equal(r2.results[0].id, 'bom-flood');
});

test('dead links are demoted in ranking', () => {
  const scoredTools = [...TOOLS, { ...TOOLS[3], id: 'ct2', name: 'CrowdTangle Mirror', retired: false, description: 'Meta social monitoring mirror' }];
  const r = search(scoredTools, 'meta');
  assert.ok(r.results.length >= 1);
  assert.equal(r.results[0].id, 'ct2');
});

test('limit and offset paginate without changing the total', () => {
  const all = search(TOOLS, 'is:any', { limit: 100 });
  const page = search(TOOLS, 'is:any', { limit: 2, offset: 2 });
  assert.equal(page.total, all.total);
  assert.equal(page.results.length, 2);
  assert.deepEqual(page.results.map((t) => t.id), all.results.slice(2, 4).map((t) => t.id));
});

test('an empty query returns every live entry', () => {
  assert.equal(search(TOOLS, '').total, 4);
});

test('facetCounts tallies every facet group', () => {
  const c = facetCounts(TOOLS);
  assert.equal(c.target.geo, 3);
  assert.equal(c.access.free, 3);
  assert.equal(c.kind.feed, 2);
  assert.equal(c.region.AU, 2);
  assert.equal(c.health.alive, 3);
  assert.equal(c.category.Mapping, 1);
});
