'use client'

import { useEffect, useRef } from 'react'
import { buildApiUrl } from '../_lib/api'
import { getCurrentLocation } from '../_lib/locationService'
import { getStoredToken } from '../_lib/tokenStorage'
import type { DriveFeedResponse, DriveRideRequestItem } from './driveShared'

const LOCATION_SYNC_INTERVAL_MS = 15_000
const MIN_LOCATION_SYNC_INTERVAL_MS = 10_000
const MIN_LOCATION_SYNC_DISTANCE_KM = 0.05
const ACTIVE_RIDE_LOCATION_STATUSES = new Set([
  'accepted',
  'assigned',
  'matched',
  'driver_selected',
  'driver_en_route',
  'en_route',
  'driver_arrived',
  'arrived',
  'picked_up',
  'in_progress',
])

function calculateDistanceKm(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }) {
  const earthRadiusKm = 6371
  const toRadians = (value: number) => (value * Math.PI) / 180
  const deltaLat = toRadians(destination.latitude - origin.latitude)
  const deltaLon = toRadians(destination.longitude - origin.longitude)
  const originLat = toRadians(origin.latitude)
  const destinationLat = toRadians(destination.latitude)

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2) * Math.cos(originLat) * Math.cos(destinationLat)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

export default function DriveActiveRideLocationSync({ enabled }: { enabled: boolean }) {
  const activeRideIdsRef = useRef<string[]>([])
  const lastSyncedLocationRef = useRef<{ latitude: number; longitude: number; at: number } | null>(null)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      activeRideIdsRef.current = []
      lastSyncedLocationRef.current = null
      return
    }

    let cancelled = false
    let syncing = false

    async function postLocation(latitude: number, longitude: number) {
      const token = getStoredToken()
      if (!token) return

      const rideIds = activeRideIdsRef.current
      if (!rideIds.length) return

      await Promise.all(
        rideIds.map(async (rideId) => {
          try {
            await fetch(buildApiUrl(`/drive/rides/${encodeURIComponent(rideId)}/location`), {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ latitude, longitude }),
            })
          } catch (error) {
            console.error('Failed to sync active ride location', error)
          }
        }),
      )
    }

    async function syncLocation(force: boolean) {
      if (cancelled || syncing) return
      syncing = true

      try {
        const token = getStoredToken()
        if (!token) return

        const response = await fetch(buildApiUrl('/drive/rides?scope=mine&limit=12'), {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as DriveFeedResponse<DriveRideRequestItem> | null

        if (!response.ok) {
          activeRideIdsRef.current = []
          return
        }

        const activeRideIds = (Array.isArray(payload?.items) ? payload.items : [])
          .filter((item) => (item.viewerRole === 'driver' || item.viewerRole === 'requester') && ACTIVE_RIDE_LOCATION_STATUSES.has(item.status.trim().toLowerCase()))
          .map((item) => item.id)

        activeRideIdsRef.current = activeRideIds
        if (!activeRideIds.length) return

        const locationResult = await getCurrentLocation({
          reason: 'drive-active-ride-sync',
          highAccuracy: true,
          timeoutMs: 10_000,
          maximumAgeMs: 60_000,
          minIntervalMs: MIN_LOCATION_SYNC_INTERVAL_MS,
        })
        if (cancelled || !locationResult.ok || !locationResult.location) return

        const latitude = locationResult.location.latitude
        const longitude = locationResult.location.longitude
        const now = Date.now()
        const previous = lastSyncedLocationRef.current
        const movedKm =
          previous
            ? calculateDistanceKm(previous, { latitude, longitude })
            : Number.POSITIVE_INFINITY

        if (!force && previous && now - previous.at < MIN_LOCATION_SYNC_INTERVAL_MS && movedKm < MIN_LOCATION_SYNC_DISTANCE_KM) {
          return
        }

        lastSyncedLocationRef.current = { latitude, longitude, at: now }
        await postLocation(latitude, longitude)
      } finally {
        syncing = false
      }
    }

    void syncLocation(true)
    const intervalId = window.setInterval(() => {
      void syncLocation(false)
    }, LOCATION_SYNC_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [enabled])

  return null
}
