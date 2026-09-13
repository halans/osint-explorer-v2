#!/usr/bin/env node
// osint — command line surface for the OSINT Explorer dataset.
//
// Usage
//   osint search <query...> [--limit N] [--offset N] [--json|--csv|--ids] [--all]
//   osint show <id|url>                       full record for one entry
//   osint stats                               corpus summary
//   osint categories                          category tree with counts
//   osint facets [query...]                   facet counts for a query's result set
//   osint changes                             landscape changes recorded by the research pass
//   osint validate                            schema-validate the dataset
//
// Query syntax is identical to the web page — both run src/search.mjs:
//   osint search flood target:geo region:AU access:free
//   osint search "reverse image" -paid
//   osint search kind:feed region:AU-NSW
//
// Exit codes
//   0  success (matches found, or a clean validate)
//   1  no results / validation failed
//   2  usage error

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { search, facetCounts, parseQuery } from '../src/search.mjs';
import { validateDataset } from '../src/schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_CANDIDATES = ['data/tools.enriched.json', 'dist/tools.min.json', 'data/tools.v2.json'];

function loadDataset() {
  const override = process.env.OSINT_DATASET;
  const paths = override ? [override] : DATA_CANDIDATES.map((p) => join(ROOT, p));
  for (const p of paths) if (existsSync(p)) return { ds: JSON.parse(readFileSync(p, 'utf8')), path: p };
  fail(`no dataset found (looked for ${DATA_CANDIDATES.join(', ')}) — run: npm run data`);
}

function fail(msg, code = 2) {
  process.stderr.write(`osint: ${msg}\n`);
  process.exit(code);
}

// Piping into `head` closes stdout early; that is normal shell usage, not an error.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
  process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 26).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
  process.exit(argv.length ? 0 : 2);
}

const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`--${name} needs a value`);
  return v;
};
const positional = () => {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { if (['limit', 'offset'].includes(argv[i].slice(2))) i++; continue; }
    out.push(argv[i]);
  }
  return out;
};

const cmd = argv[0];
const { ds, path } = loadDataset();
const tools = ds.tools;

