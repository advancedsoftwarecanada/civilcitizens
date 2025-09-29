# syntax=docker/dockerfile:1
FROM node:20-bullseye-slim AS base
WORKDIR /app

FROM base AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm -w i --frozen-lockfile || pnpm -w i

FROM deps AS build
COPY apps/api ./apps/api
RUN pnpm --filter @civil/shared build \
	&& pnpm --filter @civil/db generate \
	&& pnpm --filter @civil/db build \
	&& pnpm --filter @civil/api build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/api
RUN apt-get update -y && apt-get install -y --no-install-recommends libssl1.1 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ../../node_modules
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/packages ../../packages
COPY --from=build /app/apps/api/package.json ./package.json
EXPOSE 3000
# Start compiled server (TS outDir places output under dist/src/index.js)
CMD ["node", "dist/src/index.js"]
