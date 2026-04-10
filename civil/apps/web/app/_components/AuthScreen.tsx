import type { ReactNode } from 'react'
import Image from 'next/image'

const DEFAULT_HIGHLIGHTS = [
  {
    title: 'Fair pay for drivers',
    description: 'Drivers set their own prices and keep more of every ride with a simple flat fee model.',
  },
  {
    title: 'Fair pricing for riders',
    description: 'No surge pricing. Clear totals. A simpler booking experience built to be easy to trust.',
  },
  {
    title: 'Built for Canada',
    description: 'MapleRides is designed for major cities, regional hubs, and small towns across Canada.',
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
  sideTitle = 'A fairer ride platform starts here',
  sideDescription = 'Create your account to book rides, manage your trips, and get ready to drive with MapleRides.',
  sideHighlights = DEFAULT_HIGHLIGHTS,
  hideSidePanel = false,
  useWallpaper = false,
}: AuthScreenProps) {
  const hasSidePanel = !hideSidePanel
  const containerClass = hasSidePanel
    ? 'cc-auth-screen__container mx-auto flex min-h-[var(--cc-viewport-height)] max-w-6xl flex-col gap-10 px-4 py-10 sm:px-8 lg:flex-row lg:items-stretch lg:py-14'
    : 'cc-auth-screen__container mx-auto flex min-h-[var(--cc-viewport-height)] max-w-xl flex-col justify-center gap-10 px-4 py-10 sm:px-8 lg:py-14'
  const outerClass = useWallpaper
    ? 'cc-auth-screen relative isolate min-h-[var(--cc-viewport-height)] overflow-hidden bg-[#f6f0ea]'
    : 'cc-auth-screen relative isolate min-h-[var(--cc-viewport-height)] overflow-hidden bg-[#f6f0ea]'

  return (
    <div className={outerClass}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(217,34,42,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.12),transparent_32%),linear-gradient(180deg,#f8f3ed_0%,#f5efe7_100%)]" aria-hidden="true" />
      <div className="absolute left-[-4rem] top-12 h-64 w-64 rounded-full bg-red-500/10 blur-3xl" aria-hidden="true" />
      <div className="absolute bottom-0 right-[-5rem] h-72 w-72 rounded-full bg-slate-900/10 blur-3xl" aria-hidden="true" />
      <div className="relative z-10">
        <div className={containerClass}>
        {hasSidePanel ? (
          <div className="order-2 flex flex-1 flex-col justify-between rounded-[32px] border border-white/70 bg-white/75 p-8 text-slate-700 shadow-[0_40px_120px_rgba(15,23,42,0.12)] backdrop-blur">
            <div>
              <div className="inline-flex rounded-full bg-red-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-red-600">
                MapleRides
              </div>
              <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-slate-950">{sideTitle}</h2>
              <p className="mt-3 text-base leading-7 text-slate-600">{sideDescription}</p>
              <ul className="mt-6 space-y-4">
                {sideHighlights.map((item) => (
                  <li key={item.title} className="rounded-[1.4rem] border border-slate-200 bg-white/90 px-4 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                    <div className="text-sm font-semibold text-slate-950">{item.title}</div>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-10 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Canadian owned rides platform</div>
          </div>
        ) : null}
        <div className={hasSidePanel ? 'order-1 flex-1 lg:max-w-xl' : 'order-1 w-full'}>
          <div className="rounded-[2rem] border border-white/80 bg-white/92 px-8 py-10 shadow-[0_32px_100px_rgba(15,23,42,0.12)] backdrop-blur">
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <Image src="/Maple-Rides.png" alt="MapleRides" width={772} height={441} priority className="h-auto w-[190px] sm:w-[220px]" />
              </div>
              <div className="inline-flex rounded-full bg-red-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-red-600">
                Canadian owned rides platform
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-black tracking-[-0.04em] text-slate-950 sm:text-[2.1rem]">{title}</h1>
                {subtitle ? <p className="mx-auto max-w-md text-sm leading-6 text-slate-500 sm:text-base">{subtitle}</p> : null}
              </div>
            </div>
            <div className="mt-8">{children}</div>
            {footer ? <div className="mt-8 text-center text-sm text-slate-500">{footer}</div> : null}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
