import { createHash, randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { MessageParticipantRole, MessageThreadType, Prisma } from '@prisma/client'
import { z } from 'zod'

type UserLivesDeps = {
  issueMeetingRtcSession: (args: {
    roomId: string
    userId: string
    role: 'manager' | 'participant'
    displayName: string
    deviceId: string | null
    capabilities: {
      audio?: boolean
      video?: boolean
    } | null
  }) => Promise<any>
  readMeetingRtcRoomState: (roomId: string) => Promise<{
    peerCount: number
    hostPresent: boolean
    peers: Array<{ peerId: string; userId: string; displayName: string; role: string }>
  } | null>
  disconnectMeetingRtcPeer: (args: { roomId: string; peerId: string; reason?: string | null }) => Promise<any>
  resolveUserId: (req: FastifyRequest) => Promise<string | null>
  sanitizePlainText: (value: string) => string
  normalizeMediaUrl: (url?: string | null) => string | null
  withSchemaGuard: (req: FastifyRequest, reply: FastifyReply, handler: () => Promise<any>) => Promise<any>
}

type UserLiveSpaceRow = {
  id: string
  host_user_id: string
  created_by: string | null
  title: string
  description: string | null
  cover_url: string | null
  visibility: string
  status: string
  launch_mode: string
  requires_password: boolean
  password_hash: string | null
  requires_manual_admit: boolean
  max_participants: number | null
  thread_id: string | null
  created_at: Date
  updated_at: Date
}

type UserLiveModeratorRow = {
  space_id: string
  user_id: string
  handle: string
}

type UserLiveAdmissionStatus = 'WAITING' | 'ADMITTED' | 'DENIED'

type UserLiveSpeakerStatus = 'REQUESTED' | 'APPROVED' | 'DECLINED'

type UserLiveAdmissionRow = {
  space_id: string
  user_id: string
  status: string
}

type UserLiveWaitingParticipant = {
  userId: string
  status: 'WAITING' | 'ADMITTED'
  name: string
  handle: string | null
  avatarUrl: string | null
}

type UserLiveSpeakerParticipant = {
  userId: string
  status: 'REQUESTED' | 'APPROVED'
  name: string
  handle: string | null
  avatarUrl: string | null
  coverUrl: string | null
}

type UserLiveAccessContext = {
  space: UserLiveSpaceRow
  host: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
  }
  viewerId: string | null
  isOwner: boolean
  isModerator: boolean
  canManageMeetings: boolean
}

const HandleParams = z.object({
  handle: z.string().trim().min(1).max(120),
})

const SpaceParams = z.object({
  spaceId: z.string().trim().min(3).max(120),
})

const HandleSpaceParams = HandleParams.extend({
  spaceId: z.string().trim().min(3).max(120),
})

const LiveCreateBody = z
  .object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(1000).optional().nullable(),
    coverUrl: z.string().trim().min(1).max(2000).optional().nullable(),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
    requiresPassword: z.boolean().default(false),
    password: z.string().trim().min(1).max(128).optional().nullable(),
    requiresManualAdmit: z.boolean().default(false),
    maxParticipants: z.coerce.number().int().min(1).max(100).optional().nullable(),
    moderatorHandles: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).default('ARCHIVED'),
    launchMode: z.enum(['SPACE', 'INSTANT']).default('SPACE'),
  })
  .superRefine((value, ctx) => {
    if (value.requiresPassword && !value.password?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: 'password_required' })
    }
  })

const LiveUpdateBody = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().max(1000).optional().nullable(),
    coverUrl: z.string().trim().min(1).max(2000).optional().nullable(),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    requiresPassword: z.boolean().optional(),
    password: z.string().trim().min(1).max(128).optional().nullable(),
    requiresManualAdmit: z.boolean().optional(),
    maxParticipants: z.coerce.number().int().min(1).max(100).optional().nullable(),
    moderatorHandles: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.requiresPassword === true && value.password !== undefined && !value.password?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: 'password_required' })
    }
  })

const LiveJoinBody = z.object({
  password: z.string().trim().min(1).max(128).optional().nullable(),
})

const LiveRtcSessionBody = z.object({
  displayName: z.string().trim().min(1).max(120).optional().nullable(),
  deviceId: z.string().trim().min(1).max(120).optional().nullable(),
  capabilities: z
    .object({
      audio: z.boolean().optional(),
      video: z.boolean().optional(),
    })
    .optional()
    .nullable(),
})

const LiveSpeakerParticipantParams = SpaceParams.extend({
  userId: z.string().trim().min(1).max(120),
})

const LiveParticipantParams = SpaceParams.extend({
  userId: z.string().trim().min(1).max(120),
})

let userLiveTablesReady: Promise<void> | null = null

function hashMeetingPassword(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function normalizeAdmissionStatus(value: string | null | undefined): UserLiveAdmissionStatus | null {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'WAITING' || normalized === 'ADMITTED' || normalized === 'DENIED') return normalized
  return null
}

function normalizeSpeakerStatus(value: string | null | undefined): UserLiveSpeakerStatus | null {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'REQUESTED' || normalized === 'APPROVED' || normalized === 'DECLINED') return normalized
  return null
}

function normalizeVisibility(value: string | null | undefined): 'PUBLIC' | 'PRIVATE' {
  return String(value || '').trim().toUpperCase() === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'
}

function normalizeStatus(value: string | null | undefined): 'ACTIVE' | 'ARCHIVED' {
  return String(value || '').trim().toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'ARCHIVED'
}

function normalizeLaunchMode(value: string | null | undefined): 'SPACE' | 'INSTANT' {
  return String(value || '').trim().toUpperCase() === 'INSTANT' ? 'INSTANT' : 'SPACE'
}

function normalizeMaxParticipants(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100
  return Math.max(1, Math.min(100, Math.trunc(value)))
}

function toDisplayTitleCase(value: string): string {
  const source = value.trim()
  if (!source) return ''
  return source.replace(/\b([A-Za-zÀ-ÖØ-öø-ÿ])([A-Za-zÀ-ÖØ-öø-ÿ]*)/g, (_match, first: string, rest: string) => {
    return `${first.toUpperCase()}${rest.toLowerCase()}`
  })
}

