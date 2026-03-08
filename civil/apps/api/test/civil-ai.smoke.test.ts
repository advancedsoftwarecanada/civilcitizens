import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { truncateTables } from './testDbGuard'

function canRunDbSmoke() {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? ''
  if (!databaseUrl) return false
  try {
    const parsed = new URL(databaseUrl)
    const dbName = parsed.pathname.replace(/^\//, '').toLowerCase()
    return dbName === 'civil_test' || dbName.endsWith('_test') || dbName.includes('test')
  } catch {
    return false
  }
}

const truncateAll = async () => {
  const tables = [
    'Notification',
    'BusinessFollow',
    'BusinessMembership',
    'JobPromotion',
    'JobAnalyticsEvent',
    'JobApplication',
    'JobPosting',
    'JobSubIndustry',
    'JobIndustry',
    'Business',
    'CommunityFollow',
    'Connection',
    'Friendship',
    'MediaAsset',
    'Post',
    'User',
  ]
  await truncateTables(tables)
}

const authHeader = (token: string) => ({ authorization: `Bearer ${token}` })

const registerUser = async (app: FastifyInstance, firstName: string, lastName: string) => {
  const email = `test+${randomUUID()}@example.com`
  const password = 'Password123!'
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, firstName, lastName, password, acceptTerms: true },
  })
  const payload = res.json() as { token?: string; user?: { id?: string; handle?: string; name?: string | null } }
  expect(res.statusCode).toBe(200)
  expect(payload.token).toBeTruthy()
  expect(payload.user?.id).toBeTruthy()
  expect(payload.user?.handle).toBeTruthy()
  return { token: payload.token!, id: payload.user!.id!, handle: payload.user!.handle!, name: payload.user!.name ?? `${firstName} ${lastName}` }
}

