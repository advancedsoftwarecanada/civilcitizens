'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import DashboardShell from '../../../_components/DashboardShell'
import { RightRail } from '../../../_components/RightRail'
import { buildApiUrl } from '../../../_lib/api'
import { pushToast } from '../../../_components/useToasts'
import CivilCard from '../../../_components/CivilCard'

type RequestUser = {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl?: string | null
  isPremium: boolean
  isVerified: boolean
}

type PendingConnectionRequest = {
  id: string
  status: string
  direction: 'incoming' | 'outgoing'
  requestedAt: string
  respondedAt: string | null
  user: RequestUser
}

type ConnectionRequestsResponse = {
  incoming?: PendingConnectionRequest[]
  outgoing?: PendingConnectionRequest[]
}

export default function PendingConnectionRequestsPage() {
  const [incoming, setIncoming] = useState<PendingConnectionRequest[]>([])
  const [outgoing, setOutgoing] = useState<PendingConnectionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingAction, setPendingAction] = useState<{ id: string; action: 'accept' | 'reject' } | null>(null)

  const loadRequests = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setIncoming([])
      setOutgoing([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(buildApiUrl('/connections/requests'), {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setIncoming([])
        setOutgoing([])
        return
      }
      const payload = (await res.json().catch(() => null)) as ConnectionRequestsResponse | null
      setIncoming(Array.isArray(payload?.incoming) ? payload.incoming : [])
      setOutgoing(Array.isArray(payload?.outgoing) ? payload.outgoing : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRequests()
  }, [loadRequests])

  const handleAction = useCallback(async (request: PendingConnectionRequest, action: 'accept' | 'reject') => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return

    setPendingAction({ id: request.id, action })
    try {
      const res = await fetch(buildApiUrl(`/connections/requests/${request.id}/${action}`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        pushToast(payload?.error ?? `Unable to ${action === 'accept' ? 'accept' : 'dismiss'} request.`, 'error')
        return
      }

      setIncoming((prev) => prev.filter((entry) => entry.id !== request.id))
      pushToast(action === 'accept' ? 'Connection request accepted.' : 'Connection request dismissed.', action === 'accept' ? 'success' : 'info')
    } catch {
      pushToast(`Unable to ${action === 'accept' ? 'accept' : 'dismiss'} request.`, 'error')
    } finally {
      setPendingAction(null)
    }
  }, [])

  return (
    <DashboardShell rightRail={<RightRail mode="network" />} mainClassName="space-y-6">
      <section className="surface-card px-6 py-5 shadow-subtle">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Network</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Pending Connect Requests</h1>
      </section>

      <section className="surface-card px-6 py-5 shadow-subtle">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Incoming</h2>
          <Link href="/network/professionals" className="text-xs font-semibold text-[var(--cc-primary)] hover:underline">
            Back to professionals
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading requests…</p>
        ) : incoming.length ? (
          <ul className="space-y-3">
            {incoming.map((request) => {
              const displayName = request.user.name || request.user.handle
              const isAccepting = pendingAction?.id === request.id && pendingAction.action === 'accept'
              const isRejecting = pendingAction?.id === request.id && pendingAction.action === 'reject'
              const isActing = pendingAction?.id === request.id
              return (
                <li key={request.id}>
                  <CivilCard
                    size="md"
                    name={displayName}
                    avatarAlt={displayName}
                    avatarInitials={displayName}
                    avatarSrc={request.user.avatarUrl}
                    avatarHref={`/u/${request.user.handle}`}
                    titleHref={`/u/${request.user.handle}`}
                    coverUrl={request.user.coverUrl ?? null}
                    isVerified={request.user.isVerified}
                    isBusiness={request.user.isPremium}
                    align="start"
                    details={
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void handleAction(request, 'accept')}
                          disabled={isActing}
                        >
                          {isAccepting ? 'Accepting…' : 'Accept'}
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-full border border-white/40 bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void handleAction(request, 'reject')}
                          disabled={isActing}
                        >
                          {isRejecting ? 'Declining…' : 'Decline'}
                        </button>
                      </div>
                    }
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No pending connect requests.</p>
        )}
      </section>

      {outgoing.length ? (
        <section className="surface-card px-6 py-5 shadow-subtle">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Outgoing</h2>
          <ul className="space-y-3">
            {outgoing.map((request) => {
              const displayName = request.user.name || request.user.handle
              return (
                <li key={request.id}>
                  <CivilCard
                    href={`/u/${request.user.handle}`}
                    size="md"
                    name={displayName}
                    avatarAlt={displayName}
                    avatarInitials={displayName}
                    avatarSrc={request.user.avatarUrl}
                    coverUrl={request.user.coverUrl ?? null}
                    isVerified={request.user.isVerified}
                    isBusiness={request.user.isPremium}
                    trailing={
                      <span className="shrink-0 rounded-full border border-white/35 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">
                        Pending
                      </span>
                    }
                  />
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </DashboardShell>
  )
}
