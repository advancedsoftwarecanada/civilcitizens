"use client"
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { buildApiUrl } from '../_lib/api'
import { hasHomeCommunity, type MeResponse } from '../_lib/me'
import { useViewerStore } from '../_lib/viewerStore'

export default function AutoRedirect() {
  const router = useRouter()
  const cachedMe = useViewerStore((s) => s.me)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return

    if (cachedMe) {
      if (hasHomeCommunity(cachedMe)) {
        router.replace('/home')
      } else {
        router.replace('/welcome')
      }
      return
    }

    fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : Promise.reject('unauthorized')))
      .then((data: MeResponse) => {
        if (hasHomeCommunity(data)) {
          router.replace('/home')
        } else {
          router.replace('/welcome')
        }
      })
      .catch(() => {})
  }, [cachedMe, router])
  return null
}
