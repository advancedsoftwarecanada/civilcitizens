import path from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import bcrypt from 'bcryptjs'
import { prisma } from '@civil/db'
import { BusinessRole, BusinessType, ConnectionStatus, FriendshipStatus, PremiumStatus, Prisma } from '@prisma/client'

export const DUMMY_PASSWORD = 'civil1234'
export const DUMMY_EVENT_PREFIX = 'dummy_event_'
export const DUMMY_RSVP_PREFIX = 'dummy_rsvp_'
export const DUMMY_POST_PREFIX = 'dummy-post-'
export const DUMMY_ONTARIO_PROVINCE = 'on'

const DUMMY_USER_COUNT = 50
const DUMMY_ORGANIZATION_COUNT = 20
const GENERATED_ASSET_COUNT = 24
const SYSTEM_MANAGER_RANK_ID = 'system_manager'
const SYSTEM_EVENT_MANAGER_RANK_ID = 'system_event_manager'
const SYSTEM_MEMBER_RANK_ID = 'system_member'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../..')
const publicDummyRoot = path.join(repoRoot, 'apps/web/public/dummy')

const FIRST_NAMES = [
  'Avery',
  'Jordan',
  'Taylor',
  'Morgan',
  'Casey',
  'Riley',
  'Parker',
  'Quinn',
  'Drew',
  'Sydney',
] as const

const LAST_NAMES = [
  'Bennett',
  'Campbell',
  'Carter',
  'Edwards',
  'Foster',
] as const

const ORGANIZATION_NAMES = [
  'Lakefront Civic Action',
  'Neighbourhood Future Lab',
  'Ontario Street Festival Guild',
  'North Shore Makers Hub',
  'Transit Riders Collective',
  'Main Street Garden Society',
  'Community Skills Exchange',
  'Ontario Youth Athletics',
  'Public Square Arts House',
  'Fresh Table Kitchen Co-op',
  'Town Hall Media Studio',
  'Riverbank Volunteer Network',
  'Civic Builders Alliance',
  'Friday Night Market Club',
  'Ontario Family Learning House',
  'East End Wellness Project',
  'Citizens Data Workshop',
  'Open Doors Food Circle',
  'Neighbourhood Repair Team',
  'Community Stories Collective',
] as const

const ORGANIZATION_TYPES: BusinessType[] = [
  'COMMUNITY_GROUP',
  'NON_PROFIT',
  'ARTS_CULTURE',
  'SPORTS_RECREATION',
  'EDUCATIONAL',
  'LOCAL_BUSINESS',
]

const FALLBACK_ONTARIO_COMMUNITIES: DummyCommunity[] = [
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'york-durham', communityName: 'York-Durham', cityName: 'York-Durham' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'newmarket-aurora', communityName: 'Newmarket-Aurora', cityName: 'Newmarket-Aurora' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'toronto-on', communityName: 'Toronto', cityName: 'Toronto' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'ottawa-on', communityName: 'Ottawa', cityName: 'Ottawa' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'mississauga-on', communityName: 'Mississauga', cityName: 'Mississauga' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'hamilton-on', communityName: 'Hamilton', cityName: 'Hamilton' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'london-on', communityName: 'London', cityName: 'London' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'kitchener-on', communityName: 'Kitchener', cityName: 'Kitchener' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'windsor-on', communityName: 'Windsor', cityName: 'Windsor' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'oshawa-on', communityName: 'Oshawa', cityName: 'Oshawa' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'barrie-on', communityName: 'Barrie', cityName: 'Barrie' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'guelph-on', communityName: 'Guelph', cityName: 'Guelph' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'kingston-on', communityName: 'Kingston', cityName: 'Kingston' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'waterloo-on', communityName: 'Waterloo', cityName: 'Waterloo' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'milton-on', communityName: 'Milton', cityName: 'Milton' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'markham-on', communityName: 'Markham', cityName: 'Markham' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'vaughan-on', communityName: 'Vaughan', cityName: 'Vaughan' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'oakville-on', communityName: 'Oakville', cityName: 'Oakville' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'burlington-on', communityName: 'Burlington', cityName: 'Burlington' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'st-catharines-on', communityName: 'St. Catharines', cityName: 'St. Catharines' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'cambridge-on', communityName: 'Cambridge', cityName: 'Cambridge' },
  { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: 'greater-sudbury-on', communityName: 'Greater Sudbury', cityName: 'Greater Sudbury' },
]

