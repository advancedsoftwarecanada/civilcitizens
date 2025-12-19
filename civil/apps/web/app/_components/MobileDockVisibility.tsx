'use client'

import { usePathname } from 'next/navigation'
import MobileDock from './MobileDock'

export default function MobileDockVisibility() {
  const pathname = usePathname()

  if (pathname?.startsWith('/welcome')) {
    return null
  }

  return <MobileDock />
}
