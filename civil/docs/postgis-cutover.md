PostGIS Cutover

Goal: bring up a PostGIS-enabled database alongside the old database, migrate and validate against the new target, then cut traffic over and retire the old database.

Dev

1. Bring up the shadow PostGIS database without touching the old dev database:
   python3 _PROD.py shadow-infra-up --env-file .env.dev
2. Point Civil at it without touching the old shared dev database:
   DATABASE_URL=postgresql://postgres:postgres@localhost:NEW_PORT/civil python3 _DEV.py start
3. `_DEV.py` will run `prisma migrate deploy` against the overridden `DATABASE_URL` during startup.
4. Validate API health, the geography route, and the welcome map.
5. Keep the old shared dev database running until you explicitly approve the new GIS path.
6. If you need to back out, switch `DATABASE_URL` back to the old target or the old port.

Compose-based app deploys

1. Bring up the shadow PostGIS database first:
   python3 _PROD.py shadow-infra-up --env-file .env.production
2. Set `DATABASE_URL` in the env file used by compose to the new PostGIS database.
3. Start or rebuild the app stack.
4. Run Prisma migration against the new database.
5. Validate application behavior.
6. Do not shut down the old database until the new GIS database is approved.

Prod

1. Provision a new PostGIS-enabled PostgreSQL target.
2. Restore or replicate data into the new target.
3. Apply migrations, including `20260314143000_add_geospatial_schema`.
4. Change the production `DATABASE_URL` secret to the new target.
5. Roll the API and worker deployments.
6. Validate geospatial endpoints and app health.
7. Retire the old production database only after validation and rollback window completion.

Notes

- Compose now respects an external `DATABASE_URL` override for API and worker.
- Compose now has a dedicated `postgres-gis-shadow` service on `POSTGRES_GIS_HOST_PORT` with its own data volume.
- `python3 _PROD.py shadow-infra-up` starts the shadow database, and `python3 _PROD.py shadow-down` stops only that shadow container without deleting its data volume.
- Kubernetes already reads `DATABASE_URL` from secrets, so the main production cutover is a database/secret rotation problem rather than an application image problem.
- For this repo, the risky part is database cutover timing, not the app code rollout.