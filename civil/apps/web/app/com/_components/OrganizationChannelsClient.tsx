'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import Modal from '../../_components/Modal'
import { buildApiUrl } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'
import { redirectToAuthModal } from '../../_lib/authModal'
import { pushToast } from '../../_components/useToasts'
import { formatUserDisplayName } from '../../_lib/text'

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
  role: string
  user: ThreadUser
  isViewer: boolean
}

type MessagePayload = {
  id: string
  body: string | null
  createdAt: string
  sender: ThreadUser
  isMine: boolean
}

type ChannelRow = {
  id: string
  name: string
  slug: string
  visibility: 'public' | 'private'
  joined: boolean
  isOwner: boolean
  unread: boolean
  participantCount: number
  notification?: {
    muteChannel?: boolean
    mentionsOnly?: boolean
  }
}

type ChannelsResponse = {
  organization?: { id: string; name: string; viewerRole: 'OWNER' | 'MANAGER' | null }
  serverNotification?: { muteServer?: boolean; mentionsOnly?: boolean }
  items?: ChannelRow[]
}

type ThreadDetailResponse = {
  thread: {
    id: string
    participants: ThreadParticipant[]
  }
  messages: MessagePayload[]
}

type OrgMember = {
  userId: string
  user: ThreadUser
}

type OrganizationChannelsMode = 'chat' | 'manage'

