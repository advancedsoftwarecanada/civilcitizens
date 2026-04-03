import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { prisma } from '@civil/db'
import { MediaCategory, MediaTranscodeJobKind, ModerationStatus, Prisma } from '@prisma/client'
import {
  CompleteMediaUploadInput,
  MediaAssetIdSchema,
  RequestMediaUploadInput,
  UpdateProfileInput,
  UpdateProfilePhotoInput,
  buildHandleBase,
  findCommunity,
  getProvinceDisplayName,
} from '@civil/shared'
import { z } from 'zod'

const MediaAssetParam = z.object({ id: MediaAssetIdSchema })

type ProfileMediaDeps = Record<string, any>

let mediaTranscodeTablesReady: Promise<void> | null = null

function ensureMediaTranscodeTables(): Promise<void> {
  if (mediaTranscodeTablesReady) return mediaTranscodeTablesReady

  mediaTranscodeTablesReady = (async () => {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaTranscodeJobKind') THEN
          CREATE TYPE "MediaTranscodeJobKind" AS ENUM ('VIDEO_720P');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaTranscodeJobStatus') THEN
          CREATE TYPE "MediaTranscodeJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
        END IF;
      END
      $$;
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MediaTranscodeJob" (
        "id" TEXT NOT NULL,
        "assetId" TEXT NOT NULL,
        "kind" "MediaTranscodeJobKind" NOT NULL DEFAULT 'VIDEO_720P',
        "status" "MediaTranscodeJobStatus" NOT NULL DEFAULT 'QUEUED',
        "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "startedAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "lastError" TEXT,
        "payload" JSONB,
        "result" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "MediaTranscodeJob_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "MediaTranscodeJob_assetId_kind_key" ON "MediaTranscodeJob"("assetId", "kind")`,
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "MediaTranscodeJob_status_queuedAt_idx" ON "MediaTranscodeJob"("status", "queuedAt")`,
    )
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MediaAsset_id_uidx" ON "MediaAsset"("id")`)
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'MediaTranscodeJob_assetId_fkey'
        ) THEN
          ALTER TABLE "MediaTranscodeJob"
          ADD CONSTRAINT "MediaTranscodeJob_assetId_fkey"
          FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END
      $$;
    `)
  })().catch((err) => {
    mediaTranscodeTablesReady = null
    throw err
  })

  return mediaTranscodeTablesReady
}

export function registerProfileMediaRoutes(app: FastifyInstance, deps: ProfileMediaDeps) {
  app.get('/profile', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        handle: true,
        name: true,
        bio: true,
        billingAddress1: true,
        billingAddress2: true,
        billingCity: true,
        billingState: true,
        billingPostalCode: true,
        billingCountry: true,
        avatarUrl: true,
        coverUrl: true,
        premiumStatus: true,
        premiumSince: true,
        premiumRenewsAt: true,
        avatarMediaId: true,
        coverMediaId: true,
        avatarPostId: true,
        coverPostId: true,
        communityMeta: true,
        createdAt: true,
      },
    })

    if (!user) return reply.code(404).send({ error: 'not_found' })

    const [communitiesFollowing, homeFollow, friends, connections] = await Promise.all([
      prisma.communityFollow.count({ where: { userId } }),
      prisma.communityFollow.findFirst({ where: { userId, home: true } }),
      prisma.friendship.count({
        where: {
          status: 'ACCEPTED',
          OR: [{ requesterId: userId }, { addresseeId: userId }],
        },
      }),
      prisma.connection.count({
        where: {
          status: 'ACCEPTED',
          OR: [{ requesterId: userId }, { addresseeId: userId }],
        },
      }),
    ])

    let experienceItems: any[] = []

    try {
      const experiences = await prisma.experience.findMany({
        where: { userId },
        orderBy: [{ position: 'asc' }, { startDate: 'desc' }],
      })

      const normalizedExperienceOrganizationNames = Array.from(
        new Set(
          experiences
            .map((exp: (typeof experiences)[number]) => exp.organization.trim().toLowerCase())
            .filter((name: string) => name.length > 0),
        ),
      )

      const organizationByName = new Map<string, any>()

      if (normalizedExperienceOrganizationNames.length > 0) {
        const linkedOrganizations = await prisma.business.findMany({
          where: {
            status: 'ACTIVE',
            moderationStatus: ModerationStatus.VISIBLE,
            OR: normalizedExperienceOrganizationNames.map((name) => ({
              name: {
                equals: name,
                mode: 'insensitive' as const,
              },
            })),
          },
          orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            slug: true,
            provinceCode: true,
            communitySlug: true,
            logoUrl: true,
            coverUrl: true,
          },
        })

        for (const org of linkedOrganizations) {
          if (!org.provinceCode || !org.communitySlug) continue
          const key = org.name.trim().toLowerCase()
          if (!key || organizationByName.has(key)) continue
          organizationByName.set(key, {
            id: org.id,
            name: org.name,
            slug: org.slug,
            provinceCode: org.provinceCode,
            communitySlug: org.communitySlug,
            logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
            coverUrl: deps.normalizeMediaUrl(org.coverUrl ?? null),
          })
        }
      }

      experienceItems = experiences.map((exp: (typeof experiences)[number]) => ({
        organizationProfile: organizationByName.get(exp.organization.trim().toLowerCase()) ?? null,
        id: exp.id,
        title: exp.title,
        organization: exp.organization,
        location: exp.location ?? null,
        startDate: exp.startDate,
        endDate: exp.endDate ?? null,
        current: exp.current,
        description: exp.description ?? null,
      }))
    } catch (err) {
      if (!deps.isExperienceTableMissing(err)) throw err
    }

    const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean)
    const firstName = nameParts[0] ?? ''
    const lastName = nameParts.slice(1).join(' ')
    const communityMeta = deps.parseCommunityMeta(user.communityMeta ?? null)

    let homeCommunity: Record<string, any> | null = null
    if (homeFollow) {
      const community = findCommunity(homeFollow.provinceCode, homeFollow.communitySlug)
      const provinceName = getProvinceDisplayName(homeFollow.provinceCode as any)
      homeCommunity = {
        provinceCode: homeFollow.provinceCode,
        provinceName,
        communitySlug: homeFollow.communitySlug,
        communityName: community?.name ?? homeFollow.communitySlug,
      }
    }

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        handle: user.handle,
        firstName,
        lastName,
        name: user.name,
        bio: deps.normalizeRichTextHtml(user.bio),
        billingAddress1: user.billingAddress1 ?? null,
        billingAddress2: user.billingAddress2 ?? null,
        billingCity: user.billingCity ?? null,
        billingState: user.billingState ?? null,
        billingPostalCode: user.billingPostalCode ?? null,
        billingCountry: user.billingCountry ?? null,
        avatarUrl: deps.normalizeMediaUrl(user.avatarUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(user.coverUrl ?? null),
        avatarMediaId: user.avatarMediaId ?? null,
        coverMediaId: user.coverMediaId ?? null,
        avatarPostId: user.avatarPostId ?? null,
        coverPostId: user.coverPostId ?? null,
        dateOfBirth: communityMeta?.dateOfBirth ?? null,
        countryOfBirth: communityMeta?.countryOfBirth ?? null,
        shareDateOfBirth: communityMeta?.shareDateOfBirth ?? true,
        shareCountryOfBirth: communityMeta?.shareCountryOfBirth ?? true,
        createdAt: user.createdAt,
        experiences: experienceItems,
      },
      stats: {
        friends,
        connections,
        communitiesFollowing,
      },
      homeCommunity,
    })
  })

  app.put('/profile', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = UpdateProfileInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const { firstName, lastName, dateOfBirth, countryOfBirth, shareDateOfBirth, shareCountryOfBirth, bio, experiences, avatarMediaId, coverMediaId } = parse.data
    const normalizedFirstName = firstName.trim().toLowerCase()
    const normalizedLastName = lastName.trim().toLowerCase()
    const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim()

    let avatarAsset: Awaited<ReturnType<typeof prisma.mediaAsset.findFirst>> = null
    if (avatarMediaId) {
      avatarAsset = await prisma.mediaAsset.findFirst({ where: { id: avatarMediaId, ownerId: userId, category: 'avatar' } })
      if (!avatarAsset) return reply.code(400).send({ error: 'invalid_avatar_media' })
      if (avatarAsset.status === 'failed') return reply.code(400).send({ error: 'avatar_media_failed' })
    }

    let coverAsset: Awaited<ReturnType<typeof prisma.mediaAsset.findFirst>> = null
    if (coverMediaId) {
      coverAsset = await prisma.mediaAsset.findFirst({ where: { id: coverMediaId, ownerId: userId, category: 'cover' } })
      if (!coverAsset) return reply.code(400).send({ error: 'invalid_cover_media' })
      if (coverAsset.status === 'failed') return reply.code(400).send({ error: 'cover_media_failed' })
    }

    const normalizedExperiences = (experiences ?? []).map((
      exp: NonNullable<typeof experiences>[number],
      index: number,
    ) => ({
      id: randomUUID(),
      userId,
      title: exp.title.trim(),
      organization: exp.organization.trim(),
      location: exp.location?.trim() || null,
      startDate: new Date(exp.startDate),
      endDate: exp.current ? null : exp.endDate ? new Date(exp.endDate) : null,
      current: exp.current,
      description: exp.description?.trim() ? exp.description.trim() : null,
      position: index,
    }))

    try {
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const baseHandle = buildHandleBase(normalizedFirstName, normalizedLastName)
        const handle = await deps.generateUniqueHandle(baseHandle, tx, userId)
        const currentUser = await tx.user.findUnique({ where: { id: userId }, select: { communityMeta: true } })
        const communityMeta = deps.readBaseCommunityMeta(currentUser?.communityMeta ?? null)

        if (dateOfBirth) {
          communityMeta.dateOfBirth = dateOfBirth
        } else {
          delete communityMeta.dateOfBirth
        }

        if (countryOfBirth?.trim()) {
          communityMeta.countryOfBirth = countryOfBirth.trim()
        } else {
          delete communityMeta.countryOfBirth
        }

        communityMeta.shareDateOfBirth = shareDateOfBirth ?? true
        communityMeta.shareCountryOfBirth = shareCountryOfBirth ?? true

        const userUpdateData: Prisma.UserUncheckedUpdateInput = {
          name: fullName,
          bio: deps.normalizeRichTextHtml(bio) || null,
          handle,
          communityMeta: communityMeta as Prisma.InputJsonValue,
        }

        if (avatarMediaId) {
          userUpdateData.avatarMediaId = avatarMediaId
          const avatarUrl = avatarAsset?.status === 'ready' ? deps.extractVariantUrl(avatarAsset.variants, ['avatar@2x', 'avatar@1x', 'avatar-thumb']) : null
          if (avatarUrl) userUpdateData.avatarUrl = avatarUrl
        }

        if (coverMediaId) {
          userUpdateData.coverMediaId = coverMediaId
          const coverUrl = coverAsset?.status === 'ready' ? deps.extractVariantUrl(coverAsset.variants, ['cover-xl', 'cover-lg', 'cover-md']) : null
          if (coverUrl) userUpdateData.coverUrl = coverUrl
        }

        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: userUpdateData,
          select: {
            id: true,
            name: true,
            bio: true,
            handle: true,
            avatarUrl: true,
            coverUrl: true,
            avatarMediaId: true,
            coverMediaId: true,
            avatarPostId: true,
            coverPostId: true,
          },
        })

        if (experiences) {
          await tx.experience.deleteMany({ where: { userId } })
          if (normalizedExperiences.length > 0) {
            await tx.experience.createMany({ data: normalizedExperiences })
          }
        }

        return updatedUser
      })

      return reply.send({ ok: true, user: deps.normalizeUserMedia(result) })
    } catch (err) {
      if (deps.isExperienceTableMissing(err)) return reply.code(503).send({ error: 'experiences_not_available' })
      throw err
    }
  })

  app.post('/profile/photo', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })
      const ownerUserId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId

      const parsed = UpdateProfilePhotoInput.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

      const { category, displayAssetId, fullAssetId, caption } = parsed.data

      const displayAsset = await prisma.mediaAsset.findFirst({ where: { id: displayAssetId, ownerId: ownerUserId, category } })
      if (!displayAsset) return reply.code(404).send({ error: 'display_asset_not_found' })
      if (displayAsset.status === 'failed') return reply.code(400).send({ error: 'display_asset_failed' })
      if (displayAsset.status !== 'ready') return reply.code(409).send({ error: 'display_asset_not_ready' })
      if (authContext.actor === 'family_member' && !deps.familyMemberOwnsAssetForSession(displayAsset, authContext.member.id)) {
        return reply.code(403).send({ error: 'asset_not_owned_by_family_member' })
      }

      const fullAsset = await prisma.mediaAsset.findFirst({ where: { id: fullAssetId, ownerId: ownerUserId } })
      if (!fullAsset) return reply.code(404).send({ error: 'full_asset_not_found' })
      if (fullAsset.status === 'failed') return reply.code(400).send({ error: 'full_asset_failed' })
      if (fullAsset.status !== 'ready') return reply.code(409).send({ error: 'full_asset_not_ready' })
      if (authContext.actor === 'family_member' && !deps.familyMemberOwnsAssetForSession(fullAsset, authContext.member.id)) {
        return reply.code(403).send({ error: 'asset_not_owned_by_family_member' })
      }

      const displayVariantPreference = category === 'avatar' ? ['avatar@2x', 'avatar@1x', 'avatar-thumb'] : ['cover-xl', 'cover-lg', 'cover-md']
      const displayUrl = deps.extractVariantUrl(displayAsset.variants, displayVariantPreference)
      if (!displayUrl) return reply.code(400).send({ error: 'display_variant_missing' })

      const postVariantPreference = (() => {
        if (fullAsset.category === 'post_image') return ['post-xl', 'post-lg', 'post-md']
        if (fullAsset.category === 'cover') return ['cover-xl', 'cover-lg', 'cover-md']
        return ['avatar@2x', 'avatar@1x', 'avatar-thumb']
      })()
      const postMediaUrl = deps.extractVariantUrl(fullAsset.variants, postVariantPreference)
      if (!postMediaUrl) return reply.code(400).send({ error: 'full_variant_missing' })

      const baseBody = category === 'avatar' ? 'Updated profile photo.' : 'Updated cover photo.'
      const body = caption?.trim() ? caption.trim() : baseBody

      if (authContext.actor === 'family_member') {
        if (!authContext.member.allowChildOwnMediaEdits) {
          return reply.code(403).send({ error: 'family_member_media_edit_not_allowed' })
        }

        let updatedMember: any = null
        let createdFamilyPost: {
          id: string
          body: string
          images: Prisma.JsonValue
          createdAt: Date
          updatedAt: Date
        } | null = null

        try {
          createdFamilyPost = await prisma.post.create({
            data: {
              authorId: authContext.member.parentId,
              body,
              images: [postMediaUrl] as any,
              type: deps.FAMILY_FEED_POST_TYPE,
              title: deps.buildFamilyFeedPostTitle(authContext.member.id),
              audience: 'family',
              visibility: 'public',
              jurisdiction: 'self',
            },
            select: {
              id: true,
              body: true,
              images: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        } catch (error) {
          if (!deps.isSchemaOutOfDateError(error)) throw error
        }

        try {
          const memberWithMediaColumns = await prisma.familyMember.update({
            where: { id: authContext.member.id },
            data: category === 'avatar' ? { avatarUrl: displayUrl } : { coverUrl: displayUrl },
            select: {
              id: true,
              parentId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              relationship: true,
              friendCode: true,
              avatarUrl: true,
              coverUrl: true,
              suspendedAt: true,
              suspendedById: true,
              suspensionNote: true,
              createdAt: true,
              updatedAt: true,
            },
          })
          updatedMember = {
            ...memberWithMediaColumns,
            allowChildOwnMediaEdits: authContext.member.allowChildOwnMediaEdits,
            notifyParentOnMediaChanges: authContext.member.notifyParentOnMediaChanges,
          }
        } catch (error) {
          if (!deps.isFamilyMemberTableMissing(error)) throw error

          const parent = await prisma.user.findUnique({
            where: { id: authContext.member.parentId },
            select: { communityMeta: true },
          })
          const baseMeta = deps.readBaseCommunityMeta(parent?.communityMeta ?? null)
          deps.writeLegacyFamilyMemberProfileMedia(baseMeta, authContext.member.id, {
            ...(category === 'avatar' ? { avatarUrl: displayUrl } : {}),
            ...(category === 'cover' ? { coverUrl: displayUrl } : {}),
          })
          await prisma.user.update({
            where: { id: authContext.member.parentId },
            data: { communityMeta: baseMeta as Prisma.InputJsonValue },
          })

          updatedMember = {
            ...authContext.member,
            ...(category === 'avatar' ? { avatarUrl: displayUrl } : {}),
            ...(category === 'cover' ? { coverUrl: displayUrl } : {}),
          }
        }

        if (!updatedMember) return reply.code(500).send({ error: 'family_member_update_failed' })

        if (updatedMember.notifyParentOnMediaChanges) {
          void deps.createNotificationRecord({
            userId: updatedMember.parentId,
            actorId: updatedMember.id,
            type: deps.FAMILY_NOTIFICATION_TYPES.MEDIA_CHANGED,
            payload: {
              memberId: updatedMember.id,
              childDisplayName: `${updatedMember.firstName} ${updatedMember.lastName}`.trim(),
              category,
              url: '/settings/family/settings',
              sourceUrl: '/settings/family/settings',
            },
          }).catch((error: unknown) => {
            req.log.error({ err: error, memberId: updatedMember?.id }, 'family_profile_photo_notification_failed')
          })
        }

        const homeCommunity = await deps.buildHomeCommunitySummaryForUserId(updatedMember.parentId)
        const refreshedMember = {
          ...updatedMember,
          parent: authContext.member.parent,
        }

        return reply.send({
          ok: true,
          post: createdFamilyPost
            ? deps.formatChildFamilyFeedPost(
                {
                  id: createdFamilyPost.id,
                  familyMemberId: updatedMember.id,
                  body: createdFamilyPost.body,
                  images: createdFamilyPost.images,
                  createdAt: createdFamilyPost.createdAt,
                  updatedAt: createdFamilyPost.updatedAt,
                },
                deps.normalizeFamilyMemberSummary(updatedMember),
              )
            : null,
          viewer: deps.buildFamilyMemberAuthMeResponse(refreshedMember, homeCommunity),
        })
      }

      const author = await prisma.user.findUnique({
        where: { id: ownerUserId },
        select: { id: true, handle: true, name: true, avatarUrl: true, premiumStatus: true },
      })
      if (!author) return reply.code(401).send({ error: 'unauthorized' })

      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const post = await tx.post.create({
          data: {
            authorId: ownerUserId,
            body,
            mediaUrl: postMediaUrl,
            type: 'post',
            jurisdiction: 'self',
          },
          include: {
            author: {
              select: {
                id: true,
                handle: true,
                name: true,
                avatarUrl: true,
                premiumStatus: true,
              },
            },
          },
        })

        const userUpdate: Prisma.UserUncheckedUpdateInput =
          category === 'avatar'
            ? { avatarMediaId: displayAsset.id, avatarUrl: displayUrl, avatarPostId: post.id }
            : { coverMediaId: displayAsset.id, coverUrl: displayUrl, coverPostId: post.id }

        const updatedUser = await tx.user.update({
          where: { id: ownerUserId },
          data: userUpdate,
          select: {
            id: true,
            email: true,
            handle: true,
            name: true,
            bio: true,
            avatarUrl: true,
            coverUrl: true,
            avatarMediaId: true,
            coverMediaId: true,
            avatarPostId: true,
            coverPostId: true,
          },
        })

        return { post, user: updatedUser }
      })

      const postWithUpdatedAuthor = {
        ...result.post,
        author: {
          ...result.post.author,
          avatarUrl: category === 'avatar' ? displayUrl : result.post.author.avatarUrl,
        },
      }

      void deps.enqueueContentAiScanForPost({
        id: result.post.id,
        authorId: result.post.authorId,
        title: result.post.title,
        body: result.post.body,
        mediaUrl: result.post.mediaUrl,
        images: result.post.images,
      }).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_profile_photo_post_failed', error)
      })

      return reply.send({
        ok: true,
        post: deps.formatPost(postWithUpdatedAuthor),
        user: deps.normalizeUserMedia(result.user),
      })
    }),
  )

  app.post('/media/uploads', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })
      const ownerUserId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId

      const parse = RequestMediaUploadInput.safeParse(req.body)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { category, mime, byteSize, filename } = parse.data
      const mediaCategory = category as MediaCategory
      const limit = deps.MEDIA_CATEGORY_LIMITS[mediaCategory]
      if (byteSize > limit) return reply.code(400).send({ error: 'file_too_large', maxBytes: limit })
      if (!deps.ensureMimeSupported(mediaCategory, mime)) return reply.code(400).send({ error: 'unsupported_mime' })

      const assetId = randomUUID()
      const extension = deps.extensionForMime(mime)
      const originalKey = deps.buildOriginalObjectKey(mediaCategory, ownerUserId, assetId, extension)
      const metadata = {
        ...(filename ? { filename } : {}),
        ...(authContext.actor === 'family_member' ? { familyMemberId: authContext.member.id } : {}),
      }

      const asset = await prisma.mediaAsset.create({
        data: {
          id: assetId,
          ownerId: ownerUserId,
          category: mediaCategory,
          assetType: mediaCategory === 'post_video' ? 'video' : 'image',
          storageType: 'minio',
          originalKey,
          mime,
          byteSize,
          status: 'pending',
          metadata,
        },
      })

      const command = new PutObjectCommand({
        Bucket: deps.MEDIA_BUCKET_ORIGINAL,
        Key: originalKey,
        ContentType: mime,
      })
      const uploadUrl = await getSignedUrl(deps.s3Client, command, { expiresIn: deps.MEDIA_SIGNED_URL_TTL })
      const allowDirectUploadUrl = !deps.isPrivateOrLocalNetworkUrl(uploadUrl)

      return reply.send({
        assetId: asset.id,
        upload: allowDirectUploadUrl
          ? {
              url: uploadUrl,
              method: 'PUT',
              headers: {
                'content-type': mime,
              },
            }
          : undefined,
        proxyPath: `/media/uploads/${asset.id}/proxy`,
        expiresInSeconds: deps.MEDIA_SIGNED_URL_TTL,
        bucket: deps.MEDIA_BUCKET_ORIGINAL,
        key: originalKey,
        maxBytes: limit,
      })
    }),
  )

  app.post('/media/uploads/complete', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })
      const ownerUserId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId

      const parse = CompleteMediaUploadInput.safeParse(req.body)
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const { assetId, width, height, durationMs, checksum } = parse.data
      const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, ownerId: ownerUserId } })
      if (!asset) return reply.code(404).send({ error: 'asset_not_found' })
      if (authContext.actor === 'family_member' && !deps.familyMemberOwnsAssetForSession(asset, authContext.member.id)) {
        return reply.code(403).send({ error: 'asset_not_owned_by_family_member' })
      }

      if (asset.status === 'ready') return reply.send({ ok: true, assetId })

      const updatedAsset = await prisma.mediaAsset.update({
        where: { id: assetId },
        data: {
          width: width ?? asset.width,
          height: height ?? asset.height,
          durationMs: durationMs ?? asset.durationMs,
          checksum: checksum ?? asset.checksum,
          status: 'processing',
          failureReason: null,
        },
      })

      if (authContext.actor !== 'family_member') {
        if (asset.category === 'avatar') {
          await prisma.user.update({ where: { id: ownerUserId }, data: { avatarMediaId: updatedAsset.id } })
        } else if (asset.category === 'cover') {
          await prisma.user.update({ where: { id: ownerUserId }, data: { coverMediaId: updatedAsset.id } })
        }
      }

      if (updatedAsset.assetType === 'video') {
        await ensureMediaTranscodeTables()

        await prisma.mediaTranscodeJob.upsert({
          where: {
            assetId_kind: {
              assetId: updatedAsset.id,
              kind: MediaTranscodeJobKind.VIDEO_720P,
            },
          },
          create: {
            assetId: updatedAsset.id,
            kind: MediaTranscodeJobKind.VIDEO_720P,
            status: 'QUEUED',
            queuedAt: new Date(),
            payload: {
              maxDurationMs: 5 * 60 * 1000,
              targetHeight: 720,
              targetWidth: 1280,
            },
          },
          update: {
            status: 'QUEUED',
            queuedAt: new Date(),
            startedAt: null,
            completedAt: null,
            lastError: null,
            result: Prisma.DbNull,
            payload: {
              maxDurationMs: 5 * 60 * 1000,
              targetHeight: 720,
              targetWidth: 1280,
            },
          },
        })
      }

      await deps.mediaQueue.add(
        'process',
        { assetId },
        {
          removeOnComplete: true,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
        },
      )

      return reply.send({ ok: true, assetId })
    }),
  )

  app.put(
    '/media/uploads/:id/proxy',
    { bodyLimit: deps.MEDIA_PROXY_UPLOAD_LIMIT },
    async (req: FastifyRequest, reply: FastifyReply) =>
      deps.withSchemaGuard(req, reply, async () => {
        const authContext = await deps.loadViewerAuthContext(req)
        if (!authContext) return reply.code(401).send({ error: 'unauthorized' })
        const ownerUserId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId

        const params = MediaAssetParam.safeParse(req.params)
        if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

        const asset = await prisma.mediaAsset.findFirst({ where: { id: params.data.id, ownerId: ownerUserId } })
        if (!asset) return reply.code(404).send({ error: 'asset_not_found' })
        if (authContext.actor === 'family_member' && !deps.familyMemberOwnsAssetForSession(asset, authContext.member.id)) {
          return reply.code(403).send({ error: 'asset_not_owned_by_family_member' })
        }
        if (asset.status !== 'pending') return reply.code(409).send({ error: 'asset_not_pending' })

        const bodyBuffer = Buffer.isBuffer((req as any).body) ? ((req as any).body as Buffer) : await deps.readRequestBuffer(req)
        if (!bodyBuffer || bodyBuffer.length === 0) return reply.code(400).send({ error: 'empty_upload' })

        const assetCategory = asset.category as MediaCategory
        const maxBytes = asset.byteSize ?? deps.MEDIA_CATEGORY_LIMITS[assetCategory]
        if (maxBytes && bodyBuffer.length > maxBytes) {
          return reply.code(400).send({ error: 'file_too_large', maxBytes })
        }

        await deps.s3Client.send(
          new PutObjectCommand({
            Bucket: deps.MEDIA_BUCKET_ORIGINAL,
            Key: asset.originalKey,
            Body: bodyBuffer,
            ContentType: asset.mime ?? 'application/octet-stream',
          }),
        )

        return reply.send({ ok: true, bytesUploaded: bodyBuffer.length })
      }),
  )

  app.get('/media/assets/:id', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext) return reply.code(401).send({ error: 'unauthorized' })
      const ownerUserId = authContext.actor === 'family_member' ? authContext.member.parentId : authContext.userId

      const params = MediaAssetParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const asset = await prisma.mediaAsset.findFirst({ where: { id: params.data.id, ownerId: ownerUserId } })
      if (!asset) return reply.code(404).send({ error: 'asset_not_found' })
      if (authContext.actor === 'family_member' && !deps.familyMemberOwnsAssetForSession(asset, authContext.member.id)) {
        return reply.code(403).send({ error: 'asset_not_owned_by_family_member' })
      }

      const transcodeJob =
        asset.assetType === 'video'
          ? await prisma.mediaTranscodeJob.findUnique({
              where: {
                assetId_kind: {
                  assetId: asset.id,
                  kind: MediaTranscodeJobKind.VIDEO_720P,
                },
              },
            })
          : null

      return reply.send({
        asset: {
          id: asset.id,
          category: asset.category,
          assetType: asset.assetType,
          status: asset.status,
          variants: deps.normalizeMediaVariants(asset.variants),
          width: asset.width,
          height: asset.height,
          durationMs: asset.durationMs,
          failureReason: asset.failureReason,
          readyAt: asset.readyAt,
          transcodeJob: transcodeJob
            ? {
                kind: transcodeJob.kind,
                status: transcodeJob.status,
                queuedAt: transcodeJob.queuedAt,
                startedAt: transcodeJob.startedAt,
                completedAt: transcodeJob.completedAt,
                attempts: transcodeJob.attempts,
                lastError: transcodeJob.lastError,
              }
            : null,
        },
      })
    }),
  )
}