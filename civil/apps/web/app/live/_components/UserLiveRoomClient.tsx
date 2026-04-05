'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  HiOutlineCheck,
  HiOutlineCog6Tooth,
  HiOutlineMicrophone,
  HiOutlineSpeakerWave,
  HiOutlineVideoCamera,
  HiOutlineXMark,
} from 'react-icons/hi2'
import CivilCard from '../../_components/CivilCard'
import DashboardShell from '../../_components/DashboardShell'
import LinkedText from '../../_components/LinkedText'
import Modal from '../../_components/Modal'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'
import { pushToast } from '../../_components/useToasts'
import UserLiveDraftEditorClient from './UserLiveDraftEditorClient'

type LiveMeeting = {
  id: string
  title: string
  description: string | null
  coverUrl: string | null
  visibility: 'PUBLIC' | 'PRIVATE'
  status: 'ACTIVE' | 'ARCHIVED'
  requiresPassword: boolean
  requiresManualAdmit: boolean
  participantCount: number | null
  canJoinNow: boolean
  blockedReason: string | null
  threadId: string | null
  admissionStatus?: 'WAITING' | 'ADMITTED' | 'DENIED' | null
  rtc?: {
    peerCount: number
    hostPresent: boolean
  } | null
  waitingParticipants?: Array<{
    userId: string
    status: 'WAITING' | 'ADMITTED'
    name: string
    handle: string | null
    avatarUrl: string | null
  }>
  speakers?: Array<{
    userId: string
    status: 'APPROVED'
    name: string
    handle: string | null
    avatarUrl: string | null
    coverUrl: string | null
  }>
  speakerRequests?: Array<{
    userId: string
    status: 'REQUESTED'
    name: string
    handle: string | null
    avatarUrl: string | null
    coverUrl: string | null
  }>
  moderatorHandles?: string[]
}

type LiveDetailResponse = {
  meeting?: LiveMeeting
  viewer?: {
    id?: string | null
    canManageMeetings?: boolean
    isOwner?: boolean
    speakerStatus?: 'REQUESTED' | 'APPROVED' | 'DECLINED' | null
  }
  host?: {
    id?: string
    handle?: string
    name?: string | null
    avatarUrl?: string | null
    coverUrl?: string | null
    href?: string
  }
  error?: unknown
}

type ThreadParticipant = {
  userId: string
  role?: string
  user?: {
    name?: string | null
    handle?: string | null
    avatarUrl?: string | null
    coverUrl?: string | null
  }
}

type ThreadMessage = {
  id: string
  body?: string | null
  createdAt: string
  sender?: {
    name?: string | null
    handle?: string | null
  }
}

type ThreadSnapshotResponse = {
  thread?: {
    participants?: ThreadParticipant[]
  }
  messages?: ThreadMessage[]
  items?: ThreadMessage[]
}

function formatTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function normalizeHandle(value: string | null | undefined) {
  return value?.trim().replace(/^@+/, '').toLowerCase() || ''
}

function displayParticipantName(participant: ThreadParticipant) {
  return participant.user?.name?.trim() || participant.user?.handle?.trim() || 'Civil user'
}

function displayHostName(host: LiveDetailResponse['host']) {
  return host?.name?.trim() || host?.handle?.trim() || 'Host'
}

function displayHostHandle(host: LiveDetailResponse['host']) {
  const handle = normalizeHandle(host?.handle)
  return handle ? `@${handle}` : null
}

function nameToInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'C'
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() || 'C'
  return `${parts[0]?.charAt(0) || ''}${parts[1]?.charAt(0) || ''}`.toUpperCase()
}

