import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { ConnectionStatus, FriendshipStatus, Prisma } from '@prisma/client'
import {
  CursorQuery,
  HandleParam,
  JurisdictionEnum,
  PostSortEnum,
  findCommunity,
  getProvinceDisplayName,
  normalizeProvinceCode,
  slugifyCommunityName,
} from '@civil/shared'
import { z } from 'zod'
import { readWalletSummary, walletHasConnectPayoutsEnabled } from '../walletHelpers.js'

type UserProfilePostDeps = Record<string, any>

export function registerUserProfilePostRoutes(app: FastifyInstance, deps: UserProfilePostDeps) {
  app.get('/users/:handle/posts', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      try {
        const authContext = await deps.loadViewerAuthContext(req)
        const params = HandleParam.safeParse(req.params)
        if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

        const handle = params.data.handle.replace(/^@/, '').toLowerCase()

        const userRecord = await prisma.user.findUnique({
          where: { handle },
          select: {
            id: true,
            handle: true,
            name: true,
            bio: true,
            avatarUrl: true,
            coverUrl: true,
            avatarPostId: true,
            coverPostId: true,
            createdAt: true,
            premiumStatus: true,
            communityMeta: true,
          },
        })

        if (!userRecord) {
          const familyMember = await deps.findFamilyMemberByUsername(handle)
          if (!familyMember) {
            req.log.info(
              {
                handle,
                authActor: authContext?.actor ?? null,
                viewerUserId: authContext?.actor === 'user' ? authContext.userId : null,
                viewerMemberId: authContext?.actor === 'family_member' ? authContext.member.id : null,
              },
              'family_profile_not_found_by_handle',
            )
            return reply.code(404).send({ error: 'user_not_found' })
          }

          const access = await deps.resolveFamilyProfileAccess(authContext, familyMember)
          if (!access) {
            req.log.info(
              {
                handle,
                authActor: authContext?.actor ?? null,
                viewerUserId: authContext?.actor === 'user' ? authContext.userId : null,
                viewerMemberId: authContext?.actor === 'family_member' ? authContext.member.id : null,
                targetMemberId: familyMember.id,
                targetParentId: familyMember.parentId,
                targetParentHandle: familyMember.parent.handle,
              },
              'family_profile_access_denied',
            )
            return reply.code(404).send({ error: 'user_not_found' })
          }

          req.log.info(
            {
              handle,
              authActor: authContext?.actor ?? null,
              viewerUserId: authContext?.actor === 'user' ? authContext.userId : null,
              viewerMemberId: authContext?.actor === 'family_member' ? authContext.member.id : null,
              targetMemberId: familyMember.id,
              targetParentId: familyMember.parentId,
              access,
            },
            'family_profile_access_granted',
          )

          const normalizedMember = deps.normalizeFamilyMemberSummary(familyMember)
          const friendCount = deps
            .getStoredFamilyFriendships(familyMember.parent.communityMeta)
            .filter((entry: { memberId: string }) => entry.memberId === familyMember.id).length
          const postCount = await prisma.post.count({
            where: {
              authorId: familyMember.parentId,
              type: deps.FAMILY_FEED_POST_TYPE,
              title: deps.buildFamilyFeedPostTitle(familyMember.id),
            },
          })

          return reply.send({
            user: {
              id: normalizedMember.id,
              handle: normalizedMember.username,
              name: normalizedMember.displayName,
              bio: null,
              avatarUrl: normalizedMember.avatarUrl,
              coverUrl: normalizedMember.coverUrl,
              avatarPostId: null,
              coverPostId: null,
              createdAt: normalizedMember.createdAt,
              dateOfBirth: null,
              countryOfBirth: null,
              experiences: [],
              isPremium: false,
              isVerified: false,
              postCount,
              friendCount,
              followerCount: 0,
              followingCount: 0,
              communityCount: 0,
              organizationCount: 0,
              connectionCount: 0,
              wallet: null,
              accountType: 'family_member' as const,
              familyProfile: {
                memberId: normalizedMember.id,
                relationshipLabel: normalizedMember.relationshipLabel,
                modeBand: normalizedMember.modeBand,
                modeLabel: normalizedMember.modeLabel,
                access,
                allowChildAudioCalls: normalizedMember.allowChildAudioCalls,
                allowChildVideoCalls: normalizedMember.allowChildVideoCalls,
              },
            },
            items: [],
            nextCursor: undefined,
            relationship: deps.buildFamilyProfileRelationshipPayload(authContext, access),
          })
        }

        let followersCount = 0
        let followingCount = 0
        let friendsCount = 0
        let communitiesCount = 0
        let organizationsCount = 0
        let connectionsCount = 0
        let homeChamber: {
          provinceCode: string
          provinceName: string
          chamberSlug: string
          chamberName: string
        } | null = null
        try {
          const [friends, communities, organizations, connections, homeFollow] = await Promise.all([
            prisma.friendship.count({
              where: {
                status: FriendshipStatus.ACCEPTED,
                OR: [{ requesterId: userRecord.id }, { addresseeId: userRecord.id }],
              },
            }),
            prisma.communityFollow.count({ where: { userId: userRecord.id } }),
            prisma.business.count({
              where: {
                OR: [
                  { ownerId: userRecord.id },
                  { memberships: { some: { userId: userRecord.id } } },
                  { follows: { some: { userId: userRecord.id } } },
                ],
              },
            }),
            prisma.connection.count({
              where: {
                status: ConnectionStatus.ACCEPTED,
                OR: [{ requesterId: userRecord.id }, { addresseeId: userRecord.id }],
              },
            }),
            prisma.communityFollow.findFirst({ where: { userId: userRecord.id, home: true } }),
          ])
          friendsCount = friends
          communitiesCount = communities
          organizationsCount = organizations
          connectionsCount = connections
          if (homeFollow) {
            const community = findCommunity(homeFollow.provinceCode, homeFollow.communitySlug)
            homeChamber = {
              provinceCode: homeFollow.provinceCode,
              provinceName: getProvinceDisplayName(homeFollow.provinceCode as any),
              chamberSlug: homeFollow.communitySlug,
              chamberName: community?.name ?? homeFollow.communitySlug,
            }
          }
        } catch (error) {
          // Ignore
        }

        followersCount = 0
        followingCount = 0

        let experiences: any[] = []

        try {
          experiences = await prisma.experience.findMany({
            where: { userId: userRecord.id },
            orderBy: [{ position: 'asc' }, { startDate: 'desc' }],
          })
        } catch (error) {
          if (!deps.isExperienceTableMissing(error)) {
            throw error
          }
        }

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
              OR: normalizedExperienceOrganizationNames.map((name: string) => ({
                name: {
                  equals: name,
                  mode: 'insensitive',
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

        const mappedExperiences = experiences.map((exp: (typeof experiences)[number]) => ({
          organizationProfile: organizationByName.get(exp.organization.trim().toLowerCase()) ?? null,
          id: exp.id,
          title: exp.title,
          organization: exp.organization,
          location: exp.location,
          startDate: exp.startDate.toISOString(),
          endDate: exp.endDate ? exp.endDate.toISOString() : null,
          current: exp.current,
          description: exp.description,
        }))

        const normalizedProfile = deps.normalizeUserMedia({
          ...userRecord,
          experiences: mappedExperiences,
        }) as typeof userRecord & { experiences: typeof mappedExperiences }
        const profileMeta = deps.parseCommunityMeta(userRecord.communityMeta ?? null)

        const { premiumStatus, communityMeta, ...restProfile } = normalizedProfile
        const user = {
          ...restProfile,
          isPremium: deps.isPremium(premiumStatus),
          isVerified: deps.isSelfVerifiedCanadianCitizen(profileMeta),
          dateOfBirth: null as string | null,
          birthYear: null as number | null,
          countryOfBirth:
            profileMeta?.countryOfBirth && profileMeta.shareCountryOfBirth !== false ? profileMeta.countryOfBirth : null,
          friendCount: friendsCount,
          followerCount: followersCount,
          followingCount,
          communityCount: communitiesCount,
          organizationCount: organizationsCount,
          connectionCount: connectionsCount,
          homeChamber,
          homeShippingAddress: null as Record<string, unknown> | null,
          wallet: null as { label: string; eTransferEmail: string } | null,
        }

        const query = CursorQuery.extend({
          jurisdiction: JurisdictionEnum.optional(),
          sort: PostSortEnum.optional(),
          province: z.string().optional(),
          community: z.string().optional(),
          municipality: z.string().optional(),
        }).safeParse(req.query)
        if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

        const {
          cursor,
          limit,
          jurisdiction,
          sort,
          province: provinceParam,
          community: communityParam,
          municipality,
        } = query.data
        const viewerId = authContext
          ? authContext.actor === 'family_member'
            ? authContext.member.parentId
            : authContext.userId
          : undefined
        const viewerBlockState = await deps.loadViewerBlockState(viewerId)
        let relationship = {
          friendshipStatus: 'none' as 'self' | 'friends' | 'incoming' | 'outgoing' | 'none',
          friendshipId: null as string | null,
          friendshipSince: null as Date | null,
          connectionStatus: 'none' as 'self' | 'connected' | 'incoming' | 'outgoing' | 'none',
          connectionId: null as string | null,
          connectionSince: null as Date | null,
        }

        if (viewerId) {
          if (viewerId === user.id) {
            relationship.friendshipStatus = 'self'
            relationship.connectionStatus = 'self'
          } else {
            try {
              const [friendship, connection] = await Promise.all([
                prisma.friendship.findFirst({
                  where: {
                    OR: [
                      { requesterId: viewerId, addresseeId: user.id },
                      { requesterId: user.id, addresseeId: viewerId },
                    ],
                  },
                }),
                deps.findConnectionBetween(viewerId, user.id),
              ])

              let friendshipStatus: 'none' | 'friends' | 'incoming' | 'outgoing' = 'none'
              let friendshipId: string | null = null
              let friendshipSince: Date | null = null
              let connectionStatus: 'none' | 'connected' | 'incoming' | 'outgoing' = 'none'
              let connectionId: string | null = null
              let connectionSince: Date | null = null

              if (friendship) {
                friendshipId = friendship.id
                if (friendship.status === FriendshipStatus.ACCEPTED) {
                  friendshipStatus = 'friends'
                  friendshipSince = friendship.respondedAt ?? friendship.requestedAt
                } else if (friendship.status === FriendshipStatus.PENDING) {
                  if (friendship.requesterId === viewerId) {
                    friendshipStatus = 'outgoing'
                  } else {
                    friendshipStatus = 'incoming'
                  }
                }
              }

              if (connection) {
                connectionId = connection.id
                if (connection.status === 'ACCEPTED') {
                  connectionStatus = 'connected'
                  connectionSince = connection.respondedAt ?? connection.requestedAt
                } else if (connection.status === 'PENDING') {
                  if (connection.requesterId === viewerId) {
                    connectionStatus = 'outgoing'
                  } else {
                    connectionStatus = 'incoming'
                  }
                }
              }

              relationship = {
                friendshipStatus,
                friendshipId,
                friendshipSince,
                connectionStatus,
                connectionId,
                connectionSince,
              }
            } catch (error) {
              // Ignore
            }
          }
        }

        if (profileMeta?.dateOfBirth && profileMeta.shareDateOfBirth !== false) {
          if (relationship.friendshipStatus === 'self' || relationship.friendshipStatus === 'friends') {
            user.dateOfBirth = profileMeta.dateOfBirth
          } else {
            const birthYear = Number.parseInt(profileMeta.dateOfBirth.slice(0, 4), 10)
            if (Number.isFinite(birthYear)) {
              user.birthYear = birthYear
            }
          }
        }

        let profileFamilyRelationship: {
          familyType: string
          relationshipLabel: string
        } | null = null

        if (viewerId && viewerId !== user.id) {
          try {
            const viewerUser = await prisma.user.findUnique({
              where: { id: viewerId },
              select: { communityMeta: true },
            })
            const storedRelationship = deps
              .getStoredProfileFamilyRelationships(viewerUser?.communityMeta)
              .find((entry: { relatedUserId: string }) => entry.relatedUserId === user.id)

            if (storedRelationship) {
              profileFamilyRelationship = {
                familyType: storedRelationship.familyType,
                relationshipLabel: deps.profileFamilyRelationshipLabels[storedRelationship.familyType] ?? storedRelationship.familyType,
              }
            }
          } catch (error) {
            // Ignore
          }
        }

        if (viewerId && viewerId !== user.id && (relationship.friendshipStatus === 'friends' || Boolean(profileFamilyRelationship))) {
          try {
            const savedAddresses = deps.readMarketShippingAddresses(userRecord.communityMeta)
            user.homeShippingAddress = savedAddresses.find((entry: { isDefault?: boolean }) => Boolean(entry?.isDefault)) ?? savedAddresses[0] ?? null
          } catch (error) {
            // Ignore
          }
        }

        if (viewerId && viewerId !== user.id) {
          const walletEmail = profileMeta?.wallet?.eTransferEmail?.trim()?.toLowerCase() ?? null
          const walletEnabled = profileMeta?.wallet?.enabled == null ? Boolean(walletEmail) : Boolean(profileMeta?.wallet?.enabled)
          const canShareWithFamily = Boolean(profileFamilyRelationship) && Boolean(profileMeta?.wallet?.sharing?.family)
          const canShareWithFriends = relationship.friendshipStatus === 'friends' && Boolean(profileMeta?.wallet?.sharing?.friends)
          if (walletEnabled && walletEmail && (canShareWithFamily || canShareWithFriends)) {
            const walletSummary = readWalletSummary(profileMeta)
            user.wallet = {
              label: 'Civil Wallet',
              eTransferEmail: walletEmail,
              supportsCivilCredits: walletHasConnectPayoutsEnabled(walletSummary),
            }
          }
        }

        const sortMode = sort ?? 'new'

        const where: Prisma.PostWhereInput = {
          authorId: user.id,
          type: { not: deps.FAMILY_FEED_POST_TYPE },
          ...(jurisdiction ? { jurisdiction } : {}),
        }
        deps.applyVisibleModerationFiltersToPostWhere(where, viewerBlockState)

        if (relationship.friendshipStatus !== 'self') {
          const allowedAudiences: string[] = []
          if (relationship.friendshipStatus === 'friends') {
            allowedAudiences.push('friends')
          }
          if (viewerId && viewerId !== user.id && (await deps.canViewerAccessFamilyAudiencePost({ viewerId, authorId: user.id }))) {
            allowedAudiences.push('family')
          }
          if (relationship.connectionStatus === 'connected') {
            allowedAudiences.push('network')
          }

          const audienceGate: Prisma.PostWhereInput = allowedAudiences.length
            ? {
                OR: [
                  { communitySlug: { not: null } },
                  {
                    audience: 'organization',
                    businessId: { not: null },
                  },
                  ({ audience: { in: allowedAudiences } } as any),
                ],
              }
            : {
                OR: [
                  { communitySlug: { not: null } },
                  {
                    audience: 'organization',
                    businessId: { not: null },
                  },
                ],
              }

          const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []
          where.AND = [...existingAnd, audienceGate]
        }

        if (!viewerId) {
          where.visibility = 'public'
        } else {
          const [ownedBusinesses, memberships] = await Promise.all([
            prisma.business.findMany({ where: { ownerId: viewerId }, select: { id: true } }) as Promise<Array<{ id: string }>>,
            prisma.businessMembership.findMany({ where: { userId: viewerId }, select: { businessId: true } }) as Promise<
              Array<{ businessId: string }>
            >,
          ])
          const memberBusinessIds = Array.from(
            new Set([...ownedBusinesses.map((row: { id: string }) => row.id), ...memberships.map((row: { businessId: string }) => row.businessId)]),
          )
          const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []
          where.AND = [
            ...existingAnd,
            {
              OR: [
                { visibility: 'public' },
                {
                  visibility: 'members',
                  businessId: { in: memberBusinessIds },
                },
              ],
            },
          ]
        }

        const province = provinceParam ? normalizeProvinceCode(provinceParam) : null
        if (provinceParam && !province) {
          return reply.code(404).send({ error: 'province_not_found' })
        }
        if (province) {
          where.provinceCode = province
        }

        const municipalitySlug = municipality?.trim().toLowerCase() || null
        if (municipalitySlug && !province) {
          return reply.code(400).send({ error: 'province_required_for_municipality' })
        }

        let communitySlugFilter = communityParam ? slugifyCommunityName(communityParam) : null

        if (!communitySlugFilter && municipalitySlug && province) {
          const cityMatch = await prisma.city.findFirst({
            where: { provinceCode: province, slug: municipalitySlug },
            select: { communitySlug: true },
          })
          if (cityMatch?.communitySlug) {
            communitySlugFilter = cityMatch.communitySlug
          } else {
            const subdivisionMatch = await prisma.censusSubdivision.findFirst({
              where: { provinceCode: province, slug: municipalitySlug },
              select: { defaultCommunitySlug: true },
            })
            if (subdivisionMatch?.defaultCommunitySlug) {
              communitySlugFilter = subdivisionMatch.defaultCommunitySlug
            }
          }
        }

        if (communitySlugFilter) {
          where.communitySlug = communitySlugFilter
        }

        let posts: any[] = []
        let nextCursor: string | undefined

        if (sortMode === 'hot') {
          posts = await prisma.post.findMany({
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
          posts = queryResult
        }

        const { reactionsByPost, pollSelectionsByPost, recentCommentsByPost } = await deps.loadViewerPostFormattingContext(
          viewerId,
          posts.map((post: (typeof posts)[number]) => post.id),
          5,
        )

        return {
          user,
          relationship: {
            ...relationship,
            profileFamilyRelationship,
          },
          items: posts.map((post: (typeof posts)[number]) =>
            deps.formatPost(post, {
              viewerId,
              viewerReaction: reactionsByPost[post.id] ?? null,
              viewerPollOptionId: pollSelectionsByPost[post.id] ?? null,
              recentComments: recentCommentsByPost[post.id] ?? [],
            }),
          ),
          nextCursor,
        }
      } catch (e: any) {
        req.log.error(e)
        return reply.code(500).send({ error: e.message, stack: e.stack })
      }
    }),
  )
}