'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildApiUrl } from '../../_lib/api'

type Props = {
  province: string
  municipality: string
  slug: string
  initialFollowed?: boolean
  lockedFollowing?: boolean
}

export default function OrganizationFollowButton({ province, municipality, slug, initialFollowed = false, lockedFollowing = false }: Props) {
  const [following, setFollowing] = useState<boolean>(initialFollowed)
  const [busy, setBusy] = useState<boolean>(false)

  useEffect(() => {
    if (lockedFollowing) {
      setFollowing(true)
      return
    }
    setFollowing(initialFollowed)
  }, [initialFollowed, lockedFollowing])

  const apiBase = useMemo(() => {
    const base = `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/follow`
    return buildApiUrl(base)
  }, [province, municipality, slug])

  const onToggle = useCallback(async () => {
    if (lockedFollowing) return
    const token = typeof window === 'undefined' ? null : window.localStorage.getItem('token')
    if (!token) {
      alert('Please sign in to follow organizations.')
      return
    }

    setBusy(true)
    try {
      const response = await fetch(apiBase, {
        method: following ? 'DELETE' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const message = following ? 'Unable to unfollow organization.' : 'Unable to follow organization.'
        alert(message)
        return
      }

      setFollowing((value) => !value)
    } finally {
      setBusy(false)
    }
  }, [apiBase, following, lockedFollowing])

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy || lockedFollowing}
      className={
        following
          ? 'inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-default disabled:opacity-60'
          : 'inline-flex items-center rounded-full border border-rose-600 bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:border-rose-700 hover:bg-rose-700 disabled:opacity-60'
      }
    >
      {busy ? 'Please wait…' : lockedFollowing ? '(Following)' : following ? 'Unfollow' : 'Follow'}
    </button>
  )
}
