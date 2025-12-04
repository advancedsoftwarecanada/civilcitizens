# @civil/api

Fastify API for Civil. Run in dev:

pnpm --filter @civil/api dev

## Data seeding

- `pnpm --filter @civil/api seed:cities` – rebuild GeoNames-based city catalogue.
- `pnpm --filter @civil/api seed:admin` – ingest Statistics Canada census divisions/subdivisions and FSA boundaries.
- `pnpm --filter @civil/api link:cities-subdivisions` – attach each city to its StatsCan census subdivision (and optionally realign chambers to the subdivision default).
- `pnpm --filter @civil/api watch:seed-log -- ../../../seed.log` – optional helper that tails a log file (default `../../..\/seed.log`) and refuses to declare the seeder hung until it has seen zero growth for two consecutive five-minute windows (≈10 minutes total).

The admin seeder downloads three StatsCan archives (CD, CSD, FSA) into `tmp/statscan` unless you override with environment variables:

- `STATSCAN_CD_ZIP`, `STATSCAN_CSD_ZIP`, `STATSCAN_FSA_ZIP` – absolute paths to local zip files if downloads require authenticated sessions.
- `STATSCAN_CACHE_DIR` – alternate cache directory for downloaded archives.
- `ADMIN_SEED_CONCURRENCY` – override default concurrency (4) for chamber matching.
- `STATSCAN_REFERER` – optional referer header if the CDN requires it.
- `CITY_LINK_BBOX_PADDING` – padding (degrees) applied to subdivision bounding boxes when matching cities (default `0.05`).
- `CITY_LINK_LOG_INTERVAL` – how many matches should be processed before printing a progress line (default `250`).

Each run wipes existing `CensusDivision`, `CensusSubdivision`, and `ForwardSortationArea` rows before inserting fresh data, and resets city-to-subdivision links so we can reattach them in a follow-up job.

Recommended order when refreshing datasets:

1. `seed:admin`
2. `seed:cities`
3. `link:cities-subdivisions`
