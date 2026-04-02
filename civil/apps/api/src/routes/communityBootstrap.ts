import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'
import {
  CommunityGeolocateInput,
  CursorQuery,
  findCommunity,
  FollowCommunityInput,
  getCommunitiesByProvince,
  JurisdictionEnum,
  normalizeProvinceCode,
  PostalGeolocateInput,
  PostalLookupInput,
  PostSortEnum,
  SetHomeCommunityInput,
  UnfollowCommunityInput,
} from '@civil/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import {
  buildFollowKey,
  computeGeodataFallbackSuggestions,
  computeNearbyCommunitySuggestions,
  enrichMatchesWithCities,
  filterCachedSuggestions,
  normalizePostalCodeInput,
} from '../communityGeo.js'
import { locateCommunityFromPoint } from '../geodata.js'
import { locateFsaFromPoint } from '../fsaLocator.js'
import { statsCanPointToWgs84 } from '../statscan.js'

type CommunityRouteMethod = 'delete' | 'get' | 'patch' | 'post' | 'put'
type CommunityRouteHandler = (req: FastifyRequest, reply: FastifyReply) => unknown

type CommunityBootstrapRoutesDeps = {
  COMMUNITY_FOLLOW_TARGET: number
  POST_INCLUDE: any
  formatPost: (post: any, options: any) => any
  loadViewerPostFormattingContext: (viewerId: string | undefined, postIds: string[], recentCommentLimit: number) => Promise<any>
  parseCommunityMeta: (value: any) => any
  registerCommunityRoute: (method: CommunityRouteMethod, path: string, handler: CommunityRouteHandler) => void
}

