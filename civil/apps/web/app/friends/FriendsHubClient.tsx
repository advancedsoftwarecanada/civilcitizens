'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { HiOutlineChevronDown, HiOutlinePhone, HiOutlineVideoCamera } from 'react-icons/hi2'
import CivilComposerLauncher from '../_components/CivilComposerLauncher'
import Block from '../_components/Block'
import FeedPageClient from '../_components/FeedPageClient'
import FamilyFeedClient from '../_components/FamilyFeedClient'
import FriendsRightRail from '../_components/FriendsRightRail'
import MessagesNavBlock from '../_components/MessagesNavBlock'
import Modal from '../_components/Modal'
import PostComposer, { ApiPost, type PostType } from '../_components/PostComposer'
import PostFeedItem from '../_components/PostFeedItem'
import { RightRail } from '../_components/RightRail'
import CivilCard from '../_components/CivilCard'
import DashboardShell from '../_components/DashboardShell'
import { hasFamilyProfilesAvailable, type MeResponse } from '../_lib/me'
import { useViewerStore } from '../_lib/viewerStore'
import { buildFamilyAvatarDataUrl, buildFamilyCoverDataUrl } from '../_lib/familyIdentity'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { pushToast } from '../_components/useToasts'
import { formatDisplayName } from '../_lib/text'

type FamilyMemberSummary = {
  id: string
  displayName: string
  modeBand: 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
  modeLabel: string
  relationshipLabel: string
  avatarUrl?: string | null
  latestPostAt?: string | null
  suspended: boolean
}

type ProfileFamilyRelationshipSummary = {
  id: string
  handle: string
  displayName: string
  relationshipLabel: string
  avatarUrl?: string | null
  coverUrl?: string | null
  latestPostAt?: string | null
}

type FamilyResponse = {
  familyMode?: {
    enabled?: boolean
  }
  members?: FamilyMemberSummary[]
  profileRelationships?: ProfileFamilyRelationshipSummary[]
}

type FriendListEntry = {
  id: string
  status: string
  since: string | null
  locked?: boolean
  specialKind?: 'family_sponsor' | 'family_child_friend'
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl?: string | null
    isPremium: boolean
    isVerified: boolean
  }
}

type FriendsResponse = {
  items?: FriendListEntry[]
}

