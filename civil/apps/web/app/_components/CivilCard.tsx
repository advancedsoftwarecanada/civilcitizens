import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import VerifiedAvatar from './VerifiedAvatar'

export type CivilCardSize = 'sm' | 'rail' | 'md' | 'banner' | 'lg'

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
    avatarWidth?: number
    avatarHeight?: number
    avatarOverlay?: boolean
    contentPadding: string
    title: string
    subtitle: string
    details: string
    titleLines: number
    subtitleLines: number
  }
> = {
  sm: {
    card: 'min-h-[42px] rounded-xl px-0 py-0',
    identityGap: 'gap-2',
    avatar: 30,
    avatarWidth: 42,
    avatarHeight: 42,
    avatarOverlay: true,
    contentPadding: 'py-1.5 pl-[50px] pr-3',
    title: 'text-sm',
    subtitle: 'text-[11px]',
    details: 'text-xs',
    titleLines: 1,
    subtitleLines: 1,
  },
  rail: {
    card: 'min-h-[58px] rounded-2xl px-0 py-0',
    identityGap: 'gap-2.5',
    avatar: 40,
    avatarWidth: 58,
    avatarHeight: 58,
    avatarOverlay: true,
    contentPadding: 'py-2.5 pl-[70px] pr-3',
    title: 'text-sm',
    subtitle: 'text-xs',
    details: 'text-xs',
    titleLines: 1,
    subtitleLines: 1,
  },
  md: {
    card: 'min-h-[82px] rounded-[1.7rem] px-0 py-0',
    identityGap: 'gap-3',
    avatar: 56,
    avatarWidth: 86,
    avatarHeight: 82,
    avatarOverlay: true,
    contentPadding: 'py-3 pl-[98px] pr-4',
    title: 'text-base',
    subtitle: 'text-sm',
    details: 'text-sm',
    titleLines: 1,
    subtitleLines: 1,
  },
  banner: {
    card: 'min-h-[92px] rounded-[1.45rem] px-0 py-0',
    identityGap: 'gap-3',
    avatar: 62,
    avatarWidth: 96,
    avatarHeight: 92,
    avatarOverlay: true,
    contentPadding: 'py-3 pl-[108px] pr-4',
    title: 'text-lg',
    subtitle: 'text-xs',
    details: 'text-xs',
    titleLines: 1,
    subtitleLines: 1,
  },
  lg: {
    card: 'min-h-[126px] rounded-3xl px-0 py-0',
    identityGap: 'gap-4',
    avatar: 84,
    avatarWidth: 128,
    avatarHeight: 126,
    avatarOverlay: true,
    contentPadding: 'py-4 pl-[144px] pr-5',
    title: 'text-2xl',
    subtitle: 'text-base',
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

function deriveCardInitials(source?: string | null) {
  if (!source) return 'C'
  const cleaned = source.trim()
  if (!cleaned) return 'C'
  const parts = cleaned.split(/\s+/).filter(Boolean)
  const first = parts[0]?.charAt(0) ?? cleaned.charAt(0)
  const second = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) : cleaned.charAt(1)
  return `${first ?? ''}${second ?? ''}`.toUpperCase() || cleaned.charAt(0).toUpperCase()
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
  const usesAvatarOverlay = Boolean(sizeStyles.avatarOverlay)
  const resolvedTitleLines = titleLines ?? sizeStyles.titleLines
  const resolvedSubtitleLines = subtitleLines ?? sizeStyles.subtitleLines
  const resolvedAlign = align ?? (details ? 'start' : 'center')
  const isInteractive = interactive ?? Boolean(href || titleHref || avatarHref)
  const overlayAvatarWidth = Math.max(24, Math.round(avatarSize ?? sizeStyles.avatarWidth ?? sizeStyles.avatar))
  const overlayAvatarInitials = deriveCardInitials(avatarInitials ?? avatarAlt)

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

      {usesAvatarOverlay ? (
        avatarHref && !href ? (
          <Link
            href={avatarHref}
            aria-label={avatarAlt}
            className={clsx(
              'absolute inset-y-0 left-0 z-[2] flex items-center justify-center overflow-hidden text-slate-600',
              !avatarSrc && 'bg-slate-200',
            )}
            style={{ width: overlayAvatarWidth }}
          >
            {avatarSrc ? (
              <img src={avatarSrc} alt={avatarAlt} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <span className="select-none font-semibold" style={{ fontSize: `${Math.round(overlayAvatarWidth / 2.2)}px` }}>
                {overlayAvatarInitials}
              </span>
            )}
          </Link>
        ) : (
          <div
            className={clsx(
              'absolute inset-y-0 left-0 z-[2] flex items-center justify-center overflow-hidden text-slate-600',
              !avatarSrc && 'bg-slate-200',
            )}
            style={{ width: overlayAvatarWidth }}
          >
            {avatarSrc ? (
              <img src={avatarSrc} alt={avatarAlt} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <span className="select-none font-semibold" style={{ fontSize: `${Math.round(overlayAvatarWidth / 2.2)}px` }}>
                {overlayAvatarInitials}
              </span>
            )}
          </div>
        )
      ) : null}

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
            sizeStyles.contentPadding,
          )}
        >
          {!usesAvatarOverlay ? (
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
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {titleNode}
              {titleSuffix ? (
                <span
                  className={clsx(
                    'shrink-0 text-white/80',
                    size === 'lg' || size === 'banner' ? 'text-sm' : 'text-[11px]',
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
