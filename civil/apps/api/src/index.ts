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
  buildCanadaSalesTaxCatalogResponse,
  CreatePostInput,
  calculateCausePlatformFeeCents,
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
  type CivilAiCauseDataItem,
  type CivilAiEventDataItem,
  type CivilAiJobDataItem,
  type CivilAiOrganizationDataItem,
  type CivilAiPostDataItem,
  type CivilAiTopicDataItem,
} from './civilAiSources.js'
import {
  applyCauseContributionFromPaymentIntent,
  createCauseRecord,
  ensureCivilCauseTables,
  loadCauseSummariesByPostIds,
  processAllDueCauseSubscriptions,
  type CauseSummary,
} from './causes.js'
import { createAuthViewerHelpers } from './authViewer.js'
import { applyWalletTopUpFromPaymentIntent, buildWalletMetaValue, readWalletSummary } from './walletHelpers.js'
const TrackViewInput = z.object({
  path: z.string().min(1),
  postId: z.string().optional(),
  referrer: z.string().optional(),
})

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
  causes: CivilAiCauseDataItem[]
  events: CivilAiEventDataItem[]
  jobs: CivilAiJobDataItem[]
  market: MarketSearchResultPayload[]
  organizations: CivilAiOrganizationDataItem[]
  posts: CivilAiPostDataItem[]
  topics: CivilAiTopicDataItem[]
}

type CivilAiMarketSearchScope = {
  mode: 'global' | 'community' | 'province'
  communities: Array<{ provinceCode: string; communitySlug: string }>
  provinceCodes: string[]
}

type CivilAiRetrievalPlan = {
  wantsProfile: boolean
  wantsCauses: boolean
  wantsDrive: boolean
  wantsEvents: boolean
  wantsJobs: boolean
  wantsMarket: boolean
  wantsCommunities: boolean
  wantsOrganizations: boolean
  wantsPosts: boolean
  wantsTopics: boolean
  todayOnly: boolean
  topicQuery: string
  causeLimit: number
  eventLimit: number
  jobLimit: number
  marketLimit: number
  organizationLimit: number
  postLimit: number
  topicLimit: number
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
  const nonSystemMessages = messages.filter((message): message is { role: 'user' | 'assistant'; content: string } => message.role !== 'system')
  const next: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let userTurnsSeen = 0

  for (let index = nonSystemMessages.length - 1; index >= 0; index -= 1) {
    const entry = nonSystemMessages[index]
    if (!entry) continue
    next.unshift(entry)
    if (entry.role === 'user') {
      userTurnsSeen += 1
      if (userTurnsSeen >= 5) break
    }
  }

  return next
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
  loadCauseSummariesByPostIds,
})

const loadCivilAiCommunityCauses = civilAiSources.loadCivilAiCommunityCauses
const loadCivilAiCommunityEvents = civilAiSources.loadCivilAiCommunityEvents
const loadCivilAiCommunityJobs = civilAiSources.loadCivilAiCommunityJobs
const loadCivilAiCommunityOrganizations = civilAiSources.loadCivilAiCommunityOrganizations
const loadCivilAiCommunityPosts = civilAiSources.loadCivilAiCommunityPosts
const loadCivilAiCommunityTopics = civilAiSources.loadCivilAiCommunityTopics
const toCivilAiCauseReference = civilAiSources.toCivilAiCauseReference
const toCivilAiCommunityReference = civilAiSources.toCivilAiCommunityReference
const toCivilAiEventReference = civilAiSources.toCivilAiEventReference
const toCivilAiJobReference = civilAiSources.toCivilAiJobReference
const toCivilAiMarketReference = civilAiSources.toCivilAiMarketReference
const toCivilAiOrganizationReference = civilAiSources.toCivilAiOrganizationReference
const toCivilAiPostReference = civilAiSources.toCivilAiPostReference
const toCivilAiTopicReference = civilAiSources.toCivilAiTopicReference

