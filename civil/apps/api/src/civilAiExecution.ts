import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import type {
  CivilAiCardReference,
  CivilAiChatInputPayload,
  CivilAiChatResponsePayload,
  CivilAiHistoryEntry,
  CivilAiJobRow,
  CivilAiServerConfig,
  CivilAiViewerContext,
} from './civilAiCore.js'
import { CIVIL_AI_SERVER_TIMEOUT_MS, CivilAiChatInput, parseLoggedJsonText, safeJsonStringify } from './civilAiCore.js'

type CivilAiJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'

const CIVIL_AI_JOB_TIMEOUT_MS = Math.max(
  CIVIL_AI_SERVER_TIMEOUT_MS,
  Number(process.env.CIVIL_AI_JOB_TIMEOUT_MS || 10 * 60 * 1000) || 10 * 60 * 1000,
)

function isAzureResponsesServer(server: CivilAiServerConfig) {
  const normalizedProvider = (server.provider || '').trim().toLowerCase()
  return (normalizedProvider === 'azure-openai' || normalizedProvider.includes('azure')) && Boolean(server.apiVersion?.trim())
}

function getCivilAiChatPaths(server: CivilAiServerConfig) {
  if (isAzureResponsesServer(server)) {
    const apiVersion = encodeURIComponent(server.apiVersion!.trim())
    return [`/responses?api-version=${apiVersion}`, `/chat/completions?api-version=${apiVersion}`]
  }
  return ['/v1/responses', '/api/v1/chat']
}

function buildCivilAiUpstreamBody(args: {
  server: CivilAiServerConfig
  model: string
  input: string
  temperature?: number
  topP?: number
  maxTokens?: number
}) {
  if (isAzureResponsesServer(args.server)) {
    return {
      model: args.model,
      input: args.input,
      temperature: args.temperature,
      top_p: args.topP,
      max_output_tokens: args.maxTokens,
      stream: false,
    }
  }

  return {
    model: args.model,
    input: args.input,
    temperature: args.temperature,
    top_p: args.topP,
    max_tokens: args.maxTokens,
    stream: false,
  }
}

type CivilAiExecutionLogger = {
  error: (payload: unknown, message?: string) => void
}

