"use client"

import { useEffect } from 'react'
import { ChambersView } from '../chambers/ChambersView'
import { buildApiUrl } from '../_lib/api'
import { hasHomeChamber, type MeResponse } from '../_lib/me'
import { redirectToAuthModal } from '../_lib/authModal'

export default function WelcomePage() {
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      redirectToAuthModal('login')
      return
    }

    fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : Promise.reject('unauthorized')))
      .then((data: MeResponse) => {
        if (hasHomeChamber(data)) {
          window.location.replace('/home')
        }
      })
      .catch(() => {
        localStorage.removeItem('token')
        redirectToAuthModal('login')
      })
  }, [])

  return <ChambersView mode="welcome" />
}
