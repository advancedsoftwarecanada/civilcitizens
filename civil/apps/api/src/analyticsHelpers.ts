import { randomUUID } from 'crypto'
import { prisma } from '@civil/db'
import { Prisma } from '@prisma/client'

type DailyCount = { date: string; count: number }
type JobAnalyticsKind = 'job_added' | 'applicant_submitted' | 'applications_viewed' | 'applicant_hired'

const METRIC_TABLES = {
  users: { table: '"User"', column: '"createdAt"' },
  posts: { table: '"Post"', column: '"createdAt"' },
  comments: { table: '"Comment"', column: '"createdAt"' },
  reactions: { table: '"PostReaction"', column: '"createdAt"' },
} as const

type DateRange = { start: Date; end: Date }

export async function queryDailyCounts(kind: keyof typeof METRIC_TABLES, range: DateRange): Promise<DailyCount[]> {
  const config = METRIC_TABLES[kind]
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    select date_trunc('day', ${Prisma.raw(config.column)}) as date, count(*)::bigint as count
    from ${Prisma.raw(config.table)}
    where ${Prisma.raw(config.column)} >= ${range.start} and ${Prisma.raw(config.column)} < ${range.end}
    group by 1
    order by 1 asc
  `
  return rows.map((row: { date: Date; count: bigint }) => ({ date: row.date.toISOString(), count: Number(row.count) || 0 }))
}

export async function queryFollowSeries(range: DateRange): Promise<DailyCount[]> {
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    select date_trunc('day', created_at) as date, count(*)::bigint as count
    from (
      select "createdAt" as created_at
      from "CommunityFollow"
      where "createdAt" >= ${range.start} and "createdAt" < ${range.end}
      union all
      select "createdAt" as created_at
      from "BusinessFollow"
      where "createdAt" >= ${range.start} and "createdAt" < ${range.end}
    ) follows
    group by 1
    order by 1 asc
  `
  return rows.map((row: { date: Date; count: bigint }) => ({ date: row.date.toISOString(), count: Number(row.count) || 0 }))
}

export async function queryPageViewSeries(range: DateRange): Promise<DailyCount[]> {
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    select date_trunc('day', "createdAt") as date, count(*)::bigint as count
    from "PageView"
    where "createdAt" >= ${range.start} and "createdAt" < ${range.end}
    group by 1
    order by 1 asc
  `
  return rows.map((row: { date: Date; count: bigint }) => ({ date: row.date.toISOString(), count: Number(row.count) || 0 }))
}

export async function queryJobAnalyticsSeries(kind: JobAnalyticsKind, range: DateRange): Promise<DailyCount[]> {
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    select date_trunc('day', "createdAt") as date, count(*)::bigint as count
    from "JobAnalyticsEvent"
    where "kind" = ${kind}::"JobAnalyticsEventKind"
      and "createdAt" >= ${range.start}
      and "createdAt" < ${range.end}
    group by 1
    order by 1 asc
  `
  return rows.map((row: { date: Date; count: bigint }) => ({ date: row.date.toISOString(), count: Number(row.count) || 0 }))
}

export async function trackJobAnalyticsEvent(args: {
  kind: JobAnalyticsKind
  businessId: string
  jobPostingId?: string | null
  jobApplicationId?: string | null
  actorUserId?: string | null
  createdAt?: Date
}) {
  await prisma.$executeRaw`
    INSERT INTO "JobAnalyticsEvent" (
      "id", "kind", "businessId", "jobPostingId", "jobApplicationId", "actorUserId", "createdAt"
    )
    VALUES (
      ${randomUUID()},
      ${args.kind}::"JobAnalyticsEventKind",
      ${args.businessId},
      ${args.jobPostingId ?? null},
      ${args.jobApplicationId ?? null},
      ${args.actorUserId ?? null},
      ${args.createdAt ?? new Date()}
    )
  `
}

export function startOfUtcDay(date: Date) {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

export function parseDateInput(value?: string | null, fallbackDays = 30): { start: Date; end: Date } {
  const now = new Date()
  const end = startOfUtcDay(now)
  end.setUTCDate(end.getUTCDate() + 1)

  let start = startOfUtcDay(new Date(now.getTime() - (fallbackDays - 1) * 24 * 60 * 60 * 1000))
  if (value) {
    const candidate = new Date(value)
    if (!Number.isNaN(candidate.getTime())) {
      start = startOfUtcDay(candidate)
    }
  }
  return { start, end }
}

export function parseRange(start?: string | null, end?: string | null): DateRange {
  const today = startOfUtcDay(new Date())
  const defaultStart = startOfUtcDay(new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000))
  let rangeStart = defaultStart
  let rangeEnd = startOfUtcDay(new Date(today.getTime() + 24 * 60 * 60 * 1000))

  if (start) {
    const s = new Date(start)
    if (!Number.isNaN(s.getTime())) rangeStart = startOfUtcDay(s)
  }
  if (end) {
    const e = new Date(end)
    if (!Number.isNaN(e.getTime())) {
      const endDay = startOfUtcDay(e)
      endDay.setUTCDate(endDay.getUTCDate() + 1)
      rangeEnd = endDay
    }
  }
  if (rangeEnd <= rangeStart) {
    rangeEnd = startOfUtcDay(new Date(rangeStart.getTime() + 24 * 60 * 60 * 1000))
  }
  return { start: rangeStart, end: rangeEnd }
}