function buildPublicLiveHref(handle: string, spaceId: string) {
  return `/u/${encodeURIComponent(handle)}/live/${encodeURIComponent(spaceId)}`
}

function mapSpaceRowForViewer(args: {
  row: UserLiveSpaceRow
  participantCount: number
  canManageMeetings: boolean
  isParticipant: boolean
  admissionStatus: UserLiveAdmissionStatus | null
}) {
  const status = normalizeStatus(args.row.status)
  const visibility = normalizeVisibility(args.row.visibility)

  let canJoinNow = true
  let blockedReason: string | null = null
  if (status !== 'ACTIVE' && !args.canManageMeetings) {
    canJoinNow = false
    blockedReason = 'live_not_published'
  } else if (visibility === 'PRIVATE' && !args.canManageMeetings && !args.isParticipant && args.admissionStatus !== 'ADMITTED') {
    canJoinNow = false
    blockedReason = 'live_private'
  } else if (
    typeof args.row.max_participants === 'number' &&
    args.row.max_participants > 0 &&
    args.participantCount >= args.row.max_participants &&
    !args.isParticipant &&
    !args.canManageMeetings
  ) {
    canJoinNow = false
    blockedReason = 'live_full'
  } else if (args.row.requires_manual_admit && args.admissionStatus === 'WAITING' && !args.canManageMeetings) {
    canJoinNow = false
    blockedReason = 'waiting_for_admit'
  }

  const exposeThreadId = args.canManageMeetings || args.isParticipant || args.admissionStatus === 'ADMITTED'

  return {
    id: args.row.id,
    title: args.row.title || 'Untitled live space',
    description: args.row.description ?? null,
    coverUrl: args.row.cover_url ?? null,
    visibility,
    status,
    launchMode: normalizeLaunchMode(args.row.launch_mode),
    requiresPassword: Boolean(args.row.requires_password),
    requiresManualAdmit: Boolean(args.row.requires_manual_admit),
    maxParticipants: normalizeMaxParticipants(args.row.max_participants),
    participantCount: Number.isFinite(args.participantCount) ? Math.max(0, args.participantCount) : 0,
    canJoinNow,
    blockedReason,
    schedule: {
      startsAt: null,
      endsAt: null,
    },
    threadId: exposeThreadId ? args.row.thread_id ?? null : null,
    admissionStatus: args.admissionStatus,
  }
}

