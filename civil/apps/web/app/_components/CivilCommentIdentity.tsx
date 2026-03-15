'use client'

import Link from 'next/link'
import clsx from 'clsx'
import VerifiedAvatar from './VerifiedAvatar'

type CivilCommentIdentityProps = {
  handle: string
  name: string
  avatarUrl?: string | null
  isVerified?: boolean
  isBusiness?: boolean
  meta?: string
  badgeLabel?: string
  showAvatar?: boolean
  linkProfile?: boolean
  className?: string
}

export default function CivilCommentIdentity({
  handle,
  name,
  avatarUrl,
  isVerified = false,
  isBusiness = false,
  meta,
  badgeLabel,
  showAvatar = true,
  linkProfile = true,
  className,
}: CivilCommentIdentityProps) {
  const profileHref = `/u/${handle}`

  return (
    <div className={clsx('inline-flex min-w-0 items-start gap-2.5', className)}>
      {showAvatar ? (
        <VerifiedAvatar
          src={avatarUrl ?? null}
          alt={name}
          initials={name}
          size={32}
          isVerified={isVerified}
          isBusiness={isBusiness}
          href={linkProfile ? profileHref : undefined}
          className="shrink-0"
        />
      ) : null}
      <div className="min-w-0 space-y-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-4">
          {linkProfile ? (
            <>
              <Link href={profileHref} className="max-w-full truncate text-sm font-semibold text-slate-900 hover:text-[var(--cc-primary)]">
                {name}
              </Link>
              <Link href={profileHref} className="text-xs font-medium text-slate-500 hover:text-[var(--cc-primary)]">
                @{handle}
              </Link>
            </>
          ) : (
            <>
              <span className="max-w-full truncate text-sm font-semibold text-slate-900">{name}</span>
              <span className="text-xs font-medium text-slate-500">@{handle}</span>
            </>
          )}
          {badgeLabel ? (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {badgeLabel}
            </span>
          ) : null}
          {meta ? <span className="text-[11px] font-medium text-slate-400">{meta}</span> : null}
        </div>
      </div>
    </div>
  )
}