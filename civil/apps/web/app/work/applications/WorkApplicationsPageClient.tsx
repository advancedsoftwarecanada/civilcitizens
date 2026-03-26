'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import CivilCard from '../../_components/CivilCard'
import DashboardShell from '../../_components/DashboardShell'
import { RightRail } from '../../_components/RightRail'
import { buildApiUrl } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'

type WorkApplicationItem = {
  id: string
  status: string
  createdAt: string
  job: {
    id: string
    title: string
    photoUrl: string | null
    status: string
    organization: {
      name: string
      slug: string
      provinceCode: string | null
      communitySlug: string | null
      logoUrl: string | null
      coverUrl: string | null
    }
  }
}

function toStatusLabel(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase()
}

function getJobHref(item: WorkApplicationItem): string | null {
  const org = item.job.organization
  if (!org.provinceCode || !org.communitySlug) return null
  return `/com/${encodeURIComponent(org.provinceCode.toLowerCase())}/${encodeURIComponent(org.communitySlug.toLowerCase())}/orgs/${encodeURIComponent(org.slug)}/jobs/${encodeURIComponent(item.job.id)}`
}

export default function WorkApplicationsPageClient() {
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(true)
  const [items, setItems] = useState<WorkApplicationItem[]>([])

  const loadApplications = useCallback(async () => {
    setLoading(true)
    const token = getStoredToken()
    if (!token) {
      setAuthorized(false)
      setItems([])
      setLoading(false)
      return
    }

    setAuthorized(true)
    try {
      const res = await fetch(buildApiUrl('/work/applications?limit=100'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        if (res.status === 401) setAuthorized(false)
        setItems([])
        return
      }
      const payload = (await res.json().catch(() => null)) as { items?: WorkApplicationItem[] } | null
      setItems(Array.isArray(payload?.items) ? payload.items : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadApplications()
  }, [loadApplications])

  return (
    <DashboardShell rightRail={<RightRail mode="work" organizationLinkTarget="chat" />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Your Applications</h1>
            <p className="mt-1 text-sm text-slate-600">Track jobs you've applied for through Civil.</p>
          </div>
          <Link href="/work" className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700">
            Back to Work
          </Link>
        </div>

        {loading ? <p className="mt-4 text-sm text-slate-500">Loading applications…</p> : null}

        {!loading && !authorized ? (
          <p className="mt-4 text-sm text-slate-600">Sign in to view your submitted applications.</p>
        ) : null}

        {!loading && authorized && items.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No applications submitted yet.</p>
        ) : null}

        {!loading && authorized && items.length ? (
          <ul className="mt-4 space-y-3">
            {items.map((item) => {
              const jobHref = getJobHref(item)
              const org = item.job.organization

              return (
                <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div className="w-full sm:w-60 sm:flex-none">
                      {jobHref ? (
                        <Link href={jobHref} className="block">
                          <div className="relative h-32 w-full overflow-hidden rounded-xl bg-slate-100">
                            {item.job.photoUrl ? <img src={item.job.photoUrl} alt={item.job.title} className="h-full w-full object-cover" loading="lazy" /> : null}
                          </div>
                        </Link>
                      ) : (
                        <div className="relative h-32 w-full overflow-hidden rounded-xl bg-slate-100">
                          {item.job.photoUrl ? <img src={item.job.photoUrl} alt={item.job.title} className="h-full w-full object-cover" loading="lazy" /> : null}
                        </div>
                      )}

                      {jobHref ? (
                        <Link href={jobHref} className="mt-3 block">
                          <CivilCard
                            size="rail"
                            name={org.name}
                            avatarAlt={org.name}
                            avatarInitials={org.name}
                            avatarSrc={org.logoUrl}
                            coverUrl={org.coverUrl}
                            isBusiness
                          />
                        </Link>
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      {jobHref ? (
                        <Link href={jobHref} className="text-xl font-semibold tracking-tight text-slate-900 transition hover:text-[var(--cc-primary)] hover:underline">
                          {item.job.title}
                        </Link>
                      ) : (
                        <h3 className="text-xl font-semibold tracking-tight text-slate-900">{item.job.title}</h3>
                      )}

                      <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{toStatusLabel(item.status)}</span>
                        <span className="rounded-full border border-slate-200 px-2 py-0.5">Submitted {new Date(item.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>
    </DashboardShell>
  )
}
