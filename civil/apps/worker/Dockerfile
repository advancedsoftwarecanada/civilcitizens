# syntax=docker/dockerfile:1
FROM node:20-bullseye-slim AS base
WORKDIR /app

FROM base AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
RUN apt-get update -y \
	&& apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/worker/package.json ./apps/worker/package.json
RUN pnpm install --recursive --frozen-lockfile || pnpm install --recursive

FROM deps AS build
ENV NODE_ENV=production
COPY apps/worker ./apps/worker
RUN pnpm install --filter @civil/worker... --prod=false --prefer-offline \
	&& pnpm --filter @civil/db generate \
	&& pnpm --filter @civil/db build \
	&& pnpm --filter @civil/worker build

FROM base AS runtime
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
RUN ./apps/worker/node_modules/.bin/playwright install --with-deps chromium \
	&& rm -rf /var/lib/apt/lists/*
EXPOSE 3002
CMD ["node", "apps/worker/dist/apps/worker/src/index.js"]