async function ensureUserLiveTables() {
  if (userLiveTablesReady) return userLiveTablesReady

  userLiveTablesReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS user_live_space (
          id TEXT PRIMARY KEY,
          host_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          description TEXT,
          cover_url TEXT,
          visibility TEXT NOT NULL DEFAULT 'PUBLIC',
          status TEXT NOT NULL DEFAULT 'ARCHIVED',
          launch_mode TEXT NOT NULL DEFAULT 'SPACE',
          requires_password BOOLEAN NOT NULL DEFAULT FALSE,
          password_hash TEXT,
          requires_manual_admit BOOLEAN NOT NULL DEFAULT FALSE,
          max_participants INTEGER,
          thread_id TEXT REFERENCES "MessageThread"(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS user_live_space_host_status_idx
        ON user_live_space (host_user_id, status, updated_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        ALTER TABLE user_live_space
        ADD COLUMN IF NOT EXISTS cover_url TEXT;
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS user_live_space_moderator (
          space_id TEXT NOT NULL REFERENCES user_live_space(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (space_id, user_id)
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS user_live_space_moderator_user_idx
        ON user_live_space_moderator (user_id, space_id);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS user_live_space_admission (
          space_id TEXT NOT NULL REFERENCES user_live_space(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'WAITING',
          decided_by_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (space_id, user_id)
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS user_live_space_admission_status_idx
        ON user_live_space_admission (space_id, status, updated_at DESC);
      `)

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS user_live_space_speaker (
          space_id TEXT NOT NULL REFERENCES user_live_space(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'REQUESTED',
          requested_by_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          decided_by_user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (space_id, user_id)
        );
      `)

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS user_live_space_speaker_status_idx
        ON user_live_space_speaker (space_id, status, updated_at DESC);
      `)
    } catch (error) {
      userLiveTablesReady = null
      throw error
    }
  })()

  return userLiveTablesReady
}

async function ensureUserLiveThread(args: {
  hostUserId: string
  spaceId: string
  title: string
  ownerUserId: string
  existingThreadId?: string | null
}) {
  if (args.existingThreadId) {
    const existing = await prisma.messageThread.findUnique({
      where: { id: args.existingThreadId },
      select: { id: true },
    })
    if (existing?.id) return existing.id
  }

  const uniqueKey = `userlive:${args.hostUserId}:${args.spaceId}`
  const existingByUnique = await prisma.messageThread.findUnique({
    where: { uniqueKey },
    select: { id: true },
  })
  if (existingByUnique?.id) return existingByUnique.id

  const now = new Date()
  const created = await prisma.messageThread.create({
    data: {
      type: MessageThreadType.group,
      uniqueKey,
      contextType: 'user_live',
      contextId: `${args.hostUserId}|${args.spaceId}|${encodeURIComponent(args.title || 'Live space')}`,
      lastMessageAt: now,
      participants: {
        create: [
          {
            userId: args.ownerUserId,
            role: MessageParticipantRole.admin,
            lastReadAt: now,
            lastActivityAt: now,
          },
        ],
      },
    },
    select: { id: true },
  })

  return created.id
}

async function resolveSpaceAccessById(spaceId: string, viewerId: string | null): Promise<UserLiveAccessContext | null> {
  const rows = (await prisma.$queryRaw(Prisma.sql`
    SELECT
      space.id,
      space.host_user_id,
      space.created_by,
      space.title,
      space.description,
      space.cover_url,
      space.visibility,
      space.status,
      space.launch_mode,
      space.requires_password,
      space.password_hash,
      space.requires_manual_admit,
      space.max_participants,
      space.thread_id,
      space.created_at,
      space.updated_at,
      host.handle as host_handle,
      host.name as host_name,
      host."avatarUrl" as host_avatar_url,
      host."coverUrl" as host_cover_url
    FROM user_live_space space
    INNER JOIN "User" host ON host.id = space.host_user_id
    WHERE space.id = ${spaceId}
    LIMIT 1
  `)) as Array<UserLiveSpaceRow & { host_handle: string; host_name: string | null; host_avatar_url: string | null; host_cover_url: string | null }>

  const row = rows[0]
  if (!row) return null

  const isOwner = Boolean(viewerId && row.host_user_id === viewerId)
  const moderatorRows = viewerId
    ? ((await prisma.$queryRaw(Prisma.sql`
        SELECT space_id, user_id, ${''}::text as handle
        FROM user_live_space_moderator
        WHERE space_id = ${row.id}
          AND user_id = ${viewerId}
        LIMIT 1
      `)) as UserLiveModeratorRow[])
    : []
  const isModerator = Boolean(moderatorRows[0]?.user_id)

  return {
    space: row,
    host: {
      id: row.host_user_id,
      handle: row.host_handle,
      name: row.host_name,
      avatarUrl: row.host_avatar_url,
      coverUrl: row.host_cover_url,
    },
    viewerId,
    isOwner,
    isModerator,
    canManageMeetings: isOwner || isModerator,
  }
}

async function resolveSpaceAccessByHandle(args: { handleRaw: string; spaceId: string; viewerId: string | null }): Promise<UserLiveAccessContext | null> {
  const handle = args.handleRaw.trim().replace(/^@+/, '').toLowerCase()
  if (!handle) return null
  const access = await resolveSpaceAccessById(args.spaceId, args.viewerId)
  if (!access) return null
  if (access.host.handle.toLowerCase() !== handle) return null
  return access
}

async function loadModeratorHandles(spaceId: string): Promise<string[]> {
  const rows = (await prisma.$queryRaw(Prisma.sql`
    SELECT "User".handle
    FROM user_live_space_moderator moderator
    INNER JOIN "User" ON "User".id = moderator.user_id
    WHERE moderator.space_id = ${spaceId}
    ORDER BY "User".handle ASC
  `)) as Array<{ handle: string }>
  return rows.map((row) => row.handle).filter(Boolean)
}

async function syncModeratorHandles(spaceId: string, hostUserId: string, moderatorHandles: string[] | undefined) {
  if (!moderatorHandles) return

  const handles = Array.from(new Set(moderatorHandles.map((value) => value.trim().replace(/^@+/, '').toLowerCase()).filter(Boolean)))
  const users: Array<{ id: string; handle: string | null }> = handles.length
    ? await prisma.user.findMany({
        where: { handle: { in: handles }, id: { not: hostUserId } },
        select: { id: true, handle: true },
      })
    : []

  await prisma.$executeRaw`
    DELETE FROM user_live_space_moderator
    WHERE space_id = ${spaceId}
      AND user_id <> ${hostUserId}
  `

  for (const user of users) {
    await prisma.$executeRaw`
      INSERT INTO user_live_space_moderator (space_id, user_id, created_at)
      VALUES (${spaceId}, ${user.id}, ${new Date()})
      ON CONFLICT (space_id, user_id) DO NOTHING
    `
  }
}

async function ensureThreadParticipant(args: { threadId: string; userId: string; role: 'admin' | 'member' }) {
  const now = new Date()
  await prisma.messageParticipant.upsert({
    where: {
      threadId_userId: {
        threadId: args.threadId,
        userId: args.userId,
      },
    },
    create: {
      threadId: args.threadId,
      userId: args.userId,
      role: args.role === 'admin' ? MessageParticipantRole.admin : MessageParticipantRole.member,
      lastReadAt: now,
      lastActivityAt: now,
    },
    update: {
      role: args.role === 'admin' ? MessageParticipantRole.admin : MessageParticipantRole.member,
      lastActivityAt: now,
    },
  })
}

async function buildLiveMeetingResponse(args: {
  access: UserLiveAccessContext
  includeWaitingParticipants?: boolean
  includeModeratorHandles?: boolean
  deps: Pick<UserLivesDeps, 'normalizeMediaUrl' | 'readMeetingRtcRoomState'>
}) {
  const row = args.access.space
  const threadId = row.thread_id ?? null
  const viewerId = args.access.viewerId

  type ParticipantCountRow = { count: number }
  const participantRows = threadId
    ? ((await prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(*)::int as count
        FROM "MessageParticipant"
        WHERE "threadId" = ${threadId}
      `)) as ParticipantCountRow[])
    : []
  const participantCount = Number(participantRows[0]?.count) || 0

  type ViewerParticipantRow = { exists: number }
  const viewerParticipantRows = viewerId && threadId
    ? ((await prisma.$queryRaw(Prisma.sql`
        SELECT 1::int as exists
        FROM "MessageParticipant"
        WHERE "threadId" = ${threadId}
          AND "userId" = ${viewerId}
        LIMIT 1
      `)) as ViewerParticipantRow[])
    : []
  const isParticipant = Boolean(viewerParticipantRows[0]?.exists)

  type AdmissionLookupRow = { status: string | null }
  const admissionRows = viewerId
    ? ((await prisma.$queryRaw(Prisma.sql`
        SELECT status
        FROM user_live_space_admission
        WHERE space_id = ${row.id}
          AND user_id = ${viewerId}
        LIMIT 1
      `)) as AdmissionLookupRow[])
    : []
  const admissionStatus = normalizeAdmissionStatus(admissionRows[0]?.status)

  const meeting = mapSpaceRowForViewer({
    row,
    participantCount,
    canManageMeetings: args.access.canManageMeetings,
    isParticipant,
    admissionStatus,
  })
  const rtcState = normalizeStatus(row.status) === 'ACTIVE' ? await args.deps.readMeetingRtcRoomState(row.id) : null

  let waitingParticipants: UserLiveWaitingParticipant[] = []
  if (args.includeWaitingParticipants && args.access.canManageMeetings) {
    type WaitingParticipantRow = {
      user_id: string
      status: string
      name: string | null
      handle: string | null
      avatar_url: string | null
    }
    const waitingRows = (await prisma.$queryRaw(Prisma.sql`
      SELECT
        admission.user_id,
        admission.status,
        "User".name,
        "User".handle,
        "User"."avatarUrl" as avatar_url
      FROM user_live_space_admission admission
      LEFT JOIN "User" ON "User"."id" = admission.user_id
      WHERE admission.space_id = ${row.id}
        ${viewerId ? Prisma.sql`AND admission.user_id <> ${viewerId}` : Prisma.empty}
        AND admission.status IN ('WAITING', 'ADMITTED')
      ORDER BY
        CASE admission.status
          WHEN 'WAITING' THEN 0
          ELSE 1
        END,
        admission.updated_at ASC
    `)) as WaitingParticipantRow[]
    waitingParticipants = waitingRows
      .map((entry): UserLiveWaitingParticipant | null => {
        if (!entry.user_id) return null
        return {
          userId: entry.user_id,
          status: entry.status === 'ADMITTED' ? 'ADMITTED' : 'WAITING',
          name: entry.name?.trim() || entry.handle?.trim() || 'Civil user',
          handle: entry.handle?.trim() || null,
          avatarUrl: args.deps.normalizeMediaUrl(entry.avatar_url),
        }
      })
      .filter((entry): entry is UserLiveWaitingParticipant => Boolean(entry))
  }

  type SpeakerRow = {
    user_id: string
    status: string
    name: string | null
    handle: string | null
    avatar_url: string | null
    cover_url: string | null
  }
  const speakerRows = (await prisma.$queryRaw(Prisma.sql`
    SELECT
      speaker.user_id,
      speaker.status,
      "User".name,
      "User".handle,
      "User"."avatarUrl" as avatar_url,
      "User"."coverUrl" as cover_url
    FROM user_live_space_speaker speaker
    LEFT JOIN "User" ON "User"."id" = speaker.user_id
    WHERE speaker.space_id = ${row.id}
      AND speaker.status IN ('REQUESTED', 'APPROVED')
    ORDER BY
      CASE speaker.status
        WHEN 'APPROVED' THEN 0
        ELSE 1
      END,
      speaker.updated_at ASC
  `)) as SpeakerRow[]

  const speakerEntries = speakerRows
    .map((entry): UserLiveSpeakerParticipant | null => {
      const status = normalizeSpeakerStatus(entry.status)
      if (!entry.user_id || (status !== 'APPROVED' && status !== 'REQUESTED')) return null
      return {
        userId: entry.user_id,
        status,
        name: entry.name?.trim() || entry.handle?.trim() || 'Civil user',
        handle: entry.handle?.trim() || null,
        avatarUrl: args.deps.normalizeMediaUrl(entry.avatar_url),
        coverUrl: args.deps.normalizeMediaUrl(entry.cover_url),
      }
    })
    .filter((entry): entry is UserLiveSpeakerParticipant => Boolean(entry))

  const speakers = speakerEntries.filter((entry) => entry.status === 'APPROVED')
  const speakerRequests = speakerEntries.filter((entry) => {
    if (entry.status !== 'REQUESTED') return false
    if (args.access.canManageMeetings) return true
    return Boolean(viewerId && entry.userId === viewerId)
  })
  const viewerSpeakerStatus = viewerId
    ? speakerEntries.find((entry) => entry.userId === viewerId)?.status ?? null
    : null

  const moderatorHandles = args.includeModeratorHandles ? await loadModeratorHandles(row.id) : undefined

  return {
    meeting: {
      ...meeting,
      rtc: rtcState
        ? {
            peerCount: rtcState.peerCount,
            hostPresent: rtcState.hostPresent,
          }
        : null,
      waitingParticipants,
      speakers,
      speakerRequests,
      ...(moderatorHandles ? { moderatorHandles } : {}),
    },
    viewer: {
      id: viewerId,
      canManageMeetings: args.access.canManageMeetings,
      isOwner: args.access.isOwner,
      speakerStatus: viewerSpeakerStatus,
    },
    host: {
      id: args.access.host.id,
      handle: args.access.host.handle,
      name: args.access.host.name,
      avatarUrl: args.deps.normalizeMediaUrl(args.access.host.avatarUrl),
      coverUrl: args.deps.normalizeMediaUrl(args.access.host.coverUrl),
      href: buildPublicLiveHref(args.access.host.handle, row.id),
    },
  }
}

export function registerUserLivesRoutes(app: FastifyInstance, deps: UserLivesDeps) {
  app.get('/live/spaces', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      await ensureUserLiveTables()

      const viewer = await prisma.user.findUnique({
        where: { id: viewerId },
        select: { id: true, handle: true, name: true, avatarUrl: true },
      })
      if (!viewer) return reply.code(404).send({ error: 'user_not_found' })

      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          id,
          host_user_id,
          created_by,
          title,
          description,
          cover_url,
          visibility,
          status,
          launch_mode,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          thread_id,
          created_at,
          updated_at
        FROM user_live_space
        WHERE host_user_id = ${viewerId}
        ORDER BY
          CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
          updated_at DESC
        LIMIT 200
      `)) as UserLiveSpaceRow[]

      const items = await Promise.all(
        rows.map(async (row) => {
          const access = await resolveSpaceAccessById(row.id, viewerId)
          if (!access) return null
          const payload = await buildLiveMeetingResponse({ access, deps })
          return payload.meeting
        }),
      )

      return reply.send({
        viewer: {
          canManageMeetings: true,
          handle: viewer.handle,
          name: viewer.name,
          avatarUrl: deps.normalizeMediaUrl(viewer.avatarUrl ?? null),
        },
        items: items.filter(Boolean),
      })
    }),
  )

  app.post('/live/spaces/instant', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      await ensureUserLiveTables()

      const viewer = await prisma.user.findUnique({
        where: { id: viewerId },
        select: { id: true, handle: true, name: true },
      })
      if (!viewer) return reply.code(404).send({ error: 'user_not_found' })

      const spaceId = `live_${randomUUID().replace(/-/g, '').slice(0, 14)}`
      const titleBase = toDisplayTitleCase(viewer.name?.trim() || viewer.handle || 'Civil user')
      const title = deps.sanitizePlainText(`${titleBase} is live`).trim() || 'Live now'
      const now = new Date()
      const threadId = await ensureUserLiveThread({
        hostUserId: viewerId,
        spaceId,
        title,
        ownerUserId: viewerId,
        existingThreadId: null,
      })

      await prisma.$executeRaw`
        INSERT INTO user_live_space (
          id,
          host_user_id,
          created_by,
          title,
          description,
          cover_url,
          visibility,
          status,
          launch_mode,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          thread_id,
          created_at,
          updated_at
        )
        VALUES (
          ${spaceId},
          ${viewerId},
          ${viewerId},
          ${title},
          ${null},
          ${null},
          ${'PUBLIC'},
          ${'ACTIVE'},
          ${'INSTANT'},
          ${false},
          ${null},
          ${false},
          ${100},
          ${threadId},
          ${now},
          ${now}
        )
      `

      const access = await resolveSpaceAccessById(spaceId, viewerId)
      if (!access) return reply.code(500).send({ error: 'live_create_failed' })
      const payload = await buildLiveMeetingResponse({ access, includeModeratorHandles: true, deps })

      return reply.send({
        ...payload,
        redirectPath: buildPublicLiveHref(viewer.handle, spaceId),
      })
    }),
  )

  app.post('/live/spaces', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const body = LiveCreateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      await ensureUserLiveTables()

      const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { handle: true } })
      if (!viewer) return reply.code(404).send({ error: 'user_not_found' })

      const spaceId = `live_${randomUUID().replace(/-/g, '').slice(0, 14)}`
      const now = new Date()
      const title = deps.sanitizePlainText(body.data.title).trim() || 'Untitled live space'
      const description = body.data.description ? deps.sanitizePlainText(body.data.description).trim() || null : null
      const coverUrl = body.data.coverUrl ? deps.normalizeMediaUrl(body.data.coverUrl) ?? body.data.coverUrl.trim() : null
      const requiresPassword = body.data.requiresPassword
      const passwordHash = requiresPassword && body.data.password ? hashMeetingPassword(body.data.password.trim()) : null
      const threadId = await ensureUserLiveThread({
        hostUserId: viewerId,
        spaceId,
        title,
        ownerUserId: viewerId,
        existingThreadId: null,
      })

      await prisma.$executeRaw`
        INSERT INTO user_live_space (
          id,
          host_user_id,
          created_by,
          title,
          description,
          cover_url,
          visibility,
          status,
          launch_mode,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          thread_id,
          created_at,
          updated_at
        )
        VALUES (
          ${spaceId},
          ${viewerId},
          ${viewerId},
          ${title},
          ${description},
          ${coverUrl},
          ${body.data.visibility},
          ${body.data.status},
          ${body.data.launchMode},
          ${requiresPassword},
          ${passwordHash},
          ${body.data.requiresManualAdmit},
          ${normalizeMaxParticipants(body.data.maxParticipants)},
          ${threadId},
          ${now},
          ${now}
        )
      `

      await syncModeratorHandles(spaceId, viewerId, body.data.moderatorHandles)

      const access = await resolveSpaceAccessById(spaceId, viewerId)
      if (!access) return reply.code(500).send({ error: 'live_create_failed' })
      const payload = await buildLiveMeetingResponse({ access, includeModeratorHandles: true, deps })
      return reply.send({
        ...payload,
        managePath: `/live/manage/${encodeURIComponent(spaceId)}`,
        redirectPath: buildPublicLiveHref(viewer.handle, spaceId),
      })
    }),
  )

  app.get('/live/spaces/:spaceId/manage', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = SpaceParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (!access.isOwner) return reply.code(403).send({ error: 'forbidden' })

      return reply.send(await buildLiveMeetingResponse({ access, includeModeratorHandles: true, deps }))
    }),
  )

  app.put('/live/spaces/:spaceId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = SpaceParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = LiveUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (!access.isOwner) return reply.code(403).send({ error: 'forbidden' })

      const nextTitle = body.data.title === undefined ? access.space.title : deps.sanitizePlainText(body.data.title).trim() || 'Untitled live space'
      const nextDescription = body.data.description === undefined
        ? access.space.description
        : body.data.description
          ? deps.sanitizePlainText(body.data.description).trim() || null
          : null
      const nextCoverUrl = body.data.coverUrl === undefined
        ? access.space.cover_url
        : body.data.coverUrl
          ? deps.normalizeMediaUrl(body.data.coverUrl) ?? body.data.coverUrl.trim()
          : null
      const nextVisibility = body.data.visibility === undefined ? normalizeVisibility(access.space.visibility) : body.data.visibility
      const nextStatus = body.data.status === undefined ? normalizeStatus(access.space.status) : body.data.status
      const nextRequiresPassword = body.data.requiresPassword === undefined ? Boolean(access.space.requires_password) : body.data.requiresPassword
      const nextPasswordHash = nextRequiresPassword
        ? body.data.password?.trim()
          ? hashMeetingPassword(body.data.password.trim())
          : access.space.password_hash
        : null
      const nextRequiresManualAdmit = body.data.requiresManualAdmit === undefined
        ? Boolean(access.space.requires_manual_admit)
        : body.data.requiresManualAdmit
      const nextMaxParticipants = body.data.maxParticipants === undefined
        ? normalizeMaxParticipants(access.space.max_participants)
        : normalizeMaxParticipants(body.data.maxParticipants)

      await prisma.$executeRaw`
        UPDATE user_live_space
        SET
          title = ${nextTitle},
          description = ${nextDescription},
          cover_url = ${nextCoverUrl},
          visibility = ${nextVisibility},
          status = ${nextStatus},
          requires_password = ${nextRequiresPassword},
          password_hash = ${nextPasswordHash},
          requires_manual_admit = ${nextRequiresManualAdmit},
          max_participants = ${nextMaxParticipants},
          updated_at = ${new Date()}
        WHERE id = ${access.space.id}
      `

      await syncModeratorHandles(access.space.id, access.space.host_user_id, body.data.moderatorHandles)

      const refreshed = await resolveSpaceAccessById(access.space.id, viewerId)
      if (!refreshed) return reply.code(500).send({ error: 'live_update_failed' })
      return reply.send(await buildLiveMeetingResponse({ access: refreshed, includeModeratorHandles: true, deps }))
    }),
  )

  app.delete('/live/spaces/:spaceId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = SpaceParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (!access.isOwner) return reply.code(403).send({ error: 'forbidden' })

      await prisma.$executeRaw`
        DELETE FROM user_live_space
        WHERE id = ${access.space.id}
      `

      return reply.send({ ok: true })
    }),
  )

  app.get('/users/:handle/live', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = HandleParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const viewerId = (await deps.resolveUserId(req)) ?? null
      await ensureUserLiveTables()

      const handle = params.data.handle.trim().replace(/^@+/, '').toLowerCase()
      const host = await prisma.user.findFirst({
        where: { handle },
        select: { id: true, handle: true, name: true, avatarUrl: true },
      })
      if (!host) return reply.code(404).send({ error: 'user_not_found' })

      const includeArchived = viewerId === host.id
      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          id,
          host_user_id,
          created_by,
          title,
          description,
          cover_url,
          visibility,
          status,
          launch_mode,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          thread_id,
          created_at,
          updated_at
        FROM user_live_space
        WHERE host_user_id = ${host.id}
          ${includeArchived ? Prisma.empty : Prisma.sql`AND status = 'ACTIVE' AND visibility = 'PUBLIC'`}
        ORDER BY
          CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
          updated_at DESC
        LIMIT 200
      `)) as UserLiveSpaceRow[]

      const items = await Promise.all(
        rows.map(async (row) => {
          const access = await resolveSpaceAccessById(row.id, viewerId)
          if (!access) return null
          const payload = await buildLiveMeetingResponse({ access, deps })
          return payload.meeting
        }),
      )

      return reply.send({
        viewer: { canManageMeetings: viewerId === host.id },
        user: {
          id: host.id,
          handle: host.handle,
          name: host.name,
          avatarUrl: deps.normalizeMediaUrl(host.avatarUrl ?? null),
        },
        items: items.filter(Boolean),
      })
    }),
  )

  app.get('/users/:handle/live/:spaceId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = HandleSpaceParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const viewerId = (await deps.resolveUserId(req)) ?? null
      await ensureUserLiveTables()

      const access = await resolveSpaceAccessByHandle({ handleRaw: params.data.handle, spaceId: params.data.spaceId, viewerId })
      if (!access) return reply.code(404).send({ error: 'live_not_found' })

      if (normalizeStatus(access.space.status) !== 'ACTIVE' && !access.canManageMeetings) {
        return reply.code(403).send({ error: 'live_not_published' })
      }
      if (normalizeVisibility(access.space.visibility) === 'PRIVATE' && !access.canManageMeetings) {
        return reply.code(403).send({ error: 'live_private' })
      }

      return reply.send(await buildLiveMeetingResponse({ access, includeWaitingParticipants: true, includeModeratorHandles: true, deps }))
    }),
  )

  app.post('/live/spaces/:spaceId/join', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = SpaceParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = LiveJoinBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      const row = access.space
      if (normalizeStatus(row.status) !== 'ACTIVE' && !access.canManageMeetings) {
        return reply.code(403).send({ error: 'live_not_published' })
      }
      if (normalizeVisibility(row.visibility) === 'PRIVATE' && !access.canManageMeetings) {
        return reply.code(403).send({ error: 'live_private' })
      }
      if (row.requires_password && !access.canManageMeetings) {
        const provided = body.data.password?.trim() || ''
        if (!provided || hashMeetingPassword(provided) !== (row.password_hash ?? '')) {
          return reply.code(403).send({ error: 'invalid_live_password' })
        }
      }

      let threadId = row.thread_id
      if (!threadId) {
        threadId = await ensureUserLiveThread({
          hostUserId: row.host_user_id,
          spaceId: row.id,
          title: row.title,
          ownerUserId: row.host_user_id,
          existingThreadId: null,
        })
        await prisma.$executeRaw`
          UPDATE user_live_space
          SET thread_id = ${threadId}, updated_at = ${new Date()}
          WHERE id = ${row.id}
        `
      }

      type AdmissionLookupRow = { status: string | null }
      const admissionRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT status
        FROM user_live_space_admission
        WHERE space_id = ${row.id}
          AND user_id = ${viewerId}
        LIMIT 1
      `)) as AdmissionLookupRow[]
      const admissionStatus = normalizeAdmissionStatus(admissionRows[0]?.status)
      if (!access.canManageMeetings && admissionStatus === 'DENIED') {
        return reply.code(403).send({ error: 'live_access_denied' })
      }

      type ParticipantLookupRow = { exists: number }
      const participantRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT 1::int as exists
        FROM "MessageParticipant"
        WHERE "threadId" = ${threadId}
          AND "userId" = ${viewerId}
        LIMIT 1
      `)) as ParticipantLookupRow[]
      const isParticipant = Boolean(participantRows[0]?.exists)

      const now = new Date()
      if (row.requires_manual_admit && !access.canManageMeetings && admissionStatus !== 'ADMITTED') {
        await prisma.$executeRaw`
          INSERT INTO user_live_space_admission (space_id, user_id, status, decided_by_user_id, created_at, updated_at)
          VALUES (${row.id}, ${viewerId}, ${'WAITING'}, ${null}, ${now}, ${now})
          ON CONFLICT (space_id, user_id) DO UPDATE
          SET status = ${'WAITING'}, decided_by_user_id = ${null}, updated_at = ${now}
        `
        const refreshed = await resolveSpaceAccessById(row.id, viewerId)
        if (!refreshed) return reply.code(500).send({ error: 'live_join_failed' })
        const payload = await buildLiveMeetingResponse({ access: refreshed, includeWaitingParticipants: true, includeModeratorHandles: true, deps })
        return reply.send({
          state: 'waiting',
          threadId: null,
          ...payload,
        })
      }

      if (!threadId) return reply.code(500).send({ error: 'live_join_failed' })
      const ensuredThreadId: string = threadId

      await ensureThreadParticipant({
        threadId: ensuredThreadId,
        userId: viewerId,
        role: access.canManageMeetings ? 'admin' : 'member',
      })

      await prisma.$executeRaw`
        INSERT INTO user_live_space_admission (space_id, user_id, status, decided_by_user_id, created_at, updated_at)
        VALUES (${row.id}, ${viewerId}, ${'ADMITTED'}, ${access.canManageMeetings ? viewerId : null}, ${now}, ${now})
        ON CONFLICT (space_id, user_id) DO UPDATE
        SET status = ${'ADMITTED'}, decided_by_user_id = ${access.canManageMeetings ? viewerId : null}, updated_at = ${now}
      `

      const refreshed = await resolveSpaceAccessById(row.id, viewerId)
      if (!refreshed) return reply.code(500).send({ error: 'live_join_failed' })
      const payload = await buildLiveMeetingResponse({ access: refreshed, includeWaitingParticipants: true, includeModeratorHandles: true, deps })
      return reply.send({
        state: 'joined',
        threadId,
        ...payload,
      })
    }),
  )

  app.post('/live/spaces/:spaceId/participants/:userId/kick', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })
      const params = LiveParticipantParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (!access.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })
      if (params.data.userId === access.space.host_user_id) return reply.code(400).send({ error: 'cannot_remove_host' })

      if (access.space.thread_id) {
        await prisma.messageParticipant.deleteMany({
          where: { threadId: access.space.thread_id, userId: params.data.userId },
        })
      }
      await prisma.$executeRaw`
        DELETE FROM user_live_space_admission
        WHERE space_id = ${access.space.id}
          AND user_id = ${params.data.userId}
      `
      await prisma.$executeRaw`
        DELETE FROM user_live_space_speaker
        WHERE space_id = ${access.space.id}
          AND user_id = ${params.data.userId}
      `

      const state = await deps.readMeetingRtcRoomState(access.space.id)
      for (const peer of state?.peers ?? []) {
        if (peer.userId === params.data.userId) {
          await deps.disconnectMeetingRtcPeer({ roomId: access.space.id, peerId: peer.peerId, reason: 'removed_from_live' })
        }
      }

      return reply.send({ ok: true })
    }),
  )

  app.post('/live/spaces/:spaceId/participants/:userId/admit', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })
      const params = LiveParticipantParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (!access.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })

      let threadId = access.space.thread_id
      if (!threadId) {
        threadId = await ensureUserLiveThread({
          hostUserId: access.space.host_user_id,
          spaceId: access.space.id,
          title: access.space.title,
          ownerUserId: access.space.host_user_id,
          existingThreadId: null,
        })
        await prisma.$executeRaw`
          UPDATE user_live_space
          SET thread_id = ${threadId}, updated_at = ${new Date()}
          WHERE id = ${access.space.id}
        `
      }

      if (!threadId) return reply.code(500).send({ error: 'live_admit_failed' })

      await ensureThreadParticipant({
        threadId,
        userId: params.data.userId,
        role: 'member',
      })

      await prisma.$executeRaw`
        INSERT INTO user_live_space_admission (space_id, user_id, status, decided_by_user_id, created_at, updated_at)
        VALUES (${access.space.id}, ${params.data.userId}, ${'ADMITTED'}, ${viewerId}, ${new Date()}, ${new Date()})
        ON CONFLICT (space_id, user_id) DO UPDATE
        SET status = ${'ADMITTED'}, decided_by_user_id = ${viewerId}, updated_at = ${new Date()}
      `

      return reply.send({ ok: true })
    }),
  )

  app.post('/live/spaces/:spaceId/participants/:userId/ban', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })
      const params = LiveParticipantParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (!access.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })
      if (params.data.userId === access.space.host_user_id) return reply.code(400).send({ error: 'cannot_ban_host' })

      if (access.space.thread_id) {
        await prisma.messageParticipant.deleteMany({
          where: { threadId: access.space.thread_id, userId: params.data.userId },
        })
      }
      await prisma.$executeRaw`
        INSERT INTO user_live_space_admission (space_id, user_id, status, decided_by_user_id, created_at, updated_at)
        VALUES (${access.space.id}, ${params.data.userId}, ${'DENIED'}, ${viewerId}, ${new Date()}, ${new Date()})
        ON CONFLICT (space_id, user_id) DO UPDATE
        SET status = ${'DENIED'}, decided_by_user_id = ${viewerId}, updated_at = ${new Date()}
      `
      await prisma.$executeRaw`
        DELETE FROM user_live_space_speaker
        WHERE space_id = ${access.space.id}
          AND user_id = ${params.data.userId}
      `

      const state = await deps.readMeetingRtcRoomState(access.space.id)
      for (const peer of state?.peers ?? []) {
        if (peer.userId === params.data.userId) {
          await deps.disconnectMeetingRtcPeer({ roomId: access.space.id, peerId: peer.peerId, reason: 'banned_from_live' })
        }
      }

      return reply.send({ ok: true })
    }),
  )

  app.post('/live/spaces/:spaceId/rtc/session', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = SpaceParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = LiveRtcSessionBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (normalizeStatus(access.space.status) !== 'ACTIVE' && !access.canManageMeetings) {
        return reply.code(403).send({ error: 'live_not_published' })
      }

      let threadId = access.space.thread_id
      if (!threadId) {
        threadId = await ensureUserLiveThread({
          hostUserId: access.space.host_user_id,
          spaceId: access.space.id,
          title: access.space.title,
          ownerUserId: access.space.host_user_id,
          existingThreadId: null,
        })
        await prisma.$executeRaw`
          UPDATE user_live_space
          SET thread_id = ${threadId}, updated_at = ${new Date()}
          WHERE id = ${access.space.id}
        `
      }

      type AdmissionLookupRow = { status: string | null }
      const admissionRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT status
        FROM user_live_space_admission
        WHERE space_id = ${access.space.id}
          AND user_id = ${viewerId}
        LIMIT 1
      `)) as AdmissionLookupRow[]
      const admissionStatus = normalizeAdmissionStatus(admissionRows[0]?.status)
      type ParticipantLookupRow = { exists: number }
      const participantRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT 1::int as exists
        FROM "MessageParticipant"
        WHERE "threadId" = ${threadId}
          AND "userId" = ${viewerId}
        LIMIT 1
      `)) as ParticipantLookupRow[]
      const isParticipant = Boolean(participantRows[0]?.exists)

      if (!access.canManageMeetings && !isParticipant && admissionStatus !== 'ADMITTED') {
        return reply.code(403).send({ error: 'live_not_joined' })
      }

      const user = await prisma.user.findUnique({
        where: { id: viewerId },
        select: { id: true, name: true, handle: true },
      })
      if (!user) return reply.code(404).send({ error: 'user_not_found' })
      const displayName = body.data.displayName?.trim() || user.name?.trim() || user.handle || 'Civil user'

      const rtc = await deps.issueMeetingRtcSession({
        roomId: access.space.id,
        userId: viewerId,
        role: access.canManageMeetings ? 'manager' : 'participant',
        displayName,
        deviceId: body.data.deviceId ?? null,
        capabilities: body.data.capabilities ?? null,
      })

      if ('error' in rtc) {
        const statusCode =
          typeof rtc.statusCode === 'number' && rtc.statusCode >= 400
            ? rtc.statusCode
            : rtc.error === 'meeting_rtc_not_configured'
              ? 503
              : rtc.error === 'meeting_rtc_timeout'
                ? 504
                : 502
        return reply.code(statusCode).send({ error: rtc.error })
      }

      return reply.send(rtc.session)
    }),
  )

  app.post('/live/spaces/:spaceId/speakers/request', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = SpaceParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (access.canManageMeetings) return reply.code(400).send({ error: 'managers_do_not_request_speaker' })

      type AdmissionLookupRow = { status: string | null }
      const admissionRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT status
        FROM user_live_space_admission
        WHERE space_id = ${access.space.id}
          AND user_id = ${viewerId}
        LIMIT 1
      `)) as AdmissionLookupRow[]
      const admissionStatus = normalizeAdmissionStatus(admissionRows[0]?.status)
      if (admissionStatus !== 'ADMITTED') {
        return reply.code(403).send({ error: 'live_not_joined' })
      }

      await prisma.$executeRaw`
        INSERT INTO user_live_space_speaker (space_id, user_id, status, requested_by_user_id, decided_by_user_id, created_at, updated_at)
        VALUES (${access.space.id}, ${viewerId}, ${'REQUESTED'}, ${viewerId}, ${null}, ${new Date()}, ${new Date()})
        ON CONFLICT (space_id, user_id) DO UPDATE
        SET status = ${'REQUESTED'}, requested_by_user_id = ${viewerId}, decided_by_user_id = ${null}, updated_at = ${new Date()}
      `

      return reply.send({ ok: true })
    }),
  )

  app.post('/live/spaces/:spaceId/speakers/:userId/approve', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = LiveSpeakerParticipantParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (!access.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })
      if (params.data.userId === access.space.host_user_id) return reply.code(400).send({ error: 'host_is_already_speaker' })

      await prisma.$executeRaw`
        INSERT INTO user_live_space_speaker (space_id, user_id, status, requested_by_user_id, decided_by_user_id, created_at, updated_at)
        VALUES (${access.space.id}, ${params.data.userId}, ${'APPROVED'}, ${null}, ${viewerId}, ${new Date()}, ${new Date()})
        ON CONFLICT (space_id, user_id) DO UPDATE
        SET status = ${'APPROVED'}, decided_by_user_id = ${viewerId}, updated_at = ${new Date()}
      `

      return reply.send({ ok: true })
    }),
  )

  app.post('/live/spaces/:spaceId/speakers/:userId/decline', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = LiveSpeakerParticipantParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (!access.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })

      await prisma.$executeRaw`
        INSERT INTO user_live_space_speaker (space_id, user_id, status, requested_by_user_id, decided_by_user_id, created_at, updated_at)
        VALUES (${access.space.id}, ${params.data.userId}, ${'DECLINED'}, ${null}, ${viewerId}, ${new Date()}, ${new Date()})
        ON CONFLICT (space_id, user_id) DO UPDATE
        SET status = ${'DECLINED'}, decided_by_user_id = ${viewerId}, updated_at = ${new Date()}
      `

      return reply.send({ ok: true })
    }),
  )

  app.post('/live/spaces/:spaceId/leave', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = SpaceParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (access.isOwner) return reply.code(400).send({ error: 'owner_must_end_live' })

      if (access.space.thread_id) {
        await prisma.messageParticipant.deleteMany({
          where: { threadId: access.space.thread_id, userId: viewerId },
        })
      }

      const state = await deps.readMeetingRtcRoomState(access.space.id)
      for (const peer of state?.peers ?? []) {
        if (peer.userId === viewerId) {
          await deps.disconnectMeetingRtcPeer({ roomId: access.space.id, peerId: peer.peerId, reason: 'left_live' })
        }
      }

      return reply.send({ ok: true })
    }),
  )

  app.post('/live/spaces/:spaceId/end', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const viewerId = (await deps.resolveUserId(req)) ?? null
      if (!viewerId) return reply.code(401).send({ error: 'unauthorized' })

      const params = SpaceParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      await ensureUserLiveTables()

      const access = await resolveSpaceAccessById(params.data.spaceId, viewerId)
      if (!access) return reply.code(404).send({ error: 'live_not_found' })
      if (!access.isOwner) return reply.code(403).send({ error: 'forbidden' })

      await prisma.$executeRaw`
        UPDATE user_live_space
        SET status = ${'ARCHIVED'}, updated_at = ${new Date()}
        WHERE id = ${access.space.id}
      `

      const state = await deps.readMeetingRtcRoomState(access.space.id)
      for (const peer of state?.peers ?? []) {
        await deps.disconnectMeetingRtcPeer({ roomId: access.space.id, peerId: peer.peerId, reason: 'live_ended' })
      }

      return reply.send({ ok: true })
    }),
  )
}
