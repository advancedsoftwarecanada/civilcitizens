'use client'

import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import VerifiedAvatar from './VerifiedAvatar'
import { subscribeToNotificationsStream, type RealtimePayload } from './notifications/notificationStream'
import { formatUserDisplayName } from '../_lib/text'
import { useViewerStore } from '../_lib/viewerStore'

type CallUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  isPremium: boolean
  isVerified: boolean
}

type FamilyMemberSummary = {
  id: string
  displayName: string
  username: string
  avatarUrl: string | null
  relationshipLabel: string
  modeLabel: string
}

type FamilyCall = {
  id: string
  memberId: string
  mode: 'audio' | 'video'
  initiatorActor: 'parent' | 'child'
  initiator: CallUser
}

type IncomingInvite = {
  targetRole: 'parent' | 'child' | null
  member: FamilyMemberSummary
  parent: CallUser
  call: FamilyCall
}

function isCallUser(value: unknown): value is CallUser {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const typed = value as Record<string, unknown>
  return typeof typed.id === 'string' && typeof typed.handle === 'string'
}

function isIncomingInvitePayload(payload: RealtimePayload): payload is { type: 'family.call.invited'; data: IncomingInvite } {
  if (payload.type !== 'family.call.invited') return false
  const data = payload.data as Partial<IncomingInvite> | undefined
  return (
    typeof data?.call?.id === 'string' &&
    typeof data.call?.memberId === 'string' &&
    typeof data.call?.mode === 'string' &&
    isCallUser(data.call?.initiator) &&
    typeof data?.member?.id === 'string' &&
    typeof data.member?.displayName === 'string' &&
    typeof data.member?.username === 'string' &&
    isCallUser(data?.parent)
  )
}

export default function IncomingFamilyCallOverlay() {
  const pathname = usePathname()
  const router = useRouter()
  const me = useViewerStore((state) => state.me)
  const viewerRole = me?.accountType === 'family_member' ? 'child' : me ? 'parent' : null
  const [invite, setInvite] = useState<IncomingInvite | null>(null)
  const dismissedCallIdsRef = useRef<Set<string>>(new Set())
  const ringtoneRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return subscribeToNotificationsStream((payload) => {
      if (isIncomingInvitePayload(payload)) {
        const nextInvite = payload.data
        if (dismissedCallIdsRef.current.has(nextInvite.call.id)) return
        if (viewerRole && nextInvite.targetRole && nextInvite.targetRole !== viewerRole) return
        const sameCallPath = pathname === `/family/call/${nextInvite.member.id}`
        if (sameCallPath) return
        setInvite(nextInvite)
        return
      }
      if (payload.type === 'family.call.ended') {
        const data = payload.data as { callId?: string } | undefined
        if (!data?.callId) return
        setInvite((current) => (current?.call.id === data.callId ? null : current))
      }
    })
  }, [pathname, viewerRole])

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

  const counterpart = useMemo(() => {
    if (!invite) return null
    return viewerRole === 'parent'
      ? {
          handle: invite.member.username,
          name: invite.member.displayName,
          avatarUrl: invite.member.avatarUrl,
          isPremium: false,
          isVerified: false,
        }
      : invite.parent
  }, [invite, viewerRole])

  if (!invite || typeof document === 'undefined') return null

  const inviterName = formatUserDisplayName(invite.call.initiator.name, invite.call.initiator.handle) || invite.call.initiator.handle
  const counterpartName = counterpart ? formatUserDisplayName(counterpart.name, counterpart.handle) || counterpart.handle : inviterName
  const callLabel = invite.call.mode === 'video' ? 'Video call' : 'Audio call'
  const subtitle = viewerRole === 'parent' ? `${invite.member.relationshipLabel} • ${invite.member.modeLabel}` : '@' + invite.parent.handle

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[115] flex items-end justify-center px-3 pb-[calc(var(--mobile-dock-active-clearance)+1rem)] sm:items-start sm:justify-end sm:p-5">
      <div className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-[1.9rem] border border-slate-200 bg-white shadow-[0_28px_60px_rgba(15,23,42,0.22)]">
        <div className="relative overflow-hidden bg-[linear-gradient(135deg,#f5fff8_0%,#f4f8ff_48%,#ffffff_100%)] px-5 py-4">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(22,163,74,0.10),transparent_46%),radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_42%)]" />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Incoming Family call</p>
            <div className="mt-3 flex items-center gap-3">
              <VerifiedAvatar
                src={counterpart?.avatarUrl ?? null}
                alt={counterpartName}
                initials={counterpartName}
                size={52}
                isVerified={Boolean(counterpart?.isVerified)}
                isBusiness={Boolean(counterpart?.isPremium)}
                className="shrink-0 border-2 border-white"
              />
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-slate-900">{counterpartName}</p>
                <p className="text-sm text-slate-500">{callLabel}</p>
                <p className="truncate text-xs text-slate-400">{subtitle}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">Started by {inviterName}</p>
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
              router.push(`/family/call/${encodeURIComponent(invite.member.id)}?call=${encodeURIComponent(invite.call.id)}`)
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
