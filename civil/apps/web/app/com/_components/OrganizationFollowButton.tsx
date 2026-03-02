'use client'

import { useCallback, useMemo, useState } from 'react'
import { buildApiUrl } from '../../_lib/api'

type Props = {
  province: string
  municipality: string
  slug: string
  initialFollowed?: boolean
}

export default function OrganizationFollowButton({ province, municipality, slug, initialFollowed = false }: Props) {
  const [following, setFollowing] = useState<boolean>(initialFollowed)
  const [busy, setBusy] = useState<boolean>(false)

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])

  const apiBase = useMemo(() => {
    const base = `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/follow`
    return buildApiUrl(base)
  }, [province, municipality, slug])

  const onToggle = useCallback(async () => {
    if (!token) {
      alert('Please sign in to join organizations.')
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
        const message = following ? 'Unable to leave organization.' : 'Unable to join organization.'
        alert(message)
        return
      }

      setFollowing((value) => !value)
    } finally {
      setBusy(false)
    }
  }, [apiBase, following, token])

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      className={
        following
          ? 'inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 disabled:opacity-60'
          : 'inline-flex items-center rounded-full border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60'
      }
    >
      {busy ? 'Please wait…' : following ? 'Joined' : 'Join'}
    </button>
  )
}
