import { prisma } from '@civil/db'
import { FriendshipStatus, Prisma } from '@prisma/client'

type ConnectionStatusValue = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'BLOCKED'

type ConnectionRow = {
  id: string
  requesterId: string
  addresseeId: string
  status: ConnectionStatusValue
  requestedAt: Date
  respondedAt: Date | null
}

type CreateSocialGraphHelpersDeps = {
  formatFriendUser: (user: any) => any
  notifyConnectionRequest: (connectionId: string, requesterId: string, addresseeId: string) => Promise<void>
}

const FAMILY_SPONSOR_FRIENDSHIP_PREFIX = 'family-sponsor:'

export function createSocialGraphHelpers(deps: CreateSocialGraphHelpersDeps) {
  function isConnectionTableMissingError(err: unknown): boolean {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2021' || err.code === 'P2010') return true
    }
    const message = typeof (err as any)?.message === 'string' ? (err as any).message : ''
    return /"Connection"|ConnectionStatus|relation .*Connection.* does not exist/i.test(message)
  }

  async function findConnectionBetween(userId: string, targetUserId: string): Promise<ConnectionRow | null> {
    try {
      const rows = await prisma.$queryRaw<ConnectionRow[]>`
        SELECT "id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt"
        FROM "Connection"
        WHERE ("requesterId" = ${userId} AND "addresseeId" = ${targetUserId})
           OR ("requesterId" = ${targetUserId} AND "addresseeId" = ${userId})
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (error) {
      if (isConnectionTableMissingError(error)) return null
      throw error
    }
  }

  async function findConnectionById(id: string): Promise<ConnectionRow | null> {
    try {
      const rows = await prisma.$queryRaw<ConnectionRow[]>`
        SELECT "id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt"
        FROM "Connection"
        WHERE "id" = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (error) {
      if (isConnectionTableMissingError(error)) return null
      throw error
    }
  }

  async function createOrRefreshConnectionRequest(requesterId: string, addresseeId: string): Promise<void> {
    if (!requesterId || !addresseeId || requesterId === addresseeId) return

    try {
      const existing = await findConnectionBetween(requesterId, addresseeId)
      if (existing) {
        if (existing.status === 'ACCEPTED' || existing.status === 'PENDING') {
          return
        }

        const now = new Date()
        await prisma.$executeRaw`
          UPDATE "Connection"
          SET "requesterId" = ${requesterId},
              "addresseeId" = ${addresseeId},
              "status" = 'PENDING',
              "requestedAt" = ${now},
              "respondedAt" = NULL
          WHERE "id" = ${existing.id}
        `

        await deps.notifyConnectionRequest(existing.id, requesterId, addresseeId)
        return
      }

      const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const now = new Date()
      await prisma.$executeRaw`
        INSERT INTO "Connection" ("id", "requesterId", "addresseeId", "status", "requestedAt", "respondedAt")
        VALUES (${id}, ${requesterId}, ${addresseeId}, 'PENDING', ${now}, NULL)
      `

      await deps.notifyConnectionRequest(id, requesterId, addresseeId)
    } catch (error) {
      if (isConnectionTableMissingError(error)) return
      throw error
    }
  }

  async function loadAcceptedConnectionIds(userId: string): Promise<string[]> {
    try {
      const rows = await prisma.$queryRaw<Array<{ requesterId: string; addresseeId: string }>>`
        SELECT "requesterId", "addresseeId"
        FROM "Connection"
        WHERE "status" = 'ACCEPTED'
          AND ("requesterId" = ${userId} OR "addresseeId" = ${userId})
      `
      const ids = new Set<string>()
      for (const row of rows) {
        ids.add(row.requesterId === userId ? row.addresseeId : row.requesterId)
      }
      return [...ids]
    } catch (error) {
      if (isConnectionTableMissingError(error)) return []
      throw error
    }
  }

  function formatFriendRequest(friendship: any, viewerId: string) {
    const direction = friendship.requesterId === viewerId ? 'outgoing' : 'incoming'
    const counterpart = direction === 'outgoing' ? friendship.addressee : friendship.requester
    return {
      id: friendship.id,
      status: friendship.status,
      direction,
      requestedAt: friendship.requestedAt,
      respondedAt: friendship.respondedAt ?? null,
      user: deps.formatFriendUser(counterpart),
    }
  }

  function formatFriendship(friendship: any, viewerId: string) {
    const counterpart = friendship.requesterId === viewerId ? friendship.addressee : friendship.requester
    return {
      id: friendship.id,
      status: friendship.status,
      since: friendship.respondedAt ?? friendship.requestedAt,
      user: deps.formatFriendUser(counterpart),
    }
  }

  function buildFamilySponsorFriendshipId(memberId: string) {
    return `${FAMILY_SPONSOR_FRIENDSHIP_PREFIX}${memberId}`
  }

  function formatFamilySponsorFriendship(member: any) {
    return {
      id: buildFamilySponsorFriendshipId(member.id),
      status: FriendshipStatus.ACCEPTED,
      since: member.createdAt,
      locked: true,
      specialKind: 'family_sponsor' as const,
      user: deps.formatFriendUser(member.parent),
    }
  }

  return {
    buildFamilySponsorFriendshipId,
    createOrRefreshConnectionRequest,
    findConnectionBetween,
    findConnectionById,
    formatFamilySponsorFriendship,
    formatFriendRequest,
    formatFriendship,
    isConnectionTableMissingError,
    loadAcceptedConnectionIds,
  }
}
