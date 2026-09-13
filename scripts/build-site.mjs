#!/usr/bin/env node
// Build the SEO/AEO-facing static site from the enriched dataset.
//
//   node scripts/build-site.mjs
//
// Input   data/tools.enriched.json
// Output  site/                one static HTML page per category, plus a
//                               homepage, sitemap.xml, robots.txt, 404.html
//
// Independent of scripts/build.mjs (the offline single-file app) — both
// read the same dataset, neither depends on the other's output. Unlike
// dist/osint-explorer.html, site/ is never committed: it's generated fresh
// by CI on every deploy (see .github/workflows/pages.yml).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_URL = 'https://halans.github.io/osint-explorer-v2/';
