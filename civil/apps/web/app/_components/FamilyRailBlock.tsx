'use client'

import { useMemo } from 'react'
import Block from './Block'
import CivilCard from './CivilCard'
import { buildFamilyAvatarDataUrl } from '../_lib/familyIdentity'

export type SharedFamilyRailEntry =
  | {
      kind: 'member'
      id: string
      displayName: string
      relationshipLabel: string
      avatarUrl?: string | null
      coverUrl?: string | null
      modeBand: 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
      latestPostAt?: string | null
      suspended: boolean
    }
  | {
      kind: 'profile'
      id: string
      handle: string
      displayName: string
      relationshipLabel: string
      avatarUrl?: string | null
      coverUrl?: string | null
      latestPostAt?: string | null
    }

type FamilyRailBlockProps = {
  entries: SharedFamilyRailEntry[]
  viewAllHref: string
  loading?: boolean
  onSelectMember?: (memberId: string) => void
}

export default function FamilyRailBlock({ entries, viewAllHref, loading = false, onSelectMember }: FamilyRailBlockProps) {
  const orderedEntries = useMemo(() => {
    const nextEntries = [...entries]
    nextEntries.sort((left, right) => {
      const leftTime = left.latestPostAt ? new Date(left.latestPostAt).getTime() : 0
      const rightTime = right.latestPostAt ? new Date(right.latestPostAt).getTime() : 0
      if (rightTime !== leftTime) return rightTime - leftTime
      return right.displayName.localeCompare(left.displayName) * -1
    })
    return nextEntries.slice(0, 10)
  }, [entries])

  return (
    <Block title="Your Family" action={{ label: 'View all', href: viewAllHref }}>
      {loading ? (
        <ul className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <li key={index} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white/60 px-3 py-2.5">
              <div className="h-11 w-11 rounded-full bg-slate-100" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-3 w-1/2 rounded bg-slate-100" />
                <div className="h-2 w-1/3 rounded bg-slate-50" />
              </div>
            </li>
          ))}
        </ul>
      ) : orderedEntries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          No family members yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {orderedEntries.map((entry) => {
            const avatarSrc =
              entry.kind === 'member' ? entry.avatarUrl ?? buildFamilyAvatarDataUrl(entry.displayName, entry.modeBand) : entry.avatarUrl ?? null
            const card = (
              <CivilCard
                size="md"
                name={entry.displayName}
                avatarAlt={entry.displayName}
                avatarInitials={entry.displayName}
                avatarSrc={avatarSrc}
                coverUrl={entry.coverUrl ?? null}
                href={entry.kind === 'profile' ? `/u/${entry.handle}` : undefined}
                interactive={entry.kind === 'profile'}
              />
            )

            return (
              <li key={`${entry.kind}:${entry.id}`}>
                {entry.kind === 'member' && onSelectMember ? (
                  <button type="button" onClick={() => onSelectMember(entry.id)} className="block w-full text-left">
                    {card}
                  </button>
                ) : (
                  card
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Block>
  )
}