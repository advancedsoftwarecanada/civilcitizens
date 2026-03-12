'use client'

import { forwardRef, type ReactNode } from 'react'
import clsx from 'clsx'

type CivilComposerShellProps = {
  title?: ReactNode
  description?: ReactNode
  titleClassName?: string
  descriptionClassName?: string
  headerContent?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}

const CivilComposerShell = forwardRef<HTMLElement, CivilComposerShellProps>(function CivilComposerShell(
  {
    title,
    description,
    titleClassName,
    descriptionClassName,
    headerContent,
    className,
    bodyClassName,
    children,
  },
  ref,
) {
  const hasHeader = Boolean(title || description || headerContent)

  return (
    <section ref={ref} className={clsx('surface-card space-y-4 px-6 py-5', className)}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          {title || description ? (
            <div>
              {title ? (
                <p className={clsx('text-xs font-semibold uppercase tracking-[0.35em] text-[var(--cc-primary)]', titleClassName)}>{title}</p>
              ) : null}
              {description ? <p className={clsx(title ? 'mt-2 text-sm text-slate-600' : 'text-sm text-slate-600', descriptionClassName)}>{description}</p> : null}
            </div>
          ) : null}
          {headerContent ? <div>{headerContent}</div> : null}
        </div>
      ) : null}

      <div className={bodyClassName}>{children}</div>
    </section>
  )
})

export default CivilComposerShell