'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { buildApiUrl, parseApiResponse } from '../../_lib/api'
import { pushToast } from '../../_components/useToasts'
import { redirectToAuthModal } from '../../_lib/authModal'
import type { CommunityOrganization } from '../../_lib/organizations'
import VerifiedAvatar from '../../_components/VerifiedAvatar'

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

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif'
const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(',')

const MB = 1024 * 1024
const MEDIA_LIMITS = {
  business_logo: 8 * MB,
  business_cover: 20 * MB,
} as const

type BusinessMediaCategory = keyof typeof MEDIA_LIMITS

type SlotState = {
  status: 'idle' | 'uploading' | 'processing' | 'ready' | 'error'
  previewUrl: string | null
  error: string | null
}

const createSlotState = (): SlotState => ({
  status: 'idle',
  previewUrl: null,
  error: null,
})

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image_load_failed'))
    }
    img.src = url
  })
}

function safeParseAbsoluteUrl(candidate: string | null | undefined): URL | null {
  if (!candidate) return null
  try {
    return new URL(candidate)
  } catch {
    return null
  }
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

  const [logoState, setLogoState] = useState<SlotState>(() => createSlotState())
  const [coverState, setCoverState] = useState<SlotState>(() => createSlotState())

  const logoInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('token') : null), [])
  const isOwner = Boolean(me?.id && org?.ownerId && me.id === org.ownerId)

  const orgApiPath = useMemo(() => {
    return `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(slug)}`
  }, [municipality, province, slug])

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

  const openPicker = useCallback((category: BusinessMediaCategory) => {
    const ref = category === 'business_logo' ? logoInputRef : coverInputRef
    ref.current?.click()
  }, [])

  const uploadAndAttach = useCallback(
    async (category: BusinessMediaCategory, file: File) => {
      if (!token) {
        pushToast('You must be signed in to upload organization photos.', 'error')
        redirectToAuthModal('login')
        return
      }

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
      const setSlot = category === 'business_logo' ? setLogoState : setCoverState
      setSlot({ status: 'uploading', previewUrl, error: null })

      setSaving(true)

      try {
        const dimensions = await readImageDimensions(file).catch(() => null)

        // 1) init upload
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
          throw new Error('upload_init_failed')
        }

        const initPayload = (await initRes.json().catch(() => null)) as MediaUploadInitResponse | null
        const assetId = initPayload?.assetId
        if (!assetId) throw new Error('upload_init_invalid')

        // 2) upload bytes (direct if possible, otherwise proxy)
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

        if (!uploaded) throw new Error('upload_failed')

        // 3) complete upload (kicks off processing)
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

        if (!completeRes.ok) throw new Error('upload_complete_failed')

        // 4) attach to org
        const settingsRes = await fetch(buildApiUrl(`${orgApiPath}/settings`), {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(
            category === 'business_logo'
              ? { logoMediaId: assetId }
              : { coverMediaId: assetId },
          ),
        })

        if (!settingsRes.ok) {
          const { json, text } = await parseApiResponse(settingsRes)
          console.warn('Org settings update failed', { json, text, status: settingsRes.status })
          throw new Error(settingsRes.status === 403 ? 'forbidden' : 'settings_update_failed')
        }

        setSlot((prev) => ({ ...prev, status: 'processing', error: null }))
        await waitForAssetReady(token, assetId, category === 'business_logo' ? 'logo' : 'cover photo')

        setSlot((prev) => ({ ...prev, status: 'ready', error: null }))
        pushToast('Updated organization photo.', 'success')

        await load()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong during upload.'
        if (message === 'forbidden') {
          pushToast('Only organization owners can update these photos.', 'error')
        } else {
          pushToast(message || 'Something went wrong during upload.', 'error')
        }
        setSlot((prev) => ({ ...prev, status: 'error', error: 'Upload failed.' }))
      } finally {
        setSaving(false)
      }
    },
    [load, orgApiPath, token],
  )

  const handleFileChange = useCallback(
    (category: BusinessMediaCategory) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        void uploadAndAttach(category, file)
      },
    [uploadAndAttach],
  )

  const logoDisplayUrl = logoState.previewUrl ?? org?.logoUrl ?? null
  const coverDisplayUrl = coverState.previewUrl ?? org?.coverUrl ?? null

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

  if (!isOwner) {
    return <p className="text-sm text-slate-600">Only the organization owner can edit these settings.</p>
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Display photo</h3>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <VerifiedAvatar
            src={logoDisplayUrl}
            alt={org.name}
            initials={org.name}
            size={64}
            isVerified={Boolean(org.isVerified)}
            className="shrink-0"
          />

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openPicker('business_logo')}
                disabled={saving || logoState.status === 'uploading'}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {logoState.status === 'uploading' ? 'Uploading…' : 'Upload logo'}
              </button>
            </div>
            <p className="text-xs text-slate-500">Up to 8MB. Supported: JPG, PNG, WebP, AVIF, HEIC.</p>
            {logoState.status === 'processing' ? <p className="text-xs text-amber-600">Processing…</p> : null}
            {logoState.error ? <p className="text-xs text-rose-700">{logoState.error}</p> : null}
          </div>
        </div>
        <input
          ref={logoInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="hidden"
          onChange={handleFileChange('business_logo')}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Cover photo</h3>
        {coverDisplayUrl ? (
          <img src={coverDisplayUrl} alt={`${org.name} cover`} className="h-40 w-full rounded-2xl border border-slate-200 object-cover" />
        ) : (
          <div className="flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
            No cover photo yet.
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openPicker('business_cover')}
              disabled={saving || coverState.status === 'uploading'}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {coverState.status === 'uploading' ? 'Uploading…' : 'Upload cover'}
            </button>
          </div>
          <p className="text-xs text-slate-500">Up to 20MB. Supported: JPG, PNG, WebP, AVIF, HEIC.</p>
          {coverState.status === 'processing' ? <p className="text-xs text-amber-600">Processing…</p> : null}
          {coverState.error ? <p className="text-xs text-rose-700">{coverState.error}</p> : null}
        </div>

        <input
          ref={coverInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="hidden"
          onChange={handleFileChange('business_cover')}
        />
      </section>
    </div>
  )
}
