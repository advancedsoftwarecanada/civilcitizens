"use client"

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildHandleBase, MediaCategory } from '@civil/shared'
import { Area } from 'react-easy-crop'
import { HiOutlineMagnifyingGlass } from 'react-icons/hi2'
import CivilCard from '../_components/CivilCard'
import Sidebar from '../_components/Sidebar'
import RichTextEditor from '../_components/RichTextEditor'
import { pushToast } from '../_components/useToasts'
import { redirectToAuthModal } from '../_lib/authModal'
import { clearAuthSession } from '../_lib/authSession'
import { buildApiUrl } from '../_lib/api'
import { COUNTRY_OPTIONS } from '../_lib/countries'
import { hasHomeCommunity, type CivicStatusValue, type WorkAuthorizationValue } from '../_lib/me'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureViewerMe } from '../_lib/viewerMe'
import DashboardShell from '../_components/DashboardShell'
import PhotoUpdateModal from '../_components/PhotoUpdateModal'

type Viewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  civicStatus?: CivicStatusValue | null
  workAuthorization?: WorkAuthorizationValue | null
  statusUpdatedAt?: string | null
  isVerified?: boolean
  isPremium?: boolean
  premiumSince?: string | null
  premiumRenewsAt?: string | null
}

type ExperienceResponse = {
  id: string
  title: string
  organization: string
  organizationProfile?: {
    id: string
    name: string
    slug: string
    provinceCode: string
    communitySlug: string
    logoUrl: string | null
    coverUrl: string | null
  } | null
  location: string | null
  startDate: string
  endDate: string | null
  current: boolean
  description: string | null
}

type ProfileResponse = {
  user: {
    id: string
    email: string
    handle: string
    firstName: string
    lastName: string
    name?: string | null
    bio: string
    avatarUrl?: string | null
    coverUrl?: string | null
    avatarMediaId?: string | null
    coverMediaId?: string | null
    avatarPostId?: string | null
    coverPostId?: string | null
    dateOfBirth?: string | null
    countryOfBirth?: string | null
    shareDateOfBirth?: boolean
    shareCountryOfBirth?: boolean
    createdAt?: string | null
    experiences?: ExperienceResponse[]
  }
  stats: {
    friends: number
    connections: number
    communitiesFollowing: number
  }
  homeChamber?: {
    provinceCode: string
    provinceName?: string | null
    chamberSlug: string
    chamberName?: string | null
  } | null
}

type ExperienceFormState = {
  key: string
  title: string
  organization: string
  location: string
  startDate: string
  endDate: string
  current: boolean
  description: string
}

type OrganizationDirectoryResult = {
  id: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  logoUrl: string | null
  coverUrl: string | null
}

type ExperienceLocationSelection =
  | {
      kind: 'community'
      provinceCode: string
      communitySlug: string
      label: string
    }
  | {
      kind: 'special'
      value: 'remote' | 'not_in_canada'
      label: string
    }

type CommunityLocationSearchResult = {
  provinceCode: string
  communitySlug: string
  label: string
}

type ProfileMediaCategory = Extract<MediaCategory, 'avatar' | 'cover'>

type MediaSlotState = {
  currentId: string | null
  pendingId: string | null
  processingId: string | null
  serverUrl: string | null
  previewUrl: string | null
  status: 'idle' | 'uploading' | 'processing' | 'ready' | 'error'
  error: string | null
}

const createMediaState = (): MediaSlotState => ({
  currentId: null,
  pendingId: null,
  processingId: null,
  serverUrl: null,
  previewUrl: null,
  status: 'idle',
  error: null,
})

type PhotoDraftState = {
  file: File | null
  previewUrl: string | null
  crop: { x: number; y: number }
  zoom: number
  croppedAreaPixels: Area | null
  isDirty: boolean
  fullAssetId: string | null
}

const createPhotoDraftState = (): PhotoDraftState => ({
  file: null,
  previewUrl: null,
  crop: { x: 0, y: 0 },
  zoom: 1,
  croppedAreaPixels: null,
  isDirty: false,
  fullAssetId: null,
})

const MB = 1024 * 1024
const MEDIA_LIMITS: Record<ProfileMediaCategory, number> = {
  avatar: 8 * MB,
  cover: 20 * MB,
}
const MEDIA_LABELS: Record<ProfileMediaCategory, string> = {
  avatar: 'profile photo',
  cover: 'cover photo',
}
const MEDIA_CATEGORY_LIMITS: Record<MediaCategory, number> = {
  avatar: MEDIA_LIMITS.avatar,
  cover: MEDIA_LIMITS.cover,
  business_logo: 8 * MB,
  business_cover: 20 * MB,
  post_image: 25 * MB,
  attachment: 40 * MB,
}
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const VARIANT_PRIORITY: Record<ProfileMediaCategory, string[]> = {
  avatar: ['avatar@2x', 'avatar@1x', 'avatar-thumb'],
  cover: ['cover-xl', 'cover-lg', 'cover-md'],
}
const AVATAR_EXPORT_SIZE = 1024
const COVER_EXPORT_WIDTH = 1920
const COVER_EXPORT_HEIGHT = 640
const COVER_ASPECT_RATIO = COVER_EXPORT_WIDTH / COVER_EXPORT_HEIGHT
const MAX_CROP_ZOOM = 3
const POLL_MAX_ATTEMPTS = 30
const POLL_DELAY_MS = 3000
const LOCATION_SPECIAL_OPTIONS: Array<{ value: 'remote' | 'not_in_canada'; label: string }> = [
  { value: 'remote', label: 'Remote' },
  { value: 'not_in_canada', label: 'Not in Canada' },
]
const LOCATION_SPECIAL_LABELS: Record<'remote' | 'not_in_canada', string> = {
  remote: 'Remote',
  not_in_canada: 'Not in Canada',
}

function encodeExperienceLocation(selection: ExperienceLocationSelection): string {
  if (selection.kind === 'special') {
    return `special:${selection.value}`
  }
  return `community:${selection.provinceCode.toUpperCase()}:${selection.communitySlug.toLowerCase()}|${selection.label}`
}

function parseExperienceLocation(raw: string | null | undefined): ExperienceLocationSelection | null {
  const value = raw?.trim()
  if (!value) return null

  if (value.startsWith('special:')) {
    const specialValue = value.slice('special:'.length).trim().toLowerCase()
    if (specialValue === 'remote' || specialValue === 'not_in_canada') {
      return {
        kind: 'special',
        value: specialValue,
        label: LOCATION_SPECIAL_LABELS[specialValue],
      }
    }
    return null
  }

  if (value.startsWith('community:')) {
    const body = value.slice('community:'.length)
    const [head, labelPart] = body.split('|')
    const [provinceCodeRaw, communitySlugRaw] = (head ?? '').split(':')
    const provinceCode = (provinceCodeRaw ?? '').trim().toUpperCase()
    const communitySlug = (communitySlugRaw ?? '').trim().toLowerCase()
    if (!provinceCode || !communitySlug) return null
    const label = (labelPart ?? '').trim() || communitySlug.replace(/-/g, ' ')
    return {
      kind: 'community',
      provinceCode,
      communitySlug,
      label,
    }
  }

  return null
}

const buildPostPermalink = (post: {
  id: string
  seoSlug?: string | null
  provinceCode?: string | null
  communitySlug?: string | null
  author?: { handle?: string | null } | null
}) => {
  const slug = post.seoSlug ?? post.id
  if (post.provinceCode && post.communitySlug) {
    return `/${post.provinceCode.toLowerCase()}/${post.communitySlug.toLowerCase()}/posts/${slug}`
  }
  if (post.author?.handle) {
    return `/u/${post.author.handle}/posts/${slug}`
  }
  return `/post/${post.id}`
}

const syncMediaStateFromProfile = (
  state: MediaSlotState,
  serverIdRaw: string | null | undefined,
  serverUrlRaw: string | null | undefined,
): MediaSlotState => {
  const serverId = serverIdRaw ?? null
  const serverUrl = serverUrlRaw ?? null
  const processingComplete = Boolean(state.processingId && serverId === state.processingId && serverUrl)

  let nextStatus = state.status
  if (processingComplete) {
    nextStatus = 'ready'
  } else if (!state.previewUrl && !state.processingId) {
    nextStatus = serverUrl ? 'ready' : 'idle'
  }

  return {
    ...state,
    currentId: serverId,
    serverUrl,
    previewUrl: processingComplete ? null : state.previewUrl,
    processingId: processingComplete ? null : state.processingId,
    status: nextStatus,
    error: processingComplete ? null : state.error,
  }
}

const pickVariantUrl = (category: ProfileMediaCategory, variants?: Record<string, { url?: string | null } | null>) => {
  if (!variants) return null
  const priority = VARIANT_PRIORITY[category] ?? []
  for (const key of priority) {
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

const formatFileSize = (bytes: number) => `${Math.round(bytes / MB)} MB`
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class MediaUploadError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

type UploadAssetParams = {
  category: MediaCategory
  file: File
  token: string
  dimensions?: { width?: number; height?: number } | null
}

const shouldUseDirectUpload = (url?: string | null) => {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && parsed.protocol === 'http:') {
      return false
    }
    return true
  } catch (err) {
    console.warn('Unable to parse upload URL; defaulting to proxy.', err)
    return false
  }
}

