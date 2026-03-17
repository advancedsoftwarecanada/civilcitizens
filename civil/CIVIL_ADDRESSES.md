Civil Addresses

Purpose

This document explains how Civil Citizens currently handles addresses, geocoding, postal code corrections, and map attribution.

This file is written for future engineering work and future AI-assisted development. If an agent or developer touches address search, saved addresses, organization addresses, map views, or postal resolution, they should read this first.

Core Principles

- Civil uses a hybrid address system.
- Nominatim is used for address search, autocomplete, and base geocoding.
- Civil stores user-confirmed postal corrections because Nominatim can be wrong for Canadian postal codes.
- Civil should prefer exact coordinates and Civil corrections over raw text-only geocoding whenever possible.
- Manual freeform address entry is not the preferred UX for structured addresses.

Current Architecture

Address Search

- Shared client helper: `apps/web/app/_lib/addressSearch.ts`
- Nominatim search source: `/nominatim/search?...`
- Directions routing source: `/osrm/route/v1/driving/...`
- Main address page: `apps/web/app/addresses/AddressSearchPageClient.tsx`
- Global top-nav results also use the shared address helper.

Structured Address Editing

- Shared editor: `apps/web/app/_components/address/CanadianAddressEditor.tsx`
- Shipping address flow uses that editor via `apps/web/app/market/_components/MarketShippingAddressEditorPageClient.tsx`
- Organization address settings also use that editor.

Saved Address Storage

- Shipping addresses are stored in user `communityMeta.market.shippingAddresses`
- Read/write logic lives in API helpers inside `apps/api/src/index.ts`
- Shipping address routes live in `apps/api/src/routes/marketStorefront.ts`

Postal Corrections

- API route module: `apps/api/src/routes/addressCorrections.ts`
- Registered from: `apps/api/src/index.ts`
- Database model: `AddressCorrection`
- Prisma schema: `packages/db/schema.prisma`
- Migration: `packages/db/migrations/20260316195000_add_address_corrections/migration.sql`
- Audit listing route: `GET /address-corrections` returns remaps with creator metadata and timestamps.

How The Hybrid System Works

Address Selection Flow

1. User searches with a Nominatim-powered search field.
2. User selects a result.
3. Civil stores structured address fields derived from Nominatim.
4. Civil also stores:
   - latitude
   - longitude
   - `nominatimDisplayName`
   - `nominatimRaw`
   - `postalCode`
   - `originalPostalCode`

Postal Correction Flow

1. If the selected address includes a postal code, Civil displays it as an editable field.
2. User can edit the postal code directly.
3. User clicks `Verify Postal` to confirm it for shipping.
4. Civil saves an `AddressCorrection` row keyed by the selected point.
5. Future geocoding results near that point can be overridden by Civil data.

Resolution Order

When Civil resolves postal code data for an address result, the intended priority is:

1. Exact known coordinates already saved by Civil
2. Civil postal correction near those coordinates
3. Raw Nominatim postal code

This matters because Canadian postal codes can vary at a finer level than Civil's current public boundary datasets.

Important Canadian Data Limitation

Civil currently seeds Statistics Canada:

- Census divisions
- Census subdivisions
- Forward sortation areas (FSA)

Civil does not currently seed a full six-character Canadian postal code dataset.

That means Civil's current StatsCan data can distinguish only the first three characters of a postal code area, not the final local delivery unit. In practical terms:

- It can help with region-level matching.
- It cannot independently prove that `L4P 4A8` is correct while `L4P 4A3` is wrong.

Because of that, user-confirmed corrections and saved coordinates are necessary.

AddressCorrection Table

Current fields:

- `id`
- `latitude`
- `longitude`
- `originalPostal`
- `correctedPostal`
- `source`
- `confidenceScore`
- `createdByUserId`
- `pointGeom`
- `createdAt`
- `updatedAt`

Notes:

- `source` is currently `USER` only.
- `pointGeom` exists for PostGIS spatial lookup.
- Radius matching is currently designed around small-distance lookup, roughly `25-50m` territory.

Map Attribution Policy

Civil does not require visible attribution text inside each individual map surface.

Product rule for this repo:

- Map attribution is centralized in the legal credits page.
- Do not re-add map footer attribution to individual map widgets unless product requirements change.

Canonical legal attribution page:

- `apps/web/app/settings/legal/credits/page.tsx`

This page already documents MapLibre and OpenStreetMap attribution. For current Civil product behavior, that legal page is the source of truth.

Future AI / Codex Guidance

If you are an AI agent or future developer working on addresses:

- Do not assume Nominatim postal codes are authoritative in Canada.
- Do not assume the first geocoder result is correct.
- Prefer saved `latitude` and `longitude` whenever Civil already has them.
- Preserve `nominatimRaw` and `originalPostalCode` when editing addresses.
- If you touch address persistence, do not drop correction metadata silently.
- If you add a new address UI, reuse the shared address editor instead of inventing a second address-entry flow.
- If you add a new map, do not automatically add visible attribution text in-map. Check the legal credits policy first.
- If you change map providers or attribution requirements, update `apps/web/app/settings/legal/credits/page.tsx` and then revisit this document.

Near-Term Recommended Direction

- Keep using Nominatim for autocomplete and baseline geocoding.
- Always persist exact coordinates once an address is selected.
- Continue querying Civil corrections after Nominatim resolution.
- Keep routing same-origin through `/osrm` instead of calling the upstream OSRM host directly from the browser.
- Expand correction confidence rules later, but keep the current schema compatible with that future.

Future Work Not Yet Implemented

- Confidence aggregation from multiple users
- Promotion of trusted corrections into a more official postal zone layer
- Full internal Canadian postal dataset
- Stronger deduplication and clustering of corrections by spatial proximity

Operational Notes

- The address correction model requires Prisma migration application before the table exists in a live environment.
- PostGIS-backed radius lookup is preferred when available.
- The route implementation should still fail gracefully if a fallback path is needed.