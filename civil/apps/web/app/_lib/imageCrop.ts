import type { Area } from 'react-easy-crop'

export type CropExportOptions = {
  width: number
  height: number
  mime?: 'image/jpeg' | 'image/png'
  quality?: number
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image_load_failed'))
    img.src = src
  })
}

async function renderCroppedImageBlob(sourceUrl: string, croppedAreaPixels: Area, options: CropExportOptions): Promise<Blob | null> {
  const { width: outWidth, height: outHeight, mime = 'image/jpeg', quality = 0.92 } = options

  const image = await loadImageElement(sourceUrl)

  const canvas = document.createElement('canvas')
  canvas.width = outWidth
  canvas.height = outHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  ctx.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    outWidth,
    outHeight,
  )

  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (b) => {
        resolve(b)
      },
      mime,
      mime === 'image/jpeg' ? quality : undefined,
    )
  })
}

export async function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
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

export function computeFallbackCropArea(dims: { width: number; height: number }, desiredAspect: number): Area {
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
  return {
    x: Math.max(0, (dims.width - width) / 2),
    y: Math.max(0, (dims.height - height) / 2),
    width,
    height,
  }
}

export async function generateCroppedImageBlob(file: File, croppedAreaPixels: Area, options: CropExportOptions): Promise<Blob | null> {
  try {
    const imageUrl = URL.createObjectURL(file)
    const blob = await renderCroppedImageBlob(imageUrl, croppedAreaPixels, options)
    URL.revokeObjectURL(imageUrl)
    return blob
  } catch {
    return null
  }
}

export async function generateCroppedImageBlobFromUrl(imageUrl: string, croppedAreaPixels: Area, options: CropExportOptions): Promise<Blob | null> {
  try {
    return await renderCroppedImageBlob(imageUrl, croppedAreaPixels, options)
  } catch {
    return null
  }
}
