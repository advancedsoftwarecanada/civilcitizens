'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { buildApiUrl } from '../../../../../../_lib/api'
import { getStoredToken } from '../../../../../../_lib/tokenStorage'
import { redirectToAuthModal } from '../../../../../../_lib/authModal'
import { pushToast } from '../../../../../../_components/useToasts'
import CivilCard from '../../../../../../_components/CivilCard'

type JobItem = {
  id: string
  title: string
  status: 'draft' | 'active' | 'closed' | 'expired'
  applicantCount: number
  industry: {
    name: string
    subIndustry: { name: string; slug: string } | null
  }
}

type JobApplicationItem = {
  id: string
  motivationHtml: string
  createdAt: string
  status: string
  threadId: string | null
  civicStatus: 'citizen' | 'permanent_resident' | 'work_permit' | 'study_permit' | 'unspecified'
  workAuthorization: 'authorized' | 'not_authorized' | 'unspecified'
  applicant: {
    id: string
    handle: string
    name: string | null
  }
}

type ApplicationFilterValue = 'all' | 'citizen' | 'permanent_resident' | 'work_permit' | 'study_permit' | 'unspecified'

type ApplicantProfileCard = {
  handle: string
  name: string | null
  avatarUrl: string | null
  coverUrl: string | null
  isVerified?: boolean
  isPremium?: boolean
}

function statusLabel(status: JobItem['status']) {
  if (status === 'draft') return 'Unpublished'
  if (status === 'active') return 'Published'
  if (status === 'closed') return 'Closed'
  return 'Expired'
}

function civicStatusLabel(value: JobApplicationItem['civicStatus']) {
  if (value === 'citizen') return 'Canadian Citizen'
  if (value === 'permanent_resident') return 'Permanent Resident'
  if (value === 'work_permit') return 'Valid Work Permit'
  if (value === 'study_permit') return 'Valid Study Permit'
  return 'Not Specified'
}

function workAuthorizationLabel(value: JobApplicationItem['workAuthorization']) {
  if (value === 'authorized') return 'Yes'
  if (value === 'not_authorized') return 'No'
  return 'Prefer not to say'
}

