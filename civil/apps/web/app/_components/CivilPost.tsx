'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import CivilCard from './CivilCard'
import CivilPostMedia from './CivilPostMedia'

type CivilPostProps = {
  name: ReactNode
  subtitle?: ReactNode
  details?: ReactNode
  titleSuffix?: ReactNode
  avatarAlt: string
  avatarInitials?: string | null
  avatarSrc?: string | null
  coverUrl?: string | null
  profileHref?: string
  postHref?: string
  isVerified?: boolean
  isBusiness?: boolean
  body?: ReactNode
  images?: string[] | null
  mediaUrl?: string | null
  className?: string
  bodyClassName?: string
  children?: ReactNode
}

export default function CivilPost({
  name,
  subtitle,
  details,
  titleSuffix,
  avatarAlt,
  avatarInitials,
  avatarSrc,
  coverUrl,
  profileHref,
  postHref,
  isVerified = false,
  isBusiness = false,
  body,
  images,
  mediaUrl,
  className,
  bodyClassName,
  children,
}: CivilPostProps) {
  const bodyContent = body ? (
    postHref ? (
      <Link href={postHref} className={clsx('block whitespace-pre-wrap text-slate-800 hover:text-slate-900', bodyClassName)}>
        {body}
      </Link>
    ) : (
      <div className={clsx('whitespace-pre-wrap text-slate-800', bodyClassName)}>{body}</div>
    )
  ) : null

  return (
    <article className={clsx('surface-card min-w-0 space-y-4 px-6 py-5 shadow-subtle', className)}>
      <header className="relative z-[2]">
        <CivilCard
          size="banner"
          name={name}
          titleSuffix={titleSuffix}
          subtitle={subtitle}
          details={details}
          avatarAlt={avatarAlt}
          avatarInitials={avatarInitials}
          avatarSrc={avatarSrc}
          avatarHref={profileHref}
          titleHref={profileHref}
          coverUrl={coverUrl}
          isVerified={isVerified}
          isBusiness={isBusiness}
        />
      </header>

      <div className="space-y-3 text-[15px] leading-6 text-slate-800">
        <CivilPostMedia images={images} mediaUrl={mediaUrl} postUrl={postHref} />
        {bodyContent}
      </div>

      {children ? <div className="space-y-3">{children}</div> : null}
    </article>
  )
}