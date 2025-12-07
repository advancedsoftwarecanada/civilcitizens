'use client'

import { usePathname } from 'next/navigation'
import TopNav from './TopNav'

const HIDDEN_PATHS = new Set(['/', '/login', '/register', '/forgot'])

export default function TopNavVisibility() {
  const pathname = usePathname()
  const hideNav = pathname ? HIDDEN_PATHS.has(pathname) : false

  if (hideNav) {
    return null
  }

  return <TopNav />
}
