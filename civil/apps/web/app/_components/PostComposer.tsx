'use client'

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RichTextEditor from './RichTextEditor'
import clsx from 'clsx'
import type { Jurisdiction, ReactionType } from '@civil/shared'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl } from '../_lib/api'
import { pushToast } from './useToasts'

export type PostType = 'post' | 'article' | 'photo'
export type PostVisibility = 'public' | 'members'

const POST_TYPE_CHOICES: Array<{ type: PostType | 'poll' | 'link' | 'video'; label: string; icon: string; comingSoon?: boolean }> = [
  { type: 'post', label: 'Post', icon: '📝' },
  { type: 'article', label: 'Article', icon: '📄' },
  { type: 'poll', label: 'Poll', icon: '📊', comingSoon: true },
  { type: 'link', label: 'Link', icon: '🔗', comingSoon: true },
  { type: 'video', label: 'Video', icon: '🎥', comingSoon: true },
  { type: 'photo', label: 'Photos', icon: '📷' },
]

export type ApiPost = {
  id: string
  seoSlug: string | null
  type: PostType
  title?: string | null
  body: string
  mediaUrl?: string | null
  images?: string[] | null
  createdAt: string
  updatedAt: string
  jurisdiction: Jurisdiction
  provinceCode?: string | null
  provinceName?: string | null
  communitySlug?: string | null
  communityName?: string | null
  organization?: {
    id: string
    name: string
    slug: string
    isVerified: boolean
    logoUrl?: string | null
    coverUrl?: string | null
    provinceCode: string | null
    communitySlug: string | null
  } | null
  author: {
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
    coverUrl?: string | null
    isPremium?: boolean
    isVerified?: boolean
  }
  counts?: {
    commentCount: number
    reactions?: number
    recentPositive?: number
  }
  reactions?: {
    maple: number
    heart: number
    haha: number
    wow: number
    sad: number
    fire: number
    total: number
    positive: number
  }
  metrics?: {
    hotScore: number
  }
  viewer?: {
    reaction: ReactionType | null
  }
  sharedPost?: ApiPost | null
}

export type CommunityTarget = {
  provinceCode: string
  communitySlug: string
  communityName?: string | null
  provinceName?: string | null
  isHome?: boolean
}

type PostComposerProps = {
  me?: {
    id: string
    handle: string
    name?: string | null
    avatarUrl?: string | null
  } | null
  className?: string
  defaultPostType?: PostType
  communityTarget?: CommunityTarget | null
  communityOptions?: CommunityTarget[]
  businessTarget?: { businessId: string; businessName?: string | null } | null
  onPostCreated?: (post: ApiPost) => void
  variant?: 'card' | 'plain'
  defaultAudience?: 'friends' | 'network' | 'community' | 'business'
  hideAudience?: boolean
}

const MAX_POST_LENGTH = 5000
const MIN_ARTICLE_TITLE_LENGTH = 3
const MIN_ARTICLE_BODY_LENGTH = 100
const PHOTO_MAX_BYTES = 25 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')

const FRIENDS_VALUE = 'friends'
const NETWORK_VALUE = 'network'
const BUSINESS_VALUE = 'business'
const COMMUNITY_PREFIX = 'community:'
const COMMUNITY_PROMPT_VALUE = `${COMMUNITY_PREFIX}__prompt`

const buildCommunityKey = (target: CommunityTarget) => `${target.provinceCode}:${target.communitySlug}`
const buildCommunityValue = (target: CommunityTarget) => `${COMMUNITY_PREFIX}${buildCommunityKey(target)}`

const formatCommunityLabel = (target: CommunityTarget) => {
  const name = target.communityName ?? target.communitySlug
  const location = target.provinceCode?.toUpperCase() ?? target.provinceName ?? ''
  const suffix = target.isHome ? ' (Home)' : ''
  const locationLabel = location ? ` - ${location}` : ''
  return `${name}${locationLabel}${suffix}`
}

