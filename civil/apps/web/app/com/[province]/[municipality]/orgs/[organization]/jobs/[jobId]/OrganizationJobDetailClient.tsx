'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Modal from '../../../../../../../_components/Modal'
import RichTextEditor from '../../../../../../../_components/RichTextEditor'
import { pushToast } from '../../../../../../../_components/useToasts'
import { redirectToAuthModal } from '../../../../../../../_lib/authModal'
import { buildApiUrl } from '../../../../../../../_lib/api'
import { getStoredToken } from '../../../../../../../_lib/tokenStorage'

type JobItem = {
  id: string
  title: string
  photoUrl: string | null
  employmentType: string
  description: string | null
  duties: string
  roleRequirements: string
  location: string
  applicantCount: number
  expiresAt: string
  industry: {
    name: string
    subIndustry: { name: string; slug: string } | null
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

function toPlainTextPreview(value: string | null | undefined): string {
  const raw = typeof value === 'string' ? value : ''
  if (!raw) return ''

  return raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
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

export default function OrganizationJobDetailClient({
  province,
  municipality,
  slug,
  jobId,
}: {
  province: string
  municipality: string
  slug: string
  jobId: string
}) {
  const [loading, setLoading] = useState(true)
  const [job, setJob] = useState<JobItem | null>(null)
  const [applyingJob, setApplyingJob] = useState<JobItem | null>(null)
  const [motivationHtml, setMotivationHtml] = useState('')
  const [applying, setApplying] = useState(false)
  const [loginRequiredOpen, setLoginRequiredOpen] = useState(false)
  const [hasApplied, setHasApplied] = useState(false)

  const communityHref = `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}`
  const organizationHref = `${communityHref}/orgs/${encodeURIComponent(slug)}`

  const displayCommunityName = municipality
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

  const displayOrganizationName = slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

  const loadJob = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs?limit=200`),
        { cache: 'no-store' },
      )
      if (!res.ok) {
        setJob(null)
        return
      }

      const payload = (await res.json().catch(() => null)) as { items?: JobItem[] } | null
      const items = Array.isArray(payload?.items) ? payload.items : []
      const match = items.find((item) => item.id === jobId) ?? null
      setJob(match)
    } catch {
      setJob(null)
    } finally {
      setLoading(false)
    }
  }, [jobId, municipality, province, slug])

  useEffect(() => {
    void loadJob()
  }, [loadJob])

  const loadAppliedState = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setHasApplied(false)
      return
    }

    try {
      const res = await fetch(buildApiUrl(`/work/applications?limit=1&jobId=${encodeURIComponent(jobId)}`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        setHasApplied(false)
        return
      }

      const payload = (await res.json().catch(() => null)) as { items?: unknown[] } | null
      setHasApplied(Array.isArray(payload?.items) && payload.items.length > 0)
    } catch {
      setHasApplied(false)
    }
  }, [jobId])

  useEffect(() => {
    void loadAppliedState()
  }, [loadAppliedState])

  const requestApply = useCallback((target: JobItem) => {
    if (hasApplied) return
    const token = getStoredToken()
    if (!token) {
      setLoginRequiredOpen(true)
      return
    }
    setApplyingJob(target)
  }, [hasApplied])

  const submitApply = useCallback(async () => {
    if (!applyingJob) return
    const token = getStoredToken()
    if (!token) {
      setApplyingJob(null)
      setLoginRequiredOpen(true)
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
          setHasApplied(true)
          setApplyingJob(null)
          pushToast('You already applied to this job.', 'info')
          return
        }
        pushToast(errorMessage, 'error')
        return
      }

      pushToast('Application submitted.', 'success')
      setHasApplied(true)
      setApplyingJob(null)
      setMotivationHtml('')
      void loadJob()
    } catch {
      pushToast('Unable to apply right now.', 'error')
    } finally {
      setApplying(false)
    }
  }, [applyingJob, loadJob, motivationHtml])

  if (loading) {
    return <p className="text-sm text-slate-500">Loading job…</p>
  }

  if (!job) {
    return (
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">This job is no longer available.</p>
        <Link
          href={`/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs`}
          className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
        >
          Back to jobs
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Link href={organizationHref} className="hover:text-slate-700 hover:underline">
          {displayOrganizationName}
        </Link>
        <span> · </span>
        <Link href={communityHref} className="hover:text-slate-700 hover:underline">
          {displayCommunityName}
        </Link>
      </div>

      <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        {job.photoUrl ? <img src={job.photoUrl} alt={job.title} className="h-56 w-full rounded-xl border border-slate-200 object-cover" loading="lazy" /> : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{job.title}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {job.industry.name}
              {job.industry.subIndustry ? ` • ${job.industry.subIndustry.name}` : ''}
            </p>
          </div>
          <span className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600">{job.employmentType.replace(/_/g, ' ')}</span>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 px-2 py-0.5">{parseLocationLabel(job.location)}</span>
          <span className="rounded-full border border-slate-200 px-2 py-0.5">{job.applicantCount} applicants</span>
          <span className="rounded-full border border-slate-200 px-2 py-0.5">Closes {new Date(job.expiresAt).toLocaleDateString()}</span>
        </div>

        <section>
          <h3 className="text-sm font-semibold text-slate-900">Description</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{toPlainTextPreview(job.description || job.duties)}</p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900">Role Requirements</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{toPlainTextPreview(job.roleRequirements)}</p>
        </section>

        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => requestApply(job)}
            disabled={hasApplied}
          >
            {hasApplied ? 'Applied' : 'Apply'}
          </button>
          <Link
            href={`/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs`}
            className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
          >
            Back to jobs
          </Link>
        </div>
      </article>

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

      <Modal
        open={loginRequiredOpen}
        onClose={() => {
          if (applying) return
          setLoginRequiredOpen(false)
        }}
        title="Join Civil to apply"
        maxWidthClassName="max-w-md"
      >
        <div className="space-y-4 p-4 sm:p-6">
          <p className="text-sm text-slate-600">Applicants must be logged into a Civil Citizens account to apply for jobs.</p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => redirectToAuthModal('register')}
              className="rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              Join Civil
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
