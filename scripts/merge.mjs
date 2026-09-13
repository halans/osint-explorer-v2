#!/usr/bin/env node
// Merge every enrichment layer into the final dataset.
//
//   node scripts/merge.mjs [--strict]
//
// Inputs
//   data/tools.v2.json            normalised seed corpus
//   data/health.json              link-health report (scripts/check-links.mjs)
//   data/research/desc/*.json     description + facet layer (enrichment pass)
//   data/research/*.json          new-tool research streams (additions + changes)
//   data/overrides.json           optional hand corrections, applied last and always win
//
// Output
//   data/tools.enriched.json      the dataset every surface is built from
//   data/merge-report.json        what happened, so the pass is auditable
//
// Exit codes: 0 ok, 1 validation failed (with --strict), 2 usage error.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateDataset, slugify, TARGETS, ACCESS, KINDS } from '../src/schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const ds = read('data/tools.v2.json');
const byId = new Map(ds.tools.map((t) => [t.id, t]));
const byUrl = new Map(ds.tools.map((t) => [normUrl(t.url), t]));
const landscape = [];
const report = { mergedAt: new Date().toISOString(), health: {}, descriptions: {}, research: {}, overrides: {}, warnings: [] };
const warn = (m) => report.warnings.push(m);

function normUrl(u) {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch { return String(u).toLowerCase(); }
}

// ---------------------------------------------------- descriptions/facets ----
const descDir = join(ROOT, 'data/research/desc');
let descApplied = 0, descUnverified = 0, renamed = 0;
const descFiles = existsSync(descDir) ? readdirSync(descDir).filter((f) => f.endsWith('.json')).sort() : [];
for (const f of descFiles) {
  const doc = read(`data/research/desc/${f}`);
  for (const e of doc.entries || []) {
    const t = byId.get(e.id);
    if (!t) { warn(`desc ${f}: unknown id ${e.id}`); continue; }
    if (e.description) { t.description = clampDesc(e.description); descApplied++; }
    else descUnverified++;
    if (Array.isArray(e.targets) && e.targets.length) t.targets = e.targets.filter((x) => ok(TARGETS, x, `${f}:${e.id} target`));
    if (e.access && ok(ACCESS, e.access, `${f}:${e.id} access`)) t.access = e.access;
    if (e.kind && ok(KINDS, e.kind, `${f}:${e.id} kind`)) t.kind = e.kind;
    if (Array.isArray(e.regions)) t.regions = e.regions.map((r) => r.toUpperCase());
    if (Array.isArray(e.tags) && e.tags.length) t.tags = [...new Set([...e.tags.map((s) => s.toLowerCase()), ...t.tags])].slice(0, 12);
    if (e.notes) t.notes = e.notes;
    if (e.confidence) t.confidence = e.confidence;
    if (e.nameSuggestion && e.nameSuggestion !== t.name) { t.originalName = t.name; t.name = e.nameSuggestion; renamed++; }
    t.provenance = `${t.provenance}+enriched`;
  }
}
report.descriptions = { files: descFiles.length, applied: descApplied, unverified: descUnverified, renamed };

function ok(list, v, where) {
  if (list.includes(v)) return true;
  warn(`${where}: invalid value "${v}"`);
  return false;
}
function clampDesc(s) {
  let d = String(s).replace(/\s+/g, ' ').trim();
  if (d.length > 240) d = d.slice(0, 237).replace(/\s+\S*$/, '') + '…';
  return d;
}

// -------------------------------------------------------------- research ----
const researchDir = join(ROOT, 'data/research');
const streamFiles = existsSync(researchDir)
  ? readdirSync(researchDir).filter((f) => f.endsWith('.json')).sort()
  : [];
const ids = new Set(ds.tools.map((t) => t.id));
const uniqueId = (base) => { let id = base || 'tool'; let n = 2; while (ids.has(id)) id = `${base}-${n++}`; ids.add(id); return id; };
const categoryNames = new Set(ds.categories.map((c) => c.name));

