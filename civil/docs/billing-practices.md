# Civil Billing Practices

## Cause support fees

- Civil Wallet Cause transfers use a Civil fee that scales with transfer size.
- The current fee table is documented in `CIVIL_FEES.md`.
- The fee is tiered by transaction amount and is capped at `$2.00`.
- The creator receives the support amount. The Civil fee is charged separately to the supporter.

## Global fee reference

- Use `CIVIL_FEES.md` as the source of truth for Civil Wallet and Civil Pay fee schedules.

## One-time Cause support

- One-time Cause support is charged from the supporter’s Civil Wallet balance.
- A completed support event creates Civil Ledger entries for:
  - the transfer from the supporter wallet to the creator wallet
  - the Civil fee collected by the platform

## Monthly Cause subscriptions

- Cause subscriptions are billed monthly from the supporter’s Civil Wallet balance.
- The initial subscription charge happens when the subscription is created.
- Recurring charges are processed by a server-side daily check.
- Each recurring charge creates Civil Ledger entries for the wallet transfer and the Civil fee.

## Subscription state changes

- If a subscriber does not have enough Civil Wallet balance for a scheduled charge, the subscription is paused.
- If the Cause is inactive, missing, or the recipient cannot receive payouts, the subscription is canceled.
- Subscribers can pause or cancel their Cause subscriptions from the wallet page.

## Admin visibility

- Operators can review Cause subscriptions at `/admin/wallet/subscriptions`.
- The admin view shows active, paused, and canceled subscriptions along with next-charge timing and subscriber/creator details.