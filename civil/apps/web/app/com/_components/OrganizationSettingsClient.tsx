'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Area } from 'react-easy-crop'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { pushToast } from '../../_components/useToasts'
import { redirectToAuthModal } from '../../_lib/authModal'
import type { CommunityOrganization } from '../../_lib/organizations'
import { formatUserDisplayName } from '../../_lib/text'
import VerifiedAvatar from '../../_components/VerifiedAvatar'
import Modal from '../../_components/Modal'
import PhotoUpdateModal from '../../_components/PhotoUpdateModal'
import RichTextEditor from '../../_components/RichTextEditor'
import { computeFallbackCropArea, generateCroppedImageBlob, readImageDimensions } from '../../_lib/imageCrop'

type MeResponse = {
  id: string
}

type MediaUploadInitResponse = {
  assetId: string
  upload?: {
    url?: string
    method?: string
    headers?: Record<string, string>
  }
  proxyPath?: string
  maxBytes?: number
}

type MediaAssetStatusResponse = {
  asset?: {
    id: string
    status: 'pending' | 'processing' | 'ready' | 'failed'
    failureReason?: string | null
  }
}

type OrgMemberItem = {
  userId: string
  role: 'OWNER' | 'MANAGER'
  joinedAt: string | null
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
  }
}

type OrgFollowerItem = {
  userId: string
  role: 'FOLLOWER'
  joinedAt: string | null
  user: {
    id: string
    handle: string
    name: string | null
    avatarUrl: string | null
  }
}

type OrgMembersResponse = {
  members?: OrgMemberItem[]
  followers?: OrgFollowerItem[]
}

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')

const MB = 1024 * 1024
const MEDIA_LIMITS = {
  business_logo: 8 * MB,
  business_cover: 20 * MB,
  post_image: 25 * MB,
} as const

type BusinessMediaCategory = 'business_logo' | 'business_cover'
type UploadStatus = 'idle' | 'uploading' | 'processing' | 'ready' | 'error'

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

const COVER_EXPORT_WIDTH = 1920
const COVER_EXPORT_HEIGHT = 640
const COVER_ASPECT_RATIO = COVER_EXPORT_WIDTH / COVER_EXPORT_HEIGHT
const LOGO_EXPORT_SIZE = 1024
const MAX_CROP_ZOOM = 3
const HEADLINE_MAX_CHARS = 60

function normalizeRichText(value: string | null | undefined): string {
  const source = (value ?? '').trim()
  if (!source) return ''
  const textOnly = source.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim()
  return textOnly ? source : ''
}

