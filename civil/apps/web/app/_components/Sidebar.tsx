'use client'

import Image from 'next/image'
import Link from 'next/link'
import clsx from 'clsx'
import { HiOutlineHome, HiOutlineBuildingOffice2, HiOutlineUserCircle } from 'react-icons/hi2'
import type { IconType } from 'react-icons'

type SidebarProps = {
  me?: {
    name?: string | null
    handle?: string
    avatarUrl?: string | null
  }
  active?: 'home' | 'chambers' | string
}

type NavItem = {
  key: string
  label: string
  href?: string
  disabled?: boolean
  description?: string
  icon: IconType
}

const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'News Feed', href: '/home', description: 'Updates from your chambers', icon: HiOutlineHome },
  {
    key: 'chambers',
    label: 'Chambers',
    href: '/chambers',
    description: 'Browse EDAs across Canada',
    icon: HiOutlineBuildingOffice2,
  },
  { key: 'profile', label: 'Profile', href: '/profile', description: 'Your civic identity', icon: HiOutlineUserCircle },
]

function navItemClasses(activeKey: string | undefined, itemKey: string, disabled?: boolean) {
  return clsx(
    'flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-semibold transition',
    disabled && 'cursor-not-allowed border-transparent text-slate-400',
    !disabled && activeKey === itemKey && 'border-brand-100 bg-brand-50 text-brand-700 shadow-subtle',
    !disabled && activeKey !== itemKey && 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900',
  )
}

export default function Sidebar({ me, active }: SidebarProps) {
  const displayName = me?.name?.trim() || 'Civil Citizen'
  const displayHandle = me?.handle ? `@${me.handle}` : '@civil'
  const initials = (me?.name?.trim() || me?.handle || 'C').substring(0, 1).toUpperCase()
  const avatarUrl = me?.avatarUrl || null
  const profileHref = me?.handle ? `/u/${me.handle}` : '/profile'

  return (
    <aside className="hidden lg:block lg:w-[280px] xl:w-[300px]">
      <div className="sticky top-8 space-y-4">
        <Link href="/home" className="flex items-center gap-2 text-sm font-semibold text-slate-500">
          <Image src="/logo.svg" alt="Civil Citizens" width={146} height={36} priority className="h-9 w-auto" />
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Beta</span>
        </Link>

        <section className="surface-card p-5">
          <Link href={profileHref} className="flex items-center gap-3">
            <div className="h-12 w-12 overflow-hidden rounded-full bg-slate-200">
              {avatarUrl ? (
                <Image src={avatarUrl} alt={displayName} width={48} height={48} unoptimized className="h-12 w-12 object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-slate-500">{initials}</div>
              )}
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">{displayName}</div>
              <div className="text-xs text-slate-500">{displayHandle}</div>
            </div>
          </Link>

          <nav className="mt-6 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const content = (
                <div className="flex flex-1 items-center gap-3">
                  <span className="text-lg text-slate-400">
                    <Icon />
                  </span>
                  <div>
                    <div>{item.label}</div>
                    {item.description ? <p className="text-xs font-normal text-slate-400">{item.description}</p> : null}
                  </div>
                </div>
              )

              if (item.disabled || !item.href) {
                return (
                  <span key={item.key} className={navItemClasses(active, item.key, true)}>
                    {content}
                  </span>
                )
              }
              return (
                <Link key={item.key} href={item.href} className={navItemClasses(active, item.key)}>
                  {content}
                </Link>
              )
            })}
          </nav>

          <Link
            href="/chambers"
            className="mt-5 inline-flex w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Browse Chambers
          </Link>
        </section>
      </div>
    </aside>
  )
}