function formatLatestFamilyPostLabel(value?: string | null) {
  if (!value) return 'No posts yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No posts yet'
  return `Latest post ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

const actionMenuPanelClassName =
  'mt-2 w-full rounded-2xl border border-slate-200 bg-white p-2 shadow-lg sm:absolute sm:left-0 sm:top-full sm:z-20 sm:min-w-[220px] sm:w-auto'
const actionMenuItemClassName =
  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55'
const destructiveActionMenuItemClassName =
  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-55'

function closeDetailsMenu(event: MouseEvent<HTMLElement>) {
  const details = event.currentTarget.closest('details')
  if (details instanceof HTMLDetailsElement) {
    details.open = false
  }
}

type FamilyRailEntry =
  | {
      kind: 'member'
      id: string
      displayName: string
      relationshipLabel: string
      avatarUrl?: string | null
      coverUrl?: string | null
      modeBand: FamilyMemberSummary['modeBand']
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

function ParentFamilyRightRail({
  entries,
  selectedMemberId,
  loading,
  onSelectMember,
}: {
  entries: FamilyRailEntry[]
  selectedMemberId: string
  loading: boolean
  onSelectMember: (memberId: string) => void
}) {
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
    <Block title="Family" action={{ label: 'View all', href: '/settings/guardian' }}>
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
            const active = entry.kind === 'member' && entry.id === selectedMemberId
            const avatarSrc = entry.kind === 'member'
              ? entry.avatarUrl ?? buildFamilyAvatarDataUrl(entry.displayName, entry.modeBand)
              : entry.avatarUrl ?? null
            const subtitle = `${entry.relationshipLabel} • ${formatLatestFamilyPostLabel(entry.latestPostAt)}`
            const card = (
              <CivilCard
                size="md"
                name={entry.displayName}
                avatarAlt={entry.displayName}
                avatarInitials={entry.displayName}
                avatarSrc={avatarSrc}
                coverUrl={entry.coverUrl ?? null}
                subtitle={subtitle}
                href={entry.kind === 'profile' ? `/u/${entry.handle}` : undefined}
                interactive={entry.kind === 'profile'}
              />
            )
            return (
              <li key={`${entry.kind}:${entry.id}`}>
                {entry.kind === 'member' ? (
                  <button type="button" onClick={() => onSelectMember(entry.id)} className="block w-full text-left">
                    {card}
                  </button>
                ) : card}
              </li>
            )
          })}
        </ul>
      )}
    </Block>
  )
}

function ParentFamilyFeedView() {
  const viewer = useViewerStore((state) => state.me)
  const [members, setMembers] = useState<FamilyMemberSummary[]>([])
  const [profileRelationships, setProfileRelationships] = useState<ProfileFamilyRelationshipSummary[]>([])
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
      const nextRelationships = Array.isArray(payload?.profileRelationships) ? payload.profileRelationships : []
      setMembers(nextMembers)
      setProfileRelationships(nextRelationships)
      setSelectedMemberId((current) => {
        if (current && nextMembers.some((member) => member.id === current)) return current
        return nextMembers.find((member) => !member.suspended)?.id ?? nextMembers[0]?.id ?? ''
      })
    } catch (error) {
      console.error('Failed to load family members for Family feed', error)
      pushToast('Unable to load Family members right now.', 'error')
      setMembers([])
      setProfileRelationships([])
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

  const familyEntries = useMemo<FamilyRailEntry[]>(() => [
    ...members.map((member) => ({
      kind: 'member' as const,
      id: member.id,
      displayName: member.displayName,
      relationshipLabel: member.relationshipLabel,
      avatarUrl: member.avatarUrl ?? null,
      coverUrl: null,
      modeBand: member.modeBand,
      latestPostAt: member.latestPostAt ?? null,
      suspended: member.suspended,
    })),
    ...profileRelationships.map((relationship) => ({
      kind: 'profile' as const,
      id: relationship.id,
      handle: relationship.handle,
      displayName: relationship.displayName,
      relationshipLabel: relationship.relationshipLabel,
      avatarUrl: relationship.avatarUrl ?? null,
      coverUrl: relationship.coverUrl ?? null,
      latestPostAt: relationship.latestPostAt ?? null,
    })),
  ], [members, profileRelationships])

  const rightRail = (
    <div className="space-y-4">
      <ParentFamilyRightRail
        entries={familyEntries}
        selectedMemberId={selectedMemberId}
        loading={loading}
        onSelectMember={setSelectedMemberId}
      />
      <RightRail hideContacts hideCommunities />
    </div>
  )

  if (!selectedMember) {
    return profileRelationships.length > 0 ? <AdultFamilyCircleFeed rightRail={rightRail} viewer={viewer} /> : (
      <FamilyFeedClient
        readOnly
        title=""
        description=""
        emptyState="No Family feed selected yet."
        rightRail={rightRail}
      />
    )
  }

  return (
    <FamilyFeedClient
      memberId={selectedMember.id}
      memberDisplayName={selectedMember.displayName}
      memberModeBand={selectedMember.modeBand}
      memberAvatarUrl={selectedMember.avatarUrl ?? null}
      title=""
      description=""
      emptyState={`No Family updates for ${selectedMember.displayName} yet.`}
      rightRail={rightRail}
    />
  )
}

function AdultFamilyCircleFeed({
  rightRail,
  viewer,
}: {
  rightRail: React.ReactNode
  viewer: MeResponse | null
}) {
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerDefaultType, setComposerDefaultType] = useState<PostType>('post')

  const loadPosts = useCallback(async () => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await fetch(buildApiUrl('/family/feed/posts'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      const payload = (await response.json().catch(() => null)) as { items?: ApiPost[] } | null
      if (!response.ok) {
        throw new Error('family_circle_load_failed')
      }
      setPosts(Array.isArray(payload?.items) ? payload.items : [])
    } catch (loadError) {
      console.error('Failed to load adult family circle feed', loadError)
      setError('Unable to load Family posts right now.')
      setPosts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPosts()
  }, [loadPosts])

  const openComposer = useCallback((type: PostType = 'post') => {
    setComposerDefaultType(type)
    setComposerOpen(true)
  }, [])

  const displayName = formatDisplayName(viewer?.name ?? null) || viewer?.handle || 'there'

  return (
    <DashboardShell rightRail={rightRail} mainClassName="space-y-6">
      <CivilComposerLauncher
        coverUrl={viewer?.coverUrl ?? null}
        avatarSrc={viewer?.avatarUrl ?? null}
        avatarAlt={displayName}
        avatarInitials={displayName}
        avatarHref={viewer?.handle ? `/u/${viewer.handle}` : undefined}
        prompt={`What's on your mind, ${displayName.split(' ')[0] ?? 'there'}?`}
        actions={[
          { type: 'post', label: 'Post', icon: '📝' },
          { type: 'article', label: 'Article', icon: '📄' },
          { type: 'poll', label: 'Poll', icon: '📊' },
          { type: 'photo', label: 'Photos', icon: '📷' },
        ]}
        onPrimaryClick={() => openComposer('post')}
        onActionClick={(type) => openComposer(type as PostType)}
      />

      <Modal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Share something new"
        key={composerDefaultType}
        maxWidthClassName="max-w-3xl"
        closeOnBackdrop={false}
        closeOnEscape={false}
      >
        <PostComposer
          me={viewer ?? null}
          defaultPostType={composerDefaultType}
          defaultAudience="family"
          allowFamilyAudience
          onPostCreated={(post) => {
            setPosts((current) => [post, ...current.filter((entry) => entry.id !== post.id)])
            setComposerOpen(false)
          }}
          variant="plain"
        />
      </Modal>

      <section className="space-y-4">
        {error ? (
          <section className="surface-card border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</section>
        ) : loading ? (
          <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">Loading Family posts…</section>
        ) : posts.length === 0 ? (
          <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">No Family posts yet.</section>
        ) : (
          posts.map((post) => (
            <PostFeedItem key={post.id} post={post} viewerId={viewer?.id ?? null} viewer={viewer ?? null} />
          ))
        )}
      </section>
    </DashboardShell>
  )
}