export type DummyCommunity = {
  provinceCode: string
  communitySlug: string
  communityName: string
  cityName: string
}

export type DummyUserRecord = {
  id: string
  email: string
  handle: string
  name: string
  provinceCode: string
  communitySlug: string
}

export type DummyOrganizationRecord = {
  id: string
  ownerId: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
}

export type DummySeedContext = {
  users: DummyUserRecord[]
  organizations: DummyOrganizationRecord[]
  communities: DummyCommunity[]
  eventImageUrls: string[]
  peopleImageUrls: string[]
}

type RawOrgSystem = Record<string, unknown>

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
}

function readMetadataRoot(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  return { ...(metadata as Record<string, unknown>) }
}

export function readOrganizationSystemRaw(metadata: unknown): RawOrgSystem {
  const root = readMetadataRoot(metadata)
  const raw = root.orgSystem
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return { ...(raw as Record<string, unknown>) }
}

export function mergeOrganizationMetadata(metadata: unknown, orgSystem: RawOrgSystem): Prisma.InputJsonValue {
  const root = readMetadataRoot(metadata)
  root.orgSystem = orgSystem
  return root as Prisma.InputJsonValue
}

function buildDummyCommunityMeta(community: DummyCommunity, extraCommunities: DummyCommunity[]): Prisma.InputJsonValue {
  return {
    nearbyCommunities: extraCommunities.slice(0, 3).map((item) => ({ provinceCode: item.provinceCode, communitySlug: item.communitySlug })),
    testingSeed: {
      provinceCode: community.provinceCode,
      communitySlug: community.communitySlug,
    },
  } satisfies Record<string, unknown> as Prisma.InputJsonValue
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function paletteForIndex(index: number) {
  const palettes = [
    ['#0f766e', '#34d399', '#ecfeff'],
    ['#7c2d12', '#fb923c', '#fff7ed'],
    ['#1d4ed8', '#60a5fa', '#eff6ff'],
    ['#166534', '#4ade80', '#f0fdf4'],
    ['#9a3412', '#f59e0b', '#fffbeb'],
    ['#7e22ce', '#c084fc', '#faf5ff'],
  ] as const
  return palettes[index % palettes.length] ?? palettes[0]
}

function buildPeopleSvg(index: number) {
  const [primary, secondary, accent] = paletteForIndex(index)
  const label = `Ontario Profile ${pad2(index + 1)}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-label="${escapeXml(label)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${secondary}" />
    </linearGradient>
  </defs>
  <rect width="800" height="800" fill="url(#bg)" rx="72" />
  <circle cx="400" cy="280" r="150" fill="${accent}" opacity="0.92" />
  <path d="M180 690c38-126 126-188 220-188s182 62 220 188" fill="${accent}" opacity="0.92" />
  <text x="400" y="742" text-anchor="middle" font-family="Verdana, Geneva, sans-serif" font-size="54" fill="#ffffff" letter-spacing="4">${escapeXml(label)}</text>
</svg>
`
}

function buildEventSvg(index: number) {
  const [primary, secondary, accent] = paletteForIndex(index + 2)
  const label = `Ontario Event ${pad2(index + 1)}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" role="img" aria-label="${escapeXml(label)}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${secondary}" />
    </linearGradient>
  </defs>
  <rect width="1200" height="900" fill="url(#sky)" rx="64" />
  <circle cx="1010" cy="170" r="96" fill="${accent}" opacity="0.9" />
  <path d="M90 700c120-180 260-270 420-270 118 0 231 46 337 137 66 57 118 122 158 196" fill="none" stroke="${accent}" stroke-width="28" stroke-linecap="round" opacity="0.85" />
  <rect x="118" y="118" width="232" height="124" rx="28" fill="#ffffff" opacity="0.16" />
  <text x="146" y="194" font-family="Verdana, Geneva, sans-serif" font-size="54" font-weight="700" fill="#ffffff">ONTARIO</text>
  <text x="120" y="430" font-family="Verdana, Geneva, sans-serif" font-size="110" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>
  <text x="120" y="520" font-family="Verdana, Geneva, sans-serif" font-size="40" fill="#ffffff">Generated placeholder art for events, organizations, and feed testing.</text>
</svg>
`
}

async function generateDummyAssets(kind: 'events' | 'people'): Promise<string[]> {
  const targetDir = path.join(publicDummyRoot, kind)

  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })

  const fileNames: string[] = []
  for (let index = 0; index < GENERATED_ASSET_COUNT; index += 1) {
    const fileName = `image_${index + 1}.svg`
    const content = kind === 'people' ? buildPeopleSvg(index) : buildEventSvg(index)
    await writeFile(path.join(targetDir, fileName), content, 'utf8')
    fileNames.push(fileName)
  }

  return fileNames.map((name) => `/dummy/${kind}/${name}`)
}

