# Enrichment pass spec (description + facet layer)

You are enriching one batch of an OSINT tool directory. Every tool already has a name, URL
and category; what is missing is a **description** and a set of **facets**. This layer is
the directory's whole value — the raw bookmark export has none of it.

## Input

`data/research/batches/batch-<N>.jsonl` — one JSON object per line:
`{"id": "...", "name": "...", "url": "https://...", "path": "Category › Subcategory"}`

## Output

`data/research/desc/batch-<N>.json` — exactly this shape, one entry per input line, same ids:

```json
{
  "batch": <N>,
  "enrichedAt": "<ISO timestamp>",
  "entries": [
    {
      "id": "<copied verbatim from the input>",
      "description": "One factual sentence, max 200 characters.",
      "targets": ["domain"],
      "access": "free",
      "kind": "web-tool",
      "regions": [],
      "tags": ["dns", "passive-dns"],
      "confidence": "verified",
      "nameSuggestion": null,
      "notes": null
    }
  ]
}
```

## How to write the description

Load the real pages before writing. Use `ExaContents` with `summary: true` on batches of
10–20 URLs at a time (`livecrawl: "fallback"`). Write from what the page actually says.

- **One sentence.** Max 200 characters. No trailing full-stop needed but allowed.
- Say **what it does and what you point it at**: "Resolves a domain to its historical DNS
  records", "Searches Telegram channels by keyword", "Flood gauge readings for Victorian rivers".
- **No marketing language.** Ban: powerful, comprehensive, seamless, cutting-edge, robust,
  one-stop, unlock, leverage, game-changing, "your go-to", "the ultimate".
- **No filler openers.** Don't start with "A tool that", "This website allows you to",
  "An online platform for".
- Prefer concrete nouns over category words: "Aircraft positions from crowdsourced ADS-B
  receivers" beats "Aviation OSINT resource".
- If the entry is a link collection / start.me board / awesome-list, say so plainly.
- If it is a blog or guide, name the subject: "Investigation write-ups on extremism and
  Telegram networks".
- Country-specific entries: name the country and the record type — "Norwegian phone and
  address directory", "Chinese company registry with filings and shareholder records".

## Facets

- `targets` — what you feed it. Choose from: `keyword`, `username`, `person`, `email`,
  `phone`, `domain`, `ip`, `company`, `image`, `video`, `audio`, `document`, `geo`,
  `vehicle`, `crypto`, `dataset`, `social`. Usually 1–3. `keyword` for general search.
- `access` — `free`, `free-registration` (free but you must sign up), `freemium` (usable
  free, meaningful paywall), `paid`, `api-key`, `unknown`. Only use `unknown` if the page
  genuinely doesn't say.
- `kind` — `web-tool`, `search`, `database`, `dataset`, `map`, `feed`, `directory`,
  `reading`, `software`, `api`.
- `regions` — `[]` for global. Otherwise ISO codes: `["AU"]`, `["AU-NSW"]`, `["CN"]`,
  `["NO"]`, `["EU"]`. Country-specific entries must carry a region.
- `tags` — 2–6 short lowercase topical tags. Real subject tags, not restatements of the
  category name.

## Confidence

- `"verified"` — you loaded the page (or its Exa summary) and the description reflects it.
- `"inferred"` — the page wouldn't load, but the tool is well known and you are confident
  from other sources; say so in `notes`.
- `"unverified"` — you could not confirm what this is. Set `description` to `null`, put
  what you observed in `notes` (e.g. "404", "domain parked", "Cloudflare challenge").

Never invent a description for a page you couldn't read and don't recognise. An honest
`unverified` is worth more than a plausible guess — a later pass adjudicates those.

## Other fields

- `nameSuggestion` — the bookmark titles are messy ("FRANCE", "19. Crime Index by Country",
  "kns.cnki 个性化首页-中国知网", "Facebook Event (Will require an event ID - Mo"). If the
  title is truncated, numbered, ALL-CAPS-country-only, or otherwise unhelpful, supply a
  clean replacement here. Otherwise `null`.
- `notes` — caveats worth surfacing: registration walls, rate limits, "read-only since
  the API change", "requires a Chinese phone number to register", licence terms for
  datasets. Otherwise `null`.

## Working method

1. Read the batch file.
2. `ExaContents` on 10–20 URLs per call with `summary: true`.
3. Write the JSON file with the `Write` tool. Validate it parses (`node -e` or `python3 -c`)
   and that the entry count matches the input line count.
4. Reply with a short summary only: counts by `confidence`, and anything notable you hit
   (dead sites, tools that clearly changed identity, entries you'd recommend retiring).

Do not modify any file other than your own `data/research/desc/batch-<N>.json`.
