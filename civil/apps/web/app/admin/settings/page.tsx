"use client"

import { useEffect, useMemo, useState } from 'react'
import DashboardShell from '../../_components/DashboardShell'
import { buildApiUrl } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { clearAuthSession } from '../../_lib/authSession'
import type { ReactNode } from 'react'
import { useAdminAccess } from '../_hooks/useAdminAccess'

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

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export default function AdminSettingsPage() {
  const { token, loading: accessLoading, error: accessError, isSuperAdmin } = useAdminAccess()
  const [diagnostics, setDiagnostics] = useState<AdminEnvResponse | null>(null)
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuperAdmin || !token) return
    let cancelled = false

    const loadEnv = async () => {
      setStatus('loading')
      setError(null)
      try {
        const res = await fetch(buildApiUrl('/admin/env'), {
          headers: { authorization: `Bearer ${token}` },
        })
        if (res.status === 401) {
          clearAuthSession()
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
          setError('Unable to load diagnostics. Try refreshing the page.')
          return
        }
        const payload = (await res.json()) as AdminEnvResponse
        if (!cancelled) {
          setDiagnostics(payload)
          setStatus('ready')
        }
      } catch (err) {
        console.error('[admin/settings] Failed to load diagnostics', err)
        if (!cancelled) {
          setStatus('error')
          setError('Unexpected error while loading environment data.')
        }
      }
    }

    void loadEnv()
    return () => {
      cancelled = true
    }
  }, [isSuperAdmin, token])

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

  const rightRail = useMemo<ReactNode>(() => {
    if (!token) return null
    return (
      <div className="space-y-4 text-sm text-slate-600">
        <section className="surface-card space-y-2 px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Quick tools</h2>
          <ul className="space-y-2">
            <li>Confirm Stripe keys before enabling checkout.</li>
            <li>Restart the API container after editing env files.</li>
          </ul>
        </section>
        <section className="surface-card space-y-2 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Bearer token</p>
          <p className="font-mono text-xs text-slate-900">{token.slice(0, 12)}…</p>
        </section>
      </div>
    )
  }, [token])

  const renderMain = () => {
    if (accessLoading) {
      return <div className="surface-card p-6 text-sm text-slate-500">Loading environment diagnostics…</div>
    }
    if (!isSuperAdmin) {
      return (
        <div className="surface-card border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          {accessError ?? 'Admin access is limited to root operators.'}
        </div>
      )
    }
    if (status === 'loading' || status === 'idle') {
      return <div className="surface-card p-6 text-sm text-slate-500">Loading environment diagnostics…</div>
    }
    if (status === 'error') {
      return <div className="surface-card border border-rose-200 bg-rose-50 p-6 text-sm text-rose-600">{error}</div>
    }
    if (!diagnostics) return null

    return (
      <>
        <section className="surface-card space-y-4 px-6 py-5 shadow-subtle">
          <header className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Environment</p>
            <h1 className="text-xl font-semibold text-slate-900">{diagnostics.env.label || 'Unknown environment'}</h1>
            <p className="text-sm text-slate-600">
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

        <section className="surface-card space-y-6 px-6 py-5 shadow-subtle">
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
    )
  }

  return (
    <DashboardShell
      className="bg-slate-50"
      rightRail={rightRail}
      mainClassName="space-y-6"
    >
      {renderMain()}
    </DashboardShell>
  )
}
