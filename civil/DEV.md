# Civil dev stack (hot reload)

This override runs web (Next.js) and api (Fastify) in dev mode with bind mounts and file watching for hot reload.

## Start infra + dev app stack

```bash
cd civil

# Bring up DB/Redis (infra profile) once
docker compose --profile infra up -d postgres redis

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