async function waitForAssetReady(token: string, assetId: string, label: string) {
  const POLL_MAX_ATTEMPTS = 30
  const POLL_DELAY_MS = 3000

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(buildApiUrl(`/media/assets/${encodeURIComponent(assetId)}`), {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (res.ok) {
      const payload = (await res.json().catch(() => null)) as MediaAssetStatusResponse | null
      const status = payload?.asset?.status
      if (status === 'ready') return true
      if (status === 'failed') {
        const reason = payload?.asset?.failureReason ? ` (${payload.asset.failureReason})` : ''
        throw new Error(`Your ${label} could not be processed${reason}.`)
      }
    }

    await new Promise((r) => setTimeout(r, POLL_DELAY_MS))
  }

  throw new Error(`Your ${label} is taking longer than expected to process. Please refresh in a moment.`)
}

export default function OrganizationSettingsClient({
  province,
  municipality,
  slug,
}: {
  province: string
  municipality: string
  slug: string
}) {
  const [org, setOrg] = useState<CommunityOrganization | null>(null)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [details, setDetails] = useState({
    phone: '',
    websiteUrl: '',
    address: '',
    schedule: '',
  })
  const [detailsDirty, setDetailsDirty] = useState(false)
  const [organizationName, setOrganizationName] = useState('')
  const [organizationNameSaving, setOrganizationNameSaving] = useState(false)
  const [profileHeadline, setProfileHeadline] = useState('')
  const [profileAbout, setProfileAbout] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [members, setMembers] = useState<OrgMemberItem[]>([])
  const [followers, setFollowers] = useState<OrgFollowerItem[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [memberActionUserId, setMemberActionUserId] = useState<string | null>(null)
  const [visibilitySaving, setVisibilitySaving] = useState(false)

  const [photoModalCategory, setPhotoModalCategory] = useState<BusinessMediaCategory | null>(null)
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoPosting, setPhotoPosting] = useState(false)
  const [drafts, setDrafts] = useState<Record<BusinessMediaCategory, PhotoDraftState>>(() => ({
    business_logo: createPhotoDraftState(),
    business_cover: createPhotoDraftState(),
  }))
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const logoInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('token') : null), [])
  const canManage = Boolean(org?.viewerRole === 'OWNER' || org?.viewerRole === 'MANAGER' || (me?.id && org?.ownerId && me.id === org.ownerId))
  const isOwner = Boolean(org?.viewerRole === 'OWNER' || (me?.id && org?.ownerId && me.id === org.ownerId))
  const canSaveOrganizationName = Boolean(isOwner && org && organizationName.trim().length >= 3 && organizationName.trim() !== org.name)
  const profileHeadlineTrimmed = profileHeadline.trim().slice(0, HEADLINE_MAX_CHARS)
  const profileAboutNormalized = normalizeRichText(profileAbout)
  const canSaveProfile = Boolean(
    org &&
      (profileHeadlineTrimmed !== (org.headline ?? '').trim() ||
        profileAboutNormalized !== normalizeRichText(org.description)),
  )
  const deleteConfirmationMatches = Boolean(org && deleteConfirmName.trim() === org.name.trim())

  const orgApiPath = useMemo(() => {
    return `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`
  }, [municipality, province, slug])

  const loadMembers = useCallback(async () => {
    if (!token) {
      setMembers([])
      setFollowers([])
      return
    }
    setMembersLoading(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/members`), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        setMembers([])
        setFollowers([])
        return
      }
      const { json } = await parseApiResponse<OrgMembersResponse>(res)
      setMembers(Array.isArray(json?.members) ? json.members : [])
      setFollowers(Array.isArray(json?.followers) ? json.followers : [])
    } catch {
      setMembers([])
      setFollowers([])
    } finally {
      setMembersLoading(false)
    }
  }, [orgApiPath, token])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [meRes, orgRes] = await Promise.all([
        token
          ? fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
          : Promise.resolve(null),
        fetch(buildApiUrl(orgApiPath), { headers: token ? { authorization: `Bearer ${token}` } : undefined, cache: 'no-store' }),
      ])

      if (meRes && meRes.ok) {
        const payload = (await meRes.json().catch(() => null)) as MeResponse | null
        setMe(payload?.id ? payload : null)
      } else {
        setMe(null)
      }

      if (orgRes.ok) {
        const payload = (await orgRes.json().catch(() => null)) as { org?: CommunityOrganization } | null
        setOrg(payload?.org ?? null)
      } else {
        setOrg(null)
      }
    } finally {
      setLoading(false)
    }
  }, [orgApiPath, token])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  useEffect(() => {
    if (!org) return
    setOrganizationName(org.name)
    setProfileHeadline((org.headline ?? '').slice(0, HEADLINE_MAX_CHARS))
    setProfileAbout(org.description ?? '')
    setDetails({
      phone: org.phone ?? '',
      websiteUrl: org.websiteUrl ?? '',
      address: org.address ?? '',
      schedule: org.schedule ?? '',
    })
    setDetailsDirty(false)
    setDeleteConfirmName('')
  }, [org])

  const saveDetails = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!org) return

    setSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/settings`), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          phone: details.phone.trim() ? details.phone.trim() : null,
          websiteUrl: details.websiteUrl.trim() ? details.websiteUrl.trim() : null,
          address: details.address.trim() ? details.address.trim() : null,
          schedule: details.schedule.trim() ? details.schedule.trim() : null,
        }),
      })

      const { json } = await parseApiResponse<{ org?: CommunityOrganization; error?: unknown }>(res)
      if (!res.ok) {
        if (res.status === 403) {
          pushToast('Only organization admins can edit these settings.', 'error')
        } else {
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to save organization details right now.', 'error')
        }
        return
      }

      setOrg(json?.org ?? org)
      setDetailsDirty(false)
      pushToast('Saved organization details.', 'success')
    } catch (err) {
      console.error('Failed to save organization details', err)
      pushToast('Unable to save organization details right now.', 'error')
    } finally {
      setSaving(false)
    }
  }, [details.address, details.phone, details.schedule, details.websiteUrl, org, orgApiPath, token])

  const saveOrganizationName = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!org || !isOwner) return

    const nextName = organizationName.trim()
    if (nextName.length < 3) {
      pushToast('Organization name must be at least 3 characters.', 'error')
      return
    }
    if (nextName === org.name) return

    setOrganizationNameSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/settings`), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: nextName }),
      })

      const { json } = await parseApiResponse<{ org?: CommunityOrganization; error?: unknown }>(res)
      if (!res.ok) {
        if (res.status === 403) {
          pushToast('Only the organization owner can rename this organization.', 'error')
        } else {
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to rename this organization right now.', 'error')
        }
        return
      }

      if (json?.org) setOrg(json.org)
      pushToast('Organization renamed. Followers received a rename post.', 'success')
    } catch (err) {
      console.error('Failed to rename organization', err)
      pushToast('Unable to rename this organization right now.', 'error')
    } finally {
      setOrganizationNameSaving(false)
    }
  }, [isOwner, org, orgApiPath, organizationName, token])

  const saveProfileDetails = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!org) return

    setProfileSaving(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/settings`), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          headline: profileHeadlineTrimmed || null,
          description: profileAboutNormalized || null,
        }),
      })

      const { json } = await parseApiResponse<{ org?: CommunityOrganization; error?: unknown }>(res)
      if (!res.ok) {
        if (res.status === 403) {
          pushToast('Only organization admins can edit profile details.', 'error')
        } else {
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to save organization profile right now.', 'error')
        }
        return
      }

      if (json?.org) setOrg(json.org)
      pushToast('Saved organization profile.', 'success')
    } catch (err) {
      console.error('Failed to save organization profile', err)
      pushToast('Unable to save organization profile right now.', 'error')
    } finally {
      setProfileSaving(false)
    }
  }, [org, orgApiPath, profileAboutNormalized, profileHeadlineTrimmed, token])

  const closeDeleteModal = useCallback(() => {
    if (deleteSaving) return
    setDeleteModalOpen(false)
    setDeleteConfirmName('')
  }, [deleteSaving])

  const deleteOrganization = useCallback(async () => {
    if (!token) {
      redirectToAuthModal('login')
      return
    }
    if (!org || !isOwner) return
    if (!deleteConfirmationMatches) {
      pushToast('Type the organization name to confirm deletion.', 'error')
      return
    }

    setDeleteSaving(true)
    try {
      const res = await fetch(buildApiUrl(orgApiPath), {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      const { json } = await parseApiResponse<{ error?: unknown }>(res)
      if (!res.ok) {
        if (res.status === 403) {
          pushToast('Only the organization owner can delete this organization.', 'error')
        } else {
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to delete this organization right now.', 'error')
        }
        return
      }

      setDeleteModalOpen(false)
      setDeleteConfirmName('')
      pushToast('Organization deleted.', 'success')
      window.location.href = '/organizations/manager'
    } catch (err) {
      console.error('Failed to delete organization', err)
      pushToast('Unable to delete this organization right now.', 'error')
    } finally {
      setDeleteSaving(false)
    }
  }, [deleteConfirmationMatches, isOwner, org, orgApiPath, token])

  const toggleVisibility = useCallback(async () => {
    if (!token || !org || !canManage) return
    const currentlyPublic = org.status === 'ACTIVE'
    setVisibilitySaving(true)
    try {
      const res = await fetch(buildApiUrl(`${orgApiPath}/settings`), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isPublic: !currentlyPublic }),
      })
      const { json } = await parseApiResponse<{ org?: CommunityOrganization; error?: unknown }>(res)
      if (!res.ok) {
        const rawError =
          typeof (json as any)?.error === 'string'
            ? (json as any).error
            : typeof (json as any)?.error?.message === 'string'
              ? (json as any).error.message
              : null
        pushToast(rawError ?? 'Unable to update visibility right now.', 'error')
        return
      }
      if (json?.org) setOrg(json.org)
      pushToast(!currentlyPublic ? 'Organization is now public.' : 'Organization is now private.', 'success')
    } catch {
      pushToast('Unable to update visibility right now.', 'error')
    } finally {
      setVisibilitySaving(false)
    }
  }, [canManage, org, orgApiPath, token])

  const promoteFollower = useCallback(
    async (targetUserId: string) => {
      if (!token || !isOwner) return
      setMemberActionUserId(targetUserId)
      try {
        const res = await fetch(buildApiUrl(`${orgApiPath}/members/${encodeURIComponent(targetUserId)}/promote`), {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          const { json } = await parseApiResponse<{ error?: unknown }>(res)
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to promote this member right now.', 'error')
          return
        }
        pushToast('Promoted to manager.', 'success')
        await loadMembers()
      } catch {
        pushToast('Unable to promote this member right now.', 'error')
      } finally {
        setMemberActionUserId(null)
      }
    },
    [isOwner, loadMembers, orgApiPath, token],
  )

  const removeMember = useCallback(
    async (targetUserId: string) => {
      if (!token || !isOwner) return
      setMemberActionUserId(targetUserId)
      try {
        const res = await fetch(buildApiUrl(`${orgApiPath}/members/${encodeURIComponent(targetUserId)}`), {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          const { json } = await parseApiResponse<{ error?: unknown }>(res)
          const rawError =
            typeof (json as any)?.error === 'string'
              ? (json as any).error
              : typeof (json as any)?.error?.message === 'string'
                ? (json as any).error.message
                : null
          pushToast(rawError ?? 'Unable to remove this member right now.', 'error')
          return
        }
        pushToast('Member removed.', 'success')
        await loadMembers()
      } catch {
        pushToast('Unable to remove this member right now.', 'error')
      } finally {
        setMemberActionUserId(null)
      }
    },
    [isOwner, loadMembers, orgApiPath, token],
  )

  const updateDraft = useCallback((category: BusinessMediaCategory, updater: (prev: PhotoDraftState) => PhotoDraftState) => {
    setDrafts((prev) => ({ ...prev, [category]: updater(prev[category]) }))
  }, [])

  const launchPhotoFlow = useCallback((category: BusinessMediaCategory, triggerPicker = true) => {
    setPhotoModalCategory(category)
    setPhotoCaption('')
    setUploadError(null)
    setUploadStatus('idle')
    if (triggerPicker) {
      setTimeout(() => {
        const ref = category === 'business_logo' ? logoInputRef : coverInputRef
        ref.current?.click()
      }, 0)
    }
  }, [])

  const closePhotoModal = useCallback(() => {
    setPhotoModalCategory(null)
    setPhotoCaption('')
    setUploadError(null)
    setUploadStatus('idle')
    setPhotoPosting(false)
  }, [])

  const openFilePicker = useCallback((category: BusinessMediaCategory) => {
    const ref = category === 'business_logo' ? logoInputRef : coverInputRef
    ref.current?.click()
  }, [])

  const handleCropChange = useCallback(
    (category: BusinessMediaCategory) => (nextCrop: { x: number; y: number }) => {
      updateDraft(category, (prev) => ({ ...prev, crop: nextCrop, isDirty: true }))
    },
    [updateDraft],
  )

  const handleZoomChange = useCallback(
    (category: BusinessMediaCategory) => (nextZoom: number) => {
      updateDraft(category, (prev) => ({ ...prev, zoom: nextZoom, isDirty: true }))
    },
    [updateDraft],
  )

  const handleCropComplete = useCallback(
    (category: BusinessMediaCategory) => (_area: Area, nextAreaPixels: Area) => {
      updateDraft(category, (prev) => ({ ...prev, croppedAreaPixels: nextAreaPixels, isDirty: true }))
    },
    [updateDraft],
  )

  const resetPhotoDraftCrop = useCallback(
    (category: BusinessMediaCategory) => {
      updateDraft(category, (prev) => ({ ...prev, crop: { x: 0, y: 0 }, zoom: 1, croppedAreaPixels: null, isDirty: Boolean(prev.file) }))
    },
    [updateDraft],
  )

  const safeParseAbsoluteUrl = useCallback((candidate: string | null | undefined): URL | null => {
    if (!candidate) return null
    try {
      return new URL(candidate)
    } catch {
      return null
    }
  }, [])

  const uploadViaMediaApi = useCallback(
    async (category: keyof typeof MEDIA_LIMITS, file: File) => {
      if (!token) {
        pushToast('You must be signed in to upload organization photos.', 'error')
        redirectToAuthModal('login')
        return null
      }

      const limit = MEDIA_LIMITS[category]
      if (file.size > limit) {
        pushToast(`That file is too large. Max size is ${(limit / MB).toFixed(0)}MB.`, 'error')
        return null
      }

      if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
        pushToast('Please choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF image.', 'error')
        return null
      }

      setUploadStatus('uploading')
      setUploadError(null)

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
        const { json } = await parseApiResponse<{ error?: unknown }>(initRes)
        console.warn('Upload init failed', json)
        setUploadStatus('error')
        setUploadError('Upload failed.')
        return null
      }

      const initPayload = (await initRes.json().catch(() => null)) as MediaUploadInitResponse | null
      const assetId = initPayload?.assetId
      if (!assetId) {
        setUploadStatus('error')
        setUploadError('Upload failed.')
        return null
      }

      let uploaded = false
      const directUrl = safeParseAbsoluteUrl(initPayload?.upload?.url)
      if (directUrl) {
        try {
          const res = await fetch(directUrl.toString(), {
            method: 'PUT',
            headers: {
              ...(initPayload?.upload?.headers ?? {}),
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

      if (!uploaded) {
        setUploadStatus('error')
        setUploadError('Upload failed.')
        return null
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
        setUploadStatus('error')
        setUploadError('Upload failed.')
        return null
      }

      setUploadStatus('processing')
      try {
        await waitForAssetReady(token, assetId, 'photo')
      } catch (err) {
        setUploadStatus('error')
        setUploadError(err instanceof Error ? err.message : 'Upload failed.')
        return null
      }

      setUploadStatus('ready')
      return assetId
    },
    [safeParseAbsoluteUrl, token],
  )

  const applyPhotoCrop = useCallback(
    async (category: BusinessMediaCategory) => {
      const draft = drafts[category]
      if (!draft.file) {
        pushToast('Upload a photo before posting.', 'error')
        return null
      }

      const desiredAspect = category === 'business_logo' ? 1 : COVER_ASPECT_RATIO
      let cropArea = draft.croppedAreaPixels
      if (!cropArea) {
        const dims = await readImageDimensions(draft.file)
        if (!dims) {
          pushToast('We could not read that photo. Please choose a different one.', 'error')
          return null
        }
        const fallbackArea = computeFallbackCropArea(dims, desiredAspect)
        cropArea = fallbackArea
        updateDraft(category, (prev) => ({ ...prev, croppedAreaPixels: fallbackArea }))
      }

      const exportOptions =
        category === 'business_logo'
          ? { width: LOGO_EXPORT_SIZE, height: LOGO_EXPORT_SIZE, mime: 'image/jpeg' as const, quality: 0.92 }
          : { width: COVER_EXPORT_WIDTH, height: COVER_EXPORT_HEIGHT, mime: 'image/jpeg' as const, quality: 0.92 }

      const blob = await generateCroppedImageBlob(draft.file, cropArea, exportOptions)
      if (!blob) {
        pushToast('We could not crop that image. Please try again with a different photo.', 'error')
        return null
      }

      const baseName = draft.file.name?.replace(/\.[^/.]+$/, '') || category
      const croppedFile = new File([blob], `${baseName}-${category}.jpg`, { type: blob.type || 'image/jpeg' })

      const displayAssetId = await uploadViaMediaApi(category, croppedFile)
      if (displayAssetId) {
        updateDraft(category, (prev) => ({ ...prev, isDirty: false }))
      }
      return displayAssetId
    },
    [drafts, updateDraft, uploadViaMediaApi],
  )

  const ensureFullSizeAsset = useCallback(
    async (category: BusinessMediaCategory, displayAssetId: string) => {
      const draft = drafts[category]
      if (draft.file) {
        if (draft.fullAssetId) return draft.fullAssetId
        const fullAssetId = await uploadViaMediaApi('post_image', draft.file)
        if (!fullAssetId) return null
        updateDraft(category, (prev) => ({ ...prev, fullAssetId }))
        return fullAssetId
      }
      return displayAssetId
    },
    [drafts, updateDraft, uploadViaMediaApi],
  )

  const ensurePhotoApplied = useCallback(
    async (category: BusinessMediaCategory) => {
      const draft = drafts[category]
      if (draft.file && draft.isDirty) {
        return await applyPhotoCrop(category)
      }
      return null
    },
    [applyPhotoCrop, drafts],
  )

  const handlePostPhoto = useCallback(async () => {
    if (!photoModalCategory) return
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setPhotoPosting(true)
    setSaving(true)
    try {
      const displayAssetId = await ensurePhotoApplied(photoModalCategory)
      if (!displayAssetId) {
        pushToast('Upload a photo before posting.', 'error')
        return
      }

      const fullAssetId = await ensureFullSizeAsset(photoModalCategory, displayAssetId)
      if (!fullAssetId) return

      const res = await fetch(buildApiUrl(`${orgApiPath}/profile-photo`), {
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
        if (res.status === 403) {
          pushToast('Only organization admins can update these photos.', 'error')
        } else {
          pushToast(rawError ?? 'Unable to update organization photo right now.', 'error')
        }
        return
      }

      pushToast('Updated organization photo (posted to feed).', 'success')
      setDrafts((prev) => ({
        ...prev,
        [photoModalCategory]: createPhotoDraftState(),
      }))
      closePhotoModal()
      await load()
    } catch (err) {
      console.error('Failed to update organization photo', err)
      pushToast('Unable to update organization photo right now.', 'error')
    } finally {
      setPhotoPosting(false)
      setSaving(false)
    }
  }, [closePhotoModal, ensureFullSizeAsset, ensurePhotoApplied, load, orgApiPath, photoCaption, photoModalCategory, token])

  const handleFileChange = useCallback(
    (category: BusinessMediaCategory) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return

        const limit = MEDIA_LIMITS[category]
        if (file.size > limit) {
          pushToast(`That file is too large. Max size is ${(limit / MB).toFixed(0)}MB.`, 'error')
          return
        }
        if (file.type && !ACCEPTED_IMAGE_TYPE_LIST.includes(file.type)) {
          pushToast('Please choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF image.', 'error')
          return
        }

        const previewUrl = URL.createObjectURL(file)
        updateDraft(category, (prev) => {
          if (prev.previewUrl && prev.previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(prev.previewUrl)
          }
          return {
            ...prev,
            file,
            previewUrl,
            crop: { x: 0, y: 0 },
            zoom: 1,
            croppedAreaPixels: null,
            isDirty: true,
            fullAssetId: null,
          }
        })
      },
    [updateDraft],
  )

  useEffect(() => {
    return () => {
      const urls = [drafts.business_logo.previewUrl, drafts.business_cover.previewUrl]
      for (const url of urls) {
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
      }
    }
  }, [drafts.business_cover.previewUrl, drafts.business_logo.previewUrl])

  const logoDisplayUrl = org?.logoUrl ?? null
  const coverDisplayUrl = org?.coverUrl ?? null

  if (loading) {
    return <p className="text-sm text-slate-600">Loading…</p>
  }

  if (!token) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">You must be signed in to edit organization settings.</p>
        <button
          type="button"
          onClick={() => redirectToAuthModal('login')}
          className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Sign in
        </button>
      </div>
    )
  }

  if (!org) {
    return <p className="text-sm text-slate-600">Organization not found.</p>
  }

  if (!canManage) {
    return <p className="text-sm text-slate-600">Only organization admins can edit these settings.</p>
  }

  const currentCategory = photoModalCategory ?? 'business_logo'
  const activeDraft = photoModalCategory ? drafts[photoModalCategory] : null
  const modalTitle = currentCategory === 'business_logo' ? 'Update organization profile photo' : 'Update organization cover photo'
  const modalPreview =
    activeDraft?.previewUrl ?? (currentCategory === 'business_logo' ? org.logoUrl ?? null : org.coverUrl ?? null)
  const canSubmitPhoto = Boolean(photoModalCategory && activeDraft?.file)

  return (
    <div className="space-y-8">
      <Modal open={deleteModalOpen} onClose={closeDeleteModal} title="Delete organization">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            This permanently deletes this organization. All posts, products, channels, and related data will be permanently deleted.
          </p>
          <p className="text-xs text-slate-500">
            Type <span className="font-semibold text-slate-700">{org.name}</span> to confirm.
          </p>
          <input
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            disabled={deleteSaving}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder={org.name}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDeleteModal}
              disabled={deleteSaving}
              className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={deleteOrganization}
              disabled={deleteSaving || !deleteConfirmationMatches}
              className="rounded-full border border-rose-300 bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {deleteSaving ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </div>
      </Modal>

      <PhotoUpdateModal
        open={Boolean(photoModalCategory)}
        title={modalTitle}
        subtitle="Share a quick post when you refresh your photo."
        imageUrl={activeDraft?.previewUrl ? null : modalPreview}
        cropperImageUrl={activeDraft?.previewUrl ?? null}
        aspect={currentCategory === 'business_logo' ? 1 : COVER_ASPECT_RATIO}
        cropShape={currentCategory === 'business_logo' ? 'round' : 'rect'}
        showGrid={currentCategory !== 'business_logo'}
        crop={activeDraft?.crop ?? { x: 0, y: 0 }}
        zoom={activeDraft?.zoom ?? 1}
        maxZoom={MAX_CROP_ZOOM}
        onCropChange={handleCropChange(currentCategory)}
        onZoomChange={handleZoomChange(currentCategory)}
        onCropComplete={handleCropComplete(currentCategory)}
        onResetPosition={() => resetPhotoDraftCrop(currentCategory)}
        onPickFile={() => openFilePicker(currentCategory)}
        uploadStatus={uploadStatus}
        uploadError={uploadError}
        caption={photoCaption}
        onCaptionChange={setPhotoCaption}
        primaryLabel="Post update"
        primaryDisabled={photoPosting || !canSubmitPhoto}
        primaryLoading={photoPosting}
        onPrimary={handlePostPhoto}
        onClose={closePhotoModal}
      />

      <section className="surface-card space-y-6 p-6 shadow-subtle">
        <header className="space-y-1">
          <h3 className="text-lg font-semibold text-slate-900">Photos</h3>
          <p className="text-sm text-slate-500">Upload a cover and profile photo to personalize this organization.</p>
        </header>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-800">Cover photo</p>
              <p className="text-xs text-gray-500">Shown at the top of your public organization page.</p>
            </div>
            <button
              type="button"
              onClick={() => launchPhotoFlow('business_cover', true)}
              disabled={saving}
              className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
            >
              Upload new cover
            </button>
          </div>

          {coverDisplayUrl ? (
            <img src={coverDisplayUrl} alt={`${org.name} cover`} className="h-40 w-full rounded-2xl border border-slate-200 object-cover" />
          ) : (
            <div className="flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
              No cover photo yet.
            </div>
          )}

          <p className="mt-2 text-xs text-slate-500">Up to 20MB. Supported: JPG, PNG, WebP, AVIF, HEIC.</p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <VerifiedAvatar
            src={logoDisplayUrl}
            alt={org.name}
            initials={org.name}
            size={80}
            isVerified={Boolean(org.isVerified)}
            className="shrink-0"
          />
          <div className="space-y-1 text-sm text-gray-600">
            <button
              type="button"
              onClick={() => launchPhotoFlow('business_logo', true)}
              disabled={saving}
              className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
            >
              Upload new profile photo
            </button>
            <p className="text-xs text-slate-500">Up to 8MB. Supported: JPG, PNG, WebP, AVIF, HEIC.</p>
          </div>
        </div>

        <input
          ref={coverInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="hidden"
          onChange={handleFileChange('business_cover')}
        />
        <input
          ref={logoInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="hidden"
          onChange={handleFileChange('business_logo')}
        />
      </section>

      {isOwner ? (
        <section className="surface-card space-y-3 p-6 shadow-subtle">
          <h3 className="text-sm font-semibold text-slate-900">Organization name</h3>
          <p className="text-xs text-slate-500">Renaming the organization publishes a rename post for followers.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              disabled={organizationNameSaving}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              placeholder="Organization name"
            />
            <button
              type="button"
              onClick={saveOrganizationName}
              disabled={!canSaveOrganizationName || organizationNameSaving}
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {organizationNameSaving ? 'Renaming…' : 'Save name'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="surface-card space-y-3 p-6 shadow-subtle">
        <h3 className="text-sm font-semibold text-slate-900">Directory details</h3>
        <p className="text-xs text-slate-500">These appear on the organizations directory page.</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Phone
            <input
              value={details.phone}
              onChange={(e) => {
                setDetails((prev) => ({ ...prev, phone: e.target.value }))
                setDetailsDirty(true)
              }}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              placeholder="(optional)"
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Website
            <input
              value={details.websiteUrl}
              onChange={(e) => {
                setDetails((prev) => ({ ...prev, websiteUrl: e.target.value }))
                setDetailsDirty(true)
              }}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
              placeholder="(optional)"
            />
          </label>
        </div>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Address
          <input
            value={details.address}
            onChange={(e) => {
              setDetails((prev) => ({ ...prev, address: e.target.value }))
              setDetailsDirty(true)
            }}
            disabled={saving}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder="(optional)"
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Schedule
          <textarea
            value={details.schedule}
            onChange={(e) => {
              setDetails((prev) => ({ ...prev, schedule: e.target.value }))
              setDetailsDirty(true)
            }}
            disabled={saving}
            rows={3}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder="(optional)"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={saveDetails}
            disabled={saving || !detailsDirty}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Save details
          </button>
          <a
            href={`/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}/shop/manage`}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Manage shop
          </a>
        </div>
      </section>

      <section className="surface-card space-y-4 p-6 shadow-subtle">
        <header className="space-y-1">
          <h3 className="text-lg font-semibold text-slate-900">Organization profile</h3>
          <p className="text-sm text-slate-500">This content appears on your public organization page.</p>
        </header>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Headline
          <input
            value={profileHeadline}
            onChange={(event) => setProfileHeadline(event.target.value.slice(0, HEADLINE_MAX_CHARS))}
            disabled={profileSaving}
            maxLength={HEADLINE_MAX_CHARS}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            placeholder="Short headline (60 characters max)"
          />
          <span className="text-xs text-slate-500">{profileHeadline.length}/{HEADLINE_MAX_CHARS}</span>
        </label>

        <div className="grid gap-1">
          <span className="text-sm font-medium text-slate-700">About us</span>
          <RichTextEditor
            value={profileAbout}
            onChange={setProfileAbout}
            placeholder="Share your mission, values, and what this organization does."
            minHeight={220}
            disabled={profileSaving}
          />
          <p className="text-xs text-slate-500">Supports formatted text, links, and lists.</p>
        </div>

        <div>
          <button
            type="button"
            onClick={saveProfileDetails}
            disabled={profileSaving || !canSaveProfile}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {profileSaving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </section>

      <section className="surface-card space-y-3 p-6 shadow-subtle">
        <h3 className="text-sm font-semibold text-slate-900">Visibility</h3>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span
            className={
              org.status === 'ACTIVE'
                ? 'inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700'
                : 'inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700'
            }
          >
            {org.status === 'ACTIVE' ? 'Public' : 'Private'}
          </span>
          <p className="text-xs text-slate-600">Public organizations are discoverable. Private organizations are only visible to admins.</p>
          <button
            type="button"
            onClick={toggleVisibility}
            disabled={visibilitySaving || !canManage}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {visibilitySaving ? 'Saving…' : org.status === 'ACTIVE' ? 'Make private' : 'Make public'}
          </button>
        </div>
      </section>

      <section className="surface-card space-y-3 p-6 shadow-subtle">
        <h3 className="text-sm font-semibold text-slate-900">Members</h3>
        {membersLoading ? <p className="text-xs text-slate-500">Loading members…</p> : null}
        {!membersLoading && !members.length ? <p className="text-xs text-slate-500">No members yet.</p> : null}
        {members.length ? (
          <ul className="space-y-2">
            {members.map((entry) => {
              const displayName = formatUserDisplayName(entry.user.name, entry.user.handle) || entry.user.handle
              const canRemove = isOwner && entry.role !== 'OWNER'
              return (
                <li key={`${entry.userId}-${entry.role}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <VerifiedAvatar src={entry.user.avatarUrl} alt={displayName} initials={displayName} size={32} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{displayName}</p>
                      <p className="truncate text-xs text-slate-500">@{entry.user.handle} · {entry.role}</p>
                    </div>
                  </div>
                  {canRemove ? (
                    <button
                      type="button"
                      onClick={() => removeMember(entry.userId)}
                      disabled={memberActionUserId === entry.userId}
                      className="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                    >
                      {memberActionUserId === entry.userId ? 'Removing…' : 'Remove'}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <section className="surface-card space-y-3 p-6 shadow-subtle">
        <h3 className="text-sm font-semibold text-slate-900">Followers</h3>
        <p className="text-xs text-slate-500">Promote a follower to manager so they can help run this organization.</p>
        {!followers.length ? <p className="text-xs text-slate-500">No followers available to promote.</p> : null}
        {followers.length ? (
          <ul className="space-y-2">
            {followers.map((entry) => {
              const displayName = formatUserDisplayName(entry.user.name, entry.user.handle) || entry.user.handle
              return (
                <li key={entry.userId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-2">
                    <VerifiedAvatar src={entry.user.avatarUrl} alt={displayName} initials={displayName} size={32} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{displayName}</p>
                      <p className="truncate text-xs text-slate-500">@{entry.user.handle}</p>
                    </div>
                  </div>
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => promoteFollower(entry.userId)}
                      disabled={memberActionUserId === entry.userId}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {memberActionUserId === entry.userId ? 'Promoting…' : 'Promote'}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      {isOwner ? (
        <section className="surface-card space-y-3 p-6 shadow-subtle">
          <h3 className="text-sm font-semibold text-rose-700">Danger zone</h3>
          <p className="text-xs text-slate-600">
            Deleting permanently removes this organization and all posts, products, channels, and related records.
          </p>
          <button
            type="button"
            onClick={() => setDeleteModalOpen(true)}
            className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-white px-5 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
          >
            Delete organization
          </button>
        </section>
      ) : null}
    </div>
  )
}
