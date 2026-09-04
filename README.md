# Civil

Civil is an operating system for humanity.

It is a social, civic, commercial, and economic network for real communities: citizens, politics, businesses, jobs, markets, families, friends, maps, media, meetings, and local governance in one place.

The public promise is simple: community, commerce, careers, and governance should not live in separate silos. A city is already a network. Civil gives that network software.

Visit the Canadian landing page: https://www.civilcitizens.ca/

Explore the civic platform site: https://civilcitizenscanada.ca/

## What Civil Is

Civil is built around the everyday systems that make a society work:

- Citizens: profiles, feeds, posts, comments, replies, follows, relationships, families, notifications, and messaging.
- Politics: federal representatives, parties, civic posts, community governance, causes, topics, organizations, and local democratic discovery.
- Policy: public platform pages, civic research, federal party source pulls, and economic policy work that can be discussed, improved, and shipped in public.
- Business: organizations, storefronts, directories, jobs, services, payments, shipping addresses, listings, and local commerce.
- Economy: marketplace flows, business memberships, billing, delivery, ride requests, driver workflows, contracts, and operational tools.
- Friends: personal networks, direct messages, calls, live spaces, meetings, invitations, and community presence.
- Maps: Canadian address normalization, geospatial districts, OpenStreetMap-backed search, routing, tiles, and location-aware civic experiences.
- Media: image/video upload, optimized public media, short-form content, podcasts, live rooms, mobile push, web push, and notification sound packs.

The ambition is large, but the code is ordinary in the best way: a TypeScript monorepo, Docker services, Postgres/PostGIS, Redis, S3-compatible media storage, and a Next.js app.

## Repository

```text
civilcitizens/
  _DEV.py                         local development process manager
  _PROD.py                        production Docker runner
  docker_helper.py                 shared Docker helper commands
  .env.dev.example                 local dev environment template
  .env.production.example          production environment template
  .env.production.googlecloud.example
  civil/
    apps/
      web/                         Next.js web app
      api/                         Fastify API
      worker/                      background workers
    packages/
      db/                          Prisma schema, migrations, generated client
      shared/                      shared schemas and utilities
      ui/                          UI package
    docker-compose.yml             app, infra, push, meeting, TURN services
    docker-compose.maps.yml        TileServer GL, OSRM, Nominatim
    ops/nginx.conf                 production nginx routing
  builds/
    meetings/rtc-service/          WebRTC meeting signaling service
    maps/nominatim-restore/        Nominatim restore/import container
    mobile/                        Android/iOS Capacitor builds and docs
    push/apns-service/             APNs/FCM push sender
```

## Tech Stack

- Web: Next.js, React, TypeScript, TailwindCSS, TanStack Query, Zustand.
- API: Node.js, Fastify, TypeScript, Zod, Pino.
- Data: PostgreSQL 16 with PostGIS, Prisma, Redis, BullMQ.
- Media: MinIO or any S3-compatible object store.
- Maps: OpenStreetMap data, TileServer GL, OSRM, Nominatim, MapLibre clients.
- Realtime: server-sent events for notifications, Redis pub/sub fanout, WebRTC signaling for meetings.
- Mobile: Capacitor, Android, iOS, APNs, FCM.
- Payments: Stripe billing and product pricing hooks.
- Infra: Docker Compose, nginx, coturn for STUN/TURN relay.

## Requirements

- Docker and Docker Compose
- Node.js 20+
- pnpm 9+
- Python 3.10+
- Enough disk for map data if running the map stack locally. Canada-wide OSM, routing, and geocoder data can be large.

## Quick Start

Clone the repo and install JavaScript dependencies:

```bash
git clone https://github.com/advancedsoftwarecanada/civilcitizens.git
cd civilcitizens/civil
corepack enable
pnpm install
```

Create local env files from the templates:

```bash
cd ..
cp .env.dev.example .env.dev
cp .env.production.example .env.production
```

For a normal local Docker run:

```bash
python3 _PROD.py infra-up --env-file .env.dev
python3 _PROD.py up --env-file .env.dev
```

For the host-managed hot-reload developer loop:

```bash
python3 _DEV.py start
python3 _DEV.py status
python3 _DEV.py logs 100
```

The local stack uses:

- Web app through nginx
- API through `/api`
- Postgres/PostGIS for durable data
- Redis for queues, caching, rate limits, and fanout
- MinIO for local media
- Worker, push service, meeting RTC service, and TURN relay when the app profile is running

## Environment Files

Real environment files are intentionally ignored. Keep secrets local and use examples as templates:

```text
.env.dev.example
.env.production.example
.env.production.googlecloud.example
civil/packages/db/.env.example
builds/mobile/capacitor/android/app/google-services.example.json
```

Important production values usually include:

- `DATABASE_URL`
- `JWT_SECRET`
- `WORKER_INTERNAL_SECRET`
- `MEDIA_S3_*`
- `STRIPE_*`
- `CIVIL_AI_*`
- `CIVIL_ADMIN_EMAILS`
- `NEXT_PUBLIC_CIVIL_ADMIN_EMAILS`
- `VAPID_*`
- `PUSH_*`
- `APNS_*`
- `FCM_*`
- `MEETING_RTC_*`
- `TURN_*`
- `MAP_TILE_SERVER`
- `OSRM_SERVER`
- `NOMINATIM_SERVER`

The helper writes `civil/packages/db/.env` locally for Prisma CLI compatibility. Do not commit it.

## Database

Generate Prisma and apply migrations:

