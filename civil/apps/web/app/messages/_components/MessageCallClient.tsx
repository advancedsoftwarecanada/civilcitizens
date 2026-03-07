'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import CivilCard from '../../_components/CivilCard'
import { subscribeToNotificationsStream, type RealtimePayload } from '../../_components/notifications/notificationStream'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { formatUserDisplayName } from '../../_lib/text'
import { getStoredToken } from '../../_lib/tokenStorage'
import {
  HiOutlineMicrophone,
  HiOutlineVideoCamera,
  HiOutlineXMark,
} from 'react-icons/hi2'

type ThreadUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl?: string | null
  isPremium: boolean
  isVerified: boolean
}

type ThreadParticipant = {
  userId: string
  role: string
  joinedAt: string
  lastReadAt: string | null
  mutedUntil: string | null
  lastActivityAt: string
  user: ThreadUser
  isViewer: boolean
}

type ThreadCall = {
  id: string
  threadId: string
  initiatorId: string
  endedByUserId: string | null
  roomId: string
  mode: 'audio' | 'video'
  status: 'ringing' | 'active' | 'ended'
  createdAt: string
  updatedAt: string
  startedAt: string | null
  lastJoinedAt: string | null
  endedAt: string | null
  initiator: ThreadUser
  isInitiator: boolean
}

type ThreadSummary = {
  id: string
  type: string
  contextType: string | null
  contextId: string | null
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  participants: ThreadParticipant[]
  activeCall?: ThreadCall | null
}

type ThreadDetailResponse = {
  thread?: ThreadSummary
  error?: unknown
}

type ThreadCallResponse = {
  thread?: ThreadSummary
  call?: ThreadCall | null
  error?: unknown
}

type StartCallResponse = {
  call?: ThreadCall
  error?: unknown
}

type RtcSessionResponse = {
  sessionId?: string
  token?: string
  wsUrl?: string | null
  iceServers?: unknown[]
  expiresAt?: string
  call?: ThreadCall
  error?: unknown
}

type FriendListItem = {
  id: string
  user: ThreadUser
}

type ResolveGroupResponse = {
  thread?: ThreadSummary
  created?: boolean
  error?: unknown
}

type RtcPeer = {
  peerId: string
  userId: string
  displayName: string
  role: string
}

const DEVICE_PREFS_KEY = 'civil:message-call:device-prefs:v1'

function getThreadTitle(thread: ThreadSummary) {
  const others = thread.participants.filter((participant) => !participant.isViewer)
  if (others.length === 0) return 'You'
  return others
    .map((participant) => formatUserDisplayName(participant.user.name, participant.user.handle) || `@${participant.user.handle}`)
    .join(', ')
}

function initialsFrom(user: ThreadUser | null | undefined, fallback = 'U') {
  const source = `${user?.name || ''} ${user?.handle || ''}`.trim()
  if (!source) return fallback
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function normalizeRtcPeer(raw: unknown): RtcPeer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const peerId = typeof value.peerId === 'string' ? value.peerId.trim() : ''
  const userId = typeof value.userId === 'string' ? value.userId.trim() : ''
  if (!peerId || !userId) return null
  return {
    peerId,
    userId,
    displayName: typeof value.displayName === 'string' && value.displayName.trim() ? value.displayName.trim() : 'Civil user',
    role: typeof value.role === 'string' && value.role.trim() ? value.role.trim() : 'participant',
  }
}

function normalizeRtcIceServers(raw: unknown): RTCIceServer[] {
  if (!Array.isArray(raw)) return [{ urls: 'stun:stun.l.google.com:19302' }]
  const parsed = raw
    .map((entry): RTCIceServer | null => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const value = entry as Record<string, unknown>
      const urls = value.urls
      if (typeof urls !== 'string' && !Array.isArray(urls)) return null
      const normalized: RTCIceServer = {
        urls: Array.isArray(urls) ? urls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : urls,
      }
      if (typeof value.username === 'string') normalized.username = value.username
      if (typeof value.credential === 'string') normalized.credential = value.credential
      if (typeof normalized.urls === 'string' && !normalized.urls.trim()) return null
      if (Array.isArray(normalized.urls) && normalized.urls.length === 0) return null
      return normalized
    })
    .filter((entry): entry is RTCIceServer => Boolean(entry))
  return parsed.length ? parsed : [{ urls: 'stun:stun.l.google.com:19302' }]
}

function streamHasVideoTrack(stream: MediaStream | null | undefined) {
  return Boolean(stream?.getVideoTracks().some((track) => track.readyState === 'live'))
}

