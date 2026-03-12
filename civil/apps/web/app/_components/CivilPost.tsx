'use client'

import type { MouseEventHandler, ReactNode } from 'react'
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
  trailing?: ReactNode
  contentClassName?: string
  cardContentClassName?: string
  headerOverlay?: ReactNode
  afterHeader?: ReactNode
  content?: ReactNode
  body?: ReactNode
  images?: string[] | null
  mediaUrl?: string | null
  onClick?: MouseEventHandler<HTMLElement>
  className?: string
  bodyClassName?: string
  childrenClassName?: string
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
  trailing,
  contentClassName,
  cardContentClassName,
  headerOverlay,
  afterHeader,
  content,
  body,
  images,
  mediaUrl,
  onClick,
  className,
  bodyClassName,
  childrenClassName,
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
    <article className={clsx('surface-card min-w-0 space-y-4 px-6 py-5 shadow-subtle', className)} onClick={onClick}>
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
          contentClassName={cardContentClassName}
          trailing={trailing}
        />
        {headerOverlay}
      </header>

      {afterHeader ? <div>{afterHeader}</div> : null}

      {content ? (
        <div className={clsx('space-y-3 text-[15px] leading-6 text-slate-800', contentClassName)}>{content}</div>
      ) : (
        <div className={clsx('space-y-3 text-[15px] leading-6 text-slate-800', contentClassName)}>
          <CivilPostMedia images={images} mediaUrl={mediaUrl} postUrl={postHref} />
          {bodyContent}
        </div>
      )}

      {children ? <div className={clsx('space-y-3', childrenClassName)}>{children}</div> : null}
    </article>
  )
}