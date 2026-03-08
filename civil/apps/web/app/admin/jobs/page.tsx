"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminWideShell from '../_components/AdminWideShell'
import { buildApiUrl } from '../../_lib/api'
import { useAdminAccess } from '../_hooks/useAdminAccess'

type AdminSubIndustry = {
  id: string
  industryId: string
  name: string
  slug: string
  description: string | null
  sortOrder: number
  active: boolean
}

type AdminIndustry = {
  id: string
  name: string
  slug: string
  description: string | null
  sortOrder: number
  active: boolean
  subIndustries: AdminSubIndustry[]
}

type TaxonomyResponse = {
  items: AdminIndustry[]
}

export default function AdminJobsPage() {
  const { token, loading: accessLoading, error: accessError, isSuperAdmin } = useAdminAccess()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [seedBusy, setSeedBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [items, setItems] = useState<AdminIndustry[]>([])

  const [newIndustry, setNewIndustry] = useState({
    name: '',
    slug: '',
    active: true,
  })
  const [dragIndustryId, setDragIndustryId] = useState<string | null>(null)
  const [dragSubIndustry, setDragSubIndustry] = useState<{ industryId: string; subIndustryId: string } | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch(buildApiUrl('/admin/jobs/taxonomy'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        setMessage('Unable to load jobs taxonomy.')
        setItems([])
        return
      }
      const payload = (await res.json().catch(() => null)) as TaxonomyResponse | null
      setItems(Array.isArray(payload?.items) ? payload.items : [])
    } catch {
      setMessage('Unable to load jobs taxonomy.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!isSuperAdmin || !token) return
    void load()
  }, [isSuperAdmin, load, token])

  const saveIndustry = useCallback(
    async (industry: AdminIndustry) => {
      if (!token) return
      setSaving(true)
      setMessage(null)
      try {
        const res = await fetch(buildApiUrl(`/admin/jobs/industries/${encodeURIComponent(industry.id)}`), {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: industry.name,
            slug: industry.slug,
            description: industry.description,
            sortOrder: industry.sortOrder,
            active: industry.active,
          }),
        })
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null
          setMessage(payload?.error ?? 'Unable to save industry.')
          return
        }
        setMessage('Industry saved.')
        await load()
      } catch {
        setMessage('Unable to save industry.')
      } finally {
        setSaving(false)
      }
    },
    [load, token],
  )

  const saveSubIndustry = useCallback(
    async (subIndustry: AdminSubIndustry) => {
      if (!token) return
      setSaving(true)
      setMessage(null)
      try {
        const res = await fetch(buildApiUrl(`/admin/jobs/sub-industries/${encodeURIComponent(subIndustry.id)}`), {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: subIndustry.name,
            slug: subIndustry.slug,
            description: subIndustry.description,
            sortOrder: subIndustry.sortOrder,
            active: subIndustry.active,
          }),
        })
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null
          setMessage(payload?.error ?? 'Unable to save sub-industry.')
          return
        }
        setMessage('Sub-industry saved.')
        await load()
      } catch {
        setMessage('Unable to save sub-industry.')
      } finally {
        setSaving(false)
      }
    },
    [load, token],
  )

  const createIndustry = useCallback(async () => {
    if (!token) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(buildApiUrl('/admin/jobs/industries'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: newIndustry.name,
          slug: newIndustry.slug,
          description: null,
          sortOrder: items.length,
          active: newIndustry.active,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        setMessage(payload?.error ?? 'Unable to create industry.')
        return
      }
      setMessage('Industry created.')
      setNewIndustry({ name: '', slug: '', active: true })
      await load()
    } catch {
      setMessage('Unable to create industry.')
    } finally {
      setSaving(false)
    }
  }, [items.length, load, newIndustry, token])

  const createSubIndustry = useCallback(
    async (industry: AdminIndustry) => {
      if (!token) return
      const name = window.prompt(`Add sub-industry under ${industry.name}: name`)
      if (!name || !name.trim()) return
      const slug = window.prompt('Slug (e.g. software-development)')
      if (!slug || !slug.trim()) return

      setSaving(true)
      setMessage(null)
      try {
        const res = await fetch(buildApiUrl('/admin/jobs/sub-industries'), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            industryId: industry.id,
            name: name.trim(),
            slug: slug.trim().toLowerCase(),
            description: null,
            sortOrder: industry.subIndustries.length,
            active: true,
          }),
        })
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null
          setMessage(payload?.error ?? 'Unable to create sub-industry.')
          return
        }
        setMessage('Sub-industry created.')
        await load()
      } catch {
        setMessage('Unable to create sub-industry.')
      } finally {
        setSaving(false)
      }
    },
    [load, token],
  )

  const persistIndustryOrder = useCallback(
    async (ordered: AdminIndustry[]) => {
      if (!token) return
      setSaving(true)
      setMessage(null)
      try {
        await Promise.all(
          ordered.map((industry, index) =>
            fetch(buildApiUrl(`/admin/jobs/industries/${encodeURIComponent(industry.id)}`), {
              method: 'PUT',
              headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                name: industry.name,
                slug: industry.slug,
                description: industry.description,
                sortOrder: index,
                active: industry.active,
              }),
            }),
          ),
        )
        setMessage('Industry order updated.')
        await load()
      } catch {
        setMessage('Unable to update industry order.')
      } finally {
        setSaving(false)
      }
    },
    [load, token],
  )

  const persistSubIndustryOrder = useCallback(
    async (industry: AdminIndustry) => {
      if (!token) return
      setSaving(true)
      setMessage(null)
      try {
        await Promise.all(
          industry.subIndustries.map((subIndustry, index) =>
            fetch(buildApiUrl(`/admin/jobs/sub-industries/${encodeURIComponent(subIndustry.id)}`), {
              method: 'PUT',
              headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                name: subIndustry.name,
                slug: subIndustry.slug,
                description: subIndustry.description,
                sortOrder: index,
                active: subIndustry.active,
              }),
            }),
          ),
        )
        setMessage('Sub-industry order updated.')
        await load()
      } catch {
        setMessage('Unable to update sub-industry order.')
      } finally {
        setSaving(false)
      }
    },
    [load, token],
  )

  const seed = useCallback(async () => {
    if (!token) return
    setSeedBusy(true)
    setMessage(null)
    try {
      const res = await fetch(buildApiUrl('/admin/jobs/seed'), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const payload = (await res.json().catch(() => null)) as { industriesInserted?: number; subIndustriesInserted?: number; error?: string } | null
      if (!res.ok) {
        setMessage(payload?.error ?? 'Unable to seed taxonomy.')
        return
      }
      setMessage(`Seed complete. Added ${payload?.industriesInserted ?? 0} industries and ${payload?.subIndustriesInserted ?? 0} sub-industries.`)
      await load()
    } catch {
      setMessage('Unable to seed taxonomy.')
    } finally {
      setSeedBusy(false)
    }
  }, [load, token])

  const main = useMemo(() => {
    if (accessLoading) return <div className="surface-card p-6 text-sm text-slate-500">Authorizing admin tools…</div>
    if (!isSuperAdmin) {
      return <div className="surface-card border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">{accessError ?? 'Admin access is limited to root operators.'}</div>
    }

    return (
      <div className="space-y-6">
        <section className="surface-card space-y-3 px-6 py-5 shadow-subtle">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Admin</p>
          <h1 className="text-2xl font-semibold text-slate-900">Jobs taxonomy</h1>
          <p className="text-sm text-slate-600">Database-driven manager for industries and sub-industries.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void seed()}
              disabled={seedBusy || saving}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {seedBusy ? 'Populating…' : 'Populate seed'}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || saving || seedBusy}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Refresh
            </button>
          </div>
          {message ? <p className="text-xs text-slate-600">{message}</p> : null}
        </section>

        <section className="surface-card space-y-3 px-6 py-5 shadow-subtle">
          <h2 className="text-lg font-semibold text-slate-900">Create industry</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-semibold text-slate-700">Name<input value={newIndustry.name} onChange={(e) => setNewIndustry((prev) => ({ ...prev, name: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
            <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-semibold text-slate-700">Slug<input value={newIndustry.slug} onChange={(e) => setNewIndustry((prev) => ({ ...prev, slug: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={newIndustry.active} onChange={(e) => setNewIndustry((prev) => ({ ...prev, active: e.target.checked }))} /> Active</label>
            <button type="button" onClick={() => void createIndustry()} disabled={saving || seedBusy} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">Create industry</button>
          </div>
        </section>

        <section className="surface-card space-y-3 px-6 py-5 shadow-subtle">
          <h2 className="text-lg font-semibold text-slate-900">Industries</h2>
          {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
          <div className="space-y-4">
            {items.map((industry) => (
              <div
                key={industry.id}
                className="rounded-2xl border border-slate-200 p-4"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!dragIndustryId || dragIndustryId === industry.id) return
                  const next = [...items]
                  const from = next.findIndex((entry) => entry.id === dragIndustryId)
                  const to = next.findIndex((entry) => entry.id === industry.id)
                  if (from < 0 || to < 0) return
                  const [moved] = next.splice(from, 1)
                  if (!moved) return
                  next.splice(to, 0, moved)
                  const reordered = next.map((entry, index) => ({ ...entry, sortOrder: index }))
                  setItems(reordered)
                  setDragIndustryId(null)
                  void persistIndustryOrder(reordered)
                }}
              >
                <div className="flex flex-wrap items-end gap-3">
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDragIndustryId(industry.id)}
                    onDragEnd={() => setDragIndustryId(null)}
                    className="cursor-grab rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                    aria-label="Drag to reorder industry"
                    title="Drag to reorder"
                  >
                    ↕
                  </button>
                  <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-semibold text-slate-700">Name<input value={industry.name} onChange={(e) => setItems((prev) => prev.map((item) => item.id === industry.id ? { ...item, name: e.target.value } : item))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                  <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-semibold text-slate-700">Slug<input value={industry.slug} onChange={(e) => setItems((prev) => prev.map((item) => item.id === industry.id ? { ...item, slug: e.target.value } : item))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={industry.active} onChange={(e) => setItems((prev) => prev.map((item) => item.id === industry.id ? { ...item, active: e.target.checked } : item))} /> Active</label>
                  <button type="button" onClick={() => void saveIndustry(industry)} disabled={saving || seedBusy} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Save industry</button>
                  <button type="button" onClick={() => void createSubIndustry(industry)} disabled={saving || seedBusy} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Add sub-industry</button>
                </div>

                {industry.subIndustries.length ? (
                  <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    {industry.subIndustries.map((subIndustry) => (
                      <div
                        key={subIndustry.id}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (!dragSubIndustry || dragSubIndustry.industryId !== industry.id || dragSubIndustry.subIndustryId === subIndustry.id) return
                          const updatedIndustry = items.find((item) => item.id === industry.id)
                          if (!updatedIndustry) return
                          const nextSubs = [...updatedIndustry.subIndustries]
                          const from = nextSubs.findIndex((entry) => entry.id === dragSubIndustry.subIndustryId)
                          const to = nextSubs.findIndex((entry) => entry.id === subIndustry.id)
                          if (from < 0 || to < 0) return
                          const [moved] = nextSubs.splice(from, 1)
                          if (!moved) return
                          nextSubs.splice(to, 0, moved)
                          const reorderedSubs = nextSubs.map((entry, index) => ({ ...entry, sortOrder: index }))
                          const nextItems = items.map((item) => item.id !== industry.id ? item : { ...item, subIndustries: reorderedSubs })
                          setItems(nextItems)
                          setDragSubIndustry(null)
                          void persistSubIndustryOrder({ ...updatedIndustry, subIndustries: reorderedSubs })
                        }}
                      >
                        <div className="flex flex-wrap items-end gap-3">
                          <button
                            type="button"
                            draggable
                            onDragStart={() => setDragSubIndustry({ industryId: industry.id, subIndustryId: subIndustry.id })}
                            onDragEnd={() => setDragSubIndustry(null)}
                            className="cursor-grab rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                            aria-label="Drag to reorder sub-industry"
                            title="Drag to reorder"
                          >
                            ↕
                          </button>
                          <label className="grid min-w-[200px] flex-1 gap-1 text-xs font-semibold text-slate-700">Name<input value={subIndustry.name} onChange={(e) => setItems((prev) => prev.map((item) => item.id !== industry.id ? item : { ...item, subIndustries: item.subIndustries.map((sub) => sub.id === subIndustry.id ? { ...sub, name: e.target.value } : sub) }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                          <label className="grid min-w-[200px] flex-1 gap-1 text-xs font-semibold text-slate-700">Slug<input value={subIndustry.slug} onChange={(e) => setItems((prev) => prev.map((item) => item.id !== industry.id ? item : { ...item, subIndustries: item.subIndustries.map((sub) => sub.id === subIndustry.id ? { ...sub, slug: e.target.value } : sub) }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={subIndustry.active} onChange={(e) => setItems((prev) => prev.map((item) => item.id !== industry.id ? item : { ...item, subIndustries: item.subIndustries.map((sub) => sub.id === subIndustry.id ? { ...sub, active: e.target.checked } : sub) }))} /> Active</label>
                          <button type="button" onClick={() => void saveSubIndustry(subIndustry)} disabled={saving || seedBusy} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Save sub-industry</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    )
  }, [
    accessError,
    accessLoading,
    createIndustry,
    createSubIndustry,
    dragIndustryId,
    dragSubIndustry,
    isSuperAdmin,
    items,
    load,
    loading,
    message,
    newIndustry.active,
    newIndustry.name,
    newIndustry.slug,
    persistIndustryOrder,
    persistSubIndustryOrder,
    saveIndustry,
    saveSubIndustry,
    saving,
    seed,
    seedBusy,
  ])

  return (
    <AdminWideShell className="bg-slate-50" mainClassName="space-y-6">
      {main}
    </AdminWideShell>
  )
}
