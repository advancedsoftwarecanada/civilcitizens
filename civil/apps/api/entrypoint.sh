#!/bin/sh
set -e
# Apply Prisma schema to the database on startup (idempotent)
# Set PRISMA_SKIP_PUSH=1 to skip this step.
if [ "${PRISMA_SKIP_PUSH}" != "1" ]; then
  echo "[entrypoint] Applying Prisma schema (db push)..."

  run_prisma_push() {
    if [ -x ./node_modules/.bin/prisma ]; then
      ./node_modules/.bin/prisma db push --schema ../../packages/db/schema.prisma --skip-generate --accept-data-loss
      return $?
    fi

    if [ -x ../../node_modules/.bin/prisma ]; then
      ../../node_modules/.bin/prisma db push --schema ../../packages/db/schema.prisma --skip-generate --accept-data-loss
      return $?
    fi

    npx --yes prisma db push --schema ../../packages/db/schema.prisma --skip-generate --accept-data-loss
  }

  MAX_ATTEMPTS=${PRISMA_MAX_RETRIES:-30}
  RETRY_DELAY=${PRISMA_RETRY_DELAY:-5}
  ATTEMPT=1

  while [ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]; do
    if run_prisma_push; then
      echo "[entrypoint] Prisma schema applied."
      break
    fi

    if [ "$ATTEMPT" -eq "$MAX_ATTEMPTS" ]; then
      echo "[entrypoint] Prisma db push failed after ${MAX_ATTEMPTS} attempts" >&2
      exit 1
    fi

    NEXT_ATTEMPT=$((ATTEMPT + 1))
    echo "[entrypoint] Prisma db push failed (attempt ${ATTEMPT}/${MAX_ATTEMPTS}). Retrying in ${RETRY_DELAY}s..."
    ATTEMPT=$NEXT_ATTEMPT
    sleep "$RETRY_DELAY"
  done
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
