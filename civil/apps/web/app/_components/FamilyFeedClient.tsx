'use client'

import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import CivilPost from './CivilPost'
import CivilComposerShell from './CivilComposerShell'
import CivilComposerLauncher from './CivilComposerLauncher'
import DashboardShell from './DashboardShell'
import Modal from './Modal'
import { RightRail } from './RightRail'
import VerifiedAvatar from './VerifiedAvatar'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildFamilyAvatarDataUrl } from '../_lib/familyIdentity'
import { useViewerStore } from '../_lib/viewerStore'
import { pushToast } from './useToasts'

type FamilyFeedPost = {
  id: string
  body: string
  images: string[]
  createdAt: string
  updatedAt: string
  author: {
    id: string
    handle: string
    name: string
    avatarUrl?: string | null
    coverUrl?: string | null
    badgeLabel: string
  }
  target: {
    id: string
    name: string
    relationshipLabel: string
    modeBand: 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
    modeLabel: string
  }
}

type FamilyFeedResponse = {
  items?: FamilyFeedPost[]
}

type PhotoItem = {
  id: string
  file?: File
  previewUrl: string
  mediaUrl?: string | null
  assetId?: string | null
  status: 'idle' | 'uploading' | 'processing' | 'ready' | 'error'
  error?: string | null
}

const PHOTO_MAX_BYTES = 25 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const MAX_IMAGE_DIMENSION = 8000
const MAX_IMAGE_MEGA_PIXELS = 40

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

