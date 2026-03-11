'use client'

import { buildApiUrl } from './api'

export type FamilyMediaCategory = 'avatar' | 'cover'

const MB = 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif']
const LIMITS: Record<FamilyMediaCategory, number> = {
  avatar: 8 * MB,
  cover: 20 * MB,
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const objectUrl = URL.createObjectURL(file)
    return await new Promise((resolve) => {
      const image = new Image()
      image.onload = () => {
        resolve({ width: image.naturalWidth, height: image.naturalHeight })
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

export function getFamilyMediaLimit(category: FamilyMediaCategory) {
  return LIMITS[category]
}

export function getFamilyMediaLabel(category: FamilyMediaCategory) {
  return category === 'avatar' ? 'profile photo' : 'cover photo'
}

export function validateFamilyMediaFile(category: FamilyMediaCategory, file: File): string | null {
  if (file.size > LIMITS[category]) {
    return `Your ${getFamilyMediaLabel(category)} must be ${Math.round(LIMITS[category] / MB)} MB or smaller.`
  }
  if (file.type && !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return 'Please choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF image.'
  }
  return null
}

export async function uploadFamilyMediaAsset(args: {
  token: string
  category: FamilyMediaCategory
  file: File
}): Promise<string> {
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

  const initPayload = await initRes.json().catch(() => ({})) as {
    assetId?: string
    proxyPath?: string
    upload?: { url?: string; method?: string; headers?: Record<string, string> }
    error?: string
  }
  if (!initRes.ok || !initPayload.assetId) {
    throw new Error(initPayload.error || 'upload_init_failed')
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

export async function waitForFamilyMediaAsset(args: {
  token: string
  assetId: string
  attempts?: number
  delayMs?: number
}): Promise<boolean> {
  const attempts = args.attempts ?? 30
  const delayMs = args.delayMs ?? 3000

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(buildApiUrl(`/media/assets/${encodeURIComponent(args.assetId)}`), {
      headers: {
        authorization: `Bearer ${args.token}`,
      },
    })
    if (response.ok) {
      const payload = await response.json().catch(() => ({})) as { asset?: { status?: string } }
      if (payload.asset?.status === 'ready') return true
      if (payload.asset?.status === 'failed') return false
    }
    await wait(delayMs)
  }

  return false
}

export async function applyFamilyMemberMedia(args: {
  token: string
  memberId: string
  category: FamilyMediaCategory
  displayAssetId: string
}): Promise<{ member?: Record<string, unknown>; viewer?: Record<string, unknown>; error?: string }> {
  const response = await fetch(buildApiUrl(`/family/members/${encodeURIComponent(args.memberId)}/media`), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify({
      category: args.category,
      displayAssetId: args.displayAssetId,
    }),
  })

  const payload = await response.json().catch(() => null) as { member?: Record<string, unknown>; viewer?: Record<string, unknown>; error?: string } | null
  if (!response.ok || !payload) {
    throw new Error(payload?.error || 'family_media_update_failed')
  }
  return payload
}