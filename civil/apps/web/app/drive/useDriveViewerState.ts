'use client'

import { useCallback, useEffect, useState } from 'react'
import { buildApiUrl } from '../_lib/api'
import { redirectToAuthModal } from '../_lib/authModal'
import { getStoredToken } from '../_lib/tokenStorage'
import type { DeliveryOnboardingResponse } from '../delivery/deliveryShared'
import type { DriveDeliveryItem, DriveFeedResponse, DriveRideRequestItem } from './driveShared'

type DriveViewerStateSnapshot = {
  loading: boolean
  isDriverActive: boolean
  rideRequestCount: number
  deliveryRequestCount: number
}

type DriveViewerState = DriveViewerStateSnapshot & {
  isDriverMode: boolean
  enterDriverMode: () => void
  exitDriverMode: () => void
}

type DriveModePreference = 'driver' | 'request'

const DRIVE_MODE_STORAGE_KEY = 'civil.drive.mode'
const DRIVE_MODE_EVENT = 'civil:drive-mode-change'

function readStoredDriveModePreference(): DriveModePreference | null {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(DRIVE_MODE_STORAGE_KEY)
  if (!raw) return null

  if (raw === 'driver' || raw === 'request') return raw

  try {
    const parsed = JSON.parse(raw) as { mode?: unknown } | null
    return parsed?.mode === 'driver' || parsed?.mode === 'request' ? parsed.mode : null
  } catch {
    return null
  }
}

function writeStoredDriveModePreference(mode: DriveModePreference) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DRIVE_MODE_STORAGE_KEY, JSON.stringify({ mode }))
  window.dispatchEvent(new CustomEvent(DRIVE_MODE_EVENT, { detail: { mode } }))
}

const INITIAL_STATE: DriveViewerStateSnapshot = {
  loading: true,
  isDriverActive: false,
  rideRequestCount: 0,
  deliveryRequestCount: 0,
}

export function useDriveViewerState(): DriveViewerState {
  const [state, setState] = useState<DriveViewerStateSnapshot>(INITIAL_STATE)
  const [modePreference, setModePreference] = useState<DriveModePreference | null>(null)

  const enterDriverMode = useCallback(() => {
    setModePreference('driver')
    writeStoredDriveModePreference('driver')
  }, [])

  const exitDriverMode = useCallback(() => {
    setModePreference('request')
    writeStoredDriveModePreference('request')
  }, [])

  useEffect(() => {
    setModePreference(readStoredDriveModePreference())

    if (typeof window === 'undefined') return

    const syncModePreference = () => {
      setModePreference(readStoredDriveModePreference())
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== DRIVE_MODE_STORAGE_KEY) return
      syncModePreference()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(DRIVE_MODE_EVENT, syncModePreference)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(DRIVE_MODE_EVENT, syncModePreference)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const token = getStoredToken()
      if (!token) {
        redirectToAuthModal('login')
        return
      }

      setState((current) => ({ ...current, loading: true }))

      try {
        const [onboardingRes, ridesRes, deliveryRes] = await Promise.all([
          fetch(buildApiUrl('/drive/onboarding'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(buildApiUrl('/drive/rides?scope=open&limit=1'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(buildApiUrl('/drive/delivery?scope=open&limit=1'), {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
        ])

        if (onboardingRes.status === 401 || ridesRes.status === 401 || deliveryRes.status === 401) {
          redirectToAuthModal('login')
          return
        }

        const [onboardingPayload, ridesPayload, deliveryPayload] = await Promise.all([
          onboardingRes.json().catch(() => null) as Promise<DeliveryOnboardingResponse | null>,
          ridesRes.json().catch(() => null) as Promise<DriveFeedResponse<DriveRideRequestItem> | null>,
          deliveryRes.json().catch(() => null) as Promise<DriveFeedResponse<DriveDeliveryItem> | null>,
        ])

        if (cancelled) return

        setState({
          loading: false,
          isDriverActive: onboardingRes.ok && onboardingPayload?.active === true,
          rideRequestCount: ridesRes.ok ? Number(ridesPayload?.total) || (Array.isArray(ridesPayload?.items) ? ridesPayload.items.length : 0) : 0,
          deliveryRequestCount:
            deliveryRes.ok ? Number(deliveryPayload?.total) || (Array.isArray(deliveryPayload?.items) ? deliveryPayload.items.length : 0) : 0,
        })
      } catch (error) {
        console.error('Failed to load Drive viewer state', error)
        if (cancelled) return
        setState((current) => ({
          ...current,
          loading: false,
        }))
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const isDriverMode = state.isDriverActive && (modePreference ?? 'driver') === 'driver'

  useEffect(() => {
    if (!state.isDriverActive || modePreference !== null) return
    setModePreference('driver')
    writeStoredDriveModePreference('driver')
  }, [modePreference, state.isDriverActive])

  return {
    ...state,
    isDriverMode,
    enterDriverMode,
    exitDriverMode,
  }
}
