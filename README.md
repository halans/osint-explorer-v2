# OSINT Explorer

A curated, **link-checked and described** directory of open-source intelligence tools,
datasets and live feeds — plus a search engine that runs identically in a CLI and in a
single self-contained offline web page.

The corpus started as a browser-bookmark export (546 entries, 4 November 2025, from
[halans/osint-explorer](https://github.com/halans/osint-explorer)). That export had names
and URLs but **no descriptions, no facets, no health signal, and nothing newer than late
2025**. This repository is the refresh:

| | seed (Nov 2025) | this dataset |
|---|---|---|
| entries | 546 | see `npm run -s validate` / `osint stats` |
| with a written description | 0 | >98% |
| link-checked | no | every entry, with a recorded verdict and date |
| facets (input type, access model, kind, region) | none | every entry |
| newest additions | Nov 2025 | Sept 2026 research pass (incl. God's Eye View) |
| Australian hazard & open-data feeds | a handful of state links | dedicated feed/dataset set (bushfire, flood, weather, spatial, registries) |
| surfaces | web app | CLI + offline single-file page + JSON |

## Quick start

```bash
node --version            # 20+
npm run data              # normalise -> merge -> build (no network, no dependencies)
npm test                  # real tests, no mocks
node bin/osint.mjs stats
```

Then open `dist/osint-explorer.html` in a browser — it needs no server and no network.

## Using the CLI

```bash
osint search flood region:AU                 # Australian flood sources
osint search bushfire kind:feed              # live bushfire incident feeds
osint search target:image access:free        # free reverse-image / forensics tools
osint search "passive dns" -paid             # phrase match, exclude paid
osint search kind:dataset region:AU-NSW      # NSW bulk datasets
osint search region:AU --csv > au-tools.csv
osint show country-specific-nsw-rfs-major-incidents-geojson
osint facets region:AU                       # what's in the Australian subset
osint changes                                # what died or paywalled since 2025
osint stats
osint validate
```

Exit codes: `0` success, `1` no results / validation failed, `2` usage error.
Reporters: default human-readable, `--json`, `--csv`, `--ids`.

### Query syntax

| form | meaning |
|---|---|
| `flood gauge` | all terms must appear (name, description, tags, category, URL, notes) |
| `"river height"` | exact phrase |
| `-paid` | exclude |
| `target:geo` | what you feed the tool: `keyword` `username` `person` `email` `phone` `domain` `ip` `company` `image` `video` `audio` `document` `geo` `vehicle` `crypto` `dataset` `social` |
| `access:free` | `free` `free-registration` `freemium` `paid` `api-key` `unknown` |
| `kind:feed` | `web-tool` `search` `database` `dataset` `map` `feed` `directory` `reading` `software` `api` |
| `region:AU` | matches `AU` and every `AU-*` subdivision |
| `category:mapping` | substring match on the category path |
| `tag:bushfire` | exact tag match |
| `health:bot-walled` | link-check verdict |
| `is:retired` / `is:any` | retired entries only / include retired (default: excluded) |
| `has:description` | only described entries |

Facets OR within a group and AND across groups: `kind:feed kind:map region:AU` means
"(feed or map) and Australian".

## Repository layout

```
src/schema.mjs          schema, enums, validator           (no deps)
src/search.mjs          the search engine — single source of truth
bin/osint.mjs           CLI surface
scripts/normalise.mjs   seed exports      -> data/tools.v2.json
scripts/check-links.mjs URLs              -> data/health*.json
scripts/merge.mjs       all layers        -> data/tools.enriched.json
scripts/build.mjs       dataset + engine  -> dist/osint-explorer.html, dist/tools.min.json
data/seed/              cached upstream exports + CHECKSUMS.txt (offline rebuild)
data/research/          new-tool research streams (additions + landscape changes)
data/research/desc/     the description + facet layer, per batch
data/overrides.json     hand corrections, applied last, always win
docs/                   BUILDING, SCHEMA, ENRICHMENT-SPEC, RECREATING, REPORT
test/                   search, dataset and cross-surface equivalence tests
```

## How the data is made

Five layers, each auditable on its own and merged by one script:

1. **Normalise** — fold the two seed exports into one schema, split base64 favicons into
   `data/icons.json`, generate stable slug ids, collapse URLs bookmarked twice.
2. **Link health** — GET every URL with browser-grade headers, classify
   `alive` / `redirected` / `bot-walled` / `dead` / `unreachable` / `server-error` /
   `inconclusive`. A plain client gets 403 from roughly a fifth of this corpus, so
   **403 is recorded as bot-walled, never as dead**; only 404/410 and parked-domain pages
   retire an entry.
3. **Enrichment** — a written one-line description plus `targets` / `access` / `kind` /
   `regions` / `tags` for every entry, sourced from the live page and marked
   `verified` / `inferred` / `unverified`. See `docs/ENRICHMENT-SPEC.md`.
4. **Research** — parallel streams for geospatial, Australian open data, people search,
   infrastructure, social platforms, verification/crypto, AI tooling and canonical-staple
   gaps. Each stream contributes `additions` (new tools) and `changes` (what died,
   moved or paywalled). Changes that name a tool the corpus never listed are kept in
   `landscapeChanges` rather than dropped.
5. **Overrides** — hand corrections in `data/overrides.json`, applied last.

`scripts/merge.mjs` writes `data/merge-report.json` so every pass is inspectable: what
applied, what was folded as a duplicate, what warned.

## Honesty conventions

The dataset distinguishes *unknown* from *absent*, because a directory that guesses is
worse than one that admits gaps:

- `description: null` with `confidence: "unverified"` means nobody could confirm what the
  tool is — no plausible-sounding filler was written for it.
- `confidence: "inferred"` means the page wouldn't load but the tool is well known; the
  reason is in `notes`.
- `health.status: "inconclusive"` means the check ran from a network that couldn't reach
  the host (a sandboxed egress proxy answers `502` with an empty body for hosts it won't
  proxy). It says nothing about the origin and must be adjudicated elsewhere.
- `retired: true` entries stay in the dataset with a `retiredReason` instead of being
  deleted, so "this used to exist" is answerable. They're hidden from search unless you
  ask for them.
- Access levels reflect what the free tier **actually gives you in September 2026**, which
  in this space is often much less than it gave in 2025. Caveats live in `notes`.

## Scope boundary

This is a directory of investigative tooling. Legitimate commercial people-search
services, breach-notification services and open-source recon frameworks are in scope;
stalkerware, credential-stuffing services, combolist and leaked-password resellers, and
dark-web credential shops are not, and were excluded deliberately during research. A few
grey-area services widely cited in mainstream security press are included with the caveat
stated in `notes`.

Listing a tool is not endorsement or legal advice. Several entries touch personal data,
and what you may lawfully do with them depends on your jurisdiction and purpose.

## Licence and attribution

Code: CC BY-SA 4.0. The dataset is a curated derivative of the seed bookmark export from
[halans/osint-explorer](https://github.com/halans/osint-explorer); descriptions, facets,
health data and the 2026 additions are original work in this repository. Individual tools
and datasets carry their own licences — where a dataset states one it is recorded in the
entry's `licence` field (note the SA CFS non-commercial, no-derivatives terms in
particular).

Further reading: `docs/BUILDING.md` (rebuild and extend), `docs/SCHEMA.md` (field
reference), `docs/RECREATING.md` (offline reproduction from the shipped zip),
`docs/REPORT.md` (what changed in the landscape since the seed export).