const civilAiPlanningHelpers = createCivilAiPlanningHelpers({
  maxReferenceCards: CIVIL_AI_MAX_REFERENCE_CARDS,
  getCivilApiBaseUrl,
  truncateCivilAiText,
  normalizeSearchTerm,
  normalizeProvinceCode,
  toCivilAiCauseReference: (item) => toCivilAiCauseReference(item as any),
  toCivilAiEventReference: (item) => toCivilAiEventReference(item as any),
  toCivilAiJobReference: (item) => toCivilAiJobReference(item as any),
  toCivilAiMarketReference: (item) => toCivilAiMarketReference(item as any),
  toCivilAiOrganizationReference: (item) => toCivilAiOrganizationReference(item as any),
  toCivilAiPostReference: (item) => toCivilAiPostReference(item as any),
  toCivilAiTopicReference: (item) => toCivilAiTopicReference(item as any),
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
import { locateFsaFromPoint } from './fsaLocator.js'
import { formatCitySummary, type ProvinceCodeLiteral } from './communityGeo.js'
import {
  sendPushToUser,
  validatePushEnvironment,
  type PushPayloadType,
} from './pushSender.js'
import {
  parseRange,
  queryDailyCounts,
  queryFollowSeries,
  queryJobAnalyticsSeries,
  queryPageViewSeries,
  startOfUtcDay,
  trackJobAnalyticsEvent,
} from './analyticsHelpers.js'
import {
  buildFamilyParentThreadId,
  buildParentFamilyThreadId,
  findPendingFamilyFriendRequest,
  getFamilyMessageThreadIdsForMember,
  getFamilyParentConversation,
  getLegacyFamilyMemberPermissionSettings,
  getLegacyFamilyMemberStoredProfileMedia,
  getLegacyFamilyMemberStoredUsername,
  getStoredFamilyFriendRequests,
  getStoredFamilyFriendships,
  getStoredFamilyMessageThreads,
  getStoredFamilyParentConversations,
  getStoredProfileFamilyRelationships,
  hasAcceptedFamilyFriendship,
  hasFamilyMessageThreadForMember,
  isParentFamilyThreadId,
  hasStoredProfileFamilyRelationshipWithUser,
  parseCommunityMeta,
  parseParentFamilyThreadId,
  upsertFamilyFriendRequest,
  upsertFamilyFriendship,
  upsertFamilyMessageThread,
  upsertFamilyParentConversation,
  upsertProfileFamilyRelationship,
  writeLegacyFamilyMemberPermissionSettings,
  writeLegacyFamilyMemberProfileMedia,
  writeLegacyFamilyMemberUsername,
  writeStoredFamilyFriendRequests,
  writeStoredFamilyFriendships,
  writeStoredFamilyMessageThreads,
  writeStoredFamilyParentConversations,
  writeStoredProfileFamilyRelationships,
} from './familyMetaHelpers.js'
import type {
  CommunityMetaPayload,
  FamilyFriendshipRecord,
  FamilyParentConversationRecord,
} from './familyMetaHelpers.js'
import { createCivilAiPlanningHelpers } from './civilAiPlanning.js'
import { createCivilAiExecutionHelpers } from './civilAiExecution.js'
import {
  COMMENT_NOTIFICATION_TYPES,
  CONNECTION_NOTIFICATION_TYPES,
  DELIVERY_NOTIFICATION_TYPES,
  EVENT_NOTIFICATION_TYPES,
  FAMILY_NOTIFICATION_TYPES,
  FRIEND_NOTIFICATION_TYPES,
  NOTIFICATION_FEED_EXCLUDED_TYPES,
  ORG_NOTIFICATION_TYPES,
  POLL_NOTIFICATION_TYPES,
  POST_NOTIFICATION_TYPES,
  PROFILE_FAMILY_RELATIONSHIP_LABELS,
  PROFILE_INVITE_NOTIFICATION_TYPES,
  createNotificationHelpers,
} from './notificationHelpers.js'
import { createFamilyConversationAccessHelpers } from './familyConversationAccessHelpers.js'
import { FAMILY_FEED_POST_TYPE, createFamilyFeedHelpers } from './familyFeedHelpers.js'
import {
  FAMILY_MEMBER_USERNAME_MAX_LENGTH,
  FAMILY_MEMBER_USERNAME_MIN_LENGTH,
  createFamilyIdentityHelpers,
} from './familyIdentityHelpers.js'
import { createFamilyCallHelpers } from './familyCallHelpers.js'
import {
  canViewerAccessEventForPreview,
  createMessageLinkPreviewHelpers,
  formatEventPreviewDate,
  formatMarketplacePrice,
  normalizeStoredLinkPreview,
  truncatePreviewText,
} from './messageLinkPreviewHelpers.js'
import { createMessageFormattingHelpers } from './messageFormattingHelpers.js'
import { createMessageThreadCallHelpers } from './messageThreadCallHelpers.js'
import { createFamilyProfileHelpers } from './familyProfileHelpers.js'
import { createSocialGraphHelpers } from './socialGraphHelpers.js'
import { createSearchHelpers } from './searchHelpers.js'
import { registerAdminAiDebugRoutes } from './routes/adminAiDebug.js'
import { registerAdminAnalyticsDetailRoutes } from './routes/adminAnalyticsDetail.js'
import { registerAddressCorrectionRoutes } from './routes/addressCorrections.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerAdminModerationRoutes } from './routes/adminModeration.js'
import { registerAdminReportingRoutes } from './routes/adminReporting.js'
import { registerAdminSystemRoutes } from './routes/adminSystem.js'
import { registerFamilyRoutes } from './routes/family.js'
import { registerMessagesCoreRoutes } from './routes/messagesCore.js'
import { registerMessagesDetailRoutes } from './routes/messagesDetail.js'
import { registerNotificationsSearchRoutes } from './routes/notificationsSearch.js'
import { registerPostInteractionRoutes } from './routes/postInteractions.js'
import { registerPostReadRoutes } from './routes/postRead.js'
import { registerCauseRoutes } from './routes/causes.js'
import { registerTopicRoutes } from './routes/topics.js'
import { registerBillingRoutes } from './routes/billing.js'
import { registerBillingWebhookRoutes } from './routes/billingWebhook.js'
import { registerJobRoutes } from './routes/jobs.js'
import { registerAnalyticsNotificationRoutes } from './routes/analyticsNotifications.js'
import { registerCommunityBootstrapRoutes } from './routes/communityBootstrap.js'
import { registerDeliveryRoutes } from './routes/delivery.js'
import { registerDriveRideRoutes } from './routes/driveRides.js'
import { registerGeographyRoutes } from './routes/geography.js'
import { registerOrgChannelRoutes } from './routes/orgChannels.js'
import { registerOrganizationCollectionRoutes } from './routes/organizationCollections.js'
import { registerOrganizationCoreRoutes } from './routes/organizationCore.js'
import { registerPoliticianRoutes } from './routes/politicians.js'
import { registerOrganizationGovernanceAdminRoutes } from './routes/organizationGovernanceAdmin.js'
import { registerOrganizationGovernanceConfigRoutes } from './routes/organizationGovernanceConfig.js'
import { registerOrganizationGovernanceEventsRoutes } from './routes/organizationGovernanceEvents.js'
import { registerOrganizationGovernanceMembershipRoutes } from './routes/organizationGovernanceMembership.js'
import { registerOrganizationGovernanceMeetingsRoutes } from './routes/organizationGovernanceMeetings.js'
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
import { registerAiTaskRoutes } from './routes/aiTasks.js'
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
      'CREATE UNIQUE INDEX IF NOT EXISTS user_post_impressions_user_post_uidx ON user_post_impressions (user_id, post_id);',
    )
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

type FamilyRelationship = 'son' | 'daughter' | 'child' | 'stepson' | 'stepdaughter' | 'foster_child' | 'ward' | 'other'
type FamilyFriendRequestStatus = 'pending' | 'accepted' | 'rejected'

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

function normalizeFamilyMemberUsernameCandidate(value: string) {
  return value.trim()
}

function buildDefaultFamilyMemberUsernameBase(firstName: string, lastName: string) {
  const base = buildHandleBase(firstName, lastName).slice(0, FAMILY_MEMBER_USERNAME_MAX_LENGTH)
  if (base.length >= FAMILY_MEMBER_USERNAME_MIN_LENGTH) return base
  return `${base}${'friend'.slice(0, Math.max(0, FAMILY_MEMBER_USERNAME_MIN_LENGTH - base.length))}`.slice(0, FAMILY_MEMBER_USERNAME_MAX_LENGTH)
}

const {
  isParentProfileEligibleForFamilyMode,
  normalizeFamilyMemberSummary,
} = createFamilyProfileHelpers({
  buildDefaultFamilyMemberUsernameBase,
  normalizeFamilyMemberUsernameCandidate,
  normalizeMediaUrl,
  parseCommunityMeta,
})

async function loadFamilyMemberSummaryForParent(memberId: string, parentId: string) {
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
}

const {
  buildFamilyFeedPostTitle,
  buildFamilyProfileRelationshipPayload,
  buildLegacyFamilyFeedMirrorKey,
  formatChildFamilyFeedPost,
  formatParentFamilyFeedPost,
  loadLatestFamilyPostAtByMember,
  loadProfileFamilyRelationshipsForRail,
  normalizeFamilyFeedImages,
  normalizeFamilyMemberDraftEditorRecord,
  normalizeFamilyMemberDraftSummary,
  syncLegacyParentFamilyFeedPosts,
} = createFamilyFeedHelpers({
  getStoredProfileFamilyRelationships,
  isSchemaOutOfDateError,
  normalizeMediaUrl,
  profileFamilyRelationshipLabels: PROFILE_FAMILY_RELATIONSHIP_LABELS as Record<string, string>,
})

async function resolveFamilyFeedTargetMember(
  authContext: ViewerAuthContext,
  requestedMemberId?: string | null,
) {
  return resolveFamilyConversationFeedTargetMember(authContext, requestedMemberId)
}

type AuthJwtPayload = {
  sub?: string
  actor?: 'user' | 'family_member'
  parentId?: string
}

const {
  buildFamilyMemberAuthMeResponse,
  buildHomeCommunitySummaryForUserId,
  isAccountSuspended,
  loadActiveAuthUserById,
  loadFamilyMemberAuthViewerById,
} = createAuthViewerHelpers({
  getLegacyFamilyMemberPermissionSettings,
  getLegacyFamilyMemberStoredProfileMedia,
  getLegacyFamilyMemberStoredUsername,
  isFamilyMemberTableMissing,
  normalizeFamilyMemberSummary,
  parseCommunityMeta,
})

const {
  buildFamilySuspensionMessage,
  findFamilyMemberByInviteCode,
  findFamilyMemberByUsername,
  generateUniqueFamilyFriendCode,
  generateUniqueFamilyMemberUsername,
  isFamilyMemberUsernameTaken,
  isValidFamilyMemberUsername,
  normalizeFamilyMemberUsernameLookup,
  parseFamilyMemberDateOfBirth,
} = createFamilyIdentityHelpers({
  getLegacyFamilyMemberStoredUsername,
  isFamilyMemberTableMissing,
  loadFamilyMemberAuthViewerById,
  parseCommunityMeta,
})

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

const politicianScrapeQueue = new Queue('politician-scrape', {
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

function buildNotificationActorFromPayload(record: NotificationRecord) {
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : null
  if (!payload) return null

  const requesterChild = payload.requesterChild && typeof payload.requesterChild === 'object' && !Array.isArray(payload.requesterChild)
    ? (payload.requesterChild as Record<string, unknown>)
    : null
  const childName =
    typeof payload.childDisplayName === 'string' && payload.childDisplayName.trim()
      ? payload.childDisplayName.trim()
      : requesterChild && typeof requesterChild.displayName === 'string' && requesterChild.displayName.trim()
        ? requesterChild.displayName.trim()
        : ''
  const childHandle =
    typeof payload.childUsername === 'string' && payload.childUsername.trim()
      ? payload.childUsername.trim()
      : typeof payload.username === 'string' && payload.username.trim()
        ? payload.username.trim()
        : requesterChild && typeof requesterChild.username === 'string' && requesterChild.username.trim()
          ? requesterChild.username.trim()
          : ''
  const childAvatarUrl =
    typeof payload.childAvatarUrl === 'string' && payload.childAvatarUrl.trim()
      ? normalizeMediaUrl(payload.childAvatarUrl)
      : requesterChild && typeof requesterChild.avatarUrl === 'string' && requesterChild.avatarUrl.trim()
        ? normalizeMediaUrl(requesterChild.avatarUrl)
        : null
  const childCoverUrl =
    typeof payload.childCoverUrl === 'string' && payload.childCoverUrl.trim()
      ? normalizeMediaUrl(payload.childCoverUrl)
      : requesterChild && typeof requesterChild.coverUrl === 'string' && requesterChild.coverUrl.trim()
        ? normalizeMediaUrl(requesterChild.coverUrl)
        : null

  if (!childName && !childHandle && !childAvatarUrl && !childCoverUrl) return null

  return {
    id: record.actorId ?? (typeof payload.memberId === 'string' ? payload.memberId : randomUUID()),
    handle: childHandle,
    name: childName || null,
    avatarUrl: childAvatarUrl,
    coverUrl: childCoverUrl,
    isPremium: false,
    isVerified: false,
  }
}

async function loadNotificationActor(record: NotificationRecord) {
  if (record.actorId) {
    const actor = await prisma.user.findUnique({ where: { id: record.actorId }, select: FRIEND_USER_SELECT })
    if (actor) return formatFriendUser(actor)

    const familyMember = await prisma.familyMember.findUnique({
      where: { id: record.actorId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        avatarUrl: true,
        coverUrl: true,
      },
    })

    if (familyMember) {
      return {
        id: familyMember.id,
        handle: typeof familyMember.username === 'string' ? familyMember.username.trim() : '',
        name: `${familyMember.firstName} ${familyMember.lastName}`.trim() || null,
        avatarUrl: normalizeMediaUrl(familyMember.avatarUrl ?? null),
        coverUrl: normalizeMediaUrl(familyMember.coverUrl ?? null),
        isPremium: false,
        isVerified: false,
      }
    }
  }

  return buildNotificationActorFromPayload(record)
}

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

const {
  createNotificationRecord,
  deliverNativePushToToken,
  dispatchNotification,
  formatDisplayNameForPush,
  isThreadMuted,
  loadUnreadMessageCount,
  notifyConnectionAcceptance,
  notifyConnectionRequest,
  notifyEventGuestSpeakerInvite,
  notifyEventSponsorInvite,
  notifyFriendAcceptance,
  notifyFriendRequest,
  notifyProfileEventInvite,
  notifyProfileFamilyInvite,
  notifyProfileFamilyInviteResponse,
  notifyProfileOrganizationInvite,
  sendMobilePushForMessageCreated,
  sendNativePushForIncomingCall,
  truncatePushBody,
} = createNotificationHelpers({
  dispatchRealtimeEvent,
  formatFriendUser,
  formatNotification,
  friendUserSelect: FRIEND_USER_SELECT,
  getStoredFamilyParentConversations,
  loadActiveAuthUserById,
  loadActiveNativePushTargets,
  loadFamilyMemberAuthViewerById,
  loadNotificationActor,
  normalizeAttachmentList: (value) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [],
  notificationSelect: NOTIFICATION_SELECT,
  pushAdminSecret: PUSH_ADMIN_SECRET,
  pushDeliveryUrl: PUSH_DELIVERY_URL,
  revokePushToken,
  sendPushToUser,
})

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

async function loadAcceptedProfileFamilyRelationshipIds(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { communityMeta: true },
  })

  const relatedUserIds = new Set(
    getStoredProfileFamilyRelationships(user?.communityMeta)
      .map((entry) => (typeof entry.relatedUserId === 'string' ? entry.relatedUserId.trim() : ''))
      .filter((value): value is string => Boolean(value && value !== userId)),
  )

  try {
    const notifications = await prisma.notification.findMany({
      where: {
        OR: [{ userId }, { actorId: userId }],
        type: { in: ['profile_family_invite', 'profile_family_invite_response'] },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
      select: {
        userId: true,
        actorId: true,
        payload: true,
      },
    })

    for (const notification of notifications) {
      const payload =
        notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
          ? (notification.payload as Record<string, unknown>)
          : null
      if (!payload) continue

      const status = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : ''
      if (status !== 'accepted') continue

      const relatedUserId = notification.userId === userId ? notification.actorId : notification.userId
      if (!relatedUserId || relatedUserId === userId) continue
      relatedUserIds.add(relatedUserId)
    }
  } catch (error) {
    console.error('accepted_profile_family_relationship_ids_load_failed', error)
  }

  return [...relatedUserIds]
}

const {
  buildFamilySponsorFriendshipId,
  createOrRefreshConnectionRequest,
  findConnectionBetween,
  findConnectionById,
  formatFamilySponsorFriendship,
  formatFriendRequest,
  formatFriendship,
  isConnectionTableMissingError,
  loadAcceptedConnectionIds,
} = createSocialGraphHelpers({
  formatFriendUser,
  notifyConnectionRequest,
})

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

const {
  extractMessageSystemMeta,
  fetchFamilyParentConversationMessages,
  fetchParentFamilyConversationMessages,
  formatFamilyMemberThreadUser,
  formatFamilyParentConversationMessage,
  formatMessage,
  formatNormalizedFamilyMemberThreadUser,
  formatParentFamilyConversationMessage,
  formatThreadParticipant,
  buildFamilyParentConversationThread,
  buildParentFamilyConversationThread,
  normalizeAttachmentList,
} = createMessageFormattingHelpers({
  buildFamilyParentThreadId,
  buildParentFamilyThreadId,
  formatFriendUser,
  normalizeFamilyMemberSummary,
  normalizeMediaUrl,
})

async function loadNormalizedFamilyMembersForParent(parentId: string) {
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

const {
  buildDirectThreadKey,
  buildFamilyDirectThreadKey,
  buildGroupThreadKey,
  clearScheduledMessageCallTimeout,
  expireMessageCallIfStale,
  finalizeMessageCall,
  findExistingExactThreadId,
  formatMessageCall,
  formatThreadBase,
  formatThreadSummaryRecord,
  isMessageCallLive,
  loadCallableMessageThreadForUser,
  loadFriendIdSet,
  loadLatestThreadCall,
  loadLiveThreadCall,
  loadMessageCallForUser,
  loadThreadForUser,
  scheduleMessageCallTimeout,
  usersAreAcceptedConnections,
  usersAreFriends,
} = createMessageThreadCallHelpers({
  dispatchRealtimeEvent,
  formatFriendUser,
  formatMessage,
  formatThreadParticipant,
  friendUserSelect: FRIEND_USER_SELECT,
  isConnectionTableMissingError,
  loadAcceptedFriendIds,
  messageCallSelect: MESSAGE_CALL_SELECT,
  messageSelect: MESSAGE_SELECT,
  threadSummaryInclude: THREAD_SUMMARY_INCLUDE,
  threadWithParticipantsInclude: THREAD_WITH_PARTICIPANTS_INCLUDE,
})

const {
  buildFamilyRtcUserId,
  formatFamilyCallSummary,
  loadFamilyCallContext,
  loadFamilyCallForMember,
  loadFamilyCallRecord,
  writeFamilyCallRecord,
} = createFamilyCallHelpers({
  formatFriendUser,
  formatNormalizedFamilyMemberThreadUser,
  loadFamilyMemberAuthViewerById,
  normalizeFamilyMemberSummary,
  redis,
})

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
  reciprocalRelationship: z.enum([
    'husband',
    'wife',
    'spouse',
    'partner',
    'common_law_partner',
    'fiance',
    'ex_husband',
    'ex_wife',
    'widowed_spouse',
    'mother',
    'father',
    'parent',
    'stepfather',
    'stepmother',
    'adoptive_father',
    'adoptive_mother',
    'foster_parent',
    'son',
    'daughter',
    'child',
    'stepson',
    'stepdaughter',
    'adopted_son',
    'adopted_daughter',
    'foster_child',
    'grandmother',
    'grandfather',
    'grandparent',
    'grandson',
    'granddaughter',
    'grandchild',
    'sister',
    'brother',
    'sibling',
    'half_brother',
    'half_sister',
    'step_brother',
    'step_sister',
    'aunt',
    'uncle',
    'cousin',
    'second_cousin',
    'niece',
    'nephew',
    'great_uncle',
    'great_aunt',
    'mother_in_law',
    'father_in_law',
    'sister_in_law',
    'brother_in_law',
    'daughter_in_law',
    'son_in_law',
    'other',
  ]).optional(),
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

const {
  searchCommunitiesForQuery,
  searchCommunityPostsForQuery,
  searchEventsForQuery,
  searchMarketListingsForQuery,
  searchOrganizationsForQuery,
  searchUsersForQuery,
} = createSearchHelpers({
  FAMILY_FEED_POST_TYPE,
  buildCivilAiMarketQueryTokens,
  buildSearchableText,
  canViewerAccessEventForPreview,
  ensureCitizenMarketplaceTables,
  ensureContentAiScanTables,
  formatEventPreviewDate,
  formatMarketplacePrice,
  formatPost: (post: unknown, options?: unknown) => formatPost(post as any, options as any),
  getCanonicalPaths: (post: unknown) => getCanonicalPaths(post as any),
  isPremium,
  isSelfVerifiedCanadianCitizen,
  normalizeMediaUrl,
  normalizeSearchTerm,
  parseCommunityMeta,
  readGalleryUrls,
  readOrganizationSystemState,
  scoreSearchTextMatch,
  stripHtmlToPlainText,
  truncatePreviewText,
})

const {
  familyMemberCanAccessMessageThread,
  markFamilyParentConversationRead,
  resolveFamilyFeedTargetMember: resolveFamilyConversationFeedTargetMember,
  resolveFamilyProfileAccess,
  resolveReadableFamilyFeedTargetMember,
  storeFamilyMessageThreadForMember,
  storeFamilyParentConversationMessage,
} = createFamilyConversationAccessHelpers({
  buildFamilyParentThreadId,
  getFamilyParentConversation,
  getStoredFamilyFriendships,
  getStoredFamilyMessageThreads,
  getStoredFamilyParentConversations,
  hasAcceptedFamilyFriendship,
  hasFamilyMessageThreadForMember,
  loadFamilyMemberAuthViewerById,
  loadNormalizedFamilyMembersForParent,
  readBaseCommunityMeta,
  upsertFamilyMessageThread,
  upsertFamilyParentConversation,
  writeStoredFamilyMessageThreads,
  writeStoredFamilyParentConversations,
})

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

async function disconnectMeetingRtcPeer(args: { roomId: string; peerId: string; reason?: string | null }) {
  if (!MEETING_RTC_SERVICE_URL) return { error: 'meeting_rtc_not_configured' as const }

  const timeoutMs =
    Number.isFinite(MEETING_RTC_REQUEST_TIMEOUT_MS) && MEETING_RTC_REQUEST_TIMEOUT_MS > 0
      ? Math.floor(MEETING_RTC_REQUEST_TIMEOUT_MS)
      : 8000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(
      `${MEETING_RTC_SERVICE_URL}/v1/rooms/${encodeURIComponent(args.roomId)}/peers/${encodeURIComponent(args.peerId)}/disconnect`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(MEETING_RTC_SERVICE_SECRET ? { 'x-meeting-rtc-secret': MEETING_RTC_SERVICE_SECRET } : {}),
        },
        body: JSON.stringify({ reason: args.reason ?? null }),
        signal: controller.signal,
      },
    )

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

    return { ok: true as const }
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === 'AbortError'
    return { error: aborted ? 'meeting_rtc_timeout' : 'meeting_rtc_unreachable' }
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
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
]

const RICH_TEXT_ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'name', 'target', 'rel'],
  th: ['colspan', 'rowspan', 'scope'],
  td: ['colspan', 'rowspan'],
  col: ['span'],
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
  hashtags: {
    select: {
      tag: true,
    },
  },
  communityTags: {
    select: {
      communitySlug: true,
    },
  },
  mentions: {
    select: {
      userId: true,
      handleSnapshot: true,
      user: {
        select: {
          id: true,
          handle: true,
          name: true,
        },
      },
    },
  },
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
      hashtags: {
        select: {
          tag: true,
        },
      },
      communityTags: {
        select: {
          communitySlug: true,
        },
      },
      mentions: {
        select: {
          userId: true,
          handleSnapshot: true,
          user: {
            select: {
              id: true,
              handle: true,
              name: true,
            },
          },
        },
      },
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

