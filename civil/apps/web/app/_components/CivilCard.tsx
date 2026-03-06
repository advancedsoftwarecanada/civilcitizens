import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import VerifiedAvatar from './VerifiedAvatar'

export type CivilCardSize = 'sm' | 'md' | 'lg'

type CivilCardProps = {
  name: ReactNode
  avatarAlt: string
  avatarSrc?: string | null
  avatarInitials?: string | null
  avatarHref?: string
  coverUrl?: string | null
  href?: string
  titleHref?: string
  subtitle?: ReactNode
  titleSuffix?: ReactNode
  trailing?: ReactNode
  details?: ReactNode
  size?: CivilCardSize
  align?: 'center' | 'start'
  isVerified?: boolean
  isBusiness?: boolean
  avatarSize?: number
  titleLines?: number
  subtitleLines?: number
  className?: string
  contentClassName?: string
  titleClassName?: string
  subtitleClassName?: string
  titleSuffixClassName?: string
  detailsClassName?: string
  trailingClassName?: string
  interactive?: boolean
}

const CIVIL_CARD_SIZES: Record<
  CivilCardSize,
  {
    card: string
    identityGap: string
    avatar: number
    title: string
    subtitle: string
    details: string
    titleLines: number
    subtitleLines: number
  }
> = {
  sm: {
    card: 'min-h-[42px] rounded-xl px-2.5 py-1.5',
    identityGap: 'gap-2',
    avatar: 30,
    title: 'text-sm',
    subtitle: 'text-[11px]',
    details: 'text-xs',
    titleLines: 1,
    subtitleLines: 1,
  },
  md: {
    card: 'min-h-[54px] rounded-2xl px-3 py-2',
    identityGap: 'gap-2.5',
    avatar: 36,
    title: 'text-sm',
    subtitle: 'text-xs',
    details: 'text-xs',
    titleLines: 1,
    subtitleLines: 1,
  },
  lg: {
    card: 'min-h-[104px] rounded-3xl px-5 py-4',
    identityGap: 'gap-4',
    avatar: 64,
    title: 'text-2xl',
    subtitle: 'text-sm',
    details: 'text-sm',
    titleLines: 2,
    subtitleLines: 2,
  },
}

function clampStyle(lines?: number): CSSProperties | undefined {
  if (!lines || lines < 1) return undefined
  if (lines === 1) {
    return {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
  }

  return {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical' as CSSProperties['WebkitBoxOrient'],
    WebkitLineClamp: String(lines),
  }
}

export default function CivilCard({
  name,
  avatarAlt,
  avatarSrc = null,
  avatarInitials,
  avatarHref,
  coverUrl = null,
  href,
  titleHref,
  subtitle,
  titleSuffix,
  trailing,
  details,
  size = 'md',
  align,
  isVerified = false,
  isBusiness = false,
  avatarSize,
  titleLines,
  subtitleLines,
  className,
  contentClassName,
  titleClassName,
  subtitleClassName,
  titleSuffixClassName,
  detailsClassName,
  trailingClassName,
  interactive,
}: CivilCardProps) {
  const sizeStyles = CIVIL_CARD_SIZES[size]
  const resolvedTitleLines = titleLines ?? sizeStyles.titleLines
  const resolvedSubtitleLines = subtitleLines ?? sizeStyles.subtitleLines
  const resolvedAlign = align ?? (details ? 'start' : 'center')
  const isInteractive = interactive ?? Boolean(href || titleHref || avatarHref)

  const rootClassName = clsx(
    'group relative block overflow-hidden border border-slate-200 bg-slate-800 text-white shadow-sm',
    sizeStyles.card,
    isInteractive && 'transition duration-200 hover:brightness-105',
    className,
  )

  const titleNode = titleHref ? (
    <Link
      href={titleHref}
      className={clsx(
        'min-w-0 flex-1 font-semibold leading-tight text-white hover:underline',
        sizeStyles.title,
        titleClassName,
      )}
      style={clampStyle(resolvedTitleLines)}
    >
      {name}
    </Link>
  ) : (
    <p
      className={clsx(
        'min-w-0 flex-1 font-semibold leading-tight text-white',
        href && 'group-hover:underline',
        sizeStyles.title,
        titleClassName,
      )}
      style={clampStyle(resolvedTitleLines)}
    >
      {name}
    </p>
  )

  const content = (
    <>
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          className={clsx(
            'absolute inset-0 h-full w-full object-cover transition-transform duration-300',
            isInteractive && 'group-hover:scale-105',
          )}
          loading="lazy"
        />
      ) : null}
      <span
        className={clsx(
          'absolute inset-0',
          coverUrl ? 'bg-slate-950/55' : 'bg-[linear-gradient(120deg,#1e293b_0%,#0f172a_58%,#020617_100%)]',
        )}
        aria-hidden="true"
      />

      <div
        className={clsx(
          'relative z-[1] flex min-w-0 justify-between gap-3',
          resolvedAlign === 'start' ? 'items-start' : 'items-center',
          contentClassName,
        )}
      >
        <div
          className={clsx(
            'flex min-w-0 flex-1',
            resolvedAlign === 'start' ? 'items-start' : 'items-center',
            sizeStyles.identityGap,
          )}
        >
          <VerifiedAvatar
            src={avatarSrc}
            alt={avatarAlt}
            initials={avatarInitials ?? avatarAlt}
            size={avatarSize ?? sizeStyles.avatar}
            isVerified={isVerified}
            isBusiness={isBusiness}
            className="shrink-0"
            href={avatarHref}
          />

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {titleNode}
              {titleSuffix ? (
                <span
                  className={clsx(
                    'shrink-0 text-white/80',
                    size === 'lg' ? 'text-sm' : 'text-[11px]',
                    titleSuffixClassName,
                  )}
                >
                  {titleSuffix}
                </span>
              ) : null}
            </div>

            {subtitle ? (
              <div
                className={clsx('mt-0.5 text-white/82', sizeStyles.subtitle, subtitleClassName)}
                style={clampStyle(resolvedSubtitleLines)}
              >
                {subtitle}
              </div>
            ) : null}

            {details ? (
              <div className={clsx('mt-2 min-w-0 text-white/88', sizeStyles.details, detailsClassName)}>
                {details}
              </div>
            ) : null}
          </div>
        </div>

        {trailing ? <div className={clsx('relative z-[1] ml-3 shrink-0', trailingClassName)}>{trailing}</div> : null}
      </div>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={rootClassName}>
        {content}
      </Link>
    )
  }

  return <div className={rootClassName}>{content}</div>
}
