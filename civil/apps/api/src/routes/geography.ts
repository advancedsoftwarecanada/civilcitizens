import { ElectoralDistrictBrowserInput, ElectoralDistrictContextInput } from '@civil/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { browseElectoralDistricts, resolveElectoralDistrictContext } from '../geospatial.js'

export function registerGeographyRoutes(app: FastifyInstance) {
  app.post('/geography/district-context', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = ElectoralDistrictContextInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    try {
      const payload = await resolveElectoralDistrictContext({
        userId,
        postalCode: parse.data.postalCode ?? null,
        lat: parse.data.lat ?? null,
        lng: parse.data.lng ?? null,
      })

      return reply.send(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'district_context_failed'
      if (message === 'postgis_not_enabled') return reply.code(503).send({ error: message })
      if (message === 'invalid_postal_code') return reply.code(400).send({ error: message })
      if (message === 'fsa_not_found') return reply.code(404).send({ error: message })
      if (message === 'postal_or_coordinates_required') return reply.code(400).send({ error: message })
      req.log.error({ err: error }, 'district_context_failed')
      return reply.code(500).send({ error: 'district_context_failed' })
    }
  })

  app.post('/geography/district-browser', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).user?.id
    if (!userId) return reply.code(401).send({ error: 'unauthorized' })

    const parse = ElectoralDistrictBrowserInput.safeParse(req.body)
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    try {
      const payload = await browseElectoralDistricts({
        userId,
        provinceCode: parse.data.provinceCode ?? null,
        communitySlug: parse.data.communitySlug ?? null,
        postalCode: parse.data.postalCode ?? null,
        lat: parse.data.lat ?? null,
        lng: parse.data.lng ?? null,
        limit: parse.data.limit ?? null,
      })

      return reply.send(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'district_browser_failed'
      if (message === 'postgis_not_enabled') return reply.code(503).send({ error: message })
      if (message === 'invalid_postal_code') return reply.code(400).send({ error: message })
      if (message === 'fsa_not_found') return reply.code(404).send({ error: message })
      if (message === 'province_or_location_required') return reply.code(400).send({ error: message })
      req.log.error({ err: error }, 'district_browser_failed')
      return reply.code(500).send({ error: 'district_browser_failed' })
    }
  })
}