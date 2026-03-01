'use client'

import { useCallback, useMemo, useState } from 'react'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { pushToast } from '../../_components/useToasts'
import { redirectToAuthModal } from '../../_lib/authModal'

export default function OrganizationJoinClient({
  province,
  municipality,
  slug,
  referrerUserId,
  inviterName,
  orgName,
  planId,
}: {
  province: string
  municipality: string
  slug: string
  referrerUserId: string | null
  inviterName: string
  orgName: string
  planId: string | null
}) {
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('token') : null), [])
  const [joining, setJoining] = useState(false)

  const orgApiPath = useMemo(() => {
    return `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`
  }, [municipality, province, slug])

  const joinOrganization = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setJoining(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/governance/join`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          referredByUserId: referrerUserId,
          planId,
          note: 'Joined via referral invite',
        }),
      })

      const { json } = await parseApiResponse<{ error?: unknown; member?: { status?: string } }>(res)
      if (!res.ok) {
        const rawError =
          typeof (json as any)?.error === 'string'
            ? (json as any).error
            : typeof (json as any)?.error?.message === 'string'
              ? (json as any).error.message
              : null
        pushToast(rawError ?? 'Unable to join organization right now.', 'error')
        return
      }

      const status = typeof json?.member?.status === 'string' ? json.member.status : null
      pushToast(status === 'ACTIVE' ? 'Joined organization.' : 'Join request submitted.', 'success')
      if (typeof window !== 'undefined') {
        window.location.href = `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`
      }
    } catch {
      pushToast('Unable to join organization right now.', 'error')
    } finally {
      setJoining(false)
    }
  }, [municipality, orgApiPath, planId, province, referrerUserId, slug, token])

  return (
    <div className="space-y-4">
      <p className="text-base font-semibold text-slate-900">{inviterName} has invited you to join {orgName} on Civil Citizens.</p>
      <p className="text-sm text-slate-600">Join this organization to access updates, events, and member features.</p>
      {planId ? <p className="text-xs text-slate-500">Invite includes plan: {planId}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void joinOrganization()}
          disabled={joining}
          className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {joining ? 'Joining…' : 'Join organization'}
        </button>
      </div>
    </div>
  )
}
