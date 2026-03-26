import { prisma } from '@civil/db'
import type { Prisma } from '@prisma/client'
import {
  buildWalletMetaValue,
  ensureCitizenWalletTables,
  insertCivilCreditLedgerEntry,
  readBaseJsonObject,
  readWalletSummary,
  walletHasConnectPayoutsEnabled,
} from './walletHelpers.js'

type WalletTransactionDbClient = typeof prisma | Prisma.TransactionClient

type WalletTransferErrorCodes = {
  senderWalletDisabled?: string
  recipientWalletUnavailable?: string
  insufficientFunds?: string
  userNotFound?: string
}

type WalletLedgerConfig = {
  id: string
  eventId: string
  sourceType: string
  sourceReferenceId: string
  description: string
  metadata?: Record<string, unknown>
  entryType?: 'transfer' | 'adjustment'
  fromEntityType?: string
  fromEntityLabel?: string
  toEntityType?: string
  toEntityLabel?: string
  toUserId?: string | null
  toHandle?: string | null
  toName?: string | null
}

type ApplyWalletUserTransferInput = {
  senderUserId: string
  recipientUserId: string
  amountCents: number
  feeCents?: number
  totalChargeCents?: number
  currency?: string
  transactionId: string
  transactionKind: string
  transactionAmountCents?: number
  transactionUserId?: string
  transactionCounterpartyUserId?: string | null
  transactionMetadata?: Record<string, unknown>
  stripeConnectAccountId?: string | null
  requireSenderWalletEnabled?: boolean
  requireRecipientWalletEnabled?: boolean
  requireRecipientConnectPayouts?: boolean
  errors?: WalletTransferErrorCodes
  transferLedger: WalletLedgerConfig
  feeLedger?: WalletLedgerConfig
}

type ApplyWalletDebitInput = {
  senderUserId: string
  amountCents: number
  currency?: string
  transactionId: string
  transactionKind: string
  transactionAmountCents?: number
  transactionUserId?: string
  transactionCounterpartyUserId?: string | null
  transactionMetadata?: Record<string, unknown>
  requireSenderWalletEnabled?: boolean
  errors?: WalletTransferErrorCodes
  ledger: WalletLedgerConfig
}

type WalletTransferUserRow = {
  id: string
  handle: string | null
  name: string | null
  communityMeta: Prisma.JsonValue | null
}

function normalizeCurrency(value: string | undefined) {
  return value?.trim().toLowerCase() || 'cad'
}