// ------------------------------------------------------------- reporters ----
const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m` }
  : { dim: (s) => s, b: (s) => s, cyan: (s) => s, green: (s) => s, yellow: (s) => s, red: (s) => s };

const accessColour = (a) => (a === 'free' ? C.green(a) : a === 'paid' ? C.yellow(a) : C.dim(a));
const healthColour = (h) => (h === 'alive' ? C.green(h) : ['dead', 'unreachable'].includes(h) ? C.red(h) : C.yellow(h));

function pretty(list) {
  const lines = [];
  for (const t of list) {
    const badges = [t.kind, t.access, ...(t.regions || [])].filter((x) => x && x !== 'unknown').join(' · ');
    lines.push(`${C.b(t.name)}${t.retired ? C.red(' [retired]') : ''}  ${C.dim(badges)}`);
    if (t.description) lines.push(`  ${t.description}`);
    lines.push(`  ${C.cyan(t.url)}`);
    const facets = [
      t.targets?.length ? `target:${t.targets.join(',')}` : null,
      `health:${healthColour(t.health?.status || 'unchecked')}`,
      t.category,
    ].filter(Boolean);
    lines.push(`  ${C.dim(facets.join('  '))}`);
    if (t.notes) lines.push(`  ${C.dim('note: ' + t.notes)}`);
    lines.push('');
  }
  return lines.join('\n');
}

function csv(list) {
  const cell = (v) => {
    const s = Array.isArray(v) ? v.join(';') : v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cols = ['id', 'name', 'url', 'category', 'subcategory', 'description', 'targets', 'access', 'kind', 'regions', 'tags', 'health', 'retired'];
  return [cols.join(','), ...list.map((t) => [t.id, t.name, t.url, t.category, t.subcategory, t.description, t.targets, t.access, t.kind, t.regions, t.tags, t.health?.status, t.retired].map(cell).join(','))].join('\n');
}

function emit(list, total) {
  if (flag('json')) { process.stdout.write(JSON.stringify({ total, count: list.length, results: list }, null, 2) + '\n'); return; }
  if (flag('csv')) { process.stdout.write(csv(list) + '\n'); return; }
  if (flag('ids')) { process.stdout.write(list.map((t) => t.id).join('\n') + '\n'); return; }
  process.stdout.write(pretty(list));
  process.stdout.write(`${C.dim(`${list.length} shown of ${total} matches · ${tools.length} in corpus`)}\n`);
}

// -------------------------------------------------------------- commands ----
switch (cmd) {
  case 'search': {
    const q = positional().join(' ');
    if (!q) fail('search needs a query — try: osint search target:geo region:AU');
    const limit = flag('all') ? Number.MAX_SAFE_INTEGER : Number(opt('limit', '20'));
    const offset = Number(opt('offset', '0'));
    if (!Number.isFinite(limit) || limit < 1) fail('--limit must be a positive number');
    if (!Number.isFinite(offset) || offset < 0) fail('--offset must be zero or more');
    const r = search(tools, q, { limit, offset });
    emit(r.results, r.total);
    // Set exitCode rather than calling process.exit(): an explicit exit truncates
    // buffered stdout when the output is a pipe, which silently corrupts large --json runs.
    process.exitCode = r.total ? 0 : 1;
    break;
  }
  case 'show': {
    const key = positional()[0];
    if (!key) fail('show needs an id or url');
    const t = tools.find((x) => x.id === key || x.url === key || x.url.replace(/\/+$/, '') === key.replace(/\/+$/, ''));
    if (!t) { process.stderr.write(`osint: no entry matching "${key}"\n`); process.exitCode = 1; break; }
    process.stdout.write(JSON.stringify(t, null, 2) + '\n');
    break;
  }
  case 'stats': {
    const byAccess = {}, byKind = {}, byHealth = {};
    for (const t of tools) {
      byAccess[t.access] = (byAccess[t.access] || 0) + 1;
      byKind[t.kind] = (byKind[t.kind] || 0) + 1;
      byHealth[t.health?.status || 'unchecked'] = (byHealth[t.health?.status || 'unchecked'] || 0) + 1;
    }
    const out = { dataset: path, generatedAt: ds.generatedAt, ...ds.stats, byAccess, byKind, byHealth };
    if (flag('json')) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    else {
      process.stdout.write(`${C.b('OSINT Explorer')}  ${C.dim(path)}\n`);
      process.stdout.write(`built ${ds.generatedAt}\n\n`);
      for (const [k, v] of Object.entries(ds.stats || {})) process.stdout.write(`  ${k.padEnd(14)} ${v}\n`);
      const table = (title, obj) => {
        process.stdout.write(`\n  ${C.b(title)}\n`);
        for (const [k, v] of Object.entries(obj).sort((a, b) => b[1] - a[1])) process.stdout.write(`    ${String(k).padEnd(18)} ${v}\n`);
      };
      table('access', byAccess); table('kind', byKind); table('link health', byHealth);
    }
    break;
  }
  case 'categories': {
    if (flag('json')) { process.stdout.write(JSON.stringify(ds.categories, null, 2) + '\n'); break; }
    for (const c of [...ds.categories].sort((a, b) => (b.count || 0) - (a.count || 0))) {
      process.stdout.write(`${String(c.count ?? '').padStart(4)}  ${C.b(c.name)}\n`);
      if (c.subcategories?.length) process.stdout.write(`      ${C.dim(c.subcategories.join(' · '))}\n`);
    }
    break;
  }
  case 'facets': {
    const q = positional().join(' ');
    const list = q ? search(tools, q, { limit: Number.MAX_SAFE_INTEGER }).results : tools.filter((t) => !t.retired);
    const counts = facetCounts(list);
    if (flag('json')) { process.stdout.write(JSON.stringify({ query: q || null, matches: list.length, facets: counts }, null, 2) + '\n'); break; }
    process.stdout.write(`${list.length} matches${q ? ` for ${C.cyan(q)}` : ''}\n`);
    for (const [group, obj] of Object.entries(counts)) {
      const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
      if (!entries.length) continue;
      process.stdout.write(`\n  ${C.b(group)}\n`);
      for (const [k, v] of entries.slice(0, 12)) process.stdout.write(`    ${String(k).padEnd(34)} ${v}\n`);
    }
    break;
  }
  case 'changes': {
    const inCorpus = tools.flatMap((t) => (t.changeLog || []).map((c) => ({ ...c, name: t.name, url: t.url })));
    const external = ds.landscapeChanges || [];
    if (flag('json')) { process.stdout.write(JSON.stringify({ inCorpus, external }, null, 2) + '\n'); break; }
    const show = (title, list) => {
      process.stdout.write(`\n${C.b(title)} (${list.length})\n`);
      for (const c of list) process.stdout.write(`  ${C.yellow(c.change.padEnd(11))} ${C.b(c.name)} — ${c.detail}\n`);
    };
    show('Changes to listed tools', inCorpus);
    show('Landscape changes (tool not listed)', external);
    break;
  }
  case 'validate': {
    const errors = validateDataset(ds);
    if (!errors.length) { process.stdout.write(`${C.green('ok')} ${tools.length} entries, schema v${ds.schemaVersion}\n`); break; }
    process.stderr.write(`${C.red(`${errors.length} problems`)}\n`);
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exitCode = 1;
    break;
  }
  case 'parse': { // debugging aid: show how a query was understood
    const q = parseQuery(positional().join(' '));
    process.stdout.write(JSON.stringify({ ...q, flags: [...q.flags] }, null, 2) + '\n');
    break;
  }
  default:
    fail(`unknown command "${cmd}" — try: search, show, stats, categories, facets, changes, validate`);
}
