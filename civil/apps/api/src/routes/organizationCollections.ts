import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '@civil/db'

type OrganizationCollectionDeps = Record<string, any>

export function registerOrganizationCollectionRoutes(app: FastifyInstance, deps: OrganizationCollectionDeps) {
  app.get('/organizations/follows', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const follows: Array<{
        business: {
          id: string
          name: string
          slug: string
          provinceCode: string
          communitySlug: string
          isVerified: boolean
          logoUrl: string | null
          coverUrl: string | null
        } | null
      }> = (await prisma.businessFollow.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        select: {
          business: {
            select: {
              id: true,
              name: true,
              slug: true,
              provinceCode: true,
              communitySlug: true,
              isVerified: true,
              logoUrl: true,
              coverUrl: true,
            },
          },
        },
      })) as any

      const items = follows.flatMap((row) =>
        row.business
          ? [
              {
                id: row.business.id,
                name: row.business.name,
                slug: row.business.slug,
                provinceCode: row.business.provinceCode,
                communitySlug: row.business.communitySlug,
                isVerified: row.business.isVerified,
                logoUrl: deps.normalizeMediaUrl(row.business.logoUrl ?? null),
                coverUrl: deps.normalizeMediaUrl(row.business.coverUrl ?? null),
              },
            ]
          : [],
      )

      return reply.send({ items })
    }),
  )

  app.get('/organizations/owned', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const organizations = await prisma.business.findMany({
        where: { ownerId: userId },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        select: {
          id: true,
          name: true,
          slug: true,
          provinceCode: true,
          communitySlug: true,
          isVerified: true,
          status: true,
          logoUrl: true,
          coverUrl: true,
        },
      })

      const items = organizations.map((org: {
        id: string
        name: string
        slug: string
        provinceCode: string | null
        communitySlug: string | null
        isVerified: boolean
        status: string
        logoUrl: string | null
        coverUrl: string | null
      }) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        provinceCode: org.provinceCode,
        communitySlug: org.communitySlug,
        isVerified: org.isVerified,
        status: org.status,
        logoUrl: deps.normalizeMediaUrl(org.logoUrl ?? null),
        coverUrl: deps.normalizeMediaUrl(org.coverUrl ?? null),
      }))

      return reply.send({ items })
    }),
  )

  app.get('/organizations/memberships', async (req: FastifyRequest, reply: FastifyReply) =>
    deps.withSchemaGuard(req, reply, async () => {
      const userId = (req as any).user?.id as string | undefined
      if (!userId) return reply.code(401).send({ error: 'unauthorized' })

      const memberships: Array<{
        role: string
        business: {
          id: string
          name: string
          slug: string
          provinceCode: string | null
          communitySlug: string | null
          isVerified: boolean
          status: string
          logoUrl: string | null
          coverUrl: string | null
        } | null
      }> = (await prisma.businessMembership.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        select: {
          role: true,
          business: {
            select: {
              id: true,
              name: true,
              slug: true,
              provinceCode: true,
              communitySlug: true,
              isVerified: true,
              status: true,
              logoUrl: true,
              coverUrl: true,
            },
          },
        },
      })) as any

      const items = memberships.flatMap((row) =>
        row.business
          ? [
              {
                id: row.business.id,
                name: row.business.name,
                slug: row.business.slug,
                provinceCode: row.business.provinceCode,
                communitySlug: row.business.communitySlug,
                isVerified: row.business.isVerified,
                status: row.business.status,
                role: row.role,
                logoUrl: deps.normalizeMediaUrl(row.business.logoUrl ?? null),
                coverUrl: deps.normalizeMediaUrl(row.business.coverUrl ?? null),
              },
            ]
          : [],
      )

      return reply.send({ items })
    }),
  )
}