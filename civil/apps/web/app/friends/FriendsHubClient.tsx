'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import FeedPageClient from '../_components/FeedPageClient'
import FamilyFeedClient from '../_components/FamilyFeedClient'
import { hasFamilyModeEnabled } from '../_lib/me'
import { useViewerStore } from '../_lib/viewerStore'
import { buildFamilyAvatarDataUrl } from '../_lib/familyIdentity'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { pushToast } from '../_components/useToasts'
import { useCallback, useEffect, useState } from 'react'

type FriendsTabKey = 'feed' | 'family'

type FamilyMemberSummary = {
  id: string
  displayName: string
  modeBand: 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
  modeLabel: string
  relationshipLabel: string
  avatarUrl?: string | null
  suspended: boolean
}

type FamilyResponse = {
  familyMode?: {
    enabled?: boolean
  }
  members?: FamilyMemberSummary[]
}

function FriendsTabNav({ active, showFamily }: { active: FriendsTabKey; showFamily: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href="/friends"
        className={active === 'feed'
          ? 'inline-flex rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white'
          : 'inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900'}
      >
        Friends
      </Link>
      {showFamily ? (
        <Link
          href="/friends?tab=family"
          className={active === 'family'
            ? 'inline-flex rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white'
            : 'inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900'}
        >
          Family
        </Link>
      ) : null}
    </div>
  )
}

function ParentFamilyFeedView({ tabs }: { tabs: JSX.Element }) {
  const [members, setMembers] = useState<FamilyMemberSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')

  const loadFamilyMembers = useCallback(async () => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    try {
      const response = await fetch(buildApiUrl('/family'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      const payload = (await response.json().catch(() => null)) as FamilyResponse | null
      if (!response.ok || !Array.isArray(payload?.members)) {
        throw new Error('family_members_load_failed')
      }
      const nextMembers = payload.members
      setMembers(nextMembers)
      setSelectedMemberId((current) => {
        if (current && nextMembers.some((member) => member.id === current)) return current
        return nextMembers.find((member) => !member.suspended)?.id ?? nextMembers[0]?.id ?? ''
      })
    } catch (error) {
      console.error('Failed to load family members for Family feed', error)
      pushToast('Unable to load Family members right now.', 'error')
      setMembers([])
      setSelectedMemberId('')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadFamilyMembers()
  }, [loadFamilyMembers])

  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId) ?? null,
    [members, selectedMemberId],
  )

  const headerContent = (
    <div className="space-y-4">
      {tabs}
      <section className="rounded-[28px] border border-slate-200 bg-white/90 px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--cc-primary)]">Friends</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">Family</h1>
            <p className="mt-1 text-sm text-slate-600">Choose a supervised profile to post updates that only that child sees in Family mode.</p>
          </div>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading supervised profiles…</p>
        ) : members.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            No supervised profiles yet. <Link href="/settings/family" className="font-semibold text-[var(--cc-primary)] hover:underline">Create one in Family Mode settings</Link>.
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-3">
            {members.map((member) => {
              const active = member.id === selectedMemberId
              const avatarSrc = member.avatarUrl ?? buildFamilyAvatarDataUrl(member.displayName, member.modeBand)
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedMemberId(member.id)}
                  className={active
                    ? 'flex min-w-[220px] items-center gap-3 rounded-2xl border border-[var(--cc-primary)] bg-[var(--cc-primary)]/5 px-3 py-3 text-left shadow-sm'
                    : 'flex min-w-[220px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-slate-300'}
                >
                  <img src={avatarSrc} alt="" className="h-12 w-12 rounded-full border border-slate-200 object-cover" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{member.displayName}</p>
                    <p className="text-xs text-slate-500">{member.relationshipLabel} · {member.modeLabel}</p>
                    {member.suspended ? <p className="text-xs font-semibold text-amber-700">Suspended</p> : null}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )

  if (!selectedMember) {
    return (
      <FamilyFeedClient
        readOnly
        title="Family Feed"
        description="Choose a supervised profile to view their Family feed."
        emptyState="No Family feed selected yet."
        headerContent={headerContent}
      />
    )
  }

  return (
    <FamilyFeedClient
      memberId={selectedMember.id}
      memberDisplayName={selectedMember.displayName}
      memberModeBand={selectedMember.modeBand}
      memberAvatarUrl={selectedMember.avatarUrl ?? null}
      title="Family Feed"
      description={`Post specifically for ${selectedMember.displayName}. This feed stays latest-only and only appears in that child's Family shell.`}
      emptyState={`No Family updates for ${selectedMember.displayName} yet.`}
      headerContent={headerContent}
    />
  )
}

export default function FriendsHubClient() {
  const searchParams = useSearchParams()
  const viewer = useViewerStore((state) => state.me)
  const showFamilyTab = viewer?.accountType === 'user' && hasFamilyModeEnabled(viewer)
  const requestedTab = searchParams?.get('tab') === 'family' ? 'family' : 'feed'
  const activeTab: FriendsTabKey = showFamilyTab ? requestedTab : 'feed'
  const tabs = <FriendsTabNav active={activeTab} showFamily={showFamilyTab} />

  if (activeTab === 'family') {
    return <ParentFamilyFeedView tabs={tabs} />
  }

  return (
    <FeedPageClient
      scope="friends"
      sidebarActive="friends"
      title="Friends Feed"
      description="Updates from the people you follow and trust on Civil."
      emptyState="No friend activity yet. Once your friends start posting, their updates will land here."
      emptyStateCta={{ label: 'Find Friends', href: '/search' }}
      rightRail={null}
      headerContent={tabs}
      showFeedSummary={false}
      sortOptions={[
        { value: 'new', label: 'Latest' },
        { value: 'hot', label: 'Hot' },
      ]}
      defaultSort="new"
    />
  )
}
