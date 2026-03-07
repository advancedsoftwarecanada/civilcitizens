import { APIRequestContext, expect, Page } from '@playwright/test'

type RegisterResponse = {
  token?: string
  user?: {
    id?: string
  }
}

type CommunityItem = {
  slug: string
}

type CommunitiesResponse = {
  items?: CommunityItem[]
}

type ProvincesResponse = {
  items?: Array<{
    code?: string
  }>
}

type OrganizationCreateResponse = {
  org?: {
    slug?: string
  }
}

type MeetingCreateResponse = {
  meeting?: {
    id?: string
    title?: string
  }
}

type MeetingStatus = 'ACTIVE' | 'ARCHIVED'

export type TestOrgContext = {
  token: string
  userId: string
  province: string
  municipality: string
  organizationSlug: string
  meetingsViewPath: string
  meetingsManagePath: string
}

export type CreatedMeeting = {
  id: string
  title: string
}

export type MeetingSeedInput = {
  title: string
  status?: MeetingStatus
  description?: string | null
  startsAt?: string | null
  endsAt?: string | null
  visibility?: 'PUBLIC' | 'PRIVATE'
}

function uniq(prefix: string) {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` }
}

function buildMeetingsPath(parts: { province: string; municipality: string; organizationSlug: string }) {
  const province = encodeURIComponent(parts.province)
  const municipality = encodeURIComponent(parts.municipality)
  const slug = encodeURIComponent(parts.organizationSlug)
  return `/com/${province}/${municipality}/orgs/${slug}/meetings`
}

async function registerUser(request: APIRequestContext) {
  const unique = uniq('pw')
  const email = `${unique}@example.com`
  const res = await request.post('/api/auth/register', {
    data: {
      firstName: 'playwright',
      lastName: unique,
      email,
      password: 'Password123!',
      acceptTerms: true,
    },
  })
  expect(res.ok(), `register failed (${res.status()})`).toBeTruthy()
  const json = (await res.json()) as RegisterResponse
  const token = json.token ?? null
  const userId = json.user?.id ?? null
  expect(token, 'register did not return token').toBeTruthy()
  expect(userId, 'register did not return user id').toBeTruthy()
  return { token: token as string, userId: userId as string }
}

export async function createTestUser(request: APIRequestContext) {
  return registerUser(request)
}

async function pickCommunity(request: APIRequestContext): Promise<{ province: string; municipality: string }> {
  const preferredProvince = (process.env.PLAYWRIGHT_PROVINCE ?? 'on').trim().toLowerCase()
  const preferred = await request.get(`/api/communities?province=${encodeURIComponent(preferredProvince)}`)
  if (preferred.ok()) {
    const preferredJson = (await preferred.json()) as CommunitiesResponse
    const first = preferredJson.items?.[0]
    if (first?.slug) {
      return { province: preferredProvince, municipality: first.slug }
    }
  }

  const provincesRes = await request.get('/api/communities/provinces')
  expect(provincesRes.ok(), `failed to list provinces (${provincesRes.status()})`).toBeTruthy()
  const provincesJson = (await provincesRes.json()) as ProvincesResponse
  const provinces = (provincesJson.items ?? []).map((item) => (item.code ?? '').trim().toLowerCase()).filter(Boolean)
  expect(provinces.length, 'no provinces available for tests').toBeGreaterThan(0)

  for (const province of provinces) {
    const communitiesRes = await request.get(`/api/communities?province=${encodeURIComponent(province)}`)
    if (!communitiesRes.ok()) continue
    const communitiesJson = (await communitiesRes.json()) as CommunitiesResponse
    const first = communitiesJson.items?.[0]
    if (first?.slug) {
      return { province, municipality: first.slug }
    }
  }

  throw new Error('No communities available for Playwright test setup.')
}

async function createOrganization(request: APIRequestContext, args: { token: string; province: string; municipality: string }) {
  const slug = uniq('pw-org').slice(0, 60)
  const name = `Playwright Org ${uniq('name')}`
  const res = await request.post(
    `/api/communities/${encodeURIComponent(args.province)}/${encodeURIComponent(args.municipality)}/orgs`,
    {
      headers: authHeader(args.token),
      data: {
        name,
        slug,
        type: 'COMMUNITY_GROUP',
        description: 'Playwright seeded organization',
      },
    },
  )
  expect(res.ok(), `organization create failed (${res.status()})`).toBeTruthy()
  const json = (await res.json()) as OrganizationCreateResponse
  expect(json.org?.slug, 'organization create missing slug').toBeTruthy()
  return json.org!.slug as string
}

export async function createMeeting(
  request: APIRequestContext,
  args: {
    token: string
    province: string
    municipality: string
    organizationSlug: string
    input: MeetingSeedInput
  },
): Promise<CreatedMeeting> {
  const schedule =
    args.input.startsAt || args.input.endsAt
      ? {
          startsAt: args.input.startsAt ?? null,
          endsAt: args.input.endsAt ?? null,
        }
      : null

  const res = await request.post(
    `/api/communities/${encodeURIComponent(args.province)}/${encodeURIComponent(args.municipality)}/orgs/${encodeURIComponent(
      args.organizationSlug,
    )}/governance/meetings`,
    {
      headers: authHeader(args.token),
      data: {
        title: args.input.title,
        description: args.input.description ?? null,
        visibility: args.input.visibility ?? 'PUBLIC',
        requiresPassword: false,
        password: null,
        requiresManualAdmit: false,
        maxParticipants: 10,
        schedule,
        assignedMemberUserIds: [],
        status: args.input.status ?? 'ACTIVE',
      },
    },
  )
  expect(res.ok(), `meeting create failed (${res.status()})`).toBeTruthy()
  const json = (await res.json()) as MeetingCreateResponse
  const meetingId = json.meeting?.id ?? null
  const title = json.meeting?.title ?? args.input.title
  expect(meetingId, 'meeting create missing id').toBeTruthy()
  return { id: meetingId as string, title }
}

export async function createTestOrganization(request: APIRequestContext): Promise<TestOrgContext> {
  const auth = await registerUser(request)
  const location = await pickCommunity(request)
  const organizationSlug = await createOrganization(request, {
    token: auth.token,
    province: location.province,
    municipality: location.municipality,
  })

  const meetingsViewPath = buildMeetingsPath({
    province: location.province,
    municipality: location.municipality,
    organizationSlug,
  })

  return {
    token: auth.token,
    userId: auth.userId,
    province: location.province,
    municipality: location.municipality,
    organizationSlug,
    meetingsViewPath,
    meetingsManagePath: `${meetingsViewPath}/manage`,
  }
}

export async function authenticatePage(page: Page, token: string) {
  await page.addInitScript((authToken: string) => {
    window.localStorage.setItem('token', authToken)
  }, token)
}