const uploadAssetToMediaService = async ({ category, file, token, dimensions }: UploadAssetParams): Promise<string> => {
  const initRes = await fetch(buildApiUrl('/media/uploads'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      category,
      mime: file.type || 'application/octet-stream',
      byteSize: file.size,
      filename: file.name,
    }),
  })

  if (!initRes.ok) {
    const payload = await initRes.json().catch(() => ({}))
    const reason = typeof payload?.error === 'string' ? payload.error : undefined
    throw new MediaUploadError(reason ?? 'upload_init_failed', 'We could not start the upload.')
  }

  const initPayload = await initRes.json()
  const assetId: string = initPayload.assetId
  const upload: { url?: string; method?: string; headers?: Record<string, string> } = initPayload.upload || {}
  const proxyPath: string | null = typeof initPayload?.proxyPath === 'string' ? initPayload.proxyPath : null

  let uploadSucceeded = false
  let uploadError: unknown = null

  if (shouldUseDirectUpload(upload.url)) {
    try {
      const uploadRes = await fetch(upload.url as string, {
        method: upload.method || 'PUT',
        headers: upload.headers,
        body: file,
      })
      if (!uploadRes.ok) {
        throw new Error(`direct_upload_failed_${uploadRes.status}`)
      }
      uploadSucceeded = true
    } catch (err) {
      uploadError = err
      console.warn('Direct media upload failed, attempting proxy fallback if available.', err)
    }
  }

  if (!uploadSucceeded && proxyPath) {
    try {
      const proxyRes = await fetch(buildApiUrl(proxyPath), {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': file.type || 'application/octet-stream',
          'x-upload-byte-size': String(file.size),
        },
        body: file,
      })
      if (!proxyRes.ok) {
        throw new Error(`proxy_upload_failed_${proxyRes.status}`)
      }
      uploadSucceeded = true
    } catch (proxyErr) {
      uploadError = proxyErr
      console.error('Proxy media upload failed.', proxyErr)
    }
  }

  if (!uploadSucceeded) {
    console.error('Media upload could not be completed.', uploadError)
    throw new MediaUploadError('upload_failed', 'Upload could not be completed.')
  }

  const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      assetId,
      width: dimensions?.width,
      height: dimensions?.height,
    }),
  })

  if (!completeRes.ok) {
    throw new MediaUploadError('processing_not_scheduled', 'Processing could not be scheduled.')
  }

  return assetId
}

const MAX_EXPERIENCES = 50

const loadImageFromUrl = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.crossOrigin = 'anonymous'
    img.src = url
  })

const generateCroppedImageBlob = async (
  file: File,
  croppedAreaPixels: Area,
  options: { shape: 'circle' | 'rect'; width: number; height: number },
): Promise<Blob | null> => {
  let objectUrl: string | null = null
  try {
    objectUrl = URL.createObjectURL(file)
    const image = await loadImageFromUrl(objectUrl)
    const canvas = document.createElement('canvas')
    canvas.width = options.width
    canvas.height = options.height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return null
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.save()
    if (options.shape === 'circle') {
      const radius = Math.min(canvas.width, canvas.height) / 2
      ctx.beginPath()
      ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()
    }
    ctx.drawImage(
      image,
      croppedAreaPixels.x,
      croppedAreaPixels.y,
      croppedAreaPixels.width,
      croppedAreaPixels.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    ctx.restore()

    const mime = options.shape === 'circle' ? 'image/png' : 'image/jpeg'
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), mime, 0.95)
    })
  } catch (err) {
    console.error('Unable to generate cropped image blob', err)
    return null
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
    }
  }
}

const cropExportOptionsForCategory = (category: ProfileMediaCategory) =>
  category === 'avatar'
    ? { shape: 'rect' as const, width: AVATAR_EXPORT_SIZE, height: AVATAR_EXPORT_SIZE }
    : { shape: 'rect' as const, width: COVER_EXPORT_WIDTH, height: COVER_EXPORT_HEIGHT }

