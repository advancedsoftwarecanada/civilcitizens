import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import type Stripe from 'stripe'
import {
  CAUSE_MAXIMUM_CONTRIBUTION_CENTS,
  CAUSE_MAXIMUM_GOAL_CENTS,
  CAUSE_MINIMUM_CONTRIBUTION_CENTS,
  CAUSE_MINIMUM_GOAL_CENTS,
  calculateCausePlatformFeeCents,
} from '@civil/shared'
import {
  buildWalletMetaValue,
  ensureCitizenWalletTables,
  insertCivilCreditLedgerEntry,
  readBaseJsonObject,
  readWalletSummary,
} from './walletHelpers.js'
import { applyWalletUserTransfer } from './walletTransactions.js'
import { CAUSE_NOTIFICATION_TYPES } from './notificationHelpers.js'

type CauseDbClient = typeof prisma | Prisma.TransactionClient

type CreateNotificationRecordFn = (data: {
  userId: string
  actorId: string | null
  type: string
  postId?: string | null
  payload?: Prisma.InputJsonValue
  suppressMobilePush?: boolean
}) => Promise<unknown>

export type CauseStageGoal = {
  id: string
  amountCents: number
  description: string
  sortOrder: number
}

export type CauseSummary = {
  postId: string
  publishedDraftId: string | null
  goalAmountCents: number
  stageGoals: CauseStageGoal[]
  raisedAmountCents: number
  contributionCount: number
  progressPercent: number
  remainingAmountCents: number
  status: 'active' | 'funded' | 'closed'
  createdAt: Date | null
  updatedAt: Date | null
  lastContributionAt: Date | null
}

export type CauseSubscriptionSummary = {
  id: string
  postId: string
  postTitle: string | null
  postSlug: string | null
  provinceCode: string | null
  communitySlug: string | null
  creatorUserId: string
  creatorHandle: string | null
  creatorName: string | null
  amountCents: number
  intervalUnit: 'monthly'
  status: 'active' | 'paused' | 'canceled'
  nextChargeAt: Date | null
  lastChargeAt: Date | null
  pausedAt: Date | null
  canceledAt: Date | null
  createdAt: Date
  updatedAt: Date
  communityPath: string | null
  userPath: string | null
}

export type CauseDraft = {
  id: string
  creatorUserId: string
  title: string
  body: string
  mediaUrl: string | null
  images: string[]
  goalAmountCents: number
  stageGoals: CauseStageGoal[]
  provinceCode: string | null
  communitySlug: string | null
  publishedPostId: string | null
  createdAt: Date
  updatedAt: Date
}

type CauseSubscriptionId = string

type CauseRow = {
  post_id: string
  goal_amount_cents: number
  stage_goals: unknown
  raised_amount_cents: number
  contribution_count: number
  status: string
  created_at: Date | null
  updated_at: Date | null
  last_contribution_at: Date | null
}

type CauseDraftRow = {
  id: string
  creator_user_id: string
  title: string
  body: string
  media_url: string | null
  images: unknown
  goal_amount_cents: number
  stage_goals: unknown
  province_code: string | null
  community_slug: string | null
  published_post_id: string | null
  created_at: Date
  updated_at: Date
}

type CauseSubscriptionRow = {
  id: string
  post_id: string
  post_title: string | null
  post_slug: string | null
  province_code: string | null
  community_slug: string | null
  creator_user_id: string
  creator_handle: string | null
  creator_name: string | null
  amount_cents: number
  interval_unit: string
  status: string
  next_charge_at: Date | null
  last_charge_at: Date | null
  paused_at: Date | null
  canceled_at: Date | null
  created_at: Date
  updated_at: Date
}

type CauseSubscriptionNotificationRow = {
  id: string
  post_id: string
  post_title: string | null
  post_slug: string | null
  province_code: string | null
  community_slug: string | null
  amount_cents: number
  subscriber_user_id: string
  subscriber_handle: string | null
  subscriber_name: string | null
  recipient_user_id: string
  recipient_handle: string | null
  recipient_name: string | null
}

type CauseContributionNotificationRow = {
  post_id: string
  post_title: string | null
  post_slug: string | null
  province_code: string | null
  community_slug: string | null
  amount_cents: number
  contributor_user_id: string
  contributor_handle: string | null
  contributor_name: string | null
  recipient_user_id: string
  recipient_handle: string | null
  recipient_name: string | null
}

let civilCauseTablesReady: Promise<void> | null = null

function normalizeCauseStatus(value: string | null | undefined): CauseSummary['status'] {
  if (value === 'funded' || value === 'closed') return value
  return 'active'
}

function clampCurrency(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

function normalizeCauseSubscriptionStatus(value: string | null | undefined): CauseSubscriptionSummary['status'] {
  if (value === 'paused' || value === 'canceled') return value
  return 'active'
}

function normalizeCauseStageGoals(value: unknown): CauseStageGoal[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : randomUUID()
      const description = typeof record.description === 'string' ? record.description.trim() : ''
      const amountCents = clampCurrency(typeof record.amountCents === 'number' ? record.amountCents : Number(record.amountCents ?? 0))
      const sortOrder = Number.isFinite(Number(record.sortOrder)) ? Math.max(0, Math.round(Number(record.sortOrder))) : index
      if (!description && amountCents <= 0) return null
      return { id, description, amountCents, sortOrder }
    })
    .filter((item): item is CauseStageGoal => Boolean(item))
    .sort((left, right) => left.sortOrder - right.sortOrder)
}

function serializeCauseStageGoals(goals: CauseStageGoal[]) {
  return JSON.stringify(
    goals.map((goal, index) => ({
      id: goal.id,
      amountCents: clampCurrency(goal.amountCents),
      description: goal.description.trim(),
      sortOrder: index,
    })),
  )
}

function normalizeCauseDraftImages(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item): item is string => Boolean(item))
}

function mapCauseRow(row: CauseRow): CauseSummary {
  const goalAmountCents = clampCurrency(row.goal_amount_cents)
  const stageGoals = normalizeCauseStageGoals(row.stage_goals)
  const raisedAmountCents = clampCurrency(row.raised_amount_cents)
  const contributionCount = Math.max(0, Math.round(row.contribution_count || 0))
  const remainingAmountCents = Math.max(0, goalAmountCents - raisedAmountCents)
  const progressPercent = goalAmountCents > 0 ? Math.max(0, Math.min(100, Math.ceil((raisedAmountCents / goalAmountCents) * 100))) : 0

  return {
    postId: row.post_id,
    publishedDraftId: null,
    goalAmountCents,
    stageGoals,
    raisedAmountCents,
    contributionCount,
    progressPercent,
    remainingAmountCents,
    status: normalizeCauseStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastContributionAt: row.last_contribution_at,
  }
}

