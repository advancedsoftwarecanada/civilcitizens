# Milestone 4 – Market Foundations

> Objective: deliver the national buy/sell experience with escrowed payments, delivery gig generation, and dispute tooling, using wallet stubs until GA.

## 1. Scope Overview
- **Listings Service:** create/manage listings, media galleries, shipping options, verification badges.
- **Order Pipeline:** checkout, escrow hold (logical placeholder), fulfillment, delivery requests, disputes.
- **Delivery Gigs:** auto-create gigs when buyers request delivery; route estimation, courier assignment hooks.
- **Seller Reputation:** ratings, badge system, verification, policy compliance.

## 2. Key Components
1. **Listing CRUD + Search**
   - Categories, tags, condition, pricing, quantity, availability radius.
   - Media management via existing upload service.
   - Search filters (distance, price, category) with personalization heuristics.
2. **Order & Escrow Service**
   - Order states: `initiated`, `funded`, `ready`, `in_transit`, `completed`, `disputed`, `refunded`.
   - Escrow ledger entries recorded even if funds are stubbed (for later replay).
   - Seller confirmation + buyer confirmation flows.
3. **Delivery Gig Generator**
   - When buyer requests delivery, spawn Work gig referencing order.
   - Integrate with OpenStreetMap to estimate distance/time and suggested bounty.
   - Courier assignment endpoints (manual for MVP, automated later).
4. **Dispute & Support**
   - Buyer/seller dispute submission, evidence upload, staff resolution tools.
   - Policy templates (return windows, prohibited items).
5. **Verification & Badges**
   - Seller verification checklist (ID, phone, address, wallet verified).
   - Badge display on listings + profile search weight boost.

## 3. Deliverables Checklist
- [ ] Prisma models for listings, listing media, orders, order events, disputes, seller badges.
- [ ] REST/GraphQL APIs with auth guards + rate limits.
- [ ] Checkout UI flow (web) including delivery request option and escrow summary.
- [ ] Background workers: order state transitions, delivery gig creation, notification fan-out.
- [ ] Dispute management UI for staff with evidence viewer.
- [ ] Analytics dashboards (listings created, GMV proxy, dispute rates).
- [ ] Documentation for policy/compliance (acceptable use, prohibited goods).

## 4. Acceptance Criteria
- User can list an item, another user can purchase it, order progresses through states with notifications.
- Delivery request spawns gig entry visible in Work module (even if assignment manual).
- Dispute can be filed and resolved via staff UI with order state updated accordingly.
- Seller badge displays for verified sellers and affects search results.
- Ledger stubs capture every monetary event for later reconciliation.

## 5. Dependencies & Notes
- Relies on Milestone 1 ledger skeleton + Milestone 3 community feeds for local surfacing.
- Payment executions remain in sandbox/stub until Wallet GA; ensure clean idempotent hooks for future activation.
- Coordinate closely with Work team for gig schema alignment.
