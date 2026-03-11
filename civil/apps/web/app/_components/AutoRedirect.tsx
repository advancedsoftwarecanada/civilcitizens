"use client"
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthedEntryPath } from '../_lib/me'
import { ensureViewerMe } from '../_lib/viewerMe'
import { FAMILY_PARENT_TOKEN_KEY } from '../_lib/authSession'
import { readStoredFamilyView } from '../_lib/familyView'
import { useViewerStore } from '../_lib/viewerStore'

export default function AutoRedirect() {
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

    const storedFamilyView = readStoredFamilyView()
    const storedParentToken = window.localStorage.getItem(FAMILY_PARENT_TOKEN_KEY)
    if (storedFamilyView && storedParentToken) {
      didNavigateRef.current = true
      router.replace(storedFamilyView.suspended ? '/suspended' : '/home')
      return
    }

    // Always resolve the active token before routing from the public landing page.
    // Family locked sessions can swap tokens underneath an older cached viewer object.
    if (!hydrated) return

    let cancelled = false

    ensureViewerMe({ token, refresh: true, cache: 'no-store' })
      .then((data) => {
        if (cancelled) return
        if (didNavigateRef.current) return
        if (!data) {
          document.documentElement.classList.remove('cc-launch-pending')
          return
        }
        didNavigateRef.current = true
        router.replace(getAuthedEntryPath(data))
      })
      .catch(() => {
        if (!cancelled) {
          document.documentElement.classList.remove('cc-launch-pending')
        }
      })

    return () => {
      cancelled = true
    }
  }, [hydrated, router])
  return null
}
