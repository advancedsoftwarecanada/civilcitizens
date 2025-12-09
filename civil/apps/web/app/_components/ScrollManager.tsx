'use client'

import { useEffect, useMemo } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

export default function ScrollManager() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchKey = useMemo(() => (searchParams ? searchParams.toString() : ''), [searchParams])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.history === 'undefined') return undefined
    const original = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => {
      window.history.scrollRestoration = original
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [pathname, searchKey])

  return null
}
