'use client'

import clsx from 'clsx'
import VerifiedAvatar from './VerifiedAvatar'

export type CivilComposerLauncherAction = {
  type: string
  label: string
  icon: string
}

type CivilComposerLauncherProps = {
  title?: string
  description?: string
  coverUrl?: string | null
  avatarSrc?: string | null
  avatarAlt: string
  avatarInitials?: string | null
  avatarHref?: string
  isVerified?: boolean
  isBusiness?: boolean
  prompt: string
  actions: CivilComposerLauncherAction[]
  onPrimaryClick: () => void
  onActionClick: (type: string) => void
}

export default function CivilComposerLauncher({
  title,
  description,
  coverUrl,
  avatarSrc,
  avatarAlt,
  avatarInitials,
  avatarHref,
  isVerified = false,
  isBusiness = false,
  prompt,
  actions,
  onPrimaryClick,
  onActionClick,
}: CivilComposerLauncherProps) {
  const hasCover = Boolean(coverUrl)
  const sectionClassName = clsx(
    'relative min-w-0 space-y-4 overflow-hidden px-6 py-5 shadow-subtle',
    hasCover
      ? 'rounded-[var(--cc-radius)] border border-white/[0.18] bg-transparent shadow-[0_24px_56px_rgba(15,23,42,0.14)]'
      : 'surface-card',
  )
  const headerPanelClassName = hasCover
    ? 'inline-flex max-w-xl flex-col rounded-[1.35rem] border border-white/16 bg-slate-950/18 px-4 py-3 backdrop-blur-md shadow-[0_18px_40px_rgba(15,23,42,0.16)]'
    : ''
  const titleClassName = hasCover
    ? 'text-white/80 [text-shadow:0_1px_2px_rgba(15,23,42,0.55)]'
    : 'text-slate-400'
  const descriptionClassName = hasCover
    ? 'mt-1 text-sm text-white/78 [text-shadow:0_1px_2px_rgba(15,23,42,0.45)]'
    : 'mt-1 text-sm text-slate-500'
  const promptClassName = hasCover
    ? 'border border-white/20 bg-slate-950/[0.22] text-white/90 backdrop-blur-md hover:border-[var(--cc-primary)] hover:bg-slate-950/[0.30] hover:text-white'
    : 'border border-slate-200 bg-slate-50 text-slate-500 hover:bg-white hover:text-slate-700'
  const actionClassName = hasCover
    ? 'border border-white/[0.22] bg-slate-950/[0.18] text-white backdrop-blur-md hover:border-[var(--cc-primary)] hover:bg-slate-950/[0.26] hover:text-white'
    : 'border border-slate-200 bg-white/90 hover:border-slate-300 hover:bg-white hover:text-slate-700'
  const actionIconClassName = hasCover
    ? 'bg-white/[0.16] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
    : 'bg-slate-100 text-slate-600'

  return (
    <section className={sectionClassName}>
      {coverUrl ? (
        <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      ) : null}
      <span className="absolute inset-0 bg-transparent" aria-hidden="true" />

      {(title || description) ? (
        <div className="relative z-[1] flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className={headerPanelClassName || undefined}>
            {title ? <p className={clsx('text-xs font-semibold uppercase tracking-[0.35em]', titleClassName)}>{title}</p> : null}
            {description ? <p className={descriptionClassName}>{description}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="relative z-[1] flex items-center gap-3">
        <VerifiedAvatar
          src={avatarSrc}
          alt={avatarAlt}
          initials={avatarInitials}
          size={56}
          isVerified={isVerified}
          isBusiness={isBusiness}
          className="shrink-0"
          href={avatarHref}
        />
        <button
          type="button"
          className={clsx('flex-1 rounded-full px-4 py-3 text-left text-sm transition', promptClassName)}
          onClick={onPrimaryClick}
        >
          {prompt}
        </button>
      </div>

      <div className={clsx('relative z-[1] flex flex-wrap items-center gap-3 text-xs font-semibold', hasCover ? 'text-white' : 'text-slate-500')}>
        {actions.map((action) => (
          <button
            key={action.type}
            type="button"
            className={clsx('inline-flex min-w-[108px] items-center justify-center gap-2.5 rounded-full px-4 py-2 text-sm transition', actionClassName)}
            onClick={() => onActionClick(action.type)}
          >
            <span
              className={clsx('inline-flex h-6 w-6 items-center justify-center rounded-full text-[0.95rem] leading-none', actionIconClassName)}
              role="img"
              aria-label={action.label}
            >
              {action.icon}
            </span>
            {action.label}
          </button>
        ))}
      </div>
    </section>
  )
}