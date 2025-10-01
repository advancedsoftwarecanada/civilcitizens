import { Worker, QueueEvents } from 'bullmq'
import { Redis as IORedis } from 'ioredis'
import pino from 'pino'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = new IORedis(REDIS_URL)
const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

const worker = new Worker(
  'fanout',
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'processing job')
    // TODO: create FeedEntry rows, invalidate caches, publish SSE nudges
  },
  { connection }
)

const events = new QueueEvents('fanout', { connection })
events.on('completed', ({ jobId }) => logger.info({ jobId }, 'job completed'))
events.on('failed', ({ jobId, failedReason }) => logger.error({ jobId, failedReason }, 'job failed'))

process.on('SIGINT', async () => {
  await worker.close()
  await events.close()
  connection.disconnect()
  process.exit(0)
})