let added = 0, skippedDuplicate = 0, changesApplied = 0;
const streams = {};
for (const f of streamFiles) {
  const doc = read(`data/research/${f}`);
  if (!Array.isArray(doc.additions) && !Array.isArray(doc.changes)) continue;
  let a = 0, dup = 0, ch = 0;

  for (const e of doc.additions || []) {
    if (!e?.url || !e?.name) { warn(`${f}: addition missing name/url`); continue; }
    const key = normUrl(e.url);
    if (byUrl.has(key)) {
      // Already listed: use the research entry to fill gaps rather than duplicating.
      const t = byUrl.get(key);
      if (!t.description && e.description) t.description = clampDesc(e.description);
      if (e.notes && !t.notes) t.notes = e.notes;
      dup++; skippedDuplicate++;
      continue;
    }
    const category = categoryNames.has(e.category) ? e.category : ensureCategory(e.category || 'OSINT Tools, Resources & Blogs');
    const id = uniqueId(slugify(category, e.name));
    const tool = {
      id,
      name: String(e.name).trim(),
      url: e.url,
      category,
      subcategory: e.subcategory || null,
      subSubcategory: null,
      path: [category, e.subcategory].filter(Boolean).join(' › '),
      alsoIn: [],
      tags: [...new Set((e.tags || []).map((s) => String(s).toLowerCase()))],
      description: e.description ? clampDesc(e.description) : null,
      targets: (e.targets || []).filter((x) => ok(TARGETS, x, `${f}:${e.name} target`)),
      access: ok(ACCESS, e.access, `${f}:${e.name} access`) ? e.access : 'unknown',
      kind: ok(KINDS, e.kind, `${f}:${e.name} kind`) ? e.kind : 'web-tool',
      regions: (e.regions || []).map((r) => String(r).toUpperCase()),
      health: { status: 'unchecked', httpStatus: null, finalUrl: null, checkedAt: null },
      retired: false,
      notes: e.notes || null,
      provenance: `research:${doc.stream || f}@${(doc.researchedAt || '').slice(0, 10)}`,
      confidence: 'verified',
      hasIcon: false,
    };
    if (e.licence) tool.licence = e.licence;
    if (e.format) tool.format = e.format;
    if (e.evidenceUrl) tool.evidenceUrl = e.evidenceUrl;
    ds.tools.push(tool);
    byId.set(id, tool);
    byUrl.set(key, tool);
    a++; added++;
  }

  for (const c of doc.changes || []) {
    const t = matchChange(c);
    if (!t) {
      // The change is real intelligence even when the tool was never in the corpus —
      // keep it in the landscape log rather than discarding it.
      landscape.push({ ...c, stream: doc.stream || f });
      continue;
    }
    t.changeLog = [...(t.changeLog || []), { change: c.change, detail: c.detail, evidenceUrl: c.evidenceUrl || null, source: doc.stream || f }];
    if (c.change === 'shutdown') { t.retired = true; t.retiredReason = c.detail || 'shut down'; }
    if (c.newUrl && c.newUrl !== t.url) {
      const successor = byUrl.get(normUrl(c.newUrl));
      if (successor && successor !== t) {
        // The successor is already listed in its own right (e.g. CrowdTangle -> Meta
        // Content Library). Retire the old entry and point at it, rather than rewriting
        // the URL and creating two entries with the same address.
        t.retired = true;
        t.retiredReason = c.detail || `superseded by ${successor.name}`;
        t.supersededBy = successor.id;
      } else {
        byUrl.delete(normUrl(t.url));
        t.supersededUrl = t.url;
        t.url = c.newUrl;
        byUrl.set(normUrl(t.url), t);
      }
    }
    if (c.change === 'paywalled' && t.access !== 'paid') t.access = 'paid';
    if (c.detail) t.notes = t.notes ? `${t.notes} ${c.detail}` : c.detail;
    ch++; changesApplied++;
  }
  streams[doc.stream || f] = { additions: a, duplicates: dup, changes: ch };
}
report.research = { files: streamFiles.length, added, skippedDuplicate, changesApplied, streams, unmatchedChanges: landscape.length };
ds.landscapeChanges = landscape;


// A change record may name a tool by a different URL than the one we hold (a docs page vs
// the app, http vs https, a renamed product). Match on exact URL, then hostname, then name.
function matchChange(c) {
  const url = c.url || '';
  const exact = byUrl.get(normUrl(url));
  if (exact) return exact;
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
  const h = hostOf(url);
  if (h) {
    const sameHost = ds.tools.filter((t) => hostOf(t.url) === h);
    if (sameHost.length === 1) return sameHost[0];
    if (sameHost.length > 1) {
      // Several entries share the host (e.g. a dozen nitter.net permalinks). Only accept
      // a match whose NAME also agrees — guessing sameHost[0] once retired an unrelated
      // tool because a Nitter notice matched a bookmark that merely lived on nitter.net.
      const named = sameHost.find((t) => t.name.toLowerCase().includes(String(c.name || '').toLowerCase()));
      if (named) return named;
      // otherwise fall through to name matching below rather than guessing a host sibling

    }
  }
  const name = String(c.name || '').toLowerCase().trim();
  if (!name) return null;
  return ds.tools.find((t) => t.name.toLowerCase() === name)
      || ds.tools.find((t) => t.name.toLowerCase().startsWith(name))
      || null;
}

function ensureCategory(name) {
  if (!categoryNames.has(name)) {
    ds.categories.push({ name, subcategories: [], seedCount: 0, treeCount: null });
    categoryNames.add(name);
  }
  return name;
}

// ------------------------------------------------------------- overrides ----
if (existsSync(join(ROOT, 'data/overrides.json'))) {
  const ov = read('data/overrides.json');
  let n = 0;
  for (const [id, patch] of Object.entries(ov.tools || {})) {
    const t = byId.get(id);
    if (!t) { warn(`overrides: unknown id ${id}`); continue; }
    const urlChanged = patch.url && patch.url !== t.url;
    Object.assign(t, patch, { provenance: `${t.provenance}+override` });
    if (urlChanged) {
      // A corrected URL invalidates the old verdict: a 404 recorded against the broken
      // address must not keep the fixed entry retired. Re-check with:
      //   node scripts/check-links.mjs --in data/tools.enriched.json --unchecked --out data/health-repaired.json
      t.health = { status: 'unchecked', httpStatus: null, finalUrl: null, checkedAt: null };
      if (!('retired' in patch)) { t.retired = false; delete t.retiredReason; }
    }
    n++;
  }
  report.overrides = { applied: n };
}