function FamilyMemberFriendsView() {
  const router = useRouter()
  const viewer = useViewerStore((state) => state.me)
  const familyView = useViewerStore((state) => state.familyView)
  const [friends, setFriends] = useState<FriendListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [formExpanded, setFormExpanded] = useState(false)
  const [username, setUsername] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [submitMessage, setSubmitMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [messageTargetId, setMessageTargetId] = useState<string | null>(null)
  const [callTarget, setCallTarget] = useState<{ id: string; mode: 'audio' | 'video' } | null>(null)
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null)
  const [blockTargetId, setBlockTargetId] = useState<string | null>(null)

  const loadFriends = useCallback(async () => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    try {
      const response = await fetch(buildApiUrl('/friends'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      const payload = (await response.json().catch(() => null)) as FriendsResponse | null
      if (!response.ok) {
        throw new Error(typeof payload?.items === 'string' ? payload.items : 'friends_load_failed')
      }
      setFriends(Array.isArray(payload?.items) ? payload.items : [])
    } catch (error) {
      console.error('Failed to load family member friends', error)
      pushToast('Unable to load your friends right now.', 'error')
      setFriends([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadFriends()
  }, [loadFriends])

  const childName = familyView?.displayName ?? viewer?.name ?? 'Your account'
  const parentHandle = viewer?.familyMemberSession?.parentHandle?.trim() ?? ''
  const parentName = viewer?.familyMemberSession?.parentName?.trim() || parentHandle || 'Parent account'
  const allowChildAudioCalls = viewer?.familyMemberSession?.allowChildAudioCalls == null ? true : Boolean(viewer.familyMemberSession.allowChildAudioCalls)
  const allowChildVideoCalls = viewer?.familyMemberSession?.allowChildVideoCalls == null ? true : Boolean(viewer.familyMemberSession.allowChildVideoCalls)
  const emptyAvatar = buildFamilyAvatarDataUrl(childName, familyView?.modeBand ?? 'JUNIOR')
  const emptyCover = buildFamilyCoverDataUrl(childName, familyView?.modeBand ?? 'JUNIOR')

  const renderActionMenu = useCallback(({
    label,
    tone = 'neutral',
    disabled = false,
    children,
  }: {
    label: string
    tone?: 'neutral' | 'primary'
    disabled?: boolean
    children: ReactNode
  }) => {
    const summaryClassName = clsx(
      'inline-flex w-full cursor-pointer list-none items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition sm:w-auto [&::-webkit-details-marker]:hidden',
      tone === 'primary' && 'bg-[var(--cc-primary)] text-white hover:brightness-110',
      tone === 'neutral' && 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900',
      disabled && 'cursor-not-allowed opacity-55',
    )

    if (disabled) {
      return (
        <button type="button" className={summaryClassName} disabled>
          {label}
          <HiOutlineChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
      )
    }

    return (
      <details className="group relative w-full sm:w-auto profile-action-menu">
        <summary className={summaryClassName}>
          {label}
          <HiOutlineChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className={actionMenuPanelClassName}>{children}</div>
      </details>
    )
  }, [])

  const ensureDirectThread = useCallback(async (userId: string) => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return null
    }

    const response = await fetch(buildApiUrl('/messages/threads/direct'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    })

    const payload = (await response.json().catch(() => null)) as { thread?: { id?: string | null } | null; error?: string } | null
    if (response.status === 401) {
      redirectToAuthModal('login')
      return null
    }
    if (!response.ok || !payload?.thread?.id) {
      pushToast(payload?.error ?? 'Unable to open that conversation right now.', 'error')
      return null
    }

    return payload.thread.id
  }, [])

  const handleStartMessage = useCallback(async (friend: FriendListEntry) => {
    if (friend.specialKind === 'family_sponsor') {
      router.push(`/messages?inbox=friends&thread=family-parent-${viewer?.familyMemberSession?.parentId ?? 'parent'}`)
      return
    }

    setMessageTargetId(friend.id)
    try {
      const threadId = await ensureDirectThread(friend.user.id)
      if (!threadId) return
      router.push(`/messages?inbox=friends&thread=${encodeURIComponent(threadId)}`)
    } finally {
      setMessageTargetId(null)
    }
  }, [ensureDirectThread, router, viewer?.familyMemberSession?.parentId])

  const handleStartCall = useCallback(async (friend: FriendListEntry, mode: 'audio' | 'video') => {
    if (friend.specialKind === 'family_sponsor') return
    if ((mode === 'audio' && !allowChildAudioCalls) || (mode === 'video' && !allowChildVideoCalls)) return

    setCallTarget({ id: friend.id, mode })
    try {
      const threadId = await ensureDirectThread(friend.user.id)
      if (!threadId) return

      const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      const response = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(threadId)}/call/start`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ mode }),
      })
      const payload = (await response.json().catch(() => null)) as { call?: { id?: string | null } | null; error?: string } | null
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok || !payload?.call?.id) {
        pushToast(payload?.error ?? 'Unable to start this call right now.', 'error')
        return
      }

      router.push(`/messages/call/${encodeURIComponent(threadId)}?call=${encodeURIComponent(payload.call.id)}`)
    } finally {
      setCallTarget(null)
    }
  }, [allowChildAudioCalls, allowChildVideoCalls, ensureDirectThread, router])

  const handleUnfriend = useCallback(async (friend: FriendListEntry) => {
    if (friend.specialKind === 'family_sponsor' || friend.locked) return

    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setRemoveTargetId(friend.id)
    try {
      const response = await fetch(buildApiUrl(`/friends/${encodeURIComponent(friend.id)}`), {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      const payload = (await response.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok || !payload?.success) {
        pushToast(payload?.error ?? 'Unable to remove friend.', 'error')
        return
      }
      setFriends((current) => current.filter((entry) => entry.id !== friend.id))
      pushToast('Friend removed. Your parent has been notified.', 'success')
    } finally {
      setRemoveTargetId(null)
    }
  }, [])

  const handleBlock = useCallback(async (friend: FriendListEntry) => {
    if (friend.specialKind === 'family_sponsor') return

    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setBlockTargetId(friend.id)
    try {
      const response = await fetch(buildApiUrl('/family/moderation/blocks/users'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userId: friend.user.id }),
      })
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok || payload?.ok === false) {
        pushToast(payload?.error ?? 'Unable to block this user right now.', 'error')
        return
      }
      setFriends((current) => current.filter((entry) => entry.id !== friend.id))
      pushToast('User blocked. Your parent has been notified.', 'success')
    } finally {
      setBlockTargetId(null)
    }
  }, [])

  const renderMessageMenu = useCallback((friend: FriendListEntry) => {
    const textDisabled = messageTargetId === friend.id || callTarget !== null
    const audioDisabled =
      friend.specialKind === 'family_sponsor' ||
      callTarget !== null ||
      !allowChildAudioCalls
    const videoDisabled =
      friend.specialKind === 'family_sponsor' ||
      callTarget !== null ||
      !allowChildVideoCalls

    return renderActionMenu({
      label: messageTargetId === friend.id ? 'Opening...' : 'Message',
      tone: 'primary',
      disabled: textDisabled && audioDisabled && videoDisabled,
      children: (
        <>
          <button
            type="button"
            className={actionMenuItemClassName}
            onClick={(event) => {
              closeDetailsMenu(event)
              void handleStartMessage(friend)
            }}
            disabled={textDisabled}
          >
            Text
          </button>
          <button
            type="button"
            className={actionMenuItemClassName}
            onClick={(event) => {
              closeDetailsMenu(event)
              void handleStartCall(friend, 'audio')
            }}
            disabled={audioDisabled}
          >
            <HiOutlinePhone className="h-4 w-4" aria-hidden="true" />
            {callTarget?.id === friend.id && callTarget.mode === 'audio' ? 'Calling...' : 'Audio'}
          </button>
          <button
            type="button"
            className={actionMenuItemClassName}
            onClick={(event) => {
              closeDetailsMenu(event)
              void handleStartCall(friend, 'video')
            }}
            disabled={videoDisabled}
          >
            <HiOutlineVideoCamera className="h-4 w-4" aria-hidden="true" />
            {callTarget?.id === friend.id && callTarget.mode === 'video' ? 'Starting video...' : 'Video'}
          </button>
        </>
      ),
    })
  }, [allowChildAudioCalls, allowChildVideoCalls, callTarget, handleStartCall, handleStartMessage, messageTargetId, renderActionMenu])

  const handleSubmitFriendRequest = useCallback(async () => {
    const trimmedUsername = username.trim()
    const trimmedInviteCode = inviteCode.trim()
    if (!trimmedUsername && !trimmedInviteCode) {
      pushToast('Enter a username or an invite code.', 'info')
      return
    }

    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(buildApiUrl('/family/friends/requests'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          username: trimmedUsername || undefined,
          inviteCode: trimmedInviteCode || undefined,
        }),
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null
      if (!response.ok) {
        throw new Error(payload?.error || 'family_friend_request_failed')
      }
      const message = payload?.message?.trim() || "An invite has been sent to this user's parent or guardian if it exists."
      setSubmitMessage(message)
      setUsername('')
      setInviteCode('')
      pushToast(message, 'success')
    } catch (error) {
      console.error('Failed to submit family friend request', error)
      pushToast('Unable to send that request right now.', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [inviteCode, username])

  const rightRail = (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--cc-primary)]">Friends</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-950">Family account</h2>
        <p className="mt-2 text-sm text-slate-600">Your supervised account can see approved connections here.</p>
      </section>
      <section className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">Quick Links</p>
        <div className="mt-4 grid gap-2">
          <Link href="/messages" className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900">
            Messages
          </Link>
          <Link href="/settings/guardian/settings" className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900">
            Your Settings
          </Link>
          <Link href={parentHandle ? `/u/${parentHandle}` : '/settings/guardian'} className="inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)]/5">
            {parentName}
          </Link>
        </div>
      </section>
    </div>
  )

  return (
    <DashboardShell rightRail={rightRail} showMobileRightRail mainClassName="space-y-5 pb-12">
      <section className="rounded-[28px] border border-slate-200 bg-white/90 px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--cc-primary)]">Friends</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">Your Friends</h1>
            <p className="mt-1 text-sm text-slate-600">People connected to this Family account appear here.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {friends.length} {friends.length === 1 ? 'friend' : 'friends'}
          </div>
        </div>

        <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Add Your Friends</p>
              <p className="mt-1 text-sm text-slate-600">Send a request using a friend's username or invite code.</p>
            </div>
            <button
              type="button"
              onClick={() => setFormExpanded((current) => !current)}
              className="inline-flex items-center justify-center rounded-full border border-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)]/5"
            >
              {formExpanded ? 'Hide' : 'Add Your Friends'}
            </button>
          </div>
          {formExpanded ? (
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">Enter Username</span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Username"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={submitting}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">Enter Invite Code</span>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                  placeholder="Invite Code"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={submitting}
                />
              </label>
              <button
                type="button"
                onClick={() => void handleSubmitFriendRequest()}
                className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={submitting}
              >
                {submitting ? 'Sending…' : 'Submit'}
              </button>
            </div>
          ) : null}
          {submitMessage ? (
            <p className="mt-3 rounded-2xl border border-[var(--cc-primary)]/15 bg-white px-4 py-3 text-sm text-slate-700">
              {submitMessage}
            </p>
          ) : null}
        </div>

        {loading ? (
          <div className="mt-5 max-w-3xl space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-[82px] animate-pulse rounded-[1.45rem] border border-slate-200 bg-slate-100" />
            ))}
          </div>
        ) : friends.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            No friends yet.
          </div>
        ) : (
          <ul className="mt-5 max-w-3xl space-y-4">
            {friends.map((friend) => {
              const displayName = formatDisplayName(friend.user.name ?? friend.user.handle) || friend.user.handle
              const isFamilyChildFriend = friend.specialKind === 'family_child_friend'
              const subtitle = friend.specialKind === 'family_sponsor'
                ? 'Parent account'
                : isFamilyChildFriend
                  ? friend.user.handle
                    ? `Family friend · @${friend.user.handle}`
                    : 'Family friend'
                  : `@${friend.user.handle}`
              return (
                <li key={friend.id}>
                  <CivilCard
                    size="md"
                    align="start"
                    name={displayName}
                    avatarAlt={displayName}
                    avatarInitials={displayName}
                    avatarSrc={friend.user.avatarUrl ?? emptyAvatar}
                    coverUrl={friend.user.coverUrl ?? emptyCover}
                    subtitle={subtitle}
                    isVerified={friend.user.isVerified}
                    isBusiness={friend.user.isPremium}
                    details={(
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/u/${friend.user.handle}`}
                          className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                        >
                          View Profile
                        </Link>
                        {renderMessageMenu(friend)}
                        {friend.specialKind !== 'family_sponsor' ? (
                          <button
                            type="button"
                            onClick={() => void handleUnfriend(friend)}
                            disabled={removeTargetId === friend.id || Boolean(friend.locked)}
                            className="inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {removeTargetId === friend.id ? 'Removing...' : 'Unfriend'}
                          </button>
                        ) : null}
                        {friend.specialKind !== 'family_sponsor' ? (
                          <button
                            type="button"
                            onClick={() => void handleBlock(friend)}
                            disabled={blockTargetId === friend.id}
                            className="inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {blockTargetId === friend.id ? 'Blocking...' : 'Block'}
                          </button>
                        ) : null}
                      </div>
                    )}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </DashboardShell>
  )
}

