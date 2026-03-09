'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildApiUrl } from '../../../../../../_lib/api'
import { getStoredToken } from '../../../../../../_lib/tokenStorage'
import { redirectToAuthModal } from '../../../../../../_lib/authModal'
import { pushToast } from '../../../../../../_components/useToasts'
import RichTextEditor from '../../../../../../_components/RichTextEditor'

type IndustryOption = {
  id: string
  name: string
  slug: string
  subIndustries: Array<{ id: string; name: string; slug: string }>
}

type CommunitySearchResult = {
  provinceCode: string
  communitySlug: string
  communityName: string
}

type JobDetail = {
  id: string
  title: string
  status: 'draft' | 'active' | 'closed' | 'expired'
  employmentType: string
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  photoUrl: string | null
  duties: string
  description: string | null
  location: string
  expiresAt: string
  industry: {
    id: string
    name: string
    slug: string
    subIndustry: { id: string | null; name: string; slug: string | null } | null
  }
  marketing?: {
    impressions: number
    views: number
    applications: number
    activePromotion: boolean
    impressionCap: number
  }
}

type MediaUploadInitResponse = {
  assetId?: string
  upload?: {
    url?: string
    method?: string
    headers?: Record<string, string>
  }
  proxyPath?: string
}

type MediaAssetStatusResponse = {
  asset?: {
    status?: 'pending' | 'processing' | 'ready' | 'failed'
    variants?: Record<string, { url?: string | null } | null>
    failureReason?: string | null
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

const ANNUAL_BRACKET_VALUES = Array.from({ length: Math.floor(250000 / 15000) + 1 }, (_, index) => index * 15000)
  .filter((value) => value <= 250000)
const ANNUAL_BRACKETS = Array.from(new Set([...ANNUAL_BRACKET_VALUES, 250000])).sort((a, b) => a - b)

const HOURLY_RATE_VALUES = Array.from({ length: 41 }, (_, index) => index * 5)
const HOURLY_RATES = Array.from(new Set([...HOURLY_RATE_VALUES, 250])).sort((a, b) => a - b)

function formatCad(value: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value)
}

const EXPIRY_OPTIONS = [7, 14, 21, 30] as const
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const PHOTO_MAX_BYTES = 25 * 1024 * 1024

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

    if (pieces.length) {
      return pieces.join(' ')
    }

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

const pickPhotoVariantUrl = (variants?: Record<string, { url?: string | null } | null>) => {
  if (!variants) return null
  const preference = ['post-xl', 'post-lg', 'post-md', 'cover-xl', 'cover-lg', 'cover-md', 'avatar@2x', 'avatar@1x']
  for (const key of preference) {
    const candidate = variants[key]?.url
    if (candidate) return candidate
  }
  const fallback = Object.values(variants).find((variant) => variant?.url)
  return fallback?.url ?? null
}

const readImageDimensions = async (file: File): Promise<{ width: number; height: number } | null> => {
  try {
    const objectUrl = URL.createObjectURL(file)
    return await new Promise((resolve) => {
      const image = new Image()
      image.onload = () => {
        resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })
        URL.revokeObjectURL(objectUrl)
      }
      image.onerror = () => {
        resolve(null)
        URL.revokeObjectURL(objectUrl)
      }
      image.src = objectUrl
    })
  } catch {
    return null
  }
}

