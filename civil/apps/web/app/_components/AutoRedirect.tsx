"use client"
import { useEffect } from 'react'
import { buildApiUrl } from '../_lib/api'

export default function AutoRedirect() {
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
  fetch(buildApiUrl('/auth/me'), { headers: { authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject('unauthorized'))
      .then(() => { window.location.replace('/home') })
      .catch(() => {})
  }, [])
  return null
}
