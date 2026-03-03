'use client'

import { useEffect, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { buildIosPwaInstallUrl, shouldBlockForAppleInstall } from '../_lib/appleInstallGate'

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
    if (!shouldBlockForAppleInstall()) return

    const nextPath = `${pathname}${search ? `?${search}` : ''}${window.location.hash || ''}`
    router.replace(buildIosPwaInstallUrl(nextPath, source))
  }, [pathname, router, search, source])

  return null
}
