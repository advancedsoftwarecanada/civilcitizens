"use client"

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import CivilCard from '../../../_components/CivilCard'
import { buildApiUrl } from '../../../_lib/api'
import { redirectToAuthModal } from '../../../_lib/authModal'
import { formatUserDisplayName } from '../../../_lib/text'
import { getStoredToken } from '../../../_lib/tokenStorage'
import { pushToast } from '../../../_components/useToasts'

type RelationshipContext = 'Friend' | 'Family' | 'Network'

type ProfileRelationshipCardProps = {
  userId?: string | null
  handle?: string | null
  name?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  contextLabel: RelationshipContext
  relationshipLabel?: string | null
  since?: string | null
  subtitle?: string | null
  interactive?: boolean
}

function formatSinceLabel(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `Since ${date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
}

function ContextPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/35 bg-white/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/90">
      {children}
    </span>
  )
}

export default function ProfileRelationshipCard({
  userId,
  handle,
  name,
  avatarUrl,
  coverUrl,
  contextLabel,
  relationshipLabel,
  since,
  subtitle,
  interactive = true,
}: ProfileRelationshipCardProps) {
  const router = useRouter()
  const [messageLoading, setMessageLoading] = useState(false)
  const [callMode, setCallMode] = useState<'audio' | 'video' | null>(null)

  const displayName = formatUserDisplayName(name, handle) || handle || 'Citizen'
  const profileHref = handle ? `/u/${handle}` : undefined
  const sinceLabel = formatSinceLabel(since)
  const secondarySubtitle = subtitle?.trim() || (handle ? `@${handle}` : null)
  const canContact = Boolean(userId && handle)

  async function ensureDirectThread() {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return null
    }
    if (!userId) return null

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
      pushToast(
        payload?.error === 'not_friends'
          ? 'Direct messages require a Friend, Family, or Network relationship.'
          : payload?.error ?? 'Unable to open that conversation right now.',
        'error',
      )
      return null
    }

    return payload.thread.id
  }

  async function handleStartMessage() {
    if (!canContact || messageLoading || callMode) return
    setMessageLoading(true)
    try {
      const threadId = await ensureDirectThread()
      if (!threadId) return
      router.push(`/messages?thread=${encodeURIComponent(threadId)}`)
    } finally {
      setMessageLoading(false)
    }
  }

  async function handleStartCall(mode: 'audio' | 'video') {
    if (!canContact || messageLoading || callMode) return
    setCallMode(mode)
    try {
      const threadId = await ensureDirectThread()
      if (!threadId) return

      const token = getStoredToken()
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
      setCallMode(null)
    }
  }

  return (
    <CivilCard
      size="lg"
      align="start"
      name={displayName}
      avatarAlt={displayName}
      avatarInitials={displayName}
      avatarSrc={avatarUrl ?? null}
      avatarHref={profileHref}
      titleHref={profileHref}
      coverUrl={coverUrl ?? null}
      subtitle={secondarySubtitle}
      titleSuffix={<ContextPill>{contextLabel}</ContextPill>}
      interactive={interactive && Boolean(profileHref)}
      details={
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {relationshipLabel ? <ContextPill>{relationshipLabel}</ContextPill> : null}
            {sinceLabel ? <ContextPill>{sinceLabel}</ContextPill> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {profileHref ? (
              <Link
                href={profileHref}
                className="inline-flex items-center justify-center rounded-full border border-white/35 bg-white/12 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                View Profile
              </Link>
            ) : null}
            {canContact ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void handleStartMessage()
                  }}
                  disabled={messageLoading || Boolean(callMode)}
                  className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {messageLoading ? 'Opening...' : 'Send Message'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleStartCall('audio')
                  }}
                  disabled={messageLoading || Boolean(callMode)}
                  className="inline-flex items-center justify-center rounded-full border border-white/35 bg-white/12 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {callMode === 'audio' ? 'Calling...' : 'Audio Call'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleStartCall('video')
                  }}
                  disabled={messageLoading || Boolean(callMode)}
                  className="inline-flex items-center justify-center rounded-full border border-white/35 bg-white/12 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {callMode === 'video' ? 'Starting video...' : 'Video Call'}
                </button>
              </>
            ) : null}
          </div>
        </div>
      }
    />
  )
}