"use client"
import { useEffect } from 'react'

export default function AutoRedirect() {
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject('unauthorized'))
      .then(() => { window.location.replace('/home') })
      .catch(() => {})
  }, [])
  return null
}
