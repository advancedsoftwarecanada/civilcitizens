import { prisma } from '@civil/db'
import type { Prisma } from '@prisma/client'
import type Stripe from 'stripe'

export type WalletConnectSummary = {
  accountId: string | null
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
}

export type WalletSharingSummary = {
  family: boolean
  friends: boolean
  market: boolean
}

export type WalletSummary = {
  civilCreditsCents: number
  enabled: boolean
  eTransferEmail: string | null
  stripeCustomerId: string | null
  sharing: WalletSharingSummary
  stripeConnect: WalletConnectSummary
}

export type WalletTransactionSummary = {
  id: string
  entryType: 'deposit' | 'withdrawal' | 'transfer' | 'adjustment'
  status: string
  amountCents: number
  currency: string
  occurredAt: string
  availableAt: string | null
  direction: 'credit' | 'debit'
  title: string
  detail: string | null
}

export type WalletView = WalletSummary & {
  availableCreditsCents: number
  pendingCreditsCents: number
  settlementHoldDays: number
  recentTransactions: WalletTransactionSummary[]
}

export const WALLET_SETTLEMENT_HOLD_DAYS = 7

let citizenWalletTablesReady: Promise<void> | null = null

type WalletDbClient = typeof prisma | Prisma.TransactionClient

type CivilCreditLedgerUserSnapshot = {
  userId?: string | null
  handle?: string | null
  name?: string | null
  entityType: string
  entityLabel?: string | null
}

type CivilCreditLedgerEntry = {
  id: string
  eventId: string
  entryType: 'deposit' | 'withdrawal' | 'transfer' | 'adjustment'
  status: string
  amountCents: number
  currency: string
  grossAmountCents?: number | null
  providerProcessingFeeCents?: number | null
  providerFeeRateBps?: number | null
  providerFlatFeeCents?: number | null
  processingProvider?: string | null
  occurredAt?: Date | string | null
  from: CivilCreditLedgerUserSnapshot
  to: CivilCreditLedgerUserSnapshot
  sourceType?: string | null
  sourceReferenceId?: string | null
  stripePaymentIntentId?: string | null
  stripeTransferId?: string | null
  stripeConnectAccountId?: string | null
  description?: string | null
  metadata?: Record<string, unknown> | null
}

type WalletLedgerRow = {
  id: string
  entry_type: 'deposit' | 'withdrawal' | 'transfer' | 'adjustment'
  status: string
  amount_cents: number
  currency: string
  occurred_at: Date
  description: string | null
  processing_provider: string | null
  from_user_id: string | null
  from_user_handle: string | null
  from_user_name: string | null
  from_entity_label: string | null
  to_user_id: string | null
  to_user_handle: string | null
  to_user_name: string | null
  to_entity_label: string | null
}

export function readBaseJsonObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...(value as Record<string, any>) }
}