function mapPublishedCauseDraftRow(row: CauseDraftRow): CauseSummary | null {
  const postId = row.published_post_id?.trim()
  if (!postId) return null

  const goalAmountCents = clampCurrency(row.goal_amount_cents)
  const stageGoals = normalizeCauseStageGoals(row.stage_goals)

  return {
    postId,
    publishedDraftId: row.id,
    goalAmountCents,
    stageGoals,
    raisedAmountCents: 0,
    contributionCount: 0,
    progressPercent: 0,
    remainingAmountCents: goalAmountCents,
    status: 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastContributionAt: null,
  }
}

async function loadPublishedCauseDraftRows(postIds: string[]) {
  const uniquePostIds = Array.from(new Set(postIds)).filter(Boolean)
  if (!uniquePostIds.length) return [] as CauseDraftRow[]

  return prisma.$queryRaw<CauseDraftRow[]>`
    SELECT id, creator_user_id, title, body, goal_amount_cents, stage_goals, province_code, community_slug, published_post_id, created_at, updated_at
    FROM civil_cause_draft
    WHERE published_post_id IN (${Prisma.join(uniquePostIds)})
  `
}

export async function backfillCauseRecordsFromDrafts(postIds: string[]) {
  const fallbackDraftRows = await loadPublishedCauseDraftRows(postIds)
  if (!fallbackDraftRows.length) {
    return {
      repairedPostIds: [] as string[],
      summariesByPost: {} as Record<string, CauseSummary>,
    }
  }

  const repairedPostIds: string[] = []
  await Promise.allSettled(
    fallbackDraftRows.map(async (row: CauseDraftRow) => {
      if (!row.published_post_id) return
      await createCauseRecord(prisma, {
        postId: row.published_post_id,
        creatorUserId: row.creator_user_id,
        goalAmountCents: row.goal_amount_cents,
        stageGoals: normalizeCauseStageGoals(row.stage_goals),
      })
      repairedPostIds.push(row.published_post_id)
    }),
  )

  const summariesByPost: Record<string, CauseSummary> = {}
  for (const row of fallbackDraftRows) {
    const summary = mapPublishedCauseDraftRow(row)
    if (summary) {
      summariesByPost[summary.postId] = summary
    }
  }

  return {
    repairedPostIds,
    summariesByPost,
  }
}

export async function loadMissingPublishedCauseDraftRows() {
  await ensureCivilCauseTables()
  return prisma.$queryRaw<CauseDraftRow[]>`
    SELECT d.id, d.creator_user_id, d.title, d.body, d.goal_amount_cents, d.stage_goals, d.province_code, d.community_slug, d.published_post_id, d.created_at, d.updated_at
    FROM civil_cause_draft d
    LEFT JOIN civil_cause c ON c.post_id = d.published_post_id
    WHERE d.published_post_id IS NOT NULL
      AND c.post_id IS NULL
  `
}

