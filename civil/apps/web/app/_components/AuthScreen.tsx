import type { ReactNode } from 'react'
import BackgroundVideo from './BackgroundVideo'

const DEFAULT_HIGHLIGHTS = [
  {
    title: 'One riding, one room',
    description: 'Civil organizes every conversation by your Electoral District Association so civic talk stays relevant.',
  },
  {
    title: 'Verified neighbours',
    description: 'Profiles, MPs, and local businesses are all verified so discussions stay constructive and spam-free.',
  },
  {
    title: 'Actions that matter',
    description: 'Track legislation, coordinate townhalls, and surface ideas directly to people who can move them forward.',
  },
]

export type AuthScreenProps = {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  sideTitle?: string
  sideDescription?: string
  sideHighlights?: Array<{ title: string; description: string }>
  hideSidePanel?: boolean
  useWallpaper?: boolean
}

export function AuthScreen({
  title,
  subtitle,
  children,
  footer,
  sideTitle = 'Your civic headquarters',
  sideDescription = 'Drop your postal code, pick your home city, and join respectful conversations with the MPs, councils, and businesses that shape your riding every day.',
  sideHighlights = DEFAULT_HIGHLIGHTS,
  hideSidePanel = false,
  useWallpaper = false,
}: AuthScreenProps) {
  const hasSidePanel = !hideSidePanel
  const containerClass = hasSidePanel
    ? 'cc-auth-screen__container mx-auto flex min-h-[var(--cc-viewport-height)] max-w-6xl flex-col gap-10 px-4 py-12 sm:px-8 lg:flex-row lg:items-stretch'
    : 'cc-auth-screen__container mx-auto flex min-h-[var(--cc-viewport-height)] max-w-xl flex-col justify-center gap-10 px-4 py-12 sm:px-8'
  const outerClass = useWallpaper
    ? 'cc-auth-screen relative isolate min-h-[var(--cc-viewport-height)]'
    : 'cc-auth-screen min-h-[var(--cc-viewport-height)] bg-gradient-to-br from-white via-[#fff4f3] to-[#eef6ff]'

  return (
    <div className={outerClass}>
      {useWallpaper ? (
        <>
          <BackgroundVideo fixed />
          <div className="fixed inset-0 -z-10 bg-slate-950/50 pointer-events-none" aria-hidden="true" />
        </>
      ) : null}
      <div className={`${useWallpaper ? 'relative z-10' : ''} ${containerClass}`}>
        {hasSidePanel ? (
          <div className="order-2 flex flex-1 flex-col justify-between rounded-[32px] border border-white/60 bg-white/60 p-8 text-slate-700 shadow-[0_40px_120px_rgba(15,23,42,0.12)] backdrop-blur">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-rose-400">Civil Citizens</p>
              <h2 className="mt-4 text-3xl font-semibold text-slate-900">{sideTitle}</h2>
              <p className="mt-3 text-base text-slate-600">{sideDescription}</p>
              <ul className="mt-6 space-y-4">
                {sideHighlights.map((item) => (
                  <li key={item.title} className="rounded-2xl border border-white/60 bg-white/70 px-4 py-3 shadow-subtle">
                    <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                    <p className="text-sm text-slate-600">{item.description}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-10 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Beta access · Canada First</div>
          </div>
        ) : null}
        <div className={hasSidePanel ? 'order-1 flex-1 lg:max-w-xl' : 'order-1 w-full'}>
          <div className="surface-card px-8 py-10 shadow-panel">
            <div className="space-y-2 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-[var(--cc-primary)]">Civil Citizens</p>
              <h1 className="text-3xl font-semibold text-slate-900">{title}</h1>
              {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
            </div>
            <div className="mt-8">{children}</div>
            {footer ? <div className="mt-8 text-center text-sm text-slate-500">{footer}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
