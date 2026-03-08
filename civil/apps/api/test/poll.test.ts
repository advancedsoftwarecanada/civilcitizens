import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { truncateTables } from './testDbGuard'

const truncateAll = async () => {
  const tables = ['Notification', 'MediaAsset', 'Post', 'User']
  await truncateTables(tables)
}

const authHeader = (token: string) => ({ authorization: `Bearer ${token}` })

const registerUser = async (app: FastifyInstance, firstName: string, lastName: string) => {
  const email = `test+${randomUUID()}@example.com`
  const password = 'Password123!'
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, firstName, lastName, password, acceptTerms: true },
  })
  const payload = res.json() as { token?: string; user?: { id?: string; handle?: string } }
  expect(res.statusCode).toBe(200)
  expect(payload.token).toBeTruthy()
  expect(payload.user?.id).toBeTruthy()
  return { token: payload.token!, id: payload.user!.id! }
}

let app: FastifyInstance

beforeAll(async () => {
  process.env.API_SKIP_LISTEN = '1'
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test_secret'
  const mod = await import('../src/index.js')
  app = mod.app as FastifyInstance
  await app.ready()
})

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

describe('poll posts', () => {
  test('supports create, vote changes, option add, and end', async () => {
    const author = await registerUser(app, 'Poll', 'Author')
    const voter = await registerUser(app, 'Poll', 'Voter')

    const createRes = await app.inject({
      method: 'POST',
      url: '/posts',
      headers: authHeader(author.token),
      payload: {
        type: 'poll',
        body: 'What should we ship next?',
        poll: {
          resultsVisibility: 'after_vote',
          options: ['Option A', 'Option B'],
        },
      },
    })

    expect(createRes.statusCode).toBe(201)
    const created = createRes.json() as {
      id: string
      poll?: {
        options: Array<{ id: string; label: string }>
        viewer: { hasVoted: boolean; canSeeResults: boolean }
        authorCanAddOptions: boolean
      } | null
    }
    expect(created.poll).toBeTruthy()
    expect(created.poll?.options).toHaveLength(2)
    expect(created.poll?.viewer.hasVoted).toBe(false)
    expect(created.poll?.viewer.canSeeResults).toBe(false)
    expect(created.poll?.authorCanAddOptions).toBe(true)

    const firstOptionId = created.poll?.options[0]?.id
    const secondOptionId = created.poll?.options[1]?.id
    expect(firstOptionId).toBeTruthy()
    expect(secondOptionId).toBeTruthy()

    const firstVoteRes = await app.inject({
      method: 'POST',
      url: `/posts/${created.id}/poll/vote`,
      headers: authHeader(voter.token),
      payload: { optionId: firstOptionId },
    })

    expect(firstVoteRes.statusCode).toBe(200)
    const firstVotePayload = firstVoteRes.json() as {
      post?: {
        poll?: {
          totalVotes: number | null
          viewer: { hasVoted: boolean; optionId: string | null; canSeeResults: boolean }
          options: Array<{ id: string; voteCount: number | null }>
        } | null
      }
    }
    expect(firstVotePayload.post?.poll?.viewer.hasVoted).toBe(true)
    expect(firstVotePayload.post?.poll?.viewer.optionId).toBe(firstOptionId)
    expect(firstVotePayload.post?.poll?.viewer.canSeeResults).toBe(true)
    expect(firstVotePayload.post?.poll?.totalVotes).toBe(1)
    expect(firstVotePayload.post?.poll?.options.find((option) => option.id === firstOptionId)?.voteCount).toBe(1)

    const secondVoteRes = await app.inject({
      method: 'POST',
      url: `/posts/${created.id}/poll/vote`,
      headers: authHeader(voter.token),
      payload: { optionId: secondOptionId },
    })

    expect(secondVoteRes.statusCode).toBe(200)
    const secondVotePayload = secondVoteRes.json() as {
      post?: {
        poll?: {
          totalVotes: number | null
          viewer: { optionId: string | null }
          options: Array<{ id: string; voteCount: number | null }>
        } | null
      }
    }
    expect(secondVotePayload.post?.poll?.viewer.optionId).toBe(secondOptionId)
    expect(secondVotePayload.post?.poll?.totalVotes).toBe(1)
    expect(secondVotePayload.post?.poll?.options.find((option) => option.id === firstOptionId)?.voteCount).toBe(0)
    expect(secondVotePayload.post?.poll?.options.find((option) => option.id === secondOptionId)?.voteCount).toBe(1)

    const addOptionRes = await app.inject({
      method: 'POST',
      url: `/posts/${created.id}/poll/options`,
      headers: authHeader(author.token),
      payload: { label: 'Option C' },
    })

    expect(addOptionRes.statusCode).toBe(200)
    const addOptionPayload = addOptionRes.json() as {
      post?: {
        poll?: {
          options: Array<{ label: string }>
          authorCanAddOptions: boolean
        } | null
      }
    }
    expect(addOptionPayload.post?.poll?.options).toHaveLength(3)
    expect(addOptionPayload.post?.poll?.options.map((option) => option.label)).toContain('Option C')
    expect(addOptionPayload.post?.poll?.authorCanAddOptions).toBe(true)

    const lockedEditRes = await app.inject({
      method: 'PATCH',
      url: `/posts/${created.id}`,
      headers: authHeader(author.token),
      payload: {
        body: 'Changed question',
      },
    })

    expect(lockedEditRes.statusCode).toBe(409)
    expect(lockedEditRes.json()).toMatchObject({ error: 'poll_locked' })

    const endRes = await app.inject({
      method: 'POST',
      url: `/posts/${created.id}/poll/end`,
      headers: authHeader(author.token),
    })

    expect(endRes.statusCode).toBe(200)
    const endPayload = endRes.json() as {
      post?: {
        poll?: {
          endedAt: string | null
          viewer: { canVote: boolean; canSeeResults: boolean }
          authorCanEndPoll: boolean
        } | null
      }
    }
    expect(endPayload.post?.poll?.endedAt).toBeTruthy()
    expect(endPayload.post?.poll?.viewer.canVote).toBe(false)
    expect(endPayload.post?.poll?.authorCanEndPoll).toBe(false)
    expect(endPayload.post?.poll?.viewer.canSeeResults).toBe(true)
  })
})