export default function OrganizationJobsManageClient({
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
  const [applicationsByJobId, setApplicationsByJobId] = useState<Record<string, JobApplicationItem[]>>({})
  const [loadingApplicationsFor, setLoadingApplicationsFor] = useState<string | null>(null)
  const [updatingApplicationId, setUpdatingApplicationId] = useState<string | null>(null)
  const [applicantCardsByHandle, setApplicantCardsByHandle] = useState<Record<string, ApplicantProfileCard>>({})
  const [applicationFiltersByJobId, setApplicationFiltersByJobId] = useState<Record<string, ApplicationFilterValue>>({})

  const manageBaseHref = `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs/manage`

  const loadJobs = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs?includeDrafts=1&limit=200`,
        ),
        {
          headers: {
            authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        },
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

  const loadApplications = useCallback(
    async (jobId: string) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setLoadingApplicationsFor(jobId)
      try {
        const res = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}/applications`,
          ),
          {
            headers: {
              authorization: `Bearer ${token}`,
            },
            cache: 'no-store',
          },
        )
        if (!res.ok) {
          pushToast('Unable to load applications.', 'error')
          return
        }
        const payload = (await res.json().catch(() => null)) as { items?: JobApplicationItem[] } | null
        const items = Array.isArray(payload?.items) ? payload.items : []
        setApplicationsByJobId((prev) => ({
          ...prev,
          [jobId]: items,
        }))

        const handles = Array.from(
          new Set(
            items
              .map((item) => (item.applicant?.handle ?? '').trim())
              .filter(Boolean)
              .map((handle) => handle.toLowerCase()),
          ),
        )
        const missingHandles = handles.filter((handle) => !applicantCardsByHandle[handle])
        if (missingHandles.length) {
          await Promise.all(
            missingHandles.map(async (handle) => {
              try {
                const userRes = await fetch(buildApiUrl(`/users/${encodeURIComponent(handle)}/posts?limit=1`), {
                  headers: { authorization: `Bearer ${token}` },
                  cache: 'no-store',
                })
                if (!userRes.ok) return
                const data = (await userRes.json().catch(() => null)) as { user?: any } | null
                const user = data?.user
                if (!user?.handle) return
                const key = String(user.handle).toLowerCase()
                setApplicantCardsByHandle((prev) => {
                  if (prev[key]) return prev
                  return {
                    ...prev,
                    [key]: {
                      handle: String(user.handle),
                      name: typeof user.name === 'string' ? user.name : null,
                      avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : null,
                      coverUrl: typeof user.coverUrl === 'string' ? user.coverUrl : null,
                      isVerified: Boolean(user.isVerified),
                      isPremium: Boolean(user.isPremium),
                    },
                  }
                })
              } catch {
                /* ignore */
              }
            }),
          )
        }
      } finally {
        setLoadingApplicationsFor(null)
      }
    },
    [applicantCardsByHandle, municipality, province, slug],
  )

  const promoteJob = useCallback(
    async (jobId: string) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      try {
        const res = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}/promote`,
          ),
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
            },
          },
        )
        const payload = (await res.json().catch(() => null)) as { error?: string; alreadyActive?: boolean } | null
        if (!res.ok) {
          if (payload?.error === 'wallet_required' || payload?.error === 'insufficient_wallet_balance') {
            pushToast('Top up your Civil Wallet to boost this job.', 'error')
            return
          }
          pushToast(payload?.error ?? 'Unable to promote job.', 'error')
          return
        }
        pushToast(payload?.alreadyActive ? 'Promotion is already active.' : 'Promotion started. $10.00 was charged from your Civil Wallet.', 'success')
      } catch {
        pushToast('Unable to promote job.', 'error')
      }
    },
    [municipality, province, slug],
  )

  const updateApplicationStatus = useCallback(
    async (jobId: string, applicationId: string, status: 'submitted' | 'reviewing' | 'shortlisted' | 'rejected' | 'hired' | 'withdrawn') => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setUpdatingApplicationId(applicationId)
      try {
        const res = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}/applications/${encodeURIComponent(applicationId)}/status`,
          ),
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ status }),
          },
        )

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null
          pushToast(payload?.error ?? 'Unable to update application status.', 'error')
          return
        }

        setApplicationsByJobId((prev) => ({
          ...prev,
          [jobId]: (prev[jobId] ?? []).map((application) =>
            application.id === applicationId
              ? { ...application, status }
              : application,
          ),
        }))
        pushToast(status === 'hired' ? 'Applicant marked as hired.' : 'Application status updated.', 'success')
      } catch {
        pushToast('Unable to update application status.', 'error')
      } finally {
        setUpdatingApplicationId(null)
      }
    },
    [municipality, province, slug],
  )

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Manage Jobs</h3>
            <p className="text-xs text-slate-500">Drafts are visible here only.</p>
          </div>
          <Link
            href={`${manageBaseHref}/create`}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Create job
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        {loading ? <p className="text-sm text-slate-500">Loading jobs…</p> : null}
        {!loading && jobs.length === 0 ? <p className="text-sm text-slate-500">No jobs yet.</p> : null}
        <div className="space-y-3">
          {jobs.map((job) => (
            <article key={job.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">{job.title}</h4>
                  <p className="text-xs text-slate-600">{job.industry.name}{job.industry.subIndustry ? ` • ${job.industry.subIndustry.name}` : ''}</p>
                  <p className="text-xs text-slate-600">Status: {statusLabel(job.status)} • {job.applicantCount} applicants</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`${manageBaseHref}/${encodeURIComponent(job.id)}`}
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700"
                    onClick={() => void loadApplications(job.id)}
                    disabled={loadingApplicationsFor === job.id}
                  >
                    {loadingApplicationsFor === job.id ? 'Loading…' : 'View applications'}
                  </button>
                  {job.status === 'active' ? (
                    <button
                      type="button"
                      className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800"
                      onClick={() => void promoteJob(job.id)}
                    >
                      Promote ($10)
                    </button>
                  ) : null}
                </div>
              </div>

              {applicationsByJobId[job.id]?.length ? (
                <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                  <div className="flex items-center justify-between gap-3 px-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Applications</p>
                    <select
                      value={applicationFiltersByJobId[job.id] ?? 'all'}
                      onChange={(event) => {
                        const nextValue = event.target.value as ApplicationFilterValue
                        setApplicationFiltersByJobId((prev) => ({ ...prev, [job.id]: nextValue }))
                      }}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      <option value="all">All statuses</option>
                      <option value="citizen">Canadian Citizen</option>
                      <option value="permanent_resident">Permanent Resident</option>
                      <option value="work_permit">Valid Work Permit</option>
                      <option value="study_permit">Valid Study Permit</option>
                      <option value="unspecified">Not Specified</option>
                    </select>
                  </div>
                  {(applicationsByJobId[job.id] ?? [])
                    .filter((application) => {
                      const activeFilter = applicationFiltersByJobId[job.id] ?? 'all'
                      return activeFilter === 'all' ? true : application.civicStatus === activeFilter
                    })
                    .map((application) => (
                    <div key={application.id} className="rounded-lg border border-slate-200 bg-white p-2">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/u/${application.applicant.handle}`} className="text-sm font-semibold text-[var(--cc-primary)] hover:underline">
                          {application.applicant.name || application.applicant.handle}
                        </Link>
                        <span className="text-xs text-slate-500">{new Date(application.createdAt).toLocaleDateString()} • {application.status}</span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-slate-700">
                          Work Authorization: {civicStatusLabel(application.civicStatus)}
                        </span>
                        {(application.civicStatus === 'work_permit' || application.civicStatus === 'study_permit' || application.civicStatus === 'unspecified') ? (
                          <span className="rounded-full border border-slate-200 px-2 py-1">
                            Authorized to work in Canada: {workAuthorizationLabel(application.workAuthorization)}
                          </span>
                        ) : null}
                      </div>

                      <Link
                        href={`/u/${application.applicant.handle}`}
                        className="mt-2 block"
                      >
                        {(() => {
                          const handleKey = (application.applicant.handle || '').toLowerCase()
                          const card = applicantCardsByHandle[handleKey] ?? null
                          const displayName = (card?.name ?? application.applicant.name ?? application.applicant.handle).trim() || application.applicant.handle
                          const coverUrl = card?.coverUrl ?? null
                          const avatarUrl = card?.avatarUrl ?? null

                          return (
                            <CivilCard
                              size="md"
                              name={displayName}
                              avatarAlt={displayName}
                              avatarInitials={displayName}
                              avatarSrc={avatarUrl}
                              coverUrl={coverUrl}
                              subtitle={`@${application.applicant.handle}`}
                              isVerified={Boolean(card?.isVerified)}
                              isBusiness={Boolean(card?.isPremium)}
                            />
                          )
                        })()}
                      </Link>

                      <div className="prose prose-sm mt-2 max-w-none text-slate-700" dangerouslySetInnerHTML={{ __html: application.motivationHtml }} />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {application.status !== 'hired' ? (
                          <button
                            type="button"
                            className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                            onClick={() => void updateApplicationStatus(job.id, application.id, 'hired')}
                            disabled={updatingApplicationId === application.id}
                          >
                            {updatingApplicationId === application.id ? 'Saving…' : 'Mark hired'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
