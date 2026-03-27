'use client'

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { LuImagePlus } from 'react-icons/lu'
import DashboardShell from '../../../_components/DashboardShell'
import Modal from '../../../_components/Modal'
import type { ApiPost } from '../../../_components/PostComposer'
import RichTextEditor from '../../../_components/RichTextEditor'
import { RightRail } from '../../../_components/RightRail'
import { pushToast } from '../../../_components/useToasts'
import { buildApiUrl } from '../../../_lib/api'
import { buildPostPath } from '../../../_lib/shareTarget'
import { redirectToAuthModal } from '../../../_lib/authModal'
import { getStoredToken } from '../../../_lib/tokenStorage'

type CauseStageGoal = {
  id: string
  amountCents: number
  description: string
  sortOrder: number
}

type CauseStageGoalForm = CauseStageGoal & {
  amountInput: string
}

type CauseDraft = {
  id: string
  title: string
  body: string
  mediaUrl: string | null
  images: string[]
  goalAmountCents: number
  stageGoals: CauseStageGoal[]
  provinceCode: string | null
  communitySlug: string | null
  publishedPostId: string | null
}

type CauseSummary = {
  goalAmountCents: number
  raisedAmountCents: number
  contributionCount: number
  progressPercent: number
}

type CauseDraftResponse = {
  draft?: CauseDraft
  cause?: CauseSummary | null
}

type CommunityFollowOption = {
  provinceCode: string
  communitySlug: string
  label: string
  home: boolean
}

type CommunityFollowsResponse = {
  items?: Array<{
    province?: string
    communitySlug?: string
    home?: boolean
    community?: {
      name?: string
      cityName?: string
      province?: string
    } | null
  }>
}

type DraftFormState = {
  title: string
  body: string
  communityKey: string
  stageGoals: CauseStageGoalForm[]
}

type PhotoItem = {
  id: string
  file?: File
  previewUrl: string
  assetId?: string | null
  mediaUrl?: string | null
  status: 'idle' | 'uploading' | 'processing' | 'ready' | 'error'
  error?: string | null
}

const GOAL_DESCRIPTION_MAX_LENGTH = 200
const STORY_MAX_LENGTH = 3000
const STAGE_GOAL_MAX_CENTS = 1_000_000
const PHOTO_MAX_BYTES = 25 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const MAX_IMAGE_DIMENSION = 8000
const MAX_IMAGE_MEGA_PIXELS = 40
const MAX_CAUSE_IMAGES = 12

function buildCommunityKey(provinceCode: string, communitySlug: string) {
  return `${provinceCode.toUpperCase()}:${communitySlug.toLowerCase()}`
}

function buildCausePostHref(post: { seoSlug?: string | null; id: string; provinceCode?: string | null; communitySlug?: string | null; author: { handle: string } }) {
  return buildPostPath({ ...post, type: 'cause' } as ApiPost)
}

function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 2,
  }).format(amountCents / 100)
}

function parseGoalInputToCents(value: string) {
  const numeric = Number.parseFloat(value.replace(/,/g, ''))
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.round(numeric * 100))
}

function clampStageGoalAmount(amountCents: number, minimumCents = 0) {
  return Math.max(minimumCents, Math.min(STAGE_GOAL_MAX_CENTS, Math.round(amountCents)))
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function pickPhotoVariantUrl(variants?: Record<string, { url?: string | null } | null>) {
  if (!variants) return null
  const preference = ['post-xl', 'post-lg', 'post-md', 'cover-xl', 'cover-lg', 'cover-md', 'avatar@2x', 'avatar@1x']
  for (const key of preference) {
    const candidate = variants[key]?.url
    if (candidate) return candidate
  }
  const fallback = Object.values(variants).find((variant) => variant?.url)
  return fallback?.url ?? null
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const readImageDimensions = async (file: File): Promise<{ width: number; height: number } | null> => {
  try {
    const objectUrl = URL.createObjectURL(file)
    return await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height })
        URL.revokeObjectURL(objectUrl)
      }
      img.onerror = () => {
        resolve(null)
        URL.revokeObjectURL(objectUrl)
      }
      img.src = objectUrl
    })
  } catch {
    return null
  }
}

