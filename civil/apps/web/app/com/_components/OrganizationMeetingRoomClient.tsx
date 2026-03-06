'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { getStoredToken } from '../../_lib/tokenStorage'
import { pushToast } from '../../_components/useToasts'

type MeetingRecord = {
  id: string
  title: string
  description: string | null
  visibility: 'PUBLIC' | 'PRIVATE'
  status: 'ACTIVE' | 'ARCHIVED'
  requiresPassword: boolean
  requiresManualAdmit: boolean
  participantCount: number | null
  canJoinNow: boolean
  blockedReason: string | null
  schedule?: {
    startsAt?: string | null
    endsAt?: string | null
  }
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
}

type MeetingFetchResponse = {
  meeting?: MeetingRecord
  viewer?: {
    canManageMeetings?: boolean
  }
  error?: unknown
}

type JoinResponse = {
  state?: 'waiting' | 'joined'
  threadId?: string | null
  meeting?: MeetingRecord
  error?: unknown
}

type ChatUser = {
  id?: string
  name?: string | null
  handle?: string | null
  avatarUrl?: string | null
}

type ThreadParticipant = {
  userId: string
  role?: string
  user?: ChatUser
  isViewer?: boolean
}

type ThreadMessage = {
  id: string
  body?: string | null
  attachments?: string[]
  createdAt: string
  senderId: string
  sender?: ChatUser
  isMine?: boolean
}

type ThreadSnapshotResponse = {
  thread?: {
    participants?: ThreadParticipant[]
  }
  messages?: ThreadMessage[]
  items?: ThreadMessage[]
  error?: unknown
}

type RtcSessionResponse = {
  sessionId?: string
  token?: string
  wsUrl?: string | null
  iceServers?: unknown[]
  expiresAt?: string
  error?: unknown
}

type RtcPeer = {
  peerId: string
  userId: string
  displayName: string
  role: string
}

const DEVICE_PREFS_KEY = 'civil:meeting:device-prefs:v1'

function formatTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function initialsFrom(user: ChatUser | null | undefined, fallback = 'U') {
  const source = `${user?.name || ''} ${user?.handle || ''}`.trim()
  if (!source) return fallback
  const parts = source.split(/\s+/).filter(Boolean)
  if (!parts.length) return fallback
  const initials = parts
    .slice(0, 2)
    .map((entry) => entry.charAt(0).toUpperCase())
    .join('')
  return initials || fallback
}

function sortMessagesAscending(items: ThreadMessage[]) {
  return [...items].sort((a, b) => {
    const at = new Date(a.createdAt).getTime()
    const bt = new Date(b.createdAt).getTime()
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0
    if (Number.isNaN(at)) return -1
    if (Number.isNaN(bt)) return 1
    return at - bt
  })
}

function normalizeRtcPeer(raw: unknown): RtcPeer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const typed = raw as Record<string, unknown>
  const peerId = typeof typed.peerId === 'string' ? typed.peerId.trim() : ''
  const userId = typeof typed.userId === 'string' ? typed.userId.trim() : ''
  const displayName = typeof typed.displayName === 'string' ? typed.displayName.trim() : ''
  const role = typeof typed.role === 'string' ? typed.role.trim() : 'participant'
  if (!peerId || !userId) return null
  return {
    peerId,
    userId,
    displayName: displayName || 'Civil user',
    role: role || 'participant',
  }
}

function normalizeRtcIceServers(raw: unknown): RTCIceServer[] {
  if (!Array.isArray(raw)) return [{ urls: 'stun:stun.l.google.com:19302' }]
  const parsed = raw
    .map((entry): RTCIceServer | null => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const typed = entry as Record<string, unknown>
      const urls = typed.urls
      if (typeof urls !== 'string' && !Array.isArray(urls)) return null
      const normalized: RTCIceServer = {
        urls: Array.isArray(urls) ? urls.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : urls,
      }
      if (typeof typed.username === 'string') normalized.username = typed.username
      if (typeof typed.credential === 'string') normalized.credential = typed.credential
      if (Array.isArray(normalized.urls) && normalized.urls.length === 0) return null
      if (typeof normalized.urls === 'string' && !normalized.urls.trim()) return null
      return normalized
    })
    .filter((entry): entry is RTCIceServer => Boolean(entry))
  return parsed.length ? parsed : [{ urls: 'stun:stun.l.google.com:19302' }]
}

