import { randomUUID } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

type OrganizationGovernanceMeetingsDeps = Record<string, any>

type OrganizationMeetingRow = {
  id: string
  business_id: string
  created_by: string | null
  title: string
  description: string | null
  visibility: string
  status: string
  requires_password: boolean
  password_hash: string | null
  requires_manual_admit: boolean
  max_participants: number | null
  schedule_starts_at: Date | null
  schedule_ends_at: Date | null
  thread_id: string | null
  created_at: Date
  updated_at: Date
}

type OrganizationMeetingAssignmentRow = {
  meeting_id: string
  user_id: string
}

type OrganizationMeetingAdmissionStatus = 'WAITING' | 'ADMITTED' | 'DENIED'

type OrganizationMeetingAdmissionRow = {
  meeting_id: string
  user_id: string
  status: string
}

type OrganizationMeetingWaitingParticipant = {
  userId: string
  status: OrganizationMeetingAdmissionStatus
  name: string
  handle: string | null
  avatarUrl: string | null
}

export function registerOrganizationGovernanceMeetingsRoutes(
  app: FastifyInstance,
  deps: OrganizationGovernanceMeetingsDeps,
) {
  app.get('/communities/:province/:municipality/orgs/:slug/governance/state', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const province = deps.normalizeProvinceCode(params.data.province)
      if (!province) return reply.code(404).send({ error: 'province_not_found' })
      const community = deps.findCommunity(province, params.data.municipality.trim().toLowerCase())
      if (!community) return reply.code(404).send({ error: 'community_not_found' })

      const org = await prisma.business.findFirst({
        where: { provinceCode: province, communitySlug: community.slug, slug: params.data.slug.trim().toLowerCase() },
        select: { id: true, ownerId: true, metadata: true },
      })
      if (!org) return reply.code(404).send({ error: 'organization_not_found' })

      const viewerId = (await deps.resolveUserId(req)) ?? null
      const membership = viewerId
        ? await prisma.businessMembership.findUnique({
            where: { businessId_userId: { businessId: org.id, userId: viewerId } },
            select: { role: true },
          })
        : null

      const viewerRole: 'OWNER' | 'MANAGER' | null = viewerId
        ? org.ownerId === viewerId
          ? 'OWNER'
          : membership?.role === 'MANAGER'
            ? 'MANAGER'
            : null
        : null

      const system = deps.readOrganizationSystemState(org.metadata)
      const permissions = deps.resolveOrganizationPermissions({
        org: { ownerId: org.ownerId },
        role: viewerRole,
        system,
        userId: viewerId,
      })

      const rawIncludeDrafts = (req.query as Record<string, unknown> | undefined)?.includeDrafts
      const wantsDrafts = rawIncludeDrafts === '1' || rawIncludeDrafts === 'true'
      const canSeeDrafts = Boolean(viewerId && deps.canOrganizationPermission(permissions, 'manage_events'))
      const events = wantsDrafts && canSeeDrafts
        ? system.events
        : system.events.filter((event: { status?: string | null }) => (event?.status ?? 'PUBLISHED') === 'PUBLISHED')

      return reply.send({
        state: {
          joinMode: system.joinMode,
          ranks: system.ranks,
          plans: system.plans,
          sponsors: system.sponsors,
          events,
          achievements: system.achievements,
          achievementAwards: system.achievementAwards,
          referrals: system.referrals,
          reputationLedger: system.reputationLedger,
          eventRsvps: system.eventRsvps,
          economics: system.economics,
        },
        viewer: {
          userId: viewerId,
          role: viewerRole,
          permissions,
          memberState: viewerId ? system.members[viewerId] ?? null : null,
        },
      })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/meetings', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const viewerId = (await deps.resolveUserId(req)) ?? null
      const access = await deps.resolveOrganizationMeetingAccess({
        provinceRaw: params.data.province,
        municipalityRaw: params.data.municipality,
        slugRaw: params.data.slug,
        viewerId,
      })
      if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })

      await deps.ensureOrganizationMeetingTables()

      const rawIncludeArchived = (req.query as Record<string, unknown> | undefined)?.includeArchived
      const wantsArchived =
        rawIncludeArchived === '1' ||
        rawIncludeArchived === 'true' ||
        rawIncludeArchived === 1 ||
        rawIncludeArchived === true
      const includeArchived = wantsArchived && access.value.canManageMeetings

      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          id,
          business_id,
          created_by,
          title,
          description,
          visibility,
          status,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          schedule_starts_at,
          schedule_ends_at,
          thread_id,
          created_at,
          updated_at
        FROM organization_meeting
        WHERE business_id = ${access.value.org.id}
        ${includeArchived ? Prisma.empty : Prisma.sql`AND status = 'ACTIVE'`}
        ${
          access.value.canManageMeetings || access.value.isAssociated
            ? Prisma.empty
            : Prisma.sql`AND visibility = 'PUBLIC'`
        }
        ORDER BY
          CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
          COALESCE(schedule_starts_at, updated_at) ASC,
          updated_at DESC
        LIMIT 200
      `)) as OrganizationMeetingRow[]

      if (!rows.length) {
        return reply.send({
          viewer: { canManageMeetings: access.value.canManageMeetings },
          items: [],
        })
      }

      const meetingIds = rows.map((row) => row.id)
      const threadIds = Array.from(new Set(rows.map((row) => row.thread_id).filter((value): value is string => Boolean(value))))

      type ThreadParticipantCountRow = { thread_id: string; count: number }
      const participantRows = threadIds.length
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT "threadId" as thread_id, COUNT(*)::int as count
            FROM "MessageParticipant"
            WHERE "threadId" IN (${Prisma.join(threadIds)})
            GROUP BY "threadId"
          `)) as ThreadParticipantCountRow[])
        : []
      const participantCountByThreadId = new Map<string, number>(
        participantRows.map((row) => [row.thread_id, Number(row.count) || 0]),
      )

      const assignedRows = viewerId
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT meeting_id, user_id
            FROM organization_meeting_assignment
            WHERE user_id = ${viewerId}
              AND meeting_id IN (${Prisma.join(meetingIds)})
          `)) as OrganizationMeetingAssignmentRow[])
        : []
      const assignedMeetingIds = new Set(assignedRows.map((row) => row.meeting_id))

      const admissionRows = viewerId
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT meeting_id, user_id, status
            FROM organization_meeting_admission
            WHERE user_id = ${viewerId}
              AND meeting_id IN (${Prisma.join(meetingIds)})
          `)) as OrganizationMeetingAdmissionRow[])
        : []
      const admissionByMeetingId = new Map<string, OrganizationMeetingAdmissionStatus | null>(
        admissionRows.map((row) => [row.meeting_id, deps.normalizeMeetingAdmissionStatus(row.status)]),
      )

      type ViewerParticipantRow = { thread_id: string }
      const viewerParticipantRows = viewerId && threadIds.length
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT "threadId" as thread_id
            FROM "MessageParticipant"
            WHERE "userId" = ${viewerId}
              AND "threadId" IN (${Prisma.join(threadIds)})
          `)) as ViewerParticipantRow[])
        : []
      const viewerThreadIds = new Set(viewerParticipantRows.map((row) => row.thread_id))

      const items = rows.map((row) =>
        deps.mapMeetingRowForViewer({
          row,
          participantCount: row.thread_id ? participantCountByThreadId.get(row.thread_id) ?? 0 : 0,
          canManageMeetings: access.value.canManageMeetings,
          isAssociated: access.value.isAssociated,
          isAssigned: assignedMeetingIds.has(row.id),
          isParticipant: row.thread_id ? viewerThreadIds.has(row.thread_id) : false,
          admissionStatus: admissionByMeetingId.get(row.id) ?? null,
        }),
      )

      return reply.send({
        viewer: { canManageMeetings: access.value.canManageMeetings },
        items,
      })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/meetings', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgSlugParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgMeetingCreateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const access = await deps.resolveOrganizationMeetingAccess({
        provinceRaw: params.data.province,
        municipalityRaw: params.data.municipality,
        slugRaw: params.data.slug,
        viewerId: userId,
      })
      if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })
      if (!access.value.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })

      await deps.ensureOrganizationMeetingTables()

      const meetingId = `meeting_${randomUUID().replace(/-/g, '').slice(0, 14)}`
      const title = deps.sanitizePlainText(body.data.title).trim() || 'Untitled meeting'
      const description = body.data.description ? deps.sanitizePlainText(body.data.description).trim() || null : null
      const visibility = body.data.visibility
      const status = body.data.status
      const requiresPassword = body.data.requiresPassword
      const passwordHash = requiresPassword && body.data.password ? deps.hashMeetingPassword(body.data.password.trim()) : null
      const requiresManualAdmit = body.data.requiresManualAdmit
      const maxParticipants = deps.normalizeMeetingMaxParticipants(body.data.maxParticipants)
      const startsAt = body.data.schedule?.startsAt ? new Date(body.data.schedule.startsAt) : null
      const endsAt = body.data.schedule?.endsAt ? new Date(body.data.schedule.endsAt) : null
      const now = new Date()

      const threadId = await deps.ensureOrganizationMeetingThread({
        orgId: access.value.org.id,
        meetingId,
        title,
        ownerUserId: userId,
        existingThreadId: null,
      })

      await prisma.$executeRaw`
        INSERT INTO organization_meeting (
          id,
          business_id,
          created_by,
          title,
          description,
          visibility,
          status,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          schedule_starts_at,
          schedule_ends_at,
          thread_id,
          created_at,
          updated_at
        )
        VALUES (
          ${meetingId},
          ${access.value.org.id},
          ${userId},
          ${title},
          ${description},
          ${visibility},
          ${status},
          ${requiresPassword},
          ${passwordHash},
          ${requiresManualAdmit},
          ${maxParticipants},
          ${startsAt},
          ${endsAt},
          ${threadId},
          ${now},
          ${now}
        )
      `

      const assignedIds = Array.from(new Set((body.data.assignedMemberUserIds ?? []).map((value: string) => value.trim()).filter(Boolean)))
      for (const assignedUserId of assignedIds) {
        await prisma.$executeRaw`
          INSERT INTO organization_meeting_assignment (meeting_id, user_id, created_at)
          VALUES (${meetingId}, ${assignedUserId}, ${now})
          ON CONFLICT (meeting_id, user_id) DO NOTHING
        `
      }

      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          id,
          business_id,
          created_by,
          title,
          description,
          visibility,
          status,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          schedule_starts_at,
          schedule_ends_at,
          thread_id,
          created_at,
          updated_at
        FROM organization_meeting
        WHERE id = ${meetingId}
        LIMIT 1
      `)) as OrganizationMeetingRow[]
      const row = rows[0]
      if (!row) return reply.code(500).send({ error: 'meeting_create_failed' })

      const meeting = deps.mapMeetingRowForViewer({
        row,
        participantCount: 1,
        canManageMeetings: true,
        isAssociated: true,
        isAssigned: false,
        isParticipant: true,
        admissionStatus: 'ADMITTED',
      })

      return reply.code(201).send({ meeting })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/meetings/:meetingId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const params = deps.CommunityOrgMeetingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const viewerId = (await deps.resolveUserId(req)) ?? null
      const access = await deps.resolveOrganizationMeetingAccess({
        provinceRaw: params.data.province,
        municipalityRaw: params.data.municipality,
        slugRaw: params.data.slug,
        viewerId,
      })
      if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })

      await deps.ensureOrganizationMeetingTables()

      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          id,
          business_id,
          created_by,
          title,
          description,
          visibility,
          status,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          schedule_starts_at,
          schedule_ends_at,
          thread_id,
          created_at,
          updated_at
        FROM organization_meeting
        WHERE id = ${params.data.meetingId}
          AND business_id = ${access.value.org.id}
        LIMIT 1
      `)) as OrganizationMeetingRow[]
      const row = rows[0]
      if (!row) return reply.code(404).send({ error: 'meeting_not_found' })

      const assignedRows = viewerId
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT meeting_id, user_id
            FROM organization_meeting_assignment
            WHERE meeting_id = ${row.id}
              AND user_id = ${viewerId}
            LIMIT 1
          `)) as OrganizationMeetingAssignmentRow[])
        : []
      const isAssigned = Boolean(assignedRows[0])

      const admissionRows = viewerId
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT meeting_id, user_id, status
            FROM organization_meeting_admission
            WHERE meeting_id = ${row.id}
              AND user_id = ${viewerId}
            LIMIT 1
          `)) as OrganizationMeetingAdmissionRow[])
        : []
      const admissionStatus = deps.normalizeMeetingAdmissionStatus(admissionRows[0]?.status)

      type ThreadParticipantCountRow = { count: number }
      const participantCountRows = row.thread_id
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT COUNT(*)::int as count
            FROM "MessageParticipant"
            WHERE "threadId" = ${row.thread_id}
          `)) as ThreadParticipantCountRow[])
        : [{ count: 0 }]
      const participantCount = Number(participantCountRows[0]?.count || 0)

      type ViewerParticipantRow = { exists: number }
      const viewerParticipantRows = viewerId && row.thread_id
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT 1::int as exists
            FROM "MessageParticipant"
            WHERE "threadId" = ${row.thread_id}
              AND "userId" = ${viewerId}
            LIMIT 1
          `)) as ViewerParticipantRow[])
        : []
      const isParticipant = Boolean(viewerParticipantRows[0]?.exists)

      const meeting = deps.mapMeetingRowForViewer({
        row,
        participantCount,
        canManageMeetings: access.value.canManageMeetings,
        isAssociated: access.value.isAssociated,
        isAssigned,
        isParticipant,
        admissionStatus,
      })

      if (
        !access.value.canManageMeetings &&
        deps.normalizeMeetingVisibility(row.visibility) === 'PRIVATE' &&
        !access.value.isAssociated &&
        !isAssigned
      ) {
        return reply.code(403).send({ error: 'meeting_not_assigned' })
      }
      if (!access.value.canManageMeetings && deps.normalizeMeetingStatus(row.status) !== 'ACTIVE') {
        return reply.code(404).send({ error: 'meeting_not_found' })
      }

      const rtcState = await deps.readMeetingRtcRoomState(row.id)

      type WaitingParticipantRow = {
        user_id: string
        status: string
        name: string | null
        handle: string | null
        avatar_url: string | null
      }

      let waitingParticipants: OrganizationMeetingWaitingParticipant[] = []
      if (access.value.canManageMeetings && viewerId) {
        const waitingRows = (await prisma.$queryRaw(Prisma.sql`
          SELECT
            admission.user_id,
            admission.status,
            "User"."name" as name,
            "User"."handle" as handle,
            "User"."avatarUrl" as avatar_url
          FROM organization_meeting_admission admission
          LEFT JOIN "User" ON "User"."id" = admission.user_id
          WHERE admission.meeting_id = ${row.id}
            AND admission.user_id <> ${viewerId}
            AND admission.status IN ('WAITING', 'ADMITTED')
          ORDER BY
            CASE admission.status
              WHEN 'WAITING' THEN 0
              ELSE 1
            END ASC,
            admission.updated_at ASC
          LIMIT 50
        `)) as WaitingParticipantRow[]

        waitingParticipants = waitingRows
          .map((entry): OrganizationMeetingWaitingParticipant | null => {
            const status = deps.normalizeMeetingAdmissionStatus(entry.status)
            if (!status) return null
            const userId = typeof entry.user_id === 'string' ? entry.user_id : ''
            if (!userId) return null
            const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Civil member'
            const handle = typeof entry.handle === 'string' && entry.handle.trim() ? entry.handle.trim() : null
            const avatarUrl = typeof entry.avatar_url === 'string' && entry.avatar_url.trim() ? entry.avatar_url.trim() : null
            return { userId, status, name, handle, avatarUrl }
          })
          .filter((entry): entry is OrganizationMeetingWaitingParticipant => Boolean(entry))
      }

      return reply.send({
        meeting: {
          ...meeting,
          rtc: rtcState
            ? {
                peerCount: rtcState.peerCount,
                hostPresent: rtcState.hostPresent,
              }
            : null,
          waitingParticipants,
        },
        viewer: { canManageMeetings: access.value.canManageMeetings },
      })
    }),
  )

  app.get('/communities/:province/:municipality/orgs/:slug/governance/meetings/:meetingId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgMeetingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const access = await deps.resolveOrganizationMeetingAccess({
        provinceRaw: params.data.province,
        municipalityRaw: params.data.municipality,
        slugRaw: params.data.slug,
        viewerId: userId,
      })
      if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })
      if (!access.value.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })

      await deps.ensureOrganizationMeetingTables()

      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          id,
          business_id,
          created_by,
          title,
          description,
          visibility,
          status,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          schedule_starts_at,
          schedule_ends_at,
          thread_id,
          created_at,
          updated_at
        FROM organization_meeting
        WHERE id = ${params.data.meetingId}
          AND business_id = ${access.value.org.id}
        LIMIT 1
      `)) as OrganizationMeetingRow[]
      const row = rows[0]
      if (!row) return reply.code(404).send({ error: 'meeting_not_found' })

      type ThreadParticipantCountRow = { count: number }
      const participantCountRows = row.thread_id
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT COUNT(*)::int as count
            FROM "MessageParticipant"
            WHERE "threadId" = ${row.thread_id}
          `)) as ThreadParticipantCountRow[])
        : [{ count: 0 }]
      const participantCount = Number(participantCountRows[0]?.count || 0)

      type AdmissionLookupRow = { status: string | null }
      const admissionRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT status
        FROM organization_meeting_admission
        WHERE meeting_id = ${row.id}
          AND user_id = ${userId}
        LIMIT 1
      `)) as AdmissionLookupRow[]
      const admissionStatus = deps.normalizeMeetingAdmissionStatus(admissionRows[0]?.status)

      type ViewerParticipantRow = { exists: number }
      const viewerParticipantRows = row.thread_id
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT 1::int as exists
            FROM "MessageParticipant"
            WHERE "threadId" = ${row.thread_id}
              AND "userId" = ${userId}
            LIMIT 1
          `)) as ViewerParticipantRow[])
        : []
      const isParticipant = Boolean(viewerParticipantRows[0]?.exists)

      const meeting = deps.mapMeetingRowForViewer({
        row,
        participantCount,
        canManageMeetings: true,
        isAssociated: true,
        isAssigned: false,
        isParticipant,
        admissionStatus,
      })

      const rtcState = await deps.readMeetingRtcRoomState(row.id)
      return reply.send({
        meeting: {
          ...meeting,
          rtc: rtcState
            ? {
                peerCount: rtcState.peerCount,
                hostPresent: rtcState.hostPresent,
              }
            : null,
        },
        viewer: { canManageMeetings: true },
      })
    }),
  )

  app.put('/communities/:province/:municipality/orgs/:slug/governance/meetings/:meetingId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgMeetingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgMeetingUpdateBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const access = await deps.resolveOrganizationMeetingAccess({
        provinceRaw: params.data.province,
        municipalityRaw: params.data.municipality,
        slugRaw: params.data.slug,
        viewerId: userId,
      })
      if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })
      if (!access.value.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })

      await deps.ensureOrganizationMeetingTables()

      const existingRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          id,
          business_id,
          created_by,
          title,
          description,
          visibility,
          status,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          schedule_starts_at,
          schedule_ends_at,
          thread_id,
          created_at,
          updated_at
        FROM organization_meeting
        WHERE id = ${params.data.meetingId}
          AND business_id = ${access.value.org.id}
        LIMIT 1
      `)) as OrganizationMeetingRow[]
      const existing = existingRows[0]
      if (!existing) return reply.code(404).send({ error: 'meeting_not_found' })

      const nextTitle = body.data.title === undefined ? existing.title : deps.sanitizePlainText(body.data.title).trim() || 'Untitled meeting'
      const nextDescription =
        body.data.description === undefined
          ? existing.description
          : body.data.description
            ? deps.sanitizePlainText(body.data.description).trim() || null
            : null
      const nextVisibility = body.data.visibility ?? deps.normalizeMeetingVisibility(existing.visibility)
      const nextStatus = body.data.status ?? deps.normalizeMeetingStatus(existing.status)
      const nextRequiresManualAdmit =
        body.data.requiresManualAdmit === undefined ? Boolean(existing.requires_manual_admit) : body.data.requiresManualAdmit
      const nextMaxParticipants = deps.normalizeMeetingMaxParticipants(
        body.data.maxParticipants === undefined ? existing.max_participants : body.data.maxParticipants,
      )

      const nextRequiresPassword =
        body.data.requiresPassword === undefined ? Boolean(existing.requires_password) : body.data.requiresPassword
      let nextPasswordHash = existing.password_hash
      if (nextRequiresPassword) {
        if (typeof body.data.password === 'string' && body.data.password.trim()) {
          nextPasswordHash = deps.hashMeetingPassword(body.data.password.trim())
        }
        if (!nextPasswordHash) return reply.code(400).send({ error: 'password_required' })
      } else {
        nextPasswordHash = null
      }

      let nextStartsAt = existing.schedule_starts_at
      let nextEndsAt = existing.schedule_ends_at
      if (body.data.schedule !== undefined) {
        nextStartsAt = body.data.schedule?.startsAt ? new Date(body.data.schedule.startsAt) : null
        nextEndsAt = body.data.schedule?.endsAt ? new Date(body.data.schedule.endsAt) : null
      }

      const now = new Date()
      await prisma.$executeRaw`
        UPDATE organization_meeting
        SET
          title = ${nextTitle},
          description = ${nextDescription},
          visibility = ${nextVisibility},
          status = ${nextStatus},
          requires_password = ${nextRequiresPassword},
          password_hash = ${nextPasswordHash},
          requires_manual_admit = ${nextRequiresManualAdmit},
          max_participants = ${nextMaxParticipants},
          schedule_starts_at = ${nextStartsAt},
          schedule_ends_at = ${nextEndsAt},
          updated_at = ${now}
        WHERE id = ${existing.id}
      `

      if (body.data.assignedMemberUserIds !== undefined) {
        const assignedIds = Array.from(new Set(body.data.assignedMemberUserIds.map((value: string) => value.trim()).filter(Boolean)))
        await prisma.$executeRaw`
          DELETE FROM organization_meeting_assignment
          WHERE meeting_id = ${existing.id}
        `
        for (const assignedUserId of assignedIds) {
          await prisma.$executeRaw`
            INSERT INTO organization_meeting_assignment (meeting_id, user_id, created_at)
            VALUES (${existing.id}, ${assignedUserId}, ${now})
            ON CONFLICT (meeting_id, user_id) DO NOTHING
          `
        }
      }

      const refreshedRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          id,
          business_id,
          created_by,
          title,
          description,
          visibility,
          status,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          schedule_starts_at,
          schedule_ends_at,
          thread_id,
          created_at,
          updated_at
        FROM organization_meeting
        WHERE id = ${existing.id}
        LIMIT 1
      `)) as OrganizationMeetingRow[]
      const refreshed = refreshedRows[0]
      if (!refreshed) return reply.code(500).send({ error: 'meeting_save_failed' })

      type ThreadParticipantCountRow = { count: number }
      const participantCountRows = refreshed.thread_id
        ? ((await prisma.$queryRaw(Prisma.sql`
            SELECT COUNT(*)::int as count
            FROM "MessageParticipant"
            WHERE "threadId" = ${refreshed.thread_id}
          `)) as ThreadParticipantCountRow[])
        : [{ count: 0 }]
      const participantCount = Number(participantCountRows[0]?.count || 0)

      const meeting = deps.mapMeetingRowForViewer({
        row: refreshed,
        participantCount,
        canManageMeetings: true,
        isAssociated: true,
        isAssigned: false,
        isParticipant: true,
        admissionStatus: 'ADMITTED',
      })

      return reply.send({ meeting })
    }),
  )

  app.delete('/communities/:province/:municipality/orgs/:slug/governance/meetings/:meetingId', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgMeetingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      const access = await deps.resolveOrganizationMeetingAccess({
        provinceRaw: params.data.province,
        municipalityRaw: params.data.municipality,
        slugRaw: params.data.slug,
        viewerId: userId,
      })
      if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })
      if (!access.value.canManageMeetings) return reply.code(403).send({ error: 'forbidden' })

      await deps.ensureOrganizationMeetingTables()

      const deleted = await prisma.$executeRaw`
        DELETE FROM organization_meeting
        WHERE id = ${params.data.meetingId}
          AND business_id = ${access.value.org.id}
      `
      if (Number(deleted) <= 0) return reply.code(404).send({ error: 'meeting_not_found' })

      return reply.send({ ok: true })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/governance/meetings/:meetingId/join', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgMeetingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgMeetingJoinBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const access = await deps.resolveOrganizationMeetingAccess({
        provinceRaw: params.data.province,
        municipalityRaw: params.data.municipality,
        slugRaw: params.data.slug,
        viewerId: userId,
      })
      if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })

      await deps.ensureOrganizationMeetingTables()

      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          id,
          business_id,
          created_by,
          title,
          description,
          visibility,
          status,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          schedule_starts_at,
          schedule_ends_at,
          thread_id,
          created_at,
          updated_at
        FROM organization_meeting
        WHERE id = ${params.data.meetingId}
          AND business_id = ${access.value.org.id}
        LIMIT 1
      `)) as OrganizationMeetingRow[]
      const row = rows[0]
      if (!row) return reply.code(404).send({ error: 'meeting_not_found' })

      const assignedRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT meeting_id, user_id
        FROM organization_meeting_assignment
        WHERE meeting_id = ${row.id}
          AND user_id = ${userId}
        LIMIT 1
      `)) as OrganizationMeetingAssignmentRow[]
      const isAssigned = Boolean(assignedRows[0])

      const admissionRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT meeting_id, user_id, status
        FROM organization_meeting_admission
        WHERE meeting_id = ${row.id}
          AND user_id = ${userId}
        LIMIT 1
      `)) as OrganizationMeetingAdmissionRow[]
      const admissionStatus = deps.normalizeMeetingAdmissionStatus(admissionRows[0]?.status)

      const status = deps.normalizeMeetingStatus(row.status)
      const visibility = deps.normalizeMeetingVisibility(row.visibility)

      if (!access.value.canManageMeetings && status !== 'ACTIVE') {
        return reply.code(403).send({ error: 'meeting_not_published' })
      }
      if (!access.value.canManageMeetings && visibility === 'PRIVATE' && !access.value.isAssociated && !isAssigned) {
        return reply.code(403).send({ error: 'meeting_not_assigned' })
      }

      if (row.requires_password && !access.value.canManageMeetings) {
        const provided = body.data.password?.trim() ?? ''
        if (!provided || !row.password_hash || deps.hashMeetingPassword(provided) !== row.password_hash) {
          return reply.code(403).send({ error: 'invalid_meeting_password' })
        }
      }

      if (row.schedule_starts_at && Date.now() < new Date(row.schedule_starts_at).getTime()) {
        return reply.code(403).send({ error: 'meeting_not_started' })
      }
      if (row.schedule_ends_at && Date.now() > new Date(row.schedule_ends_at).getTime()) {
        return reply.code(403).send({ error: 'meeting_ended' })
      }

      let threadId = row.thread_id
      if (!threadId) {
        threadId = await deps.ensureOrganizationMeetingThread({
          orgId: access.value.org.id,
          meetingId: row.id,
          title: row.title,
          ownerUserId: access.value.org.ownerId,
        })
        await prisma.$executeRaw`
          UPDATE organization_meeting
          SET thread_id = ${threadId}, updated_at = ${new Date()}
          WHERE id = ${row.id}
        `
      }

      const now = new Date()
      if (row.requires_manual_admit && !access.value.canManageMeetings && admissionStatus !== 'ADMITTED') {
        await prisma.$executeRaw`
          INSERT INTO organization_meeting_admission (meeting_id, user_id, status, decided_by_user_id, created_at, updated_at)
          VALUES (${row.id}, ${userId}, ${'WAITING'}, ${null}, ${now}, ${now})
          ON CONFLICT (meeting_id, user_id)
          DO UPDATE SET status = EXCLUDED.status, decided_by_user_id = NULL, updated_at = EXCLUDED.updated_at
        `
        const meeting = deps.mapMeetingRowForViewer({
          row: { ...row, thread_id: threadId },
          participantCount: 0,
          canManageMeetings: access.value.canManageMeetings,
          isAssociated: access.value.isAssociated,
          isAssigned,
          isParticipant: false,
          admissionStatus: 'WAITING',
        })
        const rtcState = await deps.readMeetingRtcRoomState(row.id)
        return reply.send({
          state: 'waiting',
          threadId: null,
          meeting: {
            ...meeting,
            rtc: rtcState
              ? {
                  peerCount: rtcState.peerCount,
                  hostPresent: rtcState.hostPresent,
                }
              : null,
          },
        })
      }

      await prisma.messageParticipant.upsert({
        where: {
          threadId_userId: {
            threadId,
            userId,
          },
        },
        create: {
          threadId,
          userId,
          role: access.value.canManageMeetings ? deps.MessageParticipantRole.admin : deps.MessageParticipantRole.member,
          lastActivityAt: now,
        },
        update: {
          lastActivityAt: now,
        },
      })

      await prisma.$executeRaw`
        INSERT INTO organization_meeting_admission (meeting_id, user_id, status, decided_by_user_id, created_at, updated_at)
        VALUES (${row.id}, ${userId}, ${'ADMITTED'}, ${access.value.canManageMeetings ? userId : null}, ${now}, ${now})
        ON CONFLICT (meeting_id, user_id)
        DO UPDATE SET status = EXCLUDED.status, decided_by_user_id = EXCLUDED.decided_by_user_id, updated_at = EXCLUDED.updated_at
      `

      type ThreadParticipantCountRow = { count: number }
      const participantCountRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(*)::int as count
        FROM "MessageParticipant"
        WHERE "threadId" = ${threadId}
      `)) as ThreadParticipantCountRow[]
      const participantCount = Number(participantCountRows[0]?.count || 0)

      const meeting = deps.mapMeetingRowForViewer({
        row: { ...row, thread_id: threadId },
        participantCount,
        canManageMeetings: access.value.canManageMeetings,
        isAssociated: access.value.isAssociated,
        isAssigned,
        isParticipant: true,
        admissionStatus: 'ADMITTED',
      })

      const rtcState = await deps.readMeetingRtcRoomState(row.id)
      return reply.send({
        state: 'joined',
        threadId,
        meeting: {
          ...meeting,
          rtc: rtcState
            ? {
                peerCount: rtcState.peerCount,
                hostPresent: rtcState.hostPresent,
              }
            : null,
        },
      })
    }),
  )

  app.post('/communities/:province/:municipality/orgs/:slug/meetings/:meetingId/rtc/session', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (await deps.resolveUserId(req)) ?? null
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const params = deps.CommunityOrgMeetingParams.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
      const body = deps.CommunityOrgMeetingRtcSessionBody.safeParse(req.body ?? {})
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

      const access = await deps.resolveOrganizationMeetingAccess({
        provinceRaw: params.data.province,
        municipalityRaw: params.data.municipality,
        slugRaw: params.data.slug,
        viewerId: userId,
      })
      if (!access.ok) return reply.code(access.statusCode).send({ error: access.error })

      await deps.ensureOrganizationMeetingTables()

      const rows = (await prisma.$queryRaw(Prisma.sql`
        SELECT
          id,
          business_id,
          created_by,
          title,
          description,
          visibility,
          status,
          requires_password,
          password_hash,
          requires_manual_admit,
          max_participants,
          schedule_starts_at,
          schedule_ends_at,
          thread_id,
          created_at,
          updated_at
        FROM organization_meeting
        WHERE id = ${params.data.meetingId}
          AND business_id = ${access.value.org.id}
        LIMIT 1
      `)) as OrganizationMeetingRow[]
      const row = rows[0]
      if (!row) return reply.code(404).send({ error: 'meeting_not_found' })
      if (deps.normalizeMeetingStatus(row.status) !== 'ACTIVE' && !access.value.canManageMeetings) {
        return reply.code(403).send({ error: 'meeting_not_published' })
      }

      let threadId = row.thread_id
      if (!threadId) {
        threadId = await deps.ensureOrganizationMeetingThread({
          orgId: access.value.org.id,
          meetingId: row.id,
          title: row.title,
          ownerUserId: access.value.org.ownerId,
        })
        await prisma.$executeRaw`
          UPDATE organization_meeting
          SET thread_id = ${threadId}, updated_at = ${new Date()}
          WHERE id = ${row.id}
        `
      }

      type AdmissionLookupRow = { status: string | null }
      const admissionRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT status
        FROM organization_meeting_admission
        WHERE meeting_id = ${row.id}
          AND user_id = ${userId}
        LIMIT 1
      `)) as AdmissionLookupRow[]
      const admissionStatus = deps.normalizeMeetingAdmissionStatus(admissionRows[0]?.status)

      type ParticipantLookupRow = { exists: number }
      const participantRows = (await prisma.$queryRaw(Prisma.sql`
        SELECT 1::int as exists
        FROM "MessageParticipant"
        WHERE "threadId" = ${threadId}
          AND "userId" = ${userId}
        LIMIT 1
      `)) as ParticipantLookupRow[]
      const isParticipant = Boolean(participantRows[0]?.exists)

      if (!access.value.canManageMeetings && !isParticipant && admissionStatus !== 'ADMITTED') {
        return reply.code(403).send({ error: 'meeting_not_joined' })
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, handle: true },
      })
      if (!user) return reply.code(404).send({ error: 'user_not_found' })
      const displayName = body.data.displayName?.trim() || user.name?.trim() || user.handle || 'Civil user'

      const rtc = await deps.issueMeetingRtcSession({
        roomId: row.id,
        userId,
        role: access.value.canManageMeetings ? 'manager' : 'participant',
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
}