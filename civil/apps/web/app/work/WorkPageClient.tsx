'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import CivilCard from '../_components/CivilCard'
import DashboardShell from '../_components/DashboardShell'
import { RightRail } from '../_components/RightRail'
import { buildApiUrl } from '../_lib/api'

type IndustryOption = {
  id: string
  name: string
  slug: string
  subIndustries: Array<{ id: string; name: string; slug: string }>
}

type JobItem = {
  id: string
  title: string
  photoUrl: string | null
  employmentType: string
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  description: string | null
  duties: string
  roleRequirements: string
  location: string
  applicantCount: number
  publishedAt: string | null
  expiresAt: string
  sponsored: boolean
  industry: {
    name: string
    slug: string
    subIndustry: { name: string; slug: string } | null
  }
  organization: {
    id: string
    name: string
    slug: string
    provinceCode: string | null
    communitySlug: string | null
    logoUrl: string | null
    coverUrl: string | null
  }
}

function parseLocationLabel(value: string): string {
  const trimmed = (value || '').trim()
  if (!trimmed) return 'Location not set'
  if (trimmed === 'special:remote') return 'Remote'
  if (trimmed === 'special:not_in_canada') return 'Not in Canada'
  if (!trimmed.startsWith('community:')) return 'Location not set'

  const body = trimmed.slice('community:'.length)
  const [head, labelPart] = body.split('|')
  const [, communitySlug] = (head ?? '').split(':')
  const label = (labelPart ?? '').trim()
  if (label) return label
  return (communitySlug ?? '').replace(/-/g, ' ')
}

function salaryLabel(job: JobItem) {
  const currency = job.salaryCurrency ?? 'CAD'
  if (typeof job.salaryMin !== 'number' && typeof job.salaryMax !== 'number') return null
  const min = typeof job.salaryMin === 'number' ? job.salaryMin.toLocaleString() : null
  const max = typeof job.salaryMax === 'number' ? job.salaryMax.toLocaleString() : null
  const range = min && max ? `${currency} ${min} - ${max}` : `${currency} ${min ?? max}`
  return job.salaryPeriod ? `${range} / ${job.salaryPeriod}` : range
}

function getJobDetailHref(job: JobItem): string | null {
  if (!job.organization.provinceCode || !job.organization.communitySlug) return null
  return `/com/${encodeURIComponent(job.organization.provinceCode.toLowerCase())}/${encodeURIComponent(job.organization.communitySlug)}/orgs/${encodeURIComponent(job.organization.slug)}/jobs/${encodeURIComponent(job.id)}`
}

function getOrganizationJobsHref(job: JobItem): string | null {
  if (!job.organization.provinceCode || !job.organization.communitySlug) return null
  return `/com/${encodeURIComponent(job.organization.provinceCode.toLowerCase())}/${encodeURIComponent(job.organization.communitySlug)}/orgs/${encodeURIComponent(job.organization.slug)}/jobs`
}

function clickableTagClassName(active: boolean) {
  return `rounded-full border px-2 py-0.5 transition ${active ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`
}

function employmentTypeLabel(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase()
}

