# syntax=docker/dockerfile:1
FROM node:20-bullseye-slim AS base
WORKDIR /app

FROM base AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --recursive --no-frozen-lockfile

FROM deps AS build
COPY apps/api ./apps/api
RUN pnpm install --filter @civil/api... --prod=false --prefer-offline \
	&& pnpm --filter @civil/shared build \
	&& pnpm --filter @civil/db generate \
	&& pnpm --filter @civil/db build \
	&& pnpm --filter @civil/api build

FROM base AS runtime
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app/apps/api
RUN apt-get update -y \
	&& apt-get install -y --no-install-recommends libssl1.1 \
	&& npm install -g prisma@5.18.0 \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ../../node_modules
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/packages ../../packages
COPY --from=build /app/apps/api/package.json ./package.json
COPY apps/web/public/datasets ../../apps/web/public/datasets
RUN ./node_modules/.bin/playwright install --with-deps chromium \
	&& rm -rf /var/lib/apt/lists/*
EXPOSE 3000
# Add a resilient entrypoint that tries dist/index.js then dist/src/index.js
COPY apps/api/entrypoint.sh ./entrypoint.sh
RUN sed -i 's/\r$//' ./entrypoint.sh \
	&& chmod +x ./entrypoint.sh
CMD ["sh", "./entrypoint.sh"]
