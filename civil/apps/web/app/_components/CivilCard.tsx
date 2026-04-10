import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import VerifiedAvatar from './VerifiedAvatar'

export type CivilCardSize = 'sm' | 'rail' | 'md' | 'banner' | 'hero' | 'lg'

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
    avatarWidth?: number | string
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
    avatarWidth: '25%',
    avatarHeight: 42,
    avatarOverlay: true,
    contentPadding: 'py-1.5 pl-3 pr-3',
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
    avatarWidth: '25%',
    avatarHeight: 58,
    avatarOverlay: true,
    contentPadding: 'py-2.5 pl-4 pr-3',
    title: 'text-sm',
    subtitle: 'text-xs',
    details: 'text-xs',
    titleLines: 2,
    subtitleLines: 1,
  },
  md: {
    card: 'min-h-[82px] rounded-[1.7rem] px-0 py-0',
    identityGap: 'gap-3',
    avatar: 56,
    avatarWidth: '25%',
    avatarHeight: 82,
    avatarOverlay: true,
    contentPadding: 'py-3 pl-5 pr-4',
    title: 'text-base',
    subtitle: 'text-sm',
    details: 'text-sm',
    titleLines: 2,
    subtitleLines: 1,
  },
  banner: {
    card: 'min-h-[92px] rounded-[1.45rem] px-0 py-0',
    identityGap: 'gap-3',
    avatar: 62,
    avatarWidth: '25%',
    avatarHeight: 92,
    avatarOverlay: true,
    contentPadding: 'py-3 pl-5 pr-4',
    title: 'text-lg',
    subtitle: 'text-xs',
    details: 'text-xs',
    titleLines: 1,
    subtitleLines: 1,
  },
  hero: {
    card: 'min-h-[120px] rounded-[1.65rem] px-0 py-0',
    identityGap: 'gap-3.5',
    avatar: 80,
    avatarWidth: '25%',
    avatarHeight: 120,
    avatarOverlay: true,
    contentPadding: 'py-4 pl-6 pr-5',
    title: 'text-xl',
    subtitle: 'text-sm',
    details: 'text-sm',
    titleLines: 1,
    subtitleLines: 1,
  },
  lg: {
    card: 'min-h-[126px] rounded-3xl px-0 py-0',
    identityGap: 'gap-4',
    avatar: 84,
    avatarWidth: '25%',
    avatarHeight: 126,
    avatarOverlay: true,
    contentPadding: 'py-4 pl-6 pr-5',
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

function normalizeCardNameSegment(segment: string) {
  if (!segment) return segment

  return segment
    .split(/(['-])/)
    .map((part) => {
      if (!part || part === '-' || part === "'") return part
      const hasLetters = /[A-Za-z]/.test(part)
      if (!hasLetters) return part

      const isAllUpper = part === part.toUpperCase() && part !== part.toLowerCase()
      const hasMixedCase = part !== part.toLowerCase() && part !== part.toUpperCase()
      if (isAllUpper || hasMixedCase) return part

      return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`
    })
    .join('')
}

function normalizeCardName(name: ReactNode) {
  if (typeof name !== 'string') return name
  const trimmed = name.trim()
  if (!trimmed) return name

  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => normalizeCardNameSegment(segment))
    .join(' ')
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
  const hasSecondaryContent = Boolean(subtitle || details)
  const shouldUseGlassPanel = usesAvatarOverlay
  const shouldCenterOverlayIdentity = shouldUseGlassPanel && size === 'md' && !details
  const resolvedTitleLines = shouldCenterOverlayIdentity ? 0 : titleLines ?? sizeStyles.titleLines
  const resolvedSubtitleLines = subtitleLines ?? sizeStyles.subtitleLines
  const resolvedAlign = align ?? (details ? 'start' : 'center')
  const isInteractive = interactive ?? Boolean(href || titleHref || avatarHref)
  const resolvedTitleHref = href ? undefined : titleHref
  const resolvedAvatarHref = href ? undefined : avatarHref
  const overlayAvatarWidth = sizeStyles.avatarWidth ?? avatarSize ?? sizeStyles.avatar
  const overlayAvatarInitials = deriveCardInitials(avatarInitials ?? avatarAlt)
  const overlayAvatarFallbackSize = Math.max(16, Math.round((avatarSize ?? sizeStyles.avatar) / 1.3))
  const overlayMediaWidth = typeof overlayAvatarWidth === 'number' ? `${overlayAvatarWidth}px` : overlayAvatarWidth
  const normalizedAvatarSrc = typeof avatarSrc === 'string' && avatarSrc.trim() ? avatarSrc.trim() : null
  const [overlayAvatarFailed, setOverlayAvatarFailed] = useState(false)
  const overlayAvatarSrc = overlayAvatarFailed ? null : (normalizedAvatarSrc ?? '/guest.png')
  const usesGuestOverlayAvatar = !normalizedAvatarSrc
  const resolvedName = normalizeCardName(name)
  const centeredTitlePillClassName =
    'inline-flex max-w-full min-w-0 flex-col items-center justify-center rounded-[1.2rem] border border-white/18 bg-slate-950/20 px-5 py-3 text-center backdrop-blur-md shadow-[0_16px_36px_rgba(15,23,42,0.16)]'

  useEffect(() => {
    setOverlayAvatarFailed(false)
  }, [normalizedAvatarSrc])

  const rootClassName = clsx(
    'group relative block overflow-hidden border border-slate-200 bg-slate-800 text-white shadow-sm',
    sizeStyles.card,
    isInteractive && 'transition duration-200 hover:brightness-105',
    className,
  )

  const titleNode = resolvedTitleHref ? (
    <Link
      href={resolvedTitleHref}
      className={clsx(
        shouldCenterOverlayIdentity
          ? 'block max-w-full text-center font-semibold leading-tight text-white hover:underline'
          : 'min-w-0 flex-1 font-semibold leading-tight text-white hover:underline',
        sizeStyles.title,
        titleClassName,
      )}
      style={clampStyle(resolvedTitleLines)}
    >
      {resolvedName}
    </Link>
  ) : (
    <p
      className={clsx(
        shouldCenterOverlayIdentity
          ? 'block max-w-full text-center font-semibold leading-tight text-white'
          : 'min-w-0 flex-1 font-semibold leading-tight text-white',
        href && 'group-hover:underline',
        sizeStyles.title,
        titleClassName,
      )}
      style={clampStyle(resolvedTitleLines)}
    >
      {resolvedName}
    </p>
  )

  const centeredTitleNode = resolvedTitleHref ? (
    <Link
      href={resolvedTitleHref}
      className={clsx(
        'block w-fit max-w-full text-center font-semibold leading-tight text-white hover:underline',
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
        'block w-fit max-w-full text-center font-semibold leading-tight text-white',
        href && 'group-hover:underline',
        sizeStyles.title,
        titleClassName,
      )}
      style={clampStyle(resolvedTitleLines)}
    >
      {resolvedName}
    </p>
  )

  const centeredSubtitleNode = subtitle ? (
    <div
      className={clsx('max-w-full text-center text-white/82', sizeStyles.subtitle, subtitleClassName)}
      style={clampStyle(resolvedSubtitleLines)}
    >
      {subtitle}
    </div>
  ) : null

  const content = (
    <>
      <span
        className={clsx(
          'absolute inset-0',
          'bg-[linear-gradient(120deg,#1e293b_0%,#0f172a_58%,#020617_100%)]',
        )}
        aria-hidden="true"
      />
      {usesAvatarOverlay ? (
        <span
          className="absolute inset-y-0 right-0 z-[1]"
          aria-hidden="true"
          style={{
            left: overlayMediaWidth,
            background: 'linear-gradient(90deg, rgba(2,6,23,0.88) 0%, rgba(2,6,23,0.72) 18%, rgba(2,6,23,0.52) 42%, rgba(2,6,23,0.28) 100%)',
          }}
        />
      ) : null}

      {usesAvatarOverlay ? (
        resolvedAvatarHref ? (
          <Link
            href={resolvedAvatarHref}
            aria-label={avatarAlt}
            className={clsx(
              'absolute inset-y-0 left-0 z-[2] flex items-center justify-center overflow-hidden text-slate-600',
              !normalizedAvatarSrc && 'bg-slate-200',
            )}
            style={{ width: overlayMediaWidth }}
          >
            {overlayAvatarSrc ? (
              <img
                src={overlayAvatarSrc}
                alt={avatarAlt}
                className={clsx('h-full w-full', usesGuestOverlayAvatar ? 'object-contain p-3' : 'object-cover')}
                loading="lazy"
                onError={() => setOverlayAvatarFailed(true)}
              />
            ) : (
              <span className="select-none font-semibold" style={{ fontSize: `${overlayAvatarFallbackSize}px` }}>
                {overlayAvatarInitials}
              </span>
            )}
          </Link>
        ) : (
          <div
            className={clsx(
              'absolute inset-y-0 left-0 z-[2] flex items-center justify-center overflow-hidden text-slate-600',
              !normalizedAvatarSrc && 'bg-slate-200',
            )}
            style={{ width: overlayMediaWidth }}
          >
            {overlayAvatarSrc ? (
              <img
                src={overlayAvatarSrc}
                alt={avatarAlt}
                className={clsx('h-full w-full', usesGuestOverlayAvatar ? 'object-contain p-3' : 'object-cover')}
                loading="lazy"
                onError={() => setOverlayAvatarFailed(true)}
              />
            ) : (
              <span className="select-none font-semibold" style={{ fontSize: `${overlayAvatarFallbackSize}px` }}>
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
          {usesAvatarOverlay ? <div className="shrink-0" style={{ width: overlayMediaWidth }} aria-hidden="true" /> : null}

          {!usesAvatarOverlay ? (
            <VerifiedAvatar
              src={avatarSrc}
              alt={avatarAlt}
              initials={avatarInitials ?? avatarAlt}
              size={avatarSize ?? sizeStyles.avatar}
              isVerified={isVerified}
              isBusiness={isBusiness}
              className="shrink-0"
              href={resolvedAvatarHref}
            />
          ) : null}

          <div
            className={clsx(
              'flex min-h-full min-w-0 flex-1 flex-col justify-center',
              hasSecondaryContent && shouldUseGlassPanel && !shouldCenterOverlayIdentity && 'rounded-[1.2rem] border border-white/18 bg-slate-950/20 px-3 py-2 backdrop-blur-md shadow-[0_16px_36px_rgba(15,23,42,0.16)]',
            )}
          >
            {shouldCenterOverlayIdentity ? (
              <div className="flex min-h-full w-full items-center justify-center">
                <div className={clsx(centeredTitlePillClassName, 'w-fit gap-y-1')}>
                  <div className="flex max-w-full min-w-0 items-center justify-center gap-x-2 text-center">
                    {centeredTitleNode}
                    {titleSuffix ? (
                      <span
                        className={clsx(
                          'shrink-0 text-white/80',
                          'text-[11px]',
                          titleSuffixClassName,
                        )}
                      >
                        {titleSuffix}
                      </span>
                    ) : null}
                  </div>
                  {centeredSubtitleNode}
                </div>
              </div>
            ) : hasSecondaryContent ? (
              <>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {titleNode}
                  {titleSuffix ? (
                    <span
                      className={clsx(
                        'shrink-0 text-white/80',
                        'text-[11px]',
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
              </>
            ) : (
              <div className="flex min-h-full w-full items-center justify-center">
                <div className={clsx(centeredTitlePillClassName, 'w-fit gap-y-1')}>
                  {centeredTitleNode}
                  {titleSuffix ? (
                    <span
                      className={clsx(
                        'shrink-0 text-white/80',
                        'text-[11px]',
                        titleSuffixClassName,
                      )}
                    >
                      {titleSuffix}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
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
