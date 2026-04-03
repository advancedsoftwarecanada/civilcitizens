# Civil dev stack (hot reload)

This override runs web (Next.js) and api (Fastify) in dev mode with bind mounts and file watching for hot reload.

## Shared dev infra vs test infra

- `_DEV.py` points the app at CybertronDev Postgres and Redis for normal local development.
- `_DEV.py` now brings up a local edge nginx container for `dev.civilcitizens.ca` using [../ops/dev-edge-proxy.compose.yml](../ops/dev-edge-proxy.compose.yml) and [../ops/dev.civilcitizens.ca.nginx.conf](../ops/dev.civilcitizens.ca.nginx.conf).
- Treat that `civil` database as persistent shared dev state.
- Destructive API tests must use a dedicated test database such as `civil_test`.
- `pnpm --filter @civil/api test` now rewrites `DATABASE_URL` to a safe test target automatically.
- Override with `API_TEST_DATABASE_URL=postgresql://.../civil_test` if you need a different test database.

## Start infra + dev app stack

```bash
cd civil

# Bring up DB/Redis/MinIO (infra profile) once
docker compose --profile infra up -d postgres redis minio minio-setup

# Start dev-mode web+api (+ nginx) from the app profile using overrides
docker compose --profile app up -d nginx web api
```

Notes:
- `docker-compose.override.yml` replaces the build images for `web` and `api` with node:20-alpine running dev scripts.
- The repo is bind-mounted into `/app`, and pnpm install runs in the container, enabling hot reload.
- For file watching in Docker on Linux/Mac, CHOKIDAR_USEPOLLING and WATCHPACK_POLLING are enabled.

## Stop dev stack

```bash
docker compose --profile app down
```

## Switch back to production images

```bash
# Stop dev stack
docker compose --profile app down

# Build production images and start
docker compose --profile app build
docker compose --profile app up -d
```

## Troubleshooting
- If web isn’t hot reloading, open DevTools and force a hard refresh (Cmd/Ctrl+Shift+R).
- If you see old UI, Cloudflare might be caching. Use Development Mode or purge cache.
- If pnpm install is slow on first run, it’s populating the container cache. Subsequent runs are fast.
- If MinIO fails to start because the console ports are busy, adjust `MINIO_HOST_PORT` / `MINIO_CONSOLE_HOST_PORT` in your `.env.dev`.

## Media storage (MinIO)

- Defaults:
	- Access key / secret: `MEDIA_S3_ACCESS_KEY` / `MEDIA_S3_SECRET_KEY` (both default to `minioadmin`).
	- Buckets: `MEDIA_BUCKET_ORIGINAL` (`civil-media-raw`) for unprocessed files and `MEDIA_BUCKET_PUBLIC` (`civil-media`) for optimized assets.
	- Public base URL: `MEDIA_PUBLIC_BASE_URL` (defaults to `http://localhost:9000/civil-media`).
- `minio-setup` runs once per `docker compose up` to create buckets if they don’t exist. Safe to re-run.
- Visit `http://localhost:9001` to access the MinIO console (use the same access key/secret).