type CivilAiRetrievalPlanLike = {
  wantsCauses: boolean
  wantsDrive: boolean
  wantsEvents: boolean
  wantsJobs: boolean
  wantsMarket: boolean
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

type CivilAiMarketScopeLike = {
  mode: 'global' | 'community' | 'province'
  communities: Array<{ provinceCode: string; communitySlug: string }>
  provinceCodes: string[]
}

type CivilAiCommunityLike = NonNullable<CivilAiViewerContext['homeCommunity']>

type CivilAiEventDataItemLike = {
  title: string
  startsAt: string
  organization: { name: string }
}

type CivilAiCauseDataItemLike = {
  title: string | null
  status: 'active' | 'funded' | 'closed' | null
  progressPercent: number | null
}

type CivilAiJobDataItemLike = {
  title: string
  location: string | null
  organization: { name: string }
}

type CivilAiOrganizationDataItemLike = {
  name: string
  description: string | null
}

type CivilAiPostDataItemLike = {
  title: string
  excerpt: string | null
  author: { name: string | null; handle: string }
}

type CivilAiMarketResultLike = {
  title: string
  priceLabel: string
  locationLabel: string | null
}

type CivilAiTopicDataItemLike = {
  slug: string
  recentPostCount: number
}

type CivilAiGroundingBundleLike = {
  retrievalPlan: CivilAiRetrievalPlanLike
  searchPass: 1 | 2
  targetCommunities: CivilAiCommunityLike[]
  causes: CivilAiCauseDataItemLike[]
  events: CivilAiEventDataItemLike[]
  jobs: CivilAiJobDataItemLike[]
  market: CivilAiMarketResultLike[]
  organizations: CivilAiOrganizationDataItemLike[]
  posts: CivilAiPostDataItemLike[]
  topics: CivilAiTopicDataItemLike[]
}

type CivilAiRetrievalBundleLike = {
  viewerContext: CivilAiViewerContext | null
  references: CivilAiCardReference[]
  grounding: CivilAiGroundingBundleLike
  debug: Record<string, unknown>
  prompt: string
}

type CivilAiExecutionDeps = {
  processingJobIds: Set<string>
  jobAbortControllers: Map<string, AbortController>
  logger: CivilAiExecutionLogger
  buildCivilAiCompactList: (items: string[], emptyLabel: string, limit?: number) => string
  buildCivilAiContextPrompt: (viewerContext: CivilAiViewerContext | null) => string
  buildCivilAiDirectAnswer: (question: string, viewerContext: CivilAiViewerContext | null) => { content: string; references: CivilAiCardReference[] } | null
  buildCivilAiEffectiveQuestion: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => string
  buildCivilAiGroundedAnswer: (question: string, bundle: CivilAiGroundingBundleLike) => { content: string; references: CivilAiCardReference[] } | null
  buildCivilAiMarketSearchScope: (args: {
    searchPass: 1 | 2
    targetCommunities: Array<{ provinceCode: string; communitySlug: string }>
    defaultCommunities: Array<{ provinceCode: string; communitySlug: string }>
  }) => CivilAiMarketScopeLike
  buildCivilAiPromptInput: (systemPrompt: string, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => string
  callCivilAiServerWithPathFallback: (args: {
    server: CivilAiServerConfig
    paths: string[]
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
    timeoutMs?: number | null
    signal?: AbortSignal
  }) => Promise<{ ok: boolean; status: number; text: string; json: unknown }>
  ensureCivilAiJobTables: () => Promise<void>
  extractCivilAiMessageContent: (payload: unknown) => string
  finalizeCivilAiReferences: (question: string, references: CivilAiCardReference[]) => CivilAiCardReference[]
  formatCivilAiShortDateTime: (value: string) => string
  loadCivilAiCommunityCauses: (communityId: string, limit: number, query?: string) => Promise<{ items?: CivilAiCauseDataItemLike[] }>
  loadCivilAiCommunityEvents: (communityId: string, when: 'today' | 'upcoming', limit: number) => Promise<{ items?: CivilAiEventDataItemLike[] }>
  loadCivilAiCommunityJobs: (communityId: string, limit: number) => Promise<{ items?: CivilAiJobDataItemLike[] }>
  loadCivilAiCommunityOrganizations: (communityId: string, limit: number, query?: string) => Promise<{ items?: CivilAiOrganizationDataItemLike[] }>
  loadCivilAiCommunityPosts: (communityId: string, limit: number, query?: string, viewerFeedContext?: CivilAiViewerContext['feedContext'] | null) => Promise<{ items?: CivilAiPostDataItemLike[] }>
  loadCivilAiCommunityTopics: (communityId: string, limit: number, query?: string) => Promise<{ items?: CivilAiTopicDataItemLike[] }>
  loadCivilAiChatJob: (jobId: string) => Promise<CivilAiJobRow | null>
  loadCivilAiViewerContext: (userId: string) => Promise<CivilAiViewerContext | null>
  loadCivilAiInstructions: () => Promise<{ instructionsPath: string; content: string }>
  matchCivilAiRequestedCommunities: (question: string, viewerContext: CivilAiViewerContext | null) => CivilAiCommunityLike[]
  normalizeSearchTerm: (value: string) => string
  persistCivilAiDebugTurn: (args: {
    conversationId: string
    userId: string | null
    latestUserMessage: string
    requestMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    viewerContext: CivilAiViewerContext | null
    retrievalDebug: unknown
    references: CivilAiCardReference[]
    serverName: string | null
    model: string | null
    upstreamInput: string | null
    assistantContent: string | null
    rawResponse: unknown
    status: string
    errorMessage: string | null
    durationMs: number | null
  }) => Promise<void>
  persistCivilAiHistory: (userId: string, appendedEntries: CivilAiHistoryEntry[]) => Promise<CivilAiHistoryEntry[]>
  planCivilAiRetrieval: (question: string) => CivilAiRetrievalPlanLike
  readCivilAiHistory: (meta: unknown) => CivilAiHistoryEntry[]
  resolveCivilAiModel: (server: CivilAiServerConfig, preferredModel?: string | null) => Promise<string | null>
  resolveCivilAiServer: (serverId?: string | null) => Promise<{ configPath: string; defaultServerId: string; servers: CivilAiServerConfig[]; server: CivilAiServerConfig | null }>
  sanitizeCivilAiResponseContent: (content: string, references: CivilAiCardReference[]) => string
  searchMarketListingsForQuery: (
    query: string,
    limit: number,
    scope?: { communities?: Array<{ provinceCode: string; communitySlug: string }>; provinceCodes?: string[] },
  ) => Promise<CivilAiMarketResultLike[]>
  selectCivilAiActiveMessages: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Array<{ role: 'user' | 'assistant'; content: string }>
  serializeError: (error: unknown) => string
  shouldCivilAiRunSecondSearch: (question: string, bundle: CivilAiRetrievalBundleLike) => boolean
  toCivilAiCauseReference: (item: CivilAiCauseDataItemLike) => CivilAiCardReference
  toCivilAiCommunityReference: (community: CivilAiCommunityLike) => CivilAiCardReference
  toCivilAiEventReference: (item: CivilAiEventDataItemLike) => CivilAiCardReference
  toCivilAiJobReference: (item: CivilAiJobDataItemLike) => CivilAiCardReference | null
  toCivilAiMarketReference: (item: CivilAiMarketResultLike) => CivilAiCardReference
  toCivilAiOrganizationReference: (item: CivilAiOrganizationDataItemLike & Record<string, unknown>) => CivilAiCardReference | null
  toCivilAiPostReference: (item: CivilAiPostDataItemLike) => CivilAiCardReference
  toCivilAiTopicReference: (item: CivilAiTopicDataItemLike) => CivilAiCardReference
  truncateCivilAiText: (value: string, maxChars: number, keepTail?: boolean) => string
}

export function createCivilAiExecutionHelpers(deps: CivilAiExecutionDeps) {
  async function buildCivilAiRetrievalBundle(userId: string | null, latestQuestion: string, options?: { searchPass?: 1 | 2 }): Promise<CivilAiRetrievalBundleLike> {
    const viewerContext = userId ? await deps.loadCivilAiViewerContext(userId) : null
    const searchPass = options?.searchPass ?? 1
    const retrieval = deps.planCivilAiRetrieval(latestQuestion)
    const topicQuery = searchPass === 1 ? retrieval.topicQuery : ''
    const causeQuery = topicQuery
    const marketQuery = retrieval.topicQuery || deps.normalizeSearchTerm(latestQuestion)
    const topicSearchQuery = topicQuery
    const requestedCommunities = deps.matchCivilAiRequestedCommunities(latestQuestion, viewerContext)
    const nearbyCommunities = viewerContext ? viewerContext.nearbyCommunities.slice(0, searchPass === 1 ? 2 : 8) : []
    const followedCommunities = viewerContext ? viewerContext.followedCommunities.slice(0, searchPass === 1 ? 3 : 8) : []
    const defaultCommunities = [viewerContext?.homeCommunity ?? null, ...nearbyCommunities, ...followedCommunities].filter(
      (entry): entry is CivilAiCommunityLike => Boolean(entry),
    )
    const targetCommunities = (requestedCommunities.length ? requestedCommunities : defaultCommunities)
      .filter((entry, index, collection) => collection.findIndex((item) => item.id === entry.id) === index)
      .slice(0, searchPass === 1 ? 4 : 8)
    const marketScope = deps.buildCivilAiMarketSearchScope({
      searchPass,
      targetCommunities,
      defaultCommunities,
    })

    const causeResults = retrieval.wantsCauses && targetCommunities.length
      ? await Promise.all(targetCommunities.map((community) => deps.loadCivilAiCommunityCauses(community.id, retrieval.causeLimit, causeQuery || undefined)))
      : []
    const eventResults = retrieval.wantsEvents && targetCommunities.length
      ? await Promise.all(targetCommunities.map((community) => deps.loadCivilAiCommunityEvents(community.id, retrieval.todayOnly ? 'today' : 'upcoming', retrieval.eventLimit)))
      : []
    const jobResults = retrieval.wantsJobs && targetCommunities.length
      ? await Promise.all(targetCommunities.map((community) => deps.loadCivilAiCommunityJobs(community.id, retrieval.jobLimit)))
      : []
    const marketResults = retrieval.wantsMarket && marketQuery
      ? await deps.searchMarketListingsForQuery(marketQuery, retrieval.marketLimit, {
          communities: marketScope.communities,
          provinceCodes: marketScope.provinceCodes,
        })
      : []
    const organizationResults = retrieval.wantsOrganizations && targetCommunities.length
      ? await Promise.all(targetCommunities.map((community) => deps.loadCivilAiCommunityOrganizations(community.id, retrieval.organizationLimit, topicQuery || undefined)))
      : []
    const postResults = retrieval.wantsPosts && targetCommunities.length
      ? await Promise.all(targetCommunities.map((community) => deps.loadCivilAiCommunityPosts(community.id, retrieval.postLimit, topicQuery || undefined, viewerContext?.feedContext ?? null)))
      : []
    const topicResults = retrieval.wantsTopics && targetCommunities.length
      ? await Promise.all(targetCommunities.map((community) => deps.loadCivilAiCommunityTopics(community.id, retrieval.topicLimit, topicSearchQuery || undefined)))
      : []

    const usableCauses = causeResults.flatMap((result) => (Array.isArray(result.items) ? result.items : []))
    const usableEvents = eventResults.flatMap((result) => (Array.isArray(result.items) ? result.items : []))
    const usableJobs = jobResults.flatMap((result) => (Array.isArray(result.items) ? result.items : []))
    const usableOrganizations = organizationResults.flatMap((result) => (Array.isArray(result.items) ? result.items : []))
    const usablePosts = postResults.flatMap((result) => (Array.isArray(result.items) ? result.items : []))
    const usableTopics = topicResults.flatMap((result) => (Array.isArray(result.items) ? result.items : []))

    const references: CivilAiCardReference[] = []
    for (const community of targetCommunities.slice(0, 3)) references.push(deps.toCivilAiCommunityReference(community))
    for (const cause of usableCauses.slice(0, 4)) references.push(deps.toCivilAiCauseReference(cause))
    for (const event of usableEvents.slice(0, 4)) references.push(deps.toCivilAiEventReference(event))
    for (const job of usableJobs.slice(0, 4)) {
      const reference = deps.toCivilAiJobReference(job)
      if (reference) references.push(reference)
    }
    for (const listing of marketResults.slice(0, 4)) references.push(deps.toCivilAiMarketReference(listing))
    for (const post of usablePosts.slice(0, 4)) references.push(deps.toCivilAiPostReference(post))
    for (const topic of usableTopics.slice(0, 4)) references.push(deps.toCivilAiTopicReference(topic))
    for (const org of usableOrganizations.slice(0, 4)) {
      const reference = deps.toCivilAiOrganizationReference(org as CivilAiOrganizationDataItemLike & Record<string, unknown>)
      if (reference) references.push(reference)
    }
    if (retrieval.includeViewerOrganizations && viewerContext?.organizations.length) {
      for (const org of viewerContext.organizations.slice(0, 3)) {
        const reference = deps.toCivilAiOrganizationReference({ ...org, description: null, communityName: null })
        if (reference) references.push(reference)
      }
    }

    const summarizedCauses = usableCauses
      .slice(0, 6)
      .map((cause) => `- ${cause.title || 'Untitled cause'} | ${cause.status ?? 'active'} | ${cause.progressPercent ?? 0}% funded`)
    const summarizedEvents = usableEvents.slice(0, 6).map((event) => `- ${event.title} | ${deps.formatCivilAiShortDateTime(event.startsAt)} | ${event.organization.name}`)
    const summarizedJobs = usableJobs.slice(0, 6).map((job) => `- ${job.title} | ${job.organization.name} | ${deps.truncateCivilAiText(job.location || 'location unavailable', 80)}`)
    const summarizedMarket = marketResults.slice(0, 6).map((listing) => `- ${listing.title} | ${listing.priceLabel} | ${deps.truncateCivilAiText(listing.locationLabel ?? 'location unavailable', 80)}`)
    const summarizedOrganizations = usableOrganizations.slice(0, 6).map((organization) => `- ${organization.name} | ${deps.truncateCivilAiText(organization.description ?? 'No description', 120)}`)
    const summarizedPosts = usablePosts.slice(0, 6).map((post) => `- ${post.title} | ${post.author.name || `@${post.author.handle}`} | ${deps.truncateCivilAiText(post.excerpt ?? 'No excerpt', 140)}`)
    const summarizedTopics = usableTopics.slice(0, 6).map((topic) => `- #${topic.slug} | ${topic.recentPostCount} recent local posts`)

    const promptSections = [deps.buildCivilAiContextPrompt(viewerContext)]
    if (viewerContext) {
      promptSections.push(
        '',
        'Fresh Civil data for this question:',
        `- Question: ${deps.truncateCivilAiText(latestQuestion, 240)}`,
        `- Search pass: ${searchPass === 1 ? 'strict local pass' : 'broadened second pass'}`,
        `- Retrieval reasons: ${retrieval.reasons.length ? retrieval.reasons.join('; ') : 'none'}`,
        `- Target communities: ${deps.buildCivilAiCompactList(targetCommunities.map((community) => community.communityName), 'none', 4)}`,
        `- Market scope: ${marketScope.mode}`,
        `- Result counts: causes=${usableCauses.length}; events=${usableEvents.length}; jobs=${usableJobs.length}; market=${marketResults.length}; organizations=${usableOrganizations.length}; posts=${usablePosts.length}; topics=${usableTopics.length}`,
        ...(summarizedCauses.length ? ['- Causes:', ...summarizedCauses] : []),
        ...(summarizedEvents.length ? ['- Events:', ...summarizedEvents] : []),
        ...(summarizedJobs.length ? ['- Jobs:', ...summarizedJobs] : []),
        ...(summarizedMarket.length ? ['- Marketplace:', ...summarizedMarket] : []),
        ...(summarizedOrganizations.length ? ['- Organizations:', ...summarizedOrganizations] : []),
        ...(summarizedPosts.length ? ['- Posts:', ...summarizedPosts] : []),
        ...(summarizedTopics.length ? ['- Topics:', ...summarizedTopics] : []),
        '',
        'Answering rules for fetched Civil data:',
        '- Use the fetched Civil data when it answers the user directly.',
        '- If there are no matching results, say so plainly.',
        '- Never fabricate extra Civil items when the fetched result count is low or zero.',
        '- Never claim a count larger than the number of returned Civil items.',
        '- Do not mention old or unrelated far-away events when the user asks about what is near them.',
        '- For posts and organizations, stay anchored to the returned local community data unless the user explicitly asks to broaden the search.',
        '- Do not paste raw Civil URLs into the answer when a linked Civil item is available in the fetched data.',
        '- Refer to linked Civil items naturally and let the UI card carry the destination link and metadata.',
        '- When helpful, mention linked Civil items from the fetched data naturally in the answer.',
      )
    }

    return {
      viewerContext,
      references: deps.finalizeCivilAiReferences(latestQuestion, references),
      grounding: {
        retrievalPlan: retrieval,
        searchPass,
        targetCommunities,
        causes: usableCauses.slice(0, 8),
        events: usableEvents.slice(0, 8),
        jobs: usableJobs.slice(0, 8),
        market: marketResults.slice(0, 8),
        organizations: usableOrganizations.slice(0, 8),
        posts: usablePosts.slice(0, 8),
        topics: usableTopics.slice(0, 8),
      },
      debug: {
        latestQuestion,
        retrievalPlan: retrieval,
        requestedCommunities,
        targetCommunities,
        availableCommunityCount: defaultCommunities.length,
        marketScopeMode: marketScope.mode,
        searchPass,
        topicQueryUsed: topicQuery || null,
        resultCounts: {
          causes: usableCauses.length,
          events: usableEvents.length,
          jobs: usableJobs.length,
          market: marketResults.length,
          organizations: usableOrganizations.length,
          posts: usablePosts.length,
          topics: usableTopics.length,
        },
        includedViewerOrganizations: retrieval.includeViewerOrganizations && Boolean(viewerContext?.organizations.length),
      },
      prompt: promptSections.join('\n'),
    }
  }

  async function executeCivilAiChatRequest(args: {
    body: CivilAiChatInputPayload
    conversationId: string
    userId: string | null
    upstreamTimeoutMs?: number | null
    signal?: AbortSignal
    logger?: CivilAiExecutionLogger
  }): Promise<CivilAiChatResponsePayload> {
    const activeMessages = deps.selectCivilAiActiveMessages(args.body.messages)
    const latestUserMessage = deps.buildCivilAiEffectiveQuestion(args.body.messages)

    const requestStartedAt = Date.now()
    let status = 'error'
    let errorMessage: string | null = null
    let resolvedModel: string | null = null
    let resolvedServer: CivilAiServerConfig | null = null
    let retrievalBundle: CivilAiRetrievalBundleLike | null = null
    let upstreamInput: string | null = null
    let assistantContent: string | null = null
    let rawResponse: unknown = null
    let persistedHistory: CivilAiHistoryEntry[] | null = null

    try {
      retrievalBundle = await buildCivilAiRetrievalBundle(args.userId ?? null, latestUserMessage)

      const directAnswer = deps.buildCivilAiDirectAnswer(latestUserMessage, retrievalBundle.viewerContext)
      if (directAnswer) {
        assistantContent = directAnswer.content
        status = 'direct_answer'
        persistedHistory = args.userId
          ? await deps.persistCivilAiHistory(args.userId, [
              {
                role: 'user',
                content: args.body.messages[args.body.messages.length - 1]?.content ?? '',
                createdAt: new Date().toISOString(),
              },
              {
                role: 'assistant',
                content: directAnswer.content,
                createdAt: new Date().toISOString(),
                references: directAnswer.references,
              },
            ])
          : null

        return {
          conversationId: args.conversationId,
          message: {
            role: 'assistant',
            content: directAnswer.content,
            references: directAnswer.references,
          },
          model: null,
          server: null,
          viewerContext: retrievalBundle.viewerContext,
          history: persistedHistory,
          raw: null,
        }
      }

      if (deps.shouldCivilAiRunSecondSearch(latestUserMessage, retrievalBundle)) {
        retrievalBundle = await buildCivilAiRetrievalBundle(args.userId ?? null, latestUserMessage, { searchPass: 2 })
      }

      const groundedAnswer = deps.buildCivilAiGroundedAnswer(latestUserMessage, retrievalBundle.grounding)
      if (groundedAnswer) {
        assistantContent = groundedAnswer.content
        status = 'grounded_answer'
        persistedHistory = args.userId
          ? await deps.persistCivilAiHistory(args.userId, [
              {
                role: 'user',
                content: args.body.messages[args.body.messages.length - 1]?.content ?? '',
                createdAt: new Date().toISOString(),
              },
              {
                role: 'assistant',
                content: groundedAnswer.content,
                createdAt: new Date().toISOString(),
                references: groundedAnswer.references,
              },
            ])
          : null

        return {
          conversationId: args.conversationId,
          message: {
            role: 'assistant',
            content: groundedAnswer.content,
            references: groundedAnswer.references,
          },
          model: null,
          server: null,
          viewerContext: retrievalBundle.viewerContext,
          history: persistedHistory,
          raw: null,
        }
      }

      const resolved = await deps.resolveCivilAiServer(args.body.serverId)
      resolvedServer = resolved.server
      if (!resolved.server) {
        status = 'no_ai_server_available'
        errorMessage = 'no_ai_server_available'
        throw new Error('no_ai_server_available')
      }
      resolvedModel = await deps.resolveCivilAiModel(resolved.server, args.body.model)
      if (!resolvedModel) {
        const normalizedProvider = (resolved.server.provider || '').trim().toLowerCase()
        const azureModelError =
          normalizedProvider === 'azure-openai' || normalizedProvider.includes('azure')
            ? 'azure_ai_deployment_not_configured'
            : 'no_ai_model_available'
        status = azureModelError
        errorMessage = azureModelError
        throw new Error(azureModelError)
      }

      const instructions = await deps.loadCivilAiInstructions()
      const combinedInstructions = [instructions.content, retrievalBundle.prompt].filter(Boolean).join('\n\n')
      const upstreamMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: combinedInstructions },
        ...activeMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ]
      upstreamInput = deps.buildCivilAiPromptInput(combinedInstructions, upstreamMessages)

      const upstream = await deps.callCivilAiServerWithPathFallback({
        server: resolved.server,
        paths: getCivilAiChatPaths(resolved.server),
        method: 'POST',
        timeoutMs: args.upstreamTimeoutMs,
        signal: args.signal,
        body: buildCivilAiUpstreamBody({
          server: resolved.server,
          model: resolvedModel,
          input: upstreamInput,
          temperature: args.body.temperature,
          topP: args.body.topP,
          maxTokens: args.body.maxTokens,
        }),
      })

      rawResponse = upstream.json ?? upstream.text?.trim() ?? null
      if (!upstream.ok) {
        status = 'ai_chat_failed'
        errorMessage = upstream.text || 'ai_chat_failed'
        throw new Error(upstream.text || 'ai_chat_failed')
      }

      const rawContent = deps.extractCivilAiMessageContent(upstream.json)
      const content = deps.sanitizeCivilAiResponseContent(rawContent, retrievalBundle.references)
      if (!content) {
        status = 'ai_empty_response'
        errorMessage = 'ai_empty_response'
        throw new Error('ai_empty_response')
      }

      assistantContent = content
      status = 'completed'
      persistedHistory = args.userId
        ? await deps.persistCivilAiHistory(args.userId, [
            {
              role: 'user',
              content: args.body.messages[args.body.messages.length - 1]?.content ?? '',
              createdAt: new Date().toISOString(),
            },
            {
              role: 'assistant',
              content,
              createdAt: new Date().toISOString(),
              references: retrievalBundle.references,
            },
          ])
        : null

      return {
        conversationId: args.conversationId,
        message: {
          role: 'assistant',
          content,
          references: retrievalBundle.references,
        },
        model: resolvedModel,
        server: resolved.server,
        viewerContext: retrievalBundle.viewerContext,
        history: persistedHistory,
        raw: upstream.json,
      }
    } finally {
      try {
        await deps.persistCivilAiDebugTurn({
          conversationId: args.conversationId,
          userId: args.userId,
          latestUserMessage,
          requestMessages: activeMessages.map((message) => ({ role: message.role, content: message.content })),
          viewerContext: retrievalBundle?.viewerContext ?? null,
          retrievalDebug: retrievalBundle
            ? {
                ...retrievalBundle.debug,
                directAnswerUsed: status === 'direct_answer',
                groundedAnswerUsed: status === 'grounded_answer',
                upstreamInputChars: upstreamInput?.length ?? 0,
                serverTarget: resolvedServer
                  ? {
                      id: resolvedServer.id,
                      name: resolvedServer.name,
                      baseUrl: resolvedServer.baseUrl,
                    }
                  : null,
              }
            : null,
          references:
            status === 'direct_answer'
              ? deps.buildCivilAiDirectAnswer(latestUserMessage, retrievalBundle?.viewerContext ?? null)?.references ?? []
              : status === 'grounded_answer'
                ? deps.buildCivilAiGroundedAnswer(latestUserMessage, retrievalBundle?.grounding ?? {
                    retrievalPlan: deps.planCivilAiRetrieval(latestUserMessage),
                    searchPass: 1,
                    targetCommunities: [],
                    causes: [],
                    events: [],
                    jobs: [],
                    market: [],
                    organizations: [],
                    posts: [],
                    topics: [],
                  })?.references ?? []
                : retrievalBundle?.references ?? [],
          serverName: resolvedServer?.name ?? null,
          model: resolvedModel,
          upstreamInput,
          assistantContent,
          rawResponse,
          status,
          errorMessage,
          durationMs: Date.now() - requestStartedAt,
        })
      } catch (error) {
        args.logger?.error({ err: error }, 'civil_ai_debug_log_failed')
      }
    }
  }

  async function createCivilAiChatJob(args: {
    conversationId: string
    userId: string | null
    body: CivilAiChatInputPayload
    latestUserMessage: string
  }) {
    await deps.ensureCivilAiJobTables()
    const jobId = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO civil_ai_job (
        id, conversation_id, user_id, status, request_body_text, latest_user_message, created_at, updated_at
      )
      VALUES (
        ${jobId}, ${args.conversationId}, ${args.userId}, ${'queued'}, ${safeJsonStringify(args.body) ?? '{}'}, ${args.latestUserMessage}, NOW(), NOW()
      )
    `
    return jobId
  }

  async function loadActiveCivilAiChatJobForUser(userId: string) {
    await deps.ensureCivilAiJobTables()
    const rows = await prisma.$queryRaw<CivilAiJobRow[]>`
      SELECT
        id,
        conversation_id,
        user_id,
        status,
        request_body_text,
        latest_user_message,
        response_text,
        error_text,
        server_name,
        model,
        created_at,
        started_at,
        completed_at,
        updated_at
      FROM civil_ai_job
      WHERE user_id = ${userId}
        AND (status = ${'queued'} OR status = ${'processing'})
      ORDER BY created_at DESC
      LIMIT 1
    `
    return rows[0] ?? null
  }

  async function loadCivilAiChatJob(jobId: string) {
    await deps.ensureCivilAiJobTables()
    const rows = await prisma.$queryRaw<CivilAiJobRow[]>`
      SELECT
        id,
        conversation_id,
        user_id,
        status,
        request_body_text,
        latest_user_message,
        response_text,
        error_text,
        server_name,
        model,
        created_at,
        started_at,
        completed_at,
        updated_at
      FROM civil_ai_job
      WHERE id = ${jobId}
      LIMIT 1
    `
    return rows[0] ?? null
  }

  async function processCivilAiChatJob(jobId: string) {
    if (deps.processingJobIds.has(jobId)) return
    deps.processingJobIds.add(jobId)

    try {
      await deps.ensureCivilAiJobTables()
      const claimedRows = await prisma.$queryRaw<CivilAiJobRow[]>`
        UPDATE civil_ai_job
        SET
          status = ${'processing'},
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW(),
          error_text = NULL
        WHERE id = ${jobId}
          AND status = ${'queued'}
        RETURNING
          id,
          conversation_id,
          user_id,
          status,
          request_body_text,
          latest_user_message,
          response_text,
          error_text,
          server_name,
          model,
          created_at,
          started_at,
          completed_at,
          updated_at
      `
      const job = claimedRows[0]
      if (!job) return

      const parsedBody = parseLoggedJsonText<unknown>(job.request_body_text)
      const body = CivilAiChatInput.safeParse(parsedBody ?? {})
      if (!body.success) {
        await prisma.$executeRaw`
          UPDATE civil_ai_job
          SET
            status = ${'failed'},
            error_text = ${JSON.stringify(body.error.flatten())},
            completed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${jobId}
        `
        return
      }

      try {
        const upstreamController = new AbortController()
        deps.jobAbortControllers.set(jobId, upstreamController)
        const result = await executeCivilAiChatRequest({
          body: body.data,
          conversationId: job.conversation_id,
          userId: job.user_id,
          upstreamTimeoutMs: CIVIL_AI_JOB_TIMEOUT_MS,
          signal: upstreamController.signal,
          logger: deps.logger,
        })
        deps.jobAbortControllers.delete(jobId)
        await prisma.$executeRaw`
          UPDATE civil_ai_job
          SET
            status = ${'completed'},
            response_text = ${safeJsonStringify(result)},
            error_text = NULL,
            server_name = ${result.server?.name ?? null},
            model = ${result.model},
            completed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${jobId}
        `
      } catch (error) {
        deps.jobAbortControllers.delete(jobId)
        const latestJob = await deps.loadCivilAiChatJob(jobId)
        if (latestJob?.status === 'cancelled') {
          return
        }
        deps.logger.error({ err: error, jobId }, 'civil_ai_job_failed')
        await prisma.$executeRaw`
          UPDATE civil_ai_job
          SET
            status = ${'failed'},
            error_text = ${deps.serializeError(error)},
            completed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${jobId}
        `
      }
    } finally {
      deps.processingJobIds.delete(jobId)
    }
  }

  function scheduleCivilAiChatJob(jobId: string) {
    queueMicrotask(() => {
      void processCivilAiChatJob(jobId)
    })
  }

  function formatCivilAiChatJobPayload(job: CivilAiJobRow) {
    const parsedResponse = parseLoggedJsonText<CivilAiChatResponsePayload>(job.response_text)
    return {
      jobId: job.id,
      conversationId: job.conversation_id,
      status: job.status as CivilAiJobStatus,
      message: parsedResponse?.message ?? null,
      error: job.error_text ?? null,
      completedAt: job.completed_at ? job.completed_at.toISOString() : null,
      startedAt: job.started_at ? job.started_at.toISOString() : null,
      createdAt: job.created_at.toISOString(),
    }
  }

  async function cancelCivilAiChatJob(jobId: string) {
    await deps.ensureCivilAiJobTables()
    const updatedRows = await prisma.$queryRaw<CivilAiJobRow[]>`
      UPDATE civil_ai_job
      SET
        status = ${'cancelled'},
        error_text = ${'ai_request_cancelled'},
        completed_at = COALESCE(completed_at, NOW()),
        updated_at = NOW()
      WHERE id = ${jobId}
        AND (status = ${'queued'} OR status = ${'processing'})
      RETURNING
        id,
        conversation_id,
        user_id,
        status,
        request_body_text,
        latest_user_message,
        response_text,
        error_text,
        server_name,
        model,
        created_at,
        started_at,
        completed_at,
        updated_at
    `
    const job = updatedRows[0] ?? null
    if (job) {
      deps.jobAbortControllers.get(jobId)?.abort('user_cancelled')
      deps.jobAbortControllers.delete(jobId)
    }
    return job
  }

  return {
    buildCivilAiRetrievalBundle,
    cancelCivilAiChatJob,
    createCivilAiChatJob,
    executeCivilAiChatRequest,
    formatCivilAiChatJobPayload,
    loadActiveCivilAiChatJobForUser,
    loadCivilAiChatJob,
    scheduleCivilAiChatJob,
  }
}