const {
  canViewerAccessPostForPreview,
  normalizeMessageLinkPath,
  resolveLinkPreview,
  resolveMessageLinkPreview,
} = createMessageLinkPreviewHelpers({
  civilPublicHost: CIVIL_PUBLIC_HOST,
  ensureCitizenMarketplaceTables,
  findCommunity,
  formatPost: (post: unknown, options?: unknown) => formatPost(post as any, options as any),
  getCanonicalPaths: (post: unknown) => {
    const canonical = getCanonicalPaths(post as any)
    return {
      community: canonical.community ?? undefined,
      user: canonical.user ?? undefined,
    }
  },
  getProvinceDisplayName,
  isPrivateOrLocalNetworkUrl,
  isPostHiddenFromViewer: (post: unknown, blockState: unknown) => isPostHiddenFromViewer(post as any, blockState as any),
  loadViewerBlockState,
  normalizeMediaUrl,
  normalizeProvinceCode,
  postInclude: POST_INCLUDE,
  readGalleryUrls,
  readOrganizationHeadline,
  readOrganizationSystemState,
  stripHtmlToPlainText,
})

type PostWithAuthor = Prisma.PostGetPayload<{ include: typeof POST_INCLUDE }>

type FormattedPost = {
  id: string
  seoSlug: string | null
  type: string
  title: string | null
  body: string
  topicSlugs: string[]
  communitySlugs: string[]
  mentionedUserIds: string[]
  mentions: Array<{
    userId: string
    handle: string
    matchedHandle: string
    name: string | null
  }>
  mediaUrl: string | null
  images: string[] | null
  linkPreview: {
    kind: string
    title: string
    description: string | null
    url: string
    imageUrl: string | null
    meta: string | null
  } | null
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
  cause: {
    draftId: string | null
    goalAmountCents: number
    stageGoals: CauseSummary['stageGoals']
    raisedAmountCents: number
    remainingAmountCents: number
    contributionCount: number
    progressPercent: number
    status: 'active' | 'funded' | 'closed'
    createdAt: Date | null
    updatedAt: Date | null
    lastContributionAt: Date | null
  } | null
  causeDraftId: string | null
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
  causeByPost: Record<string, CauseSummary>
}> {
  const uniquePostIds = Array.from(new Set(postIds)).filter(Boolean)
  if (!uniquePostIds.length) {
    return {
      reactionsByPost: {},
      pollSelectionsByPost: {},
      recentCommentsByPost: {},
      causeByPost: {},
    }
  }

  const [reactionsByPost, pollSelectionsByPost, recentCommentsByPost] = await Promise.all([
    loadViewerReactionsByPostIds(viewerId, uniquePostIds),
    loadViewerPollSelectionsByPostIds(viewerId, uniquePostIds),
    getRecentCommentsByPostIds(uniquePostIds, recentCommentLimit),
  ])

  let causeByPost: Record<string, CauseSummary> = {}
  try {
    causeByPost = await loadCauseSummariesByPostIds(uniquePostIds)
  } catch (error) {
    console.error('cause_summary_load_failed', error)
  }

  return {
    reactionsByPost,
    pollSelectionsByPost,
    recentCommentsByPost,
    causeByPost,
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
    cause?: CauseSummary | null
    now?: Date
  } = {},
): FormattedPost {
  const community = post.provinceCode && post.communitySlug ? findCommunity(post.provinceCode, post.communitySlug) : null
  const provinceName = community ? getProvinceDisplayName(community.province as any) : null
  const now = options.now ?? new Date()
  const topicRows = Array.isArray((post as any).hashtags) ? ((post as any).hashtags as Array<{ tag: string }>) : []
  const communityTagRows = Array.isArray((post as any).communityTags)
    ? ((post as any).communityTags as Array<{ communitySlug: string }>)
    : []
  const mentionRows = Array.isArray((post as any).mentions)
    ? ((post as any).mentions as Array<{ userId: string; handleSnapshot: string; user: { handle: string; name: string | null } }>)
    : []

  let sharedPost: FormattedPost | null = null
  if (
    post.sharedPost &&
    post.sharedPost.moderationStatus === ModerationStatus.VISIBLE &&
    (!post.sharedPost.business || post.sharedPost.business.moderationStatus === ModerationStatus.VISIBLE)
  ) {
    sharedPost = formatPost(post.sharedPost as any)
  }

  const causeSummary = options.cause ?? ((post as any).__cause as CauseSummary | undefined) ?? null

  return {
    id: post.id,
    seoSlug: post.seoSlug,
    type: post.type,
    title: post.title,
    body: post.type === 'article' ? sanitizeRichTextHtml(post.body) : sanitizePlainText(post.body),
    topicSlugs: topicRows.map((tag) => tag.tag),
    communitySlugs: communityTagRows.map((tag) => tag.communitySlug),
    mentionedUserIds: mentionRows.map((mention) => mention.userId),
    mentions: mentionRows.map((mention) => ({
      userId: mention.userId,
      handle: mention.user.handle,
      matchedHandle: mention.handleSnapshot,
      name: mention.user.name ?? null,
    })),
    mediaUrl: normalizeMediaUrl(post.mediaUrl ?? null),
    images: (post.images as string[] | null)?.map(normalizeMediaUrl).filter((url): url is string => url !== null) ?? null,
    linkPreview: normalizeStoredLinkPreview((post as any).linkPreview ?? null, normalizeMediaUrl),
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
    cause: causeSummary
      ? {
          draftId: causeSummary.publishedDraftId,
          goalAmountCents: causeSummary.goalAmountCents,
          stageGoals: causeSummary.stageGoals,
          raisedAmountCents: causeSummary.raisedAmountCents,
          remainingAmountCents: causeSummary.remainingAmountCents,
          contributionCount: causeSummary.contributionCount,
          progressPercent: causeSummary.progressPercent,
          status: causeSummary.status,
          createdAt: causeSummary.createdAt,
          updatedAt: causeSummary.updatedAt,
          lastContributionAt: causeSummary.lastContributionAt,
        }
      : null,
    causeDraftId: causeSummary?.publishedDraftId ?? null,
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
  const communitySegment = post.type === 'cause' ? 'causes' : 'posts'
  return {
    user: `/u/${post.author.handle}/posts/${slug}`,
    community: post.provinceCode && post.communitySlug ? `/${post.provinceCode}/${post.communitySlug}/${communitySegment}/${slug}` : null,
    legacy: `/post/${post.id}`,
  }
}

type FeedCategory = 'friends' | 'network' | 'community' | 'organizations' | 'topics' | 'events' | 'marketplace' | 'other'

type ViewerFeedContext = {
  viewerId: string
  friendIds: Set<string>
  familyRelatedUserIds: Set<string>
  connectionIds: Set<string>
  followedTopicSlugs: Set<string>
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
  topicSlugs: string[]
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
  ageHours: number
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
  topics: 18,
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

function hashFeedRankValue(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function toCommunityKey(provinceCode: string | null | undefined, communitySlug: string | null | undefined): string | null {
  if (!provinceCode || !communitySlug) return null
  const normalizedProvinceCode = normalizeProvinceCode(provinceCode) ?? provinceCode.toLowerCase()
  return `${normalizedProvinceCode}:${communitySlug.toLowerCase()}`
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
  const [friendIds, familyRelatedUserIds, connectionIds, communityFollows, topicFollows, businessFollows, businessMemberships, ownedBusinesses, userRecord] =
    await Promise.all([
      loadAcceptedFriendIds(viewerId),
      loadAcceptedProfileFamilyRelationshipIds(viewerId),
      loadAcceptedConnectionIds(viewerId),
      prisma.communityFollow.findMany({
        where: { userId: viewerId },
        select: { provinceCode: true, communitySlug: true, home: true, createdAt: true },
      }),
      prisma.topicFollow.findMany({
        where: { userId: viewerId },
        select: { topicSlug: true },
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
    familyRelatedUserIds: new Set(familyRelatedUserIds),
    connectionIds: new Set(connectionIds),
    followedTopicSlugs: new Set(topicFollows.map((row: { topicSlug: string }) => row.topicSlug)),
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

function countFollowedTopicMatches(post: Pick<FeedRankingPostRecord, 'topicSlugs'>, context: ViewerFeedContext | null) {
  if (!context?.followedTopicSlugs.size || !post.topicSlugs.length) return 0

  let matches = 0
  for (const topicSlug of post.topicSlugs) {
    if (context.followedTopicSlugs.has(topicSlug)) matches += 1
  }
  return matches
}

function resolveFeedCategory(post: FeedRankingPostRecord, scope: 'all' | 'friends' | 'network' | 'communities' | 'organizations' | 'causes', context: ViewerFeedContext | null): FeedCategory {
  if (scope === 'friends') return 'friends'
  if (scope === 'network') return 'network'
  if (scope === 'communities') return 'community'
  if (scope === 'causes') return 'community'
  if (scope === 'organizations') return 'organizations'

  const normalizedType = (post.type || '').trim().toLowerCase()
  if (normalizedType.includes('event')) return 'events'
  if (normalizedType.includes('market')) return 'marketplace'

  const followedTopicMatchCount = countFollowedTopicMatches(post, context)

  if (context) {
    if (context.friendIds.has(post.authorId) || context.familyRelatedUserIds.has(post.authorId) || post.authorId === context.viewerId) {
      return 'friends'
    }
    if (context.connectionIds.has(post.authorId)) return 'network'
    if (post.businessId && (context.followedBusinessIds.has(post.businessId) || context.memberBusinessIds.has(post.businessId))) {
      return 'organizations'
    }
  }

  if (followedTopicMatchCount > 0) return 'topics'
  if (post.businessId) return 'organizations'
  if (post.provinceCode && post.communitySlug) return 'community'
  return 'other'
}

function scoreFeedCandidate(args: {
  post: FeedRankingPostRecord
  scope: 'all' | 'friends' | 'network' | 'communities' | 'organizations' | 'causes'
  context: ViewerFeedContext | null
  impression?: { lastSeenAt: Date; impressionCount: number }
  hasReaction: boolean
  hasCommented: boolean
  lastViewedAt?: Date | null
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
  const unseenBoost = seen ? 0 : args.scope === 'all' ? 260 : 360
  const seenPenalty =
    impressionCount * (args.scope === 'all' ? 78 : 62) +
    (seen ? (args.scope === 'all' ? 120 : 90) : 0) +
    (impressionCount >= 3 ? (args.scope === 'all' ? 160 : 120) : 0)
  const maturityPenalty = args.scope === 'all'
    ? Math.max(0, ageHours - 72) * 0.28 + Math.max(0, activityAgeHours - 36) * 0.35
    : Math.max(0, ageHours - 120) * 0.14

  const geoLevel = resolveGeoLevel(args.post, args.context)
  const geoBoostByScope = args.scope === 'communities' || args.scope === 'causes' || args.scope === 'all'
    ? ({ 1: 220, 2: 130, 3: 70, 4: 18 } as const)
    : ({ 1: 60, 2: 36, 3: 18, 4: 0 } as const)
  const geoBoost = geoBoostByScope[geoLevel]
  const category = resolveFeedCategory(args.post, args.scope, args.context)
  const followedTopicMatchCount = countFollowedTopicMatches(args.post, args.context)
  const topicMatchBoost =
    args.scope === 'all' && followedTopicMatchCount > 0
      ? 110 + Math.min(3, followedTopicMatchCount) * 45 + Math.max(0, 48 - ageHours) * 2.5
      : 0

  const freshCommunityBoost =
    category === 'community'
      ? args.scope === 'communities' || args.scope === 'causes'
        ? Math.max(0, 36 - ageHours) * (geoLevel === 1 ? 18 : geoLevel <= 3 ? 12 : 6)
        : args.scope === 'all'
          ? Math.max(0, 24 - ageHours) * (geoLevel === 1 ? 15 : geoLevel <= 3 ? 10 : 4)
          : 0
      : 0

  let interactionBoost = 0
  if (args.hasReaction) interactionBoost += 55
  if (args.hasCommented) interactionBoost += 70

  const seenAgeHours = args.impression
    ? Math.max(0, args.nowMs - args.impression.lastSeenAt.getTime()) / (1000 * 60 * 60)
    : null
  const rediscoveryBoost = seenAgeHours !== null && seenAgeHours >= 96 ? Math.min(80, (seenAgeHours - 96) * 0.6) : 0

  const isViewerPost = Boolean(args.context && args.post.authorId === args.context.viewerId)
  // Keep freshly published viewer posts visible on reload instead of only through the optimistic client insert.
  const viewerAuthorBoost =
    isViewerPost && args.scope === 'all'
      ? Math.exp(-ageHours / 18) * 420
      : isViewerPost
      ? Math.exp(-ageHours / 24) * 180
      : 0
  const viewerTopicAuthorBoost =
    isViewerPost && args.scope === 'all' && followedTopicMatchCount > 0
      ? 140 + Math.min(2, followedTopicMatchCount) * 55
      : 0

  const lastViewedAtMs = args.lastViewedAt?.getTime() ?? null
  const isNewSinceLastView = lastViewedAtMs !== null && activityAtMs > lastViewedAtMs
  const hoursSinceLastViewed = lastViewedAtMs !== null ? Math.max(0, args.nowMs - lastViewedAtMs) / (1000 * 60 * 60) : null
  const freshSinceLastViewBoost = isNewSinceLastView
    ? args.scope === 'all'
      ? 420 + Math.max(0, 48 - ageHours) * 9
      : 520 + Math.max(0, 72 - ageHours) * 10
    : 0
  const staleSeenSuppression = seen && ageHours >= 24 ? Math.min(220, Math.max(0, ageHours - 24) * 4) : 0
  const dormantFeedFreshnessBoost = !seen && hoursSinceLastViewed !== null && hoursSinceLastViewed >= 6 ? Math.min(120, hoursSinceLastViewed * 6) : 0

  return (
    unseenBoost +
    freshnessScore +
    activityScore +
    engagementScore +
    geoBoost +
    topicMatchBoost +
    freshCommunityBoost +
    interactionBoost +
    rediscoveryBoost +
    viewerAuthorBoost +
    viewerTopicAuthorBoost +
    freshSinceLastViewBoost +
    dormantFeedFreshnessBoost -
    seenPenalty -
    staleSeenSuppression -
    maturityPenalty
  )
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

type FeedScopeMode = 'all' | 'friends' | 'network' | 'communities' | 'organizations' | 'causes'

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
  lastViewedAt?: Date | null
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
      topicSlugs: Array.isArray(post.hashtags) ? post.hashtags.map((tag) => tag.tag) : [],
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
      lastViewedAt: args.lastViewedAt ?? null,
      nowMs,
    })
    const hotPreferenceBoost =
      args.sortMode === 'hot'
        ? Math.log1p(Math.max(0, rankingPost.hotScore)) * 24 +
          Math.log1p(Math.max(0, rankingPost.commentCount)) * 14 +
          Math.log1p(Math.max(0, rankingPost.reactionTotal)) * 10
        : 0
    const ageHours = Math.max(0, nowMs - rankingPost.createdAt.getTime()) / (1000 * 60 * 60)
    const varietyAmplitude =
      args.sortMode === 'hot'
        ? args.scope === 'communities'
          ? 36
          : args.scope === 'all'
            ? 26
            : 14
        : 0
    const freshnessFactor = Math.max(0.12, 1 - Math.min(ageHours, 72) / 72)
    const varietyJitter = ((hashFeedRankValue(`${rankingSeed}:${post.id}`) - 0.5) * 2) * varietyAmplitude * freshnessFactor

    return {
      postId: post.id,
      score: baseScore + hotPreferenceBoost + varietyJitter,
      createdAtMs: rankingPost.createdAt.getTime(),
      ageHours,
      category: resolveFeedCategory(rankingPost, args.scope, args.context),
    }
  })

  rankedCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.ageHours !== b.ageHours) return a.ageHours - b.ageHours
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

registerCommunityBootstrapRoutes(app, {
  COMMUNITY_FOLLOW_TARGET,
  POST_INCLUDE,
  formatPost,
  loadViewerPostFormattingContext,
  parseCommunityMeta,
  registerCommunityRoute,
})

registerAddressCorrectionRoutes(app)
registerGeographyRoutes(app)

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
  POST_NOTIFICATION_TYPES,
  buildCommentTree,
  buildPostSlugBase,
  canViewerAccessFamilyAudiencePost,
  canViewerAccessPostForPreview,
  createNotificationRecord,
  createCauseRecord,
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
  resolveLinkPreview,
  readWalletSummary,
  sanitizePlainText,
  sanitizeRichTextHtml,
  stripHtmlToPlainText,
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
  loadCauseSummariesByPostIds,
  loadViewerFeedContext,
  loadViewerPollSelectionsByPostIds,
  loadViewerPostFormattingContext,
  parseFeedRankCursor,
  rankFeedPosts,
  recordUserPostImpressions,
  resolveLinkPreview,
  stripHtmlToPlainText,
  syncLegacyParentFamilyFeedPosts,
  withSchemaGuard,
})

registerCauseRoutes(app, {
  POST_INCLUDE,
  STRIPE_PUBLISHABLE_KEY,
  applyVisibleModerationFiltersToPostWhere,
  buildPostSlugBase,
  buildWalletMetaValue,
  createNotificationRecord,
  ensureCivilCauseTables,
  ensureStripeCustomer,
  enqueueContentAiScanForPost,
  formatPost,
  generateUniquePostSlug,
  getStripeClient,
  isAccountSuspended,
  isPremium,
  isSelfVerifiedCanadianCitizen,
  isStripeConfigured,
  loadCauseSummariesByPostIds,
  loadViewerBlockState,
  loadViewerFeedContext,
  loadViewerPostFormattingContext,
  parseCommunityMeta,
  readBaseCommunityMeta,
  readWalletSummary,
  resolveLinkPreview,
  sanitizeRichTextHtml,
  stripHtmlToPlainText,
  withSchemaGuard,
})

registerTopicRoutes(app, {
  FAMILY_FEED_POST_TYPE,
  POST_INCLUDE,
  applyVisibleModerationFiltersToPostWhere,
  formatPost,
  loadViewerBlockState,
  loadViewerPostFormattingContext,
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
  readBaseCommunityMeta,
  readOrganizationSystemState,
  resolveUserId,
  withSchemaGuard,
  writeStoredProfileFamilyRelationships,
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
  getStoredProfileFamilyRelationships,
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
  PROFILE_INVITE_NOTIFICATION_TYPES,
  profileFamilyRelationshipLabels: PROFILE_FAMILY_RELATIONSHIP_LABELS as Record<string, string>,
  resolveFamilyProfileAccess,
  withSchemaGuard,
})

registerAuthRoutes(app, {
  CIVIL_PUBLIC_HOST,
  RegisterInputApi,
  STRIPE_PUBLISHABLE_KEY,
  ensureCitizenMarketplaceTables,
  ensureStripeCustomer,
  getUpdateCivilStatusBody: () => UpdateCivilStatusBody,
  getUpdateWalletBody: () => UpdateWalletBody,
  getStripeClient,
  applyOrganizationInviteRegistration,
  buildFamilyMemberAuthMeResponse,
  buildHomeCommunitySummaryForUserId,
  generateUniqueHandle: (baseHandle) => generateUniqueHandle(baseHandle, prisma),
  getStoredProfileFamilyRelationships,
  isAccountSuspended,
  isFamilyMemberTableMissing,
  isStripeConfigured,
  isPremium,
  isSelfVerifiedCanadianCitizen,
  loadFamilyMemberAuthViewerById,
  normalizeUserMedia,
  parseCommunityMeta,
  readBaseCommunityMeta,
  withSchemaGuard,
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
  loadCivilAiCommunityCauses,
  loadCivilAiCommunityEvents,
  loadCivilAiCommunityJobs,
  loadCivilAiCommunityOrganizations,
  loadCivilAiCommunityPosts: (communityId, limit, query, viewerFeedContext) => loadCivilAiCommunityPosts(communityId, limit, query, viewerFeedContext as any) as any,
  loadCivilAiCommunityTopics,
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
  toCivilAiCauseReference: (item) => toCivilAiCauseReference(item as any),
  toCivilAiCommunityReference: (community) => toCivilAiCommunityReference(community as any),
  toCivilAiEventReference: (item) => toCivilAiEventReference(item as any),
  toCivilAiJobReference: (item) => toCivilAiJobReference(item as any),
  toCivilAiMarketReference: (item) => toCivilAiMarketReference(item as any),
  toCivilAiOrganizationReference: (item) => toCivilAiOrganizationReference(item as any),
  toCivilAiPostReference: (item) => toCivilAiPostReference(item as any),
  toCivilAiTopicReference: (item) => toCivilAiTopicReference(item as any),
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
  loadCivilAiCommunityCauses,
  loadCivilAiCommunityEvents,
  loadCivilAiCommunityJobs,
  loadCivilAiCommunityOrganizations,
  loadCivilAiCommunityPosts: (communityId, limit, query, viewerFeedContext) => loadCivilAiCommunityPosts(communityId, limit, query, viewerFeedContext as any),
  loadCivilAiCommunityTopics,
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
  toCivilAiCauseReference: (item) => toCivilAiCauseReference(item as any),
  toCivilAiCommunityReference: (community) => toCivilAiCommunityReference(community as any),
  toCivilAiEventReference: (item) => toCivilAiEventReference(item as any),
  toCivilAiJobReference: (item) => toCivilAiJobReference(item as any),
  toCivilAiMarketReference: (item) => toCivilAiMarketReference(item as any),
  toCivilAiOrganizationReference: (item) => toCivilAiOrganizationReference(item as any),
  toCivilAiPostReference: (item) => toCivilAiPostReference(item as any),
  toCivilAiTopicReference: (item) => toCivilAiTopicReference(item as any),
  withSchemaGuard,
})

registerAiTaskRoutes(app, {
  buildCivilAiPromptInput,
  callCivilAiServerWithPathFallback: (args) => callCivilAiServerWithPathFallback(args as any),
  extractCivilAiMessageContent,
  loadViewerAuthContext,
  resolveCivilAiModel,
  resolveCivilAiServer,
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

registerPoliticianRoutes(app, {
  loadAdminUserOrReply,
  politicianScrapeQueue,
})

registerNotificationsSearchRoutes(app, {
  CIVIL_PUBLIC_HOST,
  NOTIFICATION_CHANNEL_PREFIX,
  NOTIFICATION_FEED_EXCLUDED_TYPES,
  REDIS_URL,
  clearUserRealtimeOnline,
  formatFriendUser,
  formatNotification,
  loadNotificationActor,
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
  canViewerAccessFamilyAudiencePost,
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
  loadAcceptedProfileFamilyRelationshipIds,
  loadCallableMessageThreadForUser,
  loadFriendIdSet,
  loadLiveThreadCall,
  loadMessageCallForUser,
  loadParentFamilyConversationThreads,
  loadViewerAuthContext,
  normalizeMessageLinkPath,
  resolveLinkPreview,
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
  syncLegacyParentFamilyFeedPosts,
  updateFamilyMemberSummaryForParent,
  upsertFamilyFriendRequest,
  withSchemaGuard,
  writeLegacyFamilyMemberPermissionSettings,
  writeLegacyFamilyMemberUsername,
  writeStoredFamilyFriendRequests,
})

registerUserConnectionsRoutes(app, {
  formatFriendUser,
  getStoredProfileFamilyRelationships,
  isFamilyMemberTableMissing,
  loadAcceptedFriendIds,
  loadViewerAuthContext,
  normalizeFamilyMemberSummary,
  normalizeMediaUrl,
  normalizeUserMedia,
  profileFamilyRelationshipLabels: PROFILE_FAMILY_RELATIONSHIP_LABELS as Record<string, string>,
  withSchemaGuard,
})

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
        ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_order
        ADD COLUMN IF NOT EXISTS civil_fee_cents INTEGER NOT NULL DEFAULT 0;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_order
        ADD COLUMN IF NOT EXISTS stripe_fee_cents INTEGER NOT NULL DEFAULT 0;
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
          wallet_transaction_id TEXT,
          payment_method TEXT NOT NULL DEFAULT 'credit_card',
          status TEXT NOT NULL DEFAULT 'requires_payment_method',
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'CAD',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_payment
        ADD COLUMN IF NOT EXISTS wallet_transaction_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_payment
        ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'credit_card';
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
        ADD COLUMN IF NOT EXISTS listing_section TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS listing_category TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE organization_shop_product
        ADD COLUMN IF NOT EXISTS listing_subcategory TEXT;
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
          listing_section TEXT,
          listing_category TEXT,
          listing_subcategory TEXT,
          listing_detail TEXT,
          food_safety_classification TEXT,
          food_ingredients TEXT,
          food_preparation_location TEXT,
          food_storage_method TEXT,
          food_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          food_expiry_date TEXT,
          food_handling_instructions TEXT,
          payment_types JSONB NOT NULL DEFAULT '[]'::jsonb,
          willing_to_deliver BOOLEAN NOT NULL DEFAULT FALSE,
          delivery_options JSONB NOT NULL DEFAULT '{}'::jsonb,
          e_transfer_email TEXT,
          civil_pay_status TEXT,
          civil_pay_transaction_id TEXT,
          civil_pay_paid_by_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          civil_pay_amount_cents INTEGER,
          civil_pay_fee_cents INTEGER,
          civil_pay_paid_at TIMESTAMPTZ,
          status TEXT NOT NULL DEFAULT 'draft',
          selected_buyer_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          sale_expires_at TIMESTAMPTZ,
          buyer_picked_up_at TIMESTAMPTZ,
          seller_picked_up_at TIMESTAMPTZ,
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
        ADD COLUMN IF NOT EXISTS listing_section TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS listing_category TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS listing_subcategory TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS listing_detail TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS food_safety_classification TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS food_ingredients TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS food_preparation_location TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS food_storage_method TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS food_tags JSONB NOT NULL DEFAULT '[]'::jsonb;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS food_expiry_date TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS food_handling_instructions TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'visible';
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS civil_pay_status TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS civil_pay_transaction_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS civil_pay_paid_by_user_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS civil_pay_amount_cents INTEGER;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS civil_pay_fee_cents INTEGER;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS civil_pay_paid_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS pickup_completed_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS pickup_completed_by_user_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS buyer_picked_up_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS seller_picked_up_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS selected_payment_type TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_listing
        ADD COLUMN IF NOT EXISTS selected_payment_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_scope_idx
        ON citizen_market_listing (listing_province_code, listing_community_slug, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_category_idx
        ON citizen_market_listing (listing_section, listing_category, listing_subcategory, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_pickup_pending_idx
        ON citizen_market_listing (status, pickup_completed_at, seller_user_id, selected_buyer_user_id);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_listing_civil_pay_status_idx
        ON citizen_market_listing (civil_pay_status, civil_pay_paid_at DESC);
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

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS citizen_market_delivery_contract (
          id TEXT PRIMARY KEY,
          listing_id TEXT NOT NULL REFERENCES citizen_market_listing(id) ON DELETE CASCADE,
          seller_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          buyer_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          driver_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'open',
          pickup_instructions TEXT,
          item_traits JSONB NOT NULL DEFAULT '[]'::jsonb,
          bid_driver_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          bid_amount_cents INTEGER,
          bid_requested_at TIMESTAMPTZ,
          bid_responded_at TIMESTAMPTZ,
          accepted_at TIMESTAMPTZ,
          picked_up_at TIMESTAMPTZ,
          estimated_delivery_at TIMESTAMPTZ,
          delivered_at TIMESTAMPTZ,
          delivery_photo_url TEXT,
          group_thread_id TEXT REFERENCES "MessageThread"(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS pickup_instructions TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS item_traits JSONB NOT NULL DEFAULT '[]'::jsonb;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS bid_driver_user_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS bid_amount_cents INTEGER;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS bid_per_km_fee_cents INTEGER;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS bid_requested_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS bid_responded_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS delivery_photo_url TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_market_delivery_contract
        ADD COLUMN IF NOT EXISTS group_thread_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS citizen_market_delivery_contract_listing_uniq
        ON citizen_market_delivery_contract (listing_id);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_delivery_contract_status_idx
        ON citizen_market_delivery_contract (status, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_delivery_contract_driver_idx
        ON citizen_market_delivery_contract (driver_user_id, status, updated_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_market_delivery_contract_bid_driver_idx
        ON citizen_market_delivery_contract (bid_driver_user_id, status, updated_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS citizen_drive_ride_request (
          id TEXT PRIMARY KEY,
          requester_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'open',
          recurrence TEXT NOT NULL DEFAULT 'once',
          pickup_address JSONB NOT NULL DEFAULT '{}'::jsonb,
          pickup_city TEXT,
          pickup_province TEXT,
          pickup_postal_code TEXT,
          pickup_latitude DOUBLE PRECISION,
          pickup_longitude DOUBLE PRECISION,
          dropoff_address JSONB NOT NULL DEFAULT '{}'::jsonb,
          dropoff_city TEXT,
          dropoff_province TEXT,
          dropoff_postal_code TEXT,
          dropoff_latitude DOUBLE PRECISION,
          dropoff_longitude DOUBLE PRECISION,
          pickup_at TIMESTAMPTZ NOT NULL,
          dropoff_at TIMESTAMPTZ NOT NULL,
          route_distance_km DOUBLE PRECISION NOT NULL DEFAULT 0,
          fuel_charge_cents INTEGER NOT NULL DEFAULT 0,
          driver_fee_cents INTEGER NOT NULL DEFAULT 1000,
          total_cost_cents INTEGER NOT NULL DEFAULT 1000,
          bid_driver_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          bid_amount_cents INTEGER,
          bid_per_km_fee_cents INTEGER,
          bid_requested_at TIMESTAMPTZ,
          bid_responded_at TIMESTAMPTZ,
          driver_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          contract_started_at TIMESTAMPTZ,
          driver_location_latitude DOUBLE PRECISION,
          driver_location_longitude DOUBLE PRECISION,
          driver_location_recorded_at TIMESTAMPTZ,
          requester_location_latitude DOUBLE PRECISION,
          requester_location_longitude DOUBLE PRECISION,
          requester_location_recorded_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS pickup_address JSONB NOT NULL DEFAULT '{}'::jsonb;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS pickup_city TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS pickup_province TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS pickup_postal_code TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS pickup_latitude DOUBLE PRECISION;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS pickup_longitude DOUBLE PRECISION;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS dropoff_address JSONB NOT NULL DEFAULT '{}'::jsonb;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS dropoff_city TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS dropoff_province TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS dropoff_postal_code TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS dropoff_latitude DOUBLE PRECISION;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS dropoff_longitude DOUBLE PRECISION;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS pickup_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS dropoff_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS route_distance_km DOUBLE PRECISION NOT NULL DEFAULT 0;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS fuel_charge_cents INTEGER NOT NULL DEFAULT 0;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS driver_fee_cents INTEGER NOT NULL DEFAULT 1000;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS total_cost_cents INTEGER NOT NULL DEFAULT 1000;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS bid_driver_user_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS bid_amount_cents INTEGER;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS bid_per_km_fee_cents INTEGER;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS bid_requested_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS bid_responded_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS driver_user_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS contract_started_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS driver_location_latitude DOUBLE PRECISION;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS driver_location_longitude DOUBLE PRECISION;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS driver_location_recorded_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS requester_location_latitude DOUBLE PRECISION;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS requester_location_longitude DOUBLE PRECISION;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS requester_location_recorded_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS accepted_offer_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS accepted_offer_amount_cents INTEGER;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS accepted_offer_per_km_fee_cents INTEGER;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS accepted_offer_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS escrow_status TEXT NOT NULL DEFAULT 'none';
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS wallet_transaction_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS completion_requested_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS completion_confirmation_due_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS rider_confirmed_complete_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS rider_reported_issue_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS auto_completed_at TIMESTAMPTZ;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_request
        ADD COLUMN IF NOT EXISTS support_request_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_drive_ride_request_status_idx
        ON citizen_drive_ride_request (status, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_drive_ride_request_requester_idx
        ON citizen_drive_ride_request (requester_user_id, created_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_drive_ride_request_bid_idx
        ON citizen_drive_ride_request (bid_driver_user_id, status, updated_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_drive_ride_request_driver_idx
        ON citizen_drive_ride_request (driver_user_id, status, updated_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_drive_ride_request_completion_due_idx
        ON citizen_drive_ride_request (escrow_status, completion_confirmation_due_at);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS citizen_drive_ride_offer (
          id TEXT PRIMARY KEY,
          ride_request_id TEXT NOT NULL REFERENCES citizen_drive_ride_request(id) ON DELETE CASCADE,
          driver_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending',
          amount_cents INTEGER NOT NULL DEFAULT 0,
          per_km_fee_cents INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_offer
        ADD COLUMN IF NOT EXISTS ride_request_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_offer
        ADD COLUMN IF NOT EXISTS driver_user_id TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_offer
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_offer
        ADD COLUMN IF NOT EXISTS amount_cents INTEGER NOT NULL DEFAULT 0;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_offer
        ADD COLUMN IF NOT EXISTS per_km_fee_cents INTEGER NOT NULL DEFAULT 0;
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_offer
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE citizen_drive_ride_offer
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      `)

      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS citizen_drive_ride_offer_request_driver_uniq
        ON citizen_drive_ride_offer (ride_request_id, driver_user_id);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_drive_ride_offer_request_idx
        ON citizen_drive_ride_offer (ride_request_id, status, updated_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS citizen_drive_ride_offer_driver_idx
        ON citizen_drive_ride_offer (driver_user_id, status, updated_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        INSERT INTO citizen_drive_ride_offer (
          id,
          ride_request_id,
          driver_user_id,
          status,
          amount_cents,
          per_km_fee_cents,
          created_at,
          updated_at
        )
        SELECT
          r.id || ':' || r.bid_driver_user_id,
          r.id,
          r.bid_driver_user_id,
          'pending',
          COALESCE(r.bid_amount_cents, 0),
          COALESCE(r.bid_per_km_fee_cents, 0),
          COALESCE(r.bid_requested_at, r.updated_at, r.created_at, NOW()),
          COALESCE(r.bid_requested_at, r.updated_at, r.created_at, NOW())
        FROM citizen_drive_ride_request r
        WHERE r.bid_driver_user_id IS NOT NULL
          AND COALESCE(r.bid_amount_cents, 0) > 0
        ON CONFLICT (ride_request_id, driver_user_id) DO UPDATE
        SET amount_cents = EXCLUDED.amount_cents,
            per_km_fee_cents = EXCLUDED.per_km_fee_cents,
            updated_at = GREATEST(citizen_drive_ride_offer.updated_at, EXCLUDED.updated_at);
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

const OrganizationDirectoryTypeValues = [
  'INDIVIDUAL',
  'SOLE_PROPRIETORSHIP',
  'CORPORATION',
  'NON_PROFIT',
  'CHARITY',
  'RELIGIOUS_ORGANIZATION',
  'GOVERNMENT',
  'COMMUNITY_GROUP',
] as const

type OrganizationDirectoryType = (typeof OrganizationDirectoryTypeValues)[number]

const OrganizationCategorySpecializationMap = {
  TRADES: [
    'ELECTRICIAN',
    'PLUMBER',
    'CARPENTER',
    'HVAC_TECHNICIAN',
    'ROOFER',
    'PAINTER',
    'DRYWALL_INSTALLER',
    'FLOORING_INSTALLER',
    'WELDER',
    'GENERAL_CONTRACTOR',
    'HANDYMAN',
    'APPLIANCE_REPAIR_TECHNICIAN',
    'ELEVATOR_TECHNICIAN',
    'MASONRY_BRICKLAYER',
  ],
  CONSTRUCTION_RENOVATION: [
    'HOME_BUILDER',
    'RENOVATION_SPECIALIST',
    'DEMOLITION',
    'FRAMING',
    'CONCRETE_WORK',
    'EXCAVATION',
    'LANDSCAPING',
    'FENCE_DECK_BUILDER',
    'POOL_INSTALLATION',
    'CABINET_MAKER',
  ],
  AUTOMOTIVE_MECHANICAL: [
    'AUTO_REPAIR_MECHANIC',
    'MOBILE_MECHANIC',
    'AUTO_BODY_REPAIR',
    'TIRE_SERVICES',
    'OIL_CHANGE_SERVICES',
    'CAR_DETAILING',
    'VEHICLE_INSPECTION',
    'SMALL_ENGINE_REPAIR',
    'DIESEL_MECHANIC',
  ],
  TRANSPORTATION_DELIVERY: [
    'COURIER_DELIVERY_DRIVER',
    'MOVING_SERVICES',
    'TRUCKING_FREIGHT',
    'RIDESHARE_DRIVER',
    'PERSONAL_DRIVER_CHAUFFEUR',
    'LOGISTICS_COORDINATION',
    'TOWING_SERVICES',
  ],
  FOOD_CATERING: [
    'CATERING_SERVICES',
    'PRIVATE_CHEF',
    'MEAL_PREP_SERVICES',
    'BAKERY',
    'FOOD_TRUCK',
    'RESTAURANT',
    'BUTCHER',
    'MEAL_DELIVERY',
    'FARMERS_MARKET_VENDOR',
  ],
  AGRICULTURE_FARMING: [
    'VEGETABLE_FARMING',
    'FRUIT_FARMING',
    'LIVESTOCK_FARMING',
    'DAIRY_PRODUCTION',
    'POULTRY_FARMING',
    'GREENHOUSE_PRODUCTION',
    'BEEKEEPING',
    'AQUACULTURE',
    'ORGANIC_FARMING',
  ],
  RETAIL_ECOMMERCE: [
    'GENERAL_RETAIL',
    'ONLINE_STORE',
    'WHOLESALE_DISTRIBUTOR',
    'DROPSHIPPING',
    'SPECIALTY_SHOP',
    'CONVENIENCE_STORE',
    'MARKET_VENDOR',
  ],
  HEALTH_BEAUTY: [
    'MASSAGE_THERAPIST',
    'HAIR_STYLIST',
    'BARBER',
    'ESTHETICIAN',
    'NAIL_TECHNICIAN',
    'MAKEUP_ARTIST',
    'SPA_SERVICES',
    'TATTOO_ARTIST',
    'PIERCING_SERVICES',
  ],
  HEALTHCARE: [
    'NURSE',
    'PERSONAL_SUPPORT_WORKER',
    'PHYSIOTHERAPIST',
    'CHIROPRACTOR',
    'OCCUPATIONAL_THERAPIST',
    'MENTAL_HEALTH_COUNSELOR',
    'HOME_CARE_PROVIDER',
    'MEDICAL_CLINIC',
  ],
  FITNESS_SPORTS: [
    'PERSONAL_TRAINER',
    'FITNESS_COACH',
    'YOGA_INSTRUCTOR',
    'MARTIAL_ARTS_INSTRUCTOR',
    'SPORTS_COACH',
    'GYM_FITNESS_FACILITY',
  ],
  EDUCATION_TUTORING: [
    'TUTOR',
    'LANGUAGE_INSTRUCTOR',
    'MUSIC_TEACHER',
    'DRIVING_INSTRUCTOR',
    'EDUCATIONAL_CONSULTANT',
    'PRIVATE_SCHOOL',
    'ONLINE_COURSE_PROVIDER',
  ],
  CHILDCARE_FAMILY: [
    'BABYSITTER',
    'NANNY',
    'DAYCARE_PROVIDER',
    'FAMILY_SUPPORT_SERVICES',
    'ELDER_CARE',
  ],
  CLEANING_MAINTENANCE: [
    'RESIDENTIAL_CLEANING',
    'COMMERCIAL_CLEANING',
    'WINDOW_CLEANING',
    'CARPET_CLEANING',
    'PRESSURE_WASHING',
    'JANITORIAL_SERVICES',
    'PROPERTY_MAINTENANCE',
  ],
  PROFESSIONAL_SERVICES: [
    'ACCOUNTANT',
    'BOOKKEEPER',
    'LAWYER',
    'PARALEGAL',
    'CONSULTANT',
    'BUSINESS_ADVISOR',
    'INSURANCE_AGENT',
    'FINANCIAL_ADVISOR',
  ],
  TECHNOLOGY_IT: [
    'SOFTWARE_DEVELOPER',
    'WEB_DEVELOPER',
    'MOBILE_APP_DEVELOPER',
    'IT_SUPPORT',
    'NETWORK_TECHNICIAN',
    'CYBERSECURITY_SPECIALIST',
    'AI_DEVELOPER',
    'DATA_ANALYST',
  ],
  MEDIA_CREATIVE: [
    'GRAPHIC_DESIGNER',
    'WEB_DESIGNER',
    'PHOTOGRAPHER',
    'VIDEOGRAPHER',
    'VIDEO_EDITOR',
    'ANIMATOR',
    'CONTENT_CREATOR',
    'COPYWRITER',
  ],
  MARKETING_SALES: [
    'DIGITAL_MARKETING',
    'SEO_SPECIALIST',
    'SOCIAL_MEDIA_MANAGER',
    'ADVERTISING_SPECIALIST',
    'SALES_REPRESENTATIVE',
    'LEAD_GENERATION',
  ],
  EVENTS_ENTERTAINMENT: [
    'EVENT_PLANNER',
    'DJ',
    'MUSICIAN',
    'ENTERTAINER',
    'WEDDING_SERVICES',
    'PARTY_RENTALS',
  ],
  REAL_ESTATE_PROPERTY: [
    'REAL_ESTATE_AGENT',
    'PROPERTY_MANAGER',
    'HOME_INSPECTOR',
    'MORTGAGE_BROKER',
    'APPRAISER',
  ],
  TRAVEL_HOSPITALITY: [
    'TRAVEL_AGENT',
    'TOUR_GUIDE',
    'HOTEL_ACCOMMODATION',
    'SHORT_TERM_RENTAL_HOST',
  ],
  SECURITY_SAFETY: [
    'SECURITY_GUARD',
    'PRIVATE_INVESTIGATOR',
    'ALARM_SYSTEMS',
    'FIRE_SAFETY_SERVICES',
  ],
  GOVERNMENT_PUBLIC_SERVICES: [
    'MUNICIPAL_SERVICES',
    'PROVINCIAL_SERVICES',
    'FEDERAL_SERVICES',
    'PUBLIC_ADMINISTRATION',
  ],
  NON_PROFIT_COMMUNITY: [
    'COMMUNITY_ORGANIZATION',
    'ADVOCACY_GROUP',
    'VOLUNTEER_ORGANIZATION',
    'FOOD_BANK',
    'SHELTER_SERVICES',
  ],
  RELIGIOUS: ['CHURCH', 'MOSQUE', 'TEMPLE', 'SYNAGOGUE', 'FAITH_BASED_SERVICES'],
  ARTS_CULTURE: ['ARTIST', 'GALLERY', 'CULTURAL_ORGANIZATION', 'MUSEUM', 'THEATER'],
  MANUFACTURING_INDUSTRIAL: ['FABRICATION', 'ASSEMBLY', 'PACKAGING', 'CNC_MACHINING', 'THREE_D_PRINTING', 'TEXTILE_PRODUCTION'],
  OTHER: ['OTHER_SERVICES', 'MISCELLANEOUS'],
} as const

const OrganizationCategoryValues = Object.keys(OrganizationCategorySpecializationMap) as Array<keyof typeof OrganizationCategorySpecializationMap>
type OrganizationCategory = (typeof OrganizationCategoryValues)[number]

const OrganizationSpecializationValues = Object.values(OrganizationCategorySpecializationMap).flat() as Array<
  (typeof OrganizationCategorySpecializationMap)[OrganizationCategory][number]
>
type OrganizationSpecialization = (typeof OrganizationSpecializationValues)[number]

const OrganizationsDirectoryQuery = z.object({
  q: z.string().trim().max(80).optional(),
  type: z.enum(OrganizationDirectoryTypeValues).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const OrganizationCategorySchema = z.custom<OrganizationCategory>((value) => value == null || isOrganizationCategory(value))
const OrganizationSpecializationSchema = z.custom<OrganizationSpecialization>((value) => value == null || isOrganizationSpecialization(value))

const CommunityOrgCreateBody = z.object({
  name: z.string().trim().min(3).max(160),
  slug: z.string().trim().min(1).max(80).optional(),
  type: z.enum(OrganizationDirectoryTypeValues).optional(),
  category: OrganizationCategorySchema.optional().nullable(),
  specialization: OrganizationSpecializationSchema.optional().nullable(),
  description: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  const hasCategory = Boolean(value.category)
  const hasSpecialization = Boolean(value.specialization)
  if (hasSpecialization && !hasCategory) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'category_required_for_specialization', path: ['category'] })
    return
  }
  if (value.category && value.specialization) {
    const allowed = OrganizationCategorySpecializationMap[value.category as OrganizationCategory] as readonly string[]
    if (!allowed.includes(value.specialization)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'specialization_not_in_category', path: ['specialization'] })
    }
  }
})

const CommunityOrgDraftBody = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  slug: z.string().trim().min(1).max(80).optional(),
  type: z.enum(OrganizationDirectoryTypeValues).optional(),
  category: OrganizationCategorySchema.optional().nullable(),
  specialization: OrganizationSpecializationSchema.optional().nullable(),
  description: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  const hasCategory = Boolean(value.category)
  const hasSpecialization = Boolean(value.specialization)
  if (hasSpecialization && !hasCategory) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'category_required_for_specialization', path: ['category'] })
    return
  }
  if (value.category && value.specialization) {
    const allowed = OrganizationCategorySpecializationMap[value.category as OrganizationCategory] as readonly string[]
    if (!allowed.includes(value.specialization)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'specialization_not_in_category', path: ['specialization'] })
    }
  }
})

const CommunityOrgSettingsBody = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  slug: z.string().trim().min(1).max(80).optional(),
  type: z.enum(OrganizationDirectoryTypeValues).optional(),
  category: OrganizationCategorySchema.optional().nullable(),
  specialization: OrganizationSpecializationSchema.optional().nullable(),
  headline: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().max(50000).optional().nullable(),
  logoMediaId: z.string().trim().min(3).optional(),
  coverMediaId: z.string().trim().min(3).optional(),
  phone: z.string().trim().min(1).max(50).optional().nullable(),
  websiteUrl: z.string().trim().max(2048).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  addressDetails: z
    .object({
      name: z.string().trim().max(120).optional().nullable(),
      label: z.string().trim().max(80).optional().nullable(),
      line1: z.string().trim().max(180).optional().nullable(),
      line2: z.string().trim().max(180).optional().nullable(),
      city: z.string().trim().max(120).optional().nullable(),
      province: z.string().trim().max(64).optional().nullable(),
      postalCode: z.string().trim().max(32).optional().nullable(),
      originalPostalCode: z.string().trim().max(32).optional().nullable(),
      country: z.string().trim().max(2).optional().nullable(),
      latitude: z.coerce.number().finite().min(-90).max(90).optional().nullable(),
      longitude: z.coerce.number().finite().min(-180).max(180).optional().nullable(),
      nominatimDisplayName: z.string().trim().max(500).optional().nullable(),
      nominatimRaw: z.unknown().optional().nullable(),
    })
    .optional()
    .nullable(),
  schedule: z.string().trim().max(2000).optional().nullable(),
  isPublic: z.boolean().optional(),
}).superRefine((value, ctx) => {
  const hasCategory = Boolean(value.category)
  const hasSpecialization = Boolean(value.specialization)
  if (hasSpecialization && !hasCategory) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'category_required_for_specialization', path: ['category'] })
    return
  }
  if (value.category && value.specialization) {
    const allowed = OrganizationCategorySpecializationMap[value.category as OrganizationCategory] as readonly string[]
    if (!allowed.includes(value.specialization)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'specialization_not_in_category', path: ['specialization'] })
    }
  }
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

const OrgEventTypeValues = ['MEETING_ROOM', 'LOCATION'] as const

const OrgStructuredAddressSchema = z.object({
  name: z.string().trim().max(120).optional().nullable(),
  label: z.string().trim().max(80).optional().nullable(),
  line1: z.string().trim().max(180).optional().nullable(),
  line2: z.string().trim().max(180).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  province: z.string().trim().max(64).optional().nullable(),
  postalCode: z.string().trim().max(32).optional().nullable(),
  originalPostalCode: z.string().trim().max(32).optional().nullable(),
  country: z.string().trim().max(2).optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  nominatimDisplayName: z.string().trim().max(500).optional().nullable(),
}).strict()

const OrgEventMeetingRoomSchema = z.object({
  meetingId: z.string().trim().min(3).max(80),
  title: z.string().trim().max(180).optional().nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional().nullable(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
}).strict()

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
    eventType: z.enum(OrgEventTypeValues).default('LOCATION'),
    meetingRoom: OrgEventMeetingRoomSchema.optional().nullable(),
    locationAddress: OrgStructuredAddressSchema.optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.paid && (typeof value.priceCents !== 'number' || value.priceCents <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceCents'], message: 'price_cents_required_for_paid_event' })
    }
    if (value.eventType === 'MEETING_ROOM' && !value.meetingRoom?.meetingId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['meetingRoom'], message: 'meeting_room_required_for_online_event' })
    }
    if (value.eventType === 'LOCATION' && !value.locationAddress) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['locationAddress'], message: 'location_required_for_location_event' })
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
    eventType: z.enum(OrgEventTypeValues).optional(),
    meetingRoom: OrgEventMeetingRoomSchema.optional().nullable(),
    locationAddress: OrgStructuredAddressSchema.optional().nullable(),
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

const CommunityOrgMeetingParticipantParams = CommunityOrgMeetingParams.extend({
  userId: z.string().trim().min(1).max(120),
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
  listingSection: z.string().trim().min(1).max(120).optional().nullable(),
  listingCategory: z.string().trim().min(1).max(120).optional().nullable(),
  listingSubcategory: z.string().trim().min(1).max(120).optional().nullable(),
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
  listingSection: z.string().trim().min(1).max(120).optional().nullable(),
  listingCategory: z.string().trim().min(1).max(120).optional().nullable(),
  listingSubcategory: z.string().trim().min(1).max(120).optional().nullable(),
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

const CommunityOrgShopWarehouseUpdateBody = CommunityOrgShopWarehouseCreateBody

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

const CommunityOrgShopWarehouseParams = CommunityOrgSlugParams.extend({
  warehouseId: z.string().trim().min(1).max(120),
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
  addressDetails?: unknown
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

type StructuredAddressRecord = {
  name?: string | null
  label?: string | null
  line1?: string | null
  line2?: string | null
  city?: string | null
  province?: string | null
  postalCode?: string | null
  originalPostalCode?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
  nominatimDisplayName?: string | null
  nominatimRaw?: unknown
}

type SavedShippingAddressRecord = StructuredAddressRecord & {
  id: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

function normalizeStructuredAddressText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function normalizeStructuredAddressCoordinate(value: unknown, min: number, max: number) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) return parsed
  }
  return null
}

function normalizeStructuredAddressProvince(value: unknown) {
  const raw = normalizeStructuredAddressText(value, 64)
  return raw ? raw.toUpperCase() : null
}

function normalizeStructuredAddressPostalCode(value: unknown) {
  const raw = normalizeStructuredAddressText(value, 32)
  if (!raw) return null
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  if (compact.length <= 3) return compact
  return `${compact.slice(0, 3)} ${compact.slice(3)}`
}

function normalizeStructuredAddressInput(value: unknown): StructuredAddressRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const next: StructuredAddressRecord = {
    name: normalizeStructuredAddressText(record.name, 120),
    label: normalizeStructuredAddressText(record.label, 80),
    line1: normalizeStructuredAddressText(record.line1, 180),
    line2: normalizeStructuredAddressText(record.line2, 180),
    city: normalizeStructuredAddressText(record.city, 120),
    province: normalizeStructuredAddressProvince(record.province),
    postalCode: normalizeStructuredAddressPostalCode(record.postalCode),
    originalPostalCode: normalizeStructuredAddressPostalCode(record.originalPostalCode),
    country: normalizeStructuredAddressText(record.country, 2)?.toUpperCase() ?? 'CA',
    latitude: normalizeStructuredAddressCoordinate(record.latitude, -90, 90),
    longitude: normalizeStructuredAddressCoordinate(record.longitude, -180, 180),
    nominatimDisplayName: normalizeStructuredAddressText(record.nominatimDisplayName, 500),
    nominatimRaw:
      record.nominatimRaw && typeof record.nominatimRaw === 'object'
        ? (record.nominatimRaw as Record<string, unknown>)
        : null,
  }
  const hasValue = Object.values(next).some((entry) => entry !== null && entry !== '')
  return hasValue ? next : null
}

function formatStructuredAddress(value: StructuredAddressRecord | null | undefined) {
  if (!value) return null
  const lines = [value.line1, value.line2].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  const cityLine = [value.city, value.province, value.postalCode].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).join(', ')
  if (cityLine) lines.push(cityLine)
  if (value.country && value.country.trim()) lines.push(value.country.trim())
  return lines.length ? lines.join(', ') : null
}

function readOrganizationAddressDetails(metadata: unknown): StructuredAddressRecord | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).addressDetails
  return normalizeStructuredAddressInput(value)
}

function mergeOrganizationAddressDetailsIntoMetadata(metadata: unknown, value: StructuredAddressRecord | null): Prisma.InputJsonValue {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? ({ ...(metadata as Record<string, unknown>) } as Record<string, unknown>) : {}
  if (value) base.addressDetails = value
  else delete base.addressDetails
  return base as Prisma.InputJsonValue
}

function readMarketShippingAddresses(meta: Prisma.JsonValue | null | undefined): SavedShippingAddressRecord[] {
  const base = readBaseCommunityMeta(meta)
  const market = base.market
  if (!market || typeof market !== 'object' || Array.isArray(market)) return []
  const shippingAddresses = (market as Record<string, unknown>).shippingAddresses
  if (!Array.isArray(shippingAddresses)) return []

  const items = shippingAddresses
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const record = entry as Record<string, unknown>
      const id = normalizeStructuredAddressText(record.id, 64)
      if (!id) return null
      const normalized = normalizeStructuredAddressInput(record)
      if (!normalized) return null
      return {
        ...normalized,
        id,
        isDefault: Boolean(record.isDefault),
        createdAt: normalizeStructuredAddressText(record.createdAt, 64) ?? new Date(0).toISOString(),
        updatedAt: normalizeStructuredAddressText(record.updatedAt, 64) ?? new Date(0).toISOString(),
      } satisfies SavedShippingAddressRecord
    })
    .filter((entry): entry is SavedShippingAddressRecord => Boolean(entry))

  if (!items.length) return []
  const hasDefault = items.some((entry) => entry.isDefault)
  return items.map((entry, index) => ({ ...entry, isDefault: hasDefault ? entry.isDefault : index === 0 }))
}

function mergeMarketShippingAddressesIntoCommunityMeta(
  meta: Prisma.JsonValue | null | undefined,
  items: SavedShippingAddressRecord[],
): Prisma.InputJsonValue {
  const base = readBaseCommunityMeta(meta)
  const market = base.market && typeof base.market === 'object' && !Array.isArray(base.market)
    ? ({ ...(base.market as Record<string, unknown>) } as Record<string, unknown>)
    : {}
  if (items.length) market.shippingAddresses = items
  else delete market.shippingAddresses
  if (Object.keys(market).length) base.market = market
  else delete base.market
  return base as Prisma.InputJsonValue
}

function readOrganizationHeadline(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).headline
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 60) : null
}

function isOrganizationDirectoryType(value: unknown): value is OrganizationDirectoryType {
  return typeof value === 'string' && (OrganizationDirectoryTypeValues as readonly string[]).includes(value)
}

function isOrganizationCategory(value: unknown): value is OrganizationCategory {
  return typeof value === 'string' && (OrganizationCategoryValues as readonly string[]).includes(value)
}

function isOrganizationSpecialization(value: unknown): value is OrganizationSpecialization {
  return typeof value === 'string' && (OrganizationSpecializationValues as readonly string[]).includes(value)
}

function mapBusinessTypeToOrganizationDirectoryType(value: BusinessType): OrganizationDirectoryType {
  switch (value) {
    case 'NON_PROFIT':
      return 'NON_PROFIT'
    case 'COMMUNITY_GROUP':
    case 'EDUCATIONAL':
    case 'ARTS_CULTURE':
    case 'SPORTS_RECREATION':
      return 'COMMUNITY_GROUP'
    case 'RELIGIOUS':
      return 'RELIGIOUS_ORGANIZATION'
    case 'GOVERNMENT':
      return 'GOVERNMENT'
    case 'LOCAL_BUSINESS':
    default:
      return 'SOLE_PROPRIETORSHIP'
  }
}

function mapOrganizationDirectoryTypeToBusinessType(value: OrganizationDirectoryType): BusinessType {
  switch (value) {
    case 'NON_PROFIT':
    case 'CHARITY':
      return 'NON_PROFIT'
    case 'COMMUNITY_GROUP':
      return 'COMMUNITY_GROUP'
    case 'RELIGIOUS_ORGANIZATION':
      return 'RELIGIOUS'
    case 'GOVERNMENT':
      return 'GOVERNMENT'
    case 'INDIVIDUAL':
    case 'SOLE_PROPRIETORSHIP':
    case 'CORPORATION':
    default:
      return 'LOCAL_BUSINESS'
  }
}

function readOrganizationDirectoryType(metadata: unknown, fallbackType: BusinessType): OrganizationDirectoryType {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const value = (metadata as Record<string, unknown>).directoryType
    if (isOrganizationDirectoryType(value)) return value
  }
  return mapBusinessTypeToOrganizationDirectoryType(fallbackType)
}

function readOrganizationCategory(metadata: unknown): OrganizationCategory | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).directoryCategory
  return isOrganizationCategory(value) ? value : null
}

function readOrganizationSpecialization(metadata: unknown): OrganizationSpecialization | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).directorySpecialization
  return isOrganizationSpecialization(value) ? value : null
}

function mergeOrganizationDirectorySettingsIntoMetadata(
  metadata: unknown,
  next: {
    type?: OrganizationDirectoryType | null
    category?: OrganizationCategory | null
    specialization?: OrganizationSpecialization | null
  },
): Prisma.InputJsonValue {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? ({ ...(metadata as Record<string, unknown>) } as Record<string, unknown>) : {}
  if ('type' in next) {
    if (next.type) base.directoryType = next.type
    else delete base.directoryType
  }
  if ('category' in next) {
    if (next.category) base.directoryCategory = next.category
    else delete base.directoryCategory
  }
  if ('specialization' in next) {
    if (next.specialization) base.directorySpecialization = next.specialization
    else delete base.directorySpecialization
  }
  return base as Prisma.InputJsonValue
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
  const addressDetails = org.addressDetails ? normalizeStructuredAddressInput(org.addressDetails) : readOrganizationAddressDetails(org.metadata)
  return {
    id: org.id,
    ownerId: org.ownerId,
    provinceCode: org.provinceCode,
    communitySlug: org.communitySlug,
    name: org.name,
    headline: readOrganizationHeadline(org.metadata),
    slug: org.slug,
    type: readOrganizationDirectoryType(org.metadata, org.type),
    category: readOrganizationCategory(org.metadata),
    specialization: readOrganizationSpecialization(org.metadata),
    description: org.description ? sanitizePlainText(org.description) : null,
    phone: org.phone ?? null,
    websiteUrl: org.websiteUrl ?? null,
    address: org.address ?? formatStructuredAddress(addressDetails),
    addressDetails,
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
  eventType?: (typeof OrgEventTypeValues)[number]
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
  meetingRoom?: {
    meetingId: string
    title: string | null
    status: 'ACTIVE' | 'ARCHIVED' | null
    visibility: 'PUBLIC' | 'PRIVATE' | null
    startsAt: string | null
    endsAt: string | null
  } | null
  locationAddress?: {
    name?: string | null
    label?: string | null
    line1?: string | null
    line2?: string | null
    city?: string | null
    province?: string | null
    postalCode?: string | null
    originalPostalCode?: string | null
    country?: string | null
    latitude?: number | null
    longitude?: number | null
    nominatimDisplayName?: string | null
  } | null
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

function normalizeOrganizationStructuredAddress(value: unknown): OrgEventDefinition['locationAddress'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const readText = (entry: unknown, maxLength: number) => {
    if (typeof entry !== 'string') return null
    const trimmed = entry.trim()
    return trimmed ? trimmed.slice(0, maxLength) : null
  }
  const readCoordinate = (entry: unknown, min: number, max: number) => {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry >= min && entry <= max) return entry
    if (typeof entry === 'string') {
      const parsed = Number(entry.trim())
      if (Number.isFinite(parsed) && parsed >= min && parsed <= max) return parsed
    }
    return null
  }

  const next = {
    name: readText(record.name, 120),
    label: readText(record.label, 80),
    line1: readText(record.line1, 180),
    line2: readText(record.line2, 180),
    city: readText(record.city, 120),
    province: readText(record.province, 64),
    postalCode: readText(record.postalCode, 32),
    originalPostalCode: readText(record.originalPostalCode, 32),
    country: readText(record.country, 2)?.toUpperCase() ?? 'CA',
    latitude: readCoordinate(record.latitude, -90, 90),
    longitude: readCoordinate(record.longitude, -180, 180),
    nominatimDisplayName: readText(record.nominatimDisplayName, 500),
  }

  return Object.values(next).some((entry) => entry !== null && entry !== '') ? next : null
}

function normalizeOrganizationEventType(value: unknown, event: Partial<OrgEventDefinition>): (typeof OrgEventTypeValues)[number] {
  if (typeof value === 'string') {
    const upper = value.trim().toUpperCase()
    if (upper === 'MEETING_ROOM' || upper === 'LOCATION') return upper
  }
  return event.meetingRoom?.meetingId ? 'MEETING_ROOM' : 'LOCATION'
}

function normalizeOrganizationEventMeetingRoom(value: unknown): OrgEventDefinition['meetingRoom'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const meetingId = typeof record.meetingId === 'string' ? record.meetingId.trim() : ''
  if (!meetingId) return null
  const title = typeof record.title === 'string' ? record.title.trim() || null : null
  const status = record.status === 'ACTIVE' || record.status === 'ARCHIVED' ? record.status : null
  const visibility = record.visibility === 'PUBLIC' || record.visibility === 'PRIVATE' ? record.visibility : null
  const startsAt = typeof record.startsAt === 'string' && record.startsAt.trim() ? record.startsAt.trim() : null
  const endsAt = typeof record.endsAt === 'string' && record.endsAt.trim() ? record.endsAt.trim() : null
  return { meetingId, title, status, visibility, startsAt, endsAt }
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
          eventType: normalizeOrganizationEventType((event as Partial<OrgEventDefinition>).eventType, event),
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
          meetingRoom: normalizeOrganizationEventMeetingRoom((event as Partial<OrgEventDefinition>).meetingRoom),
          locationAddress: normalizeOrganizationStructuredAddress((event as Partial<OrgEventDefinition>).locationAddress),
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
  CommunityOrgDraftBody,
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
  mapOrganizationDirectoryTypeToBusinessType,
  mergeOrganizationDirectorySettingsIntoMetadata,
  enqueueContentAiScanForOrganization,
  ensureUniqueCommunityOrgSlug,
  findCommunity,
  formatStructuredAddress,
  isBusinessHiddenFromViewer,
  loadViewerAuthContext,
  loadViewerBlockState,
  mergeOrganizationAddressDetailsIntoMetadata,
  mergeOrganizationSystemStateIntoMetadata,
  moderationLockedErrorCode,
  normalizeMediaUrl,
  normalizeProvinceCode,
  normalizeStructuredAddressInput,
  readOrganizationAddressDetails,
  readOrganizationDirectoryType,
  readOrganizationCategory,
  readOrganizationSpecialization,
  readOrganizationSystemState,
  resolveUserId,
  sanitizePlainText,
  slugifyText,
  trimSlugLength,
  withSchemaGuard,
})

registerOrganizationGovernanceMeetingsRoutes(app, {
  CommunityOrgMemberModerationBody,
  CommunityOrgMeetingCreateBody,
  CommunityOrgMeetingJoinBody,
  CommunityOrgMeetingParams,
  CommunityOrgMeetingParticipantParams,
  CommunityOrgMeetingRtcSessionBody,
  CommunityOrgMeetingUpdateBody,
  CommunityOrgSlugParams,
  MessageParticipantRole,
  canOrganizationPermission,
  disconnectMeetingRtcPeer,
  ensureOrganizationMeetingTables,
  ensureOrganizationMeetingThread,
  findCommunity,
  hashMeetingPassword,
  issueMeetingRtcSession,
  mapMeetingRowForViewer,
  normalizeMeetingAdmissionStatus,
  normalizeMeetingMaxParticipants,
  normalizeMeetingStatus,
  normalizeMeetingVisibility,
  normalizeProvinceCode,
  readMeetingRtcRoomState,
  readOrganizationSystemState,
  resolveOrganizationMeetingAccess,
  resolveOrganizationPermissions,
  resolveUserId,
  sanitizePlainText,
  withSchemaGuard,
})

registerOrganizationGovernanceEventsRoutes(app, {
  BUSINESS_FRIEND_USER_SELECT: FRIEND_USER_SELECT,
  CommunityOrgEventBody,
  CommunityOrgEventDraftUpdateBody,
  CommunityOrgEventParams,
  CommunityOrgEventRsvpBody,
  CommunityOrgSlugParams,
  EVENT_NOTIFICATION_TYPES,
  NOTIFICATION_SELECT,
  appendOrganizationAuditLogEntry,
  buildGuestSpeakerInvites,
  buildOrganizationEventScanTargetId,
  buildSponsorInvites,
  canOrganizationPermission,
  createOrganizationEventAnnouncementPost,
  enqueueContentAiScanForOrganizationEvent,
  enqueueContentAiScanForPost,
  findCommunity,
  formatFriendUser,
  loadContentAiScanSummary,
  mergeOrganizationSystemStateIntoMetadata,
  normalizeEventSponsorTags,
  normalizeGuestSpeakerInput,
  normalizeMediaUrl,
  normalizeProvinceCode,
  notifyEventGuestSpeakerInvite,
  notifyEventSponsorInvite,
  readOrganizationSystemState,
  resolveOrganizationAdminAndManagerIds,
  resolveOrganizationPermissions,
  resolveUserId,
  withSchemaGuard,
})

registerOrganizationGovernanceMembershipRoutes(app, {
  CommunityOrgInviteLinkBody,
  CommunityOrgInviteResolveBody,
  CommunityOrgInviteUserBody,
  CommunityOrgJoinBody,
  CommunityOrgJoinModeBody,
  CommunityOrgMembershipPlanBody,
  CommunityOrgReferralBody,
  CommunityOrgSlugParams,
  ORG_NOTIFICATION_TYPES,
  SYSTEM_MEMBER_RANK_ID,
  appendOrganizationAuditLogEntry,
  canOrganizationPermission,
  createNotificationRecord,
  findCommunity,
  mergeOrganizationSystemStateIntoMetadata,
  normalizeMediaUrl,
  normalizeProvinceCode,
  readOrganizationSystemState,
  resolveOrganizationPermissions,
  resolveUserId,
  withSchemaGuard,
})

registerOrganizationGovernanceAdminRoutes(app, {
  CommunityOrgEconomicsRecordBody,
  CommunityOrgGovernanceQuery,
  CommunityOrgMemberModerationBody,
  CommunityOrgMemberParams,
  CommunityOrgMemberStatusBody,
  CommunityOrgSlugParams,
  SYSTEM_MANAGER_RANK_ID,
  SYSTEM_MEMBER_RANK_ID,
  appendOrganizationAuditLogEntry,
  canOrganizationPermission,
  createNotificationRecord,
  findCommunity,
  isPremium,
  isSelfVerifiedCanadianCitizen,
  mergeOrganizationSystemStateIntoMetadata,
  normalizeMediaUrl,
  normalizeProvinceCode,
  parseCommunityMeta,
  readOrganizationSystemState,
  resolveOrganizationPermissions,
  resolveUserId,
  withSchemaGuard,
})

registerOrganizationGovernanceConfigRoutes(app, {
  CommunityOrgAchievementAwardBody,
  CommunityOrgAchievementBody,
  CommunityOrgAchievementParams,
  CommunityOrgGovernanceRankBody,
  CommunityOrgReputationAdjustBody,
  CommunityOrgSlugParams,
  CommunityOrgSponsorBody,
  SYSTEM_MEMBER_RANK_ID,
  appendOrganizationAuditLogEntry,
  canOrganizationPermission,
  findCommunity,
  mergeOrganizationSystemStateIntoMetadata,
  normalizeProvinceCode,
  readOrganizationSystemState,
  resolveOrganizationPermissions,
  resolveUserId,
  withSchemaGuard,
})

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
  CommunityOrgShopWarehouseParams,
  CommunityOrgShopWarehouseUpdateBody,
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
  sanitizeRichTextHtml,
  withSchemaGuard,
})

const MarketProductsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(24),
  cursor: z.string().trim().min(1).max(256).optional(),
  listingSection: z.string().trim().min(1).max(180).optional(),
  listingCategory: z.string().trim().min(1).max(180).optional(),
  listingSubcategory: z.string().trim().min(1).max(180).optional(),
  listingDetail: z.string().trim().min(1).max(180).optional(),
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
      label: z.string().trim().max(80).optional(),
      line1: z.string().trim().min(1).max(120).optional(),
      line2: z.string().trim().max(120).optional().nullable(),
      city: z.string().trim().min(1).max(80).optional(),
      province: z.string().trim().min(1).max(80).optional(),
      postalCode: z.string().trim().min(1).max(32).optional(),
      country: z.string().trim().min(2).max(2).optional().default('CA'),
      latitude: z.coerce.number().finite().min(-90).max(90).optional().nullable(),
      longitude: z.coerce.number().finite().min(-180).max(180).optional().nullable(),
    })
    .optional()
    .nullable(),
})

const MarketShippingAddressBody = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().max(80).optional().nullable(),
  name: z.string().trim().max(120).optional().nullable(),
  line1: z.string().trim().min(1).max(180),
  line2: z.string().trim().max(180).optional().nullable(),
  city: z.string().trim().min(1).max(120),
  province: z.string().trim().min(1).max(64),
  postalCode: z.string().trim().min(1).max(32),
  originalPostalCode: z.string().trim().max(32).optional().nullable(),
  country: z.string().trim().min(2).max(2).default('CA'),
  latitude: z.coerce.number().finite().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().finite().min(-180).max(180).optional().nullable(),
  nominatimDisplayName: z.string().trim().max(500).optional().nullable(),
  nominatimRaw: z.unknown().optional().nullable(),
  isDefault: z.boolean().optional().default(false),
})

const MarketShippingAddressParams = z.object({
  addressId: z.string().trim().min(1).max(64),
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

const CANADA_SALES_TAX_CATALOG_RESPONSE = buildCanadaSalesTaxCatalogResponse()

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
    pickupInstructions: z.string().trim().max(2000).optional().nullable(),
    itemIsHeavy: z.boolean().optional(),
    itemIsBulky: z.boolean().optional(),
    itemIsSmall: z.boolean().optional(),
  })
  .strict()

const MarketListingUpdateBody = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(50000).optional().nullable(),
  priceCents: z.coerce.number().int().min(0).max(500000000).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  photoUrls: z.array(z.string().trim().url().max(2048)).max(12).optional(),
  listingProvinceCode: z.string().trim().min(2).max(8).optional().nullable(),
  listingCommunitySlug: z.string().trim().min(1).max(120).optional().nullable(),
  listingSection: z.string().trim().min(1).max(120).optional().nullable(),
  listingCategory: z.string().trim().min(1).max(120).optional().nullable(),
  listingSubcategory: z.string().trim().min(1).max(120).optional().nullable(),
  listingDetail: z.string().trim().min(1).max(180).optional().nullable(),
  foodSafetyClassification: z.enum(['low_risk', 'high_risk']).optional().nullable(),
  foodIngredients: z.string().trim().max(4000).optional().nullable(),
  foodPreparationLocation: z.enum(['home_kitchen', 'certified_kitchen']).optional().nullable(),
  foodStorageMethod: z.enum(['refrigerated', 'frozen']).optional().nullable(),
  foodTags: z.array(z.enum(['organic', 'grass_fed', 'free_range', 'non_gmo', 'local'])).max(5).optional(),
  foodExpiryDate: z.string().trim().max(32).optional().nullable(),
  foodHandlingInstructions: z.string().trim().max(2000).optional().nullable(),
  pickupCity: z.string().trim().max(120).optional().nullable(),
  pickupProvince: z.string().trim().max(80).optional().nullable(),
  pickupAddressLine1: z.string().trim().max(180).optional().nullable(),
  pickupAddressLine2: z.string().trim().max(180).optional().nullable(),
  pickupPostalCode: z.string().trim().max(32).optional().nullable(),
  paymentTypes: z.array(z.enum(['cash_pickup', 'etransfer', 'civil_wallet'])).max(3).optional(),
  willingToDeliver: z.boolean().optional(),
  deliveryOptions: MarketDeliveryOptionsSchema.optional().nullable(),
  eTransferEmail: z.string().trim().email().max(320).optional().nullable(),
  isDraft: z.boolean().optional(),
  status: z.enum(['draft', 'active', 'pending_sale', 'sold', 'canceled']).optional(),
})

const MarketListingRemoveBody = z
  .object({
    resolution: z.enum(['deleted', 'sold']).optional().default('deleted'),
  })
  .strict()

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
  pickupInstructions?: string
  itemIsHeavy?: boolean
  itemIsBulky?: boolean
  itemIsSmall?: boolean
}

function readDeliveryOptions(raw: unknown): MarketDeliveryOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const typed = raw as Record<string, unknown>
  const options: MarketDeliveryOptions = {}

  const pickupInstructions = typed.pickupInstructions
  if (typeof pickupInstructions === 'string' && pickupInstructions.trim()) {
    options.pickupInstructions = pickupInstructions.trim().slice(0, 2000)
  }

  if (typed.itemIsHeavy === true) options.itemIsHeavy = true
  if (typed.itemIsBulky === true) options.itemIsBulky = true
  if (typed.itemIsSmall === true) options.itemIsSmall = true

  if (!Object.keys(options).length) {
    if (typeof typed.short50km === 'number' && Number.isFinite(typed.short50km) && typed.short50km >= 0) options.itemIsSmall = true
    if (typeof typed.medium100km === 'number' && Number.isFinite(typed.medium100km) && typed.medium100km >= 0) options.itemIsBulky = true
    if (typeof typed.long250km === 'number' && Number.isFinite(typed.long250km) && typed.long250km >= 0) options.itemIsHeavy = true
  }

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

app.get('/tax/canada/sales-rates', async (_req: FastifyRequest, reply: FastifyReply) => {
  return reply.send(CANADA_SALES_TAX_CATALOG_RESPONSE)
})

registerMarketStorefrontRoutes(app, {
  MarketCheckoutBody,
  MarketShippingAddressBody,
  MarketShippingAddressParams,
  MarketOrderParams,
  MarketOrdersQuery,
  MarketProductParams,
  MarketProductsQuery,
  ModerationStatus,
  STRIPE_PUBLISHABLE_KEY,
  createNotificationRecord,
  ensureCitizenMarketplaceTables,
  ensureOrganizationShopTables,
  ensureStripeCustomer,
  getStripeClient,
  isStripeConfigured,
  loadViewerBlockState,
  mergeMarketShippingAddressesIntoCommunityMeta,
  normalizeMediaUrl,
  parseMarketCursor,
  parseTaxRatePct,
  readOrganizationShopPaymentsState,
  readMarketShippingAddresses,
  readGalleryUrls,
  readViewerCommunityFollows,
  resolveTaxRegionCode,
  resolveUserId,
  withSchemaGuard,
})

registerMarketListingRoutes(app, {
  MarketListingParams,
  MarketListingRemoveBody,
  MarketListingsQuery,
  MarketListingUpdateBody,
  MESSAGE_SELECT,
  MARKET_LISTING_CHAT_CONTEXT_TYPE,
  THREAD_SUMMARY_INCLUDE,
  dispatchRealtimeEvent,
  enqueueContentAiScanForMarketListing,
  ensureCitizenMarketplaceTables,
  formatMessage,
  isVisibleModerationStatus,
  loadViewerBlockState,
  moderationLockedErrorCode,
  normalizeMediaUrl,
  parseCommunityMeta,
  readDeliveryOptions,
  readGalleryUrls,
  readStringList,
  readViewerCommunityFollows,
  normalizeRichTextHtml,
  resolveUserId,
  sanitizePlainText,
  sendMobilePushForMessageCreated,
  stripHtmlToPlainText,
  withSchemaGuard,
})

registerDeliveryRoutes(app, {
  DELIVERY_NOTIFICATION_TYPES,
  MESSAGE_SELECT,
  createNotificationRecord,
  dispatchRealtimeEvent,
  ensureCitizenMarketplaceTables,
  formatMessage,
  isSelfVerifiedCanadianCitizen,
  parseCommunityMeta,
  readBaseCommunityMeta,
  readGalleryUrls,
  readMarketShippingAddresses,
  resolveUserId,
  sanitizePlainText,
  sendMobilePushForMessageCreated,
  withSchemaGuard,
})

registerDriveRideRoutes(app, {
  createNotificationRecord,
  ensureCitizenMarketplaceTables,
  readBaseCommunityMeta,
  readGalleryUrls,
  readMarketShippingAddresses,
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
  readBaseCommunityMeta,
  readDeliveryOptions,
  readGalleryUrls,
  readStringList,
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
  isSuperAdminEmail,
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
      communityMeta: true,
      stripeCustomerId: true,
      premiumStatus: true,
      premiumSince: true,
      premiumRenewsAt: true,
      ...BILLING_PROFILE_SELECT,
    },
  })
  if (!user) throw new Error('user_not_found')
  const wallet = readWalletSummary(user.communityMeta)
  const metaStripeCustomerId = wallet.stripeCustomerId
  const persistedStripeCustomerId = user.stripeCustomerId ?? metaStripeCustomerId
  const stripe = getStripeClient()

  if (persistedStripeCustomerId) {
    try {
      const existingCustomer = await stripe.customers.retrieve(persistedStripeCustomerId)
      if (!('deleted' in existingCustomer && existingCustomer.deleted)) {
        if (user.stripeCustomerId !== persistedStripeCustomerId || metaStripeCustomerId !== persistedStripeCustomerId) {
          const baseMeta = readBaseCommunityMeta(user.communityMeta)
          baseMeta.wallet = buildWalletMetaValue({
            ...wallet,
            stripeCustomerId: persistedStripeCustomerId,
          })
          await prisma.user.update({
            where: { id: userId },
            data: {
              stripeCustomerId: persistedStripeCustomerId,
              communityMeta: baseMeta,
            },
          })
        }
        return { customerId: persistedStripeCustomerId, user: { ...user, stripeCustomerId: persistedStripeCustomerId } }
      }
    } catch (error: any) {
      if (error?.code !== 'resource_missing') throw error
    }
  }

  if (user.email) {
    const existing = await findStripeCustomerByEmail(stripe, user.email)
    if (existing) {
      const baseMeta = readBaseCommunityMeta(user.communityMeta)
      baseMeta.wallet = buildWalletMetaValue({
        ...wallet,
        stripeCustomerId: existing.id,
      })
      await prisma.user.update({
        where: { id: userId },
        data: {
          stripeCustomerId: existing.id,
          communityMeta: baseMeta,
        },
      })
      return { customerId: existing.id, user: { ...user, stripeCustomerId: existing.id } }
    }
  }
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId },
  })
  const baseMeta = readBaseCommunityMeta(user.communityMeta)
  baseMeta.wallet = buildWalletMetaValue({
    ...wallet,
    stripeCustomerId: customer.id,
  })
  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: customer.id,
      communityMeta: baseMeta,
    },
  })
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
      } else if (paymentIntent.metadata?.kind === 'cause_contribution') {
        await applyCauseContributionFromPaymentIntent(paymentIntent, createNotificationRecord)
      } else if (paymentIntent.metadata?.kind === 'wallet_topup') {
        await applyWalletTopUpFromPaymentIntent(paymentIntent)
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
  CONNECTION_NOTIFICATION_TYPES,
  DELIVERY_NOTIFICATION_TYPES,
  EVENT_NOTIFICATION_TYPES,
  FAMILY_NOTIFICATION_TYPES,
  MESSAGE_SELECT,
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
  dispatchRealtimeEvent,
  ensureCitizenMarketplaceTables,
  findConnectionById,
  formatMessage,
  getStoredFamilyFriendRequests,
  getStoredFamilyFriendships,
  getStoredProfileFamilyRelationships,
  isConnectionTableMissingError,
  mergeOrganizationSystemStateIntoMetadata,
  notifyConnectionAcceptance,
  notifyProfileFamilyInviteResponse,
  parseCommunityMeta,
  readBaseCommunityMeta,
  readOrganizationSystemState,
  sendMobilePushForMessageCreated,
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
  expiresAt: z.string().datetime().optional().nullable(),
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
  expiresAt: z.string().datetime().optional().nullable(),
})

const ApplyJobBody = z.object({
  motivationHtml: z.string().trim().min(20).max(20000),
})

const UpdateCivilStatusBody = z.object({
  civicStatus: z.enum(['citizen', 'permanent_resident', 'work_permit', 'study_permit', 'unspecified']),
  workAuthorization: z.enum(['authorized', 'not_authorized', 'unspecified']).optional(),
  affirmed: z.literal(true),
})

const UpdateWalletBody = z.object({
  enabled: z.boolean().optional(),
  eTransferEmail: z.string().trim().email().max(320).optional().nullable(),
  sharing: z
    .object({
      family: z.boolean().optional(),
      friends: z.boolean().optional(),
      market: z.boolean().optional(),
    })
    .optional(),
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
    const causeSubscriptionInterval = setInterval(() => {
      void processAllDueCauseSubscriptions({ batchSize: 200, maxBatches: 10, createNotificationRecord }).catch((error) => {
        app.log.error({ err: error }, 'cause_subscription_daily_check_failed')
      })
    }, 24 * 60 * 60 * 1000)
    causeSubscriptionInterval.unref?.()
    void processAllDueCauseSubscriptions({ batchSize: 200, maxBatches: 10, createNotificationRecord }).catch((error) => {
      app.log.error({ err: error }, 'cause_subscription_boot_check_failed')
    })
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
