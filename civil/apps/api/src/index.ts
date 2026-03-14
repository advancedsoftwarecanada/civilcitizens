import Fastify from 'fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import sse from 'fastify-sse-v2'
import rawBody from 'fastify-raw-body'
import { Queue } from 'bullmq'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { z } from 'zod'
import sanitizeHtml from 'sanitize-html'
import { prisma } from '@civil/db'
import {
  Prisma,
  MediaCategory,
  PremiumStatus,
  BusinessStatus,
  BusinessType,
  StripeWebhookStatus,
  FriendshipStatus,
  ConnectionStatus,
  MessageThreadType,
  MessageCallMode,
  MessageCallStatus,
  MessageType,
  MessageParticipantRole,
  BusinessRole,
  PollResultsVisibility as PrismaPollResultsVisibility,
  ModerationStatus,
  ModerationTargetType,
  ContentReportStatus,
  SupportRequestType,
  SupportRequestStatus,
  ReactionType as PrismaReactionType,
} from '@prisma/client'
import type { City as CityModel } from '@prisma/client'
import {
  CreatePostInput,
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  SetHomeCommunityInput,
  FollowCommunityInput,
  UnfollowCommunityInput,
  UpdateProfileInput,
  EnableFamilyModeInput,
  FamilyMemberInput,
  CursorQuery,
  HandleParam,
  CreateCommentInput,
  ReactPostInput,
  VoteCommentInput,
  VotePollInput,
  AddPollOptionInput,
  UpdateProfilePhotoInput,
  PostSortEnum,
  CommentSortEnum,
  PROVINCES,
  getCommunitiesByProvince,
  findCommunity,
  normalizeProvinceCode,
  getProvinceDisplayName,
  buildHandleBase,
  JurisdictionEnum,
  CommunityGeolocateInput,
  PostalGeolocateInput,
  PostalLookupInput,
  RequestMediaUploadInput,
  CompleteMediaUploadInput,
  MediaAssetIdSchema,
  CitySummarySchema,
  CreateDirectThreadInput,
  CreateGroupThreadInput,
  GroupParticipantInput,
  ResolveGroupThreadInput,
  StartMessageCallInput,
  MessageCallRtcSessionInput,
  SendMessageInput,
  MessageThreadListQuery,
  UpdatePostInput,
  MessageListQuery,
  ThreadReadInput,
  slugifyCommunityName,
} from '@civil/shared'
import bcrypt from 'bcryptjs'
import { Redis as IORedis } from 'ioredis'
import Stripe from 'stripe'
import {
  CIVIL_AI_MAX_REFERENCE_CARDS,
  CIVIL_AI_SERVER_TIMEOUT_MS,
  CivilAiChatInput,
  createCivilAiCoreHelpers,
  formatCivilAiShortDateTime,
  getDefaultCivilPublicHost,
  parseLoggedJsonText,
  readBaseCommunityMeta,
  safeJsonStringify,
  type CivilAiCardReference,
  type CivilAiChatInputPayload,
  type CivilAiChatResponsePayload,
  type CivilAiDebugConversationSummary,
  type CivilAiDebugTurnRecord,
  type CivilAiHistoryEntry,
  type CivilAiJobRow,
  type CivilAiServerConfig,
  type CivilAiViewerContext,
} from './civilAiCore.js'
import {
  createCivilAiSources,
  type CivilAiEventDataItem,
  type CivilAiJobDataItem,
  type CivilAiOrganizationDataItem,
  type CivilAiPostDataItem,
} from './civilAiSources.js'
type DailyCount = { date: string; count: number }
type JobAnalyticsKind = 'job_added' | 'applicant_submitted' | 'applications_viewed' | 'applicant_hired'

const METRIC_TABLES = {
  users: { table: '"User"', column: '"createdAt"' },
  posts: { table: '"Post"', column: '"createdAt"' },
  comments: { table: '"Comment"', column: '"createdAt"' },
  reactions: { table: '"PostReaction"', column: '"createdAt"' },
} as const

type DateRange = { start: Date; end: Date }

async function queryDailyCounts(kind: keyof typeof METRIC_TABLES, range: DateRange): Promise<DailyCount[]> {
  const config = METRIC_TABLES[kind]
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    select date_trunc('day', ${Prisma.raw(config.column)}) as date, count(*)::bigint as count
    from ${Prisma.raw(config.table)}
    where ${Prisma.raw(config.column)} >= ${range.start} and ${Prisma.raw(config.column)} < ${range.end}
    group by 1
    order by 1 asc
  `
  return rows.map((row: { date: Date; count: bigint }) => ({ date: row.date.toISOString(), count: Number(row.count) || 0 }))
}

async function queryFollowSeries(range: DateRange): Promise<DailyCount[]> {
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    select date_trunc('day', created_at) as date, count(*)::bigint as count
    from (
      select "createdAt" as created_at
      from "CommunityFollow"
      where "createdAt" >= ${range.start} and "createdAt" < ${range.end}
      union all
      select "createdAt" as created_at
      from "BusinessFollow"
      where "createdAt" >= ${range.start} and "createdAt" < ${range.end}
    ) follows
    group by 1
    order by 1 asc
  `
  return rows.map((row: { date: Date; count: bigint }) => ({ date: row.date.toISOString(), count: Number(row.count) || 0 }))
}

async function queryPageViewSeries(range: DateRange): Promise<DailyCount[]> {
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    select date_trunc('day', "createdAt") as date, count(*)::bigint as count
    from "PageView"
    where "createdAt" >= ${range.start} and "createdAt" < ${range.end}
    group by 1
    order by 1 asc
  `
  return rows.map((row: { date: Date; count: bigint }) => ({ date: row.date.toISOString(), count: Number(row.count) || 0 }))
}

async function queryJobAnalyticsSeries(kind: JobAnalyticsKind, range: DateRange): Promise<DailyCount[]> {
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    select date_trunc('day', "createdAt") as date, count(*)::bigint as count
    from "JobAnalyticsEvent"
    where "kind" = ${kind}::"JobAnalyticsEventKind"
      and "createdAt" >= ${range.start}
      and "createdAt" < ${range.end}
    group by 1
    order by 1 asc
  `
  return rows.map((row: { date: Date; count: bigint }) => ({ date: row.date.toISOString(), count: Number(row.count) || 0 }))
}

async function trackJobAnalyticsEvent(args: {
  kind: JobAnalyticsKind
  businessId: string
  jobPostingId?: string | null
  jobApplicationId?: string | null
  actorUserId?: string | null
  createdAt?: Date
}) {
  await prisma.$executeRaw`
    INSERT INTO "JobAnalyticsEvent" (
      "id", "kind", "businessId", "jobPostingId", "jobApplicationId", "actorUserId", "createdAt"
    )
    VALUES (
      ${randomUUID()},
      ${args.kind}::"JobAnalyticsEventKind",
      ${args.businessId},
      ${args.jobPostingId ?? null},
      ${args.jobApplicationId ?? null},
      ${args.actorUserId ?? null},
      ${args.createdAt ?? new Date()}
    )
  `
}

function startOfUtcDay(date: Date) {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

const TrackViewInput = z.object({
  path: z.string().min(1),
  postId: z.string().optional(),
  referrer: z.string().optional(),
})

function parseDateInput(value?: string | null, fallbackDays = 30): { start: Date; end: Date } {
  const now = new Date()
  const end = startOfUtcDay(now)
  end.setUTCDate(end.getUTCDate() + 1)

  let start = startOfUtcDay(new Date(now.getTime() - (fallbackDays - 1) * 24 * 60 * 60 * 1000))
  if (value) {
    const candidate = new Date(value)
    if (!Number.isNaN(candidate.getTime())) {
      start = startOfUtcDay(candidate)
    }
  }
  return { start, end }
}

function parseRange(start?: string | null, end?: string | null): DateRange {
  const today = startOfUtcDay(new Date())
  const defaultStart = startOfUtcDay(new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000))
  let rangeStart = defaultStart
  let rangeEnd = startOfUtcDay(new Date(today.getTime() + 24 * 60 * 60 * 1000))

  if (start) {
    const s = new Date(start)
    if (!Number.isNaN(s.getTime())) rangeStart = startOfUtcDay(s)
  }
  if (end) {
    const e = new Date(end)
    if (!Number.isNaN(e.getTime())) {
      const endDay = startOfUtcDay(e)
      endDay.setUTCDate(endDay.getUTCDate() + 1)
      rangeEnd = endDay
    }
  }
  if (rangeEnd <= rangeStart) {
    rangeEnd = startOfUtcDay(new Date(rangeStart.getTime() + 24 * 60 * 60 * 1000))
  }
  return { start: rangeStart, end: rangeEnd }
}

let contentAiScanTablesReady: Promise<void> | null = null
const CIVIL_AI_JOB_TIMEOUT_MS = Math.max(
  CIVIL_AI_SERVER_TIMEOUT_MS,
  Number(process.env.CIVIL_AI_JOB_TIMEOUT_MS || 10 * 60 * 1000) || 10 * 60 * 1000,
)
const civilAiProcessingJobIds = new Set<string>()
const civilAiJobAbortControllers = new Map<string, AbortController>()

type CivilAiJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
async function ensureContentAiScanTables() {
  if (!contentAiScanTablesReady) {
    contentAiScanTablesReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS content_ai_scan (
          id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          owner_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          source_text TEXT,
          image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
          status TEXT NOT NULL DEFAULT 'queued',
          moderation_state TEXT,
          label_summary TEXT,
          search_text TEXT,
          labels JSONB NOT NULL DEFAULT '[]'::jsonb,
          moderation_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
          confidence_score DOUBLE PRECISION,
          server_id TEXT,
          model TEXT,
          error_text TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          raw_response JSONB
        )
      `)
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS content_ai_scan_target_idx
        ON content_ai_scan (target_type, target_id)
      `)
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS content_ai_scan_status_idx
        ON content_ai_scan (status, updated_at DESC)
      `)
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS content_ai_scan_owner_idx
        ON content_ai_scan (owner_user_id, updated_at DESC)
      `)
    })().catch((error) => {
      contentAiScanTablesReady = null
      throw error
    })
  }

  await contentAiScanTablesReady
}

type CivilAiGroundingBundle = {
  retrievalPlan: CivilAiRetrievalPlan
  searchPass: 1 | 2
  targetCommunities: Array<{
    id: string
    communityName: string
    provinceName: string
    communitySlug: string
    provinceCode: string
    href: string
  }>
  events: CivilAiEventDataItem[]
  jobs: CivilAiJobDataItem[]
  market: MarketSearchResultPayload[]
  organizations: CivilAiOrganizationDataItem[]
  posts: CivilAiPostDataItem[]
}

type CivilAiMarketSearchScope = {
  mode: 'global' | 'community' | 'province'
  communities: Array<{ provinceCode: string; communitySlug: string }>
  provinceCodes: string[]
}

type CivilAiRetrievalPlan = {
  wantsProfile: boolean
  wantsEvents: boolean
  wantsJobs: boolean
  wantsMarket: boolean
  wantsCommunities: boolean
  wantsOrganizations: boolean
  wantsPosts: boolean
  todayOnly: boolean
  topicQuery: string
  eventLimit: number
  jobLimit: number
  marketLimit: number
  organizationLimit: number
  postLimit: number
  includeViewerOrganizations: boolean
  reasons: string[]
}

function buildCivilAiCompactList(items: string[], emptyLabel: string, limit = 4) {
  const normalized = items.map((item) => item.trim()).filter(Boolean)
  if (!normalized.length) return emptyLabel
  const visible = normalized.slice(0, limit)
  const remainder = normalized.length - visible.length
  return remainder > 0 ? `${visible.join('; ')}; +${remainder} more` : visible.join('; ')
}

const CIVIL_PUBLIC_HOST = process.env.CIVIL_PUBLIC_HOST || getDefaultCivilPublicHost()

const civilAiCoreHelpers = createCivilAiCoreHelpers({
  civilPublicHost: CIVIL_PUBLIC_HOST,
  normalizeSearchTerm,
  loadViewerAuthContext,
  resolveUserId,
  loadViewerFeedContext: (userId) => loadViewerFeedContext(userId) as Promise<any>,
  parseCommunityMeta: (value) => parseCommunityMeta(value as any),
  normalizeMediaUrl,
  isSelfVerifiedCanadianCitizen: (value) => isSelfVerifiedCanadianCitizen(value as any),
  isExperienceTableMissing,
  sanitizePlainText,
})

const authorizeCivilAiDataRequest = civilAiCoreHelpers.authorizeCivilAiDataRequest
export const buildCivilAiEffectiveQuestion = civilAiCoreHelpers.buildCivilAiEffectiveQuestion as (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => string
export const buildCivilAiPromptInput = civilAiCoreHelpers.buildCivilAiPromptInput as (systemPrompt: string, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => string
const buildCivilCommunityHref = civilAiCoreHelpers.buildCivilCommunityHref
const buildCivilEventHref = civilAiCoreHelpers.buildCivilEventHref
const buildCivilJobHref = civilAiCoreHelpers.buildCivilJobHref
const buildCivilOrganizationHref = civilAiCoreHelpers.buildCivilOrganizationHref
const buildCivilPostHref = civilAiCoreHelpers.buildCivilPostHref
const callCivilAiServer = civilAiCoreHelpers.callCivilAiServer
const callCivilAiServerWithPathFallback = civilAiCoreHelpers.callCivilAiServerWithPathFallback
const ensureCivilAiDebugTables = civilAiCoreHelpers.ensureCivilAiDebugTables
const ensureCivilAiJobTables = civilAiCoreHelpers.ensureCivilAiJobTables
const extractCivilAiMessageContent = civilAiCoreHelpers.extractCivilAiMessageContent
const getCivilApiBaseUrl = civilAiCoreHelpers.getCivilApiBaseUrl
const getCivilPublicBaseUrl = civilAiCoreHelpers.getCivilPublicBaseUrl
const loadCivilAiServersConfig = civilAiCoreHelpers.loadCivilAiServersConfig
const loadCivilAiViewerContext = civilAiCoreHelpers.loadCivilAiViewerContext as (userId: string) => Promise<CivilAiViewerContext | null>
const parseCivilAiCommunityId = civilAiCoreHelpers.parseCivilAiCommunityId
const persistCivilAiDebugTurn = civilAiCoreHelpers.persistCivilAiDebugTurn
const persistCivilAiHistory = civilAiCoreHelpers.persistCivilAiHistory as (userId: string, appendedEntries: CivilAiHistoryEntry[]) => Promise<CivilAiHistoryEntry[]>
const readCivilAiHistory = civilAiCoreHelpers.readCivilAiHistory as (meta: Prisma.JsonValue | null | undefined) => CivilAiHistoryEntry[]
const readCivilAiInstructions = civilAiCoreHelpers.readCivilAiInstructions
const resolveCivilAiModel = civilAiCoreHelpers.resolveCivilAiModel
const resolveCivilAiServer = civilAiCoreHelpers.resolveCivilAiServer
const truncateCivilAiText = civilAiCoreHelpers.truncateCivilAiText

function selectCivilAiActiveMessages(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Array<{ role: 'user' | 'assistant'; content: string }> {
  const latestQuestion = buildCivilAiEffectiveQuestion(messages)
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  if (!latestUser || latestQuestion.trim() === latestUser.content.trim()) {
    return latestQuestion.trim() ? [{ role: 'user', content: latestQuestion.trim() }] : []
  }

  const nonSystemMessages = messages.filter((message): message is { role: 'user' | 'assistant'; content: string } => message.role !== 'system')
  return nonSystemMessages.slice(-4)
}

const civilAiSources = createCivilAiSources({
  parseCivilAiCommunityId: (value) => parseCivilAiCommunityId(value) as any,
  loadFeedActivityEvents: (args) => loadFeedActivityEvents(args as any) as Promise<any>,
  loadFeedActivityJobs: (args) => loadFeedActivityJobs(args as any) as Promise<any>,
  filterCivilAiEventsByWhen: (events, when) => filterCivilAiEventsByWhen(events as any, when) as any,
  normalizeSearchTerm,
  normalizeMediaUrl,
  buildCivilOrganizationHref,
  buildCivilCommunityHref,
  buildCivilPostHref,
  buildCivilEventHref,
  buildCivilJobHref,
  truncatePreviewText,
  stripHtmlToPlainText,
  scoreSearchTextMatch,
  buildSearchableText,
  formatPost: (post) => formatPost(post as any),
  getCanonicalPaths: (post) => getCanonicalPaths(post as any),
})

const loadCivilAiCommunityEvents = civilAiSources.loadCivilAiCommunityEvents
const loadCivilAiCommunityJobs = civilAiSources.loadCivilAiCommunityJobs
const loadCivilAiCommunityOrganizations = civilAiSources.loadCivilAiCommunityOrganizations
const loadCivilAiCommunityPosts = civilAiSources.loadCivilAiCommunityPosts
const toCivilAiCommunityReference = civilAiSources.toCivilAiCommunityReference
const toCivilAiEventReference = civilAiSources.toCivilAiEventReference
const toCivilAiJobReference = civilAiSources.toCivilAiJobReference
const toCivilAiMarketReference = civilAiSources.toCivilAiMarketReference
const toCivilAiOrganizationReference = civilAiSources.toCivilAiOrganizationReference
const toCivilAiPostReference = civilAiSources.toCivilAiPostReference

const civilAiPlanningHelpers = createCivilAiPlanningHelpers({
  maxReferenceCards: CIVIL_AI_MAX_REFERENCE_CARDS,
  getCivilApiBaseUrl,
  truncateCivilAiText,
  normalizeSearchTerm,
  normalizeProvinceCode,
  toCivilAiEventReference: (item) => toCivilAiEventReference(item as any),
  toCivilAiJobReference: (item) => toCivilAiJobReference(item as any),
  toCivilAiMarketReference: (item) => toCivilAiMarketReference(item as any),
  toCivilAiOrganizationReference: (item) => toCivilAiOrganizationReference(item as any),
  toCivilAiPostReference: (item) => toCivilAiPostReference(item as any),
})

const buildCivilAiApiCatalog = civilAiPlanningHelpers.buildCivilAiApiCatalog as (viewerContext: CivilAiViewerContext | null) => Array<{ name: string; endpoint: string; purpose: string }>
const buildCivilAiContextPrompt = civilAiPlanningHelpers.buildCivilAiContextPrompt as (viewerContext: CivilAiViewerContext | null) => string
export const buildCivilAiDirectAnswer = civilAiPlanningHelpers.buildCivilAiDirectAnswer as (question: string, viewerContext: CivilAiViewerContext | null) => {
  content: string
  references: CivilAiCardReference[]
  decision?: Record<string, unknown>
} | null
export const buildCivilAiGroundedAnswer = civilAiPlanningHelpers.buildCivilAiGroundedAnswer as (question: string, bundle: CivilAiGroundingBundle) => {
  content: string
  references: CivilAiCardReference[]
} | null
export const buildCivilAiMarketSearchScope = civilAiPlanningHelpers.buildCivilAiMarketSearchScope as (args: {
  searchPass: 1 | 2
  targetCommunities: Array<{ provinceCode: string; communitySlug: string }>
  defaultCommunities: Array<{ provinceCode: string; communitySlug: string }>
}) => CivilAiMarketSearchScope
export const finalizeCivilAiReferences = civilAiPlanningHelpers.finalizeCivilAiReferences as (question: string, references: CivilAiCardReference[]) => CivilAiCardReference[]
const matchCivilAiRequestedCommunities = civilAiPlanningHelpers.matchCivilAiRequestedCommunities as (
  question: string,
  viewerContext: CivilAiViewerContext | null,
) => Array<NonNullable<CivilAiViewerContext['homeCommunity']>>
export const planCivilAiRetrieval = civilAiPlanningHelpers.planCivilAiRetrieval as (question: string) => CivilAiRetrievalPlan
export const sanitizeCivilAiResponseContent = civilAiPlanningHelpers.sanitizeCivilAiResponseContent as (content: string, references: CivilAiCardReference[]) => string
const shouldCivilAiRunSecondSearch = civilAiPlanningHelpers.shouldCivilAiRunSecondSearch as (
  question: string,
  bundle: any,
) => boolean

type ExperienceModel = Prisma.ExperienceGetPayload<{ select: { id: true; title: true; organization: true; location: true; startDate: true; endDate: true; current: true; description: true; position: true } }>
import { createHash, randomInt, randomUUID } from 'crypto'
import { locateCommunityFromPoint, getCommunityCentroid } from './geodata.js'
import { locateFsaFromPoint } from './fsaLocator.js'
import { statsCanPointToWgs84 } from './statscan.js'
import {
  sendPushToUser,
  validatePushEnvironment,
  type PushPayloadType,
} from './pushSender.js'
import { createCivilAiPlanningHelpers } from './civilAiPlanning.js'
import { createCivilAiExecutionHelpers } from './civilAiExecution.js'
import { registerAdminAiDebugRoutes } from './routes/adminAiDebug.js'
import { registerAdminAnalyticsDetailRoutes } from './routes/adminAnalyticsDetail.js'
import { registerAdminModerationRoutes } from './routes/adminModeration.js'
import { registerAdminReportingRoutes } from './routes/adminReporting.js'
import { registerAdminSystemRoutes } from './routes/adminSystem.js'
import { registerFamilyRoutes } from './routes/family.js'
import { registerMessagesCoreRoutes } from './routes/messagesCore.js'
import { registerMessagesDetailRoutes } from './routes/messagesDetail.js'
import { registerNotificationsSearchRoutes } from './routes/notificationsSearch.js'
import { registerPostInteractionRoutes } from './routes/postInteractions.js'
import { registerPostReadRoutes } from './routes/postRead.js'
import { registerBillingRoutes } from './routes/billing.js'
import { registerBillingWebhookRoutes } from './routes/billingWebhook.js'
import { registerJobRoutes } from './routes/jobs.js'
import { registerAnalyticsNotificationRoutes } from './routes/analyticsNotifications.js'
import { registerOrgChannelRoutes } from './routes/orgChannels.js'
import { registerOrganizationCollectionRoutes } from './routes/organizationCollections.js'
import { registerOrganizationCoreRoutes } from './routes/organizationCore.js'
import { registerOrganizationProfilePhotoRoutes } from './routes/organizationProfilePhoto.js'
import { registerModerationActionRoutes } from './routes/moderationActions.js'
import { registerMarketChatRoutes } from './routes/marketChats.js'
import { registerMarketListingRoutes } from './routes/marketListings.js'
import { registerMarketStorefrontRoutes } from './routes/marketStorefront.js'
import { registerOrganizationShopRoutes } from './routes/organizationShop.js'
import { registerPublicEventOrgPostRoutes } from './routes/publicEventOrgPosts.js'
import { registerProfileInviteRoutes } from './routes/profileInvites.js'
import { registerProfileMediaRoutes } from './routes/profileMedia.js'
import { registerSupportRoutes } from './routes/support.js'
import { registerUserProfilePostRoutes } from './routes/userProfilePosts.js'
import { registerAiRoutes } from './routes/ai.js'
import { registerPushRoutes } from './routes/push.js'
import { registerSocialGraphRoutes } from './routes/socialGraph.js'
import { registerUserConnectionsRoutes } from './routes/userConnections.js'

const PORT = Number(process.env.PORT || 3000)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const MEDIA_S3_ENDPOINT = process.env.MEDIA_S3_ENDPOINT || 'http://127.0.0.1:9000'
const MEDIA_S3_REGION = process.env.MEDIA_S3_REGION || 'us-east-1'
const MEDIA_S3_ACCESS_KEY = process.env.MEDIA_S3_ACCESS_KEY || 'minioadmin'
const MEDIA_S3_SECRET_KEY = process.env.MEDIA_S3_SECRET_KEY || 'minioadmin'
const MEDIA_BUCKET_PUBLIC = process.env.MEDIA_BUCKET_PUBLIC || 'civil-media'
const MEDIA_BUCKET_ORIGINAL = process.env.MEDIA_BUCKET_ORIGINAL || 'civil-media-raw'
const MEDIA_PUBLIC_BASE_URL = (process.env.MEDIA_PUBLIC_BASE_URL || `https://${CIVIL_PUBLIC_HOST}/media`).replace(/\/$/, '')
const MEDIA_SIGNED_URL_TTL = Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS || 900)
const LEGACY_MEDIA_BASE_URLS = [
  'http://localhost:9000/civil-media',
  'http://127.0.0.1:9000/civil-media',
  'http://minio:9000/civil-media',
]

function isPrivateOrLocalNetworkUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host === 'minio') return true
    if (host === '127.0.0.1' || host === '::1') return true
    if (host.startsWith('10.')) return true
    if (host.startsWith('192.168.')) return true

    const match172 = host.match(/^172\.(\d{1,3})\./)
    if (match172) {
      const secondOctet = Number(match172[1])
      if (Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31) return true
    }

    return false
  } catch {
    return false
  }
}

const STRIPE_API_VERSION = '2024-06-20'
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || ''
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''
const STRIPE_PRICE_PREMIUM = process.env.STRIPE_PRICE_PREMIUM_MONTHLY || ''
const STRIPE_PRICE_BUSINESS = process.env.STRIPE_PRICE_BUSINESS_MONTHLY || ''
const STRIPE_PUBLISHABLE_KEY = (process.env.STRIPE_PUBLIC_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim()
const BILLING_PORTAL_RETURN_FALLBACK = process.env.BILLING_RETURN_URL || `https://${CIVIL_PUBLIC_HOST}/settings/billing`
const MAX_BUSINESSES_PER_USER = 5
const DEFAULT_SUPER_ADMINS = ['andrewnormore@gmail.com']
const COMMUNITY_FOLLOW_TARGET = 3
const COMMUNITY_SUGGESTION_CACHE_LIMIT = 10
const NOTIFICATION_CHANNEL_PREFIX = 'chan:notify:'
const REALTIME_ONLINE_KEY_PREFIX = 'presence:notify:'
const REALTIME_ONLINE_TTL_MS = 90_000
const PUSH_REGISTER_SECRET = (process.env.PUSH_REGISTER_SECRET || '').trim()
const PUSH_ADMIN_SECRET = (process.env.PUSH_ADMIN_SECRET || '').trim()
const PUSH_DELIVERY_URL = (process.env.PUSH_DELIVERY_URL || '').trim().replace(/\/$/, '')

function deriveMeetingRtcServiceUrlFromWs(rawValue: string): string {
  const value = rawValue.trim()
  if (!value) return ''
  try {
    const parsed = new URL(value)
    const protocol = parsed.protocol === 'wss:' ? 'https:' : parsed.protocol === 'ws:' ? 'http:' : parsed.protocol
    const normalizedPath = parsed.pathname.replace(/\/+$/, '')
    const pathWithoutWs = normalizedPath.replace(/\/v1\/ws$/i, '')
    return `${protocol}//${parsed.host}${pathWithoutWs}`.replace(/\/$/, '')
  } catch {
    return ''
  }
}

const MEETING_RTC_PORT = String(process.env.CIVIL_MEETING_RTC_PORT || '8788').trim() || '8788'
const MEETING_RTC_SERVICE_URL_FROM_WS = deriveMeetingRtcServiceUrlFromWs(process.env.MEETING_RTC_WS_URL || '')
const DEFAULT_MEETING_RTC_SERVICE_URL =
  MEETING_RTC_SERVICE_URL_FROM_WS ||
  (process.env.NODE_ENV === 'production' ? 'http://meeting-rtc:8788' : `http://127.0.0.1:${MEETING_RTC_PORT}`)
const MEETING_RTC_SERVICE_URL = (process.env.MEETING_RTC_SERVICE_URL || DEFAULT_MEETING_RTC_SERVICE_URL).trim().replace(/\/$/, '')
const MEETING_RTC_SERVICE_SECRET = (process.env.MEETING_RTC_SERVICE_SECRET || '').trim()
const MEETING_RTC_REQUEST_TIMEOUT_MS = Number(process.env.MEETING_RTC_REQUEST_TIMEOUT_MS || 8000)

const PostImpressionTrackInput = z
  .object({
    postIds: z.array(z.string().trim().min(1).max(64)).min(1).max(50),
  })
  .strict()

let pushDeviceRegistryReady: Promise<void> | null = null

function normalizePushToken(rawToken: string): string | null {
  const normalized = rawToken.trim().toLowerCase()
  if (!/^[0-9a-f]{32,512}$/.test(normalized)) return null
  return normalized
}

function getHeaderValue(req: FastifyRequest, key: string): string | null {
  const raw = req.headers[key.toLowerCase()]
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return trimmed.length ? trimmed : null
  }
  if (Array.isArray(raw)) {
    const first = raw[0]
    if (typeof first === 'string') {
      const trimmed = first.trim()
      return trimmed.length ? trimmed : null
    }
  }
  return null
}

function ensurePushDeviceRegistryTable(): Promise<void> {
  if (pushDeviceRegistryReady) return pushDeviceRegistryReady

  pushDeviceRegistryReady = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PushDeviceRegistration" (
        "id" TEXT PRIMARY KEY,
        "token" TEXT NOT NULL,
        "platform" TEXT NOT NULL,
        "bundle_id" TEXT,
        "device_id" TEXT,
        "user_id" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "revoked_at" TIMESTAMPTZ
      );
    `)
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "PushDeviceRegistration_token_platform_key" ON "PushDeviceRegistration" ("token", "platform");',
    )
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "PushDeviceRegistration_user_platform_revoked_idx" ON "PushDeviceRegistration" ("user_id", "platform", "revoked_at");',
    )
  })().catch((err) => {
    pushDeviceRegistryReady = null
    throw err
  })

  return pushDeviceRegistryReady
}

let postImpressionTableReady: Promise<void> | null = null
let postBusinessAuthorColumnReady: Promise<void> | null = null

type UserPostImpressionRow = {
  post_id: string
  first_seen_at: Date
  last_seen_at: Date
  impression_count: number
}

function ensureUserPostImpressionsTable(): Promise<void> {
  if (postImpressionTableReady) return postImpressionTableReady

  postImpressionTableReady = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS user_post_impressions (
        user_id TEXT NOT NULL,
        post_id TEXT NOT NULL,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        impression_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (user_id, post_id)
      );
    `)
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS user_post_impressions_user_last_seen_idx ON user_post_impressions (user_id, last_seen_at DESC);',
    )
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS user_post_impressions_post_idx ON user_post_impressions (post_id);',
    )
  })().catch((err) => {
    postImpressionTableReady = null
    throw err
  })

  return postImpressionTableReady
}

function ensurePostBusinessAuthorColumn(): Promise<void> {
  if (postBusinessAuthorColumnReady) return postBusinessAuthorColumnReady

  postBusinessAuthorColumnReady = (async () => {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Post"
      ADD COLUMN IF NOT EXISTS "showBusinessAuthor" BOOLEAN NOT NULL DEFAULT false;
    `)
  })().catch((err) => {
    postBusinessAuthorColumnReady = null
    throw err
  })

  return postBusinessAuthorColumnReady
}

async function loadUserPostImpressionMap(userId: string, postIds: string[]) {
  const uniquePostIds = Array.from(new Set(postIds)).filter(Boolean)
  const map = new Map<string, { firstSeenAt: Date; lastSeenAt: Date; impressionCount: number }>()
  if (!uniquePostIds.length) return map

  await ensureUserPostImpressionsTable()
  const rows = (await prisma.$queryRaw(Prisma.sql`
    SELECT post_id, first_seen_at, last_seen_at, impression_count
    FROM user_post_impressions
    WHERE user_id = ${userId}
      AND post_id IN (${Prisma.join(uniquePostIds)})
  `)) as UserPostImpressionRow[]
  for (const row of rows) {
    map.set(row.post_id, {
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      impressionCount: Number(row.impression_count) || 0,
    })
  }
  return map
}

async function recordUserPostImpressions(userId: string, postIds: string[]) {
  const uniquePostIds = Array.from(new Set(postIds.map((postId) => postId.trim()).filter(Boolean)))
  if (!uniquePostIds.length) return 0

  await ensureUserPostImpressionsTable()
  await prisma.$transaction(
    uniquePostIds.map((postId) =>
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO user_post_impressions (user_id, post_id, first_seen_at, last_seen_at, impression_count)
        VALUES (${userId}, ${postId}, NOW(), NOW(), 1)
        ON CONFLICT (user_id, post_id)
        DO UPDATE
        SET
          last_seen_at = NOW(),
          impression_count = user_post_impressions.impression_count + 1
      `),
    ),
  )
  return uniquePostIds.length
}

type CitySummaryType = z.infer<typeof CitySummarySchema>

type ProfileFamilyRelationship =
  | 'mother'
  | 'father'
  | 'grandmother'
  | 'grandfather'
  | 'sister'
  | 'brother'
  | 'aunt'
  | 'uncle'
  | 'cousin'
  | 'second_cousin'
  | 'niece'
  | 'nephew'
  | 'wife'
  | 'husband'
  | 'significant_other'
  | 'partner'
  | 'mother_in_law'
  | 'father_in_law'
  | 'sister_in_law'
  | 'brother_in_law'
  | 'daughter_in_law'
  | 'son_in_law'
  | 'other'

type ProfileFamilyRelationshipDirection = 'outbound' | 'inbound'

type CommunityMetaPayload = {
  nearbyCommunities?: CitySummaryType[]
  computedAt?: string
  dateOfBirth?: string
  countryOfBirth?: string
  shareDateOfBirth?: boolean
  shareCountryOfBirth?: boolean
  civicStatus?: 'citizen' | 'permanent_resident' | 'work_permit' | 'study_permit' | 'unspecified'
  workAuthorization?: 'authorized' | 'not_authorized' | 'unspecified'
  verificationMethod?: 'self_declaration'
  statusDeclaredAt?: string
  statusUpdatedAt?: string
  reference?: {
    provinceCode?: string | null
    communitySlug?: string | null
    cityName?: string | null
  } | null
  familyMode?: {
    enabledAt?: string
    affirmedProfileTruthAt?: string
    acceptedChildSafetyInfoAt?: string
  } | null
  familyMemberSettings?: Record<
    string,
    {
      allowChildOwnMediaEdits?: boolean
      allowChildOwnUsernameEdits?: boolean
      allowChildAudioCalls?: boolean
      allowChildVideoCalls?: boolean
      notifyParentOnMediaChanges?: boolean
      username?: string | null
      avatarUrl?: string | null
      coverUrl?: string | null
    }
  > | null
  familyFriendRequests?: Array<{
    id: string
    requesterParentId: string
    requesterMemberId: string
    requesterDisplayName: string
    requesterUsername: string
    requesterAvatarUrl?: string | null
    requesterCoverUrl?: string | null
    requesterParentHandle?: string | null
    requesterParentName?: string | null
    requesterParentAvatarUrl?: string | null
    requesterParentCoverUrl?: string | null
    targetParentId: string
    targetMemberId: string
    targetDisplayName: string
    targetUsername: string
    targetAvatarUrl?: string | null
    targetCoverUrl?: string | null
    status: 'pending' | 'accepted' | 'rejected'
    createdAt: string
    respondedAt?: string | null
  }> | null
  familyFriendships?: Array<{
    id: string
    memberId: string
    peerMemberId: string
    peerParentId: string
    peerDisplayName: string
    peerUsername: string
    peerAvatarUrl?: string | null
    peerCoverUrl?: string | null
    createdAt: string
  }> | null
  familyMessageThreads?: Array<{
    memberId: string
    threadId: string
    peerUserId: string
    createdAt: string
    updatedAt: string
  }> | null
  familyParentConversations?: Array<{
    memberId: string
    parentId: string
    createdAt: string
    updatedAt: string
    childLastReadAt?: string | null
    parentLastReadAt?: string | null
    messages: Array<{
      id: string
      sender: 'child' | 'parent'
      body: string
      createdAt: string
      updatedAt: string
    }>
  }> | null
  profileFamilyRelationships?: Array<{
    relatedUserId: string
    relatedHandle: string
    relatedName?: string | null
    familyType: ProfileFamilyRelationship
    direction: ProfileFamilyRelationshipDirection
    createdAt: string
    updatedAt?: string | null
  }> | null
}

type FamilyModeBand = 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
type FamilyRelationship = 'son' | 'daughter' | 'child' | 'stepson' | 'stepdaughter' | 'foster_child' | 'ward' | 'other'
type FamilyFriendRequestStatus = 'pending' | 'accepted' | 'rejected'

type FamilyFriendRequestRecord = NonNullable<CommunityMetaPayload['familyFriendRequests']>[number]
type FamilyFriendshipRecord = NonNullable<CommunityMetaPayload['familyFriendships']>[number]
type FamilyMessageThreadRecord = NonNullable<CommunityMetaPayload['familyMessageThreads']>[number]
type FamilyParentConversationRecord = NonNullable<CommunityMetaPayload['familyParentConversations']>[number]
type ProfileFamilyRelationshipRecord = NonNullable<CommunityMetaPayload['profileFamilyRelationships']>[number]

const FAMILY_MEMBER_USERNAME_MIN_LENGTH = 6
const FAMILY_MEMBER_USERNAME_MAX_LENGTH = 20
const FAMILY_MEMBER_USERNAME_PATTERN = /^[A-Za-z0-9]{6,20}$/

type AccountModerationState = {
  status: 'SUSPENDED'
  suspendedAt?: string
  suspendedByUserId?: string | null
  suspensionReason?: string | null
  sourceReportId?: string | null
}

const buildFollowKey = (province: string, communitySlug: string) => `${province}:${communitySlug}`

function parseCommunityMeta(value: Prisma.JsonValue | null | undefined): CommunityMetaPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  const nearby = Array.isArray(payload.nearbyCommunities)
    ? (payload.nearbyCommunities as CitySummaryType[])
    : undefined
  const reference =
    payload.reference && typeof payload.reference === 'object' && !Array.isArray(payload.reference)
      ? (payload.reference as { provinceCode?: string | null; communitySlug?: string | null; cityName?: string | null })
      : null
  const computedAt = typeof payload.computedAt === 'string' ? payload.computedAt : undefined
  const dateOfBirth = typeof payload.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.dateOfBirth) ? payload.dateOfBirth : undefined
  const countryOfBirth = typeof payload.countryOfBirth === 'string' && payload.countryOfBirth.trim() ? payload.countryOfBirth.trim() : undefined
  const shareDateOfBirth = typeof payload.shareDateOfBirth === 'boolean' ? payload.shareDateOfBirth : undefined
  const shareCountryOfBirth = typeof payload.shareCountryOfBirth === 'boolean' ? payload.shareCountryOfBirth : undefined
  const civicStatus =
    payload.civicStatus === 'citizen' ||
    payload.civicStatus === 'permanent_resident' ||
    payload.civicStatus === 'work_permit' ||
    payload.civicStatus === 'study_permit' ||
    payload.civicStatus === 'unspecified'
      ? payload.civicStatus
      : undefined
  const workAuthorization =
    payload.workAuthorization === 'authorized' ||
    payload.workAuthorization === 'not_authorized' ||
    payload.workAuthorization === 'unspecified'
      ? payload.workAuthorization
      : undefined
  const verificationMethod = payload.verificationMethod === 'self_declaration' ? 'self_declaration' : undefined
  const statusDeclaredAt = typeof payload.statusDeclaredAt === 'string' ? payload.statusDeclaredAt : undefined
  const statusUpdatedAt = typeof payload.statusUpdatedAt === 'string' ? payload.statusUpdatedAt : undefined
  const familyModeValue = payload.familyMode && typeof payload.familyMode === 'object' && !Array.isArray(payload.familyMode)
    ? (payload.familyMode as Record<string, unknown>)
    : null
  const familyMode = familyModeValue
    ? {
        enabledAt: typeof familyModeValue.enabledAt === 'string' ? familyModeValue.enabledAt : undefined,
        affirmedProfileTruthAt:
          typeof familyModeValue.affirmedProfileTruthAt === 'string' ? familyModeValue.affirmedProfileTruthAt : undefined,
        acceptedChildSafetyInfoAt:
          typeof familyModeValue.acceptedChildSafetyInfoAt === 'string' ? familyModeValue.acceptedChildSafetyInfoAt : undefined,
      }
    : null
  const familyMemberSettingsValue =
    payload.familyMemberSettings && typeof payload.familyMemberSettings === 'object' && !Array.isArray(payload.familyMemberSettings)
      ? (payload.familyMemberSettings as Record<string, unknown>)
      : null
  const familyMemberSettings = familyMemberSettingsValue
    ? Object.fromEntries(
        Object.entries(familyMemberSettingsValue).flatMap(([memberId, rawValue]) => {
          if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
          const value = rawValue as Record<string, unknown>
          return [
            [
              memberId,
              {
                allowChildOwnMediaEdits:
                  typeof value.allowChildOwnMediaEdits === 'boolean' ? value.allowChildOwnMediaEdits : undefined,
                allowChildOwnUsernameEdits:
                  typeof value.allowChildOwnUsernameEdits === 'boolean' ? value.allowChildOwnUsernameEdits : undefined,
                allowChildAudioCalls:
                  typeof value.allowChildAudioCalls === 'boolean' ? value.allowChildAudioCalls : undefined,
                allowChildVideoCalls:
                  typeof value.allowChildVideoCalls === 'boolean' ? value.allowChildVideoCalls : undefined,
                notifyParentOnMediaChanges:
                  typeof value.notifyParentOnMediaChanges === 'boolean' ? value.notifyParentOnMediaChanges : undefined,
                username:
                  typeof value.username === 'string' && value.username.trim() ? value.username.trim() : null,
                avatarUrl:
                  typeof value.avatarUrl === 'string' && value.avatarUrl.trim() ? value.avatarUrl.trim() : null,
                coverUrl:
                  typeof value.coverUrl === 'string' && value.coverUrl.trim() ? value.coverUrl.trim() : null,
              },
            ],
          ]
        }),
      )
    : null
  const familyFriendRequests = Array.isArray(payload.familyFriendRequests)
    ? payload.familyFriendRequests.flatMap((rawValue) => {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
        const value = rawValue as Record<string, unknown>
        const status =
          value.status === 'accepted' || value.status === 'rejected' || value.status === 'pending'
            ? value.status
            : 'pending'
        if (
          typeof value.id !== 'string' ||
          typeof value.requesterParentId !== 'string' ||
          typeof value.requesterMemberId !== 'string' ||
          typeof value.requesterDisplayName !== 'string' ||
          typeof value.requesterUsername !== 'string' ||
          typeof value.targetParentId !== 'string' ||
          typeof value.targetMemberId !== 'string' ||
          typeof value.targetDisplayName !== 'string' ||
          typeof value.targetUsername !== 'string' ||
          typeof value.createdAt !== 'string'
        ) {
          return []
        }
        return [{
          id: value.id,
          requesterParentId: value.requesterParentId,
          requesterMemberId: value.requesterMemberId,
          requesterDisplayName: value.requesterDisplayName,
          requesterUsername: value.requesterUsername,
          requesterAvatarUrl: typeof value.requesterAvatarUrl === 'string' ? value.requesterAvatarUrl : null,
          requesterCoverUrl: typeof value.requesterCoverUrl === 'string' ? value.requesterCoverUrl : null,
          requesterParentHandle: typeof value.requesterParentHandle === 'string' ? value.requesterParentHandle : null,
          requesterParentName: typeof value.requesterParentName === 'string' ? value.requesterParentName : null,
          requesterParentAvatarUrl: typeof value.requesterParentAvatarUrl === 'string' ? value.requesterParentAvatarUrl : null,
          requesterParentCoverUrl: typeof value.requesterParentCoverUrl === 'string' ? value.requesterParentCoverUrl : null,
          targetParentId: value.targetParentId,
          targetMemberId: value.targetMemberId,
          targetDisplayName: value.targetDisplayName,
          targetUsername: value.targetUsername,
          targetAvatarUrl: typeof value.targetAvatarUrl === 'string' ? value.targetAvatarUrl : null,
          targetCoverUrl: typeof value.targetCoverUrl === 'string' ? value.targetCoverUrl : null,
          status,
          createdAt: value.createdAt,
          respondedAt: typeof value.respondedAt === 'string' ? value.respondedAt : null,
        } satisfies FamilyFriendRequestRecord]
      })
    : null
  const familyFriendships = Array.isArray(payload.familyFriendships)
    ? payload.familyFriendships.flatMap((rawValue) => {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
        const value = rawValue as Record<string, unknown>
        if (
          typeof value.id !== 'string' ||
          typeof value.memberId !== 'string' ||
          typeof value.peerMemberId !== 'string' ||
          typeof value.peerParentId !== 'string' ||
          typeof value.peerDisplayName !== 'string' ||
          typeof value.peerUsername !== 'string' ||
          typeof value.createdAt !== 'string'
        ) {
          return []
        }
        return [{
          id: value.id,
          memberId: value.memberId,
          peerMemberId: value.peerMemberId,
          peerParentId: value.peerParentId,
          peerDisplayName: value.peerDisplayName,
          peerUsername: value.peerUsername,
          peerAvatarUrl: typeof value.peerAvatarUrl === 'string' ? value.peerAvatarUrl : null,
          peerCoverUrl: typeof value.peerCoverUrl === 'string' ? value.peerCoverUrl : null,
          createdAt: value.createdAt,
        } satisfies FamilyFriendshipRecord]
      })
    : null
  const familyMessageThreads = Array.isArray(payload.familyMessageThreads)
    ? payload.familyMessageThreads.flatMap((rawValue) => {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
        const value = rawValue as Record<string, unknown>
        if (
          typeof value.memberId !== 'string' ||
          typeof value.threadId !== 'string' ||
          typeof value.peerUserId !== 'string' ||
          typeof value.createdAt !== 'string' ||
          typeof value.updatedAt !== 'string'
        ) {
          return []
        }
        return [{
          memberId: value.memberId,
          threadId: value.threadId,
          peerUserId: value.peerUserId,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
        } satisfies FamilyMessageThreadRecord]
      })
    : null
  const familyParentConversations = Array.isArray(payload.familyParentConversations)
    ? payload.familyParentConversations.flatMap((rawValue) => {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
        const value = rawValue as Record<string, unknown>
        if (
          typeof value.memberId !== 'string' ||
          typeof value.parentId !== 'string' ||
          typeof value.createdAt !== 'string' ||
          typeof value.updatedAt !== 'string'
        ) {
          return []
        }
        const messages = Array.isArray(value.messages)
          ? value.messages.flatMap((rawMessage) => {
              if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) return []
              const message = rawMessage as Record<string, unknown>
              if (
                typeof message.id !== 'string' ||
                (message.sender !== 'child' && message.sender !== 'parent') ||
                typeof message.body !== 'string' ||
                typeof message.createdAt !== 'string' ||
                typeof message.updatedAt !== 'string'
              ) {
                return []
              }
              return [{
                id: message.id,
                sender: message.sender,
                body: message.body,
                createdAt: message.createdAt,
                updatedAt: message.updatedAt,
              } satisfies FamilyParentConversationRecord['messages'][number]]
            })
          : []
        return [{
          memberId: value.memberId,
          parentId: value.parentId,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
          childLastReadAt: typeof value.childLastReadAt === 'string' ? value.childLastReadAt : null,
          parentLastReadAt: typeof value.parentLastReadAt === 'string' ? value.parentLastReadAt : null,
          messages,
        } satisfies FamilyParentConversationRecord]
      })
    : null
  const profileFamilyRelationships = Array.isArray(payload.profileFamilyRelationships)
    ? payload.profileFamilyRelationships.flatMap((rawValue) => {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return []
        const value = rawValue as Record<string, unknown>
        const familyType =
          value.familyType === 'mother' ||
          value.familyType === 'father' ||
          value.familyType === 'grandmother' ||
          value.familyType === 'grandfather' ||
          value.familyType === 'sister' ||
          value.familyType === 'brother' ||
          value.familyType === 'aunt' ||
          value.familyType === 'uncle' ||
          value.familyType === 'cousin' ||
          value.familyType === 'second_cousin' ||
          value.familyType === 'niece' ||
          value.familyType === 'nephew' ||
          value.familyType === 'wife' ||
          value.familyType === 'husband' ||
          value.familyType === 'significant_other' ||
          value.familyType === 'partner' ||
          value.familyType === 'mother_in_law' ||
          value.familyType === 'father_in_law' ||
          value.familyType === 'sister_in_law' ||
          value.familyType === 'brother_in_law' ||
          value.familyType === 'daughter_in_law' ||
          value.familyType === 'son_in_law' ||
          value.familyType === 'other'
            ? value.familyType
            : null
        const direction = value.direction === 'outbound' || value.direction === 'inbound' ? value.direction : null
        if (
          typeof value.relatedUserId !== 'string' ||
          typeof value.relatedHandle !== 'string' ||
          typeof value.createdAt !== 'string' ||
          !familyType ||
          !direction
        ) {
          return []
        }
        return [{
          relatedUserId: value.relatedUserId,
          relatedHandle: value.relatedHandle,
          relatedName: typeof value.relatedName === 'string' ? value.relatedName : null,
          familyType,
          direction,
          createdAt: value.createdAt,
          updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
        } satisfies ProfileFamilyRelationshipRecord]
      })
    : null
  return {
    nearbyCommunities: nearby,
    computedAt,
    dateOfBirth,
    countryOfBirth,
    shareDateOfBirth,
    shareCountryOfBirth,
    civicStatus,
    workAuthorization,
    verificationMethod,
    statusDeclaredAt,
    statusUpdatedAt,
    familyMode,
    familyMemberSettings,
    familyFriendRequests,
    familyFriendships,
    familyMessageThreads,
    familyParentConversations,
    profileFamilyRelationships,
    reference,
  }
}

function getLegacyFamilyMemberPermissionSettings(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
) {
  const settings = parseCommunityMeta(value)?.familyMemberSettings?.[memberId]
  return {
    allowChildOwnMediaEdits: Boolean(settings?.allowChildOwnMediaEdits),
    allowChildOwnUsernameEdits: settings?.allowChildOwnUsernameEdits == null ? true : Boolean(settings.allowChildOwnUsernameEdits),
    allowChildAudioCalls: settings?.allowChildAudioCalls == null ? true : Boolean(settings.allowChildAudioCalls),
    allowChildVideoCalls: settings?.allowChildVideoCalls == null ? true : Boolean(settings.allowChildVideoCalls),
    notifyParentOnMediaChanges: Boolean(settings?.notifyParentOnMediaChanges),
  }
}

function getLegacyFamilyMemberStoredUsername(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
) {
  const settings = parseCommunityMeta(value)?.familyMemberSettings?.[memberId]
  return typeof settings?.username === 'string' && settings.username.trim() ? settings.username.trim() : null
}

function getLegacyFamilyMemberStoredProfileMedia(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
) {
  const settings = parseCommunityMeta(value)?.familyMemberSettings?.[memberId]
  return {
    avatarUrl: typeof settings?.avatarUrl === 'string' ? settings.avatarUrl : null,
    coverUrl: typeof settings?.coverUrl === 'string' ? settings.coverUrl : null,
  }
}

function writeLegacyFamilyMemberPermissionSettings(
  baseMeta: Record<string, unknown>,
  memberId: string,
  settings: {
    allowChildOwnMediaEdits: boolean
    allowChildOwnUsernameEdits: boolean
    allowChildAudioCalls: boolean
    allowChildVideoCalls: boolean
    notifyParentOnMediaChanges: boolean
  },
) {
  const existingValue =
    baseMeta.familyMemberSettings && typeof baseMeta.familyMemberSettings === 'object' && !Array.isArray(baseMeta.familyMemberSettings)
      ? { ...(baseMeta.familyMemberSettings as Record<string, unknown>) }
      : {}

  const existingSettings =
    existingValue[memberId] && typeof existingValue[memberId] === 'object' && !Array.isArray(existingValue[memberId])
      ? { ...(existingValue[memberId] as Record<string, unknown>) }
      : {}

  existingValue[memberId] = {
    ...existingSettings,
    allowChildOwnMediaEdits: settings.allowChildOwnMediaEdits,
    allowChildOwnUsernameEdits: settings.allowChildOwnUsernameEdits,
    allowChildAudioCalls: settings.allowChildAudioCalls,
    allowChildVideoCalls: settings.allowChildVideoCalls,
    notifyParentOnMediaChanges: settings.notifyParentOnMediaChanges,
  }

  baseMeta.familyMemberSettings = existingValue
}

function writeLegacyFamilyMemberUsername(
  baseMeta: Record<string, unknown>,
  memberId: string,
  username: string,
) {
  const existingValue =
    baseMeta.familyMemberSettings && typeof baseMeta.familyMemberSettings === 'object' && !Array.isArray(baseMeta.familyMemberSettings)
      ? { ...(baseMeta.familyMemberSettings as Record<string, unknown>) }
      : {}

  const existingSettings =
    existingValue[memberId] && typeof existingValue[memberId] === 'object' && !Array.isArray(existingValue[memberId])
      ? { ...(existingValue[memberId] as Record<string, unknown>) }
      : {}

  existingValue[memberId] = {
    ...existingSettings,
    username,
  }

  baseMeta.familyMemberSettings = existingValue
}

function writeLegacyFamilyMemberProfileMedia(
  baseMeta: Record<string, unknown>,
  memberId: string,
  media: {
    avatarUrl?: string | null
    coverUrl?: string | null
  },
) {
  const existingValue =
    baseMeta.familyMemberSettings && typeof baseMeta.familyMemberSettings === 'object' && !Array.isArray(baseMeta.familyMemberSettings)
      ? { ...(baseMeta.familyMemberSettings as Record<string, unknown>) }
      : {}

  const existingSettings =
    existingValue[memberId] && typeof existingValue[memberId] === 'object' && !Array.isArray(existingValue[memberId])
      ? { ...(existingValue[memberId] as Record<string, unknown>) }
      : {}

  existingValue[memberId] = {
    ...existingSettings,
    ...(media.avatarUrl !== undefined ? { avatarUrl: media.avatarUrl } : {}),
    ...(media.coverUrl !== undefined ? { coverUrl: media.coverUrl } : {}),
  }

  baseMeta.familyMemberSettings = existingValue
}

function getStoredFamilyFriendRequests(value: Prisma.JsonValue | null | undefined): FamilyFriendRequestRecord[] {
  return parseCommunityMeta(value)?.familyFriendRequests ?? []
}

function getStoredFamilyFriendships(value: Prisma.JsonValue | null | undefined): FamilyFriendshipRecord[] {
  return parseCommunityMeta(value)?.familyFriendships ?? []
}

function getStoredFamilyMessageThreads(value: Prisma.JsonValue | null | undefined): FamilyMessageThreadRecord[] {
  return parseCommunityMeta(value)?.familyMessageThreads ?? []
}

function getStoredFamilyParentConversations(value: Prisma.JsonValue | null | undefined): FamilyParentConversationRecord[] {
  return parseCommunityMeta(value)?.familyParentConversations ?? []
}

function getStoredProfileFamilyRelationships(value: Prisma.JsonValue | null | undefined): ProfileFamilyRelationshipRecord[] {
  return parseCommunityMeta(value)?.profileFamilyRelationships ?? []
}

function hasStoredProfileFamilyRelationshipWithUser(
  value: Prisma.JsonValue | null | undefined,
  relatedUserId: string,
) {
  return getStoredProfileFamilyRelationships(value).some((entry) => entry.relatedUserId === relatedUserId)
}

async function canViewerAccessFamilyAudiencePost(args: { viewerId?: string | null; authorId: string }) {
  const viewerId = args.viewerId?.trim()
  if (!viewerId) return false
  if (viewerId === args.authorId) return true

  const [viewerUser, authorUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: viewerId }, select: { communityMeta: true } }),
    prisma.user.findUnique({ where: { id: args.authorId }, select: { communityMeta: true } }),
  ])

  return (
    hasStoredProfileFamilyRelationshipWithUser(viewerUser?.communityMeta, args.authorId) ||
    hasStoredProfileFamilyRelationshipWithUser(authorUser?.communityMeta, viewerId)
  )
}

function writeStoredFamilyFriendRequests(baseMeta: Record<string, unknown>, requests: FamilyFriendRequestRecord[]) {
  baseMeta.familyFriendRequests = requests as unknown as Prisma.InputJsonValue
}

function writeStoredFamilyFriendships(baseMeta: Record<string, unknown>, friendships: FamilyFriendshipRecord[]) {
  baseMeta.familyFriendships = friendships as unknown as Prisma.InputJsonValue
}

function writeStoredFamilyMessageThreads(baseMeta: Record<string, unknown>, threads: FamilyMessageThreadRecord[]) {
  baseMeta.familyMessageThreads = threads as unknown as Prisma.InputJsonValue
}

function writeStoredFamilyParentConversations(baseMeta: Record<string, unknown>, conversations: FamilyParentConversationRecord[]) {
  baseMeta.familyParentConversations = conversations as unknown as Prisma.InputJsonValue
}

function writeStoredProfileFamilyRelationships(baseMeta: Record<string, unknown>, relationships: ProfileFamilyRelationshipRecord[]) {
  baseMeta.profileFamilyRelationships = relationships as unknown as Prisma.InputJsonValue
}

function upsertFamilyFriendRequest(requests: FamilyFriendRequestRecord[], nextRequest: FamilyFriendRequestRecord) {
  const remaining = requests.filter((request) => request.id !== nextRequest.id)
  return [nextRequest, ...remaining].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function upsertFamilyFriendship(friendships: FamilyFriendshipRecord[], nextFriendship: FamilyFriendshipRecord) {
  const remaining = friendships.filter((friendship) => friendship.peerMemberId !== nextFriendship.peerMemberId || friendship.memberId !== nextFriendship.memberId)
  return [nextFriendship, ...remaining].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function upsertFamilyMessageThread(threads: FamilyMessageThreadRecord[], nextThread: FamilyMessageThreadRecord) {
  const remaining = threads.filter((thread) => !(thread.memberId === nextThread.memberId && thread.threadId === nextThread.threadId))
  return [nextThread, ...remaining].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function upsertFamilyParentConversation(
  conversations: FamilyParentConversationRecord[],
  nextConversation: FamilyParentConversationRecord,
) {
  const remaining = conversations.filter(
    (conversation) => !(conversation.memberId === nextConversation.memberId && conversation.parentId === nextConversation.parentId),
  )
  return [nextConversation, ...remaining].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function upsertProfileFamilyRelationship(
  relationships: ProfileFamilyRelationshipRecord[],
  nextRelationship: ProfileFamilyRelationshipRecord,
) {
  const remaining = relationships.filter((relationship) => relationship.relatedUserId !== nextRelationship.relatedUserId)
  return [nextRelationship, ...remaining].sort((left, right) => {
    const leftKey = left.updatedAt ?? left.createdAt
    const rightKey = right.updatedAt ?? right.createdAt
    return rightKey.localeCompare(leftKey)
  })
}

function formatFamilyFriendUser(entry: FamilyFriendshipRecord) {
  return {
    id: entry.peerMemberId,
    handle: entry.peerUsername,
    name: entry.peerDisplayName,
    avatarUrl: normalizeMediaUrl(entry.peerAvatarUrl ?? null),
    coverUrl: normalizeMediaUrl(entry.peerCoverUrl ?? null),
    isPremium: false,
    isVerified: false,
  }
}

function formatFamilyChildFriendship(entry: FamilyFriendshipRecord) {
  return {
    id: entry.id,
    status: FriendshipStatus.ACCEPTED,
    since: entry.createdAt,
    specialKind: 'family_child_friend' as const,
    user: formatFamilyFriendUser(entry),
  }
}

function findPendingFamilyFriendRequest(
  requests: FamilyFriendRequestRecord[],
  requesterMemberId: string,
  targetMemberId: string,
) {
  return requests.find(
    (request) =>
      request.status === 'pending' &&
      ((request.requesterMemberId === requesterMemberId && request.targetMemberId === targetMemberId) ||
        (request.requesterMemberId === targetMemberId && request.targetMemberId === requesterMemberId)),
  )
}

function hasAcceptedFamilyFriendship(
  friendships: FamilyFriendshipRecord[],
  memberId: string,
  peerMemberId: string,
) {
  return friendships.some((friendship) => friendship.memberId === memberId && friendship.peerMemberId === peerMemberId)
}

function getFamilyMessageThreadIdsForMember(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
) {
  return getStoredFamilyMessageThreads(value)
    .filter((thread) => thread.memberId === memberId)
    .map((thread) => thread.threadId)
}

function hasFamilyMessageThreadForMember(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
  threadId: string,
) {
  return getStoredFamilyMessageThreads(value).some((thread) => thread.memberId === memberId && thread.threadId === threadId)
}

function buildFamilyParentThreadId(parentId: string) {
  return `family-parent-${parentId}`
}

function isFamilyParentThreadId(threadId: string) {
  return threadId.startsWith('family-parent-')
}

function buildParentFamilyThreadId(memberId: string) {
  return `family-member-${memberId}`
}

function isParentFamilyThreadId(threadId: string) {
  return threadId.startsWith('family-member-')
}

function parseParentFamilyThreadId(threadId: string) {
  if (!isParentFamilyThreadId(threadId)) return null
  const memberId = threadId.slice('family-member-'.length).trim()
  return memberId || null
}

function getFamilyParentConversation(
  value: Prisma.JsonValue | null | undefined,
  memberId: string,
  parentId: string,
) {
  return getStoredFamilyParentConversations(value).find(
    (conversation) => conversation.memberId === memberId && conversation.parentId === parentId,
  )
}

async function storeFamilyParentConversationMessage(args: {
  parentId: string
  memberId: string
  sender: 'child' | 'parent'
  body: string
  timestamp?: Date
}) {
  const parent = await prisma.user.findUnique({
    where: { id: args.parentId },
    select: { communityMeta: true },
  })
  const baseMeta = readBaseCommunityMeta(parent?.communityMeta ?? null)
  const conversations = getStoredFamilyParentConversations(parent?.communityMeta)
  const existing = getFamilyParentConversation(parent?.communityMeta, args.memberId, args.parentId)
  const now = args.timestamp ?? new Date()
  const isoTimestamp = now.toISOString()
  const nextConversation: FamilyParentConversationRecord = {
    memberId: args.memberId,
    parentId: args.parentId,
    createdAt: existing?.createdAt ?? isoTimestamp,
    updatedAt: isoTimestamp,
    childLastReadAt: args.sender === 'child' ? isoTimestamp : (existing?.childLastReadAt ?? null),
    parentLastReadAt: args.sender === 'parent' ? isoTimestamp : (existing?.parentLastReadAt ?? null),
    messages: [
      ...(existing?.messages ?? []),
      {
        id: randomUUID(),
        sender: args.sender,
        body: args.body,
        createdAt: isoTimestamp,
        updatedAt: isoTimestamp,
      },
    ],
  }

  writeStoredFamilyParentConversations(
    baseMeta,
    upsertFamilyParentConversation(conversations, nextConversation),
  )

  await prisma.user.update({
    where: { id: args.parentId },
    data: {
      communityMeta: baseMeta as Prisma.InputJsonValue,
    },
  })

  return nextConversation
}

async function markFamilyParentConversationRead(args: {
  parentId: string
  memberId: string
  actor: 'child' | 'parent'
  readAt?: Date
}) {
  const parent = await prisma.user.findUnique({
    where: { id: args.parentId },
    select: { communityMeta: true },
  })
  const existing = getFamilyParentConversation(parent?.communityMeta, args.memberId, args.parentId)
  if (!existing) return null
  const baseMeta = readBaseCommunityMeta(parent?.communityMeta ?? null)
  const conversations = getStoredFamilyParentConversations(parent?.communityMeta)
  const isoTimestamp = (args.readAt ?? new Date()).toISOString()
  const nextConversation: FamilyParentConversationRecord = {
    ...existing,
    updatedAt: existing.updatedAt,
    childLastReadAt: args.actor === 'child' ? isoTimestamp : existing.childLastReadAt ?? null,
    parentLastReadAt: args.actor === 'parent' ? isoTimestamp : existing.parentLastReadAt ?? null,
  }

  writeStoredFamilyParentConversations(
    baseMeta,
    upsertFamilyParentConversation(conversations, nextConversation),
  )

  await prisma.user.update({
    where: { id: args.parentId },
    data: {
      communityMeta: baseMeta as Prisma.InputJsonValue,
    },
  })

  return nextConversation
}

async function storeFamilyMessageThreadForMember(args: {
  parentId: string
  memberId: string
  threadId: string
  peerUserId: string
  timestamp?: Date
}) {
  const parent = await prisma.user.findUnique({
    where: { id: args.parentId },
    select: { communityMeta: true },
  })
  const baseMeta = readBaseCommunityMeta(parent?.communityMeta ?? null)
  const currentThreads = getStoredFamilyMessageThreads(parent?.communityMeta)
  const isoTimestamp = (args.timestamp ?? new Date()).toISOString()
  const existing = currentThreads.find((thread) => thread.memberId === args.memberId && thread.threadId === args.threadId)

  writeStoredFamilyMessageThreads(
    baseMeta,
    upsertFamilyMessageThread(currentThreads, {
      memberId: args.memberId,
      threadId: args.threadId,
      peerUserId: args.peerUserId,
      createdAt: existing?.createdAt ?? isoTimestamp,
      updatedAt: isoTimestamp,
    }),
  )

  await prisma.user.update({
    where: { id: args.parentId },
    data: {
      communityMeta: baseMeta as Prisma.InputJsonValue,
    },
  })
}

function familyMemberCanAccessMessageThread(member: FamilyAuthMember, threadId: string) {
  if (threadId === buildFamilyParentThreadId(member.parentId)) {
    return true
  }
  return hasFamilyMessageThreadForMember(member.parent.communityMeta, member.id, threadId)
}

function parseProfileNameParts(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  }
}

function isParentProfileEligibleForFamilyMode(user: { name?: string | null; communityMeta?: Prisma.JsonValue | null | undefined }) {
  const nameParts = parseProfileNameParts(user.name)
  const meta = parseCommunityMeta(user.communityMeta ?? null)
  return {
    firstName: Boolean(nameParts.firstName.trim()),
    lastName: Boolean(nameParts.lastName.trim()),
    dateOfBirth: Boolean(meta?.dateOfBirth),
    countryOfBirth: Boolean(meta?.countryOfBirth),
  }
}

function calculateAgeFromDateOfBirth(dateOfBirth: Date, now = new Date()) {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear()
  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth()
  const dayDelta = now.getUTCDate() - dateOfBirth.getUTCDate()
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
    age -= 1
  }
  return age
}

function getFamilyModeBandFromAge(age: number): FamilyModeBand {
  if (age <= 8) return 'EARLY_CHILDHOOD'
  if (age <= 12) return 'JUNIOR'
  if (age <= 15) return 'TEEN'
  if (age <= 17) return 'YOUTH'
  return 'ADULT'
}

function getFamilyModeBandLabel(band: FamilyModeBand) {
  if (band === 'EARLY_CHILDHOOD') return 'Early Childhood Mode (5 to 8)'
  if (band === 'JUNIOR') return 'Junior Mode (9 to 12)'
  if (band === 'TEEN') return 'Teen Mode (13 to 15)'
  if (band === 'YOUTH') return 'Youth Mode (16 to 17)'
  return 'Adult Mode (18+)'
}

function getFamilyRelationshipLabel(value: FamilyRelationship) {
  if (value === 'son') return 'Son'
  if (value === 'daughter') return 'Daughter'
  if (value === 'child') return 'Child'
  if (value === 'stepson') return 'Stepson'
  if (value === 'stepdaughter') return 'Stepdaughter'
  if (value === 'foster_child') return 'Foster Child'
  if (value === 'ward') return 'Ward'
  return 'Other'
}

function normalizeFamilyMemberSummary(member: {
  id: string
  firstName: string
  lastName: string
  dateOfBirth: Date
  relationship: FamilyRelationship
  friendCode: string
  username?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  allowChildOwnMediaEdits?: boolean
  allowChildOwnUsernameEdits?: boolean
  allowChildAudioCalls?: boolean
  allowChildVideoCalls?: boolean
  notifyParentOnMediaChanges?: boolean
  suspendedAt: Date | null
  suspendedById: string | null
  suspensionNote: string | null
  createdAt: Date
  updatedAt: Date
}) {
  const age = calculateAgeFromDateOfBirth(member.dateOfBirth)
  const modeBand = getFamilyModeBandFromAge(age)
  return {
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    relationship: member.relationship,
    relationshipLabel: getFamilyRelationshipLabel(member.relationship),
    displayName: `${member.firstName} ${member.lastName}`.trim(),
    dateOfBirth: member.dateOfBirth.toISOString().slice(0, 10),
    age,
    modeBand,
    modeLabel: getFamilyModeBandLabel(modeBand),
    friendCode: member.friendCode,
    username: normalizeFamilyMemberUsernameCandidate(member.username ?? '') || buildDefaultFamilyMemberUsernameBase(member.firstName, member.lastName),
    avatarUrl: normalizeMediaUrl(member.avatarUrl ?? null),
    coverUrl: normalizeMediaUrl(member.coverUrl ?? null),
    allowChildOwnMediaEdits: Boolean(member.allowChildOwnMediaEdits),
    allowChildOwnUsernameEdits: member.allowChildOwnUsernameEdits == null ? true : Boolean(member.allowChildOwnUsernameEdits),
    allowChildAudioCalls: member.allowChildAudioCalls == null ? true : Boolean(member.allowChildAudioCalls),
    allowChildVideoCalls: member.allowChildVideoCalls == null ? true : Boolean(member.allowChildVideoCalls),
    notifyParentOnMediaChanges: Boolean(member.notifyParentOnMediaChanges),
    suspended: Boolean(member.suspendedAt),
    suspendedAt: member.suspendedAt ? member.suspendedAt.toISOString() : null,
    suspendedById: member.suspendedById,
    suspensionNote: member.suspensionNote,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  }
}

async function loadFamilyMemberSummaryForParent(memberId: string, parentId: string) {
  try {
    return await prisma.familyMember.findFirst({
      where: { id: memberId, parentId },
      select: {
        id: true,
        parentId: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        relationship: true,
        friendCode: true,
        username: true,
        avatarUrl: true,
        coverUrl: true,
        allowChildOwnMediaEdits: true,
        allowChildOwnUsernameEdits: true,
        allowChildAudioCalls: true,
        allowChildVideoCalls: true,
        notifyParentOnMediaChanges: true,
        suspendedAt: true,
        suspendedById: true,
        suspensionNote: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  } catch (error) {
    if (!isFamilyMemberTableMissing(error)) throw error

    const parent = await prisma.user.findUnique({
      where: { id: parentId },
      select: { communityMeta: true },
    })
    const legacySettings = getLegacyFamilyMemberPermissionSettings(parent?.communityMeta, memberId)
    const legacyMedia = getLegacyFamilyMemberStoredProfileMedia(parent?.communityMeta, memberId)

    const legacyMember = await prisma.familyMember.findFirst({
      where: { id: memberId, parentId },
      select: {
        id: true,
        parentId: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        relationship: true,
        friendCode: true,
        suspendedAt: true,
        suspendedById: true,
        suspensionNote: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return legacyMember
      ? {
          ...legacyMember,
          username: getLegacyFamilyMemberStoredUsername(parent?.communityMeta, memberId),
          avatarUrl: legacyMedia.avatarUrl,
          coverUrl: legacyMedia.coverUrl,
          allowChildOwnMediaEdits: legacySettings.allowChildOwnMediaEdits,
          allowChildOwnUsernameEdits: legacySettings.allowChildOwnUsernameEdits,
          allowChildAudioCalls: legacySettings.allowChildAudioCalls,
          allowChildVideoCalls: legacySettings.allowChildVideoCalls,
          notifyParentOnMediaChanges: legacySettings.notifyParentOnMediaChanges,
        }
      : null
  }
}

async function updateFamilyMemberSummaryForParent(args: {
  memberId: string
  parentId: string
  firstName: string
  lastName: string
  dateOfBirth: Date
  relationship: FamilyRelationship
  allowChildOwnMediaEdits: boolean
  allowChildOwnUsernameEdits: boolean
  allowChildAudioCalls: boolean
  allowChildVideoCalls: boolean
  notifyParentOnMediaChanges: boolean
}) {
  try {
    return await prisma.familyMember.update({
      where: { id: args.memberId },
      data: {
        firstName: args.firstName,
        lastName: args.lastName,
        dateOfBirth: args.dateOfBirth,
        relationship: args.relationship,
        allowChildOwnMediaEdits: args.allowChildOwnMediaEdits,
        allowChildOwnUsernameEdits: args.allowChildOwnUsernameEdits,
        allowChildAudioCalls: args.allowChildAudioCalls,
        allowChildVideoCalls: args.allowChildVideoCalls,
        notifyParentOnMediaChanges: args.notifyParentOnMediaChanges,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        relationship: true,
        friendCode: true,
        username: true,
        avatarUrl: true,
        coverUrl: true,
        allowChildOwnMediaEdits: true,
        allowChildOwnUsernameEdits: true,
        allowChildAudioCalls: true,
        allowChildVideoCalls: true,
        notifyParentOnMediaChanges: true,
        suspendedAt: true,
        suspendedById: true,
        suspensionNote: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  } catch (error) {
    if (!isFamilyMemberTableMissing(error)) throw error

    const existing = await prisma.familyMember.findFirst({
      where: { id: args.memberId, parentId: args.parentId },
      select: { id: true },
    })
    if (!existing) return null

    const parent = await prisma.user.findUnique({
      where: { id: args.parentId },
      select: { communityMeta: true },
    })
    const baseMeta = readBaseCommunityMeta(parent?.communityMeta ?? null)
    writeLegacyFamilyMemberPermissionSettings(baseMeta, args.memberId, {
      allowChildOwnMediaEdits: args.allowChildOwnMediaEdits,
      allowChildOwnUsernameEdits: args.allowChildOwnUsernameEdits,
      allowChildAudioCalls: args.allowChildAudioCalls,
      allowChildVideoCalls: args.allowChildVideoCalls,
      notifyParentOnMediaChanges: args.notifyParentOnMediaChanges,
    })
    await prisma.user.update({
      where: { id: args.parentId },
      data: {
        communityMeta: baseMeta as Prisma.InputJsonValue,
      },
    })

    const legacyMember = await prisma.familyMember.update({
      where: { id: args.memberId },
      data: {
        firstName: args.firstName,
        lastName: args.lastName,
        dateOfBirth: args.dateOfBirth,
        relationship: args.relationship,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        relationship: true,
        friendCode: true,
        suspendedAt: true,
        suspendedById: true,
        suspensionNote: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return {
      ...legacyMember,
      username: getLegacyFamilyMemberStoredUsername(parent?.communityMeta, args.memberId),
      ...getLegacyFamilyMemberStoredProfileMedia(parent?.communityMeta, args.memberId),
      allowChildOwnMediaEdits: args.allowChildOwnMediaEdits,
      allowChildOwnUsernameEdits: args.allowChildOwnUsernameEdits,
      notifyParentOnMediaChanges: args.notifyParentOnMediaChanges,
    }
  }
}

type FamilyFeedPostRecord = {
  id: string
  familyMemberId: string
  parentId: string
  body: string
  images: Prisma.JsonValue | null
  createdAt: Date
  updatedAt: Date
}

const FAMILY_FEED_POST_TYPE = 'family'

function buildFamilyFeedPostTitle(memberId: string) {
  return `family-feed:${memberId}`
}

function buildLegacyFamilyFeedMirrorKey(args: {
  memberId: string
  body: string
  createdAt: Date
  images: Prisma.JsonValue | null
}) {
  return JSON.stringify({
    memberId: args.memberId,
    body: args.body,
    createdAt: args.createdAt.toISOString(),
    images: normalizeFamilyFeedImages(args.images),
  })
}

async function loadLatestFamilyPostAtByMember(parentId: string, memberIds: string[]) {
  const latestByMember = new Map<string, string>()
  if (!memberIds.length) return latestByMember

  const rows = await Promise.all(memberIds.map(async (memberId) => {
    const [postRow, legacyRow] = await Promise.all([
      prisma.post.findFirst({
        where: {
          authorId: parentId,
          type: FAMILY_FEED_POST_TYPE,
          title: buildFamilyFeedPostTitle(memberId),
        },
        orderBy: [{ createdAt: 'desc' }],
        select: { createdAt: true },
      }),
      (async () => {
        try {
          return await prisma.familyFeedPost.findFirst({
            where: {
              parentId,
              familyMemberId: memberId,
            },
            orderBy: [{ createdAt: 'desc' }],
            select: { createdAt: true },
          })
        } catch (error) {
          if (!isSchemaOutOfDateError(error)) throw error
          return null
        }
      })(),
    ])

    const timestamps = [postRow?.createdAt, legacyRow?.createdAt]
      .filter((value): value is Date => value instanceof Date)
      .map((value) => value.getTime())
    if (!timestamps.length) return [memberId, null] as const

    return [memberId, new Date(Math.max(...timestamps)).toISOString()] as const
  }))

  for (const [memberId, latestPostAt] of rows) {
    if (latestPostAt) latestByMember.set(memberId, latestPostAt)
  }

  return latestByMember
}

async function loadLatestPublicPostAtByUsers(userIds: string[]) {
  const latestByUser = new Map<string, string>()
  if (!userIds.length) return latestByUser

  const rows = await Promise.all(userIds.map(async (userId) => {
    let latestDate: Date | null = null
    try {
      const row = await prisma.post.findFirst({
        where: {
          authorId: userId,
          publishedAt: { not: null },
          visibility: 'public',
        },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          publishedAt: true,
          createdAt: true,
        },
      })
      latestDate = row?.publishedAt ?? row?.createdAt ?? null
    } catch (error) {
      if (!isSchemaOutOfDateError(error)) throw error
      const fallbackRow = await prisma.post.findFirst({
        where: {
          authorId: userId,
        },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          createdAt: true,
        },
      })
      latestDate = fallbackRow?.createdAt ?? null
    }

    return [userId, latestDate ? latestDate.toISOString() : null] as const
  }))

  for (const [userId, latestPostAt] of rows) {
    if (latestPostAt) latestByUser.set(userId, latestPostAt)
  }

  return latestByUser
}

async function loadProfileFamilyRelationshipsForRail(value: Prisma.JsonValue | null | undefined) {
  try {
    const relationships = getStoredProfileFamilyRelationships(value)
    if (!relationships.length) return []

    const dedupedRelationships = Array.from(new Map(relationships.map((entry) => [entry.relatedUserId, entry])).values())
    const relatedUserIds = dedupedRelationships.map((entry) => entry.relatedUserId)
    const [relatedUsers, latestPostAtByUser]: [
      Array<{ id: string; handle: string; name: string | null; avatarUrl: string | null; coverUrl: string | null }>,
      Map<string, string>,
    ] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: relatedUserIds } },
        select: {
          id: true,
          handle: true,
          name: true,
          avatarUrl: true,
          coverUrl: true,
        },
      }),
      loadLatestPublicPostAtByUsers(relatedUserIds),
    ])

    const usersById = new Map(relatedUsers.map((user: typeof relatedUsers[number]) => [user.id, user]))

    return dedupedRelationships.flatMap((relationship) => {
      const user = usersById.get(relationship.relatedUserId)
      if (!user) return []

      return [{
        id: user.id,
        handle: user.handle,
        displayName: user.name?.trim() || relationship.relatedName?.trim() || user.handle,
        relationshipLabel: PROFILE_FAMILY_RELATIONSHIP_LABELS[relationship.familyType],
        avatarUrl: normalizeMediaUrl(user.avatarUrl ?? null),
        coverUrl: normalizeMediaUrl(user.coverUrl ?? null),
        latestPostAt: latestPostAtByUser.get(user.id) ?? null,
      }]
    })
  } catch (error) {
    console.error('profile_family_relationship_rail_load_failed', error)
    return []
  }
}

async function syncLegacyParentFamilyFeedPosts(parentId: string) {
  try {
    const [legacyRows, mirroredRows]: [
      Array<{
        familyMemberId: string
        body: string
        images: Prisma.JsonValue | null
        createdAt: Date
        updatedAt: Date
      }>,
      Array<{
        title: string
        body: string
        images: Prisma.JsonValue | null
        createdAt: Date
      }>,
    ] = await Promise.all([
      prisma.familyFeedPost.findMany({
        where: { parentId },
        orderBy: [{ createdAt: 'desc' }],
        take: 80,
        select: {
          familyMemberId: true,
          body: true,
          images: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.post.findMany({
        where: {
          authorId: parentId,
          type: FAMILY_FEED_POST_TYPE,
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
        select: {
          title: true,
          body: true,
          images: true,
          createdAt: true,
        },
      }),
    ])

    if (!legacyRows.length) return

    const mirroredKeys = new Set(
      mirroredRows
        .filter((row) => row.title.startsWith('family-feed:'))
        .map((row) => buildLegacyFamilyFeedMirrorKey({
          memberId: row.title.slice('family-feed:'.length),
          body: row.body,
          createdAt: row.createdAt,
          images: row.images,
        })),
    )

    const missingRows = legacyRows.filter((row) => !mirroredKeys.has(buildLegacyFamilyFeedMirrorKey({
      memberId: row.familyMemberId,
      body: row.body,
      createdAt: row.createdAt,
      images: row.images,
    })))

    if (!missingRows.length) return

    await prisma.$transaction(
      missingRows.map((row) =>
        prisma.post.create({
          data: {
            authorId: parentId,
            body: row.body,
            images: normalizeFamilyFeedImages(row.images).length ? (normalizeFamilyFeedImages(row.images) as any) : undefined,
            type: FAMILY_FEED_POST_TYPE,
            title: buildFamilyFeedPostTitle(row.familyMemberId),
            audience: 'family',
            visibility: 'public',
            jurisdiction: 'self',
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        }),
      ),
    )
  } catch (error) {
    if (!isSchemaOutOfDateError(error)) throw error
  }
}

function normalizeFamilyFeedImages(images: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(images)) return []
  return images.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function formatChildFamilyFeedPost(
  post: Pick<FamilyFeedPostRecord, 'id' | 'familyMemberId' | 'body' | 'images' | 'createdAt' | 'updatedAt'>,
  member: ReturnType<typeof normalizeFamilyMemberSummary>,
 ) {
  return {
    id: post.id,
    familyMemberId: post.familyMemberId,
    body: post.body,
    images: normalizeFamilyFeedImages(post.images),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    author: {
      id: member.id,
      handle: member.username,
      name: member.displayName,
      avatarUrl: member.avatarUrl,
      coverUrl: member.coverUrl,
      badgeLabel: member.relationshipLabel,
    },
    target: {
      id: member.id,
      name: member.displayName,
      relationshipLabel: member.relationshipLabel,
      modeBand: member.modeBand,
      modeLabel: member.modeLabel,
    },
  }
}

function formatParentFamilyFeedPost(
  post: {
    id: string
    familyMemberId: string
    body: string
    images: Prisma.JsonValue | null
    createdAt: Date
    updatedAt: Date
  },
  member: ReturnType<typeof normalizeFamilyMemberSummary>,
  author: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
  },
) {
  const authorName = author.name?.trim() || author.handle || 'Parent'

  return {
    id: post.id,
    familyMemberId: post.familyMemberId,
    body: post.body,
    images: normalizeFamilyFeedImages(post.images),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    author: {
      id: author.id,
      handle: author.handle,
      name: authorName,
      avatarUrl: normalizeMediaUrl(author.avatarUrl ?? null),
      coverUrl: normalizeMediaUrl(author.coverUrl ?? null),
      badgeLabel: 'Parent',
    },
    target: {
      id: member.id,
      name: member.displayName,
      relationshipLabel: member.relationshipLabel,
      modeBand: member.modeBand,
      modeLabel: member.modeLabel,
    },
  }
}

async function resolveFamilyFeedTargetMember(
  authContext: ViewerAuthContext,
  requestedMemberId?: string | null,
) {
  if (authContext.actor === 'family_member') {
    return authContext.member
  }

  const memberId = requestedMemberId?.trim()
  if (!memberId) return null
  return loadFamilyMemberAuthViewerById(memberId, authContext.userId)
}

async function resolveFamilyProfileAccess(
  authContext: ViewerAuthContext | null,
  targetMember: FamilyAuthMember,
): Promise<'self' | 'family' | 'friend' | null> {
  if (!authContext) return null

  if (authContext.actor === 'user') {
    if (authContext.userId === targetMember.parentId) return 'family'

    const directParentFriendship = await prisma.friendship.findFirst({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: authContext.userId, addresseeId: targetMember.parentId },
          { requesterId: targetMember.parentId, addresseeId: authContext.userId },
        ],
      },
      select: { id: true },
    })
    if (directParentFriendship) return 'friend'

    const [viewerMembers, viewerUser] = await Promise.all([
      loadNormalizedFamilyMembersForParent(authContext.userId),
      prisma.user.findUnique({ where: { id: authContext.userId }, select: { communityMeta: true } }),
    ])
    const viewerFriendships = getStoredFamilyFriendships(viewerUser?.communityMeta)
    const targetFriendships = getStoredFamilyFriendships(targetMember.parent.communityMeta)

    const hasDirectStoredParentLink =
      viewerFriendships.some(
        (friendship) => friendship.peerMemberId === targetMember.id && friendship.peerParentId === targetMember.parentId,
      ) ||
      targetFriendships.some(
        (friendship) => friendship.memberId === targetMember.id && friendship.peerParentId === authContext.userId,
      )

    if (hasDirectStoredParentLink) return 'friend'
    if (viewerMembers.length === 0) return null

    const hasFriendAccess = viewerMembers.some((member: ReturnType<typeof normalizeFamilyMemberSummary>) => {
      return (
        hasAcceptedFamilyFriendship(viewerFriendships, member.id, targetMember.id) ||
        hasAcceptedFamilyFriendship(targetFriendships, targetMember.id, member.id)
      )
    })

    return hasFriendAccess ? 'friend' : null
  }

  if (authContext.member.id === targetMember.id) return 'self'
  if (authContext.member.parentId === targetMember.parentId) return 'family'

  const viewerFriendships = getStoredFamilyFriendships(authContext.member.parent.communityMeta)
  if (hasAcceptedFamilyFriendship(viewerFriendships, authContext.member.id, targetMember.id)) {
    return 'friend'
  }

  return null
}

async function resolveReadableFamilyFeedTargetMember(
  authContext: ViewerAuthContext,
  requestedMemberId?: string | null,
) {
  const memberId = requestedMemberId?.trim()
  if (authContext.actor === 'family_member') {
    if (!memberId || memberId === authContext.member.id) return authContext.member
    const targetMember = await loadFamilyMemberAuthViewerById(memberId)
    if (!targetMember) return null
    return (await resolveFamilyProfileAccess(authContext, targetMember)) ? targetMember : null
  }

  if (!memberId) return null
  const targetMember = await loadFamilyMemberAuthViewerById(memberId)
  if (!targetMember) return null
  return (await resolveFamilyProfileAccess(authContext, targetMember)) ? targetMember : null
}

function buildFamilyProfileRelationshipPayload(
  authContext: ViewerAuthContext | null,
  access: 'self' | 'family' | 'friend' | null,
) {
  const friendshipStatus =
    authContext?.actor === 'family_member'
      ? access === 'self'
        ? 'self'
        : access === 'friend'
          ? 'friends'
          : 'none'
      : 'none'

  return {
    friendshipStatus,
    friendshipId: undefined,
    friendshipSince: null,
    connectionStatus: friendshipStatus === 'self' ? 'self' : 'none',
    connectionId: undefined,
    connectionSince: null,
  }
}

function normalizeFamilyMemberDraftSummary(draft: { id: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: draft.id,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }
}

function normalizeFamilyMemberDraftEditorRecord(draft: {
  id: string
  firstName: string | null
  lastName: string | null
  dateOfBirth: Date | null
  relationship: FamilyRelationship | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: draft.id,
    kind: 'draft' as const,
    firstName: draft.firstName ?? '',
    lastName: draft.lastName ?? '',
    relationship: draft.relationship ?? 'son',
    dateOfBirth: draft.dateOfBirth ? draft.dateOfBirth.toISOString().slice(0, 10) : '',
    friendCode: null,
    avatarUrl: null,
    coverUrl: null,
    allowChildOwnMediaEdits: false,
    notifyParentOnMediaChanges: false,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }
}

function parseFamilyMemberDateOfBirth(rawDateOfBirth: string) {
  const dateOfBirth = new Date(`${rawDateOfBirth}T00:00:00.000Z`)
  if (Number.isNaN(dateOfBirth.getTime())) return { error: 'family_member_invalid_dob' as const }

  const age = calculateAgeFromDateOfBirth(dateOfBirth)
  if (age < 5) return { error: 'family_member_too_young' as const }
  if (age > 120) return { error: 'family_member_invalid_age' as const }

  return { dateOfBirth, age }
}

function buildFamilySuspensionMessage(displayName: string) {
  return `${displayName} has been suspended in Family Mode until a parent or guardian restores the account.`
}

function buildFamilyFriendCode() {
  return `${randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()}-${randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase()}-${randomUUID().replace(/-/g, '').slice(0, 2).toUpperCase()}`
}

function normalizeFamilyMemberUsernameCandidate(value: string) {
  return value.trim()
}

function normalizeFamilyMemberUsernameLookup(value: string) {
  return normalizeFamilyMemberUsernameCandidate(value).toLowerCase()
}

function isValidFamilyMemberUsername(value: string) {
  return FAMILY_MEMBER_USERNAME_PATTERN.test(normalizeFamilyMemberUsernameCandidate(value))
}

function buildDefaultFamilyMemberUsernameBase(firstName: string, lastName: string) {
  const base = buildHandleBase(firstName, lastName).slice(0, FAMILY_MEMBER_USERNAME_MAX_LENGTH)
  if (base.length >= FAMILY_MEMBER_USERNAME_MIN_LENGTH) return base
  return `${base}${'friend'.slice(0, Math.max(0, FAMILY_MEMBER_USERNAME_MIN_LENGTH - base.length))}`.slice(0, FAMILY_MEMBER_USERNAME_MAX_LENGTH)
}

function applyFamilyMemberUsernameSuffix(base: string, attempt: number) {
  if (attempt === 0) return base
  const suffix = String(attempt + 1)
  const trimmedBase = base.slice(0, Math.max(FAMILY_MEMBER_USERNAME_MIN_LENGTH, FAMILY_MEMBER_USERNAME_MAX_LENGTH - suffix.length))
  return `${trimmedBase}${suffix}`.slice(0, FAMILY_MEMBER_USERNAME_MAX_LENGTH)
}

async function isFamilyMemberUsernameTaken(
  username: string,
  options?: {
    excludeMemberId?: string | null
  },
) {
  const normalizedLookup = normalizeFamilyMemberUsernameLookup(username)

  const existingUser = await prisma.user.findFirst({
    where: {
      handle: {
        equals: normalizedLookup,
        mode: 'insensitive',
      },
    },
    select: { id: true },
  })
  if (existingUser) return true

  try {
    const existingMember = await prisma.familyMember.findFirst({
      where: {
        username: {
          equals: normalizeFamilyMemberUsernameCandidate(username),
          mode: 'insensitive',
        },
        ...(options?.excludeMemberId ? { NOT: { id: options.excludeMemberId } } : {}),
      },
      select: { id: true },
    })
    return Boolean(existingMember)
  } catch (error) {
    if (!isFamilyMemberTableMissing(error)) throw error

    const users = await prisma.user.findMany({
      select: {
        communityMeta: true,
      },
    })

    return users.some((user: { communityMeta: Prisma.JsonValue | null }) => {
      const settings = parseCommunityMeta(user.communityMeta ?? null)?.familyMemberSettings
      if (!settings) return false
      return Object.entries(settings).some(([memberId, value]) => {
        if (options?.excludeMemberId && memberId === options.excludeMemberId) return false
        return normalizeFamilyMemberUsernameLookup(value?.username ?? '') === normalizedLookup
      })
    })
  }
}

async function generateUniqueFamilyMemberUsername(firstName: string, lastName: string) {
  const base = buildDefaultFamilyMemberUsernameBase(firstName, lastName)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = applyFamilyMemberUsernameSuffix(base, attempt)
    if (!(await isFamilyMemberUsernameTaken(candidate))) {
      return candidate
    }
  }
  throw new Error('family_username_generation_failed')
}

async function findFamilyMemberByInviteCode(inviteCode: string) {
  const normalizedInviteCode = inviteCode.trim().toUpperCase()
  if (!normalizedInviteCode) return null
  const member = await prisma.familyMember.findFirst({
    where: { friendCode: normalizedInviteCode },
    select: { id: true, parentId: true },
  })
  if (!member) return null
  return loadFamilyMemberAuthViewerById(member.id, member.parentId)
}

async function findFamilyMemberByUsername(username: string) {
  const normalizedLookup = normalizeFamilyMemberUsernameLookup(username)
  if (!normalizedLookup) return null

  try {
    const member = await prisma.familyMember.findFirst({
      where: {
        username: {
          equals: username.trim(),
          mode: 'insensitive',
        },
      },
      select: { id: true, parentId: true },
    })
    if (member) {
      return loadFamilyMemberAuthViewerById(member.id, member.parentId)
    }
  } catch (error) {
    if (!isFamilyMemberTableMissing(error)) throw error
  }

  const members = await prisma.familyMember.findMany({
    select: {
      id: true,
      parentId: true,
      firstName: true,
      lastName: true,
      friendCode: true,
      parent: {
        select: {
          communityMeta: true,
        },
      },
    },
  })

  for (const member of members) {
    const candidate =
      getLegacyFamilyMemberStoredUsername(member.parent.communityMeta, member.id) ??
      buildDefaultFamilyMemberUsernameBase(member.firstName, member.lastName)
    if (normalizeFamilyMemberUsernameLookup(candidate) === normalizedLookup) {
      return loadFamilyMemberAuthViewerById(member.id, member.parentId)
    }
  }

  return null
}

async function generateUniqueFamilyFriendCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = buildFamilyFriendCode()
    let existing: { id: string } | null = null
    try {
      existing = await prisma.familyMember.findUnique({ where: { friendCode: candidate }, select: { id: true } })
    } catch (error) {
      if (!isFamilyMemberTableMissing(error)) throw error
      return candidate
    }
    if (!existing) return candidate
  }
  throw new Error('family_friend_code_generation_failed')
}

function readAccountModerationState(value: Prisma.JsonValue | null | undefined): AccountModerationState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  const rawState = payload.accountModeration
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) return null

  const state = rawState as Record<string, unknown>
  if (state.status !== 'SUSPENDED') return null

  return {
    status: 'SUSPENDED',
    suspendedAt: typeof state.suspendedAt === 'string' ? state.suspendedAt : undefined,
    suspendedByUserId: typeof state.suspendedByUserId === 'string' ? state.suspendedByUserId : null,
    suspensionReason: typeof state.suspensionReason === 'string' ? state.suspensionReason : null,
    sourceReportId: typeof state.sourceReportId === 'string' ? state.sourceReportId : null,
  }
}

function isAccountSuspended(value: Prisma.JsonValue | null | undefined) {
  return readAccountModerationState(value)?.status === 'SUSPENDED'
}

async function loadActiveAuthUserById(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      communityMeta: true,
    },
  })

  if (!user || isAccountSuspended(user.communityMeta)) return null
  return user
}

type AuthJwtPayload = {
  sub?: string
  actor?: 'user' | 'family_member'
  parentId?: string
}

type FamilyMemberAuthViewerRecord = {
  id: string
  parentId: string
  firstName: string
  lastName: string
  dateOfBirth: Date
  relationship: FamilyRelationship
  friendCode: string
  username: string | null
  avatarUrl: string | null
  coverUrl: string | null
  allowChildOwnMediaEdits: boolean
  allowChildOwnUsernameEdits: boolean
  allowChildAudioCalls: boolean
  allowChildVideoCalls: boolean
  notifyParentOnMediaChanges: boolean
  suspendedAt: Date | null
  suspendedById: string | null
  suspensionNote: string | null
  createdAt: Date
  updatedAt: Date
  parent: {
    id: string
    email: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
    communityMeta: Prisma.JsonValue | null
    premiumStatus: PremiumStatus
    premiumSince: Date | null
    premiumRenewsAt: Date | null
  }
}

async function loadFamilyMemberAuthViewerById(memberId: string, parentId?: string | null) {
  let member: FamilyMemberAuthViewerRecord | null = null

  try {
    member = await prisma.familyMember.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        parentId: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        relationship: true,
        friendCode: true,
        username: true,
        avatarUrl: true,
        coverUrl: true,
        allowChildOwnMediaEdits: true,
        allowChildOwnUsernameEdits: true,
        allowChildAudioCalls: true,
        allowChildVideoCalls: true,
        notifyParentOnMediaChanges: true,
        suspendedAt: true,
        suspendedById: true,
        suspensionNote: true,
        createdAt: true,
        updatedAt: true,
        parent: {
          select: {
            id: true,
            email: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
            communityMeta: true,
            premiumStatus: true,
            premiumSince: true,
            premiumRenewsAt: true,
          },
        },
      },
    })
  } catch (error) {
    if (!isFamilyMemberTableMissing(error)) throw error

    const legacyMember = await prisma.familyMember.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        parentId: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        relationship: true,
        friendCode: true,
        suspendedAt: true,
        suspendedById: true,
        suspensionNote: true,
        createdAt: true,
        updatedAt: true,
        parent: {
          select: {
            id: true,
            email: true,
            handle: true,
            name: true,
            avatarUrl: true,
            coverUrl: true,
            communityMeta: true,
            premiumStatus: true,
            premiumSince: true,
            premiumRenewsAt: true,
          },
        },
      },
    })

    member = legacyMember
      ? {
          ...legacyMember,
          username: getLegacyFamilyMemberStoredUsername(legacyMember.parent.communityMeta, legacyMember.id),
          ...getLegacyFamilyMemberStoredProfileMedia(legacyMember.parent.communityMeta, legacyMember.id),
          ...getLegacyFamilyMemberPermissionSettings(legacyMember.parent.communityMeta, legacyMember.id),
        }
      : null
  }

  if (!member) return null
  if (parentId && member.parentId !== parentId) return null
  if (isAccountSuspended(member.parent.communityMeta)) return null
  return member
}

async function buildHomeCommunitySummaryForUserId(userId: string) {
  const homeFollow = await prisma.communityFollow.findFirst({ where: { userId, home: true } })
  if (!homeFollow) return null

  const community = findCommunity(homeFollow.provinceCode, homeFollow.communitySlug)
  const normalizedProvince = normalizeProvinceCode(homeFollow.provinceCode)
  return {
    provinceCode: normalizedProvince ?? homeFollow.provinceCode,
    provinceName: normalizedProvince
      ? getProvinceDisplayName(normalizedProvince)
      : homeFollow.provinceCode.toUpperCase(),
    communitySlug: homeFollow.communitySlug,
    communityName: community?.name ?? homeFollow.communitySlug,
  }
}

function buildFamilyMemberAuthMeResponse(member: {
  id: string
  parentId: string
  firstName: string
  lastName: string
  dateOfBirth: Date
  relationship: FamilyRelationship
  friendCode: string
  username: string | null
  avatarUrl: string | null
  coverUrl: string | null
  allowChildOwnMediaEdits: boolean
  allowChildOwnUsernameEdits: boolean
  allowChildAudioCalls: boolean
  allowChildVideoCalls: boolean
  notifyParentOnMediaChanges: boolean
  suspendedAt: Date | null
  suspendedById: string | null
  suspensionNote: string | null
  createdAt: Date
  updatedAt: Date
  parent: {
    id: string
    email: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
    communityMeta: Prisma.JsonValue | null
    premiumStatus: PremiumStatus
    premiumSince: Date | null
    premiumRenewsAt: Date | null
  }
}, homeCommunity: {
  provinceCode: string
  provinceName: string
  communitySlug: string
  communityName: string
} | null) {
  const normalizedMember = normalizeFamilyMemberSummary(member)
  const parentMeta = parseCommunityMeta(member.parent.communityMeta ?? null)
  return {
    id: normalizedMember.id,
    email: `${normalizedMember.friendCode.toLowerCase()}@family.local`,
    handle: `family-${normalizedMember.friendCode.toLowerCase()}`,
    name: normalizedMember.displayName,
    avatarUrl: normalizedMember.avatarUrl,
    coverUrl: normalizedMember.coverUrl,
    homeCommunity,
    isPremium: false,
    isVerified: false,
    premiumSince: null,
    premiumRenewsAt: null,
    civicStatus: parentMeta?.civicStatus ?? null,
    workAuthorization: parentMeta?.workAuthorization ?? null,
    verificationMethod: parentMeta?.verificationMethod ?? null,
    statusDeclaredAt: parentMeta?.statusDeclaredAt ?? null,
    statusUpdatedAt: parentMeta?.statusUpdatedAt ?? null,
    familyMode: null,
    accountType: 'family_member' as const,
    familyMemberSession: {
      parentId: member.parent.id,
      parentHandle: member.parent.handle,
      parentName: member.parent.name,
      username: normalizedMember.username,
      relationshipLabel: normalizedMember.relationshipLabel,
      modeBand: normalizedMember.modeBand,
      modeLabel: normalizedMember.modeLabel,
      age: normalizedMember.age,
      allowChildOwnMediaEdits: normalizedMember.allowChildOwnMediaEdits,
      allowChildOwnUsernameEdits: normalizedMember.allowChildOwnUsernameEdits,
      allowChildAudioCalls: normalizedMember.allowChildAudioCalls,
      allowChildVideoCalls: normalizedMember.allowChildVideoCalls,
      notifyParentOnMediaChanges: normalizedMember.notifyParentOnMediaChanges,
      suspended: normalizedMember.suspended,
      suspendedAt: normalizedMember.suspendedAt,
      suspensionNote: normalizedMember.suspensionNote,
    },
  }
}

function filterCachedSuggestions(
  suggestions: CitySummaryType[] | undefined,
  excludeKeys: Set<string>,
  limit = COMMUNITY_SUGGESTION_CACHE_LIMIT,
): CitySummaryType[] {
  if (!suggestions?.length) return []
  const filtered: CitySummaryType[] = []
  for (const entry of suggestions) {
    if (!entry?.communitySlug) continue
    const key = buildFollowKey(entry.provinceCode, entry.communitySlug)
    if (excludeKeys.has(key)) continue
    filtered.push(entry)
    if (filtered.length >= limit) break
  }
  return filtered
}

async function computeNearbyCommunitySuggestions(
  referenceCity: CityModel | null,
  excludeKeys: Set<string>,
  limit = COMMUNITY_SUGGESTION_CACHE_LIMIT,
): Promise<CitySummaryType[]> {
  let candidateCities: Array<{ city: CityModel; distance?: number }> = []

  if (referenceCity) {
    const provinceCities = await prisma.city.findMany({
      where: { provinceCode: referenceCity.provinceCode },
      orderBy: [{ population: 'desc' }, { name: 'asc' }],
      take: 400,
    })

    candidateCities = provinceCities.map((city: CityModel) => {
      let distance: number | undefined
      if (
        typeof referenceCity.latitude === 'number' &&
        typeof referenceCity.longitude === 'number' &&
        typeof city.latitude === 'number' &&
        typeof city.longitude === 'number'
      ) {
        distance = haversineDistanceKm(referenceCity.latitude, referenceCity.longitude, city.latitude, city.longitude)
      }
      return { city, distance }
    })

    candidateCities.sort((a, b) => {
      const distanceA = a.distance
      const distanceB = b.distance
      if (typeof distanceA === 'number' && typeof distanceB === 'number') {
        return distanceA - distanceB
      }
      if (typeof distanceA === 'number') return -1
      if (typeof distanceB === 'number') return 1
      const populationA = a.city.population ?? 0
      const populationB = b.city.population ?? 0
      return populationB - populationA
    })
  } else {
    const topCities = await prisma.city.findMany({
      orderBy: [{ population: 'desc' }, { name: 'asc' }],
      take: 400,
    })
    candidateCities = topCities.map((city: CityModel) => ({ city }))
  }

  const suggestions: CitySummaryType[] = []
  for (const candidate of candidateCities) {
    if (!candidate.city.communitySlug) continue
    const key = buildFollowKey(candidate.city.provinceCode, candidate.city.communitySlug)
    if (excludeKeys.has(key)) continue
    suggestions.push(formatCitySummary(candidate.city, candidate.distance))
    if (suggestions.length >= limit) break
  }

  return suggestions
}

function normalizeEmail(value?: string | null): string | null {
  if (!value) return null
  return value.trim().toLowerCase() || null
}

const SUPER_ADMIN_EMAILS = (() => {
  const emails = new Set<string>()
  for (const email of DEFAULT_SUPER_ADMINS) {
    const normalized = normalizeEmail(email)
    if (normalized) emails.add(normalized)
  }
  const extra = (process.env.CIVIL_ADMIN_EMAILS || '')
    .split(/[,;]/)
    .map((email) => normalizeEmail(email))
    .filter((email): email is string => Boolean(email))
  for (const email of extra) {
    emails.add(email)
  }
  return emails
})()

function isSuperAdminEmail(email?: string | null): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return SUPER_ADMIN_EMAILS.has(normalized)
}

type AdminChecklistItemDefinition = {
  key: string
  label: string
  optional?: boolean
  hint?: string
  resolve?: () => boolean
}

type AdminChecklistGroupDefinition = {
  id: string
  title: string
  description?: string
  items: AdminChecklistItemDefinition[]
}

const ADMIN_CHECKLIST_GROUPS: AdminChecklistGroupDefinition[] = [
  {
    id: 'environment',
    title: 'Environment metadata',
    description: 'Values exported by the launcher to explain which env file is active.',
    items: [
      { key: 'CIVIL_ENV_LABEL', label: 'Environment label', hint: 'Human friendly tag for dashboards.' },
      { key: 'CIVIL_ENV_PRIMARY', label: 'Primary env file', hint: 'Path recorded by the launcher.' },
    ],
  },
  {
    id: 'stripe',
    title: 'Stripe configuration',
    description: 'Keys required for premium and business billing.',
    items: [
      { key: 'STRIPE_SECRET_KEY', label: 'Secret key', resolve: () => Boolean(STRIPE_SECRET_KEY) },
      { key: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook secret', resolve: () => Boolean(STRIPE_WEBHOOK_SECRET) },
      { key: 'STRIPE_PRICE_PREMIUM_MONTHLY', label: 'Premium price ID', resolve: () => Boolean(STRIPE_PRICE_PREMIUM) },
      { key: 'STRIPE_PRICE_BUSINESS_MONTHLY', label: 'Business price ID', resolve: () => Boolean(STRIPE_PRICE_BUSINESS) },
      {
        key: 'STRIPE_PUBLIC_KEY',
        label: 'Publishable key',
        optional: true,
        hint: 'Accepts STRIPE_PUBLIC_KEY or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.',
        resolve: () => Boolean(STRIPE_PUBLISHABLE_KEY),
      },
      { key: 'BILLING_RETURN_URL', label: 'Billing portal return URL', optional: true },
    ],
  },
]

function envValuePresent(key: string): boolean {
  const value = process.env[key]
  if (typeof value !== 'string') return false
  return value.trim().length > 0
}

function buildAdminChecklist() {
  return ADMIN_CHECKLIST_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    items: group.items.map((item) => ({
      key: item.key,
      label: item.label,
      optional: Boolean(item.optional),
      hint: item.hint,
      present: item.resolve ? item.resolve() : envValuePresent(item.key),
    })),
  }))
}

let stripeClient: Stripe | null = null

function isStripeConfigured() {
  return Boolean(STRIPE_SECRET_KEY)
}

function requireStripeConfig() {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing features.')
  }
}

function getStripeClient() {
  requireStripeConfig()
  if (stripeClient) return stripeClient
  stripeClient = new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION })
  return stripeClient
}

function mapSubscriptionStatus(status?: Stripe.Subscription.Status | null): PremiumStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'ACTIVE'
    case 'past_due':
    case 'unpaid':
      return 'PAST_DUE'
    case 'canceled':
    case 'incomplete_expired':
      return 'CANCELED'
    default:
      return 'PENDING'
  }
}

function businessStatusFromSubscription(status?: Stripe.Subscription.Status | null): BusinessStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'ACTIVE'
    case 'past_due':
    case 'unpaid':
      return 'SUSPENDED'
    case 'canceled':
    case 'incomplete_expired':
      return 'CANCELED'
    default:
      return 'DRAFT'
  }
}

function isPremium(status: PremiumStatus | null | undefined) {
  return status === 'ACTIVE'
}

function isSelfVerifiedCanadianCitizen(meta: CommunityMetaPayload | null | undefined) {
  return meta?.civicStatus === 'citizen' && meta?.verificationMethod === 'self_declaration'
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function normalizeMediaUrl(url?: string | null): string | null {
  if (!url) return url ?? null
  for (const legacy of LEGACY_MEDIA_BASE_URLS) {
    if (url.startsWith(legacy)) {
      return `${MEDIA_PUBLIC_BASE_URL}${url.slice(legacy.length)}`
    }
  }
  return url
}

function normalizeMediaVariants(variants: unknown): unknown {
  if (!variants || typeof variants !== 'object') return variants
  let mutated = false
  const copy: Record<string, any> = { ...(variants as Record<string, any>) }
  for (const [name, value] of Object.entries(copy)) {
    if (value && typeof value === 'object' && typeof (value as any).url === 'string') {
      const normalized = normalizeMediaUrl((value as any).url)
      if (normalized !== (value as any).url) {
        copy[name] = { ...value, url: normalized }
        mutated = true
      }
    }
  }
  return mutated ? copy : variants
}

function normalizeUserMedia<T extends { avatarUrl?: string | null; coverUrl?: string | null }>(user: T): T {
  const normalizedAvatar = normalizeMediaUrl(user.avatarUrl ?? null)
  const normalizedCover = normalizeMediaUrl(user.coverUrl ?? null)
  if (normalizedAvatar !== (user.avatarUrl ?? null) || normalizedCover !== (user.coverUrl ?? null)) {
    return {
      ...user,
      avatarUrl: normalizedAvatar,
      coverUrl: normalizedCover,
    }
  }
  return user
}

const MB = 1024 * 1024
const MEDIA_CATEGORY_LIMITS: Record<MediaCategory, number> = {
  avatar: 8 * MB,
  cover: 20 * MB,
  business_logo: 8 * MB,
  business_cover: 20 * MB,
  post_image: 80 * MB,
  attachment: 200 * MB,
}
const MEDIA_PROXY_UPLOAD_LIMIT = 250 * MB

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'])
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
}
const BINARY_UPLOAD_MIME_TYPES = ['application/octet-stream', ...IMAGE_MIME_TYPES]

const s3Client = new S3Client({
  region: MEDIA_S3_REGION,
  endpoint: MEDIA_S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: MEDIA_S3_ACCESS_KEY,
    secretAccessKey: MEDIA_S3_SECRET_KEY,
  },
})

export const app = Fastify({
  logger: true,
  trustProxy: true, // behind Nginx/Cloudflare
})

type CommunityRouteMethod = 'delete' | 'get' | 'patch' | 'post' | 'put'
type CommunityRouteHandler = (req: FastifyRequest, reply: FastifyReply) => unknown

// Registers a community route and keeps a legacy /chambers alias for older clients.
function registerCommunityRoute(method: CommunityRouteMethod, path: string, handler: CommunityRouteHandler) {
  if (!path.startsWith('/communities')) {
    throw new Error(`registerCommunityRoute requires /communities path, received: ${path}`)
  }
  ;(app as any)[method](path, handler)
  const legacyPath = path.replace('/communities', '/chambers')
  if (legacyPath !== path) {
    ;(app as any)[method](legacyPath, handler)
  }
}

for (const mime of BINARY_UPLOAD_MIME_TYPES) {
  app.addContentTypeParser(mime, { parseAs: 'buffer' }, (request, payload, done) => {
    done(null, payload)
  })
}

const EARTH_RADIUS_KM = 6371

function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

const POSTAL_SANITIZE_RE = /[^A-Z0-9]/g
const POSTAL_FSA_REGEX = /^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]$/
const POSTAL_FULL_REGEX = /^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/

type NormalizedPostal = {
  postal: string
  fsa: string
}

function normalizePostalCodeInput(value?: string | null): NormalizedPostal | null {
  if (!value) return null
  const sanitized = value.toUpperCase().replace(POSTAL_SANITIZE_RE, '')
  if (sanitized.length < 3) return null
  const fsa = sanitized.slice(0, 3)
  if (!POSTAL_FSA_REGEX.test(fsa)) return null
  const full = sanitized.slice(0, 6)
  const postal = POSTAL_FULL_REGEX.test(full) ? full : fsa
  return { postal, fsa }
}

type ProvinceCodeLiteral = (typeof PROVINCES)[number]['code']

function formatCitySummary(city: CityModel, distanceKm?: number): CitySummaryType {
  const provinceName = getProvinceDisplayName(city.provinceCode) ?? city.provinceCode.toUpperCase()
  return {
    name: city.name,
    slug: city.slug,
    provinceCode: city.provinceCode,
    provinceName,
    communitySlug: city.communitySlug,
    communityName: city.communityName,
    latitude: city.latitude,
    longitude: city.longitude,
    population: city.population ?? null,
    distanceKm: typeof distanceKm === 'number' ? Number(distanceKm.toFixed(1)) : undefined,
  }
}

function pickNearestCitySummary(cities: CityModel[], lat: number, lng: number): CitySummaryType | undefined {
  if (!cities.length) return undefined
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return formatCitySummary(cities[0]!)
  }
  let closest: CityModel | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const city of cities) {
    const distance = haversineDistanceKm(lat, lng, city.latitude, city.longitude)
    if (!closest || distance < bestDistance) {
      closest = city
      bestDistance = distance
    }
  }
  if (!closest) return formatCitySummary(cities[0]!)
  return formatCitySummary(closest, bestDistance)
}

type CommunitySummaryPayload = {
  provinceCode: ProvinceCodeLiteral
  provinceName: string
  municipalitySlug: string
  municipalityName: string
  population: number | null
  regionLabel: string | null
  communitySlug: string | null
  communityName: string | null
  censusSubdivision: {
    slug: string
    name: string
    type: string | null
  } | null
  source: 'city' | 'subdivision'
}

const pickLabel = (...labels: Array<string | null | undefined>) => {
  for (const candidate of labels) {
    if (!candidate) continue
    const trimmed = candidate.trim()
    if (trimmed) return trimmed
  }
  return null
}

type CityWithSubdivision = CityModel & {
  censusSubdivision?: {
    slug: string
    name: string
    type: string | null
    defaultCommunityName: string | null
  } | null
}

function buildCommunityPayloadFromCity(city: CityWithSubdivision): CommunitySummaryPayload {
  const provinceCode = city.provinceCode as ProvinceCodeLiteral
  return {
    provinceCode,
    provinceName: getProvinceDisplayName(provinceCode) ?? provinceCode.toUpperCase(),
    municipalitySlug: city.slug,
    municipalityName: city.name,
    population: city.population ?? null,
    regionLabel: pickLabel(city.censusSubdivision?.defaultCommunityName, city.censusSubdivision?.name, city.communityName),
    communitySlug: city.communitySlug,
    communityName: city.communityName,
    censusSubdivision: city.censusSubdivision
      ? {
          slug: city.censusSubdivision.slug,
          name: city.censusSubdivision.name,
          type: city.censusSubdivision.type ?? null,
        }
      : null,
    source: 'city',
  }
}

type SubdivisionWithDivision = {
  slug: string
  name: string
  officialName: string | null
  type: string | null
  population: number | null
  defaultCommunityName: string | null
  defaultCommunitySlug: string | null
  division: { name: string | null } | null
}

function buildCommunityPayloadFromSubdivision(
  subdivision: SubdivisionWithDivision,
  provinceCode: ProvinceCodeLiteral,
): CommunitySummaryPayload {
  const municipalityName = pickLabel(subdivision.officialName, subdivision.name) ?? subdivision.name
  return {
    provinceCode,
    provinceName: getProvinceDisplayName(provinceCode) ?? provinceCode.toUpperCase(),
    municipalitySlug: subdivision.slug,
    municipalityName,
    population: subdivision.population ?? null,
    regionLabel: pickLabel(subdivision.defaultCommunityName, subdivision.division?.name, subdivision.name),
    communitySlug: subdivision.defaultCommunitySlug ? subdivision.defaultCommunitySlug : null,
    communityName: pickLabel(subdivision.defaultCommunityName),
    censusSubdivision: {
      slug: subdivision.slug,
      name: subdivision.name,
      type: subdivision.type ?? null,
    },
    source: 'subdivision',
  }
}

type LocateResult = Awaited<ReturnType<typeof locateCommunityFromPoint>>
type RawGeoMatch = NonNullable<LocateResult['primary']>
type RawGeoMatchOrNull = LocateResult['primary']
type EnrichedGeoMatch = RawGeoMatch & { city?: CitySummaryType }
type EnrichedGeoMatchOrNull = (RawGeoMatch & { city?: CitySummaryType }) | null

async function enrichMatchesWithCities(matches: RawGeoMatchOrNull[], lat: number, lng: number): Promise<EnrichedGeoMatchOrNull[]> {
  const validMatches = matches.filter((match): match is RawGeoMatch => Boolean(match))
  if (!validMatches.length) {
    return matches as EnrichedGeoMatchOrNull[]
  }

  const communitySlugs = [...new Set(validMatches.map((match) => match.communitySlug))]
  const cityRows = await prisma.city.findMany({
    where: { communitySlug: { in: communitySlugs } },
  })

  const citiesByCommunity = new Map<string, CityModel[]>()
  for (const city of cityRows) {
    const list = citiesByCommunity.get(city.communitySlug)
    if (list) {
      list.push(city)
    } else {
      citiesByCommunity.set(city.communitySlug, [city])
    }
  }

  return matches.map((match) => {
    if (!match) return null
    const cityOptions = citiesByCommunity.get(match.communitySlug) ?? []
    const summary = pickNearestCitySummary(cityOptions, lat, lng)
    if (!summary) return match
    return { ...match, city: summary }
  }) as EnrichedGeoMatchOrNull[]
}

async function citySummaryFromGeoMatch(match: EnrichedGeoMatch): Promise<CitySummaryType | null> {
  if (!match) return null
  if (match.city) return match.city
  const centroid = await getCommunityCentroid(match.province, match.communitySlug)
  if (!centroid) return null
  const provinceName = getProvinceDisplayName(match.province as ProvinceCodeLiteral) ?? match.province.toUpperCase()
  return {
    name: match.communityName,
    slug: match.communitySlug,
    provinceCode: match.province,
    provinceName,
    communitySlug: match.communitySlug,
    communityName: match.communityName,
    latitude: centroid.lat,
    longitude: centroid.lng,
    population: match.city?.population ?? null,
    distanceKm: typeof match.distanceKm === 'number' ? Number(match.distanceKm.toFixed(1)) : undefined,
  }
}

async function computeGeodataFallbackSuggestions(
  referenceFollow: { provinceCode: string; communitySlug: string },
  excludeKeys: Set<string>,
  limit = COMMUNITY_SUGGESTION_CACHE_LIMIT,
): Promise<CitySummaryType[]> {
  const centroid = await getCommunityCentroid(referenceFollow.provinceCode, referenceFollow.communitySlug)
  if (!centroid) return []
  const locateResult = await locateCommunityFromPoint(centroid.lat, centroid.lng, { limit })
  const enriched = await enrichMatchesWithCities([locateResult.primary, ...locateResult.alternatives], centroid.lat, centroid.lng)
  const suggestions: CitySummaryType[] = []
  for (const match of enriched) {
    if (!match) continue
    const key = buildFollowKey(match.province, match.communitySlug)
    if (excludeKeys.has(key)) continue
    const summary = await citySummaryFromGeoMatch(match)
    if (!summary) continue
    suggestions.push(summary)
    if (suggestions.length >= limit) break
  }
  return suggestions
}

await app.register(cors, { origin: true, credentials: true })
await app.register(jwt, { secret: JWT_SECRET })
await app.register(sse as any)
await app.register(rawBody, {
  field: 'rawBody',
  global: false,
  encoding: false,
  runFirst: true,
})

const redis = new IORedis(REDIS_URL)
void redis

const mediaQueue = new Queue('media', {
  connection: {
    url: REDIS_URL,
  },
})

const contentAiScanQueue = new Queue('content-ai-scan', {
  connection: {
    url: REDIS_URL,
  },
})

const CONTENT_AI_IMAGE_SCAN_DELAY_MS = 45_000

const FRIEND_USER_SELECT = {
  id: true,
  handle: true,
  name: true,
  avatarUrl: true,
  coverUrl: true,
  premiumStatus: true,
  communityMeta: true,
} satisfies Prisma.UserSelect

type FriendUser = Prisma.UserGetPayload<{ select: typeof FRIEND_USER_SELECT }>

function formatFriendUser(user: FriendUser) {
  const communityMeta = parseCommunityMeta(user.communityMeta ?? null)
  return {
    id: user.id,
    handle: user.handle,
    name: user.name,
    avatarUrl: normalizeMediaUrl(user.avatarUrl ?? null),
    coverUrl: normalizeMediaUrl(user.coverUrl ?? null),
    isPremium: isPremium(user.premiumStatus),
    isVerified: isSelfVerifiedCanadianCitizen(communityMeta),
  }
}

const FRIENDSHIP_WITH_USERS_INCLUDE = {
  requester: { select: FRIEND_USER_SELECT },
  addressee: { select: FRIEND_USER_SELECT },
} satisfies Prisma.FriendshipInclude

type FriendshipWithUsers = Prisma.FriendshipGetPayload<{ include: typeof FRIENDSHIP_WITH_USERS_INCLUDE }>

const NOTIFICATION_SELECT = {
  id: true,
  userId: true,
  actorId: true,
  type: true,
  postId: true,
  payload: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect

type NotificationRecord = Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>

function formatNotification(record: NotificationRecord) {
  return {
    id: record.id,
    type: record.type,
    actorId: record.actorId,
    postId: record.postId ?? null,
    payload: record.payload ?? null,
    readAt: record.readAt ?? null,
    createdAt: record.createdAt,
    unread: !record.readAt,
  }
}

async function dispatchRealtimeEvent(userId: string, payload: { type: string; data: unknown }) {
  const channel = `${NOTIFICATION_CHANNEL_PREFIX}${userId}`
  try {
    await redis.publish(channel, JSON.stringify(payload))
  } catch (err) {
    console.error('failed to publish realtime payload', err)
  }
}

function getRealtimeOnlineKey(userId: string) {
  return `${REALTIME_ONLINE_KEY_PREFIX}${userId}`
}

async function markUserRealtimeOnline(userId: string, connectionId: string) {
  const key = getRealtimeOnlineKey(userId)
  const expiresAt = Date.now() + REALTIME_ONLINE_TTL_MS
  await redis.zadd(key, expiresAt, connectionId)
  await redis.pexpire(key, REALTIME_ONLINE_TTL_MS * 2)
}

async function clearUserRealtimeOnline(userId: string, connectionId: string) {
  const key = getRealtimeOnlineKey(userId)
  await redis.zrem(key, connectionId)
  const remaining = await redis.zcard(key)
  if (remaining === 0) {
    await redis.del(key)
  }
}

async function isUserRealtimeOnline(userId: string) {
  const key = getRealtimeOnlineKey(userId)
  await redis.zremrangebyscore(key, '-inf', Date.now())
  return (await redis.zcard(key)) > 0
}

async function loadActivePushTokens(userId: string, platform = 'ios'): Promise<string[]> {
  try {
    await ensurePushDeviceRegistryTable()
    const rows = await prisma.$queryRaw<Array<{ token: string }>>`
      SELECT "token"
      FROM "PushDeviceRegistration"
      WHERE "user_id" = ${userId}
        AND "platform" = ${platform}
        AND "revoked_at" IS NULL
      ORDER BY "last_seen_at" DESC
      LIMIT 25
    `
    const unique = new Set<string>()
    for (const row of rows) {
      const token = normalizePushToken(row.token)
      if (token) unique.add(token)
    }
    return [...unique]
  } catch (err) {
    console.error('failed to load push tokens', err)
    return []
  }
}

type NativePushPlatform = 'ios' | 'android'

async function loadActiveNativePushTargets(userId: string): Promise<Array<{ platform: NativePushPlatform; token: string }>> {
  const [iosTokens, androidTokens] = await Promise.all([
    loadActivePushTokens(userId, 'ios'),
    loadActivePushTokens(userId, 'android'),
  ])

  return [
    ...iosTokens.map((token) => ({ platform: 'ios' as const, token })),
    ...androidTokens.map((token) => ({ platform: 'android' as const, token })),
  ]
}

async function revokePushToken(token: string, platform: string): Promise<void> {
  try {
    await ensurePushDeviceRegistryTable()
    await prisma.$executeRaw`
      UPDATE "PushDeviceRegistration"
      SET
        "revoked_at" = NOW(),
        "updated_at" = NOW()
      WHERE "token" = ${token}
        AND "platform" = ${platform}
        AND "revoked_at" IS NULL
    `
  } catch {
    // ignore
  }
}

function parseApnsReason(payloadText: string): string {
  try {
    const parsed = JSON.parse(payloadText || '{}')
    return typeof parsed?.reason === 'string' ? parsed.reason : ''
  } catch {
    return ''
  }
}

function parseFcmErrorCode(payloadText: string): string {
  try {
    const parsed = JSON.parse(payloadText || '{}')
    const details = Array.isArray(parsed?.error?.details) ? (parsed.error.details as unknown[]) : []
    const typed = details.find(
      (item: unknown) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).errorCode === 'string',
    ) as Record<string, unknown> | undefined
    if (typed && typeof typed.errorCode === 'string') return typed.errorCode
    return typeof parsed?.error?.status === 'string' ? parsed.error.status : ''
  } catch {
    return ''
  }
}

async function deliverNativePushToToken(args: {
  platform: NativePushPlatform
  deviceToken: string
  title: string
  message: string
  badge?: number
  sound?: string
  channelId?: string
  data?: Record<string, unknown>
}) {
  const response = await fetch(`${PUSH_DELIVERY_URL}/send-test`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(PUSH_ADMIN_SECRET ? { 'x-admin-secret': PUSH_ADMIN_SECRET } : {}),
    },
    body: JSON.stringify({
      platform: args.platform,
      deviceToken: args.deviceToken,
      title: args.title,
      message: args.message,
      badge: args.badge,
      sound: args.sound,
      channelId: args.channelId,
      data: args.data,
    }),
  })

  const raw = await response.text().catch(() => '')
  if (!response.ok) {
    console.error('push_delivery_failed', {
      platform: args.platform,
      status: response.status,
      deviceTokenSuffix: args.deviceToken.slice(-8),
      payload: raw,
    })
    return
  }

  try {
    const parsed = JSON.parse(raw || '{}')
    const deliveryStatus = Number(parsed?.result?.status || 0)
    const deliveryText = typeof parsed?.result?.text === 'string' ? parsed.result.text : ''
    if (deliveryStatus >= 200 && deliveryStatus < 300) return

    const reason = args.platform === 'ios' ? parseApnsReason(deliveryText) : parseFcmErrorCode(deliveryText)
    console.error('push_delivery_failed', {
      platform: args.platform,
      status: response.status,
      deliveryStatus,
      reason,
      deviceTokenSuffix: args.deviceToken.slice(-8),
    })

    if (
      (args.platform === 'ios' && (reason === 'BadDeviceToken' || reason === 'Unregistered')) ||
      (args.platform === 'android' && (reason === 'UNREGISTERED' || reason === 'INVALID_ARGUMENT' || reason === 'NOT_FOUND'))
    ) {
      void revokePushToken(args.deviceToken, args.platform)
    }
  } catch {
    // ignore
  }
}

function mapNotificationPushType(type: string): PushPayloadType {
  const normalized = type.trim().toLowerCase()
  if (
    normalized.startsWith('message') ||
    normalized === COMMENT_NOTIFICATION_TYPES.REPLY ||
    normalized === COMMENT_NOTIFICATION_TYPES.POST_COMMENT
  ) {
    return 'message'
  }
  if (normalized.includes('market')) return 'marketplace'
  if (normalized.startsWith('org_') || normalized.startsWith('event_')) return 'org'
  return 'system'
}

async function loadUnreadMessageCount(userId: string): Promise<number> {
  try {
    const [user, result] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } }),
      prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int as count
      FROM "Message" m
      JOIN "MessageParticipant" mp ON m."threadId" = mp."threadId"
      WHERE mp."userId" = ${userId}
      AND m."senderId" != ${userId}
      AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
    `,
    ])
    const familyCount = getStoredFamilyParentConversations(user?.communityMeta)
      .reduce((total, conversation) => total + conversation.messages.filter((message) => {
        if (message.sender !== 'child') return false
        if (!conversation.parentLastReadAt) return true
        return message.createdAt > conversation.parentLastReadAt
      }).length, 0)
    const count = Number(result[0]?.count || 0) + familyCount
    return Number.isFinite(count) && count > 0 ? count : 0
  } catch {
    return 0
  }
}

function buildPushAlert(record: NotificationRecord, actor: ReturnType<typeof formatFriendUser> | null): { title: string; message: string } | null {
  const actorLabel = actor?.name || actor?.handle || 'Someone'
  if (record.type === FRIEND_NOTIFICATION_TYPES.REQUEST) {
    return {
      title: 'New friend request',
      message: `${actorLabel} sent you a friend request.`,
    }
  }
  if (record.type === FRIEND_NOTIFICATION_TYPES.ACCEPT) {
    return {
      title: 'Friend request accepted',
      message: `${actorLabel} accepted your friend request.`,
    }
  }
  if (record.type === COMMENT_NOTIFICATION_TYPES.REPLY) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const preview = typeof payload?.bodyPreview === 'string' ? payload.bodyPreview.trim() : ''
    return {
      title: 'New reply',
      message: preview ? `${actorLabel} replied: ${preview}` : `${actorLabel} replied to your comment.`,
    }
  }
  if (record.type === COMMENT_NOTIFICATION_TYPES.POST_COMMENT) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const preview = typeof payload?.bodyPreview === 'string' ? payload.bodyPreview.trim() : ''
    return {
      title: 'New comment',
      message: preview ? `${actorLabel} commented: ${preview}` : `${actorLabel} commented on your post.`,
    }
  }
  if (record.type === CONNECTION_NOTIFICATION_TYPES.REQUEST) {
    return {
      title: 'New connection request',
      message: `${actorLabel} sent you a connection request.`,
    }
  }
  if (record.type === CONNECTION_NOTIFICATION_TYPES.ACCEPT) {
    return {
      title: 'Connection request accepted',
      message: `${actorLabel} accepted your connection request.`,
    }
  }
  if (record.type === EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
    return {
      title: 'Guest speaker invite',
      message: eventTitle ? `${actorLabel} invited you to speak at "${eventTitle}".` : `${actorLabel} invited you to be a guest speaker.`,
    }
  }
  if (record.type === EVENT_NOTIFICATION_TYPES.SPONSOR_INVITE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
    return {
      title: 'Sponsor invite',
      message: eventTitle ? `${actorLabel} invited your organization to sponsor "${eventTitle}".` : `${actorLabel} invited your organization to sponsor an event.`,
    }
  }
  if (record.type === EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_RESPONSE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
    const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
    const verb = status === 'accepted' ? 'accepted' : status === 'declined' ? 'declined' : 'responded to'
    return {
      title: 'Guest speaker response',
      message: eventTitle ? `${actorLabel} ${verb} your invite for "${eventTitle}".` : `${actorLabel} ${verb} your guest speaker invite.`,
    }
  }
  if (record.type === EVENT_NOTIFICATION_TYPES.SPONSOR_RESPONSE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const eventTitle = typeof payload?.eventTitle === 'string' ? payload.eventTitle.trim() : ''
    const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
    const verb = status === 'accepted' ? 'accepted' : status === 'declined' ? 'declined' : 'responded to'
    return {
      title: 'Sponsor response',
      message: eventTitle ? `${actorLabel} ${verb} your sponsor invite for "${eventTitle}".` : `${actorLabel} ${verb} your sponsor invite.`,
    }
  }
  if (record.type === ORG_NOTIFICATION_TYPES.USER_INVITE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const organizationName = typeof payload?.organizationName === 'string' ? payload.organizationName.trim() : 'an organization'
    return {
      title: 'Organization invite',
      message: `${actorLabel} invited you to join ${organizationName}.`,
    }
  }
  if (record.type === PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const relationshipLabel = typeof payload?.relationshipLabel === 'string' ? payload.relationshipLabel.trim() : 'Family'
    return {
      title: 'Family request',
      message: `${actorLabel} wants to add you as ${relationshipLabel}.`,
    }
  }
  if (record.type === PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY_RESPONSE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const relationshipLabel = typeof payload?.relationshipLabel === 'string' ? payload.relationshipLabel.trim() : 'family'
    const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : ''
    const verb = status === 'accepted' ? 'accepted' : status === 'rejected' ? 'declined' : 'responded to'
    return {
      title: 'Family request response',
      message: `${actorLabel} ${verb} your ${relationshipLabel} request.`,
    }
  }
  if (record.type === POLL_NOTIFICATION_TYPES.RESULTS_AVAILABLE) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const questionPreview = typeof payload?.questionPreview === 'string' ? payload.questionPreview.trim() : ''
    return {
      title: 'Poll results available',
      message: questionPreview ? `${actorLabel}'s poll is ready: ${questionPreview}` : `${actorLabel}'s poll results are now available.`,
    }
  }
  if (record.type === FAMILY_NOTIFICATION_TYPES.MEDIA_CHANGED) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const childDisplayName = typeof payload?.childDisplayName === 'string' ? payload.childDisplayName.trim() : 'Your child'
    const categoryLabel = payload?.category === 'cover' ? 'cover photo' : 'profile photo'
    return {
      title: 'Child photo updated',
      message: `${childDisplayName} changed their ${categoryLabel}.`,
    }
  }
  if (record.type === FAMILY_NOTIFICATION_TYPES.USERNAME_CHANGED) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const childDisplayName = typeof payload?.childDisplayName === 'string' ? payload.childDisplayName.trim() : 'Your child'
    const username = typeof payload?.username === 'string' ? payload.username.trim() : ''
    return {
      title: 'Child username updated',
      message: username ? `${childDisplayName} changed their username to ${username}.` : `${childDisplayName} changed their username.`,
    }
  }
  if (record.type === FAMILY_NOTIFICATION_TYPES.FRIEND_REQUEST) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const requesterChild = payload?.requesterChild && typeof payload.requesterChild === 'object' && !Array.isArray(payload.requesterChild)
      ? (payload.requesterChild as Record<string, unknown>)
      : null
    const childDisplayName = typeof requesterChild?.displayName === 'string' ? requesterChild.displayName.trim() : 'A child'
    return {
      title: 'Family friend request',
      message: `${childDisplayName} wants to connect with your child.`,
    }
  }
  if (record.type === FAMILY_NOTIFICATION_TYPES.FRIEND_REMOVED) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const childDisplayName = typeof payload?.childDisplayName === 'string' ? payload.childDisplayName.trim() : 'Your child'
    const targetHandle = typeof payload?.targetHandle === 'string' ? payload.targetHandle.trim() : ''
    const targetName = typeof payload?.targetName === 'string' ? payload.targetName.trim() : ''
    const targetLabel = targetHandle ? `@${targetHandle}` : targetName || 'a friend'
    return {
      title: 'Family friend removed',
      message: `${childDisplayName} removed ${targetLabel} from Family friends.`,
    }
  }
  if (record.type === FAMILY_NOTIFICATION_TYPES.USER_BLOCKED) {
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : null
    const childDisplayName = typeof payload?.childDisplayName === 'string' ? payload.childDisplayName.trim() : 'Your child'
    const targetHandle = typeof payload?.targetHandle === 'string' ? payload.targetHandle.trim() : ''
    const targetName = typeof payload?.targetName === 'string' ? payload.targetName.trim() : ''
    const targetLabel = targetHandle ? `@${targetHandle}` : targetName || 'a user'
    return {
      title: 'Family user blocked',
      message: `${childDisplayName} blocked ${targetLabel}.`,
    }
  }
  return {
    title: 'Civil Citizens',
    message: `${actorLabel} sent you a notification.`,
  }
}

function getNotificationDeepLink(record: NotificationRecord): string | null {
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : null

  const candidates = record.type === COMMENT_NOTIFICATION_TYPES.REPLY
    ? [payload?.replyUrl, payload?.url, payload?.sourceUrl]
    : [payload?.url, payload?.sourceUrl, payload?.replyUrl]

  if (record.type === POLL_NOTIFICATION_TYPES.RESULTS_AVAILABLE) {
    const pollUrl = typeof payload?.url === 'string' ? payload.url.trim() : ''
    if (pollUrl.startsWith('/')) {
      return pollUrl
    }
  }

  for (const raw of candidates) {
    const url = typeof raw === 'string' ? raw.trim() : ''
    if (url.startsWith('/')) {
      return url
    }
  }
  return null
}

function buildWebPushPayloadForNotification(
  record: NotificationRecord,
  actor: ReturnType<typeof formatFriendUser> | null,
): {
  title: string
  body: string
  url: string
  type: PushPayloadType
  entityId: string
} | null {
  const alert = buildPushAlert(record, actor)
  if (!alert) return null

  return {
    title: alert.title,
    body: alert.message,
    url: getNotificationDeepLink(record) ?? '/notifications',
    type: mapNotificationPushType(record.type),
    entityId: record.id,
  }
}

async function sendMobilePushNotification(record: NotificationRecord, actor: ReturnType<typeof formatFriendUser> | null) {
  if (!PUSH_DELIVERY_URL) return

  const alert = buildPushAlert(record, actor)
  if (!alert) return

  const targets = await loadActiveNativePushTargets(record.userId)
  if (!targets.length) return

  await Promise.allSettled(
    targets.map(({ platform, token }) =>
      deliverNativePushToToken({
        platform,
        deviceToken: token,
        title: alert.title,
        message: alert.message,
        sound: 'civil-general.caf',
        data: {
          kind: 'notification',
          url: getNotificationDeepLink(record) ?? '/notifications',
        },
      }),
    ),
  )
}

function truncatePushBody(value: string, maxLen = 140): string {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''
  if (trimmed.length <= maxLen) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`
}

function formatDisplayNameForPush(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ')
}

function isThreadMuted(mutedUntil: Date | null | undefined): boolean {
  if (!mutedUntil) return false
  return new Date(mutedUntil).getTime() > Date.now()
}

const IOS_CALL_NOTIFICATION_SOUND = 'ringtone.caf'
const ANDROID_CALL_NOTIFICATION_SOUND = 'ringtone'
const ANDROID_CALL_NOTIFICATION_CHANNEL_ID = 'incoming_calls'

async function sendNativePushForIncomingCall(args: {
  recipientUserId: string
  title: string
  message: string
  url: string
  callId: string
  mode: 'audio' | 'video'
  threadId?: string
  memberId?: string
}) {
  if (!PUSH_DELIVERY_URL) return

  const deviceTargets = await loadActiveNativePushTargets(args.recipientUserId)
  if (!deviceTargets.length) return

  await Promise.allSettled(
    deviceTargets.map(({ platform, token }) =>
      deliverNativePushToToken({
        platform,
        deviceToken: token,
        title: args.title,
        message: args.message,
        sound: platform === 'android' ? ANDROID_CALL_NOTIFICATION_SOUND : IOS_CALL_NOTIFICATION_SOUND,
        ...(platform === 'android' ? { channelId: ANDROID_CALL_NOTIFICATION_CHANNEL_ID } : {}),
        data: {
          kind: 'call',
          callId: args.callId,
          mode: args.mode,
          url: args.url,
          ...(args.threadId ? { threadId: args.threadId } : {}),
          ...(args.memberId ? { memberId: args.memberId } : {}),
        },
      }),
    ),
  )
}

async function sendMobilePushForMessageCreated(args: {
  threadId: string
  message: MessageRecord
  participants: Array<{ userId: string; mutedUntil?: Date | null }>
  pushUrl?: string
}) {
  const rawSenderLabel = args.message.sender?.name || args.message.sender?.handle || 'Someone'
  const senderLabel = formatDisplayNameForPush(rawSenderLabel) || rawSenderLabel
  const attachmentCount = normalizeAttachmentList(args.message.attachments).length
  const rawPreview = (args.message.body || '').trim()
  const preview = rawPreview
    ? rawPreview
    : attachmentCount > 0
      ? 'Sent an attachment.'
      : 'Sent you a message.'

  const title = senderLabel
  const body = truncatePushBody(preview)
  if (!body) return
  const pushUrl = args.pushUrl?.trim() || `/messages?thread=${encodeURIComponent(args.threadId)}`

  const targets = args.participants
    .filter((p) => p.userId !== args.message.senderId)
    .filter((p) => !isThreadMuted(p.mutedUntil ?? null))

  await Promise.allSettled(
    targets.map((participant) =>
      sendPushToUser(participant.userId, {
        title,
        body,
        url: pushUrl,
        type: 'message',
        entityId: args.threadId,
      }),
    ),
  )

  if (!PUSH_DELIVERY_URL) return

  await Promise.allSettled(
    targets.map(async (participant) => {
      const deviceTargets = await loadActiveNativePushTargets(participant.userId)
      if (!deviceTargets.length) return

      const badge = await loadUnreadMessageCount(participant.userId)

      await Promise.allSettled(
        deviceTargets.map(({ platform, token }) =>
          deliverNativePushToToken({
            platform,
            deviceToken: token,
            title,
            message: body,
            badge,
            sound: 'civil-message.caf',
            data: {
              kind: 'message',
              threadId: args.threadId,
              url: pushUrl,
            },
          }),
        ),
      )
    }),
  )
}

async function dispatchNotification(
  record: NotificationRecord,
  options?: {
    suppressMobilePush?: boolean
  },
) {
  let actor: ReturnType<typeof formatFriendUser> | null = null
  if (record.actorId) {
    const actorRecord = await prisma.user.findUnique({ where: { id: record.actorId }, select: FRIEND_USER_SELECT })
    if (actorRecord) {
      actor = formatFriendUser(actorRecord)
    }
  }
  await dispatchRealtimeEvent(record.userId, {
    type: 'notification',
    data: {
      ...formatNotification(record),
      actor,
    },
  })
  if (!options?.suppressMobilePush) {
    void sendMobilePushNotification(record, actor)
    const payload = buildWebPushPayloadForNotification(record, actor)
    if (payload) {
      void sendPushToUser(record.userId, payload)
    }
  }
}

async function createNotificationRecord(data: {
  userId: string
  actorId: string | null
  type: string
  postId?: string | null
  payload?: Prisma.InputJsonValue
  suppressMobilePush?: boolean
}) {
  const notification = await prisma.notification.create({
    data: {
      userId: data.userId,
      actorId: data.actorId,
      type: data.type,
      postId: data.postId ?? null,
      payload: data.payload ?? undefined,
    },
    select: NOTIFICATION_SELECT,
  })
  await dispatchNotification(notification, { suppressMobilePush: Boolean(data.suppressMobilePush) })
  return notification
}

let pollResultNotificationSweepPromise: Promise<void> | null = null

async function dispatchDuePollResultNotifications() {
  if (pollResultNotificationSweepPromise) return pollResultNotificationSweepPromise

  pollResultNotificationSweepPromise = (async () => {
    try {
      const now = new Date()
      const duePolls = await prisma.poll.findMany({
        where: {
          resultsVisibility: {
            in: [
              PrismaPollResultsVisibility.AFTER_6_HOURS,
              PrismaPollResultsVisibility.AFTER_12_HOURS,
              PrismaPollResultsVisibility.AFTER_24_HOURS,
              PrismaPollResultsVisibility.AFTER_48_HOURS,
            ],
          },
          resultsAvailableAt: { lte: now },
          votes: {
            some: {
              resultNotificationSentAt: null,
            },
          },
        },
        select: {
          id: true,
          postId: true,
          resultsAvailableAt: true,
          post: {
            select: {
              id: true,
              authorId: true,
              seoSlug: true,
              provinceCode: true,
              communitySlug: true,
              body: true,
              author: {
                select: {
                  handle: true,
                },
              },
            },
          },
        },
      })

      for (const poll of duePolls) {
        const resultsAvailableAt = poll.resultsAvailableAt
        if (!resultsAvailableAt) continue

        const slug = poll.post.seoSlug ?? poll.post.id
        const url = poll.post.provinceCode && poll.post.communitySlug
          ? `/${poll.post.provinceCode.toLowerCase()}/${poll.post.communitySlug.toLowerCase()}/posts/${slug}`
          : `/u/${poll.post.author.handle}/posts/${slug}`
        const questionPreview = truncatePushBody(sanitizePlainText(poll.post.body), 90)

        const candidateVotes = await prisma.pollVote.findMany({
          where: {
            pollId: poll.id,
            resultNotificationSentAt: null,
            createdAt: {
              lte: resultsAvailableAt,
            },
          },
          select: {
            userId: true,
          },
        })

        for (const vote of candidateVotes) {
          const marked = await prisma.pollVote.updateMany({
            where: {
              pollId: poll.id,
              userId: vote.userId,
              resultNotificationSentAt: null,
            },
            data: {
              resultNotificationSentAt: now,
            },
          })

          if (!marked.count) continue

          await createNotificationRecord({
            userId: vote.userId,
            actorId: poll.post.authorId,
            type: POLL_NOTIFICATION_TYPES.RESULTS_AVAILABLE,
            postId: poll.postId,
            payload: {
              pollId: poll.id,
              questionPreview,
              resultsAvailableAt: resultsAvailableAt.toISOString(),
              url,
            },
          })
        }
      }
    } catch (err) {
      app.log.error({ err }, 'poll_result_notification_sweep_failed')
    } finally {
      pollResultNotificationSweepPromise = null
    }
  })()

  return pollResultNotificationSweepPromise
}

async function resolveStreamUserId(req: FastifyRequest): Promise<string | null> {
  if (!(req as any).user?.id) {
    try {
      await req.jwtVerify()
    } catch {
      // Authorization header missing or invalid; fall back to token param.
    }
  }
  const headerUserId = (req as any).user?.id
  if (headerUserId) return headerUserId
  const query = (req.query ?? {}) as { token?: string }
  const tokenParam = typeof query.token === 'string' && query.token.trim().length > 0 ? query.token.trim() : undefined
  if (!tokenParam) return null
  try {
    const payload = await app.jwt.verify<AuthJwtPayload>(tokenParam)
    if (payload?.actor === 'family_member' && typeof payload.sub === 'string' && typeof payload.parentId === 'string') {
      const member = await loadFamilyMemberAuthViewerById(payload.sub, payload.parentId)
      return member?.parentId ?? null
    }
    if (payload && typeof payload.sub === 'string' && payload.sub) {
      const user = await loadActiveAuthUserById(payload.sub)
      return user?.id ?? null
    }
  } catch (err) {
    app.log.warn({ err }, 'notifications_stream_token_invalid')
  }
  return null
}

const FRIEND_NOTIFICATION_TYPES = {
  REQUEST: 'friend_request',
  ACCEPT: 'friend_accept',
} as const

const CONNECTION_NOTIFICATION_TYPES = {
  REQUEST: 'connection_request',
  ACCEPT: 'connection_accept',
} as const

const COMMENT_NOTIFICATION_TYPES = {
  REPLY: 'comment_reply',
  POST_COMMENT: 'comment_post',
} as const

// Chat/message delivery is represented by unread counters + push, not bell notifications.
const NOTIFICATION_FEED_EXCLUDED_TYPES = [
  'message_created',
  'message',
  'message.created',
] as const

const EVENT_NOTIFICATION_TYPES = {
  GUEST_SPEAKER_INVITE: 'event_guest_speaker_invite',
  SPONSOR_INVITE: 'event_sponsor_invite',
  GUEST_SPEAKER_RESPONSE: 'event_guest_speaker_response',
  SPONSOR_RESPONSE: 'event_sponsor_response',
} as const

const ORG_NOTIFICATION_TYPES = {
  USER_INVITE: 'org_user_invite',
} as const

const PROFILE_INVITE_NOTIFICATION_TYPES = {
  EVENT: 'profile_event_invite',
  ORGANIZATION: 'profile_organization_invite',
  FAMILY: 'profile_family_invite',
  FAMILY_RESPONSE: 'profile_family_invite_response',
} as const

const PROFILE_FAMILY_RELATIONSHIP_LABELS = {
  mother: 'Mother',
  father: 'Father',
  grandmother: 'Grandmother',
  grandfather: 'Grandfather',
  sister: 'Sister',
  brother: 'Brother',
  aunt: 'Aunt',
  uncle: 'Uncle',
  cousin: 'Cousin',
  second_cousin: 'Second Cousin',
  niece: 'Niece',
  nephew: 'Nephew',
  wife: 'Wife',
  husband: 'Husband',
  significant_other: 'Significant Other',
  partner: 'Partner',
  mother_in_law: 'Mother-in-law',
  father_in_law: 'Father-in-law',
  sister_in_law: 'Sister-in-law',
  brother_in_law: 'Brother-in-law',
  daughter_in_law: 'Daughter-in-law',
  son_in_law: 'Son-in-law',
  other: 'Other',
} as const

const POLL_NOTIFICATION_TYPES = {
  RESULTS_AVAILABLE: 'poll_results_available',
} as const

const FAMILY_NOTIFICATION_TYPES = {
  MEDIA_CHANGED: 'family_child_media_change',
  USERNAME_CHANGED: 'family_child_username_change',
  FRIEND_REQUEST: 'family_child_friend_request',
  FRIEND_REMOVED: 'family_child_friend_removed',
  USER_BLOCKED: 'family_child_blocked_user',
} as const

async function notifyFriendRequest(friendshipId: string, requesterId: string, addresseeId: string) {
  await createNotificationRecord({
    userId: addresseeId,
    actorId: requesterId,
    type: FRIEND_NOTIFICATION_TYPES.REQUEST,
    payload: { friendshipId, status: 'pending' },
  })
}

async function notifyFriendAcceptance(friendshipId: string, requesterId: string, addresseeId: string) {
  await createNotificationRecord({
    userId: requesterId,
    actorId: addresseeId,
    type: FRIEND_NOTIFICATION_TYPES.ACCEPT,
    payload: { friendshipId },
  })
}

async function notifyConnectionRequest(connectionId: string, requesterId: string, addresseeId: string) {
  await createNotificationRecord({
    userId: addresseeId,
    actorId: requesterId,
    type: CONNECTION_NOTIFICATION_TYPES.REQUEST,
    payload: {
      connectionId,
      status: 'pending',
      url: '/network/professionals',
    },
  })
}

async function notifyConnectionAcceptance(connectionId: string, requesterId: string, addresseeId: string) {
  await createNotificationRecord({
    userId: requesterId,
    actorId: addresseeId,
    type: CONNECTION_NOTIFICATION_TYPES.ACCEPT,
    payload: {
      connectionId,
      status: 'accepted',
      url: '/network/professionals',
    },
  })
}

async function notifyProfileEventInvite(args: {
  inviteeUserId: string
  actorUserId: string
  eventId: string
  eventTitle: string
  hostOrganizationId: string
  hostOrganizationName: string
  hostProvinceCode: string
  hostCommunitySlug: string
  hostOrganizationSlug: string
}) {
  const eventUrl = `/com/${encodeURIComponent(args.hostProvinceCode)}/${encodeURIComponent(args.hostCommunitySlug)}/orgs/${encodeURIComponent(args.hostOrganizationSlug)}/events/${encodeURIComponent(args.eventId)}`
  await createNotificationRecord({
    userId: args.inviteeUserId,
    actorId: args.actorUserId,
    type: PROFILE_INVITE_NOTIFICATION_TYPES.EVENT,
    payload: {
      eventId: args.eventId,
      title: args.eventTitle,
      organizationId: args.hostOrganizationId,
      organizationName: args.hostOrganizationName,
      url: eventUrl,
    },
  })
}

async function notifyProfileOrganizationInvite(args: {
  inviteeUserId: string
  actorUserId: string
  organizationId: string
  organizationName: string
  provinceCode: string
  communitySlug: string
  organizationSlug: string
}) {
  const organizationUrl = `/com/${encodeURIComponent(args.provinceCode)}/${encodeURIComponent(args.communitySlug)}/orgs/${encodeURIComponent(args.organizationSlug)}`
  await createNotificationRecord({
    userId: args.inviteeUserId,
    actorId: args.actorUserId,
    type: PROFILE_INVITE_NOTIFICATION_TYPES.ORGANIZATION,
    payload: {
      organizationId: args.organizationId,
      title: args.organizationName,
      url: organizationUrl,
    },
  })
}

async function notifyProfileFamilyInvite(args: {
  inviteeUserId: string
  actorUserId: string
  actorHandle: string
  relationship: ProfileFamilyRelationship
}) {
  const relationshipLabel = PROFILE_FAMILY_RELATIONSHIP_LABELS[args.relationship]
  const profileUrl = `/u/${encodeURIComponent(args.actorHandle)}`
  const requestedAt = new Date().toISOString()
  await createNotificationRecord({
    userId: args.inviteeUserId,
    actorId: args.actorUserId,
    type: PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY,
    payload: {
      relationship: args.relationship,
      relationshipLabel,
      status: 'pending',
      requestedAt,
      url: profileUrl,
      sourceUrl: profileUrl,
    },
  })
}

async function notifyProfileFamilyInviteResponse(args: {
  inviteeUserId: string
  actorUserId: string
  actorHandle: string
  relationship: ProfileFamilyRelationship
  status: 'accepted' | 'rejected'
}) {
  const relationshipLabel = PROFILE_FAMILY_RELATIONSHIP_LABELS[args.relationship]
  const profileUrl = `/u/${encodeURIComponent(args.actorHandle)}`
  await createNotificationRecord({
    userId: args.inviteeUserId,
    actorId: args.actorUserId,
    type: PROFILE_INVITE_NOTIFICATION_TYPES.FAMILY_RESPONSE,
    payload: {
      relationship: args.relationship,
      relationshipLabel,
      status: args.status,
      respondedAt: new Date().toISOString(),
      url: profileUrl,
      sourceUrl: profileUrl,
    },
  })
}

async function notifyEventGuestSpeakerInvite(args: {
  inviteeUserId: string
  actorUserId: string
  hostOrganizationId: string
  hostProvinceCode: string
  hostCommunitySlug: string
  hostOrganizationSlug: string
  eventId: string
  eventTitle: string
}) {
  const eventUrl = `/com/${encodeURIComponent(args.hostProvinceCode)}/${encodeURIComponent(args.hostCommunitySlug)}/orgs/${encodeURIComponent(args.hostOrganizationSlug)}/events/${encodeURIComponent(args.eventId)}`
  await createNotificationRecord({
    userId: args.inviteeUserId,
    actorId: args.actorUserId,
    type: EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE,
    payload: {
      status: 'pending',
      invitationKind: 'guest_speaker',
      hostOrganizationId: args.hostOrganizationId,
      eventId: args.eventId,
      eventTitle: args.eventTitle,
      url: eventUrl,
    },
  })
}

async function notifyEventSponsorInvite(args: {
  inviteeUserId: string
  actorUserId: string
  hostOrganizationId: string
  hostProvinceCode: string
  hostCommunitySlug: string
  hostOrganizationSlug: string
  targetOrganizationId: string
  eventId: string
  eventTitle: string
}) {
  const eventUrl = `/com/${encodeURIComponent(args.hostProvinceCode)}/${encodeURIComponent(args.hostCommunitySlug)}/orgs/${encodeURIComponent(args.hostOrganizationSlug)}/events/${encodeURIComponent(args.eventId)}`
  await createNotificationRecord({
    userId: args.inviteeUserId,
    actorId: args.actorUserId,
    type: EVENT_NOTIFICATION_TYPES.SPONSOR_INVITE,
    payload: {
      status: 'pending',
      invitationKind: 'sponsor',
      hostOrganizationId: args.hostOrganizationId,
      targetOrganizationId: args.targetOrganizationId,
      eventId: args.eventId,
      eventTitle: args.eventTitle,
      url: eventUrl,
    },
  })
}

async function loadAcceptedFriendIds(userId: string): Promise<string[]> {
  const rows: Pick<Prisma.FriendshipGetPayload<{ select: { requesterId: true; addresseeId: true } }>, 'requesterId' | 'addresseeId'>[] =
    await prisma.friendship.findMany({
    where: {
      status: FriendshipStatus.ACCEPTED,
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
  })
  const result = new Set<string>()
  for (const row of rows) {
    result.add(row.requesterId === userId ? row.addresseeId : row.requesterId)
  }
  return [...result]
}

type ConnectionStatusValue = 'PENDING' | 'ACCEPTED' | 'REJECTED'

type ConnectionRow = {
  id: string
  requesterId: string
  addresseeId: string
  status: ConnectionStatusValue
  requestedAt: Date
  respondedAt: Date | null
}

function isConnectionTableMissingError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2021' || err.code === 'P2010') return true
  }
  const message = typeof (err as any)?.message === 'string' ? (err as any).message : ''
  return /"Connection"|ConnectionStatus|relation .*Connection.* does not exist/i.test(message)
}

async function findConnectionBetween(userId: string, targetUserId: string): Promise<ConnectionRow | null> {
  try {
    const rows = await prisma.$queryRaw<ConnectionRow[]>`
      SELECT "id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt"
      FROM "Connection"
      WHERE ("requesterId" = ${userId} AND "addresseeId" = ${targetUserId})
         OR ("requesterId" = ${targetUserId} AND "addresseeId" = ${userId})
      LIMIT 1
    `
    return rows[0] ?? null
  } catch (error) {
    if (isConnectionTableMissingError(error)) return null
    throw error
  }
}

async function findConnectionById(id: string): Promise<ConnectionRow | null> {
  try {
    const rows = await prisma.$queryRaw<ConnectionRow[]>`
      SELECT "id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt"
      FROM "Connection"
      WHERE "id" = ${id}
      LIMIT 1
    `
    return rows[0] ?? null
  } catch (error) {
    if (isConnectionTableMissingError(error)) return null
    throw error
  }
}

async function createOrRefreshConnectionRequest(requesterId: string, addresseeId: string): Promise<void> {
  if (!requesterId || !addresseeId || requesterId === addresseeId) return

  try {
    const existing = await findConnectionBetween(requesterId, addresseeId)
    if (existing) {
      if (existing.status === 'ACCEPTED' || existing.status === 'PENDING') {
        return
      }

      const now = new Date()
      await prisma.$executeRaw`
        UPDATE "Connection"
        SET "requesterId" = ${requesterId},
            "addresseeId" = ${addresseeId},
            "status" = 'PENDING',
            "requestedAt" = ${now},
            "respondedAt" = NULL
        WHERE "id" = ${existing.id}
      `

      await notifyConnectionRequest(existing.id, requesterId, addresseeId)
      return
    }

    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const now = new Date()
    await prisma.$executeRaw`
      INSERT INTO "Connection" ("id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt")
      VALUES (${id}, ${requesterId}, ${addresseeId}, 'PENDING', ${now}, NULL)
    `

    await notifyConnectionRequest(id, requesterId, addresseeId)
  } catch (error) {
    if (isConnectionTableMissingError(error)) return
    throw error
  }
}

async function loadAcceptedConnectionIds(userId: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<Array<{ requesterId: string; addresseeId: string }>>`
      SELECT "requesterId", "addresseeId"
      FROM "Connection"
      WHERE "status" = 'ACCEPTED'
        AND ("requesterId" = ${userId} OR "addresseeId" = ${userId})
    `
    const ids = new Set<string>()
    for (const row of rows) {
      ids.add(row.requesterId === userId ? row.addresseeId : row.requesterId)
    }
    return [...ids]
  } catch (error) {
    if (isConnectionTableMissingError(error)) return []
    throw error
  }
}

function formatFriendRequest(friendship: FriendshipWithUsers, viewerId: string) {
  const direction = friendship.requesterId === viewerId ? 'outgoing' : 'incoming'
  const counterpart = direction === 'outgoing' ? friendship.addressee : friendship.requester
  return {
    id: friendship.id,
    status: friendship.status,
    direction,
    requestedAt: friendship.requestedAt,
    respondedAt: friendship.respondedAt ?? null,
    user: formatFriendUser(counterpart),
  }
}

function formatFriendship(friendship: FriendshipWithUsers, viewerId: string) {
  const counterpart = friendship.requesterId === viewerId ? friendship.addressee : friendship.requester
  return {
    id: friendship.id,
    status: friendship.status,
    since: friendship.respondedAt ?? friendship.requestedAt,
    user: formatFriendUser(counterpart),
  }
}

const FAMILY_SPONSOR_FRIENDSHIP_PREFIX = 'family-sponsor:'

function buildFamilySponsorFriendshipId(memberId: string) {
  return `${FAMILY_SPONSOR_FRIENDSHIP_PREFIX}${memberId}`
}

function formatFamilySponsorFriendship(member: FamilyAuthMember) {
  return {
    id: buildFamilySponsorFriendshipId(member.id),
    status: FriendshipStatus.ACCEPTED,
    since: member.createdAt,
    locked: true,
    specialKind: 'family_sponsor' as const,
    user: formatFriendUser(member.parent),
  }
}

const MESSAGE_SELECT = {
  id: true,
  threadId: true,
  senderId: true,
  body: true,
  attachments: true,
  messageType: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  sender: { select: FRIEND_USER_SELECT },
} satisfies Prisma.MessageSelect

const MESSAGE_CALL_SELECT = {
  id: true,
  threadId: true,
  initiatorId: true,
  endedByUserId: true,
  roomId: true,
  mode: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  lastJoinedAt: true,
  endedAt: true,
  initiator: { select: FRIEND_USER_SELECT },
} satisfies Prisma.MessageCallSelect

const THREAD_PARTICIPANT_SELECT = {
  userId: true,
  role: true,
  joinedAt: true,
  lastReadAt: true,
  mutedUntil: true,
  lastActivityAt: true,
  user: { select: FRIEND_USER_SELECT },
} satisfies Prisma.MessageParticipantSelect

const THREAD_WITH_PARTICIPANTS_INCLUDE = {
  participants: { select: THREAD_PARTICIPANT_SELECT },
  calls: {
    select: MESSAGE_CALL_SELECT,
    where: { endedAt: null },
    orderBy: [{ createdAt: 'desc' }],
    take: 1,
  },
} satisfies Prisma.MessageThreadInclude

const THREAD_SUMMARY_INCLUDE = {
  ...THREAD_WITH_PARTICIPANTS_INCLUDE,
  messages: {
    select: MESSAGE_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.MessageThreadInclude

type MessageRecord = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>
type MessageCallRecord = Prisma.MessageCallGetPayload<{ select: typeof MESSAGE_CALL_SELECT }>
type ThreadParticipantRecord = Prisma.MessageParticipantGetPayload<{ select: typeof THREAD_PARTICIPANT_SELECT }>
type ThreadWithParticipants = Prisma.MessageThreadGetPayload<{ include: typeof THREAD_WITH_PARTICIPANTS_INCLUDE }>
type ThreadSummaryRecord = Prisma.MessageThreadGetPayload<{ include: typeof THREAD_SUMMARY_INCLUDE }>

const MESSAGE_CALL_RING_TTL_MS = 30 * 1000
const MESSAGE_CALL_IDLE_TTL_MS = 15 * 60 * 1000
const messageCallTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

type MessageCallSystemMeta = {
  kind: 'call_ended'
  reason: 'hangup' | 'no_answer'
  mode: 'audio' | 'video'
  callId: string
  callbackThreadId: string
  callbackLabel: 'Call Back'
  actorUserId: string | null
  actorName: string | null
}

function normalizeAttachmentList(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function extractMessageSystemMeta(value: Prisma.JsonValue | null | undefined): MessageCallSystemMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const typed = value as Record<string, unknown>
  if (typed.kind !== 'call_ended') return null
  const reason = typed.reason
  const mode = typed.mode
  const callId = typed.callId
  const callbackThreadId = typed.callbackThreadId
  if ((reason !== 'hangup' && reason !== 'no_answer') || (mode !== 'audio' && mode !== 'video')) return null
  if (typeof callId !== 'string' || !callId.trim()) return null
  if (typeof callbackThreadId !== 'string' || !callbackThreadId.trim()) return null
  return {
    kind: 'call_ended',
    reason,
    mode,
    callId,
    callbackThreadId,
    callbackLabel: 'Call Back',
    actorUserId: typeof typed.actorUserId === 'string' && typed.actorUserId.trim() ? typed.actorUserId : null,
    actorName: typeof typed.actorName === 'string' && typed.actorName.trim() ? typed.actorName : null,
  }
}

function formatMessage(record: MessageRecord, viewerId: string) {
  return {
    id: record.id,
    threadId: record.threadId,
    body: record.body ?? null,
    attachments: normalizeAttachmentList(record.attachments),
    systemMeta: extractMessageSystemMeta(record.attachments),
    messageType: record.messageType,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt ?? null,
    senderId: record.senderId,
    sender: formatFriendUser(record.sender),
    isMine: record.senderId === viewerId,
  }
}

function formatThreadParticipant(participant: ThreadParticipantRecord, viewerId: string) {
  return {
    userId: participant.userId,
    role: participant.role,
    joinedAt: participant.joinedAt,
    lastReadAt: participant.lastReadAt ?? null,
    mutedUntil: participant.mutedUntil ?? null,
    lastActivityAt: participant.lastActivityAt,
    user: formatFriendUser(participant.user),
    isViewer: participant.userId === viewerId,
  }
}

function formatFamilyMemberThreadUser(member: FamilyAuthMember) {
  const normalizedMember = normalizeFamilyMemberSummary(member)
  return formatNormalizedFamilyMemberThreadUser(normalizedMember)
}

function formatNormalizedFamilyMemberThreadUser(member: ReturnType<typeof normalizeFamilyMemberSummary>) {
  const username = member.username?.trim() || `family-${member.id.slice(0, 8)}`
  return {
    id: `family-member:${member.id}`,
    handle: username,
    name: member.displayName,
    avatarUrl: normalizeMediaUrl(member.avatarUrl ?? null),
    coverUrl: normalizeMediaUrl(member.coverUrl ?? null),
    isPremium: false,
    isVerified: false,
  }
}

async function loadNormalizedFamilyMembersForParent(parentId: string) {
  try {
    const members = await prisma.familyMember.findMany({
      where: { parentId },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        relationship: true,
        friendCode: true,
        username: true,
        avatarUrl: true,
        coverUrl: true,
        allowChildOwnMediaEdits: true,
        allowChildOwnUsernameEdits: true,
        allowChildAudioCalls: true,
        allowChildVideoCalls: true,
        notifyParentOnMediaChanges: true,
        suspendedAt: true,
        suspendedById: true,
        suspensionNote: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return members.map((member: typeof members[number]) => normalizeFamilyMemberSummary(member))
  } catch (error) {
    if (!isFamilyMemberTableMissing(error)) throw error

    const parent = await prisma.user.findUnique({
      where: { id: parentId },
      select: { communityMeta: true },
    })
    const members = await prisma.familyMember.findMany({
      where: { parentId },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        relationship: true,
        friendCode: true,
        suspendedAt: true,
        suspendedById: true,
        suspensionNote: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return members.map((member: typeof members[number]) =>
      normalizeFamilyMemberSummary({
        ...member,
        username: getLegacyFamilyMemberStoredUsername(parent?.communityMeta, member.id),
        ...getLegacyFamilyMemberStoredProfileMedia(parent?.communityMeta, member.id),
        ...getLegacyFamilyMemberPermissionSettings(parent?.communityMeta, member.id),
      }),
    )
  }
}

function formatParentFamilyConversationMessage(
  conversation: FamilyParentConversationRecord,
  member: ReturnType<typeof normalizeFamilyMemberSummary>,
  parent: FriendUser,
) {
  const threadId = buildParentFamilyThreadId(member.id)
  return conversation.messages.map((message) => ({
    id: message.id,
    threadId,
    body: message.body,
    attachments: [],
    systemMeta: null,
    messageType: 'text',
    createdAt: new Date(message.createdAt),
    updatedAt: new Date(message.updatedAt),
    deletedAt: null,
    senderId: message.sender === 'child' ? `family-member:${member.id}` : parent.id,
    sender: message.sender === 'child' ? formatNormalizedFamilyMemberThreadUser(member) : formatFriendUser(parent),
    isMine: message.sender === 'parent',
  }))
}

function buildParentFamilyConversationThread(args: {
  parent: FriendUser
  member: ReturnType<typeof normalizeFamilyMemberSummary>
  conversation: FamilyParentConversationRecord | null
}) {
  const createdAt = new Date(args.conversation?.createdAt ?? args.member.createdAt)
  const updatedAt = new Date(args.conversation?.updatedAt ?? args.member.updatedAt)
  const messages = args.conversation ? formatParentFamilyConversationMessage(args.conversation, args.member, args.parent) : []
  const lastMessage = messages.at(-1) ?? null
  const unreadCount = args.conversation
    ? args.conversation.messages.filter((message) => {
        if (message.sender !== 'child') return false
        if (!args.conversation?.parentLastReadAt) return true
        return message.createdAt > args.conversation.parentLastReadAt
      }).length
    : 0

  return {
    id: buildParentFamilyThreadId(args.member.id),
    type: 'direct',
    contextType: null,
    contextId: null,
    inboxSection: 'family' as const,
    createdAt,
    updatedAt,
    lastMessageAt: lastMessage?.createdAt ?? createdAt,
    lastMessage,
    unreadCount,
    unread: unreadCount > 0,
    activeCall: null,
    participants: [
      {
        userId: args.parent.id,
        role: 'member',
        joinedAt: createdAt,
        lastReadAt: args.conversation?.parentLastReadAt ? new Date(args.conversation.parentLastReadAt) : null,
        mutedUntil: null,
        lastActivityAt: updatedAt,
        user: formatFriendUser(args.parent),
        isViewer: true,
      },
      {
        userId: `family-member:${args.member.id}`,
        role: 'member',
        joinedAt: createdAt,
        lastReadAt: args.conversation?.childLastReadAt ? new Date(args.conversation.childLastReadAt) : null,
        mutedUntil: null,
        lastActivityAt: updatedAt,
        user: formatNormalizedFamilyMemberThreadUser(args.member),
        isViewer: false,
      },
    ],
  }
}

function fetchParentFamilyConversationMessages(
  member: ReturnType<typeof normalizeFamilyMemberSummary>,
  parent: FriendUser,
  conversation: FamilyParentConversationRecord | null,
  limit: number,
  cursor?: string,
) {
  const rows = conversation ? formatParentFamilyConversationMessage(conversation, member, parent) : []
  const descending = [...rows].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
  const startIndex = cursor ? descending.findIndex((message) => message.id === cursor) + 1 : 0
  const paged = descending.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit + 1)

  let nextCursor: string | undefined
  if (paged.length > limit) {
    const next = paged.pop()!
    nextCursor = next.id
  }

  return {
    rows: paged.reverse(),
    nextCursor,
  }
}

function formatFamilyParentConversationMessage(
  conversation: FamilyParentConversationRecord,
  member: FamilyAuthMember,
) {
  const threadId = buildFamilyParentThreadId(member.parentId)
  return conversation.messages.map((message) => ({
    id: message.id,
    threadId,
    body: message.body,
    attachments: [],
    systemMeta: null,
    messageType: 'text',
    createdAt: new Date(message.createdAt),
    updatedAt: new Date(message.updatedAt),
    deletedAt: null,
    senderId: message.sender === 'child' ? `family-member:${member.id}` : member.parentId,
    sender: message.sender === 'child' ? formatFamilyMemberThreadUser(member) : formatFriendUser(member.parent),
    isMine: message.sender === 'child',
  }))
}

function buildFamilyParentConversationThread(
  member: FamilyAuthMember,
  conversation: FamilyParentConversationRecord | null,
) {
  const threadId = buildFamilyParentThreadId(member.parentId)
  const createdAt = new Date(conversation?.createdAt ?? member.createdAt.toISOString())
  const updatedAt = new Date(conversation?.updatedAt ?? conversation?.createdAt ?? member.updatedAt.toISOString())
  const messages = conversation ? formatFamilyParentConversationMessage(conversation, member) : []
  const lastMessage = messages.at(-1) ?? null
  const unreadCount = conversation
    ? conversation.messages.filter((message) => {
        if (message.sender !== 'parent') return false
        if (!conversation.childLastReadAt) return true
        return message.createdAt > conversation.childLastReadAt
      }).length
    : 0

  return {
    id: threadId,
    type: 'direct',
    title: member.parent.name,
    imageUrl: normalizeMediaUrl(member.parent.avatarUrl ?? null),
    contextType: null,
    contextId: null,
    inboxSection: 'friends' as const,
    createdAt,
    updatedAt,
    lastMessageAt: lastMessage?.createdAt ?? createdAt,
    lastMessage,
    unreadCount,
    unread: unreadCount > 0,
    activeCall: null,
    participants: [
      {
        userId: `family-member:${member.id}`,
        role: 'member',
        joinedAt: createdAt,
        lastReadAt: conversation?.childLastReadAt ? new Date(conversation.childLastReadAt) : null,
        mutedUntil: null,
        lastActivityAt: updatedAt,
        user: formatFamilyMemberThreadUser(member),
        isViewer: true,
      },
      {
        userId: member.parentId,
        role: 'member',
        joinedAt: createdAt,
        lastReadAt: conversation?.parentLastReadAt ? new Date(conversation.parentLastReadAt) : null,
        mutedUntil: null,
        lastActivityAt: updatedAt,
        user: formatFriendUser(member.parent),
        isViewer: false,
      },
    ],
  }
}

function fetchFamilyParentConversationMessages(
  member: FamilyAuthMember,
  conversation: FamilyParentConversationRecord | null,
  limit: number,
  cursor?: string,
) {
  const rows = conversation ? formatFamilyParentConversationMessage(conversation, member) : []
  const descending = [...rows].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
  const startIndex = cursor ? descending.findIndex((message) => message.id === cursor) + 1 : 0
  const paged = descending.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit + 1)

  let nextCursor: string | undefined
  if (paged.length > limit) {
    const next = paged.pop()!
    nextCursor = next.id
  }

  return {
    rows: paged.reverse(),
    nextCursor,
  }
}

async function loadParentFamilyConversationContext(parentId: string, memberId: string) {
  const [parent, memberRecord] = await Promise.all([
    prisma.user.findUnique({ where: { id: parentId }, select: FRIEND_USER_SELECT }),
    loadFamilyMemberSummaryForParent(memberId, parentId),
  ])

  if (!parent || !memberRecord) return null
  const member = normalizeFamilyMemberSummary(memberRecord)
  const conversation = getFamilyParentConversation(parent.communityMeta, member.id, parentId) ?? null
  return { parent, member, conversation }
}

async function loadParentFamilyConversationThreads(parentId: string) {
  const parent = await prisma.user.findUnique({ where: { id: parentId }, select: FRIEND_USER_SELECT })
  if (!parent) return []
  const members = await loadNormalizedFamilyMembersForParent(parentId)
  return members.map((member: typeof members[number]) =>
    buildParentFamilyConversationThread({
      parent,
      member,
      conversation: getFamilyParentConversation(parent.communityMeta, member.id, parentId) ?? null,
    }),
  )
}

function clearScheduledMessageCallTimeout(callId: string) {
  const timer = messageCallTimeouts.get(callId)
  if (!timer) return
  clearTimeout(timer)
  messageCallTimeouts.delete(callId)
}

function isMessageCallLive(call: MessageCallRecord | null | undefined): boolean {
  if (!call || call.endedAt) return false
  const now = Date.now()
  if (call.status === MessageCallStatus.ringing) {
    return now - call.createdAt.getTime() <= MESSAGE_CALL_RING_TTL_MS
  }
  const activityAt = call.lastJoinedAt ?? call.startedAt ?? call.createdAt
  return now - activityAt.getTime() <= MESSAGE_CALL_IDLE_TTL_MS
}

function formatMessageCall(call: MessageCallRecord, viewerId: string) {
  return {
    id: call.id,
    threadId: call.threadId,
    initiatorId: call.initiatorId,
    endedByUserId: call.endedByUserId ?? null,
    roomId: call.roomId,
    mode: call.mode,
    status: call.status,
    createdAt: call.createdAt,
    updatedAt: call.updatedAt,
    startedAt: call.startedAt ?? null,
    lastJoinedAt: call.lastJoinedAt ?? null,
    endedAt: call.endedAt ?? null,
    initiator: formatFriendUser(call.initiator),
    isInitiator: call.initiatorId === viewerId,
  }
}

function formatThreadBase(thread: ThreadWithParticipants, viewerId: string) {
  const activeCall = thread.calls.find((call) => isMessageCallLive(call)) ?? null
  return {
    id: thread.id,
    type: thread.type,
    contextType: thread.contextType ?? null,
    contextId: thread.contextId ?? null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessageAt: thread.lastMessageAt ?? thread.createdAt,
    participants: thread.participants.map((participant) => formatThreadParticipant(participant, viewerId)),
    activeCall: activeCall ? formatMessageCall(activeCall, viewerId) : null,
  }
}

function formatThreadSummaryRecord(
  thread: ThreadSummaryRecord,
  viewerId: string,
  options?: {
    unreadCount?: number
  },
) {
  const base = formatThreadBase(thread, viewerId)
  const lastMessage = thread.messages[0] ? formatMessage(thread.messages[0], viewerId) : null
  const unreadCount = Math.max(0, Number(options?.unreadCount ?? 0) || 0)
  return {
    ...base,
    lastMessage,
    unreadCount,
    unread: unreadCount > 0,
  }
}

function buildDirectThreadKey(userA: string, userB: string): string {
  const [first, second] = [userA, userB].sort()
  return `direct:${first}:${second}`
}

function buildFamilyDirectThreadKey(parentUserId: string, targetUserId: string, memberId: string): string {
  const [first, second] = [parentUserId, targetUserId].sort()
  return `direct:${first}:${second}:family:${memberId}`
}

function buildGroupThreadKey(userIds: string[]): string {
  return `group:${[...new Set(userIds)].sort().join(':')}`
}

function buildMessageCallEndedBody(args: {
  reason: 'hangup' | 'no_answer'
  actorName: string | null
}): string {
  if (args.reason === 'no_answer') return 'No answer.'
  if (args.actorName) return `${args.actorName} hung up.`
  return 'Call ended.'
}

function buildMessageCallSystemMeta(args: {
  call: Pick<MessageCallRecord, 'id' | 'threadId' | 'mode'>
  reason: 'hangup' | 'no_answer'
  actorUserId: string | null
  actorName: string | null
}): MessageCallSystemMeta {
  return {
    kind: 'call_ended',
    reason: args.reason,
    mode: args.call.mode,
    callId: args.call.id,
    callbackThreadId: args.call.threadId,
    callbackLabel: 'Call Back',
    actorUserId: args.actorUserId,
    actorName: args.actorName,
  }
}

async function expireMessageCallIfStale(call: MessageCallRecord | null | undefined, endedByUserId?: string | null) {
  if (!call || !call.id || isMessageCallLive(call)) return false
  clearScheduledMessageCallTimeout(call.id)
  await prisma.messageCall.updateMany({
    where: { id: call.id, endedAt: null },
    data: {
      status: MessageCallStatus.ended,
      endedAt: new Date(),
      ...(endedByUserId ? { endedByUserId } : {}),
    },
  })
  return true
}

async function findExistingExactThreadId(participantIds: string[]): Promise<string | null> {
  const normalized = [...new Set(participantIds)].sort()
  if (normalized.length < 2) return null
  if (normalized.length === 2) {
    const existing = await prisma.messageThread.findUnique({
      where: { uniqueKey: buildDirectThreadKey(normalized[0]!, normalized[1]!) },
      select: { id: true },
    })
    return existing?.id ?? null
  }

  const uniqueKey = buildGroupThreadKey(normalized)
  const byKey = await prisma.messageThread.findUnique({
    where: { uniqueKey },
    select: { id: true },
  })
  if (byKey?.id) return byKey.id

  const rows = (await prisma.$queryRaw(Prisma.sql`
    SELECT t."id", t."uniqueKey"
    FROM "MessageThread" t
    JOIN "MessageParticipant" mp ON mp."threadId" = t."id"
    WHERE t."type" = 'group'
      AND t."contextType" IS NULL
    GROUP BY t."id", t."uniqueKey"
    HAVING COUNT(*)::int = ${normalized.length}
      AND COUNT(*) FILTER (WHERE mp."userId" IN (${Prisma.join(normalized)}))::int = ${normalized.length}
    ORDER BY MAX(t."updatedAt") DESC
    LIMIT 1
  `)) as Array<{ id: string; uniqueKey: string | null }>

  const existing = rows[0]
  if (!existing?.id) return null
  if (!existing.uniqueKey) {
    await prisma.messageThread
      .update({
        where: { id: existing.id },
        data: { uniqueKey },
      })
      .catch(() => undefined)
  }
  return existing.id
}

async function usersAreFriends(userId: string, targetUserId: string): Promise<boolean> {
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: FriendshipStatus.ACCEPTED,
      OR: [
        { requesterId: userId, addresseeId: targetUserId },
        { requesterId: targetUserId, addresseeId: userId },
      ],
    },
    select: { id: true },
  })
  return Boolean(friendship)
}

async function usersAreAcceptedConnections(userId: string, targetUserId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Connection"
      WHERE "status" = 'ACCEPTED'
        AND (
          ("requesterId" = ${userId} AND "addresseeId" = ${targetUserId})
          OR
          ("requesterId" = ${targetUserId} AND "addresseeId" = ${userId})
        )
      LIMIT 1
    `
    return rows.length > 0
  } catch (error) {
    if (isConnectionTableMissingError(error)) return false
    throw error
  }
}

async function loadFriendIdSet(userId: string): Promise<Set<string>> {
  const ids = await loadAcceptedFriendIds(userId)
  return new Set(ids)
}

type FamilyCallRecord = {
  id: string
  memberId: string
  parentId: string
  roomId: string
  mode: 'audio' | 'video'
  status: 'ringing' | 'active' | 'ended'
  initiatorActor: 'parent' | 'child'
  createdAt: string
  updatedAt: string
  startedAt: string | null
  lastJoinedAt: string | null
  endedAt: string | null
}

const FAMILY_CALL_KEY_PREFIX = 'family:call:'
const FAMILY_CALL_MEMBER_KEY_PREFIX = 'family:call:member:'
const FAMILY_CALL_TTL_MS = 1000 * 60 * 60 * 12

function buildFamilyCallKey(callId: string) {
  return `${FAMILY_CALL_KEY_PREFIX}${callId}`
}

function buildFamilyCallMemberKey(memberId: string) {
  return `${FAMILY_CALL_MEMBER_KEY_PREFIX}${memberId}`
}

function isFamilyCallRecord(value: unknown): value is FamilyCallRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.memberId === 'string' &&
    typeof record.parentId === 'string' &&
    typeof record.roomId === 'string' &&
    (record.mode === 'audio' || record.mode === 'video') &&
    (record.status === 'ringing' || record.status === 'active' || record.status === 'ended') &&
    (record.initiatorActor === 'parent' || record.initiatorActor === 'child') &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  )
}

async function loadFamilyCallRecord(callId: string) {
  const raw = await redis.get(buildFamilyCallKey(callId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return isFamilyCallRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function writeFamilyCallRecord(record: FamilyCallRecord) {
  await redis.set(buildFamilyCallKey(record.id), JSON.stringify(record), 'PX', FAMILY_CALL_TTL_MS)
  if (record.status === 'ended') {
    const memberKey = buildFamilyCallMemberKey(record.memberId)
    const current = await redis.get(memberKey)
    if (current === record.id) {
      await redis.del(memberKey)
    }
    return
  }
  await redis.set(buildFamilyCallMemberKey(record.memberId), record.id, 'PX', FAMILY_CALL_TTL_MS)
}

async function loadFamilyCallForMember(memberId: string) {
  const callId = await redis.get(buildFamilyCallMemberKey(memberId))
  if (!callId) return null
  const record = await loadFamilyCallRecord(callId)
  if (!record || record.status === 'ended') {
    await redis.del(buildFamilyCallMemberKey(memberId))
    return null
  }
  return record
}

function buildFamilyRtcUserId(memberId: string) {
  return `family-member:${memberId}`
}

function formatFamilyCallParticipantUser(user: { id: string; handle: string; name: string | null; avatarUrl: string | null; coverUrl?: string | null; premiumStatus?: PremiumStatus | null }) {
  return {
    id: user.id,
    handle: user.handle,
    name: user.name,
    avatarUrl: normalizeMediaUrl(user.avatarUrl ?? null),
    coverUrl: normalizeMediaUrl(user.coverUrl ?? null),
    isPremium: isPremium(user.premiumStatus ?? null),
    isVerified: false,
  }
}

function formatFamilyCallSummary(args: {
  call: FamilyCallRecord
  member: FamilyAuthMember
  viewerRole: 'parent' | 'child'
}) {
  const memberSummary = normalizeFamilyMemberSummary(args.member)
  const parentUser = formatFriendUser(args.member.parent)
  const childUser = formatNormalizedFamilyMemberThreadUser(memberSummary)
  const initiator = args.call.initiatorActor === 'parent' ? parentUser : childUser
  const counterpart = args.viewerRole === 'parent' ? childUser : parentUser
  const viewerRtcUserId = args.viewerRole === 'parent' ? args.member.parentId : buildFamilyRtcUserId(args.member.id)
  return {
    member: {
      id: memberSummary.id,
      displayName: memberSummary.displayName,
      username: memberSummary.username,
      avatarUrl: memberSummary.avatarUrl,
      relationshipLabel: memberSummary.relationshipLabel,
      modeBand: memberSummary.modeBand,
      modeLabel: memberSummary.modeLabel,
    },
    parent: parentUser,
    viewerRole: args.viewerRole,
    counterpart,
    call: {
      id: args.call.id,
      memberId: args.call.memberId,
      parentId: args.call.parentId,
      roomId: args.call.roomId,
      mode: args.call.mode,
      status: args.call.status,
      createdAt: args.call.createdAt,
      updatedAt: args.call.updatedAt,
      startedAt: args.call.startedAt,
      lastJoinedAt: args.call.lastJoinedAt,
      endedAt: args.call.endedAt,
      initiatorActor: args.call.initiatorActor,
      initiator,
      isInitiator: (args.call.initiatorActor === 'parent' && args.viewerRole === 'parent') ||
        (args.call.initiatorActor === 'child' && args.viewerRole === 'child'),
      viewerRtcUserId,
    },
  }
}

async function loadFamilyCallContext(authContext: ViewerAuthContext, memberId: string) {
  const targetMember =
    authContext.actor === 'family_member'
      ? authContext.member.id === memberId
        ? authContext.member
        : null
      : await loadFamilyMemberAuthViewerById(memberId, authContext.userId)

  if (!targetMember) return null

  return {
    member: targetMember,
    viewerRole: authContext.actor === 'family_member' ? 'child' as const : 'parent' as const,
  }
}

async function loadThreadForUser(threadId: string, userId: string) {
  return prisma.messageThread.findFirst({
    where: {
      id: threadId,
      OR: [{ contextType: null }, { contextType: { not: 'market_listing' } }],
      participants: {
        some: { userId },
      },
    },
    include: THREAD_WITH_PARTICIPANTS_INCLUDE,
  })
}

async function loadCallableMessageThreadForUser(threadId: string, userId: string) {
  return prisma.messageThread.findFirst({
    where: {
      id: threadId,
      type: { in: [MessageThreadType.direct, MessageThreadType.group] },
      contextType: null,
      participants: {
        some: { userId },
      },
    },
    include: THREAD_WITH_PARTICIPANTS_INCLUDE,
  })
}

async function loadLatestThreadCall(threadId: string): Promise<MessageCallRecord | null> {
  const call = await prisma.messageCall.findFirst({
    where: {
      threadId,
      endedAt: null,
    },
    orderBy: [{ createdAt: 'desc' }],
    select: MESSAGE_CALL_SELECT,
  })
  return call ?? null
}

async function loadLiveThreadCall(
  threadId: string,
  options?: {
    expireStale?: boolean
    endedByUserId?: string | null
  },
): Promise<MessageCallRecord | null> {
  const latest = await loadLatestThreadCall(threadId)
  if (!latest) return null
  if (isMessageCallLive(latest)) {
    if (latest.status === MessageCallStatus.ringing) {
      scheduleMessageCallTimeout(latest)
    }
    return latest
  }
  if (options?.expireStale) {
    if (latest.status === MessageCallStatus.ringing) {
      await finalizeMessageCall({
        callId: latest.id,
        endedByUserId: options.endedByUserId ?? null,
        reason: 'no_answer',
      })
    } else {
      await expireMessageCallIfStale(latest, options.endedByUserId)
    }
  }
  return null
}

async function loadMessageCallForUser(callId: string, userId: string): Promise<MessageCallRecord | null> {
  const call = await prisma.messageCall.findFirst({
    where: {
      id: callId,
      thread: {
        contextType: null,
        participants: {
          some: { userId },
        },
      },
    },
    select: MESSAGE_CALL_SELECT,
  })
  return call ?? null
}

async function finalizeMessageCall(args: {
  callId: string
  endedByUserId?: string | null
  reason: 'hangup' | 'no_answer' | 'expired'
}) {
  clearScheduledMessageCallTimeout(args.callId)

  const call = await prisma.messageCall.findUnique({
    where: { id: args.callId },
    select: {
      ...MESSAGE_CALL_SELECT,
      thread: {
        include: THREAD_SUMMARY_INCLUDE,
      },
    },
  })
  if (!call) return null

  const actorUserId = args.endedByUserId ?? (args.reason === 'no_answer' ? call.initiatorId : null)
  const actorRecord =
    actorUserId && actorUserId !== call.initiatorId
      ? await prisma.user.findUnique({ where: { id: actorUserId }, select: FRIEND_USER_SELECT })
      : null
  const actor = actorRecord ? formatFriendUser(actorRecord) : formatFriendUser(call.initiator)
  const actorName = actor?.name?.trim() || actor?.handle || null
  const shouldCreateSystemMessage = args.reason === 'hangup' || args.reason === 'no_answer'

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const endedAt = new Date()
    const updated = await tx.messageCall.updateMany({
      where: { id: call.id, endedAt: null },
      data: {
        status: MessageCallStatus.ended,
        endedAt,
        ...(args.endedByUserId ? { endedByUserId: args.endedByUserId } : {}),
      },
    })
    if (updated.count === 0) return null

    let systemMessage: MessageRecord | null = null
    if (shouldCreateSystemMessage && actorUserId) {
      systemMessage = await tx.message.create({
        data: {
          threadId: call.threadId,
          senderId: actorUserId,
          body: buildMessageCallEndedBody({
            reason: args.reason === 'no_answer' ? 'no_answer' : 'hangup',
            actorName,
          }),
          attachments: buildMessageCallSystemMeta({
            call,
            reason: args.reason === 'no_answer' ? 'no_answer' : 'hangup',
            actorUserId,
            actorName,
          }) as Prisma.InputJsonValue,
          messageType: MessageType.system,
        },
        select: MESSAGE_SELECT,
      })

      await tx.messageThread.update({
        where: { id: call.threadId },
        data: { lastMessageAt: systemMessage.createdAt },
      })

      await tx.messageParticipant.updateMany({
        where: { threadId: call.threadId, userId: actorUserId },
        data: {
          lastActivityAt: systemMessage.createdAt,
          lastReadAt: systemMessage.createdAt,
        },
      })

      await tx.messageParticipant.updateMany({
        where: { threadId: call.threadId, userId: { not: actorUserId } },
        data: { lastActivityAt: systemMessage.createdAt },
      })
    }

    const thread = await tx.messageThread.findUnique({
      where: { id: call.threadId },
      include: THREAD_SUMMARY_INCLUDE,
    })
    return {
      thread,
      systemMessage,
    }
  })

  if (!result?.thread) return null

  await Promise.all(
    result.thread.participants.map((participant: ThreadParticipantRecord) =>
      Promise.allSettled([
        dispatchRealtimeEvent(participant.userId, {
          type: 'thread.created',
          data: { thread: formatThreadSummaryRecord(result.thread!, participant.userId) },
        }),
        dispatchRealtimeEvent(participant.userId, {
          type: 'message.call.ended',
          data: {
            threadId: call.threadId,
            callId: call.id,
            reason: args.reason,
          },
        }),
        result.systemMessage
          ? dispatchRealtimeEvent(participant.userId, {
              type: 'message.created',
              data: {
                threadId: call.threadId,
                message: formatMessage(result.systemMessage, participant.userId),
              },
            })
          : Promise.resolve(),
      ]),
    ),
  )

  return {
    thread: result.thread,
    systemMessage: result.systemMessage,
  }
}

function scheduleMessageCallTimeout(call: Pick<MessageCallRecord, 'id' | 'createdAt'>) {
  clearScheduledMessageCallTimeout(call.id)
  const elapsedMs = Date.now() - call.createdAt.getTime()
  const delayMs = Math.max(0, MESSAGE_CALL_RING_TTL_MS - elapsedMs)
  const timer = setTimeout(() => {
    void finalizeMessageCall({
      callId: call.id,
      reason: 'no_answer',
    }).catch((error) => {
      console.error('message_call_timeout_finalize_failed', error)
    })
  }, delayMs)
  messageCallTimeouts.set(call.id, timer)
}

type MessageLinkPreviewRecord = {
  kind: 'post' | 'event' | 'market_listing' | 'organization' | 'community' | 'profile'
  title: string
  description: string | null
  url: string
  imageUrl: string | null
  meta: string | null
}

const MESSAGE_LINK_PREVIEW_HOSTS = new Set([
  'dev.civilcitizens.ca',
  'civilcitizens.ca',
  'www.civilcitizens.ca',
  'civilvitizens.ca',
  'www.civilvitizens.ca',
])

function truncatePreviewText(value: string, max = 180): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isCivilMessageLinkHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (!host) return false
  if (MESSAGE_LINK_PREVIEW_HOSTS.has(host)) return true
  if (host === CIVIL_PUBLIC_HOST.toLowerCase()) return true
  return host.endsWith('.civilcitizens.ca') || host.endsWith('.civilvitizens.ca')
}

function normalizeMessageLinkPath(rawUrl: string): string | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('/')) {
    const relative = trimmed.replace(/#.*/, '')
    return relative.length ? relative : null
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!isCivilMessageLinkHost(parsed.hostname)) return null

  const path = `${parsed.pathname || '/'}${parsed.search || ''}`
  return path.replace(/#.*/, '')
}

function formatMarketplacePrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: (currency || 'CAD').toUpperCase(),
    }).format((cents || 0) / 100)
  } catch {
    return `${(cents || 0) / 100}`
  }
}

async function canViewerAccessPostForPreview(
  post: {
    visibility: string
    businessId: string | null
    moderationStatus?: ModerationStatus
    authorId?: string
  },
  viewerId: string | null,
): Promise<boolean> {
  const blockState = await loadViewerBlockState(viewerId)
  if (post.moderationStatus && post.authorId && isPostHiddenFromViewer({
    moderationStatus: post.moderationStatus,
    authorId: post.authorId,
    businessId: post.businessId,
  }, blockState)) {
    return false
  }
  if (post.visibility !== 'members' || !post.businessId) return true
  if (!viewerId) return false
  const business = await prisma.business.findUnique({
    where: { id: post.businessId },
    select: { ownerId: true, moderationStatus: true },
  })
  if (!business || business.moderationStatus !== ModerationStatus.VISIBLE) return false
  if (business?.ownerId === viewerId) return true
  const membership = await prisma.businessMembership.findUnique({
    where: { businessId_userId: { businessId: post.businessId, userId: viewerId } },
    select: { role: true },
  })
  return Boolean(membership)
}

async function resolvePostLinkPreview(slugOrId: string, viewerId: string | null): Promise<MessageLinkPreviewRecord | null> {
  const lookup = slugOrId.trim()
  if (!lookup) return null

  const post = await prisma.post.findFirst({
    where: {
      OR: [{ seoSlug: lookup }, { id: lookup }],
    },
    include: POST_INCLUDE,
  })
  if (!post) return null

  const canView = await canViewerAccessPostForPreview(post, viewerId)
  if (!canView) return null

  const formatted = formatPost(post, { viewerVote: null, recentComments: [] })
  const plainBody = stripHtmlToPlainText(formatted.body || '')
  const title = formatted.title?.trim() || truncatePreviewText(plainBody, 110) || 'Civil post'
  const descriptionSource = truncatePreviewText(plainBody, 200)
  const description = descriptionSource && descriptionSource !== title ? descriptionSource : null
  const imageUrl = formatted.images?.[0] ?? formatted.mediaUrl ?? formatted.organization?.logoUrl ?? formatted.author.avatarUrl ?? null
  const canonical = getCanonicalPaths(post)
  const url = canonical.community ?? canonical.user

  const metaParts: string[] = []
  if (formatted.organization?.name) metaParts.push(formatted.organization.name)
  if (formatted.communityName) metaParts.push(formatted.communityName)
  if (!formatted.organization?.name) metaParts.push(`@${formatted.author.handle}`)

  return {
    kind: 'post',
    title,
    description,
    url,
    imageUrl,
    meta: metaParts.filter(Boolean).join(' • ') || null,
  }
}

async function resolveOrganizationLinkPreview(
  provinceParam: string,
  communityParam: string,
  slugParam: string,
  viewerId: string | null,
): Promise<MessageLinkPreviewRecord | null> {
  const province = normalizeProvinceCode(provinceParam)
  if (!province) return null
  const communitySlug = communityParam.trim().toLowerCase()
  const community = findCommunity(province, communitySlug)
  if (!community) return null

  const slug = slugParam.trim().toLowerCase()
  if (!slug) return null

  const org = await prisma.business.findFirst({
    where: {
      provinceCode: community.province,
      communitySlug: community.slug,
      slug,
    },
    select: {
      id: true,
      ownerId: true,
      name: true,
      slug: true,
      description: true,
      metadata: true,
      status: true,
      logoUrl: true,
      coverUrl: true,
    },
  })
  if (!org) return null

  if (org.status !== 'ACTIVE') {
    if (!viewerId) return null
    const isOwner = org.ownerId === viewerId
    if (!isOwner) {
      const membership = await prisma.businessMembership.findUnique({
        where: {
          businessId_userId: {
            businessId: org.id,
            userId: viewerId,
          },
        },
        select: { role: true },
      })
      if (!membership) return null
    }
  }

  const headline = readOrganizationHeadline(org.metadata)
  const description = headline || truncatePreviewText(stripHtmlToPlainText(org.description ?? ''), 200) || null
  return {
    kind: 'organization',
    title: org.name,
    description,
    url: `/com/${community.province.toLowerCase()}/${community.slug.toLowerCase()}/orgs/${org.slug}`,
    imageUrl: normalizeMediaUrl(org.coverUrl ?? org.logoUrl ?? null),
    meta: `${community.name} • Organization`,
  }
}

type OrganizationSystemSnapshot = ReturnType<typeof readOrganizationSystemState>
type OrganizationEventSnapshot = OrganizationSystemSnapshot['events'][number]

type EventPreviewOrganization = {
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  logoUrl: string | null
  coverUrl: string | null
}

function formatEventPreviewDate(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function canViewerAccessEventForPreview(event: OrganizationEventSnapshot, system: OrganizationSystemSnapshot, viewerId: string | null): boolean {
  const status = String(event.status ?? 'PUBLISHED').toUpperCase()
  if (status !== 'PUBLISHED') return false
  if (event.access !== 'RESTRICTED') return true
  if (!viewerId) return false

  const membership = system.members[viewerId]
  if (!membership || membership.status !== 'ACTIVE') return false

  const eligibleRankIdsRaw = (event as { eligibleRankIds?: unknown }).eligibleRankIds
  const eligibleRankIds = Array.isArray(eligibleRankIdsRaw)
    ? eligibleRankIdsRaw
      .map((rankId) => (typeof rankId === 'string' ? rankId.trim() : ''))
      .filter((rankId): rankId is string => Boolean(rankId))
    : []
  if (eligibleRankIds.length > 0 && !eligibleRankIds.includes(membership.rankId)) {
    return false
  }
  return true
}

function buildOrganizationEventLinkPreviewRecord(input: {
  event: OrganizationEventSnapshot
  organization: EventPreviewOrganization
  communityName: string
}): MessageLinkPreviewRecord {
  const plainDescription = stripHtmlToPlainText(input.event.description ?? '')
  const description = truncatePreviewText(plainDescription, 200) || null
  const startsAtLabel = formatEventPreviewDate(input.event.startsAt)
  const imageCandidate = input.event.primaryPhotoUrl ?? input.event.galleryPhotoUrls?.[0] ?? input.organization.coverUrl ?? input.organization.logoUrl ?? null

  return {
    kind: 'event',
    title: truncatePreviewText(input.event.title || 'Civil event', 120) || 'Civil event',
    description,
    url: `/com/${encodeURIComponent(input.organization.provinceCode.toLowerCase())}/${encodeURIComponent(input.organization.communitySlug.toLowerCase())}/orgs/${encodeURIComponent(input.organization.slug)}/events/${encodeURIComponent(input.event.id)}`,
    imageUrl: normalizeMediaUrl(imageCandidate),
    meta: [input.organization.name, input.communityName, startsAtLabel].filter(Boolean).join(' • ') || null,
  }
}

async function resolveOrganizationEventLinkPreview(
  provinceParam: string,
  communityParam: string,
  slugParam: string,
  eventIdParam: string,
  viewerId: string | null,
): Promise<MessageLinkPreviewRecord | null> {
  const province = normalizeProvinceCode(provinceParam)
  if (!province) return null
  const communitySlug = communityParam.trim().toLowerCase()
  const community = findCommunity(province, communitySlug)
  if (!community) return null

  const slug = slugParam.trim().toLowerCase()
  const eventId = eventIdParam.trim()
  if (!slug || !eventId) return null

  const org = await prisma.business.findFirst({
    where: {
      provinceCode: community.province,
      communitySlug: community.slug,
      slug,
      status: BusinessStatus.ACTIVE,
    },
    select: {
      name: true,
      slug: true,
      provinceCode: true,
      communitySlug: true,
      logoUrl: true,
      coverUrl: true,
      metadata: true,
    },
  })
  if (!org || !org.provinceCode || !org.communitySlug) return null

  const system = readOrganizationSystemState(org.metadata)
  const event = system.events.find((item) => item.id === eventId)
  if (!event) return null
  if (!canViewerAccessEventForPreview(event, system, viewerId)) return null

  return buildOrganizationEventLinkPreviewRecord({
    event,
    organization: {
      name: org.name,
      slug: org.slug,
      provinceCode: org.provinceCode,
      communitySlug: org.communitySlug,
      logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
      coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
    },
    communityName: community.name,
  })
}

async function resolveOrganizationIdEventLinkPreview(
  organizationIdParam: string,
  eventIdParam: string,
  viewerId: string | null,
): Promise<MessageLinkPreviewRecord | null> {
  const organizationId = organizationIdParam.trim()
  const eventId = eventIdParam.trim()
  if (!organizationId || !eventId) return null

  const org = await prisma.business.findFirst({
    where: {
      id: organizationId,
      status: BusinessStatus.ACTIVE,
    },
    select: {
      name: true,
      slug: true,
      provinceCode: true,
      communitySlug: true,
      logoUrl: true,
      coverUrl: true,
      metadata: true,
    },
  })
  if (!org || !org.provinceCode || !org.communitySlug) return null

  const province = normalizeProvinceCode(org.provinceCode)
  if (!province) return null
  const community = findCommunity(province, org.communitySlug.trim().toLowerCase())
  if (!community) return null

  const system = readOrganizationSystemState(org.metadata)
  const event = system.events.find((item) => item.id === eventId)
  if (!event) return null
  if (!canViewerAccessEventForPreview(event, system, viewerId)) return null

  return buildOrganizationEventLinkPreviewRecord({
    event,
    organization: {
      name: org.name,
      slug: org.slug,
      provinceCode: org.provinceCode,
      communitySlug: org.communitySlug,
      logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
      coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
    },
    communityName: community.name,
  })
}

async function resolveMarketplaceListingLinkPreview(listingId: string): Promise<MessageLinkPreviewRecord | null> {
  const normalizedId = listingId.trim()
  if (!normalizedId) return null
  await ensureCitizenMarketplaceTables()

  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      title: string
      description: string | null
      price_cents: number
      currency: string
      photo_urls: unknown
      pickup_city: string | null
      pickup_province: string | null
      status: string
      is_draft: boolean
      is_active: boolean
    }>
  >`
    SELECT
      id,
      title,
      description,
      price_cents,
      currency,
      photo_urls,
      pickup_city,
      pickup_province,
      status,
      is_draft,
      is_active
    FROM citizen_market_listing
    WHERE id = ${normalizedId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  if (!row.is_active || row.is_draft || String(row.status || '').toLowerCase() !== 'active') return null

  const priceLabel = formatMarketplacePrice(Number(row.price_cents) || 0, row.currency || 'CAD')
  const location = row.pickup_city ? `${row.pickup_city}${row.pickup_province ? `, ${row.pickup_province}` : ''}` : null
  const descriptionParts = [truncatePreviewText(row.description ?? '', 140), location].filter((value): value is string => Boolean(value && value.trim()))
  return {
    kind: 'market_listing',
    title: row.title || 'Marketplace item',
    description: descriptionParts.join(' • ') || null,
    url: `/market/listings/${row.id}`,
    imageUrl: normalizeMediaUrl(readGalleryUrls(row.photo_urls)[0] ?? null),
    meta: [priceLabel, location].filter(Boolean).join(' • ') || priceLabel,
  }
}

async function resolveProfileLinkPreview(handleParam: string): Promise<MessageLinkPreviewRecord | null> {
  const handle = handleParam.replace(/^@+/, '').trim().toLowerCase()
  if (!handle) return null

  const user = await prisma.user.findUnique({
    where: { handle },
    select: {
      handle: true,
      name: true,
      bio: true,
      avatarUrl: true,
      coverUrl: true,
    },
  })
  if (!user) return null

  const title = (user.name || '').trim() || `@${user.handle}`
  return {
    kind: 'profile',
    title,
    description: truncatePreviewText(user.bio ?? '', 200) || null,
    url: `/u/${user.handle}`,
    imageUrl: normalizeMediaUrl(user.coverUrl ?? user.avatarUrl ?? null),
    meta: `@${user.handle}`,
  }
}

function resolveCommunityLinkPreview(provinceParam: string, communityParam: string): MessageLinkPreviewRecord | null {
  const province = normalizeProvinceCode(provinceParam)
  if (!province) return null
  const communitySlug = communityParam.trim().toLowerCase()
  const community = findCommunity(province, communitySlug)
  if (!community) return null

  const provinceName = getProvinceDisplayName(community.province as any)
  return {
    kind: 'community',
    title: community.name,
    description: `${provinceName} community on Civil`,
    url: `/${community.province.toLowerCase()}/${community.slug.toLowerCase()}`,
    imageUrl: null,
    meta: provinceName,
  }
}

async function resolveMessageLinkPreview(pathWithQuery: string, viewerId: string | null): Promise<MessageLinkPreviewRecord | null> {
  const [pathname] = pathWithQuery.split('?')
  const path = pathname || '/'
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((segment) => decodePathSegment(segment))
  if (!segments.length) return null

  if (segments[0]?.toLowerCase() === 'u') {
    if (segments[1] && segments[2]?.toLowerCase() === 'posts' && segments[3]) {
      return resolvePostLinkPreview(segments[3], viewerId)
    }
    if (segments[1]) {
      return resolveProfileLinkPreview(segments[1])
    }
  }

  if (segments[0]?.toLowerCase() === 'post' && segments[1]) {
    return resolvePostLinkPreview(segments[1], viewerId)
  }

  if (segments[0]?.toLowerCase() === 'events' && segments[1] && segments[2]) {
    return resolveOrganizationIdEventLinkPreview(segments[1], segments[2], viewerId)
  }

  if (segments[0]?.toLowerCase() === 'market' && segments[1]?.toLowerCase() === 'listings' && segments[2]) {
    return resolveMarketplaceListingLinkPreview(segments[2])
  }

  if (
    segments[0]?.toLowerCase() === 'com' &&
    segments[1] &&
    segments[2] &&
    segments[3]?.toLowerCase() === 'orgs' &&
    segments[4] &&
    segments[5]?.toLowerCase() === 'events' &&
    segments[6] &&
    segments[6]?.toLowerCase() !== 'manage'
  ) {
    return resolveOrganizationEventLinkPreview(segments[1], segments[2], segments[4], segments[6], viewerId)
  }

  if (
    segments[0]?.toLowerCase() === 'com' &&
    segments[1] &&
    segments[2] &&
    segments[3]?.toLowerCase() === 'orgs' &&
    segments[4]
  ) {
    return resolveOrganizationLinkPreview(segments[1], segments[2], segments[4], viewerId)
  }

  if (segments[0] && segments[1] && segments[2]?.toLowerCase() === 'posts' && segments[3]) {
    return resolvePostLinkPreview(segments[3], viewerId)
  }

  if (segments[0] && segments[1]) {
    return resolveCommunityLinkPreview(segments[0], segments[1])
  }

  return null
}

async function fetchThreadMessages(
  threadId: string,
  limit: number,
  cursor?: string,
): Promise<{ rows: MessageRecord[]; nextCursor?: string }> {
  const rows = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: MESSAGE_SELECT,
  })

  let nextCursor: string | undefined
  if (rows.length > limit) {
    const next = rows.pop()!
    nextCursor = next.id
  }

  return {
    rows: rows.reverse(),
    nextCursor,
  }
}

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient
type Jurisdiction = z.infer<typeof JurisdictionEnum>
const DEFAULT_JURISDICTION: Jurisdiction = 'self'
const REDDIT_EPOCH_SECONDS = 1134028003
const REACTION_HOT_WINDOW_HOURS = 48

const SCHEMA_MISMATCH_MESSAGE =
  'Database schema is out of date for this API version. Apply the latest Prisma migration (pnpm --filter @civil/db prisma migrate deploy) and restart the API.'

function schemaOutOfDateDetail(err: unknown): { prismaCode?: string; prismaMetaMessage?: string; message?: string } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const metaMessage = typeof (err.meta as any)?.message === 'string' ? ((err.meta as any).message as string) : undefined
    return { prismaCode: err.code, prismaMetaMessage: metaMessage, message: err.message }
  }
  const message = typeof (err as any)?.message === 'string' ? ((err as any).message as string) : undefined
  return { message }
}

function isSchemaOutOfDateError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2021' || err.code === 'P2022') return true
    if (err.code === 'P2010') {
      const rawMessage = typeof (err.meta as any)?.message === 'string' ? (err.meta as any).message : ''
      return /does not exist|unknown column|undefined table|undefined column/i.test(rawMessage)
    }
    return false
  }
  const message = typeof (err as any)?.message === 'string' ? (err as any).message : ''
  return /does not exist|unknown column|undefined table|undefined column/i.test(message)
}

const MediaAssetParam = z.object({ id: MediaAssetIdSchema })
const FriendRequestInput = z.object({ userId: z.string().trim().min(1).max(120) })
const FamilyFriendRequestInput = z
  .object({
    username: z.string().trim().max(40).optional(),
    inviteCode: z.string().trim().max(40).optional(),
  })
  .refine((value) => Boolean(value.username?.trim() || value.inviteCode?.trim()), {
    message: 'username_or_invite_code_required',
    path: ['username'],
  })
const FriendshipIdParam = z.object({ id: z.string().cuid() })
const ConnectionRequestInput = z.object({ userId: z.string().trim().min(1).max(120) })
const ConnectionIdParam = z.object({ id: z.string().trim().min(1).max(120) })
const MessageThreadIdParam = z.object({ id: z.string().min(1) })
const MessageLinkPreviewQuery = z.object({
  url: z.string().trim().min(1).max(2048),
})
const MessageThreadParticipantParams = z.object({
  id: z.string().cuid(),
  userId: z.string().cuid().or(z.string().uuid()),
})
const MessageCallIdParam = z.object({ id: z.string().cuid() })

const NotificationRespondParams = z.object({
  id: z.string().cuid(),
})

const NotificationRespondBody = z.object({
  action: z.enum(['accept', 'reject']),
})

function normalizeSearchTerm(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

type UserSearchRecord = {
  id: string
  name: string | null
  handle: string
  avatarUrl: string | null
  coverUrl: string | null
  premiumStatus: PremiumStatus | null
  communityMeta: Prisma.JsonValue | null
}

type UserSearchResultPayload = {
  id: string
  name: string | null
  handle: string
  avatarUrl: string | null
  coverUrl: string | null
  isPremium: boolean
  isVerified: boolean
  homeCommunity: {
    provinceCode: string
    provinceName: string | null
    communitySlug: string
    communityName: string | null
  } | null
}

type OrganizationSearchResultPayload = {
  id: string
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  coverUrl: string | null
  isVerified: boolean
  provinceCode: string
  communitySlug: string
  communityName: string | null
  href: string
}

type EventSearchResultPayload = {
  id: string
  title: string
  description: string | null
  imageUrl: string | null
  startsAt: string | null
  startsAtLabel: string | null
  organization: {
    name: string
    slug: string
    logoUrl: string | null
    isVerified: boolean
  }
  provinceCode: string
  communitySlug: string
  communityName: string | null
  href: string
}

type MarketSearchResultPayload = {
  id: string
  title: string
  description: string | null
  imageUrl: string | null
  priceLabel: string
  locationLabel: string | null
  href: string
}

type ContentAiScanTargetType = 'post' | 'comment' | 'market_listing' | 'market_product' | 'organization_event' | 'organization'

type ContentAiScanSummary = {
  status: string
  moderationState: string | null
  labelSummary: string | null
  labels: string[]
  moderationFlags: string[]
  errorText: string | null
  updatedAt: string | null
  completedAt: string | null
}

type PostSearchResultPayload = {
  id: string
  title: string | null
  excerpt: string | null
  imageUrl: string | null
  communityName: string | null
  provinceName: string | null
  author: {
    handle: string
    name: string | null
    avatarUrl: string | null
  }
  organization: {
    name: string
    slug: string
    logoUrl: string | null
    isVerified: boolean
  } | null
  href: string
}

function buildSearchableText(...parts: Array<string | null | undefined>): string {
  return normalizeSearchTerm(parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' '))
}

const CIVIL_AI_MARKET_QUERY_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'any',
  'for',
  'from',
  'i',
  'im',
  'i’m',
  'looking',
  'look',
  'me',
  'near',
  'sale',
  'some',
  'something',
  'sure',
  'that',
  'the',
  'used',
  'want',
  'yeah',
  'yes',
  'yep',
])

function buildCivilAiMarketQueryTokens(query: string) {
  const normalized = normalizeSearchTerm(query).toLowerCase()
  if (!normalized) return [] as string[]

  const variants = new Set<string>()
  for (const rawToken of normalized.split(/[^a-z0-9]+/i)) {
    const token = rawToken.trim()
    if (!token || token.length < 2 || CIVIL_AI_MARKET_QUERY_STOPWORDS.has(token)) continue
    variants.add(token)
    if (token.endsWith('es') && token.length > 4) variants.add(token.slice(0, -2))
    else if (token.endsWith('s') && token.length > 3) variants.add(token.slice(0, -1))
  }

  return Array.from(variants)
}

export function scoreSearchTextMatch(text: string, query: string): number {
  const haystack = normalizeSearchTerm(text).toLowerCase()
  const normalizedQuery = normalizeSearchTerm(query).toLowerCase()
  if (!haystack || !normalizedQuery) return 0

  const compactHaystack = haystack.replace(/\s+/g, '')
  const compactQuery = normalizedQuery.replace(/\s+/g, '')
  const tokens = normalizedQuery.split(' ').filter(Boolean)
  let score = 0

  if (haystack === normalizedQuery) score += 1000
  if (haystack.startsWith(normalizedQuery)) score += 600
  if (haystack.includes(normalizedQuery)) score += 300
  if (compactHaystack === compactQuery) score += 900
  if (compactQuery.length > 2 && compactHaystack.includes(compactQuery)) score += 260

  if (tokens.length) {
    const tokenHits = tokens.filter((token) => {
      const compactToken = token.replace(/\s+/g, '')
      return haystack.includes(token) || (compactToken.length > 2 && compactHaystack.includes(compactToken))
    }).length
    score += tokenHits * 80
    if (tokenHits === tokens.length) score += 180
  }

  return score
}

async function searchUsersForQuery({
  viewerId,
  query,
  limit,
}: {
  viewerId: string
  query: string
  limit: number
}): Promise<UserSearchResultPayload[]> {
  const normalizedQuery = normalizeSearchTerm(query)
  if (!normalizedQuery) return []

  const tokens = normalizedQuery.split(' ').filter(Boolean)
  const normalizedHandle = normalizedQuery.replace(/^@/, '')

  const where: Prisma.UserWhereInput = {
    NOT: { id: viewerId },
    OR: [
      tokens.length
        ? {
            AND: tokens.map((token) => ({ name: { contains: token, mode: 'insensitive' } })),
          }
        : { name: { contains: normalizedQuery, mode: 'insensitive' } },
      { handle: { contains: normalizedHandle, mode: 'insensitive' } },
    ],
  }

  const users = (await prisma.user.findMany({
    where,
    orderBy: [{ name: 'asc' }, { handle: 'asc' }],
    take: limit,
    select: {
      id: true,
      name: true,
      handle: true,
      avatarUrl: true,
      coverUrl: true,
      premiumStatus: true,
      communityMeta: true,
    },
  })) as UserSearchRecord[]

  const userIds = users.map((user) => user.id)
  const homeFollows = userIds.length
    ? await prisma.communityFollow.findMany({
        where: { userId: { in: userIds }, home: true },
        select: {
          userId: true,
          provinceCode: true,
          communitySlug: true,
        },
      })
    : []

  const homeMap = new Map<
    string,
    { provinceCode: string; provinceName: string | null; communitySlug: string; communityName: string | null }
  >()
  for (const follow of homeFollows) {
    const community = findCommunity(follow.provinceCode, follow.communitySlug)
    const provinceName = getProvinceDisplayName(follow.provinceCode as ProvinceCodeLiteral)
    homeMap.set(follow.userId, {
      provinceCode: follow.provinceCode,
      provinceName,
      communitySlug: follow.communitySlug,
      communityName: community?.name ?? follow.communitySlug,
    })
  }

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    handle: user.handle,
    avatarUrl: normalizeMediaUrl(user.avatarUrl ?? null),
    coverUrl: normalizeMediaUrl(user.coverUrl ?? null),
    isPremium: isPremium(user.premiumStatus),
    isVerified: isSelfVerifiedCanadianCitizen(parseCommunityMeta(user.communityMeta ?? null)),
    homeCommunity: homeMap.get(user.id) ?? null,
  }))
}

async function searchCommunitiesForQuery(query: string, limit: number): Promise<CitySummaryType[]> {
  const normalizedQuery = normalizeSearchTerm(query)
  if (!normalizedQuery) return []

  const slugQuery = slugifyCommunityName(normalizedQuery)
  const tokens = normalizedQuery.split(' ').filter(Boolean)
  const tokenLowers = tokens.map((token) => token.toLowerCase())
  const normalizedLower = normalizedQuery.toLowerCase()

  const insensitiveMode = Prisma.QueryMode.insensitive

  const buildFieldCondition = (field: 'name' | 'communityName'): Prisma.CityWhereInput => {
    if (!tokens.length) {
      return {
        [field]: {
          contains: normalizedQuery,
          mode: insensitiveMode,
        },
      }
    }
    return {
      AND: tokens.map(
        (token) =>
          ({
            [field]: {
              contains: token,
              mode: insensitiveMode,
            },
          }) as Prisma.CityWhereInput,
      ),
    }
  }

  const nameCondition = buildFieldCondition('name')
  const communityCondition = buildFieldCondition('communityName')

  const where: Prisma.CityWhereInput = {
    OR: [
      nameCondition,
      communityCondition,
      { slug: { contains: slugQuery, mode: insensitiveMode } },
      { communitySlug: { contains: slugQuery, mode: insensitiveMode } },
    ],
  }

  const cities = await prisma.city.findMany({
    where,
    orderBy: [{ population: 'desc' }, { name: 'asc' }],
    take: limit,
  })

  const dbSummaries = cities.map((city: CityModel) => formatCitySummary(city))

  const seenKeys = new Set(dbSummaries.map((entry: CitySummaryType) => `${entry.provinceCode}:${entry.communitySlug}`))
  const staticMatches: CitySummaryType[] = []

  for (const province of PROVINCES) {
    const communities = getCommunitiesByProvince(province.code)
    for (const community of communities) {
      const communityNameLower = community.name.toLowerCase()
      const communitySlugLower = community.slug.toLowerCase()
      const matches =
        communityNameLower.includes(normalizedLower) ||
        communitySlugLower.includes(slugQuery) ||
        tokens.every((token) => communityNameLower.includes(token.toLowerCase()))

      if (!matches) continue

      const key = `${community.province}:${community.slug}`
      if (seenKeys.has(key)) continue

      seenKeys.add(key)
      staticMatches.push({
        name: community.name,
        slug: community.slug,
        provinceCode: community.province,
        provinceName: getProvinceDisplayName(community.province),
        communitySlug: community.slug,
        communityName: community.name,
        latitude: 0,
        longitude: 0,
        population: null,
      })
    }
  }

  const rankCommunityMatch = (entry: CitySummaryType) => {
    const label = (entry.communityName || entry.name || '').toLowerCase()
    const slug = (entry.communitySlug || entry.slug || '').toLowerCase()
    let score = 0

    if (label === normalizedLower || slug === slugQuery) score += 1000
    if (label.startsWith(normalizedLower) || slug.startsWith(slugQuery)) score += 600
    if (label.includes(normalizedLower) || slug.includes(slugQuery)) score += 300

    if (tokenLowers.length) {
      const tokenHits = tokenLowers.filter((token) => label.includes(token) || slug.includes(token)).length
      score += tokenHits * 80
      if (tokenHits === tokenLowers.length) score += 120
    }

    if (typeof entry.population === 'number' && entry.population > 0) {
      score += Math.min(entry.population / 1000, 50)
    }

    return score
  }

  const combined = [...dbSummaries, ...staticMatches]
  combined.sort((a, b) => {
    const scoreDelta = rankCommunityMatch(b) - rankCommunityMatch(a)
    if (scoreDelta !== 0) return scoreDelta
    const popA = typeof a.population === 'number' ? a.population : -1
    const popB = typeof b.population === 'number' ? b.population : -1
    if (popB !== popA) return popB - popA
    return (a.communityName || a.name).localeCompare(b.communityName || b.name)
  })

  return combined.slice(0, limit)
}

async function searchOrganizationsForQuery(query: string, limit: number): Promise<OrganizationSearchResultPayload[]> {
  const normalizedQuery = normalizeSearchTerm(query)
  if (!normalizedQuery) return []

  const tokens = normalizedQuery.split(' ').filter(Boolean)
  const slugQuery = normalizedQuery.toLowerCase().replace(/\s+/g, '-')
  const insensitiveMode = Prisma.QueryMode.insensitive

  const buildContains = (field: 'name' | 'description'): Prisma.BusinessWhereInput => {
    if (!tokens.length) {
      return {
        [field]: {
          contains: normalizedQuery,
          mode: insensitiveMode,
        },
      }
    }
    return {
      AND: tokens.map(
        (token) =>
          ({
            [field]: {
              contains: token,
              mode: insensitiveMode,
            },
          }) as Prisma.BusinessWhereInput,
      ),
    }
  }

  type OrganizationSearchRow = {
    id: string
    name: string
    slug: string
    description: string | null
    logoUrl: string | null
    coverUrl: string | null
    isVerified: boolean
    provinceCode: string | null
    communitySlug: string | null
  }

  const businesses: OrganizationSearchRow[] = await prisma.business.findMany({
    where: {
      status: BusinessStatus.ACTIVE,
      OR: [
        buildContains('name'),
        buildContains('description'),
        { slug: { contains: slugQuery, mode: insensitiveMode } },
      ],
    },
    orderBy: [{ name: 'asc' }],
    take: Math.max(limit * 3, 18),
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logoUrl: true,
      coverUrl: true,
      isVerified: true,
      provinceCode: true,
      communitySlug: true,
    },
  })

  const ranked: Array<{ item: OrganizationSearchResultPayload; score: number }> = businesses
    .map((business: OrganizationSearchRow) => {
      if (!business.provinceCode || !business.communitySlug) return null
      const provinceCode = business.provinceCode.toLowerCase()
      const communitySlug = business.communitySlug.toLowerCase()
      const community = findCommunity(business.provinceCode, business.communitySlug)
      return {
        item: {
          id: business.id,
          name: business.name,
          slug: business.slug,
          description: truncatePreviewText(stripHtmlToPlainText(business.description ?? ''), 180) || null,
          logoUrl: normalizeMediaUrl(business.logoUrl ?? null),
          coverUrl: normalizeMediaUrl(business.coverUrl ?? null),
          isVerified: Boolean(business.isVerified),
          provinceCode,
          communitySlug,
          communityName: community?.name ?? null,
          href: `/com/${encodeURIComponent(provinceCode)}/${encodeURIComponent(communitySlug)}/orgs/${encodeURIComponent(business.slug)}`,
        } satisfies OrganizationSearchResultPayload,
        score: scoreSearchTextMatch(buildSearchableText(business.name, business.slug, business.description), normalizedQuery),
      }
    })
    .filter((entry): entry is { item: OrganizationSearchResultPayload; score: number } => Boolean(entry))

  ranked.sort((a: { item: OrganizationSearchResultPayload; score: number }, b: { item: OrganizationSearchResultPayload; score: number }) => {
    const scoreDelta = b.score - a.score
    if (scoreDelta !== 0) return scoreDelta
    return a.item.name.localeCompare(b.item.name)
  })

  return ranked.slice(0, limit).map((entry: { item: OrganizationSearchResultPayload; score: number }) => entry.item)
}

async function searchEventsForQuery({
  viewerId,
  query,
  limit,
}: {
  viewerId: string
  query: string
  limit: number
}): Promise<EventSearchResultPayload[]> {
  const normalizedQuery = normalizeSearchTerm(query)
  if (!normalizedQuery) return []

  type EventOrgRow = {
    id: string
    name: string
    slug: string
    description: string | null
    provinceCode: string | null
    communitySlug: string | null
    logoUrl: string | null
    coverUrl: string | null
    isVerified: boolean
    metadata: unknown
  }

  const likePattern = `%${normalizedQuery.toLowerCase()}%`
  const rows: EventOrgRow[] = await prisma.$queryRaw(Prisma.sql`
    SELECT
      id,
      name,
      slug,
      description,
      "provinceCode" AS "provinceCode",
      "communitySlug" AS "communitySlug",
      "logoUrl" AS "logoUrl",
      "coverUrl" AS "coverUrl",
      "isVerified" AS "isVerified",
      metadata
    FROM "Business"
    WHERE status = ${BusinessStatus.ACTIVE}::"BusinessStatus"
      AND "provinceCode" IS NOT NULL
      AND "communitySlug" IS NOT NULL
      AND (
        LOWER(name) LIKE ${likePattern}
        OR LOWER(COALESCE(description, '')) LIKE ${likePattern}
        OR LOWER(COALESCE(metadata::text, '')) LIKE ${likePattern}
      )
    ORDER BY name ASC
    LIMIT ${Math.max(limit * 8, 40)}
  `)

  const results: Array<{ item: EventSearchResultPayload; score: number; startsAtMs: number }> = []

  for (const row of rows) {
    if (!row.provinceCode || !row.communitySlug) continue
    const community = findCommunity(row.provinceCode, row.communitySlug)
    const system = readOrganizationSystemState(row.metadata)

    for (const event of system.events) {
      if (!canViewerAccessEventForPreview(event, system, viewerId)) continue

      const searchText = buildSearchableText(event.title, stripHtmlToPlainText(event.description ?? ''), row.name, row.description)
      const score = scoreSearchTextMatch(searchText, normalizedQuery)
      if (score <= 0) continue

      const startsAt = typeof event.startsAt === 'string' && event.startsAt.trim().length > 0 ? event.startsAt : null
      const parsedStartsAt = startsAt ? Date.parse(startsAt) : Number.NaN
      const startsAtMs = Number.isFinite(parsedStartsAt) ? parsedStartsAt : Number.MAX_SAFE_INTEGER
      const provinceCode = row.provinceCode.toLowerCase()
      const communitySlug = row.communitySlug.toLowerCase()

      results.push({
        item: {
          id: event.id,
          title: truncatePreviewText(event.title || 'Civil event', 120) || 'Civil event',
          description: truncatePreviewText(stripHtmlToPlainText(event.description ?? ''), 180) || null,
          imageUrl: normalizeMediaUrl(event.primaryPhotoUrl ?? event.galleryPhotoUrls?.[0] ?? row.coverUrl ?? row.logoUrl ?? null),
          startsAt,
          startsAtLabel: formatEventPreviewDate(startsAt),
          organization: {
            name: row.name,
            slug: row.slug,
            logoUrl: normalizeMediaUrl(row.logoUrl ?? null),
            isVerified: Boolean(row.isVerified),
          },
          provinceCode,
          communitySlug,
          communityName: community?.name ?? null,
          href: `/com/${encodeURIComponent(provinceCode)}/${encodeURIComponent(communitySlug)}/orgs/${encodeURIComponent(row.slug)}/events/${encodeURIComponent(event.id)}`,
        },
        score,
        startsAtMs,
      })
    }
  }

  results.sort((a, b) => {
    const scoreDelta = b.score - a.score
    if (scoreDelta !== 0) return scoreDelta
    const startDelta = a.startsAtMs - b.startsAtMs
    if (Number.isFinite(startDelta) && startDelta !== 0) return startDelta
    return a.item.title.localeCompare(b.item.title)
  })

  return results.slice(0, limit).map((entry) => entry.item)
}

async function searchMarketListingsForQuery(
  query: string,
  limit: number,
  options?: {
    communities?: Array<{ provinceCode: string; communitySlug: string }>
    provinceCodes?: string[]
  },
): Promise<MarketSearchResultPayload[]> {
  const normalizedQuery = normalizeSearchTerm(query)
  if (!normalizedQuery) return []

  await ensureCitizenMarketplaceTables()
  await ensureContentAiScanTables()

  type MarketSearchRow = {
    id: string
    title: string
    description: string | null
    price_cents: number
    currency: string
    photo_urls: unknown
    pickup_city: string | null
    pickup_province: string | null
    created_at: Date
    ai_search_text: string | null
  }

  const likePattern = `%${normalizedQuery.toLowerCase()}%`
  const compactLikePattern = `%${normalizedQuery.toLowerCase().replace(/\s+/g, '')}%`
  const tokenPatterns = buildCivilAiMarketQueryTokens(normalizedQuery)
    .map((token) => ({
      like: `%${token}%`,
      compactLike: `%${token.replace(/\s+/g, '')}%`,
    }))

  const searchClauses = [
    Prisma.sql`LOWER(l.title) LIKE ${likePattern}`,
    Prisma.sql`LOWER(COALESCE(l.description, '')) LIKE ${likePattern}`,
    Prisma.sql`LOWER(COALESCE(ai.search_text, '')) LIKE ${likePattern}`,
    Prisma.sql`REPLACE(LOWER(l.title), ' ', '') LIKE ${compactLikePattern}`,
    Prisma.sql`REPLACE(LOWER(COALESCE(l.description, '')), ' ', '') LIKE ${compactLikePattern}`,
    Prisma.sql`REPLACE(LOWER(COALESCE(ai.search_text, '')), ' ', '') LIKE ${compactLikePattern}`,
    ...tokenPatterns.flatMap((pattern) => [
      Prisma.sql`LOWER(l.title) LIKE ${pattern.like}`,
      Prisma.sql`LOWER(COALESCE(l.description, '')) LIKE ${pattern.like}`,
      Prisma.sql`LOWER(COALESCE(ai.search_text, '')) LIKE ${pattern.like}`,
      Prisma.sql`REPLACE(LOWER(l.title), ' ', '') LIKE ${pattern.compactLike}`,
      Prisma.sql`REPLACE(LOWER(COALESCE(l.description, '')), ' ', '') LIKE ${pattern.compactLike}`,
      Prisma.sql`REPLACE(LOWER(COALESCE(ai.search_text, '')), ' ', '') LIKE ${pattern.compactLike}`,
    ]),
  ]

  const communityClauses = (options?.communities ?? [])
    .map((community) => {
      const provinceCode = (normalizeProvinceCode(community.provinceCode) ?? community.provinceCode).toLowerCase()
      const communitySlug = community.communitySlug.trim().toLowerCase()
      if (!provinceCode || !communitySlug) return null
      return Prisma.sql`(
        LOWER(COALESCE(l.listing_province_code, l.pickup_province, '')) = ${provinceCode}
        AND LOWER(COALESCE(l.listing_community_slug, '')) = ${communitySlug}
      )`
    })
    .filter((clause): clause is Prisma.Sql => Boolean(clause))

  const provinceCodes = Array.from(
    new Set(
      (options?.provinceCodes ?? [])
        .map((provinceCode) => (normalizeProvinceCode(provinceCode) ?? provinceCode).toLowerCase())
        .filter(Boolean),
    ),
  )

  const scopeClause = communityClauses.length
    ? Prisma.sql`AND (${Prisma.join(communityClauses, ' OR ')})`
    : provinceCodes.length
      ? Prisma.sql`AND LOWER(COALESCE(l.listing_province_code, l.pickup_province, '')) IN (${Prisma.join(provinceCodes)})`
      : Prisma.empty

  const rows: MarketSearchRow[] = await prisma.$queryRaw(Prisma.sql`
    SELECT
      l.id,
      l.title,
      l.description,
      l.price_cents,
      l.currency,
      l.photo_urls,
      l.pickup_city,
      l.pickup_province,
      l.created_at,
      ai.search_text AS ai_search_text
    FROM citizen_market_listing l
    LEFT JOIN content_ai_scan ai
      ON ai.target_type = ${'market_listing'}
      AND ai.target_id = l.id
      AND ai.status = ${'completed'}
    WHERE l.is_active = TRUE
      AND l.is_draft = FALSE
      AND LOWER(l.status) = 'active'
      ${scopeClause}
      AND (${Prisma.join(searchClauses, ' OR ')})
    ORDER BY l.created_at DESC
    LIMIT ${Math.max(limit * 8, 48)}
  `)

  const ranked: Array<{ item: MarketSearchResultPayload; score: number; createdAt: number }> = rows
    .map((row: MarketSearchRow) => {
      const gallery = readGalleryUrls(row.photo_urls)
      return {
        item: {
          id: row.id,
          title: truncatePreviewText(row.title || 'Marketplace item', 120) || 'Marketplace item',
          description: truncatePreviewText(stripHtmlToPlainText(row.description ?? ''), 180) || null,
          imageUrl: gallery[0] ?? null,
          priceLabel: formatMarketplacePrice(Number(row.price_cents) || 0, row.currency || 'CAD'),
          locationLabel: [row.pickup_city, row.pickup_province].filter(Boolean).join(', ') || null,
          href: `/market/listings/${encodeURIComponent(row.id)}`,
        } satisfies MarketSearchResultPayload,
        score: scoreSearchTextMatch(buildSearchableText(row.title, row.description, row.ai_search_text), normalizedQuery),
        createdAt: row.created_at.getTime(),
      }
    })
    .filter((entry) => entry.score > 0)

  ranked.sort((a: { item: MarketSearchResultPayload; score: number; createdAt: number }, b: { item: MarketSearchResultPayload; score: number; createdAt: number }) => {
    const scoreDelta = b.score - a.score
    if (scoreDelta !== 0) return scoreDelta
    return b.createdAt - a.createdAt
  })

  return ranked.slice(0, limit).map((entry: { item: MarketSearchResultPayload; score: number; createdAt: number }) => entry.item)
}

async function searchCommunityPostsForQuery(query: string, limit: number): Promise<PostSearchResultPayload[]> {
  const normalizedQuery = normalizeSearchTerm(query)
  if (!normalizedQuery) return []

  const tokens = normalizedQuery.split(' ').filter(Boolean)
  const insensitiveMode = Prisma.QueryMode.insensitive
  const buildContains = (field: 'title' | 'body'): Prisma.PostWhereInput => {
    if (!tokens.length) {
      return {
        [field]: {
          contains: normalizedQuery,
          mode: insensitiveMode,
        },
      }
    }
    return {
      AND: tokens.map(
        (token) =>
          ({
            [field]: {
              contains: token,
              mode: insensitiveMode,
            },
          }) as Prisma.PostWhereInput,
      ),
    }
  }

  type SearchPostRow = Prisma.PostGetPayload<{
    include: {
      author: true
      business: true
    }
  }>

  const posts: SearchPostRow[] = await prisma.post.findMany({
    where: {
      type: { not: FAMILY_FEED_POST_TYPE },
      visibility: 'public',
      provinceCode: { not: null },
      communitySlug: { not: null },
      OR: [
        buildContains('title'),
        buildContains('body'),
        {
          author: {
            OR: [
              { name: { contains: normalizedQuery, mode: insensitiveMode } },
              { handle: { contains: normalizedQuery.replace(/^@/, ''), mode: insensitiveMode } },
            ],
          },
        },
        {
          business: {
            name: { contains: normalizedQuery, mode: insensitiveMode },
          },
        },
      ],
    },
    orderBy: [{ createdAt: 'desc' }],
    take: Math.max(limit * 4, 24),
    include: {
      author: true,
      business: true,
    },
  })

  const ranked: Array<{ item: PostSearchResultPayload; score: number; createdAt: number }> = posts
    .map((post: SearchPostRow) => {
      const formatted = formatPost(post as any)
      const href = getCanonicalPaths(post as any).community
      if (!href) return null
      return {
        item: {
          id: post.id,
          title: formatted.title,
          excerpt: truncatePreviewText(stripHtmlToPlainText(post.body ?? ''), 200) || null,
          imageUrl: formatted.images?.[0] ?? formatted.mediaUrl ?? formatted.organization?.coverUrl ?? formatted.organization?.logoUrl ?? null,
          communityName: formatted.communityName,
          provinceName: formatted.provinceName,
          author: {
            handle: formatted.author.handle,
            name: formatted.author.name,
            avatarUrl: formatted.author.avatarUrl,
          },
          organization: formatted.organization
            ? {
                name: formatted.organization.name,
                slug: formatted.organization.slug,
                logoUrl: formatted.organization.logoUrl,
                isVerified: formatted.organization.isVerified,
              }
            : null,
          href,
        } satisfies PostSearchResultPayload,
        score: scoreSearchTextMatch(
          buildSearchableText(post.title, stripHtmlToPlainText(post.body ?? ''), post.author.name, post.author.handle, post.business?.name),
          normalizedQuery,
        ),
        createdAt: post.createdAt.getTime(),
      }
    })
    .filter((entry): entry is { item: PostSearchResultPayload; score: number; createdAt: number } => Boolean(entry))

  ranked.sort((a: { item: PostSearchResultPayload; score: number; createdAt: number }, b: { item: PostSearchResultPayload; score: number; createdAt: number }) => {
    const scoreDelta = b.score - a.score
    if (scoreDelta !== 0) return scoreDelta
    return b.createdAt - a.createdAt
  })

  return ranked.slice(0, limit).map((entry: { item: PostSearchResultPayload; score: number; createdAt: number }) => entry.item)
}

async function loadAuthenticatedUser(req: FastifyRequest) {
  const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
  if (!payload?.sub || payload.actor === 'family_member') return null
  return loadActiveAuthUserById(payload.sub)
}

type FamilyAuthMember = NonNullable<Awaited<ReturnType<typeof loadFamilyMemberAuthViewerById>>>

type ViewerAuthContext =
  | { actor: 'user'; userId: string }
  | { actor: 'family_member'; member: FamilyAuthMember }

async function loadViewerAuthContext(req: FastifyRequest): Promise<ViewerAuthContext | null> {
  try {
    const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
    if (!payload?.sub || typeof payload.sub !== 'string') return null

    if (payload.actor === 'family_member') {
      const member = await loadFamilyMemberAuthViewerById(payload.sub, payload.parentId ?? null)
      if (!member) return null
      return { actor: 'family_member', member }
    }

    const user = await loadActiveAuthUserById(payload.sub)
    if (!user) return null
    return { actor: 'user', userId: user.id }
  } catch {
    return null
  }
}

function familyMemberOwnsAssetForSession(asset: { metadata?: Prisma.JsonValue | null }, memberId: string) {
  const metadata = asset.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  return typeof (metadata as Record<string, unknown>).familyMemberId === 'string' && (metadata as Record<string, unknown>).familyMemberId === memberId
}

async function resolveUserId(req: FastifyRequest): Promise<string | null> {
  const existing = (req as any).user?.id
  if (typeof existing === 'string' && existing) return existing

  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null

  try {
    const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
    if (payload?.sub && typeof payload.sub === 'string' && payload.actor !== 'family_member') {
      const user = await loadActiveAuthUserById(payload.sub)
      return user?.id ?? null
    }
  } catch {
    // ignore
  }
  return null
}

async function resolveActingUserId(req: FastifyRequest): Promise<string | null> {
  const authContext = await loadViewerAuthContext(req)
  if (!authContext) return null
  return authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId
}

type ViewerBlockState = {
  blockedUserIds: Set<string>
  blockedBusinessIds: Set<string>
}

async function loadViewerBlockState(userId: string | null | undefined): Promise<ViewerBlockState> {
  if (!userId) {
    return {
      blockedUserIds: new Set<string>(),
      blockedBusinessIds: new Set<string>(),
    }
  }

  const [userBlocks, businessBlocks] = await Promise.all([
    prisma.userBlock.findMany({
      where: { blockerUserId: userId },
      select: { blockedUserId: true },
    }),
    prisma.businessBlock.findMany({
      where: { blockerUserId: userId },
      select: { blockedBusinessId: true },
    }),
  ])

  return {
    blockedUserIds: new Set(userBlocks.map((row: { blockedUserId: string }) => row.blockedUserId)),
    blockedBusinessIds: new Set(businessBlocks.map((row: { blockedBusinessId: string }) => row.blockedBusinessId)),
  }
}

function appendWhereAndClause<T extends { AND?: unknown }>(where: T, clause: unknown): T {
  const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []
  ;(where as T & { AND: unknown[] }).AND = [...existingAnd, clause]
  return where
}

function applyViewerBlockFiltersToPostWhere(where: Prisma.PostWhereInput, blockState: ViewerBlockState) {
  const blockedUserIds = Array.from(blockState.blockedUserIds)
  const blockedBusinessIds = Array.from(blockState.blockedBusinessIds)
  if (blockedUserIds.length) {
    appendWhereAndClause(where, { authorId: { notIn: blockedUserIds } })
  }
  if (blockedBusinessIds.length) {
    appendWhereAndClause(where, {
      OR: [
        { businessId: null },
        { businessId: { notIn: blockedBusinessIds } },
      ],
    })
  }
  return where
}

function applyVisibleModerationFiltersToPostWhere(where: Prisma.PostWhereInput, blockState?: ViewerBlockState) {
  where.moderationStatus = ModerationStatus.VISIBLE
  appendWhereAndClause(where, {
    OR: [
      { businessId: null },
      { business: { moderationStatus: ModerationStatus.VISIBLE } },
    ],
  })
  if (blockState) {
    applyViewerBlockFiltersToPostWhere(where, blockState)
  }
  return where
}

function applyViewerBlockFiltersToBusinessWhere(where: Prisma.BusinessWhereInput, blockState: ViewerBlockState) {
  const blockedBusinessIds = Array.from(blockState.blockedBusinessIds)
  if (blockedBusinessIds.length) {
    appendWhereAndClause(where, { id: { notIn: blockedBusinessIds } })
  }
  return where
}

function applyVisibleModerationFiltersToBusinessWhere(where: Prisma.BusinessWhereInput, blockState?: ViewerBlockState) {
  where.moderationStatus = ModerationStatus.VISIBLE
  if (blockState) {
    applyViewerBlockFiltersToBusinessWhere(where, blockState)
  }
  return where
}

function isAuthorOrBusinessBlocked(
  blockState: ViewerBlockState,
  args: {
    authorId?: string | null
    businessId?: string | null
  },
) {
  if (args.authorId && blockState.blockedUserIds.has(args.authorId)) return true
  if (args.businessId && blockState.blockedBusinessIds.has(args.businessId)) return true
  return false
}

function isMissingPostBusinessAuthorColumnError(err: unknown): boolean {
  const detail = schemaOutOfDateDetail(err)
  const haystack = [detail.prismaMetaMessage, detail.message].filter(Boolean).join(' ')
  return /showBusinessAuthor/i.test(haystack) && /Post/i.test(haystack)
}

function isVisibleModerationStatus(value: string | null | undefined) {
  return String(value ?? '').toUpperCase() === 'VISIBLE'
}

function isPostHiddenFromViewer(
  post: {
    moderationStatus: ModerationStatus
    authorId: string
    businessId: string | null
  },
  blockState: ViewerBlockState,
) {
  if (post.moderationStatus !== ModerationStatus.VISIBLE) return true
  return isAuthorOrBusinessBlocked(blockState, {
    authorId: post.authorId,
    businessId: post.businessId,
  })
}

function isBusinessHiddenFromViewer(
  business: {
    id: string
    moderationStatus?: ModerationStatus | null
  },
  blockState: ViewerBlockState,
) {
  if (business.moderationStatus !== ModerationStatus.VISIBLE) return true
  return blockState.blockedBusinessIds.has(business.id)
}

function moderationLockedErrorCode(targetType: ModerationTargetType | 'POST' | 'COMMENT' | 'ORGANIZATION' | 'MARKET_LISTING' | 'MARKET_PRODUCT') {
  switch (targetType) {
    case ModerationTargetType.POST:
    case 'POST':
      return 'post_quarantined'
    case ModerationTargetType.COMMENT:
    case 'COMMENT':
      return 'comment_quarantined'
    case ModerationTargetType.ORGANIZATION:
    case 'ORGANIZATION':
      return 'organization_quarantined'
    case ModerationTargetType.MARKET_LISTING:
    case 'MARKET_LISTING':
      return 'listing_quarantined'
    case ModerationTargetType.MARKET_PRODUCT:
    case 'MARKET_PRODUCT':
      return 'product_quarantined'
    default:
      return 'content_quarantined'
  }
}

type ResolvedModerationTarget = {
  targetType: ModerationTargetType
  targetId: string
  targetLabel: string
  targetUrl: string | null
  reportedUserId: string | null
  reportedBusinessId: string | null
}

async function resolveModerationTarget(targetType: ModerationTargetType, targetId: string): Promise<ResolvedModerationTarget | null> {
  if (targetType === ModerationTargetType.POST) {
    const post = await prisma.post.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        title: true,
        body: true,
        seoSlug: true,
        authorId: true,
        businessId: true,
        provinceCode: true,
        communitySlug: true,
        business: {
          select: {
            id: true,
            name: true,
            slug: true,
            provinceCode: true,
            communitySlug: true,
          },
        },
        author: {
          select: {
            handle: true,
          },
        },
      },
    })
    if (!post) return null

    const fallbackSlug = post.seoSlug ?? post.id
    const targetUrl =
      post.business && post.business.provinceCode && post.business.communitySlug
        ? `/c/${post.business.provinceCode.toLowerCase()}/${post.business.communitySlug.toLowerCase()}/posts/${fallbackSlug}`
        : post.provinceCode && post.communitySlug
          ? `/c/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}/posts/${fallbackSlug}`
          : `/u/${post.author.handle}/posts/${fallbackSlug}`

    return {
      targetType,
      targetId: post.id,
      targetLabel: (post.title?.trim() || sanitizePlainText(post.body).slice(0, 120) || 'Untitled post').trim(),
      targetUrl,
      reportedUserId: post.authorId,
      reportedBusinessId: post.businessId ?? null,
    }
  }

  if (targetType === ModerationTargetType.COMMENT) {
    const comment = await prisma.comment.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        body: true,
        userId: true,
        post: {
          select: {
            id: true,
            seoSlug: true,
            provinceCode: true,
            communitySlug: true,
            business: {
              select: {
                provinceCode: true,
                communitySlug: true,
              },
            },
            author: {
              select: {
                handle: true,
              },
            },
          },
        },
      },
    })
    if (!comment) return null

    const postUrl = buildPostHrefForAdmin(comment.post)

    return {
      targetType,
      targetId: comment.id,
      targetLabel: sanitizePlainText(comment.body).slice(0, 120).trim() || 'Comment',
      targetUrl: postUrl ? `${postUrl}?comment=${encodeURIComponent(comment.id)}#comment-${comment.id}` : null,
      reportedUserId: comment.userId,
      reportedBusinessId: null,
    }
  }

  if (targetType === ModerationTargetType.ORGANIZATION) {
    const org = await prisma.business.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        name: true,
        slug: true,
        ownerId: true,
        provinceCode: true,
        communitySlug: true,
      },
    })
    if (!org) return null

    const targetUrl =
      org.provinceCode && org.communitySlug
        ? `/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`
        : null

    return {
      targetType,
      targetId: org.id,
      targetLabel: org.name,
      targetUrl,
      reportedUserId: org.ownerId,
      reportedBusinessId: org.id,
    }
  }

  if (targetType === ModerationTargetType.MARKET_LISTING) {
    await ensureCitizenMarketplaceTables()
    const rows = await prisma.$queryRaw<
      Array<{
        id: string
        title: string
        seller_user_id: string
      }>
    >`
      SELECT id, title, seller_user_id
      FROM citizen_market_listing
      WHERE id = ${targetId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null

    return {
      targetType,
      targetId: row.id,
      targetLabel: row.title,
      targetUrl: `/market/listings/${encodeURIComponent(row.id)}`,
      reportedUserId: row.seller_user_id,
      reportedBusinessId: null,
    }
  }

  if (targetType === ModerationTargetType.MARKET_PRODUCT) {
    await ensureOrganizationShopTables()
    const rows = await prisma.$queryRaw<
      Array<{
        id: string
        name: string
        business_id: string
        business_name: string
        business_slug: string
        province_code: string | null
        community_slug: string | null
      }>
    >`
      SELECT
        p.id,
        p.name,
        p.business_id,
        b.name AS business_name,
        b.slug AS business_slug,
        b."provinceCode" AS province_code,
        b."communitySlug" AS community_slug
      FROM organization_shop_product p
      INNER JOIN "Business" b ON b.id = p.business_id
      WHERE p.id = ${targetId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null

    const targetUrl =
      row.province_code && row.community_slug && row.business_slug
        ? `/com/${row.province_code.toLowerCase()}/${row.community_slug.toLowerCase()}/orgs/${row.business_slug}/shop?product=${encodeURIComponent(row.id)}`
        : `/market/products/${encodeURIComponent(row.id)}`

    return {
      targetType,
      targetId: row.id,
      targetLabel: row.name,
      targetUrl,
      reportedUserId: null,
      reportedBusinessId: row.business_id,
    }
  }

  return null
}

function buildCommunityHref(provinceCode?: string | null, communitySlug?: string | null) {
  if (!provinceCode || !communitySlug) return null
  return `/${provinceCode.toLowerCase()}/${communitySlug.toLowerCase()}`
}

function buildBusinessHrefForAdmin(business?: { provinceCode?: string | null; communitySlug?: string | null; slug?: string | null } | null) {
  if (!business?.provinceCode || !business.communitySlug || !business.slug) return null
  return `/com/${business.provinceCode.toLowerCase()}/${business.communitySlug.toLowerCase()}/orgs/${business.slug}`
}

function buildPostHrefForAdmin(post: {
  id: string
  seoSlug?: string | null
  provinceCode?: string | null
  communitySlug?: string | null
  author?: { handle?: string | null } | null
  business?: { provinceCode?: string | null; communitySlug?: string | null } | null
}) {
  const slug = post.seoSlug ?? post.id
  if (post.business?.provinceCode && post.business.communitySlug) {
    return `/c/${post.business.provinceCode.toLowerCase()}/${post.business.communitySlug.toLowerCase()}/posts/${slug}`
  }
  if (post.provinceCode && post.communitySlug) {
    return `/c/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}/posts/${slug}`
  }
  if (post.author?.handle) {
    return `/u/${post.author.handle}/posts/${slug}`
  }
  return null
}

function summarizeReportReasons(reports: Array<{ reasons: string[]; status: ContentReportStatus; createdAt: Date }>) {
  const reasonSet = new Set<string>()
  let openCount = 0
  let reviewedCount = 0
  let latestReportedAt: string | null = null

  reports.forEach((report) => {
    report.reasons.forEach((reason) => reasonSet.add(reason))
    if (report.status === ContentReportStatus.OPEN) openCount += 1
    if (report.status === ContentReportStatus.REVIEWED) reviewedCount += 1
    if (!latestReportedAt || report.createdAt.toISOString() > latestReportedAt) {
      latestReportedAt = report.createdAt.toISOString()
    }
  })

  return {
    count: reports.length,
    reasons: Array.from(reasonSet),
    openCount,
    reviewedCount,
    latestReportedAt,
  }
}

function formatAdminUserSummary(user: {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
}) {
  return {
    id: user.id,
    handle: user.handle,
    name: user.name,
    avatarUrl: normalizeMediaUrl(user.avatarUrl ?? null),
    coverUrl: normalizeMediaUrl(user.coverUrl ?? null),
  }
}

function formatCommunityFollowLabel(community: { provinceCode: string; communitySlug: string; home?: boolean | null }) {
  const base = `${community.provinceCode.toUpperCase()} / ${community.communitySlug}`
  return community.home ? `${base} (home)` : base
}

function buildAdminUserSearchWhere(search: string): Prisma.UserWhereInput {
  const normalizedQuery = normalizeSearchTerm(search)
  const tokens = normalizedQuery.split(' ').filter(Boolean)
  const normalizedHandle = normalizedQuery.replace(/^@/, '')

  return {
    OR: [
      tokens.length
        ? {
            AND: tokens.map((token) => ({ name: { contains: token, mode: 'insensitive' as const } })),
          }
        : { name: { contains: normalizedQuery, mode: 'insensitive' as const } },
      { handle: { contains: normalizedHandle, mode: 'insensitive' as const } },
      { email: { contains: normalizedQuery, mode: 'insensitive' as const } },
    ],
  }
}

async function applyModerationQuarantine(
  tx: Prisma.TransactionClient,
  targetType: ModerationTargetType,
  targetId: string,
) {
  if (targetType === ModerationTargetType.POST) {
    await tx.post.updateMany({
      where: { id: targetId },
      data: { moderationStatus: ModerationStatus.QUARANTINED },
    })
    return
  }

  if (targetType === ModerationTargetType.COMMENT) {
    const existing = await tx.comment.findFirst({
      where: { id: targetId },
      select: {
        postId: true,
        post: {
          select: {
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    })

    await tx.comment.updateMany({
      where: { id: targetId },
      data: { moderationStatus: ModerationStatus.QUARANTINED },
    })

    if (existing?.postId && existing.post) {
      await refreshPostAggregates(tx, existing.postId, { createdAt: existing.post.createdAt, lastActivityAt: existing.post.updatedAt }, { bumpActivity: false })
    }
    return
  }

  if (targetType === ModerationTargetType.ORGANIZATION) {
    await tx.business.updateMany({
      where: { id: targetId },
      data: { moderationStatus: ModerationStatus.QUARANTINED },
    })
    return
  }

  if (targetType === ModerationTargetType.MARKET_LISTING) {
    await tx.$executeRaw`
      UPDATE citizen_market_listing
      SET moderation_status = ${'quarantined'},
          is_draft = TRUE,
          updated_at = NOW()
      WHERE id = ${targetId}
    `
    return
  }

  if (targetType === ModerationTargetType.MARKET_PRODUCT) {
    await tx.$executeRaw`
      UPDATE organization_shop_product
      SET moderation_status = ${'quarantined'},
          is_draft = TRUE,
          updated_at = NOW()
      WHERE id = ${targetId}
    `
  }
}

async function createModerationReportAndQuarantine(
  tx: Prisma.TransactionClient,
  args: {
    reporterUserId: string
    target: ResolvedModerationTarget
    reasons: Array<(typeof ModerationReportReasonValues)[number]>
    details: string | null
    quarantineAppliedAt?: Date
  },
) {
  const quarantineAppliedAt = args.quarantineAppliedAt ?? new Date()

  const report = await tx.contentReport.create({
    data: {
      reporterUserId: args.reporterUserId,
      targetType: args.target.targetType,
      targetId: args.target.targetId,
      targetLabel: args.target.targetLabel,
      targetUrl: args.target.targetUrl,
      reportedUserId: args.target.reportedUserId,
      reportedBusinessId: args.target.reportedBusinessId,
      reasons: args.reasons,
      details: args.details,
      status: ContentReportStatus.OPEN,
      quarantineAppliedAt,
    },
    select: { id: true },
  })

  await applyModerationQuarantine(tx, args.target.targetType, args.target.targetId)
  return report
}

function buildModerationSuspensionReason(args: {
  reportId: string
  targetType: ModerationTargetType
  targetId: string
}) {
  return `Suspended after moderation review for ${args.targetType.toLowerCase()} ${args.targetId} on report ${args.reportId}.`
}

async function suspendUserForModeration(
  tx: Prisma.TransactionClient,
  args: {
    userId: string
    suspendedByUserId: string
    sourceReportId: string
    reason: string
  },
) {
  const user = await tx.user.findUnique({
    where: { id: args.userId },
    select: { communityMeta: true },
  })
  if (!user) return false

  const baseMeta = readBaseCommunityMeta(user.communityMeta)
  const currentModeration =
    baseMeta.accountModeration && typeof baseMeta.accountModeration === 'object' && !Array.isArray(baseMeta.accountModeration)
      ? ({ ...(baseMeta.accountModeration as Record<string, unknown>) } as Record<string, unknown>)
      : {}
  currentModeration.status = 'SUSPENDED'
  currentModeration.suspendedAt = new Date().toISOString()
  currentModeration.suspendedByUserId = args.suspendedByUserId
  currentModeration.suspensionReason = args.reason
  currentModeration.sourceReportId = args.sourceReportId
  baseMeta.accountModeration = currentModeration

  const affectedComments = await tx.comment.findMany({
    where: { userId: args.userId, moderationStatus: ModerationStatus.VISIBLE },
    select: {
      postId: true,
      post: {
        select: {
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })

  await Promise.all([
    tx.user.update({
      where: { id: args.userId },
      data: { communityMeta: baseMeta as Prisma.InputJsonValue },
    }),
    tx.post.updateMany({
      where: { authorId: args.userId },
      data: { moderationStatus: ModerationStatus.QUARANTINED },
    }),
    tx.comment.updateMany({
      where: { userId: args.userId },
      data: { moderationStatus: ModerationStatus.QUARANTINED },
    }),
  ])

  const affectedPosts = new Map<string, { createdAt: Date; lastActivityAt: Date }>()
  for (const comment of affectedComments) {
    if (!comment.post || affectedPosts.has(comment.postId)) continue
    affectedPosts.set(comment.postId, {
      createdAt: comment.post.createdAt,
      lastActivityAt: comment.post.updatedAt,
    })
  }

  for (const [postId, aggregateState] of affectedPosts) {
    await refreshPostAggregates(tx, postId, aggregateState, { bumpActivity: false })
  }

  return true
}

async function suspendBusinessForModeration(
  tx: Prisma.TransactionClient,
  args: {
    businessId: string
  },
) {
  const updated = await tx.business.updateMany({
    where: { id: args.businessId },
    data: {
      status: BusinessStatus.SUSPENDED,
      moderationStatus: ModerationStatus.QUARANTINED,
    },
  })

  await tx.post.updateMany({
    where: { businessId: args.businessId },
    data: { moderationStatus: ModerationStatus.QUARANTINED },
  })

  return updated.count > 0
}

function hashMeetingPassword(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

async function issueMeetingRtcSession(args: {
  roomId: string
  userId: string
  role: 'manager' | 'participant'
  displayName: string
  deviceId: string | null
  capabilities: {
    audio?: boolean
    video?: boolean
  } | null
}) {
  if (!MEETING_RTC_SERVICE_URL) return { error: 'meeting_rtc_not_configured' as const }

  const timeoutMs =
    Number.isFinite(MEETING_RTC_REQUEST_TIMEOUT_MS) && MEETING_RTC_REQUEST_TIMEOUT_MS > 0
      ? Math.floor(MEETING_RTC_REQUEST_TIMEOUT_MS)
      : 8000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${MEETING_RTC_SERVICE_URL}/v1/rooms/${encodeURIComponent(args.roomId)}/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(MEETING_RTC_SERVICE_SECRET ? { 'x-meeting-rtc-secret': MEETING_RTC_SERVICE_SECRET } : {}),
      },
      body: JSON.stringify({
        userId: args.userId,
        role: args.role,
        displayName: args.displayName,
        deviceId: args.deviceId,
        capabilities: args.capabilities ?? undefined,
      }),
      signal: controller.signal,
    })

    const text = await response.text().catch(() => '')
    let json: any = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }

    if (!response.ok) {
      return {
        error: (json && typeof json.error === 'string' ? json.error : 'meeting_rtc_service_error') as string,
        statusCode: response.status,
      }
    }

    return { session: json ?? {} }
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === 'AbortError'
    return { error: aborted ? 'meeting_rtc_timeout' : 'meeting_rtc_unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

async function readMeetingRtcRoomState(
  roomId: string,
): Promise<{ peerCount: number; hostPresent: boolean; peers: Array<{ peerId: string; userId: string; displayName: string; role: string }> } | null> {
  if (!MEETING_RTC_SERVICE_URL) return null

  const timeoutMs =
    Number.isFinite(MEETING_RTC_REQUEST_TIMEOUT_MS) && MEETING_RTC_REQUEST_TIMEOUT_MS > 0
      ? Math.floor(MEETING_RTC_REQUEST_TIMEOUT_MS)
      : 8000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${MEETING_RTC_SERVICE_URL}/v1/rooms/${encodeURIComponent(roomId)}/state`, {
      method: 'GET',
      headers: {
        ...(MEETING_RTC_SERVICE_SECRET ? { 'x-meeting-rtc-secret': MEETING_RTC_SERVICE_SECRET } : {}),
      },
      signal: controller.signal,
    })
    if (!response.ok) return null

    const text = await response.text().catch(() => '')
    if (!text) return null

    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      return null
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null

    const rawPeers: unknown[] = Array.isArray(json.peers) ? json.peers : []
    const peers = rawPeers
      .filter((entry: unknown): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
      .map((typed: Record<string, unknown>) => {
        return {
          peerId: typeof typed.peerId === 'string' ? typed.peerId : '',
          userId: typeof typed.userId === 'string' ? typed.userId : '',
          displayName: typeof typed.displayName === 'string' ? typed.displayName : '',
          role: typeof typed.role === 'string' ? typed.role : 'participant',
        }
      })
      .filter((entry: { peerId: string; userId: string }) => Boolean(entry.peerId && entry.userId))

    const peerCount = Number.isFinite(Number(json.peerCount)) ? Math.max(0, Number(json.peerCount)) : peers.length
    const hostPresent = peers.some((entry: { role: string }) => entry.role === 'manager')
    return { peerCount, hostPresent, peers }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function withSchemaGuard<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  action: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await action()
  } catch (err) {
    if (isMissingPostBusinessAuthorColumnError(err)) {
      try {
        await ensurePostBusinessAuthorColumn()
        return await action()
      } catch (repairErr) {
        if (!isSchemaOutOfDateError(repairErr)) throw repairErr
        err = repairErr
      }
    }

    if (isSchemaOutOfDateError(err)) {
      req.log.error({ err }, 'database schema out of date for social features')
      const payload: Record<string, unknown> = { error: 'schema_out_of_date', message: SCHEMA_MISMATCH_MESSAGE }
      if (process.env.NODE_ENV !== 'production') {
        payload.detail = schemaOutOfDateDetail(err)
      }
      return reply.code(503).send(payload)
    }
    throw err
  }
}

function ensureMimeSupported(mime: string) {
  return IMAGE_MIME_TYPES.has(mime.toLowerCase())
}

function extensionForMime(mime: string) {
  return MIME_EXTENSION_MAP[mime.toLowerCase()] || 'bin'
}

function buildOriginalObjectKey(category: MediaCategory, userId: string, assetId: string, extension: string) {
  return `raw/${category}/${userId}/${assetId}/original.${extension}`
}

async function readRequestBuffer(req: FastifyRequest): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req.raw as any as AsyncIterable<Buffer | Uint8Array | string>) {
    if (!chunk) continue
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk)
    } else if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk))
    } else {
      chunks.push(Buffer.from(chunk))
    }
  }
  return Buffer.concat(chunks)
}

function extractVariantUrl(variants: unknown, preferred: string[]): string | null {
  if (!variants || typeof variants !== 'object') return null
  for (const name of preferred) {
    const value = (variants as Record<string, any>)[name]
    if (value && typeof value.url === 'string') {
      return normalizeMediaUrl(value.url)
    }
  }
  return null
}

type PostStatsInput = {
  positiveReactions: number
  supportReactions: number
  recentPositive: number
  commentCount: number
  commentScore: number
  createdAt: Date
  lastActivityAt: Date
}

function calculateHotScore({ recentPositive, commentCount, commentScore, createdAt, lastActivityAt }: PostStatsInput) {
  const discussionWeight = Math.min(commentCount, 50)
  const commentScoreWeight = Math.max(Math.min(commentScore / 4, 75), -75)
  const interactionScore = recentPositive + discussionWeight + commentScoreWeight
  const order = Math.log10(Math.max(Math.abs(interactionScore), 1))
  const baseTime = Math.max(createdAt.getTime(), lastActivityAt.getTime())
  const seconds = baseTime / 1000 - REDDIT_EPOCH_SECONDS
  return Number((seconds + order).toFixed(6))
}

async function refreshPostAggregates(
  tx: Prisma.TransactionClient,
  postId: string,
  times: { createdAt: Date; lastActivityAt: Date },
  options: { bumpActivity?: boolean } = {},
) {
  const reactionWindowStart = new Date(Date.now() - REACTION_HOT_WINDOW_HOURS * 60 * 60 * 1000)

  const [reactionRows, recentPositive, commentCount, commentScoreResult] = await Promise.all([
    tx.postReaction.groupBy({
      by: ['type'],
      where: { postId },
      _count: { _all: true },
    }),
    tx.postReaction.count({
      where: {
        postId,
        createdAt: { gte: reactionWindowStart },
      },
    }),
    tx.comment.count({ where: { postId, moderationStatus: ModerationStatus.VISIBLE } }),
    tx.comment.aggregate({ where: { postId, moderationStatus: ModerationStatus.VISIBLE }, _sum: { score: true } }),
  ])

  const reactionCounts = {
    maple: 0,
    heart: 0,
    haha: 0,
    wow: 0,
    sad: 0,
    fire: 0,
  }
  for (const row of reactionRows) {
    const count = Number(row?._count?._all ?? 0)
    if (row.type === PrismaReactionType.maple) reactionCounts.maple = count
    else if (row.type === PrismaReactionType.heart) reactionCounts.heart = count
    else if (row.type === PrismaReactionType.haha) reactionCounts.haha = count
    else if (row.type === PrismaReactionType.wow) reactionCounts.wow = count
    else if (row.type === PrismaReactionType.sad) reactionCounts.sad = count
    else if (row.type === PrismaReactionType.fire) reactionCounts.fire = count
  }

  const reactionTotal =
    reactionCounts.maple +
    reactionCounts.heart +
    reactionCounts.haha +
    reactionCounts.wow +
    reactionCounts.sad +
    reactionCounts.fire

  const upvotes = reactionTotal
  const downvotes = 0
  const score = reactionTotal
  const positiveReactions = reactionTotal
  const supportReactions = reactionCounts.heart + reactionCounts.wow + reactionCounts.fire
  const commentScore = commentScoreResult?._sum?.score ?? 0

  const nextLastActivityAt = options.bumpActivity ? new Date() : times.lastActivityAt
  const hotScore = calculateHotScore({
    positiveReactions,
    supportReactions,
    recentPositive,
    commentCount,
    commentScore,
    createdAt: times.createdAt,
    lastActivityAt: nextLastActivityAt,
  })

  await tx.post.update({
    where: { id: postId },
    data: {
      upvotes,
      downvotes,
      score,
      commentCount,
      hotScore,
      recentPositive,
      reactionMaple: reactionCounts.maple,
      reactionHeart: reactionCounts.heart,
      reactionHaha: reactionCounts.haha,
      reactionWow: reactionCounts.wow,
      reactionSad: reactionCounts.sad,
      reactionFire: reactionCounts.fire,
      reactionTotal,
      lastActivityAt: nextLastActivityAt,
    },
  })

  return {
    upvotes,
    downvotes,
    score,
    commentCount,
    commentScore,
    recentPositive,
    reactionMaple: reactionCounts.maple,
    reactionHeart: reactionCounts.heart,
    reactionHaha: reactionCounts.haha,
    reactionWow: reactionCounts.wow,
    reactionSad: reactionCounts.sad,
    reactionFire: reactionCounts.fire,
    reactionTotal,
    lastActivityAt: nextLastActivityAt,
  }
}

async function refreshCommentAggregates(tx: Prisma.TransactionClient, commentId: string) {
  const [upvotes, downvotes] = await Promise.all([
    tx.commentVote.count({ where: { commentId, value: 1 } }),
    tx.commentVote.count({ where: { commentId, value: -1 } }),
  ])
  const score = upvotes - downvotes
  await tx.comment.update({
    where: { id: commentId },
    data: {
      upvotes,
      downvotes,
      score,
    },
  })
  return { upvotes, downvotes, score }
}

type CommentWithUser = Prisma.CommentGetPayload<{
  include: {
    user: {
      select: {
        id: true
        handle: true
        name: true
        avatarUrl: true
        coverUrl: true
        premiumStatus: true
        communityMeta: true
      }
    }
  }
}>

type CommentNode = {
  id: string
  postId: string
  parentId: string | null
  body: string
  createdAt: Date
  updatedAt: Date
  upvotes: number
  downvotes: number
  score: number
  viewerVote: number | null
  hotScore: number
  author: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
    isPremium: boolean
    isVerified: boolean
  }
  replies: CommentNode[]
}

function filterCommentRowsForViewer(commentRows: CommentWithUser[], blockState: ViewerBlockState) {
  if (!commentRows.length || blockState.blockedUserIds.size === 0) return commentRows
  return commentRows.filter((comment) => !blockState.blockedUserIds.has(comment.userId))
}

function calculateCommentHotScore({
  upvotes,
  replyCount,
  replyScore,
  createdAt,
  updatedAt,
}: {
  upvotes: number
  replyCount: number
  replyScore: number
  createdAt: Date
  updatedAt: Date
}) {
  return calculateHotScore({
    positiveReactions: upvotes,
    supportReactions: 0,
    recentPositive: upvotes,
    commentCount: replyCount,
    commentScore: replyScore,
    createdAt,
    lastActivityAt: updatedAt,
  })
}

function attachCommentHotScore(node: CommentNode, stats?: { replyCount?: number; replyScore?: number }) {
  const replyCount = stats?.replyCount ?? node.replies.length
  const replyScore = stats?.replyScore ?? node.replies.reduce((total, child) => total + child.score, 0)
  node.hotScore = calculateCommentHotScore({
    upvotes: node.upvotes,
    replyCount,
    replyScore,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  })
  return node
}

function mapComment(row: CommentWithUser, viewerVote: number | null = null): CommentNode {
  return {
    id: row.id,
    postId: row.postId,
    parentId: row.parentId ?? null,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    score: row.score,
    viewerVote,
    hotScore: 0,
    author: {
      id: row.user.id,
      handle: row.user.handle,
      name: row.user.name ?? null,
      avatarUrl: normalizeMediaUrl(row.user.avatarUrl ?? null),
      coverUrl: normalizeMediaUrl(row.user.coverUrl ?? null),
      isPremium: isPremium(row.user.premiumStatus),
      isVerified: isSelfVerifiedCanadianCitizen(parseCommunityMeta(row.user.communityMeta ?? null)),
    },
    replies: [],
  }
}

function buildCommentTree(
  rows: CommentWithUser[],
  viewerVotes: Record<string, number> = {},
  options: { sort?: 'hot' | 'new' } = {},
): CommentNode[] {
  const nodeMap = new Map<string, CommentNode>()
  const roots: CommentNode[] = []
  const sortMode = options.sort ?? 'hot'

  rows.forEach((row) => {
    nodeMap.set(row.id, mapComment(row, viewerVotes[row.id] ?? null))
  })

  rows.forEach((row) => {
    const node = nodeMap.get(row.id)
    if (!node) return
    if (row.parentId) {
      const parent = nodeMap.get(row.parentId)
      if (parent) {
        parent.replies.push(node)
        return
      }
    }
    roots.push(node)
  })

  const visit = (node: CommentNode): CommentNode => {
    node.replies = node.replies.map(visit)
    attachCommentHotScore(node)

    if (sortMode === 'hot') {
      node.replies.sort((a, b) => {
        if (b.hotScore !== a.hotScore) return b.hotScore - a.hotScore
        const updatedDiff = b.updatedAt.getTime() - a.updatedAt.getTime()
        if (updatedDiff !== 0) return updatedDiff
        return a.id.localeCompare(b.id)
      })
    } else {
      node.replies.sort((a, b) => {
        const createdDiff = b.createdAt.getTime() - a.createdAt.getTime()
        if (createdDiff !== 0) return createdDiff
        return a.id.localeCompare(b.id)
      })
    }

    return node
  }

  const processedRoots = roots.map(visit)

  if (sortMode === 'hot') {
    processedRoots.sort((a, b) => {
      if (b.hotScore !== a.hotScore) return b.hotScore - a.hotScore
      const updatedDiff = b.updatedAt.getTime() - a.updatedAt.getTime()
      if (updatedDiff !== 0) return updatedDiff
      return a.id.localeCompare(b.id)
    })
  } else {
    processedRoots.sort((a, b) => {
      const createdDiff = b.createdAt.getTime() - a.createdAt.getTime()
      if (createdDiff !== 0) return createdDiff
      return a.id.localeCompare(b.id)
    })
  }

  return processedRoots
}

// Local schema for API registration that always treats `handle` as optional.
// This guards against any shared package drift where `handle` might be required.
const RegisterInputApi = z.object({
  email: z.string().email(),
  handle: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
  firstName: z.string().min(1).max(40),
  lastName: z.string().min(1).max(40),
  password: z.string().min(8).max(72),
  orgInviteToken: z.string().trim().min(12).max(160).optional(),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms' }),
  }),
})

function isExperienceTableMissing(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022')
}

function isFamilyMemberTableMissing(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2021' || error.code === 'P2022'
  }

  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (!message) return false

  return (
    message.includes('familymember') &&
    (
      message.includes('unknown arg') ||
      message.includes('unknown field') ||
      message.includes('column') ||
      message.includes('does not exist') ||
      message.includes('no such table')
    )
  )
}

const MAX_HANDLE_LENGTH = 32
const POST_SLUG_BASE_LIMIT = 80
const POST_SLUG_TOTAL_LIMIT = 200

function normalizeHandleBase(base: string) {
  return base
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

function trimHandleForSuffix(base: string, suffixLength: number) {
  const normalized = normalizeHandleBase(base)
  if (normalized.length + suffixLength <= MAX_HANDLE_LENGTH) {
    return normalized
  }
  return normalized.slice(0, Math.max(0, MAX_HANDLE_LENGTH - suffixLength))
}

function generateHandleSuffix() {
  const random = Math.floor(Math.random() * 900) + 100
  return `${random}`
}

async function generateUniqueHandle(base: string, client: PrismaClientOrTx, excludeUserId?: string): Promise<string> {
  const normalizedBase = normalizeHandleBase(base)
  let candidate = normalizedBase.length >= 3 ? normalizedBase.slice(0, MAX_HANDLE_LENGTH) : 'citizen'
  const whereFor = (handle: string) =>
    excludeUserId
      ? { handle, NOT: { id: excludeUserId } }
      : { handle }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await client.user.findFirst({ where: whereFor(candidate), select: { id: true } })
    if (!existing) {
      return candidate
    }
    const suffix = generateHandleSuffix()
    candidate = `${trimHandleForSuffix(normalizedBase, suffix.length)}${suffix}`
    if (candidate.length < 3) {
      candidate = `citizen${suffix}`.slice(0, MAX_HANDLE_LENGTH)
    }
  }

  const fallbackSuffix = `${Date.now()}`.slice(-4)
  return `${trimHandleForSuffix(normalizedBase || 'citizen', fallbackSuffix.length)}${fallbackSuffix}`.slice(0, MAX_HANDLE_LENGTH)
}

function slugifyText(input: string) {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function stripHtmlToPlainText(html: string) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripHtmlToPlainTextWithNewlines(html: string) {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const RICH_TEXT_ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'code',
  'a',
]

const RICH_TEXT_ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'name', 'target', 'rel'],
}

function sanitizeRichTextHtml(input: string) {
  const raw = typeof input === 'string' ? input : ''
  const cleaned = sanitizeHtml(raw, {
    allowedTags: RICH_TEXT_ALLOWED_TAGS,
    allowedAttributes: RICH_TEXT_ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName: string, attribs: sanitizeHtml.Attributes) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: 'nofollow noopener noreferrer',
          target: '_blank',
        },
      }),
    },
  })

  // Keep output stable for empty/whitespace-only cases.
  const trimmed = cleaned.trim()
  return trimmed || '<p></p>'
}

function escapeHtmlText(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function convertPlainTextToRichTextHtml(input: string) {
  const normalized = input.replace(/\r\n/g, '\n').trim()
  if (!normalized) return ''

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtmlText(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function normalizeRichTextHtml(input: string | null | undefined) {
  const raw = typeof input === 'string' ? input : ''
  if (!raw.trim()) return ''
  const normalizedInput = /<[^>]+>/.test(raw) ? raw : convertPlainTextToRichTextHtml(raw)
  return sanitizeRichTextHtml(normalizedInput)
}

function sanitizePlainText(input: string) {
  return stripHtmlToPlainTextWithNewlines(typeof input === 'string' ? input : '')
}

function trimSlugLength(value: string, max: number) {
  let trimmed = value.slice(0, max)
  trimmed = trimmed.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  return trimmed
}

function buildPostSlugBase(options: { handle?: string | null; title?: string | null; body: string }) {
  const handlePart = options.handle ? slugifyText(options.handle).slice(0, 24) : ''
  const titleSource = options.title?.trim()
  const rawSource = titleSource && titleSource.length > 0 ? titleSource : stripHtmlToPlainText(options.body).slice(0, 120)
  const contentPart = slugifyText(rawSource)
  const combined = [handlePart, contentPart].filter(Boolean).join('-')
  const normalized = combined.replace(/-+/g, '-')
  const trimmed = trimSlugLength(normalized, POST_SLUG_BASE_LIMIT)
  return trimmed || 'post'
}

function randomSlugSuffix() {
  return randomUUID().replace(/-/g, '').slice(0, 6)
}

function randomNumericSlugSuffix() {
  // 7 digits (e.g., 2324214) for user-friendly collision suffixes.
  return String(randomInt(1_000_000, 10_000_000))
}

async function generateUniquePostSlug(base: string, client: PrismaClientOrTx) {
  const normalizedBase = trimSlugLength(base, POST_SLUG_BASE_LIMIT) || 'post'
  const baseWithPost = normalizedBase.endsWith('-post') ? normalizedBase : trimSlugLength(`${normalizedBase}-post`, POST_SLUG_BASE_LIMIT)

  const buildCandidate = (suffix: string) => {
    const candidate = trimSlugLength(`${baseWithPost}-${suffix}`, POST_SLUG_TOTAL_LIMIT)
    return candidate || `post-${suffix}`
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = buildCandidate(randomSlugSuffix())
    const existing = await client.post.findUnique({ where: { seoSlug: candidate }, select: { id: true } })
    if (!existing) return candidate
  }
  return buildCandidate(randomUUID().replace(/-/g, '').slice(0, 12))
}

async function createOrganizationEventAnnouncementPost(args: {
  client: PrismaClientOrTx
  authorUserId: string
  businessId: string
  provinceCode: string
  communitySlug: string
  organizationSlug: string
  event: Pick<OrgEventDefinition, 'id' | 'title' | 'description' | 'startsAt' | 'primaryPhotoUrl'>
}) {
  const author = await args.client.user.findUnique({
    where: { id: args.authorUserId },
    select: { id: true, handle: true },
  })
  if (!author) return null

  const eventPath = `/com/${encodeURIComponent(args.provinceCode)}/${encodeURIComponent(args.communitySlug)}/orgs/${encodeURIComponent(args.organizationSlug)}/events/${encodeURIComponent(args.event.id)}`
  const eventUrl = `https://${CIVIL_PUBLIC_HOST}${eventPath}`
  const descriptionSnippet = sanitizePlainText(args.event.description ?? '').slice(0, 320).trim()

  const postBody = sanitizePlainText(
    [
      `New event published: ${args.event.title}`,
      descriptionSnippet,
      `View event: ${eventUrl}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  )

  const seoSlug = await generateUniquePostSlug(
    buildPostSlugBase({
      handle: author.handle,
      title: `Event: ${args.event.title}`,
      body: postBody,
    }),
    args.client,
  )

  return args.client.post.create({
    data: {
      authorId: args.authorUserId,
      businessId: args.businessId,
      audience: 'organization',
      visibility: 'public',
      body: postBody,
      title: `Event: ${args.event.title}`,
      type: 'post',
      mediaUrl: args.event.primaryPhotoUrl ?? undefined,
      provinceCode: args.provinceCode,
      communitySlug: args.communitySlug,
      jurisdiction: 'municipal',
      seoSlug,
    },
    select: { id: true, authorId: true, title: true, body: true, mediaUrl: true, images: true },
  })
}

const MAX_POLL_OPTIONS = 10
type PollResultsVisibilityValue = 'after_vote' | 'after_6_hours' | 'after_12_hours' | 'after_24_hours' | 'after_48_hours'

const POLL_INCLUDE = {
  include: {
    options: {
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: {
            votes: true,
          },
        },
      },
    },
    _count: {
      select: {
        votes: true,
      },
    },
  },
} as const

const POST_INCLUDE = {
  author: {
    select: {
      id: true,
      handle: true,
      name: true,
      avatarUrl: true,
      coverUrl: true,
      premiumStatus: true,
      communityMeta: true,
    },
  },
  business: {
    select: {
      id: true,
      name: true,
      slug: true,
      moderationStatus: true,
      isVerified: true,
      logoUrl: true,
      coverUrl: true,
      provinceCode: true,
      communitySlug: true,
    },
  },
  poll: POLL_INCLUDE,
  sharedPost: {
    include: {
      author: {
        select: {
          id: true,
          handle: true,
          name: true,
          avatarUrl: true,
          coverUrl: true,
          premiumStatus: true,
          communityMeta: true,
        },
      },
      business: {
        select: {
          id: true,
          name: true,
          slug: true,
          moderationStatus: true,
          isVerified: true,
          logoUrl: true,
          coverUrl: true,
          provinceCode: true,
          communitySlug: true,
        },
      },
      poll: POLL_INCLUDE,
    },
  },
} as const

type PostWithAuthor = Prisma.PostGetPayload<{ include: typeof POST_INCLUDE }>

type FormattedPost = {
  id: string
  seoSlug: string | null
  type: string
  title: string | null
  body: string
  mediaUrl: string | null
  images: string[] | null
  createdAt: Date
  updatedAt: Date
  jurisdiction: string
  provinceCode: string | null
  communitySlug: string | null
  communityName: string | null
  provinceName: string | null
  organization: {
    id: string
    name: string
    slug: string
    isVerified: boolean
    logoUrl: string | null
    coverUrl: string | null
    provinceCode: string | null
    communitySlug: string | null
  } | null
  showBusinessAuthor: boolean
  poll: {
    id: string
    resultsVisibility: PollResultsVisibilityValue
    resultsAvailableAt: Date | null
    firstVoteAt: Date | null
    endedAt: Date | null
    totalVotes: number | null
    maxOptions: number
    options: Array<{
      id: string
      label: string
      sortOrder: number
      voteCount: number | null
      percentage: number | null
    }>
    viewer: {
      hasVoted: boolean
      optionId: string | null
      canSeeResults: boolean
      canVote: boolean
    }
    authorCanAddOptions: boolean
    authorCanEndPoll: boolean
  } | null
  sharedPost: FormattedPost | null
  author: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
    isPremium: boolean
    isVerified: boolean
  }
  recentComments: Array<{
    id: string
    postId: string
    parentId: string | null
    body: string
    createdAt: Date
    updatedAt: Date
    score: number
    author: {
      id: string
      handle: string
      name: string | null
      avatarUrl: string | null
      coverUrl: string | null
      isPremium: boolean
      isVerified: boolean
    }
  }>
  counts: {
    commentCount: number
    reactions: number
    recentPositive: number
    upvotes: number
    downvotes: number
    score: number
  }
  votes: {
    upvotes: number
    downvotes: number
    score: number
  }
  reactions: {
    maple: number
    heart: number
    haha: number
    wow: number
    sad: number
    fire: number
    total: number
    positive: number
  }
  metrics: {
    hotScore: number
  }
  viewer: {
    reaction: PrismaReactionType | null
    vote: number | null
  }
}

type RecentCommentWithUser = Prisma.CommentGetPayload<{
  include: {
    user: {
      select: {
        id: true
        handle: true
        name: true
        avatarUrl: true
        coverUrl: true
        premiumStatus: true
        communityMeta: true
      }
    }
  }
}>

async function getRecentCommentsByPostIds(postIds: string[], limitPerPost = 5) {
  const uniquePostIds = Array.from(new Set(postIds)).filter(Boolean)
  if (!uniquePostIds.length) return {} as Record<string, FormattedPost['recentComments']>

  const rows: RecentCommentWithUser[] = await prisma.comment.findMany({
    where: {
      postId: { in: uniquePostIds },
      moderationStatus: ModerationStatus.VISIBLE,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: {
          id: true,
          handle: true,
          name: true,
          avatarUrl: true,
          coverUrl: true,
          premiumStatus: true,
          communityMeta: true,
        },
      },
    },
  })

  const grouped: Record<string, FormattedPost['recentComments']> = {}
  for (const row of rows) {
    const bucket = grouped[row.postId] ?? []
    if (bucket.length >= limitPerPost) continue
    bucket.push({
      id: row.id,
      postId: row.postId,
      parentId: row.parentId ?? null,
      body: sanitizePlainText(row.body),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      score: row.score,
      author: {
        id: row.user.id,
        handle: row.user.handle,
        name: row.user.name ?? null,
        avatarUrl: normalizeMediaUrl(row.user.avatarUrl ?? null),
        coverUrl: normalizeMediaUrl(row.user.coverUrl ?? null),
        isPremium: isPremium(row.user.premiumStatus),
        isVerified: isSelfVerifiedCanadianCitizen(parseCommunityMeta(row.user.communityMeta ?? null)),
      },
    })
    grouped[row.postId] = bucket

    let filled = 0
    for (const postId of uniquePostIds) {
      if ((grouped[postId]?.length ?? 0) >= limitPerPost) filled += 1
    }
    if (filled === uniquePostIds.length) break
  }

  return grouped
}

async function loadViewerReactionsByPostIds(
  viewerId: string | undefined,
  postIds: string[],
): Promise<Record<string, PrismaReactionType>> {
  if (!viewerId || postIds.length === 0) return {}

  const rows = await prisma.postReaction.findMany({
    where: {
      userId: viewerId,
      postId: { in: postIds },
    },
    select: {
      postId: true,
      type: true,
    },
  })

  const out: Record<string, PrismaReactionType> = {}
  for (const row of rows) {
    out[row.postId] = row.type
  }
  return out
}

async function loadViewerPollSelectionsByPostIds(
  viewerId: string | undefined,
  postIds: string[],
): Promise<Record<string, string>> {
  const uniquePostIds = Array.from(new Set(postIds)).filter(Boolean)
  if (!viewerId || uniquePostIds.length === 0) return {}

  const rows = await prisma.pollVote.findMany({
    where: {
      userId: viewerId,
      poll: {
        postId: { in: uniquePostIds },
      },
    },
    select: {
      optionId: true,
      poll: {
        select: {
          postId: true,
        },
      },
    },
  })

  const out: Record<string, string> = {}
  for (const row of rows) {
    out[row.poll.postId] = row.optionId
  }
  return out
}

async function loadViewerPostFormattingContext(
  viewerId: string | undefined,
  postIds: string[],
  recentCommentLimit = 5,
): Promise<{
  reactionsByPost: Record<string, PrismaReactionType>
  pollSelectionsByPost: Record<string, string>
  recentCommentsByPost: Record<string, FormattedPost['recentComments']>
}> {
  const uniquePostIds = Array.from(new Set(postIds)).filter(Boolean)
  if (!uniquePostIds.length) {
    return {
      reactionsByPost: {},
      pollSelectionsByPost: {},
      recentCommentsByPost: {},
    }
  }

  const [reactionsByPost, pollSelectionsByPost, recentCommentsByPost] = await Promise.all([
    loadViewerReactionsByPostIds(viewerId, uniquePostIds),
    loadViewerPollSelectionsByPostIds(viewerId, uniquePostIds),
    getRecentCommentsByPostIds(uniquePostIds, recentCommentLimit),
  ])

  return {
    reactionsByPost,
    pollSelectionsByPost,
    recentCommentsByPost,
  }
}

function formatPollResultsVisibility(value: PrismaPollResultsVisibility): PollResultsVisibilityValue {
  switch (value) {
    case PrismaPollResultsVisibility.AFTER_6_HOURS:
      return 'after_6_hours'
    case PrismaPollResultsVisibility.AFTER_12_HOURS:
      return 'after_12_hours'
    case PrismaPollResultsVisibility.AFTER_24_HOURS:
      return 'after_24_hours'
    case PrismaPollResultsVisibility.AFTER_48_HOURS:
      return 'after_48_hours'
    case PrismaPollResultsVisibility.AFTER_VOTE:
    default:
      return 'after_vote'
  }
}

function mapPollResultsVisibilityToDb(value: PollResultsVisibilityValue): PrismaPollResultsVisibility {
  switch (value) {
    case 'after_6_hours':
      return PrismaPollResultsVisibility.AFTER_6_HOURS
    case 'after_12_hours':
      return PrismaPollResultsVisibility.AFTER_12_HOURS
    case 'after_24_hours':
      return PrismaPollResultsVisibility.AFTER_24_HOURS
    case 'after_48_hours':
      return PrismaPollResultsVisibility.AFTER_48_HOURS
    case 'after_vote':
    default:
      return PrismaPollResultsVisibility.AFTER_VOTE
  }
}

function getPollResultsAvailableAt(visibility: PollResultsVisibilityValue, baseTime: Date): Date | null {
  const delayHours =
    visibility === 'after_6_hours'
      ? 6
      : visibility === 'after_12_hours'
        ? 12
        : visibility === 'after_24_hours'
          ? 24
          : visibility === 'after_48_hours'
            ? 48
            : 0

  if (!delayHours) return null
  return new Date(baseTime.getTime() + delayHours * 60 * 60 * 1000)
}

function formatPollForViewer(
  post: PostWithAuthor,
  viewerId: string | null | undefined,
  viewerPollOptionId: string | null | undefined,
  now: Date,
): FormattedPost['poll'] {
  if (!post.poll) return null

  const hasVoted = Boolean(viewerPollOptionId)
  const isEnded = Boolean(post.poll.endedAt)
  const isAuthor = Boolean(viewerId && viewerId === post.authorId)
  const resultsAvailableAt = post.poll.resultsAvailableAt ?? null
  const resultsVisibleByTime = Boolean(resultsAvailableAt && resultsAvailableAt.getTime() <= now.getTime())
  const canSeeResults =
    post.poll.resultsVisibility === PrismaPollResultsVisibility.AFTER_VOTE
      ? hasVoted || isEnded
      : resultsVisibleByTime
  const totalVotes = canSeeResults ? post.poll._count.votes : null
  const safeTotalVotes = post.poll._count.votes || 0

  return {
    id: post.poll.id,
    resultsVisibility: formatPollResultsVisibility(post.poll.resultsVisibility),
    resultsAvailableAt,
    firstVoteAt: post.poll.firstVoteAt ?? null,
    endedAt: post.poll.endedAt ?? null,
    totalVotes,
    maxOptions: MAX_POLL_OPTIONS,
    options: post.poll.options.map((option) => {
      const voteCount = canSeeResults ? option._count.votes : null
      const percentage =
        canSeeResults && safeTotalVotes > 0 ? Math.round((option._count.votes / safeTotalVotes) * 100) : canSeeResults ? 0 : null

      return {
        id: option.id,
        label: option.label,
        sortOrder: option.sortOrder,
        voteCount,
        percentage,
      }
    }),
    viewer: {
      hasVoted,
      optionId: viewerPollOptionId ?? null,
      canSeeResults,
      canVote: !isEnded,
    },
    authorCanAddOptions: isAuthor && !isEnded && post.poll.options.length < MAX_POLL_OPTIONS,
    authorCanEndPoll: isAuthor && !isEnded,
  }
}

function formatPost(
  post: PostWithAuthor,
  options: {
    viewerVote?: number | null
    viewerReaction?: PrismaReactionType | null
    recentComments?: FormattedPost['recentComments']
    viewerId?: string | null
    viewerPollOptionId?: string | null
    now?: Date
  } = {},
): FormattedPost {
  const community = post.provinceCode && post.communitySlug ? findCommunity(post.provinceCode, post.communitySlug) : null
  const provinceName = community ? getProvinceDisplayName(community.province as any) : null
  const now = options.now ?? new Date()

  let sharedPost: FormattedPost | null = null
  if (
    post.sharedPost &&
    post.sharedPost.moderationStatus === ModerationStatus.VISIBLE &&
    (!post.sharedPost.business || post.sharedPost.business.moderationStatus === ModerationStatus.VISIBLE)
  ) {
    sharedPost = formatPost(post.sharedPost as any)
  }

  return {
    id: post.id,
    seoSlug: post.seoSlug,
    type: post.type,
    title: post.title,
    body: post.type === 'article' ? sanitizeRichTextHtml(post.body) : sanitizePlainText(post.body),
    mediaUrl: normalizeMediaUrl(post.mediaUrl ?? null),
    images: (post.images as string[] | null)?.map(normalizeMediaUrl).filter((url): url is string => url !== null) ?? null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    jurisdiction: post.jurisdiction,
    provinceCode: post.provinceCode,
    communitySlug: post.communitySlug,
    communityName: community?.name ?? null,
    provinceName,
    organization: post.business
      ? {
          id: post.business.id,
          name: post.business.name,
          slug: post.business.slug,
          isVerified: Boolean(post.business.isVerified),
          logoUrl: normalizeMediaUrl((post.business as any).logoUrl ?? null),
          coverUrl: normalizeMediaUrl((post.business as any).coverUrl ?? null),
          provinceCode: post.business.provinceCode ?? null,
          communitySlug: post.business.communitySlug ?? null,
        }
      : null,
    showBusinessAuthor: Boolean(post.businessId && post.showBusinessAuthor),
    poll: formatPollForViewer(post, options.viewerId, options.viewerPollOptionId, now),
    sharedPost,
    author: {
      id: post.author.id,
      handle: post.author.handle,
      name: post.author.name,
      avatarUrl: normalizeMediaUrl(post.author.avatarUrl ?? null),
      coverUrl: normalizeMediaUrl((post.author as any).coverUrl ?? null),
      isPremium: isPremium(post.author.premiumStatus),
      isVerified: isSelfVerifiedCanadianCitizen(parseCommunityMeta(post.author.communityMeta ?? null)),
    },
    recentComments: options.recentComments ?? [],
    counts: {
      commentCount: post.commentCount,
      reactions: post.reactionTotal ?? 0,
      recentPositive: post.recentPositive ?? 0,
      upvotes: post.upvotes ?? 0,
      downvotes: post.downvotes ?? 0,
      score: post.score ?? 0,
    },
    votes: {
      upvotes: post.upvotes ?? 0,
      downvotes: post.downvotes ?? 0,
      score: post.score ?? 0,
    },
    reactions: {
      maple: post.reactionMaple ?? 0,
      heart: post.reactionHeart ?? 0,
      haha: post.reactionHaha ?? 0,
      wow: post.reactionWow ?? 0,
      sad: post.reactionSad ?? 0,
      fire: post.reactionFire ?? 0,
      total: post.reactionTotal ?? 0,
      positive: post.reactionTotal ?? 0,
    },
    metrics: {
      hotScore: post.hotScore,
    },
    viewer: {
      reaction: options.viewerReaction ?? null,
      vote: options.viewerVote ?? null,
    },
  }
}

function getCanonicalPaths(post: PostWithAuthor) {
  const slug = post.seoSlug ?? post.id
  return {
    user: `/u/${post.author.handle}/posts/${slug}`,
    community: post.provinceCode && post.communitySlug ? `/${post.provinceCode}/${post.communitySlug}/posts/${slug}` : null,
    legacy: `/post/${post.id}`,
  }
}

type FeedCategory = 'friends' | 'network' | 'community' | 'organizations' | 'events' | 'marketplace' | 'other'

type ViewerFeedContext = {
  viewerId: string
  friendIds: Set<string>
  connectionIds: Set<string>
  followedBusinessIds: Set<string>
  memberBusinessIds: Set<string>
  homeCommunityKey: string | null
  nearbyCommunityKeys: Set<string>
  regionalCommunityKeys: Set<string>
  followedCommunityKeys: Set<string>
}

type FeedRankingPostRecord = {
  id: string
  authorId: string
  businessId: string | null
  type: string
  createdAt: Date
  updatedAt: Date
  lastActivityAt: Date
  provinceCode: string | null
  communitySlug: string | null
  reactionTotal: number
  commentCount: number
  recentPositive: number
  hotScore: number
}

type RankedFeedCandidate = {
  postId: string
  score: number
  createdAtMs: number
  category: FeedCategory
}

type FeedRankCursorState = {
  offset: number
  seed: number | null
}

const HOME_FEED_CATEGORY_WEIGHTS: Record<FeedCategory, number> = {
  friends: 30,
  network: 20,
  community: 20,
  organizations: 15,
  events: 10,
  marketplace: 5,
  other: 5,
}

const FEED_RANK_CURSOR_PREFIX = 'rank:'

function normalizeFeedRankSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 1
  const normalized = Math.abs(Math.floor(seed)) % 2147483647
  return normalized === 0 ? 1 : normalized
}

function createFeedRankSeed(): number {
  return normalizeFeedRankSeed(Math.floor(Math.random() * 2147483647))
}

function createSeededRandom(seed: number): () => number {
  let state = normalizeFeedRankSeed(seed)
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function toCommunityKey(provinceCode: string | null | undefined, communitySlug: string | null | undefined): string | null {
  if (!provinceCode || !communitySlug) return null
  return `${provinceCode.toUpperCase()}:${communitySlug.toLowerCase()}`
}

function parseFeedRankCursor(cursor?: string): FeedRankCursorState {
  if (!cursor) return { offset: 0, seed: null }
  const trimmed = cursor.trim()
  if (!trimmed.startsWith(FEED_RANK_CURSOR_PREFIX)) return { offset: 0, seed: null }
  const raw = trimmed.slice(FEED_RANK_CURSOR_PREFIX.length)
  const parts = raw.split(':')

  if (parts.length === 1) {
    const offset = Number.parseInt(parts[0] ?? '', 10)
    return {
      offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
      seed: null,
    }
  }

  const seed = Number.parseInt(parts[0] ?? '', 10)
  const offset = Number.parseInt(parts[1] ?? '', 10)
  return {
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    seed: Number.isFinite(seed) ? normalizeFeedRankSeed(seed) : null,
  }
}

function buildFeedRankCursor(offset: number, seed: number): string {
  const normalized = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0
  return `${FEED_RANK_CURSOR_PREFIX}${normalizeFeedRankSeed(seed)}:${normalized}`
}

async function loadViewerFeedContext(viewerId: string): Promise<ViewerFeedContext> {
  const [friendIds, connectionIds, communityFollows, businessFollows, businessMemberships, ownedBusinesses, userRecord] =
    await Promise.all([
      loadAcceptedFriendIds(viewerId),
      loadAcceptedConnectionIds(viewerId),
      prisma.communityFollow.findMany({
        where: { userId: viewerId },
        select: { provinceCode: true, communitySlug: true, home: true, createdAt: true },
      }),
      prisma.businessFollow.findMany({
        where: { userId: viewerId },
        select: { businessId: true },
      }) as Promise<Array<{ businessId: string }>>,
      prisma.businessMembership.findMany({
        where: { userId: viewerId },
        select: { businessId: true },
      }) as Promise<Array<{ businessId: string }>>,
      prisma.business.findMany({
        where: { ownerId: viewerId },
        select: { id: true },
      }) as Promise<Array<{ id: string }>>,
      prisma.user.findUnique({
        where: { id: viewerId },
        select: { communityMeta: true },
      }),
    ])

  const followedCommunityKeys = new Set<string>()
  let homeCommunityKey: string | null = null
  const sortedFollows = [...communityFollows].sort((a, b) => {
    if (a.home !== b.home) return a.home ? -1 : 1
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
  for (const follow of sortedFollows) {
    const key = toCommunityKey(follow.provinceCode, follow.communitySlug)
    if (!key) continue
    followedCommunityKeys.add(key)
    if (follow.home && !homeCommunityKey) {
      homeCommunityKey = key
    }
  }
  if (!homeCommunityKey) {
    homeCommunityKey = sortedFollows.length ? toCommunityKey(sortedFollows[0]?.provinceCode, sortedFollows[0]?.communitySlug) : null
  }

  const communityMeta = parseCommunityMeta(userRecord?.communityMeta ?? null)
  const nearbyCommunityKeys = new Set<string>()
  if (communityMeta?.nearbyCommunities?.length) {
    for (const entry of communityMeta.nearbyCommunities) {
      const key = toCommunityKey(entry.provinceCode, entry.communitySlug)
      if (!key || key === homeCommunityKey) continue
      nearbyCommunityKeys.add(key)
      if (nearbyCommunityKeys.size >= 20) break
    }
  }

  const regionalCommunityKeys = new Set<string>()
  for (const key of followedCommunityKeys) {
    if (key === homeCommunityKey) continue
    if (nearbyCommunityKeys.has(key)) continue
    regionalCommunityKeys.add(key)
  }

  return {
    viewerId,
    friendIds: new Set(friendIds),
    connectionIds: new Set(connectionIds),
    followedBusinessIds: new Set(businessFollows.map((row) => row.businessId)),
    memberBusinessIds: new Set([...businessMemberships.map((row) => row.businessId), ...ownedBusinesses.map((row) => row.id)]),
    homeCommunityKey,
    nearbyCommunityKeys,
    regionalCommunityKeys,
    followedCommunityKeys,
  }
}

function resolveGeoLevel(post: FeedRankingPostRecord, context: ViewerFeedContext | null): 1 | 2 | 3 | 4 {
  if (!context) return 4
  const key = toCommunityKey(post.provinceCode, post.communitySlug)
  if (!key) return 4
  if (context.homeCommunityKey && key === context.homeCommunityKey) return 1
  if (context.nearbyCommunityKeys.has(key)) return 2
  if (context.regionalCommunityKeys.has(key) || context.followedCommunityKeys.has(key)) return 3
  return 4
}

function resolveFeedCategory(post: FeedRankingPostRecord, scope: 'all' | 'friends' | 'network' | 'communities' | 'organizations', context: ViewerFeedContext | null): FeedCategory {
  if (scope === 'friends') return 'friends'
  if (scope === 'network') return 'network'
  if (scope === 'communities') return 'community'
  if (scope === 'organizations') return 'organizations'

  const normalizedType = (post.type || '').trim().toLowerCase()
  if (normalizedType.includes('event')) return 'events'
  if (normalizedType.includes('market')) return 'marketplace'

  if (context) {
    if (context.friendIds.has(post.authorId) || post.authorId === context.viewerId) return 'friends'
    if (context.connectionIds.has(post.authorId)) return 'network'
    if (post.businessId && (context.followedBusinessIds.has(post.businessId) || context.memberBusinessIds.has(post.businessId))) {
      return 'organizations'
    }
  }

  if (post.businessId) return 'organizations'
  if (post.provinceCode && post.communitySlug) return 'community'
  return 'other'
}

function scoreFeedCandidate(args: {
  post: FeedRankingPostRecord
  scope: 'all' | 'friends' | 'network' | 'communities' | 'organizations'
  context: ViewerFeedContext | null
  impression?: { lastSeenAt: Date; impressionCount: number }
  hasReaction: boolean
  hasCommented: boolean
  nowMs: number
}): number {
  const ageMs = Math.max(0, args.nowMs - args.post.createdAt.getTime())
  const ageHours = ageMs / (1000 * 60 * 60)
  const activityAtMs = Math.max(args.post.createdAt.getTime(), args.post.lastActivityAt.getTime())
  const activityAgeMs = Math.max(0, args.nowMs - activityAtMs)
  const activityAgeHours = activityAgeMs / (1000 * 60 * 60)
  const freshnessWindowHours = args.scope === 'all' ? 18 : 24
  const activityWindowHours = args.scope === 'all' ? 10 : 14
  const freshnessScore = Math.exp(-ageHours / freshnessWindowHours) * 220
  const activityScore = Math.exp(-activityAgeHours / activityWindowHours) * 140

  const engagementRaw =
    Math.max(0, args.post.reactionTotal || 0) +
    Math.max(0, args.post.commentCount || 0) * 1.6 +
    Math.max(0, args.post.recentPositive || 0) * 1.4 +
    Math.max(0, args.post.hotScore || 0) * 0.35
  const engagementScore = Math.log1p(engagementRaw) * 14

  const seen = Boolean(args.impression)
  const impressionCount = Math.max(0, args.impression?.impressionCount ?? 0)
  const unseenBoost = seen ? 0 : args.scope === 'all' ? 220 : 320
  const seenPenalty = impressionCount * (args.scope === 'all' ? 42 : 30)
  const maturityPenalty = args.scope === 'all'
    ? Math.max(0, ageHours - 72) * 0.28 + Math.max(0, activityAgeHours - 36) * 0.35
    : Math.max(0, ageHours - 120) * 0.14

  const geoLevel = resolveGeoLevel(args.post, args.context)
  const geoBoostByScope = args.scope === 'communities' || args.scope === 'all'
    ? ({ 1: 220, 2: 130, 3: 70, 4: 18 } as const)
    : ({ 1: 60, 2: 36, 3: 18, 4: 0 } as const)
  const geoBoost = geoBoostByScope[geoLevel]

  let interactionBoost = 0
  if (args.hasReaction) interactionBoost += 55
  if (args.hasCommented) interactionBoost += 70
  if (args.impression) {
    const seenAgeHours = Math.max(0, args.nowMs - args.impression.lastSeenAt.getTime()) / (1000 * 60 * 60)
    if (seenAgeHours <= 72) interactionBoost += 35
  }

  const isViewerPost = Boolean(args.context && args.post.authorId === args.context.viewerId)
  // Keep freshly published viewer posts visible on reload instead of only through the optimistic client insert.
  const viewerAuthorBoost =
    isViewerPost && args.scope === 'all'
      ? Math.exp(-ageHours / 18) * 420
      : isViewerPost
        ? Math.exp(-ageHours / 24) * 180
        : 0

  return unseenBoost + freshnessScore + activityScore + engagementScore + geoBoost + interactionBoost + viewerAuthorBoost - seenPenalty - maturityPenalty
}

function pickWeightedFeedCategory(
  choices: Array<{ category: FeedCategory; weight: number }>,
  random: () => number,
): FeedCategory | null {
  const totalWeight = choices.reduce((sum, choice) => sum + choice.weight, 0)
  if (totalWeight <= 0) return choices[0]?.category ?? null

  let threshold = random() * totalWeight
  for (const choice of choices) {
    threshold -= choice.weight
    if (threshold <= 0) return choice.category
  }

  return choices[choices.length - 1]?.category ?? null
}

function mixHomeFeedCandidates(candidates: RankedFeedCandidate[], seed: number): RankedFeedCandidate[] {
  if (candidates.length <= 1) return candidates

  const random = createSeededRandom(seed)

  const buckets = new Map<FeedCategory, RankedFeedCandidate[]>()
  for (const candidate of candidates) {
    const bucket = buckets.get(candidate.category) ?? []
    bucket.push(candidate)
    buckets.set(candidate.category, bucket)
  }

  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs
      return b.postId.localeCompare(a.postId)
    })
  }

  const availableCategories = Array.from(buckets.keys())
  if (availableCategories.length <= 1) return candidates

  const baseWeightTotal = availableCategories.reduce((sum, category) => sum + (HOME_FEED_CATEGORY_WEIGHTS[category] ?? 0), 0)
  if (baseWeightTotal <= 0) return candidates

  const normalizedWeights = new Map<FeedCategory, number>()
  for (const category of availableCategories) {
    normalizedWeights.set(category, (HOME_FEED_CATEGORY_WEIGHTS[category] ?? 0) / baseWeightTotal)
  }

  const consumed = new Map<FeedCategory, number>()
  for (const category of availableCategories) consumed.set(category, 0)

  const mixed: RankedFeedCandidate[] = []
  while (mixed.length < candidates.length) {
    const lastCategory = mixed[mixed.length - 1]?.category ?? null
    const beforeLastCategory = mixed[mixed.length - 2]?.category ?? null
    const weightedChoices: Array<{ category: FeedCategory; weight: number }> = []

    for (const category of availableCategories) {
      const queue = buckets.get(category)
      if (!queue?.length) continue
      const expected = (mixed.length + 1) * (normalizedWeights.get(category) ?? 0)
      const actual = consumed.get(category) ?? 0
      const deficit = Math.max(0.45, expected - actual + 1)
      let effectiveWeight = (HOME_FEED_CATEGORY_WEIGHTS[category] ?? 0) * deficit
      if (category === lastCategory) effectiveWeight *= 0.35
      if (category === lastCategory && category === beforeLastCategory) effectiveWeight *= 0.2
      weightedChoices.push({ category, weight: effectiveWeight })
    }

    const bestCategory = pickWeightedFeedCategory(weightedChoices, random)
    if (!bestCategory) break
    const queue = buckets.get(bestCategory)
    const next = queue?.shift()
    if (!next) continue
    mixed.push(next)
    consumed.set(bestCategory, (consumed.get(bestCategory) ?? 0) + 1)
  }

  if (mixed.length < candidates.length) {
    const leftovers = availableCategories.flatMap((category) => buckets.get(category) ?? [])
    leftovers.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.createdAtMs - a.createdAtMs))
    mixed.push(...leftovers)
  }

  return mixed
}

type FeedScopeMode = 'all' | 'friends' | 'network' | 'communities' | 'organizations'

async function loadViewerInteractionSignalsByPostIds(viewerId: string, postIds: string[]) {
  const uniquePostIds = Array.from(new Set(postIds)).filter(Boolean)
  const reactedPostIds = new Set<string>()
  const commentedPostIds = new Set<string>()
  if (!uniquePostIds.length) return { reactedPostIds, commentedPostIds }

  const [reactions, comments] = await Promise.all([
    prisma.postReaction.findMany({
      where: { userId: viewerId, postId: { in: uniquePostIds } },
      select: { postId: true },
    }),
    prisma.comment.findMany({
      where: { userId: viewerId, postId: { in: uniquePostIds }, moderationStatus: ModerationStatus.VISIBLE },
      select: { postId: true },
      distinct: ['postId'],
    }),
  ])

  for (const row of reactions) {
    if (row.postId) reactedPostIds.add(row.postId)
  }
  for (const row of comments) {
    if (row.postId) commentedPostIds.add(row.postId)
  }

  return { reactedPostIds, commentedPostIds }
}

async function rankFeedPosts(args: {
  posts: PostWithAuthor[]
  viewerId: string | null
  scope: FeedScopeMode
  sortMode: 'new' | 'hot'
  cursor?: string
  context: ViewerFeedContext | null
  limit: number
}) {
  const rankCursor = parseFeedRankCursor(args.cursor)
  const offset = rankCursor.offset
  const rankingSeed = rankCursor.seed ?? createFeedRankSeed()
  if (!args.posts.length) {
    return { items: [] as PostWithAuthor[], nextCursor: undefined as string | undefined }
  }

  const postIds = args.posts.map((post) => post.id)
  const [impressionMap, interactionSignals] = await Promise.all([
    args.viewerId ? loadUserPostImpressionMap(args.viewerId, postIds) : Promise.resolve(new Map<string, { firstSeenAt: Date; lastSeenAt: Date; impressionCount: number }>()),
    args.viewerId
      ? loadViewerInteractionSignalsByPostIds(args.viewerId, postIds)
      : Promise.resolve({ reactedPostIds: new Set<string>(), commentedPostIds: new Set<string>() }),
  ])

  const nowMs = Date.now()
  const rankedCandidates = args.posts.map((post): RankedFeedCandidate => {
    const rankingPost: FeedRankingPostRecord = {
      id: post.id,
      authorId: post.authorId,
      businessId: post.businessId ?? null,
      type: post.type,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      lastActivityAt: post.lastActivityAt,
      provinceCode: post.provinceCode ?? null,
      communitySlug: post.communitySlug ?? null,
      reactionTotal: post.reactionTotal ?? 0,
      commentCount: post.commentCount ?? 0,
      recentPositive: post.recentPositive ?? 0,
      hotScore: post.hotScore ?? 0,
    }

    const baseScore = scoreFeedCandidate({
      post: rankingPost,
      scope: args.scope,
      context: args.context,
      impression: impressionMap.get(post.id),
      hasReaction: interactionSignals.reactedPostIds.has(post.id),
      hasCommented: interactionSignals.commentedPostIds.has(post.id),
      nowMs,
    })
    const hotPreferenceBoost =
      args.sortMode === 'hot'
        ? Math.log1p(Math.max(0, rankingPost.hotScore)) * 24 +
          Math.log1p(Math.max(0, rankingPost.commentCount)) * 14 +
          Math.log1p(Math.max(0, rankingPost.reactionTotal)) * 10
        : 0

    return {
      postId: post.id,
      score: baseScore + hotPreferenceBoost,
      createdAtMs: rankingPost.createdAt.getTime(),
      category: resolveFeedCategory(rankingPost, args.scope, args.context),
    }
  })

  rankedCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs
    return b.postId.localeCompare(a.postId)
  })

  const orderedCandidates = args.scope === 'all' ? mixHomeFeedCandidates(rankedCandidates, rankingSeed) : rankedCandidates
  const postById = new Map(args.posts.map((post) => [post.id, post] as const))
  const rankedPosts = orderedCandidates
    .map((candidate) => postById.get(candidate.postId))
    .filter((post): post is PostWithAuthor => Boolean(post))

  const pagedItems = rankedPosts.slice(offset, offset + args.limit)
  const nextOffset = offset + args.limit
  const nextCursor = nextOffset < rankedPosts.length ? buildFeedRankCursor(nextOffset, rankingSeed) : undefined
  return { items: pagedItems, nextCursor }
}

app.get('/health', async () => ({ ok: true }))

function filterCivilAiEventsByWhen(
  events: Awaited<ReturnType<typeof loadFeedActivityEvents>>,
  when: 'today' | 'upcoming',
) {
  if (when !== 'today') return events
  const now = new Date()
  return events.filter((event) => {
    const date = new Date(event.startsAt)
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    )
  })
}

// Ensure all unexpected errors return clean JSON (prevents malformed bodies)
app.setErrorHandler((err, req, reply) => {
  try {
    req.log.error({ err }, 'uncaught')
  } catch {}
  const status = (err as any)?.statusCode ?? 500
  const isClient = status >= 400 && status < 500
  const message = isClient ? (typeof (err as any)?.message === 'string' ? (err as any).message : 'request_error') : 'internal_error'
  if (!reply.sent) reply.code(status).send({ error: message })
})

// Prisma migrations/db push handle schema; no manual ensureSchema needed in production

async function applyOrganizationInviteRegistration(token: string, newUserId: string) {
  const normalizedToken = token.trim()
  if (!normalizedToken) return

  const businesses = await prisma.business.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      ownerId: true,
      provinceCode: true,
      communitySlug: true,
      slug: true,
      metadata: true,
    },
  })

  const matched = businesses.find((org: (typeof businesses)[number]) => {
    const system = readOrganizationSystemState(org.metadata)
    return system.inviteLinks.some((entry) => entry.token === normalizedToken)
  })
  if (!matched) return

  const current = readOrganizationSystemState(matched.metadata)
  const inviteIndex = current.inviteLinks.findIndex((entry) => entry.token === normalizedToken)
  if (inviteIndex < 0) return
  const invite = current.inviteLinks[inviteIndex]
  if (!invite) return

  const nowIso = new Date().toISOString()
  const existingMember = current.members[newUserId] ?? null
  const status: OrgMembershipStatus = current.joinMode === 'APPLICATION_REQUIRED' ? 'PENDING' : 'ACTIVE'

  const referralAlreadyExists = current.referrals.some(
    (item) => item.referrerUserId === invite.createdByUserId && item.referredUserId === newUserId,
  )
  const referralId = `ref_${randomUUID().replace(/-/g, '').slice(0, 14)}`
  const referral: OrgReferralRecord | null = referralAlreadyExists
    ? null
    : {
        id: referralId,
        referrerUserId: invite.createdByUserId,
        referredUserId: newUserId,
        planId: invite.planId ?? null,
        createdAt: nowIso,
      }

  const inviterCurrentMember = current.members[invite.createdByUserId] ?? {
    rankId: invite.createdByUserId === matched.ownerId ? SYSTEM_OWNER_RANK_ID : SYSTEM_MEMBER_RANK_ID,
    planId: null,
    status: 'ACTIVE' as OrgMembershipStatus,
    referredByUserId: null,
    reputation: 0,
    updatedAt: nowIso,
  }

  const hasRewardLedger = current.reputationLedger.some(
    (entry) => entry.source === 'signup_referral' && entry.userId === invite.createdByUserId && entry.sourceRefId === (referral?.id ?? null),
  )

  const rewardLedger: OrgReputationEntry | null =
    referral && !hasRewardLedger
      ? {
          id: `rep_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
          userId: invite.createdByUserId,
          delta: ORG_SIGNUP_REPUTATION_POINTS,
          source: 'signup_referral',
          sourceRefId: referral.id,
          note: `Signup referral reward (+${ORG_SIGNUP_REPUTATION_POINTS})`,
          createdAt: nowIso,
        }
      : null

  const nextInviteLinks = [...current.inviteLinks]
  nextInviteLinks[inviteIndex] = {
    ...invite,
    registrationCount: invite.registrationCount + 1,
    joinCount: status === 'ACTIVE' ? invite.joinCount + 1 : invite.joinCount,
    lastRegisteredAt: nowIso,
    lastJoinedAt: status === 'ACTIVE' ? nowIso : invite.lastJoinedAt,
  }

  const nextSystem: OrganizationSystemState = {
    ...current,
    inviteLinks: nextInviteLinks,
    referrals: referral ? [...current.referrals, referral] : current.referrals,
    reputationLedger: rewardLedger ? [...current.reputationLedger, rewardLedger] : current.reputationLedger,
    members: {
      ...current.members,
      [newUserId]: {
        rankId: existingMember?.rankId ?? SYSTEM_MEMBER_RANK_ID,
        planId: invite.planId ?? existingMember?.planId ?? null,
        status,
        referredByUserId: invite.createdByUserId,
        reputation: existingMember?.reputation ?? 0,
        updatedAt: nowIso,
      },
      [invite.createdByUserId]: rewardLedger
        ? {
            ...inviterCurrentMember,
            reputation: (inviterCurrentMember.reputation ?? 0) + ORG_SIGNUP_REPUTATION_POINTS,
            updatedAt: nowIso,
          }
        : inviterCurrentMember,
    },
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.businessFollow.upsert({
      where: { businessId_userId: { businessId: matched.id, userId: newUserId } },
      create: { businessId: matched.id, userId: newUserId },
      update: {},
    })

    await tx.business.update({
      where: { id: matched.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(matched.metadata, nextSystem) },
      select: { id: true },
    })

    await appendOrganizationAuditLogEntry(tx, matched.id, {
      actorUserId: newUserId,
      action: status === 'ACTIVE' ? 'member.joined_via_invite' : 'member.join_requested_via_invite',
      reason: 'Joined via invite landing registration',
      previousValue: existingMember,
      nextValue: nextSystem.members[newUserId],
    })
  })

  if (status === 'ACTIVE' && invite.createdByUserId !== newUserId) {
    const inviterExists = await prisma.user.findUnique({ where: { id: invite.createdByUserId }, select: { id: true } })
    if (inviterExists) {
      await createOrRefreshConnectionRequest(newUserId, invite.createdByUserId)
    }
  }
}

// Auth: register
app.post('/auth/register', async (req: FastifyRequest, reply: FastifyReply) => {
  // Accept both shapes: shared RegisterInput and our local variant with optional handle
  let parse = RegisterInput.safeParse(req.body)
  if (!parse.success) {
    parse = RegisterInputApi.safeParse(req.body)
  }
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
  const { email, firstName, lastName, password } = parse.data
  const rawBody = (req.body ?? {}) as Record<string, unknown>
  const orgInviteToken = typeof rawBody.orgInviteToken === 'string' ? rawBody.orgInviteToken.trim() : ''
  const normalizedFirstName = firstName.trim().toLowerCase()
  const normalizedLastName = lastName.trim().toLowerCase()
  const name = `${normalizedFirstName} ${normalizedLastName}`.trim()
  const baseHandle = buildHandleBase(normalizedFirstName, normalizedLastName)
  const handle = await generateUniqueHandle(baseHandle, prisma)
  const hash = await bcrypt.hash(password, 10)
  try {
    const user = await prisma.user.create({ data: { id: randomUUID(), email, handle, name, passwordHash: hash } })
    if (orgInviteToken) {
      try {
        await applyOrganizationInviteRegistration(orgInviteToken, user.id)
      } catch (inviteErr) {
        req.log.warn({ err: inviteErr }, 'org_invite_registration_apply_failed')
      }
    }
    const token = await (app as any).jwt.sign({ sub: user.id })
    return reply.send({ token, user: { id: user.id, email: user.email, handle: user.handle, name: user.name } })
  } catch (e: any) {
    if (e.code === 'P2002') return reply.code(409).send({ error: 'email_or_handle_exists' })
    throw e
  }
})

// Auth: login
registerCommunityRoute(
  'get',
  '/communities/:province/:community/posts',
  async (req: FastifyRequest, reply: FastifyReply) =>
    withSchemaGuard(req, reply, async () => {
      const params = z
        .object({
          province: z.string().min(2).max(64),
          community: z.string().min(1).max(160),
        })
        .safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const province = normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })

      const communityRecord = findCommunity(province, params.data.community)
      if (!communityRecord) return reply.code(404).send({ error: 'community_not_found' })

      const query = CursorQuery.extend({
        jurisdiction: JurisdictionEnum.optional(),
        sort: PostSortEnum.optional(),
      }).safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const { cursor, limit, jurisdiction, sort } = query.data
      const viewerId = (req as any).user?.id as string | undefined
      const sortMode = sort ?? 'new'

      const where: Prisma.PostWhereInput = {
        provinceCode: communityRecord.province,
        communitySlug: communityRecord.slug,
        visibility: 'public',
        ...(jurisdiction ? { jurisdiction } : {}),
      }

      let items: PostWithAuthor[] = []
      let nextCursor: string | undefined

      if (sortMode === 'hot') {
        items = await prisma.post.findMany({
          where,
          take: limit,
          orderBy: [{ hotScore: 'desc' }, { lastActivityAt: 'desc' }],
          include: POST_INCLUDE,
        })
      } else {
        const queryResult = await prisma.post.findMany({
          where,
          take: limit + 1,
          orderBy: { createdAt: 'desc' },
          include: POST_INCLUDE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })
        if (queryResult.length > limit) {
          const next = queryResult.pop()!
          nextCursor = next.id
        }
        items = queryResult
      }

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost } = await loadViewerPostFormattingContext(
        viewerId,
        items.map((item) => item.id),
        5,
      )

      return {
        community: communityRecord,
        items: items.map((item) =>
          formatPost(item, {
            viewerId,
            viewerReaction: reactionsByPost[item.id] ?? null,
            viewerPollOptionId: pollSelectionsByPost[item.id] ?? null,
            recentComments: recentCommentsByPost[item.id] ?? [],
          }),
        ),
        nextCursor,
      }
    }),
)

registerCommunityRoute('get', '/communities/:province', async (req: FastifyRequest, reply: FastifyReply) => {
  const params = z.object({ province: z.string().min(2).max(64) }).safeParse(req.params)
  if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

  const province = normalizeProvinceCode(params.data.province)
  if (!province) return reply.code(404).send({ error: 'province_not_found' })

  const communities = getCommunitiesByProvince(province)
  return reply.send({ items: communities })
})

// Communitys - get current home community
registerCommunityRoute('get', '/communities/home', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })
  const follow = await prisma.communityFollow.findFirst({ where: { userId, home: true } })
  if (!follow) return reply.send({ home: null })
  const community = findCommunity(follow.provinceCode, follow.communitySlug)
  return reply.send({
    home: community ? { ...community } : { province: follow.provinceCode, slug: follow.communitySlug },
  })
})

// Communitys - set home community
registerCommunityRoute('post', '/communities/home', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = SetHomeCommunityInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const province = normalizeProvinceCode(parse.data.provinceCode)
  if (!province) return reply.code(400).send({ error: 'invalid_province' })

  const community = findCommunity(province, parse.data.communitySlug)
  if (!community) return reply.code(404).send({ error: 'community_not_found' })

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.communityFollow.updateMany({ where: { userId, home: true }, data: { home: false } })
    await tx.communityFollow.upsert({
      where: {
        userId_provinceCode_communitySlug: {
          userId,
          provinceCode: province,
          communitySlug: community.slug,
        },
      },
      create: {
        userId,
        provinceCode: province,
        communitySlug: community.slug,
        home: true,
      },
      update: {
        home: true,
        provinceCode: province,
        communitySlug: community.slug,
      },
    })
  })

  return reply.send({ ok: true, home: community })
})

// Communitys - get follows list
registerCommunityRoute('get', '/communities/follows', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const follows = await prisma.communityFollow.findMany({
    where: { userId },
    orderBy: [{ home: 'desc' }, { createdAt: 'desc' }],
  })

  const items = follows.map((follow: { provinceCode: string; communitySlug: string; home: boolean; createdAt: Date }) => {
    const community = findCommunity(follow.provinceCode, follow.communitySlug)
    return {
      province: follow.provinceCode,
      communitySlug: follow.communitySlug,
      home: follow.home,
      followedAt: follow.createdAt,
      community,
    }
  })

  return reply.send({ items })
})

app.get('/communities/dashboard', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const [user, follows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } }),
    prisma.communityFollow.findMany({
      where: { userId },
      orderBy: [{ home: 'desc' }, { createdAt: 'desc' }],
    }),
  ])

  const followCount = follows.length
  const followKeys: Set<string> = new Set(
    follows.map((follow: { provinceCode: string; communitySlug: string }) => buildFollowKey(follow.provinceCode, follow.communitySlug))
  )

  const referenceFollow = follows.find((follow: { home: boolean }) => follow.home) ?? follows[0] ?? null
  let referenceCity: CityModel | null = null

  if (referenceFollow) {
    referenceCity = await prisma.city.findFirst({
      where: { provinceCode: referenceFollow.provinceCode, communitySlug: referenceFollow.communitySlug },
      orderBy: [{ population: 'desc' }],
    })
  }

  const communityMeta = parseCommunityMeta(user?.communityMeta ?? null)
  let suggestions = filterCachedSuggestions(communityMeta?.nearbyCommunities, followKeys)

  if (!suggestions.length) {
    let computed: CitySummaryType[] = []
    let computedReference: CommunityMetaPayload['reference'] = null

    if (referenceCity) {
      const nearest = await computeNearbyCommunitySuggestions(referenceCity, followKeys)
      if (nearest.length) {
        computed = nearest
        computedReference = {
          provinceCode: referenceCity.provinceCode,
          communitySlug: referenceCity.communitySlug,
          cityName: referenceCity.name,
        }
      }
    }

    if (!computed.length && referenceFollow) {
      const fallback = await computeGeodataFallbackSuggestions(
        { provinceCode: referenceFollow.provinceCode, communitySlug: referenceFollow.communitySlug },
        followKeys,
      )
      if (fallback.length) {
        computed = fallback
        computedReference = {
          provinceCode: referenceFollow.provinceCode,
          communitySlug: referenceFollow.communitySlug,
          cityName: referenceCity?.name ?? null,
        }
      }
    }

    if (computed.length) {
      suggestions = computed.slice()
      const payload: CommunityMetaPayload = {
        nearbyCommunities: computed,
        computedAt: new Date().toISOString(),
        reference: computedReference,
      }
      try {
        await prisma.user.update({ where: { id: userId }, data: { communityMeta: payload } })
      } catch (error) {
        req.log?.warn({ err: error }, 'Failed to persist community meta')
      }
    }
  }

  let postsToday = 0
  if (followKeys.size) {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const orConditions = follows
      .filter((follow: { communitySlug: string }) => follow.communitySlug)
      .map((follow: { provinceCode: string; communitySlug: string }) => ({ provinceCode: follow.provinceCode, communitySlug: follow.communitySlug }))
    if (orConditions.length) {
      postsToday = await prisma.post.count({
        where: {
          createdAt: { gte: startOfToday },
          OR: orConditions,
        },
      })
    }
  }

  return reply.send({
    followCount,
    followTarget: COMMUNITY_FOLLOW_TARGET,
    postsToday,
    suggestions,
    home: referenceCity
      ? {
          provinceCode: referenceCity.provinceCode,
          communitySlug: referenceCity.communitySlug,
          communityName: referenceCity.communityName,
          cityName: referenceCity.name,
        }
      : null,
  })
})

// Communitys - follow additional community
registerCommunityRoute('post', '/communities/follows', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = FollowCommunityInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const province = normalizeProvinceCode(parse.data.provinceCode)
  if (!province) return reply.code(400).send({ error: 'invalid_province' })

  const community = findCommunity(province, parse.data.communitySlug)
  if (!community) return reply.code(404).send({ error: 'community_not_found' })

  const setAsHome = parse.data.setAsHome === true

  const follow = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (setAsHome) {
      await tx.communityFollow.updateMany({ where: { userId, home: true }, data: { home: false } })
    }

    return tx.communityFollow.upsert({
      where: {
        userId_provinceCode_communitySlug: {
          userId,
          provinceCode: province,
          communitySlug: community.slug,
        },
      },
      create: {
        userId,
        provinceCode: province,
        communitySlug: community.slug,
        home: true,
      },
      update: {
        home: true,
        provinceCode: province,
        communitySlug: community.slug,
      },
    })
  })

  return reply.send({
    ok: true,
    follow: {
      province: follow.provinceCode,
      communitySlug: follow.communitySlug,
      home: follow.home,
      community,
    },
  })
})

// Communitys - unfollow
registerCommunityRoute('delete', '/communities/follows', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = UnfollowCommunityInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const province = normalizeProvinceCode(parse.data.provinceCode)
  if (!province) return reply.code(400).send({ error: 'invalid_province' })

  const existing = await prisma.communityFollow.findUnique({
    where: {
      userId_provinceCode_communitySlug: {
        userId,
        provinceCode: province,
        communitySlug: parse.data.communitySlug,
      },
    },
  })

  if (!existing) {
    return reply.code(404).send({ error: 'not_following' })
  }

  await prisma.communityFollow.delete({
    where: {
      userId_provinceCode_communitySlug: {
        userId,
        provinceCode: province,
        communitySlug: parse.data.communitySlug,
      },
    },
  })

  return reply.send({ ok: true })
})

registerCommunityRoute('post', '/communities/geolocate', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = CommunityGeolocateInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  try {
    const { lat, lng, limit, bboxPaddingDegrees } = parse.data
    const { primary, alternatives, meta } = await locateCommunityFromPoint(lat, lng, {
      limit: limit ?? undefined,
      paddingDegrees: bboxPaddingDegrees ?? undefined,
    })
    const enriched = await enrichMatchesWithCities([primary, ...alternatives], lat, lng)
    const [enrichedPrimary, ...enrichedAlternatives] = enriched
    return reply.send({
      primary: enrichedPrimary ?? null,
      alternatives: enrichedAlternatives.filter((entry): entry is EnrichedGeoMatch => Boolean(entry)),
      meta,
    })
  } catch (error) {
    req.log.error({ err: error }, 'community_geolocate_failed')
    return reply.code(500).send({ error: 'geolocation_failed' })
  }
})

app.post('/postal/geolocate', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = PostalGeolocateInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  try {
    const { lat, lng, limit, bboxPaddingDegrees } = parse.data
    const fsaResult = await locateFsaFromPoint(lat, lng, {
      paddingDegrees: bboxPaddingDegrees ?? undefined,
    })
    if (!fsaResult.match) {
      return reply.code(404).send({ error: 'fsa_not_found' })
    }

    const communityMatches = await locateCommunityFromPoint(lat, lng, {
      limit: limit ?? undefined,
      paddingDegrees: bboxPaddingDegrees ?? undefined,
    })
    const enriched = await enrichMatchesWithCities([communityMatches.primary, ...communityMatches.alternatives], lat, lng)
    const [primary, ...alternativeMatches] = enriched

    return reply.send({
      postalCode: fsaResult.match.code,
      fsa: {
        code: fsaResult.match.code,
        provinceCode: fsaResult.match.provinceCode ?? null,
        subdivisionId: fsaResult.match.subdivisionId ?? null,
        subdivisionName: fsaResult.match.subdivisionName ?? null,
        centroidLat: fsaResult.match.centroidLat ?? null,
        centroidLng: fsaResult.match.centroidLng ?? null,
        defaultCommunitySlug: fsaResult.match.defaultCommunitySlug ?? null,
        defaultCommunityName: fsaResult.match.defaultCommunityName ?? null,
      },
      primary: primary ?? null,
      alternatives: alternativeMatches.filter((entry): entry is EnrichedGeoMatch => Boolean(entry)),
    })
  } catch (error) {
    req.log.error({ err: error }, 'postal_geolocate_failed')
    return reply.code(500).send({ error: 'postal_geolocate_failed' })
  }
})

registerCommunityRoute('post', '/communities/postal-lookup', async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = (req as any).user?.id
  if (!userId) return reply.code(401).send({ error: 'unauthorized' })

  const parse = PostalLookupInput.safeParse(req.body)
  if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

  const normalized = normalizePostalCodeInput(parse.data.postalCode)
  if (!normalized) {
    return reply.code(400).send({ error: 'invalid_postal_code' })
  }

  try {
    const fsaRecord = await prisma.forwardSortationArea.findUnique({
      where: { code: normalized.fsa },
      select: {
        code: true,
        provinceCode: true,
        subdivisionId: true,
        subdivisionName: true,
        centroidLat: true,
        centroidLng: true,
        defaultCommunitySlug: true,
        defaultCommunityName: true,
      },
    })

    if (!fsaRecord) {
      return reply.code(404).send({ error: 'fsa_not_found' })
    }

    let coords = statsCanPointToWgs84(fsaRecord.centroidLat, fsaRecord.centroidLng)
    if (!coords) {
      const fallbackCity = await (fsaRecord.subdivisionId || fsaRecord.provinceCode
        ? prisma.city.findFirst({
            where: fsaRecord.subdivisionId
              ? { censusSubdivisionId: fsaRecord.subdivisionId }
              : { provinceCode: fsaRecord.provinceCode ?? undefined },
            orderBy: { population: 'desc' },
          })
        : null)
      if (fallbackCity) {
        coords = { lat: fallbackCity.latitude, lng: fallbackCity.longitude }
      }
    }

    let enrichedPrimary: EnrichedGeoMatchOrNull = null
    let enrichedAlternatives: EnrichedGeoMatch[] = []
    if (coords) {
      const locateResult = await locateCommunityFromPoint(coords.lat, coords.lng, {
        limit: parse.data.limit ?? undefined,
      })
      const enriched = await enrichMatchesWithCities([locateResult.primary, ...locateResult.alternatives], coords.lat, coords.lng)
      const [primaryMatch, ...alternativeMatches] = enriched
      enrichedPrimary = primaryMatch ?? null
      enrichedAlternatives = alternativeMatches.filter((entry): entry is EnrichedGeoMatch => Boolean(entry))
    }

    return reply.send({
      postalCode: normalized.postal,
      fsa: {
        code: fsaRecord.code,
        provinceCode: fsaRecord.provinceCode ?? null,
        subdivisionId: fsaRecord.subdivisionId ?? null,
        subdivisionName: fsaRecord.subdivisionName ?? null,
        centroidLat: coords?.lat ?? null,
        centroidLng: coords?.lng ?? null,
        defaultCommunitySlug: fsaRecord.defaultCommunitySlug ?? null,
        defaultCommunityName: fsaRecord.defaultCommunityName ?? null,
      },
      primary: enrichedPrimary,
      alternatives: enrichedAlternatives,
    })
  } catch (error) {
    req.log.error({ err: error }, 'postal_lookup_failed')
    return reply.code(500).send({ error: 'postal_lookup_failed' })
  }
})

// Basic auth hook (placeholder)
app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
      if (!payload?.sub || typeof payload.sub !== 'string') {
        return reply.code(401).send({ error: 'unauthorized' })
      }

      if (payload.actor === 'family_member') {
        const member = await loadFamilyMemberAuthViewerById(payload.sub, payload.parentId ?? null)
        if (!member) {
          return reply.code(401).send({ error: 'unauthorized' })
        }
        ;(req as any).familyMemberAuth = { memberId: member.id, parentId: member.parentId }
        return
      }

      const user = await loadActiveAuthUserById(payload.sub)
      if (!user) {
        return reply.code(403).send({ error: 'account_suspended' })
      }
      ;(req as any).user = { id: user.id }
    } catch {
      // ignore, public routes allowed
    }
  }
})

registerProfileMediaRoutes(app, {
  FAMILY_FEED_POST_TYPE,
  FAMILY_NOTIFICATION_TYPES,
  MEDIA_BUCKET_ORIGINAL,
  MEDIA_CATEGORY_LIMITS,
  MEDIA_PROXY_UPLOAD_LIMIT,
  MEDIA_SIGNED_URL_TTL,
  buildFamilyFeedPostTitle,
  buildFamilyMemberAuthMeResponse,
  buildHomeCommunitySummaryForUserId,
  buildOriginalObjectKey,
  createNotificationRecord,
  enqueueContentAiScanForPost,
  ensureMimeSupported,
  extensionForMime,
  extractVariantUrl,
  familyMemberOwnsAssetForSession,
  formatChildFamilyFeedPost,
  formatPost,
  generateUniqueHandle,
  isExperienceTableMissing,
  isFamilyMemberTableMissing,
  isPrivateOrLocalNetworkUrl,
  isSchemaOutOfDateError,
  loadViewerAuthContext,
  mediaQueue,
  normalizeFamilyMemberSummary,
  normalizeMediaUrl,
  normalizeMediaVariants,
  normalizeRichTextHtml,
  normalizeUserMedia,
  parseCommunityMeta,
  readBaseCommunityMeta,
  readRequestBuffer,
  s3Client,
  withSchemaGuard,
  writeLegacyFamilyMemberProfileMedia,
})

registerPostInteractionRoutes(app, {
  COMMENT_NOTIFICATION_TYPES,
  DEFAULT_JURISDICTION,
  MAX_POLL_OPTIONS,
  POST_INCLUDE,
  buildCommentTree,
  buildPostSlugBase,
  canViewerAccessFamilyAudiencePost,
  canViewerAccessPostForPreview,
  createNotificationRecord,
  enqueueContentAiScanForComment,
  enqueueContentAiScanForPost,
  filterCommentRowsForViewer,
  formatPost,
  generateUniquePostSlug,
  getCanonicalPaths,
  getPollResultsAvailableAt,
  getStoredProfileFamilyRelationships,
  isPostHiddenFromViewer,
  loadViewerBlockState,
  loadViewerPostFormattingContext,
  mapComment,
  mapPollResultsVisibilityToDb,
  moderationLockedErrorCode,
  parseCommunityMeta,
  refreshCommentAggregates,
  refreshPostAggregates,
  sanitizePlainText,
  sanitizeRichTextHtml,
  truncatePushBody,
  withSchemaGuard,
})

registerPostReadRoutes(app, {
  FAMILY_FEED_POST_TYPE,
  POST_INCLUDE,
  PostImpressionTrackInput,
  applyVisibleModerationFiltersToPostWhere,
  buildCommentTree,
  canViewerAccessFamilyAudiencePost,
  filterCommentRowsForViewer,
  formatPost,
  getCanonicalPaths,
  isPostHiddenFromViewer,
  loadViewerBlockState,
  loadViewerFeedContext,
  loadViewerPollSelectionsByPostIds,
  loadViewerPostFormattingContext,
  parseFeedRankCursor,
  rankFeedPosts,
  recordUserPostImpressions,
  syncLegacyParentFamilyFeedPosts,
  withSchemaGuard,
})

registerProfileInviteRoutes(app, {
  FAMILY_FEED_POST_TYPE,
  PROFILE_INVITE_NOTIFICATION_TYPES,
  buildFamilyFeedPostTitle,
  getStoredProfileFamilyRelationships,
  notifyProfileEventInvite,
  notifyProfileFamilyInvite,
  notifyProfileOrganizationInvite,
  readOrganizationSystemState,
  resolveUserId,
  withSchemaGuard,
})

registerUserProfilePostRoutes(app, {
  FAMILY_FEED_POST_TYPE,
  POST_INCLUDE,
  applyVisibleModerationFiltersToPostWhere,
  buildFamilyFeedPostTitle,
  buildFamilyProfileRelationshipPayload,
  canViewerAccessFamilyAudiencePost,
  findConnectionBetween,
  findFamilyMemberByUsername,
  formatPost,
  getStoredFamilyFriendships,
  isExperienceTableMissing,
  isPremium,
  isSelfVerifiedCanadianCitizen,
  loadViewerAuthContext,
  loadViewerBlockState,
  loadViewerPostFormattingContext,
  normalizeFamilyMemberSummary,
  normalizeMediaUrl,
  normalizeUserMedia,
  parseCommunityMeta,
  resolveFamilyProfileAccess,
  withSchemaGuard,
})

// Auth: login
app.post('/auth/login', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const parse = LoginInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })
    const { emailOrHandle, password } = parse.data
    const rawIdentifier = emailOrHandle.trim()
    const identifier = rawIdentifier.startsWith('@') ? rawIdentifier.slice(1) : rawIdentifier

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: identifier, mode: 'insensitive' } },
          { handle: { equals: identifier, mode: 'insensitive' } },
        ],
      },
    })
    if (!user) return reply.code(401).send({ error: 'invalid_credentials' })
    if (isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })
    const ok = await bcrypt.compare(password, (user as any).passwordHash)
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' })
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    const token = await (app as any).jwt.sign({ sub: user.id })
    return reply.send({ token, user: { id: user.id, email: user.email, handle: user.handle, name: user.name } })
  }),
)

// Auth: me
app.get('/auth/me', async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const payload = (await (req as any).jwtVerify()) as AuthJwtPayload
    if (!payload?.sub || typeof payload.sub !== 'string') {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    if (payload.actor === 'family_member') {
      const member = await loadFamilyMemberAuthViewerById(payload.sub, payload.parentId ?? null)
      if (!member) return reply.code(401).send({ error: 'unauthorized' })

      const homeCommunity = await buildHomeCommunitySummaryForUserId(member.parentId)
      return reply.send(buildFamilyMemberAuthMeResponse(member, homeCommunity))
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        handle: true,
        name: true,
        avatarUrl: true,
        coverUrl: true,
        communityMeta: true,
        premiumStatus: true,
        premiumSince: true,
        premiumRenewsAt: true,
      },
    })
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

    const homeCommunity = await buildHomeCommunitySummaryForUserId(payload.sub)

    const normalizedUser = normalizeUserMedia(user)
    const communityMeta = parseCommunityMeta(user.communityMeta ?? null)
    let familyMemberCount = 0
    try {
      familyMemberCount = await prisma.familyMember.count({ where: { parentId: payload.sub } })
    } catch (error) {
      if (!isFamilyMemberTableMissing(error)) throw error
    }
    const familyRelationshipCount = Array.from(
      new Set(getStoredProfileFamilyRelationships(user.communityMeta).map((entry) => entry.relatedUserId).filter(Boolean)),
    ).length
    return reply.send({
      ...normalizedUser,
      homeCommunity,
      isPremium: isPremium(user.premiumStatus),
      isVerified: isSelfVerifiedCanadianCitizen(communityMeta),
      premiumSince: user.premiumSince ?? null,
      premiumRenewsAt: user.premiumRenewsAt ?? null,
      civicStatus: communityMeta?.civicStatus ?? null,
      workAuthorization: communityMeta?.workAuthorization ?? null,
      verificationMethod: communityMeta?.verificationMethod ?? null,
      statusDeclaredAt: communityMeta?.statusDeclaredAt ?? null,
      statusUpdatedAt: communityMeta?.statusUpdatedAt ?? null,
      familyMode: {
        enabled: Boolean(communityMeta?.familyMode?.enabledAt),
        enabledAt: communityMeta?.familyMode?.enabledAt ?? null,
        affirmedProfileTruthAt: communityMeta?.familyMode?.affirmedProfileTruthAt ?? null,
        acceptedChildSafetyInfoAt: communityMeta?.familyMode?.acceptedChildSafetyInfoAt ?? null,
        memberCount: familyMemberCount,
        relationshipCount: familyRelationshipCount,
      },
      accountType: 'user',
      familyMemberSession: null,
    })
  } catch {
    return reply.code(401).send({ error: 'unauthorized' })
  }
})

app.post('/auth/status-declaration', async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const payload = await (req as any).jwtVerify()
    const body = UpdateCivilStatusBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { communityMeta: true } })
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
  if (isAccountSuspended(user.communityMeta)) return reply.code(403).send({ error: 'account_suspended' })

    const baseMeta = readBaseCommunityMeta(user.communityMeta)
    const currentMeta = parseCommunityMeta(user.communityMeta ?? null)
    const nowIso = new Date().toISOString()
    const workAuthorization =
      body.data.civicStatus === 'citizen' || body.data.civicStatus === 'permanent_resident'
        ? 'authorized'
        : body.data.workAuthorization ?? 'unspecified'

    baseMeta.civicStatus = body.data.civicStatus
    baseMeta.workAuthorization = workAuthorization
    baseMeta.verificationMethod = 'self_declaration'
    baseMeta.statusDeclaredAt = currentMeta?.statusDeclaredAt ?? nowIso
    baseMeta.statusUpdatedAt = nowIso

    await prisma.user.update({ where: { id: payload.sub }, data: { communityMeta: baseMeta } })

    return reply.send({
      civicStatus: body.data.civicStatus,
      workAuthorization,
      verificationMethod: 'self_declaration',
      statusDeclaredAt: currentMeta?.statusDeclaredAt ?? nowIso,
      statusUpdatedAt: nowIso,
    })
  } catch {
    return reply.code(401).send({ error: 'unauthorized' })
  }
})

registerPushRoutes(app, {
  ensurePushDeviceRegistryTable,
  getHeaderValue,
  normalizePushToken,
  pushRegisterSecret: PUSH_REGISTER_SECRET,
  redis,
  resolveUserId,
  withSchemaGuard,
})

registerSocialGraphRoutes(app, {
  buildFamilySponsorFriendshipId,
  createNotificationRecord,
  dispatchNotification: (record) => dispatchNotification(record as any),
  familyNotificationTypes: FAMILY_NOTIFICATION_TYPES,
  findConnectionBetween,
  findConnectionById,
  formatFamilyChildFriendship: (entry) => formatFamilyChildFriendship(entry as any),
  formatFamilySponsorFriendship,
  formatFriendRequest,
  formatFriendUser,
  formatFriendship,
  friendNotificationTypes: FRIEND_NOTIFICATION_TYPES,
  friendUserSelect: FRIEND_USER_SELECT,
  friendshipWithUsersInclude: FRIENDSHIP_WITH_USERS_INCLUDE,
  getStoredFamilyFriendships,
  isConnectionTableMissingError,
  loadViewerAuthContext,
  normalizeFamilyMemberSummary,
  notificationSelect: NOTIFICATION_SELECT,
  notifyConnectionAcceptance,
  notifyConnectionRequest,
  notifyFriendAcceptance,
  notifyFriendRequest,
  withSchemaGuard,
})

const civilAiExecutionHelpers = createCivilAiExecutionHelpers({
  processingJobIds: civilAiProcessingJobIds,
  jobAbortControllers: civilAiJobAbortControllers,
  logger: app.log,
  buildCivilAiCompactList,
  buildCivilAiContextPrompt: (viewerContext) => buildCivilAiContextPrompt(viewerContext as any),
  buildCivilAiDirectAnswer: (question, viewerContext) => buildCivilAiDirectAnswer(question, viewerContext as any),
  buildCivilAiEffectiveQuestion,
  buildCivilAiGroundedAnswer: (question, bundle) => buildCivilAiGroundedAnswer(question, bundle as any),
  buildCivilAiMarketSearchScope,
  buildCivilAiPromptInput,
  callCivilAiServerWithPathFallback: (args) => callCivilAiServerWithPathFallback(args as any),
  ensureCivilAiJobTables,
  extractCivilAiMessageContent,
  finalizeCivilAiReferences,
  formatCivilAiShortDateTime,
  loadCivilAiCommunityEvents,
  loadCivilAiCommunityJobs,
  loadCivilAiCommunityOrganizations,
  loadCivilAiCommunityPosts: (communityId, limit, query, viewerFeedContext) => loadCivilAiCommunityPosts(communityId, limit, query, viewerFeedContext as any) as any,
  loadCivilAiChatJob: (jobId) => loadCivilAiChatJob(jobId),
  loadCivilAiViewerContext,
  loadCivilAiInstructions: readCivilAiInstructions,
  matchCivilAiRequestedCommunities: (question, viewerContext) => matchCivilAiRequestedCommunities(question, viewerContext as any) as any,
  normalizeSearchTerm,
  persistCivilAiDebugTurn,
  persistCivilAiHistory,
  planCivilAiRetrieval,
  readCivilAiHistory: (meta) => readCivilAiHistory(meta as any),
  resolveCivilAiModel,
  resolveCivilAiServer,
  sanitizeCivilAiResponseContent,
  searchMarketListingsForQuery,
  selectCivilAiActiveMessages,
  serializeError,
  shouldCivilAiRunSecondSearch: (question, bundle) => shouldCivilAiRunSecondSearch(question, bundle as any),
  toCivilAiCommunityReference: (community) => toCivilAiCommunityReference(community as any),
  toCivilAiEventReference: (item) => toCivilAiEventReference(item as any),
  toCivilAiJobReference: (item) => toCivilAiJobReference(item as any),
  toCivilAiMarketReference: (item) => toCivilAiMarketReference(item as any),
  toCivilAiOrganizationReference: (item) => toCivilAiOrganizationReference(item as any),
  toCivilAiPostReference: (item) => toCivilAiPostReference(item as any),
  truncateCivilAiText,
})

const createCivilAiChatJob = civilAiExecutionHelpers.createCivilAiChatJob
const loadActiveCivilAiChatJobForUser = civilAiExecutionHelpers.loadActiveCivilAiChatJobForUser
const loadCivilAiChatJob = civilAiExecutionHelpers.loadCivilAiChatJob
const scheduleCivilAiChatJob = civilAiExecutionHelpers.scheduleCivilAiChatJob
const formatCivilAiChatJobPayload = civilAiExecutionHelpers.formatCivilAiChatJobPayload
const cancelCivilAiChatJob = civilAiExecutionHelpers.cancelCivilAiChatJob

registerAiRoutes(app, {
  authorizeCivilAiDataRequest,
  buildCivilAiApiCatalog: (viewerContext) => buildCivilAiApiCatalog(viewerContext as any),
  buildCivilAiEffectiveQuestion,
  callCivilAiServer: (args) => callCivilAiServer(args as any),
  callCivilAiServerWithPathFallback: (args) => callCivilAiServerWithPathFallback(args as any),
  cancelCivilAiChatJob,
  createCivilAiChatJob,
  formatCivilAiChatJobPayload: (job) => formatCivilAiChatJobPayload(job as any),
  loadActiveCivilAiChatJobForUser,
  loadCivilAiChatJob,
  loadCivilAiCommunityEvents,
  loadCivilAiCommunityJobs,
  loadCivilAiCommunityOrganizations,
  loadCivilAiCommunityPosts: (communityId, limit, query, viewerFeedContext) => loadCivilAiCommunityPosts(communityId, limit, query, viewerFeedContext as any),
  loadCivilAiServersConfig,
  loadCivilAiViewerContext,
  loadViewerAuthContext,
  parseCivilAiChatInput: (value) => CivilAiChatInput.safeParse(value),
  parseCivilAiCommunityId,
  readCivilAiHistory: (meta) => readCivilAiHistory(meta as any),
  readCivilAiInstructions,
  resolveCivilAiServer,
  resolveUserId,
  scheduleCivilAiChatJob,
  searchMarketListingsForQuery: (query, limit) => searchMarketListingsForQuery(normalizeSearchTerm(query), limit),
  toCivilAiCommunityReference: (community) => toCivilAiCommunityReference(community as any),
  toCivilAiEventReference: (item) => toCivilAiEventReference(item as any),
  toCivilAiJobReference: (item) => toCivilAiJobReference(item as any),
  toCivilAiMarketReference: (item) => toCivilAiMarketReference(item as any),
  toCivilAiOrganizationReference: (item) => toCivilAiOrganizationReference(item as any),
  toCivilAiPostReference: (item) => toCivilAiPostReference(item as any),
  withSchemaGuard,
})

registerAdminAiDebugRoutes(app, {
  civilPublicHost: CIVIL_PUBLIC_HOST,
  ensureCivilAiDebugTables,
  getCivilPublicBaseUrl,
  isSuperAdminEmail,
  loadAuthenticatedUser,
  loadCivilAiServersConfig,
})

registerAdminModerationRoutes(app, {
  buildModerationSuspensionReason,
  loadAdminUserOrReply,
  normalizeMediaUrl,
  suspendBusinessForModeration,
  suspendUserForModeration,
})

registerAdminReportingRoutes(app, {
  buildCommunityHref,
  buildPostHrefForAdmin,
  formatAdminUserSummary,
  formatCommunityFollowLabel,
  isSuperAdminEmail,
  loadAdminUserOrReply,
  loadAuthenticatedUser,
  parseRange,
  queryDailyCounts,
  queryFollowSeries,
  queryJobAnalyticsSeries,
  queryPageViewSeries,
  retryContentAiScanTarget,
  sanitizePlainText,
  startOfUtcDay,
})

registerAdminAnalyticsDetailRoutes(app, {
  buildAdminUserSearchWhere,
  buildBusinessHrefForAdmin,
  buildCommunityHref,
  buildOrganizationEventScanTargetId,
  buildPostHrefForAdmin,
  buildSearchableText,
  ensureCitizenMarketplaceTables,
  ensureContentAiScanTables,
  formatAdminUserSummary,
  formatCommunityFollowLabel,
  loadAdminUserOrReply,
  normalizeSearchTerm,
  parseRange,
  readOrganizationSystemState,
  readStringList,
  sanitizePlainText,
  stripHtmlToPlainText,
  summarizeReportReasons,
})

registerAdminSystemRoutes(app, {
  buildAdminChecklist,
  isStripeConfigured,
  isSuperAdminEmail,
  loadAdminUserOrReply,
  loadAuthenticatedUser,
})

registerNotificationsSearchRoutes(app, {
  NOTIFICATION_CHANNEL_PREFIX,
  NOTIFICATION_FEED_EXCLUDED_TYPES,
  REDIS_URL,
  clearUserRealtimeOnline,
  formatFriendUser,
  formatNotification,
  markUserRealtimeOnline,
  normalizeSearchTerm,
  resolveStreamUserId,
  searchCommunitiesForQuery,
  searchCommunityPostsForQuery,
  searchEventsForQuery,
  searchMarketListingsForQuery,
  searchOrganizationsForQuery,
  searchUsersForQuery,
  withSchemaGuard,
})

registerMessagesCoreRoutes(app, {
  MESSAGE_CALL_SELECT,
  THREAD_SUMMARY_INCLUDE,
  buildDirectThreadKey,
  buildFamilyDirectThreadKey,
  buildFamilyParentConversationThread,
  buildGroupThreadKey,
  clearScheduledMessageCallTimeout,
  dispatchRealtimeEvent,
  familyMemberCanAccessMessageThread,
  finalizeMessageCall,
  findExistingExactThreadId,
  formatDisplayNameForPush,
  formatMessageCall,
  formatThreadBase,
  formatThreadSummaryRecord,
  getFamilyMessageThreadIdsForMember,
  getFamilyParentConversation,
  getStoredFamilyMessageThreads,
  isMessageCallLive,
  isThreadMuted,
  isUserRealtimeOnline,
  issueMeetingRtcSession,
  loadCallableMessageThreadForUser,
  loadFriendIdSet,
  loadLiveThreadCall,
  loadMessageCallForUser,
  loadParentFamilyConversationThreads,
  loadViewerAuthContext,
  normalizeMessageLinkPath,
  resolveActingUserId,
  resolveMessageLinkPreview,
  resolveUserId,
  scheduleMessageCallTimeout,
  sendNativePushForIncomingCall,
  sendPushToUser,
  storeFamilyMessageThreadForMember,
  usersAreAcceptedConnections,
  usersAreFriends,
  withSchemaGuard,
})

registerMessagesDetailRoutes(app, {
  FRIEND_USER_SELECT,
  MESSAGE_SELECT,
  PUSH_DELIVERY_URL,
  THREAD_SUMMARY_INCLUDE,
  buildFamilyParentConversationThread,
  buildFamilyParentThreadId,
  buildFamilyRtcUserId,
  buildParentFamilyConversationThread,
  buildParentFamilyThreadId,
  deliverNativePushToToken,
  dispatchRealtimeEvent,
  familyMemberCanAccessMessageThread,
  fetchFamilyParentConversationMessages,
  fetchParentFamilyConversationMessages,
  fetchThreadMessages,
  formatDisplayNameForPush,
  formatFamilyCallSummary,
  formatFamilyParentConversationMessage,
  formatFriendUser,
  formatMessage,
  formatNormalizedFamilyMemberThreadUser,
  formatParentFamilyConversationMessage,
  formatThreadBase,
  formatThreadSummaryRecord,
  getFamilyMessageThreadIdsForMember,
  getFamilyParentConversation,
  getStoredFamilyParentConversations,
  isParentFamilyThreadId,
  isUserRealtimeOnline,
  issueMeetingRtcSession,
  loadActiveNativePushTargets,
  loadFamilyCallContext,
  loadFamilyCallForMember,
  loadFamilyCallRecord,
  loadFriendIdSet,
  loadParentFamilyConversationContext,
  loadThreadForUser,
  loadUnreadMessageCount,
  loadViewerAuthContext,
  markFamilyParentConversationRead,
  normalizeFamilyMemberSummary,
  parseParentFamilyThreadId,
  sanitizePlainText,
  sendMobilePushForMessageCreated,
  sendNativePushForIncomingCall,
  sendPushToUser,
  storeFamilyMessageThreadForMember,
  storeFamilyParentConversationMessage,
  truncatePushBody,
  withSchemaGuard,
  writeFamilyCallRecord,
})

registerFamilyRoutes(app, {
  FAMILY_FEED_POST_TYPE,
  FAMILY_MEMBER_USERNAME_MAX_LENGTH,
  FAMILY_MEMBER_USERNAME_MIN_LENGTH,
  FAMILY_NOTIFICATION_TYPES,
  POST_INCLUDE,
  buildFamilyFeedPostTitle,
  buildFamilyMemberAuthMeResponse,
  buildFamilySuspensionMessage,
  buildHomeCommunitySummaryForUserId,
  buildLegacyFamilyFeedMirrorKey,
  buildPostSlugBase,
  createNotificationRecord,
  extractVariantUrl,
  familyMemberOwnsAssetForSession,
  findFamilyMemberByInviteCode,
  findFamilyMemberByUsername,
  findPendingFamilyFriendRequest,
  formatChildFamilyFeedPost,
  formatParentFamilyFeedPost,
  formatPost,
  generateUniqueFamilyFriendCode,
  generateUniqueFamilyMemberUsername,
  generateUniquePostSlug,
  getLegacyFamilyMemberPermissionSettings,
  getLegacyFamilyMemberStoredProfileMedia,
  getLegacyFamilyMemberStoredUsername,
  getStoredFamilyFriendRequests,
  getStoredFamilyFriendships,
  getStoredProfileFamilyRelationships,
  hasAcceptedFamilyFriendship,
  isAccountSuspended,
  isFamilyMemberTableMissing,
  isFamilyMemberUsernameTaken,
  isParentProfileEligibleForFamilyMode,
  isSchemaOutOfDateError,
  isValidFamilyMemberUsername,
  loadAuthenticatedUser,
  loadFamilyMemberAuthViewerById,
  loadFamilyMemberSummaryForParent,
  loadLatestFamilyPostAtByMember,
  loadProfileFamilyRelationshipsForRail,
  loadViewerAuthContext,
  loadViewerPostFormattingContext,
  normalizeFamilyMemberDraftEditorRecord,
  normalizeFamilyMemberDraftSummary,
  normalizeFamilyMemberSummary,
  normalizeFamilyMemberUsernameCandidate,
  normalizeFamilyMemberUsernameLookup,
  parseCommunityMeta,
  parseFamilyMemberDateOfBirth,
  readBaseCommunityMeta,
  resolveFamilyFeedTargetMember,
  resolveReadableFamilyFeedTargetMember,
  sanitizePlainText,
  updateFamilyMemberSummaryForParent,
  upsertFamilyFriendRequest,
  withSchemaGuard,
  writeLegacyFamilyMemberPermissionSettings,
  writeLegacyFamilyMemberUsername,
  writeStoredFamilyFriendRequests,
})

registerUserConnectionsRoutes(app, {
  formatFriendUser,
  loadAcceptedFriendIds,
  loadViewerAuthContext,
  normalizeMediaUrl,
  normalizeUserMedia,
  withSchemaGuard,
})

app.post('/users/:handle/follow', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    return reply.code(410).send({ error: 'person_follow_disabled' })
  }),
)

app.delete('/users/:handle/follow', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    return reply.code(410).send({ error: 'person_follow_disabled' })
  }),
)

function buildMarketListingDirectThreadKey(listingId: string, userA: string, userB: string): string {
  const [a, b] = [userA, userB].sort()
  return `marketlisting:${listingId}:${a}:${b}`
}

type OrgChatPrefs = {
  muteServer?: boolean
  mentionsOnly?: boolean
  channels?: Record<string, { muteChannel?: boolean; mentionsOnly?: boolean }>
}

let organizationShopTablesReady: Promise<void> | null = null
let citizenMarketplaceTablesReady: Promise<void> | null = null
let organizationMeetingTablesReady: Promise<void> | null = null
const ORGANIZATION_MEETING_MAX_PARTICIPANTS = 10

type OrganizationMeetingStatus = 'ACTIVE' | 'ARCHIVED'
type OrganizationMeetingVisibility = 'PUBLIC' | 'PRIVATE'
type OrganizationMeetingAdmissionStatus = 'WAITING' | 'ADMITTED' | 'DENIED'

type OrganizationMeetingRow = {
  id: string
  business_id: string
  created_by: string | null
  title: string
  description: string | null
  visibility: string
  status: string
  requires_password: boolean
  password_hash: string | null
  requires_manual_admit: boolean
  max_participants: number | null
  schedule_starts_at: Date | null
  schedule_ends_at: Date | null
  thread_id: string | null
  created_at: Date
  updated_at: Date
}

type OrganizationMeetingAssignmentRow = {
  meeting_id: string
  user_id: string
}

type OrganizationMeetingAdmissionRow = {
  meeting_id: string
  user_id: string
  status: string
}

type OrganizationMeetingWaitingParticipant = {
  userId: string
  status: OrganizationMeetingAdmissionStatus
  name: string
  handle: string | null
  avatarUrl: string | null
}

function normalizeMeetingStatus(value: string | null | undefined): OrganizationMeetingStatus {
  return value === 'ACTIVE' ? 'ACTIVE' : 'ARCHIVED'
}

function normalizeMeetingVisibility(value: string | null | undefined): OrganizationMeetingVisibility {
  return value === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'
}

function normalizeMeetingAdmissionStatus(value: string | null | undefined): OrganizationMeetingAdmissionStatus | null {
  if (value === 'WAITING' || value === 'ADMITTED' || value === 'DENIED') return value
  return null
}

function normalizeMeetingMaxParticipants(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ORGANIZATION_MEETING_MAX_PARTICIPANTS
  return Math.max(1, Math.min(ORGANIZATION_MEETING_MAX_PARTICIPANTS, Math.trunc(value)))
}

function mapMeetingRowForViewer(args: {
  row: OrganizationMeetingRow
  participantCount: number
  canManageMeetings: boolean
  isAssociated: boolean
  isAssigned: boolean
  isParticipant: boolean
  admissionStatus: OrganizationMeetingAdmissionStatus | null
}): {
  id: string
  title: string
  description: string | null
  visibility: OrganizationMeetingVisibility
  status: OrganizationMeetingStatus
  requiresPassword: boolean
  requiresManualAdmit: boolean
  maxParticipants: number | null
  participantCount: number
  canJoinNow: boolean
  blockedReason: string | null
  schedule: {
    startsAt: string | null
    endsAt: string | null
  }
  threadId: string | null
  admissionStatus: OrganizationMeetingAdmissionStatus | null
} {
  const status = normalizeMeetingStatus(args.row.status)
  const visibility = normalizeMeetingVisibility(args.row.visibility)
  const startsAt = args.row.schedule_starts_at ? new Date(args.row.schedule_starts_at).toISOString() : null
  const endsAt = args.row.schedule_ends_at ? new Date(args.row.schedule_ends_at).toISOString() : null

  let canJoinNow = true
  let blockedReason: string | null = null
  const now = Date.now()

  if (status !== 'ACTIVE' && !args.canManageMeetings) {
    canJoinNow = false
    blockedReason = 'meeting_not_published'
  } else if (visibility === 'PRIVATE' && !args.canManageMeetings && !args.isAssociated && !args.isAssigned) {
    canJoinNow = false
    blockedReason = 'meeting_private'
  } else if (startsAt && now < new Date(startsAt).getTime()) {
    canJoinNow = false
    blockedReason = 'meeting_not_started'
  } else if (endsAt && now > new Date(endsAt).getTime()) {
    canJoinNow = false
    blockedReason = 'meeting_ended'
  } else if (
    typeof args.row.max_participants === 'number' &&
    args.row.max_participants > 0 &&
    args.participantCount >= args.row.max_participants &&
    !args.isParticipant &&
    !args.canManageMeetings
  ) {
    canJoinNow = false
    blockedReason = 'meeting_full'
  } else if (args.row.requires_manual_admit && args.admissionStatus === 'WAITING' && !args.canManageMeetings) {
    canJoinNow = false
    blockedReason = 'waiting_for_admit'
  }

  const exposeThreadId = args.canManageMeetings || args.isParticipant || args.admissionStatus === 'ADMITTED'

  return {
    id: args.row.id,
    title: args.row.title || 'Untitled meeting',
    description: args.row.description ?? null,
    visibility,
    status,
    requiresPassword: Boolean(args.row.requires_password),
    requiresManualAdmit: Boolean(args.row.requires_manual_admit),
    maxParticipants: normalizeMeetingMaxParticipants(args.row.max_participants),
    participantCount: Number.isFinite(args.participantCount) ? Math.max(0, args.participantCount) : 0,
    canJoinNow,
    blockedReason,
    schedule: {
      startsAt,
      endsAt,
    },
    threadId: exposeThreadId ? args.row.thread_id ?? null : null,
    admissionStatus: args.admissionStatus,
  }
}

function ensureOrganizationMeetingTables() {
  if (organizationMeetingTablesReady) return organizationMeetingTablesReady

  organizationMeetingTablesReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_meeting (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
          created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          description TEXT,
          visibility TEXT NOT NULL DEFAULT 'PUBLIC',
          status TEXT NOT NULL DEFAULT 'ARCHIVED',
          requires_password BOOLEAN NOT NULL DEFAULT FALSE,
          password_hash TEXT,
          requires_manual_admit BOOLEAN NOT NULL DEFAULT FALSE,
          max_participants INTEGER,
          schedule_starts_at TIMESTAMPTZ,
          schedule_ends_at TIMESTAMPTZ,
          thread_id TEXT REFERENCES "MessageThread"(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_meeting_business_status_idx
        ON organization_meeting (business_id, status, updated_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_meeting_assignment (
          meeting_id TEXT NOT NULL REFERENCES organization_meeting(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (meeting_id, user_id)
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_meeting_assignment_user_idx
        ON organization_meeting_assignment (user_id, meeting_id);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_meeting_admission (
          meeting_id TEXT NOT NULL REFERENCES organization_meeting(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'WAITING',
          decided_by_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (meeting_id, user_id)
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_meeting_admission_status_idx
        ON organization_meeting_admission (meeting_id, status, updated_at DESC);
      `)
    } catch (err) {
      organizationMeetingTablesReady = null
      throw err
    }
  })()

  return organizationMeetingTablesReady
}

function ensureOrganizationShopTables() {
  if (organizationShopTablesReady) return organizationShopTablesReady
  organizationShopTablesReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_shop_settings (
          business_id TEXT PRIMARY KEY REFERENCES "Business"(id) ON DELETE CASCADE,
          head_office_address TEXT,
          warehouse_same_as_head_office BOOLEAN NOT NULL DEFAULT TRUE,
          direct_deposit_transit TEXT,
          direct_deposit_institution TEXT,
          direct_deposit_account TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_shop_warehouse (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          address TEXT,
          is_head_office BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_shop_catalog (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          image_url TEXT,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_catalog
        ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_shop_product (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
          catalog_id TEXT REFERENCES organization_shop_catalog(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          description TEXT,
          price_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'CAD',
          sku TEXT,
          primary_image_url TEXT,
          gallery_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
          weight_grams INTEGER,
          shipping_policy TEXT NOT NULL DEFAULT 'local_community',
          allow_shipping_contracts BOOLEAN NOT NULL DEFAULT FALSE,
          is_draft BOOLEAN NOT NULL DEFAULT FALSE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          track_inventory BOOLEAN NOT NULL DEFAULT TRUE,
          created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_shop_inventory (
          product_id TEXT NOT NULL REFERENCES organization_shop_product(id) ON DELETE CASCADE,
          warehouse_id TEXT NOT NULL REFERENCES organization_shop_warehouse(id) ON DELETE CASCADE,
          quantity INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (product_id, warehouse_id)
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_shop_order (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
          buyer_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          currency TEXT NOT NULL DEFAULT 'CAD',
          subtotal_cents INTEGER NOT NULL,
          fee_cents INTEGER NOT NULL,
          total_cents INTEGER NOT NULL,
          shipping_address JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_order
        ADD COLUMN IF NOT EXISTS buyer_user_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_order
        ADD COLUMN IF NOT EXISTS subtotal_cents INTEGER NOT NULL DEFAULT 0;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_order
        ADD COLUMN IF NOT EXISTS fee_cents INTEGER NOT NULL DEFAULT 0;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_order
        ADD COLUMN IF NOT EXISTS total_cents INTEGER NOT NULL DEFAULT 0;
      `)

      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'organization_shop_order_buyer_user_id_fkey'
          ) THEN
            ALTER TABLE organization_shop_order
            ADD CONSTRAINT organization_shop_order_buyer_user_id_fkey
            FOREIGN KEY (buyer_user_id)
            REFERENCES "User"(id)
            ON DELETE SET NULL;
          END IF;
        END $$;
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_shop_order_item (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL REFERENCES organization_shop_order(id) ON DELETE CASCADE,
          product_id TEXT REFERENCES organization_shop_product(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          price_cents INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          fulfillment_type TEXT NOT NULL DEFAULT 'physical',
          digital_delivery_url TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS organization_shop_payment (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL REFERENCES organization_shop_order(id) ON DELETE CASCADE,
          stripe_payment_intent_id TEXT,
          status TEXT NOT NULL DEFAULT 'requires_payment_method',
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'CAD',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_shop_warehouse_business_id_idx
        ON organization_shop_warehouse (business_id);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_shop_catalog_business_id_idx
        ON organization_shop_catalog (business_id, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_shop_catalog_business_sort_idx
        ON organization_shop_catalog (business_id, sort_order ASC, created_at ASC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_shop_product_business_id_idx
        ON organization_shop_product (business_id, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_shop_order_business_id_idx
        ON organization_shop_order (business_id, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_shop_order_buyer_id_idx
        ON organization_shop_order (buyer_user_id, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_shop_order_item_order_id_idx
        ON organization_shop_order_item (order_id);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS organization_shop_payment_stripe_pi_id_uniq
        ON organization_shop_payment (stripe_payment_intent_id);
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS primary_image_url TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS gallery_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS weight_grams INTEGER;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS shipping_policy TEXT NOT NULL DEFAULT 'local_community';
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS allow_shipping_contracts BOOLEAN NOT NULL DEFAULT FALSE;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS featured_homepage BOOLEAN NOT NULL DEFAULT FALSE;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS tax_collect BOOLEAN NOT NULL DEFAULT FALSE;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS tax_rates_by_region JSONB NOT NULL DEFAULT '{}'::jsonb;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'physical';
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS digital_delivery_url TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS catalog_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS created_by TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'visible';
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_shop_product_moderation_status_idx
        ON organization_shop_product (moderation_status, updated_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'organization_shop_product_created_by_fkey'
          ) THEN
            ALTER TABLE organization_shop_product
            ADD CONSTRAINT organization_shop_product_created_by_fkey
            FOREIGN KEY (created_by)
            REFERENCES "User"(id)
            ON DELETE SET NULL;
          END IF;
        END $$;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_catalog
        ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
      `)

      await prisma.$executeRawUnsafe(`
        WITH ranked AS (
          SELECT
            id,
            ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at ASC, id ASC) - 1 AS next_order
          FROM organization_shop_catalog
        )
        UPDATE organization_shop_catalog c
        SET sort_order = ranked.next_order
        FROM ranked
        WHERE c.id = ranked.id
          AND c.sort_order = 0
          AND ranked.next_order > 0;
      `)

      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'organization_shop_product_catalog_id_fkey'
          ) THEN
            ALTER TABLE organization_shop_product
            ADD CONSTRAINT organization_shop_product_catalog_id_fkey
            FOREIGN KEY (catalog_id)
            REFERENCES organization_shop_catalog(id)
            ON DELETE SET NULL;
          END IF;
        END $$;
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_shop_product_catalog_id_idx
        ON organization_shop_product (catalog_id);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS organization_shop_inventory_warehouse_id_idx
        ON organization_shop_inventory (warehouse_id);
      `)
    } catch (err) {
      organizationShopTablesReady = null
      throw err
    }
  })()
  return organizationShopTablesReady
}

function ensureCitizenMarketplaceTables() {
  if (citizenMarketplaceTablesReady) return citizenMarketplaceTablesReady
  citizenMarketplaceTablesReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS citizen_market_listing (
          id TEXT PRIMARY KEY,
          seller_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT 'Draft Listing',
          description TEXT,
          price_cents INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'CAD',
          photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
          pickup_city TEXT,
          pickup_province TEXT,
          pickup_address_line1 TEXT,
          pickup_address_line2 TEXT,
          pickup_postal_code TEXT,
          listing_province_code TEXT,
          listing_community_slug TEXT,
          payment_types JSONB NOT NULL DEFAULT '[]'::jsonb,
          willing_to_deliver BOOLEAN NOT NULL DEFAULT FALSE,
          delivery_options JSONB NOT NULL DEFAULT '{}'::jsonb,
          e_transfer_email TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          selected_buyer_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          sale_expires_at TIMESTAMPTZ,
          is_draft BOOLEAN NOT NULL DEFAULT TRUE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_seller_idx
        ON citizen_market_listing (seller_user_id, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_status_idx
        ON citizen_market_listing (status, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_selected_buyer_idx
        ON citizen_market_listing (selected_buyer_user_id);
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS delivery_options JSONB NOT NULL DEFAULT '{}'::jsonb;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS listing_province_code TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS listing_community_slug TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'visible';
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_scope_idx
        ON citizen_market_listing (listing_province_code, listing_community_slug, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_moderation_status_idx
        ON citizen_market_listing (moderation_status, updated_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS citizen_market_chat_interest (
          thread_id TEXT NOT NULL REFERENCES "MessageThread"(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          interested BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (thread_id, user_id)
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_chat_interest_user_idx
        ON citizen_market_chat_interest (user_id, updated_at DESC);
      `)
    } catch (err) {
      citizenMarketplaceTablesReady = null
      throw err
    }
  })()

  return citizenMarketplaceTablesReady
}

const CommunityOrgParams = z.object({
  province: z.string().min(2),
  municipality: z.string().min(1),
})

const CommunityOrgSlugParams = CommunityOrgParams.extend({
  slug: z.string().trim().min(3).max(80),
})

const CommunityOrgListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const OrganizationsDirectoryQuery = z.object({
  q: z.string().trim().max(80).optional(),
  type: z
    .enum([
      'LOCAL_BUSINESS',
      'NON_PROFIT',
      'COMMUNITY_GROUP',
      'EDUCATIONAL',
      'RELIGIOUS',
      'GOVERNMENT',
      'ARTS_CULTURE',
      'SPORTS_RECREATION',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const CommunityOrgCreateBody = z.object({
  name: z.string().trim().min(3).max(160),
  slug: z.string().trim().min(1).max(80).optional(),
  type: z
    .enum([
      'LOCAL_BUSINESS',
      'NON_PROFIT',
      'COMMUNITY_GROUP',
      'EDUCATIONAL',
      'RELIGIOUS',
      'GOVERNMENT',
      'ARTS_CULTURE',
      'SPORTS_RECREATION',
    ])
    .optional(),
  description: z.string().trim().max(2000).optional(),
})

const CommunityOrgSettingsBody = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  headline: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().max(50000).optional().nullable(),
  logoMediaId: z.string().trim().min(3).optional(),
  coverMediaId: z.string().trim().min(3).optional(),
  phone: z.string().trim().min(1).max(50).optional().nullable(),
  websiteUrl: z.string().trim().max(2048).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  schedule: z.string().trim().max(2000).optional().nullable(),
  isPublic: z.boolean().optional(),
})

const CommunityOrgMemberParams = CommunityOrgSlugParams.extend({
  userId: z.string().uuid(),
})

const OrgPermissionValues = [
  'approve_members',
  'remove_members',
  'promote_members',
  'demote_members',
  'create_ranks',
  'view_audit_logs',
  'manage_membership_plans',
  'view_revenue',
  'issue_refunds',
  'create_paid_events',
  'manage_events',
  'manage_sponsors',
  'manage_referrals',
  'award_achievements',
  'create_announcements',
  'pin_posts',
  'moderate_content',
] as const

const OrgJoinModeValues = ['PUBLIC', 'INVITE_ONLY', 'APPLICATION_REQUIRED'] as const
const OrgMembershipStatusValues = ['PENDING', 'ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED', 'BANNED'] as const
const OrgEventCategoryValues = [
  'Business',
  'Food & Drink',
  'Health',
  'Music',
  'Auto, Boat & Air',
  'Charity & Causes',
  'Community',
  'Family & Education',
  'Fashion',
  'Film & Media',
  'Hobbies',
  'Home & Lifestyle',
  'Performing & Visual Arts',
  'Government',
  'Spirituality',
  'School Activities',
  'Science & Tech',
  'Holidays',
  'Sports & Fitness',
  'Travel & Outdoor',
  'Other',
] as const

const CommunityOrgGovernanceRankBody = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(240).optional().nullable(),
  permissions: z.array(z.enum(OrgPermissionValues)).min(1).max(24),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  promotionAuthority: z.array(z.string().trim().min(2).max(64)).max(20).optional(),
})

const CommunityOrgMembershipPlanBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(240).optional().nullable(),
    type: z.enum(['FREE', 'ONE_TIME', 'SUBSCRIPTION']),
    amountCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
    currency: z.string().trim().min(3).max(3).default('CAD'),
    interval: z.enum(['monthly', 'yearly']).optional().nullable(),
    rankId: z.string().trim().min(2).max(64).optional().nullable(),
    governanceRights: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.type !== 'FREE' && typeof value.amountCents !== 'number') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amountCents'], message: 'amount_cents_required' })
    }
    if (value.type === 'SUBSCRIPTION' && !value.interval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['interval'], message: 'interval_required' })
    }
  })

const CommunityOrgSponsorBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    logoUrl: z.string().trim().url().max(2048).optional().nullable(),
    relationshipDescription: z.string().trim().max(500).optional().nullable(),
    tier: z.string().trim().min(2).max(40),
    internalUserId: z.string().trim().min(1).max(120).optional().nullable(),
    externalReference: z.string().trim().max(2048).optional().nullable(),
    linkUrl: z.string().trim().max(2048).optional().nullable(),
    linkLabel: z.string().trim().max(120).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (!value.linkUrl) return
    if (value.linkUrl.startsWith('/')) return

    try {
      const parsed = new URL(value.linkUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['linkUrl'], message: 'invalid_url_or_path' })
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['linkUrl'], message: 'invalid_url_or_path' })
    }
  })

const EventInviteStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'DECLINED'])

const OrgEventGuestSpeakerTagSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  handle: z.string().trim().min(1).max(80),
  avatarUrl: z.string().trim().url().max(2048).optional().nullable(),
  coverUrl: z.string().trim().url().max(2048).optional().nullable(),
})

const OrgEventSponsorTagSchema = z.object({
  organizationId: z.string().trim().cuid(),
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(80),
  provinceCode: z.string().trim().min(2).max(32),
  communitySlug: z.string().trim().min(1).max(160),
  logoUrl: z.string().trim().url().max(2048).optional().nullable(),
  coverUrl: z.string().trim().url().max(2048).optional().nullable(),
})

const OrgEventFeeSchema = z.object({
  id: z.string().trim().min(2).max(64),
  label: z.string().trim().min(1).max(120),
  amountCents: z.coerce.number().int().min(0).max(100_000_000),
  capacity: z.coerce.number().int().min(1).max(200000).optional().nullable(),
  cashOnly: z.boolean().default(true),
})

const CommunityOrgEventBody = z
  .object({
    title: z.string().trim().min(3).max(180),
    description: z.string().trim().max(5000).optional().nullable(),
    access: z.enum(['PUBLIC', 'RESTRICTED']).default('PUBLIC'),
    eligibleRankIds: z.array(z.string().trim().min(2).max(64)).max(20).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional().nullable(),
    capacity: z.coerce.number().int().min(1).max(200000).optional().nullable(),
    paid: z.boolean().default(false),
    category: z.enum(OrgEventCategoryValues).default('Other'),
    priceCents: z.coerce.number().int().min(0).max(100_000_000).optional().nullable(),
    currency: z.string().trim().min(3).max(3).default('CAD'),
    guestSpeakers: z.array(z.union([z.string().trim().min(1).max(120), OrgEventGuestSpeakerTagSchema])).max(50).optional(),
    sponsors: z.array(OrgEventSponsorTagSchema).max(30).optional(),
    fees: z.array(OrgEventFeeSchema).max(50).optional(),
    agenda: z.array(z.object({ title: z.string().trim().min(1).max(180), startsAt: z.string().datetime().optional().nullable() })).max(100).optional(),
    attachments: z.array(z.object({ title: z.string().trim().min(1).max(160), url: z.string().trim().url().max(2048) })).max(50).optional(),
    primaryPhotoUrl: z.string().trim().url().max(2048).optional().nullable(),
    galleryPhotoUrls: z.array(z.string().trim().url().max(2048)).max(12).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.paid && (typeof value.priceCents !== 'number' || value.priceCents <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceCents'], message: 'price_cents_required_for_paid_event' })
    }
  })

const CommunityOrgEventDraftUpdateBody = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().max(5000).optional().nullable(),
    access: z.enum(['PUBLIC', 'RESTRICTED']).optional(),
    eligibleRankIds: z.array(z.string().trim().min(2).max(64)).max(20).optional(),
    startsAt: z.string().datetime().optional().nullable(),
    endsAt: z.string().datetime().optional().nullable(),
    capacity: z.coerce.number().int().min(1).max(200000).optional().nullable(),
    paid: z.boolean().optional(),
    category: z.enum(OrgEventCategoryValues).optional(),
    priceCents: z.coerce.number().int().min(0).max(100_000_000).optional().nullable(),
    currency: z.string().trim().min(3).max(3).optional(),
    guestSpeakers: z.array(z.union([z.string().trim().min(1).max(120), OrgEventGuestSpeakerTagSchema])).max(50).optional(),
    sponsors: z.array(OrgEventSponsorTagSchema).max(30).optional(),
    fees: z.array(OrgEventFeeSchema).max(50).optional(),
    agenda: z
      .array(z.object({ title: z.string().trim().min(1).max(180), startsAt: z.string().datetime().optional().nullable() }))
      .max(100)
      .optional(),
    attachments: z.array(z.object({ title: z.string().trim().min(1).max(160), url: z.string().trim().url().max(2048) })).max(50).optional(),
    primaryPhotoUrl: z.string().trim().url().max(2048).optional().nullable(),
    galleryPhotoUrls: z.array(z.string().trim().url().max(2048)).max(12).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.paid === true && (typeof value.priceCents !== 'number' || value.priceCents <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceCents'], message: 'price_cents_required_for_paid_event' })
    }
  })

const CommunityOrgMemberStatusBody = z.object({
  status: z.enum(OrgMembershipStatusValues),
  rankId: z.string().trim().min(2).max(64).optional().nullable(),
  planId: z.string().trim().min(2).max(64).optional().nullable(),
  reason: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgMemberModerationBody = z.object({
  reason: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgGovernanceQuery = z.object({
  cursor: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const CommunityOrgJoinModeBody = z.object({
  joinMode: z.enum(OrgJoinModeValues),
  reason: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgJoinBody = z.object({
  planId: z.string().trim().min(2).max(64).optional().nullable(),
  referredByUserId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgEventParams = CommunityOrgSlugParams.extend({
  eventId: z.string().trim().min(3).max(64),
})

const CommunityOrgMeetingParams = CommunityOrgSlugParams.extend({
  meetingId: z.string().trim().min(3).max(80),
})

const OrgMeetingScheduleInput = z
  .object({
    startsAt: z.string().datetime().optional().nullable(),
    endsAt: z.string().datetime().optional().nullable(),
  })
  .optional()
  .nullable()

const CommunityOrgMeetingCreateBody = z
  .object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(5000).optional().nullable(),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
    requiresPassword: z.boolean().default(false),
    password: z.string().trim().min(1).max(128).optional().nullable(),
    requiresManualAdmit: z.boolean().default(false),
    maxParticipants: z.coerce.number().int().min(1).max(10).optional().nullable(),
    schedule: OrgMeetingScheduleInput,
    assignedMemberUserIds: z.array(z.string().trim().min(1).max(120)).max(500).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).default('ARCHIVED'),
  })
  .superRefine((value, ctx) => {
    if (value.requiresPassword && (!value.password || !value.password.trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: 'password_required' })
    }
  })

const CommunityOrgMeetingUpdateBody = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().max(5000).optional().nullable(),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    requiresPassword: z.boolean().optional(),
    password: z.string().trim().min(1).max(128).optional().nullable(),
    requiresManualAdmit: z.boolean().optional(),
    maxParticipants: z.coerce.number().int().min(1).max(10).optional().nullable(),
    schedule: OrgMeetingScheduleInput,
    assignedMemberUserIds: z.array(z.string().trim().min(1).max(120)).max(500).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.requiresPassword === true && value.password !== undefined && !value.password?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: 'password_required' })
    }
  })

const CommunityOrgMeetingJoinBody = z.object({
  password: z.string().trim().min(1).max(128).optional().nullable(),
})

const CommunityOrgMeetingRtcSessionBody = z.object({
  displayName: z.string().trim().min(1).max(120).optional().nullable(),
  deviceId: z.string().trim().min(1).max(120).optional().nullable(),
  capabilities: z
    .object({
      audio: z.boolean().optional(),
      video: z.boolean().optional(),
    })
    .optional()
    .nullable(),
})

const CommunityOrgAchievementParams = CommunityOrgSlugParams.extend({
  achievementId: z.string().trim().min(3).max(64),
})

const CommunityOrgAchievementBody = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).optional().nullable(),
  reputationPoints: z.coerce.number().int().min(0).max(10000).default(0),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
})

const CommunityOrgAchievementAwardBody = z.object({
  userId: z.string().uuid(),
  note: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgReferralBody = z.object({
  referrerUserId: z.string().uuid(),
  referredUserId: z.string().uuid(),
  planId: z.string().trim().min(2).max(64).optional().nullable(),
})

const CommunityOrgInviteLinkBody = z.object({
  message: z.string().trim().max(280).optional().nullable(),
  planId: z.string().trim().min(2).max(64).optional().nullable(),
})

const CommunityOrgInviteUserBody = z.object({
  targetUserId: z.string().uuid(),
  message: z.string().trim().max(280).optional().nullable(),
  planId: z.string().trim().min(2).max(64).optional().nullable(),
})

const CommunityOrgInviteResolveBody = z.object({
  deviceId: z.string().trim().min(1).max(120).optional().nullable(),
})

const CommunityOrgReputationAdjustBody = z.object({
  userId: z.string().uuid(),
  delta: z.coerce.number().int().min(-10000).max(10000),
  source: z.string().trim().min(2).max(80),
  note: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgEventRsvpBody = z.object({
  status: z.enum(['GOING', 'INTERESTED', 'DECLINED']),
  ticketType: z.enum(['FREE', 'PAID']).optional(),
  ticketId: z.string().trim().min(2).max(64).optional().nullable(),
  message: z.string().trim().max(600).optional().nullable(),
})

const CommunityOrgEconomicsRecordBody = z.object({
  kind: z.enum(['membership', 'event', 'refund', 'manual']),
  amountCents: z.coerce.number().int().min(-100_000_000).max(100_000_000),
  currency: z.string().trim().min(3).max(3).default('CAD'),
  memberUserId: z.string().uuid().optional().nullable(),
  eventId: z.string().trim().min(3).max(64).optional().nullable(),
  note: z.string().trim().max(280).optional().nullable(),
})

const CommunityOrgChannelCreateBody = z.object({
  name: z.string().trim().min(2).max(80),
  visibility: z.enum(['public', 'private']).default('public'),
})

const CommunityOrgChannelParams = CommunityOrgSlugParams.extend({
  channelId: z.string().cuid(),
})

const CommunityOrgChannelInviteBody = z.object({
  userId: z.string().trim().min(1).max(120),
})

const CommunityOrgChannelNotificationBody = z
  .object({
    muteChannel: z.boolean().optional(),
    mentionsOnly: z.boolean().optional(),
  })
  .refine((value) => typeof value.muteChannel === 'boolean' || typeof value.mentionsOnly === 'boolean', {
    message: 'at_least_one_setting_required',
  })

const CommunityOrgServerNotificationBody = z
  .object({
    muteServer: z.boolean().optional(),
    mentionsOnly: z.boolean().optional(),
  })
  .refine((value) => typeof value.muteServer === 'boolean' || typeof value.mentionsOnly === 'boolean', {
    message: 'at_least_one_setting_required',
  })

const CommunityOrgShopProductCreateBody = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(5000).optional().nullable(),
  catalogId: z.string().trim().min(1).max(120).optional().nullable(),
  featuredHomepage: z.boolean().default(false),
  taxCollect: z.boolean().default(false),
  taxRatesByRegion: z.record(z.string(), z.string()).default({}),
  priceCents: z.coerce.number().int().min(0).max(100_000_000),
  currency: z.string().trim().min(3).max(3).default('CAD'),
  sku: z.string().trim().max(80).optional().nullable(),
  primaryImageUrl: z.string().trim().url().max(2048).optional().nullable(),
  galleryImageUrls: z.array(z.string().trim().url().max(2048)).max(12).optional(),
  fulfillmentType: z.enum(['physical', 'digital']).default('physical'),
  digitalDeliveryUrl: z.string().trim().url().max(2048).optional().nullable(),
  weightGrams: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(),
  shippingPolicy: z.enum(['local_community', 'provincial', 'national']).default('local_community'),
  allowShippingContracts: z.boolean().default(false),
  trackInventory: z.boolean().default(true),
  initialInventory: z.coerce.number().int().min(0).max(1_000_000).default(0),
})

const CommunityOrgShopProductUpdateBody = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(5000).optional().nullable(),
  catalogId: z.string().trim().min(1).max(120).optional().nullable(),
  featuredHomepage: z.boolean().optional(),
  taxCollect: z.boolean().optional(),
  taxRatesByRegion: z.record(z.string(), z.string()).optional(),
  priceCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  sku: z.string().trim().max(80).optional().nullable(),
  fulfillmentType: z.enum(['physical', 'digital']).optional(),
  digitalDeliveryUrl: z.string().trim().url().max(2048).optional().nullable(),
  trackInventory: z.boolean().optional(),
  weightGrams: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(),
  shippingPolicy: z.enum(['local_community', 'provincial', 'national']).optional(),
  allowShippingContracts: z.boolean().optional(),
  isDraft: z.boolean().optional(),
})

const CommunityOrgShopSettingsBody = z.object({
  headOfficeAddress: z.string().trim().max(500).optional().nullable(),
  warehouseSameAsHeadOffice: z.boolean().optional(),
  directDepositTransit: z.string().trim().max(20).optional().nullable(),
  directDepositInstitution: z.string().trim().max(20).optional().nullable(),
  directDepositAccount: z.string().trim().max(40).optional().nullable(),
})

const CommunityOrgShopWarehouseCreateBody = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.object({
    line1: z.string().trim().min(2).max(120),
    line2: z.string().trim().max(120).optional().nullable(),
    city: z.string().trim().min(2).max(80),
    province: z.string().trim().min(2).max(80),
    postalCode: z.string().trim().min(2).max(32),
    country: z.string().trim().min(2).max(2).default('CA'),
  }),
})

const CommunityOrgShopCatalogCreateBody = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(240).optional().nullable(),
  imageUrl: z.string().trim().url().max(2048).optional().nullable(),
  enabled: z.boolean().default(true),
})

const CommunityOrgShopCatalogUpdateBody = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(240).optional().nullable(),
  imageUrl: z.string().trim().url().max(2048).optional().nullable(),
  enabled: z.boolean().optional(),
})

const CommunityOrgShopCatalogReorderBody = z.object({
  catalogIds: z.array(z.string().trim().min(1).max(120)).min(1),
})

const CommunityOrgShopProductParams = CommunityOrgSlugParams.extend({
  productId: z.string().trim().min(1).max(120),
})

const CommunityOrgShopCatalogParams = CommunityOrgSlugParams.extend({
  catalogId: z.string().trim().min(1).max(120),
})

const CommunityOrgShopInventoryUpdateBody = z.object({
  quantities: z.array(z.object({ warehouseId: z.string().trim().min(1).max(120), quantity: z.coerce.number().int().min(0).max(1_000_000) })).min(1),
})

const CommunityOrgShopProductPhotosUpdateBody = z.object({
  primaryImageUrl: z.string().trim().url().max(2048).optional().nullable(),
  galleryImageUrls: z.array(z.string().trim().url().max(2048)).max(12).optional(),
})

const ORG_CHANNEL_CONTEXT_TYPE = 'organization_channel'
const MARKET_LISTING_CHAT_CONTEXT_TYPE = 'market_listing'
const ORG_MEETING_CONTEXT_TYPE = 'organization_meeting'

function slugifyChannelName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function buildOrgChannelContextId(orgId: string, visibility: 'public' | 'private', slug: string, name: string) {
  return `${orgId}|${visibility}|${slug}|${encodeURIComponent(name)}`
}

function parseOrgChannelContextId(contextId: string | null | undefined): null | {
  orgId: string
  visibility: 'public' | 'private'
  slug: string
  name: string
} {
  if (!contextId) return null
  const [orgId, visibilityRaw, slug, encodedName] = contextId.split('|')
  if (!orgId || !visibilityRaw || !slug || !encodedName) return null
  const visibility = visibilityRaw === 'private' ? 'private' : visibilityRaw === 'public' ? 'public' : null
  if (!visibility) return null
  return {
    orgId,
    visibility,
    slug,
    name: decodeURIComponent(encodedName),
  }
}

function readOrgChatPrefs(meta: unknown, orgId: string): OrgChatPrefs {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  const typed = meta as Record<string, unknown>
  const orgChatPrefs = typed.orgChatPrefs
  if (!orgChatPrefs || typeof orgChatPrefs !== 'object' || Array.isArray(orgChatPrefs)) return {}
  const perOrg = (orgChatPrefs as Record<string, unknown>)[orgId]
  if (!perOrg || typeof perOrg !== 'object' || Array.isArray(perOrg)) return {}
  return perOrg as OrgChatPrefs
}

type CommunityOrgRecord = {
  id: string
  ownerId: string
  provinceCode: string | null
  communitySlug: string | null
  name: string
  slug: string
  type: BusinessType
  description: string | null
  phone?: string | null
  websiteUrl?: string | null
  address?: string | null
  schedule?: string | null
  status: BusinessStatus
  moderationStatus?: ModerationStatus
  isVerified: boolean
  logoUrl?: string | null
  coverUrl?: string | null
  metadata?: unknown
  createdAt: Date
  updatedAt: Date
  _count?: { follows?: number }
}

function readOrganizationHeadline(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).headline
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 60) : null
}

type OrganizationShopPaymentsState = {
  stripeConnectAccountId: string | null
}

function readOrganizationShopPaymentsState(metadata: unknown): OrganizationShopPaymentsState {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { stripeConnectAccountId: null }
  }
  const shop = (metadata as Record<string, unknown>).shop
  if (!shop || typeof shop !== 'object' || Array.isArray(shop)) {
    return { stripeConnectAccountId: null }
  }

  const raw = (shop as Record<string, unknown>).stripeConnectAccountId
  return {
    stripeConnectAccountId: typeof raw === 'string' && raw.trim().length ? raw.trim() : null,
  }
}

function mergeOrganizationShopPaymentsStateIntoMetadata(metadata: unknown, next: Partial<OrganizationShopPaymentsState>): Prisma.InputJsonValue {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? ({ ...(metadata as Record<string, unknown>) } as Record<string, unknown>) : {}
  const existingShop = base.shop && typeof base.shop === 'object' && !Array.isArray(base.shop) ? ({ ...(base.shop as Record<string, unknown>) } as Record<string, unknown>) : {}
  if (typeof next.stripeConnectAccountId === 'string' || next.stripeConnectAccountId === null) {
    existingShop.stripeConnectAccountId = next.stripeConnectAccountId
  }
  base.shop = existingShop
  return base as Prisma.InputJsonValue
}

function buildCommunityOrgPayload(org: CommunityOrgRecord, viewerFollowed: boolean, viewerRole: 'OWNER' | 'MANAGER' | null = null) {
  return {
    id: org.id,
    ownerId: org.ownerId,
    provinceCode: org.provinceCode,
    communitySlug: org.communitySlug,
    name: org.name,
    headline: readOrganizationHeadline(org.metadata),
    slug: org.slug,
    type: org.type,
    description: org.description ? sanitizePlainText(org.description) : null,
    phone: org.phone ?? null,
    websiteUrl: org.websiteUrl ?? null,
    address: org.address ?? null,
    schedule: org.schedule ?? null,
    status: org.status,
    isVerified: org.isVerified,
    logoUrl: org.logoUrl ?? null,
    coverUrl: org.coverUrl ?? null,
    followerCount: org._count?.follows ?? 0,
    viewerFollowed,
    viewerRole,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  }
}

type OrgPermission = (typeof OrgPermissionValues)[number]
type OrgJoinMode = (typeof OrgJoinModeValues)[number]
type OrgMembershipStatus = (typeof OrgMembershipStatusValues)[number]

type OrgRankDefinition = {
  id: string
  name: string
  description: string | null
  permissions: OrgPermission[]
  promotionAuthority: string[]
  visibility: 'PUBLIC' | 'PRIVATE'
  system?: boolean
}

type OrgPlanDefinition = {
  id: string
  name: string
  description: string | null
  type: 'FREE' | 'ONE_TIME' | 'SUBSCRIPTION'
  amountCents: number
  currency: string
  interval: 'monthly' | 'yearly' | null
  rankId: string | null
  governanceRights: boolean
  createdAt: string
}

type OrgSponsorDefinition = {
  id: string
  name: string
  logoUrl: string | null
  relationshipDescription: string | null
  tier: string
  internalUserId: string | null
  externalReference: string | null
  linkUrl?: string | null
  linkLabel?: string | null
  createdAt: string
}

type OrgEventSponsorTag = {
  organizationId: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  logoUrl: string | null
  coverUrl: string | null
}

type OrgEventGuestSpeakerTag = {
  userId: string
  name: string
  handle: string
  avatarUrl: string | null
  coverUrl: string | null
}

type OrgEventGuestSpeakerInvite = OrgEventGuestSpeakerTag & {
  status: z.infer<typeof EventInviteStatusSchema>
  invitedAt: string
  respondedAt: string | null
  respondedByUserId: string | null
}

type OrgEventFee = z.infer<typeof OrgEventFeeSchema>

type OrgEventSponsorInvite = OrgEventSponsorTag & {
  status: z.infer<typeof EventInviteStatusSchema>
  invitedAt: string
  respondedAt: string | null
  respondedByUserId: string | null
  recipientUserIds: string[]
}

function normalizeEventSponsorTags(input: Array<z.infer<typeof OrgEventSponsorTagSchema>> | undefined): OrgEventSponsorTag[] {
  if (!Array.isArray(input)) return []
  return input.map((item) => ({
    organizationId: item.organizationId,
    name: item.name,
    slug: item.slug,
    provinceCode: item.provinceCode,
    communitySlug: item.communitySlug,
    logoUrl: item.logoUrl ?? null,
    coverUrl: item.coverUrl ?? null,
  }))
}

function normalizeGuestSpeakerInput(
  input: Array<string | z.infer<typeof OrgEventGuestSpeakerTagSchema>> | undefined,
): { guestSpeakers: string[]; guestSpeakerTags: OrgEventGuestSpeakerTag[] } {
  if (!Array.isArray(input)) return { guestSpeakers: [], guestSpeakerTags: [] }

  const names: string[] = []
  const nameSeen = new Set<string>()
  const tags: OrgEventGuestSpeakerTag[] = []
  const tagSeen = new Set<string>()

  for (const item of input) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (nameSeen.has(key)) continue
      nameSeen.add(key)
      names.push(trimmed)
      continue
    }

    const userId = item.userId.trim()
    if (!userId || tagSeen.has(userId)) continue
    tagSeen.add(userId)

    const displayName = item.name.trim() || item.handle.trim()
    if (displayName) {
      const key = displayName.toLowerCase()
      if (!nameSeen.has(key)) {
        nameSeen.add(key)
        names.push(displayName)
      }
    }

    tags.push({
      userId,
      name: displayName,
      handle: item.handle.trim(),
      avatarUrl: item.avatarUrl ?? null,
      coverUrl: item.coverUrl ?? null,
    })
  }

  return { guestSpeakers: names, guestSpeakerTags: tags }
}

type OrgEventDefinition = {
  id: string
  title: string
  description: string | null
  category?: (typeof OrgEventCategoryValues)[number]
  access: 'PUBLIC' | 'RESTRICTED'
  eligibleRankIds: string[]
  startsAt: string
  endsAt: string | null
  capacity: number | null
  paid: boolean
  priceCents: number | null
  currency: string
  guestSpeakers: string[]
  guestSpeakerInvites: OrgEventGuestSpeakerInvite[]
  sponsors: OrgEventSponsorTag[]
  sponsorInvites: OrgEventSponsorInvite[]
  fees: OrgEventFee[]
  primaryPhotoUrl: string | null
  galleryPhotoUrls: string[]
  agenda: Array<{ title: string; startsAt: string | null }>
  attachments: Array<{ title: string; url: string }>
  status?: 'DRAFT' | 'PUBLISHED' | 'QUARANTINED'
  createdAt: string
  updatedAt?: string
}

type OrgAchievementDefinition = {
  id: string
  title: string
  description: string | null
  reputationPoints: number
  visibility: 'PUBLIC' | 'PRIVATE'
  createdAt: string
}

type OrgAchievementAward = {
  id: string
  achievementId: string
  userId: string
  awardedByUserId: string
  note: string | null
  createdAt: string
}

type OrgReferralRecord = {
  id: string
  referrerUserId: string
  referredUserId: string
  planId: string | null
  createdAt: string
}

type OrgInviteLinkRecord = {
  id: string
  token: string
  createdByUserId: string
  message: string | null
  planId: string | null
  createdAt: string
  viewCount: number
  registrationCount: number
  joinCount: number
  lastViewedAt: string | null
  lastRegisteredAt: string | null
  lastJoinedAt: string | null
}

type OrgReputationEntry = {
  id: string
  userId: string
  delta: number
  source: string
  sourceRefId: string | null
  note: string | null
  createdAt: string
}

type OrgEventRsvp = {
  id: string
  eventId: string
  userId: string
  status: 'GOING' | 'INTERESTED' | 'DECLINED'
  ticketType: 'FREE' | 'PAID'
  ticketId: string | null
  ticketLabel: string | null
  amountCents: number | null
  message: string | null
  createdAt: string
  updatedAt: string
}

type OrgEconomicRecord = {
  id: string
  kind: 'membership' | 'event' | 'refund' | 'manual'
  amountCents: number
  currency: string
  memberUserId: string | null
  eventId: string | null
  note: string | null
  createdAt: string
}

type OrgMemberState = {
  rankId: string
  planId: string | null
  status: OrgMembershipStatus
  referredByUserId: string | null
  reputation: number
  updatedAt: string
}

type OrgAuditLogEntry = {
  id: string
  actorUserId: string
  action: string
  createdAt: string
  reason: string | null
  previousValue: unknown
  nextValue: unknown
}

type OrganizationSystemState = {
  version: 1
  joinMode: OrgJoinMode
  ranks: OrgRankDefinition[]
  plans: OrgPlanDefinition[]
  sponsors: OrgSponsorDefinition[]
  events: OrgEventDefinition[]
  achievements: OrgAchievementDefinition[]
  achievementAwards: OrgAchievementAward[]
  referrals: OrgReferralRecord[]
  inviteLinks: OrgInviteLinkRecord[]
  reputationLedger: OrgReputationEntry[]
  eventRsvps: OrgEventRsvp[]
  economics: OrgEconomicRecord[]
  members: Record<string, OrgMemberState>
  auditLog: OrgAuditLogEntry[]
}

const SYSTEM_OWNER_RANK_ID = 'system_owner'
const SYSTEM_MANAGER_RANK_ID = 'system_manager'
const SYSTEM_ROLE_MANAGER_RANK_ID = 'system_role_manager'
const SYSTEM_EVENT_MANAGER_RANK_ID = 'system_event_manager'
const SYSTEM_SHOP_MANAGER_RANK_ID = 'system_shop_manager'
const SYSTEM_MEMBER_RANK_ID = 'system_member'
const ORG_AUDIT_LOG_LIMIT = 1000
const ORG_SIGNUP_REPUTATION_POINTS = 100

const DEFAULT_MANAGER_PERMISSIONS: OrgPermission[] = [
  ...OrgPermissionValues,
]

const DEFAULT_ROLE_MANAGER_PERMISSIONS: OrgPermission[] = [
  'approve_members',
  'remove_members',
  'promote_members',
  'demote_members',
  'view_audit_logs',
  'manage_membership_plans',
  'manage_events',
  'manage_sponsors',
  'manage_referrals',
  'award_achievements',
  'create_announcements',
  'pin_posts',
  'moderate_content',
]

const DEFAULT_EVENT_MANAGER_PERMISSIONS: OrgPermission[] = [
  'manage_events',
  'create_paid_events',
  'create_announcements',
  'pin_posts',
  'moderate_content',
]

const DEFAULT_SHOP_MANAGER_PERMISSIONS: OrgPermission[] = [
  'view_revenue',
  'issue_refunds',
]

function buildDefaultOrganizationRanks(): OrgRankDefinition[] {
  return [
    {
      id: SYSTEM_OWNER_RANK_ID,
      name: 'Owner',
      description: 'Organization owner with full control.',
      permissions: [...OrgPermissionValues],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID],
      visibility: 'PRIVATE',
      system: true,
    },
    {
      id: SYSTEM_MANAGER_RANK_ID,
      name: 'Admin',
      description: 'Organization admins with elevated access.',
      permissions: [...OrgPermissionValues],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID],
      visibility: 'PUBLIC',
      system: true,
    },
    {
      id: SYSTEM_ROLE_MANAGER_RANK_ID,
      name: 'Manager',
      description: 'General-purpose manager role.',
      permissions: [...DEFAULT_ROLE_MANAGER_PERMISSIONS],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID, SYSTEM_MANAGER_RANK_ID],
      visibility: 'PUBLIC',
      system: true,
    },
    {
      id: SYSTEM_EVENT_MANAGER_RANK_ID,
      name: 'Event Manager',
      description: 'Manage events and event announcements.',
      permissions: [...DEFAULT_EVENT_MANAGER_PERMISSIONS],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID, SYSTEM_MANAGER_RANK_ID, SYSTEM_ROLE_MANAGER_RANK_ID],
      visibility: 'PUBLIC',
      system: true,
    },
    {
      id: SYSTEM_SHOP_MANAGER_RANK_ID,
      name: 'Shop Manager',
      description: 'Manage organization commerce and financial reconciliation.',
      permissions: [...DEFAULT_SHOP_MANAGER_PERMISSIONS],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID, SYSTEM_MANAGER_RANK_ID, SYSTEM_ROLE_MANAGER_RANK_ID],
      visibility: 'PUBLIC',
      system: true,
    },
    {
      id: SYSTEM_MEMBER_RANK_ID,
      name: 'Member',
      description: 'Standard organization member.',
      permissions: [],
      promotionAuthority: [SYSTEM_OWNER_RANK_ID, SYSTEM_MANAGER_RANK_ID],
      visibility: 'PUBLIC',
      system: true,
    },
  ]
}

function readOrganizationSystemState(metadata: unknown): OrganizationSystemState {
  const fallback: OrganizationSystemState = {
    version: 1,
    joinMode: 'PUBLIC',
    ranks: buildDefaultOrganizationRanks(),
    plans: [],
    sponsors: [],
    events: [],
    achievements: [],
    achievementAwards: [],
    referrals: [],
    inviteLinks: [],
    reputationLedger: [],
    eventRsvps: [],
    economics: [],
    members: {},
    auditLog: [],
  }

  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return fallback
  const root = metadata as Record<string, unknown>
  const raw = root.orgSystem
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback

  const typed = raw as Partial<OrganizationSystemState>
  const ranks = Array.isArray(typed.ranks)
    ? (typed.ranks.filter((rank): rank is OrgRankDefinition => Boolean(rank && typeof rank === 'object' && (rank as any).id && (rank as any).name)) as OrgRankDefinition[])
    : []

  const defaultRanks = buildDefaultOrganizationRanks()
  const defaultSystemIds = new Set(defaultRanks.filter((r) => r.system).map((r) => r.id))
  const mergedRanks: OrgRankDefinition[] = [...defaultRanks]

  for (const rank of ranks) {
    if (defaultSystemIds.has(rank.id)) {
      // Keep system ranks canonical (names/permissions) even if old metadata has drifted.
      continue
    }
    if (!mergedRanks.some((existing) => existing.id === rank.id)) mergedRanks.push(rank)
  }

  return {
    version: 1,
    joinMode: typed.joinMode && OrgJoinModeValues.includes(typed.joinMode) ? typed.joinMode : 'PUBLIC',
    ranks: mergedRanks,
    plans: Array.isArray(typed.plans) ? (typed.plans as OrgPlanDefinition[]) : [],
    sponsors: Array.isArray(typed.sponsors) ? (typed.sponsors as OrgSponsorDefinition[]) : [],
    events: Array.isArray(typed.events)
      ? (typed.events as OrgEventDefinition[]).map((event) => ({
          ...event,
          guestSpeakerInvites: Array.isArray((event as Partial<OrgEventDefinition>).guestSpeakerInvites)
            ? ((event as Partial<OrgEventDefinition>).guestSpeakerInvites as OrgEventGuestSpeakerInvite[])
            : [],
          sponsors: Array.isArray((event as Partial<OrgEventDefinition>).sponsors)
            ? ((event as Partial<OrgEventDefinition>).sponsors as OrgEventSponsorTag[])
            : [],
          sponsorInvites: Array.isArray((event as Partial<OrgEventDefinition>).sponsorInvites)
            ? ((event as Partial<OrgEventDefinition>).sponsorInvites as OrgEventSponsorInvite[])
            : [],
          fees: Array.isArray((event as Partial<OrgEventDefinition>).fees)
            ? ((event as Partial<OrgEventDefinition>).fees as OrgEventFee[])
            : [],
        }))
      : [],
    achievements: Array.isArray(typed.achievements) ? (typed.achievements as OrgAchievementDefinition[]) : [],
    achievementAwards: Array.isArray(typed.achievementAwards) ? (typed.achievementAwards as OrgAchievementAward[]) : [],
    referrals: Array.isArray(typed.referrals) ? (typed.referrals as OrgReferralRecord[]) : [],
    inviteLinks: Array.isArray((typed as any).inviteLinks)
      ? ((typed as any).inviteLinks as OrgInviteLinkRecord[]).map((row) => ({
          id: row.id,
          token: row.token,
          createdByUserId: row.createdByUserId,
          message: row.message ?? null,
          planId: row.planId ?? null,
          createdAt: row.createdAt,
          viewCount: Number.isFinite(row.viewCount) ? row.viewCount : 0,
          registrationCount: Number.isFinite(row.registrationCount) ? row.registrationCount : 0,
          joinCount: Number.isFinite(row.joinCount) ? row.joinCount : 0,
          lastViewedAt: row.lastViewedAt ?? null,
          lastRegisteredAt: row.lastRegisteredAt ?? null,
          lastJoinedAt: row.lastJoinedAt ?? null,
        }))
      : [],
    reputationLedger: Array.isArray(typed.reputationLedger) ? (typed.reputationLedger as OrgReputationEntry[]) : [],
    eventRsvps: Array.isArray(typed.eventRsvps)
      ? (typed.eventRsvps as OrgEventRsvp[]).map((row) => ({
          ...row,
          ticketId: row.ticketId ?? null,
          ticketLabel: row.ticketLabel ?? null,
          amountCents: typeof row.amountCents === 'number' ? row.amountCents : null,
          message: row.message ?? null,
          updatedAt: row.updatedAt ?? row.createdAt,
        }))
      : [],
    economics: Array.isArray(typed.economics) ? (typed.economics as OrgEconomicRecord[]) : [],
    members: typed.members && typeof typed.members === 'object' && !Array.isArray(typed.members) ? (typed.members as Record<string, OrgMemberState>) : {},
    auditLog: Array.isArray(typed.auditLog) ? (typed.auditLog as OrgAuditLogEntry[]) : [],
  }
}

function mergeOrganizationSystemStateIntoMetadata(metadata: unknown, system: OrganizationSystemState): Prisma.InputJsonValue {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? ({ ...(metadata as Record<string, unknown>) } as Record<string, unknown>) : {}
  base.orgSystem = system as unknown as Prisma.InputJsonValue
  return base as Prisma.InputJsonValue
}

function resolveOrganizationPermissions({
  org,
  role,
  system,
  userId,
}: {
  org: Pick<CommunityOrgRecord, 'ownerId'>
  role: 'OWNER' | 'MANAGER' | null
  system: OrganizationSystemState
  userId: string | null
}): OrgPermission[] {
  if (!userId) return []
  if (org.ownerId === userId || role === 'OWNER') return [...OrgPermissionValues]

  const memberState = userId ? system.members[userId] : undefined
  if (memberState?.rankId) {
    const rank = system.ranks.find((entry) => entry.id === memberState.rankId)
    if (rank?.permissions?.length) return rank.permissions
  }

  if (role === 'MANAGER') return DEFAULT_MANAGER_PERMISSIONS
  return []
}

function canOrganizationPermission(permissions: OrgPermission[], permission: OrgPermission) {
  return permissions.includes(permission)
}

type OrganizationMeetingAccessContext = {
  provinceCode: string
  communitySlug: string
  org: {
    id: string
    ownerId: string
    metadata: Prisma.JsonValue | null
    status: string
    name: string
  }
  viewerId: string | null
  viewerRole: 'OWNER' | 'MANAGER' | null
  permissions: OrgPermission[]
  canManageMeetings: boolean
  isAssociated: boolean
}

async function resolveOrganizationMeetingAccess(args: {
  provinceRaw: string
  municipalityRaw: string
  slugRaw: string
  viewerId: string | null
}): Promise<
  | { ok: false; statusCode: number; error: string }
  | { ok: true; value: OrganizationMeetingAccessContext }
> {
  const provinceCode = normalizeProvinceCode(args.provinceRaw)
  if (!provinceCode) return { ok: false, statusCode: 404, error: 'province_not_found' }

  const municipality = args.municipalityRaw.trim().toLowerCase()
  if (!municipality) return { ok: false, statusCode: 404, error: 'community_not_found' }

  const community = findCommunity(provinceCode, municipality)
  if (!community) return { ok: false, statusCode: 404, error: 'community_not_found' }

  const slug = args.slugRaw.trim().toLowerCase()
  const org = await prisma.business.findFirst({
    where: { provinceCode, communitySlug: community.slug, slug },
    select: { id: true, ownerId: true, metadata: true, status: true, name: true },
  })
  if (!org) return { ok: false, statusCode: 404, error: 'organization_not_found' }

  const viewerId = args.viewerId
  const [membership, follow] = viewerId
    ? await Promise.all([
        prisma.businessMembership.findUnique({
          where: { businessId_userId: { businessId: org.id, userId: viewerId } },
          select: { role: true },
        }),
        prisma.businessFollow.findUnique({
          where: { businessId_userId: { businessId: org.id, userId: viewerId } },
          select: { id: true },
        }),
      ])
    : [null, null]

  const viewerRole: 'OWNER' | 'MANAGER' | null = viewerId
    ? org.ownerId === viewerId
      ? 'OWNER'
      : membership?.role === 'MANAGER'
        ? 'MANAGER'
        : null
    : null

  const system = readOrganizationSystemState(org.metadata)
  const permissions = resolveOrganizationPermissions({
    org: { ownerId: org.ownerId },
    role: viewerRole,
    system,
    userId: viewerId,
  })
  const canManageMeetings = canOrganizationPermission(permissions, 'manage_events')
  const isAssociated = Boolean(viewerId && (org.ownerId === viewerId || membership || follow))

  return {
    ok: true,
    value: {
      provinceCode,
      communitySlug: community.slug,
      org: {
        id: org.id,
        ownerId: org.ownerId,
        metadata: org.metadata,
        status: org.status,
        name: org.name,
      },
      viewerId,
      viewerRole,
      permissions,
      canManageMeetings,
      isAssociated,
    },
  }
}

async function ensureOrganizationMeetingThread(args: {
  orgId: string
  meetingId: string
  title: string
  ownerUserId: string
  existingThreadId?: string | null
}) {
  if (args.existingThreadId) {
    const existing = await prisma.messageThread.findUnique({
      where: { id: args.existingThreadId },
      select: { id: true },
    })
    if (existing?.id) return existing.id
  }

  const uniqueKey = `orgmeeting:${args.orgId}:${args.meetingId}`
  const existingByUnique = await prisma.messageThread.findUnique({
    where: { uniqueKey },
    select: { id: true },
  })
  if (existingByUnique?.id) return existingByUnique.id

  const now = new Date()
  const created = await prisma.messageThread.create({
    data: {
      type: MessageThreadType.group,
      uniqueKey,
      contextType: ORG_MEETING_CONTEXT_TYPE,
      contextId: `${args.orgId}|${args.meetingId}|${encodeURIComponent(args.title || 'Meeting room')}`,
      lastMessageAt: now,
      participants: {
        create: [
          {
            userId: args.ownerUserId,
            role: MessageParticipantRole.admin,
            lastReadAt: now,
            lastActivityAt: now,
          },
        ],
      },
    },
    select: { id: true },
  })

  return created.id
}

function buildGuestSpeakerInvites(args: {
  previous: OrgEventGuestSpeakerInvite[]
  selectedTags: OrgEventGuestSpeakerTag[]
  nowIso: string
}) {
  const previousByUserId = new Map(args.previous.map((invite) => [invite.userId, invite]))
  const nextInvites: OrgEventGuestSpeakerInvite[] = []
  const newlyInvited: OrgEventGuestSpeakerInvite[] = []

  for (const tag of args.selectedTags) {
    const existing = previousByUserId.get(tag.userId)
    if (existing) {
      nextInvites.push({
        ...existing,
        name: tag.name,
        handle: tag.handle,
        avatarUrl: tag.avatarUrl,
        coverUrl: tag.coverUrl,
      })
      continue
    }
    const created: OrgEventGuestSpeakerInvite = {
      ...tag,
      status: 'PENDING',
      invitedAt: args.nowIso,
      respondedAt: null,
      respondedByUserId: null,
    }
    nextInvites.push(created)
    newlyInvited.push(created)
  }

  return { nextInvites, newlyInvited }
}

async function resolveOrganizationAdminAndManagerIds(orgIds: string[]) {
  const uniqueIds = Array.from(new Set(orgIds.filter(Boolean)))
  if (!uniqueIds.length) return new Map<string, string[]>()

  const [orgRows, managerRows] = await Promise.all([
    prisma.business.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, ownerId: true },
    }),
    prisma.businessMembership.findMany({
      where: {
        businessId: { in: uniqueIds },
        role: { in: ['OWNER', 'MANAGER'] },
      },
      select: { businessId: true, userId: true },
    }),
  ])

  const recipientMap = new Map<string, Set<string>>()
  for (const org of orgRows) {
    if (!recipientMap.has(org.id)) recipientMap.set(org.id, new Set<string>())
    recipientMap.get(org.id)!.add(org.ownerId)
  }

  for (const row of managerRows) {
    if (!recipientMap.has(row.businessId)) recipientMap.set(row.businessId, new Set<string>())
    recipientMap.get(row.businessId)!.add(row.userId)
  }

  const result = new Map<string, string[]>()
  for (const [orgId, userIds] of recipientMap.entries()) {
    result.set(orgId, [...userIds])
  }
  return result
}

function buildSponsorInvites(args: {
  previous: OrgEventSponsorInvite[]
  selectedSponsors: OrgEventSponsorTag[]
  recipientMap: Map<string, string[]>
  nowIso: string
}) {
  const previousByOrgId = new Map(args.previous.map((invite) => [invite.organizationId, invite]))
  const nextInvites: OrgEventSponsorInvite[] = []
  const newlyInvited: OrgEventSponsorInvite[] = []

  for (const sponsor of args.selectedSponsors) {
    const existing = previousByOrgId.get(sponsor.organizationId)
    if (existing) {
      nextInvites.push({
        ...existing,
        name: sponsor.name,
        slug: sponsor.slug,
        provinceCode: sponsor.provinceCode,
        communitySlug: sponsor.communitySlug,
        logoUrl: sponsor.logoUrl,
        coverUrl: sponsor.coverUrl,
      })
      continue
    }
    const created: OrgEventSponsorInvite = {
      ...sponsor,
      status: 'PENDING',
      invitedAt: args.nowIso,
      respondedAt: null,
      respondedByUserId: null,
      recipientUserIds: args.recipientMap.get(sponsor.organizationId) ?? [],
    }
    nextInvites.push(created)
    newlyInvited.push(created)
  }

  return { nextInvites, newlyInvited }
}

async function appendOrganizationAuditLogEntry(
  dbClient: Prisma.TransactionClient | typeof prisma,
  orgId: string,
  entry: Omit<OrgAuditLogEntry, 'id' | 'createdAt'>,
) {
  const row = await dbClient.business.findUnique({ where: { id: orgId }, select: { metadata: true } })
  if (!row) return

  const system = readOrganizationSystemState(row.metadata)
  const nextEntry: OrgAuditLogEntry = {
    id: randomUUID(),
    actorUserId: entry.actorUserId,
    action: entry.action,
    reason: entry.reason ?? null,
    previousValue: entry.previousValue ?? null,
    nextValue: entry.nextValue ?? null,
    createdAt: new Date().toISOString(),
  }
  const nextAuditLog = [...system.auditLog, nextEntry].slice(-ORG_AUDIT_LOG_LIMIT)
  const nextSystem: OrganizationSystemState = {
    ...system,
    auditLog: nextAuditLog,
  }

  await dbClient.business.update({
    where: { id: orgId },
    data: { metadata: mergeOrganizationSystemStateIntoMetadata(row.metadata, nextSystem) },
    select: { id: true },
  })
}

async function ensureUniqueCommunityOrgSlug({
  provinceCode,
  communitySlug,
  baseSlug,
}: {
  provinceCode: string
  communitySlug: string
  baseSlug: string
}) {
  const base = trimSlugLength(baseSlug, 80) || 'organization'
  let candidate = base
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await prisma.business.findFirst({
      where: { provinceCode, communitySlug, slug: candidate },
      select: { id: true },
    })
    if (!existing) return candidate

    const suffix = randomNumericSlugSuffix()
    candidate = trimSlugLength(`${base}-${suffix}`, 80) || `organization-${suffix}`
  }

  const suffix = randomNumericSlugSuffix()
  return trimSlugLength(`${base}-${suffix}`, 80) || `organization-${suffix}`
}

async function generateUniqueCommunityOrgSlug({
  provinceCode,
  communitySlug,
  name,
}: {
  provinceCode: string
  communitySlug: string
  name: string
}) {
  const base = trimSlugLength(slugifyText(name), 80) || 'organization'
  return ensureUniqueCommunityOrgSlug({ provinceCode, communitySlug, baseSlug: base })
}

registerOrganizationCoreRoutes(app, {
  CommunityOrgCreateBody,
  CommunityOrgListQuery,
  CommunityOrgMemberParams,
  CommunityOrgParams,
  CommunityOrgSettingsBody,
  CommunityOrgSlugParams,
  MAX_BUSINESSES_PER_USER,
  ModerationStatus,
  OrganizationsDirectoryQuery,
  SYSTEM_MANAGER_RANK_ID,
  appendOrganizationAuditLogEntry,
  applyVisibleModerationFiltersToBusinessWhere,
  buildCommunityOrgPayload,
  enqueueContentAiScanForOrganization,
  ensureUniqueCommunityOrgSlug,
  findCommunity,
  isBusinessHiddenFromViewer,
  loadViewerAuthContext,
  loadViewerBlockState,
  mergeOrganizationSystemStateIntoMetadata,
  moderationLockedErrorCode,
  normalizeMediaUrl,
  normalizeProvinceCode,
  readOrganizationSystemState,
  resolveUserId,
  sanitizePlainText,
  slugifyText,
  trimSlugLength,
  withSchemaGuard,
})

app.get('/communities/:province/:municipality/orgs/:slug/governance/state', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const viewerId = (await resolveUserId(req)) ?? null
    const membership = viewerId
      ? await prisma.businessMembership.findUnique({
          where: { businessId_userId: { businessId: org.id, userId: viewerId } },
          select: { role: true },
        })
      : null

    const viewerRole: 'OWNER' | 'MANAGER' | null = viewerId
      ? org.ownerId === viewerId
        ? 'OWNER'
        : membership?.role === 'MANAGER'
          ? 'MANAGER'
          : null
      : null

    const system = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({
      org: { ownerId: org.ownerId },
      role: viewerRole,
      system,
      userId: viewerId,
    })

    const rawIncludeDrafts = (req.query as any)?.includeDrafts
    const wantsDrafts = rawIncludeDrafts === '1' || rawIncludeDrafts === 'true'
    const canSeeDrafts = Boolean(viewerId && canOrganizationPermission(permissions, 'manage_events'))
    const events = wantsDrafts && canSeeDrafts ? system.events : system.events.filter((event) => (event?.status ?? 'PUBLISHED') === 'PUBLISHED')

    return reply.send({
      state: {
        joinMode: system.joinMode,
        ranks: system.ranks,
        plans: system.plans,
        sponsors: system.sponsors,
        events,
        achievements: system.achievements,
        achievementAwards: system.achievementAwards,
        referrals: system.referrals,
        reputationLedger: system.reputationLedger,
        eventRsvps: system.eventRsvps,
        economics: system.economics,
      },
      viewer: {
        userId: viewerId,
        role: viewerRole,
        permissions,
        memberState: viewerId ? system.members[viewerId] ?? null : null,
      },
    })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/meetings', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const viewerId = (await resolveUserId(req)) ?? null
    const access = await resolveOrganizationMeetingAccess({
      provinceRaw: params.data.province,
      municipalityRaw: params.data.municipality,
      slugRaw: params.data.slug,
      viewerId,
    })
    if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })

    await ensureOrganizationMeetingTables()

    const rawIncludeArchived = (req.query as Record<string, unknown> | undefined)?.includeArchived
    const wantsArchived =
      rawIncludeArchived === '1' ||
      rawIncludeArchived === 'true' ||
      rawIncludeArchived === 1 ||
      rawIncludeArchived === true
    const includeArchived = wantsArchived && access.value.canManageMeetings

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        id,
        business_id,
        created_by,
        title,
        description,
        visibility,
        status,
        requires_password,
        password_hash,
        requires_manual_admit,
        max_participants,
        schedule_starts_at,
        schedule_ends_at,
        thread_id,
        created_at,
        updated_at
      FROM organization_meeting
      WHERE business_id = ${access.value.org.id}
      ${includeArchived ? Prisma.empty : Prisma.sql`AND status = 'ACTIVE'`}
      ${
        access.value.canManageMeetings || access.value.isAssociated
          ? Prisma.empty
          : Prisma.sql`AND visibility = 'PUBLIC'`
      }
      ORDER BY
        CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
        COALESCE(schedule_starts_at, updated_at) ASC,
        updated_at DESC
      LIMIT 200
    `)) as OrganizationMeetingRow[]

    if (!rows.length) {
      return reply.send({
        viewer: { canManageMeetings: access.value.canManageMeetings },
        items: [],
      })
    }

    const meetingIds = rows.map((row) => row.id)
    const threadIds = Array.from(new Set(rows.map((row) => row.thread_id).filter((value): value is string => Boolean(value))))

    type ThreadParticipantCountRow = { thread_id: string; count: number }
    const participantRows = threadIds.length
      ? ((await prisma.$queryRaw(Prisma.sql`
          SELECT "threadId" as thread_id, COUNT(*)::int as count
          FROM "MessageParticipant"
          WHERE "threadId" IN (${Prisma.join(threadIds)})
          GROUP BY "threadId"
        `)) as ThreadParticipantCountRow[])
      : []
    const participantCountByThreadId = new Map<string, number>(
      participantRows.map((row) => [row.thread_id, Number(row.count) || 0]),
    )

    const assignedRows = viewerId
      ? ((await prisma.$queryRaw(Prisma.sql`
          SELECT meeting_id, user_id
          FROM organization_meeting_assignment
          WHERE user_id = ${viewerId}
            AND meeting_id IN (${Prisma.join(meetingIds)})
        `)) as OrganizationMeetingAssignmentRow[])
      : []
    const assignedMeetingIds = new Set(assignedRows.map((row) => row.meeting_id))

    const admissionRows = viewerId
      ? ((await prisma.$queryRaw(Prisma.sql`
          SELECT meeting_id, user_id, status
          FROM organization_meeting_admission
          WHERE user_id = ${viewerId}
            AND meeting_id IN (${Prisma.join(meetingIds)})
        `)) as OrganizationMeetingAdmissionRow[])
      : []
    const admissionByMeetingId = new Map<string, OrganizationMeetingAdmissionStatus | null>(
      admissionRows.map((row) => [row.meeting_id, normalizeMeetingAdmissionStatus(row.status)]),
    )

    type ViewerParticipantRow = { thread_id: string }
    const viewerParticipantRows = viewerId && threadIds.length
      ? ((await prisma.$queryRaw(Prisma.sql`
          SELECT "threadId" as thread_id
          FROM "MessageParticipant"
          WHERE "userId" = ${viewerId}
            AND "threadId" IN (${Prisma.join(threadIds)})
        `)) as ViewerParticipantRow[])
      : []
    const viewerThreadIds = new Set(viewerParticipantRows.map((row) => row.thread_id))

    const items = rows.map((row) =>
      mapMeetingRowForViewer({
        row,
        participantCount: row.thread_id ? participantCountByThreadId.get(row.thread_id) ?? 0 : 0,
        canManageMeetings: access.value.canManageMeetings,
        isAssociated: access.value.isAssociated,
        isAssigned: assignedMeetingIds.has(row.id),
        isParticipant: row.thread_id ? viewerThreadIds.has(row.thread_id) : false,
        admissionStatus: admissionByMeetingId.get(row.id) ?? null,
      }),
    )

    return reply.send({
      viewer: { canManageMeetings: access.value.canManageMeetings },
      items,
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/meetings', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? null
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMeetingCreateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const access = await resolveOrganizationMeetingAccess({
      provinceRaw: params.data.province,
      municipalityRaw: params.data.municipality,
      slugRaw: params.data.slug,
      viewerId: userId,
    })
    if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })
    if (!access.value.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })

    await ensureOrganizationMeetingTables()

    const meetingId = `meeting_${randomUUID().replace(/-/g, '').slice(0, 14)}`
    const title = sanitizePlainText(body.data.title).trim() || 'Untitled meeting'
    const description = body.data.description ? sanitizePlainText(body.data.description).trim() || null : null
    const visibility = body.data.visibility
    const status = body.data.status
    const requiresPassword = body.data.requiresPassword
    const passwordHash = requiresPassword && body.data.password ? hashMeetingPassword(body.data.password.trim()) : null
    const requiresManualAdmit = body.data.requiresManualAdmit
    const maxParticipants = normalizeMeetingMaxParticipants(body.data.maxParticipants)
    const startsAt = body.data.schedule?.startsAt ? new Date(body.data.schedule.startsAt) : null
    const endsAt = body.data.schedule?.endsAt ? new Date(body.data.schedule.endsAt) : null
    const now = new Date()

    const threadId = await ensureOrganizationMeetingThread({
      orgId: access.value.org.id,
      meetingId,
      title,
      ownerUserId: userId,
      existingThreadId: null,
    })

    await prisma.$executeRaw`
      INSERT INTO organization_meeting (
        id,
        business_id,
        created_by,
        title,
        description,
        visibility,
        status,
        requires_password,
        password_hash,
        requires_manual_admit,
        max_participants,
        schedule_starts_at,
        schedule_ends_at,
        thread_id,
        created_at,
        updated_at
      )
      VALUES (
        ${meetingId},
        ${access.value.org.id},
        ${userId},
        ${title},
        ${description},
        ${visibility},
        ${status},
        ${requiresPassword},
        ${passwordHash},
        ${requiresManualAdmit},
        ${maxParticipants},
        ${startsAt},
        ${endsAt},
        ${threadId},
        ${now},
        ${now}
      )
    `

    const assignedIds = Array.from(new Set((body.data.assignedMemberUserIds ?? []).map((value) => value.trim()).filter(Boolean)))
    for (const assignedUserId of assignedIds) {
      await prisma.$executeRaw`
        INSERT INTO organization_meeting_assignment (meeting_id, user_id, created_at)
        VALUES (${meetingId}, ${assignedUserId}, ${now})
        ON CONFLICT (meeting_id, user_id) DO NOTHING
      `
    }

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        id,
        business_id,
        created_by,
        title,
        description,
        visibility,
        status,
        requires_password,
        password_hash,
        requires_manual_admit,
        max_participants,
        schedule_starts_at,
        schedule_ends_at,
        thread_id,
        created_at,
        updated_at
      FROM organization_meeting
      WHERE id = ${meetingId}
      LIMIT 1
    `)) as OrganizationMeetingRow[]
    const row = rows[0]
    if (!row) return reply.code(500).send({ error: 'meeting_create_failed' })

    const meeting = mapMeetingRowForViewer({
      row,
      participantCount: 1,
      canManageMeetings: true,
      isAssociated: true,
      isAssigned: false,
      isParticipant: true,
      admissionStatus: 'ADMITTED',
    })

    return reply.code(201).send({ meeting })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/meetings/:meetingId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const params = CommunityOrgMeetingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const viewerId = (await resolveUserId(req)) ?? null
    const access = await resolveOrganizationMeetingAccess({
      provinceRaw: params.data.province,
      municipalityRaw: params.data.municipality,
      slugRaw: params.data.slug,
      viewerId,
    })
    if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })

    await ensureOrganizationMeetingTables()

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        id,
        business_id,
        created_by,
        title,
        description,
        visibility,
        status,
        requires_password,
        password_hash,
        requires_manual_admit,
        max_participants,
        schedule_starts_at,
        schedule_ends_at,
        thread_id,
        created_at,
        updated_at
      FROM organization_meeting
      WHERE id = ${params.data.meetingId}
        AND business_id = ${access.value.org.id}
      LIMIT 1
    `)) as OrganizationMeetingRow[]
    const row = rows[0]
    if (!row) return reply.code(404).send({ error: 'meeting_not_found' })

    const assignedRows = viewerId
      ? ((await prisma.$queryRaw(Prisma.sql`
          SELECT meeting_id, user_id
          FROM organization_meeting_assignment
          WHERE meeting_id = ${row.id}
            AND user_id = ${viewerId}
          LIMIT 1
        `)) as OrganizationMeetingAssignmentRow[])
      : []
    const isAssigned = Boolean(assignedRows[0])

    const admissionRows = viewerId
      ? ((await prisma.$queryRaw(Prisma.sql`
          SELECT meeting_id, user_id, status
          FROM organization_meeting_admission
          WHERE meeting_id = ${row.id}
            AND user_id = ${viewerId}
          LIMIT 1
        `)) as OrganizationMeetingAdmissionRow[])
      : []
    const admissionStatus = normalizeMeetingAdmissionStatus(admissionRows[0]?.status)

    type ThreadParticipantCountRow = { count: number }
    const participantCountRows = row.thread_id
      ? ((await prisma.$queryRaw(Prisma.sql`
          SELECT COUNT(*)::int as count
          FROM "MessageParticipant"
          WHERE "threadId" = ${row.thread_id}
        `)) as ThreadParticipantCountRow[])
      : [{ count: 0 }]
    const participantCount = Number(participantCountRows[0]?.count || 0)

    type ViewerParticipantRow = { exists: number }
    const viewerParticipantRows = viewerId && row.thread_id
      ? ((await prisma.$queryRaw(Prisma.sql`
          SELECT 1::int as exists
          FROM "MessageParticipant"
          WHERE "threadId" = ${row.thread_id}
            AND "userId" = ${viewerId}
          LIMIT 1
        `)) as ViewerParticipantRow[])
      : []
    const isParticipant = Boolean(viewerParticipantRows[0]?.exists)

    const meeting = mapMeetingRowForViewer({
      row,
      participantCount,
      canManageMeetings: access.value.canManageMeetings,
      isAssociated: access.value.isAssociated,
      isAssigned,
      isParticipant,
      admissionStatus,
    })

    if (
      !access.value.canManageMeetings &&
      normalizeMeetingVisibility(row.visibility) === 'PRIVATE' &&
      !access.value.isAssociated &&
      !isAssigned
    ) {
      return reply.code(403).send({ error: 'meeting_not_assigned' })
    }
    if (!access.value.canManageMeetings && normalizeMeetingStatus(row.status) !== 'ACTIVE') {
      return reply.code(404).send({ error: 'meeting_not_found' })
    }

    const rtcState = await readMeetingRtcRoomState(row.id)

    type WaitingParticipantRow = {
      user_id: string
      status: string
      name: string | null
      handle: string | null
      avatar_url: string | null
    }

    let waitingParticipants: OrganizationMeetingWaitingParticipant[] = []
    if (access.value.canManageMeetings && viewerId) {
      const waitingRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          admission.user_id,
          admission.status,
          "User"."name" as name,
          "User"."handle" as handle,
          "User"."avatarUrl" as avatar_url
        FROM organization_meeting_admission admission
        LEFT JOIN "User" ON "User"."id" = admission.user_id
        WHERE admission.meeting_id = ${row.id}
          AND admission.user_id <> ${viewerId}
          AND admission.status IN ('WAITING', 'ADMITTED')
        ORDER BY
          CASE admission.status
            WHEN 'WAITING' THEN 0
            ELSE 1
          END ASC,
          admission.updated_at ASC
        LIMIT 50
      `)) as WaitingParticipantRow[]

      waitingParticipants = waitingRows
        .map((entry): OrganizationMeetingWaitingParticipant | null => {
          const status = normalizeMeetingAdmissionStatus(entry.status)
          if (!status) return null
          const userId = typeof entry.user_id === 'string' ? entry.user_id : ''
          if (!userId) return null
          const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Civil member'
          const handle = typeof entry.handle === 'string' && entry.handle.trim() ? entry.handle.trim() : null
          const avatarUrl = typeof entry.avatar_url === 'string' && entry.avatar_url.trim() ? entry.avatar_url.trim() : null
          return { userId, status, name, handle, avatarUrl }
        })
        .filter((entry): entry is OrganizationMeetingWaitingParticipant => Boolean(entry))
    }

    return reply.send({
      meeting: {
        ...meeting,
        rtc: rtcState
          ? {
              peerCount: rtcState.peerCount,
              hostPresent: rtcState.hostPresent,
            }
          : null,
        waitingParticipants,
      },
      viewer: { canManageMeetings: access.value.canManageMeetings },
    })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/governance/meetings/:meetingId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? null
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMeetingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const access = await resolveOrganizationMeetingAccess({
      provinceRaw: params.data.province,
      municipalityRaw: params.data.municipality,
      slugRaw: params.data.slug,
      viewerId: userId,
    })
    if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })
    if (!access.value.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })

    await ensureOrganizationMeetingTables()

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        id,
        business_id,
        created_by,
        title,
        description,
        visibility,
        status,
        requires_password,
        password_hash,
        requires_manual_admit,
        max_participants,
        schedule_starts_at,
        schedule_ends_at,
        thread_id,
        created_at,
        updated_at
      FROM organization_meeting
      WHERE id = ${params.data.meetingId}
        AND business_id = ${access.value.org.id}
      LIMIT 1
    `)) as OrganizationMeetingRow[]
    const row = rows[0]
    if (!row) return reply.code(404).send({ error: 'meeting_not_found' })

    type ThreadParticipantCountRow = { count: number }
    const participantCountRows = row.thread_id
      ? ((await prisma.$queryRaw(Prisma.sql`
          SELECT COUNT(*)::int as count
          FROM "MessageParticipant"
          WHERE "threadId" = ${row.thread_id}
        `)) as ThreadParticipantCountRow[])
      : [{ count: 0 }]
    const participantCount = Number(participantCountRows[0]?.count || 0)

    type AdmissionLookupRow = { status: string | null }
    const admissionRows = (await prisma.$queryRaw(Prisma.sql`
      SELECT status
      FROM organization_meeting_admission
      WHERE meeting_id = ${row.id}
        AND user_id = ${userId}
      LIMIT 1
    `)) as AdmissionLookupRow[]
    const admissionStatus = normalizeMeetingAdmissionStatus(admissionRows[0]?.status)

    type ViewerParticipantRow = { exists: number }
    const viewerParticipantRows = row.thread_id
      ? ((await prisma.$queryRaw(Prisma.sql`
          SELECT 1::int as exists
          FROM "MessageParticipant"
          WHERE "threadId" = ${row.thread_id}
            AND "userId" = ${userId}
          LIMIT 1
        `)) as ViewerParticipantRow[])
      : []
    const isParticipant = Boolean(viewerParticipantRows[0]?.exists)

    const meeting = mapMeetingRowForViewer({
      row,
      participantCount,
      canManageMeetings: true,
      isAssociated: true,
      isAssigned: false,
      isParticipant,
      admissionStatus,
    })

    const rtcState = await readMeetingRtcRoomState(row.id)
    return reply.send({
      meeting: {
        ...meeting,
        rtc: rtcState
          ? {
              peerCount: rtcState.peerCount,
              hostPresent: rtcState.hostPresent,
            }
          : null,
      },
      viewer: { canManageMeetings: true },
    })
  }),
)

app.put('/communities/:province/:municipality/orgs/:slug/governance/meetings/:meetingId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? null
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMeetingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMeetingUpdateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const access = await resolveOrganizationMeetingAccess({
      provinceRaw: params.data.province,
      municipalityRaw: params.data.municipality,
      slugRaw: params.data.slug,
      viewerId: userId,
    })
    if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })
    if (!access.value.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })

    await ensureOrganizationMeetingTables()

    const existingRows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        id,
        business_id,
        created_by,
        title,
        description,
        visibility,
        status,
        requires_password,
        password_hash,
        requires_manual_admit,
        max_participants,
        schedule_starts_at,
        schedule_ends_at,
        thread_id,
        created_at,
        updated_at
      FROM organization_meeting
      WHERE id = ${params.data.meetingId}
        AND business_id = ${access.value.org.id}
      LIMIT 1
    `)) as OrganizationMeetingRow[]
    const existing = existingRows[0]
    if (!existing) return reply.code(404).send({ error: 'meeting_not_found' })

    const nextTitle = body.data.title === undefined ? existing.title : sanitizePlainText(body.data.title).trim() || 'Untitled meeting'
    const nextDescription =
      body.data.description === undefined
        ? existing.description
        : body.data.description
          ? sanitizePlainText(body.data.description).trim() || null
          : null
    const nextVisibility = body.data.visibility ?? normalizeMeetingVisibility(existing.visibility)
    const nextStatus = body.data.status ?? normalizeMeetingStatus(existing.status)
    const nextRequiresManualAdmit =
      body.data.requiresManualAdmit === undefined ? Boolean(existing.requires_manual_admit) : body.data.requiresManualAdmit
    const nextMaxParticipants = normalizeMeetingMaxParticipants(
      body.data.maxParticipants === undefined ? existing.max_participants : body.data.maxParticipants,
    )

    const nextRequiresPassword =
      body.data.requiresPassword === undefined ? Boolean(existing.requires_password) : body.data.requiresPassword
    let nextPasswordHash = existing.password_hash
    if (nextRequiresPassword) {
      if (typeof body.data.password === 'string' && body.data.password.trim()) {
        nextPasswordHash = hashMeetingPassword(body.data.password.trim())
      }
      if (!nextPasswordHash) return reply.code(400).send({ error: 'password_required' })
    } else {
      nextPasswordHash = null
    }

    let nextStartsAt = existing.schedule_starts_at
    let nextEndsAt = existing.schedule_ends_at
    if (body.data.schedule !== undefined) {
      nextStartsAt = body.data.schedule?.startsAt ? new Date(body.data.schedule.startsAt) : null
      nextEndsAt = body.data.schedule?.endsAt ? new Date(body.data.schedule.endsAt) : null
    }

    const now = new Date()
    await prisma.$executeRaw`
      UPDATE organization_meeting
      SET
        title = ${nextTitle},
        description = ${nextDescription},
        visibility = ${nextVisibility},
        status = ${nextStatus},
        requires_password = ${nextRequiresPassword},
        password_hash = ${nextPasswordHash},
        requires_manual_admit = ${nextRequiresManualAdmit},
        max_participants = ${nextMaxParticipants},
        schedule_starts_at = ${nextStartsAt},
        schedule_ends_at = ${nextEndsAt},
        updated_at = ${now}
      WHERE id = ${existing.id}
    `

    if (body.data.assignedMemberUserIds !== undefined) {
      const assignedIds = Array.from(new Set(body.data.assignedMemberUserIds.map((value) => value.trim()).filter(Boolean)))
      await prisma.$executeRaw`
        DELETE FROM organization_meeting_assignment
        WHERE meeting_id = ${existing.id}
      `
      for (const assignedUserId of assignedIds) {
        await prisma.$executeRaw`
          INSERT INTO organization_meeting_assignment (meeting_id, user_id, created_at)
          VALUES (${existing.id}, ${assignedUserId}, ${now})
          ON CONFLICT (meeting_id, user_id) DO NOTHING
        `
      }
    }

    const refreshedRows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        id,
        business_id,
        created_by,
        title,
        description,
        visibility,
        status,
        requires_password,
        password_hash,
        requires_manual_admit,
        max_participants,
        schedule_starts_at,
        schedule_ends_at,
        thread_id,
        created_at,
        updated_at
      FROM organization_meeting
      WHERE id = ${existing.id}
      LIMIT 1
    `)) as OrganizationMeetingRow[]
    const refreshed = refreshedRows[0]
    if (!refreshed) return reply.code(500).send({ error: 'meeting_save_failed' })

    type ThreadParticipantCountRow = { count: number }
    const participantCountRows = refreshed.thread_id
      ? ((await prisma.$queryRaw(Prisma.sql`
          SELECT COUNT(*)::int as count
          FROM "MessageParticipant"
          WHERE "threadId" = ${refreshed.thread_id}
        `)) as ThreadParticipantCountRow[])
      : [{ count: 0 }]
    const participantCount = Number(participantCountRows[0]?.count || 0)

    const meeting = mapMeetingRowForViewer({
      row: refreshed,
      participantCount,
      canManageMeetings: true,
      isAssociated: true,
      isAssigned: false,
      isParticipant: true,
      admissionStatus: 'ADMITTED',
    })

    return reply.send({ meeting })
  }),
)

app.delete('/communities/:province/:municipality/orgs/:slug/governance/meetings/:meetingId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? null
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMeetingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const access = await resolveOrganizationMeetingAccess({
      provinceRaw: params.data.province,
      municipalityRaw: params.data.municipality,
      slugRaw: params.data.slug,
      viewerId: userId,
    })
    if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })
    if (!access.value.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })

    await ensureOrganizationMeetingTables()

    const deleted = await prisma.$executeRaw`
      DELETE FROM organization_meeting
      WHERE id = ${params.data.meetingId}
        AND business_id = ${access.value.org.id}
    `
    if (Number(deleted) <= 0) return reply.code(404).send({ error: 'meeting_not_found' })

    return reply.send({ ok: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/meetings/:meetingId/join', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? null
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMeetingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMeetingJoinBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const access = await resolveOrganizationMeetingAccess({
      provinceRaw: params.data.province,
      municipalityRaw: params.data.municipality,
      slugRaw: params.data.slug,
      viewerId: userId,
    })
    if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })

    await ensureOrganizationMeetingTables()

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        id,
        business_id,
        created_by,
        title,
        description,
        visibility,
        status,
        requires_password,
        password_hash,
        requires_manual_admit,
        max_participants,
        schedule_starts_at,
        schedule_ends_at,
        thread_id,
        created_at,
        updated_at
      FROM organization_meeting
      WHERE id = ${params.data.meetingId}
        AND business_id = ${access.value.org.id}
      LIMIT 1
    `)) as OrganizationMeetingRow[]
    const row = rows[0]
    if (!row) return reply.code(404).send({ error: 'meeting_not_found' })

    const assignedRows = (await prisma.$queryRaw(Prisma.sql`
      SELECT meeting_id, user_id
      FROM organization_meeting_assignment
      WHERE meeting_id = ${row.id}
        AND user_id = ${userId}
      LIMIT 1
    `)) as OrganizationMeetingAssignmentRow[]
    const isAssigned = Boolean(assignedRows[0])

    const admissionRows = (await prisma.$queryRaw(Prisma.sql`
      SELECT meeting_id, user_id, status
      FROM organization_meeting_admission
      WHERE meeting_id = ${row.id}
        AND user_id = ${userId}
      LIMIT 1
    `)) as OrganizationMeetingAdmissionRow[]
    const admissionStatus = normalizeMeetingAdmissionStatus(admissionRows[0]?.status)

    const status = normalizeMeetingStatus(row.status)
    const visibility = normalizeMeetingVisibility(row.visibility)

    if (!access.value.canManageMeetings && status !== 'ACTIVE') {
      return reply.code(403).send({ error: 'meeting_not_published' })
    }
    if (!access.value.canManageMeetings && visibility === 'PRIVATE' && !access.value.isAssociated && !isAssigned) {
      return reply.code(403).send({ error: 'meeting_not_assigned' })
    }

    if (row.requires_password && !access.value.canManageMeetings) {
      const provided = body.data.password?.trim() ?? ''
      if (!provided || !row.password_hash || hashMeetingPassword(provided) !== row.password_hash) {
        return reply.code(403).send({ error: 'invalid_meeting_password' })
      }
    }

    if (row.schedule_starts_at && Date.now() < new Date(row.schedule_starts_at).getTime()) {
      return reply.code(403).send({ error: 'meeting_not_started' })
    }
    if (row.schedule_ends_at && Date.now() > new Date(row.schedule_ends_at).getTime()) {
      return reply.code(403).send({ error: 'meeting_ended' })
    }

    let threadId = row.thread_id
    if (!threadId) {
      threadId = await ensureOrganizationMeetingThread({
        orgId: access.value.org.id,
        meetingId: row.id,
        title: row.title,
        ownerUserId: access.value.org.ownerId,
      })
      await prisma.$executeRaw`
        UPDATE organization_meeting
        SET thread_id = ${threadId}, updated_at = ${new Date()}
        WHERE id = ${row.id}
      `
    }

    const now = new Date()
    if (row.requires_manual_admit && !access.value.canManageMeetings && admissionStatus !== 'ADMITTED') {
      await prisma.$executeRaw`
        INSERT INTO organization_meeting_admission (meeting_id, user_id, status, decided_by_user_id, created_at, updated_at)
        VALUES (${row.id}, ${userId}, ${'WAITING'}, ${null}, ${now}, ${now})
        ON CONFLICT (meeting_id, user_id)
        DO UPDATE SET status = EXCLUDED.status, decided_by_user_id = NULL, updated_at = EXCLUDED.updated_at
      `
      const meeting = mapMeetingRowForViewer({
        row: { ...row, thread_id: threadId },
        participantCount: 0,
        canManageMeetings: access.value.canManageMeetings,
        isAssociated: access.value.isAssociated,
        isAssigned,
        isParticipant: false,
        admissionStatus: 'WAITING',
      })
      const rtcState = await readMeetingRtcRoomState(row.id)
      return reply.send({
        state: 'waiting',
        threadId: null,
        meeting: {
          ...meeting,
          rtc: rtcState
            ? {
                peerCount: rtcState.peerCount,
                hostPresent: rtcState.hostPresent,
              }
            : null,
        },
      })
    }

    await prisma.messageParticipant.upsert({
      where: {
        threadId_userId: {
          threadId,
          userId,
        },
      },
      create: {
        threadId,
        userId,
        role: access.value.canManageMeetings ? MessageParticipantRole.admin : MessageParticipantRole.member,
        lastActivityAt: now,
      },
      update: {
        lastActivityAt: now,
      },
    })

    await prisma.$executeRaw`
      INSERT INTO organization_meeting_admission (meeting_id, user_id, status, decided_by_user_id, created_at, updated_at)
      VALUES (${row.id}, ${userId}, ${'ADMITTED'}, ${access.value.canManageMeetings ? userId : null}, ${now}, ${now})
      ON CONFLICT (meeting_id, user_id)
      DO UPDATE SET status = EXCLUDED.status, decided_by_user_id = EXCLUDED.decided_by_user_id, updated_at = EXCLUDED.updated_at
    `

    type ThreadParticipantCountRow = { count: number }
    const participantCountRows = (await prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int as count
      FROM "MessageParticipant"
      WHERE "threadId" = ${threadId}
    `)) as ThreadParticipantCountRow[]
    const participantCount = Number(participantCountRows[0]?.count || 0)

    const meeting = mapMeetingRowForViewer({
      row: { ...row, thread_id: threadId },
      participantCount,
      canManageMeetings: access.value.canManageMeetings,
      isAssociated: access.value.isAssociated,
      isAssigned,
      isParticipant: true,
      admissionStatus: 'ADMITTED',
    })

    const rtcState = await readMeetingRtcRoomState(row.id)
    return reply.send({
      state: 'joined',
      threadId,
      meeting: {
        ...meeting,
        rtc: rtcState
          ? {
              peerCount: rtcState.peerCount,
              hostPresent: rtcState.hostPresent,
            }
          : null,
      },
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/meetings/:meetingId/rtc/session', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const userId = (await resolveUserId(req)) ?? null
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMeetingParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMeetingRtcSessionBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const access = await resolveOrganizationMeetingAccess({
      provinceRaw: params.data.province,
      municipalityRaw: params.data.municipality,
      slugRaw: params.data.slug,
      viewerId: userId,
    })
    if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })

    await ensureOrganizationMeetingTables()

    const rows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        id,
        business_id,
        created_by,
        title,
        description,
        visibility,
        status,
        requires_password,
        password_hash,
        requires_manual_admit,
        max_participants,
        schedule_starts_at,
        schedule_ends_at,
        thread_id,
        created_at,
        updated_at
      FROM organization_meeting
      WHERE id = ${params.data.meetingId}
        AND business_id = ${access.value.org.id}
      LIMIT 1
    `)) as OrganizationMeetingRow[]
    const row = rows[0]
    if (!row) return reply.code(404).send({ error: 'meeting_not_found' })
    if (normalizeMeetingStatus(row.status) !== 'ACTIVE' && !access.value.canManageMeetings) {
      return reply.code(403).send({ error: 'meeting_not_published' })
    }

    let threadId = row.thread_id
    if (!threadId) {
      threadId = await ensureOrganizationMeetingThread({
        orgId: access.value.org.id,
        meetingId: row.id,
        title: row.title,
        ownerUserId: access.value.org.ownerId,
      })
      await prisma.$executeRaw`
        UPDATE organization_meeting
        SET thread_id = ${threadId}, updated_at = ${new Date()}
        WHERE id = ${row.id}
      `
    }

    type AdmissionLookupRow = { status: string | null }
    const admissionRows = (await prisma.$queryRaw(Prisma.sql`
      SELECT status
      FROM organization_meeting_admission
      WHERE meeting_id = ${row.id}
        AND user_id = ${userId}
      LIMIT 1
    `)) as AdmissionLookupRow[]
    const admissionStatus = normalizeMeetingAdmissionStatus(admissionRows[0]?.status)

    type ParticipantLookupRow = { exists: number }
    const participantRows = (await prisma.$queryRaw(Prisma.sql`
      SELECT 1::int as exists
      FROM "MessageParticipant"
      WHERE "threadId" = ${threadId}
        AND "userId" = ${userId}
      LIMIT 1
    `)) as ParticipantLookupRow[]
    const isParticipant = Boolean(participantRows[0]?.exists)

    if (!access.value.canManageMeetings && !isParticipant && admissionStatus !== 'ADMITTED') {
      return reply.code(403).send({ error: 'meeting_not_joined' })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, handle: true },
    })
    if (!user) return reply.code(404).send({ error: 'user_not_found' })
    const displayName = body.data.displayName?.trim() || user.name?.trim() || user.handle || 'Civil user'

    const rtc = await issueMeetingRtcSession({
      roomId: row.id,
      userId,
      role: access.value.canManageMeetings ? 'manager' : 'participant',
      displayName,
      deviceId: body.data.deviceId ?? null,
      capabilities: body.data.capabilities ?? null,
    })

    if ('error' in rtc) {
      const statusCode =
        typeof rtc.statusCode === 'number' && rtc.statusCode >= 400
          ? rtc.statusCode
          : rtc.error === 'meeting_rtc_not_configured'
            ? 503
            : rtc.error === 'meeting_rtc_timeout'
              ? 504
              : 502
      return reply.code(statusCode).send({ error: rtc.error })
    }

    return reply.send(rtc.session)
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/events/draft', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    const canCreate =
      canOrganizationPermission(permissions, 'manage_events') ||
      canOrganizationPermission(permissions, 'create_announcements') ||
      canOrganizationPermission(permissions, 'create_paid_events')
    if (!canCreate) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const nowIso = new Date().toISOString()
    const event: OrgEventDefinition = {
      id: `event_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      title: 'Untitled event',
      description: null,
      category: 'Other',
      access: 'PUBLIC',
      eligibleRankIds: [],
      startsAt: nowIso,
      endsAt: null,
      capacity: null,
      paid: false,
      priceCents: null,
      currency: 'CAD',
      guestSpeakers: [],
      guestSpeakerInvites: [],
      sponsors: [],
      sponsorInvites: [],
      fees: [],
      primaryPhotoUrl: null,
      galleryPhotoUrls: [],
      agenda: [],
      attachments: [],
      status: 'DRAFT',
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    const nextSystem: OrganizationSystemState = { ...current, events: [...current.events, event] }
    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'event.draft.created',
      reason: null,
      previousValue: null,
      nextValue: event,
    })

    return reply.code(201).send({ event })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgEventParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_events')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const event = current.events.find((item) => item.id === params.data.eventId) ?? null
    if (!event) return reply.code(404).send({ error: 'event_not_found' })

    const eventRsvps = current.eventRsvps.filter((row) => row.eventId === event.id)
    const rsvpUserIds = Array.from(new Set(eventRsvps.map((row) => row.userId).filter(Boolean)))
    const rsvpUsers: FriendUser[] = rsvpUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: rsvpUserIds } },
          select: FRIEND_USER_SELECT,
        })
      : []
    const rsvpUserMap = new Map(rsvpUsers.map((user) => [user.id, user]))

    const rsvps = eventRsvps
      .map((row) => {
        const user = rsvpUserMap.get(row.userId)
        return {
          ...row,
          user: user ? formatFriendUser(user) : null,
        }
      })
      .sort((a, b) => {
        const at = new Date(a.updatedAt ?? a.createdAt).getTime()
        const bt = new Date(b.updatedAt ?? b.createdAt).getTime()
        return bt - at
      })

    const aiScan = await loadContentAiScanSummary('organization_event', buildOrganizationEventScanTargetId(org.id, event.id))

    return reply.send({ event, rsvps, aiScan })
  }),
)

app.put('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgEventParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgEventDraftUpdateBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_events')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const eventIndex = current.events.findIndex((item) => item.id === params.data.eventId)
    if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
    const previous = current.events[eventIndex]
    if (!previous) return reply.code(404).send({ error: 'event_not_found' })

    const nextFees = body.data.fees ?? previous.fees ?? []
    const hasPaidFees = nextFees.some((fee) => fee.amountCents > 0)
    const nextPaid = body.data.paid ?? hasPaidFees
    const nextStartsAt = body.data.startsAt === undefined ? previous.startsAt : body.data.startsAt ?? previous.startsAt
    const nextCurrency = (body.data.currency ?? previous.currency).toUpperCase()
    const derivedPriceFromFees = nextFees
      .map((fee) => fee.amountCents)
      .filter((amount) => Number.isFinite(amount) && amount > 0)
      .sort((a, b) => a - b)[0] ?? null
    const nowIso = new Date().toISOString()

    const normalizedGuestInput = body.data.guestSpeakers === undefined ? null : normalizeGuestSpeakerInput(body.data.guestSpeakers)
    const guestInviteBuild = normalizedGuestInput
      ? buildGuestSpeakerInvites({
          previous: previous.guestSpeakerInvites ?? [],
          selectedTags: normalizedGuestInput.guestSpeakerTags,
          nowIso,
        })
      : null

    const normalizedSponsors = body.data.sponsors ? normalizeEventSponsorTags(body.data.sponsors) : null
    const sponsorRecipientMap = normalizedSponsors?.length
      ? await resolveOrganizationAdminAndManagerIds(normalizedSponsors.map((sponsor) => sponsor.organizationId))
      : new Map<string, string[]>()
    const sponsorInviteBuild = normalizedSponsors
      ? buildSponsorInvites({
          previous: previous.sponsorInvites ?? [],
          selectedSponsors: normalizedSponsors,
          recipientMap: sponsorRecipientMap,
          nowIso,
        })
      : null

    const nextAgenda =
      body.data.agenda === undefined
        ? previous.agenda
        : body.data.agenda.map((item) => ({ title: item.title, startsAt: item.startsAt ?? null }))

    const next: OrgEventDefinition = {
      ...previous,
      title: body.data.title ?? previous.title,
      description: body.data.description === undefined ? previous.description : body.data.description ?? null,
      category: body.data.category ?? previous.category ?? 'Other',
      access: body.data.access ?? previous.access,
      eligibleRankIds: body.data.eligibleRankIds ?? previous.eligibleRankIds,
      startsAt: nextStartsAt,
      endsAt: body.data.endsAt === undefined ? previous.endsAt : body.data.endsAt ?? null,
      capacity: body.data.capacity === undefined ? previous.capacity : body.data.capacity ?? null,
      paid: nextPaid,
      priceCents: nextPaid ? (body.data.priceCents === undefined ? previous.priceCents ?? derivedPriceFromFees : body.data.priceCents ?? null) : null,
      currency: nextCurrency,
      guestSpeakers: normalizedGuestInput ? normalizedGuestInput.guestSpeakers : previous.guestSpeakers,
      guestSpeakerInvites: guestInviteBuild ? guestInviteBuild.nextInvites : previous.guestSpeakerInvites ?? [],
      sponsors: normalizedSponsors ?? previous.sponsors ?? [],
      sponsorInvites: sponsorInviteBuild ? sponsorInviteBuild.nextInvites : previous.sponsorInvites ?? [],
      fees: nextFees,
      agenda: nextAgenda,
      attachments: body.data.attachments ?? previous.attachments,
      primaryPhotoUrl: body.data.primaryPhotoUrl === undefined ? previous.primaryPhotoUrl : body.data.primaryPhotoUrl ?? null,
      galleryPhotoUrls: body.data.galleryPhotoUrls ?? previous.galleryPhotoUrls,
      status: previous.status ?? 'PUBLISHED',
      updatedAt: nowIso,
    }

    const nextEvents = [...current.events]
    nextEvents[eventIndex] = next
    const nextSystem: OrganizationSystemState = { ...current, events: nextEvents }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: (previous.status ?? 'PUBLISHED') === 'DRAFT' ? 'event.draft.updated' : 'event.updated',
      reason: null,
      previousValue: previous,
      nextValue: next,
    })

    const hostSlug = params.data.slug.trim().toLowerCase()
    if (guestInviteBuild?.newlyInvited?.length) {
      await Promise.allSettled(
        guestInviteBuild.newlyInvited.map((invite) =>
          notifyEventGuestSpeakerInvite({
            inviteeUserId: invite.userId,
            actorUserId,
            hostOrganizationId: org.id,
            hostProvinceCode: province,
            hostCommunitySlug: community.slug,
            hostOrganizationSlug: hostSlug,
            eventId: next.id,
            eventTitle: next.title,
          }),
        ),
      )
    }

    if (sponsorInviteBuild?.newlyInvited?.length) {
      const notifications: Array<Promise<void>> = []
      for (const invite of sponsorInviteBuild.newlyInvited) {
        for (const userId of invite.recipientUserIds) {
          notifications.push(
            notifyEventSponsorInvite({
              inviteeUserId: userId,
              actorUserId,
              hostOrganizationId: org.id,
              hostProvinceCode: province,
              hostCommunitySlug: community.slug,
              hostOrganizationSlug: hostSlug,
              targetOrganizationId: invite.organizationId,
              eventId: next.id,
              eventTitle: next.title,
            }),
          )
        }
      }
      if (notifications.length) {
        await Promise.allSettled(notifications)
      }
    }

    void enqueueContentAiScanForOrganizationEvent({
      orgId: org.id,
      ownerUserId: org.ownerId,
      event: next,
    }).catch((error) => {
      console.error('content_ai_scan_enqueue_event_update_failed', error)
    })

    return reply.send({ event: next })
  }),
)

app.post(
  '/communities/:province/:municipality/orgs/:slug/governance/events/:eventId/publish',
  async (req: FastifyRequest, reply: FastifyReply) =>
    withSchemaGuard(req, reply, async () => {
      const actorUserId = (await resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = CommunityOrgEventParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = CommunityOrgEventBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = readOrganizationSystemState(org.metadata)
      const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })

      const hasPaidFees = (body.data.fees ?? []).some((fee) => fee.amountCents > 0)
      const isPaidEvent = body.data.paid || hasPaidFees
      const requiredPermission: OrgPermission = isPaidEvent ? 'create_paid_events' : 'create_announcements'
      if (!canOrganizationPermission(permissions, requiredPermission) && !canOrganizationPermission(permissions, 'manage_events')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const eventIndex = current.events.findIndex((item) => item.id === params.data.eventId)
      if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
      const previous = current.events[eventIndex]
      if (!previous) return reply.code(404).send({ error: 'event_not_found' })
      if (previous.status && previous.status !== 'DRAFT') {
        return reply.code(409).send({ error: 'event_not_draft' })
      }

      const nowIso = new Date().toISOString()
      const normalizedGuestInput = normalizeGuestSpeakerInput(body.data.guestSpeakers)
      const guestInviteBuild = buildGuestSpeakerInvites({
        previous: previous.guestSpeakerInvites ?? [],
        selectedTags: normalizedGuestInput.guestSpeakerTags,
        nowIso,
      })
      const normalizedSponsors = normalizeEventSponsorTags(body.data.sponsors)
      const sponsorRecipientMap = normalizedSponsors.length
        ? await resolveOrganizationAdminAndManagerIds(normalizedSponsors.map((sponsor) => sponsor.organizationId))
        : new Map<string, string[]>()
      const sponsorInviteBuild = buildSponsorInvites({
        previous: previous.sponsorInvites ?? [],
        selectedSponsors: normalizedSponsors,
        recipientMap: sponsorRecipientMap,
        nowIso,
      })
      const publishPriceFromFees = (body.data.fees ?? [])
        .map((fee) => fee.amountCents)
        .filter((amount) => Number.isFinite(amount) && amount > 0)
        .sort((a, b) => a - b)[0] ?? null
      const next: OrgEventDefinition = {
        ...previous,
        title: body.data.title,
        description: body.data.description ?? null,
        category: body.data.category,
        access: body.data.access,
        eligibleRankIds: body.data.eligibleRankIds ?? [],
        startsAt: body.data.startsAt,
        endsAt: body.data.endsAt ?? null,
        capacity: body.data.capacity ?? null,
        paid: body.data.paid || hasPaidFees,
        priceCents: body.data.paid || hasPaidFees ? body.data.priceCents ?? publishPriceFromFees : null,
        currency: body.data.currency.toUpperCase(),
        guestSpeakers: normalizedGuestInput.guestSpeakers,
        guestSpeakerInvites: guestInviteBuild.nextInvites,
        sponsors: normalizedSponsors,
        sponsorInvites: sponsorInviteBuild.nextInvites,
        fees: body.data.fees ?? [],
        primaryPhotoUrl: body.data.primaryPhotoUrl ?? null,
        galleryPhotoUrls: body.data.galleryPhotoUrls ?? [],
        agenda: body.data.agenda?.map((item) => ({ title: item.title, startsAt: item.startsAt ?? null })) ?? [],
        attachments: body.data.attachments ?? [],
        status: 'PUBLISHED',
        updatedAt: nowIso,
      }

      const nextEvents = [...current.events]
      nextEvents[eventIndex] = next
      const nextSystem: OrganizationSystemState = { ...current, events: nextEvents }
      const hostSlug = params.data.slug.trim().toLowerCase()

      let announcementPost: { id: string; authorId: string; title: string | null; body: string; mediaUrl: string | null; images: unknown } | null = null
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.business.update({
          where: { id: org.id },
          data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
          select: { id: true },
        })

        announcementPost = await createOrganizationEventAnnouncementPost({
          client: tx,
          authorUserId: actorUserId,
          businessId: org.id,
          provinceCode: province,
          communitySlug: community.slug,
          organizationSlug: hostSlug,
          event: {
            id: next.id,
            title: next.title,
            description: next.description,
            startsAt: next.startsAt,
            primaryPhotoUrl: next.primaryPhotoUrl,
          },
        })
      })
      await appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'event.published',
        reason: null,
        previousValue: previous,
        nextValue: next,
      })

      if (guestInviteBuild.newlyInvited.length) {
        await Promise.allSettled(
          guestInviteBuild.newlyInvited.map((invite) =>
            notifyEventGuestSpeakerInvite({
              inviteeUserId: invite.userId,
              actorUserId,
              hostOrganizationId: org.id,
              hostProvinceCode: province,
              hostCommunitySlug: community.slug,
              hostOrganizationSlug: hostSlug,
              eventId: next.id,
              eventTitle: next.title,
            }),
          ),
        )
      }

      if (sponsorInviteBuild.newlyInvited.length) {
        const notifications: Promise<void>[] = []
        for (const invite of sponsorInviteBuild.newlyInvited) {
          for (const userId of invite.recipientUserIds) {
            notifications.push(
              notifyEventSponsorInvite({
                inviteeUserId: userId,
                actorUserId,
                hostOrganizationId: org.id,
                hostProvinceCode: province,
                hostCommunitySlug: community.slug,
                hostOrganizationSlug: hostSlug,
                targetOrganizationId: invite.organizationId,
                eventId: next.id,
                eventTitle: next.title,
              }),
            )
          }
        }
        if (notifications.length) {
          await Promise.allSettled(notifications)
        }
      }

      void enqueueContentAiScanForOrganizationEvent({
        orgId: org.id,
        ownerUserId: org.ownerId,
        event: next,
      }).catch((error) => {
        console.error('content_ai_scan_enqueue_event_publish_failed', error)
      })
      if (announcementPost) {
        void enqueueContentAiScanForPost(announcementPost).catch((error) => {
          console.error('content_ai_scan_enqueue_event_announcement_post_publish_failed', error)
        })
      }

      return reply.send({ event: next })
    }),
)

app.post(
  '/communities/:province/:municipality/orgs/:slug/governance/events/:eventId/unpublish',
  async (req: FastifyRequest, reply: FastifyReply) =>
    withSchemaGuard(req, reply, async () => {
      const actorUserId = (await resolveUserId(req)) ?? null
      if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

      const params = CommunityOrgEventParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        select: { role: true },
      })
      const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

      const current = readOrganizationSystemState(org.metadata)
      const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
      if (!canOrganizationPermission(permissions, 'manage_events')) {
        return reply.code(403).send({ error: 'forbidden' })
      }

      const eventIndex = current.events.findIndex((item) => item.id === params.data.eventId)
      if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
      const previous = current.events[eventIndex]
      if (!previous) return reply.code(404).send({ error: 'event_not_found' })

      const nowIso = new Date().toISOString()
      const next: OrgEventDefinition = {
        ...previous,
        status: 'DRAFT',
        updatedAt: nowIso,
      }

      const nextEvents = [...current.events]
      nextEvents[eventIndex] = next
      const nextSystem: OrganizationSystemState = { ...current, events: nextEvents }

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await appendOrganizationAuditLogEntry(prisma, org.id, {
        actorUserId,
        action: 'event.unpublished',
        reason: null,
        previousValue: previous,
        nextValue: next,
      })

      return reply.send({ event: next })
    }),
)

app.delete('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgEventParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_events')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const eventIndex = current.events.findIndex((item) => item.id === params.data.eventId)
    if (eventIndex < 0) return reply.code(404).send({ error: 'event_not_found' })
    const removed = current.events[eventIndex]
    if (!removed) return reply.code(404).send({ error: 'event_not_found' })

    const nextEvents = current.events.filter((item) => item.id !== params.data.eventId)
    const nextRsvps = current.eventRsvps.filter((row) => row.eventId !== params.data.eventId)
    const nextSystem: OrganizationSystemState = {
      ...current,
      events: nextEvents,
      eventRsvps: nextRsvps,
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'event.deleted',
      reason: null,
      previousValue: removed,
      nextValue: null,
    })

    return reply.send({ ok: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/join-mode', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgJoinModeBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_membership_plans')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const nextSystem: OrganizationSystemState = { ...current, joinMode: body.data.joinMode }
    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'governance.join_mode.updated',
      reason: body.data.reason ?? null,
      previousValue: { joinMode: current.joinMode },
      nextValue: { joinMode: body.data.joinMode },
    })

    return reply.send({ ok: true, joinMode: body.data.joinMode })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/ranks', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgGovernanceRankBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'create_ranks')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const rankId = `rank_${randomUUID().replace(/-/g, '').slice(0, 14)}`
    const nextRank: OrgRankDefinition = {
      id: rankId,
      name: body.data.name,
      description: body.data.description?.trim() || null,
      permissions: Array.from(new Set(body.data.permissions)),
      promotionAuthority: body.data.promotionAuthority ?? [],
      visibility: body.data.visibility,
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      ranks: [...current.ranks, nextRank],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'rank.created',
      reason: null,
      previousValue: null,
      nextValue: nextRank,
    })

    return reply.code(201).send({ rank: nextRank })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/plans', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMembershipPlanBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_membership_plans')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const plan: OrgPlanDefinition = {
      id: `plan_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      name: body.data.name,
      description: body.data.description?.trim() || null,
      type: body.data.type,
      amountCents: body.data.amountCents ?? 0,
      currency: body.data.currency.toUpperCase(),
      interval: body.data.interval ?? null,
      rankId: body.data.rankId ?? null,
      governanceRights: body.data.governanceRights,
      createdAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = { ...current, plans: [...current.plans, plan] }
    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'plan.created',
      reason: null,
      previousValue: null,
      nextValue: plan,
    })

    return reply.code(201).send({ plan })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/sponsors', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgSponsorBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'create_announcements')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const sponsor: OrgSponsorDefinition = {
      id: `sponsor_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      name: body.data.name,
      logoUrl: body.data.logoUrl ?? null,
      relationshipDescription: body.data.relationshipDescription ?? null,
      tier: body.data.tier,
      internalUserId: body.data.internalUserId ?? null,
      externalReference: body.data.externalReference ?? null,
      linkUrl: body.data.linkUrl ?? null,
      linkLabel: body.data.linkLabel ?? null,
      createdAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = { ...current, sponsors: [...current.sponsors, sponsor] }
    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'sponsor.created',
      reason: null,
      previousValue: null,
      nextValue: sponsor,
    })

    return reply.code(201).send({ sponsor })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/events', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgEventBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    const hasPaidFees = (body.data.fees ?? []).some((fee) => fee.amountCents > 0)
    const isPaidEvent = body.data.paid || hasPaidFees
    const requiredPermission: OrgPermission = isPaidEvent ? 'create_paid_events' : 'create_announcements'
    if (!canOrganizationPermission(permissions, requiredPermission) && !canOrganizationPermission(permissions, 'manage_events')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const nowIso = new Date().toISOString()
    const normalizedGuestInput = normalizeGuestSpeakerInput(body.data.guestSpeakers)
    const guestInviteBuild = buildGuestSpeakerInvites({
      previous: [],
      selectedTags: normalizedGuestInput.guestSpeakerTags,
      nowIso,
    })
    const normalizedSponsors = normalizeEventSponsorTags(body.data.sponsors)
    const sponsorRecipientMap = normalizedSponsors.length
      ? await resolveOrganizationAdminAndManagerIds(normalizedSponsors.map((sponsor) => sponsor.organizationId))
      : new Map<string, string[]>()
    const sponsorInviteBuild = buildSponsorInvites({
      previous: [],
      selectedSponsors: normalizedSponsors,
      recipientMap: sponsorRecipientMap,
      nowIso,
    })
    const createPriceFromFees = (body.data.fees ?? [])
      .map((fee) => fee.amountCents)
      .filter((amount) => Number.isFinite(amount) && amount > 0)
      .sort((a, b) => a - b)[0] ?? null
    const event: OrgEventDefinition = {
      id: `event_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      title: body.data.title,
      description: body.data.description ?? null,
      category: body.data.category,
      access: body.data.access,
      eligibleRankIds: body.data.eligibleRankIds ?? [],
      startsAt: body.data.startsAt,
      endsAt: body.data.endsAt ?? null,
      capacity: body.data.capacity ?? null,
      paid: body.data.paid || hasPaidFees,
      priceCents: body.data.paid || hasPaidFees ? body.data.priceCents ?? createPriceFromFees : null,
      currency: body.data.currency.toUpperCase(),
      guestSpeakers: normalizedGuestInput.guestSpeakers,
      guestSpeakerInvites: guestInviteBuild.nextInvites,
      sponsors: normalizedSponsors,
      sponsorInvites: sponsorInviteBuild.nextInvites,
      fees: body.data.fees ?? [],
      primaryPhotoUrl: body.data.primaryPhotoUrl ?? null,
      galleryPhotoUrls: body.data.galleryPhotoUrls ?? [],
      agenda: body.data.agenda?.map((item) => ({ title: item.title, startsAt: item.startsAt ?? null })) ?? [],
      attachments: body.data.attachments ?? [],
      status: 'PUBLISHED',
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    const nextSystem: OrganizationSystemState = { ...current, events: [...current.events, event] }
    const hostSlug = params.data.slug.trim().toLowerCase()
    let announcementPost: { id: string; authorId: string; title: string | null; body: string; mediaUrl: string | null; images: unknown } | null = null
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.business.update({
        where: { id: org.id },
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })

      announcementPost = await createOrganizationEventAnnouncementPost({
        client: tx,
        authorUserId: actorUserId,
        businessId: org.id,
        provinceCode: province,
        communitySlug: community.slug,
        organizationSlug: hostSlug,
        event: {
          id: event.id,
          title: event.title,
          description: event.description,
          startsAt: event.startsAt,
          primaryPhotoUrl: event.primaryPhotoUrl,
        },
      })
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'event.created',
      reason: null,
      previousValue: null,
      nextValue: event,
    })

    if (guestInviteBuild.newlyInvited.length) {
      await Promise.allSettled(
        guestInviteBuild.newlyInvited.map((invite) =>
          notifyEventGuestSpeakerInvite({
            inviteeUserId: invite.userId,
            actorUserId,
            hostOrganizationId: org.id,
            hostProvinceCode: province,
            hostCommunitySlug: community.slug,
            hostOrganizationSlug: hostSlug,
            eventId: event.id,
            eventTitle: event.title,
          }),
        ),
      )
    }

    if (sponsorInviteBuild.newlyInvited.length) {
      const notifications: Promise<void>[] = []
      for (const invite of sponsorInviteBuild.newlyInvited) {
        for (const userId of invite.recipientUserIds) {
          notifications.push(
            notifyEventSponsorInvite({
              inviteeUserId: userId,
              actorUserId,
              hostOrganizationId: org.id,
              hostProvinceCode: province,
              hostCommunitySlug: community.slug,
              hostOrganizationSlug: hostSlug,
              targetOrganizationId: invite.organizationId,
              eventId: event.id,
              eventTitle: event.title,
            }),
          )
        }
      }
      if (notifications.length) {
        await Promise.allSettled(notifications)
      }
    }

    void enqueueContentAiScanForOrganizationEvent({
      orgId: org.id,
      ownerUserId: org.ownerId,
      event,
    }).catch((error) => {
      console.error('content_ai_scan_enqueue_event_create_failed', error)
    })
    if (announcementPost) {
      void enqueueContentAiScanForPost(announcementPost).catch((error) => {
        console.error('content_ai_scan_enqueue_event_announcement_post_create_failed', error)
      })
    }

    return reply.code(201).send({ event })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/join', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgJoinBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true, status: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })
    if (org.status !== 'ACTIVE') return reply.code(404).send({ error: 'organization_not_found' })

    const current = readOrganizationSystemState(org.metadata)
    if (current.joinMode === 'INVITE_ONLY') {
      if (!body.data.referredByUserId) {
        return reply.code(403).send({ error: 'invite_required' })
      }

      const inviterId = body.data.referredByUserId
      if (inviterId === actorUserId) return reply.code(400).send({ error: 'invalid_referrer' })

      const inviterMember = current.members[inviterId] ?? null
      const inviterIsOwner = inviterId === org.ownerId
      if (inviterMember?.status === 'BANNED') {
        return reply.code(403).send({ error: 'invalid_inviter' })
      }

      const inviterEligibleStatus: OrgMembershipStatus[] = ['ACTIVE', 'GRACE']
      const inviterIsEligibleBySystem = inviterMember?.status ? inviterEligibleStatus.includes(inviterMember.status) : false
      const inviterFollows = await prisma.businessFollow.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: inviterId } },
        select: { userId: true },
      })
      const inviterAdminMembership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: org.id, userId: inviterId } },
        select: { role: true },
      })

      const inviterEligible = inviterIsOwner || inviterIsEligibleBySystem || Boolean(inviterFollows) || Boolean(inviterAdminMembership)

      if (!inviterEligible) {
        return reply.code(403).send({ error: 'invalid_inviter' })
      }
    }
    if (body.data.planId && !current.plans.some((plan) => plan.id === body.data.planId)) {
      return reply.code(400).send({ error: 'plan_not_found' })
    }
    if (body.data.referredByUserId && body.data.referredByUserId === actorUserId) {
      return reply.code(400).send({ error: 'invalid_referrer' })
    }

    const existing = current.members[actorUserId] ?? null
    if (existing?.status === 'BANNED') {
      return reply.code(403).send({ error: 'membership_banned' })
    }

    const status: OrgMembershipStatus = current.joinMode === 'APPLICATION_REQUIRED' ? 'PENDING' : 'ACTIVE'
    const nextMemberState: OrgMemberState = {
      rankId: existing?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: body.data.planId ?? existing?.planId ?? null,
      status,
      referredByUserId: body.data.referredByUserId ?? existing?.referredByUserId ?? null,
      reputation: existing?.reputation ?? 0,
      updatedAt: new Date().toISOString(),
    }

    const shouldAppendReferral = Boolean(body.data.referredByUserId && body.data.referredByUserId !== actorUserId)
    const nextReferrals = shouldAppendReferral
      ? current.referrals.some((item) => item.referrerUserId === body.data.referredByUserId && item.referredUserId === actorUserId)
        ? current.referrals
        : [
            ...current.referrals,
            {
              id: `ref_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
              referrerUserId: body.data.referredByUserId as string,
              referredUserId: actorUserId,
              planId: body.data.planId ?? null,
              createdAt: new Date().toISOString(),
            } satisfies OrgReferralRecord,
          ]
      : current.referrals

    const nextSystem: OrganizationSystemState = {
      ...current,
      referrals: nextReferrals,
      members: {
        ...current.members,
        [actorUserId]: nextMemberState,
      },
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.businessFollow.upsert({
        where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
        create: { businessId: org.id, userId: actorUserId },
        update: {},
      })
      await tx.business.update({
        where: { id: org.id },
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await appendOrganizationAuditLogEntry(tx, org.id, {
        actorUserId,
        action: status === 'ACTIVE' ? 'member.joined' : 'member.join_requested',
        reason: body.data.note ?? null,
        previousValue: existing,
        nextValue: nextMemberState,
      })
    })

    return reply.send({ ok: true, member: nextMemberState })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/achievements', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgAchievementBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'award_achievements')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const achievement: OrgAchievementDefinition = {
      id: `ach_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      title: body.data.title,
      description: body.data.description?.trim() || null,
      reputationPoints: body.data.reputationPoints,
      visibility: body.data.visibility,
      createdAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      achievements: [...current.achievements, achievement],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'achievement.created',
      reason: null,
      previousValue: null,
      nextValue: achievement,
    })

    return reply.code(201).send({ achievement })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/achievements/:achievementId/award', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgAchievementParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgAchievementAwardBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'award_achievements')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const achievement = current.achievements.find((item) => item.id === params.data.achievementId)
    if (!achievement) return reply.code(404).send({ error: 'achievement_not_found' })

    if (current.achievementAwards.some((item) => item.achievementId === params.data.achievementId && item.userId === body.data.userId)) {
      return reply.code(409).send({ error: 'achievement_already_awarded' })
    }

    const previousMember = current.members[body.data.userId] ?? null
    const award: OrgAchievementAward = {
      id: `award_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      achievementId: achievement.id,
      userId: body.data.userId,
      awardedByUserId: actorUserId,
      note: body.data.note ?? null,
      createdAt: new Date().toISOString(),
    }
    const reputationDelta = achievement.reputationPoints
    const ledgerEntry: OrgReputationEntry | null = reputationDelta
      ? {
          id: `rep_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
          userId: body.data.userId,
          delta: reputationDelta,
          source: 'achievement_award',
          sourceRefId: award.id,
          note: achievement.title,
          createdAt: new Date().toISOString(),
        }
      : null

    const nextMemberState: OrgMemberState = {
      rankId: previousMember?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: previousMember?.planId ?? null,
      status: previousMember?.status ?? 'ACTIVE',
      referredByUserId: previousMember?.referredByUserId ?? null,
      reputation: (previousMember?.reputation ?? 0) + reputationDelta,
      updatedAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      achievementAwards: [...current.achievementAwards, award],
      reputationLedger: ledgerEntry ? [...current.reputationLedger, ledgerEntry] : current.reputationLedger,
      members: {
        ...current.members,
        [body.data.userId]: nextMemberState,
      },
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'achievement.awarded',
      reason: body.data.note ?? null,
      previousValue: { userId: body.data.userId, member: previousMember },
      nextValue: { award, member: nextMemberState },
    })

    return reply.code(201).send({ award, member: nextMemberState })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/invite-links', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgInviteLinkBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_referrals')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    if (body.data.planId && !current.plans.some((plan) => plan.id === body.data.planId)) {
      return reply.code(400).send({ error: 'plan_not_found' })
    }

    const nowIso = new Date().toISOString()
    const token = randomUUID().replace(/-/g, '')
    const invite: OrgInviteLinkRecord = {
      id: `inv_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      token,
      createdByUserId: actorUserId,
      message: body.data.message?.trim() || null,
      planId: body.data.planId ?? null,
      createdAt: nowIso,
      viewCount: 0,
      registrationCount: 0,
      joinCount: 0,
      lastViewedAt: null,
      lastRegisteredAt: null,
      lastJoinedAt: null,
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      inviteLinks: [...current.inviteLinks, invite],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })

    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'invite_link.created',
      reason: body.data.message?.trim() || null,
      previousValue: null,
      nextValue: invite,
    })

    const landingUrl = `/com/${encodeURIComponent(province)}/${encodeURIComponent(community.slug)}/orgs/${encodeURIComponent(params.data.slug.trim().toLowerCase())}/invite/${encodeURIComponent(token)}`
    return reply.code(201).send({ invite, landingUrl })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/governance/invite-links', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const orgSlug = params.data.slug.trim().toLowerCase()
    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: orgSlug },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_referrals')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const inviteLinks = current.inviteLinks
      .filter((entry) => entry.createdByUserId === actorUserId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((entry) => ({
        ...entry,
        landingUrl: `/com/${encodeURIComponent(province)}/${encodeURIComponent(community.slug)}/orgs/${encodeURIComponent(orgSlug)}/invite/${encodeURIComponent(entry.token)}`,
      }))

    return reply.send({ inviteLinks })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/invite-users', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgInviteUserBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const orgSlug = params.data.slug.trim().toLowerCase()
    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: orgSlug },
      select: { id: true, ownerId: true, name: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })
    if (body.data.targetUserId === actorUserId) return reply.code(400).send({ error: 'invalid_invitee' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_referrals')) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    if (body.data.planId && !current.plans.some((plan) => plan.id === body.data.planId)) {
      return reply.code(400).send({ error: 'plan_not_found' })
    }

    const targetUser = await prisma.user.findUnique({ where: { id: body.data.targetUserId }, select: { id: true } })
    if (!targetUser) return reply.code(404).send({ error: 'user_not_found' })

    const nowIso = new Date().toISOString()
    const token = randomUUID().replace(/-/g, '')
    const invite: OrgInviteLinkRecord = {
      id: `inv_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      token,
      createdByUserId: actorUserId,
      message: body.data.message?.trim() || null,
      planId: body.data.planId ?? null,
      createdAt: nowIso,
      viewCount: 0,
      registrationCount: 0,
      joinCount: 0,
      lastViewedAt: null,
      lastRegisteredAt: null,
      lastJoinedAt: null,
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      inviteLinks: [...current.inviteLinks, invite],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })

    const landingUrl = `/com/${encodeURIComponent(province)}/${encodeURIComponent(community.slug)}/orgs/${encodeURIComponent(orgSlug)}/invite/${encodeURIComponent(token)}`

    await createNotificationRecord({
      userId: targetUser.id,
      actorId: actorUserId,
      type: ORG_NOTIFICATION_TYPES.USER_INVITE,
      payload: {
        status: 'pending',
        organizationId: org.id,
        organizationName: org.name,
        inviteToken: token,
        message: body.data.message?.trim() || null,
        url: landingUrl,
      },
    })

    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'invite_user.sent',
      reason: body.data.message?.trim() || null,
      previousValue: null,
      nextValue: { inviteId: invite.id, targetUserId: targetUser.id },
    })

    return reply.code(201).send({ invite, landingUrl })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/invite/:token/resolve', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const viewerUserId = (await resolveUserId(req)) ?? null
    const params = CommunityOrgSlugParams.extend({ token: z.string().trim().min(12).max(160) }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgInviteResolveBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })
    const orgSlug = params.data.slug.trim().toLowerCase()

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: orgSlug, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        coverUrl: true,
        logoUrl: true,
        ownerId: true,
        metadata: true,
        provinceCode: true,
        communitySlug: true,
      },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const current = readOrganizationSystemState(org.metadata)
    const inviteIndex = current.inviteLinks.findIndex((entry) => entry.token === params.data.token)
    if (inviteIndex < 0) return reply.code(404).send({ error: 'invite_not_found' })
    const invite = current.inviteLinks[inviteIndex]
    if (!invite) return reply.code(404).send({ error: 'invite_not_found' })

    const inviter = await prisma.user.findUnique({
      where: { id: invite.createdByUserId },
      select: {
        id: true,
        handle: true,
        name: true,
        avatarUrl: true,
        coverUrl: true,
      },
    })

    const isInviteOwner = Boolean(viewerUserId && (viewerUserId === invite.createdByUserId || viewerUserId === org.ownerId))
    const shouldIncrementView = !isInviteOwner

    const nextInviteLinks = [...current.inviteLinks]
    if (shouldIncrementView) {
      const nowIso = new Date().toISOString()
      nextInviteLinks[inviteIndex] = {
        ...invite,
        viewCount: invite.viewCount + 1,
        lastViewedAt: nowIso,
      }

      await prisma.business.update({
        where: { id: org.id },
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, { ...current, inviteLinks: nextInviteLinks }) },
        select: { id: true },
      })
    }

    return reply.send({
      invite: nextInviteLinks[inviteIndex],
      viewer: {
        id: viewerUserId,
        isInviteOwner,
      },
      inviter: inviter
        ? {
            id: inviter.id,
            handle: inviter.handle,
            name: inviter.name,
            avatarUrl: normalizeMediaUrl(inviter.avatarUrl ?? null),
            coverUrl: normalizeMediaUrl(inviter.coverUrl ?? null),
          }
        : null,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.description ?? null,
        coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
        logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
      },
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/referrals', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgReferralBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_referrals')) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    if (body.data.referrerUserId === body.data.referredUserId) {
      return reply.code(400).send({ error: 'invalid_referral' })
    }
    if (body.data.planId && !current.plans.some((plan) => plan.id === body.data.planId)) {
      return reply.code(400).send({ error: 'plan_not_found' })
    }
    if (current.referrals.some((item) => item.referrerUserId === body.data.referrerUserId && item.referredUserId === body.data.referredUserId)) {
      return reply.code(409).send({ error: 'referral_exists' })
    }

    const referral: OrgReferralRecord = {
      id: `ref_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      referrerUserId: body.data.referrerUserId,
      referredUserId: body.data.referredUserId,
      planId: body.data.planId ?? null,
      createdAt: new Date().toISOString(),
    }

    const existingMember = current.members[body.data.referredUserId] ?? null
    const nextMemberState: OrgMemberState = {
      rankId: existingMember?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: body.data.planId ?? existingMember?.planId ?? null,
      status: existingMember?.status ?? 'PENDING',
      referredByUserId: body.data.referrerUserId,
      reputation: existingMember?.reputation ?? 0,
      updatedAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      referrals: [...current.referrals, referral],
      members: {
        ...current.members,
        [body.data.referredUserId]: nextMemberState,
      },
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'referral.recorded',
      reason: null,
      previousValue: null,
      nextValue: referral,
    })

    return reply.code(201).send({ referral })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/reputation', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgReputationAdjustBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'award_achievements')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const existingMember = current.members[body.data.userId] ?? null
    const nextMemberState: OrgMemberState = {
      rankId: existingMember?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: existingMember?.planId ?? null,
      status: existingMember?.status ?? 'ACTIVE',
      referredByUserId: existingMember?.referredByUserId ?? null,
      reputation: Math.max(0, (existingMember?.reputation ?? 0) + body.data.delta),
      updatedAt: new Date().toISOString(),
    }

    const ledgerEntry: OrgReputationEntry = {
      id: `rep_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      userId: body.data.userId,
      delta: body.data.delta,
      source: body.data.source,
      sourceRefId: null,
      note: body.data.note ?? null,
      createdAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      reputationLedger: [...current.reputationLedger, ledgerEntry],
      members: {
        ...current.members,
        [body.data.userId]: nextMemberState,
      },
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'reputation.adjusted',
      reason: body.data.note ?? null,
      previousValue: { userId: body.data.userId, member: existingMember },
      nextValue: { userId: body.data.userId, member: nextMemberState, ledgerEntry },
    })

    return reply.send({ ok: true, entry: ledgerEntry, member: nextMemberState })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/events/:eventId/rsvp', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgEventParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgEventRsvpBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true, status: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })
    if (org.status !== 'ACTIVE') return reply.code(404).send({ error: 'organization_not_found' })

    const current = readOrganizationSystemState(org.metadata)
    const event = current.events.find((item) => item.id === params.data.eventId)
    if (!event) return reply.code(404).send({ error: 'event_not_found' })
    if ((event.status ?? 'PUBLISHED') !== 'PUBLISHED') return reply.code(404).send({ error: 'event_not_found' })

    const actorMember = current.members[actorUserId] ?? null
    if (event.access === 'RESTRICTED') {
      if (!actorMember || actorMember.status !== 'ACTIVE') {
        return reply.code(403).send({ error: 'restricted_event' })
      }
      if (event.eligibleRankIds.length > 0 && !event.eligibleRankIds.includes(actorMember.rankId)) {
        return reply.code(403).send({ error: 'rank_not_eligible' })
      }
    }

    const eventFees = event.fees ?? []
    const selectedTicket = body.data.ticketId
      ? eventFees.find((fee) => fee.id === body.data.ticketId) ?? null
      : null

    if (body.data.ticketId && !selectedTicket) {
      return reply.code(400).send({ error: 'invalid_ticket_type' })
    }

    if (body.data.status === 'GOING' && eventFees.length > 0 && !selectedTicket) {
      return reply.code(400).send({ error: 'ticket_type_required' })
    }

    const resolvedTicketType: 'FREE' | 'PAID' = selectedTicket
      ? selectedTicket.amountCents > 0
        ? 'PAID'
        : 'FREE'
      : body.data.ticketType ?? (event.paid ? 'PAID' : 'FREE')

    if (event.paid && eventFees.length === 0 && resolvedTicketType !== 'PAID') {
      return reply.code(400).send({ error: 'paid_ticket_required' })
    }
    if (!event.paid && eventFees.length === 0 && resolvedTicketType === 'PAID') {
      return reply.code(400).send({ error: 'paid_ticket_not_allowed' })
    }

    const message = body.data.message?.trim() ? body.data.message.trim() : null

    const previous = current.eventRsvps.find((item) => item.eventId === event.id && item.userId === actorUserId) ?? null
    const existingGoingCount = current.eventRsvps.filter((item) => item.eventId === event.id && item.status === 'GOING' && item.userId !== actorUserId).length
    if (body.data.status === 'GOING' && typeof event.capacity === 'number' && event.capacity > 0 && existingGoingCount >= event.capacity) {
      return reply.code(409).send({ error: 'event_capacity_reached' })
    }

    if (body.data.status === 'GOING' && selectedTicket && typeof selectedTicket.capacity === 'number' && selectedTicket.capacity > 0) {
      const existingTicketGoingCount = current.eventRsvps.filter(
        (item) => item.eventId === event.id && item.status === 'GOING' && item.ticketId === selectedTicket.id && item.userId !== actorUserId,
      ).length
      if (existingTicketGoingCount >= selectedTicket.capacity) {
        return reply.code(409).send({ error: 'ticket_capacity_reached' })
      }
    }

    const nowIso = new Date().toISOString()

    const rsvp: OrgEventRsvp = {
      id: previous?.id ?? `rsvp_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      eventId: event.id,
      userId: actorUserId,
      status: body.data.status,
      ticketType: resolvedTicketType,
      ticketId: body.data.status === 'GOING' ? selectedTicket?.id ?? null : null,
      ticketLabel: body.data.status === 'GOING' ? selectedTicket?.label ?? null : null,
      amountCents: body.data.status === 'GOING' && selectedTicket ? selectedTicket.amountCents : null,
      message: body.data.status === 'GOING' ? message : null,
      createdAt: previous?.createdAt ?? nowIso,
      updatedAt: nowIso,
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      eventRsvps: [...current.eventRsvps.filter((item) => !(item.eventId === event.id && item.userId === actorUserId)), rsvp],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'event.rsvp.updated',
      reason: null,
      previousValue: previous,
      nextValue: rsvp,
    })

    return reply.send({ ok: true, rsvp })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/events/:eventId', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const viewerId = (await resolveUserId(req)) ?? null

    const params = CommunityOrgEventParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase(), status: BusinessStatus.ACTIVE },
      select: { id: true, ownerId: true, metadata: true, name: true, slug: true, provinceCode: true, communitySlug: true, logoUrl: true, coverUrl: true, isVerified: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const system = readOrganizationSystemState(org.metadata)
    const event = system.events.find((item) => item.id === params.data.eventId)
    if (!event) return reply.code(404).send({ error: 'event_not_found' })

    const isDraft = (event.status ?? 'PUBLISHED') === 'DRAFT'
    const viewerGuestInvite = viewerId ? (event.guestSpeakerInvites ?? []).find((invite) => invite.userId === viewerId) ?? null : null
    const viewerSponsorInvite = viewerId
      ? (event.sponsorInvites ?? []).find(
          (invite) => Array.isArray(invite.recipientUserIds) && invite.recipientUserIds.includes(viewerId),
        ) ?? null
      : null
    const isDraftGuestInvitee = Boolean(
      viewerGuestInvite && (viewerGuestInvite.status === 'PENDING' || viewerGuestInvite.status === 'ACCEPTED'),
    )
    const isDraftSponsorInvitee = Boolean(
      viewerSponsorInvite && (viewerSponsorInvite.status === 'PENDING' || viewerSponsorInvite.status === 'ACCEPTED'),
    )
    const hasExistingRsvp = Boolean(viewerId && system.eventRsvps.some((row) => row.eventId === event.id && row.userId === viewerId))
    const canViewDraft = Boolean(viewerId && (org.ownerId === viewerId || isDraftGuestInvitee || isDraftSponsorInvitee || hasExistingRsvp))

    if (isDraft && !canViewDraft) {
      return reply.code(404).send({ error: 'event_not_found' })
    }

    if (event.access === 'RESTRICTED' && !isDraft) {
      const viewerMember = viewerId ? system.members[viewerId] ?? null : null
      if (!viewerId || !viewerMember || viewerMember.status !== 'ACTIVE') {
        return reply.code(403).send({ error: 'restricted_event' })
      }
      if (event.eligibleRankIds.length > 0 && !event.eligibleRankIds.includes(viewerMember.rankId)) {
        return reply.code(403).send({ error: 'rank_not_eligible' })
      }
    }

    const eventRsvps = system.eventRsvps.filter((row) => row.eventId === event.id)
    const feeGoingCounts = new Map<string, number>()
    for (const row of eventRsvps) {
      if (row.status !== 'GOING') continue
      const ticketId = row.ticketId ?? null
      if (!ticketId) continue
      feeGoingCounts.set(ticketId, (feeGoingCounts.get(ticketId) ?? 0) + 1)
    }
    const viewerRsvp = viewerId ? eventRsvps.find((row) => row.userId === viewerId) ?? null : null
    const goingCount = eventRsvps.filter((row) => row.status === 'GOING').length
    const interestedCount = eventRsvps.filter((row) => row.status === 'INTERESTED').length

    let viewerInvitation:
      | {
          kind: 'guest_speaker' | 'sponsor'
          status: 'PENDING' | 'ACCEPTED' | 'DECLINED'
          notificationId: string | null
          inviter: ReturnType<typeof formatFriendUser> | null
        }
      | null = null

    if (viewerId && (viewerGuestInvite || viewerSponsorInvite)) {
      const invitationKind = viewerGuestInvite ? 'guest_speaker' : 'sponsor'
      const invitationStatus = (viewerGuestInvite?.status ?? viewerSponsorInvite?.status ?? 'PENDING') as 'PENDING' | 'ACCEPTED' | 'DECLINED'

      const notification = await prisma.notification.findFirst({
        where: {
          userId: viewerId,
          type:
            invitationKind === 'guest_speaker'
              ? EVENT_NOTIFICATION_TYPES.GUEST_SPEAKER_INVITE
              : EVENT_NOTIFICATION_TYPES.SPONSOR_INVITE,
          payload: {
            path: ['eventId'],
            equals: event.id,
          },
        },
        orderBy: { createdAt: 'desc' },
        select: NOTIFICATION_SELECT,
      })

      const inviter = notification?.actorId
        ? await prisma.user.findUnique({ where: { id: notification.actorId }, select: FRIEND_USER_SELECT })
        : null

      viewerInvitation = {
        kind: invitationKind,
        status: invitationStatus,
        notificationId: invitationStatus === 'PENDING' ? notification?.id ?? null : null,
        inviter: inviter ? formatFriendUser(inviter) : null,
      }
    }

    return reply.send({
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        category: event.category ?? 'Other',
        access: event.access,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        capacity: event.capacity,
        paid: event.paid,
        priceCents: event.priceCents,
        currency: event.currency,
        guestSpeakers: event.guestSpeakers,
        guestSpeakerInvites: (event.guestSpeakerInvites ?? []).map((invite) => ({
          userId: invite.userId,
          name: invite.name,
          handle: invite.handle,
          avatarUrl: normalizeMediaUrl(invite.avatarUrl ?? null),
          coverUrl: normalizeMediaUrl(invite.coverUrl ?? null),
          status: invite.status,
        })),
        sponsors: event.sponsors ?? [],
        sponsorInvites: (event.sponsorInvites ?? []).map((invite) => ({
          organizationId: invite.organizationId,
          name: invite.name,
          slug: invite.slug,
          provinceCode: invite.provinceCode,
          communitySlug: invite.communitySlug,
          logoUrl: normalizeMediaUrl(invite.logoUrl ?? null),
          coverUrl: normalizeMediaUrl(invite.coverUrl ?? null),
          status: invite.status,
        })),
        fees: (event.fees ?? []).map((fee) => {
          const goingCountForFee = feeGoingCounts.get(fee.id) ?? 0
          const remainingCount = typeof fee.capacity === 'number' && fee.capacity > 0 ? Math.max(0, fee.capacity - goingCountForFee) : null
          return {
            id: fee.id,
            label: fee.label,
            amountCents: fee.amountCents,
            capacity: fee.capacity ?? null,
            cashOnly: fee.cashOnly !== false,
            goingCount: goingCountForFee,
            remainingCount,
          }
        }),
        primaryPhotoUrl: event.primaryPhotoUrl,
        galleryPhotoUrls: event.galleryPhotoUrls,
        status: event.status ?? 'PUBLISHED',
        createdAt: event.createdAt,
        updatedAt: event.updatedAt ?? event.createdAt,
      },
      viewerRsvp: viewerRsvp
        ? {
            id: viewerRsvp.id,
            status: viewerRsvp.status,
            ticketId: viewerRsvp.ticketId ?? null,
            ticketLabel: viewerRsvp.ticketLabel ?? null,
            amountCents: typeof viewerRsvp.amountCents === 'number' ? viewerRsvp.amountCents : null,
            message: viewerRsvp.message ?? null,
            createdAt: viewerRsvp.createdAt,
            updatedAt: viewerRsvp.updatedAt ?? viewerRsvp.createdAt,
          }
        : null,
      rsvpSummary: {
        goingCount,
        interestedCount,
      },
      viewerInvitation,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
        logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
        coverUrl: normalizeMediaUrl(org.coverUrl ?? null),
        isVerified: org.isVerified,
      },
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/economics', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgEconomicsRecordBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'manage_membership_plans')) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    if (body.data.kind === 'event') {
      if (!body.data.eventId) return reply.code(400).send({ error: 'event_id_required' })
      if (!current.events.some((item) => item.id === body.data.eventId)) {
        return reply.code(404).send({ error: 'event_not_found' })
      }
    }

    const record: OrgEconomicRecord = {
      id: `eco_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      kind: body.data.kind,
      amountCents: body.data.amountCents,
      currency: body.data.currency.toUpperCase(),
      memberUserId: body.data.memberUserId ?? null,
      eventId: body.data.eventId ?? null,
      note: body.data.note ?? null,
      createdAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      economics: [...current.economics, record],
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'economics.recorded',
      reason: body.data.note ?? null,
      previousValue: null,
      nextValue: record,
    })

    return reply.code(201).send({ record })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/governance/analytics', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const system = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'view_audit_logs')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const activeMembers = Object.values(system.members).filter((member) => member.status === 'ACTIVE').length
    const pendingMembers = Object.values(system.members).filter((member) => member.status === 'PENDING').length
    const totalRevenueCents = system.economics.reduce((sum, item) => sum + item.amountCents, 0)
    const paidEvents = system.events.filter((event) => event.paid).length
    const totalRsvps = system.eventRsvps.length
    const goingRsvps = system.eventRsvps.filter((item) => item.status === 'GOING').length
    const topReputation = Object.entries(system.members)
      .map(([userId, member]) => ({ userId, reputation: member.reputation }))
      .sort((a, b) => b.reputation - a.reputation)
      .slice(0, 10)

    return reply.send({
      summary: {
        activeMembers,
        pendingMembers,
        totalMembersTracked: Object.keys(system.members).length,
        plans: system.plans.length,
        referrals: system.referrals.length,
        achievements: system.achievements.length,
        awards: system.achievementAwards.length,
        paidEvents,
        events: system.events.length,
        totalRsvps,
        goingRsvps,
        totalRevenueCents,
      },
      topReputation,
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/members/:userId/status', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMemberParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMemberStatusBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    const previous = current.members[params.data.userId] ?? null

    const wantsRemoval = body.data.status === 'BANNED' || body.data.status === 'SUSPENDED'
    if (wantsRemoval && !canOrganizationPermission(permissions, 'remove_members')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const nextRankIdRaw = body.data.rankId ?? null
    const nextRankId = nextRankIdRaw === null ? previous?.rankId ?? SYSTEM_MEMBER_RANK_ID : nextRankIdRaw
    const rankChanged = Boolean(nextRankId && nextRankId !== (previous?.rankId ?? SYSTEM_MEMBER_RANK_ID))

    if (rankChanged) {
      const canChangeRank =
        canOrganizationPermission(permissions, 'promote_members') ||
        canOrganizationPermission(permissions, 'demote_members') ||
        canOrganizationPermission(permissions, 'create_ranks')
      if (!canChangeRank) {
        return reply.code(403).send({ error: 'forbidden' })
      }
    }

    // For non-removal status updates (eg approvals), require approve_members.
    if (!wantsRemoval && body.data.status !== (previous?.status ?? 'PENDING')) {
      if (!canOrganizationPermission(permissions, 'approve_members')) {
        return reply.code(403).send({ error: 'forbidden' })
      }
    }

    const fallbackRankId = nextRankId
    const nextMemberState: OrgMemberState = {
      rankId: fallbackRankId,
      planId: body.data.planId ?? previous?.planId ?? null,
      status: body.data.status,
      referredByUserId: previous?.referredByUserId ?? null,
      reputation: previous?.reputation ?? 0,
      updatedAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      members: {
        ...current.members,
        [params.data.userId]: nextMemberState,
      },
    }

    await prisma.business.update({
      where: { id: org.id },
      data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
      select: { id: true },
    })
    await appendOrganizationAuditLogEntry(prisma, org.id, {
      actorUserId,
      action: 'member.status_changed',
      reason: body.data.reason ?? null,
      previousValue: { userId: params.data.userId, member: previous },
      nextValue: { userId: params.data.userId, member: nextMemberState },
    })

    return reply.send({ ok: true, member: nextMemberState })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/governance/members', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true, name: true, slug: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const system = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system, userId: actorUserId })
    const canView =
      canOrganizationPermission(permissions, 'approve_members') ||
      canOrganizationPermission(permissions, 'remove_members') ||
      canOrganizationPermission(permissions, 'promote_members') ||
      canOrganizationPermission(permissions, 'demote_members')
    if (!canView) return reply.code(403).send({ error: 'forbidden' })

    const [owner, managers, followers] = await Promise.all([
      prisma.user.findUnique({ where: { id: org.ownerId }, select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true, communityMeta: true } }),
      prisma.businessMembership.findMany({
        where: { businessId: org.id, userId: { not: org.ownerId } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: {
          userId: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true, communityMeta: true } },
        },
      }),
      prisma.businessFollow.findMany({
        where: { businessId: org.id, userId: { not: org.ownerId } },
        orderBy: { createdAt: 'asc' },
        select: {
          userId: true,
          createdAt: true,
          user: { select: { id: true, handle: true, name: true, avatarUrl: true, coverUrl: true, premiumStatus: true, communityMeta: true } },
        },
      }),
    ])

    const managerIds = new Set(managers.map((row: { userId: string }) => row.userId))

    const items = [
      ...(owner
        ? [
            {
              userId: owner.id,
              membershipRole: 'OWNER' as const,
              joinedAt: null,
              user: {
                id: owner.id,
                handle: owner.handle,
                name: owner.name,
                avatarUrl: normalizeMediaUrl(owner.avatarUrl ?? null),
                coverUrl: normalizeMediaUrl(owner.coverUrl ?? null),
                isPremium: isPremium(owner.premiumStatus),
                isVerified: isSelfVerifiedCanadianCitizen(parseCommunityMeta(owner.communityMeta ?? null)),
              },
              memberState:
                system.members[owner.id] ??
                ({
                  rankId: SYSTEM_MANAGER_RANK_ID,
                  planId: null,
                  status: 'ACTIVE',
                  referredByUserId: null,
                  reputation: 0,
                  updatedAt: new Date().toISOString(),
                } as OrgMemberState),
            },
          ]
        : []),
      ...managers.map(
        (row: {
          userId: string
          role: BusinessRole
          createdAt: Date
          user: {
            id: string
            handle: string
            name: string | null
            avatarUrl: string | null
            coverUrl: string | null
            premiumStatus: PremiumStatus | null
            communityMeta: Prisma.JsonValue | null
          }
        }) => ({
          userId: row.userId,
          membershipRole: row.role,
          joinedAt: row.createdAt,
          user: {
            id: row.user.id,
            handle: row.user.handle,
            name: row.user.name,
            avatarUrl: normalizeMediaUrl(row.user.avatarUrl ?? null),
            coverUrl: normalizeMediaUrl(row.user.coverUrl ?? null),
            isPremium: isPremium(row.user.premiumStatus),
            isVerified: isSelfVerifiedCanadianCitizen(parseCommunityMeta(row.user.communityMeta ?? null)),
          },
          memberState: system.members[row.userId] ?? null,
        }),
      ),
      ...followers
        .filter((row: { userId: string }) => !managerIds.has(row.userId))
        .map(
          (row: {
            userId: string
            createdAt: Date
            user: {
              id: string
              handle: string
              name: string | null
              avatarUrl: string | null
              coverUrl: string | null
              premiumStatus: PremiumStatus | null
              communityMeta: Prisma.JsonValue | null
            }
          }) => ({
            userId: row.userId,
            membershipRole: 'FOLLOWER' as const,
            joinedAt: row.createdAt,
            user: {
              id: row.user.id,
              handle: row.user.handle,
              name: row.user.name,
              avatarUrl: normalizeMediaUrl(row.user.avatarUrl ?? null),
              coverUrl: normalizeMediaUrl(row.user.coverUrl ?? null),
              isPremium: isPremium(row.user.premiumStatus),
              isVerified: isSelfVerifiedCanadianCitizen(parseCommunityMeta(row.user.communityMeta ?? null)),
            },
            memberState: system.members[row.userId] ?? null,
          }),
        ),
    ]

    return reply.send({
      org: { id: org.id, name: org.name, slug: org.slug },
      ranks: system.ranks,
      items,
      viewer: { permissions },
    })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/members/:userId/kick', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMemberParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMemberModerationBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true, name: true, slug: true, provinceCode: true, communitySlug: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })
    if (params.data.userId === org.ownerId) return reply.code(400).send({ error: 'cannot_remove_owner' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'remove_members')) return reply.code(403).send({ error: 'forbidden' })

    const previous = current.members[params.data.userId] ?? null
    const nextMemberState: OrgMemberState = {
      rankId: previous?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: previous?.planId ?? null,
      status: 'SUSPENDED',
      referredByUserId: previous?.referredByUserId ?? null,
      reputation: previous?.reputation ?? 0,
      updatedAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      members: {
        ...current.members,
        [params.data.userId]: nextMemberState,
      },
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.businessMembership.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
      await tx.businessFollow.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
      await tx.business.update({
        where: { id: org.id },
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await appendOrganizationAuditLogEntry(tx, org.id, {
        actorUserId,
        action: 'member.kicked',
        reason: body.data.reason ?? null,
        previousValue: { userId: params.data.userId, member: previous },
        nextValue: { userId: params.data.userId, member: nextMemberState },
      })
    })

    await createNotificationRecord({
      userId: params.data.userId,
      actorId: actorUserId,
      type: 'org_member_kicked',
      payload: {
        orgId: org.id,
        orgSlug: org.slug,
        orgName: org.name,
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
        reason: body.data.reason ?? null,
      },
    })

    return reply.send({ ok: true })
  }),
)

app.post('/communities/:province/:municipality/orgs/:slug/governance/members/:userId/ban', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgMemberParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const body = CommunityOrgMemberModerationBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true, name: true, slug: true, provinceCode: true, communitySlug: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })
    if (params.data.userId === org.ownerId) return reply.code(400).send({ error: 'cannot_remove_owner' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const current = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system: current, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'remove_members')) return reply.code(403).send({ error: 'forbidden' })

    const previous = current.members[params.data.userId] ?? null
    const nextMemberState: OrgMemberState = {
      rankId: previous?.rankId ?? SYSTEM_MEMBER_RANK_ID,
      planId: previous?.planId ?? null,
      status: 'BANNED',
      referredByUserId: previous?.referredByUserId ?? null,
      reputation: previous?.reputation ?? 0,
      updatedAt: new Date().toISOString(),
    }

    const nextSystem: OrganizationSystemState = {
      ...current,
      members: {
        ...current.members,
        [params.data.userId]: nextMemberState,
      },
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.businessMembership.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
      await tx.businessFollow.deleteMany({ where: { businessId: org.id, userId: params.data.userId } })
      await tx.business.update({
        where: { id: org.id },
        data: { metadata: mergeOrganizationSystemStateIntoMetadata(org.metadata, nextSystem) },
        select: { id: true },
      })
      await appendOrganizationAuditLogEntry(tx, org.id, {
        actorUserId,
        action: 'member.banned',
        reason: body.data.reason ?? null,
        previousValue: { userId: params.data.userId, member: previous },
        nextValue: { userId: params.data.userId, member: nextMemberState },
      })
    })

    await createNotificationRecord({
      userId: params.data.userId,
      actorId: actorUserId,
      type: 'org_member_banned',
      payload: {
        orgId: org.id,
        orgSlug: org.slug,
        orgName: org.name,
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
        reason: body.data.reason ?? null,
      },
    })

    return reply.send({ ok: true })
  }),
)

app.get('/communities/:province/:municipality/orgs/:slug/governance/audit', async (req: FastifyRequest, reply: FastifyReply) =>
  withSchemaGuard(req, reply, async () => {
    const actorUserId = (await resolveUserId(req)) ?? null
    if (!actorUserId) return reply.code(401).send({ error: 'unauthorized' })

    const params = CommunityOrgSlugParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const query = CommunityOrgGovernanceQuery.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })
    const community = findCommunity(province, params.data.municipality.trim().toLowerCase())
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const org = await prisma.business.findFirst({
      where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
      select: { id: true, ownerId: true, metadata: true },
    })
    if (!org) return reply.code(404).send({ error: 'organization_not_found' })

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId: org.id, userId: actorUserId } },
      select: { role: true },
    })
    const actorRole: 'OWNER' | 'MANAGER' | null = org.ownerId === actorUserId ? 'OWNER' : membership?.role === 'MANAGER' ? 'MANAGER' : null

    const system = readOrganizationSystemState(org.metadata)
    const permissions = resolveOrganizationPermissions({ org: { ownerId: org.ownerId }, role: actorRole, system, userId: actorUserId })
    if (!canOrganizationPermission(permissions, 'view_audit_logs')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const entries = [...system.auditLog].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    const start = query.data.cursor ? entries.findIndex((entry) => entry.id === query.data.cursor) + 1 : 0
    const items = entries.slice(Math.max(start, 0), Math.max(start, 0) + query.data.limit)
    const nextCursor = items.length === query.data.limit ? items[items.length - 1]?.id ?? null : null

    return reply.send({ items, nextCursor })
  }),
)

registerOrganizationShopRoutes(app, {
  CIVIL_PUBLIC_HOST,
  CommunityOrgShopCatalogCreateBody,
  CommunityOrgShopCatalogParams,
  CommunityOrgShopCatalogReorderBody,
  CommunityOrgShopCatalogUpdateBody,
  CommunityOrgShopInventoryUpdateBody,
  CommunityOrgShopProductCreateBody,
  CommunityOrgShopProductParams,
  CommunityOrgShopProductPhotosUpdateBody,
  CommunityOrgShopProductUpdateBody,
  CommunityOrgShopSettingsBody,
  CommunityOrgShopWarehouseCreateBody,
  CommunityOrgSlugParams,
  ModerationStatus,
  enqueueContentAiScanForMarketProduct,
  ensureOrganizationShopTables,
  findCommunity,
  getStripeClient,
  isBusinessHiddenFromViewer,
  isVisibleModerationStatus,
  loadViewerBlockState,
  mergeOrganizationShopPaymentsStateIntoMetadata,
  moderationLockedErrorCode,
  normalizeProvinceCode,
  readOrganizationShopPaymentsState,
  resolveUserId,
  sanitizePlainText,
  withSchemaGuard,
})

const MarketProductsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(24),
  cursor: z.string().trim().min(1).max(256).optional(),
})

const MarketProductParams = z.object({
  productId: z.string().trim().min(1).max(128),
})

const MarketCheckoutBody = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(128),
        quantity: z.coerce.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(20),
  shippingAddress: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      line1: z.string().trim().min(1).max(120).optional(),
      line2: z.string().trim().max(120).optional().nullable(),
      city: z.string().trim().min(1).max(80).optional(),
      province: z.string().trim().min(1).max(80).optional(),
      postalCode: z.string().trim().min(1).max(32).optional(),
      country: z.string().trim().min(2).max(2).optional().default('CA'),
    })
    .optional()
    .nullable(),
})

const CANADA_TAX_REGION_CODES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'])
const CANADA_TAX_REGION_NAME_TO_CODE: Record<string, string> = {
  ALBERTA: 'AB',
  BRITISHCOLUMBIA: 'BC',
  MANITOBA: 'MB',
  NEWBRUNSWICK: 'NB',
  NEWFOUNDLANDANDLABRADOR: 'NL',
  NOVASCOTIA: 'NS',
  NORTHWESTTERRITORIES: 'NT',
  NUNAVUT: 'NU',
  ONTARIO: 'ON',
  PRINCEEDWARDISLAND: 'PE',
  QUEBEC: 'QC',
  SASKATCHEWAN: 'SK',
  YUKON: 'YT',
}

function parseTaxRatePct(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value)
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return Math.max(0, parsed)
  }
  return 0
}

function resolveTaxRegionCode(value: unknown): string | null {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
  if (!normalized) return null
  if (CANADA_TAX_REGION_CODES.has(normalized)) return normalized

  const compact = normalized.replace(/[^A-Z]/g, '')
  return CANADA_TAX_REGION_NAME_TO_CODE[compact] ?? null
}

const MarketOrderParams = z.object({
  orderId: z.string().trim().min(1).max(128),
})

const MarketOrdersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
})

const MarketListingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
})

const MarketListingParams = z.object({
  listingId: z.string().trim().min(1).max(128),
})

const MarketChatThreadParams = z.object({
  threadId: z.string().cuid(),
})

const MarketSelectBuyerBody = z
  .object({
    threadId: z.string().cuid(),
  })
  .strict()

const MarketRelistBody = z
  .object({
    notify: z.boolean().optional().default(true),
  })
  .strict()

const MarketDeliveryOptionsSchema = z
  .object({
    short50km: z.coerce.number().int().min(0).max(500000000).optional(),
    medium100km: z.coerce.number().int().min(0).max(500000000).optional(),
    long250km: z.coerce.number().int().min(0).max(500000000).optional(),
  })
  .strict()

const MarketListingUpdateBody = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(4000).optional().nullable(),
  priceCents: z.coerce.number().int().min(0).max(500000000).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  photoUrls: z.array(z.string().trim().url().max(2048)).max(12).optional(),
  listingProvinceCode: z.string().trim().min(2).max(8).optional().nullable(),
  listingCommunitySlug: z.string().trim().min(1).max(120).optional().nullable(),
  pickupCity: z.string().trim().max(120).optional().nullable(),
  pickupProvince: z.string().trim().max(80).optional().nullable(),
  pickupAddressLine1: z.string().trim().max(180).optional().nullable(),
  pickupAddressLine2: z.string().trim().max(180).optional().nullable(),
  pickupPostalCode: z.string().trim().max(32).optional().nullable(),
  paymentTypes: z.array(z.enum(['cash_pickup', 'etransfer'])).max(2).optional(),
  willingToDeliver: z.boolean().optional(),
  deliveryOptions: MarketDeliveryOptionsSchema.optional().nullable(),
  eTransferEmail: z.string().trim().email().max(320).optional().nullable(),
  isDraft: z.boolean().optional(),
  status: z.enum(['draft', 'active', 'pending_sale', 'sold', 'canceled']).optional(),
})

const ModerationReportReasonValues = [
  'spam_or_scam',
  'hate_or_harassment',
  'violence_or_threats',
  'sexual_or_explicit',
  'child_safety',
  'impersonation',
  'misinformation',
  'illegal_goods_or_services',
  'copyright_or_ip',
  'other',
] as const

const ModerationReportTargetTypeValues = ['POST', 'COMMENT', 'ORGANIZATION', 'MARKET_LISTING', 'MARKET_PRODUCT'] as const

const ModerationReportTargetBody = z.object({
  targetType: z.enum(ModerationReportTargetTypeValues),
  targetId: z.string().trim().min(1).max(191),
})

const ModerationReportBody = z.object({
  targetType: z.enum(ModerationReportTargetTypeValues),
  targetId: z.string().trim().min(1).max(191),
  reasons: z.array(z.enum(ModerationReportReasonValues)).min(1).max(10),
  details: z.string().trim().max(2000).optional().nullable(),
})

const UserBlockBody = z.object({
  userId: z.string().cuid(),
  reportTarget: ModerationReportTargetBody.optional().nullable(),
})

const BusinessBlockBody = z.object({
  businessId: z.string().cuid(),
  reportTarget: ModerationReportTargetBody.optional().nullable(),
})

const AdminModerationReportsQuery = z.object({
  status: z.enum(['OPEN', 'REVIEWED', 'ALL']).default('OPEN'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

const AdminModerationReportReviewBody = z.object({
  reviewNotes: z.string().trim().max(2000).optional().nullable(),
  ejectReportedUser: z.boolean().optional().default(false),
  suspendReportedOrganization: z.boolean().optional().default(false),
})

const SupportRequestBody = z.object({
  type: z.enum(['CUSTOMER_SERVICE', 'FEATURE_REQUEST']),
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(10).max(4000),
})

const AdminSupportRequestsQuery = z.object({
  status: z.enum(['OPEN', 'REVIEWED', 'ALL']).default('OPEN'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

const AdminSupportRequestReviewBody = z.object({
  adminNotes: z.string().trim().max(2000).optional().nullable(),
})

function parseMarketCursor(cursor: string | undefined): null | { createdAt: Date; id: string } {
  if (!cursor) return null
  const [createdAtRaw, id] = cursor.split('|')
  if (!createdAtRaw || !id) return null
  const createdAt = new Date(createdAtRaw)
  if (Number.isNaN(createdAt.getTime())) return null
  const trimmedId = id.trim()
  if (!trimmedId) return null
  return { createdAt, id: trimmedId }
}

function readGalleryUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const urls: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const normalized = normalizeMediaUrl(entry)
      urls.push(normalized ?? entry)
    }
  }
  return urls
}

function normalizeContentAiImageUrls(urls: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      urls
        .map((url) => normalizeMediaUrl(url ?? null))
        .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)),
    ),
  ).slice(0, 8)
}

function buildContentAiScanSearchText(sourceText: string | null | undefined, labels: string[]) {
  return buildSearchableText(sourceText ?? null, labels.join(' '))
}

function buildOrganizationEventScanTargetId(orgId: string, eventId: string) {
  return `${orgId}:${eventId}`
}

function parseOrganizationEventScanTargetId(targetId: string) {
  const separatorIndex = targetId.indexOf(':')
  if (separatorIndex <= 0) return null
  const orgId = targetId.slice(0, separatorIndex).trim()
  const eventId = targetId.slice(separatorIndex + 1).trim()
  if (!orgId || !eventId) return null
  return { orgId, eventId }
}

function buildContentAiScanDefaultSummary(): ContentAiScanSummary {
  return {
    status: 'not_queued',
    moderationState: null,
    labelSummary: null,
    labels: [],
    moderationFlags: [],
    errorText: null,
    updatedAt: null,
    completedAt: null,
  }
}

async function loadContentAiScanSummary(targetType: ContentAiScanTargetType, targetId: string): Promise<ContentAiScanSummary> {
  await ensureContentAiScanTables()

  const rows = await prisma.$queryRaw<Array<{
    status: string
    moderation_state: string | null
    label_summary: string | null
    labels: unknown
    moderation_flags: unknown
    error_text: string | null
    updated_at: Date | null
    completed_at: Date | null
  }>>`
    SELECT status, moderation_state, label_summary, labels, moderation_flags, error_text, updated_at, completed_at
    FROM content_ai_scan
    WHERE target_type = ${targetType}
      AND target_id = ${targetId}
    LIMIT 1
  `

  const row = rows[0]
  if (!row) return buildContentAiScanDefaultSummary()

  return {
    status: row.status,
    moderationState: row.moderation_state,
    labelSummary: row.label_summary,
    labels: readStringList(row.labels),
    moderationFlags: readStringList(row.moderation_flags),
    errorText: row.error_text,
    updatedAt: row.updated_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
  }
}

async function upsertContentAiScanRecord(args: {
  targetType: ContentAiScanTargetType
  targetId: string
  ownerUserId: string | null
  sourceText: string | null
  imageUrls: string[]
}) {
  await ensureContentAiScanTables()

  const hasImages = args.imageUrls.length > 0
  const hasSourceText = typeof args.sourceText === 'string' && args.sourceText.trim().length > 0
  const now = new Date()
  const shouldQueue = hasImages || hasSourceText
  const status = shouldQueue ? 'queued' : 'skipped'
  const moderationState = shouldQueue ? null : 'no_content'
  const errorText = shouldQueue ? null : 'no_images_or_text_available'

  await prisma.$executeRaw`
    INSERT INTO content_ai_scan (
      id,
      target_type,
      target_id,
      owner_user_id,
      source_text,
      image_urls,
      status,
      moderation_state,
      label_summary,
      search_text,
      labels,
      moderation_flags,
      confidence_score,
      server_id,
      model,
      error_text,
      attempts,
      queued_at,
      started_at,
      completed_at,
      created_at,
      updated_at,
      raw_response
    )
    VALUES (
      ${randomUUID()},
      ${args.targetType},
      ${args.targetId},
      ${args.ownerUserId},
      ${args.sourceText},
      ${JSON.stringify(args.imageUrls)}::jsonb,
      ${status},
      ${moderationState},
      ${null},
      ${buildContentAiScanSearchText(args.sourceText, [])},
      ${JSON.stringify([])}::jsonb,
      ${JSON.stringify([])}::jsonb,
      ${null},
      ${null},
      ${null},
      ${errorText},
      ${0},
      ${now},
      ${null},
      ${shouldQueue ? null : now},
      ${now},
      ${now},
      ${null}
    )
    ON CONFLICT (target_type, target_id) DO UPDATE SET
      owner_user_id = EXCLUDED.owner_user_id,
      source_text = EXCLUDED.source_text,
      image_urls = EXCLUDED.image_urls,
      status = EXCLUDED.status,
      moderation_state = EXCLUDED.moderation_state,
      label_summary = EXCLUDED.label_summary,
      search_text = EXCLUDED.search_text,
      labels = EXCLUDED.labels,
      moderation_flags = EXCLUDED.moderation_flags,
      confidence_score = EXCLUDED.confidence_score,
      server_id = EXCLUDED.server_id,
      model = EXCLUDED.model,
      error_text = EXCLUDED.error_text,
      attempts = 0,
      queued_at = EXCLUDED.queued_at,
      started_at = NULL,
      completed_at = EXCLUDED.completed_at,
      updated_at = EXCLUDED.updated_at,
      raw_response = NULL
  `

  if (!shouldQueue) return

  const existingJob = await contentAiScanQueue.getJob(`content-ai-scan:${args.targetType}:${args.targetId}`)
  if (existingJob) {
    const state = await existingJob.getState()
    if (state === 'failed' || state === 'completed') {
      await existingJob.remove().catch(() => undefined)
    }
  }

  await contentAiScanQueue.add(
    'scan',
    { targetType: args.targetType, targetId: args.targetId },
    {
      jobId: `content-ai-scan:${args.targetType}:${args.targetId}`,
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      delay: hasImages ? CONTENT_AI_IMAGE_SCAN_DELAY_MS : 0,
    },
  )
}

async function enqueueContentAiScanForPost(post: {
  id: string
  authorId: string
  title: string | null
  body: string
  mediaUrl: string | null
  images: unknown
}) {
  const imageUrls = normalizeContentAiImageUrls([...readGalleryUrls(post.images), post.mediaUrl])
  const sourceText = buildSearchableText(post.title, stripHtmlToPlainText(post.body ?? '')) || null
  await upsertContentAiScanRecord({
    targetType: 'post',
    targetId: post.id,
    ownerUserId: post.authorId,
    sourceText,
    imageUrls,
  })
}

async function enqueueContentAiScanForComment(comment: {
  id: string
  userId: string
  body: string
}) {
  const sourceText = buildSearchableText(stripHtmlToPlainText(comment.body ?? '')) || null
  await upsertContentAiScanRecord({
    targetType: 'comment',
    targetId: comment.id,
    ownerUserId: comment.userId,
    sourceText,
    imageUrls: [],
  })
}

async function enqueueContentAiScanForMarketListing(listingId: string) {
  await ensureCitizenMarketplaceTables()
  await ensureContentAiScanTables()

  type ListingScanRow = {
    id: string
    seller_user_id: string
    title: string
    description: string | null
    photo_urls: unknown
  }

  const rows = await prisma.$queryRaw<ListingScanRow[]>`
    SELECT id, seller_user_id, title, description, photo_urls
    FROM citizen_market_listing
    WHERE id = ${listingId}
      AND is_active = TRUE
    LIMIT 1
  `

  const listing = rows[0]
  if (!listing) return

  const imageUrls = normalizeContentAiImageUrls(readGalleryUrls(listing.photo_urls))
  const sourceText = buildSearchableText(listing.title, stripHtmlToPlainText(listing.description ?? '')) || null

  await upsertContentAiScanRecord({
    targetType: 'market_listing',
    targetId: listing.id,
    ownerUserId: listing.seller_user_id,
    sourceText,
    imageUrls,
  })
}

async function enqueueContentAiScanForMarketProduct(productId: string) {
  await ensureOrganizationShopTables()
  await ensureContentAiScanTables()

  type ProductScanRow = {
    id: string
    created_by: string | null
    name: string
    description: string | null
    primary_image_url: string | null
    gallery_image_urls: unknown
  }

  const rows = await prisma.$queryRaw<ProductScanRow[]>`
    SELECT id, created_by, name, description, primary_image_url, gallery_image_urls
    FROM organization_shop_product
    WHERE id = ${productId}
      AND is_active = TRUE
    LIMIT 1
  `

  const product = rows[0]
  if (!product) return

  const imageUrls = normalizeContentAiImageUrls([product.primary_image_url, ...readGalleryUrls(product.gallery_image_urls)])
  const sourceText = buildSearchableText(product.name, stripHtmlToPlainText(product.description ?? '')) || null

  await upsertContentAiScanRecord({
    targetType: 'market_product',
    targetId: product.id,
    ownerUserId: product.created_by,
    sourceText,
    imageUrls,
  })
}

async function enqueueContentAiScanForOrganizationEvent(args: {
  orgId: string
  ownerUserId: string
  event: Pick<OrgEventDefinition, 'id' | 'title' | 'description' | 'primaryPhotoUrl' | 'galleryPhotoUrls'>
}) {
  const imageUrls = normalizeContentAiImageUrls([args.event.primaryPhotoUrl, ...(args.event.galleryPhotoUrls ?? [])])
  const sourceText = buildSearchableText(args.event.title, stripHtmlToPlainText(args.event.description ?? '')) || null
  await upsertContentAiScanRecord({
    targetType: 'organization_event',
    targetId: buildOrganizationEventScanTargetId(args.orgId, args.event.id),
    ownerUserId: args.ownerUserId,
    sourceText,
    imageUrls,
  })
}

async function enqueueContentAiScanForOrganization(org: Pick<CommunityOrgRecord, 'id' | 'ownerId' | 'name' | 'description' | 'metadata' | 'logoUrl' | 'coverUrl'>) {
  const imageUrls = normalizeContentAiImageUrls([org.logoUrl ?? null, org.coverUrl ?? null])
  const sourceText = buildSearchableText(org.name, org.description ?? null, readOrganizationHeadline(org.metadata)) || null
  await upsertContentAiScanRecord({
    targetType: 'organization',
    targetId: org.id,
    ownerUserId: org.ownerId,
    sourceText,
    imageUrls,
  })
}

async function retryContentAiScanTarget(args: { targetType: ContentAiScanTargetType; targetId: string }) {
  const existingJob = await contentAiScanQueue.getJob(`content-ai-scan:${args.targetType}:${args.targetId}`)
  if (existingJob) {
    await existingJob.remove().catch(() => undefined)
  }

  if (args.targetType === 'post') {
    const post = await prisma.post.findUnique({
      where: { id: args.targetId },
      select: {
        id: true,
        authorId: true,
        title: true,
        body: true,
        mediaUrl: true,
        images: true,
      },
    })
    if (!post) return false
    await enqueueContentAiScanForPost(post)
    return true
  }

  if (args.targetType === 'comment') {
    const comment = await prisma.comment.findUnique({
      where: { id: args.targetId },
      select: {
        id: true,
        userId: true,
        body: true,
      },
    })
    if (!comment) return false
    await enqueueContentAiScanForComment(comment)
    return true
  }

  if (args.targetType === 'market_listing') {
    await ensureCitizenMarketplaceTables()
    const listing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM citizen_market_listing
      WHERE id = ${args.targetId}
        AND is_active = TRUE
      LIMIT 1
    `
    if (!listing[0]) return false
    await enqueueContentAiScanForMarketListing(args.targetId)
    return true
  }

  if (args.targetType === 'market_product') {
    await ensureOrganizationShopTables()
    const product = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM organization_shop_product
      WHERE id = ${args.targetId}
        AND is_active = TRUE
      LIMIT 1
    `
    if (!product[0]) return false
    await enqueueContentAiScanForMarketProduct(args.targetId)
    return true
  }

  if (args.targetType === 'organization_event') {
    const parsed = parseOrganizationEventScanTargetId(args.targetId)
    if (!parsed) return false

    const org = await prisma.business.findUnique({
      where: { id: parsed.orgId },
      select: {
        id: true,
        ownerId: true,
        metadata: true,
      },
    })
    if (!org) return false

    const system = readOrganizationSystemState(org.metadata)
    const event = system.events.find((entry) => entry.id === parsed.eventId)
    if (!event) return false

    await enqueueContentAiScanForOrganizationEvent({
      orgId: org.id,
      ownerUserId: org.ownerId,
      event,
    })
    return true
  }

  const org = await prisma.business.findUnique({
    where: { id: args.targetId },
    select: {
      id: true,
      ownerId: true,
      name: true,
      description: true,
      metadata: true,
      logoUrl: true,
      coverUrl: true,
    },
  })
  if (!org) return false
  await enqueueContentAiScanForOrganization(org)
  return true
}

function readStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const values: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') values.push(entry)
  }
  return values
}

type MarketDeliveryOptions = {
  short50km?: number
  medium100km?: number
  long250km?: number
}

function readDeliveryOptions(raw: unknown): MarketDeliveryOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const typed = raw as Record<string, unknown>
  const options: MarketDeliveryOptions = {}

  const short50km = typed.short50km
  if (typeof short50km === 'number' && Number.isFinite(short50km) && short50km >= 0) options.short50km = Math.round(short50km)

  const medium100km = typed.medium100km
  if (typeof medium100km === 'number' && Number.isFinite(medium100km) && medium100km >= 0) options.medium100km = Math.round(medium100km)

  const long250km = typed.long250km
  if (typeof long250km === 'number' && Number.isFinite(long250km) && long250km >= 0) options.long250km = Math.round(long250km)

  return options
}

async function readViewerCommunityFollows(userId: string): Promise<Array<{ provinceCode: string; communitySlug: string }>> {
  const follows = await prisma.communityFollow.findMany({
    where: { userId },
    select: { provinceCode: true, communitySlug: true },
    orderBy: [{ home: 'desc' }, { createdAt: 'desc' }],
  })
  return follows
    .filter((entry: { provinceCode: string; communitySlug: string }) => Boolean(entry.provinceCode && entry.communitySlug))
    .map((entry: { provinceCode: string; communitySlug: string }) => ({
      provinceCode: String(entry.provinceCode || '').trim().toUpperCase(),
      communitySlug: String(entry.communitySlug || '').trim().toLowerCase(),
    }))
}

registerMarketStorefrontRoutes(app, {
  MarketCheckoutBody,
  MarketOrderParams,
  MarketOrdersQuery,
  MarketProductParams,
  MarketProductsQuery,
  ModerationStatus,
  ensureCitizenMarketplaceTables,
  ensureOrganizationShopTables,
  loadViewerBlockState,
  normalizeMediaUrl,
  parseMarketCursor,
  parseTaxRatePct,
  readGalleryUrls,
  readViewerCommunityFollows,
  resolveTaxRegionCode,
  resolveUserId,
  withSchemaGuard,
})

registerMarketListingRoutes(app, {
  MarketListingParams,
  MarketListingsQuery,
  MarketListingUpdateBody,
  enqueueContentAiScanForMarketListing,
  ensureCitizenMarketplaceTables,
  isVisibleModerationStatus,
  loadViewerBlockState,
  moderationLockedErrorCode,
  normalizeMediaUrl,
  readDeliveryOptions,
  readGalleryUrls,
  readStringList,
  readViewerCommunityFollows,
  resolveUserId,
  sanitizePlainText,
  withSchemaGuard,
})

registerMarketChatRoutes(app, {
  MARKET_LISTING_CHAT_CONTEXT_TYPE,
  MESSAGE_SELECT,
  MarketChatThreadParams,
  MarketListingParams,
  MarketRelistBody,
  MarketSelectBuyerBody,
  MessageListQuery,
  SendMessageInput,
  THREAD_SUMMARY_INCLUDE,
  THREAD_WITH_PARTICIPANTS_INCLUDE,
  ThreadReadInput,
  buildMarketListingDirectThreadKey,
  dispatchRealtimeEvent,
  ensureCitizenMarketplaceTables,
  fetchThreadMessages,
  formatMessage,
  formatThreadBase,
  formatThreadSummaryRecord,
  isVisibleModerationStatus,
  loadViewerBlockState,
  moderationLockedErrorCode,
  normalizeMediaUrl,
  readGalleryUrls,
  resolveUserId,
  sanitizePlainText,
  sendMobilePushForMessageCreated,
  withSchemaGuard,
})


registerModerationActionRoutes(app, {
  BusinessBlockBody,
  FAMILY_NOTIFICATION_TYPES,
  ModerationReportBody,
  UserBlockBody,
  createModerationReportAndQuarantine,
  createNotificationRecord,
  loadViewerAuthContext,
  normalizeFamilyMemberSummary,
  resolveModerationTarget,
  resolveUserId,
  sanitizePlainText,
  withSchemaGuard,
})

registerSupportRoutes(app, {
  SupportRequestBody,
  normalizeMediaUrl,
  resolveUserId,
  sanitizePlainText,
  withSchemaGuard,
})

registerOrgChannelRoutes(app, {
  CommunityOrgChannelCreateBody,
  CommunityOrgChannelInviteBody,
  CommunityOrgChannelNotificationBody,
  CommunityOrgChannelParams,
  CommunityOrgServerNotificationBody,
  CommunityOrgSlugParams,
  ORG_CHANNEL_CONTEXT_TYPE,
  THREAD_SUMMARY_INCLUDE,
  THREAD_WITH_PARTICIPANTS_INCLUDE,
  buildOrgChannelContextId,
  dispatchRealtimeEvent,
  findCommunity,
  formatMessage,
  formatThreadSummaryRecord,
  normalizeMediaUrl,
  normalizeProvinceCode,
  parseOrgChannelContextId,
  readOrgChatPrefs,
  slugifyChannelName,
  withSchemaGuard,
})

const CommunityOrgPhotoUpdateBody = z.object({
  category: z.enum(['business_logo', 'business_cover']),
  displayAssetId: MediaAssetIdSchema,
  fullAssetId: MediaAssetIdSchema.optional(),
  caption: z.string().trim().max(5000).optional(),
})

registerOrganizationProfilePhotoRoutes(app, {
  CommunityOrgPhotoUpdateBody,
  CommunityOrgSlugParams,
  POST_INCLUDE,
  buildCommunityOrgPayload,
  enqueueContentAiScanForOrganization,
  enqueueContentAiScanForPost,
  extractVariantUrl,
  findCommunity,
  formatPost,
  normalizeProvinceCode,
  withSchemaGuard,
})

registerOrganizationCollectionRoutes(app, {
  normalizeMediaUrl,
  withSchemaGuard,
})

registerPublicEventOrgPostRoutes(app, {
  BusinessStatus,
  CommunityOrgSlugParams,
  CursorQuery,
  JurisdictionEnum,
  ModerationStatus,
  POST_INCLUDE,
  PostSortEnum,
  applyVisibleModerationFiltersToPostWhere,
  canOrganizationPermission,
  findCommunity,
  formatPost,
  loadViewerBlockState,
  loadViewerPostFormattingContext,
  normalizeMediaUrl,
  normalizeProvinceCode,
  readOrganizationSystemState,
  resolveOrganizationPermissions,
  resolveUserId,
  withSchemaGuard,
})

const BillingDetailsSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().max(50).optional(),
    address: z
      .object({
        line1: z.string().trim().max(200).optional(),
        line2: z.string().trim().max(200).optional(),
        city: z.string().trim().max(120).optional(),
        state: z.string().trim().max(120).optional(),
        postalCode: z.string().trim().max(40).optional(),
        country: z.string().trim().length(2).optional(),
      })
      .partial()
      .optional(),
  })
  .partial()

const BillingProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  companyName: z.string().trim().max(160).optional().nullable(),
  email: z.string().trim().min(1).email(),
  phone: z.string().trim().max(50).optional().nullable(),
  country: z.string().trim().min(2).max(2),
  state: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(120),
  address1: z.string().trim().min(1).max(200),
  address2: z.string().trim().max(200).optional().nullable(),
  postalCode: z.string().trim().min(2).max(40),
  taxId: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
})

type BillingProfileInput = z.infer<typeof BillingProfileSchema>

type BillingProfileResponse = {
  firstName: string
  lastName: string
  companyName: string
  email: string
  phone: string
  country: string
  state: string
  city: string
  address1: string
  address2: string
  postalCode: string
  taxId: string
  notes: string
}

const BILLING_PROFILE_REQUIRED_FIELDS: Array<keyof BillingProfileResponse> = [
  'firstName',
  'lastName',
  'email',
  'country',
  'state',
  'city',
  'address1',
  'postalCode',
]

const BILLING_PROFILE_SELECT = {
  email: true,
  billingEmail: true,
  billingFirstName: true,
  billingLastName: true,
  billingCompanyName: true,
  billingPhone: true,
  billingCountry: true,
  billingState: true,
  billingCity: true,
  billingAddress1: true,
  billingAddress2: true,
  billingPostalCode: true,
  billingTaxId: true,
  billingNotes: true,
} as const

const EMPTY_BILLING_PROFILE: BillingProfileResponse = {
  firstName: '',
  lastName: '',
  companyName: '',
  email: '',
  phone: '',
  country: '',
  state: '',
  city: '',
  address1: '',
  address2: '',
  postalCode: '',
  taxId: '',
  notes: '',
}

function trimOrEmpty(value?: string | null) {
  if (!value) return ''
  const trimmed = value.trim()
  return trimmed.length ? trimmed : ''
}

function normalizeNullable(value?: string | null) {
  const trimmed = trimOrEmpty(value)
  return trimmed.length ? trimmed : null
}

function buildBillingProfileResponse(user: { email?: string | null } & Record<string, unknown>): BillingProfileResponse {
  return {
    firstName: trimOrEmpty((user as any).billingFirstName),
    lastName: trimOrEmpty((user as any).billingLastName),
    companyName: trimOrEmpty((user as any).billingCompanyName),
    email: trimOrEmpty((user as any).billingEmail ?? (user as any).email),
    phone: trimOrEmpty((user as any).billingPhone),
    country: trimOrEmpty((user as any).billingCountry).toUpperCase(),
    state: trimOrEmpty((user as any).billingState),
    city: trimOrEmpty((user as any).billingCity),
    address1: trimOrEmpty((user as any).billingAddress1),
    address2: trimOrEmpty((user as any).billingAddress2),
    postalCode: trimOrEmpty((user as any).billingPostalCode),
    taxId: trimOrEmpty((user as any).billingTaxId),
    notes: trimOrEmpty((user as any).billingNotes),
  }
}

function billingProfileIsComplete(profile: BillingProfileResponse) {
  return BILLING_PROFILE_REQUIRED_FIELDS.every((field) => Boolean(profile[field].trim()))
}

function missingBillingProfileFields(profile: BillingProfileResponse) {
  return BILLING_PROFILE_REQUIRED_FIELDS.filter((field) => !profile[field].trim())
}

function buildBillingProfileIncompleteError(profile: BillingProfileResponse) {
  return {
    error: 'billing_profile_incomplete',
    missingFields: missingBillingProfileFields(profile),
  }
}

function mapProfileInputToUserData(input: BillingProfileInput) {
  return {
    billingEmail: input.email.trim().toLowerCase(),
    billingFirstName: input.firstName.trim(),
    billingLastName: input.lastName.trim(),
    billingCompanyName: normalizeNullable(input.companyName),
    billingPhone: normalizeNullable(input.phone),
    billingCountry: input.country.trim().toUpperCase(),
    billingState: input.state.trim(),
    billingCity: input.city.trim(),
    billingAddress1: input.address1.trim(),
    billingAddress2: normalizeNullable(input.address2),
    billingPostalCode: input.postalCode.trim(),
    billingTaxId: normalizeNullable(input.taxId),
    billingNotes: normalizeNullable(input.notes),
  }
}

function convertProfileToBillingDetails(profile: BillingProfileResponse) {
  const name = `${profile.firstName} ${profile.lastName}`.trim() || profile.companyName || ''
  const addressAvailable =
    profile.address1 || profile.address2 || profile.city || profile.state || profile.postalCode || profile.country
  return {
    name: name || undefined,
    email: profile.email || undefined,
    phone: profile.phone || undefined,
    address: addressAvailable
      ? {
          line1: profile.address1 || undefined,
          line2: profile.address2 || undefined,
          city: profile.city || undefined,
          state: profile.state || undefined,
          postal_code: profile.postalCode || undefined,
          country: profile.country || undefined,
        }
      : undefined,
  }
}

const CheckoutFinalizeSchema = z.object({
  subscriptionId: z.string().trim().min(1),
})

const CheckoutPaymentSchema = z.object({
  paymentMethodId: z.string().trim().min(1),
  setupIntentId: z.string().trim().min(1).optional(),
  billingDetails: BillingDetailsSchema.optional(),
})

const PremiumCheckoutSchema = z.union([CheckoutPaymentSchema, CheckoutFinalizeSchema])

const PortalSessionSchema = z.object({
  returnUrl: z.string().url().optional(),
  businessId: z.string().cuid(),
})

const CreateBusinessInput = z.object({
  name: z.string().trim().min(3).max(160),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9-]+$/i, { message: 'slug_invalid' })
    .optional(),
  description: z.string().trim().max(2000).optional(),
})

const BusinessCheckoutSchema = PremiumCheckoutSchema
const BusinessParam = z.object({ businessId: z.string().cuid() })
const SetupIntentSchema = z.object({ businessId: z.string().cuid().optional() })

class PaymentMethodOwnershipError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'PaymentMethodOwnershipError'
    this.statusCode = statusCode
  }
}

function isStripeError(error: unknown): error is Stripe.errors.StripeError & { code?: string } {
  return Boolean(error) && typeof error === 'object' && 'type' in (error as Record<string, unknown>)
}

function escapeStripeSearch(value: string) {
  return value.replace(/["\\]/g, '\\$&')
}

async function findStripeCustomerByEmail(stripe: Stripe, email: string) {
  const trimmed = email.trim()
  if (!trimmed) return null
  try {
    const search = await stripe.customers.search({ query: `email:"${escapeStripeSearch(trimmed)}"`, limit: 1 })
    if (search.data.length > 0) {
      return search.data[0] ?? null
    }
  } catch (error) {
    if (!isStripeError(error)) {
      throw error
    }
    // Search may be disabled on some accounts; fall back to list below.
  }
  const list = await stripe.customers.list({ email: trimmed, limit: 1 })
  return list.data.length > 0 ? list.data[0] ?? null : null
}

async function ensurePaymentMethodForCustomer(stripe: Stripe, customerId: string, paymentMethodId: string) {
  try {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
    return
  } catch (error) {
    if (isStripeError(error)) {
      const message = error.message ?? ''
      if (error.code === 'resource_already_exists' || message.includes('has already been attached')) {
        return
      }
      if (message.includes('may not be used again')) {
        throw new PaymentMethodOwnershipError(
          'Stripe cannot reuse this payment method. Re-enter your card details and try again.',
          400,
        )
      }
    }

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
    const methodCustomer =
      typeof paymentMethod.customer === 'string'
        ? paymentMethod.customer
        : paymentMethod.customer?.id ?? null

    if (!methodCustomer) {
      throw error
    }

    if (methodCustomer === customerId) {
      return
    }

    throw new PaymentMethodOwnershipError(
      'This card is already linked to another Civil Citizens account. Please use a different card.',
      409,
    )
  }
}

const BUSINESS_SUMMARY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  isVerified: true,
  stripeSubscriptionId: true,
  stripePriceId: true,
  billingEmail: true,
  createdAt: true,
  updatedAt: true,
} as const

type StripeProcessResult =
  | { type: 'premium'; userId: string | null }
  | { type: 'business'; businessId: string | null; ownerId: string | null }
  | { type: 'ignored' }

function buildBusinessSlugBase(name: string) {
  return trimSlugLength(slugifyText(name), 80) || 'business'
}

async function generateUniqueBusinessSlug(ownerId: string, name: string) {
  let candidate = buildBusinessSlugBase(name)
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await prisma.business.findFirst({ where: { ownerId, slug: candidate }, select: { id: true } })
    if (!existing) return candidate
    candidate = trimSlugLength(`${candidate}-${randomSlugSuffix()}`, 80) || `business-${randomSlugSuffix()}`
  }
  return `${candidate}-${randomSlugSuffix()}`.slice(0, 80)
}

async function ensureStripeCustomer(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      stripeCustomerId: true,
      premiumStatus: true,
      premiumSince: true,
      premiumRenewsAt: true,
      ...BILLING_PROFILE_SELECT,
    },
  })
  if (!user) throw new Error('user_not_found')
  if (user.stripeCustomerId) {
    return { customerId: user.stripeCustomerId, user }
  }
  const stripe = getStripeClient()
  if (user.email) {
    const existing = await findStripeCustomerByEmail(stripe, user.email)
    if (existing) {
      await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: existing.id } })
      return { customerId: existing.id, user: { ...user, stripeCustomerId: existing.id } }
    }
  }
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId },
  })
  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } })
  return { customerId: customer.id, user: { ...user, stripeCustomerId: customer.id } }
}

async function loadOwnedBusiness(ownerId: string, businessId: string) {
  return prisma.business.findFirst({ where: { id: businessId, ownerId }, select: BUSINESS_SUMMARY_SELECT })
}

function ensurePriceAvailable(priceId: string | undefined, label: string) {
  if (!priceId) {
    throw Object.assign(new Error(`${label}_price_missing`), { statusCode: 503 })
  }
  return priceId
}

function resolveSubscriptionInvoice(subscription: Stripe.Subscription) {
  const invoiceField = subscription.latest_invoice
  const invoice = typeof invoiceField === 'object' && invoiceField ? (invoiceField as Stripe.Invoice) : null
  const paymentIntentField = invoice?.payment_intent
  const paymentIntent =
    paymentIntentField && typeof paymentIntentField === 'object'
      ? (paymentIntentField as Stripe.PaymentIntent)
      : null
  return { invoice, paymentIntent }
}

function paymentIntentRequiresAction(intent: Stripe.PaymentIntent | null | undefined) {
  if (!intent) return false
  return intent.status === 'requires_action' || intent.status === 'requires_confirmation'
}

function paymentIntentSucceeded(intent: Stripe.PaymentIntent | null | undefined) {
  if (!intent) return false
  return intent.status === 'succeeded' || intent.status === 'processing'
}

function extractStripeIdentifiers(event: Stripe.Event) {
  const rawObject = event.data?.object as unknown
  const dataObj = rawObject && typeof rawObject === 'object' ? (rawObject as Record<string, unknown>) : null
  if (!dataObj) {
    return { subscriptionId: null, invoiceId: null, customerId: null }
  }
  const rawId = typeof dataObj.id === 'string' ? (dataObj.id as string) : null
  const subscriptionField = (dataObj as { subscription?: string | { id?: string } }).subscription
  const subscriptionId = event.type.startsWith('customer.subscription')
    ? rawId
    : typeof subscriptionField === 'string'
      ? subscriptionField
      : typeof subscriptionField === 'object' && subscriptionField && typeof subscriptionField.id === 'string'
        ? subscriptionField.id
        : null

  const invoiceField = (dataObj as { invoice?: string }).invoice
  const invoiceId = event.type.startsWith('invoice.')
    ? rawId
    : typeof invoiceField === 'string'
      ? invoiceField
      : null

  const customerField = (dataObj as { customer?: string | { id?: string } }).customer
  const customerId =
    typeof customerField === 'string'
      ? customerField
      : typeof customerField === 'object' && customerField && typeof customerField.id === 'string'
        ? customerField.id
        : null

  return { subscriptionId, invoiceId, customerId }
}

async function recordStripeWebhookEvent(event: Stripe.Event) {
  const identifiers = extractStripeIdentifiers(event)
  const payload = JSON.parse(JSON.stringify(event))
  const now = new Date()
  return prisma.stripeWebhookEvent.upsert({
    where: { eventId: event.id },
    create: {
      eventId: event.id,
      eventType: event.type,
      apiVersion: event.api_version ?? null,
      livemode: Boolean(event.livemode),
      payload,
      subscriptionId: identifiers.subscriptionId,
      invoiceId: identifiers.invoiceId,
      customerId: identifiers.customerId,
      lastReceivedAt: now,
    },
    update: {
      eventType: event.type,
      apiVersion: event.api_version ?? null,
      livemode: Boolean(event.livemode),
      payload,
      subscriptionId: identifiers.subscriptionId,
      invoiceId: identifiers.invoiceId,
      customerId: identifiers.customerId,
      lastReceivedAt: now,
      retryCount: { increment: 1 },
      status: StripeWebhookStatus.RECEIVED,
    },
    select: { id: true },
  })
}

async function updateStripeWebhookEvent(
  recordId: string,
  data: Prisma.StripeWebhookEventUpdateInput,
) {
  await prisma.stripeWebhookEvent.update({
    where: { id: recordId },
    data,
  })
}

async function syncPremiumSubscription(subscription: Stripe.Subscription) {
  const userIdFromMetadata = subscription.metadata?.userId
  let user = userIdFromMetadata
    ? await prisma.user.findUnique({ where: { id: userIdFromMetadata }, select: { id: true, premiumSince: true } })
    : null

  if (!user) {
    user = await prisma.user.findFirst({
      where: { stripeSubscriptionId: subscription.id },
      select: { id: true, premiumSince: true },
    })
  }

  if (!user) {
    return { userId: null }
  }

  const status = mapSubscriptionStatus(subscription.status)
  const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null

  const updateData: Prisma.UserUpdateInput = {
    stripeSubscriptionId: subscription.id,
    stripePriceId: subscription.items.data[0]?.price?.id ?? null,
    premiumStatus: status,
    premiumRenewsAt: periodEnd,
    premiumCanceledAt: status === 'CANCELED' ? new Date() : null,
  }

  if (!user.premiumSince && status === 'ACTIVE') {
    updateData.premiumSince = new Date()
  }

  await prisma.user.update({ where: { id: user.id }, data: updateData })
  return { userId: user.id }
}

async function syncBusinessSubscription(subscription: Stripe.Subscription) {
  const businessId = subscription.metadata?.businessId
  if (!businessId) {
    return { businessId: null, ownerId: null }
  }
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, ownerId: true, isVerified: true },
  })
  if (!business) {
    return { businessId: null, ownerId: null }
  }

  const status = businessStatusFromSubscription(subscription.status)
  const nextData: Prisma.BusinessUpdateInput = {
    stripeSubscriptionId: subscription.id,
    stripePriceId: subscription.items.data[0]?.price?.id ?? null,
    status,
  }
  if (status === 'ACTIVE') {
    nextData.isVerified = true
  }

  await prisma.business.update({ where: { id: business.id }, data: nextData })
  return { businessId: business.id, ownerId: business.ownerId }
}

type PaymentIntentWithExpandedCharges = Stripe.Response<Stripe.PaymentIntent> & {
  charges?: Stripe.ApiList<Stripe.Charge>
}

async function fetchPaymentFingerprint(stripe: Stripe, invoice: Stripe.Invoice) {
  const paymentIntentId =
    typeof invoice.payment_intent === 'string'
      ? invoice.payment_intent
      : invoice.payment_intent?.id
  if (!paymentIntentId) {
    return null
  }
  try {
    const paymentIntentResponse = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['charges.data.payment_method_details'],
    })
    const paymentIntent = paymentIntentResponse as PaymentIntentWithExpandedCharges
    const charge = paymentIntent.charges?.data?.[0]
    return charge?.payment_method_details?.card?.fingerprint ?? null
  } catch (error) {
    console.warn('[stripe] Unable to fetch payment intent fingerprint', { error })
    return null
  }
}

async function handleInvoicePaymentSucceeded(stripe: Stripe, invoice: Stripe.Invoice) {
  const subscriptionId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id ?? null
  if (!subscriptionId) {
    return
  }
  const priceId = invoice.lines?.data?.find((line) => line.type === 'subscription')?.price?.id ?? null
  if (!priceId) {
    return
  }

  if (STRIPE_PRICE_PREMIUM && priceId === STRIPE_PRICE_PREMIUM) {
    const user = await prisma.user.findFirst({ where: { stripeSubscriptionId: subscriptionId }, select: { id: true } })
    if (!user) return
    const fingerprint = await fetchPaymentFingerprint(stripe, invoice)
    if (fingerprint) {
      const hashed = createHash('sha256').update(fingerprint).digest('hex')
      await prisma.user.update({ where: { id: user.id }, data: { premiumPaymentFingerprint: hashed } })
    }
  } else if (STRIPE_PRICE_BUSINESS && priceId === STRIPE_PRICE_BUSINESS) {
    const business = await prisma.business.findFirst({ where: { stripeSubscriptionId: subscriptionId }, select: { id: true } })
    if (!business) return
    await prisma.business.update({ where: { id: business.id }, data: { status: 'ACTIVE', isVerified: true } })
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id ?? null
  if (!subscriptionId) {
    return
  }
  const user = await prisma.user.findFirst({ where: { stripeSubscriptionId: subscriptionId }, select: { id: true } })
  if (user) {
    await prisma.user.update({ where: { id: user.id }, data: { premiumStatus: 'PAST_DUE' } })
  }
  const business = await prisma.business.findFirst({ where: { stripeSubscriptionId: subscriptionId }, select: { id: true } })
  if (business) {
    await prisma.business.update({ where: { id: business.id }, data: { status: 'SUSPENDED' } })
  }
}

async function handleShopPaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const orderId = paymentIntent.metadata?.orderId
  if (!orderId) return

  await ensureOrganizationShopTables()

  const orderRows = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status
    FROM organization_shop_order
    WHERE id = ${orderId}
    LIMIT 1
  `
  const order = orderRows[0]
  if (!order) return
  if (order.status === 'paid' || order.status === 'fulfilled') {
    await prisma.$executeRaw`
      UPDATE organization_shop_payment
      SET status = ${paymentIntent.status}, updated_at = NOW()
      WHERE order_id = ${orderId}
    `
    return
  }

  await prisma.$executeRaw`
    UPDATE organization_shop_payment
    SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ${paymentIntent.id}),
        status = ${paymentIntent.status},
        updated_at = NOW()
    WHERE order_id = ${orderId}
  `

  await prisma.$executeRaw`
    UPDATE organization_shop_order
    SET status = ${'paid'}, updated_at = NOW()
    WHERE id = ${orderId}
  `

  type PaidItemRow = {
    product_id: string | null
    quantity: number
    track_inventory: boolean | null
  }

  const itemRows = await prisma.$queryRaw<PaidItemRow[]>`
    SELECT oi.product_id, oi.quantity, p.track_inventory
    FROM organization_shop_order_item oi
    LEFT JOIN organization_shop_product p ON p.id = oi.product_id
    WHERE oi.order_id = ${orderId}
  `

  for (const item of itemRows) {
    if (!item.product_id) continue
    if (!item.track_inventory) continue
    let remaining = Number(item.quantity) || 0
    if (remaining <= 0) continue

    const inventoryRows = await prisma.$queryRaw<Array<{ warehouse_id: string; quantity: number }>>`
      SELECT warehouse_id, quantity
      FROM organization_shop_inventory
      WHERE product_id = ${item.product_id}
      ORDER BY quantity DESC
    `

    for (const inv of inventoryRows) {
      if (remaining <= 0) break
      const available = Number(inv.quantity) || 0
      if (available <= 0) continue
      const take = Math.min(remaining, available)
      remaining -= take
      await prisma.$executeRaw`
        UPDATE organization_shop_inventory
        SET quantity = GREATEST(quantity - ${take}, 0), updated_at = NOW()
        WHERE product_id = ${item.product_id} AND warehouse_id = ${inv.warehouse_id}
      `
    }
  }
}

async function handleShopPaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  const orderId = paymentIntent.metadata?.orderId
  if (!orderId) return
  await ensureOrganizationShopTables()
  await prisma.$executeRaw`
    UPDATE organization_shop_payment
    SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ${paymentIntent.id}),
        status = ${paymentIntent.status},
        updated_at = NOW()
    WHERE order_id = ${orderId}
  `
  await prisma.$executeRaw`
    UPDATE organization_shop_order
    SET status = ${'payment_failed'}, updated_at = NOW()
    WHERE id = ${orderId} AND status = ${'pending'}
  `
}

async function handleShopPaymentIntentCanceled(paymentIntent: Stripe.PaymentIntent) {
  const orderId = paymentIntent.metadata?.orderId
  if (!orderId) return
  await ensureOrganizationShopTables()
  await prisma.$executeRaw`
    UPDATE organization_shop_payment
    SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ${paymentIntent.id}),
        status = ${paymentIntent.status},
        updated_at = NOW()
    WHERE order_id = ${orderId}
  `
  await prisma.$executeRaw`
    UPDATE organization_shop_order
    SET status = ${'canceled'}, updated_at = NOW()
    WHERE id = ${orderId} AND status = ${'pending'}
  `
}

async function processStripeEvent(stripe: Stripe, event: Stripe.Event): Promise<StripeProcessResult> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      if (paymentIntent.metadata?.kind === 'shop_order') {
        await handleShopPaymentIntentSucceeded(paymentIntent)
      }
      return { type: 'ignored' }
    }
    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      if (paymentIntent.metadata?.kind === 'shop_order') {
        await handleShopPaymentIntentFailed(paymentIntent)
      }
      return { type: 'ignored' }
    }
    case 'payment_intent.canceled': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      if (paymentIntent.metadata?.kind === 'shop_order') {
        await handleShopPaymentIntentCanceled(paymentIntent)
      }
      return { type: 'ignored' }
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const kind = subscription.metadata?.kind ?? (subscription.metadata?.businessId ? 'business' : 'premium')
      if (kind === 'business') {
        const result = await syncBusinessSubscription(subscription)
        return { type: 'business', businessId: result.businessId, ownerId: result.ownerId }
      }
      const result = await syncPremiumSubscription(subscription)
      return { type: 'premium', userId: result.userId }
    }
    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(stripe, event.data.object as Stripe.Invoice)
      return { type: 'ignored' }
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
      return { type: 'ignored' }
    default:
      return { type: 'ignored' }
  }
}

registerBillingRoutes(app, {
  BILLING_PORTAL_RETURN_FALLBACK,
  BILLING_PROFILE_SELECT,
  BillingProfileSchema,
  MAX_BUSINESSES_PER_USER,
  PortalSessionSchema,
  PremiumCheckoutSchema,
  STRIPE_PRICE_PREMIUM,
  STRIPE_PUBLISHABLE_KEY,
  SetupIntentSchema,
  PaymentMethodOwnershipError,
  billingProfileIsComplete,
  buildBillingProfileIncompleteError,
  buildBillingProfileResponse,
  convertProfileToBillingDetails,
  ensurePaymentMethodForCustomer,
  ensurePriceAvailable,
  ensureStripeCustomer,
  getStripeClient,
  isPremium,
  isStripeConfigured,
  loadOwnedBusiness,
  mapProfileInputToUserData,
  missingBillingProfileFields,
  paymentIntentRequiresAction,
  paymentIntentSucceeded,
  resolveSubscriptionInvoice,
  syncPremiumSubscription,
})

registerBillingWebhookRoutes(app, {
  STRIPE_WEBHOOK_SECRET,
  StripeWebhookStatus,
  getStripeClient,
  isStripeConfigured,
  processStripeEvent,
  recordStripeWebhookEvent,
  serializeError,
  updateStripeWebhookEvent,
})

async function loadAdminUserOrReply(req: FastifyRequest, reply: FastifyReply) {
  let user: { id: string; email: string | null } | null
  try {
    user = await loadAuthenticatedUser(req)
  } catch {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }

  if (!user || !isSuperAdminEmail(user.email)) {
    reply.code(403).send({ error: 'forbidden' })
    return null
  }

  return user
}

registerAnalyticsNotificationRoutes(app, {
  EVENT_NOTIFICATION_TYPES,
  FAMILY_NOTIFICATION_TYPES,
  NOTIFICATION_SELECT,
  NotificationRespondBody,
  NotificationRespondParams,
  OrganizationSystemState: null,
  PROFILE_INVITE_NOTIFICATION_TYPES,
  TrackViewInput,
  FamilyFriendRequestRecord: null,
  FamilyFriendRequestStatus: null,
  OrgEventDefinition: null,
  createNotificationRecord,
  getStoredFamilyFriendRequests,
  getStoredFamilyFriendships,
  getStoredProfileFamilyRelationships,
  mergeOrganizationSystemStateIntoMetadata,
  notifyProfileFamilyInviteResponse,
  readBaseCommunityMeta,
  readOrganizationSystemState,
  upsertFamilyFriendRequest,
  upsertFamilyFriendship,
  upsertProfileFamilyRelationship,
  withSchemaGuard,
  writeStoredFamilyFriendRequests,
  writeStoredFamilyFriendships,
  writeStoredProfileFamilyRelationships,
})


const JobListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  provinceCode: z.string().trim().min(2).max(2).optional(),
  communitySlug: z.string().trim().min(1).max(120).optional(),
  industrySlug: z.string().trim().min(1).max(120).optional(),
  subIndustrySlug: z.string().trim().min(1).max(120).optional(),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'internship', 'temporary', 'volunteer']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const WorkApplicationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  jobId: z.string().trim().uuid().optional(),
})

const OrgJobListQuery = z.object({
  includeDrafts: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

const JobLocationInput = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    if (value === 'special:remote' || value === 'special:not_in_canada') return true
    if (!value.startsWith('community:')) return false
    const body = value.slice('community:'.length)
    const [head] = body.split('|')
    const [provinceCode, communitySlug] = (head ?? '').split(':')
    return Boolean(provinceCode?.trim()) && Boolean(communitySlug?.trim())
  }, 'invalid_location')

const CreateJobBody = z.object({
  title: z.string().trim().min(3).max(180),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'internship', 'temporary', 'volunteer']),
  salaryMin: z.number().int().min(0).max(100_000_000).optional().nullable(),
  salaryMax: z.number().int().min(0).max(100_000_000).optional().nullable(),
  salaryCurrency: z.string().trim().length(3).default('CAD'),
  salaryPeriod: z.string().trim().max(40).optional().nullable(),
  duties: z.string().trim().min(20).max(20000),
  roleRequirements: z.string().trim().min(20).max(20000).optional(),
  description: z.string().trim().max(20000).optional().nullable(),
  photoUrl: z.string().trim().url().max(2000).optional().nullable(),
  location: JobLocationInput,
  industryId: z.string().trim().min(3),
  subIndustryId: z.string().trim().min(3).optional().nullable(),
  expiresAt: z.string().datetime(),
  publish: z.boolean().default(true),
})

const UpdateJobBody = z.object({
  title: z.string().trim().min(3).max(180),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'internship', 'temporary', 'volunteer']),
  salaryMin: z.number().int().min(0).max(100_000_000).optional().nullable(),
  salaryMax: z.number().int().min(0).max(100_000_000).optional().nullable(),
  salaryCurrency: z.string().trim().length(3).default('CAD'),
  salaryPeriod: z.string().trim().max(40).optional().nullable(),
  duties: z.string().trim().min(20).max(20000),
  roleRequirements: z.string().trim().min(20).max(20000).optional(),
  description: z.string().trim().max(20000).optional().nullable(),
  photoUrl: z.string().trim().url().max(2000).optional().nullable(),
  location: JobLocationInput,
  industryId: z.string().trim().min(3),
  subIndustryId: z.string().trim().min(3).optional().nullable(),
  expiresAt: z.string().datetime(),
})

const ApplyJobBody = z.object({
  motivationHtml: z.string().trim().min(20).max(20000),
})

const UpdateCivilStatusBody = z.object({
  civicStatus: z.enum(['citizen', 'permanent_resident', 'work_permit', 'study_permit', 'unspecified']),
  workAuthorization: z.enum(['authorized', 'not_authorized', 'unspecified']).optional(),
  affirmed: z.literal(true),
})

const JobEntityId = z.string().trim().refine(
  (value) => z.string().cuid().safeParse(value).success || z.string().uuid().safeParse(value).success,
  'invalid_id',
)

const JobIdParams = z.object({
  jobId: JobEntityId,
})

const CommunityOrgJobParams = CommunityOrgSlugParams.extend({
  jobId: JobEntityId,
})

const CommunityOrgJobApplicationParams = CommunityOrgJobParams.extend({
  applicationId: JobEntityId,
})

const UpdateJobApplicationStatusBody = z.object({
  status: z.enum(['submitted', 'reviewing', 'shortlisted', 'rejected', 'hired', 'withdrawn']),
})

function parseStructuredJobLocation(raw: string): {
  locationType: 'community' | 'remote' | 'not_in_canada'
  locationProvinceCode: string | null
  locationCommunitySlug: string | null
  locationLabel: string
} {
  if (raw === 'special:remote') {
    return {
      locationType: 'remote',
      locationProvinceCode: null,
      locationCommunitySlug: null,
      locationLabel: 'Remote',
    }
  }
  if (raw === 'special:not_in_canada') {
    return {
      locationType: 'not_in_canada',
      locationProvinceCode: null,
      locationCommunitySlug: null,
      locationLabel: 'Not in Canada',
    }
  }

  const body = raw.slice('community:'.length)
  const [head, labelPart] = body.split('|')
  const [provinceCodeRaw, communitySlugRaw] = (head ?? '').split(':')
  const locationProvinceCode = (provinceCodeRaw ?? '').trim().toUpperCase()
  const locationCommunitySlug = (communitySlugRaw ?? '').trim().toLowerCase()
  const locationLabel = (labelPart ?? '').trim() || locationCommunitySlug.replace(/-/g, ' ')

  return {
    locationType: 'community',
    locationProvinceCode,
    locationCommunitySlug,
    locationLabel,
  }
}

function buildJobLocationValue(row: {
  locationType: 'community' | 'remote' | 'not_in_canada'
  locationProvinceCode: string | null
  locationCommunitySlug: string | null
  locationLabel: string | null
}) {
  if (row.locationType === 'remote') return 'special:remote'
  if (row.locationType === 'not_in_canada') return 'special:not_in_canada'
  const provinceCode = (row.locationProvinceCode ?? '').toUpperCase()
  const communitySlug = (row.locationCommunitySlug ?? '').toLowerCase()
  const label = (row.locationLabel ?? communitySlug).trim()
  return `community:${provinceCode}:${communitySlug}|${label}`
}

function parseCommunityKeyFromJobLocationValue(location: string | null | undefined): string | null {
  const trimmed = (location ?? '').trim()
  if (!trimmed.startsWith('community:')) return null
  const body = trimmed.slice('community:'.length)
  const [head] = body.split('|')
  const [provinceCode, communitySlug] = (head ?? '').split(':')
  return toCommunityKey(provinceCode, communitySlug)
}

async function resolveOrgManagerOrOwner(args: {
  province: string
  municipality: string
  slug: string
  userId: string
}) {
  const province = normalizeProvinceCode(args.province)
  if (!province) return { error: 'province_not_found' as const }
  const community = findCommunity(province, args.municipality.trim().toLowerCase())
  if (!community) return { error: 'community_not_found' as const }

  const org = await prisma.business.findFirst({
    where: {
      provinceCode: province,
      communitySlug: community.slug,
      slug: args.slug.trim().toLowerCase(),
    },
    select: { id: true, ownerId: true, name: true, slug: true, provinceCode: true, communitySlug: true },
  })
  if (!org) return { error: 'organization_not_found' as const }

  const membership = await prisma.businessMembership.findUnique({
    where: { businessId_userId: { businessId: org.id, userId: args.userId } },
    select: { role: true },
  })
  const isOwner = org.ownerId === args.userId
  const isManager = membership?.role === 'MANAGER'
  if (!isOwner && !isManager) return { error: 'forbidden' as const }

  return {
    org,
    role: isOwner ? ('OWNER' as const) : ('MANAGER' as const),
  }
}

type JobListRow = {
  id: string
  title: string
  slug: string
  status: 'draft' | 'active' | 'closed' | 'expired'
  employmentType: string
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  description: string | null
  duties: string
  roleRequirements: string
  locationType: 'community' | 'remote' | 'not_in_canada'
  photoUrl: string | null
  locationProvinceCode: string | null
  locationCommunitySlug: string | null
  locationLabel: string | null
  industryId: string
  industryName: string
  industrySlug: string
  subIndustryId: string | null
  subIndustryName: string | null
  subIndustrySlug: string | null
  applicantCount: number
  createdAt: Date
  updatedAt: Date
  publishedAt: Date | null
  expiresAt: Date
  businessId: string
  businessName: string
  businessSlug: string
  businessProvinceCode: string | null
  businessCommunitySlug: string | null
  businessLogoUrl: string | null
  businessCoverUrl: string | null
  activePromotionId: string | null
  totalImpressionsServed?: number | null
  totalViews?: number | null
  activeImpressionCap?: number | null
}

function mapJobListRow(row: JobListRow) {
  const richDescription = row.description?.trim() || row.duties
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    employmentType: row.employmentType,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryCurrency: row.salaryCurrency,
    salaryPeriod: row.salaryPeriod,
    description: richDescription,
    photoUrl: normalizeMediaUrl(row.photoUrl),
    duties: richDescription,
    roleRequirements: row.roleRequirements,
    location: buildJobLocationValue({
      locationType: row.locationType,
      locationProvinceCode: row.locationProvinceCode,
      locationCommunitySlug: row.locationCommunitySlug,
      locationLabel: row.locationLabel,
    }),
    industry: {
      id: row.industryId,
      name: row.industryName,
      slug: row.industrySlug,
      subIndustry: row.subIndustryName
        ? {
            id: row.subIndustryId,
            name: row.subIndustryName,
            slug: row.subIndustrySlug,
          }
        : null,
    },
    applicantCount: Number(row.applicantCount) || 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    sponsored: Boolean(row.activePromotionId),
    marketing: {
      impressions: Number(row.totalImpressionsServed ?? 0) || 0,
      views: Number(row.totalViews ?? row.totalImpressionsServed ?? 0) || 0,
      applications: Number(row.applicantCount) || 0,
      activePromotion: Boolean(row.activePromotionId),
      impressionCap: Number(row.activeImpressionCap ?? 1000) || 1000,
    },
    organization: {
      id: row.businessId,
      name: row.businessName,
      slug: row.businessSlug,
      provinceCode: row.businessProvinceCode,
      communitySlug: row.businessCommunitySlug,
      logoUrl: normalizeMediaUrl(row.businessLogoUrl),
      coverUrl: normalizeMediaUrl(row.businessCoverUrl),
    },
  }
}

const FeedActivityQuery = z.object({
  scope: z.enum(['all', 'friends', 'network', 'communities', 'organizations']).default('all'),
  province: z.string().optional(),
  community: z.string().optional(),
  eventLimit: z.coerce.number().int().min(1).max(12).default(6),
  jobLimit: z.coerce.number().int().min(1).max(12).default(6),
})

function buildPrioritizedFeedCommunityKeys(context: ViewerFeedContext | null) {
  if (!context) return [] as string[]
  return Array.from(
    new Set(
      [
        context.homeCommunityKey,
        ...context.nearbyCommunityKeys,
        ...context.regionalCommunityKeys,
        ...context.followedCommunityKeys,
      ].filter((key): key is string => Boolean(key)),
    ),
  )
}

function buildViewerFeedOrganizationIds(context: ViewerFeedContext | null) {
  if (!context) return [] as string[]
  return Array.from(new Set([...context.followedBusinessIds, ...context.memberBusinessIds]))
}

function resolveFeedActivityTargets(args: {
  scope: 'all' | 'friends' | 'network' | 'communities' | 'organizations'
  context: ViewerFeedContext | null
  province?: string
  community?: string
}) {
  if (args.province || args.community) {
    const normalizedProvince = normalizeProvinceCode(args.province ?? '')
    if (!normalizedProvince) return { error: 'invalid_province' as const }
    const communityRecord = findCommunity(normalizedProvince, (args.community ?? '').trim().toLowerCase())
    if (!communityRecord) return { error: 'community_not_found' as const }
    return {
      communityKeys: [toCommunityKey(communityRecord.province, communityRecord.slug)!],
      organizationIds: [] as string[],
    }
  }

  if (!args.context) {
    return { communityKeys: [] as string[], organizationIds: [] as string[] }
  }

  if (args.scope === 'organizations') {
    return {
      communityKeys: [] as string[],
      organizationIds: buildViewerFeedOrganizationIds(args.context),
    }
  }

  if (args.scope === 'communities') {
    return {
      communityKeys: buildPrioritizedFeedCommunityKeys(args.context),
      organizationIds: [] as string[],
    }
  }

  if (args.scope === 'all') {
    return {
      communityKeys: buildPrioritizedFeedCommunityKeys(args.context),
      organizationIds: buildViewerFeedOrganizationIds(args.context),
    }
  }

  return { communityKeys: [] as string[], organizationIds: [] as string[] }
}

async function loadFeedActivityEvents(args: {
  communityKeys: string[]
  organizationIds: string[]
  limit: number
}) {
  if (!args.communityKeys.length && !args.organizationIds.length) return []

  const whereOr: Prisma.BusinessWhereInput[] = []
  if (args.organizationIds.length) {
    whereOr.push({ id: { in: args.organizationIds } })
  }
  if (args.communityKeys.length) {
    whereOr.push({
      OR: args.communityKeys
        .map((key) => {
          const [provinceCode, communitySlug] = key.split(':')
          if (!provinceCode || !communitySlug) return null
          return { provinceCode, communitySlug }
        })
        .filter((value): value is { provinceCode: string; communitySlug: string } => Boolean(value)),
    })
  }

  if (!whereOr.length) return []

  const organizations: Array<{
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    logoUrl: string | null
    isVerified: boolean
    metadata: Prisma.JsonValue | null
  }> = await prisma.business.findMany({
    where: {
      status: BusinessStatus.ACTIVE,
      OR: whereOr,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      provinceCode: true,
      communitySlug: true,
      logoUrl: true,
      isVerified: true,
      metadata: true,
    },
    take: 1000,
  })

  const now = Date.now()
  const items = organizations.flatMap((org) => {
    const system = readOrganizationSystemState(org.metadata)
    return system.events
      .filter((event) => (event.status ?? 'PUBLISHED') === 'PUBLISHED' && event.access === 'PUBLIC')
      .filter((event) => {
        const startsAtMs = Date.parse(event.startsAt)
        return Number.isFinite(startsAtMs) ? startsAtMs >= now : true
      })
      .map((event) => ({
        id: event.id,
        title: event.title,
        description: event.description,
        startsAt: event.startsAt,
        primaryPhotoUrl: normalizeMediaUrl(event.primaryPhotoUrl ?? null),
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          provinceCode: org.provinceCode,
          communitySlug: org.communitySlug,
          logoUrl: normalizeMediaUrl(org.logoUrl ?? null),
          isVerified: org.isVerified,
        },
      }))
  })

  items.sort((left: (typeof items)[number], right: (typeof items)[number]) => {
    const leftTime = Date.parse(left.startsAt)
    const rightTime = Date.parse(right.startsAt)
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime
    }
    if (left.organization.name !== right.organization.name) {
      return left.organization.name.localeCompare(right.organization.name)
    }
    return left.title.localeCompare(right.title)
  })

  return items.slice(0, args.limit)
}

async function loadFeedActivityJobs(args: {
  communityKeys: string[]
  organizationIds: string[]
  limit: number
}) {
  if (!args.communityKeys.length && !args.organizationIds.length) return []

  const now = new Date()
  const communityPairs = args.communityKeys
    .map((key) => {
      const [provinceCode, communitySlug] = key.split(':')
      if (!provinceCode || !communitySlug) return null
      return { provinceCode, communitySlug }
    })
    .filter((value): value is { provinceCode: string; communitySlug: string } => Boolean(value))

  const whereOr: Prisma.JobPostingWhereInput[] = []
  if (args.organizationIds.length) {
    whereOr.push({ businessId: { in: args.organizationIds } })
  }
  if (communityPairs.length) {
    whereOr.push({
      business: {
        OR: communityPairs,
      },
    })
    whereOr.push({
      AND: [
        { locationType: 'community' },
        {
          OR: communityPairs.map((pair) => ({
            locationProvinceCode: pair.provinceCode,
            locationCommunitySlug: pair.communitySlug,
          })),
        },
      ],
    })
  }

  if (!whereOr.length) return []

  const rows: Array<{
    id: string
    title: string
    slug: string
    status: 'draft' | 'active' | 'closed' | 'expired'
    employmentType: string
    salaryMin: number | null
    salaryMax: number | null
    salaryCurrency: string | null
    salaryPeriod: string | null
    description: string | null
    photoUrl: string | null
    duties: string
    roleRequirements: string
    locationType: 'community' | 'remote' | 'not_in_canada'
    locationProvinceCode: string | null
    locationCommunitySlug: string | null
    locationLabel: string | null
    applicantCount: number
    createdAt: Date
    updatedAt: Date
    publishedAt: Date | null
    expiresAt: Date
    industry: {
      id: string
      name: string
      slug: string
    }
    subIndustry: {
      id: string
      name: string
      slug: string
    } | null
    business: {
      id: string
      name: string
      slug: string
      provinceCode: string | null
      communitySlug: string | null
      logoUrl: string | null
      coverUrl: string | null
    }
  }> = await prisma.jobPosting.findMany({
    where: {
      status: 'active',
      publishedAt: { not: null },
      expiresAt: { gt: now },
      OR: whereOr,
    },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: Math.max(args.limit * 4, 24),
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      employmentType: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryPeriod: true,
      description: true,
      photoUrl: true,
      duties: true,
      roleRequirements: true,
      locationType: true,
      locationProvinceCode: true,
      locationCommunitySlug: true,
      locationLabel: true,
      industry: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      subIndustry: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      applicantCount: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      expiresAt: true,
      business: {
        select: {
          id: true,
          name: true,
          slug: true,
          provinceCode: true,
          communitySlug: true,
          logoUrl: true,
          coverUrl: true,
        },
      },
    },
  })

  const items = rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    employmentType: row.employmentType,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryCurrency: row.salaryCurrency,
    salaryPeriod: row.salaryPeriod,
    description: row.description,
    photoUrl: normalizeMediaUrl(row.photoUrl),
    duties: row.duties,
    roleRequirements: row.roleRequirements,
    location: buildJobLocationValue({
      locationType: row.locationType,
      locationProvinceCode: row.locationProvinceCode,
      locationCommunitySlug: row.locationCommunitySlug,
      locationLabel: row.locationLabel,
    }),
    industry: {
      id: row.industry.id,
      name: row.industry.name,
      slug: row.industry.slug,
      subIndustry: row.subIndustry
        ? {
            id: row.subIndustry.id,
            name: row.subIndustry.name,
            slug: row.subIndustry.slug,
          }
        : null,
    },
    applicantCount: Number(row.applicantCount) || 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    sponsored: false,
    marketing: {
      impressions: 0,
      views: 0,
      applications: Number(row.applicantCount) || 0,
      activePromotion: false,
      impressionCap: 1000,
    },
    organization: {
      id: row.business.id,
      name: row.business.name,
      slug: row.business.slug,
      provinceCode: row.business.provinceCode,
      communitySlug: row.business.communitySlug,
      logoUrl: normalizeMediaUrl(row.business.logoUrl),
      coverUrl: normalizeMediaUrl(row.business.coverUrl),
    },
  }))

  return items.slice(0, args.limit)
}

function mixFeedActivityItems(args: {
  events: Awaited<ReturnType<typeof loadFeedActivityEvents>>
  jobs: Awaited<ReturnType<typeof loadFeedActivityJobs>>
  scope: 'all' | 'friends' | 'network' | 'communities' | 'organizations'
  context: ViewerFeedContext | null
}) {
  type FeedActivitySignal = {
    label: string
    strength: 'high' | 'medium' | 'low'
  }

  type FeedActivityScoredItem =
    | {
        kind: 'event'
        id: string
        score: number
        timestampMs: number
        organizationId: string | null
        communityKey: string | null
        signal: FeedActivitySignal
        item: Awaited<ReturnType<typeof loadFeedActivityEvents>>[number]
      }
    | {
        kind: 'job'
        id: string
        score: number
        timestampMs: number
        organizationId: string | null
        communityKey: string | null
        signal: FeedActivitySignal
        item: Awaited<ReturnType<typeof loadFeedActivityJobs>>[number]
      }

  const nowMs = Date.now()

  const resolveActivityGeoLevel = (communityKey: string | null) => {
    if (!communityKey || !args.context) return 4 as const
    if (args.context.homeCommunityKey && communityKey === args.context.homeCommunityKey) return 1 as const
    if (args.context.nearbyCommunityKeys.has(communityKey)) return 2 as const
    if (args.context.regionalCommunityKeys.has(communityKey) || args.context.followedCommunityKeys.has(communityKey)) return 3 as const
    return 4 as const
  }

  const buildGeoSignal = (communityKey: string | null, organizationId?: string | null): FeedActivitySignal => {
    if (organizationId && args.context && args.context.memberBusinessIds.has(organizationId)) {
      return { label: 'Your organization', strength: 'high' }
    }
    if (organizationId && args.context && args.context.followedBusinessIds.has(organizationId)) {
      return { label: 'Organization you follow', strength: 'medium' }
    }

    const geoLevel = resolveActivityGeoLevel(communityKey)
    if (geoLevel === 1) return { label: 'Home community', strength: 'high' }
    if (geoLevel === 2) return { label: 'Nearby community', strength: 'high' }
    if (geoLevel === 3) return { label: 'Followed community', strength: 'medium' }
    return { label: 'Across your civic network', strength: 'low' }
  }

  const activityGeoBoost = (communityKey: string | null, organizationId?: string | null) => {
    if (organizationId && args.context && args.context.memberBusinessIds.has(organizationId)) return 180
    if (organizationId && args.context && args.context.followedBusinessIds.has(organizationId)) return 120

    const geoLevel = resolveActivityGeoLevel(communityKey)
    if (args.scope === 'communities' || args.scope === 'all') {
      return ({ 1: 170, 2: 120, 3: 72, 4: 20 } as const)[geoLevel]
    }
    return ({ 1: 60, 2: 36, 3: 18, 4: 0 } as const)[geoLevel]
  }

  const scored: FeedActivityScoredItem[] = [
    ...args.events.map((event) => {
      const startsAtMs = Date.parse(event.startsAt)
      const hoursUntilStart = Number.isFinite(startsAtMs) ? Math.max(0, (startsAtMs - nowMs) / (1000 * 60 * 60)) : 48
      const communityKey = toCommunityKey(event.organization.provinceCode, event.organization.communitySlug)
      const signal = buildGeoSignal(communityKey, event.organization.id)
      const geoBoost = activityGeoBoost(communityKey, event.organization.id)
      const imminenceBoost = Math.max(0, 260 - hoursUntilStart * 4.5)
      const scopeBias = args.scope === 'communities' ? 55 : args.scope === 'organizations' ? 30 : 0
      const score = Math.max(0, imminenceBoost + geoBoost + scopeBias)
      return {
        kind: 'event' as const,
        id: event.id,
        score,
        timestampMs: Number.isFinite(startsAtMs) ? startsAtMs : nowMs,
        organizationId: event.organization.id,
        communityKey,
        signal,
        item: event,
      }
    }),
    ...args.jobs.map((job) => {
      const publishedMs = Date.parse(job.publishedAt ?? job.createdAt)
      const ageHours = Number.isFinite(publishedMs) ? Math.max(0, (nowMs - publishedMs) / (1000 * 60 * 60)) : 72
      const demandBoost = Math.log1p(Math.max(0, job.applicantCount)) * 8
      const communityKey =
        toCommunityKey(job.organization.provinceCode, job.organization.communitySlug) ??
        parseCommunityKeyFromJobLocationValue(job.location)
      const signal = buildGeoSignal(communityKey, job.organization.id)
      const geoBoost = activityGeoBoost(communityKey, job.organization.id)
      const freshnessBoost = Math.max(0, 220 - ageHours * 2.2)
      const scopeBias = args.scope === 'organizations' ? 45 : args.scope === 'communities' ? 28 : 0
      const score = Math.max(0, freshnessBoost + demandBoost + geoBoost + scopeBias)
      return {
        kind: 'job' as const,
        id: job.id,
        score,
        timestampMs: Number.isFinite(publishedMs) ? publishedMs : nowMs,
        organizationId: job.organization.id,
        communityKey,
        signal,
        item: job,
      }
    }),
  ]

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (left.kind !== right.kind) {
      if (args.scope === 'communities') return left.kind === 'event' ? -1 : 1
      if (args.scope === 'all') return left.kind === 'event' ? -1 : 1
    }
    if (right.timestampMs !== left.timestampMs) return right.timestampMs - left.timestampMs
    return right.id.localeCompare(left.id)
  })

  const pool = [...scored]
  const mixed: FeedActivityScoredItem[] = []

  while (pool.length > 0) {
    let bestIndex = 0
    let bestScore = Number.NEGATIVE_INFINITY

    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index]
      if (!candidate) continue
      const last = mixed[mixed.length - 1]
      const beforeLast = mixed[mixed.length - 2]

      let adjustedScore = candidate.score
      if (last?.kind === candidate.kind) adjustedScore -= 26
      if (last?.kind === candidate.kind && beforeLast?.kind === candidate.kind) adjustedScore -= 48
      if (last?.organizationId && candidate.organizationId && last.organizationId === candidate.organizationId) adjustedScore -= 90
      if (last?.communityKey && candidate.communityKey && last.communityKey === candidate.communityKey) adjustedScore -= 58
      if (beforeLast?.organizationId && candidate.organizationId && beforeLast.organizationId === candidate.organizationId) adjustedScore -= 30

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore
        bestIndex = index
      }
    }

    const next = pool.splice(bestIndex, 1)[0]
    if (!next) break
    mixed.push(next)
  }

  return mixed.map((entry) => ({ kind: entry.kind, signal: entry.signal, ...entry.item }))
}

// Jobs/work routes extracted to routes/jobs.ts
registerJobRoutes(app, {
  ApplyJobBody,
  CommunityOrgJobApplicationParams,
  CommunityOrgJobParams,
  CommunityOrgSlugParams,
  CreateJobBody,
  FeedActivityQuery,
  JobIdParams,
  JobListQuery,
  OrgJobListQuery,
  UpdateJobApplicationStatusBody,
  UpdateJobBody,
  WorkApplicationsQuery,
  loadFeedActivityEvents,
  loadFeedActivityJobs,
  loadViewerFeedContext,
  mapJobListRow,
  mixFeedActivityItems,
  normalizeMediaUrl,
  parseCommunityMeta,
  parseStructuredJobLocation,
  randomSlugSuffix,
  resolveFeedActivityTargets,
  resolveOrgManagerOrOwner,
  resolveUserId,
  slugifyText,
  trackJobAnalyticsEvent,
  trimSlugLength,
  withSchemaGuard,
})

// Server startup code
const start = async () => {
  try {
    validatePushEnvironment(app.log)
    await ensurePostBusinessAuthorColumn()
    await app.listen({ port: PORT, host: '0.0.0.0' })
    const pollResultsInterval = setInterval(() => {
      void dispatchDuePollResultNotifications()
    }, 60_000)
    pollResultsInterval.unref?.()
    void dispatchDuePollResultNotifications()
    console.log(`Server listening on port ${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
const skipListen = (() => {
  const raw = (process.env.API_SKIP_LISTEN || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
})()

if (!skipListen) {
  start()
}
