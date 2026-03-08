Civil

A modern social app focused on fast feeds, clean APIs, and SEO friendly pages.

## Goals

- Simple to run on one server with Docker
- Fast API reads with Redis caching
- Durable writes in Postgres
- SEO friendly web using Next.js
- Real time enough via SSE without sockets

## Tech Stack

### Frontend

- Next.js 14 with React 18 and TypeScript
- TanStack Query v5 for API data and caching
- Zustand for local UI state
- TailwindCSS
- Next Image for responsive media
- Optional: Capacitor for mobile wrapper

### Backend

- Node.js 20 with TypeScript
- Fastify 5
- Prisma 5
- Postgres 16 authoritative store
- Redis 7 cache, rate limits, fan out
- BullMQ for background jobs
- Zod for validation
- Pino for logs

### Transport

- HTTP REST for CRUD
- SSE endpoint for notifications and light presence
- Redis Pub Sub for cross instance fan out

## Monorepo layout

```
apps/
  web/            # Next.js site
  api/            # Fastify REST and SSE
  worker/         # BullMQ consumers
packages/
  db/             # Prisma schema and client
  shared/         # shared types, zod schemas, utilities
  ui/             # design system components
```

## Environment variables

Create .env files in apps/api and apps/web.

```
# shared
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/civil
REDIS_URL=redis://redis:6379

# api
PORT=3000
JWT_SECRET=replace_me
SSE_ORIGIN=http://localhost:3000

# web
NEXT_PUBLIC_API_BASE=http://localhost:3000
```

## Test safety

- Do not run destructive API tests against the shared dev database named `civil`.
- The default API test command rewrites `DATABASE_URL` to `civil_test`.
- If you need a custom test database, set `API_TEST_DATABASE_URL` to a database name containing `test`.

## Database model (Prisma snippet)

`packages/db/schema.prisma` (core tables only)

```
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  handle       String   @unique
  name         String?
  bio          String?  @db.Text
  avatarUrl    String?
  createdAt    DateTime @default(now())
  posts        Post[]
  comments     Comment[]
  likes        Like[]
}

model Post {
  id          String    @id @default(cuid())
  authorId    String
  author      User      @relation(fields: [authorId], references: [id])
  body        String    @db.Text
  mediaUrl    String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  comments    Comment[]
  likes       Like[]
  hashtags    PostHashtag[]
  @@index([authorId, createdAt])
}

model Comment {
  id        String   @id @default(cuid())
  postId    String
  userId    String
  body      String   @db.Text
  createdAt DateTime @default(now())
  post      Post     @relation(fields: [postId], references: [id])
  user      User     @relation(fields: [userId], references: [id])
  @@index([postId, createdAt])
}

model Like {
  userId  String
  postId  String
  user    User   @relation(fields: [userId], references: [id])
  post    Post   @relation(fields: [postId], references: [id])
  createdAt DateTime @default(now())
  @@id([userId, postId])
  @@index([postId])
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  type      String   // like, comment, follow (community/org), repost
  actorId   String
  postId    String?
  readAt    DateTime?
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
}

model FeedEntry {
  // materialized home feed row
  userId    String
  postId    String
  createdAt DateTime @default(now())
  @@id([userId, postId])
  @@index([userId, createdAt])
}

model Hashtag {
  tag       String   @id
  createdAt DateTime @default(now())
}

model PostHashtag {
  postId String
  tag    String
  post   Post    @relation(fields: [postId], references: [id])
  hash   Hashtag @relation(fields: [tag], references: [tag])
  @@id([postId, tag])
  @@index([tag])
}
```

## Redis keys

- `user:{id}` JSON profile snapshot, ttl 15 minutes
- `post:{id}` denormalized post JSON, ttl 15 minutes
- `count:post:{id}` hash with likes and comments, ttl 60 seconds
- `timeline:{userId}:{cursor}` a page of post ids, ttl 60 seconds
- `notif:unread:{userId}` integer
- `rl:createPost:{userId}` rate limit token bucket
- Pub sub channel `chan:notify:{userId}` for instant nudges to SSE processes

## API endpoints

All JSON. Zod validated. Examples only.

- POST `/auth/email` start magic link
- POST `/auth/consume` complete session
- GET `/users/:handle` public profile
- POST `/posts` create post
- GET `/posts/:id`
- POST `/posts/:id/like` idempotent like
- POST `/posts/:id/unlike`
- POST `/posts/:id/comment`
- GET `/feed?cursor=...`
- GET `/notifications?cursor=...`
- GET `/notifications/stream` SSE for live notifications

