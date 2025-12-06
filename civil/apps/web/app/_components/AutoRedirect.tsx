"use client"
import { useEffect } from 'react'
import { buildApiUrl } from '../_lib/api'
import { hasHomeCommunity, type MeResponse } from '../_lib/me'

export default function AutoRedirect() {
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : Promise.reject('unauthorized')))
      .then((data: MeResponse) => {
        if (hasHomeCommunity(data)) {
          window.location.replace('/home')
        } else {
          window.location.replace('/welcome')
        }
      })
      .catch(() => {})
  }, [])
  return null
}
