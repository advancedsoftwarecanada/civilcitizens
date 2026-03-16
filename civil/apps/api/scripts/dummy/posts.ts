import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

import { DUMMY_POST_PREFIX, ensureDummyBaseData, type DummySeedContext } from './shared.js'

const FRIEND_POST_BODIES = [
  'Checking in from Ontario today. Testing how friend posts move through the feed with a realistic social graph.',
  'Quick local update: trying seeded friend posts with nearby community follows and a little variety in timing.',
  'Seeded friend post for feed tuning. Looking at freshness, repetition, and overall feel.',
] as const

const NETWORK_POST_BODIES = [
  'Network update from Ontario. Sharing what I am seeing across organizations, events, and people this week.',
  'Testing the network audience with seeded people and accepted connections across the province.',
  'Another seeded network post to make sure the /network surface has enough variety to feel real.',
] as const

const COMMUNITY_POST_BODIES = [
  'Community update from Ontario: local projects, events, and neighbourhood work are all moving this week.',
  'Seeded community post for Ontario-only testing. This should show up when following the matching community.',
  'Looking at community feed behaviour with realistic local posts, public visibility, and recent timestamps.',
] as const

const ORGANIZATION_POST_BODIES = [
  'Organization update for Ontario testing. We are using this post to exercise community, org, and home feed surfaces.',
  'Seeded public organization post tied to a dummy Ontario org with business branding turned on.',
  'Posting a seeded organizational announcement so the feed feels populated while testing events and memberships.',
] as const

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildDate(offsetHours: number) {
  return new Date(Date.now() - offsetHours * 60 * 60 * 1000)
}

export async function seedDummyPosts(context?: DummySeedContext) {
  const seedContext = context ?? (await ensureDummyBaseData())
  const userIds = seedContext.users.map((user) => user.id)
  const organizationIds = seedContext.organizations.map((organization) => organization.id)

  await prisma.post.deleteMany({
    where: {
      OR: [
        { authorId: { in: userIds } },
        { businessId: { in: organizationIds } },
      ],
    },
  })

  const rows: Prisma.PostCreateManyInput[] = []
  let slugIndex = 1

  seedContext.users.forEach((user, index) => {
    const ownCommunity =
      seedContext.communities.find((community) => community.communitySlug === user.communitySlug) ??
      seedContext.communities[index % seedContext.communities.length]
    const friendCreatedAt = buildDate(index)
    rows.push({
      authorId: user.id,
      audience: 'friends',
      visibility: 'public',
      body: FRIEND_POST_BODIES[index % FRIEND_POST_BODIES.length] ?? 'Seeded friend post.',
      title: null,
      type: index % 4 === 0 ? 'photo' : 'post',
      mediaUrl: index % 4 === 0 ? seedContext.peopleImageUrls[index % seedContext.peopleImageUrls.length] ?? null : null,
      images:
        index % 4 === 0
          ? ([seedContext.peopleImageUrls[(index + 1) % seedContext.peopleImageUrls.length] ?? null].filter(Boolean) as unknown as Prisma.InputJsonValue)
          : undefined,
      seoSlug: `${DUMMY_POST_PREFIX}${slugIndex++}-${slugify(user.handle)}-friends`,
      jurisdiction: 'self',
      createdAt: friendCreatedAt,
      updatedAt: friendCreatedAt,
      lastActivityAt: friendCreatedAt,
      upvotes: 4 + (index % 7),
      downvotes: index % 2,
      score: 4 + (index % 7) - (index % 2),
      hotScore: 20 + index,
      reactionMaple: 2 + (index % 4),
      reactionHeart: 1 + (index % 3),
      reactionTotal: 4 + (index % 5),
      recentPositive: 2 + (index % 3),
    })

    const networkCreatedAt = buildDate(index + 3)
    rows.push({
      authorId: user.id,
      audience: 'network',
      visibility: 'public',
      body: NETWORK_POST_BODIES[index % NETWORK_POST_BODIES.length] ?? 'Seeded network post.',
      title: null,
      type: 'post',
      seoSlug: `${DUMMY_POST_PREFIX}${slugIndex++}-${slugify(user.handle)}-network`,
      jurisdiction: 'self',
      createdAt: networkCreatedAt,
      updatedAt: networkCreatedAt,
      lastActivityAt: networkCreatedAt,
      upvotes: 6 + (index % 9),
      downvotes: index % 3,
      score: 6 + (index % 9) - (index % 3),
      hotScore: 30 + index,
      reactionMaple: 3 + (index % 5),
      reactionHeart: 2 + (index % 4),
      reactionTotal: 6 + (index % 7),
      recentPositive: 3 + (index % 4),
    })

    if (ownCommunity) {
      const communityCreatedAt = buildDate(index + 6)
      rows.push({
        authorId: user.id,
        audience: 'community',
        visibility: 'public',
        body: COMMUNITY_POST_BODIES[index % COMMUNITY_POST_BODIES.length] ?? 'Seeded community post.',
        title: `${ownCommunity.communityName} update`,
        type: index % 5 === 0 ? 'article' : 'post',
        mediaUrl: index % 5 === 0 ? seedContext.eventImageUrls[index % seedContext.eventImageUrls.length] ?? null : null,
        seoSlug: `${DUMMY_POST_PREFIX}${slugIndex++}-${slugify(user.handle)}-${ownCommunity.communitySlug}`,
        jurisdiction: 'municipal',
        provinceCode: ownCommunity.provinceCode,
        communitySlug: ownCommunity.communitySlug,
        createdAt: communityCreatedAt,
        updatedAt: communityCreatedAt,
        lastActivityAt: communityCreatedAt,
        upvotes: 5 + (index % 8),
        downvotes: index % 2,
        score: 5 + (index % 8) - (index % 2),
        hotScore: 25 + index,
        reactionMaple: 2 + (index % 4),
        reactionHeart: 1 + (index % 2),
        reactionTotal: 5 + (index % 6),
        recentPositive: 2 + (index % 3),
      })
    }
  })

  seedContext.organizations.forEach((organization, index) => {
    const createdAt = buildDate(index + 2)
    rows.push({
      authorId: organization.ownerId,
      businessId: organization.id,
      audience: 'organization',
      visibility: 'public',
      body: ORGANIZATION_POST_BODIES[index % ORGANIZATION_POST_BODIES.length] ?? 'Seeded organization post.',
      title: `${organization.name} announcement`,
      type: index % 3 === 0 ? 'photo' : 'post',
      mediaUrl: seedContext.eventImageUrls[index % seedContext.eventImageUrls.length] ?? null,
      seoSlug: `${DUMMY_POST_PREFIX}${slugIndex++}-${slugify(organization.slug)}-org`,
      jurisdiction: 'municipal',
      provinceCode: organization.provinceCode,
      communitySlug: organization.communitySlug,
      showBusinessAuthor: true,
      createdAt,
      updatedAt: createdAt,
      lastActivityAt: createdAt,
      upvotes: 8 + (index % 12),
      downvotes: index % 2,
      score: 8 + (index % 12) - (index % 2),
      hotScore: 40 + index,
      reactionMaple: 4 + (index % 5),
      reactionHeart: 2 + (index % 3),
      reactionTotal: 8 + (index % 7),
      recentPositive: 4 + (index % 4),
    })
  })

  await prisma.post.createMany({ data: rows, skipDuplicates: true })
  console.log(`Seeded ${rows.length} dummy Ontario posts.`)
  return { postCount: rows.length }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDummyPosts().catch((error) => {
    console.error('Failed to seed dummy posts:', error)
    process.exit(1)
  })
}