export function registerCommunityBootstrapRoutes(app: FastifyInstance, deps: CommunityBootstrapRoutesDeps) {
  deps.registerCommunityRoute('get', '/communities', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = z.object({ province: z.string().min(2).max(64) }).safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    const province = normalizeProvinceCode(query.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    return reply.send({ items: getCommunitiesByProvince(province) })
  })

  deps.registerCommunityRoute('get', '/communities/provinces', async (_req: FastifyRequest, reply: FastifyReply) => {
    const items = await prisma.province.findMany({
      orderBy: [{ name: 'asc' }],
      select: { code: true, name: true },
    })

    return reply.send({ items })
  })

  deps.registerCommunityRoute(
    'get',
    '/communities/:province/:community/posts',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = z
        .object({
          province: z.string().min(2).max(64),
          community: z.string().min(1).max(160),
        })
        .safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const province = normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })

      const communityRecord = findCommunity(province, params.data.community)
      if (!communityRecord) return reply.code(404).send({ error: 'community_not_found' })

      const query = CursorQuery.extend({
        jurisdiction: JurisdictionEnum.optional(),
        sort: PostSortEnum.optional(),
      }).safeParse(req.query)
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const { cursor, limit, jurisdiction, sort } = query.data
      const viewerId = (req as any).user?.id as string | undefined
      const sortMode = sort ?? 'new'

      const where: Prisma.PostWhereInput = {
        provinceCode: communityRecord.province,
        communitySlug: communityRecord.slug,
        visibility: 'public',
        ...(jurisdiction ? { jurisdiction } : {}),
      }

      let items: any[] = []
      let nextCursor: string | undefined

      if (sortMode === 'hot') {
        items = await prisma.post.findMany({
          where,
          take: limit,
          orderBy: [{ hotScore: 'desc' }, { lastActivityAt: 'desc' }],
          include: deps.POST_INCLUDE,
        })
      } else {
        const queryResult = await prisma.post.findMany({
          where,
          take: limit + 1,
          orderBy: { createdAt: 'desc' },
          include: deps.POST_INCLUDE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })
        if (queryResult.length > limit) {
          const next = queryResult.pop()!
          nextCursor = next.id
        }
        items = queryResult
      }

      const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost, causeByPost } = await deps.loadViewerPostFormattingContext(
        viewerId,
        items.map((item) => item.id),
        5,
      )

      return {
        community: communityRecord,
        items: items.map((item) =>
          deps.formatPost(item, {
            viewerId,
            viewerReaction: reactionsByPost[item.id] ?? null,
            viewerPollOptionId: pollSelectionsByPost[item.id] ?? null,
            recentComments: recentCommentsByPost[item.id] ?? [],
            cause: causeByPost[item.id] ?? null,
          }),
        ),
        nextCursor,
      }
    },
  )

  deps.registerCommunityRoute('get', '/communities/:province', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({ province: z.string().min(2).max(64) }).safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const province = normalizeProvinceCode(params.data.province)
    if (!province) return reply.code(404).send({ error: 'province_not_found' })

    return reply.send({ items: getCommunitiesByProvince(province) })
  })

  deps.registerCommunityRoute('get', '/communities/home', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const follow = await prisma.communityFollow.findFirst({ where: { userId, home: true } })
    if (!follow) return reply.send({ home: null })

    const community = findCommunity(follow.provinceCode, follow.communitySlug)
    return reply.send({
      home: community ? { ...community } : { province: follow.provinceCode, slug: follow.communitySlug },
    })
  })

  deps.registerCommunityRoute('post', '/communities/home', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = SetHomeCommunityInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const province = normalizeProvinceCode(parse.data.provinceCode)
    if (!province) return reply.code(400).send({ error: 'invalid_province' })

    const community = findCommunity(province, parse.data.communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    await prisma.$transaction(async (tx: any) => {
      await tx.communityFollow.upsert({
        where: {
          userId_provinceCode_communitySlug: {
            userId,
            provinceCode: province,
            communitySlug: community.slug,
          },
        },
        create: {
          userId,
          provinceCode: province,
          communitySlug: community.slug,
          home: true,
        },
        update: {
          home: true,
          provinceCode: province,
          communitySlug: community.slug,
        },
      })

      await tx.communityFollow.updateMany({
        where: {
          userId,
          home: true,
          NOT: {
            provinceCode: province,
            communitySlug: community.slug,
          },
        },
        data: { home: false },
      })
    })

    return reply.send({ ok: true, home: community })
  })

  deps.registerCommunityRoute('get', '/communities/follows', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const follows = await prisma.communityFollow.findMany({
      where: { userId },
      orderBy: [{ home: 'desc' }, { createdAt: 'desc' }],
    })

    const items = follows.map((follow: { provinceCode: string; communitySlug: string; home: boolean; createdAt: Date }) => ({
      province: follow.provinceCode,
      communitySlug: follow.communitySlug,
      home: follow.home,
      followedAt: follow.createdAt,
      community: findCommunity(follow.provinceCode, follow.communitySlug),
    }))

    return reply.send({ items })
  })

  app.get('/communities/dashboard', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const [user, follows] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { communityMeta: true } }),
      prisma.communityFollow.findMany({
        where: { userId },
        orderBy: [{ home: 'desc' }, { createdAt: 'desc' }],
      }),
    ])

    const followCount = follows.length
    const followKeys: Set<string> = new Set(
      follows.map((follow: { provinceCode: string; communitySlug: string }) => buildFollowKey(follow.provinceCode, follow.communitySlug)),
    )

    const referenceFollow = follows.find((follow: { home: boolean }) => follow.home) ?? follows[0] ?? null
    let referenceCity: any = null
    if (referenceFollow) {
      referenceCity = await prisma.city.findFirst({
        where: { provinceCode: referenceFollow.provinceCode, communitySlug: referenceFollow.communitySlug },
        orderBy: [{ population: 'desc' }],
      })
    }

    const communityMeta = deps.parseCommunityMeta(user?.communityMeta ?? null)
    let suggestions = filterCachedSuggestions(communityMeta?.nearbyCommunities, followKeys)

    if (!suggestions.length) {
      let computed: any[] = []
      let computedReference: any = null

      if (referenceCity) {
        const nearest = await computeNearbyCommunitySuggestions(referenceCity, followKeys)
        if (nearest.length) {
          computed = nearest
          computedReference = {
            provinceCode: referenceCity.provinceCode,
            communitySlug: referenceCity.communitySlug,
            cityName: referenceCity.name,
          }
        }
      }

      if (!computed.length && referenceFollow) {
        const fallback = await computeGeodataFallbackSuggestions(
          { provinceCode: referenceFollow.provinceCode, communitySlug: referenceFollow.communitySlug },
          followKeys,
        )
        if (fallback.length) {
          computed = fallback
          computedReference = {
            provinceCode: referenceFollow.provinceCode,
            communitySlug: referenceFollow.communitySlug,
            cityName: referenceCity?.name ?? null,
          }
        }
      }

      if (computed.length) {
        suggestions = computed.slice()
        const payload = {
          nearbyCommunities: computed,
          computedAt: new Date().toISOString(),
          reference: computedReference,
        }
        try {
          await prisma.user.update({ where: { id: userId }, data: { communityMeta: payload } })
        } catch (error) {
          req.log?.warn({ err: error }, 'Failed to persist community meta')
        }
      }
    }

    let postsToday = 0
    if (followKeys.size) {
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      const orConditions = follows
        .filter((follow: { communitySlug: string }) => follow.communitySlug)
        .map((follow: { provinceCode: string; communitySlug: string }) => ({ provinceCode: follow.provinceCode, communitySlug: follow.communitySlug }))

      if (orConditions.length) {
        postsToday = await prisma.post.count({
          where: {
            createdAt: { gte: startOfToday },
            OR: orConditions,
          },
        })
      }
    }

    return reply.send({
      followCount,
      followTarget: deps.COMMUNITY_FOLLOW_TARGET,
      postsToday,
      suggestions,
      home: referenceCity
        ? {
            provinceCode: referenceCity.provinceCode,
            communitySlug: referenceCity.communitySlug,
            communityName: referenceCity.communityName,
            cityName: referenceCity.name,
          }
        : null,
    })
  })

  deps.registerCommunityRoute('post', '/communities/follows', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = FollowCommunityInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const province = normalizeProvinceCode(parse.data.provinceCode)
    if (!province) return reply.code(400).send({ error: 'invalid_province' })

    const community = findCommunity(province, parse.data.communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    const setAsHome = parse.data.setAsHome === true
    const follow = await prisma.$transaction(async (tx: any) => {
      if (setAsHome) {
        await tx.communityFollow.updateMany({ where: { userId, home: true }, data: { home: false } })
      }

      return tx.communityFollow.upsert({
        where: {
          userId_provinceCode_communitySlug: {
            userId,
            provinceCode: province,
            communitySlug: community.slug,
          },
        },
        create: {
          userId,
          provinceCode: province,
          communitySlug: community.slug,
          home: setAsHome,
        },
        update: {
          provinceCode: province,
          communitySlug: community.slug,
          ...(setAsHome ? { home: true } : {}),
        },
      })
    })

    return reply.send({
      ok: true,
      follow: {
        province: follow.provinceCode,
        communitySlug: follow.communitySlug,
        home: follow.home,
        community,
      },
    })
  })

  deps.registerCommunityRoute('delete', '/communities/follows', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = UnfollowCommunityInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const province = normalizeProvinceCode(parse.data.provinceCode)
    if (!province) return reply.code(400).send({ error: 'invalid_province' })

    const existing = await prisma.communityFollow.findUnique({
      where: {
        userId_provinceCode_communitySlug: {
          userId,
          provinceCode: province,
          communitySlug: parse.data.communitySlug,
        },
      },
    })
    if (!existing) return reply.code(404).send({ error: 'not_following' })

    await prisma.communityFollow.delete({
      where: {
        userId_provinceCode_communitySlug: {
          userId,
          provinceCode: province,
          communitySlug: parse.data.communitySlug,
        },
      },
    })

    return reply.send({ ok: true })
  })

  deps.registerCommunityRoute('post', '/communities/geolocate', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = CommunityGeolocateInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    try {
      const { lat, lng, limit, bboxPaddingDegrees } = parse.data
      const { primary, alternatives, meta } = await locateCommunityFromPoint(lat, lng, {
        limit: limit ?? undefined,
        paddingDegrees: bboxPaddingDegrees ?? undefined,
      })
      const enriched = await enrichMatchesWithCities([primary, ...alternatives], lat, lng)
      const [enrichedPrimary, ...enrichedAlternatives] = enriched
      return reply.send({
        primary: enrichedPrimary ?? null,
        alternatives: enrichedAlternatives.filter(Boolean),
        meta,
      })
    } catch (error) {
      req.log.error({ err: error }, 'community_geolocate_failed')
      return reply.code(500).send({ error: 'geolocation_failed' })
    }
  })

  app.post('/postal/geolocate', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = PostalGeolocateInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    try {
      const { lat, lng, limit, bboxPaddingDegrees } = parse.data
      const fsaResult = await locateFsaFromPoint(lat, lng, {
        paddingDegrees: bboxPaddingDegrees ?? undefined,
      })
      if (!fsaResult.match) return reply.code(404).send({ error: 'fsa_not_found' })

      const communityMatches = await locateCommunityFromPoint(lat, lng, {
        limit: limit ?? undefined,
        paddingDegrees: bboxPaddingDegrees ?? undefined,
      })
      const enriched = await enrichMatchesWithCities([communityMatches.primary, ...communityMatches.alternatives], lat, lng)
      const [primary, ...alternativeMatches] = enriched

      return reply.send({
        postalCode: fsaResult.match.code,
        fsa: {
          code: fsaResult.match.code,
          provinceCode: fsaResult.match.provinceCode ?? null,
          subdivisionId: fsaResult.match.subdivisionId ?? null,
          subdivisionName: fsaResult.match.subdivisionName ?? null,
          centroidLat: fsaResult.match.centroidLat ?? null,
          centroidLng: fsaResult.match.centroidLng ?? null,
          defaultCommunitySlug: fsaResult.match.defaultCommunitySlug ?? null,
          defaultCommunityName: fsaResult.match.defaultCommunityName ?? null,
        },
        primary: primary ?? null,
        alternatives: alternativeMatches.filter(Boolean),
      })
    } catch (error) {
      req.log.error({ err: error }, 'postal_geolocate_failed')
      return reply.code(500).send({ error: 'postal_geolocate_failed' })
    }
  })

  deps.registerCommunityRoute('post', '/communities/postal-lookup', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = PostalLookupInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const normalized = normalizePostalCodeInput(parse.data.postalCode)
    if (!normalized) return reply.code(400).send({ error: 'invalid_postal_code' })

    try {
      const fsaRecord = await prisma.forwardSortationArea.findUnique({
        where: { code: normalized.fsa },
        select: {
          code: true,
          provinceCode: true,
          subdivisionId: true,
          subdivisionName: true,
          centroidLat: true,
          centroidLng: true,
          defaultCommunitySlug: true,
          defaultCommunityName: true,
        },
      })
      if (!fsaRecord) return reply.code(404).send({ error: 'fsa_not_found' })

      let coords = statsCanPointToWgs84(fsaRecord.centroidLat, fsaRecord.centroidLng)
      if (!coords) {
        const fallbackCity = await (fsaRecord.subdivisionId || fsaRecord.provinceCode
          ? prisma.city.findFirst({
              where: fsaRecord.subdivisionId
                ? { censusSubdivisionId: fsaRecord.subdivisionId }
                : { provinceCode: fsaRecord.provinceCode ?? undefined },
              orderBy: { population: 'desc' },
            })
          : null)
        if (fallbackCity) {
          coords = { lat: fallbackCity.latitude, lng: fallbackCity.longitude }
        }
      }

      let enrichedPrimary: any = null
      let enrichedAlternatives: any[] = []
      if (coords) {
        const locateResult = await locateCommunityFromPoint(coords.lat, coords.lng, {
          limit: parse.data.limit ?? undefined,
        })
        const enriched = await enrichMatchesWithCities([locateResult.primary, ...locateResult.alternatives], coords.lat, coords.lng)
        const [primaryMatch, ...alternativeMatches] = enriched
        enrichedPrimary = primaryMatch ?? null
        enrichedAlternatives = alternativeMatches.filter(Boolean)
      }

      return reply.send({
        postalCode: normalized.postal,
        fsa: {
          code: fsaRecord.code,
          provinceCode: fsaRecord.provinceCode ?? null,
          subdivisionId: fsaRecord.subdivisionId ?? null,
          subdivisionName: fsaRecord.subdivisionName ?? null,
          centroidLat: coords?.lat ?? null,
          centroidLng: coords?.lng ?? null,
          defaultCommunitySlug: fsaRecord.defaultCommunitySlug ?? null,
          defaultCommunityName: fsaRecord.defaultCommunityName ?? null,
        },
        primary: enrichedPrimary,
        alternatives: enrichedAlternatives,
      })
    } catch (error) {
      req.log.error({ err: error }, 'postal_lookup_failed')
      return reply.code(500).send({ error: 'postal_lookup_failed' })
    }
  })
}