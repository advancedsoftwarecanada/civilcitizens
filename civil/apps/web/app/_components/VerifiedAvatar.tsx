"use client"

import Image from 'next/image'
import clsx from 'clsx'

export type VerifiedAvatarProps = {
  src?: string | null
  alt: string
  initials?: string | null
  size?: number
  isVerified?: boolean
  isBusiness?: boolean
  className?: string
  badgeSize?: number
  hideBadge?: boolean
}

function deriveInitials(source?: string | null) {
  if (!source) return 'C'
  const cleaned = source.trim()
  if (!cleaned) return 'C'
  const parts = cleaned.split(/\s+/).filter(Boolean)
  const first = parts[0]?.charAt(0) ?? cleaned.charAt(0)
  const second = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) : cleaned.charAt(1)
  return `${first ?? ''}${second ?? ''}`.toUpperCase() || cleaned.charAt(0).toUpperCase()
}

export default function VerifiedAvatar({
  src,
  alt,
  initials,
  size = 48,
  isVerified = false,
  isBusiness = false,
  className,
  badgeSize,
  hideBadge = false,
}: VerifiedAvatarProps) {
  const dimension = Math.max(24, Math.round(size))
  const fallback = deriveInitials(initials ?? alt)
  const textSize = Math.round(dimension / 2.4)
  const pinSize = badgeSize ?? Math.max(16, Math.round(dimension * 0.45))
  const badgeVariant = isVerified ? 'verified' : isBusiness ? 'business' : null
  const ringClass =
    badgeVariant === 'business'
      ? 'ring-2 ring-amber-500 ring-offset-2 ring-offset-white'
      : badgeVariant === 'verified'
        ? 'ring-2 ring-[var(--cc-primary)] ring-offset-2 ring-offset-white'
        : ''
  const badgeImage = badgeVariant === 'business' ? '/business.png' : '/verified.png'
  const badgeAlt = badgeVariant === 'business' ? 'Business badge' : badgeVariant === 'verified' ? 'Verified badge' : undefined

  return (
    <div className={clsx('relative inline-flex items-center justify-center', className)} style={{ width: dimension, height: dimension }}>
      <div
        className={clsx(
          'relative inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-slate-200 text-slate-600',
          ringClass || undefined,
        )}
      >
        {src ? (
          <Image src={src} alt={alt} width={dimension} height={dimension} unoptimized className="h-full w-full object-cover" />
        ) : (
          <span className="select-none font-semibold" style={{ fontSize: `${textSize}px` }}>
            {fallback}
          </span>
        )}
      </div>
      {badgeVariant && !hideBadge ? (
        <span className="pointer-events-none absolute -top-1.5 -right-1 z-10 drop-shadow-lg">
          <Image src={badgeImage} alt={badgeAlt ?? 'Status badge'} width={pinSize} height={pinSize} className="block" priority={false} />
        </span>
      ) : null}
    </div>
  )
}
