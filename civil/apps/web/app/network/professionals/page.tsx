'use client'

import { useEffect, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { RightRail } from '../../_components/RightRail'
import { buildApiUrl } from '../../_lib/api'
import CivilCard from '../../_components/CivilCard'

type Professional = {
  id: string
  status: string
  since: string | null
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
    coverUrl?: string | null
    isPremium: boolean
    isVerified: boolean
  }
}

export default function NetworkProfessionalsPage() {
  const [items, setItems] = useState<Professional[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      if (!token) {
        setItems([])
        setLoading(false)
        return
      }
      try {
        const res = await fetch(buildApiUrl('/connections'), {
          headers: { authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          setItems([])
          return
        }
        const payload = (await res.json().catch(() => null)) as { items?: Professional[] } | null
        if (!cancelled) {
          setItems(Array.isArray(payload?.items) ? payload.items : [])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <DashboardShell rightRail={<RightRail mode="network" />} mainClassName="space-y-6">
      <section className="surface-card px-6 py-5 shadow-subtle">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Network</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Professional Connections</h1>
      </section>

      <section className="surface-card px-6 py-5 shadow-subtle">
        {loading ? (
          <p className="text-sm text-slate-500">Loading professionals…</p>
        ) : items.length ? (
          <ul className="space-y-3">
            {items.map((entry) => {
              const displayName = entry.user.name || entry.user.handle
              return (
                <li key={entry.id}>
                  <CivilCard
                    href={`/u/${entry.user.handle}`}
                    size="md"
                    name={displayName}
                    avatarAlt={displayName}
                    avatarInitials={displayName}
                    avatarSrc={entry.user.avatarUrl}
                    coverUrl={entry.user.coverUrl ?? null}
                    isVerified={entry.user.isVerified}
                    isBusiness={entry.user.isPremium}
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No professional connections yet.</p>
        )}
      </section>
    </DashboardShell>
  )
}
