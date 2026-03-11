'use client'

import type { Area } from 'react-easy-crop'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  HiOutlineArrowLeftCircle,
  HiOutlineComputerDesktop,
} from 'react-icons/hi2'
import DashboardShell from '../../../_components/DashboardShell'
import Modal from '../../../_components/Modal'
import PhotoUpdateModal from '../../../_components/PhotoUpdateModal'
import { RightRail } from '../../../_components/RightRail'
import { pushToast } from '../../../_components/useToasts'
import { clearAuthSession } from '../../../_lib/authSession'
import { buildApiUrl } from '../../../_lib/api'
import { redirectToAuthModal } from '../../../_lib/authModal'
import { clearFamilyView } from '../../../_lib/familyView'
import { buildFamilyAvatarDataUrl, buildFamilyCoverDataUrl } from '../../../_lib/familyIdentity'
import { computeFallbackCropArea, generateCroppedImageBlob, readImageDimensions } from '../../../_lib/imageCrop'
import { getFamilyMediaLabel, validateFamilyMediaFile } from '../../../_lib/familyMedia'
import { useViewerStore } from '../../../_lib/viewerStore'

type ProfileMediaCategory = 'avatar' | 'cover'
type UploadMediaCategory = ProfileMediaCategory | 'post_image'

type PhotoDraftState = {
  file: File | null
  previewUrl: string | null
  crop: { x: number; y: number }
  zoom: number
  croppedAreaPixels: Area | null
  isDirty: boolean
}

type UploadState = {
  status: 'idle' | 'uploading' | 'processing' | 'ready' | 'error'
  error: string | null
}

type UsernameCheckState = {
  status: 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  message: string | null
}

const COVER_EXPORT_WIDTH = 1920
const COVER_EXPORT_HEIGHT = 640
const COVER_ASPECT_RATIO = COVER_EXPORT_WIDTH / COVER_EXPORT_HEIGHT
const AVATAR_EXPORT_SIZE = 1024
const MAX_CROP_ZOOM = 3
const FAMILY_USERNAME_MIN_LENGTH = 6
const FAMILY_USERNAME_MAX_LENGTH = 20
const FAMILY_USERNAME_PATTERN = /^[A-Za-z0-9]{6,20}$/

const createPhotoDraftState = (): PhotoDraftState => ({
  file: null,
  previewUrl: null,
  crop: { x: 0, y: 0 },
  zoom: 1,
  croppedAreaPixels: null,
  isDirty: false,
})

const createUploadState = (): UploadState => ({
  status: 'idle',
  error: null,
})

const createUsernameCheckState = (): UsernameCheckState => ({
  status: 'idle',
  message: null,
})

function sanitizeFamilyUsernameInput(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, '').slice(0, FAMILY_USERNAME_MAX_LENGTH)
}

function shouldUseDirectUpload(url?: string | null) {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && parsed.protocol === 'http:') {
      return false
    }
    return true
  } catch {
    return false
  }
}