export function readWalletSummary(communityMeta: any): WalletSummary {
  const wallet = communityMeta?.wallet && typeof communityMeta.wallet === 'object' && !Array.isArray(communityMeta.wallet)
    ? communityMeta.wallet
    : null
  const civilCreditsCents =
    typeof wallet?.civilCreditsCents === 'number' && Number.isFinite(wallet.civilCreditsCents)
      ? Math.max(0, Math.round(wallet.civilCreditsCents))
      : 0
  const eTransferEmail = typeof wallet?.eTransferEmail === 'string' && wallet.eTransferEmail.trim()
    ? wallet.eTransferEmail.trim().toLowerCase()
    : null
  const enabled = typeof wallet?.enabled === 'boolean' ? Boolean(wallet.enabled) : Boolean(eTransferEmail)
  const sharing = wallet?.sharing && typeof wallet.sharing === 'object' && !Array.isArray(wallet.sharing)
    ? wallet.sharing
    : null
  const stripeCustomerId = typeof wallet?.stripeCustomerId === 'string' && wallet.stripeCustomerId.trim()
    ? wallet.stripeCustomerId.trim()
    : null
  const stripeConnect = wallet?.stripeConnect && typeof wallet.stripeConnect === 'object' && !Array.isArray(wallet.stripeConnect)
    ? wallet.stripeConnect
    : null

  return {
    civilCreditsCents,
    enabled,
    eTransferEmail,
    stripeCustomerId,
    sharing: {
      family: typeof sharing?.family === 'boolean' ? Boolean(sharing.family) : false,
      friends: typeof sharing?.friends === 'boolean' ? Boolean(sharing.friends) : false,
      market: typeof sharing?.market === 'boolean' ? Boolean(sharing.market) : Boolean(eTransferEmail),
    },
    stripeConnect: {
      accountId: typeof stripeConnect?.accountId === 'string' && stripeConnect.accountId.trim() ? stripeConnect.accountId.trim() : null,
      chargesEnabled: typeof stripeConnect?.chargesEnabled === 'boolean' ? Boolean(stripeConnect.chargesEnabled) : false,
      payoutsEnabled: typeof stripeConnect?.payoutsEnabled === 'boolean' ? Boolean(stripeConnect.payoutsEnabled) : false,
      detailsSubmitted: typeof stripeConnect?.detailsSubmitted === 'boolean' ? Boolean(stripeConnect.detailsSubmitted) : false,
    },
  }
}

export function buildWalletMetaValue(wallet: WalletSummary) {
  return {
    civilCreditsCents: Math.max(0, Math.round(wallet.civilCreditsCents || 0)),
    enabled: Boolean(wallet.enabled),
    eTransferEmail: wallet.eTransferEmail ? wallet.eTransferEmail.trim().toLowerCase() : null,
    stripeCustomerId: wallet.stripeCustomerId ? wallet.stripeCustomerId.trim() : null,
    sharing: {
      family: Boolean(wallet.sharing.family),
      friends: Boolean(wallet.sharing.friends),
      market: Boolean(wallet.sharing.market),
    },
    stripeConnect: {
      accountId: wallet.stripeConnect.accountId ? wallet.stripeConnect.accountId.trim() : null,
      chargesEnabled: Boolean(wallet.stripeConnect.chargesEnabled),
      payoutsEnabled: Boolean(wallet.stripeConnect.payoutsEnabled),
      detailsSubmitted: Boolean(wallet.stripeConnect.detailsSubmitted),
    },
  }
}

