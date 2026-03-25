'use client'

import { useCallback, useEffect, useState } from 'react'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { pushToast } from './useToasts'

type TopicFollowButtonProps = {
  slug: string
  initialFollowing?: boolean
  size?: 'sm' | 'md'
  onChange?: (following: boolean) => void
  className?: string
}

export default function TopicFollowButton({
  slug,
  initialFollowing = false,
  size = 'md',
  onChange,
  className = '',
}: TopicFollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setFollowing(initialFollowing)
  }, [initialFollowing])

  const handleToggle = useCallback(async () => {
    const token = typeof window === 'undefined' ? null : window.localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    const nextFollowing = !following
    setBusy(true)
    try {
      const response = await fetch(buildApiUrl('/topics/follows'), {
        method: following ? 'DELETE' : 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ slug }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        pushToast(payload?.error ?? (following ? 'Unable to unfollow this topic right now.' : 'Unable to follow this topic right now.'), 'error')
        return
      }

      setFollowing(nextFollowing)
      onChange?.(nextFollowing)
      pushToast(nextFollowing ? 'Topic followed.' : 'Topic removed from your list.', nextFollowing ? 'success' : 'info')
    } catch {
      pushToast(following ? 'Unable to unfollow this topic right now.' : 'Unable to follow this topic right now.', 'error')
    } finally {
      setBusy(false)
    }
  }, [following, onChange, slug])

  const sizeClassName = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
  const toneClassName = following
    ? 'border border-slate-200 bg-slate-100 text-slate-700 hover:border-slate-300 hover:bg-slate-200'
    : 'border border-[var(--cc-primary)] bg-[var(--cc-primary)] text-white hover:brightness-95'

  return (
    <button
      type="button"
      onClick={() => void handleToggle()}
      disabled={busy}
      className={`inline-flex items-center justify-center rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${sizeClassName} ${toneClassName} ${className}`.trim()}
    >
      {busy ? 'Saving…' : following ? 'Unfollow' : 'Follow'}
    </button>
  )
}
