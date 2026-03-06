'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export default function LaunchOverlayCleanup() {
  const pathname = usePathname()

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (pathname !== '/') {
      document.documentElement.classList.remove('cc-launch-pending')
    }
  }, [pathname])

  return null
}