function truncateDescription(value: string | null | undefined, maxChars = 140) {
  const text = (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
    .replace(/\s+/g, ' ')
  if (!text) return null
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trimEnd()}…`
}

function JobCard({
  job,
  industrySlug,
  onSelectIndustry,
  isApplied,
  sponsored = false,
}: {
  job: JobItem
  industrySlug: string
  onSelectIndustry: (slug: string) => void
  isApplied: boolean
  sponsored?: boolean
}) {
  const payLabel = salaryLabel(job)
  const detailHref = getJobDetailHref(job)
  const organizationJobsHref = getOrganizationJobsHref(job)
  const descriptionPreview = truncateDescription(job.description)

  return (
    <article className="group rounded-2xl bg-white p-3 transition hover:bg-slate-50/70">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="w-full sm:w-60 sm:flex-none">
          {detailHref ? (
            <Link href={detailHref} className="block">
              <div className="relative h-36 w-full overflow-hidden rounded-xl bg-slate-100 sm:h-32">
                {job.photoUrl ? <img src={job.photoUrl} alt={job.title} className="h-full w-full object-cover" loading="lazy" /> : null}
              </div>
            </Link>
          ) : (
            <div className="relative h-36 w-full overflow-hidden rounded-xl bg-slate-100 sm:h-32">
              {job.photoUrl ? <img src={job.photoUrl} alt={job.title} className="h-full w-full object-cover" loading="lazy" /> : null}
            </div>
          )}

          {organizationJobsHref ? (
            <Link href={organizationJobsHref} className="mt-3 block">
              <CivilCard
                size="rail"
                name={job.organization.name}
                avatarAlt={job.organization.name}
                avatarInitials={job.organization.name}
                avatarSrc={job.organization.logoUrl}
                coverUrl={job.organization.coverUrl}
                isBusiness
              />
            </Link>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            {detailHref ? (
              <Link href={detailHref} className="text-xl font-semibold tracking-tight text-slate-900 transition group-hover:text-[var(--cc-primary)] hover:underline">
                {job.title}
              </Link>
            ) : (
              <h3 className="text-xl font-semibold tracking-tight text-slate-900">{job.title}</h3>
            )}

            {sponsored ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Sponsored Job Post</span>
            ) : isApplied ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Applied</span>
            ) : (
              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600">{employmentTypeLabel(job.employmentType)}</span>
            )}
          </div>

          <p className="text-base text-slate-700">{parseLocationLabel(job.location)}</p>

          {descriptionPreview ? <p className="text-sm text-slate-600">{descriptionPreview}</p> : null}

          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <button type="button" onClick={() => onSelectIndustry(job.industry.slug)} className={clickableTagClassName(industrySlug === job.industry.slug)}>
              {job.industry.name}
            </button>
            <span className="rounded-full border border-slate-200 px-2 py-0.5">{job.applicantCount} applicants</span>
            {payLabel ? <span className="rounded-full border border-slate-200 px-2 py-0.5">{payLabel}</span> : null}
          </div>
        </div>
      </div>
    </article>
  )
}

export default function WorkPageClient() {
  const [loading, setLoading] = useState(true)
  const [industries, setIndustries] = useState<IndustryOption[]>([])
  const [sponsoredJobs, setSponsoredJobs] = useState<JobItem[]>([])
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [appliedJobIds, setAppliedJobIds] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [provinceCode, setProvinceCode] = useState('')
  const [communitySlug, setCommunitySlug] = useState('')
  const [industrySlug, setIndustrySlug] = useState('')

  const loadIndustries = useCallback(async () => {
    try {
      const res = await fetch(buildApiUrl('/work/industries'), { cache: 'no-store' })
      if (!res.ok) return
      const payload = (await res.json().catch(() => null)) as { items?: IndustryOption[] } | null
      setIndustries(Array.isArray(payload?.items) ? payload.items : [])
    } catch {
      setIndustries([])
    }
  }, [])

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (provinceCode.trim()) params.set('provinceCode', provinceCode.trim().toUpperCase())
      if (communitySlug.trim()) params.set('communitySlug', communitySlug.trim().toLowerCase())
      if (industrySlug.trim()) params.set('industrySlug', industrySlug.trim().toLowerCase())
      params.set('limit', '40')

      const res = await fetch(buildApiUrl(`/work/jobs?${params.toString()}`), { cache: 'no-store' })
      if (!res.ok) {
        setSponsoredJobs([])
        setJobs([])
        setAppliedJobIds([])
        return
      }
      const payload = (await res.json().catch(() => null)) as { sponsored?: JobItem[]; items?: JobItem[]; appliedJobIds?: string[] } | null
      setSponsoredJobs(Array.isArray(payload?.sponsored) ? payload.sponsored : [])
      setJobs(Array.isArray(payload?.items) ? payload.items : [])
      setAppliedJobIds(Array.isArray(payload?.appliedJobIds) ? payload.appliedJobIds : [])
    } catch {
      setSponsoredJobs([])
      setJobs([])
      setAppliedJobIds([])
    } finally {
      setLoading(false)
    }
  }, [communitySlug, industrySlug, provinceCode, query])

  useEffect(() => {
    void loadIndustries()
  }, [loadIndustries])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  useEffect(() => {
    if (!sponsoredJobs.length) return
    sponsoredJobs.forEach((job) => {
      fetch(buildApiUrl(`/work/jobs/${encodeURIComponent(job.id)}/impression`), {
        method: 'POST',
      }).catch(() => {
        /* noop */
      })
    })
  }, [sponsoredJobs])

  return (
    <DashboardShell rightRail={<RightRail mode="work" organizationLinkTarget="chat" />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h1 className="text-2xl font-semibold text-slate-900">Work</h1>
          <p className="mt-1 text-sm text-slate-600">Find roles from Civil organizations and apply with your Civil profile.</p>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search jobs"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={provinceCode}
              onChange={(event) => setProvinceCode(event.target.value)}
              placeholder="Province code (e.g. ON)"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={communitySlug}
              onChange={(event) => setCommunitySlug(event.target.value)}
              placeholder="Community slug"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <select
              value={industrySlug}
              onChange={(event) => setIndustrySlug(event.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">All industries</option>
              {industries.map((industry) => (
                <option key={industry.id} value={industry.slug}>
                  {industry.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Loading jobs…</div>
        ) : null}

        {!loading && sponsoredJobs.length > 0 ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-amber-900">Sponsored Job Posts</h2>
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">$0 Limited time bonus</span>
            </div>
            <div className="space-y-3">
              {sponsoredJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  industrySlug={industrySlug}
                  onSelectIndustry={setIndustrySlug}
                  isApplied={appliedJobIds.includes(job.id)}
                  sponsored
                />
              ))}
            </div>
          </section>
        ) : null}

        {!loading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            {jobs.length === 0 ? (
              <p className="text-sm text-slate-500">No jobs found for these filters.</p>
            ) : (
              <ul className="space-y-3">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <JobCard job={job} industrySlug={industrySlug} onSelectIndustry={setIndustrySlug} isApplied={appliedJobIds.includes(job.id)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </DashboardShell>
  )
}