function formatFamilyFeedDate(isoString: string) {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return 'Just now'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

type FamilyFeedClientProps = {
  memberId?: string | null
  memberDisplayName?: string
  memberModeBand?: 'EARLY_CHILDHOOD' | 'JUNIOR' | 'TEEN' | 'YOUTH' | 'ADULT'
  memberAvatarUrl?: string | null
  title?: string
  description?: string
  emptyState?: string
  readOnly?: boolean
  headerContent?: ReactNode
  rightRail?: ReactNode
}

export default function FamilyFeedClient({
  memberId,
  memberDisplayName,
  memberModeBand,
  memberAvatarUrl,
  title = 'Family Feed',
  description = 'Share stories with your friends and parents!',
  emptyState = 'The Family Feed is quiet right now. Share a quick update or add a photo to get started.',
  readOnly = false,
  headerContent,
  rightRail,
}: FamilyFeedClientProps) {
  const viewer = useViewerStore((s) => s.me)
  const viewerHydrated = useViewerStore((s) => s.hydrated)
  const familyView = useViewerStore((s) => s.familyView)
  const familyViewHydrated = useViewerStore((s) => s.familyViewHydrated)
  const [posts, setPosts] = useState<FamilyFeedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [composerText, setComposerText] = useState('')
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const familyDisplayName = memberDisplayName ?? familyView?.displayName ?? viewer?.name ?? 'Family member'
  const familyModeBand = memberModeBand ?? familyView?.modeBand ?? 'JUNIOR'
  const effectiveMemberId = memberId ?? familyView?.memberId ?? null
  const composerDisplayName = viewer?.name?.trim() || viewer?.handle || 'You'
  const avatarSrc = viewer?.avatarUrl ?? buildFamilyAvatarDataUrl(composerDisplayName, familyModeBand)
  const composerActions = [
    { type: 'post', label: 'Post', icon: '📝' },
    { type: 'photo', label: 'Photos', icon: '📷' },
  ]
  const readyImages = useMemo(() => photos.map((photo) => photo.mediaUrl).filter((value): value is string => Boolean(value)), [photos])
  const canSubmit = !readOnly && (composerText.trim().length > 0 || readyImages.length > 0) && !submitting && !uploading

  const loadFeed = useCallback(async () => {
    if (!viewerHydrated || !familyViewHydrated) return

    if (viewer?.accountType !== 'family_member' && !effectiveMemberId) {
      setPosts([])
      setLoading(false)
      return
    }

    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setLoading(true)
    try {
      const searchParams = new URLSearchParams()
      if (effectiveMemberId) searchParams.set('memberId', effectiveMemberId)
      const response = await fetch(buildApiUrl(`/family/feed/posts${searchParams.toString() ? `?${searchParams.toString()}` : ''}`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }
      if (!response.ok) {
        throw new Error('family_feed_load_failed')
      }
      const payload = (await response.json().catch(() => null)) as FamilyFeedResponse | null
      setPosts(Array.isArray(payload?.items) ? payload.items : [])
    } catch (error) {
      console.error('Failed to load family feed', error)
      pushToast('Unable to load the Family Feed right now.', 'error')
      setPosts([])
    } finally {
      setLoading(false)
    }
  }, [effectiveMemberId, familyViewHydrated, viewer?.accountType, viewerHydrated])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  const startPhotoUpload = useCallback(async (id: string, file: File) => {
    setUploading(true)
    setPhotos((prev) => prev.map((photo) => (photo.id === id ? { ...photo, status: 'uploading', error: null } : photo)))
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      setUploading(false)
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
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'upload_init_failed')
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
        const res = await fetch(upload.url, {
          method: upload.method || 'PUT',
          headers: upload.headers,
          body: file,
        })
        return res.ok
      }

      const tryProxy = async () => {
        if (!proxyPath) return false
        const res = await fetch(buildApiUrl(proxyPath), {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': file.type || 'application/octet-stream',
            'x-upload-byte-size': String(file.size),
          },
          body: file,
        })
        return res.ok
      }

      const directOk = upload.url ? await tryDirect().catch(() => false) : false
      const proxyOk = directOk ? true : await tryProxy().catch(() => false)
      if (!directOk && !proxyOk) throw new Error('upload_failed')

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

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const res = await fetch(buildApiUrl(`/media/assets/${assetId}`), {
          headers: { authorization: `Bearer ${token}` },
        }).catch(() => null)

        if (res?.ok) {
          const payload = await res.json().catch(() => ({}))
          const asset = payload?.asset
          if (asset?.status === 'ready') {
            const variantUrl = pickPhotoVariantUrl(asset.variants)
            if (!variantUrl) throw new Error('variant_missing')
            setPhotos((prev) => prev.map((photo) => (photo.id === id ? { ...photo, mediaUrl: variantUrl, status: 'ready' } : photo)))
            setUploading(false)
            return
          }
          if (asset?.status === 'failed') {
            throw new Error(asset.failureReason ?? 'processing_failed')
          }
        }

        await wait(1000)
      }

      throw new Error('processing_timeout')
    } catch (error) {
      console.error('Family feed upload failed', error)
      setPhotos((prev) => prev.map((photo) => (photo.id === id ? { ...photo, status: 'error', error: error instanceof Error ? error.message : 'Upload failed' } : photo)))
      pushToast('Unable to upload that photo right now.', 'error')
    } finally {
      setUploading(false)
    }
  }, [])

  const handlePhotoSelect = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    event.target.value = ''

    const newPhotos: PhotoItem[] = []
    for (const file of files) {
      if (!ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
        pushToast(`Skipped ${file.name}: invalid file type.`, 'error')
        continue
      }
      if (file.size > PHOTO_MAX_BYTES) {
        pushToast(`Skipped ${file.name}: file too large.`, 'error')
        continue
      }
      const dims = await readImageDimensions(file)
      if (!dims) {
        pushToast(`Skipped ${file.name}: image could not be read.`, 'error')
        continue
      }
      const megaPixels = (dims.width * dims.height) / 1_000_000
      if (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION || megaPixels > MAX_IMAGE_MEGA_PIXELS) {
        pushToast(`Skipped ${file.name}: image resolution too high.`, 'error')
        continue
      }

      const id = Math.random().toString(36).slice(2)
      newPhotos.push({ id, file, previewUrl: URL.createObjectURL(file), status: 'idle' })
    }

    if (!newPhotos.length) return
    setPhotos((prev) => [...prev, ...newPhotos])
  }, [])

  useEffect(() => {
    photos.forEach((photo) => {
      if (photo.status === 'idle' && photo.file) {
        void startPhotoUpload(photo.id, photo.file)
      }
    })
  }, [photos, startPhotoUpload])

  useEffect(() => {
    return () => {
      photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
    }
  }, [photos])

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const next = prev.filter((photo) => photo.id !== id)
      const removed = prev.find((photo) => photo.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return next
    })
  }, [])

  const submitUpdate = useCallback(async () => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return false
    }
    if (!canSubmit) return false

    setSubmitting(true)
    try {
      const response = await fetch(buildApiUrl('/family/feed/posts'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          memberId: effectiveMemberId ?? undefined,
          body: composerText.trim(),
          images: readyImages,
        }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string; post?: FamilyFeedPost } | null
      if (!response.ok || !payload?.post) {
        pushToast(payload?.error ?? 'Unable to share that update right now.', 'error')
        return false
      }

      setPosts((prev) => [payload.post!, ...prev])
      setComposerText('')
      photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
      setPhotos([])
      return true
    } catch (error) {
      console.error('Failed to create family feed post', error)
      pushToast('Unable to share that update right now.', 'error')
      return false
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, composerText, effectiveMemberId, photos, readyImages])

  return (
    <DashboardShell rightRail={rightRail ?? <RightRail sticky={false} />} mainClassName="min-w-0 space-y-6">
      {headerContent ? <div>{headerContent}</div> : null}

      {!readOnly ? (
        <CivilComposerLauncher
          coverUrl={viewer?.coverUrl ?? null}
          avatarSrc={avatarSrc}
          avatarAlt={composerDisplayName}
          avatarInitials={composerDisplayName}
          avatarHref={viewer?.handle ? `/u/${viewer.handle}` : undefined}
          prompt={`What's on your mind, ${composerDisplayName.split(' ')[0] ?? 'there'}?`}
          actions={composerActions}
          onPrimaryClick={() => setComposerOpen(true)}
          onActionClick={() => setComposerOpen(true)}
        />
      ) : null}

      <Modal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Share Family update"
        maxWidthClassName="max-w-3xl"
        closeOnBackdrop={false}
        closeOnEscape={false}
      >
        <CivilComposerShell bodyClassName="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex items-start gap-3">
              <VerifiedAvatar src={avatarSrc} alt={composerDisplayName} initials={composerDisplayName} size={52} className="shrink-0" />
              <div className="min-w-0 flex-1 space-y-3">
                <textarea
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value.slice(0, 2000))}
                  placeholder="Share an update with your family..."
                  className="min-h-[120px] w-full resize-none rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[var(--cc-primary)] focus:ring-2 focus:ring-[var(--cc-primary)]/10"
                />
                {photos.length ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {photos.map((photo) => (
                      <div key={photo.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        <div className="aspect-[4/3] bg-slate-100">
                          <img src={photo.mediaUrl ?? photo.previewUrl} alt="Family feed upload" className="h-full w-full object-cover" />
                        </div>
                        <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                          <span className={clsx(
                            'font-semibold',
                            photo.status === 'ready' ? 'text-emerald-600' : photo.status === 'error' ? 'text-red-600' : 'text-slate-500',
                          )}>
                            {photo.status === 'ready' ? 'Ready' : photo.status === 'error' ? 'Failed' : photo.status === 'processing' ? 'Processing...' : 'Uploading...'}
                          </span>
                          <button type="button" className="font-semibold text-slate-500 hover:text-slate-900" onClick={() => removePhoto(photo.id)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                    >
                      Add photos
                    </button>
                    <span className="text-xs text-slate-500">{composerText.trim().length}/2000</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void submitUpdate().then((success) => {
                        if (success) setComposerOpen(false)
                      })
                    }}
                    disabled={!canSubmit}
                    className="inline-flex items-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? 'Sharing...' : 'Share update'}
                  </button>
                </div>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES} multiple className="hidden" onChange={handlePhotoSelect} />
          </div>
        </CivilComposerShell>
      </Modal>

      <div className="space-y-4">
        {loading ? (
          <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">Loading the Family Feed…</section>
        ) : posts.length === 0 ? (
          <section className="surface-card px-6 py-8 text-center text-sm text-slate-500">
            {emptyState}
          </section>
        ) : (
          posts.map((post) => (
            <CivilPost
              key={post.id}
              name={post.author.name}
              subtitle={formatFamilyFeedDate(post.createdAt)}
              details={
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white/85">
                  <span className="rounded-full border border-white/35 px-2 py-0.5 uppercase tracking-wide text-white/85">
                    {post.author.badgeLabel}
                  </span>
                  <span className="rounded-full border border-white/35 px-2 py-0.5 text-white/85">
                    {post.images.length ? 'Photo' : 'Update'}
                  </span>
                </div>
              }
              avatarAlt={post.author.name}
              avatarInitials={post.author.name}
              avatarSrc={post.author.avatarUrl ?? undefined}
              coverUrl={post.author.coverUrl ?? undefined}
              body={post.body || undefined}
              images={post.images}
            />
          ))
        )}
      </div>
    </DashboardShell>
  )
}