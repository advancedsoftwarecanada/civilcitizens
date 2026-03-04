'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { HiOutlineLink, HiOutlineShare } from 'react-icons/hi2'
import Modal from './Modal'
import VerifiedAvatar from './VerifiedAvatar'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { formatDisplayName } from '../_lib/text'
import { getStoredToken } from '../_lib/tokenStorage'
import { buildDirectShareMessage, toAbsoluteShareUrl, type ShareTarget } from '../_lib/shareTarget'
import { pushToast } from './useToasts'

type ShareSendModalProps = {
  target: ShareTarget
  onClose: () => void
}

type ShareUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl?: string | null
  isPremium: boolean
  isVerified: boolean
}

type FriendEntry = {
  id: string
  status: string
  since: string | null
  user: ShareUser
}

type ConnectionEntry = {
  id: string
  status: string
  since: string | null
  user: ShareUser
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined') return false

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fallback below.
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

export default function ShareSendModal({ target, onClose }: ShareSendModalProps) {
  const [friends, setFriends] = useState<FriendEntry[]>([])
  const [connections, setConnections] = useState<ConnectionEntry[]>([])
  const [loadingPeople, setLoadingPeople] = useState(true)
  const [sendingUserId, setSendingUserId] = useState<string | null>(null)
  const [peopleError, setPeopleError] = useState<string | null>(null)

  const absoluteUrl = useMemo(() => toAbsoluteShareUrl(target.url), [target.url])
  const shareText = useMemo(() => target.description || target.title || 'Check this out on Civil', [target.description, target.title])

  const sortedFriends = useMemo(() => {
    const list = [...friends]
    list.sort((a, b) => {
      const nameA = formatDisplayName(a.user.name ?? a.user.handle) || a.user.handle
      const nameB = formatDisplayName(b.user.name ?? b.user.handle) || b.user.handle
      return nameA.localeCompare(nameB)
    })
    return list
  }, [friends])

  const sortedConnections = useMemo(() => {
    const list = [...connections]
    list.sort((a, b) => {
      const nameA = formatDisplayName(a.user.name ?? a.user.handle) || a.user.handle
      const nameB = formatDisplayName(b.user.name ?? b.user.handle) || b.user.handle
      return nameA.localeCompare(nameB)
    })
    return list
  }, [connections])

  useEffect(() => {
    let cancelled = false
    const token = getStoredToken()
    if (!token) {
      setLoadingPeople(false)
      return
    }

    void (async () => {
      setLoadingPeople(true)
      setPeopleError(null)
      try {
        const [friendsRes, connectionsRes] = await Promise.all([
          fetch(buildApiUrl('/friends'), {
            headers: { authorization: `Bearer ${token}` },
          }),
          fetch(buildApiUrl('/connections'), {
            headers: { authorization: `Bearer ${token}` },
          }),
        ])

        if (!friendsRes.ok || !connectionsRes.ok) {
          if (friendsRes.status === 401 || connectionsRes.status === 401) {
            redirectToAuthModal('login')
            return
          }
          throw new Error('send_to_people_load_failed')
        }

        const friendsPayload = (await friendsRes.json().catch(() => null)) as { items?: FriendEntry[] } | null
        const connectionsPayload = (await connectionsRes.json().catch(() => null)) as { items?: ConnectionEntry[] } | null

        if (!cancelled) {
          setFriends(Array.isArray(friendsPayload?.items) ? friendsPayload.items : [])
          setConnections(Array.isArray(connectionsPayload?.items) ? connectionsPayload.items : [])
        }
      } catch (error) {
        console.error('Failed to load share recipients', error)
        if (!cancelled) {
          setPeopleError('Unable to load contacts right now.')
          setFriends([])
          setConnections([])
        }
      } finally {
        if (!cancelled) setLoadingPeople(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const handleCopyUrl = useCallback(async () => {
    const copied = await copyTextToClipboard(absoluteUrl)
    if (copied) {
      pushToast('URL copied', 'success')
      return
    }
    pushToast('Unable to copy URL on this device', 'error')
  }, [absoluteUrl])

  const handleShareExternally = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: target.title || 'Civil',
          text: shareText,
          url: absoluteUrl,
        })
        return
      }
    } catch (error) {
      const isAbortError = error instanceof DOMException && error.name === 'AbortError'
      if (isAbortError) return
    }

    const copied = await copyTextToClipboard(absoluteUrl)
    if (copied) {
      pushToast('Share is unavailable here. URL copied instead.', 'success')
      return
    }
    pushToast('Unable to open external share or copy URL', 'error')
  }, [absoluteUrl, shareText, target.title])

  const sendToUser = useCallback(
    async (user: ShareUser) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }
      if (sendingUserId) return

      const displayName = formatDisplayName(user.name ?? user.handle) || user.handle
      const body = buildDirectShareMessage(target)

      setSendingUserId(user.id)
      try {
        const threadRes = await fetch(buildApiUrl('/messages/threads/direct'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ userId: user.id }),
        })

        const threadPayload = (await threadRes.json().catch(() => null)) as { thread?: { id?: string }; error?: string } | null
        if (!threadRes.ok) {
          const errorCode = threadPayload?.error
          if (errorCode === 'not_friends') {
            pushToast('Direct send currently requires friendship or network connection.', 'error')
            return
          }
          pushToast('Unable to open a direct chat for sharing right now.', 'error')
          return
        }

        const threadId = typeof threadPayload?.thread?.id === 'string' ? threadPayload.thread.id : ''
        if (!threadId) {
          pushToast('Unable to open a direct chat for sharing right now.', 'error')
          return
        }

        const messageRes = await fetch(buildApiUrl(`/messages/threads/${encodeURIComponent(threadId)}/messages`), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ body }),
        })

        if (!messageRes.ok) {
          pushToast('Unable to send this right now.', 'error')
          return
        }

        pushToast(`Sent to ${displayName}`, 'success')
      } catch (error) {
        console.error('Failed sending shared item to user', error)
        pushToast('Unable to send this right now.', 'error')
      } finally {
        setSendingUserId(null)
      }
    },
    [sendingUserId, target],
  )

  const renderContactRow = (label: string, items: Array<FriendEntry | ConnectionEntry>, emptyText: string) => {
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</h3>
        {loadingPeople ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-[86px] w-[72px] shrink-0 rounded-xl border border-slate-200 bg-slate-50" />
            ))}
          </div>
        ) : items.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {items.map((entry) => {
              const displayName = formatDisplayName(entry.user.name ?? entry.user.handle) || entry.user.handle
              const isSending = sendingUserId === entry.user.id
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void sendToUser(entry.user)}
                  disabled={Boolean(sendingUserId)}
                  className="group flex h-[86px] w-[72px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-1.5 text-center transition hover:border-[var(--cc-primary)] hover:bg-[var(--cc-primary)]/5 disabled:cursor-not-allowed disabled:opacity-60"
                  title={displayName}
                >
                  <VerifiedAvatar
                    src={entry.user.avatarUrl}
                    alt={displayName}
                    initials={displayName}
                    size={36}
                    isVerified={entry.user.isVerified}
                    isBusiness={entry.user.isPremium}
                  />
                  <span className="w-full truncate text-[11px] font-semibold text-slate-700">
                    {isSending ? 'Sending…' : displayName}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{emptyText}</p>
        )}
      </section>
    )
  }

  return (
    <Modal open onClose={onClose} title="Send to" maxWidthClassName="max-w-2xl">
      <div className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start gap-3">
            {target.imageUrl ? (
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
                <img src={target.imageUrl} alt={target.title} className="h-full w-full object-cover" loading="lazy" />
              </div>
            ) : null}
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-slate-900">{target.title}</p>
              {target.description ? <p className="line-clamp-2 text-xs text-slate-600">{target.description}</p> : null}
              <p className="truncate text-[11px] text-slate-500">{absoluteUrl}</p>
            </div>
          </div>
        </section>

        {renderContactRow('Friends', sortedFriends, 'No friends available yet.')}
        {renderContactRow('Network', sortedConnections, 'No network connections available yet.')}

        {peopleError ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{peopleError}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopyUrl()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--cc-primary)]/35 bg-[var(--cc-primary)]/10 px-3 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)]/15"
          >
            <HiOutlineLink className="h-4 w-4" />
            <span>Copy URL</span>
          </button>
          <button
            type="button"
            onClick={() => void handleShareExternally()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--cc-primary)]/35 bg-[var(--cc-primary)]/10 px-3 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)]/15"
          >
            <HiOutlineShare className="h-4 w-4" />
            <span>External Share</span>
          </button>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