function buildDraftPhotoItems(draft: CauseDraft): PhotoItem[] {
  const draftImages = Array.isArray(draft.images) && draft.images.length
    ? draft.images
    : draft.mediaUrl
      ? [draft.mediaUrl]
      : []

  return draftImages.map((imageUrl, index) => ({
    id: `existing-${index}-${imageUrl}`,
    previewUrl: imageUrl,
    mediaUrl: imageUrl,
    status: 'ready' as const,
  }))
}

function revokePhotoPreview(previewUrl: string) {
  if (previewUrl.startsWith('blob:')) {
    URL.revokeObjectURL(previewUrl)
  }
}

function createStageGoal(): CauseStageGoal {
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    amountCents: 0,
    description: '',
    sortOrder: 0,
  }
}

function formatAmountInput(amountCents: number) {
  if (amountCents <= 0) return ''
  return new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCents / 100)
}

function toStageGoalForm(goal: CauseStageGoal): CauseStageGoalForm {
  return {
    ...goal,
    amountInput: formatAmountInput(goal.amountCents),
  }
}

function sanitizeAmountInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '')
  const [whole = '', ...decimalParts] = cleaned.split('.')
  const decimals = decimalParts.join('').slice(0, 2)
  if (!cleaned.includes('.')) return whole
  return `${whole}.${decimals}`
}

function unformatAmountInput(value: string) {
  return value.replace(/,/g, '')
}

function reorderStageGoals(items: CauseStageGoalForm[], draggedId: string, targetId: string) {
  if (!draggedId || !targetId || draggedId === targetId) return items
  const fromIndex = items.findIndex((item) => item.id === draggedId)
  const toIndex = items.findIndex((item) => item.id === targetId)
  if (fromIndex < 0 || toIndex < 0) return items
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) return items
  next.splice(toIndex, 0, moved)
  return next.map((item, index) => ({ ...item, sortOrder: index }))
}

function buildGoalProgress(goals: Array<{ id: string; amountCents: number }>, raisedAmountCents: number) {
  let remaining = Math.max(0, raisedAmountCents)
  return goals.map((goal) => {
    const progressCents = Math.max(0, Math.min(goal.amountCents, remaining))
    remaining = Math.max(0, remaining - goal.amountCents)
    return {
      id: goal.id,
      progressCents,
      progressPercent: goal.amountCents > 0 ? Math.max(0, Math.min(100, Math.round((progressCents / goal.amountCents) * 100))) : 0,
    }
  })
}

function DragHandleIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <circle cx="6" cy="5" r="1.5" />
      <circle cx="6" cy="10" r="1.5" />
      <circle cx="6" cy="15" r="1.5" />
      <circle cx="14" cy="5" r="1.5" />
      <circle cx="14" cy="10" r="1.5" />
      <circle cx="14" cy="15" r="1.5" />
    </svg>
  )
}