async function uploadAssetToMediaService(args: {
  token: string
  category: UploadMediaCategory
  file: File
}) {
  const dimensions = await readImageDimensions(args.file)
  const initRes = await fetch(buildApiUrl('/media/uploads'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify({
      category: args.category,
      mime: args.file.type || 'application/octet-stream',
      byteSize: args.file.size,
      filename: args.file.name,
    }),
  })

  const initPayload = (await initRes.json().catch(() => null)) as {
    assetId?: string
    proxyPath?: string
    upload?: { url?: string; method?: string; headers?: Record<string, string> }
    error?: string
  } | null
  if (!initRes.ok || !initPayload?.assetId) {
    throw new Error(initPayload?.error || 'upload_init_failed')
  }

  let uploaded = false
  if (shouldUseDirectUpload(initPayload.upload?.url)) {
    try {
      const directRes = await fetch(initPayload.upload?.url as string, {
        method: initPayload.upload?.method || 'PUT',
        headers: initPayload.upload?.headers,
        body: args.file,
      })
      uploaded = directRes.ok
    } catch {
      uploaded = false
    }
  }

  if (!uploaded && initPayload.proxyPath) {
    const proxyRes = await fetch(buildApiUrl(initPayload.proxyPath), {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${args.token}`,
        'content-type': args.file.type || 'application/octet-stream',
        'x-upload-byte-size': String(args.file.size),
      },
      body: args.file,
    })
    uploaded = proxyRes.ok
  }

  if (!uploaded) {
    throw new Error('upload_failed')
  }

  const completeRes = await fetch(buildApiUrl('/media/uploads/complete'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify({
      assetId: initPayload.assetId,
      width: dimensions?.width,
      height: dimensions?.height,
    }),
  })

  if (!completeRes.ok) {
    throw new Error('processing_not_scheduled')
  }

  return initPayload.assetId
}

async function waitForMediaAssetReady(args: { token: string; assetId: string; attempts?: number; delayMs?: number }) {
  const attempts = args.attempts ?? 30
  const delayMs = args.delayMs ?? 3000
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(buildApiUrl(`/media/assets/${encodeURIComponent(args.assetId)}`), {
      headers: {
        authorization: `Bearer ${args.token}`,
      },
    })
    if (response.ok) {
      const payload = (await response.json().catch(() => null)) as { asset?: { status?: string } } | null
      if (payload?.asset?.status === 'ready') return true
      if (payload?.asset?.status === 'failed') return false
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return false
}

export default function FamilyLockedSettingsPage() {
  const router = useRouter()
  const familyView = useViewerStore((s) => s.familyView)
  const viewer = useViewerStore((s) => s.me)
  const setViewer = useViewerStore((s) => s.setMe)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [photoModalCategory, setPhotoModalCategory] = useState<ProfileMediaCategory | null>(null)
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoPosting, setPhotoPosting] = useState(false)
  const [photoDrafts, setPhotoDrafts] = useState<Record<ProfileMediaCategory, PhotoDraftState>>({
    avatar: createPhotoDraftState(),
    cover: createPhotoDraftState(),
  })
  const [uploadStates, setUploadStates] = useState<Record<ProfileMediaCategory, UploadState>>({
    avatar: createUploadState(),
    cover: createUploadState(),
  })
  const [usernameDraft, setUsernameDraft] = useState('')
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheckState>(createUsernameCheckState)
  const [usernameSaving, setUsernameSaving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

  const currentUsername = viewer?.familyMemberSession?.username ?? ''

  useEffect(() => {
    if (!familyView) {
      router.replace('/settings/family')
    }
  }, [familyView, router])

  useEffect(() => {
    return () => {
      Object.values(photoDrafts).forEach((draft) => {
        if (draft.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(draft.previewUrl)
        }
      })
    }
  }, [photoDrafts])

  useEffect(() => {
    setUsernameDraft(currentUsername)
    setUsernameCheck(createUsernameCheckState())
  }, [currentUsername])

  useEffect(() => {
    if (!viewer?.familyMemberSession?.allowChildOwnUsernameEdits) {
      setUsernameCheck(createUsernameCheckState())
      return
    }

    const nextUsername = usernameDraft.trim()
    if (!nextUsername) {
      setUsernameCheck(createUsernameCheckState())
      return
    }

    if (!FAMILY_USERNAME_PATTERN.test(nextUsername)) {
      setUsernameCheck({
        status: 'invalid',
        message: `Use ${FAMILY_USERNAME_MIN_LENGTH}-${FAMILY_USERNAME_MAX_LENGTH} letters or numbers.`,
      })
      return
    }

    if (nextUsername.toLowerCase() === currentUsername.trim().toLowerCase()) {
      setUsernameCheck({ status: 'available', message: 'Current username.' })
      return
    }

    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token')?.trim() || null : null
    if (!token) {
      setUsernameCheck(createUsernameCheckState())
      return
    }

    let cancelled = false
    setUsernameCheck({ status: 'checking', message: 'Checking username…' })

    const timeoutId = window.setTimeout(() => {
      void fetch(buildApiUrl(`/family/username/check?username=${encodeURIComponent(nextUsername)}`), {
        headers: {
          authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      })
        .then(async (response) => {
          if (cancelled) return
          if (response.status === 401) {
            redirectToAuthModal('login')
            return
          }

          const payload = (await response.json().catch(() => null)) as { error?: string; available?: boolean } | null
          if (!response.ok) {
            if (payload?.error === 'family_member_username_invalid') {
              setUsernameCheck({
                status: 'invalid',
                message: `Use ${FAMILY_USERNAME_MIN_LENGTH}-${FAMILY_USERNAME_MAX_LENGTH} letters or numbers.`,
              })
              return
            }
            setUsernameCheck({ status: 'invalid', message: 'Unable to check that username right now.' })
            return
          }

          setUsernameCheck(
            payload?.available
              ? { status: 'available', message: 'Username is available.' }
              : { status: 'taken', message: 'That username is already in use.' },
          )
        })
        .catch((error) => {
          if (cancelled) return
          console.error('Failed to check family username', error)
          setUsernameCheck({ status: 'invalid', message: 'Unable to check that username right now.' })
        })
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [currentUsername, usernameDraft, viewer?.familyMemberSession?.allowChildOwnUsernameEdits])

  const updatePhotoDraft = useCallback((category: ProfileMediaCategory, updater: (prev: PhotoDraftState) => PhotoDraftState) => {
    setPhotoDrafts((prev) => ({
      ...prev,
      [category]: updater(prev[category]),
    }))
  }, [])

  const updateUploadState = useCallback((category: ProfileMediaCategory, next: Partial<UploadState>) => {
    setUploadStates((prev) => ({
      ...prev,
      [category]: { ...prev[category], ...next },
    }))
  }, [])

  const openFilePicker = useCallback((category: ProfileMediaCategory) => {
    if (category === 'avatar') avatarInputRef.current?.click()
    else coverInputRef.current?.click()
  }, [])

  const launchPhotoFlow = useCallback((category: ProfileMediaCategory) => {
    if (!viewer?.familyMemberSession?.allowChildOwnMediaEdits) {
      pushToast('Photo updates are disabled for this child account.', 'error')
      return
    }
    updateUploadState(category, { status: 'idle', error: null })
    setPhotoCaption('')
    setPhotoModalCategory(category)
  }, [updateUploadState, viewer?.familyMemberSession?.allowChildOwnMediaEdits])

  const closePhotoModal = useCallback(() => {
    setPhotoModalCategory(null)
    setPhotoCaption('')
  }, [])

  const handleFilePicked = useCallback(
    (category: ProfileMediaCategory) => async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const validationError = validateFamilyMediaFile(category, file)
      if (validationError) {
        pushToast(validationError, 'error')
        return
      }

      updatePhotoDraft(category, (prev) => {
        if (prev.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(prev.previewUrl)
        }
        return {
          file,
          previewUrl: URL.createObjectURL(file),
          crop: { x: 0, y: 0 },
          zoom: 1,
          croppedAreaPixels: null,
          isDirty: true,
        }
      })
      updateUploadState(category, { status: 'idle', error: null })
    },
    [updatePhotoDraft, updateUploadState],
  )

  const handleCropChange = useCallback(
    (category: ProfileMediaCategory) => (nextCrop: { x: number; y: number }) => {
      updatePhotoDraft(category, (prev) => ({ ...prev, crop: nextCrop, isDirty: true }))
    },
    [updatePhotoDraft],
  )

  const handleZoomChange = useCallback(
    (category: ProfileMediaCategory) => (nextZoom: number) => {
      updatePhotoDraft(category, (prev) => ({ ...prev, zoom: nextZoom, isDirty: true }))
    },
    [updatePhotoDraft],
  )

  const handleCropComplete = useCallback(
    (category: ProfileMediaCategory) => (_area: Area, areaPixels: Area) => {
      updatePhotoDraft(category, (prev) => ({ ...prev, croppedAreaPixels: areaPixels, isDirty: true }))
    },
    [updatePhotoDraft],
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

  const handlePostPhoto = useCallback(async () => {
    if (!photoModalCategory || !familyView || !viewer?.familyMemberSession?.allowChildOwnMediaEdits) return

    const draft = photoDrafts[photoModalCategory]
    if (!draft.file) {
      pushToast('Upload a photo before posting.', 'error')
      return
    }

    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token')?.trim() || null : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setPhotoPosting(true)
    updateUploadState(photoModalCategory, { status: 'uploading', error: null })

    try {
      let cropArea = draft.croppedAreaPixels
      if (!cropArea) {
        const dims = await readImageDimensions(draft.file)
        if (!dims) {
          pushToast('We could not read that photo. Please choose a different one.', 'error')
          updateUploadState(photoModalCategory, { status: 'error', error: 'Could not read photo.' })
          return
        }
        cropArea = computeFallbackCropArea(dims, photoModalCategory === 'avatar' ? 1 : COVER_ASPECT_RATIO)
        updatePhotoDraft(photoModalCategory, (prev) => ({ ...prev, croppedAreaPixels: cropArea, isDirty: true }))
      }

      const blob = await generateCroppedImageBlob(
        draft.file,
        cropArea,
        photoModalCategory === 'avatar'
          ? { width: AVATAR_EXPORT_SIZE, height: AVATAR_EXPORT_SIZE, mime: 'image/jpeg', quality: 0.92 }
          : { width: COVER_EXPORT_WIDTH, height: COVER_EXPORT_HEIGHT, mime: 'image/jpeg', quality: 0.92 },
      )
      if (!blob) {
        pushToast('We could not crop that image. Please try again with a different photo.', 'error')
        updateUploadState(photoModalCategory, { status: 'error', error: 'Could not crop photo.' })
        return
      }

      const extension = blob.type === 'image/png' ? 'png' : 'jpg'
      const baseName = draft.file.name?.replace(/\.[^/.]+$/, '') || photoModalCategory
      const croppedFile = new File([blob], `${baseName}-${photoModalCategory}.${extension}`, { type: blob.type })

      const displayAssetId = await uploadAssetToMediaService({
        token,
        category: photoModalCategory,
        file: croppedFile,
      })
      updateUploadState(photoModalCategory, { status: 'processing', error: null })
      const displayReady = await waitForMediaAssetReady({ token, assetId: displayAssetId })
      if (!displayReady) {
        pushToast(`Your ${getFamilyMediaLabel(photoModalCategory)} is still processing. Please try again in a moment.`, 'warning')
        updateUploadState(photoModalCategory, { status: 'error', error: 'Photo is still processing.' })
        return
      }

      const fullAssetId = await uploadAssetToMediaService({
        token,
        category: 'post_image',
        file: draft.file,
      })
      const fullReady = await waitForMediaAssetReady({ token, assetId: fullAssetId })
      if (!fullReady) {
        pushToast('Your full photo is still processing. Please try again in a moment.', 'warning')
        updateUploadState(photoModalCategory, { status: 'error', error: 'Full photo is still processing.' })
        return
      }

      const response = await fetch(buildApiUrl('/profile/photo'), {
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

      const payload = (await response.json().catch(() => null)) as {
        error?: string
        viewer?: typeof viewer
      } | null
      if (!response.ok) {
        pushToast(payload?.error ?? `Unable to update your ${getFamilyMediaLabel(photoModalCategory)} right now.`, 'error')
        updateUploadState(photoModalCategory, { status: 'error', error: payload?.error ?? 'Update failed.' })
        return
      }

      if (payload?.viewer) {
        setViewer(payload.viewer)
      }

      if (draft.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(draft.previewUrl)
      }
      setPhotoDrafts((prev) => ({
        ...prev,
        [photoModalCategory]: createPhotoDraftState(),
      }))
      updateUploadState(photoModalCategory, { status: 'ready', error: null })
      pushToast(photoModalCategory === 'avatar' ? 'Shared your new profile photo.' : 'Shared your new cover photo.', 'success')
      closePhotoModal()
    } catch (error) {
      console.error('Failed to share child profile photo', error)
      updateUploadState(photoModalCategory, { status: 'error', error: 'Upload failed.' })
      pushToast(`Unable to update your ${getFamilyMediaLabel(photoModalCategory)} right now.`, 'error')
    } finally {
      setPhotoPosting(false)
    }
  }, [closePhotoModal, familyView, photoCaption, photoDrafts, photoModalCategory, setViewer, updatePhotoDraft, updateUploadState, viewer?.familyMemberSession?.allowChildOwnMediaEdits])

  const handleSaveUsername = useCallback(async () => {
    const nextUsername = usernameDraft.trim()
    if (!viewer?.familyMemberSession?.allowChildOwnUsernameEdits || !nextUsername) return
    if (!FAMILY_USERNAME_PATTERN.test(nextUsername)) {
      setUsernameCheck({
        status: 'invalid',
        message: `Use ${FAMILY_USERNAME_MIN_LENGTH}-${FAMILY_USERNAME_MAX_LENGTH} letters or numbers.`,
      })
      return
    }

    const token = typeof window !== 'undefined' ? window.localStorage.getItem('token')?.trim() || null : null
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    setUsernameSaving(true)
    try {
      const response = await fetch(buildApiUrl('/family/username'), {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: nextUsername }),
      })

      const payload = (await response.json().catch(() => null)) as {
        error?: string
        viewer?: typeof viewer
        username?: string
      } | null

      if (response.status === 401) {
        redirectToAuthModal('login')
        return
      }

      if (!response.ok) {
        if (payload?.error === 'family_member_username_taken') {
          setUsernameCheck({ status: 'taken', message: 'That username is already in use.' })
          pushToast('That username is already in use.', 'error')
          return
        }
        if (payload?.error === 'family_member_username_invalid') {
          setUsernameCheck({
            status: 'invalid',
            message: `Use ${FAMILY_USERNAME_MIN_LENGTH}-${FAMILY_USERNAME_MAX_LENGTH} letters or numbers.`,
          })
          pushToast('Use 6 to 20 letters or numbers for your username.', 'error')
          return
        }
        if (payload?.error === 'family_member_username_edit_not_allowed') {
          pushToast('Your parent manages this username right now.', 'error')
          return
        }
        pushToast('Unable to update your username right now.', 'error')
        return
      }

      if (payload?.viewer) {
        setViewer(payload.viewer)
      }
      setUsernameCheck({ status: 'available', message: 'Username saved.' })
      pushToast(`Username updated to ${payload?.username ?? nextUsername}.`, 'success')
    } catch (error) {
      console.error('Failed to update family username', error)
      pushToast('Unable to update your username right now.', 'error')
    } finally {
      setUsernameSaving(false)
    }
  }, [setViewer, usernameDraft, viewer?.familyMemberSession?.allowChildOwnUsernameEdits])

  if (!familyView) return null

  const activePhotoDraft = photoModalCategory ? photoDrafts[photoModalCategory] : null
  const activeUploadState = photoModalCategory ? uploadStates[photoModalCategory] : createUploadState()
  const canSubmitPhoto = Boolean(activePhotoDraft?.file)
  const canSaveUsername =
    Boolean(viewer?.familyMemberSession?.allowChildOwnUsernameEdits) &&
    Boolean(usernameDraft.trim()) &&
    usernameDraft.trim().toLowerCase() !== currentUsername.trim().toLowerCase() &&
    usernameCheck.status === 'available' &&
    !usernameSaving

  return (
    <DashboardShell rightRail={<RightRail />}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Family Mode</p>
              <h1 className="mt-1 text-3xl font-semibold text-slate-950">Your Settings</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                This device is currently locked to {familyView.displayName}. Use these controls to manage your account on this device.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="h-28 w-full bg-slate-200">
                  <img
                    src={viewer?.coverUrl ?? buildFamilyCoverDataUrl(familyView.displayName, familyView.modeBand)}
                    alt="Child cover"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex items-center gap-3 px-4 py-4">
                  <img
                    src={viewer?.avatarUrl ?? buildFamilyAvatarDataUrl(familyView.displayName, familyView.modeBand)}
                    alt="Child profile"
                    className="h-16 w-16 rounded-2xl border border-white/70 object-cover shadow-sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-950">Profile and cover photos</p>
                  </div>
                </div>
              </div>

              {viewer?.familyMemberSession?.allowChildOwnMediaEdits ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={photoPosting}
                    onClick={() => launchPhotoFlow('avatar')}
                    className={photoPosting ? 'inline-flex cursor-not-allowed rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-400' : 'inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900'}
                  >
                    Update profile photo
                  </button>
                  <button
                    type="button"
                    disabled={photoPosting}
                    onClick={() => launchPhotoFlow('cover')}
                    className={photoPosting ? 'inline-flex cursor-not-allowed rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-400' : 'inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900'}
                  >
                    Update cover photo
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Username</h2>
                <p className="mt-1 text-sm text-slate-600">Pick a name your friends can remember. Use 6 to 20 letters or numbers.</p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                Current: {currentUsername || 'Not set'}
              </div>
            </div>

            {viewer?.familyMemberSession?.allowChildOwnUsernameEdits ? (
              <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="block text-sm font-medium text-slate-700">
                  Username
                  <input
                    type="text"
                    value={usernameDraft}
                    onChange={(event) => {
                      setUsernameDraft(sanitizeFamilyUsernameInput(event.target.value))
                    }}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Aytrix6000"
                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--cc-primary)]"
                  />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p
                    className={clsx(
                      'text-xs font-medium',
                      usernameCheck.status === 'taken' || usernameCheck.status === 'invalid'
                        ? 'text-red-600'
                        : usernameCheck.status === 'available'
                          ? 'text-emerald-700'
                          : 'text-slate-500',
                    )}
                  >
                    {usernameCheck.message ?? 'Letters and numbers only.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void handleSaveUsername()
                    }}
                    disabled={!canSaveUsername}
                    className={clsx(
                      'inline-flex rounded-full px-4 py-2 text-sm font-semibold text-white transition',
                      canSaveUsername ? 'bg-[var(--cc-primary)] hover:bg-[var(--cc-primary-700)]' : 'cursor-not-allowed bg-slate-300',
                    )}
                  >
                    {usernameSaving ? 'Saving…' : 'Save username'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                Your parent manages this username right now.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 text-slate-900">
              <HiOutlineComputerDesktop className="h-5 w-5 text-slate-500" />
              <h2 className="text-base font-semibold">Locked Device Session</h2>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
              <p><span className="font-semibold text-slate-950">Child:</span> {familyView.displayName}</p>
              {currentUsername ? (
                <p className="mt-1"><span className="font-semibold text-slate-950">Username:</span> {currentUsername}</p>
              ) : null}
              <p className="mt-1"><span className="font-semibold text-slate-950">Mode:</span> {familyView.modeLabel}</p>
              <p className="mt-1"><span className="font-semibold text-slate-950">Relationship:</span> {familyView.relationshipLabel}</p>
              <p className="mt-1"><span className="font-semibold text-slate-950">Age:</span> {familyView.age}</p>
              {viewer?.familyMemberSession?.parentHandle ? (
                <p className="mt-1"><span className="font-semibold text-slate-950">Parent:</span> @{viewer.familyMemberSession.parentHandle}</p>
              ) : null}
            </div>
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--cc-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
            >
              <HiOutlineArrowLeftCircle className="h-4 w-4" />
              Logout
            </button>
          </div>
        </section>

        <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" className="hidden" onChange={handleFilePicked('avatar')} />
        <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" className="hidden" onChange={handleFilePicked('cover')} />
      </div>

      <Modal open={logoutConfirmOpen} onClose={() => setLogoutConfirmOpen(false)} title="Log out of locked device?">
        <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-600">
            Your Parent or Guardian will have to log you in again.
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(false)}
              className="inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                clearAuthSession()
                clearFamilyView()
                if (typeof window !== 'undefined') {
                  window.sessionStorage.clear()
                  window.localStorage.clear()
                  window.location.assign('/')
                  return
                }
                router.replace('/')
              }}
              className="inline-flex items-center rounded-full bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--cc-primary-700)]"
            >
              Yes, logout
            </button>
          </div>
        </div>
      </Modal>

      <PhotoUpdateModal
        open={Boolean(photoModalCategory)}
        title={photoModalCategory === 'avatar' ? 'Update profile photo' : 'Update cover photo'}
        subtitle="Share a quick Family update when you refresh your photo."
        imageUrl={
          photoModalCategory === 'avatar'
            ? (viewer?.avatarUrl ?? buildFamilyAvatarDataUrl(familyView.displayName, familyView.modeBand))
            : (viewer?.coverUrl ?? buildFamilyCoverDataUrl(familyView.displayName, familyView.modeBand))
        }
        cropperImageUrl={activePhotoDraft?.previewUrl ?? null}
        aspect={photoModalCategory === 'cover' ? COVER_ASPECT_RATIO : 1}
        cropShape="rect"
        showGrid={photoModalCategory === 'cover'}
        crop={activePhotoDraft?.crop ?? { x: 0, y: 0 }}
        zoom={activePhotoDraft?.zoom ?? 1}
        maxZoom={MAX_CROP_ZOOM}
        onCropChange={handleCropChange(photoModalCategory ?? 'avatar')}
        onZoomChange={handleZoomChange(photoModalCategory ?? 'avatar')}
        onCropComplete={handleCropComplete(photoModalCategory ?? 'avatar')}
        onResetPosition={() => resetPhotoDraftCrop(photoModalCategory ?? 'avatar')}
        onPickFile={() => {
          if (!photoModalCategory) return
          openFilePicker(photoModalCategory)
        }}
        uploadStatus={activeUploadState.status}
        uploadError={activeUploadState.error}
        caption={photoCaption}
        onCaptionChange={setPhotoCaption}
        primaryLabel="Post update"
        primaryDisabled={photoPosting || !canSubmitPhoto}
        primaryLoading={photoPosting}
        onPrimary={() => {
          void handlePostPhoto()
        }}
        onClose={closePhotoModal}
      />
    </DashboardShell>
  )
}