function initialsFromUser(user: { name?: string | null; handle?: string | null }) {
  const source = user.name || user.handle || ''
  return source
    .split(' ')
    .map((part) => part?.[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2)
}

function monthInputFromIso(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}

function monthInputToIso(value: string) {
  if (!value) return null
  const [yearStr, monthStr] = value.split('-')
  if (!yearStr || !monthStr) return null
  const year = Number.parseInt(yearStr, 10)
  const month = Number.parseInt(monthStr, 10)
  if (!year || !month || month < 1 || month > 12) return null
  const date = new Date(Date.UTC(year, month - 1, 1))
  return date.toISOString()
}

function formatMonthYear(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatStatusDate(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function civicStatusLabel(value?: CivicStatusValue | null) {
  if (value === 'citizen') return 'Canadian Citizen'
  if (value === 'permanent_resident') return 'Permanent Resident of Canada'
  if (value === 'work_permit') return 'Valid Work Permit'
  if (value === 'study_permit') return 'Valid Study Permit'
  if (value === 'unspecified') return 'Other / Prefer not to say'
  return 'Not set'
}

function workAuthorizationLabel(value?: WorkAuthorizationValue | null) {
  if (value === 'authorized') return 'Authorized to work in Canada'
  if (value === 'not_authorized') return 'Not authorized to work in Canada'
  if (value === 'unspecified') return 'Work authorization not provided'
  return ''
}

function generateKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function normalizeApiError(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const joined = value.map((item) => normalizeApiError(item)).filter(Boolean).join(' ')
    return joined.length ? joined : null
  }
  if (typeof value === 'object') {
    const joined = Object.values(value as Record<string, unknown>)
      .map((item) => normalizeApiError(item))
      .filter(Boolean)
      .join(' ')
    return joined.length ? joined : null
  }
  return String(value)
}

function emptyExperience(): ExperienceFormState {
  return {
    key: generateKey(),
    title: '',
    organization: '',
    location: '',
    startDate: '',
    endDate: '',
    current: false,
    description: '',
  }
}

export default function ProfileEditPage() {
  const router = useRouter()
  const [hydrated, setHydrated] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [profile, setProfile] = useState<ProfileResponse | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [bio, setBio] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [countryOfBirth, setCountryOfBirth] = useState('')
  const [shareDateOfBirth, setShareDateOfBirth] = useState(true)
  const [shareCountryOfBirth, setShareCountryOfBirth] = useState(true)
  const [countrySearchFocused, setCountrySearchFocused] = useState(false)
  const [experiences, setExperiences] = useState<ExperienceFormState[]>([emptyExperience()])
  const [avatarMedia, setAvatarMedia] = useState<MediaSlotState>(() => createMediaState())
  const [coverMedia, setCoverMedia] = useState<MediaSlotState>(() => createMediaState())
  const [photoModalCategory, setPhotoModalCategory] = useState<ProfileMediaCategory | null>(null)
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoPosting, setPhotoPosting] = useState(false)
  const [photoDrafts, setPhotoDrafts] = useState<Record<ProfileMediaCategory, PhotoDraftState>>(() => ({
    avatar: createPhotoDraftState(),
    cover: createPhotoDraftState(),
  }))
  const [activeOrganizationFieldKey, setActiveOrganizationFieldKey] = useState<string | null>(null)
  const [activeLocationFieldKey, setActiveLocationFieldKey] = useState<string | null>(null)
  const [organizationSearchResults, setOrganizationSearchResults] = useState<OrganizationDirectoryResult[]>([])
  const [organizationSearching, setOrganizationSearching] = useState(false)
  const [communityLocationSearchResults, setCommunityLocationSearchResults] = useState<CommunityLocationSearchResult[]>([])
  const [communityLocationSearching, setCommunityLocationSearching] = useState(false)
  const [linkedOrganizationsByExperienceKey, setLinkedOrganizationsByExperienceKey] = useState<Record<string, OrganizationDirectoryResult>>({})
  const [locationSelectionByExperienceKey, setLocationSelectionByExperienceKey] = useState<Record<string, ExperienceLocationSelection>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const handledPhotoIntentRef = useRef<string | null>(null)
  const countrySearchBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const previewHandle = useMemo(() => buildHandleBase(firstName, lastName), [firstName, lastName])

  const updateMediaState = useCallback(
    (category: ProfileMediaCategory, updater: (prev: MediaSlotState) => MediaSlotState) => {
      if (category === 'avatar') {
        setAvatarMedia(updater)
      } else {
        setCoverMedia(updater)
      }
    },
    [setAvatarMedia, setCoverMedia],
  )

  const updatePhotoDraft = useCallback((category: ProfileMediaCategory, updater: (prev: PhotoDraftState) => PhotoDraftState) => {
    setPhotoDrafts((prev) => {
      const current = prev[category]
      const next = updater(current)
      if (current.previewUrl && current.previewUrl !== next.previewUrl && current.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(current.previewUrl)
      }
      return {
        ...prev,
        [category]: next,
      }
    })
  }, [])

  const handleMediaUpload = useCallback(
    async (category: ProfileMediaCategory, file: File) => {
      if (!token) {
        pushToast('You must be signed in to upload photos.', 'error')
        redirectToAuthModal('login')
        return null
      }

      const limit = MEDIA_LIMITS[category]
      if (file.size > limit) {
        pushToast(`Your ${MEDIA_LABELS[category]} must be ${formatFileSize(limit)} or smaller.`, 'error')
        return null
      }

      if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
        pushToast('Please choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF image.', 'error')
        return null
      }

      const previewUrl = URL.createObjectURL(file)
      updateMediaState(category, (prev) => ({
        ...prev,
        previewUrl,
        status: 'uploading',
        error: null,
      }))

      const friendlyLabel = MEDIA_LABELS[category]

      try {
        const dimensions = await readImageDimensions(file)
        const assetId = await uploadAssetToMediaService({ category, file, token, dimensions })
        updateMediaState(category, (prev) => ({
          ...prev,
          currentId: assetId,
          pendingId: null,
          processingId: assetId,
          status: 'processing',
          error: null,
        }))
        return assetId
      } catch (err) {
        const message = err instanceof MediaUploadError ? err.message : `We couldn't upload your ${friendlyLabel}. Please try again.`
        pushToast(message, 'error')
        updateMediaState(category, (prev) => ({
          ...prev,
          status: 'error',
          pendingId: null,
          processingId: null,
          error: 'Something went wrong during upload.',
          previewUrl: prev.serverUrl ? null : prev.previewUrl,
        }))
        return null
      }
    },
    [token, updateMediaState],
  )

  const handleFileInputChange = useCallback(
    (category: ProfileMediaCategory) => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const previewUrl = URL.createObjectURL(file)
      updatePhotoDraft(category, () => ({
        file,
        previewUrl,
        crop: { x: 0, y: 0 },
        zoom: 1,
        croppedAreaPixels: null,
        isDirty: true,
        fullAssetId: null,
      }))
    },
    [updatePhotoDraft],
  )

  const openFilePicker = useCallback(
    (category: ProfileMediaCategory) => {
      const ref = category === 'avatar' ? avatarInputRef : coverInputRef
      ref.current?.click()
    },
    [],
  )

  const handleOrganizationSelect = useCallback(
    (experienceKey: string, organization: OrganizationDirectoryResult) => {
      setExperiences((prev) => prev.map((exp) => (exp.key === experienceKey ? { ...exp, organization: organization.name } : exp)))
      setLinkedOrganizationsByExperienceKey((prev) => ({
        ...prev,
        [experienceKey]: organization,
      }))
      setActiveOrganizationFieldKey(null)
      setOrganizationSearchResults([])
    },
    [],
  )

  const uploadOriginalAsset = useCallback(
    async (file: File) => {
      if (!token) {
        pushToast('You must be signed in to upload photos.', 'error')
        redirectToAuthModal('login')
        return null
      }

      const limit = MEDIA_CATEGORY_LIMITS.post_image
      if (file.size > limit) {
        pushToast(`Your full photo must be ${formatFileSize(limit)} or smaller.`, 'error')
        return null
      }

      if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
        pushToast('Please choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF image.', 'error')
        return null
      }

      try {
        const dimensions = await readImageDimensions(file)
        const assetId = await uploadAssetToMediaService({ category: 'post_image', file, token, dimensions })
        return assetId
      } catch (err) {
        const message = err instanceof MediaUploadError ? err.message : 'We could not upload the full photo. Please try again.'
        pushToast(message, 'error')
        return null
      }
    },
    [token],
  )

  const waitForAssetReady = useCallback(
    async (assetId: string, friendlyLabel: string) => {
      if (!token) {
        pushToast('You must be signed in to upload photos.', 'error')
        redirectToAuthModal('login')
        return false
      }

      let lastError: unknown = null
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
        try {
          const res = await fetch(buildApiUrl(`/media/assets/${assetId}`), {
            headers: {
              authorization: `Bearer ${token}`,
            },
          })

          if (!res.ok) {
            throw new Error(`status_${res.status}`)
          }

          const payload = await res.json().catch(() => ({}))
          const asset = payload?.asset
          if (!asset) {
            throw new Error('asset_missing')
          }

          if (asset.status === 'ready') {
            return true
          }

          if (asset.status === 'failed') {
            pushToast(asset.failureReason ? `Processing failed: ${asset.failureReason}` : `We couldn't process your ${friendlyLabel}.`, 'error')
            return false
          }
        } catch (err) {
          lastError = err
          console.error('Failed while waiting for media asset', err)
        }

        await wait(POLL_DELAY_MS)
      }

      if (lastError) {
        console.error('Timed out waiting for media asset', lastError)
      }
      pushToast(`Your ${friendlyLabel} is still processing. Please try again in a moment.`, 'warning')
      return false
    },
    [token],
  )

  const applyPhotoCrop = useCallback(
    async (category: ProfileMediaCategory) => {
      const draft = photoDrafts[category]
      if (!draft.file) {
        pushToast('Upload a photo before posting.', 'error')
        return null
      }
      let cropArea = draft.croppedAreaPixels
      if (!cropArea) {
        const dims = await readImageDimensions(draft.file)
        if (!dims) {
          pushToast('We could not read that photo. Please choose a different one.', 'error')
          return null
        }
        const desiredAspect = category === 'avatar' ? 1 : COVER_ASPECT_RATIO
        const sourceAspect = dims.width / dims.height
        let width = dims.width
        let height = dims.height
        if (sourceAspect > desiredAspect) {
          height = dims.height
          width = height * desiredAspect
        } else {
          width = dims.width
          height = width / desiredAspect
        }
        const fallbackArea: Area = {
          x: Math.max(0, (dims.width - width) / 2),
          y: Math.max(0, (dims.height - height) / 2),
          width,
          height,
        }
        cropArea = fallbackArea
        updatePhotoDraft(category, (prev) => ({
          ...prev,
          croppedAreaPixels: fallbackArea,
        }))
      }
      const exportOptions = cropExportOptionsForCategory(category)
      const blob = await generateCroppedImageBlob(draft.file, cropArea, exportOptions)
      if (!blob) {
        pushToast('We could not crop that image. Please try again with a different photo.', 'error')
        return null
      }
      const extension = blob.type === 'image/png' ? 'png' : 'jpg'
      const baseName = draft.file.name?.replace(/\.[^/.]+$/, '') || category
      const croppedFile = new File([blob], `${baseName}-${category}.${extension}`, { type: blob.type })
      const assetId = await handleMediaUpload(category, croppedFile)
      if (assetId) {
        const ready = await waitForAssetReady(assetId, MEDIA_LABELS[category])
        if (!ready) {
          return null
        }
        updatePhotoDraft(category, (prev) => ({
          ...prev,
          isDirty: false,
        }))
      }
      return assetId
    },
    [handleMediaUpload, photoDrafts, updatePhotoDraft, waitForAssetReady],
  )

  const ensurePhotoApplied = useCallback(
    async (category: ProfileMediaCategory) => {
      const draft = photoDrafts[category]
      if (draft.file && draft.isDirty) {
        return await applyPhotoCrop(category)
      }
      const mediaState = category === 'avatar' ? avatarMedia : coverMedia
      if (!mediaState.currentId) {
        return null
      }
      if (mediaState.status === 'ready') {
        return mediaState.currentId
      }
      const ready = await waitForAssetReady(mediaState.currentId, MEDIA_LABELS[category])
      return ready ? mediaState.currentId : null
    },
    [applyPhotoCrop, avatarMedia, coverMedia, photoDrafts, waitForAssetReady],
  )

  const ensureFullSizeAsset = useCallback(
    async (category: ProfileMediaCategory, displayAssetId: string) => {
      const draft = photoDrafts[category]
      if (draft.file) {
        if (draft.fullAssetId) {
          return draft.fullAssetId
        }
        const uploaded = await uploadOriginalAsset(draft.file)
        if (uploaded) {
          const ready = await waitForAssetReady(uploaded, 'full photo')
          if (!ready) {
            return null
          }
          updatePhotoDraft(category, (prev) => ({
            ...prev,
            fullAssetId: uploaded,
          }))
          return uploaded
        }
      }
      return displayAssetId
    },
    [photoDrafts, updatePhotoDraft, uploadOriginalAsset, waitForAssetReady],
  )

  const resetPhotoDraftCrop = useCallback(
    (category: ProfileMediaCategory) => {
      updatePhotoDraft(category, (prev) => ({
        ...prev,
        crop: { x: 0, y: 0 },
        zoom: 1,
        croppedAreaPixels: null,
        isDirty: Boolean(prev.file),
      }))
    },
    [updatePhotoDraft],
  )

  const handleCropChange = useCallback(
    (category: ProfileMediaCategory) => (nextCrop: { x: number; y: number }) => {
      updatePhotoDraft(category, (prev) => ({
        ...prev,
        crop: nextCrop,
        isDirty: true,
      }))
    },
    [updatePhotoDraft],
  )

  const handleZoomChange = useCallback(
    (category: ProfileMediaCategory) => (nextZoom: number) => {
      updatePhotoDraft(category, (prev) => ({
        ...prev,
        zoom: nextZoom,
        isDirty: true,
      }))
    },
    [updatePhotoDraft],
  )

  const handleCropComplete = useCallback(
    (category: ProfileMediaCategory) => (_area: Area, nextAreaPixels: Area) => {
      updatePhotoDraft(category, (prev) => ({
        ...prev,
        croppedAreaPixels: nextAreaPixels,
        isDirty: true,
      }))
    },
    [updatePhotoDraft],
  )

  const launchPhotoFlow = useCallback(
    (category: ProfileMediaCategory, triggerPicker = true) => {
      setPhotoModalCategory(category)
      setPhotoCaption('')
      if (triggerPicker) {
        setTimeout(() => {
          const ref = category === 'avatar' ? avatarInputRef : coverInputRef
          ref.current?.click()
        }, 0)
      }
    },
    [],
  )

  const closePhotoModal = useCallback(() => {
    setPhotoModalCategory(null)
    setPhotoCaption('')
    setPhotoPosting(false)
  }, [])

  const pollAssetStatus = useCallback(
    async (category: ProfileMediaCategory, assetId: string, isCancelled: () => boolean) => {
      if (!token) return
      let attempt = 0
      while (!isCancelled() && attempt < POLL_MAX_ATTEMPTS) {
        attempt += 1
        try {
          const res = await fetch(buildApiUrl(`/media/assets/${assetId}`), {
            headers: {
              authorization: `Bearer ${token}`,
            },
          })

          if (!res.ok) {
            throw new Error(`status_${res.status}`)
          }

          const payload = await res.json()
          const asset = payload?.asset
          if (!asset) {
            throw new Error('asset_missing')
          }

          if (isCancelled()) {
            return
          }

          if (asset.status === 'ready') {
            const variantUrl = pickVariantUrl(category, asset.variants)
            updateMediaState(category, (prev) => ({
              ...prev,
              serverUrl: variantUrl ?? prev.serverUrl,
              status: 'ready',
              processingId: null,
              error: null,
              previewUrl: variantUrl ? null : prev.previewUrl,
            }))
            return
          }

          if (asset.status === 'failed') {
            updateMediaState(category, (prev) => ({
              ...prev,
              status: 'error',
              processingId: null,
              error: asset.failureReason ? `Processing failed: ${asset.failureReason}` : 'Processing failed. Please try another image.',
            }))
            return
          }
        } catch (err) {
          console.error('Failed polling media asset', err)
          if (attempt >= 4) {
            updateMediaState(category, (prev) => ({
              ...prev,
              status: 'error',
              processingId: null,
              error: 'We could not verify processing status. Please try again later.',
            }))
            return
          }
        }

        await wait(POLL_DELAY_MS)
      }
    },
    [token, updateMediaState],
  )

  const loadViewer = useCallback(async () => {
    const storedToken = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null
    if (!storedToken) {
      if (typeof window !== 'undefined') {
        redirectToAuthModal('login')
      }
      return null
    }
    try {
      const cached = useViewerStore.getState().me
      if (cached) {
        if (!hasHomeCommunity(cached)) {
          router.replace('/welcome')
          return null
        }
        setViewer({
          id: cached.id,
          handle: cached.handle,
          name: cached.name,
          avatarUrl: cached.avatarUrl,
          coverUrl: cached.coverUrl,
          civicStatus: cached.civicStatus ?? null,
          workAuthorization: cached.workAuthorization ?? null,
          statusUpdatedAt: cached.statusUpdatedAt ?? null,
          isVerified: Boolean(cached.isVerified),
          isPremium: Boolean(cached.isPremium),
          premiumSince: cached.premiumSince ?? null,
          premiumRenewsAt: cached.premiumRenewsAt ?? null,
        })
        setToken(storedToken)
        return storedToken
      }

      const data = await ensureViewerMe({ token: storedToken })
      if (!data) {
        if (!window.localStorage.getItem('token')) {
          redirectToAuthModal('login')
        } else {
          pushToast('Unable to verify your session right now. Please try again.', 'error', 6000)
        }
        return null
      }
      if (!hasHomeCommunity(data)) {
        router.replace('/welcome')
        return null
      }
      setViewer({
        id: data.id,
        handle: data.handle,
        name: data.name,
        avatarUrl: data.avatarUrl,
        coverUrl: data.coverUrl,
        civicStatus: data.civicStatus ?? null,
        workAuthorization: data.workAuthorization ?? null,
        statusUpdatedAt: data.statusUpdatedAt ?? null,
        isVerified: Boolean(data.isVerified),
        isPremium: Boolean(data.isPremium),
        premiumSince: data.premiumSince ?? null,
        premiumRenewsAt: data.premiumRenewsAt ?? null,
      })
      setToken(storedToken)
      return storedToken
    } catch (err) {
      console.error('Failed fetching viewer', err)
      pushToast('Unable to verify your session. Please sign in again.', 'error', 6000)
      if (typeof window !== 'undefined') {
        clearAuthSession()
        redirectToAuthModal('login')
      }
      return null
    }
  }, [router])

  const mapExperiencesFromResponse = useCallback((items?: ExperienceResponse[] | null) => {
    if (!items || items.length === 0) {
      return [emptyExperience()]
    }
    return items.map((exp) => ({
      key: exp.id || generateKey(),
      title: exp.title ?? '',
      organization: exp.organization ?? '',
      location: parseExperienceLocation(exp.location)?.label ?? (exp.location ?? ''),
      startDate: monthInputFromIso(exp.startDate),
      endDate: exp.current ? '' : monthInputFromIso(exp.endDate ?? undefined),
      current: Boolean(exp.current),
      description: exp.description ?? '',
    }))
  }, [])

  const loadProfile = useCallback(
    async (authToken: string) => {
      setLoading(true)
      setError(null)
      try {
  const res = await fetch(buildApiUrl('/profile'), {
          headers: {
            authorization: `Bearer ${authToken}`,
          },
        })
        if (!res.ok) {
          if (res.status === 401) {
            if (typeof window !== 'undefined') {
              clearAuthSession()
              redirectToAuthModal('login')
            }
            return
          }
          const payload = await res.json().catch(() => ({}))
          const message = normalizeApiError(payload?.error) ?? normalizeApiError(payload?.message) ?? 'Unable to load your profile.'
          setError(message)
          return
        }
        const data: ProfileResponse = await res.json()
        setProfile(data)
        setFirstName(data.user.firstName ?? '')
        setLastName(data.user.lastName ?? '')
        setBio(data.user.bio ?? '')
        setDateOfBirth(data.user.dateOfBirth ?? '')
        setCountryOfBirth(data.user.countryOfBirth ?? '')
        setShareDateOfBirth(data.user.shareDateOfBirth ?? true)
        setShareCountryOfBirth(data.user.shareCountryOfBirth ?? true)
        const mappedExperiences = mapExperiencesFromResponse(data.user.experiences)
        setExperiences(mappedExperiences)
        const nextLinkedByKey: Record<string, OrganizationDirectoryResult> = {}
        const nextLocationSelections: Record<string, ExperienceLocationSelection> = {}
        if (Array.isArray(data.user.experiences)) {
          data.user.experiences.forEach((exp, index) => {
            const key = mappedExperiences[index]?.key
            if (!key) return

            const linked = exp.organizationProfile
            if (linked) {
              nextLinkedByKey[key] = {
                id: linked.id,
                name: linked.name,
                slug: linked.slug,
                provinceCode: linked.provinceCode,
                communitySlug: linked.communitySlug,
                logoUrl: linked.logoUrl ?? null,
                coverUrl: linked.coverUrl ?? null,
              }
            }

            const parsedLocation = parseExperienceLocation(exp.location)
            if (parsedLocation) {
              nextLocationSelections[key] = parsedLocation
            }
          })
        }
        setLinkedOrganizationsByExperienceKey(nextLinkedByKey)
        setLocationSelectionByExperienceKey(nextLocationSelections)
        const derivedName = `${data.user.firstName ?? ''} ${data.user.lastName ?? ''}`.trim()
        setViewer((prev) =>
          prev
            ? {
                ...prev,
                handle: data.user.handle,
                name: data.user.name ?? (derivedName.length > 0 ? derivedName : prev.name),
                avatarUrl: data.user.avatarUrl ?? prev.avatarUrl,
              }
            : prev,
        )
      } catch (err) {
        console.error('Failed loading profile', err)
        setError('Unable to load your profile right now.')
      } finally {
        setLoading(false)
      }
    },
    [mapExperiencesFromResponse],
  )

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    const promise = loadViewer()
    promise
      ?.then((authToken) => {
        if (authToken) {
          loadProfile(authToken).catch(() => {
            /* noop */
          })
        }
      })
      .catch(() => {
        /* noop */
      })
  }, [loadProfile, loadViewer])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const desired = url.searchParams.get('photo')
    if (desired !== 'avatar' && desired !== 'cover') {
      handledPhotoIntentRef.current = null
      return
    }
    if (handledPhotoIntentRef.current === desired) return
    handledPhotoIntentRef.current = desired
    launchPhotoFlow(desired)
    url.searchParams.delete('photo')
    const nextSearch = url.searchParams.toString()
    const hash = url.hash ?? ''
    const next = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${hash}`
    window.history.replaceState({}, '', next)
  }, [launchPhotoFlow])

  useEffect(() => {
    if (!profile) return
    setAvatarMedia((prev) => syncMediaStateFromProfile(prev, profile.user.avatarMediaId, profile.user.avatarUrl))
    setCoverMedia((prev) => syncMediaStateFromProfile(prev, profile.user.coverMediaId, profile.user.coverUrl))
  }, [profile])

  useEffect(() => {
    return () => {
      if (avatarMedia.previewUrl && avatarMedia.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(avatarMedia.previewUrl)
      }
    }
  }, [avatarMedia.previewUrl])

  useEffect(() => {
    return () => {
      if (coverMedia.previewUrl && coverMedia.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(coverMedia.previewUrl)
      }
    }
  }, [coverMedia.previewUrl])

  useEffect(() => {
    return () => {
      if (countrySearchBlurTimeoutRef.current) {
        clearTimeout(countrySearchBlurTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const url = photoDrafts.avatar.previewUrl
    if (!url || !url.startsWith('blob:')) return undefined
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [photoDrafts.avatar.previewUrl])

  useEffect(() => {
    const url = photoDrafts.cover.previewUrl
    if (!url || !url.startsWith('blob:')) return undefined
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [photoDrafts.cover.previewUrl])

  useEffect(() => {
    if (!avatarMedia.processingId) return
    let cancelled = false
    pollAssetStatus('avatar', avatarMedia.processingId, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [avatarMedia.processingId, pollAssetStatus])

  useEffect(() => {
    if (!coverMedia.processingId) return
    let cancelled = false
    pollAssetStatus('cover', coverMedia.processingId, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [coverMedia.processingId, pollAssetStatus])

  useEffect(() => {
    const activeKey = activeOrganizationFieldKey
    if (!activeKey) {
      setOrganizationSearchResults([])
      return
    }

    const activeExperience = experiences.find((exp) => exp.key === activeKey)
    const query = activeExperience?.organization.trim() ?? ''

    if (query.length < 2) {
      setOrganizationSearchResults([])
      setOrganizationSearching(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setOrganizationSearching(true)
      try {
        const params = new URLSearchParams({ q: query, limit: '8' })
        const response = await fetch(buildApiUrl(`/organizations/directory?${params.toString()}`), { cache: 'no-store' })
        if (!response.ok) {
          if (!cancelled) setOrganizationSearchResults([])
          return
        }
        const payload = (await response.json().catch(() => null)) as { items?: OrganizationDirectoryResult[] } | null
        if (cancelled) return
        setOrganizationSearchResults(Array.isArray(payload?.items) ? payload.items : [])
      } catch {
        if (!cancelled) setOrganizationSearchResults([])
      } finally {
        if (!cancelled) setOrganizationSearching(false)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeOrganizationFieldKey, experiences])

  useEffect(() => {
    const activeKey = activeLocationFieldKey
    if (!activeKey) {
      setCommunityLocationSearchResults([])
      return
    }

    const activeExperience = experiences.find((exp) => exp.key === activeKey)
    const query = activeExperience?.location.trim() ?? ''

    if (query.length < 2) {
      setCommunityLocationSearchResults([])
      setCommunityLocationSearching(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setCommunityLocationSearching(true)
      try {
        const params = new URLSearchParams({ q: query, type: 'communities', limit: '8' })
        const headers = token ? { authorization: `Bearer ${token}` } : undefined
        const response = await fetch(buildApiUrl(`/search?${params.toString()}`), { cache: 'no-store', headers })
        if (!response.ok) {
          if (!cancelled) setCommunityLocationSearchResults([])
          return
        }

        const payload = (await response.json().catch(() => null)) as { communities?: Array<Record<string, unknown>> } | null
        if (cancelled) return

        const normalized = Array.isArray(payload?.communities)
          ? payload!.communities
              .map((entry) => {
                const provinceCodeRaw =
                  typeof entry.provinceCode === 'string'
                    ? entry.provinceCode
                    : typeof entry.province === 'string'
                      ? entry.province
                      : null
                const communitySlugRaw =
                  typeof entry.communitySlug === 'string'
                    ? entry.communitySlug
                    : typeof entry.slug === 'string'
                      ? entry.slug
                      : typeof entry.chamberSlug === 'string'
                        ? entry.chamberSlug
                        : null
                const labelRaw =
                  typeof entry.communityName === 'string'
                    ? entry.communityName
                    : typeof entry.chamberName === 'string'
                      ? entry.chamberName
                      : typeof entry.name === 'string'
                        ? entry.name
                        : null

                const provinceCode = provinceCodeRaw?.trim().toUpperCase() ?? ''
                const communitySlug = communitySlugRaw?.trim().toLowerCase() ?? ''
                const label = (labelRaw?.trim() || communitySlug.replace(/-/g, ' ')).trim()

                if (!provinceCode || !communitySlug || !label) return null
                return {
                  provinceCode,
                  communitySlug,
                  label,
                } as CommunityLocationSearchResult
              })
              .filter((entry): entry is CommunityLocationSearchResult => Boolean(entry))
          : []

        const deduped = Array.from(
          new Map(normalized.map((entry) => [`${entry.provinceCode}:${entry.communitySlug}`, entry])).values(),
        )
        setCommunityLocationSearchResults(deduped)
      } catch {
        if (!cancelled) setCommunityLocationSearchResults([])
      } finally {
        if (!cancelled) setCommunityLocationSearching(false)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeLocationFieldKey, experiences, token])

  const handleExperienceChange = useCallback((key: string, patch: Partial<ExperienceFormState>) => {
    setExperiences((prev) => prev.map((exp) => (exp.key === key ? { ...exp, ...patch } : exp)))

    const organization = patch.organization
    if (typeof organization === 'string') {
      setLinkedOrganizationsByExperienceKey((prev) => {
        const linked = prev[key]
        if (!linked) return prev
        if (organization.trim() === linked.name) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }, [])

  const handleExperienceLocationChange = useCallback((key: string, value: string) => {
    setExperiences((prev) => prev.map((exp) => (exp.key === key ? { ...exp, location: value } : exp)))
    setLocationSelectionByExperienceKey((prev) => {
      const existing = prev[key]
      if (!existing) return prev
      if (value.trim() === existing.label) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const handleExperienceLocationSelect = useCallback((key: string, selection: ExperienceLocationSelection) => {
    setExperiences((prev) => prev.map((exp) => (exp.key === key ? { ...exp, location: selection.label } : exp)))
    setLocationSelectionByExperienceKey((prev) => ({
      ...prev,
      [key]: selection,
    }))
    setActiveLocationFieldKey((current) => (current === key ? null : current))
  }, [])

  const handlePostPhoto = useCallback(async () => {
    if (!photoModalCategory) return
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setPhotoPosting(true)
    const displayAssetId = await ensurePhotoApplied(photoModalCategory)
    if (!displayAssetId) {
      pushToast('Upload a photo before posting.', 'error')
      setPhotoPosting(false)
      return
    }
    try {
      const fullAssetId = await ensureFullSizeAsset(photoModalCategory, displayAssetId)
      if (!fullAssetId) {
        return
      }
      const res = await fetch(buildApiUrl('/profile/photo'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category: photoModalCategory,
          displayAssetId,
          fullAssetId,
          caption: photoCaption.trim() || undefined,
        }),
      })

      const payload = await res.json().catch(() => null)

      if (!res.ok) {
        const rawError = typeof payload?.error === 'string' ? payload.error : typeof payload?.error?.message === 'string' ? payload.error.message : null
        pushToast(rawError ?? 'We could not share your photo right now.', 'error')
        return
      }

      const post = (payload as any)?.post

      const updatedUser = (payload as any)?.user
      if (updatedUser) {
        setProfile((prev) => (prev ? { ...prev, user: { ...prev.user, ...updatedUser } } : prev))
        setAvatarMedia((prev) => syncMediaStateFromProfile(prev, updatedUser.avatarMediaId, updatedUser.avatarUrl))
        setCoverMedia((prev) => syncMediaStateFromProfile(prev, updatedUser.coverMediaId, updatedUser.coverUrl))
        setViewer((prev) => (prev ? { ...prev, avatarUrl: updatedUser.avatarUrl ?? prev.avatarUrl } : prev))
      }

      pushToast(photoModalCategory === 'avatar' ? 'Shared your new profile photo.' : 'Shared your new cover photo.', 'success')
      setPhotoDrafts((prev) => ({
        ...prev,
        [photoModalCategory]: createPhotoDraftState(),
      }))
      closePhotoModal()

      if (post) {
        router.push(buildPostPermalink(post))
      }
    } catch (err) {
      console.error('Failed to share profile photo', err)
      pushToast('We could not share your photo right now.', 'error')
    } finally {
      setPhotoPosting(false)
    }
  }, [closePhotoModal, ensureFullSizeAsset, ensurePhotoApplied, photoCaption, photoModalCategory, router, token])

  const handleExperienceToggleCurrent = useCallback((key: string, value: boolean) => {
    setExperiences((prev) =>
      prev.map((exp) =>
        exp.key === key
          ? {
              ...exp,
              current: value,
              endDate: value ? '' : exp.endDate,
            }
          : exp,
      ),
    )
  }, [])

  const removeExperience = useCallback((key: string) => {
    setExperiences((prev) => {
      const next = prev.filter((exp) => exp.key !== key)
      return next.length > 0 ? next : [emptyExperience()]
    })
    setLinkedOrganizationsByExperienceKey((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setLocationSelectionByExperienceKey((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const addExperience = useCallback(() => {
    setExperiences((prev) => {
      if (prev.length >= MAX_EXPERIENCES) {
        pushToast(`You can list up to ${MAX_EXPERIENCES} experiences.`, 'warning')
        return prev
      }
      return [...prev, emptyExperience()]
    })
  }, [])

  const saveProfile = useCallback(async () => {
    if (!token) {
      pushToast('You must be signed in to update your profile.', 'error')
      return
    }

    const trimmedFirst = firstName.trim()
    const trimmedLast = lastName.trim()
    if (!trimmedFirst || !trimmedLast) {
      pushToast('Please provide both your first and last name.', 'error')
      return
    }

    const normalizedExperiences: Array<{
      title: string
      organization: string
      location?: string
      startDate: string
      endDate?: string | null
      current: boolean
      description?: string
    }> = []

    for (let index = 0; index < experiences.length; index += 1) {
      const exp = experiences[index]
      if (!exp) {
        continue
      }

      const title = exp.title.trim()
      const organization = exp.organization.trim()
      const locationText = exp.location.trim()
      const selectedLocation = locationSelectionByExperienceKey[exp.key]
      if (locationText && !selectedLocation) {
        pushToast(`Experience ${index + 1} location must be selected from Civil options.`, 'error')
        return
      }
      const location = selectedLocation ? encodeExperienceLocation(selectedLocation) : locationText
      const description = exp.description.trim()
      const hasAnyValue = Boolean(
        title ||
          organization ||
          locationText ||
          exp.startDate ||
          exp.endDate ||
          description ||
          exp.current,
      )

      if (!hasAnyValue) {
        continue
      }

      const startIso = monthInputToIso(exp.startDate)
      const endIso = exp.current ? null : monthInputToIso(exp.endDate)

      if (!title || !organization || !startIso) {
        pushToast(`Experience ${index + 1} is missing required fields.`, 'error')
        return
      }

      if (endIso && new Date(endIso).getTime() < new Date(startIso).getTime()) {
        pushToast(`Experience ${index + 1} has an end date before the start date.`, 'error')
        return
      }

      normalizedExperiences.push({
        title,
        organization,
        location: location ? location : undefined,
        startDate: startIso,
        endDate: exp.current ? null : endIso ?? undefined,
        current: exp.current,
        description: description ? description : undefined,
      })
    }

    const ensuredAvatarId = await ensurePhotoApplied('avatar')
    if (photoDrafts.avatar.file && !ensuredAvatarId) {
      return
    }
    const ensuredCoverId = await ensurePhotoApplied('cover')
    if (photoDrafts.cover.file && !ensuredCoverId) {
      return
    }

    setSaving(true)
    try {
      const res = await fetch(buildApiUrl('/profile'), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          firstName: trimmedFirst,
          lastName: trimmedLast,
          dateOfBirth: dateOfBirth || undefined,
          countryOfBirth: countryOfBirth.trim() || undefined,
          shareDateOfBirth,
          shareCountryOfBirth,
          bio,
          experiences: normalizedExperiences,
          avatarMediaId: ensuredAvatarId ?? undefined,
          coverMediaId: ensuredCoverId ?? undefined,
        }),
      })

      const payload = await res.json().catch(() => null)

      if (!res.ok) {
        const rawError = normalizeApiError(payload?.error) ?? normalizeApiError(payload?.message)

        const friendlyErrorMap: Record<string, string> = {
          experiences_not_available:
            'Your experiences were not saved because the update is still deploying. Please try again in a moment.',
        }

        const message = rawError ? friendlyErrorMap[rawError] ?? rawError : 'We could not save your profile. Please try again.'
        pushToast(message, 'error', 6000)
        return
      }

      pushToast('Your profile was updated.', 'success')
      setPhotoDrafts((prev) => ({
        avatar: prev.avatar.file ? createPhotoDraftState() : prev.avatar,
        cover: prev.cover.file ? createPhotoDraftState() : prev.cover,
      }))
      await loadProfile(token)
    } catch (err) {
      console.error('Failed updating profile', err)
      pushToast('We ran into a problem saving your profile. Please try again shortly.', 'error', 6000)
    } finally {
      setSaving(false)
    }
  }, [
    bio,
    countryOfBirth,
    dateOfBirth,
    ensurePhotoApplied,
    experiences,
    firstName,
    lastName,
    loadProfile,
    locationSelectionByExperienceKey,
    photoDrafts.avatar.file,
    photoDrafts.cover.file,
    shareCountryOfBirth,
    shareDateOfBirth,
    token,
  ])

  const handleLogout = useCallback(async () => {
    try {
      if (token) {
        await fetch(buildApiUrl('/auth/logout'), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
          },
        })
      }
    } catch (err) {
      console.error('Failed logging out', err)
    } finally {
      if (typeof window !== 'undefined') {
        clearAuthSession()
        router.replace('/')
      }
    }
  }, [router, token])

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      await saveProfile()
    },
    [saveProfile],
  )

  const formDisabled = saving || loading
  const joinDate = profile?.user?.createdAt ? formatMonthYear(profile.user.createdAt) : ''
  const currentCivicStatusLabel = civicStatusLabel(viewer?.civicStatus)
  const currentWorkAuthorizationLabel = viewer?.civicStatus && viewer.civicStatus !== 'citizen' && viewer.civicStatus !== 'permanent_resident'
    ? workAuthorizationLabel(viewer?.workAuthorization)
    : ''
  const statusUpdatedLabel = formatStatusDate(viewer?.statusUpdatedAt)
  const profileDisplayName = `${firstName} ${lastName}`.trim() || profile?.user?.name || viewer?.name || viewer?.handle || 'Your profile'

  const displayInitials = useMemo(() => {
    return (
      initialsFromUser({
        name: profileDisplayName,
        handle: profile?.user?.handle ?? viewer?.handle,
      }) || 'C'
    )
  }, [profile?.user?.handle, profileDisplayName, viewer?.handle])

  const avatarDraftPreview = photoDrafts.avatar.isDirty ? photoDrafts.avatar.previewUrl : null
  const coverDraftPreview = photoDrafts.cover.isDirty ? photoDrafts.cover.previewUrl : null
  const avatarDisplayUrl = avatarDraftPreview ?? avatarMedia.previewUrl ?? avatarMedia.serverUrl ?? profile?.user?.avatarUrl ?? viewer?.avatarUrl ?? null
  const coverDisplayUrl = coverDraftPreview ?? coverMedia.previewUrl ?? coverMedia.serverUrl ?? profile?.user?.coverUrl ?? null
  const filteredCountryOptions = useMemo(() => {
    const query = countryOfBirth.trim().toLowerCase()
    if (!query) return COUNTRY_OPTIONS.slice(0, 14)

    const startsWithMatches = COUNTRY_OPTIONS.filter((country) => country.label.toLowerCase().startsWith(query))
    const includesMatches = COUNTRY_OPTIONS.filter(
      (country) => !country.label.toLowerCase().startsWith(query) && country.label.toLowerCase().includes(query),
    )

    return [...startsWithMatches, ...includesMatches].slice(0, 14)
  }, [countryOfBirth])
  const showCountryResults = countrySearchFocused && filteredCountryOptions.length > 0

  const handleCountrySearchFocus = useCallback(() => {
    if (countrySearchBlurTimeoutRef.current) {
      clearTimeout(countrySearchBlurTimeoutRef.current)
      countrySearchBlurTimeoutRef.current = null
    }
    setCountrySearchFocused(true)
  }, [])

  const handleCountrySearchBlur = useCallback(() => {
    if (countrySearchBlurTimeoutRef.current) clearTimeout(countrySearchBlurTimeoutRef.current)
    countrySearchBlurTimeoutRef.current = setTimeout(() => {
      setCountrySearchFocused(false)
    }, 140)
  }, [])

  const handleCountrySelect = useCallback((label: string) => {
    setCountryOfBirth(label)
    setCountrySearchFocused(false)
  }, [])

  const modalMediaState = useMemo(() => {
    if (!photoModalCategory) return null
    return photoModalCategory === 'avatar' ? avatarMedia : coverMedia
  }, [avatarMedia, coverMedia, photoModalCategory])

  const activePhotoDraft = photoModalCategory ? photoDrafts[photoModalCategory] : null
  const currentPhotoCategory = photoModalCategory ?? 'avatar'
  const canSubmitPhoto = Boolean(
    (modalMediaState?.currentId && modalMediaState?.status === 'ready') ||
      (activePhotoDraft?.file && activePhotoDraft.isDirty),
  )

  const rightRail = (
    <div className="sticky top-8 space-y-4">
      <section id="connections-card" className="surface-card space-y-4 p-5 shadow-subtle">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Account</p>
          <h2 className="text-base font-semibold text-slate-900">{profile?.user?.name || profile?.user?.handle || 'Your account'}</h2>
        </div>
        <dl className="space-y-3 text-sm text-slate-600">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Handle</dt>
            <dd className="font-semibold text-slate-900">@{profile?.user?.handle ?? ''}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Member since</dt>
            <dd className="font-semibold text-slate-900">{joinDate || '—'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Email</dt>
            <dd className="truncate text-right font-semibold text-slate-900">{profile?.user?.email ?? '—'}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full rounded-xl border border-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-[var(--cc-primary)] transition hover:bg-[var(--cc-primary)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cc-primary)]"
        >
          Log out
        </button>
      </section>

      <section className="surface-card space-y-4 p-5 shadow-subtle">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Connections</h2>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Live</span>
        </div>
        <ul className="space-y-3 text-sm text-slate-600">
          <li className="flex items-center justify-between">
            <span>Friends</span>
            <span className="text-base font-semibold text-slate-900">{profile?.stats?.friends ?? 0}</span>
          </li>
          <li className="flex items-center justify-between">
            <span>Connections</span>
            <span className="text-base font-semibold text-slate-900">{profile?.stats?.connections ?? 0}</span>
          </li>
          <li className="flex items-center justify-between">
            <span>Cities</span>
            <span className="text-base font-semibold text-slate-900">{profile?.stats?.communitiesFollowing ?? 0}</span>
          </li>
        </ul>
      </section>

      {profile?.homeChamber ? (
        <section className="surface-card space-y-3 p-5 shadow-subtle">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Home city</p>
          <div className="text-sm text-slate-600">
            <div className="text-base font-semibold text-slate-900">{profile.homeChamber.chamberName ?? profile.homeChamber.chamberSlug}</div>
            <div className="text-slate-500">{profile.homeChamber.provinceName ?? profile.homeChamber.provinceCode}</div>
          </div>
        </section>
      ) : null}
    </div>
  )

  return (
    <div className="min-h-screen">
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-screen-lg px-4">
          <Sidebar me={viewer ?? undefined} active="account" />
        </div>
      </div>

      <DashboardShell
        rightRail={rightRail}
        mainClassName="space-y-6 pt-8"
      >
        <div>
          <Link href="/settings" className="text-sm font-semibold text-[var(--cc-primary)] hover:underline">
            Back
          </Link>
        </div>

        {!hydrated || (loading && !profile && !error) ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading profile editor…</div>
        ) : error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <input
              ref={coverInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              className="hidden"
              onChange={handleFileInputChange('cover')}
            />
            <input
              ref={avatarInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              className="hidden"
              onChange={handleFileInputChange('avatar')}
            />

            <section className="space-y-4">
              <CivilCard
                size="hero"
                name={profileDisplayName}
                avatarAlt={profileDisplayName}
                avatarInitials={displayInitials}
                avatarSrc={avatarDisplayUrl}
                coverUrl={coverDisplayUrl}
                isVerified={Boolean(viewer?.isVerified)}
                isBusiness={Boolean(viewer?.isPremium)}
                interactive={false}
                className="w-full"
              />
            </section>

            <section className="surface-card p-6 shadow-subtle">
              <header className="mb-4">
                <h1 className="text-lg font-semibold text-gray-900">Profile details</h1>
                <p className="text-sm text-gray-500">Update the basics that other members see.</p>
              </header>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="h-14 w-14 overflow-hidden rounded-full bg-gray-200">
                  <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-gray-500">
                    {displayInitials}
                  </div>
                </div>
                <div className="flex-1 space-y-3">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700">
                      First name
                      <input
                        type="text"
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        disabled={formDisabled}
                        className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                        placeholder="Jane"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Last name
                      <input
                        type="text"
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        disabled={formDisabled}
                        className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                        placeholder="Citizen"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Date of birth
                      <input
                        type="date"
                        value={dateOfBirth}
                        onChange={(event) => setDateOfBirth(event.target.value)}
                        disabled={formDisabled}
                        className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 sm:col-span-2">
                      Country of birth
                      <div className="relative mt-1">
                        <div className="relative w-full rounded-full border border-slate-200 bg-white/90 shadow-sm transition focus-within:border-[var(--cc-primary)] focus-within:bg-white">
                          <HiOutlineMagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="search"
                            value={countryOfBirth}
                            onChange={(event) => setCountryOfBirth(event.target.value)}
                            onFocus={handleCountrySearchFocus}
                            onBlur={handleCountrySearchBlur}
                            disabled={formDisabled}
                            className="w-full bg-transparent py-2.5 pl-11 pr-4 text-sm text-slate-800 focus:outline-none placeholder:text-slate-500"
                            placeholder="Search countries"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                          />
                        </div>
                        {showCountryResults ? (
                          <div
                            className="absolute left-0 top-[calc(100%+0.5rem)] z-20 w-full rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-2xl shadow-slate-900/10 backdrop-blur"
                            onMouseDown={(event) => event.preventDefault()}
                          >
                            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                              {filteredCountryOptions.map((country) => (
                                <li key={country.code}>
                                  <button
                                    type="button"
                                    onClick={() => handleCountrySelect(country.label)}
                                    className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                                  >
                                    <span className="font-medium text-slate-900">{country.label}</span>
                                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{country.code}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">Search from the full country list and choose the closest match.</p>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={shareDateOfBirth}
                        onChange={(event) => setShareDateOfBirth(event.target.checked)}
                        disabled={formDisabled}
                        className="mt-1"
                      />
                      <span>
                        <span className="block font-medium text-slate-900">Share my date of birth?</span>
                        <span className="block text-slate-600">Enabled by default so other members can see it on your profile.</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={shareCountryOfBirth}
                        onChange={(event) => setShareCountryOfBirth(event.target.checked)}
                        disabled={formDisabled}
                        className="mt-1"
                      />
                      <span>
                        <span className="block font-medium text-slate-900">Share my country of birth?</span>
                        <span className="block text-slate-600">Enabled by default so other members can see it on your profile.</span>
                      </span>
                    </label>
                  </div>
                  <p className="text-xs leading-snug text-gray-500">
                    Your public handle updates automatically from your name. Next handle in line will start with{' '}
                    <span className="font-medium text-gray-900">@{previewHandle}</span>. If it's already taken, we'll add a few digits to keep it unique.
                  </p>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">Canadian Status &amp; Work Authorization</p>
                        <p className="text-sm text-slate-700">{currentCivicStatusLabel}</p>
                        {currentWorkAuthorizationLabel ? <p className="text-sm text-slate-600">{currentWorkAuthorizationLabel}</p> : null}
                        {statusUpdatedLabel ? <p className="text-xs text-slate-500">Last updated {statusUpdatedLabel}</p> : null}
                      </div>
                      <Link
                        href="/verify?mode=edit"
                        className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
                      >
                        Edit
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="surface-card p-6 shadow-subtle">
              <header className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Bio</h2>
                <p className="text-sm text-gray-500">Share your story, work, and what you're focused on today.</p>
              </header>
              <RichTextEditor
                value={bio}
                onChange={setBio}
                placeholder="Tell other citizens about yourself"
                minHeight={200}
                disabled={formDisabled}
              />
            </section>

            <section className="surface-card p-6 shadow-subtle">
              <header className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Experience</h2>
                  <p className="text-sm text-gray-500">Add roles that highlight your public service, community work, or career.</p>
                </div>
                <button
                  type="button"
                  onClick={addExperience}
                  className="border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                  disabled={saving}
                >
                  Add experience
                </button>
              </header>
              <div className="space-y-6">
                {experiences.map((exp, index) => (
                  <div key={exp.key} className="rounded-2xl border border-slate-200 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-800">Position {index + 1}</h3>
                      <button
                        type="button"
                        onClick={() => removeExperience(exp.key)}
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                        disabled={experiences.length === 1 || saving}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <label className="text-sm font-medium text-gray-700">
                        Title
                        <input
                          type="text"
                          value={exp.title}
                          onChange={(event) => handleExperienceChange(exp.key, { title: event.target.value })}
                          disabled={formDisabled}
                          className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                          placeholder="Community Organizer"
                        />
                      </label>
                      <label className="text-sm font-medium text-gray-700">
                        Organization
                        <input
                          type="text"
                          value={exp.organization}
                          onChange={(event) => handleExperienceChange(exp.key, { organization: event.target.value })}
                          onFocus={() => setActiveOrganizationFieldKey(exp.key)}
                          onBlur={() => setActiveOrganizationFieldKey((current) => (current === exp.key ? null : current))}
                          disabled={formDisabled}
                          className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                          placeholder="Civic Association"
                        />
                        {activeOrganizationFieldKey === exp.key ? (
                          <div className="mt-2 space-y-2">
                            {organizationSearching ? <p className="text-xs text-slate-500">Searching Civil organizations…</p> : null}
                            {!organizationSearching && exp.organization.trim().length >= 2 && organizationSearchResults.length === 0 ? (
                              <p className="text-xs text-slate-500">No Civil organizations found.</p>
                            ) : null}
                            {!organizationSearching && organizationSearchResults.length > 0 ? (
                              <ul className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                                {organizationSearchResults.map((org) => (
                                  <li key={org.id}>
                                    <button
                                      type="button"
                                      onMouseDown={(event) => {
                                        event.preventDefault()
                                        void handleOrganizationSelect(exp.key, org)
                                      }}
                                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-slate-50"
                                    >
                                      <div className="h-8 w-8 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                                        {org.logoUrl ? <img src={org.logoUrl} alt="" className="h-full w-full object-cover" /> : null}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-800">{org.name}</p>
                                        <p className="truncate text-xs text-slate-500">/{org.provinceCode.toLowerCase()}/{org.communitySlug}</p>
                                      </div>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            <p className="text-xs text-slate-500">Selecting an organization links it to this experience on your public profile.</p>
                          </div>
                        ) : null}
                        {(() => {
                          const linkedOrg = linkedOrganizationsByExperienceKey[exp.key]
                          if (!linkedOrg) return null
                          return (
                          <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
                            <span className="inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-emerald-300 bg-white">
                              {linkedOrg.logoUrl ? <img src={linkedOrg.logoUrl} alt="" className="h-full w-full object-cover" /> : null}
                            </span>
                            <span className="font-medium">Linked to Civil organization</span>
                            <Link
                              href={`/com/${encodeURIComponent(linkedOrg.provinceCode.toLowerCase())}/${encodeURIComponent(linkedOrg.communitySlug)}/orgs/${encodeURIComponent(linkedOrg.slug)}`}
                              className="ml-auto text-emerald-700 hover:text-emerald-900 hover:underline"
                            >
                              View
                            </Link>
                          </div>
                          )
                        })()}
                      </label>
                      <label className="text-sm font-medium text-gray-700">
                        Location (optional)
                        <input
                          type="text"
                          value={exp.location}
                          onChange={(event) => handleExperienceLocationChange(exp.key, event.target.value)}
                          onFocus={() => setActiveLocationFieldKey(exp.key)}
                          onBlur={() => setActiveLocationFieldKey((current) => (current === exp.key ? null : current))}
                          disabled={formDisabled}
                          className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                          placeholder="Search a Civil community, or choose Remote / Not in Canada"
                        />
                        <p className="mt-1 text-xs text-slate-500">Free text is not saved. Choose a Civil community, Remote, or Not in Canada.</p>
                        {activeLocationFieldKey === exp.key ? (
                          <div className="mt-2 space-y-2">
                            <ul className="space-y-1 rounded-xl border border-slate-200 bg-white p-2">
                              {LOCATION_SPECIAL_OPTIONS.map((option) => (
                                <li key={option.value}>
                                  <button
                                    type="button"
                                    onMouseDown={(event) => {
                                      event.preventDefault()
                                      handleExperienceLocationSelect(exp.key, {
                                        kind: 'special',
                                        value: option.value,
                                        label: option.label,
                                      })
                                    }}
                                    className="w-full rounded-lg px-2 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                                  >
                                    {option.label}
                                  </button>
                                </li>
                              ))}
                            </ul>

                            {communityLocationSearching ? <p className="text-xs text-slate-500">Searching Civil communities…</p> : null}
                            {!communityLocationSearching && exp.location.trim().length >= 2 && communityLocationSearchResults.length === 0 ? (
                              <p className="text-xs text-slate-500">No Civil communities found.</p>
                            ) : null}
                            {!communityLocationSearching && communityLocationSearchResults.length > 0 ? (
                              <ul className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                                {communityLocationSearchResults.map((community) => (
                                  <li key={`${community.provinceCode}:${community.communitySlug}`}>
                                    <button
                                      type="button"
                                      onMouseDown={(event) => {
                                        event.preventDefault()
                                        handleExperienceLocationSelect(exp.key, {
                                          kind: 'community',
                                          provinceCode: community.provinceCode,
                                          communitySlug: community.communitySlug,
                                          label: community.label,
                                        })
                                      }}
                                      className="w-full rounded-lg px-2 py-2 text-left transition hover:bg-slate-50"
                                    >
                                      <p className="truncate text-sm font-semibold text-slate-800">{community.label}</p>
                                      <p className="truncate text-xs text-slate-500">/{community.provinceCode.toLowerCase()}/{community.communitySlug}</p>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ) : null}
                        {(() => {
                          const locationSelection = locationSelectionByExperienceKey[exp.key]
                          if (!locationSelection) return null

                          if (locationSelection.kind === 'community') {
                            return (
                              <div className="mt-2 flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs text-sky-800">
                                <span className="font-medium">Linked to Civil community</span>
                                <span className="truncate text-sky-700">{locationSelection.label}</span>
                                <Link
                                  href={`/${encodeURIComponent(locationSelection.provinceCode.toLowerCase())}/${encodeURIComponent(locationSelection.communitySlug)}`}
                                  className="ml-auto text-sky-700 hover:text-sky-900 hover:underline"
                                >
                                  View
                                </Link>
                              </div>
                            )
                          }

                          return (
                            <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                              <span className="font-medium">Selected location</span>
                              <span className="truncate">{locationSelection.label}</span>
                            </div>
                          )
                        })()}
                      </label>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="text-sm font-medium text-gray-700">
                          Start month
                          <input
                            type="month"
                            value={exp.startDate}
                            onChange={(event) => handleExperienceChange(exp.key, { startDate: event.target.value })}
                            disabled={formDisabled}
                            className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                          />
                        </label>
                        <label className="text-sm font-medium text-gray-700">
                          End month
                          <input
                            type="month"
                            value={exp.endDate}
                            onChange={(event) => handleExperienceChange(exp.key, { endDate: event.target.value })}
                            disabled={formDisabled || exp.current}
                            className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                          />
                        </label>
                      </div>
                    </div>
                    <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={exp.current}
                        onChange={(event) => handleExperienceToggleCurrent(exp.key, event.target.checked)}
                        disabled={formDisabled}
                      />
                      I currently hold this role
                    </label>
                    <label className="mt-4 block text-sm font-medium text-gray-700">
                      Description (optional)
                      <textarea
                        value={exp.description}
                        onChange={(event) => handleExperienceChange(exp.key, { description: event.target.value })}
                        disabled={formDisabled}
                        rows={3}
                        className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                        placeholder="Highlight achievements, initiatives, and impact."
                      />
                    </label>
                  </div>
                ))}
              </div>
            </section>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="bg-[var(--cc-primary)] px-6 py-2 text-sm font-semibold text-white hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </DashboardShell>

      <PhotoUpdateModal
        open={Boolean(photoModalCategory)}
        title={photoModalCategory === 'avatar' ? 'Update profile photo' : 'Update cover photo'}
        subtitle="Share a quick post when you refresh your photo."
        imageUrl={(modalMediaState?.previewUrl || modalMediaState?.serverUrl || (photoModalCategory === 'avatar' ? avatarDisplayUrl : coverDisplayUrl)) ?? null}
        cropperImageUrl={photoModalCategory && activePhotoDraft?.previewUrl ? activePhotoDraft.previewUrl : null}
        aspect={currentPhotoCategory === 'avatar' ? 1 : COVER_ASPECT_RATIO}
        cropShape="rect"
        showGrid={currentPhotoCategory !== 'avatar'}
        crop={activePhotoDraft?.crop ?? { x: 0, y: 0 }}
        zoom={activePhotoDraft?.zoom ?? 1}
        maxZoom={MAX_CROP_ZOOM}
        onCropChange={handleCropChange(currentPhotoCategory)}
        onZoomChange={handleZoomChange(currentPhotoCategory)}
        onCropComplete={handleCropComplete(currentPhotoCategory)}
        onResetPosition={() => resetPhotoDraftCrop(currentPhotoCategory)}
        onPickFile={() => {
          if (!photoModalCategory) return
          openFilePicker(photoModalCategory)
        }}
        uploadStatus={modalMediaState?.status}
        uploadError={modalMediaState?.error}
        caption={photoCaption}
        onCaptionChange={setPhotoCaption}
        primaryLabel="Post update"
        primaryDisabled={photoPosting || !canSubmitPhoto}
        primaryLoading={photoPosting}
        onPrimary={handlePostPhoto}
        onClose={closePhotoModal}
      />
    </div>
  )
}
