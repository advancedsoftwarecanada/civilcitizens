# Milestone 1 – Platform Bedrock

> Objective: stand up the shared architecture, schemas, and infrastructure that every other pillar will depend on so subsequent milestones can plug in without rework.

## 1. Architecture Baseline
- **Service topology:** modular monorepo packages for `identity`, `graph`, `geo`, `content`, `market`, `work`, `wallet`, `messaging`, and `notifications`. Each exports typed contracts through shared `packages/shared`.
- **Integration fabric:** Redis Streams (or Kafka substitute) for async fan-out; REST/GraphQL façade in `apps/api`; WebSocket/SSE for realtime pushes.
- **Auth & permissions:** JWT + session refresh, role/flag matrix (user, verified user, org admin, staff mod, super admin). Centralized middleware supplies claims to services.
- **Observability:** structured logging (pino), metrics exporter (Prometheus), tracing hooks (OpenTelemetry) wired at Fastify layer.
- **Environments:** dev (docker-compose), staging, prod. Each environment seeds common fixtures (users, communities, listings) and has Stripe sandbox/test keys configured.

## 2. Shared Schemas (Rough Pass)
| Domain | Key Fields | Notes |
| --- | --- | --- |
| `UserProfile` | `id`, `handle`, `legalName`, `displayName`, `email`, `phone`, `avatarUrl`, `verifiedAt`, `homeCommunityId`, `walletAccountId`, `stripeAccountId`, `privacyFlags`, `createdAt`, `updatedAt` | `verifiedAt` gates wallet + seller privileges. `privacyFlags` toggles friend-only visibility. |
| `Community` | `id`, `provinceCode`, `slug`, `name`, `postalCodes[]`, `latitude`, `longitude`, `population`, `nearbyCommunityIds`, `autoEnroll`, `meta` | Derived from StatsCan data. `meta` stores council contacts, defaults. |
| `LedgerEntry` | `id`, `debitAccountId`, `creditAccountId`, `amount`, `currency`, `referenceType`, `referenceId`, `status`, `metadata`, `createdAt` | Double-entry enforced; links to orders, gigs, payouts via reference fields. |
| `ListingOrder` | `id`, `listingId`, `buyerId`, `sellerId`, `status`, `amount`, `currency`, `deliveryType`, `deliveryGigId`, `escrowLedgerEntryId`, `metadata` | Status: `pending`, `funded`, `fulfilled`, `disputed`, `refunded`. |
| `JobPosting` | `id`, `orgId`, `title`, `type` (job/contract/gig), `compensation`, `location`, `remote`, `description`, `requirements`, `status`, `applications[]` | Delivery gigs reuse this schema with `type=gig` + `originOrderId`. |
| `MessageThread` | `id`, `threadType`, `participantIds[]`, `contextRef`, `lastMessageAt`, `settings` | `contextRef` links to order, job, event, etc. |
| `Event` | `id`, `communityId`, `organizerId`, `title`, `description`, `startAt`, `endAt`, `location`, `capacity`, `ticketType`, `price`, `visibility`, `metadata` | Ticketing integrates with wallet holds in later milestones. |

Schemas live in `packages/shared/src/schema` with Zod + Prisma alignment. Rough pass focuses on minimal required fields; future refinements can extend metadata.

## 3. Infra + Services to Stand Up
1. **Identity Service**
   - User CRUD, verification flags, Stripe Connect onboarding placeholders.
   - Seed script for baseline users + admins.
2. **Graph Service**
   - Friend edges, follows, blocks, organization memberships (data only—functional logic arrives in Milestone 2).
3. **Geo Service**
   - Import StatsCan communities, maintain postal code index, expose proximity lookup API.
4. **Content Service**
   - Canonical post object with scopes (`friends`, `community`, `global`), attachments referencing existing media service.
5. **Messaging Service Skeleton**
   - Thread + message persistence, event hooks to notifications (UI plumbing later).
6. **Wallet Ledger Skeleton**
   - Account table, ledger entries, sanity checks, Stripe sandbox keys stored, but money flows mocked until Milestone 6.
7. **Notifications Hub**
   - Topic registry (friends, community, market, wallet), SSE + push fan-out skeleton.
8. **Analytics & Audit**
   - Event ingestion (Kafka/Redis stream to ClickHouse/Snowflake target), audit log writer for privileged actions.

## 4. Deliverables Checklist
- [ ] Architecture diagram in `docs/architecture/overview.drawio` (or text equivalent) showing services + message bus.
- [ ] Zod + Prisma schema definitions for entities listed above.
- [ ] Seeder scripts: `pnpm db:seed` populates users, communities, sample listings, sample jobs.
- [ ] Configured Redis/Kafka, Postgres migrations for new tables, env var templates updated (`.env.example`).
- [ ] Stripe sandbox keys configured (Connect platform, client IDs). Onboarding stub endpoint returning fake account IDs.
- [ ] Monitoring stack deployed (Prometheus + Grafana dashboards seeded).
- [ ] Documentation pages: `docs/milestone-1-plan.md` (this file) plus `docs/schemas/*.md` describing contracts.

## 5. Acceptance Criteria
- Repo compiles with new modules and migrations.
- Dev environment bootstraps with seeded users + communities.
- API exposes stub endpoints for identity, graph, geo, content, messaging, wallet ledger (even if they return placeholder data).
- Event bus online with sample event (`user.created`) flowing through to notifications + analytics consumer.
- Stripe sandbox connectivity verified (test call to create Connect account + PaymentIntent in test mode).

## 6. Next Steps After Completion
- Move to Milestone 2 (Friends & Messaging) using the services provisioned here.
- Begin writing integration tests for friend graph + messaging once skeletons verified.
- Plan data backfill/migration strategy from existing production tables into new schemas.