function clampCurrency(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

function buildWalletLedgerParty(args: {
  user: WalletTransferUserRow
  entityType?: string
  entityLabel?: string
}) {
  return {
    entityType: args.entityType ?? 'user_wallet',
    userId: args.user.id,
    handle: args.user.handle ?? null,
    name: args.user.name ?? null,
    entityLabel: args.entityLabel ?? 'Civil Wallet',
  }
}

export async function applyWalletUserTransfer(
  db: WalletTransactionDbClient,
  input: ApplyWalletUserTransferInput,
) {
  await ensureCitizenWalletTables()

  const amountCents = clampCurrency(input.amountCents)
  const feeCents = clampCurrency(input.feeCents ?? 0)
  const totalChargeCents = clampCurrency(input.totalChargeCents ?? amountCents + feeCents)
  const transactionAmountCents = clampCurrency(input.transactionAmountCents ?? totalChargeCents)
  const currency = normalizeCurrency(input.currency)
  const errors = input.errors ?? {}

  const [sender, recipient] = await Promise.all([
    db.user.findUnique({
      where: { id: input.senderUserId },
      select: { id: true, handle: true, name: true, communityMeta: true },
    }),
    db.user.findUnique({
      where: { id: input.recipientUserId },
      select: { id: true, handle: true, name: true, communityMeta: true },
    }),
  ])

  if (!sender || !recipient) {
    throw new Error(errors.userNotFound ?? 'user_not_found')
  }

  const senderWallet = readWalletSummary(sender.communityMeta)
  const recipientWallet = readWalletSummary(recipient.communityMeta)

  if ((input.requireSenderWalletEnabled ?? true) && !senderWallet.enabled) {
    throw new Error(errors.senderWalletDisabled ?? 'wallet_required')
  }
  if ((input.requireRecipientWalletEnabled ?? false) && !recipientWallet.enabled) {
    throw new Error(errors.recipientWalletUnavailable ?? 'wallet_not_available')
  }
  if ((input.requireRecipientConnectPayouts ?? false) && !walletHasConnectPayoutsEnabled(recipientWallet)) {
    throw new Error(errors.recipientWalletUnavailable ?? 'wallet_not_available')
  }
  if (senderWallet.civilCreditsCents < totalChargeCents) {
    throw new Error(errors.insufficientFunds ?? 'insufficient_wallet_balance')
  }

  const senderMeta = readBaseJsonObject(sender.communityMeta)
  senderMeta.wallet = buildWalletMetaValue({
    ...senderWallet,
    civilCreditsCents: senderWallet.civilCreditsCents - totalChargeCents,
  })

  const recipientMeta = readBaseJsonObject(recipient.communityMeta)
  recipientMeta.wallet = buildWalletMetaValue({
    ...recipientWallet,
    civilCreditsCents: recipientWallet.civilCreditsCents + amountCents,
  })

  await Promise.all([
    db.user.update({ where: { id: sender.id }, data: { communityMeta: senderMeta } }),
    db.user.update({ where: { id: recipient.id }, data: { communityMeta: recipientMeta } }),
  ])

  await db.$executeRaw`
    INSERT INTO citizen_wallet_transaction (
      id,
      kind,
      status,
      user_id,
      counterparty_user_id,
      amount_cents,
      currency,
      stripe_connect_account_id,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${input.transactionId},
      ${input.transactionKind},
      ${'completed'},
      ${input.transactionUserId ?? sender.id},
      ${input.transactionCounterpartyUserId ?? recipient.id},
      ${transactionAmountCents},
      ${currency},
      ${input.stripeConnectAccountId ?? recipientWallet.stripeConnect.accountId},
      ${JSON.stringify(input.transactionMetadata ?? {})}::jsonb,
      NOW(),
      NOW()
    )
  `

  await insertCivilCreditLedgerEntry(db, {
    id: input.transferLedger.id,
    eventId: input.transferLedger.eventId,
    entryType: input.transferLedger.entryType ?? 'transfer',
    status: 'completed',
    amountCents,
    currency,
    from: buildWalletLedgerParty({
      user: sender,
      entityType: input.transferLedger.fromEntityType,
      entityLabel: input.transferLedger.fromEntityLabel,
    }),
    to: {
      ...buildWalletLedgerParty({
        user: recipient,
        entityType: input.transferLedger.toEntityType,
        entityLabel: input.transferLedger.toEntityLabel,
      }),
      userId: input.transferLedger.toUserId === undefined ? recipient.id : input.transferLedger.toUserId,
      handle: input.transferLedger.toHandle === undefined ? recipient.handle ?? null : input.transferLedger.toHandle,
      name: input.transferLedger.toName === undefined ? recipient.name ?? null : input.transferLedger.toName,
    },
    sourceType: input.transferLedger.sourceType,
    sourceReferenceId: input.transferLedger.sourceReferenceId,
    stripeConnectAccountId: input.stripeConnectAccountId ?? recipientWallet.stripeConnect.accountId,
    description: input.transferLedger.description,
    metadata: input.transferLedger.metadata,
  })

  if (feeCents > 0 && input.feeLedger) {
    await insertCivilCreditLedgerEntry(db, {
      id: input.feeLedger.id,
      eventId: input.feeLedger.eventId,
      entryType: input.feeLedger.entryType ?? 'adjustment',
      status: 'completed',
      amountCents: feeCents,
      currency,
      from: buildWalletLedgerParty({
        user: sender,
        entityType: input.feeLedger.fromEntityType,
        entityLabel: input.feeLedger.fromEntityLabel,
      }),
      to: {
        entityType: input.feeLedger.toEntityType ?? 'platform',
        userId: input.feeLedger.toUserId ?? null,
        handle: input.feeLedger.toHandle ?? null,
        name: input.feeLedger.toName ?? null,
        entityLabel: input.feeLedger.toEntityLabel ?? 'Civil fee',
      },
      sourceType: input.feeLedger.sourceType,
      sourceReferenceId: input.feeLedger.sourceReferenceId,
      description: input.feeLedger.description,
      metadata: input.feeLedger.metadata,
    })
  }

  return {
    sender,
    recipient,
    senderWallet,
    recipientWallet,
    amountCents,
    feeCents,
    totalChargeCents,
    transactionAmountCents,
  }
}

export async function applyWalletDebit(
  db: WalletTransactionDbClient,
  input: ApplyWalletDebitInput,
) {
  await ensureCitizenWalletTables()

  const amountCents = clampCurrency(input.amountCents)
  const transactionAmountCents = clampCurrency(input.transactionAmountCents ?? amountCents)
  const currency = normalizeCurrency(input.currency)
  const errors = input.errors ?? {}

  const sender = await db.user.findUnique({
    where: { id: input.senderUserId },
    select: { id: true, handle: true, name: true, communityMeta: true },
  })

  if (!sender) {
    throw new Error(errors.userNotFound ?? 'user_not_found')
  }

  const senderWallet = readWalletSummary(sender.communityMeta)
  if ((input.requireSenderWalletEnabled ?? true) && !senderWallet.enabled) {
    throw new Error(errors.senderWalletDisabled ?? 'wallet_required')
  }
  if (senderWallet.civilCreditsCents < amountCents) {
    throw new Error(errors.insufficientFunds ?? 'insufficient_wallet_balance')
  }

  const senderMeta = readBaseJsonObject(sender.communityMeta)
  senderMeta.wallet = buildWalletMetaValue({
    ...senderWallet,
    civilCreditsCents: senderWallet.civilCreditsCents - amountCents,
  })

  await db.user.update({ where: { id: sender.id }, data: { communityMeta: senderMeta } })

  await db.$executeRaw`
    INSERT INTO citizen_wallet_transaction (
      id,
      kind,
      status,
      user_id,
      counterparty_user_id,
      amount_cents,
      currency,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${input.transactionId},
      ${input.transactionKind},
      ${'completed'},
      ${input.transactionUserId ?? sender.id},
      ${input.transactionCounterpartyUserId ?? null},
      ${transactionAmountCents},
      ${currency},
      ${JSON.stringify(input.transactionMetadata ?? {})}::jsonb,
      NOW(),
      NOW()
    )
  `

  await insertCivilCreditLedgerEntry(db, {
    id: input.ledger.id,
    eventId: input.ledger.eventId,
    entryType: input.ledger.entryType ?? 'transfer',
    status: 'completed',
    amountCents,
    currency,
    from: buildWalletLedgerParty({
      user: sender,
      entityType: input.ledger.fromEntityType,
      entityLabel: input.ledger.fromEntityLabel,
    }),
    to: {
      entityType: input.ledger.toEntityType ?? 'platform_wallet',
      userId: input.ledger.toUserId ?? null,
      handle: input.ledger.toHandle ?? null,
      name: input.ledger.toName ?? null,
      entityLabel: input.ledger.toEntityLabel ?? 'Civil',
    },
    sourceType: input.ledger.sourceType,
    sourceReferenceId: input.ledger.sourceReferenceId,
    description: input.ledger.description,
    metadata: input.ledger.metadata,
  })

  return {
    sender,
    senderWallet,
    amountCents,
    transactionAmountCents,
  }
}