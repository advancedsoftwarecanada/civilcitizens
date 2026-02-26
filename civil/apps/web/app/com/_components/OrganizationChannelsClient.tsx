'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import { buildApiUrl } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'
import { redirectToAuthModal } from '../../_lib/authModal'
import { pushToast } from '../../_components/useToasts'

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

export default function OrganizationChannelsClient({
  province,
  municipality,
  slug,
  initialChannelId,
}: {
  province: string
  municipality: string
  slug: string
  initialChannelId?: string
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [query, setQuery] = useState('')
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
      const firstChannel = items[0]
      if (!selectedChannelId && firstChannel) {
        setSelectedChannelId(firstChannel.id)
      }
    } catch (err) {
      console.error('Failed to load channels', err)
      setError('Unable to load channels right now.')
      setChannels([])
    } finally {
      setLoading(false)
    }
  }, [authedFetch, channelsPath, selectedChannelId])

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
    setSelectedChannelId(initialChannelId)
  }, [initialChannelId])

  const selectedChannel = useMemo(() => channels.find((c) => c.id === selectedChannelId) ?? null, [channels, selectedChannelId])

  const filteredChannels = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return channels
    return channels.filter((channel) => channel.name.toLowerCase().includes(q) || channel.slug.toLowerCase().includes(q))
  }, [channels, query])

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
        setSelectedChannelId(payload.channel.id)
      }
    } catch (err) {
      console.error('Failed to create channel', err)
      pushToast('Unable to create channel.', 'error')
    } finally {
      setSaving(false)
    }
  }, [authedFetch, channelsPath, loadChannels, newChannelName, newChannelVisibility])

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
        setSelectedChannelId(channelId)
      } finally {
        setSaving(false)
      }
    },
    [authedFetch, channelsPath, loadChannels],
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

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search channels"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none"
        />

        {(orgRole === 'OWNER' || orgRole === 'MANAGER') ? (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
            <input
              type="text"
              value={newChannelName}
              onChange={(event) => setNewChannelName(event.target.value)}
              placeholder="New channel name"
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
            />
            <div className="flex items-center gap-2">
              <select
                value={newChannelVisibility}
                onChange={(event) => setNewChannelVisibility(event.target.value as 'public' | 'private')}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
              <button
                type="button"
                onClick={createChannel}
                disabled={saving || !newChannelName.trim()}
                className="rounded-full bg-[var(--cc-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        ) : null}

        <div className="space-y-1">
          {filteredChannels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => setSelectedChannelId(channel.id)}
              className={clsx(
                'w-full rounded-xl border px-3 py-2 text-left text-sm transition',
                selectedChannelId === channel.id ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/5' : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-semibold text-slate-900">#{channel.slug}</p>
                {channel.unread ? <span className="h-2 w-2 rounded-full bg-[var(--cc-primary)]" /> : null}
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">{channel.name} · {channel.visibility}</p>
            </button>
          ))}
        </div>
      </aside>

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
                        {entry.user.name || entry.user.handle}
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
              ) : messages.length === 0 ? (
                <p className="text-sm text-slate-500">No messages yet.</p>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className={clsx('flex flex-col', message.isMine ? 'items-end' : 'items-start')}>
                    <p className="mb-1 text-xs font-semibold text-slate-500">{message.isMine ? 'You' : message.sender.name || `@${message.sender.handle}`}</p>
                    <div className={clsx('max-w-[80%] rounded-2xl px-3 py-2 text-sm', message.isMine ? 'bg-[var(--cc-primary)] text-white' : 'border border-slate-200 bg-slate-50 text-slate-800')}>
                      {message.body}
                    </div>
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
    </div>
  )
}
