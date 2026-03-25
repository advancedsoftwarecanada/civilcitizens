import type { Prisma } from '@prisma/client'
import { extractTextTagging, normalizeHashtagSlug } from '@civil/shared'

type TransactionClient = Prisma.TransactionClient

export type ResolvedPostMention = {
  userId: string
  handle: string
  name: string | null
  handleSnapshot: string
}

export type ResolvedPostTagging = {
  topicSlugs: string[]
  communitySlugs: string[]
  mentionHandles: string[]
  mentions: ResolvedPostMention[]
  mentionedUserIds: string[]
}

type ResolvePostTaggingArgs = {
  tx: TransactionClient
  authorId: string
  text: string
  hashtags?: string[] | null | undefined
  implicitCommunitySlugs?: Array<string | null | undefined>
}

type ExtractedPostTagging = {
  topicSlugs: string[]
  communitySlugs: string[]
  mentionHandles: string[]
}

export async function resolvePostTaggingForWrite(args: ResolvePostTaggingArgs): Promise<ResolvedPostTagging> {
  const extracted = extractTextTagging(args.text, { hashtags: args.hashtags }) as ExtractedPostTagging
  const topicSlugs = new Set(extracted.topicSlugs)
  const communitySlugs = new Set(extracted.communitySlugs)

  for (const value of args.implicitCommunitySlugs ?? []) {
    const slug = normalizeHashtagSlug(value ?? '')
    if (slug) communitySlugs.add(slug)
  }

  const homeCommunity = await args.tx.communityFollow.findFirst({
    where: { userId: args.authorId, home: true },
    select: { communitySlug: true },
  })
  const homeCommunitySlug = normalizeHashtagSlug(homeCommunity?.communitySlug ?? '')
  if (homeCommunitySlug) {
    communitySlugs.add(homeCommunitySlug)
  }

  const mentionHandles = Array.from(new Set<string>(extracted.mentionHandles))
  if (!mentionHandles.length) {
    return {
      topicSlugs: [...topicSlugs],
      communitySlugs: [...communitySlugs],
      mentionHandles,
      mentions: [],
      mentionedUserIds: [],
    }
  }

  const mentionedUsers = await args.tx.user.findMany({
    where: {
      OR: mentionHandles.map((handle) => ({
        handle: {
          equals: handle,
          mode: 'insensitive',
        },
      })),
    },
    select: {
      id: true,
      handle: true,
      name: true,
    },
  })

  const mentionedUsersByHandle = new Map(
    mentionedUsers.map((user) => [String(user.handle ?? '').trim().toLowerCase(), user]),
  )

  const mentions = mentionHandles.flatMap((handle) => {
    const user = mentionedUsersByHandle.get(handle)
    if (!user) return []
    return [
      {
        userId: user.id,
        handle: user.handle,
        name: user.name ?? null,
        handleSnapshot: handle,
      } satisfies ResolvedPostMention,
    ]
  })

  return {
    topicSlugs: [...topicSlugs],
    communitySlugs: [...communitySlugs],
    mentionHandles,
    mentions,
    mentionedUserIds: mentions.map((mention) => mention.userId),
  }
}

export async function syncPostTaggingRelations(
  tx: TransactionClient,
  postId: string,
  tagging: Pick<ResolvedPostTagging, 'topicSlugs' | 'communitySlugs' | 'mentions'>,
) {
  await Promise.all([
    tx.postHashtag.deleteMany({ where: { postId } }),
    tx.postCommunityTag.deleteMany({ where: { postId } }),
    tx.postMention.deleteMany({ where: { postId } }),
  ])

  if (tagging.topicSlugs.length) {
    await tx.hashtag.createMany({
      data: tagging.topicSlugs.map((tag) => ({ tag })),
      skipDuplicates: true,
    })
    await tx.postHashtag.createMany({
      data: tagging.topicSlugs.map((tag) => ({ postId, tag })),
      skipDuplicates: true,
    })
  }

  if (tagging.communitySlugs.length) {
    await tx.postCommunityTag.createMany({
      data: tagging.communitySlugs.map((communitySlug) => ({ postId, communitySlug })),
      skipDuplicates: true,
    })
  }

  if (tagging.mentions.length) {
    await tx.postMention.createMany({
      data: tagging.mentions.map((mention) => ({
        postId,
        userId: mention.userId,
        handleSnapshot: mention.handleSnapshot,
      })),
      skipDuplicates: true,
    })
  }
}
