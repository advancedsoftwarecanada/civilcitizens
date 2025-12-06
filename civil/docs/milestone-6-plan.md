# Milestone 6 – Civil Wallet GA

> Objective: graduate the wallet from stubs to real money movement with Stripe Connect, completing the financial backbone for Market and Work pillars.

## 1. Scope Overview
- **Ledger & Accounts:** hardened double-entry ledger, reconciliation tools, automated health checks.
- **Stripe Connect Integration:** onboarding, top-ups, wallet-to-wallet transfers, payouts (standard + instant).
- **Escrow & Holds:** enforce holds for orders/gigs, release rules, refunds, disputes, chargebacks.
- **Admin & Compliance:** ledger explorer, manual adjustments, KYC status, fraud detection, reporting.

## 2. Key Components
1. **Ledger Hardening**
   - Accounts: user wallet, org wallet, escrow, platform reserve, fee sink.
   - Idempotent journal writer with ACID guarantees.
   - Periodic reconciliation job comparing ledger balances to Stripe balance + payouts.
2. **Top-Up Flow**
   - Create Stripe PaymentIntent via Connect, capture card fees (2.9% + $0.30) stored as metadata.
   - Instant availability of funds upon webhook confirmation; notify user.
3. **Wallet Transfers & Escrow**
   - Internal ledger transfers for purchases, gigs, deposits; integrate with Market/Work state machines.
   - Holds with release conditions (delivery confirmed, gig approved) and automated expiry fallback.
4. **Cash-Out**
   - Standard payout via Stripe (0 fee, 1-3 days) as default.
   - Instant payout option charging user 1% (min $0.25), showing cost estimate before confirmation.
   - Payout scheduling, status tracking, failure handling.
5. **Compliance & Risk**
   - Stripe Connect Custom accounts with onboarding flows (identity verification, banking info).
   - Fraud detection: velocity limits, geo checks, blacklists, manual review queue.
   - Reporting: monthly statements, CRA-ready exports, audit logs.
6. **Admin Tools**
   - Ledger explorer with filters, drill-down by reference.
   - Manual adjustments with dual-approval workflow.
   - Webhook monitor dashboard (success/failure, retry controls).

## 3. Deliverables Checklist
- [ ] Prisma/account models updated for ledger + Stripe objects, migrations applied.
- [ ] Stripe Connect environment configured (test + live), secrets management updated.
- [ ] API endpoints/UI for top-up, transfer, cash-out, instant payout, wallet history.
- [ ] Webhook handlers for `payment_intent.succeeded`, `payout.paid`, `charge.refunded`, `topup.failed`, etc.
- [ ] Reconciliation jobs + alerting (mismatch thresholds, stuck holds).
- [ ] Admin console for ledger + compliance operations.
- [ ] End-to-end integration tests covering top-up → purchase → gig payout → cash-out scenarios in sandbox.

## 4. Acceptance Criteria
- User can top-up with card, buy item, pay gig worker, and cash out to bank (standard + instant) successfully in sandbox.
- Ledger remains balanced (sum of account balances = 0) across scenarios, with reconciliation passing nightly.
- Disputes/refunds propagate ledger adjustments and notify buyers/sellers appropriately.
- Admin console allows viewing transactions, triggering manual payouts, and handling chargebacks.
- Fraud controls flag suspicious activity and allow manual overrides.

## 5. Dependencies & Notes
- Requires Milestones 2-5 services to emit ledger intents correctly; run historical replay to ensure consistency.
- Engage finance/legal for compliance sign-off (KYC, AML, reporting obligations).
- Provide clear user-facing comms for fees (top-up vs instant payout) and wallet terms.
