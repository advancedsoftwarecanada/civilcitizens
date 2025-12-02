"use client"

import Image from 'next/image'
import clsx from 'clsx'

export type VerifiedAvatarProps = {
  src?: string | null
  alt: string
  initials?: string | null
  size?: number
  isVerified?: boolean
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
  className,
  badgeSize,
  hideBadge = false,
}: VerifiedAvatarProps) {
  const dimension = Math.max(24, Math.round(size))
  const fallback = deriveInitials(initials ?? alt)
  const textSize = Math.round(dimension / 2.4)
  const pinSize = badgeSize ?? Math.max(14, Math.round(dimension * 0.4))

  return (
    <div
      className={clsx(
        'relative inline-flex items-center justify-center overflow-hidden rounded-full bg-slate-200 text-slate-600',
        isVerified && 'ring-2 ring-[var(--cc-primary)] ring-offset-2 ring-offset-white',
        className,
      )}
      style={{ width: dimension, height: dimension }}
    >
      {src ? (
        <Image src={src} alt={alt} width={dimension} height={dimension} unoptimized className="h-full w-full object-cover" />
      ) : (
        <span className="select-none font-semibold" style={{ fontSize: `${textSize}px` }}>
          {fallback}
        </span>
      )}
      {isVerified && !hideBadge ? (
        <span className="pointer-events-none absolute -bottom-1 -right-1 rounded-full bg-white/80 p-[2px] shadow-md">
          <Image src="/verified.png" alt="Verified" width={pinSize} height={pinSize} className="block" priority={false} />
        </span>
      ) : null}
    </div>
  )
}
