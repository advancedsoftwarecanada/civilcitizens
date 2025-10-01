# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker/package.json ./apps/worker/package.json
RUN pnpm -w i --frozen-lockfile || pnpm -w i

FROM deps AS build
ENV NODE_ENV=production
COPY apps/worker ./apps/worker
RUN pnpm --filter @civil/worker build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
EXPOSE 3002
CMD ["node", "apps/worker/dist/index.js"]
