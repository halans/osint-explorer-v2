# What changed in the OSINT landscape since the seed export

The seed corpus was exported from a browser bookmark tree on **4 November 2025**. This
refresh was carried out on **13 September 2026** — ten months later. That gap turned out to
matter more than a directory refresh usually does, because the period contains a broad,
one-directional contraction of free access to investigative data.

Everything below was verified by loading the source in September 2026. Per-entry evidence
URLs live in `data/research/*.json`; changes that name a tool the corpus never listed are
preserved in `landscapeChanges` and readable with `osint changes`.

## By the numbers

| | seed | now |
|---|---|---|
| entries | 546 | **727** |
| described | 0 | 714 (98%) |
| link-checked | 0 | 727 (100%) |
| added by the 2026 research pass | — | 191 |
| retired (404/410, parked, shut down, superseded) | — | 16 |
| Australian entries | ~30 state links | **84**, incl. 9 live feeds and 7 bulk datasets |
| categories | 15 | 15 (unchanged; subcategories extended) |

Description confidence: 620 verified, 93 inferred (page wouldn't load, tool well
established, reason recorded), 14 unverified (description left null on purpose).

Link health: 458 alive, 81 alive-after-redirect, 148 bot-walled (403/429/challenge — fine
for a human, hostile to a script), 18 dead, 10 unreachable, 21 inconclusive from the
checking network, 5 origin 5xx.

**The bot-wall number is the operational finding.** One entry in five refuses a scripted
client. Any pipeline that treats a 403 as a dead link will quietly delete a fifth of a
working toolset — which is why this dataset records `bot-walled` as its own state and
retires only on 404/410 and parked pages.

## 1. The free tier is being dismantled

This is the dominant story of the period, and it is concentrated in exactly the tools that
teaching material still presents as "free".

| Tool | September 2026 reality |
|---|---|
| **Shodan** | Free-account web search returns a handful of results per query, filters disabled. |
| **Censys** | Free-forever "Legacy Search" retired; everyone moved to a credit-metered platform tier. |
| **SecurityTrails** | No usable free public tier since the Recorded Future acquisition; historical DNS, WHOIS history and subdomains are paid. |
| **RiskIQ / PassiveTotal** | Community platform effectively dead (broken logins, expired certificates); the successor is an enterprise Defender add-on being folded into Defender XDR. |
| **DNSDumpster** | Hard 50 lookups/day free cap. |
| **WhoisXML** | Small monthly credit allotment tied to a registered account. |
| **ZoomEye** | Site and API migrated to `zoomeye.ai` with a new API-key header scheme — old integrations simply stop working. |
| **ADS-B Exchange** | Free public API tier discontinued; unfiltered access by paid subscription. |
| **MarineTraffic** | Free position-history replay cut from 72 hours to 24. |
| **Flightradar24** | Free history still capped at 7 days. |
| **Etherscan** | Unified API v2's free tier covers community endpoints only (~90% chain coverage). |
| **Chainalysis** | No public free tools at all; enterprise quote-only. |
| **Pipl** | Free/self-signup people search gone; enterprise pricing only. |
| **X Pro (TweetDeck)** | Moved from the $8/month tier to a $40/month plan in March 2026. |

Practical consequence for anyone maintaining a toolkit: **`access` is now the most
perishable field in the dataset.** It is recorded per entry, with the specific limit in
`notes`, precisely because it decays faster than URLs do.

## 2. Social platform access kept collapsing

- **Nitter** was hit with an X Corp cease-and-desist on 24 August 2026, taking most public
  instances offline; the project announced on 7 September 2026 that it continues, but
  `nitter.net` has not reliably returned. The dataset points at **XCancel** as the working
  front end and retires the Nitter entry with that pointer.
- **Reddit historical research is effectively over for the public**: Pushshift is
  moderator-only, PullPush stopped ingesting around May 2025 and has been erratic since,
  Unddit and Camas no longer resolve, and **Removeddit's domain was hijacked and now
  redirects to a casino affiliate** — a reminder that a dead OSINT tool can become an
  actively hostile link. Reveddit and Arctic Shift are the survivors.
