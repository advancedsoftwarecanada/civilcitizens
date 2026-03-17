'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { ElectoralDistrictContextResponse } from '@civil/shared'
import { MapZoomControls } from './MapZoomControls'

type CivilDistrictMapProps = {
  context: ElectoralDistrictContextResponse
}

export function CivilDistrictMap({ context }: CivilDistrictMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn?.({ duration: 180 })
  }, [])

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut?.({ duration: 180 })
  }, [])

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | null = null

    void (async () => {
      const maplibregl = await import('maplibre-gl')
      if (cancelled || !containerRef.current) return

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: context.styleUrl,
        center: [context.userLocation.lng, context.userLocation.lat],
        zoom: 9,
        attributionControl: false,
      })
      mapRef.current = map

      map.on('load', () => {
        const userFeature = {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [context.userLocation.lng, context.userLocation.lat] as [number, number],
          },
          properties: {},
        }

        map.addSource('civil-user-location', {
          type: 'geojson',
          data: userFeature,
        })

        map.addLayer({
          id: 'civil-user-location-ring',
          type: 'circle',
          source: 'civil-user-location',
          paint: {
            'circle-radius': 12,
            'circle-color': 'rgba(213, 43, 30, 0.18)',
          },
        })

        map.addLayer({
          id: 'civil-user-location-core',
          type: 'circle',
          source: 'civil-user-location',
          paint: {
            'circle-radius': 6,
            'circle-color': '#d52b1e',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        })

        const bounds = context.district
          ? new maplibregl.LngLatBounds(
              [context.district.bounds[0], context.district.bounds[1]],
              [context.district.bounds[2], context.district.bounds[3]],
            )
          : new maplibregl.LngLatBounds(
              [context.userLocation.lng, context.userLocation.lat],
              [context.userLocation.lng, context.userLocation.lat],
            )

        bounds.extend([context.userLocation.lng, context.userLocation.lat])

        if (context.district) {
          map.addSource('civil-district-boundary', {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: context.district.geometry,
              properties: {
                code: context.district.code,
                name: context.district.name,
              },
            },
          })

          map.addLayer({
            id: 'civil-district-fill',
            type: 'fill',
            source: 'civil-district-boundary',
            paint: {
              'fill-color': '#d52b1e',
              'fill-opacity': 0.12,
            },
          })

          map.addLayer({
            id: 'civil-district-line',
            type: 'line',
            source: 'civil-district-boundary',
            paint: {
              'line-color': '#911e16',
              'line-width': 3,
            },
          })
        }

        map.fitBounds(bounds, {
          padding: 48,
          duration: 0,
          maxZoom: context.district ? 11 : 12,
        })
      })

      cleanup = () => {
        map.remove()
        mapRef.current = null
      }
    })()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [context])

  return (
    <div className="relative h-[360px] w-full overflow-hidden rounded-[24px] border border-[var(--cc-border)] bg-slate-100 shadow-subtle">
      <div ref={containerRef} className="h-full w-full" />
      <MapZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />
    </div>
  )
}