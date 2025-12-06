# Milestone 2 – Friends & Messaging

> Objective: deliver the private social core — trusted friend graph, zero-noise feed, and direct messaging — using the bedrock services from Milestone 1.

## 1. Scope Overview
- **Friend Graph Expansion:** request/accept/block flows, friend suggestions, graph events for analytics.
- **Friend Feed:** strictly friend-generated posts with ranking, mute/snooze controls, and notification loops.
- **Messaging MVP:** 1:1 and small group chats, media attachments, typing/read indicators, moderation hooks.
- **Trust & Safety:** reporting, rate limits, anti-spam heuristics, audit logging for staff actions.

## 2. Key Components
1. **Friendship Service**
   - Endpoints: send request, accept, decline, cancel, block/unblock.
   - Background jobs to recompute mutual connections and suggestions.
   - Event emission (`friendship.accepted`) for feed + notifications.
2. **Friend Feed Service**
   - Ranking inputs: recency, interaction affinity, post type, mute states.
   - Filtering: exclude org/market posts, hide reported content, throttle prolific posters.
   - Delivery: API endpoint + SSE channel for live updates.
3. **Messaging Service**
   - Thread creation rules (friendship required by default, with override for staff).
   - Message persistence, attachments via existing media upload pipeline.
   - Presence indicators using Redis pub/sub; message receipts stored for clients.
4. **Notification + Email**
   - Templates for friend requests, accepts, message mentions, unread digests.
   - Push tokens registry + throttling.
5. **Moderation Tools**
   - Staff dashboard to inspect relationships, mute abusive accounts, trace reports.
   - Automated spam detection (suspicious link sharing, velocity triggers).

## 3. Deliverables Checklist
- [ ] Prisma migrations + Zod models for friendship edges, message threads, messages, mute lists.
- [ ] REST/GraphQL routes documented in `docs/api/friends-and-messaging.md`.
- [ ] Friend feed ranking service with tunable weights stored in config.
- [ ] Messaging WebSocket/SSE gateway with auth + rate limiting.
- [ ] Notifications wired: push, email, in-app badges.
- [ ] Staff moderation UI (even if barebones) to view reports, block users, and audit logs.
- [ ] Integration tests covering request lifecycle, message delivery, feed ranking sanity.

## 4. Acceptance Criteria
- Two test users can send/accept friend requests, appear in each other’s friend-only feed, and exchange messages in realtime.
- Mutes/blocks immediately remove posts/messages from surfaces.
- Report button in messaging + feed creates moderation tickets visible to staff UI.
- Notifications triggered for friend actions and unread messages (push + email in sandbox).
- Load test shows feed + messaging hold up to baseline throughput (define TPS target) without regressions.

## 5. Dependencies & Notes
- Depends on Milestone 1 identity/graph scaffolding, media service, notification hub.
- Messaging to reuse ledger/audit logging for compliance visibility.
- Document API contracts early so mobile/web clients can integrate in parallel.