const deriveInitialAudienceSelection = (
  currentTarget: CommunityTarget | null,
  defaultAudience: 'friends' | 'network' | 'community' | 'business',
  options: CommunityTarget[],
  businessTarget: PostComposerProps['businessTarget'],
) => {
  if (businessTarget?.businessId) return BUSINESS_VALUE
  if (currentTarget) return buildCommunityValue(currentTarget)
  if (defaultAudience === 'community') {
    if (options.length === 1) {
      const firstOption = options[0]
      if (firstOption) {
        return buildCommunityValue(firstOption)
      }
    }
    return COMMUNITY_PROMPT_VALUE
  }
  if (defaultAudience === 'business') return BUSINESS_VALUE
  if (defaultAudience === 'network') return NETWORK_VALUE
  return FRIENDS_VALUE
}

export const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  self: 'Self',
  municipal: 'Municipal',
  provincial: 'Provincial',
  federal: 'Federal',
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const MAX_IMAGE_DIMENSION = 8000
const MAX_IMAGE_MEGA_PIXELS = 40

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

type PhotoItem = {
  id: string
  file?: File
  previewUrl: string
  assetId?: string | null
  mediaUrl?: string | null
  status: 'idle' | 'uploading' | 'processing' | 'ready' | 'error'
  error?: string | null
}

