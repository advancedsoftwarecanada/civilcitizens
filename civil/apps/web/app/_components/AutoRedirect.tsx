"use client"
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthedEntryPath } from '../_lib/me'
import { ensureViewerMe } from '../_lib/viewerMe'
import { FAMILY_PARENT_TOKEN_KEY } from '../_lib/authSession'
import { readStoredFamilyView } from '../_lib/familyView'
import { resolvePendingPushRedirectOrFallback, setPendingPushRedirect } from '../_lib/pendingPushRedirect'
import { useViewerStore } from '../_lib/viewerStore'
import { ensureNativeNotificationTapListener, getLastNativeNotificationTapUrl } from '../_lib/nativePush'
import { normalizePushDeepLinkUrl } from '../_lib/pushDeepLink'
import { emitPushUiReset } from '../_lib/pushNavigation'

export default function AutoRedirect({ targetPath }: { targetPath?: string }) {
  const router = useRouter()
  const hydrated = useViewerStore((s) => s.hydrated)
  const didNavigateRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = window.localStorage.getItem('token')
    if (!token) return
    void router.prefetch('/home')
    void router.prefetch('/suspended')
    void router.prefetch('/welcome')
    void router.prefetch('/verify')
  }, [router])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (didNavigateRef.current) return

    const token = window.localStorage.getItem('token')
    if (!token) {
      document.documentElement.classList.remove('cc-launch-pending')
      return
    }

    let cancelled = false

    const redirectFromLanding = async () => {
      await ensureNativeNotificationTapListener().catch(() => undefined)

      const nextPushUrl = normalizePushDeepLinkUrl(await getLastNativeNotificationTapUrl().catch(() => null))
      if (!cancelled && nextPushUrl) {
        setPendingPushRedirect(nextPushUrl)
        emitPushUiReset(nextPushUrl)
      }

      const storedFamilyView = readStoredFamilyView()
      const storedParentToken = window.localStorage.getItem(FAMILY_PARENT_TOKEN_KEY)
      if (storedFamilyView && storedParentToken) {
        if (cancelled || didNavigateRef.current) return
        didNavigateRef.current = true
        router.replace(targetPath ?? resolvePendingPushRedirectOrFallback(storedFamilyView.suspended ? '/suspended' : '/home'))
        return
      }

      // Always resolve the active token before routing from the public landing page.
      // Family locked sessions can swap tokens underneath an older cached viewer object.
      if (!hydrated) return

      const data = await ensureViewerMe({ token, refresh: true, cache: 'no-store' })
      if (cancelled) return
      if (didNavigateRef.current) return
      if (!data) {
        document.documentElement.classList.remove('cc-launch-pending')
        return
      }
      didNavigateRef.current = true
      router.replace(targetPath ?? resolvePendingPushRedirectOrFallback(getAuthedEntryPath(data)))
    }

    void redirectFromLanding().catch(() => {
      if (!cancelled) {
        document.documentElement.classList.remove('cc-launch-pending')
      }
    })

    return () => {
      cancelled = true
    }
  }, [hydrated, router, targetPath])
  return null
}
