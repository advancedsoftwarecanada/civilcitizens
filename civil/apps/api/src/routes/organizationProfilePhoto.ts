import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

type OrganizationProfilePhotoDeps = Record<string, any>

export function registerOrganizationProfilePhotoRoutes(app: FastifyInstance, deps: OrganizationProfilePhotoDeps) {
  app.post('/communities/:province/:municipality/orgs/:slug/profile-photo', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const body = deps.CommunityOrgPhotoUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })

      const communitySlug = params.data.municipality.trim().toLowerCase()
      if (!communitySlug) return reply.code(404).send({ error: 'community_not_found' })

      const community = deps.findCommunity(province, communitySlug)
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const slug = params.data.slug.trim().toLowerCase()
      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug },
        select: {
          id: true,
          ownerId: true,
          provinceCode: true,
          communitySlug: true,
          name: true,
          slug: true,
          type: true,
          description: true,
          status: true,
          isVerified: true,
          logoUrl: true,
          coverUrl: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { follows: true } },
        },
      })

      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const isOwner = org.ownerId === userId
      const membership = isOwner
        ? { role: 'OWNER' as const }
        : await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: org.id, userId } },
            select: { role: true },
          })
      if (!membership) return reply.code(403).send({ error: 'forbidden' })

      const displayAsset = await prisma.mediaAsset.findFirst({ where: { id: body.data.displayAssetId, ownerId: userId, category: body.data.category } })
      if (!displayAsset) return reply.code(404).send({ error: 'display_asset_not_found' })
      if (displayAsset.status === 'failed') return reply.code(400).send({ error: 'display_asset_failed' })
      if (displayAsset.status !== 'ready') return reply.code(409).send({ error: 'display_asset_not_ready' })

      const fullAssetId = body.data.fullAssetId ?? body.data.displayAssetId
      const fullAsset = await prisma.mediaAsset.findFirst({ where: { id: fullAssetId, ownerId: userId } })
      if (!fullAsset) return reply.code(404).send({ error: 'full_asset_not_found' })
      if (fullAsset.status === 'failed') return reply.code(400).send({ error: 'full_asset_failed' })
      if (fullAsset.status !== 'ready') return reply.code(409).send({ error: 'full_asset_not_ready' })

      const displayVariantPreference = body.data.category === 'business_logo' ? ['logo@2x', 'logo@1x', 'logo-thumb'] : ['cover-xl', 'cover-lg', 'cover-md']
      const displayUrl = deps.extractVariantUrl(displayAsset.variants, displayVariantPreference)
      if (!displayUrl) return reply.code(400).send({ error: 'display_variant_missing' })

      const postVariantPreference = (() => {
        if (fullAsset.category === 'post_image') {
          return ['post-xl', 'post-lg', 'post-md']
        }
        if (fullAsset.category === 'business_cover' || fullAsset.category === 'cover') {
          return ['cover-xl', 'cover-lg', 'cover-md']
        }
        if (fullAsset.category === 'business_logo' || fullAsset.category === 'avatar') {
          return ['logo@2x', 'logo@1x', 'logo-thumb']
        }
        return ['post-xl', 'post-lg', 'post-md']
      })()

      const postMediaUrl = deps.extractVariantUrl(fullAsset.variants, postVariantPreference)
      if (!postMediaUrl) return reply.code(400).send({ error: 'full_variant_missing' })

      const baseBody = body.data.category === 'business_logo' ? 'Updated organization profile photo.' : 'Updated organization cover photo.'
      const postBody = body.data.caption?.trim() ? body.data.caption.trim() : baseBody

      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const post = await tx.post.create({
          data: {
            authorId: userId,
            businessId: org.id,
            body: postBody,
            mediaUrl: postMediaUrl,
            type: 'post',
            provinceCode: org.provinceCode,
            communitySlug: org.communitySlug,
            jurisdiction: 'municipal',
          },
          include: deps.POST_INCLUDE,
        })

        const businessUpdate: Prisma.BusinessUpdateInput =
          body.data.category === 'business_logo'
            ? { logoMedia: { connect: { id: displayAsset.id } }, logoUrl: displayUrl }
            : { coverMedia: { connect: { id: displayAsset.id } }, coverUrl: displayUrl }

        const updated = await tx.business.update({
          where: { id: org.id },
          data: businessUpdate,
          select: {
            id: true,
            ownerId: true,
            provinceCode: true,
            communitySlug: true,
            name: true,
            slug: true,
            type: true,
            description: true,
            status: true,
            isVerified: true,
            logoUrl: true,
            coverUrl: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { follows: true } },
          },
        })

        return { post, org: updated }
      })

      void deps.enqueueContentAiScanForPost({
        id: result.post.id,
        authorId: result.post.authorId,
        title: result.post.title,
        body: result.post.body,
        mediaUrl: result.post.mediaUrl,
        images: result.post.images,
      }).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_organization_photo_post_failed', error)
      })

      void deps.enqueueContentAiScanForOrganization(result.org).catch((error: unknown) => {
        console.error('content_ai_scan_enqueue_organization_photo_org_failed', error)
      })

      return reply.send({
        ok: true,
        post: deps.formatPost(result.post),
        org: deps.buildCommunityOrgPayload(result.org, true, membership.role),
      })
    }),
  )
}