'use client'

import Image from 'next/image'
import Link from 'next/link'

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
}

const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'News Feed', href: '/home' },
  { key: 'chambers', label: 'Chambers', href: '/chambers' },
  { key: 'profile', label: 'Profile', href: '/profile' },
]

function navItemClasses(activeKey: string | undefined, itemKey: string, disabled?: boolean) {
  const base = 'block px-4 py-3 text-sm transition-colors'
  if (disabled) {
    return `${base} cursor-not-allowed text-gray-400`
  }
  if (activeKey === itemKey) {
    return `${base} bg-[var(--cc-primary)] font-semibold text-white`
  }
  return `${base} text-gray-700 hover:bg-[var(--cc-primary)]/10 hover:text-[var(--cc-primary)]`
}

export default function Sidebar({ me, active }: SidebarProps) {
  const displayName = me?.name?.trim() || 'Civil Citizen'
  const displayHandle = me?.handle ? `@${me.handle}` : '@civil'
  const initials = (me?.name?.trim() || me?.handle || 'C').substring(0, 1).toUpperCase()
  const avatarUrl = me?.avatarUrl || null
  const profileHref = me?.handle ? `/u/${me.handle}` : '/profile'

  return (
    <aside className="hidden lg:flex lg:min-h-screen lg:w-[220px] lg:flex-col lg:border-r lg:border-gray-200 lg:bg-white xl:w-[240px]">
      <div className="sticky top-0 flex flex-col divide-y divide-gray-200">
        <Link href="/home" className="flex items-center justify-center px-4 py-3 transition hover:bg-[var(--cc-primary)]/5">
          <Image src="/logo.svg" alt="Civil Citizens" width={136} height={32} priority className="h-8 w-auto" />
        </Link>

        <Link href={profileHref} className="flex items-center gap-3 px-4 py-4 transition hover:bg-[var(--cc-primary)]/5">
          <div className="h-12 w-12 overflow-hidden rounded-full bg-gray-200">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                width={48}
                height={48}
                unoptimized
                className="h-12 w-12 object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-gray-500">
                {initials}
              </div>
            )}
          </div>
          <div>
            <div className="text-sm font-semibold">{displayName}</div>
            <div className="text-xs text-gray-500">{displayHandle}</div>
          </div>
        </Link>

        <nav className="flex flex-col divide-y divide-gray-200">
          {NAV_ITEMS.map((item) => {
            if (item.disabled || !item.href) {
              return (
                <span key={item.key} className={navItemClasses(active, item.key, true)}>
                  {item.label}
                </span>
              )
            }
            return (
              <Link key={item.key} className={navItemClasses(active, item.key)} href={item.href}>
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
