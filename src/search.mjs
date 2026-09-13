// Shared search engine for the OSINT Explorer.
//
// ONE source of truth: the CLI, the HTTP API and the single-file HTML page all run this
// exact module. The build step inlines this file verbatim into the HTML, and a test
// diffs CLI output against in-process output for the same query to prove equivalence.
//
// Query language:
//   plain terms          match name, description, tags, category path
//   "quoted phrase"      exact substring match
//   -term                exclude
//   target:geo           facet filters (repeatable, OR within a facet, AND across facets)
//   access:free          free | free-registration | freemium | paid | api-key | unknown
//   kind:map             web-tool | search | database | dataset | map | feed | directory |
//                        reading | software | api
//   region:AU            matches AU and any AU-* subdivision
//   category:mapping     substring match on category
//   health:alive         alive | redirected | bot-walled | dead | unreachable | ...
//   is:retired           only retired entries (default: retired entries are excluded)
//   is:any               include retired entries alongside live ones
//   has:description      entries with a written description

export const FACET_KEYS = ['target', 'access', 'kind', 'region', 'category', 'health', 'tag'];

const TOKEN_RE = /(-?)(?:([a-z]+):)?(?:"([^"]*)"|(\S+))/gi;

export function parseQuery(input) {
  const q = { terms: [], phrases: [], exclude: [], facets: {}, flags: new Set() };
  if (!input) return q;
  for (const m of String(input).matchAll(TOKEN_RE)) {
    const [, neg, rawKey, phrase, word] = m;
    const key = rawKey ? rawKey.toLowerCase() : null;
    const value = (phrase ?? word ?? '').trim();
    if (!value) continue;

    if (key === 'is' || key === 'has') {
      q.flags.add(`${key}:${value.toLowerCase()}`);
      continue;
    }
    if (key && FACET_KEYS.includes(key)) {
      (q.facets[key] ||= []).push(value.toLowerCase());
      continue;
    }
    // An unrecognised prefix is not a facet — keep it as literal text so a query like
    // "vendor:acme" or a pasted URL still matches rather than silently losing a word.
    const literal = (key ? `${key}:${value}` : value).toLowerCase();
    if (neg) q.exclude.push(literal);
    else if (phrase !== undefined) q.phrases.push(literal);
    else q.terms.push(literal);
  }
  return q;
}

function haystack(t) {
  return (
    t._hay ||
    (t._hay = [
      t.name,
      t.description || '',
      t.category,
      t.subcategory || '',
      t.subSubcategory || '',
      (t.tags || []).join(' '),
      (t.regions || []).join(' '),
      t.url,
      t.notes || '',
    ]
      .join('  ')
      .toLowerCase())
  );
}

function matchesFacet(t, key, values) {
  switch (key) {
    case 'target': return values.some((v) => (t.targets || []).includes(v));
    case 'access': return values.includes(String(t.access).toLowerCase());
    case 'kind': return values.includes(String(t.kind).toLowerCase());
    case 'health': return values.includes(String(t.health?.status).toLowerCase());
    case 'tag': return values.some((v) => (t.tags || []).some((tag) => tag.toLowerCase() === v));
    case 'region':
      return values.some((v) =>
        (t.regions || []).some((r) => {
          const rr = r.toLowerCase();
          return rr === v || rr.startsWith(`${v}-`);
        }),
      );
    case 'category':
      return values.some((v) => `${t.category} ${t.subcategory || ''} ${t.subSubcategory || ''}`.toLowerCase().includes(v));
    default: return true;
  }
}

/** Relevance score. Name hits dominate, then tags, then description, then the rest. */
function score(t, q) {
  const name = t.name.toLowerCase();
  const tags = (t.tags || []).join(' ').toLowerCase();
  const desc = (t.description || '').toLowerCase();
  let s = 0;

  for (const term of q.terms) {
    if (name === term) s += 100;
    else if (name.startsWith(term)) s += 50;
    else if (name.includes(term)) s += 30;
    if (tags.split(/\s+/).includes(term)) s += 18;
    else if (tags.includes(term)) s += 9;
    if (desc.includes(term)) s += 6;
    if (haystack(t).includes(term)) s += 1;
  }
  for (const p of q.phrases) {
    if (name.includes(p)) s += 60;
    else if (desc.includes(p)) s += 20;
    else if (haystack(t).includes(p)) s += 8;
  }

  // Quality signals: a described, healthy, free tool outranks an unknown one.
  if (t.description) s += 3;
  if (t.health?.status === 'alive') s += 2;
  else if (t.health?.status === 'dead' || t.health?.status === 'unreachable') s -= 8;
  if (t.access === 'free') s += 1;
  return s;
}

/**
 * Run a query over a dataset's tools.
 * @returns {{query: object, total: number, results: Array}}
 */
export function search(tools, input, { limit = 50, offset = 0 } = {}) {
  const q = typeof input === 'string' ? parseQuery(input) : input;
  const onlyRetired = q.flags.has('is:retired');
  const includeRetired = onlyRetired || q.flags.has('is:any');
  const needsDescription = q.flags.has('has:description');

  let hits = tools.filter((t) => {
    if (onlyRetired && !t.retired) return false;
    if (!includeRetired && t.retired) return false;
    if (needsDescription && !t.description) return false;

    for (const [key, values] of Object.entries(q.facets)) {
      if (!matchesFacet(t, key, values)) return false;
    }
    const hay = haystack(t);
    for (const x of q.exclude) if (hay.includes(x)) return false;
    for (const p of q.phrases) if (!hay.includes(p)) return false;
    for (const term of q.terms) if (!hay.includes(term)) return false;
    return true;
  });

  const scored = q.terms.length || q.phrases.length;
  hits = hits
    .map((t) => ({ t, s: scored ? score(t, q) : 0 }))
    .sort((a, b) => (b.s - a.s) || a.t.name.localeCompare(b.t.name))
    .map((x) => x.t);

  return { query: q, total: hits.length, results: hits.slice(offset, offset + limit) };
}

/** Facet counts for the current result set — drives the sidebar in the HTML surface. */
export function facetCounts(tools) {
  const out = { target: {}, access: {}, kind: {}, category: {}, region: {}, health: {} };
  const bump = (g, k) => { if (k) out[g][k] = (out[g][k] || 0) + 1; };
  for (const t of tools) {
    for (const g of t.targets || []) bump('target', g);
    bump('access', t.access);
    bump('kind', t.kind);
    bump('category', t.category);
    for (const r of t.regions || []) bump('region', r);
    bump('health', t.health?.status);
  }
  return out;
}
