'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { FAMILY_VIEW_CHANGED_EVENT, readStoredFamilyView } from '../_lib/familyView'
import { useViewerStore } from '../_lib/viewerStore'

export default function FamilyViewBootstrap() {
  const router = useRouter()
  const pathname = usePathname()
  const familyView = useViewerStore((s) => s.familyView)
  const setFamilyView = useViewerStore((s) => s.setFamilyView)
  const setFamilyViewHydrated = useViewerStore((s) => s.setFamilyViewHydrated)

  useEffect(() => {
    const syncFromStorage = () => {
      setFamilyView(readStoredFamilyView())
      setFamilyViewHydrated(true)
    }

    syncFromStorage()
    window.addEventListener(FAMILY_VIEW_CHANGED_EVENT, syncFromStorage)
    window.addEventListener('storage', syncFromStorage)
    return () => {
      window.removeEventListener(FAMILY_VIEW_CHANGED_EVENT, syncFromStorage)
      window.removeEventListener('storage', syncFromStorage)
    }
  }, [setFamilyView, setFamilyViewHydrated])

  useEffect(() => {
    if (!familyView) return
    const resolvedPathname = pathname || ''
    if (familyView.suspended) {
      if (resolvedPathname !== '/suspended') {
        router.replace('/suspended')
      }
      return
    }
    if (resolvedPathname === '/suspended') {
      router.replace('/home')
    }
  }, [familyView, pathname, router])

  return null
}