export default function OrganizationJobEditorClient({
  province,
  municipality,
  slug,
  jobId,
}: {
  province: string
  municipality: string
  slug: string
  jobId?: string
}) {
  const router = useRouter()
  const bootstrapped = useRef(false)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [boosting, setBoosting] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [confirmBoostOpen, setConfirmBoostOpen] = useState(false)

  const [draftId, setDraftId] = useState<string | null>(jobId ?? null)
  const [status, setStatus] = useState<'draft' | 'active' | 'closed' | 'expired'>('draft')
  const [industries, setIndustries] = useState<IndustryOption[]>([])
  const [communityResults, setCommunityResults] = useState<CommunitySearchResult[]>([])
  const [communitySearching, setCommunitySearching] = useState(false)

  const [title, setTitle] = useState('')
  const [workSchedule, setWorkSchedule] = useState<'full_time' | 'part_time'>('full_time')
  const [engagementType, setEngagementType] = useState<'employee' | 'contract'>('employee')
  const [volunteerPosition, setVolunteerPosition] = useState(false)
  const [salaryPeriod, setSalaryPeriod] = useState<'year' | 'hour'>('year')
  const [salaryMin, setSalaryMin] = useState('')
  const [salaryMax, setSalaryMax] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [industryId, setIndustryId] = useState('')
  const [subIndustryId, setSubIndustryId] = useState('')
  const [descriptionHtml, setDescriptionHtml] = useState('')
  const [expiresDays, setExpiresDays] = useState('30')
  const [locationQuery, setLocationQuery] = useState('')
  const defaultCommunityLocation = useMemo(
    () => `community:${province.toUpperCase()}:${municipality.toLowerCase()}|${municipality.replace(/-/g, ' ')}`,
    [municipality, province],
  )
  const [locationMode, setLocationMode] = useState<'community' | 'remote' | 'not_in_canada'>('community')
  const [locationValue, setLocationValue] = useState(defaultCommunityLocation)
  const [photoUrl, setPhotoUrl] = useState('')
  const [marketingStats, setMarketingStats] = useState<{ impressions: number; views: number; applications: number; activePromotion: boolean; impressionCap: number }>({
    impressions: 0,
    views: 0,
    applications: 0,
    activePromotion: false,
    impressionCap: 1000,
  })

  const basePath = useMemo(
    () => `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs/manage`,
    [municipality, province, slug],
  )

  const selectedIndustry = useMemo(() => industries.find((item) => item.id === industryId) ?? null, [industries, industryId])

  const loadIndustries = useCallback(async () => {
    try {
      const res = await fetch(buildApiUrl('/work/industries'), { cache: 'no-store' })
      if (!res.ok) return
      const payload = (await res.json().catch(() => null)) as { items?: IndustryOption[] } | null
      const items = Array.isArray(payload?.items) ? payload.items : []
      setIndustries(items)
    } catch {
      setIndustries([])
    }
  }, [])

  const loadJob = useCallback(
    async (id: string) => {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setLoading(true)
      try {
        const res = await fetch(
          buildApiUrl(
            `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}`,
          ),
          {
            headers: {
              authorization: `Bearer ${token}`,
            },
            cache: 'no-store',
          },
        )
        if (!res.ok) {
          pushToast('Unable to load job draft.', 'error')
          return
        }

        const payload = (await res.json().catch(() => null)) as { job?: JobDetail } | null
        if (!payload?.job) {
          pushToast('Unable to load job draft.', 'error')
          return
        }

        const job = payload.job
        setDraftId(job.id)
        setStatus(job.status)
        setTitle(job.title || '')
        if (job.employmentType === 'contract') {
          setEngagementType('contract')
          setWorkSchedule('full_time')
          setVolunteerPosition(false)
        } else if (job.employmentType === 'part_time') {
          setEngagementType('employee')
          setWorkSchedule('part_time')
          setVolunteerPosition(false)
        } else if (job.employmentType === 'volunteer') {
          setEngagementType('employee')
          setWorkSchedule('part_time')
          setVolunteerPosition(true)
        } else {
          setEngagementType('employee')
          setWorkSchedule('full_time')
          setVolunteerPosition(false)
        }

        const period = job.salaryPeriod === 'hour' ? 'hour' : 'year'
        setSalaryPeriod(period)
        if (period === 'hour') {
          setHourlyRate(typeof job.salaryMin === 'number' ? String(job.salaryMin) : '')
          setSalaryMin('')
          setSalaryMax('')
        } else {
          setSalaryMin(typeof job.salaryMin === 'number' ? String(job.salaryMin) : '')
          setSalaryMax(typeof job.salaryMax === 'number' ? String(job.salaryMax) : '')
          setHourlyRate('')
        }
        setIndustryId(job.industry.id)
        setSubIndustryId(job.industry.subIndustry?.id ?? '')
        setPhotoUrl(job.photoUrl || '')
        setDescriptionHtml(job.description || job.duties || '')
        const loadedLocation = job.location || defaultCommunityLocation
        setLocationValue(loadedLocation)
        if (loadedLocation === 'special:remote') {
          setLocationMode('remote')
        } else if (loadedLocation === 'special:not_in_canada') {
          setLocationMode('not_in_canada')
        } else {
          setLocationMode('community')
        }
        setMarketingStats({
          impressions: Number(job.marketing?.impressions ?? 0) || 0,
          views: Number(job.marketing?.views ?? 0) || 0,
          applications: Number(job.marketing?.applications ?? 0) || 0,
          activePromotion: Boolean(job.marketing?.activePromotion),
          impressionCap: Number(job.marketing?.impressionCap ?? 1000) || 1000,
        })

        const now = Date.now()
        const expiresMs = new Date(job.expiresAt).getTime()
        const days = Math.max(1, Math.min(30, Math.round((expiresMs - now) / (24 * 60 * 60 * 1000))))
        const nearest = EXPIRY_OPTIONS.reduce((closest, option) => (Math.abs(option - days) < Math.abs(closest - days) ? option : closest), EXPIRY_OPTIONS[0])
        setExpiresDays(String(nearest))
      } catch {
        pushToast('Unable to load job draft.', 'error')
      } finally {
        setLoading(false)
      }
    },
    [defaultCommunityLocation, municipality, province, slug],
  )

  const createDraft = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(
        buildApiUrl(`/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs/draft`),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
          },
        },
      )
      const payload = (await res.json().catch(() => null)) as { id?: string; error?: unknown } | null
      if (!res.ok || !payload?.id) {
        pushToast(resolveApiErrorMessage(payload?.error, 'Unable to start job draft.'), 'error')
        setLoading(false)
        return
      }

      router.replace(`${basePath}/${encodeURIComponent(payload.id)}`)
      await loadJob(payload.id)
    } catch {
      pushToast('Unable to start job draft.', 'error')
    } finally {
      setLoading(false)
    }
  }, [basePath, loadJob, municipality, province, router, slug])

  useEffect(() => {
    void loadIndustries()
  }, [loadIndustries])

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true

    if (jobId) {
      void loadJob(jobId)
      return
    }

    void createDraft()
  }, [createDraft, jobId, loadJob])

  useEffect(() => {
    const q = locationQuery.trim()
    if (q.length < 2) {
      setCommunityResults([])
      setCommunitySearching(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setCommunitySearching(true)
      try {
        const token = getStoredToken()
        const headers = token ? { authorization: `Bearer ${token}` } : undefined
        const params = new URLSearchParams({ q, type: 'communities', limit: '8' })
        const res = await fetch(buildApiUrl(`/search?${params.toString()}`), { headers, cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled) setCommunityResults([])
          return
        }
        const payload = (await res.json().catch(() => null)) as { communities?: Array<Record<string, unknown>> } | null
        const next: CommunitySearchResult[] = Array.isArray(payload?.communities)
          ? payload.communities
              .map((entry) => {
                const provinceCode =
                  typeof entry.provinceCode === 'string'
                    ? entry.provinceCode
                    : typeof entry.province === 'string'
                      ? entry.province
                      : null
                const communitySlug =
                  typeof entry.communitySlug === 'string'
                    ? entry.communitySlug
                    : typeof entry.slug === 'string'
                      ? entry.slug
                      : typeof entry.chamberSlug === 'string'
                        ? entry.chamberSlug
                        : null
                const communityName =
                  typeof entry.communityName === 'string'
                    ? entry.communityName
                    : typeof entry.name === 'string'
                      ? entry.name
                      : typeof entry.chamberName === 'string'
                        ? entry.chamberName
                        : null
                if (!provinceCode || !communitySlug || !communityName) return null
                return {
                  provinceCode: provinceCode.toUpperCase(),
                  communitySlug: communitySlug.toLowerCase(),
                  communityName,
                }
              })
              .filter((entry): entry is CommunitySearchResult => Boolean(entry))
          : []
        if (!cancelled) setCommunityResults(next)
      } catch {
        if (!cancelled) setCommunityResults([])
      } finally {
        if (!cancelled) setCommunitySearching(false)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [locationQuery])

  const uploadJobPhoto = useCallback(async (file: File) => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    if (file.size > PHOTO_MAX_BYTES) {
      pushToast('Image must be 25MB or smaller.', 'error')
      return
    }
    if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
      pushToast('Please upload JPG, PNG, WebP, AVIF, HEIC, or HEIF images.', 'error')
      return
    }

    setPhotoUploading(true)
    try {
      const dimensions = await readImageDimensions(file)
      const initRes = await fetch(buildApiUrl('/media/uploads'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category: 'post_image',
          mime: file.type || 'application/octet-stream',
          byteSize: file.size,
          filename: file.name,
        }),
      })
      if (!initRes.ok) {
        pushToast('Unable to start photo upload.', 'error')
        return
      }

      const initPayload = (await initRes.json().catch(() => null)) as MediaUploadInitResponse | null
      if (!initPayload?.assetId) {
        pushToast('Upload initialization failed.', 'error')
        return
      }

      let uploaded = false
      const signedUrl = initPayload.upload?.url
      const signedMethod = initPayload.upload?.method || 'PUT'
      const signedHeaders = initPayload.upload?.headers ?? {}

      if (signedUrl) {
        try {
          const directRes = await fetch(signedUrl, {
            method: signedMethod,
            headers: {
              ...signedHeaders,
              'content-type': file.type || 'application/octet-stream',
            },
            body: file,
          })
          uploaded = directRes.ok
        } catch {
          uploaded = false
        }
      }

      if (!uploaded && initPayload.proxyPath) {
        try {
          const proxyRes = await fetch(buildApiUrl(initPayload.proxyPath), {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': file.type || 'application/octet-stream',
              'x-upload-byte-size': String(file.size),
            },
            body: file,
          })
          uploaded = proxyRes.ok
        } catch {
          uploaded = false
        }
      }

      if (!uploaded) {
        pushToast('Photo upload failed.', 'error')
        return
      }

      const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          assetId: initPayload.assetId,
          width: dimensions?.width,
          height: dimensions?.height,
        }),
      })
      if (!completeRes.ok) {
        pushToast('Could not complete photo upload.', 'error')
        return
      }

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const pollRes = await fetch(buildApiUrl(`/media/assets/${encodeURIComponent(initPayload.assetId)}`), {
          headers: { authorization: `Bearer ${token}` },
        })
        if (pollRes.ok) {
          const pollPayload = (await pollRes.json().catch(() => null)) as MediaAssetStatusResponse | null
          const status = pollPayload?.asset?.status
          if (status === 'ready') {
            const mediaUrl = pickPhotoVariantUrl(pollPayload?.asset?.variants)
            if (mediaUrl) {
              setPhotoUrl(mediaUrl)
              pushToast('Photo uploaded.', 'success')
              return
            }
            break
          }
          if (status === 'failed') {
            pushToast(pollPayload?.asset?.failureReason || 'Image processing failed.', 'error')
            return
          }
        }
        await wait(2000)
      }

      pushToast('Image processing is taking longer than expected.', 'error')
    } finally {
      setPhotoUploading(false)
    }
  }, [])

  const save = useCallback(async () => {
    if (!draftId) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!industryId) {
      pushToast('Select an industry.', 'error')
      return
    }
    if (!locationValue.trim()) {
      pushToast('Select a job location.', 'error')
      return
    }

    const employmentType = volunteerPosition
      ? 'volunteer'
      : engagementType === 'contract'
        ? 'contract'
        : workSchedule === 'part_time'
          ? 'part_time'
          : 'full_time'

    const resolvedSalaryMin = volunteerPosition
      ? null
      : salaryPeriod === 'hour'
        ? (hourlyRate.trim() ? Number(hourlyRate) : null)
        : (salaryMin.trim() ? Number(salaryMin) : null)
    const resolvedSalaryMax = volunteerPosition
      ? null
      : salaryPeriod === 'hour'
        ? null
        : (salaryMax.trim() ? Number(salaryMax) : null)
    const resolvedSalaryPeriod = volunteerPosition ? null : salaryPeriod

    if (!volunteerPosition && salaryPeriod === 'year' && resolvedSalaryMin !== null && resolvedSalaryMax !== null && resolvedSalaryMax < resolvedSalaryMin) {
      pushToast('Annual salary max must be greater than or equal to min.', 'error')
      return
    }

    const days = Math.max(1, Math.min(30, Number(expiresDays) || 30))
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

    setSaving(true)
    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(draftId)}`,
        ),
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title,
            employmentType,
            salaryMin: resolvedSalaryMin,
            salaryMax: resolvedSalaryMax,
            salaryCurrency: 'CAD',
            salaryPeriod: resolvedSalaryPeriod,
            photoUrl: photoUrl || null,
            duties: descriptionHtml,
            description: descriptionHtml,
            location: locationValue,
            industryId,
            subIndustryId: subIndustryId || null,
            expiresAt,
          }),
        },
      )
      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (!res.ok) {
        pushToast(resolveApiErrorMessage(payload?.error, 'Unable to save job.'), 'error')
        return
      }
      pushToast('Saved.', 'success')
      await loadJob(draftId)
    } catch {
      pushToast('Unable to save job.', 'error')
    } finally {
      setSaving(false)
    }
  }, [
    descriptionHtml,
    draftId,
    engagementType,
    hourlyRate,
    expiresDays,
    industryId,
    loadJob,
    locationValue,
    municipality,
    photoUrl,
    province,
    salaryMax,
    salaryMin,
    salaryPeriod,
    slug,
    subIndustryId,
    title,
    volunteerPosition,
    workSchedule,
  ])

  const publish = useCallback(async () => {
    if (!draftId) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setPublishing(true)
    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(draftId)}/${status === 'active' ? 'unpublish' : 'publish'}`,
        ),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
          },
        },
      )
      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (!res.ok) {
        pushToast(resolveApiErrorMessage(payload?.error, 'Unable to update status.'), 'error')
        return
      }
      pushToast(status === 'active' ? 'Job unpublished.' : 'Job published.', 'success')
      await loadJob(draftId)
    } catch {
      pushToast('Unable to update status.', 'error')
    } finally {
      setPublishing(false)
    }
  }, [draftId, loadJob, municipality, province, slug, status])

  const requestStatusChange = useCallback(
    async (currentStatus: 'draft' | 'active' | 'closed' | 'expired', nextStatus: 'draft' | 'active') => {
      if (currentStatus === nextStatus) return
      await publish()
    },
    [publish],
  )

  const boostJob = useCallback(async () => {
    if (!draftId) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setBoosting(true)
    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(draftId)}/promote`,
        ),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
          },
        },
      )
      const payload = (await res.json().catch(() => null)) as { error?: unknown; alreadyActive?: boolean } | null
      if (!res.ok) {
        pushToast(resolveApiErrorMessage(payload?.error, 'Unable to start boost.'), 'error')
        return
      }
      pushToast(payload?.alreadyActive ? 'Boost is already active.' : 'Boost started. Civil Promotions are free for a limited time ($0.00).', 'success')
      setConfirmBoostOpen(false)
      await loadJob(draftId)
    } catch {
      pushToast('Unable to start boost.', 'error')
    } finally {
      setBoosting(false)
    }
  }, [draftId, loadJob, municipality, province, slug])

  const deleteJob = useCallback(async () => {
    if (!draftId) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setDeleting(true)
    try {
      const res = await fetch(
        buildApiUrl(
          `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(draftId)}`,
        ),
        {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${token}`,
          },
        },
      )
      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (!res.ok) {
        pushToast(resolveApiErrorMessage(payload?.error, 'Unable to delete job.'), 'error')
        return
      }
      pushToast('Job deleted.', 'success')
      router.replace(basePath)
    } catch {
      pushToast('Unable to delete job.', 'error')
    } finally {
      setDeleting(false)
    }
  }, [basePath, draftId, municipality, province, router, slug])

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">Status:</span>
            <select
              value={status === 'active' ? 'active' : 'draft'}
              onChange={(event) => void requestStatusChange(status, event.target.value as 'draft' | 'active')}
              disabled={loading || saving || publishing || deleting || !draftId}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            >
              <option value="draft">Unpublished</option>
              <option value="active">Published</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={loading || saving || publishing || deleting || !draftId}
              className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
            {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={loading || saving || publishing || deleting || !draftId}
              className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-white px-5 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>

      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Marketing</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="grid max-w-xs gap-1 text-xs font-semibold text-slate-700">
            Expires in days
            <select
              value={expiresDays}
              onChange={(event) => setExpiresDays(event.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={`expires-${option}`} value={String(option)}>
                  {option} days
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <p className="font-semibold text-slate-800">Stats</p>
            <p className="mt-1">- {marketingStats.impressions.toLocaleString()} impressions</p>
            <p>- {marketingStats.views.toLocaleString()} views</p>
            <p>- {marketingStats.applications.toLocaleString()} applications</p>
          </div>
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setConfirmBoostOpen(true)}
            disabled={loading || saving || publishing || deleting || boosting || !draftId || status !== 'active'}
            className="inline-flex items-center justify-center rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
          >
            Boost. $10 for 1,000 impressions. Boost now!
          </button>
          {status !== 'active' ? <p className="mt-1 text-xs text-slate-500">Publish this job first to enable boosting.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        {loading ? <p className="text-sm text-slate-500">Loading job draft…</p> : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Job title
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Job title" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Full time | Part time
            <select
              value={workSchedule}
              onChange={(event) => setWorkSchedule(event.target.value as 'full_time' | 'part_time')}
              disabled={volunteerPosition || engagementType === 'contract'}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="full_time">Full time</option>
              <option value="part_time">Part time</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Employee | Contract
            <select
              value={engagementType}
              onChange={(event) => setEngagementType(event.target.value as 'employee' | 'contract')}
              disabled={volunteerPosition}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="employee">Employee</option>
              <option value="contract">Contract</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={volunteerPosition}
              onChange={(event) => {
                const checked = event.target.checked
                setVolunteerPosition(checked)
                if (checked) {
                  setSalaryMin('')
                  setSalaryMax('')
                  setHourlyRate('')
                }
              }}
            />
            This is a volunteer position
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Salary period
            <select
              value={salaryPeriod}
              onChange={(event) => setSalaryPeriod(event.target.value as 'year' | 'hour')}
              disabled={volunteerPosition}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="year">Annual</option>
              <option value="hour">Hourly</option>
            </select>
          </label>
          {salaryPeriod === 'year' ? (
            <>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Annual salary min
                <select
                  value={salaryMin}
                  onChange={(event) => setSalaryMin(event.target.value)}
                  disabled={volunteerPosition}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
                >
                  <option value="">Select min</option>
                  {ANNUAL_BRACKETS.map((value) => (
                    <option key={`annual-min-${value}`} value={String(value)}>
                      {formatCad(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Annual salary max
                <select
                  value={salaryMax}
                  onChange={(event) => setSalaryMax(event.target.value)}
                  disabled={volunteerPosition}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
                >
                  <option value="">Select max</option>
                  {ANNUAL_BRACKETS.map((value) => (
                    <option key={`annual-max-${value}`} value={String(value)}>
                      {formatCad(value)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Hourly rate
              <select
                value={hourlyRate}
                onChange={(event) => setHourlyRate(event.target.value)}
                disabled={volunteerPosition}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
              >
                <option value="">Select hourly rate</option>
                {HOURLY_RATES.map((value) => (
                  <option key={`hourly-${value}`} value={String(value)}>
                    {formatCad(value)} / hour
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Industry
            <select
              value={industryId}
              onChange={(event) => {
                setIndustryId(event.target.value)
                setSubIndustryId('')
              }}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Select industry</option>
              {industries.map((industry) => (
                <option key={industry.id} value={industry.id}>
                  {industry.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Sub-industry
            <select value={subIndustryId} onChange={(event) => setSubIndustryId(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option value="">No sub-industry</option>
              {(selectedIndustry?.subIndustries ?? []).map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-semibold text-slate-800">Job photo</p>
          <p className="mt-1 text-xs text-slate-500">Your photo should represent what your job is about</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              {photoUploading ? 'Uploading…' : 'Upload photo'}
              <input
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                className="hidden"
                disabled={photoUploading}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void uploadJobPhoto(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
            {photoUrl ? (
              <button
                type="button"
                onClick={() => setPhotoUrl('')}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Remove photo
              </button>
            ) : null}
          </div>
          {photoUrl ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              <img src={photoUrl} alt="Job upload" className="h-48 w-full object-cover" />
            </div>
          ) : null}
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-semibold text-slate-800">Job location</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setLocationMode('community')
                if (!locationValue.startsWith('community:')) setLocationValue(defaultCommunityLocation)
              }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${locationMode === 'community' ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 text-slate-700'}`}
            >
              Community
            </button>
            <button
              type="button"
              onClick={() => {
                setLocationMode('remote')
                setLocationValue('special:remote')
                setLocationQuery('')
                setCommunityResults([])
              }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${locationMode === 'remote' ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 text-slate-700'}`}
            >
              Remote
            </button>
            <button
              type="button"
              onClick={() => {
                setLocationMode('not_in_canada')
                setLocationValue('special:not_in_canada')
                setLocationQuery('')
                setCommunityResults([])
              }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${locationMode === 'not_in_canada' ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]' : 'border-slate-200 text-slate-700'}`}
            >
              Not in Canada
            </button>
          </div>
          {locationMode === 'community' && locationValue.startsWith('community:') ? (
            <div className="mt-2 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-sm text-slate-700">{parseLocationLabel(locationValue)}</p>
              <button
                type="button"
                onClick={() => {
                  setLocationValue('')
                  setLocationQuery('')
                  setCommunityResults([])
                }}
                className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                aria-label="Clear community"
                title="Clear community"
              >
                X
              </button>
            </div>
          ) : null}

          {locationMode === 'community' && !locationValue.startsWith('community:') ? (
            <>
              <label className="mt-2 grid gap-1 text-xs font-semibold text-slate-700">
                Search Civil community
                <input
                  value={locationQuery}
                  onChange={(event) => setLocationQuery(event.target.value)}
                  placeholder="Search Civil community"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              {communitySearching ? <p className="mt-2 text-xs text-slate-500">Searching communities…</p> : null}
              {!communitySearching && communityResults.length > 0 ? (
                <ul className="mt-2 space-y-2 rounded-xl border border-slate-200 p-2">
                  {communityResults.map((item) => (
                    <li key={`${item.provinceCode}:${item.communitySlug}`}>
                      <button
                        type="button"
                        className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => {
                          setLocationValue(`community:${item.provinceCode}:${item.communitySlug}|${item.communityName}`)
                          setLocationQuery('')
                          setCommunityResults([])
                        }}
                      >
                        {item.communityName} <span className="text-xs text-slate-500">/{item.provinceCode.toLowerCase()}/{item.communitySlug}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">Selected: {parseLocationLabel(locationValue)}</p>
        </div>

        <div className="mt-3">
          <p className="mb-1 text-sm font-semibold text-slate-800">Description</p>
          <RichTextEditor value={descriptionHtml} onChange={setDescriptionHtml} minHeight={160} placeholder="Describe day-to-day responsibilities and details" />
        </div>
      </section>

      {confirmDeleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Delete this job?</h3>
            <p className="mt-2 text-sm text-slate-600">This action cannot be undone. The job posting and its data will be removed.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleting}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await deleteJob()
                  setConfirmDeleteOpen(false)
                }}
                disabled={deleting}
                className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete job'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmBoostOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Confirm boost purchase</h3>
            <p className="mt-2 text-sm text-slate-600">Boost this job for 1,000 impressions.</p>
            <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Civil Promotions are free for a limited time only, $0.00</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmBoostOpen(false)}
                disabled={boosting}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void boostJob()}
                disabled={boosting}
                className="inline-flex items-center justify-center rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
              >
                {boosting ? 'Processing…' : 'Confirm boost'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