async function seedCivilAiLocalScenario(viewerId: string, authorId: string) {
  await prisma.communityFollow.create({
    data: {
      userId: viewerId,
      provinceCode: 'ON',
      communitySlug: 'newmarket',
      home: true,
    },
  })

  const localOrg = await prisma.business.create({
    data: {
      ownerId: authorId,
      name: 'Local Housing Alliance',
      slug: `local-housing-alliance-${randomUUID().slice(0, 8)}`,
      description: 'Residents working on housing affordability and tenant issues.',
      status: 'ACTIVE',
      provinceCode: 'ON',
      communitySlug: 'newmarket',
      logoUrl: 'https://example.com/local-housing-logo.jpg',
      coverUrl: 'https://example.com/local-housing-cover.jpg',
      metadata: {
        orgSystem: {
          events: [
            {
              id: 'housing-townhall-today',
              title: 'Housing Town Hall Tonight',
              description: 'A local discussion on housing affordability in Newmarket.',
              access: 'PUBLIC',
              eligibleRankIds: [],
              startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
              endsAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
              capacity: 120,
              paid: false,
              priceCents: null,
              currency: 'CAD',
              guestSpeakers: [],
              guestSpeakerInvites: [],
              sponsors: [],
              sponsorInvites: [],
              fees: [],
              primaryPhotoUrl: 'https://example.com/housing-townhall.jpg',
              galleryPhotoUrls: [],
              agenda: [],
              attachments: [],
              status: 'PUBLISHED',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 'housing-townhall-old',
              title: 'Housing Town Hall Last Year',
              description: 'An old housing event that should not appear for today.',
              access: 'PUBLIC',
              eligibleRankIds: [],
              startsAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
              endsAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
              capacity: 120,
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
              status: 'PUBLISHED',
              createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
              updatedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
            },
          ],
        },
      },
    },
  })

  const memberOrg = await prisma.business.create({
    data: {
      ownerId: authorId,
      name: 'Neighbourhood Tenant Network',
      slug: `neighbourhood-tenant-network-${randomUUID().slice(0, 8)}`,
      description: 'A local tenant group the viewer belongs to.',
      status: 'ACTIVE',
      provinceCode: 'ON',
      communitySlug: 'newmarket',
    },
  })

  await prisma.businessMembership.create({
    data: {
      userId: viewerId,
      businessId: memberOrg.id,
      role: 'MEMBER',
    },
  })

  await prisma.experience.create({
    data: {
      userId: viewerId,
      title: 'Volunteer Organizer',
      organization: memberOrg.name,
      location: 'Newmarket, ON',
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      current: true,
      description: 'Organizes local tenant outreach and housing issue canvassing.',
      position: 0,
    },
  })

  await prisma.business.create({
    data: {
      ownerId: authorId,
      name: 'Toronto Towers Lobby',
      slug: `toronto-towers-lobby-${randomUUID().slice(0, 8)}`,
      description: 'A different city organization that should not leak into Newmarket AI queries.',
      status: 'ACTIVE',
      provinceCode: 'ON',
      communitySlug: 'toronto',
    },
  })

  const industry = await prisma.jobIndustry.create({
    data: {
      name: `Community Organizing ${randomUUID().slice(0, 6)}`,
      slug: `community-organizing-${randomUUID().slice(0, 8)}`,
    },
  })

  await prisma.jobPosting.create({
    data: {
      businessId: localOrg.id,
      createdByUserId: authorId,
      title: 'Housing Outreach Coordinator',
      slug: `housing-outreach-${randomUUID().slice(0, 8)}`,
      employmentType: 'full_time',
      duties: 'Coordinate local outreach and attend housing meetings.',
      roleRequirements: 'Organizing experience and strong communication.',
      description: 'Work with local residents on housing issues in Newmarket.',
      locationType: 'community',
      locationProvinceCode: 'ON',
      locationCommunitySlug: 'newmarket',
      locationLabel: 'Newmarket, ON',
      industryId: industry.id,
      status: 'active',
      publishedAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  })

  await prisma.post.create({
    data: {
      authorId,
      audience: 'community',
      visibility: 'public',
      title: 'Housing affordability discussion',
      body: 'Housing costs keep rising in Newmarket and people are asking for more rental supply.',
      type: 'post',
      provinceCode: 'ON',
      communitySlug: 'newmarket',
      jurisdiction: 'municipal',
    },
  })

  await prisma.post.create({
    data: {
      authorId,
      audience: 'community',
      visibility: 'public',
      title: 'Toronto housing thread',
      body: 'This is a Toronto-specific housing discussion and should not appear in Newmarket scoped AI data.',
      type: 'post',
      provinceCode: 'ON',
      communitySlug: 'toronto',
      jurisdiction: 'municipal',
    },
  })

  return { localOrg, memberOrg }
}

let app: FastifyInstance
let planCivilAiRetrieval: (question: string) => {
  wantsEvents: boolean
  wantsJobs: boolean
  wantsOrganizations: boolean
  wantsPosts: boolean
  todayOnly: boolean
  topicQuery: string
}
let sanitizeCivilAiResponseContent: (content: string, references: Array<{ href: string }>) => string
let capturedChatInputs: string[] = []

beforeAll(async () => {
  process.env.API_SKIP_LISTEN = '1'
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test_secret'

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'smoke-model' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url.endsWith('/api/v1/chat')) {
        const payload = init?.body ? JSON.parse(String(init.body)) as { input?: string } : {}
        capturedChatInputs.push(payload.input ?? '')
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Here is a local housing snapshot.' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: 'unexpected_fetch_url', url }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )

  const mod = await import('../src/index.js')
  app = mod.app as FastifyInstance
  planCivilAiRetrieval = mod.planCivilAiRetrieval as typeof planCivilAiRetrieval
  sanitizeCivilAiResponseContent = mod.sanitizeCivilAiResponseContent as typeof sanitizeCivilAiResponseContent
  await app.ready()
})

beforeEach(async () => {
  capturedChatInputs = []
})

afterAll(async () => {
  await app?.close()
  vi.unstubAllGlobals()
  await prisma.$disconnect()
})

describe('Civil AI smoke', () => {
  test('planner selects local events for near-me today questions', () => {
    const plan = planCivilAiRetrieval('What events are going on near me today?')

    expect(plan.wantsEvents).toBe(true)
    expect(plan.todayOnly).toBe(true)
    expect(plan.wantsPosts).toBe(false)
    expect(plan.eventLimit).toBeGreaterThanOrEqual(4)
  })

  test('planner selects local posts and organizations for local issue questions', () => {
    const plan = planCivilAiRetrieval('What are people saying about housing in my area, and which groups are working on it?')

    expect(plan.wantsPosts).toBe(true)
    expect(plan.wantsOrganizations).toBe(true)
    expect(plan.topicQuery).toContain('housing')
    expect(plan.wantsEvents).toBe(false)
  })

  test('response sanitizer removes duplicate raw Civil URLs when a card already exists', () => {
    const content = 'There is one event that stands out: Civil Citizens Meetup. You can find more details about it here: https://dev.civilcitizens.ca/com/on/newmarket-aurora/orgs/civil-citizens-of-newmarket-aurora/events/event_123'
    const references = [
      {
        href: 'https://dev.civilcitizens.ca/com/on/newmarket-aurora/orgs/civil-citizens-of-newmarket-aurora/events/event_123',
      },
    ]

    const sanitized = sanitizeCivilAiResponseContent(content, references)

    expect(sanitized).toContain('Civil Citizens Meetup')
    expect(sanitized).toContain('Civil card below')
    expect(sanitized).not.toContain('https://dev.civilcitizens.ca/com/on/newmarket-aurora/orgs/civil-citizens-of-newmarket-aurora/events/event_123')
  })

  ;(canRunDbSmoke() ? test : test.skip)('AI endpoints and /ai/chat stay anchored to local Civil data', async () => {
    await truncateAll()

    const viewer = await registerUser(app, 'Local', 'Viewer')
    const author = await registerUser(app, 'Housing', 'Author')
    await seedCivilAiLocalScenario(viewer.id, author.id)

    const contextRes = await app.inject({
      method: 'GET',
      url: '/ai/context',
      headers: authHeader(viewer.token),
    })
    expect(contextRes.statusCode).toBe(200)
    const contextPayload = contextRes.json() as {
      viewer?: {
        user?: {
          id?: string
          handle?: string
          firstName?: string | null
          lastName?: string | null
          experiences?: Array<{ title?: string; organization?: string; current?: boolean; organizationProfile?: { name?: string } | null }>
        }
        organizations?: Array<{ name?: string; role?: string }>
        homeCommunity?: { id?: string; communitySlug?: string } | null
      }
      availableApis?: Array<{ endpoint: string }>
    }
    expect(contextPayload.viewer?.user?.id).toBe(viewer.id)
    expect(contextPayload.viewer?.user?.firstName).toBe('local')
    expect(contextPayload.viewer?.user?.lastName).toBe('viewer')
    expect(contextPayload.viewer?.user?.experiences?.some((entry) => entry.title === 'Volunteer Organizer' && entry.organization === 'Neighbourhood Tenant Network' && entry.current === true)).toBe(true)
    expect(contextPayload.viewer?.user?.experiences?.some((entry) => entry.organizationProfile?.name === 'Neighbourhood Tenant Network')).toBe(true)
    expect(contextPayload.viewer?.organizations?.some((entry) => entry.name === 'Neighbourhood Tenant Network' && entry.role === 'member')).toBe(true)
    expect(contextPayload.viewer?.homeCommunity?.id).toBe('ON:newmarket')
    expect(contextPayload.availableApis?.some((entry) => entry.endpoint.includes('/ai/posts/ON%3Anewmarket'))).toBe(true)

    const eventsRes = await app.inject({
      method: 'GET',
      url: '/ai/events/ON:newmarket?when=today',
      headers: authHeader(viewer.token),
    })
    expect(eventsRes.statusCode).toBe(200)
    const eventsPayload = eventsRes.json() as { items?: Array<{ title: string }> }
    const eventTitles = (eventsPayload.items ?? []).map((item) => item.title)
    expect(eventTitles).toContain('Housing Town Hall Tonight')
    expect(eventTitles).not.toContain('Housing Town Hall Last Year')

    const jobsRes = await app.inject({
      method: 'GET',
      url: '/ai/jobs/ON:newmarket',
      headers: authHeader(viewer.token),
    })
    expect(jobsRes.statusCode).toBe(200)
    const jobsPayload = jobsRes.json() as { items?: Array<{ title: string }> }
    expect((jobsPayload.items ?? []).some((item) => item.title === 'Housing Outreach Coordinator')).toBe(true)

    const orgsRes = await app.inject({
      method: 'GET',
      url: '/ai/organizations/ON:newmarket?q=housing',
      headers: authHeader(viewer.token),
    })
    expect(orgsRes.statusCode).toBe(200)
    const orgsPayload = orgsRes.json() as { items?: Array<{ name: string }> }
    const orgNames = (orgsPayload.items ?? []).map((item) => item.name)
    expect(orgNames).toContain('Local Housing Alliance')
    expect(orgNames).not.toContain('Toronto Towers Lobby')

    const postsRes = await app.inject({
      method: 'GET',
      url: '/ai/posts/ON:newmarket?q=housing',
      headers: authHeader(viewer.token),
    })
    expect(postsRes.statusCode).toBe(200)
    const postsPayload = postsRes.json() as { items?: Array<{ title: string }> }
    const postTitles = (postsPayload.items ?? []).map((item) => item.title)
    expect(postTitles).toContain('Housing affordability discussion')
    expect(postTitles).not.toContain('Toronto housing thread')

    const chatRes = await app.inject({
      method: 'POST',
      url: '/ai/chat',
      headers: {
        ...authHeader(viewer.token),
        'content-type': 'application/json',
      },
      payload: {
        messages: [{ role: 'user', content: 'What are people saying about housing in my area, and are there any groups working on it?' }],
      },
    })

    expect(chatRes.statusCode).toBe(200)
    const chatPayload = chatRes.json() as {
      message?: {
        content?: string
        references?: Array<{ kind: string; title: string }>
      }
    }
    expect(chatPayload.message?.content).toBe('Here is a local housing snapshot.')
    expect(chatPayload.message?.references?.some((entry) => entry.kind === 'post' && entry.title === 'Housing affordability discussion')).toBe(true)
    expect(chatPayload.message?.references?.some((entry) => entry.kind === 'organization' && entry.title === 'Local Housing Alliance')).toBe(true)

    expect(capturedChatInputs.length).toBe(1)
    expect(capturedChatInputs[0]).toContain('"firstName": "local"')
    expect(capturedChatInputs[0]).toContain('"lastName": "viewer"')
    expect(capturedChatInputs[0]).toContain('Volunteer Organizer')
    expect(capturedChatInputs[0]).toContain('Neighbourhood Tenant Network')
    expect(capturedChatInputs[0]).toContain('Local Housing Alliance')
    expect(capturedChatInputs[0]).toContain('Housing affordability discussion')
    expect(capturedChatInputs[0]).not.toContain('Toronto Towers Lobby')
    expect(capturedChatInputs[0]).not.toContain('Toronto housing thread')
  })
})