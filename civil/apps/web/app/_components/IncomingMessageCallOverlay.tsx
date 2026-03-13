'use client'

import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import VerifiedAvatar from './VerifiedAvatar'
import { subscribeToNotificationsStream, type RealtimePayload } from './notifications/notificationStream'
import { formatUserDisplayName } from '../_lib/text'

type ThreadUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  isPremium: boolean
  isVerified: boolean
}

type ThreadParticipant = {
  userId: string
  user: ThreadUser
  isViewer: boolean
}

type ThreadCall = {
  id: string
  threadId: string
  mode: 'audio' | 'video'
  initiator: ThreadUser
}

type ThreadSummary = {
  id: string
  participants: ThreadParticipant[]
}

type IncomingInvite = {
  thread: ThreadSummary
  call: ThreadCall
}

function isThreadUser(value: unknown): value is ThreadUser {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const typed = value as Record<string, unknown>
  return typeof typed.id === 'string' && typeof typed.handle === 'string'
}

function isThreadParticipant(value: unknown): value is ThreadParticipant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const typed = value as Record<string, unknown>
  return typeof typed.userId === 'string' && isThreadUser(typed.user)
}

function isIncomingInvitePayload(payload: RealtimePayload): payload is { type: 'message.call.invited'; data: IncomingInvite } {
  if (payload.type !== 'message.call.invited') return false
  const data = payload.data as Partial<IncomingInvite> | undefined
  return (
    typeof data?.call?.id === 'string' &&
    typeof data.call?.threadId === 'string' &&
    typeof data.call?.mode === 'string' &&
    isThreadUser(data.call?.initiator) &&
    typeof data?.thread?.id === 'string' &&
    Array.isArray(data.thread?.participants) &&
    data.thread.participants.every((participant) => isThreadParticipant(participant))
  )
}

export default function IncomingMessageCallOverlay() {
  const pathname = usePathname()
  const router = useRouter()
  const [invite, setInvite] = useState<IncomingInvite | null>(null)
  const dismissedCallIdsRef = useRef<Set<string>>(new Set())
  const ringtoneRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return subscribeToNotificationsStream((payload) => {
      if (isIncomingInvitePayload(payload)) {
        const nextInvite = payload.data
        if (dismissedCallIdsRef.current.has(nextInvite.call.id)) return
        const sameCallPath = pathname === `/messages/call/${nextInvite.thread.id}`
        if (sameCallPath) return
        setInvite(nextInvite)
        return
      }
      if (payload.type === 'message.call.ended') {
        const data = payload.data as { callId?: string } | undefined
        if (!data?.callId) return
        setInvite((current) => (current?.call.id === data.callId ? null : current))
      }
    })
  }, [pathname])

  useEffect(() => {
    if (!invite) {
      if (ringtoneRef.current) {
        ringtoneRef.current.pause()
        ringtoneRef.current.currentTime = 0
      }
      return
    }

    if (typeof window === 'undefined') return
    const canAttemptPlayback =
      document.visibilityState === 'visible' ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches)

    if (!canAttemptPlayback) return

    const audio = ringtoneRef.current ?? new Audio()
    if (!ringtoneRef.current) {
      const preferredSource = audio.canPlayType('audio/x-caf') ? '/ringtone.caf' : '/ringtone.mp4'
      audio.src = preferredSource
    }
    audio.loop = true
    audio.preload = 'auto'
    ringtoneRef.current = audio
    audio.currentTime = 0
    void audio.play().catch(() => undefined)

    return () => {
      audio.pause()
      audio.currentTime = 0
    }
  }, [invite])

  const visibleParticipants = useMemo(() => invite?.thread.participants.filter((participant) => !participant.isViewer).slice(0, 3) ?? [], [invite])

  if (!invite || typeof document === 'undefined') return null

  const inviterName = formatUserDisplayName(invite.call.initiator.name, invite.call.initiator.handle) || invite.call.initiator.handle
  const callLabel = invite.call.mode === 'video' ? 'Video call' : 'Audio call'

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[115] flex items-end justify-center px-3 pb-[calc(var(--mobile-dock-clearance)+1rem)] sm:items-start sm:justify-end sm:p-5">
      <div className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-[1.9rem] border border-slate-200 bg-white shadow-[0_28px_60px_rgba(15,23,42,0.22)]">
        <div className="relative overflow-hidden bg-[linear-gradient(135deg,#fff7f4_0%,#f5f9ff_52%,#ffffff_100%)] px-5 py-4">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(202,5,45,0.08),transparent_46%),radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_42%)]" />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Incoming call</p>
            <div className="mt-3 flex items-center gap-3">
              <div className="relative h-12 w-24 shrink-0">
                {visibleParticipants.map((participant, index) => {
                  const name = formatUserDisplayName(participant.user.name, participant.user.handle) || participant.user.handle
                  return (
                    <div key={participant.userId} className="absolute" style={{ left: `${index * 18}px`, zIndex: visibleParticipants.length - index }}>
                      <VerifiedAvatar
                        src={participant.user.avatarUrl}
                        alt={name}
                        initials={name}
                        size={44}
                        isVerified={participant.user.isVerified}
                        isBusiness={participant.user.isPremium}
                        className="border-2 border-white"
                      />
                    </div>
                  )
                })}
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-slate-900">{inviterName}</p>
                <p className="text-sm text-slate-500">{callLabel}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-100 bg-white px-4 py-4">
          <button
            type="button"
            onClick={() => {
              dismissedCallIdsRef.current.add(invite.call.id)
              setInvite(null)
            }}
            className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={() => {
              setInvite(null)
              router.push(`/messages/call/${encodeURIComponent(invite.thread.id)}?call=${encodeURIComponent(invite.call.id)}`)
            }}
            className="inline-flex flex-1 items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
          >
            Join
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
