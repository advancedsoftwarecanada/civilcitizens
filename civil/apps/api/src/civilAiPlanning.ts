type CivilAiCardReferenceLike = {
  kind: string
  id: string
  title: string
  subtitle: string | null
  summary: string | null
  href: string
  imageUrl: string | null
  badge: string | null
}

type CivilAiCommunityLike = {
  id: string
  communityName: string
  provinceName: string
  communitySlug: string
  provinceCode: string
  href: string
  isHome?: boolean
}

type CivilAiOrganizationLike = {
  id: string
  name: string
  slug?: string
  provinceCode?: string | null
  communitySlug?: string | null
  role?: string | undefined
  href?: string | null
  logoUrl?: string | null
  coverUrl?: string | null
  description?: string | null
  communityName?: string | null
}

type CivilAiViewerContextLike = {
  user: {
    handle: string
    firstName: string | null
    lastName: string | null
    name: string | null
    bio: string | null
    experiences: Array<{
      title: string
      organization: string
      current: boolean
      organizationProfile?: {
        id: string
        name: string
        slug: string
        href: string | null
        logoUrl: string | null
        coverUrl: string | null
      } | null
    }>
  }
  homeCommunity: CivilAiCommunityLike | null
  nearbyCommunities: CivilAiCommunityLike[]
  followedCommunities: Array<CivilAiCommunityLike & { isHome?: boolean }>
  organizations: Array<CivilAiOrganizationLike & { role: 'owner' | 'member' | 'followed' }>
}

type CivilAiRetrievalPlanLike = {
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

type CivilAiGroundingBundleLike = {
  retrievalPlan: CivilAiRetrievalPlanLike
  searchPass: 1 | 2
  targetCommunities: CivilAiCommunityLike[]
  causes: unknown[]
  events: unknown[]
  jobs: unknown[]
  market: unknown[]
  organizations: unknown[]
  posts: unknown[]
  topics: unknown[]
}

type CivilAiSecondSearchBundleLike = {
  grounding: { searchPass: 1 | 2 }
  debug: {
    resultCounts: {
      causes: number
      events: number
      jobs: number
      market: number
      organizations: number
      posts: number
      topics: number
    }
    retrievalPlan: CivilAiRetrievalPlanLike
    availableCommunityCount: number
    targetCommunities: Array<unknown>
    marketScopeMode: 'global' | 'community' | 'province'
  }
}

type CivilAiPlanningDeps = {
  maxReferenceCards: number
  getCivilApiBaseUrl: () => string
  truncateCivilAiText: (value: string, maxChars: number, keepTail?: boolean) => string
  normalizeSearchTerm: (value: string) => string
  normalizeProvinceCode: (value: string) => string | null
  toCivilAiCauseReference: (item: unknown) => CivilAiCardReferenceLike
  toCivilAiEventReference: (item: unknown) => CivilAiCardReferenceLike
  toCivilAiJobReference: (item: unknown) => CivilAiCardReferenceLike | null
  toCivilAiMarketReference: (item: unknown) => CivilAiCardReferenceLike
  toCivilAiOrganizationReference: (item: unknown) => CivilAiCardReferenceLike | null
  toCivilAiPostReference: (item: unknown) => CivilAiCardReferenceLike
  toCivilAiTopicReference: (item: unknown) => CivilAiCardReferenceLike
}

const CIVIL_AI_TOPIC_STOPWORDS = new Set([
  'a',
  'about',
  'active',
  'all',
  'an',
  'and',
  'any',
  'are',
  'around',
  'association',
  'associations',
  'at',
  'buy',
  'buying',
  'can',
  'city',
  'communities',
  'community',
  'conversation',
  'conversations',
  'debate',
  'debates',
  'discussing',
  'discussion',
  'discussions',
  'event',
  'events',
  'for',
  'going',
  'group',
  'groups',
  'happening',
  'hiring',
  'in',
  'is',
  'job',
  'jobs',
  'local',
  'me',
  'my',
  'near',
  'nearby',
  'need',
  'of',
  'on',
  'organization',
  'organizations',
  'people',
  'post',
  'posts',
  'saying',
  'sell',
  'selling',
  'shop',
  'shopping',
  'talking',
  'that',
  'the',
  'there',
  'things',
  'this',
  'today',
  'tonight',
  'town',
  'upcoming',
  'want',
  'what',
  'where',
  'work',
])

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeComparableUrl(value: string) {
  return value.trim().replace(/[)\].,!?;:]+$/g, '').replace(/\/$/, '').toLowerCase()
}