## Typical request flows

### Create post

1. Validate input
2. Insert Post and PostHashtag in a transaction
3. Enqueue fan out job to create FeedEntry rows for relevant feeds (friends, connections, communities, organizations)
4. Invalidate `timeline:{userId}:*` keys that cache affected feeds
5. Update counters in Redis and emit small SSE events to online users

### Like post

1. Insert Like if not exists
2. Increment `count:post:{id}` or delete key to force refresh
3. Insert Notification and increment `notif:unread:{authorId}`
4. Emit SSE to the author if connected

### Home feed

1. Try `timeline:{userId}:{cursor}`
2. On miss, SQL to fetch recent posts by feed membership (friends, connections, community/org follows), hydrate Redis, return page

### SSE usage

- Endpoint `GET /notifications/stream`
- One event stream per user session
- Keep events tiny, include ids not large payloads
- Reconnect with last event id for at least once semantics

### Rate limits

- Token bucket in Redis with short ttl
- `rl:createPost:{userId}` for posting
- `rl:like:{userId}:{postId}` for likes
- Return 429 with retry after on limit

### Logging and metrics

- Pino structured logs to stdout
- Health endpoint `/health`
- Basic RED metrics: request rate, errors, duration
- Optional Prometheus exporter later

## Local development

Requires Docker and Node 20.

```
pnpm i

# boot services
docker compose up -d

# generate Prisma client and migrate
pnpm -w prisma generate
pnpm -w prisma migrate dev

# start API
pnpm --filter @civil/api dev

# start Web
pnpm --filter @civil/web dev

# optional: start worker
pnpm --filter @civil/worker dev
```

### Environment Variables

Copy the appropriate environment example file from the repository root:

```bash
# For development
cp .env.dev.example .env.dev

# For production
cp .env.production.example .env.production
```

#### Google Analytics

To enable Google Analytics tracking, set `NEXT_PUBLIC_GTAG_ID` in your environment file:

- **Production**: Set to your Google Analytics tag ID (e.g., `G-1ML0TFH7F0`)
- **Development**: Leave empty to disable Google Analytics tracking

The Google Analytics scripts will only load when `NEXT_PUBLIC_GTAG_ID` is configured.

## Docker Compose

`docker-compose.yml`

```
version: "3.9"
services:
  nginx:
    image: nginx:1.25-alpine
    volumes:
      - ./ops/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    ports:
      - "80:80"
    depends_on: [api]

  api:
    build:
      context: .
      dockerfile: ./apps/api/Dockerfile
    env_file: ./apps/api/.env
    ports:
      - "3000:3000"
    depends_on: [postgres, redis]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 10s
      timeout: 2s
      retries: 5

  worker:
    build:
      context: .
      dockerfile: ./apps/worker/Dockerfile
    env_file: ./apps/api/.env
    depends_on: [redis, postgres]

  web:
    build:
      context: .
      dockerfile: ./apps/web/Dockerfile
    env_file: ./apps/web/.env
    environment:
      NEXT_PUBLIC_API_BASE: http://localhost:3000
    depends_on: [api]

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: civil
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec"]
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

## ops/nginx.conf

```
server {
  listen 80;
  server_name _;

  # web at /
  location / {
    proxy_pass http://web:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  # api at /api
  location /api/ {
    proxy_pass http://api:3000/;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## Migrations and seeding

```
pnpm -w prisma migrate dev
pnpm --filter @civil/api tsx scripts/seed.ts
```

## Testing

- Unit tests with Vitest
- API tests with supertest
- Web tests with Playwright

```
pnpm test
pnpm --filter @civil/web test:e2e
```

## Security notes

- HTTP only secure cookies or short lived JWT with rotation
- Zod input validation on every route
- CORS restricted to expected origins
- Image uploads scanned and validated
- Do not trust counts from Redis for payments or billing

## Backups

- Nightly pg_dump to off box storage
- Redis is append only. Treat it as cache. Do not rely on it for the only copy of data

## Scale plan

### Phase one

- Single VM, compose as above, managed Postgres and Redis preferred

### Phase two

- Two API replicas and one worker replica behind a load balancer
- PgBouncer in front of Postgres
- Cloud storage and CDN for media

### Phase three

- Kubernetes for stateless API, Web, and Worker with rolling deploys
- Read replicas for Postgres
- Dedicated search service if needed
