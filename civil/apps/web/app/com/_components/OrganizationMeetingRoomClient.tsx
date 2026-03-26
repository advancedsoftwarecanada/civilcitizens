'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  HiOutlineChevronDown,
  HiOutlineCog6Tooth,
  HiOutlineMicrophone,
  HiOutlineNoSymbol,
  HiOutlineSpeakerWave,
  HiOutlineUserPlus,
  HiOutlineVideoCamera,
  HiOutlineUsers,
  HiOutlineXMark,
} from 'react-icons/hi2'
import { FaUserTie } from 'react-icons/fa'
import CivilCard from '../../_components/CivilCard'
import Modal from '../../_components/Modal'
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

type RtcPeerMediaState = {
  screenSharing: boolean
  cameraEnabled: boolean
  micEnabled: boolean
}

type PresenterStage = {
  kind: 'local' | 'remote'
  peerId: string | null
  title: string
  subtitle: string
  stream: MediaStream
}

type DevicePickerKind = 'camera' | 'microphone' | 'speaker'

type MediaDeviceOption = {
  deviceId: string
  label: string
}

type SidebarTab = 'chat' | 'participants'

type MeetingProfileRelationship = {
  friendshipStatus: 'self' | 'friends' | 'incoming' | 'outgoing' | 'none'
  friendshipId?: string
  friendshipSince?: string | null
  connectionStatus: 'self' | 'connected' | 'incoming' | 'outgoing' | 'none'
  connectionId?: string
  connectionSince?: string | null
  profileFamilyRelationship?: {
    familyType?: string
    relationshipLabel: string
  } | null
}

type MeetingProfile = {
  id: string
  handle: string
  name?: string | null
  bio?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  isPremium?: boolean
  isVerified?: boolean
  friendCount?: number
  connectionCount?: number
  accountType?: 'user' | 'family_member'
  familyProfile?: {
    relationshipLabel: string
    modeLabel: string
    access?: 'self' | 'family' | 'friend'
  } | null
}

type UserPostsResponse = {
  user?: MeetingProfile
  relationship?: MeetingProfileRelationship | null
  items?: unknown[]
  error?: unknown
}

type MeetingParticipantCard = {
  userId: string
  peerId: string | null
  displayName: string
  handle: string | null
  avatarUrl: string | null
  coverUrl: string | null
  role: string | null
  isViewer: boolean
}

type InviteTab = 'family' | 'friends' | 'network'

type InviteableUser = {
  id: string
  handle: string
  displayName: string
  avatarUrl?: string | null
  coverUrl?: string | null
  subtitle?: string | null
}

type FamilyResponse = {
  profileRelationships?: Array<{
    id: string
    handle: string
    displayName: string
    relationshipLabel: string
    avatarUrl?: string | null
    coverUrl?: string | null
  }>
}

type SocialContactUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
}

type FriendEntry = {
  id: string
  status: string
  since: string | null
  user: SocialContactUser
}

