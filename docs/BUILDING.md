# Building, rebuilding and extending

Node 20+ and nothing else. No dependencies, no lockfile, no install step, no network
required for a rebuild — the seed exports are cached in `data/seed/` with checksums.

## Rebuild everything

```bash
npm run data     # normalise -> merge (--strict) -> build
npm test         # 35 tests: search behaviour, dataset invariants, surface equivalence
```

`npm run data` is offline and deterministic given the same inputs. Only
`scripts/check-links.mjs` and the research passes touch the network.

Real output of the individual steps:

```
$ node scripts/normalise.mjs
normalised 542 tools (4 duplicate URLs folded) across 15 categories
icons: 479

$ node scripts/merge.mjs --strict
… { "stats": { "tools": 727, "live": 711, "retired": 16, "described": 714,
               "categories": 15, "fromResearch": 191 }, "warnings": 0,
    "validation": { "errors": 0 } }

$ node scripts/build.mjs
dist/osint-explorer.html  1017 kB  (727 tools, icons: 479)
dist/tools.min.json       700 kB
```

## Re-checking links

The health pass is the part that goes stale. Re-run it whenever you want a fresh verdict:

```bash
# whole corpus (~2 minutes at concurrency 28)
node scripts/check-links.mjs --concurrency 28 --timeout 22000

# only entries added since the last check
node scripts/check-links.mjs --in data/tools.enriched.json --unchecked --out data/health-new.json

# one slice, without clobbering the main report
node scripts/check-links.mjs --only "Country Specific" --out /tmp/au-health.json
```

Every `data/health*.json` file is merged, **oldest `checkedAt` first**, so follow-up runs
layer over the original sweep. A result recorded against a URL the entry no longer has is
skipped — a 404 measured on a broken address must not keep a corrected entry retired
(`staleSkipped` in the merge report counts these).

Observed verdict distribution on the current corpus:

```
$ node bin/osint.mjs stats
  link health
    alive              453
    bot-walled         147
    redirected          79
    inconclusive        21
    dead                12
    unreachable         10
    server-error         5
```

**Do not "fix" the checker to treat 403 as dead.** 147 entries in this corpus 403 a
scripted client and work fine in a browser. Only 404/410 and parked-page detection retire
an entry automatically.

If you run the checker from a sandboxed network, expect `inconclusive` results: an egress
proxy that refuses a host answers `502` with an empty body, which is indistinguishable
from an origin 502 locally. Those need adjudication from a different network path — an
off-box `curl`, or a browser — and a correction in `data/overrides.json`.

## Adding a tool by hand

Append to any research stream file (or make a new one) under `data/research/`:

```json
{
  "stream": "manual",
  "researchedAt": "2026-09-13T00:00:00Z",
  "additions": [
    {
      "name": "NSW RFS Major Fire Incidents Feed",
      "url": "https://www.rfs.nsw.gov.au/feeds/majorIncidents.json",
      "description": "NSW Rural Fire Service live GeoJSON feed of current major bushfire and grassfire incidents with status and alert level",
      "category": "Country Specific",
      "subcategory": "Australia",
      "targets": ["geo", "dataset"],
      "access": "free",
      "kind": "feed",
      "regions": ["AU", "AU-NSW"],
      "tags": ["bushfire", "incidents", "geojson"],
      "licence": "CC BY 4.0",
      "format": "GeoJSON",
      "evidenceUrl": "https://www.rfs.nsw.gov.au/fire-information/fires-near-me",
      "notes": "No auth required; updated continuously by RFS"
    }
  ],
  "changes": []
}
```

Then `npm run data`. The merge assigns a stable id, folds the entry if the URL is already
listed (filling any gaps instead of duplicating), and validates the enums. Rerun the
checker with `--unchecked` to give the new entry a health verdict.

`changes` entries record what happened to a tool rather than adding one:

```json
{ "name": "Shodan", "url": "https://www.shodan.io/", "change": "paywalled",
  "detail": "Free-account web search now returns a handful of results per query",
  "evidenceUrl": "https://…" }
```

Matching is by exact URL, then by hostname **when the name also agrees**, then by name.
A change naming a tool the corpus doesn't list is kept in `landscapeChanges` rather than
dropped — visible via `osint changes`. (The hostname rule is strict on purpose: an early
version matched a Nitter notice against an unrelated bookmark that merely lived on
`nitter.net`, and retired the wrong tool.)

## Correcting an entry

`data/overrides.json` is applied last and always wins:

```json
{
  "note": "Hand corrections applied after the automated passes.",
  "tools": {
    "country-specific-asic-search-our-registers": {
      "url": "https://www.asic.gov.au/online-services/search-asic-registers",
      "notes": "ASIC restructured its site; the old search-our-registers slug 404s"
    },
    "some-dead-tool-id": { "retired": true, "retiredReason": "domain parked (checked 2026-09-13)" }
  }
}
```

Changing `url` in an override resets that entry's health to `unchecked` and clears a
link-check retirement, so re-run the checker with `--unchecked` afterwards.

## Changing the schema

`src/schema.mjs` owns `TARGETS`, `ACCESS`, `KINDS`, `HEALTH_STATES` and
`validateDataset()`. Adding a value means touching four places together:

1. the enum in `src/schema.mjs`
2. `docs/SCHEMA.md`
3. the query-syntax table in `README.md`
4. the facet labels/caps in `scripts/build.mjs` (`FACET_ORDER`, `CAPS`)

`npm test` fails on any value outside the enums, and on a category no entry declares.

## Changing search behaviour

Edit `src/search.mjs` only. The CLI imports it, and `scripts/build.mjs` inlines the same
file into the page with `export ` keywords stripped —
`test/equivalence.test.mjs` asserts the embedded copy still matches the module byte for
byte (modulo those keywords) and that both answer ten real queries identically. If you
reimplement search logic in the page template, that test fails, which is the point.

After editing search, always `npm run build` before `npm test`: a stale `dist/` is
treated as a bug rather than tolerated.

## Working on the page

`scripts/build.mjs` holds the whole page (CSS, markup, view logic) in one template
function. Conventions worth preserving:

- **Fixed facet caps.** Small closed enums (type, access, link health) render in full;
  hiding `feed` or `dataset` behind a "+2 more" link buried the filters people reach for
  most — that was a real bug caught in browser testing.
- **No non-breaking spaces in long strings.** A `&nbsp;`-separated syntax line in the
  footer could not wrap and gave the page a 518px scroll width on a 390px phone.
- **Mobile parity.** The phone layout collapses the facet rail behind a Filters button and
  drops to one column; it must not remove functionality. Tap targets are 41px on phones
  (28px desktop rows were too small for a thumb).
- `--no-icons` builds a much smaller page for embedding.

Verify a page change in a real browser at both widths, not just by reading the diff.
Checks worth running in the console: `document.documentElement.scrollWidth <= innerWidth`,
a facet click updating `location.hash`, and the result count changing on input.
