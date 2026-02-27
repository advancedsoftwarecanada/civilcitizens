'use client'

import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { useAdminAccess } from '../_hooks/useAdminAccess'

type GeodataDataset = {
  key: string
  label: string
  count: number
  lastUpdatedAt: string | null
}

type AdminGeodataResponse = {
  generatedAt: string
  datasets: GeodataDataset[]
}

type Status = 'idle' | 'loading' | 'ready' | 'error'

export default function AdminGeodataPage() {
  const { token, loading: accessLoading, error: accessError, isSuperAdmin } = useAdminAccess()
  const [payload, setPayload] = useState<AdminGeodataResponse | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  const numberFormatter = useMemo(() => new Intl.NumberFormat('en-CA'), [])

  useEffect(() => {
    if (!isSuperAdmin || !token) return
    let cancelled = false

    const loadGeodata = async () => {
      setStatus('loading')
      setError(null)
      try {
        const res = await fetch(buildApiUrl('/admin/geodata'), {
          headers: { authorization: `Bearer ${token}` },
        })
        if (res.status === 401) {
          window.localStorage.removeItem('token')
          redirectToAuthModal('login')
          return
        }
        if (res.status === 403) {
          setStatus('error')
          setError('Admin access denied for this account.')
          return
        }
        if (!res.ok) {
          setStatus('error')
          setError('Unable to load GeoData summary. Re-run the API stack or try again shortly.')
          return
        }
        const data = (await res.json()) as AdminGeodataResponse
        if (!cancelled) {
          setPayload(data)
          setStatus('ready')
        }
      } catch (err) {
        console.error('[admin/geodata] Failed to load summary', err)
        if (!cancelled) {
          setStatus('error')
          setError('Unexpected error while loading GeoData summary.')
        }
      }
    }

    void loadGeodata()
    return () => {
      cancelled = true
    }
  }, [isSuperAdmin, token])

  const datasets = payload?.datasets ?? []
  const generatedAt = payload?.generatedAt ? new Date(payload.generatedAt).toLocaleString() : null

  const renderMain = () => {
    if (accessLoading) {
      return <div className="surface-card p-6 text-sm text-slate-500">Loading GeoData coverage…</div>
    }
    if (!isSuperAdmin) {
      return (
        <div className="surface-card border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          {accessError ?? 'Admin access is limited to root operators.'}
        </div>
      )
    }
    if (status === 'loading' || status === 'idle') {
      return <div className="surface-card p-6 text-sm text-slate-500">Loading GeoData coverage…</div>
    }
    if (status === 'error') {
      return <div className="surface-card border border-rose-200 bg-rose-50 p-6 text-sm text-rose-600">{error}</div>
    }
    if (!payload) return null

    return (
      <>
        <section className="surface-card space-y-3 px-6 py-5 shadow-subtle">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">GeoData</p>
          <h1 className="text-2xl font-semibold text-slate-900">Coverage snapshot</h1>
          <p className="text-sm text-slate-600">
            Monitor import counts for StatsCan and Elections Canada datasets that power postal lookups and feed targeting.
          </p>
          {generatedAt ? <p className="text-xs text-slate-400">Snapshot generated at {generatedAt}</p> : null}
        </section>

        {datasets.length ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {datasets.map((dataset) => (
              <article key={dataset.key} className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-subtle">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{dataset.label}</p>
                <p className="mt-2 text-3xl font-semibold text-slate-900">{numberFormatter.format(dataset.count)}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {dataset.lastUpdatedAt ? `Updated ${new Date(dataset.lastUpdatedAt).toLocaleString()}` : 'Awaiting latest import'}
                </p>
              </article>
            ))}
          </section>
        ) : (
          <section className="surface-card border border-dashed border-slate-200 bg-slate-50 px-6 py-5 text-sm text-slate-600">
            No GeoData counts found. Run <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700">pnpm tsx apps/api/scripts/seed-admin-areas.ts</code> and redeploy the API to refresh this report.
          </section>
        )}

      </>
    )
  }

  return (
    <DashboardShell
      className="bg-slate-50"
      mainClassName="space-y-6"
    >
      {renderMain()}
    </DashboardShell>
  )
}
