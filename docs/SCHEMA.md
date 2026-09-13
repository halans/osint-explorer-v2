# Dataset schema (v2)

`data/tools.enriched.json` is the source of truth every surface reads. Shape:

```json
{
  "schemaVersion": 2,
  "title": "OSINT Explorer",
  "generatedAt": "2026-09-13T…",
  "sources": [{ "id": "seed", "file": "data/seed/tools.json", "origin": "halans/osint-explorer", "generatedAt": "2025-11-04T…", "tools": 546 }],
  "categories": [{ "name": "Mapping", "subcategories": ["Sat Imagery", "…"], "seedCount": 33, "treeCount": 33, "count": 41 }],
  "stats": { "tools": 0, "live": 0, "retired": 0, "described": 0, "categories": 15, "fromResearch": 0 },
  "landscapeChanges": [{ "name": "Shodan", "change": "paywalled", "detail": "…", "evidenceUrl": "…", "stream": "infrastructure" }],
  "tools": [ /* see below */ ]
}
```

## Tool record

| field | type | notes |
|---|---|---|
| `id` | string | stable slug, `slugify(category, name)`, de-duplicated with a numeric suffix. Safe to link to. |
| `name` | string | cleaned display name. Bookmark titles were often truncated or ALL-CAPS; see `originalName`. |
| `originalName` | string? | present when the enrichment pass renamed the entry. |
| `url` | string | http(s). Unique across the dataset — the merge folds collisions. |
| `supersededUrl` | string? | the previous URL, when a research `change` moved the entry. |
| `supersededBy` | string? | id of the entry that replaced this one (e.g. CrowdTangle → Meta Content Library). |
| `category` | string | one of `categories[].name`. |
| `subcategory` / `subSubcategory` | string? | from the seed tree or the research stream. |
| `path` | string | `Category › Subcategory` display path. |
| `alsoIn` | string[] | other paths the same URL was bookmarked under. |
| `aliasOf` | object[]? | entries folded into this one by the dedupe pass (`{id, name, path}`). |
| `description` | string \| null | one factual sentence, ≤240 chars. `null` means unverified, never "we didn't bother". |
| `confidence` | `verified` \| `inferred` \| `unverified` | how the description was established. |
| `targets` | enum[] | what you feed it: `keyword` `username` `person` `email` `phone` `domain` `ip` `company` `image` `video` `audio` `document` `geo` `vehicle` `crypto` `dataset` `social`. |
| `access` | enum | `free` `free-registration` `freemium` `paid` `api-key` `unknown` — the **September 2026** reality, not the historical one. |
| `kind` | enum | `web-tool` `search` `database` `dataset` `map` `feed` `directory` `reading` `software` `api`. |
| `regions` | string[] | `[]` = global. `AU`, `AU-NSW`, `CN`, `EU`, … `region:AU` also matches `AU-*`. |
| `tags` | string[] | lowercase topical tags, ≤12. |
| `licence` | string? | dataset licence where the source states one. |
| `format` | string? | `GeoJSON`, `CSV`, `WMS`, `REST API`, … for data sources. |
| `health` | object | `{ status, httpStatus, finalUrl, checkedAt, error }`. |
| `retired` | boolean | hidden from search unless `is:retired` / `is:any`. |
| `retiredReason` | string? | why. |
| `notes` | string? | caveats: rate limits, registration walls, degraded features, legal constraints. |
| `changeLog` | object[]? | research-recorded changes: `{ change, detail, evidenceUrl, source }`. |
| `provenance` | string | `seed:bookmarks.html@2025-11-04(+enriched)(+override)` or `research:<stream>@<date>`. |
| `evidenceUrl` | string? | what the researcher read to justify a new entry. |
| `hasIcon` | boolean | whether `data/icons.json` holds a favicon for this id. |

## `health.status`

| value | meaning | retires the entry? |
|---|---|---|
| `alive` | 2xx at the same address | no |
| `redirected` | 2xx at a materially different final URL (`finalUrl` records it) | no |
| `bot-walled` | 401/402/403/405/406/429 or a challenge page — almost certainly fine for a human | no |
| `server-error` | 5xx from the origin, possibly transient | no |
| `inconclusive` | `502`/`504` with an empty body: the checking network wouldn't proxy the host, so the result says nothing about the origin | no |
| `unreachable` | DNS/TLS failure or timeout | no |
| `dead` | 404/410, or a 200 that is a parked / for-sale page | **yes** |
| `unchecked` | added since the last check run | no |

Only `dead` retires an entry automatically. This asymmetry is deliberate: roughly a fifth
of this corpus 403s a scripted client, and treating that as death would silently delete
working tools.

## Enum stability

`src/schema.mjs` exports `TARGETS`, `ACCESS`, `KINDS`, `HEALTH_STATES` and the
`validateDataset()` function. Adding a value there is a schema change — update
`docs/SCHEMA.md`, the README query table, and the facet labels in `scripts/build.mjs`
together. `npm test` fails on any value outside the enums.

## Icons

Favicons are base64 data URIs in `data/icons.json`, keyed by tool id (split out of the
main dataset so it stays diffable, ~435 kB). `scripts/build.mjs --no-icons` builds a
much smaller page without them.
