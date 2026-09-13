# Recreating this dataset from the shipped archive

The zip is offline-complete and self-verifying: cached upstream source data with
checksums, every intermediate layer, the prebuilt artefacts, and the tests. A recipient
with Node 20 and **no network access** can verify the checksums, rerun the tests, and
rebuild every artefact byte-for-byte.

## 1. Verify what you received

```bash
unzip osint-explorer.zip && cd osint-explorer
node --version                      # expect v20 or newer
sha256sum -c data/seed/CHECKSUMS.txt
```

Expected:

```
data/seed/osint-tools.json: OK
data/seed/tools.json: OK
```

Those two files are the upstream bookmark exports from `halans/osint-explorer`, cached
here so a rebuild never depends on GitHub being reachable. Their recorded digests:

```
412f3ae21db54e3d7939068107b5f0ed236823dfa73ce8dbbac62f54e76520b8  data/seed/osint-tools.json
5918e8bf76dc51cacd7ec93dac2ae79f4a0037176c582739d784415653a31bf0  data/seed/tools.json
```

## 2. Rebuild offline

```bash
npm run data     # normalise -> merge --strict -> build   (no network)
npm test         # 35 tests
```

Every input the rebuild needs is in the archive:

| layer | file(s) | produced by | needs network? |
|---|---|---|---|
| seed corpus | `data/seed/*.json` | upstream bookmark export, cached | no |
| link health | `data/health*.json` | `scripts/check-links.mjs` | **yes**, when re-run |
| descriptions + facets | `data/research/desc/batch-*.json` | enrichment pass (`docs/ENRICHMENT-SPEC.md`) | **yes**, when re-run |
| new tools + changes | `data/research/*.json` | research streams | **yes**, when re-run |
| hand corrections | `data/overrides.json` | manual | no |

The recorded layers are **committed outputs, not caches** — the rebuild replays them, so
`npm run data` reproduces the published dataset without contacting anything. Re-running a
pass is only necessary when you want fresher data.

## 3. Confirm the rebuild matches

```bash
node bin/osint.mjs stats
node bin/osint.mjs validate
```

The published build reports:

```
  tools          727
  live           711
  retired         16
  described      714
  categories      15
  fromResearch   191
```

`generatedAt` is a wall-clock timestamp, so `data/tools.enriched.json` and
`dist/osint-explorer.html` differ from the shipped copies on that field (and only that
field) after a rebuild. To diff the substance, ignore it:

```bash
node -e 'const a=require("./data/tools.enriched.json");delete a.generatedAt;
         console.log(require("crypto").createHash("sha256").update(JSON.stringify(a)).digest("hex"))'
```

## 4. Use it without rebuilding

```bash
open dist/osint-explorer.html          # self-contained page, no server, no network
node bin/osint.mjs search flood region:AU
OSINT_DATASET=/path/to/tools.min.json node bin/osint.mjs stats
```

`dist/osint-explorer.html` embeds the dataset, the favicons and the search engine. It
fetches nothing at runtime except the Google Fonts stylesheet — with no network it falls
back to the system font stack and every feature still works.

## 5. Refresh it later

Order matters, because the merge layers by recency:

```bash
node scripts/check-links.mjs --concurrency 28              # fresh verdicts (network)
node scripts/merge.mjs --strict                            # apply them
node scripts/check-links.mjs --in data/tools.enriched.json --unchecked \
     --out data/health-new.json                            # any entries added meanwhile
node scripts/merge.mjs --strict && node scripts/build.mjs && npm test
```

To refresh the *content* rather than the link verdicts, rerun a research stream (see
`docs/BUILDING.md`) or the enrichment pass (`docs/ENRICHMENT-SPEC.md`) and drop the new
JSON into `data/research/`. Nothing else needs changing: the merge discovers files by
glob, folds duplicate URLs, and validates on the way through.

## Provenance summary

| artefact | origin |
|---|---|
| `data/seed/*.json` | `halans/osint-explorer`, bookmark export generated 2025-11-04 |
| descriptions, facets, regions, tags | written for this repository against live pages, September 2026 |
| 191 additions and 20 recorded changes | research passes, September 2026, each with an `evidenceUrl` |
| link-health verdicts | `scripts/check-links.mjs`, 2026-09-13 |
| favicons | carried through from the seed export |

Individual tools and datasets keep their own licences; where a source states one it is in
the entry's `licence` field. Note the SA CFS feed's CC BY-NC-ND terms in particular.
