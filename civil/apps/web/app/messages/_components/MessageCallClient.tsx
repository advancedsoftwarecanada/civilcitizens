'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import CallDialingHalo from '../../_components/CallDialingHalo'
import CivilCard from '../../_components/CivilCard'
import { subscribeToNotificationsStream, type RealtimePayload } from '../../_components/notifications/notificationStream'
import { pushToast } from '../../_components/useToasts'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { formatUserDisplayName } from '../../_lib/text'
import { getStoredToken } from '../../_lib/tokenStorage'
import {
  HiOutlineArrowPath,
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
  const dialingToneRef = useRef<HTMLAudioElement | null>(null)
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

  const handleLocalVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      localVideoRef.current = node
      attachStreamToMediaElement(node, cameraEnabled ? localStreamRef.current : null, { muted: true })
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

  const firstRtcPeer = rtcPeers[0] ?? null
  const firstRemoteStream = firstRtcPeer ? remoteStreams[firstRtcPeer.peerId] ?? null : null

  useEffect(() => {
    const shouldPlayDialTone = Boolean(activeCall?.isInitiator) && activeCall?.status === 'ringing' && !firstRemoteStream

    if (!shouldPlayDialTone || typeof window === 'undefined' || document.visibilityState !== 'visible') {
      if (dialingToneRef.current) {
        dialingToneRef.current.pause()
        dialingToneRef.current.currentTime = 0
      }
      return
    }

    const audio = dialingToneRef.current ?? new Audio()
    if (!dialingToneRef.current) {
      const preferredSource = audio.canPlayType('audio/x-caf') ? '/ringtone.caf' : '/ringtone.mp4'
      audio.src = preferredSource
      audio.loop = true
      audio.preload = 'auto'
      dialingToneRef.current = audio
    }

    audio.currentTime = 0
    void audio.play().catch(() => undefined)

    return () => {
      audio.pause()
      audio.currentTime = 0
    }
  }, [activeCall?.isInitiator, activeCall?.status, firstRemoteStream])

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
  const otherParticipants = thread.participants.filter((participant) => !participant.isViewer)
  const primaryPeer = stagePeers[0] ?? null
  const overflowPeers = stagePeers.slice(1)
  const primaryPeerDisplayName = primaryPeer ? participantDisplayName(primaryPeer.participant) || primaryPeer.displayName : callTitle
  const primaryRemoteStream = primaryPeer ? remoteStreams[primaryPeer.peerId] ?? null : null
  const primaryRemoteHasVideo = streamHasVideoTrack(primaryRemoteStream)
  const localPreviewVisible = activeCall.mode === 'video' && cameraEnabled && (mediaReady || isPreparingMedia)
  const showDialingHalo = activeCall.status === 'ringing' && !primaryRemoteStream
  const headerTitle =
    otherParticipants.length > 1
      ? `${participantDisplayName(otherParticipants[0])} + ${otherParticipants.length - 1} other${otherParticipants.length === 2 ? '' : 's'}`
      : primaryPeerDisplayName

  return (
    <div className="h-dvh overflow-hidden bg-[#080b14] text-white">
      <div className="relative h-full overflow-hidden bg-[radial-gradient(circle_at_top,#1f2d52_0%,rgba(8,11,20,0.96)_38%,#05070d_100%)]">
        {mediaError ? (
          <div className="absolute left-4 right-4 top-4 z-40 rounded-2xl border border-rose-400/30 bg-rose-500/16 px-4 py-3 text-sm text-rose-100 backdrop-blur">
            {mediaError}
          </div>
        ) : null}

        <div className="absolute left-4 top-4 z-30 max-w-[min(72vw,24rem)] rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 shadow-[0_18px_55px_rgba(0,0,0,0.35)] backdrop-blur-md">
          <h1 className="text-lg font-semibold text-white sm:text-xl">{headerTitle}</h1>
        </div>

        <main className="relative flex h-full w-full items-stretch justify-stretch overflow-hidden">
          <section className="relative h-full w-full overflow-hidden">
            {primaryPeer && primaryRemoteStream && primaryRemoteHasVideo ? (
              <video
                autoPlay
                playsInline
                className="h-full w-full object-cover"
                ref={(node) => {
                  attachStreamToMediaElement(node, primaryRemoteStream, { muted: false })
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#213057_0%,#111827_42%,#05070d_100%)] px-6 py-20">
                {primaryRemoteStream && !primaryRemoteHasVideo ? (
                  <audio
                    autoPlay
                    ref={(node) => {
                      attachStreamToMediaElement(node, primaryRemoteStream, { muted: false })
                    }}
                    className="hidden"
                  />
                ) : null}
                <div className="flex max-w-xl flex-col items-center text-center">
                  <div className="relative flex h-36 w-36 items-center justify-center sm:h-44 sm:w-44">
                    {showDialingHalo ? <CallDialingHalo /> : null}
                    <div className="relative z-10 flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/10 shadow-[0_25px_80px_rgba(0,0,0,0.35)]">
                      {primaryPeer?.participant?.user.avatarUrl ? (
                        <img
                          src={primaryPeer.participant.user.avatarUrl}
                          alt={primaryPeerDisplayName}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-4xl font-semibold text-white/90 sm:text-5xl">{initialsFrom(primaryPeer?.participant?.user)}</span>
                      )}
                    </div>
                  </div>
                  <p className="mt-6 text-2xl font-semibold text-white sm:text-3xl">{primaryPeerDisplayName}</p>
                  <p className="mt-2 text-sm text-white/65 sm:text-base">
                    {primaryPeer
                      ? primaryRemoteStream
                        ? activeCall.mode === 'video'
                          ? `${primaryPeerDisplayName} is on audio only right now.`
                          : `${primaryPeerDisplayName} is connected by audio.`
                        : activeCall.isInitiator
                          ? `Dialing ${primaryPeerDisplayName}…`
                          : `Waiting for ${primaryPeerDisplayName} to join.`
                      : 'Waiting for someone else to join the call.'}
                  </p>
                </div>
              </div>
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/55 via-black/20 to-transparent" />

            {overflowPeers.length ? (
              <div className="absolute left-4 right-28 top-20 z-20 flex flex-wrap gap-2 sm:right-36 sm:top-24">
                {overflowPeers.map((peer) => {
                  const displayName = participantDisplayName(peer.participant) || peer.displayName
                  const connected = Boolean(remoteStreams[peer.peerId])
                  return (
                    <div
                      key={peer.peerId}
                      className="rounded-full border border-white/12 bg-slate-950/40 px-3 py-2 text-xs font-semibold text-white/80 shadow-[0_14px_30px_rgba(0,0,0,0.25)] backdrop-blur-md"
                    >
                      {displayName} · {connected ? 'Live' : 'Joining'}
                    </div>
                  )
                })}
              </div>
            ) : null}

            <div className="absolute right-4 top-4 z-30 w-[7.5rem] sm:w-[9rem]">
              <div className="overflow-hidden rounded-[1.6rem] border border-white/15 bg-slate-950/45 shadow-[0_24px_60px_rgba(0,0,0,0.35)] backdrop-blur-md">
                <div className="px-3 pb-2 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55">You</div>
                <div className="relative aspect-[3/4] overflow-hidden bg-[linear-gradient(180deg,#1e293b_0%,#0f172a_100%)]">
                  {localPreviewVisible ? (
                    <video ref={handleLocalVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
                      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-white/12 bg-white/10 text-xl font-semibold text-white/90">
                        {viewerParticipant?.user.avatarUrl ? (
                          <img
                            src={viewerParticipant.user.avatarUrl}
                            alt={viewerDisplayName}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          initialsFrom(viewerParticipant?.user)
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white/90">{activeCall.mode === 'video' && cameraEnabled ? 'Preparing video…' : 'Audio only'}</p>
                        <p className="mt-1 text-[11px] text-white/55">{micEnabled ? 'Mic on' : 'Mic muted'}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </main>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-40 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />

        <footer className="absolute inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),0.85rem)] pt-3">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setMicEnabled((prev) => !prev)}
              className={clsx(
                'inline-flex h-14 w-14 items-center justify-center rounded-full border text-xs font-semibold transition sm:h-16 sm:w-16',
                micEnabled ? 'border-white/20 bg-white/12 text-white' : 'border-white/10 bg-white/5 text-white/45',
              )}
              aria-label={micEnabled ? 'Mute microphone' : 'Enable microphone'}
            >
              <HiOutlineMicrophone className="h-5 w-5" />
            </button>
            {activeCall.mode === 'video' ? (
              <button
                type="button"
                onClick={() => setCameraEnabled((prev) => !prev)}
                className={clsx(
                  'inline-flex h-14 w-14 items-center justify-center rounded-full border text-xs font-semibold transition sm:h-16 sm:w-16',
                  cameraEnabled ? 'border-white/20 bg-white/12 text-white' : 'border-white/10 bg-white/5 text-white/45',
                )}
                aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
              >
                <HiOutlineVideoCamera className="h-5 w-5" />
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
              className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-white/12 text-xs font-semibold text-white transition hover:bg-white/18 sm:h-16 sm:w-16"
              aria-label="Add people"
            >
              <span className="text-base leading-none">+</span>
            </button>
            <button
              type="button"
              onClick={() => {
                autoJoinStartedRef.current = false
                void connectRtc()
              }}
              disabled={rtcStatus === 'connecting'}
              className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-white/12 text-xs font-semibold text-white transition hover:bg-white/18 disabled:opacity-60 sm:h-16 sm:w-16"
              aria-label={rtcStatus === 'connecting' ? 'Connecting call' : rtcStatus === 'connected' ? 'Reconnect call' : 'Join call'}
            >
              <HiOutlineArrowPath className={clsx('h-5 w-5', rtcStatus === 'connecting' ? 'animate-spin' : '')} />
            </button>
            <button
              type="button"
              onClick={() => {
                void hangUp()
              }}
              disabled={endingCall}
              className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-rose-300/20 bg-[#ff5f57] text-white transition hover:brightness-95 disabled:opacity-60 sm:h-16 sm:w-16"
              aria-label={endingCall ? 'Ending call' : 'Hang up'}
            >
              <HiOutlineXMark className="h-5 w-5" />
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
