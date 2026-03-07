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
    test -x apps/web/node_modules/.bin/next || pnpm install --frozen-lockfile
    exec pnpm --filter @civil/web dev
  '
