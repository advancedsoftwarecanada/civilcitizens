'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { buildApiUrl } from '../../../../_lib/api'

type JobItem = {
  id: string
  title: string
  employmentType: string
  location: string
  applicantCount: number
  industry: {
    name: string
  }
  organization: {
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
  }
}

function parseLocationLabel(value: string): string {
  if (value === 'special:remote') return 'Remote'
  if (value === 'special:not_in_canada') return 'Not in Canada'
  if (value.startsWith('community:')) {
    const body = value.slice('community:'.length)
    const [, labelPart] = body.split('|')
    return (labelPart ?? '').trim() || 'Community'
  }
  return 'Location not set'
}

export default function CommunityJobsPageClient({ province, municipality }: { province: string; municipality: string }) {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<JobItem[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ provinceCode: province.toUpperCase(), communitySlug: municipality.toLowerCase(), limit: '50' })
      const res = await fetch(buildApiUrl(`/work/jobs?${params.toString()}`), { cache: 'no-store' })
      if (!res.ok) {
        setItems([])
        return
      }
      const payload = (await res.json().catch(() => null)) as { sponsored?: JobItem[]; items?: JobItem[] } | null
      const sponsored = Array.isArray(payload?.sponsored) ? payload.sponsored : []
      const regular = Array.isArray(payload?.items) ? payload.items : []
      setItems([...sponsored, ...regular])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [municipality, province])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      {loading ? <p className="text-sm text-slate-500">Loading jobs…</p> : null}
      {!loading && items.length === 0 ? <p className="text-sm text-slate-500">No jobs posted yet for this community.</p> : null}
      {items.map((job) => (
        <article key={job.id} className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-base font-semibold text-slate-900">{job.title}</h3>
          <p className="mt-1 text-sm text-slate-600">{job.organization.name}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 px-2 py-0.5">{job.industry.name}</span>
            <span className="rounded-full border border-slate-200 px-2 py-0.5">{job.employmentType.replace(/_/g, ' ')}</span>
            <span className="rounded-full border border-slate-200 px-2 py-0.5">{parseLocationLabel(job.location)}</span>
            <span className="rounded-full border border-slate-200 px-2 py-0.5">{job.applicantCount} applicants</span>
          </div>
          {job.organization.provinceCode && job.organization.communitySlug ? (
            <Link
              href={`/com/${encodeURIComponent(job.organization.provinceCode.toLowerCase())}/${encodeURIComponent(job.organization.communitySlug)}/orgs/${encodeURIComponent(job.organization.slug)}/jobs`}
              className="mt-3 inline-flex rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              View organization jobs
            </Link>
          ) : null}
        </article>
      ))}
    </div>
  )
}
