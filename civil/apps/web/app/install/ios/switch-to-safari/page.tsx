'use client'

import { useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { buildIosPwaInstallUrl, normalizeRelativePath, shouldBlockForAppleInstall } from '../../../_lib/appleInstallGate'

export default function InstallIosSwitchToSafariPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = useMemo(() => normalizeRelativePath(searchParams.get('next'), '/login'), [searchParams])
  const source = useMemo(() => (searchParams.get('source') || '').trim(), [searchParams])

  const safariInstallUrl = useMemo(() => buildIosPwaInstallUrl(nextPath, source || undefined), [nextPath, source])

  useEffect(() => {
    const blocked = shouldBlockForAppleInstall()
    if (!blocked) {
      router.replace(nextPath)
      return
    }
    router.replace(safariInstallUrl)
  }, [nextPath, router, safariInstallUrl])

  return <div className="flex min-h-screen items-center justify-center bg-[var(--cc-page-bg)] text-slate-500">Redirecting…</div>
}
