"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CommunitiesView } from '../communities/CommunitiesView'
import { hasHomeCommunity } from '../_lib/me'
import { redirectToAuthModal } from '../_lib/authModal'
import { buildIosPwaInstallUrl, shouldBlockForAppleInstall } from '../_lib/appleInstallGate'
import { readStoredPostalCode } from '../_lib/postalRequirement'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureViewerMe } from '../_lib/viewerMe'

export default function WelcomePage() {
  const router = useRouter()
  const cachedMe = useViewerStore((s) => s.me)

  useEffect(() => {
    if (shouldBlockForAppleInstall()) {
      router.replace(buildIosPwaInstallUrl('/welcome', 'welcome'))
      return
    }

    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    if (cachedMe) {
      if (hasHomeCommunity(cachedMe) && readStoredPostalCode(cachedMe.id)) {
        router.replace('/home')
      }
      return
    }

    let cancelled = false
    void (async () => {
      const data = await ensureViewerMe({ token })
      if (cancelled) return
      if (data && hasHomeCommunity(data) && readStoredPostalCode(data.id)) {
        router.replace('/home')
        return
      }
      if (!localStorage.getItem('token')) {
        redirectToAuthModal('login')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [cachedMe, router])

  return <CommunitiesView mode="welcome" />
}
