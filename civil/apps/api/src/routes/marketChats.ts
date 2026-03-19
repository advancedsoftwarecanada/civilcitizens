import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { MessageParticipantRole, MessageThreadType, MessageType, Prisma } from '@prisma/client'

type MarketChatDeps = Record<string, any>

export function registerMarketChatRoutes(app: FastifyInstance, deps: MarketChatDeps) {
  app.post('/market/chats/listings/:listingId/thread', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketListingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await deps.ensureCitizenMarketplaceTables()

      const viewerBlockState = await deps.loadViewerBlockState(userId)
      const listingRows = await prisma.$queryRaw<Array<{ id: string; title: string; status: string; is_draft: boolean; is_active: boolean; seller_user_id: string; moderation_status: string }>>`
        SELECT id, title, status, is_draft, is_active, seller_user_id, moderation_status
        FROM citizen_market_listing
        WHERE id = ${params.data.listingId}
        LIMIT 1
      `

      const listing = listingRows[0]
      if (!listing || !listing.is_active || listing.is_draft || !deps.isVisibleModerationStatus(listing.moderation_status) || String(listing.status || '').toLowerCase() !== 'active') {
        return reply.code(404).send({ error: 'listing_not_found' })
      }
      if (viewerBlockState.blockedUserIds.has(listing.seller_user_id)) {
        return reply.code(404).send({ error: 'listing_not_found' })
      }
      if (listing.seller_user_id === userId) {
        return reply.code(400).send({ error: 'cannot_message_self' })
      }

      const uniqueKey = deps.buildMarketListingDirectThreadKey(listing.id, listing.seller_user_id, userId)
      let thread = await prisma.messageThread.findUnique({ where: { uniqueKey }, include: deps.THREAD_SUMMARY_INCLUDE })
      if (!thread) {
        const now = new Date()
        thread = await prisma.messageThread.create({
          data: {
            type: MessageThreadType.direct,
            uniqueKey,
            contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
            contextId: listing.id,
            lastMessageAt: now,
            participants: {
              create: [
                { userId, role: MessageParticipantRole.member, lastReadAt: now, lastActivityAt: now },
                { userId: listing.seller_user_id, role: MessageParticipantRole.member, lastActivityAt: now },
              ],
            },
          },
          include: deps.THREAD_SUMMARY_INCLUDE,
        })

        await Promise.all(
          thread.participants
            .filter((participant: any) => participant.userId !== userId)
            .map((participant: any) =>
              deps.dispatchRealtimeEvent(participant.userId, {
                type: 'thread.created',
                data: { thread: deps.formatThreadSummaryRecord(thread, participant.userId) },
              }),
            ),
        )
      }

      return reply.send({
        thread: deps.formatThreadSummaryRecord(thread, userId),
        listing: { id: listing.id, title: listing.title, status: listing.status },
      })
    }),
  )

  app.get('/market/chats', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      await deps.ensureCitizenMarketplaceTables()

      const threads = await prisma.messageThread.findMany({
        where: {
          contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
          participants: { some: { userId } },
        },
        include: deps.THREAD_SUMMARY_INCLUDE,
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        take: 200,
      })

      const threadIds = threads.map((thread: any) => thread.id)
      const notInterestedByThreadId = new Set<string>()
      const unreadCountByThreadId = new Map<string, number>()
      if (threadIds.length) {
        const interestRows = await prisma.$queryRaw<Array<{ thread_id: string; interested: boolean }>>`
          SELECT thread_id, interested
          FROM citizen_market_chat_interest
          WHERE user_id = ${userId}
          AND thread_id IN (${Prisma.join(threadIds)})
        `

        for (const row of interestRows) {
          if (row && row.thread_id && row.interested === false) {
            notInterestedByThreadId.add(String(row.thread_id))
          }
        }

        const unreadRows = await prisma.$queryRaw<Array<{ threadId: string; count: number }>>`
          SELECT m."threadId" as "threadId", COUNT(*)::int as count
          FROM "Message" m
          JOIN "MessageParticipant" mp ON mp."threadId" = m."threadId"
          WHERE mp."userId" = ${userId}
            AND m."threadId" IN (${Prisma.join(threadIds)})
            AND m."senderId" <> ${userId}
            AND m."deletedAt" IS NULL
            AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
          GROUP BY m."threadId"
        `

        for (const row of unreadRows) {
          unreadCountByThreadId.set(String(row.threadId), Number(row.count) || 0)
        }
      }

      const listingIds = Array.from(new Set(threads.map((thread: any) => (thread.contextId ? thread.contextId.trim() : '')).filter(Boolean)))

      const listingRows = listingIds.length
        ? await prisma.$queryRaw<Array<{
            id: string
            title: string
            status: string
            price_cents: number
            currency: string
            photo_urls: unknown
            pickup_city: string | null
            pickup_province: string | null
            seller_user_id: string
            seller_handle: string | null
            seller_name: string | null
            seller_avatar_url: string | null
            seller_cover_url: string | null
          }>>`
            SELECT
              l.id,
              l.title,
              l.status,
              l.price_cents,
              l.currency,
              l.photo_urls,
              l.pickup_city,
              l.pickup_province,
              l.seller_user_id,
              u.handle AS seller_handle,
              u.name AS seller_name,
              u."avatarUrl" AS seller_avatar_url,
              u."coverUrl" AS seller_cover_url
            FROM citizen_market_listing l
            INNER JOIN "User" u ON u.id = l.seller_user_id
            WHERE l.id IN (${Prisma.join(listingIds)})
          `
        : []

      const listingById = new Map<string, any>(listingRows.map((row: any) => [row.id, row]))
      const soldStatuses = new Set(['sold', 'canceled'])
      const yourListingChats: Array<Record<string, unknown>> = []
      const yourListingsById = new Map<string, { listing: Record<string, unknown>; unrespondedThreads: Array<Record<string, unknown>>; totalThreads: number }>()
      const activeItems: Array<Record<string, unknown>> = []
      const soldItems: Array<Record<string, unknown>> = []
      const inactiveItems: Array<Record<string, unknown>> = []

      for (const thread of threads) {
        const listingId = thread.contextId?.trim()
        if (!listingId) continue
        const listing = listingById.get(listingId)
        if (!listing) continue

        const counterpart = thread.participants.find((participant: any) => participant.userId !== userId)
        const item = {
          threadId: thread.id,
          unreadCount: unreadCountByThreadId.get(thread.id) ?? 0,
          listingId,
          listingTitle: listing.title,
          listingStatus: listing.status,
          listingPriceCents: Number(listing.price_cents) || 0,
          listingCurrency: listing.currency,
          listingPhotoUrl: deps.readGalleryUrls(listing.photo_urls)[0] ?? null,
          listingPickupCity: listing.pickup_city,
          listingPickupProvince: listing.pickup_province,
          seller: {
            id: listing.seller_user_id,
            handle: listing.seller_handle,
            name: listing.seller_name,
            avatarUrl: listing.seller_avatar_url,
            coverUrl: listing.seller_cover_url,
          },
          lastMessageAt: (thread.lastMessageAt ?? thread.updatedAt).toISOString(),
          lastMessage: thread.messages[0] ? deps.formatMessage(thread.messages[0], userId) : null,
          counterpart: counterpart
            ? {
                id: counterpart.user.id,
                handle: counterpart.user.handle,
                name: counterpart.user.name,
                avatarUrl: deps.normalizeMediaUrl(counterpart.user.avatarUrl ?? null),
                coverUrl: deps.normalizeMediaUrl((counterpart.user as { coverUrl?: string | null }).coverUrl ?? null),
              }
            : null,
        }

        if (listing.seller_user_id === userId) {
          yourListingChats.push(item)
          let group = yourListingsById.get(listingId)
          if (!group) {
            group = {
              listing: {
                id: listingId,
                title: listing.title,
                status: listing.status,
                priceCents: Number(listing.price_cents) || 0,
                currency: listing.currency,
                photoUrl: deps.readGalleryUrls(listing.photo_urls)[0] ?? null,
                pickupCity: listing.pickup_city,
                pickupProvince: listing.pickup_province,
              },
              unrespondedThreads: [],
              totalThreads: 0,
            }
            yourListingsById.set(listingId, group)
          }
          group.totalThreads += 1

          const lastMessageRecord = thread.messages[0]
          const isUnresponded = Boolean(lastMessageRecord && lastMessageRecord.senderId !== userId)
          if (isUnresponded && group.unrespondedThreads.length < 5) {
            group.unrespondedThreads.push({
              threadId: thread.id,
              counterpart: item.counterpart,
              lastMessageAt: item.lastMessageAt,
              lastMessage: item.lastMessage,
            })
          }
          continue
        }

        if (notInterestedByThreadId.has(thread.id)) {
          inactiveItems.push(item)
          continue
        }

        if (soldStatuses.has(String(listing.status || '').toLowerCase())) soldItems.push(item)
        else activeItems.push(item)
      }

      return reply.send({
        yourListings: Array.from(yourListingsById.values()),
        yourListingChats,
        activeItems,
        inactiveItems,
        soldItems,
      })
    }),
  )

  app.get('/market/pickups', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      await deps.ensureCitizenMarketplaceTables()

      const rows = await prisma.$queryRaw<Array<{
        id: string
        title: string
        status: string
        price_cents: number
        currency: string
        photo_urls: unknown
        pickup_city: string | null
        pickup_province: string | null
        pickup_address_line1: string | null
        pickup_address_line2: string | null
        pickup_postal_code: string | null
        seller_user_id: string
        selected_buyer_user_id: string | null
        pickup_completed_at: Date | null
      }>>`
        SELECT
          id,
          title,
          status,
          price_cents,
          currency,
          photo_urls,
          pickup_city,
          pickup_province,
          pickup_address_line1,
          pickup_address_line2,
          pickup_postal_code,
          seller_user_id,
          selected_buyer_user_id,
          pickup_completed_at
        FROM citizen_market_listing
        WHERE status = 'pending'
          AND pickup_completed_at IS NULL
          AND (seller_user_id = ${userId} OR selected_buyer_user_id = ${userId})
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 100
      `

      const items = await Promise.all(
        rows.map(async (row: {
          id: string
          title: string
          status: string
          price_cents: number
          currency: string
          photo_urls: unknown
          pickup_city: string | null
          pickup_province: string | null
          pickup_address_line1: string | null
          pickup_address_line2: string | null
          pickup_postal_code: string | null
          seller_user_id: string
          selected_buyer_user_id: string | null
          pickup_completed_at: Date | null
        }) => {
          const selectedThread = row.selected_buyer_user_id
            ? await prisma.messageThread.findFirst({
                where: {
                  contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
                  contextId: row.id,
                  participants: { some: { userId: row.selected_buyer_user_id } },
                },
                select: { id: true },
              })
            : null

          return {
            listingId: row.id,
            threadId: selectedThread?.id ?? null,
            role: row.seller_user_id === userId ? 'seller' : 'buyer',
            title: row.title,
            status: row.status,
            priceCents: Number(row.price_cents) || 0,
            currency: row.currency,
            photoUrl: deps.readGalleryUrls(row.photo_urls)[0] ?? null,
            pickupCity: row.pickup_city,
            pickupProvince: row.pickup_province,
            pickupAddress: {
              name: row.title,
              line1: row.pickup_address_line1,
              line2: row.pickup_address_line2,
              city: row.pickup_city,
              province: row.pickup_province,
              postalCode: row.pickup_postal_code,
              country: 'CA',
            },
          }
        }),
      )

      return reply.send({ items })
    }),
  )

  app.get('/market/chats/item/:listingId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketListingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await deps.ensureCitizenMarketplaceTables()

      const listingRows = await prisma.$queryRaw<Array<{ id: string; title: string; status: string; price_cents: number; currency: string; photo_urls: unknown; pickup_city: string | null; pickup_province: string | null; seller_user_id: string; selected_buyer_user_id: string | null }>>`
        SELECT id, title, status, price_cents, currency, photo_urls, pickup_city, pickup_province, seller_user_id, selected_buyer_user_id
        FROM citizen_market_listing
        WHERE id = ${params.data.listingId}
        LIMIT 1
      `

      const listing = listingRows[0]
      if (!listing) return reply.code(404).send({ error: 'listing_not_found' })
      if (listing.seller_user_id !== userId) return reply.code(404).send({ error: 'listing_not_found' })

      const threads = await prisma.messageThread.findMany({
        where: {
          contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
          contextId: listing.id,
          participants: { some: { userId } },
        },
        include: deps.THREAD_SUMMARY_INCLUDE,
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        take: 200,
      })

      const formattedThreads = threads.map((thread: any) => {
        const counterpart = thread.participants.find((participant: any) => participant.userId !== userId)
        return {
          threadId: thread.id,
          lastMessageAt: (thread.lastMessageAt ?? thread.updatedAt).toISOString(),
          lastMessage: thread.messages[0] ? deps.formatMessage(thread.messages[0], userId) : null,
          counterpart: counterpart
            ? {
                id: counterpart.user.id,
                handle: counterpart.user.handle,
                name: counterpart.user.name,
                avatarUrl: deps.normalizeMediaUrl(counterpart.user.avatarUrl ?? null),
                coverUrl: deps.normalizeMediaUrl((counterpart.user as { coverUrl?: string | null }).coverUrl ?? null),
              }
            : null,
        }
      })

      const selectedBuyerUserId = listing.selected_buyer_user_id
      const selectedThreadId = selectedBuyerUserId
        ? threads.find((thread: any) => thread.participants.some((p: any) => p.userId === selectedBuyerUserId))?.id ?? null
        : null

      return reply.send({
        listing: {
          id: listing.id,
          title: listing.title,
          status: listing.status,
          priceCents: Number(listing.price_cents) || 0,
          currency: listing.currency,
          photoUrl: deps.readGalleryUrls(listing.photo_urls)[0] ?? null,
          pickupCity: listing.pickup_city,
          pickupProvince: listing.pickup_province,
        },
        threads: formattedThreads,
        selectedBuyerUserId,
        selectedThreadId,
      })
    }),
  )

  app.get('/market/chats/:threadId/context', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketChatThreadParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      await deps.ensureCitizenMarketplaceTables()

      const thread = await prisma.messageThread.findFirst({
        where: {
          id: params.data.threadId,
          contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
          participants: { some: { userId } },
        },
        select: { id: true, contextId: true },
      })
      if (!thread?.contextId) return reply.code(404).send({ error: 'market_chat_not_found' })

      const listingRows = await prisma.$queryRaw<Array<{
        id: string
        title: string
        status: string
        price_cents: number
        currency: string
        photo_urls: unknown
        pickup_city: string | null
        pickup_province: string | null
        pickup_address_line1: string | null
        pickup_address_line2: string | null
        pickup_postal_code: string | null
        seller_user_id: string
        selected_buyer_user_id: string | null
        pickup_completed_at: Date | null
        buyer_picked_up_at: Date | null
        seller_picked_up_at: Date | null
      }>>`
        SELECT id, title, status, price_cents, currency, photo_urls, pickup_city, pickup_province, pickup_address_line1, pickup_address_line2, pickup_postal_code, seller_user_id, selected_buyer_user_id, pickup_completed_at, buyer_picked_up_at, seller_picked_up_at
        FROM citizen_market_listing
        WHERE id = ${thread.contextId}
        LIMIT 1
      `

      const listing = listingRows[0]
      if (!listing) return reply.code(404).send({ error: 'listing_not_found' })

      const selectedBuyerUserId = listing.selected_buyer_user_id
      const viewerIsSeller = listing.seller_user_id === userId
      const viewerIsSelectedBuyer = Boolean(selectedBuyerUserId && selectedBuyerUserId === userId)
      let selectedThreadId: string | null = null
      if (selectedBuyerUserId) {
        const selectedThread = await prisma.messageThread.findFirst({
          where: {
            contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
            contextId: listing.id,
            participants: { some: { userId: selectedBuyerUserId } },
          },
          select: { id: true },
        })
        selectedThreadId = selectedThread?.id ?? null
      }

      const viewerCanAccessPickupAddress = Boolean((viewerIsSeller || viewerIsSelectedBuyer) && selectedThreadId === thread.id)

      return reply.send({
        listing: {
          id: listing.id,
          title: listing.title,
          status: listing.status,
          priceCents: Number(listing.price_cents) || 0,
          currency: listing.currency,
          photoUrl: deps.readGalleryUrls(listing.photo_urls)[0] ?? null,
          pickupCity: listing.pickup_city,
          pickupProvince: listing.pickup_province,
        },
        viewerIsSeller,
        viewerIsSelectedBuyer,
        viewerCanAccessPickupAddress,
        pickupCompletedAt: listing.pickup_completed_at ? listing.pickup_completed_at.toISOString() : null,
        buyerPickedUpAt: listing.buyer_picked_up_at ? listing.buyer_picked_up_at.toISOString() : null,
        sellerPickedUpAt: listing.seller_picked_up_at ? listing.seller_picked_up_at.toISOString() : null,
        pickupAddress: viewerCanAccessPickupAddress
          ? {
              name: listing.title,
              line1: listing.pickup_address_line1,
              line2: listing.pickup_address_line2,
              city: listing.pickup_city,
              province: listing.pickup_province,
              postalCode: listing.pickup_postal_code,
              country: 'CA',
            }
          : null,
        selectedBuyerUserId,
        selectedThreadId,
      })
    }),
  )

  app.post('/market/chats/:threadId/no-longer-interested', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketChatThreadParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const membership = await prisma.messageParticipant.findFirst({
        where: {
          threadId: params.data.threadId,
          userId,
          thread: { contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE },
        },
        select: { threadId: true },
      })
      if (!membership) return reply.code(404).send({ error: 'market_chat_not_found' })

      await deps.ensureCitizenMarketplaceTables()

      await prisma.$executeRaw`
        INSERT INTO citizen_market_chat_interest (thread_id, user_id, interested, updated_at)
        VALUES (${params.data.threadId}, ${userId}, FALSE, NOW())
        ON CONFLICT (thread_id, user_id)
        DO UPDATE SET interested = FALSE, updated_at = NOW()
      `

      return reply.send({ success: true, interested: false })
    }),
  )

  app.post('/market/chats/item/:listingId/relist', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketListingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const body = deps.MarketRelistBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      await deps.ensureCitizenMarketplaceTables()

      const listingRows = await prisma.$queryRaw<Array<{ id: string; seller_user_id: string; status: string; is_active: boolean; moderation_status: string }>>`
        SELECT id, seller_user_id, status, is_active, moderation_status
        FROM citizen_market_listing
        WHERE id = ${params.data.listingId}
        LIMIT 1
      `
      const listing = listingRows[0]
      if (!listing || !listing.is_active) return reply.code(404).send({ error: 'listing_not_found' })
      if (listing.seller_user_id !== userId) return reply.code(404).send({ error: 'listing_not_found' })
      if (!deps.isVisibleModerationStatus(listing.moderation_status)) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('MARKET_LISTING') })
      }

      await prisma.$executeRaw`
        UPDATE citizen_market_listing
        SET status = 'active',
            selected_buyer_user_id = NULL,
            updated_at = NOW()
        WHERE id = ${listing.id}
          AND seller_user_id = ${userId}
      `

      if (body.data.notify) {
        const threads = await prisma.messageThread.findMany({
          where: {
            contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
            contextId: listing.id,
            participants: { some: { userId } },
          },
          select: { id: true, participants: { select: { userId: true } } },
          orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
          take: 200,
        })

        const bodyText = deps.sanitizePlainText("This item is available again if you're interested.").trim()

        const createdMessages = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const messageRecords: Array<{ threadId: string; record: any; participants: Array<{ userId: string }> }> = []
          for (const thread of threads) {
            const created = await tx.message.create({
              data: {
                threadId: thread.id,
                senderId: userId,
                body: bodyText || null,
                messageType: MessageType.text,
              },
              select: deps.MESSAGE_SELECT,
            })

            await tx.messageThread.update({ where: { id: thread.id }, data: { lastMessageAt: created.createdAt } })
            await tx.messageParticipant.update({
              where: { threadId_userId: { threadId: thread.id, userId } },
              data: { lastReadAt: created.createdAt, lastActivityAt: created.createdAt },
            })
            await tx.messageParticipant.updateMany({
              where: { threadId: thread.id, userId: { not: userId } },
              data: { lastActivityAt: created.createdAt },
            })
            messageRecords.push({ threadId: thread.id, record: created, participants: thread.participants })
          }
          return messageRecords
        })

        await Promise.all(
          createdMessages.flatMap((entry: { threadId: string; record: any; participants: Array<{ userId: string }> }) =>
            entry.participants.map((participant: { userId: string }) =>
              deps.dispatchRealtimeEvent(participant.userId, {
                type: 'message.created',
                data: { threadId: entry.threadId, message: deps.formatMessage(entry.record, participant.userId) },
              }),
            ),
          ),
        )
      }

      return reply.send({ success: true })
    }),
  )

  app.post('/market/chats/item/:listingId/select-buyer', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketListingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const body = deps.MarketSelectBuyerBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      await deps.ensureCitizenMarketplaceTables()

      const listingRows = await prisma.$queryRaw<Array<{ id: string; seller_user_id: string; status: string; selected_buyer_user_id: string | null; is_active: boolean; moderation_status: string }>>`
        SELECT id, seller_user_id, status, selected_buyer_user_id, is_active, moderation_status
        FROM citizen_market_listing
        WHERE id = ${params.data.listingId}
        LIMIT 1
      `

      const listing = listingRows[0]
      if (!listing || !listing.is_active) return reply.code(404).send({ error: 'listing_not_found' })
      if (listing.seller_user_id !== userId) return reply.code(404).send({ error: 'listing_not_found' })
      if (!deps.isVisibleModerationStatus(listing.moderation_status)) {
        return reply.code(423).send({ error: deps.moderationLockedErrorCode('MARKET_LISTING') })
      }
      if (listing.selected_buyer_user_id) return reply.code(400).send({ error: 'buyer_already_selected' })

      const selectedThread = await prisma.messageThread.findFirst({
        where: {
          id: body.data.threadId,
          contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
          contextId: listing.id,
          participants: { some: { userId } },
        },
        select: { id: true, participants: { select: { userId: true, mutedUntil: true } } },
      })
      if (!selectedThread) return reply.code(404).send({ error: 'market_chat_not_found' })

      const buyerId = selectedThread.participants.find((participant: { userId: string }) => participant.userId !== userId)?.userId
      if (!buyerId) return reply.code(400).send({ error: 'buyer_not_found' })

      const threads = await prisma.messageThread.findMany({
        where: {
          contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
          contextId: listing.id,
          participants: { some: { userId } },
        },
        select: { id: true, participants: { select: { userId: true, mutedUntil: true } } },
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        take: 200,
      })

      const now = new Date()
      const notifyOthersBody = deps.sanitizePlainText("I have found a potential buyer, but I'll let you know if that deal falls though").trim()
      const listingAddressRows = await prisma.$queryRaw<Array<{
        pickup_address_line1: string | null
        pickup_address_line2: string | null
        pickup_city: string | null
        pickup_province: string | null
        pickup_postal_code: string | null
      }>>`
        SELECT pickup_address_line1, pickup_address_line2, pickup_city, pickup_province, pickup_postal_code
        FROM citizen_market_listing
        WHERE id = ${listing.id}
        LIMIT 1
      `
      const listingAddress = listingAddressRows[0]
      const pickupAddressInline = [
        listingAddress?.pickup_address_line1,
        listingAddress?.pickup_address_line2,
        [listingAddress?.pickup_city, listingAddress?.pickup_province].filter(Boolean).join(', '),
        listingAddress?.pickup_postal_code,
      ]
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .join(', ')
      const notifySelectedBody = deps
        .sanitizePlainText(
          pickupAddressInline
            ? `I have selected you as the buyer for this item. The pickup address is ${pickupAddressInline}. Please confirm pickup details.`
            : 'I have selected you as the buyer for this item. Please confirm pickup details.',
        )
        .trim()

      const createdMessages = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`
          UPDATE citizen_market_listing
          SET selected_buyer_user_id = ${buyerId},
              status = 'pending',
              is_draft = FALSE,
              updated_at = NOW()
          WHERE id = ${listing.id}
            AND seller_user_id = ${userId}
            AND selected_buyer_user_id IS NULL
        `

        const messageRecords: Array<{ threadId: string; record: any; participants: Array<{ userId: string }> }> = []
        for (const thread of threads) {
          const messageBody = thread.id === selectedThread.id ? notifySelectedBody : notifyOthersBody
          const created = await tx.message.create({
            data: {
              threadId: thread.id,
              senderId: userId,
              body: messageBody || null,
              messageType: MessageType.text,
            },
            select: deps.MESSAGE_SELECT,
          })

          await tx.messageThread.update({ where: { id: thread.id }, data: { lastMessageAt: created.createdAt } })
          await tx.messageParticipant.update({
            where: { threadId_userId: { threadId: thread.id, userId } },
            data: { lastReadAt: created.createdAt, lastActivityAt: created.createdAt },
          })
          await tx.messageParticipant.updateMany({ where: { threadId: thread.id, userId: { not: userId } }, data: { lastActivityAt: created.createdAt } })
          messageRecords.push({ threadId: thread.id, record: created, participants: thread.participants })
        }
        return messageRecords
      })

      await Promise.all(
        createdMessages.flatMap((entry: { threadId: string; record: any; participants: Array<{ userId: string }> }) =>
          entry.participants.map((participant: { userId: string }) =>
            deps.dispatchRealtimeEvent(participant.userId, {
              type: 'message.created',
              data: { threadId: entry.threadId, message: deps.formatMessage(entry.record, participant.userId) },
            }),
          ),
        ),
      )

      return reply.send({ success: true, selectedBuyerUserId: buyerId, selectedThreadId: selectedThread.id, selectedAt: now.toISOString() })
    }),
  )

  app.post('/market/chats/item/:listingId/pickup-complete', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketListingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await deps.ensureCitizenMarketplaceTables()

      const listingRows = await prisma.$queryRaw<Array<{
        id: string
        seller_user_id: string
        selected_buyer_user_id: string | null
        status: string
        pickup_completed_at: Date | null
        buyer_picked_up_at: Date | null
        seller_picked_up_at: Date | null
      }>>`
        SELECT id, seller_user_id, selected_buyer_user_id, status, pickup_completed_at, buyer_picked_up_at, seller_picked_up_at
        FROM citizen_market_listing
        WHERE id = ${params.data.listingId}
        LIMIT 1
      `

      const listing = listingRows[0]
      if (!listing) return reply.code(404).send({ error: 'listing_not_found' })
      if (listing.status !== 'pending') return reply.code(409).send({ error: 'pickup_not_pending' })

      const viewerIsSeller = listing.seller_user_id === userId
      const viewerIsSelectedBuyer = Boolean(listing.selected_buyer_user_id && listing.selected_buyer_user_id === userId)
      const isParticipant = viewerIsSeller || viewerIsSelectedBuyer
      if (!isParticipant) return reply.code(404).send({ error: 'listing_not_found' })

      if (viewerIsSeller && listing.seller_picked_up_at) {
        return reply.send({
          success: true,
          pickupCompletedAt: listing.pickup_completed_at ? listing.pickup_completed_at.toISOString() : null,
          buyerPickedUpAt: listing.buyer_picked_up_at ? listing.buyer_picked_up_at.toISOString() : null,
          sellerPickedUpAt: listing.seller_picked_up_at.toISOString(),
        })
      }
      if (viewerIsSelectedBuyer && listing.buyer_picked_up_at) {
        return reply.send({
          success: true,
          pickupCompletedAt: listing.pickup_completed_at ? listing.pickup_completed_at.toISOString() : null,
          buyerPickedUpAt: listing.buyer_picked_up_at.toISOString(),
          sellerPickedUpAt: listing.seller_picked_up_at ? listing.seller_picked_up_at.toISOString() : null,
        })
      }

      const selectedThread = listing.selected_buyer_user_id
        ? await prisma.messageThread.findFirst({
            where: {
              contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
              contextId: listing.id,
              participants: { some: { userId: listing.selected_buyer_user_id } },
            },
            select: { id: true, participants: { select: { userId: true, mutedUntil: true } } },
          })
        : null

      const threadMessageBody = deps
        .sanitizePlainText(viewerIsSelectedBuyer ? 'I have picked up the item.' : 'Thank you for picking up the item.')
        .trim()

      const createdMessage = selectedThread
        ? await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const updatedRows = await tx.$queryRaw<Array<{
              pickup_completed_at: Date | null
              buyer_picked_up_at: Date | null
              seller_picked_up_at: Date | null
            }>>`
              UPDATE citizen_market_listing
              SET buyer_picked_up_at = CASE WHEN ${viewerIsSelectedBuyer} AND buyer_picked_up_at IS NULL THEN NOW() ELSE buyer_picked_up_at END,
                  seller_picked_up_at = CASE WHEN ${viewerIsSeller} AND seller_picked_up_at IS NULL THEN NOW() ELSE seller_picked_up_at END,
                  pickup_completed_at = COALESCE(pickup_completed_at, NOW()),
                  pickup_completed_by_user_id = COALESCE(pickup_completed_by_user_id, ${userId}),
                  updated_at = NOW()
              WHERE id = ${listing.id}
              RETURNING pickup_completed_at, buyer_picked_up_at, seller_picked_up_at
            `

            const created = await tx.message.create({
              data: {
                threadId: selectedThread.id,
                senderId: userId,
                body: threadMessageBody || null,
                messageType: MessageType.text,
              },
              select: deps.MESSAGE_SELECT,
            })

            await tx.messageThread.update({ where: { id: selectedThread.id }, data: { lastMessageAt: created.createdAt } })
            await tx.messageParticipant.update({
              where: { threadId_userId: { threadId: selectedThread.id, userId } },
              data: { lastReadAt: created.createdAt, lastActivityAt: created.createdAt },
            })
            await tx.messageParticipant.updateMany({
              where: { threadId: selectedThread.id, userId: { not: userId } },
              data: { lastActivityAt: created.createdAt },
            })

            return {
              message: created,
              participants: selectedThread.participants,
              updated: updatedRows[0] ?? null,
            }
          })
        : await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const updatedRows = await tx.$queryRaw<Array<{
              pickup_completed_at: Date | null
              buyer_picked_up_at: Date | null
              seller_picked_up_at: Date | null
            }>>`
              UPDATE citizen_market_listing
              SET buyer_picked_up_at = CASE WHEN ${viewerIsSelectedBuyer} AND buyer_picked_up_at IS NULL THEN NOW() ELSE buyer_picked_up_at END,
                  seller_picked_up_at = CASE WHEN ${viewerIsSeller} AND seller_picked_up_at IS NULL THEN NOW() ELSE seller_picked_up_at END,
                  pickup_completed_at = COALESCE(pickup_completed_at, NOW()),
                  pickup_completed_by_user_id = COALESCE(pickup_completed_by_user_id, ${userId}),
                  updated_at = NOW()
              WHERE id = ${listing.id}
              RETURNING pickup_completed_at, buyer_picked_up_at, seller_picked_up_at
            `

            return {
              message: null,
              participants: [] as Array<{ userId: string; mutedUntil: Date | null }>,
              updated: updatedRows[0] ?? null,
            }
          })

      if (selectedThread && createdMessage.message) {
        await Promise.all(
          createdMessage.participants.map((participant: { userId: string }) =>
            deps.dispatchRealtimeEvent(participant.userId, {
              type: 'message.created',
              data: { threadId: selectedThread.id, message: deps.formatMessage(createdMessage.message, participant.userId) },
            }),
          ),
        )

        void deps.sendMobilePushForMessageCreated({
          threadId: selectedThread.id,
          message: createdMessage.message,
          participants: createdMessage.participants,
          pushUrl: `/messages?inbox=market&thread=${encodeURIComponent(selectedThread.id)}`,
        })
      }

      return reply.send({
        success: true,
        pickupCompletedAt: createdMessage.updated?.pickup_completed_at ? createdMessage.updated.pickup_completed_at.toISOString() : null,
        buyerPickedUpAt: createdMessage.updated?.buyer_picked_up_at ? createdMessage.updated.buyer_picked_up_at.toISOString() : null,
        sellerPickedUpAt: createdMessage.updated?.seller_picked_up_at ? createdMessage.updated.seller_picked_up_at.toISOString() : null,
      })
    }),
  )

  app.get('/market/chats/:threadId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketChatThreadParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const thread = await prisma.messageThread.findFirst({
        where: {
          id: params.data.threadId,
          contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
          participants: { some: { userId } },
        },
        include: deps.THREAD_WITH_PARTICIPANTS_INCLUDE,
      })
      if (!thread) return reply.code(404).send({ error: 'market_chat_not_found' })

      const query = deps.MessageListQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const { rows, nextCursor } = await deps.fetchThreadMessages(thread.id, query.data.limit, query.data.cursor)

      return reply.send({
        thread: deps.formatThreadBase(thread, userId),
        messages: rows.map((message: any) => deps.formatMessage(message, userId)),
        nextCursor,
      })
    }),
  )

  app.get('/market/chats/:threadId/messages', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketChatThreadParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const membership = await prisma.messageParticipant.findFirst({
        where: {
          threadId: params.data.threadId,
          userId,
          thread: { contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE },
        },
        select: { threadId: true },
      })
      if (!membership) return reply.code(404).send({ error: 'market_chat_not_found' })

      const query = deps.MessageListQuery.safeParse(req.query ?? {})
      if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

      const { rows, nextCursor } = await deps.fetchThreadMessages(params.data.threadId, query.data.limit, query.data.cursor)

      return reply.send({ items: rows.map((message: any) => deps.formatMessage(message, userId)), nextCursor })
    }),
  )

  app.get('/market/chats/unread-count', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      await deps.ensureCitizenMarketplaceTables()

      const result = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int as count
        FROM "Message" m
        JOIN "MessageParticipant" mp ON m."threadId" = mp."threadId"
        JOIN "MessageThread" t ON t.id = m."threadId"
        WHERE mp."userId" = ${userId}
        AND m."senderId" != ${userId}
        AND (mp."lastReadAt" IS NULL OR m."createdAt" > mp."lastReadAt")
        AND t."contextType" = 'market_listing'
        AND NOT EXISTS (
          SELECT 1
          FROM citizen_market_chat_interest i
          WHERE i.thread_id = m."threadId"
          AND i.user_id = ${userId}
          AND i.interested = FALSE
        )
      `

      return reply.send({ count: Number(result[0]?.count || 0) })
    }),
  )

  app.post('/market/chats/:threadId/read', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketChatThreadParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const membership = await prisma.messageParticipant.findFirst({
        where: {
          threadId: params.data.threadId,
          userId,
          thread: { contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE },
        },
        select: { threadId: true },
      })
      if (!membership) return reply.code(404).send({ error: 'market_chat_not_found' })

      const parse = deps.ThreadReadInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      let readAt = new Date()
      if (parse.data.messageId) {
        const message = await prisma.message.findUnique({ where: { id: parse.data.messageId }, select: { threadId: true, createdAt: true } })
        if (!message || message.threadId !== params.data.threadId) {
          return reply.code(400).send({ error: 'invalid_message' })
        }
        readAt = message.createdAt
      }

      await prisma.messageParticipant.update({
        where: { threadId_userId: { threadId: params.data.threadId, userId } },
        data: { lastReadAt: readAt },
      })

      return reply.send({ lastReadAt: readAt })
    }),
  )

  app.post('/market/chats/:threadId/messages', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.MarketChatThreadParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

      const parse = deps.SendMessageInput.safeParse(req.body ?? {})
      if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

      const thread = await prisma.messageThread.findFirst({
        where: {
          id: params.data.threadId,
          contextType: deps.MARKET_LISTING_CHAT_CONTEXT_TYPE,
          participants: { some: { userId } },
        },
        select: { id: true, participants: { select: { userId: true, mutedUntil: true } } },
      })
      if (!thread) return reply.code(404).send({ error: 'market_chat_not_found' })

      const messageRecord = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const normalizedBody = parse.data.body?.trim() ? deps.sanitizePlainText(parse.data.body) : ''
        const created = await tx.message.create({
          data: {
            threadId: thread.id,
            senderId: userId,
            body: normalizedBody ? normalizedBody : null,
            attachments: parse.data.attachments ?? undefined,
            messageType: MessageType.text,
          },
          select: deps.MESSAGE_SELECT,
        })

        await tx.messageThread.update({ where: { id: thread.id }, data: { lastMessageAt: created.createdAt } })
        await tx.messageParticipant.update({
          where: { threadId_userId: { threadId: thread.id, userId } },
          data: { lastReadAt: created.createdAt, lastActivityAt: created.createdAt },
        })
        await tx.messageParticipant.updateMany({ where: { threadId: thread.id, userId: { not: userId } }, data: { lastActivityAt: created.createdAt } })

        return created
      })

      await Promise.all(
        thread.participants.map((participant: { userId: string }) =>
          deps.dispatchRealtimeEvent(participant.userId, {
            type: 'message.created',
            data: { threadId: thread.id, message: deps.formatMessage(messageRecord, participant.userId) },
          }),
        ),
      )

      void deps.sendMobilePushForMessageCreated({
        threadId: thread.id,
        message: messageRecord,
        participants: thread.participants,
        pushUrl: `/market/chats/${encodeURIComponent(thread.id)}`,
      })

      return reply.code(201).send({ message: deps.formatMessage(messageRecord, userId) })
    }),
  )
}