export default function CauseDraftEditorPageClient({ draftId }: { draftId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const photosRef = useRef<PhotoItem[]>([])
  const [form, setForm] = useState<DraftFormState>({
    title: '',
    body: '',
    communityKey: '',
    stageGoals: [],
  })
  const [followOptions, setFollowOptions] = useState<CommunityFollowOption[]>([])
  const [loadedDraft, setLoadedDraft] = useState<CauseDraft | null>(null)
  const [loadedCause, setLoadedCause] = useState<CauseSummary | null>(null)
  const [draggingGoalId, setDraggingGoalId] = useState<string | null>(null)
  const [dragOverGoalId, setDragOverGoalId] = useState<string | null>(null)

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    let cancelled = false
    const load = async () => {
      try {
        const headers = { authorization: `Bearer ${token}` }
        const [draftRes, followsRes] = await Promise.all([
          fetch(buildApiUrl(`/causes/drafts/${encodeURIComponent(draftId)}`), { headers, cache: 'no-store' }),
          fetch(buildApiUrl('/communities/follows'), { headers, cache: 'no-store' }),
        ])

        if (draftRes.status === 401 || followsRes.status === 401) {
          redirectToAuthModal('login')
          return
        }
        if (!draftRes.ok) {
          pushToast('Unable to load this cause draft.', 'error')
          router.replace('/causes')
          return
        }

        const draftPayload = (await draftRes.json().catch(() => null)) as CauseDraftResponse | null
        const draft = draftPayload?.draft ?? null
        if (!draft) {
          pushToast('Unable to load this cause draft.', 'error')
          router.replace('/causes')
          return
        }

        const followsPayload = followsRes.ok ? ((await followsRes.json().catch(() => null)) as CommunityFollowsResponse | null) : null
        const options = Array.isArray(followsPayload?.items)
          ? followsPayload.items
              .map((item) => {
                const provinceCode = item.province?.toUpperCase().trim()
                const communitySlug = item.communitySlug?.toLowerCase().trim()
                if (!provinceCode || !communitySlug) return null
                const communityName = item.community?.name ?? item.community?.cityName ?? communitySlug
                return {
                  provinceCode,
                  communitySlug,
                  label: `${communityName} (${provinceCode})${item.home ? ' • Home' : ''}`,
                  home: Boolean(item.home),
                }
              })
              .filter((value): value is CommunityFollowOption => Boolean(value))
          : []

        if (!cancelled) {
          setLoadedDraft(draft)
          setLoadedCause(draftPayload?.cause ?? null)
          setPhotos(buildDraftPhotoItems(draft))
          setFollowOptions(options)
          setForm({
            title: draft.title,
            body: draft.body,
            communityKey: draft.provinceCode && draft.communitySlug ? buildCommunityKey(draft.provinceCode, draft.communitySlug) : '',
            stageGoals: [...draft.stageGoals].sort((left, right) => left.sortOrder - right.sortOrder).map(toStageGoalForm),
          })
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          pushToast('Unable to load this cause draft.', 'error')
          router.replace('/causes')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [draftId, router])

  const statusLabel = loadedDraft?.publishedPostId ? 'Published' : 'Draft'
  const statusCanEdit = true
  const stageGoalTotalCents = useMemo(
    () => form.stageGoals.reduce((sum, goal) => sum + Math.max(0, goal.amountCents), 0),
    [form.stageGoals],
  )
  const totalGoalCents = stageGoalTotalCents
  const goalProgress = useMemo(
    () => buildGoalProgress(form.stageGoals, loadedCause?.raisedAmountCents ?? 0),
    [form.stageGoals, loadedCause?.raisedAmountCents],
  )
  const goalProgressById = useMemo(
    () => Object.fromEntries(goalProgress.map((goal) => [goal.id, goal])),
    [goalProgress],
  )
  const hasAnyGoalProgress = goalProgress.some((goal) => goal.progressCents > 0)
  const storyPlainText = useMemo(() => stripHtml(form.body), [form.body])
  const readyPhotoUrls = useMemo(
    () => photos.map((photo) => photo.mediaUrl).filter((value): value is string => Boolean(value)),
    [photos],
  )
  const hasPhotoUploadsInFlight = useMemo(
    () => photos.some((photo) => photo.status === 'uploading' || photo.status === 'processing'),
    [photos],
  )
  const hasPhotoUploadErrors = useMemo(
    () => photos.some((photo) => photo.status === 'error'),
    [photos],
  )
  const photosReady = photos.length === 0 || readyPhotoUrls.length === photos.length
  const selectedCommunity = useMemo(
    () => followOptions.find((option) => buildCommunityKey(option.provinceCode, option.communitySlug) === form.communityKey) ?? null,
    [followOptions, form.communityKey],
  )

  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(() => {
    return () => {
      photosRef.current.forEach((photo) => revokePhotoPreview(photo.previewUrl))
    }
  }, [])

  const startPhotoUpload = useCallback(async (id: string, file: File) => {
    setPhotos((prev) => prev.map((photo) => (photo.id === id ? { ...photo, status: 'uploading', error: null } : photo)))

    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      setPhotos((prev) =>
        prev.map((photo) => (photo.id === id ? { ...photo, status: 'error', error: 'Sign in to upload a photo.' } : photo)),
      )
      return
    }

    try {
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
        const payload = await initRes.json().catch(() => ({}))
        const reason = typeof payload?.error === 'string' ? payload.error : 'upload_init_failed'
        throw new Error(reason)
      }

      const initPayload = await initRes.json()
      const assetId: string = initPayload.assetId
      const upload: { url?: string; method?: string; headers?: Record<string, string> } = initPayload.upload || {}
      const proxyPath: string | null = typeof initPayload?.proxyPath === 'string' ? initPayload.proxyPath : null

      const tryDirect = async () => {
        if (!upload.url) return false
        if (typeof window !== 'undefined' && window.location.protocol === 'https:' && upload.url.startsWith('http:')) {
          return false
        }

        const response = await fetch(upload.url, {
          method: upload.method || 'PUT',
          headers: upload.headers,
          body: file,
        })

        return response.ok
      }

      const tryProxy = async () => {
        if (!proxyPath) return false
        const response = await fetch(buildApiUrl(proxyPath), {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': file.type || 'application/octet-stream',
            'x-upload-byte-size': String(file.size),
          },
          body: file,
        })

        return response.ok
      }

      const directOk = upload.url
        ? await tryDirect().catch(() => false)
        : false
      const proxyOk = directOk
        ? true
        : await tryProxy().catch(() => false)

      if (!directOk && !proxyOk) {
        throw new Error('upload_failed')
      }

      const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ assetId }),
      })

      if (!completeRes.ok) {
        throw new Error('processing_not_scheduled')
      }

      setPhotos((prev) => prev.map((photo) => (photo.id === id ? { ...photo, assetId, status: 'processing' } : photo)))

      let lastError: unknown = null
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await fetch(buildApiUrl(`/media/assets/${assetId}`), {
          headers: {
            authorization: `Bearer ${token}`,
          },
        }).catch((error) => {
          lastError = error
          return null
        })

        if (response && response.ok) {
          const payload = await response.json().catch(() => ({}))
          const asset = payload?.asset
          if (asset?.status === 'ready') {
            const variantUrl = pickPhotoVariantUrl(asset.variants)
            if (!variantUrl) {
              throw new Error('variant_missing')
            }
            setPhotos((prev) => prev.map((photo) => (photo.id === id ? { ...photo, mediaUrl: variantUrl, status: 'ready' } : photo)))
            return
          }
          if (asset?.status === 'failed') {
            throw new Error(asset.failureReason ?? 'processing_failed')
          }
        }

        await wait(2000)
      }

      throw lastError ?? new Error('processing_timeout')
    } catch (error) {
      setPhotos((prev) =>
        prev.map((photo) =>
          photo.id === id ? { ...photo, status: 'error', error: error instanceof Error ? error.message : 'Upload failed' } : photo,
        ),
      )
    }
  }, [])

  const handlePhotoFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) return

    const files = Array.from(fileList)
    event.target.value = ''

    const remainingSlots = Math.max(0, MAX_CAUSE_IMAGES - photos.length)
    if (remainingSlots === 0) {
      pushToast(`You can add up to ${MAX_CAUSE_IMAGES} photos per cause.`, 'error')
      return
    }

    if (files.length > remainingSlots) {
      pushToast(`Only the first ${remainingSlots} photos were added. Causes support up to ${MAX_CAUSE_IMAGES} photos.`, 'error')
    }

    const newPhotos: PhotoItem[] = []

    for (const file of files.slice(0, remainingSlots)) {
      if (!ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
        pushToast(`Skipped ${file.name}: invalid file type.`, 'error')
        continue
      }

      if (file.size > PHOTO_MAX_BYTES) {
        pushToast(`Skipped ${file.name}: file too large (max 25MB).`, 'error')
        continue
      }

      try {
        const dimensions = await readImageDimensions(file)
        if (!dimensions) {
          pushToast(`Skipped ${file.name}: could not read image.`, 'error')
          continue
        }

        const megaPixels = (dimensions.width * dimensions.height) / 1_000_000
        if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION || megaPixels > MAX_IMAGE_MEGA_PIXELS) {
          pushToast(`Skipped ${file.name}: image resolution too high.`, 'error')
          continue
        }

        const id = Math.random().toString(36).slice(2)
        const previewUrl = URL.createObjectURL(file)
        newPhotos.push({ id, file, previewUrl, status: 'idle' })
      } catch {
        pushToast(`Skipped ${file.name}: error processing image.`, 'error')
      }
    }

    if (!newPhotos.length) return
    setPhotos((prev) => [...prev, ...newPhotos])
  }, [photos.length])

  useEffect(() => {
    photos.forEach((photo) => {
      if (photo.status === 'idle' && photo.file) {
        void startPhotoUpload(photo.id, photo.file)
      }
    })
  }, [photos, startPhotoUpload])

  const handleStoryChange = useCallback((value: string) => {
    const nextLength = stripHtml(value).length
    if (nextLength > STORY_MAX_LENGTH) return
    setForm((prev) => ({ ...prev, body: value }))
  }, [])

  const updateStageGoal = useCallback((goalId: string, updater: (goal: CauseStageGoalForm) => CauseStageGoalForm) => {
    setForm((prev) => ({
      ...prev,
      stageGoals: prev.stageGoals.map((goal) => (goal.id === goalId ? updater(goal) : goal)).map((goal, index) => ({ ...goal, sortOrder: index })),
    }))
  }, [])

  const persistDraft = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return false
    }
    if (!photosReady || hasPhotoUploadsInFlight) {
      pushToast('Please wait for photo uploads to finish before saving.', 'error')
      return false
    }

    setSaving(true)
    try {
      const [provinceCode, communitySlug] = form.communityKey ? form.communityKey.split(':') : [null, null]
      const response = await fetch(buildApiUrl(`/causes/drafts/${encodeURIComponent(draftId)}`), {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: form.title.trim() || 'Untitled Cause',
          body: form.body,
          mediaUrl: readyPhotoUrls[0] ?? null,
          images: readyPhotoUrls,
          goalAmountCents: totalGoalCents,
          stageGoals: form.stageGoals.map((goal, index) => ({
            id: goal.id,
            amountCents: Math.max(0, goal.amountCents),
            description: goal.description,
            sortOrder: index,
          })),
          provinceCode,
          communitySlug,
        }),
      })

      if (response.status === 401) {
        redirectToAuthModal('login')
        return false
      }
      const payload = (await response.json().catch(() => null)) as CauseDraftResponse | { error?: string; detail?: string } | null
      if (!response.ok) {
        if ((payload as { error?: string } | null)?.error === 'cause_body_too_long') {
          pushToast(`Story must be ${STORY_MAX_LENGTH.toLocaleString('en-CA')} characters or less.`, 'error')
        } else if ((payload as { error?: string; detail?: string } | null)?.error === 'cause_draft_save_failed') {
          const failure = payload as { error?: string; detail?: string } | null
          pushToast(failure?.detail ?? 'Cause draft save failed on the server.', 'error')
        }
        else {
          const failure = payload as { error?: string; detail?: string } | null
          pushToast(failure?.error ?? 'Unable to save this cause draft.', 'error')
        }
        return false
      }

      if ((payload as CauseDraftResponse | null)?.draft) {
        setLoadedDraft((payload as CauseDraftResponse).draft ?? null)
        setLoadedCause((payload as CauseDraftResponse).cause ?? loadedCause)
      }
      pushToast('Saved.', 'success')
      return true
    } catch {
        pushToast('Unable to save this cause draft.', 'error')
      return false
    } finally {
      setSaving(false)
    }
  }, [draftId, form.body, form.communityKey, form.stageGoals, form.title, hasPhotoUploadsInFlight, loadedCause, photosReady, readyPhotoUrls, totalGoalCents])

  const publishDraft = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    if (!form.title.trim()) {
      pushToast('Title is required.', 'error')
      return
    }
    if (storyPlainText.length < 30) {
      pushToast('Story must be at least 30 characters before publishing.', 'error')
      return
    }
    if (storyPlainText.length > STORY_MAX_LENGTH) {
      pushToast(`Story must be ${STORY_MAX_LENGTH.toLocaleString('en-CA')} characters or less.`, 'error')
      return
    }
    if (!photosReady || hasPhotoUploadsInFlight) {
      pushToast('Please wait for photo uploads to finish before publishing.', 'error')
      return
    }
    if (!form.communityKey) {
      pushToast('Choose a community before publishing.', 'error')
      return
    }
    if (totalGoalCents <= 0) {
      pushToast('Total funding goal must be greater than zero.', 'error')
      return
    }
    if (!form.stageGoals.length) {
      pushToast('Add at least one stage goal before publishing.', 'error')
      return
    }
    if (form.stageGoals.some((goal) => goal.amountCents <= 0 || !goal.description.trim())) {
      pushToast('Each stage goal needs an amount and description.', 'error')
      return
    }

    const saved = await persistDraft()
    if (!saved) return

    setSaving(true)
    try {
      const response = await fetch(buildApiUrl(`/causes/drafts/${encodeURIComponent(draftId)}/publish`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      const payload = (await response.json().catch(() => null)) as { error?: string; detail?: string; post?: { id: string; seoSlug?: string | null; provinceCode?: string | null; communitySlug?: string | null; author: { handle: string } } } | null
      if (!response.ok || !payload?.post) {
        if (payload?.error === 'cause_stage_goal_total_mismatch') {
          pushToast('Stage goals must total the full funding goal before publishing.', 'error')
        } else if (payload?.error === 'cause_stage_goals_required') {
          pushToast('Add at least one stage goal before publishing.', 'error')
        } else if (payload?.error === 'cause_body_too_long') {
          pushToast(`Story must be ${STORY_MAX_LENGTH.toLocaleString('en-CA')} characters or less.`, 'error')
        } else if (payload?.error === 'cause_publish_failed') {
          pushToast(payload.detail ?? 'Cause publish failed on the server.', 'error')
        } else {
          pushToast(payload?.error ?? 'Unable to publish this cause yet.', 'error')
        }
        return
      }

      pushToast('Cause published.', 'success')
      router.replace(buildCausePostHref(payload.post))
    } catch {
      pushToast('Unable to publish this cause yet.', 'error')
    } finally {
      setSaving(false)
    }
  }, [draftId, form.communityKey, form.stageGoals, form.title, hasPhotoUploadsInFlight, persistDraft, photosReady, router, storyPlainText.length, totalGoalCents])

  if (loading) {
    return (
      <DashboardShell rightRail={<RightRail mode="default" />}>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm text-sm text-slate-500">Loading cause draft…</section>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell rightRail={<RightRail mode="default" />} showMobileRightRail mainClassName="space-y-5 pb-12">
      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Manage Cause</h1>
              <p className="mt-1 text-sm text-slate-600">Draft the story, community, and funding stages before publishing this cause. Published causes can also be updated here.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                Status: {statusLabel}
              </span>
              <button
                type="button"
                disabled={saving || !statusCanEdit || hasPhotoUploadsInFlight}
                onClick={() => void persistDraft()}
                className="inline-flex items-center justify-center rounded-full bg-green-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {!loadedDraft?.publishedPostId ? (
                <button
                  type="button"
                  disabled={saving || !statusCanEdit || hasPhotoUploadsInFlight}
                  onClick={() => setPublishConfirmOpen(true)}
                  className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  Publish cause
                </button>
              ) : null}
            </div>
          </div>
          {loadedDraft?.publishedPostId ? <p className="mt-3 text-sm text-slate-600">Changes saved here will update the published cause and its funding goals.</p> : null}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="grid gap-5">
            <div className="grid gap-2">
              <label htmlFor="cause-title" className="text-sm font-semibold text-slate-800">Title</label>
              <input
                id="cause-title"
                type="text"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                disabled={!statusCanEdit}
                placeholder="What needs support?"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              />
            </div>

            <div className="grid gap-2">
              <label htmlFor="cause-community" className="text-sm font-semibold text-slate-800">Community</label>
              <select
                id="cause-community"
                value={form.communityKey}
                onChange={(event) => setForm((prev) => ({ ...prev, communityKey: event.target.value }))}
                disabled={!statusCanEdit}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              >
                <option value="">Select a followed community</option>
                {followOptions.map((option) => (
                  <option key={buildCommunityKey(option.provinceCode, option.communitySlug)} value={buildCommunityKey(option.provinceCode, option.communitySlug)}>
                    {option.label}
                  </option>
                ))}
              </select>
              {!followOptions.length ? <p className="text-xs text-amber-700">Follow or set a home community first before publishing causes into your community feed.</p> : null}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-semibold text-slate-800">Story</label>
              <RichTextEditor
                value={form.body}
                onChange={handleStoryChange}
                minHeight={220}
                placeholder="Explain what the cause funds, who it helps, and how each stage will be used."
                disabled={!statusCanEdit || saving}
              />
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{selectedCommunity ? `Publishing into ${selectedCommunity.label}` : 'Choose a community to publish this cause into the feed.'}</span>
                <span>{storyPlainText.length}/{STORY_MAX_LENGTH} characters</span>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Photos</p>
                  <p className="mt-1 text-xs text-slate-500">Add up to {MAX_CAUSE_IMAGES} photos to make the cause page and share preview more visual.</p>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!statusCanEdit || saving || photos.length >= MAX_CAUSE_IMAGES}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  <LuImagePlus className="h-4 w-4" />
                  Add Photos
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                className="hidden"
                multiple
                onChange={handlePhotoFile}
              />

              {photos.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {photos.map((photo) => (
                    <div
                      key={photo.id}
                      className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                    >
                      <img
                        src={photo.mediaUrl ?? photo.previewUrl}
                        alt="Cause upload"
                        className="h-full w-full object-cover"
                      />
                      {photo.status === 'uploading' || photo.status === 'processing' ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-semibold text-white">
                          {photo.status === 'uploading' ? 'Uploading...' : 'Processing...'}
                        </div>
                      ) : null}
                      {photo.status === 'error' ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-red-500/80 p-2 text-center text-xs font-semibold text-white">
                          {photo.error ?? 'Error'}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
                        onClick={() => {
                          revokePhotoPreview(photo.previewUrl)
                          setPhotos((prev) => prev.filter((item) => item.id !== photo.id))
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No photos added yet.
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>{readyPhotoUrls.length}/{Math.max(photos.length, readyPhotoUrls.length)} ready</span>
                {hasPhotoUploadsInFlight ? <span>Finishing uploads…</span> : null}
              </div>
              {hasPhotoUploadErrors ? <p className="text-xs text-red-600">Some photos failed to upload. Remove them or retry with new files before saving.</p> : null}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Funding Goals</h2>
              <p className="mt-1 text-sm text-slate-600">Build the total goal from staged funding milestones with descriptions.</p>
            </div>
            <button
              type="button"
              disabled={!statusCanEdit}
              onClick={() => setForm((prev) => ({
                ...prev,
                stageGoals: [...prev.stageGoals, { ...toStageGoalForm(createStageGoal()), sortOrder: prev.stageGoals.length }],
              }))}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              Add Goal
            </button>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Total Goal
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900">
                  {formatCurrency(totalGoalCents)}
                </div>
              </label>
              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Stage Goals Total
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900">
                  {formatCurrency(stageGoalTotalCents)}
                </div>
              </label>
              <div className="inline-flex items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                Auto-calculated
              </div>
            </div>
            {loadedCause ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-600">
                <span>Raised so far: {formatCurrency(loadedCause.raisedAmountCents)}</span>
                <span>Backers: {loadedCause.contributionCount}</span>
                {hasAnyGoalProgress ? <span>Goal order is locked once donations begin.</span> : null}
              </div>
            ) : null}
          </div>

          <div className="mt-5 space-y-3">
            {form.stageGoals.length ? (
              form.stageGoals.map((goal) => {
                const isDragOver = dragOverGoalId === goal.id && draggingGoalId && draggingGoalId !== goal.id
                const goalProgressEntry = goalProgressById[goal.id]
                const goalProgressCents = goalProgressEntry?.progressCents ?? 0
                const goalProgressPercent = goalProgressEntry?.progressPercent ?? 0
                const goalHasProgress = goalProgressCents > 0
                return (
                  <div
                    key={goal.id}
                    onDragOver={(event) => {
                      if (!statusCanEdit) return
                      event.preventDefault()
                      if (dragOverGoalId !== goal.id) setDragOverGoalId(goal.id)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (!draggingGoalId || draggingGoalId === goal.id) return
                      setForm((prev) => ({
                        ...prev,
                        stageGoals: reorderStageGoals(prev.stageGoals, draggingGoalId, goal.id),
                      }))
                      setDraggingGoalId(null)
                      setDragOverGoalId(null)
                    }}
                    className={clsx(
                      'rounded-2xl border bg-white p-4 transition',
                      isDragOver ? 'border-[var(--cc-primary)] shadow-sm' : 'border-slate-200',
                      draggingGoalId === goal.id ? 'opacity-70' : 'opacity-100',
                    )}
                  >
                    <div className="grid gap-4 md:grid-cols-[auto_220px_minmax(0,1fr)_auto] md:items-start">
                      <div className="pt-8">
                        <button
                          type="button"
                          draggable={statusCanEdit && !hasAnyGoalProgress}
                          onDragStart={() => {
                            if (!statusCanEdit || hasAnyGoalProgress) return
                            setDraggingGoalId(goal.id)
                            setDragOverGoalId(goal.id)
                          }}
                          onDragEnd={() => {
                            setDraggingGoalId(null)
                            setDragOverGoalId(null)
                          }}
                          disabled={!statusCanEdit || hasAnyGoalProgress}
                          aria-label="Drag to reorder goal"
                          className="inline-flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 active:cursor-grabbing disabled:cursor-default disabled:opacity-60"
                        >
                          <DragHandleIcon />
                        </button>
                      </div>
                      <label className="grid gap-2 text-sm font-semibold text-slate-800">
                        Goal Amount
                        <div className="flex min-h-[54px] overflow-hidden rounded-2xl border border-slate-200 bg-white focus-within:border-[var(--cc-primary)]">
                          <span className="inline-flex items-center border-r border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-500">$</span>
                          <input
                            type="text"
                            value={goal.amountInput}
                            onChange={(event) => updateStageGoal(goal.id, (current) => ({
                              ...current,
                              amountInput: sanitizeAmountInput(event.target.value),
                              amountCents: clampStageGoalAmount(parseGoalInputToCents(event.target.value), goalProgressCents),
                            }))}
                            onFocus={() => updateStageGoal(goal.id, (current) => ({
                              ...current,
                              amountInput: unformatAmountInput(current.amountInput),
                            }))}
                            onBlur={() => updateStageGoal(goal.id, (current) => ({
                              ...current,
                              amountInput: formatAmountInput(clampStageGoalAmount(current.amountCents, goalProgressCents)),
                              amountCents: clampStageGoalAmount(current.amountCents, goalProgressCents),
                            }))}
                            disabled={!statusCanEdit}
                            placeholder="0.00"
                            inputMode="decimal"
                            className="w-full border-0 bg-white px-4 py-3 text-sm text-slate-900 focus:outline-none disabled:opacity-60"
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                          <span>Max {formatCurrency(STAGE_GOAL_MAX_CENTS)}</span>
                          {goalHasProgress ? <span>Minimum locked at {formatCurrency(goalProgressCents)}</span> : null}
                        </div>
                      </label>
                      <label className="grid gap-2 text-sm font-semibold text-slate-800">
                        Goal Description
                        <div className="grid gap-1">
                          <textarea
                            value={goal.description}
                            onChange={(event) => updateStageGoal(goal.id, (current) => ({
                              ...current,
                              description: event.target.value.slice(0, GOAL_DESCRIPTION_MAX_LENGTH),
                            }))}
                            disabled={!statusCanEdit}
                            rows={3}
                            maxLength={GOAL_DESCRIPTION_MAX_LENGTH}
                            placeholder="What gets funded at this stage?"
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
                          />
                          <span className="text-right text-xs font-medium text-slate-500">{goal.description.length}/{GOAL_DESCRIPTION_MAX_LENGTH}</span>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                            <span>Goal progress</span>
                            <span>{formatCurrency(goalProgressCents)} / {formatCurrency(goal.amountCents)}</span>
                          </div>
                          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-[width]"
                              style={{ width: `${goalProgressPercent}%` }}
                            />
                          </div>
                        </div>
                      </label>
                      <div className="pt-8">
                        <button
                          type="button"
                          disabled={!statusCanEdit || goalHasProgress}
                          onClick={() => setForm((prev) => ({
                            ...prev,
                            stageGoals: prev.stageGoals.filter((item) => item.id !== goal.id).map((item, index) => ({ ...item, sortOrder: index })),
                          }))}
                          className="inline-flex shrink-0 items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                        >
                          {goalHasProgress ? 'In Progress' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                No stage goals yet. Add one to explain how the total funding goal is broken down.
              </div>
            )}
          </div>
        </section>
      </div>

      <Modal
        open={publishConfirmOpen}
        onClose={() => {
          if (!saving) setPublishConfirmOpen(false)
        }}
        title="Publish cause?"
        maxWidthClassName="max-w-md"
      >
        <div className="space-y-4 p-6">
          <p className="text-sm text-slate-600">This will publish the cause into the selected community feed and make it available for backing.</p>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p><span className="font-semibold text-slate-900">Total goal:</span> {formatCurrency(totalGoalCents)}</p>
            <p className="mt-1"><span className="font-semibold text-slate-900">Stage goals:</span> {formatCurrency(stageGoalTotalCents)}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPublishConfirmOpen(false)}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setPublishConfirmOpen(false)
                void publishDraft()
              }}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Publishing…' : 'Confirm publish'}
            </button>
          </div>
        </div>
      </Modal>
    </DashboardShell>
  )
}
