'use client'

import Link from 'next/link'
import CivilCard from './CivilCard'
import CivilPostMedia from './CivilPostMedia'

type CivilPostSharedReferenceProps = {
  href: string
  name: string
  subtitle?: string
  avatarAlt: string
  avatarInitials?: string | null
  avatarSrc?: string | null
  coverUrl?: string | null
  isVerified?: boolean
  isBusiness?: boolean
  body?: string | null
  images?: string[] | null
  mediaUrl?: string | null
}

export default function CivilPostSharedReference({
  href,
  name,
  subtitle,
  avatarAlt,
  avatarInitials,
  avatarSrc,
  coverUrl,
  isVerified = false,
  isBusiness = false,
  body,
  images,
  mediaUrl,
}: CivilPostSharedReferenceProps) {
  return (
    <Link
      href={href}
      className="mt-3 block w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-4 transition-colors hover:bg-slate-100"
    >
      <CivilCard
        size="rail"
        name={name}
        subtitle={subtitle}
        avatarAlt={avatarAlt}
        avatarInitials={avatarInitials}
        avatarSrc={avatarSrc}
        coverUrl={coverUrl}
        isVerified={isVerified}
        isBusiness={isBusiness}
        className="mb-2 w-fit max-w-full"
      />
      <div className="text-sm text-slate-800 [overflow-wrap:anywhere] break-words">
        {body ? <div className="whitespace-pre-wrap">{body}</div> : null}
        {images && images.length > 0 ? (
          <div className="mt-2">
            <CivilPostMedia images={images} mediaUrl={mediaUrl} postUrl={href} />
          </div>
        ) : null}
      </div>
    </Link>
  )
}