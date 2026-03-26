'use client'

import CivilCard from './CivilCard'
import { formatUserDisplayName } from '../_lib/text'

export type CauseContributorItem = {
  id: string
  amountCents: number
  createdAt: string
  sourceType: string
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl: string | null
    isPremium: boolean
    isVerified: boolean
  }
}

function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format((amountCents || 0) / 100)
}

function formatRelativeHours(value: string | null | undefined) {
  if (!value) return 'Recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  const diffMs = Date.now() - date.getTime()
  if (!Number.isFinite(diffMs) || diffMs <= 0) return '1 hour ago'
  const hours = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)))
  return `${hours} hour${hours === 1 ? '' : 's'} ago`
}

export default function CauseContributorCard({ entry }: { entry: CauseContributorItem }) {
  const displayName = formatUserDisplayName(entry.user.name, entry.user.handle) || entry.user.handle

  return (
    <CivilCard
      href={`/u/${entry.user.handle}`}
      size="md"
      name={displayName}
      avatarAlt={displayName}
      avatarInitials={displayName}
      avatarSrc={entry.user.avatarUrl}
      coverUrl={entry.user.coverUrl}
      subtitle={formatRelativeHours(entry.createdAt)}
      isVerified={entry.user.isVerified}
      isBusiness={entry.user.isPremium}
      className="border-slate-200"
      trailing={
        <span className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full bg-emerald-600 px-3 text-sm font-semibold text-white shadow-sm">
          {formatCurrency(entry.amountCents)}
        </span>
      }
    />
  )
}