function participantDisplayName(participant: ThreadParticipant | null | undefined) {
  if (!participant) return 'Civil user'
  return formatUserDisplayName(participant.user.name, participant.user.handle) || participant.user.handle
}

function userDisplayName(user: ThreadUser | null | undefined) {
  if (!user) return 'Civil user'
  return formatUserDisplayName(user.name, user.handle) || user.handle
}

export default function MessageCallClient({
  threadId,
}: {
  threadId: string
}) {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'ready' | 'ended' | 'error'>('loading')
  const [thread, setThread] = useState<ThreadSummary | null>(null)
  const [activeCall, setActiveCall] = useState<ThreadCall | null>(null)
  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [isPreparingMedia, setIsPreparingMedia] = useState(false)
  const [mediaReady, setMediaReady] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [rtcStatus, setRtcStatus] = useState<'idle' | 'connecting' | 'connected'>('idle')
  const [rtcPeers, setRtcPeers] = useState<RtcPeer[]>([])
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [addPeopleOpen, setAddPeopleOpen] = useState(false)
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friends, setFriends] = useState<ThreadUser[]>([])
  const [addPersonLoadingId, setAddPersonLoadingId] = useState<string | null>(null)
  const [endingCall, setEndingCall] = useState(false)

  const autoJoinStartedRef = useRef(false)
  const mediaPreferenceRef = useRef<{ micEnabled: boolean; cameraEnabled: boolean } | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const rtcSocketRef = useRef<WebSocket | null>(null)
  const rtcLocalPeerIdRef = useRef<string | null>(null)
  const rtcPeerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const rtcIceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])

  const attachStreamToMediaElement = useCallback(
    (node: HTMLMediaElement | null, stream: MediaStream | null, { muted = false }: { muted?: boolean } = {}) => {
      if (!node) return

      node.autoplay = true
      node.muted = muted
      node.defaultMuted = muted

      if (node instanceof HTMLVideoElement) {
        node.playsInline = true
        node.controls = false
        node.setAttribute('playsinline', 'true')
        node.setAttribute('webkit-playsinline', 'true')
      }

      if (!stream) {
        node.srcObject = null
        return
      }

      if (node.srcObject !== stream) {
        node.srcObject = stream
      }

      const tryPlay = () => {
        const playback = node.play()
        if (playback && typeof playback.catch === 'function') {
          playback.catch((error) => {
            console.warn('message_call_media_playback_failed', error)
          })
        }
      }

      tryPlay()
      window.setTimeout(tryPlay, 0)
      window.setTimeout(tryPlay, 250)
    },
    [],
  )

  const authedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      throw new Error('unauthorized')
    }
    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${token}`)
    return fetch(buildApiUrl(path), { ...init, headers, cache: init?.cache ?? 'no-store' })
  }, [])

  const callTitle = thread ? getThreadTitle(thread) : 'Call'
  const callSubtitle = activeCall?.mode === 'video' ? 'Video call' : 'Audio call'
  const addableFriends = useMemo(() => {
    const existingIds = new Set(thread?.participants.map((participant) => participant.userId) ?? [])
    return friends.filter((friend) => !existingIds.has(friend.id))
  }, [friends, thread?.participants])

  const stopLocalPreview = useCallback(() => {
    const stream = localStreamRef.current
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop()
        } catch {
          // ignore stop failures
        }
      }
    }
    localStreamRef.current = null
    attachStreamToMediaElement(localVideoRef.current, null, { muted: true })
  }, [attachStreamToMediaElement])

  const syncLocalPreview = useCallback(
    (stream: MediaStream | null) => {
      if (!localVideoRef.current) return
      attachStreamToMediaElement(localVideoRef.current, cameraEnabled ? stream : null, { muted: true })
    },
    [attachStreamToMediaElement, cameraEnabled],
  )

  const clearRemoteStreamForPeer = useCallback((peerId: string) => {
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
        // ignore close failures
      }
      clearRemoteStreamForPeer(peerId)
    },
    [clearRemoteStreamForPeer],
  )

  const closeAllPeerConnections = useCallback(() => {
    const peerIds = Array.from(rtcPeerConnectionsRef.current.keys())
    peerIds.forEach((peerId) => closePeerConnection(peerId))
    rtcPeerConnectionsRef.current.clear()
    rtcLocalPeerIdRef.current = null
    setRtcPeers([])
    setRemoteStreams({})
  }, [closePeerConnection])

  const closeRtcSocket = useCallback(() => {
    const socket = rtcSocketRef.current
    if (!socket) return
    rtcSocketRef.current = null
    try {
      socket.close()
    } catch {
      // ignore close failures
    }
  }, [])

  const sendRtcSignal = useCallback((targetPeerId: string, payload: unknown) => {
    const socket = rtcSocketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify({ type: 'signal', targetPeerId, payload }))
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
    for (const connection of rtcPeerConnectionsRef.current.values()) {
      const existingSenders = connection.getSenders()
      const tracks = stream?.getTracks() ?? []
      for (const sender of existingSenders) {
        if (!sender.track) continue
        const replacement = tracks.find((track) => track.kind === sender.track?.kind) ?? null
        if (replacement) {
          if (sender.track.id !== replacement.id) {
            void sender.replaceTrack(replacement).catch(() => undefined)
          }
          continue
        }
        void sender.replaceTrack(null).catch(() => undefined)
      }
      for (const track of tracks) {
        const hasSender = existingSenders.some((sender) => sender.track?.id === track.id)
        if (!hasSender && stream) {
          try {
            connection.addTrack(track, stream)
          } catch {
            // ignore duplicate sender errors
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
            // ignore addTrack failures
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
      if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return
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

  const loadThreadState = useCallback(async () => {
    setStatus('loading')
    try {
      const [threadRes, callRes] = await Promise.all([
        authedFetch(`/messages/threads/${encodeURIComponent(threadId)}?limit=1`),
        authedFetch(`/messages/threads/${encodeURIComponent(threadId)}/call`),
      ])
      const [{ json: threadJson }, { json: callJson }] = await Promise.all([
        parseApiResponse<ThreadDetailResponse>(threadRes),
        parseApiResponse<ThreadCallResponse>(callRes),
      ])

      if (!threadRes.ok || !threadJson?.thread) {
        setStatus('error')
        return
      }

      const nextThread = callJson?.thread ?? threadJson.thread
      const nextCall = callJson?.call ?? nextThread.activeCall ?? null
      setThread(nextThread)
      setActiveCall(nextCall)
      setStatus(nextCall ? 'ready' : 'ended')
      if (nextCall?.mode === 'audio') {
        setCameraEnabled(false)
      }
    } catch (error) {
      console.error('message_call_load_failed', error)
      setStatus('error')
    }
  }, [authedFetch, threadId])

  const prepareLocalMedia = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMediaError('Camera and microphone are not available in this browser.')
      return false
    }

    const existingStream = localStreamRef.current
    const existingAudioTrack = existingStream?.getAudioTracks().find((track) => track.readyState === 'live') ?? null
    const existingVideoTrack = existingStream?.getVideoTracks().find((track) => track.readyState === 'live') ?? null

    if (existingStream) {
      if (existingAudioTrack) existingAudioTrack.enabled = micEnabled
      if (existingVideoTrack) existingVideoTrack.enabled = cameraEnabled
    }

    if (!micEnabled && !cameraEnabled) {
      syncLocalPreview(existingStream ?? null)
      if (existingStream) {
        applyLocalTracksToPeerConnections(existingStream)
      }
      setMediaReady(Boolean(existingStream))
      setMediaError(null)
      return true
    }

    const needsAudioTrack = micEnabled && !existingAudioTrack
    const needsVideoTrack = cameraEnabled && !existingVideoTrack

    if (existingStream && !needsAudioTrack && !needsVideoTrack) {
      syncLocalPreview(existingStream)
      applyLocalTracksToPeerConnections(existingStream)
      setMediaReady(true)
      setMediaError(null)
      return true
    }

    setIsPreparingMedia(true)
    try {
      const requestedStream = await navigator.mediaDevices.getUserMedia({
        audio: needsAudioTrack || (!existingStream && micEnabled),
        video: needsVideoTrack || (!existingStream && cameraEnabled),
      })

      if (existingStream) {
        for (const track of requestedStream.getTracks()) {
          existingStream.addTrack(track)
        }
        localStreamRef.current = existingStream
      } else {
        localStreamRef.current = requestedStream
      }

      const nextStream = localStreamRef.current
      if (nextStream) {
        for (const track of nextStream.getAudioTracks()) {
          track.enabled = micEnabled
        }
        for (const track of nextStream.getVideoTracks()) {
          track.enabled = cameraEnabled
        }
      }

      syncLocalPreview(nextStream)
      applyLocalTracksToPeerConnections(nextStream)
      setMediaReady(true)
      setMediaError(null)
      return true
    } catch (error) {
      console.error('message_call_local_media_failed', error)
      setMediaReady(Boolean(existingStream))
      setMediaError('Unable to access camera or microphone. Check browser permissions.')
      return Boolean(existingStream)
    } finally {
      setIsPreparingMedia(false)
    }
  }, [applyLocalTracksToPeerConnections, cameraEnabled, micEnabled, syncLocalPreview])

  const connectRtc = useCallback(async () => {
    if (!activeCall) return
    if (rtcStatus === 'connecting' || rtcStatus === 'connected') return

    if ((micEnabled || cameraEnabled) && !mediaReady) {
      const prepared = await prepareLocalMedia()
      if (!prepared) {
        pushToast('Allow access to your camera or microphone, or turn both off.', 'error')
        return
      }
    }

    setRtcStatus('connecting')
    try {
      const response = await authedFetch(`/messages/calls/${encodeURIComponent(activeCall.id)}/rtc/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: null,
          deviceId: null,
          capabilities: {
            audio: micEnabled,
            video: cameraEnabled,
          },
        }),
      })
      const { json, text } = await parseApiResponse<RtcSessionResponse>(response)
      if (response.status === 401) {
        redirectToAuthModal('login')
        setRtcStatus('idle')
        return
      }
      if (response.status === 410) {
        setActiveCall(null)
        setStatus('ended')
        setRtcStatus('idle')
        return
      }
      if (!response.ok) {
        pushToast(typeof json?.error === 'string' ? json.error : text || 'Unable to connect A/V right now.', 'error')
        setRtcStatus('idle')
        return
      }

      if (json?.call) {
        setActiveCall(json.call)
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
        let payload: unknown = null
        try {
          payload = JSON.parse(String(event.data || ''))
        } catch {
          return
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
        const value = payload as Record<string, unknown>
        const type = typeof value.type === 'string' ? value.type : ''
        if (type === 'hello') {
          rtcLocalPeerIdRef.current = typeof value.peerId === 'string' ? value.peerId : null
          const peers = Array.isArray(value.peers) ? value.peers.map(normalizeRtcPeer).filter(Boolean) : []
          setRtcPeers(peers as RtcPeer[])
          for (const peer of peers as RtcPeer[]) {
            if (!shouldInitiateOffer(peer.peerId)) continue
            void sendRtcOfferToPeer(peer.peerId).catch((error) => {
              console.error('message_call_offer_failed', error)
            })
          }
          return
        }
        if (type === 'peer.joined') {
          const peer = normalizeRtcPeer(value.peer)
          if (!peer) return
          setRtcPeers((prev) => {
            if (prev.some((entry) => entry.peerId === peer.peerId)) return prev
            return [...prev, peer]
          })
          if (shouldInitiateOffer(peer.peerId)) {
            void sendRtcOfferToPeer(peer.peerId).catch((error) => {
              console.error('message_call_offer_failed', error)
            })
          }
          return
        }
        if (type === 'signal') {
          const fromPeerId = typeof value.fromPeerId === 'string' ? value.fromPeerId : ''
          void handleRtcSignal(fromPeerId, value.payload).catch((error) => {
            console.error('message_call_signal_failed', error)
          })
          return
        }
        if (type === 'peer.left') {
          const peerId = typeof value.peerId === 'string' ? value.peerId : ''
          if (!peerId) return
          closePeerConnection(peerId)
          setRtcPeers((prev) => prev.filter((entry) => entry.peerId !== peerId))
        }
      }

      socket.onclose = () => {
        closeAllPeerConnections()
        setRtcStatus('idle')
      }

      socket.onerror = () => {
        setRtcStatus('idle')
      }
    } catch (error) {
      console.error('message_call_connect_failed', error)
      pushToast('Unable to connect A/V right now.', 'error')
      setRtcStatus('idle')
    }
  }, [
    activeCall,
    authedFetch,
    cameraEnabled,
    closeAllPeerConnections,
    closePeerConnection,
    closeRtcSocket,
    handleRtcSignal,
    mediaReady,
    micEnabled,
    prepareLocalMedia,
    rtcStatus,
    sendRtcOfferToPeer,
    shouldInitiateOffer,
  ])

  const hangUp = useCallback(async () => {
    if (endingCall) return
    setEndingCall(true)
    try {
      if (activeCall?.id) {
        await authedFetch(`/messages/calls/${encodeURIComponent(activeCall.id)}/end`, {
          method: 'POST',
        }).catch(() => undefined)
      }
    } finally {
      closeRtcSocket()
      closeAllPeerConnections()
      stopLocalPreview()
      setEndingCall(false)
      router.replace(`/messages?thread=${encodeURIComponent(threadId)}`)
    }
  }, [activeCall?.id, authedFetch, closeAllPeerConnections, closeRtcSocket, endingCall, router, stopLocalPreview, threadId])

  const loadFriends = useCallback(async () => {
    setFriendsLoading(true)
    try {
      const response = await authedFetch('/friends')
      const { json } = await parseApiResponse<{ items?: FriendListItem[] }>(response)
      if (!response.ok) {
        throw new Error('failed_friends')
      }
      const items = Array.isArray(json?.items) ? json.items : []
      setFriends(items.map((item) => item.user))
    } catch (error) {
      console.error('message_call_friends_failed', error)
      pushToast('Unable to load friends right now.', 'error')
      setFriends([])
    } finally {
      setFriendsLoading(false)
    }
  }, [authedFetch])

  const addFriendToCall = useCallback(
    async (targetUserId: string) => {
      if (!thread || !activeCall) return
      setAddPersonLoadingId(targetUserId)
      try {
        const resolveResponse = await authedFetch(`/messages/threads/${encodeURIComponent(thread.id)}/resolve-group`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ participantIds: [targetUserId] }),
        })
        const { json: resolveJson, text: resolveText } = await parseApiResponse<ResolveGroupResponse>(resolveResponse)
        if (!resolveResponse.ok || !resolveJson?.thread) {
          pushToast(typeof resolveJson?.error === 'string' ? resolveJson.error : resolveText || 'Unable to add that friend.', 'error')
          return
        }

        const nextThread = resolveJson.thread
        const startResponse = await authedFetch(`/messages/threads/${encodeURIComponent(nextThread.id)}/call/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: activeCall.mode }),
        })
        const { json: startJson, text: startText } = await parseApiResponse<StartCallResponse>(startResponse)
        if (!startResponse.ok || !startJson?.call) {
          pushToast(typeof startJson?.error === 'string' ? startJson.error : startText || 'Unable to start the group call.', 'error')
          return
        }

        if (startJson.call.id !== activeCall.id) {
          await authedFetch(`/messages/calls/${encodeURIComponent(activeCall.id)}/end`, {
            method: 'POST',
          }).catch(() => undefined)
        }

        setAddPeopleOpen(false)
        router.replace(`/messages/call/${encodeURIComponent(nextThread.id)}?call=${encodeURIComponent(startJson.call.id)}`)
      } catch (error) {
        console.error('message_call_add_friend_failed', error)
        pushToast('Unable to expand the call right now.', 'error')
      } finally {
        setAddPersonLoadingId(null)
      }
    },
    [activeCall, authedFetch, router, thread],
  )

  useEffect(() => {
    void loadThreadState()
  }, [loadThreadState])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(DEVICE_PREFS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.micEnabled === 'boolean') setMicEnabled(parsed.micEnabled)
      if (typeof parsed.cameraEnabled === 'boolean') setCameraEnabled(parsed.cameraEnabled)
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
      }),
    )
  }, [cameraEnabled, micEnabled])

  useEffect(() => {
    if (!activeCall) return
    if (status !== 'ready') return
    if (autoJoinStartedRef.current) return
    if (rtcStatus !== 'idle') return
    autoJoinStartedRef.current = true
    void connectRtc()
  }, [activeCall, connectRtc, rtcStatus, status])

  useEffect(() => {
    const nextPrefs = { micEnabled, cameraEnabled }
    const previousPrefs = mediaPreferenceRef.current
    mediaPreferenceRef.current = nextPrefs
    if (!previousPrefs) return
    if (previousPrefs.micEnabled === micEnabled && previousPrefs.cameraEnabled === cameraEnabled) return
    if (!activeCall) return
    if (!mediaReady && rtcStatus === 'idle') return
    void prepareLocalMedia()
  }, [activeCall, cameraEnabled, mediaReady, micEnabled, prepareLocalMedia, rtcStatus])

  useEffect(() => {
    const unsubscribe = subscribeToNotificationsStream((payload: RealtimePayload) => {
      if (payload.type === 'message.call.ended') {
        const data = payload.data as { callId?: string } | undefined
        if (!data?.callId || data.callId !== activeCall?.id) return
        closeRtcSocket()
        closeAllPeerConnections()
        stopLocalPreview()
        setActiveCall(null)
        setStatus('ended')
        return
      }
      if (payload.type === 'thread.created') {
        const data = payload.data as { thread?: ThreadSummary } | undefined
        if (!data?.thread || data.thread.id !== threadId) return
        setThread(data.thread)
        setActiveCall(data.thread.activeCall ?? null)
      }
    })
    return unsubscribe
  }, [activeCall?.id, closeAllPeerConnections, closeRtcSocket, stopLocalPreview, threadId])

  useEffect(() => {
    return () => {
      closeRtcSocket()
      closeAllPeerConnections()
      stopLocalPreview()
    }
  }, [closeAllPeerConnections, closeRtcSocket, stopLocalPreview])

  useEffect(() => {
    if (!thread) return
    if (status !== 'ended' && activeCall) return
    router.replace(`/messages?thread=${encodeURIComponent(thread.id)}`)
  }, [activeCall, router, status, thread])

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#eff6ff,transparent_40%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_45%,#f8fafc_100%)] px-4">
        <div className="rounded-3xl border border-white/70 bg-white/92 px-6 py-5 text-sm text-slate-600 shadow-[0_25px_60px_rgba(15,23,42,0.12)]">
          Loading call…
        </div>
      </div>
    )
  }

  if (status === 'error' || !thread) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#eff6ff,transparent_40%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_45%,#f8fafc_100%)] px-4">
        <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white/92 p-6 shadow-[0_30px_70px_rgba(15,23,42,0.12)]">
          <p className="text-lg font-semibold text-slate-900">This call is unavailable.</p>
          <p className="mt-2 text-sm text-slate-500">It may have already ended, or you may no longer have access to this thread.</p>
          <Link
            href={`/messages?thread=${encodeURIComponent(threadId)}`}
            className="mt-5 inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Back to messages
          </Link>
        </div>
      </div>
    )
  }

  if (status === 'ended' || !activeCall) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#eff6ff,transparent_40%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_45%,#f8fafc_100%)] px-4">
        <div className="rounded-3xl border border-white/70 bg-white/92 px-6 py-5 text-sm text-slate-600 shadow-[0_25px_60px_rgba(15,23,42,0.12)]">
          Returning to thread…
        </div>
      </div>
    )
  }

  const participantByUserId = new Map(thread.participants.map((participant) => [participant.userId, participant]))
  const stagePeers = rtcPeers.map((peer) => ({
    ...peer,
    participant: participantByUserId.get(peer.userId) ?? null,
  }))
  const viewerParticipant = thread.participants.find((participant) => participant.isViewer) ?? null
  const viewerDisplayName = participantDisplayName(viewerParticipant)
  const stageSummary =
    rtcStatus === 'connected'
      ? 'Live'
      : rtcStatus === 'connecting'
        ? 'Connecting'
        : activeCall.status === 'ringing'
          ? 'Ringing'
          : 'Ready'

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fef5f3] via-[#f3f8ff] to-white text-slate-900">
      <div className="relative min-h-screen overflow-hidden">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,rgba(253,226,215,0.85),transparent_48%),radial-gradient(circle_at_top_right,rgba(219,234,254,0.9),transparent_46%)]"
          aria-hidden="true"
        />

        <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-4 sm:pt-5 lg:pb-8">
          <section className="rounded-[32px] border border-white/70 bg-white/82 p-4 shadow-[0_35px_120px_rgba(15,23,42,0.12)] backdrop-blur sm:p-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Civil Call</p>
                  <h1 className="mt-1 text-2xl font-semibold text-slate-900 sm:text-3xl">{callTitle}</h1>
                  <p className="mt-1 text-sm text-slate-500">
                    {callSubtitle} · {stageSummary} · {stagePeers.length + 1} live participant{stagePeers.length === 0 ? '' : 's'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddPeopleOpen(true)
                      if (friends.length === 0 && !friendsLoading) {
                        void loadFriends()
                      }
                    }}
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    Add people
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      autoJoinStartedRef.current = false
                      void connectRtc()
                    }}
                    disabled={rtcStatus === 'connecting'}
                    className="inline-flex items-center justify-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
                  >
                    {rtcStatus === 'connecting' ? 'Connecting…' : rtcStatus === 'connected' ? 'Reconnect' : 'Join'}
                  </button>
                </div>
              </div>

              {mediaError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{mediaError}</div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="rounded-[28px] border border-white/75 bg-[#f7fbff] p-3 shadow-inner shadow-white/60 sm:p-4">
                  <div className="grid min-h-[18rem] gap-3 md:grid-cols-2">
                    <article className="rounded-[26px] border border-slate-200/80 bg-white p-3 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
                      <CivilCard
                        size="md"
                        name={viewerDisplayName}
                        avatarAlt={viewerDisplayName}
                        avatarSrc={viewerParticipant?.user.avatarUrl ?? null}
                        avatarInitials={viewerDisplayName}
                        coverUrl={viewerParticipant?.user.coverUrl ?? null}
                        isVerified={Boolean(viewerParticipant?.user.isVerified)}
                        isBusiness={Boolean(viewerParticipant?.user.isPremium)}
                        subtitle={`You · ${micEnabled ? 'Microphone on' : 'Microphone muted'}`}
                        trailing={
                          <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/92">
                            {rtcStatus === 'connected' ? 'Connected' : rtcStatus === 'connecting' ? 'Joining' : 'Ready'}
                          </span>
                        }
                      />
                      <div className="mt-3 aspect-video overflow-hidden rounded-[22px] border border-slate-200/80 bg-[linear-gradient(160deg,#ecf4ff_0%,#f8fbff_56%,#eef2ff_100%)]">
                        {activeCall.mode === 'video' && cameraEnabled && (mediaReady || isPreparingMedia) ? (
                          <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-2xl font-semibold text-slate-700">
                              {initialsFrom(viewerParticipant?.user)}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {activeCall.mode === 'video' && cameraEnabled ? 'Preparing your camera…' : 'Audio only'}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">{micEnabled ? 'Microphone on' : 'Microphone muted'}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </article>

                    {stagePeers.map((peer) => {
                      const displayName = participantDisplayName(peer.participant) || peer.displayName
                      const remoteStream = remoteStreams[peer.peerId]
                      const remoteHasVideo = streamHasVideoTrack(remoteStream)
                      return (
                        <article
                          key={peer.peerId}
                          className="rounded-[26px] border border-slate-200/80 bg-white p-3 shadow-[0_18px_45px_rgba(15,23,42,0.08)]"
                        >
                          <CivilCard
                            size="md"
                            name={displayName}
                            avatarAlt={displayName}
                            avatarSrc={peer.participant?.user.avatarUrl ?? null}
                            avatarInitials={displayName}
                            coverUrl={peer.participant?.user.coverUrl ?? null}
                            isVerified={Boolean(peer.participant?.user.isVerified)}
                            isBusiness={Boolean(peer.participant?.user.isPremium)}
                            subtitle={`${peer.role === 'manager' ? 'Host' : 'Participant'} · ${remoteStream ? 'Connected' : 'Joining'}`}
                            trailing={
                              <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/92">
                                {remoteStream ? 'Live' : 'Joining'}
                              </span>
                            }
                          />
                          <div className="mt-3 aspect-video overflow-hidden rounded-[22px] border border-slate-200/80 bg-[linear-gradient(160deg,#ecf4ff_0%,#f8fbff_56%,#eef2ff_100%)]">
                            {remoteStream && remoteHasVideo ? (
                              <video
                                autoPlay
                                playsInline
                                className="h-full w-full object-cover"
                                ref={(node) => {
                                  attachStreamToMediaElement(node, remoteStream, { muted: false })
                                }}
                              />
                            ) : (
                              <div className="relative flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                                {remoteStream ? (
                                  <audio
                                    autoPlay
                                    ref={(node) => {
                                      attachStreamToMediaElement(node, remoteStream, { muted: false })
                                    }}
                                    className="hidden"
                                  />
                                ) : null}
                                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-2xl font-semibold text-slate-700">
                                  {initialsFrom(peer.participant?.user)}
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{remoteStream ? 'Audio live' : 'Joining call'}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {remoteStream ? `${displayName} is speaking with audio only.` : `Waiting for ${displayName} to connect.`}
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </article>
                      )
                    })}

                    {stagePeers.length === 0 ? (
                      <article className="flex min-h-[14rem] items-center justify-center rounded-[26px] border border-dashed border-slate-200 bg-white/70 p-6 text-center md:col-span-2">
                        <div>
                          <p className="text-lg font-semibold text-slate-900">Waiting for someone else to join</p>
                          <p className="mt-2 text-sm text-slate-500">
                            Keep the call open. Friends and connections will see the incoming ring and can join from messages.
                          </p>
                        </div>
                      </article>
                    ) : null}
                  </div>
                </section>

                <aside className="rounded-[28px] border border-white/75 bg-white/90 p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Participants</p>
                      <p className="text-sm text-slate-500">{thread.participants.length} in this conversation</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{stageSummary}</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {thread.participants.map((participant) => {
                      const name = participantDisplayName(participant)
                      const connected = participant.isViewer || stagePeers.some((peer) => peer.userId === participant.userId)
                      return (
                        <CivilCard
                          key={participant.userId}
                          size="sm"
                          name={participant.isViewer ? `${name}` : name}
                          avatarAlt={name}
                          avatarSrc={participant.user.avatarUrl}
                          avatarInitials={name}
                          coverUrl={participant.user.coverUrl ?? null}
                          isVerified={participant.user.isVerified}
                          isBusiness={participant.user.isPremium}
                          subtitle={participant.isViewer ? 'You' : `@${participant.user.handle}`}
                          trailing={
                            <span
                              className={clsx(
                                'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                                connected ? 'bg-emerald-300/14 text-emerald-100' : 'bg-white/8 text-white/70',
                              )}
                            >
                              {connected ? 'Connected' : 'Ringing'}
                            </span>
                          }
                        />
                      )
                    })}
                  </div>
                </aside>
              </div>
            </div>
          </section>
        </main>

        <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/92 px-3 pb-[max(env(safe-area-inset-bottom),0.85rem)] pt-3 shadow-[0_-18px_45px_rgba(15,23,42,0.08)] backdrop-blur lg:static lg:mx-auto lg:mb-5 lg:mt-4 lg:w-full lg:max-w-7xl lg:rounded-[32px] lg:border lg:px-4 lg:pb-4 lg:pt-4 lg:shadow-[0_22px_60px_rgba(15,23,42,0.10)]">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setMicEnabled((prev) => !prev)}
              className={clsx(
                'inline-flex min-w-[4.5rem] flex-col items-center gap-1 rounded-[1.35rem] border px-4 py-3 text-xs font-semibold transition sm:min-w-[5.5rem]',
                micEnabled ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-200 bg-slate-100 text-slate-500',
              )}
            >
              <HiOutlineMicrophone className="h-5 w-5" />
              {micEnabled ? 'Mic on' : 'Mic off'}
            </button>
            {activeCall.mode === 'video' ? (
              <button
                type="button"
                onClick={() => setCameraEnabled((prev) => !prev)}
                className={clsx(
                  'inline-flex min-w-[4.5rem] flex-col items-center gap-1 rounded-[1.35rem] border px-4 py-3 text-xs font-semibold transition sm:min-w-[5.5rem]',
                  cameraEnabled ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-200 bg-slate-100 text-slate-500',
                )}
              >
                <HiOutlineVideoCamera className="h-5 w-5" />
                {cameraEnabled ? 'Camera on' : 'Camera off'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setAddPeopleOpen(true)
                if (friends.length === 0 && !friendsLoading) {
                  void loadFriends()
                }
              }}
              className="inline-flex min-w-[4.5rem] flex-col items-center gap-1 rounded-[1.35rem] border border-slate-300 bg-white px-4 py-3 text-xs font-semibold text-slate-900 transition hover:bg-slate-50 sm:min-w-[5.5rem]"
            >
              <span className="text-base leading-none">+</span>
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                void hangUp()
              }}
              disabled={endingCall}
              className="inline-flex min-w-[5rem] flex-col items-center gap-1 rounded-[1.35rem] border border-rose-300/20 bg-[var(--cc-primary)] px-5 py-3 text-xs font-semibold text-white transition hover:brightness-95 disabled:opacity-60 sm:min-w-[6rem]"
            >
              <HiOutlineXMark className="h-5 w-5" />
              {endingCall ? 'Ending…' : 'Hang up'}
            </button>
          </div>
        </footer>
      </div>

      {addPeopleOpen && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/35 p-3 sm:items-center sm:p-4" onClick={() => setAddPeopleOpen(false)}>
              <div
                className="w-full max-w-lg overflow-hidden rounded-[2rem] border border-white/70 bg-white/96 p-5 text-slate-900 shadow-[0_30px_70px_rgba(15,23,42,0.18)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">Add Friends</h2>
                    <p className="text-sm text-slate-500">Civil will reuse an existing group thread for this exact set of people, or create one if needed.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddPeopleOpen(false)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                  >
                    <HiOutlineXMark className="h-5 w-5" />
                  </button>
                </div>

                <div className="mt-5 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                  {friendsLoading ? <p className="text-sm text-slate-500">Loading your friends…</p> : null}
                  {!friendsLoading && addableFriends.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                      Everyone you can add is already in this thread.
                    </p>
                  ) : null}
                  {addableFriends.map((friend) => {
                    const name = userDisplayName(friend)
                    return (
                      <div key={friend.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-3">
                        <div className="min-w-0 flex-1">
                          <CivilCard
                            size="sm"
                            name={name}
                            avatarAlt={name}
                            avatarSrc={friend.avatarUrl}
                            avatarInitials={name}
                            coverUrl={friend.coverUrl ?? null}
                            isVerified={friend.isVerified}
                            isBusiness={friend.isPremium}
                            subtitle={`@${friend.handle}`}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void addFriendToCall(friend.id)
                          }}
                          disabled={addPersonLoadingId === friend.id}
                          className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                        >
                          {addPersonLoadingId === friend.id ? 'Adding…' : 'Add'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
