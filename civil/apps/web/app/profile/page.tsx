"use client"

import Link from 'next/link'
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HiOutlineUserCircle, HiOutlineBuildingOffice2, HiOutlineUsers, HiOutlineCreditCard } from 'react-icons/hi2'
import type { IconType } from 'react-icons'
import { buildHandleBase, MediaCategory } from '@civil/shared'
import Sidebar from '../_components/Sidebar'
import RichTextEditor from '../_components/RichTextEditor'
import { pushToast } from '../_components/useToasts'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildApiUrl } from '../_lib/api'
import { hasHomeChamber, type MeResponse } from '../_lib/me'

type Viewer = {
  id: string
  handle: string
  name?: string | null
  avatarUrl?: string | null
  isPremium?: boolean
  premiumSince?: string | null
  premiumRenewsAt?: string | null
}

type ExperienceResponse = {
  id: string
  title: string
  organization: string
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
    createdAt?: string | null
    experiences?: ExperienceResponse[]
  }
  stats: {
    followers: number
    following: number
    chambersFollowing: number
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

const MB = 1024 * 1024
const MEDIA_LIMITS: Record<ProfileMediaCategory, number> = {
  avatar: 8 * MB,
  cover: 20 * MB,
}
const MEDIA_LABELS: Record<ProfileMediaCategory, string> = {
  avatar: 'profile photo',
  cover: 'cover photo',
}
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')
const VARIANT_PRIORITY: Record<ProfileMediaCategory, string[]> = {
  avatar: ['avatar@2x', 'avatar@1x', 'avatar-thumb'],
  cover: ['cover-xl', 'cover-lg', 'cover-md'],
}
const POLL_MAX_ATTEMPTS = 30
const POLL_DELAY_MS = 3000

const IconCheckCircle = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconCalendar = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5">
    <rect x="4" y="5.5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 3.5v4M16 3.5v4M4 10h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

const IconCreditCard = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5">
    <rect x="3" y="5.5" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M3 10.5h18M7 15.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

type LauncherLink = {
  key: string
  label: string
  description: string
  href: string
  icon: IconType
  cta?: string
}

const SETTINGS_LAUNCHER_LINKS: LauncherLink[] = [
  {
    key: 'profile',
    label: 'Profile',
    description: 'Update your photos, name, bio, and experiences.',
    href: '#profile-details',
    icon: HiOutlineUserCircle,
    cta: 'Edit profile',
  },
  {
    key: 'chambers',
    label: 'Chambers',
    description: 'Change your home riding or explore new chambers.',
    href: '/chambers',
    icon: HiOutlineBuildingOffice2,
    cta: 'Open chambers',
  },
  {
    key: 'connections',
    label: 'Connections',
    description: 'Review followers, following, and chamber memberships.',
    href: '#connections-card',
    icon: HiOutlineUsers,
    cta: 'View stats',
  },
  {
    key: 'billing',
    label: 'Billing',
    description: 'Manage premium, organizations, and payment methods.',
    href: '/settings/billing',
    icon: HiOutlineCreditCard,
    cta: 'Manage billing',
  },
]

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

const MAX_EXPERIENCES = 50

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

function generateKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
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
  const [token, setToken] = useState<string | null>(null)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [profile, setProfile] = useState<ProfileResponse | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [bio, setBio] = useState('')
  const [experiences, setExperiences] = useState<ExperienceFormState[]>([emptyExperience()])
  const [avatarMedia, setAvatarMedia] = useState<MediaSlotState>(() => createMediaState())
  const [coverMedia, setCoverMedia] = useState<MediaSlotState>(() => createMediaState())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

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

  const handleMediaUpload = useCallback(
    async (category: ProfileMediaCategory, file: File) => {
      if (!token) {
        pushToast('You must be signed in to upload photos.', 'error')
        redirectToAuthModal('login')
        return
      }

      const limit = MEDIA_LIMITS[category]
      if (file.size > limit) {
        pushToast(`Your ${MEDIA_LABELS[category]} must be ${formatFileSize(limit)} or smaller.`, 'error')
        return
      }

      if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
        pushToast('Please choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF image.', 'error')
        return
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
          const reason = payload?.error
          if (reason === 'file_too_large') {
            pushToast(`That file is larger than ${formatFileSize(limit)}.`, 'error')
          } else if (reason === 'unsupported_mime') {
            pushToast('We can only accept JPG, PNG, WebP, AVIF, HEIC, or HEIF files.', 'error')
          } else {
            pushToast(`We couldn't start uploading your ${friendlyLabel}.`, 'error')
          }
          updateMediaState(category, (prev) => ({
            ...prev,
            status: 'error',
            error: 'Upload could not be started.',
            previewUrl: prev.serverUrl ? null : prev.previewUrl,
          }))
          return
        }

        const initPayload = await initRes.json()
        const assetId: string = initPayload.assetId
        const upload: { url: string; method: string; headers?: Record<string, string> } = initPayload.upload
        const proxyPath: string | null = typeof initPayload?.proxyPath === 'string' ? initPayload.proxyPath : null
        const shouldAttemptDirectUpload = (() => {
          if (!upload?.url) {
            return false
          }
          try {
            const parsed = new URL(upload.url)
            if (typeof window !== 'undefined' && window.location.protocol === 'https:' && parsed.protocol === 'http:') {
              return false
            }
          } catch (err) {
            console.warn('Unable to parse upload URL; defaulting to proxy.', err)
            return false
          }
          return true
        })()

        updateMediaState(category, (prev) => ({
          ...prev,
          pendingId: assetId,
        }))

        let uploadSucceeded = false
        let uploadError: unknown = null
        if (shouldAttemptDirectUpload) {
          try {
            const uploadRes = await fetch(upload.url, {
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
          pushToast(`We couldn't upload your ${friendlyLabel}. Please try again.`, 'error')
          updateMediaState(category, (prev) => ({
            ...prev,
            status: 'error',
            pendingId: null,
            previewUrl: prev.serverUrl ? null : prev.previewUrl,
            error: 'Upload failed before processing.',
          }))
          return
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
          pushToast(`We couldn't process your ${friendlyLabel}.`, 'error')
          updateMediaState(category, (prev) => ({
            ...prev,
            status: 'error',
            pendingId: null,
            error: 'Processing could not be scheduled.',
          }))
          return
        }

        updateMediaState(category, (prev) => ({
          ...prev,
          currentId: assetId,
          pendingId: null,
          processingId: assetId,
          status: 'processing',
          error: null,
        }))
      } catch (err) {
        console.error('Failed uploading media', err)
        pushToast(`We couldn't upload your ${friendlyLabel}. Please try again.`, 'error')
        updateMediaState(category, (prev) => ({
          ...prev,
          status: 'error',
          pendingId: null,
          processingId: null,
          error: 'Something went wrong during upload.',
          previewUrl: prev.serverUrl ? null : prev.previewUrl,
        }))
      }
    },
    [token, updateMediaState],
  )

  const handleFileInputChange = useCallback(
    (category: ProfileMediaCategory) => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      void handleMediaUpload(category, file)
    },
    [handleMediaUpload],
  )

  const openFilePicker = useCallback(
    (category: ProfileMediaCategory) => {
      const ref = category === 'avatar' ? avatarInputRef : coverInputRef
      ref.current?.click()
    },
    [],
  )

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
  const res = await fetch(buildApiUrl('/auth/me'), {
        headers: {
          authorization: `Bearer ${storedToken}`,
        },
      })
      if (!res.ok) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('token')
          redirectToAuthModal('login')
        }
        return null
      }
      const data: MeResponse = await res.json()
      if (!hasHomeChamber(data)) {
        window.location.replace('/welcome')
        return null
      }
      setViewer({
        id: data.id,
        handle: data.handle,
        name: data.name,
        avatarUrl: data.avatarUrl,
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
        window.localStorage.removeItem('token')
        redirectToAuthModal('login')
      }
      return null
    }
  }, [])

  const mapExperiencesFromResponse = useCallback((items?: ExperienceResponse[] | null) => {
    if (!items || items.length === 0) {
      return [emptyExperience()]
    }
    return items.map((exp) => ({
      key: exp.id || generateKey(),
      title: exp.title ?? '',
      organization: exp.organization ?? '',
      location: exp.location ?? '',
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
              window.localStorage.removeItem('token')
              redirectToAuthModal('login')
            }
            return
          }
          const payload = await res.json().catch(() => ({}))
          const message = typeof payload?.error === 'string' ? payload.error : 'Unable to load your profile.'
          setError(message)
          return
        }
        const data: ProfileResponse = await res.json()
        setProfile(data)
        setFirstName(data.user.firstName ?? '')
        setLastName(data.user.lastName ?? '')
        setBio(data.user.bio ?? '')
        setExperiences(mapExperiencesFromResponse(data.user.experiences))
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

  const handleExperienceChange = useCallback((key: string, patch: Partial<ExperienceFormState>) => {
    setExperiences((prev) => prev.map((exp) => (exp.key === key ? { ...exp, ...patch } : exp)))
  }, [])

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
      const location = exp.location.trim()
      const description = exp.description.trim()
      const hasAnyValue = Boolean(
        title ||
          organization ||
          location ||
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
          bio,
          experiences: normalizedExperiences,
          avatarMediaId: avatarMedia.currentId ?? undefined,
          coverMediaId: coverMedia.currentId ?? undefined,
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        const rawError =
          typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.error?.message === 'string'
            ? payload.error.message
            : null

        const friendlyErrorMap: Record<string, string> = {
          experiences_not_available:
            'Your experiences were not saved because the update is still deploying. Please try again in a moment.',
        }

        const message = rawError ? friendlyErrorMap[rawError] ?? rawError : 'We could not save your profile. Please try again.'
        pushToast(message, 'error', 6000)
        return
      }

      pushToast('Your profile was updated.', 'success')
      await loadProfile(token)
    } catch (err) {
      console.error('Failed updating profile', err)
      pushToast('We ran into a problem saving your profile. Please try again shortly.', 'error', 6000)
    } finally {
      setSaving(false)
    }
  }, [avatarMedia.currentId, bio, coverMedia.currentId, experiences, firstName, lastName, loadProfile, token])

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
        window.localStorage.removeItem('token')
        window.location.replace('/')
      }
    }
  }, [token])

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      await saveProfile()
    },
    [saveProfile],
  )

  const formDisabled = saving || loading
  const joinDate = profile?.user?.createdAt ? formatMonthYear(profile.user.createdAt) : ''
  const premiumActive = Boolean(viewer?.isPremium)
  const premiumRenews = viewer?.premiumRenewsAt ? formatMonthYear(viewer.premiumRenewsAt) : ''
  const premiumRenewLabel = premiumRenews ? `Renews ${premiumRenews}` : 'Auto-renews monthly'

  const displayInitials = useMemo(() => {
    return (
      initialsFromUser({
        name: profile?.user?.name,
        handle: profile?.user?.handle,
      }) || 'C'
    )
  }, [profile])

  const avatarDisplayUrl = avatarMedia.previewUrl ?? avatarMedia.serverUrl ?? profile?.user?.avatarUrl ?? viewer?.avatarUrl ?? null
  const coverDisplayUrl = coverMedia.previewUrl ?? coverMedia.serverUrl ?? profile?.user?.coverUrl ?? null

  return (
    <div className="min-h-screen">
      <div className="border-b bg-white py-4 shadow-sm lg:hidden">
        <div className="mx-auto max-w-screen-lg px-4">
          <Sidebar me={viewer ?? undefined} active="account" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-8 lg:pr-0 xl:pl-12 xl:pr-0">
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_360px] xl:gap-10">
          <Sidebar me={viewer ?? undefined} active="account" />

          <main className="space-y-6 pt-8">
            <section className="surface-card p-6 shadow-subtle">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Shortcuts</p>
                <h1 className="text-lg font-semibold text-slate-900">Settings launcher</h1>
                <p className="text-sm text-slate-500">Tap a tile to jump directly into the area you need most.</p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {SETTINGS_LAUNCHER_LINKS.map((item) => {
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className="group flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--cc-primary)]/40 hover:bg-white"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[var(--cc-primary)] shadow-inner">
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="text-sm font-semibold text-slate-900">{item.label}</span>
                      </div>
                      <p className="text-xs text-slate-500">{item.description}</p>
                      <span className="text-xs font-semibold text-[var(--cc-primary)] group-hover:underline">{item.cta ?? 'Open'}</span>
                    </Link>
                  )
                })}
              </div>
            </section>

            {viewer ? (
              <section className="surface-card p-6 shadow-subtle">
                <div className="space-y-5">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Membership</p>
                    <h2 className="text-lg font-semibold text-slate-900">
                      {premiumActive ? 'Premium member' : 'Boost your credibility with Premium'}
                    </h2>
                    <p className="text-sm text-slate-500">
                      Premium unlocks trust badges, early business tools, and concierge support when you need help.
                    </p>
                  </div>

                  {premiumActive ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 shadow-sm">
                        <div className="flex items-center gap-3 text-sm font-semibold text-emerald-800">
                          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-inner">
                            <IconCheckCircle />
                          </span>
                          Plan status
                        </div>
                        <p className="mt-3 text-base font-semibold text-emerald-900">Active plan</p>
                        <p className="text-xs text-emerald-700">Maple badge is live across your profile.</p>
                      </div>

                      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 shadow-sm">
                        <div className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-600 shadow-inner">
                            <IconCalendar />
                          </span>
                          Renewal
                        </div>
                        <p className="mt-3 text-base font-semibold text-slate-900">{premiumRenewLabel}</p>
                        <p className="text-xs text-slate-500">Update payment details anytime.</p>
                      </div>

                      <Link
                        href="/settings/billing"
                        className="group rounded-2xl border border-[var(--cc-primary)]/30 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--cc-primary)]/60"
                      >
                        <div className="flex items-center gap-3 text-sm font-semibold text-[var(--cc-primary)]">
                          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]">
                            <IconCreditCard />
                          </span>
                          Billing
                        </div>
                        <p className="mt-3 text-base font-semibold text-slate-900">Manage subscription</p>
                        <p className="text-xs font-semibold text-[var(--cc-primary)] group-hover:underline">Open billing</p>
                      </Link>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 shadow-sm">
                        <div className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-inner">
                            <IconCheckCircle />
                          </span>
                          Plan status
                        </div>
                        <p className="mt-3 text-base font-semibold text-slate-900">Free member</p>
                        <p className="text-xs text-slate-500">Unlock premium to add verification.</p>
                      </div>

                      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 shadow-sm">
                        <div className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-inner">
                            <IconCalendar />
                          </span>
                          Why upgrade?
                        </div>
                        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-500">
                          <li>Trusted maple badge on posts.</li>
                          <li>Organization + hiring pages.</li>
                          <li>Concierge moderation support.</li>
                        </ul>
                      </div>

                      <Link
                        href="/settings/billing"
                        className="rounded-2xl border border-[var(--cc-primary)] bg-[var(--cc-primary)]/5 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--cc-primary)]/10"
                      >
                        <div className="flex items-center gap-3 text-sm font-semibold text-[var(--cc-primary)]">
                          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-[var(--cc-primary)] shadow-inner">
                            <IconCreditCard />
                          </span>
                          Upgrade now
                        </div>
                        <p className="mt-3 text-base font-semibold text-slate-900">$9.99 / month</p>
                        <p className="text-xs font-semibold text-[var(--cc-primary)]">Tap to start checkout</p>
                      </Link>
                    </div>
                  )}
                </div>
              </section>
            ) : null}
            {error ? (
              <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <section id="profile-details" className="surface-card p-6 shadow-subtle">
                  <header className="mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Photos</h2>
                    <p className="text-sm text-gray-500">Upload a cover and profile photo to personalize your profile.</p>
                  </header>
                  <div className="space-y-6">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-gray-800">Cover photo</p>
                          <p className="text-xs text-gray-500">Shown at the top of your public profile.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openFilePicker('cover')}
                          className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={formDisabled || coverMedia.status === 'uploading'}
                        >
                          {coverMedia.status === 'uploading' ? 'Uploading…' : 'Upload cover'}
                        </button>
                      </div>
                      <div className="relative h-40 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-slate-100 to-slate-200">
                        {coverDisplayUrl ? (
                          <img src={coverDisplayUrl} alt="Cover preview" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">Add a cover photo</div>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-gray-500">
                        Up to {formatFileSize(MEDIA_LIMITS.cover)}. Supported: JPG, PNG, WebP, AVIF, HEIC.
                      </p>
                      {coverMedia.status === 'processing' ? <p className="text-xs text-amber-600">Processing your new cover…</p> : null}
                      {coverMedia.error ? <p className="text-xs text-red-600">{coverMedia.error}</p> : null}
                    </div>

                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-lg font-semibold text-slate-600">
                        {avatarDisplayUrl ? <img src={avatarDisplayUrl} alt="Profile preview" className="h-full w-full object-cover" /> : displayInitials}
                      </div>
                      <div className="space-y-1 text-sm text-gray-600">
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => openFilePicker('avatar')}
                            className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={formDisabled || avatarMedia.status === 'uploading'}
                          >
                            {avatarMedia.status === 'uploading' ? 'Uploading…' : 'Upload photo'}
                          </button>
                          {avatarMedia.status === 'processing' ? <span className="text-xs text-amber-600">Processing your new photo…</span> : null}
                        </div>
                        <p className="text-xs text-gray-500">
                          Up to {formatFileSize(MEDIA_LIMITS.avatar)}. Supported: JPG, PNG, WebP, AVIF, HEIC.
                        </p>
                        {avatarMedia.error ? <p className="text-xs text-red-600">{avatarMedia.error}</p> : null}
                      </div>
                    </div>
                  </div>
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
                      </div>
                      <p className="text-xs leading-snug text-gray-500">
                        Your public handle updates automatically from your name. Next handle in line will start with{' '}
                        <span className="font-medium text-gray-900">@{previewHandle}</span>. If it's already taken, we'll add a few digits to keep it unique.
                      </p>
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
                              disabled={formDisabled}
                              className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                              placeholder="Civic Association"
                            />
                          </label>
                          <label className="text-sm font-medium text-gray-700">
                            Location (optional)
                            <input
                              type="text"
                              value={exp.location}
                              onChange={(event) => handleExperienceChange(exp.key, { location: event.target.value })}
                              disabled={formDisabled}
                              className="mt-1 w-full border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                              placeholder="Ottawa, ON"
                            />
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
          </main>

        <aside className="hidden pt-8 lg:block">
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
                  <span>Followers</span>
                  <span className="text-base font-semibold text-slate-900">{profile?.stats?.followers ?? 0}</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Following</span>
                  <span className="text-base font-semibold text-slate-900">{profile?.stats?.following ?? 0}</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Chambers</span>
                  <span className="text-base font-semibold text-slate-900">{profile?.stats?.chambersFollowing ?? 0}</span>
                </li>
              </ul>
            </section>

            {profile?.homeChamber ? (
              <section className="surface-card space-y-3 p-5 shadow-subtle">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Home chamber</p>
                <div className="text-sm text-slate-600">
                  <div className="text-base font-semibold text-slate-900">
                    {profile.homeChamber.chamberName ?? profile.homeChamber.chamberSlug}
                  </div>
                  <div className="text-slate-500">
                    {profile.homeChamber.provinceName ?? profile.homeChamber.provinceCode}
                  </div>
                </div>
              </section>
            ) : null}

            <section className="surface-card space-y-4 p-5 shadow-subtle">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Experience preview</h2>
              <div className="space-y-4">
                {experiences.length === 0 ? (
                  <p className="text-sm text-slate-500">Add at least one experience to highlight your work.</p>
                ) : (
                  experiences.map((exp) => (
                    <div key={exp.key} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">{exp.title || 'Role title'}</div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">{exp.organization || 'Organization'}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatMonthYear(monthInputToIso(exp.startDate) ?? undefined)}
                        {exp.current
                          ? ' – Present'
                          : exp.endDate
                          ? ` – ${formatMonthYear(monthInputToIso(exp.endDate) ?? undefined)}`
                          : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>
      </div>
    </div>
  )
}
