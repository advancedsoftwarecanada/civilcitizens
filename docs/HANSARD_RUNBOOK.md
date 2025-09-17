## Hansard Ingestion Runbook (Human-Only)

This runbook documents how to ingest Hansard XML into Civil and create posts mapped to chambers. The pipeline is API-based and admin-only.

### Auth
- Provide a Bearer token in the Authorization header using either:
  - Static admin token: set ADMIN_API_TOKEN in environment or Meteor.settings.private.adminApiToken
  - A Meteor login token belonging to an admin user (UserMeta.admin === true)

### Endpoints
1) POST /api/admin/hansard/ingest
   - Purpose: Fetch or accept raw Hansard XML and store a Scrapes document
   - Body (JSON):
     - sourceUrl: string (optional) — remote XML URL to fetch
     - xml: string (optional) — raw XML text; if provided, sourceUrl is optional
   - Response: { status: 'ok', scrapeId, bytes }

2) POST /api/admin/hansard/process
   - Purpose: Parse a stored scrape and create chamber posts, de-duplicated
   - Body (JSON):
     - scrapeId: string — the ID returned from the ingest step
   - Response: { status: 'ok', interventions, created, skipped, errorsCount, errorsSample }

### What it does
- Saves the raw XML to the Scrapes collection: { type: 'hansard.xml', sourceUrl, dataType: 'xml', data, createdAt }
- Parses interventions with fast-xml-parser and searches for typical keys (Intervention, PersonSpeaking, Paragraph, Constituency)
- Normalizes constituency names to match Chambers by seoUrl
- Creates Posts authored by the “Civil” system user (or falls back to any admin)
  - type: 'chamber'
  - chamber: mapped chamber.seoUrl (if found)
  - province: chamber.province or 'ca'
  - jurisdiction: 'federal'
  - title: "{Speaker Name} in the House — {Riding}"
  - body: concatenated paragraphs (original markup if available)
  - tags: ['hansard', '{Speaker Name}']
  - hansardKey: deterministic dedupe key derived from Parliament/Session/Sitting/InterventionId
  - hansardMeta: { ParliamentNumber/Session/Sitting, speaker, party, riding }
- Dedupe: Posts have a unique sparse index on hansardKey. On duplicate key, insert is skipped.
- Chamber stats: increments stats.posts if a chamber was linked.

### Mapping details
- Chambers index is built from existing Chambers, keyed by their seoUrl. Constituency names from XML are normalized to a similar slug for matching.
- If a constituency cannot be matched to a Chamber, the post is still created with jurisdiction='federal' and no chamber linkage.

### Manual checklist (per run)
1) Identify the daily Hansard XML URL (e.g., HoC feed) or prepare the raw XML text.
2) Call /api/admin/hansard/ingest with sourceUrl (or xml) and keep the returned scrapeId.
3) Call /api/admin/hansard/process with that scrapeId.
4) Verify: Review API response created/skipped counts and any errorsSample.
5) Spot-check posts:
   - Confirm author is Civil/Admin
   - Confirm titles, content, mapping to correct Chamber
   - Confirm posts appear above timelines in chamber feeds
6) If mapping misses: update Chamber seoUrls or add better normalization and re-run process on a new scrape.

### Troubleshooting
- 401 Unauthorized: Ensure Authorization header is set with a valid static token or an admin Meteor login token.
- 502 Failed to download XML: Validate sourceUrl, availability, and network.
- xml-parse-failed: Confirm the XML is well-formed; try providing direct XML instead of fetching.
- created=0: The parser may not recognize the intervention shape; share a sample for parser tweaks.

### Notes
- The parser is built to be resilient to common schema variations but can be extended easily if your feed differs.
- Large XML files may take time; consider splitting by day/sitting.
- Posts.hansardKey is sparse and unique to allow safe reprocessing without duplicates.