async function loadOntarioCommunities(): Promise<DummyCommunity[]> {
  const rows = await prisma.city.findMany({
    where: { provinceCode: DUMMY_ONTARIO_PROVINCE },
    distinct: ['communitySlug'],
    orderBy: [{ population: 'desc' }, { name: 'asc' }],
    take: DUMMY_ORGANIZATION_COUNT,
    select: {
      provinceCode: true,
      communitySlug: true,
      communityName: true,
      name: true,
    },
  })

  const rowCommunities = rows.map((row) => ({
    provinceCode: row.provinceCode,
    communitySlug: row.communitySlug,
    communityName: row.communityName,
    cityName: row.name,
  }))

  const preferredCommunities = FALLBACK_ONTARIO_COMMUNITIES.filter((community) =>
    community.communitySlug === 'york-durham' || community.communitySlug === 'newmarket-aurora',
  )
  const merged = [...preferredCommunities, ...rowCommunities, ...FALLBACK_ONTARIO_COMMUNITIES]
  const deduped: DummyCommunity[] = []
  const seen = new Set<string>()
  for (const community of merged) {
    if (seen.has(community.communitySlug)) continue
    seen.add(community.communitySlug)
    deduped.push(community)
  }

  if (deduped.length < DUMMY_ORGANIZATION_COUNT) {
    throw new Error(`Expected at least ${DUMMY_ORGANIZATION_COUNT} Ontario communities from City rows and fallbacks.`)
  }

  return deduped.slice(0, DUMMY_ORGANIZATION_COUNT)
}

function buildUserBlueprint(index: number, communities: DummyCommunity[], peopleImageUrls: string[], coverUrls: string[]) {
  const firstName = FIRST_NAMES[Math.floor(index / LAST_NAMES.length) % FIRST_NAMES.length] ?? `Person${index + 1}`
  const lastName = LAST_NAMES[index % LAST_NAMES.length] ?? 'Tester'
  const name = `${firstName} ${lastName}`
  const community = communities[index % communities.length] ?? communities[0]
  if (!community) throw new Error('No Ontario communities available for dummy users.')
  const isDemoUser = index === 0
  return {
    email: isDemoUser ? 'demo@civil.local' : `dummy-user-${pad2(index + 1)}@dummy.civil.local`,
    handle: isDemoUser ? 'demo' : `ontario-person-${pad2(index + 1)}`,
    name,
    bio: `${name} is a seeded Ontario test profile for communities, events, and feed development.`,
    avatarUrl: peopleImageUrls[index % peopleImageUrls.length] ?? null,
    coverUrl: coverUrls[index % coverUrls.length] ?? null,
    premiumStatus: index % 9 === 0 ? PremiumStatus.ACTIVE : PremiumStatus.NONE,
    community,
    communityMeta: buildDummyCommunityMeta(community, communities.slice(index, index + 3)),
  }
}

function buildOrganizationSlug(index: number, name: string) {
  return `${slugify(name)}-${pad2(index + 1)}`
}

function buildOrganizationMemberState(rankId: string, referredByUserId: string | null = null) {
  return {
    rankId,
    planId: null,
    status: 'ACTIVE',
    referredByUserId,
    reputation: 0,
    updatedAt: new Date().toISOString(),
  }
}

function pickOrganizationMembers(users: DummyUserRecord[], orgIndex: number) {
  const owner = users[orgIndex % users.length]
  if (!owner) throw new Error(`Missing owner for organization ${orgIndex}`)

  const managerA = users[(orgIndex + 10) % users.length]
  const managerB = users[(orgIndex + 20) % users.length]
  const members = [
    users[(orgIndex + 1) % users.length],
    users[(orgIndex + 2) % users.length],
    users[(orgIndex + 3) % users.length],
    users[(orgIndex + 4) % users.length],
    users[(orgIndex + 5) % users.length],
    users[(orgIndex + 6) % users.length],
  ].filter((item): item is DummyUserRecord => Boolean(item))

  return {
    owner,
    managers: [managerA, managerB].filter((item): item is DummyUserRecord => Boolean(item) && item.id !== owner.id),
    members: members.filter((item) => item.id !== owner.id && item.id !== managerA?.id && item.id !== managerB?.id),
  }
}

