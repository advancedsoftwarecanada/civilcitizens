'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolvePublicAssetUrl } from '../_lib/publicAssetUrl'

type CivilPostMediaProps = {
  images?: string[] | null
  mediaUrl?: string | null
  postUrl?: string | null
}

export default function CivilPostMedia({ images, mediaUrl, postUrl }: CivilPostMediaProps) {
  const allImages = useMemo(() => {
    const rawImages = images && images.length > 0 ? images : mediaUrl ? [mediaUrl] : []
    return rawImages
      .map((value) => resolvePublicAssetUrl(value, typeof window !== 'undefined' ? window.location.origin : null))
      .filter((value): value is string => Boolean(value))
  }, [images, mediaUrl])
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null)

  if (allImages.length === 0) return null

  const activeImageSrc = typeof activeImageIndex === 'number' ? allImages[activeImageIndex] ?? null : null

  const moveActiveImage = useCallback(
    (direction: 'prev' | 'next') => {
      if (allImages.length <= 1) return
      setActiveImageIndex((current) => {
        if (typeof current !== 'number') return current
        if (direction === 'prev') {
          return current === 0 ? allImages.length - 1 : current - 1
        }
        return current === allImages.length - 1 ? 0 : current + 1
      })
    },
    [allImages.length],
  )

  useEffect(() => {
    if (activeImageIndex === null) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveImageIndex(null)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        moveActiveImage('prev')
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveActiveImage('next')
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeImageIndex, moveActiveImage])

  if (allImages.length === 1) {
    const imageSrc = allImages[0]
    if (!imageSrc) return null
    const tiledBackdropStyle = {
      backgroundImage: `url("${imageSrc.replace(/"/g, '\\"')}")`,
      backgroundPosition: 'center',
      backgroundRepeat: 'repeat',
      backgroundSize: 'auto 100%',
    } as const
    const content = (
      <>
        <div className="absolute inset-[-8%] overflow-hidden" aria-hidden="true">
          <div
            className="h-full w-full scale-110 opacity-50 blur-3xl saturate-150 transition-transform duration-500 group-hover:scale-[1.16]"
            style={tiledBackdropStyle}
          />
          <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.18)_0%,rgba(15,23,42,0.08)_45%,rgba(15,23,42,0.18)_100%)]" />
        </div>
        <div className="relative flex min-h-[16rem] items-center justify-center bg-slate-950/8 px-2 py-2 sm:min-h-[20rem]">
          <img
            src={imageSrc}
            alt="Post image"
            className="relative z-[1] h-auto w-full max-h-[70vh] object-contain"
            loading="lazy"
          />
        </div>
      </>
    )

    if (postUrl) {
      return (
        <Link href={postUrl} className="group relative block overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
          {content}
        </Link>
      )
    }

    return (
      <>
        <button
          type="button"
          onClick={() => setActiveImageIndex(0)}
          className="group relative block w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-left"
          aria-label="Open image"
        >
          {content}
        </button>
        {activeImageSrc && typeof document !== 'undefined'
          ? createPortal(
              <div
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm"
                onClick={() => setActiveImageIndex(null)}
              >
                <button
                  type="button"
                  onClick={() => setActiveImageIndex(null)}
                  className="absolute right-3 top-3 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
                >
                  Close
                </button>
                <div className="max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
                  <img
                    src={activeImageSrc}
                    alt="Post image full view"
                    className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain shadow-2xl"
                  />
                </div>
              </div>,
              document.body,
            )
          : null}
      </>
    )
  }

  const displayImages = allImages.slice(0, 5)
  const remainingCount = allImages.length - 5

  return (
    <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 sm:grid-cols-6">
      {displayImages.map((src, index) => {
        let className = 'relative aspect-square w-full overflow-hidden bg-slate-100'
        const isLast = index === displayImages.length - 1

        if (displayImages.length === 2) {
          className += ' col-span-1 sm:col-span-3'
        } else if (displayImages.length === 3) {
          if (index === 0) className += ' col-span-2 sm:col-span-4 row-span-2'
          else className += ' col-span-1 sm:col-span-2'
        } else if (displayImages.length === 4) {
          className += ' col-span-1 sm:col-span-3'
        } else if (displayImages.length >= 5) {
          if (index < 2) className += ' col-span-1 sm:col-span-3'
          else if (index === 4) className += ' col-span-2 sm:col-span-2'
          else className += ' col-span-1 sm:col-span-2'
        }

        const image = (
          <>
            <img src={src} alt={`Post image ${index + 1}`} className="h-full w-full object-cover" loading="lazy" />
            {isLast && remainingCount > 0 ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-lg font-bold text-white backdrop-blur-sm">
                +{remainingCount} more
              </div>
            ) : null}
          </>
        )

        if (postUrl) {
          return (
            <Link key={src} href={postUrl} className={className}>
              {image}
            </Link>
          )
        }

        return (
          <button
            key={`${src}-${index}`}
            type="button"
            onClick={() => setActiveImageIndex(index)}
            className={`${className} cursor-zoom-in text-left`}
            aria-label={`Open image ${index + 1}`}
          >
            {image}
          </button>
        )
      })}
      {activeImageSrc && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm"
              onClick={() => setActiveImageIndex(null)}
            >
              <button
                type="button"
                onClick={() => setActiveImageIndex(null)}
                className="absolute right-3 top-3 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
              >
                Close
              </button>
              {allImages.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      moveActiveImage('prev')
                    }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      moveActiveImage('next')
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/25"
                  >
                    →
                  </button>
                </>
              ) : null}
              <div className="max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
                <img
                  src={activeImageSrc}
                  alt={`Post image ${activeImageIndex !== null ? activeImageIndex + 1 : 1} full view`}
                  className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain shadow-2xl"
                />
              </div>
              <div className="absolute bottom-3 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
                {(activeImageIndex ?? 0) + 1} / {allImages.length}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
