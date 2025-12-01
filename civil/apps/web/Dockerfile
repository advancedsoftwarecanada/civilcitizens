# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --recursive --frozen-lockfile || pnpm install --recursive

FROM deps AS build
ENV NODE_ENV=production
COPY apps/web ./apps/web
RUN pnpm install --filter @civil/web... --prod=false --prefer-offline \
	&& pnpm --filter @civil/shared build \
	&& pnpm --filter @civil/ui build \
	&& pnpm --filter @civil/web build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/web
COPY --from=build /app/apps/web/.next ./.next
COPY --from=build /app/node_modules ../../node_modules
COPY --from=build /app/apps/web/node_modules ./node_modules
COPY --from=build /app/apps/web/public ./public
COPY --from=build /app/packages ../../packages
COPY --from=build /app/apps/web/package.json ./package.json
EXPOSE 3001
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3001"]