export default function OrganizationChannelsClient({
  province,
  municipality,
  slug,
  initialChannelId,
  mode = 'chat',
  onTitleChange,
}: {
  province: string
  municipality: string
  slug: string
  initialChannelId?: string
  mode?: OrganizationChannelsMode
  onTitleChange?: (title: string) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [channelQuery, setChannelQuery] = useState('')
  const [chatQuery, setChatQuery] = useState('')
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(initialChannelId ?? null)
  const [messages, setMessages] = useState<MessagePayload[]>([])
  const [composer, setComposer] = useState('')
  const [orgRole, setOrgRole] = useState<'OWNER' | 'MANAGER' | null>(null)
  const [serverMuted, setServerMuted] = useState(false)
  const [serverMentionsOnly, setServerMentionsOnly] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelVisibility, setNewChannelVisibility] = useState<'public' | 'private'>('public')
  const [memberOptions, setMemberOptions] = useState<OrgMember[]>([])
  const [inviteUserId, setInviteUserId] = useState('')
  const [channelPickerOpen, setChannelPickerOpen] = useState(false)

  const token = typeof window !== 'undefined' ? getStoredToken() : null

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!token) {
        redirectToAuthModal('login')
        throw new Error('unauthorized')
      }
      const headers = new Headers(init?.headers)
      headers.set('authorization', `Bearer ${token}`)
      return fetch(buildApiUrl(path), { ...init, headers })
    },
    [token],
  )

  const channelsPath = `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/channels`

  const applyChannelSelection = useCallback(
    (nextId: string | null) => {
      setSelectedChannelId(nextId)
      if (mode !== 'chat') return
      if (!pathname) return

      const params = new URLSearchParams(searchParams?.toString())
      if (nextId) params.set('channel', nextId)
      else params.delete('channel')
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    },
    [mode, pathname, router, searchParams],
  )

  const loadChannels = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authedFetch(channelsPath, { cache: 'no-store' })
      if (!res.ok) {
        setError('Unable to load channels right now.')
        setChannels([])
        return
      }
      const payload = (await res.json().catch(() => null)) as ChannelsResponse | null
      const items = Array.isArray(payload?.items) ? payload.items : []
      setChannels(items)
      setOrgRole(payload?.organization?.viewerRole ?? null)
      setServerMuted(Boolean(payload?.serverNotification?.muteServer))
      setServerMentionsOnly(Boolean(payload?.serverNotification?.mentionsOnly))
    } catch (err) {
      console.error('Failed to load channels', err)
      setError('Unable to load channels right now.')
      setChannels([])
    } finally {
      setLoading(false)
    }
  }, [authedFetch, channelsPath])

  const loadMembers = useCallback(async () => {
    try {
      const res = await authedFetch(
        `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/members`,
        { cache: 'no-store' },
      )
      if (!res.ok) return
      const payload = (await res.json().catch(() => null)) as { members?: OrgMember[]; followers?: OrgMember[] } | null
      const merged = [...(payload?.members ?? []), ...(payload?.followers ?? [])]
      const uniq = new Map<string, OrgMember>()
      merged.forEach((entry) => {
        if (!uniq.has(entry.userId)) uniq.set(entry.userId, entry)
      })
      setMemberOptions(Array.from(uniq.values()))
    } catch {
      setMemberOptions([])
    }
  }, [authedFetch, municipality, province, slug])

  useEffect(() => {
    void loadChannels()
    void loadMembers()
  }, [loadChannels, loadMembers])

  useEffect(() => {
    if (!initialChannelId) return
    applyChannelSelection(initialChannelId)
  }, [applyChannelSelection, initialChannelId])

  const selectedChannel = useMemo(() => channels.find((c) => c.id === selectedChannelId) ?? null, [channels, selectedChannelId])

  useEffect(() => {
    if (mode !== 'chat') return
    if (!onTitleChange) return
    onTitleChange(selectedChannel ? `#${selectedChannel.slug}` : 'Select channel')
  }, [mode, onTitleChange, selectedChannel?.slug])

  const filteredChannels = useMemo(() => {
    const q = channelQuery.trim().toLowerCase()
    if (!q) return channels
    return channels.filter((channel) => channel.name.toLowerCase().includes(q) || channel.slug.toLowerCase().includes(q))
  }, [channelQuery, channels])

  const filteredMessages = useMemo(() => {
    const q = chatQuery.trim().toLowerCase()
    if (!q) return messages
    return messages.filter((message) => (message.body ?? '').toLowerCase().includes(q))
  }, [chatQuery, messages])

  const loadThread = useCallback(async () => {
    if (!selectedChannelId || !selectedChannel?.joined) {
      setMessages([])
      return
    }
    try {
      const params = new URLSearchParams({ limit: '80' })
      const res = await authedFetch(`/messages/threads/${selectedChannelId}?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) {
        setMessages([])
        return
      }
      const payload = (await res.json().catch(() => null)) as ThreadDetailResponse | null
      setMessages(Array.isArray(payload?.messages) ? payload!.messages : [])
    } catch {
      setMessages([])
    }
  }, [authedFetch, selectedChannel?.joined, selectedChannelId])

  useEffect(() => {
    void loadThread()
  }, [loadThread])

  const createChannel = useCallback(async () => {
    if (!newChannelName.trim()) return
    setSaving(true)
    try {
      const res = await authedFetch(channelsPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newChannelName.trim(), visibility: newChannelVisibility }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; channel?: { id: string } } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to create channel.', 'error')
        return
      }
      setNewChannelName('')
      await loadChannels()
      if (payload?.channel?.id) {
        applyChannelSelection(payload.channel.id)
      }
    } catch (err) {
      console.error('Failed to create channel', err)
      pushToast('Unable to create channel.', 'error')
    } finally {
      setSaving(false)
    }
  }, [applyChannelSelection, authedFetch, channelsPath, loadChannels, newChannelName, newChannelVisibility])

  const joinChannel = useCallback(
    async (channelId: string) => {
      setSaving(true)
      try {
        const res = await authedFetch(`${channelsPath}/${channelId}/join`, { method: 'POST' })
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null
          pushToast(payload?.error ?? 'Unable to join channel.', 'error')
          return
        }
        await loadChannels()
        applyChannelSelection(channelId)
      } finally {
        setSaving(false)
      }
    },
    [applyChannelSelection, authedFetch, channelsPath, loadChannels],
  )

  const leaveChannel = useCallback(
    async (channelId: string) => {
      setSaving(true)
      try {
        const res = await authedFetch(`${channelsPath}/${channelId}/leave`, { method: 'POST' })
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null
          pushToast(payload?.error ?? 'Unable to leave channel.', 'error')
          return
        }
        await loadChannels()
        setMessages([])
      } finally {
        setSaving(false)
      }
    },
    [authedFetch, channelsPath, loadChannels],
  )

  const openChannelFromManage = useCallback(
    (channelId: string) => {
      if (!pathname) return
      const basePath = pathname.endsWith('/manage') ? pathname.slice(0, -'/manage'.length) : pathname
      router.push(`${basePath}?channel=${encodeURIComponent(channelId)}`)
    },
    [pathname, router],
  )

  const inviteMember = useCallback(async () => {
    if (!selectedChannelId || !inviteUserId) return
    setSaving(true)
    try {
      const res = await authedFetch(`${channelsPath}/${selectedChannelId}/invite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: inviteUserId }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? 'Unable to invite member.', 'error')
        return
      }
      setInviteUserId('')
      pushToast('Member invited to channel.', 'success')
      await loadChannels()
    } finally {
      setSaving(false)
    }
  }, [authedFetch, channelsPath, inviteUserId, loadChannels, selectedChannelId])

  const updateServerNotification = useCallback(
    async (next: { muteServer?: boolean; mentionsOnly?: boolean }) => {
      try {
        const res = await authedFetch(`${channelsPath}/notification`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        })
        if (!res.ok) return
        if (typeof next.muteServer === 'boolean') setServerMuted(next.muteServer)
        if (typeof next.mentionsOnly === 'boolean') setServerMentionsOnly(next.mentionsOnly)
      } catch {
        // ignore
      }
    },
    [authedFetch, channelsPath],
  )

  const updateChannelNotification = useCallback(
    async (channelId: string, next: { muteChannel?: boolean; mentionsOnly?: boolean }) => {
      try {
        const res = await authedFetch(`${channelsPath}/${channelId}/notification`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        })
        if (!res.ok) return
        await loadChannels()
      } catch {
        // ignore
      }
    },
    [authedFetch, channelsPath, loadChannels],
  )

  const sendMessage = useCallback(async () => {
    if (!selectedChannelId || !composer.trim()) return
    setSaving(true)
    try {
      const res = await authedFetch(`/messages/threads/${selectedChannelId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: composer.trim() }),
      })
      if (!res.ok) {
        pushToast('Unable to send message.', 'error')
        return
      }
      setComposer('')
      await loadThread()
    } finally {
      setSaving(false)
    }
  }, [authedFetch, composer, loadThread, selectedChannelId])

  if (loading) return <p className="text-sm text-slate-500">Loading channels…</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>

  if (mode === 'manage') {
    const canManage = orgRole === 'OWNER' || orgRole === 'MANAGER'

    return (
      <div className="space-y-4">
        <input
          type="text"
          value={channelQuery}
          onChange={(event) => setChannelQuery(event.target.value)}
          placeholder="Search channels"
          className="w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none"
        />

        {canManage ? (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-900">Create channel</p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-center">
              <input
                type="text"
                value={newChannelName}
                onChange={(event) => setNewChannelName(event.target.value)}
                placeholder="New channel name"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <select
                value={newChannelVisibility}
                onChange={(event) => setNewChannelVisibility(event.target.value as 'public' | 'private')}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
              <button
                type="button"
                onClick={createChannel}
                disabled={saving || !newChannelName.trim()}
                className="w-full rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">You don’t have permission to manage channels.</p>
        )}

        <div className="space-y-2">
          {filteredChannels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => openChannelFromManage(channel.id)}
              className={clsx(
                'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50',
                selectedChannelId === channel.id ? 'border-[var(--cc-primary)]' : null,
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">#{channel.slug}</p>
                    {channel.unread ? <span className="h-2 w-2 rounded-full bg-[var(--cc-primary)]" aria-hidden="true" /> : null}
                    <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {channel.visibility}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">{channel.name}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{channel.participantCount} members</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => setChannelPickerOpen(true)}
          className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:w-auto"
        >
          Channels
        </button>

        <input
          type="text"
          value={chatQuery}
          onChange={(event) => setChatQuery(event.target.value)}
          placeholder={selectedChannel ? `Search #${selectedChannel.slug}` : 'Search chat'}
          disabled={!selectedChannel}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none disabled:opacity-60 sm:max-w-sm"
        />
      </div>

      <section className="flex min-h-[420px] flex-col rounded-2xl border border-slate-200 bg-white p-3">
        {!selectedChannel ? (
          <p className="text-sm text-slate-500">Select a channel.</p>
        ) : (
          <>
            <div className="border-b border-slate-100 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">#{selectedChannel.slug}</h3>
                  <p className="text-xs text-slate-500">{selectedChannel.name} · {selectedChannel.participantCount} members</p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedChannel.joined ? (
                    <button
                      type="button"
                      onClick={() => leaveChannel(selectedChannel.id)}
                      className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600"
                    >
                      Leave
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => joinChannel(selectedChannel.id)}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      Join
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => updateServerNotification({ muteServer: !serverMuted })}
                  className={clsx('rounded-full border px-2.5 py-1', serverMuted ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600')}
                >
                  Mute server
                </button>
                <button
                  type="button"
                  onClick={() => updateServerNotification({ mentionsOnly: !serverMentionsOnly })}
                  className={clsx('rounded-full border px-2.5 py-1', serverMentionsOnly ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600')}
                >
                  Mentions only
                </button>
                <button
                  type="button"
                  onClick={() => updateChannelNotification(selectedChannel.id, { muteChannel: !selectedChannel.notification?.muteChannel })}
                  className={clsx('rounded-full border px-2.5 py-1', selectedChannel.notification?.muteChannel ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600')}
                >
                  Mute channel
                </button>
              </div>

              {(orgRole === 'OWNER' || orgRole === 'MANAGER') && selectedChannel.visibility === 'private' ? (
                <div className="mt-2 flex items-center gap-2">
                  <select
                    value={inviteUserId}
                    onChange={(event) => setInviteUserId(event.target.value)}
                    className="min-w-[220px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="">Invite member…</option>
                    {memberOptions.map((entry) => (
                      <option key={entry.userId} value={entry.userId}>
                        {formatUserDisplayName(entry.user.name, entry.user.handle) || entry.user.handle}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={inviteMember} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Invite
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
              {!selectedChannel.joined ? (
                <p className="text-sm text-slate-500">Join this channel to read and send messages.</p>
              ) : filteredMessages.length === 0 ? (
                <p className="text-sm text-slate-500">No messages found.</p>
              ) : (
                filteredMessages.map((message) => (
                  <div
                    key={message.id}
                    className={clsx(
                      'flex items-end gap-2',
                      message.isMine ? 'justify-end' : 'justify-start',
                    )}
                  >
                    {!message.isMine ? (
                      <VerifiedAvatar
                        src={message.sender.avatarUrl}
                        alt={formatUserDisplayName(message.sender.name, message.sender.handle) || `@${message.sender.handle}`}
                        initials={formatUserDisplayName(message.sender.name, message.sender.handle) || message.sender.handle}
                        size={28}
                        isVerified={Boolean(message.sender.isVerified)}
                        className="shrink-0"
                      />
                    ) : null}

                    <div className={clsx('flex max-w-[80%] flex-col', message.isMine ? 'items-end' : 'items-start')}>
                      <p className="mb-1 text-xs font-semibold text-slate-500">
                        {message.isMine
                          ? 'You'
                          : formatUserDisplayName(message.sender.name, message.sender.handle) || `@${message.sender.handle}`}
                      </p>
                      <div
                        className={clsx(
                          'rounded-2xl px-3 py-2 text-sm',
                          message.isMine
                            ? 'bg-[var(--cc-primary)] text-white'
                            : 'border border-slate-200 bg-slate-50 text-slate-800',
                        )}
                      >
                        {message.body}
                      </div>
                    </div>

                    {message.isMine ? (
                      <VerifiedAvatar
                        src={message.sender.avatarUrl}
                        alt="You"
                        initials={formatUserDisplayName(message.sender.name, message.sender.handle) || message.sender.handle}
                        size={28}
                        isVerified={Boolean(message.sender.isVerified)}
                        className="shrink-0"
                      />
                    ) : null}
                  </div>
                ))
              )}
            </div>

            <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
              <input
                type="text"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                placeholder={selectedChannel.joined ? 'Message channel…' : 'Join channel to message'}
                disabled={!selectedChannel.joined}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!selectedChannel.joined || !composer.trim() || saving}
                className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </>
        )}
      </section>

      <Modal open={channelPickerOpen} onClose={() => setChannelPickerOpen(false)} title="Select channel" maxWidthClassName="max-w-lg">
        <div className="space-y-3">
          <input
            type="text"
            value={channelQuery}
            onChange={(event) => setChannelQuery(event.target.value)}
            placeholder="Search channels"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none"
          />

          <div className="space-y-2">
            {filteredChannels.length ? (
              filteredChannels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => {
                    applyChannelSelection(channel.id)
                    setChannelPickerOpen(false)
                  }}
                  className={clsx(
                    'w-full rounded-2xl border px-4 py-3 text-left transition',
                    selectedChannelId === channel.id
                      ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/5'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">#{channel.slug}</p>
                        {channel.unread ? <span className="h-2 w-2 rounded-full bg-[var(--cc-primary)]" aria-hidden="true" /> : null}
                        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {channel.visibility}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">{channel.name}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{channel.participantCount} members</span>
                  </div>
                </button>
              ))
            ) : (
              <p className="text-sm text-slate-500">No channels found.</p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