- **CrowdTangle** (shut down August 2024) is replaced by the Meta Content Library, which is
  IRB/institution-gated and much narrower. The old entry is retired and points to it.
- **Facebook Graph Search** remains dead and is now documented as such rather than left as
  a hopeful bookmark.
- Counterweight: the **DSA-mandated transparency surfaces** are now real listings — Meta
  Content Library, TikTok Research API and Commercial Content Library, Google Ads
  Transparency Center, LinkedIn Ad Library. Enforcement has teeth: the European Commission
  fined X €120M in December 2025 over its ad repository and researcher access, and TikTok's
  ad repository was found non-compliant with fixes still outstanding.
- Genuine growth area: **Bluesky and the fediverse** now have real search tooling
  (bskysrch, SkySearch, FedSearch, FediFind, Tootfinder) — a category the 2025 bookmark set
  had essentially nothing for.

## 3. Geospatial: new sources, and the tool that prompted this refresh

- **God's Eye View** (`github.com/bilawalsidhu/gods-eye-view`) — the example you named — is
  in the dataset. It aggregates ADS-B, AIS, orbital elements, earthquakes and public CCTV
  onto a CesiumJS globe, MIT-licensed, most layers keyless. Its repository is still a
  pre-release placeholder as of September 2026, and the entry says so rather than implying
  a shipped product.
- **Velocity** (`github.com/AndrewCTF/velocity`) is arguably the stronger find: a
  self-hosted, keyless multi-domain fusion console (ADS-B + AIS + satellites + quakes +
  GPS-jamming + SAR dark-vessel detection on one globe).
- The **SAR picture shifted structurally**: Sentinel-1A was retired on 29 June 2026 after
  eleven years, with 1C/1D now the operational pair; NASA-ISRO's **NISAR** opened a public
  L-band/S-band archive in July 2026; ESA's cloud-native Zarr (EOPF) format reached early
  access. Net effect: more free all-weather imagery, different plumbing.
- Self-hosted and open alternatives are where the momentum is — a direct consequence of
  section 1.

## 4. The seed corpus had canonical holes

A bookmark tree reflects one person's habits, so an audit against the canonical toolset was
run separately. Fifty staples were **entirely absent**, including:

- **Shodan and Censys** — the corpus contained *no* internet-wide scanning engine at all
  (no ZoomEye, FOFA, Criminal IP, ONYPHE, Netlas or LeakIX either).
- **crt.sh and RDAP** — certificate-transparency search and the modern WHOIS replacement,
  despite several older WHOIS-style tools being bookmarked four times over.
- **Flightradar24 and ADS-B Exchange** — the two flagship flight trackers, while an obscure
  Dutch ADS-B mirror was present.
- **SEC EDGAR and GLEIF** — free, authoritative corporate registries, while a dozen
  national business registers were bookmarked.

These are now listed, each with its current access reality rather than its historical
reputation.

## 5. Australian open data (added on request)

84 Australian entries, with the hazard and spatial layers you asked for:

- **Bushfire** — every state and territory service (NSW RFS, CFA/FFM Victoria, QFD/QFES
  Queensland, SA CFS, DFES WA, TFS Tasmania, NT PFES, ACT ESA) plus national coverage:
  **Digital Earth Australia Hotspots**, **NAFI** (North Australia Fire Information), AFAC.
- **Flood and water** — BoM flood warnings, **Water Data Online**, the **Australian Flood
  Risk Information Portal**, Geoscience Australia flood WMS/WFS services.
- **Weather, climate, earthquake, tsunami** — BoM warnings, GA earthquakes, JATWC tsunami,
  SILO and ACORN-SAT climate series.
- **Spatial and imagery** — Digital Atlas of Australia, ELVIS elevation, DEA open data, and
  every state imagery/cadastre service (SIX Maps, Vicmap, Queensland Globe, Landgate, SA
  Location, LISTmap) plus G-NAF addressing.
- **Registries and records** — data.gov.au, the ABS data API, ABN Lookup, ASIC registers,
  AusTender, AEC transparency, Hansard, Federal Court lists.
- **Infrastructure feeds** — AEMO NEM, TfNSW and PTV GTFS-realtime, Airservices, NSW air
  quality, nbn network status.

