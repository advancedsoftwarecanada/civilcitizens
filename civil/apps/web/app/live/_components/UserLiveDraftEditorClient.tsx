'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { Area } from 'react-easy-crop'
import PhotoUpdateModal from '../../_components/PhotoUpdateModal'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { redirectToAuthModal } from '../../_lib/authModal'
import { computeFallbackCropArea, generateCroppedImageBlob, readImageDimensions } from '../../_lib/imageCrop'
import { getStoredToken } from '../../_lib/tokenStorage'
import { pushToast } from '../../_components/useToasts'

type LiveMeeting = {
  id: string
  title: string
  description: string | null
  coverUrl: string | null
  startsAt: string | null
  visibility: 'PUBLIC' | 'PRIVATE'
  status: 'ACTIVE' | 'ARCHIVED'
  requiresPassword: boolean
  requiresManualAdmit: boolean
  maxParticipants: number | null
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

type ManageResponse = {
  meeting?: LiveMeeting
  host?: {
    href?: string
  }
  error?: unknown
}

const DEFAULT_CREATE_BODY = {
  title: 'Untitled live space',
  description: null,
  coverUrl: null,
  startsAt: null,
  visibility: 'PUBLIC',
  requiresPassword: false,
  password: null,
  requiresManualAdmit: false,
  maxParticipants: 100,
  moderatorHandles: [],
  status: 'ARCHIVED',
  launchMode: 'SPACE',
} as const

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const MB = 1024 * 1024
const COVER_IMAGE_LIMIT = 20 * MB
const COVER_VARIANT_PRIORITY = ['cover-xl', 'cover-lg', 'cover-md']
const POLL_MAX_ATTEMPTS = 30
const POLL_DELAY_MS = 3000
const COVER_EXPORT_WIDTH = 1920
const COVER_EXPORT_HEIGHT = 640
const COVER_ASPECT_RATIO = COVER_EXPORT_WIDTH / COVER_EXPORT_HEIGHT
const MAX_CROP_ZOOM = 3

type CoverDraftState = {
  file: File | null
  previewUrl: string | null
  crop: { x: number; y: number }
  zoom: number
  croppedAreaPixels: Area | null
  isDirty: boolean
}

function createCoverDraftState(): CoverDraftState {
  return {
    file: null,
    previewUrl: null,
    crop: { x: 0, y: 0 },
    zoom: 1,
    croppedAreaPixels: null,
    isDirty: false,
  }
}

function pickVariantUrl(variants?: Record<string, { url?: string | null } | null>) {
  if (!variants) return null
  for (const key of COVER_VARIANT_PRIORITY) {
    const candidate = variants[key]?.url
    if (candidate) return candidate
  }
  const fallback = Object.values(variants).find((variant) => variant?.url)
  return fallback?.url ?? null
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatDateInputValue(isoString: string | null | undefined) {
  if (!isoString) return ''
  const value = new Date(isoString)
  if (!Number.isFinite(value.getTime())) return ''
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
}

function formatTimeInputValue(isoString: string | null | undefined) {
  if (!isoString) return ''
  const value = new Date(isoString)
  if (!Number.isFinite(value.getTime())) return ''
  return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`
}

function combineScheduleDateTime(dateValue: string, timeValue: string) {
  const trimmedDate = dateValue.trim()
  if (!trimmedDate) return null
  const trimmedTime = timeValue.trim() || '00:00'
  const combined = new Date(`${trimmedDate}T${trimmedTime}`)
  return Number.isFinite(combined.getTime()) ? combined.toISOString() : null
}

function hydrateMeeting(raw: any): LiveMeeting {
  return {
    ...raw,
    startsAt: typeof raw?.startsAt === 'string'
      ? raw.startsAt
      : typeof raw?.schedule?.startsAt === 'string'
        ? raw.schedule.startsAt
        : null,
  }
}

async function waitForAssetReady(token: string, assetId: string) {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(buildApiUrl(`/media/assets/${encodeURIComponent(assetId)}`), {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (res.ok) {
      const payload = (await res.json().catch(() => null)) as MediaAssetStatusResponse | null
      const status = payload?.asset?.status
      if (status === 'ready') {
        return pickVariantUrl(payload.asset?.variants)
      }
      if (status === 'failed') {
        const reason = payload?.asset?.failureReason ? ` (${payload.asset.failureReason})` : ''
        throw new Error(`Your cover photo could not be processed${reason}.`)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS))
  }

  throw new Error('Your cover photo is taking longer than expected to process. Please refresh in a moment.')
}

export default function UserLiveDraftEditorClient({ spaceId, onSaved }: { spaceId?: string; onSaved?: (meeting: LiveMeeting) => void }) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'creating' | 'loading' | 'ready' | 'saving' | 'error'>('idle')
  const [meeting, setMeeting] = useState<LiveMeeting | null>(null)
  const [password, setPassword] = useState('')
  const [moderatorHandles, setModeratorHandles] = useState('')
  const [publicHref, setPublicHref] = useState<string | null>(null)
  const [coverUploadStatus, setCoverUploadStatus] = useState<'idle' | 'uploading' | 'processing' | 'ready' | 'error'>('idle')
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null)
  const [coverDraft, setCoverDraft] = useState<CoverDraftState>(createCoverDraftState)
  const [coverModalOpen, setCoverModalOpen] = useState(false)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

  const manageId = spaceId && spaceId !== 'new' ? spaceId : null

  useEffect(() => {
    return () => {
      if (coverDraft.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(coverDraft.previewUrl)
      }
    }
  }, [coverDraft.previewUrl])

  const ensureDraft = useCallback(async () => {
    if (manageId) return manageId
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return null
    }
    setStatus('creating')
    try {
      const res = await fetch(buildApiUrl('/live/spaces'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(DEFAULT_CREATE_BODY),
      })
      const { json, text } = await parseApiResponse<{ meeting?: { id?: string }; error?: unknown }>(res)
      if (res.status === 401) {
        redirectToAuthModal('login')
        return null
      }
      if (!res.ok) {
        pushToast(typeof json?.error === 'string' ? json.error : text || 'Unable to create live space.', 'error')
        setStatus('error')
        return null
      }
      const createdId = typeof json?.meeting?.id === 'string' ? json.meeting.id : ''
      if (!createdId) {
        pushToast('Live space created, but the id was missing.', 'error')
        setStatus('error')
        return null
      }
      router.replace(`/live/manage/${encodeURIComponent(createdId)}`)
      return createdId
    } catch (error) {
      console.error('live_space_create_failed', error)
      pushToast('Unable to create live space right now.', 'error')
      setStatus('error')
      return null
    }
  }, [manageId, router])

  const load = useCallback(async (id: string) => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setStatus('loading')
    try {
      const res = await fetch(buildApiUrl(`/live/spaces/${encodeURIComponent(id)}/manage`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const { json, text } = await parseApiResponse<ManageResponse>(res)
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok || !json?.meeting) {
        pushToast(typeof json?.error === 'string' ? json.error : text || 'Unable to load live space.', 'error')
        setStatus('error')
        return
      }
      setMeeting(hydrateMeeting(json.meeting))
      setPublicHref(typeof json.host?.href === 'string' ? json.host.href : null)
      setPassword('')
      setCoverUploadStatus('idle')
      setCoverUploadError(null)
      setCoverDraft((current) => {
        if (current.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(current.previewUrl)
        }
        return createCoverDraftState()
      })
      setStatus('ready')
    } catch (error) {
      console.error('live_space_load_failed', error)
      pushToast('Unable to load live space right now.', 'error')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      const id = await ensureDraft()
      if (id) await load(id)
    })()
  }, [ensureDraft, load])

  const persistMeeting = useCallback(async (nextMeeting: LiveMeeting, options?: { successMessage?: string }) => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return false
    }

    setStatus('saving')
    try {
      const res = await fetch(buildApiUrl(`/live/spaces/${encodeURIComponent(nextMeeting.id)}`), {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: nextMeeting.title,
          description: nextMeeting.description,
          coverUrl: nextMeeting.coverUrl,
          startsAt: nextMeeting.startsAt,
          visibility: nextMeeting.visibility,
          status: nextMeeting.status,
          requiresPassword: nextMeeting.requiresPassword,
          password: nextMeeting.requiresPassword ? (password.trim() ? password.trim() : undefined) : null,
          requiresManualAdmit: nextMeeting.requiresManualAdmit,
          maxParticipants: nextMeeting.maxParticipants,
          moderatorHandles: moderatorHandles
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      })
      const { json, text } = await parseApiResponse<ManageResponse>(res)
      if (res.status === 401) {
        redirectToAuthModal('login')
        return false
      }
      if (!res.ok || !json?.meeting) {
        pushToast(typeof json?.error === 'string' ? json.error : text || 'Unable to save live space.', 'error')
        setStatus('ready')
        return false
      }

      setMeeting(hydrateMeeting(json.meeting))
      setPublicHref(typeof json.host?.href === 'string' ? json.host.href : publicHref)
      setPassword('')
      setStatus('ready')
      onSaved?.(hydrateMeeting(json.meeting))
      if (options?.successMessage) {
        pushToast(options.successMessage, 'success')
      }
      router.refresh()
      return true
    } catch (error) {
      console.error('live_space_save_failed', error)
      pushToast('Unable to save live space right now.', 'error')
      setStatus('ready')
      return false
    }
  }, [moderatorHandles, onSaved, password, publicHref, router])

  const save = useCallback(async () => {
    if (!meeting) return
    const didSave = await persistMeeting(meeting, { successMessage: 'Saved.' })
    if (!didSave) return
    setCoverDraft((current) => {
      if (current.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(current.previewUrl)
      }
      return createCoverDraftState()
    })
    setCoverModalOpen(false)
  }, [meeting, persistMeeting])

  const uploadCover = useCallback(async (file: File) => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    if (file.size > COVER_IMAGE_LIMIT) {
      pushToast(`That file is too large. Max size is ${(COVER_IMAGE_LIMIT / MB).toFixed(0)}MB.`, 'error')
      return
    }
    if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
      pushToast('Please choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF image.', 'error')
      return
    }

    setCoverUploadStatus('uploading')
    setCoverUploadError(null)

    try {
      const dimensions = await readImageDimensions(file)
      const initRes = await fetch(buildApiUrl('/media/uploads'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          category: 'cover',
          mime: file.type || 'application/octet-stream',
          byteSize: file.size,
          filename: file.name,
        }),
      })

      if (!initRes.ok) {
        const { json, text } = await parseApiResponse<{ error?: unknown }>(initRes)
        throw new Error(typeof json?.error === 'string' ? json.error : text || 'Upload failed.')
      }

      const initPayload = (await initRes.json().catch(() => null)) as MediaUploadInitResponse | null
      const assetId = initPayload?.assetId
      if (!assetId) throw new Error('Upload failed.')

      let uploaded = false
      const directUrl = initPayload?.upload?.url
      if (directUrl) {
        try {
          const res = await fetch(directUrl, {
            method: 'PUT',
            headers: {
              ...(initPayload.upload?.headers ?? {}),
              'content-type': file.type || 'application/octet-stream',
            },
            body: file,
          })
          uploaded = res.ok
        } catch {
          uploaded = false
        }
      }

      if (!uploaded && initPayload?.proxyPath) {
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
      }

      if (!uploaded) throw new Error('Upload failed.')

      const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          assetId,
          width: dimensions?.width,
          height: dimensions?.height,
        }),
      })
      if (!completeRes.ok) throw new Error('Upload failed.')

      setCoverUploadStatus('processing')
      const variantUrl = await waitForAssetReady(token, assetId)
      if (!variantUrl) throw new Error('Your cover photo is still processing. Please refresh in a moment.')

      const nextMeeting = meeting ? { ...meeting, coverUrl: variantUrl } : null
      if (!nextMeeting) {
        throw new Error('Unable to save live space right now.')
      }

      setMeeting(nextMeeting)
      const didSave = await persistMeeting(nextMeeting, { successMessage: 'Cover updated.' })
      if (!didSave) {
        return
      }

      setCoverDraft((current) => {
        if (current.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(current.previewUrl)
        }
        return createCoverDraftState()
      })
      setCoverModalOpen(false)
      setCoverUploadStatus('ready')
    } catch (error) {
      console.error('live_cover_upload_failed', error)
      const message = error instanceof Error ? error.message : 'Upload failed.'
      setCoverUploadStatus('error')
      setCoverUploadError(message)
      pushToast(message, 'error')
    }
  }, [meeting, persistMeeting])

  const openCoverPicker = useCallback(() => {
    coverInputRef.current?.click()
  }, [])

  const handleCoverFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (file.size > COVER_IMAGE_LIMIT) {
      pushToast(`That file is too large. Max size is ${(COVER_IMAGE_LIMIT / MB).toFixed(0)}MB.`, 'error')
      return
    }
    if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
      pushToast('Please choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF image.', 'error')
      return
    }

    const previewUrl = URL.createObjectURL(file)
    setCoverDraft((current) => {
      if (current.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(current.previewUrl)
      }
      return {
        file,
        previewUrl,
        crop: { x: 0, y: 0 },
        zoom: 1,
        croppedAreaPixels: null,
        isDirty: true,
      }
    })
    setCoverUploadError(null)
    setCoverUploadStatus('idle')
    setCoverModalOpen(true)
  }, [])

  const handleCoverCropChange = useCallback((nextCrop: { x: number; y: number }) => {
    setCoverDraft((current) => ({ ...current, crop: nextCrop, isDirty: true }))
  }, [])

  const handleCoverZoomChange = useCallback((nextZoom: number) => {
    setCoverDraft((current) => ({ ...current, zoom: nextZoom, isDirty: true }))
  }, [])

  const handleCoverCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCoverDraft((current) => ({ ...current, croppedAreaPixels: areaPixels, isDirty: true }))
  }, [])

  const resetCoverDraftCrop = useCallback(() => {
    setCoverDraft((current) => ({
      ...current,
      crop: { x: 0, y: 0 },
      zoom: 1,
      croppedAreaPixels: null,
      isDirty: Boolean(current.file),
    }))
  }, [])

  const closeCoverModal = useCallback(() => {
    if (coverUploadStatus === 'uploading' || coverUploadStatus === 'processing') return
    setCoverModalOpen(false)
  }, [coverUploadStatus])

  const applyCoverCrop = useCallback(async () => {
    if (!coverDraft.file) {
      pushToast('Upload a photo before applying it.', 'error')
      return
    }

    let cropArea = coverDraft.croppedAreaPixels
    if (!cropArea) {
      const dims = await readImageDimensions(coverDraft.file)
      if (!dims) {
        pushToast('We could not read that photo. Please choose a different one.', 'error')
        return
      }
      cropArea = computeFallbackCropArea(dims, COVER_ASPECT_RATIO)
      setCoverDraft((current) => ({ ...current, croppedAreaPixels: cropArea }))
    }

    const blob = await generateCroppedImageBlob(coverDraft.file, cropArea, {
      width: COVER_EXPORT_WIDTH,
      height: COVER_EXPORT_HEIGHT,
      mime: 'image/jpeg',
      quality: 0.92,
    })
    if (!blob) {
      pushToast('We could not crop that image. Please try again with a different photo.', 'error')
      return
    }

    const baseName = coverDraft.file.name?.replace(/\.[^/.]+$/, '') || 'live-cover'
    const croppedFile = new File([blob], `${baseName}-cover.jpg`, { type: blob.type || 'image/jpeg' })
    await uploadCover(croppedFile)
  }, [coverDraft, uploadCover])

  const removeCover = useCallback(() => {
    setMeeting((current) => (current ? { ...current, coverUrl: null } : current))
    setCoverDraft((current) => {
      if (current.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(current.previewUrl)
      return createCoverDraftState()
    })
    setCoverModalOpen(false)
    setCoverUploadStatus('idle')
    setCoverUploadError(null)
  }, [])

  const remove = useCallback(async () => {
    if (!meeting) return
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    setStatus('saving')
    try {
      const res = await fetch(buildApiUrl(`/live/spaces/${encodeURIComponent(meeting.id)}`), {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      const { json, text } = await parseApiResponse<{ error?: unknown }>(res)
      if (res.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!res.ok) {
        pushToast(typeof json?.error === 'string' ? json.error : text || 'Unable to delete live space.', 'error')
        setStatus('ready')
        return
      }
      pushToast('Live space deleted.', 'success')
      router.push('/live')
      router.refresh()
    } catch (error) {
      console.error('live_space_delete_failed', error)
      pushToast('Unable to delete live space right now.', 'error')
      setStatus('ready')
    }
  }, [meeting, router])

  const isBusy = status === 'creating' || status === 'loading' || status === 'saving'
  const maxParticipantsValue = useMemo(() => Math.max(1, Math.min(100, Number(meeting?.maxParticipants ?? 100) || 100)), [meeting?.maxParticipants])
  const coverImageUrl = coverDraft.previewUrl || meeting?.coverUrl || null
  const scheduleDateValue = formatDateInputValue(meeting?.startsAt)
  const scheduleTimeValue = formatTimeInputValue(meeting?.startsAt)

  if (status === 'idle' || status === 'creating' || status === 'loading') {
    return <p className="text-sm text-slate-500">Loading live space...</p>
  }

  if (status === 'error' || !meeting) {
    return <p className="text-sm text-slate-500">Unable to load this live space.</p>
  }

  return (
    <div className="space-y-6">
      <PhotoUpdateModal
        open={coverModalOpen}
        title="Update live room cover"
        subtitle="Drag and zoom the image so it fits the live room header cleanly."
        imageUrl={coverDraft.previewUrl ? null : meeting.coverUrl}
        cropperImageUrl={coverDraft.previewUrl}
        aspect={COVER_ASPECT_RATIO}
        cropShape="rect"
        showGrid
        crop={coverDraft.crop}
        zoom={coverDraft.zoom}
        maxZoom={MAX_CROP_ZOOM}
        onCropChange={handleCoverCropChange}
        onZoomChange={handleCoverZoomChange}
        onCropComplete={handleCoverCropComplete}
        onResetPosition={resetCoverDraftCrop}
        onPickFile={openCoverPicker}
        uploadStatus={coverUploadStatus}
        uploadError={coverUploadError}
        showCaption={false}
        caption=""
        onCaptionChange={() => {}}
        primaryLabel="Apply cover"
        primaryDisabled={!coverDraft.file || coverUploadStatus === 'uploading' || coverUploadStatus === 'processing'}
        primaryLoading={coverUploadStatus === 'uploading' || coverUploadStatus === 'processing'}
        primaryLoadingLabel={coverUploadStatus === 'processing' ? 'Processing…' : 'Uploading…'}
        onPrimary={() => {
          void applyCoverCrop()
        }}
        onClose={closeCoverModal}
      />

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Manage Live Space</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">{meeting.title.trim() || 'Untitled live space'}</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            {publicHref ? (
              <Link href={publicHref} className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900">
                Open public room
              </Link>
            ) : null}
            <button
              type="button"
              onClick={save}
              disabled={isBusy}
              className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
              {status === 'saving' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">Live room cover</p>
                <p className="text-xs text-slate-500">Upload the image shown in the live room header.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={openCoverPicker}
                  disabled={coverUploadStatus === 'uploading' || coverUploadStatus === 'processing'}
                  className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-60"
                >
                  {coverUploadStatus === 'uploading' || coverUploadStatus === 'processing' ? 'Uploading...' : coverImageUrl ? 'Replace cover' : 'Upload cover'}
                </button>
                {coverDraft.file ? (
                  <button
                    type="button"
                    onClick={() => setCoverModalOpen(true)}
                    disabled={coverUploadStatus === 'uploading' || coverUploadStatus === 'processing'}
                    className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-60"
                  >
                    Adjust fit
                  </button>
                ) : null}
                {coverImageUrl ? (
                  <button
                    type="button"
                    onClick={removeCover}
                    disabled={coverUploadStatus === 'uploading' || coverUploadStatus === 'processing'}
                    className="inline-flex items-center justify-center rounded-full border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:border-rose-400 hover:text-rose-700 disabled:opacity-60"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
            <input ref={coverInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES} className="hidden" onChange={handleCoverFileChange} />
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-100">
              {coverImageUrl ? (
                <img src={coverImageUrl} alt="Live room cover preview" className="h-48 w-full object-cover" />
              ) : (
                <div className="flex h-48 items-center justify-center bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_38%),linear-gradient(135deg,_rgba(226,232,240,0.9),_rgba(248,250,252,1))] px-6 text-center text-sm text-slate-500">
                  Add a room cover so the live space has a proper header image.
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500">Up to 20MB. Supported: JPG, PNG, WebP, AVIF, HEIC. After choosing a file, you can drag and zoom it to fit.</p>
            {coverUploadStatus === 'processing' ? <p className="text-xs text-emerald-600">Processing cover photo...</p> : null}
            {coverUploadError ? <p className="text-xs text-rose-600">{coverUploadError}</p> : null}
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Title</span>
            <input
              value={meeting.title}
              onChange={(event) => setMeeting({ ...meeting, title: event.target.value })}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
              placeholder="Your live space title"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Description</span>
            <textarea
              value={meeting.description ?? ''}
              onChange={(event) => setMeeting({ ...meeting, description: event.target.value || null })}
              rows={6}
              maxLength={1000}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
              placeholder="Tell people what this room is for. Use #hashtags if they help people find it."
            />
            <p className="text-right text-xs text-slate-500">{(meeting.description ?? '').length}/1000</p>
          </label>

          <div className="space-y-2 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Schedule start</p>
              <p className="text-xs text-slate-500">Pick when this live space should appear as upcoming. Leave it blank to keep it unscheduled.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Date</span>
                <input
                  type="date"
                  value={scheduleDateValue}
                  onChange={(event) => setMeeting({
                    ...meeting,
                    startsAt: combineScheduleDateTime(event.target.value, scheduleTimeValue),
                  })}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Time</span>
                <input
                  type="time"
                  value={scheduleTimeValue}
                  onChange={(event) => setMeeting({
                    ...meeting,
                    startsAt: combineScheduleDateTime(scheduleDateValue, event.target.value),
                  })}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
                />
              </label>
            </div>
            {meeting.startsAt ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Scheduled for {new Date(meeting.startsAt).toLocaleString()}</p>
                <button
                  type="button"
                  onClick={() => setMeeting({ ...meeting, startsAt: null })}
                  className="text-xs font-semibold text-[var(--cc-primary)] transition hover:text-[var(--cc-primary-700)]"
                >
                  Clear schedule
                </button>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Visibility</span>
              <select
                value={meeting.visibility}
                onChange={(event) => setMeeting({ ...meeting, visibility: event.target.value as 'PUBLIC' | 'PRIVATE' })}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
              >
                <option value="PUBLIC">Public</option>
                <option value="PRIVATE">Private</option>
              </select>
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Status</span>
              <select
                value={meeting.status}
                onChange={(event) => setMeeting({ ...meeting, status: event.target.value as 'ACTIVE' | 'ARCHIVED' })}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
              >
                <option value="ARCHIVED">Ended</option>
                <option value="ACTIVE">Live</option>
              </select>
            </label>
          </div>
        </div>

        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
            <span>
              <span className="block text-sm font-semibold text-slate-800">Require password</span>
              <span className="block text-xs text-slate-500">Gate the room with a password.</span>
            </span>
            <input
              type="checkbox"
              checked={meeting.requiresPassword}
              onChange={(event) => setMeeting({ ...meeting, requiresPassword: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
          </label>

          {meeting.requiresPassword ? (
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
                placeholder="Leave blank to keep the current password"
              />
            </label>
          ) : null}

          <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
            <span>
              <span className="block text-sm font-semibold text-slate-800">Manual admit</span>
              <span className="block text-xs text-slate-500">Let guests request entry first.</span>
            </span>
            <input
              type="checkbox"
              checked={meeting.requiresManualAdmit}
              onChange={(event) => setMeeting({ ...meeting, requiresManualAdmit: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Max participants</span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxParticipantsValue}
              onChange={(event) => setMeeting({ ...meeting, maxParticipants: Math.max(1, Math.min(100, Number(event.target.value) || 1)) })}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Moderator handles</span>
            <input
              value={moderatorHandles}
              onChange={(event) => setModeratorHandles(event.target.value)}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
              placeholder="alice,bob,charlie"
            />
          </label>

          <button
            type="button"
            onClick={remove}
            disabled={isBusy}
            className="inline-flex w-full items-center justify-center rounded-full border border-rose-300 px-5 py-2.5 text-sm font-semibold text-rose-600 transition hover:border-rose-400 hover:text-rose-700 disabled:opacity-60"
          >
            Delete live space
          </button>
        </div>
      </section>
    </div>
  )
}