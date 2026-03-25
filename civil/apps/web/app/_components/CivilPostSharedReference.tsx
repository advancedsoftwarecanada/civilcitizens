'use client'

import Link from 'next/link'
import CivilCard from './CivilCard'
import CivilPostMedia from './CivilPostMedia'
import LinkifiedText from './LinkifiedText'

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
  mentions?: Array<{
    handle: string
    matchedHandle?: string | null
  }>
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
  mentions,
  images,
  mediaUrl,
}: CivilPostSharedReferenceProps) {
  return (
    <div className="mt-3 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-4 transition-colors hover:bg-slate-100">
      <Link href={href} className="block">
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
      </Link>
      <div className="text-sm text-slate-800 [overflow-wrap:anywhere] break-words">
        {body ? <LinkifiedText text={body} className="whitespace-pre-wrap" mentions={mentions} /> : null}
        {images && images.length > 0 ? (
          <Link href={href} className="mt-2 block">
            <CivilPostMedia images={images} mediaUrl={mediaUrl} postUrl={href} />
          </Link>
        ) : null}
      </div>
    </div>
  )
}