Access caveats worth knowing before building on them:

- **SA CFS incidents are CC BY-NC-ND** — non-commercial *and* no-derivatives, materially
  more restrictive than the other states. Recorded in that entry's `licence` field.
- **DFES WA**: the raw dataset needs a free SLIP account plus an annually renewed Esri
  token; only the public map is unrestricted.
- Free API keys or registration: SILO, ABN Lookup, TfNSW, PTV.
- **NationalMap is decommissioned** — the Digital Atlas of Australia replaced it.
- ASIC basic search is free; detailed company extracts are paid.

Six of these sources had moved since the research pass first captured them and were
repaired against the live endpoint: the Queensland bushfire feed now lives on an S3 path
discovered through the data.qld.gov.au CKAN API, and SA CFS moved to a CRIIMSON endpoint.
Both are direct JSON. ASIC's register search, nbn's network status, Capella's open-data
page and the DEA AWS index also moved.

## 6. AI tooling: the 2025 chatbot list aged badly

The seed corpus's "Artificial Intelligence" category was mostly chatbot homepages. What is
actually useful to an investigator now divides cleanly:

- **Traceable and checkable** — GPT Researcher and Open Deep Research (agentic research
  with citations), Picarta (image geolocation), an OSINT MCP server, the **AI Incident
  Database** and **AIAAIC**, **Epoch AI**, and algorithmic-transparency registries such as
  the Dutch Algorithm Register.
- **Popular but heavily caveated** — LMArena measures preference, not correctness;
  Perplexity Deep Research and Vane (formerly Perplexica) still need per-claim checking;
  GPTZero and Hive Moderation are probabilistic and adversarially defeatable.

Detector caveats are recorded rather than smoothed over, because vendor numbers do not
survive contact with compressed real-world media: NVIDIA's own synthetic-video detector
figures fall from 92% to 82% as compression rises, and its documentation frames the tool as
triage, not verdict. Likewise **C2PA signature validity is not scene authenticity** — a
validly signed image can still show a staged scene — and the C2PA trust list has been
frozen since January 2026.

Churn here too: Manus was acquired by Meta in December 2025 and the deal was ordered
unwound by Chinese regulators in April 2026; Yupp shut down in March 2026; Perplexica
became Vane.

## 7. What this refresh deliberately did not do

- **No invented descriptions.** 14 entries remain `unverified` with a null description and
  a note recording what was observed (404, parked, Cloudflare challenge). 93 are `inferred`
  — the page wouldn't load but the tool is well established — and say so.
- **No scope creep into harmful tooling.** Stalkerware, credential-stuffing services,
  combolist and leaked-password resellers and dark-web credential shops were excluded by
  policy. Two grey-area breach-search services widely cited in mainstream security press
  are included with that caveat stated in `notes`.
- **No deletions.** Retired entries stay with a reason, so "did this exist?" remains
  answerable.
- **No trust in a single network's verdict.** 21 entries came back `inconclusive` because
  the checking sandbox would not proxy the host — recorded as inconclusive rather than
  dressed up as a result. Disdex is the clearest case: it resolves fine from the open
  internet and was left listed rather than retired on a local artefact.

## Data-quality corrections found along the way

The bookmark export carried errors this pass caught and recorded:

- A "Guangdong Government Procurement" bookmark actually pointed at **Beijing's** portal.
- A "Hosting Checker" entry pointed at `frontpages.com`, a newspaper front-page aggregator.
- "Kanzhun" is now a dating platform, not the job-review site its title implied.
- A US Copyright Office catalogue was filed under China; an Estonian registry under France.
- Trendsmap no longer does live Twitter trend mapping — it sells 2006-2023 archives.
- Esri's "Terrorist Attacks" StoryMap documents its own 2020 shutdown on the page itself.
- Two FotoForensics entries and several Google-dork URLs were duplicates or not tools at
  all; duplicates by URL are folded with the pairing recorded in `aliasOf`.
- 251 bookmark titles were truncated, numbered or ALL-CAPS country codes and were given
  clean names, with the original preserved in `originalName`.
