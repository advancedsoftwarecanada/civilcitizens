'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildApiUrl } from '../../_lib/api'
import { useViewerStore } from '../../_lib/viewerStore'
import {
  loadViewerCommunityOptions,
  type CommunityOption,
} from '../_components/communityOptions'

export type OrganizationManagerRow = {
  id: string
  name: string
  slug: string
  provinceCode: string
  communitySlug: string
  isVerified?: boolean
  status?: string
  logoUrl?: string | null
  coverUrl?: string | null
}

export type OrganizationsManagerStatus = 'loading' | 'ready' | 'unauthorized' | 'error'

export function useOrganizationsManagerData() {
  const [status, setStatus] = useState<OrganizationsManagerStatus>('loading')
  const [followedOrganizations, setFollowedOrganizations] = useState<OrganizationManagerRow[]>([])
  const [ownedOrganizations, setOwnedOrganizations] = useState<OrganizationManagerRow[]>([])
  const [communityOptions, setCommunityOptions] = useState<CommunityOption[]>([])
  const [selectedCommunityKey, setSelectedCommunityKey] = useState('')
  const selectedCommunityKeyRef = useRef('')
  const cachedMe = useViewerStore((state) => state.me)

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem('token')
  }, [])

  const selectedCommunity = useMemo(() => {
    const [provinceCode, communitySlug] = selectedCommunityKey.split(':')
    if (!provinceCode || !communitySlug) return null
    return { provinceCode, communitySlug }
  }, [selectedCommunityKey])

  useEffect(() => {
    selectedCommunityKeyRef.current = selectedCommunityKey
  }, [selectedCommunityKey])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!token) {
        setStatus('unauthorized')
        return
      }

      setStatus('loading')
      try {
        const followsPromise = fetch(buildApiUrl('/organizations/follows'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const ownedPromise = fetch(buildApiUrl('/organizations/owned'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })

        const [communityResult, followsRes, ownedRes] = await Promise.all([
          loadViewerCommunityOptions({ token, cachedMe, preferredKey: selectedCommunityKeyRef.current }),
          followsPromise,
          ownedPromise,
        ])

        if (communityResult.status === 'unauthorized' || followsRes.status === 401 || ownedRes.status === 401) {
          if (!cancelled) setStatus('unauthorized')
          return
        }

        if (communityResult.status !== 'ready' || !followsRes.ok || !ownedRes.ok) {
          if (!cancelled) setStatus('error')
          return
        }

        const followsPayload = (await followsRes.json().catch(() => null)) as { items?: OrganizationManagerRow[] } | null
        const ownedPayload = (await ownedRes.json().catch(() => null)) as { items?: OrganizationManagerRow[] } | null

        if (!cancelled) {
          setFollowedOrganizations(Array.isArray(followsPayload?.items) ? followsPayload.items : [])
          setOwnedOrganizations(Array.isArray(ownedPayload?.items) ? ownedPayload.items : [])
          setCommunityOptions(communityResult.options)
          setSelectedCommunityKey((prev) => prev || communityResult.selectedKey)
          setStatus('ready')
        }
      } catch (error) {
        console.error('Unable to load organizations manager', error)
        if (!cancelled) setStatus('error')
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [cachedMe, token])

  return {
    status,
    followedOrganizations,
    ownedOrganizations,
    communityOptions,
    selectedCommunity,
    selectedCommunityKey,
    setSelectedCommunityKey,
  }
}