// ---------------------------------------------------------------- health ----
// Every data/health*.json report is applied, oldest run first, so a follow-up check
// (new entries, repaired URLs) layers over the original full-corpus sweep.
//
// A result is SKIPPED when the URL it was recorded against is no longer the entry's URL:
// a 404 measured on a broken address must not keep a corrected entry retired.
{
  const healthFiles = readdirSync(join(ROOT, 'data'))
    .filter((f) => /^health.*\.json$/.test(f))
    .map((f) => ({ f, doc: read(`data/${f}`) }))
    .sort((a, b) => String(a.doc.checkedAt).localeCompare(String(b.doc.checkedAt)));
  if (!healthFiles.length) warn('health: no data/health*.json — run scripts/check-links.mjs');

  let applied = 0, stale = 0;
  const counts = {};
  for (const { f, doc } of healthFiles) {
    for (const r of doc.results || []) {
      const t = byId.get(r.id) || byUrl.get(normUrl(r.url || ''));
      if (!t) { warn(`health ${f}: unknown entry ${r.id}`); continue; }
      if (r.url && normUrl(r.url) !== normUrl(t.url)) { stale++; continue; }
      t.health = { status: r.status, httpStatus: r.httpStatus, finalUrl: r.finalUrl, checkedAt: doc.checkedAt, error: r.error || null };
      // A 404/410 or parked page retires the entry; everything else stays listed.
      if (r.status === 'dead') { t.retired = true; t.retiredReason = `link check: HTTP ${r.httpStatus}`; }
      else if (t.retiredReason?.startsWith('link check:')) { t.retired = false; delete t.retiredReason; }
      applied++;
    }
    for (const [k, v] of Object.entries(doc.counts || {})) counts[k] = (counts[k] || 0) + v;
  }
  report.health = { files: healthFiles.map((h) => h.f), applied, staleSkipped: stale, counts };
}

// ---------------------------------------------------------------- dedupe ----
// Two entries must never share an address. Keep whichever is richer (live, described,
// more facets) and record the loser as an alias so the pairing stays visible.
{
  const groups = new Map();
  for (const t of ds.tools) {
    const k = normUrl(t.url);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const drop = new Set();
  let folded = 0, collisions = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    collisions++;
    const rank = (t) => (t.retired ? 0 : 8) + (t.description ? 4 : 0) + ((t.targets || []).length ? 2 : 0) + (t.provenance.includes('research') ? 1 : 0);
    const sorted = [...group].sort((a, b) => rank(b) - rank(a));
    const keep = sorted[0];
    for (const loser of sorted.slice(1)) {
      keep.aliasOf = [...(keep.aliasOf || []), { id: loser.id, name: loser.name, path: loser.path }];
      if (!keep.description && loser.description) keep.description = loser.description;
      if (!keep.notes && loser.notes) keep.notes = loser.notes;
      if (loser.path && !keep.alsoIn.includes(loser.path)) keep.alsoIn.push(loser.path);
      drop.add(loser.id);
      folded++;
    }
  }
  if (drop.size) ds.tools = ds.tools.filter((t) => !drop.has(t.id));
  report.dedupe = { collisions, folded };
}

// ------------------------------------------------------- derived + write ----
for (const c of ds.categories) {
  c.count = ds.tools.filter((t) => t.category === c.name && !t.retired).length;
  const subs = new Set(ds.tools.filter((t) => t.category === c.name && t.subcategory).map((t) => t.subcategory));
  c.subcategories = [...new Set([...(c.subcategories || []), ...subs])];
}
ds.tools.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
ds.generatedAt = new Date().toISOString();
ds.stats = {
  tools: ds.tools.length,
  live: ds.tools.filter((t) => !t.retired).length,
  retired: ds.tools.filter((t) => t.retired).length,
  described: ds.tools.filter((t) => t.description).length,
  categories: ds.categories.length,
  fromResearch: ds.tools.filter((t) => t.provenance.startsWith('research:')).length,
};

const errors = validateDataset(ds);
report.validation = { errors: errors.length, sample: errors.slice(0, 20) };

writeFileSync(join(ROOT, 'data/tools.enriched.json'), JSON.stringify(ds, null, 2) + '\n');
writeFileSync(join(ROOT, 'data/merge-report.json'), JSON.stringify(report, null, 2) + '\n');

console.log(JSON.stringify({ stats: ds.stats, ...report, warnings: report.warnings.length }, null, 2));
if (report.warnings.length) console.log(`\n${report.warnings.length} warnings — see data/merge-report.json`);
if (errors.length) {
  console.error(`\nVALIDATION: ${errors.length} problems`);
  for (const e of errors.slice(0, 20)) console.error(`  - ${e}`);
  if (strict) process.exit(1);
}
