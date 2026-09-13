#!/usr/bin/env node
// Link-health checker for the OSINT Explorer dataset.
//
//   node scripts/check-links.mjs [--in data/tools.v2.json] [--out data/health.json]
//                               [--concurrency 24] [--timeout 20000] [--only <substring>]
//                               [--unchecked]   only entries with health.status 'unchecked'
//
// Design notes (learned from a 60-URL spot check of the seed corpus):
//   * A plain client gets 403 from ~28% of these hosts (Cloudflare, start.me, tgstat,
//     government portals). 403/401/405/429 therefore means "bot-walled", NOT dead.
//   * HEAD is unreliable on this corpus, so we GET and abort the body once headers land.
//   * Parked/for-sale domains answer 200 with a squatter page, so 200 responses are
//     sniffed for parking markers before being called alive.
//   * A sandboxed egress proxy answers 502 with an empty body for domains it will not
//     proxy. That is indistinguishable from an origin 502 locally, so those are labelled
//     'inconclusive' and must be adjudicated from a different network path
//     (scripts/adjudicate.mjs consumes an off-box verdict file).
// Exit codes: 0 = checked (findings in the report), 2 = usage error.

import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-AU,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
  'upgrade-insecure-requests': '1',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
};

const PARKED_MARKERS = [
  'this domain is for sale', 'domain is for sale', 'buy this domain',
  'domain parking', 'parked free, courtesy of', 'sedoparking',
  'hugedomains', 'afternic', 'dan.com is for sale',
  'the domain name you requested', 'is available for purchase',
  'website coming soon', 'default web site page',
];
const CHALLENGE_MARKERS = [
  'just a moment', 'checking your browser', 'cf-browser-verification',
  'enable javascript and cookies to continue', 'attention required! | cloudflare',
  'ddos-guard', 'verifying you are human',
];

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inFile = arg('--in', 'data/tools.v2.json');
const outFile = arg('--out', 'data/health.json');
const concurrency = Number(arg('--concurrency', '24'));
const timeout = Number(arg('--timeout', '20000'));
const only = arg('--only', null);
if (!Number.isFinite(concurrency) || concurrency < 1) { console.error('--concurrency must be a positive number'); process.exit(2); }

function sameTarget(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    const strip = (h) => h.replace(/^www\./, '');
    if (strip(x.hostname) !== strip(y.hostname)) return false;
    const p = (u) => u.pathname.replace(/\/+$/, '');
    return p(x) === p(y);
  } catch { return false; }
}

export async function checkUrl(url, { timeoutMs = 20000 } = {}) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: ac.signal });
    const finalUrl = res.url || url;
    let body = '';
    if ([200, 403, 502, 503, 504].includes(res.status)) {
      // Read a small prefix only — enough to sniff parking/challenge pages.
      const reader = res.body?.getReader();
      if (reader) {
        const dec = new TextDecoder();
        let read = 0;
        while (read < 20000) {
          const { done, value } = await reader.read();
          if (done) break;
          read += value.byteLength;
          body += dec.decode(value, { stream: true });
        }
        try { await reader.cancel(); } catch { /* already closed */ }
      }
    } else {
      try { await res.body?.cancel(); } catch { /* no body */ }
    }
    const lower = body.toLowerCase();
    const s = res.status;
    let status;
    if (s === 404 || s === 410) status = 'dead';
    else if ((s === 502 || s === 504) && !body) status = 'inconclusive';
    else if (s >= 500) status = 'server-error';
    else if ([401, 402, 403, 405, 406, 429].includes(s)) status = 'bot-walled';
    else if (s >= 200 && s < 400) {
      if (PARKED_MARKERS.some((m) => lower.includes(m))) status = 'dead';
      else if (CHALLENGE_MARKERS.some((m) => lower.includes(m))) status = 'bot-walled';
      else status = sameTarget(url, finalUrl) ? 'alive' : 'redirected';
    } else status = 'bot-walled';

    return {
      status,
      httpStatus: s,
      finalUrl: finalUrl === url ? null : finalUrl,
      title: (body.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim() || null,
      ms: Date.now() - started,
      error: null,
    };
  } catch (e) {
    const msg = e?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : `${e?.cause?.code || e?.name}: ${e?.message}`;
    return { status: 'unreachable', httpStatus: null, finalUrl: null, title: null, ms: Date.now() - started, error: String(msg).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

async function main() {
  const ds = JSON.parse(readFileSync(inFile, 'utf8'));
  let tools = ds.tools;
  if (only) tools = tools.filter((t) => t.id.includes(only) || t.url.includes(only) || t.category.includes(only));
  if (process.argv.includes('--unchecked')) tools = tools.filter((t) => (t.health?.status || 'unchecked') === 'unchecked');
  if (!tools.length) { process.stderr.write('nothing to check\n'); process.exit(0); }

  process.stderr.write(`checking ${tools.length} urls, concurrency ${concurrency}\n`);
  let done = 0;
  const results = await pool(tools, concurrency, async (t) => {
    const r = await checkUrl(t.url, { timeoutMs: timeout });
    if (++done % 25 === 0) process.stderr.write(`  ${done}/${tools.length}\n`);
    return { id: t.id, name: t.name, url: t.url, ...r };
  });

  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const report = { checkedAt: new Date().toISOString(), total: results.length, counts, results };
  writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(counts, null, 2));
  console.log(`wrote ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
