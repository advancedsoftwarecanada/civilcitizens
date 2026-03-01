'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { pushToast } from '../../_components/useToasts'
import { redirectToAuthModal } from '../../_lib/authModal'

type MeResponse = {
  user?: {
    id?: string
    name?: string | null
    handle?: string | null
  }
}

type OrgResponse = {
  org?: {
    name?: string
    viewerRole?: 'OWNER' | 'MANAGER' | null
  }
}

export default function OrganizationReferralsClient({
  province,
  municipality,
  slug,
}: {
  province: string
  municipality: string
  slug: string
}) {
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('token') : null), [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [orgName, setOrgName] = useState<string>('Organization')
  const [viewerRole, setViewerRole] = useState<'OWNER' | 'MANAGER' | null>(null)
  const [referrerId, setReferrerId] = useState('')
  const [inviterName, setInviterName] = useState('A Civil Citizens member')
  const [referredUserId, setReferredUserId] = useState('')
  const [planId, setPlanId] = useState('')

  const orgApiPath = useMemo(() => {
    return `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`
  }, [municipality, province, slug])

  const inviteLink = useMemo(() => {
    if (typeof window === 'undefined' || !referrerId.trim()) return ''
    const base = `${window.location.origin}/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/join`
    const params = new URLSearchParams()
    params.set('ref', referrerId.trim())
    params.set('inviter', inviterName.trim() || 'A Civil Citizens member')
    if (planId.trim()) params.set('plan', planId.trim())
    return `${base}?${params.toString()}`
  }, [inviterName, municipality, planId, province, referrerId, slug])

  const inviteMessage = useMemo(() => {
    const sender = inviterName.trim() || 'A Civil Citizens member'
    return `${sender} has invited you to join ${orgName} on Civil Citizens.`
  }, [inviterName, orgName])

  const canManageReferrals = Boolean(viewerRole === 'OWNER' || viewerRole === 'MANAGER')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const orgRes = await fetch(buildApiUrl(orgApiPath), {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      })
      if (orgRes.ok) {
        const { json } = await parseApiResponse<OrgResponse>(orgRes)
        setOrgName(json?.org?.name || 'Organization')
        setViewerRole(json?.org?.viewerRole ?? null)
      }

      if (token) {
        const meRes = await fetch(buildApiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (meRes.ok) {
          const { json } = await parseApiResponse<MeResponse>(meRes)
          const meId = json?.user?.id ?? ''
          const display = json?.user?.name?.trim() || json?.user?.handle?.trim() || 'A Civil Citizens member'
          setReferrerId(meId)
          setInviterName(display)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [orgApiPath, token])

  useEffect(() => {
    void load()
  }, [load])

  const copyInvite = useCallback(async () => {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(`${inviteMessage}\n${inviteLink}`)
      pushToast('Invite message copied.', 'success')
    } catch {
      pushToast('Unable to copy invite message.', 'error')
    }
  }, [inviteLink, inviteMessage])

  const recordReferral = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!referrerId.trim() || !referredUserId.trim()) {
      pushToast('Referrer and referred user IDs are required.', 'error')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/governance/referrals`), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          referrerUserId: referrerId.trim(),
          referredUserId: referredUserId.trim(),
          planId: planId.trim() || null,
        }),
      })

      const { json } = await parseApiResponse<{ error?: unknown }>(res)
      if (!res.ok) {
        const rawError =
          typeof (json as any)?.error === 'string'
            ? (json as any).error
            : typeof (json as any)?.error?.message === 'string'
              ? (json as any).error.message
              : null
        pushToast(rawError ?? 'Unable to record referral.', 'error')
        return
      }

      pushToast('Referral recorded.', 'success')
      setReferredUserId('')
    } catch {
      pushToast('Unable to record referral.', 'error')
    } finally {
      setSaving(false)
    }
  }, [orgApiPath, planId, referredUserId, referrerId, token])

  if (loading) {
    return <p className="text-sm text-slate-500">Loading referrals…</p>
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Invite message</h3>
        <p className="mt-2 text-sm text-slate-700">{inviteMessage}</p>
        <p className="mt-2 break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {inviteLink || 'Sign in to generate an invite link.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyInvite()}
            disabled={!inviteLink}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Copy invite message
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Referral setup</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={inviterName}
            onChange={(event) => setInviterName(event.target.value)}
            placeholder="Inviter display name"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
          />
          <input
            value={referrerId}
            onChange={(event) => setReferrerId(event.target.value)}
            placeholder="Referrer user id"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
          />
          <input
            value={referredUserId}
            onChange={(event) => setReferredUserId(event.target.value)}
            placeholder="Referred user id"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
          />
          <input
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
            placeholder="Plan id (optional)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
          />
        </div>

        {!canManageReferrals ? (
          <p className="text-xs text-amber-700">Owner or manager permissions are required to record referrals.</p>
        ) : null}

        <button
          type="button"
          onClick={() => void recordReferral()}
          disabled={!canManageReferrals || saving}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Record referral'}
        </button>
      </section>
    </div>
  )
}
