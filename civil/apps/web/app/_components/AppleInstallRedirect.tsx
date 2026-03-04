'use client'

import { useEffect, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { buildPwaInstallEntryUrl } from '../_lib/appleInstallGate'

type AppleInstallRedirectProps = {
  source: string
}

export default function AppleInstallRedirect({ source }: AppleInstallRedirectProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = useMemo(() => searchParams.toString(), [searchParams])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const nextPath = `${pathname}${search ? `?${search}` : ''}${window.location.hash || ''}`
    const installUrl = buildPwaInstallEntryUrl(nextPath, source)
    if (!installUrl) return
    router.replace(installUrl)
  }, [pathname, router, search, source])

  return null
}
