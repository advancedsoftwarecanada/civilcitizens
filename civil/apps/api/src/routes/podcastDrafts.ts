import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import {
  createPodcastDraft,
  ensurePodcastDraftTables,
  listPodcastDraftsForUser,
  loadPodcastDraftById,
  loadPodcastDraftByMediaAssetId,
  publishPodcastDraftIfEligible,
  updatePodcastDraftDetails,
} from '../podcastDraftsCore.js'
import { loadPodcastAnalyticsForPost, recordPodcastPlaybackSession } from '../podcastAnalytics.js'

type PodcastDraftRouteDeps = {
  buildPostSlugBase: (input: { handle?: string | null; title?: string | null; body: string }) => string
  createNotificationRecord?: (data: {
    userId: string
    actorId: string | null
    type: string
    postId?: string | null
    payload?: Prisma.InputJsonValue
    suppressMobilePush?: boolean
  }) => Promise<unknown>
  generateUniquePostSlug: (slugBase: string, tx: any) => Promise<string>
  loadViewerAuthContext: (req: FastifyRequest) => Promise<any>
  sanitizePlainText: (value: string) => string
  withSchemaGuard: any
  workerInternalSecret: string
}

const DraftParam = z.object({ id: z.string().uuid() })
const CreateDraftInput = z.object({ title: z.string().trim().max(180).optional(), description: z.string().max(5000).optional() })
const UpdateDraftInput = z
  .object({
    title: z.string().trim().max(180).optional(),
    description: z.string().max(5000).optional(),
    coverMediaAssetId: z.string().uuid().nullable().optional(),
  })
  .refine((value) => typeof value.title === 'string' || typeof value.description === 'string' || 'coverMediaAssetId' in value, { message: 'draft_update_required' })
const WorkerReadyInput = z.object({ assetId: z.string().uuid().or(z.string().cuid()) })
const PlaybackTrackInput = z.object({
  postId: z.string().uuid().or(z.string().cuid()),
  sessionId: z.string().trim().min(8).max(160),
  watchSeconds: z.number().finite().min(0).max(6 * 60 * 60),
  maxPositionSeconds: z.number().finite().min(0).max(6 * 60 * 60),
  completed: z.boolean().optional().default(false),
})

export function registerPodcastDraftRoutes(app: FastifyInstance, deps: PodcastDraftRouteDeps) {
  app.get('/podcasts/drafts', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext || authContext.actor !== 'user') return reply.code(401).send({ error: 'unauthorized' })
      await ensurePodcastDraftTables()
      const items = await listPodcastDraftsForUser(authContext.userId)
      return reply.send({ items })
    }),
  )

  app.post('/podcasts/drafts', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext || authContext.actor !== 'user') return reply.code(401).send({ error: 'unauthorized' })
      const parsed = CreateDraftInput.safeParse(req.body ?? {})
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
      const draft = await createPodcastDraft({ creatorUserId: authContext.userId, title: parsed.data.title, description: parsed.data.description })
      return reply.send({ draft, managePath: '/podcasts/manage' })
    }),
  )

  app.patch('/podcasts/drafts/:id', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext || authContext.actor !== 'user') return reply.code(401).send({ error: 'unauthorized' })
      const params = DraftParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const parsed = UpdateDraftInput.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

      let updated
      try {
        updated = await updatePodcastDraftDetails({
          id: params.data.id,
          creatorUserId: authContext.userId,
          title: parsed.data.title,
          description: parsed.data.description,
          coverMediaAssetId: parsed.data.coverMediaAssetId,
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'invalid_cover_media') {
          return reply.code(400).send({ error: 'invalid_cover_media' })
        }
        throw error
      }
      if (!updated) return reply.code(404).send({ error: 'podcast_draft_not_found' })
      const result = await publishPodcastDraftIfEligible({
        draftId: updated.id,
        deps: {
          buildPostSlugBase: deps.buildPostSlugBase,
          createNotificationRecord: deps.createNotificationRecord,
          generateUniquePostSlug: deps.generateUniquePostSlug,
          sanitizePlainText: deps.sanitizePlainText,
        },
      })
      return reply.send({ draft: result.draft, publishedPostId: result.publishedPostId ?? null })
    }),
  )

  app.post('/podcasts/drafts/:id/publish', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext || authContext.actor !== 'user') return reply.code(401).send({ error: 'unauthorized' })
      const params = DraftParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const draft = await loadPodcastDraftById(params.data.id, authContext.userId)
      if (!draft) return reply.code(404).send({ error: 'podcast_draft_not_found' })
      const result = await publishPodcastDraftIfEligible({
        draftId: draft.id,
        deps: {
          buildPostSlugBase: deps.buildPostSlugBase,
          createNotificationRecord: deps.createNotificationRecord,
          generateUniquePostSlug: deps.generateUniquePostSlug,
          sanitizePlainText: deps.sanitizePlainText,
        },
      })
      if (!result.publishedPostId) return reply.code(409).send({ error: 'podcast_draft_not_ready_to_publish', draft: result.draft })
      return reply.send({ draft: result.draft, publishedPostId: result.publishedPostId })
    }),
  )

  app.get('/podcasts/drafts/:id/analytics', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext || authContext.actor !== 'user') return reply.code(401).send({ error: 'unauthorized' })
      const params = DraftParam.safeParse(req.params)
      if (!params.success) return reply.code(400).send({ error: params.error.flatten() })
      const draft = await loadPodcastDraftById(params.data.id, authContext.userId)
      if (!draft) return reply.code(404).send({ error: 'podcast_draft_not_found' })
      if (!draft.publishedPostId) return reply.code(409).send({ error: 'podcast_draft_not_published' })
      const analytics = await loadPodcastAnalyticsForPost({ postId: draft.publishedPostId, creatorUserId: authContext.userId })
      if (!analytics) return reply.code(404).send({ error: 'podcast_analytics_not_found' })
      return reply.send({ analytics })
    }),
  )

  app.post('/podcasts/analytics/playback', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const authContext = await deps.loadViewerAuthContext(req)
      if (!authContext || authContext.actor !== 'user') return reply.code(401).send({ error: 'unauthorized' })
      const parsed = PlaybackTrackInput.safeParse(req.body ?? {})
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
      const result = await recordPodcastPlaybackSession({
        sessionId: parsed.data.sessionId,
        postId: parsed.data.postId,
        viewerUserId: authContext.userId,
        watchSeconds: parsed.data.watchSeconds,
        maxPositionSeconds: parsed.data.maxPositionSeconds,
        completed: parsed.data.completed,
      })
      return reply.send({ ok: true, tracked: result.tracked, reason: result.reason })
    }),
  )

  app.post('/internal/podcast-drafts/media-ready', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const secret = typeof req.headers['x-worker-secret'] === 'string' ? req.headers['x-worker-secret'] : ''
      if (!deps.workerInternalSecret || secret !== deps.workerInternalSecret) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
      const parsed = WorkerReadyInput.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
      const draft = await loadPodcastDraftByMediaAssetId(parsed.data.assetId)
      if (!draft) return reply.send({ ok: true, draft: null })
      const result = await publishPodcastDraftIfEligible({
        draftId: draft.id,
        deps: {
          buildPostSlugBase: deps.buildPostSlugBase,
          createNotificationRecord: deps.createNotificationRecord,
          generateUniquePostSlug: deps.generateUniquePostSlug,
          sanitizePlainText: deps.sanitizePlainText,
        },
        notifyReadyIfBlocked: true,
      })
      return reply.send({ ok: true, draft: result.draft, publishedPostId: result.publishedPostId ?? null })
    }),
  )
}