function formatCivilAiCommunityNames(communities: Array<{ communityName: string }>) {
  const unique = communities
    .map((community) => community.communityName.trim())
    .filter(Boolean)
    .filter((name, index, collection) => collection.indexOf(name) === index)

  if (!unique.length) return 'your Civil communities'
  if (unique.length === 1) return unique[0]
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`
}

function formatCivilAiSearchScopeLabel(communities: Array<{ communityName: string }>) {
  return communities.length > 1 ? 'your searched Civil communities' : formatCivilAiCommunityNames(communities)
}

function createCivilAiFeatureReference(args: {
  id: string
  title: string
  subtitle: string
  summary: string
  href: string
  badge: string
}) {
  return {
    kind: 'feature',
    id: args.id,
    title: args.title,
    subtitle: args.subtitle,
    summary: args.summary,
    href: args.href,
    imageUrl: null,
    badge: args.badge,
  } satisfies CivilAiCardReferenceLike
}

function detectCivilAiProfileIntent(question: string) {
  const normalized = question.trim().toLowerCase()
  const asksName = /(what is my name|what'?s my name|do you know my name|who am i|my first name|what is my first name|what'?s my first name|my last name|what is my last name|what'?s my last name|surname|family name|given name)/.test(normalized)
  const asksExperience = /(my experience|my experiences|what experience do i have|what have i done|my background|my work history|my profile)/.test(normalized)
  const asksOrganizations = /(my organizations|what organizations do i belong to|what orgs do i belong to|what groups do i belong to|which organizations am i in|which groups am i in)/.test(normalized)
  const asksBio = /(my bio|my profile bio|what does my bio say)/.test(normalized)
  return {
    asksName,
    asksExperience,
    asksOrganizations,
    asksBio,
    wantsProfile: asksName || asksExperience || asksOrganizations || asksBio,
  }
}

function detectCivilAiAssistantIdentityIntent(question: string) {
  const normalized = question.trim().toLowerCase()
  return /(what is your name|what'?s your name|who are you|who are u|tell me your name|what should i call you|what do i call you)/.test(normalized)
}

function buildCivilAiCompactList(items: string[], emptyLabel: string, limit = 4) {
  const normalized = items.map((item) => item.trim()).filter(Boolean)
  if (!normalized.length) return emptyLabel
  const visible = normalized.slice(0, limit)
  const remainder = normalized.length - visible.length
  return remainder > 0 ? `${visible.join('; ')}; +${remainder} more` : visible.join('; ')
}

export function createCivilAiPlanningHelpers(deps: CivilAiPlanningDeps) {
  function buildCivilAiGroundedAnswer(question: string, bundle: CivilAiGroundingBundleLike) {
    const normalized = question.trim().toLowerCase()
    const profileIntent = detectCivilAiProfileIntent(question)
    const asksCauses = bundle.retrievalPlan.wantsCauses
    const asksDrive = bundle.retrievalPlan.wantsDrive
    const asksEvents = bundle.retrievalPlan.wantsEvents
    const asksJobs = bundle.retrievalPlan.wantsJobs
    const asksMarket = bundle.retrievalPlan.wantsMarket
    const asksOrganizations = bundle.retrievalPlan.wantsOrganizations
    const asksPosts = bundle.retrievalPlan.wantsPosts
    const asksTopics = bundle.retrievalPlan.wantsTopics
    const causeIntent = /(cause|causes|donate|donation|fundraiser|fundraisers|funding|support a cause|civil causes)/.test(normalized)
    const driveIntent = /(drive|ride|rides|driver|drivers|delivery|deliveries|deliver|pickup|drop ?off|trip|trips|route me|take me)/.test(normalized)
    const eventIntent = /(what(?:'s| is) happening|going on|anything happening|event|events|meetup|meetups|metup|metups|networking|networking event|networking events|today|tonight|this afternoon|this evening|near me|nearby|attend)/.test(normalized)
    const jobIntent = /(job|jobs|hiring|employment|position|positions|open role|open roles|work|career|careers)/.test(normalized)
    const marketIntent = /(buy|buying|looking for|looking to buy|where can i buy|shopping|shop for|for sale|marketplace|listing|listings|purchase)/.test(normalized)
    const organizationIntent = /(organization|organizations|group|groups|association|associations|who should i talk to|who is working on|which org|which organization|which organizations|which groups)/.test(normalized)
    const postIntent = /(post|posts|discussion|discussions|conversation|conversations|debate|debates|people saying|talking about|discussing|buzz)/.test(normalized)
    const topicIntent = /(topic|topics|hashtag|hashtags|tag|tags|issue area|issues)/.test(normalized)
    const driveNeedsRide = /(ride request|request a ride|request ride|need a ride|book a ride|find me a ride|ride home|ride to|pickup me|get me to)/.test(normalized)
    const driveNeedsDriverMode = /(driver mode|be a driver|drive for civil|offer rides|open ride requests|earn driving|earn by driving|deliver for civil|delivery jobs|drive jobs)/.test(normalized)
    const driveNeedsDelivery = /(delivery|deliveries|deliver|package|pickup|drop ?off)/.test(normalized)
    const targetLabel = formatCivilAiCommunityNames(bundle.targetCommunities)
    const scopeLabel = formatCivilAiSearchScopeLabel(bundle.targetCommunities)
    const requestedSources = [
      bundle.retrievalPlan.wantsCauses,
      bundle.retrievalPlan.wantsDrive,
      bundle.retrievalPlan.wantsEvents,
      bundle.retrievalPlan.wantsJobs,
      bundle.retrievalPlan.wantsMarket,
      bundle.retrievalPlan.wantsOrganizations,
      bundle.retrievalPlan.wantsPosts,
      bundle.retrievalPlan.wantsTopics,
    ].filter(Boolean).length
    const totalMatches = bundle.causes.length + bundle.events.length + bundle.jobs.length + bundle.market.length + bundle.organizations.length + bundle.posts.length + bundle.topics.length

    const formatCountLabel = (count: number, singular: string, plural: string) => (count === 1 ? `1 ${singular}` : `${count} ${plural}`)
    const workBrowseReference = createCivilAiFeatureReference({
      id: 'work-board',
      title: 'Civil Work',
      subtitle: 'Browse jobs and applications',
      summary: 'Open Civil Work to browse active jobs near you.',
      href: '/work',
      badge: 'Work',
    })
    const eventsBrowseReference = createCivilAiFeatureReference({
      id: 'events-board',
      title: 'Civil Events',
      subtitle: 'Upcoming events',
      summary: 'Open Civil Events to browse nearby events and RSVPs.',
      href: '/events',
      badge: 'Events',
    })
    const marketBrowseReference = createCivilAiFeatureReference({
      id: 'market-board',
      title: 'Civil Market',
      subtitle: 'Marketplace listings',
      summary: 'Open Civil Market to browse active listings and sellers.',
      href: '/market',
      badge: 'Market',
    })
    const causesBrowseReference = createCivilAiFeatureReference({
      id: 'causes-board',
      title: 'Civil Causes',
      subtitle: 'Discover causes',
      summary: 'Open Civil Causes to discover active causes and support community fundraising.',
      href: '/causes',
      badge: 'Cause',
    })
    const topicsBrowseReference = createCivilAiFeatureReference({
      id: 'topics-board',
      title: 'Civil Topics',
      subtitle: 'Browse local topics',
      summary: 'Open Civil Topics to explore hashtags and issue areas people are posting about.',
      href: '/topics',
      badge: 'Topic',
    })

    if (asksDrive && driveIntent) {
      const references = driveNeedsDriverMode
        ? [
            createCivilAiFeatureReference({
              id: 'drive-open-rides',
              title: 'Open Ride Requests',
              subtitle: 'Driver mode',
              summary: 'Browse live ride requests and make offers as a Civil driver.',
              href: '/drive/ride',
              badge: 'Drive',
            }),
            createCivilAiFeatureReference({
              id: 'drive-home',
              title: 'Civil Drive',
              subtitle: 'Rides and deliveries',
              summary: 'Open Civil Drive to manage ride, driver, and delivery activity.',
              href: '/drive',
              badge: 'Drive',
            }),
          ]
        : driveNeedsDelivery
          ? [
              createCivilAiFeatureReference({
                id: 'drive-deliveries',
                title: 'My Deliveries',
                subtitle: 'Delivery contracts',
                summary: 'Open your Civil delivery contracts and driver delivery activity.',
                href: '/delivery/my',
                badge: 'Drive',
              }),
              createCivilAiFeatureReference({
                id: 'drive-home',
                title: 'Civil Drive',
                subtitle: 'Rides and deliveries',
                summary: 'Open Civil Drive to manage ride, driver, and delivery activity.',
                href: '/drive',
                badge: 'Drive',
              }),
            ]
          : [
              createCivilAiFeatureReference({
                id: 'drive-request-ride',
                title: 'Request a Ride',
                subtitle: 'Civil Drive',
                summary: 'Start a new ride request and collect driver offers.',
                href: '/drive/ride/request',
                badge: 'Drive',
              }),
              createCivilAiFeatureReference({
                id: 'drive-home',
                title: 'Civil Drive',
                subtitle: 'Rides and deliveries',
                summary: 'Open Civil Drive to manage ride, driver, and delivery activity.',
                href: '/drive',
                badge: 'Drive',
              }),
            ]

      return {
        content: driveNeedsRide
          ? 'The best place to start is Civil Drive. Use the ride request flow below to post the trip, or open Drive for the full rides and deliveries area.'
          : driveNeedsDriverMode
            ? 'Civil Drive is the right place for that. The best driver-mode entry points are linked below.'
            : 'Civil Drive is the right place for that. The best entry points are linked below.',
        references,
      }
    }

    if (asksCauses && causeIntent) {
      const references = bundle.causes.slice(0, 4).map((cause) => deps.toCivilAiCauseReference(cause))
      if (!bundle.causes.length) {
        return {
          content: [
            `I could not find any matching causes for ${targetLabel} right now.`,
            'You can still browse Civil Causes from the card below.',
          ].join('\n\n'),
          references: [causesBrowseReference],
        }
      }

      return {
        content: bundle.causes.length === 1
          ? `I found 1 matching cause for ${targetLabel}. It is linked below.`
          : `I found ${bundle.causes.length} matching causes for ${targetLabel}. The best matches are linked below.`,
        references,
      }
    }

    if (asksMarket && marketIntent) {
      const references = bundle.market.slice(0, 4).map((listing) => deps.toCivilAiMarketReference(listing))
      if (!bundle.market.length) {
        return {
          content: [
            'I could not find any active marketplace listings that match that search right now.',
            'You can still browse Civil Market from the card below, or I can try a broader item keyword.',
          ].join('\n\n'),
          references: [marketBrowseReference],
        }
      }

      return {
        content: `I found ${formatCountLabel(bundle.market.length, 'matching listing', 'matching listings')}. The best match is linked below.`,
        references,
      }
    }

    if (asksEvents && eventIntent) {
      const references = bundle.events.slice(0, 4).map((event) => deps.toCivilAiEventReference(event))
      if (!bundle.events.length) {
        const timing = bundle.retrievalPlan.todayOnly ? 'today' : 'right now'
        return {
          content: [
            `I could not find any events for ${targetLabel} ${timing}.`,
            bundle.organizations.length || bundle.posts.length
              ? 'If helpful, I can still summarize the local organizations or recent posts tied to that area.'
              : 'You can still browse Civil Events from the card below, or I can check another nearby community instead.',
          ].join('\n\n'),
          references: [eventsBrowseReference],
        }
      }

      return {
        content: bundle.events.length === 1
          ? `I found 1 event for ${scopeLabel}${bundle.retrievalPlan.todayOnly ? ' today' : ''}. It is linked below.`
          : `I found ${bundle.events.length} events for ${scopeLabel}${bundle.retrievalPlan.todayOnly ? ' today' : ''}. The best matches are linked below.`,
        references,
      }
    }

    if (asksJobs && jobIntent) {
      const references = bundle.jobs.slice(0, 4).map((job) => deps.toCivilAiJobReference(job)).filter((entry): entry is CivilAiCardReferenceLike => Boolean(entry))
      if (!bundle.jobs.length) {
        return {
          content: [`I could not find any active jobs for ${targetLabel} right now. You can still browse Civil Work from the card below.`].join('\n\n'),
          references: [workBrowseReference],
        }
      }

      return {
        content: bundle.jobs.length === 1
          ? `I found 1 active job for ${targetLabel}. It is linked below.`
          : `I found ${bundle.jobs.length} active jobs for ${targetLabel}. The best matches are linked below.`,
        references,
      }
    }

    if (asksOrganizations && organizationIntent) {
      const references = bundle.organizations.slice(0, 4).map((organization) => deps.toCivilAiOrganizationReference(organization)).filter((entry): entry is CivilAiCardReferenceLike => Boolean(entry))
      if (!bundle.organizations.length) {
        return {
          content: [`I could not find any matching organizations for ${targetLabel}.`].join('\n\n'),
          references: [] as CivilAiCardReferenceLike[],
        }
      }

      return {
        content: bundle.organizations.length === 1
          ? `I found 1 matching organization for ${targetLabel}. It is linked below.`
          : `I found ${bundle.organizations.length} matching organizations for ${targetLabel}. The best matches are linked below.`,
        references,
      }
    }

    if (asksTopics && topicIntent) {
      const references = bundle.topics.slice(0, 4).map((topic) => deps.toCivilAiTopicReference(topic))
      if (!bundle.topics.length) {
        return {
          content: [`I could not find any matching topics for ${targetLabel}. You can still browse Civil Topics from the card below.`].join('\n\n'),
          references: [topicsBrowseReference],
        }
      }

      return {
        content: bundle.topics.length === 1
          ? `I found 1 matching topic for ${targetLabel}. It is linked below.`
          : `I found ${bundle.topics.length} matching topics for ${targetLabel}. The best matches are linked below.`,
        references,
      }
    }

    if (asksPosts && postIntent) {
      const references = bundle.posts.slice(0, 4).map((post) => deps.toCivilAiPostReference(post))
      if (!bundle.posts.length) {
        return {
          content: [`I could not find any matching local posts for ${targetLabel}.`].join('\n\n'),
          references: [] as CivilAiCardReferenceLike[],
        }
      }

      return {
        content: bundle.posts.length === 1
          ? `I found 1 matching local post for ${targetLabel}. It is linked below.`
          : `I found ${bundle.posts.length} matching local posts for ${targetLabel}. The best matches are linked below.`,
        references,
      }
    }

    if (!profileIntent.wantsProfile && requestedSources > 0 && totalMatches === 0) {
      return {
        content: [`I could not find matching results for ${targetLabel}.`].join('\n\n'),
        references: [
          ...(asksCauses ? [causesBrowseReference] : []),
          ...(asksJobs ? [workBrowseReference] : []),
          ...(asksMarket ? [marketBrowseReference] : []),
          ...(asksEvents ? [eventsBrowseReference] : []),
          ...(asksTopics ? [topicsBrowseReference] : []),
        ].slice(0, deps.maxReferenceCards),
      }
    }

    return null
  }

  function sanitizeCivilAiResponseContent(content: string, references: CivilAiCardReferenceLike[]) {
    let next = content.trim()
    if (!next || !references.length) return next

    const uniqueHrefs = Array.from(new Set(references.map((reference) => reference.href?.trim()).filter((href): href is string => Boolean(href))))

    for (const href of uniqueHrefs) {
      const normalizedHref = normalizeComparableUrl(href)
      if (!normalizedHref) continue

      const escapedHref = escapeRegExp(href)
      next = next.replace(new RegExp(`\\[([^\\]]+)\\]\\(${escapedHref}\\)`, 'gi'), '$1')
      next = next.replace(new RegExp(`\\(?${escapedHref}\\)?`, 'gi'), 'the Civil card below')
    }

    next = next
      .replace(/^view\s+(cause|event|feature|job|community|organization|post|topic):\s*$/gim, '')
      .replace(/here:\s*the Civil card below/gi, 'in the Civil card below')
      .replace(/details\s+about\s+it\s+the Civil card below/gi, 'details in the Civil card below')
      .replace(/\(\s*the Civil card below\s*\)/gi, 'the Civil card below')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()

    return next
  }

  function buildCivilAiDirectAnswer(question: string, viewerContext: CivilAiViewerContextLike | null) {
    if (detectCivilAiAssistantIdentityIntent(question)) {
      return {
        content: 'I am Civil AI, your civic assistant inside Civil Citizens.',
        references: [] as CivilAiCardReferenceLike[],
      }
    }

    if (!viewerContext) return null
    const normalized = question.trim().toLowerCase()
    const { asksName, asksExperience, asksOrganizations, asksBio } = detectCivilAiProfileIntent(question)
    const asksFirstName = /(my first name|what is my first name|what'?s my first name|given name)/.test(normalized)
    const asksLastName = /(my last name|what is my last name|what'?s my last name|surname|family name)/.test(normalized)

    if (!asksName && !asksExperience && !asksOrganizations && !asksBio) return null

    const lines: string[] = []
    const references: CivilAiCardReferenceLike[] = []

    if (asksName) {
      const displayName = viewerContext.user.name || [viewerContext.user.firstName, viewerContext.user.lastName].filter(Boolean).join(' ').trim() || `@${viewerContext.user.handle}`
      if (asksFirstName && viewerContext.user.firstName) {
        lines.push(`Your first name on Civil is ${viewerContext.user.firstName}.`)
      } else if (asksLastName && viewerContext.user.lastName) {
        lines.push(`Your last name on Civil is ${viewerContext.user.lastName}.`)
      } else {
        lines.push(`Your name on Civil is ${displayName}.`)
      }
    }

    if (asksBio) {
      lines.push(viewerContext.user.bio ? `Your Civil bio says: ${viewerContext.user.bio}` : 'I do not see a bio in your Civil profile yet.')
    }

    if (asksExperience) {
      if (viewerContext.user.experiences.length) {
        const summary = viewerContext.user.experiences
          .slice(0, 3)
          .map((experience) => `${experience.title} at ${experience.organization}${experience.current ? ' (current)' : ''}`)
          .join('; ')
        lines.push(`Your experience on file includes ${summary}.`)
        for (const experience of viewerContext.user.experiences.slice(0, 3)) {
          if (!experience.organizationProfile) continue
          const reference = deps.toCivilAiOrganizationReference({
            ...experience.organizationProfile,
            role: undefined,
            description: null,
            communityName: null,
          })
          if (reference) references.push(reference)
        }
      } else {
        lines.push('I do not see any experience entries in your Civil profile yet.')
      }
    }

    if (asksOrganizations) {
      if (viewerContext.organizations.length) {
        const summary = viewerContext.organizations
          .slice(0, 4)
          .map((org) => `${org.name} (${org.role})`)
          .join('; ')
        lines.push(`Your Civil organization context includes ${summary}.`)
        for (const org of viewerContext.organizations.slice(0, 4)) {
          const reference = deps.toCivilAiOrganizationReference({ ...org, description: null, communityName: null })
          if (reference) references.push(reference)
        }
      } else {
        lines.push('I do not see any organizations linked to your Civil account yet.')
      }
    }

    return {
      content: lines.join('\n\n').trim(),
      references: references.slice(0, 4),
      decision: {
        type: 'direct-profile-answer',
        asksName,
        asksExperience,
        asksOrganizations,
        asksBio,
      },
    }
  }

  function buildCivilAiApiCatalog(viewerContext: CivilAiViewerContextLike | null) {
    const apiBaseUrl = deps.getCivilApiBaseUrl()
    const suggestedCommunityId = viewerContext?.homeCommunity?.id ?? viewerContext?.followedCommunities[0]?.id ?? 'ON:newmarket'
    return [
      {
        name: 'Current User Context',
        endpoint: `${apiBaseUrl}/ai/context`,
        purpose: 'Current signed-in user profile, home community, nearby communities, followed communities, and organizations.',
      },
      {
        name: 'Community Summary',
        endpoint: `${apiBaseUrl}/ai/communities/${encodeURIComponent(suggestedCommunityId)}`,
        purpose: 'Structured community identity and direct Civil URL for a community.',
      },
      {
        name: 'Community Events',
        endpoint: `${apiBaseUrl}/ai/events/${encodeURIComponent(suggestedCommunityId)}?when=today`,
        purpose: 'Upcoming or today-only events for a specific community. Filters out stale events.',
      },
      {
        name: 'Community Jobs',
        endpoint: `${apiBaseUrl}/ai/jobs/${encodeURIComponent(suggestedCommunityId)}`,
        purpose: 'Active jobs in a community from local organizations or local job locations.',
      },
      {
        name: 'Community Causes',
        endpoint: `${apiBaseUrl}/ai/causes/${encodeURIComponent(suggestedCommunityId)}`,
        purpose: 'Active cause posts in a specific community, optionally filtered by a cause or donation query.',
      },
      {
        name: 'Marketplace Listings',
        endpoint: `${apiBaseUrl}/ai/market?q=skateboard`,
        purpose: 'Active marketplace listings that match a shopping or buying query.',
      },
      {
        name: 'Community Organizations',
        endpoint: `${apiBaseUrl}/ai/organizations/${encodeURIComponent(suggestedCommunityId)}`,
        purpose: 'Active organizations in a specific community, optionally filtered by a topic query.',
      },
      {
        name: 'Community Posts',
        endpoint: `${apiBaseUrl}/ai/posts/${encodeURIComponent(suggestedCommunityId)}`,
        purpose: 'Recent public posts in a specific community, optionally filtered by a topic query.',
      },
      {
        name: 'Community Topics',
        endpoint: `${apiBaseUrl}/ai/topics/${encodeURIComponent(suggestedCommunityId)}`,
        purpose: 'Topics and hashtags with recent public post activity in a specific community.',
      },
    ]
  }

  function buildCivilAiContextSummary(viewerContext: CivilAiViewerContextLike | null) {
    if (!viewerContext) {
      return ['- Authenticated user context: unavailable']
    }

    const displayName = viewerContext.user.name || [viewerContext.user.firstName, viewerContext.user.lastName].filter(Boolean).join(' ').trim() || `@${viewerContext.user.handle}`
    const nearby = buildCivilAiCompactList(viewerContext.nearbyCommunities.map((community) => community.communityName), 'none', 4)
    const followed = buildCivilAiCompactList(viewerContext.followedCommunities.map((community) => community.communityName), 'none', 5)
    const organizations = buildCivilAiCompactList(viewerContext.organizations.map((organization) => `${organization.name} (${organization.role})`), 'none', 5)
    const experiences = buildCivilAiCompactList(viewerContext.user.experiences.map((experience) => `${experience.title} at ${experience.organization}${experience.current ? ' (current)' : ''}`), 'none', 4)

    return [
      `- User: ${displayName} (@${viewerContext.user.handle})`,
      viewerContext.user.bio ? `- Bio: ${deps.truncateCivilAiText(viewerContext.user.bio, 180)}` : '- Bio: none',
      `- Home community: ${viewerContext.homeCommunity ? viewerContext.homeCommunity.communityName : 'none'}`,
      `- Nearby communities: ${nearby}`,
      `- Followed communities: ${followed}`,
      `- Organizations: ${organizations}`,
      `- Experience: ${experiences}`,
    ]
  }

  function buildCivilAiCatalogSummary(viewerContext: CivilAiViewerContextLike | null) {
    return buildCivilAiApiCatalog(viewerContext).map((entry) => `- ${entry.name}: ${entry.purpose}`)
  }

  function buildCivilAiContextPrompt(viewerContext: CivilAiViewerContextLike | null) {
    return [
      'Current Civil User Context:',
      ...buildCivilAiContextSummary(viewerContext),
      '',
      'Available Civil AI Data Endpoints:',
      ...buildCivilAiCatalogSummary(viewerContext),
      '',
      'Rules for signed-in user context:',
      '- If a current signed-in user context block is present, you do know that user\'s provided profile data for this conversation.',
      '- You may use the provided first name, last name, display name, experience history, home community, and organizations to answer personally relevant questions.',
      '- The signed-in user context describes the user, not the assistant.',
      '- If the user asks who you are or asks for your name, answer as Civil AI and do not answer with the signed-in user\'s profile.',
      '- Do not claim you lack access to the user\'s name or organizations if those fields are present in the context block.',
      '- Only say information is unavailable when the specific field is actually missing from the provided context.',
      '',
      'Rules for local data answers:',
      '- Prefer the current user context over generic assumptions.',
      '- You do not have any external events, jobs, organization, or post database beyond the provided Civil data for this question.',
      '- Never invent events, jobs, organizations, posts, communities, counts, dates, addresses, or links that are not present in the provided Civil data.',
      '- Never imply there are more matching Civil items than were actually returned.',
      '- Prefer home, nearby, or followed communities before anything farther away.',
      '- For events, ignore stale past items unless the user explicitly asks about history.',
      '- If the request asks about today, only use today-filtered events.',
      '- For posts and organizations, prefer matches from the target local communities before broader discovery.',
      '- If live data is missing, say that plainly instead of inventing specifics.',
    ].join('\n')
  }

  function extractCivilAiTopicQuery(question: string) {
    const normalized = deps.normalizeSearchTerm(question).toLowerCase()
    if (!normalized) return ''

    return normalized
      .split(' ')
      .filter((token) => token.length > 2 && !CIVIL_AI_TOPIC_STOPWORDS.has(token))
      .slice(0, 8)
      .join(' ')
  }

  function isCivilAiGeneralChatQuestion(question: string) {
    const normalized = question.trim().toLowerCase()
    if (!normalized) return false

    return /(^|\b)(joke|jokes|funny|humor|meme|memes|lol|lmao|roast|roast me|say something funny|tell me something funny|hello|hi|hey|good morning|good afternoon|good evening|how are you|thanks|thank you)(\b|$)/.test(normalized)
  }

  function hasCivilAiCivicSignal(question: string) {
    const normalized = question.trim().toLowerCase()
    if (!normalized) return false

    return /(community|communities|local|near me|nearby|my area|my city|my town|riding|event|events|meeting|meetup|job|jobs|hiring|employment|work|marketplace|listing|listings|buy|organization|organizations|group|groups|association|associations|post|posts|discussion|discussions|cause|causes|donate|donation|topic|topics|hashtag|drive|ride|rides|driver|delivery|deliveries|civic|council|mayor|bylaw|permit|housing|transit|school|election|vote|voting|policy|policies|government)/.test(normalized)
  }

  function extractCivilAiReferenceKeywords(question: string) {
    const normalized = deps.normalizeSearchTerm(question).toLowerCase()
    if (!normalized) return [] as string[]

    return Array.from(
      new Set(
        normalized
          .split(' ')
          .map((token) => token.trim())
          .filter((token) => token.length > 2)
          .filter((token) => !CIVIL_AI_TOPIC_STOPWORDS.has(token))
          .filter((token) => token !== 'civil' && token !== 'citizens'),
      ),
    ).slice(0, 10)
  }

  function scoreCivilAiReferenceRelevance(question: string, reference: CivilAiCardReferenceLike) {
    const normalizedQuestion = deps.normalizeSearchTerm(question).toLowerCase()
    const topicQuery = extractCivilAiTopicQuery(question)
    const keywords = extractCivilAiReferenceKeywords(question)
    const title = deps.normalizeSearchTerm(reference.title).toLowerCase()
    const subtitle = deps.normalizeSearchTerm(reference.subtitle ?? '').toLowerCase()
    const summary = deps.normalizeSearchTerm(reference.summary ?? '').toLowerCase()
    const badge = deps.normalizeSearchTerm(reference.badge ?? '').toLowerCase()
    const combined = [title, subtitle, summary, badge, reference.kind].filter(Boolean).join(' ')

    let score = 0
    if (topicQuery && topicQuery.length >= 5) {
      if (title.includes(topicQuery)) score += 7
      else if (subtitle.includes(topicQuery) || summary.includes(topicQuery)) score += 4
    }

    for (const keyword of keywords) {
      if (title.includes(keyword)) {
        score += 3
        continue
      }
      if (subtitle.includes(keyword)) {
        score += 2
        continue
      }
      if (summary.includes(keyword) || badge.includes(keyword)) {
        score += 1
      }
    }

    const explicitEventIntent = /(event|events|festival|meeting|meetup|meetups|networking|rally|parade|attend)/.test(normalizedQuestion)
    const explicitJobIntent = /(job|jobs|hiring|employment|position|positions|open role|open roles|work)/.test(normalizedQuestion)
    const explicitMarketIntent = /(buy|buying|shopping|shop for|for sale|marketplace|listing|listings|purchase)/.test(normalizedQuestion)
    const explicitCauseIntent = /(cause|causes|donate|donation|fundraiser|fundraisers|funding)/.test(normalizedQuestion)
    const explicitDriveIntent = /(drive|ride|rides|driver|drivers|delivery|deliveries|deliver|pickup|drop ?off|trip|trips)/.test(normalizedQuestion)
    const explicitOrganizationIntent = /(organization|organizations|group|groups|association|associations|who should i talk to|who is working on|which org|which organization|which organizations|which groups)/.test(normalizedQuestion)
    const explicitPostIntent = /(post|posts|article|articles|discussion|discussions|conversation|conversations|debate|debates|people saying|talking about|discussing|buzz)/.test(normalizedQuestion)
    const explicitTopicIntent = /(topic|topics|hashtag|hashtags|tag|tags|issue area|issues)/.test(normalizedQuestion)
    const explicitCommunityIntent = /(community|communities|riding|municipality|city|town|district|area|neighbourhood|neighborhood)/.test(normalizedQuestion)
    const asksAboutOwnPost = /(i wrote|i posted|my post|my posts|my article|my articles|article i wrote|post i wrote)/.test(normalizedQuestion)

    if (explicitCauseIntent && reference.kind === 'cause') score += 4
    if (explicitDriveIntent && reference.kind === 'feature' && reference.href.startsWith('/drive')) score += 5
    if (explicitEventIntent && reference.kind === 'event') score += 4
    if (explicitJobIntent && reference.kind === 'job') score += 4
    if (explicitMarketIntent && reference.kind === 'market') score += 4
    if (explicitOrganizationIntent && reference.kind === 'organization') score += 4
    if (explicitPostIntent && reference.kind === 'post') score += 4
    if (explicitTopicIntent && reference.kind === 'topic') score += 4
    if (explicitCommunityIntent && reference.kind === 'community') score += 3
    if (asksAboutOwnPost) score += reference.kind === 'post' ? 5 : -3

    if ((explicitPostIntent || asksAboutOwnPost) && (reference.kind === 'community' || reference.kind === 'organization') && !keywords.some((keyword) => combined.includes(keyword))) {
      score -= 2
    }

    return score
  }

  function finalizeCivilAiReferences(question: string, references: CivilAiCardReferenceLike[]) {
    if (!references.length) return [] as CivilAiCardReferenceLike[]
    if (isCivilAiGeneralChatQuestion(question) && !hasCivilAiCivicSignal(question)) {
      return [] as CivilAiCardReferenceLike[]
    }

    const seen = new Set<string>()
    const scored: Array<{ reference: CivilAiCardReferenceLike; score: number }> = []
    for (const reference of references) {
      const key = `${reference.kind}:${reference.id}:${reference.href}`
      if (seen.has(key)) continue
      seen.add(key)
      scored.push({ reference, score: scoreCivilAiReferenceRelevance(question, reference) })
    }

    scored.sort((left, right) => right.score - left.score)
    const topScore = scored[0]?.score ?? 0
    if (topScore <= 0) return [] as CivilAiCardReferenceLike[]

    const minimumScore = topScore >= 7 ? Math.max(3, topScore - 4) : Math.max(2, topScore - 2)
    return scored
      .filter((entry) => entry.score >= minimumScore)
      .slice(0, deps.maxReferenceCards)
      .map((entry) => entry.reference)
  }

  function planCivilAiRetrieval(question: string): CivilAiRetrievalPlanLike {
    const normalized = question.toLowerCase()
    const topicQuery = extractCivilAiTopicQuery(question)
    const profileIntent = detectCivilAiProfileIntent(question)
    const generalChatIntent = isCivilAiGeneralChatQuestion(question)
    const civicSignal = hasCivilAiCivicSignal(question)

    const explicitCauses = /(cause|causes|donate|donation|fundraiser|fundraisers|funding|support a cause)/.test(normalized)
    const explicitDrive = /(drive|ride|rides|driver|drivers|delivery|deliveries|deliver|pickup|drop ?off|trip|trips)/.test(normalized)
    const explicitEvents = /(event|events|festival|meeting|meetup|meetups|metup|metups|networking|networking event|networking events|parade|rally|attend)/.test(normalized)
    const explicitJobs = /(job|jobs|hiring|employment|position|positions|open role|open roles|work|career|careers)/.test(normalized)
    const explicitMarket = /(buy|buying|looking for|looking to buy|where can i buy|shopping|shop for|for sale|marketplace|listing|listings|purchase)/.test(normalized)
    const explicitOrganizations = /(organization|organizations|group|groups|association|associations)/.test(normalized)
    const explicitPosts = /(post|posts|discussion|discussions|conversation|conversations|debate|debates)/.test(normalized)
    const explicitTopics = /(topic|topics|hashtag|hashtags|tag|tags|issue area|issues)/.test(normalized)
    const asksWhatIsHappening = /(what(?:'s| is) happening|going on|anything happening|what(?:'s| is) going on)/.test(normalized)
    const asksWhatPeopleAreSaying = /(people saying|what are people saying|talking about|discussing|buzz)/.test(normalized)
    const asksWhichGroupsMatter = /(who should i talk to|who is working on|which org|which organization|which organizations|which groups|groups working on|organizations working on)/.test(normalized)
    const asksLocalContext = /(community|communities|near me|nearby|around me|my area|my city|my town|my riding|local)/.test(normalized)
    const asksOverview = /(what matters|what should i know|what should i pay attention|summary|summarize)/.test(normalized)
    const todayOnly = /(today|tonight|this afternoon|this evening)/.test(normalized)
    const hasIssueTopic = topicQuery.length > 0

    if (!profileIntent.wantsProfile && generalChatIntent && !civicSignal) {
      return {
        wantsProfile: false,
        wantsCauses: false,
        wantsDrive: false,
        wantsEvents: false,
        wantsJobs: false,
        wantsMarket: false,
        wantsCommunities: false,
        wantsOrganizations: false,
        wantsPosts: false,
        wantsTopics: false,
        todayOnly: false,
        topicQuery: '',
        causeLimit: 0,
        eventLimit: 0,
        jobLimit: 0,
        marketLimit: 0,
        organizationLimit: 0,
        postLimit: 0,
        topicLimit: 0,
        includeViewerOrganizations: false,
        reasons: ['general chat request detected'],
      }
    }

    let wantsCauses = explicitCauses
    let wantsDrive = explicitDrive
    let wantsEvents = explicitEvents || asksWhatIsHappening || todayOnly
    let wantsJobs = explicitJobs
    let wantsMarket = explicitMarket
    let wantsOrganizations = explicitOrganizations || asksWhichGroupsMatter
    let wantsPosts = explicitPosts || asksWhatPeopleAreSaying
    let wantsTopics = explicitTopics
    const wantsCommunities = asksLocalContext

    if (profileIntent.wantsProfile) {
      wantsCauses = false
      wantsDrive = false
      wantsEvents = false
      wantsJobs = false
      wantsMarket = false
      wantsOrganizations = false
      wantsPosts = false
      wantsTopics = false
    }

    if (!profileIntent.wantsProfile) {
      if (hasIssueTopic && asksWhatPeopleAreSaying) wantsPosts = true
      if (hasIssueTopic && asksWhichGroupsMatter) wantsOrganizations = true
      if (hasIssueTopic && explicitTopics) wantsTopics = true

      if (hasIssueTopic && !wantsCauses && !wantsDrive && !wantsEvents && !wantsJobs && !wantsMarket && !wantsOrganizations && !wantsPosts && !wantsTopics) {
        wantsPosts = true
        wantsOrganizations = true
        wantsTopics = true
      }

      if ((asksOverview || asksLocalContext) && !wantsCauses && !wantsDrive && !wantsEvents && !wantsJobs && !wantsMarket && !wantsOrganizations && !wantsPosts && !wantsTopics) {
        wantsEvents = true
        wantsPosts = true
        wantsOrganizations = true
      }

      if (!wantsCauses && !wantsDrive && !wantsEvents && !wantsJobs && !wantsMarket && !wantsOrganizations && !wantsPosts && !wantsTopics) {
        wantsPosts = true
        wantsOrganizations = hasIssueTopic
        wantsTopics = hasIssueTopic
      }
    }

    const reasons: string[] = []
    if (profileIntent.wantsProfile) reasons.push('profile or identity intent detected')
    if (wantsCauses) reasons.push('cause or donation intent detected')
    if (wantsDrive) reasons.push('drive or delivery intent detected')
    if (wantsEvents) reasons.push(todayOnly ? 'time-sensitive local activity requested' : 'activity or happenings requested')
    if (wantsJobs) reasons.push('employment intent detected')
    if (wantsMarket) reasons.push('shopping or marketplace intent detected')
    if (wantsPosts) reasons.push(asksWhatPeopleAreSaying ? 'public conversation intent detected' : 'local discussion context may help answer')
    if (wantsOrganizations) reasons.push(asksWhichGroupsMatter ? 'organization discovery intent detected' : 'local groups may help answer')
    if (wantsTopics) reasons.push('topic or hashtag discovery intent detected')

    return {
      wantsProfile: profileIntent.wantsProfile,
      wantsCauses,
      wantsDrive,
      wantsEvents,
      wantsJobs,
      wantsMarket,
      wantsCommunities,
      wantsOrganizations,
      wantsPosts,
      wantsTopics,
      todayOnly,
      topicQuery,
      causeLimit: wantsCauses ? (hasIssueTopic ? 5 : 4) : 0,
      eventLimit: wantsEvents ? (todayOnly || asksWhatIsHappening ? 6 : 4) : 0,
      jobLimit: wantsJobs ? 4 : 0,
      marketLimit: wantsMarket ? 4 : 0,
      organizationLimit: wantsOrganizations ? (asksWhichGroupsMatter || hasIssueTopic ? 4 : 3) : 0,
      postLimit: wantsPosts ? (asksWhatPeopleAreSaying || hasIssueTopic ? 5 : 3) : 0,
      topicLimit: wantsTopics ? (hasIssueTopic ? 5 : 4) : 0,
      includeViewerOrganizations: wantsOrganizations || asksWhichGroupsMatter,
      reasons,
    }
  }

  function matchCivilAiRequestedCommunities(question: string, viewerContext: CivilAiViewerContextLike | null) {
    if (!viewerContext) return [] as Array<NonNullable<CivilAiViewerContextLike['homeCommunity']>>
    const normalized = question.toLowerCase()
    const candidates = [viewerContext.homeCommunity, ...viewerContext.nearbyCommunities, ...viewerContext.followedCommunities]
      .filter((entry): entry is NonNullable<CivilAiViewerContextLike['homeCommunity']> => Boolean(entry))
    const unique = new Map<string, NonNullable<CivilAiViewerContextLike['homeCommunity']>>()
    for (const candidate of candidates) {
      if (normalized.includes(candidate.communityName.toLowerCase()) || normalized.includes(candidate.communitySlug.toLowerCase().replace(/-/g, ' '))) {
        unique.set(candidate.id, candidate)
      }
    }
    return Array.from(unique.values())
  }

  function buildCivilAiMarketSearchScope(args: {
    searchPass: 1 | 2
    targetCommunities: Array<{ provinceCode: string; communitySlug: string }>
    defaultCommunities: Array<{ provinceCode: string; communitySlug: string }>
  }) {
    const normalizedTargetCommunities = args.targetCommunities
      .map((community) => ({
        provinceCode: deps.normalizeProvinceCode(community.provinceCode) ?? community.provinceCode.trim().toUpperCase(),
        communitySlug: community.communitySlug.trim().toLowerCase(),
      }))
      .filter((community) => community.provinceCode && community.communitySlug)
      .filter((community, index, collection) => collection.findIndex((entry) => entry.provinceCode === community.provinceCode && entry.communitySlug === community.communitySlug) === index)

    if (args.searchPass === 1 && normalizedTargetCommunities.length) {
      return {
        mode: 'community' as const,
        communities: normalizedTargetCommunities,
        provinceCodes: Array.from(new Set(normalizedTargetCommunities.map((community) => community.provinceCode))),
      }
    }

    const provinceCodes = Array.from(
      new Set(
        args.defaultCommunities
          .map((community) => deps.normalizeProvinceCode(community.provinceCode) ?? community.provinceCode.trim().toUpperCase())
          .filter(Boolean),
      ),
    )

    if (provinceCodes.length) {
      return {
        mode: 'province' as const,
        communities: [],
        provinceCodes,
      }
    }

    return {
      mode: 'global' as const,
      communities: [],
      provinceCodes: [],
    }
  }

  function shouldCivilAiRunSecondSearch(question: string, bundle: CivilAiSecondSearchBundleLike) {
    const profileIntent = detectCivilAiProfileIntent(question)
    if (profileIntent.wantsProfile) return false
    if (bundle.grounding.searchPass >= 2) return false

    const resultCounts = bundle.debug.resultCounts
    const totalMatches = resultCounts.causes + resultCounts.events + resultCounts.jobs + resultCounts.market + resultCounts.organizations + resultCounts.posts + resultCounts.topics
    if (totalMatches > 0) return false

    const retrievalPlan = bundle.debug.retrievalPlan
    const hasBroaderCommunities = !retrievalPlan.wantsMarket && bundle.debug.availableCommunityCount > bundle.debug.targetCommunities.length
    const canBroadenMarketScope = retrievalPlan.wantsMarket && bundle.debug.marketScopeMode === 'community'
    const canRelaxTopicQuery = Boolean(retrievalPlan.topicQuery && (retrievalPlan.wantsCauses || retrievalPlan.wantsOrganizations || retrievalPlan.wantsPosts || retrievalPlan.wantsTopics))
    return hasBroaderCommunities || canBroadenMarketScope || canRelaxTopicQuery
  }

  return {
    buildCivilAiApiCatalog,
    buildCivilAiContextPrompt,
    buildCivilAiDirectAnswer,
    buildCivilAiGroundedAnswer,
    buildCivilAiMarketSearchScope,
    finalizeCivilAiReferences,
    matchCivilAiRequestedCommunities,
    planCivilAiRetrieval,
    sanitizeCivilAiResponseContent,
    shouldCivilAiRunSecondSearch,
  }
}
