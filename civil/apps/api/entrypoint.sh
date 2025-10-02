#!/bin/sh
set -e
if [ -f dist/index.js ]; then
  exec node dist/index.js
elif [ -f dist/src/index.js ]; then
  exec node dist/src/index.js
else
  echo "No build output found in dist/. Did you run 'pnpm --filter @civil/api build'?" >&2
  ls -la dist || true
  exit 1
fi
