FROM node:20-alpine

WORKDIR /app

# Install dependencies with pnpm (via corepack)
COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
  && corepack prepare pnpm@9 --activate \
  && pnpm install --frozen-lockfile --prod

# Copy source
COPY . .

ENV NODE_ENV=production

EXPOSE 8787

CMD ["node", "server.mjs"]
