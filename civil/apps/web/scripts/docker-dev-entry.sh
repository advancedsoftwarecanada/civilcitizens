#!/bin/sh
set -eu

APP_ROOT=/workspace/civil
WEB_ROOT="$APP_ROOT/apps/web"
DOCKER_HOME="$APP_ROOT/.docker-home"
CACHE_HOME="$DOCKER_HOME/.cache"
COREPACK_HOME="$DOCKER_HOME/.corepack"
PNPM_STORE_DIR="$DOCKER_HOME/.pnpm-store"
NPM_CACHE_DIR="$DOCKER_HOME/.npm"
PNPM_HOME_DIR="$DOCKER_HOME/.local/share/pnpm"

mkdir -p \
  "$DOCKER_HOME" \
  "$CACHE_HOME" \
  "$COREPACK_HOME" \
  "$PNPM_STORE_DIR" \
  "$NPM_CACHE_DIR" \
  "$PNPM_HOME_DIR" \
  "$APP_ROOT/node_modules" \
  "$WEB_ROOT/node_modules" \
  "$WEB_ROOT/.next"

chown -R node:node \
  "$DOCKER_HOME" \
  "$APP_ROOT/node_modules" \
  "$WEB_ROOT/node_modules" \
  "$WEB_ROOT/.next"

corepack enable

exec runuser -u node -- env \
  HOME="$DOCKER_HOME" \
  XDG_CACHE_HOME="$CACHE_HOME" \
  COREPACK_HOME="$COREPACK_HOME" \
  PNPM_HOME="$PNPM_HOME_DIR" \
  PNPM_STORE_DIR="$PNPM_STORE_DIR" \
  npm_config_cache="$NPM_CACHE_DIR" \
  NEXT_TELEMETRY_DISABLED="${NEXT_TELEMETRY_DISABLED:-1}" \
  CIVIL_WEB_PORT="${CIVIL_WEB_PORT:-3001}" \
  sh -lc '
    cd /workspace/civil
    install_stamp=".docker-home/.pnpm-install.stamp"
    set -- $( { cksum pnpm-lock.yaml package.json apps/web/package.json 2>/dev/null || true; } | cksum )
    manifest_fingerprint="$1:$2"
    current_fingerprint="$(cat "$install_stamp" 2>/dev/null || true)"

    if [ ! -x apps/web/node_modules/.bin/next ] || [ "$manifest_fingerprint" != "$current_fingerprint" ]; then
      pnpm install --frozen-lockfile
      printf "%s\n" "$manifest_fingerprint" > "$install_stamp"
    fi

    exec pnpm --filter @civil/web dev
  '