function mapCauseDraftRow(row: CauseDraftRow): CauseDraft {
  return {
    id: row.id,
    creatorUserId: row.creator_user_id,
    title: row.title,
    body: row.body,
    mediaUrl: typeof row.media_url === 'string' && row.media_url.trim() ? row.media_url.trim() : null,
    images: normalizeCauseDraftImages(row.images),
    goalAmountCents: clampCurrency(row.goal_amount_cents),
    stageGoals: normalizeCauseStageGoals(row.stage_goals),
    provinceCode: row.province_code,
    communitySlug: row.community_slug,
    publishedPostId: row.published_post_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapCauseSubscriptionRow(row: CauseSubscriptionRow): CauseSubscriptionSummary {
  const communityPath = row.province_code && row.community_slug && row.post_slug
    ? `/${row.province_code.toLowerCase()}/${row.community_slug.toLowerCase()}/causes/${row.post_slug}`
    : null
  const userPath = row.creator_handle && row.post_slug ? `/u/${row.creator_handle}/posts/${row.post_slug}` : null

  return {
    id: row.id,
    postId: row.post_id,
    postTitle: row.post_title,
    postSlug: row.post_slug,
    provinceCode: row.province_code,
    communitySlug: row.community_slug,
    creatorUserId: row.creator_user_id,
    creatorHandle: row.creator_handle,
    creatorName: row.creator_name,
    amountCents: clampCurrency(row.amount_cents),
    intervalUnit: row.interval_unit === 'monthly' ? 'monthly' : 'monthly',
    status: normalizeCauseSubscriptionStatus(row.status),
    nextChargeAt: row.next_charge_at,
    lastChargeAt: row.last_charge_at,
    pausedAt: row.paused_at,
    canceledAt: row.canceled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    communityPath,
    userPath,
  }
}

function buildCausePostPath(args: {
  postSlug: string | null
  provinceCode: string | null
  communitySlug: string | null
  creatorHandle: string | null
}) {
  if (!args.postSlug) return '/wallet'
  if (args.provinceCode && args.communitySlug) {
    return `/${args.provinceCode.toLowerCase()}/${args.communitySlug.toLowerCase()}/causes/${args.postSlug}`
  }
  if (args.creatorHandle) {
    return `/u/${args.creatorHandle}/posts/${args.postSlug}`
  }
  return '/wallet'
}

async function loadCauseSubscriptionNotificationRow(
  db: CauseDbClient,
  subscriptionId: string,
): Promise<CauseSubscriptionNotificationRow | null> {
  const rows = await db.$queryRaw<CauseSubscriptionNotificationRow[]>`
    SELECT
      sub.id,
      sub.post_id,
      post.title AS post_title,
      post."seoSlug" AS post_slug,
      post."provinceCode" AS province_code,
      post."communitySlug" AS community_slug,
      sub.amount_cents,
      subscriber.id AS subscriber_user_id,
      subscriber.handle AS subscriber_handle,
      subscriber.name AS subscriber_name,
      recipient.id AS recipient_user_id,
      recipient.handle AS recipient_handle,
      recipient.name AS recipient_name
    FROM civil_cause_subscription sub
    JOIN "Post" post ON post.id = sub.post_id
    JOIN "User" subscriber ON subscriber.id = sub.subscriber_user_id
    JOIN "User" recipient ON recipient.id = sub.recipient_user_id
    WHERE sub.id = ${subscriptionId}
    LIMIT 1
  `
  return rows[0] ?? null
}

async function notifyCauseSubscriptionStarted(
  createNotificationRecord: CreateNotificationRecordFn | undefined,
  context: CauseSubscriptionNotificationRow | null,
) {
  if (!createNotificationRecord || !context) return

  const causeUrl = buildCausePostPath({
    postSlug: context.post_slug,
    provinceCode: context.province_code,
    communitySlug: context.community_slug,
    creatorHandle: context.recipient_handle,
  })

  await Promise.allSettled([
    createNotificationRecord({
      userId: context.subscriber_user_id,
      actorId: context.recipient_user_id,
      type: CAUSE_NOTIFICATION_TYPES.SUBSCRIPTION_STARTED_SUBSCRIBER,
      postId: context.post_id,
      payload: {
        subscriptionId: context.id,
        amountCents: context.amount_cents,
        postTitle: context.post_title,
        url: '/wallet',
      },
    }),
    createNotificationRecord({
      userId: context.recipient_user_id,
      actorId: context.subscriber_user_id,
      type: CAUSE_NOTIFICATION_TYPES.SUBSCRIPTION_STARTED_CREATOR,
      postId: context.post_id,
      payload: {
        subscriptionId: context.id,
        amountCents: context.amount_cents,
        postTitle: context.post_title,
        url: causeUrl,
      },
    }),
  ])
}

async function notifyCauseSubscriptionCharged(
  createNotificationRecord: CreateNotificationRecordFn | undefined,
  context: CauseSubscriptionNotificationRow | null,
) {
  if (!createNotificationRecord || !context) return

  const causeUrl = buildCausePostPath({
    postSlug: context.post_slug,
    provinceCode: context.province_code,
    communitySlug: context.community_slug,
    creatorHandle: context.recipient_handle,
  })

  await Promise.allSettled([
    createNotificationRecord({
      userId: context.subscriber_user_id,
      actorId: context.recipient_user_id,
      type: CAUSE_NOTIFICATION_TYPES.SUBSCRIPTION_CHARGED_SUBSCRIBER,
      postId: context.post_id,
      payload: {
        subscriptionId: context.id,
        amountCents: context.amount_cents,
        postTitle: context.post_title,
        url: '/wallet',
      },
    }),
    createNotificationRecord({
      userId: context.recipient_user_id,
      actorId: context.subscriber_user_id,
      type: CAUSE_NOTIFICATION_TYPES.SUBSCRIPTION_CHARGED_CREATOR,
      postId: context.post_id,
      payload: {
        subscriptionId: context.id,
        amountCents: context.amount_cents,
        postTitle: context.post_title,
        url: causeUrl,
      },
    }),
  ])
}

async function loadCauseContributionNotificationRow(
  db: CauseDbClient,
  input: {
    postId: string
    contributorUserId: string
    recipientUserId: string
    amountCents: number
  },
): Promise<CauseContributionNotificationRow | null> {
  const rows = await db.$queryRaw<CauseContributionNotificationRow[]>`
    SELECT
      post.id AS post_id,
      post.title AS post_title,
      post."seoSlug" AS post_slug,
      post."provinceCode" AS province_code,
      post."communitySlug" AS community_slug,
      ${input.amountCents}::int AS amount_cents,
      contributor.id AS contributor_user_id,
      contributor.handle AS contributor_handle,
      contributor.name AS contributor_name,
      recipient.id AS recipient_user_id,
      recipient.handle AS recipient_handle,
      recipient.name AS recipient_name
    FROM "Post" post
    JOIN "User" contributor ON contributor.id = ${input.contributorUserId}
    JOIN "User" recipient ON recipient.id = ${input.recipientUserId}
    WHERE post.id = ${input.postId}
    LIMIT 1
  `

  return rows[0] ?? null
}

async function notifyCauseContributionReceived(
  createNotificationRecord: CreateNotificationRecordFn | undefined,
  context: CauseContributionNotificationRow | null,
) {
  if (!createNotificationRecord || !context) return

  const causeUrl = buildCausePostPath({
    postSlug: context.post_slug,
    provinceCode: context.province_code,
    communitySlug: context.community_slug,
    creatorHandle: context.recipient_handle,
  })

  await createNotificationRecord({
    userId: context.recipient_user_id,
    actorId: context.contributor_user_id,
    type: CAUSE_NOTIFICATION_TYPES.CONTRIBUTION_RECEIVED_CREATOR,
    postId: context.post_id,
    payload: {
      amountCents: context.amount_cents,
      postTitle: context.post_title,
      url: causeUrl,
    },
  })
}

async function applyWalletCauseContribution(
  tx: Prisma.TransactionClient,
  input: {
    postId: string
    contributorUserId: string
    recipientUserId: string
    amountCents: number
    feeCents?: number
    totalChargeCents?: number
    contributionId?: string
    sourceType: 'cause_contribution_wallet' | 'cause_subscription_charge'
    sourceReferenceId: string
    description: string
    metadata?: Record<string, unknown>
  },
) {
  const amountCents = clampCurrency(input.amountCents)
  const feeCents = clampCurrency(input.feeCents ?? calculateCausePlatformFeeCents(amountCents))
  const totalChargeCents = clampCurrency(input.totalChargeCents ?? amountCents + feeCents)

  if (amountCents < CAUSE_MINIMUM_CONTRIBUTION_CENTS || amountCents > CAUSE_MAXIMUM_CONTRIBUTION_CENTS) {
    throw new Error('invalid_contribution_amount')
  }

  const causeRows = await tx.$queryRaw<Array<{ creator_user_id: string; goal_amount_cents: number; raised_amount_cents: number; status: string }>>`
    SELECT creator_user_id, goal_amount_cents, raised_amount_cents, status
    FROM civil_cause
    WHERE post_id = ${input.postId}
    LIMIT 1
  `
  const cause = causeRows[0]
  if (!cause || cause.creator_user_id !== input.recipientUserId) throw new Error('cause_not_found')
  if (normalizeCauseStatus(cause.status) !== 'active') throw new Error('cause_inactive')

  const contributionId = input.contributionId ?? `${input.sourceType}:${input.sourceReferenceId}`
  const nextRaisedAmount = clampCurrency((cause.raised_amount_cents || 0) + amountCents)
  const nextStatus = nextRaisedAmount >= clampCurrency(cause.goal_amount_cents) ? 'funded' : 'active'

  await applyWalletUserTransfer(tx, {
    senderUserId: input.contributorUserId,
    recipientUserId: input.recipientUserId,
    amountCents,
    feeCents,
    totalChargeCents,
    transactionId: input.sourceReferenceId,
    transactionKind: input.sourceType,
    transactionAmountCents: totalChargeCents,
    transactionMetadata: {
      kind: input.sourceType,
      sourceReferenceId: input.sourceReferenceId,
      ...(input.metadata ?? {}),
    },
    requireRecipientConnectPayouts: true,
    errors: {
      recipientWalletUnavailable: 'cause_payout_unavailable',
      insufficientFunds: 'insufficient_wallet_balance',
    },
    transferLedger: {
      id: `${input.sourceReferenceId}:transfer`,
      eventId: `${input.sourceReferenceId}:transfer`,
      sourceType: input.sourceType,
      sourceReferenceId: input.sourceReferenceId,
      description: input.description,
      metadata: {
        contributionAmountCents: amountCents,
        totalChargeCents,
        ...(input.metadata ?? {}),
      },
    },
    feeLedger: {
      id: `${input.sourceReferenceId}:fee`,
      eventId: `${input.sourceReferenceId}:fee`,
      entryType: 'adjustment',
      sourceType: input.sourceType === 'cause_subscription_charge' ? 'cause_subscription_fee' : 'cause_contribution_fee',
      sourceReferenceId: input.sourceReferenceId,
      description: 'Civil Cause fee',
      metadata: {
        feeCents,
        ...(input.metadata ?? {}),
      },
    },
  })

  await tx.$executeRaw`
    INSERT INTO civil_cause_contribution (
      id,
      post_id,
      contributor_user_id,
      recipient_user_id,
      amount_cents,
      fee_cents,
      total_charge_cents,
      currency,
      status,
      stripe_payment_intent_id,
      stripe_charge_id,
      metadata,
      confirmed_at,
      updated_at
    )
    VALUES (
      ${contributionId},
      ${input.postId},
      ${input.contributorUserId},
      ${input.recipientUserId},
      ${amountCents},
      ${feeCents},
      ${totalChargeCents},
      ${'cad'},
      ${'completed'},
      ${null},
      ${null},
      ${JSON.stringify({
        kind: input.sourceType,
        sourceReferenceId: input.sourceReferenceId,
        ...(input.metadata ?? {}),
      })}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT (id)
    DO NOTHING
  `

  await tx.$executeRaw`
    UPDATE civil_cause
    SET
      raised_amount_cents = raised_amount_cents + ${amountCents},
      contribution_count = contribution_count + 1,
      status = ${nextStatus},
      last_contribution_at = NOW(),
      updated_at = NOW()
    WHERE post_id = ${input.postId}
  `

}

export async function ensureCivilCauseTables() {
  if (!civilCauseTablesReady) {
    civilCauseTablesReady = (async () => {
      const statements = [
        `
          CREATE TABLE IF NOT EXISTS civil_cause (
            post_id TEXT PRIMARY KEY REFERENCES "Post"(id) ON DELETE CASCADE,
            creator_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
            goal_amount_cents INTEGER NOT NULL CHECK (goal_amount_cents BETWEEN ${CAUSE_MINIMUM_GOAL_CENTS} AND ${CAUSE_MAXIMUM_GOAL_CENTS}),
            stage_goals JSONB NOT NULL DEFAULT '[]'::jsonb,
            raised_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (raised_amount_cents >= 0),
            contribution_count INTEGER NOT NULL DEFAULT 0 CHECK (contribution_count >= 0),
            status TEXT NOT NULL DEFAULT 'active',
            last_contribution_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_cause_creator_user_id_idx
          ON civil_cause (creator_user_id, created_at DESC)
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_cause_status_idx
          ON civil_cause (status, created_at DESC)
        `,
        `
          CREATE TABLE IF NOT EXISTS civil_cause_draft (
            id TEXT PRIMARY KEY,
            creator_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
            title TEXT NOT NULL DEFAULT 'Untitled Cause',
            body TEXT NOT NULL DEFAULT '',
            media_url TEXT,
            images JSONB NOT NULL DEFAULT '[]'::jsonb,
            goal_amount_cents INTEGER NOT NULL CHECK (goal_amount_cents BETWEEN ${CAUSE_MINIMUM_GOAL_CENTS} AND ${CAUSE_MAXIMUM_GOAL_CENTS}),
            stage_goals JSONB NOT NULL DEFAULT '[]'::jsonb,
            province_code TEXT,
            community_slug TEXT,
            published_post_id TEXT UNIQUE REFERENCES "Post"(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_cause_draft_creator_user_id_idx
          ON civil_cause_draft (creator_user_id, updated_at DESC)
        `,
        `
          ALTER TABLE civil_cause
          ADD COLUMN IF NOT EXISTS stage_goals JSONB NOT NULL DEFAULT '[]'::jsonb
        `,
        `
          ALTER TABLE civil_cause
          ADD COLUMN IF NOT EXISTS raised_amount_cents INTEGER NOT NULL DEFAULT 0
        `,
        `
          ALTER TABLE civil_cause
          ADD COLUMN IF NOT EXISTS contribution_count INTEGER NOT NULL DEFAULT 0
        `,
        `
          ALTER TABLE civil_cause
          ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        `,
        `
          ALTER TABLE civil_cause
          ADD COLUMN IF NOT EXISTS last_contribution_at TIMESTAMPTZ
        `,
        `
          ALTER TABLE civil_cause
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        `,
        `
          ALTER TABLE civil_cause
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        `,
        `
          ALTER TABLE civil_cause_draft
          ADD COLUMN IF NOT EXISTS stage_goals JSONB NOT NULL DEFAULT '[]'::jsonb
        `,
        `
          ALTER TABLE civil_cause_draft
          ADD COLUMN IF NOT EXISTS media_url TEXT
        `,
        `
          ALTER TABLE civil_cause_draft
          ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb
        `,
        `
          ALTER TABLE civil_cause_draft
          ADD COLUMN IF NOT EXISTS province_code TEXT
        `,
        `
          ALTER TABLE civil_cause_draft
          ADD COLUMN IF NOT EXISTS community_slug TEXT
        `,
        `
          ALTER TABLE civil_cause_draft
          ADD COLUMN IF NOT EXISTS published_post_id TEXT
        `,
        `
          CREATE UNIQUE INDEX IF NOT EXISTS civil_cause_draft_published_post_id_uniq
          ON civil_cause_draft (published_post_id)
          WHERE published_post_id IS NOT NULL
        `,
        `
          CREATE TABLE IF NOT EXISTS civil_cause_contribution (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL REFERENCES "Post"(id) ON DELETE CASCADE,
            contributor_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
            recipient_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
            amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN ${CAUSE_MINIMUM_CONTRIBUTION_CENTS} AND ${CAUSE_MAXIMUM_CONTRIBUTION_CENTS}),
            fee_cents INTEGER NOT NULL CHECK (fee_cents >= 0),
            total_charge_cents INTEGER NOT NULL CHECK (total_charge_cents > 0),
            currency TEXT NOT NULL DEFAULT 'cad',
            status TEXT NOT NULL DEFAULT 'pending',
            stripe_payment_intent_id TEXT,
            stripe_charge_id TEXT,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            confirmed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        `
          CREATE UNIQUE INDEX IF NOT EXISTS civil_cause_contribution_payment_intent_uniq
          ON civil_cause_contribution (stripe_payment_intent_id)
          WHERE stripe_payment_intent_id IS NOT NULL
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_cause_contribution_post_id_idx
          ON civil_cause_contribution (post_id, created_at DESC)
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_cause_contribution_recipient_user_id_idx
          ON civil_cause_contribution (recipient_user_id, created_at DESC)
        `,
        `
          CREATE TABLE IF NOT EXISTS civil_cause_subscription (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL REFERENCES "Post"(id) ON DELETE CASCADE,
            subscriber_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
            recipient_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
            amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN ${CAUSE_MINIMUM_CONTRIBUTION_CENTS} AND ${CAUSE_MAXIMUM_CONTRIBUTION_CENTS}),
            interval_unit TEXT NOT NULL DEFAULT 'monthly',
            status TEXT NOT NULL DEFAULT 'active',
            next_charge_at TIMESTAMPTZ,
            last_charge_at TIMESTAMPTZ,
            paused_at TIMESTAMPTZ,
            canceled_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_cause_subscription_subscriber_idx
          ON civil_cause_subscription (subscriber_user_id, status, next_charge_at)
        `,
        `
          CREATE INDEX IF NOT EXISTS civil_cause_subscription_post_idx
          ON civil_cause_subscription (post_id, status, created_at DESC)
        `,
        `
          CREATE UNIQUE INDEX IF NOT EXISTS civil_cause_subscription_active_uniq
          ON civil_cause_subscription (post_id, subscriber_user_id)
          WHERE status IN ('active', 'paused')
        `,
      ]

      for (const statement of statements) {
        await prisma.$executeRawUnsafe(statement)
      }
    })().catch((error) => {
      civilCauseTablesReady = null
      throw error
    })
  }

  await civilCauseTablesReady
}

export async function createCauseRecord(db: CauseDbClient, input: { postId: string; creatorUserId: string; goalAmountCents: number; stageGoals?: CauseStageGoal[] }) {
  await ensureCivilCauseTables()
  await db.$executeRaw`
    INSERT INTO civil_cause (
      post_id,
      creator_user_id,
      goal_amount_cents,
      stage_goals,
      raised_amount_cents,
      contribution_count,
      status,
      updated_at
    )
    VALUES (
      ${input.postId},
      ${input.creatorUserId},
      ${clampCurrency(input.goalAmountCents)},
      ${serializeCauseStageGoals(normalizeCauseStageGoals(input.stageGoals ?? []))}::jsonb,
      0,
      0,
      ${'active'},
      NOW()
    )
    ON CONFLICT (post_id)
    DO UPDATE SET
      goal_amount_cents = EXCLUDED.goal_amount_cents,
      stage_goals = EXCLUDED.stage_goals,
      creator_user_id = EXCLUDED.creator_user_id,
      updated_at = NOW()
  `
}

export async function createCauseDraft(
  db: CauseDbClient,
  input: {
    creatorUserId: string
    title?: string
    mediaUrl?: string | null
    images?: string[]
    goalAmountCents?: number
    stageGoals?: CauseStageGoal[]
    provinceCode?: string | null
    communitySlug?: string | null
  },
) {
  await ensureCivilCauseTables()
  const id = randomUUID()
  const draftImages = normalizeCauseDraftImages(input.images)
  await db.$executeRaw`
    INSERT INTO civil_cause_draft (
      id,
      creator_user_id,
      title,
      body,
      media_url,
      images,
      goal_amount_cents,
      stage_goals,
      province_code,
      community_slug,
      updated_at
    )
    VALUES (
      ${id},
      ${input.creatorUserId},
      ${input.title?.trim() || 'Untitled Cause'},
      ${''},
      ${input.mediaUrl?.trim() || null},
      ${JSON.stringify(draftImages)}::jsonb,
      ${clampCurrency(input.goalAmountCents ?? 250000)},
      ${serializeCauseStageGoals(normalizeCauseStageGoals(input.stageGoals ?? []))}::jsonb,
      ${input.provinceCode ?? null},
      ${input.communitySlug ?? null},
      NOW()
    )
  `

  return loadCauseDraftById(id, input.creatorUserId)
}

export async function loadCauseDraftById(id: string, creatorUserId?: string) {
  await ensureCivilCauseTables()
  const rows = creatorUserId
    ? await prisma.$queryRaw<CauseDraftRow[]>`
      SELECT id, creator_user_id, title, body, media_url, images, goal_amount_cents, stage_goals, province_code, community_slug, published_post_id, created_at, updated_at
        FROM civil_cause_draft
        WHERE id = ${id} AND creator_user_id = ${creatorUserId}
        LIMIT 1
      `
    : await prisma.$queryRaw<CauseDraftRow[]>`
      SELECT id, creator_user_id, title, body, media_url, images, goal_amount_cents, stage_goals, province_code, community_slug, published_post_id, created_at, updated_at
        FROM civil_cause_draft
        WHERE id = ${id}
        LIMIT 1
      `

  const row = rows[0]
  return row ? mapCauseDraftRow(row) : null
}

export async function loadCauseDraftByPublishedPostId(postId: string, creatorUserId?: string) {
  await ensureCivilCauseTables()
  const rows = creatorUserId
    ? await prisma.$queryRaw<CauseDraftRow[]>`
      SELECT id, creator_user_id, title, body, media_url, images, goal_amount_cents, stage_goals, province_code, community_slug, published_post_id, created_at, updated_at
        FROM civil_cause_draft
        WHERE published_post_id = ${postId} AND creator_user_id = ${creatorUserId}
        LIMIT 1
      `
    : await prisma.$queryRaw<CauseDraftRow[]>`
      SELECT id, creator_user_id, title, body, media_url, images, goal_amount_cents, stage_goals, province_code, community_slug, published_post_id, created_at, updated_at
        FROM civil_cause_draft
        WHERE published_post_id = ${postId}
        LIMIT 1
      `

  const row = rows[0]
  return row ? mapCauseDraftRow(row) : null
}

export async function updateCauseDraft(
  db: CauseDbClient,
  input: {
    id: string
    creatorUserId: string
    title?: string
    body?: string
    mediaUrl?: string | null
    images?: string[]
    goalAmountCents?: number
    stageGoals?: CauseStageGoal[]
    provinceCode?: string | null
    communitySlug?: string | null
    publishedPostId?: string | null
  },
) {
  await ensureCivilCauseTables()
  const hasTitle = input.title !== undefined
  const hasBody = input.body !== undefined
  const hasMediaUrl = input.mediaUrl !== undefined
  const hasImages = input.images !== undefined
  const hasGoal = input.goalAmountCents !== undefined
  const hasStageGoals = input.stageGoals !== undefined
  const hasProvinceCode = input.provinceCode !== undefined
  const hasCommunitySlug = input.communitySlug !== undefined
  const hasPublishedPostId = input.publishedPostId !== undefined
  await db.$executeRaw`
    UPDATE civil_cause_draft
    SET
      title = CASE WHEN ${hasTitle} THEN ${input.title ?? ''} ELSE title END,
      body = CASE WHEN ${hasBody} THEN ${input.body ?? ''} ELSE body END,
      media_url = CASE WHEN ${hasMediaUrl} THEN ${input.mediaUrl?.trim() || null} ELSE media_url END,
      images = CASE WHEN ${hasImages} THEN ${JSON.stringify(normalizeCauseDraftImages(input.images ?? []))}::jsonb ELSE images END,
      goal_amount_cents = CASE WHEN ${hasGoal} THEN ${clampCurrency(input.goalAmountCents ?? 0)} ELSE goal_amount_cents END,
      stage_goals = CASE WHEN ${hasStageGoals} THEN ${serializeCauseStageGoals(normalizeCauseStageGoals(input.stageGoals ?? []))}::jsonb ELSE stage_goals END,
      province_code = CASE WHEN ${hasProvinceCode} THEN ${input.provinceCode ?? null} ELSE province_code END,
      community_slug = CASE WHEN ${hasCommunitySlug} THEN ${input.communitySlug ?? null} ELSE community_slug END,
      published_post_id = CASE WHEN ${hasPublishedPostId} THEN ${input.publishedPostId ?? null} ELSE published_post_id END,
      updated_at = NOW()
    WHERE id = ${input.id}
      AND creator_user_id = ${input.creatorUserId}
  `

  return loadCauseDraftById(input.id, input.creatorUserId)
}

export async function loadCauseSummariesByPostIds(postIds: string[]) {
  const uniquePostIds = Array.from(new Set(postIds)).filter(Boolean)
  if (!uniquePostIds.length) return {} as Record<string, CauseSummary>

  try {
    await ensureCivilCauseTables()
  } catch (error) {
    console.error('cause_tables_ensure_failed', error)
    return {} as Record<string, CauseSummary>
  }

  let rows: CauseRow[] = []
  try {
    rows = await prisma.$queryRaw<CauseRow[]>`
      SELECT
        post_id,
        goal_amount_cents,
        stage_goals,
        raised_amount_cents,
        contribution_count,
        status,
        created_at,
        updated_at,
        last_contribution_at
      FROM civil_cause
      WHERE post_id IN (${Prisma.join(uniquePostIds)})
    `
  } catch (error) {
    console.error('cause_live_summary_query_failed', error)
  }

  const out: Record<string, CauseSummary> = {}
  for (const row of rows) {
    out[row.post_id] = mapCauseRow(row)
  }

  let draftRows: CauseDraftRow[] = []
  try {
    draftRows = await loadPublishedCauseDraftRows(uniquePostIds)
  } catch (error) {
    console.error('cause_draft_summary_query_failed', error)
  }
  for (const row of draftRows) {
    const postId = row.published_post_id?.trim()
    if (!postId) continue
    if (out[postId]) {
      out[postId] = {
        ...out[postId],
        publishedDraftId: row.id,
      }
    }
  }

  const missingPostIds = uniquePostIds.filter((postId) => !out[postId])
  if (missingPostIds.length) {
    const fallback = await backfillCauseRecordsFromDrafts(missingPostIds)
    for (const [postId, summary] of Object.entries(fallback.summariesByPost)) {
      out[postId] = summary
    }
  }

  return out
}

export async function applyCauseContributionFromPaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
  createNotificationRecord?: CreateNotificationRecordFn,
) {
  const postId = paymentIntent.metadata?.causePostId?.trim() ?? null
  const contributorUserId = paymentIntent.metadata?.contributorUserId?.trim() ?? null
  const recipientUserId = paymentIntent.metadata?.recipientUserId?.trim() ?? null
  const amountCents = Number.parseInt(paymentIntent.metadata?.causeAmountCents ?? '', 10)
  const feeCents = Number.parseInt(paymentIntent.metadata?.causeFeeCents ?? '', 10)
  const totalChargeCents = Number.parseInt(paymentIntent.metadata?.causeTotalChargeCents ?? '', 10)

  if (!postId || !contributorUserId || !recipientUserId) return false
  if (!Number.isFinite(amountCents) || amountCents < CAUSE_MINIMUM_CONTRIBUTION_CENTS || amountCents > CAUSE_MAXIMUM_CONTRIBUTION_CENTS) {
    return false
  }

  await ensureCivilCauseTables()
  await ensureCitizenWalletTables()

  let applied = false
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM civil_cause_contribution
      WHERE stripe_payment_intent_id = ${paymentIntent.id}
        AND status = ${'completed'}
      LIMIT 1
    `
    if (existing[0]) return

    const causeRows = await tx.$queryRaw<Array<{ creator_user_id: string; goal_amount_cents: number; raised_amount_cents: number; status: string }>>`
      SELECT creator_user_id, goal_amount_cents, raised_amount_cents, status
      FROM civil_cause
      WHERE post_id = ${postId}
      LIMIT 1
    `
    const cause = causeRows[0]
    if (!cause || cause.creator_user_id !== recipientUserId || normalizeCauseStatus(cause.status) !== 'active') return

    const [recipient, contributor] = await Promise.all([
      tx.user.findUnique({ where: { id: recipientUserId }, select: { communityMeta: true, handle: true, name: true } }),
      tx.user.findUnique({ where: { id: contributorUserId }, select: { handle: true, name: true } }),
    ])
    if (!recipient || !contributor) return

    const recipientWallet = readWalletSummary(recipient.communityMeta)
    const baseMeta = readBaseJsonObject(recipient.communityMeta)
    baseMeta.wallet = buildWalletMetaValue({
      ...recipientWallet,
      civilCreditsCents: recipientWallet.civilCreditsCents + amountCents,
    })

    await tx.user.update({ where: { id: recipientUserId }, data: { communityMeta: baseMeta } })

    const contributionId = randomUUID()
    const netRaisedAmount = clampCurrency((cause.raised_amount_cents || 0) + amountCents)
    const nextStatus = netRaisedAmount >= clampCurrency(cause.goal_amount_cents) ? 'funded' : 'active'

    await tx.$executeRaw`
      INSERT INTO civil_cause_contribution (
        id,
        post_id,
        contributor_user_id,
        recipient_user_id,
        amount_cents,
        fee_cents,
        total_charge_cents,
        currency,
        status,
        stripe_payment_intent_id,
        stripe_charge_id,
        metadata,
        confirmed_at,
        updated_at
      )
      VALUES (
        ${contributionId},
        ${postId},
        ${contributorUserId},
        ${recipientUserId},
        ${amountCents},
        ${Number.isFinite(feeCents) ? clampCurrency(feeCents) : calculateCausePlatformFeeCents(amountCents)},
        ${Number.isFinite(totalChargeCents) ? clampCurrency(totalChargeCents) : amountCents + calculateCausePlatformFeeCents(amountCents)},
        ${String(paymentIntent.currency || 'cad').toLowerCase()},
        ${'completed'},
        ${paymentIntent.id},
        ${paymentIntent.latest_charge ? String(paymentIntent.latest_charge) : null},
        ${JSON.stringify({
          kind: paymentIntent.metadata?.kind ?? 'cause_contribution',
          causePostId: postId,
        })}::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (stripe_payment_intent_id)
      DO NOTHING
    `

    await tx.$executeRaw`
      UPDATE civil_cause
      SET
        raised_amount_cents = raised_amount_cents + ${amountCents},
        contribution_count = contribution_count + 1,
        status = ${nextStatus},
        last_contribution_at = NOW(),
        updated_at = NOW()
      WHERE post_id = ${postId}
    `

    await insertCivilCreditLedgerEntry(tx, {
      id: `cause:${paymentIntent.id}`,
      eventId: paymentIntent.id,
      entryType: 'deposit',
      status: 'completed',
      amountCents,
      grossAmountCents: Number.isFinite(totalChargeCents) ? clampCurrency(totalChargeCents) : amountCents + calculateCausePlatformFeeCents(amountCents),
      currency: String(paymentIntent.currency || 'cad').toLowerCase(),
      processingProvider: 'stripe',
      providerProcessingFeeCents: Number.isFinite(feeCents) ? clampCurrency(feeCents) : calculateCausePlatformFeeCents(amountCents),
      occurredAt: new Date(),
      from: {
        entityType: 'external_backer',
        userId: contributorUserId,
        handle: contributor.handle ?? null,
        name: contributor.name ?? null,
        entityLabel: 'Cause backer',
      },
      to: {
        entityType: 'user_wallet',
        userId: recipientUserId,
        handle: recipient.handle ?? null,
        name: recipient.name ?? null,
        entityLabel: 'Civil Wallet',
      },
      sourceType: 'cause_contribution',
      sourceReferenceId: paymentIntent.id,
      stripePaymentIntentId: paymentIntent.id,
      description: 'Civil Cause contribution',
      metadata: {
        causePostId: postId,
        contributionAmountCents: amountCents,
        feeCents: Number.isFinite(feeCents) ? clampCurrency(feeCents) : calculateCausePlatformFeeCents(amountCents),
      },
    })

    applied = true
  })

  if (applied) {
    const notificationContext = await loadCauseContributionNotificationRow(prisma, {
      postId,
      contributorUserId,
      recipientUserId,
      amountCents,
    })
    await notifyCauseContributionReceived(createNotificationRecord, notificationContext)
  }

  return applied
}

export async function applyCauseWalletContributionFromBalance(input: {
  postId: string
  contributorUserId: string
  recipientUserId: string
  amountCents: number
  createNotificationRecord?: CreateNotificationRecordFn
}) {
  await ensureCivilCauseTables()
  await ensureCitizenWalletTables()

  const sourceReferenceId = `cause-wallet:${input.postId}:${input.contributorUserId}:${randomUUID()}`
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await applyWalletCauseContribution(tx, {
      ...input,
      sourceType: 'cause_contribution_wallet',
      sourceReferenceId,
      description: 'Civil Cause contribution',
      metadata: {
        causePostId: input.postId,
      },
    })
  })

  const notificationContext = await loadCauseContributionNotificationRow(prisma, {
    postId: input.postId,
    contributorUserId: input.contributorUserId,
    recipientUserId: input.recipientUserId,
    amountCents: input.amountCents,
  })
  await notifyCauseContributionReceived(input.createNotificationRecord, notificationContext)

  return sourceReferenceId
}

export async function createCauseSubscriptionWithInitialCharge(input: {
  postId: string
  subscriberUserId: string
  recipientUserId: string
  amountCents: number
  createNotificationRecord?: CreateNotificationRecordFn
}) {
  await ensureCivilCauseTables()
  await ensureCitizenWalletTables()

  const amountCents = clampCurrency(input.amountCents)
  const now = new Date()
  const nextChargeAt = addMonths(now, 1)

  let subscriptionId: CauseSubscriptionId = randomUUID()
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existingRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM civil_cause_subscription
      WHERE post_id = ${input.postId}
        AND subscriber_user_id = ${input.subscriberUserId}
        AND status IN ('active', 'paused')
      LIMIT 1
    `
    subscriptionId = existingRows[0]?.id ?? subscriptionId

    const chargeReferenceId = `cause-subscription:${subscriptionId}:${now.toISOString()}`
    await applyWalletCauseContribution(tx, {
      postId: input.postId,
      contributorUserId: input.subscriberUserId,
      recipientUserId: input.recipientUserId,
      amountCents,
      sourceType: 'cause_subscription_charge',
      sourceReferenceId: chargeReferenceId,
      description: 'Civil Cause subscription charge',
      metadata: {
        causePostId: input.postId,
        subscriptionId,
      },
    })

    await tx.$executeRaw`
      INSERT INTO civil_cause_subscription (
        id,
        post_id,
        subscriber_user_id,
        recipient_user_id,
        amount_cents,
        interval_unit,
        status,
        next_charge_at,
        last_charge_at,
        paused_at,
        canceled_at,
        updated_at
      )
      VALUES (
        ${subscriptionId},
        ${input.postId},
        ${input.subscriberUserId},
        ${input.recipientUserId},
        ${amountCents},
        ${'monthly'},
        ${'active'},
        ${nextChargeAt},
        ${now},
        ${null},
        ${null},
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        amount_cents = EXCLUDED.amount_cents,
        status = ${'active'},
        next_charge_at = EXCLUDED.next_charge_at,
        last_charge_at = EXCLUDED.last_charge_at,
        paused_at = NULL,
        canceled_at = NULL,
        updated_at = NOW()
    `
  })

  const notificationContext = await loadCauseSubscriptionNotificationRow(prisma, subscriptionId)
  await notifyCauseSubscriptionStarted(input.createNotificationRecord, notificationContext)

  return getViewerCauseSubscriptionById(subscriptionId, input.subscriberUserId)
}

async function getViewerCauseSubscriptionById(subscriptionId: string, subscriberUserId: string) {
  await ensureCivilCauseTables()
  const rows = await prisma.$queryRaw<CauseSubscriptionRow[]>`
    SELECT
      sub.id,
      sub.post_id,
      post.title AS post_title,
      post."seoSlug" AS post_slug,
      post."provinceCode" AS province_code,
      post."communitySlug" AS community_slug,
      sub.recipient_user_id AS creator_user_id,
      author.handle AS creator_handle,
      author.name AS creator_name,
      sub.amount_cents,
      sub.interval_unit,
      sub.status,
      sub.next_charge_at,
      sub.last_charge_at,
      sub.paused_at,
      sub.canceled_at,
      sub.created_at,
      sub.updated_at
    FROM civil_cause_subscription sub
    JOIN "Post" post ON post.id = sub.post_id
    JOIN "User" author ON author.id = sub.recipient_user_id
    WHERE sub.id = ${subscriptionId}
      AND sub.subscriber_user_id = ${subscriberUserId}
    LIMIT 1
  `

  return rows[0] ? mapCauseSubscriptionRow(rows[0]) : null
}

export async function listViewerCauseSubscriptions(subscriberUserId: string) {
  await ensureCivilCauseTables()
  const rows = await prisma.$queryRaw<CauseSubscriptionRow[]>`
    SELECT
      sub.id,
      sub.post_id,
      post.title AS post_title,
      post."seoSlug" AS post_slug,
      post."provinceCode" AS province_code,
      post."communitySlug" AS community_slug,
      sub.recipient_user_id AS creator_user_id,
      author.handle AS creator_handle,
      author.name AS creator_name,
      sub.amount_cents,
      sub.interval_unit,
      sub.status,
      sub.next_charge_at,
      sub.last_charge_at,
      sub.paused_at,
      sub.canceled_at,
      sub.created_at,
      sub.updated_at
    FROM civil_cause_subscription sub
    JOIN "Post" post ON post.id = sub.post_id
    JOIN "User" author ON author.id = sub.recipient_user_id
    WHERE sub.subscriber_user_id = ${subscriberUserId}
    ORDER BY
      CASE sub.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
      sub.created_at DESC
  `

  return rows.map(mapCauseSubscriptionRow)
}

export async function pauseCauseSubscription(subscriptionId: string, subscriberUserId: string) {
  await ensureCivilCauseTables()
  await prisma.$executeRaw`
    UPDATE civil_cause_subscription
    SET status = ${'paused'}, paused_at = NOW(), updated_at = NOW()
    WHERE id = ${subscriptionId}
      AND subscriber_user_id = ${subscriberUserId}
      AND status = ${'active'}
  `
  return getViewerCauseSubscriptionById(subscriptionId, subscriberUserId)
}

export async function cancelCauseSubscription(subscriptionId: string, subscriberUserId: string) {
  await ensureCivilCauseTables()
  await prisma.$executeRaw`
    UPDATE civil_cause_subscription
    SET status = ${'canceled'}, canceled_at = NOW(), updated_at = NOW()
    WHERE id = ${subscriptionId}
      AND subscriber_user_id = ${subscriberUserId}
      AND status <> ${'canceled'}
  `
  return getViewerCauseSubscriptionById(subscriptionId, subscriberUserId)
}

async function processCauseSubscriptionCharge(input: {
  subscriptionId: string
  subscriberUserId: string
  scheduledAt: Date
  createNotificationRecord?: CreateNotificationRecordFn
}) {
  let notificationContext: CauseSubscriptionNotificationRow | null = null
  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const [subscription] = await tx.$queryRaw<Array<{
        id: string
        post_id: string
        recipient_user_id: string
        amount_cents: number
        next_charge_at: Date | null
        status: string
      }>>`
        SELECT id, post_id, recipient_user_id, amount_cents, next_charge_at, status
        FROM civil_cause_subscription
        WHERE id = ${input.subscriptionId}
          AND subscriber_user_id = ${input.subscriberUserId}
        LIMIT 1
      `
      if (!subscription || normalizeCauseSubscriptionStatus(subscription.status) !== 'active') return 'skipped' as const
      if (!subscription.next_charge_at || subscription.next_charge_at > new Date()) return 'skipped' as const

      try {
        await applyWalletCauseContribution(tx, {
          postId: subscription.post_id,
          contributorUserId: input.subscriberUserId,
          recipientUserId: subscription.recipient_user_id,
          amountCents: subscription.amount_cents,
          sourceType: 'cause_subscription_charge',
          sourceReferenceId: `cause-subscription:${subscription.id}:${input.scheduledAt.toISOString()}`,
          description: 'Civil Cause subscription charge',
          metadata: {
            causePostId: subscription.post_id,
            subscriptionId: subscription.id,
            scheduledChargeAt: input.scheduledAt.toISOString(),
          },
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'insufficient_wallet_balance') {
          await tx.$executeRaw`
            UPDATE civil_cause_subscription
            SET status = ${'paused'}, paused_at = NOW(), updated_at = NOW()
            WHERE id = ${subscription.id}
          `
          return 'paused' as const
        }
        if (error instanceof Error && (error.message === 'cause_inactive' || error.message === 'cause_not_found' || error.message === 'cause_payout_unavailable')) {
          await tx.$executeRaw`
            UPDATE civil_cause_subscription
            SET status = ${'canceled'}, canceled_at = NOW(), updated_at = NOW()
            WHERE id = ${subscription.id}
          `
          return 'canceled' as const
        }
        throw error
      }

      await tx.$executeRaw`
        UPDATE civil_cause_subscription
        SET
          last_charge_at = ${input.scheduledAt},
          next_charge_at = ${addMonths(input.scheduledAt, 1)},
          updated_at = NOW()
        WHERE id = ${subscription.id}
      `

      notificationContext = await loadCauseSubscriptionNotificationRow(tx, subscription.id)
      return 'charged' as const
    })
    if (result === 'charged') {
      await notifyCauseSubscriptionCharged(input.createNotificationRecord, notificationContext)
    }
    return result
  } catch {
    return 'error' as const
  }
}

export async function processDueCauseSubscriptions(subscriberUserId: string) {
  await ensureCivilCauseTables()
  await ensureCitizenWalletTables()

  const dueRows = await prisma.$queryRaw<Array<{
    id: string
    post_id: string
    recipient_user_id: string
    amount_cents: number
    next_charge_at: Date | null
    status: string
  }>>`
    SELECT id, post_id, recipient_user_id, amount_cents, next_charge_at, status
    FROM civil_cause_subscription
    WHERE subscriber_user_id = ${subscriberUserId}
      AND status = ${'active'}
      AND next_charge_at IS NOT NULL
      AND next_charge_at <= NOW()
    ORDER BY next_charge_at ASC
    LIMIT 10
  `

  for (const row of dueRows) {
    await processCauseSubscriptionCharge({
      subscriptionId: row.id,
      subscriberUserId,
      scheduledAt: row.next_charge_at ?? new Date(),
    })
  }
}

export async function processAllDueCauseSubscriptions(options?: {
  batchSize?: number
  maxBatches?: number
  createNotificationRecord?: CreateNotificationRecordFn
}) {
  await ensureCivilCauseTables()
  await ensureCitizenWalletTables()

  const batchSize = Math.max(1, Math.min(250, Math.round(options?.batchSize ?? 100)))
  const maxBatches = Math.max(1, Math.min(20, Math.round(options?.maxBatches ?? 10)))
  let processedCount = 0

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const dueRows = await prisma.$queryRaw<Array<{
      id: string
      subscriber_user_id: string
      next_charge_at: Date | null
    }>>`
      SELECT id, subscriber_user_id, next_charge_at
      FROM civil_cause_subscription
      WHERE status = ${'active'}
        AND next_charge_at IS NOT NULL
        AND next_charge_at <= NOW()
      ORDER BY next_charge_at ASC
      LIMIT ${batchSize}
    `

    if (!dueRows.length) break

    for (const row of dueRows) {
      const result = await processCauseSubscriptionCharge({
        subscriptionId: row.id,
        subscriberUserId: row.subscriber_user_id,
        scheduledAt: row.next_charge_at ?? new Date(),
        createNotificationRecord: options?.createNotificationRecord,
      })
      if (result === 'charged' || result === 'paused' || result === 'canceled') {
        processedCount += 1
      }
    }

    if (dueRows.length < batchSize) break
  }

  return processedCount
}
