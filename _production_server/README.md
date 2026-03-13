# CIVIL production deploy (direct SSH upload)

This deploy flow intentionally avoids CI/CD runners.

- Run `python3 _PROD.py`
- Repository is uploaded directly to the production server (`rsync` preferred)
- Then you SSH in and build/run Docker services manually

## Local config files

Store these in this folder:

- `user.txt` → SSH user (example: `andrewnormore`)
- `ssh.txt` → either:
  - full private key content, or
  - path to private key file

Production host/IP no longer comes from `host.txt`.
Set `CIVIL_PROD_HOST` in `.env.production` instead.

## Commands

From repo root:

- `python3 _PROD.py check`
  - verifies remote host connectivity, key paths, docker presence, and service snapshot
- `python3 _PROD.py prep`
  - ensures required remote directories exist:
    - `/Users/andrewnormore/CIVIL`
    - `/Users/andrewnormore/CIVIL_DATA/postgresql`
    - `/Users/andrewnormore/CIVIL_DATA/redis`
    - `/Volumes/CivilData/minio` (if `/Volumes/CivilData` is mounted)
- `python3 _PROD.py`
  - uploads repository to `/Users/andrewnormore/CIVIL`
- `python3 _PROD.py geodata`
  - uploads only required geodata archives (not full repo) and seeds production geodata from vendored local archives (no StatsCan download)
- `python3 _PROD.py ssh`
  - opens SSH shell to host

## Env overrides (optional)

- `CIVIL_PROD_HOST` (required; keep it in `.env.production`)
- `CIVIL_PROD_USER`
- `CIVIL_PROD_PORT` (default `22`)
- `CIVIL_PROD_IDENTITY_FILE`
- `CIVIL_PROD_REMOTE_DIR` (default `/Users/andrewnormore/CIVIL`)
- `CIVIL_PROD_DATA_DIR` (default `/Users/andrewnormore/CIVIL_DATA`)
- `CIVIL_PROD_MINIO_DIR` (default `/Volumes/CivilData/minio`)
- `CIVIL_PROD_PUBLIC_HOST` (default `civilcitizens.ca`)
- `CIVIL_PROD_LARGEFILES_DIR` (default `<repo>/civilcitizens_largefiles/_geodata`)
- `CIVIL_PROD_GEODATA_UPLOAD_REPO` (default off; set `1` to force full repo upload before geodata seed)

## Vendored geodata source

Keep large geodata sources in:

- `civilcitizens_largefiles/_geodata/lcd_000b21a_e.zip`
- `civilcitizens_largefiles/_geodata/lcsd000b21a_e.zip`
- `civilcitizens_largefiles/_geodata/lfsa000b21a_e.zip`

This folder is intentionally gitignored, but deploy upload still sends it to the server so remote seeding can run from local source files.

Run:

- `python3 _PROD.py geodata`

This executes:

- `pnpm --filter @civil/api seed:admin`
- `pnpm --filter @civil/api link:cities-subdivisions`

with `STATSCAN_*_ZIP` env vars pointed at uploaded vendored archives.

## Manual Docker steps after upload

On production host:

1. `cd /Users/andrewnormore/CIVIL/civil`
2. `cat > .env.prod-runtime <<'EOF'\nPOSTGRES_DATA_DIR=/Users/andrewnormore/CIVIL_DATA/postgresql\nREDIS_DATA_DIR=/Users/andrewnormore/CIVIL_DATA/redis\nMINIO_DATA_DIR=/Volumes/CivilData/minio\nEOF`
3. `docker compose --env-file .env.prod-runtime --profile infra up -d --no-recreate postgres redis minio minio-setup`
4. `docker compose --env-file .env.prod-runtime --profile app up -d --build api web worker nginx`
5. `docker compose --env-file .env.prod-runtime ps`

## Notes

- `push_ignore.txt` entries are respected during upload.
- Sensitive local files (`_production_server/ssh.txt`, `user.txt`, legacy `host.txt`, keys) are never uploaded.
- If `rsync` is unavailable locally, deploy falls back to tar-over-SSH.

## Data safety (important)

- Persistent data lives on host bind mounts:
  - `/Users/andrewnormore/CIVIL_DATA/postgresql`
  - `/Users/andrewnormore/CIVIL_DATA/redis`
  - `/Volumes/CivilData/minio`
- Do **not** run `docker compose down -v` in production.
- Do **not** delete the above host directories unless intentionally wiping production data.
- Current deploy flow starts infra with `--no-recreate` to reduce risk of accidental infra churn.