export default function OrganizationMeetingRoomClient({
  province,
  municipality,
  organization,
  meetingId,
}: {
  province: string
  municipality: string
  organization: string
  meetingId: string
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [meeting, setMeeting] = useState<MeetingRecord | null>(null)
  const [canManageMeetings, setCanManageMeetings] = useState(false)
  const [joinState, setJoinState] = useState<'idle' | 'joining' | 'waiting' | 'joined'>('idle')
  const [screen, setScreen] = useState<'prepare' | 'waiting' | 'room'>('prepare')
  const [password, setPassword] = useState('')
  const [hostPresentHint, setHostPresentHint] = useState<boolean | null>(null)

  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [speakerEnabled, setSpeakerEnabled] = useState(true)
  const [isPreparingMedia, setIsPreparingMedia] = useState(false)
  const [mediaReady, setMediaReady] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)

  const [rtcStatus, setRtcStatus] = useState<'idle' | 'connecting' | 'connected'>('idle')
  const [rtcPeers, setRtcPeers] = useState<RtcPeer[]>([])
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})

  const [participants, setParticipants] = useState<ThreadParticipant[]>([])
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [sendingChat, setSendingChat] = useState(false)

  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const rtcSocketRef = useRef<WebSocket | null>(null)
  const rtcLocalPeerIdRef = useRef<string | null>(null)
  const rtcPeerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const rtcIceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])
  const chatScrollerRef = useRef<HTMLDivElement | null>(null)

  const basePath = useMemo(
    () =>
      `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/meetings`,
    [province, municipality, organization],
  )

  const inviteMeeting = useCallback(async () => {
    if (typeof window === 'undefined') return
    const url = window.location.href
    const title = meeting?.title?.trim() || 'Civil Meeting Room'
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title, text: `Join ${title}`, url })
        return
      }
    } catch {
      // fallback to clipboard
    }
    try {
      await navigator.clipboard.writeText(url)
      pushToast('Meeting link copied.', 'success')
    } catch {
      pushToast('Unable to share meeting link.', 'error')
    }
  }, [meeting?.title])

  const activeThreadId = meeting?.threadId ?? null

  const participantByUserId = useMemo(() => {
    const map = new Map<string, ThreadParticipant>()
    for (const participant of participants) {
      if (!participant.userId) continue
      map.set(participant.userId, participant)
    }
    return map
  }, [participants])

  const hostPresent = useMemo(() => {
    if (rtcPeers.some((peer) => peer.role === 'manager')) return true
    if (typeof hostPresentHint === 'boolean') return hostPresentHint
    return false
  }, [hostPresentHint, rtcPeers])

  const hostWaitingParticipants = useMemo(() => {
    if (!canManageMeetings || hostPresent) return []
    const participants = Array.isArray(meeting?.waitingParticipants) ? meeting.waitingParticipants : []
    return participants
  }, [canManageMeetings, hostPresent, meeting?.waitingParticipants])

  const stagePeers = useMemo(
    () =>
      rtcPeers.map((peer) => ({
        ...peer,
        profile: participantByUserId.get(peer.userId)?.user ?? null,
      })),
    [participantByUserId, rtcPeers],
  )

  const stopLocalPreview = useCallback(() => {
    const stream = localStreamRef.current
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop()
        } catch {
          // ignore
        }
      }
    }
    localStreamRef.current = null
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null
    }
  }, [])

  const closeRtcSocket = useCallback(() => {
    const socket = rtcSocketRef.current
    if (!socket) return
    rtcSocketRef.current = null
    try {
      socket.close()
    } catch {
      // ignore
    }
  }, [])

  const clearRemoteStreamForPeer = useCallback((peerId: string) => {
    if (!peerId) return
    setRemoteStreams((prev) => {
      if (!(peerId in prev)) return prev
      const next = { ...prev }
      delete next[peerId]
      return next
    })
  }, [])

  const closePeerConnection = useCallback(
    (peerId: string) => {
      const existing = rtcPeerConnectionsRef.current.get(peerId)
      if (!existing) {
        clearRemoteStreamForPeer(peerId)
        return
      }
      rtcPeerConnectionsRef.current.delete(peerId)
      try {
        existing.onicecandidate = null
        existing.ontrack = null
        existing.onconnectionstatechange = null
        existing.close()
      } catch {
        // ignore
      }
      clearRemoteStreamForPeer(peerId)
    },
    [clearRemoteStreamForPeer],
  )

  const closeAllPeerConnections = useCallback(() => {
    const ids = Array.from(rtcPeerConnectionsRef.current.keys())
    for (const peerId of ids) {
      closePeerConnection(peerId)
    }
    rtcPeerConnectionsRef.current.clear()
    rtcLocalPeerIdRef.current = null
    setRemoteStreams({})
  }, [closePeerConnection])

  const sendRtcSignal = useCallback((targetPeerId: string, payload: unknown) => {
    const socket = rtcSocketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(
        JSON.stringify({
          type: 'signal',
          targetPeerId,
          payload,
        }),
      )
    } catch {
      // ignore send failures
    }
  }, [])

  const shouldInitiateOffer = useCallback((targetPeerId: string) => {
    const localPeerId = rtcLocalPeerIdRef.current
    if (!localPeerId) return true
    return localPeerId > targetPeerId
  }, [])

  const applyLocalTracksToPeerConnections = useCallback((stream: MediaStream | null) => {
    if (!stream) return
    const tracksByKind = new Map<string, MediaStreamTrack>()
    for (const track of stream.getTracks()) {
      tracksByKind.set(track.kind, track)
    }

    for (const pc of rtcPeerConnectionsRef.current.values()) {
      const existingSenders = pc.getSenders()
      for (const sender of existingSenders) {
        if (!sender.track) continue
        const replacement = tracksByKind.get(sender.track.kind)
        if (replacement && sender.track.id !== replacement.id) {
          void sender.replaceTrack(replacement).catch(() => undefined)
        }
      }

      for (const track of stream.getTracks()) {
        const hasSender = existingSenders.some((sender) => sender.track?.id === track.id)
        if (!hasSender) {
          try {
            pc.addTrack(track, stream)
          } catch {
            // ignore duplicate track errors
          }
        }
      }
    }
  }, [])

  const ensurePeerConnection = useCallback(
    (targetPeerId: string) => {
      const existing = rtcPeerConnectionsRef.current.get(targetPeerId)
      if (existing) return existing

      const connection = new RTCPeerConnection({ iceServers: rtcIceServersRef.current })
      const stream = localStreamRef.current
      if (stream) {
        for (const track of stream.getTracks()) {
          try {
            connection.addTrack(track, stream)
          } catch {
            // ignore addTrack failures for duplicate senders
          }
        }
      }

      connection.onicecandidate = (event) => {
        if (!event.candidate) return
        sendRtcSignal(targetPeerId, {
          type: 'ice-candidate',
          candidate: event.candidate,
        })
      }

      connection.ontrack = (event) => {
        const [streamFromTrack] = event.streams
        if (!streamFromTrack) return
        setRemoteStreams((prev) => {
          if (prev[targetPeerId] === streamFromTrack) return prev
          return { ...prev, [targetPeerId]: streamFromTrack }
        })
      }

      connection.onconnectionstatechange = () => {
        const state = connection.connectionState
        if (state === 'closed' || state === 'failed' || state === 'disconnected') {
          closePeerConnection(targetPeerId)
        }
      }

      rtcPeerConnectionsRef.current.set(targetPeerId, connection)
      return connection
    },
    [closePeerConnection, sendRtcSignal],
  )

  const sendRtcOfferToPeer = useCallback(
    async (targetPeerId: string) => {
      const connection = ensurePeerConnection(targetPeerId)
      if (connection.signalingState !== 'stable') return
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)
      sendRtcSignal(targetPeerId, {
        type: 'offer',
        description: connection.localDescription ? connection.localDescription.toJSON() : offer,
      })
    },
    [ensurePeerConnection, sendRtcSignal],
  )

  const handleRtcSignal = useCallback(
    async (fromPeerId: string, rawPayload: unknown) => {
      if (!fromPeerId || !rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return
      const payload = rawPayload as Record<string, unknown>
      const signalType = typeof payload.type === 'string' ? payload.type : ''
      if (!signalType) return

      const connection = ensurePeerConnection(fromPeerId)

      if (signalType === 'offer') {
        const description = payload.description
        if (!description || typeof description !== 'object' || Array.isArray(description)) return
        await connection.setRemoteDescription(description as RTCSessionDescriptionInit)
        const answer = await connection.createAnswer()
        await connection.setLocalDescription(answer)
        sendRtcSignal(fromPeerId, {
          type: 'answer',
          description: connection.localDescription ? connection.localDescription.toJSON() : answer,
        })
        return
      }

      if (signalType === 'answer') {
        const description = payload.description
        if (!description || typeof description !== 'object' || Array.isArray(description)) return
        await connection.setRemoteDescription(description as RTCSessionDescriptionInit)
        return
      }

      if (signalType === 'ice-candidate') {
        const candidate = payload.candidate
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return
        await connection.addIceCandidate(candidate as RTCIceCandidateInit)
      }
    },
    [ensurePeerConnection, sendRtcSignal],
  )

  const loadMeeting = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = Boolean(options?.silent)
      if (!silent) setStatus('loading')
      try {
        const token = getStoredToken()
        const res = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/meetings/${encodeURIComponent(meetingId)}`,
          ),
          {
            headers: token ? { authorization: `Bearer ${token}` } : undefined,
            cache: 'no-store',
          },
        )
        const { json, text } = await parseApiResponse<MeetingFetchResponse>(res)
        if (!res.ok || !json?.meeting) {
          if (!silent) {
            console.warn('meeting_room_load_failed', json || text)
            setStatus('error')
          }
          return null
        }
        setMeeting(json.meeting)
        setCanManageMeetings(Boolean(json.viewer?.canManageMeetings))
        if (typeof json.meeting.rtc?.hostPresent === 'boolean') {
          setHostPresentHint(json.meeting.rtc.hostPresent)
        }
        if (!silent) setStatus('ready')
        return json.meeting
      } catch (err) {
        if (!silent) {
          console.error('meeting_room_load_failed', err)
          setStatus('error')
        }
        return null
      }
    },
    [meetingId, municipality, organization, province],
  )

  const loadThreadSnapshot = useCallback(async () => {
    if (!activeThreadId) return
    const token = getStoredToken()
    if (!token) return
    setChatLoading(true)
    try {
      const res = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(activeThreadId)}`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const { json } = await parseApiResponse<ThreadSnapshotResponse>(res)
      if (!res.ok) return
      if (Array.isArray(json?.thread?.participants)) {
        setParticipants(json.thread.participants)
      }
      const loadedMessages = Array.isArray(json?.messages) ? json.messages : Array.isArray(json?.items) ? json.items : []
      setMessages(sortMessagesAscending(loadedMessages))
    } catch {
      // ignore polling errors
    } finally {
      setChatLoading(false)
    }
  }, [activeThreadId])

  const refreshThreadMessages = useCallback(async () => {
    if (!activeThreadId) return
    const token = getStoredToken()
    if (!token) return
    try {
      const res = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(activeThreadId)}/messages`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const { json } = await parseApiResponse<ThreadSnapshotResponse>(res)
      if (!res.ok) return
      const loadedMessages = Array.isArray(json?.items) ? json.items : []
      setMessages(sortMessagesAscending(loadedMessages))
    } catch {
      // ignore polling errors
    }
  }, [activeThreadId])

  const connectRtc = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if ((micEnabled || cameraEnabled) && !mediaReady) {
      const prepared = await prepareLocalMedia()
      if (!prepared) {
        pushToast('Allow camera/microphone access, then try Connect A/V again.', 'error')
        return
      }
    }
    setRtcStatus('connecting')
    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/meetings/${encodeURIComponent(meetingId)}/rtc/session`,
        ),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            displayName: null,
            deviceId: null,
            capabilities: { audio: micEnabled, video: cameraEnabled },
          }),
        },
      )
      const { json, text } = await parseApiResponse<RtcSessionResponse>(res)
      if (res.status === 401) {
        redirectToAuthModal('login')
        setRtcStatus('idle')
        return
      }
      if (!res.ok) {
        const message = typeof json?.error === 'string' ? json.error : text || 'Unable to start A/V.'
        pushToast(message, 'error')
        setRtcStatus('idle')
        return
      }

      rtcIceServersRef.current = normalizeRtcIceServers(json?.iceServers)

      const wsUrl = typeof json?.wsUrl === 'string' ? json.wsUrl : ''
      if (!wsUrl) {
        setRtcStatus('connected')
        return
      }

      closeRtcSocket()

      const socket = new WebSocket(wsUrl)
      rtcSocketRef.current = socket

      socket.onopen = () => {
        setRtcStatus('connected')
      }

      socket.onmessage = (event) => {
        let payload: any = null
        try {
          payload = JSON.parse(String(event.data || ''))
        } catch {
          return
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
        const type = typeof payload.type === 'string' ? payload.type : ''
        if (type === 'hello') {
          rtcLocalPeerIdRef.current = typeof payload.peerId === 'string' ? payload.peerId : null
          const peers = Array.isArray(payload.peers) ? payload.peers.map(normalizeRtcPeer).filter(Boolean) : []
          setRtcPeers(peers as RtcPeer[])
          for (const peer of peers as RtcPeer[]) {
            if (!shouldInitiateOffer(peer.peerId)) continue
            void sendRtcOfferToPeer(peer.peerId).catch((err) => {
              console.error('meeting_rtc_offer_failed', err)
            })
          }
          return
        }
        if (type === 'peer.joined') {
          const peer = normalizeRtcPeer(payload.peer)
          if (!peer) return
          setRtcPeers((prev) => {
            if (prev.some((entry) => entry.peerId === peer.peerId)) return prev
            return [...prev, peer]
          })
          if (shouldInitiateOffer(peer.peerId)) {
            void sendRtcOfferToPeer(peer.peerId).catch((err) => {
              console.error('meeting_rtc_offer_failed', err)
            })
          }
          return
        }
        if (type === 'signal') {
          const fromPeerId = typeof payload.fromPeerId === 'string' ? payload.fromPeerId : ''
          void handleRtcSignal(fromPeerId, payload.payload).catch((err) => {
            console.error('meeting_rtc_signal_failed', err)
          })
          return
        }
        if (type === 'peer.left') {
          const peerId = typeof payload.peerId === 'string' ? payload.peerId : ''
          if (!peerId) return
          closePeerConnection(peerId)
          setRtcPeers((prev) => prev.filter((entry) => entry.peerId !== peerId))
          return
        }
      }

      socket.onclose = () => {
        closeAllPeerConnections()
        setRtcStatus('idle')
        setRtcPeers([])
      }

      socket.onerror = () => {
        setRtcStatus('idle')
      }
    } catch (err) {
      console.error('meeting_rtc_session_failed', err)
      pushToast('Unable to start A/V right now.', 'error')
      setRtcStatus('idle')
    }
  }, [
    cameraEnabled,
    closeAllPeerConnections,
    closePeerConnection,
    closeRtcSocket,
    handleRtcSignal,
    mediaReady,
    meetingId,
    micEnabled,
    municipality,
    organization,
    province,
    sendRtcOfferToPeer,
    shouldInitiateOffer,
  ])

  const prepareLocalMedia = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMediaError('Camera and microphone are not available in this browser.')
      return false
    }
    if (!micEnabled && !cameraEnabled) {
      stopLocalPreview()
      setMediaReady(false)
      setMediaError('Enable microphone or camera to prepare A/V.')
      return false
    }
    setIsPreparingMedia(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micEnabled,
        video: cameraEnabled,
      })
      stopLocalPreview()
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        void localVideoRef.current.play().catch(() => undefined)
      }
      applyLocalTracksToPeerConnections(stream)
      setMediaReady(true)
      setMediaError(null)
      return true
    } catch (err) {
      console.error('meeting_local_media_failed', err)
      setMediaReady(false)
      setMediaError('Unable to access camera or microphone. Check browser permissions.')
      return false
    } finally {
      setIsPreparingMedia(false)
    }
  }, [applyLocalTracksToPeerConnections, cameraEnabled, micEnabled, stopLocalPreview])

  const joinMeeting = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setJoinState('joining')
    try {
      if ((micEnabled || cameraEnabled) && !mediaReady) {
        const prepared = await prepareLocalMedia()
        if (!prepared) {
          setJoinState('idle')
          pushToast('Allow camera/microphone access to join, or turn both off.', 'error')
          return
        }
      }
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/governance/meetings/${encodeURIComponent(meetingId)}/join`,
        ),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ password: password.trim() ? password.trim() : null }),
        },
      )
      const { json, text } = await parseApiResponse<JoinResponse>(res)
      if (res.status === 401) {
        redirectToAuthModal('login')
        setJoinState('idle')
        return
      }
      if (!res.ok) {
        const message = typeof (json as { error?: unknown } | null)?.error === 'string' ? String((json as { error: string }).error) : text || 'Unable to join meeting.'
        pushToast(message, 'error')
        setJoinState('idle')
        return
      }

      if (json?.meeting) {
        setMeeting(json.meeting)
        if (typeof json.meeting.rtc?.hostPresent === 'boolean') {
          setHostPresentHint(json.meeting.rtc.hostPresent)
        }
      }

      if (json?.state === 'waiting') {
        setJoinState('waiting')
        setScreen('waiting')
        return
      }

      setJoinState('joined')
      setScreen('room')
      await loadMeeting({ silent: true })
      await loadThreadSnapshot()
      await connectRtc()
    } catch (err) {
      console.error('meeting_join_failed', err)
      pushToast('Unable to join meeting right now.', 'error')
      setJoinState('idle')
    }
  }, [
    cameraEnabled,
    connectRtc,
    loadMeeting,
    loadThreadSnapshot,
    mediaReady,
    meetingId,
    micEnabled,
    municipality,
    organization,
    password,
    province,
  ])

  const sendChatMessage = useCallback(async () => {
    const threadId = activeThreadId
    const body = chatDraft.trim()
    if (!threadId || !body) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setSendingChat(true)
    try {
      const res = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(threadId)}/messages`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          body,
        }),
      })
      const { json, text } = await parseApiResponse<{ error?: unknown }>(res)
      if (!res.ok) {
        const message = typeof json?.error === 'string' ? json.error : text || 'Unable to send message.'
        pushToast(message, 'error')
        return
      }
      setChatDraft('')
      await refreshThreadMessages()
    } catch (err) {
      console.error('meeting_chat_send_failed', err)
      pushToast('Unable to send message right now.', 'error')
    } finally {
      setSendingChat(false)
    }
  }, [activeThreadId, chatDraft, refreshThreadMessages])

  useEffect(() => {
    void loadMeeting()
  }, [loadMeeting])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(DEVICE_PREFS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.micEnabled === 'boolean') setMicEnabled(parsed.micEnabled)
      if (typeof parsed.cameraEnabled === 'boolean') setCameraEnabled(parsed.cameraEnabled)
      if (typeof parsed.speakerEnabled === 'boolean') setSpeakerEnabled(parsed.speakerEnabled)
    } catch {
      // ignore invalid stored prefs
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      DEVICE_PREFS_KEY,
      JSON.stringify({
        micEnabled,
        cameraEnabled,
        speakerEnabled,
      }),
    )
  }, [cameraEnabled, micEnabled, speakerEnabled])

  useEffect(() => {
    if (!mediaReady) return
    void prepareLocalMedia()
  }, [cameraEnabled, mediaReady, micEnabled, prepareLocalMedia])

  useEffect(() => {
    if (screen !== 'room' || !activeThreadId) return
    void loadThreadSnapshot()
    const intervalId = window.setInterval(() => {
      void refreshThreadMessages()
    }, 4000)
    return () => window.clearInterval(intervalId)
  }, [activeThreadId, loadThreadSnapshot, refreshThreadMessages, screen])

  useEffect(() => {
    if (screen !== 'waiting') return
    const intervalId = window.setInterval(() => {
      void loadMeeting({ silent: true })
    }, 8000)
    return () => window.clearInterval(intervalId)
  }, [loadMeeting, screen])

  useEffect(() => {
    const node = chatScrollerRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages])

  useEffect(() => {
    return () => {
      closeRtcSocket()
      closeAllPeerConnections()
      stopLocalPreview()
    }
  }, [closeAllPeerConnections, closeRtcSocket, stopLocalPreview])

  const scheduleLabel = useMemo(() => {
    if (!meeting?.schedule?.startsAt) return 'Schedule TBD'
    const startsAt = new Date(meeting.schedule.startsAt)
    if (Number.isNaN(startsAt.getTime())) return 'Schedule TBD'
    return startsAt.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }, [meeting?.schedule?.startsAt])

  const localPreviewSummary = `${cameraEnabled ? 'Camera on' : 'Camera off'} • ${micEnabled ? 'Mic on' : 'Mic off'}`
  const admittedWhileWaiting = screen === 'waiting' && meeting?.admissionStatus === 'ADMITTED'

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-slate-700">
        <div className="rounded-2xl border border-slate-200 bg-white/90 px-6 py-5 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
          Loading meeting room…
        </div>
      </div>
    )
  }

  if (status === 'error' || !meeting) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-slate-700">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
          <p className="text-base font-semibold text-slate-900">Unable to load this meeting.</p>
          <p className="mt-2 text-sm text-slate-500">Please go back and try again.</p>
          <Link
            href={basePath}
            className="mt-4 inline-flex rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to meetings
          </Link>
        </div>
      </div>
    )
  }

  if (screen !== 'room') {
    return (
      <div className="min-h-screen px-4 py-8 text-slate-900">
        <div className="mx-auto w-full max-w-2xl rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_26px_60px_rgba(15,23,42,0.12)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-400">Civil Meeting Room</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">{meeting.title || 'Untitled meeting'}</h1>
          <p className="mt-1 text-sm text-slate-500">{scheduleLabel}</p>

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{meeting.visibility}</span>
            <span className="rounded-full border border-[var(--cc-primary)]/20 bg-[var(--cc-primary)]/8 px-2.5 py-1 text-[var(--cc-primary)]">
              {meeting.status === 'ACTIVE' ? 'LIVE' : 'UNPUBLISHED'}
            </span>
            {meeting.requiresManualAdmit ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">Manual admit</span> : null}
            {meeting.requiresPassword ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">Password</span> : null}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {hostPresent ? 'Host is currently in the meeting.' : 'Host has not yet joined the meeting.'}
          </div>

          {canManageMeetings && !hostPresent ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">
                {hostWaitingParticipants.length === 1
                  ? '1 participant is waiting for you to start hosting.'
                  : `${hostWaitingParticipants.length} participants are waiting for you to start hosting.`}
              </p>
              {hostWaitingParticipants.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {hostWaitingParticipants.slice(0, 8).map((participant) => (
                    <span key={participant.userId} className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs text-amber-800">
                      {participant.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {meeting.requiresPassword ? (
            <label className="mt-5 grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Room password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15"
                placeholder="Enter room password"
              />
            </label>
          ) : null}

          {screen === 'waiting' ? (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {admittedWhileWaiting
                ? 'Admission approved. You can enter now.'
                : 'Waiting for host approval. Keep this screen open.'}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => {
              void joinMeeting()
            }}
            disabled={joinState === 'joining' || (screen === 'waiting' && !admittedWhileWaiting)}
            className="mt-6 w-full rounded-2xl bg-[var(--cc-primary)] px-6 py-4 text-lg font-semibold text-white disabled:opacity-50"
          >
            {joinState === 'joining'
              ? 'Joining meeting…'
              : screen === 'waiting' && !admittedWhileWaiting
                ? 'Waiting for host approval…'
                : canManageMeetings
                  ? 'Open meeting room'
                  : 'Join Meeting'}
          </button>
          {mediaError ? <p className="mt-3 text-sm text-[var(--cc-primary)]">{mediaError}</p> : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {canManageMeetings ? (
              <button
                type="button"
                onClick={() => {
                  void inviteMeeting()
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Invite individuals
              </button>
            ) : null}
            <Link href={basePath} className="text-sm font-semibold text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline">
              Back to meetings
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col text-slate-900">
      <header className="border-b border-slate-200 bg-white/85 px-4 py-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Civil Meeting Room</p>
            <h1 className="truncate text-2xl font-semibold text-slate-900">{meeting.title || 'Untitled meeting'}</h1>
            <p className="text-sm text-slate-500">{scheduleLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{hostPresent ? 'Host in room' : 'Host offline'}</span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{rtcStatus === 'connected' ? 'A/V connected' : 'A/V idle'}</span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{stagePeers.length + 1} participant{stagePeers.length === 0 ? '' : 's'}</span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{meeting.visibility}</span>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 p-3 sm:p-4">
        <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-h-0 rounded-[28px] border border-white/70 bg-white/90 p-3 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur sm:p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Stage</p>
            <div className="mt-3 grid max-h-full min-h-0 grid-cols-1 content-start gap-3 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
              <article className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">You</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">Local preview</p>
                <p className="text-sm text-slate-500">{localPreviewSummary}</p>
                <div className="mt-3 aspect-video overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  {mediaReady ? (
                    <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 text-sm text-slate-500">Connect A/V to start preview.</div>
                  )}
                </div>
              </article>

              {stagePeers.map((peer) => (
                <article key={peer.peerId} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                  <div className="flex items-center gap-2">
                    {peer.profile?.avatarUrl ? (
                      <img src={peer.profile.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--cc-primary)]/10 text-xs font-semibold text-[var(--cc-primary)]">
                        {initialsFrom(peer.profile ?? null, 'P')}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{peer.displayName || peer.profile?.name || 'Participant'}</p>
                      <p className="text-xs text-slate-500">{peer.role === 'manager' ? 'Host' : 'Participant'}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex aspect-video items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-xs text-slate-500">
                    {remoteStreams[peer.peerId] ? (
                      <video
                        autoPlay
                        playsInline
                        className="h-full w-full rounded-xl object-cover"
                        ref={(node) => {
                          if (!node) return
                          const stream = remoteStreams[peer.peerId]
                          if (!stream) return
                          if (node.srcObject !== stream) {
                            node.srcObject = stream
                          }
                        }}
                      />
                    ) : (
                      'Awaiting video stream'
                    )}
                  </div>
                </article>
              ))}

              {stagePeers.length === 0 ? (
                <article className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
                  No other participants are connected yet.
                </article>
              ) : null}
            </div>
          </section>

          <aside className="min-h-0 rounded-[28px] border border-white/70 bg-white/90 p-3 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur sm:p-4">
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Room chat</p>
                  <p className="text-sm font-semibold text-slate-900">Persistent meeting thread</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void loadThreadSnapshot()
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Refresh
                </button>
              </div>

              <div ref={chatScrollerRef} className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                {chatLoading && messages.length === 0 ? <p className="text-sm text-slate-500">Loading messages…</p> : null}
                {!activeThreadId ? <p className="text-sm text-slate-500">Meeting chat unlocks after admission.</p> : null}
                {activeThreadId && messages.length === 0 ? <p className="text-sm text-slate-500">No messages yet.</p> : null}

                {messages.map((message) => {
                  const mine = Boolean(message.isMine)
                  return (
                    <div key={message.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
                      <div
                        className={
                          mine
                            ? 'max-w-[85%] rounded-2xl border border-[var(--cc-primary)] bg-[var(--cc-primary)] px-3 py-2 text-sm text-white'
                            : 'max-w-[85%] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700'
                        }
                      >
                        <p className="text-xs font-semibold opacity-90">
                          {mine ? 'You' : message.sender?.name || message.sender?.handle || 'Participant'}
                        </p>
                        {message.body ? <p className="mt-0.5 whitespace-pre-wrap break-words">{message.body}</p> : null}
                        <p className="mt-1 text-[11px] opacity-80">{formatTime(message.createdAt)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>

              <form
                className="mt-3 flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void sendChatMessage()
                }}
              >
                <input
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  placeholder="Message room"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15"
                  disabled={!activeThreadId}
                />
                <button
                  type="submit"
                  disabled={!activeThreadId || sendingChat || !chatDraft.trim()}
                  className="rounded-xl bg-[var(--cc-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Send
                </button>
              </form>
            </div>
          </aside>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white/88 px-3 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setMicEnabled((prev) => !prev)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
              micEnabled ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700'
            }`}
          >
            {micEnabled ? 'Mic on' : 'Mic off'}
          </button>
          <button
            type="button"
            onClick={() => setCameraEnabled((prev) => !prev)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
              cameraEnabled ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700'
            }`}
          >
            {cameraEnabled ? 'Camera on' : 'Camera off'}
          </button>
          <button
            type="button"
            onClick={() => setSpeakerEnabled((prev) => !prev)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
              speakerEnabled ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700'
            }`}
          >
            {speakerEnabled ? 'Speaker on' : 'Speaker off'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (rtcStatus === 'connected') {
                closeRtcSocket()
                closeAllPeerConnections()
                setRtcStatus('idle')
                setRtcPeers([])
                return
              }
              void connectRtc()
            }}
            className={
              rtcStatus === 'connected'
                ? 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700'
                : 'rounded-xl bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white'
            }
          >
            {rtcStatus === 'connecting' ? 'Connecting…' : rtcStatus === 'connected' ? 'Disconnect A/V' : 'Connect A/V'}
          </button>
          <button
            type="button"
            onClick={() => {
              closeRtcSocket()
              closeAllPeerConnections()
              stopLocalPreview()
              setScreen('prepare')
              setJoinState('idle')
            }}
            className="rounded-xl border border-[var(--cc-primary)]/35 bg-[var(--cc-primary)]/8 px-4 py-2 text-sm font-semibold text-[var(--cc-primary)]"
          >
            Exit room
          </button>
        </div>
      </footer>
    </div>
  )
}