type ConnectionEntry = {
  id: string
  status: string
  since: string | null
  user: SocialContactUser
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined') return false

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
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

function displayNameFrom(user: ChatUser | null | undefined, fallback: string) {
  const toDisplayCase = (value: string) =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ')

  const name = user?.name?.trim()
  if (name) return toDisplayCase(name)
  const handle = user?.handle?.trim()
  if (handle) return toDisplayCase(handle)
  return fallback
}

function stripHtmlToPlainTextWithNewlines(value: string | null | undefined) {
  return (value ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

function normalizeRtcPeerMediaState(raw: unknown): RtcPeerMediaState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const typed = raw as Record<string, unknown>
  return {
    screenSharing: Boolean(typed.screenSharing),
    cameraEnabled: Boolean(typed.cameraEnabled),
    micEnabled: Boolean(typed.micEnabled),
  }
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
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceOption[]>([])
  const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceOption[]>([])
  const [speakerDevices, setSpeakerDevices] = useState<MediaDeviceOption[]>([])
  const [selectedCameraDeviceId, setSelectedCameraDeviceId] = useState<string>('')
  const [selectedMicrophoneDeviceId, setSelectedMicrophoneDeviceId] = useState<string>('')
  const [selectedSpeakerDeviceId, setSelectedSpeakerDeviceId] = useState<string>('')
  const [leaveModalOpen, setLeaveModalOpen] = useState(false)
  const [devicePickerOpen, setDevicePickerOpen] = useState(false)
  const [devicePickerKind, setDevicePickerKind] = useState<DevicePickerKind>('camera')

  const [rtcStatus, setRtcStatus] = useState<'idle' | 'connecting' | 'connected'>('idle')
  const [rtcPeers, setRtcPeers] = useState<RtcPeer[]>([])
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [remotePeerMediaStates, setRemotePeerMediaStates] = useState<Record<string, RtcPeerMediaState>>({})

  const [participants, setParticipants] = useState<ThreadParticipant[]>([])
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [sendingChat, setSendingChat] = useState(false)
  const [chatAutoFollow, setChatAutoFollow] = useState(true)
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('chat')
  const [participantModalOpen, setParticipantModalOpen] = useState(false)
  const [selectedParticipant, setSelectedParticipant] = useState<MeetingParticipantCard | null>(null)
  const [selectedParticipantProfile, setSelectedParticipantProfile] = useState<MeetingProfile | null>(null)
  const [selectedParticipantRelationship, setSelectedParticipantRelationship] = useState<MeetingProfileRelationship | null>(null)
  const [participantProfileLoading, setParticipantProfileLoading] = useState(false)
  const [friendshipAction, setFriendshipAction] = useState<'send' | 'accept' | null>(null)
  const [connectionAction, setConnectionAction] = useState<'send' | 'accept' | null>(null)
  const [familyInviteSending, setFamilyInviteSending] = useState(false)
  const [familyRelationshipValue, setFamilyRelationshipValue] = useState<'parent' | 'child' | 'sibling' | 'spouse' | 'other'>('other')
  const [participantFamilyModalOpen, setParticipantFamilyModalOpen] = useState(false)
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [activeInviteTab, setActiveInviteTab] = useState<InviteTab>('family')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteContactsError, setInviteContactsError] = useState<string | null>(null)
  const [inviteSendingUserId, setInviteSendingUserId] = useState<string | null>(null)
  const [familyInviteContacts, setFamilyInviteContacts] = useState<InviteableUser[]>([])
  const [friendInviteContacts, setFriendInviteContacts] = useState<InviteableUser[]>([])
  const [networkInviteContacts, setNetworkInviteContacts] = useState<InviteableUser[]>([])
  const [moderatorModalOpen, setModeratorModalOpen] = useState(false)
  const [moderatorLoading, setModeratorLoading] = useState(false)
  const [moderatorSaving, setModeratorSaving] = useState(false)
  const [moderatorRequiresPassword, setModeratorRequiresPassword] = useState(false)
  const [moderatorPasswordDraft, setModeratorPasswordDraft] = useState('')
  const [moderatorActionUserId, setModeratorActionUserId] = useState<string | null>(null)

  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const screenShareStreamRef = useRef<MediaStream | null>(null)
  const rtcSocketRef = useRef<WebSocket | null>(null)
  const rtcLocalPeerIdRef = useRef<string | null>(null)
  const rtcPeerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const rtcIceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])
  const chatScrollerRef = useRef<HTMLDivElement | null>(null)
  const presenterStageRef = useRef<HTMLDivElement | null>(null)

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

      const sinkTarget = !muted ? selectedSpeakerDeviceId : ''
      const sinkCapableNode = node as HTMLMediaElement & { setSinkId?: (deviceId: string) => Promise<void> }
      if (sinkTarget && typeof sinkCapableNode.setSinkId === 'function') {
        void sinkCapableNode.setSinkId(sinkTarget).catch(() => undefined)
      }

      if (node.srcObject !== stream) {
        node.srcObject = stream
      }

      const tryPlay = () => {
        const playback = node.play()
        if (playback && typeof playback.catch === 'function') {
          playback.catch((error) => {
            console.warn('organization_meeting_media_playback_failed', error)
          })
        }
      }

      tryPlay()
      window.setTimeout(tryPlay, 0)
      window.setTimeout(tryPlay, 250)
    },
    [selectedSpeakerDeviceId],
  )

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
    const copied = await copyTextToClipboard(url)
    if (copied) {
      pushToast('Meeting link copied.', 'success')
    } else {
      pushToast('Unable to share meeting link.', 'error')
    }
  }, [meeting?.title])

  const copyMeetingUrl = useCallback(async () => {
    if (typeof window === 'undefined') return
    const copied = await copyTextToClipboard(window.location.href)
    if (copied) {
      pushToast('Meeting URL copied.', 'success')
      return
    }
    pushToast('Unable to copy meeting URL.', 'error')
  }, [])

  const activeThreadId = meeting?.threadId ?? null

  const participantByUserId = useMemo(() => {
    const map = new Map<string, ThreadParticipant>()
    for (const participant of participants) {
      if (!participant.userId) continue
      map.set(participant.userId, participant)
    }
    return map
  }, [participants])

  const viewerParticipant = useMemo(() => participants.find((participant) => participant.isViewer) ?? null, [participants])

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

  const meetingParticipants = useMemo<MeetingParticipantCard[]>(() => {
    const items = new Map<string, MeetingParticipantCard>()
    const pushEntry = (entry: MeetingParticipantCard) => {
      if (!entry.userId) return
      const existing = items.get(entry.userId)
      if (!existing) {
        items.set(entry.userId, entry)
        return
      }
      items.set(entry.userId, {
        ...existing,
        ...entry,
        handle: entry.handle ?? existing.handle,
        avatarUrl: entry.avatarUrl ?? existing.avatarUrl,
        coverUrl: entry.coverUrl ?? existing.coverUrl,
        role: entry.role ?? existing.role,
        peerId: entry.peerId ?? existing.peerId,
        isViewer: existing.isViewer || entry.isViewer,
      })
    }

    for (const participant of participants) {
      const peer = rtcPeers.find((entry) => entry.userId === participant.userId) ?? null
      pushEntry({
        userId: participant.userId,
        peerId: peer?.peerId ?? null,
        displayName: displayNameFrom(participant.user ?? null, peer?.displayName || 'Participant'),
        handle: participant.user?.handle?.trim() || null,
        avatarUrl: participant.user?.avatarUrl ?? null,
        coverUrl: null,
        role: peer?.role ?? null,
        isViewer: Boolean(participant.isViewer),
      })
    }

    if (viewerParticipant?.userId) {
      pushEntry({
        userId: viewerParticipant.userId,
        peerId: null,
        displayName: displayNameFrom(viewerParticipant.user ?? null, 'You'),
        handle: viewerParticipant.user?.handle?.trim() || null,
        avatarUrl: viewerParticipant.user?.avatarUrl ?? null,
        coverUrl: null,
        role: canManageMeetings ? 'manager' : 'participant',
        isViewer: true,
      })
    }

    for (const peer of stagePeers) {
      pushEntry({
        userId: peer.userId,
        peerId: peer.peerId,
        displayName: displayNameFrom(peer.profile, peer.displayName || 'Participant'),
        handle: peer.profile?.handle?.trim() || null,
        avatarUrl: peer.profile?.avatarUrl ?? null,
        coverUrl: null,
        role: peer.role,
        isViewer: false,
      })
    }

    return Array.from(items.values()).sort((left, right) => {
      if (left.isViewer !== right.isViewer) return left.isViewer ? -1 : 1
      if ((left.role === 'manager') !== (right.role === 'manager')) return left.role === 'manager' ? -1 : 1
      return left.displayName.localeCompare(right.displayName)
    })
  }, [canManageMeetings, participants, rtcPeers, stagePeers, viewerParticipant])

  const activeRoomParticipants = useMemo<MeetingParticipantCard[]>(() => {
    const items = new Map<string, MeetingParticipantCard>()

    if (viewerParticipant?.userId) {
      items.set(viewerParticipant.userId, {
        userId: viewerParticipant.userId,
        peerId: null,
        displayName: displayNameFrom(viewerParticipant.user ?? null, 'You'),
        handle: viewerParticipant.user?.handle?.trim() || null,
        avatarUrl: viewerParticipant.user?.avatarUrl ?? null,
        coverUrl: null,
        role: canManageMeetings ? 'manager' : 'participant',
        isViewer: true,
      })
    }

    for (const peer of stagePeers) {
      items.set(peer.userId, {
        userId: peer.userId,
        peerId: peer.peerId,
        displayName: displayNameFrom(peer.profile, peer.displayName || 'Participant'),
        handle: peer.profile?.handle?.trim() || null,
        avatarUrl: peer.profile?.avatarUrl ?? null,
        coverUrl: null,
        role: peer.role,
        isViewer: false,
      })
    }

    return Array.from(items.values()).sort((left, right) => {
      if (left.isViewer !== right.isViewer) return left.isViewer ? -1 : 1
      if ((left.role === 'manager') !== (right.role === 'manager')) return left.role === 'manager' ? -1 : 1
      return left.displayName.localeCompare(right.displayName)
    })
  }, [canManageMeetings, stagePeers, viewerParticipant])

  const presenterStage = useMemo<PresenterStage | null>(() => {
    const localStream = localStreamRef.current
    if (isScreenSharing && localStream) {
      return {
        kind: 'local',
        peerId: null,
        title: displayNameFrom(viewerParticipant?.user ?? null, 'You'),
        subtitle: '',
        stream: localStream,
      }
    }

    for (const peer of stagePeers) {
      if (!remotePeerMediaStates[peer.peerId]?.screenSharing) continue
      const stream = remoteStreams[peer.peerId]
      if (!stream) continue
      return {
        kind: 'remote',
        peerId: peer.peerId,
        title: displayNameFrom(peer.profile, peer.displayName || 'Participant'),
        subtitle: '',
        stream,
      }
    }

    return null
  }, [isScreenSharing, micEnabled, remotePeerMediaStates, remoteStreams, stagePeers, viewerParticipant])

  const participantTileCount = stagePeers.length + 1
  const galleryGridClassName = useMemo(() => {
    if (participantTileCount <= 1) return 'grid-cols-1'
    if (participantTileCount === 2) return 'grid-cols-2'
    if (participantTileCount === 3) return 'grid-cols-3'
    return 'grid-cols-2'
  }, [participantTileCount])

  const galleryTileClassName = useMemo(() => {
    if (participantTileCount <= 1) return 'mx-auto w-full max-w-5xl'
    return 'w-full'
  }, [participantTileCount])

  const getLocalMediaAvailability = useCallback(() => {
    const localStream = localStreamRef.current
    const cameraStream = cameraStreamRef.current
    const hasLiveAudio = Boolean(localStream?.getAudioTracks().some((track) => track.readyState === 'live'))
    const hasLiveVideo = Boolean(localStream?.getVideoTracks().some((track) => track.readyState === 'live'))
    const hasLiveCamera = Boolean(cameraStream?.getVideoTracks().some((track) => track.readyState === 'live'))
    return {
      audio: micEnabled && hasLiveAudio,
      video: hasLiveVideo,
      camera: cameraEnabled && hasLiveCamera,
    }
  }, [cameraEnabled, micEnabled])

  const currentDeviceOptions = useMemo(() => {
    if (devicePickerKind === 'camera') return cameraDevices
    if (devicePickerKind === 'microphone') return microphoneDevices
    return speakerDevices
  }, [cameraDevices, devicePickerKind, microphoneDevices, speakerDevices])

  const currentSelectedDeviceId = useMemo(() => {
    if (devicePickerKind === 'camera') return selectedCameraDeviceId
    if (devicePickerKind === 'microphone') return selectedMicrophoneDeviceId
    return selectedSpeakerDeviceId
  }, [devicePickerKind, selectedCameraDeviceId, selectedMicrophoneDeviceId, selectedSpeakerDeviceId])

  const devicePickerTitle = useMemo(() => {
    if (devicePickerKind === 'camera') return 'Select camera'
    if (devicePickerKind === 'microphone') return 'Select microphone'
    return 'Select speaker'
  }, [devicePickerKind])

  const defaultSelectedParticipantRelationship = useCallback(
    (targetUserId?: string | null): MeetingProfileRelationship => {
      const isSelf = Boolean(targetUserId) && targetUserId === viewerParticipant?.userId
      return {
        friendshipStatus: isSelf ? 'self' : 'none',
        friendshipId: undefined,
        friendshipSince: null,
        connectionStatus: isSelf ? 'self' : 'none',
        connectionId: undefined,
        connectionSince: null,
        profileFamilyRelationship: null,
      }
    },
    [viewerParticipant?.userId],
  )

  const resolvedSelectedParticipantProfile = useMemo<MeetingProfile | null>(() => {
    if (selectedParticipantProfile) return selectedParticipantProfile
    if (!selectedParticipant) return null
    return {
      id: selectedParticipant.userId,
      handle: selectedParticipant.handle ?? '',
      name: selectedParticipant.displayName,
      avatarUrl: selectedParticipant.avatarUrl,
      coverUrl: selectedParticipant.coverUrl,
    }
  }, [selectedParticipant, selectedParticipantProfile])

  const resolvedSelectedParticipantRelationship = useMemo(
    () => selectedParticipantRelationship ?? defaultSelectedParticipantRelationship(selectedParticipant?.userId),
    [defaultSelectedParticipantRelationship, selectedParticipant?.userId, selectedParticipantRelationship],
  )

  const refreshAvailableDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const toOption = (device: MediaDeviceInfo, index: number): MediaDeviceOption => ({
        deviceId: device.deviceId,
        label: device.label || `${device.kind} ${index + 1}`,
      })

      const cameras = devices.filter((device) => device.kind === 'videoinput').map(toOption)
      const microphones = devices.filter((device) => device.kind === 'audioinput').map(toOption)
      const speakers = devices.filter((device) => device.kind === 'audiooutput').map(toOption)

      setCameraDevices(cameras)
      setMicrophoneDevices(microphones)
      setSpeakerDevices(speakers)

      if (cameras.length > 0 && !cameras.some((device) => device.deviceId === selectedCameraDeviceId)) {
        setSelectedCameraDeviceId((current) => current || cameras[0]?.deviceId || '')
      }
      if (microphones.length > 0 && !microphones.some((device) => device.deviceId === selectedMicrophoneDeviceId)) {
        setSelectedMicrophoneDeviceId((current) => current || microphones[0]?.deviceId || '')
      }
      if (speakers.length > 0 && !speakers.some((device) => device.deviceId === selectedSpeakerDeviceId)) {
        setSelectedSpeakerDeviceId((current) => current || speakers[0]?.deviceId || '')
      }
    } catch {
      // ignore device enumeration errors
    }
  }, [selectedCameraDeviceId, selectedMicrophoneDeviceId, selectedSpeakerDeviceId])

  const openDevicePicker = useCallback((kind: DevicePickerKind) => {
    setDevicePickerKind(kind)
    setDevicePickerOpen(true)
  }, [])

  const selectDeviceOption = useCallback(
    (deviceId: string) => {
      if (devicePickerKind === 'camera') {
        setSelectedCameraDeviceId(deviceId)
      } else if (devicePickerKind === 'microphone') {
        setSelectedMicrophoneDeviceId(deviceId)
      } else {
        setSelectedSpeakerDeviceId(deviceId)
      }
      setDevicePickerOpen(false)
    },
    [devicePickerKind],
  )

  const stopMediaStreamTracks = useCallback((stream: MediaStream | null) => {
    if (!stream) return
    for (const track of stream.getTracks()) {
      try {
        track.stop()
      } catch {
        // ignore
      }
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

  const clearRemoteMediaStateForPeer = useCallback((peerId: string) => {
    if (!peerId) return
    setRemotePeerMediaStates((prev) => {
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
        clearRemoteMediaStateForPeer(peerId)
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
      clearRemoteMediaStateForPeer(peerId)
    },
    [clearRemoteMediaStateForPeer, clearRemoteStreamForPeer],
  )

  const closeAllPeerConnections = useCallback(() => {
    const ids = Array.from(rtcPeerConnectionsRef.current.keys())
    for (const peerId of ids) {
      closePeerConnection(peerId)
    }
    rtcPeerConnectionsRef.current.clear()
    rtcLocalPeerIdRef.current = null
    setRemoteStreams({})
    setRemotePeerMediaStates({})
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

  const sendLocalMediaStateToPeer = useCallback(
    (targetPeerId: string) => {
      const availability = getLocalMediaAvailability()
      sendRtcSignal(targetPeerId, {
        type: 'media-state',
        state: {
          screenSharing: isScreenSharing && availability.video,
          cameraEnabled: availability.camera,
          micEnabled: availability.audio,
        },
      })
    },
    [getLocalMediaAvailability, isScreenSharing, sendRtcSignal],
  )

  const applyLocalTracksToPeerConnections = useCallback((stream: MediaStream | null) => {
    const tracksByKind = new Map<string, MediaStreamTrack>()
    for (const track of stream?.getTracks() ?? []) {
      tracksByKind.set(track.kind, track)
    }

    for (const pc of rtcPeerConnectionsRef.current.values()) {
      const existingSenders = pc.getSenders()
      for (const sender of existingSenders) {
        if (!sender.track) continue
        const replacement = tracksByKind.get(sender.track.kind)
        if (replacement && sender.track.id !== replacement.id) {
          void sender.replaceTrack(replacement).catch(() => undefined)
          continue
        }
        if (!replacement) {
          void sender.replaceTrack(null).catch(() => undefined)
        }
      }

      if (stream) {
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
    }
  }, [])

  const syncActiveLocalStream = useCallback(
    (stream: MediaStream | null) => {
      localStreamRef.current = stream
      attachStreamToMediaElement(localVideoRef.current, stream, { muted: true })
      applyLocalTracksToPeerConnections(stream)
    },
    [applyLocalTracksToPeerConnections, attachStreamToMediaElement],
  )

  const stopLocalPreview = useCallback(() => {
    stopMediaStreamTracks(screenShareStreamRef.current)
    stopMediaStreamTracks(cameraStreamRef.current)
    screenShareStreamRef.current = null
    cameraStreamRef.current = null
    setIsScreenSharing(false)
    syncActiveLocalStream(null)
  }, [stopMediaStreamTracks, syncActiveLocalStream])

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

      if (signalType === 'media-state') {
        const nextState = normalizeRtcPeerMediaState(payload.state)
        if (!nextState) return
        setRemotePeerMediaStates((prev) => {
          const current = prev[fromPeerId]
          if (
            current &&
            current.screenSharing === nextState.screenSharing &&
            current.cameraEnabled === nextState.cameraEnabled &&
            current.micEnabled === nextState.micEnabled
          ) {
            return prev
          }
          return { ...prev, [fromPeerId]: nextState }
        })
        return
      }

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

  const requestPresenterFullscreen = useCallback(() => {
    const node = presenterStageRef.current
    if (!node || typeof node.requestFullscreen !== 'function') return
    void node.requestFullscreen().catch(() => undefined)
  }, [])

  const openParticipantProfile = useCallback((participant: MeetingParticipantCard) => {
    setSelectedParticipant(participant)
    setSelectedParticipantProfile({
      id: participant.userId,
      handle: participant.handle ?? '',
      name: participant.displayName,
      avatarUrl: participant.avatarUrl,
      coverUrl: participant.coverUrl,
    })
    setSelectedParticipantRelationship(null)
    setFamilyRelationshipValue('other')
    setParticipantModalOpen(true)
  }, [])

  const openParticipantFromUser = useCallback(
    (user: ChatUser | null | undefined, userId?: string) => {
      const handle = user?.handle?.trim() || null
      const existing = meetingParticipants.find((participant) => participant.userId === userId || (handle && participant.handle === handle))
      if (existing) {
        openParticipantProfile(existing)
        return
      }
      openParticipantProfile({
        userId: userId?.trim() || handle || 'participant',
        peerId: null,
        displayName: displayNameFrom(user ?? null, 'Participant'),
        handle,
        avatarUrl: user?.avatarUrl ?? null,
        coverUrl: null,
        role: null,
        isViewer: Boolean(userId && userId === viewerParticipant?.userId),
      })
    },
    [meetingParticipants, openParticipantProfile, viewerParticipant?.userId],
  )

  const requireAuthToken = useCallback(() => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return null
    }
    return token
  }, [])

  const loadInviteContacts = useCallback(async () => {
    const token = requireAuthToken()
    if (!token) return

    setInviteLoading(true)
    setInviteContactsError(null)
    try {
      const [familyRes, friendsRes, connectionsRes] = await Promise.all([
        fetch(buildApiUrl('/family'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
        fetch(buildApiUrl('/friends'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
        fetch(buildApiUrl('/connections'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
      ])

      if ([familyRes, friendsRes, connectionsRes].some((response) => response.status === 401)) {
        redirectToAuthModal('login')
        return
      }

      const [familyPayload, friendsPayload, connectionsPayload] = await Promise.all([
        familyRes.json().catch(() => null),
        friendsRes.json().catch(() => null),
        connectionsRes.json().catch(() => null),
      ])

      const familyRelationships = Array.isArray((familyPayload as FamilyResponse | null)?.profileRelationships)
        ? ((familyPayload as FamilyResponse | null)?.profileRelationships ?? [])
        : []

      const nextFamily = familyRelationships
        .map((entry) => ({
          id: entry.id,
          handle: entry.handle,
          displayName: entry.displayName,
          avatarUrl: entry.avatarUrl ?? null,
          coverUrl: entry.coverUrl ?? null,
          subtitle: entry.relationshipLabel,
        }))
        .sort((left, right) => left.displayName.localeCompare(right.displayName))

      const nextFriends = (Array.isArray((friendsPayload as { items?: FriendEntry[] } | null)?.items)
        ? (friendsPayload as { items: FriendEntry[] }).items
        : []
      )
        .map((entry) => ({
          id: entry.user.id,
          handle: entry.user.handle,
          displayName: entry.user.name?.trim() || entry.user.handle,
          avatarUrl: entry.user.avatarUrl ?? null,
          coverUrl: entry.user.coverUrl ?? null,
          subtitle: 'Friend',
        }))
        .sort((left, right) => left.displayName.localeCompare(right.displayName))

      const nextNetwork = (Array.isArray((connectionsPayload as { items?: ConnectionEntry[] } | null)?.items)
        ? (connectionsPayload as { items: ConnectionEntry[] }).items
        : []
      )
        .map((entry) => ({
          id: entry.user.id,
          handle: entry.user.handle,
          displayName: entry.user.name?.trim() || entry.user.handle,
          avatarUrl: entry.user.avatarUrl ?? null,
          coverUrl: entry.user.coverUrl ?? null,
          subtitle: 'Network',
        }))
        .sort((left, right) => left.displayName.localeCompare(right.displayName))

      setFamilyInviteContacts(nextFamily)
      setFriendInviteContacts(nextFriends)
      setNetworkInviteContacts(nextNetwork)
    } catch (error) {
      console.error('meeting_invite_contacts_load_failed', error)
      setInviteContactsError('Unable to load contacts right now.')
      setFamilyInviteContacts([])
      setFriendInviteContacts([])
      setNetworkInviteContacts([])
    } finally {
      setInviteLoading(false)
    }
  }, [requireAuthToken])

  const sendMeetingInvite = useCallback(
    async (target: InviteableUser) => {
      const token = requireAuthToken()
      if (!token || typeof window === 'undefined') return
      if (inviteSendingUserId) return

      const title = meeting?.title?.trim() || 'Civil Meeting Room'
      const body = `Join me in ${title}\n\n${window.location.href}`

      setInviteSendingUserId(target.id)
      try {
        const threadRes = await fetch(buildApiUrl('/messages/threads/direct'), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ userId: target.id }),
        })
        const threadPayload = (await threadRes.json().catch(() => null)) as { thread?: { id?: string }; error?: string } | null
        if (!threadRes.ok || !threadPayload?.thread?.id) {
          pushToast(threadPayload?.error ?? 'Unable to open a direct chat right now.', 'error')
          return
        }

        const messageRes = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(threadPayload.thread.id)}/messages`), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ body }),
        })
        if (!messageRes.ok) {
          pushToast('Unable to send meeting invite right now.', 'error')
          return
        }

        pushToast(`Meeting invite sent to ${target.displayName}.`, 'success')
      } catch (error) {
        console.error('meeting_invite_send_failed', error)
        pushToast('Unable to send meeting invite right now.', 'error')
      } finally {
        setInviteSendingUserId(null)
      }
    },
    [inviteSendingUserId, meeting?.title, requireAuthToken],
  )

  const loadModeratorSettings = useCallback(async () => {
    if (!canManageMeetings) return
    const token = requireAuthToken()
    if (!token) return

    setModeratorLoading(true)
    try {
      const response = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/governance/meetings/${encodeURIComponent(meetingId)}`,
        ),
        {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        },
      )
      const { json } = await parseApiResponse<MeetingFetchResponse>(response)
      if (!response.ok || !json?.meeting) {
        pushToast('Unable to load moderator controls right now.', 'error')
        return
      }
      setModeratorRequiresPassword(Boolean(json.meeting.requiresPassword))
      setModeratorPasswordDraft('')
    } catch (error) {
      console.error('meeting_moderator_load_failed', error)
      pushToast('Unable to load moderator controls right now.', 'error')
    } finally {
      setModeratorLoading(false)
    }
  }, [canManageMeetings, meetingId, municipality, organization, parseApiResponse, province, requireAuthToken])

  const saveModeratorSettings = useCallback(async () => {
    if (!canManageMeetings) return
    const token = requireAuthToken()
    if (!token) return

    setModeratorSaving(true)
    try {
      const response = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/governance/meetings/${encodeURIComponent(meetingId)}`,
        ),
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            requiresPassword: moderatorRequiresPassword,
            password: moderatorPasswordDraft.trim() ? moderatorPasswordDraft.trim() : undefined,
          }),
        },
      )
      const { json, text } = await parseApiResponse<{ meeting?: MeetingRecord; error?: unknown }>(response)
      if (!response.ok || !json?.meeting) {
        pushToast((typeof json?.error === 'string' ? json.error : text) || 'Unable to save moderator settings.', 'error')
        return
      }
      setMeeting((prev) => (prev ? { ...prev, ...json.meeting } : json.meeting ?? null))
      setModeratorPasswordDraft('')
      pushToast('Room settings saved.', 'success')
    } catch (error) {
      console.error('meeting_moderator_save_failed', error)
      pushToast('Unable to save moderator settings.', 'error')
    } finally {
      setModeratorSaving(false)
    }
  }, [canManageMeetings, meetingId, moderatorPasswordDraft, moderatorRequiresPassword, municipality, organization, province, requireAuthToken])

  const handleParticipantFriendAction = useCallback(async () => {
    const profile = resolvedSelectedParticipantProfile
    if (!profile?.id) return
    const token = requireAuthToken()
    if (!token) return

    if (resolvedSelectedParticipantRelationship.friendshipStatus === 'incoming' && resolvedSelectedParticipantRelationship.friendshipId) {
      setFriendshipAction('accept')
      try {
        const response = await fetch(buildApiUrl(`/friends/requests/${encodeURIComponent(resolvedSelectedParticipantRelationship.friendshipId)}/accept`), {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
        const payload = (await response.json().catch(() => null)) as { friend?: { id?: string; since?: string | null }; error?: string } | null
        if (!response.ok) {
          pushToast(payload?.error ?? 'Unable to accept friend request.', 'error')
          return
        }
        setSelectedParticipantRelationship((prev) => ({
          ...(prev ?? defaultSelectedParticipantRelationship(profile.id)),
          friendshipStatus: 'friends',
          friendshipId: payload?.friend?.id ?? prev?.friendshipId,
          friendshipSince: payload?.friend?.since ?? new Date().toISOString(),
        }))
        pushToast('Friend request accepted.', 'success')
      } catch (error) {
        console.error('meeting_participant_friend_accept_failed', error)
        pushToast('Unable to accept friend request.', 'error')
      } finally {
        setFriendshipAction(null)
      }
      return
    }

    if (resolvedSelectedParticipantRelationship.friendshipStatus !== 'none') return

    setFriendshipAction('send')
    try {
      const response = await fetch(buildApiUrl('/friends/requests'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userId: profile.id }),
      })
      const payload = (await response.json().catch(() => null)) as { request?: { id?: string }; error?: string } | null
      if (!response.ok) {
        pushToast(payload?.error ?? 'Unable to send friend request right now.', 'error')
        return
      }
      setSelectedParticipantRelationship((prev) => ({
        ...(prev ?? defaultSelectedParticipantRelationship(profile.id)),
        friendshipStatus: 'outgoing',
        friendshipId: payload?.request?.id ?? prev?.friendshipId,
        friendshipSince: null,
      }))
      pushToast('Friend request sent.', 'success')
    } catch (error) {
      console.error('meeting_participant_friend_send_failed', error)
      pushToast('Unable to send friend request right now.', 'error')
    } finally {
      setFriendshipAction(null)
    }
  }, [defaultSelectedParticipantRelationship, requireAuthToken, resolvedSelectedParticipantProfile, resolvedSelectedParticipantRelationship])

  const handleParticipantConnectionAction = useCallback(async () => {
    const profile = resolvedSelectedParticipantProfile
    if (!profile?.id) return
    const token = requireAuthToken()
    if (!token) return

    if (resolvedSelectedParticipantRelationship.connectionStatus === 'incoming' && resolvedSelectedParticipantRelationship.connectionId) {
      setConnectionAction('accept')
      try {
        const response = await fetch(buildApiUrl(`/connections/requests/${encodeURIComponent(resolvedSelectedParticipantRelationship.connectionId)}/accept`), {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
        const payload = (await response.json().catch(() => null)) as { connection?: { id?: string; since?: string | null }; error?: string } | null
        if (!response.ok) {
          pushToast(payload?.error ?? 'Unable to accept connection request.', 'error')
          return
        }
        setSelectedParticipantRelationship((prev) => ({
          ...(prev ?? defaultSelectedParticipantRelationship(profile.id)),
          connectionStatus: 'connected',
          connectionId: payload?.connection?.id ?? prev?.connectionId,
          connectionSince: payload?.connection?.since ?? new Date().toISOString(),
        }))
        pushToast('Connection request accepted.', 'success')
      } catch (error) {
        console.error('meeting_participant_connection_accept_failed', error)
        pushToast('Unable to accept connection request.', 'error')
      } finally {
        setConnectionAction(null)
      }
      return
    }

    if (resolvedSelectedParticipantRelationship.connectionStatus !== 'none') return

    setConnectionAction('send')
    try {
      const response = await fetch(buildApiUrl('/connections/requests'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userId: profile.id }),
      })
      const payload = (await response.json().catch(() => null)) as { request?: { id?: string }; error?: string } | null
      if (!response.ok) {
        pushToast(payload?.error ?? 'Unable to send connection request right now.', 'error')
        return
      }
      setSelectedParticipantRelationship((prev) => ({
        ...(prev ?? defaultSelectedParticipantRelationship(profile.id)),
        connectionStatus: 'outgoing',
        connectionId: payload?.request?.id ?? prev?.connectionId,
        connectionSince: null,
      }))
      pushToast('Connection request sent.', 'success')
    } catch (error) {
      console.error('meeting_participant_connection_send_failed', error)
      pushToast('Unable to send connection request right now.', 'error')
    } finally {
      setConnectionAction(null)
    }
  }, [defaultSelectedParticipantRelationship, requireAuthToken, resolvedSelectedParticipantProfile, resolvedSelectedParticipantRelationship])

  const handleParticipantFamilyInvite = useCallback(async () => {
    const profile = resolvedSelectedParticipantProfile
    if (!profile?.id) return
    const token = requireAuthToken()
    if (!token) return
    if (resolvedSelectedParticipantRelationship.profileFamilyRelationship) return

    setFamilyInviteSending(true)
    try {
      const response = await fetch(buildApiUrl('/profile/family-requests'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          targetUserId: profile.id,
          relationship: familyRelationshipValue,
        }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        pushToast(payload?.error ?? 'Unable to send family request right now.', 'error')
        return
      }
      setSelectedParticipantRelationship((prev) => ({
        ...(prev ?? defaultSelectedParticipantRelationship(profile.id)),
        profileFamilyRelationship: {
          familyType: familyRelationshipValue,
          relationshipLabel: familyRelationshipValue.charAt(0).toUpperCase() + familyRelationshipValue.slice(1),
        },
      }))
      pushToast('Family request sent.', 'success')
    } catch (error) {
      console.error('meeting_participant_family_send_failed', error)
      pushToast('Unable to send family request right now.', 'error')
    } finally {
      setFamilyInviteSending(false)
    }
  }, [defaultSelectedParticipantRelationship, familyRelationshipValue, requireAuthToken, resolvedSelectedParticipantProfile, resolvedSelectedParticipantRelationship.profileFamilyRelationship])

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
    }
  }, [activeThreadId])

  const moderateRoomParticipant = useCallback(
    async (userId: string, action: 'kick' | 'ban') => {
      if (!canManageMeetings) return
      const token = requireAuthToken()
      if (!token) return

      setModeratorActionUserId(userId)
      try {
        const response = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/governance/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(userId)}/${action}`,
          ),
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ reason: null }),
          },
        )
        const { json, text } = await parseApiResponse<{ ok?: boolean; error?: unknown }>(response)
        if (!response.ok) {
          pushToast((typeof json?.error === 'string' ? json.error : text) || `Unable to ${action} participant.`, 'error')
          return
        }

        pushToast(action === 'ban' ? 'Participant banned from this room.' : 'Participant removed from this room.', 'success')
        await refreshThreadMessages()
        await loadMeeting({ silent: true })
      } catch (error) {
        console.error('meeting_participant_moderation_failed', error)
        pushToast(`Unable to ${action} participant.`, 'error')
      } finally {
        setModeratorActionUserId(null)
      }
    },
    [canManageMeetings, loadMeeting, meetingId, municipality, organization, province, refreshThreadMessages, requireAuthToken],
  )

  const connectRtc = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    let availability = getLocalMediaAvailability()
    if ((micEnabled || cameraEnabled || isScreenSharing) && !mediaReady) {
      const prepared = await prepareLocalMedia()
      if (!prepared) {
        availability = { audio: false, video: false, camera: false }
        pushToast('Joining room without camera or microphone. You can retry your devices later.', 'info')
      } else {
        availability = getLocalMediaAvailability()
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
            capabilities: { audio: availability.audio, video: availability.video },
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
            sendLocalMediaStateToPeer(peer.peerId)
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
          sendLocalMediaStateToPeer(peer.peerId)
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
        if (type === 'moderation.disconnect') {
          const reason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : 'A moderator removed you from this meeting.'
          pushToast(reason, 'info')
          closeRtcSocket()
          closeAllPeerConnections()
          stopLocalPreview()
          setScreen('prepare')
          setJoinState('idle')
          return
        }
      }

      socket.onclose = () => {
        closeAllPeerConnections()
        setRtcStatus('idle')
        setRtcPeers([])
        setRemotePeerMediaStates({})
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
    getLocalMediaAvailability,
    isScreenSharing,
    sendRtcOfferToPeer,
    sendLocalMediaStateToPeer,
    stopLocalPreview,
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
        audio: micEnabled
          ? selectedMicrophoneDeviceId
            ? { deviceId: { exact: selectedMicrophoneDeviceId } }
            : true
          : false,
        video: cameraEnabled
          ? selectedCameraDeviceId
            ? { deviceId: { exact: selectedCameraDeviceId } }
            : true
          : false,
      })
      stopMediaStreamTracks(cameraStreamRef.current)
      cameraStreamRef.current = stream
      if (isScreenSharing && screenShareStreamRef.current) {
        const nextStream = new MediaStream([
          ...screenShareStreamRef.current.getVideoTracks().filter((track) => track.readyState === 'live'),
          ...stream.getAudioTracks().filter((track) => track.readyState === 'live'),
        ])
        syncActiveLocalStream(nextStream)
      } else {
        syncActiveLocalStream(stream)
      }
      setMediaReady(true)
      setMediaError(null)
      void refreshAvailableDevices()
      return true
    } catch (err) {
      console.error('meeting_local_media_failed', err)
      setMediaReady(false)
      setMediaError('Unable to access camera or microphone. Check browser permissions.')
      return false
    } finally {
      setIsPreparingMedia(false)
    }
  }, [
    cameraEnabled,
    isScreenSharing,
    micEnabled,
    refreshAvailableDevices,
    selectedCameraDeviceId,
    selectedMicrophoneDeviceId,
    stopLocalPreview,
    stopMediaStreamTracks,
    syncActiveLocalStream,
  ])

  const stopScreenShare = useCallback(() => {
    const capture = screenShareStreamRef.current
    if (capture) {
      for (const track of capture.getTracks()) {
        track.onended = null
      }
    }
    stopMediaStreamTracks(capture)
    screenShareStreamRef.current = null
    setIsScreenSharing(false)

    const fallbackTracks = cameraStreamRef.current?.getTracks().filter((track) => track.readyState === 'live') ?? []
    if (fallbackTracks.length > 0) {
      syncActiveLocalStream(new MediaStream(fallbackTracks))
      setMediaReady(true)
      setMediaError(null)
      return
    }

    syncActiveLocalStream(null)
    setMediaReady(false)
    if (!micEnabled && !cameraEnabled) {
      setMediaError('Enable microphone, camera, or screen share to prepare A/V.')
    }
  }, [cameraEnabled, micEnabled, stopMediaStreamTracks, syncActiveLocalStream])

  const startScreenShare = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      pushToast('Screen sharing is not available in this browser.', 'error')
      return false
    }

    try {
      const capture = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })

      const videoTrack = capture.getVideoTracks()[0] ?? null
      if (!videoTrack) {
        stopMediaStreamTracks(capture)
        pushToast('No screen video track was provided.', 'error')
        return false
      }

      const audioTracks = cameraStreamRef.current?.getAudioTracks().filter((track) => track.readyState === 'live') ?? []
      const nextStream = new MediaStream([videoTrack, ...audioTracks])

      if (screenShareStreamRef.current) {
        stopMediaStreamTracks(screenShareStreamRef.current)
      }
      screenShareStreamRef.current = capture
      videoTrack.onended = () => {
        stopScreenShare()
      }

      setIsScreenSharing(true)
      setMediaReady(true)
      setMediaError(null)
      syncActiveLocalStream(nextStream)
      return true
    } catch (err) {
      console.error('meeting_screen_share_failed', err)
      pushToast('Unable to start screen sharing right now.', 'error')
      return false
    }
  }, [stopMediaStreamTracks, stopScreenShare, syncActiveLocalStream])

  const joinMeeting = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setJoinState('joining')
    try {
      if ((micEnabled || cameraEnabled || isScreenSharing) && !mediaReady) {
        const prepared = await prepareLocalMedia()
        if (!prepared) {
          pushToast('Camera or microphone unavailable. Joining room without local A/V.', 'info')
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
    isScreenSharing,
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
      if (typeof parsed.selectedCameraDeviceId === 'string') setSelectedCameraDeviceId(parsed.selectedCameraDeviceId)
      if (typeof parsed.selectedMicrophoneDeviceId === 'string') setSelectedMicrophoneDeviceId(parsed.selectedMicrophoneDeviceId)
      if (typeof parsed.selectedSpeakerDeviceId === 'string') setSelectedSpeakerDeviceId(parsed.selectedSpeakerDeviceId)
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
        selectedCameraDeviceId,
        selectedMicrophoneDeviceId,
        selectedSpeakerDeviceId,
      }),
    )
  }, [cameraEnabled, micEnabled, selectedCameraDeviceId, selectedMicrophoneDeviceId, selectedSpeakerDeviceId, speakerEnabled])

  useEffect(() => {
    void refreshAvailableDevices()
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return
    const handleDeviceChange = () => {
      void refreshAvailableDevices()
    }
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
  }, [refreshAvailableDevices])

  useEffect(() => {
    if (!mediaReady) return
    if (isScreenSharing && !cameraEnabled && !micEnabled) return
    void prepareLocalMedia()
  }, [cameraEnabled, isScreenSharing, mediaReady, micEnabled, prepareLocalMedia])

  useEffect(() => {
    if (!mediaReady) return
    if (!cameraEnabled && !micEnabled) return
    void prepareLocalMedia()
  }, [cameraEnabled, mediaReady, micEnabled, prepareLocalMedia, selectedCameraDeviceId, selectedMicrophoneDeviceId])

  useEffect(() => {
    if (rtcStatus !== 'connected') return
    for (const peer of rtcPeers) {
      sendLocalMediaStateToPeer(peer.peerId)
    }
  }, [rtcPeers, rtcStatus, sendLocalMediaStateToPeer])

  useEffect(() => {
    if (screen !== 'room' || !activeThreadId) return
    void loadThreadSnapshot()
    const intervalId = window.setInterval(() => {
      void refreshThreadMessages()
    }, 2000)
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
    if (!chatAutoFollow) return
    node.scrollTop = node.scrollHeight
  }, [chatAutoFollow, messages])

  const handleChatScroll = useCallback(() => {
    const node = chatScrollerRef.current
    if (!node) return
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    setChatAutoFollow(distanceFromBottom <= 48)
  }, [])

  useEffect(() => {
    setChatAutoFollow(true)
  }, [activeThreadId])

  useEffect(() => {
    if (!participantModalOpen || !selectedParticipant?.handle) return

    let cancelled = false

    const loadParticipantProfile = async () => {
      setParticipantProfileLoading(true)
      try {
        const token = getStoredToken()
        const response = await fetch(buildApiUrl(`/users/${encodeURIComponent(selectedParticipant.handle ?? '')}/posts?sort=hot`), {
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
          cache: 'no-store',
        })
        if (!response.ok) return
        const payload = (await response.json().catch(() => null)) as UserPostsResponse | null
        if (cancelled || !payload?.user) return
        setSelectedParticipantProfile({
          ...payload.user,
          id: payload.user.id || selectedParticipant.userId,
          handle: payload.user.handle || selectedParticipant.handle || '',
          name: payload.user.name || selectedParticipant.displayName,
          avatarUrl: payload.user.avatarUrl ?? selectedParticipant.avatarUrl,
          coverUrl: payload.user.coverUrl ?? selectedParticipant.coverUrl,
        })
        setSelectedParticipantRelationship(payload.relationship ?? defaultSelectedParticipantRelationship(payload.user.id || selectedParticipant.userId))
      } catch (error) {
        console.error('meeting_participant_profile_load_failed', error)
      } finally {
        if (!cancelled) {
          setParticipantProfileLoading(false)
        }
      }
    }

    void loadParticipantProfile()

    return () => {
      cancelled = true
    }
  }, [defaultSelectedParticipantRelationship, participantModalOpen, selectedParticipant])

  useEffect(() => {
    if (!inviteModalOpen) return
    if (familyInviteContacts.length || friendInviteContacts.length || networkInviteContacts.length) return
    void loadInviteContacts()
  }, [familyInviteContacts.length, friendInviteContacts.length, inviteModalOpen, loadInviteContacts, networkInviteContacts.length])

  useEffect(() => {
    if (!moderatorModalOpen || !canManageMeetings) return
    void loadModeratorSettings()
  }, [canManageMeetings, loadModeratorSettings, moderatorModalOpen])

  useEffect(() => {
    return () => {
      closeRtcSocket()
      closeAllPeerConnections()
      stopLocalPreview()
    }
  }, [closeAllPeerConnections, closeRtcSocket, stopLocalPreview])

  const scheduleLabel = useMemo(() => {
    if (!meeting?.schedule?.startsAt) return ''
    const startsAt = new Date(meeting.schedule.startsAt)
    if (Number.isNaN(startsAt.getTime())) return ''
    return startsAt.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }, [meeting?.schedule?.startsAt])

  const admittedWhileWaiting = screen === 'waiting' && meeting?.admissionStatus === 'ADMITTED'

  const handleExitRoom = useCallback(() => {
    setLeaveModalOpen(true)
  }, [])

  const confirmExitRoom = useCallback(() => {
    setLeaveModalOpen(false)
    closeRtcSocket()
    closeAllPeerConnections()
    stopLocalPreview()
    setScreen('prepare')
    setJoinState('idle')
  }, [closeAllPeerConnections, closeRtcSocket, stopLocalPreview])

  const activeInviteContacts =
    activeInviteTab === 'family' ? familyInviteContacts : activeInviteTab === 'friends' ? friendInviteContacts : networkInviteContacts
  const moderatorParticipants = activeRoomParticipants.filter((participant) => !participant.isViewer)
  const participantConnectTone =
    resolvedSelectedParticipantRelationship.friendshipStatus === 'friends' ||
    resolvedSelectedParticipantRelationship.connectionStatus === 'connected'
      ? 'success'
      : 'primary'
  const participantConnectLabel =
    resolvedSelectedParticipantRelationship.friendshipStatus === 'incoming'
      ? 'Accept Friend'
      : resolvedSelectedParticipantRelationship.connectionStatus === 'incoming'
        ? 'Accept Network'
        : 'Connect'
  const participantConnectDisabled = Boolean(
    selectedParticipant?.isViewer ||
      resolvedSelectedParticipantRelationship.friendshipStatus === 'self' ||
      resolvedSelectedParticipantRelationship.connectionStatus === 'self',
  )
  const participantBioPlainText = stripHtmlToPlainTextWithNewlines(resolvedSelectedParticipantProfile?.bio)

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
          {scheduleLabel ? <p className="mt-1 text-sm text-slate-500">{scheduleLabel}</p> : null}

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
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
    <div className="flex h-[100dvh] overflow-hidden bg-slate-50 text-slate-900">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-slate-200 bg-white/85 px-4 py-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Civil Meeting Room</p>
            <h1 className="truncate text-2xl font-semibold text-slate-900">{meeting.title || 'Untitled meeting'}</h1>
            {scheduleLabel ? <p className="text-sm text-slate-500">{scheduleLabel}</p> : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setInviteModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <HiOutlineUserPlus className="h-4 w-4" />
              Invite
            </button>
            {canManageMeetings ? (
              <button
                type="button"
                onClick={() => setModeratorModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <HiOutlineCog6Tooth className="h-4 w-4" />
                Moderator
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden p-3 pb-28 sm:p-4 sm:pb-32">
        <div className="grid h-full min-h-0 items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="h-full min-h-0 overflow-hidden rounded-[28px] border border-white/70 bg-white/90 p-3 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur sm:p-4">
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
              {presenterStage ? (
                <div className="flex justify-end">
                <button
                  type="button"
                  onClick={requestPresenterFullscreen}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Fullscreen
                </button>
                </div>
              ) : null}

              {presenterStage ? (
                <div ref={presenterStageRef} className="relative flex min-h-[320px] flex-1 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-950">
                    <video
                      autoPlay
                      playsInline
                      className="h-full w-full object-contain"
                      ref={(node) => {
                        attachStreamToMediaElement(node, presenterStage.stream, { muted: presenterStage.kind === 'local' || !speakerEnabled })
                      }}
                    />
                    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-slate-950/75 via-slate-950/35 to-transparent px-4 py-3">
                      <div>
                        <p className="max-w-[calc(100%-3rem)] break-words text-[11px] font-semibold uppercase leading-tight tracking-[0.12em] text-white sm:text-sm" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85), 0 0 1px rgba(0,0,0,0.95)', overflowWrap: 'anywhere' }}>
                          {presenterStage.title}
                        </p>
                      </div>
                    </div>
                </div>
              ) : null}

              {presenterStage ? (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  <article className="w-[220px] shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
                    <div className="relative aspect-video overflow-hidden bg-slate-100">
                      {mediaReady ? (
                        <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center px-3 text-xs text-slate-500">Enable your camera or microphone to preview here.</div>
                      )}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/35 to-transparent px-3 py-2">
                        <p className="max-w-[calc(100%-2.75rem)] break-words text-[10px] font-semibold uppercase leading-tight tracking-[0.12em] text-white sm:text-[11px]" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85), 0 0 1px rgba(0,0,0,0.95)', overflowWrap: 'anywhere' }}>
                          {displayNameFrom(viewerParticipant?.user ?? null, 'Local preview')}
                        </p>
                        <span className={`relative inline-flex h-8 w-8 items-center justify-center rounded-full border ${micEnabled ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' : 'border-rose-400/60 bg-rose-500/20 text-rose-200'}`}>
                          <HiOutlineMicrophone className="h-4 w-4" />
                          {!micEnabled ? <HiOutlineNoSymbol className="absolute h-5 w-5 text-rose-300" /> : null}
                        </span>
                      </div>
                    </div>
                  </article>

                  {stagePeers.map((peer) => (
                    <article key={peer.peerId} className="w-[220px] shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
                      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-slate-100 text-xs text-slate-500">
                        {remoteStreams[peer.peerId] ? (
                          <video
                            autoPlay
                            playsInline
                            className="h-full w-full object-cover"
                            ref={(node) => {
                              attachStreamToMediaElement(node, remoteStreams[peer.peerId] ?? null, { muted: !speakerEnabled })
                            }}
                          />
                        ) : (
                          'Awaiting video stream'
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 py-3">
                          <p className="max-w-[calc(100%-2.75rem)] break-words text-[11px] font-semibold uppercase leading-tight tracking-[0.12em] text-white sm:text-xs" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85), 0 0 1px rgba(0,0,0,0.95)', overflowWrap: 'anywhere' }}>
                            {displayNameFrom(peer.profile, peer.displayName || 'Participant')}
                          </p>
                          <span className={`relative inline-flex h-8 w-8 items-center justify-center rounded-full border ${remotePeerMediaStates[peer.peerId]?.micEnabled ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' : 'border-rose-400/60 bg-rose-500/20 text-rose-200'}`}>
                            <HiOutlineMicrophone className="h-4 w-4" />
                            {!remotePeerMediaStates[peer.peerId]?.micEnabled ? <HiOutlineNoSymbol className="absolute h-5 w-5 text-rose-300" /> : null}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={`grid min-h-0 flex-1 content-center gap-4 auto-rows-max ${galleryGridClassName}`}>
                  <article className={`${galleryTileClassName} overflow-hidden rounded-[28px] border border-slate-200 bg-slate-950 shadow-[0_18px_45px_rgba(15,23,42,0.12)]`}>
                      <div className="relative flex aspect-video overflow-hidden bg-slate-100">
                        {mediaReady ? (
                          <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center px-3 text-xs text-slate-500">Enable your camera or microphone to preview here.</div>
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 py-3">
                          <p className="max-w-[calc(100%-3rem)] break-words text-[11px] font-semibold uppercase leading-tight tracking-[0.12em] text-white sm:text-sm" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85), 0 0 1px rgba(0,0,0,0.95)', overflowWrap: 'anywhere' }}>
                            {displayNameFrom(viewerParticipant?.user ?? null, 'Local preview')}
                          </p>
                          <span className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full border ${micEnabled ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' : 'border-rose-400/60 bg-rose-500/20 text-rose-200'}`}>
                            <HiOutlineMicrophone className="h-5 w-5" />
                            {!micEnabled ? <HiOutlineNoSymbol className="absolute h-6 w-6 text-rose-300" /> : null}
                          </span>
                        </div>
                      </div>
                    </article>

                  {stagePeers.map((peer) => (
                    <article key={peer.peerId} className="overflow-hidden rounded-[28px] border border-slate-200 bg-slate-950 shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
                      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-slate-100 text-xs text-slate-500">
                        {remoteStreams[peer.peerId] ? (
                          <video
                            autoPlay
                            playsInline
                            className="h-full w-full object-cover"
                            ref={(node) => {
                              attachStreamToMediaElement(node, remoteStreams[peer.peerId] ?? null, { muted: !speakerEnabled })
                            }}
                          />
                        ) : (
                          'Awaiting video stream'
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 py-3">
                          <p className="max-w-[calc(100%-3rem)] break-words text-[11px] font-semibold uppercase leading-tight tracking-[0.12em] text-white sm:text-sm" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85), 0 0 1px rgba(0,0,0,0.95)', overflowWrap: 'anywhere' }}>
                            {displayNameFrom(peer.profile, peer.displayName || 'Participant')}
                          </p>
                          <span className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full border ${remotePeerMediaStates[peer.peerId]?.micEnabled ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' : 'border-rose-400/60 bg-rose-500/20 text-rose-200'}`}>
                            <HiOutlineMicrophone className="h-5 w-5" />
                            {!remotePeerMediaStates[peer.peerId]?.micEnabled ? <HiOutlineNoSymbol className="absolute h-6 w-6 text-rose-300" /> : null}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}

                  {!mediaReady && stagePeers.length === 0 ? (
                    <article className="flex items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-500">
                      No webcams are live yet.
                    </article>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <aside className="h-full min-h-0 self-stretch rounded-[28px] border border-white/70 bg-white/90 p-3 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur sm:p-4">
            <div className="flex h-full min-h-0 flex-col">
              <div className="mb-3 flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setActiveSidebarTab('chat')}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    activeSidebarTab === 'chat' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSidebarTab('participants')}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    activeSidebarTab === 'participants' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Participants
                </button>
              </div>

              {activeSidebarTab === 'chat' ? (
                <>
                  <div ref={chatScrollerRef} onScroll={handleChatScroll} className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                    {chatLoading && messages.length === 0 ? <p className="text-sm text-slate-500">Loading messages…</p> : null}
                    {!activeThreadId ? <p className="text-sm text-slate-500">Meeting chat unlocks after admission.</p> : null}
                    {activeThreadId && messages.length === 0 ? <p className="text-sm text-slate-500">No messages yet.</p> : null}

                    {messages.map((message) => {
                      const mine = Boolean(message.isMine)
                      const senderProfile = (mine ? viewerParticipant?.user : message.sender) ?? message.sender ?? null
                      const senderName = displayNameFrom(senderProfile, 'Participant')
                      return (
                        <div key={message.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
                          <div className={`flex max-w-[92%] items-end gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
                            {senderProfile?.avatarUrl ? (
                              <img src={senderProfile.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                            ) : (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--cc-primary)]/10 text-[10px] font-semibold uppercase text-[var(--cc-primary)]">
                                {initialsFrom(senderProfile, mine ? 'M' : 'P')}
                              </div>
                            )}
                            <div
                              className={
                                mine
                                  ? 'max-w-[85%] rounded-2xl border border-[var(--cc-primary)] bg-[var(--cc-primary)] px-3 py-2 text-sm text-white'
                                  : 'max-w-[85%] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700'
                              }
                            >
                              <button
                                type="button"
                                onClick={() => openParticipantFromUser(senderProfile, message.senderId)}
                                className="text-left text-xs font-semibold opacity-90 underline-offset-2 hover:underline"
                              >
                                {senderName}
                              </button>
                              {message.body ? <p className="mt-0.5 whitespace-pre-wrap break-words">{message.body}</p> : null}
                              <p className="mt-1 text-[11px] opacity-80">{formatTime(message.createdAt)}</p>
                            </div>
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
                </>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                  <div className="space-y-3">
                    {meetingParticipants.length === 0 ? <p className="text-sm text-slate-500">No participants yet.</p> : null}
                    {meetingParticipants.map((participant) => (
                      <button
                        key={`${participant.userId}-${participant.peerId ?? 'local'}`}
                        type="button"
                        onClick={() => openParticipantProfile(participant)}
                        className="block w-full text-left"
                      >
                        <CivilCard
                          size="rail"
                          interactive={false}
                          name={participant.displayName}
                          avatarAlt={participant.displayName}
                          avatarInitials={participant.displayName}
                          avatarSrc={participant.avatarUrl}
                          coverUrl={participant.coverUrl}
                          subtitle={participant.handle ? `@${participant.handle}` : participant.role === 'manager' ? 'Host' : 'Participant'}
                          details={
                            <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
                              {participant.isViewer ? <span>You</span> : null}
                              {participant.role === 'manager' ? <span>Host</span> : null}
                              {participant.peerId ? <span>Live</span> : null}
                            </div>
                          }
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white px-3 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setCameraEnabled((prev) => !prev)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold ${
                cameraEnabled ? 'bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'text-slate-700'
              }`}
            >
              <HiOutlineVideoCamera className="h-5 w-5" />
              {cameraEnabled ? 'Camera on' : 'Camera off'}
            </button>
            <span className="h-5 w-px bg-slate-200" />
            <button
              type="button"
              onClick={() => openDevicePicker('camera')}
              className="px-3 py-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Select camera"
            >
              <HiOutlineCog6Tooth className="h-5 w-5" />
            </button>
          </div>
          <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setMicEnabled((prev) => !prev)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold ${
                micEnabled ? 'bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'text-slate-700'
              }`}
            >
              <HiOutlineMicrophone className="h-5 w-5" />
              {micEnabled ? 'Mic on' : 'Mic off'}
            </button>
            <span className="h-5 w-px bg-slate-200" />
            <button
              type="button"
              onClick={() => openDevicePicker('microphone')}
              className="px-3 py-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Select microphone"
            >
              <HiOutlineCog6Tooth className="h-5 w-5" />
            </button>
          </div>
          <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setSpeakerEnabled((prev) => !prev)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold ${
                speakerEnabled ? 'bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'text-slate-700'
              }`}
            >
              <HiOutlineSpeakerWave className="h-5 w-5" />
              {speakerEnabled ? 'Speaker on' : 'Speaker off'}
            </button>
            <span className="h-5 w-px bg-slate-200" />
            <button
              type="button"
              onClick={() => openDevicePicker('speaker')}
              className="px-3 py-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Select speaker"
            >
              <HiOutlineCog6Tooth className="h-5 w-5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isScreenSharing) {
                stopScreenShare()
                return
              }
              void startScreenShare()
            }}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold ${
              isScreenSharing ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 bg-white text-slate-700'
            }`}
          >
            <HiOutlineVideoCamera className="h-5 w-5" />
            {isScreenSharing ? 'Stop sharing' : 'Share screen'}
          </button>
          <button
            type="button"
            onClick={handleExitRoom}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--cc-primary)]/35 bg-[var(--cc-primary)]/8 px-4 py-2 text-sm font-semibold text-[var(--cc-primary)]"
          >
            <HiOutlineXMark className="h-5 w-5" />
            Exit room
          </button>
        </div>
      </footer>
      </div>

      <Modal open={leaveModalOpen} onClose={() => setLeaveModalOpen(false)} title="Leave meeting?" maxWidthClassName="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">You will leave the room and stop your current audio, video, and screen share session.</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setLeaveModalOpen(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmExitRoom}
              className="rounded-xl bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              Leave room
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={inviteModalOpen} onClose={() => setInviteModalOpen(false)} title="Invite people" maxWidthClassName="max-w-3xl">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">Invite connected people without leaving the room.</p>
              <p className="mt-1 text-sm text-slate-500">Send the meeting link by direct message or copy the room URL.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                void copyMeetingUrl()
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Copy Meeting URL
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {(['family', 'friends', 'network'] as InviteTab[]).map((tab) => {
              const active = tab === activeInviteTab
              const count = tab === 'family' ? familyInviteContacts.length : tab === 'friends' ? friendInviteContacts.length : networkInviteContacts.length
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveInviteTab(tab)}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold capitalize ${
                    active
                      ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/8 text-[var(--cc-primary)]'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {tab} {count > 0 ? `(${count})` : ''}
                </button>
              )
            })}
          </div>

          {inviteContactsError ? <p className="text-sm text-[var(--cc-primary)]">{inviteContactsError}</p> : null}

          <div className="max-h-[28rem] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-3">
            {inviteLoading ? <p className="px-2 py-6 text-sm text-slate-500">Loading contacts…</p> : null}
            {!inviteLoading && activeInviteContacts.length === 0 ? (
              <p className="px-2 py-6 text-sm text-slate-500">No {activeInviteTab} contacts available yet.</p>
            ) : null}
            {!inviteLoading ? (
              <div className="space-y-3">
                {activeInviteContacts.map((contact) => (
                  <div key={contact.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {contact.avatarUrl ? (
                        <img src={contact.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--cc-primary)]/10 text-sm font-semibold uppercase text-[var(--cc-primary)]">
                          {initialsFrom({ name: contact.displayName, handle: contact.handle }, 'C')}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{contact.displayName}</p>
                        <p className="truncate text-sm text-slate-500">
                          @{contact.handle}
                          {contact.subtitle ? ` • ${contact.subtitle}` : ''}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void sendMeetingInvite(contact)
                      }}
                      disabled={inviteSendingUserId === contact.id}
                      className="shrink-0 rounded-xl bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-55"
                    >
                      {inviteSendingUserId === contact.id ? 'Sending…' : 'Invite'}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        open={moderatorModalOpen}
        onClose={() => {
          if (moderatorSaving || moderatorActionUserId) return
          setModeratorModalOpen(false)
        }}
        title="Moderator tools"
        maxWidthClassName="max-w-3xl"
      >
        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Room password</p>
                <p className="mt-1 text-sm text-slate-500">Passwords are stored securely. You can replace the password, but the current raw password cannot be shown.</p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={moderatorRequiresPassword}
                  onChange={(event) => setModeratorRequiresPassword(event.target.checked)}
                  disabled={moderatorLoading || moderatorSaving}
                />
                Require password
              </label>
            </div>

            <label className="mt-4 grid gap-2 text-sm font-semibold text-slate-700">
              <span>Set new password</span>
              <input
                type="text"
                value={moderatorPasswordDraft}
                onChange={(event) => setModeratorPasswordDraft(event.target.value)}
                disabled={moderatorLoading || moderatorSaving || !moderatorRequiresPassword}
                placeholder={moderatorRequiresPassword ? 'Enter a new room password' : 'Enable password protection to set one'}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15 disabled:opacity-55"
              />
            </label>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  void saveModeratorSettings()
                }}
                disabled={moderatorLoading || moderatorSaving}
                className="rounded-xl bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-55"
              >
                {moderatorSaving ? 'Saving…' : 'Save room settings'}
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <div className="mb-3">
              <p className="text-sm font-semibold text-slate-900">Live participants</p>
              <p className="mt-1 text-sm text-slate-500">Kick removes someone from the current room. Ban also blocks them from joining again.</p>
            </div>

            {moderatorLoading ? <p className="text-sm text-slate-500">Loading moderator tools…</p> : null}
            {!moderatorLoading && moderatorParticipants.length === 0 ? <p className="text-sm text-slate-500">No other participants are currently in the room.</p> : null}

            {!moderatorLoading ? (
              <div className="space-y-3">
                {moderatorParticipants.map((participant) => (
                  <div key={`${participant.userId}-${participant.peerId ?? 'local'}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{participant.displayName}</p>
                      <p className="truncate text-sm text-slate-500">
                        {participant.handle ? `@${participant.handle}` : 'Participant'}
                        {participant.role === 'manager' ? ' • Host' : ''}
                        {participant.peerId ? ' • Live' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void moderateRoomParticipant(participant.userId, 'kick')
                        }}
                        disabled={moderatorActionUserId === participant.userId || participant.role === 'manager'}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-55"
                      >
                        {moderatorActionUserId === participant.userId ? 'Working…' : 'Kick'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void moderateRoomParticipant(participant.userId, 'ban')
                        }}
                        disabled={moderatorActionUserId === participant.userId || participant.role === 'manager'}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-55"
                      >
                        {moderatorActionUserId === participant.userId ? 'Working…' : 'Ban'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal open={devicePickerOpen} onClose={() => setDevicePickerOpen(false)} title={devicePickerTitle} maxWidthClassName="max-w-lg">
        <div className="space-y-2">
          {currentDeviceOptions.length === 0 ? <p className="text-sm text-slate-500">No devices found yet. Grant media permission and try again.</p> : null}
          {currentDeviceOptions.map((device) => {
            const active = device.deviceId === currentSelectedDeviceId
            return (
              <button
                key={device.deviceId || device.label}
                type="button"
                onClick={() => selectDeviceOption(device.deviceId)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm ${
                  active
                    ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/8 text-[var(--cc-primary)]'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="truncate">{device.label}</span>
                {active ? <span className="text-xs font-semibold uppercase tracking-[0.18em]">Active</span> : null}
              </button>
            )
          })}
        </div>
      </Modal>

      <Modal
        open={participantModalOpen}
        onClose={() => setParticipantModalOpen(false)}
        title={selectedParticipant?.displayName || 'Participant'}
        maxWidthClassName="max-w-2xl"
      >
        <div className="space-y-4">
          <CivilCard
            size="hero"
            interactive={false}
            name={resolvedSelectedParticipantProfile?.name || selectedParticipant?.displayName || 'Participant'}
            avatarAlt={resolvedSelectedParticipantProfile?.name || selectedParticipant?.displayName || 'Participant'}
            avatarInitials={resolvedSelectedParticipantProfile?.name || selectedParticipant?.displayName || 'Participant'}
            avatarSrc={resolvedSelectedParticipantProfile?.avatarUrl ?? selectedParticipant?.avatarUrl}
            coverUrl={resolvedSelectedParticipantProfile?.coverUrl ?? selectedParticipant?.coverUrl}
            isVerified={Boolean(resolvedSelectedParticipantProfile?.isVerified)}
            isBusiness={Boolean(resolvedSelectedParticipantProfile?.isPremium)}
            subtitle={resolvedSelectedParticipantProfile?.handle ? `@${resolvedSelectedParticipantProfile.handle}` : selectedParticipant?.role === 'manager' ? 'Host' : 'Citizen'}
            details={
              <div className="space-y-3">
                {resolvedSelectedParticipantProfile?.bio ? (
                  <div
                    className="max-h-[18rem] overflow-y-auto pr-2 max-w-none text-sm leading-7 text-white/90 [&_p]:m-0 [&_p+p]:mt-3 [&_br]:content-[''] [&_ul]:my-3 [&_ol]:my-3 [&_li]:my-1 [&_a]:font-medium [&_a]:text-white [&_a]:underline"
                    dangerouslySetInnerHTML={{ __html: resolvedSelectedParticipantProfile.bio }}
                  />
                ) : participantBioPlainText ? (
                  <p className="max-h-[18rem] overflow-y-auto whitespace-pre-wrap pr-2 text-sm leading-relaxed text-white/90">{participantBioPlainText}</p>
                ) : null}
                <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/80">
                  {selectedParticipant?.isViewer ? <span>You</span> : null}
                  {selectedParticipant?.role === 'manager' ? <span>Host</span> : null}
                  {resolvedSelectedParticipantRelationship.profileFamilyRelationship?.relationshipLabel ? (
                    <span>{resolvedSelectedParticipantRelationship.profileFamilyRelationship.relationshipLabel}</span>
                  ) : null}
                  {typeof resolvedSelectedParticipantProfile?.friendCount === 'number' ? <span>{resolvedSelectedParticipantProfile.friendCount} Friends</span> : null}
                  {typeof resolvedSelectedParticipantProfile?.connectionCount === 'number' ? <span>{resolvedSelectedParticipantProfile.connectionCount} Network</span> : null}
                  {resolvedSelectedParticipantProfile?.familyProfile?.modeLabel ? <span>{resolvedSelectedParticipantProfile.familyProfile.modeLabel}</span> : null}
                </div>
              </div>
            }
          />

          {participantProfileLoading ? <p className="text-sm text-slate-500">Loading profile details…</p> : null}

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {participantConnectDisabled ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex shrink-0 cursor-not-allowed list-none items-center justify-center gap-2 rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white opacity-55 shadow-sm [&::-webkit-details-marker]:hidden"
                >
                  <HiOutlineUserPlus className="h-4 w-4" aria-hidden="true" />
                  Connect
                  <HiOutlineChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <details className="group relative shrink-0 profile-action-menu">
                  <summary
                    className={`inline-flex shrink-0 cursor-pointer list-none items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold shadow-sm transition [&::-webkit-details-marker]:hidden ${
                      participantConnectTone === 'success'
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300'
                        : 'bg-[var(--cc-primary)] text-white hover:brightness-110'
                    }`}
                  >
                    <HiOutlineUserPlus className="h-4 w-4" aria-hidden="true" />
                    {participantConnectLabel}
                    <HiOutlineChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <div className="absolute left-0 top-full z-50 mt-2 min-w-[220px] rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                    {resolvedSelectedParticipantRelationship.friendshipStatus === 'incoming' ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
                        onClick={(event) => {
                          const details = event.currentTarget.closest('details')
                          if (details instanceof HTMLDetailsElement) details.open = false
                          void handleParticipantFriendAction()
                        }}
                        disabled={friendshipAction !== null}
                      >
                        <HiOutlineUsers className="h-4 w-4" aria-hidden="true" />
                        {friendshipAction === 'accept' ? 'Accepting friend…' : 'Accept Friend Request'}
                      </button>
                    ) : resolvedSelectedParticipantRelationship.friendshipStatus === 'outgoing' ? (
                      <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 opacity-55" disabled>
                        <HiOutlineUsers className="h-4 w-4" aria-hidden="true" />
                        Friend request sent
                      </button>
                    ) : resolvedSelectedParticipantRelationship.friendshipStatus !== 'friends' ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
                        onClick={(event) => {
                          const details = event.currentTarget.closest('details')
                          if (details instanceof HTMLDetailsElement) details.open = false
                          void handleParticipantFriendAction()
                        }}
                        disabled={friendshipAction !== null}
                      >
                        <HiOutlineUsers className="h-4 w-4" aria-hidden="true" />
                        {friendshipAction === 'send' ? 'Sending friend invite…' : 'Add Friend'}
                      </button>
                    ) : null}

                    {!resolvedSelectedParticipantRelationship.profileFamilyRelationship ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
                        onClick={(event) => {
                          const details = event.currentTarget.closest('details')
                          if (details instanceof HTMLDetailsElement) details.open = false
                          setParticipantFamilyModalOpen(true)
                        }}
                        disabled={familyInviteSending}
                      >
                        <HiOutlineUsers className="h-4 w-4" aria-hidden="true" />
                        Add Family
                      </button>
                    ) : null}

                    {resolvedSelectedParticipantRelationship.connectionStatus === 'incoming' ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
                        onClick={(event) => {
                          const details = event.currentTarget.closest('details')
                          if (details instanceof HTMLDetailsElement) details.open = false
                          void handleParticipantConnectionAction()
                        }}
                        disabled={connectionAction !== null}
                      >
                        <FaUserTie className="h-4 w-4" aria-hidden="true" />
                        {connectionAction === 'accept' ? 'Accepting network…' : 'Accept Business Request'}
                      </button>
                    ) : resolvedSelectedParticipantRelationship.connectionStatus === 'outgoing' ? (
                      <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 opacity-55" disabled>
                        <FaUserTie className="h-4 w-4" aria-hidden="true" />
                        Business request sent
                      </button>
                    ) : resolvedSelectedParticipantRelationship.connectionStatus !== 'connected' ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
                        onClick={(event) => {
                          const details = event.currentTarget.closest('details')
                          if (details instanceof HTMLDetailsElement) details.open = false
                          void handleParticipantConnectionAction()
                        }}
                        disabled={connectionAction !== null}
                      >
                        <FaUserTie className="h-4 w-4" aria-hidden="true" />
                        {connectionAction === 'send' ? 'Sending network invite…' : 'Add Business Network'}
                      </button>
                    ) : null}
                  </div>
                </details>
              )}

              {resolvedSelectedParticipantRelationship.profileFamilyRelationship ? (
                <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                  Family: {resolvedSelectedParticipantRelationship.profileFamilyRelationship.relationshipLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={participantFamilyModalOpen}
        onClose={() => {
          if (familyInviteSending) return
          setParticipantFamilyModalOpen(false)
        }}
        title={`Add @${resolvedSelectedParticipantProfile?.handle || selectedParticipant?.handle || 'participant'} as family`}
        maxWidthClassName="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">How are you related? We will send a notification with a direct link back to your profile.</p>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">
            <span>Relationship</span>
            <select
              value={familyRelationshipValue}
              onChange={(event) => setFamilyRelationshipValue(event.target.value as 'parent' | 'child' | 'sibling' | 'spouse' | 'other')}
              disabled={familyInviteSending}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/15"
            >
              <option value="parent">Parent</option>
              <option value="child">Child</option>
              <option value="sibling">Sibling</option>
              <option value="spouse">Spouse</option>
              <option value="other">Other</option>
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setParticipantFamilyModalOpen(false)}
              disabled={familyInviteSending}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-55"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleParticipantFamilyInvite().then(() => {
                  setParticipantFamilyModalOpen(false)
                })
              }}
              disabled={familyInviteSending}
              className="rounded-xl bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-55"
            >
              {familyInviteSending ? 'Sending…' : 'Send Family Request'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