export default function PostComposer({
  className,
  defaultPostType = 'post',
  communityTarget = null,
  communityOptions = [],
  businessTarget = null,
  onPostCreated,
  variant = 'card',
  defaultAudience = 'friends',
  hideAudience = false,
}: PostComposerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [postType, setPostType] = useState<PostType>(defaultPostType)
  const [draft, setDraft] = useState('')
  const [articleTitle, setArticleTitle] = useState('')
  const [articleBody, setArticleBody] = useState('<p></p>')
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visibility, setVisibility] = useState<PostVisibility>('public')
  const normalizedCommunityOptions = useMemo(() => {
    return communityOptions.map((option) => ({
      ...option,
      communityName: option.communityName ?? option.communitySlug,
      provinceName: option.provinceName ?? option.provinceCode?.toUpperCase(),
    }))
  }, [communityOptions])

  const [audienceSelection, setAudienceSelection] = useState(() =>
    deriveInitialAudienceSelection(communityTarget, defaultAudience, normalizedCommunityOptions, businessTarget),
  )

  const articleBodyPlain = useMemo(() => stripHtml(articleBody), [articleBody])

  const audienceLocked = Boolean((communityTarget && !businessTarget?.businessId) || businessTarget?.businessId)
  const isPromptSelected = audienceSelection === COMMUNITY_PROMPT_VALUE
  const audienceBlocked = !communityTarget && isPromptSelected
  const activeCommunity = useMemo(() => {
    if (businessTarget?.businessId) return null
    if (communityTarget) return communityTarget
    if (!audienceSelection.startsWith(COMMUNITY_PREFIX) || isPromptSelected) return null
    const key = audienceSelection.slice(COMMUNITY_PREFIX.length)
    return normalizedCommunityOptions.find((option) => buildCommunityKey(option) === key) ?? null
  }, [audienceSelection, businessTarget, communityTarget, isPromptSelected, normalizedCommunityOptions])

  useEffect(() => {
    if (businessTarget?.businessId) {
      setAudienceSelection(BUSINESS_VALUE)
      return
    }
    if (communityTarget) {
      setAudienceSelection(buildCommunityValue(communityTarget))
      return
    }
    setAudienceSelection((prev) => {
      if (prev === COMMUNITY_PROMPT_VALUE && defaultAudience !== 'community') {
        return defaultAudience === 'network' ? NETWORK_VALUE : FRIENDS_VALUE
      }
      if (prev === COMMUNITY_PROMPT_VALUE && defaultAudience === 'community' && normalizedCommunityOptions.length === 1) {
        const firstOption = normalizedCommunityOptions[0]
        if (firstOption) {
          return buildCommunityValue(firstOption)
        }
      }
      if (prev.startsWith(COMMUNITY_PREFIX) && prev !== COMMUNITY_PROMPT_VALUE) {
        const key = prev.slice(COMMUNITY_PREFIX.length)
        const match = normalizedCommunityOptions.some((option) => buildCommunityKey(option) === key)
        if (!match) {
          if (defaultAudience === 'community' && normalizedCommunityOptions.length === 1) {
            const firstOption = normalizedCommunityOptions[0]
            if (firstOption) {
              return buildCommunityValue(firstOption)
            }
          }
          return defaultAudience === 'network' ? NETWORK_VALUE : FRIENDS_VALUE
        }
      }
      return prev
    })
  }, [businessTarget, communityTarget, defaultAudience, normalizedCommunityOptions])

  const startPhotoUpload = useCallback(async (id: string, file: File) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'uploading', error: null } : p)))
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'error', error: 'Sign in to upload a photo.' } : p)),
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

        // Avoid Mixed Content errors
        if (typeof window !== 'undefined' && window.location.protocol === 'https:' && upload.url.startsWith('http:')) {
          console.warn('Skipping direct upload due to protocol mismatch (Mixed Content)')
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

      console.log('Starting upload for', id, 'direct:', !!upload.url, 'proxy:', !!proxyPath)
      const directOk = upload.url
        ? await tryDirect().catch((e) => {
            console.warn('Direct upload failed', e)
            return false
          })
        : false

      if (directOk) console.log('Direct upload succeeded')
      else console.log('Direct upload skipped or failed, trying proxy')

      const proxyOk = directOk
        ? true
        : await tryProxy().catch((e) => {
            console.warn('Proxy upload failed', e)
            return false
          })

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

      setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, assetId, status: 'processing' } : p)))

      let lastError: unknown = null
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const res = await fetch(buildApiUrl(`/media/assets/${assetId}`), {
          headers: {
            authorization: `Bearer ${token}`,
          },
        }).catch((err) => {
          lastError = err
          return null
        })

        if (res && res.ok) {
          const payload = await res.json().catch(() => ({}))
          const asset = payload?.asset
          if (asset?.status === 'ready') {
            const variantUrl = pickPhotoVariantUrl(asset.variants)
            if (!variantUrl) {
              throw new Error('variant_missing')
            }
            setPhotos((prev) =>
              prev.map((p) => (p.id === id ? { ...p, mediaUrl: variantUrl, status: 'ready' } : p)),
            )
            return
          }
          if (asset?.status === 'failed') {
            throw new Error(asset.failureReason ?? 'processing_failed')
          }
        }
        await wait(2000)
      }

      throw lastError ?? new Error('processing_timeout')
    } catch (err) {
      console.error('Photo upload failed', err)
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' } : p,
        ),
      )
    }
  }, [])

  const canSubmit = useMemo(() => {
    if (postType === 'photo') {
      const captionOk = draft.trim().length <= MAX_POST_LENGTH
      const photosOk = photos.length > 0 && photos.every((p) => p.status === 'ready')
      return photosOk && captionOk && !submitting
    }
    if (postType === 'post') {
      const trimmed = draft.trim()
      return trimmed.length > 0 && trimmed.length <= MAX_POST_LENGTH
    }

    const titleOk = articleTitle.trim().length >= MIN_ARTICLE_TITLE_LENGTH
    const bodyOk = articleBodyPlain.length >= MIN_ARTICLE_BODY_LENGTH
    return titleOk && bodyOk
  }, [articleBodyPlain, articleTitle, draft, photos, postType, submitting])

  const resetComposer = useCallback(() => {
    setDraft('')
    setArticleTitle('')
    setArticleBody('<p></p>')
    setPostType(defaultPostType)
    setAudienceSelection(deriveInitialAudienceSelection(communityTarget, defaultAudience, normalizedCommunityOptions, businessTarget))
    setVisibility('public')
    setError(null)
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    setPhotos([])
  }, [businessTarget, communityTarget, defaultAudience, defaultPostType, normalizedCommunityOptions, photos])

  const submitPost = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!canSubmit || submitting) return

    if (!communityTarget && audienceSelection.startsWith(COMMUNITY_PREFIX) && !activeCommunity) {
      setError('Pick a community to publish to the community feed.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = (() => {
        if (postType === 'photo') {
          const mediaUrl = photos[0]?.mediaUrl
          const images = photos.map((p) => p.mediaUrl).filter(Boolean)
          return { type: 'photo', body: draft.trim(), mediaUrl, images }
        }
        if (postType === 'post') {
          return { type: 'post', body: draft }
        }
        return { type: 'article', title: articleTitle.trim(), body: articleBody }
      })()

      const targetCommunity = communityTarget ?? activeCommunity
      if (targetCommunity) {
        payload.communityProvince = targetCommunity.provinceCode
        payload.communitySlug = targetCommunity.communitySlug
      }
      payload.audience = targetCommunity
        ? 'community'
        : businessTarget?.businessId
          ? 'organization'
          : audienceSelection === NETWORK_VALUE
            ? 'network'
            : 'friends'
      payload.jurisdiction = targetCommunity ? 'municipal' : 'self'

      if (businessTarget?.businessId) {
        payload.businessId = businessTarget.businessId
        payload.visibility = visibility
      }

      const res = await fetch(buildApiUrl('/posts'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)

        const normalizeError = (value: unknown): string | null => {
          if (!value) return null
          if (typeof value === 'string') return value
          if (Array.isArray(value)) {
            const joined = value.map((item) => normalizeError(item)).filter(Boolean).join(' ')
            return joined.length ? joined : null
          }
          if (typeof value === 'object') {
            const parts = Object.values(value as Record<string, unknown>)
            const joined = parts.map((item) => normalizeError(item)).filter(Boolean).join(' ')
            return joined.length ? joined : null
          }
          return String(value)
        }

        const friendlyError = normalizeError((data as any)?.error) ?? normalizeError((data as any)?.message)
        setError(friendlyError ?? 'Unable to publish right now. Please try again.')
        return
      }

      const post = (await res.json()) as ApiPost
      onPostCreated?.(post)
      resetComposer()
    } finally {
      setSubmitting(false)
    }
  }, [activeCommunity, articleBody, articleTitle, audienceSelection, businessTarget, canSubmit, communityTarget, draft, onPostCreated, photos, postType, resetComposer, submitting, visibility])

  const handlePhotoFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files
      if (!fileList || fileList.length === 0) return

      // Convert to array to persist files after clearing input
      const files = Array.from(fileList)

      // Clear input immediately so change event fires even if same file selected again
      event.target.value = ''

      const newPhotos: PhotoItem[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (!file) continue

        if (!ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
          console.warn('Invalid file type:', file.type)
          pushToast(`Skipped ${file.name}: Invalid file type.`, 'error')
          continue
        }

        if (file.size > PHOTO_MAX_BYTES) {
          console.warn('File too large:', file.size)
          pushToast(`Skipped ${file.name}: File too large (max 25MB).`, 'error')
          continue
        }

        try {
          const dims = await readImageDimensions(file)
          if (!dims) {
            console.warn('Could not read dimensions')
            pushToast(`Skipped ${file.name}: Could not read image.`, 'error')
            continue
          }
          const megaPixels = (dims.width * dims.height) / 1_000_000
          if (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION || megaPixels > MAX_IMAGE_MEGA_PIXELS) {
            console.warn('Image too large dimensions')
            pushToast(`Skipped ${file.name}: Image resolution too high.`, 'error')
            continue
          }

          const id = Math.random().toString(36).slice(2)
          const previewUrl = URL.createObjectURL(file)
          newPhotos.push({ id, file, previewUrl, status: 'idle' })
        } catch (e) {
          console.error('Error processing image', e)
          pushToast(`Skipped ${file.name}: Error processing image.`, 'error')
        }
      }

      if (newPhotos.length === 0) {
        return
      }

      setPhotos((prev) => [...prev, ...newPhotos])
    },
    [],
  )

  useEffect(() => {
    photos.forEach((p) => {
      if (p.status === 'idle' && p.file) {
        startPhotoUpload(p.id, p.file)
      }
    })
  }, [photos, startPhotoUpload])

  // Keep track of photos for cleanup on unmount
  const photosRef = useRef(photos)
  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(() => {
    return () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
  }, [])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return
      if (!(event.ctrlKey || event.metaKey)) return
      if (!containerRef.current) return
      const target = event.target as Node | null
      if (!target || !containerRef.current.contains(target)) return
      if (!canSubmit || submitting) return
      event.preventDefault()
      void submitPost()
    }

    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [canSubmit, submitPost, submitting])

  const containerClasses = clsx(
    'flex flex-col gap-4',
    variant === 'card' ? 'surface-card px-6 py-5 shadow-panel' : '',
    className,
  )

  const handleComingSoon = useCallback((label: string) => {
    pushToast(`${label} creation is coming soon.`, 'info')
  }, [])

  const showCommunityWarning = !communityTarget && !normalizedCommunityOptions.length

  return (
    <section ref={containerRef} className={containerClasses}>
      <header className={clsx('flex flex-col gap-4', !hideAudience && 'lg:flex-row lg:items-start lg:justify-between')}>
        {!hideAudience ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Audience</span>
            <select
              className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 focus:border-[var(--cc-primary)] focus:outline-none"
              value={businessTarget?.businessId ? BUSINESS_VALUE : audienceLocked && activeCommunity ? buildCommunityValue(activeCommunity) : audienceSelection}
              onChange={(event) => setAudienceSelection(event.target.value)}
              disabled={audienceLocked}
            >
              {businessTarget?.businessId ? (
                <option value={BUSINESS_VALUE}>{businessTarget.businessName ?? 'Organization'}</option>
              ) : (
                <>
                  <option value={NETWORK_VALUE}>Network</option>
                  <option value={FRIENDS_VALUE}>Friends</option>
                  {!communityTarget && isPromptSelected ? (
                    <option value={COMMUNITY_PROMPT_VALUE} hidden disabled>
                      Select a community
                    </option>
                  ) : null}
                  {communityTarget ? (
                    <option value={buildCommunityValue(communityTarget)}>{formatCommunityLabel(communityTarget)}</option>
                  ) : null}
                  {!communityTarget
                    ? normalizedCommunityOptions.map((option) => (
                        <option key={buildCommunityKey(option)} value={buildCommunityValue(option)}>
                          {formatCommunityLabel(option)}
                        </option>
                      ))
                    : null}
                </>
              )}
            </select>
            {showCommunityWarning ? (
              <p className="text-xs text-slate-500">Follow a community to publish in its public feed.</p>
            ) : null}
            {!businessTarget?.businessId && isPromptSelected ? (
              <p className="text-xs text-amber-600">Pick a community to share this post publicly.</p>
            ) : null}
            {businessTarget?.businessId ? (
              <p className="text-xs text-slate-500">Posting to {businessTarget.businessName ?? 'this organization'}</p>
            ) : null}
            {activeCommunity && !audienceLocked && !isPromptSelected ? (
              <p className="text-xs text-slate-500">
                Posting to {activeCommunity.communityName ?? activeCommunity.communitySlug}
              </p>
            ) : null}
          </div>
        ) : null}

        {businessTarget?.businessId ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Visibility</span>
            <div className="flex w-full max-w-full items-center gap-1 overflow-x-auto rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                className={clsx(
                  'shrink-0 whitespace-nowrap rounded-full px-4 py-1 transition',
                  visibility === 'public' ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500',
                )}
                onClick={() => setVisibility('public')}
                disabled={submitting}
              >
                Public
              </button>
              <button
                type="button"
                className={clsx(
                  'shrink-0 whitespace-nowrap rounded-full px-4 py-1 transition',
                  visibility === 'members' ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500',
                )}
                onClick={() => setVisibility('members')}
                disabled={submitting}
              >
                Members only
              </button>
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Type</span>
          <div className="flex w-full max-w-full items-center gap-1 overflow-x-auto rounded-full bg-slate-100 p-1 text-sm font-semibold text-slate-500 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {POST_TYPE_CHOICES.map((choice) => {
            const isActive = !choice.comingSoon && postType === choice.type
            const isComingSoon = Boolean(choice.comingSoon)
            return (
              <button
                key={choice.type}
                type="button"
                className={clsx(
                  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1 transition',
                  isActive ? 'bg-white text-[var(--cc-primary)] shadow-subtle' : 'text-slate-500',
                  isComingSoon ? 'text-slate-400 hover:text-slate-500' : '',
                )}
                onClick={() =>
                  isComingSoon ? handleComingSoon(choice.label) : setPostType(choice.type as PostType)
                }
                disabled={submitting}
              >
                <span role="img" aria-label={choice.label}>
                  {choice.icon}
                </span>
                {choice.label}
              </button>
            )
          })}
          </div>
        </div>
      </header>

      <div className="space-y-4">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {postType === 'post' ? (
          <div className="space-y-2">
            <textarea
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base leading-6 text-slate-800 placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:bg-white focus:outline-none focus:ring-0"
              placeholder="Share something"
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_POST_LENGTH}
              disabled={submitting}
            />
            <div className="flex items-center justify-end text-xs text-slate-500">
              <span>
                {draft.trim().length}/{MAX_POST_LENGTH}
              </span>
            </div>
          </div>
        ) : postType === 'article' ? (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-semibold text-slate-600" htmlFor="article-title">
                Headline
              </label>
              <input
                id="article-title"
                type="text"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 shadow-inner"
                placeholder="Give readers a headline"
                value={articleTitle}
                onChange={(e) => setArticleTitle(e.target.value)}
                maxLength={160}
                disabled={submitting}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-600">Story</label>
              <RichTextEditor
                value={articleBody}
                onChange={setArticleBody}
                placeholder="Share something"
                minHeight={260}
                disabled={submitting}
              />
              <div className="mt-1 flex justify-between text-xs text-slate-500">
                <span>Articles support rich formatting powered by Summernote.</span>
                <span>{articleBodyPlain.length}/10000</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <p className="text-sm text-slate-600">Add photos and an optional caption.</p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={submitting}
                >
                  {photos.length > 0 ? 'Add more photos' : 'Upload photos'}
                </button>
              </div>

              {photos.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {photos.map((photo) => (
                    <div
                      key={photo.id}
                      className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.mediaUrl ?? photo.previewUrl}
                        alt="Post upload"
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
                          URL.revokeObjectURL(photo.previewUrl)
                          setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="h-4 w-4"
                        >
                          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                className="hidden"
                multiple
                onChange={handlePhotoFile}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-600" htmlFor="photo-caption">
                Caption (optional)
              </label>
              <textarea
                id="photo-caption"
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base leading-6 text-slate-800 placeholder:text-slate-400 focus:border-[var(--cc-primary)] focus:bg-white focus:outline-none focus:ring-0"
                placeholder="Share something"
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MAX_POST_LENGTH}
                disabled={submitting}
              />
              <div className="flex items-center justify-end text-xs text-slate-500">
                <span>
                  {draft.trim().length}/{MAX_POST_LENGTH}
                </span>
              </div>
            </div>
            {photos.some((p) => p.status === 'error') ? (
              <p className="text-xs text-red-600">Some photos failed to upload.</p>
            ) : null}
          </div>
        )}

        <div className="flex items-center justify-end">
          <button
            className="rounded-full bg-[var(--cc-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={submitPost}
            disabled={!canSubmit || submitting || audienceBlocked}
          >
            {submitting ? 'Publishing…' : postType === 'article' ? 'Publish article' : 'Post'}
          </button>
        </div>
      </div>
    </section>
  )
}
