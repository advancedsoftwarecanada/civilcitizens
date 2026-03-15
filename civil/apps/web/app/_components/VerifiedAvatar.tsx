"use client"

import Image from 'next/image'
import Link from 'next/link'
import clsx from 'clsx'

export type VerifiedAvatarProps = {
  src?: string | null
  alt: string
  initials?: string | null
  size?: number
  width?: number
  height?: number
  isVerified?: boolean
  isBusiness?: boolean
  className?: string
  badgeSize?: number
  hideBadge?: boolean
  href?: string
  roundedClassName?: string
  imageClassName?: string
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
  width,
  height,
  isVerified = false,
  isBusiness = false,
  className,
  badgeSize,
  hideBadge = false,
  href,
  roundedClassName,
  imageClassName,
}: VerifiedAvatarProps) {
  const resolvedWidth = Math.max(24, Math.round(width ?? size))
  const resolvedHeight = Math.max(24, Math.round(height ?? size))
  const dimension = Math.max(resolvedWidth, resolvedHeight)
  const fallback = deriveInitials(initials ?? alt)
  const textSize = Math.round(dimension / 2.4)
  const pinSize = badgeSize ?? Math.max(16, Math.round(dimension * 0.45))
  const shapeClassName = roundedClassName ?? 'rounded-full'
  const badgeVariant = isVerified ? 'verified' : isBusiness ? 'business' : null
  const ringClass =
    badgeVariant === 'business'
      ? 'ring-1 ring-amber-500 ring-offset-1 ring-offset-white'
      : badgeVariant === 'verified'
        ? 'ring-1 ring-[var(--cc-primary)] ring-offset-1 ring-offset-white'
        : ''
  const badgeImage = badgeVariant === 'business' ? '/document-verified.png' : '/self-verified.png'
  const badgeAlt =
    badgeVariant === 'business'
      ? 'Document verified badge'
      : badgeVariant === 'verified'
        ? 'Self-verified Canadian citizen badge'
        : undefined

  const wrapperProps = {
    className: clsx('relative inline-flex items-center justify-center', shapeClassName, className),
    style: { width: resolvedWidth, height: resolvedHeight },
  }

  const avatarCore = (
    <>
      <div
        className={clsx(
          'relative inline-flex h-full w-full items-center justify-center overflow-hidden bg-slate-200 text-slate-600',
          shapeClassName,
          ringClass || undefined,
        )}
      >
        {src ? (
          <Image
            src={src}
            alt={alt}
            width={resolvedWidth}
            height={resolvedHeight}
            unoptimized
            className={clsx('h-full w-full object-cover', imageClassName)}
          />
        ) : (
          <span className="select-none font-semibold" style={{ fontSize: `${textSize}px` }}>
            {fallback}
          </span>
        )}
      </div>
      {badgeVariant && !hideBadge ? (
        <span className="pointer-events-none absolute -bottom-1.5 -right-1 z-10 drop-shadow-lg">
          <Image
            src={badgeImage}
            alt={badgeAlt ?? 'Status badge'}
            width={pinSize}
            height={pinSize}
            className="block"
            style={{ width: 'auto', height: 'auto' }}
            priority={false}
          />
        </span>
      ) : null}
    </>
  )

  if (href) {
    return (
      <Link href={href} aria-label={alt} {...wrapperProps}>
        {avatarCore}
      </Link>
    )
  }

  return (
    <div {...wrapperProps}>
      {avatarCore}
    </div>
  )
}
