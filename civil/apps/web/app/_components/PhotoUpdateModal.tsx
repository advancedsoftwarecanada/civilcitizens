'use client'

import Cropper, { Area } from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'

export default function PhotoUpdateModal({
  open,
  title,
  subtitle,
  imageUrl,
  cropperImageUrl,
  aspect,
  cropShape,
  showGrid,
  crop,
  zoom,
  maxZoom,
  onCropChange,
  onZoomChange,
  onCropComplete,
  onResetPosition,
  onPickFile,
  uploadStatus,
  uploadError,
  showCaption = true,
  caption,
  onCaptionChange,
  primaryLabel,
  primaryDisabled,
  primaryLoading,
  primaryLoadingLabel,
  onPrimary,
  onClose,
}: {
  open: boolean
  title: string
  subtitle?: string
  imageUrl: string | null
  cropperImageUrl: string | null
  aspect: number
  cropShape: 'round' | 'rect'
  showGrid: boolean
  crop: { x: number; y: number }
  zoom: number
  maxZoom: number
  onCropChange: (nextCrop: { x: number; y: number }) => void
  onZoomChange: (nextZoom: number) => void
  onCropComplete: (area: Area, areaPixels: Area) => void
  onResetPosition: () => void
  onPickFile: () => void
  uploadStatus?: 'idle' | 'uploading' | 'processing' | 'ready' | 'error'
  uploadError?: string | null
  showCaption?: boolean
  caption: string
  onCaptionChange: (nextCaption: string) => void
  primaryLabel: string
  primaryDisabled: boolean
  primaryLoading: boolean
  primaryLoadingLabel?: string
  onPrimary: () => void
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="cc-safe-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="cc-safe-modal-panel flex w-full max-w-2xl flex-col rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            {subtitle ? <p className="text-sm text-gray-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mt-5 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border bg-slate-50">
              {cropperImageUrl ? (
                <div className="relative h-64 w-full bg-gray-900/5">
                  <Cropper
                    key={cropperImageUrl}
                    image={cropperImageUrl}
                    crop={crop}
                    zoom={zoom}
                    aspect={aspect}
                    cropShape={cropShape}
                    showGrid={showGrid}
                    restrictPosition
                    objectFit="contain"
                    onCropChange={onCropChange}
                    onZoomChange={onZoomChange}
                    onCropComplete={onCropComplete}
                  />
                </div>
              ) : imageUrl ? (
                <img src={imageUrl} alt="Preview" className="h-64 w-full object-cover" />
              ) : (
                <div className="flex h-64 w-full items-center justify-center text-sm text-slate-500">Upload a photo to preview it.</div>
              )}
            </div>

            {cropperImageUrl ? (
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                <label className="font-medium text-gray-700" htmlFor="crop-zoom">
                  Zoom
                </label>
                <input
                  id="crop-zoom"
                  type="range"
                  min={1}
                  max={maxZoom}
                  step={0.01}
                  value={zoom}
                  onChange={(event) => {
                    const nextValue = Number.parseFloat(event.target.value)
                    onZoomChange(Number.isNaN(nextValue) ? 1 : nextValue)
                  }}
                  className="h-1 w-48 flex-1 cursor-pointer accent-[var(--cc-primary)]"
                />
                <button type="button" onClick={onResetPosition} className="text-[var(--cc-primary)] transition hover:underline">
                  Reset position
                </button>
              </div>
            ) : null}

            {cropperImageUrl ? (
              <p className="text-xs text-gray-500">Drag the image to find the perfect crop.</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <button
              type="button"
              onClick={onPickFile}
              className="rounded border border-gray-300 px-3 py-1 font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={uploadStatus === 'uploading' || uploadStatus === 'processing' || primaryLoading}
            >
              {uploadStatus === 'uploading' ? 'Uploading…' : 'Choose photo'}
            </button>
            {uploadStatus === 'processing' ? <span className="text-amber-600">Processing your photo…</span> : null}
            {uploadError ? <span className="text-red-600">{uploadError}</span> : null}
          </div>

          {showCaption ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700" htmlFor="photo-description">
                Description
              </label>
              <textarea
                id="photo-description"
                value={caption}
                onChange={(event) => onCaptionChange(event.target.value)}
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
                placeholder="Description"
                disabled={uploadStatus === 'uploading' || uploadStatus === 'processing' || primaryLoading}
              />
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex shrink-0 justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={onPrimary}
            disabled={primaryLoading || primaryDisabled}
            className="rounded bg-[var(--cc-primary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--cc-primary-700)] disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {primaryLoading ? (primaryLoadingLabel || 'Posting…') : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
