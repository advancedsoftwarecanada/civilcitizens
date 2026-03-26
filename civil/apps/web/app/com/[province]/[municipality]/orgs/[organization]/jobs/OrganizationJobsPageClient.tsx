'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import CivilCard from '../../../../../../_components/CivilCard'
import Modal from '../../../../../../_components/Modal'
import RichTextEditor from '../../../../../../_components/RichTextEditor'
import { pushToast } from '../../../../../../_components/useToasts'
import { redirectToAuthModal } from '../../../../../../_lib/authModal'
import { buildApiUrl } from '../../../../../../_lib/api'
import { getStoredToken } from '../../../../../../_lib/tokenStorage'

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
  sponsored: boolean
  industry: {
    slug: string
    name: string
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
  if (value === 'special:remote') return 'Remote'
  if (value === 'special:not_in_canada') return 'Not in Canada'
  if (value.startsWith('community:')) {
    const body = value.slice('community:'.length)
    const [, labelPart] = body.split('|')
    return (labelPart ?? '').trim() || 'Community'
  }
  return 'Location not set'
}

function salaryLabel(job: JobItem) {
  const currency = job.salaryCurrency ?? 'CAD'
  if (typeof job.salaryMin !== 'number' && typeof job.salaryMax !== 'number') return null
  const min = typeof job.salaryMin === 'number' ? job.salaryMin.toLocaleString() : null
  const max = typeof job.salaryMax === 'number' ? job.salaryMax.toLocaleString() : null
  const range = min && max ? `${currency} ${min} - ${max}` : `${currency} ${min ?? max}`
  return job.salaryPeriod ? `${range} / ${job.salaryPeriod}` : range
}

function getJobDetailHref(job: JobItem) {
  if (!job.organization.provinceCode || !job.organization.communitySlug) return null
  return `/com/${encodeURIComponent(job.organization.provinceCode.toLowerCase())}/${encodeURIComponent(job.organization.communitySlug)}/orgs/${encodeURIComponent(job.organization.slug)}/jobs/${encodeURIComponent(job.id)}`
}

function getOrganizationJobsHref(job: JobItem) {
  if (!job.organization.provinceCode || !job.organization.communitySlug) return null
  return `/com/${encodeURIComponent(job.organization.provinceCode.toLowerCase())}/${encodeURIComponent(job.organization.communitySlug)}/orgs/${encodeURIComponent(job.organization.slug)}/jobs`
}

function employmentTypeLabel(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase()
}

function normalizeApiErrorMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }

  if (Array.isArray(value)) {
    const joined = value.map((item) => normalizeApiErrorMessage(item)).filter(Boolean).join(' ')
    return joined.length ? joined : null
  }

  if (value && typeof value === 'object') {
    const maybeFlatten = value as { formErrors?: unknown; fieldErrors?: unknown }
    const pieces: string[] = []

    const formErrors = normalizeApiErrorMessage(maybeFlatten.formErrors)
    if (formErrors) pieces.push(formErrors)

    const fieldErrorsRaw = maybeFlatten.fieldErrors
    if (fieldErrorsRaw && typeof fieldErrorsRaw === 'object' && !Array.isArray(fieldErrorsRaw)) {
      for (const fieldValue of Object.values(fieldErrorsRaw as Record<string, unknown>)) {
        const msg = normalizeApiErrorMessage(fieldValue)
        if (msg) pieces.push(msg)
      }
    } else {
      const fieldErrors = normalizeApiErrorMessage(fieldErrorsRaw)
      if (fieldErrors) pieces.push(fieldErrors)
    }

    if (pieces.length) return pieces.join(' ')

    const fallback = Object.values(value as Record<string, unknown>)
      .map((entry) => normalizeApiErrorMessage(entry))
      .filter(Boolean)
      .join(' ')
    return fallback.length ? fallback : null
  }

  if (value == null) return null

  const asString = String(value).trim()
  return asString.length ? asString : null
}

function resolveApiErrorMessage(value: unknown, fallback: string): string {
  return normalizeApiErrorMessage(value) ?? fallback
}

