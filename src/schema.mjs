// Schema definition + validator for the OSINT Explorer v2 dataset.
// Zero dependencies. Used by scripts/normalise.mjs, scripts/build.mjs and the test suite.

export const SCHEMA_VERSION = 2;

/** Input artefact a tool accepts as its starting point. */
export const TARGETS = [
  'keyword',    // free-text / general search
  'username',   // handles, account names
  'person',     // real names, identity records
  'email',
  'phone',
  'domain',     // domains, URLs, websites
  'ip',         // IPs, ASNs, netblocks, certificates
  'company',    // legal entities, registries, filings
  'image',
  'video',
  'audio',
  'document',   // PDFs, leaks, court/gov documents
  'geo',        // coordinates, place names, imagery
  'vehicle',    // aircraft, vessels, plates, trains
  'crypto',     // wallet addresses, txids
  'dataset',    // bulk/API data feeds
  'social',     // platform-scoped content search
];

/** How you get in. */
export const ACCESS = ['free', 'free-registration', 'freemium', 'paid', 'api-key', 'unknown'];

/** What kind of thing it is. */
export const KINDS = [
  'web-tool',   // interactive site you point at a target
  'search',     // search engine / index
  'database',   // browsable record collection
  'dataset',    // downloadable/API data source
  'map',        // interactive geospatial viewer
  'feed',       // live alerts / incident streams
  'directory',  // link collections, start.me boards, awesome-lists
  'reading',    // blogs, guides, reports, training
  'software',   // installable CLI/desktop/library
  'api',
];

export const HEALTH_STATES = [
  'alive',       // 2xx
  'redirected',  // 2xx at a materially different final URL
  'bot-walled',  // 401/403/405/429 or challenge page — almost certainly live for humans
  'server-error',// 5xx from the origin — may be transient
  'inconclusive',// 502/504 with an empty body: our sandbox egress returns this for
                 // domains it will not proxy, so it says nothing about the origin
  'unreachable', // DNS/TLS/timeout failure
  'dead',        // 404/410, or parked/for-sale page
  'unchecked',
];

const isStr = (v) => typeof v === 'string' && v.length > 0;

/**
 * Validate a full dataset document. Returns an array of human-readable problems;
 * an empty array means the document is valid.
 */
export function validateDataset(doc) {
  const errors = [];
  const err = (m) => errors.push(m);

  if (!doc || typeof doc !== 'object') return ['dataset is not an object'];
  if (doc.schemaVersion !== SCHEMA_VERSION) err(`schemaVersion must be ${SCHEMA_VERSION}, got ${doc.schemaVersion}`);
  if (!Array.isArray(doc.tools)) return [...errors, 'dataset.tools must be an array'];
  if (!Array.isArray(doc.categories)) err('dataset.categories must be an array');

  const categoryNames = new Set((doc.categories || []).map((c) => c.name));
  const seenIds = new Set();
  const seenUrls = new Map();

  doc.tools.forEach((t, i) => {
    const at = `tools[${i}] (${t?.id || t?.name || 'unnamed'})`;
    if (!isStr(t.id)) err(`${at}: missing id`);
    else if (seenIds.has(t.id)) err(`${at}: duplicate id`);
    else seenIds.add(t.id);

    if (!isStr(t.name)) err(`${at}: missing name`);
    if (!isStr(t.url)) err(`${at}: missing url`);
    else {
      try {
        const u = new URL(t.url);
        if (!/^https?:$/.test(u.protocol)) err(`${at}: non-http url ${t.url}`);
      } catch {
        err(`${at}: unparseable url ${t.url}`);
      }
      const key = t.url.replace(/\/+$/, '').toLowerCase();
      if (seenUrls.has(key)) err(`${at}: duplicate url, also on ${seenUrls.get(key)}`);
      else seenUrls.set(key, t.id);
    }

    if (!isStr(t.category)) err(`${at}: missing category`);
    else if (categoryNames.size && !categoryNames.has(t.category)) err(`${at}: category "${t.category}" not in categories[]`);

    if (!Array.isArray(t.tags)) err(`${at}: tags must be an array`);

    if (t.description !== null && !isStr(t.description)) err(`${at}: description must be a string or null`);
    if (isStr(t.description) && t.description.length > 240) err(`${at}: description longer than 240 chars`);

    if (!Array.isArray(t.targets)) err(`${at}: targets must be an array`);
    else for (const g of t.targets) if (!TARGETS.includes(g)) err(`${at}: unknown target "${g}"`);

    if (!ACCESS.includes(t.access)) err(`${at}: unknown access "${t.access}"`);
    if (!KINDS.includes(t.kind)) err(`${at}: unknown kind "${t.kind}"`);

    if (!t.health || !HEALTH_STATES.includes(t.health.status)) err(`${at}: unknown health.status "${t.health?.status}"`);
    if (typeof t.retired !== 'boolean') err(`${at}: retired must be a boolean`);
    if (!isStr(t.provenance)) err(`${at}: missing provenance`);
  });

  return errors;
}

/** Stable id: slugified category + name, de-duplicated by the caller. */
export function slugify(...parts) {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}
