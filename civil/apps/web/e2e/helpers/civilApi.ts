import { APIRequestContext, expect, Page } from '@playwright/test'
import { findCommunity } from '@civil/shared'
import { prisma } from '../../../../packages/db/src/index.js'
import { buildWalletMetaValue, readBaseJsonObject, readWalletSummary } from '../../../api/src/walletHelpers.js'

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

export type PublishedCauseContext = {
  postId: string
  authorToken: string
  authorUserId: string
  supporterToken: string
  supporterUserId: string
  province: string
  municipality: string
  path: string
  title: string
  goalLabel: string
  raisedLabel: string
  firstStageDescription: string
  imageUrls: string[]
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

async function seedUserCommunityAndWallet(args: {
  userId: string
  province: string
  municipality: string
  civilCreditsCents?: number
  payoutsEnabled?: boolean
}) {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { communityMeta: true, email: true },
  })

  expect(user, `missing seeded user ${args.userId}`).toBeTruthy()

  const currentMeta = readBaseJsonObject(user?.communityMeta)
  const currentWallet = readWalletSummary(user?.communityMeta)
  const nextWallet = buildWalletMetaValue({
    ...currentWallet,
    civilCreditsCents: Math.max(currentWallet.civilCreditsCents, args.civilCreditsCents ?? 0),
    enabled: true,
    eTransferEmail: currentWallet.eTransferEmail ?? user?.email ?? `pw-${args.userId.slice(0, 8)}@example.com`,
    stripeConnect: args.payoutsEnabled
      ? {
          accountId: `acct_pw_${args.userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`,
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        }
      : currentWallet.stripeConnect,
  })

  const nowIso = new Date().toISOString()
  currentMeta.wallet = nextWallet
  currentMeta.civicStatus = currentMeta.civicStatus ?? 'citizen'
  currentMeta.verificationMethod = currentMeta.verificationMethod ?? 'self_declaration'
  currentMeta.statusDeclaredAt = currentMeta.statusDeclaredAt ?? nowIso
  currentMeta.statusUpdatedAt = nowIso

  await prisma.user.update({
    where: { id: args.userId },
    data: { communityMeta: currentMeta },
  })

  await prisma.communityFollow.updateMany({
    where: { userId: args.userId },
    data: { home: false },
  })

  await prisma.communityFollow.upsert({
    where: {
      userId_provinceCode_communitySlug: {
        userId: args.userId,
        provinceCode: args.province,
        communitySlug: args.municipality,
      },
    },
    create: {
      userId: args.userId,
      provinceCode: args.province,
      communitySlug: args.municipality,
      home: true,
    },
    update: {
      home: true,
    },
  })
}

export async function createTestUser(request: APIRequestContext) {
  return registerUser(request)
}

async function pickCommunity(request: APIRequestContext): Promise<{ province: string; municipality: string }> {
  const preferredProvince = (process.env.PLAYWRIGHT_PROVINCE ?? 'on').trim().toLowerCase()
  const preferredMunicipality = (process.env.PLAYWRIGHT_MUNICIPALITY ?? 'york-durham').trim().toLowerCase()
  const preferred = await request.get(`/api/communities/${encodeURIComponent(preferredProvince)}`)
  if (preferred.ok()) {
    const preferredJson = (await preferred.json()) as CommunitiesResponse
    const first = preferredJson.items?.[0]
    if (first?.slug) {
      return { province: preferredProvince, municipality: first.slug }
    }
  }

  if (findCommunity(preferredProvince, preferredMunicipality)) {
    return { province: preferredProvince, municipality: preferredMunicipality }
  }

  const provincesRes = await request.get('/api/communities/provinces')
  expect(provincesRes.ok(), `failed to list provinces (${provincesRes.status()})`).toBeTruthy()
  const provincesJson = (await provincesRes.json()) as ProvincesResponse
  const provinces = (provincesJson.items ?? []).map((item) => (item.code ?? '').trim().toLowerCase()).filter(Boolean)
  expect(provinces.length, 'no provinces available for tests').toBeGreaterThan(0)

  for (const province of provinces) {
    const communitiesRes = await request.get(`/api/communities/${encodeURIComponent(province)}`)
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

export async function createPublishedCause(
  request: APIRequestContext,
  options?: {
    imageUrls?: string[]
  },
): Promise<PublishedCauseContext> {
  const author = await registerUser(request)
  const supporter = await registerUser(request)
  const location = await pickCommunity(request)

  await seedUserCommunityAndWallet({
    userId: author.userId,
    province: location.province,
    municipality: location.municipality,
    payoutsEnabled: true,
  })

  await seedUserCommunityAndWallet({
    userId: supporter.userId,
    province: location.province,
    municipality: location.municipality,
    civilCreditsCents: 10_000,
  })

  const draftCreateRes = await request.post('/api/causes/drafts', {
    headers: authHeader(author.token),
  })
  expect(draftCreateRes.ok(), `cause draft create failed (${draftCreateRes.status()})`).toBeTruthy()
  const draftCreateJson = (await draftCreateRes.json()) as { draft?: { id?: string } }
  const draftId = draftCreateJson.draft?.id ?? null
  expect(draftId, 'cause draft create missing id').toBeTruthy()

  const title = `PW Cause ${uniq('title')}`
  const firstStageDescription = 'Stage 1 seed milestone'
  const stageGoals = [
    {
      id: uniq('goal'),
      amountCents: 10_000,
      description: firstStageDescription,
      sortOrder: 0,
    },
    {
      id: uniq('goal'),
      amountCents: 15_000,
      description: 'Stage 2 rollout milestone',
      sortOrder: 1,
    },
  ]

  const draftUpdateRes = await request.patch(`/api/causes/drafts/${encodeURIComponent(draftId as string)}`, {
    headers: {
      ...authHeader(author.token),
      'content-type': 'application/json',
    },
    data: {
      title,
      body: '<p>This is a Playwright-backed Cause body that is long enough to publish and verify the public Cause rendering path.</p>',
      mediaUrl: options?.imageUrls?.[0] ?? null,
      images: options?.imageUrls ?? [],
      goalAmountCents: 25_000,
      stageGoals,
      provinceCode: location.province,
      communitySlug: location.municipality,
    },
  })
  expect(draftUpdateRes.ok(), `cause draft update failed (${draftUpdateRes.status()})`).toBeTruthy()

  const publishRes = await request.post(`/api/causes/drafts/${encodeURIComponent(draftId as string)}/publish`, {
    headers: authHeader(author.token),
  })
  expect(publishRes.ok(), `cause publish failed (${publishRes.status()})`).toBeTruthy()
  const publishJson = (await publishRes.json()) as {
    post?: {
      seoSlug?: string | null
      provinceCode?: string | null
      communitySlug?: string | null
    }
  }

  const seoSlug = publishJson.post?.seoSlug ?? null
  const province = publishJson.post?.provinceCode ?? location.province
  const municipality = publishJson.post?.communitySlug ?? location.municipality
  expect(seoSlug, 'cause publish missing slug').toBeTruthy()

  return {
    postId: publishJson.post?.id as string,
    authorToken: author.token,
    authorUserId: author.userId,
    supporterToken: supporter.token,
    supporterUserId: supporter.userId,
    province,
    municipality,
    path: `/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/causes/${encodeURIComponent(seoSlug as string)}`,
    title,
    goalLabel: '$250',
    raisedLabel: '$25',
    firstStageDescription,
    imageUrls: options?.imageUrls ?? [],
  }
}

export async function authenticatePage(page: Page, token: string) {
  await page.addInitScript((authToken: string) => {
    window.localStorage.setItem('token', authToken)
  }, token)
}