export default function UserLiveRoomClient({ handle, spaceId }: { handle: string; spaceId: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [data, setData] = useState<LiveDetailResponse | null>(null)
  const [joinPassword, setJoinPassword] = useState('')
  const [joining, setJoining] = useState(false)
  const [participants, setParticipants] = useState<ThreadParticipant[]>([])
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [sendingChat, setSendingChat] = useState(false)
  const [chatAutoFollow, setChatAutoFollow] = useState(true)
  const chatScrollerRef = useRef<HTMLDivElement | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const [manageModalOpen, setManageModalOpen] = useState(false)
  const [confirmModal, setConfirmModal] = useState<null | 'leave' | 'end'>(null)
  const [deviceActionPending, setDeviceActionPending] = useState(false)
  const [roomActionPending, setRoomActionPending] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [micEnabled, setMicEnabled] = useState(false)
  const [speakerEnabled, setSpeakerEnabled] = useState(true)
  const [hasExitedRoom, setHasExitedRoom] = useState(false)

  async function loadThread(threadId: string) {
    const token = getStoredToken()
    if (!token) return

    try {
      const res = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(threadId)}`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) return

      const parsed = await parseApiResponse(res)
      const json = parsed.json as ThreadSnapshotResponse | null
      setParticipants(Array.isArray(json?.thread?.participants) ? json.thread.participants : [])
      setMessages(Array.isArray(json?.messages) ? json.messages : Array.isArray(json?.items) ? json.items : [])
    } catch (error) {
      console.error('live_thread_load_failed', error)
    }
  }

  async function loadRoom() {
    setStatus('loading')
    const token = getStoredToken()

    try {
      const fetchDetail = (authToken: string | null) =>
        fetch(buildApiUrl(`/users/${encodeURIComponent(handle)}/live/${encodeURIComponent(spaceId)}`), {
          headers: authToken ? { authorization: `Bearer ${authToken}` } : undefined,
          cache: 'no-store',
        })

      let res = await fetchDetail(token)
      if (res.status === 401 && token) {
        res = await fetchDetail(null)
      }

      const parsed = await parseApiResponse(res)
      const json = parsed.json as LiveDetailResponse | null
      const text = parsed.text

      if (!res.ok) {
        console.warn('live_room_load_failed', json || text)
        setData(json ?? { error: text || 'live_room_load_failed' })
        setStatus('ready')
        return
      }

      setData(json ?? {})
      setStatus('ready')
    } catch (error) {
      console.error('live_room_load_failed', error)
      setData({ error: 'live_room_load_failed' })
      setStatus('ready')
    }
  }

  useEffect(() => {
    void loadRoom()
  }, [handle, spaceId])

  useEffect(() => {
    const threadId = data?.meeting?.threadId
    if (!threadId) return
    void loadThread(threadId)
  }, [data?.meeting?.threadId])

  useEffect(() => {
    return () => {
      const stream = localStreamRef.current
      if (!stream) return
      for (const track of stream.getTracks()) track.stop()
      localStreamRef.current = null
    }
  }, [])

  useEffect(() => {
    const node = chatScrollerRef.current
    if (!node) return
    if (!chatAutoFollow) return
    node.scrollTop = node.scrollHeight
  }, [chatAutoFollow, messages])

  const handleChatScroll = useCallback(() => {
    const node = chatScrollerRef.current
    if (!node) return
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    setChatAutoFollow(distanceFromBottom <= 48)
  }, [])

  async function joinRoom() {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setJoining(true)
    try {
      const res = await fetch(buildApiUrl(`/live/spaces/${encodeURIComponent(spaceId)}/join`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ password: joinPassword.trim() || null }),
      })

      const parsed = await parseApiResponse(res)
      const json = parsed.json as (LiveDetailResponse & { state?: string; error?: unknown }) | null
      const text = parsed.text

      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok) {
        pushToast(typeof json?.error === 'string' ? json.error : text || 'Unable to join this live room.', 'error')
        return
      }

      setData(json)
      setJoinPassword('')
      if (json?.meeting?.threadId) {
        await loadThread(json.meeting.threadId)
      }
      pushToast(json?.state === 'waiting' ? 'Join request sent.' : 'Joined live room.', 'success')
    } catch (error) {
      console.error('live_room_join_failed', error)
      pushToast('Unable to join this live room right now.', 'error')
    } finally {
      setJoining(false)
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = chatDraft.trim()
    const threadId = data?.meeting?.threadId
    const token = getStoredToken()
    if (!body || !threadId || !token) return

    setSendingChat(true)
    try {
      const res = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(threadId)}/messages`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ body }),
      })

      const parsed = await parseApiResponse(res)
      const json = parsed.json as { error?: unknown } | null
      const text = parsed.text

      if (!res.ok) {
        pushToast(typeof json?.error === 'string' ? json.error : text || 'Unable to send message.', 'error')
        return
      }

      setChatDraft('')
      setChatAutoFollow(true)
      await loadThread(threadId)
    } catch (error) {
      console.error('live_room_chat_send_failed', error)
      pushToast('Unable to send message right now.', 'error')
    } finally {
      setSendingChat(false)
    }
  }

  async function moderateParticipant(userId: string, action: 'admit' | 'ban' | 'kick') {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    try {
      const res = await fetch(buildApiUrl(`/live/spaces/${encodeURIComponent(spaceId)}/participants/${encodeURIComponent(userId)}/${action}`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })

      const parsed = await parseApiResponse(res)
      const json = parsed.json as { error?: unknown } | null
      const text = parsed.text

      if (!res.ok) {
        pushToast(typeof json?.error === 'string' ? json.error : text || `Unable to ${action} participant.`, 'error')
        return
      }

      await loadRoom()
      if (data?.meeting?.threadId) {
        await loadThread(data.meeting.threadId)
      }
      pushToast(action === 'admit' ? 'Participant admitted.' : action === 'ban' ? 'Participant banned.' : 'Participant removed.', 'success')
    } catch (error) {
      console.error('live_room_participant_action_failed', error)
      pushToast(`Unable to ${action} participant right now.`, 'error')
    }
  }

  async function refreshRoomAndThread() {
    await loadRoom()
    const threadId = data?.meeting?.threadId ?? meeting?.threadId
    if (threadId) {
      await loadThread(threadId)
    }
  }

  async function requestToSpeak() {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    try {
      const res = await fetch(buildApiUrl(`/live/spaces/${encodeURIComponent(spaceId)}/speakers/request`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })

      const parsed = await parseApiResponse(res)
      const json = parsed.json as { error?: unknown } | null
      const text = parsed.text
      if (!res.ok) {
        pushToast(typeof json?.error === 'string' ? json.error : text || 'Unable to request to speak.', 'error')
        return
      }

      await refreshRoomAndThread()
      pushToast('Speak request sent.', 'success')
    } catch (error) {
      console.error('live_room_speaker_request_failed', error)
      pushToast('Unable to request to speak right now.', 'error')
    }
  }

  async function reviewSpeakerRequest(userId: string, action: 'approve' | 'decline') {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    try {
      const res = await fetch(buildApiUrl(`/live/spaces/${encodeURIComponent(spaceId)}/speakers/${encodeURIComponent(userId)}/${action}`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })

      const parsed = await parseApiResponse(res)
      const json = parsed.json as { error?: unknown } | null
      const text = parsed.text
      if (!res.ok) {
        pushToast(typeof json?.error === 'string' ? json.error : text || `Unable to ${action} speaker request.`, 'error')
        return
      }

      await refreshRoomAndThread()
      pushToast(action === 'approve' ? 'Speaker approved.' : 'Speaker request declined.', 'success')
    } catch (error) {
      console.error('live_room_speaker_review_failed', error)
      pushToast(`Unable to ${action} speaker request right now.`, 'error')
    }
  }

  async function ensureLocalMedia(nextMicEnabled: boolean, nextCameraEnabled: boolean) {
    if (!nextMicEnabled && !nextCameraEnabled) {
      const stream = localStreamRef.current
      if (stream) {
        for (const track of stream.getTracks()) {
          track.enabled = false
        }
      }
      return true
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      pushToast('This browser does not support camera or microphone access.', 'error')
      return false
    }

    setDeviceActionPending(true)
    try {
      let stream = localStreamRef.current
      const hasAudioTrack = Boolean(stream?.getAudioTracks().length)
      const hasVideoTrack = Boolean(stream?.getVideoTracks().length)

      if ((nextMicEnabled && !hasAudioTrack) || (nextCameraEnabled && !hasVideoTrack)) {
        const freshStream = await navigator.mediaDevices.getUserMedia({
          audio: nextMicEnabled,
          video: nextCameraEnabled,
        })
        if (stream) {
          for (const track of freshStream.getTracks()) stream.addTrack(track)
        } else {
          stream = freshStream
          localStreamRef.current = freshStream
        }
      }

      for (const track of stream?.getAudioTracks() ?? []) track.enabled = nextMicEnabled
      for (const track of stream?.getVideoTracks() ?? []) track.enabled = nextCameraEnabled
      return true
    } catch (error) {
      console.error('live_room_media_prepare_failed', error)
      pushToast('Unable to access camera or microphone. Check browser permissions.', 'error')
      return false
    } finally {
      setDeviceActionPending(false)
    }
  }

  async function toggleCamera() {
    const nextValue = !cameraEnabled
    const ok = await ensureLocalMedia(micEnabled, nextValue)
    if (!ok) return
    setCameraEnabled(nextValue)
  }

  async function toggleMic() {
    const nextValue = !micEnabled
    const ok = await ensureLocalMedia(nextValue, cameraEnabled)
    if (!ok) return
    setMicEnabled(nextValue)
  }

  function openDeviceSettings(kind: 'camera' | 'microphone' | 'speaker') {
    pushToast(`${kind.charAt(0).toUpperCase()}${kind.slice(1)} device picker is not wired for live spaces yet.`, 'info')
  }

  async function leaveOrEndRoom(action: 'leave' | 'end') {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setRoomActionPending(true)
    try {
      const res = await fetch(buildApiUrl(`/live/spaces/${encodeURIComponent(spaceId)}/${action}`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })

      const parsed = await parseApiResponse(res)
      const json = parsed.json as { error?: unknown; state?: string } | null
      const text = parsed.text
      if (!res.ok) {
        pushToast(typeof json?.error === 'string' ? json.error : text || `Unable to ${action === 'end' ? 'end live' : 'leave room'}.`, 'error')
        return
      }

      const stream = localStreamRef.current
      if (stream) {
        for (const track of stream.getTracks()) track.stop()
        localStreamRef.current = null
      }
      setCameraEnabled(false)
      setMicEnabled(false)
      setConfirmModal(null)

      if (action === 'leave') {
        setHasExitedRoom(true)
        setParticipants((current) => current.filter((participant) => participant.userId !== data?.viewer?.id))
        pushToast(json?.state === 'archived' ? 'Host left. The room is now closed.' : 'Exited live room.', 'success')
        return
      }

      await refreshRoomAndThread()
      pushToast('Live ended.', 'success')
    } catch (error) {
      console.error('live_room_action_failed', error)
      pushToast(action === 'end' ? 'Unable to end live right now.' : 'Unable to leave room right now.', 'error')
    } finally {
      setRoomActionPending(false)
    }
  }

  const handleMeetingSaved = useCallback((nextMeeting: LiveMeeting) => {
    setData((current) => {
      if (!current) return { meeting: nextMeeting }
      return {
        ...current,
        meeting: {
          ...current.meeting,
          ...nextMeeting,
        },
      }
    })
  }, [])

  const meeting = data?.meeting ?? null
  const canManage = Boolean(data?.viewer?.canManageMeetings)
  const isOwner = Boolean(data?.viewer?.isOwner)
  const hasChat = Boolean(meeting?.threadId)
  const waitingParticipants = Array.isArray(meeting?.waitingParticipants) ? meeting.waitingParticipants : []
  const approvedSpeakerEntries = Array.isArray(meeting?.speakers) ? meeting.speakers : []
  const requestedSpeakerEntries = Array.isArray(meeting?.speakerRequests) ? meeting.speakerRequests : []
  const participantCountLabel = participants.length > 0 ? participants.length : (meeting?.participantCount ?? 0)
  const viewerId = data?.viewer?.id?.trim() || ''
  const viewerSpeakerStatus = data?.viewer?.speakerStatus ?? null
  const moderatorHandleSet = new Set((Array.isArray(meeting?.moderatorHandles) ? meeting.moderatorHandles : []).map((value) => normalizeHandle(value)).filter(Boolean))
  const hostHandle = normalizeHandle(data?.host?.handle)
  const hostId = data?.host?.id?.trim() || ''
  const approvedSpeakerIdSet = new Set(approvedSpeakerEntries.map((entry) => entry.userId).filter(Boolean))
  const requestedSpeakerIdSet = new Set(requestedSpeakerEntries.map((entry) => entry.userId).filter(Boolean))
  const cohosts = participants.filter((participant) => {
    const participantHandle = normalizeHandle(participant.user?.handle)
    const isHostParticipant = Boolean((hostId && participant.userId === hostId) || (hostHandle && participantHandle === hostHandle))
    if (isHostParticipant) return false
    return moderatorHandleSet.has(participantHandle) || participant.role === 'admin'
  })
  const guests = participants.filter((participant) => {
    const participantHandle = normalizeHandle(participant.user?.handle)
    const isHostParticipant = Boolean((hostId && participant.userId === hostId) || (hostHandle && participantHandle === hostHandle))
    if (isHostParticipant) return false
    if (moderatorHandleSet.has(participantHandle) || participant.role === 'admin') return false
    if (approvedSpeakerIdSet.has(participant.userId) || requestedSpeakerIdSet.has(participant.userId)) return false
    return true
  })
  const viewerCanManageRoom = Boolean(canManage)
  const viewerIsSpeaker = viewerSpeakerStatus === 'APPROVED'
  const viewerCanUseBottomBar = !hasExitedRoom && (isOwner || (viewerCanManageRoom && !isOwner) || viewerIsSpeaker)
  const rightRailHeightClassName = viewerCanUseBottomBar
    ? 'xl:h-[calc(100dvh-var(--cc-top-nav-offset)-8rem)]'
    : 'xl:h-[calc(100dvh-var(--cc-top-nav-offset)-2rem)]'

  function renderRoleCard(args: {
    title: string
    subtitle: string
    tone?: 'rose' | 'sky' | 'amber' | 'slate'
    children: ReactNode
  }) {
    const toneClass =
      args.tone === 'rose'
        ? 'border-rose-200 bg-rose-50/70'
        : args.tone === 'sky'
          ? 'border-sky-200 bg-sky-50/70'
          : args.tone === 'amber'
            ? 'border-amber-200 bg-amber-50/70'
            : 'border-slate-200 bg-slate-50/80'

    return (
      <section className={`rounded-3xl border p-4 ${toneClass}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-900">{args.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{args.subtitle}</p>
          </div>
        </div>
        <div className="mt-4 space-y-3">{args.children}</div>
      </section>
    )
  }

  function renderPersonChip(args: {
    key?: string
    name: string
    handle?: string | null
    meta: string
    avatarUrl?: string | null
    coverUrl?: string | null
    actionArea?: ReactNode
  }) {
    return (
      <div key={args.key} className="space-y-2">
        <CivilCard
          size="rail"
          name={args.name}
          avatarAlt={args.name}
          avatarSrc={args.avatarUrl || null}
          avatarInitials={nameToInitials(args.name)}
          coverUrl={args.coverUrl || null}
          subtitle={args.handle || args.meta}
          details={args.handle ? args.meta : undefined}
          interactive={false}
          className="border-white/80 bg-white text-slate-900 shadow-sm"
          titleClassName="text-slate-900"
          subtitleClassName="text-slate-500"
          detailsClassName="text-slate-500 uppercase tracking-[0.18em]"
        />
        {args.actionArea ? <div className="flex flex-wrap gap-2 px-2">{args.actionArea}</div> : null}
      </div>
    )
  }

  const speakerCards = approvedSpeakerEntries.map((speaker) =>
    renderPersonChip({
      key: `speaker-${speaker.userId}`,
      name: speaker.name,
      handle: speaker.handle ? `@${normalizeHandle(speaker.handle)}` : null,
      meta: 'Speaker',
      avatarUrl: speaker.avatarUrl,
      coverUrl: speaker.coverUrl,
    }),
  )

  const speakerRequestCards = requestedSpeakerEntries.map((speaker) =>
    renderPersonChip({
      key: `speaker-request-${speaker.userId}`,
      name: speaker.name,
      handle: speaker.handle ? `@${normalizeHandle(speaker.handle)}` : null,
      meta: 'Wants to speak',
      avatarUrl: speaker.avatarUrl,
      coverUrl: speaker.coverUrl,
      actionArea: viewerCanManageRoom ? (
        <>
          <button
            type="button"
            onClick={() => void reviewSpeakerRequest(speaker.userId, 'approve')}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
          >
            <HiOutlineCheck className="h-4 w-4" />
            Checkmark
          </button>
          <button
            type="button"
            onClick={() => void reviewSpeakerRequest(speaker.userId, 'decline')}
            className="inline-flex items-center gap-1 rounded-full border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:border-rose-400 hover:text-rose-700"
          >
            <HiOutlineXMark className="h-4 w-4" />
            Decline
          </button>
        </>
      ) : null,
    }),
  )

  const bottomBar = viewerCanUseBottomBar ? (
    <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white px-3 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => void toggleCamera()}
            disabled={deviceActionPending}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold ${cameraEnabled ? 'bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'text-slate-700'} disabled:opacity-50`}
          >
            <HiOutlineVideoCamera className="h-5 w-5" />
            {cameraEnabled ? 'Camera on' : 'Camera off'}
          </button>
          <span className="h-5 w-px bg-slate-200" />
          <button type="button" onClick={() => openDeviceSettings('camera')} className="px-3 py-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900" aria-label="Select camera">
            <HiOutlineCog6Tooth className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => void toggleMic()}
            disabled={deviceActionPending}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold ${micEnabled ? 'bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'text-slate-700'} disabled:opacity-50`}
          >
            <HiOutlineMicrophone className="h-5 w-5" />
            {micEnabled ? 'Mic on' : 'Mic off'}
          </button>
          <span className="h-5 w-px bg-slate-200" />
          <button type="button" onClick={() => openDeviceSettings('microphone')} className="px-3 py-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900" aria-label="Select microphone">
            <HiOutlineCog6Tooth className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setSpeakerEnabled((current) => !current)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold ${speakerEnabled ? 'bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'text-slate-700'}`}
          >
            <HiOutlineSpeakerWave className="h-5 w-5" />
            {speakerEnabled ? 'Speaker on' : 'Speaker off'}
          </button>
          <span className="h-5 w-px bg-slate-200" />
          <button type="button" onClick={() => openDeviceSettings('speaker')} className="px-3 py-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900" aria-label="Select speaker">
            <HiOutlineCog6Tooth className="h-5 w-5" />
          </button>
        </div>

        <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
          onClick={() => pushToast('Screen sharing is not wired for live spaces yet.', 'info')}
          <HiOutlineVideoCamera className="h-5 w-5" />
          Share screen
        </button>

        <button
          type="button"
          onClick={() => setConfirmModal('leave')}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--cc-primary)]/35 bg-[var(--cc-primary)]/8 px-4 py-2 text-sm font-semibold text-[var(--cc-primary)]"
        >
          <HiOutlineXMark className="h-5 w-5" />
          {isOwner ? (cohosts.length > 0 ? 'Leave room' : 'Leave and close room') : 'Exit room'}
        </button>
      </div>
    </footer>
  ) : null

  const chatRail = (
    <section className={`flex h-[min(100%,calc(100dvh-var(--cc-top-nav-offset)-3rem))] min-h-[34rem] flex-col rounded-[28px] border border-white/70 bg-white/90 p-3 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur sm:p-4 xl:fixed xl:top-[calc(var(--cc-top-nav-offset)+1rem)] xl:right-8 ${rightRailHeightClassName} xl:w-[320px] 2xl:right-[calc((100vw-96rem)/2)] 2xl:w-[360px]`}>
      <h2 className="mb-3 text-lg font-semibold text-slate-900">Chat</h2>
      <div ref={chatScrollerRef} onScroll={handleChatScroll} className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
        {!hasChat ? <p className="text-sm text-slate-500">Meeting chat unlocks after admission.</p> : null}
        {hasChat && messages.length === 0 ? <p className="text-sm text-slate-500">No messages yet.</p> : null}

        {messages.map((message) => (
          <div key={message.id} className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <p className="text-xs font-semibold opacity-90">{message.sender?.name?.trim() || message.sender?.handle?.trim() || 'Civil user'}</p>
              {message.body ? <p className="mt-0.5 whitespace-pre-wrap break-words">{message.body}</p> : null}
              <p className="mt-1 text-[11px] opacity-80">{formatTime(message.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>

      <form className="mt-3 flex items-center gap-2" onSubmit={(event) => void sendMessage(event)}>
        <input
          value={chatDraft}
          onChange={(event) => setChatDraft(event.target.value)}
          placeholder="Message room"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15"
          disabled={!hasChat}
        />
        <button
          type="submit"
          disabled={!hasChat || sendingChat || !chatDraft.trim()}
          className="rounded-xl bg-[var(--cc-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </section>
  )

  if (status !== 'ready') {
    return (
      <DashboardShell rightRail={chatRail} showMobileRightRail mainClassName="min-w-0" mainTopClassName="pt-4 md:pt-6" rightRailTopClassName="pt-4 md:pt-6" rightRailClassName={`min-h-0 ${rightRailHeightClassName}`}>
        <p className="text-sm text-slate-500">Loading live room...</p>
      </DashboardShell>
    )
  }

  if (!meeting) {
    return (
      <DashboardShell rightRail={chatRail} showMobileRightRail mainClassName="min-w-0" mainTopClassName="pt-4 md:pt-6" rightRailTopClassName="pt-4 md:pt-6" rightRailClassName={`min-h-0 ${rightRailHeightClassName}`}>
        <p className="text-sm text-slate-500">This live room could not be found.</p>
      </DashboardShell>
    )
  }

  return (
    <>
    <DashboardShell rightRail={chatRail} showMobileRightRail mainClassName={`min-w-0 space-y-6 ${viewerCanUseBottomBar ? 'pb-28' : ''}`} mainTopClassName="pt-4 md:pt-6" rightRailTopClassName="pt-4 md:pt-6" rightRailClassName={`min-h-0 ${rightRailHeightClassName}`}>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 overflow-hidden rounded-[28px] border border-slate-200 bg-slate-100">
          {meeting.coverUrl ? (
            <img src={meeting.coverUrl} alt={`${meeting.title} cover`} className="h-52 w-full object-cover" />
          ) : (
            <div className="flex h-52 items-center justify-center bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_36%),linear-gradient(135deg,_rgba(241,245,249,1),_rgba(226,232,240,0.92))] px-6 text-center text-sm text-slate-500">
              No room cover yet.
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-slate-900">{meeting.title}</h1>
            <LinkedText
              text={meeting.description}
              emptyFallback="No description yet."
              className="max-w-3xl text-sm text-slate-600"
              linkClassName="font-medium text-[var(--cc-primary)] hover:text-[var(--cc-primary)]/85 hover:underline"
            />
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-500">
            <span className={`rounded-full px-3 py-1 ${meeting.status === 'ACTIVE' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{meeting.status === 'ACTIVE' ? 'Live' : 'Ended'}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">{meeting.visibility === 'PRIVATE' ? 'Private' : 'Public'}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">{meeting.participantCount ?? 0} participants</span>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          {isOwner ? (
            <button
              type="button"
              onClick={() => setManageModalOpen(true)}
              className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
            >
              Manage space
            </button>
          ) : null}
          {data?.host?.href ? <Link href={data.host.href} className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900">Copyable room link</Link> : null}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">People in the room</h2>
        <p className="mt-2 text-sm text-slate-600">{participantCountLabel} people are connected or admitted to this space.</p>
        <div className="mt-5 space-y-4">
          {renderRoleCard({
            title: 'Host',
            subtitle: 'Room owner',
            tone: 'rose',
            children: renderPersonChip({
              key: hostId || hostHandle || 'host',
              name: displayHostName(data?.host),
              handle: displayHostHandle(data?.host),
              meta: 'Host',
              avatarUrl: data?.host?.avatarUrl,
              coverUrl: data?.host?.coverUrl,
            }),
          })}
          {renderRoleCard({
            title: 'Co-hosts',
            subtitle: 'Moderators helping run the room',
            tone: 'sky',
            children:
              cohosts.length > 0 ? (
                <>
                  {cohosts.map((participant) =>
                    renderPersonChip({
                      key: participant.userId,
                      name: displayParticipantName(participant),
                      handle: normalizeHandle(participant.user?.handle) ? `@${normalizeHandle(participant.user?.handle)}` : null,
                      meta: 'Co-host',
                      avatarUrl: participant.user?.avatarUrl,
                      coverUrl: participant.user?.coverUrl,
                    }),
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">No co-hosts assigned yet.</p>
              ),
          })}
          {renderRoleCard({
            title: 'Speakers',
            subtitle: 'On-stage voices',
            tone: 'amber',
            children:
              speakerCards.length > 0 || speakerRequestCards.length > 0 ? (
                <>
                  {speakerCards}
                  {speakerRequestCards}
                </>
              ) : (
                <p className="text-sm text-slate-500">No speakers on stage yet.</p>
              ),
          })}
          {renderRoleCard({
            title: 'Guests',
            subtitle: 'Listeners and participants in the room',
            tone: 'slate',
            children:
              guests.length > 0 ? (
                <>
                  {guests.map((participant) =>
                    renderPersonChip({
                      key: participant.userId,
                      name: displayParticipantName(participant),
                      handle: normalizeHandle(participant.user?.handle) ? `@${normalizeHandle(participant.user?.handle)}` : null,
                      meta: 'Guest',
                      avatarUrl: participant.user?.avatarUrl,
                      coverUrl: participant.user?.coverUrl,
                      actionArea:
                        viewerId && participant.userId === viewerId && !viewerCanManageRoom ? (
                          viewerSpeakerStatus === 'REQUESTED' ? (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700">Request pending</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void requestToSpeak()}
                              className="inline-flex items-center rounded-full bg-[var(--cc-primary)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                            >
                              Request to speak
                            </button>
                          )
                        ) : null,
                    }),
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">No guests in the room yet.</p>
              ),
          })}
        </div>
      </section>

      {canManage && waitingParticipants.length > 0 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">Waiting room</h3>
          <div className="mt-4 space-y-3">
            {waitingParticipants.map((participant) => (
              <div key={participant.userId} className="rounded-2xl border border-slate-200 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">{participant.name}</p>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{participant.status}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {participant.status === 'WAITING' ? <button type="button" onClick={() => void moderateParticipant(participant.userId, 'admit')} className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500">Admit</button> : null}
                  <button type="button" onClick={() => void moderateParticipant(participant.userId, participant.status === 'WAITING' ? 'ban' : 'kick')} className="inline-flex items-center justify-center rounded-full border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:border-rose-400 hover:text-rose-700">
                    {participant.status === 'WAITING' ? 'Deny' : 'Remove'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Modal open={manageModalOpen} onClose={() => setManageModalOpen(false)} title="Manage live space" maxWidthClassName="max-w-5xl">
        <UserLiveDraftEditorClient spaceId={meeting.id} onSaved={handleMeetingSaved} />
      </Modal>
    </DashboardShell>
    {bottomBar}

    <Modal
      open={confirmModal !== null}
      onClose={() => setConfirmModal(null)}
      title={confirmModal === 'end' ? 'End live?' : 'Leave room?'}
      maxWidthClassName="max-w-md"
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {confirmModal === 'end'
            ? 'This will archive the live space and disconnect everyone still connected.'
            : isOwner
              ? cohosts.length > 0
                ? 'You will leave the live room and stop your camera, microphone, and speaker session. Because a co-host is still in the room, the live space will remain open.'
                : 'You will leave the live room and stop your camera, microphone, and speaker session. With no co-host remaining, the room will be closed.'
              : 'You will leave the live room and stop your current camera, microphone, and speaker session.'}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmModal(null)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void leaveOrEndRoom(confirmModal === 'end' ? 'end' : 'leave')}
            disabled={roomActionPending}
            className="rounded-xl bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {roomActionPending ? 'Working...' : confirmModal === 'end' ? 'End live' : isOwner ? (cohosts.length > 0 ? 'Leave room' : 'Leave and close room') : 'Exit room'}
          </button>
        </div>
      </div>
    </Modal>
    </>
  )
}