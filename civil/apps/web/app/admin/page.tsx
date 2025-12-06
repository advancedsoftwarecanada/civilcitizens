"use client"

import { useEffect, useMemo, useState } from 'react'
import Sidebar from '../_components/Sidebar'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { hasHomeCommunity, type MeResponse } from '../_lib/me'
import { isSuperAdmin } from '../_lib/admin'

type EnvChecklistItem = {
  key: string
  label: string
  optional: boolean
  hint?: string
  present: boolean
}

type EnvChecklistGroup = {
  id: string
  title: string
  description?: string
  items: EnvChecklistItem[]
}

type AdminEnvResponse = {
  env: {
    label: string | null
    primarySource: string | null
    sources: string[]
    nodeEnv: string | null
    projectName: string | null
  }
  stripeEnabled: boolean
  checklist: EnvChecklistGroup[]
  generatedAt: string
}

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

export default function AdminPage() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<AdminEnvResponse | null>(null)
  const [geodata, setGeodata] = useState<AdminGeodataResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [geodataStatus, setGeodataStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')

  const numberFormatter = useMemo(() => new Intl.NumberFormat('en-CA'), [])

  useEffect(() => {
    const storedToken = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!storedToken) {
      redirectToAuthModal('login')
      return
    }
    setToken(storedToken)

    const bootstrap = async () => {
      try {
        const meResponse = await fetch(buildApiUrl('/auth/me'), {
          headers: { authorization: `Bearer ${storedToken}` },
        })
        if (!meResponse.ok) {
          window.localStorage.removeItem('token')
          redirectToAuthModal('login')
          return
        }
        const data: MeResponse = await meResponse.json()
        if (!hasHomeCommunity(data)) {
          window.location.replace('/welcome')
          return
        }
        setMe(data)
        if (!isSuperAdmin(data)) {
          setError('Admin access is limited to root operators.')
          return
        }
        const envResponse = await fetch(buildApiUrl('/admin/env'), {
          headers: { authorization: `Bearer ${storedToken}` },
        })
        if (envResponse.status === 401) {
          window.localStorage.removeItem('token')
          redirectToAuthModal('login')
          return
        }
        if (envResponse.status === 403) {
          setError('Admin access denied for this account.')
          return
        }
        if (!envResponse.ok) {
          setError('Unable to load diagnostics. Try refreshing the page.')
          return
        }
        const payload = (await envResponse.json()) as AdminEnvResponse
        setDiagnostics(payload)

        setGeodataStatus('loading')
        try {
          const geoResponse = await fetch(buildApiUrl('/admin/geodata'), {
            headers: { authorization: `Bearer ${storedToken}` },
          })
          if (geoResponse.ok) {
            const geoPayload = (await geoResponse.json()) as AdminGeodataResponse
            setGeodata(geoPayload)
            setGeodataStatus('ready')
          } else {
            setGeodataStatus('error')
          }
        } catch (geoError) {
          console.error('[admin] Failed to load geodata summary', geoError)
          setGeodataStatus('error')
        }
      } catch (err) {
        console.error('[admin] Failed to load diagnostics', err)
        setError('Unexpected error while loading admin data.')
      } finally {
        setLoading(false)
      }
    }

    void bootstrap()
  }, [])

  const missingKeys = useMemo(() => {
    if (!diagnostics) return []
    const items: EnvChecklistItem[] = []
    for (const group of diagnostics.checklist) {
      for (const item of group.items) {
        if (!item.present && !item.optional) {
          items.push(item)
        }
      }
    }
    return items
  }, [diagnostics])

  const datasets = geodata?.datasets ?? []
  const geodataGeneratedAt = geodata?.generatedAt ? new Date(geodata.generatedAt).toLocaleString() : null

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-screen-lg px-4">
          <Sidebar me={me ?? undefined} active="admin" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-8 lg:pr-0 xl:pl-12 xl:pr-0">
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_360px] xl:gap-10">
          <Sidebar me={me ?? undefined} active="admin" />

          <main className="space-y-6 pt-8">
            {!token || loading ? (
              <div className="surface-card p-6 text-sm text-slate-500">Loading diagnostics…</div>
            ) : error ? (
              <div className="surface-card border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">{error}</div>
            ) : diagnostics ? (
              <>
                <section className="surface-card space-y-5 p-6">
                  <header className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Custom reports</p>
                    <h1 className="text-xl font-semibold text-slate-900">GeoData coverage</h1>
                    <p className="text-sm text-slate-500">
                      Monitor the StatsCan + Elections Canada import counts that power community feeds and postal lookups.
                    </p>
                  </header>
                  {geodataStatus === 'error' ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                      Unable to load GeoData summary right now. Re-run the API stack or try again shortly.
                    </div>
                  ) : geodataStatus === 'loading' || geodataStatus === 'idle' ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Loading GeoData summary…</div>
                  ) : datasets.length ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {datasets.map((dataset) => (
                        <article key={dataset.key} className="rounded-2xl border border-slate-200 p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{dataset.label}</p>
                          <p className="mt-2 text-3xl font-semibold text-slate-900">{numberFormatter.format(dataset.count)}</p>
                          <p className="mt-2 text-xs text-slate-500">
                            {dataset.lastUpdatedAt ? `Updated ${new Date(dataset.lastUpdatedAt).toLocaleString()}` : 'Awaiting latest import'}
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      No GeoData counts found. Run <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700">pnpm tsx apps/api/scripts/seed-admin-areas.ts</code> and redeploy the API to refresh this report.
                    </div>
                  )}
                  {geodataGeneratedAt ? (
                    <p className="text-xs text-slate-400">Snapshot generated at {geodataGeneratedAt}</p>
                  ) : null}
                </section>

                <section className="surface-card space-y-4 p-6">
                  <header className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Environment</p>
                    <h1 className="text-xl font-semibold text-slate-900">{diagnostics.env.label || 'Unknown env'}</h1>
                    <p className="text-sm text-slate-500">
                      Stripe is {diagnostics.stripeEnabled ? 'enabled' : 'disabled'} • NODE_ENV = {diagnostics.env.nodeEnv || 'n/a'}
                    </p>
                  </header>
                  <dl className="grid gap-4 text-sm text-slate-600 md:grid-cols-2">
                    <div>
                      <dt className="font-semibold text-slate-500">Primary env file</dt>
                      <dd className="font-mono text-sm text-slate-800">{diagnostics.env.primarySource || 'n/a'}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Compose project</dt>
                      <dd className="font-mono text-sm text-slate-800">{diagnostics.env.projectName || 'n/a'}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Loaded env files</dt>
                      <dd className="font-mono text-xs text-slate-800">
                        {diagnostics.env.sources.length ? diagnostics.env.sources.join(', ') : 'n/a'}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Generated at</dt>
                      <dd className="font-mono text-xs text-slate-800">{new Date(diagnostics.generatedAt).toLocaleString()}</dd>
                    </div>
                  </dl>
                  {missingKeys.length ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                      <p className="font-semibold">Missing required keys</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                        {missingKeys.map((item) => (
                          <li key={item.key}>
                            {item.label} <span className="font-mono text-[11px] text-rose-600">({item.key})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>

                <section className="surface-card space-y-6 p-6">
                  <header>
                    <h2 className="text-lg font-semibold text-slate-900">Env checklist</h2>
                    <p className="text-sm text-slate-500">Each item reflects whether the variable is present at runtime.</p>
                  </header>
                  <div className="space-y-4">
                    {diagnostics.checklist.map((group) => (
                      <div key={group.id} className="rounded-2xl border border-slate-200 p-4">
                        <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
                        {group.description ? <p className="text-xs text-slate-500">{group.description}</p> : null}
                        <ul className="mt-4 space-y-2">
                          {group.items.map((item) => (
                            <li key={item.key} className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2">
                              <input
                                type="checkbox"
                                checked={item.present}
                                readOnly
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              <div className="text-xs">
                                <p className="font-semibold text-slate-800">
                                  {item.label}
                                  <span className="ml-1 font-mono text-[11px] text-slate-400">({item.key})</span>
                                  {item.optional ? <span className="ml-1 text-slate-400">(optional)</span> : null}
                                </p>
                                <p className={`mt-1 ${item.present ? 'text-slate-500' : 'text-rose-600'}`}>
                                  {item.present ? 'Detected' : 'Missing'}
                                </p>
                                {item.hint ? <p className="mt-1 text-slate-400">{item.hint}</p> : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </main>

          <aside className="hidden space-y-4 pt-8 lg:block">
            <section className="surface-card space-y-2 px-5 py-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Quick tools</h2>
              <ul className="space-y-2 text-sm text-slate-600">
                <li>Use this panel to confirm Stripe keys before enabling checkout.</li>
                <li>Restart the API container after editing env files so values refresh.</li>
              </ul>
            </section>
            {token ? (
              <section className="surface-card space-y-2 px-5 py-4 text-sm text-slate-600">
                <p>Bearer token (first 12 chars):</p>
                <p className="font-mono text-xs text-slate-900">{token.slice(0, 12)}…</p>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  )
}