export async function ensureDummyBaseData(): Promise<DummySeedContext> {
  const [eventImageUrls, peopleImageUrls, communities] = await Promise.all([
    generateDummyAssets('events'),
    generateDummyAssets('people'),
    loadOntarioCommunities(),
  ])

  const passwordHash = await bcrypt.hash(DUMMY_PASSWORD, 10)
  const userCoverUrls = eventImageUrls.length ? eventImageUrls : peopleImageUrls

  const users: DummyUserRecord[] = []
  for (let index = 0; index < DUMMY_USER_COUNT; index += 1) {
    const blueprint = buildUserBlueprint(index, communities, peopleImageUrls, userCoverUrls)
    const user = await prisma.user.upsert({
      where: { email: blueprint.email },
      update: {
        handle: blueprint.handle,
        name: blueprint.name,
        bio: blueprint.bio,
        avatarUrl: blueprint.avatarUrl,
        coverUrl: blueprint.coverUrl,
        passwordHash,
        premiumStatus: blueprint.premiumStatus,
        communityMeta: blueprint.communityMeta,
      },
      create: {
        email: blueprint.email,
        handle: blueprint.handle,
        name: blueprint.name,
        bio: blueprint.bio,
        avatarUrl: blueprint.avatarUrl,
        coverUrl: blueprint.coverUrl,
        passwordHash,
        premiumStatus: blueprint.premiumStatus,
        communityMeta: blueprint.communityMeta,
      },
      select: { id: true, email: true, handle: true, name: true },
    })

    users.push({
      id: user.id,
      email: user.email,
      handle: user.handle,
      name: user.name ?? blueprint.name,
      provinceCode: blueprint.community.provinceCode,
      communitySlug: blueprint.community.communitySlug,
    })
  }

  const userIds = users.map((user) => user.id)
  const pairRows: Array<{ requesterId: string; addresseeId: string; status: FriendshipStatus | ConnectionStatus; requestedAt: Date; respondedAt: Date }> = []
  const now = new Date()
  for (let left = 0; left < users.length; left += 1) {
    for (let right = left + 1; right < users.length; right += 1) {
      const requester = users[left]
      const addressee = users[right]
      if (!requester || !addressee) continue
      pairRows.push({ requesterId: requester.id, addresseeId: addressee.id, status: FriendshipStatus.ACCEPTED, requestedAt: now, respondedAt: now })
    }
  }

  await prisma.friendship.deleteMany({ where: { requesterId: { in: userIds }, addresseeId: { in: userIds } } })
  await prisma.connection.deleteMany({ where: { requesterId: { in: userIds }, addresseeId: { in: userIds } } })
  if (pairRows.length) {
    await prisma.friendship.createMany({
      data: pairRows.map((row) => ({ ...row, status: FriendshipStatus.ACCEPTED })),
      skipDuplicates: true,
    })
    await prisma.connection.createMany({
      data: pairRows.map((row) => ({ ...row, status: ConnectionStatus.ACCEPTED })),
      skipDuplicates: true,
    })
  }

  await prisma.communityFollow.deleteMany({ where: { userId: { in: userIds }, provinceCode: DUMMY_ONTARIO_PROVINCE } })
  await prisma.communityFollow.createMany({
    data: users.flatMap((user, index) => {
      const ownCommunity = communities[index % communities.length]
      const altCommunityA = communities[(index + 1) % communities.length]
      const altCommunityB = communities[(index + 2) % communities.length]
      return [ownCommunity, altCommunityA, altCommunityB]
        .filter((item): item is DummyCommunity => Boolean(item))
        .map((community, communityIndex) => ({
          userId: user.id,
          provinceCode: community.provinceCode,
          communitySlug: community.communitySlug,
          home: communityIndex === 0,
        }))
    }),
    skipDuplicates: true,
  })

  const organizations: DummyOrganizationRecord[] = []
  const membershipRows: Array<{ businessId: string; userId: string; role: BusinessRole }> = []

  for (let index = 0; index < DUMMY_ORGANIZATION_COUNT; index += 1) {
    const community = communities[index]
    const name = ORGANIZATION_NAMES[index] ?? `Ontario Dummy Organization ${index + 1}`
    const slug = buildOrganizationSlug(index, name)
    const ownerMembers = pickOrganizationMembers(users, index)
    const existing = await prisma.business.findFirst({
      where: { provinceCode: DUMMY_ONTARIO_PROVINCE, communitySlug: community?.communitySlug, slug },
      select: { id: true, metadata: true },
    })

    if (!community) throw new Error(`Missing Ontario community for organization ${index}`)

    const eventCover = eventImageUrls[index % eventImageUrls.length] ?? null
    const logoUrl = peopleImageUrls[index % peopleImageUrls.length] ?? null
    const rawSystem = readOrganizationSystemRaw(existing?.metadata ?? null)
    const rawMembers = rawSystem.members && typeof rawSystem.members === 'object' && !Array.isArray(rawSystem.members)
      ? ({ ...(rawSystem.members as Record<string, unknown>) } as Record<string, unknown>)
      : {}

    for (const dummyUserId of userIds) {
      delete rawMembers[dummyUserId]
    }

    const nextSystem: RawOrgSystem = {
      ...rawSystem,
      version: 1,
      joinMode: 'PUBLIC',
      members: {
        ...rawMembers,
        [ownerMembers.owner.id]: buildOrganizationMemberState(SYSTEM_MANAGER_RANK_ID),
        ...Object.fromEntries(ownerMembers.managers.map((user) => [user.id, buildOrganizationMemberState(SYSTEM_EVENT_MANAGER_RANK_ID, ownerMembers.owner.id)])),
        ...Object.fromEntries(ownerMembers.members.map((user) => [user.id, buildOrganizationMemberState(SYSTEM_MEMBER_RANK_ID, ownerMembers.owner.id)])),
      },
    }

    const data = {
      ownerId: ownerMembers.owner.id,
      provinceCode: DUMMY_ONTARIO_PROVINCE,
      communitySlug: community.communitySlug,
      name,
      slug,
      type: ORGANIZATION_TYPES[index % ORGANIZATION_TYPES.length] ?? BusinessType.COMMUNITY_GROUP,
      description: `${name} is seeded dummy data for Ontario-only testing across events, organizations, and feeds.`,
      status: 'ACTIVE' as const,
      moderationStatus: 'VISIBLE' as const,
      isVerified: true,
      logoUrl,
      coverUrl: eventCover,
      metadata: mergeOrganizationMetadata(existing?.metadata ?? null, nextSystem),
    }

    const organization = existing
      ? await prisma.business.update({
          where: { id: existing.id },
          data,
          select: { id: true, ownerId: true, name: true, slug: true, provinceCode: true, communitySlug: true },
        })
      : await prisma.business.create({
          data,
          select: { id: true, ownerId: true, name: true, slug: true, provinceCode: true, communitySlug: true },
        })

    organizations.push({
      id: organization.id,
      ownerId: organization.ownerId,
      name: organization.name,
      slug: organization.slug,
      provinceCode: organization.provinceCode ?? DUMMY_ONTARIO_PROVINCE,
      communitySlug: organization.communitySlug ?? community.communitySlug,
    })

    membershipRows.push({ businessId: organization.id, userId: ownerMembers.owner.id, role: BusinessRole.OWNER })
    membershipRows.push(...ownerMembers.managers.map((user) => ({ businessId: organization.id, userId: user.id, role: BusinessRole.MANAGER })))
  }

  const organizationIds = organizations.map((organization) => organization.id)
  await prisma.businessMembership.deleteMany({ where: { businessId: { in: organizationIds }, userId: { in: userIds } } })
  if (membershipRows.length) {
    await prisma.businessMembership.createMany({ data: membershipRows, skipDuplicates: true })
  }

  await prisma.businessFollow.deleteMany({ where: { businessId: { in: organizationIds }, userId: { in: userIds } } })
  await prisma.businessFollow.createMany({
    data: organizations.flatMap((organization) => userIds.map((userId) => ({ businessId: organization.id, userId }))),
    skipDuplicates: true,
  })

  return {
    users,
    organizations,
    communities,
    eventImageUrls,
    peopleImageUrls,
  }
}