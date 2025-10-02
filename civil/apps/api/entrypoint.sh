#!/bin/sh
set -e
# Apply Prisma schema to the database on startup (idempotent)
# Set PRISMA_SKIP_PUSH=1 to skip this step.
if [ "${PRISMA_SKIP_PUSH}" != "1" ]; then
  echo "[entrypoint] Applying Prisma schema (db push)..."
  # Prefer Prisma CLI from local node_modules; fallback to npx
  if [ -x ./node_modules/.bin/prisma ]; then
    ./node_modules/.bin/prisma db push --schema ../../packages/db/schema.prisma --skip-generate || {
      echo "[entrypoint] Prisma db push failed" >&2
      exit 1
    }
  else
    npx prisma db push --schema ../../packages/db/schema.prisma --skip-generate || {
      echo "[entrypoint] Prisma db push failed" >&2
      exit 1
    }
  fi
  echo "[entrypoint] Prisma schema applied."
else
  echo "[entrypoint] Skipping Prisma db push (PRISMA_SKIP_PUSH=1)."
fi

if [ -f dist/index.js ]; then
  exec node dist/index.js
elif [ -f dist/src/index.js ]; then
  exec node dist/src/index.js
else
  echo "No build output found in dist/. Did you run 'pnpm --filter @civil/api build'?" >&2
  ls -la dist || true
  exit 1
fi
