"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CommunitiesView } from '../communities/CommunitiesView'
import { buildApiUrl } from '../_lib/api'
import { hasHomeCommunity, type MeResponse } from '../_lib/me'
import { redirectToAuthModal } from '../_lib/authModal'
import { readStoredPostalCode } from '../_lib/postalRequirement'
import { useViewerStore } from '../_lib/viewerStore'

export default function WelcomePage() {
  const router = useRouter()
  const cachedMe = useViewerStore((s) => s.me)

  useEffect(() => {
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

    fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : Promise.reject('unauthorized')))
      .then((data: MeResponse) => {
        if (hasHomeCommunity(data) && readStoredPostalCode(data.id)) {
          router.replace('/home')
        }
      })
      .catch(() => {
        localStorage.removeItem('token')
        redirectToAuthModal('login')
      })
  }, [cachedMe, router])

  return <CommunitiesView mode="welcome" />
}