export function walletHasConnectPayoutsEnabled(wallet: WalletSummary | null | undefined) {
  return Boolean(wallet?.stripeConnect.accountId && wallet.stripeConnect.payoutsEnabled)
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function isPendingStripeDeposit(row: WalletLedgerRow, userId: string, now: Date) {
  if (row.entry_type !== 'deposit') return false
  if (row.processing_provider !== 'stripe') return false
  if (row.to_user_id !== userId) return false
  if (row.status !== 'completed') return false
  return addDays(new Date(row.occurred_at), WALLET_SETTLEMENT_HOLD_DAYS) > now
}

function buildWalletTransactionTitle(row: WalletLedgerRow, userId: string) {
  if (row.entry_type === 'deposit') return 'Added funds'
  if (row.entry_type === 'withdrawal') return 'Deposit to bank account'
  if (row.entry_type === 'transfer') {
    return row.to_user_id === userId ? 'Received Civil Credits' : 'Sent Civil Credits'
  }
  return 'Wallet adjustment'
}

function buildWalletTransactionDetail(row: WalletLedgerRow, userId: string) {
  if (row.entry_type === 'deposit') return row.from_entity_label ?? 'Stripe'
  if (row.entry_type === 'withdrawal') return row.to_entity_label ?? 'Linked bank account'
  if (row.entry_type === 'transfer') {
    if (row.to_user_id === userId) {
      return row.from_user_name ?? row.from_user_handle ?? row.from_entity_label ?? 'Civil Wallet'
    }
    return row.to_user_name ?? row.to_user_handle ?? row.to_entity_label ?? 'Civil Wallet'
  }
  return row.description ?? null
}

function buildWalletTransactionSummary(row: WalletLedgerRow, userId: string, now: Date): WalletTransactionSummary {
  const pendingDeposit = isPendingStripeDeposit(row, userId, now)
  const availableAt = pendingDeposit ? addDays(new Date(row.occurred_at), WALLET_SETTLEMENT_HOLD_DAYS) : null
  const direction = row.to_user_id === userId && row.entry_type !== 'withdrawal' ? 'credit' : 'debit'

  return {
    id: row.id,
    entryType: row.entry_type,
    status: pendingDeposit ? 'pending' : row.entry_type === 'deposit' ? 'available' : row.status,
    amountCents: Math.max(0, Math.round(row.amount_cents || 0)),
    currency: normalizeLedgerText(row.currency)?.toLowerCase() ?? 'cad',
    occurredAt: new Date(row.occurred_at).toISOString(),
    availableAt: availableAt ? availableAt.toISOString() : null,
    direction,
    title: buildWalletTransactionTitle(row, userId),
    detail: buildWalletTransactionDetail(row, userId),
  }
}

export async function buildWalletView(userId: string, communityMeta: any, transactionLimit = 12): Promise<WalletView> {
  const wallet = readWalletSummary(communityMeta)
  await ensureCitizenWalletTables()

  const now = new Date()
  const pendingRows = await prisma.$queryRaw<Array<{ amount_cents: number }>>`
    SELECT amount_cents
    FROM civil_credit_ledger
    WHERE entry_type = 'deposit'
      AND processing_provider = 'stripe'
      AND to_user_id = ${userId}
      AND status = 'completed'
      AND occurred_at > NOW() - (${WALLET_SETTLEMENT_HOLD_DAYS} * INTERVAL '1 day')
  `
  const pendingCreditsCents = Math.min(
    wallet.civilCreditsCents,
    pendingRows.reduce((sum, row) => sum + Math.max(0, Math.round(row.amount_cents || 0)), 0),
  )
  const availableCreditsCents = Math.max(0, wallet.civilCreditsCents - pendingCreditsCents)

  const recentRows = await prisma.$queryRaw<Array<WalletLedgerRow>>`
    SELECT
      id,
      entry_type,
      status,
      amount_cents,
      currency,
      occurred_at,
      description,
      processing_provider,
      from_user_id,
      from_user_handle,
      from_user_name,
      from_entity_label,
      to_user_id,
      to_user_handle,
      to_user_name,
      to_entity_label
    FROM civil_credit_ledger
    WHERE from_user_id = ${userId}
       OR to_user_id = ${userId}
    ORDER BY occurred_at DESC
    LIMIT ${Math.max(1, Math.min(transactionLimit, 50))}
  `

  return {
    ...wallet,
    availableCreditsCents,
    pendingCreditsCents,
    settlementHoldDays: WALLET_SETTLEMENT_HOLD_DAYS,
    recentTransactions: recentRows.map((row) => buildWalletTransactionSummary(row, userId, now)),
  }
}

function normalizeLedgerText(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export async function insertCivilCreditLedgerEntry(db: WalletDbClient, entry: CivilCreditLedgerEntry) {
  await db.$executeRaw`
    INSERT INTO civil_credit_ledger (
      id,
      event_id,
      entry_type,
      status,
      amount_cents,
      gross_amount_cents,
      currency,
      processing_provider,
      provider_processing_fee_cents,
      provider_fee_rate_bps,
      provider_flat_fee_cents,
      occurred_at,
      from_entity_type,
      from_user_id,
      from_user_handle,
      from_user_name,
      from_entity_label,
      to_entity_type,
      to_user_id,
      to_user_handle,
      to_user_name,
      to_entity_label,
      source_type,
      source_reference_id,
      stripe_payment_intent_id,
      stripe_transfer_id,
      stripe_connect_account_id,
      description,
      metadata,
      updated_at
    )
    VALUES (
      ${entry.id},
      ${entry.eventId},
      ${entry.entryType},
      ${entry.status},
      ${Math.max(0, Math.round(entry.amountCents || 0))},
      ${typeof entry.grossAmountCents === 'number' && Number.isFinite(entry.grossAmountCents) ? Math.max(0, Math.round(entry.grossAmountCents)) : null},
      ${normalizeLedgerText(entry.currency)?.toLowerCase() ?? 'cad'},
      ${normalizeLedgerText(entry.processingProvider)},
      ${typeof entry.providerProcessingFeeCents === 'number' && Number.isFinite(entry.providerProcessingFeeCents) ? Math.max(0, Math.round(entry.providerProcessingFeeCents)) : null},
      ${typeof entry.providerFeeRateBps === 'number' && Number.isFinite(entry.providerFeeRateBps) ? Math.max(0, Math.round(entry.providerFeeRateBps)) : null},
      ${typeof entry.providerFlatFeeCents === 'number' && Number.isFinite(entry.providerFlatFeeCents) ? Math.max(0, Math.round(entry.providerFlatFeeCents)) : null},
      ${entry.occurredAt ? new Date(entry.occurredAt) : new Date()},
      ${entry.from.entityType},
      ${entry.from.userId ?? null},
      ${normalizeLedgerText(entry.from.handle)},
      ${normalizeLedgerText(entry.from.name)},
      ${normalizeLedgerText(entry.from.entityLabel)},
      ${entry.to.entityType},
      ${entry.to.userId ?? null},
      ${normalizeLedgerText(entry.to.handle)},
      ${normalizeLedgerText(entry.to.name)},
      ${normalizeLedgerText(entry.to.entityLabel)},
      ${normalizeLedgerText(entry.sourceType)},
      ${normalizeLedgerText(entry.sourceReferenceId)},
      ${normalizeLedgerText(entry.stripePaymentIntentId)},
      ${normalizeLedgerText(entry.stripeTransferId)},
      ${normalizeLedgerText(entry.stripeConnectAccountId)},
      ${normalizeLedgerText(entry.description)},
      ${JSON.stringify(entry.metadata ?? {})}::jsonb,
      NOW()
    )
    ON CONFLICT (source_type, source_reference_id)
    DO NOTHING
  `
}

export async function ensureCitizenWalletTables() {
  if (!citizenWalletTablesReady) {
    citizenWalletTablesReady = (async () => {
      const statements = [
        `
          CREATE TABLE IF NOT EXISTS citizen_wallet_transaction (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'completed',
            user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
            counterparty_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
            amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
            currency TEXT NOT NULL DEFAULT 'cad',
            stripe_payment_intent_id TEXT,
            stripe_transfer_id TEXT,
            stripe_connect_account_id TEXT,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        `
          CREATE UNIQUE INDEX IF NOT EXISTS citizen_wallet_transaction_stripe_payment_intent_id_uniq
            ON citizen_wallet_transaction (stripe_payment_intent_id)
            WHERE stripe_payment_intent_id IS NOT NULL
        `,
        `
          CREATE UNIQUE INDEX IF NOT EXISTS citizen_wallet_transaction_stripe_transfer_id_uniq
            ON citizen_wallet_transaction (stripe_transfer_id)
            WHERE stripe_transfer_id IS NOT NULL
        `,
        `
          CREATE INDEX IF NOT EXISTS citizen_wallet_transaction_user_id_idx
            ON citizen_wallet_transaction (user_id, created_at DESC)
        `,
        `
          CREATE INDEX IF NOT EXISTS citizen_wallet_transaction_counterparty_user_id_idx
            ON citizen_wallet_transaction (counterparty_user_id, created_at DESC)
        `,
        `
          CREATE TABLE IF NOT EXISTS civil_credit_ledger (
            id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL,
            entry_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'completed',
            amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
            gross_amount_cents INTEGER,
            currency TEXT NOT NULL DEFAULT 'cad',
            processing_provider TEXT,
            provider_processing_fee_cents INTEGER,
            provider_fee_rate_bps INTEGER,
            provider_flat_fee_cents INTEGER,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            from_entity_type TEXT NOT NULL,
            from_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
            from_user_handle TEXT,
            from_user_name TEXT,
            from_entity_label TEXT,
            to_entity_type TEXT NOT NULL,
            to_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
            to_user_handle TEXT,
            to_user_name TEXT,
            to_entity_label TEXT,
            source_type TEXT NOT NULL,
            source_reference_id TEXT NOT NULL,
            stripe_payment_intent_id TEXT,
            stripe_transfer_id TEXT,
            stripe_connect_account_id TEXT,
            description TEXT,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        `ALTER TABLE civil_credit_ledger ADD COLUMN IF NOT EXISTS gross_amount_cents INTEGER`,
        `ALTER TABLE civil_credit_ledger ADD COLUMN IF NOT EXISTS processing_provider TEXT`,
        `ALTER TABLE civil_credit_ledger ADD COLUMN IF NOT EXISTS provider_processing_fee_cents INTEGER`,
        `ALTER TABLE civil_credit_ledger ADD COLUMN IF NOT EXISTS provider_fee_rate_bps INTEGER`,
        `ALTER TABLE civil_credit_ledger ADD COLUMN IF NOT EXISTS provider_flat_fee_cents INTEGER`,
        `
          CREATE UNIQUE INDEX IF NOT EXISTS civil_credit_ledger_source_reference_uniq
            ON civil_credit_ledger (source_type, source_reference_id)
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_credit_ledger_occurred_at_idx
            ON civil_credit_ledger (occurred_at DESC)
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_credit_ledger_entry_type_status_idx
            ON civil_credit_ledger (entry_type, status, occurred_at DESC)
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_credit_ledger_processing_provider_idx
            ON civil_credit_ledger (processing_provider, occurred_at DESC)
            WHERE processing_provider IS NOT NULL
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_credit_ledger_from_user_id_idx
            ON civil_credit_ledger (from_user_id, occurred_at DESC)
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_credit_ledger_to_user_id_idx
            ON civil_credit_ledger (to_user_id, occurred_at DESC)
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_credit_ledger_stripe_payment_intent_idx
            ON civil_credit_ledger (stripe_payment_intent_id)
            WHERE stripe_payment_intent_id IS NOT NULL
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_credit_ledger_stripe_transfer_idx
            ON civil_credit_ledger (stripe_transfer_id)
            WHERE stripe_transfer_id IS NOT NULL
        `,
        `
          INSERT INTO civil_credit_ledger (
            id,
            event_id,
            entry_type,
            status,
            amount_cents,
            gross_amount_cents,
            currency,
            processing_provider,
            provider_processing_fee_cents,
            provider_fee_rate_bps,
            provider_flat_fee_cents,
            occurred_at,
            from_entity_type,
            from_user_id,
            from_user_handle,
            from_user_name,
            from_entity_label,
            to_entity_type,
            to_user_id,
            to_user_handle,
            to_user_name,
            to_entity_label,
            source_type,
            source_reference_id,
            stripe_payment_intent_id,
            stripe_transfer_id,
            stripe_connect_account_id,
            description,
            metadata,
            created_at,
            updated_at
          )
          SELECT
            'wallettx:' || t.id,
            t.id,
            CASE
              WHEN t.kind = 'top_up' THEN 'deposit'
              WHEN t.kind = 'payout' THEN 'withdrawal'
              WHEN t.kind = 'user_transfer' THEN 'transfer'
              ELSE 'adjustment'
            END,
            t.status,
            t.amount_cents,
            CASE
              WHEN t.kind = 'top_up' THEN COALESCE(NULLIF((t.metadata ->> 'totalChargeCents'), '')::INTEGER, t.amount_cents)
              ELSE t.amount_cents
            END,
            COALESCE(NULLIF(LOWER(t.currency), ''), 'cad'),
            CASE
              WHEN t.kind = 'top_up' THEN 'stripe'
              ELSE NULL
            END,
            CASE
              WHEN t.kind = 'top_up' THEN NULLIF((t.metadata ->> 'processingFeeCents'), '')::INTEGER
              ELSE NULL
            END,
            CASE
              WHEN t.kind = 'top_up' THEN 290
              ELSE NULL
            END,
            CASE
              WHEN t.kind = 'top_up' THEN 30
              ELSE NULL
            END,
            t.created_at,
            CASE
              WHEN t.kind = 'top_up' THEN 'external_payment'
              ELSE 'user_wallet'
            END,
            CASE
              WHEN t.kind IN ('payout', 'user_transfer') THEN sender.id
              ELSE NULL
            END,
            CASE
              WHEN t.kind IN ('payout', 'user_transfer') THEN sender.handle
              ELSE NULL
            END,
            CASE
              WHEN t.kind IN ('payout', 'user_transfer') THEN sender.name
              ELSE NULL
            END,
            CASE
              WHEN t.kind = 'top_up' THEN 'Stripe'
              WHEN t.kind = 'payout' THEN 'Civil Wallet'
              WHEN t.kind = 'user_transfer' THEN 'Civil Wallet'
              ELSE 'Civil'
            END,
            CASE
              WHEN t.kind = 'payout' THEN 'external_bank'
              ELSE 'user_wallet'
            END,
            CASE
              WHEN t.kind = 'top_up' THEN sender.id
              WHEN t.kind = 'user_transfer' THEN recipient.id
              ELSE NULL
            END,
            CASE
              WHEN t.kind = 'top_up' THEN sender.handle
              WHEN t.kind = 'user_transfer' THEN recipient.handle
              ELSE NULL
            END,
            CASE
              WHEN t.kind = 'top_up' THEN sender.name
              WHEN t.kind = 'user_transfer' THEN recipient.name
              ELSE NULL
            END,
            CASE
              WHEN t.kind = 'top_up' THEN 'Civil Wallet'
              WHEN t.kind = 'payout' THEN 'Linked bank account'
              WHEN t.kind = 'user_transfer' THEN 'Civil Wallet'
              ELSE 'Civil Wallet'
            END,
            'wallet_transaction',
            t.id,
            t.stripe_payment_intent_id,
            t.stripe_transfer_id,
            t.stripe_connect_account_id,
            CASE
              WHEN t.kind = 'top_up' THEN 'Wallet deposit via Stripe'
              WHEN t.kind = 'payout' THEN 'Wallet withdrawal to connected bank account'
              WHEN t.kind = 'user_transfer' THEN 'Civil Credit transfer between users'
              ELSE 'Civil Wallet adjustment'
            END,
            COALESCE(t.metadata, '{}'::jsonb),
            t.created_at,
            t.updated_at
          FROM citizen_wallet_transaction t
          LEFT JOIN "User" sender ON sender.id = t.user_id
          LEFT JOIN "User" recipient ON recipient.id = t.counterparty_user_id
          ON CONFLICT (source_type, source_reference_id)
          DO NOTHING
        `,
      ]

      for (const statement of statements) {
        await prisma.$executeRawUnsafe(statement)
      }
    })().catch((error) => {
      citizenWalletTablesReady = null
      throw error
    })
  }

  await citizenWalletTablesReady
}

export async function applyWalletTopUpFromPaymentIntent(paymentIntent: Stripe.PaymentIntent) {
  const userId = paymentIntent.metadata?.civilUserId?.trim() || paymentIntent.metadata?.userId?.trim() || null
  const requestedCreditAmountCents = Number.parseInt(paymentIntent.metadata?.civilCreditAmountCents ?? '', 10)
  const amountCents = Number.isFinite(requestedCreditAmountCents) && requestedCreditAmountCents > 0
    ? Math.max(0, Math.round(requestedCreditAmountCents))
    : Math.max(0, Math.round(paymentIntent.amount_received || paymentIntent.amount || 0))
  const processingFeeCents = Number.parseInt(paymentIntent.metadata?.processingFeeCents ?? '', 10)
  const totalChargeCents = Number.parseInt(paymentIntent.metadata?.totalChargeCents ?? '', 10)
  if (!userId || !amountCents) return false

  await ensureCitizenWalletTables()

  let applied = false
  await prisma.$transaction(async (tx) => {
    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM citizen_wallet_transaction
      WHERE stripe_payment_intent_id = ${paymentIntent.id}
      LIMIT 1
    `
    if (existing[0]) return

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { communityMeta: true, handle: true, name: true },
    })
    if (!user) return

    const wallet = readWalletSummary(user.communityMeta)
    const baseMeta = readBaseJsonObject(user.communityMeta)
    baseMeta.wallet = buildWalletMetaValue({
      ...wallet,
      civilCreditsCents: wallet.civilCreditsCents + amountCents,
    })

    await tx.user.update({
      where: { id: userId },
      data: { communityMeta: baseMeta },
    })

    await tx.$executeRaw`
      INSERT INTO citizen_wallet_transaction (
        id,
        kind,
        status,
        user_id,
        amount_cents,
        currency,
        stripe_payment_intent_id,
        metadata,
        updated_at
      )
      VALUES (
        ${paymentIntent.id},
        ${'top_up'},
        ${'completed'},
        ${userId},
        ${amountCents},
        ${String(paymentIntent.currency || 'cad').toLowerCase()},
        ${paymentIntent.id},
        ${JSON.stringify({
          kind: paymentIntent.metadata?.kind ?? 'wallet_topup',
          civilCreditAmountCents: amountCents,
          processingFeeCents: Number.isFinite(processingFeeCents) ? processingFeeCents : null,
          totalChargeCents: Number.isFinite(totalChargeCents) ? totalChargeCents : Math.max(0, Math.round(paymentIntent.amount_received || paymentIntent.amount || 0)),
        })}::jsonb,
        NOW()
      )
    `

    await insertCivilCreditLedgerEntry(tx, {
      id: `deposit:${paymentIntent.id}`,
      eventId: paymentIntent.id,
      entryType: 'deposit',
      status: 'completed',
      amountCents,
      grossAmountCents: Number.isFinite(totalChargeCents) ? totalChargeCents : Math.max(0, Math.round(paymentIntent.amount_received || paymentIntent.amount || 0)),
      currency: String(paymentIntent.currency || 'cad').toLowerCase(),
      processingProvider: 'stripe',
      providerProcessingFeeCents: Number.isFinite(processingFeeCents) ? processingFeeCents : null,
      providerFeeRateBps: 290,
      providerFlatFeeCents: 30,
      occurredAt: new Date(),
      from: {
        entityType: 'external_payment',
        entityLabel: 'Stripe',
      },
      to: {
        entityType: 'user_wallet',
        userId,
        handle: user.handle ?? null,
        name: user.name ?? null,
        entityLabel: 'Civil Wallet',
      },
      sourceType: 'stripe_payment_intent',
      sourceReferenceId: paymentIntent.id,
      stripePaymentIntentId: paymentIntent.id,
      description: 'Wallet deposit via Stripe',
      metadata: {
        kind: paymentIntent.metadata?.kind ?? 'wallet_topup',
        civilCreditAmountCents: amountCents,
        processingFeeCents: Number.isFinite(processingFeeCents) ? processingFeeCents : null,
        totalChargeCents: Number.isFinite(totalChargeCents) ? totalChargeCents : Math.max(0, Math.round(paymentIntent.amount_received || paymentIntent.amount || 0)),
      },
    })

    applied = true
  })

  return applied
}