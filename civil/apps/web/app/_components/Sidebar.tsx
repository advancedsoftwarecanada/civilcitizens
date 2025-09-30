'use client'

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
  const base = 'block rounded px-4 py-2 text-sm transition'
  if (disabled) {
    return `${base} cursor-not-allowed text-gray-400`
  }
  if (activeKey === itemKey) {
    return `${base} bg-black font-semibold text-white`
  }
  return `${base} text-gray-700 hover:bg-gray-100`
}

export default function Sidebar({ me, active }: SidebarProps) {
  const displayName = me?.name?.trim() || 'Civil Citizen'
  const displayHandle = me?.handle ? `@${me.handle}` : '@civil'
  const initials = (me?.name?.trim() || me?.handle || 'C').substring(0, 1).toUpperCase()
  const avatarUrl = me?.avatarUrl || null

  return (
    <aside className="col-span-3 hidden md:block">
      <div className="sticky top-4 space-y-4">
        <div className="flex items-center gap-3 rounded-lg border bg-white p-4">
          <div className="h-12 w-12 overflow-hidden rounded-full bg-gray-200">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={displayName} className="h-12 w-12 object-cover" />
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
        </div>

        <nav className="space-y-1">
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

        <button
          type="button"
          className="w-full rounded bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Post
        </button>
      </div>
    </aside>
  )
}