export default function FriendsHubClient() {
  const viewer = useViewerStore((state) => state.me)
  const isFamilyMemberSession = viewer?.accountType === 'family_member'

  if (isFamilyMemberSession) {
    return <FamilyMemberFriendsView />
  }

  const showFamilyNav = viewer?.accountType === 'user' && hasFamilyProfilesAvailable(viewer)
  const rightRail = (
    <div className="space-y-4">
      <MessagesNavBlock visibleItems={showFamilyNav ? ['friends', 'family', 'network', 'groups', 'market'] : undefined} />
      <FriendsRightRail />
    </div>
  )

  return (
    <FeedPageClient
      scope="friends"
      sidebarActive="friends"
      title="Friends Feed"
      description="Updates from the people you follow and trust on Civil."
      emptyState="No friend activity yet. Once your friends start posting, their updates will land here."
      emptyStateCta={{ label: 'Find Friends', href: '/search' }}
      rightRail={rightRail}
      showFeedSummary={false}
      sortOptions={[
        { value: 'new', label: 'Latest' },
        { value: 'hot', label: 'Hot' },
      ]}
      defaultSort="new"
    />
  )
}

export function FamilyHubClient() {
  const viewer = useViewerStore((state) => state.me)

  if (viewer?.accountType === 'family_member') {
    return <FamilyMemberFriendsView />
  }

  return <ParentFamilyFeedView />
}
