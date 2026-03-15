"use client"

import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HiOutlineChatBubbleOvalLeft, HiOutlineChevronDown, HiOutlinePhone, HiOutlineVideoCamera } from 'react-icons/hi2'
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

type MessageMenuPosition = {
  top: number
  left: number
  width: number
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
  const [messageMenuOpen, setMessageMenuOpen] = useState(false)
  const [messageMenuPosition, setMessageMenuPosition] = useState<MessageMenuPosition | null>(null)
  const messageMenuRef = useRef<HTMLDivElement | null>(null)
  const messageButtonRef = useRef<HTMLButtonElement | null>(null)

  const displayName = formatUserDisplayName(name, handle) || handle || 'Citizen'
  const profileHref = handle ? `/u/${handle}` : undefined
  const sinceLabel = formatSinceLabel(since)
  const secondarySubtitle = subtitle?.trim() || (handle ? `@${handle}` : null)
  const canContact = Boolean(userId && handle)

  const actionButtonClassName = 'inline-flex items-center justify-center rounded-full border border-white/35 bg-white/12 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60'
  const primaryActionButtonClassName = 'inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60'
  const dropdownItemClassName = 'inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
  const dropdownPrimaryItemClassName = 'inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60'

  useEffect(() => {
    if (!messageMenuOpen) return

    const updateMenuPosition = () => {
      const trigger = messageButtonRef.current
      if (!trigger || typeof window === 'undefined') return

      const rect = trigger.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const desiredWidth = Math.max(rect.width, 240)
      const maxLeft = Math.max(12, viewportWidth - desiredWidth - 12)
      const left = Math.min(Math.max(12, rect.left), maxLeft)

      setMessageMenuPosition({
        top: rect.bottom + 8,
        left,
        width: desiredWidth,
      })
    }

    updateMenuPosition()

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (messageButtonRef.current?.contains(target)) return
      if (messageMenuRef.current?.contains(target)) return
      setMessageMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMessageMenuOpen(false)
      }
    }

    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [messageMenuOpen])

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
    setMessageMenuOpen(false)
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
    setMessageMenuOpen(false)
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

  const messageMenu =
    messageMenuOpen && messageMenuPosition && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={messageMenuRef}
            className="fixed z-[120] overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white p-2 shadow-[0_20px_45px_rgba(15,23,42,0.2)]"
            style={{
              top: messageMenuPosition.top,
              left: messageMenuPosition.left,
              width: messageMenuPosition.width,
            }}
          >
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleStartMessage()
                }}
                disabled={messageLoading || Boolean(callMode)}
                className={dropdownPrimaryItemClassName}
              >
                <HiOutlineChatBubbleOvalLeft className="h-4 w-4" aria-hidden="true" />
                {messageLoading ? 'Opening...' : 'Send Message'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleStartCall('audio')
                }}
                disabled={messageLoading || Boolean(callMode)}
                className={dropdownItemClassName}
              >
                <HiOutlinePhone className="h-4 w-4" aria-hidden="true" />
                {callMode === 'audio' ? 'Calling...' : 'Audio Call'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleStartCall('video')
                }}
                disabled={messageLoading || Boolean(callMode)}
                className={dropdownItemClassName}
              >
                <HiOutlineVideoCamera className="h-4 w-4" aria-hidden="true" />
                {callMode === 'video' ? 'Starting video...' : 'Video Call'}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
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
                  className={clsx(actionButtonClassName, 'w-full sm:w-auto')}
                >
                  View Profile
                </Link>
              ) : null}
              {canContact ? (
                <div className="w-full sm:w-auto">
                  <button
                    ref={messageButtonRef}
                    type="button"
                    onClick={() => {
                      setMessageMenuOpen((current) => !current)
                    }}
                    disabled={messageLoading || Boolean(callMode)}
                    aria-expanded={messageMenuOpen}
                    className={clsx(primaryActionButtonClassName, 'w-full gap-2 sm:w-auto')}
                  >
                    <HiOutlineChatBubbleOvalLeft className="h-4 w-4" aria-hidden="true" />
                    Message
                    <HiOutlineChevronDown className={clsx('h-4 w-4 transition', messageMenuOpen && 'rotate-180')} aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        }
      />
      {messageMenu}
    </>
  )
}