```bash
cd civil
pnpm --filter @civil/db generate
pnpm --filter @civil/db prisma migrate deploy
```

For development migration work:

```bash
cd civil
pnpm migrate:dev
```

Test safety: destructive tests should target a database whose name contains `test`, such as `civil_test`.

## OpenStreetMap Data

Civil can run without a local map stack by pointing `MAP_TILE_SERVER`, `OSRM_SERVER`, and `NOMINATIM_SERVER` at an existing trusted service. To self-host the full Canadian map stack, prepare three data areas:

```bash
mkdir -p /mnt/osm/incoming/civil-maps/data
mkdir -p /mnt/osm/incoming/civil-maps/osrm
mkdir -p /mnt/osm/incoming/nominatim/input
mkdir -p /mnt/osm/incoming/nominatim/postgres
mkdir -p /mnt/osm/incoming/nominatim/flatnode
```

Download the Canada OpenStreetMap extract:

```bash
cd /mnt/osm/incoming/nominatim/input
curl -L -o canada-latest.osm.pbf https://download.geofabrik.de/north-america/canada-latest.osm.pbf
```

### TileServer GL

TileServer GL expects an MBTiles file named `canada.mbtiles`:

```text
/mnt/osm/incoming/civil-maps/data/canada.mbtiles
```

You can generate MBTiles with your preferred OpenStreetMap tile pipeline, or provide a compatible Canada extract from your existing map build process. Once the file exists:

```bash
python3 _PROD.py maps-up --env-file .env.production
```

### OSRM Routing

Build routing data from the Canada PBF:

```bash
mkdir -p /mnt/osm/incoming/civil-maps/osrm
cp /mnt/osm/incoming/nominatim/input/canada-latest.osm.pbf /mnt/osm/incoming/civil-maps/osrm/
cd /mnt/osm/incoming/civil-maps/osrm

docker run --rm -t -v "$PWD:/data" osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/canada-latest.osm.pbf

docker run --rm -t -v "$PWD:/data" osrm/osrm-backend \
  osrm-partition /data/canada-latest.osrm

docker run --rm -t -v "$PWD:/data" osrm/osrm-backend \
  osrm-customize /data/canada-latest.osrm

date -u +"%Y-%m-%dT%H:%M:%SZ" > canada-latest.osrm.timestamp
```

Then start the map core:

```bash
python3 _PROD.py maps-up --env-file .env.production
```

### Nominatim Search

Civil's Nominatim container prefers restoring from a prepared base backup:

```text
/mnt/osm/incoming/nominatim/postgres/
```

For a first import from the PBF, set this in your env file:

```bash
NOMINATIM_ALLOW_FRESH_IMPORT=true
NOMINATIM_HEALTHCHECK_START_PERIOD=6h
```

Then run:

```bash
python3 _PROD.py nominatim-up --env-file .env.production
```

Fresh Nominatim imports are slow and resource-intensive. For repeat deploys, keep a base backup and leave `NOMINATIM_ALLOW_FRESH_IMPORT=false`.

## Production

Production is Docker Compose driven. The runner preserves stateful infra by default and rebuilds/restarts app containers:

```bash
python3 _PROD.py --env-file .env.production
```

Useful production commands:

```bash
python3 _PROD.py status --env-file .env.production
python3 _PROD.py logs --env-file .env.production
python3 _PROD.py build --env-file .env.production
python3 _PROD.py deploy --env-file .env.production
python3 _PROD.py maps-up --env-file .env.production
python3 _PROD.py nominatim-up --env-file .env.production
python3 _PROD.py prune-docker --env-file .env.production
```

Do not run `down-all` or `docker compose down -v` against production unless you intend to remove persistent volumes.

## AI Configuration

Civil AI server metadata lives in:

```text
civil/ai_servers.json
civil/ai_servers.dev.json
civil/ai_servers.production.json
civil/CIVIL_AI.md
```

Secrets do not belong in those files. Put provider keys in environment variables:

```bash
CIVIL_AI_BASE_URL=
CIVIL_AI_PROVIDER=azure-openai
CIVIL_AI_MODEL=
CIVIL_AI_API_VERSION=
CIVIL_AI_API_KEY=
```

## Mobile And Push

Mobile lives under `builds/mobile/` and uses Capacitor for Android and iOS.

For Android Firebase config:

```bash
cp builds/mobile/capacitor/android/app/google-services.example.json \
  builds/mobile/capacitor/android/app/google-services.json
```

For APNs/FCM sender setup, read:

```text
builds/mobile/PUSH_NOTIFICATIONS.md
builds/push/apns-service/README.md
```

Signing keys, APNs keys, Firebase service account JSON, and generated release artifacts should stay out of Git unless intentionally published.

## Security Notes

This repository is prepared for open-source development with local env files and signing material ignored. Before running a public production deployment:

- Rotate secrets that ever lived outside a secrets manager.
- Keep `.env.*`, APNs keys, Firebase service accounts, deploy SSH keys, and signing keys private.
- Use strong `JWT_SECRET`, `WORKER_INTERNAL_SECRET`, `PUSH_*`, `MEETING_RTC_*`, and `TURN_*` values.
- Review `civil/ops/nginx.conf` for domain-specific routing before reusing it.
- Keep OpenStreetMap attribution visible in map clients.

## Contributing

Civil is big because society is big. The right contribution can be a bug fix, a migration, a civic data import, a design cleanup, a map pipeline improvement, a local business workflow, or a safer governance primitive.

Start by getting the stack running, pick one surface, and make it better for real people.