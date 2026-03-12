'use client'

import Link from 'next/link'

type CivilPostMediaProps = {
  images?: string[] | null
  mediaUrl?: string | null
  postUrl?: string | null
}

export default function CivilPostMedia({ images, mediaUrl, postUrl }: CivilPostMediaProps) {
  const allImages = images && images.length > 0 ? images : mediaUrl ? [mediaUrl] : []
  if (allImages.length === 0) return null

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

    return <div className="group relative block overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">{content}</div>
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
          <div key={src} className={className}>
            {image}
          </div>
        )
      })}
    </div>
  )
}