export default function OrganizationJobsPageClient({
  province,
  municipality,
  slug,
}: {
  province: string
  municipality: string
  slug: string
}) {
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [applyingJob, setApplyingJob] = useState<JobItem | null>(null)
  const [motivationHtml, setMotivationHtml] = useState('')
  const [applying, setApplying] = useState(false)
  const [appliedJobIds, setAppliedJobIds] = useState<string[]>([])

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs`,
        ),
        { cache: 'no-store' },
      )
      if (!res.ok) {
        setJobs([])
        return
      }
      const payload = (await res.json().catch(() => null)) as { items?: JobItem[] } | null
      setJobs(Array.isArray(payload?.items) ? payload.items : [])
    } catch {
      setJobs([])
    } finally {
      setLoading(false)
    }
  }, [municipality, province, slug])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  const loadAppliedJobIds = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setAppliedJobIds([])
      return
    }

    try {
      const res = await fetch(buildApiUrl('/work/applications?limit=100'), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        setAppliedJobIds([])
        return
      }

      const payload = (await res.json().catch(() => null)) as { items?: Array<{ job?: { id?: string } }> } | null
      const ids = Array.isArray(payload?.items)
        ? payload.items.map((item) => item.job?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
      setAppliedJobIds(ids)
    } catch {
      setAppliedJobIds([])
    }
  }, [])

  useEffect(() => {
    void loadAppliedJobIds()
  }, [loadAppliedJobIds])

  const submitApply = useCallback(async () => {
    if (!applyingJob) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setApplying(true)
    try {
      const res = await fetch(buildApiUrl(`/work/jobs/${encodeURIComponent(applyingJob.id)}/apply`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ motivationHtml }),
      })

      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (!res.ok) {
        const errorMessage = resolveApiErrorMessage(payload?.error, 'Unable to apply right now.')
        if (errorMessage === 'already_applied') {
          pushToast('You already applied to this job.', 'info')
          setAppliedJobIds((prev) => (prev.includes(applyingJob.id) ? prev : [...prev, applyingJob.id]))
          setApplyingJob(null)
          return
        }
        pushToast(errorMessage, 'error')
        return
      }

      pushToast('Application submitted.', 'success')
      setAppliedJobIds((prev) => (prev.includes(applyingJob.id) ? prev : [...prev, applyingJob.id]))
      setApplyingJob(null)
      setMotivationHtml('')
      void loadJobs()
    } catch {
      pushToast('Unable to apply right now.', 'error')
    } finally {
      setApplying(false)
    }
  }, [applyingJob, loadJobs, motivationHtml])

  const activeJobs = useMemo(() => jobs, [jobs])

  return (
    <div className="space-y-4">
      {loading ? <p className="text-sm text-slate-500">Loading jobs…</p> : null}
      {!loading && activeJobs.length === 0 ? <p className="text-sm text-slate-500">No active jobs posted right now.</p> : null}
      {activeJobs.map((job) => (
        <article key={job.id} className="group rounded-2xl bg-white p-3 transition hover:bg-slate-50/70">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="w-full sm:w-60 sm:flex-none">
              {getJobDetailHref(job) ? (
                <Link href={getJobDetailHref(job)!} className="block">
                  <div className="relative h-36 w-full overflow-hidden rounded-xl bg-slate-100 sm:h-32">
                    {job.photoUrl ? <img src={job.photoUrl} alt={job.title} className="h-full w-full object-cover" loading="lazy" /> : null}
                  </div>
                </Link>
              ) : (
                <div className="relative h-36 w-full overflow-hidden rounded-xl bg-slate-100 sm:h-32">
                  {job.photoUrl ? <img src={job.photoUrl} alt={job.title} className="h-full w-full object-cover" loading="lazy" /> : null}
                </div>
              )}

              {getOrganizationJobsHref(job) ? (
                <Link href={getOrganizationJobsHref(job)!} className="mt-3 block">
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
                {getJobDetailHref(job) ? (
                  <Link href={getJobDetailHref(job)!} className="text-xl font-semibold tracking-tight text-slate-900 transition group-hover:text-[var(--cc-primary)] hover:underline">
                    {job.title}
                  </Link>
                ) : (
                  <h3 className="text-xl font-semibold tracking-tight text-slate-900">{job.title}</h3>
                )}

                {job.sponsored ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Sponsored Job Post</span>
                ) : appliedJobIds.includes(job.id) ? (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Applied</span>
                ) : (
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600">{employmentTypeLabel(job.employmentType)}</span>
                )}
              </div>

              <p className="text-base text-slate-700">{parseLocationLabel(job.location)}</p>

              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                <span className="rounded-full border border-slate-200 px-2 py-0.5">{job.industry.name}{job.industry.subIndustry ? ` • ${job.industry.subIndustry.name}` : ''}</span>
                <span className="rounded-full border border-slate-200 px-2 py-0.5">{job.applicantCount} applicants</span>
                {salaryLabel(job) ? <span className="rounded-full border border-slate-200 px-2 py-0.5">{salaryLabel(job)}</span> : null}
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => setApplyingJob(job)}
                  disabled={appliedJobIds.includes(job.id)}
                >
                  {appliedJobIds.includes(job.id) ? 'Applied' : 'Apply'}
                </button>
              </div>
            </div>
          </div>
        </article>
      ))}

      <Modal
        open={Boolean(applyingJob)}
        onClose={() => {
          if (applying) return
          setApplyingJob(null)
        }}
        title={applyingJob ? `Apply: ${applyingJob.title}` : 'Apply'}
        maxWidthClassName="max-w-2xl"
      >
        <div className="space-y-3 p-4 sm:p-6">
          <p className="text-sm text-slate-600">Tell us why you want this role.</p>
          <RichTextEditor
            value={motivationHtml}
            onChange={setMotivationHtml}
            placeholder="Share your motivation and relevant experience"
            minHeight={180}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setApplyingJob(null)}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
              disabled={applying}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitApply()}
              className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white"
              disabled={applying}
            >
              {applying ? 'Applying…' : 'Submit application'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
